// Garden Board — a plain-JavaScript game that moves <img> elements with CSS,
// made to exercise the studio's DOM adapter (.studio/adapter.js).
//
// State lives in JS; render() writes it to the elements every frame. The lines
// marked "studio" are what an AI agent adds for the editor: one line handing
// the state to the editor, and the placement.json loader.
const board = document.getElementById('board');
const view = document.getElementById('view');

function piece(src, x, y, extra = {}) {
  const el = document.createElement('img');
  el.src = src;
  el.alt = '';
  board.appendChild(el);
  return { el, x, y, angle: 0, scale: 1, ...extra };
}

const pieces = [
  piece('assets/house.svg', 300, 110, { name: 'house' }),
  piece('assets/tree.svg', 90, 120, { name: 'tree' }),
  piece('assets/tree.svg', 160, 150, { name: 'tree', scale: 0.8 }), // same name -> "tree#2"
  piece('assets/flower.svg', 230, 300, { name: 'flower' }),
  piece('assets/rock.svg', 110, 320), // no name -> unstable key
  piece('assets/bee.svg', 60, 260, { name: 'bee', vx: 40 }),
];
const placement = await fetch('./placement.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null); // studio
applyPlacement(pieces, placement); // studio

function fit() {
  // Fit the 400x400 board to the screen (the game's own layout, not the studio's).
  board.style.transform = `scale(${Math.min(innerWidth / 420, innerHeight / 420, 1.5)})`;
}
addEventListener('resize', fit);
fit();

function render() {
  for (const p of pieces) {
    p.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${p.angle}rad) scale(${p.scale})`;
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(now - last, 50) / 1000;
  last = now;
  for (const p of pieces) {
    if (!p.vx) continue;
    p.x += p.vx * dt;
    if (p.x > 430) p.x = -30;
  }
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

globalThis.studioGame = { pieces, render, board, view }; // studio: hand the state to the editor

/** studio: apply placement.json with the DOM adapter's key rules (`key` -> `name` -> element id -> index). */
function applyPlacement(list, file) {
  if (!file || file.tool !== 'placement' || !file.objects) return;
  const seen = new Map();
  list.forEach((t, i) => {
    if (t.studio === false) return;
    const own = t.key || t.name || t.el.dataset.studioKey || t.el.id;
    let key = own ? String(own).replace(/[^A-Za-z0-9_:#.\-\/]/g, '_').slice(0, 80) : `path:${i}`;
    if (own) {
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      if (n > 1) key = `${key.slice(0, 76)}#${n}`;
    }
    const e = file.objects[key];
    if (!e || !Array.isArray(e.p)) return;
    [t.x, t.y] = e.p;
    if (typeof e.r === 'number') t.angle = e.r;
    if (typeof e.s === 'number') t.scale = e.s;
  });
}
