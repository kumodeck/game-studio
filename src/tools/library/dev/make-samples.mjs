// Writes two small sample games for trying the library tool:
//   <out>/three-garden  — three.js (textures on meshes, two .glb models, sounds)
//   <out>/pixi-pond     — PixiJS v8 (sprites, a spritesheet atlas, sounds)
//
// Every asset is generated here (PNG, GLB, WAV) so the samples carry no
// third-party files and no binary blobs live in the repository. Each sample
// is built to show every library badge:
//   used      loaded at start / used by an object
//   codeOnly  named in code, only loaded later (win sound after a round)
//   unused    in the folder, never named or loaded (old-*.png)
//   missing   named in code, no such file (assets/ghost.png)
// plus a file whose name is built at runtime ('assets/' + 'dyn' + '.png'):
// not in the code scan, but loaded, so it is "used".
//
// Usage: node make-samples.mjs <out-dir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------- PNG
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** draw(x, y) -> [r, g, b, a] (0..255) */
function png(w, h, draw) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a = 255] = draw(x, y);
      raw.set([r, g, b, a], y * (w * 4 + 1) + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function treePng(leaf) {
  return png(64, 64, (x, y) => {
    if (x >= 28 && x < 36 && y >= 40) return [110, 72, 40, 255];
    if (disc(32, 26, 22)(x, y)) return [...hex(leaf), 255];
    return [0, 0, 0, 0];
  });
}
const checker = (a, b, size = 8) => (x, y) => ((Math.floor(x / size) + Math.floor(y / size)) % 2 ? hex(a) : hex(b));
function fishPng(body) {
  return png(64, 40, (x, y) => {
    const inBody = ((x - 26) / 22) ** 2 + ((y - 20) / 14) ** 2 <= 1;
    const inTail = x > 44 && Math.abs(y - 20) < (x - 44) * 0.9;
    if (disc(16, 16, 3)(x, y)) return [20, 20, 20, 255];
    return inBody || inTail ? [...hex(body), 255] : [0, 0, 0, 0];
  });
}
/** 4 coin frames in a row, 32x32 each */
function coinSheet() {
  return png(128, 32, (x, y) => {
    const f = Math.floor(x / 32);
    const lx = x % 32;
    const rx = [13, 9, 4, 9][f];
    const inside = ((lx - 16) / rx) ** 2 + ((y - 16) / 13) ** 2 <= 1;
    return inside ? [240, 190 - f * 10, 40, 255] : [0, 0, 0, 0];
  });
}
const coinAtlas = {
  frames: Object.fromEntries([0, 1, 2, 3].map((i) => [`coin-${i}`, { frame: { x: i * 32, y: 0, w: 32, h: 32 }, sourceSize: { w: 32, h: 32 }, spriteSourceSize: { x: 0, y: 0, w: 32, h: 32 } }])),
  animations: { spin: ['coin-0', 'coin-1', 'coin-2', 'coin-3'] },
  meta: { image: 'coins.png', format: 'RGBA8888', size: { w: 128, h: 32 }, scale: '1' },
};

// ---------------------------------------------------------------- WAV
function wav(freq, secs = 0.25) {
  const rate = 22050;
  const n = Math.floor(rate * secs);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 9000 * (1 - i / n)), 44 + i * 2);
  return b;
}

// ---------------------------------------------------------------- GLB
/** Box or pyramid mesh with one coloured PBR material. */
function glb(shape, color, name) {
  let pos;
  let idx;
  if (shape === 'box') {
    const s = 0.5;
    pos = []; idx = [];
    const norms = [];
    const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    axes.forEach((n, f) => {
      const [u, v] = n[0] ? [[0, 1, 0], [0, 0, 1]] : n[1] ? [[0, 0, 1], [1, 0, 0]] : [[1, 0, 0], [0, 1, 0]];
      const base = pos.length / 3;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(...[0, 1, 2].map((k) => (n[k] + u[k] * a + v[k] * b) * s + (k === 1 ? s : 0)));
        norms.push(...n);
      }
      const sgn = n[0] + n[1] + n[2];
      idx.push(...(sgn > 0 ? [base, base + 1, base + 2, base, base + 2, base + 3] : [base, base + 2, base + 1, base, base + 3, base + 2]));
    });
    return pack(pos, norms, idx, color, name);
  }
  // pyramid: square base + apex, flat normals
  const P = [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5]];
  const apex = [0, 1.1, 0];
  pos = []; idx = [];
  const norms = [];
  const tri = (a, b, c) => {
    const u = a.map((v, i) => b[i] - v);
    const w = a.map((v, i) => c[i] - v);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(...n);
    const base = pos.length / 3;
    for (const p of [a, b, c]) { pos.push(...p); norms.push(...n.map((x) => x / l)); }
    idx.push(base, base + 1, base + 2);
  };
  for (let i = 0; i < 4; i++) tri(P[i], apex, P[(i + 1) % 4]);
  tri(P[0], P[1], P[2]);
  tri(P[0], P[2], P[3]);
  return pack(pos, norms, idx, color, name);
}
function pack(pos, norms, idx, color, name) {
  const p = Buffer.from(new Float32Array(pos).buffer);
  const n = Buffer.from(new Float32Array(norms).buffer);
  let ib = Buffer.from(new Uint16Array(idx).buffer);
  if (ib.length % 4) ib = Buffer.concat([ib, Buffer.alloc(4 - (ib.length % 4))]);
  const bin = Buffer.concat([p, n, ib]);
  const min = [0, 1, 2].map((k) => Math.min(...pos.filter((_, i) => i % 3 === k)));
  const max = [0, 1, 2].map((k) => Math.max(...pos.filter((_, i) => i % 3 === k)));
  const gltf = {
    asset: { version: '2.0', generator: 'game-studio sample' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [...hex(color).map((c) => c / 255), 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: p.length, target: 34962 },
      { buffer: 0, byteOffset: p.length, byteLength: n.length, target: 34962 },
      { buffer: 0, byteOffset: p.length + n.length, byteLength: idx.length * 2, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max },
      { bufferView: 1, componentType: 5126, count: norms.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: idx.length, type: 'SCALAR' },
    ],
  };
  let json = Buffer.from(JSON.stringify(gltf));
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const head = Buffer.alloc(12);
  head.write('glTF', 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(json.length, 0); jh.write('JSON', 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(bin.length, 0); bh.write('BIN\0', 4);
  return Buffer.concat([head, jh, json, bh, bin]);
}

// ---------------------------------------------------------------- games
const THREE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Garden — three.js example</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#9fd4ff}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"}}</script>
</head><body><script type="module" src="game.js"></script></body></html>
`;
const THREE_JS = `import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd4ff);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 7, 11);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xffffff, 0x557744, 2.5));

const tex = new THREE.TextureLoader();
const grass = tex.load('assets/grass.png');
grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
grass.repeat.set(6, 6);
grass.colorSpace = THREE.SRGBColorSpace;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshLambertMaterial({ map: grass }));
ground.rotation.x = -Math.PI / 2;
ground.name = 'ground';
scene.add(ground);

const treeTex = tex.load('assets/tree.png');
treeTex.colorSpace = THREE.SRGBColorSpace;
const treeMat = new THREE.MeshBasicMaterial({ map: treeTex, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
for (const [i, x] of [[1, -3], [2, 3]]) {
  const t = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), treeMat);
  t.position.set(x, 1.2, -1);
  t.name = 'tree-0' + i;
  scene.add(t);
}
// a texture whose name is built at runtime (not visible to a text scan)
const dynTex = tex.load('assets/' + 'dyn' + '.png');
const sign = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.1), new THREE.MeshLambertMaterial({ map: dynTex }));
sign.position.set(0, 0.5, 2);
sign.name = 'sign';
scene.add(sign);

const gltf = new GLTFLoader();
gltf.load('assets/rock.glb', (g) => { g.scene.name = 'rock'; g.scene.position.set(-1, 0, 1.5); scene.add(g.scene); });
gltf.load('assets/crate.glb', (g) => {
  g.scene.name = 'crate';
  g.scene.userData.studioAsset = 'assets/crate.glb'; // the creator's explicit link
  g.scene.position.set(1.5, 0, 1.5);
  scene.add(g.scene);
});

const pop = new Audio('assets/pop.wav');
pop.preload = 'auto';
function onWin() {
  new Audio('assets/win.wav').play(); // only after a round: "only in code"
  tex.load('assets/ghost.png'); // a file that was never added: "missing"
}
window.onWin = onWin;

renderer.setAnimationLoop((t) => {
  sign.rotation.y = t / 1000;
  renderer.render(scene, camera);
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
`;

const PIXI_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pond — PixiJS sample</title>
<style>html,body{margin:0;height:100%;overflow:hidden;background:#123}canvas{display:block}</style>
<script type="importmap">{"imports":{"pixi.js":"https://cdn.jsdelivr.net/npm/pixi.js@8.21.0/dist/pixi.min.mjs"}}</script>
</head><body><script type="module" src="game.js"></script></body></html>
`;
const PIXI_JS = `import { Application, Assets, Sprite, AnimatedSprite, TilingSprite } from 'pixi.js';

const app = new Application();
await app.init({ resizeTo: window, background: 0x123344 });
document.body.appendChild(app.canvas);

const [water, fish, fish2, coins] = await Promise.all([
  Assets.load('assets/water.png'),
  Assets.load('assets/fish.png'),
  Assets.load('assets/fish-blue.png'),
  Assets.load('assets/coins.json'),
]);
const bg = new TilingSprite({ texture: water, width: app.screen.width, height: app.screen.height });
bg.label = 'water';
app.stage.addChild(bg);
for (const [i, t, x, y] of [[1, fish, 120, 140], [2, fish, 260, 260], [3, fish2, 200, 380]]) {
  const s = new Sprite(t);
  s.label = 'fish-' + i;
  s.anchor.set(0.5);
  s.position.set(x, y);
  s.scale.set(1.5);
  app.stage.addChild(s);
}
const coin = new AnimatedSprite(coins.animations.spin);
coin.label = 'coin';
coin.anchor.set(0.5);
coin.position.set(300, 120);
coin.scale.set(2);
coin.animationSpeed = 0.15;
coin.play();
app.stage.addChild(coin);

const pop = new Audio('assets/pop.wav');
pop.preload = 'auto';
function onWin() {
  new Audio('assets/win.wav').play();
  Assets.load('assets/ghost.png');
}
globalThis.onWin = onWin;

app.ticker.add((tk) => { for (const c of app.stage.children) if (c.label?.startsWith('fish')) c.x += Math.sin(performance.now() / 600) * 0.3 * tk.deltaTime; });
`;

export function makeSamples(out) {
  const write = (p, data) => {
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, data);
  };
  const g3 = join(out, 'three-garden');
  write(join(g3, 'index.html'), THREE_HTML);
  write(join(g3, 'game.js'), THREE_JS);
  write(join(g3, 'assets/grass.png'), png(64, 64, checker(0x5fae4a, 0x6dbd55)));
  write(join(g3, 'assets/tree.png'), treePng(0x3f9b3a));
  write(join(g3, 'assets/tree-autumn.png'), treePng(0xe0782a));
  write(join(g3, 'assets/dyn.png'), png(32, 32, checker(0xffcc00, 0x333333, 4)));
  write(join(g3, 'assets/old-sky.png'), png(64, 32, (x, y) => [120 + y, 170 + y, 255]));
  write(join(g3, 'assets/rock.glb'), glb('pyramid', 0x8a8f99, 'rock'));
  write(join(g3, 'assets/crate.glb'), glb('box', 0xb07a3c, 'crate'));
  write(join(g3, 'assets/pop.wav'), wav(660));
  write(join(g3, 'assets/win.wav'), wav(880, 0.5));
  // never listed: dependencies and build output
  write(join(g3, 'node_modules/some-lib/logo.png'), png(8, 8, () => [255, 0, 0]));
  write(join(g3, 'dist/old.png'), png(8, 8, () => [0, 0, 255]));

  const g2 = join(out, 'pixi-pond');
  write(join(g2, 'index.html'), PIXI_HTML);
  write(join(g2, 'game.js'), PIXI_JS);
  write(join(g2, 'assets/water.png'), png(64, 64, (x, y) => [30, 90 + ((x + y) % 32), 140]));
  write(join(g2, 'assets/fish.png'), fishPng(0xff8a3d));
  write(join(g2, 'assets/fish-blue.png'), fishPng(0x3db2ff));
  write(join(g2, 'assets/fish-gold.png'), fishPng(0xffd400));
  write(join(g2, 'assets/coins.png'), coinSheet());
  write(join(g2, 'assets/coins.json'), JSON.stringify(coinAtlas, null, 2));
  write(join(g2, 'assets/old-bg.png'), png(64, 64, checker(0x334455, 0x223344)));
  write(join(g2, 'assets/boat.glb'), glb('box', 0xcc4444, 'boat'));
  write(join(g2, 'assets/pop.wav'), wav(520));
  write(join(g2, 'assets/win.wav'), wav(780, 0.5));
  return { three: g3, pixi: g2 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: node make-samples.mjs <out-dir>');
    process.exit(1);
  }
  console.log(JSON.stringify(makeSamples(out)));
}
