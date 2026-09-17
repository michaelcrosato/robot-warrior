/**
 * Entry point. Builds the pilot, generates the mission, wires the interface and starts the frame loop, then freezes a read-only status API onto `window` for tests and performance checks.
 */
import { $ } from './core/dom.js';
import { activeTier } from './core/quality.js';
import { debugModeName } from './render/debug.js';
import { G } from './sim/state.js';
import { applyChassisWeapons, newPlayer, playerArmor } from './sim/player.js';
import {
  basinThreats,
  populate,
  reactorShielded,
  ridgeGateLocked,
  ridgeResponseThreats,
} from './entities/spawn.js';
import { entityHealth } from './entities/draw.js';
import { flightLink } from './world/sites.js';
import { fps, frame } from './loop.js';
import { initCoop } from './net/coop-bridge.js';
import { initInput } from './ui/input.js';
import { initMenu, updateChassisUI } from './ui/menu.js';
import { initTouch } from './ui/touch.js';
import { pools } from './entities/pools.js';
import { sound } from './audio/sound-system.js';

// Evaluated for their startup effects, in the order the original script ran them.
import './core/gl.js';
import './core/programs.js';
import './core/mesh.js';
import './core/settings.js';
import './core/viewport.js';
import './world/level.js';

applyChassisWeapons();

G.player = newPlayer();

populate();

initMenu();

initInput();

initTouch();

initCoop();

updateChassisUI();

$('loading').hidden = true;

requestAnimationFrame(frame);

Object.defineProperty(window, 'RobotWarrior', {
  value: Object.freeze({
    version: '4.0.0',
    getCoopStatus: () => G.coop.status(),
    getStatus: () => ({
      state: G.state,
      audio: sound.soundtrack?.status() || { cue: null, playing: false },
      chassis: G.chassis,
      sector: G.missionStage,
      imaging: G.player.imaging,
      nightVision: G.player.vision,
      shielded: reactorShielded(),
      serviceUsed: G.serviceUsed,
      serviceProgress: G.serviceTime,
      supplyUsed: G.supplyUsed,
      supplyProgress: G.supplyTime,
      linkProgress: G.linkTime,
      linkDuration: flightLink.duration,
      linkStatus: G.linkStatus,
      linkWave: G.linkWave,
      linkBlocked: G.linkBlocked,
      responseRemaining: ridgeResponseThreats().length,
      gateLocked: ridgeGateLocked(),
      extractionProgress: G.extractTime,
      transportTime: G.transportTime,
      basinDefenders: basinThreats().length,
      navIndex: G.navIndex,
      fps: Math.round(fps),
      time: G.missionTime,
      position: { x: G.player.x, y: G.player.y + G.player.altitude, z: G.player.z },
      speed: G.player.speed * 3.6,
      torso: G.player.torso,
      pitch: G.player.pitch,
      tier: activeTier().id,
      debug: debugModeName,
      heat: G.player.heat,
      armor: playerArmor(),
      ammo: G.player.ammo,
      missiles: G.player.missiles,
      objectiveLabels: [
        'relay',
        'uplink',
        'basinClear',
        'needlePass',
        'reactor',
        'blackglassRidge',
        'skyguard',
        'flightCodes',
      ],
      objectives: G.missionFlags.slice(),
      kills: G.kills,
      score: G.score,
      entities: pools.entities.map((e) => ({
        name: e.name,
        type: e.type,
        zone: e.zone,
        x: e.x,
        z: e.z,
        alive: e.alive,
        health: entityHealth(e),
      })),
    }),
  }),
  writable: false,
});
