/**
 * GLSL chunks shared between programs.
 *
 * Everything here is GLSL ES 3.00. `#version` must be the very first characters of a
 * shader — not even a newline may precede it — which is why HEAD is concatenated rather
 * than written inline at each call site.
 */

/** Version and default precision for a vertex shader. */
export const VERT_HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

/** Version and default precision for a fragment shader. */
export const FRAG_HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArrayShadow;
precision highp sampler2DArray;
`;

/** Constants used across programs. */
export const CONSTANTS = `
const float PI = 3.14159265359;
const float EPS = 1e-5;
`;

/**
 * Cheap value noise.
 *
 * Used to break up the flat shading on large baked surfaces — terrain especially, where a
 * single triangle can span a hundred metres and reads as a dead sheet of colour without
 * it. Three octaves is enough at the distances the camera ever sees.
 */
export const NOISE = `
float hash13(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash13(i + vec3(0, 0, 0)), hash13(i + vec3(1, 0, 0)), f.x),
        mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x),
        mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}

float fbm3(vec3 p) {
  return valueNoise(p) * 0.5 + valueNoise(p * 2.03) * 0.3 + valueNoise(p * 4.01) * 0.2;
}
`;

/**
 * Physically based direct lighting.
 *
 * Cook-Torrance: GGX normal distribution, height-correlated Smith visibility, Schlick
 * Fresnel. The visibility term is the one that folds the denominator in, so `specular`
 * below is already divided through — multiply by NdotL and the light colour and nothing
 * else.
 */
export const PBR = `
float distributionGGX(float NdotH, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, EPS);
}

// Height-correlated Smith, with the 1/(4 NdotL NdotV) of the BRDF folded in.
float visibilitySmith(float NdotV, float NdotL, float roughness) {
  float a = roughness * roughness;
  float a2 = a * a;
  float v = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
  float l = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
  return 0.5 / max(v + l, EPS);
}

vec3 fresnelSchlick(float cosTheta, vec3 f0) {
  float f = pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  return f0 + (1.0 - f0) * f;
}

// Fresnel with a roughness term, for the ambient term where there is no single direction.
vec3 fresnelSchlickRoughness(float cosTheta, vec3 f0, float roughness) {
  vec3 ceiling = max(vec3(1.0 - roughness), f0);
  return f0 + (ceiling - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

// Lambert diffuse, normalised.
vec3 diffuseLambert(vec3 albedo) {
  return albedo / PI;
}
`;

/**
 * Cascaded shadow lookup.
 *
 * Cascades are layers of one depth texture array, selected by view-space depth. Near the
 * boundary two cascades are blended so the resolution change does not appear as a seam
 * sliding across the ground as the camera moves.
 *
 * The comparison is done by the sampler, so the hardware gives a free 2x2 PCF tap; the
 * loop widens that to the tap count the quality tier asked for. The normal-offset bias
 * pushes the sample along the surface normal rather than along the light, which handles
 * shallow angles — most of this terrain — far better than a constant depth bias.
 */
export const SHADOWS = `
uniform sampler2DArrayShadow uShadowMap;
uniform mat4 uShadowMatrix[4];
uniform vec4 uCascadeSplits;       // view-space far distance of each cascade
uniform vec2 uShadowTexel;         // 1 / shadow map size, in UV
uniform vec4 uCascadeTexelWorld;   // world size of one texel, per cascade
uniform float uShadowCascades;     // 0 disables the lookup entirely
uniform float uShadowTaps;         // taps per axis: 1, 2 or 3
uniform float uShadowStrength;

int pickCascade(float viewDepth) {
  int c = 0;
  if (viewDepth > uCascadeSplits.x) c = 1;
  if (viewDepth > uCascadeSplits.y) c = 2;
  if (viewDepth > uCascadeSplits.z) c = 3;
  return min(c, int(uShadowCascades) - 1);
}

float sampleCascade(vec3 worldPos, vec3 normal, int cascade, float NdotL) {
  // Normal offset: push the sample along the surface rather than along the light, scaled
  // by how glancing the light is and by how much world space one texel of *this* cascade
  // covers. That last part has to be supplied — it depends on the fitted radius, which
  // only the CPU knows — and getting it wrong by a factor of a thousand moves the sample
  // off its own caster and lights the entire scene.
  float texelWorld = cascade == 0 ? uCascadeTexelWorld.x
                   : cascade == 1 ? uCascadeTexelWorld.y
                   : cascade == 2 ? uCascadeTexelWorld.z : uCascadeTexelWorld.w;
  float slope = clamp(1.0 - NdotL, 0.0, 1.0);
  vec3 offset = normal * (0.9 + slope * 2.4) * texelWorld;

  vec4 lightSpace = uShadowMatrix[cascade] * vec4(worldPos + offset, 1.0);
  vec3 proj = lightSpace.xyz / lightSpace.w;
  proj = proj * 0.5 + 0.5;

  if (proj.z > 1.0 || proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) return 1.0;

  float depthBias = 0.0009 + slope * 0.0022;
  float reference = proj.z - depthBias;

  int taps = int(uShadowTaps);
  if (taps <= 1) return texture(uShadowMap, vec4(proj.xy, float(cascade), reference));

  float sum = 0.0;
  float count = 0.0;
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      if (abs(x) > taps || abs(y) > taps) continue;
      vec2 o = vec2(float(x), float(y)) * uShadowTexel;
      sum += texture(uShadowMap, vec4(proj.xy + o, float(cascade), reference));
      count += 1.0;
    }
  }
  return sum / max(count, 1.0);
}

float shadowFactor(vec3 worldPos, vec3 normal, float viewDepth, float NdotL) {
  if (uShadowCascades < 0.5) return 1.0;

  int cascade = pickCascade(viewDepth);
  float lit = sampleCascade(worldPos, normal, cascade, NdotL);

  // Cross-fade the last tenth of a cascade into the next one.
  float splitFar = cascade == 0 ? uCascadeSplits.x
                 : cascade == 1 ? uCascadeSplits.y
                 : cascade == 2 ? uCascadeSplits.z : uCascadeSplits.w;
  float splitNear = cascade == 0 ? 0.0
                  : cascade == 1 ? uCascadeSplits.x
                  : cascade == 2 ? uCascadeSplits.y : uCascadeSplits.z;
  float band = (splitFar - splitNear) * 0.12;
  if (cascade < int(uShadowCascades) - 1 && viewDepth > splitFar - band) {
    float t = clamp((viewDepth - (splitFar - band)) / max(band, EPS), 0.0, 1.0);
    lit = mix(lit, sampleCascade(worldPos, normal, cascade + 1, NdotL), t);
  }

  // Fade shadows out entirely at the far edge rather than letting them pop.
  float fade = 1.0 - smoothstep(uCascadeSplits.w * 0.82, uCascadeSplits.w, viewDepth);
  lit = mix(1.0, lit, fade * uShadowStrength);
  return lit;
}
`;

/**
 * ACES filmic tone mapping, Narkowicz's curve fit.
 *
 * Cheap enough for a phone and holds highlight colour far better than Reinhard, which
 * matters here because muzzle flashes and the sun disc are the brightest things on screen
 * and go white and flat under a naive curve.
 */
export const TONEMAP = `
vec3 acesToneMap(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 linearToSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(EPS)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;

/** Ordered dither, used to break up banding in the dark sky gradient. */
export const DITHER = `
float bayer4(vec2 p) {
  vec2 c = floor(mod(p, 4.0));
  float i = c.y * 4.0 + c.x;
  const float m[16] = float[16](
     0.0,  8.0,  2.0, 10.0,
    12.0,  4.0, 14.0,  6.0,
     3.0, 11.0,  1.0,  9.0,
    15.0,  7.0, 13.0,  5.0);
  return m[int(i)] / 16.0 - 0.5;
}
`;
