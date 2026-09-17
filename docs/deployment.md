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

**There is deliberately no Content-Security-Policy.** Co-op connects to a signalling
server the player can change in the lobby, and to whatever STUN/TURN hosts that returns.
A policy strict enough to be worth having would break online play, and a policy loose
enough not to would not be worth having. For a static site with no backend and no
third-party scripts, the useful headers are the ones above.

### Working with it locally

```bash
vercel link                                  # once, connects this directory
vercel pull --yes --environment production   # fetch project settings
vercel build --yes --target production       # reproduce the real build locally
vercel deploy --prebuilt                     # deploy that exact output
```

`vercel build` writes to `.vercel/output/`, which is gitignored — as is `.env.local`,
which `vercel link` creates and which contains a short-lived OIDC token.

## GitHub Pages

`.github/workflows/pages.yml` builds with `PUBLIC_BASE=/robot-warrior/` and publishes
`dist/` through `actions/deploy-pages`. Pages is configured with `build_type: workflow`,
so the workflow is the source of truth and there is no branch-based publishing to keep
in sync.

## No music on either

Neither deployment has mission music. The three soundtrack tracks are not distributed
with this source (see [assets.md](assets.md) and
[ADR 0003](adr/0003-keep-the-soundtrack-out-of-the-repo.md)), so both hosts serve a build
without them and the browser logs a 404 for each cue.

This is expected and handled: the game plays normally with music silent. The end-to-end
suite ignores 404s under `audio/music/` for exactly this reason, and asserts separately
that every cue ends up either loaded or reported as unavailable.

If you want music on your own deployment, put the files in `assets/audio/music/` before
building. They are gitignored, so that means building from a working copy that has them
rather than from a fresh clone.

## The offline build is not deployed anywhere

`pnpm run build:single` produces `dist-single/RobotWarrior.html`, a self-contained ~12 MB
file that runs from `file://` with every clip inlined as a data URL. It is built in CI to
prove it still works, but it is never published — on a machine that has the soundtrack, it
would embed those recordings.
