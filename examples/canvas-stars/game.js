// Star Basket — a plain <canvas> game with no engine, made to exercise the
// studio's canvas adapter (.studio/adapter.js).
//
// The game keeps a list of things and draws them itself. The lines marked
// "studio" are what an AI agent adds so the editor can work with it: one line
// that hands the things and draw() to the editor, and the placement.json
// loader. Nothing else in the game knows about the studio.
const cv = document.getElementById('cv');
const ctx = cv.getContext('2d');
const W = 390; // world width: laid out in a 390-wide world, scaled to the screen
let scale = 1;
let H = 844;

const load = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = src; });
const [basketImg, starImg, rockImg] = await Promise.all(['assets/basket.svg', 'assets/star.svg', 'assets/rock.svg'].map(load));

// Every thing: centre x, y (world px), angle (radians), scale, unscaled w x h.
const things = [
  { name: 'basket', kind: 'basket', img: basketImg, x: 195, y: 420, angle: 0, scale: 1, w: 80, h: 56 },
  { name: 'star-1', kind: 'star', img: starImg, x: 80, y: 160, angle: 0, scale: 1, w: 40, h: 40, vy: 30 },
  { name: 'star-2', kind: 'star', img: starImg, x: 200, y: 260, angle: 0.3, scale: 1.2, w: 40, h: 40, vy: 22 },
  { name: 'star-3', kind: 'star', img: starImg, x: 310, y: 120, angle: 0, scale: 0.8, w: 40, h: 40, vy: 36 },
  { kind: 'rock', img: rockImg, x: 300, y: 380, angle: 0, scale: 1, w: 64, h: 40 }, // no name -> unstable key
];
const placement = await fetch('./placement.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null); // studio
applyPlacement(things, placement); // studio

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
  scale = Math.min(innerWidth / W, 1.6);
  H = innerHeight / scale;
}
addEventListener('resize', resize);
resize();

function draw() {
  const dpr = cv.width / innerWidth;
  // Base transform: world px -> canvas pixels (centred horizontally). Left in
  // place after the frame, which is what the studio adapter reads.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, ((innerWidth - W * scale) / 2) * dpr, 0);
  ctx.fillStyle = '#16204a';
  ctx.fillRect(0, 0, W, H);
  for (const t of things) {
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.angle);
    ctx.scale(t.scale, t.scale);
    ctx.drawImage(t.img, -t.w / 2, -t.h / 2, t.w, t.h);
    ctx.restore();
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 50) / 1000;
  last = now;
  for (const t of things) {
    if (!t.vy) continue;
    t.y += t.vy * dt;
    t.angle += dt;
    if (t.y > H + 40) t.y = -40;
  }
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

globalThis.studioGame = { things, draw }; // studio: hand the objects to the editor (edit mode only reads them)

/**
 * studio: apply a saved placement.json. Keys follow the canvas adapter's rules
 * (`key` -> `name` -> index, repeats numbered #2, #3). Unknown keys are skipped.
 * `order` (draw order, keys back -> front) puts those things back in that
 * order in the list draw() walks.
 */
function applyPlacement(list, file) {
  if (!file || file.tool !== 'placement' || !file.objects) return;
  const seen = new Map();
  const byKey = new Map();
  list.forEach((t, i) => {
    if (t.studio === false) return;
    const own = t.key || t.name;
    let key = own ? String(own).replace(/[^A-Za-z0-9_:#.\-\/]/g, '_').slice(0, 80) : `path:${i}`;
    if (own) {
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      if (n > 1) key = `${key.slice(0, 76)}#${n}`;
    }
    byKey.set(key, t);
    const e = file.objects[key];
    if (!e || !Array.isArray(e.p)) return;
    [t.x, t.y] = e.p;
    if (typeof e.r === 'number') t.angle = e.r;
    if (typeof e.s === 'number') t.scale = e.s;
  });
  for (const g of Array.isArray(file.order) ? file.order : []) {
    const mine = (g.keys || []).map((k) => [k, byKey.get(k)]).filter((x) => x[1]);
    if (mine.length < 2) continue;
    // Keys from the list position (path:4) or a repeat (#2) change with the
    // order: keep them on the things so the editor finds the same keys.
    for (const [k, t] of mine) if (!t.key && (k.startsWith('path:') || k.includes('#'))) t.key = k;
    const slots = mine.map((x) => list.indexOf(x[1])).sort((a, b) => a - b);
    mine.forEach(([, t], i) => (list[slots[i]] = t));
  }
}
