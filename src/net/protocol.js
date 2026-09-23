/**
 * Co-op wire protocol and squad helpers.
 */
import { G, config } from '../sim/state.js';
import { clamp } from '../core/math.js';
import { chassisSpecs } from '../data/chassis.js';

export const COOP_PROTOCOL = 4;

export const COOP_STEP = 0.025;

/**
 * Queued guest inputs the host treats as ordinary network jitter rather than a backlog to
 * catch up on: six steps, 150 ms. Chosen by feel — large enough that normal bursty
 * delivery never triggers catch-up, small enough that a real stall is noticed at once.
 */
export const COOP_INPUT_BUFFER = 6;

export const COOP_COLORS = ['#80d6df', '#aaca8c', '#f4c47c', '#c3acfa'];

export const COOP_KEYS = [
  'KeyW',
  'KeyS',
  'KeyA',
  'KeyD',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyQ',
  'KeyE',
  'ShiftLeft',
  'ShiftRight',
  'Space',
  'KeyF',
  'KeyJ',
];

export const coopNumber = (v, lo, hi, fallback = 0) =>
  Number.isFinite(v) ? clamp(v, lo, hi) : fallback;

export const coopCopy = (v) => JSON.parse(JSON.stringify(v));

export const coopName = (v) =>
  String(v || 'PILOT')
    .replace(/[^a-z0-9 _.-]/gi, '')
    .trim()
    .slice(0, 16)
    .toUpperCase() || 'PILOT';

/**
 * Lobby choices received from a peer, each checked against the game's own tables.
 *
 * Own keys only. These tables are plain object literals, so a truthiness lookup accepts
 * every name an object inherits: a guest sending `constructor` as its chassis passed the
 * host's check, was broadcast in the start packet, and froze every peer when the chassis
 * weapons were applied at deploy. The same name as a loadout made that pilot's damage NaN,
 * so anything it hit could never be destroyed.
 */
export const coopChassis = (v, fallback = 'warden') =>
  typeof v === 'string' && Object.hasOwn(chassisSpecs, v) ? v : fallback;

export const coopLoadout = (v, fallback = 'balanced') =>
  typeof v === 'string' && Object.hasOwn(config, v) ? v : fallback;

export const coopDifficulty = (v, fallback = 'regular') =>
  ['cadet', 'regular', 'veteran'].includes(v) ? v : fallback;

/** A roster entry from the host, with every field the game indexes by made safe. */
export const coopMember = (r) => ({
  ...r,
  slot: Math.round(coopNumber(r.slot, 0, 3)),
  name: coopName(r.name),
  chassis: coopChassis(r.chassis),
  loadout: coopLoadout(r.loadout),
});

/**
 * How close, in metres on the ground, a pilot must be to restore a downed teammate. One
 * value for the host's rule and for the prompt that invites it: the prompt used to appear
 * at 38 m, six metres before holding J could do anything.
 */
export const COOP_RESTORE_RANGE = 32;

export function squadAny(test) {
  return G.coop?.active ? G.coop.living().some((r) => test(G.coop.playerOf(r))) : test(G.player);
}

export function squadAll(test) {
  if (!G.coop?.active) return test(G.player);
  const a = G.coop.living();
  return a.length > 0 && a.every((r) => test(G.coop.playerOf(r)));
}

export function coopScaleEntity(e) {
  if (!G.coop?.sessionStarted || !['mech', 'turret'].includes(e.type) || e.coopScaled) return;
  e.coopScaled = true;
  const f = 1 + 0.6 * (G.coop.crewSize - 1);
  if (e.components)
    for (const c of Object.values(e.components)) {
      c.hp *= f;
      c.max *= f;
    }
  else {
    e.hp *= f;
    e.maxHP *= f;
  }
}
