/**
 * The frame pipeline: shadow cascades, the HDR scene pass, and post-processing.
 *
 * Order of work, once per frame:
 *
 *   1. Fit the shadow cascades to the current view and fill them, depth only.
 *   2. Render the sky and then the world into an HDR target with a depth texture.
 *   3. Ambient occlusion from that depth buffer, blurred (desktop tiers only).
 *   4. A bloom mip chain: threshold and downsample, then tent-filter back up.
 *   5. One composite pass to the canvas — occlusion, bloom, tone map, grade, FXAA.
 *
 * The world itself is drawn by callbacks supplied by the caller, because the scene has to
 * be traversed once per cascade as well as once for the camera, and duplicating that
 * traversal is how the two fall out of step.
 */
import { gl } from '../core/gl.js';
import { M } from '../core/math.js';
import { camera } from '../core/viewport.js';
import {
  scenePrg,
  compositePrg,
  bloomDownPrg,
  bloomUpPrg,
  ssaoPrg,
  ssaoBlurPrg,
  drawFullscreen,
} from '../core/programs.js';
import { beginShadowPass, endShadowPass, renderSky, pass } from '../core/renderer.js';
import {
  createTarget,
  createShadowArray,
  disposeTarget,
  disposeShadowArray,
  bindTarget,
} from '../core/targets.js';
import {
  SUN_DIR,
  SUN_COLOR,
  SKY_COLOR,
  GROUND_COLOR,
  FOG_COLOR,
  FOG_PARAMS,
  resolveLights,
} from '../core/lighting.js';
import { updateCascades } from './shadows.js';
import { debugMode } from './debug.js';
import { G } from '../sim/state.js';

/** Bloom tuning. Threshold is in HDR units, so it sits above lit surfaces but below emissives. */
const BLOOM_THRESHOLD = 1.05;
const BLOOM_KNEE = 0.6;
const BLOOM_STRENGTH = 0.052;
const BLOOM_RADIUS = 1.15;

/** Grade. Slightly crushed and desaturated, which is the look the HUD was designed against. */
const CONTRAST = 1.045;
const SATURATION = 1.06;
const TINT = [1.0, 0.985, 0.96];
const VIGNETTE = 0.42;
const GRAIN = 0.022;

const current = {
  /** @type {any} */ scene: null,
  /** @type {any[]} */ bloomChain: [],
  /** @type {any} */ ao: null,
  /** @type {any} */ aoBlur: null,
  /** @type {any} */ shadow: null,
  width: 0,
  height: 0,
  tierId: '',
};

/**
 * (Re)allocate every target for a size and quality tier.
 *
 * Called on resize and when the tier changes. Everything is torn down and rebuilt rather
 * than resized in place: a stale attachment is the kind of fault that shows as a smear on
 * one driver and nothing at all on another.
 *
 * @param {number} width
 * @param {number} height
 * @param {import('../core/quality.js').Tier} tier
 */
export function allocate(width, height, tier) {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  if (current.width === w && current.height === h && current.tierId === tier.id) return;

  release();

  current.scene = createTarget(w, h, { depth: true });

  if (tier.bloom) {
    let bw = Math.max(2, Math.round(w * tier.bloomScale));
    let bh = Math.max(2, Math.round(h * tier.bloomScale));
    for (let i = 0; i < tier.bloomLevels && bw > 2 && bh > 2; i++) {
      current.bloomChain.push(createTarget(bw, bh));
      bw = Math.max(2, Math.floor(bw / 2));
      bh = Math.max(2, Math.floor(bh / 2));
    }
  }

  if (tier.ssao) {
    const aw = Math.max(2, Math.round(w * tier.ssaoScale));
    const ah = Math.max(2, Math.round(h * tier.ssaoScale));
    // Single channel would do, but R8 render targets are less uniformly supported than
    // RGBA8 and the saving at half resolution is not worth the branch.
    current.ao = createTarget(aw, ah, { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE });
    current.aoBlur = createTarget(aw, ah, { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE });
  }

  if (tier.shadowCascades > 0) {
    current.shadow = createShadowArray(tier.shadowSize, tier.shadowCascades);
  }

  current.width = w;
  current.height = h;
  current.tierId = tier.id;
}

/** Free every target. */
function release() {
  disposeTarget(current.scene);
  for (const t of current.bloomChain) disposeTarget(t);
  disposeTarget(current.ao);
  disposeTarget(current.aoBlur);
  disposeShadowArray(current.shadow);
  current.scene = null;
  current.bloomChain = [];
  current.ao = null;
  current.aoBlur = null;
  current.shadow = null;
  current.width = 0;
  current.height = 0;
  current.tierId = '';
}

function bindTexture(unit, target, texture) {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(target, texture);
}

/**
 * Fill the shadow cascades.
 *
 * @param {import('../core/quality.js').Tier} tier
 * @param {() => void} drawOpaque
 */
function renderShadows(tier, drawOpaque) {
  const shadow = current.shadow;
  if (!shadow) return { count: 0, splits: null, matrices: null, texelWorld: null };

  const { matrices, splits, texelWorld, count } = updateCascades(
    camera,
    tier.shadowCascades,
    tier.shadowSize,
    tier.shadowDistance,
  );

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  for (let i = 0; i < count; i++) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.framebuffers[i]);
    gl.viewport(0, 0, shadow.size, shadow.size);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    beginShadowPass(matrices[i]);
    drawOpaque();
    endShadowPass();
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { count, splits, matrices, texelWorld };
}

/** Upload the frame's lighting environment to the scene program. */
function setSceneUniforms(tier, shadowInfo) {
  gl.uniformMatrix4fv(scenePrg.uVP, false, camera.viewProj);
  gl.uniform3fv(scenePrg.uEye, camera.cameraEye);

  gl.uniform3fv(scenePrg.uSunDir, SUN_DIR);
  gl.uniform3fv(scenePrg.uSunColor, SUN_COLOR);
  gl.uniform3fv(scenePrg.uSkyColor, SKY_COLOR);
  gl.uniform3fv(scenePrg.uGroundColor, GROUND_COLOR);
  gl.uniform1f(scenePrg.uExposure, 1);

  gl.uniform3fv(scenePrg.uFogColor, FOG_COLOR);
  gl.uniform2fv(scenePrg.uFogParams, FOG_PARAMS);
  gl.uniform1f(scenePrg.uNight, G.player?.vision ? 1 : 0);
  gl.uniform1i(scenePrg.uDebug, debugMode);

  const lights = resolveLights(camera.cameraEye);
  gl.uniform1i(scenePrg.uPointCount, lights.count);
  if (lights.count > 0) {
    gl.uniform3fv(scenePrg.uPointPos, lights.positions);
    gl.uniform4fv(scenePrg.uPointColor, lights.colors);
  }

  if (shadowInfo.count > 0 && current.shadow) {
    bindTexture(4, gl.TEXTURE_2D_ARRAY, current.shadow.tex);
    gl.uniform1i(scenePrg.uShadowMap, 4);
    for (let i = 0; i < shadowInfo.count; i++) {
      gl.uniformMatrix4fv(
        gl.getUniformLocation(scenePrg.p, `uShadowMatrix[${i}]`),
        false,
        shadowInfo.matrices[i],
      );
    }
    gl.uniform4fv(scenePrg.uCascadeSplits, shadowInfo.splits);
    gl.uniform2f(scenePrg.uShadowTexel, 1 / current.shadow.size, 1 / current.shadow.size);
    gl.uniform4fv(scenePrg.uCascadeTexelWorld, shadowInfo.texelWorld);
    gl.uniform1f(scenePrg.uShadowCascades, shadowInfo.count);
    gl.uniform1f(scenePrg.uShadowTaps, tier.shadowTaps);
    gl.uniform1f(scenePrg.uShadowStrength, 0.94);
  } else {
    gl.uniform1f(scenePrg.uShadowCascades, 0);
  }
}

/** Ambient occlusion, then a separable blur. Returns the texture to sample, or null. */
function renderAO(tier) {
  if (!current.ao || !tier.ssao) return null;

  const projection = M.perspective(
    camera.fov,
    camera.screenW / camera.screenH,
    0.3,
    6200,
    G.state === 'menu' ? 0 : -0.14,
  );

  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.BLEND);

  bindTarget(current.ao);
  gl.useProgram(ssaoPrg.p);
  bindTexture(0, gl.TEXTURE_2D, current.scene.depth);
  gl.uniform1i(ssaoPrg.uDepth, 0);
  gl.uniformMatrix4fv(ssaoPrg.uProj, false, projection);
  gl.uniformMatrix4fv(ssaoPrg.uInvProj, false, M.invert(projection));
  gl.uniform1f(ssaoPrg.uRadius, 1.9);
  gl.uniform1f(ssaoPrg.uStrength, 0.85);
  gl.uniform1f(ssaoPrg.uBias, 0.035);
  gl.uniform1i(ssaoPrg.uSamples, tier.ssaoSamples);
  gl.uniform1f(ssaoPrg.uTime, G.realTime);
  drawFullscreen();

  // Two separable passes, ao -> aoBlur -> ao.
  gl.useProgram(ssaoBlurPrg.p);
  for (const [from, to, dir] of [
    [current.ao, current.aoBlur, [1, 0]],
    [current.aoBlur, current.ao, [0, 1]],
  ]) {
    bindTarget(to);
    bindTexture(0, gl.TEXTURE_2D, from.tex);
    gl.uniform1i(ssaoBlurPrg.uSource, 0);
    gl.uniform2f(ssaoBlurPrg.uTexel, 1 / from.w, 1 / from.h);
    gl.uniform2f(ssaoBlurPrg.uDirection, dir[0], dir[1]);
    drawFullscreen();
  }

  return current.ao.tex;
}

/** Bloom: threshold and downsample, then additive tent upsample. */
function renderBloom(tier) {
  const chain = current.bloomChain;
  if (!tier.bloom || chain.length === 0) return null;

  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.BLEND);

  gl.useProgram(bloomDownPrg.p);
  gl.uniform1f(bloomDownPrg.uThreshold, BLOOM_THRESHOLD);
  gl.uniform1f(bloomDownPrg.uSoftKnee, BLOOM_KNEE);

  let source = current.scene;
  for (let i = 0; i < chain.length; i++) {
    bindTarget(chain[i]);
    bindTexture(0, gl.TEXTURE_2D, source.tex);
    gl.uniform1i(bloomDownPrg.uSource, 0);
    gl.uniform2f(bloomDownPrg.uTexel, 1 / source.w, 1 / source.h);
    gl.uniform1f(bloomDownPrg.uFirstPass, i === 0 ? 1 : 0);
    drawFullscreen();
    source = chain[i];
  }

  // Back up the chain, blending each level into the one above it.
  gl.useProgram(bloomUpPrg.p);
  gl.uniform1f(bloomUpPrg.uRadius, BLOOM_RADIUS);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE);
  for (let i = chain.length - 1; i > 0; i--) {
    const from = chain[i];
    const to = chain[i - 1];
    bindTarget(to);
    bindTexture(0, gl.TEXTURE_2D, from.tex);
    gl.uniform1i(bloomUpPrg.uSource, 0);
    gl.uniform2f(bloomUpPrg.uTexel, 1 / from.w, 1 / from.h);
    drawFullscreen();
  }
  gl.disable(gl.BLEND);

  return chain[0].tex;
}

/**
 * Scan every intermediate target for values that are not finite.
 *
 * Instrumentation at each stage boundary. A NaN or an Inf in the HDR target is invisible
 * on its own, but the bloom chain downsamples it into a growing block and the composite
 * turns that block black — so knowing *which* stage first holds one is the whole question.
 *
 * Reads back a downsampled grid rather than every pixel; a NaN that matters is never a
 * single isolated texel by the time it reaches the chain.
 */
export function scanTargets() {
  const report = [];

  const scan = (name, target) => {
    if (!target) return;
    // The whole target, not a corner. An earlier version of this read only the first
    // 128x128 and reported a "scene max" that was lower than the bloom built from it,
    // which is impossible — and which is exactly the kind of wrong answer that sends an
    // investigation after the wrong component.
    const w = target.w;
    const h = target.h;
    const px = new Float32Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, px);
    if (gl.getError() !== gl.NO_ERROR) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      report.push({ name, size: `${w}x${h}`, error: 'readPixels failed' });
      return;
    }
    let nan = 0;
    let inf = 0;
    let negative = 0;
    let max = 0;
    let firstNaN = null;
    for (let i = 0; i < px.length; i++) {
      if (i % 4 === 3) continue;
      const v = px[i];
      if (Number.isNaN(v)) {
        nan++;
        if (!firstNaN) {
          const pixel = Math.floor(i / 4);
          firstNaN = [pixel % w, Math.floor(pixel / w)];
        }
      } else if (!Number.isFinite(v)) inf++;
      else {
        if (v < 0) negative++;
        if (v > max) max = v;
      }
    }
    report.push({ name, size: `${w}x${h}`, nan, inf, negative, max: +max.toFixed(2), firstNaN });
  };

  scan('scene', current.scene);
  current.bloomChain.forEach((t, i) => scan(`bloom[${i}]`, t));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return report;
}

/**
 * Render one frame.
 *
 * @param {import('../core/quality.js').Tier} tier
 * @param {{drawOpaque: () => void, drawTransparent: () => void, damage?: number}} scene
 */
export function renderFrame(tier, scene) {
  const shadowInfo = pass.imagingPass
    ? { count: 0, splits: null, matrices: null }
    : renderShadows(tier, scene.drawOpaque);

  // --- scene into the HDR target ---------------------------------------------
  bindTarget(current.scene);
  gl.clearColor(0, 0, 0, 1);
  gl.depthMask(true);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  renderSky();
  setSceneUniforms(tier, shadowInfo);
  scene.drawOpaque();
  scene.drawTransparent();

  // --- post -------------------------------------------------------------------
  const aoTexture = pass.imagingPass ? null : renderAO(tier);
  const bloomTexture = renderBloom(tier);

  bindTarget(null, current.width, current.height);
  gl.disable(gl.DEPTH_TEST);
  gl.depthMask(false);
  gl.disable(gl.BLEND);

  gl.useProgram(compositePrg.p);
  bindTexture(0, gl.TEXTURE_2D, current.scene.tex);
  gl.uniform1i(compositePrg.uScene, 0);
  bindTexture(1, gl.TEXTURE_2D, bloomTexture || current.scene.tex);
  gl.uniform1i(compositePrg.uBloom, 1);
  bindTexture(2, gl.TEXTURE_2D, aoTexture || current.scene.tex);
  gl.uniform1i(compositePrg.uAO, 2);

  gl.uniform2f(compositePrg.uTexel, 1 / current.width, 1 / current.height);
  gl.uniform1f(compositePrg.uHasBloom, bloomTexture ? 1 : 0);
  gl.uniform1f(compositePrg.uHasAO, aoTexture ? 1 : 0);
  gl.uniform1f(compositePrg.uBloomStrength, BLOOM_STRENGTH);
  gl.uniform1f(compositePrg.uFxaa, tier.fxaa && !pass.imagingPass ? 1 : 0);

  // Without float targets the scene is already clamped, so a second exposure multiply
  // here would only crush it further.
  gl.uniform1f(compositePrg.uExposure, 1);
  gl.uniform1f(compositePrg.uContrast, CONTRAST);
  gl.uniform1f(compositePrg.uSaturation, pass.imagingPass ? 1 : SATURATION);
  gl.uniform3fv(compositePrg.uTint, TINT);
  gl.uniform1f(compositePrg.uVignette, pass.imagingPass ? 0.2 : VIGNETTE);
  gl.uniform1f(compositePrg.uGrain, GRAIN);
  gl.uniform1f(compositePrg.uTime, G.realTime);
  gl.uniform1f(compositePrg.uDamage, scene.damage || 0);
  gl.uniform1f(compositePrg.uNight, G.player?.vision ? 1 : 0);

  drawFullscreen();

  gl.enable(gl.DEPTH_TEST);
  gl.depthMask(true);
}
