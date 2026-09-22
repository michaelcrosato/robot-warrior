/**
 * The lighting environment: one sun, a sky hemisphere, fog, and a small pool of dynamic
 * lights for things that flash.
 *
 * The original had two of these disagreeing with each other — the sky painted its sun at
 * `(-0.55, 0.24, -0.85)` while the scene shaded against `(-0.55, 0.8, 0.3)`, which nobody
 * could see because nothing cast a shadow. With cascades that mismatch becomes obvious
 * immediately: shadows fall away from a sun that is somewhere else. There is now one
 * direction and everything reads it.
 */
import { norm } from './math.js';
import { MAX_POINT_LIGHTS } from './shaders/scene.js';

/**
 * Direction *towards* the sun.
 *
 * Low in the sky — about 18 degrees — which is where the long shadows this art style wants
 * come from. Lower still looked better in stills and turned every cascade into a smear in
 * motion, so this is the compromise.
 */
export const SUN_DIR = norm([-0.55, 0.32, -0.85]);

/**
 * Radiance of the sun.
 *
 * The ratio between this and the ambient terms below is what decides whether shadows are
 * visible at all, and it is easy to get wrong. The sun sits 18 degrees up, so a flat piece
 * of ground receives only about a third of its output — if sky ambient is anywhere near
 * the same magnitude, a shadowed patch is barely darker than a lit one and the cascades
 * look broken when they are working perfectly. Roughly 4:1 direct to ambient, which is
 * also about right for a clear sky.
 */
export const SUN_COLOR = [7.6, 6.15, 4.85];

/** Upper hemisphere: the sky. */
export const SKY_COLOR = [0.155, 0.196, 0.268];

/** Lower hemisphere: light bounced off the basin floor. Warm, because the ground is. */
export const GROUND_COLOR = [0.098, 0.072, 0.053];

/** Distance fog, matched to the sky's dust term so the horizon dissolves rather than ends. */
export const FOG_COLOR = [0.42, 0.315, 0.25];

/** x: density, y: height falloff. Thicker in the basin than up on the ridge. */
export const FOG_PARAMS = [1.55e-7, 0.0065];

/** Where the moon sits. Purely decorative; it casts nothing. */
export const MOON_DIR = norm([0.49, 0.4, -1]);

/**
 * Dynamic point lights for the current frame.
 *
 * Muzzle flashes, tracers in flight, explosions and the reactor glow. The budget is small
 * and fixed, so when more want to exist than there is room for, the brightest and nearest
 * win — a distant flash contributing a fraction of a pixel is the right thing to drop.
 *
 * @type {{x: number, y: number, z: number, r: number, g: number, b: number, radius: number, weight: number}[]}
 */
const pending = [];

/** Clear the pool. Called once at the top of each frame. */
export function beginLightFrame() {
  pending.length = 0;
}

/**
 * Offer a light for this frame.
 *
 * @param {number[]} position world position
 * @param {number[]} color    linear rgb, pre-multiplied by intensity
 * @param {number} radius     distance at which it contributes nothing
 * @param {number} [priority] tie-breaker; higher survives culling
 */
export function addPointLight(position, color, radius, priority = 1) {
  const intensity = Math.max(color[0], Math.max(color[1], color[2]));
  if (intensity <= 0.001 || radius <= 0.01) return;
  pending.push({
    x: position[0],
    y: position[1],
    z: position[2],
    r: color[0],
    g: color[1],
    b: color[2],
    radius,
    weight: intensity * priority,
  });
}

const positionBuffer = new Float32Array(MAX_POINT_LIGHTS * 3);
const colorBuffer = new Float32Array(MAX_POINT_LIGHTS * 4);

/**
 * Resolve the frame's lights into the flat arrays the scene program wants.
 *
 * Ranking is by apparent brightness at the camera rather than raw intensity, so a small
 * flash at the player's feet outranks a large one across the map.
 *
 * @param {number[]} eye camera position
 */
export function resolveLights(eye) {
  if (pending.length > MAX_POINT_LIGHTS) {
    for (const light of pending) {
      const dx = light.x - eye[0];
      const dy = light.y - eye[1];
      const dz = light.z - eye[2];
      light.weight /= 1 + (dx * dx + dy * dy + dz * dz) * 0.0004;
    }
    pending.sort((a, b) => b.weight - a.weight);
    pending.length = MAX_POINT_LIGHTS;
  }

  for (let i = 0; i < pending.length; i++) {
    const l = pending[i];
    positionBuffer[i * 3] = l.x;
    positionBuffer[i * 3 + 1] = l.y;
    positionBuffer[i * 3 + 2] = l.z;
    colorBuffer[i * 4] = l.r;
    colorBuffer[i * 4 + 1] = l.g;
    colorBuffer[i * 4 + 2] = l.b;
    colorBuffer[i * 4 + 3] = l.radius;
  }

  return { count: pending.length, positions: positionBuffer, colors: colorBuffer };
}

/**
 * Material presets.
 *
 * Packed as (roughness, metalness, detail, rim) to match `uMaterial` in the scene shader.
 * The geometry carries no texture coordinates, so material is chosen per draw by what the
 * thing *is* rather than sampled — which is the whole reason this list is short.
 */
export const MATERIAL = {
  /** Terrain and baked scenery: rough, no metal, full surface detail, no rim. */
  terrain: [0.94, 0.0, 1.0, 0.0],
  /** Painted armour plate. Slightly metallic so the sun catches an edge. */
  armor: [0.52, 0.28, 0.35, 0.1],
  /** Bare structural metal, joints, weapon barrels. */
  metal: [0.34, 0.85, 0.15, 0.14],
  /** Anything emissive; lighting is bypassed but the values must still be valid. */
  emissive: [0.6, 0.0, 0.0, 0.0],
};
