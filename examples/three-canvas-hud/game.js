/**
 * Neon Run — a three.js runner whose HUD is drawn in a 2D canvas over the world: a score, a health bar, a round
 * JUMP button and a minimap. No HTML UI at all. Steer with ← → (A D), jump with Space or the JUMP button.
 *
 * Sample for KUMODeck Game Studio (studio-canvas-ui, 2026-10-24: "I want to edit the UI drawn INSIDE the canvas, not
 * only the HTML UI, as UI"). Kept in the shape an AI usually writes first: the HUD is plain canvas code with its numbers
 * in the drawing (fillText at 26, 40…), so the editor cannot know where the score is. Asked "make this UI editable",
 * the AI rewrites drawHud() with codeUi() from studio-placement.js (SKILL.md "UI drawn in the canvas") — the picture
 * stays the same to the pixel — and the editor's UI layer then selects, moves and recolours each part like HTML UI.
 *
 * The world is seeded (the same hexagons every load), shows a run in the middle (score 12,480, 7 of 10 health) and
 * goes on only after the first key or tap: the editor holds the game after its first frame (and lets it run a moment
 * to see what moves), so the HUD shows real numbers, and a picture before / after the AI's rewrite is the same picture.
 */

import * as THREE from 'three';
import { applyPlacement } from './studio-placement.js';

// ---------------------------------------------------------------- the world
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120a24);
scene.fog = new THREE.Fog(0x120a24, 24, 70);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
camera.position.set(0, 4.2, 9);
camera.lookAt(0, 1, -12);

scene.add(new THREE.HemisphereLight(0x9f7bff, 0x1a0f2e, 1.2));
const sun = new THREE.DirectionalLight(0xffd6f5, 1.1);
sun.position.set(4, 10, 6);
scene.add(sun);

// A seeded random: the same city and hexagons every load.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

const road = new THREE.Mesh(new THREE.PlaneGeometry(8, 400), new THREE.MeshStandardMaterial({ color: 0x24113f, roughness: 0.9 }));
road.name = 'road';
road.rotation.x = -Math.PI / 2;
road.position.z = -150;
scene.add(road);
for (const x of [-4, 4]) {
  const edge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 400), new THREE.MeshBasicMaterial({ color: 0xff3fb4 }));
  edge.position.set(x, 0.03, -150);
  scene.add(edge);
}
const middle = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 400), new THREE.MeshBasicMaterial({ color: 0x5b3a8a }));
middle.position.set(0, 0.02, -150);
scene.add(middle);

const city = new THREE.Group();
city.userData.studioKey = 'city';
for (let i = 0; i < 26; i++) {
  const h = 3 + rand() * 9;
  const b = new THREE.Mesh(new THREE.BoxGeometry(2 + rand() * 2, h, 2 + rand() * 2), new THREE.MeshStandardMaterial({ color: 0x1c1033, emissive: 0x150a2a }));
  const side = i % 2 ? 1 : -1;
  b.position.set(side * (9 + rand() * 8), h / 2, -10 - i * 5);
  city.add(b);
}
scene.add(city);

const player = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1.6, 3), new THREE.MeshStandardMaterial({ color: 0x2fb8c0, emissive: 0x0b4a50, flatShading: true }));
player.userData.studioKey = 'player';
player.rotation.x = -Math.PI / 2;
player.position.set(0, 0.5, 3);
scene.add(player);

const hexes = [];
for (let i = 0; i < 6; i++) {
  const hx = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 6), new THREE.MeshStandardMaterial({ color: 0xff8a1f, emissive: 0x6a2a00, flatShading: true }));
  hx.userData.studioKey = `hex-${i + 1}`;
  hx.rotation.x = Math.PI / 2;
  hx.position.set((rand() - 0.5) * 6, 0.8, -8 - i * 9);
  scene.add(hx);
  hexes.push(hx);
}

await applyPlacement(scene, './placement.json');

// ---------------------------------------------------------------- the run
let score = 12480;
let hp = 7; // of 10
let vy = 0;
let steer = 0;
let pressed = 0; // seconds the JUMP button still shows pressed
let hover = false;
let running = false; // the run goes on from the first key or tap
const speed = 14;

const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  running = true;
  if (e.code === 'Space') jump();
});
addEventListener('keyup', (e) => keys.delete(e.code));
function jump() {
  if (player.position.y > 0.55) return;
  vy = 7.5;
  pressed = 0.15;
}

function update(dt) {
  if (!running) return;
  steer = (keys.has('ArrowLeft') || keys.has('KeyA') ? -1 : 0) + (keys.has('ArrowRight') || keys.has('KeyD') ? 1 : 0);
  player.position.x = Math.max(-3.3, Math.min(3.3, player.position.x + steer * 7 * dt));
  vy -= 20 * dt;
  player.position.y = Math.max(0.5, player.position.y + vy * dt);
  if (player.position.y === 0.5) vy = 0;
  for (const hx of hexes) {
    hx.position.z += speed * dt;
    hx.rotation.y += dt * 2;
    if (hx.position.z > 8) hx.position.set((rand() - 0.5) * 6, 0.8, -46);
    const hit = Math.abs(hx.position.z - player.position.z) < 0.8 && Math.abs(hx.position.x - player.position.x) < 1 && player.position.y < 1.2;
    if (hit) {
      hp -= 1;
      hx.position.z = -46;
      if (hp <= 0) (hp = 10), (score = 0);
    }
  }
  score += speed * dt * 10;
  pressed = Math.max(0, pressed - dt);
}

// ---------------------------------------------------------------- the HUD (a 2D canvas over the world)
const hud = document.getElementById('hud');
const ctx = hud.getContext('2d');
let dpr = 1;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dpr = Math.min(devicePixelRatio || 1, 2);
  hud.width = Math.round(w * dpr);
  hud.height = Math.round(h * dpr);
}
addEventListener('resize', resize);
resize();

const roundRect = (x, y, w, h, r) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

function drawHud() {
  const w = hud.clientWidth, h = hud.clientHeight;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  // Score — top left
  ctx.fillStyle = 'rgba(10, 6, 24, 0.55)';
  roundRect(16, 12, 232, 40, 8);
  ctx.fill();
  ctx.font = 'bold 24px "Courier New", monospace';
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`SCORE ${Math.floor(score).toLocaleString('en-US')}`, 26, 40);

  // Health bar — under the score: a heart and 10 cells
  ctx.fillStyle = '#ff3b6b';
  ctx.font = '18px sans-serif';
  ctx.fillText('♥', 18, 77);
  for (let i = 0; i < 10; i++) {
    ctx.fillStyle = i < hp ? '#ff3b6b' : '#3a2346';
    ctx.fillRect(40 + i * 19, 64, 16, 14);
  }

  // JUMP button — bottom right, round
  const cx = w - 24 - 36, cy = h - 24 - 36;
  ctx.beginPath();
  ctx.arc(cx, cy, 36, 0, Math.PI * 2);
  ctx.fillStyle = pressed > 0 ? '#2fb8d0' : hover ? '#8af3ff' : '#56e3f5';
  ctx.fill();
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = '#0b0b1a';
  ctx.textAlign = 'center';
  ctx.fillText('JUMP', cx, cy + 6);
  ctx.textAlign = 'left';

  // Minimap — bottom left: the road from above, the hexagons and the player
  const mx = 16, my = h - 16 - 120;
  ctx.fillStyle = 'rgba(10, 6, 24, 0.7)';
  roundRect(mx, my, 100, 120, 6);
  ctx.fill();
  ctx.strokeStyle = '#4b2f7a';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#b48cff';
  ctx.font = 'bold 9px "Courier New", monospace';
  ctx.fillText('MAP', mx + 6, my + 12);
  ctx.strokeStyle = '#ff3fb4';
  ctx.beginPath();
  ctx.moveTo(mx + 46, my + 18);
  ctx.lineTo(mx + 54, my + 18);
  ctx.lineTo(mx + 84, my + 112);
  ctx.lineTo(mx + 16, my + 112);
  ctx.closePath();
  ctx.stroke();
  for (const hx of hexes) {
    const t = Math.max(0, Math.min(1, (hx.position.z + 46) / 54));
    ctx.fillStyle = '#ff8a1f';
    ctx.beginPath();
    ctx.arc(mx + 50 + hx.position.x * (2 + t * 6), my + 18 + t * 94, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#2fb8c0';
  const px = mx + 50 + player.position.x * 8;
  ctx.beginPath();
  ctx.moveTo(px, my + 98);
  ctx.lineTo(px + 5, my + 108);
  ctx.lineTo(px - 5, my + 108);
  ctx.closePath();
  ctx.fill();
}

// The JUMP button is pressed where it is drawn.
const onJump = (e) => {
  const cx = hud.clientWidth - 24 - 36, cy = hud.clientHeight - 24 - 36;
  return Math.hypot(e.offsetX - cx, e.offsetY - cy) <= 36;
};
hud.addEventListener('pointerdown', (e) => {
  running = true;
  if (onJump(e)) jump();
});
hud.addEventListener('pointermove', (e) => {
  hover = onJump(e);
  hud.style.cursor = hover ? 'pointer' : '';
});

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
