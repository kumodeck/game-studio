// KUMODeck Game Studio — example 2D adapter for PixiJS v8.
//
// HOW TO USE: copy this file to `.studio/adapter.js` in the game folder. The
// studio loads it right after its edit script and BEFORE any game code, so the
// discovery hook below is in place when the game creates its Application.
// Then adjust the "EDIT HERE" parts for the game. It only runs in edit mode.
//
// What it does: implements the small 2D port (Port2D, src/contract.ts) on top
// of PixiJS. The studio turns it into picking, handles, undo/redo and the
// saved placement.json.
//
// Tested with PixiJS 8.21.0. Needs no change to the game: Pixi announces
// itself through `globalThis.__PIXI_APP_INIT__` (the hook its devtools use).
(function () {
  'use strict';
  const studio = window.__gameStudio || window.studio;
  if (!studio) return;

  // ---------------------------------------------------------------- discovery
  // Application.init() calls __PIXI_APP_INIT__(app, version) once the renderer
  // exists; __PIXI_RENDERER_INIT__ covers games that build a renderer without
  // an Application. Existing hooks (e.g. a devtools extension) keep working.
  let app = null;
  let renderer = null;
  let version;
  const prevApp = globalThis.__PIXI_APP_INIT__;
  globalThis.__PIXI_APP_INIT__ = function (a, v) {
    if (!app) { app = a; version = v; }
    if (typeof prevApp === 'function') return prevApp.apply(this, arguments);
  };
  const prevRenderer = globalThis.__PIXI_RENDERER_INIT__;
  globalThis.__PIXI_RENDERER_INIT__ = function (r, v) {
    if (!renderer) { renderer = r; version = version || v; }
    if (typeof prevRenderer === 'function') return prevRenderer.apply(this, arguments);
  };
  const theRenderer = () => (app && app.renderer) || renderer;
  // Without an Application, the stage is whatever the game rendered last.
  const stage = () => (app ? app.stage : renderer && renderer.lastObjectRendered) || null;

  // ---------------------------------------------------------------- which objects
  // Candidates (CONTRACT: "the meaningful top-most node"):
  //   - every object with a `studioKey` marker or a `label`, at any depth
  //     (a labelled tree inside a labelled forest can move on its own)
  //   - unlabelled direct children of the stage (they are the game's top-level
  //     pieces; deeper unlabelled objects move with their parent)
  // Left out: `studio = false` (with everything inside), invisible objects,
  // objects with nothing to see. EDIT HERE to leave out UI layers by label.
  const clean = (s) => String(s).replace(/[^A-Za-z0-9_:#.\-\/]/g, '_').slice(0, 80);
  // Pixi v8 fills `label` with the class name when the game gives none
  // ("Sprite", "Graphics", ...). Those are not names: treat them as unnamed,
  // or every sprite would share the key "Sprite".
  const DEFAULT_LABELS = new Set(['Sprite', 'Graphics', 'Mesh', 'TilingSprite', 'NineSliceSprite',
    'ParticleContainer', 'RenderContainer', 'DOMContainer', 'Text', 'BitmapText', 'HTMLText', 'AnimatedSprite', 'Container']);
  const ownName = (o) => o.studioKey || (o.label && !DEFAULT_LABELS.has(o.label) ? o.label : '');
  const KEY_OK = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;

  function collect() {
    const root = stage();
    const out = new Map();
    if (!root) return out;
    // Repeats are counted over every labelled object in tree order, so the
    // game's loader can rebuild the same keys (examples/pixi-garden/placement.js).
    const seen = new Map();
    const walk = (c, path, depth, hidden) => {
      c.children.forEach((o, i) => {
        if (o.studio === false || o.destroyed) return;
        const p = path.concat(i);
        const own = ownName(o);
        let key;
        if (own) {
          key = clean(own);
          const n = (seen.get(key) || 0) + 1;
          seen.set(key, n);
          if (n > 1) key = `${key.slice(0, 76)}#${n}`;
        } else key = `path:${p.join('/')}`;
        // Hidden objects (and everything inside them) cannot be seen or
        // picked, but their names are still counted above so keys match the loader.
        const off = hidden || !o.visible;
        if (!off && (own || depth === 0) && KEY_OK.test(key) && hasArea(o)) out.set(key, { o, own, unstable: !own });
        if (o.children && o.children.length) walk(o, p, depth + 1, off);
      });
    };
    walk(root, [], 0, false);
    return out;
  }
  function hasArea(o) {
    const b = o.getLocalBounds();
    return b.maxX - b.minX > 0 && b.maxY - b.minY > 0;
  }
  function kindOf(o) {
    if (o.texture && o.anchor) return 'sprite';
    if (typeof o.text === 'string') return 'text';
    if (o.context && typeof o.clear === 'function') return 'graphics';
    return 'container';
  }
  let byKey = new Map();
  function find(key) {
    let e = byKey.get(key);
    if (!e || e.o.destroyed) { byKey = collect(); e = byKey.get(key); }
    return e || null;
  }

  // ---------------------------------------------------------------- screen maths
  // Matrices are [a, b, c, d, e, f] (X = a*x + c*y + e, Y = b*x + d*y + f).
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const localOf = (o) => { o.updateLocalTransform(); const t = o.localTransform; return [t.a, t.b, t.c, t.d, t.tx, t.ty]; };

  // Built from the local transforms, not Pixi's cached worldTransform: right
  // after set() the cache is stale until the next render, and the studio asks
  // for the anchor straight after moving.
  function worldOf(o) {
    let m = [1, 0, 0, 1, 0, 0];
    for (let n = o; n; n = n.parent) m = mul(localOf(n), m);
    return m;
  }
  // Pixi "screen" units (renderer.screen) -> CSS px of the page.
  function css() {
    const r = theRenderer();
    const rect = r.canvas.getBoundingClientRect();
    return [rect.width / r.screen.width, 0, 0, rect.height / r.screen.height, rect.left, rect.top];
  }

  // ---------------------------------------------------------------- edit view
  // The edit camera changes only the picture. We render with an extra transform
  // (renderer.render({ container, transform })) that REPLACES the stage's own
  // transform for that draw; app.stage and every object keep their values, so
  // nothing the game reads (or the studio saves) changes. view = identity
  // means "draw exactly like the game".
  let view = [1, 0, 0, 1, 0, 0];
  function setView(v) {
    const r = theRenderer();
    if (!r) return;
    const k = css();
    // v.x, v.y are CSS px; the zoom pivot is the canvas centre, in screen units.
    const cx = r.screen.width / 2, cy = r.screen.height / 2;
    const tx = v.x / k[0], ty = v.y / k[3];
    view = [v.zoom, 0, 0, v.zoom, cx + tx - v.zoom * cx, cy + ty - v.zoom * cy];
  }
  const isIdentity = () => view[0] === 1 && view[3] === 1 && !view[4] && !view[5];

  // ---------------------------------------------------------------- the port
  studio.register2D(() => {
    if (!theRenderer() || !stage()) return null;
    return {
      name: 'pixi',
      version,

      objects() {
        byKey = collect();
        return [...byKey].map(([key, e]) => {
          const kind = kindOf(e.o);
          const src = e.o.texture && e.o.texture.source && e.o.texture.source.label;
          return {
            key,
            label: e.own || `${kind} (no name)`,
            kinds: [kind],
            // Same texture = same kind of thing (shown once as "label ×N").
            group: src || (e.own ? String(e.own).replace(/[-_ #]?\d+$/, '') : undefined),
            unstable: e.unstable || undefined,
          };
        });
      },

      get(key) {
        const e = find(key);
        if (!e) return null;
        const o = e.o;
        return { p: [o.x, o.y], r: o.rotation, s: o.scale.x === o.scale.y ? o.scale.x : [o.scale.x, o.scale.y] };
      },

      set(key, pose) {
        const e = find(key);
        if (!e) return;
        const o = e.o;
        o.position.set(pose.p[0], pose.p[1]);
        if (pose.r !== undefined) o.rotation = pose.r;
        if (pose.s !== undefined) Array.isArray(pose.s) ? o.scale.set(pose.s[0], pose.s[1]) : o.scale.set(pose.s);
      },

      parentToScreen(key) {
        const e = find(key);
        if (!e) return null;
        return mul(mul(css(), view), e.o.parent ? worldOf(e.o.parent) : [1, 0, 0, 1, 0, 0]);
      },

      bounds(key) {
        const e = find(key);
        if (!e) return null;
        const b = e.o.getLocalBounds(); // in the object's own space, children included
        const m = mul(mul(css(), view), worldOf(e.o));
        const pts = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]
          .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      },

      render() {
        const r = theRenderer();
        const s = stage();
        if (isIdentity()) { r.render({ container: s }); return; }
        const st = localOf(s);
        const m = mul(view, st);
        const T = s.localTransform.constructor; // Pixi's Matrix class, without importing Pixi
        r.render({ container: s, transform: new T(m[0], m[1], m[2], m[3], m[4], m[5]) });
      },

      setView,
      // The studio already holds requestAnimationFrame; stopping the ticker
      // also stops games that drive Pixi from their own timer.
      pause() { if (app && app.ticker) app.ticker.stop(); },
      resume() { if (app && app.ticker) app.ticker.start(); },

      // Thumbnail of the object alone, rendered by Pixi's extract system (it
      // does not run the game's own per-frame code).
      async capture(key, size) {
        const e = find(key);
        const r = theRenderer();
        if (!e || !r.extract) return null;
        const src = r.extract.canvas({ target: e.o });
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const f = size / Math.max(src.width, src.height, 1);
        c.getContext('2d').drawImage(src, (size - src.width * f) / 2, (size - src.height * f) / 2, src.width * f, src.height * f);
        return c.toDataURL('image/png');
      },

      // Files this object (and its children) draw. Assets.load() labels each
      // texture source with the URL it was loaded from; `studioAsset` on an
      // object is the game's own marker and always wins.
      assetsOf(key) {
        const e = find(key);
        if (!e) return [];
        const out = [];
        const add = (o) => {
          if (o.studioAsset) out.push({ url: new URL(o.studioAsset, document.baseURI).href, how: 'other', sure: true });
          const label = o.texture && o.texture.source && o.texture.source.label;
          if (label && /\.[a-z0-9]{2,5}($|\?)/i.test(label)) {
            try { out.push({ url: new URL(label, document.baseURI).href, how: 'texture', sure: true }); } catch (err) { /* not a URL */ }
          }
          if (o.children) o.children.forEach(add);
        };
        add(e.o);
        return out.filter((a, i) => out.findIndex((b) => b.url === a.url) === i);
      },

      canvas() { const r = theRenderer(); return r ? r.canvas : null; },
    };
  });
})();
