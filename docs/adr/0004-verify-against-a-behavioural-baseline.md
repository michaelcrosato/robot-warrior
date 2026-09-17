# 0004 — Verify refactors against a behavioural baseline

**Status** Accepted · 2026-09-16

## Context

Unpacking a 13 MB single-file game into 41 modules meant rewriting 1,510 identifier
references and changing how audio loads, with no existing tests. "It looks right and it
boots" is not evidence. A silent behavioural regression — an enemy spawned in the wrong
place, an objective that no longer fires — could sit unnoticed indefinitely.

The original had one very useful property: a frozen `window.RobotWarrior` status API
reporting mission state, objectives, pilot telemetry and the full entity roster. And
world layout is drawn from a seeded generator that `populate()` rewinds, so a generated
mission is deterministic.

## Decision

Capture a baseline from the original **before** changing anything, and compare against it
afterwards.

`scripts/capture-baseline.mjs` drives the original build in headless Chromium and records
two snapshots — menu state, and the world one mission in — to
`tests/e2e/__baseline__/original.json`, which is committed.
`tests/e2e/parity.spec.js` runs the same probes against the built game and diffs.

Both sides call the same probes from `tests/e2e/helpers/probe.js`. If a probe drifts,
both sides drift together and the comparison stays honest. Time-varying fields — fps,
mission clock, audio position — are stripped; the 19-entity roster is compared exactly,
including names, types, zones and spawn coordinates.

## Consequences

- The refactor is verified rather than asserted. The roster check is a sharp instrument:
  any drift in the math, level or spawn layers changes it.
- The suite also asserts frames render, mission time advances, the HUD canvas is actually
  drawn to and the WebGL context is live — so "boots without errors but renders nothing"
  fails.
- Regenerating the baseline requires the original file, which is untracked. In practice
  the committed baseline is what is compared against, and it should not be regenerated
  casually: doing so replaces the reference with current behaviour, which hides exactly
  what it exists to catch.
- Keep this suite passing through future refactors. The next obvious change — splitting
  `G` per [0002](0002-shared-state-as-namespace-objects.md) — depends on it.
