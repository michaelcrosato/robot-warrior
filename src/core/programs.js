/**
 * Shader compilation and the linked programs.
 */
import { FS, SKYFS, SKYVS, VS } from './shaders.js';
import { gl } from './gl.js';

function shader(type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
  return s;
}

function program(vs, fs, attributes, uniforms) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
  const o = { p };
  for (const a of attributes) o[a] = gl.getAttribLocation(p, a);
  for (const u of uniforms) o[u] = gl.getUniformLocation(p, u);
  return o;
}

export const prg = program(
  VS,
  FS,
  ['aPos', 'aNormal', 'aColor'],
  [
    'uModel',
    'uVP',
    'uEye',
    'uColor',
    'uFog',
    'uAlpha',
    'uGlow',
    'uNight',
    'uImaging',
    'uWireColor',
  ],
);

export const skyPrg = program(
  SKYVS,
  SKYFS,
  ['aPos'],
  ['uForward', 'uRight', 'uUp', 'uAspect', 'uFov', 'uOffset', 'uNight', 'uImaging'],
);

export const skyBuffer = gl.createBuffer();

gl.bindBuffer(gl.ARRAY_BUFFER, skyBuffer);

gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
  gl.STATIC_DRAW,
);
