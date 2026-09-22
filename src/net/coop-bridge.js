/**
 * The seam between solo and co-op. Each function here dispatches to the co-op layer when a session is live and to the solo path otherwise.
 */
import { COOP_COLORS } from './protocol.js';
import { G } from '../sim/state.js';
import { LanceCoop } from './coop.js';
import { M, clamp, dist2, hex, norm, vadd, vmul, vsub, wrap } from '../core/math.js';
import { allObjectivesComplete } from '../entities/spawn.js';
import { burst, drawMech, soloSpawnBeam } from '../entities/draw.js';
import { camera } from '../core/viewport.js';
import { chassisData } from '../data/chassis.js';
import { draw, pass, project, blendAdditive, blendEnd } from '../core/renderer.js';
import { extraction } from '../world/sites.js';
import {
  finishSoloMission,
  soloAnnounce,
  soloPauseGame,
  soloResumeGame,
  soloReturnMenu,
  soloStartMission,
  soloToast,
} from '../sim/player.js';
import {
  fireOrigin,
  forward,
  shutdown,
  soloCoolant,
  soloFireWeapon,
  trace,
  weaponDisabled,
} from '../sim/combat.js';
import { geo } from '../core/mesh.js';
import { playerModels } from '../entities/models.js';
import { poly, rect, txt } from '../hud/primitives.js';
import { pools } from '../entities/pools.js';
import { soloDrawHUD } from '../hud/screens.js';
import { soloEnemyFire, updateOneEnemy } from '../sim/ai.js';
import { sound } from '../audio/sound-system.js';

export function startMission() {
  if (G.coop && G.coop.mode !== 'offline') return G.coop.startRequested();
  soloStartMission();
}

export function pauseGame() {
  if (G.coop?.active) return G.coop.pauseLocal();
  soloPauseGame();
}

export function resumeGame() {
  if (G.coop?.active) return G.coop.resumeLocal();
  soloResumeGame();
}

export function returnMenu() {
  if (G.coop && G.coop.mode !== 'offline') return G.coop.leave();
  soloReturnMenu();
}

export function endMission(won) {
  if (G.coop?.active) {
    if (G.coop.executing) {
      G.coop.pendingFinish = won;
      return;
    }
    return G.coop.finish(won);
  }
  finishSoloMission(won);
}

export function announce(text, voice = null, duration = 7) {
  if (G.coop?.replaying) return;
  if (G.coop?.host && G.coop.active) G.coop.emit({ kind: 'radio', text, voice, duration });
  if (G.coop?.executing && G.coop.executing !== G.coop.id) return;
  soloAnnounce(text, voice, duration);
}

export function toast(text, seconds = 3) {
  if (G.coop?.replaying || (G.coop?.executing && G.coop.executing !== G.coop.id)) return;
  soloToast(text, seconds);
}

export function spawnBeam(a, b, c, width = 0.15, life = 0.19) {
  if (G.coop?.replaying) return;
  soloSpawnBeam(a, b, c, width, life);
  if (!G.coop?.receiving)
    G.coop?.emit({ kind: 'beam', a, b, c, width, life, owner: G.coop.weaponOwner || '' });
}

export function coolant() {
  if (G.coop?.active && !G.coop.inStep) {
    if (G.player.alive && G.coop.actions.length < 2) G.coop.actions.push('coolant');
    return;
  }
  soloCoolant();
}

export function fireWeapon(index) {
  if (!G.player.alive) return;
  if (G.coop?.guest && G.coop.active) return predictWeapon(index, !G.coop.replaying);
  const before = G.weapons[index].remaining,
    owner = G.coop?.weaponOwner;
  if (G.coop) G.coop.weaponOwner = G.coop.currentId;
  try {
    soloFireWeapon(index);
  } finally {
    if (G.coop) G.coop.weaponOwner = owner;
  }
  if (G.coop?.host && G.coop.active && before <= 0 && G.weapons[index].remaining > 0) {
    const kind = index === 0 ? 'laser' : index === 1 ? 'cannon' : 'missile';
    G.coop.emit({
      kind: 'shot',
      owner: G.coop.currentId,
      sound: kind,
      x: G.player.x,
      z: G.player.z,
    });
    if (G.coop.executing && G.coop.executing !== G.coop.id) {
      const main = G.coop.members.get(G.coop.id).sim.p;
      const context = G.coop.executing;
      G.coop.executing = null;
      try {
        coopRawFx.call(sound, kind, clamp(1 - dist2(main, G.player) / 1000, 0.03, 0.75));
      } finally {
        G.coop.executing = context;
      }
    }
  }
}

function predictWeapon(index, visual) {
  if (G.state !== 'playing' || G.player.shutdown > 0 || !G.player.alive) return;
  const w = G.weapons[index];
  if (w.remaining > 0) return;
  if (weaponDisabled(index)) {
    if (visual) sound.say('disabled');
    return;
  }
  if ((index === 1 && G.player.ammo <= 0) || (index === 2 && G.player.missiles <= 0)) {
    if (visual) sound.say('ammo');
    return;
  }
  if (index === 2 && (!G.target?.alive || G.lock < 1)) {
    if (visual) sound.say('nolock');
    return;
  }
  w.remaining = w.cooldown;
  G.player.heat += w.heat;
  if (index === 1) G.player.ammo--;
  const count = index === 2 ? Math.min(chassisData().volley, G.player.missiles) : 0;
  if (index === 2) G.player.missiles -= count;
  if (visual) {
    const origin = fireOrigin(),
      dir = forward(),
      right = [Math.cos(G.player.yaw + G.player.torso), 0, Math.sin(G.player.yaw + G.player.torso)],
      result = trace(origin, dir, w.range);
    G.shakePower = Math.max(G.shakePower, index === 1 ? 0.32 : 0.12);
    if (index === 0) {
      for (const side of [-1, 1])
        soloSpawnBeam(
          vadd(origin, vadd(vmul(right, 3.9 * side), [0, -2.7, 0])),
          result.point,
          w.color,
          0.13,
          0.22,
        );
      burst(result.point, w.color, 5, 3);
    }
    if (index === 1) {
      const muzzle = vadd(origin, vadd(vmul(right, 4.4), [0, -2.9, 0]));
      pools.projectiles.push({
        p: muzzle,
        v: vmul(norm(vsub(result.point, muzzle)), 550),
        type: 'cannon',
        friendly: true,
        life: 1,
        color: w.color,
        prev: muzzle.slice(),
        predicted: true,
      });
    }
    if (index === 2)
      for (let i = 0; i < count; i++) {
        const muzzle = vadd(
          origin,
          vadd(vmul(right, (i % 2 ? 1 : -1) * 5.2), [0, 3.3 + Math.floor(i / 2), 0]),
        );
        pools.projectiles.push({
          p: muzzle,
          v: vmul(dir, 100),
          type: 'missile',
          friendly: true,
          life: 0.8,
          color: w.color,
          prev: muzzle.slice(),
          predicted: true,
        });
      }
    sound.fxPlay(index === 0 ? 'laser' : index === 1 ? 'cannon' : 'missile');
  }
  if (G.player.heat >= 100) shutdown();
}

export function enemyFire(e) {
  const n = pools.beams.length + pools.projectiles.length;
  soloEnemyFire(e);
  if (G.coop?.host && G.coop.active && pools.beams.length + pools.projectiles.length > n)
    G.coop.emit({
      kind: 'shot',
      owner: '',
      sound: e.type === 'turret' || e.class === 'heavy' ? 'cannon' : 'laser',
      x: e.x,
      z: e.z,
    });
}

export function updateEnemies(dt) {
  for (const e of pools.entities) {
    if (G.coop?.host && G.coop.active) {
      const r = G.coop.nearestPilot(e);
      if (r) G.coop.withPilot(r, () => updateOneEnemy(e, dt));
      else updateOneEnemy(e, dt);
    } else updateOneEnemy(e, dt);
  }
}

export function drawAllies() {
  if (!G.coop?.active || G.state === 'menu') return;
  for (const r of G.coop.members.values())
    if (r.id !== G.coop.id) {
      const p = G.coop.host ? r.sim?.p : r.view || r.p;
      if (!p || dist2({ x: camera.cameraEye[0], z: camera.cameraEye[2] }, p) > 1800) continue;
      const o = {
        ...p,
        y: p.y + p.altitude,
        type: 'mech',
        scale: 1,
        model: playerModels[r.chassis],
        friendly: true,
        slot: r.slot,
        deathTime: p.alive ? 0 : 2.7,
      };
      drawMech(o);
      if (pass.imagingPass) pass.wireTint = hex(COOP_COLORS[r.slot]);
      draw(
        geo.ring,
        M.transform([p.x, p.y + 0.25, p.z], [9, 1, 9]),
        hex(COOP_COLORS[r.slot]),
        1,
        0.3,
      );
      if (p.altitude > 1 && p.alive) {
        blendAdditive();
        for (const side of [-1, 1])
          draw(
            geo.cone,
            M.transform([p.x + side * 2.7, p.y + p.altitude + 4, p.z], [0.9, 3, 1]),
            hex('#acddeb'),
            0.45,
            1,
          );
        blendEnd();
      }
    }
}

export function drawCoopRadar(cx, cy, r) {
  if (!G.coop?.active) return;
  for (const member of G.coop.members.values()) {
    if (member.id === G.coop.id) continue;
    const p = G.coop.playerOf(member);
    if (!p) continue;
    const dx = p.x - G.player.x,
      dz = p.z - G.player.z,
      a = -G.player.yaw,
      x = ((dx * Math.cos(a) + dz * Math.sin(a)) / 1200) * r,
      y = ((-dx * Math.sin(a) + dz * Math.cos(a)) / 1200) * r;
    if (Math.hypot(x, y) > r - 4) continue;
    const c = COOP_COLORS[member.slot];
    poly(
      [
        [cx + x, cy + y - 4],
        [cx + x - 4, cy + y],
        [cx + x, cy + y + 4],
        [cx + x + 4, cy + y],
      ],
      p.alive ? c : '#e47e62',
    );
  }
}

function drawCoopHUD() {
  if (!G.coop?.active || G.state === 'menu' || G.mapOpen) return;
  const w = camera.screenW,
    h = camera.screenH,
    s = G.hudScale,
    rows = [...G.coop.members.values()].sort((a, b) => a.slot - b.slot),
    x = w * 0.73,
    y = h * 0.2,
    bw = w * 0.18;
  // Mobile keeps the roster in SYS; this desktop panel would cover the phone's sight.
  if (!G.touchMode) {
    rect(
      x - 8 * s,
      y - 11 * s,
      bw + 16 * s,
      26 * s + rows.length * 21 * s,
      '#0a1818b8',
      '#647d7255',
    );
    txt(
      'LANCE / ' + rows.length + ' PILOTS' + (G.coop.host ? ' / HOST' : ''),
      x,
      y + 2 * s,
      8,
      '#80d6df',
    );
    rows.forEach((r, i) => {
      const p = G.coop.playerOf(r);
      if (!p) return;
      const yy = y + 23 * s + i * 21 * s,
        c = COOP_COLORS[r.slot];
      let total = 0,
        max = 0;
      for (const q of Object.values(p.components)) {
        total += Math.max(0, q.hp);
        max += q.max;
      }
      txt(r.slot + 1 + ' ' + r.name.slice(0, 12) + (r.id === G.coop.id ? ' *' : ''), x, yy, 9, c);
      const status = p.alive
        ? Math.round((total / max) * 100) + '%'
        : r.revive > 0
          ? 'RESTORE ' + Math.floor((r.revive / 6) * 100) + '%'
          : 'DOWN';
      txt(status, x + bw, yy, 8, p.alive ? c : '#f49473', 'right');
    });
    const l = G.coop.guest ? G.coop.transport?.links.get(G.coop.hostId) : null;
    txt(
      G.coop.guest
        ? (l?.route || 'LINK') + ' / ' + Math.round(l?.rtt || 0) + ' MS'
        : G.coop.formattedRoom() + ' / FRIENDLY FIRE OFF',
      x,
      y + 22 * s + rows.length * 21 * s,
      7,
      '#8dab9a',
    );
  }
  for (const r of rows) {
    if (r.id === G.coop.id) continue;
    const p = G.coop.host ? r.sim?.p : r.view || r.p;
    if (!p) continue;
    const d = dist2(G.player, p),
      point = project([p.x, p.y + p.altitude + 23, p.z]),
      c = p.alive ? COOP_COLORS[r.slot] : '#f49473';
    if (
      point &&
      point.x > w * 0.13 &&
      point.x < w * 0.87 &&
      point.y > h * 0.12 &&
      point.y < h * 0.68
    ) {
      const size = 5 * s;
      poly(
        [
          [point.x, point.y - size],
          [point.x - size, point.y],
          [point.x, point.y + size],
          [point.x + size, point.y],
        ],
        null,
        c,
      );
      txt(r.name, point.x, point.y - 13 * s, 9, c, 'center');
      txt(
        (p.alive ? '' : 'DOWN / ') + Math.round(d) + ' M',
        point.x,
        point.y + 16 * s,
        8,
        c,
        'center',
      );
    } else if (d < 3000) {
      const bearing = wrap(
          Math.atan2(p.x - G.player.x, -(p.z - G.player.z)) - (G.player.yaw + G.player.torso),
        ),
        side = bearing > 0 ? 1 : -1,
        xx = w * (side > 0 ? 0.855 : 0.145),
        yy = h * (0.39 + r.slot * 0.035);
      txt((side < 0 ? '‹ ' : '') + (r.slot + 1) + (side > 0 ? ' ›' : ''), xx, yy, 11, c, 'center');
    }
    if (!p.alive && d < 38 && G.player.alive) {
      rect(w * 0.5 - 175 * s, h * 0.495, 350 * s, 36 * s, '#0b1d1fe8', c);
      txt(
        (G.touchMode ? 'STOP TO RESTORE / ' : 'STOP + HOLD [J] / RESTORE ') + r.name,
        w * 0.5,
        h * 0.495 + 14 * s,
        G.touchMode ? 15 : 10,
        c,
        'center',
      );
      rect(
        w * 0.5 - 170 * s,
        h * 0.495 + 29 * s,
        340 * s * clamp((r.revive || 0) / 6, 0, 1),
        3 * s,
        c,
      );
    }
  }
  if (allObjectivesComplete() && dist2(G.player, extraction) < extraction.r + 35) {
    const living = G.coop.living(),
      inside = living.filter((r) => {
        const p = G.coop.playerOf(r);
        return dist2(p, extraction) < extraction.r && p.altitude < 3 && Math.abs(p.speed) < 2.2;
      }).length;
    txt(
      'LANCE AT EXTRACTION / ' + inside + ' OF ' + living.length,
      w * 0.5,
      h * 0.53,
      10,
      '#80d6df',
      'center',
    );
  }
}

export function drawHUD() {
  soloDrawHUD();
  drawCoopHUD();
}

const coopRawFx = sound.fxPlay;

export function initCoop() {
  for (const name of ['tone', 'noise', 'say', 'fxPlay']) {
    const original = sound[name];
    sound[name] = function (...args) {
      if (G.coop?.replaying || (G.coop?.executing && G.coop.executing !== G.coop.id)) return;
      return original.apply(this, args);
    };
  }
  G.coop = new LanceCoop();
}
