/**
 * Capture a behavioural baseline from the original single-file build.
 *
 * This runs against the untracked `RobotWarrior.html` — the 13 MB monolith the unpacked
 * source was derived from. The JSON it writes is the reference the end-to-end parity suite
 * compares against, so the refactor is verified against observed behaviour rather than
 * against an assumption that it still works.
 *
 *   node scripts/capture-baseline.mjs
 *
 * The baseline is committed. Re-capturing it requires the original file, so if it
 * is missing the script says so and exits without overwriting anything.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { probeBoot, probeMission } from '../tests/e2e/helpers/probe.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINAL = path.join(ROOT, 'RobotWarrior.html');
const OUT = path.join(ROOT, 'tests/e2e/__baseline__/original.json');

if (!fs.existsSync(ORIGINAL)) {
  console.error(
    'RobotWarrior.html is not present.\n' +
      'It is intentionally untracked (see docs/assets.md). Restore your local copy\n' +
      'to re-capture the baseline; the committed baseline is used otherwise.',
  );
  process.exit(1);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  const file = path.join(ROOT, rel || 'RobotWarrior.html');
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
const url = `http://127.0.0.1:${port}/RobotWarrior.html`;
console.log('serving original at', url);

const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + m.text());
  });

  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });

  const boot = await probeBoot(page);
  console.log('booted version', boot.version);
  const mission = await probeMission(page);
  console.log('mission entities:', mission.entities.length);

  if (errors.length) {
    console.warn('original build reported errors:\n  ' + errors.join('\n  '));
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify(
      {
        capturedFrom: 'RobotWarrior.html (original single-file build)',
        note: 'Reference behaviour for the unpacked source. Regenerate with pnpm run baseline.',
        boot,
        mission,
        originalErrors: errors,
      },
      null,
      2,
    ) + '\n',
  );
  console.log('baseline written to', path.relative(ROOT, OUT));
} finally {
  await browser.close();
  server.close();
}
