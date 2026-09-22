/** The mobile sight keeps the world clear; readable instruments live in the touch layer. */
import { G } from '../sim/state.js';
import { camera } from '../core/viewport.js';
import { project } from '../core/renderer.js';
import { center } from '../entities/draw.js';
import { corners, hudAmber, hudColor, ln, rect } from './primitives.js';

export function drawMobileHUD() {
  const cx = camera.screenW * 0.5;
  // Matches the off-axis projection in renderWorld, just like the desktop sight.
  const cy = camera.screenH * 0.43;
  for (const side of [-1, 1]) {
    ln(cx + side * 10, cy, cx + side * 22, cy, hudColor, 2);
    ln(cx, cy + side * 10, cx, cy + side * 22, hudColor, 2);
  }
  rect(cx - 1, cy - 1, 2, 2, hudAmber);
  if (G.target?.alive) {
    const p = project(center(G.target));
    if (p && p.x > 28 && p.x < camera.screenW - 28 && p.y > 105 && p.y < camera.screenH * 0.63)
      corners(p.x, p.y, 48, 54, G.lock >= 1 ? hudAmber : '#f9b393', 10);
  }
}
