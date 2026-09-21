/**
 * Procedural geometry: every mesh in the game is generated here rather than loaded.
 */
import { TAU, dot, vadd, vmul } from './math.js';

/**
 * The normal of a polygon, by Newell's method.
 *
 * Summing the cross products around the whole boundary rather than taking one from the
 * first three vertices. The difference matters wherever a polygon opens with two
 * coincident or collinear points — a sphere's pole quads do exactly that, and the
 * three-point version returned a zero vector for every one of them.
 *
 * A zero normal is not a cosmetic problem. The scene vertex shader calls
 * `normalize(uNormalMatrix * aNormal)`, `normalize` of a zero-length vector is undefined
 * in GLSL and yields NaN in practice, and one NaN in the HDR target is enough to put a
 * screen-filling black rectangle on the picture once the bloom chain has spread it.
 *
 * @param {number[][]} points
 * @returns {number[]} unnormalised; length is twice the polygon's area
 */
function newellNormal(points) {
  let nx = 0,
    ny = 0,
    nz = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i],
      b = points[(i + 1) % points.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return [nx, ny, nz];
}

export function polygon(out, points, color = [1, 1, 1], outward = false) {
  const raw = newellNormal(points);
  const length = Math.hypot(...raw);
  // A polygon with no area at all has no normal to compute. That should not happen in
  // this model set, but emitting zeros would hand NaN to the shader, so a valid unit
  // vector is the safe answer: the triangles are zero-area and rasterise to nothing.
  let n = length > 1e-9 ? raw.map((v) => v / length) : [0, 1, 0];
  if (
    outward &&
    dot(
      n,
      points.reduce((a, p) => vadd(a, p), [0, 0, 0]),
    ) < 0
  ) {
    points = points.slice().reverse();
    n = vmul(n, -1);
  }
  for (let i = 1; i < points.length - 1; i++)
    for (const p of [points[0], points[i], points[i + 1]]) out.push(...p, ...n, ...color);
}

export function boxGeom(bevel = 0) {
  const out = [],
    b = 1 - bevel;
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const a = (axis + 1) % 3,
        c = (axis + 2) % 3,
        ps = [];
      for (const uv of [
        [-b, -b],
        [b, -b],
        [b, b],
        [-b, b],
      ]) {
        const p = [0, 0, 0];
        p[axis] = sign;
        p[a] = uv[0];
        p[c] = uv[1];
        ps.push(p);
      }
      polygon(out, ps, [1, 1, 1], true);
    }
  if (bevel) {
    for (let axis = 0; axis < 3; axis++) {
      const a = (axis + 1) % 3,
        c = (axis + 2) % 3;
      for (const sa of [-1, 1])
        for (const sc of [-1, 1]) {
          const ps = [];
          for (const q of [
            [-b, 1, b],
            [b, 1, b],
            [b, b, 1],
            [-b, b, 1],
          ]) {
            const p = [0, 0, 0];
            p[axis] = q[0];
            p[a] = q[1] * sa;
            p[c] = q[2] * sc;
            ps.push(p);
          }
          polygon(out, ps, [1, 1, 1], true);
        }
    }
    for (const x of [-1, 1])
      for (const y of [-1, 1])
        for (const z of [-1, 1])
          polygon(
            out,
            [
              [x, b * y, b * z],
              [b * x, y, b * z],
              [b * x, b * y, z],
            ],
            [1, 1, 1],
            true,
          );
  }
  return out;
}

export function cylinderGeom(n = 10, top = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU,
      b = ((i + 1) / n) * TAU,
      p = [Math.cos(a), -1, Math.sin(a)],
      q = [Math.cos(b), -1, Math.sin(b)],
      r = [q[0] * top, 1, q[2] * top],
      s = [p[0] * top, 1, p[2] * top];
    polygon(out, [p, q, r, s], [1, 1, 1], true);
    polygon(out, [[0, -1, 0], q, p], [1, 1, 1], true);
    if (top) polygon(out, [[0, 1, 0], s, r], [1, 1, 1], true);
  }
  return out;
}

export function sphereGeom(rings = 7, n = 12) {
  const out = [];
  function pt(a, b) {
    return [Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)];
  }
  for (let j = 0; j < rings; j++)
    for (let i = 0; i < n; i++)
      polygon(
        out,
        [
          pt((j / rings) * Math.PI, (i / n) * TAU),
          pt((j / rings) * Math.PI, ((i + 1) / n) * TAU),
          pt(((j + 1) / rings) * Math.PI, ((i + 1) / n) * TAU),
          pt(((j + 1) / rings) * Math.PI, (i / n) * TAU),
        ],
        [1, 1, 1],
        true,
      );
  return out;
}

export function dishGeom() {
  const out = [];
  for (let j = 0; j < 4; j++)
    for (let i = 0; i < 18; i++) {
      const p = (r, a) => [r * Math.cos(a), r * Math.sin(a), r * r * 0.55];
      polygon(out, [
        p(j / 4, (i / 18) * TAU),
        p((j + 1) / 4, (i / 18) * TAU),
        p((j + 1) / 4, ((i + 1) / 18) * TAU),
        p(j / 4, ((i + 1) / 18) * TAU),
      ]);
      polygon(out, [
        p(j / 4, ((i + 1) / 18) * TAU),
        p((j + 1) / 4, ((i + 1) / 18) * TAU),
        p((j + 1) / 4, (i / 18) * TAU),
        p(j / 4, (i / 18) * TAU),
      ]);
    }
  return out;
}

export function rockGeom(variant) {
  const out = [],
    n = 7,
    levels = [-1, -0.14, 0.54, 1],
    radii = [1, 0.86, 0.61, 0.29],
    rings = [];
  for (let j = 0; j < 4; j++) {
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + variant * 0.41,
        r = radii[j] * (0.86 + 0.21 * Math.sin(i * 13.1 + variant * 4.8 + j * 0.7));
      ring.push([
        Math.cos(a) * r + 0.13 * j * Math.sin(variant * 2),
        levels[j] + (j === 0 ? 0 : 0.07 * Math.cos(i * 3.4 + variant)),
        Math.sin(a) * r + 0.05 * j * Math.cos(variant),
      ]);
    }
    rings.push(ring);
  }
  for (let j = 0; j < 3; j++)
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n,
        c = [1, 1, 1].map((v) => v * (0.93 + 0.05 * Math.cos(i * 4 + j + variant)));
      polygon(out, [rings[j][i], rings[j][k], rings[j + 1][k]], c, true);
      polygon(out, [rings[j][i], rings[j + 1][k], rings[j + 1][i]], c, true);
    }
  polygon(out, rings[3], [1, 1, 1], true);
  return out;
}

export function ringGeom(n = 48, width = 0.015) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU,
      b = ((i + 1) / n) * TAU;
    polygon(out, [
      [Math.cos(a), 0, Math.sin(a)],
      [Math.cos(b), 0, Math.sin(b)],
      [Math.cos(b) * (1 - width), 0, Math.sin(b) * (1 - width)],
      [Math.cos(a) * (1 - width), 0, Math.sin(a) * (1 - width)],
    ]);
  }
  return out;
}
