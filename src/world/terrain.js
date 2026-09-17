/**
 * Terrain height field. Pure: the same (x, z) always returns the same height.
 */
import { clamp, mix } from '../core/math.js';

export function terrainY(x, z) {
  const raw = (a, b) => {
    let rise = clamp((-b - 2540) / 550, 0, 1);
    rise = rise * rise * (3 - 2 * rise);
    return (
      Math.sin(a * 0.006 + b * 0.003) * 2.8 +
      Math.cos(b * 0.008 - a * 0.001) * 1.9 +
      Math.sin(a * 0.021 + b * 0.016) * 0.4 +
      rise * 23
    );
  };
  let y = raw(x, z);
  for (const p of [
    [190, -960, 57],
    [260, -2380, 58],
    [65, -2110, 78],
    [-105, -1870, 32],
    [240, -1950, 32],
    [220, -3830, 62],
    [100, -3490, 105],
    [-115, -3230, 45],
  ]) {
    let blend = clamp((Math.hypot(x - p[0], z - p[1]) - p[2]) / 48, 0, 1);
    blend = blend * blend * (3 - 2 * blend);
    y = mix(raw(p[0], p[1]), y, blend);
  }
  return y;
}
