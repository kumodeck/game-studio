/**
 * Test harness: a minimal stand-in for the editor's input bridge (src/bridge/), so the three.js adapter can be
 * driven with REAL mouse and touch events in a headless browser before the bridge and shell exist.
 * It is not shipped to users; the real bridge replaces it. It follows the same interaction rules:
 *
 *   - press and release on an object without moving (< 6 px) selects it (pickNear: 12 px mouse / 28 px touch);
 *     pressing the same spot again (within 10 px, after 350 ms) selects the next candidate behind it
 *   - dragging anywhere else — even over an object — orbits the view (objects never move by accident);
 *     right / middle / shift-drag and two fingers pan; two-finger pinch and the wheel zoom
 *   - the handles next to the selection move / rotate / lift / scale it; one gesture (press → release) = one undo step
 *   - Ctrl/⌘+Z undo, Ctrl+Y or Ctrl/⌘+Shift+Z redo — undo applies the absolute pose from before the step (setPose)
 *
 * Load it after boot.js, anywhere in the page:  <script type="module" src="…/dev/harness.js"></script>
 * Then `window.__studioHarness` exposes { ready, adapter, state, save() } for the test runner.
 */

import { whenThreeReady } from '../adapter.js';

const MOVE_PX = 6;
const HANDLE = 48;
const GAP = 8;

const H = { ready: null, adapter: null, selected: null, undo: [], redo: [], baseline: new Map(), log: [] };
window.__studioHarness = H;

H.ready = whenThreeReady().then((adapter) => {
  H.adapter = adapter;
  const boot = globalThis.__studioThree;
  const start = () => {
    for (const it of adapter.begin()) H.baseline.set(it.key, it.pose);
    setup(adapter);
    return true;
  };
  // In edit-on-load mode wait for the hold (first frame, or studio.ready()); begin() otherwise holds right away.
  if (!boot.editOnLoad || boot.held) return start();
  return new Promise((resolve) => boot.on((t) => { if (t === 'hold') resolve(start()); }));
});

function setup(adapter) {
  const canvas = adapter.renderer.domElement;
  const layer = document.createElement('div');
  layer.setAttribute('data-studio-keep', '');
  layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000';
  document.body.appendChild(layer);
  const mk = (name, glyph) => {
    const b = document.createElement('div');
    b.dataset.handle = name;
    b.textContent = glyph;
    b.style.cssText = `position:fixed;width:${HANDLE}px;height:${HANDLE}px;margin:${-HANDLE / 2}px 0 0 ${-HANDLE / 2}px;border-radius:50%;background:#fff;color:#222;font:22px/48px system-ui;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.35);display:none;pointer-events:auto;touch-action:none;user-select:none`;
    layer.appendChild(b);
    return b;
  };
  const handles = { move: mk('move', '✥'), rotate: mk('rotate', '⟲'), lift: mk('lift', '↕'), scale: mk('scale', '⤢') };
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;border:2px solid #ffcc00;display:none;pointer-events:none';
  layer.appendChild(box);
  H.handles = handles;

  const ndcOf = (x, y) => {
    const r = canvas.getBoundingClientRect();
    return [((x - r.left) / r.width) * 2 - 1, 1 - ((y - r.top) / r.height) * 2];
  };

  function place() {
    const a = H.selected && adapter.anchor(H.selected);
    const show = !!(a && a.onScreen);
    box.style.display = show && a.rectPx ? 'block' : 'none';
    for (const h of Object.values(handles)) h.style.display = 'none';
    if (!show) return;
    if (a.rectPx) Object.assign(box.style, { left: `${a.rectPx[0]}px`, top: `${a.rectPx[1]}px`, width: `${a.rectPx[2] - a.rectPx[0]}px`, height: `${a.rectPx[3] - a.rectPx[1]}px` });
    const list = ['move', ...(a.rotatable ? ['rotate'] : []), 'lift', ...(a.scalable ? ['scale'] : [])];
    const right = a.rectPx ? a.rectPx[2] : a.centerPx[0];
    const left = a.rectPx ? a.rectPx[0] : a.centerPx[0];
    let x = right + GAP + HANDLE / 2;
    if (x + HANDLE / 2 > innerWidth) x = left - GAP - HANDLE / 2;
    if (x - HANDLE / 2 < 0) x = innerWidth - HANDLE / 2 - 4;
    const total = list.length * HANDLE + (list.length - 1) * GAP;
    let y0 = Math.min(Math.max(a.centerPx[1] - total / 2, 4), innerHeight - total - 4);
    list.forEach((n, i) => Object.assign(handles[n].style, { display: 'block', left: `${x}px`, top: `${y0 + HANDLE / 2 + i * (HANDLE + GAP)}px` }));
  }
  adapter.subscribe((t) => t === 'frame' && place());
  H.place = place;

  // ------------------------------------------------------------- one gesture = one undo step
  function commit(key, from, to) {
    if (!from || !to || JSON.stringify(from) === JSON.stringify(to)) return;
    H.undo.push({ key, from, to });
    if (H.undo.length > 200) H.undo.shift();
    H.redo.length = 0;
  }
  H.doUndo = () => {
    const s = H.undo.pop();
    if (!s) return;
    adapter.setPose(s.key, s.from);
    H.redo.push(s);
    H.selected = s.key;
  };
  H.doRedo = () => {
    const s = H.redo.pop();
    if (!s) return;
    adapter.setPose(s.key, s.to);
    H.undo.push(s);
    H.selected = s.key;
  };

  // ------------------------------------------------------------- pointers (window capture: the game never sees them)
  const ptrs = new Map(); // id → { x, y, sx, sy, type, button, shift }
  let gesture = null; // { kind: 'tap'|'orbit'|'pan'|'pinch'|'handle', … }
  let lastTap = null;

  function swallow(e) {
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  }
  addEventListener('pointerdown', (e) => {
    swallow(e);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, type: e.pointerType, button: e.button, shift: e.shiftKey });
    const h = e.target && e.target.dataset && e.target.dataset.handle;
    if (h && H.selected) {
      const key = H.selected;
      const a = adapter.anchor(key);
      gesture = { kind: 'handle', handle: h, key, from: a.pose, startX: e.clientX, startY: e.clientY, center: a.centerPx, liftPx: a.liftPx, offset: [e.clientX - a.centerPx[0], e.clientY - a.centerPx[1]], ang: Math.atan2(-(e.clientY - a.centerPx[1]), e.clientX - a.centerPx[0]), applied: 1, y0: null };
      if (h === 'move') adapter.grab(key, ...ndcOf(a.centerPx[0], a.centerPx[1]));
      return;
    }
    if (ptrs.size === 2) {
      const [p, q] = [...ptrs.values()];
      gesture = { kind: 'pinch', d: Math.hypot(p.x - q.x, p.y - q.y), mx: (p.x + q.x) / 2, my: (p.y + q.y) / 2 };
    } else if (ptrs.size === 1) {
      gesture = { kind: 'tap', pan: e.button === 1 || e.button === 2 || e.shiftKey };
    }
  }, true);

  addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    swallow(e);
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (!gesture) return;
    const r = canvas.getBoundingClientRect();
    if (gesture.kind === 'handle') {
      const g = gesture;
      if (g.handle === 'move') adapter.drag(g.key, ...ndcOf(e.clientX - g.offset[0], e.clientY - g.offset[1]));
      else if (g.handle === 'rotate') {
        const ang = Math.atan2(-(e.clientY - g.center[1]), e.clientX - g.center[0]);
        let d = ang - g.ang;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        g.ang = ang;
        adapter.rotate(g.key, d); // counter-clockwise on screen = +yaw (seen from above)
      } else if (g.handle === 'lift') {
        // keep the finger-to-object offset: the height follows the finger by the screen size of 1 m at grab time
        const want = g.from.p[1] + -(e.clientY - g.startY) / Math.max(1, g.liftPx);
        const cur = adapter.anchor(g.key).pose.p[1];
        adapter.nudgeY(g.key, Math.max(-5, Math.min(5, want - cur)));
      } else if (g.handle === 'scale') {
        const total = Math.exp(((e.clientX - g.startX) - (e.clientY - g.startY)) / 200);
        adapter.scale(g.key, total / g.applied);
        g.applied = total;
      }
      return;
    }
    if (gesture.kind === 'tap' && Math.hypot(p.x - p.sx, p.y - p.sy) >= MOVE_PX) gesture.kind = gesture.pan ? 'pan' : 'orbit';
    if (gesture.kind === 'orbit') adapter.view.orbit(dx / r.width, dy / r.height);
    else if (gesture.kind === 'pan') adapter.view.pan(dx / r.width, dy / r.height);
    else if (gesture.kind === 'pinch' && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      adapter.view.pan((mx - gesture.mx) / r.width, (my - gesture.my) / r.height);
      if (gesture.d > 0 && d > 0) adapter.view.zoom(d / gesture.d, ...ndcOf(mx, my));
      Object.assign(gesture, { d, mx, my });
    }
  }, true);

  function up(e) {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    swallow(e);
    ptrs.delete(e.pointerId);
    const g = gesture;
    if (g && g.kind === 'handle') {
      adapter.release && adapter.release(g.key);
      commit(g.key, g.from, adapter.anchor(g.key)?.pose);
      H.log.push({ end: true, key: g.key, handle: g.handle });
      gesture = null;
      place();
      return;
    }
    if (g && g.kind === 'tap' && e.type === 'pointerup') {
      const now = performance.now();
      const radius = p.type === 'touch' ? 28 : 12;
      const keys = adapter.pickNear(...ndcOf(p.x, p.y), radius);
      let pick = keys[0] ?? null;
      if (lastTap && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 10 && keys.includes(H.selected)) {
        // same spot again: the next candidate behind the current one (a quick double tap keeps the current one)
        pick = now - lastTap.t < 350 ? H.selected : keys[(keys.indexOf(H.selected) + 1) % keys.length];
      }
      H.selected = pick;
      lastTap = { x: p.x, y: p.y, t: now };
      H.log.push({ select: pick, candidates: keys });
      place();
    }
    if (ptrs.size === 0) gesture = null;
    else if (g && g.kind === 'pinch') gesture = { kind: 'orbit' };
  }
  addEventListener('pointerup', up, true);
  addEventListener('pointercancel', up, true);
  for (const t of ['click', 'mousedown', 'mouseup', 'touchstart', 'touchmove', 'touchend', 'contextmenu']) addEventListener(t, (e) => { e.stopPropagation(); if (t !== 'touchstart' && e.cancelable) e.preventDefault(); }, { capture: true, passive: false });
  addEventListener('wheel', (e) => {
    swallow(e);
    adapter.view.zoom(Math.pow(1.0015, -e.deltaY), ...ndcOf(e.clientX, e.clientY));
  }, { capture: true, passive: false });
  addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = (e.key || '').toLowerCase();
    const isZ = k === 'z' || e.code === 'KeyZ';
    const isY = k === 'y' || e.code === 'KeyY';
    if (isZ && !e.shiftKey) (swallow(e), H.doUndo());
    else if ((isZ && e.shiftKey) || (isY && e.ctrlKey)) (swallow(e), H.doRedo());
  }, true);
}

// ------------------------------------------------------------- save: the placement.json the shell would write
const r3 = (x) => Math.round(x * 1000) / 1000; // 1 mm
const r4 = (x) => Math.round(x * 10000) / 10000; // 1e-4 rad
const rs = (s) => (Array.isArray(s) ? s.map(r4) : r4(s));
H.save = () => {
  const objects = {};
  for (const it of H.adapter.list()) {
    const was = H.baseline.get(it.key);
    if (!was || JSON.stringify(was) === JSON.stringify(it.pose)) continue;
    const e = { p: it.pose.p.map(r3), r: r4(it.pose.r), s: rs(it.pose.s), was: { p: was.p.map(r3), r: r4(was.r), s: rs(was.s) }, label: it.label };
    if (it.unstable) e.unstable = true;
    objects[it.key] = e;
  }
  return { version: 1, tool: 'placement', dim: '3d', space: 'local', objects };
};
