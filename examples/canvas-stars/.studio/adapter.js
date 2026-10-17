// KUMODeck Game Studio — example 2D adapter for a plain-JavaScript canvas game
// (the game keeps its own list of things and draws them with the 2D context).
//
// HOW TO USE: copy this file to `.studio/adapter.js` in the game folder and
// adapt the "EDIT HERE" parts. It only runs inside the studio's edit mode.
//
// Why a canvas game needs one small change in the game itself: with no engine
// there is nothing the studio can discover. The objects live in the game's own
// variables (often inside an ES module), so the game must hand them over. The
// AI agent adds ONE line to the game after its objects exist, for example:
//
//   globalThis.studioGame = { things, draw };   // studio: hand objects to the editor
//
// Everything else stays in this file. The example game is
// examples/canvas-stars (see the lines marked "studio" in its game.js).
//
// Assumptions this example makes about the game (change them to match yours):
//   - each thing has x, y (centre, world px), angle (radians, clockwise),
//     scale (number), w, h (unscaled size in world px) and an optional `key`
//     or `name` (`studio: false` hides a thing from the editor)
//   - things are drawn in list order, first = back (the draw order / layers
//     the studio can change; keep `things` the array draw() walks)
//   - draw() paints one whole frame and leaves the context's transform at the
//     "world -> canvas pixels" mapping (setTransform at the start of a frame,
//     save()/restore() around each thing). Then ctx.getTransform() tells this
//     adapter how world px map to canvas pixels, including devicePixelRatio.
(function () {
  'use strict';
  const studio = window.__gameStudio || window.studio;
  if (!studio) return;

  // EDIT HERE: where the game put its objects and its draw function.
  const game = () => globalThis.studioGame || null;
  const things = () => (game() && game().things) || [];

  const clean = (s) => String(s).replace(/[^A-Za-z0-9_:#.\-\/]/g, '_').slice(0, 80);
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];

  // Keys: the thing's own `key` -> `name` -> its index in the list. Repeated
  // names get #2, #3 in list order. An index changes when the list changes,
  // so it is flagged unstable.
  // Each thing keeps the key it got first for the whole edit session: the
  // draw order (layers) reorders the list, which would otherwise rename
  // unnamed things (path:4 -> path:1) and repeats (#2) while editing.
  const keyMemo = new WeakMap();
  function collect() {
    const out = new Map();
    const seen = new Map();
    things().forEach((t, i) => {
      if (!t || t.studio === false) return;
      const own = t.key || t.name;
      let key = own ? clean(own) : `path:${i}`;
      if (own) {
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        if (n > 1) key = `${key.slice(0, 76)}#${n}`;
      }
      const kept = keyMemo.get(t);
      if (kept && !out.has(kept)) key = kept;
      keyMemo.set(t, key);
      out.set(key, { t, own, unstable: !own || key.startsWith('path:') });
    });
    return out;
  }
  let byKey = new Map();
  const find = (k) => byKey.get(k) || (byKey = collect()).get(k) || null;

  function canvas() {
    // EDIT HERE if the game has several canvases: return the one it draws into.
    return [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0] || null;
  }

  // world px -> CSS px of the page: the game's base transform (world -> canvas
  // pixels), then canvas pixels -> where the canvas element sits on the page.
  // Reading the element's rectangle also covers CSS scaling and the studio's
  // view fallback (a CSS transform on the canvas).
  function worldToScreen() {
    const cv = canvas();
    const r = cv.getBoundingClientRect();
    const t = cv.getContext('2d').getTransform();
    return mul([r.width / cv.width, 0, 0, r.height / cv.height, r.left, r.top], [t.a, t.b, t.c, t.d, t.e, t.f]);
  }
  const local = (t) => {
    const s = t.scale ?? 1, c = Math.cos(t.angle || 0), n = Math.sin(t.angle || 0);
    return [c * s, n * s, -n * s, c * s, t.x, t.y];
  };

  studio.register2D(() => {
    if (!game() || !canvas()) return null;
    return {
      name: 'canvas',
      objects() {
        byKey = collect();
        return [...byKey].map(([key, e]) => ({
          key,
          label: e.own || `${e.t.kind || 'thing'} (no name)`,
          kinds: [e.t.kind || 'thing'],
          group: e.t.kind || undefined,
          unstable: e.unstable || undefined,
        }));
      },
      get(key) {
        const e = find(key);
        return e ? { p: [e.t.x, e.t.y], r: e.t.angle || 0, s: e.t.scale ?? 1 } : null;
      },
      set(key, pose) {
        const e = find(key);
        if (!e) return;
        e.t.x = pose.p[0];
        e.t.y = pose.p[1];
        if (pose.r !== undefined) e.t.angle = pose.r;
        if (pose.s !== undefined) e.t.scale = Array.isArray(pose.s) ? pose.s[0] : pose.s;
      },
      // Draw order (layers): draw() paints the list from first to last, so
      // the index in the game's own array IS the layer. One list: 'things'.
      order(key) {
        const e = find(key);
        const i = e ? things().indexOf(e.t) : -1;
        return i >= 0 ? { parent: 'things', index: i } : null;
      },
      setOrder(key, index) {
        const e = find(key);
        const list = things();
        const i = e ? list.indexOf(e.t) : -1;
        if (i < 0) return;
        list.splice(i, 1);
        list.splice(index, 0, e.t);
      },
      // Things live directly in world space, so their parent space IS world space.
      parentToScreen(key) {
        return find(key) ? worldToScreen() : null;
      },
      bounds(key) {
        const e = find(key);
        if (!e) return null;
        const m = mul(worldToScreen(), local(e.t));
        const w = (e.t.w || 1) / 2, h = (e.t.h || 1) / 2;
        const pts = [[-w, -h], [w, -h], [-w, h], [w, h]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      },
      // Paint one frame without advancing the game: draw() only, never update().
      render() { game().draw(); },
      // No setView: the studio's fallback moves the canvas picture with a CSS
      // transform. A game with its own camera can implement setView instead.
      assetsOf(key) {
        const e = find(key);
        const img = e && e.t.img;
        return img && img.src ? [{ url: img.src, how: 'texture', sure: true }] : [];
      },
      canvas,

      // Copy and delete (optional; without them the studio shows stand-ins).
      // A copy is a shallow copy of the thing (same picture, same numbers),
      // put right after it in the list draw() walks, listed under newKey.
      clone(key, newKey) {
        const e = find(key);
        const list = things();
        const i = e ? list.indexOf(e.t) : -1;
        if (i < 0) return false;
        const copy = { ...e.t, key: newKey };
        list.splice(i + 1, 0, copy);
        byKey = collect();
        return byKey.has(newKey);
      },
      // Taken out of the list (draw() no longer paints it); kept with its
      // place so putBack() puts it back exactly. Keys stay (keyMemo).
      remove(key) {
        const e = find(key);
        const list = things();
        const i = e ? list.indexOf(e.t) : -1;
        if (i < 0) return false;
        list.splice(i, 1);
        removedThings.set(key, { t: e.t, index: i });
        byKey = collect();
        return true;
      },
      putBack(key) {
        const r = removedThings.get(key);
        if (!r) return false;
        removedThings.delete(key);
        const list = things();
        list.splice(Math.min(r.index, list.length), 0, r.t);
        byKey = collect();
        return true;
      },
    };
  });
  const removedThings = new Map();
})();
