/**
 * Quality tiers, and how a device is placed into one.
 *
 * The renderer has one shape and five budgets. A tier decides internal resolution,
 * how many shadow cascades exist and at what size, whether the bloom and ambient
 * occlusion passes run at all, and how many taps the shadow filter takes. Nothing
 * else about the pipeline changes, so a screenshot from the lowest tier and the
 * highest differ in fidelity rather than in content.
 *
 * Two devices were used as reference points while tuning:
 *
 *   Samsung Galaxy S26 — the `mobile` tier. Plenty of GPU for this scene, but a phone
 *   throttles, so the budget targets a sustained 60 rather than a peak. 1080p internal,
 *   two cascades, bloom at quarter resolution, no ambient occlusion.
 *
 *   GeForce RTX 4070 SUPER — the `ultra` tier. Native resolution to 4K, four cascades at
 *   2048, ambient occlusion, and a wide shadow filter.
 */
import { caps } from './gl.js';
import { settings } from './settings.js';
import { classifyDevice } from './device.js';

/**
 * @typedef {object} Tier
 * @property {string}  id
 * @property {number}  renderScale      multiplier on CSS pixels before the cap
 * @property {number}  maxWidth         hard cap on internal render width
 * @property {number}  shadowCascades   0 disables the shadow pass entirely
 * @property {number}  shadowSize       resolution of one cascade, square
 * @property {number}  shadowDistance   metres of shadow coverage from the camera
 * @property {number}  shadowTaps       PCF kernel: 1 a single tap, 2 a 3x3, 3 a 5x5
 * @property {boolean} bloom
 * @property {number}  bloomLevels      mip levels in the bloom chain
 * @property {number}  bloomScale       bloom chain resolution relative to the scene
 * @property {boolean} ssao
 * @property {number}  ssaoSamples
 * @property {number}  ssaoScale
 * @property {boolean} fxaa
 * @property {number}  entityDrawDistance
 */

/** @type {Record<string, Tier>} */
const TIERS = {
  potato: {
    id: 'potato',
    renderScale: 0.6,
    maxWidth: 960,
    shadowCascades: 0,
    shadowSize: 512,
    shadowDistance: 300,
    shadowTaps: 1,
    bloom: false,
    bloomLevels: 0,
    bloomScale: 0.5,
    ssao: false,
    ssaoSamples: 0,
    ssaoScale: 0.5,
    fxaa: false,
    entityDrawDistance: 1200,
  },

  low: {
    id: 'low',
    renderScale: 0.75,
    maxWidth: 1280,
    shadowCascades: 1,
    shadowSize: 1024,
    shadowDistance: 380,
    shadowTaps: 1,
    bloom: true,
    bloomLevels: 4,
    bloomScale: 0.5,
    ssao: false,
    ssaoSamples: 0,
    ssaoScale: 0.5,
    fxaa: true,
    entityDrawDistance: 1400,
  },

  // Tuned against a Galaxy S26: sustained rather than peak, because phones throttle.
  mobile: {
    id: 'mobile',
    renderScale: 1,
    maxWidth: 1920,
    shadowCascades: 2,
    shadowSize: 1536,
    shadowDistance: 620,
    shadowTaps: 2,
    bloom: true,
    bloomLevels: 5,
    bloomScale: 0.5,
    ssao: false,
    ssaoSamples: 0,
    ssaoScale: 0.5,
    fxaa: true,
    entityDrawDistance: 1700,
  },

  high: {
    id: 'high',
    renderScale: 1,
    maxWidth: 2560,
    shadowCascades: 3,
    shadowSize: 2048,
    shadowDistance: 900,
    shadowTaps: 2,
    bloom: true,
    bloomLevels: 6,
    bloomScale: 0.5,
    ssao: true,
    ssaoSamples: 12,
    ssaoScale: 0.5,
    fxaa: true,
    entityDrawDistance: 1700,
  },

  // Tuned against an RTX 4070 SUPER.
  ultra: {
    id: 'ultra',
    renderScale: 1,
    maxWidth: 3840,
    shadowCascades: 4,
    shadowSize: 2048,
    shadowDistance: 1400,
    shadowTaps: 3,
    bloom: true,
    bloomLevels: 7,
    bloomScale: 0.5,
    ssao: true,
    ssaoSamples: 24,
    ssaoScale: 1,
    fxaa: true,
    entityDrawDistance: 2200,
  },
};

/**
 * Guess a tier from what the device reports.
 *
 * The classification itself lives in device.js as a pure function, so it can be tested
 * against real renderer strings without a browser — which is the only part of targeting a
 * specific phone or graphics card that is checkable from here.
 */
function detectTier() {
  return classifyDevice({
    renderer: caps.renderer,
    coarsePointer: caps.coarsePointer,
    cores: caps.hardwareConcurrency,
    memory: caps.deviceMemory,
  });
}

/**
 * The tier currently in force.
 *
 * `quality` in settings is either a tier id or 'auto'. Resolving it here keeps the
 * auto-detection in one place.
 *
 * @param {string} setting
 */
function resolveTier(setting) {
  // 'auto' is not a tier id, so it falls through to detection — as does any stale value
  // saved by an older build.
  if (setting && TIERS[setting]) return TIERS[setting];
  return TIERS[detectTier()];
}

/** @type {Tier|null} */
let active = null;

/**
 * The tier in force right now.
 *
 * Memoised because it is read several times per frame — by the render pass, the entity
 * cull and the transparent pass — and `detectTier` parses a renderer string.
 */
export function activeTier() {
  if (!active) active = resolveTier(settings.quality);
  return active;
}

/**
 * Apply a selected tier, or re-resolve from settings when no valid id is supplied.
 * @param {string} [id]
 */
export function setActiveTier(id) {
  active = id && TIERS[id] ? TIERS[id] : resolveTier(settings.quality);
  return active;
}
