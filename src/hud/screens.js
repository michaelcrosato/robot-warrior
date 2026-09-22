/**
 * Boot sequence, tactical map and the assembled solo HUD.
 */
import { COOP_COLORS } from '../net/protocol.js';
import { G } from '../sim/state.js';
import { TAU, clamp, dist2 } from '../core/math.js';
import { camera } from '../core/viewport.js';
import {
  canyonNav,
  extraction,
  flightLink,
  ridgeNav,
  routePoints,
  serviceBay,
  supplyBay,
} from '../world/sites.js';
import { chassisData } from '../data/chassis.js';
import { ctx } from '../core/gl.js';
import { drawCockpit, drawFlightHUD } from './cockpit.js';
import { hudColor, hudDim, ln, rect, txt } from './primitives.js';
import { pausedFrom } from '../sim/player.js';
import { pools, structures } from '../entities/pools.js';
import { solidObstacles } from '../world/level.js';
import { sound } from '../audio/sound-system.js';
import { drawMobileHUD } from './mobile.js';

function drawBoot() {
  const w = camera.screenW,
    h = camera.screenH,
    s = G.hudScale,
    cx = w * 0.5,
    cy = h * 0.34;
  rect(cx - 195 * s, cy - 65 * s, 390 * s, 230 * s, '#0d1a12e8', '#8f9f6a');
  txt(chassisData().name + ' / SYSTEM START', cx, cy - 38 * s, 14, hudColor, 'center');
  ln(cx - 171 * s, cy - 19 * s, cx + 171 * s, cy - 19 * s, hudDim);
  const stages = ['REACTOR CONTROL', 'SENSOR ARRAY', 'WEAPON SYSTEMS', 'COMBAT LINK'];
  stages.forEach((t, i) => {
    const y = cy + 10 * s + i * 30 * s;
    txt(t, cx - 166 * s, y, 11, i <= G.bootStep ? hudColor : hudDim);
    txt(
      i < G.bootStep ? 'ONLINE' : i === G.bootStep ? 'STARTING...' : 'WAIT',
      cx + 166 * s,
      y,
      11,
      i <= G.bootStep ? hudColor : hudDim,
      'right',
    );
  });
  const y = cy + 145 * s;
  rect(cx - 170 * s, y, 340 * s, 3 * s, '#33472a');
  rect(
    cx - 170 * s,
    y,
    340 * s * clamp(G.bootTime / sound.bootStatus().duration, 0, 1),
    3 * s,
    hudColor,
  );
}

function drawMap() {
  const w = camera.screenW,
    h = camera.screenH,
    s = G.hudScale,
    size = Math.min(w * 0.58, h * 0.63),
    x = (w - size) / 2,
    y = h * 0.12;
  rect(x - 16 * s, y - 32 * s, size + 32 * s, size + 70 * s, '#0c1811f5', '#8f9f6a');
  txt('TACTICAL MAP / IRON ECHO', x, y - 16 * s, 12, hudColor);
  drawTacticalMap(ctx, x, y, size, size, true);
  txt('[M] CLOSE  /  NORTH ↑  /  GRID 200 M', x, y + size + 23 * s, 9, hudDim);
}

export function drawTacticalMap(c, x, y, w, h, live = false) {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.fillStyle = '#0d1913';
  c.fillRect(x, y, w, h);
  const minX = -660,
    maxX = 680,
    minZ = -4110,
    maxZ = 240,
    px = (v) => x + ((v - minX) / (maxX - minX)) * w,
    py = (v) => y + ((v - minZ) / (maxZ - minZ)) * h;
  c.fillStyle = '#112124';
  c.fillRect(x, py(-4100), w, py(-2670) - py(-4100));
  c.strokeStyle = '#2c4030';
  c.lineWidth = 0.7;
  for (let n = -600; n <= 650; n += 200) {
    c.beginPath();
    c.moveTo(px(n), y);
    c.lineTo(px(n), y + h);
    c.stroke();
  }
  for (let n = -4200; n <= 400; n += 200) {
    c.beginPath();
    c.moveTo(x, py(n));
    c.lineTo(x + w, py(n));
    c.stroke();
  }
  c.strokeStyle = '#495b3b';
  for (const o of solidObstacles) {
    if (o.r < 12) continue;
    c.beginPath();
    for (let i = 0; i <= 7; i++) {
      const a = (i / 7) * TAU,
        xx = px(o.x + Math.cos(a) * o.r),
        yy = py(o.z + Math.sin(a) * o.r);
      if (i === 0) c.moveTo(xx, yy);
      else c.lineTo(xx, yy);
    }
    c.stroke();
  }
  const points = [{ x: 0, z: 92 }, structures.relay, structures.uplink, ...routePoints];
  c.setLineDash([4, 5]);
  c.strokeStyle = '#abbf8188';
  c.beginPath();
  points.forEach((p, i) => (i ? c.lineTo(px(p.x), py(p.z)) : c.moveTo(px(p.x), py(p.z))));
  c.stroke();
  c.setLineDash([]);
  const label = (t, p, col, align = 'left', dy = 0) => {
    c.fillStyle = col;
    c.strokeStyle = col;
    c.strokeRect(px(p.x) - 3, py(p.z) - 3, 6, 6);
    c.font = Math.max(8, Math.round(w * 0.02)) + 'px monospace';
    c.textAlign = align;
    c.fillText(t, px(p.x) + (align === 'left' ? 8 : -8), py(p.z) + 3 + dy);
  };
  label('A / RELAY', structures.relay, live && G.missionFlags[0] ? '#526a48' : '#e6b372');
  label('B / UPLINK', structures.uplink, live && G.missionFlags[1] ? '#526a48' : '#e6b372');
  label('SERVICE 01', serviceBay, G.serviceUsed ? '#526a48' : '#80d6df');
  label('C / NEEDLE PASS', canyonNav, '#adcb8b');
  label(
    'D / WEST',
    structures.westFeed,
    structures.westFeed.alive ? '#e6b372' : '#526a48',
    'right',
  );
  label('E / EAST', structures.eastFeed, structures.eastFeed.alive ? '#e6b372' : '#526a48');
  label('F / REACTOR', structures.reactor, structures.reactor.alive ? '#e6b372' : '#526a48');
  label('SERVICE 02', supplyBay, G.supplyUsed ? '#526a48' : '#80d6df');
  label('G / CINDER CUT', ridgeNav, G.missionFlags[5] ? '#526a48' : '#adcb8b');
  label('H / SKYGUARD', structures.skyguard, structures.skyguard.alive ? '#e6b372' : '#526a48');
  label('I / FLIGHT LINK', flightLink, G.missionFlags[7] ? '#526a48' : '#80d6df');
  label('J / EXTRACTION', extraction, '#adcb8b');
  for (const e of pools.entities) {
    if (!e.alive || !['mech', 'turret'].includes(e.type) || (live && dist2(G.player, e) > 1600))
      continue;
    c.fillStyle = e.commander ? '#ffd58a' : '#e68866';
    c.fillRect(px(e.x) - 2, py(e.z) - 2, 4, 4);
  }
  c.font = Math.max(7, Math.round(w * 0.018)) + 'px monospace';
  c.fillStyle = '#6d8976';
  c.textAlign = 'left';
  for (const a of [
    ['01 / KESTREL', -180],
    ['02 / ASHFALL', -1590],
    ['03 / BLACKGLASS', -2710],
  ])
    c.fillText(a[0], x + 7, py(a[1]));
  if (live && G.coop?.active)
    for (const member of G.coop.members.values()) {
      if (member.id === G.coop.id) continue;
      const q = G.coop.playerOf(member);
      if (!q) continue;
      c.fillStyle = q.alive ? COOP_COLORS[member.slot] : '#e47e62';
      c.fillRect(px(q.x) - 3, py(q.z) - 3, 6, 6);
      c.fillText(String(member.slot + 1), px(q.x) + 6, py(q.z) + 3);
    }
  const p = live ? G.player : { x: 0, z: 92, yaw: 0 },
    xx = px(p.x),
    yy = py(p.z);
  c.save();
  c.translate(xx, yy);
  c.rotate(p.yaw);
  c.fillStyle = '#d8e8b1';
  c.beginPath();
  c.moveTo(0, -7);
  c.lineTo(-4, 5);
  c.lineTo(4, 5);
  c.closePath();
  c.fill();
  c.restore();
  c.restore();
}

export function soloDrawHUD() {
  ctx.clearRect(0, 0, camera.screenW, camera.screenH);
  if (G.state === 'menu') return;
  G.hudScale = clamp(Math.min(camera.screenW / 1440, camera.screenH / 860), 0.65, 1.55);
  if (G.touchMode) drawMobileHUD();
  else {
    drawFlightHUD();
    drawCockpit();
  }
  if (G.imagingSwitch > 0) {
    ctx.fillStyle = 'rgba(104,226,177,' + G.imagingSwitch * 0.14 + ')';
    ctx.fillRect(0, 0, camera.screenW, camera.screenH * 0.74);
    ln(
      camera.screenW * 0.065,
      camera.screenH * 0.1 + camera.screenH * 0.6 * (1 - G.imagingSwitch / 0.45),
      camera.screenW * 0.935,
      camera.screenH * 0.1 + camera.screenH * 0.6 * (1 - G.imagingSwitch / 0.45),
      '#8affe377',
      1,
    );
  }
  if (G.state === 'boot' || (G.state === 'paused' && pausedFrom === 'boot')) drawBoot();
  if (G.mapOpen && !G.touchMode) drawMap();
  if (G.damageFlash > 0) {
    const g = ctx.createRadialGradient(
      camera.screenW * 0.5,
      camera.screenH * 0.42,
      camera.screenH * 0.13,
      camera.screenW * 0.5,
      camera.screenH * 0.45,
      camera.screenW * 0.65,
    );
    g.addColorStop(0, '#ff603500');
    g.addColorStop(1, 'rgba(220,58,24,' + G.damageFlash + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, camera.screenW, camera.screenH);
  }
  if (G.player.heat > 75) {
    ctx.fillStyle = `rgba(172,60,14,${Math.max(0, (G.player.heat - 75) / 500)})`;
    ctx.fillRect(0, 0, camera.screenW, camera.screenH);
  }
}
