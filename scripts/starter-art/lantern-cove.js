// Lantern Cove's asset files, made in the browser (run by scripts/make-starter-assets.mjs; not part of the game).
//
// WHY files at all (2026-10-17): the web demo's Assets panel was empty for both starters ("No assets yet…"), so the
// part of the editor that lists, shows and swaps files could not be tried. These are the starter's first real files.
// They are painted here with Canvas 2D and built with three.js primitives, so there is nothing to license (MIT like
// the rest), and running this again gives the same bytes for the same code (seeded randomness).
//
// Returns { 'assets/<name>': base64 }. Pictures are JPEG (opaque cloth and wood: a third of the PNG size).
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
const jpeg = (c, q = 0.84) => c.toDataURL('image/jpeg', q).split(',')[1];

// ------------------------------------------------------------------ sails
// UV of the sail in js/props.js: u = 0 at the mast (luff) … 1 at the back edge (leech), v = 0 at the foot … 1 at the
// head. The image's TOP is the head (three flips images on upload). The jib uses only the lower-left part (u < 0.55,
// v < 0.3), so the emblem (middle) shows on the mainsail alone.
// The sail is a triangle: at the emblem's height (v ≈ 0.45) the picture's width covers ~1.8 m of cloth and its
// height 6.2 m, so the emblem is drawn 3.4× wider than tall here to come out round on the sail.
function sail({ cloth, seam, stain, emblem, emblemInk }) {
  seed = 17;
  const S = 512;
  const [c, ctx] = canvas(S, S);
  ctx.fillStyle = cloth;
  ctx.fillRect(0, 0, S, S);
  // Weave: fine cross-hatch noise, so the cloth reads as cloth when the camera is close.
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(60,40,20,0.05)' : 'rgba(255,250,235,0.06)';
    const x = rnd() * S, y = rnd() * S;
    rnd() < 0.5 ? ctx.fillRect(x, y, 3 + rnd() * 5, 1) : ctx.fillRect(x, y, 1, 3 + rnd() * 5);
  }
  // Panels: real sails are sewn from horizontal strips. Each strip a slightly different shade, a doubled seam.
  const strip = 46;
  for (let y = 0, k = 0; y < S; y += strip, k++) {
    ctx.fillStyle = `rgba(${k % 2 ? '255,248,230' : '90,60,30'},${0.03 + rnd() * 0.04})`;
    ctx.fillRect(0, y, S, strip);
    ctx.fillStyle = seam;
    ctx.fillRect(0, y, S, 2);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, y + 5, S, 1);
    ctx.globalAlpha = 1;
    // Stitches along the seam.
    ctx.fillStyle = 'rgba(40,28,16,0.25)';
    for (let x = 4; x < S; x += 7) ctx.fillRect(x, y + 3, 3, 1);
  }
  // Weathering: darker toward the foot (spray, hands) and a few water stains.
  const foot = ctx.createLinearGradient(0, S * 0.55, 0, S);
  foot.addColorStop(0, 'rgba(0,0,0,0)');
  foot.addColorStop(1, stain);
  ctx.fillStyle = foot;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 14; i++) {
    const x = rnd() * S, y = S * 0.35 + rnd() * S * 0.65, r = 12 + rnd() * 40;
    const g = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    g.addColorStop(0, 'rgba(80,60,40,0.07)');
    g.addColorStop(0.6, 'rgba(80,60,40,0.06)');
    g.addColorStop(1, 'rgba(80,60,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Bolt rope along the mast side (left) and the foot (bottom), and a reef band with its points.
  ctx.fillStyle = 'rgba(70,50,30,0.55)';
  ctx.fillRect(0, 0, 7, S);
  ctx.fillRect(0, S - 7, S, 7);
  const reefY = S - 120;
  ctx.fillStyle = 'rgba(70,50,30,0.35)';
  ctx.fillRect(0, reefY, S, 9);
  for (let x = 30; x < S; x += 44) {
    ctx.fillStyle = 'rgba(40,30,20,0.6)';
    ctx.beginPath();
    ctx.arc(x, reefY + 4.5, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,220,200,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, reefY + 7);
    ctx.quadraticCurveTo(x + 4, reefY + 22, x - 2, reefY + 32);
    ctx.stroke();
  }
  // Corner patches (tack bottom-left, clew bottom-right, head top-left), where a sail takes the load.
  ctx.fillStyle = 'rgba(70,50,30,0.16)';
  for (const [x, y, dx, dy] of [[0, S, 1, -1], [S, S, -1, -1], [0, 0, 1, 1]]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dx * 90, y);
    ctx.lineTo(x, y + dy * 90);
    ctx.fill();
  }
  // Emblem: the cove's lantern in a ring, painted on long ago (worn: flecks of cloth over it).
  const ex = S * 0.42, ey = S * 0.55, STRETCH = 3.4;
  ctx.save();
  ctx.translate(ex, ey);
  ctx.scale(STRETCH * 0.62, 0.62); // 0.62: the 62-px ring below becomes 38 px tall
  ctx.strokeStyle = emblem;
  ctx.fillStyle = emblem;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(0, 0, 62, 0, Math.PI * 2);
  ctx.stroke();
  // Lantern: cap, glass, base; a flame of the cloth's own colour inside.
  ctx.beginPath();
  ctx.moveTo(-26, -24); ctx.lineTo(0, -44); ctx.lineTo(26, -24); ctx.closePath();
  ctx.fill();
  ctx.fillRect(-20, -22, 40, 46);
  ctx.fillRect(-28, 26, 56, 9);
  ctx.fillStyle = emblemInk;
  ctx.beginPath();
  ctx.moveTo(0, -14); ctx.quadraticCurveTo(12, 4, 0, 16); ctx.quadraticCurveTo(-12, 4, 0, -14);
  ctx.fill();
  ctx.restore();
  // Wear the emblem: knock small flecks of cloth colour back over it (wide flecks: they are squeezed on the sail too).
  for (let i = 0; i < 900; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 46;
    ctx.fillStyle = cloth;
    ctx.globalAlpha = 0.25 + rnd() * 0.5;
    ctx.fillRect(ex + Math.cos(a) * r * STRETCH, ey + Math.sin(a) * r, (1 + rnd() * 3) * STRETCH, 1 + rnd() * 1.5);
  }
  ctx.globalAlpha = 1;
  return jpeg(c);
}

// ------------------------------------------------------------------ planks (crate, pier, rowboat seats)
// Four boards across the picture, grain running left–right. A box face shows the whole picture, so a crate side gets
// four boards; the long pier planks stretch it along their length, which reads as one long board with grain.
function planks() {
  seed = 29;
  const S = 512, B = S / 4;
  const [c, ctx] = canvas(S, S);
  const tones = [[139, 113, 88], [124, 98, 72], [146, 120, 92], [118, 94, 70]];
  for (let b = 0; b < 4; b++) {
    const [r, g, bl] = tones[b];
    const y0 = b * B;
    const grad = ctx.createLinearGradient(0, y0, 0, y0 + B);
    grad.addColorStop(0, `rgb(${r + 10},${g + 8},${bl + 6})`);
    grad.addColorStop(1, `rgb(${r - 14},${g - 12},${bl - 10})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y0, S, B);
    // Grain: long wavy lines, bunched around a knot.
    const kx = 80 + rnd() * 350, ky = y0 + B * (0.3 + rnd() * 0.4);
    for (let i = 0; i < 26; i++) {
      const yy = y0 + 4 + rnd() * (B - 8);
      ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '50,32,18' : '200,170,130'},${0.1 + rnd() * 0.15})`;
      ctx.lineWidth = 0.8 + rnd() * 1.6;
      ctx.beginPath();
      for (let x = 0; x <= S; x += 8) {
        const d = Math.hypot(x - kx, yy - ky);
        const bend = d < 50 ? ((yy - ky) / (d + 1)) * (50 - d) * 0.5 : 0;
        const y = yy + Math.sin(x * 0.012 + i) * 2.5 + bend;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(60,38,20,0.75)';
    ctx.beginPath();
    ctx.ellipse(kx, ky, 7, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(60,38,20,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(kx, ky, 12, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    // Salt-bleached patches and a lighter worn top edge.
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(215,205,185,${0.04 + rnd() * 0.06})`;
      ctx.fillRect(rnd() * S, y0 + rnd() * B, 40 + rnd() * 120, 6 + rnd() * 16);
    }
    ctx.fillStyle = 'rgba(230,210,180,0.18)';
    ctx.fillRect(0, y0 + 3, S, 2);
    // Gap to the next board, and nail heads near both ends.
    ctx.fillStyle = 'rgba(25,16,10,0.85)';
    ctx.fillRect(0, y0, S, 3);
    for (const x of [26, S - 26]) for (const dy of [0.3, 0.7]) {
      ctx.fillStyle = 'rgba(40,36,34,0.9)';
      ctx.beginPath();
      ctx.arc(x, y0 + B * dy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(120,70,40,0.35)'; // rust run below the nail
      ctx.fillRect(x - 2, y0 + B * dy + 4, 4, 10 + rnd() * 12);
    }
  }
  return jpeg(c, 0.82);
}

// ------------------------------------------------------------------ barrel (glTF)
// Standing on its end (axis Y), 1 m tall, the same size as the code barrel it replaces; js/props.js lays it on its
// side. Staves are coloured one by one (vertex colours, flat across each stave, a dark line at the joints), so it
// needs no texture and stays a few tens of KB.
async function barrel() {
  seed = 41;
  const group = new THREE.Group();
  group.name = 'barrel';
  const profile = [];
  const N = 10;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 bottom … 1 top
    profile.push(new THREE.Vector2(0.36 + 0.075 * Math.sin(t * Math.PI), t - 0.5));
  }
  const STAVES = 16, PER = 3;
  // Smooth normals from the indexed lathe, then split per triangle to colour each stave, then merge back the
  // corners that are the same again (inside one stave): flat colour per stave, round shading, ~4× fewer vertices.
  const lathe = new THREE.LatheGeometry(profile, STAVES * PER).toNonIndexed();
  const pos = lathe.attributes.position, cols = [];
  const tone = [];
  for (let s = 0; s < STAVES; s++) tone.push(0.82 + rnd() * 0.3);
  const base = new THREE.Color(0x7a5434), col = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    // The triangle's centre angle tells which stave (and which third of it) it belongs to.
    const x = (pos.getX(i) + pos.getX(i + 1) + pos.getX(i + 2)) / 3, z = (pos.getZ(i) + pos.getZ(i + 1) + pos.getZ(i + 2)) / 3;
    const seg = Math.floor(((Math.atan2(x, z) + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / (STAVES * PER)));
    const stave = Math.floor(seg / PER) % STAVES, joint = seg % PER === 0;
    col.copy(base).multiplyScalar(tone[stave] * (joint ? 0.62 : 1));
    for (let k = 0; k < 3; k++) cols.push(col.r, col.g, col.b);
  }
  lathe.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const wood = new THREE.MeshStandardMaterial({ name: 'oak', vertexColors: true, roughness: 0.85, metalness: 0 });
  const body = new THREE.Mesh(mergeVertices(lathe, 1e-4), wood);
  body.name = 'staves';
  group.add(body);
  // Heads: planks across each end (three boards), set a little into the staves.
  const headMat = new THREE.MeshStandardMaterial({ name: 'oak-head', color: 0x6e4a2c, roughness: 0.9 });
  for (const y of [-0.47, 0.47]) {
    for (let b = -1; b <= 1; b++) {
      const w = 0.24, len = Math.sqrt(Math.max(0.01, 0.37 ** 2 - (b * w) ** 2)) * 2;
      const board = new THREE.Mesh(new THREE.BoxGeometry(w - 0.012, 0.03, len), headMat);
      board.position.set(b * w, y, 0);
      board.name = 'head-board';
      group.add(board);
    }
  }
  // Iron hoops: two near each end, one pair at the belly.
  const iron = new THREE.MeshStandardMaterial({ name: 'iron', color: 0x2b2826, roughness: 0.5, metalness: 0.7 });
  for (const t of [0.06, 0.2, 0.8, 0.94]) {
    const r = 0.36 + 0.075 * Math.sin(t * Math.PI) + 0.008;
    const hoop = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.045, 48, 1, true), iron);
    hoop.position.y = t - 0.5;
    hoop.name = 'hoop';
    group.add(hoop);
  }
  // Bung: a small dark plug at the belly.
  const bung = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), new THREE.MeshStandardMaterial({ name: 'bung', color: 0x2a1c12, roughness: 0.9 }));
  bung.rotation.x = Math.PI / 2;
  bung.position.set(0, 0, 0.44);
  bung.name = 'bung';
  group.add(bung);

  // Nothing is textured: drop the UVs (a third of the file).
  group.traverse((o) => o.geometry && o.geometry.deleteAttribute('uv'));
  const bytes = await new GLTFExporter().parseAsync(group, { binary: true });
  let s = '';
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function make() {
  return {
    'assets/sail.jpg': sail({ cloth: '#efe4cc', seam: 'rgba(120,96,64,0.45)', stain: 'rgba(90,70,45,0.22)', emblem: '#9c2f25', emblemInk: '#efe4cc' }),
    // A second sail to try "Replace" with: tan-bark red, the old working-boat colour, cream emblem.
    'assets/sail-tanbark.jpg': sail({ cloth: '#a24e2c', seam: 'rgba(60,24,10,0.5)', stain: 'rgba(40,16,8,0.3)', emblem: '#ead9b8', emblemInk: '#a24e2c' }),
    'assets/planks.jpg': planks(),
    'assets/barrel.glb': await barrel(),
  };
}
