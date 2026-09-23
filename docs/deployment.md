# Deployment

The game is a static site: a single HTML page, one JS bundle, one stylesheet and the
audio files. There is no server, no database and no runtime dependency, so hosting it is
just serving a directory.

It is published to two places from the same `main` branch, which is a deliberate
redundancy rather than an accident — neither host is a single point of failure, and the
two exercise different parts of the build.

| Target       | URL                                             | Base path         | Driven by                       |
| ------------ | ----------------------------------------------- | ----------------- | ------------------------------- |
| GitHub Pages | https://michaelcrosato.github.io/robot-warrior/ | `/robot-warrior/` | `.github/workflows/pages.yml`   |
| Vercel       | https://robot-warrior.vercel.app                | `/`               | `vercel.json` + Git integration |

## The base path is the only real difference

GitHub Pages serves the project from a sub-path; Vercel serves it from the root. The
build handles both from one source:

- `vite.config.js` reads `PUBLIC_BASE` and falls back to `/`.
- The Pages workflow sets `PUBLIC_BASE=/robot-warrior/`. Vercel does not set it, so it
  gets `/`.
- `src/data/audio-manifest.js` builds every audio URL from `import.meta.env.BASE_URL`,
  which Vite substitutes at build time.

This is why audio URLs are never written as absolute paths. A hard-coded `/audio/...`
would work on Vercel and 404 on Pages.

## Vercel

The project is connected to `michaelcrosato/robot-warrior` through Vercel's GitHub
integration, with `main` as the production branch. Pushing to `main` deploys to
production; a pull request gets a preview deployment.

Vercel builds as soon as a commit lands and does not wait for CI. Gating production on CI
is a dashboard setting (Project Settings → Deployment Checks), not something
`vercel.json` can express; until it is on, Vercel production can briefly serve a commit
whose CI later fails. GitHub Pages does wait — see below.

Build settings live in `vercel.json` rather than in the dashboard, so they are
version-controlled and reviewable:

```
framework       vite
installCommand  pnpm install --frozen-lockfile
buildCommand    pnpm run build
outputDirectory dist
```

Vercel would infer all four from the Vite preset. They are stated anyway: a preset that
changes upstream should not silently change how this project builds.

`vercel.json` also sets response headers:

- `/assets/*` — hashed filenames, so `immutable` for a year.
- `/audio/*` — filenames are stable but not content-hashed, so a week with
  `stale-while-revalidate` rather than `immutable`.
- `/` — `must-revalidate`, so a deploy is picked up immediately.
- Everything — `nosniff`, a conservative `Referrer-Policy`, and a `Permissions-Policy`
  denying camera, microphone, geolocation, payment and USB. The game uses none of them,
  including in co-op: WebRTC data channels need no media permissions.
- Everything — a narrow `Content-Security-Policy`:
  `script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`.

The policy restricts where code comes from, not where the game connects. Co-op talks to a
signalling server the player can change in the lobby and to STUN/TURN hosts — Google's
STUN, PeerJS's public TURN, and one the player may add — so `connect-src` is left open;
restricting it would break online play. What the policy does buy is that no injected or
third-party script can run, no plugin content can load, a `<base>` tag cannot redirect
the bundle, and the page cannot be framed. The build has no inline scripts and no
`eval`, which is what makes `script-src 'self'` possible.

### Working with it locally

```bash
vercel link                                  # once, connects this directory
vercel pull --yes --environment production   # fetch project settings
vercel build --yes --target production       # reproduce the real build locally
```

**Do not `vercel deploy --prebuilt` from a working copy that has the soundtrack.** Vite
copies everything under `assets/` into the build, so `.vercel/output/` then contains the
three copyrighted tracks, and a prebuilt deploy uploads exactly that output — the licence
guard in CI only inspects git. Deploy by pushing to `main`: the Git integration builds
from a clean clone, which has no music. `.vercelignore` keeps the tracks out of a plain
`vercel deploy`, which uploads source, but it cannot help a prebuilt one.

`vercel build` writes to `.vercel/output/`, which is gitignored — as is `.env.local`,
which `vercel link` creates and which contains a short-lived OIDC token.

## GitHub Pages

`.github/workflows/pages.yml` builds with `PUBLIC_BASE=/robot-warrior/` and publishes
`dist/` through `actions/deploy-pages`. Pages is configured with `build_type: workflow`,
so the workflow is the source of truth and there is no branch-based publishing to keep
in sync.

It runs when the CI workflow finishes on `main`, and deploys that exact commit only if
CI passed; it can also be started by hand. It used to run on every push, in parallel with
CI, so a commit went live whether or not its tests passed. The Pages and OIDC permissions
belong to the deploy job alone, not to the build job that runs the toolchain.

## No music on either

Neither deployment has mission music. The three soundtrack tracks are not distributed
with this source (see [assets.md](assets.md) and
[ADR 0003](adr/0003-keep-the-soundtrack-out-of-the-repo.md)), so both hosts serve a build
without them and the browser logs a 404 for each cue.

This is expected and handled: the game plays normally with music silent. The end-to-end
suite ignores 404s under `audio/music/` for exactly this reason, and asserts separately
that every cue ends up either loaded or reported as unavailable.

If you want music in your own copy, put the files in `assets/audio/music/` before
building. They are gitignored, so that means building from a working copy that has them
rather than from a fresh clone — and it means that build must stay private: publishing the
recordings is exactly what ADR 0003 exists to prevent.

## Local builds and browser checks

```bash
pnpm dev                     # http://127.0.0.1:5180, source with hot reload
pnpm build
pnpm preview                 # http://127.0.0.1:4180, production output
```

Both servers bind to IPv4 loopback and use strict ports. A port conflict fails instead
of selecting another port; check the process serving the page before trusting a result.

The game needs real WebGL 2 and WebAudio. `pnpm test:e2e` builds and checks it in Chromium.
For an interactive check, wait until `window.RobotWarrior` exists **and** `#loading` is
hidden, then inspect:

```js
window.RobotWarrior.getStatus(); // mission, pilot telemetry, audio and entity roster
window.RobotWarrior.getCoopStatus();
window.RobotWarrior.scanTargets(); // expensive render-target diagnostic, not a frame hook
```

The API is read-only; its types live in `src/types/globals.d.ts`. Start a mission with
`#startBtn` and use the [controls in the README](../README.md#controls) or the in-game
field manual. Screenshots complement the status output when checking rendering and layout.

For custom browser probes, reuse `tests/e2e/helpers/probe.js` and the Chromium launch
options in `playwright.config.js`. The SwiftShader flags provide headless WebGL;
`--autoplay-policy=no-user-gesture-required` lets audio start and `--mute-audio` keeps it
quiet. Listen for page exceptions and console errors so a boot failure does not appear
only as a timeout. Missing optional music can produce network 404s, as described above.

If boot fails:

- Reproduce against `pnpm dev` for readable source names in errors.
- A `Cannot access 'X' before initialization` error usually points to a module cycle or
  shadowed shared-state name; see [AGENTS.md](../AGENTS.md).
- If `#error` reports WebGL unavailable, check hardware acceleration or the headless
  launch flags.

## The offline build is not deployed anywhere

`pnpm run build:single` produces `dist-single/RobotWarrior.html`, a self-contained
file that runs from `file://` with every clip inlined as a data URL. CI builds it and then
opens it from `file://` (`scripts/check-single.mjs`) to prove it boots and deploys, but it
is never published — on a machine that has the soundtrack, it
would embed those recordings.
