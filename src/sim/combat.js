/**
 * Weapons, ray tracing, damage resolution and destruction.
 */
import { G, config, timers } from './state.js';
import { M, clamp, dist2, dot, hex, norm, rand, random, vadd, vmul, vsub } from '../core/math.js';
import { actorMatrix, burst, center } from '../entities/draw.js';
import { announce, endMission, spawnBeam, toast } from '../net/coop-bridge.js';
import { beginRidgeTransit } from './update.js';
import { chassisData, compSpec, componentNames } from '../data/chassis.js';
import { makeMech, reactorShielded, ridgeGateLocked } from '../entities/spawn.js';
import { playerArmor } from './player.js';
import { pools, structures } from '../entities/pools.js';
import { ridgeGate } from '../world/sites.js';
import { solidObstacles } from '../world/level.js';
import { sound } from '../audio/sound-system.js';
import { terrainY } from '../world/terrain.js';

export function chooseTarget(cycle = false) {
  const list = pools.entities
    .filter((e) => e.alive && dist2(G.player, e) < 1600)
    .sort((a, b) => dist2(G.player, a) - dist2(G.player, b));
  if (!list.length) {
    G.target = null;
    return;
  }
  const index = cycle ? list.indexOf(G.target) + 1 : 0;
  G.target = list[index % list.length];
  G.lock = 0;
  G.lockSpoken = false;
  sound.say('target');
  sound.fxPlay('beep');
}

export function forward() {
  const y = G.player.yaw + G.player.torso,
    p = G.player.pitch;
  return [Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
}

export function fireOrigin() {
  return [G.player.x, G.player.y + chassisData().eye + G.player.altitude, G.player.z];
}

export function raySphere(origin, dir, c, r, max = 1e9) {
  const oc = vsub(origin, c),
    b = dot(oc, dir),
    q = dot(oc, oc) - r * r,
    d = b * b - q;
  if (d < 0) return Infinity;
  let t = -b - Math.sqrt(d);
  if (t < 0) t = -b + Math.sqrt(d);
  return t >= 0 && t <= max ? t : Infinity;
}

export function coverDistance(origin, dir, max, exclude = null) {
  let t = max;
  if (ridgeGateLocked() && Math.abs(dir[2]) > 0.00001) {
    const u = (ridgeGate.z - origin[2]) / dir[2],
      x = origin[0] + dir[0] * u,
      y = origin[1] + dir[1] * u,
      base = terrainY(x, ridgeGate.z);
    if (
      u > 0 &&
      u < t &&
      Math.abs(x - ridgeGate.x) < ridgeGate.width / 2 &&
      y > base &&
      y < base + ridgeGate.height
    )
      t = u;
  }
  for (const o of solidObstacles) {
    const c = [o.x, terrainY(o.x, o.z) + o.h * 0.5, o.z];
    const ox = origin[0] - o.x,
      oz = origin[2] - o.z,
      b = ox * dir[0] + oz * dir[2],
      a = dir[0] * dir[0] + dir[2] * dir[2],
      disc = b * b - a * (ox * ox + oz * oz - o.r * o.r);
    if (disc > 0 && a > 0.00001) {
      const u = (-b - Math.sqrt(disc)) / a,
        yy = origin[1] + dir[1] * u;
      if (u > 1 && u < t && yy > c[1] - o.h * 0.5 && yy < c[1] + o.h * 0.5) t = u;
    }
  }
  for (let u = 8; u < t; u += 18) {
    const x = origin[0] + dir[0] * u,
      z = origin[2] + dir[2] * u,
      y = origin[1] + dir[1] * u;
    if (y < terrainY(x, z) + 0.1) {
      t = u;
      break;
    }
  }
  return t;
}

export function clearLOS(a, b) {
  const dif = vsub(b, a),
    d = Math.hypot(...dif);
  return coverDistance(a, vmul(dif, 1 / d), d) > d - 4;
}

export function trace(origin, dir, range, assist = true) {
  let nearest = coverDistance(origin, dir, range),
    hit = null,
    component = 'core';
  for (const e of pools.entities) {
    if (!e.alive) continue;
    if (e.type === 'mech') {
      const m = actorMatrix(e);
      for (const k of componentNames) {
        if (e.components[k].hp <= 0) continue;
        const c = M.point(m, compSpec[k].p),
          r = compSpec[k].r * e.scale + (assist ? 0.45 : 0),
          t = raySphere(origin, dir, c, r, range);
        if (t < nearest) {
          nearest = t;
          hit = e;
          component = k;
        }
      }
    } else {
      const c = center(e),
        r =
          e.hitRadius ??
          (e.type === 'tower'
            ? 17
            : e.type === 'uplink'
              ? 26
              : e.type === 'generator'
                ? 17
                : e.type === 'reactor'
                  ? 30
                  : 5);
      const t = raySphere(origin, dir, c, r, range);
      if (t < nearest) {
        nearest = t;
        hit = e;
        component = 'core';
      }
    }
  }
  return { entity: hit, component, distance: nearest, point: vadd(origin, vmul(dir, nearest)) };
}

export function applyDamage(e, amount, component = 'core') {
  if (G.coop?.guest && G.coop.active) return;
  if (!e?.alive) return;
  if (e.skyguard && structures.reactor.alive) {
    if (G.missionTime > (timers.batteryShield || -1)) {
      announce('SKYGUARD ARMORED / Destroy the Ashfall reactor first.', null, 5);
      timers.batteryShield = G.missionTime + 7;
    }
    burst(center(e), hex('#6cbfc8'), 5, 4);
    return;
  }
  if (e === structures.reactor && reactorShielded()) {
    if (!timers.shieldWarning || G.missionTime > timers.shieldWarning) {
      announce('REACTOR SHIELDED / Destroy both power feeds first.', 'shield', 6);
      timers.shieldWarning = G.missionTime + 7;
    }
    burst(center(e), hex('#6cbfc8'), 5, 4);
    return;
  }
  e.hitFlash = 0.16;
  if (e.type === 'mech') {
    let c = e.components[component] || e.components.core;
    if (c.hp <= 0) {
      component = 'core';
      c = e.components.core;
    }
    const spill = Math.max(0, amount - c.hp);
    c.hp -= amount;
    if (component !== 'core') e.components.core.hp -= amount * 0.18 + spill * 0.5;
    if (c.hp <= 0 && component !== 'core') {
      burst(M.point(actorMatrix(e), compSpec[component].p), hex('#ffb05f'), 12, 7);
      if (component === 'leftLeg' || component === 'rightLeg') e.speed *= 0.4;
    }
    if (
      e.components.core.hp <= 0 ||
      e.components.head.hp <= 0 ||
      (e.components.leftLeg.hp <= 0 && e.components.rightLeg.hp <= 0)
    )
      destroyEntity(e);
  } else {
    e.hp -= amount;
    if (e.hp <= 0) destroyEntity(e);
  }
}

function destroyEntity(e) {
  if (!e.alive) return;
  e.alive = false;
  e.deathTime = 0;
  burst(center(e), hex('#ffac56'), 45, e.type === 'mech' ? 18 : 30);
  sound.fxPlay('explosion', clamp(1 - dist2(G.player, e) / 1200, 0.12, 0.9));
  G.shakePower = Math.max(G.shakePower, clamp(200 / Math.max(1, dist2(G.player, e)), 0, 1));
  if (e.type === 'mech' || e.type === 'turret') {
    G.kills++;
    G.score += e.type === 'mech' ? (e.class === 'heavy' ? 650 : 450) : 250;
    announce(e.name + ' — DESTROYED', 'destroy', 4);
  }
  if (e === structures.relay) {
    G.missionFlags[0] = true;
    G.score += 1000;
    G.navIndex = G.missionFlags[1] ? 0 : 1;
    announce('CONTROL / Relay is down. Clear the basin defenders.', 'relay', 8);
    if (!G.reinforcements) {
      const r = makeMech(-225, -640, 'BASTION 06', 'medium');
      r.alert = true;
      r.zone = 'basin';
      G.reinforcements = true;
    }
  }
  if (e === structures.uplink) {
    G.missionFlags[1] = true;
    G.score += 1500;
    G.navIndex = G.missionFlags[0] ? 1 : 0;
    announce(
      G.missionFlags[0]
        ? 'CONTROL / Uplink is down. Clear the remaining basin defenders.'
        : 'CONTROL / Uplink is down. Destroy the relay.',
      'uplink',
      8,
    );
  }
  if (e === structures.westFeed || e === structures.eastFeed) {
    G.score += 800;
    if (reactorShielded()) {
      G.navIndex = structures.westFeed.alive ? 3 : 4;
      announce('CONTROL / One power feed remains.', 'feed', 6);
    } else {
      G.navIndex = 5;
      announce('CONTROL / Shield is down. Destroy the exposed reactor.', 'exposed', 8);
    }
  }
  if (e === structures.reactor) {
    G.missionFlags[4] = true;
    G.score += 2400;
    G.transportTime = 0;
    if (G.missionFlags[3]) beginRidgeTransit();
    else
      announce(
        'CONTROL / Reactor destroyed. Clear the basin and cross NAV CHARLIE first.',
        null,
        9,
      );
    burst(center(e), hex('#ffd093'), 60, 44);
  }
  if (e === structures.skyguard) {
    G.missionFlags[6] = true;
    G.score += 1500;
    if (G.missionFlags[5]) {
      G.missionStage = 'link';
      G.navIndex = 8;
      G.sectorBanner = {
        title: 'AIR DEFENSES DOWN',
        sub: 'NAV INDIA / SECURE THE FLIGHT CODES',
        time: 6,
      };
      announce(
        'CONTROL / Skyguard is down. Stop inside the flight-link ring at NAV INDIA.',
        'batteryDown',
        10,
      );
    }
  }
  if (G.target === e) {
    G.lock = 0;
    G.lockSpoken = false;
  }
}

export function damagePlayer(amount, from, component = null) {
  if (G.coop?.guest && G.coop.active) return;
  if (G.state !== 'playing' || !G.player.alive) return;
  amount *= G.difficulty === 'cadet' ? 0.55 : G.difficulty === 'veteran' ? 1.4 : 1;
  const choices = [
    'core',
    'core',
    'leftTorso',
    'rightTorso',
    'leftArm',
    'rightArm',
    'leftLeg',
    'rightLeg',
  ];
  component = component || choices[Math.floor(random() * choices.length)];
  let c = G.player.components[component];
  if (c.hp <= 0) {
    component = 'core';
    c = G.player.components.core;
  }
  const spill = Math.max(0, amount - c.hp);
  c.hp -= amount;
  if (component !== 'core') G.player.components.core.hp -= spill * 0.6;
  if (c.hp <= 0 && component !== 'core') {
    announce(component.replace(/([A-Z])/g, ' $1').toUpperCase() + ' — DISABLED', 'limb', 4);
    burst(fireOrigin(), hex('#ffb164'), 10, 6);
  }
  G.damageFlash = Math.min(0.5, G.damageFlash + 0.22);
  G.shakePower = Math.min(1.3, G.shakePower + 0.3);
  sound.fxPlay('hit', 0.7);
  if (
    G.player.components.core.hp <= 0 ||
    G.player.components.head.hp <= 0 ||
    (G.player.components.leftLeg.hp <= 0 && G.player.components.rightLeg.hp <= 0)
  ) {
    G.player.alive = false;
    if (G.coop?.active) G.coop.downCurrent();
    else endMission(false);
  }
  if (
    !G.player.armorWarning &&
    (G.player.components.core.hp / G.player.components.core.max < 0.38 || playerArmor() < 0.35)
  ) {
    G.player.armorWarning = true;
    announce('WARNING / Armor is critical. Use cover.', 'armor', 6);
  }
}

export function weaponDisabled(index) {
  return (
    (index === 0 && G.player.components.leftArm.hp <= 0) ||
    (index === 1 && G.player.components.rightArm.hp <= 0) ||
    (index === 2 && G.player.components.leftTorso.hp <= 0 && G.player.components.rightTorso.hp <= 0)
  );
}

export function soloFireWeapon(index) {
  if (G.state !== 'playing' || G.player.shutdown > 0) return;
  const w = G.weapons[index];
  if (w.remaining > 0) return;
  if (weaponDisabled(index)) {
    sound.say('disabled');
    return;
  }
  if ((index === 1 && G.player.ammo <= 0) || (index === 2 && G.player.missiles <= 0)) {
    sound.say('ammo');
    return;
  }
  if (index === 2 && (!G.target?.alive || G.lock < 1)) {
    sound.say('nolock');
    if (!timers.noLock || G.missionTime > timers.noLock) {
      toast('Keep the selected target near the center sight to gain missile lock.', 3);
      timers.noLock = G.missionTime + 7;
    }
    return;
  }
  const origin = fireOrigin(),
    dir = forward(),
    right = [Math.cos(G.player.yaw + G.player.torso), 0, Math.sin(G.player.yaw + G.player.torso)];
  const result = trace(origin, dir, w.range);
  w.remaining = w.cooldown;
  G.player.heat += w.heat;
  G.shotsFired++;
  G.shakePower = Math.max(G.shakePower, index === 1 ? 0.32 : 0.12);
  const dmg = w.damage * config[G.loadout].damage;
  if (index === 0) {
    for (const s of [-1, 1]) {
      const muzzle = vadd(origin, vadd(vmul(right, 3.9 * s), [0, -2.7, 0]));
      spawnBeam(muzzle, result.point, w.color, 0.13, 0.22);
    }
    burst(result.point, w.color, 5, 3);
    if (result.entity) {
      G.shotsHit++;
      applyDamage(result.entity, dmg, result.component);
    }
    sound.fxPlay('laser');
  }
  if (index === 1) {
    G.player.ammo--;
    const muzzle = vadd(origin, vadd(vmul(right, 4.4), [0, -2.9, 0]));
    const d = norm(vsub(result.point, muzzle));
    pools.projectiles.push({
      p: muzzle,
      v: vmul(d, 550),
      type: 'cannon',
      friendly: true,
      life: 3,
      damage: dmg,
      color: w.color,
      prev: muzzle.slice(),
      hit: false,
      range: w.range,
      traveled: 0,
    });
    sound.fxPlay('cannon');
  }
  if (index === 2) {
    const n = Math.min(chassisData().volley, G.player.missiles);
    G.player.missiles -= n;
    for (let i = 0; i < n; i++) {
      const muzzle = vadd(
        origin,
        vadd(vmul(right, (i % 2 ? 1 : -1) * 5.2), [0, 3.3 + Math.floor(i / 2) * 1, 0]),
      );
      pools.projectiles.push({
        p: muzzle,
        v: vadd(vmul(dir, 52), [rand(-4, 4), rand(7, 15), rand(-4, 4)]),
        type: 'missile',
        friendly: true,
        target: G.target,
        life: 10,
        damage: dmg,
        color: w.color,
        prev: muzzle.slice(),
        trail: 0,
        hit: false,
        age: 0,
        shotCount: i === 0,
      });
    }
    sound.fxPlay('missile');
  }
  if (G.player.heat >= 100) shutdown();
}

export function shutdown() {
  if (G.player.shutdown > 0) return;
  G.player.shutdown = 5;
  G.player.heat = 100;
  announce('REACTOR SHUTDOWN / Cooling in progress.', 'shutdown', 6);
  sound.fxPlay('warning');
}

export function soloCoolant() {
  if (G.player.coolants <= 0) {
    toast('No coolant charges remain.');
    return;
  }
  if (G.player.heat < 12) {
    toast('Heat is low. Keep your coolant.');
    return;
  }
  G.player.coolants--;
  G.player.heat = Math.max(0, G.player.heat - 55);
  if (G.player.shutdown > 0) {
    G.player.shutdown = 0;
    announce('REACTOR RESTORED', 'online', 3);
  }
  sound.fxPlay('coolant');
  sound.say('coolant');
  burst(vadd(fireOrigin(), [0, -3, -2]), hex('#aebaaa'), 5, 3);
}
