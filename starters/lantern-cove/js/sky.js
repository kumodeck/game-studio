// Lantern Cove — the dusk sky.
//
// One GLSL function, skyColor(dir), is the whole sky. It is used twice:
//   1. baked once into a cube map at start (scene.background + the PBR environment), so the sky costs nothing per
//      frame and is never clipped by any camera's far plane (the editor's edit camera has its own far plane);
//   2. inside the water shader as the "air" colour far away, so the sea melts into the sky at the horizon in every
//      direction (a single FogExp2 colour cannot do that: the horizon under the sun is orange, behind you it is lilac).
// Clouds are only in the baked cube (they would be too expensive per water pixel and are never seen in the fog).
//
// Colours are linear HDR. The sun disk is ~30× white so it blooms; everything goes through ACES at the end
// (AgX turns a sunset beige — learned on an earlier dusk scene).
import * as THREE from 'three';

/** Direction TOWARD the sun: low (≈7°), ahead-left of the opening camera, so its glitter path runs to the viewer. */
export const SUN_DIR = new THREE.Vector3(-0.42, 0.11, -0.9).normalize();
/** Sun light colour (linear) — warm but not orange, so white paint still reads as white. */
export const SUN_COLOR = new THREE.Color(1.0, 0.74, 0.52);
/** Colour of the haze on land objects (FogExp2). Matches skyColor() at the horizon about 90° away from the sun. */
export const HAZE_COLOR = new THREE.Color(0.62, 0.5, 0.56);

export const SKY_GLSL = /* glsl */ `
uniform vec3 uSunDir;
vec3 skyColor(vec3 d) {
  float y = d.y;
  float h = clamp(y, 0.0, 1.0);
  float s = max(dot(d, uSunDir), 0.0);
  // Base gradient: warm horizon -> dusty violet band -> deep blue zenith.
  vec3 hor = mix(vec3(0.62, 0.50, 0.56), vec3(1.30, 0.66, 0.40), pow(s, 2.0));
  vec3 mid = vec3(0.36, 0.33, 0.52);
  vec3 zen = vec3(0.07, 0.12, 0.30);
  vec3 c = mix(hor, mid, smoothstep(0.0, 0.22, h));
  c = mix(c, zen, smoothstep(0.18, 0.75, h));
  // Glow around the sun: a wide soft one (scattering) and a tight bright one (the corona that blooms).
  c += vec3(1.1, 0.52, 0.24) * pow(s, 10.0) * (1.0 - 0.6 * h);
  c += vec3(2.0, 1.1, 0.5) * pow(s, 160.0);
  // Disk: ~0.55° wide, HDR so the bloom pass picks it up.
  c += vec3(30.0, 19.0, 10.0) * smoothstep(0.99985, 0.99993, s);
  // Under the horizon (only seen in reflections of very steep waves): fade to the haze colour.
  c = mix(c, vec3(0.55, 0.45, 0.52), smoothstep(0.0, -0.04, y));
  return c;
}
`;

const CLOUD_GLSL = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, v = 0.0; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
vec4 clouds(vec3 d) {
  if (d.y <= 0.005) return vec4(0.0);
  // Project onto a cloud layer; stretch along x so they read as long dusk streaks (cirrostratus), not cotton balls.
  vec2 q = d.xz / (d.y + 0.06);
  float n = fbm(vec3(q * vec2(0.55, 1.6) + vec2(3.1, 0.7), 1.7));
  float dens = smoothstep(0.50, 0.78, n) * smoothstep(0.01, 0.12, d.y) * (1.0 - smoothstep(0.35, 0.8, d.y));
  float s = max(dot(d, uSunDir), 0.0);
  // Lit from below by a sun that is almost set: hot rim near the sun, violet-grey away from it.
  vec3 col = mix(vec3(0.30, 0.24, 0.36), vec3(1.9, 0.95, 0.5), pow(s, 3.0));
  col += vec3(1.2, 0.6, 0.3) * pow(s, 24.0);
  return vec4(col, dens * 0.85);
}
`;

/**
 * Bake the sky once. Returns { background, environment }.
 * `renderer.__studioRender` (when the editor is present) renders without being recorded as the game's camera.
 */
export function bakeSky(renderer) {
  const skyScene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uSunDir: { value: SUN_DIR } },
    vertexShader: /* glsl */ `varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `varying vec3 vDir; ${SKY_GLSL} ${CLOUD_GLSL}
      void main() { vec3 d = normalize(vDir); vec3 c = skyColor(d); vec4 cl = clouds(d); gl_FragColor = vec4(mix(c, cl.rgb, cl.a), 1.0); }`,
  });
  skyScene.add(new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), mat));
  // 512 per face is enough: the sky is soft; only the sun disk is small, and it is meant to glow anyway.
  const target = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  const cam = new THREE.CubeCamera(0.1, 100, target);
  cam.update(renderer, skyScene);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromCubemap(target.texture).texture;
  pmrem.dispose();
  mat.dispose();
  return { background: target.texture, environment: env };
}
