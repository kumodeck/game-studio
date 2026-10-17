/**
 * Tumble — knock the blocks off the table by throwing balls.
 *
 * Sample for KUMODeck Game Studio, written to exercise physics: every block is a physics body, and each frame the
 * mesh is moved to where its body is. That is the case where placement must be applied BEFORE the bodies are built
 * (bodies copy the mesh position once at creation, then overwrite the mesh every frame). The order below is:
 *   build meshes → applyPlacement → build bodies → studio.ready()
 * The physics is a few lines of our own (axis-aligned boxes + spheres) so the sample needs no extra library; the
 * same order applies to cannon-es, Rapier or Ammo.
 *
 * Blocks are named "block-1" … "block-8", the table "table". Balls are created at play time and are not placeable.
 */

import * as THREE from 'three';
import { applyPlacement } from './studio-placement.js';

window.studio?.waitForReady?.();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3e2c7);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
camera.position.set(0, 7, 14);
camera.lookAt(0, 2, 0);

scene.add(new THREE.HemisphereLight(0xffffff, 0xb08a60, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(5, 12, 7);
sun.castShadow = true;
scene.add(sun);

const floor = new THREE.Mesh(new THREE.BoxGeometry(30, 0.2, 30), new THREE.MeshStandardMaterial({ color: 0xd9c39e }));
floor.name = 'floor';
floor.position.y = -0.1;
floor.receiveShadow = true;
scene.add(floor);

const table = new THREE.Mesh(new THREE.BoxGeometry(6, 1, 3), new THREE.MeshStandardMaterial({ color: 0x8a5a3c }));
table.name = 'table';
table.position.set(0, 0.5, 0);
table.castShadow = table.receiveShadow = true;
scene.add(table);

const COLORS = [0xff6b6b, 0xffb347, 0xffe066, 0x7bd389, 0x5bc0eb, 0x9b6bff, 0xff8fc7, 0xffffff];
const blocks = [];
for (let i = 0; i < 8; i++) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: COLORS[i] }));
  b.name = `block-${i + 1}`;
  // two towers of four
  b.position.set(i < 4 ? -1.2 : 1.2, 1.4 + (i % 4) * 0.8, 0);
  b.castShadow = true;
  scene.add(b);
  blocks.push(b);
}

// 1. saved positions → meshes, 2. bodies from meshes. Swapping these two lines would make the editor's changes vanish.
await applyPlacement(scene, './placement.json');

const G = -18;
const statics = [floor, table].map((m) => {
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  return { min: box.min.clone(), max: box.max.clone() };
});
const bodies = blocks.map((mesh) => ({ mesh, pos: mesh.position.clone(), vel: new THREE.Vector3(), half: 0.4 * mesh.scale.x, down: false }));
const balls = [];
// The camera is passed because the game has not rendered yet (the loop starts below).
window.studio?.ready?.({ camera });

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 1 ? 72 : 50;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ throw
const ballGeo = new THREE.SphereGeometry(0.35, 16, 12);
const ballMat = new THREE.MeshStandardMaterial({ color: 0x333344, roughness: 0.3 });
renderer.domElement.addEventListener('pointerdown', (e) => {
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);
  const mesh = new THREE.Mesh(ballGeo, ballMat);
  mesh.userData.studio = false; // spawned at play time: not something to place
  mesh.position.copy(camera.position);
  mesh.castShadow = true;
  scene.add(mesh);
  balls.push({ mesh, pos: mesh.position.clone(), vel: ray.ray.direction.clone().multiplyScalar(22), half: 0.35, t: 0 });
});

// ------------------------------------------------------------------ physics (boxes do not rotate; good enough here)
function collideStatic(b) {
  for (const s of statics) {
    const inX = b.pos.x + b.half > s.min.x && b.pos.x - b.half < s.max.x;
    const inZ = b.pos.z + b.half > s.min.z && b.pos.z - b.half < s.max.z;
    if (inX && inZ && b.pos.y - b.half < s.max.y && b.pos.y > s.max.y - 0.3) {
      b.pos.y = s.max.y + b.half;
      if (b.vel.y < 0) b.vel.y = 0;
      b.vel.x *= 0.9;
      b.vel.z *= 0.9;
    }
  }
}
function collidePair(a, b, push) {
  const d = b.pos.clone().sub(a.pos);
  const min = a.half + b.half;
  const ox = min - Math.abs(d.x);
  const oy = min - Math.abs(d.y);
  const oz = min - Math.abs(d.z);
  if (ox <= 0 || oy <= 0 || oz <= 0) return;
  // separate along the axis of least overlap
  const axis = ox < oy && ox < oz ? 'x' : oy < oz ? 'y' : 'z';
  const s = Math.sign(d[axis]) || 1;
  const o = axis === 'x' ? ox : axis === 'y' ? oy : oz;
  if (push) {
    b.pos[axis] += s * o;
    b.vel[axis] = s * Math.max(Math.abs(b.vel[axis]), Math.abs(a.vel[axis]) * 0.6);
  } else {
    a.pos[axis] -= (s * o) / 2;
    b.pos[axis] += (s * o) / 2;
    const avg = (a.vel[axis] + b.vel[axis]) / 2;
    a.vel[axis] = b.vel[axis] = avg;
  }
}
function step(dt) {
  for (const b of [...bodies, ...balls]) {
    b.vel.y += G * dt;
    b.pos.addScaledVector(b.vel, dt);
    collideStatic(b);
  }
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) collidePair(bodies[i], bodies[j], false);
  for (const ball of balls) for (const b of bodies) collidePair(ball, b, true);
  let down = 0;
  for (const b of bodies) {
    if (b.pos.y < 0.9) b.down = true;
    if (b.down) down++;
    b.mesh.position.copy(b.pos);
  }
  document.getElementById('down').textContent = down;
  for (let i = balls.length - 1; i >= 0; i--) {
    const ball = balls[i];
    ball.t += dt;
    ball.mesh.position.copy(ball.pos);
    if (ball.t > 4) scene.remove(ball.mesh), balls.splice(i, 1);
  }
}

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  for (let k = 0; k < 4; k++) step(dt / 4);
  renderer.render(scene, camera);
});
