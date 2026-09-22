/**
 * Shader compilation and the linked programs.
 *
 * Uniform locations are discovered by querying the linked program rather
 * than being listed by hand. That matters with this many programs: a uniform the compiler
 * optimises away silently returns null from `getUniformLocation`, and a hand-written list
 * hides which ones actually survived.
 */
import { gl } from './gl.js';
import { SCENE_VS, SCENE_FS, SHADOW_VS, SHADOW_FS } from './shaders/scene.js';
import { SKY_VS, SKY_FS } from './shaders/sky.js';
import {
  FULLSCREEN_VS,
  BLOOM_DOWN_FS,
  BLOOM_UP_FS,
  SSAO_FS,
  SSAO_BLUR_FS,
  COMPOSITE_FS,
} from './shaders/post.js';

/**
 * Compile one stage, reporting the offending line with its neighbours.
 *
 * A raw driver log gives `ERROR: 0:214:` and nothing else, and these shaders are
 * assembled from several chunks, so 214 is not a line in any file anyone can open.
 */
function compile(type, source, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;

  const log = gl.getShaderInfoLog(s) || '';
  const lines = source.split('\n');
  const context = [];
  for (const match of log.matchAll(/ERROR:\s*\d+:(\d+)/g)) {
    const n = Number(match[1]);
    for (let i = Math.max(1, n - 3); i <= Math.min(lines.length, n + 3); i++) {
      context.push(`${i === n ? '>' : ' '} ${String(i).padStart(4)} | ${lines[i - 1]}`);
    }
    context.push('');
  }
  gl.deleteShader(s);
  throw Error(
    `${label} ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader failed to compile\n` +
      log +
      (context.length ? '\n' + context.join('\n') : ''),
  );
}

/**
 * Link a program and return it with every active uniform resolved.
 *
 * @param {string} label   used in error messages
 * @param {string} vs
 * @param {string} fs
 * @returns {{p: WebGLProgram, [key: string]: any}}
 */
function program(label, vs, fs) {
  const p = gl.createProgram();
  const v = compile(gl.VERTEX_SHADER, vs, label);
  const f = compile(gl.FRAGMENT_SHADER, fs, label);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  // Pin the vertex layout across every program that consumes mesh data, so one vertex
  // array object per mesh serves both the lit scene pass and the depth-only shadow pass.
  // Without this the linker is free to assign different locations to `aPos` in each, and
  // a VAO built for one silently feeds garbage to the other.
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.bindAttribLocation(p, 1, 'aNormal');
  gl.bindAttribLocation(p, 2, 'aColor');
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw Error(`${label} program failed to link\n` + gl.getProgramInfoLog(p));
  }

  const o = { p };
  const uniformCount = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniformCount; i++) {
    const info = gl.getActiveUniform(p, i);
    if (!info) continue;
    // An array uniform reports as `uPointPos[0]`; store it under the bare name too so
    // call sites do not have to know whether something happens to be an array.
    const bare = info.name.replace(/\[0\]$/, '');
    o[info.name] = gl.getUniformLocation(p, info.name);
    if (bare !== info.name) o[bare] = o[info.name];
  }
  return o;
}

/** Solid geometry, lit. */
export const scenePrg = program('scene', SCENE_VS, SCENE_FS);

/** Depth-only, one run per shadow cascade. */
export const shadowPrg = program('shadow', SHADOW_VS, SHADOW_FS);

/** Procedural sky at the far plane. */
export const skyPrg = program('sky', SKY_VS, SKY_FS);

/** Post chain. */
export const bloomDownPrg = program('bloom-down', FULLSCREEN_VS, BLOOM_DOWN_FS);
export const bloomUpPrg = program('bloom-up', FULLSCREEN_VS, BLOOM_UP_FS);
export const ssaoPrg = program('ssao', FULLSCREEN_VS, SSAO_FS);
export const ssaoBlurPrg = program('ssao-blur', FULLSCREEN_VS, SSAO_BLUR_FS);
export const compositePrg = program('composite', FULLSCREEN_VS, COMPOSITE_FS);

/**
 * A screen-filling quad, shared by the sky and every post pass.
 *
 * Two triangles rather than the single oversized triangle trick: the sky shader reads
 * `vUV` as a direction basis and an oversized triangle would extrapolate it past the
 * screen edges.
 */
const quadBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
  gl.STATIC_DRAW,
);

/** VAO for the fullscreen quad, so post passes do not re-specify attributes each time. */
export const quadVao = gl.createVertexArray();
gl.bindVertexArray(quadVao);
gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
gl.enableVertexAttribArray(0);
gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
gl.bindVertexArray(null);

/**
 * Draw the fullscreen quad with a program whose `aPos` is at location 0.
 *
 * Every post program declares `in vec2 aPos;` first, so the linker gives it location 0
 * and one VAO serves them all.
 */
export function drawFullscreen() {
  gl.bindVertexArray(quadVao);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindVertexArray(null);
}
