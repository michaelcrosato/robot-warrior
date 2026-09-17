/**
 * The frame loop and frame-rate accounting.
 */
import { $ } from './core/dom.js';
import { G } from './sim/state.js';
import { updateTouchVisibility } from './ui/touch.js';
import { announce, drawHUD } from './net/coop-bridge.js';
import { renderWorld } from './render/world.js';
import { sound } from './audio/sound-system.js';
import { updateEffects } from './sim/update.js';
import { updateMission } from './sim/mission.js';

let lastFrame = performance.now();

let frameCount = 0;

export let fps = 60;

let fpsClock = 0;

export function frame(now) {
  const dt = Math.min(0.2, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  G.realTime += dt;
  // The touch layer belongs to a running mission, so its visibility follows game state
  // rather than being toggled at every transition that could reach it.
  updateTouchVisibility();
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
  requestAnimationFrame(frame);
}
