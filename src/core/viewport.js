/**
 * Canvas sizing and the camera basis.
 */
import { DEG, M } from './math.js';
import { ctx, gl, hud, world } from './gl.js';
import { settings } from './settings.js';

/**
 * Viewport size and the camera basis, rebuilt every frame by renderWorld().
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

export function resize() {
  camera.screenW = innerWidth;
  camera.screenH = innerHeight;
  const width =
    settings.quality === 'sharp'
      ? Math.min(1920, camera.screenW * (devicePixelRatio || 1))
      : Math.min(camera.screenW, settings.quality === 'retro' ? 640 : 960);
  world.width = Math.round(width);
  world.height = Math.round((width * camera.screenH) / camera.screenW);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  hud.width = Math.round(camera.screenW * dpr);
  hud.height = Math.round(camera.screenH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  gl.viewport(0, 0, world.width, world.height);
}

window.addEventListener('resize', resize);

resize();
