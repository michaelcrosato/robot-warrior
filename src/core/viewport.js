/**
 * Canvas sizing and the camera basis.
 */
import { DEG, M } from './math.js';
import { ctx, gl, hud, world } from './gl.js';
import { activeTier } from './quality.js';

/**
 * @typedef {object} Camera
 * @property {number} screenW        CSS pixels
 * @property {number} screenH
 * @property {Float32Array} viewProj
 * @property {number[]} cameraEye
 * @property {number[]} cameraForward
 * @property {number[]} cameraRight
 * @property {number[]} cameraUp
 * @property {number} fov            radians, vertical
 */

/**
 * Viewport size and the camera basis, rebuilt every frame by renderWorld().
 * @type {Camera}
 */
export const camera = {
  screenW: innerWidth,
  screenH: innerHeight,
  viewProj: M.identity(),
  cameraEye: [0, 20, 60],
  cameraForward: [0, 0, -1],
  cameraRight: [1, 0, 0],
  cameraUp: [0, 1, 0],
  fov: 62 * DEG,
};

/**
 * Size both canvases and rebuild every render target to match.
 *
 * The world canvas renders at the quality tier's internal resolution and is stretched to
 * fill by CSS; the HUD canvas always matches device pixels, because text and instrument
 * lines drawn at a lower resolution and scaled up look broken in a way the 3D view does
 * not. Capping the HUD at 2x keeps a phone with a 3x display from paying for a canvas
 * nobody can resolve.
 */
export function resize() {
  camera.screenW = innerWidth;
  camera.screenH = innerHeight;

  const tier = activeTier();
  const dpr = devicePixelRatio || 1;
  const width = Math.min(tier.maxWidth, camera.screenW * dpr * tier.renderScale);

  world.width = Math.max(2, Math.round(width));
  world.height = Math.max(2, Math.round((width * camera.screenH) / camera.screenW));

  const hudDpr = Math.min(dpr, 2);
  hud.width = Math.round(camera.screenW * hudDpr);
  hud.height = Math.round(camera.screenH * hudDpr);
  ctx.setTransform(hudDpr, 0, 0, hudDpr, 0, 0);

  gl.viewport(0, 0, world.width, world.height);
  // Render targets are not rebuilt here. renderWorld() allocates from the canvas size at
  // the top of every frame and returns immediately when nothing changed, which keeps
  // viewport.js free of a dependency on the pipeline — and the pipeline needs the camera
  // this module owns, so the two would otherwise import each other.
}

window.addEventListener('resize', resize);

resize();
