/**
 * The sky program: a full-screen triangle pair at the far plane.
 *
 * The original painted a hand-tuned gradient with a sun and a moon on it. This keeps that
 * composition — the game is recognised by that dusty horizon — but drives it from
 * scattering functions and one shared sun direction, so the sky, the glow around the sun,
 * the direction shadows fall and the colour of the fog all agree instead of being four
 * separately tuned constants that happened to look close.
 *
 * Scattering supplies the *shape*; the magnitudes are calibrated to the original palette.
 * A physically scaled atmosphere renders a bright blue midday sky, which is a different
 * game.
 */
import { VERT_HEAD, FRAG_HEAD, CONSTANTS, NOISE, TONEMAP, DITHER } from './common.js';

export const SKY_VS =
  VERT_HEAD +
  `
in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos;
  // Sits at the far plane so the depth buffer rejects nothing in front of it.
  gl_Position = vec4(aPos, 0.999999, 1.0);
}
`;

export const SKY_FS =
  FRAG_HEAD +
  CONSTANTS +
  NOISE +
  TONEMAP +
  DITHER +
  `
in vec2 vUV;

uniform vec3 uForward;
uniform vec3 uRight;
uniform vec3 uUp;
uniform float uAspect;
uniform float uFov;
uniform float uOffset;

uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform float uExposure;
uniform float uNight;
uniform float uImaging;
uniform float uTime;

out vec4 fragColor;

const vec3 ZENITH = vec3(0.112, 0.180, 0.232);
const vec3 HORIZON = vec3(0.60, 0.425, 0.352);
const vec3 DUST = vec3(0.70, 0.495, 0.395);

/** Relative Rayleigh response: 1/lambda^4, normalised to green. */
const vec3 RAYLEIGH_TINT = vec3(0.42, 0.78, 1.55);

float rayleighPhase(float c) {
  return 0.75 * (1.0 + c * c);
}

/** Henyey-Greenstein. g near 0.76 gives the tight forward halo the sun sits in. */
float miePhase(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

vec3 atmosphere(vec3 dir, vec3 sun) {
  float up = clamp(dir.y, 0.0, 1.0);
  float cosTheta = dot(dir, sun);

  // Optical depth grows towards the horizon: more air to look through.
  float depth = clamp(1.0 / (up + 0.16), 1.0, 6.4);

  vec3 color = mix(HORIZON, ZENITH, pow(up, 0.48));

  // Rayleigh: the cool cast, strongest high and away from the sun.
  color += RAYLEIGH_TINT * rayleighPhase(cosTheta) * 0.021 * depth;

  // Mie: the warm halo, and why the horizon glows on the sun's side.
  color += uSunColor * miePhase(cosTheta, 0.76) * 0.021 * depth;

  // The dust this world is made of. Thickest low, and warmer towards the sun.
  float dustAmount = pow(clamp(1.0 - up * 1.30, 0.0, 1.0), 3.2);
  color = mix(color, DUST * (0.85 + 0.35 * pow(max(cosTheta, 0.0), 2.0)), dustAmount * 0.55);

  // Below the horizon line, ground haze takes over entirely.
  color = mix(color, DUST * 0.62, smoothstep(0.0, -0.14, dir.y));

  return color;
}

void main() {
  // Imaging mode replaces the sky with a flat void so the wireframe reads cleanly.
  if (uImaging > 0.5) {
    float horizon = exp(-abs(vUV.y + 0.18) * 9.0);
    fragColor = vec4(vec3(0.002, 0.007, 0.006) + vec3(0.002, 0.014, 0.008) * horizon, 1.0);
    return;
  }

  vec3 dir = normalize(uForward + uRight * vUV.x * uAspect * uFov + uUp * (vUV.y + uOffset) * uFov);
  vec3 sun = normalize(uSunDir);

  vec3 color = atmosphere(dir, sun);

  // Sun disc, with limb darkening so it is not a flat white circle. Above the bloom
  // threshold, so the post chain grows the glow around it rather than the shader faking one.
  float sunAngle = dot(dir, sun);
  const float sunRadius = 0.99965;
  if (sunAngle > sunRadius) {
    float r = sqrt(max(0.0, (1.0 - sunAngle) / (1.0 - sunRadius)));
    color += uSunColor * 3.0 * pow(max(1.0 - r * r, 0.0), 0.28);
  }
  color += uSunColor * pow(max(sunAngle, 0.0), 420.0) * 0.72;
  color += uSunColor * pow(max(sunAngle, 0.0), 26.0) * 0.034;

  // The moon, craters and terminator included, because it is part of this skyline. Kept
  // below the bloom threshold: it is scenery, not a light source, and any brighter it
  // blooms into a featureless white disc.
  vec3 moon = normalize(uMoonDir);
  float md = dot(dir, moon);
  const float moonR = 0.0068;
  if (md > 1.0 - moonR) {
    float r = sqrt(max(0.0, (1.0 - md) / moonR));
    vec3 mc = mix(vec3(0.48, 0.48, 0.40), vec3(0.72, 0.65, 0.52), sqrt(max(1.0 - r * r, 0.0)));
    mc += fbm3(dir * 210.0) * 0.10 - 0.05;
    float shade = dot(normalize(dir - moon * md), normalize(vec3(0.6, 0.3, 0.0)));
    mc *= 1.0 - smoothstep(-0.1, 0.8, shade) * 0.32;
    color = mix(color, mc * 0.62, 0.80 * smoothstep(1.0 - moonR, 1.0 - moonR * 0.35, md));
  }

  // High thin cloud, drifting slowly. Enough to keep the upper sky from being a clean ramp.
  float cloudBand = fbm3(vec3(dir.xz * 5.5 / max(dir.y + 0.22, 0.12), uTime * 0.006));
  float cloudMask = smoothstep(0.52, 0.86, cloudBand) * smoothstep(0.02, 0.30, dir.y);
  color = mix(color, color * 0.80 + uSunColor * 0.014, cloudMask * 0.38);

  color *= uExposure;

  if (uNight > 0.5) {
    float l = dot(color, vec3(0.3, 0.59, 0.11));
    color = vec3(0.11, 0.43, 0.2) * l;
  }

  // The sky is the widest smooth gradient on screen and the first place banding shows.
  // A sub-LSB dither costs nothing and removes it.
  color += bayer4(gl_FragCoord.xy) * (1.0 / 255.0);

  fragColor = vec4(color, 1.0);
}
`;
