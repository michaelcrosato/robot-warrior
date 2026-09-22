/** Pure touch input rules, shared by the pad and its regression tests. */
import { clamp } from '../core/math.js';

export function stickInput(dx, dy, radius) {
  const scale = Math.max(radius, Math.hypot(dx, dy));
  const x = dx / scale;
  const y = dy / scale;
  const forward = -y;
  // A resting thumb must neither creep forward nor turn the legs.
  const throttle =
    Math.sign(forward) * clamp((Math.abs(forward) - 0.16) / 0.84, 0, 1) * (forward < 0 ? 0.45 : 1);
  return { x, y, throttle, turn: Math.abs(x) > 0.3 ? Math.sign(x) : 0 };
}

/** Leave headroom for the next shot; hysteresis prevents rapid fire/cool flicker. */
export function heatLimited(holding, heat, shotHeat) {
  return holding ? heat > 55 : heat + shotHeat >= 94;
}

/** The host still checks proximity to a downed ally and the six-second restore timer. */
export function canAutoRestore(player) {
  return (
    player.alive && player.altitude < 3 && Math.abs(player.speed) < 2.2 && player.shutdown <= 0
  );
}

/** Keep a valid lock through small thumb movements, but never select through cover. */
export function pickTouchTarget(candidates, current) {
  const retained = candidates.find(
    (c) => c.entity === current && c.visible && c.alignment >= Math.cos((16 * Math.PI) / 180),
  );
  if (retained) return retained.entity;
  let best = null;
  for (const c of candidates) {
    if (!c.visible || c.alignment < Math.cos((12 * Math.PI) / 180)) continue;
    if (
      !best ||
      c.alignment > best.alignment ||
      (c.alignment === best.alignment && c.distance < best.distance)
    )
      best = c;
  }
  return best?.entity ?? null;
}
