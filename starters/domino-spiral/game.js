/**
 * Domino Spiral — about 400 glowing dominoes wind inward in a spiral on a dark mirror floor. A steel ball rolls down
 * a ramp, knocks the first one over, and the fall runs all the way to the middle, lighting each domino as it lands.
 * Then they stand up again in a wave from the middle out, and the ball rolls again (a loop: no input needed).
 *
 * WHY this game (decided 2026-11-06): a sample that reads in 1 second and looks good in a 10-second clip — physics and
 * light, with no rules to learn. What it is for in the editor:
 *   - placed: three points, `head` (where the line starts; the ramp and the ball come with it), `bend` (how the
 *     lead-in curves) and `center` (the middle of the spiral). Drag one in Edit and the whole line follows it —
 *     the dominoes are laid along the path those points make (js/path.js), never saved one by one;
 *   - made by the game: the dominoes, the ramp, the ball (not in the placement file, not in the editor's list).
 * The paused moment's showcase: pause when half the spiral is down, ask “Make the dominoes twice as tall.” Your AI
 * changes DOMINO_HEIGHT below, and Before / After shows the same second with a much bigger fall.
 *
 * Everything moves in fixed steps of simulated time and nothing is random, so a run is the same run every load (the
 * editor's Try replays to the same second and sees the same fall).
 */

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { applyPlacement } from './studio-placement.js';
import { layDominoes, MAX_DOMINOES } from './js/path.js';
import { makeLine } from './js/topple.js';

// Tell the editor (when it is there) that the layout is final only after placement.json is applied. No-op otherwise.
window.studio?.waitForReady?.();

// ---------------------------------------------------------------- the numbers an AI is asked to change
// How tall a domino is (m). 1.0 = the spiral as shipped (recommended); 2.0 = towering, the fall is a big wave (and,
// as in real life, a taller row at the same spacing falls faster); 0.7 = the lowest that still topples (the ball
// pushes at about 0.35 m).
const DOMINO_HEIGHT = 1.0;
// Distance between two dominoes along the line (m). Under about half the height they topple; much more and the push
// no longer reaches the next one. 0.5 with 1.0 tall ≈ 430 dominoes on the shipped path.
const GAP = 0.5;
// A domino's other two sides (m): thickness (front to back) and width (side to side).
const THICK = 0.16;
const WIDE = 0.55;
// Gravity in the physics only (m/s²). The world is a toy table blown up: a real 5 cm domino row seen as 1 m dominoes
// falls about 6× faster than 1 m slabs would. 60 = the whole spiral down in about 15 s (recommended: one 10-second
// clip holds the best half); 9.81 = true to the size, slow and heavy (≈ 40 s).
const G = 60;
// The ball lets go this long after a run starts (s), then rolls down the ramp and hits the first domino ≈ 1 s later.
const BALL_START = 0.4;
// After the last domino is down: a rest (s), then they stand up again in a wave from the middle out (RISE s), and the
// ball rolls again. WHY a loop (decided 2026-11-06): with taller dominoes the fall ends in a few seconds, and a clip
// that is a still picture for its last half sells nothing; the rising wave is a second show of its own. It is all
// time, no input: a run, a paused second and a Try stay the same.
const REST = 1.0;
const RISE = 2.2;

// ---------------------------------------------------------------- renderer, scene, camera
const params = new URLSearchParams(location.search);
// Phones and small screens draw at pixel ratio 1 with half-size reflections (decided 2026-11-06, as Lantern Cove's
// setQuality): a phone's 3× screen would draw 9× the pixels for a picture you cannot tell apart at arm's length.
const PHONE = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
let quality = params.get('quality') || (PHONE ? 'low' : 'auto');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(quality === 'low' ? 1 : Math.min(devicePixelRatio || 1, 2));
// ACES at a low exposure keeps the glow saturated where it is bright (AgX turned the neon pastel; tried 2026-11-06).
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07060c);
scene.fog = new THREE.FogExp2(0x07060c, 0.022); // the far floor fades into the dark: its edge is never seen
// Reflections on the dominoes and the ball: a soft studio room, baked once (no files: RoomEnvironment is code).
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();
}
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);

// Light: a dim cool sky, and one warm spot from high above that throws the dominoes' shadows across the floor.
scene.add(new THREE.HemisphereLight(0x8a90c8, 0x120c1a, 0.5));
const spot = new THREE.SpotLight(0xffe2c4, 900, 80, 0.62, 0.55, 1.6);
spot.position.set(-6, 26, 8);
spot.castShadow = true;
spot.shadow.mapSize.setScalar(quality === 'low' ? 1024 : 2048);
spot.shadow.bias = -0.0004;
spot.shadow.normalBias = 0.02;
scene.add(spot, spot.target);

// ---------------------------------------------------------------- the floor: a dark mirror with the shadows on it
// The mirror (Reflector) draws the scene once more upside down: the glowing line doubles in the floor. Its colour is
// overlaid on what it shows (mid grey ≈ as is; 0x4a4658 hid the reflection entirely, tried 2026-11-06), and the dark
// film below makes it read as polished black stone, not a mirror.
const mirror = new Reflector(new THREE.CircleGeometry(90, 64), {
  color: 0x7c7a88,
  textureWidth: Math.round(innerWidth * (quality === 'low' ? 0.5 : 1)),
  textureHeight: Math.round(innerHeight * (quality === 'low' ? 0.5 : 1)),
  clipBias: 0.003,
});
mirror.name = 'floor';
mirror.userData.studio = false; // the floor is not a thing to drag
mirror.rotation.x = -Math.PI / 2;
scene.add(mirror);
// A dark film over the mirror, clearer near the middle and darker away from it (a radial gradient painted on a
// canvas), so the reflection fades out with distance like a real glossy floor.
const film = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  // An alphaMap is read from the green channel, so the gradient is painted in opaque greys (rgba with alpha read as
  // white everywhere: the film was solid and hid the mirror, 2026-11-06).
  rg.addColorStop(0, 'rgb(20,20,20)');
  rg.addColorStop(0.35, 'rgb(90,90,90)');
  rg.addColorStop(1, 'rgb(250,250,250)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 256, 256);
  const m = new THREE.Mesh(new THREE.CircleGeometry(90, 64), new THREE.MeshBasicMaterial({ color: 0x07060c, alphaMap: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  m.scale.setScalar(0.55);
  m.userData.studio = false;
  m.renderOrder = 1;
  scene.add(m);
  return m;
})();
// The shadows: a plane that only darkens where a shadow falls (the mirror itself cannot take shadows).
const shade = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.ShadowMaterial({ opacity: 0.55 }));
shade.rotation.x = -Math.PI / 2;
shade.position.y = 0.004;
shade.receiveShadow = true;
shade.userData.studio = false;
shade.renderOrder = 2;
scene.add(shade);

// ---------------------------------------------------------------- the three placed points
/** A point you place: a thin glowing ring on the floor with a small pin, so it can be seen and picked from above. */
function marker(key, x, z, color) {
  const g = new THREE.Group();
  g.name = key;
  const mat = new THREE.MeshStandardMaterial({ color: 0x15131c, emissive: color, emissiveIntensity: 1.4, roughness: 0.4 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.045, 8, 48), mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.03;
  const pin = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 12), mat);
  pin.rotation.x = Math.PI;
  pin.position.y = 0.21;
  g.add(ring, pin);
  g.position.set(x, 0, z);
  scene.add(g);
  return g;
}
const head = marker('head', -14.5, 4, 0x9fe8ff);
const bend = marker('bend', -10, 7, 0xd8b6ff);
const center = marker('center', 3.5, -2, 0xffc6e6);
// The pins say where the points are; the center one would stand in the middle of the last ring, under the dominoes
// that fall there: it is left a ring only.
center.children[1].visible = false;

await applyPlacement(scene, './placement.json');

// ---------------------------------------------------------------- the dominoes (one instanced mesh, made by the game)
const domGeo = new RoundedBoxGeometry(WIDE, DOMINO_HEIGHT, THICK, 2, 0.03);
const domMat = new THREE.MeshStandardMaterial({ color: 0x2a2833, roughness: 0.22, metalness: 0.1 });
// Each domino glows in its own colour (instanceColor) by its own amount (aGlow): the emissive is made per instance.
domMat.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying float vGlow;')
    // The body takes a hint of its colour; the light it gives is all colour. vColor = the instance's colour.
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance = vColor.rgb * vGlow;');
};
const dominoes = new THREE.InstancedMesh(domGeo, domMat, MAX_DOMINOES);
dominoes.name = 'dominoes';
dominoes.userData.studio = false; // made by the game from the three points: not a thing to drag one by one
dominoes.castShadow = true;
dominoes.frustumCulled = false; // the box of an instanced mesh is its geometry's, not the whole spiral's
const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_DOMINOES), 1);
glowAttr.setUsage(THREE.DynamicDrawUsage);
domGeo.setAttribute('aGlow', glowAttr);
dominoes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
scene.add(dominoes);
const glow = glowAttr.array;

// ---------------------------------------------------------------- the ramp and the ball (made by the game, with the head)
const RAMP_LEN = 3.2, RAMP_TOP = 1.5, BALL_R = 0.34;
const RAMP_SLOPE = Math.atan2(RAMP_TOP, RAMP_LEN);
const ramp = new THREE.Group();
ramp.userData.studio = false;
{
  const len = Math.hypot(RAMP_LEN, RAMP_TOP);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, len), new THREE.MeshStandardMaterial({ color: 0x1d1b26, roughness: 0.35, metalness: 0.6 }));
  deck.position.set(0, RAMP_TOP / 2, -RAMP_LEN / 2);
  deck.rotation.x = RAMP_SLOPE; // + = the far end (−z) up, the end at the first domino down
  deck.castShadow = deck.receiveShadow = true;
  // Two light rails along its edges: the ramp reads in the dark and leads the eye to the first domino.
  const railMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9fe8ff).multiplyScalar(2.2) });
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, len), railMat);
    rail.position.set(s * 0.45, RAMP_TOP / 2 + 0.06, -RAMP_LEN / 2);
    rail.rotation.x = RAMP_SLOPE; // + = the far end (−z) up, the end at the first domino down
    ramp.add(rail);
  }
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.9, RAMP_TOP, 0.12), deck.material);
  post.position.set(0, RAMP_TOP / 2, -RAMP_LEN);
  post.castShadow = true;
  ramp.add(deck, post);
}
scene.add(ramp);
const ball = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 24), new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.08, envMapIntensity: 2.2 }));
ball.userData.studio = false;
ball.castShadow = true;
scene.add(ball);

// ---------------------------------------------------------------- laying the line from the points
let laid = [];
let line = null;
let lit = new Float32Array(0); // a domino's flash after it is hit, fading (0 … 2.5)
let ballS = 0, ballV = 0, ballHit = false; // the ball: how far along its run (m from the ramp's top), its speed
let simT = 0; // seconds since Play (for the camera)
let runT = 0; // seconds since this run's ball was set at the top
let downFor = 0; // how long every domino has been down (s)
let rising = null; // while standing up again: { t, from: the tilts they rise from, lit: which have lit up }
let fwdX = 0, fwdZ = 1; // the line's direction at the head (the ramp and the ball run along it)
const seen = { hx: NaN, hz: NaN, bx: NaN, bz: NaN, cx: NaN, cz: NaN };
const colorOf = new THREE.Color();

/** Lay the dominoes along the points' path and stand them all up again (the fall starts over). */
function relay() {
  laid = layDominoes(head.position, bend.position, center.position, GAP);
  lit = new Float32Array(laid.length);
  dominoes.count = laid.length;
  // Colour along the line: ice blue at the head through violet and pink to amber in the middle.
  for (let i = 0; i < laid.length; i++) {
    const f = i / Math.max(1, laid.length - 1);
    colorOf.setHSL((0.53 + 0.55 * f) % 1, 0.95, 0.56);
    dominoes.setColorAt(i, colorOf);
  }
  if (dominoes.instanceColor) dominoes.instanceColor.needsUpdate = true;
  const a = laid[0] || { x: head.position.x, z: head.position.z, yaw: 0 };
  fwdX = Math.sin(a.yaw);
  fwdZ = Math.cos(a.yaw);
  // The ramp ends a ball's width behind the first domino, along the line's direction.
  ramp.position.set(a.x - fwdX * (BALL_R * 2 + 0.25), 0, a.z - fwdZ * (BALL_R * 2 + 0.25));
  ramp.rotation.set(0, a.yaw, 0);
  newRun();
  Object.assign(seen, { hx: head.position.x, hz: head.position.z, bx: bend.position.x, bz: bend.position.z, cx: center.position.x, cz: center.position.z });
  draw(0);
}
/** A new run on the same line: every domino standing, the ball at the top of the ramp. */
function newRun() {
  line = makeLine(laid.length, { h: DOMINO_HEIGHT, t: THICK, gap: GAP, g: G });
  ballS = 0;
  ballV = 0;
  ballHit = false;
  runT = 0;
  downFor = 0;
  rising = null;
}
const moved = () => seen.hx !== head.position.x || seen.hz !== head.position.z || seen.bx !== bend.position.x || seen.bz !== bend.position.z || seen.cx !== center.position.x || seen.cz !== center.position.z;

// WHY here: in Edit the editor holds the game's frames and draws the scene itself, so the game loop does not run while
// a point is dragged. Every draw (the editor's or the game's) brings the scene's matrices up to date first, and that
// passes through this mesh: the line is laid again the moment a point has moved, in Edit as in Play.
const baseUpdate = dominoes.updateMatrixWorld.bind(dominoes);
dominoes.updateMatrixWorld = (force) => {
  if (moved()) {
    simT = 0;
    relay();
  }
  baseUpdate(force);
};

// ---------------------------------------------------------------- one step of the world (fixed dt)
const STEP = 1 / 240;
function step(dt) {
  simT += dt;
  runT += dt;
  if (rising) return riseStep(dt);
  // The ball: still at the top, then down the ramp (rolling, so 5/7 of g along the slope), then along the floor.
  if (runT >= BALL_START) {
    const onRamp = ballS < Math.hypot(RAMP_LEN, RAMP_TOP);
    if (onRamp) ballV += (5 / 7) * 9.81 * 2 * Math.sin(RAMP_SLOPE) * dt;
    else ballV *= Math.exp(-(ballHit ? 2.5 : 0.15) * dt); // rolling friction; after the hit it soon stops
    ballS += ballV * dt;
    // The hit: the ball reaches the first domino's back face. It gives most of its speed to the domino.
    // (The ramp's foot is 2 ball radii + 0.25 m behind the first domino's middle; its back face is THICK / 2 nearer.)
    const toDomino = Math.hypot(RAMP_LEN, RAMP_TOP) + BALL_R + 0.25 - THICK / 2;
    if (!ballHit && ballS >= toDomino && laid.length) {
      ballHit = true;
      line.push(0, (ballV * 0.9) / (DOMINO_HEIGHT * 0.35));
      ballV *= 0.25;
    }
    if (ballHit) ballS = Math.min(ballS, toDomino + Math.max(0, line.th[0]) * DOMINO_HEIGHT * 0.35);
  }
  line.step(dt);
  downFor = laid.length && line.fallen() >= laid.length ? downFor + dt : 0;
  if (downFor > REST) rising = { t: 0, from: Float64Array.from(line.th), lit: new Uint8Array(laid.length) };
}

/** Standing up again: the middle first, out to the head, each one in 0.4 s with a flash as it starts. */
function riseStep(dt) {
  rising.t += dt;
  const n = laid.length;
  for (let i = 0; i < n; i++) {
    const f = Math.min(1, Math.max(0, (rising.t - ((n - 1 - i) / n) * RISE) / 0.4));
    if (f > 0 && !rising.lit[i]) {
      rising.lit[i] = 1;
      // A softer flash than a hit (draw(): hit × 0.2 = 0.7): 7 (= 1.4) turned the whole frame white under the bloom
      // when the tall lead-in near the camera rose (seen in the clip, 2026-11-06).
      line.hit[i] = 3.5;
    }
    line.th[i] = rising.from[i] * (1 - f * f * (3 - 2 * f));
  }
  // The ball goes back up the ramp with the first ones, so it is waiting at the top when the line is standing.
  ballS = Math.max(0, ballS * (1 - Math.min(1, rising.t / RISE)));
  if (rising.t >= RISE + 0.6) newRun();
}

// ---------------------------------------------------------------- drawing what the world is now
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
const countEl = document.getElementById('count');
let shownDown = -1;
function draw(dt) {
  const th = line.th;
  const fade = Math.exp(-dt * 3);
  for (let i = 0; i < laid.length; i++) {
    const d = laid[i], a = th[i];
    const sy = Math.sin(d.yaw), cy = Math.cos(d.yaw);
    // Turning about the front bottom edge: the edge stays put, the middle swings forward and down.
    const y = (DOMINO_HEIGHT / 2) * Math.cos(a) + (THICK / 2) * Math.sin(a);
    const z = (DOMINO_HEIGHT / 2) * Math.sin(a) - (THICK / 2) * Math.cos(a) + THICK / 2;
    v.set(d.x + sy * z, y, d.z + cy * z);
    q.setFromEuler(e.set(a, d.yaw, 0));
    dominoes.setMatrixAt(i, m4.compose(v, q, one));
    // The glow: a soft light standing, a flash when it is hit, and a little more light once it is down — so the fall
    // leaves a lit trail behind it as it runs to the middle. (Tried 2026-11-06: 1.2 once down washed the trail out to
    // white under the bloom; the colours must survive.)
    lit[i] = Math.max(lit[i] * fade, Math.min(1.8, line.hit[i] * 0.2));
    line.hit[i] = 0;
    glow[i] = 0.3 + 0.28 * Math.min(1, a / 1.2) + lit[i];
  }
  dominoes.instanceMatrix.needsUpdate = true;
  glowAttr.needsUpdate = true;
  // The ball along its run: down the ramp's slope, then flat on the floor, rolling.
  const len = Math.hypot(RAMP_LEN, RAMP_TOP);
  const s = Math.min(ballS, len), flat = Math.max(0, ballS - len);
  const back = RAMP_LEN - s * Math.cos(RAMP_SLOPE) - flat; // distance behind the ramp's foot
  ball.position.set(ramp.position.x - fwdX * back, BALL_R + 0.04 + RAMP_TOP - s * Math.sin(RAMP_SLOPE), ramp.position.z - fwdZ * back);
  ball.rotation.set(ballS / BALL_R, Math.atan2(fwdX, fwdZ), 0, 'YXZ');
  const down = line.fallen();
  if (down !== shownDown) {
    shownDown = down;
    countEl.textContent = `Down ${down} / ${laid.length}`;
  }
}

relay();

// ---------------------------------------------------------------- post-processing: bloom makes the dominoes glow
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 }));
composer.addPass(new RenderPass(scene, camera));
// threshold 0.35: only what glows blooms (the dominoes, the rails, the rings), never the lit floor around them.
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.45, 0.3);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function setQuality(qq) {
  quality = qq;
  renderer.setPixelRatio(qq === 'low' ? 1 : Math.min(devicePixelRatio || 1, 2));
  for (const target of [composer.renderTarget1, composer.renderTarget2]) {
    target.samples = qq === 'low' ? 0 : 4;
    target.dispose();
  }
  resize();
}

// ---------------------------------------------------------------- camera: high over the front, the whole spiral in view
// Landscape: from the front, a little left: the lead-in runs in from the left edge and the spiral fills the middle.
// Portrait phones: from the right side and high up, so the line's long way (left to right on a wide screen) runs
// top to bottom: the lead-in at the top, the spiral filling the width below it.
const VIEW = { wide: { at: [-4.5, 14, 24], look: [-2, 0, -2], fov: 42 }, tall: { at: [24, 33, -1.5], look: [-2.5, 0, -1.5], fov: 60 } };
let view = VIEW.wide;
function aimCamera(t) {
  // A slow drift around the middle (0.6° a second) keeps the picture alive; the same t gives the same shot.
  const a = t * 0.0105;
  const [x, y, z] = view.at;
  camera.position.set(x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a));
  camera.lookAt(view.look[0], view.look[1], view.look[2]);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(w, h);
  camera.aspect = w / h;
  view = camera.aspect < 1 ? VIEW.tall : VIEW.wide;
  camera.fov = view.fov;
  camera.updateProjectionMatrix();
  aimCamera(simT);
}
addEventListener('resize', resize);
resize();

// The camera is passed because the game has not rendered yet (the loop starts below).
window.studio?.ready?.({ camera });

// ---------------------------------------------------------------- the loop: fixed steps of simulated time
let last = -1, acc = 0, frames = 0, slow = 0, slowN = 0;
function frame(now) {
  const real = last < 0 ? 0 : Math.max(0, (now - last) / 1000);
  last = now;
  // At most 0.1 s of world per frame: a tab coming back from the background does not run the whole fall at once.
  acc += Math.min(real, 0.1);
  let n = 0;
  while (acc >= STEP) {
    step(STEP);
    acc -= STEP;
    n++;
  }
  draw(n * STEP);
  aimCamera(simT);
  composer.render();
  // Auto quality: the frames 30–120 averaged once; slower than ~45 fps → pixel ratio 1 and no multisampling.
  if (quality === 'auto' && ++frames > 30 && frames <= 120) {
    slow += real;
    slowN++;
    if (frames === 120 && slow / slowN > 1 / 45) setQuality('low');
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For tests and tools: what the world is now (read-only numbers, nothing the game depends on).
window.dominoSpiral = {
  get t() { return simT; },
  get count() { return laid.length; },
  get down() { return line.fallen(); },
  get quality() { return quality; },
  get height() { return DOMINO_HEIGHT; },
  /** Where the first domino stands ({ x, z }): it is on the head, wherever the head was dragged. */
  get first() { return laid[0] ? { x: laid[0].x, z: laid[0].z } : null; },
};
