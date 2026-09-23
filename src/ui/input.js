/**
 * Keyboard, mouse, pointer lock and context-loss handling.
 */
import { wheelStep } from './wheel.js';
import { $ } from '../core/dom.js';
import { G } from '../sim/state.js';
import { chooseTarget } from '../sim/combat.js';
import { clamp } from '../core/math.js';
import { closeManual, fullScreen, openManual } from './menu.js';
import { coolant, pauseGame, resumeGame, startMission, toast } from '../net/coop-bridge.js';
import { navPoints } from '../hud/cockpit.js';
import { requestCapture } from '../sim/player.js';
import { settings } from '../core/settings.js';
import { sound } from '../audio/sound-system.js';
import { toggleImaging } from '../sim/update.js';
import { world } from '../core/gl.js';

export function initInput() {
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.code === 'Enter') {
      e.preventDefault();
      fullScreen();
      return;
    }
    if (
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) &&
      e.code !== 'Escape'
    )
      return;
    if (e.code === 'Escape') {
      e.preventDefault();
      if (G.coop?.active && G.coop.localMenu && $('manual').hidden) {
        G.coop.resumeLocal();
        return;
      }
      if (!$('manual').hidden) {
        closeManual();
        return;
      }
      if (!$('brief').hidden) {
        $('brief').hidden = true;
        return;
      }
      if (G.state === 'playing' || G.state === 'boot') pauseGame();
      else if (G.state === 'paused') resumeGame();
      return;
    }
    if (e.code === 'KeyH' && !e.repeat) {
      e.preventDefault();
      if (!$('manual').hidden) closeManual();
      else openManual();
      return;
    }
    if (e.code === 'KeyP' && !e.repeat) {
      sound.muted = !sound.muted;
      toast(sound.muted ? 'Sound is off. [P] Sound on.' : 'Sound is on.');
      return;
    }
    if (G.state === 'menu') {
      // Enter is a quick deploy from the bare menu only. A focused control handles Enter
      // itself, and an open briefing or co-op lobby means the player is somewhere else:
      // deploying from there started a solo mission underneath it.
      const focused = document.activeElement?.closest?.('button, a, [role="button"]');
      const covered = !$('manual').hidden || !$('brief').hidden || !$('coopLobby').hidden;
      if (e.code === 'Enter' && !e.repeat && !focused && !covered) startMission();
      return;
    }
    if (G.state !== 'playing' && G.state !== 'boot') return;
    const supported = [
      'Space',
      'Tab',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'ShiftLeft',
      'ShiftRight',
      'KeyW',
      'KeyS',
      'KeyA',
      'KeyD',
      'KeyQ',
      'KeyE',
      'KeyF',
      'KeyR',
      'KeyG',
      'KeyX',
      'KeyC',
      'KeyB',
      'KeyN',
      'KeyV',
      'KeyI',
      'KeyZ',
      'KeyM',
      'Home',
      'Digit1',
      'Digit2',
      'Digit3',
    ];
    if (supported.includes(e.code)) e.preventDefault();
    G.keys[e.code] = true;
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyX':
        G.player.throttle = 0;
        break;
      case 'KeyB':
        G.player.throttle = 1;
        break;
      case 'KeyR':
        chooseTarget();
        break;
      case 'Tab':
        chooseTarget(true);
        break;
      case 'KeyC':
        G.player.align = true;
        G.player.centerTorso = false;
        break;
      case 'Home':
        G.player.centerTorso = true;
        G.player.align = false;
        break;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
        G.weaponIndex = Number(e.code.slice(-1)) - 1;
        sound.fxPlay('beep');
        break;
      case 'KeyG':
        coolant();
        break;
      case 'KeyV':
        G.player.vision = !G.player.vision;
        sound.fxPlay('beep');
        break;
      case 'KeyI':
        toggleImaging();
        break;
      case 'KeyZ':
        G.zoom = !G.zoom;
        break;
      case 'KeyM':
        G.mapOpen = !G.mapOpen;
        sound.fxPlay('beep');
        break;
      case 'KeyN': {
        const n = navPoints()
          .map((p, i) => (p.active && !p.done ? i : -1))
          .filter((i) => i >= 0);
        G.navIndex = n[(n.indexOf(G.navIndex) + 1) % n.length] ?? 0;
        sound.say('nav');
        break;
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    G.keys[e.code] = false;
  });
  world.addEventListener('mousedown', (e) => {
    if (G.state !== 'playing' && G.state !== 'boot') return;
    if (e.button === 0) G.mouse.down = true;
    if (e.button === 0 || e.button === 2) G.mouse.drag = true;
    if (!document.pointerLockElement) requestCapture();
    e.preventDefault();
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) G.mouse.down = false;
    G.mouse.drag = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (G.state !== 'playing' && G.state !== 'boot') return;
    if (document.pointerLockElement !== world && !G.mouse.drag) return;
    const sensitivity = settings.sensitivity * 0.0016 * (G.zoom ? 0.55 : 1);
    G.player.torso = clamp(G.player.torso + e.movementX * sensitivity, -1.68, 1.68);
    G.player.pitch = clamp(
      G.player.pitch - e.movementY * sensitivity * (settings.invert ? -1 : 1),
      -0.62,
      0.6,
    );
    G.player.centerTorso = false;
  });
  world.addEventListener('contextmenu', (e) => e.preventDefault());
  world.addEventListener(
    'wheel',
    (e) => {
      if (G.state !== 'playing') return;
      e.preventDefault();
      const step = wheelStep(e.deltaX, e.deltaY, performance.now(), lastWheel);
      if (!step) return;
      lastWheel = performance.now();
      G.weaponIndex = (G.weaponIndex + (step > 0 ? 1 : 2)) % 3;
    },
    { passive: false },
  );
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === world) {
      hadLock = true;
      $('toast').hidden = true;
    } else if (hadLock) {
      hadLock = false;
      if (G.state === 'playing' || G.state === 'boot') pauseGame();
    }
  });
  window.addEventListener('blur', () => {
    if (G.state === 'playing' || G.state === 'boot') pauseGame();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && (G.state === 'playing' || G.state === 'boot')) pauseGame();
  });
  world.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    pauseGame();
    $('error').className = 'on';
    $('error').textContent = 'The graphics context was lost. Reload the page to restart the game.';
  });
}

let hadLock = false;

/** When the wheel last changed weapon; see wheelStep(). */
let lastWheel = -Infinity;
