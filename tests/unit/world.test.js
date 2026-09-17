import { describe, it, expect } from 'vitest';
import { terrainY } from '../../src/world/terrain.js';
import {
  serviceBay,
  supplyBay,
  ridgeGate,
  ridgeNav,
  canyonNav,
  flightLink,
  extraction,
  reactorSite,
  batterySite,
  beaconSite,
  routePoints,
} from '../../src/world/sites.js';

describe('terrainY', () => {
  it('is a pure function of (x, z)', () => {
    for (const [x, z] of [
      [0, 0],
      [190, -960],
      [-400, -2500],
      [512.5, -3999.5],
    ]) {
      expect(terrainY(x, z)).toBe(terrainY(x, z));
    }
  });

  it('is finite everywhere across the playable map', () => {
    for (let x = -600; x <= 600; x += 37) {
      for (let z = 200; z >= -4200; z -= 97) {
        const y = terrainY(x, z);
        expect(Number.isFinite(y), `terrainY(${x}, ${z})`).toBe(true);
        // Nothing in the height field should approach the 80-unit jump ceiling.
        expect(Math.abs(y)).toBeLessThan(60);
      }
    }
  });

  it('rises towards the northern ridge', () => {
    // A smoothstep ramp lifts the map beyond z = -2540 to separate the sectors.
    const basin = terrainY(0, 0);
    const ridge = terrainY(0, -3500);
    expect(ridge).toBeGreaterThan(basin + 15);
  });

  it('is continuous — no cliffs between adjacent samples', () => {
    let worst = 0;
    for (let x = -500; x <= 500; x += 11) {
      for (let z = 0; z >= -4000; z -= 23) {
        worst = Math.max(worst, Math.abs(terrainY(x, z) - terrainY(x + 1, z)));
        worst = Math.max(worst, Math.abs(terrainY(x, z) - terrainY(x, z - 1)));
      }
    }
    // A mech would fall through a discontinuity; a gentle gradient is required.
    expect(worst).toBeLessThan(1.5);
  });

  it('flattens the pads that structures are placed on', () => {
    // Each flattened site blends the height field towards a single value inside its
    // radius, so a structure's footprint does not float or clip.
    for (const site of [reactorSite, batterySite, serviceBay, supplyBay]) {
      const centre = terrainY(site.x, site.z);
      for (const [dx, dz] of [
        [8, 0],
        [-8, 0],
        [0, 8],
        [0, -8],
      ]) {
        expect(Math.abs(terrainY(site.x + dx, site.z + dz) - centre)).toBeLessThan(0.8);
      }
    }
  });
});

describe('sites', () => {
  const named = {
    serviceBay,
    supplyBay,
    ridgeNav,
    canyonNav,
    flightLink,
    extraction,
    reactorSite,
    batterySite,
    beaconSite,
  };

  it('places every site inside the playable bounds', () => {
    for (const [name, site] of Object.entries(named)) {
      expect(Number.isFinite(site.x), name).toBe(true);
      expect(Number.isFinite(site.z), name).toBe(true);
      expect(Math.abs(site.x), `${name}.x`).toBeLessThan(600);
      expect(site.z, `${name}.z`).toBeLessThanOrEqual(0);
      expect(site.z, `${name}.z`).toBeGreaterThan(-4200);
    }
  });

  it('orders the three sectors from south to north', () => {
    // Kestrel Basin, then Ashfall Works, then Blackglass Ridge.
    expect(serviceBay.z).toBeGreaterThan(supplyBay.z);
    expect(supplyBay.z).toBeGreaterThan(ridgeNav.z);
    expect(ridgeNav.z).toBeGreaterThan(extraction.z);
  });

  it('gives the flight link a capture radius and a duration', () => {
    expect(flightLink.r).toBeGreaterThan(0);
    expect(flightLink.duration).toBeGreaterThan(0);
  });

  it('leaves the ridge gate wide enough for the largest chassis', () => {
    expect(ridgeGate.width).toBeGreaterThan(100);
  });

  it('routes the nav path monotonically north', () => {
    expect(routePoints.length).toBeGreaterThan(3);
    for (let i = 1; i < routePoints.length; i++) {
      expect(routePoints[i].z, `routePoints[${i}] must not double back`).toBeLessThan(
        routePoints[i - 1].z,
      );
    }
  });

  it('starts the route at the first service bay', () => {
    expect(routePoints[0]).toBe(serviceBay);
  });
});
