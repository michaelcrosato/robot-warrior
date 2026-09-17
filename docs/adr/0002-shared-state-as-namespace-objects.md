# 0002 — Hold cross-module mutable state in namespace objects

**Status** Accepted · 2026-09-16

## Context

The original was one script, so all state was in one scope. 75 of its 76 top-level `let`
bindings were assigned from more than one place: score from combat, mission and co-op;
game state from the menu, the frame loop and co-op; the entity pools from `populate()`
and from co-op reconciliation.

ES modules forbid assigning to an imported binding. `export let score` only works if
every writer lives in the module that declares it, which was true for almost nothing.

Three options were considered:

1. **Thread a context object through every call.** Cleanest target design, but it changes
   hundreds of signatures — a rewrite, not a refactor, with no way to verify it against
   the original.
2. **Keep every writer of a cluster in one module.** Would have left ~800 of 1,372 lines
   in a single file, defeating the point.
3. **Hold the state as properties of exported objects.**

## Decision

Option 3. Mutable state written by more than one module lives as properties of one
exported object per cluster:

| Object       | Module                  | Cluster                                  |
| ------------ | ----------------------- | ---------------------------------------- |
| `G`          | `src/sim/state.js`      | Mission and pilot state (46 fields)      |
| `camera`     | `src/core/viewport.js`  | Viewport size and camera basis           |
| `pass`       | `src/core/renderer.js`  | Render-pass flags                        |
| `pools`      | `src/entities/pools.js` | Entity, particle, beam, projectile pools |
| `structures` | `src/entities/pools.js` | Named mission structures                 |

State written only by its declaring module stayed a plain module-level `let`.

The decisive property: a module-level `let` and a property of a module-level object have
**identical aliasing semantics**. Every read sees every write, in the same order, with
the same timing. That made the transform mechanical and behaviour-preserving, which is
what allowed it to be verified against a baseline rather than argued about — see
[0004](0004-verify-against-a-behavioural-baseline.md).

`seed` was the one exception: it became module-private behind `resetRandom()`, because
the only external use was a reset.

## Consequences

- `G.` and `pools.` prefixes appear throughout the simulation. Noisier than bare names,
  but they mark shared mutable state at every point of use, which is arguably an
  improvement over a bare `score`.
- **A namespace object name becomes a free identifier in every module that touches its
  cluster, so a local of the same name shadows it silently.** This is not theoretical:
  `view` was the original name for `camera`, it collided with a local inside
  `renderWorld`, and the result was a temporal-dead-zone crash on the first rendered
  frame. Any future namespace object must use a name bound nowhere in the source.
- `G` is too big. It mixes mission progress, pilot state, input and UI flags, and should
  be split. That is deliberate debt: splitting it during the unpacking would have made
  the parity comparison meaningless. Do it as its own change, with the parity suite as
  the guard.
