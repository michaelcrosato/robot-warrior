/**
 * Per-entity drawing, damage wireframes and impact effects.
 */
import { COOP_COLORS } from '../net/protocol.js';
import { G } from '../sim/state.js';
import { M, clamp, cross, hex, norm, rand, vsub } from '../core/math.js';
import { componentNames } from '../data/chassis.js';
import { draw, drawPart, packParts, part, pass } from '../core/renderer.js';
import { geo } from '../core/mesh.js';
import { palette } from '../core/palette.js';
import { playerModels } from './models.js';
import { pools } from './pools.js';

export function actorMatrix(o) {
  return M.transform(
    [o.x, o.y, o.z],
    [o.scale || 1, o.scale || 1, o.scale || 1],
    [0, Math.PI - o.yaw, 0],
  );
}

export function center(o) {
  return [
    o.x,
    o.y +
      (o.centerHeight ??
        (o.type === 'mech'
          ? 12 * (o.scale || 1)
          : o.type === 'tower'
            ? 30
            : o.type === 'uplink'
              ? 19
              : o.type === 'generator'
                ? 17
                : o.type === 'reactor'
                  ? 29
                  : 6)),
    o.z,
  ];
}

export function entityHealth(o) {
  if (o.type === 'mech') {
    let h = 0,
      m = 0;
    for (const k of componentNames) {
      h += Math.max(0, o.components[k].hp);
      m += o.components[k].max;
    }
    return h / m;
  }
  return Math.max(0, o.hp) / o.maxHP;
}

function componentWire(o, key) {
  if (o.friendly) return o.alive ? hex(COOP_COLORS[o.slot || 0]) : [0.7, 0.28, 0.17];
  if (!o.alive) return [0.2, 0.32, 0.24];
  const c = o.components?.[key],
    r = c ? Math.max(0, c.hp / c.max) : entityHealth(o);
  return r < 0.3
    ? [1, 0.24, 0.16]
    : r < 0.65
      ? [1, 0.44, 0.16]
      : G.target === o
        ? [1, 0.89, 0.38]
        : [0.94, 0.61, 0.24];
}

export function drawMech(o, hero = false) {
  let mat = actorMatrix(o);
  const mod = hero ? playerModels[G.chassis] : o.model;
  const fade = o.alive ? 0 : clamp(o.deathTime / 3, 0, 1);
  if (fade)
    mat = M.mul(mat, M.transform([0, -fade * 7, 0], [1, 1, 1], [fade * 0.8, 0, fade * 0.24]));
  const phase = o.phase || 0,
    bob = Math.abs(Math.sin(phase)) * Math.min(1, (o.speed || 0) / 8) * 0.4;
  const bodyMat = M.mul(
    mat,
    M.transform(
      [0, bob, 0],
      [1, 1, 1],
      [0, hero ? Math.sin(G.realTime * 0.16) * 0.065 : -(o.torso || 0), 0],
    ),
  );
  for (const p of mod.torso) {
    if (o.components?.[p.component]?.hp <= 0 && p.component !== 'core') continue;
    if (pass.imagingPass) pass.wireTint = componentWire(o, p.component);
    drawPart(p, bodyMat);
  }
  for (let i = 0; i < 2; i++) {
    const lift = Math.sin(phase + i * Math.PI) * Math.min(1, (o.speed || 0) / 7);
    const legMat = M.mul(
      mat,
      M.transform([0, Math.max(0, lift) * 0.9, lift * 1.4], [1, 1, 1], [lift * 0.05, 0, 0]),
    );
    for (const p of mod.legs[i]) {
      if (o.components?.[p.component]?.hp <= 0) continue;
      if (pass.imagingPass) pass.wireTint = componentWire(o, p.component);
      drawPart(p, legMat);
    }
    for (const p of mod.arms[i]) {
      if (o.components?.[p.component]?.hp <= 0) continue;
      if (pass.imagingPass) pass.wireTint = componentWire(o, p.component);
      drawPart(p, bodyMat);
    }
  }
}

export function drawEntity(o) {
  if (o.type === 'mech') return drawMech(o);
  if (pass.imagingPass)
    pass.wireTint = !o.alive
      ? [0.19, 0.31, 0.24]
      : o.type === 'turret'
        ? componentWire(o, 'core')
        : [0.2, 0.86, 0.95];
  let mat = actorMatrix(o);
  if (!o.alive)
    mat = M.mul(
      mat,
      M.transform(
        [0, -clamp(o.deathTime / 3, 0, 1) * o.height * 0.65, 0],
        [1, 1, 1],
        [0, 0, clamp(o.deathTime / 3, 0, 1) * 0.4],
      ),
    );
  if (o.parts) {
    for (const p of o.parts) drawPart(p, mat);
  } else if (o.type === 'turret') {
    draw(geo.bevel, M.mul(mat, M.transform([0, 2, 0], [5, 2, 5])), hex('#666b5e'));
    draw(geo.cyl, M.mul(mat, M.transform([0, 4.6, 0], [3, 1.6, 3])), palette.dark);
    draw(geo.bevel, M.mul(mat, M.transform([0, 6.7, 0], [3.8, 2, 3])), palette.hostile);
    for (const s of [-1, 1]) {
      draw(
        geo.cyl,
        M.mul(mat, M.transform([s * 2.3, 7.3, 5], [0.6, 4, 0.6], [Math.PI / 2, 0, 0])),
        palette.dark,
      );
      draw(
        geo.cyl,
        M.mul(mat, M.transform([s * 2.3, 7.3, 9.1], [0.5, 0.1, 0.5], [Math.PI / 2, 0, 0])),
        palette.accent,
        1,
        0.5,
      );
    }
  }
}

export function lineMatrix(a, b, r) {
  const y = norm(vsub(b, a)),
    x = norm(cross(Math.abs(y[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0], y)),
    z = cross(x, y),
    m = M.identity(),
    l = Math.hypot(...vsub(b, a)) * 0.5;
  for (let i = 0; i < 3; i++) {
    m[i] = x[i] * r;
    m[4 + i] = y[i] * l;
    m[8 + i] = z[i] * r;
    m[12 + i] = (a[i] + b[i]) * 0.5;
  }
  return m;
}

export function burst(p, color, n = 18, power = 12) {
  if (G.coop?.replaying) return;
  for (let i = 0; i < n; i++) {
    if (pools.particles.length > 240) pools.particles.shift();
    pools.particles.push({
      p: p.slice(),
      v: [rand(-power, power), rand(1, power * 1.25), rand(-power, power)],
      color,
      size: rand(0.25, 1.3),
      life: rand(0.4, 1.5),
      max: 1.5,
      smoke: false,
    });
  }
  for (let i = 0; i < 5; i++)
    pools.particles.push({
      p: p.slice(),
      v: [rand(-2, 2), rand(4, 8), rand(-2, 2)],
      color: hex('#524d43'),
      size: rand(2, 4),
      life: rand(2, 4),
      max: 4,
      smoke: true,
    });
}

export function soloSpawnBeam(a, b, c, width = 0.15, life = 0.19) {
  pools.beams.push({ a: a.slice(), b: b.slice(), c, width, life, max: life });
}

export const transportParts = (() => {
  const a = [],
    put = (g, p, s, c, r = [0, 0, 0], glow = 0) => a.push(part(g, p, s, c, r, glow));
  put('bevel', [0, 0, 0], [22, 12, 38], hex('#637165'));
  put('bevel', [0, 2, 15], [17, 8, 15], hex('#8c9380'), [0.17, 0, 0]);
  put('bevel', [0, 3.5, 23], [12, 2.4, 0.8], palette.visor, [0.17, 0, 0], 0.7);
  put('box', [0, -6, 1], [13, 0.8, 22], palette.dark);
  put('bevel', [0, 7, -7], [7, 7, 21], palette.armor);
  for (const side of [-1, 1]) {
    put('bevel', [side * 18, -0.3, -3], [19, 4, 17], palette.dark, [0, 0, side * -0.06]);
    put('bevel', [side * 23, 0, -5], [9, 10, 25], hex('#78806c'));
    put('box', [side * 23, 5.1, -5], [7, 0.3, 18], palette.accent);
    for (const z of [-12, 3]) {
      put('cyl', [side * 23, -5.5, z], [5.7, 2, 5.7], palette.joint);
      put('cyl', [side * 23, -6.6, z], [4.2, 0.2, 4.2], hex('#a9d7c3'), [0, 0, 0], 1);
    }
    put('box', [side * 9, 1, -22], [5, 12, 1.4], palette.edge, [0, 0, side * 0.25]);
  }
  return packParts(a);
})();
