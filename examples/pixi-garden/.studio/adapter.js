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

  // Keys are worked out once per object and then kept for the whole edit
  // session. WHY: tree paths (path:0/3/1) and repeat numbers (tree#2) depend
  // on the order of the children, and changing the draw order (layers)
  // reorders the children. Without this, moving the rock to the back would
  // rename it and every unnamed object after it in the middle of editing.
  const keyMemo = new WeakMap();
  function collect() {
    const root = stage();
    const out = new Map();
    if (!root) return out;
    // Repeats are counted over every labelled object in tree order, so the
    // game's loader can rebuild the same keys (examples/pixi-garden/placement.js).
    const seen = new Map();
    const used = new Set();
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
        const kept = keyMemo.get(o);
        if (kept && !used.has(kept)) key = kept;
        keyMemo.set(o, key);
        used.add(key);
        // Hidden objects (and everything inside them) cannot be seen or
        // picked, but their names are still counted above so keys match the loader.
        const off = hidden || !o.visible;
        if (!off && (own || depth === 0) && KEY_OK.test(key) && hasArea(o)) out.set(key, { o, own, unstable: !own || key.startsWith('path:') });
        if (o.children && o.children.length) walk(o, p, depth + 1, off);
      });
    };
    walk(root, [], 0, false);
    return out;
  }
  // Which list an object is drawn in, for the draw order (layers): 'stage'
  // for top-level pieces, else the parent's key (a container such as 'fence').
  const parentId = (o) => (!o.parent || o.parent === stage() ? 'stage' : keyMemo.get(o.parent) || 'stage');
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

  // The object's box on the page (CSS px), through the edit view.
  function boundsOf(key) {
    const e = find(key);
    if (!e) return null;
    const b = e.o.getLocalBounds(); // in the object's own space, children included
    const m = mul(mul(css(), view), worldOf(e.o));
    const pts = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]
      .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  // One frame of the game as it is now, through the edit view.
  function draw() {
    const r = theRenderer();
    const s = stage();
    if (isIdentity()) { r.render({ container: s }); return; }
    const st = localOf(s);
    const m = mul(view, st);
    const T = s.localTransform.constructor; // Pixi's Matrix class, without importing Pixi
    r.render({ container: s, transform: new T(m[0], m[1], m[2], m[3], m[4], m[5]) });
  }

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

      // Draw order (layers): Pixi draws children in array order, last on top.
      order(key) {
        const e = find(key);
        if (!e || !e.o.parent) return null;
        return { parent: parentId(e.o), index: e.o.parent.getChildIndex(e.o) };
      },
      setOrder(key, index) {
        const e = find(key);
        const parent = e && e.o.parent;
        if (!parent) return;
        parent.setChildIndex(e.o, index); // remove, then insert at index
        // Containers with sortableChildren re-sort by zIndex every frame, which
        // would undo the move. Take the zIndex of the new neighbour (the sort is
        // stable, so equal values keep the array order). EDIT HERE if the game
        // assigns zIndex itself every frame: change that code instead.
        if (parent.sortableChildren) {
          const below = parent.children[index - 1], above = parent.children[index + 1];
          const z = below ? below.zIndex : above ? above.zIndex : e.o.zIndex;
          if (e.o.zIndex !== z) e.o.zIndex = z;
        }
      },

      parentToScreen(key) {
        const e = find(key);
        if (!e) return null;
        return mul(mul(css(), view), e.o.parent ? worldOf(e.o.parent) : [1, 0, 0, 1, 0, 0]);
      },

      bounds: (key) => boundsOf(key),

      render: draw,

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
        // extract renders the object on its own, and Pixi v8 turns it into a
        // render group to do so. Left that way, the object is no longer drawn
        // with its parent (it vanished from the game). Undo it right after.
        // Draw the frame first. An object added since the last frame (a copy
        // just made) is not in the stage's draw list yet; extracting it then
        // left it out of the game's picture for good (studio-edit-ops, 10/16).
        draw();
        const wasGroup = !!e.o.isRenderGroup;
        let src;
        try {
          src = r.extract.canvas({ target: e.o });
        } finally {
          if (!wasGroup && e.o.isRenderGroup && e.o.disableRenderGroup) e.o.disableRenderGroup();
        }
        // A blank result (seen with single sprites on some WebGL setups) is
        // reported as "no thumbnail", so the studio crops the object from the
        // screen instead.
        if (!src || !src.width || !src.height) return null;
        try {
          const probe = document.createElement('canvas');
          probe.width = probe.height = 16;
          const pg = probe.getContext('2d', { willReadFrequently: true });
          pg.drawImage(src, 0, 0, 16, 16);
          if (!pg.getImageData(0, 0, 16, 16).data.some((v, i) => i % 4 === 3 && v > 0)) return null;
        } catch (err) {
          return null;
        }
        const c = document.createElement('canvas');
        c.width = c.height = size;
        const f = size / Math.max(src.width, src.height, 1);
        c.getContext('2d').drawImage(src, (size - src.width * f) / 2, (size - src.height * f) / 2, src.width * f, src.height * f);
        return c.toDataURL('image/png');
      },

      // The shape of these objects on screen, for the editor's selection outline. Everything else is hidden
      // for two draws through the edit view, on black and on white; the difference is the objects' coverage
      // (whatever their colours). Then the normal frame is drawn again in the same task, so the matte is never
      // on screen. The studio calls it only when the selection or the view changed.
      silhouette(keys) {
        const r = theRenderer();
        const s = stage();
        if (!r || !s || !r.canvas) return null;
        const objs = keys.map(find).filter(Boolean).map((e) => e.o);
        if (!objs.length) return null;
        let box = null;
        for (const k of keys) {
          const b = boundsOf(k);
          if (!b) continue;
          if (!box) box = { ...b };
          else {
            const x = Math.min(box.x, b.x), y = Math.min(box.y, b.y);
            box = { x, y, w: Math.max(box.x + box.w, b.x + b.w) - x, h: Math.max(box.y + box.h, b.y + b.h) - y };
          }
        }
        if (!box) return null;
        const cv = r.canvas;
        const cr = cv.getBoundingClientRect();
        if (!(cr.width > 0)) return null;
        const pr = cv.width / cr.width;
        const pad = 6;
        const x0 = Math.max(cr.left, box.x - pad), y0 = Math.max(cr.top, box.y - pad);
        const x1 = Math.min(cr.right, box.x + box.w + pad), y1 = Math.min(cr.bottom, box.y + box.h + pad);
        const sx = Math.floor((x0 - cr.left) * pr), sy = Math.floor((y0 - cr.top) * pr);
        const sw = Math.ceil((x1 - x0) * pr), sh = Math.ceil((y1 - y0) * pr);
        if (sw < 2 || sh < 2) return null;
        const keep = new Set();
        const tree = (o) => { keep.add(o); if (o.children) o.children.forEach(tree); };
        for (const o of objs) { tree(o); for (let n = o.parent; n; n = n.parent) keep.add(n); }
        const hidden = [];
        const walk = (c) => {
          for (const ch of c.children || []) {
            if (!keep.has(ch)) { if (ch.visible) { hidden.push(ch); ch.visible = false; } }
            else if (!objs.includes(ch)) walk(ch);
          }
        };
        walk(s);
        const shoot = (white) => {
          const st = localOf(s);
          const m = mul(view, st);
          const T = s.localTransform.constructor;
          r.render({ container: s, transform: new T(m[0], m[1], m[2], m[3], m[4], m[5]), clear: true, clearColor: white ? [1, 1, 1, 1] : [0, 0, 0, 1] });
          const c = document.createElement('canvas');
          c.width = sw;
          c.height = sh;
          const g = c.getContext('2d', { willReadFrequently: true });
          g.drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh);
          return { c, g };
        };
        let mask = null;
        try {
          const onBlack = shoot(false);
          const onWhite = shoot(true);
          const b = onBlack.g.getImageData(0, 0, sw, sh);
          const w = onWhite.g.getImageData(0, 0, sw, sh).data;
          const d = b.data;
          for (let i = 0; i < d.length; i += 4) {
            const gap = (w[i] - d[i] + w[i + 1] - d[i + 1] + w[i + 2] - d[i + 2]) / 3;
            d[i] = d[i + 1] = d[i + 2] = 255;
            d[i + 3] = gap < 230 ? 255 : 0;
          }
          onBlack.g.putImageData(b, 0, 0);
          mask = onBlack.c;
        } catch (err) {
          mask = null;
        } finally {
          for (const o of hidden) o.visible = true;
          draw();
        }
        return mask ? { x: cr.left + sx / pr, y: cr.top + sy / pr, w: sw / pr, h: sh / pr, mask } : null;
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

      // The layers left out above (`studio = false`: a HUD layer, a background) as boxes on the page (CSS px). The editor
      // draws a faint dotted frame "Not selectable yet" there on its UI layer (studio-canvas-ui stage 2, 2026-10-24), and
      // the person's ✦ asks the AI to make it selectable. A container's parts one by one (a HUD layer spans the screen);
      // a background is dropped by the editor (too big to be a UI part).
      leftOut() {
        const s = stage();
        if (!s || !theRenderer()) return [];
        const out = [];
        const push = (o) => {
          if (!o || o.destroyed || !o.visible || typeof o.getLocalBounds !== 'function') return;
          const b = o.getLocalBounds();
          if (!(b.maxX - b.minX > 0 && b.maxY - b.minY > 0)) return;
          const m = mul(mul(css(), view), worldOf(o));
          const pts = [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]
            .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          const x = Math.min(...xs), y = Math.min(...ys);
          out.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
        };
        const walk = (c) => c.children.forEach((o) => {
          if (o.destroyed || !o.visible) return;
          if (o.studio === false) {
            if (o.children && o.children.length) o.children.forEach(push);
            else push(o);
          } else if (o.children && o.children.length) walk(o);
        });
        walk(s);
        return out.slice(0, 50);
      },

      // Copy and delete (optional; without them the studio shows stand-ins).
      // clone: a new display object of the same class drawing the same thing,
      // inserted right after the original (drawn just in front of it), listed
      // under newKey through `studioKey`. EDIT HERE for game classes with
      // their own constructor arguments: return false and the studio shows a
      // stand-in until the AI adds the copy to the code.
      clone(key, newKey) {
        const e = find(key);
        const parent = e && e.o.parent;
        if (!parent) return false;
        const c = copyNode(e.o);
        if (!c) return false;
        c.studioKey = newKey;
        parent.addChildAt(c, parent.getChildIndex(e.o) + 1);
        byKey = collect();
        return byKey.has(newKey);
      },
      // remove: hidden (collect() leaves invisible objects out) but kept in
      // place, so the draw order and the keys of the others stay the same.
      remove(key) {
        const e = find(key);
        if (!e) return false;
        removedObjs.set(key, { o: e.o, visible: e.o.visible });
        e.o.visible = false;
        byKey = collect();
        return true;
      },
      putBack(key) {
        const r = removedObjs.get(key);
        if (!r) return false;
        removedObjs.delete(key);
        r.o.visible = r.visible;
        byKey = collect();
        return true;
      },
    };
  });

  const removedObjs = new Map();
  // A copy of one display object (and, for plain containers, its children).
  // Sprites share the texture, Graphics share the drawing (GraphicsContext).
  function copyNode(o) {
    const C = o.constructor;
    let c;
    try {
      if (o.context && typeof o.clone === 'function') c = o.clone();
      else if (Array.isArray(o.textures) && o.texture) c = new C(o.textures);
      else if (o.texture && o.anchor) c = new C(o.texture);
      else if (typeof o.text === 'string') c = new C({ text: o.text, style: o.style });
      else if (!o.texture) c = new C();
      else return null;
    } catch (err) {
      return null;
    }
    if (c.anchor && o.anchor) c.anchor.copyFrom(o.anchor);
    if (o.width !== undefined && o.texture && o.tileScale) { c.width = o.width; c.height = o.height; }
    c.position.copyFrom(o.position);
    c.scale.copyFrom(o.scale);
    c.pivot.copyFrom(o.pivot);
    c.skew.copyFrom(o.skew);
    c.rotation = o.rotation;
    c.alpha = o.alpha;
    if (o.tint !== undefined) c.tint = o.tint;
    if (o.blendMode) c.blendMode = o.blendMode;
    c.zIndex = o.zIndex;
    c.visible = o.visible;
    if (o.label) c.label = o.label;
    if (o.studioAsset) c.studioAsset = o.studioAsset;
    // Children: plain containers only (Sprites and Graphics are leaves in Pixi v8).
    if (!o.texture && !o.context && o.children && o.children.length) {
      for (const ch of o.children) {
        if (ch.studio === false) continue;
        const cc = copyNode(ch);
        if (!cc) return null;
        // Names inside a copy are not marks: drop studioKey so they get fresh keys.
        delete cc.studioKey;
        c.addChild(cc);
      }
    }
    return c;
  }
})();
