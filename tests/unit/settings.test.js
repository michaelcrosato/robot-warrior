import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from '../../src/core/settings.js';

const defaults = {
  volume: 0.7,
  music: 0.35,
  sensitivity: 0.6,
  quality: 'auto',
  shake: true,
  invert: false,
};

describe('stored settings', () => {
  it('keeps every valid stored value', () => {
    const stored = {
      volume: 0.2,
      music: 0,
      sensitivity: 1.5,
      quality: 'ultra',
      shake: false,
      invert: true,
    };
    expect(sanitizeSettings(stored, defaults)).toEqual(stored);
  });

  it('falls back per field when a value has the wrong type or is not finite', () => {
    // Each of these once flowed straight into the game: a string volume threw while the
    // audio graph was half built, and a string sensitivity turned the torso angle to NaN.
    const stored = {
      volume: 'loud',
      music: null,
      sensitivity: '0.9',
      quality: 3,
      shake: 'yes',
      invert: 1,
    };
    expect(sanitizeSettings(stored, defaults)).toEqual(defaults);
    expect(sanitizeSettings({ volume: NaN, music: Infinity }, defaults)).toEqual(defaults);
  });

  it('clamps numbers to the range their sliders offer', () => {
    expect(sanitizeSettings({ volume: 4, music: -1, sensitivity: 0.01 }, defaults)).toEqual({
      ...defaults,
      volume: 1,
      music: 0,
      sensitivity: 0.15,
    });
  });

  it('ignores keys it does not own, including prototype keys', () => {
    const stored = JSON.parse('{"__proto__": {"polluted": true}, "extra": 1, "volume": 0.5}');
    const clean = sanitizeSettings(stored, defaults);
    expect(clean).toEqual({ ...defaults, volume: 0.5 });
    expect(Object.getPrototypeOf(clean)).toBe(Object.prototype);
    expect(/** @type {any} */ ({}).polluted).toBeUndefined();
  });

  it('treats anything that is not a plain object as nothing stored', () => {
    for (const stored of [null, 7, 'text', [1, 2]])
      expect(sanitizeSettings(stored, defaults)).toEqual(defaults);
  });

  it('leaves quality names to the tier resolver, which already falls back to auto', () => {
    expect(sanitizeSettings({ quality: 'retro' }, defaults).quality).toBe('retro');
  });
});
