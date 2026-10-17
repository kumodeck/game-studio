/**
 * Sky Duel 3D — two planes race through rings over the sea. You turn left / right; the rival is a simple bot.
 *
 * Sample for KUMODeck Game Studio, written to exercise:
 *   - three.js r170 (the other samples use r186)
 *   - named objects and groups: "plane-you", "plane-rival" (groups of several meshes), "ring" ×5 (same name → ring,
 *     ring#2, …), "cloud" groups, "island"
 *   - a follow camera placed in scene.onBeforeRender — the editor must keep its own view even though this hook moves
 *     whatever camera it is handed
 * Rings, clouds and the island are where the editor is useful: move a ring and the race course changes.
 */

import * as THREE from 'three';
import { applyPlacement } from './studio-placement.js';

const $ = (id) => document.getElementById(id);
const WIN = 5;
const SPEED = 9;
const TURN = 1.6;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x6fb6ff);
scene.fog = new THREE.Fog(0x9fd0ff, 60, 160);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

scene.add(new THREE.HemisphereLight(0xffffff, 0x2a6aa0, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(-20, 40, 10);
scene.add(sun);

const sea = new THREE.Mesh(new THREE.CircleGeometry(150, 48), new THREE.MeshStandardMaterial({ color: 0x2f7fc4, roughness: 0.3 }));
sea.name = 'sea';
sea.rotation.x = -Math.PI / 2;
scene.add(sea);

const island = new THREE.Mesh(new THREE.CylinderGeometry(6, 9, 3, 10), new THREE.MeshStandardMaterial({ color: 0xe9d58f, flatShading: true }));
island.name = 'island';
island.position.set(0, 0.5, 0);
scene.add(island);

function makePlane(name, wing) {
  const g = new THREE.Group();
  g.name = name;
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf4f6ff, roughness: 0.4 });
  const wingMat = new THREE.MeshStandardMaterial({ color: wing, roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 2, 4, 8), bodyMat);
  body.rotation.x = Math.PI / 2;
  const wings = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.08, 0.7), wingMat);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.4), wingMat);
  tail.position.z = 1.1;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.4), wingMat);
  fin.position.set(0, 0.3, 1.1);
  g.add(body, wings, tail, fin);
  scene.add(g);
  return g;
}
const you = makePlane('plane-you', 0x5b8cff);
const rival = makePlane('plane-rival', 0xff4d6d);
you.position.set(-4, 8, 30);
rival.position.set(4, 8, 30);
you.rotation.y = rival.rotation.y = 0; // facing -z

const ringMat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffa000, emissiveIntensity: 0.4 });
const ringGeo = new THREE.TorusGeometry(2.4, 0.25, 8, 24);
const rings = [];
const COURSE = [[0, 8, 0], [22, 9, -20], [0, 10, -40], [-24, 8, -18], [-10, 9, 18]];
for (const [x, y, z] of COURSE) {
  const r = new THREE.Mesh(ringGeo, ringMat);
  r.name = 'ring';
  r.position.set(x, y, z);
  scene.add(r);
  rings.push(r);
}
// face each ring along the course
rings.forEach((r, i) => {
  const n = rings[(i + 1) % rings.length].position;
  r.rotation.y = Math.atan2(n.x - r.position.x, n.z - r.position.z);
});

const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.9 });
for (let i = 0; i < 6; i++) {
  const c = new THREE.Group();
  c.name = 'cloud';
  for (let k = 0; k < 3; k++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(2.2 - k * 0.4, 12, 8), cloudMat);
    puff.position.set(k * 2.2 - 2, k === 1 ? 0.6 : 0, 0);
    c.add(puff);
  }
  const a = (i / 6) * Math.PI * 2 + 0.4;
  c.position.set(Math.cos(a) * 45, 18 + (i % 3) * 3, Math.sin(a) * 45 - 10);
  scene.add(c);
}

// Saved positions from the editor, applied once after the world is built.
await applyPlacement(scene, './placement.json');

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 75 : 60;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// Follow camera, written as a scene hook (some engines and tutorials do this). It moves the camera it is handed.
const camOffset = new THREE.Vector3(0, 4, 10);
scene.onBeforeRender = (_r, _s, cam) => {
  const behind = camOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), you.rotation.y);
  cam.position.copy(you.position).add(behind);
  cam.lookAt(you.position);
  cam.updateMatrixWorld();
};

// ------------------------------------------------------------------ input
const keys = new Set();
addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let touchTurn = 0;
renderer.domElement.addEventListener('pointerdown', (e) => (touchTurn = e.clientX < innerWidth / 2 ? 1 : -1));
addEventListener('pointerup', () => (touchTurn = 0));

// ------------------------------------------------------------------ race
const score = { you: 0, rival: 0 };
const next = new Map([[you, 0], [rival, 0]]);
let racing = false;
$('start').onclick = () => {
  score.you = score.rival = 0;
  $('me').textContent = $('them').textContent = '0';
  $('panel').hidden = true;
  racing = true;
};

function fly(plane, turn, dt) {
  plane.rotation.y += turn * TURN * dt;
  plane.rotation.z = THREE.MathUtils.lerp(plane.rotation.z, turn * 0.5, 1 - Math.exp(-dt * 5));
  plane.position.x -= Math.sin(plane.rotation.y) * SPEED * dt;
  plane.position.z -= Math.cos(plane.rotation.y) * SPEED * dt;
  const target = rings[next.get(plane)];
  plane.position.y = THREE.MathUtils.lerp(plane.position.y, target.position.y, 1 - Math.exp(-dt));
  if (plane.position.distanceTo(target.position) < 2.6) {
    next.set(plane, (next.get(plane) + 1) % rings.length);
    if (plane === you) $('me').textContent = ++score.you;
    else $('them').textContent = ++score.rival;
    if (score.you >= WIN || score.rival >= WIN) {
      racing = false;
      $('panel').hidden = false;
      $('panel').querySelector('h1').textContent = score.you >= WIN ? 'You win!' : 'Rival wins';
      $('start').textContent = 'Fly again';
    }
  }
}

function botTurn(plane) {
  const t = rings[next.get(plane)].position;
  const want = Math.atan2(-(t.x - plane.position.x), -(t.z - plane.position.z));
  let d = want - plane.rotation.y;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.max(-1, Math.min(1, d * 2)) * 0.8;
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (racing) {
    let turn = touchTurn;
    if (keys.has('a') || keys.has('arrowleft')) turn = 1;
    if (keys.has('d') || keys.has('arrowright')) turn = -1;
    fly(you, turn, dt);
    fly(rival, botTurn(rival), dt);
  }
  for (const r of rings) r.rotation.z += dt * 0.6;
  renderer.render(scene, camera);
});
