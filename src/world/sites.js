/**
 * Fixed map locations that both the level geometry and the mission logic reference.
 */
export const serviceBay = { x: 190, z: -960, r: 32 };

export const canyonNav = { x: 125, z: -1440, r: 90 };

export const supplyBay = { x: 260, z: -2380, r: 32 };

export const ridgeGate = { x: 210, z: -2610, width: 150, height: 32 };

export const ridgeNav = { x: 120, z: -2860, r: 95 };

export const batterySite = { x: -115, z: -3230 };

export const flightLink = { x: 100, z: -3490, r: 62, duration: 40 };

export const beaconSite = { x: 182, z: -3510 };

export const extraction = { x: 220, z: -3830, r: 42 };

export const reactorSite = { x: 65, z: -2110 };

export const routePoints = [
  serviceBay,
  { x: 105, z: -1180 },
  canyonNav,
  { x: 25, z: -1640 },
  { x: 55, z: -1790 },
  reactorSite,
  supplyBay,
  { x: 210, z: -2610 },
  ridgeNav,
  { x: 35, z: -3070 },
  { x: 65, z: -3310 },
  flightLink,
  extraction,
];
