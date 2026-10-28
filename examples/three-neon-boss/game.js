/**
 * Neon Run — a boss comes in. A three.js runner on a neon road: the ship weaves along it by itself, hexagons come at it,
 * and a few seconds in the game MAKES a boss in the middle lane, two drones beside it, and shots the boss fires.
 *
 * Sample for KUMODeck Game Studio's paused moment (pause-edit, 2026-10-28; CONTRACT.md §3.5.1): play, slow
 * it to ¼×, pause when the boss comes, and the moment is the editor. The three kinds of things in it:
 *   - placed: the road, the gate, the ring, the orb, the pillars — moved in a paused moment, they go in the scene as in
 *     Edit (Save · N);
 *   - moved by the game: the ship and the hexagons — "just for this moment";
 *   - made by the game: the boss, the drones, the shots (not there when Play starts) — "just for this moment", and
 *     "✦ Have Claude make it appear here" asks the AI to change where the game makes them.
 * The boss is made in plain code (spawnBoss below: a position written in the code), as an AI usually writes it first —
 * so "make it appear here" is a change of that code.
 *
 * Everything moves by the time between frames (dt) and is seeded, so a run is the same run every load.
 */

import * as THREE from 'three';
import { applyPlacement } from './studio-placement.js';

// ---------------------------------------------------------------- the world
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120a24);
scene.fog = new THREE.Fog(0x120a24, 26, 80);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
camera.position.set(0, 4.2, 9);
camera.lookAt(0, 1, -12);

scene.add(new THREE.HemisphereLight(0x9f7bff, 0x1a0f2e, 1.2));
const sun = new THREE.DirectionalLight(0xffd6f5, 1.1);
sun.position.set(4, 10, 6);
scene.add(sun);

let seed = 11;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const road = new THREE.Mesh(new THREE.PlaneGeometry(8, 400), new THREE.MeshStandardMaterial({ color: 0x24113f, roughness: 0.9 }));
road.name = 'road';
road.rotation.x = -Math.PI / 2;
road.position.z = -150;
scene.add(road);
for (const x of [-4, 4]) {
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 400), new THREE.MeshBasicMaterial({ color: 0xff3fb4 }));
  edge.name = 'edge';
  edge.position.set(x, 0.03, -150);
  scene.add(edge);
}

// The gate over the road: two posts and a bar (placed).
const neon = (c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8 });
const gate = new THREE.Group();
gate.name = 'gate';
for (const x of [-2.6, 2.6]) {
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.22), neon(0x3fe9ff));
  post.position.set(x, 1.6, 0);
  gate.add(post);
}
const bar = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.22, 0.22), neon(0x3fe9ff));
bar.position.y = 3.2;
gate.add(bar);
gate.position.set(0, 0, -12);
scene.add(gate);

const ring = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.09, 12, 32), neon(0x3fe9ff));
ring.name = 'ring';
ring.position.set(2.2, 1.1, -6);
scene.add(ring);
const orb = new THREE.Mesh(new THREE.SphereGeometry(0.35, 20, 14), neon(0xffd23f));
orb.name = 'orb';
orb.position.set(-2.2, 0.6, -5);
scene.add(orb);
for (let i = 0; i < 4; i++) {
  const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 2.4, 0.5), new THREE.MeshStandardMaterial({ color: 0x2a1650, emissive: 0x1a0b33 }));
  p.name = 'pillar';
  p.position.set(i % 2 ? 5.2 : -5.2, 1.2, -4 - Math.floor(i / 2) * 14);
  scene.add(p);
}

// The ship: the game weaves it along the road by itself.
const ship = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 3), new THREE.MeshStandardMaterial({ color: 0x2fb8c0, emissive: 0x0b4a50, flatShading: true }));
ship.name = 'ship';
ship.rotation.x = -Math.PI / 2;
ship.position.set(0, 0.5, 3);
scene.add(ship);

// Hexagons the game sends down the road.
const hexes = [];
for (let i = 0; i < 4; i++) {
  const hx = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.45, 6), new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0x6a2a00, flatShading: true }));
  hx.name = 'hex';
  hx.rotation.x = Math.PI / 2;
  hx.position.set((rand() - 0.5) * 6, 0.8, -8 - i * 11);
  scene.add(hx);
  hexes.push(hx);
}

await applyPlacement(scene, './placement.json');

// ---------------------------------------------------------------- what the game makes on the way
let boss = null;
const drones = [];
const shots = [];

/** The boss comes in here: the middle lane, far down the road. */
function spawnBoss() {
  boss = new THREE.Group();
  boss.name = 'boss';
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), new THREE.MeshStandardMaterial({ color: 0xff3fb4, emissive: 0x7a0f55, flatShading: true }));
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  eye.position.z = 0.75;
  boss.add(body, eye);
  boss.position.set(0, 2.6, -26);
  scene.add(boss);
  document.getElementById('boss').hidden = false;
}

/** Two drones beside the boss. */
function spawnDrones() {
  for (const side of [-1, 1]) {
    const d = new THREE.Mesh(new THREE.TetrahedronGeometry(0.4), new THREE.MeshStandardMaterial({ color: 0xff3fb4, emissive: 0x55103d, flatShading: true }));
    d.name = 'drone';
    d.position.set(boss.position.x + side * 2.2, boss.position.y + 0.8, boss.position.z + 1);
    scene.add(d);
    drones.push(d);
  }
}

/** The boss fires a shot down the road. */
function fire() {
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff8fd8 }));
  s.name = 'shot';
  s.position.copy(boss.position);
  s.position.y -= 0.6;
  scene.add(s);
  shots.push(s);
}

// ---------------------------------------------------------------- the run
let score = 12480;
let left = 30; // seconds
let t = 0; // the run's own time
let fireIn = 0;
const speed = 12;

function update(dt) {
  t += dt;
  left = Math.max(0, left - dt);
  score += speed * dt * 10;
  ship.position.x = Math.sin(t * 0.9) * 2.4;
  for (const hx of hexes) {
    hx.position.z += speed * dt;
    hx.rotation.y += dt * 2;
    if (hx.position.z > 8) hx.position.set((rand() - 0.5) * 6, 0.8, -44);
  }
  if (!boss && t > 4) spawnBoss();
  if (boss && !drones.length && t > 5) spawnDrones();
  if (boss) {
    // The boss comes closer until it hovers over the gate, and turns its eye to the ship.
    if (boss.position.z < -16) boss.position.z += 2.5 * dt;
    boss.rotation.y = Math.sin(t) * 0.3;
    for (const [i, d] of drones.entries()) d.position.y = boss.position.y + 0.8 + Math.sin(t * 3 + i) * 0.2;
    fireIn -= dt;
    if (drones.length && fireIn <= 0 && shots.length < 3) {
      fire();
      fireIn = 0.8;
    }
  }
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.position.z += 9 * dt;
    if (s.position.z > 6) {
      scene.remove(s);
      shots.splice(i, 1);
    }
  }
}

// ---------------------------------------------------------------- the HUD (HTML over the canvas)
const scoreEl = document.querySelector('#hud .score');
const timeEl = document.querySelector('#hud .time');
function drawHud() {
  scoreEl.textContent = `SCORE ${Math.floor(score).toLocaleString('en-US')}`;
  const s = Math.ceil(left);
  timeEl.textContent = `TIME ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- the loop
let last = -1;
function frame(now) {
  const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  update(dt);
  renderer.render(scene, camera);
  drawHud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
