// Firefly Ruins' asset files, made in the browser (run by scripts/make-starter-assets.mjs; not part of the game).
//
// WHY files at all (2026-10-17): the web demo's Assets panel was empty for both starters, so listing, showing and
// swapping files could not be tried. These pictures replace four of the game's code-painted ones. They follow the
// starter's one light (a low sun on the RIGHT: dark cool body, warm rim on the right edge, moss on top) and are
// painted at 3× the size they have in the world (the game loads them with resolution 3), a little richer than the
// load-time painters could afford. Seeded randomness: the same code gives the same bytes. Nothing to license.
//
// The size in world px, the anchor and every spot the game hangs something on (the bell's rope, the lantern's fire
// box, the boat's lamp pole) are the same as js/paint.js, so a file and its painted fallback are interchangeable.
//
// Returns { 'assets/<name>': base64 PNG }.
const RES = 3;
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function paint(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * RES);
  c.height = Math.ceil(h * RES);
  const ctx = c.getContext('2d');
  ctx.scale(RES, RES);
  fn(ctx, w, h);
  return c.toDataURL('image/png').split(',')[1];
}

const STONE_DARK = '#353c45', STONE = '#5d6670';

function speckle(ctx, x0, y0, x1, y1, n, dark, light) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = rnd() < 0.5 ? dark : light;
    ctx.fillRect(x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0), 0.5 + rnd() * 1.4, 0.5 + rnd());
  }
}

/** Cool stone body, warm rim on the right, ground shade, pores, a crack or two (clipped to `path`). */
function stone(ctx, path, x0, y0, x1, y1) {
  ctx.save();
  ctx.clip(path);
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, STONE_DARK);
  g.addColorStop(0.55, STONE);
  g.addColorStop(0.9, '#8d8a84');
  g.addColorStop(1, '#d59a5c');
  ctx.fillStyle = g;
  ctx.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
  const v = ctx.createLinearGradient(0, y0, 0, y1);
  v.addColorStop(0, 'rgba(255,220,170,0.08)');
  v.addColorStop(1, 'rgba(10,18,26,0.5)');
  ctx.fillStyle = v;
  ctx.fillRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
  speckle(ctx, x0, y0, x1, y1, (x1 - x0) * (y1 - y0) * 0.05, 'rgba(20,24,30,0.22)', 'rgba(210,210,195,0.14)');
  ctx.strokeStyle = 'rgba(18,22,28,0.5)';
  ctx.lineWidth = 0.7;
  for (let i = 0; i < 2; i++) {
    let x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0) * 0.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) ctx.lineTo((x += (rnd() - 0.5) * 6), (y += 2 + rnd() * 4));
    ctx.stroke();
  }
  ctx.restore();
}

/** Moss cushions on top surfaces: dark under, lit tufts on top. */
function moss(ctx, spots, size) {
  for (const [x, y] of spots) {
    for (let k = 0; k < 40 * size; k++) {
      const a = rnd() * Math.PI, r = rnd() * 9 * size;
      const px = x + Math.cos(a) * r * 1.4, py = y - Math.sin(a) * r * 0.5;
      ctx.fillStyle = rnd() < 0.45 ? '#3f5326' : rnd() < 0.6 ? '#6f8a3a' : '#b5c262';
      ctx.beginPath();
      ctx.arc(px, py, 0.6 + rnd() * 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ------------------------------------------------------------------ bell (52×60, anchor 0.5, 0: hangs by its rope)
function bell() {
  seed = 5;
  return paint(52, 60, (ctx, w) => {
    // Rope and crown loop.
    ctx.strokeStyle = '#3a2a1a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(26, 0); ctx.lineTo(26, 7); ctx.stroke();
    ctx.strokeStyle = '#2a3a32';
    ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(26, 9.5, 3, Math.PI, 0); ctx.stroke();
    const p = new Path2D();
    p.moveTo(14, 12); p.quadraticCurveTo(26, 6, 38, 12); p.quadraticCurveTo(42, 36, 50, 50); p.lineTo(2, 50);
    p.quadraticCurveTo(10, 36, 14, 12); p.closePath();
    ctx.save();
    ctx.clip(p);
    // Bronze under green patina: dark on the shadow side, a hot sunlit band on the right.
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#22302a'); g.addColorStop(0.45, '#4d6b55'); g.addColorStop(0.72, '#7f9a72');
    g.addColorStop(0.82, '#e7bb72'); g.addColorStop(0.9, '#8a6a3a'); g.addColorStop(1, '#3d5444');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, 60);
    // Patina streaks running down from the shoulder (rain), bare bronze rubbed through near the lip.
    for (let i = 0; i < 26; i++) {
      const x = 4 + rnd() * 44;
      ctx.strokeStyle = rnd() < 0.6 ? 'rgba(120,175,140,0.35)' : 'rgba(30,45,38,0.35)';
      ctx.lineWidth = 0.6 + rnd();
      ctx.beginPath(); ctx.moveTo(x, 10 + rnd() * 6); ctx.lineTo(x + (rnd() - 0.5) * 2, 18 + rnd() * 26); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,140,70,0.35)';
    ctx.fillRect(0, 45, w, 5);
    // Inscription band: a raised ring with small cast marks.
    ctx.fillStyle = 'rgba(20,30,26,0.45)';
    ctx.fillRect(0, 20, w, 1.2); ctx.fillRect(0, 27, w, 1.2);
    for (let x = 12; x < 42; x += 4) { ctx.fillStyle = 'rgba(20,30,26,0.5)'; ctx.fillRect(x, 22.5, 1.6, 3); }
    ctx.fillStyle = 'rgba(20,28,24,0.45)';
    ctx.fillRect(0, 40, w, 2.5);
    speckle(ctx, 0, 10, w, 50, 260, 'rgba(15,22,18,0.25)', 'rgba(170,220,180,0.18)');
    ctx.restore();
    // Lip highlight and the clapper.
    ctx.strokeStyle = 'rgba(255,205,140,0.7)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(30, 50); ctx.lineTo(50, 50); ctx.stroke();
    ctx.fillStyle = '#2c2a26';
    ctx.beginPath(); ctx.arc(26, 53, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,200,130,0.5)';
    ctx.beginPath(); ctx.arc(27.5, 52, 1.3, 0, Math.PI * 2); ctx.fill();
  });
}

// ------------------------------------------------------------------ stone lantern (70×128, anchor 0.5, 1)
// The fire box opening is at the same place as js/paint.js (x 24–46, y 33–51): the game puts its flame glow at
// 86 px above the foot, i.e. y 42 here.
function lantern() {
  seed = 11;
  return paint(70, 128, (ctx, w, h) => {
    const part = (x0, y0, x1, y1, inset = 0) => {
      const p = new Path2D();
      p.moveTo(x0 + inset, y0); p.lineTo(x1 - inset, y0); p.lineTo(x1, y1); p.lineTo(x0, y1); p.closePath();
      stone(ctx, p, x0, y0, x1, y1);
      // A chiselled top edge catching the light.
      ctx.fillStyle = 'rgba(255,215,160,0.22)';
      ctx.fillRect(x0 + inset, y0, x1 - x0 - inset * 2, 1);
    };
    part(12, h - 14, 58, h);
    part(16, h - 22, 54, h - 14, 2);
    part(26, 66, 44, h - 22, 1);
    // Carved rings on the post.
    ctx.fillStyle = 'rgba(15,18,24,0.45)';
    for (const y of [76, 96]) ctx.fillRect(26, y, 18, 1.4);
    part(8, 54, 62, 66, 3);
    const box = new Path2D(); box.rect(16, 28, 38, 26);
    stone(ctx, box, 16, 28, 54, 54);
    // The opening: warm inside (the flame lives here), soot above it.
    const glow = ctx.createRadialGradient(35, 44, 1, 35, 42, 14);
    glow.addColorStop(0, '#ffcf7a'); glow.addColorStop(0.35, '#b55a22'); glow.addColorStop(1, '#1b1410');
    ctx.fillStyle = glow;
    ctx.fillRect(24, 33, 22, 18);
    ctx.fillStyle = 'rgba(10,8,6,0.5)';
    ctx.fillRect(24, 33, 22, 3);
    // Side windows (a sliver of light on the shadowed left one).
    ctx.fillStyle = '#1b1410'; ctx.fillRect(18, 36, 3, 12); ctx.fillRect(49, 36, 3, 12);
    ctx.fillStyle = 'rgba(255,170,90,0.6)'; ctx.fillRect(50, 37, 1.2, 10);
    const roof = new Path2D();
    roof.moveTo(1, 31); roof.quadraticCurveTo(20, 26, 35, 6); roof.quadraticCurveTo(50, 26, 69, 31);
    roof.lineTo(57, 33); roof.lineTo(13, 33); roof.closePath();
    stone(ctx, roof, 1, 6, 69, 33);
    // Upturned eaves and the jewel on top.
    ctx.fillStyle = '#5d6670';
    ctx.beginPath(); ctx.arc(35, 6, 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,200,140,0.6)';
    ctx.beginPath(); ctx.arc(37, 5, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,200,140,0.45)'; ctx.fillRect(60, 30, 9, 1.2);
    moss(ctx, [[16, 29], [54, 29], [35, 10], [14, 55], [52, h - 14]], 0.6);
  });
}

// ------------------------------------------------------------------ boat (150×46, anchor 0.5, 0.7)
// Same outline as js/paint.js; the lamp pole ends at (22, 0), where the game hangs its glow.
function boat({ top, bottom, plank, rim, stripe }) {
  seed = 23;
  return paint(150, 46, (ctx, w, h) => {
    const p = new Path2D();
    p.moveTo(0, 8); p.quadraticCurveTo(20, 14, 40, 14); p.lineTo(112, 14); p.quadraticCurveTo(136, 12, 150, 4);
    p.quadraticCurveTo(140, 34, 112, 40); p.lineTo(40, 40); p.quadraticCurveTo(10, 36, 0, 8); p.closePath();
    ctx.save();
    ctx.clip(p);
    const g = ctx.createLinearGradient(0, 10, 0, 40);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Strakes (planks) following the sheer, each with a light upper edge and grain.
    for (let y = 19; y < 42; y += 5.5) {
      ctx.strokeStyle = plank;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y - 6); ctx.quadraticCurveTo(75, y + 1, w, y - 9); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,220,170,0.12)';
      ctx.beginPath(); ctx.moveTo(0, y - 5); ctx.quadraticCurveTo(75, y + 2, w, y - 8); ctx.stroke();
    }
    for (let i = 0; i < 90; i++) {
      ctx.fillStyle = 'rgba(20,12,8,0.18)';
      ctx.fillRect(rnd() * w, 14 + rnd() * 26, 3 + rnd() * 8, 0.5);
    }
    if (stripe) { ctx.fillStyle = stripe; ctx.fillRect(0, 17, w, 1.6); }
    // Sun on the right (stern-to-bow light), wet dark waterline at the bottom.
    const sun = ctx.createLinearGradient(0, 0, w, 0);
    sun.addColorStop(0, 'rgba(0,0,0,0.25)'); sun.addColorStop(0.7, 'rgba(0,0,0,0)'); sun.addColorStop(1, rim);
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8,12,18,0.45)';
    ctx.fillRect(0, 36, w, 6);
    // Gunwale: a capping rail with a bright top.
    ctx.fillStyle = 'rgba(30,20,12,0.8)';
    ctx.fillRect(0, 13, w, 2.4);
    ctx.fillStyle = 'rgba(255,205,140,0.6)';
    ctx.fillRect(0, 12.6, w, 1);
    ctx.restore();
    // Thwart ends and a coil of rope at the bow.
    ctx.fillStyle = '#3a2818';
    for (const x of [62, 96]) ctx.fillRect(x, 11, 3, 3);
    ctx.strokeStyle = '#b89b6a';
    ctx.lineWidth = 1.1;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.ellipse(124, 10.5, 6 - k * 1.6, 2.2 - k * 0.5, 0, 0, Math.PI * 2); ctx.stroke(); }
    // The lamp pole at the stern, with its little crossbar.
    ctx.strokeStyle = '#2a1d14';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(26, 14); ctx.lineTo(22, 0); ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(19, 3); ctx.lineTo(25, 2); ctx.stroke();
  });
}

// ------------------------------------------------------------------ banner cloth (laid on the moving cloth)
// The picture covers the whole cloth: top = the pole's hanging edge, bottom = the free edge (fringe, in alpha).
// The ring sits where the old code drew it (middle column, 3/8 of the way down) so it folds with the cloth.
function banner() {
  seed = 31;
  return paint(54, 112, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#8a2a20'); g.addColorStop(1, '#6e1f1a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h - 8);
    // Weave: vertical threads, a few slubs.
    for (let x = 0; x < w; x += 1.2) { ctx.fillStyle = `rgba(${rnd() < 0.5 ? '40,10,8' : '200,80,60'},0.12)`; ctx.fillRect(x, 0, 0.5, h - 8); }
    for (let i = 0; i < 40; i++) { ctx.fillStyle = 'rgba(255,140,110,0.12)'; ctx.fillRect(rnd() * w, rnd() * (h - 8), 2 + rnd() * 4, 0.5); }
    // The sleeve the pole goes through, gold borders, a worn patch.
    ctx.fillStyle = 'rgba(30,8,6,0.45)'; ctx.fillRect(0, 0, w, 6);
    ctx.fillStyle = '#d8a24a';
    ctx.fillRect(0, 7, w, 1.4); ctx.fillRect(3, 7, 1.2, h - 16); ctx.fillRect(w - 4.2, 7, 1.2, h - 16); ctx.fillRect(0, h - 11, w, 2);
    ctx.fillStyle = 'rgba(216,162,74,0.55)';
    for (let y = 12; y < h - 14; y += 6) { ctx.fillRect(1, y, 1, 2); ctx.fillRect(w - 2, y, 1, 2); }
    // The old sigil: a gold ring and dot, with three rays below (a lantern's light).
    const cx = w / 2, cy = h * 0.375;
    ctx.strokeStyle = '#e2b25a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 10, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.arc(cx, cy, 13.5, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#e2b25a';
    ctx.beginPath(); ctx.arc(cx, cy, 3.4, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 1.4;
    for (const a of [-0.35, 0, 0.35]) { ctx.beginPath(); ctx.moveTo(cx + Math.sin(a) * 17, cy + Math.cos(a) * 17); ctx.lineTo(cx + Math.sin(a) * 30, cy + Math.cos(a) * 30); ctx.stroke(); }
    // Wear: thread-coloured flecks over the gold.
    for (let i = 0; i < 160; i++) { ctx.fillStyle = 'rgba(120,35,28,0.7)'; ctx.fillRect(cx - 16 + rnd() * 32, cy - 16 + rnd() * 50, 0.7, 0.7); }
    // Fringe: gold tassels hanging from the bottom edge.
    for (let x = 2; x < w - 1; x += 3) {
      const len = 5 + rnd() * 3;
      ctx.strokeStyle = rnd() < 0.5 ? '#d8a24a' : '#a87a34';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, h - 9); ctx.lineTo(x + (rnd() - 0.5), h - 9 + len); ctx.stroke();
    }
  });
}

export async function make() {
  return {
    'assets/bell.png': bell(),
    'assets/lantern.png': lantern(),
    'assets/boat.png': boat({ top: '#9a6a40', bottom: '#2e1f16', plank: 'rgba(20,12,8,0.45)', rim: 'rgba(255,190,120,0.35)' }),
    // A second boat to try "Replace" with: lacquered vermilion with a gold line.
    'assets/boat-lacquer.png': boat({ top: '#c0432c', bottom: '#4a1410', plank: 'rgba(40,6,4,0.4)', rim: 'rgba(255,200,120,0.4)', stripe: 'rgba(230,180,90,0.9)' }),
    'assets/banner.png': banner(),
  };
}
