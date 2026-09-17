# Architecture

RobotWarrior is a browser game with no engine and no runtime dependencies. It draws
the world with raw WebGL, the HUD with a 2D canvas on top, and runs co-op over WebRTC
data channels. Roughly 9,400 lines across 41 modules under `src/`.

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
| `src/core/`     |    11 |   747 | WebGL context, shaders, procedural geometry, draw path, math |
| `src/world/`    |     3 |   451 | Terrain height field, static level geometry, map sites       |
| `src/data/`     |     2 |   357 | Chassis specifications, generated audio manifest             |
| `src/entities/` |     4 |   911 | Object pools, mech models, spawners, per-entity drawing      |
| `src/audio/`    |     2 |   457 | Streaming soundtrack, procedural effects, radio speech       |
| `src/sim/`      |     7 |  1629 | Mutable state, pilot, combat, movement, AI, mission logic    |
| `src/render/`   |     1 |   383 | The world render pass                                        |
| `src/hud/`      |     3 |  1357 | Cockpit frame, instruments, tactical map                     |
| `src/ui/`       |     2 |   360 | Menu and settings wiring, input handling                     |
| `src/net/`      |     4 |  2591 | Co-op lobby, lockstep simulation, WebRTC transports          |

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
5. **Composite**: occlusion, bloom, ACES tone map, grade, vignette, grain, FXAA — one pass,
   one full-resolution read of the scene target.

`renderWorld()` supplies two callbacks, `drawOpaqueWorld` and `drawTransparentWorld`,
because the scene is traversed once per cascade as well as once for the camera. The opaque
callback must stay free of anything that is not geometry; the blend helpers it uses are
no-ops during a cascade for exactly that reason.

**Quality is one axis.** Five tiers — potato, low, mobile, high, ultra — change internal
resolution, cascade count and which post passes run. Nothing else varies, so tiers differ in
fidelity rather than content. `mobile` is tuned against a Galaxy S26 and `ultra` against an
RTX 4070 SUPER; see [ADR 0006](adr/0006-webgl2-render-pipeline.md).

**Debugging.** `?debug=shadow` renders the shadow term alone, `?debug=cascade` colours by
cascade, and there are normal, albedo and roughness views. They exist because a lighting
fault renders as a plausible picture — a shadow lookup returning "lit" everywhere is
indistinguishable from a scene with the sun somewhere else.

## Input

Keyboard and mouse in `src/ui/input.js`, touch in `src/ui/touch.js`. Both write to the same
state — `G.keys`, `G.mouse`, `G.player.torso` — so the simulation cannot tell which is in
use and a new control is wired once. Touch controls show only on a coarse primary pointer
and only during a mission; see [ADR 0007](adr/0007-touch-controls.md).

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

The rest of the game calls the bridge and never checks whether co-op is active. That
is the point: there is one place where the two modes diverge.

`initCoop()` also wraps the audio system's `tone`, `noise`, `say` and `fxPlay` so a
replayed or remote-owned frame stays silent. Without that, reconciliation would
retrigger every sound it replays.

Co-op runs a lockstep simulation: the host advances authoritative frames, clients
predict locally and reconcile against host snapshots. `src/net/coop.js` is the largest
module in the codebase (~2,000 lines) and is the least covered by tests — it needs
four live peers to exercise properly.

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
2. Advance the simulation — pilot, projectiles, effects, enemies, mission objectives.
3. Render the world pass: sky, terrain, baked scenery, structures, entities.
4. Draw the HUD to the 2D canvas over it.

Enhanced Imaging is a second render pass with a wireframe tint, which is why
`pass.imagingPass` and `pass.wireTint` are shared rather than local.

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

- the full menu-time status block matches exactly (41 fields);
- the mission roster matches — every machine, its type and its sector;
- every **structure** sits at exactly the coordinates the original put it at, which is
  the part that catches drift in `sites.js`, `terrainY` or the spawners;
- every **mech** is within 120 units of where the original had it. Mechs walk, and how
  far they get in the probe window depends on frame rate, so pinning that exactly is
  flaky by construction — it was, on a slower CI runner;
- frames render, the HUD canvas is drawn to, mission time advances, the WebGL context is
  live.

Regenerating the baseline needs the original file, which is untracked — see
[docs/assets.md](assets.md).

Types are checked with `tsc` in `checkJS` mode. There are no `.ts` files; types come
from JSDoc, with ambient declarations in `src/types/globals.d.ts`.

## Known rough edges

Recorded rather than hidden:

- `src/net/coop.js` is too large and has no automated coverage.
- `G` holds 46 fields and mixes mission progress, pilot state, input and UI flags.
- `sphereGeom`'s top pole band renders unlit; see the test in
  `tests/unit/geometry.test.js` for why it has not been worth fixing.
- Several modules import each other cyclically. This is safe as written — only
  function declarations cross the cycles, and none are called during module
  evaluation — but it is fragile. Calling an imported function at module top level in
  `sim/` or `net/` can produce a temporal-dead-zone error.
- The HUD is drawn with immediate-mode canvas calls each frame with no layout pass, so
  positions are hand-tuned constants.
