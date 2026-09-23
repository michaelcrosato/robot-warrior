import { describe, expect, it } from 'vitest';
import {
  COOP_RESTORE_RANGE,
  coopChassis,
  coopDifficulty,
  coopLoadout,
  coopMember,
} from '../../src/net/protocol.js';

// Names a peer could send that exist on every plain object without being choices. Before,
// the host accepted them because the lookup only tested truthiness, and `constructor` as a
// chassis froze every peer at deploy.
const INHERITED = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'];

describe('co-op lobby choices from a peer', () => {
  it('accepts every real chassis, loadout and difficulty', () => {
    for (const c of ['kestrel', 'warden', 'bastion']) expect(coopChassis(c)).toBe(c);
    for (const l of ['balanced', 'cool', 'heavy']) expect(coopLoadout(l)).toBe(l);
    for (const d of ['cadet', 'regular', 'veteran']) expect(coopDifficulty(d)).toBe(d);
  });

  it('replaces inherited names, junk and non-strings with the fallback', () => {
    for (const bad of [...INHERITED, '', 'titan', 7, null, undefined, {}, ['warden']]) {
      expect(coopChassis(bad)).toBe('warden');
      expect(coopChassis(bad, 'kestrel')).toBe('kestrel');
      expect(coopLoadout(bad)).toBe('balanced');
      expect(coopDifficulty(bad)).toBe('regular');
    }
  });

  it('cleans a roster entry received from the host', () => {
    const member = coopMember({
      id: 'rw4c-1',
      slot: 2,
      name: '<img src=x>',
      chassis: 'constructor',
      loadout: '__proto__',
      ready: true,
    });
    expect(member).toMatchObject({
      id: 'rw4c-1',
      slot: 2,
      name: 'IMG SRCX',
      chassis: 'warden',
      loadout: 'balanced',
      ready: true,
    });
  });

  it('shares one restore range between the host rule and the prompt', () => {
    expect(COOP_RESTORE_RANGE).toBe(32);
  });
});
