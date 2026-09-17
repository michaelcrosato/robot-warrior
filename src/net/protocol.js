/**
 * Co-op wire protocol and squad helpers.
 */
import { G } from '../sim/state.js';
import { clamp } from '../core/math.js';

export const COOP_PROTOCOL = 4;

export const COOP_STEP = 0.025;

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
