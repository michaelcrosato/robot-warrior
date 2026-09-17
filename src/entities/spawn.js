/**
 * Entity construction and the mission roster.
 */
import { G } from '../sim/state.js';
import { TAU, dist2, hex, rand, random, resetRandom } from '../core/math.js';
import { batterySite, flightLink, reactorSite } from '../world/sites.js';
import { collides } from '../sim/movement.js';
import { compSpec, componentNames } from '../data/chassis.js';
import { coopScaleEntity } from '../net/protocol.js';
import { enemyModels } from './models.js';
import { packParts, part, releaseMesh } from '../core/renderer.js';
import { palette } from '../core/palette.js';
import { pools, structures } from './pools.js';
import { terrainY } from '../world/terrain.js';

export function makeMech(x, z, name, type = 'medium') {
  if (collides(x, z, 0, 7)) {
    let found = false;
    for (let r = 15; r <= 150 && !found; r += 15)
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU,
          xx = x + Math.sin(a) * r,
          zz = z + Math.cos(a) * r;
        if (!collides(xx, zz, 0, 7)) {
          x = xx;
          z = zz;
          found = true;
          break;
        }
      }
  }
  const scale = type === 'scout' ? 0.74 : type === 'heavy' ? 1.1 : 0.93,
    health = type === 'scout' ? 0.73 : type === 'heavy' ? 1.35 : 1,
    components = {};
  for (const k of componentNames)
    components[k] = { hp: compSpec[k].hp * health, max: compSpec[k].hp * health };
  const o = {
    id: ++pools.entityID,
    type: 'mech',
    class: type,
    name,
    x,
    z,
    y: terrainY(x, z),
    yaw: Math.PI,
    scale,
    components,
    alive: true,
    phase: rand(0, TAU),
    speed: 0,
    cooldown: rand(1, 3),
    missileCooldown: rand(7, 12),
    alert: false,
    contact: false,
    strafe: random() < 0.5 ? -1 : 1,
    hitFlash: 0,
    deathTime: 0,
    model: enemyModels[type] || enemyModels.medium,
  };
  coopScaleEntity(o);
  pools.entities.push(o);
  return o;
}

function createTower() {
  const x = -95,
    z = -435,
    y = terrainY(x, z),
    parts = [];
  const put = (g, p, s, c, r = [0, 0, 0], glow = 0) => parts.push(part(g, p, s, c, r, glow));
  put('bevel', [0, 4, 0], [25, 8, 24], hex('#74796b'));
  put('box', [0, 8, 0], [27, 1, 26], palette.edge);
  for (const s of [-1, 1])
    for (const t of [-1, 1]) {
      put('bevel', [s * 7, 23, t * 7], [2.1, 34, 2.1], palette.light, [0, 0, s * 0.08]);
      put('box', [s * 7, 39, t * 7], [1.6, 2, 1.6], palette.accent, [0, 0, 0], 0.8);
    }
  for (let i = 0; i < 4; i++) {
    put('box', [0, 12 + i * 8, 0], [17, 1, 17], hex('#858a78'));
    put('box', [0, 16 + i * 8, 7], [20, 0.9, 0.9], hex('#6e796c'), [0, 0, i % 2 ? 0.38 : -0.38]);
  }
  put('bevel', [0, 41, 0], [21, 5, 19], palette.dark);
  put('box', [0, 42, 9.8], [16, 1.2, 0.35], palette.accent, [0, 0, 0], 0.6);
  put('cyl', [0, 50, 0], [1.2, 16, 1.2], palette.light);
  put('cyl', [0, 58.6, 0], [1.9, 1.4, 1.9], hex('#f27346'), [0, 0, 0], 1);
  put('dish', [0, 47, 3], [20, 20, 20], palette.light, [-0.2, 0.7, 0]);
  const o = {
    id: ++pools.entityID,
    type: 'tower',
    name: 'RELAY TOWER',
    x,
    z,
    y,
    scale: 1,
    yaw: Math.PI,
    parts: packParts(parts),
    alive: true,
    height: 60,
    radius: 15,
    hp: 230,
    maxHP: 230,
    hitFlash: 0,
    deathTime: 0,
    objective: 0,
  };
  pools.entities.push(o);
  return o;
}

function createUplink() {
  const parts = [],
    x = 140,
    z = -745,
    y = terrainY(x, z),
    put = (g, p, s, c, r = [0, 0, 0], glow = 0) => parts.push(part(g, p, s, c, r, glow));
  put('bevel', [0, 7, 0], [47, 14, 40], hex('#898779'));
  put('box', [0, 14.3, 0], [45, 1, 38], hex('#a4a28b'));
  put('bevel', [0, 19, 0], [15, 10, 15], palette.dark);
  put('cyl', [0, 26, 0], [4, 14, 4], palette.edge);
  put('dish', [0, 32, 0], [49, 49, 49], palette.light, [-0.48, -0.3, 0]);
  put('cyl', [0, 36, 7], [0.7, 22, 0.7], palette.dark, [-0.55, 0, 0]);
  for (let i = -2; i <= 2; i++)
    put('box', [i * 8, 10.2, 20.1], [5, 2, 0.3], palette.visor, [0, 0, 0], 0.4);
  for (const s of [-1, 1]) {
    put('bevel', [s * 17, 16, -8], [7, 4, 9], palette.armor);
    put('cyl', [s * 21, 22, -17], [0.6, 16, 0.6], palette.edge);
    put('cyl', [s * 21, 30.4, -17], [1, 1, 1], palette.accent, [0, 0, 0], 0.8);
  }
  const o = {
    id: ++pools.entityID,
    type: 'uplink',
    name: 'UPLINK STATION',
    x,
    z,
    y,
    scale: 1,
    yaw: Math.PI,
    parts: packParts(parts),
    alive: true,
    height: 51,
    radius: 27,
    hp: 330,
    maxHP: 330,
    hitFlash: 0,
    deathTime: 0,
    objective: 1,
  };
  pools.entities.push(o);
  return o;
}

function createTurret(x, z, name) {
  const o = {
    id: ++pools.entityID,
    type: 'turret',
    name,
    x,
    z,
    y: terrainY(x, z),
    scale: 1,
    yaw: Math.PI,
    alive: true,
    height: 9,
    radius: 5,
    hp: 115,
    maxHP: 115,
    cooldown: rand(3, 5),
    hitFlash: 0,
    deathTime: 0,
    alert: false,
  };
  coopScaleEntity(o);
  pools.entities.push(o);
  return o;
}

function createPowerFeed(x, z, name) {
  const parts = [],
    put = (g, p, s, c, r = [0, 0, 0], glow = 0) => parts.push(part(g, p, s, c, r, glow));
  put('bevel', [0, 4, 0], [25, 8, 25], hex('#748078'));
  put('box', [0, 8.2, 0], [27, 1, 27], palette.edge);
  for (const side of [-1, 1]) {
    put('cyl', [side * 6, 17, 0], [7, 18, 7], palette.dark);
    for (const y of [11, 16, 21]) put('cyl', [side * 6, y, 0], [8.2, 1.8, 8.2], palette.edge);
    put('cyl', [side * 6, 27, 0], [3, 3, 3], hex('#71cdd0'), [0, 0, 0], 0.8);
  }
  put('bevel', [0, 31, 0], [23, 4, 8], hex('#7e9389'));
  put('box', [0, 30.8, 4.3], [16, 1.2, 0.3], hex('#8cdddb'), [0, 0, 0], 0.7);
  const o = {
    id: ++pools.entityID,
    type: 'generator',
    zone: 'works',
    name,
    x,
    z,
    y: terrainY(x, z),
    yaw: 0,
    scale: 1,
    alive: true,
    height: 34,
    radius: 15,
    hp: 240,
    maxHP: 240,
    parts: packParts(parts),
    hitFlash: 0,
    deathTime: 0,
  };
  pools.entities.push(o);
  return o;
}

function createReactor() {
  const parts = [],
    put = (g, p, s, c, r = [0, 0, 0], glow = 0) => parts.push(part(g, p, s, c, r, glow));
  put('bevel', [0, 4, 0], [64, 8, 64], hex('#58665f'));
  put('cyl', [0, 23, 0], [31, 40, 31], hex('#6e817b'));
  for (const y of [9, 21, 34, 43]) put('cyl', [0, y, 0], [39, 3, 39], hex('#93a08b'));
  put('cyl', [0, 50, 0], [23, 13, 23], palette.dark);
  put('cyl', [0, 57, 0], [25, 2, 25], palette.edge);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU,
      x = Math.sin(a) * 17,
      z = Math.cos(a) * 17;
    put('box', [x, 26, z], [3, 28, 2], hex('#d8a96b'), [0, a, 0], 0.6);
    put('bevel', [x * 1.6, 10, z * 1.6], [8, 13, 8], palette.dark, [0, a, 0]);
  }
  const o = {
    id: ++pools.entityID,
    type: 'reactor',
    zone: 'works',
    name: 'ASHFALL REACTOR',
    x: reactorSite.x,
    z: reactorSite.z,
    y: terrainY(reactorSite.x, reactorSite.z),
    yaw: 0,
    scale: 1,
    alive: true,
    height: 59,
    radius: 31,
    hp: 620,
    maxHP: 620,
    parts: packParts(parts),
    hitFlash: 0,
    deathTime: 0,
  };
  pools.entities.push(o);
  return o;
}

function createSkyguard() {
  const e = createTurret(batterySite.x, batterySite.z, 'SKYGUARD BATTERY'),
    parts = [];
  const put = (g, p, s, c, r = [0, 0, 0], glow = 0) => parts.push(part(g, p, s, c, r, glow));
  put('bevel', [0, 3, 0], [43, 6, 36], hex('#50615c'));
  put('cyl', [0, 7, 0], [22, 6, 22], palette.dark);
  put('bevel', [0, 12, 0], [13, 10, 17], hex('#829185'));
  put('box', [0, 13, 8.7], [9, 2, 0.4], palette.accent, [0, 0, 0], 0.7);
  for (const side of [-1, 1]) {
    put('bevel', [side * 13, 13, 0], [13, 14, 26], hex('#697e73'));
    put('box', [side * 13, 14, 13.3], [10, 9, 0.5], palette.dark);
    for (let j = 0; j < 3; j++) {
      put('cyl', [side * 13 + (j - 1) * 3, 14, 14], [2.4, 4, 2.4], palette.light, [
        Math.PI / 2,
        0,
        0,
      ]);
      put('cyl', [side * 13 + (j - 1) * 3, 14, 16.1], [1.6, 0.3, 1.6], palette.dark, [
        Math.PI / 2,
        0,
        0,
      ]);
    }
    put('box', [side * 13, 20.2, 0], [10, 0.5, 19], palette.accent);
  }
  put('cyl', [0, 21, -5], [1.5, 12, 1.5], palette.edge);
  put('dish', [0, 27, -5], [16, 9, 10], hex('#b0beb0'), [-0.25, 0, 0]);
  Object.assign(e, {
    zone: 'ridge',
    skyguard: true,
    height: 31,
    radius: 23,
    hitRadius: 20,
    centerHeight: 13,
    collisionRadius: 24,
    collisionHeight: 9,
    hp: 470,
    maxHP: 470,
    parts: packParts(parts),
  });
  return e;
}

export const ridgeResponseThreats = () => pools.entities.filter((e) => e.alive && e.assaultLink);

export const linkThreats = () =>
  pools.entities.filter(
    (e) => e.alive && (e.type === 'mech' || e.type === 'turret') && dist2(e, flightLink) < 90,
  );

export const ridgeGateLocked = () => !G.missionFlags[3] || !G.missionFlags[4];

export const basinThreats = () =>
  pools.entities.filter(
    (e) => e.alive && e.zone === 'basin' && (e.type === 'mech' || e.type === 'turret'),
  );

export const reactorShielded = () => !!(structures.westFeed?.alive || structures.eastFeed?.alive);

export const allObjectivesComplete = () => G.missionFlags.every(Boolean);

export function populate() {
  for (const e of pools.entities)
    if (e.parts) for (const p of e.parts) if (p.owned) releaseMesh(p.g);
  pools.entities = [];
  pools.particles = [];
  pools.beams = [];
  pools.projectiles = [];
  pools.wrecks = [];
  pools.entityID = 0;
  resetRandom(56711);
  structures.relay = createTower();
  structures.uplink = createUplink();
  makeMech(-42, -176, 'HOUND 01', 'scout');
  makeMech(118, -354, 'HOUND 02', 'medium');
  makeMech(60, -620, 'BASTION 03', 'heavy');
  createTurret(-72, -396, 'SENTRY 04');
  createTurret(186, -701, 'SENTRY 05');
  for (const e of pools.entities) e.zone = 'basin';
  structures.westFeed = createPowerFeed(-105, -1870, 'WEST POWER FEED');
  structures.eastFeed = createPowerFeed(240, -1950, 'EAST POWER FEED');
  structures.reactor = createReactor();
  for (const e of [
    makeMech(30, -1850, 'WORKS GUARD 09', 'medium'),
    makeMech(130, -2040, 'IRON GUARD 10', 'heavy'),
    makeMech(-105, -2140, 'WORKS GUARD 11', 'medium'),
    createTurret(-42, -1770, 'WORKS SENTRY 12'),
    createTurret(300, -2050, 'WORKS SENTRY 13'),
  ])
    e.zone = 'works';
  structures.skyguard = createSkyguard();
  for (const e of [
    makeMech(-30, -3100, 'RIDGE HOUND 14', 'medium'),
    makeMech(240, -3360, 'RIDGE GUARD 15', 'heavy'),
    createTurret(-240, -3430, 'RIDGE SENTRY 16'),
  ])
    e.zone = 'ridge';
}
