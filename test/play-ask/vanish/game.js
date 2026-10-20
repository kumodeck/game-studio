// Pad Walk: walk the hero around; F = full screen. A test game for ask-while-playing (see ../README.md).
import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#2b3550');
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
scene.add(new THREE.HemisphereLight('#dfe8ff', '#334', 1.6));
const sun = new THREE.DirectionalLight('#fff', 1.4);
sun.position.set(4, 10, 6);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#5d7a4e' }));
ground.name = 'ground';
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 0.08, 40), new THREE.MeshStandardMaterial({ color: '#ffd166', emissive: '#7a5a00' }));
pad.name = 'pad';
pad.position.set(4, 0.04, -2);
scene.add(pad);

const hero = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 0.8, 6, 16), new THREE.MeshStandardMaterial({ color: '#4cc9f0' }));
hero.name = 'hero';
hero.position.set(0, 0.8, 2);
scene.add(hero);

for (const [i, x, z] of [[1, -3, -1], [2, -2, -4], [3, 2, -6]]) {
  const c = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: '#b5835a' }));
  c.name = `crate-${i}`;
  c.position.set(x, 0.5, z);
  scene.add(c);
}

const keys = new Set();
addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'f') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }
});
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

let still = 0;
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dx = (keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0);
  const dz = (keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0);
  hero.position.x += dx * 4 * dt;
  hero.position.z += dz * 4 * dt;
  still = dx || dz ? 0 : still + dt;
  const onPad = Math.hypot(hero.position.x - pad.position.x, hero.position.z - pad.position.z) < 1.2;
  if (onPad && still > 1 && hero.visible) {
    hero.visible = false; // BUG: standing still on the pad hides the hero
    console.warn('hero hidden: idle on pad');
  }
  if (!onPad) hero.visible = true;
  camera.position.set(hero.position.x, 4.5, hero.position.z + 7);
  camera.lookAt(hero.position.x, 0.8, hero.position.z);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
window.__game = { hero, pad };
