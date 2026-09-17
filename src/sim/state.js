/**
 * All mutable mission and pilot state.
 */
import { chassisSpecs } from '../data/chassis.js';
import { hex } from '../core/math.js';

/**
 * Mission and pilot state. One object because the simulation, the HUD, the menu, the frame loop and the co-op layer all write to it.
 */
export const G = {
  coop: null,
  chassis: 'warden',
  hudScale: 1,
  state: 'menu',
  realTime: 0,
  missionTime: 0,
  bootTime: 0,
  bootStep: -1,
  player: undefined,
  target: null,
  lock: 0,
  lockSpoken: false,
  weaponIndex: 0,
  navIndex: 0,
  mapOpen: false,
  helpFrom: 'menu',
  kills: 0,
  score: 0,
  shotsFired: 0,
  shotsHit: 0,
  extractTime: 0,
  reinforcements: false,
  extractAnnounced: false,
  transportTime: 0,
  missionFlags: Array(8).fill(false),
  radio: [],
  toastTimer: 0,
  damageFlash: 0,
  shakePower: 0,
  zoom: false,
  missionStage: 'basin',
  serviceTime: 0,
  serviceUsed: false,
  sectorBanner: null,
  imagingSwitch: 0,
  supplyTime: 0,
  supplyUsed: false,
  linkTime: 0,
  linkWave: 0,
  linkStatus: 'LOCKED',
  linkBlocked: false,
  difficulty: 'regular',
  loadout: 'balanced',
  keys: {},
  mouse: { down: false, drag: false },
  weapons: [
    {
      name: 'DUAL PULSE',
      short: 'PULSE',
      heat: 17,
      damage: 38,
      cooldown: 0.84,
      range: 820,
      color: hex('#a5ee73'),
      remaining: 0,
    },
    {
      name: 'COIL CANNON',
      short: 'CANNON',
      heat: 9,
      damage: 61,
      cooldown: 1.7,
      range: 1150,
      color: hex('#ffda85'),
      remaining: 0,
    },
    {
      name: 'MISSILE / 4',
      short: 'MISSILE',
      heat: 23,
      damage: 22,
      cooldown: 4.0,
      range: 1150,
      color: hex('#ffae64'),
      remaining: 0,
    },
  ],
};

try {
  const v = localStorage.getItem('robotwarrior.chassis');
  if (chassisSpecs[v]) G.chassis = v;
} catch (e) {}

export const timers = {};

export const config = {
  balanced: {
    label: 'BALANCED',
    ammo: 60,
    missiles: 40,
    cool: 8.5,
    coolants: 2,
    damage: 1,
    desc: 'Two pulse lasers, a coil cannon, and guided missiles. A flexible combat load with two coolant charges.',
  },
  cool: {
    label: 'COOL RUNNER',
    ammo: 45,
    missiles: 32,
    cool: 12.5,
    coolants: 3,
    damage: 0.9,
    desc: 'Extra heat sinks and three coolant charges. Ten percent less weapon damage, with a smaller ammunition load.',
  },
  heavy: {
    label: 'HEAVY GUN',
    ammo: 85,
    missiles: 56,
    cool: 7,
    coolants: 1,
    damage: 1.2,
    desc: 'Twenty percent more weapon damage and extra ammunition. Less cooling capacity. One coolant charge.',
  },
};
