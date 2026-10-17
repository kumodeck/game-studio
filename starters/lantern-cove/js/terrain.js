// Lantern Cove — the land and the sea floor (one height field).
//
// Layout (camera looks roughly toward -z, the sun is ahead-left):
//   - a rocky headland on the left (the lighthouse stands on it)
//   - a long sandy shore curving along the right, with a grassy rise behind it (cottage, pines, pier)
//   - far hills at the back that only exist as hazy silhouettes (depth layers, "air")
//   - between them a sheltered bay: shallow turquoise over sand near the beach, deep teal in the middle
//
// The same height() feeds three things, so they always agree:
//   1. the terrain mesh,
//   2. a small depth texture the water shader reads (colour by depth, shore foam, waves calming in the shallows),
//   3. the JS physics (boats stay in the water, floating things feel the same waves the water draws).
import * as THREE from 'three';

export const EXTENT = 170; // the height field covers [-EXTENT, EXTENT]² metres; outside it is open sea (-12 m)
const SEA_FLOOR = -12;

// Small deterministic value noise (no Math.random: the cove must look the same on every load and in every shot).
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 4) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, z * f); f *= 2.07; a *= 0.5; }
  return s; // ~0..1
}
// Smooth maximum: lets the headland, the shore and the hills blend into one coastline without creases.
const smax = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.max(a, b) + h * h * k * 0.25; };

/** Ground height in metres at (x, z). Sea level is y = 0. */
export function height(x, z) {
  // Rocky headland (left): a steep-sided mound → cliffs, flat-ish top for the lighthouse.
  const hx = (x + 25) / 1.25, hz = z + 19;
  const hd = Math.sqrt(hx * hx + hz * hz) / 13;
  // hd⁵: flat top, steep sides → rock cliffs (coloured by slope) instead of a grassy dome.
  const head = 8 * (1 - hd ** 5) - 0.8;
  // Shore (right): a gentle beach slope along a curved line, then a grassy rise.
  const shoreX = 14 + 0.0055 * (z + 4) * (z + 4);
  const s = x - shoreX;
  let shore = s * 0.32;
  shore += 5.5 * Math.exp(-((x - 31) ** 2 + (z + 7) ** 2) / 160);
  // Far hills (back), a soft wall the haze eats.
  const hills = -10 + 26 * smoothstep(-55, -95, z) + 10 * (fbm(x * 0.02, z * 0.02 + 9) - 0.5);
  // Bay floor: deeper in the middle, shelving toward the shores.
  const bay = -3.2 - 4.5 * smoothstep(10, 42, Math.hypot(x + 2, (z + 8) * 1.3)) - 4 * smoothstep(60, 120, Math.hypot(x, z));
  let h = smax(smax(head, shore, 3), hills, 6);
  h = Math.max(h, Math.max(bay, SEA_FLOOR));
  // Detail: rough on rock, gentle on sand. More noise above the water line.
  const land = smoothstep(-1, 3, h);
  h += (fbm(x * 0.09, z * 0.09) - 0.5) * (0.6 + 2.2 * land * smoothstep(0, 6, head));
  // Cliff ledges: sharper noise only on the headland's sides.
  h += (Math.abs(fbm(x * 0.22 + 4, z * 0.22, 3) - 0.5) - 0.2) * 3.5 * smoothstep(0.55, 0.85, hd) * smoothstep(1.15, 0.95, hd);
  h += (fbm(x * 0.35, z * 0.35, 2) - 0.5) * 0.25 * land;
  return h;
}
function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The height field sampled on a grid, for the water shader and for fast JS lookups (bilinear).
 * HalfFloat so the GPU filters it linearly on every WebGL2 device (Float32 linear filtering is an extension).
 */
export function makeDepthField(n = 256) {
  const data = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    data[j * n + i] = height(-EXTENT + (2 * EXTENT * i) / (n - 1), -EXTENT + (2 * EXTENT * j) / (n - 1));
  }
  const half = new Uint16Array(n * n);
  for (let k = 0; k < data.length; k++) half[k] = THREE.DataUtils.toHalfFloat(data[k]);
  const tex = new THREE.DataTexture(half, n, n, THREE.RedFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  /** Bilinear lookup of the same grid (what the water shader sees). */
  const at = (x, z) => {
    const fx = ((x + EXTENT) / (2 * EXTENT)) * (n - 1), fz = ((z + EXTENT) / (2 * EXTENT)) * (n - 1);
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return SEA_FLOOR;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = data[j * n + i], b = data[j * n + i + 1], c = data[(j + 1) * n + i], d = data[(j + 1) * n + i + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return { tex, at, box: new THREE.Vector3(-EXTENT, -EXTENT, 2 * EXTENT) };
}

/**
 * The terrain mesh. Colours per vertex (wet sand, dry sand, grass, rock by slope). Under water the material
 * darkens with depth (light absorbed on the way down and back) and gets moving caustics, so the water above can be
 * drawn partly see-through and the bay reads as real, clear, shallow water.
 */
export function makeTerrain(sunDir, sunColor) {
  const seg = 230;
  const geo = new THREE.PlaneGeometry(2 * EXTENT, 2 * EXTENT, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const wetSand = new THREE.Color(0x8a7a5c), sand = new THREE.Color(0xd8c39a), grass = new THREE.Color(0x5f7a3a),
    dryGrass = new THREE.Color(0x9a9152), rock = new THREE.Color(0x6e6862), darkRock = new THREE.Color(0x48443f);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - nrm.getY(i);
    const n = fbm(x * 0.15, z * 0.15, 3);
    if (y < 0.15) c.copy(wetSand).lerp(sand, smoothstep(-2.5, 0.1, y) * 0.6);
    else if (y < 1.1 + n * 0.8) c.copy(sand);
    else c.copy(grass).lerp(dryGrass, n * 0.9);
    // Rock where steep (cliffs of the headland, the hills).
    c.lerp(rock, smoothstep(0.18, 0.4, slope));
    c.lerp(darkRock, smoothstep(0.45, 0.7, slope) * 0.7);
    // Tiny brightness noise: breaks the plastic look of flat vertex colour.
    c.multiplyScalar(0.85 + 0.3 * fbm(x * 0.6, z * 0.6, 2));
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 });
  const uniforms = { uTime: { value: 0 }, uSunDir: { value: sunDir }, uSunColor: { value: sunColor } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos; uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor;
        // Caustics: two layers of crossing sine ridges, sharpened. Cheap and reads well from above.
        float caustic(vec2 p) {
          float a = sin(p.x * 1.7 + sin(p.y * 1.3 + uTime * 0.9) * 1.5 + uTime * 0.6);
          float b = sin(p.y * 1.9 + sin(p.x * 1.1 - uTime * 0.7) * 1.4 - uTime * 0.5);
          float c = sin((p.x + p.y) * 1.2 + uTime * 0.8);
          return pow(clamp(1.0 - abs(a + b + c) / 1.6, 0.0, 1.0), 4.0);
        }`)
      .replace('#include <opaque_fragment>', `
        if (vWPos.y < 0.0) {
          float d = -vWPos.y;
          // Light travels down and back up: absorb red first, then green (clear tropical-ish water at dusk).
          outgoingLight *= exp(-d * vec3(0.42, 0.12, 0.085));
          float k = caustic(vWPos.xz * 0.9) * exp(-d * 0.35) * smoothstep(0.0, 0.4, d);
          outgoingLight += uSunColor * k * 0.22 * max(uSunDir.y + 0.25, 0.0);
        }
        #include <opaque_fragment>`);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ground';
  mesh.receiveShadow = true;
  mesh.castShadow = true; // the headland shades the bay at sunset — part of the picture
  mesh.userData.studio = false; // the land is not something to drag around
  return { mesh, uniforms };
}
