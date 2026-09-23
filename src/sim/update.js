/**
 * Per-frame updates for the pilot, projectiles and effects.
 */
import { $ } from '../core/dom.js';
import { G, config } from './state.js';
import { announce, fireWeapon, toast } from '../net/coop-bridge.js';
import {
  applyDamage,
  clearLOS,
  coverDistance,
  damagePlayer,
  fireOrigin,
  forward,
  raySphere,
  shutdown,
  trace,
} from './combat.js';
import { burst, center } from '../entities/draw.js';
import { capacities } from './player.js';
import { chassisData } from '../data/chassis.js';
import { clamp, dist2, dot, hex, mix, norm, vadd, vmul, vsub, wrap } from '../core/math.js';
import { enemyModels } from '../entities/models.js';
import { makeMech, ridgeGateLocked } from '../entities/spawn.js';
import { ridgeGate } from '../world/sites.js';
import { moveActor, structureHeight, structureRadius } from './movement.js';
import { pools } from '../entities/pools.js';
import { solidObstacles } from '../world/level.js';
import { sound } from '../audio/sound-system.js';
import { terrainY } from '../world/terrain.js';

export function updateProjectiles(dt) {
  for (let i = pools.projectiles.length - 1; i >= 0; i--) {
    const p = pools.projectiles[i];
    p.life -= dt;
    p.prev = p.p.slice();
    if (p.type === 'missile') {
      p.age += dt;
      if (p.target?.alive) {
        const aim = center(p.target),
          direction = norm(vsub(aim, p.p)),
          speed = mix(55, 170, clamp(p.age / 1.2, 0, 1));
        p.v = vadd(vmul(p.v, Math.max(0, 1 - dt * 4)), vmul(direction, speed * dt * 4));
      }
      p.trail -= dt;
      if (p.trail <= 0) {
        p.trail = 0.05;
        pools.particles.push({
          p: p.p.slice(),
          v: [0.2, 1, 0.1],
          color: hex('#b8afa0'),
          size: 0.7,
          life: 0.7,
          max: 0.7,
          smoke: true,
        });
      }
    }
    const movement = vmul(p.v, dt),
      len = Math.hypot(...movement),
      dir = vmul(movement, 1 / len);
    if (p.friendly) {
      const hit = trace(p.p, dir, len + 0.5, false, true);
      if (hit.entity) {
        applyDamage(hit.entity, p.damage, hit.component);
        if (p.type === 'cannon' || p.shotCount) G.shotsHit++;
        p.hit = true;
        burst(hit.point, p.color, p.type === 'missile' ? 14 : 9, p.type === 'missile' ? 10 : 6);
        sound.fxPlay('hit', clamp(1 - dist2(G.player, hit.entity) / 950, 0.03, 0.35));
      } else if (hit.distance < len) {
        p.hit = true;
        burst(hit.point, p.color, 8, 5);
      }
    } else if (G.coop?.host && G.coop.active) {
      G.coop.projectileHit(p, dir, len);
    } else {
      const b = fireOrigin(),
        t = raySphere(p.p, dir, b, 6, len + 1);
      if (t !== Infinity) {
        p.hit = true;
        damagePlayer(p.damage, p);
      } else if (coverDistance(p.p, dir, len, true) < len) {
        p.hit = true;
        burst(p.p, p.color, 7, 4);
      }
    }
    p.p = vadd(p.p, movement);
    if (p.life <= 0 || p.hit || p.p[1] < terrainY(p.p[0], p.p[2])) pools.projectiles.splice(i, 1);
  }
}

export function updateEffects(dt) {
  for (let i = pools.beams.length - 1; i >= 0; i--)
    if ((pools.beams[i].life -= dt) <= 0) pools.beams.splice(i, 1);
  for (let i = pools.particles.length - 1; i >= 0; i--) {
    const p = pools.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      pools.particles.splice(i, 1);
      continue;
    }
    p.p = vadd(p.p, vmul(p.v, dt));
    if (p.smoke) {
      p.size += dt * 1.5;
      p.v[0] += 0.1 * dt;
    } else {
      p.v[1] -= 17 * dt;
      if (p.p[1] < terrainY(p.p[0], p.p[2])) p.life = 0;
    }
  }
  if (pools.particles.length > 320) pools.particles.splice(0, pools.particles.length - 320);
  G.shakePower = Math.max(0, G.shakePower - dt * 1.8);
  G.damageFlash = Math.max(0, G.damageFlash - dt * 0.6);
}

export function updatePlayer(dt) {
  if (!G.player.alive) return;
  if (G.keys.KeyW) G.player.throttle = clamp(G.player.throttle + dt * 0.65, -0.45, 1);
  if (G.keys.KeyS) G.player.throttle = clamp(G.player.throttle - dt * 0.75, -0.45, 1);
  const turn = (G.keys.KeyD ? 1 : 0) - (G.keys.KeyA ? 1 : 0);
  if (G.player.shutdown <= 0)
    G.player.yaw +=
      turn *
      dt *
      chassisData().turn *
      (1 - (Math.abs(G.player.speed) / chassisData().speed) * 0.21);
  G.player.yaw = wrap(G.player.yaw);
  const aimX =
      (G.keys.ArrowRight || G.keys.KeyE ? 1 : 0) - (G.keys.ArrowLeft || G.keys.KeyQ ? 1 : 0),
    aimY = (G.keys.ArrowUp ? 1 : 0) - (G.keys.ArrowDown ? 1 : 0);
  G.player.torso = clamp(G.player.torso + aimX * dt * 0.9, -1.68, 1.68);
  G.player.pitch = clamp(G.player.pitch + aimY * dt * 0.65, -0.62, 0.6);
  if (G.player.align) {
    const d = clamp(G.player.torso, -dt * 1.0, dt * 1.0);
    G.player.yaw += d;
    G.player.torso -= d;
    if (Math.abs(G.player.torso) < 0.005) G.player.align = false;
  }
  if (G.player.centerTorso) {
    G.player.torso *= Math.exp(-dt * 5);
    if (Math.abs(G.player.torso) < 0.005) G.player.centerTorso = false;
  }
  const legFactor =
    G.player.components.leftLeg.hp <= 0 || G.player.components.rightLeg.hp <= 0 ? 0.4 : 1;
  const want = G.player.shutdown > 0 ? 0 : G.player.throttle * chassisData().speed * legFactor;
  G.player.speed += clamp(
    want - G.player.speed,
    -dt * chassisData().brake,
    dt * chassisData().accel,
  );
  // A mech stands on exactly the footprint that would block it at that height; see
  // structureHeight() in movement.js for what went wrong when the two differed.
  const reach = chassisData().radius;
  let support = 0;
  for (const o of solidObstacles)
    if (
      Math.hypot(G.player.x - o.x, G.player.z - o.z) < o.r + reach &&
      G.player.altitude >= o.h - 0.5
    )
      support = Math.max(support, o.h);
  for (const e of pools.entities) {
    if (!e.alive || e.type === 'mech') continue;
    const roof = structureHeight(e);
    if (dist2(G.player, e) < structureRadius(e) + reach && G.player.altitude >= roof - 0.5)
      support = Math.max(support, roof);
  }
  if (
    ridgeGateLocked() &&
    Math.abs(G.player.z - ridgeGate.z) < 3 + reach &&
    Math.abs(G.player.x - ridgeGate.x) < ridgeGate.width / 2 + reach &&
    G.player.altitude >= ridgeGate.height - 0.5
  )
    support = Math.max(support, ridgeGate.height);
  G.player.grounded = G.player.altitude <= support + 0.05 && G.player.vy <= 0;
  const jet =
    (G.keys.ShiftLeft || G.keys.ShiftRight) &&
    G.player.fuel > 1 &&
    G.player.shutdown <= 0 &&
    G.player.altitude < chassisData().maxAlt;
  if (jet) {
    G.player.vy = Math.min(chassisData().jumpSpeed, G.player.vy + dt * chassisData().jumpAccel);
    G.player.fuel = Math.max(0, G.player.fuel - dt * chassisData().fuelUse);
    G.player.heat += dt * chassisData().jetHeat;
    G.player.jetSound -= dt;
    if (G.player.jetSound <= 0) {
      sound.fxPlay('jet');
      G.player.jetSound = 0.16;
    }
  } else {
    G.player.vy -= dt * 18;
    if (G.player.grounded)
      G.player.fuel = Math.min(100, G.player.fuel + dt * chassisData().fuelRegen);
  }
  G.player.altitude += G.player.vy * dt;
  if (G.player.altitude < support) {
    if (G.player.vy < -9) {
      sound.fxPlay('step', Math.min(1.7, -G.player.vy / 13));
      G.shakePower = 0.7;
    }
    G.player.altitude = support;
    G.player.vy = 0;
    G.player.grounded = true;
  }
  const moved = moveActor(
    G.player,
    Math.sin(G.player.yaw) * G.player.speed * dt,
    -Math.cos(G.player.yaw) * G.player.speed * dt,
    G.player.altitude,
    chassisData().radius,
  );
  // Bleed speed off against an obstacle at a rate per second — the rate one 60 Hz frame
  // applied. Applied per step, it depended on the step length and so on refresh rate, and
  // pushing into a wall settled faster or slower depending on the monitor.
  if (!moved) G.player.speed *= Math.pow(0.92, dt * 60);
  G.player.phase += Math.abs(G.player.speed) * dt * 0.24;
  const step = Math.floor(G.player.phase / Math.PI);
  if (step !== G.player.legStep && G.player.grounded && Math.abs(G.player.speed) > 2) {
    G.player.legStep = step;
    sound.fxPlay('step', Math.min(1, Math.abs(G.player.speed) / 18) * chassisData().step);
    G.shakePower = Math.max(G.shakePower, 0.08);
  }
  for (const w of G.weapons) w.remaining = Math.max(0, w.remaining - dt);
  G.player.heat = Math.max(
    0,
    G.player.heat -
      dt * config[G.loadout].cool * chassisData().cooling * (G.player.shutdown > 0 ? 1.6 : 1),
  );
  if (G.player.shutdown > 0) {
    G.player.shutdown = Math.max(0, G.player.shutdown - dt);
    if (G.player.shutdown === 0) {
      G.player.heat = Math.min(G.player.heat, 42);
      announce('REACTOR RESTORED', 'online', 4);
    }
  }
  if (G.player.heat > 82 && !G.player.heatWarning) {
    G.player.heatWarning = true;
    announce('WARNING / Heat critical. Press G to release coolant.', 'heat', 5);
  }
  if (G.player.heat < 60) G.player.heatWarning = false;
  if (G.player.heat >= 100) shutdown();
  if (G.mouse.down || G.keys.Space) fireWeapon(G.weaponIndex);
  if (G.keys.KeyF) for (let i = 0; i < 3; i++) fireWeapon(i);
  if (G.target?.alive) {
    const d = vsub(center(G.target), fireOrigin()),
      distance = Math.hypot(...d),
      angle = dot(norm(d), forward());
    if (
      distance < G.weapons[2].range &&
      angle > 0.974 &&
      clearLOS(fireOrigin(), center(G.target))
    ) {
      G.lock = clamp(G.lock + dt / chassisData().lockTime, 0, 1);
      if (G.lock >= 1 && !G.lockSpoken) {
        G.lockSpoken = true;
        sound.say('lock');
      }
    } else {
      G.lock = Math.max(0, G.lock - dt * 1.3);
      if (G.lock < 0.2) G.lockSpoken = false;
    }
  } else G.lock = 0;
}

export function toggleImaging() {
  G.player.imaging = !G.player.imaging;
  G.imagingSwitch = 0.45;
  $('enhancedView').checked = G.player.imaging;
  sound.fxPlay('beep');
  sound.say(G.player.imaging ? 'enhanced' : 'optical', true);
  toast(
    G.player.imaging ? 'ENHANCED IMAGING / ON · [I] Normal view' : 'ENHANCED IMAGING / OFF',
    2.5,
  );
}

export function repairMachine(which = 'basin') {
  const cap = capacities(),
    ridge = which === 'ridge',
    repair = ridge ? 0.45 : 0.38;
  for (const c of Object.values(G.player.components))
    c.hp = Math.min(c.max, Math.max(0, c.hp) + c.max * repair);
  G.player.ammo = cap.ammo;
  G.player.missiles = cap.missiles;
  G.player.coolants = cap.coolants;
  G.player.heat = 0;
  G.player.fuel = 100;
  G.player.shutdown = 0;
  G.player.armorWarning = false;
  G.player.heatWarning = false;
  if (ridge) {
    G.supplyUsed = true;
    G.supplyTime = 6;
  } else {
    G.serviceUsed = true;
    G.serviceTime = 6;
  }
  G.score += 300;
  announce(
    (ridge ? 'RIDGE BAY' : 'FIELD BAY') + ' / Armor repaired. Weapons rearmed. Coolant restored.',
    'repair',
    8,
  );
}

export function beginRidgeTransit() {
  G.missionStage = 'ridgeTransit';
  G.navIndex = 6;
  G.sectorBanner = {
    title: 'ASHFALL REACTOR DOWN',
    sub: 'SECTOR 03 / CROSS CINDER CUT AT NAV GOLF',
    time: 7,
  };
  announce(
    'CONTROL / North gate is open. Repair at the ridge bay, then cross Cinder Cut.',
    'ridgeRoute',
    10,
  );
}

export function launchLinkWave(wave) {
  G.linkWave = wave;
  const units =
    wave === 1
      ? [
          makeMech(-170, -3500, 'RESPONSE HOUND 17', 'scout'),
          makeMech(330, -3375, 'RESPONSE GUARD 18', 'medium'),
        ]
      : [makeMech(-45, -3780, 'RIDGE COMMANDER', 'heavy')];
  for (const e of units) {
    e.zone = 'ridge';
    e.assaultLink = true;
    e.alert = true;
    e.contact = true;
    e.cooldown = 3.5;
    if (wave === 2) {
      e.commander = true;
      e.model = enemyModels.heavy;
      e.scale = 1.19;
      for (const c of Object.values(e.components)) {
        c.max *= 1.25;
        c.hp = c.max;
      }
    }
  }
  announce(
    wave === 1
      ? 'SENSOR / Counterattack inbound. Keep the flight-link ring clear.'
      : 'SENSOR / Ridge commander inbound. Defeat the command mech.',
    wave === 1 ? 'linkAttack' : 'commander',
    9,
  );
}
