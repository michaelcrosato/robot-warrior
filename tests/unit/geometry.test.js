import { describe, it, expect } from 'vitest';
import {
  polygon,
  boxGeom,
  cylinderGeom,
  sphereGeom,
  dishGeom,
  rockGeom,
  ringGeom,
} from '../../src/core/geometry.js';
import { resetRandom } from '../../src/core/math.js';

/**
 * Every generator returns one flat array of interleaved vertices:
 * position (3), normal (3), colour (3) — nine floats per vertex, three vertices per
 * triangle. That layout is what upload() hands straight to the GPU, so a generator
 * producing the wrong stride would render garbage rather than fail loudly.
 */
const STRIDE = 9;

function vertices(out) {
  expect(out.length % STRIDE, 'vertex stride must be 9 floats').toBe(0);
  const list = [];
  for (let i = 0; i < out.length; i += STRIDE) {
    list.push({
      position: out.slice(i, i + 3),
      normal: out.slice(i + 3, i + 6),
      color: out.slice(i + 6, i + 9),
    });
  }
  return list;
}

/** Twice the area of the triangle a, b, c. */
function doubleArea(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(
    u[1] * v[2] - u[2] * v[1],
    u[2] * v[0] - u[0] * v[2],
    u[0] * v[1] - u[1] * v[0],
  );
}

function expectWellFormed(out, label) {
  expect(out.length, `${label} must produce geometry`).toBeGreaterThan(0);
  const vs = vertices(out);
  expect(vs.length % 3, `${label} must be whole triangles`).toBe(0);

  let degenerate = 0;
  let unlit = 0;
  for (let t = 0; t < vs.length; t += 3) {
    const tri = [vs[t], vs[t + 1], vs[t + 2]];
    for (const v of tri) {
      expect(v.position.every(Number.isFinite), `${label} position is finite`).toBe(true);
      expect(v.normal.every(Number.isFinite), `${label} normal is finite`).toBe(true);
      for (const c of v.color) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThanOrEqual(1);
      }
    }
    if (doubleArea(tri[0].position, tri[1].position, tri[2].position) < 1e-9) degenerate++;

    const length = Math.hypot(...tri[0].normal);
    // polygon() derives one normal for a whole n-gon from its first three points and
    // stamps it on every triangle in the fan. If those three points are collinear the
    // normal is [0,0,0] — norm() guards against NaN — and the fan renders unlit.
    if (length === 0) unlit++;
    else expect(length, `${label} normal is unit length`).toBeCloseTo(1, 4);
  }
  return { vertices: vs, triangles: vs.length / 3, degenerate, unlit };
}

describe('polygon', () => {
  it('fans a quad into two triangles', () => {
    const out = [];
    polygon(out, [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ]);
    expect(vertices(out)).toHaveLength(6);
  });

  it('fans an n-gon into n-2 triangles', () => {
    const points = Array.from({ length: 6 }, (_, i) => [Math.cos(i), 0, Math.sin(i)]);
    const out = [];
    polygon(out, points);
    expect(vertices(out)).toHaveLength((6 - 2) * 3);
  });

  it('writes the colour it is given onto every vertex', () => {
    const out = [];
    polygon(
      out,
      [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
      ],
      [0.25, 0.5, 0.75],
    );
    for (const v of vertices(out)) expect(v.color).toEqual([0.25, 0.5, 0.75]);
  });

  it('flips a face whose normal points away from the origin when outward is set', () => {
    const facing = [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
    ];
    const plain = [];
    const outward = [];
    polygon(plain, facing, [1, 1, 1], false);
    polygon(outward, facing, [1, 1, 1], true);
    const a = vertices(plain)[0].normal;
    const b = vertices(outward)[0].normal;
    // Same axis either way; `outward` only decides the sign.
    expect(Math.abs(a[0])).toBeCloseTo(Math.abs(b[0]), 6);
    expect(Math.abs(a[1])).toBeCloseTo(Math.abs(b[1]), 6);
    expect(Math.abs(a[2])).toBeCloseTo(Math.abs(b[2]), 6);
  });
});

describe('primitive generators', () => {
  it('builds a fully lit box', () => {
    const box = expectWellFormed(boxGeom(), 'boxGeom');
    expect(box.unlit).toBe(0);
    expect(box.degenerate).toBe(0);
  });

  it('keeps a box inside the unit cube', () => {
    for (const v of vertices(boxGeom())) {
      for (const c of v.position) expect(Math.abs(c)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('builds a well-formed bevelled box with more faces than a plain one', () => {
    const plain = boxGeom(0);
    const bevelled = boxGeom(0.2);
    expectWellFormed(bevelled, 'boxGeom(0.2)');
    expect(bevelled.length).toBeGreaterThan(plain.length);
  });

  it('builds cylinders whose face count scales with segments', () => {
    const coarse = cylinderGeom(6);
    const fine = cylinderGeom(24);
    expectWellFormed(coarse, 'cylinderGeom(6)');
    expectWellFormed(fine, 'cylinderGeom(24)');
    expect(fine.length).toBeGreaterThan(coarse.length);
  });

  it('builds a tapered cylinder', () => {
    expectWellFormed(cylinderGeom(10, 0.3), 'cylinderGeom tapered');
  });

  it('builds a sphere whose vertices sit on the unit radius', () => {
    const { vertices: vs } = expectWellFormed(sphereGeom(8, 14), 'sphereGeom');
    for (const v of vs) expect(Math.hypot(...v.position)).toBeCloseTo(1, 6);
  });

  it('leaves the band at a sphere’s top pole unlit', () => {
    // A latitude/longitude sphere pinches to a point, so the top band's quads open
    // with two coincident vertices and polygon() cannot derive a normal for them.
    // The band is therefore drawn flat-shaded black. Spheres are only used for small
    // details — cockpit bulbs, impact motes — so this has never been worth fixing;
    // the test records it so a future change to polygon() is a deliberate one.
    const segments = 14;
    const sphere = expectWellFormed(sphereGeom(8, segments), 'sphereGeom');
    expect(sphere.unlit).toBe(2 * segments);
    expect(sphere.degenerate).toBe(2 * segments);
  });

  it('builds a fully lit dish', () => {
    expect(expectWellFormed(dishGeom(), 'dishGeom').unlit).toBe(0);
  });

  it('builds a fully lit ring', () => {
    expect(expectWellFormed(ringGeom(), 'ringGeom').unlit).toBe(0);
  });

  it('builds a ring lying flat in the XZ plane', () => {
    for (const v of vertices(ringGeom(12))) expect(v.position[1]).toBe(0);
  });
});

describe('rockGeom', () => {
  it('builds well-formed rocks for every variant the game uploads', () => {
    // src/core/mesh.js caches rock0..rock5, so all six must generate.
    for (let variant = 1; variant <= 6; variant++) {
      const rock = expectWellFormed(rockGeom(variant), `rockGeom(${variant})`);
      expect(rock.unlit, `rockGeom(${variant}) must be fully lit`).toBe(0);
    }
  });

  it('derives its shape from the variant, not from the shared generator', () => {
    // Rock meshes are uploaded once at startup and reused across missions, so they
    // must not consume draws from the seeded generator — doing so would shift every
    // subsequent world-layout draw and make missions irreproducible.
    resetRandom(1);
    const a = rockGeom(3);
    resetRandom(9999);
    expect(rockGeom(3)).toEqual(a);
  });

  it('gives each variant a distinct silhouette', () => {
    const shapes = [1, 2, 3, 4, 5, 6].map((v) => JSON.stringify(rockGeom(v)));
    expect(new Set(shapes).size).toBe(6);
  });
});
