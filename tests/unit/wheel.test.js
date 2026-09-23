import { describe, expect, it } from 'vitest';
import { WHEEL_REPEAT_MS, wheelStep } from '../../src/ui/wheel.js';

describe('mouse-wheel weapon cycling', () => {
  it('steps forward and back on vertical scrolling', () => {
    expect(wheelStep(0, 100, 1000, 0)).toBe(1);
    expect(wheelStep(0, -100, 1000, 0)).toBe(-1);
    expect(wheelStep(3, 40, 1000, 0)).toBe(1);
  });

  it('ignores sideways and empty scrolling instead of reading it as "back"', () => {
    for (const [dx, dy] of [
      [80, 0],
      [-80, 0],
      [60, 20],
      [0, 0],
    ])
      expect(wheelStep(dx, dy, 1000, 0)).toBe(0);
  });

  it('takes at most one step per repeat window, so momentum cannot spin the selection', () => {
    expect(wheelStep(0, 100, 1000, 1000 - WHEEL_REPEAT_MS + 1)).toBe(0);
    expect(wheelStep(0, 100, 1000, 1000 - WHEEL_REPEAT_MS)).toBe(1);
  });
});
