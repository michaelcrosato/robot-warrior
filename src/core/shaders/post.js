/**
 * Post-processing programs.
 *
 * The scene renders into an HDR target, then: ambient occlusion (optionally), a bloom
 * mip chain, and finally one composite pass that applies occlusion, adds bloom, tone maps,
 * grades, vignettes, grains and runs FXAA on the result.
 *
 * FXAA deliberately runs last, on tone-mapped non-linear colour. Run before tone mapping
 * it keys off values that are still in HDR and either ignores real edges or smears
 * highlights.
 */
import { VERT_HEAD, FRAG_HEAD, CONSTANTS, NOISE, TONEMAP, DITHER } from './common.js';

/** Shared full-screen vertex shader. One triangle pair, positions doubling as UVs. */
export const FULLSCREEN_VS =
  VERT_HEAD +
  `
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/**
 * Bloom, step one: threshold and halve.
 *
 * The 13-tap filter is the one from Jimenez's Call of Duty presentation; a plain box
 * filter at this step is what makes bloom flicker on small bright moving things, which in
 * this game is every tracer round.
 */
export const BLOOM_DOWN_FS =
  FRAG_HEAD +
  CONSTANTS +
  `
in vec2 vUV;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uThreshold;
uniform float uSoftKnee;
uniform float uFirstPass;
out vec4 fragColor;

/**
 * Reject values that must not enter the chain.
 *
 * This is the point where one bad pixel becomes a visible defect: the 13-tap below reads a
 * neighbourhood, and each of the levels above widens it again, so a single NaN in the
 * scene target has been measured turning into three hundred thousand of them by the first
 * downsample and a black rectangle across the middle of the screen after the composite.
 *
 * NaN fails every comparison with itself, which is the only reliable way to detect it
 * here — clamping does not remove it. Infinities are clipped to a large finite value
 * rather than zeroed, because a genuinely enormous highlight should still bloom.
 */
vec3 sanitize(vec3 c) {
  vec3 finite = min(c, vec3(65000.0));
  return mix(vec3(0.0), finite, vec3(c.r == c.r, c.g == c.g, c.b == c.b));
}

vec3 prefilter(vec3 c) {
  float brightness = max(c.r, max(c.g, c.b));
  float knee = uThreshold * uSoftKnee + EPS;
  float soft = clamp(brightness - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  float contribution = max(soft, brightness - uThreshold) / max(brightness, EPS);
  return c * contribution;
}

vec3 tap(vec2 uv) { return sanitize(texture(uSource, uv).rgb); }

void main() {
  vec2 t = uTexel;
  vec3 a = tap(vUV + vec2(-2.0, 2.0) * t);
  vec3 b = tap(vUV + vec2( 0.0, 2.0) * t);
  vec3 c = tap(vUV + vec2( 2.0, 2.0) * t);
  vec3 d = tap(vUV + vec2(-2.0, 0.0) * t);
  vec3 e = tap(vUV);
  vec3 f = tap(vUV + vec2( 2.0, 0.0) * t);
  vec3 g = tap(vUV + vec2(-2.0,-2.0) * t);
  vec3 h = tap(vUV + vec2( 0.0,-2.0) * t);
  vec3 i = tap(vUV + vec2( 2.0,-2.0) * t);
  vec3 j = tap(vUV + vec2(-1.0, 1.0) * t);
  vec3 k = tap(vUV + vec2( 1.0, 1.0) * t);
  vec3 l = tap(vUV + vec2(-1.0,-1.0) * t);
  vec3 m = tap(vUV + vec2( 1.0,-1.0) * t);

  vec3 result = e * 0.125;
  result += (a + c + g + i) * 0.03125;
  result += (b + d + f + h) * 0.0625;
  result += (j + k + l + m) * 0.125;

  if (uFirstPass > 0.5) result = prefilter(result);
  fragColor = vec4(result, 1.0);
}
`;

/** Bloom, step two: 3x3 tent filter on the way back up, accumulating additively. */
export const BLOOM_UP_FS =
  FRAG_HEAD +
  `
in vec2 vUV;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform float uRadius;
out vec4 fragColor;

void main() {
  vec2 t = uTexel * uRadius;
  vec3 sum = texture(uSource, vUV + vec2(-1.0,  1.0) * t).rgb * 1.0;
  sum     += texture(uSource, vUV + vec2( 0.0,  1.0) * t).rgb * 2.0;
  sum     += texture(uSource, vUV + vec2( 1.0,  1.0) * t).rgb * 1.0;
  sum     += texture(uSource, vUV + vec2(-1.0,  0.0) * t).rgb * 2.0;
  sum     += texture(uSource, vUV).rgb * 4.0;
  sum     += texture(uSource, vUV + vec2( 1.0,  0.0) * t).rgb * 2.0;
  sum     += texture(uSource, vUV + vec2(-1.0, -1.0) * t).rgb * 1.0;
  sum     += texture(uSource, vUV + vec2( 0.0, -1.0) * t).rgb * 2.0;
  sum     += texture(uSource, vUV + vec2( 1.0, -1.0) * t).rgb * 1.0;
  fragColor = vec4(sum / 16.0, 1.0);
}
`;

/**
 * Screen-space ambient occlusion, reconstructing position from the depth buffer.
 *
 * Desktop tiers only. It is the one effect here whose cost is dominated by memory
 * bandwidth rather than arithmetic, which is exactly what a phone has least of.
 */
export const SSAO_FS =
  FRAG_HEAD +
  CONSTANTS +
  NOISE +
  `
in vec2 vUV;
uniform sampler2D uDepth;
uniform mat4 uInvProj;
uniform mat4 uProj;
uniform float uRadius;
uniform float uStrength;
uniform float uBias;
uniform int uSamples;
uniform float uTime;
out vec4 fragColor;

vec3 viewPosition(vec2 uv) {
  float d = texture(uDepth, uv).r * 2.0 - 1.0;
  vec4 clip = vec4(uv * 2.0 - 1.0, d, 1.0);
  vec4 view = uInvProj * clip;
  return view.xyz / view.w;
}

void main() {
  float depth = texture(uDepth, vUV).r;
  // Skip the sky: it is at the far plane and has no geometry to occlude.
  if (depth >= 0.99999) { fragColor = vec4(1.0); return; }

  vec3 origin = viewPosition(vUV);

  // Normals reconstructed from depth derivatives. Cheaper than a normal buffer and, at
  // the half resolution this runs at, indistinguishable.
  vec3 normal = normalize(cross(dFdx(origin), dFdy(origin)));

  // Per-pixel rotation of the sample spiral, so the pattern shows up as noise the blur
  // can remove rather than as a fixed swirl locked to the screen.
  float angle = hash13(vec3(gl_FragCoord.xy, uTime)) * 2.0 * PI;

  float occlusion = 0.0;
  float count = 0.0;
  for (int i = 0; i < 32; i++) {
    if (i >= uSamples) break;

    float fi = float(i);
    // A spiral of samples through the hemisphere, scaled so more land near the centre.
    float a = fi * 2.39996323 + angle;
    float r = sqrt((fi + 0.5) / float(uSamples));
    vec3 dir = vec3(cos(a) * r, sin(a) * r, 0.65 + 0.35 * r);
    if (dot(dir, normal) < 0.0) dir = -dir;

    vec3 samplePos = origin + dir * uRadius * r;
    vec4 clip = uProj * vec4(samplePos, 1.0);
    vec2 sampleUV = (clip.xy / clip.w) * 0.5 + 0.5;
    if (sampleUV.x < 0.0 || sampleUV.x > 1.0 || sampleUV.y < 0.0 || sampleUV.y > 1.0) continue;

    float sampleDepth = viewPosition(sampleUV).z;
    // Range check: a foreground object far in front must not darken the background.
    float rangeCheck = smoothstep(0.0, 1.0, uRadius / max(abs(origin.z - sampleDepth), EPS));
    occlusion += (sampleDepth >= samplePos.z + uBias ? 1.0 : 0.0) * rangeCheck;
    count += 1.0;
  }

  float ao = 1.0 - (occlusion / max(count, 1.0)) * uStrength;
  fragColor = vec4(clamp(ao, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;

/** Depth-aware blur for the occlusion buffer, run separably. */
export const SSAO_BLUR_FS =
  FRAG_HEAD +
  `
in vec2 vUV;
uniform sampler2D uSource;
uniform vec2 uTexel;
uniform vec2 uDirection;
out vec4 fragColor;

void main() {
  float sum = 0.0;
  float weight = 0.0;
  for (int i = -3; i <= 3; i++) {
    float w = 1.0 - abs(float(i)) / 4.0;
    sum += texture(uSource, vUV + uDirection * uTexel * float(i)).r * w;
    weight += w;
  }
  fragColor = vec4(sum / weight, 0.0, 0.0, 1.0);
}
`;

/**
 * The composite: occlusion, bloom, tone map, grade, vignette, grain, then FXAA.
 *
 * Doing all of it in one pass keeps the full-resolution work to a single read of the
 * scene target, which on a phone is the difference between comfortable and not.
 */
export const COMPOSITE_FS =
  FRAG_HEAD +
  CONSTANTS +
  NOISE +
  TONEMAP +
  DITHER +
  `
in vec2 vUV;

uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform sampler2D uAO;
uniform vec2 uTexel;

uniform float uBloomStrength;
uniform float uHasBloom;
uniform float uHasAO;
uniform float uFxaa;

uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform vec3 uTint;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uDamage;      // red flash on taking a hit
uniform float uNight;

out vec4 fragColor;

vec3 gradeAndMap(vec3 hdr) {
  hdr *= uExposure;
  vec3 mapped = acesToneMap(hdr);

  // Grade in tone-mapped space: saturation first, then contrast about mid grey.
  float lum = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
  mapped = mix(vec3(lum), mapped, uSaturation);
  mapped = clamp((mapped - 0.5) * uContrast + 0.5, 0.0, 1.0);
  mapped *= uTint;
  return mapped;
}

vec3 sampleGraded(vec2 uv) {
  vec3 hdr = texture(uScene, uv).rgb;
  if (uHasBloom > 0.5) hdr += texture(uBloom, uv).rgb * uBloomStrength;
  if (uHasAO > 0.5) hdr *= mix(1.0, texture(uAO, uv).r, 0.85);
  return gradeAndMap(hdr);
}

// FXAA 3.11, console variant: enough to soften the hard polygon edges this art style is
// full of, at a fraction of the cost of the full PC preset.
vec3 fxaa(vec2 uv) {
  vec3 rgbM = sampleGraded(uv);
  if (uFxaa < 0.5) return rgbM;

  vec3 rgbNW = sampleGraded(uv + vec2(-1.0, -1.0) * uTexel);
  vec3 rgbNE = sampleGraded(uv + vec2( 1.0, -1.0) * uTexel);
  vec3 rgbSW = sampleGraded(uv + vec2(-1.0,  1.0) * uTexel);
  vec3 rgbSE = sampleGraded(uv + vec2( 1.0,  1.0) * uTexel);

  const vec3 luma = vec3(0.299, 0.587, 0.114);
  float lNW = dot(rgbNW, luma), lNE = dot(rgbNE, luma);
  float lSW = dot(rgbSW, luma), lSE = dot(rgbSE, luma);
  float lM  = dot(rgbM, luma);

  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  if (lMax - lMin < max(0.0312, lMax * 0.125)) return rgbM;

  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float reduce = max((lNW + lNE + lSW + lSE) * 0.03125, 0.0078125);
  float rcpDir = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpDir, -8.0, 8.0) * uTexel;

  vec3 rgbA = 0.5 * (sampleGraded(uv + dir * (1.0 / 3.0 - 0.5))
                   + sampleGraded(uv + dir * (2.0 / 3.0 - 0.5)));
  vec3 rgbB = rgbA * 0.5 + 0.25 * (sampleGraded(uv + dir * -0.5)
                                 + sampleGraded(uv + dir * 0.5));
  float lB = dot(rgbB, luma);
  return (lB < lMin || lB > lMax) ? rgbA : rgbB;
}

void main() {
  vec3 color = fxaa(vUV);

  // Damage flash. Applied after grading so it is not tone mapped away at the moment it
  // matters most, which is when the screen is already bright with an explosion.
  if (uDamage > 0.001) {
    color = mix(color, vec3(0.62, 0.06, 0.05), clamp(uDamage, 0.0, 0.75));
  }

  // Vignette, aspect-corrected so it stays round on an ultrawide monitor and on a phone
  // held either way up.
  vec2 v = (vUV - 0.5) * vec2(1.0, 1.0);
  float vig = 1.0 - dot(v, v) * uVignette;
  color *= clamp(vig, 0.0, 1.0);

  // Sensor grain. Animated, and scaled down in the shadows where it would only look dirty.
  if (uGrain > 0.0) {
    float n = hash13(vec3(gl_FragCoord.xy, floor(uTime * 24.0))) - 0.5;
    float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color += n * uGrain * mix(0.35, 1.0, lum);
  }

  color += bayer4(gl_FragCoord.xy) * (1.0 / 255.0);
  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;
