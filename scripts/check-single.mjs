/**
 * Prove the offline single-file build actually runs.
 *
 *   node scripts/check-single.mjs     (after `pnpm build:single`)
 *
 * CI built dist-single/RobotWarrior.html on every run but never opened it, so the file
 * could stop working from file:// — a module that needs a server, an asset URL that only
 * resolves over HTTP, an inlining step that mangled the bundle — with CI still green.
 * This opens it the way a player does, from disk with no server, and fails on any page
 * error or a boot that never reaches the menu. It then deploys, which exercises the
 * inlined voice clips and the audio start-up.
 */
// The callbacks passed to page.waitForFunction and page.evaluate run in the page.
/* global window, document */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { guardPointerLock } from '../tests/e2e/helpers/pointer-lock.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'dist-single', 'RobotWarrior.html');

if (!fs.existsSync(FILE)) {
  console.error('dist-single/RobotWarrior.html is missing. Run: pnpm build:single');
  process.exit(1);
}

// The same flags as playwright.config.js: SwiftShader for WebGL, and audio that may start.
const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ],
});

let failed = false;
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 600 } });
  // Deploying requests pointer lock, which on Windows would clip the real cursor.
  await guardPointerLock(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(pathToFileURL(FILE).href);
  await page.waitForFunction(
    () => window.RobotWarrior && document.getElementById('loading')?.hidden,
    null,
    { timeout: 60_000 },
  );
  const menu = await page.evaluate(() => window.RobotWarrior.getStatus().state);
  const version = await page.evaluate(() => window.RobotWarrior.version);

  await page.click('#startBtn');
  await page.waitForFunction(
    () => ['boot', 'playing'].includes(window.RobotWarrior.getStatus().state),
    null,
    { timeout: 30_000 },
  );

  if (menu !== 'menu') throw Error(`booted into "${menu}", not the menu`);
  if (errors.length) throw Error('page errors:\n  ' + errors.join('\n  '));
  console.log(`dist-single/RobotWarrior.html boots from file:// (v${version}) and deploys.`);
} catch (e) {
  failed = true;
  console.error('The offline single-file build does not run:', e.message);
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
