// KUMODeck Game Studio — example 2D adapter for a plain-JavaScript DOM game
// (the game moves HTML elements such as <img> or <div> with CSS).
//
// HOW TO USE: copy this file to `.studio/adapter.js` in the game folder and
// adapt the "EDIT HERE" parts. It only runs inside the studio's edit mode.
//
// Like a canvas game, a DOM game has no engine to discover. The usual shape is
// "state in JS, render() writes it to element styles every frame", so the
// adapter edits the STATE and calls render(); writing styles directly would be
// overwritten by the game's next render(). The game hands its state over with
// one line (examples/dom-board, marked "studio"):
//
//   globalThis.studioGame = { pieces, render, board, view };
//
// Assumptions (change them to match your game):
//   - pieces: [{ el, x, y, angle, scale, key?/name? }] with x, y the CENTRE of
//     the element in board CSS px, angle in radians (clockwise), scale a number
//   - board: the element the pieces are positioned in (their parent space)
//   - view: an element wrapping the board that nothing else transforms; the
//     edit camera puts its CSS transform there, so the game's own layout
//     (for example a "fit to screen" scale on the board) is left alone
(function () {
  'use strict';
  const studio = window.__gameStudio || window.studio;
  if (!studio) return;

  // EDIT HERE: where the game put its state.
  const game = () => globalThis.studioGame || null;
  const pieces = () => (game() && game().pieces) || [];

  const clean = (s) => String(s).replace(/[^A-Za-z0-9_:#.\-\/]/g, '_').slice(0, 80);

  // Keys: `key` -> `name` -> data-studio-key / id of the element -> index (unstable).
  function collect() {
    const out = new Map();
    const seen = new Map();
    pieces().forEach((t, i) => {
      if (!t || t.studio === false || (t.el && t.el.dataset.studio === 'false')) return;
      const own = t.key || t.name || (t.el && (t.el.dataset.studioKey || t.el.id));
      let key = own ? clean(own) : `path:${i}`;
      if (own) {
        const n = (seen.get(key) || 0) + 1;
        seen.set(key, n);
        if (n > 1) key = `${key.slice(0, 76)}#${n}`;
      }
      out.set(key, { t, own, unstable: !own });
    });
    return out;
  }
  let byKey = new Map();
  const find = (k) => byKey.get(k) || (byKey = collect()).get(k) || null;

  // Board CSS px -> page CSS px. getBoundingClientRect() already includes every
  // CSS transform above the board (the game's fit scale and our edit view), as
  // long as nothing rotates it. offsetWidth is the board's untransformed size.
  function parentToScreen() {
    const b = game().board;
    const r = b.getBoundingClientRect();
    const sx = r.width / (b.offsetWidth || 1), sy = r.height / (b.offsetHeight || 1);
    return [sx, 0, 0, sy, r.left + b.clientLeft * sx, r.top + b.clientTop * sy];
  }

  studio.register2D(() => {
    if (!game() || !game().board) return null;
    return {
      name: 'dom',
      objects() {
        byKey = collect();
        return [...byKey].map(([key, e]) => ({
          key,
          label: e.own || `${e.t.el ? e.t.el.tagName.toLowerCase() : 'piece'} (no name)`,
          kinds: [e.t.kind || (e.t.el ? e.t.el.tagName.toLowerCase() : 'piece')],
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
      parentToScreen(key) {
        return find(key) ? parentToScreen() : null;
      },
      bounds(key) {
        const e = find(key);
        if (!e || !e.t.el) return null;
        const r = e.t.el.getBoundingClientRect(); // includes rotation (as a box around it)
        return { x: r.left, y: r.top, w: r.width, h: r.height };
      },
      render() { game().render(); },
      // Edit camera: transform the wrapper only. Pieces and the board keep
      // their own styles, so nothing the game saves or reads changes.
      setView(v) {
        const el = game().view;
        if (!el) return;
        el.style.transformOrigin = '50% 50%';
        el.style.transform = v.x || v.y || v.zoom !== 1 ? `translate(${v.x}px, ${v.y}px) scale(${v.zoom})` : '';
      },
      // DOM has no canvas to crop, so draw the piece's image when it has one.
      async capture(key, size) {
        const e = find(key);
        const img = e && e.t.el && (e.t.el.tagName === 'IMG' ? e.t.el : e.t.el.querySelector('img'));
        if (!img || !img.complete) return null;
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const f = size / Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
        const w = (img.naturalWidth || size) * f, h = (img.naturalHeight || size) * f;
        c.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        return c.toDataURL('image/png');
      },
      assetsOf(key) {
        const e = find(key);
        if (!e || !e.t.el) return [];
        const out = [];
        const imgs = e.t.el.tagName === 'IMG' ? [e.t.el] : [...e.t.el.querySelectorAll('img')];
        for (const i of imgs) if (i.currentSrc || i.src) out.push({ url: i.currentSrc || i.src, how: 'texture', sure: true });
        const bg = getComputedStyle(e.t.el).backgroundImage.match(/url\("?([^")]+)"?\)/);
        if (bg) out.push({ url: new URL(bg[1], document.baseURI).href, how: 'texture', sure: true });
        return out;
      },
      canvas: () => null,
    };
  });
})();
