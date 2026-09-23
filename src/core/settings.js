/**
 * Persisted player settings.
 */
/**
 * Whether the operating system asks for reduced motion. Screen shake defaults to off when
 * it does; a player who wants it anyway can still turn it on, and that choice is stored.
 */
const reducedMotion = (() => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
})();

export const settings = {
  volume: 0.7,
  music: 0.35,
  sensitivity: 0.6,
  // 'auto' resolves per device — see src/core/quality.js. Anything else names a tier.
  quality: 'auto',
  shake: !reducedMotion,
  invert: false,
};

/** The ranges the pause-menu sliders offer, as stored fractions. */
const RANGES = { volume: [0, 1], music: [0, 1], sensitivity: [0.15, 1.5] };

/**
 * Validate stored settings field by field against the defaults.
 *
 * Storage is outside the game's control — an older build, a hand edit or another script on
 * the origin can leave anything there — and these values reach the audio graph and the aim
 * maths directly. A string volume once threw halfway through building the audio graph, and
 * a string sensitivity turned the torso angle into NaN. So every field must have its
 * default's type, numbers must be finite and inside their slider's range, and keys the
 * game does not own are dropped. Quality names are only type-checked: the tier resolver
 * already maps unknown names to automatic detection.
 *
 * @param {unknown} stored
 * @param {typeof settings} defaults
 * @returns {typeof settings}
 */
export function sanitizeSettings(stored, defaults) {
  const clean = { ...defaults };
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return clean;
  for (const key of Object.keys(defaults)) {
    if (!Object.hasOwn(stored, key)) continue;
    const value = stored[key];
    if (typeof value !== typeof defaults[key]) continue;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) continue;
      const [lo, hi] = RANGES[key] ?? [-Infinity, Infinity];
      clean[key] = Math.min(hi, Math.max(lo, value));
    } else clean[key] = value;
  }
  return clean;
}

try {
  Object.assign(
    settings,
    sanitizeSettings(JSON.parse(localStorage.getItem('robotwarrior.settings') || '{}'), settings),
  );
} catch (e) {}

export function saveSettings() {
  try {
    localStorage.setItem('robotwarrior.settings', JSON.stringify(settings));
  } catch (e) {}
}
