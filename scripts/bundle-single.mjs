/**
 * Build the offline single-file distribution.
 *
 *   pnpm run build && node scripts/bundle-single.mjs
 *   pnpm run build:single
 *
 * The original RobotWarrior was one HTML file that ran from a USB stick with no
 * server and no network. That is worth keeping, so this folds a normal production
 * build back into one file: the stylesheet and module become inline, and every audio
 * clip becomes a data URL installed on `window.__ROBOTWARRIOR_ASSETS__`. fetch()
 * accepts data URLs, so the audio loaders are unchanged — see src/data/audio-manifest.js.
 *
 * Output goes to dist-single/, which is gitignored. It embeds whatever is in
 * assets/audio/music/, so a bundle built with the soundtrack present must not be
 * redistributed. See docs/assets.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT_DIR = path.join(ROOT, 'dist-single');
const OUT = path.join(OUT_DIR, 'RobotWarrior.html');

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/index.html not found. Run `pnpm run build` first.');
  process.exit(1);
}

const MIME = { '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

let html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

/** Replace one tag with inline content, failing loudly if the tag is not there. */
function inline(pattern, build, label) {
  const match = html.match(pattern);
  if (!match) {
    console.error(`Could not find the ${label} tag in dist/index.html.`);
    process.exit(1);
  }
  const file = path.join(DIST, match[1].replace(/^[./]*/, '').replace(/^.*?assets\//, 'assets/'));
  if (!fs.existsSync(file)) {
    console.error(`${label} references ${match[1]}, which is not in dist/.`);
    process.exit(1);
  }
  html = html.replace(match[0], build(fs.readFileSync(file, 'utf8')));
  return fs.statSync(file).size;
}

const cssBytes = inline(
  /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/,
  (css) => `<style>\n${css}\n</style>`,
  'stylesheet',
);

// --- audio as data URLs -----------------------------------------------------
const assets = {};
let audioBytes = 0;
let audioFiles = 0;
const missing = [];

for (const dir of ['audio/voice', 'audio/music']) {
  const full = path.join(DIST, dir);
  if (!fs.existsSync(full)) {
    missing.push(dir);
    continue;
  }
  for (const name of fs.readdirSync(full).sort()) {
    const ext = path.extname(name);
    const mime = MIME[ext];
    if (!mime) continue;
    const buf = fs.readFileSync(path.join(full, name));
    assets[`${dir}/${name}`] = `data:${mime};base64,${buf.toString('base64')}`;
    audioBytes += buf.length;
    audioFiles++;
  }
}

const assetScript = `<script>window.__ROBOTWARRIOR_ASSETS__=${JSON.stringify(assets)};</script>`;

// --- the module bundle ------------------------------------------------------
// The asset map must be installed before the module evaluates, so it is emitted
// immediately before the inlined script.
const jsBytes = inline(
  /<script[^>]+type="module"[^>]+src="([^"]+)"[^>]*><\/script>/,
  (js) =>
    assetScript +
    '\n<script type="module">\n' +
    // A literal </script> inside the bundle would close the tag early.
    js.replace(/<\/script>/gi, '<\\/script>') +
    '\n</script>',
  'module script',
);

// Drop the sourcemap comment: the map is a separate file that will not be there.
html = html.replace(/\n?\/\/# sourceMappingURL=[^\n]*/g, '');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, html);

const size = fs.statSync(OUT).size;
console.log(`stylesheet inlined   ${(cssBytes / 1024).toFixed(1)} kB`);
console.log(`module inlined       ${(jsBytes / 1024).toFixed(1)} kB`);
console.log(`audio inlined        ${audioFiles} clips, ${(audioBytes / 1048576).toFixed(2)} MB`);
if (missing.length) console.log(`audio not present    ${missing.join(', ')}`);
console.log(`\n${path.relative(ROOT, OUT)}  ${(size / 1048576).toFixed(2)} MB`);
if (assets['audio/music/basin.mp3']) {
  console.log(
    '\nThis bundle embeds the soundtrack. It is for your own offline use — do not\n' +
      'redistribute it. See docs/assets.md.',
  );
}
