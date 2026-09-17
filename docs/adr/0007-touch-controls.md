# 0007 — Touch controls that feed the existing input state

**Status** Accepted · 2026-09-16

## Context

The game shipped with a line in the menu reading "This game needs a keyboard and mouse."
It was accurate: every control was a key or a mouse movement, and a phone could load the
page, watch the menu render, and do nothing else.

A walking tank is awkward on a touchscreen for a real reason. It is not a twin-stick
shooter — the legs and the torso point in different directions, throttle is a setting
rather than a button, and there are a dozen secondary systems. A naive port of "left stick
moves, right stick looks" would lose the part that makes it this game.

## Decision

Add a touch layer that writes to the **same state the keyboard and mouse already write
to** — `G.keys`, `G.mouse`, `G.player.torso` — rather than introducing a parallel input
path. The simulation cannot tell which is in use, and there is no second code path to keep
in step when a control changes.

The layout mirrors how the machine actually works. Left thumb: a stick whose vertical axis
is throttle and whose horizontal axis turns the legs. Right thumb: drag anywhere to swing
the torso, with fire, jets, target and coolant under where it already rests, the weapon
groups above, and stop, align and centre on the left.

One deliberate departure: **throttle is set directly from the stick** rather than by
emulating held W and S keys. The underlying value is already analogue (−0.45 reverse to 1
full), so a stick that drives it is both simpler and better than one pretending to hold a
key. Releasing the stick holds the setting, because it is a throttle lever, not a pedal —
which is also how the keyboard behaves.

Controls appear only on a **coarse primary pointer**, and only while a mission is running.
A laptop with a touchscreen reports touch points but has a fine pointer too, and covering a
quarter of its screen would be wrong.

## Consequences

- The menu no longer turns phones away.
- Control changes are made once. A new key binding gets a button by writing one `case`.
- The cockpit's instrument row is drawn between 78% and 96.4% of canvas height, so every
  control is anchored above it in percentage terms. A thumb never covers the armour
  diagram, the radar or the weapon bay, and it holds at any aspect ratio. An end-to-end
  test asserts no control's bounding box crosses that line.
- Portrait works but is cramped; the menu asks for landscape, which is what the cockpit was
  designed for.

## The bug this found

`setPointerCapture` throws `NotFoundError` for a pointer that is no longer active, and a
quick tap produces exactly that — the browser can deliver pointerdown and pointerup close
enough together that the pointer is gone before the handler runs. Called at the _top_ of
the handler, the throw aborted everything after it, so a fast tap silently did nothing
while a slow press worked perfectly.

It was found by a raw `touchscreen.tap` at real coordinates, after a synthetic
`PointerEvent` dispatched straight at the element had passed — the synthetic path skips
the hit test and the capture is harmless there. The fix is to act first and capture
afterwards, inside a try/catch: capture is an enhancement, losing it is fine, losing the
press is not. There is a regression test.
