/**
 * Enemy behaviour.
 */
import { G } from './state.js';
import { announce, enemyFire, spawnBeam } from '../net/coop-bridge.js';
import { burst, center, entityHealth } from '../entities/draw.js';
import { clamp, dist2, hex, norm, rand, random, vadd, vmul, vsub, wrap } from '../core/math.js';
import { clearLOS, damagePlayer, fireOrigin } from './combat.js';
import { flightLink } from '../world/sites.js';
import { moveActor } from './movement.js';
import { pools } from '../entities/pools.js';
import { sound } from '../audio/sound-system.js';

export function soloEnemyFire(e) {
  const a = center(e),
    b = fireOrigin(),
    distance = dist2(G.player, e);
  if (!clearLOS(a, b)) return;
  const dir = norm(vsub(b, a)),
    lead = 0.22,
    spread =
      (G.difficulty === 'cadet' ? 9 : 6) + distance * 0.008 + Math.abs(G.player.speed) * 0.18;
  const aim = vadd(b, [
    Math.sin(G.player.yaw) * G.player.speed * lead + rand(-spread, spread),
    rand(-spread * 0.55, spread * 0.55),
    -Math.cos(G.player.yaw) * G.player.speed * lead + rand(-spread, spread),
  ]);
  if (e.type === 'turret' || e.class === 'heavy') {
    pools.projectiles.push({
      p: a.slice(),
      v: vmul(norm(vsub(aim, a)), 245),
      type: 'hostile',
      friendly: false,
      life: 4.5,
      damage: e.skyguard ? 32 : e.commander ? 34 : e.class === 'heavy' ? 28 : 18,
      color: hex('#ff7150'),
      prev: a.slice(),
      hit: false,
    });
    spawnBeam(a, vadd(a, vmul(dir, 10)), hex('#ffb16a'), 0.3, 0.12);
    sound.fxPlay('cannon', clamp(1 - distance / 950, 0.05, 0.28));
  } else {
    spawnBeam(a, aim, hex('#f87156'), 0.18, 0.24);
    const off = Math.hypot(...vsub(aim, b));
    if (off < (G.player.altitude > 2 ? 5 : 6.4)) damagePlayer(e.class === 'scout' ? 12 : 17, e);
    sound.fxPlay('laser', clamp(1 - distance / 950, 0.05, 0.28));
  }
}

export function updateOneEnemy(e, dt) {
  e.hitFlash = Math.max(0, e.hitFlash - dt);
  if (!e.alive) {
    e.deathTime += dt;
    if (e.deathTime < 2 && random() < dt * 9)
      burst(vadd(center(e), [rand(-5, 5), rand(-5, 5), rand(-5, 5)]), hex('#ff9e51'), 8, 10);
    if (e.deathTime < 50 && random() < dt * 3) {
      pools.particles.push({
        p: [e.x, e.y + 5, e.z],
        v: [0.8, 3.5, 0.2],
        color: hex('#373b36'),
        size: 4,
        life: 5,
        max: 5,
        smoke: true,
      });
    }
    return;
  }
  if (e.type !== 'mech' && e.type !== 'turret') return;
  if (e.zone === 'ridge' && !G.missionFlags[5] && G.player.z > -2960 && e.hitFlash <= 0) return;
  if (e.zone === 'pass' && !e.alert && G.player.z > -1120 && e.hitFlash <= 0) return;
  const distance = dist2(G.player, e);
  if (distance < 440 || e.hitFlash > 0) e.alert = true;
  if (!e.alert) return;
  if (!e.contact && distance < 510) {
    e.contact = true;
    announce('SENSOR / ' + e.name + ' detected.', 'contact', 5);
  }
  const focus = e.assaultLink && !G.missionFlags[7] ? flightLink : G.player,
    focusDistance = dist2(e, focus),
    desired = Math.atan2(focus.x - e.x, -(focus.z - e.z));
  e.yaw += clamp(wrap(desired - e.yaw), -dt * 0.8, dt * 0.8);
  if (e.type === 'mech') {
    const desiredRange = e.class === 'scout' ? 155 : e.class === 'heavy' ? 270 : 225,
      speed = e.class === 'scout' ? 11 : e.class === 'heavy' ? 5.7 : 8;
    const legFactor = e.components.leftLeg.hp <= 0 || e.components.rightLeg.hp <= 0 ? 0.28 : 1;
    let radial = distance > desiredRange ? 1 : distance < 100 ? -0.55 : 0,
      side = distance < 450 ? 0.42 * e.strafe : 0;
    if (e.assaultLink && !G.missionFlags[7]) {
      radial = focusDistance > 48 ? 1 : 0;
      side = focusDistance > 75 ? 0 : 0.18 * e.strafe;
    } else if (entityHealth(e) < 0.23) radial = -0.6;
    const dx = (Math.sin(desired) * radial + Math.cos(desired) * side) * speed * dt * legFactor,
      dz = (-Math.cos(desired) * radial + Math.sin(desired) * side) * speed * dt * legFactor;
    const moved = moveActor(e, dx, dz, 0, 6);
    if (!moved) {
      e.strafe *= -1;
      moveActor(
        e,
        Math.cos(desired) * speed * dt * e.strafe,
        Math.sin(desired) * speed * dt * e.strafe,
        0,
        6,
      );
    }
    e.speed = Math.hypot(dx, dz) / dt;
    e.phase += e.speed * dt * 0.27;
  }
  e.cooldown -= dt;
  if (distance < 560 && e.cooldown <= 0) {
    enemyFire(e);
    const lost =
      e.type === 'mech' && (e.components.leftArm.hp <= 0 || e.components.rightArm.hp <= 0);
    e.cooldown =
      rand(e.skyguard ? 4.2 : 3.4, e.skyguard ? 6.2 : 5.8) *
      (lost ? 1.7 : 1) *
      (G.difficulty === 'cadet' ? 1.35 : 1);
  }
}
