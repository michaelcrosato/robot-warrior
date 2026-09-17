/**
 * Parity against the original single-file build.
 *
 * `tests/e2e/__baseline__/original.json` was captured from the 13 MB monolith this
 * source was unpacked from (scripts/capture-baseline.mjs). These tests assert the
 * unpacked build still produces the same world and the same reported state, which is
 * what makes the refactor verifiable rather than merely plausible.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { probeBoot, probeMission, waitForBoot, measureFrames } from './helpers/probe.js';

const baseline = JSON.parse(
  readFileSync(new URL('./__baseline__/original.json', import.meta.url), 'utf8'),
);

/** Collect page errors and console errors for the whole test. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
  });
  return errors;
}

test.describe('unpacked build matches the original', () => {
  test('boots with no errors and reports the same menu state', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');

    const boot = await probeBoot(page);

    expect(errors, 'the game must boot without errors').toEqual([]);
    expect(boot.version).toBe(baseline.boot.version);
    expect(boot.status).toEqual(baseline.boot.status);
    expect(boot.coopKeys).toEqual(baseline.boot.coopKeys);
  });

  test('generates a byte-identical mission roster', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');

    const mission = await probeMission(page);

    // The world is generated from a seeded generator that resetGame rewinds, so any
    // drift in the level builder, the spawners or the math layer shows up here.
    expect(mission.entities).toEqual(baseline.mission.entities);
    expect(mission.entities.length).toBeGreaterThan(0);
    expect(mission).toEqual(baseline.mission);
    expect(errors).toEqual([]);
  });

  test('renders frames and keeps the simulation running', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await waitForBoot(page);
    await page.click('#startBtn');
    await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing');

    const { after } = await measureFrames(page, 2500);
    expect(after, 'the render loop must be producing frames').toBeGreaterThan(5);

    const advanced = await page.evaluate(() => window.RobotWarrior.getStatus().time);
    expect(advanced, 'mission time must advance').toBeGreaterThan(0);

    // The HUD is drawn to its own 2D canvas; a blank canvas means the HUD pass died.
    const hudInk = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('hud'));
      const g = c.getContext('2d');
      const { data } = g.getImageData(0, 0, c.width, c.height);
      let lit = 0;
      for (let i = 3; i < data.length; i += 4 * 97) if (data[i] > 8) lit++;
      return lit;
    });
    expect(hudInk, 'the HUD canvas must have been drawn to').toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });

  test('exposes the world canvas through a live WebGL context', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);
    const info = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('world'));
      const gl = c.getContext('webgl');
      return { hasContext: !!gl, lost: gl ? gl.isContextLost() : true, width: c.width };
    });
    expect(info.hasContext).toBe(true);
    expect(info.lost).toBe(false);
    expect(info.width).toBeGreaterThan(0);
  });
});
