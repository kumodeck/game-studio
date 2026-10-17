import * as THREE from 'three';
import { applyPlacement } from './studio-placement.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc9e8);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 9, 12);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x557744, 2.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(4, 8, 3);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x7fb069 }));
ground.rotation.x = -Math.PI / 2;
ground.name = 'ground';
scene.add(ground);

function tree(x, z) {
  const g = new THREE.Group();
  g.name = 'tree';
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1), new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));
  trunk.name = 'trunk';
  trunk.position.y = 0.5;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.8, 1.6, 8), new THREE.MeshStandardMaterial({ color: 0x2e7d32 }));
  top.position.y = 1.7;
  g.add(trunk, top);
  g.position.set(x, 0, z);
  return g;
}
scene.add(tree(-3, 0), tree(3, 0));
const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6), new THREE.MeshStandardMaterial({ color: 0x888888 }));
rock.name = 'rock';
rock.position.set(0, 0.5, 2);
scene.add(rock);
const hero = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({ color: 0xe53935 }));
hero.userData.studioKey = 'hero';
hero.position.set(0, 0.4, -2);
scene.add(hero);

// Apply after the world is built, before anything (physics, game logic) reads positions.
const report = await applyPlacement(scene, './placement.json');
const pos = (o) => o.position.toArray().map((v) => Math.round(v * 1000) / 1000);
const trees = scene.children.filter((o) => o.name === 'tree');
window.__placementCheck = {
  report,
  tree: pos(trees[0]), tree2: pos(trees[1]), treeYaw: trees[0].rotation.y, tree2Scale: trees[1].scale.x,
  rock: pos(rock), hero: pos(hero),
};

function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
