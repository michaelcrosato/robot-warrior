/**
 * Static level geometry for all three sectors, baked once at startup.
 */
import { TAU, clamp, dist2, hex, mix, rand } from '../core/math.js';
import { bake, part } from '../core/renderer.js';
import {
  beaconSite,
  extraction,
  flightLink,
  ridgeGate,
  routePoints,
  serviceBay,
  supplyBay,
} from './sites.js';
import { palette } from '../core/palette.js';
import { polygon } from '../core/geometry.js';
import { terrainY } from './terrain.js';
import { upload } from '../core/mesh.js';

const staticParts = [];

export const solidObstacles = [];

function prop(g, p, s, c, r = [0, 0, 0]) {
  const q = part(g, p, s, c, r);
  staticParts.push(q);
  return q;
}

function groundMesh() {
  const out = [],
    n = 174,
    size = 7700,
    step = size / n;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = (i - n / 2) * step,
        z = (j - n / 2) * step - 1400,
        p = [x, terrainY(x, z), z],
        q = [x + step, terrainY(x + step, z), z],
        r = [x + step, terrainY(x + step, z + step), z + step],
        s = [x, terrainY(x, z + step), z + step];
      const shade = rand(0.87, 1.1),
        c = palette.ground.map(
          (v, k) => mix(v, [0.34, 0.38, 0.37][k], clamp((-z - 2530) / 570, 0, 1)) * shade,
        );
      polygon(out, [p, s, r], c);
      polygon(
        out,
        [p, r, q],
        c.map((v) => v * rand(0.98, 1.04)),
      );
    }
  return upload(out);
}

export const ground = groundMesh();

ground.grid = true;

function rock(x, z, rad, height, collidable = true) {
  const y = terrainY(x, z),
    c = palette.rock.map(
      (v, k) => mix(v, [0.28, 0.32, 0.33][k], clamp((-z - 2530) / 450, 0, 1)) * rand(0.86, 1.15),
    );
  prop(
    'rock' + Math.floor(rand(0, 6)),
    [x, y + height * 0.46, z],
    [rad * 2, height, rad * rand(1.65, 2.2)],
    c,
    [rand(-0.05, 0.05), rand(0, TAU), rand(-0.045, 0.045)],
  );
  if (collidable) solidObstacles.push({ x, z, r: rad * 0.78, h: height });
}

for (let i = 0; i < 42; i++) {
  const z = rand(-1500, 700),
    side = i % 2 ? 1 : -1,
    x = side * rand(360, 560);
  rock(x, z, rand(38, 95), rand(45, 160));
}

for (let i = 0; i < 65; i++) {
  const a = rand(0, TAU),
    rad = rand(2700, 3200),
    x = Math.sin(a) * rad;
  let z = -1000 + Math.cos(a) * rad;
  if (z < -2450 && Math.abs(x) < 1100) z -= 1900;
  rock(x, z, rand(180, 370), rand(160, 480), false);
}

for (const p of [
  [-160, -115, 25, 33],
  [165, -225, 27, 31],
  [-260, -315, 42, 67],
  [238, -560, 33, 43],
  [-220, -615, 44, 65],
  [295, -910, 51, 110],
  [-155, -855, 25, 33],
  [100, 95, 15, 21],
])
  rock(...p);

for (let i = 0; i < 150; i++) {
  const x = rand(-520, 520),
    z = rand(-1200, 450);
  prop(
    'bevel',
    [x, terrainY(x, z) + rand(0.2, 0.65), z],
    [rand(0.8, 3.5), rand(0.4, 1.3), rand(0.8, 3)],
    palette.rock,
    [rand(-0.4, 0.4), rand(0, TAU), rand(-0.3, 0.3)],
  );
}

for (let z = 60; z > -850; z -= 18) {
  const x = 34 + Math.sin(z * 0.006) * 30,
    y = terrainY(x, z) + 0.08;
  prop('box', [x - 5, y, z], [1.3, 0.035, 7], hex('#87654e'));
  prop('box', [x + 5, y, z], [1.3, 0.035, 7], hex('#87654e'));
}

function smallBuilding(x, z, w, d, h) {
  const y = terrainY(x, z);
  prop('bevel', [x, y + h / 2, z], [w, h, d], hex('#777568'));
  prop('box', [x, y + h, z], [w * 0.8, 0.6, d * 0.85], hex('#a2a087'));
  for (let i = -1; i <= 1; i++)
    prop(
      'box',
      [x + i * w * 0.23, y + h * 0.72, z + d / 2 + 0.05],
      [w * 0.13, 0.75, 0.15],
      hex('#353f3b'),
    );
  solidObstacles.push({ x, z, r: Math.max(w, d) * 0.46, h });
}

smallBuilding(-140, -420, 25, 26, 10);

smallBuilding(-58, -452, 18, 24, 8);

smallBuilding(167, -738, 32, 23, 12);

smallBuilding(100, -781, 23, 20, 9);

smallBuilding(195, -782, 27, 20, 10);

for (let i = 0; i < 8; i++) {
  const x = 100 + (i % 4) * 19,
    z = -664 - Math.floor(i / 4) * 18,
    y = terrainY(x, z);
  prop('box', [x, y + 2, z], [12, 4, 8], i % 2 ? hex('#72634f') : hex('#596159'));
  prop('box', [x, y + 4.2, z], [12.5, 0.5, 8.5], hex('#979079'));
}

for (const p of [
  [-125, -390],
  [-65, -390],
  [110, -708],
  [178, -708],
]) {
  const [x, z] = p,
    y = terrainY(x, z);
  prop('cyl', [x, y + 7, z], [0.9, 14, 0.9], hex('#474d47'));
  prop('box', [x, y + 14, z], [3, 0.8, 1.4], hex('#c9ae79'));
}

prop(
  'cyl',
  [extraction.x, terrainY(extraction.x, extraction.z) + 0.06, extraction.z],
  [94, 0.1, 94],
  hex('#726853'),
);

for (let i = 0; i < 8; i++) {
  const a = (i / 8) * TAU,
    x = extraction.x + Math.sin(a) * 45,
    z = extraction.z + Math.cos(a) * 45;
  prop('bevel', [x, terrainY(x, z) + 0.5, z], [1.8, 1, 1.8], palette.dark);
}

for (let z = -1090; z >= -1610; z -= 78) {
  const x = 115 + Math.sin((z + 1180) * 0.008) * 65;
  for (const side of [-1, 1]) rock(x + side * rand(135, 164), z, rand(39, 59), rand(82, 152));
}

for (let z = -1750; z >= -2490; z -= 130)
  for (const side of [-1, 1]) rock(side * rand(430, 545), z, rand(55, 88), rand(70, 155));

for (const x of [-480, -320, -160, 0, 440, 600]) rock(x, -2610, rand(49, 64), rand(95, 160));

for (let z = -2750; z >= -3010; z -= 90) {
  const x = mix(175, 35, (-z - 2750) / 300);
  for (const side of [-1, 1]) rock(x + side * rand(155, 180), z, rand(38, 54), rand(88, 145));
}

for (let z = -3140; z >= -3990; z -= 130)
  for (const side of [-1, 1]) rock(side * rand(455, 550), z, rand(45, 76), rand(85, 185));

for (let x = -460; x <= 560; x += 160) rock(x, -4080, rand(65, 95), rand(105, 175));

for (let j = 0; j < routePoints.length - 1; j++) {
  const a = routePoints[j],
    b = routePoints[j + 1],
    len = dist2(a, b),
    yaw = Math.atan2(b.x - a.x, b.z - a.z);
  for (let u = 0; u < len; u += 22) {
    const t = u / len,
      x = mix(a.x, b.x, t),
      z = mix(a.z, b.z, t);
    prop('box', [x, terrainY(x, z) + 0.1, z], [18, 0.1, 23], hex('#777466'), [0, yaw, 0]);
    if (Math.floor(u / 22) % 3 === 0) {
      for (const side of [-1, 1]) {
        const xx = x + Math.cos(yaw) * side * 13,
          zz = z - Math.sin(yaw) * side * 13;
        prop('bevel', [xx, terrainY(xx, zz) + 1.1, zz], [0.8, 2.2, 0.8], hex('#adb3a0'));
      }
    }
  }
}

prop(
  'cyl',
  [serviceBay.x, terrainY(serviceBay.x, serviceBay.z) + 0.13, serviceBay.z],
  [72, 0.2, 72],
  hex('#5e7168'),
);

for (const side of [-1, 1]) {
  const x = serviceBay.x + side * 29,
    y = terrainY(x, serviceBay.z);
  prop('bevel', [x, y + 14, serviceBay.z], [5, 28, 9], hex('#8c9277'));
  prop('box', [x, y + 17, serviceBay.z + 4.6], [4.7, 6, 0.35], palette.accent);
  prop('bevel', [x + side * 11, y + 3, serviceBay.z], [15, 6, 18], hex('#4c6261'));
}

prop(
  'bevel',
  [serviceBay.x, terrainY(serviceBay.x, serviceBay.z) + 28, serviceBay.z],
  [65, 4, 10],
  hex('#78877a'),
);

smallBuilding(-170, -1990, 55, 42, 17);

smallBuilding(330, -1840, 42, 45, 15);

smallBuilding(-190, -2190, 58, 47, 18);

smallBuilding(295, -2160, 40, 33, 12);

for (const p of [
  [-205, -2090],
  [-285, -2000],
  [330, -2230],
]) {
  const [x, z] = p,
    y = terrainY(x, z);
  prop('cyl', [x, y + 34, z], [15, 68, 15], hex('#737d76'));
  prop('cyl', [x, y + 60, z], [15.3, 9, 15.3], hex('#a8845b'));
  prop('cyl', [x, y + 68, z], [18, 2, 18], palette.dark);
  solidObstacles.push({ x, z, r: 8, h: 68 });
}

for (let x = -100; x <= 230; x += 55) {
  const z = -2225,
    y = terrainY(x, z);
  prop('cyl', [x, y + 8, z], [4, 34, 4], hex('#819188'), [0, 0, Math.PI / 2]);
  prop('bevel', [x, y + 3, z], [3, 6, 12], hex('#595f58'));
}

for (let i = 0; i < 6; i++) {
  const x = -260 + i * 24,
    z = -1790,
    y = terrainY(x, z);
  prop('bevel', [x, y + 2.7, z], [17, 5.4, 12], i % 2 ? hex('#7b6b55') : hex('#59716e'));
}

for (const p of [
  [-240, -3060, 31, 82],
  [310, -3170, 27, 60],
  [-290, -3300, 28, 74],
  [310, -3615, 24, 70],
  [-245, -3810, 34, 100],
])
  rock(...p);

for (const p of [
  [-230, -3550, 32, 27, 12],
  [335, -3330, 35, 28, 14],
  [-125, -3650, 29, 30, 10],
])
  smallBuilding(...p);

for (let z = -3130; z >= -3730; z -= 120) {
  const x = -365,
    y = terrainY(x, z);
  prop('bevel', [x, y + 8, z], [18, 16, 46], hex('#485652'));
  solidObstacles.push({ x, z, r: 18, h: 16 });
}

for (const side of [-1, 1]) {
  const x = ridgeGate.x + side * 79,
    z = ridgeGate.z,
    y = terrainY(x, z);
  prop('bevel', [x, y + 19, z], [10, 38, 17], hex('#727e72'));
  prop('box', [x, y + 23, z + 9], [7, 12, 0.6], palette.accent);
  solidObstacles.push({ x, z, r: 7, h: 38 });
}

prop(
  'bevel',
  [ridgeGate.x, terrainY(ridgeGate.x, ridgeGate.z) + 37, ridgeGate.z],
  [170, 5, 18],
  hex('#556761'),
);

prop(
  'cyl',
  [supplyBay.x, terrainY(supplyBay.x, supplyBay.z) + 0.12, supplyBay.z],
  [74, 0.2, 74],
  hex('#526968'),
);

for (const side of [-1, 1]) {
  const x = supplyBay.x + side * 30,
    z = supplyBay.z,
    y = terrainY(x, z);
  prop('bevel', [x, y + 13, z], [5, 26, 10], hex('#7e9588'));
  prop('box', [x, y + 17, z + 5.2], [4, 7, 0.5], palette.accent);
  prop('bevel', [x + side * 11, y + 3, z], [15, 6, 16], hex('#536765'));
}

prop(
  'bevel',
  [supplyBay.x, terrainY(supplyBay.x, supplyBay.z) + 26, supplyBay.z],
  [65, 4, 11],
  hex('#869487'),
);

prop(
  'cyl',
  [flightLink.x, terrainY(flightLink.x, flightLink.z) + 0.13, flightLink.z],
  [132, 0.2, 132],
  hex('#414f4c'),
);

for (let i = 0; i < 12; i++) {
  const a = (i / 12) * TAU,
    x = flightLink.x + Math.sin(a) * 65,
    z = flightLink.z + Math.cos(a) * 65;
  prop('bevel', [x, terrainY(x, z) + 0.7, z], [2, 1.4, 2], hex('#adbb9f'));
}

{
  const x = beaconSite.x,
    z = beaconSite.z,
    y = terrainY(x, z);
  prop('bevel', [x, y + 5, z], [25, 10, 23], hex('#6d8179'));
  prop('bevel', [x, y + 20, z], [12, 22, 12], hex('#404f4f'));
  prop('cyl', [x, y + 38, z], [5, 20, 5], hex('#8eac9f'));
  for (const side of [-1, 1]) {
    prop('bevel', [x + side * 12, y + 21, z], [8, 25, 8], hex('#778e84'));
    prop('box', [x + side * 12, y + 24, z + 4.1], [4, 16, 0.5], hex('#68c3c7'));
  }
  solidObstacles.push({ x, z, r: 17, h: 31 });
}

for (let i = 0; i < 75; i++) {
  const x = rand(-430, 430),
    z = rand(-3940, -3000);
  prop('bevel', [x, terrainY(x, z) + 0.3, z], [rand(1, 3), 0.6, rand(1, 3)], hex('#495454'), [
    0,
    rand(0, TAU),
    0,
  ]);
}

export const scenery = bake(staticParts);

staticParts.length = 0;
