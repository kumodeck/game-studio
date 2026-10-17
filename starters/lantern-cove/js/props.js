// Lantern Cove — the things in the cove (all made from code: no files, no third-party models).
//
// Every prop is one Group whose `userData.studioKey` is its stable name in the editor ("lighthouse", "pine-2", …):
// that group is what the user picks, moves, turns, scales, copies or deletes. Anything that animates (bobbing on
// the waves, swaying in the wind, the lighthouse beam) lives on a CHILD, so the pose the editor reads and writes is
// only ever the user's placement — never a frame of the animation.
//
// Floating things carry `userData.float` (len/wid = where the waves are felt, draft = how far the model's origin
// sits BELOW the waterline (negative = above), keel = how deep it reaches, mass); sim.js makes them ride the waves.
// userData holds NUMBERS ONLY: Object3D.clone() (the editor's Copy) deep-copies userData through JSON, and a node
// reference in there would serialise a whole subtree (seen costing ~0.6 s per copy in another game). Animated
// children are found by name instead ('bob', 'sway', 'beam', 'sail', 'blink').
// Design: few materials, quiet colours (weathered white, rust red, tar black, wet stone, dark pine), and small warm
// lights that the bloom turns into lanterns at dusk.
import * as THREE from 'three';
import { fbm, height } from './terrain.js';

const std = (color, rough = 0.8, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
const M = {
  white: std(0xe9e2d4, 0.7),
  red: std(0x9c2f25, 0.65),
  tar: std(0x23201e, 0.6),
  wood: std(0x7a5a3c, 0.85),
  darkWood: std(0x4a3727, 0.9),
  plank: std(0x8b7158, 0.9),
  slate: std(0x3c4148, 0.75),
  pine: std(0x2c4630, 0.9),
  bark: std(0x4b3a2c, 0.95),
  rock: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true }),
  sail: std(0xf1e6d0, 0.85, { side: THREE.DoubleSide, emissive: 0xffb070, emissiveIntensity: 0.02 }),
  hullBlue: std(0x2d4b63, 0.55),
  hullGreen: std(0x3d5a48, 0.7, { side: THREE.DoubleSide }),
  brass: new THREE.MeshStandardMaterial({ color: 0xb08a4a, roughness: 0.35, metalness: 0.9 }),
  // Lights at dusk: HDR emissive so the bloom picks them up (ACES keeps them warm, not white).
  lamp: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffb45c, emissiveIntensity: 9 }),
  window: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa04a, emissiveIntensity: 3.2 }),
  buoyLight: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff4030, emissiveIntensity: 6 }),
};

function mesh(geo, mat, at = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(at.x || 0, at.y || 0, at.z || 0);
  m.rotation.set(at.rx || 0, at.ry || 0, at.rz || 0);
  if (at.s) m.scale.setScalar(at.s);
  m.castShadow = at.cast !== false;
  m.receiveShadow = true;
  return m;
}
/** The editable top object. `ground` = stand on the land at (x, z). */
function prop(key, x, z, { y = 0, ry = 0, ground = false, label } = {}) {
  const g = new THREE.Group();
  g.userData.studioKey = key;
  g.name = label || key;
  g.position.set(x, ground ? height(x, z) - 0.15 : y, z);
  g.rotation.y = ry;
  return g;
}

// ------------------------------------------------------------------ boat hull (lofted cross-sections)
// Bow at +z. u = 0 stern … 1 bow; across each section a goes port deck edge → keel → starboard deck edge.
function hullGeometry({ len, beam, depth, sheer = 0.25, deck = true }) {
  const NU = 22, NA = 14, pos = [], idx = [];
  const halfW = (u) => (beam / 2) * Math.sqrt(Math.max(0, 1 - u ** 2.6)) * (0.8 + 0.2 * Math.sin(Math.PI * Math.min(u * 1.6, 1)));
  const top = (u) => 0.18 + sheer * u * u;
  const keel = (u) => depth * (1 - 0.35 * u ** 3);
  for (let i = 0; i <= NU; i++) {
    const u = i / NU, z = (u - 0.5) * len, w = halfW(u);
    for (let j = 0; j <= NA; j++) {
      const th = ((j / NA) * 2 - 1) * (Math.PI / 2);
      pos.push(w * Math.sin(th), top(u) - (top(u) + keel(u)) * Math.pow(Math.cos(th), 0.55), z);
    }
  }
  const row = NA + 1;
  for (let i = 0; i < NU; i++) for (let j = 0; j < NA; j++) {
    const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  // Transom (flat stern) and, for decked boats, the deck: fans over the section / the top edge.
  const fan = (ring, centre, flip) => {
    const ci = pos.length / 3;
    pos.push(...centre);
    for (let k = 0; k < ring.length - 1; k++) flip ? idx.push(ci, ring[k + 1], ring[k]) : idx.push(ci, ring[k], ring[k + 1]);
  };
  fan([...Array(row).keys()], [0, (top(0) - keel(0)) / 2, -len / 2], true);
  if (deck) {
    for (let i = 0; i < NU; i++) {
      const p0 = i * row, p1 = (i + 1) * row, s0 = p0 + NA, s1 = p1 + NA;
      idx.push(p0, s0, p1, s0, s1, p1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ rocks (noisy blobs, coloured by height)
function rockGeometry(base, seed, amp, radial = false) {
  // Push every vertex along its normal by 3D noise of its position (same position → same push, so the indexed
  // mesh stays closed), then split the faces for flat shading: faceted wet stone. `radial`: push sideways only
  // (pillars: their caps share rim positions with the sides, and pushing those along two normals would crack them).
  const p = base.attributes.position, nrm = base.attributes.normal, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 0.45 + seed, v.y * 0.3 + v.z * 0.45, 4) + 0.5 * fbm(v.y * 1.4 + seed, v.x * 1.3 - v.z, 2);
    const d = (n - 0.75) * amp;
    if (radial) { const l = Math.hypot(v.x, v.z) || 1; p.setXYZ(i, v.x + (v.x / l) * d, v.y, v.z + (v.z / l) * d); }
    else p.setXYZ(i, v.x + nrm.getX(i) * d, v.y + nrm.getY(i) * d, v.z + nrm.getZ(i) * d);
  }
  const g = base.index ? base.toNonIndexed() : base;
  g.computeVertexNormals();
  g.computeBoundingBox();
  const { min, max } = g.boundingBox, c = new THREE.Color(), gp = g.attributes.position, cols = [];
  for (let i = 0; i < gp.count; i++) {
    const t = (gp.getY(i) - min.y) / (max.y - min.y);
    c.setRGB(0.2, 0.19, 0.18).lerp(new THREE.Color(0.48, 0.45, 0.41), Math.min(1, t * 1.6));
    if (g.attributes.normal.getY(i) > 0.75 && t > 0.8) c.setRGB(0.3, 0.38, 0.2); // grass on the flat top
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return g;
}

// ------------------------------------------------------------------ the props
export function makeProps() {
  const all = [];
  const add = (g) => (all.push(g), g);

  // Lighthouse on the headland: banded tower, gallery, glowing lantern, two slow beams.
  const lh = add(prop('lighthouse', -24, -20, { ground: true }));
  lh.add(mesh(new THREE.CylinderGeometry(2.3, 2.6, 1.2, 24), std(0x8c857a, 0.95), { y: 0.4 }));
  const bands = 5, H = 9;
  for (let i = 0; i < bands; i++) {
    const r0 = 1.55 - (0.5 * i) / bands, r1 = 1.55 - (0.5 * (i + 1)) / bands;
    lh.add(mesh(new THREE.CylinderGeometry(r1, r0, H / bands, 24), i % 2 ? M.red : M.white, { y: 1 + (H / bands) * (i + 0.5) }));
  }
  lh.add(mesh(new THREE.CylinderGeometry(1.45, 1.2, 0.2, 24), M.tar, { y: 10.1 }));
  lh.add(mesh(new THREE.TorusGeometry(1.4, 0.04, 6, 32), M.tar, { y: 10.75, rx: Math.PI / 2 }));
  lh.add(mesh(new THREE.CylinderGeometry(0.72, 0.72, 1.3, 16), M.lamp, { y: 10.85, cast: false }));
  lh.add(mesh(new THREE.ConeGeometry(0.95, 1.0, 16), M.red, { y: 12.0 }));
  lh.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), M.brass, { y: 12.6 }));
  const lhLight = new THREE.PointLight(0xffb35a, 40, 40, 1.6);
  lhLight.position.y = 10.9;
  lh.add(lhLight);
  const beam = new THREE.Group();
  beam.name = 'beam';
  beam.position.y = 10.9;
  // Beam: two crossed flat cards per arm (a trapezoid from the lamp outward), additive, fading along the length and
  // toward the edges. An open cone was tried first: its far rim showed as a dotted ring in the sky whenever an arm
  // pointed at the camera.
  const beamMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec2 vUv;
      void main(){ float along = pow(1.0 - vUv.x, 2.0); float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
      float a = along * across * across * 0.16; gl_FragColor = vec4(vec3(1.0, 0.78, 0.5) * a, 1.0); }`,
  });
  const card = new THREE.BufferGeometry();
  // x along the beam (0 at the lamp … 28 m), y across: 0.25 m wide at the lamp, 4 m at the end. uv.x = along.
  card.setAttribute('position', new THREE.Float32BufferAttribute([0, -0.12, 0, 28, -2, 0, 28, 2, 0, 0, 0.12, 0], 3));
  card.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  card.setIndex([0, 1, 2, 0, 2, 3]);
  for (const side of [0, Math.PI]) {
    const arm = new THREE.Group();
    arm.rotation.y = side;
    for (const roll of [0, Math.PI / 2]) {
      const m = new THREE.Mesh(card, beamMat);
      m.rotation.x = roll;
      m.castShadow = false;
      m.frustumCulled = false;
      arm.add(m);
    }
    beam.add(arm);
  }
  lh.add(beam);

  // Sea arch: a weathered stone bow standing in the water at the back of the bay.
  const arch = add(prop('sea-arch', 11, -42, { ry: -0.35 }));
  const path = new THREE.CatmullRomCurve3([[-7, -6, 0], [-7.4, 3, 0], [-5, 8.5, 0], [0, 10.5, 0], [5, 8.5, 0], [7.2, 3, 0], [7, -6, 0]].map((p) => new THREE.Vector3(...p)));
  arch.add(mesh(rockGeometry(new THREE.TubeGeometry(path, 48, 1.9, 12, false), 3.1, 1.5), M.rock));

  // Two sea stacks: tall pillars of rock (the "giants" of the scene).
  // Pillars: a slightly tapered cylinder, pushed out by noise (ledges, cracks), wider at the waterline.
  const stackGeo = (r, h, seed) => {
    const g = new THREE.CylinderGeometry(r * 0.78, r * 1.1, h, 16, 14);
    g.translate(0, h / 2 - 4, 0); // 4 m of it under water
    return rockGeometry(g, seed, r * 0.7, true);
  };
  const st1 = add(prop('sea-stack', -5, -36));
  st1.add(mesh(stackGeo(2.8, 15, 7.3), M.rock));
  const st2 = add(prop('sea-stack-small', 0.5, -45));
  st2.add(mesh(stackGeo(2.0, 10, 1.9), M.rock));

  // Cottage on the grassy rise: plank walls, slate roof, warm windows.
  const hut = add(prop('cottage', 18.5, -0.5, { ground: true, ry: -1.25 }));
  hut.add(mesh(new THREE.BoxGeometry(4.2, 2.6, 3.4), std(0xb9ab93, 0.9), { y: 1.3 }));
  const roofShape = new THREE.Shape([new THREE.Vector2(-2.6, 0), new THREE.Vector2(2.6, 0), new THREE.Vector2(0, 1.9)]);
  const roof = new THREE.ExtrudeGeometry(roofShape, { depth: 3.9, bevelEnabled: false });
  roof.translate(0, 0, -1.95);
  hut.add(mesh(roof, M.slate, { y: 2.6 }));
  hut.add(mesh(new THREE.BoxGeometry(0.5, 1.4, 0.5), std(0x6e655a, 0.9), { x: 1.1, y: 3.9, z: -0.6 }));
  for (const x of [-1.2, 1.2]) hut.add(mesh(new THREE.PlaneGeometry(0.8, 0.8), M.window, { x, y: 1.5, z: 1.71, cast: false }));
  hut.add(mesh(new THREE.BoxGeometry(0.9, 1.7, 0.08), M.darkWood, { y: 0.85, z: 1.72 }));
  const hutLight = new THREE.PointLight(0xffa04a, 6, 9, 2);
  hutLight.position.set(0, 1.5, 2.4);
  hut.add(hutLight);

  // Pier: from the beach out into the bay (toward -x).
  const pier = add(prop('pier', 15, 6));
  for (let i = 0; i < 26; i++) pier.add(mesh(new THREE.BoxGeometry(0.42, 0.12, 2.2), i % 3 ? M.plank : M.wood, { x: 1 - i * 0.46, y: 1.05, ry: (fbm(i, 2) - 0.5) * 0.04 }));
  for (let i = 0; i < 5; i++) for (const z of [-1, 1]) pier.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 5, 8), M.darkWood, { x: 0.6 - i * 2.8, y: -1.4, z }));

  // Lamp post at the end of the pier.
  const lamp = add(prop('lamp-post', 4.4, 6.9, { y: 1.1 }));
  lamp.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.6, 8), M.tar, { y: 1.3 }));
  lamp.add(mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), M.tar, { x: 0.3, y: 2.55 }));
  lamp.add(mesh(new THREE.BoxGeometry(0.26, 0.34, 0.26), M.lamp, { x: 0.58, y: 2.3, cast: false }));
  lamp.add(mesh(new THREE.ConeGeometry(0.24, 0.16, 4), M.tar, { x: 0.58, y: 2.54, ry: Math.PI / 4 }));
  const lampLight = new THREE.PointLight(0xffb45c, 9, 14, 1.8);
  lampLight.position.set(0.58, 2.2, 0);
  lamp.add(lampLight);

  // Pines: two on the rise behind the cottage, one leaning by the lighthouse. The crown sways (child "sway").
  const pine = (key, x, z, s, lean) => {
    const p = add(prop(key, x, z, { ground: true }));
    const sway = new THREE.Group();
    sway.name = 'sway';
    sway.rotation.z = lean;
    sway.add(mesh(new THREE.CylinderGeometry(0.16, 0.3, 4.2, 7), M.bark, { y: 2.1 }));
    for (let k = 0; k < 4; k++) sway.add(mesh(new THREE.ConeGeometry(2.2 - k * 0.45, 2.6, 8), M.pine, { y: 3.0 + k * 1.25, ry: k }));
    p.scale.setScalar(s);
    p.add(sway);
    p.userData.sway = { lean, phase: x * 0.7 }; // numbers only: the editor's copy JSON-clones userData
    return p;
  };
  pine('pine-1', 22, -5, 1.15, 0.03);
  pine('pine-2', 23.5, 3.5, 0.95, -0.02);
  pine('pine-3', -30.5, -14, 1.0, 0.12);

  // ---- floating things (sim.js) ------------------------------------------------------------------------------
  const floater = (key, x, z, ry, spec) => {
    const p = add(prop(key, x, z, { ry }));
    const bob = new THREE.Group();
    bob.name = 'bob';
    p.add(bob);
    p.userData.float = spec; // numbers only (see above); sim.js finds the child by its name 'bob'
    return [p, bob];
  };

  // Sailboat — the one you sail in Play. Bow at +z.
  const [boat, boatBob] = floater('sailboat', -3, 9, 2.0, { len: 5.6, wid: 1.9, draft: -0.3, keel: 0.5, mass: 3, radius: 2.4 });
  boatBob.add(mesh(hullGeometry({ len: 5.6, beam: 1.9, depth: 0.75, sheer: 0.3 }), M.hullBlue));
  boatBob.add(mesh(new THREE.BoxGeometry(1.1, 0.5, 1.6), M.white, { y: 0.45, z: -0.5 }));
  boatBob.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 7.2, 8), M.darkWood, { y: 3.7, z: 0.6 }));
  boatBob.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.0, 6), M.darkWood, { y: 0.95, z: -0.9, rx: Math.PI / 2 }));
  const sail = new THREE.Group();
  sail.name = 'sail';
  sail.position.z = 0.6;
  sail.add(mesh(sailGeometry([0, 0.95, 0], [0, 7.1, 0], [0, 0.95, -3.2], 0.45), M.sail));
  sail.add(mesh(sailGeometry([0, 0.7, 2.2], [0, 6.4, 0.05], [0, 1.0, 0.1], 0.3), M.sail));
  boatBob.add(sail);

  // Rowboat tied by the pier: open hull (double-sided), two thwarts.
  const [row, rowBob] = floater('rowboat', 8.5, 9.6, 0.45, { len: 3.6, wid: 1.3, draft: -0.16, keel: 0.3, mass: 1, radius: 1.8 });
  rowBob.add(mesh(hullGeometry({ len: 3.6, beam: 1.35, depth: 0.42, sheer: 0.18, deck: false }), M.hullGreen));
  for (const z of [-0.5, 0.55]) rowBob.add(mesh(new THREE.BoxGeometry(1.05, 0.05, 0.25), M.plank, { y: 0.02, z }));

  const [buoy, buoyBob] = floater('buoy', -10, -1, 0, { len: 0.9, wid: 0.9, draft: -0.15, keel: 0.4, mass: 0.6, radius: 0.7 });
  buoyBob.add(mesh(new THREE.CylinderGeometry(0.45, 0.32, 1.0, 16), M.red, { y: 0 }));
  buoyBob.add(mesh(new THREE.ConeGeometry(0.42, 1.0, 16), M.red, { y: 1.0 }));
  const blink = mesh(new THREE.SphereGeometry(0.11, 10, 8), M.buoyLight, { y: 1.6, cast: false });
  blink.name = 'blink';
  buoyBob.add(blink);

  const lathe = new THREE.LatheGeometry([0, 1, 2, 3, 4, 5, 6].map((i) => new THREE.Vector2(0.36 + 0.07 * Math.sin((i / 6) * Math.PI), (i / 6) * 1.0 - 0.5)), 16);
  const [barrel, barrelBob] = floater('barrel', 3.5, 17, 0.3, { len: 1.0, wid: 0.8, draft: 0.04, keel: 0.4, mass: 0.4, radius: 0.6 });
  barrelBob.add(mesh(lathe, M.wood, { rz: Math.PI / 2 }));
  for (const x of [-0.3, 0.3]) barrelBob.add(mesh(new THREE.TorusGeometry(0.42, 0.025, 6, 20), M.tar, { x, ry: Math.PI / 2 }));

  const [crate, crateBob] = floater('crate', -8, 15, 0.7, { len: 0.9, wid: 0.9, draft: -0.12, keel: 0.35, mass: 0.4, radius: 0.7 });
  crateBob.add(mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), M.plank));
  for (const y of [-0.25, 0.25]) crateBob.add(mesh(new THREE.BoxGeometry(0.94, 0.1, 0.94), M.darkWood, { y }));

  return { all, boat, lighthouse: lh, buoy, rockMaterial: M.rock };
}

/** A sail: a triangle with a belly (bulging along +x), tack → head along the luff, clew at the back corner. */
function sailGeometry(tack, head, clew, belly) {
  const N = 10, pos = [], idx = [];
  const A = new THREE.Vector3(...tack), B = new THREE.Vector3(...head), C = new THREE.Vector3(...clew);
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N - i; j++) {
    const s = i / N, t = j / N; // s up the luff, t toward the leech
    const f = s < 1 ? t / (1 - s) : 0; // 0 at the luff (mast) … 1 at the leech (back edge)
    const luff = A.clone().lerp(B, s), leech = C.clone().lerp(B, s);
    const p = luff.lerp(leech, f);
    p.x += belly * Math.sin(Math.PI * f) * (1 - s * 0.8);
    pos.push(p.x, p.y, p.z);
  }
  let k = 0;
  const id = [];
  for (let i = 0; i <= N; i++) { id.push([]); for (let j = 0; j <= N - i; j++) id[i].push(k++); }
  for (let i = 0; i < N; i++) for (let j = 0; j < N - i; j++) {
    idx.push(id[i][j], id[i][j + 1], id[i + 1][j]);
    if (j < N - i - 1) idx.push(id[i][j + 1], id[i + 1][j + 1], id[i + 1][j]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
