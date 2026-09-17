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
import { classifyDevice, lowerTierId, TIER_ORDER } from './device.js';

/**
 * @typedef {object} Tier
 * @property {string}  id
 * @property {string}  label            shown in the settings menu
 * @property {number}  renderScale      multiplier on CSS pixels before the cap
 * @property {number}  maxWidth         hard cap on internal render width
 * @property {number}  shadowCascades   0 disables the shadow pass entirely
 * @property {number}  shadowSize       resolution of one cascade, square
 * @property {number}  shadowDistance   metres of shadow coverage from the camera
 * @property {number}  shadowTaps       PCF taps per axis: 1, 2 or 3
 * @property {boolean} bloom
 * @property {number}  bloomLevels      mip levels in the bloom chain
 * @property {number}  bloomScale       bloom chain resolution relative to the scene
 * @property {boolean} ssao
 * @property {number}  ssaoSamples
 * @property {number}  ssaoScale
 * @property {boolean} fxaa
 * @property {number}  anisotropy
 * @property {number}  entityDrawDistance
 * @property {boolean} softParticles
 */

export { TIER_ORDER };

/** @type {Record<string, Tier>} */
export const TIERS = {
  potato: {
    id: 'potato',
    label: 'Minimum · no shadows',
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
    anisotropy: 1,
    entityDrawDistance: 1200,
    softParticles: false,
  },

  low: {
    id: 'low',
    label: 'Low · 720p',
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
    anisotropy: 2,
    entityDrawDistance: 1400,
    softParticles: false,
  },

  // Tuned against a Galaxy S26: sustained rather than peak, because phones throttle.
  mobile: {
    id: 'mobile',
    label: 'Mobile · 1080p',
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
    anisotropy: 4,
    entityDrawDistance: 1700,
    softParticles: true,
  },

  high: {
    id: 'high',
    label: 'High · 1440p',
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
    anisotropy: 8,
    entityDrawDistance: 1700,
    softParticles: true,
  },

  // Tuned against an RTX 4070 SUPER.
  ultra: {
    id: 'ultra',
    label: 'Ultra · native',
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
    anisotropy: 16,
    entityDrawDistance: 2200,
    softParticles: true,
  },
};

/**
 * Guess a tier from what the device reports.
 *
 * The classification itself lives in device.js as a pure function, so it can be tested
 * against real renderer strings without a browser — which is the only part of targeting a
 * specific phone or graphics card that is checkable from here.
 */
export function detectTier() {
  return classifyDevice({
    renderer: caps.renderer,
    coarsePointer: caps.coarsePointer,
    cores: caps.hardwareConcurrency,
    memory: caps.deviceMemory,
  });
}

/** The tier one step cheaper, or null at the bottom. */
export function lowerTier(id) {
  const next = lowerTierId(id);
  return next ? TIERS[next] : null;
}

/**
 * The tier currently in force.
 *
 * `quality` in settings is either a tier id or 'auto'. Resolving it here keeps the
 * auto-detection in one place, so a device moved between tiers by the frame-rate governor
 * still reports honestly in the settings menu.
 *
 * @param {string} setting
 */
export function resolveTier(setting) {
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
 * Force a tier, or pass nothing to re-resolve from settings.
 *
 * The frame-rate governor uses this to step down on a device that cannot hold its budget,
 * without writing the change into saved settings — a phone that throttles in a long
 * mission should not be permanently demoted the next time it is opened cool.
 *
 * @param {string} [id]
 */
export function setActiveTier(id) {
  active = id && TIERS[id] ? TIERS[id] : resolveTier(settings.quality);
  return active;
}
