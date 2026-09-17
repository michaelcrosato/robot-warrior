---
name: audio
description: Work on RobotWarrior's audio — adding or changing a voice line or music cue, regenerating the audio manifest, debugging a clip that will not play, or handling the untracked soundtrack. Use when touching src/audio/, src/data/audio-manifest.js, assets/audio/, or investigating silence.
---

# Audio in RobotWarrior

Two systems, both in `src/audio/`:

- **`sound-system.js`** — procedural effects (weapons, warnings, the reactor hum,
  cockpit interface sounds) synthesised with oscillators and noise buffers, plus radio
  speech played from short recorded clips.
- **`soundtrack.js`** — the streaming mission soundtrack, one cue at a time, with
  crossfades.

Nothing is inlined. Both load over the network from `assets/audio/`, through the URLs
built by `src/data/audio-manifest.js`.

## The one thing to know first

`assets/audio/music/` is **not in the repository and must never be committed.** Its three
tracks are commercial recordings from the _MechWarrior 2_ soundtrack. So is the original
`RobotWarrior.html`, which has them embedded. Both are gitignored, and git history is
permanent once pushed.

A fresh clone therefore has no mission music, and that is correct. The game plays
normally; music is silent. If you are debugging "no music", check whether those three
files exist before looking at code:

```bash
pnpm assets:check
```

Full background: [docs/assets.md](../../../docs/assets.md) and
[ADR 0003](../../../docs/adr/0003-keep-the-soundtrack-out-of-the-repo.md).

## The manifest is generated

`src/data/audio-manifest.js` is written by `scripts/extract-assets.mjs`. Do not hand-edit
it — change the generator and re-run:

```bash
pnpm assets:extract                                        # from ./RobotWarrior.html
node scripts/extract-assets.mjs --source path/to/build.html # from elsewhere
```

It identifies each clip by magic bytes rather than by name, so a clip in the wrong
container still lands with the right extension.

The manifest is the only place that knows which clips exist and what container each uses.
It builds URLs from `import.meta.env.BASE_URL`, so the same source works served from `/`
locally and from `/robot-warrior/` on Pages.

## Adding a voice line

1. Put the file in `assets/audio/voice/<key>.ogg` (or `.mp3`).
2. Add `{ key: '<key>', ext: 'ogg' }` to `VOICE_CLIPS` — via the generator if it came
   from an original build, by hand in `scripts/extract-assets.mjs`'s output shape
   otherwise.
3. Play it with `sound.say('<key>')`.
4. `pnpm assets:check` — it fails on a manifest entry with no file, and on a file the
   manifest does not list.

Voice clips are committed, so a missing one is a broken build rather than a local
configuration difference.

## Adding a music cue

Add an entry to `SOUNDTRACK_INFO` in `src/audio/soundtrack.js` with `title`, `duration`
and `loop`, then drop `assets/audio/music/<key>.mp3` in place. `duration` is only used
for progress display before a track finishes decoding, so a mismatch is cosmetic.

## Failures are deliberately quiet

A soundtrack track that will not load logs once at `console.info` and the game continues.
A voice clip that will not decode is swallowed entirely. Both are intentional: audio is
never allowed to take the game down, and the most common cause is simply an absent
optional asset.

That does mean silence will not announce itself. To see what actually happened:

```js
window.RobotWarrior.getStatus().audio;
// { cue, title, playing, position, duration, loop, loaded: [...], failed: [...] }
```

`loaded` and `failed` are the two fields worth reading.

## Audio in tests

Headless Chromium needs `--autoplay-policy=no-user-gesture-required` or the context stays
suspended and nothing decodes; `--mute-audio` keeps CI quiet. `playwright.config.js`
already passes both.

In a real browser the context cannot start without a gesture, which is why the audio
graph is built when a mission starts rather than at load.

`initCoop()` wraps `tone`, `noise`, `say` and `fxPlay` so a replayed or remote-owned
frame stays silent. If you add a new sound entry point, it needs the same treatment or
co-op reconciliation will retrigger it — see `src/net/coop-bridge.js`.

## The offline build

`pnpm build:single` inlines every clip as a data URL on
`window.__ROBOTWARRIOR_ASSETS__`. `fetch()` accepts data URLs, so the loaders are
identical online and offline — there is no second code path to keep in sync. If you
change how URLs are resolved, keep that property.
