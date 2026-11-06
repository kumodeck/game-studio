/**
 * Big Swell — a rough sea at sunset. Buoys, ducks, a raft and crates ride the waves; every few seconds a big swell
 * rolls in from the horizon and lifts everything at once; crates keep dropping in with a splash (tap to drop one).
 *
 * WHY this game (decided 2026-11-06): a sample that reads in 1 second and looks good in a 10-second clip —
 * water, physics and light, with no rules to learn. What it is for in the editor:
 *   - placed: the buoys, the ducks, the raft, the ball, the floating crates, the rocks, the lighthouse — drag them in
 *     Edit and they keep riding the waves from where you put them (only their child `bob` is moved by the game);
 *   - moved by the game: the bobbing (child `bob`), the lighthouse beam;
 *   - made by the game: the dropped crates and the splashes (not there when Play starts).
 * The paused moment's showcase: pause as the big swell hits, mark a spot, ask “Make the waves twice as tall.”
 * Your AI changes WAVE_HEIGHT below, and Before / After shows the same second on a much bigger sea.
 *
 * Everything moves by the time between frames (dt) and is seeded, so a run is the same run every load (the editor's
 * Try replays to the same second). The water height is ONE function (seaAt) used by both the surface you see and the
 * floating things, so they ride exactly the waves on screen. No asset files: every picture is made by code here and
 * three.js comes from the CDN (decided 2026-11-06 for every sample on the shelf: it opens at once, anywhere).
 *
 * URL switches (tests and shots): ?fixed=30 → every frame advances exactly 1/30 s (smooth video from a slow headless
 * browser); ?quality=low|high skips the automatic quality check (same switches as Lantern Cove).
 */

import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { applyPlacement } from './studio-placement.js';

// Tell the editor (when it is there) that the layout is final only after placement.json is applied. No-op otherwise.
window.studio?.waitForReady?.();

// ---------------------------------------------------------------- the numbers an AI is asked to change
// How tall the sea is: every wave and the big swell are multiplied by it. 1.0 = a rough sea (recommended);
// 2.0 = a storm; 0.4 = calm. The foam follows it (crests are white relative to this height).
const WAVE_HEIGHT = 1.0;
// The big swell: one rolls in from the horizon every SWELL_EVERY seconds, SWELL_TALL m high (before WAVE_HEIGHT).
// 6 s = something happens inside any 10-second clip; the first one reaches the floats about 8 s in.
const SWELL_EVERY = 6;
const SWELL_TALL = 1.5;
// A crate drops in every DROP_EVERY seconds by itself (tapping drops one more), at most MAX_CRATES afloat.
const DROP_EVERY = 1.7;
const MAX_CRATES = 10;

// ---------------------------------------------------------------- the world
const params = new URLSearchParams(location.search);
const FIXED = Number(params.get('fixed')) || 0;
const renderer = new THREE.WebGLRenderer({ antialias: true });
// The pixel ratio starts high and drops to 1 if this device is slow (setQuality, below). 2 = sharp on a phone or a
// Retina screen; more than 2 costs a lot of pixels for little to see.
const HIGH_RATIO = 2;
renderer.setPixelRatio(params.get('quality') === 'low' ? 1 : Math.min(devicePixelRatio || 1, HIGH_RATIO));
// ACES + a low exposure: the Sky shader is physically bright; this is the exposure three's own Sky example uses.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
camera.position.set(0, 3.4, 15);
camera.lookAt(0, 0.6, -8);

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// The sun: 4° over the horizon straight ahead (−z), so the glitter path runs down the sea toward the camera.
const SUN = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(86), Math.PI);
const sky = new Sky();
sky.userData.studio = false; // the backdrop, not something to select
sky.scale.setScalar(1000);
sky.material.uniforms.turbidity.value = 7;
sky.material.uniforms.rayleigh.value = 2.2;
sky.material.uniforms.mieCoefficient.value = 0.006;
sky.material.uniforms.mieDirectionalG.value = 0.86;
sky.material.uniforms.sunPosition.value.copy(SUN);
scene.add(sky);
// Reflections: the same sky baked once into an environment map, so the waves and the objects mirror the sunset.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  const s2 = new Sky();
  s2.scale.setScalar(1000);
  for (const k of Object.keys(sky.material.uniforms)) s2.material.uniforms[k].value = sky.material.uniforms[k].value;
  env.add(s2);
  scene.environment = pmrem.fromScene(env).texture;
  pmrem.dispose();
}
// The haze: the far sea fades into the colour of the horizon, so the edge of the water is never seen.
scene.fog = new THREE.FogExp2(0xc9876a, 0.011);
const sunLight = new THREE.DirectionalLight(0xffc89a, 2.4);
sunLight.position.copy(SUN).multiplyScalar(50).add(new THREE.Vector3(0, 12, 0));
scene.add(sunLight);
scene.add(new THREE.HemisphereLight(0x9fb4d8, 0x2a2430, 1.1));
// A soft fill from behind the camera: the sun is straight ahead, so without it every float is a dark silhouette
// (tried 2026-11-06: the yellow ducks read olive). Weak and cool so the sunset still wins.
const fill = new THREE.DirectionalLight(0xbfd2ff, 1.1);
fill.position.set(-4, 6, 20);
scene.add(fill);

// ---------------------------------------------------------------- the sea (one height function for everything)
// [dirX, dirZ, wavelength m, amplitude m]. Mostly coming toward the camera (+z), a little across.
const WAVES = [
  [0.15, 1, 15, 0.42],
  [-0.55, 0.85, 9, 0.24],
  [0.7, 0.7, 6.5, 0.14],
  [-0.2, 1, 3.6, 0.07],
  [0.9, -0.4, 2.4, 0.035],
].map(([dx, dz, len, amp]) => {
  const l = Math.hypot(dx, dz), k = (2 * Math.PI) / len;
  return { dx: dx / l, dz: dz / l, k, amp, w: Math.sqrt(9.81 * k) }; // deep water: long waves travel faster
});
const SWELL_SPEED = 9; // m/s toward the camera
const SWELL_FROM = -75; // z where a swell is born (beyond the haze)

/** Water height at (x, z), time t. Stokes-like waves (sharp crests, flat troughs) + the big swells. */
function seaAt(x, z, t) {
  let h = 0;
  for (const w of WAVES) {
    const th = w.k * (w.dx * x + w.dz * z) - w.w * t;
    h += w.amp * (Math.cos(th) + 0.28 * Math.cos(2 * th));
  }
  // The big swells: a hump about 14 m wide rolling toward the camera, a little taller in the middle of the view.
  // The first one is born at t = 0, so it reaches the floats (z ≈ 0) about 8 s in.
  for (let n = Math.max(0, Math.floor(t / SWELL_EVERY) - 2); n <= Math.floor(t / SWELL_EVERY); n++) {
    const zc = SWELL_FROM + SWELL_SPEED * (t - n * SWELL_EVERY);
    const d = (z - zc) / 7;
    h += SWELL_TALL * Math.exp(-d * d) * (0.75 + 0.25 * Math.cos(x * 0.12));
  }
  return h * WAVE_HEIGHT;
}

const SEA_W = 150, SEA_D = 150, SEA_SEG = 170;
const seaGeo = new THREE.PlaneGeometry(SEA_W, SEA_D, SEA_SEG, SEA_SEG);
seaGeo.rotateX(-Math.PI / 2);
seaGeo.translate(0, 0, -45); // from z = +30 (behind the camera) to z = −120 (lost in the haze)
const seaPos = seaGeo.attributes.position;
const seaBase = Float32Array.from(seaPos.array); // the flat grid, to displace from every frame
const seaCol = new Float32Array(seaPos.count * 3);
seaGeo.setAttribute('color', new THREE.BufferAttribute(seaCol, 3));
const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.08, metalness: 0.15, envMapIntensity: 1.25 }));
sea.name = 'sea';
sea.userData.studio = false; // the water itself is not a thing to drag
scene.add(sea);
const DEEP = new THREE.Color(0x0a3a4a), CREST = new THREE.Color(0x2a8f95), FOAM = new THREE.Color(0xf4efe6);
const c = new THREE.Color();
function updateSea(t) {
  const a = seaPos.array;
  for (let i = 0; i < seaPos.count; i++) {
    const x = seaBase[i * 3], z = seaBase[i * 3 + 2];
    const h = seaAt(x, z, t);
    a[i * 3 + 1] = h;
    // Colour by height, relative to WAVE_HEIGHT: deep teal in the troughs, lighter on the faces, foam on the crests.
    const r = h / (WAVE_HEIGHT || 1);
    c.copy(DEEP).lerp(CREST, THREE.MathUtils.clamp((r + 0.5) / 1.6, 0, 1));
    c.lerp(FOAM, THREE.MathUtils.smoothstep(r, 0.75, 1.5) * 0.85);
    seaCol[i * 3] = c.r; seaCol[i * 3 + 1] = c.g; seaCol[i * 3 + 2] = c.b;
  }
  seaPos.needsUpdate = true;
  seaGeo.attributes.color.needsUpdate = true;
  seaGeo.computeVertexNormals();
}

// ---------------------------------------------------------------- things (each an editable group with a child `bob`)
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });
/** Wood planks painted on a canvas (no files: the sample has no assets). */
function planks(tint) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  for (let i = 0; i < 4; i++) {
    g.fillStyle = `hsl(${28 + tint}, ${45 + i * 4}%, ${38 + (i % 2) * 7}%)`;
    g.fillRect(0, i * 32, 128, 32);
    g.fillStyle = 'rgba(40, 20, 8, .5)';
    g.fillRect(0, i * 32, 128, 3);
  }
  g.strokeStyle = 'rgba(40, 20, 8, .65)';
  g.lineWidth = 8;
  g.strokeRect(4, 4, 120, 120);
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.SRGBColorSpace;
  return tx;
}
const CRATE_TX = [planks(0), planks(10)];
const crateGeo = new THREE.BoxGeometry(1.1, 1.1, 1.1);

/** An editable thing: the group is what the editor moves; `bob` is what the waves move. */
function floater(key, x, z, build, { draft = 0, size = 1 } = {}) {
  const g = new THREE.Group();
  g.name = key;
  const bob = new THREE.Group();
  bob.name = 'bob';
  build(bob);
  g.add(bob);
  g.position.set(x, 0, z);
  g.userData.float = { draft, size };
  scene.add(g);
  return g;
}
const makeCrate = (bob, tint = 0) => bob.add(new THREE.Mesh(crateGeo, std(0xffffff, { map: CRATE_TX[tint] })));
function makeBuoy(bob) {
  const red = std(0xd9322b, { roughness: 0.35 }), white = std(0xf2efe8, { roughness: 0.35 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.7, 20), red);
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 0.8, 20), white);
  mid.position.y = 0.75;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 0.6, 16), red);
  top.position.y = 1.45;
  // The lamp: emissive, so it reads as a light in the dusk (and blinks, below).
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), std(0xffe9a8, { emissive: 0xffc34a, emissiveIntensity: 3 }));
  lamp.name = 'lamp';
  lamp.position.y = 1.85;
  bob.add(base, mid, top, lamp);
}
function makeDuck(bob) {
  const yellow = std(0xffcf2e, { roughness: 0.3, metalness: 0.0 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 16), yellow);
  body.scale.set(1, 0.72, 1.25);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.33, 20, 14), yellow);
  head.position.set(0, 0.55, 0.42);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.32, 12), std(0xff7a1a, { roughness: 0.4 }));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.5, 0.8);
  const eye = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), eye);
    e.position.set(s * 0.17, 0.66, 0.68);
    bob.add(e);
  }
  bob.add(body, head, beak);
}
function makeBall(bob) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 128;
  const g = cv.getContext('2d');
  ['#f4f0e8', '#e0362c', '#f4f0e8', '#2f7de1', '#f4f0e8', '#ffc928'].forEach((col, i) => ((g.fillStyle = col), g.fillRect((i * 256) / 6, 0, 256 / 6 + 1, 128)));
  const tx = new THREE.CanvasTexture(cv);
  tx.colorSpace = THREE.SRGBColorSpace;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.6, 32, 20), std(0xffffff, { map: tx, roughness: 0.25 }));
  bob.add(ball);
}
function makeRaft(bob) {
  const wood = std(0x8a5a32, { roughness: 0.8 });
  for (let i = 0; i < 6; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 3, 12), wood);
    log.rotation.z = Math.PI / 2;
    log.position.z = -1 + i * 0.4;
    bob.add(log);
  }
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8), std(0x5a3a22));
  pole.position.set(0.9, 1.1, 0);
  // The flag: a thin plane that the wind waves (vertices moved in update, like a cloth).
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55, 12, 4), std(0xe23a2f, { side: THREE.DoubleSide, roughness: 0.7 }));
  flag.name = 'flag';
  flag.geometry.translate(0.45, 0, 0);
  flag.position.set(0.9, 1.9, 0);
  flag.userData.base = Float32Array.from(flag.geometry.attributes.position.array);
  bob.add(pole, flag);
}

// Placed things, spread over the middle of the view (all within 8 m of the camera's line, 0–16 m away).
const things = [
  floater('buoy', -6.5, -6, makeBuoy, { draft: 0.25, size: 1.2 }),
  floater('buoy', 7, -12, makeBuoy, { draft: 0.25, size: 1.2 }),
  floater('duck', -2.2, 1.5, makeDuck, { draft: 0.05, size: 0.9 }),
  floater('duck', 3.3, -3, makeDuck, { draft: 0.05, size: 0.9 }),
  floater('raft', 0.5, -9, makeRaft, { draft: 0.05, size: 2.6 }),
  floater('ball', -4.2, -1.5, makeBall, { draft: -0.35, size: 1 }),
  floater('crate', 4.8, 2.5, (b) => makeCrate(b, 0), { draft: 0.1, size: 1.1 }),
  floater('crate', -8.5, -14, (b) => makeCrate(b, 1), { draft: 0.1, size: 1.1 }),
];
things[3].rotation.y = 0.7;
things[4].rotation.y = -0.3;

// Rocks and the lighthouse: they stand (not floating), placed.
const rockMat = std(0x3a3440, { roughness: 0.95, flatShading: true });
function rock(x, z, s) {
  const r = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 1), rockMat);
  r.name = 'rock';
  r.scale.set(s * 1.4, s, s * 1.1);
  r.position.set(x, -0.3 * s, z);
  scene.add(r);
  return r;
}
rock(15, -24, 3.2);
rock(-17, -30, 2.4);
const lighthouse = new THREE.Group();
lighthouse.name = 'lighthouse';
{
  const white = std(0xf1ede4, { roughness: 0.6 }), red = std(0xc8312a, { roughness: 0.6 });
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.95 - i * 0.1, 1.05 - i * 0.1, 1.6, 20), i % 2 ? red : white);
    seg.position.y = 0.8 + i * 1.6;
    lighthouse.add(seg);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), std(0xfff1c4, { emissive: 0xffd27a, emissiveIntensity: 4 }));
  lamp.position.y = 8.5;
  // The beam: a long additive cone the game turns (moved by the game; the lighthouse itself is placed).
  // Its alpha fades along the length (a gradient painted on a canvas), so it never ends in a hard disc against the sky
  // (the first try, a flat 0.16, read as a white blob next to the sun).
  const fade = document.createElement('canvas');
  fade.width = 4; fade.height = 128;
  const fg = fade.getContext('2d').createLinearGradient(0, 0, 0, 128);
  fg.addColorStop(0, '#000'); fg.addColorStop(1, '#fff');
  fade.getContext('2d').fillStyle = fg;
  fade.getContext('2d').fillRect(0, 0, 4, 128);
  const beam = new THREE.Mesh(new THREE.ConeGeometry(1.6, 30, 24, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.22, alphaMap: new THREE.CanvasTexture(fade), blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.name = 'beam';
  beam.geometry.translate(0, -15, 0);
  beam.geometry.rotateZ(Math.PI / 2);
  beam.position.y = 8.5;
  beam.userData.studio = false;
  lighthouse.add(lamp, beam);
}
lighthouse.position.set(15, 2.2, -24);
scene.add(lighthouse);

await applyPlacement(scene, './placement.json');

// ---------------------------------------------------------------- splashes (made by the game, never saved)
const SPRAY = 700;
const sprayPos = new Float32Array(SPRAY * 3).fill(-999);
const sprayVel = new Float32Array(SPRAY * 3);
const sprayLife = new Float32Array(SPRAY);
const sprayGeo = new THREE.BufferGeometry();
sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
// Round, soft drops (a radial gradient on a canvas): plain points are squares and read as pixels, not water.
const drop = document.createElement('canvas');
drop.width = drop.height = 32;
{
  const g = drop.getContext('2d'), rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(0.5, 'rgba(255,255,255,.7)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 32, 32);
}
const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({ color: 0xfff6ea, size: 0.28, map: new THREE.CanvasTexture(drop), transparent: true, opacity: 0.95, depthWrite: false }));
spray.name = 'spray';
spray.userData.studio = false;
spray.frustumCulled = false;
scene.add(spray);
let sprayNext = 0;
const ringGeo = new THREE.RingGeometry(0.7, 1, 40);
ringGeo.rotateX(-Math.PI / 2);
const rings = Array.from({ length: 14 }, () => {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff6ea, transparent: true, opacity: 0, depthWrite: false }));
  m.userData.studio = false;
  m.visible = false;
  scene.add(m);
  return { m, age: 9, x: 0, z: 0 };
});
let ringNext = 0;
/** A splash at (x, z): a burst of spray (more when it hit harder) and a foam ring that spreads on the water. */
function splash(x, z, power, t) {
  const n = Math.min(90, 25 + Math.round(power * 6));
  for (let i = 0; i < n; i++) {
    const k = sprayNext++ % SPRAY;
    const a = rand() * Math.PI * 2, r = 0.3 + rand() * 0.5;
    sprayPos[k * 3] = x + Math.cos(a) * r;
    sprayPos[k * 3 + 1] = seaAt(x, z, t) + 0.2;
    sprayPos[k * 3 + 2] = z + Math.sin(a) * r;
    const out = 1 + rand() * 2.5;
    sprayVel[k * 3] = Math.cos(a) * out;
    sprayVel[k * 3 + 1] = 2.5 + rand() * (2 + power * 0.45);
    sprayVel[k * 3 + 2] = Math.sin(a) * out;
    sprayLife[k] = 1.4;
  }
  const ring = rings[ringNext++ % rings.length];
  Object.assign(ring, { age: 0, x, z });
  ring.m.visible = true;
}

// ---------------------------------------------------------------- crates the game drops
const dropped = []; // { g, vy, vx, vz, wet }
function dropCrate(x, z) {
  if (dropped.length >= MAX_CRATES) {
    const old = dropped.shift();
    scene.remove(old.g);
  }
  const g = new THREE.Group();
  g.name = 'crate';
  const bob = new THREE.Group();
  bob.name = 'bob';
  makeCrate(bob, dropped.length % 2);
  g.add(bob);
  g.position.set(x, 9 + rand() * 2, z);
  g.rotation.set(rand() * 0.8, rand() * 6.3, rand() * 0.8);
  scene.add(g);
  dropped.push({ g, vy: 0, vx: 0, vz: 0, wet: false, spin: (rand() - 0.5) * 2, heave: 0, heaveV: 0 });
}

// Tap the water: a crate drops there. (A raycast onto the flat sea is close enough: it lands where you tapped.)
const ray = new THREE.Raycaster();
const flat = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
renderer.domElement.addEventListener('pointerdown', (e) => {
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  if (ray.ray.intersectPlane(flat, hit) && hit.z < 10 && hit.z > -40) dropCrate(hit.x, hit.z);
});

// ---------------------------------------------------------------- the loop
const state = new Map(things.map((g) => [g, { heave: 0, heaveV: 0, pitch: 0, roll: 0 }]));
const countEl = document.getElementById('count');
let t = 0;
let dropIn = 0.8;
const E = 0.6; // m: how far apart the slope samples are

/** Spring a floating body toward the water under it, and tilt it with the slope (on `bob` only for placed things). */
function ride(s, x, z, size, draft, dt) {
  const h = seaAt(x, z, t);
  const e = E * size;
  const sx = (seaAt(x + e, z, t) - seaAt(x - e, z, t)) / (2 * e);
  const sz = (seaAt(x, z + e, t) - seaAt(x, z - e, t)) / (2 * e);
  // A stiff, damped spring: it lags the wave a little (it reads as weight), never sinks through it.
  s.heaveV += ((h - draft - s.heave) * 30 - s.heaveV * 6) * dt;
  s.heave += s.heaveV * dt;
  s.pitch += (Math.atan(sz) - s.pitch) * Math.min(1, dt * 5);
  s.roll += (-Math.atan(sx) - s.roll) * Math.min(1, dt * 5);
  return { sx, sz };
}

function update(dt) {
  t += dt;
  updateSea(t);
  for (const [g, s] of state) {
    if (!g.parent) continue;
    const f = g.userData.float;
    const bob = g.getObjectByName('bob');
    // Lifted out of the water in the editor (y > 0.8): it stays where it was put.
    if (g.position.y > 0.8) { bob.position.set(0, 0, 0); bob.rotation.set(0, 0, 0); continue; }
    ride(s, g.position.x, g.position.z, f.size, f.draft, dt);
    // The group may be turned in the editor: tilt in world axes by undoing its turn (a small error is fine at sea).
    const cy = Math.cos(g.rotation.y), sy = Math.sin(g.rotation.y);
    bob.position.y = s.heave - g.position.y;
    bob.rotation.x = s.pitch * cy - s.roll * sy;
    bob.rotation.z = s.roll * cy + s.pitch * sy;
  }
  // The buoys' lamps blink; the raft's flag waves; the lighthouse beam turns.
  scene.traverse((o) => {
    if (o.name === 'lamp' && o.material.emissiveIntensity !== undefined && o.parent?.parent?.name === 'buoy') o.material.emissiveIntensity = (t % 2) < 0.4 ? 5 : 0.4;
    if (o.name === 'flag') {
      const p = o.geometry.attributes.position, b = o.userData.base;
      for (let i = 0; i < p.count; i++) p.array[i * 3 + 2] = Math.sin(b[i * 3] * 6 - t * 7) * 0.1 * b[i * 3];
      p.needsUpdate = true;
    }
    if (o.name === 'beam') o.rotation.y = t * 0.6;
  });
  // Crates: fall, splash, then float — and the big swell pushes them toward the camera (surf).
  dropIn -= dt;
  if (dropIn <= 0) {
    dropCrate((rand() - 0.5) * 12, -10 + rand() * 11);
    dropIn = DROP_EVERY;
  }
  for (const d of dropped) {
    const g = d.g;
    if (!d.wet) {
      d.vy -= 9.81 * dt;
      g.position.y += d.vy * dt;
      g.rotation.x += d.spin * dt;
      const h = seaAt(g.position.x, g.position.z, t);
      if (g.position.y <= h) {
        d.wet = true;
        d.heave = g.position.y;
        d.heaveV = d.vy * 0.3;
        splash(g.position.x, g.position.z, -d.vy, t);
      }
      continue;
    }
    const { sx, sz } = ride(d, g.position.x, g.position.z, 1.1, 0.1, dt);
    // Down the slope: a wave's front face pushes a crate forward. Water drag keeps it from flying away.
    d.vx += (-sx * 6 - d.vx * 0.8) * dt;
    d.vz += (-sz * 6 - d.vz * 0.8) * dt;
    g.position.x += d.vx * dt;
    g.position.z += d.vz * dt;
    g.position.y = d.heave;
    g.rotation.x += (Math.atan(sz) - g.rotation.x) * Math.min(1, dt * 4);
    g.rotation.z += (-Math.atan(sx) - g.rotation.z) * Math.min(1, dt * 4);
  }
  // Spray: gravity, then gone.
  for (let k = 0; k < SPRAY; k++) {
    if (sprayLife[k] <= 0) continue;
    sprayLife[k] -= dt;
    sprayVel[k * 3 + 1] -= 9.81 * dt;
    sprayPos[k * 3] += sprayVel[k * 3] * dt;
    sprayPos[k * 3 + 1] += sprayVel[k * 3 + 1] * dt;
    sprayPos[k * 3 + 2] += sprayVel[k * 3 + 2] * dt;
    if (sprayLife[k] <= 0) sprayPos[k * 3 + 1] = -999;
  }
  sprayGeo.attributes.position.needsUpdate = true;
  for (const r of rings) {
    if (r.age > 2) { r.m.visible = false; continue; }
    r.age += dt;
    r.m.position.set(r.x, seaAt(r.x, r.z, t) + 0.05, r.z);
    r.m.scale.setScalar(0.6 + r.age * 2.2);
    r.m.material.opacity = Math.max(0, 0.7 * (1 - r.age / 2));
  }
  countEl.textContent = `Afloat ${things.filter((g) => g.parent).length + dropped.filter((d) => d.wet).length}`;
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  // Narrow screens (a phone held upright): pull back so the whole bay still fits across.
  camera.fov = camera.aspect < 1 ? 75 : 55;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- quality (auto, decided once in the first 2 s)
// The sea is a 170×170 grid moved on the CPU every frame plus a full-screen sky: on a phone at pixel ratio 3 the
// fragment work is what makes it slow. Same rule as Lantern Cove's setQuality (decided 2026-11-06, shelf stage 1):
// average frames 30–120 once; slower than ~45 fps → pixel ratio 1. (Antialiasing cannot be changed after the WebGL
// context is made, and at ratio 1 the moving sea hides the edges well enough, so it stays on.)
let quality = params.get('quality') || 'auto';
function setQuality(q) {
  quality = q;
  renderer.setPixelRatio(q === 'low' ? 1 : Math.min(devicePixelRatio || 1, HIGH_RATIO));
  resize();
}

update(0);
// The camera is passed because the game has not rendered yet (the loop starts below).
window.studio?.ready?.({ camera });

let last = -1, frames = 0, slowSum = 0, slowN = 0;
const ft = []; // recent frame times (ms), for the test hook
function frame(now) {
  const real = last < 0 ? 0 : Math.max(0, (now - last) / 1000);
  last = now;
  // dt is capped at 0.05 s: after a hidden tab or a long pause the sea moves on by one short step, not a jump.
  const dt = FIXED ? 1 / FIXED : Math.min(0.05, real);
  frames++;
  if (frames > 1 && !FIXED) { ft.push(real * 1000); if (ft.length > 120) ft.shift(); }
  if (quality === 'auto' && frames > 30 && !FIXED) {
    slowSum += real; slowN++;
    if (slowN === 90) setQuality(slowSum / slowN > 1 / 45 ? 'low' : 'high');
  }
  update(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Test hook (headless shots and the speed check). Not used by the game itself.
window.__swell = {
  scene,
  get t() { return t; },
  get frames() { return frames; },
  get quality() { return quality; },
  get pixelRatio() { return renderer.getPixelRatio(); },
  fps() { const a = ft.slice(-60); return a.length ? 1000 / (a.reduce((s, x) => s + x, 0) / a.length) : 0; },
  seaAt: (x, z) => seaAt(x, z, t),
};
