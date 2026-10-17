// Lantern Cove — background life that is not for arranging: boulders along the shores and a few gulls.
//
// Boulders are one InstancedMesh (one draw call for all of them); gulls are tiny flapping V shapes circling the
// lighthouse (far birds are one of the oldest tricks for "this place is alive and big"). Both are marked
// `userData.studio = false`, and the editor also skips instanced meshes on its own.
import * as THREE from 'three';
import { height, fbm } from './terrain.js';

export function makeDecor(rockMaterial) {
  const group = new THREE.Group();
  group.name = 'decor';
  group.userData.studio = false;

  // ---- boulders: scattered where the land meets the water (found by walking rings and keeping |height| < 1.2) --
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.75 + 0.5 * fbm(v.x * 1.7 + 3, v.y * 1.7 + v.z * 1.3, 2));
    p.setXYZ(i, v.x, v.y * 0.7, v.z);
  }
  const flat = geo.toNonIndexed();
  flat.computeVertexNormals();
  const cols = new Float32Array(flat.attributes.position.count * 3);
  for (let i = 0; i < cols.length; i += 3) cols.set([0.34, 0.32, 0.3], i);
  flat.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const spots = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 2400 && spots.length < 70; k++) {
    const x = -60 + rnd() * 100, z = -45 + rnd() * 70;
    const h = height(x, z);
    if (h > -1.0 && h < 1.4 && Math.hypot(x + 3, z - 9) > 8) spots.push([x, h, z]);
  }
  const inst = new THREE.InstancedMesh(flat, rockMaterial, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), e = new THREE.Euler();
  spots.forEach(([x, h, z], i) => {
    const size = 0.4 + rnd() * rnd() * 2.2;
    e.set(rnd() * 0.4, rnd() * 6.28, rnd() * 0.4);
    m.compose(new THREE.Vector3(x, h - size * 0.25, z), q.setFromEuler(e), s.set(size * (0.8 + rnd() * 0.5), size, size * (0.8 + rnd() * 0.5)));
    inst.setMatrixAt(i, m);
  });
  inst.castShadow = inst.receiveShadow = true;
  group.add(inst);

  // ---- gulls -------------------------------------------------------------------------------------------------
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.12, 0, 0, -0.12, 0.9, 0.05, 0, 0, 0, 0.12, 0, 0, -0.12, -0.9, 0.05, 0], 3));
  wing.computeVertexNormals();
  const gullMat = new THREE.MeshBasicMaterial({ color: 0x2a2228, side: THREE.DoubleSide, fog: true });
  const gulls = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Mesh(wing.clone(), gullMat);
    g.userData.gull = { r: 14 + i * 3.5, h: 16 + (i % 3) * 3, w: 0.18 + i * 0.02, ph: i * 1.7, cx: -18 + i * 2, cz: -22 };
    g.frustumCulled = false;
    group.add(g);
    gulls.push(g);
  }
  function step(t) {
    for (const g of gulls) {
      const u = g.userData.gull, a = t * u.w + u.ph;
      g.position.set(u.cx + Math.cos(a) * u.r, u.h + Math.sin(a * 2.3) * 0.8, u.cz + Math.sin(a) * u.r);
      g.rotation.set(0, -a, Math.sin(a) * 0.15);
      // Flap: lift the wing tips (vertices 2 and 5) — slow beats with long glides.
      const flap = Math.sin(t * 7 + u.ph * 3) * (0.5 + 0.5 * Math.sin(t * 0.7 + u.ph)) * 0.45;
      const pos = g.geometry.attributes.position;
      pos.setY(2, 0.05 + flap); pos.setY(5, 0.05 + flap);
      pos.needsUpdate = true;
    }
  }
  return { group, step };
}
