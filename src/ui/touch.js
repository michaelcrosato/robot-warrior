/**
 * Touch controls.
 *
 * A walking tank is a two-handed machine — throttle and legs in one hand, torso and
 * weapons in the other — and that maps onto a phone held sideways better than it has any
 * right to. Left thumb: a stick driving throttle on its vertical axis and leg turn on its
 * horizontal. Right thumb: drag anywhere to swing the torso, with the action cluster under
 * where the thumb already rests.
 *
 * Everything here feeds the same state the keyboard and mouse write to — `G.keys`,
 * `G.mouse`, `G.player.torso` — so the simulation has no idea which is in use and there is
 * no second input path to keep in step.
 *
 * One deliberate difference: throttle is set directly from the stick rather than by
 * emulating taps on W and S. The underlying value is analogue (-0.45 reverse to 1 full),
 * and a stick that drives it directly is both simpler and better to use than one
 * pretending to hold a key down.
 */
import { $, $$ } from '../core/dom.js';
import { G } from '../sim/state.js';
import { caps } from '../core/gl.js';
import { chooseTarget } from '../sim/combat.js';
import { clamp } from '../core/math.js';
import { coolant, pauseGame } from '../net/coop-bridge.js';
import { navPoints } from '../hud/cockpit.js';
import { settings } from '../core/settings.js';
import { sound } from '../audio/sound-system.js';
import { toggleImaging } from '../sim/update.js';

/** Fraction of the stick's radius ignored around centre, so resting a thumb does nothing. */
const DEADZONE = 0.16;

/** How far the knob travels, in CSS pixels. Matches the ring in game.css. */
const STICK_RADIUS = 46;

/** Beyond this the leg turn engages. Below it the legs hold their heading. */
const TURN_THRESHOLD = 0.3;

let enabled = false;
let stickPointer = null;
let aimPointer = null;
let stickOrigin = { x: 0, y: 0 };
let lastAim = { x: 0, y: 0 };

/**
 * Whether this device should get touch controls.
 *
 * A laptop with a touchscreen reports touch points but also has a fine pointer, and
 * covering a quarter of its screen with thumb controls would be wrong. The deciding
 * signal is a *coarse* primary pointer.
 */
export function touchAvailable() {
  return caps.coarsePointer || (caps.maxTouchPoints > 0 && !matchMedia('(hover: hover)').matches);
}

/**
 * Take pointer capture, tolerating a pointer that has already gone.
 *
 * `setPointerCapture` throws NotFoundError if the pointer is no longer active, which a
 * quick tap manages routinely — the browser can deliver pointerdown and pointerup close
 * enough together that the pointer is released before the handler runs. Thrown from the
 * top of a handler it aborts the rest of it, which is how a fast tap on a button silently
 * did nothing while a slow press worked. Capture is an enhancement here, so losing it is
 * fine; losing the action is not.
 */
function capture(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Pointer already released — the press still counts.
  }
}

/** Release every held control. Used when the controls are hidden mid-mission. */
function releaseAll() {
  G.keys.KeyA = false;
  G.keys.KeyD = false;
  G.keys.ShiftLeft = false;
  G.mouse.down = false;
  G.mouse.drag = false;
  stickPointer = null;
  aimPointer = null;
  const stick = $('touchStick');
  if (stick) {
    stick.classList.remove('active');
    setKnob(0, 0);
  }
  for (const b of $$('#touch .tbtn')) b.classList.remove('held');
}

function setKnob(x, y) {
  const knob = $('stickKnob');
  if (knob) knob.style.transform = `translate(${x * STICK_RADIUS}px, ${y * STICK_RADIUS}px)`;
}

/** Apply a stick position, both axes normalised to -1..1. */
function applyStick(nx, ny) {
  setKnob(nx, ny);

  // Vertical: forward is up, so the screen's downward axis is inverted. The full range is
  // asymmetric because the mech reverses at a fraction of its forward speed.
  const forward = -ny;
  const magnitude = Math.abs(forward);
  G.player.throttle =
    magnitude < DEADZONE
      ? 0
      : clamp(
          Math.sign(forward) * ((magnitude - DEADZONE) / (1 - DEADZONE)) * (forward > 0 ? 1 : 0.45),
          -0.45,
          1,
        );

  // Horizontal: the legs turn at a fixed rate, so this is a threshold rather than a ramp.
  G.keys.KeyA = nx < -TURN_THRESHOLD;
  G.keys.KeyD = nx > TURN_THRESHOLD;

  const readout = $('stickReadout');
  if (readout) readout.textContent = Math.round(G.player.throttle * 100) + '%';
}

/** One-shot and held actions, keyed by the `data-touch` attribute. */
function pressAction(name, element) {
  switch (name) {
    case 'fire':
      G.mouse.down = true;
      break;
    case 'jump':
      G.keys.ShiftLeft = true;
      break;
    case 'target':
      chooseTarget();
      break;
    case 'coolant':
      coolant();
      break;
    case 'stop':
      G.player.throttle = 0;
      break;
    case 'align':
      G.player.align = true;
      G.player.centerTorso = false;
      break;
    case 'center':
      G.player.centerTorso = true;
      G.player.align = false;
      break;
    case 'imaging':
      toggleImaging();
      break;
    case 'zoom':
      G.zoom = !G.zoom;
      sound.fxPlay('beep');
      break;
    case 'map':
      G.mapOpen = !G.mapOpen;
      sound.fxPlay('beep');
      break;
    case 'nav': {
      const n = navPoints()
        .map((p, i) => (p.active && !p.done ? i : -1))
        .filter((i) => i >= 0);
      G.navIndex = n[(n.indexOf(G.navIndex) + 1) % n.length] ?? 0;
      sound.say('nav');
      break;
    }
    case 'pause':
      pauseGame();
      break;
    case 'weapon': {
      const index = Number(element.dataset.index);
      G.weaponIndex = index;
      sound.fxPlay('beep');
      syncWeapons();
      break;
    }
  }
}

function releaseAction(name) {
  if (name === 'fire') G.mouse.down = false;
  if (name === 'jump') G.keys.ShiftLeft = false;
}

/** Mark the selected weapon, so the pad agrees with the HUD. */
export function syncWeapons() {
  for (const b of $$('#touchWeapons .tbtn')) {
    b.classList.toggle('selected', Number(b.dataset.index) === G.weaponIndex);
  }
}

/** Show or hide the whole layer. */
export function setTouchVisible(visible) {
  const layer = $('touch');
  if (!layer) return;
  if (!visible) releaseAll();
  layer.hidden = !visible;
  layer.setAttribute('aria-hidden', visible ? 'false' : 'true');
  if (visible) syncWeapons();
}

/**
 * Called every frame from the loop: the controls belong to a running mission only, so the
 * menu, the briefing and the pause screen are not covered by them.
 */
export function updateTouchVisibility() {
  if (!enabled) return;
  const playing = G.state === 'playing' || G.state === 'boot';
  const layer = $('touch');
  if (!layer) return;
  if (layer.hidden === playing) setTouchVisible(playing);
  // The selected weapon changes from the pad, the keyboard, the scroll wheel and the
  // co-op layer. Reconciling three class toggles per frame is cheaper than remembering to
  // notify from all four.
  if (playing) syncWeapons();
}

export function initTouch() {
  enabled = touchAvailable();
  if (!enabled) return;

  // The menu's advice is wrong on a phone.
  const hint = $('inputHint');
  if (hint) hint.textContent = 'TOUCH CONTROLS · TURN SIDEWAYS · HEADPHONES RECOMMENDED';

  const layer = $('touch');
  const stick = $('touchStick');
  const aim = $('touchAim');

  // --- the stick ------------------------------------------------------------
  stick.addEventListener('pointerdown', (e) => {
    if (stickPointer !== null) return;
    stickPointer = e.pointerId;
    capture(stick, e.pointerId);
    stick.classList.add('active');
    const rect = stick.getBoundingClientRect();
    stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    e.preventDefault();
  });

  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer) return;
    const dx = (e.clientX - stickOrigin.x) / STICK_RADIUS;
    const dy = (e.clientY - stickOrigin.y) / STICK_RADIUS;
    const length = Math.hypot(dx, dy);
    const scale = length > 1 ? 1 / length : 1;
    applyStick(dx * scale, dy * scale);
    e.preventDefault();
  });

  const endStick = (e) => {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    stick.classList.remove('active');
    // Release the stick and the legs stop, but the throttle holds — this is a throttle
    // lever, not a spring-loaded pedal, and the mech is meant to keep its set speed.
    G.keys.KeyA = false;
    G.keys.KeyD = false;
    setKnob(0, 0);
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  // --- aim ------------------------------------------------------------------
  aim.addEventListener('pointerdown', (e) => {
    if (aimPointer !== null) return;
    aimPointer = e.pointerId;
    capture(aim, e.pointerId);
    lastAim = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  });

  aim.addEventListener('pointermove', (e) => {
    if (e.pointerId !== aimPointer) return;
    if (G.state !== 'playing' && G.state !== 'boot') return;

    // Relative drag, like a trackpad. Absolute positioning would mean the torso jumping to
    // wherever a thumb first lands, which is unusable.
    const dx = e.clientX - lastAim.x;
    const dy = e.clientY - lastAim.y;
    lastAim = { x: e.clientX, y: e.clientY };

    // A thumb travels far less than a mouse, so touch needs a higher factor than the
    // mouse path uses for the same setting to feel equivalent.
    const sensitivity = settings.sensitivity * 0.0052 * (G.zoom ? 0.5 : 1);
    G.player.torso = clamp(G.player.torso + dx * sensitivity, -1.68, 1.68);
    G.player.pitch = clamp(
      G.player.pitch - dy * sensitivity * (settings.invert ? -1 : 1),
      -0.62,
      0.6,
    );
    G.player.centerTorso = false;
    e.preventDefault();
  });

  const endAim = (e) => {
    if (e.pointerId !== aimPointer) return;
    aimPointer = null;
  };
  aim.addEventListener('pointerup', endAim);
  aim.addEventListener('pointercancel', endAim);

  // --- buttons --------------------------------------------------------------
  for (const button of $$('#touch .tbtn')) {
    const name = button.dataset.touch;

    button.addEventListener('pointerdown', (e) => {
      button.classList.add('held');
      pressAction(name, button);
      // Capture last: it can throw, and the press has already been honoured by here.
      capture(button, e.pointerId);
      // Stop the press reaching the aim layer underneath.
      e.stopPropagation();
      e.preventDefault();
    });

    const release = (e) => {
      button.classList.remove('held');
      releaseAction(name);
      e.stopPropagation();
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    // A thumb that slides off a held button must not leave it stuck on.
    button.addEventListener('lostpointercapture', () => {
      button.classList.remove('held');
      releaseAction(name);
    });
  }

  // Losing the tab with a finger down would otherwise leave the mech running.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });
  window.addEventListener('blur', releaseAll);

  // The browser's own gestures — pull to refresh, double-tap zoom, text selection — all
  // fight a game that wants raw drags. `touch-action: none` handles most of it; this
  // catches the multi-touch pinch that it does not.
  layer.addEventListener('gesturestart', (e) => e.preventDefault());
  layer.addEventListener('contextmenu', (e) => e.preventDefault());

  setTouchVisible(false);
}
