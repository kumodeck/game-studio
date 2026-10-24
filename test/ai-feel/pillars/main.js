// Pillar Plaza — a small test game for a real AI (test/ai-feel/real-ai.mjs): one blue pillar and three grey ones on a
// plaza. The blue pillar already sways (a motion made in the editor, "Sway" in placement.json), the way a person's game
// has a motion before they ask their AI for another one.
import * as THREE from 'three';
import { applyPlacement } from './studio-placement.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color('#1d2230');
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 7, 14);
camera.lookAt(0, 1.5, 0);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.append(renderer.domElement);
scene.add(new THREE.HemisphereLight('#dfe8ff', '#30261c', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(5, 10, 6);
scene.add(sun);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: '#6d6a63' }));
ground.rotation.x = -Math.PI / 2;
ground.userData.studioKey = 'plaza';
scene.add(ground);

function pillar(key, color, x, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, 3, 24), new THREE.MeshStandardMaterial({ color }));
  m.position.set(x, 1.5, z);
  m.userData.studioKey = key;
  scene.add(m);
  return m;
}
pillar('blue-pillar', '#2f6bff', 0, 0);
pillar('grey-pillar-1', '#9a9a9a', -4, -2);
pillar('grey-pillar-2', '#9a9a9a', 4, -2);
pillar('grey-pillar-3', '#9a9a9a', 0, -5);

await applyPlacement(scene, './placement.json');

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => renderer.render(scene, camera));
