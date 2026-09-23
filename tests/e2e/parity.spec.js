/**
 * Parity against the original single-file build.
 *
 * `tests/e2e/__baseline__/original.json` was captured from the 13 MB monolith this
 * source was unpacked from (scripts/capture-baseline.mjs). These tests assert the
 * unpacked build still produces the same world and the same reported state, which is
 * what makes the refactor verifiable rather than merely plausible.
 */
import { test, expect } from './fixtures.js';
import { readFileSync } from 'node:fs';
import {
  probeBoot,
  probeMission,
  waitForBoot,
  measureFrames,
  STATIC_TYPES,
  WALK_TOLERANCE,
  MISSION_START_TIMEOUT,
} from './helpers/probe.js';

const baseline = JSON.parse(
  readFileSync(new URL('./__baseline__/original.json', import.meta.url), 'utf8'),
);

/**
 * Collect page errors and console errors for the whole test.
 *
 * One category is filtered out: requests for `audio/music/*`. Those three tracks are
 * deliberately not distributed with the source (docs/assets.md), so on a fresh clone —
 * and therefore in CI, and on the published site — the browser logs a network 404 for
 * each. JavaScript cannot suppress a network-level log, and whether it lands before or
 * after an assertion depends on timing, so treating it as a failure makes the suite
 * flaky for behaviour that is working exactly as intended. Everything else still fails.
 */
function watchErrors(page) {
  const errors = [];
  const isAbsentSoundtrack = (url) => /\/audio\/music\/[^/]+$/.test(url || '');

  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.message || e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (isAbsentSoundtrack(m.location()?.url)) return;
    errors.push('console.error: ' + m.text());
  });
  page.on('requestfailed', (r) => {
    if (isAbsentSoundtrack(r.url())) return;
    errors.push('requestfailed: ' + r.url() + ' ' + (r.failure()?.errorText ?? ''));
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

  test('builds the same world: same roster, same structure placement', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');

    const mission = await probeMission(page);
    const expected = baseline.mission;

    // --- the fixed part, compared exactly -------------------------------------
    // Which machines exist, of what type, in which sector. This is authored in
    // populate(), so it is fixed by construction — but it still catches a spawner that
    // stopped running, a zone assignment that moved, or an entity that never got built.
    const roster = (m) =>
      m.entities.map((e) => `${e.name} | ${e.type} | ${e.zone}`).sort((a, b) => a.localeCompare(b));

    expect(roster(mission)).toEqual(roster(expected));
    expect(mission.entities).toHaveLength(expected.entities.length);
    expect(mission.sector).toBe(expected.sector);
    expect(mission.chassis).toBe(expected.chassis);
    expect(mission.objectiveLabels).toEqual(expected.objectiveLabels);
    expect(mission.objectives).toEqual(expected.objectives);
    expect(mission.ammo).toBe(expected.ammo);
    expect(mission.missiles).toBe(expected.missiles);

    const byName = new Map(expected.entities.map((e) => [e.name, e]));

    // Structures never move, and their coordinates are *derived* at spawn from the site
    // table and the terrain height field rather than written out — so this is the sharp
    // assertion in this test. Drift in sites.js, terrainY or the spawners lands here.
    const structures = mission.entities.filter((e) => STATIC_TYPES.includes(e.type));
    expect(structures.length, 'the mission must place static structures').toBeGreaterThan(0);
    for (const e of structures) {
      expect({ name: e.name, x: e.x, z: e.z }).toEqual({
        name: e.name,
        x: byName.get(e.name).x,
        z: byName.get(e.name).z,
      });
    }

    // --- the timing-dependent part, bounded rather than pinned -----------------
    // Mechs spawn at authored coordinates and then walk, on a heading seeded per mission.
    // How far they get by the time this probe runs depends on how many frames the machine
    // managed, so an exact comparison is flaky by construction — it failed on a slower CI
    // runner by one to three units. A tolerance still catches what matters: a mech that
    // spawned in the wrong place, or in the wrong sector.
    const mobile = mission.entities.filter((e) => !STATIC_TYPES.includes(e.type));
    expect(mobile.length, 'the mission must field mechs').toBeGreaterThan(0);
    for (const e of mobile) {
      const from = byName.get(e.name);
      const drift = Math.hypot(e.x - from.x, e.z - from.z);
      expect(
        drift,
        `${e.name} spawned ${drift.toFixed(0)} units from its seeded position`,
      ).toBeLessThan(WALK_TOLERANCE);
    }

    // Every machine starts the mission intact and undamaged.
    for (const e of mission.entities) {
      expect(e.alive, `${e.name} must start alive`).toBe(true);
      expect(e.health, `${e.name} must start near full health`).toBeGreaterThan(0.9);
    }
    expect(mission.armor).toBeGreaterThan(0.9);

    expect(errors).toEqual([]);
  });

  test('renders frames and keeps the simulation running', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/');
    await waitForBoot(page);
    await page.click('#startBtn');
    await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing', null, {
      timeout: MISSION_START_TIMEOUT,
    });

    const { before, after, advanced } = await measureFrames(page, 2500);
    console.log(`loop: ${before.fps} -> ${after.fps} fps, ${advanced.toFixed(2)}s of mission time`);

    // The loop must be advancing. No figure is asserted: this runs on SwiftShader, and a
    // contended runner can legitimately drop below any threshold — a `> 5` assertion here
    // was flaky for exactly that reason. Zero frames, or a frozen clock, still fails.
    expect(after.fps, 'frames must be being counted').toBeGreaterThan(0);
    expect(advanced, 'mission time must advance while the loop runs').toBeGreaterThan(0);
    expect(after.time, 'the mission clock must be running').toBeGreaterThan(before.time);

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

  test('accounts for every soundtrack cue, present or absent', async ({ page }) => {
    // The soundtrack is an optional local asset. Whichever way it goes, the game must
    // reach 'playing' and must *report* what happened rather than failing quietly — a
    // cue that is neither loaded nor listed as failed would mean a loader that silently
    // gave up. This test is deliberately written to pass both with the tracks present
    // and without them, because both are normal states for this repository.
    const errors = watchErrors(page);
    await page.goto('/');
    await waitForBoot(page);
    await page.click('#startBtn');
    await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing', null, {
      timeout: MISSION_START_TIMEOUT,
    });
    // Give the fetches time to resolve or 404.
    await page.waitForTimeout(6000);

    const audio = await page.evaluate(() => window.RobotWarrior.getStatus().audio);

    // If the audio graph could not be created at all — no output device on the runner,
    // a blocked context — getStatus() falls back to a stub with no cue arrays. That is an
    // environment limitation rather than a defect in the loaders, so it is reported and
    // skipped instead of failing. The mission assertion below still runs either way.
    if (Array.isArray(audio.loaded) && Array.isArray(audio.failed)) {
      for (const cue of ['boot', 'basin', 'works']) {
        expect(
          audio.loaded.includes(cue) || audio.failed.includes(cue),
          `cue "${cue}" was neither loaded nor reported as unavailable`,
        ).toBe(true);
      }
    } else {
      console.warn('no audio graph on this runner; soundtrack accounting not checked');
    }

    // Whatever happened to the audio, the mission must still be running. This is the
    // assertion that matters: absent music is a normal state, not a failure.
    expect(await page.evaluate(() => window.RobotWarrior.getStatus().state)).toBe('playing');
    expect(errors).toEqual([]);
  });

  test('exposes the world canvas through a live WebGL 2 context', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);
    const info = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('world'));
      // The renderer needs WebGL 2: vertex array objects, a depth texture array for the
      // shadow cascades, and float render targets for the HDR pass. Asking for 'webgl'
      // here returns null once a 'webgl2' context exists on the canvas.
      const gl = /** @type {WebGL2RenderingContext} */ (c.getContext('webgl2'));
      return {
        hasContext: !!gl,
        lost: gl ? gl.isContextLost() : true,
        width: c.width,
        height: c.height,
        version: gl ? String(gl.getParameter(gl.VERSION)) : '',
        maxArrayLayers: gl ? gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) : 0,
      };
    });
    expect(info.hasContext).toBe(true);
    expect(info.lost).toBe(false);
    expect(info.width).toBeGreaterThan(0);
    expect(info.height).toBeGreaterThan(0);
    expect(info.version).toContain('WebGL 2');
    // Four cascades is the most any tier asks for.
    expect(info.maxArrayLayers).toBeGreaterThanOrEqual(4);
  });

  test('renders the upgraded pipeline without GL errors', async ({ page }) => {
    // Shadow cascades, the HDR target and the post chain all bind framebuffers and
    // textures every frame. A mistake there usually still draws something, so the check
    // that matters is whether the driver is reporting errors — which nothing in the game
    // would otherwise surface.
    const errors = watchErrors(page);
    await page.goto('/');
    await waitForBoot(page);
    await page.click('#startBtn');
    await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing', null, {
      timeout: MISSION_START_TIMEOUT,
    });
    await page.waitForTimeout(2500);

    const glError = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('world'));
      const gl = /** @type {WebGL2RenderingContext} */ (c.getContext('webgl2'));
      const code = gl.getError();
      return code === gl.NO_ERROR ? 'NO_ERROR' : '0x' + code.toString(16);
    });
    expect(glError, 'the driver must report no GL error after a frame').toBe('NO_ERROR');

    // The scene must actually have been drawn to, not just cleared.
    const lit = await page.evaluate(() => {
      const c = /** @type {HTMLCanvasElement} */ (document.getElementById('world'));
      const gl = /** @type {WebGL2RenderingContext} */ (c.getContext('webgl2'));
      const px = new Uint8Array(4 * 64);
      gl.readPixels(
        Math.floor(c.width / 2) - 8,
        Math.floor(c.height / 2) - 8,
        8,
        8,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        px,
      );
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      return sum;
    });
    expect(lit, 'the centre of the world canvas must not be black').toBeGreaterThan(0);

    expect(errors).toEqual([]);
  });
});
