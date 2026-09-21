/**
 * The scene program: everything solid in the world goes through this.
 *
 * Direct sun with cascaded shadows, a hemisphere ambient term standing in for sky
 * lighting, up to eight dynamic point lights for weapon fire and explosions, height fog
 * with sun in-scattering, and the two special view modes the game already had — Enhanced
 * Imaging and night vision — kept as branches at the top rather than as separate programs.
 */
import { VERT_HEAD, FRAG_HEAD, CONSTANTS, NOISE, PBR, SHADOWS } from './common.js';

export const MAX_POINT_LIGHTS = 8;

export const SCENE_VS =
  VERT_HEAD +
  `
in vec3 aPos;
in vec3 aNormal;
in vec3 aColor;

uniform mat4 uModel;
uniform mat4 uVP;
uniform mat3 uNormalMatrix;

out vec3 vWorld;
out vec3 vNormal;
out vec3 vColor;

void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;

  // The full normal matrix, not mat3(uModel): parts are scaled non-uniformly all over
  // this model set, and using the model matrix directly skews every normal on them.
  //
  // The guard is not decoration: normalize() of a zero-length vector is undefined in GLSL
  // and yields NaN, a NaN written into the HDR target is spread by the bloom chain into a
  // black rectangle covering much of the screen, and geometry.js used to produce exactly
  // such a normal for every sphere's pole band. That generator is fixed; this makes the
  // whole class of fault impossible to reach from here.
  vec3 rawNormal = uNormalMatrix * aNormal;
  float normalLength = length(rawNormal);
  vNormal = normalLength > 1e-8 ? rawNormal / normalLength : vec3(0.0, 1.0, 0.0);
  vColor = aColor;
  gl_Position = uVP * world;
}
`;

export const SCENE_FS =
  FRAG_HEAD +
  CONSTANTS +
  NOISE +
  PBR +
  SHADOWS +
  `
in vec3 vWorld;
in vec3 vNormal;
in vec3 vColor;

uniform vec3 uEye;
uniform vec3 uColor;
uniform float uAlpha;
uniform float uGlow;

// roughness, metalness, detail strength, rim strength
uniform vec4 uMaterial;

uniform vec3 uSunDir;          // towards the sun
uniform vec3 uSunColor;
uniform vec3 uSkyColor;        // hemisphere ambient, upper
uniform vec3 uGroundColor;     // hemisphere ambient, lower
uniform float uExposure;

uniform vec3 uFogColor;
uniform vec2 uFogParams;       // density, height falloff

uniform int uPointCount;
uniform vec3 uPointPos[${MAX_POINT_LIGHTS}];
uniform vec4 uPointColor[${MAX_POINT_LIGHTS}];   // rgb = colour * intensity, a = radius

uniform float uNight;
uniform float uImaging;        // 0 normal, 1 imaging fill, 2 imaging wire
uniform vec3 uWireColor;

// 0 off, 1 shadow factor, 2 cascade index, 3 world normal, 4 albedo, 5 roughness.
// Driven by ?debug=... — see src/render/debug.js. Costs one uniform compare per fragment
// and has earned it: a shadow term that silently returns 1.0 everywhere looks exactly
// like a scene with the sun in a different place.
uniform int uDebug;

out vec4 fragColor;

void main() {
  vec3 viewVec = uEye - vWorld;
  float viewDist = length(viewVec);

  // --- Enhanced Imaging ------------------------------------------------------
  // A wireframe read of the world. It is a diagnostic overlay rather than a lit
  // surface, so it deliberately skips everything below.
  if (uImaging > 1.5) {
    float fade = clamp(exp(-viewDist * 0.00052), 0.08, 1.0);
    fragColor = vec4(uWireColor * fade * 2.2, uAlpha);
    return;
  }
  if (uImaging > 0.5) {
    fragColor = vec4(vec3(0.004, 0.011, 0.009), uAlpha);
    return;
  }

  vec3 N = normalize(vNormal);
  vec3 V = viewVec / max(viewDist, EPS);
  if (!gl_FrontFacing) N = -N;

  float roughness = clamp(uMaterial.x, 0.045, 1.0);
  float metalness = clamp(uMaterial.y, 0.0, 1.0);
  float detail = uMaterial.z;
  float rimStrength = uMaterial.w;

  vec3 albedo = vColor * uColor;

  // Surface detail. The geometry is low-poly and untextured, so a little noise in albedo
  // and roughness is what stops large baked faces reading as flat sheets of colour. It is
  // faded out with distance, where it would only alias.
  if (detail > 0.0) {
    float detailFade = detail * (1.0 - smoothstep(60.0, 420.0, viewDist));
    if (detailFade > 0.001) {
      float n = fbm3(vWorld * 0.42);
      albedo *= 1.0 + (n - 0.5) * 0.30 * detailFade;
      roughness = clamp(roughness + (n - 0.5) * 0.22 * detailFade, 0.045, 1.0);
    }
  }

  vec3 f0 = mix(vec3(0.04), albedo, metalness);
  vec3 diffuseColor = albedo * (1.0 - metalness);

  float NdotV = max(dot(N, V), 1e-4);

  // --- sun -------------------------------------------------------------------
  vec3 L = normalize(uSunDir);
  vec3 H = normalize(L + V);
  float NdotL = max(dot(N, L), 0.0);
  float NdotH = max(dot(N, H), 0.0);
  float VdotH = max(dot(V, H), 0.0);

  float viewDepth = viewDist;
  float lit = NdotL > 0.0 ? shadowFactor(vWorld, N, viewDepth, NdotL) : 1.0;

  if (uDebug != 0) {
    if (uDebug == 1) { fragColor = vec4(vec3(lit), 1.0); return; }
    if (uDebug == 2) {
      int c = pickCascade(viewDepth);
      vec3 tint = c == 0 ? vec3(1.0, 0.25, 0.25)
                : c == 1 ? vec3(0.25, 1.0, 0.25)
                : c == 2 ? vec3(0.25, 0.45, 1.0) : vec3(1.0, 1.0, 0.25);
      fragColor = vec4(tint * (0.35 + 0.65 * lit), 1.0);
      return;
    }
    if (uDebug == 3) { fragColor = vec4(N * 0.5 + 0.5, 1.0); return; }
    if (uDebug == 4) { fragColor = vec4(albedo, 1.0); return; }
    if (uDebug == 5) { fragColor = vec4(vec3(roughness), 1.0); return; }
  }

  vec3 F = fresnelSchlick(VdotH, f0);
  float D = distributionGGX(NdotH, roughness);
  float Vis = visibilitySmith(NdotV, NdotL, roughness);
  vec3 specular = F * D * Vis;
  vec3 kd = (1.0 - F);

  vec3 color = (kd * diffuseLambert(diffuseColor) + specular) * uSunColor * NdotL * lit;

  // --- ambient ---------------------------------------------------------------
  // A hemisphere term: sky above, bounced ground below. Cheap, and for an outdoor scene
  // with one dominant light it carries most of what an irradiance probe would.
  float hemi = N.y * 0.5 + 0.5;
  vec3 irradiance = mix(uGroundColor, uSkyColor, hemi);

  // A crude horizon occlusion: surfaces facing down see less sky.
  float ao = mix(0.55, 1.0, hemi);
  color += diffuseColor * irradiance * ao;

  // Ambient specular, standing in for a reflection probe. The sky is the only thing
  // bright enough to reflect, so a Fresnel-weighted sky colour is a fair approximation.
  vec3 Fa = fresnelSchlickRoughness(NdotV, f0, roughness);
  float horizonFade = 1.0 - roughness * 0.75;
  color += uSkyColor * Fa * horizonFade * ao * 0.25;

  // --- dynamic point lights ---------------------------------------------------
  // Muzzle flashes, tracer glow, explosions. Few enough to loop over directly; a tiled or
  // clustered path would cost more to maintain than it would save at this count.
  for (int i = 0; i < ${MAX_POINT_LIGHTS}; i++) {
    if (i >= uPointCount) break;
    vec3 toLight = uPointPos[i] - vWorld;
    float dist2 = dot(toLight, toLight);
    float radius = uPointColor[i].a;
    if (dist2 > radius * radius) continue;

    float dist = sqrt(dist2);
    vec3 Lp = toLight / max(dist, EPS);
    float pNdotL = max(dot(N, Lp), 0.0);
    if (pNdotL <= 0.0) continue;

    // Inverse-square with a windowed cutoff, so a light contributes nothing at its radius
    // instead of stopping abruptly at some visible sphere.
    float window = clamp(1.0 - pow(dist / radius, 4.0), 0.0, 1.0);
    float attenuation = window * window / (dist2 + 1.0);

    vec3 Hp = normalize(Lp + V);
    vec3 Fp = fresnelSchlick(max(dot(V, Hp), 0.0), f0);
    float Dp = distributionGGX(max(dot(N, Hp), 0.0), roughness);
    float Visp = visibilitySmith(NdotV, pNdotL, roughness);

    color += ((1.0 - Fp) * diffuseLambert(diffuseColor) + Fp * Dp * Visp)
           * uPointColor[i].rgb * pNdotL * attenuation;
  }

  // --- rim -------------------------------------------------------------------
  // Reads the silhouette of a machine against the sky. Subtle, and skipped on terrain.
  if (rimStrength > 0.0) {
    float rim = pow(1.0 - NdotV, 3.5);
    color += uSkyColor * rim * rimStrength;
  }

  // --- emissive ---------------------------------------------------------------
  color = mix(color, albedo * 2.4, clamp(uGlow, 0.0, 1.0));

  // --- fog and aerial perspective ---------------------------------------------
  // Height fog: thicker in the basin, thinner up on the ridge. The in-scattering term
  // brightens fog looking towards the sun, which is what separates distant ridgelines.
  float heightFactor = exp(-max(vWorld.y, 0.0) * uFogParams.y);
  float fogAmount = 1.0 - exp(-viewDist * viewDist * uFogParams.x * heightFactor);
  fogAmount = clamp(fogAmount * (1.0 - clamp(uGlow, 0.0, 1.0) * 0.7), 0.0, 0.985);

  float sunAmount = max(dot(-V, L), 0.0);
  vec3 fog = mix(uFogColor, uFogColor * 1.25 + uSunColor * 0.035, pow(sunAmount, 5.0));
  color = mix(color, fog, fogAmount);

  color *= uExposure;

  // --- night vision -------------------------------------------------------------
  if (uNight > 0.5) {
    float lum = dot(color, vec3(0.3, 0.59, 0.11));
    color = vec3(0.21, 0.85, 0.37) * lum * 1.7 + vec3(0.012, 0.035, 0.014);
  }

  fragColor = vec4(color, uAlpha);
}
`;

/**
 * Depth-only program for the shadow cascades.
 *
 * No colour attachment is bound, so there is nothing to write; the fragment shader exists
 * only because a program needs one. Kept as small as possible because it runs once per
 * cascade over every caster in the scene.
 */
export const SHADOW_VS =
  VERT_HEAD +
  `
in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uLightVP;
void main() {
  gl_Position = uLightVP * uModel * vec4(aPos, 1.0);
}
`;

export const SHADOW_FS =
  FRAG_HEAD +
  `
void main() {}
`;
