/**
 * Failure handling: what the game does when something goes wrong, rather than what it
 * does when everything is right.
 *
 * Everything here runs from the menu. The menu renders the hero mech through the same
 * frame loop and WebGL path as a mission, so these need no mission start — which on the
 * suite's software rasteriser is most of the cost of any test.
 */
import { test, expect } from './fixtures.js';
import { waitForBoot } from './helpers/probe.js';

/**
 * Make WebGL draw calls throw inside the frame loop, and count every call.
 * @param {import('@playwright/test').Page} page
 * @param {'once' | 'always'} mode
 */
async function injectDrawFault(page, mode) {
  await page.evaluate((mode) => {
    const proto = WebGL2RenderingContext.prototype;
    const real = proto.drawArrays;
    let armed = true;
    /** @type {any} */ (window).__draws = 0;
    proto.drawArrays = function (...args) {
      /** @type {any} */ (window).__draws++;
      if (mode === 'always' || armed) {
        armed = false;
        throw new Error('injected frame fault');
      }
      return real.apply(this, args);
    };
  }, mode);
}

const draws = (page) => page.evaluate(() => /** @type {any} */ (window).__draws);

test('a frame that throws once is reported, and the loop carries on', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitForBoot(page);

  await injectDrawFault(page, 'once');
  await expect.poll(() => errors.length).toBe(1);
  expect(errors[0]).toContain('injected frame fault');

  // Before the guard, the next frame was requested only after this one finished, so the
  // first exception ended the loop and nothing was ever drawn again.
  const after = await draws(page);
  await expect.poll(() => draws(page)).toBeGreaterThan(after + 20);
  await expect(page.locator('#error')).toBeHidden();
  expect(errors).toHaveLength(1);
});

test('a fault on every frame stops the loop and says so on screen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await waitForBoot(page);

  await injectDrawFault(page, 'always');
  await expect(page.locator('#error')).toBeVisible();
  await expect(page.locator('#error')).toContainText('stopped after an internal error');
  await expect(page.locator('#error')).toContainText('injected frame fault');

  // Reported once, not once per frame, and the loop really has stopped.
  expect(errors).toHaveLength(1);
  const stopped = await draws(page);
  await page.waitForTimeout(500);
  expect(await draws(page)).toBe(stopped);
});

test('Enter deploys from the bare menu only, never through a focused control', async ({ page }) => {
  await page.goto('/');
  await waitForBoot(page);
  const state = () => page.evaluate(() => window.RobotWarrior.getStatus().state);

  // A focused button handles Enter itself. Before, the global handler also deployed a
  // solo mission underneath whatever that button opened.
  await page.locator('#briefBtn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#brief')).toBeVisible();
  expect(await state()).toBe('menu');

  // An open briefing is not the bare menu either, even with nothing focused.
  await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
  await page.keyboard.press('Enter');
  expect(await state()).toBe('menu');

  await page.keyboard.press('Escape');
  await expect(page.locator('#brief')).toBeHidden();
  await page.evaluate(() => /** @type {HTMLElement} */ (document.activeElement)?.blur());
  await page.keyboard.press('Enter');
  await expect.poll(state).not.toBe('menu');
});
