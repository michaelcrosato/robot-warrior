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
 * Fields the status API gained after the baseline was captured.
 *
 * The baseline is a recording of the original single-file build, so it cannot contain
 * them and an exact comparison would fail on their presence alone. They are excluded by
 * name rather than by loosening the comparison, so the list stays short and visible —
 * every entry is a deliberate decision that the baseline no longer covers that field.
 */
const ADDED_SINCE_BASELINE = new Set(['torso', 'pitch', 'tier', 'debug']);

/**
 * Strip values that vary with wall-clock time so a diff only shows real drift.
 * @param {import('../../../src/types/globals').GameStatus} status
 */
function stable(status) {
  const out = {};
  for (const [k, v] of Object.entries(status)) {
    if (VOLATILE.has(k) || ADDED_SINCE_BASELINE.has(k)) continue;
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
 * How long to allow for a mission to become playable.
 *
 * The startup sequence is paced by the boot audio cue, and with no soundtrack present — a
 * fresh clone, so also CI — it falls back to a wall-clock timer of roughly 8.5 seconds.
 * That is real time before the mission starts, on top of whatever a shared runner needs to
 * render the first frames of a shadowed scene through SwiftShader.
 *
 * One constant, used by every spec. Three separate numbers drifted apart once already and
 * CI failed on the one that had not been raised.
 */
export const MISSION_START_TIMEOUT = 60_000;

/**
 * Entity types that never move once placed.
 *
 * Their coordinates are derived at spawn from the site table in `src/world/sites.js` and
 * the terrain height field, so they can be compared exactly. Mechs spawn at authored
 * coordinates and then start walking, and how far they get depends on how many frames the
 * machine managed — so their positions are bounded rather than pinned. See `mobile`, below.
 */
export const STATIC_TYPES = ['tower', 'uplink', 'turret', 'generator', 'reactor'];

/** How far a mech may legitimately have walked by the time the mission probe runs. */
export const WALK_TOLERANCE = 120;

/**
 * Start a mission and snapshot the world it built.
 *
 * The roster — which machines exist, of what type, in which sector — is authored in
 * `populate()` rather than generated, so it is fixed. What the comparison actually
 * exercises is that the spawners still place every structure where the site table and the
 * terrain height field say it goes, and that the mission starts in the same state.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function probeMission(page) {
  await waitForBoot(page);
  await page.click('#startBtn');
  await page.waitForFunction(() => window.RobotWarrior.getStatus().state === 'playing', null, {
    timeout: MISSION_START_TIMEOUT,
  });
  // Let a few frames run so the loop, HUD and sim have all executed at least once.
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
 * Sample the loop twice to show it is advancing.
 *
 * Deliberately reports progress rather than speed. The e2e suite runs on SwiftShader —
 * software rasterisation of a full WebGL scene — so the frame rate on a contended CI
 * runner is not bounded by anything this repository controls, and asserting a specific
 * figure made the suite flaky. What matters for correctness is that the mission clock
 * moves and frames are being counted at all; how fast belongs in a benchmark, not a gate.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} ms how long to sample for
 */
export async function measureFrames(page, ms = 2000) {
  const sample = () =>
    page.evaluate(() => {
      const s = window.RobotWarrior.getStatus();
      return { fps: s.fps, time: s.time };
    });
  const before = await sample();
  await page.waitForTimeout(ms);
  const after = await sample();
  return {
    before,
    after,
    /** Seconds of mission time that elapsed while sampling. */
    advanced: after.time - before.time,
  };
}
