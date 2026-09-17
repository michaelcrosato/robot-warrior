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

/** Soundtrack playback state. */
export interface AudioStatus {
  cue: string | null;
  title?: string | null;
  playing?: boolean;
  position?: number;
  duration?: number;
  loop?: boolean;
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
