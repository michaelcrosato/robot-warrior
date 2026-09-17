/**
 * The two canvases, the WebGL 2 context, and what the hardware can actually do.
 */
import { $ } from './dom.js';

export const world = $('world');

export const hud = $('hud');

export const ctx = hud.getContext('2d');

/**
 * WebGL 2 is required.
 *
 * The renderer uses vertex array objects, texture arrays for cascaded shadow maps,
 * floating-point render targets and GLSL ES 3.00 throughout. Emulating any of that on
 * WebGL 1 would mean a second pipeline to keep in step, and the devices that would need
 * it cannot run the lighting anyway.
 *
 * `antialias` is off deliberately: the scene is rendered to an off-screen HDR target and
 * resolved with FXAA after tone mapping, so a multisampled default framebuffer would cost
 * memory bandwidth for nothing.
 */
export const gl = world.getContext('webgl2', {
  antialias: false,
  alpha: false,
  depth: true,
  stencil: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
  desynchronized: true,
});

if (!gl) {
  $('loading').hidden = true;
  $('error').className = 'on';
  $('error').textContent = world.getContext('webgl')
    ? 'This build needs WebGL 2. Your browser reports only WebGL 1 — update it, or enable hardware acceleration, and open this page again.'
    : 'WebGL is not available. Enable hardware acceleration in your browser, then open this page again.';
  throw Error('WebGL 2 not available');
}

/** Renderer string, where the driver is willing to say. Used only to pick a quality tier. */
function rendererName() {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '');
    return String(gl.getParameter(gl.RENDERER) || '');
  } catch {
    return '';
  }
}

/**
 * What this device supports, probed once.
 *
 * Every entry is something the renderer degrades around rather than assumes. Float render
 * targets in particular are not universal: without them the HDR path falls back to an
 * 8-bit target and tone mapping runs on a clamped range.
 */
export const caps = Object.freeze({
  renderer: rendererName(),
  /** Needed to render into RGBA16F — the HDR scene target and the bloom chain. */
  colorBufferFloat: !!gl.getExtension('EXT_color_buffer_float'),
  /** Needed to filter RGBA16F. Without it the bloom chain must use NEAREST. */
  floatLinear: !!gl.getExtension('OES_texture_float_linear'),
  /** Anisotropic filtering, when there is anything worth filtering. */
  anisotropic: gl.getExtension('EXT_texture_filter_anisotropic'),
  maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  maxTextureUnits: gl.getParameter(gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS),
  maxArrayLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS),
  maxSamples: gl.getParameter(gl.MAX_SAMPLES),
  /** Reported by the browser, not the GPU; used only as one signal among several. */
  deviceMemory: navigator.deviceMemory || 0,
  hardwareConcurrency: navigator.hardwareConcurrency || 0,
  /** True when the primary pointer has no hover — a phone or tablet rather than a laptop. */
  coarsePointer:
    typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches,
  maxTouchPoints: navigator.maxTouchPoints || 0,
});

/** Anisotropy level to request, or 0 when the extension is missing. */
export const maxAnisotropy = caps.anisotropic
  ? gl.getParameter(caps.anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT)
  : 0;
