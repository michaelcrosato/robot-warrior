/** Real browser touch input, hit-testing and visual evidence at both requested aspect ratios. */
import { test, expect } from './fixtures.js';
import { waitForBoot, MISSION_START_TIMEOUT } from './helpers/probe.js';

const orientations = [
  { name: 'portrait 9x16', width: 360, height: 640 },
  { name: 'landscape 16x9', width: 640, height: 360 },
];

async function centre(page, selector) {
  const box = await page.locator(selector).boundingBox();
  expect(box, selector).not.toBeNull();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function startMission(page) {
  await page.goto('/');
  await waitForBoot(page);
  await expect(page.locator('#touch')).toBeHidden();
  await page.locator('#startBtn').tap();
  await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing', null, {
    timeout: MISSION_START_TIMEOUT,
  });
  await expect(page.locator('#touchNotice')).not.toHaveText('SYSTEMS STARTING');
}

/** Unlike dispatchEvent, CDP sends native touches through the browser's hit test/capture. */
async function fingers(page) {
  const session = await page.context().newCDPSession(page);
  const points = new Map();
  const send = (type) =>
    session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: [...points.values()],
    });
  return {
    async down(id, p) {
      points.set(id, { id, ...p });
      await send('touchStart');
    },
    async move(id, p) {
      points.set(id, { id, ...p });
      await send('touchMove');
    },
    async up(id) {
      // CDP's touchEnd list names the changed (released) fingers, not those remaining.
      const released = points.get(id);
      points.delete(id);
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [released] });
    },
    async cancel() {
      points.clear();
      await send('touchCancel');
    },
  };
}

async function controls(page) {
  return page.evaluate(() => window.RobotWarrior.getControlStatus());
}

async function idle(page) {
  await expect
    .poll(() => controls(page))
    .toMatchObject({ throttle: 0, fire: false, jets: false, turning: false, aligning: false });
}

async function screenshot(page, info, name) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function checkLayout(page) {
  const faults = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('#touch .tbtn, #touchStick')].filter(
      (el) => el.getClientRects().length,
    );
    const errors = [];
    for (const el of buttons) {
      const r = el.getBoundingClientRect();
      const label = el.getAttribute('aria-label') || el.textContent;
      if (
        r.left < -0.5 ||
        r.top < -0.5 ||
        r.right > innerWidth + 0.5 ||
        r.bottom > innerHeight + 0.5
      )
        errors.push(`off-screen: ${label}`);
      if (r.width < 44 || r.height < 44) errors.push(`small target: ${label}`);
      for (const [x, y] of [
        [0.5, 0.5],
        [0.25, 0.25],
        [0.75, 0.75],
      ]) {
        const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y);
        if (!el.contains(hit)) errors.push(`covered: ${label} by ${hit?.id || hit?.tagName}`);
      }
    }
    for (let i = 0; i < buttons.length; i++)
      for (const b of buttons.slice(i + 1)) {
        const a = buttons[i].getBoundingClientRect();
        const r = b.getBoundingClientRect();
        if (
          Math.min(a.right, r.right) > Math.max(a.left, r.left) + 1 &&
          Math.min(a.bottom, r.bottom) > Math.max(a.top, r.top) + 1
        )
          errors.push(`overlap: ${buttons[i].textContent} / ${b.textContent}`);
      }
    if (document.documentElement.scrollWidth > innerWidth) errors.push('horizontal overflow');
    return errors;
  });
  expect(faults).toEqual([]);
}

for (const orientation of orientations) {
  test.describe(orientation.name, () => {
    test.use({
      viewport: { width: orientation.width, height: orientation.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });

    test('readable cockpit, reachable panels and screenshot evidence', async ({ page }, info) => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/');
      await waitForBoot(page);
      await screenshot(page, info, 'menu');
      await expect(page.locator('#inputHint')).toContainText('PORTRAIT OR LANDSCAPE');
      await startMission(page);
      await checkLayout(page);
      await expect(page.locator('#touchArmor')).toHaveText(/\d+%/);
      expect(
        await page
          .locator('#touchArmor')
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBeGreaterThanOrEqual(14);
      expect(
        await page.evaluate(
          () => document.elementFromPoint(innerWidth / 2, innerHeight * 0.43)?.id,
        ),
      ).toBe('touchAim');
      expect(await page.evaluate(() => document.pointerLockElement)).toBeNull();
      await screenshot(page, info, 'cockpit');
      await page.getByRole('button', { name: 'Systems', exact: true }).tap();
      await expect(page.locator('#touchTools')).toBeVisible();
      await expect(page.locator('#touchControls')).toBeHidden();
      await checkLayout(page);
      await screenshot(page, info, 'systems');
      await page.getByRole('button', { name: 'ZOOM', exact: true }).tap();
      await expect(page.getByRole('button', { name: 'ZOOM', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByRole('button', { name: 'IMAGING', exact: true }).tap();
      await expect
        .poll(() => page.evaluate(() => window.RobotWarrior.getStatus().imaging))
        .toBe(true);
      await page.getByRole('button', { name: 'NIGHT', exact: true }).tap();
      await expect
        .poll(() => page.evaluate(() => window.RobotWarrior.getStatus().nightVision))
        .toBe(true);
      await expect(page.locator('#touchTools [data-touch="coolant"]')).toBeDisabled();
      await page.getByRole('button', { name: 'Close systems' }).tap();
      await page.getByRole('button', { name: 'Tactical map', exact: true }).tap();
      await expect(page.locator('#touchMapPanel')).toBeVisible();
      await checkLayout(page);
      expect(
        await page.locator('#touchMap').evaluate((el) => el.getBoundingClientRect().height),
      ).toBeGreaterThan(100);
      await screenshot(page, info, 'map');
      await page.getByRole('button', { name: 'Close map' }).tap();
      await expect(page.locator('#touchControls')).toBeVisible();
      await page.getByRole('button', { name: 'Pause', exact: true }).tap();
      await expect(page.locator('#touch')).toBeHidden();
      await expect(page.locator('#pause')).toBeVisible();
      await screenshot(page, info, 'pause');
      await page.locator('#resumeBtn').tap();
      await expect(page.locator('#touch')).toBeVisible();
      await idle(page);
      expect(errors).toEqual([]);
    });

    test('two thumbs move, aim and fire together; releasing each finger stops its action', async ({
      page,
    }, info) => {
      await startMission(page);
      await page.locator('[data-touch="weapon"][data-index="1"]').tap();
      await expect.poll(() => controls(page)).toMatchObject({ weapon: 1 });
      const stick = await centre(page, '#touchStick');
      const fire = await centre(page, '[data-touch="fire"]');
      const before = await page.evaluate(() => window.RobotWarrior.getStatus());
      const touch = await fingers(page);
      await touch.down(1, { x: stick.x, y: stick.y - 38 });
      await touch.down(2, fire);
      // Slide outside the fire button: capture must preserve aim and firing.
      await touch.move(2, { x: fire.x - 65, y: fire.y - 28 });
      await expect
        .poll(() => page.evaluate(() => window.RobotWarrior.getStatus().ammo))
        .toBeLessThan(before.ammo);
      await expect
        .poll(() => page.evaluate(() => window.RobotWarrior.getStatus().pitch))
        .toBeGreaterThan(before.pitch + 0.05);
      await expect
        .poll(() =>
          page.evaluate((from) => {
            const p = window.RobotWarrior.getStatus().position;
            return Math.hypot(p.x - from.x, p.z - from.z);
          }, before.position),
        )
        .toBeGreaterThan(3);
      expect((await controls(page)).yaw).toBeLessThan(-0.05);
      await screenshot(page, info, 'two-thumbs');
      await touch.up(2);
      await expect.poll(() => controls(page)).toMatchObject({ fire: false });
      expect((await controls(page)).throttle).toBeGreaterThan(0.5);
      await touch.up(1);
      await idle(page);
      const look = { x: orientation.width * 0.5, y: orientation.height * 0.35 };
      const previousTorso = await page.evaluate(() => window.RobotWarrior.getStatus().torso);
      await touch.down(1, look);
      await touch.move(1, { x: look.x + 35, y: look.y });
      await touch.up(1);
      await expect
        .poll(() => page.evaluate(() => window.RobotWarrior.getStatus().torso))
        .toBeGreaterThan(previousTorso + 0.05);
      await idle(page);
      await expect
        .poll(() => page.evaluate(() => Math.abs(window.RobotWarrior.getStatus().speed)))
        .toBeLessThan(0.1);
      const ammo = await page.evaluate(() => window.RobotWarrior.getStatus().ammo);
      const time = await page.evaluate(() => window.RobotWarrior.getStatus().time);
      await page.waitForFunction((from) => window.RobotWarrior.getStatus().time > from + 2, time);
      expect(await page.evaluate(() => window.RobotWarrior.getStatus().ammo)).toBe(ammo);
      await touch.down(1, { x: stick.x + 40, y: stick.y });
      const yaw = (await controls(page)).yaw;
      await expect.poll(async () => (await controls(page)).yaw).toBeGreaterThan(yaw + 0.1);
      await touch.up(1);
      await touch.down(1, { x: stick.x, y: stick.y + 40 });
      await expect
        .poll(() => page.evaluate(() => window.RobotWarrior.getStatus().speed))
        .toBeLessThan(-1);
      await touch.up(1);
      await idle(page);
    });

    test('cancellation, rotation and pause cannot leave controls stuck', async ({ page }, info) => {
      await startMission(page);
      const touch = await fingers(page);
      let stick = await centre(page, '#touchStick');
      let fire = await centre(page, '[data-touch="fire"]');
      const jet = await centre(page, '[data-touch="jump"]');
      await touch.down(1, { x: stick.x, y: stick.y - 35 });
      await touch.down(2, fire);
      await touch.down(3, jet);
      await expect.poll(async () => (await controls(page)).fuel).toBeLessThan(99);
      await touch.cancel();
      await idle(page);
      const fireButton = page.locator('[data-touch="fire"]');
      await fireButton.evaluate((el) =>
        el.addEventListener(
          'pointerdown',
          (e) => {
            el.dataset.testPointer = String(/** @type {PointerEvent} */ (e).pointerId);
          },
          { once: true },
        ),
      );
      await touch.down(1, fire);
      await expect.poll(async () => (await controls(page)).fire).toBe(true);
      await fireButton.evaluate((el) => el.releasePointerCapture(Number(el.dataset.testPointer)));
      // Capture loss is delivered by the browser at its next pointer dispatch.
      await touch.move(1, { x: fire.x + 2, y: fire.y });
      await idle(page);
      await touch.cancel();
      await touch.down(1, fire);
      await touch.down(2, { x: fire.x + 12, y: fire.y });
      await touch.up(2);
      await expect.poll(async () => (await controls(page)).fire).toBe(true);
      await touch.up(1);
      await idle(page);
      await touch.down(1, { x: stick.x, y: stick.y - 35 });
      await touch.down(2, fire);
      await touch.down(3, await centre(page, '[data-touch="pause"]'));
      await expect(page.locator('#pause')).toBeVisible();
      await touch.cancel();
      await page.locator('#resumeBtn').tap();
      await idle(page);
      await touch.down(1, { x: stick.x, y: stick.y - 35 });
      await touch.down(2, fire);
      await page.setViewportSize({ width: orientation.height, height: orientation.width });
      await idle(page);
      await touch.cancel();
      await checkLayout(page);
      await screenshot(page, info, 'rotated');
      stick = await centre(page, '#touchStick');
      fire = await centre(page, '[data-touch="fire"]');
      await touch.down(1, { x: stick.x, y: stick.y - 35 });
      await touch.down(2, fire);
      await touch.down(3, await centre(page, '#touchTop [data-touch="map"]'));
      await expect(page.locator('#touchMapPanel')).toBeVisible();
      await idle(page);
      await touch.cancel();
      await page.getByRole('button', { name: 'Close map' }).tap();
      await touch.down(1, fire);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await expect(page.locator('#pause')).toBeVisible();
      await idle(page);
      await touch.cancel();
    });

    test('automatic target lock enables missiles; sustained fire uses the heat guard', async ({
      page,
    }) => {
      await startMission(page);
      await expect.poll(async () => (await controls(page)).target).not.toBeNull();
      await expect.poll(async () => (await controls(page)).lock).toBe(1);
      await page.locator('[data-touch="weapon"][data-index="2"]').tap();
      const before = await page.evaluate(() => window.RobotWarrior.getStatus().missiles);
      const touch = await fingers(page);
      const fire = await centre(page, '[data-touch="fire"]');
      await touch.down(1, fire);
      await expect
        .poll(() => page.evaluate(() => window.RobotWarrior.getStatus().missiles))
        .toBeLessThan(before);
      await touch.up(1);
      await page.locator('[data-touch="weapon"][data-index="0"]').tap();
      await touch.down(1, fire);
      await expect.poll(async () => (await controls(page)).cooling, { timeout: 30000 }).toBe(true);
      expect(await page.evaluate(() => window.RobotWarrior.getStatus().heat)).toBeLessThan(100);
      const shots = (await controls(page)).shots;
      await expect.poll(async () => (await controls(page)).shots).toBeGreaterThan(shots);
      await touch.up(1);
      await idle(page);
      const coolants = (await controls(page)).coolants;
      await page.getByRole('button', { name: 'Systems', exact: true }).tap();
      const heat = await page.evaluate(() => window.RobotWarrior.getStatus().heat);
      expect(heat).toBeGreaterThan(12);
      await page.locator('#touchTools [data-touch="coolant"]').tap();
      await expect.poll(async () => (await controls(page)).coolants).toBe(coolants - 1);
      expect(await page.evaluate(() => window.RobotWarrior.getStatus().heat)).toBeLessThan(
        heat - 40,
      );
    });
  });
}

test('desktop retains its cockpit, keyboard throttle and wheel weapon cycling', async ({
  page,
}) => {
  await page.goto('/');
  await waitForBoot(page);
  await page.locator('#startBtn').click();
  await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing', null, {
    timeout: MISSION_START_TIMEOUT,
  });
  await expect(page.locator('#touch')).toBeHidden();
  expect((await controls(page)).touch).toBe(false);
  await page.keyboard.press('KeyB');
  await expect.poll(async () => (await controls(page)).throttle).toBe(1);
  await page.keyboard.press('KeyX');
  await expect.poll(async () => (await controls(page)).throttle).toBe(0);

  // The wheel listens on the world canvas, so the pointer has to be over it.
  const view = page.viewportSize();
  await page.mouse.move(view.width / 2, view.height / 2);
  const weapon = async () => (await controls(page)).weapon;
  const start = await weapon();
  await page.mouse.wheel(0, 100);
  await expect.poll(weapon).toBe((start + 1) % 3);
  // A sideways swipe is not "previous weapon", and a burst of momentum inside one repeat
  // window is one step, not a spin through all three.
  await page.waitForTimeout(200);
  await page.mouse.wheel(90, 0);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 40);
  await expect.poll(weapon).toBe((start + 2) % 3);
  await page.waitForTimeout(300);
  expect(await weapon()).toBe((start + 2) % 3);
});

test.describe('compact phones and safe areas', () => {
  test.use({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });
  test('thumb controls stay reachable as the viewport and safe areas change', async ({
    page,
  }, info) => {
    await startMission(page);
    for (const [width, height] of [
      [320, 568],
      [568, 320],
      [412, 915],
      [915, 412],
    ]) {
      await page.setViewportSize({ width, height });
      await idle(page);
      await checkLayout(page);
      await screenshot(page, info, `phone-${width}x${height}`);
    }
    await page.setViewportSize({ width: 640, height: 360 });
    await page.locator('#touch').evaluate((el) => {
      el.style.setProperty('--touch-left', '44px');
      el.style.setProperty('--touch-right', '44px');
      el.style.setProperty('--touch-bottom', '24px');
    });
    await checkLayout(page);
    await screenshot(page, info, 'landscape-safe-areas');
  });
});
