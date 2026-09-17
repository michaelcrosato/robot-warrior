/**
 * Four-pilot co-op: lobby, lockstep simulation and reconciliation.
 */
import { $, hideOverlays } from '../core/dom.js';
import {
  COOP_COLORS,
  COOP_KEYS,
  COOP_PROTOCOL,
  COOP_STEP,
  coopCopy,
  coopName,
  coopNumber,
} from './protocol.js';
import { G, config } from '../sim/state.js';
import { LanceRelayTransport, LanceTransport } from './transport.js';
import { announce, endMission, spawnBeam, toast } from './coop-bridge.js';
import {
  applyChassisWeapons,
  finishSoloMission,
  newPlayer,
  playerArmor,
  requestCapture,
  resetGame,
  soloReturnMenu,
  soloStartMission,
} from '../sim/player.js';
import { burst, center } from '../entities/draw.js';
import { chassisSpecs } from '../data/chassis.js';
import { clamp, dist2, hex, mix, vadd, vmul, wrap } from '../core/math.js';
import { coverDistance, damagePlayer, raySphere, soloCoolant } from '../sim/combat.js';
import { enemyModels } from '../entities/models.js';
import { makeMech } from '../entities/spawn.js';
import { pools } from '../entities/pools.js';
import { sound } from '../audio/sound-system.js';
import { terrainY } from '../world/terrain.js';
import { updateChassisUI } from '../ui/menu.js';
import { updateMission, updateRepairBays } from '../sim/mission.js';
import { updatePlayer } from '../sim/update.js';
import { world } from '../core/gl.js';

export class LanceCoop {
  /**
   * A mission result the host has committed to but not yet shown, held until every
   * pilot's simulation has caught up to the frame it happened on.
   * @type {any}
   */
  pendingFinish;

  constructor() {
    this.mode = 'offline';
    this.transport = null;
    this.id = '';
    this.hostId = '';
    this.room = '';
    this.members = new Map();
    this.session = '';
    this.sessionStarted = false;
    this.crewSize = 1;
    this.accumulator = 0;
    this.snapClock = 0;
    this.netClock = 0;
    this.seq = 0;
    this.history = [];
    this.actions = [];
    this.executing = null;
    this.replaying = false;
    this.inStep = false;
    this.receiving = false;
    this.events = [];
    this.eventId = 0;
    this.lastEvent = 0;
    this.snapshotId = 0;
    this.lastSnapshot = 0;
    this.projectileId = 0;
    this.localMenu = false;
    this.held = false;
    this.localBootDone = false;
    this.cameraError = [0, 0, 0];
    this.lastSnapshotAt = 0;
    this.lastNetAt = 0;
    this.connecting = false;
    this.suppressClose = false;
    this.error = '';
    this.renderedRoster = '';
    this.startedAt = 0;
    this.wireUI();
    this.netTimer = setInterval(() => this.heartbeat(), 1000);
  }
  get active() {
    return this.sessionStarted && this.mode !== 'offline';
  }
  get host() {
    return this.mode === 'host';
  }
  get guest() {
    return this.mode === 'guest';
  }
  get currentId() {
    return this.executing || this.id;
  }
  playerOf(r) {
    if (r.id === this.id)
      return this.executing && this.executing !== this.id
        ? this.members.get(this.id)?.sim.p
        : G.player;
    return this.host ? r.sim?.p : r.p || r.sim?.p;
  }
  living() {
    return [...this.members.values()].filter((r) => this.playerOf(r)?.alive);
  }
  currentRecord() {
    return this.members.get(this.currentId);
  }
  message(text, bad = false) {
    this.error = bad ? text : '';
    $('coopMessage').textContent = text;
    $('coopMessage').classList.toggle('bad', bad);
  }
  notice(title, text) {
    $('coopNoticeTitle').textContent = title;
    $('coopNoticeText').textContent = text;
    $('coopNotice').hidden = false;
  }
  hideNotice() {
    $('coopNotice').hidden = true;
  }
  show() {
    if (G.state !== 'menu') return;
    $('coopLobby').hidden = false;
    $('brief').hidden = true;
    $('manual').hidden = true;
    $('coopChassis').value = G.chassis;
    $('coopLoadout').value = G.loadout;
    $('coopDifficulty').value = G.difficulty;
    this.paint();
  }
  wireUI() {
    try {
      $('coopName').value = localStorage.getItem('robotwarrior.pilot') || 'PILOT';
    } catch (_) {
      $('coopName').value = 'PILOT';
    }
    $('coopOpen').addEventListener('click', () => this.show());
    $('coopClose').addEventListener('click', () => {
      if (this.mode === 'offline') $('coopLobby').hidden = true;
      else this.leave();
    });
    $('coopHost').addEventListener('click', () => this.connect(true));
    $('coopJoin').addEventListener('click', () => this.connect(false));
    $('coopCodeInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        this.connect(false);
      }
    });
    $('coopLeave').addEventListener('click', () =>
      this.mode === 'offline' ? ($('coopLobby').hidden = true) : this.leave(),
    );
    $('coopCopy').addEventListener('click', () => this.copy(this.formattedRoom()));
    $('coopInvite').addEventListener('click', () => {
      const isWeb = ['https:', 'http:'].includes(location.protocol),
        u = isWeb ? new URL(location.href) : null;
      if (u) {
        u.hash = 'room=' + this.room;
        this.copy(u.href);
      } else
        this.copy(
          'RobotWarrior co-op room: ' +
            this.formattedRoom() +
            '. Open RobotWarrior_Coop.html, select ONLINE CO-OP, then JOIN.',
        );
    });
    $('coopReady').addEventListener('click', () => this.ready());
    $('coopLaunch').addEventListener('click', () => this.startRequested());
    for (const id of ['coopName', 'coopChassis', 'coopLoadout', 'coopDifficulty'])
      $(id).addEventListener('change', () => this.changeProfile());
    if (
      new URLSearchParams(location.search).get('relay') === '1' &&
      ['http:', 'https:'].includes(location.protocol)
    ) {
      $('coopTransport').value = 'relay';
      $('coopSignal').value =
        (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/peerjs';
    }
    const invite = new URLSearchParams(location.hash.slice(1)).get('room');
    if (invite) {
      $('coopCodeInput').value = invite;
      setTimeout(() => this.show(), 0);
    }
    window.addEventListener(
      'keydown',
      (e) => {
        if (this.mode === 'offline') return;
        if (!$('coopLobby').hidden) {
          if (e.code === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (this.mode === 'offline') $('coopLobby').hidden = true;
          } else if (
            e.code === 'Enter' &&
            !['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)
          ) {
            e.preventDefault();
            e.stopImmediatePropagation();
          }
          return;
        }
        if (this.active && this.localMenu && e.code !== 'Escape') {
          if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName))
            e.stopImmediatePropagation();
          return;
        }
        if (this.active && e.code === 'KeyJ') {
          e.preventDefault();
          G.keys.KeyJ = true;
        }
      },
      true,
    );
    world.addEventListener(
      'mousedown',
      (e) => {
        if (this.active && (this.localMenu || this.held)) {
          e.stopImmediatePropagation();
          e.preventDefault();
        }
      },
      true,
    );
    window.addEventListener(
      'mousemove',
      (e) => {
        if (this.active && (this.localMenu || this.held)) e.stopImmediatePropagation();
      },
      true,
    );
    window.addEventListener('pagehide', () => {
      if (this.transport) this.transport.close();
    });
  }
  formattedRoom() {
    return this.room ? this.room.slice(0, 4) + '-' + this.room.slice(4) : '—';
  }
  async copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      this.message('Copied. Send it to your friends.');
    } catch (_) {
      const a = document.createElement('textarea');
      a.value = text;
      a.style.cssText = 'position:fixed;top:0;left:0;opacity:.01';
      document.body.appendChild(a);
      a.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {}
      a.remove();
      this.message(ok ? 'Copied. Send it to your friends.' : 'Copy this text: ' + text);
    }
  }
  profile() {
    return {
      name: coopName($('coopName').value),
      chassis: chassisSpecs[$('coopChassis').value] ? $('coopChassis').value : 'warden',
      loadout: config[$('coopLoadout').value] ? $('coopLoadout').value : 'balanced',
    };
  }
  changeProfile() {
    if (this.active) return;
    const p = this.profile();
    G.chassis = p.chassis;
    G.loadout = p.loadout;
    applyChassisWeapons();
    updateChassisUI();
    try {
      localStorage.setItem('robotwarrior.pilot', p.name);
    } catch (_) {}
    if (this.host) {
      G.difficulty = ['cadet', 'regular', 'veteran'].includes($('coopDifficulty').value)
        ? $('coopDifficulty').value
        : 'regular';
      const r = this.members.get(this.id);
      if (r) Object.assign(r, p, { ready: false });
      this.lobbyBroadcast();
    } else if (this.guest) {
      this.sendHost({ t: 'profile', ...p });
    }
    this.paint();
  }
  paint() {
    const connected = this.mode !== 'offline',
      r = this.members.get(this.id),
      ready = !!r?.ready;
    $('coopState').textContent = this.connecting
      ? 'CONNECTING'
      : connected
        ? this.host
          ? 'HOST ONLINE'
          : 'LINK ONLINE'
        : 'OFFLINE';
    $('coopCount').textContent = connected ? this.members.size + ' / 4 PILOTS' : 'UP TO 4 PLAYERS';
    $('coopConnect').hidden = connected;
    $('coopRoom').hidden = !connected;
    $('coopRoomCode').textContent = this.formattedRoom();
    $('coopClose').setAttribute('aria-label', connected ? 'Leave co-op room' : 'Close co-op lobby');
    $('coopLeave').textContent = connected
      ? this.host
        ? 'CLOSE ROOM'
        : 'LEAVE ROOM'
      : 'RETURN TO OPERATIONS';
    $('coopHost').disabled = this.connecting;
    $('coopJoin').disabled = this.connecting;
    $('coopReady').textContent = ready ? 'CANCEL READY' : 'READY';
    $('coopLaunch').hidden = !this.host;
    $('coopLaunch').disabled =
      this.active || this.members.size < 1 || ![...this.members.values()].every((x) => x.ready);
    $('coopLaunchHint').textContent = this.host
      ? 'All pilots must be ready. Deployment closes the room to new pilots.'
      : 'Choose your mech and select READY. The host starts the mission.';
    for (const id of ['coopName', 'coopChassis', 'coopLoadout'])
      $(id).disabled = ready || this.active || this.connecting;
    $('coopDifficulty').disabled = this.guest || this.active || this.connecting;
    for (const id of [
      'coopTransport',
      'coopSignal',
      'coopTurn',
      'coopTurnUser',
      'coopTurnPass',
      'coopForceRelay',
    ])
      $(id).disabled = connected || this.connecting;
    $('coopMechDesc').textContent = chassisSpecs[$('coopChassis').value]?.desc || '';
    const roster = [...this.members.values()].sort((a, b) => a.slot - b.slot),
      key = JSON.stringify(
        roster.map((x) => [x.id, x.slot, x.name, x.chassis, x.loadout, x.ready]),
      );
    if (this.renderedRoster !== key) {
      this.renderedRoster = key;
      $('coopRoster').replaceChildren();
      for (let i = 0; i < 4; i++) {
        const pilot = roster.find((x) => x.slot === i),
          row = document.createElement('div');
        row.className = 'coop-slot' + (pilot ? '' : ' coop-empty');
        const number = document.createElement('span');
        number.className = 'coop-slot-number';
        number.style.color = COOP_COLORS[i];
        number.textContent = String(i + 1).padStart(2, '0');
        const main = document.createElement('div');
        main.className = 'coop-slot-main';
        const name = document.createElement('strong'),
          info = document.createElement('small');
        name.textContent = pilot
          ? pilot.name + (pilot.id === this.id ? ' / YOU' : '')
          : 'OPEN SLOT';
        info.textContent = pilot
          ? chassisSpecs[pilot.chassis].name + ' / ' + config[pilot.loadout].label
          : 'WAITING FOR A FRIEND';
        main.append(name, info);
        const status = document.createElement('span');
        status.className = 'coop-slot-state';
        status.textContent = pilot
          ? (pilot.ready ? 'READY' : 'HANGAR') + (pilot.id === this.hostId ? ' · HOST' : '')
          : '—';
        row.append(number, main, status);
        $('coopRoster').append(row);
      }
    }
  }
  async connect(asHost) {
    if (this.connecting || this.mode !== 'offline') return;
    let code = $('coopCodeInput').value.toUpperCase().trim();
    if (!asHost) {
      try {
        if (code.includes('://'))
          code =
            new URLSearchParams(new URL($('coopCodeInput').value).hash.slice(1)).get('room') || '';
      } catch (_) {}
      code = code.replace(/[^A-Z2-9]/g, '');
      if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
        this.message('Enter the eight-character room code from your host.', true);
        return;
      }
    }
    const signal = $('coopSignal').value.trim();
    let url;
    try {
      url = new URL(signal);
      if (!['ws:', 'wss:'].includes(url.protocol)) throw Error();
    } catch (_) {
      this.message('Enter a valid ws:// or wss:// signal server address.', true);
      return;
    }
    if (location.protocol === 'https:' && url.protocol !== 'wss:') {
      this.message('This secure page needs a wss:// signal server.', true);
      return;
    }
    const turn = $('coopTurn').value.trim();
    if (turn && !/^turns?:[^\s]+$/i.test(turn)) {
      this.message('The TURN address must start with turn: or turns:.', true);
      return;
    }
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    if (asHost) {
      const bytes = crypto.getRandomValues(new Uint8Array(8));
      code = [...bytes].map((b) => chars[b % chars.length]).join('');
    }
    const ice = [
      { urls: 'stun:stun.l.google.com:19302' },
      {
        urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'],
        username: 'peerjs',
        credential: 'peerjsp',
      },
    ];
    if (turn)
      ice.push({
        urls: turn,
        username: $('coopTurnUser').value.trim(),
        credential: $('coopTurnPass').value,
      });
    this.connecting = true;
    this.room = code;
    this.hostId = 'rw4-' + code;
    this.id = asHost
      ? this.hostId
      : 'rw4c-' +
        [...crypto.getRandomValues(new Uint8Array(10))]
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('');
    this.paint();
    sound.init();
    this.message(asHost ? 'Creating the room…' : 'Finding the host…');
    const Transport = $('coopTransport').value === 'relay' ? LanceRelayTransport : LanceTransport;
    const transport = (this.transport = new Transport({
      id: this.id,
      signal,
      iceServers: ice,
      relayOnly: $('coopForceRelay').checked,
      onSignal: (online) => {
        if (!online && this.mode !== 'offline')
          this.message(
            'Signal server disconnected. Existing data links can continue. New pilots cannot join until it returns.',
            true,
          );
      },
      onChannel: (l) => this.channel(l),
      onError: (m) => this.connectionError(m),
      onClose: (id, wasOpen) => this.disconnected(id, wasOpen),
    }));
    try {
      await transport.open();
      if (this.transport !== transport) return;
      if (asHost) {
        this.mode = 'host';
        this.members.set(this.id, {
          id: this.id,
          slot: 0,
          ...this.profile(),
          ready: false,
          bootReady: false,
        });
        G.difficulty = $('coopDifficulty').value;
        this.connecting = false;
        this.message('Room open. Share the code, then select READY.');
        this.paint();
      } else {
        this.message('Host found. Opening the data connection…');
        await transport.connect(this.hostId);
      }
    } catch (e) {
      if (this.transport === transport) {
        transport.close();
        this.transport = null;
        this.connecting = false;
        this.mode = 'offline';
        this.message(e.message, true);
        this.paint();
      }
    }
  }
  connectionError(message) {
    this.message(message, true);
    if (this.mode === 'offline') {
      this.connecting = false;
      this.transport?.close();
      this.transport = null;
      this.paint();
    }
  }
  sendHost(packet, essential = true) {
    return this.transport?.send(this.hostId, packet, essential);
  }
  broadcast(packet, essential = true) {
    for (const id of this.members.keys())
      if (id !== this.id) this.transport?.send(id, packet, essential);
  }
  channel(link) {
    const sourceTransport = this.transport;
    if (this.host) {
      if (this.active || this.members.size >= 4) {
        this.transport.send(
          link.id,
          {
            t: 'reject',
            reason: this.active
              ? 'This mission has started. Join after the host opens a new room.'
              : 'This room already has four pilots.',
          },
          true,
        );
        setTimeout(() => this.transport?.drop(link.id), 150);
        return;
      }
      link.onData = (m) => {
        if (this.transport === sourceTransport) this.receiveHost(link, m);
      };
      link.handshake = setTimeout(() => {
        if (!this.members.has(link.id)) this.transport?.drop(link.id);
      }, 6000);
    } else {
      if (link.id !== this.hostId) {
        this.transport?.drop(link.id);
        return;
      }
      link.onData = (m) => {
        if (this.transport === sourceTransport) this.receiveGuest(m);
      };
      this.transport.send(link.id, { t: 'hello', v: COOP_PROTOCOL, ...this.profile() }, true);
    }
  }
  receiveHost(link, m) {
    if (m.t === 'ping') {
      this.transport.send(link.id, { t: 'pong', at: m.at }, true);
      return;
    }
    if (m.t === 'pong') {
      link.rtt = clamp(performance.now() - m.at, 0, 9999);
      return;
    }
    if (m.t === 'hello') {
      if (this.members.has(link.id)) return;
      if (m.v !== COOP_PROTOCOL || this.active || this.members.size >= 4) {
        this.transport.send(
          link.id,
          {
            t: 'reject',
            reason:
              m.v !== COOP_PROTOCOL
                ? 'Game versions differ. Use the same RobotWarrior co-op HTML file.'
                : this.active
                  ? 'The mission has started.'
                  : 'The room is full.',
          },
          true,
        );
        setTimeout(() => this.transport?.drop(link.id), 150);
        return;
      }
      clearTimeout(link.handshake);
      const used = new Set([...this.members.values()].map((r) => r.slot));
      let slot = 0;
      while (used.has(slot)) slot++;
      this.members.set(link.id, {
        id: link.id,
        slot,
        name: coopName(m.name),
        chassis: chassisSpecs[m.chassis] ? m.chassis : 'warden',
        loadout: config[m.loadout] ? m.loadout : 'balanced',
        ready: false,
        bootReady: false,
        queue: [],
        ack: 0,
        credit: 0,
        intent: null,
      });
      this.lobbyBroadcast();
      this.message('Pilot linked. All pilots must select READY.');
      return;
    }
    const r = this.members.get(link.id);
    if (!r) return;
    if (m.t === 'leave') {
      this.transport.drop(link.id);
      return;
    }
    if (m.t === 'profile' && !this.active) {
      Object.assign(r, {
        name: coopName(m.name),
        chassis: chassisSpecs[m.chassis] ? m.chassis : r.chassis,
        loadout: config[m.loadout] ? m.loadout : r.loadout,
        ready: false,
      });
      this.lobbyBroadcast();
      return;
    }
    if (m.t === 'ready' && !this.active) {
      r.ready = !!m.value;
      this.lobbyBroadcast();
      return;
    }
    if (m.t === 'bootReady' && m.session === this.session) {
      r.bootReady = true;
      return;
    }
    if (m.t === 'input' && m.session === this.session && G.state === 'playing' && !this.held) {
      const x = this.validateInput(m.input);
      if (!x || x.seq <= (r.lastReceived || 0) || x.seq > (r.lastReceived || 0) + 240) return;
      r.lastReceived = x.seq;
      if (r.queue.length >= 120) {
        this.transport.drop(link.id);
        return;
      }
      r.queue.push(x);
    }
  }
  receiveGuest(m) {
    if (m.t === 'ping') {
      this.sendHost({ t: 'pong', at: m.at });
      return;
    }
    if (m.t === 'pong') {
      const l = this.transport?.links.get(this.hostId);
      if (l) l.rtt = clamp(performance.now() - m.at, 0, 9999);
      return;
    }
    if (m.t === 'reject' || m.t === 'closed') {
      const message = m.reason || 'The host closed this room.';
      this.leave(false);
      this.show();
      this.message(message, true);
      return;
    }
    if (m.t === 'lobby' && m.v === COOP_PROTOCOL && !this.active) {
      if (
        !Array.isArray(m.members) ||
        m.members.length > 4 ||
        !m.members.some((r) => r.id === this.id)
      )
        return;
      this.mode = 'guest';
      this.connecting = false;
      this.members = new Map(m.members.map((r) => [r.id, r]));
      G.difficulty = m.difficulty;
      $('coopDifficulty').value = G.difficulty;
      this.message('Connected. Select READY when your mech is set.');
      this.paint();
      return;
    }
    if (
      m.t === 'start' &&
      m.v === COOP_PROTOCOL &&
      Array.isArray(m.members) &&
      m.members.length <= 4
    ) {
      this.begin(m);
      return;
    }
    if (m.session !== this.session) return;
    if (m.t === 'go' && G.state === 'boot') {
      this.go();
      return;
    }
    if (m.t === 'hold') {
      this.held = !!m.value;
      if (this.held) {
        this.accumulator = 0;
        this.notice('HOST PAUSED', 'The host must return to the game to continue.');
      } else this.hideNotice();
      sound.update();
      return;
    }
    if (m.t === 'snapshot') {
      this.applySnapshot(m);
      return;
    }
    if (m.t === 'finish') {
      this.receiving = true;
      G.score = m.score;
      G.kills = m.kills;
      finishSoloMission(!!m.won);
      $('resultScore').textContent = G.score.toLocaleString();
      this.receiving = false;
      this.configureResult();
      this.hideNotice();
      return;
    }
    if (m.t === 'roster') {
      const keep = new Set(m.ids || []);
      for (const id of this.members.keys()) if (!keep.has(id)) this.members.delete(id);
      announce(m.message || 'A pilot left the mission.', null, 6);
      return;
    }
  }
  lobbyBroadcast() {
    const list = [...this.members.values()].map(({ id, slot, name, chassis, loadout, ready }) => ({
      id,
      slot,
      name,
      chassis,
      loadout,
      ready,
    }));
    this.broadcast({ t: 'lobby', v: COOP_PROTOCOL, difficulty: G.difficulty, members: list });
    this.paint();
  }
  ready() {
    if (this.active || this.mode === 'offline') return;
    sound.init();
    const r = this.members.get(this.id);
    if (!r) return;
    if (this.host) {
      r.ready = !r.ready;
      this.lobbyBroadcast();
    } else this.sendHost({ t: 'ready', value: !r.ready });
  }
  startRequested() {
    if (this.mode === 'offline') {
      soloStartMission();
      return;
    }
    if (!this.host) {
      toast('The host starts or restarts the mission.');
      return;
    }
    if (!this.active && ![...this.members.values()].every((r) => r.ready)) {
      this.show();
      this.message('Each pilot must select READY before deployment.', true);
      return;
    }
    const packet = {
      t: 'start',
      v: COOP_PROTOCOL,
      session: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
      difficulty: G.difficulty,
      members: [...this.members.values()].map(({ id, slot, name, chassis, loadout }) => ({
        id,
        slot,
        name,
        chassis,
        loadout,
      })),
    };
    this.broadcast(packet);
    this.begin(packet);
    requestCapture();
  }
  capture() {
    return {
      p: G.player,
      chassis: G.chassis,
      loadout: G.loadout,
      weapons: G.weapons,
      target: G.target,
      lock: G.lock,
      lockSpoken: G.lockSpoken,
      weaponIndex: G.weaponIndex,
      serviceTime: G.serviceTime,
      serviceUsed: G.serviceUsed,
      supplyTime: G.supplyTime,
      supplyUsed: G.supplyUsed,
    };
  }
  restore(c) {
    G.player = c.p;
    G.chassis = c.chassis;
    G.loadout = c.loadout;
    G.weapons = c.weapons;
    G.target = c.target;
    G.lock = c.lock;
    G.lockSpoken = c.lockSpoken;
    G.weaponIndex = c.weaponIndex;
    G.serviceTime = c.serviceTime;
    G.serviceUsed = c.serviceUsed;
    G.supplyTime = c.supplyTime;
    G.supplyUsed = c.supplyUsed;
  }
  withPilot(r, fn) {
    if (!r || r.id === this.id) return fn();
    const saved = this.capture(),
      prior = this.executing;
    if (!prior && this.members.has(this.id)) this.members.get(this.id).sim = saved;
    this.restore(r.sim);
    this.executing = r.id;
    try {
      return fn();
    } finally {
      r.sim = this.capture();
      this.restore(saved);
      this.executing = prior;
    }
  }
  makeSimulation(r) {
    const saved = this.capture();
    G.chassis = r.chassis;
    G.loadout = r.loadout;
    G.weapons = G.weapons.map((w) => ({ ...w }));
    applyChassisWeapons();
    G.player = newPlayer();
    const spots = [
        [0, 92],
        [-26, 119],
        [26, 119],
        [0, 151],
      ],
      s = spots[r.slot] || spots[0];
    G.player.x = s[0];
    G.player.z = s[1];
    G.player.y = terrainY(G.player.x, G.player.z);
    G.target = null;
    G.lock = 0;
    G.lockSpoken = false;
    G.weaponIndex = 0;
    G.serviceTime = 0;
    G.serviceUsed = false;
    G.supplyTime = 0;
    G.supplyUsed = false;
    const sim = this.capture();
    this.restore(saved);
    return sim;
  }
  begin(packet) {
    this.session = packet.session;
    this.sessionStarted = true;
    this.crewSize = packet.members.length;
    G.difficulty = packet.difficulty;
    this.members = new Map(
      packet.members.map((r) => [
        r.id,
        {
          ...r,
          ready: true,
          bootReady: false,
          queue: [],
          ack: 0,
          lastReceived: 0,
          credit: 0,
          intent: null,
          revive: 0,
        },
      ]),
    );
    const mine = this.members.get(this.id);
    if (!mine) {
      this.leave(false);
      return;
    }
    G.chassis = mine.chassis;
    G.loadout = mine.loadout;
    resetGame();
    for (const r of this.members.values()) r.sim = this.makeSimulation(r);
    this.restore(mine.sim);
    delete this.pendingFinish;
    this.history = [];
    this.actions = [];
    this.seq = 0;
    this.snapshotId = 0;
    this.lastSnapshot = 0;
    this.events = [];
    this.eventId = 0;
    this.lastEvent = 0;
    this.projectileId = 0;
    this.localMenu = false;
    this.held = false;
    this.localBootDone = false;
    this.cameraError = [0, 0, 0];
    this.lastSnapshotAt = performance.now();
    this.accumulator = 0;
    this.snapClock = 0;
    this.startedAt = performance.now();
    hideOverlays();
    $('menu').hidden = true;
    this.hideNotice();
    G.state = 'boot';
    G.bootTime = 0;
    G.bootStep = -1;
    sound.init();
    sound.update();
    $('restartBtn').disabled = !this.host;
    $('restartBtn').textContent = this.host ? 'RESTART LANCE MISSION' : 'HOST CONTROLS RESTART';
    $('quitBtn').textContent = this.host ? 'CLOSE ROOM AND LEAVE' : 'LEAVE CO-OP';
    $('pause').querySelector('.pause-head h2').textContent = 'MISSION IS LIVE.';
    $('pause').querySelector('.panel-header span').textContent = 'LOCAL MENU / CO-OP CONTINUES';
  }
  go() {
    G.state = 'playing';
    this.accumulator = 0;
    this.hideNotice();
    announce(
      'LANCE CONTROL / Clear all three sectors. Stay together. Hold J to restore a downed teammate.',
      'insertion',
      10,
    );
    if (!document.pointerLockElement) toast('Click the cockpit to capture the mouse. [H] Help.', 5);
  }
  boot(dt) {
    if (this.held) return;
    const startup = sound.bootStatus();
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
    if (!this.localBootDone && (startup.ended || G.bootTime >= startup.duration)) {
      this.localBootDone = true;
      this.members.get(this.id).bootReady = true;
      if (this.guest) this.sendHost({ t: 'bootReady', session: this.session });
      this.notice('SYSTEMS ONLINE', 'Waiting for all pilots to complete startup.');
    }
    if (this.host && this.localBootDone && [...this.members.values()].every((r) => r.bootReady)) {
      this.broadcast({ t: 'go', session: this.session });
      this.go();
    }
  }
  validateInput(x) {
    if (!x || !Number.isInteger(x.seq) || x.seq < 1) return null;
    const k = {};
    for (const code of COOP_KEYS) if (x.keys?.[code] === true) k[code] = true;
    return {
      seq: x.seq,
      keys: k,
      fire: x.fire === true,
      throttle: coopNumber(x.throttle, -0.45, 1),
      torso: coopNumber(x.torso, -1.68, 1.68),
      pitch: coopNumber(x.pitch, -0.62, 0.6),
      align: x.align === true,
      center: x.center === true,
      weapon: Math.floor(coopNumber(x.weapon, 0, 2)),
      target: Number.isInteger(x.target) ? x.target : 0,
      actions: Array.isArray(x.actions) ? x.actions.filter((a) => a === 'coolant').slice(0, 1) : [],
    };
  }
  sampleInput() {
    const halted = this.localMenu || !G.player.alive,
      k = {};
    if (!halted) for (const code of COOP_KEYS) if (G.keys[code]) k[code] = true;
    return {
      seq: ++this.seq,
      keys: k,
      fire: !halted && G.mouse.down,
      throttle: halted ? 0 : G.player.throttle,
      torso: G.player.torso,
      pitch: G.player.pitch,
      align: !halted && G.player.align,
      center: !halted && G.player.centerTorso,
      weapon: G.weaponIndex,
      target: G.target?.id || 0,
      actions: halted ? [] : this.actions.splice(0),
    };
  }
  stepInput(r, input, replay = false) {
    const oldKeys = G.keys,
      oldMouse = G.mouse,
      oldStep = this.inStep,
      oldReplay = this.replaying;
    this.inStep = true;
    this.replaying = replay;
    try {
      G.keys = input.keys;
      G.mouse = { down: input.fire, drag: false };
      G.player.throttle = input.throttle;
      G.player.torso = input.torso;
      G.player.pitch = input.pitch;
      G.player.align = input.align;
      G.player.centerTorso = input.center;
      G.weaponIndex = input.weapon;
      const wanted = pools.entities.find((e) => e.id === input.target && e.alive) || null;
      if (G.target !== wanted) {
        G.target = wanted;
        G.lock = 0;
        G.lockSpoken = false;
      }
      if (G.player.alive) {
        for (const a of input.actions) if (a === 'coolant') soloCoolant();
        updatePlayer(COOP_STEP);
      } else {
        G.player.speed = 0;
        G.player.throttle = 0;
      }
      r.intent = input;
      r.ack = input.seq;
    } finally {
      G.keys = oldKeys;
      G.mouse = oldMouse;
      this.inStep = oldStep;
      this.replaying = oldReplay;
    }
  }
  updatePilots(dt) {
    const local = this.members.get(this.id),
      input = this.sampleInput();
    this.stepInput(local, input);
    for (const r of this.members.values())
      if (r.id !== this.id) {
        r.credit = Math.min(0.35, r.credit + dt);
        let steps = 0;
        while (r.queue.length && r.credit >= COOP_STEP - 0.000001 && steps++ < 8) {
          const next = r.queue.shift();
          this.withPilot(r, () => this.stepInput(r, next));
          r.credit -= COOP_STEP;
        }
      }
    this.updateRevives(dt);
  }
  frame(dt) {
    this.cameraError = this.cameraError.map((x) => x * Math.exp(-dt * 13));
    if (G.state === 'boot') {
      this.boot(dt);
      return;
    }
    if (G.state !== 'playing' || this.held) return;
    this.accumulator = Math.min(0.2, this.accumulator + dt);
    while (this.accumulator >= COOP_STEP && G.state === 'playing') {
      this.accumulator -= COOP_STEP;
      if (this.host) {
        updateMission(COOP_STEP);
        if (this.pendingFinish !== undefined) {
          const won = this.pendingFinish;
          delete this.pendingFinish;
          this.finish(won);
        }
      } else {
        const r = this.members.get(this.id);
        const input = this.sampleInput();
        this.history.push(input);
        if (this.history.length > 160) {
          this.history.splice(0, this.history.length - 160);
          this.notice(
            'LINK DELAY',
            'Waiting for the host. Your controls will recover when the link returns.',
          );
        }
        this.sendHost({ t: 'input', session: this.session, input }, false);
        this.stepInput(r, input);
        this.visualProjectiles(COOP_STEP);
      }
    }
    if (this.host) {
      this.snapClock += dt;
      if (this.snapClock >= 0.1) {
        this.snapClock %= 0.1;
        this.sendSnapshot();
      }
    } else this.interpolate(dt);
    if (this.held) this.notice('HOST PAUSED', 'The host must return to the game to continue.');
    else if (!G.player.alive)
      this.notice(
        'MECH DISABLED',
        'A teammate must stop within 32 meters and hold J for 6 seconds.',
      );
    else if (this.guest && performance.now() - this.lastSnapshotAt > 2500)
      this.notice(
        'HOST LINK DELAY',
        'Waiting for mission data. Check that the host has the game open.',
      );
    else this.hideNotice();
  }
  nearestPilot(e) {
    let best = null,
      distance = Infinity;
    for (const r of this.living()) {
      const p = this.playerOf(r),
        d = dist2(p, e);
      if (d < distance) {
        best = r;
        distance = d;
      }
    }
    return best;
  }
  downCurrent() {
    const r = this.currentRecord();
    if (r) {
      r.revive = 0;
      r.downAt = G.missionTime;
      announce('LANCE / ' + r.name + ' is down. Hold J nearby to restore the mech.', null, 9);
    }
    if (this.living().length === 0) endMission(false);
  }
  updateRevives(dt) {
    for (const fallen of this.members.values()) {
      const p = this.playerOf(fallen);
      if (p.alive) {
        fallen.revive = 0;
        continue;
      }
      const helper = this.living().find((r) => {
        const q = this.playerOf(r);
        return (
          r.id !== fallen.id &&
          r.intent?.keys.KeyJ &&
          dist2(q, p) < 32 &&
          q.altitude < 3 &&
          Math.abs(q.speed) < 2.2 &&
          q.shutdown <= 0
        );
      });
      fallen.revive = helper
        ? Math.min(6, (fallen.revive || 0) + dt)
        : Math.max(0, (fallen.revive || 0) - dt * 0.5);
      if (fallen.revive >= 6) {
        this.withPilot(fallen, () => {
          for (const [k, c] of Object.entries(G.player.components))
            c.hp = Math.max(c.hp, c.max * (k === 'core' ? 0.45 : 0.3));
          G.player.alive = true;
          G.player.speed = 0;
          G.player.throttle = 0;
          G.player.heat = 20;
          G.player.shutdown = 0;
          G.player.armorWarning = false;
          G.player.heatWarning = false;
        });
        fallen.revive = 0;
        announce(
          'LANCE / ' +
            fallen.name +
            ' restored. Repair supplies remain available at the field bays.',
          null,
          8,
        );
      }
    }
  }
  repairAll(dt) {
    for (const r of this.members.values())
      if (this.playerOf(r).alive) this.withPilot(r, () => updateRepairBays(dt));
  }
  projectileHit(p, dir, len) {
    const cover = coverDistance(p.p, dir, len);
    let hit = null,
      near = Math.min(len + 1, cover);
    for (const r of this.living()) {
      const q = this.playerOf(r),
        eye = [q.x, q.y + q.altitude + chassisSpecs[r.chassis].eye, q.z],
        t = raySphere(p.p, dir, eye, chassisSpecs[r.chassis].radius, len + 1);
      if (t < near) {
        near = t;
        hit = r;
      }
    }
    if (hit) {
      p.hit = true;
      this.withPilot(hit, () => damagePlayer(p.damage, p));
      return;
    }
    if (cover < len - 0.5) {
      p.hit = true;
      burst(vadd(p.p, vmul(dir, cover)), p.color, 7, 4);
    }
  }
  visualProjectiles(dt) {
    for (let i = pools.projectiles.length - 1; i >= 0; i--) {
      const p = pools.projectiles[i];
      p.life -= dt;
      p.p = vadd(p.p, vmul(p.v, dt));
      if (p.life <= 0) pools.projectiles.splice(i, 1);
    }
  }
  emit(event) {
    if (this.host && this.active && !this.replaying) {
      this.events.push({ ...event, id: ++this.eventId });
      if (this.events.length > 160) this.events.shift();
    }
  }
  snapshotPlayer(r) {
    const c = r.id === this.id ? this.capture() : r.sim;
    return {
      id: r.id,
      p: c.p,
      ack: r.ack || 0,
      cd: c.weapons.map((w) => w.remaining),
      target: c.target?.id || 0,
      lock: c.lock,
      lockSpoken: c.lockSpoken,
      weapon: c.weaponIndex,
      repair: [c.serviceTime, c.serviceUsed, c.supplyTime, c.supplyUsed],
      revive: r.revive || 0,
    };
  }
  snapshotEntity(e) {
    return {
      id: e.id,
      type: e.type,
      class: e.class,
      name: e.name,
      zone: e.zone,
      x: e.x,
      y: e.y,
      z: e.z,
      yaw: e.yaw,
      scale: e.scale,
      alive: e.alive,
      hp: e.hp,
      maxHP: e.maxHP,
      components: e.components,
      phase: e.phase,
      speed: e.speed,
      deathTime: e.deathTime,
      hitFlash: e.hitFlash,
      skyguard: e.skyguard,
      commander: e.commander,
      assaultLink: e.assaultLink,
    };
  }
  sendSnapshot() {
    if (!this.host || !this.active) return;
    const packet = {
      t: 'snapshot',
      session: this.session,
      n: ++this.snapshotId,
      time: G.missionTime,
      stage: G.missionStage,
      flags: G.missionFlags,
      nav: G.navIndex,
      kills: G.kills,
      score: G.score,
      shotsFired: G.shotsFired,
      shotsHit: G.shotsHit,
      extractTime: G.extractTime,
      transportTime: G.transportTime,
      reinforcements: G.reinforcements,
      link: [G.linkTime, G.linkWave, G.linkStatus, G.linkBlocked],
      banner: G.sectorBanner,
      players: [...this.members.values()].map((r) => this.snapshotPlayer(r)),
      entities: pools.entities.map((e) => this.snapshotEntity(e)),
      projectiles: pools.projectiles
        .slice(-100)
        .map((p) => ({
          id: p.netId || (p.netId = ++this.projectileId),
          p: p.p,
          v: p.v,
          type: p.type,
          friendly: p.friendly,
          life: p.life,
          color: p.color,
        })),
      events: this.events.slice(-80),
    };
    this.broadcast(packet, false);
    this.events = [];
  }
  applySnapshot(m) {
    if (
      !this.guest ||
      !this.active ||
      !Number.isInteger(m.n) ||
      m.n <= this.lastSnapshot ||
      !Array.isArray(m.players) ||
      !Array.isArray(m.entities) ||
      m.entities.length > 120
    )
      return;
    this.lastSnapshot = m.n;
    this.lastSnapshotAt = performance.now();
    G.missionTime = m.time;
    G.missionStage = m.stage;
    G.missionFlags = m.flags.slice(0, 8);
    G.navIndex = m.nav;
    G.kills = m.kills;
    G.score = m.score;
    G.shotsFired = m.shotsFired;
    G.shotsHit = m.shotsHit;
    G.extractTime = m.extractTime;
    G.transportTime = m.transportTime;
    G.reinforcements = m.reinforcements;
    [G.linkTime, G.linkWave, G.linkStatus, G.linkBlocked] = m.link;
    G.sectorBanner = m.banner;
    this.receiving = true;
    try {
      for (const item of m.entities) {
        let e = pools.entities.find((x) => x.id === item.id);
        const first = !e;
        if (!e && item.type === 'mech') {
          e = makeMech(item.x, item.z, item.name, item.class);
          e.id = item.id;
          pools.entityID = Math.max(pools.entityID, e.id);
        }
        if (!e) continue;
        const old = { x: e.x, y: e.y, z: e.z, yaw: e.yaw },
          wasAlive = e.alive;
        Object.assign(e, item);
        if (e.type === 'mech') {
          e.model = enemyModels[e.class] || enemyModels.medium;
          if (e.commander) e.model = enemyModels.heavy;
        }
        if (!first && ['mech', 'turret'].includes(e.type)) {
          e.netTo = { x: item.x, y: item.y, z: item.z, yaw: item.yaw };
          Object.assign(e, old);
        }
        if (wasAlive && !e.alive) {
          burst(center(e), hex('#ffac56'), 35, 20);
          sound.fxPlay('explosion', clamp(1 - dist2(G.player, e) / 1200, 0.1, 0.8));
        }
      }
      for (const data of m.players) {
        const r = this.members.get(data.id);
        if (!r) continue;
        r.revive = data.revive;
        r.p = data.p;
        r.repair = data.repair;
        if (data.id !== this.id) {
          r.netTo = data.p;
          if (!r.view) r.view = coopCopy(data.p);
          continue;
        }
        const oldPosition = [G.player.x, G.player.y + G.player.altitude, G.player.z],
          look = {
            throttle: G.player.throttle,
            align: G.player.align,
            centerTorso: G.player.centerTorso,
            torso: G.player.torso,
            pitch: G.player.pitch,
            imaging: G.player.imaging,
            vision: G.player.vision,
            target: G.target?.id,
            weapon: G.weaponIndex,
          },
          oldArmor = playerArmor();
        this.history = this.history.filter((x) => x.seq > data.ack);
        G.player = coopCopy(data.p);
        for (let i = 0; i < 3; i++) G.weapons[i].remaining = data.cd[i];
        G.target = pools.entities.find((x) => x.id === data.target) || null;
        G.lock = data.lock;
        G.lockSpoken = data.lockSpoken;
        G.weaponIndex = data.weapon;
        [G.serviceTime, G.serviceUsed, G.supplyTime, G.supplyUsed] = data.repair;
        for (const input of this.history) this.stepInput(r, input, true);
        G.player.throttle = G.player.alive && !this.localMenu ? look.throttle : 0;
        G.player.align = look.align;
        G.player.centerTorso = look.centerTorso;
        G.player.torso = look.torso;
        G.player.pitch = look.pitch;
        G.player.imaging = look.imaging;
        G.player.vision = look.vision;
        G.weaponIndex = look.weapon;
        if (look.target !== G.target?.id) {
          G.target = pools.entities.find((e) => e.id === look.target && e.alive) || null;
          G.lock = 0;
          G.lockSpoken = false;
        }
        const nowPosition = [G.player.x, G.player.y + G.player.altitude, G.player.z];
        for (let i = 0; i < 3; i++)
          this.cameraError[i] = clamp(
            this.cameraError[i] + oldPosition[i] - nowPosition[i],
            -12,
            12,
          );
        if (playerArmor() < oldArmor - 0.0001) {
          G.damageFlash = Math.min(0.5, G.damageFlash + 0.18);
          G.shakePower = Math.max(G.shakePower, 0.18);
          sound.fxPlay('hit', 0.6);
        }
      }
      pools.projectiles = m.projectiles.map((p) => ({ ...p, prev: p.p.slice(), net: true }));
      for (const ev of m.events || []) {
        if (ev.id <= this.lastEvent) continue;
        this.lastEvent = ev.id;
        if (ev.kind === 'beam' && ev.owner !== this.id)
          spawnBeam(ev.a, ev.b, ev.c, ev.width, ev.life);
        if (ev.kind === 'radio') {
          G.radio.push({ text: ev.text, time: ev.duration, max: ev.duration });
          if (G.radio.length > 3) G.radio.shift();
          if (ev.voice) sound.say(ev.voice, true);
        }
        if (ev.kind === 'shot' && ev.owner !== this.id)
          sound.fxPlay(ev.sound, clamp(1 - dist2(G.player, ev) / 1000, 0.02, 0.7));
      }
    } finally {
      this.receiving = false;
    }
  }
  interpolate(dt) {
    const t = 1 - Math.exp(-dt * 17);
    for (const e of pools.entities)
      if (e.netTo) {
        e.x = mix(e.x, e.netTo.x, t);
        e.y = mix(e.y, e.netTo.y, t);
        e.z = mix(e.z, e.netTo.z, t);
        e.yaw += wrap(e.netTo.yaw - e.yaw) * t;
      }
    for (const r of this.members.values())
      if (r.id !== this.id && r.netTo) {
        const p = r.netTo,
          v = r.view || (r.view = coopCopy(p));
        for (const k of ['x', 'y', 'z', 'altitude', 'torso', 'pitch', 'speed', 'phase'])
          v[k] = mix(v[k] || 0, p[k] || 0, t);
        v.yaw += wrap(p.yaw - v.yaw) * t;
        v.alive = p.alive;
        v.components = p.components;
      }
  }
  pauseLocal() {
    if (!['playing', 'boot'].includes(G.state)) return;
    this.localMenu = true;
    for (const k in G.keys) delete G.keys[k];
    G.mouse.down = false;
    G.mouse.drag = false;
    G.player.throttle = 0;
    this.actions = [];
    $('pause').hidden = false;
    $('pause').querySelector('.pause-head h2').textContent = this.held
      ? 'LANCE ON HOLD.'
      : 'MISSION IS LIVE.';
    $('pause').querySelector('.panel-header span').textContent = this.held
      ? 'HOST ON HOLD / ALL PILOTS PAUSED'
      : 'LOCAL MENU / CO-OP CONTINUES';
    document.exitPointerLock?.();
    if (this.host && document.hidden) {
      this.held = true;
      this.broadcast({ t: 'hold', session: this.session, value: true });
      $('pause').querySelector('.pause-head h2').textContent = 'LANCE ON HOLD.';
      $('pause').querySelector('.panel-header span').textContent =
        'HOST TAB HIDDEN / ALL PILOTS PAUSED';
    }
    sound.update();
  }
  resumeLocal() {
    this.localMenu = false;
    hideOverlays();
    if (this.host && this.held) {
      this.held = false;
      this.broadcast({ t: 'hold', session: this.session, value: false });
      this.accumulator = 0;
    }
    sound.ctx?.resume().catch(() => {});
    this.hideNotice();
    requestCapture();
  }
  finish(won) {
    if (this.guest && !this.receiving) return;
    if (['won', 'lost'].includes(G.state)) return;
    this.sendSnapshot();
    finishSoloMission(won);
    this.configureResult();
    this.hideNotice();
    this.localMenu = false;
    this.held = false;
    if (this.host)
      this.broadcast({ t: 'finish', session: this.session, won, score: G.score, kills: G.kills });
  }
  configureResult() {
    $('againBtn').disabled = !this.host;
    $('againBtn').textContent = this.host ? 'DEPLOY LANCE AGAIN' : 'WAITING FOR THE HOST';
    $('resultMenu').textContent = this.host ? 'CLOSE ROOM' : 'LEAVE ROOM';
    $('resultCode').textContent = 'LANCE DEBRIEF / ' + this.members.size + ' PILOTS';
    $('resultDetail').textContent += ' · Shared team score · Friendly fire off';
  }
  heartbeat() {
    if (this.mode === 'offline') return;
    const now = performance.now();
    for (const l of this.transport?.links.values() || []) {
      if (!l.open) continue;
      if (now - l.lastSeen > (this.held ? 180000 : 18000)) {
        this.transport.drop(l.id);
        continue;
      }
      this.transport.send(l.id, { t: 'ping', at: now }, true);
      if (Math.random() < 0.1) this.transport.inspectRoute(l);
    }
    if (this.active && this.host && G.state === 'boot' && now - this.startedAt > 70000) {
      for (const r of [...this.members.values()])
        if (r.id !== this.id && !r.bootReady) this.transport?.drop(r.id);
    }
  }
  disconnected(id, wasOpen) {
    if (this.suppressClose || this.mode === 'offline') return;
    if (this.host) {
      const r = this.members.get(id);
      if (!r) return;
      this.members.delete(id);
      if (this.active) {
        this.broadcast({
          t: 'roster',
          session: this.session,
          ids: [...this.members.keys()],
          message: r.name + ' left the mission.',
        });
        announce('LANCE / ' + r.name + ' disconnected. Remaining pilots can continue.', null, 8);
        if (this.living().length === 0 && G.state === 'playing') endMission(false);
      } else this.lobbyBroadcast();
    } else if (id === this.hostId) {
      this.leave(false);
      this.show();
      this.message(
        'Connection to the host was lost. The mission ended. Create or join a new room.',
        true,
      );
    }
  }
  leave(send = true) {
    if (send && this.transport) {
      if (this.host) this.broadcast({ t: 'closed', reason: 'The host closed this room.' });
      else this.sendHost({ t: 'leave' });
    }
    const transport = this.transport;
    this.transport = null;
    this.suppressClose = true;
    setTimeout(() => transport?.close(), 70);
    this.mode = 'offline';
    this.connecting = false;
    this.sessionStarted = false;
    this.members.clear();
    this.history = [];
    this.actions = [];
    this.room = '';
    this.held = false;
    this.localMenu = false;
    this.suppressClose = false;
    this.hideNotice();
    soloReturnMenu();
    $('coopLobby').hidden = true;
    $('restartBtn').disabled = false;
    $('restartBtn').textContent = 'RESTART MISSION';
    $('quitBtn').textContent = 'RETURN TO OPERATIONS';
    $('againBtn').disabled = false;
    $('againBtn').textContent = 'DEPLOY AGAIN';
    $('resultMenu').textContent = 'OPERATIONS';
    $('pause').querySelector('.pause-head h2').textContent = 'HOLD POSITION.';
    $('pause').querySelector('.panel-header span').textContent = 'COMBAT SYSTEM / PAUSED';
    this.paint();
  }
  status() {
    return {
      mode: this.mode,
      room: this.room,
      id: this.id,
      hostId: this.hostId,
      session: this.session,
      started: this.sessionStarted,
      players: [...this.members.values()].map((r) => ({
        id: r.id,
        name: r.name,
        slot: r.slot,
        chassis: r.chassis,
        loadout: r.loadout,
        ready: r.ready,
        bootReady: r.bootReady,
        alive: this.playerOf(r)?.alive,
        position: this.playerOf(r) ? { x: this.playerOf(r).x, z: this.playerOf(r).z } : null,
        ack: r.ack || 0,
        revive: r.revive || 0,
      })),
      links: [...(this.transport?.links.values() || [])].map((l) => ({
        id: l.id,
        open: l.open,
        route: l.route,
        ping: Math.round(l.rtt),
        buffered: l.dc?.bufferedAmount || 0,
        bytesIn: l.bytesIn,
        bytesOut: l.bytesOut,
      })),
      snapshot: this.lastSnapshot,
      history: this.history.length,
      held: this.held,
      localMenu: this.localMenu,
      error: this.error,
    };
  }
}
