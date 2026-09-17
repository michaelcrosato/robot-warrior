/**
 * Pilot construction, mission lifecycle and the result screen.
 */
import { $, hideOverlays } from '../core/dom.js';
import { G, config, timers } from './state.js';
import { chassisData, componentNames } from '../data/chassis.js';
import { pools } from '../entities/pools.js';
import { populate } from '../entities/spawn.js';
import { sound } from '../audio/sound-system.js';
import { terrainY } from '../world/terrain.js';
import { toast } from '../net/coop-bridge.js';
import { world } from '../core/gl.js';

export function applyChassisWeapons() {
  chassisData().weapons.forEach((w, i) => Object.assign(G.weapons[i], w, { remaining: 0 }));
}

export function capacities() {
  return {
    ammo: Math.round(config[G.loadout].ammo * chassisData().ammo),
    missiles: Math.round(config[G.loadout].missiles * chassisData().missiles),
    coolants: config[G.loadout].coolants,
  };
}

export function newPlayer() {
  const components = {};
  for (const k of componentNames) {
    let hp = {
      head: 100,
      core: 240,
      leftTorso: 140,
      rightTorso: 140,
      leftArm: 110,
      rightArm: 110,
      leftLeg: 150,
      rightLeg: 150,
    }[k];
    hp = Math.round(hp * chassisData().armor);
    components[k] = { hp, max: hp };
  }
  return {
    x: 0,
    z: 92,
    y: terrainY(0, 92),
    yaw: 0,
    torso: 0,
    pitch: 0,
    speed: 0,
    throttle: 0,
    altitude: 0,
    vy: 0,
    grounded: true,
    phase: 0,
    heat: 0,
    fuel: 100,
    ammo: capacities().ammo,
    missiles: capacities().missiles,
    coolants: capacities().coolants,
    components,
    shutdown: 0,
    vision: false,
    imaging: false,
    align: false,
    centerTorso: false,
    legStep: 0,
    jetSound: 0,
    heatWarning: false,
    armorWarning: false,
    alive: true,
  };
}

export function soloAnnounce(text, voice = null, duration = 7) {
  G.radio.push({ text, time: duration, max: duration });
  if (G.radio.length > 3) G.radio.shift();
  if (voice) sound.say(voice, true);
}

export function soloToast(text, seconds = 3) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  G.toastTimer = seconds;
}

export function resetGame() {
  sound.resetMissionAudio();
  for (const k in G.keys) delete G.keys[k];
  G.mouse.down = false;
  G.mouse.drag = false;
  applyChassisWeapons();
  G.player = newPlayer();
  populate();
  G.target = null;
  G.lock = 0;
  G.lockSpoken = false;
  G.weaponIndex = 0;
  G.navIndex = 0;
  G.mapOpen = false;
  G.missionTime = 0;
  G.kills = 0;
  G.score = 0;
  G.shotsFired = 0;
  G.shotsHit = 0;
  G.extractTime = 0;
  G.reinforcements = false;
  G.extractAnnounced = false;
  G.transportTime = 0;
  G.missionFlags = Array(8).fill(false);
  G.missionStage = 'basin';
  G.serviceTime = 0;
  G.serviceUsed = false;
  G.supplyTime = 0;
  G.supplyUsed = false;
  G.linkTime = 0;
  G.linkWave = 0;
  G.linkStatus = 'LOCKED';
  G.linkBlocked = false;
  G.sectorBanner = null;
  G.imagingSwitch = 0;
  $('enhancedView').checked = false;
  G.radio = [];
  G.damageFlash = 0;
  G.shakePower = 0;
  G.zoom = false;
  for (const k in timers) delete timers[k];
  for (const w of G.weapons) w.remaining = 0;
}

export function requestCapture() {
  try {
    const p = world.requestPointerLock?.();
    if (p && p.catch)
      p.catch(() => toast('Mouse capture is off. Drag to aim, or use the arrow keys.', 5));
  } catch (e) {
    toast('Drag to aim, or use the arrow keys.', 5);
  }
}

export function soloStartMission() {
  hideOverlays();
  $('menu').hidden = true;
  resetGame();
  G.state = 'boot';
  G.bootTime = 0;
  G.bootStep = -1;
  sound.init();
  sound.update();
  requestCapture();
}

export function soloPauseGame() {
  if (G.state !== 'playing' && G.state !== 'boot') return;
  pausedFrom = G.state;
  G.state = 'paused';
  $('pause').hidden = false;
  for (const k in G.keys) delete G.keys[k];
  G.mouse.down = false;
  document.exitPointerLock?.();
  sound.stopVoice();
  sound.update();
}

export let pausedFrom = 'playing';

export function soloResumeGame() {
  hideOverlays();
  G.state = pausedFrom;
  sound.ctx?.resume().catch(() => {});
  sound.update();
  requestCapture();
}

export function soloReturnMenu() {
  G.state = 'menu';
  document.exitPointerLock?.();
  sound.stopVoice();
  hideOverlays();
  $('menu').hidden = false;
  resetGame();
  $('toast').hidden = true;
}

export function finishSoloMission(won) {
  if (G.state === 'won' || G.state === 'lost') return;
  G.state = won ? 'won' : 'lost';
  sound.soundtrack?.stop();
  G.player.throttle = 0;
  G.mouse.down = false;
  document.exitPointerLock?.();
  const accuracy = G.shotsFired ? Math.round((G.shotsHit / G.shotsFired) * 100) : 0,
    armor = Math.round(playerArmor() * 100);
  if (won && !(G.coop?.active && G.coop.guest))
    G.score += 2000 + Math.round(armor * 10) + Math.max(0, 1200 - Math.floor(G.missionTime * 2));
  $('result').hidden = false;
  $('resultEyebrow').textContent = won
    ? 'FLIGHT PATH OPEN. MISSION COMPLETE.'
    : 'SIGNAL LOST. PILOT RECOVERED.';
  $('resultTitle').textContent = won ? 'FLIGHT PATH SECURED.' : 'MACHINE LOST.';
  $('resultText').textContent = won
    ? 'The basin relay and the Ashfall reactor are down. You crossed Blackglass Ridge, destroyed the Skyguard battery, and secured the flight codes. The transport has recovered your machine.'
    : 'Your machine took critical damage. The emergency system recovered the pilot, but the mission is not complete.';
  $('resultMech').textContent = chassisData().code + ' / ' + chassisData().name;
  $('resultTime').textContent = formatTime(G.missionTime);
  $('resultKills').textContent =
    G.kills + ' / ' + pools.entities.filter((e) => e.type === 'mech' || e.type === 'turret').length;
  $('resultScore').textContent = G.score.toLocaleString();
  let best = 0;
  try {
    best = Number(localStorage.getItem('robotwarrior.best.v3') || 0);
    if (won && G.score > best) localStorage.setItem('robotwarrior.best.v3', String(G.score));
  } catch (e) {}
  $('resultDetail').textContent =
    `Armor remaining: ${armor}% · Hit rate: ${Math.min(100, accuracy)}% · ${chassisData().name} · ${G.difficulty.toUpperCase()} / ${config[G.loadout].label}` +
    (won ? ` · Best score: ${Math.max(best, G.score).toLocaleString()}` : '');
  sound.say(won ? 'victory' : 'death', true);
}

export function playerArmor() {
  let a = 0,
    b = 0;
  for (const c of Object.values(G.player.components)) {
    a += Math.max(0, c.hp);
    b += c.max;
  }
  return a / b;
}

export function formatTime(t) {
  return (
    String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(Math.floor(t % 60)).padStart(2, '0')
  );
}
