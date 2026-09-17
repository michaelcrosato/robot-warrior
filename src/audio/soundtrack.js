/**
 * Streaming mission soundtrack.
 */
import { musicUrl } from '../data/audio-manifest.js';

export const SOUNDTRACK_INFO = Object.freeze({
  boot: { title: '3-01 "Reactor Online"', duration: 8.542041, loop: false },
  basin: { title: '1-02 Umber Wall', duration: 137.848163, loop: true },
  works: { title: '1-03 Silent Thunder', duration: 143.072653, loop: true },
});

export class MissionSoundtrack {
  constructor(context, master, music) {
    this.ctx = context;
    this.master = master;
    this.music = music;
    this.buffers = {};
    this.loads = {};
    this.failures = {};
    this.key = null;
    this.current = null;
    this.fading = new Set();
    this.offset = 0;
    this.ended = false;
    this.paused = true;
    this.fadeIn = 0;
  }
  load(key) {
    if (this.loads[key]) return this.loads[key];
    this.loads[key] = (async () => {
      const response = await fetch(musicUrl(key));
      if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + response.statusText);
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      this.buffers[key] = buffer;
      return buffer;
    })().catch((error) => {
      this.failures[key] = String(error.message || error);
      // The soundtrack is an optional local asset that is not distributed with the
      // source; see docs/assets.md. Absent files must leave the game fully playable.
      console.info(
        'Soundtrack unavailable: ' + SOUNDTRACK_INFO[key].title + ' — ' + this.failures[key],
      );
      return null;
    });
    return this.loads[key];
  }
  preload() {
    this.load('boot');
    // Let the short startup cue decode first. Both music tracks load during startup.
    setTimeout(() => this.load('basin'), 80);
    setTimeout(() => this.load('works'), 240);
  }
  position() {
    if (!this.current) return this.offset;
    const clip = this.current,
      elapsed = clip.offset + Math.max(0, this.ctx.currentTime - clip.startedAt);
    return clip.loop ? elapsed % clip.duration : Math.min(elapsed, clip.duration);
  }
  duration() {
    return this.key ? this.buffers[this.key]?.duration || SOUNDTRACK_INFO[this.key].duration : 0;
  }
  disconnect(clip) {
    try {
      clip.source.disconnect();
      clip.gain.disconnect();
    } catch (e) {}
    this.fading.delete(clip);
  }
  retire(clip, seconds = 0) {
    if (!clip) return;
    this.fading.add(clip);
    const now = this.ctx.currentTime,
      gain = clip.gain.gain;
    if (seconds > 0) {
      if (gain.cancelAndHoldAtTime) gain.cancelAndHoldAtTime(now);
      else {
        const value = gain.value;
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(value, now);
      }
      gain.linearRampToValueAtTime(0, now + seconds);
      try {
        clip.source.stop(now + seconds + 0.01);
      } catch (e) {
        this.disconnect(clip);
      }
    } else {
      clip.source.onended = null;
      try {
        clip.source.stop();
      } catch (e) {}
      this.disconnect(clip);
    }
  }
  start() {
    if (!this.key || this.paused || this.current || this.ended || this.ctx.state !== 'running')
      return;
    const buffer = this.buffers[this.key];
    if (!buffer) return;
    const loop = SOUNDTRACK_INFO[this.key].loop;
    if (!loop && this.offset >= buffer.duration) {
      this.ended = true;
      return;
    }
    const source = this.ctx.createBufferSource(),
      gain = this.ctx.createGain();
    source.buffer = buffer;
    source.loop = loop;
    const level = this.key === 'boot' ? 0.85 : 1,
      now = this.ctx.currentTime;
    gain.gain.setValueAtTime(this.fadeIn > 0 ? 0 : level, now);
    if (this.fadeIn > 0) gain.gain.linearRampToValueAtTime(level, now + this.fadeIn);
    source.connect(gain);
    gain.connect(this.key === 'boot' ? this.master : this.music);
    const clip = {
      source,
      gain,
      key: this.key,
      loop,
      duration: buffer.duration,
      offset: this.offset,
      startedAt: now,
    };
    this.current = clip;
    source.onended = () => {
      // A stopped or fading source must not end a newer cue.
      if (this.current === clip) {
        this.current = null;
        this.offset = clip.duration;
        this.ended = true;
      }
      this.disconnect(clip);
    };
    source.start(0, loop ? this.offset % buffer.duration : this.offset);
    this.fadeIn = 0;
  }
  sync(key, paused = false) {
    if (!key) {
      if (this.key !== null || this.current) this.stop();
      return;
    }
    if (key !== this.key) {
      const old = this.current,
        crossfade = !!this.key && this.key !== 'boot' && key !== 'boot';
      this.current = null;
      this.key = key;
      this.offset = 0;
      this.ended = false;
      this.fadeIn = key === 'boot' ? 0 : crossfade ? 1.2 : 0.35;
      if (old) this.retire(old, crossfade ? 1.2 : 0.025);
      this.load(key);
    }
    if (paused) {
      this.pause();
      return;
    }
    this.paused = false;
    this.start();
  }
  pause() {
    if (this.paused) return;
    this.offset = this.position();
    this.paused = true;
    const old = this.current;
    this.current = null;
    for (const clip of [...this.fading]) this.retire(clip, 0);
    if (old) this.retire(old, 0.025);
    this.fadeIn = 0.025;
  }
  stop() {
    const old = this.current;
    this.current = null;
    this.key = null;
    this.offset = 0;
    this.ended = false;
    this.paused = true;
    this.fadeIn = 0;
    for (const clip of [...this.fading]) this.retire(clip, 0);
    if (old) this.retire(old, 0.025);
  }
  status() {
    return {
      cue: this.key,
      title: this.key ? SOUNDTRACK_INFO[this.key].title : null,
      playing: !!this.current && this.ctx.state === 'running',
      paused: this.paused,
      position: this.position(),
      duration: this.duration(),
      loop: this.key ? SOUNDTRACK_INFO[this.key].loop : false,
      loaded: Object.keys(this.buffers),
      failed: Object.keys(this.failures),
    };
  }
}
