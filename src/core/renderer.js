/**
 * The draw path: mesh binding, batching, projection and the sky pass.
 */
import { G } from '../sim/state.js';
import { M, dot, hex, norm } from './math.js';
import { camera } from './viewport.js';
import { geo, upload } from './mesh.js';
import { gl } from './gl.js';
import { prg, skyBuffer, skyPrg } from './programs.js';

let currentBuffer = null;

/**
 * Flags for the render pass in flight: enhanced-imaging mode and wireframe tint.
 */
export const pass = {
  imagingPass: false,
  wireTint: [0.18, 0.7, 0.43],
};

function bindMesh(buffer) {
  if (currentBuffer === buffer) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const a of [prg.aPos, prg.aNormal, prg.aColor]) gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(prg.aPos, 3, gl.FLOAT, false, 36, 0);
  gl.vertexAttribPointer(prg.aNormal, 3, gl.FLOAT, false, 36, 12);
  gl.vertexAttribPointer(prg.aColor, 3, gl.FLOAT, false, 36, 24);
  currentBuffer = buffer;
}

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
  currentBuffer = null;
  g.edges = { b, count: out.length / 9 };
  return g.edges;
}

export function releaseMesh(g) {
  gl.deleteBuffer(g.b);
  if (g.edges) gl.deleteBuffer(g.edges.b);
}

export function draw(g, m, color = [1, 1, 1], alpha = 1, glow = 0) {
  if (!g || !g.count) return;
  gl.uniformMatrix4fv(prg.uModel, false, m);
  gl.uniform3fv(prg.uColor, color);
  gl.uniform1f(prg.uAlpha, alpha);
  gl.uniform1f(prg.uGlow, glow);
  if (pass.imagingPass) {
    if (alpha > 0.5) {
      bindMesh(g.b);
      gl.uniform1f(prg.uImaging, 1);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, g.count);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    const e = edgeBuffer(g);
    bindMesh(e.b);
    gl.uniform1f(prg.uImaging, 2);
    gl.uniform3fv(prg.uWireColor, pass.wireTint);
    gl.drawArrays(gl.LINES, 0, e.count);
  } else {
    bindMesh(g.b);
    gl.uniform1f(prg.uImaging, 0);
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

export function renderSky() {
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.useProgram(skyPrg.p);
  gl.bindBuffer(gl.ARRAY_BUFFER, skyBuffer);
  for (let i = 0; i < 3; i++) gl.disableVertexAttribArray(i);
  gl.enableVertexAttribArray(skyPrg.aPos);
  gl.vertexAttribPointer(skyPrg.aPos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform3fv(skyPrg.uForward, camera.cameraForward);
  gl.uniform3fv(skyPrg.uRight, camera.cameraRight);
  gl.uniform3fv(skyPrg.uUp, camera.cameraUp);
  gl.uniform1f(skyPrg.uAspect, camera.screenW / camera.screenH);
  gl.uniform1f(skyPrg.uFov, Math.tan(camera.fov / 2));
  gl.uniform1f(skyPrg.uOffset, G.state === 'menu' ? 0 : -0.14);
  gl.uniform1f(skyPrg.uNight, G.player?.vision ? 1 : 0);
  gl.uniform1f(skyPrg.uImaging, pass.imagingPass ? 1 : 0);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.enable(gl.DEPTH_TEST);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.useProgram(prg.p);
  currentBuffer = null;
  gl.uniformMatrix4fv(prg.uVP, false, camera.viewProj);
  gl.uniform3fv(prg.uEye, camera.cameraEye);
  gl.uniform3fv(prg.uFog, [0.56, 0.43, 0.35]);
  gl.uniform1f(prg.uNight, G.player?.vision ? 1 : 0);
  gl.disable(gl.CULL_FACE);
}
