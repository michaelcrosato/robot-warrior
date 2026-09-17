/**
 * The two canvases and the WebGL context, with the unsupported-hardware path.
 */
import { $ } from './dom.js';

export const world = $('world');

export const hud = $('hud');

export const ctx = hud.getContext('2d');

export const gl = world.getContext('webgl', {
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
});

if (!gl) {
  $('loading').hidden = true;
  $('error').className = 'on';
  $('error').textContent =
    'WebGL is not available. Enable hardware acceleration in your browser, then open this file again.';
  throw Error('WebGL not available');
}
