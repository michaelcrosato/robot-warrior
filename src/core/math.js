/**
 * Scalar, vector and 4x4 matrix helpers, plus the seeded generator the terrain scatter
 * and enemy AI phases are drawn from.
 */
export const TAU = Math.PI * 2;

export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const mix = (a, b, t) => a + (b - a) * t;

export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const vsub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

export const vmul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((x) => x / l);
};

let seed = 82731;

export function random() {
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  return seed / 4294967296;
}

/**
 * Rewind the generator.
 *
 * The terrain scatter in src/world/level.js draws from it at startup, and populate()
 * rewinds it again per mission so each enemy opens with the same AI phase, cooldowns and
 * strafe direction. Entity coordinates are authored rather than drawn, so they are not
 * affected — but anything new that draws here at startup shifts every later draw.
 *
 * @param {number} [value] seed to rewind to; defaults to the startup seed
 */
export function resetRandom(value = 82731) {
  seed = value;
}

export const rand = (a, b) => mix(a, b, random());

export const hex = (s) => {
  const n = parseInt(s.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const M = {
  identity: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
  mul: (a, b) => {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++)
        o[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
    return o;
  },
  transform: (p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0]) => {
    const cx = Math.cos(r[0]),
      sx = Math.sin(r[0]),
      cy = Math.cos(r[1]),
      sy = Math.sin(r[1]),
      cz = Math.cos(r[2]),
      sz = Math.sin(r[2]);
    return new Float32Array([
      (cy * cz + sy * sx * sz) * s[0],
      cx * sz * s[0],
      (-sy * cz + cy * sx * sz) * s[0],
      0,
      (-cy * sz + sy * sx * cz) * s[1],
      cx * cz * s[1],
      (sy * sz + cy * sx * cz) * s[1],
      0,
      sy * cx * s[2],
      -sx * s[2],
      cy * cx * s[2],
      0,
      ...p,
      1,
    ]);
  },
  point: (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ],
  vector: (m, p) => [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
  ],
  view: (eye, target) => {
    const z = norm(vsub(eye, target)),
      x = norm(cross([0, 1, 0], z)),
      y = cross(z, x);
    return new Float32Array([
      x[0],
      y[0],
      z[0],
      0,
      x[1],
      y[1],
      z[1],
      0,
      x[2],
      y[2],
      z[2],
      0,
      -dot(x, eye),
      -dot(y, eye),
      -dot(z, eye),
      1,
    ]);
  },
  /**
   * Orthographic projection, column-major, matching the right-handed view convention
   * `view` produces. Used for the shadow cascades, where the sun is far enough away that
   * a parallel projection is the correct model rather than an approximation.
   */
  ortho: (left, right, bottom, top, near, far) => {
    const w = right - left,
      h = top - bottom,
      d = far - near;
    return new Float32Array([
      2 / w,
      0,
      0,
      0,
      0,
      2 / h,
      0,
      0,
      0,
      0,
      -2 / d,
      0,
      -(right + left) / w,
      -(top + bottom) / h,
      -(far + near) / d,
      1,
    ]);
  },

  /**
   * General 4x4 inverse by cofactor expansion.
   *
   * Only used off the hot path — once per frame for the ambient-occlusion pass, which
   * needs to walk clip space back to view space. Returns the identity for a singular
   * matrix rather than propagating NaN through a whole frame of shading.
   */
  invert: (m) => {
    const a00 = m[0],
      a01 = m[1],
      a02 = m[2],
      a03 = m[3];
    const a10 = m[4],
      a11 = m[5],
      a12 = m[6],
      a13 = m[7];
    const a20 = m[8],
      a21 = m[9],
      a22 = m[10],
      a23 = m[11];
    const a30 = m[12],
      a31 = m[13],
      a32 = m[14],
      a33 = m[15];

    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;

    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return M.identity();
    const d = 1 / det;

    return new Float32Array([
      (a11 * b11 - a12 * b10 + a13 * b09) * d,
      (a02 * b10 - a01 * b11 - a03 * b09) * d,
      (a31 * b05 - a32 * b04 + a33 * b03) * d,
      (a22 * b04 - a21 * b05 - a23 * b03) * d,
      (a12 * b08 - a10 * b11 - a13 * b07) * d,
      (a00 * b11 - a02 * b08 + a03 * b07) * d,
      (a32 * b02 - a30 * b05 - a33 * b01) * d,
      (a20 * b05 - a22 * b02 + a23 * b01) * d,
      (a10 * b10 - a11 * b08 + a13 * b06) * d,
      (a01 * b08 - a00 * b10 - a03 * b06) * d,
      (a30 * b04 - a31 * b02 + a33 * b00) * d,
      (a21 * b02 - a20 * b04 - a23 * b00) * d,
      (a11 * b07 - a10 * b09 - a12 * b06) * d,
      (a00 * b09 - a01 * b07 + a02 * b06) * d,
      (a31 * b01 - a30 * b03 - a32 * b00) * d,
      (a20 * b03 - a21 * b01 + a22 * b00) * d,
    ]);
  },

  /**
   * Inverse-transpose of a model matrix's upper 3x3, as a mat3.
   *
   * Parts in this model set are scaled non-uniformly everywhere, and transforming a normal
   * by the model matrix directly skews it — visible as lighting that slides across a leg
   * as it stretches. Computed per draw, which is cheap next to the draw call itself.
   */
  /**
   * A surface normal carried through a transform: multiplied by a normal matrix from
   * normalMatrix() and renormalised. The model matrix itself is wrong for this whenever the
   * scale is not uniform — it tips a normal toward the stretched axis.
   */
  transformNormal: (nm, n) =>
    norm([
      nm[0] * n[0] + nm[3] * n[1] + nm[6] * n[2],
      nm[1] * n[0] + nm[4] * n[1] + nm[7] * n[2],
      nm[2] * n[0] + nm[5] * n[1] + nm[8] * n[2],
    ]),
  /** The inverse transpose of m's upper 3x3, column-major; written into `out` if given. */
  normalMatrix: (m, out = new Float32Array(9)) => {
    const a = m[0],
      b = m[1],
      c = m[2];
    const d = m[4],
      e = m[5],
      f = m[6];
    const g = m[8],
      h = m[9],
      i = m[10];
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if (!det) {
      out.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      return out;
    }
    const k = 1 / det;
    // Cofactor matrix, already transposed twice — i.e. the inverse transpose.
    out.set([
      (e * i - f * h) * k,
      (f * g - d * i) * k,
      (d * h - e * g) * k,
      (c * h - b * i) * k,
      (a * i - c * g) * k,
      (b * g - a * h) * k,
      (b * f - c * e) * k,
      (c * d - a * f) * k,
      (a * e - b * d) * k,
    ]);
    return out;
  },

  perspective: (fov, asp, near, far, offset = 0) => {
    const f = 1 / Math.tan(fov / 2);
    return new Float32Array([
      f / asp,
      0,
      0,
      0,
      0,
      f,
      0,
      0,
      0,
      offset,
      (far + near) / (near - far),
      -1,
      0,
      0,
      (2 * far * near) / (near - far),
      0,
    ]);
  },
};

/**
 * Where a ray first meets an upright cylinder — the shape of every rock and building in
 * the cover test — as a distance along the ray, or Infinity for a miss.
 *
 * The side is tested at the entry point only, against the cylinder's height; the caps are
 * not modelled, which is fine for cover that stands on the ground.
 *
 * Two callers want different answers near the cylinder. A shooter's ray ignores anything
 * closer than `minDistance` (one unit), so a muzzle pressed against a rock face does not
 * block its own line of fire. A projectile's step must instead count cover from where it
 * is, and must count the case where it is already inside: the entry point is then behind
 * it, and rejecting that is how shots used to pass straight through rocks whenever the
 * step was short, i.e. on high refresh-rate monitors.
 *
 * @param {number[]} origin
 * @param {number[]} dir          unit direction
 * @param {{x: number, z: number, r: number, h: number}} o   cylinder centre, radius, height
 * @param {number} base           ground height under the cylinder
 * @param {number} [minDistance]  entries closer than this are ignored
 * @param {boolean} [fromInside]  an origin inside the cylinder counts as a hit at 0
 */
export function rayCylinder(origin, dir, o, base, minDistance = 1, fromInside = false) {
  const ox = origin[0] - o.x,
    oz = origin[2] - o.z,
    c = ox * ox + oz * oz - o.r * o.r;
  if (fromInside && c < 0 && origin[1] > base && origin[1] < base + o.h) return 0;
  const b = ox * dir[0] + oz * dir[2],
    a = dir[0] * dir[0] + dir[2] * dir[2],
    disc = b * b - a * c;
  if (disc <= 0 || a <= 0.00001) return Infinity;
  const u = (-b - Math.sqrt(disc)) / a,
    y = origin[1] + dir[1] * u;
  return u > minDistance && y > base && y < base + o.h ? u : Infinity;
}
