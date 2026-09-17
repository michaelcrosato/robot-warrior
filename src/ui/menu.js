/**
 * Menu, briefing, field manual and settings wiring.
 */
import { $, $$ } from '../core/dom.js';
import { G, config } from '../sim/state.js';
import { applyChassisWeapons } from '../sim/player.js';
import { chassisData } from '../data/chassis.js';
import { drawTacticalMap } from '../hud/screens.js';
import { pauseGame, resumeGame, returnMenu, startMission, toast } from '../net/coop-bridge.js';
import { resize } from '../core/viewport.js';
import { saveSettings, settings } from '../core/settings.js';
import { sound } from '../audio/sound-system.js';
import { toggleImaging } from '../sim/update.js';

export function updateChassisUI() {
  const c = chassisData();
  $$('[data-chassis]').forEach((b) => {
    const selected = b.dataset.chassis === G.chassis;
    b.classList.toggle('active', selected);
    b.setAttribute('aria-pressed', String(selected));
  });
  $('menuEyebrow').textContent = c.tons + ' TONS. ONE PILOT.';
  $('menuMechNote').textContent = c.desc;
  $('heroCode').textContent = c.code;
  $('heroClass').textContent = c.name + ' / ' + c.role + ' CLASS';
  $('heroWeapons').textContent = c.weapons.map((w) => w.name).join(' / ');
  $('heroMobility').textContent = 'JUMP CAPABLE · ' + Math.round(c.speed * 3.6) + ' KM/H';
  $('menuChassis').textContent = c.name + ' / ' + c.tons + ' T';
  $('chassisStatLine').textContent =
    c.name + ' / ' + c.tons + ' T / ' + Math.round(c.speed * 3.6) + ' KM/H';
  $('chassisSummary').textContent =
    c.desc +
    ' Armor: ' +
    Math.round(c.armor * 100) +
    '% of Warden. Lock time: ' +
    c.lockTime.toFixed(2) +
    ' s. All weapon configurations remain available.';
}

export function initMenu() {
  for (const b of $$('[data-chassis]'))
    b.addEventListener('click', () => {
      if (G.state !== 'menu') return;
      G.chassis = b.dataset.chassis;
      applyChassisWeapons();
      updateChassisUI();
      try {
        localStorage.setItem('robotwarrior.chassis', G.chassis);
      } catch (e) {}
      sound.fxPlay('beep');
    });
  $('enhancedView').addEventListener('change', () => {
    if ($('enhancedView').checked !== G.player.imaging) toggleImaging();
  });
  $('startBtn').addEventListener('click', startMission);
  $('briefStart').addEventListener('click', startMission);
  $('briefBtn').addEventListener('click', openBrief);
  $('manualBtn').addEventListener('click', openManual);
  $('pauseManual').addEventListener('click', openManual);
  $('resumeBtn').addEventListener('click', resumeGame);
  $('restartBtn').addEventListener('click', startMission);
  $('quitBtn').addEventListener('click', returnMenu);
  $('againBtn').addEventListener('click', startMission);
  $('resultMenu').addEventListener('click', returnMenu);
  for (const b of $$('[data-close]'))
    b.addEventListener('click', () => {
      const id = b.dataset.close;
      if (id === 'manual') closeManual();
      else $(id).hidden = true;
    });
  for (const b of $$('[data-loadout]'))
    b.addEventListener('click', () => {
      G.loadout = b.dataset.loadout;
      $$('[data-loadout]').forEach((e) => e.classList.toggle('active', e === b));
      $('loadoutDesc').textContent = config[G.loadout].desc;
      $('menuLoadout').textContent = config[G.loadout].label;
      sound.fxPlay('beep');
    });
  for (const b of $$('[data-difficulty]'))
    b.addEventListener('click', () => {
      G.difficulty = b.dataset.difficulty;
      $$('[data-difficulty]').forEach((e) => e.classList.toggle('active', e === b));
      sound.fxPlay('beep');
    });
  for (const id of ['volume', 'music', 'sensitivity']) {
    $(id).value = Math.round(settings[id] * 100);
    $(id).addEventListener('input', () => {
      settings[id] = Number($(id).value) / 100;
      saveSettings();
    });
  }
  $('quality').value = settings.quality;
  $('quality').addEventListener('change', () => {
    settings.quality = $('quality').value;
    resize();
    saveSettings();
  });
  for (const id of ['shake', 'invert']) {
    $(id).checked = settings[id];
    $(id).addEventListener('change', () => {
      settings[id] = $(id).checked;
      saveSettings();
    });
  }
}

function openBrief() {
  $('brief').hidden = false;
  const c = $('briefMap').getContext('2d');
  drawTacticalMap(c, 0, 0, $('briefMap').width, $('briefMap').height, false);
}

export function openManual() {
  if (G.coop?.active) {
    G.coop.pauseLocal();
    G.helpFrom = 'pause';
    $('pause').hidden = true;
    $('manual').hidden = false;
    return;
  }
  if (G.state === 'playing' || G.state === 'boot') {
    pauseGame();
    G.helpFrom = 'pause';
    $('pause').hidden = true;
  } else if (G.state === 'paused') {
    G.helpFrom = 'pause';
    $('pause').hidden = true;
  } else {
    G.helpFrom = $('brief').hidden ? 'menu' : 'brief';
    $('brief').hidden = true;
  }
  $('manual').hidden = false;
}

export function closeManual() {
  $('manual').hidden = true;
  if (G.helpFrom === 'pause') $('pause').hidden = false;
  else if (G.helpFrom === 'brief') openBrief();
}

export async function fullScreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (e) {
    toast('Use your browser full screen command.');
  }
}
