/**
 * Persisted player settings.
 */
export const settings = {
  volume: 0.7,
  music: 0.35,
  sensitivity: 0.6,
  quality: 'balanced',
  shake: true,
  invert: false,
};

try {
  Object.assign(settings, JSON.parse(localStorage.getItem('robotwarrior.settings') || '{}'));
} catch (e) {}

export function saveSettings() {
  try {
    localStorage.setItem('robotwarrior.settings', JSON.stringify(settings));
  } catch (e) {}
}
