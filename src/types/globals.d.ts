/**
 * Ambient declarations for the globals the game defines or relies on.
 *
 * `window.RobotWarrior` is the frozen, read-only status API installed by src/main.js.
 * It exists for tests and performance checks — nothing in the game reads it — and it
 * is declared here so both the source and the end-to-end suite type-check against
 * the same shape.
 */

/** One entity as the status API reports it. */
export interface StatusEntity {
  name: string;
  type: string;
  zone: string;
  x: number;
  z: number;
  alive: boolean;
  /** 0..1 across all surviving components. */
  health: number;
}

/**
 * Soundtrack playback state, as MissionSoundtrack.status() reports it.
 *
 * `loaded` and `failed` are the two fields worth reading when debugging silence: a cue
 * should always appear in one of them. Music is an optional local asset, so a cue in
 * `failed` is an ordinary outcome, not a bug — see docs/assets.md.
 */
export interface AudioStatus {
  cue: string | null;
  title: string | null;
  playing: boolean;
  paused: boolean;
  /** Seconds into the current cue. */
  position: number;
  duration: number;
  loop: boolean;
  /** Cue keys whose audio decoded successfully. */
  loaded: string[];
  /** Cue keys that could not be fetched or decoded. */
  failed: string[];
}

/** A full snapshot of mission and pilot state. */
export interface GameStatus {
  state: 'menu' | 'boot' | 'playing' | 'paused' | 'result' | string;
  audio: AudioStatus;
  chassis: string;
  sector: string;
  imaging: boolean;
  nightVision: boolean;
  shielded: boolean;
  serviceUsed: boolean;
  serviceProgress: number;
  supplyUsed: boolean;
  supplyProgress: number;
  linkProgress: number;
  linkDuration: number;
  linkStatus: string;
  linkWave: number;
  linkBlocked: boolean;
  responseRemaining: number;
  gateLocked: boolean;
  extractionProgress: number;
  transportTime: number;
  basinDefenders: number;
  navIndex: number;
  fps: number;
  time: number;
  position: { x: number; y: number; z: number };
  /** km/h. */
  speed: number;
  /** Torso yaw relative to the legs, radians. */
  torso: number;
  /** Torso pitch, radians. */
  pitch: number;
  /** Quality tier in force: potato | low | mobile | high | ultra. */
  tier: string;
  /** Active render debug view, or 'off'. */
  debug: string;
  heat: number;
  /** 0..1. */
  armor: number;
  ammo: number;
  missiles: number;
  objectiveLabels: string[];
  objectives: boolean[];
  kills: number;
  score: number;
  entities: StatusEntity[];
}

declare global {
  interface Navigator {
    /** Chrome-only, coarse RAM hint in GiB. One signal among several for quality tiering. */
    readonly deviceMemory?: number;
  }

  interface Window {
    /** Safari's prefixed constructor, used as a fallback when AudioContext is absent. */
    readonly webkitAudioContext?: typeof AudioContext;

    readonly RobotWarrior: {
      readonly version: string;
      getStatus(): GameStatus;
      getCoopStatus(): Record<string, unknown>;
    };
  }
}
