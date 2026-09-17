/**
 * Classifying a device into a quality tier.
 *
 * Kept separate from quality.js, and free of any import that touches a WebGL context, so
 * the classification is a pure function of the signals it is given and can be tested
 * against real renderer strings without a browser. That matters more than it sounds: the
 * two devices this was tuned for cannot be run here, so the detection is the only part of
 * targeting them that is checkable at all.
 */

/** Tiers in ascending cost. */
export const TIER_ORDER = ['potato', 'low', 'mobile', 'high', 'ultra'];

/**
 * Every signal is optional: each one is absent on some real browser, and the classifier
 * has to reach an answer regardless.
 *
 * @typedef {object} DeviceSignals
 * @property {string}  [renderer]       unmasked renderer string; '' when the browser masks it
 * @property {boolean} [coarsePointer]  true on a phone or tablet
 * @property {number}  [cores]          navigator.hardwareConcurrency, 0 if unknown
 * @property {number}  [memory]         navigator.deviceMemory in GiB; absent outside Chrome
 */

/**
 * Pick a tier from what the device is willing to report.
 *
 * Every signal is a hint rather than a fact. `WEBGL_debug_renderer_info` is masked in some
 * browsers, `deviceMemory` is coarse and absent outside Chrome, and a renderer string can
 * name hardware that is being emulated. So this is deliberately coarse, biased one step
 * low when unsure, and always overridable from the settings menu — being wrong upwards
 * means an unplayable frame rate, being wrong downwards means a slightly plainer picture.
 *
 * @param {DeviceSignals} signals
 * @returns {string} a key of TIERS
 */
export function classifyDevice({ renderer = '', coarsePointer = false, cores = 0, memory = 0 }) {
  const r = renderer.toLowerCase();

  // Software rasterisers. Correct, and far too slow for a shadowed scene — this is what a
  // headless test runner reports, and it is the right answer there too.
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(r)) {
    return 'potato';
  }

  if (coarsePointer) {
    // Recent flagship mobile silicon. A Galaxy S26 lands here on either of its two
    // variants: Adreno on the Snapdragon part, Xclipse on the Exynos one.
    if (
      /adreno \(tm\) [789]\d\d|adreno [789]\d\d|xclipse (9|1\d)\d\d|apple a1[7-9]|apple m\d|immortalis/.test(
        r,
      )
    ) {
      return 'mobile';
    }
    if (/adreno \(tm\) 6\d\d|adreno 6\d\d|mali-g[67]\d|apple a1[4-6]/.test(r)) return 'low';
    // Unknown mobile GPU: start low unless the other signals are strong.
    return cores >= 8 && memory >= 6 ? 'mobile' : 'low';
  }

  // Desktop parts that comfortably run everything. An RTX 4070 SUPER lands here.
  if (
    /rtx [45]0\d\d|rtx [23]0[789]0|radeon rx [67]\d00 ?xt?|arc a7\d\d|apple m[1-9] (pro|max|ultra)/.test(
      r,
    )
  ) {
    return 'ultra';
  }
  if (/rtx \d|geforce gtx 1[06][6-8]0|radeon rx [56]\d00|apple m\d/.test(r)) return 'high';

  // Integrated desktop graphics.
  if (/intel|uhd graphics|iris|vega \d|radeon graphics/.test(r)) return 'low';

  return cores >= 8 ? 'high' : 'low';
}

/** The tier one step cheaper, or null at the bottom. */
export function lowerTierId(id) {
  const i = TIER_ORDER.indexOf(id);
  return i > 0 ? TIER_ORDER[i - 1] : null;
}
