// Firefly Ruins — every picture is painted at load with Canvas 2D (no image files, nothing to license).
//
// One light for the whole scene: a low sun on the RIGHT (≈ x 930 of the 1280-wide world). So every painter uses the
// same three steps: a dark cool body colour, a warm rim on the right edge, moss on the top surfaces. That shared
// light is what makes separately painted things read as one place.
//
// Painters draw at 2× (crisp on phones and when the editor zooms in) and return a Texture whose size in world px
// is the size you asked for. Randomness is seeded: the ruins look the same on every load and in every screenshot.
import { CanvasSource, Texture } from 'pixi.js';

export const SUN = { x: 930, y: 470 };
const RES = 2;

let seed = 7;
export const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const reseed = (s) => { seed = s; };

/** Paint into a w×h (world px) texture. fn(ctx, w, h) draws in world px. */
export function paint(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * RES);
  c.height = Math.ceil(h * RES);
  const ctx = c.getContext('2d');
  ctx.scale(RES, RES);
  fn(ctx, w, h);
  return new Texture({ source: new CanvasSource({ resource: c, resolution: RES }) });
}

// ------------------------------------------------------------------ small painting tools
const STONE = '#5d6670', STONE_DARK = '#353c45', MOSS = '#6f8a3a', MOSS_LIGHT = '#a9b85a';

/** Fill a path with a cool body, warm rim on the right, darker bottom; then speckles (pores, lichen). */
function stoneFill(ctx, path, x0, y0, x1, y1, { body = STONE, rim = 0.55 } = {}) {
  ctx.save();
  ctx.clip(path);
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, STONE_DARK);
  g.addColorStop(0.55, body);
  g.addColorStop(1, '#8a8a86');
  ctx.fillStyle = g;
  ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
  // Ground shade toward the bottom.
  const v = ctx.createLinearGradient(0, y0, 0, y1);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(10,18,26,0.45)');
  ctx.fillStyle = v;
  ctx.fillRect(x0 - 2, y0 - 2, x1 - x0 + 4, y1 - y0 + 4);
  // Speckles.
  for (let i = 0; i < (x1 - x0) * (y1 - y0) * 0.02; i++) {
    const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(20,24,30,0.18)' : 'rgba(200,205,190,0.12)';
    ctx.fillRect(x, y, 1 + rnd() * 2, 1 + rnd() * 1.5);
  }
  // Cracks: a few dark zigzags.
  ctx.strokeStyle = 'rgba(20,24,30,0.45)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 3; i++) {
    let x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0) * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 5; k++) ctx.lineTo((x += (rnd() - 0.5) * 14), (y += 6 + rnd() * 10));
    ctx.stroke();
  }
  // Warm rim light on the sun side: a soft band hugging the right edge (drawn with a blurred, offset stroke).
  // Shifting the outline 3 px left puts the stroke of the left edge outside the clip (invisible) and keeps the
  // right and top edges' strokes inside: a rim exactly where the sun hits.
  ctx.lineWidth = 6;
  ctx.strokeStyle = `rgba(255, 190, 110, ${rim})`;
  ctx.translate(-3, 0);
  ctx.stroke(path);
  ctx.restore();
}

/** Moss clumps along the top edge of a shape: points [[x, y], …] on the top surface. */
function moss(ctx, pts, amount = 1) {
  // Many tiny dots in a band along the surface (not big blobs: those read as lily pads), darker underneath,
  // lit gold-green on top; a few short hanging strands.
  for (const [x, y] of pts) {
    const n = Math.floor((18 + rnd() * 22) * amount);
    for (let i = 0; i < n; i++) {
      const px = x + (rnd() - 0.5) * 26 * amount, py = y + (rnd() - 0.3) * 7;
      const r = 1 + rnd() * 2.6;
      const lit = rnd();
      ctx.fillStyle = lit > 0.7 ? 'rgba(178,190,96,0.95)' : lit > 0.35 ? 'rgba(104,126,52,0.95)' : 'rgba(58,74,34,0.95)';
      ctx.beginPath();
      ctx.ellipse(px, py, r * 1.3, r, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(80,100,44,0.75)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 2; i++) {
      if (rnd() < 0.4) continue;
      const sx = x + (rnd() - 0.5) * 16;
      ctx.beginPath();
      ctx.moveTo(sx, y + 2);
      ctx.quadraticCurveTo(sx + 2, y + 8, sx + (rnd() - 0.5) * 3, y + 6 + rnd() * 14 * amount);
      ctx.stroke();
    }
  }
}

const blob = (ctx, pts) => {
  const p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const [x, y] = pts[i], [px, py] = pts[i - 1];
    p.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
  }
  p.closePath();
  return p;
};

// ------------------------------------------------------------------ the pictures
// Each returns { tex, ax, ay }: ax/ay = the anchor (0..1) at the object's foot, so `y` in the code is where it stands.

export function paintArch() {
  reseed(11);
  const w = 320, h = 360;
  return { tex: paint(w, h, (ctx) => {
    const p = new Path2D();
    // Left pier, round arch, right pier broken short (a ruin, not a monument).
    p.moveTo(18, h); p.lineTo(26, 120); p.lineTo(70, 112);
    p.arc(160, 150, 90, Math.PI * 1.08, Math.PI * 1.62);
    p.lineTo(196, 58); p.lineTo(212, 72); p.lineTo(232, 66); p.lineTo(250, 92);
    p.lineTo(266, 98); p.lineTo(272, 150); p.lineTo(290, 152); p.lineTo(296, h);
    p.lineTo(236, h); p.lineTo(236, 200);
    p.arc(160, 210, 76, -0.08, Math.PI + 0.08, true);
    p.lineTo(84, h); p.closePath();
    stoneFill(ctx, p, 18, 58, 296, h);
    // Block joints.
    ctx.save(); ctx.clip(p);
    ctx.strokeStyle = 'rgba(25,30,36,0.35)'; ctx.lineWidth = 1.4;
    for (let y = 130; y < h; y += 34) { ctx.beginPath(); ctx.moveTo(0, y + rnd() * 4); ctx.lineTo(w, y + rnd() * 4); ctx.stroke(); }
    for (let i = 0; i < 9; i++) { const a = Math.PI * (1.08 + i * 0.065); ctx.beginPath(); ctx.moveTo(160 + Math.cos(a) * 76, 210 + Math.sin(a) * 76); ctx.lineTo(160 + Math.cos(a) * 92, 150 + Math.sin(a) * 92); ctx.stroke(); }
    ctx.restore();
    moss(ctx, [[40, 116], [70, 112], [110, 68], [150, 60], [196, 60], [228, 68], [262, 100], [282, 152]], 1.2);
  }), ax: 0.5, ay: 1 };
}

export function paintGiantHead() {
  reseed(23);
  const w = 280, h = 250;
  return { tex: paint(w, h, (ctx) => {
    // A colossal stone face sunk to the cheekbones, tilted, eyes closed. Calm, old, huge.
    const head = blob(ctx, [[20, h], [14, 150], [30, 80], [80, 30], [150, 14], [215, 34], [258, 90], [268, 160], [262, h], [140, h + 4]]);
    stoneFill(ctx, head, 10, 14, 270, h, { body: '#66707a', rim: 0.7 });
    ctx.save(); ctx.clip(head);
    const line = (pts, wdt = 3, col = 'rgba(28,32,40,0.55)') => { ctx.strokeStyle = col; ctx.lineWidth = wdt; ctx.lineCap = 'round'; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); };
    // Face, carved in soft planes: shade under the brow, closed lids as dark crescents, a long nose with its lit
    // right side and shadowed left, lips just above the waterline. Shading, not outlines, so it reads as stone.
    const shade = (x, y, rx, ry, a, col) => { const g = ctx.createRadialGradient(x, y, 0, x, y, rx); g.addColorStop(0, col); g.addColorStop(1, 'rgba(20,24,32,0)'); ctx.save(); ctx.translate(x, y); ctx.scale(1, ry / rx); ctx.rotate(a); ctx.translate(-x, -y); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rx, 0, Math.PI * 2); ctx.fill(); ctx.restore(); };
    shade(96, 126, 42, 20, 0, 'rgba(18,22,30,0.55)');   // left eye socket
    shade(192, 120, 40, 19, 0, 'rgba(18,22,30,0.45)');  // right eye socket
    line([[70, 128], [96, 137], [122, 128]], 3.2, 'rgba(14,16,22,0.7)');
    line([[166, 123], [192, 132], [216, 122]], 3.2, 'rgba(14,16,22,0.7)');
    line([[66, 104], [98, 96], [128, 104]], 7, 'rgba(210,190,160,0.18)'); // brow ridges catch a little light
    line([[160, 100], [192, 92], [222, 102]], 7, 'rgba(240,200,150,0.3)');
    // Nose: shadow plane on the left, lit plane on the right.
    ctx.fillStyle = 'rgba(16,20,28,0.42)';
    ctx.beginPath(); ctx.moveTo(140, 112); ctx.lineTo(126, 184); ctx.lineTo(142, 192); ctx.lineTo(146, 118); ctx.fill();
    ctx.fillStyle = 'rgba(255,196,130,0.28)';
    ctx.beginPath(); ctx.moveTo(146, 114); ctx.lineTo(162, 182); ctx.lineTo(150, 192); ctx.lineTo(144, 120); ctx.fill();
    shade(140, 196, 22, 8, 0, 'rgba(14,16,22,0.6)');    // under the nose
    line([[110, 224], [126, 218], [140, 221], [154, 217], [172, 224]], 3, 'rgba(14,16,22,0.6)');
    shade(140, 236, 30, 8, 0, 'rgba(14,16,22,0.35)');
    // Lit cheek on the sun side.
    const g = ctx.createRadialGradient(220, 150, 0, 220, 150, 70);
    g.addColorStop(0, 'rgba(255,190,120,0.35)'); g.addColorStop(1, 'rgba(255,190,120,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.restore();
    moss(ctx, [[60, 50], [100, 26], [150, 16], [196, 26], [232, 52], [40, 92]], 1.4);
  }), ax: 0.5, ay: 0.97 };
}

export function paintPillar(tall) {
  reseed(tall ? 31 : 37);
  const w = 74, h = tall ? 270 : 150;
  return { tex: paint(w, h, (ctx) => {
    const p = new Path2D();
    const top = tall ? [[10, 28], [22, 18], [34, 26], [48, 8], [64, 20]] : [[10, 22], [26, 30], [40, 12], [64, 24]];
    p.moveTo(6, h); top.forEach(([x, y]) => p.lineTo(x, y)); p.lineTo(68, h); p.closePath();
    stoneFill(ctx, p, 6, 8, 68, h);
    // Fluting: vertical grooves.
    ctx.save(); ctx.clip(p);
    for (let x = 16; x < 64; x += 10) { ctx.fillStyle = 'rgba(20,26,32,0.25)'; ctx.fillRect(x, 0, 2, h); ctx.fillStyle = 'rgba(230,220,200,0.08)'; ctx.fillRect(x + 2, 0, 2, h); }
    ctx.restore();
    // Base block.
    const b = new Path2D(); b.rect(0, h - 22, w, 22);
    stoneFill(ctx, b, 0, h - 22, w, h);
    moss(ctx, top.map(([x, y]) => [x, y + 4]), 0.9);
  }), ax: 0.5, ay: 1 };
}

export function paintStairs() {
  reseed(41);
  const w = 230, h = 64;
  return { tex: paint(w, h, (ctx) => {
    for (let i = 0; i < 3; i++) {
      const p = new Path2D();
      const inset = i * 26, y = h - (i + 1) * 20;
      p.rect(inset, y, w - inset * 2, 20 + 2);
      stoneFill(ctx, p, inset, y, w - inset, y + 22, { rim: 0.4 });
      ctx.fillStyle = 'rgba(230,215,185,0.22)'; ctx.fillRect(inset, y, w - inset * 2, 2); // lit tread edge
    }
    moss(ctx, [[30, h - 20], [190, h - 22], [70, h - 40]], 0.7);
  }), ax: 0.5, ay: 1 };
}

export function paintStone(k) {
  reseed(50 + k);
  const w = k ? 120 : 150, h = k ? 70 : 90;
  return { tex: paint(w, h, (ctx) => {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI + (i / 12) * Math.PI;
      pts.push([w / 2 + Math.cos(a) * (w / 2 - 6) * (0.85 + rnd() * 0.15), h + Math.sin(a) * (h - 6) * (0.8 + rnd() * 0.2)]);
    }
    pts.push([w - 4, h], [4, h]);
    const p = blob(ctx, pts);
    stoneFill(ctx, p, 0, 0, w, h, { body: '#5a6168' });
    moss(ctx, [[w * 0.3, h * 0.22], [w * 0.5, h * 0.12], [w * 0.7, h * 0.2]], 1.1);
  }), ax: 0.5, ay: 0.98 };
}

export function paintUrn() {
  reseed(61);
  const w = 52, h = 70;
  return { tex: paint(w, h, (ctx) => {
    const p = new Path2D();
    p.moveTo(18, 4); p.lineTo(34, 4); p.quadraticCurveTo(30, 12, 33, 16);
    p.bezierCurveTo(56, 26, 52, 58, 36, h); p.lineTo(16, h); p.bezierCurveTo(0, 58, -4, 26, 19, 16);
    p.quadraticCurveTo(22, 12, 18, 4); p.closePath();
    ctx.save(); ctx.clip(p);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#4a2c22'); g.addColorStop(0.6, '#8a4f36'); g.addColorStop(1, '#e09a62');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(30,20,16,0.5)'; ctx.fillRect(0, 30, w, 3); ctx.fillRect(0, 50, w, 2);
    ctx.restore();
  }), ax: 0.5, ay: 1 };
}

export function paintLanternBody() {
  reseed(71);
  const w = 70, h = 128;
  return { tex: paint(w, h, (ctx) => {
    const part = (x0, y0, x1, y1, inset = 0) => { const p = new Path2D(); p.moveTo(x0 + inset, y0); p.lineTo(x1 - inset, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.closePath(); stoneFill(ctx, p, x0, y0, x1, y1, { rim: 0.5 }); };
    part(14, h - 16, 56, h);          // foot
    part(26, 64, 44, h - 16);         // post
    part(10, 54, 60, 66);             // fire box floor
    // Fire box with an opening (the flame sits in it; drawn by the game as a glow).
    const box = new Path2D(); box.rect(16, 28, 38, 26);
    stoneFill(ctx, box, 16, 28, 54, 54);
    ctx.fillStyle = '#1b1410'; ctx.fillRect(24, 33, 22, 18);
    const roof = new Path2D(); roof.moveTo(2, 30); roof.lineTo(35, 6); roof.lineTo(68, 30); roof.lineTo(56, 32); roof.lineTo(14, 32); roof.closePath();
    stoneFill(ctx, roof, 2, 6, 68, 32);
    ctx.fillStyle = '#5d6670'; ctx.beginPath(); ctx.arc(35, 6, 5, 0, Math.PI * 2); ctx.fill();
    moss(ctx, [[18, 28], [52, 28], [35, 9]], 0.6);
  }), ax: 0.5, ay: 1 };
}

export function paintTrunk() {
  reseed(81);
  const w = 160, h = 300;
  return { tex: paint(w, h, (ctx) => {
    const p = new Path2D();
    p.moveTo(50, h); p.bezierCurveTo(70, 220, 62, 140, 74, 60);
    p.lineTo(40, 20); p.lineTo(48, 14); p.lineTo(80, 48); p.lineTo(98, 0); p.lineTo(106, 4); p.lineTo(92, 70);
    p.bezierCurveTo(96, 150, 92, 220, 118, h); p.closePath();
    ctx.save(); ctx.clip(p);
    const g = ctx.createLinearGradient(40, 0, 120, 0);
    g.addColorStop(0, '#20201c'); g.addColorStop(0.6, '#4b3f33'); g.addColorStop(1, '#c88d58');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(15,12,10,0.35)'; ctx.lineWidth = 1.5;
    for (let i = 0; i < 26; i++) { const x = 52 + rnd() * 60; ctx.beginPath(); ctx.moveTo(x, h); ctx.bezierCurveTo(x + 6, h * 0.6, x - 6, h * 0.4, x + (rnd() - 0.5) * 20, rnd() * h * 0.3); ctx.stroke(); }
    ctx.restore();
    // Roots spreading on the ground.
    ctx.fillStyle = '#2a251f';
    for (const [x, d] of [[34, -1], [134, 1], [20, -1]]) { ctx.beginPath(); ctx.moveTo(70, h - 10); ctx.quadraticCurveTo(x + 10 * d, h - 8, x, h); ctx.lineTo(80, h); ctx.fill(); }
  }), ax: 0.5, ay: 1 };
}

/** The crown: leaf clusters, dark inside, gold where the sun reaches (right/top), a few sky holes. */
export function paintCanopy() {
  reseed(91);
  const w = 380, h = 280;
  return { tex: paint(w, h, (ctx) => {
    const blobs = [];
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd());
      blobs.push([w / 2 + Math.cos(a) * r * (w / 2 - 40), h / 2 + Math.sin(a) * r * (h / 2 - 34) * 0.9, 26 + rnd() * 30]);
    }
    blobs.sort((a, b) => a[0] - b[0]);
    for (const [x, y, r] of blobs) {
      const lit = Math.max(0, (x - w * 0.35) / (w * 0.65)) * 0.8 + Math.max(0, (h * 0.5 - y) / h) * 0.6;
      // A dark core, then many small leaf clusters on top, lighter toward the upper right of each blob.
      ctx.fillStyle = '#1b2a1f';
      ctx.beginPath(); ctx.ellipse(x, y, r * 0.8, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
      for (let k = 0; k < 34; k++) {
        const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
        const lx = x + Math.cos(a) * d, ly = y + Math.sin(a) * d * 0.85;
        const l = Math.min(1, lit * 0.8 + Math.max(0, (lx - x) / r + (y - ly) / r) * 0.35);
        ctx.fillStyle = `rgb(${34 + l * 170 | 0}, ${52 + l * 130 | 0}, ${32 + l * 40 | 0})`;
        ctx.beginPath(); ctx.ellipse(lx, ly, 3 + rnd() * 5, 2 + rnd() * 3, rnd() * 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    // Leaf speckle on the lit side.
    for (let i = 0; i < 500; i++) {
      const x = w * 0.3 + rnd() * w * 0.7, y = rnd() * h;
      ctx.fillStyle = `rgba(250, 210, 120, ${0.1 + rnd() * 0.25})`;
      ctx.fillRect(x, y, 2, 1.5);
    }
    ctx.globalCompositeOperation = 'destination-in';
    const m = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.55);
    m.addColorStop(0, 'rgba(0,0,0,1)'); m.addColorStop(1, 'rgba(0,0,0,0.9)');
    ctx.fillStyle = m; ctx.fillRect(0, 0, w, h);
  }), ax: 0.5, ay: 0.5 };
}

export function paintBellFrame() {
  reseed(101);
  const w = 120, h = 190;
  return { tex: paint(w, h, (ctx) => {
    const wood = (x, y, ww, hh) => { const g = ctx.createLinearGradient(x, 0, x + ww, 0); g.addColorStop(0, '#241b14'); g.addColorStop(0.7, '#5a4330'); g.addColorStop(1, '#b07a48'); ctx.fillStyle = g; ctx.fillRect(x, y, ww, hh); };
    wood(14, 20, 12, h - 20); wood(94, 20, 12, h - 20);
    wood(4, 14, 112, 12);
    ctx.fillStyle = '#2e2620'; ctx.beginPath(); ctx.moveTo(0, 16); ctx.lineTo(60, 0); ctx.lineTo(120, 16); ctx.lineTo(116, 20); ctx.lineTo(4, 20); ctx.fill();
    ctx.fillStyle = 'rgba(255,190,120,0.5)'; ctx.fillRect(116, 14, 2, 12);
    moss(ctx, [[20, 4], [100, 4]], 0.5);
  }), ax: 0.5, ay: 1 };
}

export function paintBell() {
  const w = 52, h = 60;
  return { tex: paint(w, h, (ctx) => {
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(26, 10); ctx.stroke();
    const p = new Path2D();
    p.moveTo(14, 12); p.quadraticCurveTo(26, 6, 38, 12); p.quadraticCurveTo(42, 36, 50, 50); p.lineTo(2, 50); p.quadraticCurveTo(10, 36, 14, 12); p.closePath();
    ctx.save(); ctx.clip(p);
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#2c3b34'); g.addColorStop(0.55, '#5e7b62'); g.addColorStop(0.8, '#d8b06a'); g.addColorStop(1, '#5e7b62');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(20,28,24,0.4)'; ctx.fillRect(0, 40, w, 3);
    ctx.restore();
    ctx.fillStyle = '#2c2a26'; ctx.beginPath(); ctx.arc(26, 53, 4, 0, Math.PI * 2); ctx.fill();
  }), ax: 0.5, ay: 0 };
}

export function paintBoat() {
  reseed(111);
  const w = 150, h = 46;
  return { tex: paint(w, h, (ctx) => {
    const p = new Path2D();
    p.moveTo(0, 8); p.quadraticCurveTo(20, 14, 40, 14); p.lineTo(112, 14); p.quadraticCurveTo(136, 12, 150, 4);
    p.quadraticCurveTo(140, 34, 112, 40); p.lineTo(40, 40); p.quadraticCurveTo(10, 36, 0, 8); p.closePath();
    ctx.save(); ctx.clip(p);
    const g = ctx.createLinearGradient(0, 10, 0, 40);
    g.addColorStop(0, '#9a6a40'); g.addColorStop(1, '#2e1f16');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(20,12,8,0.4)';
    for (let y = 20; y < 40; y += 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y - 1); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,200,130,0.55)'; ctx.fillRect(0, 13, w, 2);
    ctx.restore();
    // A small paper lantern on a pole at the stern.
    ctx.strokeStyle = '#2a1d14'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(26, 14); ctx.lineTo(22, -0); ctx.stroke();
  }), ax: 0.5, ay: 0.7 };
}

/** One reed clump: thin blades. Drawn as separate blade textures so each can bend in the wind. */
export function paintBlade(len, tint) {
  return { tex: paint(10, len, (ctx) => {
    const g = ctx.createLinearGradient(0, 0, 0, len);
    g.addColorStop(0, tint); g.addColorStop(1, '#1e2a1c');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.moveTo(5, 0); ctx.quadraticCurveTo(8, len * 0.5, 7, len); ctx.lineTo(3, len); ctx.quadraticCurveTo(2, len * 0.5, 5, 0); ctx.fill();
    ctx.fillStyle = '#6b4a2c';
    if (len > 70) { ctx.beginPath(); ctx.ellipse(5, len * 0.12, 3, 9, 0, 0, Math.PI * 2); ctx.fill(); } // cattail head
  }), ax: 0.5, ay: 1 };
}

/** Soft round glow (additive sprites: lantern flame, fireflies, sun). */
export function glowTexture(size = 64, inner = 'rgba(255,230,170,1)', outer = 'rgba(255,150,60,0)') {
  return paint(size, size, (ctx) => {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner); g.addColorStop(0.25, inner.replace(/[\d.]+\)$/, '0.55)')); g.addColorStop(1, outer);
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  });
}
