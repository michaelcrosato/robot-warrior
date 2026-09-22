/** Two-thumb controls: assists feed ordinary inputs before solo simulation or co-op sampling. */
import { $, $$ } from '../core/dom.js';
import { G } from '../sim/state.js';
import { caps } from '../core/gl.js';
import { inputHint } from '../core/input-hints.js';
import { clearLOS, fireOrigin, forward, weaponDisabled } from '../sim/combat.js';
import { clamp, dist2, dot, norm, vsub, wrap } from '../core/math.js';
import { coolant, pauseGame } from '../net/coop-bridge.js';
import { missionObjectives, navPoints } from '../hud/cockpit.js';
import { drawTacticalMap } from '../hud/screens.js';
import { playerArmor } from '../sim/player.js';
import { center } from '../entities/draw.js';
import { pools } from '../entities/pools.js';
import { extraction, flightLink, serviceBay, supplyBay } from '../world/sites.js';
import { allObjectivesComplete } from '../entities/spawn.js';
import { landingThreats } from '../sim/mission.js';
import { settings } from '../core/settings.js';
import { sound } from '../audio/sound-system.js';
import { toggleImaging } from '../sim/update.js';
import { openManual } from './menu.js';
import { canAutoRestore, heatLimited, pickTouchTarget, stickInput } from './touch-math.js';

let stickPointer = null;
let aimPointer = null;
let stickOrigin = { x: 0, y: 0 };
let stickRadius = 42;
let lastAim = { x: 0, y: 0 };
let holdingFire = false;
let cooling = false;
let toolsOpen = false;
let readoutClock = 0;
let targetClock = 0;
let controlsActive = false;
const presses = new Map();

export function touchAvailable() {
  return caps.coarsePointer || (caps.maxTouchPoints > 0 && !matchMedia('(hover: hover)').matches);
}

function running() {
  return (G.state === 'playing' || G.state === 'boot') && !G.coop?.localMenu;
}

function driving() {
  return running() && G.player.alive && !G.coop?.held && !toolsOpen && !G.mapOpen;
}

function capture(element, pointerId) {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Fast taps can be released before capture; their action must still count.
  }
}

function setKnob(x, y) {
  $('stickKnob').style.transform = `translate(${x * stickRadius}px, ${y * stickRadius}px)`;
}

function stopStick() {
  stickPointer = null;
  G.player.throttle = 0;
  G.player.align = false;
  G.keys.KeyA = false;
  G.keys.KeyD = false;
  $('touchStick').classList.remove('active');
  setKnob(0, 0);
}

/** Interruptions must stop the mech, not leave an invisible throttle or held weapon. */
function releaseAll() {
  stopStick();
  aimPointer = null;
  holdingFire = false;
  cooling = false;
  G.keys.ShiftLeft = false;
  G.keys.KeyJ = false;
  G.mouse.down = false;
  G.mouse.drag = false;
  // Clear ownership before releasing capture: lostpointercapture can arrive immediately.
  presses.clear();
  for (const el of $$('#touch .held')) el.classList.remove('held');
}

function applyStick(e) {
  const input = stickInput(e.clientX - stickOrigin.x, e.clientY - stickOrigin.y, stickRadius);
  setKnob(input.x, input.y);
  G.player.throttle = input.throttle;
  G.keys.KeyA = input.turn < 0;
  G.keys.KeyD = input.turn > 0;
  // Existing gradual alignment preserves the sight's heading while the legs catch up.
  G.player.align = input.turn === 0 && Math.abs(input.throttle) > 0.05;
  G.player.centerTorso = false;
}

function beginAim(e) {
  if (aimPointer !== null) return;
  aimPointer = e.pointerId;
  lastAim = { x: e.clientX, y: e.clientY };
}

function moveAim(e) {
  if (e.pointerId !== aimPointer || !driving()) return;
  const dx = e.clientX - lastAim.x;
  const dy = e.clientY - lastAim.y;
  lastAim = { x: e.clientX, y: e.clientY };
  const sensitivity = settings.sensitivity * 0.0052 * (G.zoom ? 0.5 : 1);
  G.player.torso = clamp(G.player.torso + dx * sensitivity, -1.68, 1.68);
  G.player.pitch = clamp(
    G.player.pitch - dy * sensitivity * (settings.invert ? -1 : 1),
    -0.62,
    0.6,
  );
  G.player.centerTorso = false;
  e.preventDefault();
}

function syncPanels() {
  $('touchTools').hidden = !toolsOpen;
  $('touchMapPanel').hidden = !G.mapOpen;
  $('touchControls').hidden = toolsOpen || G.mapOpen || !G.player.alive || !!G.coop?.held;
  for (const b of $$('#touchTop [aria-expanded]'))
    b.setAttribute('aria-expanded', String(b.dataset.touch === 'map' ? G.mapOpen : toolsOpen));
}

function pressAction(name, element) {
  switch (name) {
    case 'fire':
      holdingFire = true;
      break;
    case 'jump':
      G.keys.ShiftLeft = true;
      break;
    case 'weapon':
      G.weaponIndex = Number(element.dataset.index);
      sound.fxPlay('beep');
      break;
    case 'coolant':
      coolant();
      break;
    case 'imaging':
      toggleImaging();
      break;
    case 'vision':
      G.player.vision = !G.player.vision;
      break;
    case 'zoom':
      G.zoom = !G.zoom;
      break;
    case 'map':
      releaseAll();
      G.mapOpen = !G.mapOpen;
      toolsOpen = false;
      syncPanels();
      break;
    case 'systems':
      releaseAll();
      toolsOpen = !toolsOpen;
      G.mapOpen = false;
      syncPanels();
      break;
    case 'nav': {
      const n = navPoints()
        .map((p, i) => (p.active && !p.done ? i : -1))
        .filter((i) => i >= 0);
      G.navIndex = n[(n.indexOf(G.navIndex) + 1) % n.length] ?? 0;
      toolsOpen = false;
      syncPanels();
      break;
    }
    case 'help':
      releaseAll();
      openManual();
      break;
    case 'pause':
      releaseAll();
      pauseGame();
      break;
  }
  readoutClock = 0;
}

function endPointer(e) {
  if (e.pointerId === stickPointer) stopStick();
  if (e.pointerId === aimPointer) aimPointer = null;
  const held = presses.get(e.pointerId);
  if (!held) return;
  presses.delete(e.pointerId);
  held.element.classList.remove('held');
  if (held.name === 'fire') {
    holdingFire = false;
    G.mouse.down = false;
    cooling = false;
  }
  if (held.name === 'jump') G.keys.ShiftLeft = false;
}

function selectTarget() {
  const origin = fireOrigin();
  const direction = forward();
  const candidates = [];
  for (const entity of pools.entities) {
    if (!entity.alive) continue;
    const point = center(entity);
    const delta = vsub(point, origin);
    const distance = Math.hypot(...delta);
    const alignment = dot(norm(delta), direction);
    if (distance > G.weapons[2].range || alignment < 0.95) continue;
    candidates.push({ entity, distance, alignment, visible: clearLOS(origin, point) });
  }
  const next = pickTouchTarget(candidates, G.target);
  if (next !== G.target) {
    G.target = next;
    G.lock = 0;
    G.lockSpoken = false;
  }
}

function setText(id, value) {
  const el = $(id);
  if (el.textContent !== value) el.textContent = value;
}

function missionNotice() {
  for (const bay of [
    { site: serviceBay, active: G.missionFlags[2] && !G.serviceUsed, time: G.serviceTime },
    {
      site: supplyBay,
      active: G.missionFlags[3] && G.missionFlags[4] && !G.supplyUsed,
      time: G.supplyTime,
    },
  ]) {
    if (!bay.active || dist2(G.player, bay.site) >= bay.site.r + 10) continue;
    if (dist2(G.player, bay.site) >= bay.site.r) return 'MOVE INSIDE THE REPAIR RING';
    return G.player.altitude >= 3
      ? 'LAND IN THE REPAIR RING'
      : Math.abs(G.player.speed) >= 1.5
        ? 'RELEASE MOVE TO REPAIR'
        : `REPAIRING · ${Math.max(0, 6 - bay.time).toFixed(1)}s`;
  }
  if (G.missionStage === 'link')
    return `FLIGHT LINK ${Math.floor((G.linkTime / flightLink.duration) * 100)}% · ${inputHint(G.linkStatus, true)}`;
  if (allObjectivesComplete() && dist2(G.player, extraction) < extraction.r + 35) {
    if (G.transportTime < 14) return `TRANSPORT INBOUND · ${Math.ceil(14 - G.transportTime)}s`;
    if (landingThreats().length) return 'LANDING ZONE CONTESTED';
    if (Math.abs(G.player.speed) >= 2.2) return 'RELEASE MOVE FOR EXTRACTION';
    if (G.player.altitude >= 3) return 'LAND INSIDE EXTRACTION';
    return `HOLD POSITION · ${Math.max(0, 5 - G.extractTime).toFixed(1)}s`;
  }
  return '';
}

function updateReadouts() {
  setText('touchArmor', `${Math.round(playerArmor() * 100)}%`);
  setText('touchHeat', `${Math.round(G.player.heat)}%`);
  $('touchHeat').classList.toggle('critical', G.player.heat > 75);
  setText('touchFuel', `${Math.round(G.player.fuel)}%`);
  setText(
    'stickReadout',
    stickPointer === null ? 'RELEASE TO STOP' : `${Math.round(G.player.speed * 3.6)} KM/H`,
  );
  setText('touchObjective', missionObjectives().find((o) => !o[1])?.[0] || 'SECTOR SECURED');
  const points = navPoints();
  if (!points[G.navIndex]?.active || points[G.navIndex]?.done) {
    const next = points.findIndex((p) => p.active && !p.done && !p.service);
    if (next >= 0) G.navIndex = next;
  }
  const waypoint = points[G.navIndex];
  const angle = waypoint
    ? wrap(
        Math.atan2(waypoint.x - G.player.x, -(waypoint.z - G.player.z)) -
          G.player.yaw -
          G.player.torso,
      )
    : 0;
  setText(
    'touchNav',
    waypoint?.active && !waypoint.done
      ? `${Math.abs(angle) < 0.3 ? '↑' : angle > 0 ? '→' : '←'} ${waypoint.name} · ${Math.round(dist2(G.player, waypoint))} M`
      : 'CLEAR REMAINING HOSTILES',
  );
  // Network radio events arrive directly in G.radio, so adapt at the local display seam.
  setText('touchRadio', inputHint(G.radio.at(-1)?.text || '', true));
  const target = G.target?.alive ? G.target : null;
  setText(
    'touchTarget',
    target
      ? `${target.name} · ${Math.round(dist2(G.player, target))} M · ${G.lock >= 1 ? 'LOCKED' : Math.round(G.lock * 100) + '%'}`
      : '',
  );
  setText(
    'touchNotice',
    !G.player.alive
      ? 'MECH DOWN · WAIT FOR YOUR TEAM'
      : G.coop?.held
        ? 'HOST PAUSED · PAUSE MENU AVAILABLE'
        : G.state === 'boot'
          ? 'SYSTEMS STARTING'
          : G.player.shutdown > 0
            ? 'REACTOR COOLING'
            : cooling
              ? 'HEAT GUARD · COOLING'
              : weaponDisabled(G.weaponIndex)
                ? 'WEAPON DISABLED · SELECT ANOTHER'
                : holdingFire && G.weaponIndex === 2 && G.lock < 1
                  ? 'HOLD SIGHT ON TARGET TO LOCK'
                  : missionNotice(),
  );
  for (const b of $$('#touchWeapons .weapon')) {
    const index = Number(b.dataset.index);
    const w = G.weapons[index];
    const active = index === G.weaponIndex;
    b.classList.toggle('selected', active);
    b.setAttribute('aria-pressed', String(active));
    const label =
      w.remaining > 0
        ? `${w.remaining.toFixed(1)}s`
        : index === 0
          ? 'READY'
          : String(index === 1 ? G.player.ammo : G.player.missiles);
    const text = weaponDisabled(index) ? 'DISABLED' : active && cooling ? 'COOLING' : label;
    if (b.lastElementChild.textContent !== text) b.lastElementChild.textContent = text;
    b.title = w.name;
  }
  $('touchPad').querySelector('.fire').classList.toggle('cooling', cooling);
  for (const b of $$('#touchTools [aria-pressed]')) {
    const on =
      b.dataset.touch === 'zoom'
        ? G.zoom
        : b.dataset.touch === 'imaging'
          ? G.player.imaging
          : G.player.vision;
    b.setAttribute('aria-pressed', String(on));
  }
  const cool = $('touchTools').querySelector('[data-touch="coolant"]');
  cool.textContent = `COOLANT ${G.player.coolants}`;
  cool.disabled = G.player.coolants <= 0 || G.player.heat < 12 || !G.player.alive || !!G.coop?.held;
  setText(
    'touchSquad',
    G.coop?.active
      ? [...G.coop.members.values()]
          .map((member) => {
            const pilot = G.coop.playerOf(member);
            return `${member.name} · ${pilot?.alive ? 'ONLINE' : 'DOWN'}`;
          })
          .join(' / ') + ' · Stop near a downed ally to restore them automatically.'
      : '',
  );
  if (G.mapOpen) {
    const canvas = /** @type {HTMLCanvasElement} */ ($('touchMap'));
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const context = canvas.getContext('2d');
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawTacticalMap(context, 0, 0, width, height, true);
  }
}

/** Never run from a replayed or remote-owned pilot step. */
export function updateTouch(dt) {
  if (!G.touchMode) return;
  const visible = running();
  const layer = $('touch');
  if (layer.hidden === visible) {
    releaseAll();
    toolsOpen = false;
    layer.hidden = !visible;
    layer.setAttribute('aria-hidden', String(!visible));
    readoutClock = 0;
    syncPanels();
  }
  const active = driving();
  if (controlsActive && !active) releaseAll();
  controlsActive = active;
  if (!visible) return;
  if (active && G.state === 'playing') {
    G.keys.KeyJ = !!G.coop?.active && canAutoRestore(G.player);
    targetClock -= dt;
    if (targetClock <= 0) {
      selectTarget();
      targetClock = 0.15;
    }
    if (stickPointer !== null && !G.keys.KeyA && !G.keys.KeyD && Math.abs(G.player.throttle) > 0.05)
      G.player.align = true;
    cooling = holdingFire && heatLimited(cooling, G.player.heat, G.weapons[G.weaponIndex].heat);
    G.mouse.down = holdingFire && !cooling;
  }
  readoutClock -= dt;
  if (readoutClock <= 0) {
    syncPanels();
    updateReadouts();
    readoutClock = 0.1;
  }
}

/** Observe real input without a test-only mutation API. */
export function getControlStatus() {
  return {
    touch: G.touchMode,
    throttle: G.player.throttle,
    yaw: G.player.yaw,
    fire: G.mouse.down,
    jets: !!G.keys.ShiftLeft,
    turning: !!(G.keys.KeyA || G.keys.KeyD),
    aligning: G.player.align,
    weapon: G.weaponIndex,
    target: G.target?.name ?? null,
    lock: G.lock,
    cooling,
    shots: G.shotsFired,
    fuel: G.player.fuel,
    coolants: G.player.coolants,
  };
}

export function initTouch() {
  G.touchMode = touchAvailable();
  if (!G.touchMode) return;
  document.body.classList.add('touch-device');
  $('inputHint').textContent = 'TOUCH CONTROLS · TWO THUMBS · PORTRAIT OR LANDSCAPE';
  $('manualBtn').textContent = 'FIELD MANUAL';
  document.querySelector('label[for="sensitivity"]').textContent = 'Aim sensitivity';
  document.querySelector('label[for="invert"]').textContent = 'Invert aim Y';
  document.querySelector('label[for="enhancedView"]').textContent = 'Enhanced Imaging';
  const stick = $('touchStick');
  const aim = $('touchAim');
  stick.addEventListener('pointerdown', (e) => {
    if (!driving() || stickPointer !== null) return;
    stickPointer = e.pointerId;
    const rect = stick.getBoundingClientRect();
    stickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    stickRadius = rect.width * 0.33;
    stick.classList.add('active');
    applyStick(e);
    capture(stick, e.pointerId);
    e.preventDefault();
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer || !driving()) return;
    applyStick(e);
    e.preventDefault();
  });
  aim.addEventListener('pointerdown', (e) => {
    if (!driving() || aimPointer !== null) return;
    beginAim(e);
    capture(aim, e.pointerId);
    e.preventDefault();
  });
  for (const button of $$('#touch .tbtn')) {
    const name = button.dataset.touch;
    button.addEventListener('pointerdown', (e) => {
      if (
        !running() ||
        button.hasAttribute('disabled') ||
        [...presses.values()].some((p) => p.element === button)
      )
        return;
      if (['fire', 'jump', 'weapon'].includes(name) && !driving()) return;
      presses.set(e.pointerId, { element: button, name });
      button.classList.add('held');
      if (name === 'fire') beginAim(e);
      pressAction(name, button);
      capture(button, e.pointerId);
      e.preventDefault();
    });
    // Keyboard / assistive activation of discrete buttons; touch was handled above.
    button.addEventListener('click', (e) => {
      if (e.detail === 0 && running() && !['fire', 'jump'].includes(name))
        pressAction(name, button);
    });
    button.addEventListener('lostpointercapture', endPointer);
  }
  window.addEventListener('pointermove', moveAim);
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', endPointer);
  stick.addEventListener('lostpointercapture', endPointer);
  aim.addEventListener('lostpointercapture', endPointer);
  window.addEventListener('blur', releaseAll);
  // Rotation / browser chrome resizing invalidates every stored touch origin.
  window.addEventListener('resize', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });
  $('touch').addEventListener('contextmenu', (e) => e.preventDefault());
}
