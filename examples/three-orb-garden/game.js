/**
 * Orb Garden — a small three.js game: roll a ball and collect orbs in 60 seconds.
 *
 * Sample for KUMODeck Game Studio. On purpose, NOTHING in this scene has a name: the ground, the 16 trees, the ball
 * and the 12 orbs are all anonymous meshes added straight to the scene, the way most quick three.js games are written.
 * The editor still lists them (keyed by their place in the scene tree, shown as "no name"), so this sample checks the
 * least friendly case. Placement is applied once at start by studio-placement.js (no physics here).
 *
 * Controls: WASD / arrow keys, or drag anywhere for a floating joystick (touch and mouse).
 */

import * as THREE from 'three';
import { applyPlacement } from './studio-placement.js';

const $ = (id) => document.getElementById(id);
const RUN_SECONDS = 60;
const ARENA = 18; // half-size of the square garden (world units)

// ------------------------------------------------------------------ scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3d0);
scene.fog = new THREE.Fog(0xbfe3d0, 30, 70);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);

scene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f71, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(8, 20, 6);
sun.castShadow = true;
sun.shadow.camera.left = sun.shadow.camera.bottom = -ARENA - 2;
sun.shadow.camera.right = sun.shadow.camera.top = ARENA + 2;
sun.shadow.mapSize.set(1024, 1024);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, 1, ARENA * 2), new THREE.MeshStandardMaterial({ color: 0x8fcf8a, roughness: 0.9 }));
ground.position.y = -0.5;
ground.receiveShadow = true;
scene.add(ground);
// A few low-poly trees around the edge so movement reads as movement
const treeMat = new THREE.MeshStandardMaterial({ color: 0x3f8f5a, flatShading: true });
const treeGeo = new THREE.ConeGeometry(1.2, 3.2, 6);
for (let i = 0; i < 16; i++) {
  const a = (i / 16) * Math.PI * 2;
  const t = new THREE.Mesh(treeGeo, treeMat);
  t.position.set(Math.cos(a) * (ARENA + 2.5), 1.6, Math.sin(a) * (ARENA + 2.5));
  t.castShadow = true;
  scene.add(t);
}

const playerMat = new THREE.MeshStandardMaterial({ color: 0xff7a45, roughness: 0.35 });
const player = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16), playerMat);
player.castShadow = true;
player.position.set(0, 0.8, 0);
scene.add(player);
const vel = new THREE.Vector3();

const orbGeo = new THREE.IcosahedronGeometry(0.4, 1);
const orbMat = new THREE.MeshStandardMaterial({ color: 0xfff3a0, emissive: 0xffc93c, emissiveIntensity: 1.2 });
const orbs = [];
// Deterministic first layout (a ring), so a saved placement lines up with what the editor showed.
// Collected orbs respawn at random spots.
function placeOrb(o) {
  o.position.set((Math.random() * 2 - 1) * (ARENA - 1.5), 0.7, (Math.random() * 2 - 1) * (ARENA - 1.5));
}
for (let i = 0; i < 12; i++) {
  const o = new THREE.Mesh(orbGeo, orbMat);
  const a = (i / 12) * Math.PI * 2;
  o.position.set(Math.cos(a) * 9, 0.7, Math.sin(a) * 9);
  scene.add(o);
  orbs.push(o);
}

// Positions saved with the editor (placement.json next to index.html). Nothing happens when there is no file.
await applyPlacement(scene, './placement.json');
const orbBaseY = new Map(orbs.map((o) => [o, o.position.y]));

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  // Portrait phones see less width, so pull the camera back to keep the same amount of garden in view
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
  const dx = e.clientX - stick.ox;
  const dy = e.clientY - stick.oy;
  const len = Math.hypot(dx, dy);
  const max = 45;
  const k = len > max ? max / len : 1;
  stick.x = (dx * k) / max;
  stick.y = (dy * k) / max;
  $('knob').style.transform = `translate(${dx * k}px, ${dy * k}px)`;
});
addEventListener('pointerup', () => {
  stick.active = false;
  stick.x = stick.y = 0;
  $('stick').hidden = true;
  $('knob').style.transform = '';
});

// ------------------------------------------------------------------ run flow
let run = null; // { t, orbs } while playing
let best = 0;
$('start').onclick = () => {
  run = { t: 0, orbs: 0 };
  $('panel').hidden = true;
  $('orbs').textContent = '0';
};

function endRun() {
  const got = run.orbs;
  run = null;
  best = Math.max(best, got);
  $('panel').hidden = false;
  $('panel').querySelector('h1').textContent = `${got} orbs`;
  $('panel').querySelector('p').textContent = got >= 20 ? 'Garden legend.' : 'Nice rolling! Try for 20.';
  $('best').textContent = `Your best: ${best} orbs`;
  $('best').hidden = false;
  $('start').textContent = 'Play again';
}

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
const camOffset = new THREE.Vector3(0, 11, 12);
camera.position.copy(player.position).add(camOffset);
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  // input → acceleration (camera looks north, so screen up = -z)
  let ix = stick.x;
  let iz = stick.y;
  if (keys.has('a') || keys.has('arrowleft')) ix -= 1;
  if (keys.has('d') || keys.has('arrowright')) ix += 1;
  if (keys.has('w') || keys.has('arrowup')) iz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) iz += 1;
  const len = Math.hypot(ix, iz);
  if (len > 1) (ix /= len), (iz /= len);
  vel.x += ix * 38 * dt;
  vel.z += iz * 38 * dt;
  vel.multiplyScalar(Math.exp(-2.2 * dt)); // rolling friction
  player.position.addScaledVector(vel, dt);
  // bounce off the garden edge
  for (const axis of ['x', 'z']) {
    if (Math.abs(player.position[axis]) > ARENA - 0.8) {
      player.position[axis] = Math.sign(player.position[axis]) * (ARENA - 0.8);
      vel[axis] *= -0.5;
    }
  }
  // roll the ball visually: rotation axis is perpendicular to velocity
  player.rotation.x += (vel.z / 0.8) * dt;
  player.rotation.z -= (vel.x / 0.8) * dt;

  const t = clock.elapsedTime;
  for (const o of orbs) {
    o.rotation.y += dt * 2;
    o.position.y = (orbBaseY.get(o) ?? 0.7) + Math.sin(t * 3 + o.position.x) * 0.15;
    if (run && o.position.distanceTo(player.position) < 1.25) {
      run.orbs += 1;
      $('orbs').textContent = run.orbs;
      placeOrb(o);
    }
  }
  if (run) {
    run.t += dt;
    $('time').textContent = Math.ceil(Math.max(0, RUN_SECONDS - run.t));
    if (run.t >= RUN_SECONDS) endRun();
  }

  camera.position.lerp(player.position.clone().add(camOffset), 1 - Math.exp(-dt * 6));
  camera.lookAt(player.position);
  renderer.render(scene, camera);
});
