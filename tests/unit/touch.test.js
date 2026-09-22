import { describe, expect, it } from 'vitest';
import { inputHint } from '../../src/core/input-hints.js';
import {
  canAutoRestore,
  heatLimited,
  pickTouchTarget,
  stickInput,
} from '../../src/ui/touch-math.js';

describe('mobile control rules', () => {
  it('adapts received control hints locally, preserving desktop and mission messages', () => {
    const received = 'CONTROL / [B] Full throttle. [R] Select target. [I] Enhanced Imaging.';
    expect(inputHint(received, false)).toBe(received);
    expect(inputHint(received, true)).toContain('Hold FIRE and drag');
    expect(inputHint('TRANSFER / PRESS X TO STOP', true)).toBe('TRANSFER / RELEASE MOVE TO STOP');
    expect(inputHint('CONTROL / Uplink is down.', true)).toBe('CONTROL / Uplink is down.');
  });
  it('requests co-op restoration only while alive, grounded and stopped', () => {
    const pilot = { alive: true, altitude: 0, speed: 0, shutdown: 0 };
    expect(canAutoRestore(pilot)).toBe(true);
    for (const change of [
      { alive: false },
      { altitude: 3 },
      { speed: 2.2 },
      { speed: -2.2 },
      { shutdown: 1 },
    ])
      expect(canAutoRestore({ ...pilot, ...change })).toBe(false);
  });
  it('ignores thumb jitter and reaches full forward and limited reverse', () => {
    expect(stickInput(2, -3, 42)).toMatchObject({ throttle: 0, turn: 0 });
    expect(stickInput(0, -100, 42).throttle).toBe(1);
    expect(stickInput(0, 100, 42).throttle).toBe(-0.45);
    expect(stickInput(-42, 0, 42).turn).toBe(-1);
    expect(stickInput(42, 0, 42).turn).toBe(1);
  });

  it('clamps diagonals to the stick circle on either control size', () => {
    for (const radius of [37, 42]) {
      const input = stickInput(100, -100, radius);
      expect(Math.hypot(input.x, input.y)).toBeCloseTo(1);
      expect(input.throttle).toBeGreaterThan(0.5);
      expect(input.throttle).toBeLessThan(1);
    }
  });

  it('budgets the next shot and cools far enough before firing again', () => {
    expect(heatLimited(false, 70, 23)).toBe(false);
    expect(heatLimited(false, 71, 23)).toBe(true);
    expect(heatLimited(true, 70, 9)).toBe(true);
    expect(heatLimited(true, 55, 23)).toBe(false);
    // Holding pulse fire must make progress without ever reaching reactor shutdown.
    let heat = 0;
    let holding = false;
    let shots = 0;
    let coolingSteps = 0;
    for (let i = 0; i < 100; i++) {
      heat = Math.max(0, heat - 8.5 * 0.84);
      holding = heatLimited(holding, heat, 17);
      if (holding) coolingSteps++;
      else {
        heat += 17;
        shots++;
      }
      expect(heat).toBeLessThan(94);
    }
    expect(shots).toBeGreaterThan(30);
    expect(coolingSteps).toBeGreaterThan(10);
  });

  it('selects near the sight, retains a lock through jitter, and rejects occlusion', () => {
    const candidate = (entity, degrees, visible = true, distance = 400) => ({
      entity,
      alignment: Math.cos((degrees * Math.PI) / 180),
      visible,
      distance,
    });
    const a = candidate('a', 7);
    const b = candidate('b', 1);
    expect(pickTouchTarget([a, b], null)).toBe('b');
    expect(pickTouchTarget([a, b], 'a')).toBe('a');
    expect(pickTouchTarget([candidate('a', 17), b], 'a')).toBe('b');
    expect(pickTouchTarget([candidate('a', 3, false), b], 'a')).toBe('b');
    expect(pickTouchTarget([candidate('behind', 170), candidate('wide', 20)], null)).toBeNull();
    expect(pickTouchTarget([], 'destroyed')).toBeNull();
  });
});
