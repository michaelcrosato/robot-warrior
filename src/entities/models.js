/**
 * Mech model construction, shared by player and enemy chassis.
 */
import { hex } from '../core/math.js';
import { packParts, part } from '../core/renderer.js';
import { palette } from '../core/palette.js';

function makeMechModel(enemy = false, heavy = false) {
  const c = enemy ? palette.hostile : palette.armor,
    e = enemy ? palette.hostileLight : palette.edge,
    j = palette.joint,
    d = palette.dark,
    a = palette.accent;
  const torso = [],
    legs = [],
    arms = [[], []];
  const add = (arr, g, p, s, col, r = [0, 0, 0], glow = 0, component = 'core') => {
    const v = part(g, p, s, col, r, glow);
    v.component = component;
    arr.push(v);
  };
  add(torso, 'bevel', [0, 12.7, 0], [8.4, 7.2, 5.8], c);
  add(torso, 'bevel', [0, 15.9, 1.45], [5.1, 3, 5.2], e, [0.12, 0, 0], 0, 'head');
  add(torso, 'bevel', [0, 16.25, 4.4], [4.15, 1.13, 0.3], palette.visor, [0.12, 0, 0], 0.8, 'head');
  add(torso, 'box', [0, 16.25, 4.61], [0.2, 1.2, 0.14], d, [0, 0, 0], 0, 'head');
  add(torso, 'bevel', [0, 12.35, 3.01], [3.8, 3.4, 0.55], d);
  add(torso, 'box', [0, 13.25, 3.35], [2.55, 0.25, 0.17], a, [0, 0, 0], 0.2);
  for (let n = 0; n < 4; n++) add(torso, 'box', [0, 12.45 - n * 0.43, 3.34], [2.5, 0.16, 0.2], j);
  add(torso, 'bevel', [0, 11.6, -3.55], [6.8, 5.3, 2.4], d);
  for (const s of [-1, 1]) {
    const comp = s < 0 ? 'leftTorso' : 'rightTorso';
    add(torso, 'bevel', [s * 3.9, 12.8, 0.1], [2.5, 6.8, 5.1], c, [0, 0, s * -0.11], 0, comp);
    add(torso, 'box', [s * 4.15, 14.6, 2.63], [1.25, 2.2, 0.23], a, [0, 0, 0], 0, comp);
    add(torso, 'cyl', [s * 2.2, 13.8, -4.6], [1.45, 4.3, 1.45], e, [0, 0, 0], 0, comp);
    add(torso, 'cyl', [s * 2.2, 16.02, -4.6], [0.95, 0.16, 0.95], d, [0, 0, 0], 0, comp);
    add(torso, 'bevel', [s * 6.5, 17.15, -0.55], [5, 5.5, 5.7], c, [0.035, 0, s * -0.055], 0, comp);
    add(torso, 'box', [s * 6.5, 17.3, 2.42], [4.25, 4.4, 0.24], d, [0, 0, 0], 0, comp);
    add(torso, 'box', [s * 6.5, 19.85, -0.5], [4.65, 0.22, 4.7], e, [0, 0, 0], 0, comp);
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++) {
        add(
          torso,
          'cyl',
          [s * 6.5 + (col - 1) * 1.25, 17.4 + (row - 1) * 1.24, 2.65],
          [0.84, 0.35, 0.84],
          j,
          [Math.PI / 2, 0, 0],
          0,
          comp,
        );
        add(
          torso,
          'cyl',
          [s * 6.5 + (col - 1) * 1.25, 17.4 + (row - 1) * 1.24, 2.86],
          [0.47, 0.08, 0.47],
          a.map((v) => v * 0.52),
          [Math.PI / 2, 0, 0],
          0,
          comp,
        );
      }
    const ai = s < 0 ? 0 : 1,
      ac = s < 0 ? 'leftArm' : 'rightArm';
    add(arms[ai], 'cyl', [s * 5.3, 12.7, 0], [2.6, 2.6, 2.6], j, [0, 0, Math.PI / 2], 0, ac);
    add(arms[ai], 'bevel', [s * 6.2, 10.8, 0.4], [2.8, 5.1, 3.4], c, [0.05, 0, s * 0.055], 0, ac);
    add(arms[ai], 'bevel', [s * 6.2, 9.15, 2.65], [3.15, 2.8, 6.2], d, [0, 0, 0], 0, ac);
    add(arms[ai], 'bevel', [s * 6.2, 10.55, 2.15], [2.9, 0.65, 4.8], e, [0, 0, 0], 0, ac);
    add(arms[ai], 'cyl', [s * 6.2, 9.2, 6.05], [1.5, 2.3, 1.5], j, [Math.PI / 2, 0, 0], 0, ac);
    add(arms[ai], 'cyl', [s * 6.2, 9.2, 7.24], [1.08, 0.17, 1.08], a, [Math.PI / 2, 0, 0], 0.1, ac);
    add(arms[ai], 'cyl', [s * 6.2, 9.2, 7.35], [0.7, 0.05, 0.7], d, [Math.PI / 2, 0, 0], 0, ac);
    const leg = [];
    const lc = s < 0 ? 'leftLeg' : 'rightLeg';
    add(leg, 'cyl', [s * 2.6, 8.5, 0], [2.8, 2.1, 2.8], j, [0, 0, Math.PI / 2], 0, lc);
    add(leg, 'bevel', [s * 2.65, 6.9, -0.9], [3.1, 4.3, 3.6], c, [-0.35, 0, s * -0.025], 0, lc);
    add(leg, 'cyl', [s * 2.65, 5, -1.7], [2.6, 3.3, 2.6], j, [0, 0, Math.PI / 2], 0, lc);
    add(leg, 'bevel', [s * 2.65, 3.1, -0.4], [2.65, 4.4, 2.9], e, [0.42, 0, 0], 0, lc);
    add(leg, 'box', [s * 2.65, 3.35, 1.02], [1.6, 2.0, 0.38], c, [0.42, 0, 0], 0, lc);
    add(leg, 'cyl', [s * 3.6, 4.1, -0.15], [0.32, 4.3, 0.32], palette.light, [0.38, 0, 0], 0, lc);
    add(leg, 'bevel', [s * 2.65, 0.85, 1.1], [3.6, 1.7, 5.3], d, [0, 0, 0], 0, lc);
    add(leg, 'box', [s * 2.65, 1.71, 1.7], [2.8, 0.25, 3.4], c, [0, 0, 0], 0, lc);
    add(leg, 'box', [s * 2.65, 0.85, 3.81], [2.5, 0.54, 0.18], a, [0, 0, 0], 0, lc);
    legs.push(leg);
  }
  add(torso, 'cyl', [0, 8.6, 0], [5.2, 1.9, 5.2], j);
  add(torso, 'bevel', [0, 8, 0], [6.1, 2.6, 4.1], c);
  add(torso, 'cyl', [-3.8, 21.2, -0.6], [0.15, 4.4, 0.15], d, [0, 0, -0.12], 0, 'leftTorso');
  add(torso, 'cyl', [-4.1, 23.5, -0.6], [0.2, 0.35, 0.2], a, [0, 0, 0], 0.8, 'leftTorso');
  return { torso: packParts(torso), arms: arms.map(packParts), legs: legs.map(packParts) };
}

function makeVariantModel(kind, enemy = false) {
  if (kind === 'warden') return makeMechModel(enemy);
  const heavy = kind === 'bastion',
    c = enemy ? palette.hostile : hex(heavy ? '#626858' : '#617979'),
    e = enemy ? palette.hostileLight : hex(heavy ? '#93957a' : '#92aaa4'),
    d = palette.dark,
    j = palette.joint,
    a = heavy ? hex('#cc9b61') : hex('#caaf72'),
    torso = [],
    legs = [[], []],
    arms = [[], []];
  const put = (arr, g, p, s, col, r = [0, 0, 0], component = 'core', glow = 0) => {
    const v = part(g, p, s, col, r, glow);
    v.component = component;
    arr.push(v);
  };
  put(torso, 'bevel', [0, 12.1, 0], heavy ? [10.4, 7.8, 6.7] : [6.7, 6.3, 4.8], c);
  put(
    torso,
    'bevel',
    [0, 16.2, 2.1],
    heavy ? [5.5, 3.1, 5.1] : [4, 2.4, 4.8],
    e,
    [0.18, 0, 0],
    'head',
  );
  put(
    torso,
    'bevel',
    [0, 16.45, 4.57],
    heavy ? [4.35, 1.0, 0.3] : [3.15, 0.65, 0.28],
    palette.visor,
    [0.18, 0, 0],
    'head',
    0.8,
  );
  put(torso, 'bevel', [0, 12.3, 3.4], heavy ? [6.6, 4.6, 0.65] : [3.2, 3.6, 0.55], d);
  for (let n = 0; n < 4; n++)
    put(torso, 'box', [0, 13.3 - n * 0.65, 3.8], [heavy ? 4.8 : 2.4, 0.2, 0.2], e);
  put(torso, 'box', [0, 14.2, 3.8], [heavy ? 5.5 : 2.6, 0.5, 0.25], a);
  put(torso, 'cyl', [0, 8.4, 0], [5.8, 2, 5.8], j);
  put(torso, 'bevel', [0, 8.1, 0], heavy ? [7.1, 2.7, 4.8] : [5.5, 2, 3.6], c);
  for (const side of [-1, 1]) {
    const i = side < 0 ? 0 : 1,
      tc = side < 0 ? 'leftTorso' : 'rightTorso',
      ac = side < 0 ? 'leftArm' : 'rightArm',
      lc = side < 0 ? 'leftLeg' : 'rightLeg';
    put(
      torso,
      'bevel',
      [side * 4.4, 13.5, 0],
      heavy ? [3.8, 7.5, 6.4] : [2.2, 5.1, 4.1],
      e,
      [0, 0, side * -0.09],
      tc,
    );
    if (heavy) {
      put(
        torso,
        'bevel',
        [side * 6.3, 17.9, -0.7],
        [5.4, 4.3, 7.4],
        c,
        [0.04, 0, side * -0.05],
        tc,
      );
      put(torso, 'box', [side * 6.3, 18, 3.06], [4.7, 3.6, 0.25], d, [0, 0, 0], tc);
      for (let row = 0; row < 2; row++)
        for (let col = 0; col < 3; col++)
          put(
            torso,
            'cyl',
            [side * 6.3 + (col - 1) * 1.37, 17.3 + row * 1.45, 3.3],
            [0.93, 0.35, 0.93],
            a,
            [Math.PI / 2, 0, 0],
            tc,
          );
      put(torso, 'bevel', [side * 3, 12.5, -4.3], [3.2, 6.7, 3.2], d, [0, 0, 0], tc);
    } else {
      put(torso, 'bevel', [side * 4.2, 17.5, -1.6], [2.6, 3.2, 5.5], c, [0.09, 0, 0], tc);
      for (let row = 0; row < 2; row++)
        put(
          torso,
          'cyl',
          [side * 4.2, 16.9 + row * 1.2, 1.25],
          [0.84, 0.3, 0.84],
          a,
          [Math.PI / 2, 0, 0],
          tc,
        );
      put(torso, 'cyl', [side * 2.3, 12, -3.4], [1.6, 5.8, 1.6], e, [0, 0, 0], tc);
      put(torso, 'bevel', [side * 2.7, 15.2, -3.7], [1.7, 2, 3.8], d, [0.4, 0, 0], tc);
    }
    put(
      arms[i],
      'cyl',
      [side * 5.6, 12.8, 0.1],
      [2.6, heavy ? 3.2 : 2.3, 2.6],
      j,
      [0, 0, Math.PI / 2],
      ac,
    );
    put(
      arms[i],
      'bevel',
      [side * 6.2, 10.7, 0.5],
      heavy ? [3.7, 5.7, 4.3] : [2.1, 4.8, 2.8],
      c,
      [0, 0, side * 0.07],
      ac,
    );
    put(
      arms[i],
      'bevel',
      [side * 6.2, 9.5, 3.6],
      heavy ? [3.8, 3.6, 8.4] : [2.3, 2.3, 5.8],
      d,
      [0, 0, 0],
      ac,
    );
    put(
      arms[i],
      'box',
      [side * 6.2, 11.1, 3.5],
      heavy ? [3.2, 0.5, 6.3] : [1.9, 0.35, 4.3],
      e,
      [0, 0, 0],
      ac,
    );
    const barrel = heavy && side > 0 ? 1.05 : 0.61;
    put(
      arms[i],
      'cyl',
      [side * 6.2, 9.6, heavy ? 8 : 6.5],
      [barrel * 2, heavy ? 3.8 : 2.4, barrel * 2],
      j,
      [Math.PI / 2, 0, 0],
      ac,
    );
    put(
      arms[i],
      'cyl',
      [side * 6.2, 9.6, heavy ? 9.95 : 7.75],
      [barrel * 1.7, 0.16, barrel * 1.7],
      a,
      [Math.PI / 2, 0, 0],
      ac,
    );
    if (heavy) {
      put(arms[i], 'box', [side * 6.2, 9.6, 7.8], [4.1, 0.45, 0.5], e, [0, 0, 0], ac);
      put(arms[i], 'box', [side * 6.2, 9.6, 6.8], [4.1, 0.45, 0.5], e, [0, 0, 0], ac);
    }
    const leg = legs[i];
    put(leg, 'cyl', [side * 2.65, 8, 0], [2.5, 3, 2.5], j, [0, 0, Math.PI / 2], lc);
    put(
      leg,
      'bevel',
      [side * 2.65, 6.4, heavy ? -0.1 : -1.1],
      heavy ? [3.7, 4.9, 4.1] : [2.15, 4.6, 2.7],
      c,
      [-0.25, 0, 0],
      lc,
    );
    put(
      leg,
      'cyl',
      [side * 2.65, 4.7, -1.3],
      [2.5, heavy ? 3.8 : 2.6, 2.5],
      j,
      [0, 0, Math.PI / 2],
      lc,
    );
    put(
      leg,
      'bevel',
      [side * 2.65, 2.9, 0.1],
      heavy ? [3.9, 4.8, 3.8] : [1.9, 4.4, 2.4],
      e,
      [0.27, 0, 0],
      lc,
    );
    put(
      leg,
      'box',
      [side * 2.65, 3, heavy ? 2.03 : 1.4],
      heavy ? [3.3, 2.7, 0.5] : [1.4, 2.5, 0.3],
      c,
      [0.27, 0, 0],
      lc,
    );
    put(leg, 'cyl', [side * 3.7, 3.4, -0.2], [0.28, 4.6, 0.28], palette.light, [0.32, 0, 0], lc);
    put(
      leg,
      'bevel',
      [side * 2.65, 0.75, 1.3],
      heavy ? [4.7, 1.5, 6.6] : [3, 1.3, 4.9],
      d,
      [0, 0, 0],
      lc,
    );
    put(
      leg,
      'box',
      [side * 2.65, 0.8, heavy ? 4.65 : 3.8],
      heavy ? [3.4, 0.42, 0.2] : [2.4, 0.3, 0.2],
      a,
      [0, 0, 0],
      lc,
    );
  }
  put(
    torso,
    'cyl',
    [heavy ? 2.9 : -2.9, 20.1, -1.8],
    [0.13, 6, 0.13],
    e,
    [0, 0, heavy ? 0.1 : -0.16],
    'leftTorso',
  );
  return { torso: packParts(torso), legs: legs.map(packParts), arms: arms.map(packParts) };
}

export const playerModels = {
  kestrel: makeVariantModel('kestrel'),
  warden: makeVariantModel('warden'),
  bastion: makeVariantModel('bastion'),
};

export const enemyModels = {
  scout: makeVariantModel('kestrel', true),
  medium: makeVariantModel('warden', true),
  heavy: makeVariantModel('bastion', true),
};
