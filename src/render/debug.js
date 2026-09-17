/**
 * Render debug views, selected with a query parameter.
 *
 *   ?debug=shadow    the shadow term on its own, white lit and black occluded
 *   ?debug=cascade   which cascade each pixel sampled, as a colour
 *   ?debug=normal    world-space normals
 *   ?debug=albedo    base colour with no lighting
 *   ?debug=roughness the roughness the material resolved to
 *
 * These exist because a lighting fault usually renders as a plausible picture. A shadow
 * lookup that returns "lit" everywhere is indistinguishable from a scene with the sun
 * somewhere else, and squinting at screenshots is a poor way to tell them apart.
 */
const MODES = { off: 0, shadow: 1, cascade: 2, normal: 3, albedo: 4, roughness: 5 };

/** The mode requested for this session. Read once; changing it needs a reload. */
export const debugMode = (() => {
  try {
    const requested = new URLSearchParams(location.search).get('debug');
    return MODES[requested ?? 'off'] ?? 0;
  } catch {
    return 0;
  }
})();

/** Names, for the status API. */
export const debugModeName = Object.keys(MODES).find((k) => MODES[k] === debugMode) ?? 'off';
