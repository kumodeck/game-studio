// Test stand-in for the studio's edit script, used ONLY by the 2D adapter
// browser tests (test/adapters-2d.browser.mjs).
//
// WHY it exists: the example 2D adapters must be checked end to end (list,
// pick, drag a handle, rotate, scale, undo/redo, save placement.json) while
// the real bridge (src/bridge + src/core) is being built in parallel. This file
// implements just enough of the contract for that:
//   - window.studio / window.__gameStudio with register2D() and ready()
//   - time freezing by holding the game's requestAnimationFrame callbacks
//   - the Port2D -> editor maths (pick, anchor, drag in parent space, rotate,
//     scale, edit view) and a tiny handle overlay driven by Pointer Events, so
//     mouse and touch go through the same code as in the real bridge
// It is deliberately small and is NOT the product. When src/bridge lands, the
// browser test should load the real edit script instead and this file goes.
(function () {
  'use strict';
  if (window.__gameStudio) return;

  // ------------------------------------------------------------------ time
  // Hold the game's rAF callbacks while frozen; the studio keeps the real one.
  const realRaf = window.requestAnimationFrame.bind(window);
  const realCancel = window.cancelAnimationFrame.bind(window);
  let frozen = false;
  let held = new Map(); // id -> callback, queued while frozen
  let nextHeld = 1e9;
  let framesSeen = 0;
  let readyCalled = false;
  window.requestAnimationFrame = function (cb) {
    if (frozen) { const id = ++nextHeld; held.set(id, cb); return id; }
    // A callback requested before freeze() but fired after it must not run:
    // otherwise the game advances one more frame after the edit view opened.
    return realRaf((t) => {
      if (frozen) { held.set(++nextHeld, cb); return; }
      framesSeen++;
      cb(t);
    });
  };
  window.cancelAnimationFrame = function (id) { if (!held.delete(id)) realCancel(id); };
  const time = {
    get frozen() { return frozen; },
    freeze() { frozen = true; },
    thaw() {
      frozen = false;
      const cbs = [...held.values()];
      held = new Map();
      for (const cb of cbs) window.requestAnimationFrame(cb);
    },
    raf: realRaf,
    cancelRaf: realCancel,
    firstFrame() {
      return new Promise((res) => {
        const check = () => (readyCalled || framesSeen > 1 ? res() : realRaf(check));
        check();
      });
    },
  };

  // ------------------------------------------------------------------ global API
  const ports = [];
  const studio = {
    version: 1,
    ready() { readyCalled = true; },
    attach() {},
    registerAdapter() { throw new Error('test stub: registerAdapter is not supported, use register2D'); },
    register2D(p) { ports.push(p); },
    core: { time, loads: { entries: () => [], on: () => () => {} } },
  };
  window.__gameStudio = studio;
  if (!('studio' in window)) window.studio = studio;

  // ------------------------------------------------------------------ small maths
  // Affine matrices are [a, b, c, d, e, f]: X = a*x + c*y + e, Y = b*x + d*y + f.
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const invLinear = (m, dx, dy) => {
    const det = m[0] * m[3] - m[1] * m[2] || 1e-12;
    return [(m[3] * dx - m[2] * dy) / det, (-m[1] * dx + m[0] * dy) / det];
  };
  const round = (v, step) => Math.round(v / step) * step;
  const norm = (a) => { a = ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; return a === -Math.PI ? Math.PI : a; };
  const clone = (p) => JSON.parse(JSON.stringify(p));
  const sOf = (pose) => (Array.isArray(pose.s) ? pose.s[0] : pose.s ?? 1);

  // ------------------------------------------------------------------ driver
  let port = null;
  let items = [];
  const was = new Map(); // key -> pose at begin()
  let sel = null;
  const undo = [];
  const redo = [];
  const view = { x: 0, y: 0, zoom: 1 };
  let overlay = null;
  const events = [];

  function findPort() {
    for (const p of ports) {
      try {
        const v = typeof p === 'function' ? p() : p;
        if (v) return v;
      } catch (e) { events.push(`port error: ${e.message}`); }
    }
    return null;
  }

  // Games often build the scene after the engine starts drawing (textures are
  // loaded asynchronously after app.init()). Freezing at the very first frame
  // would catch an empty stage, so wait until objects exist, then two more
  // frames so the game has applied its placement.json too.
  async function untilObjects() {
    const frame = () => new Promise((r) => realRaf(r));
    for (let i = 0; i < 300; i++) {
      if (port.objects().length) break;
      await frame();
    }
    await frame();
    await frame();
  }

  function list() {
    items = port.objects().map((o) => ({
      key: o.key, label: o.label ?? o.key, kinds: o.kinds || [], group: o.group, unstable: !!o.unstable,
      rotatable: o.rotatable !== false, scalable: o.scalable !== false, pose: port.get(o.key),
    }));
    return items;
  }

  function anchor(key) {
    const pose = port.get(key);
    const m = port.parentToScreen(key);
    const b = port.bounds(key);
    if (!pose || !m) return null;
    const center = apply(m, pose.p[0], pose.p[1]);
    return { center, rect: b || undefined, size: b ? Math.max(b.w, b.h) : 0, pose, visible: true };
  }

  function pickNear(x, y, r) {
    const hits = [];
    for (const it of items) {
      const b = port.bounds(it.key);
      if (!b) continue;
      if (x >= b.x - r && x <= b.x + b.w + r && y >= b.y - r && y <= b.y + b.h + r) hits.push([b.w * b.h, it.key]);
    }
    return hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]);
  }

  function setPose(key, pose) {
    port.set(key, clone(pose));
    port.render();
    drawHandles();
    return port.get(key);
  }

  function applyView() {
    if (port.setView) port.setView({ ...view });
    else {
      // Fallback: move only the picture (CSS transform on the game canvas),
      // never the game's objects. See src/adapters/2d-adapter-guide.md.
      const cv = (port.canvas && port.canvas()) || [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (cv) {
        cv.style.transformOrigin = '50% 50%';
        cv.style.transform = view.x || view.y || view.zoom !== 1 ? `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` : '';
      }
    }
    port.render();
    drawHandles();
  }

  // --- handles: three 48px circles next to the selected object
  const HANDLE = 48;
  function handlePositions() {
    if (!sel) return null;
    const a = anchor(sel);
    if (!a) return null;
    const r = a.rect || { x: a.center[0] - 20, y: a.center[1] - 20, w: 40, h: 40 };
    // Keep every handle on screen: on a phone an object near the edge would
    // otherwise put its handles where no finger can reach. Flip to the left
    // side when the right side does not fit, then clamp.
    const half = HANDLE / 2;
    const right = r.x + r.w + HANDLE * 0.6;
    const hx = right + half <= innerWidth ? right : r.x - HANDLE * 0.6;
    const clampX = (x) => Math.min(innerWidth - half, Math.max(half, x));
    const clampY = (y) => Math.min(innerHeight - half, Math.max(half, y));
    return {
      move: a.center,
      rotate: [clampX(hx), clampY(r.y - HANDLE * 0.6)],
      scale: [clampX(hx), clampY(r.y + r.h + HANDLE * 0.6)],
      rect: r,
    };
  }
  function drawHandles() {
    if (!overlay) return;
    const hp = handlePositions();
    for (const name of ['move', 'rotate', 'scale']) {
      const el = overlay.querySelector(`[data-h="${name}"]`);
      el.style.display = hp ? 'block' : 'none';
      if (hp) el.style.transform = `translate(${hp[name][0] - HANDLE / 2}px, ${hp[name][1] - HANDLE / 2}px)`;
    }
    const box = overlay.querySelector('[data-h="box"]');
    box.style.display = hp ? 'block' : 'none';
    if (hp) Object.assign(box.style, { left: `${hp.rect.x}px`, top: `${hp.rect.y}px`, width: `${hp.rect.w}px`, height: `${hp.rect.h}px` });
  }

  function buildOverlay() {
    overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;touch-action:none;';
    const box = document.createElement('div');
    box.dataset.h = 'box';
    box.style.cssText = 'position:fixed;border:2px dashed #39f;pointer-events:none;display:none;';
    overlay.appendChild(box);
    const colors = { move: '#3399ff', rotate: '#ff9933', scale: '#33cc66' };
    for (const name of ['move', 'rotate', 'scale']) {
      const h = document.createElement('div');
      h.dataset.h = name;
      h.style.cssText = `position:fixed;left:0;top:0;width:${HANDLE}px;height:${HANDLE}px;border-radius:50%;`
        + `background:${colors[name]}cc;border:2px solid #fff;display:none;box-sizing:border-box;`;
      overlay.appendChild(h);
    }
    document.body.appendChild(overlay);

    // One gesture = press .. release. Same code path for mouse and touch.
    let g = null;
    overlay.addEventListener('pointerdown', (e) => {
      overlay.setPointerCapture(e.pointerId);
      const h = e.target.dataset.h;
      if (sel && (h === 'move' || h === 'rotate' || h === 'scale')) {
        const pose = port.get(sel);
        const hp = handlePositions();
        g = { kind: h, key: sel, from: clone(pose), x0: e.clientX, y0: e.clientY, m: port.parentToScreen(sel), c: hp.move,
          a0: Math.atan2(e.clientY - hp.move[1], e.clientX - hp.move[0]), d0: Math.hypot(e.clientX - hp.move[0], e.clientY - hp.move[1]) };
      } else {
        g = { kind: 'look', x0: e.clientX, y0: e.clientY, vx: view.x, vy: view.y, moved: false, touch: e.pointerType === 'touch' };
      }
    });
    overlay.addEventListener('pointermove', (e) => {
      if (!g) return;
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      if (g.kind === 'look') {
        if (!g.moved && Math.hypot(dx, dy) < 8) return;
        g.moved = true;
        view.x = g.vx + dx; view.y = g.vy + dy;
        applyView();
        return;
      }
      const p = clone(g.from);
      if (g.kind === 'move') {
        const [px, py] = invLinear(g.m, dx, dy);
        p.p = [g.from.p[0] + px, g.from.p[1] + py];
      } else if (g.kind === 'rotate') {
        p.r = norm((g.from.r || 0) + Math.atan2(e.clientY - g.c[1], e.clientX - g.c[0]) - g.a0);
      } else if (g.kind === 'scale') {
        const f = Math.min(1000, Math.max(0.001, Math.hypot(e.clientX - g.c[0], e.clientY - g.c[1]) / (g.d0 || 1)));
        p.s = Array.isArray(g.from.s) ? g.from.s.map((v) => v * f) : sOf(g.from) * f;
      }
      setPose(g.key, p);
    });
    const finish = (e) => {
      if (!g) return;
      if (g.kind === 'look' && !g.moved) {
        // A tap selects (never moves). Pressing the same spot again cycles to the object behind.
        const keys = pickNear(e.clientX, e.clientY, g.touch ? 28 : 12);
        const i = keys.indexOf(sel);
        sel = keys.length ? keys[(i + 1) % keys.length] : null;
        events.push(`select ${sel}`);
        drawHandles();
      } else if (g.kind !== 'look') {
        const to = port.get(g.key);
        if (JSON.stringify(to) !== JSON.stringify(g.from)) {
          undo.push({ key: g.key, from: g.from, to: clone(to) });
          redo.length = 0;
          events.push(`moved ${g.key} ${g.kind}`);
        }
      }
      g = null;
    };
    overlay.addEventListener('pointerup', finish);
    overlay.addEventListener('pointercancel', finish);
    overlay.addEventListener('wheel', (e) => {
      e.preventDefault();
      view.zoom *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
      applyView();
    }, { passive: false });
  }

  function placementFile() {
    const objects = {};
    for (const it of list()) {
      const now = port.get(it.key);
      const before = was.get(it.key);
      if (!before || JSON.stringify(now) === JSON.stringify(before)) continue;
      const fix = (pose) => {
        const o = { p: pose.p.map((v) => round(v, 0.1)) };
        if (pose.r !== undefined) o.r = round(norm(pose.r), 0.0001);
        if (pose.s !== undefined) o.s = Array.isArray(pose.s) ? pose.s.map((v) => round(v, 0.0001)) : round(pose.s, 0.0001);
        return o;
      };
      objects[it.key] = { ...fix(now), was: fix(before), label: it.label, ...(it.unstable ? { unstable: true } : {}) };
    }
    return { version: 1, tool: 'placement', dim: '2d', space: 'local', objects };
  }

  // ------------------------------------------------------------------ test API
  window.__studioTest = {
    events,
    /** Wait for the first frame, find the port, freeze time and show handles. */
    async begin() {
      await time.firstFrame();
      for (let i = 0; i < 100 && !(port = findPort()); i++) await new Promise((r) => setTimeout(r, 50));
      if (!port) throw new Error('no 2D port registered');
      await untilObjects();
      time.freeze();
      port.pause?.();
      port.render();
      list();
      for (const it of items) was.set(it.key, clone(it.pose));
      buildOverlay();
      return { name: port.name, version: port.version || null, items };
    },
    /** Like begin() but without freezing or handles: read poses after a normal load. */
    async observe() {
      await time.firstFrame();
      for (let i = 0; i < 100 && !(port = findPort()); i++) await new Promise((r) => setTimeout(r, 50));
      if (!port) throw new Error('no 2D port registered');
      await untilObjects();
      time.freeze();
      port.pause?.();
      return list();
    },
    items: () => list(),
    pose: (k) => port.get(k),
    anchor: (k) => anchor(k),
    bounds: (k) => port.bounds(k),
    selected: () => sel,
    select(k) { sel = k; drawHandles(); return !!anchor(k); },
    handles: () => handlePositions(),
    setPose: (k, p) => setPose(k, p),
    undo() { const s = undo.pop(); if (!s) return false; setPose(s.key, s.from); redo.push(s); return true; },
    redo() { const s = redo.pop(); if (!s) return false; setPose(s.key, s.to); undo.push(s); return true; },
    undoDepth: () => undo.length,
    view(v) { Object.assign(view, v); applyView(); return { ...view }; },
    placement: () => placementFile(),
    async capture(k, size = 96) {
      // Like the real base (src/core/port2d.ts capture): the port's own thumbnail first; null means
      // "none" (the pixi-garden adapter returns null for a blank extract since ce652928), and then
      // the object is cropped from the screen. Before, the stub returned that null and the
      // pixi-garden thumbnail checks failed although the editor showed a thumbnail.
      if (port.capture) {
        const url = await Promise.resolve(port.capture(k, size)).catch(() => null);
        if (url) return url;
      }
      const b = port.bounds(k);
      const cv = (port.canvas && port.canvas()) || document.querySelector('canvas');
      if (!b || !cv) return null;
      port.render(); // draw now so a WebGL canvas still holds the picture in this task
      const r = cv.getBoundingClientRect();
      const sx = cv.width / r.width, sy = cv.height / r.height;
      const out = document.createElement('canvas');
      out.width = out.height = size;
      const f = size / Math.max(b.w, b.h, 1);
      out.getContext('2d').drawImage(cv, (b.x - r.left) * sx, (b.y - r.top) * sy, b.w * sx, b.h * sy,
        (size - b.w * f) / 2, (size - b.h * f) / 2, b.w * f, b.h * f);
      return out.toDataURL('image/png');
    },
    assetsOf: (k) => (port.assetsOf ? port.assetsOf(k) : []),
  };
})();
