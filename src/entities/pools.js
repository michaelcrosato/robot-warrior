/**
 * Live object pools and named mission structures.
 */
/**
 * Live object pools. Co-op replaces whole arrays when replaying a host frame, so readers must go through this object rather than hold an array reference.
 */
export const pools = {
  entities: [],
  particles: [],
  beams: [],
  projectiles: [],
  wrecks: [],
  entityID: 0,
};

/**
 * Named mission structures, assigned by populate() on every mission reset.
 */
export const structures = {
  relay: undefined,
  uplink: undefined,
  westFeed: undefined,
  eastFeed: undefined,
  reactor: undefined,
  skyguard: undefined,
};
