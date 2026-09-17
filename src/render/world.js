/**
 * The world render pass: sky, terrain, structures and entities.
 */
import { DEG, M, TAU, clamp, cross, dist2, hex, norm, vadd, vmul, vsub } from '../core/math.js';
import { G } from '../sim/state.js';
import { allObjectivesComplete, reactorShielded, ridgeGateLocked } from '../entities/spawn.js';
import {
  beaconSite,
  extraction,
  flightLink,
  ridgeGate,
  serviceBay,
  supplyBay,
} from '../world/sites.js';
import { camera } from '../core/viewport.js';
import { chassisData } from '../data/chassis.js';
import {
  draw,
  drawPart,
  pass,
  setMaterial,
  blendAdditive,
  blendAlpha,
  blendMode,
  blendEnd,
} from '../core/renderer.js';
import { world } from '../core/gl.js';
import { activeTier } from '../core/quality.js';
import { allocate, renderFrame } from './pipeline.js';
import { beginLightFrame, addPointLight, MATERIAL } from '../core/lighting.js';
import { drawAllies } from '../net/coop-bridge.js';
import { drawEntity, drawMech, lineMatrix, transportParts } from '../entities/draw.js';
import { forward } from '../sim/combat.js';
import { geo } from '../core/mesh.js';
import { ground, scenery } from '../world/level.js';
import { pools, structures } from '../entities/pools.js';
import { settings } from '../core/settings.js';
import { terrainY } from '../world/terrain.js';

function drawMissionStructures() {
  for (const b of [
    { p: serviceBay, on: G.missionFlags[2] && !G.serviceUsed },
    { p: supplyBay, on: G.missionFlags[3] && G.missionFlags[4] && !G.supplyUsed },
  ]) {
    if (!b.on) continue;
    const y = terrainY(b.p.x, b.p.z);
    pass.wireTint = [0.28, 0.84, 0.96];
    blendAdditive();
    draw(
      geo.ring,
      M.transform([b.p.x, y + 0.25, b.p.z], [b.p.r, 1, b.p.r]),
      hex('#6fd5e3'),
      0.8,
      1,
    );
    blendEnd();
    for (const side of [-1, 1])
      draw(
        geo.box,
        M.transform([b.p.x + side * 24, y + 25.9, b.p.z + 5.2], [5, 0.5, 0.15]),
        hex('#6fd5e3'),
        1,
        1,
      );
  }
  drawRidgeStructures();
  if (structures.reactor.alive && reactorShielded()) {
    blendAdditive();
    pass.wireTint = [0.28, 0.77, 0.94];
    if (!pass.imagingPass)
      draw(
        geo.sphere,
        M.transform(
          [structures.reactor.x, structures.reactor.y + 26, structures.reactor.z],
          [41, 39, 41],
        ),
        hex('#70c6e8'),
        0.065,
        1,
      );
    for (let i = 0; i < 3; i++)
      draw(
        geo.ring,
        M.transform(
          [structures.reactor.x, structures.reactor.y + 26, structures.reactor.z],
          [42, 42, 42],
          [Math.PI / 2, (i * Math.PI) / 3 + G.realTime * 0.12, 0],
        ),
        hex('#5aacbb'),
        pass.imagingPass ? 0.65 : 0.14,
        1,
      );
    blendEnd();
  }
}

function drawRidgeStructures() {
  const gy = terrainY(ridgeGate.x, ridgeGate.z),
    locked = ridgeGateLocked();
  pass.wireTint = locked ? [1, 0.48, 0.18] : [0.28, 0.84, 0.76];
  for (const side of [-1, 1])
    draw(
      geo.box,
      M.transform([ridgeGate.x + side * 78, gy + 30, ridgeGate.z + 9.1], [2, 2, 0.2]),
      hex(locked ? '#f7a04f' : '#8be3c1'),
      1,
      1,
    );
  if (locked) {
    blendAdditive();
    if (!pass.imagingPass)
      draw(
        geo.box,
        M.transform([ridgeGate.x, gy + 16, ridgeGate.z], [75, 16, 0.5]),
        hex('#e7a758'),
        0.08,
        1,
      );
    for (let i = 0; i < 7; i++)
      draw(
        geo.box,
        M.transform([ridgeGate.x, gy + 2 + i * 4.5, ridgeGate.z + 0.1], [75, 0.06, 0.1]),
        hex('#ffba63'),
        0.55,
        1,
      );
    blendEnd();
  }
  const on = G.missionFlags[5] && G.missionFlags[6],
    col = G.missionFlags[7] ? hex('#ace493') : on ? hex('#72dee4') : hex('#bf9465');
  pass.wireTint = col;
  const by = terrainY(beaconSite.x, beaconSite.z),
    base = M.transform([beaconSite.x, by + 48, beaconSite.z], [1, 1, 1], [0, G.realTime * 0.22, 0]);
  draw(geo.dish, M.mul(base, M.transform([0, 0, 0], [13, 10, 10], [-0.55, 0, 0])), hex('#a9bfb3'));
  draw(geo.sphere, M.transform([beaconSite.x, by + 57, beaconSite.z], [0.9, 0.9, 0.9]), col, 1, 1);
  const fy = terrainY(flightLink.x, flightLink.z);
  blendAdditive();
  draw(
    geo.ring,
    M.transform([flightLink.x, fy + 0.25, flightLink.z], [flightLink.r, 1, flightLink.r]),
    col,
    on ? 0.9 : 0.28,
    1,
  );
  if (on) {
    draw(
      geo.ring,
      M.transform([flightLink.x, fy + 0.28, flightLink.z], [flightLink.r - 4, 1, flightLink.r - 4]),
      col,
      0.3,
      1,
    );
    if (!pass.imagingPass)
      draw(
        geo.cyl,
        M.transform([beaconSite.x, by + 71, beaconSite.z], [0.35, 14, 0.35]),
        col,
        0.28,
        1,
      );
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU,
        x = flightLink.x + Math.sin(a) * 57,
        z = flightLink.z + Math.cos(a) * 57,
        filled = i < Math.floor((G.linkTime / flightLink.duration) * 20);
      draw(
        geo.box,
        M.transform([x, fy + 0.3, z], [1.6, 0.07, 0.65], [0, a, 0]),
        col,
        filled ? 0.9 : 0.13,
        1,
      );
    }
  }
  blendEnd();
}

/**
 * Offer this frame's dynamic lights.
 *
 * Everything that glows in the world also lights what is around it: rounds in flight,
 * beam weapons along their length, and the brief flare of an impact. The budget is small,
 * so `addPointLight` ranks them and keeps the ones that will actually be visible.
 */
function emitSceneLights() {
  if (pass.imagingPass) return;

  for (const p of pools.projectiles) {
    const missile = p.type === 'missile';
    addPointLight(
      p.p,
      [
        p.color[0] * (missile ? 5 : 3),
        p.color[1] * (missile ? 5 : 3),
        p.color[2] * (missile ? 5 : 3),
      ],
      missile ? 34 : 22,
      missile ? 1.3 : 1,
    );
  }

  for (const b of pools.beams) {
    // One light at the midpoint rather than along the length: a beam is on screen for a
    // fraction of a second and nobody can tell it is not a line light.
    const fade = b.life / b.max;
    const mid = [(b.a[0] + b.b[0]) / 2, (b.a[1] + b.b[1]) / 2, (b.a[2] + b.b[2]) / 2];
    addPointLight(mid, [b.c[0] * 9 * fade, b.c[1] * 9 * fade, b.c[2] * 9 * fade], 60, 2);
  }

  for (const p of pools.particles) {
    if (p.smoke) continue;
    const fade = clamp(p.life / 0.3, 0, 1);
    if (fade < 0.25) continue;
    addPointLight(
      p.p,
      [p.color[0] * 7 * fade, p.color[1] * 7 * fade, p.color[2] * 7 * fade],
      18 + p.size * 5,
      1.1,
    );
  }
}

export function renderWorld() {
  pass.imagingPass = G.state !== 'menu' && G.player.imaging;
  if (G.state === 'menu') {
    const x = 30 + Math.sin(G.realTime * 0.09) * 3,
      z = 143 + Math.cos(G.realTime * 0.06) * 2;
    camera.cameraEye = [x, terrainY(0, 92) + 18.5, z];
    const look = [-17, terrainY(0, 92) + 13.1, 91];
    camera.cameraForward = norm(vsub(look, camera.cameraEye));
    camera.fov = 49 * DEG;
  } else {
    const bob =
      settings.shake && G.player.grounded
        ? Math.sin(G.player.phase * 2) * Math.min(1, Math.abs(G.player.speed) / 17) * 0.16
        : 0;
    const shake = settings.shake ? G.shakePower : 0;
    camera.cameraEye = [
      G.player.x + Math.sin(G.realTime * 67) * shake * 0.12,
      G.player.y +
        chassisData().eye +
        G.player.altitude +
        bob +
        Math.sin(G.realTime * 49) * shake * 0.1,
      G.player.z,
    ];
    camera.cameraForward = forward();
    camera.fov = (G.zoom ? 31 : 65) * DEG;
    if (settings.shake && shake > 0.01)
      camera.cameraForward = norm(
        vadd(camera.cameraForward, [
          Math.sin(G.realTime * 91) * shake * 0.002,
          Math.sin(G.realTime * 57) * shake * 0.003,
          0,
        ]),
      );
  }
  if (G.coop?.active && G.coop.guest && G.state !== 'menu')
    camera.cameraEye = vadd(camera.cameraEye, G.coop.cameraError);
  camera.cameraRight = norm(cross(camera.cameraForward, [0, 1, 0]));
  camera.cameraUp = cross(camera.cameraRight, camera.cameraForward);
  const view = M.view(camera.cameraEye, vadd(camera.cameraEye, camera.cameraForward));
  camera.viewProj = M.mul(
    M.perspective(
      camera.fov,
      camera.screenW / camera.screenH,
      0.3,
      6200,
      G.state === 'menu' ? 0 : -0.14,
    ),
    view,
  );
  beginLightFrame();
  emitSceneLights();

  const tier = activeTier();
  allocate(world.width, world.height, tier);
  renderFrame(tier, {
    drawOpaque: drawOpaqueWorld,
    drawTransparent: drawTransparentWorld,
    damage: G.damageFlash,
  });
  pass.imagingPass = false;
}

/**
 * Everything solid.
 *
 * Called once per shadow cascade and once more for the camera, so it must stay free of
 * anything that is not geometry: no blend state, no target changes, no per-frame
 * bookkeeping. The blend helpers it does reach for are no-ops during a cascade.
 */
function drawOpaqueWorld() {
  setMaterial(MATERIAL.terrain);
  pass.wireTint = [0.13, 0.53, 0.33];
  draw(ground, M.identity());
  pass.wireTint = [0.2, 0.74, 0.49];
  draw(scenery, M.identity());
  const cull = activeTier().entityDrawDistance;
  setMaterial(MATERIAL.armor);
  for (const e of pools.entities) {
    if (dist2({ x: camera.cameraEye[0], z: camera.cameraEye[2] }, e) < cull) drawEntity(e);
  }
  if (G.state === 'menu') drawMech(menuHero(), true);
  drawAllies();
  setMaterial(MATERIAL.metal);
  drawMissionStructures();
  pass.wireTint = [0.29, 0.84, 0.72];
  if (allObjectivesComplete()) {
    setMaterial(MATERIAL.armor);
    for (const p of transportParts) drawPart(p, transportMatrix());
  }
}

/** Where the extraction transport is this frame. Shared by its hull and its engine glow. */
function transportMatrix() {
  const descent = clamp(G.transportTime / 14, 0, 1);
  const y =
    terrainY(extraction.x, extraction.z) +
    28 +
    (1 - descent) * 125 +
    Math.sin(G.realTime * 0.8) * 0.5;
  return M.transform([extraction.x, y, extraction.z], [1, 1, 1], [0, -0.22, 0]);
}

/**
 * Engine glow, the landing rings and the beacon column.
 *
 * The transport arrives only once all three sectors and the flight codes are secure, so
 * none of this exists for most of a mission.
 */
function drawTransportEffects() {
  if (!allObjectivesComplete()) return;

  pass.wireTint = [0.29, 0.84, 0.72];
  const mat = transportMatrix();

  blendAdditive();
  for (const side of [-1, 1])
    for (const z of [-12, 3])
      draw(
        geo.cone,
        M.mul(
          mat,
          M.transform([side * 23, -10, z], [1.9, 4 + Math.sin(G.realTime * 20) * 0.2, 1.9]),
        ),
        hex('#9fbac2'),
        0.15,
        1,
      );
  blendEnd();

  const y = terrainY(extraction.x, extraction.z);
  blendAdditive();
  draw(
    geo.ring,
    M.transform([extraction.x, y + 0.3, extraction.z], [42, 1, 42]),
    hex('#99dda2'),
    0.8,
    1,
  );
  draw(
    geo.ring,
    M.transform(
      [extraction.x, y + 0.3, extraction.z],
      [32 + Math.sin(G.realTime * 2) * 3, 1, 32 + Math.sin(G.realTime * 2) * 3],
    ),
    hex('#b9deb0'),
    0.35,
    1,
  );
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU,
      x = extraction.x + Math.sin(a) * 45,
      z = extraction.z + Math.cos(a) * 45;
    draw(
      geo.sphere,
      M.transform([x, terrainY(x, z) + 1, z], [0.6, 0.5, 0.6]),
      hex('#adffad'),
      1,
      1,
    );
  }
  draw(
    geo.cyl,
    M.transform([extraction.x, y + 30, extraction.z], [1, 30, 1]),
    hex('#b8eead'),
    0.12,
    1,
  );
  blendEnd();
}

/** The chassis on show behind the menu. */
function menuHero() {
  return {
    x: 0,
    z: 92,
    y: terrainY(0, 92),
    scale: chassisData().previewScale,
    yaw: Math.PI + 0.19,
    phase: 0,
    speed: 0,
    alive: true,
  };
}

/**
 * Everything that blends: contact shadows on the lowest tier, engine glow, the extraction
 * markers, smoke, sparks, beams and rounds in flight. Drawn once, into the camera's view
 * only — none of it casts.
 */
function drawTransparentWorld() {
  const tier = activeTier();

  // With no shadow cascades there is nothing anchoring a machine to the ground, so the
  // original's blob decals come back as a fallback. Above that tier they would only
  // double-darken what the cascades already drew.
  if (tier.shadowCascades === 0 && !pass.imagingPass) {
    blendAlpha();
    for (const e of pools.entities) {
      if (dist2({ x: camera.cameraEye[0], z: camera.cameraEye[2] }, e) > tier.entityDrawDistance)
        continue;
      const r =
        e.type === 'mech' ? 10 * e.scale : e.type === 'tower' ? 20 : e.type === 'uplink' ? 33 : 7;
      draw(
        geo.disk,
        M.transform([e.x, e.y + 0.1, e.z], [r, 0.014, r * 0.8]),
        [0.12, 0.14, 0.12],
        0.22,
      );
    }
    if (G.state === 'menu') {
      const hero = menuHero();
      draw(
        geo.disk,
        M.transform([hero.x, hero.y + 0.13, hero.z], [19, 0.02, 12]),
        [0.11, 0.14, 0.12],
        0.32,
      );
    }
    blendEnd();
  }

  setMaterial(MATERIAL.emissive);
  drawTransportEffects();

  blendAlpha();
  for (const p of pools.particles) {
    if (!p.smoke) continue;
    draw(
      geo.sphere,
      M.transform(p.p, [p.size, p.size, p.size]),
      p.color,
      clamp((p.life / p.max) * 0.42, 0, 0.42),
      0,
    );
  }
  blendMode('add');
  for (const p of pools.particles) {
    if (p.smoke) continue;
    draw(
      geo.bevel,
      M.transform(p.p, [p.size * 0.35, p.size * 0.35, p.size * 0.35], [p.life * 3, p.life * 2, 0]),
      p.color,
      clamp(p.life / 0.3, 0, 1),
      1,
    );
  }
  for (const b of pools.beams) {
    draw(geo.cyl, lineMatrix(b.a, b.b, b.width * 2.6), b.c, (b.life / b.max) * 0.28, 1);
    draw(geo.cyl, lineMatrix(b.a, b.b, b.width), b.c, b.life / b.max, 1);
  }
  for (const p of pools.projectiles) {
    const tail = vsub(p.p, vmul(norm(p.v), p.type === 'missile' ? 3 : 8));
    draw(geo.cyl, lineMatrix(tail, p.p, p.type === 'missile' ? 0.33 : 0.23), p.color, 1, 1);
    draw(geo.sphere, M.transform(p.p, [0.38, 0.38, 0.38]), [1, 0.9, 0.6], 1, 1);
  }
  blendEnd();
}
