/**
 * Three Isles' levels: three landforms (2026-10-22). Each level is a height function (x, z) → y, used twice: for the
 * ground's mesh (terrainMesh) and for the ball's floor (game.js), so the two never disagree. No textures, no models:
 * a coloured grid, flat-shaded, with a few simple shapes on it.
 *
 *   Meadow — rolling hills, a stream across the middle and a wooden bridge over it; a grove on the west hill.
 *            The gentle level: slopes you can roll up.
 *   Canyon — a narrow valley between high dark walls, winding north; stone pillars, a chasm with a rope bridge,
 *            crystals that glow. Fall in and you start again.
 *   Summit — a steep snow mountain; a switchback path climbs it to the flag on top, a frozen pond below.
 *            The face is too steep to climb straight: take the path (roll off it and you drop to the turn below).
 *
 * Why these three (10/22, after the first version's levels differed only in the floor's colour): different
 * terrain reads at a glance, even in a few seconds of video. Gentle (green, open) → tight (dark, walls) → tall
 * (white, vertical) — each changes how the ball moves, not just how it looks.
 *
 * A level: { id, label, look, start: [x, z], height(x, z), surface?(x, z) → 'ice' | 'water' | undefined,
 *            scenery?(ground) adds non-listed shapes as the ground's children, things: [name, kind, x, z][] }.
 * Names (keys) repeat across levels (tree-1, rock-1, gem-1, flag…) so a copied level keeps them (CONTRACT.md §1.10).
 */

import * as THREE from 'three';

export const HALF = 20; // half-size of each island (world units): 40 × 40
const BOTTOM = -14; // the island's underside (its cliff sides reach down to here)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Distance from (x, z) to the segment a–b, and how far along it (0–1). */
function toSegment(x, z, [ax, az], [bx, bz]) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return { d: Math.hypot(x - ax - dx * t, z - az - dz * t), t };
}

// ------------------------------------------------------------------ Meadow
// The stream winds east–west across the middle; the bridge crosses it at x = 0 (the straight line from the start).
const streamZ = (x) => 1.5 + 2.5 * Math.sin(x * 0.22);
const BRIDGE_HALF = 3.6; // the bridge's half-length (along z), bank to bank
function meadowHeight(x, z) {
  const d = Math.abs(z - streamZ(x));
  // Rolling hills, flattened near the stream so its banks are low; two bigger hills: the grove (west) and the flag's.
  let h = 0.7 + 0.6 * Math.sin(x * 0.19 + 0.5) * Math.cos(z * 0.16) + 0.4 * Math.sin((x + z) * 0.12);
  h += 3.2 * Math.exp(-((x + 12) ** 2 + (z + 10) ** 2) / 40) + 2.4 * Math.exp(-((x - 5) ** 2 + (z + 14) ** 2) / 30);
  h *= smooth(1.5, 6, d);
  h -= 1.0 * (1 - smooth(0.8, 4.0, d)); // the stream's bed: 1 below the banks, slopes ≤ 0.5 (you can roll out)
  // The bridge: an arched deck over the water (it is part of the floor, so the ball rolls over it).
  const along = z - streamZ(0);
  if (Math.abs(x) < 1.5 && Math.abs(along) < BRIDGE_HALF) h = Math.max(h, 0.15 + 0.45 * (1 - (along / BRIDGE_HALF) ** 2));
  return h;
}
const MEADOW_WATER = -0.55;

// ------------------------------------------------------------------ Canyon
// The valley's middle line winds as it runs north; its floor is 4–6 units wide; the walls are 7 high (10 hid the
// floor from the camera: the first preview was all wall).
const canyonX = (z) => 5 * Math.sin(z * 0.16);
const canyonW = (z) => 3.8 + 1.0 * Math.sin(z * 0.3 + 1);
const CHASM_Z = -2, CHASM_HALF = 1.7; // the chasm across the valley, and its rope bridge
function canyonHeight(x, z) {
  const d = Math.abs(x - canyonX(z)), w = canyonW(z);
  const floor = 0.15 * Math.sin(x * 0.7) * Math.cos(z * 0.5);
  // The walls: up 7 over ~1.4 units (no ball climbs that), with a ragged rim.
  const wall = 7 * smooth(w, w + 1.4, d) + (1.2 * Math.sin(z * 0.45 + x * 0.3) + 0.6 * Math.sin(z * 1.3)) * smooth(w + 0.5, w + 3, d);
  let h = floor + wall;
  if (Math.abs(z - CHASM_Z) < CHASM_HALF && d < w + 0.6) {
    // The chasm drops away; the rope bridge's deck (2.1 wide, sagging 0.35 in the middle) crosses it on the middle line.
    const u = (z - CHASM_Z) / CHASM_HALF;
    h = Math.abs(x - canyonX(CHASM_Z)) < 1.05 ? -0.35 * (1 - u * u) : -10;
  }
  return h;
}

// ------------------------------------------------------------------ Summit
// A steep cone with a flat top; a switchback path cut into its face, climbing evenly from the foot to the top.
const PEAK = [0, -8], TOP = 13;
// Long traverses across the face, ~5 apart, joined by short turns (the first version's legs met in narrow Vs: at
// each turn two legs overlapped for ~10 units and the ball slid from the upper one to the lower one).
const PATH = [[-1, 12], [10, 9], [11, 4.5], [-9, 2], [-9, -2.5], [7, -3.5], [6, -7], [0, -8]];
const PATH_W = 1.6; // the path's half-width
const PATH_LEN = PATH.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - PATH[i][0], p[1] - PATH[i][1]), 0);
function mountain(x, z) {
  const r = Math.hypot(x - PEAK[0], z - PEAK[1]);
  const a = Math.atan2(z - PEAK[1], x - PEAK[0]);
  const t = clamp((20 - r) / 17.5, 0, 1); // 0 at the foot (r 20), 1 on the top (r ≤ 2.5)
  // ^0.7: steep from the foot, rounding to the top — and above the path all the way up, so the path is cut into the
  // face rather than standing out of it (^1.1 left the path's turns 3 units up in the air).
  return TOP * t ** 0.7 + 0.7 * Math.sin(a * 5) * t * (1 - t) * 4; // ridges on the face, none at the foot or the top
}
/**
 * The path near (x, z): { d, y } = distance to it and its height there. At a turn two legs are both near, and the
 * nearest one's height jumps (~0.4) where it changes: the height is the legs' heights weighted by nearness instead
 * (the first version took the nearest leg only — a simulated run stuck on that step at the first turn, 10/22).
 */
function pathNear(x, z) {
  const legs = [];
  let s = 0, d = Infinity;
  for (let i = 1; i < PATH.length; i++) {
    const a = PATH[i - 1], b = PATH[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const r = toSegment(x, z, a, b);
    legs.push({ d: r.d, y: (TOP * (s + r.t * l)) / PATH_LEN });
    d = Math.min(d, r.d);
    s += l;
  }
  let sw = 0, sy = 0;
  for (const g of legs) {
    const w = Math.max(0, 1 - (g.d - d) / 1.5) / (g.d + 0.3); // only legs within 1.5 of the nearest count
    sw += w;
    sy += w * g.y;
  }
  return { d, y: sy / sw };
}
function summitHeight(x, z) {
  let h = mountain(x, z);
  // The path is cut in (or built up) at its own height; the face meets it steeply on either side.
  const { d, y } = pathNear(x, z);
  if (d < PATH_W) h = y;
  else h = y + (h - y) * smooth(PATH_W, PATH_W + 1.6, d);
  // A low snow bank on the path's open (downhill) side: 0.45 high, so the ball rolls back onto the path instead of
  // off it (without it a simulated run slid off at the first turn, 10/22). On the uphill side the face is higher.
  // None at the foot (the path's start is open: you roll onto it from the plain).
  if (d >= PATH_W && d < PATH_W + 0.9) h = Math.max(h, y + 0.45 * smooth(0.8, 1.6, y) * Math.sin((Math.PI * (d - PATH_W)) / 0.9));
  // The frozen pond on the foothills (west of the start).
  const pond = Math.hypot(x + 10, z - 12);
  if (pond < 5) h = Math.min(h, -0.15 + 0.15 * smooth(3.6, 5, pond));
  return h;
}

// ------------------------------------------------------------------ the levels
export const LEVELS = [
  {
    // gravity 45 (the others 70): every slope here can be rolled up, the stream's banks too (with 70 the ball was
    // stuck in the stream where the grove's hill meets it: a slope of 0.7 — found by a simulated run, 10/22).
    id: 'meadow', label: 'Meadow', start: [0, 15], height: meadowHeight, gravity: 45,
    surface: (x, z) => (meadowHeight(x, z) < MEADOW_WATER ? 'water' : undefined),
    look: { sky: 0xa9d8e8, tree: 0x3f8f5a, rock: 0x9a958c,
      color: (x, z, h, slope) => {
        if (h < MEADOW_WATER + 0.25) return 0xc9b98f; // the stream's bed and its sandy edge
        const top = smooth(0.5, 3.5, h);
        return mix(mix(0x7cc276, 0xa6d98c, top), 0x6aa865, smooth(0.35, 0.7, slope));
      },
      side: 0x8a6f52 },
    scenery: meadowScenery,
    things: [
      ['tree-1', 'tree', -12, -9], ['tree-2', 'tree', -15, -6.5], ['tree-3', 'tree', -9.5, -12.5], ['tree-4', 'tree', -14, -12],
      ['tree-5', 'tree', -10, -6], ['tree-6', 'tree', 13, 11], ['tree-7', 'tree', 15, -6],
      ['rock-1', 'rock', 5, 9], ['rock-2', 'rock', 10, -4],
      ['gem-1', 'gem', 0, 1.5], ['gem-2', 'gem', -12, -6.5], ['gem-3', 'gem', 13, -11], ['flag', 'flag', 5, -14]],
  },
  {
    id: 'canyon', label: 'Canyon', start: [canyonX(16), 16], height: canyonHeight,
    look: { sky: 0x1d2131, fog: [30, 70], cam: { offset: [0, 21, 9], aim: [0, 0, -7] }, hemi: 0.8, hemiSky: 0x9aa6d6, hemiGround: 0x2a2233, sun: 1.6, sunAt: [-10, 22, 4],
      tree: 0x7fe3f0, rock: 0x6b5d6e, pillar: true,
      color: (x, z, h, slope) => {
        if (h < -2) return 0x15131c; // the chasm's depths
        // The floor is the light ribbon (the way through), the walls' faces dark, their tops a dusky violet.
        if (h < 0.6 && slope < 0.8) return 0x7a7189;
        return mix(0x2f2838, 0x5e5168, smooth(5.5, 7, h) * (1 - smooth(0.8, 1.6, slope)));
      },
      side: 0x3a3142 },
    scenery: canyonScenery,
    things: [
      ['crystal-1', 'crystal', canyonX(6) - canyonW(6) - 0.2, 6], ['crystal-2', 'crystal', canyonX(-9) + canyonW(-9) + 0.2, -9],
      ['crystal-3', 'crystal', canyonX(-15) - canyonW(-15) - 0.1, -15],
      ['rock-1', 'rock', canyonX(9) + 1.4, 9], ['rock-2', 'rock', canyonX(-7) - 1.3, -7], ['rock-3', 'rock', canyonX(-12) + 1.2, -12],
      ['gem-1', 'gem', canyonX(3), 3], ['gem-2', 'gem', canyonX(CHASM_Z), CHASM_Z], ['gem-3', 'gem', canyonX(-10) + 0.8, -10],
      ['flag', 'flag', canyonX(-17), -17]],
  },
  {
    id: 'summit', label: 'Summit', start: [0, 16], height: summitHeight,
    surface: (x, z) => (Math.hypot(x + 10, z - 12) < 4.2 ? 'ice' : undefined),
    look: { sky: 0xd6e4f0, cam: { offset: [0, 9, 15], aim: [0, 3, -6] }, tree: 0x2f6b4f, rock: 0xa9d6ea, snow: true, ice: true, sunAt: [14, 18, 10],
      color: (x, z, h, slope) => {
        if (Math.hypot(x + 10, z - 12) < 4.2) return 0xb9e0f0; // the frozen pond
        if (pathNear(x, z).d < PATH_W) return 0xe9e2d6; // the path: packed snow, a little warm
        return mix(mix(0xf7f9fb, 0xdde7ef, smooth(0.2, 0.8, slope)), 0x8c96a3, smooth(1.1, 1.8, slope)); // rock shows on the steepest
      },
      side: 0x9aa6b4 },
    scenery: summitScenery,
    things: [
      ['tree-1', 'tree', -15, 5], ['tree-2', 'tree', 14, 13], ['tree-3', 'tree', -16, 16],
      ['rock-1', 'rock', 6, 14], ['rock-2', 'rock', -6, 15.5],
      ['gem-1', 'gem', -10, 12], ['gem-2', 'gem', 1, 3.25], ['gem-3', 'gem', -1, -3], ['flag', 'flag', 0, -8]],
  },
];

// ------------------------------------------------------------------ the ground's mesh
function mix(a, b, t) {
  return new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
}

/**
 * The level's ground: a grid over the island (step ~0.27), each point at the level's height, coloured by height and
 * slope; its outer ring is pulled down to BOTTOM so the island has straight cliff sides (an island, like the first
 * version's box). Flat-shaded, like the trees and rocks.
 */
export function terrainMesh(def) {
  const N = 150, step = (2 * HALF) / N;
  const geo = new THREE.PlaneGeometry(2 * HALF + 2 * step, 2 * HALF + 2 * step, N + 2, N + 2);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, colors = new Float32Array(pos.count * 3), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i), y;
    const edge = Math.abs(x) > HALF + 1e-6 || Math.abs(z) > HALF + 1e-6;
    if (edge) {
      x = clamp(x, -HALF, HALF);
      z = clamp(z, -HALF, HALF);
      y = BOTTOM;
      c.set(def.look.side);
    } else {
      y = def.height(x, z);
      const e = 0.25;
      const slope = Math.hypot(def.height(x + e, z) - def.height(x - e, z), def.height(x, z + e) - def.height(x, z - e)) / (2 * e);
      c.set(def.look.color(x, z, y, slope));
    }
    pos.setXYZ(i, x, y, z);
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  def.scenery?.(mesh);
  return mesh;
}

const flat = (color, extra) => new THREE.MeshStandardMaterial({ color, flatShading: true, ...extra });
const at = (mesh, x, y, z) => (mesh.position.set(x, y, z), mesh);

function meadowScenery(ground) {
  // The stream's water: one sheet over the island at the water line (the banks are above it everywhere else).
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF), new THREE.MeshStandardMaterial({ color: 0x5fb3d6, roughness: 0.15, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = MEADOW_WATER;
  ground.add(water);
  // The bridge: planks on the arched deck, two rails.
  const z0 = streamZ(0), wood = flat(0xb07a4a), dark = flat(0x7a5232);
  for (let z = -BRIDGE_HALF + 0.3; z <= BRIDGE_HALF - 0.3; z += 0.6) {
    const plank = at(new THREE.Mesh(new THREE.BoxGeometry(3, 0.16, 0.5), wood), 0, meadowHeight(0, z0 + z) - 0.07, z0 + z);
    plank.rotation.x = -Math.atan((-0.9 * z) / BRIDGE_HALF ** 2); // along the arch (the deck's slope)
    ground.add(plank);
  }
  for (const x of [-1.45, 1.45]) {
    for (let z = -BRIDGE_HALF + 0.4; z <= BRIDGE_HALF - 0.3; z += 1.15) ground.add(at(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7, 0.14), dark), x, meadowHeight(0, z0 + z) + 0.3, z0 + z));
    const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([-1, -0.5, 0, 0.5, 1].map((u) => new THREE.Vector3(x, meadowHeight(0, z0 + u * (BRIDGE_HALF - 0.4)) + 0.62, z0 + u * (BRIDGE_HALF - 0.4)))), 16, 0.07, 5), dark);
    ground.add(rail);
  }
}

function canyonScenery(ground) {
  // The rope bridge over the chasm: planks on the sag, posts at both ends, two ropes.
  const cx = canyonX(CHASM_Z), wood = flat(0x8a6a4a), rope = flat(0xc9b28a);
  for (let z = -CHASM_HALF; z <= CHASM_HALF + 0.01; z += 0.34) ground.add(at(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.26), wood), cx, canyonHeight(cx, CHASM_Z + z) - 0.05, CHASM_Z + z));
  for (const x of [-1.05, 1.05]) {
    for (const z of [-CHASM_HALF - 0.4, CHASM_HALF + 0.4]) ground.add(at(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.4, 6), wood), cx + x, canyonHeight(cx, CHASM_Z + z) + 0.7, CHASM_Z + z));
    const pts = [];
    for (let u = -1; u <= 1.001; u += 0.1) pts.push(new THREE.Vector3(cx + x, 1.25 - 0.55 * (1 - u * u), CHASM_Z + u * (CHASM_HALF + 0.4)));
    ground.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.045, 5), rope));
  }
}

function summitScenery(ground) {
  // The pond's ice: a glassy sheet on it.
  const ice = new THREE.Mesh(new THREE.CircleGeometry(4.3, 40), new THREE.MeshStandardMaterial({ color: 0xcdeaf6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.75 }));
  ice.rotation.x = -Math.PI / 2;
  ice.position.set(-10, -0.12, 12);
  ground.add(ice);
}

// ------------------------------------------------------------------ the things
/** One named thing, its height above the landform in position.y (game.js adds the floor's height). */
export function make(kind, look) {
  if (kind === 'tree') {
    const t = new THREE.Group();
    const cone = at(new THREE.Mesh(new THREE.ConeGeometry(1.2, 3.2, 6), flat(look.tree)), 0, 1.6, 0);
    t.add(cone);
    // Summit's pines carry snow on their tips.
    if (look.snow) t.add(at(new THREE.Mesh(new THREE.ConeGeometry(0.62, 1.2, 6), flat(0xf7f9fb)), 0, 2.65, 0));
    return t.children.length === 1 ? cone : t;
  }
  if (kind === 'crystal') {
    // A tall glowing crystal, lighting the canyon's walls around it.
    const g = new THREE.Group();
    const m = at(new THREE.Mesh(new THREE.OctahedronGeometry(1.1), flat(look.tree, { emissive: look.tree, emissiveIntensity: 0.9 })), 0, 2, 0);
    m.scale.y = 2;
    g.add(m, at(new THREE.PointLight(look.tree, 30, 12, 1.4), 0, 2.4, 0));
    return g;
  }
  if (kind === 'rock') {
    // Canyon: a stone pillar; Summit: a block of ice; Meadow: a boulder.
    if (look.pillar) return at(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.05, 5.5, 6), flat(look.rock)), 0, 2.6, 0);
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1.1), flat(look.rock, look.ice ? { roughness: 0.1, metalness: 0.05, transparent: true, opacity: 0.88 } : {}));
    m.position.y = 0.6;
    return m;
  }
  if (kind === 'gem') {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 0), flat(0xffd34d, { emissive: 0xffb000, emissiveIntensity: 0.8 }));
    m.position.y = 0.8;
    return m;
  }
  const flag = new THREE.Group();
  const pole = at(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2), flat(0xeeeeee)), 0, 1.6, 0);
  const cloth = at(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.7, 0.05), flat(0xe8590c)), 0.6, 2.8, 0);
  flag.add(pole, cloth);
  return flag;
}
