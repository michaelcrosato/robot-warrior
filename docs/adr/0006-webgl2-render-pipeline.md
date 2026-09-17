# 0006 — Rebuild the renderer on WebGL 2

**Status** Accepted · 2026-09-16

## Context

The original renderer was one forward pass on WebGL 1: two hard-coded directional terms,
flat Lambert shading, exponential fog, and translucent discs under each machine standing in
for shadows. It suited the low-polygon art, but it had no way to express depth — every
surface facing the same direction was the same colour regardless of what was in front of
it, and the machines floated.

The brief was to bring the renderer up to current practice for two named devices: a Galaxy
S26 and a GeForce RTX 4070 SUPER.

## Decision

Require WebGL 2 and rebuild the pipeline around it.

Per frame: fit and fill cascaded shadow maps, render sky and world into an HDR target with
a depth texture, compute ambient occlusion from that depth, build a bloom mip chain, then
one composite pass that applies occlusion and bloom, tone maps with ACES, grades,
vignettes, grains and runs FXAA.

Lighting is Cook-Torrance — GGX distribution, height-correlated Smith visibility, Schlick
Fresnel — over a hemisphere ambient term, with a sky-coloured ambient specular standing in
for a reflection probe and up to eight dynamic point lights for weapon fire. Materials come
from a short preset list chosen per draw, because the geometry carries no texture
coordinates and there is nothing to sample.

**No WebGL 1 fallback.** A second pipeline would have to be kept in step with this one
forever, and the devices that would need it cannot run the lighting regardless. WebGL 2 is
effectively universal; the unsupported path is an explicit message.

## Consequences

Good:

- Shadows, real specular response, and a filmic curve instead of a clamp.
- Quality is one axis. Five tiers change resolution, cascade count, and which post passes
  run — nothing else — so the lowest and the highest differ in fidelity, not in content.
- The draw call interface did not change. `draw()` has the same signature, so the several
  hundred call sites across the simulation and HUD were untouched; the renderer replays
  the world per cascade behind them.

Costs:

- Roughly 40 kB more JavaScript and considerably more GPU work. The cheapest tier exists
  for devices where that matters.
- The scene is traversed once per cascade plus once for the camera, up to five times a
  frame. Acceptable at this geometry count; it would not be at ten times it.
- Tuning is now coupled. Sun intensity, ambient level, fog and the bloom threshold are one
  system — changing any of them in isolation will look wrong.

## Three faults this surfaced

Recorded because each was invisible before and each cost real time:

1. **The sky and the shading disagreed about where the sun was.** The sky painted it at
   `(-0.55, 0.24, -0.85)`; the scene shaded against `(-0.55, 0.8, 0.3)`. Nothing cast a
   shadow, so nothing revealed it. There is now one direction and everything reads it.

2. **Normals were transformed by `mat3(uModel)`.** Parts in this model set are scaled
   non-uniformly throughout, which skews a normal — visible as light sliding across a leg
   as it stretches. Now a proper inverse-transpose, per draw.

3. **The first working build appeared to have no shadows.** It had them. Ambient was
   stronger than direct sun, because the sun sits 18 degrees up and delivers only about a
   third of its output to flat ground. Two guesses failed before a `?debug=shadow` view
   settled it in one screenshot — and that view is kept, because a lighting fault almost
   always renders as a plausible picture rather than an obvious one.
