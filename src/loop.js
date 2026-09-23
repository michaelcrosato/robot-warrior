/**
 * The frame loop and frame-rate accounting.
 */
import { $ } from './core/dom.js';
import { G } from './sim/state.js';
import { updateTouch } from './ui/touch.js';
import { announce, drawHUD } from './net/coop-bridge.js';
import { renderWorld } from './render/world.js';
import { sound } from './audio/sound-system.js';
import { updateEffects } from './sim/update.js';
import { updateMission } from './sim/mission.js';

let lastFrame = performance.now();

let frameCount = 0;

export let fps = 60;

let fpsClock = 0;

/** Consecutive frames that threw. Reset by any frame that completes. */
let failures = 0;

/**
 * A frame that keeps throwing this many times in a row is not transient. Half a second at
 * 60 fps: long enough to ride out a one-off fault, short enough not to spin on a broken one.
 */
const MAX_FAILURES = 30;

/**
 * One animation frame, guarded.
 *
 * The work is wrapped because the next frame is only requested once it finishes: before,
 * one exception anywhere in the simulation, the renderer or the HUD ended the loop for
 * good and left a frozen picture with no message — a malformed co-op profile or a bad
 * stored setting was enough. A single failure is reported the way an uncaught error would
 * be, so devtools and the test suite still see it, and the loop carries on. A fault that
 * repeats every frame stops the loop and says so on screen instead of spinning.
 *
 * @param {number} now
 */
export function frame(now) {
  try {
    runFrame(now);
    failures = 0;
  } catch (e) {
    if (++failures === 1) reportFrameError(e);
    if (failures >= MAX_FAILURES) {
      stopAfterFault(e);
      return;
    }
  }
  requestAnimationFrame(frame);
}

function reportFrameError(e) {
  if (typeof reportError === 'function') reportError(e);
  else console.error(e);
}

function stopAfterFault(e) {
  try {
    sound.ctx?.suspend().catch(() => {});
  } catch (_) {}
  $('error').className = 'on';
  $('error').textContent =
    'RobotWarrior stopped after an internal error' +
    (e?.message ? ': ' + e.message : '.') +
    ' Reload the page to restart.';
}

/** @param {number} now */
function runFrame(now) {
  const dt = Math.min(0.2, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  G.realTime += dt;
  // The touch layer belongs to a running mission, so its visibility follows game state
  // rather than being toggled at every transition that could reach it.
  updateTouch(dt);
  fpsClock += dt;
  frameCount++;
  if (fpsClock > 1) {
    fps = frameCount / fpsClock;
    frameCount = 0;
    fpsClock = 0;
  }
  if (G.coop?.active) {
    G.coop.frame(dt);
  } else {
    if (G.state === 'boot') {
      const startup = sound.bootStatus();
      // Use the audio clock so the full clip plays, even on a slow device or after a pause.
      G.bootTime = startup.time === null ? G.bootTime + dt : startup.time;
      const progress = G.bootTime / startup.duration;
      G.bootStep =
        progress < 0.035
          ? -1
          : progress < 0.23
            ? 0
            : progress < 0.45
              ? 1
              : progress < 0.67
                ? 2
                : progress < 0.86
                  ? 3
                  : 4;
      if (startup.ended || G.bootTime >= startup.duration) {
        G.state = 'playing';
        announce(
          'CONTROL / Cut the relay and uplink. Clear the basin, then cross Needle Pass.',
          'insertion',
          9,
        );
      }
    }
    if (G.state === 'playing') {
      const steps = Math.ceil(dt / 0.025);
      for (let i = 0; i < steps && G.state === 'playing'; i++) updateMission(dt / steps);
    }
  }
  if (G.state !== 'paused') {
    updateEffects(dt);
    for (let i = G.radio.length - 1; i >= 0; i--)
      if ((G.radio[i].time -= dt) <= 0) G.radio.splice(i, 1);
  }
  if (G.toastTimer > 0) {
    G.toastTimer -= dt;
    if (G.toastTimer <= 0) $('toast').hidden = true;
  }
  sound.update();
  renderWorld();
  drawHUD();
}
