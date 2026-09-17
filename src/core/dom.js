/**
 * Element lookup helpers — the DOM surface the whole game shares.
 */

/**
 * The element with this id.
 *
 * Typed as `any` deliberately. Every id here is a literal string naming an element
 * that exists in index.html, and callers reach straight for `.value`, `.checked`,
 * `.hidden` or `.getContext` — none of which the DOM types can narrow from an id.
 * Casting at ~90 call sites would add noise without catching anything real.
 *
 * @param {string} id
 * @returns {any}
 */
export const $ = (id) => document.getElementById(id);

/**
 * Every element matching a selector, as an array so it can be iterated directly.
 *
 * @param {string} selector
 * @returns {HTMLElement[]}
 */
export const $$ = (selector) =>
  /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll(selector)));

/**
 * Hide every modal overlay — briefing, manual, pause, result, co-op lobby.
 *
 * Called on every transition out of a menu state, by both the solo path and the
 * co-op layer, which is why it lives here rather than in either of them.
 */
export const hideOverlays = () => {
  for (const el of $$('.overlay')) el.hidden = true;
};
