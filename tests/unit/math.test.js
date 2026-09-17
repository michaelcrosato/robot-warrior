import { describe, it, expect } from 'vitest';
import {
  TAU,
  DEG,
  clamp,
  mix,
  wrap,
  dist2,
  vadd,
  vsub,
  vmul,
  dot,
  cross,
  norm,
  hex,
  M,
  random,
  rand,
  resetRandom,
} from '../../src/core/math.js';

describe('scalars', () => {
  it('clamps to the closed interval', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.25, 0, 1)).toBe(0.25);
  });

  it('clamps with the bounds reversed by returning the lower bound', () => {
    // Math.max(a, Math.min(b, v)) with a > b collapses to a. Documented, not ideal;
    // every call site in the game passes ordered bounds.
    expect(clamp(0.5, 1, 0)).toBe(1);
  });

  it('interpolates and extrapolates linearly', () => {
    expect(mix(0, 10, 0.5)).toBe(5);
    expect(mix(0, 10, 0)).toBe(0);
    expect(mix(0, 10, 1)).toBe(10);
    expect(mix(0, 10, 2)).toBe(20);
  });

  it('wraps an angle into (-PI, PI]', () => {
    expect(wrap(0)).toBeCloseTo(0, 12);
    expect(wrap(TAU)).toBeCloseTo(0, 12);
    expect(wrap(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrap(TAU + 0.3)).toBeCloseTo(0.3, 12);
    expect(Math.abs(wrap(3 * Math.PI))).toBeCloseTo(Math.PI, 12);
    for (const a of [-40, -7.1, -1, 0, 1, 7.1, 40, 1000]) {
      expect(Math.abs(wrap(a))).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });

  it('measures distance on the ground plane only', () => {
    // Mechs are matched by ground distance; altitude must not shorten a lock.
    expect(dist2({ x: 0, y: 0, z: 0 }, { x: 3, y: 999, z: 4 })).toBe(5);
  });

  it('converts degrees', () => {
    expect(180 * DEG).toBeCloseTo(Math.PI, 12);
    expect(TAU).toBeCloseTo(2 * Math.PI, 12);
  });
});

describe('vectors', () => {
  it('adds, subtracts and scales componentwise', () => {
    expect(vadd([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33]);
    expect(vsub([10, 20, 30], [1, 2, 3])).toEqual([9, 18, 27]);
    expect(vmul([1, 2, 3], 2)).toEqual([2, 4, 6]);
  });

  it('computes the dot product', () => {
    expect(dot([1, 0, 0], [0, 1, 0])).toBe(0);
    expect(dot([1, 2, 3], [1, 2, 3])).toBe(14);
  });

  it('computes a right-handed cross product', () => {
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(cross([0, 1, 0], [1, 0, 0])).toEqual([0, 0, -1]);
  });

  it('normalises to unit length', () => {
    const n = norm([3, 0, 4]);
    expect(Math.hypot(...n)).toBeCloseTo(1, 12);
    expect(n).toEqual([0.6, 0, 0.8]);
  });

  it('returns a zero vector rather than NaN for a degenerate input', () => {
    // Degenerate normals happen on collapsed geometry; NaN would poison the buffer
    // and drop the whole mesh, so the zero-length guard matters.
    expect(norm([0, 0, 0])).toEqual([0, 0, 0]);
    expect(norm([0, 0, 0]).every(Number.isFinite)).toBe(true);
  });
});

describe('hex', () => {
  it('parses a colour into normalised components', () => {
    expect(hex('#000000')).toEqual([0, 0, 0]);
    expect(hex('#ffffff')).toEqual([1, 1, 1]);
    const [r, g, b] = hex('#ff8000');
    expect(r).toBe(1);
    expect(g).toBeCloseTo(128 / 255, 12);
    expect(b).toBe(0);
  });

  it('accepts a value with no leading hash', () => {
    expect(hex('ffffff')).toEqual(hex('#ffffff'));
  });
});

describe('matrices', () => {
  // Matrices are Float32Array, so ~7 significant digits is the real precision here.
  const near = (a, b) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 5));

  // transform(position, scale, rotation) — note the order.
  it('has a neutral identity', () => {
    const t = M.transform([1, 2, 3], [2, 2, 2], [0.4, 0.5, 0.6]);
    near(M.mul(M.identity(), t), t);
    near(M.mul(t, M.identity()), t);
  });

  it('translates a point', () => {
    near(M.point(M.transform([5, 6, 7]), [0, 0, 0]), [5, 6, 7]);
  });

  it('scales, then translates', () => {
    near(M.point(M.transform([10, 0, 0], [2, 2, 2]), [1, 0, 0]), [12, 0, 0]);
  });

  it('rotates a quarter turn about Y', () => {
    const p = M.point(M.transform([0, 0, 0], [1, 1, 1], [0, Math.PI / 2, 0]), [1, 0, 0]);
    expect(Math.hypot(...p)).toBeCloseTo(1, 5);
    expect(p[1]).toBeCloseTo(0, 5);
    // +X about +Y lands on the Z axis; the sign follows the engine's handedness.
    expect(Math.abs(p[2])).toBeCloseTo(1, 5);
    expect(p[0]).toBeCloseTo(0, 5);
  });

  it('preserves length under rotation', () => {
    const m = M.transform([3, 4, 5], [1, 1, 1], [0.3, -1.1, 0.7]);
    expect(Math.hypot(...M.vector(m, [0, 0, 1]))).toBeCloseTo(1, 5);
  });

  it('ignores translation when transforming a direction', () => {
    near(M.vector(M.transform([100, 100, 100]), [1, 0, 0]), [1, 0, 0]);
  });

  it('builds a perspective matrix that is finite and projective', () => {
    const p = M.perspective(60 * DEG, 16 / 9, 0.5, 4000);
    expect(p).toHaveLength(16);
    expect([...p].every(Number.isFinite)).toBe(true);
    // Column-major: the w row carries -1, so w = -z after projection.
    expect(p[11]).toBeCloseTo(-1, 5);
  });

  // view(eye, target) — it derives its own basis, assuming world up is +Y.
  it('builds a view matrix that places the eye at the origin', () => {
    near(M.point(M.view([0, 10, 20], [0, 0, 0]), [0, 10, 20]), [0, 0, 0]);
  });

  it('puts a point the camera is looking at on the negative z axis', () => {
    const v = M.view([0, 0, 0], [0, 0, -50]);
    const p = M.point(v, [0, 0, -50]);
    expect(p[2]).toBeCloseTo(-50, 4);
    expect(p[0]).toBeCloseTo(0, 4);
    expect(p[1]).toBeCloseTo(0, 4);
  });

  it('preserves distance from the eye', () => {
    const v = M.view([30, 12, -40], [0, 0, 0]);
    const eye = [30, 12, 20];
    // A view transform is rigid, so it cannot change how far away anything is.
    expect(Math.hypot(...M.point(v, eye))).toBeCloseTo(Math.hypot(30 - 30, 12 - 12, 20 + 40), 3);
  });
});

describe('seeded generator', () => {
  it('produces values in [0, 1)', () => {
    resetRandom();
    for (let i = 0; i < 5000; i++) {
      const v = random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('repeats exactly after a reset to the same seed', () => {
    // This is the property the end-to-end parity test depends on: world layout and
    // the enemy roster are drawn from this generator, so an identical sequence is
    // what makes an identical mission.
    resetRandom(56711);
    const first = Array.from({ length: 64 }, () => random());
    resetRandom(56711);
    const second = Array.from({ length: 64 }, () => random());
    expect(second).toEqual(first);
  });

  it('produces a different sequence from a different seed', () => {
    resetRandom(1);
    const a = Array.from({ length: 16 }, () => random());
    resetRandom(2);
    const b = Array.from({ length: 16 }, () => random());
    expect(b).not.toEqual(a);
  });

  it('defaults to the startup seed', () => {
    resetRandom(82731);
    const explicit = Array.from({ length: 8 }, () => random());
    resetRandom();
    expect(Array.from({ length: 8 }, () => random())).toEqual(explicit);
  });

  it('draws rand() inside the requested range', () => {
    resetRandom();
    for (let i = 0; i < 2000; i++) {
      const v = rand(-5, 11);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThan(11);
    }
  });

  it('covers the unit interval reasonably evenly', () => {
    resetRandom();
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) buckets[Math.floor(random() * 10)]++;
    for (const count of buckets) expect(count).toBeGreaterThan(9000);
  });
});
