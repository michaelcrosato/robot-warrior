/**
 * Cockpit frame, armour diagram, radar, weapon bay and targeting.
 */
import { DEG, TAU, clamp, dist2, wrap } from '../core/math.js';
import { G, config } from '../sim/state.js';
import {
  allObjectivesComplete,
  basinThreats,
  reactorShielded,
  ridgeResponseThreats,
} from '../entities/spawn.js';
import { camera } from '../core/viewport.js';
import {
  canyonNav,
  extraction,
  flightLink,
  ridgeNav,
  serviceBay,
  supplyBay,
} from '../world/sites.js';
import { center, entityHealth } from '../entities/draw.js';
import { chassisData } from '../data/chassis.js';
import {
  circle,
  corners,
  damageColor,
  hudAmber,
  hudColor,
  hudDim,
  hudRed,
  ln,
  panelBox,
  poly,
  rect,
  txt,
} from './primitives.js';
import { ctx } from '../core/gl.js';
import { drawCoopRadar } from '../net/coop-bridge.js';
import { fireOrigin, forward, trace, weaponDisabled } from '../sim/combat.js';
import { formatTime, playerArmor } from '../sim/player.js';
import { landingThreats } from '../sim/mission.js';
import { pools, structures } from '../entities/pools.js';
import { project } from '../core/renderer.js';
import { terrainY } from '../world/terrain.js';

export function drawCockpit() {
  const w = camera.screenW,
    h = camera.screenH,
    s = G.hudScale;
  const metal = ctx.createLinearGradient(0, h * 0.71, 0, h);
  metal.addColorStop(0, '#55594a');
  metal.addColorStop(0.15, '#303a31');
  metal.addColorStop(0.65, '#252f28');
  metal.addColorStop(1, '#151e1a');
  poly(
    [
      [0, h * 0.745],
      [w * 0.085, h * 0.703],
      [w * 0.24, h * 0.738],
      [w * 0.37, h * 0.724],
      [w * 0.425, h * 0.741],
      [w * 0.575, h * 0.741],
      [w * 0.64, h * 0.724],
      [w * 0.78, h * 0.736],
      [w * 0.915, h * 0.704],
      [w, h * 0.746],
      [w, h],
      [0, h],
    ],
    metal,
    '#77775b',
    2,
  );
  poly(
    [
      [0, 0],
      [w * 0.055, 0],
      [w * 0.033, h * 0.44],
      [w * 0.064, h * 0.718],
      [0, h * 0.76],
    ],
    '#29352d',
    '#72745a',
    2,
  );
  poly(
    [
      [w, 0],
      [w * 0.945, 0],
      [w * 0.967, h * 0.44],
      [w * 0.936, h * 0.718],
      [w, h * 0.76],
    ],
    '#29352d',
    '#72745a',
    2,
  );
  poly(
    [
      [0, 0],
      [w, 0],
      [w * 0.95, h * 0.04],
      [w * 0.75, h * 0.032],
      [w * 0.64, h * 0.023],
      [w * 0.36, h * 0.023],
      [w * 0.25, h * 0.032],
      [w * 0.05, h * 0.04],
    ],
    '#293329',
    '#686d53',
    1.5,
  );
  ln(w * 0.052, 0, w * 0.029, h * 0.43, '#0a130e', 5);
  ln(w * 0.029, h * 0.43, w * 0.059, h * 0.704, '#0a130e', 5);
  ln(w * 0.948, 0, w * 0.971, h * 0.43, '#0a130e', 5);
  ln(w * 0.971, h * 0.43, w * 0.941, h * 0.704, '#0a130e', 5);
  for (const side of [0, 1]) {
    const x = side ? w * 0.979 : w * 0.021;
    for (const y of [h * 0.1, h * 0.33, h * 0.6]) {
      circle(x, y, 3 * s, '#88866c', 1, '#18211a');
      ln(x - 2 * s, y, x + 2 * s, y, '#090e0b');
    }
  }
  // Lower frame, seams, ventilation slots, and panel fasteners.
  ln(w * 0.06, h * 0.987, w * 0.94, h * 0.987, '#6e6e52');
  for (let i = 0; i < 15; i++) {
    const x = w * 0.285 + i * w * 0.006;
    ln(x, h * 0.962, x + w * 0.0025, h * 0.986, '#101c15', 3 * s);
    const xr = w - x;
    ln(xr, h * 0.962, xr - w * 0.0025, h * 0.986, '#101c15', 3 * s);
  }
  for (const x of [w * 0.036, w * 0.274, w * 0.407, w * 0.593, w * 0.657, w * 0.963])
    for (const y of [h * 0.76, h * 0.972]) {
      circle(x, y, 3.2 * s, '#88856a', 1, '#18201a');
      ln(x - 1.5 * s, y + 1.5 * s, x + 1.5 * s, y - 1.5 * s, '#060f0a');
    }
  txt(chassisData().code + '  /  ' + chassisData().name, w * 0.081, h * 0.023, 9, '#b6b696');
  txt(
    'COCKPIT LINK 01  //  ' + (G.player.shutdown > 0 ? 'REACTOR OFFLINE' : 'ONLINE'),
    w * 0.92,
    h * 0.023,
    9,
    G.player.shutdown > 0 ? hudRed : '#b6b696',
    'right',
  );
  const py = h * 0.78,
    ph = h * 0.184,
    lx = w * 0.072,
    lw = w * 0.293;
  panelBox(lx, py, lw, ph, 'DAMAGE CONTROL / FRONT ARMOR');
  drawArmor(lx + lw * 0.24, py + ph * 0.61, ph * 0.62);
  const ax = lx + lw * 0.46,
    aw = lw * 0.48,
    rows = [
      ['CORE', 'core'],
      ['L. TORSO', 'leftTorso'],
      ['R. TORSO', 'rightTorso'],
      ['LEGS', null],
    ];
  rows.forEach((r, i) => {
    const y = py + 32 * s + (i * (ph - 40 * s)) / 4,
      ratio = r[1]
        ? Math.max(0, G.player.components[r[1]].hp / G.player.components[r[1]].max)
        : Math.max(
            0,
            (G.player.components.leftLeg.hp + G.player.components.rightLeg.hp) /
              (G.player.components.leftLeg.max + G.player.components.rightLeg.max),
          );
    txt(r[0], ax, y, 8, hudDim);
    const bw = aw * 0.42;
    rect(ax + aw * 0.38, y - 3 * s, bw, 5 * s, '#283c23');
    rect(ax + aw * 0.38, y - 3 * s, bw * ratio, 5 * s, damageColor(ratio));
    txt(
      String(Math.round(ratio * 100)).padStart(3, '0'),
      ax + aw,
      y,
      9,
      damageColor(ratio),
      'right',
    );
  });
  const cx = w * 0.413,
    cw = w * 0.174;
  panelBox(cx, py, cw, ph, 'SENSOR / 1,200 M');
  drawRadar(cx + cw / 2, py + ph * 0.58, Math.min(cw * 0.38, ph * 0.36));
  const wx = w * 0.635,
    ww = w * 0.293;
  panelBox(wx, py, ww, ph, 'WEAPON SYSTEMS / GROUP ' + (G.weaponIndex + 1));
  drawWeapons(wx + 8 * s, py + 27 * s, ww - 16 * s, ph - 34 * s);
  const stripY = h * 0.75;
  txt(
    'ARMOR ' + String(Math.round(playerArmor() * 100)).padStart(3, '0') + '%',
    lx,
    stripY,
    13,
    damageColor(playerArmor()),
  );
  txt('JET ' + Math.round(G.player.fuel) + '%', w * 0.5, stripY, 11, hudColor, 'center');
  txt(
    'COOLANT ' + G.player.coolants + ' / ' + config[G.loadout].coolants,
    wx + ww,
    stripY,
    11,
    hudColor,
    'right',
  );
  txt(
    '[R] TARGET   [I] IMAGING   [1–3] WEAPONS   [G] COOLANT',
    w * 0.5,
    h * 0.982,
    8,
    '#8b997b',
    'center',
  );
}

function drawArmor(cx, cy, size) {
  const s = size / 100;
  function shape(k, points) {
    const c = G.player.components[k],
      ratio = Math.max(0, c.hp / c.max),
      col = damageColor(ratio);
    poly(
      points.map((p) => [cx + p[0] * s, cy + p[1] * s]),
      ratio <= 0 ? '#22251c' : col + '25',
      col,
      1,
    );
    if (ratio <= 0) {
      ln(
        cx + points[0][0] * s,
        cy + points[0][1] * s,
        cx + points[2][0] * s,
        cy + points[2][1] * s,
        hudRed,
      );
    }
  }
  shape('head', [
    [-10, -44],
    [10, -44],
    [13, -30],
    [-13, -30],
  ]);
  shape('core', [
    [-12, -27],
    [12, -27],
    [11, 5],
    [-11, 5],
  ]);
  shape('leftTorso', [
    [-30, -31],
    [-15, -27],
    [-14, 3],
    [-26, 2],
  ]);
  shape('rightTorso', [
    [15, -27],
    [30, -31],
    [26, 2],
    [14, 3],
  ]);
  shape('leftArm', [
    [-41, -30],
    [-32, -33],
    [-29, 10],
    [-39, 13],
  ]);
  shape('rightArm', [
    [32, -33],
    [41, -30],
    [39, 13],
    [29, 10],
  ]);
  shape('leftLeg', [
    [-24, 8],
    [-7, 8],
    [-10, 33],
    [-10, 48],
    [-30, 48],
    [-29, 38],
  ]);
  shape('rightLeg', [
    [7, 8],
    [24, 8],
    [29, 38],
    [30, 48],
    [10, 48],
    [10, 33],
  ]);
  ln(cx - 9 * s, cy + 5 * s, cx + 9 * s, cy + 5 * s, hudDim);
}

function drawRadar(cx, cy, r) {
  ctx.save();
  circle(cx, cy, r, '#657d50', 1, '#102014');
  circle(cx, cy, r * 0.66, '#3c5434');
  circle(cx, cy, r * 0.33, '#334b2c');
  ln(cx - r, cy, cx + r, cy, '#354c2d');
  ln(cx, cy - r, cx, cy + r, '#354c2d');
  txt('N', cx, cy - r - 7 * G.hudScale, 8, hudDim, 'center');
  const sweep = G.realTime * 0.7;
  ln(cx, cy, cx + Math.sin(sweep) * r, cy - Math.cos(sweep) * r, '#8faa6955');
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.clip();
  for (const e of pools.entities) {
    if (!e.alive) continue;
    const dx = e.x - G.player.x,
      dz = e.z - G.player.z,
      a = -G.player.yaw,
      x = ((dx * Math.cos(a) + dz * Math.sin(a)) / 1200) * r,
      y = ((-dx * Math.sin(a) + dz * Math.cos(a)) / 1200) * r;
    if (Math.hypot(x, y) > r) continue;
    const c =
      e.type === 'tower' || e.type === 'uplink' || e.type === 'generator' || e.type === 'reactor'
        ? hudAmber
        : hudRed;
    if (G.target === e)
      corners(cx + x, cy + y, 10 * G.hudScale, 10 * G.hudScale, c, 3 * G.hudScale);
    if (e.type === 'mech')
      poly(
        [
          [cx + x, cy + y - 3],
          [cx + x - 3, cy + y + 3],
          [cx + x + 3, cy + y + 3],
        ],
        c,
      );
    else rect(cx + x - 2, cy + y - 2, 4, 4, c);
  }
  drawCoopRadar(cx, cy, r);
  {
    const n = navPoints()[G.navIndex];
    if (n?.active && !n.done) {
      const dx = n.x - G.player.x,
        dz = n.z - G.player.z,
        a = -G.player.yaw,
        x = ((dx * Math.cos(a) + dz * Math.sin(a)) / 1200) * r,
        y = ((-dx * Math.sin(a) + dz * Math.cos(a)) / 1200) * r;
      circle(cx + x, cy + y, 4, n.service ? '#80d6df' : hudColor);
    }
  }
  poly(
    [
      [cx, cy - 5],
      [cx - 3, cy + 4],
      [cx + 3, cy + 4],
    ],
    hudColor,
  );
  const twist = G.player.torso;
  ln(cx, cy, cx + Math.sin(twist) * r * 0.55, cy - Math.cos(twist) * r * 0.55, '#b0c78577');
  ctx.restore();
}

function drawWeapons(x, y, w, h) {
  const row = h / 3;
  for (let i = 0; i < 3; i++) {
    const wp = G.weapons[i],
      yy = y + i * row,
      disabled = weaponDisabled(i),
      selected = G.weaponIndex === i,
      c = disabled ? hudRed : selected ? hudColor : hudDim;
    if (selected) rect(x - 3, yy - 2, w + 6, row - 2, '#293d2466');
    txt(String(i + 1), x + 5 * G.hudScale, yy + row * 0.34, 11, c);
    txt(wp.name, x + 28 * G.hudScale, yy + row * 0.34, 11, c);
    const ammo =
      i === 0 ? '∞' : String(i === 1 ? G.player.ammo : G.player.missiles).padStart(2, '0');
    txt(ammo, x + w, yy + row * 0.34, 12, c, 'right');
    const status = disabled
      ? 'DISABLED'
      : wp.remaining > 0
        ? 'RECHARGE ' + wp.remaining.toFixed(1) + 's'
        : i === 2 && G.lock < 1
          ? 'LOCK REQUIRED'
          : 'READY';
    txt(status, x + 28 * G.hudScale, yy + row * 0.72, 8, wp.remaining > 0 ? hudAmber : c);
    const bx = x + w * 0.72,
      bw = w * 0.19;
    rect(bx, yy + row * 0.66, bw, 3 * G.hudScale, '#33482a');
    rect(
      bx,
      yy + row * 0.66,
      bw * (disabled ? 0 : 1 - wp.remaining / wp.cooldown),
      3 * G.hudScale,
      c,
    );
    if (i < 2) ln(x, yy + row - 2, x + w, yy + row - 2, '#33462a');
  }
}

function drawCompass() {
  const w = camera.screenW,
    h = camera.screenH,
    s = G.hudScale,
    cx = w * 0.5,
    y = h * 0.075,
    span = w * 0.34,
    yaw = G.player.yaw + G.player.torso;
  const hdg = (yaw / DEG + 360) % 360;
  ln(cx - span / 2, y, cx + span / 2, y, '#77936288');
  for (let d = -60; d <= 60; d += 5) {
    const ang = Math.floor(hdg / 5) * 5 + d,
      off = wrap(ang * DEG - yaw) / DEG,
      x = cx + (off / 120) * span;
    if (Math.abs(x - cx) > span / 2) continue;
    const major = ang % 30 === 0;
    ln(x, y, x, y + (major ? 9 : 4) * s, major ? hudColor : hudDim);
    if (major) {
      const a = ((ang % 360) + 360) % 360,
        label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[a] || String(a).padStart(3, '0');
      txt(label, x, y - 10 * s, 10, hudColor, 'center');
    }
  }
  poly(
    [
      [cx - 4 * s, y - 2 * s],
      [cx + 4 * s, y - 2 * s],
      [cx, y + 4 * s],
    ],
    hudAmber,
  );
  txt(String(Math.round(hdg) % 360).padStart(3, '0'), cx, y + 23 * s, 11, hudColor, 'center');
}

export function navPoints() {
  return [
    {
      x: structures.relay.x,
      z: structures.relay.z,
      name: 'ALPHA',
      desc: 'RELAY',
      done: G.missionFlags[0],
      active: !G.missionFlags[2],
      y: structures.relay.y + 65,
    },
    {
      x: structures.uplink.x,
      z: structures.uplink.z,
      name: 'BRAVO',
      desc: 'UPLINK',
      done: G.missionFlags[1],
      active: !G.missionFlags[2],
      y: structures.uplink.y + 55,
    },
    {
      x: canyonNav.x,
      z: canyonNav.z,
      name: 'CHARLIE',
      desc: 'NEEDLE PASS',
      done: G.missionFlags[3],
      active: G.missionFlags[2],
      y: terrainY(canyonNav.x, canyonNav.z) + 18,
    },
    {
      x: structures.westFeed.x,
      z: structures.westFeed.z,
      name: 'DELTA',
      desc: 'WEST FEED',
      done: !structures.westFeed.alive,
      active: G.missionFlags[3],
      y: structures.westFeed.y + 38,
    },
    {
      x: structures.eastFeed.x,
      z: structures.eastFeed.z,
      name: 'ECHO',
      desc: 'EAST FEED',
      done: !structures.eastFeed.alive,
      active: G.missionFlags[3],
      y: structures.eastFeed.y + 38,
    },
    {
      x: structures.reactor.x,
      z: structures.reactor.z,
      name: 'FOXTROT',
      desc: reactorShielded() ? 'REACTOR / SHIELDED' : 'REACTOR / EXPOSED',
      done: !structures.reactor.alive,
      active: G.missionFlags[3],
      y: structures.reactor.y + 63,
    },
    {
      x: ridgeNav.x,
      z: ridgeNav.z,
      name: 'GOLF',
      desc: 'CINDER CUT',
      done: G.missionFlags[5],
      active: G.missionFlags[3] && G.missionFlags[4],
      y: terrainY(ridgeNav.x, ridgeNav.z) + 20,
    },
    {
      x: structures.skyguard.x,
      z: structures.skyguard.z,
      name: 'HOTEL',
      desc: 'SKYGUARD BATTERY',
      done: G.missionFlags[6],
      active: G.missionFlags[5],
      y: structures.skyguard.y + 35,
    },
    {
      x: flightLink.x,
      z: flightLink.z,
      name: 'INDIA',
      desc: 'FLIGHT LINK / ' + Math.floor((G.linkTime / flightLink.duration) * 100) + '%',
      done: G.missionFlags[7],
      active: G.missionFlags[5] && G.missionFlags[6],
      y: terrainY(flightLink.x, flightLink.z) + 14,
    },
    {
      x: extraction.x,
      z: extraction.z,
      name: 'JULIET',
      desc: 'EXTRACTION',
      done: false,
      active: allObjectivesComplete(),
      y: terrainY(extraction.x, extraction.z) + 9,
    },
    {
      x: serviceBay.x,
      z: serviceBay.z,
      name: 'SERVICE 01',
      desc: 'STOP TO REPAIR',
      service: true,
      done: G.serviceUsed,
      active: G.missionFlags[2],
      y: terrainY(serviceBay.x, serviceBay.z) + 33,
    },
    {
      x: supplyBay.x,
      z: supplyBay.z,
      name: 'SERVICE 02',
      desc: 'STOP TO REPAIR',
      service: true,
      done: G.supplyUsed,
      active: G.missionFlags[3] && G.missionFlags[4],
      y: terrainY(supplyBay.x, supplyBay.z) + 32,
    },
  ];
}

function drawNav() {
  const points = navPoints();
  for (let i = 0; i < points.length; i++) {
    const n = points[i];
    if (n.done || !n.active) continue;
    const p = project([n.x, n.y, n.z]);
    if (
      !p ||
      p.x < camera.screenW * 0.09 ||
      p.x > camera.screenW * 0.91 ||
      p.y < camera.screenH * 0.14 ||
      p.y > camera.screenH * 0.68
    )
      continue;
    const col = n.service ? '#80d6df' : i === G.navIndex ? hudColor : '#8fa87888',
      sz = 6 * G.hudScale;
    poly(
      [
        [p.x, p.y - sz],
        [p.x + sz, p.y],
        [p.x, p.y + sz],
        [p.x - sz, p.y],
      ],
      null,
      col,
    );
    txt(
      n.name + ' / ' + Math.round(dist2(G.player, n)) + ' M',
      p.x,
      p.y - 16 * G.hudScale,
      9,
      col,
      'center',
    );
    txt(n.desc, p.x, p.y + 17 * G.hudScale, 8, col, 'center');
  }
  const n = points[G.navIndex];
  if (n && !n.done && n.active) {
    const d = wrap(
      Math.atan2(n.x - G.player.x, -(n.z - G.player.z)) - (G.player.yaw + G.player.torso),
    );
    if (Math.abs(d) > 0.6) {
      const side = d > 0 ? 1 : -1,
        x = camera.screenW * (side > 0 ? 0.895 : 0.105),
        y = camera.screenH * 0.29;
      poly(
        [
          [x + side * 8, y],
          [x - side * 1, y - 5],
          [x - side * 1, y + 5],
        ],
        hudColor,
      );
      txt(n.name, x - side * 16, y, 9, hudColor, side > 0 ? 'right' : 'left');
    }
  }
}

function drawTarget() {
  if (!G.target?.alive) return;
  const c = center(G.target),
    p = project(c),
    distance = dist2(G.player, G.target),
    s = G.hudScale,
    color = G.lock >= 1 ? hudAmber : hudRed;
  if (
    p &&
    p.x > camera.screenW * 0.065 &&
    p.x < camera.screenW * 0.935 &&
    p.y > camera.screenH * 0.105 &&
    p.y < camera.screenH * 0.7
  ) {
    const height = G.target.type === 'mech' ? 22 * G.target.scale : G.target.height || 12;
    const half = clamp(
        (height / (2 * Math.tan(camera.fov / 2) * p.w)) * camera.screenH * 0.52,
        18 * s,
        110 * s,
      ),
      bw = G.target.type === 'tower' ? half * 0.65 : half * 0.8;
    corners(p.x, p.y, bw * 2, half * 2, color, 7 * s);
    txt(G.target.name, p.x - bw, p.y - half - 11 * s, 10, color);
    txt(Math.round(distance) + ' M', p.x - bw, p.y + half + 11 * s, 10, color);
    const ratio = entityHealth(G.target);
    rect(p.x - bw, p.y + half + 22 * s, bw * 2, 3 * s, '#473b26');
    rect(p.x - bw, p.y + half + 22 * s, bw * 2 * ratio, 3 * s, color);
    if (G.lock > 0) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(half, bw) + 7 * s, -Math.PI / 2, -Math.PI / 2 + TAU * G.lock);
      ctx.strokeStyle = G.lock >= 1 ? hudAmber : color + '66';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  txt(
    'TARGET / ' + G.target.name,
    camera.screenW * 0.92,
    camera.screenH * 0.135,
    10,
    color,
    'right',
  );
  txt(
    (G.lock >= 1
      ? 'LOCKED'
      : G.lock > 0
        ? 'ACQUIRING ' + Math.round(G.lock * 100) + '%'
        : 'NO LOCK') +
      '  /  ' +
      Math.round(distance) +
      ' M',
    camera.screenW * 0.92,
    camera.screenH * 0.158,
    10,
    color,
    'right',
  );
  if (
    !p ||
    p.x < camera.screenW * 0.07 ||
    p.x > camera.screenW * 0.93 ||
    p.y > camera.screenH * 0.7 ||
    p.y < camera.screenH * 0.1
  ) {
    const d = wrap(
        Math.atan2(G.target.x - G.player.x, -(G.target.z - G.player.z)) -
          (G.player.yaw + G.player.torso),
      ),
      side = d > 0 ? 1 : -1,
      x = camera.screenW * (side > 0 ? 0.895 : 0.105),
      y = camera.screenH * 0.37;
    poly(
      [
        [x + side * 10, y],
        [x - side * 2, y - 6],
        [x - side * 2, y + 6],
      ],
      color,
    );
    txt('TARGET', x - side * 18, y, 9, color, side > 0 ? 'right' : 'left');
  }
}

export function drawFlightHUD() {
  const w = camera.screenW,
    h = camera.screenH,
    s = G.hudScale,
    cx = w * 0.5,
    cy = h * 0.43,
    accent = G.player.shutdown > 0 ? hudRed : hudColor;
  drawCompass();
  drawNav();
  drawTarget();
  // Velocity and heat ladders remain visible through the canopy.
  const sy = h * 0.36,
    bh = h * 0.23,
    x = w * 0.09;
  ln(x, sy, x, sy + bh, hudDim);
  for (let i = 0; i <= 8; i++) {
    const y = sy + bh - (i / 8) * bh;
    ln(x - 4 * s, y, x + (i % 2 === 0 ? 8 : 4) * s, y, hudDim);
    if (i % 2 === 0)
      txt(
        String(Math.round((i / 8) * chassisData().speed * 3.6)),
        x - 10 * s,
        y,
        8,
        hudDim,
        'right',
      );
  }
  const v = clamp(Math.abs(G.player.speed) / chassisData().speed, 0, 1);
  rect(x + 4 * s, sy + bh * (1 - v), 4 * s, bh * v, hudColor);
  const ty = sy + bh * (1 - clamp(G.player.throttle, 0, 1));
  poly(
    [
      [x + 12 * s, ty],
      [x + 20 * s, ty - 4 * s],
      [x + 20 * s, ty + 4 * s],
    ],
    hudAmber,
  );
  txt(
    String(Math.round(G.player.speed * 3.6)).padStart(2, '0'),
    x + 3 * s,
    sy + bh + 25 * s,
    26,
    hudColor,
    'center',
  );
  txt('KM/H', x + 3 * s, sy + bh + 45 * s, 9, hudDim, 'center');
  txt(
    'THR ' + Math.round(G.player.throttle * 100) + '%',
    x + 2 * s,
    sy - 20 * s,
    9,
    hudColor,
    'center',
  );
  const hx = w * 0.91;
  ln(hx, sy, hx, sy + bh, hudDim);
  for (let i = 0; i <= 10; i++) {
    const y = sy + bh - (i / 10) * bh;
    ln(hx - (i % 2 === 0 ? 8 : 4) * s, y, hx + 4 * s, y, i >= 8 ? hudAmber : hudDim);
    if (i % 2 === 0) txt(String(i * 10), hx + 10 * s, y, 8, i >= 8 ? hudAmber : hudDim);
  }
  const heat = clamp(G.player.heat / 100, 0, 1),
    hc = G.player.heat > 82 ? hudRed : G.player.heat > 60 ? hudAmber : hudColor;
  rect(hx - 8 * s, sy + bh * (1 - heat), 4 * s, bh * heat, hc);
  txt(Math.round(G.player.heat) + '%', hx - 2 * s, sy + bh + 25 * s, 26, hc, 'center');
  txt('HEAT', hx - 2 * s, sy + bh + 45 * s, 9, hudDim, 'center');
  txt(G.player.shutdown > 0 ? 'OFFLINE' : 'REACTOR', hx - 2 * s, sy - 20 * s, 9, hc, 'center');
  // Center sight: four separated brackets, a precise aiming point, and range ticks.
  const gap = 11 * s,
    arm = 13 * s;
  for (const side of [-1, 1]) {
    ln(cx + side * gap, cy, cx + side * (gap + arm), cy, accent);
    ln(cx, cy + side * gap, cx, cy + side * (gap + arm), accent);
  }
  rect(cx - s, cy - s, 2 * s, 2 * s, hudAmber);
  corners(cx, cy, 64 * s, 64 * s, accent + '88', 6 * s);
  if (G.lock >= 1) {
    txt('LOCK', cx, cy + 49 * s, 9, hudAmber, 'center');
  }
  if (G.zoom) txt('2.1×', cx + 53 * s, cy, 10, hudColor);
  if (G.player.vision && !G.player.imaging)
    txt('NIGHT VISION', cx, cy - 49 * s, 9, hudColor, 'center');
  for (const n of [-10, -5, 5, 10]) {
    const y = cy + (G.player.pitch / DEG - n) * h * 0.009;
    if (y < h * 0.24 || y > h * 0.62) continue;
    ln(cx - 65 * s, y, cx - 40 * s, y, '#9cb88355');
    ln(cx + 40 * s, y, cx + 65 * s, y, '#9cb88355');
    txt(String(n), cx + 74 * s, y, 8, '#99b27a88');
  }
  const by = h * 0.678,
    bw = 120 * s;
  ln(cx - bw, by, cx + bw, by, hudDim);
  for (let i = -2; i <= 2; i++)
    ln(cx + (i * bw) / 2, by - 3 * s, cx + (i * bw) / 2, by + 3 * s, hudDim);
  const tx = cx + (G.player.torso / 1.68) * bw;
  poly(
    [
      [tx, by - 2 * s],
      [tx - 4 * s, by - 9 * s],
      [tx + 4 * s, by - 9 * s],
    ],
    hudAmber,
  );
  poly(
    [
      [cx, by + 2 * s],
      [cx - 3 * s, by + 7 * s],
      [cx + 3 * s, by + 7 * s],
    ],
    hudColor,
  );
  txt(
    'TORSO ' +
      (G.player.torso < 0 ? '−' : '+') +
      String(Math.round(Math.abs(G.player.torso) / DEG)).padStart(2, '0') +
      '°',
    cx,
    by + 20 * s,
    9,
    hudColor,
    'center',
  );
  txt(
    'OP. IRON ECHO / ' +
      (G.missionStage === 'basin'
        ? '01'
        : ['transit', 'works'].includes(G.missionStage)
          ? '02'
          : '03'),
    w * 0.08,
    h * 0.134,
    11,
    hudColor,
  );
  txt(
    formatTime(G.missionTime) + ' / ' + G.difficulty.toUpperCase(),
    w * 0.08,
    h * 0.155,
    9,
    hudDim,
  );
  const objs =
    G.missionStage === 'basin'
      ? [
          ['RELAY', G.missionFlags[0]],
          ['UPLINK', G.missionFlags[1]],
          ['BASIN GUARDS ' + basinThreats().length, G.missionFlags[2]],
        ]
      : G.missionStage === 'transit'
        ? [
            ['BASIN SECURED', true],
            ['CROSS NEEDLE PASS', G.missionFlags[3]],
            ['REPAIR BAY / OPTIONAL', G.serviceUsed],
          ]
        : G.missionStage === 'works'
          ? [
              ['WEST POWER FEED', !structures.westFeed.alive],
              ['EAST POWER FEED', !structures.eastFeed.alive],
              [
                reactorShielded() ? 'REACTOR SHIELDED' : 'REACTOR EXPOSED',
                !structures.reactor.alive,
              ],
            ]
          : G.missionStage === 'ridgeTransit'
            ? [
                ['ASHFALL REACTOR DOWN', true],
                ['CROSS CINDER CUT / GOLF', G.missionFlags[5]],
                ['RIDGE BAY / OPTIONAL', G.supplyUsed],
              ]
            : G.missionStage === 'ridge'
              ? [
                  ['CINDER CUT CROSSED', true],
                  ['SKYGUARD / NAV HOTEL', G.missionFlags[6]],
                  ['FLIGHT CODES / LOCKED', false],
                ]
              : G.missionStage === 'link'
                ? [
                    ['SKYGUARD DESTROYED', true],
                    [
                      'FLIGHT CODES ' + Math.floor((G.linkTime / flightLink.duration) * 100) + '%',
                      G.linkTime >= flightLink.duration,
                    ],
                    [
                      'RESPONSE ' +
                        ridgeResponseThreats().length +
                        ' / WAVE ' +
                        G.linkWave +
                        ' OF 2',
                      G.linkWave === 2 && ridgeResponseThreats().length === 0,
                    ],
                  ]
                : [
                    ['FLIGHT CODES SECURED', true],
                    ['NAV JULIET / EXTRACT', G.extractTime >= 5],
                    ['LANDING ZONE CLEAR', landingThreats().length === 0],
                  ];
  for (let i = 0; i < objs.length; i++)
    txt(
      (objs[i][1] ? '[×] ' : '[ ] ') + objs[i][0],
      w * 0.08,
      h * 0.19 + i * 18 * s,
      9,
      objs[i][1] ? hudDim : hudColor,
    );
  txt('HOSTILES DESTROYED / ' + G.kills, w * 0.08, h * 0.19 + 56 * s, 8, hudDim);
  if (G.radio.length) {
    const r = G.radio[G.radio.length - 1];
    ctx.save();
    ctx.globalAlpha = clamp(r.time, 0, 1);
    ctx.font = Math.round(11 * s) + 'px monospace';
    const max = w * 0.61,
      words = r.text.split(' '),
      lines = [''];
    for (const word of words) {
      const i = lines.length - 1;
      if (ctx.measureText(lines[i] + word).width > max && lines[i]) lines.push(word + ' ');
      else lines[i] += word + ' ';
    }
    lines.forEach((t, i) => txt(t.trim(), cx, h * 0.218 + i * 15 * s, 11, hudColor, 'center'));
    ctx.restore();
  }
  if (G.player.imaging) {
    txt('ENHANCED IMAGING / [I]', cx, h * 0.135, 11, '#81e5bf', 'center');
    txt('MESH EDGES / ARMOR SCAN', cx, h * 0.156, 8, '#63b392', 'center');
    if (G.target?.alive && G.target.type === 'mech') {
      const tr = trace(fireOrigin(), forward(), G.weapons[G.weaponIndex].range, false);
      if (tr.entity === G.target) {
        const cp = G.target.components[tr.component],
          name = tr.component.replace(/([A-Z])/g, ' $1').toUpperCase();
        txt(
          name + ' / ' + Math.max(0, Math.round((cp.hp / cp.max) * 100)) + '% ARMOR',
          cx,
          cy + 69 * s,
          10,
          damageColor(cp.hp / cp.max),
          'center',
        );
      }
    }
  }
  if (G.sectorBanner && G.sectorBanner.time > 0) {
    ctx.save();
    ctx.globalAlpha = clamp(G.sectorBanner.time, 0, 1);
    rect(cx - 228 * s, h * 0.305, 456 * s, 57 * s, '#0c1715e8', '#758e68');
    txt(G.sectorBanner.title, cx, h * 0.305 + 20 * s, 18, hudColor, 'center');
    txt(G.sectorBanner.sub, cx, h * 0.305 + 42 * s, 9, hudAmber, 'center');
    ctx.restore();
  }
  for (const b of [
    {
      p: serviceBay,
      on: G.missionFlags[2] && !G.serviceUsed,
      time: G.serviceTime,
      name: 'FIELD BAY',
    },
    { p: supplyBay, on: G.missionFlags[4] && !G.supplyUsed, time: G.supplyTime, name: 'RIDGE BAY' },
  ]) {
    if (!b.on || dist2(G.player, b.p) >= b.p.r + 10) continue;
    const text =
      G.player.altitude >= 3
        ? 'LAND INSIDE THE RING'
        : Math.abs(G.player.speed) >= 1.5
          ? b.name + ' / PRESS X TO STOP'
          : 'REPAIR / ' + Math.max(0, 6 - b.time).toFixed(1) + 's';
    rect(cx - 150 * s, h * 0.56, 300 * s, 32 * s, '#0b2022ed', '#80d6df');
    txt(text, cx, h * 0.56 + 13 * s, 11, '#80d6df', 'center');
    rect(cx - 146 * s, h * 0.56 + 27 * s, 292 * s * clamp(b.time / 6, 0, 1), 3 * s, '#80d6df');
  }
  if (G.missionStage === 'link' && G.player.shutdown <= 0) {
    const col = G.linkBlocked ? hudAmber : '#80d6df',
      pct = Math.floor((G.linkTime / flightLink.duration) * 100);
    rect(cx - 222 * s, h * 0.557, 444 * s, 64 * s, '#0b1b1ded', col);
    txt(
      'FLIGHT CONTROL / ' +
        pct +
        '% / ' +
        Math.max(0, flightLink.duration - G.linkTime).toFixed(1) +
        's',
      cx,
      h * 0.557 + 13 * s,
      11,
      col,
      'center',
    );
    txt(G.linkStatus, cx, h * 0.557 + 32 * s, 9, col, 'center');
    txt('TURN AND FIRE / PROGRESS SAVED WHEN PAUSED', cx, h * 0.557 + 47 * s, 8, hudDim, 'center');
    rect(
      cx - 217 * s,
      h * 0.557 + 59 * s,
      (434 * s * G.linkTime) / flightLink.duration,
      3 * s,
      col,
    );
  }

  if (allObjectivesComplete() && dist2(G.player, extraction) < extraction.r + 35) {
    const msg =
      G.transportTime < 14
        ? 'TRANSPORT INBOUND / ' + Math.ceil(14 - G.transportTime) + 's'
        : landingThreats().length
          ? 'LANDING ZONE CONTESTED'
          : Math.abs(G.player.speed) >= 2.2
            ? 'PRESS X / STOP FOR EXTRACTION'
            : G.player.altitude >= 3
              ? 'LAND INSIDE THE ZONE'
              : 'HOLD POSITION';
    txt(msg, cx, h * 0.56, 12, hudColor, 'center');
  }
  if (G.extractTime > 0) {
    rect(cx - 110 * s, h * 0.59, 220 * s, 35 * s, '#102315d9', hudColor);
    rect(cx - 107 * s, h * 0.59 + 30 * s, (214 * s * G.extractTime) / 5, 3 * s, hudColor);
    txt(
      'EXTRACTING / ' + Math.max(0, 5 - G.extractTime).toFixed(1) + 's',
      cx,
      h * 0.59 + 15 * s,
      12,
      hudColor,
      'center',
    );
  }
  if (G.player.shutdown > 0) {
    rect(cx - 190 * s, h * 0.54, 380 * s, 59 * s, '#20160ee8', hudRed);
    txt('REACTOR SHUTDOWN', cx, h * 0.54 + 18 * s, 20, hudRed, 'center');
    txt(
      'COOLING ' + G.player.shutdown.toFixed(1) + 's  /  [G] COOLANT',
      cx,
      h * 0.54 + 42 * s,
      10,
      hudAmber,
      'center',
    );
  } else if (G.player.heat > 82 && Math.sin(G.realTime * 5) > 0)
    txt('HEAT CRITICAL', cx, h * 0.56, 15, hudRed, 'center');
  if (G.missionTime < 20 && G.state === 'playing')
    txt(
      '[B] FULL THROTTLE  ·  [R] TARGET  ·  [I] IMAGING  ·  [H] HELP',
      cx,
      h * 0.625,
      10,
      hudColor,
      'center',
    );
}
