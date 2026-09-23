/**
 * Terrain height field. Pure: the same (x, z) always returns the same height.
 */
import { clamp, mix } from '../core/math.js';

/** The rolling ground before any flattening, including the rise onto Blackglass Ridge. */
function raw(a, b) {
  let rise = clamp((-b - 2540) / 550, 0, 1);
  rise = rise * rise * (3 - 2 * rise);
  return (
    Math.sin(a * 0.006 + b * 0.003) * 2.8 +
    Math.cos(b * 0.008 - a * 0.001) * 1.9 +
    Math.sin(a * 0.021 + b * 0.016) * 0.4 +
    rise * 23
  );
}

/**
 * Pads flattened for sites — x, z, flat radius — each with the height it is flattened to.
 *
 * Worked out once rather than per call: terrainY runs for every obstacle in every cover
 * test, every actor move and every projectile step, and it used to rebuild this table and
 * recompute all eight pad heights each time. The arithmetic per call is unchanged, so every
 * height is bit-for-bit what it was — which the parity suite depends on, because structure
 * positions are derived from it.
 */
const PADS = [
  [190, -960, 57],
  [260, -2380, 58],
  [65, -2110, 78],
  [-105, -1870, 32],
  [240, -1950, 32],
  [220, -3830, 62],
  [100, -3490, 105],
  [-115, -3230, 45],
].map(([px, pz, flat]) => ({ px, pz, flat, height: raw(px, pz) }));

export function terrainY(x, z) {
  let y = raw(x, z);
  for (const p of PADS) {
    let blend = clamp((Math.hypot(x - p.px, z - p.pz) - p.flat) / 48, 0, 1);
    blend = blend * blend * (3 - 2 * blend);
    y = mix(p.height, y, blend);
  }
  return y;
}
