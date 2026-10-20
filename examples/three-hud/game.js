/**
 * Glow Garden — a tiny three.js toy with an HTML UI over it: a title card, a Start button and a score.
 * Press Start, then tap the five lanterns to light them.
 *
 * Sample for KUMODeck Game Studio (UI stage 1, 2026-10-19), written to exercise:
 *   - the 3D world as usual (named objects: `userData.studioKey`)
 *   - the HTML UI marked with data-studio-key (index.html): the editor's "UI" layer moves and resizes it, and
 *     placement.json keeps it under `ui`
 *   - a title card centred with transform: translate(-50%, -50%) and a button centred with the translate property
 *     (both must stay centred when moved / resized), and a CSS animation (paused while editing)
 *   - applyPlacement(scene) applying both the world (`objects`) and the UI (`ui`)
 */

import * as THREE from 'three';
import { applyPlacement } from './studio-placement.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2340);
scene.fog = new THREE.Fog(0x1d2340, 18, 40);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 7, 13);
camera.lookAt(0, 0.5, 0);

scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x1a2a1a, 1.1));
const moon = new THREE.DirectionalLight(0xdfe6ff, 1.4);
moon.position.set(-6, 10, 4);
scene.add(moon);

// The ground reaches the horizon: the lawn runs on until the fog (and the sky, the same colour) swallows it.
// WHY (glow-camera pass 2026-10-20, "the camera tilts, but around the wrong axis"): it was a 10 m disc. The editor's
// camera turns round the middle of the garden from 16 m away (as far as the player's camera stands), so every turn
// carried it off the disc: the disc's rim became the horizon — slanted up to 19° on a PC, curved on a phone — and the
// sky showed UNDER the ground (the whole bottom of the picture after a quarter turn on a phone). A floating plate
// tipping against the sky reads as the camera rolling around a wrong axis, although the turn itself was exactly
// Lantern Cove's (whose sea runs to the horizon). 200 m: past where the editor's camera can go (60 m out, the fog
// pushed out by as much) plus the fog's 40 m, so its edge is never in view. Flat and far bigger than the rest, so
// "frame all" and the turning point still ignore it and the editor still holds it still (focus.js, ground.js).
const ground = new THREE.Mesh(new THREE.CircleGeometry(200, 64), new THREE.MeshStandardMaterial({ color: 0x2f5a3c, roughness: 1 }));
ground.name = 'ground';
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const tree = (x, z, s) => {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * s, 0.18 * s, 1.2 * s, 8), new THREE.MeshStandardMaterial({ color: 0x5b3b25 }));
  trunk.position.y = 0.6 * s;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.8 * s, 1.8 * s, 10), new THREE.MeshStandardMaterial({ color: 0x1f4d34, roughness: 0.9 }));
  top.position.y = 1.9 * s;
  g.add(trunk, top);
  g.position.set(x, 0, z);
  return g;
};
[[-5, -3, 1.3], [5.5, -2, 1.1], [-3, -6, 1.6], [3, -6.5, 1.4]].forEach(([x, z, s], i) => {
  const t = tree(x, z, s);
  t.userData.studioKey = `tree-${i + 1}`;
  scene.add(t);
});

const lanterns = [];
[[-3, 1], [-1.5, -1.5], [0.5, 0.8], [2.2, -1], [3.6, 1.6]].forEach(([x, z], i) => {
  const g = new THREE.Group();
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 6), new THREE.MeshStandardMaterial({ color: 0x3a3a44 }));
  post.position.y = 0.5;
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 12), new THREE.MeshStandardMaterial({ color: 0x555566, emissive: 0x000000 }));
  glass.position.y = 1.15;
  g.add(post, glass);
  g.position.set(x, 0, z);
  g.userData.studioKey = `lantern-${i + 1}`;
  g.userData.glass = glass;
  scene.add(g);
  lanterns.push(g);
});

// The world and the UI as last saved in the editor (placement.json `objects` and `ui`).
await applyPlacement(scene, './placement.json');

const scoreEl = document.getElementById('score');
let lit = 0;
document.querySelector('.start').addEventListener('click', () => document.body.classList.add('playing'));
const ray = new THREE.Raycaster();
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!document.body.classList.contains('playing')) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObjects(lanterns, true)[0];
  const g = hit && lanterns.find((l) => l === hit.object.parent);
  if (!g || g.userData.lit) return;
  g.userData.lit = true;
  g.userData.glass.material.emissive.set(0xffc35a);
  g.userData.glass.material.color.set(0xffe2a0);
  scoreEl.textContent = String(++lit);
});

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop((t) => {
  for (const [i, l] of lanterns.entries()) l.userData.glass.position.y = 1.15 + Math.sin(t / 600 + i) * 0.04;
  renderer.render(scene, camera);
});
