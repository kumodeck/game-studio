// KUMODeck Game Studio — example 2D adapter for Phaser 3 / Phaser 4.
//
// HOW TO USE: copy this file to `.studio/adapter.js` in the game folder. The
// studio loads it right after its edit script and BEFORE any game code, so it
// can watch Phaser arrive. Then adjust the "EDIT HERE" parts for the game.
// It only runs inside the studio's edit mode; the game itself never loads it.
//
// What it does: implements the small 2D port (Port2D, src/contract.ts) on top
// of Phaser. The studio turns the port into picking, handles, undo/redo and the
// saved placement.json. Every method below is a few lines of Phaser calls, so
// an AI agent can adapt it to a game that does unusual things.
//
// Tested with Phaser 4.2.1 and 3.80.1 (CDN builds; 3.60-3.88 share the 3.80
// APIs used here). The one place they differ, the camera matrix, is in
// worldToScreen() below.
(function () {
  'use strict';
  const studio = window.__gameStudio || window.studio;
  if (!studio) return;

  // ---------------------------------------------------------------- discovery
  // Phaser has no official devtools hook. The CDN/UMD build assigns
  // `window.Phaser` once when it loads, so we install a setter that patches
  // Game.prototype.boot the moment Phaser arrives. Patching the prototype (not
  // replacing the Game class) also catches `class MyGame extends Phaser.Game`.
  //
  // EDIT HERE if the game bundles Phaser as an ES module (no window.Phaser):
  // ask the game to hand its game over with one line after creating it:
  //   window.__gameStudio?.attach({ phaserGame: game });
  // and read it below in findGame().
  const games = [];
  const loaded = new Map(); // texture key -> absolute URL, recorded from the loader
  let attached = null;
  const prevAttach = studio.attach;
  studio.attach = function (parts) {
    if (parts && parts.phaserGame) attached = parts.phaserGame;
    return prevAttach && prevAttach.call(this, parts);
  };

  function hookPhaser(P) {
    if (!P || P.__studioHooked || !P.Game) return;
    P.__studioHooked = true;
    const boot = P.Game.prototype.boot;
    P.Game.prototype.boot = function () {
      games.push(this);
      return boot.apply(this, arguments);
    };
    // Remember which URL each texture key came from, for assetsOf(). Phaser
    // turns loaded images into blob: URLs, so the image element does not tell.
    const LP = P.Loader && P.Loader.LoaderPlugin;
    if (LP && LP.prototype.addFile) {
      const addFile = LP.prototype.addFile;
      LP.prototype.addFile = function (file) {
        for (const f of [].concat(file)) {
          if (f && f.key && typeof f.url === 'string') {
            try { loaded.set(f.key, new URL((this.path || '') + f.url, new URL(this.baseURL || '', document.baseURI)).href); } catch (e) { /* keep going */ }
          }
        }
        return addFile.apply(this, arguments);
      };
    }
  }
  if (window.Phaser) hookPhaser(window.Phaser);
  else {
    let value;
    Object.defineProperty(window, 'Phaser', {
      configurable: true,
      enumerable: true,
      get() { return value; },
      set(v) { value = v; hookPhaser(v); },
    });
  }

  function findGame() {
    return attached || games.find((g) => g.isBooted && g.renderer) || null;
  }

  // ---------------------------------------------------------------- which objects
  const keyOf = new Map(); // key -> game object (rebuilt by objects())

  /**
   * Objects the user may move. Leave out UI (scrollFactor 0 = fixed to the
   * screen, e.g. score text), hidden objects, particles and things without a
   * size. Objects marked `studio = false` (or setData('studio', false)) are
   * hidden with everything inside them.
   * EDIT HERE to leave out more (for example a background layer by name).
   */
  function movable(o) {
    if (mark(o, 'studio') === false || !o.visible || o.active === false) return false;
    if (o.scrollFactorX === 0 && o.scrollFactorY === 0) return false; // HUD
    // A UI the game's code delivered as codeUi (its `size` is this object: studio-canvas-ui-3, 2026-10-24) is the UI
    // layer's now, moved there by the codeUi — never a world object too.
    // A container's parts too (a message panel delivered as one codeUi: its texts are not world objects either — the
    // real AI's run of 2026-10-25 had to patch its adapter for that).
    const ui = globalThis[Symbol.for('game-studio.codeUiObjects')];
    if (ui) for (let p = o; p; p = p.parentContainer) if (ui.has(p)) return false;
    if (/Particle|Emitter|Light|Zone/.test(o.type || '')) return false;
    // EDIT HERE if the game's score / hint texts are plain this.add.text(…)
    // without setScrollFactor(0) (common in AI-written games): they would be
    // listed as unnamed objects. Uncomment to leave every Text out:
    // if (o.type === 'Text') return false;
    if (typeof o.getBounds !== 'function') return false;
    // Nothing to see = nothing to grab (an empty text, an empty container).
    const b = o.getBounds();
    return b.width > 0 && b.height > 0;
  }
  function mark(o, name) {
    if (o[name] !== undefined) return o[name];
    if (name === 'studioKey' || name === 'studio' || name === 'studioAsset') {
      const v = o.getData && o.data ? o.getData(name) : undefined;
      if (v !== undefined) return v;
    }
    return undefined;
  }

  // Key order (CONTRACT §1.3): the game's own marker `studioKey` -> `name` ->
  // tree path. Names repeat in games ("cactus" for every cactus), so repeats
  // get #2, #3 in tree order. Paths are flagged unstable: they change when the
  // code adds an object earlier in the scene.
  const KEY_OK = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;
  const clean = (s) => String(s).replace(/[^A-Za-z0-9_:#.\-\/]/g, '_').slice(0, 80);

  function collect() {
    const game = findGame();
    const out = [];
    if (!game) return out;
    const seen = new Map();
    const scenes = game.scene.getScenes(true);
    scenes.forEach((scene) => {
      const walk = (list, path) => {
        list.forEach((o, i) => {
          if (mark(o, 'studio') === false) return;
          const p = path.concat(i);
          // Repeats are counted over EVERY named object in tree order (not
          // only movable ones), so a loader in the game can rebuild the same
          // keys without knowing what the studio considers movable.
          const own = mark(o, 'studioKey') || o.name;
          let key;
          let unstable = false;
          if (own) {
            key = clean(own);
            const n = (seen.get(key) || 0) + 1;
            seen.set(key, n);
            if (n > 1) key = `${key.slice(0, 76)}#${n}`;
          } else {
            key = `path:${clean(scene.sys.settings.key)}/${p.join('/')}`;
            unstable = true;
          }
          if (movable(o) && KEY_OK.test(key)) out.push({ o, key, unstable, scene });
          // Children of a container are candidates too (a named tree inside a
          // "forest" container can be moved on its own).
          if (o.list && Array.isArray(o.list)) walk(o.list, p);
        });
      };
      walk(scene.children.list, []);
    });
    return out;
  }

  // ---------------------------------------------------------------- screen maths
  // parent space -> world: the parent containers' transforms.
  // world -> game pixels: the scene's main camera (scroll, zoom, rotation).
  // game pixels -> CSS px: where the canvas sits and how it is scaled (FIT).
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const arr = (tm) => { const m = tm.matrix; return [m[0], m[1], m[2], m[3], m[4], m[5]]; };

  function worldToScreen(o, scene) {
    const game = findGame();
    const cam = scene.cameras.main;
    // matrixCombined is refreshed by cam.preRender() during render(); it maps
    // world points with scrollFactor 1. Objects with another scrollFactor
    // (parallax) scroll less, so put back the part of the scroll they skip.
    //
    // Phaser 3 (3.60-3.88) has no matrixCombined (dogfood 2026-10-17: the
    // CDN 3.80.1 game an AI writes first found no objects, and the AI spent
    // ten minutes finding this). There `cam.matrix` holds the viewport offset
    // (cam.x/y), rotation and zoom, and the renderer takes off
    // scroll × scrollFactor per object (GetCalcMatrix: camMatrix, then
    // multiplyWithOffset(parent, -scrollX * scrollFactorX, …)). Same picture,
    // built the Phaser 3 way. Phaser 4 keeps the path above.
    let m;
    if (cam.matrixCombined) {
      m = arr(cam.matrixCombined);
      const fx = 1 - (o.scrollFactorX ?? 1), fy = 1 - (o.scrollFactorY ?? 1);
      if (fx || fy) m = mul(m, [1, 0, 0, 1, cam.scrollX * fx, cam.scrollY * fy]);
    } else {
      m = mul(arr(cam.matrix), [1, 0, 0, 1, -cam.scrollX * (o.scrollFactorX ?? 1), -cam.scrollY * (o.scrollFactorY ?? 1)]);
    }
    const r = game.canvas.getBoundingClientRect();
    const css = [r.width / game.scale.width, 0, 0, r.height / game.scale.height, r.left, r.top];
    return mul(css, m);
  }

  function parentMatrix(o) {
    const pc = o.parentContainer;
    return pc ? arr(pc.getWorldTransformMatrix()) : [1, 0, 0, 1, 0, 0];
  }

  // ---------------------------------------------------------------- edit view
  // The edit camera moves only the picture: we change the main camera's scroll
  // and zoom (never an object), remember what the game had, and put it back
  // when the studio asks for {x: 0, y: 0, zoom: 1}. A camera that follows the
  // player would undo our scroll every frame, so following is paused too.
  let saved = null;
  function setView(v) {
    const game = findGame();
    if (!game) return;
    const identity = !v.x && !v.y && v.zoom === 1;
    for (const scene of game.scene.getScenes(true)) {
      const cam = scene.cameras.main;
      if (!saved) saved = new Map();
      if (!saved.has(cam)) saved.set(cam, { sx: cam.scrollX, sy: cam.scrollY, z: cam.zoom, follow: cam._follow });
      const s = saved.get(cam);
      if (identity) {
        cam.setScroll(s.sx, s.sy).setZoom(s.z);
        cam._follow = s.follow;
        continue;
      }
      cam._follow = null;
      const r = game.canvas.getBoundingClientRect();
      const cssPerPx = r.width / game.scale.width;
      const z = s.z * v.zoom;
      cam.setZoom(z);
      // A screen shift of (x, y) CSS px is (x, y) / (cssPerPx * zoom) world px.
      cam.setScroll(s.sx - v.x / (cssPerPx * z), s.sy - v.y / (cssPerPx * z));
    }
    if (identity) saved = null;
  }

  // ---------------------------------------------------------------- the port
  function find(key) {
    let hit = keyOf.get(key);
    if (hit && !hit.o.scene) hit = null; // destroyed since the last list
    if (!hit) { for (const e of collect()) keyOf.set(e.key, e); hit = keyOf.get(key); }
    return hit || null;
  }

  studio.register2D(() => {
    const game = findGame();
    if (!game || !game.isBooted) return null;
    return {
      name: 'phaser',
      version: (window.Phaser && window.Phaser.VERSION) || undefined,

      objects() {
        keyOf.clear();
        return collect().map((e) => {
          keyOf.set(e.key, e);
          const own = mark(e.o, 'studioKey') || e.o.name;
          return {
            key: e.key,
            label: own || `${e.o.type || 'Object'} (no name)`,
            kinds: [String(e.o.type || 'object').toLowerCase()],
            // Same texture = same kind of thing; shown once as "label ×N".
            group: (e.o.texture && e.o.texture.key && e.o.texture.key !== '__DEFAULT') ? e.o.texture.key : undefined,
            unstable: e.unstable || undefined,
          };
        });
      },

      get(key) {
        const e = find(key);
        if (!e) return null;
        const o = e.o;
        return { p: [o.x, o.y], r: o.rotation, s: o.scaleX === o.scaleY ? o.scaleX : [o.scaleX, o.scaleY] };
      },

      set(key, pose) {
        const e = find(key);
        if (!e) return;
        const o = e.o;
        o.setPosition(pose.p[0], pose.p[1]);
        if (pose.r !== undefined) o.setRotation(pose.r);
        if (pose.s !== undefined) Array.isArray(pose.s) ? o.setScale(pose.s[0], pose.s[1]) : o.setScale(pose.s);
        // Arcade Physics keeps its own copy of the position. Static bodies must
        // be refreshed by hand; dynamic ones are reset so the next physics step
        // does not drag the sprite back.
        if (o.body) {
          if (o.body.physicsType === 1 /* STATIC_BODY */ && o.refreshBody) o.refreshBody();
          else if (o.body.reset) o.body.reset(o.x, o.y);
        }
      },

      parentToScreen(key) {
        const e = find(key);
        return e ? mul(worldToScreen(e.o, e.scene), parentMatrix(e.o)) : null;
      },

      bounds(key) {
        const e = find(key);
        if (!e) return null;
        const b = e.o.getBounds(); // world space, parent containers included
        const m = worldToScreen(e.o, e.scene);
        const pts = [[b.x, b.y], [b.right, b.y], [b.x, b.bottom], [b.right, b.bottom]]
          .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
        const x = Math.min(...xs), y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      },

      // Draw one frame WITHOUT running game logic: this is Game.step() minus
      // the update part (no scene.update, no physics, no tweens).
      render() {
        const g = findGame();
        const r = g.renderer;
        r.preRender();
        g.scene.render(r);
        r.postRender();
      },

      setView,
      // The studio already holds requestAnimationFrame; sleeping the loop also
      // covers games configured with `fps.forceSetTimeOut`.
      pause() { const g = findGame(); g && g.loop.sleep(); },
      resume() { const g = findGame(); g && g.loop.wake(); },

      assetsOf(key) {
        const e = find(key);
        if (!e) return [];
        const out = [];
        const add = (o) => {
          const own = mark(o, 'studioAsset');
          if (own) out.push({ url: new URL(own, document.baseURI).href, how: 'other', sure: true });
          const k = o.texture && o.texture.key;
          if (k && loaded.has(k)) out.push({ url: loaded.get(k), how: 'texture', sure: true });
          if (o.list) o.list.forEach(add);
        };
        add(e.o);
        return out.filter((a, i) => out.findIndex((b) => b.url === a.url) === i);
      },

      canvas() { const g = findGame(); return g ? g.canvas : null; },

      // The UI left out above (scrollFactor 0 = fixed to the screen): its boxes on the page (CSS px). The editor draws a
      // faint dotted frame "Not selectable yet" there on its UI layer (studio-canvas-ui stage 2, 2026-10-24), and the
      // person's ✦ asks the AI to make it selectable. A container's parts one by one (a HUD in one container spans the
      // screen); a full-screen sky fixed to the screen is dropped by the editor (too big to be a UI part).
      leftOut() {
        const game = findGame();
        if (!game) return [];
        const out = [];
        const ui = globalThis[Symbol.for('game-studio.codeUiObjects')];
        const push = (o, scene, via) => {
          // A codeUi's object (or a part of one) is selectable already (stage 3): no dotted frame.
          if (!o || !o.visible || typeof o.getBounds !== 'function' || (ui && (ui.has(o) || ui.has(via)))) return;
          const b = o.getBounds();
          if (!(b.width > 0 && b.height > 0)) return;
          const m = worldToScreen(via, scene);
          const pts = [[b.x, b.y], [b.right, b.y], [b.x, b.bottom], [b.right, b.bottom]]
            .map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
          const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
          const x = Math.min(...xs), y = Math.min(...ys);
          out.push({ x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y });
        };
        game.scene.getScenes(true).forEach((scene) => {
          scene.children.list.forEach((o) => {
            if (!o || !o.visible || !(o.scrollFactorX === 0 && o.scrollFactorY === 0)) return;
            if (/Particle|Emitter|Light|Zone/.test(o.type || '')) return;
            // A container's children are drawn with the container's scroll factor (its matrix: `via`).
            if (o.list && o.list.length) o.list.forEach((c) => push(c, scene, o));
            else push(o, scene, o);
          });
        });
        return out.slice(0, 50);
      },
    };
  });
})();
