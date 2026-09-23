# Architecture

RobotWarrior is a browser game with no engine and no runtime dependencies. It draws
the world with raw WebGL, the HUD with a 2D canvas on top, and runs co-op over WebRTC
data channels. About 13,000 lines across 55 modules under `src/`.

This document describes the shape of the code, and is honest about the parts that are
awkward. If you are here to change something, read [Shared state](#shared-state) and
[The co-op seam](#the-co-op-seam) first — they are where surprises live.

## Layers

Rendering flows downward; nothing in a lower layer reaches up.

```
                    ┌──────────────────────────────────┐
  entry             │  main.js                         │  boot order + status API
                    └──────────────────────────────────┘
                    ┌──────────────────────────────────┐
  frame loop        │  loop.js                         │  rAF, dt, fps
                    └──────────────────────────────────┘
       ┌──────────────────┬──────────────────┬──────────────────┐
  ui   │  ui/             │  hud/            │  render/         │
       │  menu, input     │  cockpit, map    │  world pass      │
       └──────────────────┴──────────────────┴──────────────────┘
       ┌──────────────────┬──────────────────┬──────────────────┐
  game │  sim/            │  entities/       │  net/            │
       │  combat, ai,     │  spawn, models,  │  coop, transport │
       │  movement,       │  pools, draw     │  protocol        │
       │  mission, player │                  │                  │
       └──────────────────┴──────────────────┴──────────────────┘
       ┌──────────────────┬──────────────────┬──────────────────┐
  base │  core/           │  world/          │  data/           │
       │  gl, shaders,    │  terrain, level, │  chassis specs,  │
       │  geometry, mesh, │  sites           │  audio manifest  │
       │  renderer, math  │                  │                  │
       └──────────────────┴──────────────────┴──────────────────┘
                    ┌──────────────────────────────────┐
  audio             │  audio/  soundtrack, sound-system│
                    └──────────────────────────────────┘
```

| Directory       | Files | Lines | What lives there                                             |
| --------------- | ----: | ----: | ------------------------------------------------------------ |
| `src/core/`     |    19 |  2901 | WebGL context, shaders, procedural geometry, draw path, math |
| `src/world/`    |     3 |   464 | Terrain height field, static level geometry, map sites       |
| `src/data/`     |     2 |   357 | Chassis specifications, generated audio manifest             |
| `src/entities/` |     4 |   911 | Object pools, mech models, spawners, per-entity drawing      |
| `src/audio/`    |     2 |   467 | Streaming soundtrack, procedural effects, radio speech       |
| `src/sim/`      |     7 |  1666 | Mutable state, pilot, combat, movement, AI, mission logic    |
| `src/render/`   |     4 |  1092 | Render pipeline, world pass, shadow cascades, debug views    |
| `src/hud/`      |     4 |  1380 | Cockpit frame, instruments, tactical map, mobile sight       |
| `src/ui/`       |     4 |   905 | Menu and settings wiring, keyboard, mouse and touch input    |
| `src/net/`      |     4 |  2692 | Co-op lobby, host-authoritative simulation, WebRTC transport |

## The frame pipeline

The renderer is WebGL 2 and runs five stages per frame:

1. **Shadow cascades.** The view frustum is split by depth; each slice gets an orthographic
   projection from the sun, rendered depth-only into one layer of a texture array. Fitted to
   a bounding _sphere_ per slice and snapped to whole texels — both details exist to stop
   shadow edges crawling during a torso twist, which is most of the time in this game.
2. **Scene.** Sky, then the world, into an HDR target with a depth texture. Lighting is
   Cook-Torrance over a hemisphere ambient term, plus up to eight dynamic point lights for
   weapon fire. Materials are presets chosen per draw — the geometry has no texture
   coordinates, so there is nothing to sample.
3. **Ambient occlusion** from that depth buffer, blurred. Desktop tiers only.
4. **Bloom**: threshold and downsample, then tent-filter back up.
5. **Composite**: occlusion, bloom, ACES tone map, grade, vignette, grain, FXAA — one pass.
   With FXAA on, it samples the scene around each pixel rather than once.

`renderWorld()` supplies two callbacks, `drawOpaqueWorld` and `drawTransparentWorld`,
because the scene is traversed once per cascade as well as once for the camera. The opaque
callback must stay free of anything that is not geometry; the blend helpers it uses are
no-ops during a cascade for exactly that reason.

**Quality is one axis.** Five tiers — potato, low, mobile, high, ultra — change internal
resolution, cascade count and which post passes run, and with them the shadow map size,
distance and filter kernel, the ambient-occlusion sample count, bloom depth and FXAA. One
setting reaches past fidelity: how far away machines are drawn, from 1,200 m on potato to
2,200 m on ultra, so a low-tier pilot can see less of the battlefield. Potato also swaps
shadow maps for blob shadows. `mobile` is tuned against a Galaxy S26 and `ultra` against an
RTX 4070 SUPER; see [ADR 0006](adr/0006-webgl2-render-pipeline.md).

**Debugging.** `?debug=shadow` renders the shadow term alone, `?debug=cascade` colours by
cascade, and there are normal, albedo and roughness views. They exist because a lighting
fault renders as a plausible picture — a shadow lookup returning "lit" everywhere is
indistinguishable from a scene with the sun somewhere else.

`window.RobotWarrior.scanTargets()` reads back every texel of the scene target and each
bloom level and reports non-finite values per stage. It is far too slow for a frame and exists for one reason: **a single bad
pixel in the HDR target is not a single bad pixel on screen.** The bloom prefilter reads a
13-tap neighbourhood and each downsample level widens it again, so fifteen NaN pixels have
been measured becoming three hundred thousand by the first mip and a black rectangle across
the middle of the screen after the composite — roughly twenty thousand to one. Anything
writing into the scene target has to be finite, and when it is not, the picture tells you
nothing about where it came from. The prefilter now rejects non-finite input as a
containment layer, and `tests/e2e/render.spec.js` checks the scene and every bloom level
during combat.

## Input

Keyboard and mouse in `src/ui/input.js`, touch in `src/ui/touch.js`. Both write to the same
state — `G.keys`, `G.mouse`, `G.player.torso` — so the simulation cannot tell which is in
use and a new control is wired once. Touch controls show only on a coarse primary pointer
and only during a mission. Mobile assists run in `updateTouch()` before solo simulation or
co-op sampling, never inside replayed pilot steps. The mobile HUD uses DOM telemetry and a
canvas sight instead of shrinking the desktop instruments. See
[ADR 0008](adr/0008-two-thumb-mobile-cockpit.md) for the controls, assists and verification.

## Nothing is loaded — everything is generated

There are no model files, no textures and no level format. `src/core/geometry.js`
generates boxes, cylinders, spheres, dishes, rings and six rock variants
procedurally; `src/core/mesh.js` uploads them once and hands out shared meshes.
`src/world/level.js` places the entire three-sector map by running placement code at
module evaluation and baking the result into one static buffer. Roads and ground
markings are real geometry, not textures.

Consequences worth knowing:

- Level geometry is **baked once at startup** and never rebuilt. Changing placement
  code requires a reload, not a mission restart.
- The **terrain scatter is seeded**, not random: the 27 placement loops in
  `src/world/level.js` draw from the generator in `src/core/math.js`, which starts from a
  fixed value, so the rocks and debris land in the same places every load. `populate()`
  rewinds the generator again per mission, which fixes each enemy's initial AI phase,
  cooldowns and strafe direction.
- Anything that draws from that generator at startup shifts every later draw.
  `rockGeom` deliberately derives its shape from its variant index instead, and a unit
  test pins that.
- **Entity coordinates are authored, not generated.** `populate()` writes them out as
  literals. Structure coordinates are the exception and are derived at spawn from the
  site table in `src/world/sites.js` and the terrain height field — which is why those are
  the sharp assertion in the parity suite.

## Shared state

The game keeps its mutable state in a small number of exported objects rather than
threading a context through every call. This is the single most important thing to
understand before editing.

| Object       | Module                  | Holds                                            |
| ------------ | ----------------------- | ------------------------------------------------ |
| `G`          | `src/sim/state.js`      | Mission and pilot state — 46 fields              |
| `camera`     | `src/core/viewport.js`  | Viewport size and the camera basis               |
| `pass`       | `src/core/renderer.js`  | Flags for the render pass in flight              |
| `pools`      | `src/entities/pools.js` | Live entity, particle, beam and projectile pools |
| `structures` | `src/entities/pools.js` | Named mission structures, reassigned per reset   |

**Why objects and not exported `let`s.** ES modules forbid assigning to an imported
binding. The simulation, the HUD, the menu, the frame loop and the co-op layer all
write to this state, so a plain `export let` would only work for whichever module
happened to own the declaration. Properties of a shared object preserve the original
single-scope aliasing exactly, which is what let the unpacking be verified rather than
rewritten — see [ADR 0002](adr/0002-shared-state-as-namespace-objects.md).

**When adding state**, put it on the object whose cluster it belongs to if more than
one module writes it, and use a plain module-level `let` if only the declaring module
does. Do not reach for `G` by default; it is already larger than it should be.

**One trap.** These object names become free identifiers in every module that touches
the state. A local variable of the same name shadows them silently. `camera` is
`camera` and not `view` precisely because `view` collided with an existing local and
produced a temporal-dead-zone crash on the first frame.

## The co-op seam

`src/net/coop-bridge.js` is the boundary between solo and co-op play. For each action
that behaves differently in a session — `startMission`, `fireWeapon`, `announce`,
`updateEnemies`, `drawHUD` and a dozen more — it exports one function that dispatches
to the co-op layer when a session is live and to the `solo*` implementation in
`src/sim/` otherwise.

Most of the game calls the bridge instead of checking whether co-op is active, and that
is the point: one place where the two modes diverge. It is not the only place. A handful of
sites still read `G.coop` directly — damage application, mission flags, the audio update,
the result screen — so when solo and co-op disagree, look there as well as in the bridge.

`initCoop()` also wraps the audio system's `tone`, `noise`, `say` and `fxPlay` so a
replayed or remote-owned frame stays silent. Without that, reconciliation would
retrigger every sound it replays.

Co-op is host-authoritative, not lockstep: the host never waits for inputs. It runs the
whole simulation at a fixed 40 Hz, stepping each guest's queued inputs as they arrive, and
sends a snapshot ten times a second. Each guest predicts only its own mech, replays its
unacknowledged inputs on top of every snapshot, and eases everything else toward the
latest one. Peers find each other through a PeerJS signalling server and then talk over
one ordered, reliable WebRTC data channel.

`src/net/coop.js` is the largest module in the codebase (about 1,600 lines) and the least
covered by tests: its protocol validators have unit tests, the rest none. Two browser
contexts are enough to exercise a real session — host and guest need not be four peers.

## Boot order

`src/main.js` states startup explicitly instead of relying on a script's
top-to-bottom execution. It imports the modules whose evaluation has observable
effects — compiling shaders, uploading primitive meshes, reading stored settings,
baking level geometry — in their original order, then runs the sequence:

```
applyChassisWeapons()   apply the selected chassis's weapon loadout
G.player = newPlayer()  build the pilot
populate()              generate the mission roster
initMenu()              wire menu, briefing, manual and settings
initInput()             wire keyboard, mouse, pointer lock, context loss
initCoop()              install the co-op audio guards and create the session object
updateChassisUI()       reflect the stored chassis in the menu
#loading hidden         reveal the menu
requestAnimationFrame   start the frame loop
```

It then freezes a read-only `window.RobotWarrior` status API onto the page. Nothing in
the game reads it; it exists so tests and performance checks can observe real state
without reaching into modules. `tests/e2e/` is built entirely on it.

## The frame

`frame()` in `src/loop.js` runs once per animation frame:

1. Compute `dt` and update the frame-rate average.
2. Advance the simulation — pilot, projectiles, enemies, mission objectives — in equal
   steps of at most 25 ms, so a slow frame is several short steps rather than one long
   one. Particles, beams and the radio advance once per frame.
3. Render the world pass: sky, terrain, baked scenery, structures, entities.
4. Draw the HUD to the 2D canvas over it.

Enhanced Imaging is a mode of the same render pass rather than a second one: shadows and
ambient occlusion are skipped, and each mesh is drawn as a dark fill plus its edges in the
wire tint. The renderer reads that mode from `pass.imagingPass` and `pass.wireTint`,
which is why they are shared rather than local.

## Deployment

Published from `main` to GitHub Pages and to Vercel. The two differ only in base path —
`/robot-warrior/` and `/`. `vite.config.js` takes it from `PUBLIC_BASE`, and every audio
URL is built from `import.meta.env.BASE_URL`, which is why none are written as absolute
paths. See [deployment.md](deployment.md).

## Verification

```bash
pnpm verify
```

Runs, in the order CI runs it: asset check, formatting, lint, typecheck, unit tests,
production build, end-to-end suite.

`tests/e2e/parity.spec.js` compares the built game against
`tests/e2e/__baseline__/original.json`, a snapshot captured from the original single-file
build. Specifically it asserts:

- the menu-time status block matches exactly — every field the original reported, less
  five that vary with wall-clock time (30 compared);
- the mission roster matches — every machine, its type and its sector;
- every **structure** sits at exactly the coordinates the original put it at, which is
  the part that catches drift in `sites.js`, `terrainY` or the spawners;
- every **mech** is within 120 units of where the original had it. Mechs walk, and how
  far they get in the probe window depends on frame rate, so pinning that exactly is
  flaky by construction — it was, on a slower CI runner;
- frames render, the HUD canvas is drawn to, mission time advances, the WebGL context is
  live.

Regenerating the baseline needs the original file, which is untracked and no longer
exists on the maintainer's machine — see [docs/assets.md](assets.md). The committed
baseline is now the only record of how the original behaved, which is one more reason
never to regenerate it to make a test pass.

Types are checked with `tsc` in `checkJS` mode. There are no `.ts` files; types come
from JSDoc, with ambient declarations in `src/types/globals.d.ts`.

## Known rough edges

Recorded rather than hidden:

- `src/net/coop.js` is too large, and only its protocol validators have tests.
- `G` holds 47 fields and mixes mission progress, pilot state, input and UI flags.
- A lost WebGL context is not recovered. Every program, mesh and baked buffer is created
  once at startup, so the game pauses and asks for a reload.
- Co-op snapshots have no size budget, and a frame over 64 KB drops the link rather than
  being skipped. A four-pilot missile fight has not been measured against that limit.
- Several modules import each other cyclically. This is safe as written — only
  function declarations cross the cycles, and none are called during module
  evaluation — but it is fragile. Calling an imported function at module top level in
  `sim/` or `net/` can produce a temporal-dead-zone error.
- The HUD is drawn with immediate-mode canvas calls each frame with no layout pass, so
  positions are hand-tuned constants.
