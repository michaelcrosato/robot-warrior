/**
 * Mouse-wheel weapon cycling, as a pure rule so it can be tested.
 */

/**
 * Minimum time between two weapon steps from the wheel. One notch of a mouse wheel is one
 * event; a trackpad's momentum is dozens, and without a limit a single flick spun through
 * all three weapons. Chosen by feel: quicker than anyone scrolls notch by notch on purpose.
 */
export const WHEEL_REPEAT_MS = 120;

/**
 * Which way one wheel event moves the weapon selection: 1 forward, -1 back, 0 not at all.
 *
 * Only vertical intent counts. A sideways trackpad swipe reports deltaY 0, which the old
 * `deltaY > 0 ? next : previous` read as "previous", so swiping sideways cycled weapons
 * backwards.
 *
 * @param {number} deltaX
 * @param {number} deltaY
 * @param {number} now   ms, e.g. performance.now()
 * @param {number} last  ms of the last step taken
 */
export function wheelStep(deltaX, deltaY, now, last) {
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return 0;
  if (now - last < WHEEL_REPEAT_MS) return 0;
  return deltaY > 0 ? 1 : -1;
}
