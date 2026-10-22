/**
 * Three Isles — a small three.js game with three levels: roll the ball, pick up the gems, reach the flag.
 *
 * Sample for KUMODeck Game Studio's levels (2026-10-22). The code has the levels (LEVELS below); the editor lists them,
 * switches between them, and can copy, rename, reorder or delete them (those wait in placement.json until the AI changes
 * this code). Two calls make that work:
 *   window.studio?.levels?.(LEVELS) — in the editor: { id, build } = the level it shows; in the shipped game: null
 *   applyPlacement(scene, './placement.json', { level }) — that level's saved layout only
 * Every object is named, with the same names in each level, so a copy of a level keeps its keys.
 *
 * Controls: WASD / arrow keys, or drag anywhere for a floating joystick (touch and mouse).
 */

import * as THREE from 'three';
import { applyPlacement } from './studio-placement.js';

const $ = (id) => document.getElementById(id);
const ISLAND = 14; // half-size of each island (world units)

// The code's levels, in play order. `look` = colours; `things` = named objects [name, kind, x, z].
const LEVELS = [
  { id: 'meadow', label: 'Meadow', look: { sky: 0xa9d8e8, ground: 0x8fcf8a, tree: 0x3f8f5a, rock: 0x9a958c }, things: [
    ['tree-1', 'tree', -8, -6], ['tree-2', 'tree', -10, 2], ['tree-3', 'tree', 9, -8], ['tree-4', 'tree', 10, 5],
    ['rock-1', 'rock', -3, -9], ['rock-2', 'rock', 5, 1],
    ['gem-1', 'gem', -6, -2], ['gem-2', 'gem', 2, -6], ['gem-3', 'gem', 6, 7], ['flag', 'flag', 0, -11]] },
  { id: 'cave', label: 'Cave', look: { sky: 0x2b3145, ground: 0x5a6070, tree: 0x7fd6e8, rock: 0x474c59 }, things: [
    ['crystal-1', 'crystal', -7, -7], ['crystal-2', 'crystal', 8, -4], ['crystal-3', 'crystal', -9, 6],
    ['rock-1', 'rock', -2, -4], ['rock-2', 'rock', 4, 4], ['rock-3', 'rock', 9, 9],
    ['gem-1', 'gem', -5, 3], ['gem-2', 'gem', 3, -9], ['gem-3', 'gem', 10, 1], ['flag', 'flag', -10, -11]] },
  { id: 'summit', label: 'Summit', look: { sky: 0xdfe9f2, ground: 0xf4f7fa, tree: 0x2f6b4f, rock: 0x8c96a3 }, things: [
    ['tree-1', 'tree', -9, -3], ['tree-2', 'tree', 7, -9], ['tree-3', 'tree', 9, 8],
    ['rock-1', 'rock', -4, -10], ['rock-2', 'rock', 2, 3],
    ['gem-1', 'gem', -8, 8], ['gem-2', 'gem', 0, -5], ['gem-3', 'gem', 8, 0], ['flag', 'flag', 11, -11]] },
];

// ------------------------------------------------------------------ scene
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7f8f, 1.7));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(8, 20, 6);
scene.add(sun);

const player = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16), new THREE.MeshStandardMaterial({ color: 0xff7a45, roughness: 0.35 }));
player.name = 'player';
scene.add(player);
const vel = new THREE.Vector3();

function make(kind, look) {
  const mat = (color, extra) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra });
  if (kind === 'tree') {
    const m = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.2, 6), mat(look.tree));
    m.position.y = 1.6;
    return m;
  }
  if (kind === 'crystal') {
    const m = new THREE.Mesh(new THREE.OctahedronGeometry(1.1), mat(look.tree, { emissive: look.tree, emissiveIntensity: 0.4 }));
    m.scale.y = 2;
    m.position.y = 2;
    return m;
  }
  if (kind === 'rock') {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1), mat(look.rock));
    m.position.y = 0.6;
    return m;
  }
  if (kind === 'gem') {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), mat(0xffd34d, { emissive: 0xffb000, emissiveIntensity: 0.8 }));
    m.position.y = 0.8;
    return m;
  }
  const flag = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2), mat(0xeeeeee));
  pole.position.y = 1.6;
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.05), mat(0xe8590c));
  cloth.position.set(0.6, 2.8, 0);
  flag.add(pole, cloth);
  return flag;
}

// ------------------------------------------------------------------ levels
let level = null; // { def, gems: Mesh[], flag, got }
async function startLevel(id, build = id) {
  for (const o of scene.children.filter((c) => c.userData.lvl)) scene.remove(o);
  const def = LEVELS.find((l) => l.id === build) || LEVELS[0];
  scene.background = new THREE.Color(def.look.sky);
  const ground = new THREE.Mesh(new THREE.BoxGeometry(ISLAND * 2, 1, ISLAND * 2), new THREE.MeshStandardMaterial({ color: def.look.ground, roughness: 0.9 }));
  ground.name = 'ground';
  ground.position.y = -0.5;
  ground.userData.lvl = true;
  scene.add(ground);
  for (const [name, kind, x, z] of def.things) {
    const o = make(kind, def.look);
    o.name = name;
    o.position.x = x;
    o.position.z = z;
    o.userData.lvl = true;
    scene.add(o);
  }
  // This level's saved layout (and only this level's: the file has one entry per level).
  await applyPlacement(scene, './placement.json', { level: id });
  const mine = scene.children.filter((c) => c.userData.lvl);
  level = { id, def, gems: mine.filter((o) => o.name.startsWith('gem')), flag: mine.find((o) => o.name === 'flag'), got: 0 };
  player.position.set(0, 0.8, 9);
  vel.set(0, 0, 0);
  $('level').textContent = def.label;
  $('gems').textContent = '0';
  $('total').textContent = String(level.gems.length);
}

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
const clock = new THREE.Clock();
const camOffset = new THREE.Vector3(0, 11, 12);
camera.position.copy(player.position).add(camOffset);
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
  vel.x += ix * 38 * dt;
  vel.z += iz * 38 * dt;
  vel.multiplyScalar(Math.exp(-2.2 * dt));
  player.position.addScaledVector(vel, dt);
  for (const axis of ['x', 'z']) {
    if (Math.abs(player.position[axis]) > ISLAND - 0.8) {
      player.position[axis] = Math.sign(player.position[axis]) * (ISLAND - 0.8);
      vel[axis] *= -0.5;
    }
  }
  player.rotation.x += (vel.z / 0.8) * dt;
  player.rotation.z -= (vel.x / 0.8) * dt;

  for (const g of level.gems) {
    g.rotation.y += dt * 2;
    if (g.visible && g.position.distanceTo(player.position) < 1.3) {
      g.visible = false;
      $('gems').textContent = String(++level.got);
    }
  }
  // All gems, then the flag: the next level (in the code's order), built in place.
  if (!switching && level.flag && level.got >= level.gems.length && level.flag.position.distanceTo(player.position) < 1.6) {
    switching = true;
    const next = LEVELS[(LEVELS.findIndex((l) => l.id === level.def.id) + 1) % LEVELS.length];
    void startLevel(next.id).then(() => (switching = false));
  }
  camera.position.lerp(player.position.clone().add(camOffset), 1 - Math.exp(-dt * 6));
  camera.lookAt(player.position);
  renderer.render(scene, camera);
});
