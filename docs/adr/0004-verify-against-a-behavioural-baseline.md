# 0004 — Verify refactors against a behavioural baseline

**Status** Accepted · 2026-09-16

## Context

Unpacking a 13 MB single-file game into 41 modules meant rewriting 1,510 identifier
references and changing how audio loads, with no existing tests. "It looks right and it
boots" is not evidence. A silent behavioural regression — an enemy spawned in the wrong
place, an objective that no longer fires — could sit unnoticed indefinitely.

The original had one very useful property: a frozen `window.RobotWarrior` status API
reporting mission state, objectives, pilot telemetry and the full entity roster. A mission
is also largely fixed — entity coordinates are authored in `populate()`, and structure
coordinates are derived from a static site table and the terrain height field — so two
runs should agree closely enough to diff.

## Decision

Capture a baseline from the original **before** changing anything, and compare against it
afterwards.

`scripts/capture-baseline.mjs` drives the original build in headless Chromium and records
two snapshots — menu state, and the world one mission in — to
`tests/e2e/__baseline__/original.json`, which is committed.
`tests/e2e/parity.spec.js` runs the same probes against the built game and diffs.

Both sides call the same probes from `tests/e2e/helpers/probe.js`. If a probe drifts,
both sides drift together and the comparison stays honest. Time-varying fields — fps,
mission clock, audio position — are stripped. The roster is compared exactly: every
machine, its type and its sector. Structure coordinates are compared exactly too, because
those are _derived_ at spawn from the site table and the height field, and so are the part
that can actually drift.

Mech coordinates are bounded, not pinned. Mechs walk, and how far they get inside the probe
window depends on frame rate — pinning it was flaky, and duly failed on a slower CI runner
by one to three units. A 120-unit tolerance still catches the failure that matters: a mech
spawned in the wrong place, or in the wrong sector.

## Consequences

- The refactor is verified rather than asserted. The structure-placement check is the sharp
  instrument: perturbing one site coordinate by five units fails it, which was confirmed
  deliberately rather than assumed.
- **The test states only what it proves.** An earlier version claimed the roster was
  seeded, and therefore that reproducing it demonstrated the math layer intact. It is not:
  `populate()` writes those coordinates out as literals, and the suite passed unchanged
  when the seed was deliberately altered. Overstating what a test covers is worse than
  covering less, because it stops anyone looking further.
- The suite also asserts frames render, mission time advances, the HUD canvas is actually
  drawn to and the WebGL context is live — so "boots without errors but renders nothing"
  fails.
- Regenerating the baseline requires the original file, which is untracked. In practice
  the committed baseline is what is compared against, and it should not be regenerated
  casually: doing so replaces the reference with current behaviour, which hides exactly
  what it exists to catch.
- Keep this suite passing through future refactors. The next obvious change — splitting
  `G` per [0002](0002-shared-state-as-namespace-objects.md) — depends on it.
