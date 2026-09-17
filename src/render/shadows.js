/**
 * Cascaded shadow maps.
 *
 * The view frustum is split into slices by depth; each slice gets its own orthographic
 * projection from the sun, rendered into one layer of a depth texture array. Near the
 * camera the cascade covers a few dozen metres at full resolution; the last one covers
 * most of a sector.
 *
 * Two details do the heavy lifting, and both exist to stop the shadows crawling:
 *
 *   A bounding *sphere* per slice rather than a bounding box. A box fitted to the frustum
 *   corners changes size as the camera turns, so every shadow edge shimmers during a
 *   torso twist — which in this game is most of the time. A sphere is rotation-invariant.
 *
 *   Texel snapping. The projection centre is quantised to whole shadow-map texels, so
 *   walking forward slides the map in texel steps instead of sub-texel ones. Without it
 *   the edges boil even when nothing in the scene is moving.
 */
import { M, norm, vadd, vmul, cross, dot } from '../core/math.js';
import { SUN_DIR } from '../core/lighting.js';

/** Practical split scheme: a blend of logarithmic and uniform distribution. */
const SPLIT_LAMBDA = 0.72;

/**
 * How far behind a cascade the light frustum reaches.
 *
 * A structure standing outside the slice but between it and the sun must still cast into
 * it. The tallest thing in the world is the uplink mast at roughly 90 metres, so 600 is
 * generous without wasting depth precision.
 */
const CASTER_EXTRUSION = 600;

/** @type {Float32Array[]} */
const matrices = [
  new Float32Array(16),
  new Float32Array(16),
  new Float32Array(16),
  new Float32Array(16),
];

const splits = new Float32Array(4);

/** World units covered by one shadow texel, per cascade. Drives the shader's bias. */
const texelWorld = new Float32Array(4);

/**
 * Compute the light-space matrix for every cascade.
 *
 * @param {import('../core/viewport.js').Camera} camera the shared viewport state
 * @param {number} cascadeCount
 * @param {number} shadowSize    resolution of one cascade, square
 * @param {number} maxDistance   how far from the camera shadows are wanted
 * @returns {{matrices: Float32Array[], splits: Float32Array, texelWorld: Float32Array, count: number}}
 */
export function updateCascades(camera, cascadeCount, shadowSize, maxDistance) {
  const count = Math.max(0, Math.min(4, cascadeCount));
  if (!count) return { matrices, splits, texelWorld, count: 0 };

  const near = 0.5;
  const far = maxDistance;
  const aspect = camera.screenW / Math.max(camera.screenH, 1);
  const tanHalf = Math.tan(camera.fov / 2);

  const eye = camera.cameraEye;
  const forward = camera.cameraForward;
  const right = camera.cameraRight;
  const up = camera.cameraUp;

  // Sun basis. The up vector must not be parallel to the sun direction, and the sun here
  // is low, so world up is always a safe choice.
  const lightDir = norm(SUN_DIR);
  let lightUp = [0, 1, 0];
  if (Math.abs(dot(lightDir, lightUp)) > 0.98) lightUp = [0, 0, 1];
  const lightRight = norm(cross(lightUp, lightDir));
  lightUp = cross(lightDir, lightRight);

  let sliceNear = near;
  for (let i = 0; i < count; i++) {
    const ratio = (i + 1) / count;
    const logSplit = near * Math.pow(far / near, ratio);
    const uniformSplit = near + (far - near) * ratio;
    const sliceFar = SPLIT_LAMBDA * logSplit + (1 - SPLIT_LAMBDA) * uniformSplit;
    splits[i] = sliceFar;

    // Frustum corners for this slice, straight from the camera basis. Cheaper and less
    // error-prone than inverting the view-projection and transforming a unit cube.
    const corners = [];
    for (const d of [sliceNear, sliceFar]) {
      const centre = vadd(eye, vmul(forward, d));
      const h = tanHalf * d;
      const w = h * aspect;
      for (const sy of [-1, 1]) {
        for (const sx of [-1, 1]) {
          corners.push(vadd(centre, vadd(vmul(right, w * sx), vmul(up, h * sy))));
        }
      }
    }

    // Bounding sphere of the slice.
    let cx = 0,
      cy = 0,
      cz = 0;
    for (const c of corners) {
      cx += c[0];
      cy += c[1];
      cz += c[2];
    }
    const centre = [cx / corners.length, cy / corners.length, cz / corners.length];
    let radius = 0;
    for (const c of corners) {
      const dx = c[0] - centre[0],
        dy = c[1] - centre[1],
        dz = c[2] - centre[2];
      radius = Math.max(radius, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    // Round up so a fractional change in radius does not resize the projection every frame.
    radius = Math.ceil(radius * 16) / 16;

    // Snap the centre to whole texels, measured along the light's own axes.
    const texelsPerUnit = shadowSize / (radius * 2);
    texelWorld[i] = 1 / texelsPerUnit;
    const lx = Math.round(dot(centre, lightRight) * texelsPerUnit) / texelsPerUnit;
    const ly = Math.round(dot(centre, lightUp) * texelsPerUnit) / texelsPerUnit;
    const lz = dot(centre, lightDir);
    const snapped = vadd(vadd(vmul(lightRight, lx), vmul(lightUp, ly)), vmul(lightDir, lz));

    const eyeDistance = radius + CASTER_EXTRUSION;
    const lightEye = vadd(snapped, vmul(lightDir, eyeDistance));
    const view = M.view(lightEye, snapped);
    const projection = M.ortho(-radius, radius, -radius, radius, 1, eyeDistance + radius);

    matrices[i].set(M.mul(projection, view));
    sliceNear = sliceFar;
  }

  // Unused cascades keep the last split so the shader's fade maths stays monotonic.
  for (let i = count; i < 4; i++) {
    splits[i] = splits[count - 1];
    texelWorld[i] = texelWorld[count - 1];
  }

  return { matrices, splits, texelWorld, count };
}

/** The split distances of the most recent update, for the scene shader. */
export function cascadeSplits() {
  return splits;
}
