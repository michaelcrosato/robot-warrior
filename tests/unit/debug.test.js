import { describe, expect, it } from 'vitest';
import { parseDebugMode } from '../../src/render/debug.js';

describe('debug view selection', () => {
  it('maps each named view to its shader mode', () => {
    expect(parseDebugMode('?debug=shadow')).toBe(1);
    expect(parseDebugMode('?debug=roughness')).toBe(5);
    expect(parseDebugMode('?room=x&debug=cascade')).toBe(2);
  });

  it('falls back to no debug view for anything else', () => {
    for (const search of ['', '?debug=', '?debug=bogus', '?debug=off', '?other=1'])
      expect(parseDebugMode(search)).toBe(0);
  });

  it('does not resolve inherited names to functions', () => {
    // Before, `?debug=constructor` returned Object itself, which only happened to be
    // harmless because uniform1i coerced it to 0.
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      expect(parseDebugMode(`?debug=${name}`)).toBe(0);
  });
});
