/**
 * Verify the audio manifest matches what is actually on disk.
 *
 *   node scripts/check-assets.mjs
 *
 * Voice lines are committed, so a manifest entry without a file is a broken build and
 * fails. The soundtrack is not committed — see docs/assets.md — so missing tracks are
 * reported and the check still passes. That asymmetry is the point: CI must go green
 * on a fresh clone, and a contributor who has dropped their own music in should be
 * told if it is not being picked up.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'src/data/audio-manifest.js');

if (!fs.existsSync(MANIFEST)) {
  console.error('src/data/audio-manifest.js is missing. Run: pnpm run assets:extract');
  process.exit(1);
}

const { MUSIC_CLIPS, VOICE_CLIPS } = await import('file://' + MANIFEST.replace(/\\/g, '/')).catch(
  (error) => {
    console.error('Could not load the audio manifest:', error.message);
    process.exit(1);
  },
);

/** @param {{key:string,ext:string}[]} clips @param {string} dir */
function audit(clips, dir) {
  const present = [];
  const missing = [];
  for (const clip of clips) {
    const rel = `${dir}/${clip.key}.${clip.ext}`;
    const file = path.join(ROOT, rel);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) present.push({ ...clip, rel });
    else missing.push(rel);
  }
  return { present, missing };
}

/** Files on disk that no manifest entry claims. */
function orphans(clips, dir) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) return [];
  const claimed = new Set(clips.map((c) => `${c.key}.${c.ext}`));
  return fs.readdirSync(full).filter((name) => !claimed.has(name) && !name.startsWith('.'));
}

const voice = audit(VOICE_CLIPS, 'assets/audio/voice');
const music = audit(MUSIC_CLIPS, 'assets/audio/music');
const voiceOrphans = orphans(VOICE_CLIPS, 'assets/audio/voice');

let failed = false;

console.log(`voice   ${voice.present.length}/${VOICE_CLIPS.length} present`);
if (voice.missing.length) {
  failed = true;
  console.error(
    '\nMissing committed voice clips:\n  ' +
      voice.missing.join('\n  ') +
      '\n\nThese ship with the repository. Restore them from git, or regenerate the\n' +
      'manifest from your own build: pnpm run assets:extract\n',
  );
}
if (voiceOrphans.length) {
  failed = true;
  console.error(
    '\nVoice files on disk that the manifest does not list:\n  ' +
      voiceOrphans.join('\n  ') +
      '\n\nRegenerate the manifest so they load: pnpm run assets:extract\n',
  );
}

console.log(`music   ${music.present.length}/${MUSIC_CLIPS.length} present`);
if (music.missing.length) {
  console.log(
    '\nThe soundtrack is not distributed with this repository, so these are expected\n' +
      'to be absent on a fresh clone. The game runs without them; mission music is\n' +
      'simply silent. See docs/assets.md to add your own.\n  ' +
      music.missing.join('\n  ') +
      '\n',
  );
}

if (failed) process.exit(1);
console.log('assets ok');
