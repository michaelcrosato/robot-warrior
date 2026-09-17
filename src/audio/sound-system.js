/**
 * Procedural weapon and cockpit audio, plus radio speech.
 */
import { G } from '../sim/state.js';
import { MissionSoundtrack, SOUNDTRACK_INFO } from './soundtrack.js';
import { VOICE_CLIPS, voiceUrl } from '../data/audio-manifest.js';
import { pausedFrom } from '../sim/player.js';
import { settings } from '../core/settings.js';

class SoundSystem {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.lastVoice = {};
    this.voiceSource = null;
    this.muted = false;
    this.active = false;
    this.lastVoiceAt = -10;
    this.voiceUntil = 0;
    this.soundtrack = null;
  }
  async init() {
    if (this.ctx) {
      this.ctx.resume().catch(() => {});
      this.active = true;
      return;
    }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : settings.volume;
      this.master.connect(c.destination);
      this.fx = c.createGain();
      this.fx.gain.value = 0.7;
      this.fx.connect(this.master);
      this.music = c.createGain();
      this.music.gain.value = settings.music;
      this.music.connect(this.master);
      this.soundtrack = new MissionSoundtrack(c, this.master, this.music);
      this.soundtrack.preload();
      this.engine = c.createGain();
      this.engine.gain.value = 0.03;
      this.engine.connect(this.fx);
      this.engineOsc = [];
      for (const f of [41, 82.3]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const fl = c.createBiquadFilter();
        fl.type = 'lowpass';
        fl.frequency.value = 160;
        o.connect(fl);
        fl.connect(this.engine);
        o.start();
        this.engineOsc.push(o);
      }
      const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate),
        a = b.getChannelData(0);
      for (let i = 0; i < a.length; i++) a[i] = Math.random() * 2 - 1;
      this.noiseBuffer = b;
      this.active = true;
      for (const clip of VOICE_CLIPS)
        fetch(voiceUrl(clip))
          .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('HTTP ' + r.status))))
          .then((a) => c.decodeAudioData(a))
          .then((b) => (this.buffers[clip.key] = b))
          .catch(() => {});
      await c.resume();
    } catch (e) {
      this.active = false;
      console.warn('Audio unavailable:', e.message);
    }
  }
  /**
   * A pitch sweep: the workhorse behind every weapon, warning and interface sound.
   *
   * @param {number} f      start frequency, Hz
   * @param {number} to     end frequency, Hz
   * @param {number} dur    duration, seconds
   * @param {number} [vol]  peak gain
   * @param {OscillatorType} [type] oscillator waveform
   * @param {AudioNode|null} [dest] destination node; defaults to the effects bus
   * @param {number} [at]   start time on the audio clock; 0 means now
   */
  tone(f, to, dur, vol = 0.1, type = 'sine', dest = null, at = 0) {
    if (!this.ctx || !this.active) return;
    const c = this.ctx,
      t = at || c.currentTime,
      o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(10, f), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, to), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.009);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest || this.fx);
    o.start(t);
    o.stop(t + dur + 0.03);
  }
  noise(dur, vol = 0.1, freq = 1200, at = 0) {
    if (!this.ctx || !this.active) return;
    const c = this.ctx,
      t = at || c.currentTime,
      o = c.createBufferSource(),
      f = c.createBiquadFilter(),
      g = c.createGain();
    o.buffer = this.noiseBuffer;
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.15), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.fx);
    o.start(t, Math.random());
    o.stop(t + dur);
  }
  say(name, force = false) {
    // The supplied startup clip replaces the old spoken startup sequence.
    if (
      !this.ctx ||
      !this.active ||
      G.state === 'boot' ||
      (G.state === 'paused' && pausedFrom === 'boot')
    )
      return;
    const t = this.ctx.currentTime;
    if (!force && ((this.lastVoice[name] || -99) + 7 > t || t - this.lastVoiceAt < 1.8)) return;
    if (!this.buffers[name]) return;
    this.lastVoice[name] = t;
    this.lastVoiceAt = t;
    this.stopVoice();
    const s = this.ctx.createBufferSource(),
      g = this.ctx.createGain();
    s.buffer = this.buffers[name];
    g.gain.value = 0.72;
    s.connect(g);
    g.connect(this.master);
    s.start();
    this.voiceSource = s;
    this.voiceUntil = t + s.buffer.duration;
    s.onended = () => {
      if (this.voiceSource === s) {
        this.voiceSource = null;
        this.voiceUntil = 0;
      }
      s.disconnect();
      g.disconnect();
    };
    this.tone(1040, 1040, 0.065, 0.025);
  }
  fxPlay(kind, vol = 1) {
    if (!this.ctx || !this.active) return;
    switch (kind) {
      case 'laser':
        this.tone(900, 130, 0.26, 0.11 * vol, 'sawtooth');
        this.tone(1550, 230, 0.19, 0.07 * vol);
        this.noise(0.14, 0.08 * vol, 6500);
        break;
      case 'cannon':
        this.tone(145, 32, 0.42, 0.28 * vol, 'triangle');
        this.noise(0.35, 0.33 * vol, 5000);
        this.tone(1900, 70, 0.075, 0.12 * vol, 'square');
        break;
      case 'missile':
        this.noise(0.7, 0.23 * vol, 2800);
        this.tone(95, 260, 0.48, 0.08 * vol, 'sawtooth');
        break;
      case 'explosion':
        this.noise(1.4, 0.38 * vol, 2300);
        this.tone(74, 23, 1.2, 0.33 * vol);
        break;
      case 'hit':
        this.noise(0.24, 0.19 * vol, 4400);
        this.tone(112, 35, 0.28, 0.17 * vol);
        break;
      case 'step':
        this.tone(60, 24, 0.3, 0.23 * vol);
        this.noise(0.15, 0.07 * vol, 1200);
        break;
      case 'beep':
        this.tone(680, 950, 0.075, 0.04 * vol, 'square');
        break;
      case 'warning':
        this.tone(510, 510, 0.18, 0.07 * vol, 'square');
        this.tone(420, 420, 0.18, 0.05 * vol, 'square', null, this.ctx.currentTime + 0.25);
        break;
      case 'coolant':
        this.noise(1.4, 0.16 * vol, 7500);
        break;
      case 'jet':
        this.noise(0.22, 0.1 * vol, 1000);
        break;
    }
  }
  update() {
    if (!this.ctx || !this.active) return;
    const c = this.ctx,
      t = c.currentTime,
      run = (G.state === 'playing' || G.state === 'boot') && !G.coop?.held;
    const scene = G.state === 'paused' ? pausedFrom : G.state;
    const cue =
      scene === 'boot'
        ? 'boot'
        : scene === 'playing'
          ? G.missionFlags[2]
            ? 'works'
            : 'basin'
          : null;
    this.soundtrack.sync(cue, G.state === 'paused' || !!G.coop?.held);
    this.master.gain.setTargetAtTime(this.muted ? 0 : settings.volume, t, 0.08);
    // Keep radio speech clear. The startup cue follows master volume, not music volume.
    this.music.gain.setTargetAtTime(
      run ? settings.music * (t < this.voiceUntil ? 0.48 : 1) : 0,
      t,
      0.14,
    );
    this.engine.gain.setTargetAtTime(
      run ? (G.player.shutdown > 0 ? 0.006 : 0.022 + (Math.abs(G.player.speed) / 22) * 0.035) : 0,
      t,
      0.12,
    );
    for (let i = 0; i < this.engineOsc.length; i++)
      this.engineOsc[i].frequency.setTargetAtTime(
        (i ? 82.3 : 41) + Math.abs(G.player.speed) * (i ? 1.4 : 0.7),
        t,
        0.2,
      );
  }
  bootStatus() {
    const track = this.soundtrack,
      duration = track?.buffers.boot?.duration || SOUNDTRACK_INFO.boot.duration;
    if (!this.active || !track || track.failures.boot)
      return { time: null, duration, ended: false };
    return {
      time: track.key === 'boot' ? track.position() : 0,
      duration,
      ended: track.key === 'boot' && track.ended,
    };
  }
  stopVoice() {
    this.voiceUntil = 0;
    if (this.voiceSource) {
      const source = this.voiceSource;
      this.voiceSource = null;
      try {
        source.stop();
      } catch (e) {}
    }
  }
  resetMissionAudio() {
    this.soundtrack?.stop();
    this.stopVoice();
    this.lastVoice = {};
    this.lastVoiceAt = -10;
  }
}

export const sound = new SoundSystem();
