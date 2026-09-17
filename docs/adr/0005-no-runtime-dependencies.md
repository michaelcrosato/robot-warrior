# 0005 — Ship no runtime dependencies

**Status** Accepted · 2026-09-16

## Context

The game renders with raw WebGL and a 2D canvas, generates all its geometry
procedurally, and speaks WebRTC directly. It uses no framework, no scene graph, no
matrix library and no physics engine. `package.json` has zero entries under
`dependencies`; everything is a dev dependency.

There was a reasonable case for bringing in `gl-matrix` for the maths and a WebRTC
wrapper for the networking.

## Decision

Keep `dependencies` empty.

## Rationale

- The matrix code is ~40 lines in `src/core/math.js` and covered by unit tests.
  `gl-matrix` would add a dependency to replace tested code that already works.
- The WebRTC layer is not a thin wrapper — it is lockstep simulation with reconciliation
  and a relay fallback. No library provides that; a signalling wrapper would replace the
  easy part and leave the hard part.
- Zero runtime dependencies means the shipped bundle is 160 kB, the offline single-file
  build is genuinely self-contained, and there is no supply-chain surface in what
  reaches a player's browser.
- Dependabot only has to watch tooling, where an update cannot break a player.

## Consequences

- Some wheels are ours to maintain, including the known-imperfect `sphereGeom` pole case
  (see `tests/unit/geometry.test.js`).
- Adding a runtime dependency is a decision that supersedes this record, not a routine
  change. Write the new ADR.
- Dev dependencies are unconstrained by this: Vite, ESLint, Prettier, TypeScript, Vitest
  and Playwright all earn their place, and none of them ship.
