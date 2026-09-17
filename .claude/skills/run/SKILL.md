---
name: run
description: Launch RobotWarrior and confirm a change works in the real game — starting the dev server, driving it in a browser, reading its status API, or capturing a screenshot. Use when asked to run, start, play, screenshot or verify the game end to end, rather than only running tests.
---

# Running RobotWarrior

The game needs a real WebGL context and a real WebAudio graph. It cannot be checked in
jsdom, and "the unit tests pass" says nothing about whether it renders.

## Dev server

```bash
pnpm dev            # http://127.0.0.1:5180
```

Port 5180, not Vite's default 5173, and bound to 127.0.0.1 explicitly — Vite's default
`localhost` can resolve to `::1` only, which makes an IPv4 health check fail against a
server that is in fact running. `strictPort` is on, so a clash fails loudly instead of
silently serving something else.

For the production build:

```bash
pnpm build && pnpm exec vite preview    # http://127.0.0.1:4180
```

## The status API, not screenshots

The game freezes a read-only API onto the page:

```js
window.RobotWarrior.getStatus(); // mission state, pilot telemetry, entity roster
window.RobotWarrior.getCoopStatus();
window.RobotWarrior.version;
```

This is almost always the right way to check something, because it reports actual
simulation state rather than what a frame happens to look like. `getStatus()` returns
mission state, sector, objectives, position, heat, armour, ammunition, fps and every
live entity with its health. Its shape is typed in `src/types/globals.d.ts`.

Boot is complete when `window.RobotWarrior` exists **and** `#loading` is hidden. Waiting
on the API alone races the last of startup.

## Driving it headlessly

The end-to-end suite already does this, and reusing it is usually faster than writing a
new script:

```bash
pnpm test:e2e
```

To drive it yourself, the launch flags matter — headless Chromium has no GPU:

```js
const browser = await chromium.launch({
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--autoplay-policy=no-user-gesture-required', // audio graph without a click
    '--mute-audio',
  ],
});
```

Reuse the probes in `tests/e2e/helpers/probe.js` — `waitForBoot`, `probeBoot`,
`probeMission`, `measureFrames` — rather than reimplementing the waits.

Always attach error listeners. A silent page error is the most common failure mode here,
and it will otherwise look like a timeout:

```js
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('ERROR:', m.text()));
```

## Playing it

`#startBtn` starts a mission. `WASD` moves, the mouse aims, `1`–`3` select weapons,
`Tab` is the tactical map, `Space` jumps, `E` is Enhanced Imaging. The field manual in
the menu lists the rest.

## Offline single-file build

```bash
pnpm build:single      # dist-single/RobotWarrior.html
```

Opens directly from `file://` with no server — every clip is inlined as a data URL. Good
for confirming the offline path still works after touching `src/audio/` or the manifest.

Note: if `assets/audio/music/` is populated on your machine, that bundle embeds
copyrighted recordings. Do not redistribute it. See `docs/assets.md`.

## When it will not boot

In order of likelihood:

1. **A page error during module evaluation.** Attach the listeners above. On the dev
   server the identifier names are real; in a production bundle they are minified, so
   reproduce against `pnpm dev` to get a readable message.
2. **`Cannot access 'X' before initialization`.** A cycle problem, or a local shadowing
   one of the shared-state objects. See `AGENTS.md` — this exact failure has happened.
3. **A port already in use.** `strictPort` means the server did not start. Check whether
   something else holds 5180 or 4180; do not assume the page you are looking at is this
   project.
4. **`#error` visible with a WebGL message.** The context could not be created. In
   headless runs, the SwiftShader flags above are missing.
