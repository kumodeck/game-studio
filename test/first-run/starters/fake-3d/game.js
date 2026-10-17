// Test starter: three named boxes on a plane (the editor's built-in three.js adapter finds them).
import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({ antialias: true });
document.body.append(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbcd9ee);
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(6, 6, 9);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.5));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ color: 0x6f9a6a }));
ground.name = 'ground';
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
[['lighthouse', -2, 0xe0e0e0], ['boat', 0.5, 0xd2691e], ['buoy', 2.5, 0xff5544]].forEach(([name, x, color]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshStandardMaterial({ color }));
  m.name = name;
  m.position.set(x, 0.6, 0);
  scene.add(m);
});
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => renderer.render(scene, camera));
