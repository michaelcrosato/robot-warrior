/**
 * Touch controls on a phone-shaped viewport.
 *
 * Emulates a Galaxy S26 held sideways — the device the mobile tier was tuned against.
 * The controls write to the same state the keyboard does, so these assert the *effect*
 * on the simulation rather than that a class got toggled: the stick moves the mech, the
 * fire button spends ammunition, the weapon pad changes the selected group.
 */
import { test, expect } from '@playwright/test';
import { waitForBoot } from './helpers/probe.js';

/** Galaxy S26, landscape. 894x412 CSS pixels at a 3x device pixel ratio. */
const PHONE = {
  viewport: { width: 894, height: 412 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 16; SM-S941B) AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/141.0.0.0 Mobile Safari/537.36',
};

test.use(PHONE);

/** Centre of an element, in CSS pixels. */
async function centre(page, selector) {
  return page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

/** Dispatch a pointer event the way a finger produces one. */
async function pointer(page, selector, type, x, y, pointerId = 7) {
  await page.evaluate(
    ({ selector, type, x, y, pointerId }) => {
      document.querySelector(selector).dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          pointerType: 'touch',
          isPrimary: true,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === 'pointerup' ? 0 : 1,
        }),
      );
    },
    { selector, type, x, y, pointerId },
  );
}

async function startMission(page) {
  await page.goto('/');
  await waitForBoot(page);
  await page.click('#startBtn');
  await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing', null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(800);
}

test.describe('touch controls', () => {
  test('appear on a coarse pointer, and only during a mission', async ({ page }) => {
    await page.goto('/');
    await waitForBoot(page);

    // Hidden behind the menu: the controls would cover the chassis selection.
    await expect(page.locator('#touch')).toBeHidden();
    await expect(page.locator('#inputHint')).toContainText('TOUCH CONTROLS');

    await page.click('#startBtn');
    await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing');
    await expect(page.locator('#touch')).toBeVisible();

    // A phone must land on the mobile tier or below, never on a desktop budget.
    const tier = await page.evaluate(() => window.RobotWarrior.getStatus().tier);
    expect(['potato', 'low', 'mobile']).toContain(tier);
  });

  test('clear the instrument row rather than covering it', async ({ page }) => {
    await startMission(page);

    // The cockpit draws its instrument panels from 78% of the canvas height down. Every
    // control must sit above that, or a thumb hides the armour diagram and the radar.
    const overlapping = await page.evaluate(() => {
      const instrumentTop = innerHeight * 0.78;
      const controls = /** @type {HTMLElement[]} */ ([
        ...document.querySelectorAll('#touch .tbtn, #touchStick'),
      ]);
      return controls
        .map((el) => ({ id: el.dataset.touch || el.id, bottom: el.getBoundingClientRect().bottom }))
        .filter((e) => e.bottom > instrumentTop);
    });
    expect(overlapping, 'controls must not overlap the instrument row').toEqual([]);
  });

  test('the stick drives throttle and the mech moves', async ({ page }) => {
    await startMission(page);
    const stick = await centre(page, '#touchStick');

    const before = await page.evaluate(() => window.RobotWarrior.getStatus().position);

    await pointer(page, '#touchStick', 'pointerdown', stick.x, stick.y);
    await pointer(page, '#touchStick', 'pointermove', stick.x, stick.y - 44);
    await page.waitForTimeout(1500);

    const status = await page.evaluate(() => window.RobotWarrior.getStatus());
    expect(status.speed, 'pushing the stick forward must move the mech').toBeGreaterThan(5);
    expect(await page.textContent('#stickReadout')).toMatch(/\d+%/);

    await pointer(page, '#touchStick', 'pointerup', stick.x, stick.y - 44);

    const after = await page.evaluate(() => window.RobotWarrior.getStatus().position);
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(3);
  });

  test('dragging swings the torso', async ({ page }) => {
    await startMission(page);
    const aim = await centre(page, '#touchAim');

    const before = await page.evaluate(() => window.RobotWarrior.getStatus());

    await pointer(page, '#touchAim', 'pointerdown', aim.x, aim.y, 8);
    for (let i = 1; i <= 10; i++) {
      await pointer(page, '#touchAim', 'pointermove', aim.x + i * 12, aim.y, 8);
    }
    await pointer(page, '#touchAim', 'pointerup', aim.x + 120, aim.y, 8);
    await page.waitForTimeout(300);

    const after = await page.evaluate(() => window.RobotWarrior.getStatus());
    expect(after.torso, 'dragging right must swing the torso right').toBeGreaterThan(
      before.torso + 0.1,
    );

    // And back the other way, so this is testing the drag rather than a one-way drift.
    await pointer(page, '#touchAim', 'pointerdown', aim.x, aim.y, 11);
    for (let i = 1; i <= 10; i++) {
      await pointer(page, '#touchAim', 'pointermove', aim.x - i * 12, aim.y, 11);
    }
    await pointer(page, '#touchAim', 'pointerup', aim.x - 120, aim.y, 11);
    await page.waitForTimeout(300);

    const back = await page.evaluate(() => window.RobotWarrior.getStatus());
    expect(back.torso, 'dragging left must swing it back').toBeLessThan(after.torso - 0.1);
  });

  test('a quick tap registers — capture must not swallow it', async ({ page }) => {
    // Regression: setPointerCapture throws for a pointer that has already been released,
    // which a fast tap produces routinely. Called before the action it aborted the handler,
    // so quick taps did nothing while slow presses worked.
    await startMission(page);

    const weapon = await centre(page, '[data-touch="weapon"][data-index="2"]');
    await page.touchscreen.tap(weapon.x, weapon.y);
    await page.waitForTimeout(300);

    const selected = await page.evaluate(() => {
      const el = /** @type {HTMLElement|null} */ (
        document.querySelector('#touchWeapons .selected')
      );
      return el?.dataset.index;
    });
    expect(selected, 'a raw touchscreen tap must select the weapon').toBe('2');
    expect(await page.evaluate(() => window.RobotWarrior.getStatus().state)).toBe('playing');
  });

  test('the fire button spends ammunition', async ({ page }) => {
    await startMission(page);

    // Group 2 is the coil cannon: finite ammunition, so firing is observable.
    const weapon = await centre(page, '[data-touch="weapon"][data-index="1"]');
    await page.touchscreen.tap(weapon.x, weapon.y);
    await page.waitForTimeout(250);

    const before = await page.evaluate(() => window.RobotWarrior.getStatus().ammo);
    const fire = await centre(page, '[data-touch="fire"]');
    await pointer(page, '[data-touch="fire"]', 'pointerdown', fire.x, fire.y, 10);
    await page.waitForTimeout(900);
    await pointer(page, '[data-touch="fire"]', 'pointerup', fire.x, fire.y, 10);

    const after = await page.evaluate(() => window.RobotWarrior.getStatus().ammo);
    expect(after, 'holding fire must spend ammunition').toBeLessThan(before);
  });
});
