/**
 * Collision and actor movement.
 */
import { G } from './state.js';
import { clamp } from '../core/math.js';
import { pools } from '../entities/pools.js';
import { ridgeGate } from '../world/sites.js';
import { ridgeGateLocked } from '../entities/spawn.js';
import { solidObstacles } from '../world/level.js';
import { terrainY } from '../world/terrain.js';

export function collides(x, z, alt = 0, radius = 5) {
  if (
    typeof G.missionFlags !== 'undefined' &&
    ridgeGateLocked() &&
    alt < ridgeGate.height &&
    Math.abs(z - ridgeGate.z) < 3 + radius &&
    Math.abs(x - ridgeGate.x) < ridgeGate.width / 2 + radius
  )
    return true;
  for (const o of solidObstacles) {
    if (alt < o.h && Math.hypot(x - o.x, z - o.z) < o.r + radius) return true;
  }
  for (const e of pools.entities) {
    if (!e.alive || e.type === 'mech') continue;
    if (
      alt < (e.collisionHeight ?? (e.type === 'turret' ? 5 : e.type === 'reactor' ? 45 : 16)) &&
      Math.hypot(x - e.x, z - e.z) <
        (e.collisionRadius ??
          (e.type === 'uplink'
            ? 29
            : e.type === 'tower'
              ? 17
              : e.type === 'reactor'
                ? 33
                : e.type === 'generator'
                  ? 17
                  : 6)) +
          radius
    )
      return true;
  }
  return false;
}

export function moveActor(e, dx, dz, alt = 0, r = 5) {
  if (!collides(e.x + dx, e.z + dz, alt, r)) {
    e.x += dx;
    e.z += dz;
  } else if (!collides(e.x + dx, e.z, alt, r)) e.x += dx;
  else if (!collides(e.x, e.z + dz, alt, r)) e.z += dz;
  else return false;
  e.x = clamp(e.x, -640, 640);
  e.z = clamp(e.z, -3990, 430);
  e.y = terrainY(e.x, e.z);
  return true;
}
