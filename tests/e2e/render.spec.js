/**
 * Render pipeline integrity during combat.
 *
 * These exist because of a specific fault and the shape of it matters. `sphereGeom` emitted
 * a zero normal for every pole-band vertex; the scene vertex shader normalised it, which is
 * NaN; and the bloom chain turned fifteen poisoned pixels into a black rectangle across the
 * middle of the screen whenever a projectile or a puff of smoke was on screen.
 *
 * The lesson is the amplification. A defect of fifteen pixels in the HDR target is not a
 * defect of fifteen pixels on screen — the prefilter reads a 13-tap neighbourhood and each
 * downsample level widens it again, measured at roughly twenty thousand to one. So the
 * pipeline is checked for non-finite values at every stage, not only for how the final
 * picture looks.
 *
 * All of this needs a tier that actually runs bloom. The suite's own hardware is a software
 * rasteriser, which auto-detects to the cheapest tier and skips the entire post chain, so
 * these force a desktop tier.
 */
import { test, expect } from './fixtures.js';
import { waitForBoot, MISSION_START_TIMEOUT } from './helpers/probe.js';

/**
 * A small viewport, deliberately.
 *
 * These tests are about shader correctness, not resolution — a NaN reaches the bloom chain
 * at any size. Every pass still runs, including shadow cascades at their full map size,
 * but at a quarter of the fragments. That matters because the suite renders through
 * SwiftShader on a shared runner, and the boot sequence advances on a per-frame delta that
 * the loop clamps to 0.2 s: below about five frames a second, startup stretches in real
 * time until it outruns any reasonable timeout. It did.
 */
test.use({ viewport: { width: 640, height: 400 } });

/** Force a tier with shadows, bloom and ambient occlusion, whatever the hardware reports. */
async function useTier(page, quality) {
  await page.addInitScript(
    (q) =>
      localStorage.setItem('robotwarrior.settings', JSON.stringify({ quality: q, shake: false })),
    quality,
  );
}

async function fightFor(page, ms) {
  await page.goto('/');
  await waitForBoot(page);
  await page.click('#startBtn');
  await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing', null, {
    timeout: MISSION_START_TIMEOUT,
  });
  await page.waitForTimeout(1000);

  // Hold fire: projectiles, impact sparks and smoke are what put spheres on screen.
  const box = page.viewportSize();
  await page.mouse.move(box.width / 2, box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
}

/** Proportion of 8x8 blocks in the world canvas that are essentially black. */
async function darkBlockFraction(page) {
  return page.evaluate(() => {
    const c = /** @type {HTMLCanvasElement} */ (document.getElementById('world'));
    const gl = /** @type {WebGL2RenderingContext} */ (c.getContext('webgl2'));
    const px = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const B = 8;
    let dark = 0;
    let total = 0;
    for (let by = 0; by + B <= c.height; by += B) {
      for (let bx = 0; bx + B <= c.width; bx += B) {
        let sum = 0;
        for (let y = 0; y < B; y++) {
          for (let x = 0; x < B; x++) {
            const i = ((by + y) * c.width + (bx + x)) * 4;
            sum += px[i] + px[i + 1] + px[i + 2];
          }
        }
        total++;
        if (sum / (B * B * 3) < 4) dark++;
      }
    }
    return dark / total;
  });
}

test.describe('render pipeline integrity', () => {
  // Measured on the GitHub runner (4 vCPU, SwiftShader). A mission start at a desktop tier
  // takes 25 to 56 s, and every readback waits out whatever frame is queued: 0.5 s when
  // none is, 7 to 10 s when one is. A passing sustained-fire run used 86 s of the default
  // 90, so that default decided pass or fail by runner load rather than by the assertions.
  test.describe.configure({ timeout: 180_000 });

  test('no stage holds a non-finite value during sustained fire', async ({ page }) => {
    await useTier(page, 'high');
    await fightFor(page, 600);

    // Sampled repeatedly rather than once at the end. The fault this guards against was
    // transient — it needed a sphere's pole band actually rasterised, which depends on
    // which projectiles and smoke happen to be on screen at that instant. A single scan
    // caught it at one tier and missed it at another, which is no guard at all.
    const worst = new Map();
    for (let i = 0; i < 8; i++) {
      const stages = await page.evaluate(() => window.RobotWarrior.scanTargets());
      expect(
        stages.length,
        'the scan must cover the scene target and the bloom chain',
      ).toBeGreaterThan(1);
      for (const stage of stages) {
        const seen = worst.get(stage.name) ?? { nan: 0, inf: 0, firstNaN: null };
        worst.set(stage.name, {
          nan: Math.max(seen.nan, stage.nan ?? 0),
          inf: Math.max(seen.inf, stage.inf ?? 0),
          firstNaN: seen.firstNaN ?? stage.firstNaN ?? null,
          error: stage.error ?? seen.error,
        });
      }
      await page.waitForTimeout(350);
    }
    await page.mouse.up();

    for (const [name, stage] of worst) {
      expect(stage.error, `${name} could not be read back`).toBeUndefined();
      expect(stage.nan, `${name} held ${stage.nan} NaN (first at ${stage.firstNaN})`).toBe(0);
      expect(stage.inf, `${name} held ${stage.inf} infinities`).toBe(0);
    }
  });

  test('combat does not fill the screen with black blocks', async ({ page }) => {
    await useTier(page, 'high');

    await page.goto('/');
    await waitForBoot(page);
    await page.click('#startBtn');
    await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing', null, {
      timeout: MISSION_START_TIMEOUT,
    });
    await page.waitForTimeout(1200);

    // Some of the picture is legitimately near-black: shadowed rock faces, mech
    // silhouettes, the darkest part of the sky. The regression was a jump from under one
    // per cent to seventy, so the assertion is about that jump and not about a tidy frame.
    const idle = await darkBlockFraction(page);
    expect(idle, 'an idle frame should be mostly lit').toBeLessThan(0.15);

    const box = page.viewportSize();
    await page.mouse.move(box.width / 2, box.height / 2);
    await page.mouse.down();

    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(700);
      const during = await darkBlockFraction(page);
      expect(
        during,
        `firing turned ${(during * 100).toFixed(1)}% of the frame black (idle was ${(idle * 100).toFixed(1)}%)`,
      ).toBeLessThan(idle + 0.1);
    }

    await page.mouse.up();
  });

  test('every tier with a post chain renders cleanly', async ({ page }) => {
    // Four missions, each on a heavier tier than the last, all in software. The default
    // per-test budget does not cover that; on the CI runner the four mission starts alone
    // took 24, 40, 41 and 56 s, and the whole sweep 225 s of an earlier 240 s budget.
    test.setTimeout(360_000);

    // The bloom chain differs by tier — its depth, and whether ambient occlusion runs at
    // all. A fault that only appears at one mip count would otherwise go unseen.
    for (const tier of ['low', 'mobile', 'high', 'ultra']) {
      await page.addInitScript(
        (q) =>
          localStorage.setItem(
            'robotwarrior.settings',
            JSON.stringify({ quality: q, shake: false }),
          ),
        tier,
      );
      await fightFor(page, 1400);

      const stages = await page.evaluate(() => window.RobotWarrior.scanTargets());
      for (const stage of stages) {
        expect(stage.nan, `${tier}: ${stage.name} holds NaN`).toBe(0);
        expect(stage.inf, `${tier}: ${stage.name} holds infinities`).toBe(0);
      }
      await page.mouse.up();
    }
  });
});
