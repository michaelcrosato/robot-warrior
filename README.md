<div align="center">

# RobotWarrior

**A heavy-mech combat sim that runs in a browser tab.**
WebGL renderer, canvas cockpit, offline solo campaign, four-pilot online co-op.
No engine. No framework. No runtime dependencies.

[**▶ Play it**](https://michaelcrosato.github.io/robot-warrior/) · [mirror](https://robot-warrior.vercel.app) · [Architecture](docs/architecture.md) · [Decisions](docs/adr/README.md) · [For agents](AGENTS.md)

[![CI](https://github.com/michaelcrosato/robot-warrior/actions/workflows/ci.yml/badge.svg)](https://github.com/michaelcrosato/robot-warrior/actions/workflows/ci.yml)
[![Pages](https://github.com/michaelcrosato/robot-warrior/actions/workflows/pages.yml/badge.svg)](https://github.com/michaelcrosato/robot-warrior/actions/workflows/pages.yml)
[![MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

</div>

---

## Operation Iron Echo

You pilot one of three machines across three linked sectors — **Kestrel Basin**,
**Ashfall Works**, **Blackglass Ridge** — cutting a relay and an uplink, clearing the
basin, forcing Needle Pass, destroying a reactor its power feeds shield, downing Skyguard,
holding a flight-link ring through two assault waves, then holding an extraction point
until the transport lands.

|            | **KESTREL** KST—40     | **WARDEN** WRD—70    | **BASTION** BST—95       |
| ---------- | ---------------------- | -------------------- | ------------------------ |
| Role       | Scout                  | Heavy                | Assault                  |
| Tonnage    | 40                     | 70                   | 95                       |
| Armour     | Light                  | Balanced             | Heavy, plus siege cannon |
| Missiles   | Two-missile volleys    | Four-missile volleys | Six-missile volleys      |
| Movement   | Fast turns, long jumps | Standard jump jets   | Slow turns, short jumps  |
| Plays like | Speed and cover        | Anything             | Standing your ground     |

Damage is tracked per component across eight locations — head, core, both torsos, both
arms, both legs. Lose an arm and you lose what was mounted on it. Heat is a real
constraint: fire too long and the reactor shuts down, leaving you standing still in the
open. You carry one to three coolant charges depending on loadout — Heavy Gun trades
cooling for damage, Cool Runner does the reverse.

**Enhanced Imaging** renders the world as wireframe, showing machines through terrain at
the cost of seeing nothing else clearly.

### Controls

This is a walking tank, not a foot soldier. Set the throttle, turn the legs, then aim the
torso independently. Your speed stays where you set it.

|                  |                                   |
| ---------------- | --------------------------------- |
| `W` `S`          | Increase / decrease throttle      |
| `B` `X`          | Full throttle / stop              |
| `A` `D`          | Turn legs                         |
| Mouse or arrows  | Aim torso                         |
| `Q` `E` / `Home` | Twist torso / centre it           |
| `C`              | Align legs with torso             |
| Click or `Space` | Fire selected weapon              |
| `F`              | Fire everything that is ready     |
| `1` `2` `3`      | Select weapon                     |
| `R` / `Tab`      | Nearest target / next target      |
| `Shift` (hold)   | Jump jets                         |
| `G`              | Coolant flush                     |
| `I`              | Enhanced Imaging                  |
| `Z` / `V`        | Zoom / night vision               |
| `M` / `N`        | Tactical map / next waypoint      |
| `J` (hold)       | Restore a downed teammate (co-op) |
| `Esc` / `H`      | Pause / field manual              |
| `Enter`          | Deploy, from the main menu        |
| Mouse wheel      | Next / previous weapon            |
| `P`              | Sound on / off                    |
| `Alt` + `Enter`  | Full screen                       |

If the browser does not grant mouse capture, drag with either button held to aim instead
(the left button also fires).

Hold the aim steady on a target to get missile lock. At 100% heat the reactor shuts down —
press `G` before that happens. Stop inside a blue repair bay for six seconds to restore
part of your armour and rearm — once per bay, and each bay opens as the mission reaches it.

### On a phone

Touch controls appear automatically on a device with a coarse pointer, once a mission
starts, in portrait or landscape. Use the left stick to move and turn; release it to stop.
Hold FIRE and drag with your right thumb to aim and shoot together. Drag the view to look
without firing. Hold JETS to jump and tap a named weapon to select it.

Targets near the sight select automatically, moving straight aligns the legs to your aim,
and sustained fire pauses to cool before overheating. MAP shows the mission route. SYS
contains zoom, imaging, night vision, coolant, waypoints and help. Coolant remains manual.
In co-op, stop near a downed teammate to restore them automatically.

`pnpm verify` includes native multi-touch tests at 360 × 640 (9:16) and 640 × 360 (16:9).
The mobile tests save screenshots of the menu, cockpit, systems, map, pause and gestures
under `test-results/`, alongside assertions for touch target size, overlap and hit testing.

Render quality is picked for your device and can be overridden from the pause menu.

### Four-pilot co-op

Up to four pilots over WebRTC data channels. The host runs the authoritative simulation;
clients predict locally and reconcile. Solo play never touches the network.

---

## Running it locally

```bash
pnpm install
pnpm dev          # http://127.0.0.1:5180
```

Node 22.13 or newer, or 24 — CI uses 24; Vitest does not support 25. For a self-contained file that opens straight from `file://` with no
server at all:

```bash
pnpm build:single    # dist-single/RobotWarrior.html
```

> **There will be no mission music.** The three soundtrack tracks are copyrighted
> commercial recordings and are deliberately not distributed with this source. Everything
> else works normally. [docs/assets.md](docs/assets.md) explains how to add your own.

---

## How it is built

Everything is generated. There are no model files, no textures and no level format —
`src/core/geometry.js` produces boxes, cylinders, spheres, dishes, rings and six rock
variants procedurally, and `src/world/level.js` places the whole three-sector map by
running code at startup and baking the result into one static buffer. Roads and ground
markings are geometry, not texture.

The terrain scatter is **seeded rather than random**: the placement loops draw from a
generator that starts from a fixed value, so the rocks and debris land in the same places
every load, and each enemy's opening AI phase is fixed per mission too. Entity coordinates
are authored; structure coordinates are derived from a site table and the height field.

```
src/
├── core/        WebGL context, shaders, procedural geometry, draw path, maths
├── world/       Terrain height field, static level geometry, map sites
├── data/        Chassis specifications, generated audio manifest
├── entities/    Object pools, mech models, spawners, per-entity drawing
├── audio/       Streaming soundtrack, procedural effects, radio speech
├── sim/         Mutable state, pilot, combat, movement, AI, mission logic
├── render/      Render pipeline: shadows, scene, post, debug views
├── hud/         Cockpit frame, instruments, tactical map
├── ui/          Menu and settings wiring, input
├── net/         Co-op lobby, host-authoritative simulation, WebRTC transports
└── main.js      Boot order, and the read-only status API
```

55 modules, about 13,000 lines, zero runtime dependencies. The shipped bundle is 216 kB
(77 kB gzipped).

[**docs/architecture.md**](docs/architecture.md) goes deeper — including a frank list of
the parts that are still awkward.

---

## This repository was assembled from a single 13 MB HTML file

RobotWarrior arrived as one `RobotWarrior.html`: 1,372 lines of dense JavaScript, some
lines over 1,700 characters, plus two ~12 MB base64 string literals holding every audio
clip. It worked, and running from one file with no server was a genuine feature. It was
also effectively unmaintainable and far too large to reason about in one piece.

Unpacking it was done with a tool rather than by hand. The original was parsed with
`acorn` and every identifier resolved with `eslint-scope`, so the transform was
scope-correct rather than textual — a local named `target` or `state` was left alone, and
only references that genuinely bound to a top-level declaration were rewritten. Module
bodies were copied byte for byte, so this repository holds the original code rather than a
paraphrase of it.

The interesting problem was state. ES modules forbid assigning to an imported binding, and
**75 of the original's 76 top-level bindings were written from more than one place**. The
resolution was to hold each cluster of shared mutable state as properties of one exported
object — `G`, `camera`, `pass`, `pools`, `structures` — because a module-level `let` and a
property of a module-level object have identical aliasing semantics. That made the change
mechanical, and therefore verifiable.

**Verifiable mattered more than elegant.** Before anything was touched, a baseline was
captured from the original build: its full status output at the menu, and the complete
19-machine roster of a mission. The suite in `tests/e2e/parity.spec.js` replays the same
probes against the unpacked build and diffs them — the roster exactly, and every structure's
coordinates exactly, because those are derived at spawn from the site table and the terrain
height field rather than written out. Moving one site by five units fails it, which was
checked on purpose rather than assumed.

It also caught a real bug that would otherwise have shipped: the object now called
`camera` was first called `view`, which silently captured an existing local of that name
and crashed the first rendered frame. The unpacking tool was changed to refuse any
namespace name bound anywhere in the source, and AGENTS.md carries the same rule for edits
made by hand.

The full reasoning, including what it cost, is in [docs/adr/](docs/adr/README.md).

---

## Development

```bash
pnpm verify
```

One gate, the same order CI runs: assets → formatting → lint → typecheck → unit tests →
build → end-to-end. The unit tests take under a second. The end-to-end suite renders in
software, so it takes several minutes locally and 15–20 in CI.

|                     |                                           |
| ------------------- | ----------------------------------------- |
| `pnpm dev`          | Dev server, hot reload                    |
| `pnpm build`        | Production build to `dist/`               |
| `pnpm build:single` | Offline single-file build                 |
| `pnpm test`         | Unit tests over the pure layers (Node)    |
| `pnpm test:e2e`     | Drives the real game in headless Chromium |
| `pnpm assets:check` | Audio manifest against disk               |

Published from `main` to both [GitHub Pages](https://michaelcrosato.github.io/robot-warrior/)
and [Vercel](https://robot-warrior.vercel.app). They differ only in base path, which the
build takes from `PUBLIC_BASE` — see [docs/deployment.md](docs/deployment.md).

Types come from JSDoc on plain JavaScript, checked with `tsc --noEmit`. There are no
`.ts` files.

The game exposes a frozen status API for tests and performance work:

```js
window.RobotWarrior.getStatus();
// { state, sector, objectives, position, heat, armor, ammo, fps, entities: [...], ... }
```

Nothing in the game reads it. The entire end-to-end suite is built on it.

---

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) for people, [AGENTS.md](AGENTS.md) for coding agents.

This project is developed almost entirely by agents, which mostly means two things: the
verification gate is expected to do the work a reviewer would otherwise do, and the
reasoning behind non-obvious decisions is written down instead of remembered.

---

## Licence

Code: [MIT](LICENSE).

The 40 voice clips in `assets/audio/voice/` were generated for this game and are covered
by the same licence. The mission soundtrack is not included and is not ours to license —
see [docs/assets.md](docs/assets.md).
