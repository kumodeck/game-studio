/**
 * Three Isles — a small three.js game with three levels: roll the ball, pick up the gems, reach the flag.
 *
 * Sample for KUMODeck Game Studio's levels (2026-10-22). The code has the levels (LEVELS in ./levels.js); the editor
 * lists them, switches between them, and can copy, rename, reorder or delete them (those wait in placement.json until
 * the AI changes this code). Two calls make that work:
 *   window.studio?.levels?.(LEVELS) — in the editor: { id, build } = the level it shows; in the shipped game: null
 *   applyPlacement(scene, './placement.json', { level }) — that level's saved layout only
 * Every object is named, with the same names in each level, so a copy of a level keeps its keys.
 *
 * Each level is its own landform (10/22: "levels should differ in their design — different terrain reads at
 * a glance"; the first version only changed the floor's colour): a height function per level (./levels.js) becomes
 * the ground's mesh AND the ball's floor, so what you see is what you roll on. Slopes pull the ball down, a step too
 * high stops it (cliffs, canyon walls, the mountain's face), and a drop off the edge or into the chasm puts it back
 * at the level's start.
 *
 * Controls: WASD / arrow keys, or drag anywhere for a floating joystick (touch and mouse).
 */

import * as THREE from 'three';
import { applyPlacement } from './studio-placement.js';
import { HALF, LEVELS, terrainMesh, make } from './levels.js';

const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 300);
const hemi = new THREE.HemisphereLight(0xffffff, 0x6b7f8f, 1.7);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(8, 20, 6);
scene.add(sun);

const player = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16), new THREE.MeshStandardMaterial({ color: 0xff7a45, roughness: 0.35 }));
player.name = 'player';
scene.add(player);
const vel = new THREE.Vector3();
let fall = 0; // the ball's own vertical speed while it is above the ground (a drop off a ledge, into the chasm)

// ------------------------------------------------------------------ levels
let level = null; // { id, def, ground, gems: Mesh[], flag, got }

/** The floor under (x, z): the level's height function, following the ground if the editor moved it. */
function floorAt(x, z) {
  const g = level.ground;
  return level.def.height(x - g.position.x, z - g.position.z) + g.position.y;
}

function placePlayer() {
  const [x, z] = level.def.start;
  player.position.set(x, floorAt(x, z) + 0.8, z);
  vel.set(0, 0, 0);
  fall = 0;
}

async function startLevel(id, build = id) {
  for (const o of scene.children.filter((c) => c.userData.lvl)) scene.remove(o);
  const def = LEVELS.find((l) => l.id === build) || LEVELS[0];
  const look = def.look;
  scene.background = new THREE.Color(look.sky);
  scene.fog = look.fog ? new THREE.Fog(look.sky, look.fog[0], look.fog[1]) : null;
  hemi.color.set(look.hemiSky ?? 0xffffff);
  hemi.groundColor.set(look.hemiGround ?? 0x6b7f8f);
  hemi.intensity = look.hemi ?? 1.7;
  sun.intensity = look.sun ?? 2;
  sun.position.set(...(look.sunAt ?? [8, 20, 6]));
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', `#${look.sky.toString(16).padStart(6, '0')}`);
  document.body.dataset.level = def.id; // the HUD's ink (light on the dark canyon)

  // The ground: the landform, with its scenery (water, bridges, ice) as children so they move with it.
  const ground = terrainMesh(def);
  ground.name = 'ground';
  ground.userData.lvl = true;
  scene.add(ground);
  for (const [name, kind, x, z] of def.things) {
    const o = make(kind, look);
    o.name = name;
    o.position.x = x;
    o.position.z = z;
    o.position.y += def.height(x, z); // stood on the landform (make() gives the height above it)
    o.userData.lvl = true;
    scene.add(o);
  }
  // This level's saved layout (and only this level's: the file has one entry per level).
  await applyPlacement(scene, './placement.json', { level: id });
  const mine = scene.children.filter((c) => c.userData.lvl);
  level = { id, def, ground, gems: mine.filter((o) => o.name.startsWith('gem')), flag: mine.find((o) => o.name === 'flag'), got: 0 };
  camOffset.fromArray(look.cam?.offset ?? [0, 13, 15]);
  aimAhead.fromArray(look.cam?.aim ?? [0, 0, -6]);
  placePlayer();
  camera.position.copy(player.position).add(camOffset);
  $('level').textContent = def.label;
  $('gems').textContent = '0';
  $('total').textContent = String(level.gems.length);
}

// The camera: behind the ball, looking a little ahead of it, so the level's landform (the stream, the canyon's
// walls, the mountain and its path) fills the view from the start. Default 13 up / 15 back, aim 6 ahead; a level
// may set its own (`look.cam`): Canyon looks down steeply (from behind, the walls hid the floor), Summit sits lower
// and aims up (or its peak falls out of the top of the picture).
const camOffset = new THREE.Vector3(0, 13, 15);
const aimAhead = new THREE.Vector3(0, 0, -6);

// In the editor: the level it shows (an editor-made level is built from the one it was copied from). Shipped: null.
const pick = window.studio?.levels?.(LEVELS.map((l) => ({ id: l.id, label: l.label })));
await startLevel(pick?.id ?? LEVELS[0].id, pick?.build);

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 70 : 55;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ input: keys + floating joystick
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
const stick = { active: false, ox: 0, oy: 0, x: 0, y: 0 };
renderer.domElement.addEventListener('pointerdown', (e) => {
  Object.assign(stick, { active: true, ox: e.clientX, oy: e.clientY, x: 0, y: 0 });
  Object.assign($('stick').style, { left: `${e.clientX}px`, top: `${e.clientY}px` });
  $('stick').hidden = false;
});
addEventListener('pointermove', (e) => {
  if (!stick.active) return;
  const dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
  const len = Math.hypot(dx, dy), k = len > 45 ? 45 / len : 1;
  stick.x = (dx * k) / 45;
  stick.y = (dy * k) / 45;
  $('knob').style.transform = `translate(${dx * k}px, ${dy * k}px)`;
});
addEventListener('pointerup', () => {
  stick.active = false;
  stick.x = stick.y = 0;
  $('stick').hidden = true;
  $('knob').style.transform = '';
});

// ------------------------------------------------------------------ loop
// The ball on the landform. PUSH = how hard the input pushes (units/s²). GRAVITY pulls along the slope
// (GRAVITY · sinθ): 70 means a slope steeper than ~0.62 (32°) out-pulls the push — the mountain's face and the
// canyon's walls cannot be climbed, the paths (≤ 0.25) can. A level may set its own (`gravity`; Meadow: 45, every
// slope climbable). STEP = the most the floor may rise in one frame's move before it counts as a wall (the ball
// bounces back off it). Checked with a simulated run of each level (start → 3 gems → flag; no shortcut up Summit's
// face or through Canyon's walls), 2026-10-22.
const PUSH = 38, GRAVITY = 70, STEP = 0.45, DRAG = 2.2;
const clock = new THREE.Clock();
let switching = false;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  let ix = stick.x, iz = stick.y;
  if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
  if (keys.has('d') || keys.has('arrowright')) ix += 1;
  if (keys.has('w') || keys.has('arrowup')) iz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) iz += 1;
  const len = Math.hypot(ix, iz);
  if (len > 1) (ix /= len), (iz /= len);
  const p = player.position;
  const ground = floorAt(p.x, p.z);
  const onGround = p.y - 0.8 <= ground + 0.05;
  if (onGround) {
    vel.x += ix * PUSH * dt;
    vel.z += iz * PUSH * dt;
    // Downhill pull: the floor's slope, from a small central difference.
    const e = 0.2;
    const gx = (floorAt(p.x + e, p.z) - floorAt(p.x - e, p.z)) / (2 * e);
    const gz = (floorAt(p.x, p.z + e) - floorAt(p.x, p.z - e)) / (2 * e);
    const k = (level.def.gravity ?? GRAVITY) / Math.sqrt(1 + gx * gx + gz * gz);
    vel.x -= gx * k * dt;
    vel.z -= gz * k * dt;
  }
  // Ice slides (little drag), water drags; elsewhere the ball's own roll.
  const surface = level.def.surface?.(p.x - level.ground.position.x, p.z - level.ground.position.z);
  vel.multiplyScalar(Math.exp(-(surface === 'ice' ? 0.35 : surface === 'water' ? 4 : DRAG) * dt));
  // Move one axis at a time, so a wall stops only the part of the move that runs into it.
  for (const axis of ['x', 'z']) {
    const was = p[axis];
    p[axis] += vel[axis] * dt;
    if (Math.abs(p[axis]) > HALF - 0.8) {
      p[axis] = Math.sign(p[axis]) * (HALF - 0.8);
      vel[axis] *= -0.5;
    }
    if (floorAt(p.x, p.z) - (p.y - 0.8) > STEP) {
      p[axis] = was;
      vel[axis] *= -0.3;
    }
  }
  // Height: stuck to the floor, or falling to it (off a ledge, into the chasm).
  const floor = floorAt(p.x, p.z);
  if (p.y - 0.8 > floor + 0.05) {
    fall -= 30 * dt;
    p.y = Math.max(floor + 0.8, p.y + fall * dt);
  } else {
    fall = 0;
    p.y = floor + 0.8;
  }
  if (p.y < -5) placePlayer(); // into the chasm: back to the start
  player.rotation.x += (vel.z / 0.8) * dt;
  player.rotation.z -= (vel.x / 0.8) * dt;

  for (const g of level.gems) {
    g.rotation.y += dt * 2;
    if (g.visible && g.position.distanceTo(p) < 1.3) {
      g.visible = false;
      $('gems').textContent = String(++level.got);
    }
  }
  // All gems, then the flag: the next level (in the code's order), built in place.
  if (!switching && level.flag && level.got >= level.gems.length && level.flag.position.distanceTo(p) < 1.8) {
    switching = true;
    const next = LEVELS[(LEVELS.findIndex((l) => l.id === level.def.id) + 1) % LEVELS.length];
    void startLevel(next.id).then(() => (switching = false));
  }
  camera.position.lerp(p.clone().add(camOffset), 1 - Math.exp(-dt * 6));
  camera.lookAt(p.clone().add(aimAhead));
  renderer.render(scene, camera);
});
