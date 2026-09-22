/**
 * Off-screen render targets: the HDR scene buffer, the shadow cascade array, the bloom
 * mip chain and the ambient-occlusion buffers.
 *
 * All of them are rebuilt together whenever the canvas size or the quality tier changes,
 * because a stale target is the kind of bug that shows up as a smear on one device and
 * nothing anywhere else.
 */
import { gl, caps } from './gl.js';

/** True when RGBA16F can actually be rendered into on this device. */
const hdrSupported = caps.colorBufferFloat;

/** The colour format used for the scene and bloom targets. */
const COLOR_INTERNAL = hdrSupported ? gl.RGBA16F : gl.RGBA8;
const COLOR_TYPE = hdrSupported ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

/**
 * RGBA16F can always be *sampled* with linear filtering in WebGL 2, but on some drivers
 * only when OES_texture_float_linear is present. The bloom chain depends on bilinear
 * upsampling, so fall back to nearest rather than render something subtly wrong.
 */
const COLOR_FILTER = !hdrSupported || caps.floatLinear ? gl.LINEAR : gl.NEAREST;

/** @typedef {{fb: WebGLFramebuffer, tex: WebGLTexture, depth: WebGLTexture|null, w: number, h: number}} Target */

/**
 * Create a colour target, optionally with a sampleable depth texture.
 *
 * @param {number} w
 * @param {number} h
 * @param {{depth?: boolean, filter?: number, internal?: number, type?: number}} [options]
 * @returns {Target}
 */
export function createTarget(w, h, options = {}) {
  const width = Math.max(1, Math.round(w));
  const height = Math.max(1, Math.round(h));
  const filter = options.filter ?? COLOR_FILTER;

  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    options.internal ?? COLOR_INTERNAL,
    width,
    height,
    0,
    gl.RGBA,
    options.type ?? COLOR_TYPE,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  let depth = null;
  if (options.depth) {
    // A depth *texture* rather than a renderbuffer: ambient occlusion reads it back.
    depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, depth);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.DEPTH_COMPONENT24,
      width,
      height,
      0,
      gl.DEPTH_COMPONENT,
      gl.UNSIGNED_INT,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  }

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw Error(`framebuffer ${width}x${height} incomplete: 0x${status.toString(16)}`);
  }

  return { fb, tex, depth, w: width, h: height };
}

/**
 * The shadow cascades: one depth texture array, one layer per cascade.
 *
 * Set up for hardware comparison sampling, so `sampler2DArrayShadow` in the scene shader
 * gets a free 2x2 percentage-closer filter on every tap.
 *
 * @param {number} size
 * @param {number} layers
 */
export function createShadowArray(size, layers) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texImage3D(
    gl.TEXTURE_2D_ARRAY,
    0,
    gl.DEPTH_COMPONENT24,
    size,
    size,
    Math.max(1, layers),
    0,
    gl.DEPTH_COMPONENT,
    gl.UNSIGNED_INT,
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

  // One framebuffer per layer, so a cascade can be bound without re-attaching.
  const framebuffers = [];
  for (let i = 0; i < layers; i++) {
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, tex, 0, i);
    // Depth-only: without this the framebuffer is incomplete on desktop GL.
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      throw Error(`shadow cascade ${i} incomplete: 0x${status.toString(16)}`);
    }
    framebuffers.push(fb);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { tex, framebuffers, size, layers };
}

/** Release one target. Called before rebuilding at a new size. */
export function disposeTarget(target) {
  if (!target) return;
  gl.deleteFramebuffer(target.fb);
  gl.deleteTexture(target.tex);
  if (target.depth) gl.deleteTexture(target.depth);
}

export function disposeShadowArray(shadow) {
  if (!shadow) return;
  gl.deleteTexture(shadow.tex);
  for (const fb of shadow.framebuffers) gl.deleteFramebuffer(fb);
}

/** Bind a target and set the viewport to match it. `null` means the canvas. */
export function bindTarget(target, width, height) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
  gl.viewport(0, 0, target ? target.w : width, target ? target.h : height);
}
