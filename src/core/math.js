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
