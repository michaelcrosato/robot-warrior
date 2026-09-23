import { describe, expect, it } from 'vitest';
import { norm, rayCylinder } from '../../src/core/math.js';

// A rock: an upright cylinder of radius 10 at the origin, from y = 0 to y = 20.
const rock = { x: 0, z: 0, r: 10, h: 20 };
const base = 0;
const east = norm([1, 0, 0]);

describe('rays against upright cylinders (cover)', () => {
  it('finds the entry point of a ray that starts outside', () => {
    expect(rayCylinder([-30, 5, 0], east, rock, base)).toBeCloseTo(20, 6);
  });

  it('misses above, below and beside the cylinder', () => {
    expect(rayCylinder([-30, 25, 0], east, rock, base)).toBe(Infinity);
    expect(rayCylinder([-30, -2, 0], east, rock, base)).toBe(Infinity);
    expect(rayCylinder([-30, 5, 12], east, rock, base)).toBe(Infinity);
    expect(rayCylinder([-30, 5, 0], [-1, 0, 0], rock, base)).toBe(Infinity);
  });

  it('ignores cover within the minimum distance of a shooter', () => {
    // A shooter's own muzzle pressed against a rock face does not block its line of fire:
    // the one-unit exemption that hitscan and line-of-sight checks have always had.
    expect(rayCylinder([-10.5, 5, 0], east, rock, base, 1)).toBe(Infinity);
    expect(rayCylinder([-10.5, 5, 0], east, rock, base, 0)).toBeCloseTo(0.5, 6);
  });

  it('reports a projectile already inside the cylinder as blocked at once', () => {
    // The fault this guards: a projectile that stepped into a rock had its entry point
    // behind it, the entry test rejected it, and the shot flew on through. How often that
    // happened depended on step length, which is to say on the monitor's refresh rate.
    expect(rayCylinder([0, 5, 0], east, rock, base, 1)).toBe(Infinity);
    expect(rayCylinder([0, 5, 0], east, rock, base, 0, true)).toBe(0);
    expect(rayCylinder([0, 25, 0], east, rock, base, 0, true)).toBe(Infinity);
  });

  it('blocks a projectile crossing the rock at every step length', () => {
    // Step a shell across the rock at step lengths from 240 Hz to 20 Hz. Whatever the step,
    // some step must report the rock within that step, and none may slip past it.
    for (const step of [245 / 240, 245 / 144, 245 / 60, 245 / 20]) {
      let blocked = false;
      for (let x = -40; x < 40 && !blocked; x += step)
        blocked = rayCylinder([x, 5, 0], east, rock, base, 0, true) < step;
      expect(blocked, `step ${step.toFixed(2)}`).toBe(true);
    }
  });
});
