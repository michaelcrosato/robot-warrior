/**
 * Objective tracking, repair bays and sector progression.
 */
import { G, timers } from './state.js';
import {
  allObjectivesComplete,
  basinThreats,
  linkThreats,
  makeMech,
  ridgeGateLocked,
  ridgeResponseThreats,
} from '../entities/spawn.js';
import { announce, endMission, toast, updateEnemies } from '../net/coop-bridge.js';
import {
  beginRidgeTransit,
  launchLinkWave,
  repairMachine,
  updatePlayer,
  updateProjectiles,
} from './update.js';
import {
  canyonNav,
  extraction,
  flightLink,
  ridgeGate,
  ridgeNav,
  serviceBay,
  supplyBay,
} from '../world/sites.js';
import { dist2, hex } from '../core/math.js';
import { pools, structures } from '../entities/pools.js';
import { squadAll, squadAny } from '../net/protocol.js';
import { terrainY } from '../world/terrain.js';

export function landingThreats() {
  return pools.entities.filter(
    (e) => e.alive && (e.type === 'mech' || e.type === 'turret') && dist2(e, extraction) < 155,
  );
}

export function updateRepairBays(dt) {
  // Both repair bays have their own one-use supply stock.
  for (const bay of [
    { site: serviceBay, key: 'basin', active: G.missionFlags[2], used: G.serviceUsed },
    {
      site: supplyBay,
      key: 'ridge',
      active: G.missionFlags[3] && G.missionFlags[4],
      used: G.supplyUsed,
    },
  ]) {
    if (bay.used) continue;
    const isRidge = bay.key === 'ridge',
      hintKey = isRidge ? 'ridgeBayHint' : 'bayHint';
    let elapsed = isRidge ? G.supplyTime : G.serviceTime;
    if (bay.active && dist2(G.player, bay.site) < bay.site.r && G.player.altitude < 3) {
      if (!timers[hintKey]) {
        timers[hintKey] = true;
        announce(
          (isRidge ? 'RIDGE BAY' : 'FIELD BAY') +
            ' / Stop inside the blue ring. Hold for 6 seconds.',
          null,
          7,
        );
      }
      elapsed =
        Math.abs(G.player.speed) < 1.5 && G.player.shutdown <= 0
          ? elapsed + dt
          : Math.max(0, elapsed - dt * 2);
    } else elapsed = Math.max(0, elapsed - dt * 2);
    if (isRidge) G.supplyTime = elapsed;
    else G.serviceTime = elapsed;
    if (elapsed >= 6) repairMachine(bay.key);
  }
}

export function updateMission(dt) {
  G.missionTime += dt;
  if (G.coop?.host && G.coop.active) G.coop.updatePilots(dt);
  else updatePlayer(dt);
  if (G.state !== 'playing') return;
  updateEnemies(dt);
  if (G.state !== 'playing') return;
  updateProjectiles(dt);
  if (G.state !== 'playing') return;
  if (G.missionTime > 3 && !timers.firstHint) {
    timers.firstHint = true;
    announce('CONTROL / [B] Full throttle. [R] Select target. [I] Enhanced Imaging.', null, 10);
  }
  if (!G.missionFlags[2] && G.missionFlags[0] && G.missionFlags[1] && basinThreats().length === 0) {
    G.missionFlags[2] = true;
    G.missionStage = 'transit';
    G.navIndex = 2;
    G.score += 800;
    G.sectorBanner = {
      title: 'KESTREL BASIN SECURED',
      sub: 'CROSS NEEDLE PASS / NAV CHARLIE',
      time: 6,
    };
    announce(
      'CONTROL / Basin secure. Repair at the field bay. Cross Needle Pass.',
      'basinSecure',
      10,
    );
    for (const e of [
      makeMech(-5, -1260, 'PASS HOUND 07', 'scout'),
      makeMech(215, -1510, 'PASS HOUND 08', 'scout'),
    ])
      e.zone = 'pass';
  }
  if (
    G.missionFlags[2] &&
    !G.missionFlags[3] &&
    squadAny((p) => dist2(p, canyonNav) < canyonNav.r)
  ) {
    G.missionFlags[3] = true;
    G.score += 500;
    if (!structures.reactor.alive) beginRidgeTransit();
    else {
      G.missionStage = 'works';
      G.navIndex = structures.westFeed.alive ? 3 : structures.eastFeed.alive ? 4 : 5;
      G.sectorBanner = { title: 'ASHFALL WORKS', sub: 'SECTOR 02 / CUT BOTH POWER FEEDS', time: 6 };
      announce(
        'CONTROL / Ashfall Works ahead. Cut both power feeds to expose the reactor.',
        'works',
        10,
      );
    }
  }
  if (G.coop?.active) G.coop.repairAll(dt);
  else updateRepairBays(dt);
  if (
    G.missionFlags[3] &&
    G.missionFlags[4] &&
    !G.missionFlags[5] &&
    squadAny((p) => dist2(p, ridgeNav) < ridgeNav.r || p.z < -3070)
  ) {
    G.missionFlags[5] = true;
    G.missionStage = structures.skyguard.alive ? 'ridge' : 'link';
    G.navIndex = structures.skyguard.alive ? 7 : 8;
    G.score += 600;
    G.sectorBanner = {
      title: 'BLACKGLASS RIDGE',
      sub:
        'SECTOR 03 / ' +
        (structures.skyguard.alive
          ? 'DESTROY THE SKYGUARD BATTERY'
          : 'SECURE THE FLIGHT-CONTROL LINK'),
      time: 7,
    };
    announce(
      structures.skyguard.alive
        ? 'CONTROL / Blackglass Ridge. Destroy the Skyguard battery at NAV HOTEL.'
        : 'CONTROL / Skyguard is down. Secure the flight-control codes at NAV INDIA.',
      'ridgeEntry',
      10,
    );
  }
  if (G.missionFlags[5] && G.missionFlags[6] && !G.missionFlags[7]) {
    const linkPilot = G.coop?.active
      ? G.coop
          .living()
          .map((r) => G.coop.playerOf(r))
          .find(
            (p) =>
              dist2(p, flightLink) < flightLink.r &&
              p.altitude < 3 &&
              Math.abs(p.speed) < 2.2 &&
              p.shutdown <= 0,
          ) ||
        G.coop
          .living()
          .map((r) => G.coop.playerOf(r))
          .find((p) => dist2(p, flightLink) < flightLink.r) ||
        G.player
      : G.player;
    const inRange = dist2(linkPilot, flightLink) < flightLink.r,
      onGround = linkPilot.altitude < 3,
      stopped = Math.abs(linkPilot.speed) < 2.2;
    G.linkBlocked = linkThreats().length > 0;
    G.linkStatus = !inRange
      ? 'MOVE TO NAV INDIA'
      : !onGround
        ? 'LAND INSIDE THE RING'
        : linkPilot.shutdown > 0
          ? 'REACTOR OFFLINE'
          : !stopped
            ? 'PRESS X TO STOP'
            : G.linkBlocked
              ? 'LINK JAMMED / CLEAR THE RING'
              : G.linkTime >= flightLink.duration
                ? 'TRANSFER READY / DEFEAT RESPONSE'
                : 'RECEIVING FLIGHT CODES';
    if (inRange && onGround && stopped && linkPilot.shutdown <= 0) {
      if (G.linkWave === 0) launchLinkWave(1);
      if (!G.linkBlocked && G.linkTime < flightLink.duration)
        G.linkTime = Math.min(flightLink.duration, G.linkTime + dt);
    }
    if (G.linkTime >= 20 && G.linkWave === 1) launchLinkWave(2);
    if (G.linkBlocked && !timers.linkJammed) {
      timers.linkJammed = true;
      announce(
        'FLIGHT LINK / Enemy inside the perimeter. Transfer paused. Progress saved.',
        'linkJammed',
        8,
      );
    }
    if (!G.linkBlocked) timers.linkJammed = false;
    if (
      G.linkTime >= flightLink.duration &&
      G.linkWave === 2 &&
      ridgeResponseThreats().length === 0
    ) {
      G.missionFlags[7] = true;
      G.missionStage = 'extract';
      G.navIndex = 9;
      G.score += 2600;
      G.transportTime = 0;
      G.linkStatus = 'FLIGHT CODES SECURED';
      G.sectorBanner = {
        title: 'FLIGHT PATH SECURED',
        sub: 'NAV JULIET / REACH THE TRANSPORT',
        time: 7,
      };
      announce(
        'TRANSPORT / Flight codes received. Move to NAV JULIET for extraction.',
        'flightClear',
        10,
      );
    }
  }
  if (allObjectivesComplete()) {
    G.transportTime += dt;
    if (
      G.transportTime >= 14 &&
      squadAll(
        (p) => dist2(p, extraction) < extraction.r && p.altitude < 3 && Math.abs(p.speed) < 2.2,
      ) &&
      landingThreats().length === 0
    ) {
      if (!G.extractAnnounced) {
        G.extractAnnounced = true;
        announce('TRANSPORT / Hold position. Extraction in progress.', 'extract', 6);
      }
      G.extractTime += dt;
      if (G.extractTime >= 5) endMission(true);
    } else G.extractTime = Math.max(0, G.extractTime - dt * 2);
  }
  if (!timers.idleHint && G.missionTime > 25 && dist2(G.player, { x: 0, z: 92 }) < 60) {
    timers.idleHint = true;
    toast('Set speed with W or B. Use A and D to turn. Press X to stop.', 7);
  }
  if (!timers.imagingHint && G.player.z < -1120) {
    timers.imagingHint = true;
    announce('SENSOR / Press I for Enhanced Imaging. Wireframe view is available.', null, 7);
  }
  if (G.player.z < -1650 && !G.missionFlags[3] && !timers.routeWarning) {
    timers.routeWarning = true;
    announce('CONTROL / Complete the basin objectives and cross NAV CHARLIE first.', null, 8);
  }
  if (
    dist2(G.player, ridgeGate) < 130 &&
    ridgeGateLocked() &&
    G.missionTime > (timers.gateHint || 0)
  ) {
    timers.gateHint = G.missionTime + 18;
    announce(
      'NORTH GATE / Complete the basin route and destroy the Ashfall reactor to open the gate.',
      null,
      8,
    );
  }
  if (G.player.z < -3000 && !G.missionFlags[5] && G.missionTime > (timers.ridgeOrder || 0)) {
    timers.ridgeOrder = G.missionTime + 22;
    announce('CONTROL / Complete the basin route and reactor objective first.', null, 8);
  }
  if (G.player.z < -1560 && G.player.z > -2700 && G.missionTime > (timers.exhaust || 0)) {
    timers.exhaust = G.missionTime + 0.7;
    for (const p of [
      [-205, -2090],
      [-285, -2000],
      [330, -2230],
    ])
      pools.particles.push({
        p: [p[0], terrainY(...p) + 70, p[1]],
        v: [1.2, 4.2, 0.4],
        color: hex('#777d74'),
        size: 3,
        life: 7,
        max: 7,
        smoke: true,
      });
  }
  if (G.sectorBanner) G.sectorBanner.time -= dt;
  G.imagingSwitch = Math.max(0, G.imagingSwitch - dt);
}
