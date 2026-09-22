/**
 * The draw path: mesh binding, batching, projection and the sky pass.
 *
 * `draw()` keeps the signature it has always had, because several hundred call sites
 * across the simulation and HUD depend on it. What changed underneath is that it now
 * serves two passes — the lit scene and the depth-only shadow cascades — selected by
 * `pass.mode`. Callers draw the world once and the renderer replays it per cascade.
 */
import { G } from '../sim/state.js';
import { M, dot, hex, norm } from './math.js';
import { camera } from './viewport.js';
import { geo, upload } from './mesh.js';
import { gl } from './gl.js';
import { scenePrg, shadowPrg, skyPrg, quadVao } from './programs.js';
import { MATERIAL, SUN_DIR, SUN_COLOR, MOON_DIR } from './lighting.js';

let currentVao = null;

/**
 * State for the render pass in flight.
 *
 * `material` is a per-draw surface description rather than a texture, because the geometry
 * carries no texture coordinates — see `MATERIAL` in lighting.js. Call sites set it before
 * a group of draws and it persists until changed, like any other GL state.
 */
export const pass = {
  imagingPass: false,
  wireTint: [0.18, 0.7, 0.43],
  /** 'scene' or 'shadow'. */
  mode: 'scene',
  material: MATERIAL.terrain,
};

/** Select a surface preset for subsequent draws: `setMaterial(MATERIAL.armor)`. */
export function setMaterial(material) {
  pass.material = material;
}

/**
 * A vertex array object per mesh, built on first use.
 *
 * Attribute locations are pinned in programs.js, so the same VAO is valid for the scene
 * and shadow programs and no re-specification is needed when the pass changes.
 */
function meshVao(g, buffer) {
  if (g.vao && g.vaoBuffer === buffer) return g.vao;
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.enableVertexAttribArray(1);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 36, 12);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 36, 24);
  gl.bindVertexArray(null);
  g.vao = vao;
  g.vaoBuffer = buffer;
  return vao;
}

function bindMesh(g, buffer) {
  const vao = meshVao(g, buffer);
  if (currentVao === vao) return;
  gl.bindVertexArray(vao);
  currentVao = vao;
}

/** Edge list for Enhanced Imaging, built lazily and cached on the mesh. */
function edgeBuffer(g) {
  if (g.edges) return g.edges;
  const d = g.data,
    edges = new Map(),
    key = (i) => d[i].toFixed(3) + ',' + d[i + 1].toFixed(3) + ',' + d[i + 2].toFixed(3);
  for (let i = 0; i < d.length; i += 27) {
    const n = [d[i + 3], d[i + 4], d[i + 5]];
    for (let j = 0; j < 3; j++) {
      const a = i + j * 9,
        b = i + ((j + 1) % 3) * 9,
        ka = key(a),
        kb = key(b);
      if (ka === kb) continue;
      const k = ka < kb ? ka + '|' + kb : kb + '|' + ka,
        e = edges.get(k);
      if (e) {
        e.shared = true;
        if (dot(e.n, n) < 0.995) e.crease = true;
      } else edges.set(k, { a, b, n, shared: false, crease: false });
    }
  }
  const out = [];
  for (const e of edges.values()) {
    if (!g.grid && e.shared && !e.crease) continue;
    for (const i of [e.a, e.b]) for (let j = 0; j < 9; j++) out.push(d[i + j]);
  }
  const b = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(out), gl.STATIC_DRAW);
  currentVao = null;
  gl.bindVertexArray(null);
  g.edges = { b, count: out.length / 9, data: out };
  return g.edges;
}

export function releaseMesh(g) {
  gl.deleteBuffer(g.b);
  if (g.vao) gl.deleteVertexArray(g.vao);
  if (g.edges) {
    gl.deleteBuffer(g.edges.b);
    if (g.edges.vao) gl.deleteVertexArray(g.edges.vao);
  }
}

const normalMatrix = new Float32Array(9);

/**
 * An uploaded mesh: a GPU buffer, its vertex count, and the interleaved source data kept
 * for baking and for building the Enhanced Imaging edge list.
 *
 * @typedef {{
 *   b: WebGLBuffer,
 *   count: number,
 *   data: number[],
 *   grid?: boolean,
 *   vao?: WebGLVertexArrayObject,
 *   vaoBuffer?: WebGLBuffer,
 *   edges?: any,
 * }} Mesh
 */

/**
 * Draw one mesh.
 *
 * @param {Mesh|null|undefined} g
 * @param {Float32Array} m model matrix
 * @param {number[]} [color]
 * @param {number} [alpha]
 * @param {number} [glow]  0 lit, 1 fully emissive
 */
export function draw(g, m, color = [1, 1, 1], alpha = 1, glow = 0) {
  if (!g || !g.count) return;

  if (pass.mode === 'shadow') {
    // Only opaque, non-emissive geometry casts. A tracer or a smoke puff casting a hard
    // shadow reads as a bug, and the alpha test would have to happen per fragment anyway.
    if (alpha < 0.95 || glow > 0.5) return;
    bindMesh(g, g.b);
    gl.uniformMatrix4fv(shadowPrg.uModel, false, m);
    gl.drawArrays(gl.TRIANGLES, 0, g.count);
    return;
  }

  gl.uniformMatrix4fv(scenePrg.uModel, false, m);
  normalMatrix.set(M.normalMatrix(m));
  gl.uniformMatrix3fv(scenePrg.uNormalMatrix, false, normalMatrix);
  gl.uniform3fv(scenePrg.uColor, color);
  gl.uniform1f(scenePrg.uAlpha, alpha);
  gl.uniform1f(scenePrg.uGlow, glow);
  gl.uniform4fv(scenePrg.uMaterial, pass.material);

  if (pass.imagingPass) {
    if (alpha > 0.5) {
      bindMesh(g, g.b);
      gl.uniform1f(scenePrg.uImaging, 1);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, g.count);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    const e = edgeBuffer(g);
    bindMesh(e, e.b);
    gl.uniform1f(scenePrg.uImaging, 2);
    gl.uniform3fv(scenePrg.uWireColor, pass.wireTint);
    gl.drawArrays(gl.LINES, 0, e.count);
  } else {
    bindMesh(g, g.b);
    gl.uniform1f(scenePrg.uImaging, 0);
    gl.drawArrays(gl.TRIANGLES, 0, g.count);
  }
}

export function part(g, p, s, c, r = [0, 0, 0], glow = 0) {
  return { g: geo[g], p, s: s.map((v) => v / 2), r, c: typeof c === 'string' ? hex(c) : c, glow };
}

export function drawPart(p, parent) {
  draw(p.g, M.mul(parent, M.transform(p.p, p.s, p.r)), p.c, 1, p.glow || 0);
}

export function bake(parts) {
  const data = [];
  for (const p of parts) {
    const m = M.transform(p.p, p.s, p.r),
      d = p.g.data;
    for (let i = 0; i < d.length; i += 9) {
      const v = M.point(m, d.slice(i, i + 3)),
        n = norm(M.vector(m, d.slice(i + 3, i + 6)));
      data.push(...v, ...n, d[i + 6] * p.c[0], d[i + 7] * p.c[1], d[i + 8] * p.c[2]);
    }
  }
  return upload(data);
}

export function packParts(parts) {
  const groups = new Map();
  for (const p of parts) {
    const key = (p.component || 'core') + '/' + (p.glow || 0);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  return [...groups.values()].map((list) => ({
    g: bake(list),
    p: [0, 0, 0],
    s: [1, 1, 1],
    r: [0, 0, 0],
    c: [1, 1, 1],
    glow: list[0].glow || 0,
    component: list[0].component || 'core',
    owned: true,
  }));
}

export function project(p) {
  const m = camera.viewProj,
    x = p[0],
    y = p[1],
    z = p[2],
    w = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (w < 0.1) return null;
  return {
    x: (((m[0] * x + m[4] * y + m[8] * z + m[12]) / w) * 0.5 + 0.5) * camera.screenW,
    y: (0.5 - ((m[1] * x + m[5] * y + m[9] * z + m[13]) / w) * 0.5) * camera.screenH,
    w,
  };
}

/**
 * Blending helpers that know which pass is running.
 *
 * Glow, particles, beams and holographic markers all need blending, and the code that
 * draws them is interleaved with the solid geometry the shadow cascades also traverse.
 * A raw `gl.depthMask(false)` in the middle of that would silently stop a cascade writing
 * depth for everything after it. These no-op during the shadow pass instead, so the same
 * draw code can serve both without a caller having to remember which one it is in.
 */
export function blendAdditive() {
  if (pass.mode === 'shadow') return;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.depthMask(false);
}

export function blendAlpha() {
  if (pass.mode === 'shadow') return;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
}

/** Switch blend equation without touching the depth mask. */
export function blendMode(mode) {
  if (pass.mode === 'shadow') return;
  gl.blendFunc(gl.SRC_ALPHA, mode === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
}

export function blendEnd() {
  if (pass.mode === 'shadow') return;
  gl.depthMask(true);
  gl.disable(gl.BLEND);
}

/** Switch the renderer into depth-only cascade rendering. */
export function beginShadowPass(lightMatrix) {
  pass.mode = 'shadow';
  currentVao = null;
  gl.useProgram(shadowPrg.p);
  gl.uniformMatrix4fv(shadowPrg.uLightVP, false, lightMatrix);
  // Front-face culling during the depth pass pushes acne to surfaces the camera cannot
  // see, which removes most of it without needing an aggressive depth bias.
  gl.enable(gl.CULL_FACE);
  gl.cullFace(gl.FRONT);
  gl.disable(gl.BLEND);
  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
}

export function endShadowPass() {
  pass.mode = 'scene';
  currentVao = null;
  gl.disable(gl.CULL_FACE);
  gl.cullFace(gl.BACK);
}

/**
 * Draw the sky, then set up the scene program for the frame.
 *
 * Called once, after the shadow cascades are filled and the HDR target is bound.
 */
export function renderSky() {
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.useProgram(skyPrg.p);
  gl.bindVertexArray(quadVao);
  currentVao = null;

  gl.uniform3fv(skyPrg.uForward, camera.cameraForward);
  gl.uniform3fv(skyPrg.uRight, camera.cameraRight);
  gl.uniform3fv(skyPrg.uUp, camera.cameraUp);
  gl.uniform1f(skyPrg.uAspect, camera.screenW / camera.screenH);
  gl.uniform1f(skyPrg.uFov, Math.tan(camera.fov / 2));
  gl.uniform1f(skyPrg.uOffset, G.state === 'menu' ? 0 : -0.14);
  gl.uniform3fv(skyPrg.uSunDir, SUN_DIR);
  gl.uniform3fv(skyPrg.uSunColor, SUN_COLOR);
  gl.uniform3fv(skyPrg.uMoonDir, MOON_DIR);
  gl.uniform1f(skyPrg.uExposure, 1);
  gl.uniform1f(skyPrg.uTime, G.realTime);
  gl.uniform1f(skyPrg.uNight, G.player?.vision ? 1 : 0);
  gl.uniform1f(skyPrg.uImaging, pass.imagingPass ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  gl.bindVertexArray(null);
  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.useProgram(scenePrg.p);
  gl.disable(gl.CULL_FACE);
}
