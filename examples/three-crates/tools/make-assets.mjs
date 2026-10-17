// Generates the sample's assets with no dependencies: assets/crate.glb, barrel.glb, lamp.glb, grass.png.
// Run: node examples/three-crates/tools/make-assets.mjs   (output is committed; re-run only to change the art)
//
// Why generate instead of downloading: the samples must be free of third-party art licences and must not need the
// network. A tiny hand-built glTF is also a good test: it is exactly what a GLTFLoader game loads.
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------- PNG
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** rgb(x, y) → [r, g, b] */
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(rgb(x, y), y * (w * 3 + 1) + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const noise = (x, y, s) => ((Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453) % 1 + 1) % 1;

const wood = png(64, 64, (x, y) => {
  const plank = Math.floor(y / 16);
  const edge = y % 16 === 0 || x < 3 || x > 60 || y > 60;
  const grain = 0.85 + 0.15 * Math.sin(x * 0.6 + plank * 3) * noise(x, plank, 1);
  if (edge) return [92, 58, 30];
  return [Math.round(196 * grain), Math.round(140 * grain), Math.round(78 * grain)];
});
const grass = png(64, 64, (x, y) => {
  const n = noise(x, y, 7);
  return [Math.round(96 + n * 30), Math.round(168 + n * 40), Math.round(88 + n * 20)];
});
writeFileSync(join(out, 'grass.png'), grass);

// ---------------------------------------------------------------- geometry
function box(sx, sy, sz, cy = 0) {
  const P = [];
  const N = [];
  const U = [];
  const I = [];
  const faces = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]
  ];
  for (const [n, u, v] of faces) {
    const base = P.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const p = [0, 1, 2].map((i) => (n[i] + u[i] * a + v[i] * b) * [sx, sy, sz][i] * 0.5 + (i === 1 ? cy : 0));
      P.push(...p);
      N.push(...n);
      U.push((a + 1) / 2, 1 - (b + 1) / 2);
    }
    I.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { P, N, U, I };
}
function cylinder(r, h, seg = 16) {
  const P = [];
  const N = [];
  const U = [];
  const I = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    // a slight barrel bulge in the middle ring
    for (const [y, k] of [[0, 1], [h / 2, 1.12], [h, 1]]) P.push(x * r * k, y, z * r * k), N.push(x, 0, z), U.push(i / seg, y / h);
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      const b = (i + 1) * 3 + j;
      I.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  for (const [y, ny] of [[0, -1], [h, 1]]) {
    const c = P.length / 3;
    P.push(0, y, 0), N.push(0, ny, 0), U.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      P.push(Math.cos(a) * r, y, Math.sin(a) * r), N.push(0, ny, 0), U.push(0.5, 0.5);
    }
    for (let i = 0; i < seg; i++) ny > 0 ? I.push(c, c + 2 + i, c + 1 + i) : I.push(c, c + 1 + i, c + 2 + i);
  }
  return { P, N, U, I };
}

// ---------------------------------------------------------------- glTF 2.0 binary
function glb({ meshes, nodes, rootName, image }) {
  const bin = [];
  let offset = 0;
  const views = [];
  const accessors = [];
  const push = (buf, target) => {
    const pad = (4 - (buf.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...(target ? { target } : {}) });
    bin.push(buf, Buffer.alloc(pad));
    offset += buf.length + pad;
    return views.length - 1;
  };
  const gltfMeshes = meshes.map((m) => {
    const f = (arr) => Buffer.from(new Float32Array(arr).buffer);
    const min = [0, 1, 2].map((i) => Math.min(...m.geo.P.filter((_, j) => j % 3 === i)));
    const max = [0, 1, 2].map((i) => Math.max(...m.geo.P.filter((_, j) => j % 3 === i)));
    const count = m.geo.P.length / 3;
    accessors.push({ bufferView: push(f(m.geo.P), 34962), componentType: 5126, count, type: 'VEC3', min, max });
    const pos = accessors.length - 1;
    accessors.push({ bufferView: push(f(m.geo.N), 34962), componentType: 5126, count, type: 'VEC3' });
    const nor = accessors.length - 1;
    accessors.push({ bufferView: push(f(m.geo.U), 34962), componentType: 5126, count, type: 'VEC2' });
    const uv = accessors.length - 1;
    accessors.push({ bufferView: push(Buffer.from(new Uint16Array(m.geo.I).buffer), 34963), componentType: 5123, count: m.geo.I.length, type: 'SCALAR' });
    return { name: m.name, primitives: [{ attributes: { POSITION: pos, NORMAL: nor, TEXCOORD_0: uv }, indices: accessors.length - 1, material: m.material }] };
  });
  const json = {
    asset: { version: '2.0', generator: 'game-studio sample make-assets.mjs' },
    scene: 0,
    scenes: [{ name: rootName, nodes: nodes.roots }],
    nodes: nodes.list,
    meshes: gltfMeshes,
    materials: nodes.materials,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: 0 }]
  };
  if (image) {
    json.images = [{ bufferView: push(image, null), mimeType: 'image/png' }];
    json.textures = [{ source: 0, sampler: 0 }];
    json.samplers = [{ magFilter: 9728, minFilter: 9987 }];
  }
  const binBuf = Buffer.concat(bin);
  json.buffers[0].byteLength = binBuf.length;
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + js.length + 8 + binBuf.length, 8);
  const ch = (type, data) => {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(data.length, 0);
    h.write(type, 4);
    return Buffer.concat([h, data]);
  };
  return Buffer.concat([header, ch('JSON', js), ch('BIN\0', binBuf)]);
}

writeFileSync(
  join(out, 'crate.glb'),
  glb({
    rootName: 'crate',
    image: wood,
    meshes: [{ name: 'crate', geo: box(1, 1, 1, 0.5), material: 0 }],
    nodes: { roots: [0], list: [{ name: 'crate', mesh: 0 }], materials: [{ name: 'wood', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.8 } }] }
  })
);
writeFileSync(
  join(out, 'barrel.glb'),
  glb({
    rootName: 'barrel',
    meshes: [{ name: 'barrel', geo: cylinder(0.4, 1.1), material: 0 }],
    nodes: { roots: [0], list: [{ name: 'barrel', mesh: 0 }], materials: [{ name: 'red-paint', pbrMetallicRoughness: { baseColorFactor: [0.75, 0.2, 0.15, 1], metallicFactor: 0.3, roughnessFactor: 0.5 } }] }
  })
);
writeFileSync(
  join(out, 'lamp.glb'),
  glb({
    rootName: 'lamp',
    meshes: [
      { name: 'post', geo: box(0.15, 2.4, 0.15, 1.2), material: 0 },
      { name: 'bulb', geo: box(0.4, 0.4, 0.4, 0), material: 1 }
    ],
    nodes: {
      roots: [0],
      list: [{ name: 'lamp', children: [1, 2] }, { name: 'post', mesh: 0 }, { name: 'bulb', mesh: 1, translation: [0, 2.6, 0] }],
      materials: [
        { name: 'iron', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.22, 0.25, 1], metallicFactor: 0.8, roughnessFactor: 0.4 } },
        { name: 'glow', emissiveFactor: [1, 0.85, 0.4], pbrMetallicRoughness: { baseColorFactor: [1, 0.95, 0.7, 1] } }
      ]
    }
  })
);
console.log('wrote', ['crate.glb', 'barrel.glb', 'lamp.glb', 'grass.png'].map((f) => join('assets', f)).join(', '));
