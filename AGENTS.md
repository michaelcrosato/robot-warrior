# Working in this repository

This file is for coding agents. It is the one place that says how to build, verify and
change this codebase; everything else is reference. Humans should read it too — it is
shorter than the alternative.

This project is developed almost entirely by agents. That is not a slogan, it is a
constraint on how the code and the checks are arranged: the verification gate has to be
trustworthy enough to act as the reviewer, and the reasoning behind non-obvious choices
has to be written down rather than held in someone's head.

## The rule

**Run `pnpm verify` before you claim anything works.** It runs, in the order CI runs it:

```
assets:check → format:check → lint → typecheck → test → build → test:e2e
```

The unit tests take under a second; the end-to-end suite renders in software, so it takes
several minutes locally and 15–20 in CI. Run it anyway. Do not report a change as done,
fixed or passing without reading its output. If you changed one file and want a faster loop, run the individual
scripts — but the gate is what decides.

## Setup

```bash
pnpm install
pnpm exec playwright install chromium    # once; the e2e suite needs a real browser
pnpm dev                                 # http://127.0.0.1:5180
```

Node 22.13 or newer, or 24 (CI's version; Vitest does not support 25). There is no mission music on a fresh clone and that is correct — see
[docs/assets.md](docs/assets.md).

## Scripts

| Command                  | What it does                                             |
| ------------------------ | -------------------------------------------------------- |
| `pnpm verify`            | The full gate. This is the one that matters.             |
| `pnpm dev`               | Dev server with hot reload on 127.0.0.1:5180             |
| `pnpm preview`           | Serve `dist/` on 127.0.0.1:4180                          |
| `pnpm build`             | Production build to `dist/`                              |
| `pnpm build:single`      | Offline single-file build to `dist-single/` (gitignored) |
| `pnpm test`              | Unit tests (Vitest, Node) — fast                         |
| `pnpm test:watch`        | Unit tests in watch mode                                 |
| `pnpm test:coverage`     | Unit tests with coverage — what CI runs                  |
| `pnpm test:e2e`          | Builds, then drives the real game in headless Chromium   |
| `pnpm lint` / `lint:fix` | ESLint                                                   |
| `pnpm format`            | Prettier, writes (`format:check` only checks)            |
| `pnpm typecheck`         | `tsc --noEmit` over JSDoc-typed JavaScript               |
| `pnpm assets:check`      | Manifest vs. disk                                        |
| `pnpm assets:extract`    | Re-extract audio from an original build                  |
| `pnpm baseline`          | **Do not run** — regenerates the parity baseline         |

## Read these before changing code

Two of them, and they will save you a debugging session:

1. **[docs/architecture.md](docs/architecture.md)** — the layer map, and specifically
   the "Shared state" and "The co-op seam" sections.
2. **[docs/adr/](docs/adr/README.md)** — why things are the way they are. If you are
   about to reverse a decision, there is probably a record explaining the cost.

For anything touching the build output or asset URLs, also read
[docs/deployment.md](docs/deployment.md): the site ships to two hosts on different base
paths, so a hard-coded absolute asset path works on one and 404s on the other.

## Things that will bite you

These are not style preferences. Each one has already caused a real failure here.

**Shared state lives on exported objects: `G`, `camera`, `pass`, `pools`,
`structures`.** ES modules forbid assigning to an imported binding, and this state has
writers in several modules. Do not "clean this up" into exported `let`s — it will not
compile. See [ADR 0002](docs/adr/0002-shared-state-as-namespace-objects.md).

**Never introduce a local variable named after one of those objects.** It shadows the
import silently. A namespace object called `view` once captured a local of the same
name and crashed the first rendered frame with a temporal-dead-zone error. If you add a
new namespace object, its name must appear nowhere else in the source.

**Do not call an imported function at module top level in `sim/` or `net/`.** Those
modules import each other cyclically. It is safe as written because only function
declarations cross the cycles and none are invoked during evaluation. Invoking one at
evaluation time will throw. Put startup work in `src/main.js`, which states boot order
explicitly.

**The terrain scatter is seeded, and the order of draws matters.** `src/world/level.js`
places rocks and debris from the generator in `src/core/math.js`, and `populate()` rewinds
it again per mission to fix each enemy's initial AI state. Adding a call that draws from
that generator at startup shifts every later draw. Entity coordinates themselves are
authored literals in `populate()`, so they will not move — but structure coordinates are
derived from `src/world/sites.js` and `terrainY`, and the parity suite compares those
exactly. If it starts failing on structure coordinates, look there.

**Never regenerate `tests/e2e/__baseline__/original.json` to make a test pass.** It is a
recording of the original build's behaviour. Overwriting it with current behaviour
destroys the only evidence that a refactor preserved anything. If parity fails, the
change is wrong until proven otherwise.

**E2E specs import `test` and `expect` from `tests/e2e/fixtures.js`, not
`@playwright/test`.** On Windows it fakes pointer lock, because Chromium's real one clips
the developer's actual cursor to the headless viewport (`ClipCursor`) — never let a local
Windows run engage real pointer lock.

**`src/data/audio-manifest.js` is generated.** Edit `scripts/extract-assets.mjs` and
re-run `pnpm assets:extract`.

**Never commit anything from `assets/audio/music/` or the original `RobotWarrior.html`.**
Both hold third-party copyrighted recordings and both are gitignored. Git history is
permanent once pushed. See [ADR 0003](docs/adr/0003-keep-the-soundtrack-out-of-the-repo.md).

## Style

Match the file you are in. The simulation is a hot loop and uses short names and terse
maths deliberately; that is not something to fix. Prettier settles all formatting, so
do not argue with it — run it.

Comment the **why**, not the what. `// Contact shadows keep the low-polygon machines
grounded.` earns its place. `// loop over entities` does not. If a constant was arrived
at by feel, say so — that is exactly the thing the next reader cannot recover.

Types come from JSDoc on plain JavaScript. There are no `.ts` files and adding one is a
decision, not a convenience.

## Tests

Unit tests (`tests/unit/`) run in Node and cover the layers that are pure: maths,
geometry, cover intersection, terrain, map data, shader source, device detection, touch
maths, settings validation and the co-op protocol's validators. If you are adding logic
that could live in a pure function, put it in one and test it.

The end-to-end suite (`tests/e2e/`) drives the real built game in Chromium through the
`window.RobotWarrior` status API. Everything that owns WebGL, canvas, audio or socket
state is covered there or not at all. It will not reuse a server already on port 4180: if
it fails with "port in use", something is still serving there — stop it rather than work
around it, because a stale server serves a stale build.

For a one-off check the status API cannot reach, run `pnpm dev` and have the page
`import('/src/…')`: under the dev server that returns the very module instances the game
is using, so a probe can set up an exact situation — a mech on a roof, a shell aimed at a
rock — and step the real code. It cannot work against a production build.

When a test encodes behaviour that is imperfect rather than intended, say so in the
test. `tests/unit/math.test.js` has an example — `clamp` with its bounds reversed — and the
comment explains why the behaviour stands.

## Commits and pull requests

Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`,
`build:`, `ci:`. Add `!` for a breaking change.

Write the body for someone who will read it in a year with no context. What changed, why
this approach, what it cost, and what you verified. If you found something surprising,
that belongs in the commit message — it is the cheapest place to leave it.

Never force-push a shared branch. Never commit secrets.

## If you get stuck

Say so, and say precisely where. A clear report of what you tried and what the output
was is worth more than a plausible-looking change that has not been verified. Do not
narrow the task silently — if part of it is blocked, finish the rest and state what is
left.
