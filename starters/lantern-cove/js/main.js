// Lantern Cove — a small dusk harbour: clear water, a lighthouse, boats that float. Tap the water to sail.
//
// A starter for KUMODeck Game Studio. Almost everything is made from code at load, so it opens fast and every object
// has a stable name for the editor (see props.js). A few things come from files in assets/ (the sails, the planks,
// the barrel, the buoy's bell and the sea), so the editor's Assets panel has real files to show and swap
// (2026-10-17). They are small (≈ 0.27 MB together), made by scripts/make-starter-assets.mjs in the Game Studio
// package, and every one is optional: a missing file falls back to the code version (or silence).
//
// Picture, in the order it is built each frame:
//   sky (baked once, sky.js) → land + props with a low warm sun and long soft shadows → see-through water with a
//   real reflection (water.js) → clamp (no NaN/inf pixel can blow the bloom) → bloom (the sun, its glitter path and
//   the lanterns) → ACES tone mapping → a quiet vignette and film grain.
// In the editor the game is paused and the editor draws the scene itself with a plain render (no bloom, same tone
// mapping), so the edit view stays fast and the colours stay the same.
//
// URL switches (for tests and the shots in docs/): ?fixed=30 → every frame advances exactly 1/30 s (smooth video
// from a slow headless browser); ?quality=low|high skips the automatic quality check.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { applyPlacement } from '../studio-placement.js';
import { SUN_DIR, SUN_COLOR, HAZE_COLOR, bakeSky } from './sky.js';
import { makeTerrain, makeDepthField } from './terrain.js';
import { makeWater } from './water.js';
import { makeProps } from './props.js';
import { makeSim } from './sim.js';
import { makeDecor } from './decor.js';

// Tell the editor (when it is there) that the layout is final only after placement.json is applied. No-op otherwise.
window.studio?.waitForReady?.();

// ------------------------------------------------------------------ files (assets/)
// Started first, awaited before the props are built (≈ 0.13 MB from the same server), so the very first frame and
// the editor's first look at the scene already have them. A file that is missing or broken gives null: props.js then uses its
// code version, so deleting a file never breaks the cove.
// WHY three's loaders and not fetch: the editor learns which object uses which file from them (a texture keeps its
// image's URL; r186 announces loaders, so a glTF scene is traced back to its .glb): "Used by: crate, pier, rowboat".
const optional = (url, p) => p.catch(() => (console.warn(`[cove] ${url} did not load: using the code version`), null));
const picture = (url) => optional(url, new THREE.TextureLoader().loadAsync(url).then((t) => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4; // the sails are seen at a grazing angle: keeps the seams sharp
  return t;
}));
const files = Promise.all([
  picture('assets/sail.jpg'),
  picture('assets/planks.jpg'),
  optional('assets/barrel.glb', new GLTFLoader().loadAsync('assets/barrel.glb').then((g) => g.scene)),
]);

const params = new URLSearchParams(location.search);
const FIXED = Number(params.get('fixed')) || 0;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: FIXED > 0 });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.toneMapping = THREE.ACESFilmicToneMapping; // AgX turns sunsets beige; ACES keeps them warm
renderer.toneMappingExposure = 0.88;
renderer.shadowMap.enabled = true;
renderer.info.autoReset = false; // counted per whole frame (reflection + post passes), reset in frame()
renderer.shadowMap.type = THREE.PCFShadowMap; // r186: PCF is soft (PCFSoft was folded into it)
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const sky = bakeSky(renderer);
scene.background = sky.background;
scene.environment = sky.environment;
scene.environmentIntensity = 0.6;
scene.fog = new THREE.FogExp2(HAZE_COLOR, 0.0045); // "air": far things fade into the dusk haze

const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 1500);

// Low warm sun with long soft shadows over the whole cove.
const sun = new THREE.DirectionalLight(SUN_COLOR, 2.7);
sun.position.copy(SUN_DIR).multiplyScalar(120).add(new THREE.Vector3(0, 0, -10));
sun.target.position.set(0, 0, -10);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 40, bottom: -40, near: 40, far: 240 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

const depth = makeDepthField();
const terrain = makeTerrain(SUN_DIR, SUN_COLOR);
scene.add(terrain.mesh);
const water = makeWater(renderer, depth, { sunDir: SUN_DIR, sunColor: SUN_COLOR });
scene.add(water.mesh);
const [sailTex, plankTex, barrelModel] = await files; // started at the top: downloaded while the sky was baking
const props = makeProps({ sail: sailTex, planks: plankTex, barrel: barrelModel });
for (const p of props.all) scene.add(p);
const decor = makeDecor(props.rockMaterial);
scene.add(decor.group);

await applyPlacement(scene, './placement.json');
const sim = makeSim({ scene, props, floorAt: depth.at });

// ------------------------------------------------------------------ sound: the sea, and the bell on the buoy
// Browsers play sound only after the person taps or presses a key, so both start then. The bell is positional
// (it lives on the buoy: louder when the camera is near it) and rings every 6–10 s of game time. The editor pauses
// the game loop, so the sound pauses with it (see quiet() below): editing is silent.
const listener = new THREE.AudioListener();
camera.add(listener);
const sea = new THREE.Audio(listener);
sea.setLoop(true);
sea.setVolume(0.32);
const bell = new THREE.PositionalAudio(listener);
bell.setRefDistance(9);
bell.setVolume(0.8);
// The author's mark, so the editor lists assets/bell.mp3 under "buoy" for sure. Without it the demo's Assets panel
// showed the sound as used by no object (seen 2026-10-17; the loader tracing covers textures and models).
bell.userData.studioAsset = 'assets/bell.mp3';
props.buoy.getObjectByName('bob').add(bell);
const audioLoader = new THREE.AudioLoader();
// MP3 files start and end with a few ms of encoder padding: loop inside it, so the sea has no click at the seam.
audioLoader.load('assets/waves.mp3', (b) => { sea.setBuffer(b); sea.setLoopStart(0.05); sea.setLoopEnd(b.duration - 0.05); }, undefined, () => {});
audioLoader.load('assets/bell.mp3', (b) => bell.setBuffer(b), undefined, () => {});
let soundOn = false, nextBell = 2, lastFrameAt = 0;
function startSound() {
  if (soundOn) return;
  soundOn = true;
  listener.context.resume().catch(() => {});
}
addEventListener('pointerdown', startSound);
addEventListener('keydown', startSound);
// No frame for a moment (the editor holds the game, or the tab is hidden) → suspend; the next frame resumes.
setInterval(() => {
  if (soundOn && listener.context.state === 'running' && performance.now() - lastFrameAt > 400) listener.context.suspend().catch(() => {});
}, 250);
function soundStep(t) {
  lastFrameAt = performance.now();
  if (!soundOn) return;
  if (listener.context.state === 'suspended') listener.context.resume().catch(() => {});
  if (sea.buffer && !sea.isPlaying) sea.play();
  if (t > nextBell && bell.buffer) {
    nextBell = t + 6 + ((t * 7.3) % 4);
    if (bell.isPlaying) bell.stop();
    bell.play();
  }
}
// The camera is passed because the game has not rendered yet (the loop starts below).
window.studio?.ready?.({ camera });

// ------------------------------------------------------------------ post-processing
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new ShaderPass({
  // WHY: one NaN or 1e5 pixel before the bloom turns the whole screen black or white (learned the hard way).
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
    void main(){ vec4 c = texture2D(tDiffuse, vUv); if (any(isnan(c.rgb)) || any(isinf(c.rgb))) c.rgb = vec3(0.); gl_FragColor = vec4(min(c.rgb, vec3(48.)), 1.); }`,
}));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.42, 0.45, 2.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime; uniform float uAspect; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);                    // gentle S-curve: deeper shadows, same highlights
      c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.12);     // a touch more colour
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      c *= mix(1.0, 0.72, smoothstep(0.35, 1.05, length(q)));       // vignette: the eye rests in the middle
      c += (h(vUv * 913.0 + fract(uTime) * 37.0) - 0.5) * 0.018;     // fine grain: hides gradient banding in the sky
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade);

// ------------------------------------------------------------------ quality (auto, decided once in the first 2 s)
let quality = params.get('quality') || 'auto';
function setQuality(q) {
  quality = q;
  renderer.setPixelRatio(q === 'low' ? 1 : Math.min(devicePixelRatio || 1, 1.5));
  // The composer draws into two targets (the one we gave it and a clone); both must change, then be re-made.
  for (const target of [composer.renderTarget1, composer.renderTarget2]) { target.samples = q === 'low' ? 0 : 4; target.dispose(); }
  resize();
}

// ------------------------------------------------------------------ camera
// Opening shot: low over the water (reflections show best at a low angle), the lighthouse and the sun on the left,
// the boat in the middle third, the cottage and the pier on the right. In Play the camera drifts toward the boat.
// Portrait phones see a narrow slice: aim further left so the lighthouse, the sun and the boat still share it.
const LANDSCAPE = { pos: new THREE.Vector3(8, 4.2, 35), look: new THREE.Vector3(-1, 2.6, -14) };
const PORTRAIT = { pos: new THREE.Vector3(-4, 4.6, 36), look: new THREE.Vector3(-13, 3.2, -14) };
let BASE = LANDSCAPE;
const boatStart = props.boat.position.clone();
const camPos = BASE.pos.clone(), camLook = BASE.look.clone();
let follow = 0;
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.fov = camera.aspect < 1 ? 62 : 42; // portrait phones: wider, so the lighthouse and the boat both stay in
  const base = camera.aspect < 1 ? PORTRAIT : LANDSCAPE;
  if (base !== BASE) { BASE = base; camPos.copy(base.pos); camLook.copy(base.look); camera.position.copy(camPos); camera.lookAt(camLook); }
  camera.updateProjectionMatrix();
  grade.uniforms.uAspect.value = camera.aspect;
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ input: tap/drag the water, or WASD / arrows
const keys = new Set();
const hint = document.getElementById('hint');
const used = () => hint && hint.classList.add('gone');
addEventListener('keydown', (e) => { keys.add(e.code); if (/^(Key[WASD]|Arrow)/.test(e.code)) { sim.ctl.target = null; used(); } });
addEventListener('keyup', (e) => keys.delete(e.code));
const ray = new THREE.Raycaster(), seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
let dragging = false;
function aim(e) {
  ray.setFromCamera(new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1), camera);
  if (ray.ray.intersectPlane(seaPlane, hit)) sim.ctl.target = hit.clone();
}
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; aim(e); used(); });
addEventListener('pointermove', (e) => dragging && aim(e));
addEventListener('pointerup', () => (dragging = false));

// ------------------------------------------------------------------ loop
const timer = new THREE.Timer();
let t = 0, frames = 0, firstFrameAt = 0, slowSum = 0, slowN = 0;
const ft = []; // recent frame times (ms), for the test hook
function frame() {
  timer.update();
  renderer.info.reset();
  const real = timer.getDelta();
  const dt = FIXED ? 1 / FIXED : Math.min(real, 1 / 20);
  t += dt;
  frames++;
  if (frames > 1 && !FIXED) { ft.push(real * 1000); if (ft.length > 120) ft.shift(); }
  // Auto quality: average the frames 30–120 once; slower than ~45 fps → drop MSAA and the high pixel ratio.
  if (quality === 'auto' && frames > 30 && !FIXED) {
    slowSum += real; slowN++;
    if (slowN === 90) setQuality(slowSum / slowN > 1 / 45 ? 'low' : 'high');
  }

  sim.ctl.thrust = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 0.5 : 0);
  sim.ctl.turn = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  if (sim.ctl.target && props.boat.position.distanceTo(tmpV.set(sim.ctl.target.x, props.boat.position.y, sim.ctl.target.z)) < 2.2 && !dragging) sim.ctl.target = null;
  sim.step(dt, t);
  decor.step(t);
  soundStep(t);
  water.uniforms.uTime.value = t;
  terrain.uniforms.uTime.value = t;
  grade.uniforms.uTime.value = t;

  // Camera: breathe a little; once the boat has moved, lean toward it (it never leaves the cove picture entirely).
  const bp = props.boat.position;
  if (Math.abs(sim.speed()) > 0.3) follow = Math.min(1, follow + dt * 0.5);
  const off = tmpV.copy(bp).sub(boatStart).multiplyScalar(0.75 * follow);
  const wantPos = tmpP.copy(BASE.pos).add(off);
  wantPos.x += Math.sin(t * 0.13) * 0.6;
  wantPos.y = Math.max(1.6, wantPos.y + Math.sin(t * 0.21) * 0.15);
  const wantLook = tmpL.copy(BASE.look).lerp(bp, 0.45 * follow);
  const k = 1 - Math.exp(-dt * 2.2);
  camPos.lerp(wantPos, k);
  camLook.lerp(wantLook, k);
  camera.position.copy(camPos);
  camera.lookAt(camLook);

  composer.render(dt);
  if (!firstFrameAt) firstFrameAt = performance.now(); // ms since the page started loading (engine download included)
}
const tmpV = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpL = new THREE.Vector3();
renderer.setAnimationLoop(frame);

// Test hook (headless shots and the speed check in docs/). Not used by the game itself.
window.__cove = {
  scene,
  get t() { return t; },
  get frames() { return frames; },
  get firstFrameMs() { return firstFrameAt; },
  get quality() { return quality; },
  fps() { const a = ft.slice(-60); return a.length ? 1000 / (a.reduce((s, x) => s + x, 0) / a.length) : 0; },
  info: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
  sail(x, z) { sim.ctl.target = new THREE.Vector3(x, 0, z); used(); },
};
