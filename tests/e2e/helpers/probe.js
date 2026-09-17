/**
 * Shared probes for the RobotWarrior status API.
 *
 * The same two probes run against the original single-file build (to capture a
 * baseline) and against the unpacked build (to prove parity). Keeping them in one
 * module is the point: if a probe drifts, both sides drift together and the
 * comparison stays honest.
 */

/** Fields that legitimately differ between two runs and must not be compared. */
const VOLATILE = new Set(['fps', 'time', 'transportTime', 'serviceProgress', 'supplyProgress']);

/**
 * Strip values that vary with wall-clock time so a diff only shows real drift.
 * @param {import('../../../src/types/globals').GameStatus} status
 */
export function stable(status) {
  const out = {};
  for (const [k, v] of Object.entries(status)) {
    if (VOLATILE.has(k)) continue;
    out[k] = v;
  }
  // The audio block reports decode + playback progress, which is timing dependent.
  // Only the cue identity and loop flag are structural.
  if (status.audio && typeof status.audio === 'object') {
    const a = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (status.audio));
    out.audio = { cue: a.cue ?? null, loop: a.loop ?? false };
  }
  // Positions drift once physics runs; round hard so spawn placement still compares.
  if (status.position) {
    const p = /** @type {{x:number,y:number,z:number}} */ (status.position);
    out.position = { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) };
  }
  return out;
}

/**
 * Wait for the game to finish booting and expose its status API.
 * @param {import('@playwright/test').Page} page
 */
export async function waitForBoot(page) {
  await page.waitForFunction(() => typeof window.RobotWarrior !== 'undefined', null, {
    timeout: 60_000,
  });
  await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, null, {
    timeout: 60_000,
  });
}

/**
 * Menu-time snapshot: version, chassis defaults, and the full objective list.
 * @param {import('@playwright/test').Page} page
 */
export async function probeBoot(page) {
  await waitForBoot(page);
  const raw = await page.evaluate(() => ({
    version: window.RobotWarrior.version,
    status: window.RobotWarrior.getStatus(),
    coop: window.RobotWarrior.getCoopStatus(),
  }));
  return {
    version: raw.version,
    status: stable(raw.status),
    coopKeys: Object.keys(raw.coop).sort(),
  };
}

/**
 * Start a mission and snapshot the generated world.
 *
 * World generation is driven by a seeded LCG that `resetGame` rewinds, so the
 * entity roster — names, types, zones, spawn coordinates — is deterministic and is
 * the strongest signal that the renderer, level builder and spawners still agree.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function probeMission(page) {
  await waitForBoot(page);
  await page.click('#startBtn');
  // Let a few frames run so the loop, HUD and sim have all executed at least once.
  await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing', null, {
    timeout: 30_000,
  });
  await page.waitForTimeout(1500);

  const raw = await page.evaluate(() => window.RobotWarrior.getStatus());
  return {
    state: raw.state,
    sector: raw.sector,
    chassis: raw.chassis,
    objectiveLabels: raw.objectiveLabels,
    objectives: raw.objectives,
    armor: raw.armor,
    ammo: raw.ammo,
    missiles: raw.missiles,
    // Spawn roster, sorted so iteration order is never the thing under test.
    entities: raw.entities
      .map((e) => ({
        name: e.name,
        type: e.type,
        zone: e.zone,
        x: Math.round(e.x),
        z: Math.round(e.z),
        alive: e.alive,
        health: Math.round(e.health * 1000) / 1000,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.x - b.x || a.z - b.z),
  };
}

/**
 * Assert the render loop is actually producing frames rather than sitting at a
 * black screen with a live status object.
 * @param {import('@playwright/test').Page} page
 */
export async function measureFrames(page, ms = 2000) {
  const before = await page.evaluate(() => window.RobotWarrior.getStatus().fps);
  await page.waitForTimeout(ms);
  const after = await page.evaluate(() => window.RobotWarrior.getStatus().fps);
  return { before, after };
}
