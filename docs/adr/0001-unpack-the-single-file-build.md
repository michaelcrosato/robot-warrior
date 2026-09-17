# 0001 — Unpack the single-file build into ES modules

**Status** Accepted · 2026-09-16

## Context

The game arrived as one 13 MB `RobotWarrior.html`: 1,372 lines of dense JavaScript plus
two ~12 MB base64 string literals holding every audio clip. It worked, and the
single-file form was a genuine feature — it ran from a USB stick with no server.

It was also close to unmaintainable. Individual lines ran past 1,700 characters. The
file was too large for most editors to handle comfortably, and far too large to put in
front of a language model with room left to think. There was no way to test any part of
it in isolation, and no way to review a change to one subsystem without reading all of
it.

## Decision

Split the source into 41 ES modules under `src/`, extract the audio to real files, and
keep the single-file build as an output rather than the source of truth
(`pnpm run build:single`).

The split was done with a one-shot tool, not by hand. It parsed the original with
`acorn` and resolved every identifier with `eslint-scope`, so the transform was
scope-correct rather than textual: a local named `target` or `state` was left alone, and
only references that genuinely bound to a top-level declaration were rewritten. Module
bodies were copied byte for byte.

## Consequences

Good:

- The largest module is now ~2,000 lines and most are under 400.
- The pure layers — math, geometry, terrain, map data — are unit tested, which was
  impossible before.
- Formatting the source expanded it from 2,400 to 9,400 lines. It is far more readable,
  and line-based edits are now safe.
- The offline single-file property is preserved as a build target, and verified to work
  from `file://`.

Costs and risks:

- The module graph contains cycles. They are safe as written — only function
  declarations cross them — but calling an imported function during module evaluation
  in `sim/` or `net/` will produce a temporal-dead-zone error.
- `src/main.js` now has to state boot order explicitly, because import evaluation order
  is not the same thing as a script's top-to-bottom execution.
- The migration tool is not in the repository. It was a one-shot, `src/` is the source
  of truth from here, and keeping a tool that regenerates the whole tree would invite
  someone to run it and discard real work. Its behaviour is described in this record and
  in [0002](0002-shared-state-as-namespace-objects.md).

## Notes

The split surfaced one real bug that would otherwise have shipped: a namespace object
named `view` silently captured an existing local of that name, producing a crash on the
first rendered frame. The tool was changed to refuse any namespace name bound anywhere
in the program, and `view` became `camera`. See
[0002](0002-shared-state-as-namespace-objects.md).
