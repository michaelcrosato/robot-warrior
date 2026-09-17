# Audio assets

The game loads audio from `assets/audio/`. Two directories, treated differently.

## `assets/audio/voice/` — committed

40 short radio and cockpit lines (~0.6 MB), generated for this game. They ship with
the repository and need no setup. `pnpm run assets:check` fails if one is missing,
because a missing voice line is a broken build.

## `assets/audio/music/` — not committed

Three mission tracks, about 8.6 MB. They are **not in this repository and will not
be**, because they are not ours to distribute:

| Cue     | Track                 | Credited to                        |
| ------- | --------------------- | ---------------------------------- |
| `boot`  | 3-01 "Reactor Online" | Carole Ruggier, 1996               |
| `basin` | 1-02 Umber Wall       | Gregory Alper & Jeehun Hwang, 1995 |
| `works` | 1-03 Silent Thunder   | Gregory Alper & Jeehun Hwang, 1995 |

All three are from the _MechWarrior 2_ soundtrack — commercial recordings under
someone else's copyright. The original single-file build had them embedded as base64,
which is why that file is untracked too (see below). Publishing them here would be
infringement regardless of intent, and git history is permanent once pushed, so they
have been kept out from the first commit rather than removed later.

**The game is fully playable without them.** Mission music is silent; every other
sound — weapons, warnings, radio speech, the cockpit — is unaffected. A missing track
is logged once at `console.info` and never as an error.

## Adding your own music

Drop three files in `assets/audio/music/` named after the cue keys:

```
assets/audio/music/boot.mp3     short startup sting, does not loop
assets/audio/music/basin.mp3    Kestrel Basin, loops
assets/audio/music/works.mp3    Ashfall Works and Blackglass Ridge, loops
```

Anything the browser can decode works — MP3 is what the manifest expects by default.
The directory is gitignored, so your files stay local.

Titles and expected durations live in `SOUNDTRACK_INFO` in
[`src/audio/soundtrack.js`](../src/audio/soundtrack.js). Duration is only used to
show progress before a track finishes decoding, so a mismatch is cosmetic.

Then check they are seen:

```bash
pnpm run assets:check
```

## Regenerating from the original build

If you have the original 13 MB `RobotWarrior.html`, the extractor pulls every clip out
of it and regenerates the manifest:

```bash
node scripts/extract-assets.mjs --source path/to/RobotWarrior.html
```

It identifies each clip by magic bytes rather than trusting a name, writes music and
voice to their separate directories, and rewrites
[`src/data/audio-manifest.js`](../src/data/audio-manifest.js) — which is generated, so
do not hand-edit it.

`RobotWarrior.html` itself is gitignored for the same reason the music is: it carries
those recordings inline.

## How loading works

`src/data/audio-manifest.js` is the only place that knows which clips exist and what
container each uses. It builds URLs from `import.meta.env.BASE_URL`, so the same
source works served from `/` locally and from `/robot-warrior/` on GitHub Pages.

The offline build (`pnpm run build:single`) inlines every clip as a data URL on
`window.__ROBOTWARRIOR_ASSETS__`. `fetch()` accepts data URLs, so the loaders in
`src/audio/` are identical in both cases — there is no offline code path to keep in
sync.

Note that a single-file bundle built on a machine that has the soundtrack present will
have those recordings embedded in it. That bundle is for your own offline use. Do not
redistribute it.
