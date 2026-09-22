# 0008 — A mobile cockpit for two thumbs

**Status** Accepted · 2026-09-21 · Supersedes the layout and throttle decisions in [0007](0007-touch-controls.md).

## Context

The original touch layer exposed sixteen buttons around a desktop canvas cockpit. At
360 × 640 and 640 × 360, controls consumed the aiming area and cockpit text became too
small to read. Moving, dragging the view and pressing fire needed three simultaneous
contacts. Releasing the stick kept the throttle open. The tests mostly dispatched events
directly onto elements, bypassing the browser's hit testing and multi-touch capture.

## Decision

Keep the shared input seam. A spring-return left stick sets throttle and leg turn. The
right thumb holds FIRE and can drag that same contact to aim, including outside the
button. Dragging the view alone looks without firing. Jump jets remain a held action.
Each held control belongs to one pointer; releasing another finger cannot cancel it.
Cancellation, capture loss, pause, hidden tabs, focus loss, map/systems panels and viewport
resizing clear held inputs and throttle.

On a coarse primary pointer, select a visible target near the sight automatically, retain
it through small aim movements, and align legs gradually while moving straight. Sustained
fire pauses before the next shot would overheat the reactor and resumes after cooling.
Coolant remains a deliberate, finite-resource action. In co-op, a stopped, grounded pilot
automatically requests teammate restoration; the host still enforces proximity and timing.
All assists run before the existing solo simulation or co-op input sampler. They never
run inside remote pilot steps or prediction replays. Desktop controls are unchanged.

Replace the desktop instruments on phones with readable DOM telemetry, objective and
waypoint guidance, weapon names/ammunition, and a clear canvas sight. Map and systems
panels hold secondary actions. Both orientations reserve the bottom for thumbs and use
safe-area insets. Touch controls have at least 44 CSS pixels in each dimension. Mobile
mission start/resume never requests mouse pointer lock.

## Verification and cost

`tests/e2e/touch.spec.js` drives Chromium's native touch dispatch at exact 9:16 and 16:9
viewports, including simultaneous movement, aiming and firing, independent release,
reverse/turning, jets, cancellations, rotation, pause/resume, map and systems, target lock,
missiles and sustained-fire cooling. It checks bounds, overlap and hit testing and attaches
menu, cockpit, systems, map, pause and gesture screenshots to each run. A desktop regression
preserves keyboard throttle behavior. Pure stick, target, restoration and heat rules have
unit tests. The read-only `getControlStatus()` probe observes inputs without exposing setters.

The mobile HUD is intentionally simpler than the full cockpit. It shares objective data
and the tactical map with desktop, while maintaining its own layout. Automated Chromium
touch emulation verifies layout and input routing, not physical device ergonomics or
Safari-specific browser behavior; those still benefit from testing on real phones.
