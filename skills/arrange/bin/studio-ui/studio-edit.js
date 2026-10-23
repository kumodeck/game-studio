/* KUMODeck Game Studio 0.1.28 — MIT License — built file, edit src/ instead */
(() => {
const __defs = [];
const __cache = [];
function __def(o, k, get) { Object.defineProperty(o, k, { get, enumerable: true }); }
function __star(o, src) { for (const k of Object.keys(src)) if (!(k in o)) __def(o, k, () => src[k]); }
function __require(id) {
  if (__cache[id]) return __cache[id];
  const __exports = (__cache[id] = {});
  __defs[id](__exports);
  return __exports;
}
__defs[0] = function (__exports) {
'use strict';
// ../core/native.ts

// The browser's own requestAnimationFrame, captured before anything else in
// the edit script wraps it.
//
// WHY: engine helpers that load early (the three.js boot script) wrap rAF to
// hold the game's frames. The studio's own loop (handles, selection outline,
// repaint after a resize) must keep running while the game is held, so it
// uses these, never window.requestAnimationFrame. src/bridge/main.ts imports
// this module first so the capture happens before any other wrapper.
const nativeRaf                                       =
  typeof window !== 'undefined' ? window.requestAnimationFrame.bind(window) : (cb) => setTimeout(() => cb(performance.now()), 16)                     ;
/**
 * The browser's own clock, captured before ▶ Play's game clock (play-clock.ts) takes the paused time out of
 * performance.now(). The editor's own timing (the outline's redraw gap, glides, holds) uses it: woken in a paused game
 * (bridge/play-move.ts, 2026-10-22) it read the game's stopped clock, so the outline never redrew after a drag
 * ("40 ms since the last one" never came).
 */
const nativeNow               =
  typeof performance !== 'undefined' ? performance.now.bind(performance) : () => Date.now();
const nativeCancelRaf                       =
  typeof window !== 'undefined' ? window.cancelAnimationFrame.bind(window) : (id) => clearTimeout(id);
/**
 * The browser's own timers and wall clock, captured before ▶ Play's game clock (play-clock.ts → play-timers.ts) makes
 * the window's setTimeout / setInterval / Date.now stop with the game (polish-1022, 2026-10-22: a game that steps from
 * a timer or Date.now kept running through a pause and through Edit). Every timer of the studio itself in the game page
 * (the line's fade, the long press, the self-check's waits, the three.js boot script's safety nets) uses these: on the
 * window's ones it would wait for the game to go on, and a paused game never goes on by itself.
 */
const nativeSetTimeout                                                       =
  typeof window !== 'undefined' ? (window.setTimeout.bind(window)                                                        ) : (fn, ms) => setTimeout(fn, ms)                     ;
const nativeClearTimeout                                   =
  typeof window !== 'undefined' ? window.clearTimeout.bind(window) : (id) => clearTimeout(id                                                 );
const nativeDateNow               = Date.now.bind(Date);

__def(__exports, "nativeRaf", () => nativeRaf);
__def(__exports, "nativeNow", () => nativeNow);
__def(__exports, "nativeCancelRaf", () => nativeCancelRaf);
__def(__exports, "nativeSetTimeout", () => nativeSetTimeout);
__def(__exports, "nativeClearTimeout", () => nativeClearTimeout);
__def(__exports, "nativeDateNow", () => nativeDateNow);
};
__defs[1] = function (__exports) {
'use strict';
// ../adapters/three/boot.js

/*
 * KUMODeck Game Studio — three.js boot script (classic script, NOT a module).
 *
 * This file must run BEFORE the game's own scripts: the editor inserts it as the very first <script> in <head>.
 * Everything here is about catching things that happen exactly once, early, and cannot be recovered later:
 *
 *   1. Discovery. three.js announces every Scene and WebGLRenderer it creates to `window.__THREE_DEVTOOLS__`
 *      (an EventTarget the browser devtools extension normally installs). We install our own EventTarget first and
 *      buffer what three tells us. Verified in r170 (Scene.js / WebGLRenderer.js) and r186 (three.core.js, which also
 *      announces Loader and AnimationMixer instances). If the hook is missing (very old three, or a bundle that strips
 *      it), the game can call `studio.attach({ scene, renderer, camera })` instead.
 *   2. Time. We wrap requestAnimationFrame so the editor can "hold" the game's frame callbacks (the game stops, the
 *      editor draws). three's setAnimationLoop also goes through window.requestAnimationFrame, so it is covered.
 *      It has to be wrapped before the game asks for its first frame, hence this early script.
 *   3. The camera. three never announces cameras, so we wrap renderer.render and remember the camera of the last
 *      call for each scene. That is the camera the player actually sees.
 *   4. Load records (for the asset library). fetch/XHR responses, image blobs → ImageBitmaps, and (r186+) the
 *      result of every three Loader.load() call, so a glTF scene can be traced back to the .glb URL it came from.
 *
 * Why a classic script and not a module: module scripts run after the document is parsed and after import maps
 * are read, in document order with the game's own modules. A classic script in <head> is the only thing that is
 * guaranteed to run before the game's `import * as THREE from 'three'` evaluates.
 *
 * Nothing here changes how the game behaves while the editor is not editing: the rAF wrapper passes callbacks
 * straight through and the render wrapper only records the camera.
 *
 * Edit-on-load: when the page URL has `studio=edit` (or `window.__STUDIO_EDIT_ON_LOAD__ = true` was set before this
 * script), the game is held right after its first rendered frame, so the editor sees the initial layout. A game
 * whose initial layout needs async work (models, physics settling) can call `studio.waitForReady()` early and
 * `studio.ready()` when the layout is final; the hold then happens at ready() (or after 8 s, as a safety net).
 */
(function () {
  'use strict';
  var g = typeof globalThis !== 'undefined' ? globalThis : window;
  if (g.__studioThree) return; // injected twice (e.g. a reload inside the same window) — keep the first
  // The browser's own setTimeout, taken now: in the editor the window's one later waits with the game's clock
  // (core/play-timers.ts, polish-1022), and the safety nets below must fire while the game is held. Kept on the state
  // for the adapter module (adapter.js whenThreeReady) too.
  var nativeTimeout = g.setTimeout.bind(g);

  var params = null;
  try { params = new URLSearchParams(location.search); } catch (e) { params = null; }
  var editOnLoad = g.__STUDIO_EDIT_ON_LOAD__ === true || (params !== null && params.get('studio') === 'edit');

  var state = {
    scenes: [],            // every Scene three announced (or attach() gave us), in creation order
    renderers: [],         // every WebGLRenderer
    lastCamera: new WeakMap(), // scene → camera of the last game render of that scene
    lastRenderAt: new WeakMap(), // scene → performance.now() of that render (the "main" scene is the busiest one)
    loads: [],             // { url, kind, at } — completed network loads, oldest first
    urlOf: new WeakMap(),  // Object3D | Texture | ImageBitmap | AudioBuffer | Blob → URL it was loaded from (sure)
    guessOf: new WeakMap(), // Object3D | BufferGeometry → model URL guessed from download order (not sure)
    listeners: [],         // fn(event, detail) — the adapter module subscribes when it loads
    editOnLoad: editOnLoad,
    waitingForReady: false,
    held: false,           // true while the game's frame callbacks are held
    gameRendered: false,
    selfRender: 0,         // >0 while the editor itself is calling renderer.render (not a game render)
    readyCamera: null,     // camera handed to studio.ready({ camera }) — used when the game was held before rendering
    holdAfterRender: false,
    holdAfterCamera: null, // ready({ camera }) before that camera drew: hold after its first render (see ready())
    placed: false,         // true from that render until the hold: the rest of that frame is not drawn (see wrapRender)
    setTimeout: nativeTimeout // the browser's own (see above)
  };
  g.__studioThree = state;

  function emit(type, detail) {
    for (var i = 0; i < state.listeners.length; i++) {
      try { state.listeners[i](type, detail); } catch (e) { console.warn('[studio] listener failed', e); }
    }
  }

  function absUrl(u, base) {
    try { return new URL(String(u), base || document.baseURI).href; } catch (e) { return String(u); }
  }

  // ------------------------------------------------------------------ 1. discovery
  function addScene(scene) {
    if (!scene || state.scenes.indexOf(scene) >= 0) return;
    state.scenes.push(scene);
    wrapAdd(scene);
    emit('scene', scene);
  }

  /*
   * Guessing which .glb a model came from when three does not announce its loaders (r170 and older).
   * We watch Object3D.prototype.add: when a subtree that looks loaded (its geometries are plain BufferGeometry, not
   * BoxGeometry & co., which carry `parameters`) is added for the first time, it is attributed to the oldest model
   * file that finished downloading in the last 10 s and is not claimed yet. Clones share geometry, so later copies
   * inherit the guess through the geometry. This is a guess (`sure: false` in the asset list); the author's mark
   * `userData.studioAsset` or a three build that announces loaders (r186+) makes it certain.
   */
  function wrapAdd(scene) {
    var proto = Object.getPrototypeOf(Object.getPrototypeOf(scene)); // Scene.prototype → Object3D.prototype
    if (!proto || typeof proto.add !== 'function' || proto.__studioAdd) return;
    var origAdd = proto.add;
    proto.__studioAdd = origAdd;
    proto.add = function () {
      for (var i = 0; i < arguments.length; i++) {
        try { guessModel(arguments[i]); } catch (e) { /* best effort */ }
      }
      return origAdd.apply(this, arguments);
    };
  }

  function guessModel(child) {
    if (!child || !child.isObject3D || state.urlOf.has(child) || state.guessOf.has(child)) return;
    var geos = [];
    var loadedLooking = true;
    child.traverse(function (o) {
      if (o.geometry) {
        geos.push(o.geometry);
        if (o.geometry.parameters) loadedLooking = false;
      }
    });
    if (!geos.length || !loadedLooking) return;
    for (var g = 0; g < geos.length; g++) if (state.urlOf.has(geos[g]) || state.guessOf.has(geos[g])) return; // known already
    var now = performance.now();
    for (var i = 0; i < state.loads.length; i++) {
      var L = state.loads[i];
      if (L.kind !== 'model' || L.claimed || now - L.at > 10000) continue;
      L.claimed = true;
      state.guessOf.set(child, L.url);
      for (var j = 0; j < geos.length; j++) state.guessOf.set(geos[j], L.url);
      return;
    }
  }

  function addRenderer(renderer) {
    if (!renderer || state.renderers.indexOf(renderer) >= 0) return;
    state.renderers.push(renderer);
    wrapRender(renderer);
    emit('renderer', renderer);
  }

  function wrapLoader(loader) {
    // r186+ announces Loader instances. Wrapping the instance's load() lets us tag what it produced with the URL —
    // the only reliable way to know which .glb a group of meshes came from (geometry carries no file name).
    if (!loader || typeof loader.load !== 'function' || loader.__studioWrapped) return;
    var orig = loader.load;
    loader.__studioWrapped = true;
    loader.load = function (url, onLoad, onProgress, onError) {
      var self = this;
      // three resolves `path + url` against the page, exactly like this (an absolute url ignores the base).
      var full = absUrl((self.path || '') + url);
      return orig.call(self, url, function (result) {
        try { tagResult(result, full); } catch (e) { /* tagging is best effort */ }
        if (onLoad) onLoad(result);
      }, onProgress, onError);
    };
  }

  function tagResult(result, url) {
    if (!result || typeof result !== 'object') return;
    if (/^(blob|data):/i.test(url)) return; // embedded bytes (GLTFLoader hands its textures over as blob: URLs)
    var root = result.scene && result.scene.isObject3D ? result.scene : result.isObject3D ? result : null;
    if (root) {
      // The download record of this file is now explained; it must not be handed to the next guess.
      for (var i = 0; i < state.loads.length; i++) if (state.loads[i].url === url) state.loads[i].claimed = true;
      state.urlOf.set(root, url);
      root.traverse(function (o) { if (o.geometry) state.urlOf.set(o.geometry, url); });
      return;
    }
    state.urlOf.set(result, url); // Texture, AudioBuffer, …
  }

  var hook = g.__THREE_DEVTOOLS__;
  if (!hook || typeof hook.addEventListener !== 'function') {
    hook = new EventTarget();
    g.__THREE_DEVTOOLS__ = hook;
  }
  hook.addEventListener('observe', function (ev) {
    var o = ev && ev.detail;
    if (!o) return;
    if (o.isScene) addScene(o);
    else if (o.isWebGLRenderer || (typeof o.render === 'function' && o.domElement && typeof o.setSize === 'function')) addRenderer(o);
    else if (typeof o.load === 'function' && 'manager' in o) wrapLoader(o);
  });

  // ------------------------------------------------------------------ 3. the camera (render wrapper)
  var seenCameras = new WeakSet(); // every camera a game render used (see ready())
  function wrapRender(renderer) {
    if (renderer.__studioRender) return;
    var orig = renderer.render;
    renderer.__studioRender = orig;
    renderer.render = function (scene, camera) {
      if (state.selfRender > 0) return orig.apply(this, arguments);
      if (scene && camera) {
        state.lastCamera.set(scene, camera);
        state.lastRenderAt.set(scene, performance.now());
        if (state.scenes.indexOf(scene) < 0 && scene.isScene) addScene(scene);
      }
      // While the editor holds the game, a game render (from a resize handler, a loader callback, …) would paint the
      // game camera over the editor view. Skip it and let the editor repaint instead.
      if (state.held) { emit('game-render-skipped', scene); return; }
      // The rest of the frame that only placed the camera (see below): post-processing of a picture nobody sees.
      if (state.placed) return;
      if (state.holdAfterCamera && camera === state.holdAfterCamera) {
        // The one frame ready({ camera }) lets run exists to let the game's frame code PLACE its camera; the
        // picture itself is thrown away (the editor draws its own at once). So the camera's own draw is skipped,
        // and with it everything later in the same frame, until the hold (speed pass, 2026-10-17).
        // WHY: on a slow GPU that draw was the slowest part of opening — Lantern Cove's first frame (shadow map,
        // water reflection, multisampled bloom chain, every shader compiled for the off-screen target) took 3.4–4 s
        // in the play test's software GL, and the editor then compiled every material again for the screen.
        // Renders BEFORE this one in the frame still run (a bake into a texture the editor's picture may need), and
        // the canvas keeps what it had (nothing yet), so no half-drawn picture flashes before the editor's.
        state.holdAfterCamera = null;
        state.placed = true;
        seenCameras.add(camera);
        state.gameRendered = true;
        // What render() would have done for the editor's first look: world matrices of the scene and the camera.
        if (scene.matrixWorldAutoUpdate !== false && scene.updateMatrixWorld) scene.updateMatrixWorld();
        if (camera.parent == null && camera.updateMatrixWorld) camera.updateMatrixWorld();
        queueMicrotask(function () { state.placed = false; putBackLayout(); hold('ready'); });
        return;
      }
      var r = orig.apply(this, arguments);
      if (camera) seenCameras.add(camera);
      if (!state.gameRendered) {
        state.gameRendered = true;
        if (state.editOnLoad && (!state.waitingForReady || state.holdAfterRender)) queueMicrotask(function () { hold(state.holdAfterRender ? 'ready' : 'first-frame'); });
      }
      return r;
    };
  }

  // ------------------------------------------------------------------ 2. time (rAF holder)
  var nativeRAF = g.requestAnimationFrame ? g.requestAnimationFrame.bind(g) : null;
  var nativeCAF = g.cancelAnimationFrame ? g.cancelAnimationFrame.bind(g) : null;
  var nextId = 1;
  var live = new Map();  // our id → native id (pending, not yet fired)
  var parked = new Map(); // our id → callback (fired while held; replayed on release)

  if (nativeRAF) {
    g.requestAnimationFrame = function (cb) {
      var id = nextId++;
      var nid = nativeRAF(function (ts) {
        live.delete(id);
        if (state.held && !state.watching) { parked.set(id, cb); return; }
        cb(ts);
      });
      live.set(id, nid);
      return id;
    };
    g.cancelAnimationFrame = function (id) {
      var nid = live.get(id);
      if (nid !== undefined) { nativeCAF(nid); live.delete(id); }
      parked.delete(id);
    };
  }

  function hold(reason) {
    if (state.held) return;
    state.held = true;
    emit('hold', reason || 'manual');
  }

  function release() {
    if (!state.held) return;
    state.held = false;
    state.watching = false;
    var cbs = Array.from(parked.values());
    parked.clear();
    // Replay on a real frame so the game sees a fresh timestamp (its clock will report a long delta — games
    // normally clamp dt; the editor reloads the game after saving anyway).
    if (cbs.length && nativeRAF) nativeRAF(function (ts) { for (var i = 0; i < cbs.length; i++) cbs[i](ts); });
    emit('release');
  }

  /**
   * Let the game's frame callbacks run while it stays held for drawing (its renders are still skipped, the editor's
   * picture does not change): the editor watches the first moments of play to find what the game moves by itself
   * (bridge/observe.ts, a hands-on try of 2026-10-19). Off again = parked as before.
   */
  function watch(on) {
    if (!on) { state.watching = false; return; }
    if (!state.held || state.watching) return;
    state.watching = true;
    var cbs = Array.from(parked.values());
    parked.clear();
    if (cbs.length && nativeRAF) nativeRAF(function (ts) { for (var i = 0; i < cbs.length; i++) cbs[i](ts); });
  }

  // ------------------------------------------------------------------ 4. load records
  var MODEL = /\.(glb|gltf|fbx|obj|stl|ply|3ds|dae|vrm)(\?|#|$)/i;
  var IMAGE = /\.(png|jpe?g|webp|gif|svg|avif|ktx2|basis|hdr|exr)(\?|#|$)/i;
  var SOUND = /\.(mp3|ogg|wav|m4a|aac|flac|opus)(\?|#|$)/i;
  function kindOf(url) {
    return MODEL.test(url) ? 'model' : IMAGE.test(url) ? 'image' : SOUND.test(url) ? 'sound' : 'other';
  }
  function record(url, how) {
    var full = absUrl(url);
    state.loads.push({ url: full, kind: kindOf(full), how: how, at: performance.now() });
    if (state.loads.length > 2000) state.loads.splice(0, 500); // a game that streams forever must not grow us forever
    emit('load', full);
  }

  if (g.fetch && g.Response) {
    var nativeFetch = g.fetch;
    g.fetch = function (input) {
      var url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
      return nativeFetch.apply(this, arguments).then(function (res) {
        if (res && res.ok) record(res.url || url, 'fetch');
        return res;
      });
    };
    // ImageBitmapLoader (used by GLTFLoader for external images) does fetch → blob → createImageBitmap.
    // Remember blob → URL so the bitmap (texture.image) can be traced to its file.
    var nativeBlob = g.Response.prototype.blob;
    g.Response.prototype.blob = function () {
      var url = this.url;
      return nativeBlob.call(this).then(function (b) { if (url) state.urlOf.set(b, absUrl(url)); return b; });
    };
  }
  if (g.createImageBitmap) {
    var nativeCIB = g.createImageBitmap;
    g.createImageBitmap = function (src) {
      var from = src && typeof src === 'object' ? state.urlOf.get(src) || (src.currentSrc || src.src) : null;
      return nativeCIB.apply(this, arguments).then(function (bmp) { if (from) state.urlOf.set(bmp, absUrl(from)); return bmp; });
    };
  }
  if (g.XMLHttpRequest) {
    var nativeOpen = g.XMLHttpRequest.prototype.open;
    g.XMLHttpRequest.prototype.open = function (method, url) {
      var xhr = this;
      xhr.addEventListener('load', function () { if (xhr.status >= 200 && xhr.status < 400) record(xhr.responseURL || url, 'xhr'); });
      return nativeOpen.apply(this, arguments);
    };
  }

  // ------------------------------------------------------------------ the `studio` global the game may call
  var api = g.studio && typeof g.studio === 'object' ? g.studio : {};
  /** For three builds without the devtools hook: `studio.attach({ scene, renderer, camera })`. */
  api.attach = function (o) {
    if (!o) return;
    if (o.renderer) addRenderer(o.renderer);
    if (o.scene) addScene(o.scene);
    if (o.scene && o.camera) state.lastCamera.set(o.scene, o.camera);
  };
  /** Call early (before the first frame) when the initial layout needs async work; then call ready(). */
  api.waitForReady = function () {
    if (!state.editOnLoad || state.held) return;
    state.waitingForReady = true;
    nativeTimeout(function () { if (state.waitingForReady) { state.waitingForReady = false; hold('ready-timeout'); } }, 8000);
  };
  /**
   * The initial layout is final. In edit-on-load mode the game is held here. A no-op otherwise.
   * Pass `{ camera }` when calling this before the game has rendered anything (e.g. before setAnimationLoop):
   * the editor learns the player's camera from renders, and without one it waits for the first render to hold.
   */
  api.ready = function (opts) {
    state.waitingForReady = false;
    if (opts && opts.camera) state.readyCamera = opts.camera;
    if (state.editOnLoad) {
      if (opts && opts.camera && !seenCameras.has(opts.camera)) {
        // The game's camera has not drawn yet (ready() before the game loop starts, as the starters do). Let the
        // game run ONE frame first (since the speed pass its draw with that camera is skipped: wrapRender), then hold — with every object put back where it was right now
        // (polish pass 2026-10-16). WHY: the camera is usually placed by the frame code (a follow camera, an
        // opening shot). Held here, before that frame, the camera was still at the origin, and the editor could
        // not open on the player's picture (adapter view.home). The layout at ready() is what the game promised
        // as final, so anything the one frame moved (a boat bobbing, physics settling one step) goes back; only
        // cameras keep the frame's pose. "Drawn with THIS camera", not "anything drawn": a game that bakes its
        // sky with a cube camera before ready() has rendered, but not as the player. If no frame comes (a game
        // that waits for a click to start drawing), hold anyway after 1.5 s.
        snapLayout();
        state.holdAfterCamera = opts.camera;
        nativeTimeout(function () { if (state.holdAfterCamera) { state.holdAfterCamera = null; putBackLayout(); hold('ready'); } }, 1500);
      } else if (state.gameRendered || state.readyCamera) hold('ready');
      else state.holdAfterRender = true;
    }
    emit('ready');
  };

  // Object poses at ready(): object → [px, py, pz, rx, ry, rz, order, sx, sy, sz]. Cameras are left out (see ready()).
  // The Euler angles, not the quaternion: setting a quaternion makes three re-derive the angles, and a boat turned
  // 115° came back as (180°, 65°, 180°) — the same turn, but the editor then showed it as tilted upside down.
  var snapshot = null;
  function snapLayout() {
    snapshot = new Map();
    for (var i = 0; i < state.scenes.length; i++) {
      state.scenes[i].traverse(function (o) {
        if (o.isCamera || !o.position || !o.rotation || !o.scale) return;
        var r = o.rotation;
        snapshot.set(o, [o.position.x, o.position.y, o.position.z, r.x, r.y, r.z, r.order, o.scale.x, o.scale.y, o.scale.z]);
      });
    }
  }
  function putBackLayout() {
    if (!snapshot) return;
    snapshot.forEach(function (p, o) {
      o.position.set(p[0], p[1], p[2]);
      o.rotation.set(p[3], p[4], p[5], p[6]); // also updates the quaternion (three keeps them in sync)
      o.scale.set(p[7], p[8], p[9]);
    });
    snapshot = null;
    for (var i = 0; i < state.scenes.length; i++) state.scenes[i].updateMatrixWorld(true);
  }
  g.studio = api;

  // Used by the adapter module (same window, loaded later).
  state.hold = hold;
  state.release = release;
  state.watch = watch;
  state.nativeRAF = nativeRAF;
  // The browser's own clock (boot runs before ▶ Play's game clock, play-clock.ts, stops performance.now() in a pause):
  // the edit view's glides and the turn pivot time themselves with it, also in a paused game (pause-move, 2026-10-22).
  state.now = performance.now.bind(performance);
  state.on = function (fn) { state.listeners.push(fn); };
  state.kindOf = kindOf;
  state.absUrl = absUrl;
})();


};
__defs[2] = function (__exports) {
'use strict';
// ../adapters/three/keys.js

/**
 * Which objects of a three.js scene can be moved, and the stable key of each one.
 *
 * Pure functions over the Object3D shape (children, name, userData, isMesh, …) — no three import, so the same file
 * runs in the editor, in the placement loader the game ships, and in Node tests with plain objects.
 * The editor and the loader MUST agree on keys byte for byte: placement.json is keyed by them.
 *
 * Candidates ("the meaningful top-most node that contains a mesh"):
 *   - a node with the author's mark `userData.studioKey`, or with a name, or directly under the scene
 *   - that has at least one mesh in its subtree
 *   - not a light, camera, helper, line, point cloud, sprite, InstancedMesh, or anything marked `userData.studio = false`
 *     (InstancedMesh / merged geometry / particles have no single body to move)
 *   - once a node is a candidate we do not descend into it (moving a car moves its wheels), with two exceptions:
 *       · a descendant with an explicit `userData.studioKey` is also listed (the author asked for it)
 *       · `userData.studio = 'children'` on a node means "list my children, not me" (a level group, a glTF scene root)
 *   - an unnamed, mesh-less group directly under the scene that holds 2+ mesh-bearing children is treated as a
 *     plain container and its children are listed instead (the common `const world = new Group()` pattern),
 *     unless the code placed the group itself (a barn built from walls, roof and door: one object; see
 *     isPlainContainer)
 *
 * Keys, first that applies (see the placement plan §4-2):
 *   1. `userData.studioKey` — the author's explicit mark; the most stable (names get reused, e.g. every tree "tree")
 *   2. `name`; the 2nd object with the same name in traversal order gets `name#2`, the 3rd `name#3`, …
 *   3. `userData.id` / `userData.name`
 *   4. the position in the tree, `path:0/3/1` (child indices from the scene) — UNSTABLE: any code change that adds
 *      an object earlier in the tree shifts it. Listed with `unstable: true` so the editor can say "no name".
 * Keys match /^[A-Za-z0-9_:#.\-\/]{1,80}$/. Other characters become "_" and the original text stays in `label`.
 */

const KEY_RE = /^[A-Za-z0-9_:#.\-/]{1,80}$/;
const MAX_CANDIDATES = 500; // same cap as placement.json; a scene with more movable things is out of scope

/** Make any string a valid key (keeps it readable: "Big Tree (1)" → "Big_Tree__1_"). */
function sanitizeKey(s) {
  let k = String(s).replace(/[^A-Za-z0-9_:#.\-/]/g, '_').slice(0, 80);
  if (!k) k = '_';
  return k;
}

/** Things that are never movable on their own. */
function isExcluded(o) {
  if (!o) return true;
  const ud = o.userData || {};
  if (ud.studio === false) return true;
  if (o.isLight || o.isCamera || o.isBone || o.isAudio || o.isAudioListener) return true;
  if (o.isInstancedMesh || o.isBatchedMesh || o.isPoints || o.isLine || o.isSprite) return true;
  // Helpers (GridHelper, AxesHelper, BoxHelper, …) are Lines; the light/camera helpers are groups named by type.
  if (typeof o.type === 'string' && /Helper$/.test(o.type)) return true;
  return false;
}

function hasMesh(o) {
  if (isExcluded(o)) return false;
  if (o.isMesh || o.isSkinnedMesh) return true;
  const c = o.children || [];
  for (let i = 0; i < c.length; i++) if (hasMesh(c[i])) return true;
  return false;
}

function meshChildCount(o) {
  let n = 0;
  for (const c of o.children || []) if (hasMesh(c)) n++;
  return n;
}

/** Has the code placed this node itself (moved, turned or sized it)? Missing fields count as untouched. */
function isPlaced(o) {
  const p = o.position, r = o.rotation, s = o.scale;
  if (p && (p.x || p.y || p.z)) return true;
  if (r && (r.x || r.y || r.z)) return true;
  if (s && ((s.x ?? 1) !== 1 || (s.y ?? 1) !== 1 || (s.z ?? 1) !== 1)) return true;
  return false;
}

/** A child that is itself made of 2+ mesh-bearing parts (a tree group inside a forest, a house inside a town). */
function hasCompositeChild(o) {
  for (const c of o.children || []) if (!c.isMesh && !c.isSkinnedMesh && meshChildCount(c) >= 2) return true;
  return false;
}

/** More mesh-bearing children than one built thing has (a barn is 3-10 parts; a level is dozens). */
const MAX_PARTS = 32;

/**
 * An unnamed group directly under the scene: a plain container (list its children) or one object made of parts?
 *
 * WHY the extra tests (dogfood 2026-10-17, "U4"): an AI-written three.js farm builds its barn as
 * `const barn = new Group(); barn.position.set(-6, 0, -5); barn.add(walls, roof, door)`, with no names. The old rule
 * ("unnamed, 2+ mesh children = a container like `const world = new Group()`") listed walls, roof and door as three
 * rows, and clicking the barn selected only its door: the person could not move the barn. A group the code placed
 * itself (moved, turned, sized) is a thing, not a folder; `world` groups sit at the origin. Still a container even
 * when placed: one that holds composite things (a forest of tree groups) or more parts than a thing has.
 * A thing built at the origin out of parts with absolute positions still lists its parts (as before): the person
 * can name it, or the AI can mark it (`userData.studioKey`).
 */
function isPlainContainer(o, parentIsScene) {
  const ud = o.userData || {};
  if (ud.studio === 'children') return true;
  if (ud.studioKey != null) return false;
  if (!parentIsScene || o.name) return false;
  if (o.isMesh || o.isSkinnedMesh) return false;
  const parts = meshChildCount(o);
  if (parts < 2) return false;
  return !isPlaced(o) || hasCompositeChild(o) || parts > MAX_PARTS;
}

/**
 * Walk the scene and return candidates in traversal order:
 * [{ object, key, label, unstable, source: 'mark'|'name'|'userData'|'path', path }]
 */
function collectCandidates(scene) {
  const found = [];
  const walk = (o, path, parentIsScene, insideCandidate) => {
    if (found.length >= MAX_CANDIDATES) return;
    if (isExcluded(o)) return;
    const ud = o.userData || {};
    const marked = ud.studioKey != null && ud.studioKey !== '';
    if (!insideCandidate || marked) {
      if (isPlainContainer(o, parentIsScene)) {
        (o.children || []).forEach((c, i) => walk(c, path.concat(i), true, false));
        return;
      }
      const meaningful = marked || !!o.name || parentIsScene;
      if (meaningful && hasMesh(o)) {
        found.push({ object: o, path });
        (o.children || []).forEach((c, i) => walk(c, path.concat(i), false, true));
        return;
      }
    }
    (o.children || []).forEach((c, i) => walk(c, path.concat(i), false, insideCandidate));
  };
  (scene.children || []).forEach((c, i) => walk(c, [i], true, false));
  return assignKeys(found);
}

function assignKeys(found) {
  const used = new Set();
  const nameCount = new Map();
  const out = [];
  const take = (base) => {
    let k = base;
    for (let n = 2; used.has(k); n++) k = sanitizeKey(`${base.slice(0, 74)}#${n}`);
    used.add(k);
    return k;
  };
  // Pass 1: explicit marks claim their keys first, so a later name can never steal an author's key.
  const marks = new Map();
  for (const f of found) {
    const ud = f.object.userData || {};
    if (ud.studioKey != null && ud.studioKey !== '') marks.set(f, take(sanitizeKey(ud.studioKey)));
  }
  for (const f of found) {
    const o = f.object;
    const ud = o.userData || {};
    const pathStr = f.path.join('/');
    let key;
    let source;
    let label;
    if (marks.has(f)) {
      key = marks.get(f);
      source = 'mark';
      label = String(ud.studioKey);
    } else if (o.name) {
      const n = (nameCount.get(o.name) || 0) + 1;
      nameCount.set(o.name, n);
      const base = sanitizeKey(o.name);
      key = take(n === 1 ? base : sanitizeKey(`${base.slice(0, 74)}#${n}`));
      source = 'name';
      label = o.name;
    } else if (ud.id != null && ud.id !== '' && (typeof ud.id === 'string' || typeof ud.id === 'number')) {
      key = take(sanitizeKey(ud.id));
      source = 'userData';
      label = String(ud.id);
    } else if (typeof ud.name === 'string' && ud.name) {
      key = take(sanitizeKey(ud.name));
      source = 'userData';
      label = ud.name;
    } else {
      key = take(`path:${pathStr}`);
      source = 'path';
      label = null;
    }
    out.push({ object: o, key, label: label ?? key, unstable: source === 'path', source, path: pathStr });
  }
  return out;
}

/** Map key → Object3D for a scene (what the loader needs). */
function keyMap(scene) {
  const m = new Map();
  for (const c of collectCandidates(scene)) m.set(c.key, c.object);
  return m;
}

__def(__exports, "KEY_RE", () => KEY_RE);
__def(__exports, "sanitizeKey", () => sanitizeKey);
__def(__exports, "isExcluded", () => isExcluded);
__def(__exports, "collectCandidates", () => collectCandidates);
__def(__exports, "keyMap", () => keyMap);
};
__defs[3] = function (__exports) {
'use strict';
// ../adapters/three/math.js

/**
 * Small vector / matrix helpers on plain arrays and three's column-major `matrix.elements`.
 *
 * Why not use three's own Raycaster / Box3 / Vector3: the adapter must not bundle a copy of three (it would be a
 * different version than the game's, with its own class identities), and the game's three is a module we cannot
 * import by name (it may be bundled, renamed, or behind an import map). Instances we touch (object.position,
 * camera.matrixWorld) still come from the game's three; anything we compute ourselves lives here.
 */

const v = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => {
    const l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
};

/** Transform point [x,y,z] by a 4x4 column-major matrix (elements array). */
function applyM4(e, p) {
  const [x, y, z] = p;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
  return [(e[0] * x + e[4] * y + e[8] * z + e[12]) / w, (e[1] * x + e[5] * y + e[9] * z + e[13]) / w, (e[2] * x + e[6] * y + e[10] * z + e[14]) / w];
}

/** Transform a direction (no translation). */
function applyM4Dir(e, d) {
  const [x, y, z] = d;
  return [e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z];
}

/** Multiply two column-major 4x4 matrices: a × b. */
function mulM4(a, b) {
  const o = new Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/** Inverse of a column-major 4x4 matrix (null when singular, e.g. scale 0). */
function invertM4(m) {
  const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = m;
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (!det) return null;
  const d = 1 / det;
  return [
    t11 * d,
    (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * d,
    (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * d,
    (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * d,
    t12 * d,
    (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * d,
    (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * d,
    (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * d,
    t13 * d,
    (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * d,
    (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * d,
    (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * d,
    t14 * d,
    (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * d,
    (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * d,
    (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * d
  ];
}

/**
 * Project a world point with a camera (projection × view). Returns [ndcX, ndcY, ndcZ, clipW]; clipW <= 0 means the
 * point is behind the camera (its ndc is meaningless).
 */
function project(viewProj, p) {
  const e = viewProj;
  const [x, y, z] = p;
  const cx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const cy = e[1] * x + e[5] * y + e[9] * z + e[13];
  const cz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
  return [cx / cw, cy / cw, cz / cw, cw];
}

/** projection × matrixWorldInverse of a three camera whose matrices are up to date. */
function viewProjOf(camera) {
  return mulM4(camera.projectionMatrix.elements, camera.matrixWorldInverse.elements);
}

/** World-space ray through an ndc point: { o: origin, d: unit direction }. Works for perspective and orthographic. */
function rayFromCamera(camera, ndcX, ndcY) {
  const projInv = camera.projectionMatrixInverse ? camera.projectionMatrixInverse.elements : invertM4(camera.projectionMatrix.elements);
  const world = camera.matrixWorld.elements;
  const near = applyM4(world, applyM4(projInv, [ndcX, ndcY, -1]));
  const far = applyM4(world, applyM4(projInv, [ndcX, ndcY, 1]));
  return { o: near, d: v.norm(v.sub(far, near)) };
}

/** Where a ray meets the horizontal plane y = h (null when parallel or behind). */
function rayPlaneY(ray, h) {
  if (Math.abs(ray.d[1]) < 1e-9) return null;
  const t = (h - ray.o[1]) / ray.d[1];
  if (t < 0) return null;
  return v.add(ray.o, v.scale(ray.d, t));
}

/** Slab test: distance along the ray to an axis-aligned box, or null. min/max are [x,y,z]. */
function rayBox(ray, min, max) {
  let t0 = -Infinity;
  let t1 = Infinity;
  for (let i = 0; i < 3; i++) {
    const inv = 1 / ray.d[i];
    let a = (min[i] - ray.o[i]) * inv;
    let b = (max[i] - ray.o[i]) * inv;
    if (a > b) [a, b] = [b, a];
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  return Math.max(t0, 0);
}

/** Möller–Trumbore, double sided. Returns distance along the ray or null. */
function rayTriangle(o, d, a, b, c) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = v.cross(d, e2);
  const det = v.dot(e1, p);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const u = v.dot(s, p) * inv;
  if (u < 0 || u > 1) return null;
  const q = v.cross(s, e1);
  const w = v.dot(d, q) * inv;
  if (w < 0 || u + w > 1) return null;
  const t = v.dot(e2, q) * inv;
  return t > 1e-9 ? t : null;
}

/** The 8 corners of a box. */
function boxCorners(min, max) {
  const out = [];
  for (let i = 0; i < 8; i++) out.push([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  return out;
}

/** Angle into (-π, π]. */
function wrapAngle(a) {
  let r = a % (Math.PI * 2);
  if (r <= -Math.PI) r += Math.PI * 2;
  if (r > Math.PI) r -= Math.PI * 2;
  return r;
}

__def(__exports, "v", () => v);
__def(__exports, "applyM4", () => applyM4);
__def(__exports, "applyM4Dir", () => applyM4Dir);
__def(__exports, "mulM4", () => mulM4);
__def(__exports, "invertM4", () => invertM4);
__def(__exports, "project", () => project);
__def(__exports, "viewProjOf", () => viewProjOf);
__def(__exports, "rayFromCamera", () => rayFromCamera);
__def(__exports, "rayPlaneY", () => rayPlaneY);
__def(__exports, "rayBox", () => rayBox);
__def(__exports, "rayTriangle", () => rayTriangle);
__def(__exports, "boxCorners", () => boxCorners);
__def(__exports, "wrapAngle", () => wrapAngle);
};
__defs[4] = function (__exports) {
'use strict';
// ../adapters/three/pick.js

/**
 * Bounds, ray casts and "pick near a point" for three.js objects, without three's Raycaster (see math.js for why).
 *
 * pickNear rules (learned the hard way on real games — keep them unless a test shows a better order):
 *   candidates = objects the ray hits + objects one of whose shapes is within `radiusPx` of the pressed point (a
 *                ring of rays around the press hits it; only tried when the on-screen box — 8 projected corners of
 *                the world box — is that near). A box alone is not enough (a web demo try 2026-10-18, "clicking an empty
 *                spot doesn't deselect"): Lantern Cove's lighthouse has a long light beam, so its box covered half
 *                the sky, and a click on the empty sky picked the lighthouse again instead of dropping it.
 *   order      = 1. visible before hidden. "Visible" = a ray through a point of the object's screen box (the point
 *                   nearest the press, pulled 1/4 toward the box centre) hits this object first. We do NOT compare
 *                   depths at the pressed point: tapping slightly beside a coin on a hill hits the hill in front of
 *                   the coin, and a depth test would wrongly call the coin hidden — the case we most want to win.
 *                2. score = distance from the press to the screen box (0 inside) + 0.25 × √(box area in px²).
 *                   Size matters because big things (ground, hills, buildings) contain the press point (distance 0)
 *                   and would always beat the small thing next to it. Big things are easy to pick elsewhere; small
 *                   things are not. e.g. a 30 px coin missed by 10 px (10 + 7.5) beats a 600×400 px hill (0 + 122).
 *                   For an object the ray hits, the box is that of the mesh under the finger (a lighthouse's tower,
 *                   not the tower + its wide light beam), so a finger ON a thin tall thing keeps it.
 *                3. nearer to the camera first. At most 8 results.
 */

const { applyM4, applyM4Dir, invertM4, boxCorners, project, rayBox, rayTriangle, rayFromCamera, v } = __require(3);
const { isExcluded } = __require(2);

const MAX_TRIS = 200000; // above this we use the box only: a click must never freeze the page

/** Visible meshes in a subtree (respecting `visible` and exclusions). */
function meshesOf(object) {
  const out = [];
  const walk = (o) => {
    if (!o.visible || isExcluded(o)) return;
    if ((o.isMesh || o.isSkinnedMesh) && o.geometry) out.push(o);
    for (const c of o.children) walk(c);
  };
  walk(object);
  return out;
}

function localBox(mesh) {
  const g = mesh.geometry;
  if (!g.boundingBox && typeof g.computeBoundingBox === 'function') g.computeBoundingBox();
  const b = g.boundingBox;
  if (!b || !isFinite(b.min.x) || !isFinite(b.max.x)) return null;
  return [[b.min.x, b.min.y, b.min.z], [b.max.x, b.max.y, b.max.z]];
}

/** The 8 corners of each mesh's geometry box, in world space. Matrices must be current. */
function worldCorners(object) {
  const pts = [];
  for (const m of meshesOf(object)) {
    const b = localBox(m);
    if (!b) continue;
    for (const c of boxCorners(b[0], b[1])) pts.push(applyM4(m.matrixWorld.elements, c));
  }
  return pts;
}

/** Axis-aligned world box of a subtree, { min, max } or null when nothing visible. */
function worldBox(object) {
  const pts = worldCorners(object);
  if (!pts.length) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of pts) for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], p[i])), (max[i] = Math.max(max[i], p[i]));
  return { min, max };
}

/**
 * Screen box of a subtree in ndc: [minX, minY, maxX, maxY], from the corners in front of the camera (null when all
 * are behind). Corners behind the camera are skipped — they would project mirrored.
 */
function screenRect(object, viewProj) {
  let r = null;
  for (const p of worldCorners(object)) {
    const q = project(viewProj, p);
    if (q[3] <= 0) continue;
    if (!r) r = [q[0], q[1], q[0], q[1]];
    else (r[0] = Math.min(r[0], q[0])), (r[1] = Math.min(r[1], q[1])), (r[2] = Math.max(r[2], q[0])), (r[3] = Math.max(r[3], q[1]));
  }
  return r;
}

/** w (distance in front of the camera) where screenShare() cuts box edges that run behind the camera. */
const NEAR_W = 1e-3;

/**
 * Share (0–1) of the canvas covered by the object's on-screen box, for "is this the ground?" (bridge/input.ts:
 * a tap on a huge object is a tap on nothing, a drag on it looks around). Box edges that run behind the camera are
 * cut just in front of it, and the box is clipped to the canvas. WHY not screenRect (2026-10-18): it skips corners
 * behind the camera, so a ground plane that runs on under the camera came out as its far strip only (a farm's
 * 60 m field seen from 9 m up: ~25 % of the screen instead of ~90 %), and a tap on the grass picked the ground.
 * Every pair of corners is cut, not only the 12 edges: the box is convex, so each crossing point is inside it.
 */
function screenShare(object, viewProj) {
  let r = null;
  const add = (q) => {
    const x = Math.min(1, Math.max(-1, q[0])), y = Math.min(1, Math.max(-1, q[1]));
    if (!r) r = [x, y, x, y];
    else (r[0] = Math.min(r[0], x)), (r[1] = Math.min(r[1], y)), (r[2] = Math.max(r[2], x)), (r[3] = Math.max(r[3], y));
  };
  for (const m of meshesOf(object)) {
    const b = localBox(m);
    if (!b) continue;
    const ps = boxCorners(b[0], b[1]).map((c) => applyM4(m.matrixWorld.elements, c));
    const qs = ps.map((p) => project(viewProj, p));
    for (const q of qs) if (q[3] > NEAR_W) add(q);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const wi = qs[i][3], wj = qs[j][3];
        if ((wi > NEAR_W) === (wj > NEAR_W)) continue;
        // w is linear along the segment in world space: cut where it equals NEAR_W.
        const t = (wi - NEAR_W) / (wi - wj);
        add(project(viewProj, v.add(ps[i], v.scale(v.sub(ps[j], ps[i]), t))));
      }
    }
  }
  return r ? ((r[2] - r[0]) * (r[3] - r[1])) / 4 : 0;
}

/** Nearest hit distance of a world ray against one mesh (triangles; box only for skinned / huge meshes). */
function rayMesh(ray, mesh) {
  const b = localBox(mesh);
  if (!b) return null;
  const inv = invertM4(mesh.matrixWorld.elements);
  if (!inv) return null;
  const o = applyM4(inv, ray.o);
  const d = applyM4Dir(inv, ray.d); // not normalised: t stays comparable after mapping back to world
  if (rayBox({ o, d }, b[0], b[1]) === null) return null;
  const g = mesh.geometry;
  const pos = g.attributes && g.attributes.position;
  const toWorld = (t) => v.len(v.sub(applyM4(mesh.matrixWorld.elements, v.add(o, v.scale(d, t))), ray.o));
  if (mesh.isSkinnedMesh || !pos || g.morphAttributes?.position?.length) return toWorld(rayBox({ o, d }, b[0], b[1]));
  const index = g.index;
  const start = Math.max(0, g.drawRange?.start || 0);
  const total = index ? index.count : pos.count;
  const end = Math.min(total, start + (isFinite(g.drawRange?.count) ? g.drawRange.count : total));
  if ((end - start) / 3 > MAX_TRIS) return toWorld(rayBox({ o, d }, b[0], b[1]));
  let best = null;
  const P = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i)];
  for (let i = start; i + 2 < end; i += 3) {
    const ia = index ? index.getX(i) : i;
    const ib = index ? index.getX(i + 1) : i + 1;
    const ic = index ? index.getX(i + 2) : i + 2;
    const t = rayTriangle(o, d, P(ia), P(ib), P(ic));
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best === null ? null : toWorld(best);
}

/** Nearest hit of a ray against a whole subtree. */
function rayObject(ray, object) {
  return rayObjectHit(ray, object)?.t ?? null;
}

/** Nearest hit of a ray against a whole subtree, with the mesh it hit: { t, mesh } or null. */
function rayObjectHit(ray, object) {
  let best = null;
  for (const m of meshesOf(object)) {
    const t = rayMesh(ray, m);
    if (t !== null && (best === null || t < best.t)) best = { t, mesh: m };
  }
  return best;
}

/**
 * Screen box (ndc, NOT clipped to the canvas) of world boxes' corners, for pickNear's distance and size. Like
 * screenShare, a box edge that runs behind the camera is cut just in front of it instead of dropping the corners
 * behind (screenRect does that): the cut points land far outside the canvas, so a ground running on under the camera
 * comes out as big as it is.
 * WHY (glow-camera pass 2026-10-20): with corners dropped, a 400 m ground seen from inside came out as its far strip,
 * a band 1 px high near the horizon — "size" ≈ 0, so under the finger the ground scored 0.25 and beat every lantern
 * (≈ 10) standing on it: a tap on a lantern picked the ground, i.e. nothing. It showed when Glow Garden's ground grew
 * to the horizon (studio-ui-layer: no world object under the UI any more); any game whose ground or sea runs under the
 * camera had the same order. Unclipped on purpose: clipping to the canvas would shrink things that stand partly off
 * screen and change which of them wins (W1 merge, 2026-10-17).
 */
function cutRect(boxes, viewProj) {
  let r = null;
  const add = (q) => {
    if (!r) r = [q[0], q[1], q[0], q[1]];
    else (r[0] = Math.min(r[0], q[0])), (r[1] = Math.min(r[1], q[1])), (r[2] = Math.max(r[2], q[0])), (r[3] = Math.max(r[3], q[1]));
  };
  for (const ps of boxes) {
    const qs = ps.map((p) => project(viewProj, p));
    for (const q of qs) if (q[3] > NEAR_W) add(q);
    for (let i = 0; i < ps.length; i++) {
      for (let j = i + 1; j < ps.length; j++) {
        const wi = qs[i][3], wj = qs[j][3];
        if ((wi > NEAR_W) === (wj > NEAR_W)) continue;
        const t = (wi - NEAR_W) / (wi - wj);
        add(project(viewProj, v.add(ps[i], v.scale(v.sub(ps[j], ps[i]), t))));
      }
    }
  }
  return r;
}
/** The world corners of one mesh's own geometry box, or null. */
function meshCorners(mesh) {
  const b = localBox(mesh);
  return b ? boxCorners(b[0], b[1]).map((c) => applyM4(mesh.matrixWorld.elements, c)) : null;
}
/** pickNear's screen box of a subtree (cutRect over each mesh's box), or null. */
function objectCutRect(object, viewProj) {
  return cutRect(meshesOf(object).map(meshCorners).filter(Boolean), viewProj);
}
/** pickNear's screen box of ONE mesh's own geometry box (not its children), or null. */
function meshScreenRect(mesh, viewProj) {
  const ps = meshCorners(mesh);
  return ps ? cutRect([ps], viewProj) : null;
}

/** Ring fractions of the radius and rays per ring for nearMiss(): 3 × 12 = 36 rays at most, only for an object
 *  whose box is near the press but which the press itself missed. 12 directions = 30° apart, so a 3 px lamp post
 *  12 px away is still crossed by the outer ring's horizontal ray. */
const RINGS = [1 / 3, 2 / 3, 1];
const RAYS_PER_RING = 12;

/** Distance in px (the smallest ring) at which a ray around (px, py) hits `object`, or null when none within radiusPx. */
function nearMiss(camera, object, px, py, radiusPx, W, H) {
  if (!(radiusPx > 0)) return null;
  for (const f of RINGS) {
    const r = radiusPx * f;
    // Each ring turned by half a step against the one before, so the rays do not line up.
    const turn = (RINGS.indexOf(f) % 2) * (Math.PI / RAYS_PER_RING);
    for (let i = 0; i < RAYS_PER_RING; i++) {
      const a = turn + (i * 2 * Math.PI) / RAYS_PER_RING;
      const x = px + Math.cos(a) * r;
      const y = py + Math.sin(a) * r;
      if (rayObject(rayFromCamera(camera, (x / W) * 2 - 1, 1 - (y / H) * 2), object) !== null) return r;
    }
  }
  return null;
}

/**
 * cands: [{ key, object }]. camera: matrices current. size: [cssW, cssH] of the canvas.
 * Returns keys, best first (see the rules at the top of the file).
 */
function pickNear(cands, camera, viewProj, ndcX, ndcY, radiusPx, size) {
  const [W, H] = size;
  const toPx = (nx, ny) => [((nx + 1) / 2) * W, ((1 - ny) / 2) * H];
  const [px, py] = toPx(ndcX, ndcY);
  const ray = rayFromCamera(camera, ndcX, ndcY);
  const hits = new Map();
  const hitMesh = new Map();
  for (const c of cands) {
    const h = rayObjectHit(ray, c.object);
    if (h) hits.set(c, h.t), hitMesh.set(c, h.mesh);
  }
  const rows = [];
  for (const c of cands) {
    const r = objectCutRect(c.object, viewProj);
    if (!r) continue;
    const [x0, y1] = toPx(r[0], r[1]);
    const [x1, y0] = toPx(r[2], r[3]);
    const dx = px < x0 ? x0 - px : px > x1 ? px - x1 : 0;
    const dy = py < y0 ? y0 - py : py > y1 ? py - y1 : 0;
    let dist = hits.has(c) ? 0 : Math.hypot(dx, dy);
    if (!hits.has(c)) {
      if (dist > radiusPx) continue;
      // Near the box is not near the object (see the rules at the top): one of its shapes must be within the radius.
      const near = nearMiss(camera, c.object, px, py, radiusPx, W, H);
      if (near === null) continue;
      dist = Math.max(dist, near);
    }
    // Under the finger, the size is the PART the ray hit, not the whole object (W1 merge, 2026-10-17): Lantern Cove's
    // lighthouse has a light beam, so its whole box is 200×420 px on a phone (score 73) while the tower under the
    // finger is ~45×170; a pine mostly off the screen's edge 20 px away (87×111, score 44) took the tap. A hill's part
    // under the finger is still the hill (big), so the coin beside it still wins (rule 2).
    const hm = hitMesh.get(c);
    const mr = hm ? meshScreenRect(hm, viewProj) : null;
    const [mx0, my1] = mr ? toPx(mr[0], mr[1]) : [x0, y1];
    const [mx1, my0] = mr ? toPx(mr[2], mr[3]) : [x1, y0];
    const area = Math.max(1, (mx1 - mx0) * (my1 - my0));
    rows.push({ c, rect: [x0, y0, x1, y1], score: dist + 0.25 * Math.sqrt(area), depth: hits.get(c) ?? Infinity });
  }
  if (!rows.length) return [];
  // Visibility: shoot a ray at the object's own screen box and see who is hit first.
  const firstHit = (nx, ny) => {
    const r2 = rayFromCamera(camera, nx, ny);
    let best = null;
    let who = null;
    for (const c of cands) {
      const t = rayObject(r2, c.object);
      if (t !== null && (best === null || t < best)) (best = t), (who = c);
    }
    return { who, t: best };
  };
  for (const row of rows) {
    const [x0, y0, x1, y1] = row.rect;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const nx = Math.min(Math.max(px, x0), x1);
    const ny = Math.min(Math.max(py, y0), y1);
    const sx = nx + (cx - nx) * 0.25;
    const sy = ny + (cy - ny) * 0.25;
    let h = firstHit((sx / W) * 2 - 1, 1 - (sy / H) * 2);
    if (!h.who) h = firstHit((cx / W) * 2 - 1, 1 - (cy / H) * 2);
    row.visible = !h.who || h.who === row.c;
    if (row.depth === Infinity && h.who === row.c) row.depth = h.t;
  }
  rows.sort((a, b) => (a.visible !== b.visible ? (a.visible ? -1 : 1) : a.score !== b.score ? a.score - b.score : a.depth - b.depth));
  return rows.slice(0, 8).map((r) => r.c.key);
}

__def(__exports, "meshesOf", () => meshesOf);
__def(__exports, "worldCorners", () => worldCorners);
__def(__exports, "worldBox", () => worldBox);
__def(__exports, "screenRect", () => screenRect);
__def(__exports, "screenShare", () => screenShare);
__def(__exports, "rayMesh", () => rayMesh);
__def(__exports, "rayObject", () => rayObject);
__def(__exports, "rayObjectHit", () => rayObjectHit);
__def(__exports, "pickNear", () => pickNear);
};
__defs[5] = function (__exports) {
'use strict';
// ../adapters/three/camera.js

/**
 * The edit camera: a camera of our own, separate from the game's, orbiting a target point
 * (like the scene view of a game engine). The game camera is never moved, so ending the edit needs no restore.
 *
 * state = { target: [x,y,z], distance, yaw, pitch }
 *   yaw   = angle around the vertical axis (0 = camera on +z looking toward -z, three's default view direction)
 *   pitch = angle above the horizon, kept within 8°..85° (never exactly top-down: yaw would become undefined, and
 *           never below the horizon: you would be looking at the underside of the ground). Exception: the opening
 *           view copies the game's camera (fromCamera), which is often lower — a harbour seen from 4 m over the
 *           water is 2° — so the floor drops to that pitch (never below -20°): orbiting can come back down to the
 *           player's eye line, but not under it.
 *
 * Gestures use fractions of the canvas, not pixels, so they feel the same on a phone and a 4K screen:
 *   orbit(dx, dy): full width = half a turn, full height = 90°; dragging down looks more from above
 *   pan(dx, dy):   the ground under the finger follows the finger (horizontally; the target height never changes)
 *   rise(dy):      camera up (dy > 0) or down, straight up: the target and the camera move together, so the direction
 *                  never changes; dy = 1 is one view height at the target (the scene slides down the screen by its
 *                  full height). The one way to change height — pan keeps it, orbit turns round it, zoom slides along
 *                  the line of sight (camera up / down, play test 2026-10-18: "I can't raise the camera; it's needed").
 *   fly(r, u, f):  WASD — the camera and its turning point together, scaled to the scene; W / S level (see fly)
 *   look(dx, dy):  turn where the camera stands (right-drag while flying); orbit turns round the point in front
 *   zoom(f, x, y): f > 1 moves closer; the point under (x, y) stays under the cursor (the camera slides along the line
 *                  through that point — exact for perspective)
 */

const { rayFromCamera, rayPlaneY, v } = __require(3);

const DEG = Math.PI / 180;
const PITCH_MIN = 8 * DEG;
const PITCH_MAX = 85 * DEG;
/** Fly speed (WASD): 0.8 of the distance to the turning point per second (see fly) — the first value (2026-10-18), about
 * a screen's depth a second; tune it here after people try it. Shift (the bridge) = ×3, as engines' "fast". */
const FLY_PER_S = 0.8;

function createEditView(gameCamera) {
  // clone() keeps the game's camera type and three version (we cannot `new` a class we did not import).
  // We keep only the lens; position and orientation are ours.
  const cam = gameCamera.clone(false);
  cam.name = 'studio-edit-camera';
  cam.userData = { studio: false };
  // The game's own lens when it is a usual one, so the opening picture is the player's picture (polish pass
  // 2026-10-16). Before: clamped to 45..70°, so a 42° game camera came out wider than the game.
  if (cam.isPerspectiveCamera) cam.fov = Math.max(30, Math.min(75, gameCamera.fov || 50));
  const st = { target: [0, 0, 0], distance: 10, yaw: 0, pitch: 50 * DEG, radius: 10, floor: PITCH_MIN };
  const orthoBase = cam.isOrthographicCamera ? { zoom: cam.zoom || 1, height: cam.top - cam.bottom } : null;

  function apply(aspect) {
    const cp = Math.cos(st.pitch);
    const pos = [st.target[0] + st.distance * cp * Math.sin(st.yaw), st.target[1] + st.distance * Math.sin(st.pitch), st.target[2] + st.distance * cp * Math.cos(st.yaw)];
    cam.position.set(pos[0], pos[1], pos[2]);
    cam.up.set(0, 1, 0);
    cam.lookAt(st.target[0], st.target[1], st.target[2]);
    // near/far follow the zoom: a fixed near would clip close-ups, a fixed far would clip "frame all" on big maps
    cam.near = Math.max(0.01, st.distance / 500);
    cam.far = Math.max(1000, (st.distance + st.radius * 4) * 4);
    if (aspect && cam.isPerspectiveCamera) cam.aspect = aspect;
    if (orthoBase) {
      // ortho: "distance" maps to zoom so the same gestures work
      cam.zoom = orthoBase.zoom * (orthoBase.height / Math.max(1e-6, 2 * st.distance * Math.tan(25 * DEG)));
      if (aspect) {
        const h = (cam.top - cam.bottom) / 2;
        cam.left = -h * aspect;
        cam.right = h * aspect;
      }
    }
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
  }

  function clampPitch() {
    st.pitch = Math.min(PITCH_MAX, Math.max(st.floor, st.pitch));
  }
  function clampDistance() {
    // 0.3 m lets you inspect a small prop; 8× the scene radius is "far enough to see everything, small"
    st.distance = Math.min(Math.max(0.3, st.distance), Math.max(60, st.radius * 8));
  }
  /** Where the camera stands (apply()'s position, from the state, so it is right before the next apply too). */
  function eyeOf() {
    const cp = Math.cos(st.pitch);
    return [st.target[0] + st.distance * cp * Math.sin(st.yaw), st.target[1] + st.distance * Math.sin(st.pitch), st.target[2] + st.distance * cp * Math.cos(st.yaw)];
  }
  function viewHeight() {
    return cam.isPerspectiveCamera ? 2 * st.distance * Math.tan((cam.fov * DEG) / 2) : 2 * st.distance * Math.tan(25 * DEG);
  }

  return {
    camera: cam,
    apply,
    state: () => ({ target: st.target.slice(), distance: st.distance, yaw: st.yaw, pitch: st.pitch }),
    set(s) {
      if (s.target) st.target = s.target.slice();
      if (s.distance) st.distance = s.distance;
      if (s.yaw != null) st.yaw = s.yaw;
      if (s.pitch != null) st.pitch = s.pitch;
      if (s.radius) st.radius = s.radius;
      clampPitch();
      clampDistance();
    },
    orbit(dx, dy) {
      st.yaw -= dx * Math.PI;
      st.pitch += dy * (Math.PI / 2);
      clampPitch();
    },
    pan(dx, dy, aspect) {
      const h = viewHeight();
      const w = h * (aspect || 1);
      const right = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
      const fwd = [-Math.sin(st.yaw), 0, -Math.cos(st.yaw)]; // horizontal, from the camera toward the target
      const k = 1 / Math.max(0.15, Math.sin(st.pitch)); // a screen-height of drag covers more ground when looking flat
      st.target = v.add(st.target, v.add(v.scale(right, -dx * w), v.scale(fwd, dy * h * k)));
    },
    rise(dy) {
      // Bound like the distance: far enough to look down on the whole scene, never a camera lost kilometres away.
      // Before 2026-10-18 the target's height was fixed by the opening view / frame (no way to change it at all).
      const lim = Math.max(60, st.radius * 8);
      st.target[1] = Math.min(lim, Math.max(-lim, st.target[1] + dy * viewHeight()));
    },
    /**
     * Fly (WASD, camera-wasd pass 2026-10-18: "anyone who has used a 3D game engine moves the camera with WASD too"):
     * move the camera and the point it turns round together by `right` / `up` / `fwd`, each in seconds of travel at
     * the normal speed (the bridge passes the frame's dt; Shift multiplies it).
     * fwd is LEVEL (wasd-level pass 2026-10-19, from a try of the editor: "W/S as level forward / back looks better"): along the
     * ground the way the camera faces, so looking down at the harbour W glides over it at the same height instead of
     * diving into the water. The height changes only with up (E / Q, straight up / down — the same as rise). This is
     * Blender's Walk with gravity and Godot's "Fully Axis-Locked" freelook; Unreal / Unity / Godot's default fly
     * follows the line of sight instead (which is what this did on 2026-10-18 — we chose level because an editor
     * camera here mostly looks down on a level, and diving lost the scene).
     * right is level too (as before). Looking straight down never happens (pitch ≤ 85°), so the level direction is
     * always defined by yaw.
     * Speed: FLY_PER_S of the distance to the turning point, kept within 0.25–2 scene radii — the view crosses
     * about the same share of the screen per second in a small room and on Lantern Cove, slows down close to a
     * small prop, and never crawls (or races) when zoomed very far in (or out). The same speed level or not: W at a
     * steep look-down moves a full step over the ground (the old look-along W moved only cos(pitch) of it).
     * The height keeps rise's bound; sideways has none, as pan (engines let you fly anywhere, under the ground too).
     */
    fly(right, up, fwd) {
      const sp = FLY_PER_S * Math.min(Math.max(st.distance, st.radius * 0.25), st.radius * 2);
      const ahead = [-Math.sin(st.yaw), 0, -Math.cos(st.yaw)]; // level, the way the camera faces (as pan's fwd)
      const side = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
      st.target = v.add(st.target, v.scale(v.add(v.add(v.scale(side, right), [0, up, 0]), v.scale(ahead, fwd)), sp));
      const lim = Math.max(60, st.radius * 8);
      st.target[1] = Math.min(lim, Math.max(-lim, st.target[1]));
    },
    /**
     * Turn the view where the camera stands (a fly-through look: right-drag while flying, as engines do), instead of
     * turning round the point in front (orbit). Same signs and sensitivity as orbit: right = turn right, up = look up;
     * the pitch keeps orbit's limits, so a later orbit never jumps.
     */
    look(dx, dy) {
      const eye = eyeOf();
      st.yaw -= dx * Math.PI;
      st.pitch += dy * (Math.PI / 2);
      clampPitch();
      const cp = Math.cos(st.pitch);
      st.target = v.sub(eye, v.scale([cp * Math.sin(st.yaw), Math.sin(st.pitch), cp * Math.cos(st.yaw)], st.distance));
    },
    zoom(factor, ndcX = 0, ndcY = 0) {
      const f = Math.min(5, Math.max(0.2, factor));
      const before = st.distance;
      st.distance /= f;
      clampDistance();
      const k = 1 - st.distance / before; // fraction of the way toward the pointed point
      if (k === 0) return;
      const p = rayPlaneY(rayFromCamera(cam, ndcX, ndcY), st.target[1]);
      if (p && v.len(v.sub(p, st.target)) < st.radius * 20 + 100) st.target = v.add(st.target, v.scale(v.sub(p, st.target), k));
    },
    /**
     * Stand exactly where `gameCamera` stands, looking where it looks (the opening view: the first picture of the
     * editor is the player's picture). The orbit point is on the line of sight, as far as the middle of the scene
     * (`center`), so a drag turns around the scene, not around the camera. Assumes a camera without roll (lookAt
     * with +y up, as almost every game camera is); a rolled camera opens level.
     */
    fromCamera(gameCamera, center) {
      gameCamera.updateMatrixWorld(true);
      const e = gameCamera.matrixWorld.elements;
      const pos = [e[12], e[13], e[14]];
      const len = Math.hypot(e[8], e[9], e[10]) || 1;
      const dir = [-e[8] / len, -e[9] / len, -e[10] / len]; // a camera looks along its local -z
      let d;
      if (orthoBase) d = orthoBase.height / (2 * Math.tan(25 * DEG)); // the distance that gives the game's own zoom
      else {
        d = center ? v.dot(v.sub(center, pos), dir) : 0;
        if (!(d > 1)) d = Math.max(1, st.radius);
      }
      st.pitch = Math.asin(Math.max(-1, Math.min(1, -dir[1])));
      st.floor = Math.max(-20 * DEG, Math.min(PITCH_MIN, st.pitch));
      st.yaw = Math.hypot(dir[0], dir[2]) < 1e-6 ? st.yaw : Math.atan2(-dir[0], -dir[2]);
      st.distance = d;
      st.radius = Math.max(st.radius, d / 4);
      st.target = v.add(pos, v.scale(dir, d));
      clampPitch();
      // No clampDistance(): the game camera may be farther out than the editor's own limit; the next zoom clamps.
    },
    /** Look at a sphere (centre, radius) from the current yaw at the given pitch. */
    frame(center, radius, pitch = 50 * DEG) {
      const r = Math.max(radius, 0.25);
      st.radius = Math.max(st.radius, r);
      st.target = center.slice();
      st.pitch = pitch;
      const half = cam.isPerspectiveCamera ? (Math.min(cam.fov, cam.fov * (cam.aspect || 1)) * DEG) / 2 : 25 * DEG;
      st.distance = (r / Math.sin(half)) * 1.05;
      clampPitch();
      clampDistance();
    }
  };
}

/** Yaw (our convention) of the direction a camera looks in, so the edit view starts facing the way the player did. */
function yawOfCamera(camera) {
  const e = camera.matrixWorld.elements;
  // camera looks along its local -z: world direction = -(third column)
  const dx = -e[8];
  const dz = -e[10];
  if (Math.hypot(dx, dz) < 1e-6) return 0;
  return Math.atan2(-dx, -dz);
}

__def(__exports, "PITCH_MIN", () => PITCH_MIN);
__def(__exports, "PITCH_MAX", () => PITCH_MAX);
__def(__exports, "FLY_PER_S", () => FLY_PER_S);
__def(__exports, "createEditView", () => createEditView);
__def(__exports, "yawOfCamera", () => yawOfCamera);
};
__defs[6] = function (__exports) {
'use strict';
// ../adapters/three/capture.js

/**
 * capture(object, size): a square picture of ONE object for the editor's list.
 *
 * Draws with the game's renderer into the corner of the game canvas, copies that corner into a 2D canvas in the
 * same task (WebGL keeps the drawing buffer until the browser composites, so preserveDrawingBuffer is not needed),
 * then lets the editor repaint its view.
 *
 * While drawing:
 *   - scene.onBeforeRender / onAfterRender are emptied. Games use these hooks for camera tricks, e.g. "hide small
 *     things right in front of the camera so they do not block the view" — with a close-up thumbnail camera that
 *     hides exactly the object being photographed (a real bug we hit: the smaller the object, the surer it vanished).
 *   - everything that is not the object (or one of its ancestors) is hidden, except lights, so the picture shows the
 *     object alone in the game's own lighting.
 *   - fog is off (a far object would be a grey square).
 * The camera frames the object's world box from the editor's current viewing direction, slightly from above.
 *
 * Light effects are left out (Ive review 3 ⑧, 2026-10-20): a lighthouse's beams (additive cards reaching far past the
 * tower) made its box several times the tower, so the tower came out a small blurred stroke in the middle of its
 * Library tile. Parts drawn only as light — additive blending, or see-through below 30 % — are hidden while the
 * picture is drawn and are not in the frame. An object that is ONLY light (a glow on its own) keeps them all.
 * (bridge/snap.ts / surface.js has its own, wider rule for what can be stood on; a pane of glass is not light.)
 *
 * See-through background (visual pass 2026-10-16, Ive-view review item 5): the picture used to carry the game's sky
 * (a pale blue square behind every 3D object), so the dark list read as a column of blue tiles and 3D looked
 * different from 2D (whose pictures are see-through, on the shell's checkerboard). The object is now drawn twice,
 * once on black and once on white (scene.background off, the clear colour set), and the alpha of each pixel is
 * worked out from the difference (a pixel of the object is the same on both; empty space is 0 on one and 255 on the
 * other; soft edges fall in between). This works whatever the game's canvas was created with (alpha: false is
 * the three.js default, so "just clear to transparent" would give black).
 */

const { worldBox } = __require(4);

const DEG = Math.PI / 180;
const ADDITIVE = 2; // THREE.AdditiveBlending

/** Drawn only as light (see the header): every material of the mesh is additive or nearly clear. */
function lightOnly(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return mats.length > 0 && mats.every((m) => !!m && (m.blending === ADDITIVE || (m.transparent && typeof m.opacity === 'number' && m.opacity < 0.3)));
}

function captureObject({ renderer, scene, render, boot, baseCamera, yaw }, object, size = 128) {
  const canvas = renderer.domElement;
  const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
  const px = Math.max(16, Math.min(size, canvas.width, canvas.height));
  scene.updateMatrixWorld(true);
  const glow = [];
  const walk = (o) => {
    if (!o.visible) return;
    if ((o.isMesh || o.isSkinnedMesh) && o.material && lightOnly(o)) glow.push(o);
    for (const c of o.children) walk(c);
  };
  walk(object);
  for (const g of glow) g.visible = false;
  let box = worldBox(object);
  if (!box) {
    // Only light: draw it as it is.
    for (const g of glow) g.visible = true;
    glow.length = 0;
    box = worldBox(object);
  }
  if (!box) return { ok: false };

  const hidden = [];
  for (let node = object; node && node !== scene && node.parent; node = node.parent) {
    for (const sib of node.parent.children) {
      if (sib === node || sib.isLight || !sib.visible) continue;
      hidden.push(sib);
      sib.visible = false;
    }
  }
  // A stand-in for THREE.Color (this file has no three import): getClearColor() copies into it, setClearColor()
  // copies from it (Color.set takes anything with isColor).
  const clear = { isColor: true, r: 0, g: 0, b: 0, copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; } };
  if (renderer.getClearColor) renderer.getClearColor(clear);
  const saved = { before: scene.onBeforeRender, after: scene.onAfterRender, fog: scene.fog, autoClear: renderer.autoClear, target: renderer.getRenderTarget ? renderer.getRenderTarget() : null,
    background: scene.background, clearAlpha: renderer.getClearAlpha ? renderer.getClearAlpha() : 1 };
  scene.onBeforeRender = () => {};
  scene.onAfterRender = () => {};
  scene.fog = null;

  const cam = baseCamera.clone(false);
  const center = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const radius = Math.max(0.05, Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) / 2);
  const pitch = 22 * DEG;
  let dist = radius * 2.2;
  if (cam.isPerspectiveCamera) {
    cam.fov = 35;
    cam.aspect = 1;
    dist = (radius / Math.sin((35 * DEG) / 2)) * 1.08;
  } else if (cam.isOrthographicCamera) {
    cam.left = cam.bottom = -radius * 1.1;
    cam.right = cam.top = radius * 1.1;
    cam.zoom = 1;
  }
  cam.near = Math.max(0.001, dist - radius * 2);
  cam.far = dist + radius * 2;
  const cp = Math.cos(pitch);
  cam.position.set(center[0] + dist * cp * Math.sin(yaw), center[1] + dist * Math.sin(pitch), center[2] + dist * cp * Math.cos(yaw));
  cam.up.set(0, 1, 0);
  cam.lookAt(center[0], center[1], center[2]);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);

  let dataUrl = null;
  boot.selfRender++;
  try {
    if (renderer.setRenderTarget) renderer.setRenderTarget(null);
    renderer.autoClear = true;
    const css = px / pr;
    renderer.setScissorTest(true);
    renderer.setScissor(0, 0, css, css);
    renderer.setViewport(0, 0, css, css);
    // One picture of the corner on a plain background (0 = black, 1 = white).
    const shoot = (white) => {
      if (renderer.setClearColor) {
        scene.background = null;
        renderer.setClearColor(white ? 0xffffff : 0x000000, 1);
      }
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
      render.call(renderer, scene, cam);
      const c = document.createElement('canvas');
      c.width = c.height = px;
      const g = c.getContext('2d', { willReadFrequently: true });
      // three's viewport origin is bottom-left; canvas rows start at the top
      g.drawImage(canvas, 0, canvas.height - px, px, px, 0, 0, px, px);
      return { c, g };
    };
    const onBlack = shoot(false);
    if (renderer.setClearColor) {
      const onWhite = shoot(true);
      const b = onBlack.g.getImageData(0, 0, px, px);
      const w = onWhite.g.getImageData(0, 0, px, px).data;
      const d = b.data;
      for (let i = 0; i < d.length; i += 4) {
        // white − black is 255 where nothing was drawn, 0 where the object fully covers the pixel.
        const gap = (w[i] - d[i] + w[i + 1] - d[i + 1] + w[i + 2] - d[i + 2]) / 3;
        const a = Math.max(0, Math.min(255, 255 - gap));
        if (a > 0) {
          // On black the colour is premultiplied by alpha: divide it back out.
          const k = 255 / a;
          d[i] = Math.min(255, d[i] * k);
          d[i + 1] = Math.min(255, d[i + 1] * k);
          d[i + 2] = Math.min(255, d[i + 2] * k);
        }
        d[i + 3] = a;
      }
      onBlack.g.putImageData(b, 0, 0);
    }
    dataUrl = onBlack.c.toDataURL('image/png');
  } finally {
    boot.selfRender--;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width / pr, canvas.height / pr);
    if (renderer.setRenderTarget) renderer.setRenderTarget(saved.target);
    renderer.autoClear = saved.autoClear;
    scene.onBeforeRender = saved.before;
    scene.onAfterRender = saved.after;
    scene.fog = saved.fog;
    scene.background = saved.background;
    if (renderer.setClearColor) renderer.setClearColor(clear, saved.clearAlpha);
    for (const h of hidden) h.visible = true;
    for (const g of glow) g.visible = true;
  }
  return { ok: !!dataUrl, dataUrl: dataUrl || undefined };
}

__def(__exports, "captureObject", () => captureObject);
};
__defs[7] = function (__exports) {
'use strict';
// ../adapters/three/assets.js

/**
 * assetsOf(object): which files an object is made of — for the asset library ("this tree uses tree.png").
 *
 * AssetRef = { url, how: 'texture' | 'model' | 'sound', sure }
 *   - `userData.studioAsset` (a string or an array) on the object or a descendant: the author's mark, always sure
 *   - models: the URL three's loader produced this subtree from (boot.js tags Loader results on r186+, sure), or the
 *     download-order guess (boot.js guessModel, r170 and older, NOT sure — the library shows it as "estimated")
 *   - textures: the image a material's map was loaded from (HTMLImageElement.src, or an ImageBitmap traced back to its
 *     fetch). Textures embedded in a .glb have no file of their own; they are covered by the model entry.
 *     Canvas / data textures are generated in code and have no file — skipped.
 *   - sounds: three Audio / PositionalAudio in the subtree whose buffer came from a loader (r186+)
 * URLs on the game's own origin are returned relative to the game's folder ("assets/tree.png"), so they line up
 * with the file list of the folder; anything else stays absolute.
 */

const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'displacementMap', 'lightMap', 'specularMap', 'matcap', 'gradientMap', 'clearcoatMap', 'sheenColorMap', 'transmissionMap'];

const EXT_HOW = [
  [/\.(glb|gltf|fbx|obj|stl|ply|3ds|dae|vrm)(\?|#|$)/i, 'model'],
  [/\.(mp3|ogg|wav|m4a|aac|flac|opus)(\?|#|$)/i, 'sound'],
  [/\.(json|atlas)(\?|#|$)/i, 'atlas']
];
function howOf(url) {
  for (const [re, how] of EXT_HOW) if (re.test(url)) return how;
  return 'texture';
}

function relativeUrl(url, baseUri) {
  try {
    const u = new URL(url, baseUri);
    const dir = new URL('.', baseUri);
    if (u.origin === dir.origin && u.pathname.startsWith(dir.pathname)) return decodeURI(u.pathname.slice(dir.pathname.length)) + u.search;
    return u.href;
  } catch {
    return String(url);
  }
}

function imageUrl(img, boot) {
  if (!img) return null;
  const known = boot.urlOf.get(img);
  if (known) return known;
  if (typeof img.src === 'string' && img.src && !img.src.startsWith('blob:') && !img.src.startsWith('data:')) return img.src;
  return null;
}

function assetsOf(object, boot, baseUri) {
  const out = new Map(); // url → ref (first wins, a sure ref upgrades a guess)
  const put = (url, how, sure) => {
    // blob: / data: URLs are bytes embedded in another file (a texture inside a .glb) — there is no file to list
    if (!url || /^(blob|data):/i.test(url)) return;
    const rel = relativeUrl(url, baseUri);
    const prev = out.get(rel);
    if (!prev || (!prev.sure && sure)) out.set(rel, { url: rel, how, sure });
  };
  const models = new Set();
  // Ancestors first: the object may be a child of a loaded glTF scene (e.g. one node of a level file).
  for (let p = object; p; p = p.parent) {
    const u = boot.urlOf.get(p);
    if (u) put(u, howOf(u), true), models.add(u);
    else if (boot.guessOf.has(p)) put(boot.guessOf.get(p), 'model', false), models.add(boot.guessOf.get(p));
  }
  object.traverse((o) => {
    const ud = o.userData || {};
    const marks = Array.isArray(ud.studioAsset) ? ud.studioAsset : ud.studioAsset ? [ud.studioAsset] : [];
    for (const m of marks) put(new URL(String(m), baseUri).href, howOf(String(m)), true);
    const own = boot.urlOf.get(o);
    if (own) put(own, howOf(own), true), models.add(own);
    if (o.geometry) {
      const gu = boot.urlOf.get(o.geometry);
      if (gu) put(gu, 'model', true), models.add(gu);
      else if (boot.guessOf.has(o.geometry)) put(boot.guessOf.get(o.geometry), 'model', false), models.add(boot.guessOf.get(o.geometry));
    }
    if (o.isAudio && o.buffer) {
      const su = boot.urlOf.get(o.buffer);
      if (su) put(su, 'sound', true);
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mat of mats) {
      for (const k of MAPS) {
        const tex = mat[k];
        if (!tex || !tex.isTexture) continue;
        const tagged = boot.urlOf.get(tex);
        const img = tex.source ? tex.source.data : tex.image;
        const u = tagged || imageUrl(img, boot);
        // A texture inside a model file (glTF tags them with userData.mimeType) is part of that model.
        if (!u && tex.userData && tex.userData.mimeType && models.size) continue;
        if (u) put(u, 'texture', true);
      }
    }
  });
  return [...out.values()];
}

__def(__exports, "relativeUrl", () => relativeUrl);
__def(__exports, "assetsOf", () => assetsOf);
};
__defs[8] = function (__exports) {
'use strict';
// ../adapters/three/focus.js

/**
 * Where the edit camera looks when an object is picked from the list (view.focus) or when the whole
 * scene is shown (view.frameAll). Pure maths on world boxes { min: [x,y,z], max: [x,y,z] }, so it
 * can be tested without WebGL.
 *
 * WHY (UI/UX review 2026-10-16, journey and simplicity reviews): focus used to frame a sphere of
 * max(radius × 2.2, 1.5 m) around the object. A barrel then filled the screen (nothing around it was
 * visible, so the person could not judge where to put it) and a big ground plane sent the camera far
 * out. Placing is about the object AND its surroundings: frame the object plus its nearest
 * neighbours, never more than the scene itself.
 */

/** Centre and radius of a box. */
function sphereOf(b) {
  const c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const r = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2;
  return { c, r };
}

/**
 * The scene's extent: the union of all boxes, leaving out "backdrop" boxes (sky domes, seas, huge
 * grounds) that are more than 20× the typical object's size. The same rule frameAll always used.
 * @returns {{ c: number[], r: number, typical: number } | null}
 */
function sceneSphere(boxes) {
  if (!boxes.length) return null;
  const radii = boxes.map((b) => sphereOf(b).r).sort((a, b) => a - b);
  const typical = radii[Math.floor(radii.length / 2)] || 1;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    const r = sphereOf(b).r;
    if (boxes.length > 2 && r > typical * 20) continue;
    // A flat thing much bigger than the rest is a ground or a floor: the play area is what stands on it.
    // (Rebrand 2026-10-16: the yard of the three-crates sample was framed from so far that each crate
    // was a few pixels; the ground was 19× a crate, just under the 20× rule above.)
    const flat = b.max[1] - b.min[1] < 0.05 * Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
    if (boxes.length > 2 && flat && r > typical * 6) continue;
    for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], b.min[i])), (max[i] = Math.max(max[i], b.max[i]));
  }
  if (!Number.isFinite(min[0])) return null;
  const s = sphereOf({ min, max });
  return { c: s.c, r: s.r, typical };
}

/**
 * The sphere to frame when `target` is picked.
 * - at least 1.6× the object (it never fills the screen) and 2× a typical object (a tiny coin
 *   still shows what is next to it);
 * - widened to reach its second-nearest neighbour ("a little of what is around"), but not beyond
 *   4× the object / 6× a typical object (one lone tree far away must not pull the camera out);
 * - never more than the scene (+10 %): a ground plane or a wall shows the play area, centred on
 *   the scene, instead of the camera flying out to the plane's far edges.
 *
 * @param {{ min: number[], max: number[] }} target  world box of the picked object
 * @param {Array<{ min: number[], max: number[] }>} others  world boxes of the other listed objects
 * @param {number[]} pivot  where the object's handles are (its origin): the default centre
 * @returns {{ center: number[], radius: number }}
 */
function focusSphere(target, others, pivot) {
  const t = sphereOf(target);
  const scene = sceneSphere([target, ...others]);
  const typical = scene ? scene.typical : t.r;
  let radius = Math.max(t.r * 1.6, typical * 2);
  const reach = others
    .map((b) => {
      const o = sphereOf(b);
      return Math.hypot(o.c[0] - t.c[0], o.c[1] - t.c[1], o.c[2] - t.c[2]) + o.r;
    })
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (reach.length) {
    const second = reach[Math.min(1, reach.length - 1)];
    radius = Math.max(radius, Math.min(second * 1.1, Math.max(t.r * 4, typical * 6)));
  }
  let center = pivot.slice();
  if (scene && radius > scene.r * 1.1) {
    radius = scene.r * 1.1;
    // Bigger than the scene itself (the ground): look at the scene, not at the plane's origin.
    if (t.r >= scene.r) center = scene.c.slice();
  }
  return { center, radius: Math.max(radius, 0.5) };
}

__def(__exports, "sphereOf", () => sphereOf);
__def(__exports, "sceneSphere", () => sceneSphere);
__def(__exports, "focusSphere", () => focusSphere);
};
__defs[9] = function (__exports) {
'use strict';
// ../adapters/three/surface.js

/**
 * Surfaces to set things on: ray casts against the scene's own meshes (the ground, a pier's planks, a crate's lid),
 * for the "snap to surfaces" moves (a request after a try of the editor, 2026-10-19: "in Unreal, an object moved up or down stops once when it
 * meets the ground or another thing — I want to set things down exactly on the ground; that feature is needed").
 * adapter.js uses it for three things: the height drag stops on the first surface below (bridge/snap.ts holds the
 * rule), a move keeps the object standing on whatever is under it, and "Drop to floor" (End) sets it on the surface
 * below. No three.js import (as pick.js): plain arrays, the scene's own matrices.
 *
 * What counts as a surface:
 * - every visible mesh in the scene, listed or not (a ground the game marks userData.studio = false, a ground the
 *   editor holds still — the "safe edit" pass — are still floors: they only cannot be moved);
 * - but not: the moving objects themselves and their children (`skip`), skinned meshes (their positions are the bind
 *   pose, not what is drawn), instanced / batched meshes (one geometry drawn in many places), lines, points, sprites,
 *   wireframes, and see-through light effects — additive blending, transparent with no depth write, or nearly clear
 *   (Lantern Cove's lighthouse beam is two additive cards: a barrel must not land on a ray of light). Water drawn as a
 *   transparent plane that writes depth (Lantern Cove's sea) does count: a barrel set on the sea sits on the water.
 * - Only the side of a face that looks at the ray (a FrontSide face hit from behind is the inside of a solid, e.g. a
 *   ray that starts inside a pier post), and for "something to stand on" only faces turned up: normal y ≥ `minUp`
 *   (0.5 = slopes up to 60°; a wall is not a floor).
 *
 * Speed: Lantern Cove's terrain is 106 k triangles, and the move asks once per pointer move. Each mesh's triangles
 * are copied into world space once and sorted into a grid of xz cells (meshes of GRID_MIN_TRIS or more); a vertical
 * ray reads one cell, a slanted one the cells under its path. The copy is kept until the mesh, its geometry or its
 * matrix changes (WeakMap per mesh), so a dragged crate is re-copied while it moves (small) and the terrain never is.
 */
const { applyM4, boxCorners, rayBox, rayTriangle, v } = __require(3);

/** Meshes with at least this many triangles get a grid; smaller ones are tested whole (a crate: 12). */
const GRID_MIN_TRIS = 2000;
/** Most cells per side of a grid (64² = 4096 cells; ~26 triangles per cell for the terrain). */
const GRID_MAX = 64;
/** Rays that would visit more cells than this (a ray grazing a huge sea) test the whole mesh instead. */
const MAX_STEPS = 512;

const FRONT = 0;
const BACK = 1;
const ADDITIVE = 2; // THREE.AdditiveBlending

/** Can this material be stood on? (see the header: light effects and wireframes cannot). */
function solidMaterial(m) {
  if (!m || m.visible === false || m.wireframe) return false;
  if (m.blending === ADDITIVE) return false;
  if (m.transparent && (m.depthWrite === false || (typeof m.opacity === 'number' && m.opacity < 0.3))) return false;
  return true;
}

/**
 * The world box of the parts of `object` that could stand on something — its solid meshes, as surfaceMeshes() counts
 * them (no light effects, wireframes, lines…) — or null when it has none. The snapping moves measure the foot from it.
 * WHY not the whole box (review 3 of 2026-10-20): Lantern Cove's lighthouse box held its two 28 m light beams, so the
 * "bottom middle" foot was nowhere under the tower and the five rays of surfaceBelow() looked at hills 14 m away;
 * dragged 20 px it jumped 8 m.
 */
function solidBox(object) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let any = false;
  const walk = (o) => {
    if (!o.visible) return;
    if (o.isMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const g = o.geometry;
      if (!g.boundingBox && typeof g.computeBoundingBox === 'function') g.computeBoundingBox();
      const b = g.boundingBox;
      if (mats.some(solidMaterial) && b && isFinite(b.min.x) && isFinite(b.max.x)) {
        for (const c of boxCorners([b.min.x, b.min.y, b.min.z], [b.max.x, b.max.y, b.max.z])) {
          const p = applyM4(o.matrixWorld.elements, c);
          for (let i = 0; i < 3; i++) (min[i] = Math.min(min[i], p[i])), (max[i] = Math.max(max[i], p[i]));
        }
        any = true;
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(object);
  return any ? { min, max } : null;
}

/**
 * The meshes things can be set on, minus `skip` (a Set of Object3D: their whole subtrees are left out).
 * @returns {object[]} meshes, matrices as they are now (call scene.updateMatrixWorld first)
 */
function surfaceMeshes(scene, skip) {
  const out = [];
  const walk = (o) => {
    if (!o.visible || (skip && skip.has(o))) return;
    if (o.isMesh && !o.isSkinnedMesh && !o.isInstancedMesh && !o.isBatchedMesh && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some(solidMaterial)) out.push(o);
    }
    for (const c of o.children) walk(c);
  };
  walk(scene);
  return out;
}

/** Side of a mesh's (first) material: 0 front, 1 back, 2 double. */
function sideOf(mesh) {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return m && typeof m.side === 'number' ? m.side : FRONT;
}

/** The world-space triangles (and grid) of one mesh, cached while nothing about it changes. */
const cache = new WeakMap();
function sameMatrix(a, b) {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
}
function trianglesOf(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const index = g.index;
  const e = mesh.matrixWorld.elements;
  const c = cache.get(mesh);
  if (c && c.geo === g && c.pv === pos.version && c.iv === (index ? index.version : -1) && sameMatrix(c.m, e)) return c;
  const start = Math.max(0, (g.drawRange && g.drawRange.start) || 0);
  const total = index ? index.count : pos.count;
  const end = Math.min(total, start + (g.drawRange && isFinite(g.drawRange.count) ? g.drawRange.count : total));
  const n = Math.max(0, Math.floor((end - start) / 3));
  const tri = new Float64Array(n * 9);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      const i = start + t * 3 + k;
      const vi = index ? index.getX(i) : i;
      const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
      const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
      const wx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const wy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      const wz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
      const o = t * 9 + k * 3;
      tri[o] = wx; tri[o + 1] = wy; tri[o + 2] = wz;
      if (wx < min[0]) min[0] = wx; if (wx > max[0]) max[0] = wx;
      if (wy < min[1]) min[1] = wy; if (wy > max[1]) max[1] = wy;
      if (wz < min[2]) min[2] = wz; if (wz > max[2]) max[2] = wz;
    }
  }
  const out = { geo: g, pv: pos.version, iv: index ? index.version : -1, m: e.slice(), tri, n, min, max, grid: null };
  if (n >= GRID_MIN_TRIS && isFinite(min[0])) out.grid = buildGrid(out);
  cache.set(mesh, out);
  return out;
}

/** xz grid: each cell lists the triangles whose xz box overlaps it. */
function buildGrid(T) {
  const N = Math.max(1, Math.min(GRID_MAX, Math.ceil(Math.sqrt(T.n / 8))));
  const sx = Math.max(1e-9, (T.max[0] - T.min[0]) / N);
  const sz = Math.max(1e-9, (T.max[2] - T.min[2]) / N);
  const cells = Array.from({ length: N * N }, () => []);
  const cx = (x) => Math.min(N - 1, Math.max(0, Math.floor((x - T.min[0]) / sx)));
  const cz = (z) => Math.min(N - 1, Math.max(0, Math.floor((z - T.min[2]) / sz)));
  for (let t = 0; t < T.n; t++) {
    const o = t * 9;
    const x0 = cx(Math.min(T.tri[o], T.tri[o + 3], T.tri[o + 6])), x1 = cx(Math.max(T.tri[o], T.tri[o + 3], T.tri[o + 6]));
    const z0 = cz(Math.min(T.tri[o + 2], T.tri[o + 5], T.tri[o + 8])), z1 = cz(Math.max(T.tri[o + 2], T.tri[o + 5], T.tri[o + 8]));
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) cells[j * N + i].push(t);
  }
  return { N, sx, sz, cells, cx, cz };
}

/** Triangle indices to test for this ray (all of them without a grid; else the cells under its path). */
function candidates(T, ray) {
  if (!T.grid) return null;
  const G = T.grid;
  const span = rayBox(ray, T.min, T.max);
  if (span === null) return [];
  const h = Math.hypot(ray.d[0], ray.d[2]);
  const at = (t) => [ray.o[0] + ray.d[0] * t, ray.o[2] + ray.d[2] * t];
  const seen = new Set();
  const add = (p) => seen.add(G.cz(p[1]) * G.N + G.cx(p[0]));
  if (h < 1e-6) add(at(span));
  else {
    // Where the ray leaves the box: the far crossing of the xz slab (the ray box test only gives the near one).
    let t1 = Infinity;
    for (const i of [0, 2]) {
      if (Math.abs(ray.d[i]) < 1e-12) continue;
      const a = (T.min[i] - ray.o[i]) / ray.d[i], b = (T.max[i] - ray.o[i]) / ray.d[i];
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (ray.d[1] < -1e-12) t1 = Math.min(t1, (T.min[1] - ray.o[1]) / ray.d[1]);
    else if (ray.d[1] > 1e-12) t1 = Math.min(t1, (T.max[1] - ray.o[1]) / ray.d[1]);
    const step = (0.5 * Math.min(G.sx, G.sz)) / h;
    if (!isFinite(t1) || (t1 - span) / step > MAX_STEPS) return null;
    for (let t = span; t <= t1 + step; t += step) add(at(Math.min(t, t1)));
  }
  const out = new Set();
  for (const c of seen) for (const t of G.cells[c]) out.add(t);
  return out;
}

/**
 * The nearest surface the ray meets: { t, point, normal } (normal turned toward the ray), or null.
 * `ray` = { o, d } with d of length 1 (t is then metres). `minUp`: only faces whose normal y is at least this
 * (0.5 = something to stand on; -1 = any face, a wall too). `maxT`: ignore hits farther than this.
 */
function castSurface(ray, meshes, { minUp = 0.5, maxT = Infinity } = {}) {
  let best = null;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (const mesh of meshes) {
    const T = trianglesOf(mesh);
    if (!T.n || rayBox(ray, T.min, T.max) === null) continue;
    const side = sideOf(mesh);
    const list = candidates(T, ray);
    const test = (t) => {
      const o = t * 9;
      a[0] = T.tri[o]; a[1] = T.tri[o + 1]; a[2] = T.tri[o + 2];
      b[0] = T.tri[o + 3]; b[1] = T.tri[o + 4]; b[2] = T.tri[o + 5];
      c[0] = T.tri[o + 6]; c[1] = T.tri[o + 7]; c[2] = T.tri[o + 8];
      const d = rayTriangle(ray.o, ray.d, a, b, c);
      if (d === null || d > maxT || (best && d >= best.t)) return;
      let n = v.cross(v.sub(b, a), v.sub(c, a));
      const len = v.len(n);
      if (!(len > 0)) return;
      n = v.scale(n, 1 / len);
      const facing = v.dot(n, ray.d) < 0; // the front of the face looks at the ray
      if (facing ? side === BACK : side === FRONT) return; // the hidden side of a one-sided face
      if (!facing) n = v.scale(n, -1);
      if (n[1] < minUp) return;
      best = { t: d, point: v.add(ray.o, v.scale(ray.d, d)), normal: n, mesh };
    };
    if (list) for (const t of list) test(t);
    else for (let t = 0; t < T.n; t++) test(t);
  }
  return best;
}

/**
 * Every surface the ray meets (as castSurface: the same faces count), nearest first. adapter.js's move looks down
 * through all of them for the highest it may step onto (a pine's crown above the hill is skipped, the hill is not).
 */
function castSurfaceAll(ray, meshes, opts) {
  const out = [];
  let hit;
  let r = ray;
  // castSurface again from just past each hit (1e-4 m: a face shared by two triangles is not met twice): few hits per
  // ray (2–4 in Lantern Cove), and castSurface's tests stay the one rule. `t` from the ray's own origin.
  for (let n = 0; n < 16 && (hit = castSurface(r, meshes, opts)); n++) {
    out.push({ ...hit, t: v.len(v.sub(hit.point, ray.o)) });
    r = { o: v.add(hit.point, v.scale(ray.d, 1e-4)), d: ray.d };
  }
  return out;
}

/**
 * The highest surface under a box, looking down from `fromY` (world; adapter.js: the top of the box): five vertical rays, the box's middle and four
 * points halfway to its corners. The highest hit wins: an object half over a pier's edge rests on the pier, and on a
 * slope it rests on the uphill side instead of sinking into it. null = nothing below.
 */
function surfaceBelow(box, fromY, meshes) {
  const hit = surfaceBelowHit(box, fromY, meshes);
  return hit ? hit.y : null;
}

/** surfaceBelow with the mesh that holds the object up: { y, mesh } or null. */
function surfaceBelowHit(box, fromY, meshes) {
  const cx = (box.min[0] + box.max[0]) / 2, cz = (box.min[2] + box.max[2]) / 2;
  const hx = (box.max[0] - box.min[0]) / 4, hz = (box.max[2] - box.min[2]) / 4;
  let top = null;
  for (const [x, z] of [[cx, cz], [cx - hx, cz - hz], [cx + hx, cz - hz], [cx - hx, cz + hz], [cx + hx, cz + hz]]) {
    const hit = castSurface({ o: [x, fromY, z], d: [0, -1, 0] }, meshes, { minUp: 0.5 });
    if (hit && (top === null || hit.point[1] > top.y)) top = { y: hit.point[1], mesh: hit.mesh };
  }
  return top;
}

__def(__exports, "solidBox", () => solidBox);
__def(__exports, "surfaceMeshes", () => surfaceMeshes);
__def(__exports, "castSurface", () => castSurface);
__def(__exports, "castSurfaceAll", () => castSurfaceAll);
__def(__exports, "surfaceBelow", () => surfaceBelow);
__def(__exports, "surfaceBelowHit", () => surfaceBelowHit);
};
__defs[10] = function (__exports) {
'use strict';
// ../adapters/three/ground.js

/**
 * Which listed 3D objects are the ground, a road, the sea or the sky (Item.backdrop in 3D). Pure maths on world boxes
 * { min: [x,y,z], max: [x,y,z] } and names, so it can be tested without WebGL (test/hold.test.ts).
 *
 * WHY (a hands-on try of 2026-10-19, item 4): "just trying things out, the road (the ground) ended up 16 m up, and
 * I could save it like that". 2D already keeps its ground / background at the back (core/port2d.ts backdropRun);
 * 3D had nothing, so the road was one list pick and one Height drag away from flying. The editor holds what this
 * finds still (bridge/hold.ts) until the person presses "Make movable".
 *
 * A listed object is a ground / sky when:
 * - its name's last word says so (groundName: ground, road, sea, sky, and the same words in Japanese), whatever its size; or
 * - its box is far bigger than a typical object's: more than 20× (a sky dome, a sea), or more than 6× and flat (a
 *   ground plane, a long road). The same two rules focus.js sceneSphere uses to leave such boxes out of "frame all",
 *   so what the camera ignores and what the editor holds are the same things.
 * Never every object (a scene of only big things is all "things" the person may want to place), and the size rules
 * need at least three objects (two boxes say nothing about what is typical).
 */
const { sphereOf } = __require(8);

/**
 * The name's LAST word says ground / road / sea / sky ("ground", "main-road", "Sky_01", "oceanFloor"): an English
 * compound is named by its last word, so "sea-stack" (a rock), "road-sign" and "skyline" are things, not grounds.
 * WHY not core/port2d.ts BACKDROP_NAME as it is: it matches a ground word anywhere, which in 2D only decides draw
 * order at the very back of a list; here it held Lantern Cove's sea stacks still (found by test/web-demo-move,
 * 2026-10-19). Japanese names: the same words as 2D (a whole name, or ending in sea / sky).
 */
const GROUND_WORDS = new Set(['ground', 'floor', 'terrain', 'background', 'backdrop', 'bg', 'sky', 'skybox', 'skydome', 'road', 'street', 'sea', 'ocean', 'water']);
const JA_GROUND = /^(地面|背景|床|地形|道路|水面)$|地面$|道路$|海$|空$/;
function groundName(label) {
  const words = String(label || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/).filter((w) => w && !/^\d+$/.test(w));
  const last = words[words.length - 1] || '';
  return GROUND_WORDS.has(last) || JA_GROUND.test(last);
}

/**
 * @param {Array<{ key: string, label?: string, named?: boolean, box: { min: number[], max: number[] } | null }>} list
 *   `named` = the label is the game's own name (an unnamed object's label is its key, which says nothing)
 * @returns {Set<string>} the keys of the grounds / skies
 */
function groundKeys(list) {
  const out = new Set();
  const sized = list.filter((e) => e.box);
  const radii = sized.map((e) => sphereOf(e.box).r).sort((a, b) => a - b);
  const typical = radii[Math.floor(radii.length / 2)] || 1;
  for (const e of list) {
    if (e.named !== false && groundName(e.label)) {
      out.add(e.key);
      continue;
    }
    if (!e.box || sized.length < 3) continue;
    const b = e.box;
    const r = sphereOf(b).r;
    const flat = b.max[1] - b.min[1] < 0.05 * Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]);
    if (r > typical * 20 || (flat && r > typical * 6)) out.add(e.key);
  }
  return out.size >= list.length ? new Set() : out;
}

__def(__exports, "groundName", () => groundName);
__def(__exports, "groundKeys", () => groundKeys);
};
__defs[11] = function (__exports) {
'use strict';
// ../adapters/three/adapter.js

/**
 * The three.js adapter: the StudioAdapter interface (CONTRACT.md, promise 1) for any game written with plain three.js.
 *
 *   import { whenThreeReady } from './adapter.js';
 *   const adapter = await whenThreeReady();   // resolves once the game has a scene, a renderer and a camera
 *   adapter.begin(); adapter.list(); adapter.pickNear(x, y, 12); adapter.grab(key, x, y); adapter.drag(key, x, y); …
 *
 * Requires boot.js to have run before the game (it discovers the scene/renderer and holds the game's frames).
 *
 * Coordinates: every x/y argument is NDC of the game canvas (-1..1, +y up), so the bridge converts pointer events once.
 * Pose = { p: [x, y, z] (local to the parent, metres), r: rotation.y (radians, (-π, π]), s: number | [x, y, z] }.
 * Every mutating call returns the new Pose (or null for an unknown key), so the shell can keep its undo history.
 */

const { collectCandidates } = __require(2);
const { project, rayFromCamera, rayPlaneY, v, viewProjOf, wrapAngle } = __require(3);
const { pickNear: pickNearImpl, screenRect, screenShare, worldBox } = __require(4);
const { createEditView, yawOfCamera } = __require(5);
const { captureObject } = __require(6);
const { assetsOf: assetsOfImpl } = __require(7);
const { focusSphere, sceneSphere } = __require(8);
const { castSurface, castSurfaceAll, solidBox, surfaceBelowHit, surfaceMeshes } = __require(9);
const { groundKeys } = __require(10);

const DEG = Math.PI / 180;
const S_MIN = 0.01;
const S_MAX = 1000;
/**
 * The move on surfaces (dragOnSurface): the steepest the ground may look before a screen step stops being read "on
 * the ground" — sin of the angle the view meets the ground at the foot. 0.25 ≈ 14°: a step up or down the screen then
 * moves the foot at most 4× what a step across does. Below it (a hill seen from the cove, from below its top) the
 * foot's ground is seen edge-on and following it exactly makes metres of a pixel.
 */
const GRAZE = 0.25;
/**
 * The move on surfaces: the highest a step goes up onto ANOTHER surface (m). 1.2: the pier's planks (1.11 over the
 * sea), a crate's lid — not a pine's lowest boughs (~2 m) or the cottage's eaves (2.6 m): with 1.5 and five rays
 * under the cottage's box, the cottage dragged 120 px climbed a pine's crown step by step to 8 m. On the surface
 * it stands on (the same mesh: the hill) the foot follows it up and down freely.
 */
const STEP_UP = 1.2;
/**
 * The move on surfaces: what the pointer shows (the first face along the ray) pulls the step toward it only when it
 * is at most this far from the stepped place (m): a barrel pulled onto the pier's planks, a foot that lagged on a
 * slope. 2: farther is not the foot's ground but something in front of or behind it (the slope in front of the
 * lighthouse's hill is 8 m off) and is left alone.
 */
const REACH = 2;
/**
 * The move on surfaces: how far one step may go toward what the pointer shows, as a share of the step itself. 0.5:
 * the foot comes back under the pointer over a few steps and a step is never more than 1.5× itself. WHY not all at
 * once (the same day): a small bump in front of the cottage's and a pine's foot took the place under the pointer
 * 1.1 m nearer after a 4 px move, and the first step was a 1 m hop toward the camera.
 */
const PULL = 0.5;

function bootState() {
  const b = globalThis.__studioThree;
  if (!b) throw new Error('studio: boot.js did not run before the game (it must be the first script in <head>)');
  return b;
}

/** Pick the scene the player looks at: the one rendered with a camera, with the most objects. */
function mainScene(boot) {
  let best = null;
  let bestN = -1;
  for (const s of boot.scenes) {
    // a scene counts once it was rendered with a camera, or the game handed us its camera via studio.ready({ camera })
    if (!boot.lastCamera.has(s) && !boot.readyCamera) continue;
    let n = 0;
    s.traverse(() => n++);
    if (n > bestN) (best = s), (bestN = n);
  }
  return best;
}

/** Resolves with an adapter once the game has rendered a scene at least once (or attach() was called). */
function whenThreeReady({ timeoutMs = 20000 } = {}) {
  const boot = bootState();
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const tick = () => {
      const scene = mainScene(boot);
      const renderer = boot.renderers.find((r) => r.domElement && r.domElement.isConnected) || boot.renderers[0];
      if (scene && renderer) return resolve(createThreeAdapter({ scene, renderer }));
      if (performance.now() - t0 > timeoutMs) return reject(new Error('studio: no three.js scene was rendered'));
      // The browser's own timer (boot.js): the window's one waits with a held game's clock (core/play-timers.ts).
      (boot.setTimeout || setTimeout)(tick, 50);
    };
    tick();
  });
}

function createThreeAdapter({ scene, renderer, camera }) {
  const boot = bootState();
  const nativeRender = renderer.__studioRender || renderer.render;
  const gameCamera = () => boot.lastCamera.get(scene) || camera || boot.readyCamera;
  let editing = false;
  let view = null;
  let dirty = true;
  let watchSnap = null; // transforms kept while the editor watches the game play (watch)
  // What the game added and took away while it played (watch(false, true): Play → Edit), held out of / put back into the
  // scene for Edit and handed back to the game at the next Play (watch(true, true)). null = nothing held.
  let playStash = null;
  let loopGen = 0; // each begin() starts a new paint loop; an old loop sees a stale generation and stops
  let lastCount = -1;
  let cands = [];
  let byKey = new Map();
  const grabs = new Map();
  const listeners = new Set();
  const restoreDom = [];
  // Objects taken out with remove() (CONTRACT.md §1.8): key → the object and its own `visible`.
  // They stay in the scene graph, hidden, so the keys of the others (name#2, path:…) never shift.
  const removed = new Map();
  let guard = null;
  let origBefore = null;
  // The opening view (polish pass 2026-10-16). `atHome` = the edit camera still stands where the game camera stood
  // (nothing moved it since view.home()); the first pick from there glides to an angle made for editing (settle).
  // `glide` = the running glide's generation (0 = none); any look-around gesture stops it where it is.
  let atHome = false;
  let glide = 0;
  let fogRef = 10;
  // Snap to surfaces (surface.js, bridge/snap.ts; a try of the editor, 2026-10-19). `on`: the bridge turns it on for the length of
  // a person's move (a drag, an arrow key) and off after, so every other caller of drag() — the copies' placement,
  // the AI's changes, a placement file — moves exactly as before. `free`: Ctrl / ⌥ held right now (no snapping until
  // let go). `skip`: the keys moving together (the selection): never a surface for each other.
  let snap = { on: false, free: false, skip: [] };
  const leaveHome = () => { atHome = false; glide = 0; };
  /** `o` into `parent` at `index` among its children (the end when the list is shorter now). */
  const putAt = (o, parent, index) => {
    if (o.parent !== parent) {
      o.parent?.remove(o);
      parent.add(o);
    }
    const c = parent.children;
    c.splice(c.indexOf(o), 1);
    c.splice(Math.max(0, Math.min(index, c.length)), 0, o);
  };
  /**
   * Play → Edit (studio-edit-restore, 2026-10-23; a try of the editor: "after playing, Edit came back in the middle of the game —
   * keep the edit scene I was on"): the scene as Play found it, not only its transforms. What the game ADDED while
   * playing (a bullet, a spawned obstacle, an effect) is taken out of the scene, and what it TOOK AWAY or moved to
   * another parent (a coin picked up, a part attached to the player) goes back where it was, at the same place among
   * its parent's children — so every key (name#2, path:…) is the one the editor had. Returns what to hand back at the
   * next Play (giveBack): the game's code still holds these objects, and its next frame expects them where it left
   * them (a bullet it moves, a coin it took). WHY not keep them out for good: Play goes on from the game's own state
   * (play-switch.ts: the score, a timer, what it made), and a spawned enemy the game still steps but no longer sees in
   * the scene would be a ghost.
   */
  function holdOut(snap) {
    const had = new Set(snap.map((x) => x[0]));
    const added = [];
    scene.traverse((o) => {
      // Only the top of each new subtree (its parent was there): the rest goes with it.
      if (!had.has(o) && o.parent && had.has(o.parent)) added.push([o, o.parent, o.parent.children.indexOf(o)]);
    });
    for (const [o] of added) o.parent.remove(o);
    const back = [];
    for (const [o, , , , , parent, index] of snap) {
      if (!parent || o.parent === parent) continue;
      back.push([o, o.parent, o.parent ? o.parent.children.indexOf(o) : -1]);
      putAt(o, parent, index);
    }
    return added.length || back.length ? { added, back } : null;
  }
  /** The next Play: the game's things as it left them (holdOut, undone in reverse order). */
  function giveBack(st) {
    for (const [o, parent, index] of st.back.slice().reverse()) {
      if (parent) putAt(o, parent, index);
      else o.parent?.remove(o);
    }
    for (const [o, parent, index] of st.added.slice().reverse()) putAt(o, parent, index);
    scene.updateMatrixWorld(true);
    touch();
  }
  /**
   * Move the edit camera from view state `from` to `to` in 0.6 s (ease in-out), starting at `from`. Any look-around
   * gesture (leaveHome / a new glide) stops it where it is. `done` runs at the end. `stop()` true ends it early (the
   * glide home stops once the person moved the view: atHome went false).
   */
  function glideTo(from, to, done, stop) {
    view.set(from);
    const gen = ++glide;
    const now = boot.now || (() => performance.now());
    const t0 = now();
    const MS = 600;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const lerp = (a, b, k) => a + (b - a) * k;
    // The short way round (yaw is unbounded after orbiting: 350° → 10° turns 20°, not 340°).
    const yawTo = from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
    const step = () => {
      if (gen !== glide || !editing || (stop && stop())) return;
      const t = Math.min(1, (now() - t0) / MS);
      const k = ease(t);
      view.set({
        target: [0, 1, 2].map((i) => lerp(from.target[i], to.target[i], k)),
        // distance on a log scale: a 45 m → 8 m move feels even all the way, not fast then crawling
        distance: Math.exp(lerp(Math.log(from.distance), Math.log(to.distance), k)),
        pitch: lerp(from.pitch, to.pitch, k),
        yaw: lerp(from.yaw, yawTo, k)
      });
      touch();
      if (t < 1) boot.nativeRAF(step);
      else {
        glide = 0;
        if (done) try { done(); } catch (e) { console.warn(e); }
      }
    };
    boot.nativeRAF(step);
  }

  // ---------------------------------------------------------------- helpers
  const canvas = renderer.domElement;
  const cssSize = () => {
    const r = canvas.getBoundingClientRect();
    return [r.width || canvas.width, r.height || canvas.height];
  };
  const aspect = () => {
    const [w, h] = cssSize();
    return w / Math.max(1, h);
  };
  function syncView() {
    if (view) view.apply(aspect());
    scene.updateMatrixWorld(true);
  }
  function refresh() {
    cands = collectCandidates(scene).filter((c) => !removed.has(c.key));
    byKey = new Map(cands.map((c) => [c.key, c]));
    return cands;
  }
  function objectOf(key) {
    let c = byKey.get(key);
    if (!c || !isInScene(c.object)) c = (refresh(), byKey.get(key));
    return c ? c.object : null;
  }
  function isInScene(o) {
    for (let p = o; p; p = p.parent) if (p === scene) return true;
    return false;
  }
  function rotatable(o) {
    return !(o.userData && o.userData.studioRotate === false);
  }
  function scalable(o) {
    return !(o.userData && o.userData.studioScale === false);
  }
  // Tilt (rotation.x / .z) in a pose: `t` is reported whenever the object is tilted at all (absolute values, so a
  // game that already applies a saved tilt at start reads back the same `t`, and a ground the game lays flat with
  // rotation.x = -90° just reports it). A pose WITHOUT `t` leaves the object's x / z as they are — a placement.json
  // written before tilting existed never flattens that ground — except for objects the editor tipped in this
  // session: those go back to the tilt they had when first seen (undo of a tip).
  const baseTilt = new WeakMap();
  const tippedHere = new WeakSet();
  const tiltOf = (o) => {
    if (!baseTilt.has(o)) baseTilt.set(o, [o.rotation.x, o.rotation.z]);
    return baseTilt.get(o);
  };
  let turnPivot = null;
  function poseOf(o) {
    const s = o.scale;
    const uniform = s.x === s.y && s.y === s.z;
    const pose = { p: [o.position.x, o.position.y, o.position.z], r: wrapAngle(o.rotation.y), s: uniform ? s.x : [s.x, s.y, s.z] };
    tiltOf(o);
    if (Math.abs(wrapAngle(o.rotation.x)) > 1e-5 || Math.abs(wrapAngle(o.rotation.z)) > 1e-5) pose.t = [wrapAngle(o.rotation.x), wrapAngle(o.rotation.z)];
    return pose;
  }
  function worldOrigin(o) {
    const e = o.matrixWorld.elements;
    return [e[12], e[13], e[14]];
  }
  /** The rotation axis point: the object's origin (x, z) at the middle height of its world box. */
  function pivotOf(o) {
    const w = worldOrigin(o);
    const b = worldBox(o);
    return b ? [w[0], (b.min[1] + b.max[1]) / 2, w[2]] : w;
  }
  /** Put the object's world origin at `world` (parent transforms respected). */
  function setWorldPosition(o, world) {
    const vec = o.position.clone();
    vec.set(world[0], world[1], world[2]);
    if (o.parent) {
      o.parent.updateWorldMatrix(true, false);
      o.parent.worldToLocal(vec);
    }
    o.position.copy(vec);
    o.updateMatrixWorld(true);
  }
  /** The objects that are never a surface for `o`: itself (its subtree), and the other moving objects. */
  function skipFor(o, keys) {
    const out = new Set([o]);
    for (const k of keys || snap.skip) {
      const x = objectOf(k);
      if (x) out.add(x);
    }
    return out;
  }
  /**
   * The box the snapping measures from: the solid parts only (surface.js solidBox — a lighthouse without its light
   * beams), or the whole box when nothing in it is solid (an object made only of a glow still moves).
   */
  function footBox(o) {
    return solidBox(o) || worldBox(o);
  }
  /**
   * World heights of the object's bottom (its box) and of the highest surface under it, looking down from the top of
   * its box: a thing sunk into the ground or the water still finds the surface it stands in (Lantern Cove's props
   * stand 15 cm deep; its barrel floats with its middle under the water — the first version looked down from the
   * box's middle and found the sea floor 4 m down instead of the sea). null: no box.
   */
  function restOf(o, keys) {
    scene.updateMatrixWorld(true);
    const b = footBox(o);
    if (!b) return null;
    const meshes = surfaceMeshes(scene, skipFor(o, keys));
    const hit = surfaceBelowHit(b, b.max[1] + 1e-4, meshes);
    return { bottom: b.min[1], below: hit ? hit.y : null, on: hit ? hit.mesh : null, box: b, meshes };
  }
  /**
   * Is the object standing on that surface (so a move keeps it standing on what is under it)? Its bottom within
   * 3 cm (or 3 % of its height) above the surface, or sunk into it (any depth: the surface is under its top — a
   * floating barrel is half under the water). A lamp hung in the air, a gull, a thing lifted on purpose: not
   * standing — those move flat at their height, as before.
   */
  function standing(r) {
    if (!r || r.below === null) return false;
    const h = Math.max(1e-3, r.box.max[1] - r.box.min[1]);
    return r.bottom - r.below <= Math.max(0.03, 0.03 * h);
  }

  function kindsOf(o) {
    const loaded = boot.urlOf.has(o) || boot.guessOf.has(o) || (o.geometry && (boot.urlOf.has(o.geometry) || boot.guessOf.has(o.geometry)));
    if (loaded) return ['model', 'object'];
    if (o.isMesh && o.geometry && o.geometry.type) return [o.geometry.type.replace(/(Buffer)?Geometry$/, '').toLowerCase() || 'mesh', 'object'];
    return ['group', 'object'];
  }
  function groupOf(c) {
    const o = c.object;
    if (c.source === 'name' || c.source === 'mark') return String(c.label).replace(/([#._\- ]?\d+)$/, '') || c.label;
    let m = null;
    o.traverse((x) => { if (!m && x.isMesh) m = x; });
    if (!m) return undefined;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return `shape:${m.geometry.uuid.slice(0, 8)}:${mat ? mat.uuid.slice(0, 8) : ''}`;
  }
  /**
   * What an unnamed object looks like, for the name the editor guesses (Item.look; a hands-on try, 2026-10-19: a pillar
   * built as `new Group()` of a black box and a pink lid read "Unnamed group" on the card and in the ask bar, and its
   * thumbnail did not say "pillar"). `size` / `c` = the world box (all meshes), `color` = the main part's colour: the
   * mesh with the largest box (the black body, not the thin pink lid), `inside` = drawn from the inside (BackSide: a sky
   * dome). Only for objects without a name: a named one is called by its name. At most 64 meshes are looked at.
   */
  function lookOf(o) {
    const b = worldBox(o);
    if (!b) return undefined;
    let main = null, best = -1, n = 0;
    o.traverse((x) => {
      if (!x.isMesh || n++ >= 64) return;
      const mb = worldBox(x);
      // Box "volume" with a floor on each side, so a flat plane (0 thick) still counts by its area.
      const v = mb ? [0, 1, 2].reduce((acc, i) => acc * Math.max(1e-3, mb.max[i] - mb.min[i]), 1) : 0;
      if (v > best) (best = v), (main = x);
    });
    const mat = main && (Array.isArray(main.material) ? main.material[0] : main.material);
    const r3 = (v) => Math.round(v * 1000) / 1000;
    const look = { size: [0, 1, 2].map((i) => r3(b.max[i] - b.min[i])), c: [0, 1, 2].map((i) => r3((b.max[i] + b.min[i]) / 2)) };
    if (mat && mat.color && typeof mat.color.getHexString === 'function') look.color = `#${mat.color.getHexString()}`;
    if (mat && mat.side === 1) look.inside = true; // THREE.BackSide
    return look;
  }
  function item(c) {
    const o = c.object;
    const pose = poseOf(o);
    return {
      key: c.key,
      label: c.label,
      kinds: kindsOf(o),
      group: groupOf(c),
      unstable: c.unstable || undefined,
      look: c.unstable ? lookOf(o) : undefined,
      rotatable: rotatable(o),
      scalable: scalable(o),
      pos: pose.p,
      yaw: pose.r,
      scale: pose.s,
      pose
    };
  }
  // A game render we skipped while holding, or a file that finished loading, may have changed what is on screen.
  boot.on((type) => { if (editing && (type === 'game-render-skipped' || type === 'load')) dirty = true; });
  const emit = (type, detail) => listeners.forEach((fn) => { try { fn(type, detail); } catch (e) { console.warn(e); } });
  const touch = () => { dirty = true; };

  /**
   * The move on surfaces (snap on, the object standing). `g.at` = the foot: the point where the object meets what it
   * stands on (world; set at the grab, then where each step put it), `g.last` = the pointer (ndc) at the last step.
   * Each pointer step moves the foot by itself, from where the foot is — never from what a ray meets first:
   * 1. the step on screen read as a step on the ground at the foot (right / left across the view, up / down the
   *    screen away / toward; the screen motion one metre each way makes at the foot, solved for the step — exact on
   *    a ground seen from above, the "up the screen" part capped at 1 / GRAZE where the ground is seen edge-on or
   *    from below, and up then is always away);
   * 2. the foot's new height (after 3, which only moves the place): the highest surface straight under it that it
   *    may go to (the hill — not a pine's crown above it, not the sea under the land; the pier's planks over the
   *    water); nothing there: flat;
   * 3. what the pointer shows — the first face to stand on along the ray through the foot's screen point, where
   *    Unreal's surface snapping puts things — pulls the step toward it (at most PULL of the step) when it is within
   *    REACH and STEP_UP of the foot: the barrel pulled onto the pier ends where the pointer put it, and a foot that
   *    lagged on a slope comes back under the pointer.
   * WHY (review 3 of 2026-10-20): the first version did only (3) and took any face. On a hill seen from the cove the
   * first face is the slope in front of the object: the lighthouse dragged 20 px jumped 8 m toward the camera,
   * 120 px flung it 64 m into the hills, up 30 px 78 m, and a ray through the sailboat's sail (a "wall") dropped it to
   * the boat's foot. Following the ground at the foot's height by the ray instead (tried the same day) turned over
   * there: from below the hill's top, up the screen meets that height nearer the camera, and up 30 px slid the
   * lighthouse 12 m down the slope toward the camera.
   * The bottom keeps the gap it had at the grab (`g.stand`: a post sunk 15 cm stays 15 cm deep, a barrel keeps its
   * float) while it is over the surface it stood on (`g.on`, the same mesh); on another surface its bottom sits exactly
   * on it (a gap above kept, a sink not: the barrel floating half under the water, dragged onto the pier, stands ON
   * the planks — keeping its 43 cm float there sank it into them).
   */
  function dragOnSurface(o, g, ndcX, ndcY) {
    scene.updateMatrixWorld(true);
    const b = footBox(o);
    if (!b) return poseOf(o);
    const meshes = surfaceMeshes(scene, skipFor(o));
    const at = g.at;
    // 1. The step on the ground at the foot. Pixels, not ndc: ndc x and y differ by the aspect.
    const [cw, ch] = cssSize();
    const vp = viewProjOf(view.camera);
    const px = (p) => {
      const q = project(vp, p);
      return q[3] > 0 ? [(q[0] * cw) / 2, (q[1] * ch) / 2] : null;
    };
    const e = view.camera.matrixWorld.elements;
    const flat = (x, z) => {
      const l = Math.hypot(x, z);
      return l > 1e-6 ? [x / l, 0, z / l] : null;
    };
    const right = flat(e[0], e[2]);
    // Away = the camera's forward on the ground; looking straight down it has none, and the screen's up is away.
    const away = flat(-e[8], -e[10]) || flat(e[4], e[6]);
    if (!right || !away) return poseOf(o);
    const f0 = px(at), fr = px(v.add(at, right)), fa = px(v.add(at, away));
    if (!f0 || !fr || !fa) return poseOf(o);
    const jr = [fr[0] - f0[0], fr[1] - f0[1]];
    let ja = [fa[0] - f0[0], fa[1] - f0[1]];
    const across = Math.hypot(jr[0], jr[1]);
    if (!(across > 1e-9)) return poseOf(o);
    if (ja[1] < GRAZE * across) ja = [ja[0], GRAZE * across]; // edge-on or from below: up the screen = away, capped
    const d = [((ndcX - g.last[0]) * cw) / 2, ((ndcY - g.last[1]) * ch) / 2];
    const det = jr[0] * ja[1] - jr[1] * ja[0];
    if (Math.abs(det) < 1e-12) return poseOf(o);
    const mr = (d[0] * ja[1] - d[1] * ja[0]) / det; // metres right
    const ma = (jr[0] * d[1] - jr[1] * d[0]) / det; // metres away
    g.last = [ndcX, ndcY];
    const x = at[0] + right[0] * mr + away[0] * ma;
    const z = at[2] + right[2] * mr + away[2] * ma;
    // 3 (before 2: it only moves the place). Toward what the pointer shows, when it is near.
    const hit = castSurface(rayFromCamera(view.camera, ndcX + g.foot[0], ndcY + g.foot[1]), meshes, { minUp: 0.5 });
    const shown = hit && hit.point;
    let to = [x, at[1], z];
    if (shown && Math.abs(shown[1] - at[1]) <= STEP_UP) {
      const gap = Math.hypot(shown[0] - x, shown[2] - z);
      const pull = Math.min(gap, PULL * Math.hypot(x - at[0], z - at[2]));
      if (gap <= REACH && gap > 1e-9) to = [x + ((shown[0] - x) * pull) / gap, at[1], z + ((shown[2] - z) * pull) / gap];
    }
    // 2. Its height there: the highest surface straight under the middle (the foot) that it may go to — on the surface
    // it stands on, any height (the hill rises under it); onto another one, at most STEP_UP above the foot. WHY the
    // middle and not restOf()'s five rays (the same day): the cottage's box is 6 m wide, its five rays met the pines
    // beside it and it climbed them; and on its rise the uphill ray sat 0.8 m over the middle, so the gap measured
    // that way sank it 0.8 m at the first step (the gap here is measured the same way at the grab: g.at).
    let under = null;
    for (const h of castSurfaceAll({ o: [to[0], 1e5, to[2]], d: [0, -1, 0] }, meshes)) {
      if (h.point[1] > at[1] + STEP_UP && h.mesh !== g.on) continue; // too high a step onto something else
      under = h;
      break; // nearest first = the highest that is low enough
    }
    const hitMesh = under ? under.mesh : null;
    if (under) to[1] = under.point[1]; // nothing under it (off the land): flat at its height
    const bottom = hitMesh ? to[1] + (hitMesh === g.on ? g.stand : Math.max(0, g.stand)) : b.min[1];
    const w = worldOrigin(o);
    setWorldPosition(o, [w[0] + to[0] - (b.min[0] + b.max[0]) / 2, w[1] + bottom - b.min[1], w[2] + to[2] - (b.min[2] + b.max[2]) / 2]);
    g.at = to;
    touch();
    return poseOf(o);
  }

  // ---------------------------------------------------------------- drawing while editing
  function draw() {
    syncView();
    const saved = { autoClear: renderer.autoClear, target: renderer.getRenderTarget ? renderer.getRenderTarget() : null };
    // Fog is tuned for the game camera (close to the player). The edit camera is usually much farther away, and the
    // whole map would sink into fog colour. Push the fog out by the edit distance for our own frames only.
    // Only the distance BEYOND the opening view's (the game camera's) counts (polish pass 2026-10-16): the opening
    // view is the player's own picture, haze included; before, a 45 m opening distance thinned a harbour's dusk haze
    // to a fifth and the opening looked flat. `fogRef` = 10 m when the view did not start from the game camera.
    const fog = scene.fog;
    const fogSaved = fog ? { near: fog.near, far: fog.far, density: fog.density } : null;
    if (fog) {
      const d = view.state().distance;
      if (fog.isFog) (fog.near += Math.max(0, d - fogRef)), (fog.far += Math.max(0, d - fogRef));
      else if (fog.isFogExp2) fog.density = fog.density * Math.min(1, fogRef / Math.max(1, d));
    }
    boot.selfRender++;
    try {
      if (renderer.setRenderTarget) renderer.setRenderTarget(null);
      renderer.autoClear = true;
      const [w, h] = cssSize();
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, w, h);
      if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
      nativeRender.call(renderer, scene, view.camera);
    } finally {
      boot.selfRender--;
      if (fog && fogSaved) {
        if (fog.isFog) (fog.near = fogSaved.near), (fog.far = fogSaved.far);
        else if (fog.isFogExp2) fog.density = fogSaved.density;
      }
      renderer.autoClear = saved.autoClear;
      if (renderer.setRenderTarget && saved.target) renderer.setRenderTarget(saved.target);
    }
  }
  let beat = 0;
  function loop(gen) {
    if (!editing || gen !== loopGen) return;
    boot.nativeRAF(() => loop(gen));
    // Heartbeat: models that finish loading while we edit change the scene without telling us.
    if (++beat % 15 === 0) {
      let n = 0;
      scene.traverse(() => n++);
      if (n !== lastCount) {
        lastCount = n;
        dirty = true;
        emit('list');
      }
    }
    if (dirty) {
      dirty = false;
      draw();
      emit('frame');
    }
  }

  /**
   * Hide the game's own DOM (HUD, menus, touch sticks) next to the canvas while editing — it would cover objects.
   * Not the UI the game marked with data-studio-key (or a box holding it): that is the editor's UI layer (UI stage 1,
   * 2026-10-19), shown — faded while the world is edited (bridge/editor.ts paintLayers). A game without the mark
   * hides exactly what it did before.
   */
  function hideOverlays() {
    for (let el = canvas; el && el.parentElement; el = el.parentElement) {
      for (const sib of el.parentElement.children) {
        if (sib === el || sib.hasAttribute('data-studio-keep') || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sib.tagName)) continue;
        if (sib.matches('[data-studio-key]') || sib.querySelector('[data-studio-key]')) continue;
        restoreDom.push([sib, sib.style.getPropertyValue('visibility'), sib.style.getPropertyPriority('visibility')]);
        sib.style.setProperty('visibility', 'hidden', 'important');
      }
      if (el.parentElement === document.body) break;
    }
  }
  function showOverlays() {
    for (const [el, val, prio] of restoreDom.splice(0)) {
      if (val) el.style.setProperty('visibility', val, prio);
      else el.style.removeProperty('visibility');
    }
  }

  // ---------------------------------------------------------------- the adapter
  const adapter = {
    kind: 'three',
    dim: '3d',
    get editing() { return editing; },
    get scene() { return scene; },
    get renderer() { return renderer; },

    list() {
      scene.updateMatrixWorld(true);
      const cs = refresh();
      // Ground / road / sea / sky (ground.js): the editor holds these still until "Make movable" (bridge/hold.ts).
      const grounds = groundKeys(cs.map((c) => ({ key: c.key, label: c.label, named: c.source !== 'path', box: worldBox(c.object) })));
      return cs.map((c) => (grounds.has(c.key) ? { ...item(c), backdrop: true } : item(c)));
    },

    begin() {
      if (editing) return adapter.list();
      if (!boot.held) boot.hold('begin');
      editing = true;
      const gc = gameCamera();
      gc.updateMatrixWorld(true);
      view = createEditView(gc);
      view.set({ yaw: yawOfCamera(gc) });
      hideOverlays();
      // Keep our framing even if the game's scene.onBeforeRender moves "the camera" it is given (follow cams do).
      origBefore = scene.onBeforeRender;
      guard = function (r, s, cam, ...rest) {
        if (origBefore) origBefore.call(this, r, s, cam, ...rest);
        if (cam === view.camera) view.apply(aspect());
      };
      scene.onBeforeRender = guard;
      addEventListener('resize', touch);
      adapter.view.home();
      dirty = true;
      const gen = ++loopGen;
      boot.nativeRAF(() => loop(gen));
      draw();
      return adapter.list();
    },

    /**
     * bridge/observe.ts: the game's own frames run (its draws stay held) while the editor watches. Off again puts
     * EVERY transform of the scene (and the game's camera) back as it was, not only the listed objects': the parts
     * the list does not show move too — a lighthouse's turning beam stayed turned and caught taps meant for the sky,
     * and a camera that sways moved the opening view (studio-deselect / web-demo-move, 2026-10-19).
     */
    watch(on, whole = false) {
      if (on) {
        watchSnap = [];
        // The Euler angles, not the quaternion (the same lesson as boot.js snapLayout): copying a quaternion makes three
        // re-derive the angles, and a boat turned 115° came back as (180°, 65°, 180°) — the same turn, but read as
        // "tilted upside down" with r = 65°. Then "Put back and save" (safe-save) or an undo set r alone and left the
        // 180° tilt, and Lantern Cove's sailboat was saved turned 49° from where it was (e2e-016, 2026-10-20).
        // The parent and the place among its children too, for whole (Play → Edit: what the game took away goes back there).
        const keep = (o) => watchSnap.push([o, o.position.clone(), o.rotation.clone(), o.scale.clone(), o.visible, o.parent, o.parent ? o.parent.children.indexOf(o) : -1]);
        scene.traverse(keep);
        const gc = gameCamera();
        if (gc && !gc.parent) keep(gc);
        // The next Play after an Edit (whole): the game's own things back as it left them — AFTER the snapshot, so the
        // snapshot stays the edit scene and the next Edit holds out everything the game made, this Play's and the last's.
        const st = playStash;
        playStash = null;
        if (whole && st) giveBack(st);
      } else if (watchSnap) {
        if (whole) playStash = holdOut(watchSnap);
        for (const [o, p, e, s, v] of watchSnap) {
          o.position.copy(p);
          o.rotation.copy(e); // also updates the quaternion (three keeps them in sync)
          o.scale.copy(s);
          o.visible = v;
        }
        watchSnap = null;
        scene.updateMatrixWorld(true);
        touch();
      }
      if (boot.watch) boot.watch(!!on);
    },

    end() {
      if (!editing) return;
      editing = false;
      loopGen++;
      removeEventListener('resize', touch);
      if (scene.onBeforeRender === guard) scene.onBeforeRender = origBefore;
      showOverlays();
      grabs.clear();
      boot.release();
    },

    pickNear(ndcX, ndcY, radiusPx = 12) {
      if (!view) return [];
      syncView();
      refresh();
      return pickNearImpl(cands, view.camera, viewProjOf(view.camera), ndcX, ndcY, radiusPx, cssSize());
    },

    /** Share (0–1) of the canvas the object's on-screen box covers, edges behind the camera included (pick.js screenShare). */
    coverage(key) {
      const o = objectOf(key);
      if (!o || !view) return null;
      syncView();
      return screenShare(o, viewProjOf(view.camera));
    },

    anchor(key) {
      const o = objectOf(key);
      if (!o || !view) return null;
      syncView();
      const box = worldBox(o);
      if (!box) return null;
      const vp = viewProjOf(view.camera);
      const pivot = pivotOf(o);
      const c = project(vp, pivot);
      const [w, h] = cssSize();
      const cr = canvas.getBoundingClientRect();
      const toPx = (nx, ny) => [cr.left + ((nx + 1) / 2) * w, cr.top + ((1 - ny) / 2) * h];
      const front = c[3] > 0;
      const up = project(vp, [pivot[0], pivot[1] + 1, pivot[2]]);
      const e = view.camera.matrixWorld.elements; // camera right = first column
      const side = project(vp, [pivot[0] + e[0], pivot[1] + e[1], pivot[2] + e[2]]);
      const pxPerM = Math.abs(((side[0] - c[0]) / 2) * w);
      // Seen from straight above, 1 m up is 0 px on screen; floor it so the height handle never feels stuck.
      const liftPx = front ? Math.max(Math.abs(((up[1] - c[1]) / 2) * h), pxPerM * 0.5) : 0;
      const rect = screenRect(o, vp);
      const onScreen = front && Math.abs(c[0]) <= 1 && Math.abs(c[1]) <= 1;
      return {
        center: [c[0], c[1]],
        centerPx: toPx(c[0], c[1]),
        front,
        onScreen,
        rect,
        rectPx: rect ? [...toPx(rect[0], rect[3]), ...toPx(rect[2], rect[1])] : null,
        liftPx,
        size: [w, h],
        pose: poseOf(o),
        rotatable: rotatable(o),
        scalable: scalable(o)
      };
    },

    /**
     * Start a move: the press point is caught on the horizontal plane at the pivot height; drag() keeps that offset.
     * With snapping on and the object standing on something (standing()), the move instead follows the surface under
     * its foot (see drag); `keep` = { gap, on }, the standing measured at the first grab of this drag (a switch to free
     * and back re-grabs, and by then the object may hang over the water).
     */
    grab(key, ndcX, ndcY, keep) {
      const o = objectOf(key);
      if (!o || !view) return false;
      syncView();
      const pivot = pivotOf(o);
      const hit = rayPlaneY(rayFromCamera(view.camera, ndcX, ndcY), pivot[1]);
      if (!hit) return false;
      const g = { y: pivot[1], off: [hit[0] - pivot[0], hit[2] - pivot[2]], mode: 'plane', stand: keep && keep.gap, on: keep && keep.on };
      if (snap.on && keep === undefined) {
        const r = restOf(o);
        g.stand = standing(r) ? r.bottom - r.below : null;
        g.on = r ? r.on : null;
      }
      if (snap.on && !snap.free && g.stand !== undefined && g.stand !== null) {
        // The foot (g.at, see dragOnSurface): where the object meets what it stands on, under the middle of its box.
        // Its screen point is kept as an offset from the press, so the object stays under the pointer the way it was
        // grabbed. Bottom − gap, not the box's bottom: a sea stack sunk 4 m into the water had its bottom's ray meet
        // the water well in front of it, so each ↓ step flung it toward the camera until it filled the view
        // (test/web-demo-lp, merge of 2026-10-19). The box without light effects (footBox): the lighthouse's foot is
        // under its tower, not under its beams (review 3, 2026-10-20).
        const b = footBox(o);
        const meshes = surfaceMeshes(scene, skipFor(o));
        const at = [(b.min[0] + b.max[0]) / 2, b.min[1] - g.stand, (b.min[2] + b.max[2]) / 2];
        // The move measures under the middle only (dragOnSurface 2), so the gap is measured there too, when the
        // middle stands on the same surface restOf()'s five rays found; a box resting on something else at its edge
        // (half over the pier) keeps the five rays' gap. Not on a re-grab (Ctrl let go): `keep` is that gap already.
        const mid = keep === undefined && castSurface({ o: [at[0], b.max[1] + 1e-4, at[2]], d: [0, -1, 0] }, meshes, { minUp: 0.5 });
        if (mid && mid.mesh === g.on) (g.stand = b.min[1] - mid.point[1]), (at[1] = mid.point[1]);
        const f = project(viewProjOf(view.camera), at);
        if (f[3] > 0) Object.assign(g, { mode: 'snap', foot: [f[0] - ndcX, f[1] - ndcY], at, last: [ndcX, ndcY] });
      }
      grabs.set(key, g);
      return true;
    },

    drag(key, ndcX, ndcY) {
      const o = objectOf(key);
      if (!o || !view) return null;
      if (!grabs.has(key) && !adapter.grab(key, ndcX, ndcY)) return poseOf(o);
      syncView();
      let g = grabs.get(key);
      // Ctrl / ⌥ pressed or let go during the drag: grab again where the pointer is, the other way.
      const want = snap.on && !snap.free && g.stand !== null && g.stand !== undefined ? 'snap' : 'plane';
      if (want !== g.mode) {
        if (!adapter.grab(key, ndcX, ndcY, { gap: g.stand, on: g.on })) return poseOf(o);
        g = grabs.get(key);
      }
      if (g.mode === 'snap') return dragOnSurface(o, g, ndcX, ndcY);
      const hit = rayPlaneY(rayFromCamera(view.camera, ndcX, ndcY), g.y);
      if (!hit) return poseOf(o); // pointing at the sky: keep the object where it is
      const w = worldOrigin(o);
      setWorldPosition(o, [hit[0] - g.off[0], w[1], hit[2] - g.off[1]]);
      touch();
      return poseOf(o);
    },

    /** World heights of the bottom and of the surface under it (bridge/snap.ts's Rest), or null. */
    rest(key, skip) {
      const o = objectOf(key);
      if (!o) return null;
      const r = restOf(o, skip);
      return r ? { bottom: r.bottom, below: r.below } : null;
    },

    /**
     * Drop to floor (End, as Unreal's End): the bottom of the box set on the highest surface under it. Nothing
     * under it (below the ground, over the void): stays. `skip`: keys that are not floors (the others dropped with it).
     */
    drop(key, skip) {
      const o = objectOf(key);
      if (!o) return null;
      const r = restOf(o, skip);
      if (r && r.below !== null && Math.abs(r.below - r.bottom) > 1e-6) {
        const w = worldOrigin(o);
        setWorldPosition(o, [w[0], w[1] + r.below - r.bottom, w[2]]);
        grabs.delete(key);
        touch();
      }
      return poseOf(o);
    },

    /** Snapping for the moves that follow (see `snap` above): { on, free, skip }. */
    setSnap(s) {
      snap = { on: !!(s && s.on), free: !!(s && s.free), skip: (s && Array.isArray(s.skip) ? s.skip : []).slice() };
    },

    release(key) {
      grabs.delete(key);
    },

    rotate(key, d) {
      const o = objectOf(key);
      if (!o) return null;
      if (rotatable(o) && isFinite(d)) o.rotation.y = wrapAngle(o.rotation.y + d);
      touch();
      return poseOf(o);
    },

    /**
     * Turn around one WORLD axis (y turn, x tip forward / back, z tip sideways) through the middle of the object's
     * world box. WHY the box middle: models often have their origin at one end (a lamp at its foot, a door at its
     * hinge); turned around that point they swung through a wide arc and left the place they were put. The middle
     * is measured once per gesture (calls on the same object less than 0.4 s apart reuse it): measured again at
     * every step, a long object's box middle wanders as it turns and the turn drifts.
     * `d` is the finger's turn on screen, clockwise positive (as rotate()); the sign follows the axis as the edit
     * camera sees it: an axis pointing away from the camera turns clockwise for a positive angle (right-hand rule).
     */
    turn(key, d, axis = 'y') {
      const o = objectOf(key);
      if (!o) return null;
      if (!rotatable(o) || !Number.isFinite(d) || !view) return poseOf(o);
      tiltOf(o);
      tippedHere.add(o);
      scene.updateMatrixWorld(true);
      const now = boot.now ? boot.now() : performance.now();
      let c;
      if (turnPivot && turnPivot.o === o && now - turnPivot.at < 400) c = turnPivot.c;
      else {
        const b = worldBox(o);
        c = b ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2] : worldOrigin(o);
      }
      turnPivot = { o, c, at: now };
      const A = axis === 'x' ? [1, 0, 0] : axis === 'z' ? [0, 0, 1] : [0, 1, 0];
      const e = view.camera.matrixWorld.elements;
      const dot = -(A[0] * e[8] + A[1] * e[9] + A[2] * e[10]); // axis · camera forward (the camera looks along its -z)
      const theta = (Math.abs(dot) < 0.15 ? -1 : Math.sign(dot)) * d;
      // Three's own classes from the object itself (this file imports nothing from three).
      const axisV = o.position.clone().set(A[0], A[1], A[2]);
      const qw = o.quaternion.clone().setFromAxisAngle(axisV, theta);
      const pq = o.quaternion.clone();
      if (o.parent) o.parent.getWorldQuaternion(pq);
      else pq.set(0, 0, 0, 1);
      // The same turn written in the parent's space: pq⁻¹ · qw · pq.
      const ql = pq.clone().invert().multiply(qw).multiply(pq);
      o.quaternion.premultiply(ql);
      const cv = o.position.clone().set(c[0], c[1], c[2]);
      const wp = o.getWorldPosition(o.position.clone());
      const moved = wp.sub(cv).applyQuaternion(qw).add(cv);
      if (o.parent) o.parent.worldToLocal(moved);
      o.position.copy(moved);
      o.updateMatrixWorld(true);
      grabs.delete(key);
      touch();
      return poseOf(o);
    },

    /** The bottom middle of the object's world box, in its parent's space (the space of pose.p). */
    foot(key) {
      const o = objectOf(key);
      if (!o) return null;
      scene.updateMatrixWorld(true);
      const b = worldBox(o);
      if (!b) return null;
      const v = o.position.clone().set((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2);
      if (o.parent) o.parent.worldToLocal(v);
      return [v.x, v.y, v.z];
    },

    /** The middle of the object's world box, in its parent's space (several tilted together turn round these). */
    middle(key) {
      const o = objectOf(key);
      if (!o) return null;
      scene.updateMatrixWorld(true);
      const b = worldBox(o);
      if (!b) return null;
      const v = o.position.clone().set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
      if (o.parent) o.parent.worldToLocal(v);
      return [v.x, v.y, v.z];
    },

    scale(key, factor) {
      const o = objectOf(key);
      if (!o) return null;
      if (scalable(o) && isFinite(factor) && factor > 0) {
        const s = o.scale;
        const f = Math.min(S_MAX / Math.max(s.x, s.y, s.z), Math.max(S_MIN / Math.min(s.x, s.y, s.z), factor));
        s.set(s.x * f, s.y * f, s.z * f);
      }
      touch();
      return poseOf(o);
    },

    nudgeY(key, dy) {
      const o = objectOf(key);
      if (!o) return null;
      if (isFinite(dy) && dy !== 0) {
        scene.updateMatrixWorld(true);
        const w = worldOrigin(o);
        setWorldPosition(o, [w[0], w[1] + dy, w[2]]);
        grabs.delete(key); // the pivot height changed; the next drag re-grabs on the new plane
      }
      touch();
      return poseOf(o);
    },

    /** Absolute pose (undo / redo / loading a placement). Exact: no accumulation of relative moves. */
    setPose(key, pose) {
      const o = objectOf(key);
      if (!o || !pose || !Array.isArray(pose.p) || pose.p.length !== 3 || !pose.p.every(Number.isFinite)) return null;
      o.position.set(pose.p[0], pose.p[1], pose.p[2]);
      if (Number.isFinite(pose.r) && rotatable(o)) o.rotation.y = pose.r;
      if (rotatable(o)) {
        const base = tiltOf(o);
        const t = Array.isArray(pose.t) && pose.t.length === 2 && pose.t.every(Number.isFinite) ? pose.t : tippedHere.has(o) ? base : null;
        if (t) {
          o.rotation.x = t[0];
          o.rotation.z = t[1];
        }
      }
      if (Number.isFinite(pose.s) && pose.s > 0) o.scale.set(pose.s, pose.s, pose.s);
      else if (Array.isArray(pose.s) && pose.s.length === 3 && pose.s.every((x) => Number.isFinite(x) && x > 0)) o.scale.set(pose.s[0], pose.s[1], pose.s[2]);
      o.updateMatrixWorld(true);
      grabs.delete(key);
      touch();
      return poseOf(o);
    },

    /**
     * The on-screen shape of these objects (CONTRACT.md: silhouette), for the editor's selection outline.
     *
     * WHY a matte of the real frame, not a copy of the mesh drawn a little bigger behind it (an "inverted hull"): a
     * hull only works for closed shapes; on an open mesh such as a barrel without a bottom the inside shows through
     * and the whole object turns into a filled blob (found while drawing the rebrand mock, 2026-10-16). Here the
     * objects are drawn alone with the edit camera, once on black and once on white; the difference is the coverage,
     * whatever the object's colours (a black lamp post on black would vanish with a single picture). Only the
     * objects' screen box is copied out. Then the normal frame is drawn again in the same task, so the matte is never
     * on screen. Three renders, but only when the selection or the view changed (the bridge caches it).
     */
    silhouette(keys) {
      if (!view || !editing) return null;
      const objs = keys.map(objectOf).filter(Boolean);
      if (!objs.length) return null;
      syncView();
      scene.updateMatrixWorld(true);
      const vp = viewProjOf(view.camera);
      let r = null;
      for (const o of objs) {
        const q = screenRect(o, vp);
        if (!q) continue;
        if (!r) r = q.slice();
        else (r[0] = Math.min(r[0], q[0])), (r[1] = Math.min(r[1], q[1])), (r[2] = Math.max(r[2], q[2])), (r[3] = Math.max(r[3], q[3]));
      }
      if (!r) return null;
      const cr = canvas.getBoundingClientRect();
      if (!(cr.width > 0 && cr.height > 0)) return null;
      const pr = canvas.width / cr.width;
      const pad = Math.ceil(6 * pr); // room for the outline outside the shape
      const W = canvas.width, H = canvas.height;
      const sx = Math.max(0, Math.floor(((r[0] + 1) / 2) * W) - pad);
      const sy = Math.max(0, Math.floor(((1 - r[3]) / 2) * H) - pad);
      const ex = Math.min(W, Math.ceil(((r[2] + 1) / 2) * W) + pad);
      const ey = Math.min(H, Math.ceil(((1 - r[1]) / 2) * H) + pad);
      const sw = ex - sx, sh = ey - sy;
      if (sw < 2 || sh < 2) return null;
      // Everything that is not one of the objects (or an ancestor of one) is hidden, lights stay.
      const keep = new Set();
      for (const o of objs) for (let n = o; n; n = n.parent) keep.add(n);
      const hidden = [];
      for (const n of keep) {
        if (!n.parent) continue;
        for (const sib of n.parent.children) {
          if (keep.has(sib) || sib.isLight || !sib.visible) continue;
          hidden.push(sib);
          sib.visible = false;
        }
      }
      const clear = { isColor: true, r: 0, g: 0, b: 0, copy(c) { this.r = c.r; this.g = c.g; this.b = c.b; return this; } };
      if (renderer.getClearColor) renderer.getClearColor(clear);
      const saved = { before: scene.onBeforeRender, after: scene.onAfterRender, background: scene.background, clearAlpha: renderer.getClearAlpha ? renderer.getClearAlpha() : 1,
        autoClear: renderer.autoClear, target: renderer.getRenderTarget ? renderer.getRenderTarget() : null };
      scene.onBeforeRender = () => {};
      scene.onAfterRender = () => {};
      const shoot = (white) => {
        scene.background = null;
        renderer.setClearColor(white ? 0xffffff : 0x000000, 1);
        if (renderer.setRenderTarget) renderer.setRenderTarget(null);
        renderer.autoClear = true;
        const [w, h] = cssSize();
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, w, h);
        nativeRender.call(renderer, scene, view.camera);
        const c = document.createElement('canvas');
        c.width = sw;
        c.height = sh;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
        return { c, g };
      };
      let mask = null;
      boot.selfRender++;
      try {
        if (renderer.setClearColor) {
          const onBlack = shoot(false);
          const onWhite = shoot(true);
          const b = onBlack.g.getImageData(0, 0, sw, sh);
          const w = onWhite.g.getImageData(0, 0, sw, sh).data;
          const d = b.data;
          for (let i = 0; i < d.length; i += 4) {
            const gap = (w[i] - d[i] + w[i + 1] - d[i + 1] + w[i + 2] - d[i + 2]) / 3;
            d[i] = d[i + 1] = d[i + 2] = 255;
            // A little threshold: soft edges count, the faint fringe of anti-aliasing does not.
            d[i + 3] = gap < 230 ? 255 : 0;
          }
          onBlack.g.putImageData(b, 0, 0);
          mask = onBlack.c;
        }
      } finally {
        boot.selfRender--;
        scene.onBeforeRender = saved.before;
        scene.onAfterRender = saved.after;
        scene.background = saved.background;
        if (renderer.setClearColor) renderer.setClearColor(clear, saved.clearAlpha);
        renderer.autoClear = saved.autoClear;
        if (renderer.setRenderTarget && saved.target) renderer.setRenderTarget(saved.target);
        for (const n of hidden) n.visible = true;
      }
      draw();
      if (!mask) return null;
      return { x: cr.left + sx / pr, y: cr.top + sy / pr, w: sw / pr, h: sh / pr, mask };
    },

    async capture(key, { size = 128 } = {}) {
      const o = objectOf(key);
      if (!o) return { ok: false };
      const res = captureObject({ renderer, scene, render: nativeRender, boot, baseCamera: view ? view.camera : gameCamera(), yaw: view ? view.state().yaw : 0.6 }, o, size);
      touch();
      if (editing) draw(); // the corner we drew into must not stay on screen until the next frame
      return res;
    },

    assetsOf(key) {
      const o = objectOf(key);
      return o ? assetsOfImpl(o, boot, document.baseURI) : [];
    },

    /**
     * Copy (CONTRACT.md §1.8): a clone of the object (meshes share geometry and materials) added to the same parent,
     * at the same pose, listed under `newKey` through userData.studioKey. Marks inside the clone are dropped so its
     * parts do not take keys like "wheel#2". Skinned meshes need SkeletonUtils.clone and are refused (stand-in).
     */
    clone(key, newKey) {
      const o = objectOf(key);
      if (!o || !o.parent || typeof o.clone !== 'function') return false;
      let skinned = false;
      o.traverse((x) => { if (x.isSkinnedMesh) skinned = true; });
      if (skinned) return false;
      const c = o.clone(true);
      c.traverse((x) => { if (x !== c && x.userData) delete x.userData.studioKey; });
      c.userData = { ...(c.userData || {}), studioKey: newKey };
      // Asset links (assets.js) follow the original's model URL, so the library still knows the file.
      if (boot.urlOf.has(o) && !boot.urlOf.has(c)) boot.urlOf.set(c, boot.urlOf.get(o));
      o.parent.add(c);
      c.updateMatrixWorld(true);
      refresh();
      touch();
      return byKey.has(newKey);
    },

    /** Delete (CONTRACT.md §1.8): hidden and left out of the list; putBack() undoes it exactly. */
    remove(key) {
      const o = objectOf(key);
      if (!o) return false;
      removed.set(key, { o, visible: o.visible });
      o.visible = false;
      grabs.delete(key);
      refresh();
      touch();
      return true;
    },

    putBack(key) {
      const r = removed.get(key);
      if (!r) return false;
      removed.delete(key);
      r.o.visible = r.visible;
      refresh();
      touch();
      return true;
    },

    /**
     * Ask while playing (CONTRACT.md §3.5): where the game's own camera (the player's view, never the edit camera)
     * stands and looks now. `target` = 10 units ahead along its view: a point to say "in front of you", not a hit test.
     */
    player() {
      const cam = gameCamera();
      if (!cam || !cam.matrixWorld) return null;
      cam.updateMatrixWorld?.(true);
      const e = cam.matrixWorld.elements;
      const f = [-e[8], -e[9], -e[10]]; // a camera looks along its own -z
      const n = Math.hypot(f[0], f[1], f[2]) || 1;
      const eye = [e[12], e[13], e[14]];
      if (!eye.every(Number.isFinite)) return null;
      const dir = [f[0] / n, f[1] / n, f[2] / n];
      // What is near, measured in WORLD space with the game camera (the poses in list() are the parents' local
      // space): in front of the camera or within 3 units of it (the player's own character often stands right there,
      // or just behind a third-person camera), nearest first. `screen` = where it is in the picture (0–1). The
      // ground / sea / sky are left out: they are "near" everything.
      scene.updateMatrixWorld(true);
      const cs = refresh();
      const grounds = groundKeys(cs.map((c) => ({ key: c.key, label: c.label, named: c.source !== 'path', box: worldBox(c.object) })));
      let vp = null;
      try {
        vp = viewProjOf(cam);
      } catch {
        vp = null;
      }
      const near = [];
      for (const c of cs) {
        if (grounds.has(c.key) || !c.object || !c.object.matrixWorld) continue;
        const w = c.object.matrixWorld.elements;
        const v = [w[12] - eye[0], w[13] - eye[1], w[14] - eye[2]];
        const d = Math.hypot(v[0], v[1], v[2]);
        const ahead = v[0] * dir[0] + v[1] * dir[1] + v[2] * dir[2];
        if (!Number.isFinite(d) || (ahead < 0 && d > 3)) continue;
        const it = { key: c.key, label: c.label, d };
        if (vp) {
          const q = project(vp, [w[12], w[13], w[14]]);
          if (q[3] > 0 && Math.abs(q[0]) <= 1.2 && Math.abs(q[1]) <= 1.2) it.screen = [(q[0] + 1) / 2, (1 - q[1]) / 2];
        }
        near.push(it);
      }
      near.sort((a, b) => a.d - b.d);
      return { eye, target: [eye[0] + dir[0] * 10, eye[1] + dir[1] * 10, eye[2] + dir[2] * 10], near: near.slice(0, 12) };
    },

    /** The Object3D behind a key (for tests and the placement loader). */
    objectOf,

    /** 'list' when the scene changed size while editing, 'frame' after each editor repaint. Returns an unsubscribe. */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    view: {
      orbit(dx, dy) { if (!view) return null; leaveHome(); view.orbit(dx, dy); touch(); return view.state(); },
      pan(dx, dy) { if (!view) return null; leaveHome(); syncView(); view.pan(dx, dy, aspect()); touch(); return view.state(); },
      zoom(factor, ndcX = 0, ndcY = 0) { if (!view) return null; leaveHome(); syncView(); view.zoom(factor, ndcX, ndcY); touch(); return view.state(); },
      /** Camera up (dy > 0) / down by dy view heights, looking the same way (camera.js rise; ⌘K, E / Q, the ↑↓ buttons). */
      rise(dy) { if (!view) return null; leaveHome(); view.rise(dy); touch(); return view.state(); },
      /** Fly (WASD / E Q): right / up / forward in seconds of travel at the scene's speed (camera.js fly). */
      fly(right, up, fwd) { if (!view) return null; leaveHome(); view.fly(right, up, fwd); touch(); return view.state(); },
      /** Turn where the camera stands (right-drag while flying; camera.js look), by fractions of the canvas. */
      look(dx, dy) { if (!view) return null; leaveHome(); view.look(dx, dy); touch(); return view.state(); },
      /**
       * The opening view: exactly the player's camera (position, direction, lens), so the first picture of the
       * editor is the game's own picture — the light, the water, the composition the game was made with.
       * WHY (polish pass 2026-10-16): the editor used to open on frameAll — the whole map from 50° above. A dusk
       * harbour made to be seen from 4 m over the water became a small dark map. The aim: "as
       * beautiful as the game the moment it opens". Editing from a 2° angle is hard, so the first pick glides up
       * (settle). F (frameAll) still shows everything.
       */
      home(opts) {
        if (!view) return null;
        const gc = gameCamera();
        scene.updateMatrixWorld(true);
        const sph = sceneSphere(refresh().map((c) => worldBox(c.object)).filter(Boolean));
        if (!gc) return adapter.view.frameAll();
        const from = view.state();
        if (sph) view.set({ radius: sph.r });
        view.fromCamera(gc, sph ? sph.c : null);
        fogRef = Math.max(10, view.state().distance);
        atHome = true;
        glide = 0;
        // "Back to the opening view" (⌘K, ⇧F; speed pass 2026-10-17): glide there in 0.6 s, the same move as the
        // first pick's glide but the other way, so the person sees where they came from. Opening the editor jumps.
        if (opts && opts.glide) glideTo(from, view.state(), null, () => !atHome);
        touch();
        return view.state();
      },
      /**
       * After a pick: when the view is still the opening (the game camera, often almost level with the ground),
       * glide in 0.6 s to the object seen from above at an angle made for dragging (30°, a phone 40°), the object
       * and its nearest neighbours in frame (the same framing as focus). Returns false (and does nothing) once the
       * person has looked around, zoomed or framed: from then on the view is theirs and a pick never moves it.
       * `done` runs when the glide ends (the bridge then slides the object clear of its panels).
       */
      settle(key, done) {
        if (!view || !atHome) return false;
        const o = objectOf(key);
        if (!o) return false;
        scene.updateMatrixWorld(true);
        const b = worldBox(o);
        if (!b) return false;
        atHome = false;
        const others = refresh().filter((c) => c.object !== o).map((c) => worldBox(c.object)).filter(Boolean);
        const f = focusSphere(b, others, pivotOf(o));
        const from = view.state();
        const [w, h] = cssSize();
        view.frame(f.center, f.radius, (h > w ? 40 : 30) * DEG);
        glideTo(from, view.state(), done);
        return true;
      },
      /**
       * Put the edit camera back where state() said it was (the shell keeps it across reloads: after Save, Play,
       * the AI's change). A kept opening view (`home: true`) is still the opening view: the first pick after the
       * reload glides as it would have (and the haze stays the game's).
       */
      restore(s) {
        if (!view || !s || typeof s !== 'object') return null;
        const fin = (x) => typeof x === 'number' && Number.isFinite(x);
        if (!Array.isArray(s.target) || s.target.length !== 3 || !s.target.every(fin) || !fin(s.distance) || !(s.distance > 0) || !fin(s.yaw) || !fin(s.pitch)) return null;
        leaveHome();
        if (s.home === true) {
          // The opening pitch may be under the usual 8° floor: set the floor from the game camera again first.
          const gc = gameCamera();
          if (gc) view.fromCamera(gc, null);
          atHome = true;
          fogRef = Math.max(10, s.distance);
        }
        view.set({ target: s.target, distance: s.distance, yaw: s.yaw, pitch: s.pitch });
        touch();
        return adapter.view.state();
      },
      /** True while the view is still the opening one (the game camera's). */
      get atHome() { return atHome; },
      frameAll() {
        if (!view) return null;
        leaveHome();
        scene.updateMatrixWorld(true);
        // Sky domes, seas and huge grounds would make everything else tiny: sceneSphere leaves out boxes far bigger than the typical one.
        const sph = sceneSphere(refresh().map((c) => worldBox(c.object)).filter(Boolean));
        if (!sph) return view.state();
        // A tall screen (a phone) looks down a little more: at 50° the top half of a portrait view was sky.
        const [w, h] = cssSize();
        view.frame(sph.c, sph.r, (h > w ? 62 : 50) * DEG);
        touch();
        return view.state();
      },
      focus(key) {
        const o = objectOf(key);
        if (!o || !view) return null;
        scene.updateMatrixWorld(true);
        const b = worldBox(o);
        if (!b) return view.state();
        // The object and a little of what is around it (focus.js): before, max(r × 2.2, 1.5 m) filled the screen with a barrel.
        const others = refresh().filter((c) => c.object !== o).map((c) => worldBox(c.object)).filter(Boolean);
        const f = focusSphere(b, others, pivotOf(o));
        leaveHome();
        // Below the usual 8° floor (only the opening view goes there) focus lifts to the editing angle; otherwise
        // the person's own pitch stays.
        const pitch = view.state().pitch;
        view.frame(f.center, f.radius, pitch < 8 * DEG ? 30 * DEG : pitch);
        touch();
        return view.state();
      },
      state() { return view ? (atHome ? { ...view.state(), home: true } : view.state()) : null; },
      /** The editor's own camera (for drawing selection marks in the game frame). */
      get camera() { return view ? view.camera : null; }
    }
  };
  return adapter;
}

__def(__exports, "whenThreeReady", () => whenThreeReady);
__def(__exports, "createThreeAdapter", () => createThreeAdapter);
};
__defs[12] = function (__exports) {
'use strict';
// ../adapters/three/index.ts

// The built-in three.js adapter as the bridge sees it (an AdapterProbe).
//
// boot.js does the early work (discovery through __THREE_DEVTOOLS__, holding
// frames, learning the player's camera from renderer.render, load records);
// it is imported first by src/bridge/main.ts so it runs before any game code.
// adapter.js builds the adapter once a scene has been rendered. This file
// answers the bridge's synchronous "found an adapter yet?" and fits adapter.js
// to the contract (CONTRACT.md §1.1).
//
// WHY a translation layer: adapter.js was written against the first draft of
// the port, where screen points were NDC (-1..1) and view deltas fractions of
// the canvas. Contract v1 uses viewport CSS px everywhere, because only the
// adapter knows the canvas rectangle. Converting here keeps adapter.js and its
// own tests unchanged; folding the conversion into adapter.js later is fine.
                                                                     
const { createThreeAdapter } = __require(11);
const { project, rayFromCamera, rayPlaneY, viewProjOf } = __require(3);

                     
                                                    
                                                       
                                       
                       
 

/* eslint-disable @typescript-eslint/no-explicit-any -- adapter.js is plain JS */
               

/** Wrap adapter.js (NDC-based) into the contract's px-based StudioAdapter. */
function fitThreeAdapter(raw     , canvas                   )                {
  const rect = () => canvas.getBoundingClientRect();
  const ndc = (x        , y        )                   => {
    const r = rect();
    return [((x - r.left) / Math.max(1, r.width)) * 2 - 1, 1 - ((y - r.top) / Math.max(1, r.height)) * 2];
  };
  const poseNow = (key        ) => raw.list().find((i     ) => i.key === key)?.pose;
  const pose = (key        , p     ) => p || poseNow(key);
  return {
    kind: 'three',
    dim: '3d',
    version: (globalThis       ).__THREE__ ? String((globalThis       ).__THREE__) : undefined,
    list: () => raw.list(),
    begin: () => raw.begin(),
    end: () => raw.end(),
    watch: (on, whole) => raw.watch(on, whole),
    // adapter.js repaints from its own loop whenever something changed.
    render: () => {},
    pickNear: (x, y, radius) => raw.pickNear(...ndc(x, y), radius),
    anchor(key) {
      const a = raw.anchor(key);
      if (!a) return null;
      const r = rect();
      const [x0, y0, x1, y1] = a.rectPx || [];
      const has = a.rectPx && Number.isFinite(x0);
      const vw = innerWidth, vh = innerHeight;
      const [cx, cy] = a.centerPx;
      return {
        center: [cx, cy],
        rect: has ? { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) } : undefined,
        liftPx: a.liftPx,
        size: has ? Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) : Math.min(r.width, r.height) / 10,
        pose: a.pose,
        visible: !!a.front && cx > -vw && cy > -vh && cx < 2 * vw && cy < 2 * vh,
      };
    },
    grab: (key, x, y) => raw.grab(key, ...ndc(x, y)),
    drag: (key, x, y) => pose(key, raw.drag(key, ...ndc(x, y))),
    // Contract: d is clockwise on screen. Seen from the edit camera (always
    // above the ground, pitch 8–85°), clockwise = negative rotation.y.
    rotate: (key, d) => pose(key, raw.rotate(key, -d)),
    // The axis and sign are worked out in adapter.js from the edit camera (d stays screen clockwise).
    turn: (key, d, axis) => pose(key, raw.turn(key, d, axis)),
    foot: (key) => raw.foot(key),
    middle: (key) => raw.middle(key),
    coverage: (key) => raw.coverage(key),
    scale: (key, f) => pose(key, raw.scale(key, f)),
    nudgeY: (key, dy) => pose(key, raw.nudgeY(key, dy)),
    // Snap to surfaces (surface.js, bridge/snap.ts): heights are world metres, as nudgeY moves by.
    rest: (key, skip) => raw.rest(key, skip),
    drop: (key, skip) => pose(key, raw.drop(key, skip)),
    setSnap: (s) => raw.setSnap(s),
    setPose: (key, p) => raw.setPose(key, p),
    capture: (key, o) => raw.capture(key, o),
    silhouette: (keys) => raw.silhouette(keys),
    clone: (key, newKey) => raw.clone(key, newKey),
    remove: (key) => raw.remove(key),
    putBack: (key) => raw.putBack(key),
    assetsOf: (key) => raw.assetsOf(key),
    player: () => raw.player(),
    // For game tools: the edit camera's ray onto a horizontal plane, and the
    // way back. Only while editing (the edit camera exists then).
    toGround(x, y, groundY = 0) {
      const cam = raw.view.camera;
      if (!cam) return null;
      const hit = rayPlaneY(rayFromCamera(cam, ...ndc(x, y)), groundY);
      return hit ? [hit[0], hit[1], hit[2]] : null;
    },
    toScreen(p) {
      const cam = raw.view.camera;
      if (!cam) return null;
      cam.updateMatrixWorld?.(true);
      const c = project(viewProjOf(cam), [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0]);
      if (!(c[3] > 0)) return null;
      const r = rect();
      return [r.left + ((c[0] + 1) / 2) * r.width, r.top + ((1 - c[1]) / 2) * r.height];
    },
    view: {
      orbit: (dx, dy) => void raw.view.orbit(dx / Math.max(1, rect().width), dy / Math.max(1, rect().height)),
      pan: (dx, dy) => void raw.view.pan(dx / Math.max(1, rect().width), dy / Math.max(1, rect().height)),
      rise: (dy) => void raw.view.rise(dy / Math.max(1, rect().height)),
      fly: (right, up, fwd) => void raw.view.fly(right, up, fwd),
      look: (dx, dy) => void raw.view.look(dx / Math.max(1, rect().width), dy / Math.max(1, rect().height)),
      zoom: (f, x, y) => void (x === undefined || y === undefined ? raw.view.zoom(f) : raw.view.zoom(f, ...ndc(x, y))),
      frameAll: () => void raw.view.frameAll(),
      focus: (key) => void raw.view.focus(key),
      state: () => raw.view.state(),
      restore: (s) => void raw.view.restore(s),
      home: (opts) => void raw.view.home(opts),
      settle: (key, done) => !!raw.view.settle(key, done),
    },
  };
}

let built                       = null;
let builtFor          = null;

/** The scene the player looks at: rendered with a camera, with the most objects (same rule as whenThreeReady). */
function mainScene(boot           ) {
  let best = null;
  let bestN = -1;
  for (const s of boot.scenes) {
    if (!boot.lastCamera.has(s) && !boot.readyCamera) continue;
    let n = 0;
    s.traverse(() => n++);
    if (n > bestN) {
      best = s;
      bestN = n;
    }
  }
  return best;
}

const threeProbe               = {
  kind: 'three',
  install() {
    // boot.js already installed its hooks when the edit script started.
  },
  found() {
    const boot = (globalThis                                            ).__studioThree;
    if (!boot) return null;
    const scene = mainScene(boot);
    const renderer = boot.renderers.find((r) => r.domElement && r.domElement.isConnected) || boot.renderers[0];
    if (!scene || !renderer) return null;
    if (built && builtFor === scene) return built;
    built = fitThreeAdapter(createThreeAdapter({ scene, renderer, camera: undefined }), (renderer       ).domElement);
    builtFor = scene;
    return built;
  },
};

__def(__exports, "fitThreeAdapter", () => fitThreeAdapter);
__def(__exports, "threeProbe", () => threeProbe);
};
__defs[13] = function (__exports) {
'use strict';
// ../contract.ts

// KUMODeck Game Studio — the shared contract (types and constants).
//
// Every part of the studio (bridge, shell, adapters, tools, schema, loader,
// local server) imports its shared shapes from this one file so the pieces can
// be built in parallel and still fit together. CONTRACT.md is the prose version
// of the same promises; when the two disagree, fix both in one commit.
//
// Rules for this file:
// - Types and plain constants only. No runtime behaviour beyond tiny pure
//   helpers, so it can be imported from the game iframe, the shell page and
//   the Node server alike.
// - Erasable TypeScript only (no enums, namespaces or parameter properties):
//   the zero-dependency build strips types with Node's built-in stripper.
// - Changing a shape here is a contract change: tell the integrator first and
//   bump CONTRACT_VERSION when an existing field changes meaning.

const CONTRACT_VERSION = 1;

// ---------------------------------------------------------------------------
// Basic shapes
// ---------------------------------------------------------------------------

                              
/**
 * Which adapter is talking. 'three' is the built-in three.js adapter; every
 * other value is free text chosen by whoever wrote the adapter (usually the
 * user's AI agent: 'pixi', 'phaser', 'canvas', 'my-engine', ...).
 */
                                 
                                             
/**
 * What the editor moves right now (UI stage 1, 2026-10-19; CONTRACT.md §1.1): the game's world (three.js / 2D
 * objects, as always) or its UI (HTML elements marked data-studio-key, later also UI drawn in a canvas). One at a
 * time; the top bar switches. Not the same as Item.layer (a 2D draw-order list).
 */
                                       

/**
 * UI stages 2–3 (2026-10-22; CONTRACT.md §1.11): the game's UI screens, what an element says and how it looks.
 * A button's looks other than its normal one: under the pointer (`:hover`), pressed (`:active`), not usable (`:disabled`).
 */
                                                      
/** What the card can change on a UI element: its main text, that text's size (CSS px) and colour, the box's fill. */
                                                                      
/** One state's colours (a button's hover / pressed / disabled look): the only props a state has of its own. */
                             
                 
                      
 
/**
 * placement.json `ui.<key>.set` / `setWas`: what the person changed on the card, and the game's own values (the AI
 * searches the code for those). Every field optional; a state's colours under "@hover" / "@active" / "@disabled".
 */
                             
                
                    
                 
                      
                        
                         
                           
 
/** One screen of the game's UI: a container marked data-studio-screen="<id>" (title, play, pause, over, …). */
                               
             
                                                                                              
                 
 
/** A UI element as the card shows it (bridge ui-extras.ts → ShellToBridge ui/props). */
                          
              
                                                        
                        
                                                               
                  
                                                                                                                   
                      
                          
                       
                                                                                                 
                            
                                                                                       
                  
     
                                                                                                                                                  
                                                                                                                 
     
                                                                       
 
/** One CSS variable of the game's theme (:root / html / body), as the theme rows show it. */
                             
               
                         
                                                    
                
                              
              
 

/**
 * Pose of one movable object, in the object's PARENT space (what you would
 * type into the game code). This is the same shape that is stored per object
 * in placement.json, so undo/redo, messages and the saved file never need to
 * convert between formats.
 *
 * - 3D: p = [x, y, z] in metres; r = rotation around the vertical axis
 *   (three.js `rotation.y`, radians, normalised to (-PI, PI]).
 * - 2D: p = [x, y] in pixels; r = angle in radians, clockwise positive (the
 *   same sign as Pixi's `rotation`).
 * - s = uniform scale as one number. Three numbers are accepted for objects
 *   that were non-uniformly scaled by the game; the editor only ever multiplies
 *   all components by the same factor.
 */
                       
              
             
                        
     
                                                                              
                                                                             
                                                                       
                                                                           
                                                                           
            
     
                       
     
                                                                             
                                                                               
                                                                           
                                                                           
                                                                             
                                                               
     
             
 

/** The world axis a 3D turn goes around: y = turn, x = tip forward / back, z = tip sideways. */
                                       
/**
 * The tool strip's four tools (2026-10-16, play test). Pressing a
 * strip button (or its key: M move, H height, T turn, S size) CHOOSES the
 * tool; it stays pressed, and a drag anywhere on the game then does it to
 * what is picked. Looking around while a tool is chosen: Option / right /
 * middle drag, or Space held; one finger = the tool, two = looking on touch.
 */
                                                             
/**
 * Resizing or turning several objects: `spread` ("together") = the whole arrangement as one piece (the gaps grow;
 * the places turn round the middle of the selection), `inplace` ("each in place") = each one on its own spot.
 * The turn uses the same two words since 2026-10-18 (play test: "no turn options with several picked").
 */
                                                  

/** One movable object as listed by an adapter. */
                       
                                                                     
              
                                                                                         
                
                                                                                  
                  
     
                                                                                                                    
                                                  
     
                  
     
                                                                         
                                                                                  
     
                 
                                                                                        
                     
                     
                    
                                                                              
                    
                                                                                        
                     
                                                                                                              
                        
     
                                                                          
                                                                              
                                                                           
                                                                            
     
                 
     
                                                                       
                                                                         
                                                                            
                                                                              
                                                                           
                                                                    
                                                                                                                
                                                                                                                     
                                                                                                        
     
                     
     
                                                                                                       
                                                                                                                
                                                                                                                        
                                                                                                                 
                                                                                                           
                                                                                                                     
                                                                  
     
                           
     
                                                                                                                
                                          
     
                                                    
     
                                                                                                                     
                                                                                                                   
                                                                                                                   
     
                      
     
                                                                             
                                                                             
     
                  
     
                                                                      
                                                                           
                        
     
                  
     
                                                                              
                                                                            
                                                                         
                                                                           
                                                                          
                                                                               
     
                  
                                     
             
 

/** Item.look: what an unnamed object looks like (src/shell/names.ts turns it into words). */
                           
                 
               
                 
                   
 

/**
 * Where the bridge draws the handles for the selected object, in CSS pixels
 * of the game iframe's viewport (the same space as PointerEvent.clientX/Y).
 */
                         
                                               
                           
                                                                           
                                                        
                                                                                            
                  
                                                                              
               
                                                                                
             
                                                                                       
                   
 

/** One asset an object uses. */
                           
                                                                                      
              
                                                                  
                                                                                             
                
 

/** One network/media load seen while the game was running (recorded by src/core). */
                            
              
                                                                        
                                                              
            
                                                    
               
 

// ---------------------------------------------------------------------------
// Promise 1: the port between the editor and a game (lives in the game iframe)
// ---------------------------------------------------------------------------
//
// The editor never depends on a game library. It talks to ONE fixed port:
//
// - Port2D (small, recommended for every 2D game): list objects, read/write a
//   pose, report where an object is on screen. The user's AI agent writes it
//   for the game at hand (PixiJS, Phaser, plain canvas, a home-made engine),
//   starting from the example adapters shipped with the skill. The base turns
//   a Port2D into a full StudioAdapter (picking, handles, drag maths, view).
// - StudioAdapter (full): what the bridge actually drives. The built-in
//   three.js adapter implements it directly, so three.js games need no
//   adapter code at all. Other 3D engines may implement it too.
//
// Adapters are registered with window.studio.registerAdapter(probe) or
// window.studio.register2D(port), from a file the AI writes at
// `.studio/adapter.js` in the game folder. The host loads that file right
// after the edit script and before any game code (CONTRACT.md §1.4).
//
// After an adapter is found the base runs a self-check (see SelfCheck) and
// tells the shell and the AI what to fix when the adapter does not work.

/**
 * Screen coordinates passed to adapters are CSS pixels in the iframe viewport
 * (PointerEvent.clientX/Y). The bridge never converts to NDC because only the
 * adapter knows which canvas the game renders into and how it is letterboxed.
 */
                                
                    
           
                                                                                                
                   

                      
                                                                               
                 
     
                                                                            
                                                                      
     
                  
                                                                
              
     
                                                                                                                
                                                                                                               
                                                                                                                   
                                                                
                                                                                                                         
                                                                                                                      
                                                                                         
     
                                             
     
                                                                       
                                                            
     
                 
     
                                                                        
                                                                             
                                                                             
     
                                                             
                                                                        
                                     
                                                                              
                                                   
     
                                                                           
                                                     
     
                                                
     
                                                                     
                                                                       
                                                                          
                                                                             
           
     
                                       
     
                                                                         
                                                                              
                                                                             
                                                                         
                                                                      
     
                                                      
                                                                              
                                           
     
                                                                       
                                                                          
                                                                  
     
                                      
     
                                                                                                                
                                                                                                                  
                      
     
                                        
     
                                                                            
                                                                           
                                                                             
                                                                             
                                                                               
                                         
     
                                        
                                                            
                                         
     
                                                                                                                     
                                                                                                                 
                                                                                                                
                                                                                               
     
                                                                                       
                                                                                                                      
                                            
     
                                                                                                                   
                                                                                                                    
                                                                                                             
     
                                                                      
                                                                                       
                                                
     
                                                                           
                                                                        
     
                                                                                           

                                                                                   
                    

                    
                                              
                                    

                                      
     
                                                                       
                                                                            
                                                                        
     
                                                                     
                                                                                      
                                                  

                                             
     
                                                                           
                                                                            
                                                                              
                                                                           
                                                                            
                                                                          
                                                      
     
                                                                                                              

                                                                            
     
                                                                         
                                                                          
                                                                     
     
                                               
     
                                                                         
                                                                             
                             
     
                                
                                                                        
                                 

                                                           
     
                                                                                                                    
                                                                                                                     
                                                                                                                 
                                                                                                                   
                       
     
                                                                               
                                                                                                                      
                                                    
                                                                                                 
 

                              
                                                
                                       
                                     
                                    
     
                                                                                                                   
                                                                                                                     
                                                                                                                     
                                                                       
     
                          
     
                                                                                                                  
                                                                                                                     
                                                                                                                
                                                                                                                   
                                                                                                                                               
                                                             
     
                                                     
                                                                                                                                
                                      
                                                                             
                                                     
                                         
                   
                                    
                           
                                                                                          
                   
                                                                     
                                 
     
                                                                               
                                                                              
                                                                               
                                                                          
                                       
     
                                          
     
                                                                         
                                                                            
                                                                            
                                                                  
     
                                                   
 

/**
 * How an adapter announces itself. install() runs as soon as the probe is
 * registered — the built-in probes and `.studio/adapter.js` both load before
 * any game code — so it can place engine hooks such as
 * `window.__THREE_DEVTOOLS__` or `globalThis.__PIXI_APP_INIT__`. After the
 * first frame (or studio.ready()) the bridge asks each probe for an adapter.
 * Probes registered by the game folder are asked before the built-in ones, so
 * an AI-written adapter can override the built-in three.js adapter.
 */
                               
                    
                                  
                                
 

// ---------------------------------------------------------------------------
// src/core: shared services inside the game iframe
// ---------------------------------------------------------------------------

                              
                                                             
                           
                 
                                                                                     
               
                                                                      
                                       
                              
                                                                                          
                              
 

                          
                         
                                                                   
                                             
 

                              
                    
                 
 

/**
 * The small global API (window.studio, plus window.__gameStudio which always
 * exists even if the game already uses the name `studio`). Only present while
 * the edit script is loaded, so game code must call it as `window.studio?.x()`.
 */
                               
                  
                                                                                  
                
                                                                                                   
                                               
                                                                                  
                                             
                                                                            
                                                         
     
                                                                                                                     
                                                                                                                     
                                                                                                               
                                                                                    
     
                                                         
                                                                              
                    
     
                                                                              
                                                             
                                                          
     
                                   
     
                                                                                                                  
                                                                                                                    
                                                                                                                     
                                                                                                                    
     
                                                             
 

/** One level as the game names it (studio.levels). `id` matches KEY_RE; `label` is what the person reads. */
                            
             
                 
 

/** What studio.levels() returns in the editor: the level shown (`id`) and the code's level to build for it. */
                            
             
                
 

// ---------------------------------------------------------------------------
// Fitting the editor to one game (CONTRACT.md §7)
// ---------------------------------------------------------------------------

/** A grid step: one number for every axis, or one per axis ([x, y] / [x, y, z]; 0 = free). */
                                         

/** One rule of `.studio/studio.json`. Matching rules are merged in order (later wins). */
                           
                                                                          
                
                                                     
                   
                                                            
                   
                                               
                       
                   
                                                                     
                                             
 

/**
 * `.studio/studio.json`: plain settings the AI writes for one game. Units are
 * the game's own (metres in 3D, scene px in 2D); angles in degrees.
 */
                             
             
                                                                             
                                             
                                                                               
                                            
                     
 

/** What `.studio/tools.js` passes to studio.extend(). */
                                
     
                                                                            
                                                                       
     
                                                        
                     
 

                                  
                               
            
            
                      
                 
 

/** Everything a game tool may use. Poses changed through it are undoable. */
                                  
           
             
                  
                            
                                   
                                                                                                                   
                                                                           
                                           
                                                                    
                                                 
                                                              
                                    
                                                                 
                  
 

/**
 * A game-specific tool (draw the course, place along a path, paint tiles…).
 * Its data is saved to `.studio/data/<id>.json` with the other results.
 */
                           
                                                               
             
                                                
                                               
                
                                               
                                                
                                        
                                          
                                                                                           
                                                              
                                                                                                
                                    
                                           
                   
                                                                    
                                
                                                                           
                   
                                                                
                 
 

/** Tools as the shell sees them. */
                               
             
                
                
                
 

/** Tool id pattern (also the file name under .studio/data/). */
const TOOL_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

// ---------------------------------------------------------------------------
// UI preferences (.studio/ui.json): how the person likes the editor to look
// ---------------------------------------------------------------------------

                          
             
                                                                                      
                                     
                                
                
                                                
                 
                                   
                              
                   
                               
                     
                                                
         
                    
                     
                  
                     
                  
                   
                  
                  
                   
    
                                                         
              
     
                                                                                                                      
                                                                                                            
     
                  
 

/**
 * The small 2D port. Everything is in the game's own terms; the base does the
 * screen maths. Write it so each method is a few lines of engine calls.
 *
 * Coordinates:
 * - Pose: parent space of the object (what the game code would assign).
 * - Screen: CSS px in the game page's viewport (like PointerEvent.clientX).
 */
                         
                                                                              
               
                   
                                                                         
                    
                
                   
                     
                   
                       
                       
                        
                       
                       
                                                                                                          
                    
     
                                                                                      
                                
                                                                               
                                     
     
                                                               
                                                                             
                                                                            
                                                                             
                         
     
                                               
                                                                               
                                                                             
                                                                        
                 
     
                                                                         
                                                                           
                                                                            
                                                                             
     
                                                            
                                                                                          
                 
                  
                                                                                               
                                                              
                                                                        
                                                   
                                                                                
                                      
     
                                                                             
                                                                            
                                                                     
     
                                                                                                              
     
                                                                           
                                                                            
                                                                        
                                                                              
                                                             
     
                                                                
     
                                                                           
                                                                           
                                                                  
     
                                              
     
                                                                            
                                                                          
                                                        
                                                                          
                                                                           
                                                                    
     
                                               
                                
                                 
     
                                                                           
                                                                             
                                                                               
                                                  
     
                                    
 

/**
 * The self-check the base runs after an adapter is found, so a broken
 * AI-written adapter is caught at once and the AI is told what to fix.
 * The shell shows failures; the host writes them for the AI
 * (local: one stdout line + .studio/check.md).
 */
                         
                                                                                    
                   
                                             
                 
                                                
                
                                                                            
                    
                                                                               
                    
                                                                         
                    
                                                                                   
               

                                  
              
                           
                                                           
                  
     
                                                                                                 
                                                                                                    
                                                                                                            
     
                     
                        
                                                                                      
 

// ---------------------------------------------------------------------------
// Promise 2: messages between the bridge (game iframe) and the shell (parent)
// ---------------------------------------------------------------------------

/**
 * Every message is a plain object `{ type: 'studio:<tool>/<verb>', ... }`.
 * `core/*` messages belong to the base (edit mode, view, keys); tool messages
 * use the tool id. Receivers MUST check event.source and event.origin and drop
 * anything else; senders MUST pass an explicit target origin (never '*').
 */
const MSG_PREFIX = 'studio:';

/** A fly key (WASD + E / Q up / down), by its place on the keyboard (KeyboardEvent.code minus "Key"), lower case. */
                                                       

                        
                          
                                                                                  
                      
                                    
                                      
                                               
                                             
                                                                                                                          
                                  
                                          

/**
 * Viewport px the shell's floating panels cover on each side. `rightTo`: the
 * right inset only reaches down to this y (the card is in the top right
 * corner; below it the game is free to the edge). `camera: false`: hide the
 * camera up / down buttons for now (a phone with the card, a sheet or a menu
 * up — the second design review's ⑧, 2026-10-19); absent = shown.
 */
                                                                                                                       

/** shell -> bridge */
                           
                                                                  
                                                  
                                            
                                     
     
                                                                              
                                                                        
                                                                       
     
                                                                                             
                                                                                                              
                                                   
     
                                                                            
                                                                           
                                                                          
                                                                                                                    
                                                                                                                    
                                                                                                      
     
                                                                                                            
                                                                   
                                                       
                                                        
                                                                                                                      
                                                                                 
     
                                                                                                                        
                                                                                                                     
     
                                                       
     
                                                                                                                      
                                                                                                                     
                                                                                                                    
                                                          
     
                                                                               
     
                                                                                                                   
                                                                                                                    
                                                                                                                     
                         
     
                                                                                                                                                     
     
                                                                                                                         
                                                                                          
     
                                                                                                  
     
                                                                               
                                                                               
                                                                              
                                      
     
                                                                                                                                                                            
                                                                     
                                     
                                                                      
                                                                                     
                                                             
     
                                                                      
                                                                             
                                                                           
                                             
     
                                                                                         
     
                                                                            
                                                                                
     
                                                                      
     
                                                                                                                         
                                                                                                             
     
                                                      
     
                                                                                                                        
                                                                                                                   
     
                                                                     
                                                                                       
                                                              
                                                                                                   
                                                             
     
                                                                                                                    
                                                                                                                        
                                                                                                                    
                                                                                                                    
                                                                                                          
     
                                                                                                                    
                                                                                             
                                                  
     
                                                                                                                      
                                                                                                                 
                                                                               
     
                                                              
     
                                                                                                             
                                                                                                                   
     
                                                  
                                                       
                                                              
                                                                                
                                   
                                                
     
                                                                                                                  
                                                                                                                      
     
                                                   
     
                                                                                                                          
                                                                                                                       
                                                                                                                     
                                                                                                                                             
                                                                        
                                                                                                            
     
                                                   
                                                                  
                                                                                                                             
                                                                          
                                                                                        
                                                
     
                                                                                                                    
                                                                                                                                      
                                                                                                                     
                                                                                  
     
                                                
     
                                                                                                                                    
                                                                                                                        
                                                                                     
                                                                                                                  
                                                                                                                      
                                                                                                                   
                                                                                                                  
                                                                                                                    
                                                                                         
                                                                                                                      
                                                                                                                     
                                                                                                     
                                                                                                                    
                                                       
     
                                                                                                                         
     
                                                                                                                     
                                                                                                                   
                                                                                                                 
                                                                                                                    
                                                     
     
                                                                                        
         
                                                                                                                     
                                                                                                                     
         
                                                     
                                                                                                      
                                
                                                                                                                    
                                                         
     
                                                                                                                       
                                                              
     
                                 
     
                                                                                                                  
                                                                                   
     
                                                           

/**
 * The one line over the game while playing (§3.5). `state`: looking = sent, the AI has it; fixing = it works on it;
 * asking = it has a question (`choices` as buttons); fixed / failed = its reply (`text`), `reload` = the game's
 * files changed since this game was opened, so Reload shows the fix; kept = nothing can reach the AI right now.
 */
                           
                                                                       
               
                                                     
                 
     
                                                                                                                      
                                                                                                         
     
                
                     
                   
 

/** One line of the game's console the bridge kept for a play request (§3.5). */
                          
                                  
               
                                                                    
              
 

/** bridge -> shell */
                           
                                                                            
                                                   
                                                                                
                                                                                   
                                                                                                                     
                                                                                                              
                                                                                                                                
                                                                                                                  
                     
         
                                                                                                                         
                                                                                                                       
                                                                                                            
         
                           
         
                                                                                                                  
                                                                                                                   
                                                                                       
         
                                               
                                                      
                                                          
                                                                                      
                                                                                                                      
                                                  
                                                                                                               
                                                                       
     
                                                                                                                  
                                                                                                                       
                                                                                                                  
     
                                                                        
                                                                                      
                                                                        
                                                                                                                                           
                                                                                                   
                                                                                                                   
                                               
                                                                                                        
                                                   
                                                                                           
     
                                                                          
                                                                             
                                                                       
                                                       
     
                                                                                                                         
                                                                                                                                                                        
     
                                                                              
                                                                             
                                                                         
     
                                                                                                                                                                                 
     
                                                                                                                      
                                                                                                                    
                                   
     
                                                                                        
                                                                                                                                                                                                  
                                                                                                   
     
                                                                                                                       
                                                                                                                    
     
                                                                                                                             
                                                                                                                      
                                                              
                                                                                          
                                                              
                                                                                                            
                                                                                                                                  
                                                                                                                          
                                                                                      
                                                                                     
                                                             
                                                                                                                       
                                                    
     
                                                                                                                   
                                                                                                                    
                                                                                                                
                                                                                                                    
     
                                                                                                  
     
                                                                                                                       
                                                                                                                      
                                                                                                                      
                                                 
     
                                                                                                                                         
                                                                                 
                                                                      
                                                                                           
                                                                  
                                                   
                                                       
                                                                             
                                                                             
                                                                                                                            
                                 
     
                                                                                                                      
                                                                                                                  
                                                                                                                   
                                                                                                                  
                                                                                                              
     
                                                                                                                                       
                                                                                         
                                                                                                                     
                                                             
                                                                                     
                                               
                                                                               
                                                
                                                                                         
                                   

/** One turn of the chat over a paused game, as a request carries the talk so far (pause, 2026-10-22). */
                           
                    
               
 

/** Something near the player when they asked while playing (§3.5). */
                           
              
                 
              
                                                           
             
                                                                                       
                            
 

                                                          

function isStudioMessage(x         )                     {
  return !!x && typeof x === 'object' && typeof (x                      ).type === 'string'
    && (x                    ).type.startsWith(MSG_PREFIX);
}

// ---------------------------------------------------------------------------
// Promise 3: the host (where the game lives: local folder now, cloud later)
// ---------------------------------------------------------------------------

                                                                                 

                            
                                                                           
               
               
                  
                                                                         
                       
 

/** Names of a referenced file that does not exist ("missing" badge). */
                             
               
                       
 

/**
 * Hand-offs to the user's AI. The first four are the KUMODeck menu;
 * 'delete-files' is the Library's "Delete" on unused files (the editor never
 * deletes: the AI checks with the creator first, then deletes).
 */
                                                                                                
/** "Things to ask your AI" that stay inside this game: fit the editor to it, change its look, add a tool. */
                                               

// ---------------------------------------------------------------------------
// Hand-offs to the AI (CONTRACT.md §3.4). One-way from the editor: the person
// talks to the AI in the AI's own window, never in the editor. Every request
// is kept as a record first (local: .studio/requests/<id>.json); the agent
// reads them all when the person says "look", and writes one status back
// (local: .studio/status.json). Normalised by src/schema/handoff.mjs.
// ---------------------------------------------------------------------------

                                                                                           

                                
              
                 
                                                                                  
              
                     
     
                                                                                                                    
                                                                                                           
     
                   
 

/** What the shell hands to host.request(). */
                                     
     
                                                                                                            
                                                                                                                 
                                                                                                                   
                                                                              
     
                                                         
                                                                               
              
                                                                                            
                    
                                                                       
               
                                                                                                                    
                            
                               
             
            
                                                                                         
                   
     
                                                                                               
                                                                                                        
     
                   
     
                                                                                                                                                                                
                                                                                                         
                                                                                                                 
                                                                                                                 
                                                                   
     
                                                                             
     
                                                                                                                   
                                                                                                                   
                                                                                    
     
                    
     
                                                                                                                        
                                                                                                                    
                                                                                                                    
     
                            
     
                                                                                                                    
                                                                                                 
     
               
     
                                                                                                                    
                                                                                          
     
                
                                                                                                                  
                   
                                                              
                    
                                                                                           
                       
                          
     
                                                                                                                     
                                                                                                                      
                                                                                                                       
                                                                                                                
     
                   
                
                       
 

/** A Library motion named in an ask (StudioRequestInput.motions). */
                                
               
              
                        
                                                       
                                                                     
 

/** A stored request (.studio/requests/<id>.json). `saved` records are written by the host on every save. */
                                                                                  
             
                                                                                         
             
                          
                                         
             
              
                                                                                 
                   
 

/**
 * `asking` (dogfood 2026-10-17, U2): the agent asked the person something in its own window and waits for the
 * answer; `note` is the question. Without it the editor kept saying "Your AI has it" for minutes while the AI waited.
 */
                                                                            

/** What the agent writes back (local: .studio/status.json). Only the latest status is kept. */
                               
             
                 
                                                     
                   
                     
                                                                      
                   
                                                          
                
     
                                                                                                                 
                                                                                                                    
     
                     
                                                                                                      
                   
                                                                                                                            
                  
                 
              
 

/**
 * What the host knows about the AI's watch when it keeps a request (AI feel,
 * 2026-10-16). `watching`: an AI's watch is running right now (local:
 * `studio.mjs --watch` keeps .studio/watch.json fresh), so the editor can say
 * at once whether anyone will see the request. `undo`: the host kept the game
 * files as they were, so "Undo AI change" can go back to this request.
 * Left out = unknown (then the editor falls back to waiting for a status).
 */
/** The AI behind the editor, when the host can tell (src/server/which-ai.mjs). */
                                         

                              
                     
                
                 
 

                             
                                                                       
                                                                       
                                                           
                                             
     
                                                                          
                                                                         
                                                                          
                                                                           
                                                                             
                                                                            
                   
     
                                                                                                                                                        
                                                                       
                                                                           
                                 
                                                                               
                                                  
     
                                                                             
                                                               
                                                                
     
                                                                                                                
     
                                                                   
                                                                             
                                                                           
                                                                        
     
                                                                                                                   
     
                                                                           
                                                                            
                                                                           
                                                                            
                                                       
                                                                                                              
                                                                                           
     
                                                                                                                                             
     
                                                                             
                                                                         
                                                                          
                                                                             
                                                                          
                                                                    
     
                                                                                                                                                      
     
                                                                              
                                                                       
     
                                                      
                                                                      
                             
                                                                   
                                                                                                        
                                           
                                               
                                         
                                                                                
                                                                                          
                                          
     
                                                                                                           
                                                                                                                         
                                                                                                              
                                                      
     
                                       
     
                                                                    
                                                                            
                                                                           
                                                                             
              
     
                             
     
                                                                              
                                                                                
                                                                       
                                                                            
                                                              
     
                           
 

/** The person's KUMODeck sign-in as the editor sees it (never a key). */
                             
                    
                                                          
                       
                                               
                    
                 
                  
                                  
                        
                    
                                                                
                           
                                                                             
                                                
                                                             
                       
                                                                            
                                                 
                                       
                   
     
                                                                                                                   
                                                                                          
     
                    
                                            
 

/** The kinds "Make with AI" makes (generate-ui, 2026-10-22: sound effects, music and voice lines joined images and 3D). */
                                                                       

/** One line of the history (.studio/generated.json). */
                           
             
                            
             
                 
                                                                      
                 
                                                                                                                                          
                                                     
                 
               
                               
 

                          
             
                 
                 
                                                  
                      
                               
                                            
 

/**
 * A KUMODeck refusal, in a code the editor words itself: signed_out,
 * needs_terms (agree once, then send again with acceptTerms), not_enough
 * (balance), not_open / not_allowed (not available to this account yet),
 * no_project, too_many, unreachable, failed …
 */
                              
            
               
                  
                        
                     
 

                                     
                 
                 
                  
                                
                                                       
                          
                
                                                                   
                        
 

                                   
                 
                    
                        
 

/** One sound (generate-ui, 2026-10-22): KUMODeck's audio route, made within the request like a picture. */
                                   
                                  
                                                                                                 
                 
                                     
                       
                                                 
                 
                                                              
                 
                        
 

                           
                                
                                                             
                                                                                                                                                   
                                                                       
                                                                                  
                                                                   
                                                                                               
                                                                                                                                                
 

// ---------------------------------------------------------------------------
// The editor's look, rewritten by the AI (CONTRACT.md §8)
// ---------------------------------------------------------------------------

/** Named regions of the shell (also `data-part` attributes in the page). */
                       
                                                                                    
                                                
                                                                                  
                                                                              
                               
                                                        

/** Things that can be hidden with studioShell.hide() (and UiPrefs.show). */
                                                 

/**
 * `window.studioShell` in the shell page, for `.studio/ui/shell.js`.
 * It can change how the editor looks and add buttons that call editor
 * actions. It cannot reach the game page, the save format or the files: the
 * protected part (bridge messages, handles, validation) stays as it is.
 */
                                 
                  
                                                           
                                     
                                                                            
                                                                                                                                                          
                                 
                                 
                   
                                                                  
                                          
                                                                               
                                                             
                         
               
                  
                                                                                                                 
                              
                            
            
                 
                 
                          
                                     
                                 
                     
                         
                          
                                          
                                                          
                 
                   
                                                                               
                                                       
    
                                                                                    
                                                                                                 
 

// ---------------------------------------------------------------------------
// Promise 4: result files (validated by src/schema, the single validator)
// ---------------------------------------------------------------------------

const RESULT_FILES                         = {
  placement: 'placement.json',
  library: 'library.json',
};

                                              
                                                                                         
             
                 
                     
 

                                
             
                    
           
                 
                                          
     
                                                                           
                                                                            
                                                                
     
                           
                                                                                                
                               
     
                                                                             
                                                                            
                                                                         
                       
     
                           
     
                                                                                                                     
                                                                                                                   
                                                                                          
     
                                        
                                                                                                             
                            
     
                                                                                                                  
                                                                             
     
                                              
     
                                                                                                                    
                                                                                                                 
                                                                                                                
     
                                  
     
                                                                                                                   
                                                                                                                    
                                                                              
     
                            
     
                                                                                                                     
                                                                                                                        
                                                                                                                                   
                                           
     
                            
     
                                                                                                                        
                                                                                                                    
                                                                                                                     
     
                                 
                                                                                                                                
                       
 

/** One level's part of placement.json (CONTRACT.md §4.1). */
                                 
             
                 
                                                                                
                    
                                                                                                                        
                
                                           
                           
                               
                           
                                                                                                          
                                  
                                                                                      
                                 
 

/**
 * How an object moves by itself (CONTRACT.md §4.1 `motion`). Since the timeline (studio-timeline, 2026-10-22): its
 * `clips`, named motions made of keys. The older shape (motion-gui, v0.1.13: `path` / `speed` / `repeat` / `spin`) is
 * still read — the editor turns it into one clip when it opens the file, the loader plays it as it was — and never
 * written by the editor again. The loader runs both (src/loader/studio-placement.js clipAt / motionAt), the editor
 * previews them with the same maths.
 */
                         
                                                           
                       
                                                                                                                        
                    
                                                                   
                 
                                                                  
                        
                                                                
                
 

/**
 * One named motion of an object (studio-timeline, 2026-10-22): the keys of its position / angle / size over time,
 * as offsets from the object's place (so moving the object carries its motion along).
 */
                             
                                                                                       
               
                                                                                                 
              
                                                                                 
                        
     
                                                                                                                
                                                                                             
     
                  
     
                                                                                                                   
                                                                                                                        
                                                                                                                 
     
                                            
                                                                                                      
                      
     
                                                                                                                       
                                                                                                                       
                                                                  
     
               
     
                                                                                                                       
                                                                 
     
                  
                   
 

/**
 * When an object's motion starts (studio-motion-triggers, 2026-10-22). The loader runs `start`, `time`, `key`, `click`,
 * `after` and `enter` (when it can find `who`) by itself; `touch`, `cue` and `say` need the game's code (the AI adds
 * touch(key) / cue(name) / playMotion(key, name) where it happens).
 */
                        
                   
                                 
                              
                   
                                              
                                                   
                   
                              
                                
                                             
/** A box in the world: its middle `p` and its size (3D [x, y, z] / [w, h, d] m; 2D [x, y] / [w, h] px). */
                             
              
                 
 
/** When a motion stops: after `times` rounds, or when a named cue comes; `then` = stay where it is (default) or go back to its first pose. */
                              
                 
               
                          
 

/** A motion in the Library (studio-motion-triggers): placement.json's top `motions`. A clip without "when". */
                                
               
              
                        
                                                                                                     
                   
     
                                                                                                                     
                                                                                                                       
                                                                                                                     
     
                                      
 

/**
 * Keys per property, in time order (1–256 each); a property with no keys is left as the game puts it.
 *   p — added to the position ([x, y, z] m in 3D, [x, y] px in 2D)
 *   r — added to the angles in radians ([x, y, z] in 3D: y is the card's Angle, x / z its tilt; [angle] in 2D)
 *   s — multiplying the size ([x, y, z] in 3D, [x, y] in 2D)
 */
                             
                  
                  
                  
 
                                             

                            
                                       
            
              
                                                                                                                                        
                    
     
                                                                                                                       
                                                                                                                
                                                                             
     
                
                 
 
                                                    
                                                        

                                   
                                                                                                                           
                      
                                 
             
                                                                                     
                 
                                                                                                              
                  
                                                                                                            
                   
                                                                                                  
                      
 

/** placement.json `theme` (UI stage 3): one CSS variable of the game's theme, changed in the editor. */
                                      
                       
            
                                                                 
               
 

                                              
                                                                           
              
                                                                                        
               
                 
 

                                   
              
                 
                                                                           
             
                     
 

                                 
             
                 
                 
 

                              
             
                  
                                                                  
                                                                                               
                   
 

                                                                                         

/**
 * Signatures implemented by src/schema (one validator shared by the server,
 * the shell and later the cloud). `value` is the normalised file: numbers
 * rounded, keys sorted, unknown fields dropped.
 */
                               
                                                                  
                                                              
                                                                         
                                                             
 

// ---------------------------------------------------------------------------
// Shell tools (how a tool such as the library plugs into the shell)
// ---------------------------------------------------------------------------

/**
 * A tool owns one panel of the shell (right column on PC, the sheet above the
 * bottom bar on phones) and one result file. The shell owns everything shared:
 * the game frame, selection, undo/redo for placement, save, language, the
 * "next step" menu.
 */
                            
             
                              
                                                                   
                                                  
                  
                                                             
                  
                                                                        
                          
                                                            
                
                                                               
                                      
 

/**
 * The objects as the Library shows them (ShellContext.objects, "one Library" 2026-10-18). The shell owns the
 * objects and the selection; the Library owns its page (search, the All / Objects / Files filter, the grid, the
 * detail on the right) and asks this for the objects' part of each. Names are untrusted text: the elements are
 * built with textContent only.
 */
                                 
                                                                                                  
                  
     
                                                                                                                       
                                                                                                                     
                                                         
     
             
                                                                                              
                                      
                                                                                    
                             
                                                                                                             
                                                        
                                                                                                              
                                                    
                                                                                                            
                            
                                                                     
                
                                                    
                             
     
                                                                                                                   
                                                                                                                  
     
                                           
                                                                              
                   
 

/**
 * The Library's motions (studio-motion-triggers, 2026-10-22; shell/library-motions.ts): the "Motion" filter's tiles and
 * the picked motion's detail. The Library (tools/library/panel.ts) puts them in its one grid, like the objects.
 */
                                 
                  
                                                                  
                                                        
                                                                                               
                                                    
                                                              
                
                                                                                                                     
                                           
                                                                                        
                                 
 

                               
                   
             
                                                                               
                         
                                                                     
                                 
                                                                                
                                                                                                                   
                                                
                  
                                                                 
                                  
     
                                                                          
                                                                         
                              
     
                                       
     
                                                                                                                   
                                                                                                                  
                                                                                                                    
                                                                                                              
     
                                                         
     
                                                                                                                    
                                                                                                                            
                                                                         
     
                           
                                                                                                                          
                           
                               
                                                                          
                  
                                  
                   
     
                                                                              
                                                                                        
                                                    
     
                                                             
     
                                                                                                                
                                                                                                
     
                         
 

/** What the Library does with its files through the shell (ShellContext.files). Paths are folder paths. */
                                 
     
                                                                                                                   
                                                                     
     
                                
     
                                                                                                                      
                                                                                                                     
                                                       
     
                              
                                                                                                              
                              
 

// ---------------------------------------------------------------------------
// Limits and constants
// ---------------------------------------------------------------------------

const LIMITS = {
  maxObjects: 500,
  maxAbs3d: 10_000,
  maxAbs2d: 100_000,
  /** Rounding steps: 1 mm in 3D, 0.1 px in 2D, 1e-4 rad for angles. */
  step3d: 0.001,
  step2d: 0.1,
  stepAngle: 0.0001,
  maxScale: 1000,
  minScale: 0.001,
  maxResultBytes: 64 * 1024,
  maxReplace: 500,
  maxAdded: 200,
  maxUnused: 2000,
  maxAssetBytes: 100 * 1024 * 1024,
  undoSteps: 200,
  /** placement.json `ui` (UI stage 1): elements, |p| in CSS px, and the scale range (src/schema keeps the same values). */
  maxUi: 200,
  maxUiCoord: 10_000,
  minUiScale: 0.1,
  maxUiScale: 10,
  /** UI stage 3: a text on the card, a colour / theme value, the font size range (px), theme variables. */
  maxUiText: 200,
  maxUiColor: 64,
  maxUiValue: 200,
  minUiFont: 1,
  maxUiFont: 500,
  maxTheme: 100,
}         ;

/** Allowed characters of an object key. Names with other characters are mapped; the original stays in `label`. */
const KEY_RE = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;
/** Keys starting with this prefix are tree paths and unstable. */
const PATH_KEY_PREFIX = 'path:';
/** Marker names games can set to control discovery. */
const MARK = {
  /** three: object.userData.studioKey / Pixi: obj.studioKey — the most stable key. */
  key: 'studioKey',
  /** three: object.userData.studioAsset / Pixi: obj.studioAsset — "this object uses that file". */
  asset: 'studioAsset',
  /** `studio: false` (three: userData.studio, Pixi: obj.studio) hides an object and its children. */
  hide: 'studio',
}         ;

/** File extensions the library lists (and the only ones addAsset accepts). */
const ASSET_EXT                                                         = {
  image: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'],
  model: ['glb', 'gltf', 'fbx', 'obj'],
  sound: ['mp3', 'ogg', 'wav', 'm4a'],
  atlas: ['atlas', 'json'],
  font: ['woff2', 'woff', 'ttf', 'otf'],
};
/** Folders never listed or served as assets. */
/** Folder (inside the game folder) for studio files that are not results: adapter.js, check.md, next-step.md. */
const STUDIO_DIR = '.studio';
const IGNORED_DIRS = ['node_modules', '.git', 'dist', 'build', '.studio', '.next', '.vite', '.cache']         ;

/** UI sizes shared by the bridge (handles) and shell. */
const UI = {
  /**
   * Handle diameter in CSS px with a mouse (the person can change it on the
   * View page). 48 until the visual pass (2026-10-16): a fingertip size on
   * PC made the handles bigger than the objects (Ive-view review §1). A pro
   * tool's on-canvas controls are 8–28 px; 32 keeps them easy to hit.
   * 28 since the rebrand (2026-10-16): the handles are one tool strip of
   * 28 px buttons under the object, the row height of every other control.
   */
  handlePx: 28,
  /** The smallest strip button on phones: 44 px, the finger target (Apple's minimum). */
  handlePxPhone: 44,
  /** Radius for pickNear on touch vs mouse. A finger covers more than a cursor tip. */
  pickRadiusTouch: 28,
  pickRadiusMouse: 12,
  /** Movement (px) before a press turns into a drag/look-around instead of a tap. */
  tapSlopPx: 8,
  /** Long-press on rotate/scale/lift handles repeats; the whole run is one undo step. */
  holdDelayMs: 350,
  holdRepeatMs: 60,
  /**
   * A press held this long without moving opens choices: the strip's turn / size options (on their button) and the
   * menu of the place pressed (anywhere else on the game, the list's rows, the Library's tiles; context menu,
   * 2026-10-18). One length for both, so a long press feels the same everywhere; they never meet, because the strip's
   * long press is only on its buttons. 450 ms: past a tap (~100–200 ms) and a hesitant press-then-drag, short of
   * iOS's 500 ms callout.
   */
  longPressMs: 450,
  /** Narrower than this = phone layout (bottom bar instead of right column). */
  phoneMaxWidth: 720,
}         ;

/** Localised UI languages. More later; English is the fallback. */
                               

/** Paths served by the local host (src/server) — see CONTRACT.md §3.2. */
const LOCAL_PATHS = {
  /** Shell page. The one-time token arrives as ?t=… on this URL. */
  shell: '/__studio/',
  /** Edit script injected as the first child of <head> in HTML responses (CONTRACT.md §3.2: the pass becomes a cookie). */
  editScript: '/__studio/studio-edit.js',
  api: '/__studio/api/',
  /** AI-written adapter, served from <game>/.studio/adapter.js, injected right after the edit script. */
  gameAdapter: '/__studio/game-adapter.js',
  /** AI-written game tools and rules in code, from <game>/.studio/tools.js, injected after the adapter. */
  gameTools: '/__studio/game-tools.js',
  /** Query flag on the game URL that turns on edit mode. */
  editFlag: 'studio=edit',
  /**
   * Query parameter on the game URL with the shell's origin. The bridge only
   * posts to, and only accepts messages from, window.parent at this origin.
   * Missing = the game's own origin (local host serves both from one origin).
   */
  parentParam: 'studioParent',
  /**
   * Levels (2026-10-22): query parameters on the game URL (edit and ▶ Play) with the level the editor shows and the
   * code's level to build for it; studio.levels() returns them. Absent = the game's first level.
   */
  levelParam: 'studioLevel',
  buildParam: 'studioBuild',
}         ;

__def(__exports, "CONTRACT_VERSION", () => CONTRACT_VERSION);
__def(__exports, "TOOL_ID_RE", () => TOOL_ID_RE);
__def(__exports, "MSG_PREFIX", () => MSG_PREFIX);
__def(__exports, "isStudioMessage", () => isStudioMessage);
__def(__exports, "RESULT_FILES", () => RESULT_FILES);
__def(__exports, "LIMITS", () => LIMITS);
__def(__exports, "KEY_RE", () => KEY_RE);
__def(__exports, "PATH_KEY_PREFIX", () => PATH_KEY_PREFIX);
__def(__exports, "MARK", () => MARK);
__def(__exports, "ASSET_EXT", () => ASSET_EXT);
__def(__exports, "STUDIO_DIR", () => STUDIO_DIR);
__def(__exports, "IGNORED_DIRS", () => IGNORED_DIRS);
__def(__exports, "UI", () => UI);
__def(__exports, "LOCAL_PATHS", () => LOCAL_PATHS);
};
__defs[14] = function (__exports) {
'use strict';
// ../core/loads.ts

// Load log: which files the game actually loaded while it ran.
//
// The library uses this to mark assets as "loaded while playing" versus
// "only mentioned in code" or "unused", and adapters use the order of loads
// to guess which model file an object came from.
//
// WHY PerformanceObserver first: the Resource Timing buffer sees every network
// load the page makes — <img>, CSS url(), fetch, XHR, <audio>, scripts, font
// files — no matter which API the game or its engine used, and `buffered: true`
// also returns loads that started before this script. Wrapping fetch/XHR on top
// only adds the success flag (Resource Timing has no reliable status before
// Chrome 109 and none at all for opaque responses).
// data: and blob: URLs never appear; they are not files in the game folder.
                                                         

const MAX_ENTRIES = 5000;

function howFromInitiator(t        )                   {
  switch (t) {
    case 'img':
    case 'image':
    case 'input':
      return 'image';
    case 'css':
    case 'link':
      return 'css';
    case 'fetch':
      return 'fetch';
    case 'xmlhttprequest':
      return 'xhr';
    case 'script':
      return 'script';
    case 'audio':
    case 'video':
      return 'audio';
    default:
      return 'other';
  }
}

function installLoads(win                             = window)          {
  const list              = [];
  const byUrl = new Map                   ();
  const subs = new Set                        ();

  function add(url        , how                  , ok          )       {
    let abs        ;
    try {
      abs = new URL(url, win.location.href).href;
    } catch {
      return;
    }
    if (abs.startsWith('data:') || abs.startsWith('blob:')) return;
    // The studio's own files are not game assets. The local server serves them
    // at /__studio/; the web demo (src/hosts/browser) at <site>/__studio/, and
    // the site may live under a sub-path, so any /__studio/ segment counts.
    if (new URL(abs).pathname.includes('/__studio/')) return;
    const known = byUrl.get(abs);
    if (known) {
      if (ok !== undefined) known.ok = ok;
      // Prefer the more specific kind (e.g. image over other).
      if (known.how === 'other' && how !== 'other') known.how = how;
      return;
    }
    if (list.length >= MAX_ENTRIES) return;
    const e            = { url: abs, how, t: Math.round(win.performance.now()), ok };
    list.push(e);
    byUrl.set(abs, e);
    for (const cb of subs) {
      try {
        cb(e);
      } catch {
        /* a broken listener must not break the game's loading */
      }
    }
  }

  try {
    const po = new win.PerformanceObserver((l) => {
      for (const r of l.getEntries()                               ) {
        const status = (r                                                           ).responseStatus;
        add(r.name, howFromInitiator(r.initiatorType), status ? status < 400 : undefined);
      }
    });
    po.observe({ type: 'resource', buffered: true });
  } catch {
    /* very old browsers: fall back to the wrappers below only */
  }

  const realFetch = win.fetch;
  if (typeof realFetch === 'function') {
    win.fetch = function fetch(input                   , init              ) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      add(url, 'fetch');
      return realFetch.call(win, input, init).then(
        (res) => {
          add(url, 'fetch', res.ok);
          return res;
        },
        (err) => {
          add(url, 'fetch', false);
          throw err;
        },
      );
    }                    ;
  }

  const XHR = win.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    XHR.prototype.open = function (                      method        , url              , ...rest           ) {
      const u = String(url);
      add(u, 'xhr');
      this.addEventListener('loadend', () => add(u, 'xhr', this.status > 0 && this.status < 400));
      return (open                             ).call(this, method, url, ...rest);
    }                             ;
  }

  return {
    entries: () => list.slice(),
    on(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

__def(__exports, "installLoads", () => installLoads);
};
__defs[15] = function (__exports) {
'use strict';
// ../core/time.ts

// Time control for the game page: hold back the game's frame callbacks while
// the editor is open.
//
// WHY requestAnimationFrame: nearly every web game engine (three.js
// setAnimationLoop, Pixi's Ticker, Phaser's loop, hand-written loops) drives
// its frames through window.requestAnimationFrame and looks the function up at
// call time. Wrapping it before any game code runs freezes all of them with
// one mechanism and needs no knowledge of the engine. Engines that tick from
// setTimeout/setInterval are held with the game's clock instead (inside the
// editor's frame: play-clock.ts → play-timers.ts, polish-1022); an audio clock
// is not frozen here (a pause suspends the AudioContext, play-pause.ts).
//
// WHY "after the first frame": edit mode should show the scene as the game
// first draws it. Freezing before any frame shows an empty canvas; freezing
// later lets objects move away from their start positions. A game can call
// studio.ready() to pick the moment itself (e.g. after async loading).
//
// The studio's own drawing uses raf(), which always reaches the real browser
// function, so the editor keeps animating handles while the game is frozen.
                                                  
const { nativeCancelRaf, nativeRaf, nativeSetTimeout } = __require(0);

                                   

                              
                                                                                  
                                 
                                                                                        
                               
                                   
     
                                                                                                               
                                                                                             
     
                                
     
                                                                                                                       
                                                                                                                      
                                                                                                                   
                                                                                                                        
                                                                                                     
     
                                       
 

                                                      
                                                  
                
                                                                            
                              
                                                                                  
                             
                                                  
                                
 

function installTime(opts             )                  {
  const win = opts.win || window;
  // Game callbacks go to whatever rAF the page has now (it may already be an
  // engine helper's wrapper, which then also sees them). The studio's own
  // loop uses the browser's rAF captured first (native.ts) so no wrapper can
  // hold it.
  const realRaf = win.requestAnimationFrame.bind(win);
  const realCancel = win.cancelAnimationFrame.bind(win);
  const isMainWindow = typeof window !== 'undefined' && win === window;
  const ownRaf = isMainWindow ? nativeRaf : realRaf;
  const ownCancel = isMainWindow ? nativeCancelRaf : realCancel;

  let frozen = false;
  let nextId = 1;
  let gameFrames = 0;
  let timedOut = false;
  let readyCalled = false;
  // Game callbacks waiting for a frame: our id -> { cb, real id (when scheduled) }.
  const pending = new Map                                              ();

  let resolveFirst             ;
  const first = new Promise      ((r) => (resolveFirst = r));
  let firstDone = false;
  const markFirst = () => {
    if (firstDone) return;
    firstDone = true;
    if (opts.freezeAfterFirstFrame) freeze();
    resolveFirst();
  };

  function schedule(id        ) {
    const entry = pending.get(id);
    if (!entry) return;
    entry.real = realRaf((t) => {
      const e = pending.get(id);
      if (!e) return;
      if (frozen) {
        // Frozen between scheduling and the frame: keep it for thaw().
        e.real = null;
        return;
      }
      pending.delete(id);
      gameFrames++;
      try {
        e.cb(opts.stamp ? opts.stamp(t) : t);
      } finally {
        // The first game frame has run once its callback returned (it drew).
        // A microtask lets other callbacks of the same frame finish first.
        if (gameFrames === 1 && !readyCalled) queueMicrotask(markFirst);
      }
    });
  }

  function requestAnimationFrame(cb         )         {
    const id = nextId++;
    pending.set(id, { cb, real: null });
    if (!frozen) schedule(id);
    return id;
  }
  function cancelAnimationFrame(id        )       {
    const e = pending.get(id);
    if (!e) return;
    if (e.real != null) realCancel(e.real);
    pending.delete(id);
  }

  // Replace the globals the game will use. Keep the function names so
  // engines that sniff `.name` or `toString()` are not confused.
  win.requestAnimationFrame = requestAnimationFrame                                    ;
  win.cancelAnimationFrame = cancelAnimationFrame;

  function freeze() {
    if (frozen) return;
    frozen = true;
    opts.clock?.stop();
    for (const e of pending.values()) {
      if (e.real != null) {
        realCancel(e.real);
        e.real = null;
      }
    }
  }
  function thaw() {
    if (!frozen) return;
    frozen = false;
    opts.clock?.go();
    for (const id of [...pending.keys()]) schedule(id);
  }

  if (opts.firstFrameTimeoutMs) {
    const ms = opts.firstFrameTimeoutMs;
    // The browser's own timer (native.ts): the window's waits with the game's clock (play-timers.ts), and this is the
    // studio's own wait for a game that may never draw.
    const later = isMainWindow ? nativeSetTimeout : (fn            , t        ) => win.setTimeout(fn, t);
    const start = () => later(() => {
      if (!firstDone) {
        timedOut = true;
        markFirst();
      }
    }, ms);
    if (win.document.readyState === 'complete') start();
    else win.addEventListener('load', start, { once: true });
  }

  return {
    get frozen() {
      return frozen;
    },
    get gameFrames() {
      return gameFrames;
    },
    get timedOut() {
      return timedOut;
    },
    get readyCalled() {
      return readyCalled;
    },
    freeze,
    thaw,
    raf: (cb) => ownRaf(cb),
    cancelRaf: (id) => ownCancel(id),
    firstFrame: () => first,
    ready() {
      readyCalled = true;
      markFirst();
    },
  };
}

__def(__exports, "installTime", () => installTime);
};
__defs[16] = function (__exports) {
'use strict';
// ../core/index.ts

// src/core: shared services inside the game page (time control, load log).
// Installed by the edit script before any game code runs.
                                                  
const { installLoads } = __require(14);
const { installTime } = __require(15);

                                           
                        
 

function installCore(opts             )       {
  return { time: installTime(opts), loads: installLoads(opts.win) };
}

__def(__exports, "installCore", () => installCore);
};
__defs[17] = function (__exports) {
'use strict';
// ../core/play-timers.ts

// The game's timers and wall clock, held with the game's clock (polish-1022, 2026-10-22; play-clock.ts).
//
// WHY: a pause (bridge/play-pause.ts) and Edit hold the game's frames (time.ts) and take the held time out of
// performance.now() (play-clock.ts). A game that steps from a timer — `setInterval(spawnEnemy, 2000)`, a countdown with
// `setTimeout(tick, 1000)`, a `Date.now() - startedAt` clock — still ran on: enemies piled up behind the chat, the
// countdown ran out while the person was moving a tree. Here every timer the game sets waits while the clock is stopped
// and goes on with the time it had left (a 2 s interval stopped 0.5 s after its last tick fires 1.5 s after Resume),
// and Date.now() leaves out the stopped time like performance.now() does.
//
// The studio's own timers in the game page never come here: they use core/native.ts (nativeSetTimeout, nativeDateNow),
// captured before this wraps the window's. Otherwise a paused game would also pause the line's fade, the long press,
// the self-check's waits — and Edit, which holds the game, would hold the editor.
//
// Not held (CONTRACT.md §3.5.1): `new Date()` (an object, its time is wall time: saves, "today"), promises and
// queueMicrotask (they run when what they wait for is done), requestIdleCallback, a Worker's own timers, an audio
// clock (the pause suspends the AudioContext itself).

/** What the hold needs from the browser: its own setTimeout / clearTimeout and clock (injected for test/pause.test.ts). */
                               
                                                  
                                  
                                                                                 
                
 

                                                    

                 
                  
                                                                         
                       
                                                  
              
                                                
               
                
 

                            
                                                                        
                                                                         
                                                                                                         
                           
               
             
                            
                                         
                         
 

/**
 * The pure part: the game's timers over the browser's own. Ids are the hold's own (a held timer has no browser id, and
 * the game keeps the id it got across a pause). `compile` turns a string handler (`setTimeout("tick()", 100)`, old
 * code) into a function; absent = string handlers are ignored, as a page with a strict CSP does.
 */
function makeTimerHold(n              , compile                               )            {
  const timers = new Map               ();
  let nextId = 1;
  let stopped = false;

  const arm = (id        , t       , wait        ) => {
    t.due = n.now() + wait;
    t.real = n.setTimeout(() => fire(id), wait);
  };
  function fire(id        ) {
    const t = timers.get(id);
    if (!t || stopped) return;
    t.real = null;
    if (t.every === null) timers.delete(id);
    else {
      // The next tick from when this one was due, not from now: no drift. Far behind (a background tab the browser
      // throttled): from now, so it does not fire a burst to catch up (the browser's own setInterval never does).
      const next = t.due + t.every;
      const wait = next - n.now();
      arm(id, t, wait >= -t.every ? Math.max(0, wait) : t.every);
    }
    t.run();
  }
  function add(handler         , ms         , args           , every         )         {
    const fn = typeof handler === 'function' ? handler : compile && typeof handler === 'string' ? compile(handler) : null;
    const id = nextId++;
    if (!fn) return id;
    // As the browser reads it: not a number or below 0 = 0; an interval of 0 still waits a little (Chrome: 4 ms after
    // a few; here 1, so a 0 interval cannot freeze the page in a loop of its own).
    const wait = Math.max(0, Number(ms) || 0);
    const t        = { run: () => fn(...args), every: every ? Math.max(1, wait) : null, due: 0, left: wait, real: null };
    timers.set(id, t);
    if (stopped) t.left = wait;
    else arm(id, t, wait);
    return id;
  }

  return {
    setTimeout: (h, ms, ...args) => add(h, ms, args, false),
    setInterval: (h, ms, ...args) => add(h, ms, args, true),
    clear(id) {
      const t = timers.get(id          );
      if (!t) return;
      if (t.real != null) n.clearTimeout(t.real);
      timers.delete(id          );
    },
    stop() {
      if (stopped) return;
      stopped = true;
      const now = n.now();
      for (const t of timers.values()) {
        if (t.real != null) n.clearTimeout(t.real);
        t.real = null;
        t.left = Math.max(0, t.due - now);
      }
    },
    go() {
      if (!stopped) return;
      stopped = false;
      // In the order they were set (a Map keeps it): two timers with the same time left fire in the game's order.
      for (const [id, t] of timers) arm(id, t, t.left);
    },
    get stopped() {
      return stopped;
    },
    get count() {
      return timers.size;
    },
  };
}

/**
 * Put the hold on the page: the window's setTimeout / setInterval / clearTimeout / clearInterval and Date.now become
 * the game's. `gameNow` is the game's performance.now (play-clock.ts), so Date.now leaves out exactly the time it does.
 * Returns null when the page will not let the globals be replaced (nothing is held then, as before).
 */
function installTimerHold(win                            , real                                                                                                                                      ,
  gameNow              )                   {
  const hold = makeTimerHold(
    { setTimeout: (fn, ms) => real.setTimeout(fn, ms), clearTimeout: (id) => real.clearTimeout(id          ), now: real.now },
    (code) => {
      try {
        return new win.Function(code)              ;
      } catch {
        return () => {}; // a CSP without unsafe-eval: the browser would refuse it too
      }
    },
  );
  // Date.now = the wall clock minus the time the game's clock has been stopped (real perf − game perf), in whole ms.
  // WHY whole, frozen and never back (first run of the screen test, 2026-10-22): the two clocks are read a moment
  // apart, so the plain difference wobbled by a fraction of a ms while paused, and was not the integer games expect.
  let frozen                = null;
  let last = -Infinity;
  const dateNow = () => (frozen !== null ? frozen : (last = Math.max(last, Math.floor(real.dateNow() - (real.now() - gameNow())))));
  const g = win                                      ;
  // Named like the browser's: engines and polyfills that check `setTimeout.name` or call through `window.setTimeout`
  // see the usual shape.
  const named =                                       (name        , f   )    => (Object.defineProperty(f, 'name', { value: name }), f);
  try {
    g.setTimeout = named('setTimeout', (h         , ms         , ...a           ) => hold.setTimeout(h, ms, ...a));
    g.setInterval = named('setInterval', (h         , ms         , ...a           ) => hold.setInterval(h, ms, ...a));
    g.clearTimeout = named('clearTimeout', (id         ) => hold.clear(id));
    g.clearInterval = named('clearInterval', (id         ) => hold.clear(id));
    win.Date.now = named('now', dateNow);
  } catch {
    return null;
  }
  // Stopped: one value, taken when it stopped. Going: whole ms like the browser's, never going back.
  const { stop, go } = hold;
  hold.stop = () => {
    if (!hold.stopped) frozen = dateNow();
    stop();
  };
  hold.go = () => {
    go();
    frozen = null;
  };
  return hold;
}

__def(__exports, "makeTimerHold", () => makeTimerHold);
__def(__exports, "installTimerHold", () => installTimerHold);
};
__defs[18] = function (__exports) {
'use strict';
// ../core/play-clock.ts

// The game's clock while playing inside the editor, so a pause takes no time (pause, 2026-10-22).
//
// WHY: freezing the frames (time.ts) is not enough. Engines measure the time between frames from performance.now()
// (three.js Timer / Clock) or from the timestamp requestAnimationFrame hands them (Pixi's Ticker, Phaser, a hand-made
// `t / 600`). After a one-minute pause the first frame would see a 60 s step: the boat jumps across the cove, a timer
// runs out, a physics step explodes. Here the time spent paused is taken out of both, so the game's next frame sees
// one ordinary frame's step.
//
// Only in ▶ Play inside the editor (bridge.ts installs it before any game code, so the game's first look at
// performance.now already goes through it).
//
// The game's timers and Date.now() stop with it too (polish-1022, 2026-10-22; play-timers.ts). Until then Date.now was
// left alone as wall time ("saves, last played") and setTimeout / setInterval were not held: a countdown or an enemy
// spawner on a timer ran on through a pause and through Edit. Date.now now leaves out the stopped time as well (a save's
// time is off by the minutes paused, which no game we know minds; `new Date()` stays the wall clock). CONTRACT.md §3.5.1
// lists what a pause still does not stop.

const { nativeClearTimeout, nativeDateNow, nativeSetTimeout } = __require(0);
const { installTimerHold } = __require(17);

                            
                                                                        
               
             
                            
                                                                                                           
                        
                                                                                                                     
                    
                                     
                           
                                                                                               
                                    
 

/** The pure part (test/pause.test.ts): real time in, game time out. */
function makeClock(real              ) {
  let skipped = 0;
  let stoppedAt                = null;
  return {
    stop() {
      if (stoppedAt === null) stoppedAt = real();
    },
    go() {
      if (stoppedAt === null) return;
      skipped += Math.max(0, real() - stoppedAt);
      stoppedAt = null;
    },
    get stopped() {
      return stoppedAt !== null;
    },
    get skipped() {
      return skipped;
    },
    /** While stopped every time reads as the moment it stopped; never earlier than that. */
    at(t        ) {
      if (stoppedAt !== null) return Math.min(t, stoppedAt) - skipped;
      return t - skipped;
    },
  };
}

function installPlayClock(win                            )            {
  const perf = win.performance;
  const realNow = perf.now.bind(perf);
  const c = makeClock(realNow);
  try {
    // An own property on the instance: Performance.prototype.now stays the browser's (other frames, workers).
    Object.defineProperty(perf, 'now', { value: function now() { return c.at(realNow()); }, configurable: true, writable: true });
  } catch {
    /* a locked-down page: the rAF timestamps are still shifted (time.ts) */
  }
  // The browser's own timers: captured by core/native.ts before anything wrapped them (the edit script's first import);
  // another window (tests) uses its own.
  const own = typeof window !== 'undefined' && win === window;
  const timers = installTimerHold(win, {
    setTimeout: own ? nativeSetTimeout : win.setTimeout.bind(win),
    clearTimeout: own ? nativeClearTimeout : win.clearTimeout.bind(win),
    now: realNow,
    dateNow: own ? nativeDateNow : win.Date.now.bind(win.Date),
  }, () => c.at(realNow()));
  return {
    // The timers stop and go with the clock: in a pause (play-pause.ts) and, in the edit page, with every hold of the
    // game (time.ts `clock`), so Edit holds a timer-driven game as it holds a frame-driven one.
    stop() {
      c.stop();
      timers?.stop();
    },
    go() {
      c.go();
      timers?.go();
    },
    timers,
    get stopped() {
      return c.stopped;
    },
    get skipped() {
      return c.skipped;
    },
    at: c.at,
    realNow,
  };
}

__def(__exports, "makeClock", () => makeClock);
__def(__exports, "installPlayClock", () => installPlayClock);
};
__defs[19] = function (__exports) {
'use strict';
// ../core/port2d.ts

// Turn a small Port2D (written per game, usually by the user's AI agent)
// into the full StudioAdapter the bridge drives.
//
// WHY the split: the hard, engine-independent parts — picking with a finger
// radius, keeping the finger offset while dragging, rotating around the pivot,
// panning/zooming the edit view, framing everything — are the same for every
// 2D engine. Putting them here means an adapter for a new engine is a page of
// direct engine calls (read/write x, y, rotation, scale; report a screen
// rectangle), which an AI can write correctly from one example and which the
// self-check can verify.
const { LIMITS } = __require(13);
                                       

                                                            

function invert(m          )             {
  const [a, b, c, d, e, f] = m       ;
  const det = a * d - b * c;
  if (!det || !Number.isFinite(det)) return null;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}
function apply(m          , x        , y        )                   {
  return [m[0]  * x + m[2]  * y + m[4] , m[1]  * x + m[3]  * y + m[5] ];
}
/** Normalise an angle to (-PI, PI]. */
function wrapAngle(r        )         {
  let a = r % (2 * Math.PI);
  if (a <= -Math.PI) a += 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

function guessHow(url        )                  {
  const ext = url.split(/[?#]/)[0] .split('.').pop() .toLowerCase();
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'].includes(ext)) return 'texture';
  if (['glb', 'gltf', 'fbx', 'obj'].includes(ext)) return 'model';
  if (['mp3', 'ogg', 'wav', 'm4a'].includes(ext)) return 'sound';
  if (['json', 'atlas'].includes(ext)) return 'atlas';
  if (['woff2', 'woff', 'ttf', 'otf'].includes(ext)) return 'font';
  return 'other';
}

/**
 * Names that say "ground / background" (en + ja). Kept short on purpose: a false
 * positive only pins one object at the back, which the person can still move by asking the AI.
 */
const BACKDROP_NAME = /(^|[^a-z])(ground|floor|terrain|background|backdrop|bg|sky)([^a-z]|$)|地面|背景|床|地形|空$/i;

/**
 * Which objects at the back of one sibling list are the ground / background
 * (Item.backdrop). `sibs` back → front; `w` = drawn width in px at the current
 * view, `refW` = the game's width at the same view. A sibling is a backdrop
 * when its name says so or it is at least 90 % as wide as the game; only the
 * unbroken run from the very back counts (a wide cloud in the middle is not
 * the ground), and never the whole list (then the list is all "layers" the
 * person may want to reorder, e.g. parallax strips).
 */
function backdropRun(sibs                                                    , refW        )           {
  const out           = [];
  for (const s of sibs) {
    const wide = refW > 0 && typeof s.w === 'number' && s.w >= refW * 0.9;
    if (!wide && !BACKDROP_NAME.test(s.label || '')) break;
    out.push(s.key);
  }
  return out.length >= sibs.length ? [] : out;
}

                     
            
            
               
 

function adapterFromPort2D(port        , _core      , win         = window)                {
  const grabs = new Map                          (); // key -> parent-space offset (finger - pivot)
  const view            = { x: 0, y: 0, zoom: 1 };
  const applyView = () => port.setView?.({ ...view });

  const canvasEl = ()                           => {
    if (port.canvas) return port.canvas();
    let best                           = null;
    let area = 0;
    for (const c of Array.from(win.document.querySelectorAll('canvas'))) {
      const r = c.getBoundingClientRect();
      if (r.width * r.height > area) {
        area = r.width * r.height;
        best = c;
      }
    }
    return best;
  };
  const canvasRect = () => {
    const c = canvasEl();
    if (c) return c.getBoundingClientRect();
    return { left: 0, top: 0, width: win.innerWidth, height: win.innerHeight, right: win.innerWidth, bottom: win.innerHeight }           ;
  };

  // ----- draw order (layers) -----
  // The port speaks engine indices (every child counts, e.g. a background
  // that is not listed); the editor speaks ranks among the LISTED objects of
  // one parent (Pose.z, 0 = back). WHY ranks: "one step forward" must pass
  // the next thing the person can see in the list, not an invisible child,
  // and undo must land exactly where it was. Moving to the rank of another
  // listed object with remove-then-insert puts it just above that object when
  // going forward and just below it when going back, so the others keep their
  // relative order and setPose(old z) is an exact undo.
  const canOrder = typeof port.order === 'function' && typeof port.setOrder === 'function';
  /** Listed keys per parent, from the last objects() call (list() refreshes it). */
  let siblings = new Map                  ();
  const parentOf = new Map                ();
  const orderOf = (key        ) => {
    try {
      const o = port.order (key);
      return o && typeof o.parent === 'string' && Number.isFinite(o.index) ? o : null;
    } catch {
      return null;
    }
  };
  /** Listed siblings of `key`, back to front, with their engine index. */
  const ranked = (key        ) => {
    const parent = parentOf.get(key);
    if (parent === undefined) return null;
    const out                                        = [];
    for (const k of siblings.get(parent) || []) {
      const o = orderOf(k);
      if (o && o.parent === parent) out.push({ key: k, index: o.index });
    }
    return out.sort((a, b) => a.index - b.index);
  };
  const rankOf = (key        )                     => {
    if (!canOrder) return undefined;
    const r = ranked(key);
    const i = r ? r.findIndex((e) => e.key === key) : -1;
    return i >= 0 ? i : undefined;
  };
  const reorder = (key        , z        ) => {
    const r = ranked(key);
    if (!r) return;
    const cur = r.findIndex((e) => e.key === key);
    const to = Math.max(0, Math.min(r.length - 1, Math.round(z)));
    if (cur < 0 || to === cur) return;
    port.setOrder (key, r[to] .index);
  };

  const pose = (key        )              => {
    const p = port.get(key);
    if (!p) return null;
    const out       = { p: [p.p[0] ?? 0, p.p[1] ?? 0], r: p.r ?? 0, s: p.s ?? 1 };
    const z = rankOf(key);
    if (z !== undefined) out.z = z;
    return out;
  };

  const list = ()         => {
    const objs = port.objects();
    if (canOrder) {
      siblings = new Map();
      parentOf.clear();
      for (const o of objs) {
        const ord = orderOf(o.key);
        if (!ord) continue;
        parentOf.set(o.key, ord.parent);
        const arr = siblings.get(ord.parent) || [];
        arr.push(o.key);
        siblings.set(ord.parent, arr);
      }
    }
    const out         = [];
    // Ground / background at the back of each list (Item.backdrop).
    const backdrops = new Set        ();
    if (canOrder) {
      const refW = canvasRect().width * view.zoom;
      const labels = new Map(objs.map((o) => [o.key, o.label]         ));
      for (const keys of siblings.values()) {
        const sibs = keys.map((k) => ({ k, o: orderOf(k) })).filter((e) => e.o).sort((a, b) => a.o .index - b.o .index)
          .map(({ k }) => {
            let w                    ;
            try {
              w = port.bounds(k)?.w;
            } catch {
              w = undefined;
            }
            return { key: k, label: labels.get(k), w };
          });
        for (const k of backdropRun(sibs, refW)) backdrops.add(k);
      }
    }
    for (const o of objs) {
      const ps = pose(o.key);
      if (!ps) continue;
      out.push({
        key: o.key,
        label: o.label ?? o.key,
        kinds: o.kinds ?? ['object'],
        group: o.group,
        unstable: o.unstable,
        rotatable: o.rotatable !== false,
        scalable: o.scalable !== false,
        layer: ps.z !== undefined ? parentOf.get(o.key) : undefined,
        backdrop: ps.z !== undefined && backdrops.has(o.key) ? true : undefined,
        pose: ps,
        // A UI port's screen (UI stage 2); world ports never say one, so their items are what they were.
        ...(o.screen ? { screen: o.screen } : {}),
      });
    }
    return out;
  };

  const set = (key        , p      )              => {
    if (!port.get(key)) return null;
    port.set(key, p);
    if (canOrder && p.z !== undefined && Number.isFinite(p.z)) reorder(key, p.z);
    return pose(key);
  };

  /** Union of all object rectangles, in screen px at the CURRENT view. */
  const allBounds = () => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of port.objects()) {
      const b = port.bounds(o.key);
      if (!b || !Number.isFinite(b.x)) continue;
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null;
  };

  // View maths. The engine shows a world point that would be at screen w
  // (identity view) at S(w) = c + zoom*(w - c) + t, c = canvas centre.
  const centre = () => {
    const r = canvasRect();
    return [r.left + r.width / 2, r.top + r.height / 2]         ;
  };
  const toIdentity = (sx        , sy        ) => {
    const [cx, cy] = centre();
    return [cx + (sx - cx - view.x) / view.zoom, cy + (sy - cy - view.y) / view.zoom]         ;
  };

  /** Scene (stage) space → screen. Default: canvas pixels through the edit view. */
  const sceneMatrix = ()                  => {
    const m = port.sceneToScreen?.();
    if (m && m.length === 6) return m;
    const c = canvasEl();
    if (!c || !c.width || !c.height) return null;
    const r = c.getBoundingClientRect();
    const kx = r.width / c.width, ky = r.height / c.height;
    // When the port has no setView, the view is not applied to the picture.
    const z = port.setView ? view.zoom : 1;
    const tx = port.setView ? view.x : 0, ty = port.setView ? view.y : 0;
    const [cx, cy] = centre();
    // identity screen: w = (r.left + kx*x, r.top + ky*y); shown at c + z*(w - c) + t
    return [z * kx, 0, 0, z * ky, cx + z * (r.left - cx) + tx, cy + z * (r.top - cy) + ty];
  };

  const adapter                = {
    toGround(x, y) {
      const m = sceneMatrix();
      const inv = m && invert(m);
      return inv ? apply(inv, x, y) : null;
    },
    toScreen(p) {
      const m = sceneMatrix();
      return m ? apply(m, p[0] ?? 0, p[1] ?? 0) : null;
    },
    kind: port.name,
    dim: '2d',
    version: port.version,
    list,
    begin() {
      port.pause?.();
      applyView();
      return list();
    },
    end() {
      view.x = 0;
      view.y = 0;
      view.zoom = 1;
      port.setView?.({ x: 0, y: 0, zoom: 1 });
      port.resume?.();
    },
    render: () => port.render(),
    pickNear(x, y, radius) {
      const vw = win.innerWidth, vh = win.innerHeight;
      const hits                                                                                          = [];
      port.objects().forEach((o, order) => {
        const b = port.bounds(o.key);
        if (!b) return;
        const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
        const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
        if (Math.hypot(dx, dy) > radius) return;
        const onScreen = b.x + b.w > 0 && b.y + b.h > 0 && b.x < vw && b.y < vh;
        hits.push({ key: o.key, inside: dx === 0 && dy === 0, area: Math.max(1, b.w * b.h), order, onScreen });
      });
      // Visible first, then directly under the finger, then smaller, then
      // drawn later (on top in most 2D engines).
      hits.sort((a, b) => Number(b.onScreen) - Number(a.onScreen) || Number(b.inside) - Number(a.inside) || a.area - b.area || b.order - a.order);
      return hits.map((h) => h.key);
    },
    anchor(key) {
      const ps = pose(key);
      const m = port.parentToScreen(key);
      if (!ps || !m) return null;
      const center = apply(m, ps.p[0] , ps.p[1] );
      const b = port.bounds(key);
      const size = b ? Math.max(b.w, b.h) : 0;
      const vw = win.innerWidth, vh = win.innerHeight;
      const visible = center[0] > -vw && center[1] > -vh && center[0] < 2 * vw && center[1] < 2 * vh;
      return { center, rect: b ? { ...b } : undefined, size, pose: ps, visible };
    },
    grab(key, x, y) {
      const ps = pose(key);
      const m = port.parentToScreen(key);
      const inv = m && invert(m);
      if (!ps || !inv) return false;
      const q = apply(inv, x, y);
      grabs.set(key, [q[0] - ps.p[0] , q[1] - ps.p[1] ]);
      return true;
    },
    drag(key, x, y) {
      const ps = pose(key) ;
      const m = port.parentToScreen(key);
      const inv = m && invert(m);
      if (!ps || !inv) return ps;
      const off = grabs.get(key) || [0, 0];
      const q = apply(inv, x, y);
      return set(key, { ...ps, p: [q[0] - off[0], q[1] - off[1]] }) || ps;
    },
    rotate(key, d) {
      const ps = pose(key) ;
      return set(key, { ...ps, r: wrapAngle((ps.r ?? 0) + d) }) || ps;
    },
    scale(key, f) {
      const ps = pose(key) ;
      const clamp = (v        ) => Math.min(LIMITS.maxScale, Math.max(LIMITS.minScale, v * f));
      const s = Array.isArray(ps.s) ? ps.s.map(clamp) : clamp((ps.s          ) ?? 1);
      return set(key, { ...ps, s }) || ps;
    },
    setPose: set,
    // The outline's shape, when the port can draw objects alone (pixi does); else a box.
    silhouette: port.silhouette ? (keys          ) => {
      try {
        return port.silhouette (keys);
      } catch {
        return null;
      }
    } : undefined,
    async capture(key, { size }) {
      // The port's own thumbnail first; when it has none (null), crop the
      // object from the screen like ports without capture().
      if (port.capture) {
        const url = await port.capture(key, size).catch(() => null);
        if (url && url.startsWith('data:image/')) return { ok: true, dataUrl: url };
      }
      const c = canvasEl();
      const b = port.bounds(key);
      if (!c || !b || b.w < 1 || b.h < 1) return { ok: false };
      try {
        port.render();
        const r = c.getBoundingClientRect();
        const sx = c.width / r.width, sy = c.height / r.height;
        const out = win.document.createElement('canvas');
        out.width = out.height = size;
        const g = out.getContext('2d') ;
        const k = Math.min(size / b.w, size / b.h);
        const w = b.w * k, h = b.h * k;
        g.drawImage(c, (b.x - r.left) * sx, (b.y - r.top) * sy, b.w * sx, b.h * sy, (size - w) / 2, (size - h) / 2, w, h);
        return { ok: true, dataUrl: out.toDataURL('image/png') };
      } catch {
        return { ok: false };
      }
    },
    view: {
      pan(dx, dy) {
        view.x += dx;
        view.y += dy;
        applyView();
      },
      zoom(f, x, y) {
        const [cx, cy] = centre();
        const px = x ?? cx, py = y ?? cy;
        const [wx, wy] = toIdentity(px, py);
        view.zoom = Math.min(20, Math.max(0.05, view.zoom * f));
        view.x = px - cx - view.zoom * (wx - cx);
        view.y = py - cy - view.zoom * (wy - cy);
        applyView();
      },
      // The opening view (and ⌘K "Back to the opening view"). On a portrait screen — a phone — the game's own picture
      // (the identity view: exactly what Play shows), else everything in frame as before. WHY (the second design review's
      // ⑩, 2026-10-19): "everything in frame" on a 390 px wide phone shrank a landscape world to a strip — Firefly Ruins'
      // urn was 15×21 pt with the top 40 % of the screen empty sky — while the game itself already zooms in on its middle
      // for a portrait screen. 3D opens on the game's camera the same way (three.js home()).
      home() {
        const r = canvasRect();
        if (r.height > r.width) {
          view.x = 0;
          view.y = 0;
          view.zoom = 1;
          applyView();
        } else adapter.view.frameAll();
      },
      frameAll() {
        const b = allBounds();
        if (!b) return;
        const r = canvasRect();
        // Bounds at the identity view.
        const [ix0, iy0] = toIdentity(b.x0, b.y0);
        const [ix1, iy1] = toIdentity(b.x1, b.y1);
        const w = Math.max(1, ix1 - ix0), h = Math.max(1, iy1 - iy0);
        const z = Math.min(20, Math.max(0.05, Math.min((r.width * 0.9) / w, (r.height * 0.9) / h)));
        const [cx, cy] = centre();
        view.zoom = z;
        view.x = -z * ((ix0 + ix1) / 2 - cx);
        view.y = -z * ((iy0 + iy1) / 2 - cy);
        applyView();
      },
      // Only called when the object is out of view (bridge/editor.ts
      // focusIfHidden): move the least that brings it in, with room for the
      // handles under it, instead of centring it (centring slid a game that
      // fits the frame sideways and cut its edges; reviews 2026-10-16).
      // Too big for the frame: centre it.
      focus(key) {
        const b = port.bounds(key);
        if (!b) return;
        const r = canvasRect();
        const left = Math.max(r.left, 0), top = Math.max(r.top, 0);
        const right = Math.min(r.right, win.innerWidth), bottom = Math.min(r.bottom, win.innerHeight);
        const m = 16, below = 64;
        const fit = (lo        , hi        , a0        , a1        ) => {
          if (a1 - a0 > hi - lo - 2 * m) return (lo + hi) / 2 - (a0 + a1) / 2;
          if (a0 < lo + m) return lo + m - a0;
          if (a1 > hi - m) return hi - m - a1;
          return 0;
        };
        view.x += fit(left, right, b.x, b.x + b.w);
        view.y += fit(top, bottom, b.y, b.y + b.h + below);
        applyView();
      },
      state: () => ({ ...view }),
      restore(s) {
        const v = s                             ;
        if (!v || typeof v !== 'object') return;
        if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.zoom) && v.zoom  > 0) {
          view.x = v.x ;
          view.y = v.y ;
          view.zoom = v.zoom ;
          applyView();
        }
      },
    },
    assetsOf(key) {
      const raw = port.assetsOf?.(key) || [];
      return raw.map((a) => {
        if (typeof a !== 'string') return a;
        let url = a;
        try {
          url = new URL(a, win.location.href).href;
        } catch {
          /* keep as given */
        }
        return { url, how: guessHow(url), sure: true };
      });
    },
  };
  // Copy and delete (CONTRACT.md §1.8): passed through when the port has all
  // three; otherwise src/core/edits.ts shows stand-ins.
  if (typeof port.clone === 'function' && typeof port.remove === 'function' && typeof port.putBack === 'function') {
    adapter.clone = (key, newKey) => !!port.clone (key, newKey);
    adapter.remove = (key) => !!port.remove (key);
    adapter.putBack = (key) => !!port.putBack (key);
  }
  return adapter;
}

__def(__exports, "invert", () => invert);
__def(__exports, "apply", () => apply);
__def(__exports, "wrapAngle", () => wrapAngle);
__def(__exports, "BACKDROP_NAME", () => BACKDROP_NAME);
__def(__exports, "backdropRun", () => backdropRun);
__def(__exports, "adapterFromPort2D", () => adapterFromPort2D);
};
__defs[20] = function (__exports) {
'use strict';
// ../loader/studio-placement.js

// studio-placement.js: apply placement.json to a running game (three.js or PixiJS) and to its HTML UI.
//
//   import { applyPlacement } from './studio-placement.js';
//   const report = await applyPlacement(scene, './placement.json'); // three: the Scene; Pixi: app.stage
//   // report = { applied: ['tree-01'], missing: ['old-rock'], unstable: ['path:0/3/1'], skipped: [] }
//   await applyPlacement(document, './placement.json');             // a game with no world (HTML only): the UI only
//
// `ui` (UI stage 1, 2026-10-19): HTML elements marked data-studio-key="title-logo" that were moved / resized in the
// editor's UI layer. Each gets the CSS `translate` / `scale` properties (offset in CSS px from where the game's own
// CSS puts it); left / top / transform are never touched, so a title centred with transform: translate(-50%, -50%)
// stays centred. A translate / scale the game's stylesheet already gives is kept (the offset is added to it). Applied
// before the world, whatever the world's dim, and also to elements the game adds later (a game-over screen built
// with innerHTML): only when the file has a `ui`, so other games pay nothing. report.ui = { applied, missing }.
//
// `ui.<key>.set` and `theme` (UI stage 3, 2026-10-22): what the editor's card changed — the element's main text, that
// text's size and colour, the box's fill, a button's colours when hovered / pressed / disabled — and the game's CSS
// variables (--accent…). Applied here too, so the game shows them before the AI writes them into the code: the
// colours and the fill through one style sheet (#studio-ui-set; a state's with !important, the way :hover beats
// the normal look), set on the element itself when the game's own CSS is more specific; the text and its size on
// the text itself (uiTextPart: data-studio-text, else the element's first own text). theme: style.setProperty on
// <html>. `screen` (UI stage 2) says which screen an element is on: nothing to apply.
//
// `levels` (2026-10-22): a game with several levels gets one world part per level in the file. Pass the level being
// built: applyPlacement(scene, './placement.json', { level: 'cave' }). Without `level`, a file with levels moves
// nothing in the world (another level's layout must never land on this one); the UI is applied either way.
//
// Call it once after the world is built and BEFORE physics bodies are created: an engine that
// copies body positions into objects every frame would otherwise move them back.
//
// This file is copied into the user's game, so it is small, has no imports, and never throws for
// a bad or missing file: a game must keep running even if placement.json is broken. Unknown keys
// and bad values are skipped with one console.warn line. (The strict check lives in the editor and
// the server, which refuse to write a bad file in the first place.)
//
// Finding the object for a key follows the editor's key rules, in this order:
//   studioKey mark     three: object.userData.studioKey, Pixi: object.studioKey
//   "path:0/3/1"       child indexes from the root (unstable: changes when code reorders objects)
//   name / name#2      three: object.name, Pixi: object.label; "#2" = the second such object
//   userData id/name   three only: object.userData.id or object.userData.name
// `order` (2D only): draw orders changed in the editor, per parent, keys back -> front. PixiJS
// draws children in array order, so they are put back in that order, in the places they already
// take (a background that is not listed stays where it is). Keys are resolved first, and keys that
// depend on the tree order (path:…, name#2) are stamped as studioKey, so the editor still finds
// every object under the same key after the reorder.
// Names are compared after the same clean-up the editor applies to make a key (characters outside
// A-Z a-z 0-9 _ : # . - / become "_", at most 80 characters).
//
// `motion` (motion-gui, 2026-10-22: asked for as "build an object's movement with the GUI"): per key, a path the object
// goes along and / or a spin, made in the editor's card. Run by this file from the game's own frames, so a game that
// loads placement.json moves them without any code of its own:
//   position = the place it was given (after `objects`) + motionAt(m, seconds).off
//   angle    = the angle it was given + spin × seconds (three: rotation.y; Pixi: rotation)
// NOT inside the editor (the page URL has studio=edit): there the editor owns every pose, plays one object's motion
// itself (▶ on the card) and must see the place, not a point along the way. A game that writes the object's position
// every frame itself (physics, its own update) wins over this; the skill tells the AI to put the motion into that code.
// report.motion = the keys that move; stopMotion() stops them all (a game that wants to take over).
//
// `motions` + `when` / `until` (studio-motion-triggers, 2026-10-22: "a motion starts when something happens, stops when
// something happens, or runs the whole game"): `motions` at the top are the Library's motions (len / repeat / keys);
// an object's clip `{ use: 'Hop', when, until }` uses one by name. When it starts:
//   start · time (after N s) · key (KeyboardEvent.code) · click (Pixi: a tap on it; three: the game's camera, learnt
//   from scene.onBeforeRender) · after (another clip ended) · enter (an object walks into a box: `who`'s key, or
//   setPlayer(obj)) — all run here; touch · cue · say need the game: touch(key), cue(name), playMotion(key, name).
// until: { times } rounds, { cue } a named cue; then 'reset' = back to its first pose. motionRunner() is the one place
// for these rules; the editor's "Try" uses it too. report.motionWaits = the clips that wait for the game's code.

const KEY_CHARS = /[^A-Za-z0-9_:#.\-\/]/g;
const cleanName = (s) => (typeof s === 'string' && s ? s.replace(KEY_CHARS, '_').slice(0, 80) : '');

/**
 * @param {object} root  three.js Scene/Object3D or PixiJS Container (app.stage)
 * @param {string | object} [source]  URL of placement.json (default './placement.json') or its parsed content
 * @param {{ level?: string }} [opts]  level: the id of the level being built (a game with levels)
 * @returns {Promise<{ applied: string[], missing: string[], unstable: string[], skipped: string[] }>}
 */
async function applyPlacement(root, source = './placement.json', opts = {}) {
  const report = { applied: [], missing: [], unstable: [], skipped: [] };
  const three = !!(root && root.isObject3D);
  // The world the play hook moves (below), kept before the file is read: a game with no placement.json yet (404) still
  // plays the editor's draft motions in its edit page.
  if (root && typeof root === 'object' && root.nodeType !== 9) last = { root, n: three ? 3 : 2, three };
  let data = source;
  if (typeof source === 'string') {
    try {
      const res = await fetch(source, { cache: 'no-cache' });
      if (!res.ok) return report; // no file yet: nothing to apply
      data = await res.json();
    } catch (e) {
      warn('could not read ' + source + ' (' + e.message + ')');
      return report;
    }
  }
  const dim = three ? '3d' : '2d';
  if (!data || data.tool !== 'placement' || !data.objects || typeof data.objects !== 'object') {
    warn('not a placement file');
    return report;
  }
  if (data.theme && typeof data.theme === 'object' && typeof document !== 'undefined') applyTheme(document, data.theme);
  if (data.ui && typeof data.ui === 'object' && typeof document !== 'undefined') report.ui = applyUi(document, data.ui);
  if (root && root.nodeType === 9) return report; // applyPlacement(document): the UI only
  if (data.dim !== dim) {
    warn('the file is for ' + data.dim + ' but the root is a ' + (three ? 'three.js' : 'PixiJS') + ' object');
    return report;
  }
  if (Array.isArray(data.levels)) {
    const level = (opts && opts.level) || levelOfCodeless(data);
    if (!level) {
      warn('this file has levels: pass { level } to applyPlacement');
      return report;
    }
    data = placementForLevel(data, level);
  }
  const n = three ? 3 : 2;
  for (const key of Object.keys(data.objects)) {
    const e = data.objects[key];
    if (e && e.unstable) report.unstable.push(key);
    const obj = findByKey(root, key, three);
    if (!obj) report.missing.push(key);
    else if (put(obj, e, n, three)) report.applied.push(key);
    else report.skipped.push(key);
  }
  // Copies made in the editor (`added`, in the order they were made) that the code does not make yet: a clone of
  // the original (`from`) under the new key, at the saved pose (polish pass 2026-10-16). WHY: before, a copy lived
  // only in this file until the AI wrote it into the code, so it vanished in Play ("Copy is broken"). A clone looks
  // right but does not act (a boat that floats, a coin that spins) until the AI adds it to the code; a key the game
  // already has is skipped (the AI did). Deleted objects (`removed`) are hidden while they still stand where they
  // were (`was.p`), so a path key that now names another object leaves that one alone.
  for (const a of Array.isArray(data.added) ? data.added : []) {
    if (!a || typeof a.key !== 'string' || findByKey(root, a.key, three)) continue;
    const src = typeof a.from === 'string' && findByKey(root, a.from, three);
    const c = src && src.parent && copyOf(src, three);
    if (!c || !put(c, a, n, three)) {
      report.missing.push(a.key);
      continue;
    }
    if (three) (c.userData.studioKey = a.key), src.parent.add(c);
    else (c.studioKey = a.key), src.parent.addChildAt(c, src.parent.getChildIndex(src) + 1);
    report.applied.push(a.key);
  }
  for (const r of Array.isArray(data.removed) ? data.removed : []) {
    const o = r && typeof r.key === 'string' && findByKey(root, r.key, three);
    const w = o && r.was && r.was.p;
    if (o && !(Array.isArray(w) && w.some((v, i) => Math.abs(v - [o.position.x, o.position.y, o.position.z][i]) > 1e-3))) (o.visible = false), report.applied.push(r.key);
  }
  if (!three && Array.isArray(data.order)) applyOrder(root, data.order, report);
  if ((data.motion && typeof data.motion === 'object') || Array.isArray(data.motions)) runMotion(root, data, n, three, report);
  if (report.missing.length) warn(report.missing.length + ' key(s) not found, ignored: ' + report.missing.slice(0, 10).join(', '));
  if (report.skipped.length) warn(report.skipped.length + ' entr(ies) with bad values, ignored: ' + report.skipped.slice(0, 10).join(', '));
  return report;
}

// The keys moved by this file (any copy of it on the page): the editor's ▶ Play (bridge/play-arrange.ts) leaves them
// alone, so an object is never moved twice. A global symbol, because the game and the editor each load their own copy.
const MOVING = Symbol.for('game-studio.motion');
// Every object this file can move: key → { o, three, base, clips }. `base` is the pose after `objects` (the place every
// key is an offset from); `clips` are resolved (a Library motion's len / repeat / keys filled in, `when` read).
// `run` decides what plays when (motionRunner, shared with the editor's "Try"); one frame loop poses what it says.
const known = new Map();
let run = null;
let ticking = false;
// The world given to applyPlacement and the Library's motions in its file: playMotion(key, name) can start a Library
// motion on an object it was never attached to ("make the crate Hop when…": the AI's one line).
let world = null;
let library = [];
// setPlayer(obj): who walks into the areas of `enter` clips that name no `who` (or a `who` the loader cannot find).
let player = null;

/**
 * Stop the motion of one object (`key`), or of every object (no key). The objects stay where they are now. A stopped
 * key stays in the "moved by the loader" set: the game took it over, the editor's Play must not start it again.
 */
function stopMotion(key) {
  if (key === undefined) {
    if (run) run.stop();
    olds.clear();
    if (globalThis[MOVING]) globalThis[MOVING].clear();
  } else {
    if (run) run.stop(key);
    const k = known.get(key);
    if (k) olds.delete(k);
  }
}

/**
 * Play one of an object's named motions from its start: the cue a game gives ("the player reached the door" →
 * playMotion('door', 'Open')). The name is the object's clip, or any Library motion (`motions` in the file), even one
 * that is not on this object. The clip playing on that object stops where it is and this one takes over.
 * false = no such object / motion, or inside the editor.
 */
function playMotion(key, name) {
  if (editing()) return false;
  let k = known.get(key);
  let clip = k && k.clips.find((c) => c.name === name);
  if (!clip) {
    const lib = library.find((m) => m && m.name === name);
    const o = !lib ? null : k ? k.o : world && findByKey(world, key, !!world.isObject3D);
    if (!o) return false;
    if (!k) k = remember(key, o, !!world.isObject3D, []);
    clip = resolveClip({ use: name, when: { on: 'say' } }, library, key);
    k.clips.push(clip);
  }
  ensureRun().play(key, clip, performance.now());
  tickSoon();
  return true;
}

/** A named cue happened in the game ("chest-opened"): the clips that start on it start, the ones that stop on it stop. */
function cue(name) {
  return fire({ on: 'cue', cue: name });
}

/** The player touched this object (the game's own collision): its clips that start on a touch start. */
function touch(key) {
  return fire({ on: 'touch', key });
}

/** The object that walks into areas (`enter` clips): for a game whose player has no key the loader can find. */
function setPlayer(obj) {
  player = obj || null;
  tickSoon();
}

function fire(ev) {
  if (!run || editing()) return false;
  const n = run.fire(ev, performance.now());
  tickSoon();
  return n > 0;
}

/** An object's clip by name (for a game that moves the object itself: clipAt(clipOf('door', 'Open'), seconds)). */
function clipOf(key, name) {
  const k = known.get(key);
  return (k && k.clips.find((c) => c.name === name)) || resolveClip(library.find((m) => m && m.name === name) ? { use: name } : null, library, key);
}

/**
 * When a clip starts, in one shape: studio-motion-triggers' `when` object, or studio-timeline's (`start: true` = at
 * once; else a string `when` = the person's words for the AI; a clip with `use` and no `when` = at once).
 */
function whenOf(c) {
  if (!c || typeof c !== 'object') return { on: 'say' };
  const w = Array.isArray(c.when) ? c.when.find((x) => x && typeof x.on === 'string') : c.when;
  if (w && typeof w === 'object' && typeof w.on === 'string') return w;
  if (c.start === true || (c.use && w === undefined)) return { on: 'start' };
  return typeof w === 'string' && w.trim() ? { on: 'say', say: w } : { on: 'say' };
}

/**
 * Every way a clip starts (studio-timeline-2, 2026-10-22: "E or a click"): `when` may be a list — any one of them
 * starts it. One `when` (or none) is a list of one (whenOf's answer).
 */
function whensOf(c) {
  const ws = c && Array.isArray(c.when) ? c.when.filter((x) => x && typeof x.on === 'string') : [];
  return ws.length ? ws : [whenOf(c)];
}

/**
 * A clip as it plays: a `use` clip gets its Library motion's len / repeat / keys; null = bad, or a motion not there.
 * A scene motion (studio-timeline-2: `tracks`, several objects in one motion) gives object `key` its own track, and
 * `scene: true` (the runner then starts the scene's other objects with it). `when` = the first way it starts (as
 * before), `whens` = all of them (whensOf: the runner's).
 */
function resolveClip(c, lib, key) {
  if (!c || typeof c !== 'object') return null;
  if (typeof c.use === 'string') {
    const m = (Array.isArray(lib) ? lib : []).find((x) => x && x.name === c.use && typeof (x.tracks || x.keys) === 'object');
    const tr = m && m.tracks;
    return m ? { name: typeof c.name === 'string' ? c.name : c.use, use: c.use, len: m.len, repeat: m.repeat, keys: tr ? tr[key] || {} : m.keys, when: whenOf(c), whens: whensOf(c), until: c.until, scene: !!tr } : null;
  }
  return typeof c.name === 'string' && c.keys && typeof c.keys === 'object' ? { ...c, when: whenOf(c), whens: whensOf(c) } : null;
}

/**
 * What plays when (studio-motion-triggers, 2026-10-22): one place for the rules, used by this file in the game and by
 * the editor's "Try" (the same answers in both). No DOM, no scene: it is told what happened (fire), asked where things
 * are (step) and answers each moving key's offsets (clipAt's shape).
 *   objs: [{ key, clips }] with resolved clips (resolveClip). The rules:
 *   - a clip starts on its `when` (fire's event, or by itself: `time` after `after` seconds, `after` when that clip
 *     ends, `enter` when the player's position goes into the area: step's `where(who)`); again = from its start;
 *     a list of `when`s: any one of them (studio-timeline-2);
 *   - a scene clip (`scene`: one motion, several objects) that starts starts the scene's other objects at the same
 *     moment, so they keep one time line whichever of them was triggered;
 *   - one clip per object plays: a new one takes over where the last one is (as playMotion always did);
 *   - `until.times` = after that many rounds (a loop: len; a pingpong: there and back; a once: its length),
 *     `until.cue` = when that cue fires; `then: 'reset'` puts it back on its first pose, else it stays where it is.
 */
function motionRunner(objs) {
  const list = (Array.isArray(objs) ? objs : []).filter((x) => x && Array.isArray(x.clips));
  const movers = new Map();
  const held = new Map();
  let t0 = null;
  const timed = new Set();
  const inside = new Map();
  const ok = (v) => typeof v === 'number' && isFinite(v);
  const round = (c) => (ok(c.len) && c.len > 0 ? c.len : 1) * (c.repeat === 'pingpong' ? 2 : 1);
  // A clip's ways to start (resolveClip's `whens`, studio-timeline-2; else its `when`, one or a list).
  const ws = (c) => c.whens || (Array.isArray(c.when) ? c.when : c.when ? [c.when] : []);
  const hits = (c, ev, key) => ws(c).some((w) => hit(w, ev, key));
  const hit = (w, ev, key) => {
    if (!w || w.on !== ev.on) return false;
    if (ev.on === 'key') return w.key === ev.key;
    if (ev.on === 'cue') return w.cue === ev.cue;
    if (ev.on === 'after') return w.use === ev.use && (w.key || key) === ev.key;
    if (ev.on === 'click' || ev.on === 'touch' || ev.on === 'enter' || ev.on === 'say') return ev.key === key && (ev.on !== 'say' || !ev.use || ev.use === w.use);
    return true;
  };
  const play = (key, clip, now, alone) => {
    movers.set(key, { clip, t0: now });
    held.delete(key);
    if (clip.scene && !alone) for (const o of list) if (o.key !== key) for (const c of o.clips) if (c.use === clip.use) play(o.key, c, now, true);
  };
  const end = (key, r, at, now, out) => {
    movers.delete(key);
    const pose = r.clip.until && r.clip.until.then === 'reset' ? clipAt(r.clip, 0) : at;
    held.set(key, pose);
    out.set(key, pose);
    fireAt({ on: 'after', key, use: r.clip.use || r.clip.name }, now);
  };
  function fireAt(ev, now) {
    let n = 0;
    if (ev.on === 'start') t0 = now;
    for (const { key, clips } of list) {
      for (const c of clips) if (hits(c, ev, key)) (play(key, c, now), n++);
      const r = movers.get(key);
      if (ev.on === 'cue' && r && r.clip.until && r.clip.until.cue === ev.cue) {
        const out = new Map();
        end(key, r, clipAt(r.clip, (now - r.t0) / 1000), now, out);
        n++;
      }
    }
    return n;
  }
  return {
    fire: fireAt,
    play,
    /** Stop one key, or all (no key): they stay where they are, nothing more plays on them until fired again. */
    stop(key) {
      if (key === undefined) (movers.clear(), held.clear());
      else movers.delete(key), held.delete(key);
    },
    /** Something still to watch: a clip playing, a timer not fired yet, an area. */
    busy: () => movers.size > 0 || list.some(({ clips }) => clips.some((c) => ws(c).some((w) => w.on === 'enter' || (w.on === 'time' && t0 !== null && !timed.has(w))))),
    /** Where things are at `now` (ms): key → offsets ({ p, r, s }) for every object playing or holding its last pose. */
    step(now, where) {
      const out = new Map();
      if (t0 !== null) for (const { key, clips } of list) for (const c of clips) for (const w of ws(c)) {
        if (w.on === 'time' && !timed.has(w) && (now - t0) / 1000 >= (ok(w.after) ? w.after : 0)) (timed.add(w), play(key, c, now));
      }
      if (where) for (const { key, clips } of list) for (const c of clips) for (const w of ws(c)) {
        if (w.on !== 'enter' || !w.area || !Array.isArray(w.area.p) || !Array.isArray(w.area.size)) continue;
        const p = where(w.who || null);
        const isIn = !!p && w.area.p.every((v, i) => Math.abs((p[i] || 0) - v) <= Math.abs(w.area.size[i] || 0) / 2);
        if (isIn && !inside.get(w)) play(key, c, now);
        inside.set(w, isIn);
      }
      for (const [key, r] of [...movers]) {
        const t = Math.max(0, (now - r.t0) / 1000);
        const u = r.clip.until;
        const stopAt = u && ok(u.times) && u.times > 0 ? u.times * round(r.clip) : null;
        // A `once` clip with rounds plays again from its start each round ("hop 3 times"), then stops at its end.
        const again = stopAt !== null && r.clip.repeat !== 'loop' && r.clip.repeat !== 'pingpong';
        const tt = (u2) => (again ? Math.min(u2, stopAt) % round(r.clip) || (u2 > 0 ? round(r.clip) : 0) : u2);
        if (stopAt !== null && t >= stopAt) end(key, r, clipAt(r.clip, again ? round(r.clip) : stopAt - 1e-6), now, out);
        else {
          const at = clipAt(r.clip, tt(t));
          if (again) at.done = false;
          out.set(key, at);
          if (at.done) end(key, r, at, now, out);
        }
      }
      for (const [key, at] of held) if (!out.has(key)) out.set(key, at);
      return out;
    },
    /** What each object plays now (key → clip name): the editor's rows light up with it. */
    playing: () => new Map([...movers].map(([k, r]) => [k, r.clip.name])),
  };
}

/**
 * Where a clip is after `t` seconds: offsets from the object's place, per property — `p` added to the position, `r`
 * added to the angles ([x, y, z] in 3D, [angle] in 2D), `s` multiplying the size — each null when the clip has no key
 * for it (that property is left as it is). `done` = a `once` clip has reached its end (it stays on its last pose).
 * Shared with the editor (the timeline's scrub and ▶, Play), so the editor and the game move the same way.
 */
function clipAt(c, t) {
  const out = { p: null, r: null, s: null, done: false };
  if (!c || typeof c !== 'object' || !c.keys || typeof c.keys !== 'object') return out;
  const len = isNum(c.len) && c.len > 0 ? c.len : 1;
  let u = isNum(t) ? Math.max(0, t) : 0;
  if (c.repeat === 'loop') u %= len;
  else if (c.repeat === 'pingpong') (u %= 2 * len), (u = u > len ? 2 * len - u : u);
  else if (u >= len) (u = len), (out.done = true);
  for (const ch of ['p', 'r', 's']) out[ch] = trackAt(c.keys[ch], u, ch === 'p');
  return out;
}

/**
 * One property's value at `u` seconds into its clip, from its keys ({ t, v, ease }, in time order). Before the first
 * key: the first; after the last: the last. `ease` is how a key goes on to the next one: 'linear' (the same speed),
 * 'ease' (the default: starts slowly and stops slowly), 'step' (holds, then jumps at the next key). `smooth` (the
 * position): the way goes through the points on a curve (Catmull-Rom), not in straight lines — the shape the editor
 * draws as the path; a 'step' key breaks the curve there.
 */
function trackAt(keys, u, smooth) {
  const ks = Array.isArray(keys) ? keys.filter((k) => k && isNum(k.t) && Array.isArray(k.v) && k.v.length && k.v.every(isNum)) : [];
  if (!ks.length) return null;
  const n = ks[0].v.length;
  if (ks.some((k) => k.v.length !== n)) return null;
  if (!(u > ks[0].t)) return ks[0].v.slice();
  const last = ks[ks.length - 1];
  if (u >= last.t) return last.v.slice();
  let i = 0;
  while (i < ks.length - 2 && u >= ks[i + 1].t) i++;
  const a = ks[i], b = ks[i + 1], ease = a.ease || 'ease';
  if (ease === 'step') return a.v.slice();
  let f = b.t > a.t ? (u - a.t) / (b.t - a.t) : 1;
  if (ease === 'ease') f = f * f * (3 - 2 * f);
  // A span with a handle bent by hand (studio-timeline-2: `out` of its start, `in` of its end) is a Bézier curve; the
  // side without one takes the smooth curve's handle, so only what was bent changes.
  if (smooth && (hOk(a.out, n) || hOk(b.in, n))) {
    const o = handlesOf(ks, i).out, q = handlesOf(ks, i + 1).in, g = 1 - f;
    return a.v.map((v, k) => g * g * g * v + 3 * g * g * f * (v + o[k]) + 3 * g * f * f * (b.v[k] + q[k]) + f * f * f * b.v[k]);
  }
  if (!smooth || ks.length < 3) return a.v.map((v, k) => v + (b.v[k] - v) * f);
  const p0 = i > 0 && (ks[i - 1].ease || 'ease') !== 'step' ? ks[i - 1].v : a.v;
  const p3 = i + 2 < ks.length && (b.ease || 'ease') !== 'step' ? ks[i + 2].v : b.v;
  const f2 = f * f, f3 = f2 * f;
  return a.v.map((v, k) => 0.5 * (2 * v + (b.v[k] - p0[k]) * f + (2 * p0[k] - 5 * v + 4 * b.v[k] - p3[k]) * f2 + (3 * v - p0[k] - 3 * b.v[k] + p3[k]) * f3));
}

const hOk = (h, n) => Array.isArray(h) && h.length === n && h.every(isNum);

/**
 * Position key `i`'s two handles (offsets from its point): its own `in` / `out` (bent by hand; both 0 = a corner), else
 * the smooth curve's — a sixth of the way from the key before to the key after, the Bézier form of the Catmull-Rom
 * curve trackAt draws, so a handle grabbed for the first time starts where the path already is. null at the ends.
 * Shared with the editor (shell/path-edit.ts), which draws these handles.
 */
function handlesOf(ks, i) {
  const k = ks[i], n = k.v.length, prev = ks[i - 1], next = ks[i + 1];
  const p0 = prev && (prev.ease || 'ease') !== 'step' ? prev.v : k.v;
  const p3 = next && (k.ease || 'ease') !== 'step' ? next.v : k.v;
  return {
    in: !prev ? null : hOk(k.in, n) ? k.in : k.v.map((_, j) => (prev.v[j] - p3[j]) / 6),
    out: !next ? null : hOk(k.out, n) ? k.out : k.v.map((_, j) => (next.v[j] - p0[j]) / 6),
  };
}

/**
 * Where a motion is after `t` seconds: `off` = the offset from the object's place (null without a path), `turn` = the
 * angle added (spin × t), `done` = a `once` path has arrived. The older shape of `motion` (v0.1.13: a path, a speed,
 * a spin), still played for files saved before the timeline; the editor turns it into a clip when it opens one.
 * Path points are offsets from the place, the start ([0, 0(, 0)]) left out; constant speed along straight lines;
 * `repeat` pingpong (default: there and back), loop (back to the start and round again), once (stops at the last point).
 */
function motionAt(m, t) {
  const out = { off: null, turn: 0, done: false };
  if (!m || typeof m !== 'object') return out;
  if (isNum(m.spin)) out.turn = m.spin * t;
  const n = Array.isArray(m.path) && Array.isArray(m.path[0]) ? m.path[0].length : 0;
  const path = n ? m.path.filter((q) => Array.isArray(q) && q.length === n && q.every(isNum)) : [];
  if (!path.length) return out;
  const rep = m.repeat === 'loop' || m.repeat === 'once' ? m.repeat : 'pingpong';
  const pts = [path[0].map(() => 0), ...path];
  if (rep === 'loop') pts.push(pts[0]);
  const lens = pts.slice(1).map((q, i) => Math.hypot(...q.map((v, k) => v - pts[i][k])));
  const total = lens.reduce((a, b) => a + b, 0);
  let d = Math.max(0, (isNum(m.speed) && m.speed > 0 ? m.speed : 1) * t);
  if (!(total > 0)) return (out.off = pts[0]), out;
  if (rep === 'once') (out.done = d >= total), (d = Math.min(d, total));
  else if (rep === 'loop') d %= total;
  else (d %= 2 * total), (d = d > total ? 2 * total - d : d);
  let i = 0;
  while (i < lens.length - 1 && d > lens[i]) d -= lens[i++];
  const f = lens[i] ? Math.min(1, d / lens[i]) : 0;
  out.off = pts[i].map((v, k) => v + (pts[i + 1][k] - v) * f);
  return out;
}

/** A legacy motion (path / spin) as the same offsets clipAt gives: the editor and the loader play both one way. */
function legacyAt(m, t, n) {
  const a = motionAt(m, t);
  return { p: a.off, r: isNum(m.spin) ? (n === 3 ? [0, a.turn, 0] : [a.turn]) : null, s: null, done: a.done };
}

/** Put `o` at its place + the offsets `at` (clipAt's shape). Only the properties `at` has are touched. */
function poseAt(o, base, at, three) {
  if (at.p) three ? o.position.set(base.p[0] + at.p[0], base.p[1] + at.p[1], base.p[2] + at.p[2]) : o.position.set(base.p[0] + at.p[0], base.p[1] + at.p[1]);
  if (at.r) {
    if (three) (o.rotation.x = base.r[0] + (at.r[0] || 0)), (o.rotation.y = base.r[1] + (at.r[1] || 0)), (o.rotation.z = base.r[2] + (at.r[2] || 0));
    else o.rotation = base.r[0] + (at.r[0] || 0);
  }
  if (at.s) three ? o.scale.set(base.s[0] * at.s[0], base.s[1] * at.s[1], base.s[2] * at.s[2]) : o.scale.set(base.s[0] * at.s[0], base.s[1] * at.s[1]);
}

// `here`: the editor's page plays now (▶ Play in the same page, play hook below): the motions run as on a Play page.
let here = false;
const editing = () => !here && typeof location !== 'undefined' && /[?&]studio=edit(&|$)/.test(location.search);

// ▶ Play in the editor's own page (studio-no-reload, 2026-10-22: "when I go back to edit after playing, don't load"):
// the edit page becomes Play without opening the game again, so the motions this file runs on a Play page — every
// `when` (a click, an area, a cue, the game's playMotion()) — must start in that page too, from the draft the editor
// sends (it may differ from the file the page read, or the page may have read none). The editor finds this copy through
// a global set (the game and the editor each load their own copy; only the game's has a world: `last`, the root of the
// last applyPlacement given one):
//   start({ motion, motions }) → the keys it moves; stop() → they stop where they are (the editor puts them back).
// Before, a page opened for Edit never started them, and the editor opened a new Play page whenever a clip waited for
// something (bridge/play-switch.ts).
let last = null;
const hook = {
  has: () => !!last,
  start(d) {
    if (!last) return [];
    here = true;
    const r = {};
    runMotion(last.root, { motion: d && d.motion, motions: d && d.motions }, last.n, last.three, r);
    return r.motion || [];
  },
  stop() {
    here = false;
    gen++;
    ticking = false;
    stopMotion();
    known.clear();
    run = null;
  },
};
if (typeof globalThis !== 'undefined') (globalThis[Symbol.for('game-studio.play')] || (globalThis[Symbol.for('game-studio.play')] = new Set())).add(hook);

function remember(key, o, three, clips) {
  const base = three
    ? { p: [o.position.x, o.position.y, o.position.z], r: [o.rotation.x, o.rotation.y, o.rotation.z], s: [o.scale.x, o.scale.y, o.scale.z] }
    : { p: [o.position.x, o.position.y], r: [o.rotation], s: [o.scale.x, o.scale.y] };
  const k = { o, three, base, clips };
  known.set(key, k);
  (globalThis[MOVING] || (globalThis[MOVING] = new Set())).add(key);
  return k;
}

function ensureRun() {
  if (!run) run = motionRunner([...known].map(([key, k]) => ({ key, clips: k.clips })));
  return run;
}

// Where `who` is in the world (an `enter` area's test): the object with that key, else setPlayer's.
function whereIs(who) {
  const o = (who && world && findByKey(world, who, !!world.isObject3D)) || player;
  if (!o || !o.position) return null;
  if (o.getWorldPosition) {
    const v = o.getWorldPosition(o.position.clone());
    return [v.x, v.y, v.z];
  }
  return [o.position.x, o.position.y];
}

// One loop per applyPlacement: a new file (another level, the game restarted) starts a new generation and the old loop
// ends at its next frame, so two loops never pose the same object.
let gen = 0;
function tickSoon() {
  if (ticking || !run || typeof requestAnimationFrame !== 'function') return;
  ticking = true;
  const g = gen;
  const tick = (now) => {
    if (g !== gen) return;
    if (!run.busy() && !olds.size) return void (ticking = false);
    for (const [k, l] of olds) {
      if (k.o.parent === null) olds.delete(k);
      else poseAt(k.o, k.base, legacyAt(l.m, (now - l.t0) / 1000, l.n), k.three);
    }
    for (const [key, at] of run.step(now, whereIs)) {
      const k = known.get(key);
      // The object left the scene (another level was built; three and Pixi set parent to null): forget it.
      if (!k || k.o.parent === null) run.stop(key);
      else poseAt(k.o, k.base, at, k.three);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/**
 * The `motion` part of the file: each object's clips (a Library motion it uses, or keys of its own), each starting on
 * its `when` (whenOf) — or the older path / spin. Nothing runs inside the editor (studio=edit in the URL): there the
 * editor owns every pose and plays the timeline itself. Keys and clicks are listened to once per page.
 */
function runMotion(root, data, n, three, report) {
  world = root;
  library = Array.isArray(data.motions) ? data.motions.filter((m) => m && typeof m.name === 'string') : [];
  const motion = data.motion && typeof data.motion === 'object' ? data.motion : {};
  if (editing()) return;
  gen++;
  ticking = false;
  known.clear();
  clicks.clear();
  olds.clear();
  if (run) run.stop();
  run = null;
  const list = [];
  const legacy = [];
  const warn2 = [];
  for (const key of Object.keys(motion)) {
    const m = motion[key], o = findByKey(root, key, three);
    if (!o || !m || typeof m !== 'object') continue;
    const clips = Array.isArray(m.clips) ? m.clips.map((c) => resolveClip(c, library, key)).filter(Boolean) : [];
    const old = !clips.length && (isNum(m.spin) || (Array.isArray(m.path) && m.path.length && m.path.every((q) => Array.isArray(q) && q.length === n && q.every(isNum))));
    if (!clips.length && !old) continue;
    // The older path / spin plays at once, as a clip of the same shape (clipAt is not its maths: a frame function).
    const k = remember(key, o, three, clips);
    if (old) legacy.push([key, k, m]);
    for (const c of clips) for (const w of c.whens) {
      if (w.on === 'click') clickable(key, o, three);
      if (w.on === 'enter' && !(w.who && findByKey(root, w.who, three)) && !player) warn2.push(key + ': no player for its area (setPlayer)');
      if (w.on === 'touch' || w.on === 'cue' || w.on === 'say') warn2.push(key + ' · ' + c.name + ': waits for the game (' + w.on + ')');
    }
    list.push(key);
  }
  if (!list.length) return;
  report.motion = list;
  if (warn2.length) report.motionWaits = warn2;
  ensureRun().fire({ on: 'start' }, performance.now());
  listen(three);
  for (const [, k, m] of legacy) olds.set(k, { m, t0: performance.now(), n });
  tickSoon();
}

// v0.1.13's path / spin (no clip, so the runner does not know it): object → { m, t0, n }, posed by the same frame loop.
const olds = new Map();

let listening = false;
const clicks = new Map();
let view = null;
function listen(three) {
  if (listening || typeof addEventListener !== 'function') return;
  listening = true;
  addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (e.repeat || tag === 'INPUT' || tag === 'TEXTAREA') return;
    fire({ on: 'key', key: e.code });
  });
  // three: the camera and canvas the game draws with, learnt from the scene's onBeforeRender (no import of three here).
  if (three && world && world.isScene) {
    const was = world.onBeforeRender;
    world.onBeforeRender = function (renderer, scene, camera) {
      view = { camera, canvas: renderer && renderer.domElement };
      if (typeof was === 'function') return was.apply(this, arguments);
    };
    addEventListener('pointerdown', (e) => {
      if (!view || !view.camera || e.target !== view.canvas) return;
      const hit = clickedKey(e, view);
      if (hit) fire({ on: 'click', key: hit });
    });
  }
}

/** Pixi: the object itself takes taps. three: noted, found by clickedKey from the drawn picture. */
function clickable(key, o, three) {
  clicks.set(key, o);
  if (!three && typeof o.on === 'function') {
    o.eventMode = 'static';
    o.cursor = 'pointer';
    o.on('pointertap', () => fire({ on: 'click', key }));
  }
}

// The nearest clickable object under the pointer: each one's bounding sphere, projected with the game's camera.
function clickedKey(e, v) {
  const r = v.canvas.getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  let best = null, bestD = Infinity;
  for (const [key, o] of clicks) {
    if (o.parent === null) continue;
    o.updateWorldMatrix && o.updateWorldMatrix(true, true);
    o.traverse((m) => {
      const g = m.geometry;
      if (!g || !m.visible) return;
      if (!g.boundingSphere && g.computeBoundingSphere) g.computeBoundingSphere();
      if (!g.boundingSphere) return;
      const c = g.boundingSphere.center.clone().applyMatrix4(m.matrixWorld);
      const rad = g.boundingSphere.radius * m.matrixWorld.getMaxScaleOnAxis();
      const camPos = v.camera.getWorldPosition(c.clone());
      const dist = c.distanceTo(camPos);
      const p = c.clone().project(v.camera);
      if (p.z > 1 || p.z < -1) return;
      const sx = ((p.x + 1) / 2) * r.width, sy = ((1 - p.y) / 2) * r.height;
      const fov = v.camera.fov ? (v.camera.fov * Math.PI) / 180 : 1;
      const sr = Math.max(8, (rad / Math.max(1e-6, dist * Math.tan(fov / 2))) * (r.height / 2));
      if (Math.hypot(sx - x, sy - y) <= sr && dist < bestD) (best = key), (bestD = dist);
    });
  }
  return best;
}

/**
 * The level a game WITHOUT levels in its code builds (studio-uniforms, 2026-10-23): `levelsWas: []` = the person made
 * Level 2 in the editor and the AI has not added studio.levels() yet, so the game still calls applyPlacement without
 * { level }. In the editor's frame that is the level on screen (the URL's studioLevel: a copy is built from the game
 * as it is, its own entries over it); anywhere else Level 1 (the first level without `from`), so the shipped game
 * keeps the layout it had. Any other file with levels: '' (the warning above — a level's layout never lands on another).
 */
function levelOfCodeless(data) {
  if (!Array.isArray(data.levelsWas) || data.levelsWas.length) return '';
  let want = '';
  try {
    if (typeof window !== 'undefined' && window.parent !== window) want = new URL(window.location.href).searchParams.get('studioLevel') || '';
  } catch {
    want = '';
  }
  if (want && data.levels.some((l) => l && l.id === want)) return want;
  const first = data.levels.find((l) => l && !l.from);
  return first ? first.id : '';
}

/**
 * The file as one level sees it (levels, 2026-10-22): that level's objects / added / removed / order / motion at the
 * top, no `levels` (`motion` is a level's own since integrate3: its keys are that level's objects). A file without levels comes back as it is; a level the file does not list has nothing to apply.
 */
function placementForLevel(data, id) {
  if (!data || !Array.isArray(data.levels)) return data;
  const l = data.levels.find((x) => x && x.id === id) || {};
  const out = { ...data, objects: l.objects || {} };
  for (const k of ['added', 'removed', 'order', 'motion', 'names']) if (l[k]) out[k] = l[k];
  else delete out[k];
  delete out.levels;
  delete out.levelsWas;
  return out;
}

function applyUi(doc, ui) {
  const out = { applied: [], missing: [] };
  const put = (el) => {
    const k = el.dataset.studioKey, e = Object.hasOwn(ui, k) && ui[k];
    if (!e || !Array.isArray(e.p) || e.p.length !== 2 || !e.p.every(isNum) || (e.s !== undefined && !isNum(e.s))) return;
    if (placeUi(el, e.p, e.s === undefined ? 1 : e.s) && !out.applied.includes(k)) out.applied.push(k);
    if (sheet && e.set && typeof e.set === 'object') setUi(el, k, e.set, sheet);
  };
  // Only for a file whose card changed something (a file of moves alone adds nothing to the page, as before).
  const sheet = Object.values(ui).some((e) => e && e.set) ? uiSheet(doc, ui) : null;
  doc.querySelectorAll('[data-studio-key]').forEach(put);
  for (const k of Object.keys(ui)) if (!out.applied.includes(k)) out.missing.push(k);
  // Elements made later (a result screen written with innerHTML, a HUD rebuilt each round) get the same place.
  if (typeof MutationObserver === 'function') {
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) {
        if (n.dataset.studioKey) put(n);
        n.querySelectorAll('[data-studio-key]').forEach(put);
      }
    }).observe(doc.documentElement, { childList: true, subtree: true });
  }
  return out;
}

const UI_COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\([0-9.,%\s/+-]{1,60}\)|[a-zA-Z]{3,30})$/;
const UI_STATES = { '@hover': ':hover', '@active': ':active', '@disabled': ':disabled' };
const okColor = (c) => typeof c === 'string' && UI_COLOR.test(c);

/** The page's CSS variables changed in the editor (`theme`): on <html>, so every rule that uses them follows. */
function applyTheme(doc, theme) {
  for (const [name, e] of Object.entries(theme)) {
    if (/^--[A-Za-z0-9_-]{1,60}$/.test(name) && e && typeof e.v === 'string' && !/[;{}<>]/.test(e.v)) doc.documentElement.style.setProperty(name, e.v);
  }
}

/**
 * One style sheet for the elements' colours (#studio-ui-set): each state's with !important (it must beat the normal
 * look, the game's or the editor's), made once for the file. Colours that are not CSS colours are skipped; the key is a
 * data-studio-key (key characters only), so the selectors are safe.
 */
function uiSheet(doc, ui) {
  const rules = [];
  for (const [k, e] of Object.entries(ui)) {
    const set = e && e.set;
    if (!set || typeof set !== 'object' || !/^[A-Za-z0-9_:#.\-\/]{1,80}$/.test(k)) continue;
    const sel = `[data-studio-key="${k}"]`;
    for (const [st, pseudo] of Object.entries(UI_STATES)) {
      const o = set[st];
      if (!o || typeof o !== 'object') continue;
      if (okColor(o.background)) rules.push(`${sel}${pseudo}{background-color:${o.background}!important}`);
      if (okColor(o.color)) rules.push(`${sel}${pseudo},${sel}${pseudo} *{color:${o.color}!important}`);
    }
  }
  const el = doc.createElement('style');
  el.id = 'studio-ui-set';
  el.textContent = rules.join('\n');
  (doc.head || doc.documentElement).appendChild(el);
  return el;
}

/**
 * The normal look and the words of one element (`set`): see the top of the file. The fill (and the colour of a button,
 * whose text is itself) goes in the sheet as a plain rule, so the game's own :hover / :active rules, more specific,
 * still win while hovered or pressed; when the game's normal rule is more specific than that, on the element itself.
 * The colour of a text inside the element (a title card's <h1>) and the size go on that text.
 */
function setUi(el, k, set, sheet) {
  const part = uiTextPart(el);
  const rule = (prop, css, v) => {
    if (getComputedStyle(el)[prop] === cssColor(el, v)) return;
    sheet.textContent += `\n[data-studio-key="${k}"]{${css}:${v}}`;
    if (getComputedStyle(el)[prop] !== cssColor(el, v)) el.style[prop] = v;
  };
  if (part) {
    if (typeof set.text === 'string') {
      const n = uiTextNode(part);
      if (n) n.data = keepSpace(n.data, set.text.slice(0, 200));
    }
    if (isNum(set.fontSize) && set.fontSize > 0) part.style.fontSize = `${set.fontSize}px`;
    if (okColor(set.color)) {
      if (part === el) rule('color', 'color', set.color);
      else part.style.color = set.color;
    }
  }
  if (okColor(set.background)) rule('backgroundColor', 'background-color', set.background);
}

/** A colour as getComputedStyle writes it (to tell whether a rule took). */
function cssColor(el, c) {
  const probe = el.ownerDocument.createElement('i');
  probe.style.color = c;
  probe.style.display = 'none';
  el.ownerDocument.documentElement.appendChild(probe);
  const v = getComputedStyle(probe).color;
  probe.remove();
  return v;
}

/** The new words in the old text node's place, keeping its spaces around (the HTML's line breaks). */
function keepSpace(old, text) {
  const m = /^(\s*)[\s\S]*?(\s*)$/.exec(old);
  return (m ? m[1] : '') + text + (m ? m[2] : '');
}

/** The element's own non-blank text nodes (not inside its children). */
function ownText(el) {
  return Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.data.trim());
}

/**
 * The text the card's Text / Size / Colour change, shared with the editor (src/bridge/ui-extras.ts) so both pick the
 * same one: data-studio-text (on the element or inside it), else the first element, in page order, with words of its
 * own (a title card's <h1>, a button itself). null when there is none, or when that element mixes words with what the
 * game writes ("Glow <b>0</b> / 5": two text nodes around a value) — changing one piece of it would read wrong.
 * Never inside data-studio-value (a score: the game's to write).
 */
function uiTextPart(el) {
  const mark = el.matches('[data-studio-text]') ? el : el.querySelector('[data-studio-text]');
  const one = (e) => (ownText(e).length === 1 ? e : null);
  if (mark) return one(mark);
  const walk = (e) => {
    if (e.matches('[data-studio-value]')) return undefined;
    if (ownText(e).length) return e;
    for (const c of e.children) {
      const r = walk(c);
      if (r) return r;
    }
    return undefined;
  };
  const p = walk(el);
  return p ? one(p) : null;
}

/** The one text node of a uiTextPart(). */
function uiTextNode(part) {
  return ownText(part)[0] || null;
}

// Per element: the translate / scale its stylesheet gives (read once, before anything is added) and the offset now.
const UI_STATE = Symbol.for('game-studio.ui');

/**
 * Put a UI element `p` = [dx, dy] CSS px from where the game's CSS puts it, at scale `s` (1 = as the game draws it).
 * Shared with the editor's UI layer (src/adapters/ui), so the editor and the game agree to the pixel. false = the
 * game itself writes an inline translate / scale on this element (it moves it): left alone.
 * The size keeps the element's middle where it is: CSS `scale` grows the box around its transform-origin, and a title
 * centred with transform: translate(-50%, -50%) has its box shifted away from that origin, so it would walk. The
 * correction is worked out here, from the box as it is now, and never saved: `p` stays "how far the middle moved",
 * right on any window size. A ResizeObserver works it out again when the box changes (a hidden screen shown later,
 * a window resized), only for elements with a size of their own (s ≠ 1).
 */
function placeUi(el, p, s) {
  let st = el[UI_STATE];
  if (!st) {
    if (el.style.translate || el.style.scale) return false;
    const cs = getComputedStyle(el);
    st = el[UI_STATE] = { t: cssParts(cs.translate), s: cssParts(cs.scale), p: [0, 0], v: 1 };
  }
  st.p = [p[0], p[1]];
  st.v = s;
  const t = st.t, b = st.s ? st.s.map((x) => parseFloat(x) / (x.endsWith('%') ? 100 : 1)) : [1];
  const bx = b[0], by = b[1] === undefined ? bx : b[1];
  let x = p[0], y = p[1];
  if (s !== 1) {
    const cs = getComputedStyle(el);
    const m = /^matrix(3d)?\(([^)]+)\)/.exec(cs.transform);
    const v = m ? m[2].split(',').map(Number) : null;
    const [a, bb, c, d, e, f] = !v ? [1, 0, 0, 1, 0, 0] : m[1] ? [v[0], v[1], v[4], v[5], v[12], v[13]] : v;
    const o = (cs.transformOrigin || '').split(' ').map(parseFloat);
    const ux = (el.offsetWidth || 0) / 2 - (o[0] || 0), uy = (el.offsetHeight || 0) / 2 - (o[1] || 0);
    if (el.offsetWidth !== undefined && (m || cs.transform === 'none')) {
      x -= (s - 1) * bx * (a * ux + c * uy + e);
      y -= (s - 1) * by * (bb * ux + d * uy + f);
    }
    if (!st.ro && typeof ResizeObserver === 'function') (st.ro = new ResizeObserver(() => placeUi(el, st.p, st.v))).observe(el);
  }
  const none = !x && !y && s === 1;
  el.style.translate = none ? '' : t ? `calc(${t[0]} + ${x}px) calc(${t[1] || '0px'} + ${y}px)${t[2] ? ' ' + t[2] : ''}` : `${x}px ${y}px`;
  el.style.scale = s === 1 ? '' : st.s ? `${bx * s} ${by * s}${b[2] === undefined ? '' : ' ' + b[2]}` : String(s);
  return true;
}

/** The offset placeUi() last gave (p [0, 0], s 1 for an element it never touched). */
function uiOffset(el) {
  const st = el[UI_STATE];
  return st ? { p: st.p.slice(), s: st.v } : { p: [0, 0], s: 1 };
}

// "none" → null; "-50% 0px" / "calc(-50% + 4px) 2px" → its space-separated values (spaces inside one level of () kept).
function cssParts(v) {
  return !v || v === 'none' ? null : v.match(/(?:[^\s(]|\([^)]*\))+/g);
}

/** Apply one entry's p / r / t / s to obj; false (nothing changed) when a value is bad. */
function put(obj, e, n, three) {
  const p = e && e.p;
  const s = e && e.s;
  const okP = p === undefined || (Array.isArray(p) && p.length === n && p.every(isNum));
  const okR = e && (e.r === undefined || isNum(e.r)) && (e.t === undefined || (three && Array.isArray(e.t) && e.t.length === 2 && e.t.every(isNum)));
  const okS = s === undefined || (isNum(s) && s !== 0) || (Array.isArray(s) && s.length === n && s.every(isNum));
  if (!okP || !okR || !okS) return false;
  if (p) obj.position.set(p[0], p[1], p[2]);
  if (e.r !== undefined) {
    if (three) obj.rotation.y = e.r;
    else obj.rotation = e.r;
  }
  // 3D tilt (tipped forward / sideways in the editor): rotation.x and rotation.z, in the object's own Euler order.
  if (three && e.t !== undefined) {
    obj.rotation.x = e.t[0];
    obj.rotation.z = e.t[1];
  }
  if (s !== undefined) {
    if (Array.isArray(s)) obj.scale.set(s[0], s[1], s[2]);
    else if (three) obj.scale.setScalar(s);
    else obj.scale.set(s, s);
  }
  return true;
}

/** A copy that draws the same thing: three's clone (shares geometry and materials); Pixi: clone(), or a new sprite of the same texture. */
function copyOf(o, three) {
  try {
    if (three || typeof o.clone === 'function') return o.clone();
    return o.texture ? new o.constructor(o.texture) : null;
  } catch (e) {
    return null;
  }
}

function applyOrder(root, order, report) {
  const lists = [];
  for (const g of order) {
    const objs = g && Array.isArray(g.keys) ? g.keys.map((k) => [k, findByKey(root, k, false)]).filter((x) => x[1]) : [];
    const parent = objs.length && objs[0][1].parent;
    const mine = objs.filter((x) => x[1].parent === parent);
    if (parent && mine.length > 1) lists.push([parent, mine]);
  }
  for (const [, mine] of lists) for (const [k, o] of mine) if (!o.studioKey && (k.startsWith('path:') || k.includes('#'))) o.studioKey = k;
  for (const [parent, mine] of lists) {
    const slots = mine.map((x) => parent.getChildIndex(x[1])).sort((a, b) => a - b);
    for (const [, o] of mine) parent.removeChild(o);
    mine.forEach((x, i) => parent.addChildAt(x[1], slots[i]));
  }
  if (lists.length) report.applied.push('order');
}

/** Find the object for one key under root (exported for tests and for code that wants to check keys). */
function findByKey(root, key, three = !!(root && root.isObject3D)) {
  // The mark first, even for path keys: applyOrder stamps path keys as marks before reordering.
  const mark = (o) => (three ? o.userData && o.userData.studioKey : o.studioKey);
  let found = null;
  walk(root, (o) => {
    if (!found && mark(o) === key) found = o;
    return !found;
  });
  if (found) return found;
  if (key.startsWith('path:')) {
    let o = root;
    for (const i of key.slice(5).split('/')) {
      o = o && o.children && o.children[Number(i)];
      if (!o || !/^\d+$/.test(i)) return null;
    }
    return o;
  }

  // name#k: the k-th object with that name, counting only the outermost ones (a group named "tree"
  // that holds a mesh also named "tree" counts once, like the editor's "meaningful top node").
  const m = /^(.*)#(\d+)$/.exec(key);
  const name = m ? m[1] : key;
  let want = m ? Number(m[2]) : 1;
  walk(root, (o) => {
    if (found) return false;
    // Pixi: an object with a studioKey is known by that key, not its label (as in the editor).
    if (cleanName(three ? o.name : o.studioKey ? '' : o.label) === name) {
      if (--want === 0) found = o;
      return 'skip';
    }
    return true;
  });
  if (found || !three) return found;
  walk(root, (o) => {
    const u = o.userData;
    if (!found && u && (String(u.id) === key || cleanName(u.name) === key)) found = o;
    return !found;
  });
  return found;
}

// Depth-first, pre-order, root excluded. visit() returns false to stop, 'skip' to not descend.
function walk(root, visit) {
  const stack = (root.children || []).slice().reverse();
  while (stack.length) {
    const o = stack.pop();
    const r = visit(o);
    if (r === false) return;
    if (r !== 'skip' && o.children) for (let i = o.children.length - 1; i >= 0; i--) stack.push(o.children[i]);
  }
}

function isNum(v) {
  return typeof v === 'number' && isFinite(v);
}

function warn(msg) {
  console.warn('[studio] placement.json: ' + msg);
}

__def(__exports, "applyPlacement", () => applyPlacement);
__def(__exports, "stopMotion", () => stopMotion);
__def(__exports, "playMotion", () => playMotion);
__def(__exports, "cue", () => cue);
__def(__exports, "touch", () => touch);
__def(__exports, "setPlayer", () => setPlayer);
__def(__exports, "clipOf", () => clipOf);
__def(__exports, "whenOf", () => whenOf);
__def(__exports, "whensOf", () => whensOf);
__def(__exports, "resolveClip", () => resolveClip);
__def(__exports, "motionRunner", () => motionRunner);
__def(__exports, "clipAt", () => clipAt);
__def(__exports, "trackAt", () => trackAt);
__def(__exports, "handlesOf", () => handlesOf);
__def(__exports, "motionAt", () => motionAt);
__def(__exports, "levelOfCodeless", () => levelOfCodeless);
__def(__exports, "placementForLevel", () => placementForLevel);
__def(__exports, "uiTextPart", () => uiTextPart);
__def(__exports, "uiTextNode", () => uiTextNode);
__def(__exports, "placeUi", () => placeUi);
__def(__exports, "uiOffset", () => uiOffset);
__def(__exports, "findByKey", () => findByKey);
};
__defs[21] = function (__exports) {
'use strict';
// ../adapters/ui/adapter.js

// The built-in DOM UI port (UI stage 1, 2026-10-19): the game's HTML UI — a title card, a score, a button — as a
// Port2D, so the editor's UI layer moves and resizes it with the same handles, finger maths and undo as a 2D game.
//
// Only elements the game marked with data-studio-key="title-logo" are listed (never "every div": a page has
// hundreds, and the AI must find each one again in the code by that key). Left out: data-studio="false" (on the
// element or a parent), elements not drawn (display: none, not in the page), and elements the game itself gives an
// inline translate / scale (it moves them; the editor would fight it — the AI wraps them in a box, SKILL.md §5).
//
// Position and size go through the CSS `translate` / `scale` properties, never left / top / transform: a title
// centred with transform: translate(-50%, -50%) (Lantern Cove's .hint does this) stays centred, the game's layout is
// untouched, and taking the values away puts the element back exactly. The maths lives in the loader (placeUi):
// the editor and the game place the element the same way, to the pixel.
//
// Pose: p = [dx, dy] CSS px from where the game's CSS puts it, s = scale (1 = as drawn), r is always 0 (no turning
// UI in stage 1: rotatable false). parentToScreen maps that offset space to the screen: origin = where the middle
// of the element would be at offset 0, one offset px = k screen px (k = the zoom of the parent, e.g. a HUD scaled to
// fit the window).
const { placeUi, uiOffset } = __require(20);

const KEY = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;
/** Scale bounds of a UI element: the same as placement.json `ui` (src/schema LIMITS.minUiScale / maxUiScale). */
const MIN_S = 0.1, MAX_S = 10;

/**
 * @param {Window} win the game page
 * @param {{ skip?: () => Set<string> }} [opts] keys another layer owns (the world's list: a DOM board game's pieces
 *   carry data-studio-key too, and they stay world objects)
 */
function createUiPort(win, opts = {}) {
  const doc = win.document;
  const told = new Set();
  const all = (key) => Array.from(doc.querySelectorAll('[data-studio-key]')).filter((el) => el.dataset.studioKey === key);
  const first = (key) => all(key).find((el) => el.getClientRects().length) || null;
  const usable = (el) => {
    const key = el.dataset.studioKey;
    if (!KEY.test(key) || el.closest('[data-studio="false"]')) return false;
    if (!el.getClientRects().length) return false;
    // The game writes its own inline translate / scale here (and placeUi never touched it): leave it to the game.
    if ((el.style.translate || el.style.scale) && !placedBefore(el)) {
      if (!told.has(key)) {
        told.add(key);
        console.info(`[studio] UI "${key}" is moved by the game itself (inline translate / scale): not listed. Wrap it in a box and mark the box.`);
      }
      return false;
    }
    return true;
  };
  const placedBefore = (el) => el[Symbol.for('game-studio.ui')] !== undefined;
  const label = (el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return (t || el.getAttribute('aria-label') || el.getAttribute('alt') || el.dataset.studioKey).slice(0, 40);
  };
  const kind = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button' || el.getAttribute('role') === 'button' || (tag === 'input' && /^(button|submit|reset)$/.test(el.type))) return 'button';
    if (tag === 'img' || tag === 'svg' || tag === 'picture' || tag === 'canvas' || tag === 'video') return 'image';
    return 'text';
  };
  // CSS animations (a blinking "Press start") keep running while the game's frames are held: paused while editing,
  // played again at the end (only the ones this paused).
  let paused = [];

  return {
    name: 'dom-ui',
    objects() {
      const skip = opts.skip ? opts.skip() : null;
      const seen = new Set();
      const out = [];
      for (const el of Array.from(doc.querySelectorAll('[data-studio-key]'))) {
        const key = el.dataset.studioKey;
        if (seen.has(key) || (skip && skip.has(key)) || !usable(el)) continue;
        seen.add(key);
        // The screen (UI stage 2, 2026-10-22): its container's data-studio-screen, saved with it (placement.json ui.screen).
        const screen = el.closest('[data-studio-screen]')?.dataset.studioScreen;
        out.push({ key, label: label(el), kinds: ['ui', kind(el)], rotatable: false, ...(screen && KEY.test(screen) ? { screen } : {}) });
      }
      return out;
    },
    get(key) {
      const el = first(key);
      if (!el) return null;
      const o = uiOffset(el);
      return { p: o.p, r: 0, s: o.s };
    },
    set(key, pose) {
      const raw = Array.isArray(pose.s) ? pose.s[0] : pose.s;
      const s = Math.min(MAX_S, Math.max(MIN_S, typeof raw === 'number' && Number.isFinite(raw) ? raw : uiOffset(first(key) || doc.body).s));
      const p = [Number(pose.p[0]) || 0, Number(pose.p[1]) || 0];
      for (const el of all(key)) placeUi(el, p, s);
    },
    parentToScreen(key) {
      const el = first(key);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const par = el.offsetParent || el.parentElement;
      let k = 1;
      if (par && par.offsetWidth) {
        const pr = par.getBoundingClientRect();
        k = pr.width / par.offsetWidth;
      }
      if (!Number.isFinite(k) || k <= 0) k = 1;
      const o = uiOffset(el);
      return [k, 0, 0, k, r.left + r.width / 2 - k * o.p[0], r.top + r.height / 2 - k * o.p[1]];
    },
    bounds(key) {
      const el = first(key);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    },
    // The page draws a DOM change itself.
    render() {},
    // No canvas: the 2D base's canvas crop is skipped (the list shows a kind icon, not a thumbnail).
    canvas: () => null,
    capture: async () => null,
    pause() {
      try {
        paused = doc.getAnimations().filter((a) => a.playState === 'running');
        for (const a of paused) a.pause();
      } catch {
        paused = [];
      }
    },
    resume() {
      for (const a of paused) {
        try {
          a.play();
        } catch {
          /* gone with its element */
        }
      }
      paused = [];
    },
  };
}

__def(__exports, "createUiPort", () => createUiPort);
};
__defs[22] = function (__exports) {
'use strict';
// ../adapters/ui/index.ts

// The built-in DOM UI adapter as the bridge sees it (UI stage 1, 2026-10-19): the port in adapter.js through the
// same 2D base as every 2D game (adapterFromPort2D: picking, finger offset, handles, undo-exact setPose). Kind
// 'dom-ui'; no turning (the port lists every element rotatable: false). Resizing keeps the element's middle where it
// is — done where the element is placed (the loader's placeUi, shared with the game), not here, so the saved offset
// means the same on every window size. (A first version corrected the resize gesture here and saved the correction in
// `p`: reopened in a window of another size, a title centred with translate(-50%, -50%) and grown to 121 % came back
// 7.6 px off — its box had another height there. test/studio-ui-layer.browser.mjs keeps it.)
// The UI seat (CONTRACT.md §1.1): the bridge asks the game's own studio.registerUI() ports first, then this one.
                                                               
                                                
const { adapterFromPort2D } = __require(19);
const { createUiPort } = __require(21);

/** A UI-seat adapter from any Port2D (the built-in DOM one, or a game's registerUI port). */
function uiAdapterFromPort(port        , core      , win        )                {
  return adapterFromPort2D(port, core, win);
}

/**
 * The built-in DOM UI adapter, or null when the page has no usable [data-studio-key] (then the bridge and the editor
 * behave exactly as before UI stage 1). `skip`: keys the world adapter already lists (a DOM board game's pieces).
 */
function findDomUi(core      , win        , skip                    )                       {
  if (!win.document.querySelector('[data-studio-key]')) return null;
  const port = createUiPort(win, { skip })          ;
  if (!port.objects().length) return null;
  return uiAdapterFromPort(port, core, win);
}

__def(__exports, "uiAdapterFromPort", () => uiAdapterFromPort);
__def(__exports, "findDomUi", () => findDomUi);
};
__defs[23] = function (__exports) {
'use strict';
// selfcheck.ts

// Adapter self-check.
//
// Most adapters will be written by the user's AI agent for one specific game.
// A wrong adapter fails in quiet ways ("nothing can be selected", "the handle
// moves but the picture does not"), which a person cannot diagnose. So right
// after an adapter is found the bridge runs a few cheap tests on one object,
// puts it back exactly, and reports which promise is broken. The shell shows
// the result; the host hands it to the AI (local: .studio/check.md).
const { KEY_RE } = __require(13);
                                             

                                               

/** Largest visible canvas: the one the game most likely draws into. */
function mainCanvas(doc          )                           {
  let best                           = null;
  let area = 0;
  for (const c of Array.from(doc.querySelectorAll('canvas'))) {
    if (c.dataset.studio === 'ui') continue;
    const r = c.getBoundingClientRect();
    const a = r.width * r.height;
    if (a > area) {
      area = a;
      best = c;
    }
  }
  return best;
}

                                                          

/**
 * What the canvas shows inside `box` (CSS px of the game's page; null = the whole canvas), as RGBA pixels at the
 * canvas's own resolution, scaled down only when the box is larger than SNAP px a side.
 *
 * WHY a box and not the whole picture (Ive review N1 / W1-5, 2026-10-17): this used to shrink the whole canvas to
 * 32×32 and compare hashes. In the editor's camera on a phone (390–400 px wide, the world zoomed out) a 40 px test
 * move of a small object is ~10 screen px, about a third of one of those 32 cells, and the shrink (bilinear, no
 * mipmaps) samples only a few source pixels per cell, so the move vanished. Our own Firefly Ruins then showed
 * "This game's adapter needs a fix" on phones and in the 400 px side window. Cropping around the object keeps
 * its pixels, so any real change shows.
 *
 * Read right after render() in the same task: WebGL without preserveDrawingBuffer is still readable then.
 */
const SNAP = 96;
function snapshot(win        , canvas                          , box            )                           {
  if (!canvas || !canvas.width || !canvas.height) return null;
  try {
    const cr = canvas.getBoundingClientRect();
    if (!(cr.width > 0 && cr.height > 0)) return null;
    const kx = canvas.width / cr.width, ky = canvas.height / cr.height;
    let sx = 0, sy = 0, sw = canvas.width, sh = canvas.height;
    if (box) {
      const x0 = Math.max(cr.left, box.x), y0 = Math.max(cr.top, box.y);
      const x1 = Math.min(cr.right, box.x + box.w), y1 = Math.min(cr.bottom, box.y + box.h);
      // The object is off the canvas: fall back to the whole picture rather than read nothing.
      if (x1 - x0 >= 2 && y1 - y0 >= 2) {
        sx = Math.floor((x0 - cr.left) * kx);
        sy = Math.floor((y0 - cr.top) * ky);
        sw = Math.max(1, Math.ceil((x1 - x0) * kx));
        sh = Math.max(1, Math.ceil((y1 - y0) * ky));
      }
    }
    const f = Math.min(1, SNAP / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * f)), h = Math.max(1, Math.round(sh * f));
    const c = win.document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(canvas, sx, sy, sw, sh, 0, 0, w, h);
    return g.getImageData(0, 0, w, h).data;
  } catch {
    return null; // tainted canvas (cross-origin image without CORS): cannot read
  }
}

/** One colour everywhere: we could not read what was drawn (WebGL cleared once presented), not a real picture. */
function uniform(d                   )          {
  for (let i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) return false;
  return true;
}

/**
 * Did the picture change? Pixels whose colour moved by more than 4 (of 255) in any channel. One is enough: the
 * game is frozen while editing, so two draws of the same scene are the same pixels; 4 only absorbs GPU dithering.
 */
function changed(a                   , b                   )          {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]  - b[i] ) > 4) return true;
  return false;
}

/** The two boxes together, a few px larger (an outline or soft edge drawn just outside the box counts too). */
function union(a                 , b                 )             {
  if (!a || !b) return a || b ? pad(a || b ) : null;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return pad({ x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y });
}
const pad = (r     )      => ({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 });
/** Without a box from the adapter: a square of its size around the pivot. */
const boxOf = (a                                     )                  =>
  !a ? undefined : a.rect || { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };

/** Wait for two real frames: adapters that repaint from their own loop draw by then. */
const frames = (core      ) => new Promise      ((r) => core.time.raf(() => core.time.raf(() => r())));

const near = (a                      , b                      , eps        ) =>
  !!a && !!b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i] ) <= eps);

/** The checks that move the sample object and read it back: a game still settling can spoil them once. */
const MOVING_CHECKS = new Set(['pose-roundtrip', 'screen-changes', 'anchor-follows', 'restored']);
/** How long the editor waits before the second look (bridge/editor.ts): 1.2 s ≈ a slow first second of a game. */
const SECOND_LOOK_MS = 1200;

/**
 * Is a failed check worth running once more before telling anyone (polish-1022, 2026-10-22)? Only when everything
 * that failed is a moving check (above): "no adapter", "no objects" or bad keys do not change by waiting.
 */
function worthASecondLook(res                 )          {
  const failed = res.checks.filter((c) => !c.ok);
  return failed.length > 0 && failed.every((c) => MOVING_CHECKS.has(c.id));
}

async function runSelfCheck(adapter                      , core      , win        )                           {
  const checks          = [];
  const res                  = { ok: false, kind: adapter ? adapter.kind : null, checks };
  if (!adapter) {
    checks.push({ id: 'adapter-found', ok: false, detail: 'No adapter answered. three.js games are found automatically; other engines need .studio/adapter.js calling studio.register2D(...).' });
    return res;
  }
  checks.push({ id: 'adapter-found', ok: true, detail: `${adapter.kind} ${adapter.version || ''}`.trim() });

  let items                                    = [];
  try {
    items = adapter.list();
  } catch (e) {
    checks.push({ id: 'has-objects', ok: false, detail: `list() threw: ${(e         ).message}` });
    return res;
  }
  checks.push({ id: 'has-objects', ok: items.length > 0, detail: `${items.length} object(s)` });
  const unnamed = items.filter((it) => it.unstable).map((it) => it.key);
  if (unnamed.length) {
    res.unnamed = unnamed.slice(0, 50);
    res.unnamedCount = unnamed.length;
  }

  const seen = new Set        ();
  const bad = items.filter((it) => {
    const dup = seen.has(it.key);
    seen.add(it.key);
    return dup || !KEY_RE.test(it.key);
  });
  checks.push({ id: 'keys-valid', ok: bad.length === 0, detail: bad.length ? `bad or duplicate keys: ${bad.slice(0, 5).map((b) => JSON.stringify(b.key)).join(', ')}` : undefined });

  // Pick an object that is on screen and not huge (a ground plane moved by a
  // few px may not change a 32×32 fingerprint in a meaningful way). On screen =
  // its centre inside the window: `visible` alone also allows a margin of a
  // screen round it, and a 2D game opened on its own picture on a phone (port2d
  // home(), the second design review's ⑩, 2026-10-19) has objects just off the
  // edge — Firefly Ruins' bell — whose move draws nothing, so the check failed
  // on our own sample. Objects with the centre off screen are the fallback.
  const inView = (it                        ) => {
    const a = adapter.anchor(it.key);
    return !!a && a.visible && a.size > 4 && a.center[0] >= 0 && a.center[1] >= 0 && a.center[0] <= win.innerWidth && a.center[1] <= win.innerHeight;
  };
  const sample = items.find(inView) || items.find((it) => {
    const a = adapter.anchor(it.key);
    return a && a.visible && a.size > 4;
  }) || items[0];
  if (!sample) {
    for (const id of ['pose-roundtrip', 'screen-changes', 'anchor-follows', 'restored']         ) checks.push({ id, ok: false, skipped: true });
    res.ok = false;
    return res;
  }
  res.sample = sample.key;

  const canvas = mainCanvas(win.document);
  const before = clonePose(sample.pose);
  const a0 = adapter.anchor(sample.key);
  // Draw, let loop-driven adapters draw too, then draw once more and read in the same task (see snapshot()).
  const drawn = async () => {
    adapter.render();
    await frames(core);
    adapter.render();
  };
  try {
    // Move by a visible amount: 2D 40 px; 3D a fifth of the object's size on screen
    // is not known in world units, so use 0.5 units plus 10% of |p|.
    const delta = adapter.dim === '2d' ? 40 : 0.5 + Math.abs(before.p[0] || 0) * 0.1;
    const moveBy = (d        ) => {
      const moved = clonePose(before);
      moved.p[0] = (moved.p[0] || 0) + d;
      return { moved, after: adapter.setPose(sample.key, moved) };
    };
    let { moved, after } = moveBy(delta);
    let a1 = adapter.anchor(sample.key);
    // Both pictures are read around where the object was and where it went, after the move (the box is known then).
    const box = () => union(boxOf(a0), boxOf(a1));
    const pictures = async () => {
      adapter.setPose(sample.key, before);
      await drawn();
      const p0 = snapshot(win, canvas, box());
      adapter.setPose(sample.key, moved);
      await drawn();
      return [p0, snapshot(win, canvas, box())]         ;
    };
    let [fp0, fp1] = await pictures();
    // Moved behind something (Firefly Ruins' bell slides behind the giant head when moved right), the picture can
    // barely change. Try the other way before saying "nothing changed on screen".
    if (fp0 && fp1 && !changed(fp0, fp1)) {
      ({ moved, after } = moveBy(-delta));
      a1 = adapter.anchor(sample.key);
      [fp0, fp1] = await pictures();
    }
    const back = adapter.list().find((i) => i.key === sample.key)?.pose;
    const eps = adapter.dim === '2d' ? 0.11 : 0.0011;
    checks.push({
      id: 'pose-roundtrip',
      ok: !!after && near(back?.p, moved.p, eps),
      detail: after ? `asked ${fmt(moved.p)}, read back ${fmt(back?.p)}` : 'setPose returned null for a listed key',
    });
    if (!fp0 || !fp1 || (uniform(fp0) && uniform(fp1))) checks.push({ id: 'screen-changes', ok: true, skipped: true, detail: 'canvas pixels not readable here (no canvas, a cross-origin image, or WebGL cleared after drawing)' });
    else checks.push({ id: 'screen-changes', ok: changed(fp0, fp1), detail: changed(fp0, fp1) ? undefined : 'render() after setPose drew the same picture around the object: set() may write a copy, or render() does not draw' });
    const followed = !!a0 && !!a1 && Math.hypot(a1.center[0] - a0.center[0], a1.center[1] - a0.center[1]) > 0.5;
    checks.push({ id: 'anchor-follows', ok: followed, detail: followed ? undefined : 'anchor()/bounds() did not move with the object (handles would be left behind)' });
  } catch (e) {
    checks.push({ id: 'pose-roundtrip', ok: false, detail: `threw: ${(e         ).message}` });
  } finally {
    try {
      adapter.setPose(sample.key, before);
      adapter.render();
      const end = adapter.list().find((i) => i.key === sample.key)?.pose;
      checks.push({ id: 'restored', ok: near(end?.p, before.p, 1e-6), detail: near(end?.p, before.p, 1e-6) ? undefined : `left at ${fmt(end?.p)} instead of ${fmt(before.p)}` });
    } catch (e) {
      checks.push({ id: 'restored', ok: false, detail: `threw: ${(e         ).message}` });
    }
  }
  res.ok = checks.every((c) => c.ok);
  return res;
}

function clonePose(p      )       {
  return { p: p.p.slice(), r: p.r, s: Array.isArray(p.s) ? p.s.slice() : p.s };
}
function fmt(p                      )         {
  return p ? `[${p.map((v) => Math.round(v * 1000) / 1000).join(', ')}]` : 'nothing';
}

__def(__exports, "mainCanvas", () => mainCanvas);
__def(__exports, "SECOND_LOOK_MS", () => SECOND_LOOK_MS);
__def(__exports, "worthASecondLook", () => worthASecondLook);
__def(__exports, "runSelfCheck", () => runSelfCheck);
};
__defs[24] = function (__exports) {
'use strict';
// ../core/rules.ts

// Game rules: fit the editor to one game without touching the editor or the
// adapter (CONTRACT.md §7).
//
// `.studio/studio.json` (plain settings the AI writes) and the optional
// `constrain()` from `.studio/tools.js` sit between the bridge and the
// adapter, as one more StudioAdapter. So snapping, bounds and per-kind rules
// work the same for three.js, PixiJS, Phaser, a hand-written canvas game or
// anything else, and the adapters stay unaware of them.
//
// What is constrained: edits made with handles, keys and game tools (drag,
// rotate, scale, nudgeY). What is not: setPose() — undo/redo and loading a
// saved file must restore poses exactly, even if the rules changed since.
                                                                                                               

const DEG = Math.PI / 180;

                              
                            
                       
 

/** "crate*" → /^crate.*$/ (only * and ? are special). */
function globToRe(glob        )         {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`, 'i');
}

                             
                  
                  
                      
                  
                 
                        
                    
                    
                  
                 
 

/** All rules whose glob matches the key, label or group, merged in order (later wins). */
function rulesFor(item                                       , config                   )             {
  const out             = { hidden: false, locked: false, lockHeight: false, rotate: true, scale: true, grid: config?.snap?.grid, angle: config?.snap?.angle };
  for (const r of (config?.rules || [])              ) {
    if (!r || typeof r.match !== 'string') continue;
    const re = globToRe(r.match);
    if (!re.test(item.key) && !re.test(item.label || '') && !(item.group && re.test(item.group))) continue;
    if (typeof r.hidden === 'boolean') out.hidden = r.hidden;
    if (typeof r.locked === 'boolean') out.locked = r.locked;
    if (typeof r.lockHeight === 'boolean') out.lockHeight = r.lockHeight;
    if (typeof r.rotate === 'boolean') out.rotate = r.rotate;
    if (typeof r.scale === 'boolean') out.scale = r.scale;
    else if (r.scale && typeof r.scale === 'object') {
      out.scale = true;
      if (typeof r.scale.default === 'number' && r.scale.default > 0) out.scaleDefault = r.scale.default;
      if (typeof r.scale.min === 'number' && r.scale.min > 0) out.scaleMin = r.scale.min;
      if (typeof r.scale.max === 'number' && r.scale.max > 0) out.scaleMax = r.scale.max;
    }
    if (r.snap && typeof r.snap === 'object') {
      if (r.snap.grid !== undefined) out.grid = r.snap.grid;
      if (r.snap.angle !== undefined) out.angle = r.snap.angle;
    }
  }
  return out;
}

const roundTo = (v        , step        ) => (step > 0 ? Number((Math.round(v / step) * step).toFixed(6)) : v);
const wrap = (a        ) => {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
};

/**
 * Snap a position to the grid and clamp it to the bounds.
 * 3D: a single grid number applies to x and z (heights stay free); [x, y, z]
 * sets each axis. 2D: a single number applies to x and y.
 */
function placeOnGrid(p          , grid                      , bounds                                  , dim             )           {
  const out = p.slice();
  if (grid !== undefined) {
    const steps = Array.isArray(grid) ? grid : dim === '3d' ? [grid, 0, grid] : [grid, grid];
    for (let i = 0; i < out.length; i++) {
      const st = Number(steps[i]);
      if (Number.isFinite(st) && st > 0) out[i] = roundTo(out[i] , st);
    }
  }
  if (bounds && Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
    for (let i = 0; i < out.length; i++) {
      const lo = bounds.min[i], hi = bounds.max[i];
      if (typeof lo === 'number' && out[i]  < lo) out[i] = lo;
      if (typeof hi === 'number' && out[i]  > hi) out[i] = hi;
    }
  }
  return out;
}

const samePose = (a      , b      ) => JSON.stringify(a) === JSON.stringify(b);

function withRules(inner               , holder             )                {
  // Raw (unsnapped) angle per object while it is being turned, so small
  // finger moves add up instead of being swallowed by the angle snap.
  const rawR = new Map                ();
  let cache = new Map              ();

  const refresh = () => {
    cache = new Map(inner.list().map((i) => [i.key, i]));
    return cache;
  };
  const itemOf = (key        ) => cache.get(key) || refresh().get(key);
  const ruleOf = (key        ) => {
    const it = itemOf(key);
    return it ? rulesFor(it, holder.config) : null;
  };
  const decorate = (list        )         => {
    cache = new Map(list.map((i) => [i.key, i]));
    const out         = [];
    for (const it of list) {
      const r = rulesFor(it, holder.config);
      if (r.hidden) continue;
      out.push({
        ...it,
        rotatable: it.rotatable && r.rotate && !r.locked,
        scalable: it.scalable && r.scale && !r.locked,
        movable: it.movable !== false && !r.locked,
        liftable: it.liftable !== false && !r.lockHeight && !r.locked,
        defaultScale: r.scaleDefault ?? it.defaultScale,
      });
    }
    return out;
  };
  const current = (key        )              => inner.anchor(key)?.pose ?? itemOf(key)?.pose ?? null;

  /** Grid, bounds, then the game's own constrain(); writes back only when something changed. */
  const fix = (key        , pose      , moved         )       => {
    const r = ruleOf(key);
    let next       = { ...pose, p: pose.p.slice() };
    if (moved) next.p = placeOnGrid(next.p, r?.grid, holder.config?.bounds, inner.dim);
    else next.p = placeOnGrid(next.p, undefined, holder.config?.bounds, inner.dim);
    const item = itemOf(key);
    for (const e of holder.ext) {
      if (e.constrain && item) {
        try {
          const c = e.constrain(key, next, item);
          if (c && Array.isArray(c.p)) next = c;
        } catch (err) {
          console.warn('[studio] constrain() failed:', err);
        }
      }
    }
    if (samePose(next, pose)) return pose;
    return inner.setPose(key, next) || pose;
  };

  const ruled                = {
    ...inner,
    list: () => decorate(inner.list()),
    begin: () => decorate(inner.begin()),
    pickNear(x, y, radius) {
      return inner.pickNear(x, y, radius).filter((k) => !ruleOf(k)?.hidden);
    },
    grab(key, x, y) {
      const r = ruleOf(key);
      if (!r || r.locked || r.hidden) return false;
      rawR.delete(key);
      return inner.grab(key, x, y);
    },
    drag(key, x, y) {
      const r = ruleOf(key);
      if (!r || r.locked) return current(key) ;
      const before = r.lockHeight ? current(key) : null;
      let after = inner.drag(key, x, y);
      // Snap to surfaces (bridge/snap.ts) moves the height with the ground under it: not for a height the game holds.
      if (before && after.p[1] !== before.p[1]) after = inner.setPose(key, { ...after, p: [after.p[0] , before.p[1] , after.p[2] ] }) || after;
      return fix(key, after, true);
    },
    rotate(key, d) {
      const r = ruleOf(key);
      const before = current(key);
      if (!r || !before || r.locked || !r.rotate) return before ;
      const b = before.r ?? 0;
      const after = inner.rotate(key, d);
      const step = (r.angle ?? 0) * DEG;
      if (!(step > 0)) return fix(key, after, false);
      // Keep accumulating the unsnapped angle; restart from the object's
      // angle when it no longer matches (undo, another gesture).
      let raw = rawR.get(key);
      if (raw === undefined || Math.abs(wrap(roundTo(raw, step) - b)) > 1e-6) raw = b;
      raw += wrap((after.r ?? 0) - b);
      rawR.set(key, raw);
      const target = wrap(roundTo(raw, step));
      const snapped = Math.abs(wrap(target - (after.r ?? 0))) > 1e-9 ? inner.setPose(key, { ...after, r: target }) || after : after;
      return fix(key, snapped, false);
    },
    // Turning around another axis, or around the box middle (3D): blocked where
    // turning is (locked, rotate: false). A game with an angle step keeps the
    // snapped vertical turn of rotate() for the y axis.
    turn: inner.turn ? (key, d, axis) => {
      const r = ruleOf(key);
      const before = current(key);
      if (!r || !before || r.locked || !r.rotate) return before ;
      if (axis === 'y' && (r.angle ?? 0) > 0) return ruled.rotate(key, d);
      return fix(key, inner.turn (key, d, axis), false);
    } : undefined,
    scale(key, f) {
      const r = ruleOf(key);
      const before = current(key);
      if (!r || !before || r.locked || !r.scale) return before ;
      const after = inner.scale(key, f);
      const s0 = Array.isArray(after.s) ? after.s[0] ?? 1 : after.s ?? 1;
      let s1 = s0;
      if (r.scaleMin !== undefined && s1 < r.scaleMin) s1 = r.scaleMin;
      if (r.scaleMax !== undefined && s1 > r.scaleMax) s1 = r.scaleMax;
      if (s1 === s0) return fix(key, after, false);
      const k = s1 / (s0 || 1);
      const s = Array.isArray(after.s) ? after.s.map((v) => v * k) : s1;
      return fix(key, inner.setPose(key, { ...after, s }) || after, false);
    },
    setPose(key, pose) {
      rawR.delete(key);
      return inner.setPose(key, pose);
    },
    view: inner.view,
  };
  if (inner.drop) {
    // Drop to floor (End) changes the height only: blocked where the height is (locked, lockHeight).
    ruled.drop = (key, skip) => {
      const r = ruleOf(key);
      const before = current(key);
      if (!r || !before || r.locked || r.lockHeight) return before ;
      return fix(key, inner.drop (key, skip), true);
    };
  }
  if (inner.nudgeY) {
    ruled.nudgeY = (key, dy) => {
      const r = ruleOf(key);
      const before = current(key);
      if (!r || !before || r.locked || r.lockHeight) return before ;
      return fix(key, inner.nudgeY (key, dy), true);
    };
  }
  return ruled;
}

__def(__exports, "globToRe", () => globToRe);
__def(__exports, "rulesFor", () => rulesFor);
__def(__exports, "placeOnGrid", () => placeOnGrid);
__def(__exports, "withRules", () => withRules);
};
__defs[25] = function (__exports) {
'use strict';
// ../core/edits.ts

// Copy and delete, for every adapter (CONTRACT.md §1.8).
//
// This is one more StudioAdapter around the found adapter (under the game
// rules layer, so grid snapping and locks apply to copies too). It makes
// copies and deletions work the same way for every engine:
//
// - Adapters with clone() / remove() / putBack() (the built-in three.js
//   adapter, the shipped Pixi and canvas examples) make REAL copies in the
//   engine and really take objects out of the picture.
// - Adapters without them still get both, as stand-ins (WHY: an AI-written
//   adapter for Phaser or a home-made engine should not need new code before
//   the person can lay out five more trees; the AI adds the real objects to
//   the code afterwards anyway):
//     · a copy is a "ghost": an entry in the list with its own pose, drawn by
//       the bridge as a see-through picture of the original. Every operation
//       on it (anchor, drag, rotate, scale) is done by putting the ORIGINAL at
//       the ghost's pose for a moment, asking the adapter, and putting the
//       original back exactly (setPose is exact by contract). So the maths of
//       every adapter (2D parents, 3D ground planes) is reused unchanged.
//     · a deleted object is shrunk to 1/10000 of its size (out of sight, not
//       pickable) and left out of the list; undo sets its old pose back.
//
// Keys never change because of a copy or a deletion: copies get the key the
// shell chose, and deleted objects stay in the engine (hidden) so the
// numbering of the others (tree#2, path:0/3) does not shift while editing.
                                                                        

/** Scale used to make a deleted object vanish when the adapter has no remove(). */
const SHRINK = 1e-4;

                 
                                                                                                      
              
                                                     
               
             
 

                   
                                   
                                      
              
 

                                                     
     
                                                                          
                                                                         
                                                                            
                  
     
                                                             
                                       
                                        
                                                                
                                                            
                                                                     
                                
 

const noZ = (p      )       => {
  const out       = { p: p.p.slice() };
  if (p.r !== undefined) out.r = p.r;
  if (p.s !== undefined) out.s = Array.isArray(p.s) ? p.s.slice() : p.s;
  if (p.t !== undefined) out.t = [p.t[0], p.t[1]];
  return out;
};

function withEdits(inner               )               {
  const canEdit = typeof inner.clone === 'function' && typeof inner.remove === 'function' && typeof inner.putBack === 'function';
  const ghosts = new Map               ();
  const removed = new Map                 ();
  /** Every copy made this session, key → from (kept while deleted, for redo). */
  const made = new Map                ();

  const rawItem = (key        )                   => inner.list().find((i) => i.key === key);
  const poseNow = (key        )              => inner.anchor(key)?.pose ?? rawItem(key)?.pose ?? null;

  /**
   * Run `fn` with the real object `src` standing at `pose`, then put it back
   * exactly. A frame is drawn at both steps: adapters that read the screen
   * box from the page (DOM games: getBoundingClientRect) only see a move
   * after the game has drawn it, and the picture must end with the original
   * back in place (stand-ins only, so the extra frames cost nothing elsewhere).
   */
  function probe   (src        , pose      , fn         )    {
    const back = poseNow(src);
    inner.setPose(src, noZ(pose));
    redraw();
    try {
      return fn();
    } finally {
      if (back) inner.setPose(src, back);
      redraw();
    }
  }
  const redraw = () => {
    try {
      inner.render();
    } catch {
      /* the editor's own loop reports render errors */
    }
  };
  const ghostOf = (key        ) => (removed.has(key) ? undefined : ghosts.get(key));

  const list = ()         => {
    const raw = inner.list();
    const byKey = new Map(raw.map((i) => [i.key, i]));
    const out         = [];
    for (const it of raw) {
      if (removed.has(it.key)) continue;
      const from = made.get(it.key);
      out.push(from ? { ...it, copyOf: from } : it);
    }
    for (const [key, g] of ghosts) {
      if (removed.has(key)) continue;
      const src = byKey.get(g.src);
      if (!src) continue;
      out.push({ ...src, key, label: key, unstable: undefined, layer: undefined, backdrop: undefined, copyOf: g.from, ghost: true, pose: noZ(g.pose) });
    }
    return out;
  };

  const ghostAnchor = (g       )                => {
    const a = probe(g.src, g.pose, () => inner.anchor(g.src));
    return a ? { ...a, pose: noZ(g.pose), rect: a.rect ? { ...a.rect } : undefined } : null;
  };
  /** A pose-changing call on a ghost: done on its original standing at the ghost's pose. */
  const onGhost = (g       , fn                               )       => {
    const p = probe(g.src, g.pose, fn);
    if (p && Array.isArray(p.p)) g.pose = noZ(p);
    return noZ(g.pose);
  };

  const shrunk = (p      )       => ({ ...p, s: Array.isArray(p.s) ? p.s.map(() => SHRINK) : SHRINK });

  const edits               = {
    ...inner,
    list,
    begin: () => {
      inner.begin();
      return list();
    },
    pickNear(x, y, radius) {
      const keys = inner.pickNear(x, y, radius).filter((k) => !removed.has(k));
      // Stand-ins are drawn over the game, so they come first.
      const hits           = [];
      for (const [key, g] of ghosts) {
        if (removed.has(key)) continue;
        const r = ghostAnchor(g)?.rect;
        if (!r) continue;
        const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
        const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
        if (Math.hypot(dx, dy) <= radius) hits.push(key);
      }
      return [...hits.reverse(), ...keys];
    },
    anchor(key) {
      if (removed.has(key)) return null;
      const g = ghosts.get(key);
      return g ? ghostAnchor(g) : inner.anchor(key);
    },
    grab(key, x, y) {
      const g = ghostOf(key);
      if (g) return probe(g.src, g.pose, () => inner.grab(g.src, x, y));
      return !removed.has(key) && inner.grab(key, x, y);
    },
    drag(key, x, y) {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.drag(g.src, x, y)) : inner.drag(key, x, y);
    },
    rotate(key, d) {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.rotate(g.src, d)) : inner.rotate(key, d);
    },
    turn: inner.turn ? (key, d, axis) => {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.turn (g.src, d, axis)) : inner.turn (key, d, axis);
    } : undefined,
    foot: inner.foot ? (key) => (ghosts.has(key) || removed.has(key) ? null : inner.foot (key)) : undefined,
    middle: inner.middle ? (key) => (ghosts.has(key) || removed.has(key) ? null : inner.middle (key)) : undefined,
    coverage: inner.coverage ? (key) => (ghosts.has(key) || removed.has(key) ? null : inner.coverage (key)) : undefined,
    scale(key, f) {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.scale(g.src, f)) : inner.scale(key, f);
    },
    setPose(key, pose) {
      const g = ghosts.get(key);
      if (g) {
        g.pose = noZ(pose);
        return noZ(g.pose);
      }
      if (removed.get(key)?.how === 'shrink') return null;
      return inner.setPose(key, pose);
    },
    async capture(key, opts) {
      const g = ghosts.get(key);
      return inner.capture(g ? g.src : key, opts);
    },
    assetsOf(key) {
      const g = ghosts.get(key);
      return inner.assetsOf(g ? g.src : key);
    },
    view: inner.view,

    make(key, from) {
      if (made.has(key)) {
        // Redo of a copy: it still exists, deleted. Bring it back.
        if (removed.has(key)) edits.restoreKeys([key]);
        return { ghost: ghosts.has(key) };
      }
      if (removed.has(from)) return null;
      const g = ghosts.get(from);
      if (g) {
        // A copy of a stand-in is another stand-in of the same original.
        ghosts.set(key, { src: g.src, from, pose: noZ(g.pose) });
        made.set(key, from);
        return { ghost: true };
      }
      const pose = poseNow(from);
      if (!pose) return null;
      if (canEdit) {
        let ok = false;
        try {
          ok = !!inner.clone (from, key) && !!rawItem(key);
        } catch (e) {
          console.warn('[studio] clone() failed, showing a stand-in instead:', e);
        }
        if (ok) {
          made.set(key, from);
          return { ghost: false };
        }
      }
      ghosts.set(key, { src: from, from, pose: noZ(pose) });
      made.set(key, from);
      return { ghost: true };
    },

    removeKeys(keys) {
      const done           = [];
      for (const key of keys) {
        if (removed.has(key)) continue;
        if (ghosts.has(key)) {
          removed.set(key, { how: 'ghost' });
          done.push(key);
          continue;
        }
        const pose = poseNow(key);
        if (!pose) continue;
        let real = false;
        if (canEdit) {
          try {
            real = !!inner.remove (key);
          } catch (e) {
            console.warn('[studio] remove() failed, hiding the object instead:', e);
          }
        }
        if (real) removed.set(key, { how: 'real' });
        else {
          inner.setPose(key, shrunk(pose));
          removed.set(key, { how: 'shrink', pose });
        }
        done.push(key);
      }
      return done;
    },

    restoreKeys(keys) {
      const done           = [];
      for (const key of keys) {
        const r = removed.get(key);
        if (!r) continue;
        removed.delete(key);
        if (r.how === 'real') inner.putBack (key);
        else if (r.how === 'shrink' && r.pose) inner.setPose(key, r.pose);
        done.push(key);
      }
      return done;
    },

    ghosts() {
      const out                                                  = [];
      for (const [key, g] of ghosts) if (!removed.has(key)) out.push({ key, src: g.src, pose: noZ(g.pose) });
      return out;
    },
    copies: () => new Map(made),
  };
  // Snap to surfaces: a stand-in measures and drops as its original does (the same as nudgeY).
  if (inner.rest) {
    edits.rest = (key, skip) => {
      const g = ghostOf(key);
      return g ? probe(g.src, g.pose, () => inner.rest (g.src, skip)) : inner.rest (key, skip);
    };
  }
  if (inner.drop) {
    edits.drop = (key, skip) => {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.drop (g.src, skip)) : inner.drop (key, skip);
    };
  }
  if (inner.nudgeY) {
    edits.nudgeY = (key, dy) => {
      const g = ghostOf(key);
      return g ? onGhost(g, () => inner.nudgeY (g.src, dy)) : inner.nudgeY (key, dy);
    };
  }
  return edits;
}

__def(__exports, "withEdits", () => withEdits);
};
__defs[26] = function (__exports) {
'use strict';
// hold.ts

// Objects the editor holds still (Item.held), as one more StudioAdapter layer like the game rules (core/rules.ts).
//
// WHY (a hands-on try of 2026-10-19, items 4 and 5):
// - "Just trying things out, the road (the ground) ended up 16 m up, and I could save it like that." A 3D ground,
//   road or sky (Item.backdrop, adapters/three/ground.js) is held from the start: no tool works on it until the
//   person presses "Make movable" on its card or its menu — one more step, on purpose (`freed`).
// - "This game moves the pillars toward you every frame and puts them back at random, so a place I set is not
//   kept." What the game changed during the first moments of play (bridge/observe.ts) is held as 'game': only that
//   part is off (the game would undo it every frame) — its place, its height, its turn or its size — and the rest
//   stays editable: the values that last, as suggested in that try.
//
// WHY a layer and not only flags: the flags hide the tool strip's buttons, but steps also come from keys, the ⌘K
// list and game tools. Refusing grab / drag / nudgeY / rotate / scale here covers every way in at once. setPose
// stays open: undo, redo and loading a saved file must restore poses exactly (the same rule as core/rules.ts).
// The AI can always move a held object in the code; this only keeps a stray drag from doing it.
                                                                                

/** What the game itself changed while the editor watched (observe.ts): place (3D x / z), height (3D y), turn, size. */
                         
                
                
                
                
 

/**
 * The Height tool can act on it. Before 2026-10-19 that was "liftable and movable" everywhere (a locked object has
 * neither); a pillar the game slides along the road is not movable but keeps its height, so held 'game' looks at
 * `liftable` alone. Everything else keeps the old rule.
 */
const canLift = (i                                                         )          => !!i && i.liftable !== false && (i.movable !== false || i.held === 'game');

/**
 * Why a tool of the strip does not work on this object (null = it works). The strip shows the four tools for every
 * object, in the same places, and dims the ones that do not work (studio-tool-clear, 2026-10-23: "Move is gone from
 * the strip" — a hexagon the game slides had no Move button at all, and nothing said why; it looked broken). The
 * reason is said in one small line by the strip (handles.ts noteLine) — a press on a dimmed tool does nothing
 * (studio-move-plain, 2026-10-23: the menu it opened, and the slash across it, are gone). Move and Height on what the
 * game moves are never off: they set where it starts (holdItem).
 *   'game'   the game changes this part of it by itself (held 'game', `driven`)
 *   'ground' a ground / road / sky held still until "Make movable"
 *   'locked' the game's rules (.studio/studio.json) lock it
 *   'none'   the object cannot take this tool at all (a 2D thing that cannot turn, a rule that turns turning off)
 */
                                                           
const PART                                                         = { move: 'move', lift: 'lift', rotate: 'turn', scale: 'size' };
function offWhy(i                                                                                               , tool           )                {
  if (!i) return null;
  const works = tool === 'move' ? i.movable !== false : tool === 'lift' ? canLift(i) : tool === 'rotate' ? i.rotatable : i.scalable;
  if (works) return null;
  if (i.held === 'game' && i.driven?.includes(PART[tool])) return 'game';
  if (i.held === 'ground') return 'ground';
  return i.movable === false ? 'locked' : 'none';
}

                            
     
                                                                                                                  
                                                                                                               
     
                     
                                                                      
                              
                                                                                                                         
                       
 

const createHoldState = ()            => ({ freed: new Set(), driven: new Map(), placing: new Set() });

/** The item as the editor shows it: `held` set, and the tools it cannot take turned off. */
function holdItem(it      , s           , dim     )       {
  // A copy of something the game moves (⌘D, paste, Add to scene) is held like its original (e2e-016, 2026-10-20): a
  // pillar's copy was free to place, then the AI added it to the game's pillars and the game moved it every frame,
  // so the place set in the editor did not stick — the very thing the original's note warns about.
  // While the editor puts a fresh copy beside its original (`placing`) it is not held, or the copy of a falling star
  // stayed exactly on the star (studio-edit-ops canvas-stars).
  const d = s.driven.get(it.key) ?? (it.copyOf && !s.placing?.has(it.key) ? s.driven.get(it.copyOf) : undefined);
  // The game's own motion wins over "ground": a road the game scrolls is not kept where it is put either.
  if (d && (d.move || d.lift || d.turn || d.size)) {
    // Its place and height are where it starts (studio-move-plain, 2026-10-23: "the left of the strip was the plain
    // Move — now both ends look like Motion"): Move and Height work on it like on anything else, with no step first.
    // Before (studio-tool-clear) Move was dimmed with a slash and a press opened a menu whose "Set where it starts"
    // freed it (`freed`); the slashed Move read as a second Motion button. A runner moves things on from where they are
    // (z += speed · dt), so where it stands in the editor is where it starts — the loader puts it there before the
    // first frame — and the game takes it on from there. Its turn and size stay held: a game that spins or pulses a
    // thing mostly sets the angle / the size outright, so a start value there would not show. A game that sets the
    // place outright every frame wins all the same; the line under the strip and the card say so.
    const start = d.move || d.lift;
    return {
      ...it,
      held: 'game',
      driven: (['move', 'lift', 'turn', 'size']         ).filter((k) => d[k]),
      ...(start ? { startSpot: true } : {}),
      movable: it.movable !== false && (!d.move || start),
      liftable: it.liftable !== false && it.movable !== false && (!d.lift || start),
      rotatable: it.rotatable && !d.turn,
      scalable: it.scalable && !d.size,
    };
  }
  // 3D only: in 2D the ground already cannot be dragged (input.ts grabbable) and a 2D backdrop is about draw order.
  if (dim === '3d' && it.backdrop && !s.freed.has(it.key)) {
    return { ...it, held: 'ground', movable: false, liftable: false, rotatable: false, scalable: false };
  }
  return it;
}

/** The layer: list()/begin() carry `held`; edits of what is held do nothing (they return the current pose). */
function withHold(inner               , s           )                {
  let cache = new Map              ();
  const decorate = (list        ) => {
    const out = list.map((i) => holdItem(i, s, inner.dim));
    cache = new Map(out.map((i) => [i.key, i]));
    return out;
  };
  const itemOf = (key        ) => cache.get(key) ?? decorate(inner.list()).find((i) => i.key === key);
  const now = (key        )       => inner.anchor(key)?.pose ?? itemOf(key)?.pose ?? { p: [0, 0, 0] };
  const held                = {
    ...inner,
    list: () => decorate(inner.list()),
    begin: () => decorate(inner.begin()),
    grab: (key, x, y) => (itemOf(key)?.movable === false ? false : inner.grab(key, x, y)),
    drag: (key, x, y) => (itemOf(key)?.movable === false ? now(key) : inner.drag(key, x, y)),
    rotate: (key, d) => (itemOf(key)?.rotatable === false ? now(key) : inner.rotate(key, d)),
    scale: (key, f) => (itemOf(key)?.scalable === false ? now(key) : inner.scale(key, f)),
  };
  if (inner.nudgeY) {
    const nudge = inner.nudgeY.bind(inner);
    held.nudgeY = (key, dy) => (canLift(itemOf(key)) ? nudge(key, dy) : now(key));
  }
  // Drop to floor (End, snap to surfaces 2026-10-19) changes the height only, so it follows the Height tool's rule:
  // a held ground is not dropped onto whatever lies under it, a pillar the game slides still can be. Merged with
  // the hold layer when the branches were merged (2026-10-19) — without this the spread above let End move a held road.
  if (inner.drop) {
    const drop = inner.drop.bind(inner);
    held.drop = (key, skip) => (canLift(itemOf(key)) ? drop(key, skip) : now(key));
  }
  return held;
}

__def(__exports, "canLift", () => canLift);
__def(__exports, "offWhy", () => offWhy);
__def(__exports, "createHoldState", () => createHoldState);
__def(__exports, "holdItem", () => holdItem);
__def(__exports, "withHold", () => withHold);
};
__defs[27] = function (__exports) {
'use strict';
// group.ts

// Moving, turning and resizing several selected objects together
// (CONTRACT.md §1.8). Used by the handles (input.ts) and the keyboard /
// button steps (editor.ts).
//
// Every call works from the poses at the START of the gesture (absolute, not
// step by step), so a long drag never drifts and the end result is exactly
// "start + the total movement". The adapter (with the game rules) does all
// the engine maths; this file only decides where each member should go.
//
// Turning several has two ways since 2026-10-18 (play test: "no turn options with several picked"), the same two words
// as resizing: "together" (the arrangement turns as one piece round the middle of the selection) and "each in place"
// (each object turns on its own spot). 3D also on the three axes (turn / tilt forward / tilt sideways), as one object.
//
// WHY two ways:
// - 2D: in SCREEN space. Members can sit in different parents (a fence post
//   inside a scaled container next to a tree on the stage); moving each by
//   the same screen distance with grab()/drag() keeps them visually together
//   whatever their parents do.
// - 3D: in the PARENT space of the objects (the ground plane, metres). On a
//   perspective screen the same pixel distance is a different distance on the
//   ground for near and far objects, so the first member is moved with the
//   handle and the others get the same move in metres. Turning goes around the
//   middle of the group on the ground (vertical axis), as a turntable would.
                                                                                                  
const { canLift } = __require(26);

                               
                 
                                                           
                  
                          
                                                  
                                    
                                                                               
                           
                                                                              
                           
               
                           
     
                                                                              
                                                                            
                                                                          
     
                              
                                                                                                                  
                           
     
                                                                                                            
                                                                                          
     
                
 

/** How several turn: the axis (3D; y = upright) and together / each in place (the turn button's choices). */
                          
                  
                        
 

const wrap = (a        ) => {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
};
const clone = (p      )       => structuredClone(p);

/** One rectangle around every member (viewport px), and its middle; null when none is on screen. */
function groupAnchor(adapter               , keys          , primary        )                {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let visible = false;
  let pose              = null;
  for (const k of keys) {
    const a = adapter.anchor(k);
    if (!a) continue;
    if (k === primary) pose = a.pose;
    pose = pose || a.pose;
    visible = visible || a.visible;
    const r = a.rect || { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  if (!pose || !Number.isFinite(x0)) return null;
  return { center: [(x0 + x1) / 2, (y0 + y1) / 2], rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, size: Math.max(x1 - x0, y1 - y0), pose, visible };
}

function beginGroup(adapter               , keys          , primary        )                      {
  const items = new Map(adapter.list().map((i) => [i.key, i]));
  const live = keys.filter((k) => items.has(k));
  if (!live.length) return null;
  const s               = {
    keys: live,
    primary: live.includes(primary) ? primary : live[0] ,
    from: new Map(),
    at: new Map(),
    center: [0, 0],
    ground: [0, 0],
    minY: 0,
    items,
    feet: new Map(),
    footMid: null,
    mid: [0, 0, 0],
  };
  let gx0 = Infinity, gz0 = Infinity, gx1 = -Infinity, gz1 = -Infinity;
  let minY = Infinity;
  for (const k of live) {
    const a = adapter.anchor(k);
    const pose = a?.pose ?? items.get(k) .pose;
    s.from.set(k, clone(pose));
    if (a) s.at.set(k, [a.center[0], a.center[1]]);
    const [x = 0, y = 0, z = 0] = pose.p;
    gx0 = Math.min(gx0, x);
    gx1 = Math.max(gx1, x);
    gz0 = Math.min(gz0, z);
    gz1 = Math.max(gz1, z);
    minY = Math.min(minY, y);
  }
  s.ground = [(gx0 + gx1) / 2, (gz0 + gz1) / 2];
  s.minY = Number.isFinite(minY) ? minY : 0;
  if (adapter.dim === '3d') {
    // The box round the members' box middles (origins without adapter.middle), and its middle.
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const k of live) {
      const m = (adapter.middle && adapter.middle(k)) || s.from.get(k) .p;
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i] , m[i] ?? 0);
        hi[i] = Math.max(hi[i] , m[i] ?? 0);
      }
    }
    s.mid = lo.map((v, i) => (v + hi[i] ) / 2);
  }
  const ga = groupAnchor(adapter, live, s.primary);
  s.center = ga ? ga.center : [0, 0];
  for (const k of live) {
    const f = footOf(adapter, k);
    if (f) s.feet.set(k, f);
  }
  const fs = [...s.feet.values()];
  if (fs.length) {
    if (adapter.dim === '3d') {
      const xs = fs.map((f) => f[0] ), zs = fs.map((f) => f[2] );
      s.footMid = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.min(...fs.map((f) => f[1] )), (Math.min(...zs) + Math.max(...zs)) / 2];
    } else {
      const xs = fs.map((f) => f[0] );
      s.footMid = [(Math.min(...xs) + Math.max(...xs)) / 2, Math.max(...fs.map((f) => f[1] ))];
    }
  }
  return s;
}

/** A member's foot now: 3D parent space (adapter.foot), 2D the bottom middle of its screen box. */
function footOf(adapter               , k        )                  {
  if (adapter.dim === '3d') return adapter.foot ? adapter.foot(k) : null;
  const r = adapter.anchor(k)?.rect;
  return r ? [r.x + r.w / 2, r.y + r.h] : null;
}

const movable = (s              , k        ) => s.items.get(k)?.movable !== false;
const rotatable = (s              , k        ) => !!s.items.get(k)?.rotatable;
const scalable = (s              , k        ) => !!s.items.get(k)?.scalable;

/** Back to the start pose (the first thing every absolute step does). */
const reset = (adapter               , s              , k        ) => adapter.setPose(k, s.from.get(k) );

/** Put a member's pivot at screen point (x, y) (2D), starting from its start pose. */
function screenPlace(adapter               , s              , k        , x        , y        ) {
  const at = s.at.get(k);
  if (!at || !movable(s, k)) return;
  if (adapter.grab(k, at[0], at[1])) adapter.drag(k, x, y);
}

/** Everyone moved by (dx, dy) screen px from where the gesture started. */
function groupMove(adapter               , dim             , s              , dx        , dy        )       {
  if (dim === '2d') {
    for (const k of s.keys) {
      reset(adapter, s, k);
      const at = s.at.get(k);
      if (at) screenPlace(adapter, s, k, at[0] + dx, at[1] + dy);
    }
    return;
  }
  // 3D: the first movable member follows the handle; the others copy its move in metres.
  const lead = movable(s, s.primary) ? s.primary : s.keys.find((k) => movable(s, k));
  if (!lead) return;
  reset(adapter, s, lead);
  const at = s.at.get(lead);
  if (!at || !adapter.grab(lead, at[0], at[1])) return;
  const moved = adapter.drag(lead, at[0] + dx, at[1] + dy);
  const f = s.from.get(lead) ;
  const delta = moved.p.map((v, i) => v - (f.p[i] ?? 0));
  groupShift(adapter, s, delta, lead);
}

/** Everyone (but `skip`) moved by `delta` in parent space from the start. */
function groupShift(adapter               , s              , delta          , skip         )       {
  for (const k of s.keys) {
    if (k === skip) continue;
    const f = s.from.get(k) ;
    adapter.setPose(k, movable(s, k) ? { ...clone(f), p: f.p.map((v, i) => v + (delta[i] ?? 0)) } : f);
  }
}

                                              // x, y, z, w
const qmul = (a      , b      )       => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
/** A pose's turn as a quaternion: Euler x = t[0], y = r, z = t[1] in three.js's default XYZ order (Pose.t). */
function quatOf(p      )       {
  const [x = 0, z = 0] = p.t ?? [0, 0];
  const y = p.r ?? 0;
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3];
}
/** v turned by the unit quaternion q. */
function qapply(q      , v          )           {
  const [x, y, z, w] = q;
  const [vx = 0, vy = 0, vz = 0] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

/**
 * Turn the whole group by `d` radians as seen on screen (clockwise positive,
 * the same sign as `rotate()`). `way.mode`: `spread` (default) = round the
 * middle of the group, the places turn too; `inplace` = each member turns on
 * its own spot (2D: round its own pivot; 3D: adapter.turn, round the middle
 * of its box) and stays where it is. `way.axis` (3D, needs adapter.turn):
 * y = upright (default), x / z = tilt.
 */
function groupRotate(adapter               , dim             , s              , d        , way          = {})       {
  const mode = way.mode ?? 'spread';
  const axis           = dim === '3d' && adapter.turn ? way.axis ?? 'y' : 'y';
  if (mode === 'inplace') {
    for (const k of s.keys) {
      reset(adapter, s, k);
      if (!rotatable(s, k)) continue;
      if (dim === '3d' && adapter.turn) adapter.turn(k, d, axis);
      else adapter.rotate(k, d);
    }
    return;
  }
  if (axis !== 'y') {
    groupTilt(adapter, s, d, axis);
    return;
  }
  if (dim === '2d') {
    const [cx, cy] = s.center;
    const c = Math.cos(d), n = Math.sin(d);
    for (const k of s.keys) {
      reset(adapter, s, k);
      const at = s.at.get(k);
      if (at) {
        const rx = at[0] - cx, ry = at[1] - cy;
        // Screen y points down, so this matrix turns clockwise for d > 0.
        screenPlace(adapter, s, k, cx + c * rx - n * ry, cy + n * rx + c * ry);
      }
      if (rotatable(s, k)) adapter.rotate(k, d);
    }
    return;
  }
  // 3D: how much the objects' own yaw changes for this screen turn, measured
  // on one member (the edit camera decides the sign), then the positions turn
  // the same amount around the middle of the group.
  let yaw = -d;
  for (const k of s.keys) {
    if (!rotatable(s, k)) continue;
    reset(adapter, s, k);
    const r0 = s.from.get(k) .r ?? 0;
    yaw = wrap((adapter.rotate(k, d).r ?? r0) - r0);
    break;
  }
  const [gx, gz] = s.ground;
  const c = Math.cos(yaw), n = Math.sin(yaw);
  for (const k of s.keys) {
    const f = s.from.get(k) ;
    const [x = 0, y = 0, z = 0] = f.p;
    const rx = x - gx, rz = z - gz;
    // three.js rotation.y: (x, z) → (x cos + z sin, −x sin + z cos).
    const p = movable(s, k) ? [gx + rx * c + rz * n, y, gz - rx * n + rz * c] : f.p.slice();
    adapter.setPose(k, { ...clone(f), p });
    if (rotatable(s, k)) adapter.rotate(k, d);
  }
}

/**
 * 3D, together, on a tilt axis (x / z): the arrangement tips as one piece round the middle of the members' boxes
 * (s.mid). The adapter knows which way the camera makes "clockwise" (adapter.turn), so the turn is done once on the
 * first member that may turn and read back as a quaternion (its pose before and after, in its parent's space); the
 * places of all the members turn by that same quaternion round the middle, and each member that may turn gets the
 * same turn of its own (adapter.turn, then its place is set). Members in differently turned parents are not
 * handled (as the upright turn above).
 */
function groupTilt(adapter               , s              , d        , axis          )       {
  const lead = s.keys.find((k) => rotatable(s, k));
  if (!lead || !adapter.turn) return;
  reset(adapter, s, lead);
  const q0 = quatOf(s.from.get(lead) );
  const q1 = quatOf(adapter.turn(lead, d, axis));
  const dq = qmul(q1, [-q0[0], -q0[1], -q0[2], q0[3]]);
  const g = s.mid;
  for (const k of s.keys) {
    const f = s.from.get(k) ;
    reset(adapter, s, k);
    const turned = rotatable(s, k) ? adapter.turn(k, d, axis) : f;
    const p = movable(s, k) ? qapply(dq, f.p.map((v, i) => v - (g[i] ?? 0))).map((v, i) => v + (g[i] ?? 0)) : f.p.slice();
    adapter.setPose(k, { ...clone(turned), p });
  }
}

/**
 * Resize the whole group by `f` (> 0). Two ways (the size button's choice,
 * 2026-10-16; idea from the play tests of another placement editor):
 *   - `spread` ("together"): the gaps between the objects grow too, as if the
 *     whole arrangement were one picture being enlarged;
 *   - `inplace` ("each in place"): every object grows where it stands and the
 *     gaps stay.
 * Both keep each object's FOOT (the bottom middle of what it looks like) as
 * the fixed point, not its origin: an origin in the middle of a crate sank it
 * into the ground, and objects whose origins all sit at one point (built
 * where they are drawn) did not spread at all. Without a way to find feet
 * (a 3D adapter with no foot()), the old way: around the group's middle.
 */
function groupScale(adapter               , dim             , s              , f        , mode                 = 'spread')       {
  if (!(f > 0)) return;
  const mid = s.footMid;
  if (mid && s.feet.size) {
    for (const k of s.keys) {
      reset(adapter, s, k);
      const foot0 = s.feet.get(k);
      if (scalable(s, k)) adapter.scale(k, f);
      if (!foot0 || !movable(s, k)) continue;
      const now = footOf(adapter, k);
      if (!now) continue;
      // Where the foot should be: the same spot, or pushed out from the middle of the feet (heights too, so a
      // crate stacked on another stays on top of it as both grow).
      const target = mode === 'spread' ? foot0.map((v, i) => mid[i]  + f * (v - mid[i] )) : foot0;
      if (dim === '3d') {
        const cur = adapter.anchor(k)?.pose ?? s.from.get(k) ;
        adapter.setPose(k, { ...clone(cur), p: cur.p.map((v, i) => v + (target[i]  - now[i] )) });
      } else {
        const a = adapter.anchor(k);
        if (a && adapter.grab(k, a.center[0], a.center[1])) adapter.drag(k, a.center[0] + target[0]  - now[0] , a.center[1] + target[1]  - now[1] );
      }
    }
    return;
  }
  if (dim === '2d') {
    const [cx, cy] = s.center;
    for (const k of s.keys) {
      reset(adapter, s, k);
      const at = s.at.get(k);
      if (at && mode === 'spread') screenPlace(adapter, s, k, cx + f * (at[0] - cx), cy + f * (at[1] - cy));
      if (scalable(s, k)) adapter.scale(k, f);
    }
    return;
  }
  const [gx, gz] = s.ground;
  for (const k of s.keys) {
    const p0 = s.from.get(k) ;
    const [x = 0, y = 0, z = 0] = p0.p;
    const p = movable(s, k) && mode === 'spread' ? [gx + f * (x - gx), s.minY + f * (y - s.minY), gz + f * (z - gz)] : p0.p.slice();
    adapter.setPose(k, { ...clone(p0), p });
    if (scalable(s, k)) adapter.scale(k, f);
  }
}

/** 3D: raise / lower every member that may move up and down, by `dy` (incremental). */
function groupLift(adapter               , s              , dy        )       {
  if (!adapter.nudgeY) return;
  for (const k of s.keys) if (canLift(s.items.get(k))) adapter.nudgeY(k, dy);
}

/** Current poses of the members (after a step), with `from` when asked for. */
function groupPoses(adapter               , s              , withFrom         )                                                  {
  const out                                                  = [];
  for (const k of s.keys) {
    const pose = adapter.anchor(k)?.pose ?? s.from.get(k) ;
    out.push(withFrom ? { key: k, pose, from: s.from.get(k)  } : { key: k, pose });
  }
  return out;
}

__def(__exports, "groupAnchor", () => groupAnchor);
__def(__exports, "beginGroup", () => beginGroup);
__def(__exports, "groupMove", () => groupMove);
__def(__exports, "groupShift", () => groupShift);
__def(__exports, "groupRotate", () => groupRotate);
__def(__exports, "groupScale", () => groupScale);
__def(__exports, "groupLift", () => groupLift);
__def(__exports, "groupPoses", () => groupPoses);
};
__defs[28] = function (__exports) {
'use strict';
// game-tools.ts

// Game tools: small editor tools the AI writes for one game in
// `.studio/tools.js` (draw the race course, place along a path, paint tiles…).
//
// The editor stays the same; a tool only gets a narrow context (CONTRACT.md
// §7): read the objects, move one (undoable), turn screen points into scene
// points and back, draw on an overlay canvas, and say "my data changed".
// While a tool is on, pointer presses go to it first (after the handles);
// whatever it does not use still looks around / selects as usual.
const { TOOL_ID_RE } = __require(13);
                                             

                               
                                  
                         
                   
                                     
                                       
                   
                        
 

                           
                                    
                                    
                                                                       
                                       
                    
                
                                           
                  
                             
                   
                 
 

const text = (v                               , lang      )         =>
  v === undefined ? '' : typeof v === 'string' ? v : v[lang] || v.en || Object.values(v)[0] || '';

function createToolHost(d              )           {
  const tools = new Map                  ();
  const dirty = new Map                ();
  let current                  = null;
  let overlay                           = null;
  let g                                  = null;
  let needDraw = false;
  // Pose before a run of `hold` moves made by a tool (one undo step per run).
  const holdFrom = new Map              ();

  const ensureOverlay = () => {
    if (overlay) return;
    overlay = d.win.document.createElement('canvas');
    overlay.dataset.studio = 'ui';
    overlay.setAttribute('data-studio-ui', '');
    Object.assign(overlay.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: '2147483646' });
    (d.win.document.body || d.win.document.documentElement).appendChild(overlay);
    g = overlay.getContext('2d');
  };
  const sizeOverlay = () => {
    if (!overlay || !g) return;
    const dpr = d.win.devicePixelRatio || 1;
    const w = d.win.innerWidth, h = d.win.innerHeight;
    if (overlay.width !== Math.round(w * dpr) || overlay.height !== Math.round(h * dpr)) {
      overlay.width = Math.round(w * dpr);
      overlay.height = Math.round(h * dpr);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
  };

  const poseNow = (key        ) => d.adapter.anchor(key)?.pose ?? d.state.items.find((i) => i.key === key)?.pose ?? null;

  const ctx = ()                  => ({
    dim: d.adapter.dim,
    lang: d.lang(),
    items: () => d.state.items,
    selected: () => d.state.selected,
    select: (k) => d.select(k),
    setPose(key, pose, opts) {
      const from = holdFrom.get(key) ?? poseNow(key);
      const after = d.adapter.setPose(key, pose);
      if (!after || !from) return after;
      d.markDirty();
      if (opts?.hold) {
        if (!holdFrom.has(key)) holdFrom.set(key, from);
        d.post({ type: 'studio:placement/moved', key, pose: after, hold: true });
      } else {
        holdFrom.delete(key);
        d.post({ type: 'studio:placement/moved', key, pose: after, end: true, from });
      }
      return after;
    },
    pickNear: (x, y) => d.adapter.pickNear(x, y, 16),
    toGround: (x, y, gy) => d.adapter.toGround?.(x, y, gy) ?? null,
    toScreen: (p) => d.adapter.toScreen?.(p) ?? null,
    get overlay() {
      ensureOverlay();
      return g ;
    },
    changed() {
      if (current) dirty.set(current.id, (dirty.get(current.id) || 0) + 1);
      needDraw = true;
      if (current) postState(current.id);
    },
  });

  const postState = (id        ) => {
    const t = tools.get(id);
    const n = t?.dirty ? Number(t.dirty()) || 0 : dirty.get(id) || 0;
    d.post({ type: 'studio:tool/state', id, dirty: n, active: current?.id === id });
  };

  const info = ()                 =>
    [...tools.values()].map((t) => ({ id: t.id, label: text(t.label, d.lang()) || t.id, icon: t.icon ? String(t.icon).slice(0, 4) : undefined, hint: text(t.hint, d.lang()) || undefined }));

  return {
    register(list) {
      for (const t of list || []) {
        if (!t || typeof t.id !== 'string' || !TOOL_ID_RE.test(t.id)) {
          console.warn('[studio] game tool skipped: id must match', TOOL_ID_RE, t && t.id);
          continue;
        }
        tools.set(t.id, t);
      }
    },
    announce() {
      if (tools.size) d.post({ type: 'studio:tool/list', tools: info() });
    },
    activate(id) {
      const next = id ? tools.get(id) || null : null;
      if (current === next) return;
      const c = ctx();
      if (current) {
        try {
          current.deactivate?.(c);
        } catch (e) {
          console.warn('[studio] tool deactivate failed:', e);
        }
        const was = current.id;
        current = null;
        postState(was);
      }
      current = next;
      if (current) {
        ensureOverlay();
        try {
          current.activate?.(c);
        } catch (e) {
          console.warn('[studio] tool activate failed:', e);
        }
        postState(current.id);
      }
      needDraw = true;
    },
    pointer(e) {
      if (!current?.pointer) return false;
      try {
        return !!current.pointer(e, ctx());
      } catch (err) {
        console.warn('[studio] tool pointer failed:', err);
        return false;
      }
    },
    active: () => !!current,
    frame() {
      if (!overlay) return;
      sizeOverlay();
      if (!current?.draw) return;
      try {
        current.draw(ctx());
      } catch (e) {
        if (needDraw) console.warn('[studio] tool draw failed:', e);
      }
      needDraw = false;
    },
    restore(id, data) {
      const t = tools.get(id);
      try {
        t?.restore?.(data);
      } catch (e) {
        console.warn('[studio] tool restore failed:', e);
      }
      needDraw = true;
    },
    collect() {
      const items                                       = [];
      for (const [id, t] of tools) {
        const n = t.dirty ? Number(t.dirty()) || 0 : dirty.get(id) || 0;
        if (!n || !t.data) continue;
        try {
          items.push({ id, data: t.data() ?? null });
        } catch (e) {
          console.warn('[studio] tool data failed:', e);
        }
      }
      d.post({ type: 'studio:tool/data', items });
    },
    saved(ids) {
      for (const id of ids) {
        dirty.set(id, 0);
        try {
          tools.get(id)?.saved?.();
        } catch {
          /* the save itself succeeded */
        }
        postState(id);
      }
    },
    detach() {
      if (current) this.activate(null);
      overlay?.remove();
      overlay = null;
      g = null;
    },
  };
}

__def(__exports, "createToolHost", () => createToolHost);
};
__defs[29] = function (__exports) {
'use strict';
// ../core/keys.ts

// Keyboard steps shared by the bridge (keys pressed while the game frame has
// focus) and the shell (keys pressed in the side panel), so both feel the same.
                                                    

                                                                                                              

/**
 * Keyboard steps on the selected object. Screen-relative so they feel the
 * same in 2D and 3D: arrows move 10 px on screen (Shift: 1 px), Q/E rotate
 * 15° (Shift: 1°), PageUp/PageDown raise/lower (3D), +/- scale by 10%,
 * End drops onto the surface below (3D; Unreal's End, "snap to floor" — bridge/snap.ts; a Mac laptop: fn + →).
 */
function keyStep(key        , shift         , dim             )                {
  const px = shift ? 1 : 10;
  const deg = ((shift ? 1 : 15) * Math.PI) / 180;
  switch (key) {
    case 'ArrowLeft':
      return { op: 'move', dx: -px, dy: 0 };
    case 'ArrowRight':
      return { op: 'move', dx: px, dy: 0 };
    case 'ArrowUp':
      return { op: 'move', dx: 0, dy: -px };
    case 'ArrowDown':
      return { op: 'move', dx: 0, dy: px };
    case 'q':
    case 'Q':
      return { op: 'rotate', d: -deg };
    case 'e':
    case 'E':
      return { op: 'rotate', d: deg };
    case 'PageUp':
      return dim === '3d' ? { op: 'lift', d: shift ? 0.01 : 0.1 } : null;
    case 'PageDown':
      return dim === '3d' ? { op: 'lift', d: shift ? -0.01 : -0.1 } : null;
    case 'End':
      return dim === '3d' ? { op: 'drop' } : null;
    case '+':
    case '=':
      return { op: 'scale', d: shift ? 1.01 : 1.1 };
    case '-':
    case '_':
      return { op: 'scale', d: shift ? 1 / 1.01 : 1 / 1.1 };
    default:
      return null;
  }
}

__def(__exports, "keyStep", () => keyStep);
};
__defs[30] = function (__exports) {
'use strict';
// handles.ts

// What the editor draws on the game, inside the game page: the tool strip
// under the selected object, the outline round the selection, its name tag,
// the outlines of what the AI changed, stand-in copies and the box selection.
//
// WHY DOM (not drawn into the game's canvas): it must look and hit the same in
// every engine, stay crisp regardless of post-processing or fog, and be real
// elements for accessibility labels. It lives in a shadow root (open, so
// composedPath() can see which strip button was pressed) so the game's CSS
// cannot restyle it, and the root ignores pointer events except on the strip.
//
// Rebrand 2026-10-16 (the "one list, one card, one input" design). Before:
// four white discs with a ring in the job's colour (orange / yellow / grey)
// floating round the object, a blue box round it and blue boxes round each
// member of a group. They were the loudest thing on screen and used four
// colours. Now the editor has two colours with one meaning each:
//   ORANGE (#ff6b1a) = your hand: what you picked (outline, name tag);
//   VIOLET (#8b7cff) = the AI's hand: what its last change touched.
// Everything else on the game is the game's own colour. The four handles are
// one dark strip of 28 px buttons (44 on phones) right under the object; the
// object itself can be dragged to move it (input.ts).
//
// Tool modes (play test 10/16: "only move works by clicking and then
// dragging anywhere; the others need the button held while the mouse moves —
// not intuitive"). A press on a strip button now CHOOSES that tool, as in
// every design and 3D tool: it stays pressed (`setTool`) until another one is
// chosen, and a drag anywhere on the game does it (input.ts). A drag started
// on a button still works the old way (press and drag on it), so nothing a
// hand learnt stops working. While a drag works, a small readout next to the
// strip says what changed by how much ("Turn 32°", "Size ×1.40"), and the
// first time a tool is chosen one line at the bottom says how to look around.
//
// WHY an outline that follows the object's shape (adapter.silhouette) and not
// a box: a box is wider than the object and overlaps its neighbours, so "which
// one is picked?" was answered by guessing. Adapters that cannot draw objects
// alone get a rounded box (6 px corners, the radius of every control).
const { UI } = __require(13);

                                   

/** The tools' keys (also in the tooltips and in ⌘K): the English initials, none taken by another single key (Q/E steps, R axis, F, P). */
const TOOL_KEYS                             = { move: 'M', lift: 'H', rotate: 'T', scale: 'S' };
/** 1–4: the same tools in the 3D strip's order (basics pass, 2026-10-18; shell/keymap.ts). Not W/E/R: E turns, R is the axis. */
const TOOL_NUMBERS                             = { move: '1', lift: '2', rotate: '3', scale: '4' };
const toolFromKey = (key        )                    =>
  (Object.keys(TOOL_KEYS)                ).find((k) => TOOL_KEYS[k] === key.toUpperCase() || TOOL_NUMBERS[k] === key) ?? null;

/**
 * The Motion button's keys (studio-motion-tool, 2026-10-22): A ("animate") and 5, the strip's order after 1–4. Not a
 * tool (nothing is dragged with it): a press opens the pick's motion, or its small menu. A is also fly-left (W A S D),
 * but only with nothing picked or the right button held — the same split as S (Size / fly back); the Motion keys
 * work with something picked. shell/keymap.ts lists them; test/keymap.test.ts keeps the two the same.
 */
const MOTION_KEYS = ['A', '5']         ;
const isMotionKey = (key        )          => (MOTION_KEYS                     ).includes(key.toUpperCase());

const HANDLE_LABELS                                           = {
  en: { move: 'Move (M)', rotate: 'Turn (T)', lift: 'Height (H)', scale: 'Size (S)' },
  ja: { move: '移動（M）', rotate: '回す（T）', lift: '高さ（H）', scale: '大きさ（S）' },
};
/** The readout's words while a drag works (short: it sits next to the strip). */
const READOUT_WORDS                                                             = {
  en: { move: 'Move', rotate: 'Turn', lift: 'Height', scale: 'Size', tipX: 'Tilt forward', tipZ: 'Tilt sideways' },
  ja: { move: '移動', rotate: '回す', lift: '高さ', scale: '大きさ', tipX: '前後に倒す', tipZ: '左右に倒す' },
};
/**
 * The one line shown the first time a tool is chosen (then never again on this computer): what a drag does now and
 * how to stop. 40 characters at most (design review 2, item ③): it was 101 — "Drag anywhere: Turn · Look around:
 * ⌥-drag, right-drag, or hold Space · Esc: no tool · Tilt: ▾ on Turn" — and its ▾ came out as "•" in the font. How to
 * look around is in the ? sheet (shell/shortcuts.ts); the ▾ says itself that the tilts are behind it. On touch the
 * two-finger look stays: a phone has no ? sheet. `tool` is the readout word ("Turn", "Tilt forward").
 */
const TOOL_HINT                                                                                     = {
  en: { mouse: (t) => `Drag to ${t.toLowerCase()} · Esc to stop`, touch: (t) => `Drag to ${t.toLowerCase()} · 2 fingers: look` },
  ja: { mouse: (t) => `引いて${t} ・ Esc でやめる`, touch: (t) => `引いて${t} ・ 2 本指で見回す` },
};
/**
 * A dimmed tool's one line (studio-tool-clear, 2026-10-23): why it does not work on this object, then what can be done
 * — never only "you can't" (the brief: "do not end on a sentence that leaves nothing to do"). The tooltip of the dimmed
 * button, and the small line by the strip (noteLine). The menu a press opened is gone (studio-move-plain, 2026-10-23);
 * the `game` move / lift lines stay for a group whose Move is off, but Move on what the game moves works (hold.ts).
 * Turn and size the game sets get "Ask AI", not a start value: a game that spins or pulses a thing mostly sets the angle
 * or the size outright every frame, so a start value would not show (hold.ts; the design review proposed both).
 */
const OFF_LINES                                                                                          = {
  en: {
    game: {
      move: 'Your game moves this while playing. You choose only where it starts.',
      lift: 'Your game sets its height while playing. You can set the height it starts at.',
      rotate: 'Your game turns this while playing. Ask AI to change how it turns.',
      scale: 'Your game sets its size while playing. Ask AI to change it.',
    },
    ground: { move: 'Held still so it isn’t nudged by mistake. You can unlock it.', lift: 'Held still so it isn’t nudged by mistake. You can unlock it.', rotate: 'Held still so it isn’t nudged by mistake. You can unlock it.', scale: 'Held still so it isn’t nudged by mistake. You can unlock it.' },
    locked: { move: 'The game’s rules keep this in place. Ask AI to change the rule.', lift: 'The game’s rules keep this in place. Ask AI to change the rule.', rotate: 'The game’s rules keep this in place. Ask AI to change the rule.', scale: 'The game’s rules keep this in place. Ask AI to change the rule.' },
    none: { move: 'This one can’t be moved here. Ask AI to move it.', lift: 'This one’s height can’t be changed here. Ask AI to change it.', rotate: 'This one can’t be turned here. Ask AI to turn it.', scale: 'This one can’t be resized here. Ask AI to resize it.' },
  },
  ja: {
    game: {
      move: 'この物は遊ぶとゲームが動かします。決められるのはスタート位置だけです。',
      lift: 'ゲームが高さを決めている物です。最初の高さなら決められます。',
      rotate: 'ゲームが向きを変えている物です。変えるなら AI に頼めます。',
      scale: 'ゲームが大きさを変えている物です。変えるなら AI に頼めます。',
    },
    ground: { move: 'うっかり動かさないよう固定しています。解除できます。', lift: 'うっかり動かさないよう固定しています。解除できます。', rotate: 'うっかり動かさないよう固定しています。解除できます。', scale: 'うっかり動かさないよう固定しています。解除できます。' },
    locked: { move: 'ゲームのルールで固定されています。AI にルールの変更を頼めます。', lift: 'ゲームのルールで固定されています。AI にルールの変更を頼めます。', rotate: 'ゲームのルールで固定されています。AI にルールの変更を頼めます。', scale: 'ゲームのルールで固定されています。AI にルールの変更を頼めます。' },
    none: { move: 'この物はここでは動かせません。AI に頼めます。', lift: 'この物の高さはここでは変えられません。AI に頼めます。', rotate: 'この物はここでは回せません。AI に頼めます。', scale: 'この物の大きさはここでは変えられません。AI に頼めます。' },
  },
};
/**
 * The small line by the strip (studio-move-plain, 2026-10-23, a hands-on try on a neon runner: "the left of the strip was
 * the plain Move — both ends are Motion now"). What the game does to the picked thing while playing, and, when the game
 * moves it, that a move here sets where it starts — Move itself is the plain Move, with no menu in between. One line,
 * short; no "Ask AI" (the ask box below is where that happens). `parts` = what the game changes (Item.driven).
 */
function gameNote(lang      , parts                                                )         {
  const moves = parts.includes('move') || parts.includes('lift');
  const what = (['move', 'turn', 'size']         ).filter((k) => (k === 'move' ? moves : parts.includes(k)));
  if (!what.length) return '';
  if (lang === 'ja') {
    const v = { move: '動かし', turn: '回し', size: '大きさを変え' };
    return `遊ぶとゲームが${what.map((k) => v[k]).join('、')}ます。${moves ? 'ここで動かすとスタート位置が変わります。' : ''}`;
  }
  const v = { move: 'moves', turn: 'turns', size: 'resizes' };
  const list = what.length < 3 ? what.map((k) => v[k]).join(' and ') : `${v.move}, ${v.turn} and ${v.size}`;
  return `Your game ${list} this while playing.${moves ? ' Moving it here sets where it starts.' : ''}`;
}
/** The ▾'s tooltip and label (PC: hovering the button lights the ▾ and this says what it opens). */
const MORE_LABELS                                                 = {
  en: { axis: 'Ways to turn', scale: 'Ways to resize' },
  ja: { axis: '回し方を選ぶ', scale: '大きさの変え方を選ぶ' },
};
/**
 * The choices behind strip buttons (2026-10-16): the turn button (3D, one
 * object) has "Turn / Tilt forward / Tilt sideways"; the size button with
 * several picked, "Together / Each in place". They open from the small ▾ in
 * the button's bottom-right corner, or a long press on the button (tool
 * options, play test 2026-10-18; before, a SECOND tap on the chosen button
 * opened them, which nobody finds — kept only as an unadvertised shortcut).
 * Big buttons with a picture and a short word, the long words as the tooltip.
 * The first of each is the default and wears the tool's own picture, so the
 * strip looks the same until another way is chosen; then the button wears
 * that way's picture (the menu's and the button's pictures always match).
 */
const AXIS_WORDS                                                   = {
  // Turn / Tilt, not Rotate / Tip (words pass 2026-10-17): the tool is Turn (key T), and "tip" and
  // "upright axis" read oddly to North American players (play test 2026-10-16).
  en: { y: ['Turn', 'Turn left or right (R: next axis)'], x: ['Tilt forward', 'Tilt forward or back (R: next axis)'], z: ['Tilt sideways', 'Tilt left or right (R: next axis)'] },
  ja: { y: ['横に回す', '縦の軸で横に回す（R で次の軸）'], x: ['前後に倒す', '前か後ろに倒す（R で次の軸）'], z: ['左右に倒す', '左か右に倒す（R で次の軸）'] },
};
const SCALE_WORDS                                                         = {
  en: { spread: ['Together', 'Everything grows, including the gaps, from each object’s base'], inplace: ['Each in place', 'Each one grows in its own spot; the gaps stay the same'] },
  ja: { spread: ['並びごと', '物どうしの間も一緒に広がる（足元が基準）'], inplace: ['その場で', 'それぞれが自分の足元で大きくなる（間はそのまま）'] },
};
/**
 * Turning several (multi rotate, play test 2026-10-18: "no turn options with several picked"): the size button's two
 * words, in the same order, under the axes on the turn button's ▾ (2D: alone — one axis there).
 */
const TURN_WAY_WORDS                                                         = {
  en: { spread: ['Together', 'Everything turns as one piece, around the middle of what’s selected'], inplace: ['Each in place', 'Each one turns in its own spot; nothing moves away'] },
  ja: { spread: ['並びごと', '並び全体が 1 つの物のように、選んだ物の真ん中を中心に回る'], inplace: ['その場で', 'それぞれが自分の場所で回る（置き場所はそのまま）'] },
};
                                                              

/** The group tag ("3 selected"). */
const MANY_LABEL                                      = {
  en: (n) => `${n} selected`,
  ja: (n) => `${n} 個を選択`,
};

// Line icons (24×24 grid, stroke = currentColor), same rule as the shell's icons.
// The three turns, as the motion looks from in front: the turn tool's own
// arrow = turning on the spot (y, the default), an upright ellipse = tipping
// forward / back (x), a circle facing you = tipping sideways (z).
const AXIS_ICONS                           = {
  // y = the turn tool's own picture (the default way; see AXIS_WORDS). Was a flat ellipse until 2026-10-18.
  y: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17.5 3.5v4h-4"/>',
  x: '<ellipse cx="12" cy="12" rx="3.5" ry="8"/><path d="M6.2 7.5 8.6 4l1.9 3.6"/><path d="M4 12h16" stroke-dasharray="2 2.5"/>',
  z: '<circle cx="12" cy="12" r="7.5"/><path d="M15.5 2.8 19 5.2l-3.6 1.9"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
};
const SCALE_ICONS                                 = {
  // spread = the size tool's own picture (the default way). Was two boxes with arrows apart until 2026-10-18.
  spread: '<path d="M5 19 19 5M13.5 5H19v5.5M5 13.5V19h5.5"/>',
  inplace: '<rect x="4" y="12" width="5" height="6" rx="1"/><rect x="13" y="8" width="7" height="10" rx="1"/><path d="M3 21h18"/><path d="M16.5 2.5v3.5M14.8 4.2l1.7-1.7 1.7 1.7"/>',
};

/**
 * Turning several. Each in place: two boxes, each with its own small turn arrow. Together: two boxes riding one big
 * turn round a middle dot — not the turn tool's own picture, which the axes row's Turn already wears in 3D (2D, where
 * the axes are not shown, uses the tool's own picture for Together: see `turnWayIcon`).
 */
const TURN_WAY_ICONS                                 = {
  spread: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M17.8 2.8v4h-4"/><rect x="2.5" y="10" width="4" height="4" rx=".8"/><rect x="17.5" y="10" width="4" height="4" rx=".8"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  inplace: '<rect x="3" y="13" width="6" height="6" rx="1"/><rect x="15" y="13" width="6" height="6" rx="1"/><path d="M3.5 9a3 3 0 0 1 5-1.8"/><path d="M8.8 4.8v2.6H6.2"/><path d="M15.5 9a3 3 0 0 1 5-1.8"/><path d="M20.8 4.8v2.6h-2.6"/>',
};

const ICONS                             = {
  move: '<path d="M12 4v16M4 12h16M9.5 6.5 12 4l2.5 2.5M9.5 17.5 12 20l2.5-2.5M6.5 9.5 4 12l2.5 2.5M17.5 9.5 20 12l-2.5 2.5"/>',
  rotate: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M17.5 3.5v4h-4"/>',
  lift: '<path d="M12 4v16M8.5 7.5 12 4l3.5 3.5M8.5 16.5 12 20l3.5-3.5"/>',
  scale: '<path d="M5 19 19 5M13.5 5H19v5.5M5 13.5V19h5.5"/>',
};

/**
 * The Motion button's picture: a dotted path from a small point to the thing at its end (a ring) — "this goes from
 * here to there over time". Not the timeline's ◆ (a key, one moment) nor ▶ (Play, which runs the whole game).
 */
// The thing at the top LEFT (not right, as first drawn): the top right corner is where the dot goes, and the ring
// there hid it (the first run's pictures, 2026-10-22).
const MOTION_ICON = '<path d="M20 19c-4.5 0-5-7-8.5-9.5S7 8 5.5 6.5" stroke-dasharray="0.01 3.2"/><circle cx="20" cy="19" r="1.3" fill="currentColor" stroke="none"/><circle cx="5.5" cy="6.5" r="2.6"/>';

                          
                                         
            
            
            
            
                                                            
                          
 
                                                           

                          
     
                                                                                                                       
                                                                                                                        
                                                                
     
                                                                                                                                    
                                                                                   
                            
                                                                                           
                               
                                                                                 
                                          
                                                                  
                                           
                                                                                                            
                                         
                                                                                
                                     
                                                                                           
                                  
                                                      
     
                                                                                                                         
                                                                                                                         
     
                                                                                    
                                                                                                                      
                               
                                                                       
                                             
     
                                                                           
                                                                      
     
                                                                            
                                                                                  
                                                                     
                                                                                                                       
                                                    
                                                                                             
                
     
                                                                    
                                                                         
                                                                         
                                                                        
     
                                                                                                                            
                                                     
                            
                                                
                                            
                                                                                                            
                                           
                                                                                                      
                                          
     
                                                                                                                   
                                                                                     
     
                                                                                                           
     
                                                                                    
                                                                                 
                                                                                  
                                                                          
     
                                                                                                                               
                                      
                  
 

/** Your hand and the AI's hand. Kept in step with --you / --ai in shell.css (fixed: they sit on the game, not on the shell's theme). */
const YOU = '#ff6b1a';
const AI = '#8b7cff';
/** Gap between the object and the strip (px): 12 = the review's number (wave 1, W1-2 / M4, 2026-10-17); was 10. */
const GAP = 12;
const CSS = `
:host { all: initial; }
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;
  font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
/* The strip: the shell's one glass (shell.css rule 1) — frosted, so the game shows through and the strip
   belongs to it. Corners nest: buttons 8, 4 in, so the plate is 12. */
.row { position: absolute; display: none; gap: 2px; padding: 4px; border-radius: 12px; transform: translateX(-50%);
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); }
button { position: relative; pointer-events: auto; width: var(--h, ${UI.handlePx}px); height: var(--h, ${UI.handlePx}px); border-radius: 8px; border: 0;
  background: transparent; color: #a1a1a6; display: grid; place-items: center; padding: 0; cursor: grab;
  transition: background-color .16s cubic-bezier(.2,.8,.2,1), color .16s cubic-bezier(.2,.8,.2,1); touch-action: none; -webkit-tap-highlight-color: transparent; }
button:hover { color: #f5f5f7; background: rgba(255,255,255,.07); }
/* No tool chosen: move is what dragging the object does, shown lightly as "the one at rest". A chosen tool is .on (ink). */
button.rest { color: #f5f5f7; background: rgba(255,255,255,.12); }
/* The chosen tool: the phone strip's grey ground (design review 2, item ③), not a filled ink square — the square was the
   loudest thing on the game after the object itself (review 2, photo 03; the light editor's was black). */
button:active, button.on { color: #f5f5f7; background: rgba(255,255,255,.16); cursor: grabbing; transition-duration: 0s; }
button:focus-visible { outline: 2px solid ${YOU}; outline-offset: 1px; }
button[hidden], .tsep[hidden] { display: none; }
/* A tool that does not work on this object (studio-tool-clear, 2026-10-23: "Move is gone from the strip"). It keeps
   its place and its own icon — the strip is the same four tools for every object — at a third of the ink, and a press
   on it does nothing; why is the one small line by the strip (.note). studio-move-plain (2026-10-23): no slash across
   it and no menu on a press any more — the slashed Move read as a second Motion button ("both ends are Motion now"),
   and a menu between the hand and the tool was one step too many. Move and Height on what the game moves are never
   off (hold.ts holdItem: they set where it starts). */
button.off { color: rgba(161,161,166,.42); cursor: default; }
button.off:hover, button.off:active { color: rgba(161,161,166,.42); background: transparent; }
button.off.rest { color: rgba(161,161,166,.42); background: transparent; }
.root.light button.off, .root.light button.off.rest, .root.light button.off:hover, .root.light button.off:active { color: rgba(110,110,115,.42); background: transparent; }
/* The Motion button (studio-motion-tool, 2026-10-22) sits after a hairline: the four tools change how the thing stands
   (a drag does it), Motion changes what it does over time (a press opens it). The same button as the tools — size,
   ink, ground — so the strip stays one object; the hairline is the menu's own (.msep). */
.tsep { align-self: stretch; width: .5px; margin: 5px 3px; background: rgba(255,255,255,.14); flex: none; }
.root.light .tsep { background: rgba(0,0,0,.1); }
.row.big .tsep { margin: 10px 4px; }
button[data-studio-motion] { cursor: pointer; }
/* "This thing moves": a 5 px dot in the button's own ink, top right — no new colour on the game (orange is your pick,
   violet the AI's). A finger strip: 6 px, 7 in. */
.dot { position: absolute; right: 3px; top: 3px; width: 5px; height: 5px; border-radius: 50%; background: currentColor; display: none; pointer-events: none; }
button.has .dot { display: block; }
.row.big .dot { right: 7px; top: 7px; width: 6px; height: 6px; }
/* Touch: past 44 px for the finger, whatever the drawn size. */
@media (pointer: coarse) { button::after { content: ""; position: absolute; inset: -2px; } }
svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6px; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.big svg { width: 20px; height: 20px; }
svg * { vector-effect: non-scaling-stroke; }
/* Outlines: a canvas per shape, a rounded box when there is no shape. */
.ol { position: absolute; pointer-events: none; }
.box { position: absolute; border: 1.5px solid var(--c); border-radius: 6px; box-sizing: border-box; pointer-events: none; }
/* Your pick, strongly (a hands-on try, 2026-10-19, item 3: "make what I picked stand out in the scene"; one of 20 black
   pillars had a thin orange line and the eye kept losing it). A 3 px line with an orange glow round it, the object
   lightly tinted (ring(): tint), and once on a new pick a brighter glow that settles in .6 s. The hover light is the
   same in a softer dose. Boxes (adapters without a shape) get the same, as a box. */
.layer.sel .ol { filter: drop-shadow(0 0 6px rgba(255,107,26,.6)); }
.layer.sel .box { border-width: 3px; background: rgba(255,107,26,.12); box-shadow: 0 0 10px rgba(255,107,26,.55); }
.layer.sel.flash .ol, .layer.sel.flash .box { animation: pick-flash .6s cubic-bezier(.2,.8,.2,1); }
@keyframes pick-flash { from { filter: drop-shadow(0 0 16px rgba(255,107,26,1)) brightness(1.25); } }
.layer.hover .ol { filter: drop-shadow(0 0 5px rgba(255,107,26,.45)); }
.layer.hover .box { border-width: 2px; background: rgba(255,107,26,.08); box-shadow: 0 0 8px rgba(255,107,26,.4); }
@media (prefers-reduced-motion: reduce) { .layer.sel.flash .ol, .layer.sel.flash .box { animation: none; } }
/* Name tags: the only filled colour on the game (your hand / the AI's hand), round-ended so they read as labels. */
.tag { position: absolute; display: none; height: 22px; padding: 0 9px; border-radius: 999px; align-items: center; gap: 4px; color: #fff; white-space: nowrap; font-weight: 600;
  transform: translate(-50%, -100%); box-shadow: 0 1px 2px rgba(0,0,0,.2), 0 4px 12px rgba(0,0,0,.18); max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
.tag.you { background: ${YOU}; }
.tag.ai { background: ${AI}; }
/* Stand-in copy: see-through picture of the original, dashed edge ("dashed = not real yet"). */
.ghost { position: absolute; opacity: .6; outline: 1.5px dashed rgba(255,255,255,.9); border-radius: 4px; pointer-events: none; background-size: 100% 100%; }
.band { position: absolute; border: 1px solid ${YOU}; border-radius: 2px; background: rgba(255,107,26,.1); display: none; pointer-events: none; }
/* The choices over the strip (design review 2, item ③): ONE row as high as the strip, its buttons the strip's own size,
   pictures only — the words are the tooltip and the label read aloud (the readout and the hint line name the way while
   it works). Before: big buttons with a picture over a word, twice the strip's width (265 px over a 125 px strip),
   the chosen one a black square, "Tilt sideways" wrapping on a phone. The chosen way: the strip's grey ground. */
.menu { position: absolute; display: none; gap: 2px; padding: 4px; border-radius: 12px; transform: translateX(-50%);
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); animation: rise .24s cubic-bezier(.2,.8,.2,1); }
@keyframes rise { from { opacity: 0; transform: translateX(-50%) translateY(6px) scale(.985); } }
.menu button { cursor: pointer; }
.menu button span { display: none; }
.menu button.chosen { color: #f5f5f7; background: rgba(255,255,255,.16); box-shadow: none; }
/* 3D with several picked: the axes, a hairline, then Together / Each in place — side by side in the one row. */
.menu .mrow { display: flex; gap: 2px; }
.menu .msep { align-self: stretch; width: .5px; margin: 4px 3px; background: rgba(255,255,255,.14); }
.root.light .menu .msep { background: rgba(0,0,0,.1); }
.menu.big { gap: 0; padding: 2px; border-radius: 14px; background: rgba(42, 42, 46, .92); box-shadow: 0 0 0 1px rgba(255,255,255,.08);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.menu.big .mrow { gap: 0; }
.menu.big button { border-radius: 12px; }
.menu.big button.chosen { background: rgba(255,255,255,.10); }
.root.light .menu.big { background: rgba(255,255,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.08); }
.root.light .menu.big button.chosen { background: rgba(0,0,0,.08); }
/* The ▾ (tool options, play test 2026-10-18): "this button has choices", in the button's bottom-right corner, inside
   it — so the strip is not one px taller or wider and does not move when it appears (W1-2). The mark is 7×4 in the
   button's own colour, faint at rest, full on hover (PC: the hover says "there is more here"); its press area is the
   corner, 12 px on the mouse strip and 20 px on the finger strip (a quarter of a 44 button; the rest of the button
   still chooses the tool). A long press anywhere on the button opens the same choices. */
/* z-index 1: over the button's touch ::after (inset −2 px, drawn after the ▾), which otherwise took the press on a
   phone and the ▾ chose the tool instead of opening the choices (studio-transform, 2026-10-18). */
.more { position: absolute; z-index: 1; right: 0; bottom: 0; width: 12px; height: 12px; display: none; place-items: end; padding: 0 2px 2px 0;
  box-sizing: border-box; pointer-events: auto; cursor: pointer; border-radius: 0 0 8px 0; opacity: .6; transition: opacity .16s cubic-bezier(.2,.8,.2,1); }
.more svg { width: 7px; height: 4px; stroke-width: 1.5px; }
button.opts .more { display: grid; }
button:hover .more, button.on .more, .more.open { opacity: 1; }
.row.big .more { width: 20px; height: 20px; padding: 0 5px 5px 0; border-radius: 0 0 12px 0; }
.row.big .more svg { width: 8px; height: 5px; }
/* Light editor: the light glass, the same two colours. */
.root.light .menu, .root.light .row { backdrop-filter: blur(30px) saturate(1.25); -webkit-backdrop-filter: blur(30px) saturate(1.25); background: rgba(251,251,253,.8); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.7), 0 1px 1px rgba(0,0,0,.04), 0 10px 32px rgba(0,0,0,.13); }
.root.light .menu button { color: #6e6e73; }
.root.light .menu button.chosen { color: #1d1d1f; background: rgba(0,0,0,.08); }
.root.light button { color: #6e6e73; }
.root.light button:hover { color: #1d1d1f; background: rgba(0,0,0,.045); }
.root.light button.rest { color: #1d1d1f; background: rgba(0,0,0,.075); }
.root.light button:active, .root.light button.on { color: #1d1d1f; background: rgba(0,0,0,.08); }
/* The readout while a drag works, and the first-time hint line: the same glass, the small size, tabular digits (rule 4). */
.chip, .hint { position: absolute; display: none; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; white-space: nowrap;
  font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; font-variant-numeric: tabular-nums; color: #f5f5f7;
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); }
.chip { transform: translateY(-50%); }
.hint { height: 32px; padding: 0 14px; font-weight: 400; transform: translateX(-50%); max-width: calc(100vw - 24px); overflow: hidden; text-overflow: ellipsis; animation: rise .24s cubic-bezier(.2,.8,.2,1); }
.root.light .chip, .root.light .hint { color: #1d1d1f; backdrop-filter: blur(30px) saturate(1.25); -webkit-backdrop-filter: blur(30px) saturate(1.25); background: rgba(251,251,253,.8); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.7), 0 1px 1px rgba(0,0,0,.04), 0 10px 32px rgba(0,0,0,.13); }
/* The one small line by the strip (studio-move-plain, 2026-10-23): why a tool is off, or that the game moves this and
   a move here sets where it starts. On the far side of the strip from the object, centred on it; plain words on the
   same glass as the readout, lighter weight, never a button (pointer-events: none — the strip's tools stay the only
   thing to press). */
.note { position: absolute; display: none; align-items: center; height: 22px; padding: 0 10px; border-radius: 999px; white-space: nowrap;
  transform: translateX(-50%); max-width: calc(100vw - 24px); overflow: hidden; text-overflow: ellipsis; pointer-events: none;
  font: 400 11px/1 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; color: #d1d1d6;
  background: rgba(28, 28, 30, .78); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 8px 24px rgba(0,0,0,.3);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); }
.root.light .note { color: #3a3a3c; background: rgba(251,251,253,.82); backdrop-filter: blur(30px) saturate(1.25); -webkit-backdrop-filter: blur(30px) saturate(1.25);
  box-shadow: inset 0 0 0 .5px rgba(255,255,255,.7), 0 1px 1px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.1); }
@media (pointer: coarse) { .note { height: 26px; font-size: 12px; } }
/* A finger: clear of the camera's ↑ ↓ at the bottom right (44 wide + 12 margin on each side, review 2 item ③). */
@media (pointer: coarse) { .hint { height: 36px; font-size: 13px; max-width: calc(100vw - 128px); } }
@media (prefers-reduced-motion: reduce) { button, .more { transition: none; } .menu, .hint { animation: none; } }
/* The finger-sized strip (buttons 44 px: phones and the side window; .big = 40 px and up), design review wave 1 (W1-2 / N4,
   2026-10-17): 48 high (44 + 2 in), no gaps between buttons, 14 corners, a light plate — white 92 % with a 12 px blur
   and a 1 px line (dark: #2a2a2e 92 %). WHY: the dark, thick plate with the chosen tool as a second plate on it weighed
   ten times the small object it served (review photo 12 / 15 / 18). The chosen tool (and Move at rest) is told by its
   ground alone, black 8 % (dark: white 10 %), never a filled square on top. */
.row.big { gap: 0; padding: 2px; border-radius: 14px; background: rgba(42, 42, 46, .92); box-shadow: 0 0 0 1px rgba(255,255,255,.08);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.row.big button { border-radius: 12px; }
.row.big button:hover { background: transparent; }
.row.big button.rest, .row.big button.on, .row.big button:active { color: #f5f5f7; background: rgba(255,255,255,.10); }
.root.light .row.big { background: rgba(255,255,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.08); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.root.light .row.big button { color: #6e6e73; }
.root.light .row.big button.rest, .root.light .row.big button.on, .root.light .row.big button:active { color: #1d1d1f; background: rgba(0,0,0,.08); }
`;

let scratch                           = null;
/** How a ring is drawn: `line` px wide (2 = the AI's), `tint` = the share of `color` laid over the object (0 = none). */
                            
               
               
 
const RING_AI            = { line: 2, tint: 0 };
// 3 px and a 16 % tint: strong enough to find one black pillar among twenty (a hands-on try, 2026-10-19) and still the
// game's own colours underneath. Hover: the same line in the softer 2 px with half the tint (the canvas is drawn at 70 %).
const RING_YOU            = { line: 3, tint: 0.16 };
const RING_HOVER            = { line: 2, tint: 0.1 };
/** Draw a ring just outside the mask's shape, in `color`, on a faint dark halo (and a tint over the shape: `style`). */
function ring(doc          , el                   , o         , color        , style            = RING_AI) {
  const dpr = doc.defaultView?.devicePixelRatio || 1;
  const W = Math.max(1, Math.ceil(o.w * dpr));
  const H = Math.max(1, Math.ceil(o.h * dpr));
  if (el.width !== W) el.width = W;
  if (el.height !== H) el.height = H;
  el.style.left = `${o.x}px`;
  el.style.top = `${o.y}px`;
  el.style.width = `${o.w}px`;
  el.style.height = `${o.h}px`;
  const g = el.getContext('2d');
  if (!g) return;
  g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, W, H);
  // A faint dark halo 1 px outside the coloured line first (ive finish, 10/16): orange alone vanished on
  // orange, sand or sunset games; the halo keeps the line readable on any colour without a second colour.
  const stamp = (px        ) => {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      g.drawImage(o.mask, Math.cos(a) * px, Math.sin(a) * px, W, H);
    }
  };
  stamp((style.line + 1) * dpr);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = 'rgba(0, 0, 0, .28)';
  g.fillRect(0, 0, W, H);
  // Then the line: the shape stamped round a small circle (16 directions, 2 px), in `color`, over the halo.
  // One scratch canvas, reused: outlines are redrawn up to every 40 ms while dragging.
  const line = (scratch ||= doc.createElement('canvas'));
  line.width = W;
  line.height = H;
  const lg = line.getContext('2d');
  if (lg) {
    const t = style.line * dpr;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      lg.drawImage(o.mask, Math.cos(a) * t, Math.sin(a) * t, W, H);
    }
    lg.globalCompositeOperation = 'source-in';
    lg.fillStyle = color;
    lg.fillRect(0, 0, W, H);
  }
  g.globalCompositeOperation = 'source-over';
  g.drawImage(line, 0, 0);
  // Keep only the ring: the object itself stays exactly as the game draws it — except your pick and the hover, which
  // get a light tint of the colour over the shape (2026-10-19: the ring alone round a small far object was lost).
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(o.mask, 0, 0, W, H);
  if (style.tint > 0) {
    const fill = (tintCanvas ||= doc.createElement('canvas'));
    fill.width = W;
    fill.height = H;
    const fg = fill.getContext('2d');
    if (fg) {
      fg.drawImage(o.mask, 0, 0, W, H);
      fg.globalCompositeOperation = 'source-in';
      fg.fillStyle = color;
      fg.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = style.tint;
      g.drawImage(fill, 0, 0);
      g.globalAlpha = 1;
    }
  }
  g.globalCompositeOperation = 'source-over';
}
let tintCanvas                           = null;

function createHandles(doc          , hasLift         )          {
  const host = doc.createElement('div');
  host.setAttribute('data-studio-ui', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const root = doc.createElement('div');
  root.className = 'root';
  const row = doc.createElement('div');
  row.className = 'row';
  row.setAttribute('role', 'toolbar');
  const buttons = {}                                         ;
  // The tooltip each button has when it works (its name and key, or the turn's axis); a dimmed one shows its why.
  const tips = {}                              ;
  const offs                                      = {};
  // Order of the strip: move, height, turn, size (where it is, then how it sits).
  const kinds               = hasLift ? ['move', 'lift', 'rotate', 'scale'] : ['move', 'rotate', 'scale'];
  for (const k of kinds) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.studioHandle = k;
    b.setAttribute('aria-label', HANDLE_LABELS.en[k]);
    b.title = HANDLE_LABELS.en[k];
    tips[k] = b.title;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`; // static markup only
    if (k === 'rotate' || k === 'scale') {
      // The ▾ (shown only while the button has choices: setOptions). A span, not a button: a button in a button is not
      // allowed; keyboards reach the same choices with R (turn) and the menu's own buttons.
      const more = doc.createElement('span');
      more.className = 'more';
      more.dataset.studioMore = k === 'rotate' ? 'axis' : 'scale';
      more.innerHTML = '<svg viewBox="0 0 7 4" aria-hidden="true"><path d="M.75.75 3.5 3.25 6.25.75"/></svg>'; // static markup only
      b.append(more);
    }
    buttons[k] = b;
    row.appendChild(b);
  }
  // The Motion button, after a hairline (hidden until the editor says the pick can have a motion: setMotion).
  const motionSep = doc.createElement('div');
  motionSep.className = 'tsep';
  motionSep.setAttribute('role', 'separator');
  motionSep.hidden = true;
  const motionBtn = doc.createElement('button');
  motionBtn.type = 'button';
  motionBtn.dataset.studioMotion = '';
  motionBtn.hidden = true;
  motionBtn.setAttribute('aria-haspopup', 'menu');
  motionBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${MOTION_ICON}</svg><span class="dot"></span>`; // static markup only
  row.append(motionSep, motionBtn);
  let motionShow = false;
  buttons.move.classList.add('rest');
  for (const k of kinds) buttons[k].setAttribute('aria-pressed', 'false');
  // One layer per kind of mark, bottom to top: ghosts, AI outlines, your outline, tags, strip, band.
  const ghostLayer = doc.createElement('div');
  const aiLayer = doc.createElement('div');
  const selLayer = doc.createElement('div');
  const hoverLayer = doc.createElement('div');
  aiLayer.className = 'layer ai';
  selLayer.className = 'layer sel';
  hoverLayer.className = 'layer hover';
  hoverLayer.style.opacity = '.7';
  const youTag = doc.createElement('div');
  youTag.className = 'tag you';
  const aiTag = doc.createElement('div');
  aiTag.className = 'tag ai';
  const band = doc.createElement('div');
  band.className = 'band';
  const menuEl = doc.createElement('div');
  menuEl.className = 'menu';
  menuEl.setAttribute('role', 'menu');
  const chip = doc.createElement('div');
  chip.className = 'chip';
  chip.setAttribute('aria-live', 'polite');
  const hintEl = doc.createElement('div');
  hintEl.className = 'hint';
  hintEl.setAttribute('role', 'status');
  const noteEl = doc.createElement('div');
  noteEl.className = 'note';
  noteEl.dataset.studioNote = '';
  /** Swap a strip button's picture, keeping its ▾. */
  const paintIcon = (b                   , inner        ) => {
    const tmp = doc.createElement('div');
    tmp.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`; // static markup only
    b.querySelector(':scope > svg')?.replaceWith(tmp.firstElementChild );
  };
  let scaleMode                 = 'spread';
  let scaleOpts = false;
  const paintScale = () => paintIcon(buttons.scale, scaleOpts ? SCALE_ICONS[scaleMode] : ICONS.scale);
  // The turn button: 3D wears its axis (AXIS_ICONS, the first row of its choices); 2D with several picked wears
  // together / each in place (its only choices), the tool's own picture for together (the default), as the size button.
  let turnAxis           = 'y';
  let turnMode                 = 'spread';
  let turnAxes = false;
  let turnSeveral = false;
  let turnLang       = 'en';
  const turnWayIcon = (m                ) => (turnAxes || m === 'inplace' ? TURN_WAY_ICONS[m] : ICONS.rotate);
  const paintTurn = () => {
    const b = buttons.rotate;
    const wayOnly = turnSeveral && !turnAxes;
    paintIcon(b, wayOnly ? turnWayIcon(turnMode) : AXIS_ICONS[turnAxis]);
    const w = wayOnly ? (TURN_WAY_WORDS[turnLang] || TURN_WAY_WORDS.en)[turnMode] : (AXIS_WORDS[turnLang] || AXIS_WORDS.en)[turnAxis];
    // 3D, several: the way too ("Tilt forward · Each in place"), since the picture shows the axis only.
    const way = turnSeveral && turnAxes ? ` · ${(TURN_WAY_WORDS[turnLang] || TURN_WAY_WORDS.en)[turnMode][0]}` : '';
    tip('rotate', `${w[0]}${way} (${TOOL_KEYS.rotate}) — ${w[1]}`);
    b.setAttribute('aria-label', `${w[0]}${way} (${TOOL_KEYS.rotate})`);
  };
  const tip = (k            , text        ) => {
    tips[k] = text;
    if (!offs[k]) buttons[k].title = text;
  };
  let held                    = null;
  let chosen                    = null;
  const paintButtons = () => {
    for (const k of kinds) {
      buttons[k].classList.toggle('on', !offs[k] && (k === held || (k === chosen && !held)));
      buttons[k].setAttribute('aria-pressed', String(k === chosen));
    }
    // While a tool is chosen or another button is held, move is not "the one at rest" any more.
    buttons.move.classList.toggle('rest', !chosen && (!held || held === 'move') && !offs.move);
  };
  /** Next to the strip (right of it; left when there is no room), on its middle line. */
  const positionChip = () => {
    if (chip.style.display === 'none') return;
    if (row.style.display === 'none') {
      chip.style.visibility = 'hidden';
      return;
    }
    chip.style.visibility = '';
    const rr = row.getBoundingClientRect();
    const w = chip.offsetWidth;
    const right = inset.rightTo === undefined || rr.top < inset.rightTo ? inset.right : 0;
    let x = rr.right + 6;
    if (x + w > win.innerWidth - 8 - right) x = Math.max(8 + inset.left, rr.left - 6 - w);
    chip.style.left = `${x}px`;
    chip.style.top = `${rr.top + rr.height / 2}px`;
  };
  const positionHint = () => {
    if (hintEl.style.display === 'none') return;
    const top = win.innerHeight - inset.bottom - 12 - hintEl.offsetHeight;
    // The card's room on the right (inset.right) only reaches down to inset.rightTo, as for the camera ↑↓ (rise.ts).
    // Below the card the line is in the middle of the game, over the ask bar's middle (the third design review's ⑩,
    // 2026-10-20: centred in the room left of the card, it sat 146 px left of the bar at 1280).
    const right = inset.rightTo === undefined || top < inset.rightTo ? inset.right : 0;
    const vw = win.innerWidth - inset.left - right;
    hintEl.style.left = `${inset.left + vw / 2}px`;
    hintEl.style.top = `${top}px`;
  };
  let menuKind                          = null;
  // Where the strip went last: under the object (true) or over it.
  let stripBelow = true;
  /** Over the strip (under it when there is no room above), centred on the button it belongs to. */
  const positionMenu = () => {
    if (!menuKind) return;
    if (row.style.display === 'none') {
      menuEl.style.display = 'none';
      return;
    }
    menuEl.style.display = 'flex';
    const btn = (menuKind === 'axis' ? buttons.rotate : buttons.scale).getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
    const x = Math.max(8 + mw / 2, Math.min(win.innerWidth - 8 - mw / 2, btn.left + btn.width / 2));
    // On the far side of the strip from the object, so the choices never cover what they change.
    const vh = win.innerHeight;
    let y = stripBelow ? rr.bottom + 8 : rr.top - 8 - mh;
    if (stripBelow && y + mh > vh - 8 - inset.bottom) y = rr.top - 8 - mh;
    if (!stripBelow && y < 8 + inset.top) y = rr.bottom + 8;
    menuEl.style.left = `${x}px`;
    menuEl.style.top = `${y}px`;
  };
  /** The one small line: on the far side of the strip from the object (under a strip under it), centred on the strip. */
  const positionNote = () => {
    if (noteEl.style.display === 'none') return;
    if (row.style.display === 'none') {
      noteEl.style.visibility = 'hidden';
      return;
    }
    noteEl.style.visibility = '';
    const rr = row.getBoundingClientRect();
    const w = noteEl.offsetWidth, nh = noteEl.offsetHeight;
    const x = Math.max(8 + w / 2, Math.min(win.innerWidth - 8 - w / 2, rr.left + rr.width / 2));
    let y = stripBelow ? rr.bottom + 4 : rr.top - 4 - nh;
    if (y + nh > win.innerHeight - 8 - inset.bottom) y = rr.top - 4 - nh;
    if (y < 8 + inset.top) y = rr.bottom + 4;
    noteEl.style.left = `${x}px`;
    noteEl.style.top = `${y}px`;
  };
  root.append(ghostLayer, aiLayer, hoverLayer, selLayer, aiTag, youTag, row, noteEl, menuEl, chip, hintEl, band);
  shadow.append(style, root);
  (doc.body || doc.documentElement).appendChild(host);

  const win = doc.defaultView ;
  let size         = UI.handlePx;
  let inset        = { top: 0, right: 0, bottom: 0, left: 0 };

  /** Fill a layer with the shape's ring, or with one box per rect; returns the box round all of it. */
  const outline = (layer             , shape                , rects        , color        , style            )              => {
    if (shape) {
      let c = layer.firstElementChild                            ;
      if (!c || c.tagName !== 'CANVAS' || layer.children.length !== 1) {
        layer.replaceChildren();
        c = doc.createElement('canvas');
        c.className = 'ol';
        layer.append(c);
      }
      // No tint over something that fills much of the view (the sky dome, the ground): the whole game turned orange
      // when the mouse passed the sky's row (2026-10-19 photos). The ring and glow still say which.
      const big = shape.w * shape.h > 0.3 * win.innerWidth * win.innerHeight;
      ring(doc, c, shape, color, style && big ? { ...style, tint: 0 } : style);
      // The shape's own box (the mask has a few px of room round it).
      return { x: shape.x + 4, y: shape.y + 4, w: Math.max(0, shape.w - 8), h: Math.max(0, shape.h - 8) };
    }
    if (layer.firstElementChild?.tagName === 'CANVAS') layer.replaceChildren();
    while (layer.children.length > rects.length) layer.lastChild .remove();
    while (layer.children.length < rects.length) {
      const m = doc.createElement('div');
      m.className = 'box';
      m.style.setProperty('--c', color);
      layer.append(m);
    }
    let all              = null;
    rects.forEach((r, i) => {
      const m = layer.children[i]               ;
      m.style.left = `${r.x - 3}px`;
      m.style.top = `${r.y - 3}px`;
      m.style.width = `${r.w + 6}px`;
      m.style.height = `${r.h + 6}px`;
      all = all ? union(all, r) : { ...r };
    });
    return all;
  };
  const union = (a      , b      )       => {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  };
  /** A tag over a box, kept inside the window. `left` = start at the box's left edge instead of its middle. */
  const tagAt = (el             , box             , text               , left = false) => {
    if (!box || !text || box.y > win.innerHeight - inset.bottom) {
      el.style.display = 'none';
      return;
    }
    el.textContent = text; // untrusted names: text only
    el.style.display = 'flex';
    const vw = win.innerWidth;
    const w = el.offsetWidth || 80;
    let x = left ? box.x + w / 2 : box.x + box.w / 2;
    const right = inset.rightTo === undefined || box.y - 28 < inset.rightTo ? inset.right : 0;
    x = Math.max(8 + inset.left + w / 2, Math.min(vw - 8 - right - w / 2, x));
    // Above the object; under its top edge when there is no room above.
    const y = box.y - 8 < 28 + inset.top ? box.y + 28 : box.y - 8;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };

  return {
    setSize(px) {
      if (!(px >= 24 && px <= 120)) return;
      size = Math.round(px);
      root.style.setProperty('--h', `${size}px`);
      row.classList.toggle('big', size >= 40);
    },
    setTheme(theme) {
      root.classList.toggle('light', theme === 'light');
    },
    setInset(i) {
      inset = { top: Math.max(0, i.top || 0), right: Math.max(0, i.right || 0), bottom: Math.max(0, i.bottom || 0), left: Math.max(0, i.left || 0), rightTo: i.rightTo };
    },
    place(a, caps, dim) {
      const show = !!a && a.visible && !!caps;
      row.style.display = show ? 'flex' : 'none';
      const note = (show && caps?.note) || '';
      if (noteEl.textContent !== note) noteEl.textContent = note; // our own words only
      noteEl.style.display = note ? 'flex' : 'none';
      if (!show || !a || !caps) {
        positionMenu();
        positionChip();
        return;
      }
      // Every tool in its place (Height: 3D only — 2D has no height); the ones that do not work, dimmed with their why.
      if (buttons.lift) buttons.lift.hidden = dim !== '3d';
      let offChanged = false;
      for (const k of kinds) {
        const why = caps.off?.[k] || undefined;
        if (offs[k] === why) continue;
        offChanged = true;
        const b = buttons[k];
        if (why) {
          offs[k] = why;
          b.classList.add('off');
          b.setAttribute('aria-disabled', 'true');
          b.title = why;
        } else {
          delete offs[k];
          b.classList.remove('off');
          b.removeAttribute('aria-disabled');
          b.title = tips[k] ?? '';
        }
      }
      if (offChanged) paintButtons();
      const [cx, cy] = a.center;
      let top        , bottom        ;
      if (a.rect && a.rect.w > 0 && a.rect.h > 0) {
        top = a.rect.y;
        bottom = a.rect.y + a.rect.h;
      } else {
        const r = Math.max(12, a.size / 2);
        top = cy - r;
        bottom = cy + r;
      }
      const vw = win.innerWidth, vh = win.innerHeight;
      // Under a panel of the editor (a phone's sheet): no strip floating somewhere else.
      if (top > vh - inset.bottom) {
        row.style.display = 'none';
        noteEl.style.display = 'none';
        positionMenu();
        return;
      }
      const tools = kinds.filter((k) => !buttons[k].hidden).length;
      // The Motion button counts as a button; its hairline adds 8.5 px either way (.5 + 3 + 3 and one more 2 px gap on
      // the mouse strip; .5 + 4 + 4 and no gaps on the finger strip).
      motionBtn.hidden = !motionShow;
      motionSep.hidden = !motionShow || tools === 0;
      const n = tools + (motionShow ? 1 : 0);
      if (n === 0) row.style.display = 'none';
      // .big (finger size): no gaps, 2 px in (W1-2); else 2 px gaps, 4 px in.
      const big = size >= 40;
      const sepW = motionSep.hidden ? 0 : 8.5;
      const rowW = (big ? n * size + 4 : n * size + (n - 1) * 2 + 4) + sepW;
      const rowH = big ? size + 4 : size + 8;
      const lo = 8 + inset.top, hi = vh - 8 - inset.bottom - rowH;
      // Under the object; above it when there is no room below (over the ask bar on a phone).
      let y = bottom + GAP;
      if (y > hi) y = top - GAP - rowH - 28; // 28: keep clear of the name tag above
      if (y < lo) y = Math.min(hi, bottom + GAP);
      y = Math.max(lo, Math.min(hi, y));
      // The card covers the top right corner only: below it, the strip may go to the edge.
      const right = inset.rightTo === undefined || y < inset.rightTo ? inset.right : 0;
      const x = Math.max(8 + inset.left + rowW / 2, Math.min(vw - 8 - right - rowW / 2, cx));
      row.style.left = `${x}px`;
      row.style.top = `${y}px`;
      stripBelow = y >= bottom;
      positionMenu();
      positionChip();
      positionHint();
      positionNote();
    },
    setAxis(axis, lang) {
      buttons.rotate.dataset.axis = axis;
      turnAxis = axis;
      turnLang = lang;
      paintTurn();
    },
    setTurnMode(mode) {
      if (mode === turnMode) return;
      turnMode = mode;
      buttons.rotate.dataset.mode = mode;
      paintTurn();
    },
    setScaleMode(mode) {
      if (mode === scaleMode) return;
      scaleMode = mode;
      buttons.scale.dataset.mode = mode;
      paintScale();
    },
    setOptions(opts, lang) {
      // Called every frame (place): touch the DOM only when something changed.
      const words = MORE_LABELS[lang] || MORE_LABELS.en;
      for (const [k, on, kind] of [['rotate', opts.axis, 'axis'], ['scale', opts.scale, 'scale']]         ) {
        const b = buttons[k];
        if (b.classList.contains('opts') === on && b.dataset.optsLang === lang) continue;
        b.classList.toggle('opts', on);
        b.dataset.optsLang = lang;
        if (on) b.setAttribute('aria-haspopup', 'menu');
        else b.removeAttribute('aria-haspopup');
        const m = b.querySelector             ('.more');
        if (m) m.title = words[kind];
      }
      if (opts.scale !== scaleOpts) {
        scaleOpts = opts.scale;
        paintScale();
      }
      const axes = !!opts.axes, several = !!opts.several;
      if (axes !== turnAxes || several !== turnSeveral || lang !== turnLang) {
        turnAxes = axes;
        turnSeveral = several;
        turnLang = lang;
        paintTurn();
      }
    },
    menu(kind, current, lang, turn) {
      menuKind = kind;
      // The open one's ▾ stays lit, and the button says its choices are showing.
      for (const [k, mk] of [['rotate', 'axis'], ['scale', 'scale']]         ) {
        const open = kind === mk && row.style.display !== 'none';
        buttons[k].querySelector('.more')?.classList.toggle('open', open);
        if (buttons[k].hasAttribute('aria-haspopup')) buttons[k].setAttribute('aria-expanded', String(open));
      }
      menuEl.replaceChildren();
      if (!kind || row.style.display === 'none') {
        menuKind = null;
        menuEl.style.display = 'none';
        return;
      }
      /** One row of choices (the buttons go straight into `into`). */
      const choices = (into             , ck                , words                                  , icons                        , cur        ) => {
        for (const id of Object.keys(words)) {
          const b = doc.createElement('button');
          b.type = 'button';
          b.dataset.studioChoice = `${ck}:${id}`;
          b.setAttribute('role', 'menuitemradio');
          b.setAttribute('aria-checked', String(id === cur));
          if (id === cur) b.classList.add('chosen');
          b.title = `${words[id] [0]} — ${words[id] [1]}`;
          b.setAttribute('aria-label', words[id] [0]);
          b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[id]}</svg>`; // static markup only
          const t = doc.createElement('span');
          t.textContent = words[id] [0];
          b.append(t);
          into.append(b);
        }
      };
      const axes = kind === 'axis' && (!turn || turn.axes);
      const way = kind === 'axis' && turn ? turn.way : null;
      const wayIcons = { spread: turnWayIcon('spread'), inplace: TURN_WAY_ICONS.inplace };
      // One row as before (one object in 3D, the size button, 2D's turn with several); two rows in 3D with several.
      menuEl.classList.toggle('big', size >= 40);
      if (kind === 'scale') choices(menuEl, 'scale', SCALE_WORDS[lang] || SCALE_WORDS.en, SCALE_ICONS, current);
      else if (axes && way) {
        const top = doc.createElement('div'), sep = doc.createElement('div'), bottom = doc.createElement('div');
        top.className = bottom.className = 'mrow';
        top.setAttribute('role', 'group');
        bottom.setAttribute('role', 'group');
        sep.className = 'msep';
        sep.setAttribute('role', 'separator');
        choices(top, 'axis', AXIS_WORDS[lang] || AXIS_WORDS.en, AXIS_ICONS, current);
        choices(bottom, 'turn', TURN_WAY_WORDS[lang] || TURN_WAY_WORDS.en, wayIcons, way);
        menuEl.append(top, sep, bottom);
      } else if (way) choices(menuEl, 'turn', TURN_WAY_WORDS[lang] || TURN_WAY_WORDS.en, wayIcons, way);
      else choices(menuEl, 'axis', AXIS_WORDS[lang] || AXIS_WORDS.en, AXIS_ICONS, current);
      menuEl.style.display = 'flex';
      positionMenu();
    },
    menuOpen: () => menuKind,
    setActive(kind) {
      held = kind;
      paintButtons();
    },
    setTool(kind) {
      chosen = kind && buttons[kind] ? kind : null;
      paintButtons();
    },
    readout(text) {
      if (!text) {
        chip.style.display = 'none';
        return;
      }
      chip.textContent = text; // our own words and numbers only
      chip.style.display = 'flex';
      positionChip();
    },
    hint(text) {
      if (!text) {
        hintEl.style.display = 'none';
        return;
      }
      hintEl.textContent = text;
      hintEl.style.display = 'flex';
      positionHint();
    },
    setMotion(m) {
      motionShow = !!m.show;
      motionBtn.classList.toggle('has', !!m.has);
      motionBtn.classList.toggle('on', !!m.open);
      motionBtn.setAttribute('aria-expanded', String(!!m.open));
      if (motionBtn.title !== m.label) {
        motionBtn.title = m.label;
        motionBtn.setAttribute('aria-label', m.label);
      }
    },
    toolRect: (k) => (buttons[k] && row.style.display !== 'none' && !buttons[k].hidden ? buttons[k].getBoundingClientRect() : null),
    motionRect: () => (motionShow && row.style.display !== 'none' && !motionBtn.hidden ? motionBtn.getBoundingClientRect() : null),
    setLabels(labels) {
      for (const k of kinds) {
        buttons[k].setAttribute('aria-label', labels[k]);
        // The turn button's tooltip names its axis (setAxis), with the key.
        if (k !== 'rotate' || !buttons[k].dataset.axis) tip(k, labels[k]);
      }
    },
    selection(shape, rects, tag) {
      tagAt(youTag, outline(selLayer, shape, rects, YOU, RING_YOU), tag);
    },
    hover(shape, rects) {
      outline(hoverLayer, shape, rects, YOU, RING_HOVER);
    },
    flash() {
      selLayer.classList.remove('flash');
      void selLayer.offsetWidth; // restart the animation
      selLayer.classList.add('flash');
    },
    ai(shape, rects, tag) {
      tagAt(aiTag, outline(aiLayer, shape, rects, AI), tag, true);
    },
    ghosts(list) {
      const keep = new Set(list.map((g) => g.key));
      for (const el of Array.from(ghostLayer.children)                 ) if (!keep.has(el.dataset.key )) el.remove();
      for (const g of list) {
        let el = Array.from(ghostLayer.children).find((c) => (c               ).dataset.key === g.key)                           ;
        if (!el) {
          el = doc.createElement('div');
          el.className = 'ghost';
          el.dataset.key = g.key;
          ghostLayer.append(el);
        }
        // Only PNG data URLs from capture() are used as pictures (never game text).
        const bg = g.src && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(g.src) ? `url("${g.src}")` : 'none';
        if (el.dataset.bg !== bg.slice(0, 64)) {
          el.style.backgroundImage = bg;
          el.dataset.bg = bg.slice(0, 64);
        }
        el.style.left = `${g.cx - g.w / 2}px`;
        el.style.top = `${g.cy - g.h / 2}px`;
        el.style.width = `${Math.max(4, g.w)}px`;
        el.style.height = `${Math.max(4, g.h)}px`;
        el.style.transform = g.rot ? `rotate(${g.rot}rad)` : '';
      }
    },
    box(r) {
      band.style.display = r ? 'block' : 'none';
      if (!r) return;
      band.style.left = `${r.x}px`;
      band.style.top = `${r.y}px`;
      band.style.width = `${r.w}px`;
      band.style.height = `${r.h}px`;
    },
    destroy() {
      host.remove();
    },
  };
}

/** The ▾ under a pointer event (which choices it opens), or null. Checked before handleFromEvent: it sits in a button. */
function moreFromEvent(e       )                          {
  for (const el of e.composedPath()) {
    const m = (el               ).dataset?.studioMore;
    if (m === 'axis' || m === 'scale') return m;
  }
  return null;
}

/** The Motion button under a pointer event (its box in the page's px), or null. */
function motionFromEvent(e       )                 {
  for (const el of e.composedPath()) {
    if ((el               ).dataset?.studioMotion !== undefined && (el               ).tagName === 'BUTTON') return (el               ).getBoundingClientRect();
  }
  return null;
}

/** The choice under a pointer event (the strip's menu), or null. */
function choiceFromEvent(e       )                {
  for (const el of e.composedPath()) {
    const c = (el               ).dataset?.studioChoice;
    if (c) {
      const [kind, id] = c.split(':')                            ;
      return { kind, id };
    }
  }
  return null;
}

/** The handle under a pointer event, looking through the shadow root. */
function handleFromEvent(e       )                    {
  for (const el of e.composedPath()) {
    const k = (el               ).dataset?.studioHandle;
    if (k) return k              ;
  }
  return null;
}

__def(__exports, "TOOL_KEYS", () => TOOL_KEYS);
__def(__exports, "TOOL_NUMBERS", () => TOOL_NUMBERS);
__def(__exports, "toolFromKey", () => toolFromKey);
__def(__exports, "MOTION_KEYS", () => MOTION_KEYS);
__def(__exports, "isMotionKey", () => isMotionKey);
__def(__exports, "HANDLE_LABELS", () => HANDLE_LABELS);
__def(__exports, "READOUT_WORDS", () => READOUT_WORDS);
__def(__exports, "TOOL_HINT", () => TOOL_HINT);
__def(__exports, "OFF_LINES", () => OFF_LINES);
__def(__exports, "gameNote", () => gameNote);
__def(__exports, "MORE_LABELS", () => MORE_LABELS);
__def(__exports, "AXIS_WORDS", () => AXIS_WORDS);
__def(__exports, "SCALE_WORDS", () => SCALE_WORDS);
__def(__exports, "TURN_WAY_WORDS", () => TURN_WAY_WORDS);
__def(__exports, "MANY_LABEL", () => MANY_LABEL);
__def(__exports, "createHandles", () => createHandles);
__def(__exports, "moreFromEvent", () => moreFromEvent);
__def(__exports, "motionFromEvent", () => motionFromEvent);
__def(__exports, "choiceFromEvent", () => choiceFromEvent);
__def(__exports, "handleFromEvent", () => handleFromEvent);
};
__defs[31] = function (__exports) {
'use strict';
// rise.ts

// Camera up / down: two small buttons, ↑ over ↓, in the game's bottom-right corner (3D only, while editing).
//
// Play test 2026-10-18: "I can't raise the camera; it's needed." Looking around had orbit (turn round a point), pan
// (slide over the ground: the height never changes) and zoom (along the line of sight), so there was no way to
// just go up — over a wall, above a roof, down to the water. What it does: the camera goes straight up or down,
// looking the same way (adapter view.rise). It only moves when the person asks (the first-wave rule: the view is
// theirs, the tool never moves it by itself).
//
// The ways to do it (input.ts does the gestures; this file only draws the buttons and tells which was pressed):
//   - a click / tap on ↑ or ↓: one step (a tenth of the game's height);
//   - holding it: keeps going (after RISE_HOLD_MS) until let go;
//   - dragging up / down on it (mouse or finger): the camera follows the drag, like a slider;
//   - E / Q (up / down) with nothing picked, or while looking around (Space held, right / middle / ⌥ drag) — the
//     keys 3D tools use for this (Unity, Unreal, Godot: right button + Q / E). With something picked and no
//     look-around held, Q / E keep turning it (the old keys: never taken away);
//   - ⌘K "Camera up" / "Camera down" (the editor page), the one place where the words and the keys are written.
// WHY buttons on the game and not a key alone: a key is found only by people who already know it; a phone has no
// keys; and two fingers already pan and pinch, so a two-finger "up" would take panning forward away.
// WHY its own small shadow root (not in handles.ts with the strip): the strip follows the picked object and is
// gone with nothing picked; these stay in one corner, always. Same glass, same sizes, same theme as the strip.
const { UI } = __require(13);

                                    

/** Tooltips / labels. `picked`: with something picked, E / Q turn it, so the key named is Space + E / Q. */
const RISE_LABELS                                                          = {
  en: (d, p) => `${d === 'up' ? 'Camera up' : 'Camera down'} (${p ? 'Space+' : ''}${d === 'up' ? 'E' : 'Q'})`,
  ja: (d, p) => `${d === 'up' ? 'カメラを上げる' : 'カメラを下げる'}（${p ? 'Space+' : ''}${d === 'up' ? 'E' : 'Q'}）`,
};

                              
                                                                              
                                      
                               
                                          
                                                                                
                            
                                               
                                                            
                                       
                  
 

const ICONS                          = {
  up: '<path d="M7 14.5 12 9.5l5 5"/>',
  down: '<path d="M7 9.5 12 14.5l5-5"/>',
};
/** Gap to the game's edges and to the shell's panels (the hint line's 12). */
const EDGE = 12;
const CSS = `
:host { all: initial; }
.cam { position: fixed; display: grid; gap: 0; padding: 2px; border-radius: 12px; z-index: 2147483646; pointer-events: none;
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); }
button { pointer-events: auto; width: var(--h, ${UI.handlePx}px); height: var(--h, ${UI.handlePx}px); border-radius: 10px; border: 0; padding: 0;
  background: transparent; color: #a1a1a6; display: grid; place-items: center; cursor: ns-resize; touch-action: none; -webkit-tap-highlight-color: transparent;
  transition: background-color .16s cubic-bezier(.2,.8,.2,1), color .16s cubic-bezier(.2,.8,.2,1); }
button:hover { color: #f5f5f7; background: rgba(255,255,255,.07); }
button.on { color: #f5f5f7; background: rgba(255,255,255,.14); transition-duration: 0s; }
button:focus-visible { outline: 2px solid #ff6b1a; outline-offset: 1px; }
svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8px; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.big svg { width: 20px; height: 20px; }
.big { border-radius: 14px; background: rgba(42, 42, 46, .92); box-shadow: 0 0 0 1px rgba(255,255,255,.08); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); }
.big button { border-radius: 12px; }
.light { background: rgba(251,251,253,.8); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.7), 0 1px 1px rgba(0,0,0,.04), 0 10px 32px rgba(0,0,0,.13);
  backdrop-filter: blur(30px) saturate(1.25); -webkit-backdrop-filter: blur(30px) saturate(1.25); }
.light.big { background: rgba(255,255,255,.92); box-shadow: 0 0 0 1px rgba(0,0,0,.08); }
.light button { color: #6e6e73; }
.light button:hover { color: #1d1d1f; background: rgba(0,0,0,.045); }
.light button.on { color: #1d1d1f; background: rgba(0,0,0,.08); }
@media (pointer: coarse) { button:hover { background: transparent; } }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

function createRiseButtons(doc          )              {
  const win = doc.defaultView ;
  const host = doc.createElement('div');
  host.setAttribute('data-studio-ui', ''); // as the strip's host: never taken for a game element
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const box = doc.createElement('div');
  box.className = 'cam';
  box.setAttribute('role', 'group');
  const buttons = {}                                      ;
  for (const dir of ['up', 'down']             ) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.rise = dir;
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[dir]}</svg>`; // static markup only
    buttons[dir] = b;
    box.append(b);
  }
  root.append(style, box);
  (doc.body || doc.documentElement).appendChild(host);

  let inset        = { top: 0, right: 0, bottom: 0, left: 0 };
  let size         = UI.handlePx;
  /** Bottom-right of the part of the game the shell's panels leave free (the right inset only reaches down to rightTo). */
  const position = () => {
    const h = box.offsetHeight || size * 2 + 4;
    const top = win.innerHeight - inset.bottom - EDGE - h;
    const right = inset.rightTo === undefined || top < inset.rightTo ? inset.right : 0;
    box.style.right = `${right + EDGE}px`;
    box.style.top = `${Math.max(inset.top + EDGE, top)}px`;
  };
  const onResize = () => position();
  win.addEventListener('resize', onResize);
  position();

  return {
    fromEvent(e) {
      for (const n of e.composedPath()) {
        const d = (n               ).dataset?.rise;
        if (d === 'up' || d === 'down') return d;
        if (n === host) return null;
      }
      return null;
    },
    setInset(i) {
      inset = i;
      // The shell says when the buttons stand in the way (a phone's card, sheet or menu up): gone until it says again.
      box.style.display = i.camera === false ? 'none' : '';
      position();
    },
    setTheme(theme) {
      box.classList.toggle('light', theme === 'light');
    },
    setSize(px) {
      size = px;
      box.style.setProperty('--h', `${px}px`);
      box.classList.toggle('big', px >= 40);
      position();
    },
    setLabels(lang, picked) {
      for (const dir of ['up', 'down']             ) {
        const text = (RISE_LABELS[lang] || RISE_LABELS.en)(dir, picked);
        buttons[dir].title = text;
        buttons[dir].setAttribute('aria-label', text);
      }
    },
    setActive(dir) {
      for (const d of ['up', 'down']             ) buttons[d].classList.toggle('on', d === dir);
    },
    destroy() {
      win.removeEventListener('resize', onResize);
      host.remove();
    },
  };
}

__def(__exports, "RISE_LABELS", () => RISE_LABELS);
__def(__exports, "createRiseButtons", () => createRiseButtons);
};
__defs[32] = function (__exports) {
'use strict';
// snap.ts

// Snap to surfaces, the rules the bridge applies on top of the adapter's measures (3D; a request after a try of the editor, 2026-10-19: "in Unreal,
// an object moved up or down stops once when it meets the ground or another thing — I want to set things down
// exactly on the ground"). Pure: no DOM, no adapter, so test/snap.test.ts can say how each case ends.
//
// The three moves (adapters/three/surface.js finds the surfaces; the adapter does the move itself):
// - Height (the H tool, its drag): going down, the object's bottom stops on the first surface below it (the ground,
//   a pier's planks, a crate's lid). Pulling on past it by BREAK_PX (a mouse) / BREAK_PX_TOUCH (a finger) lets it go
//   through — under the water, into the ground — and the next surface down stops it again. Going up never stops (a
//   thing under a table is lifted out through it, as in the engines). `liftDetent` below.
// - PgDn (one step down): a step that would cross a surface ends on it; the next step from there goes through
//   (`stepDetent`). The step is the detent's "pull harder".
// - Move and Drop to floor (End) live in the adapter (adapter.js drag / drop): they need the ray casts every time.
// - Hold Ctrl or ⌥ / Alt while dragging: no snapping for as long as it is held (`freeHeld`). Blender's habit (its
//   manual: snapping is toggled "more temporarily by holding Ctrl"); ⌥ as well because Ctrl-click is the Mac's right
//   click and people reach for Option there. Pressed BEFORE the press, ⌥ still looks around (input.ts): it frees the
//   snap only once the drag is under way.
// WHY a detent (stop, then go on) and not a hard floor: things sometimes belong half in the ground (a post, a rock
// sunk in sand, a barrel floating low), and a floor you cannot pass would need a second key to get there.

/** Extra pull past a surface, in screen px, before the height drag lets go of it (a mouse; ~a fingertip for touch). */
const BREAK_PX = 30;
const BREAK_PX_TOUCH = 44;
/** Metres: closer than this counts as "on" the surface (the bottom sits on it; float noise on a 100 m scene stays under). */
const ON_EPS = 0.005;

/** World heights of the object's bottom and of the highest surface under it (null: nothing below), as adapter.rest gives them. */
                       
                 
                       
 

/** State kept for one height drag: the surface pulled through (null: none), so it does not catch again. */
                              
                         
 

/**
 * The height drag's move, with the stop: `want` = the metres up (> 0) / down (< 0) the finger asks for now, from
 * where the object is; `k` = metres per screen px at the object (> 0). Returns the metres to move.
 * - want ≥ 0, or nothing below: as asked.
 * - the bottom already under the surface (sunk, or pulled through it before): as asked — the surface is not
 *   between the object and where it goes.
 * - the move would cross the surface: stop on it, until the finger is BREAK_PX past it; then let go (st.through)
 *   and move as asked.
 * - back above a surface it was pulled through: that surface catches again (st.through is cleared).
 */
function liftDetent(r             , want        , k        , st             , breakPx = BREAK_PX)         {
  if (!r) return want;
  if (st.through !== null && r.bottom > st.through + ON_EPS) st.through = null;
  if (want >= 0 || r.below === null) return want;
  const s = r.below;
  if (st.through !== null && s >= st.through - ON_EPS) return want;
  if (r.bottom < s - ON_EPS) return want;
  const land = s - r.bottom; // ≤ ~0: the move that sets the bottom on the surface
  if (want >= land) return want; // stays above it
  const pastPx = (land - want) / Math.max(1e-9, k);
  if (pastPx < breakPx) return land;
  st.through = s;
  return want;
}

/**
 * One PgDn step (`d` < 0 metres) with the stop: a step that would carry the bottom from above the surface to under
 * it ends on the surface; from on it (within ON_EPS) the step goes through. Up steps as asked.
 */
function stepDetent(r             , d        )         {
  if (!r || r.below === null || d >= 0) return d;
  const s = r.below;
  if (r.bottom > s + ON_EPS && r.bottom + d < s) return s - r.bottom;
  return d;
}

/** Is the "no snapping" key held (Ctrl, or ⌥ / Alt)? Read from the pointer / key event. */
const freeHeld = (e                                         )          => !!(e.ctrlKey || e.altKey);

/**
 * Several objects moved up / down together (a group's height drag, PgDn / End with several picked): the one that meets
 * its surface first decides — the smallest gap between a bottom and the surface under it, among those on or above
 * theirs. The group then stops as one piece, its arrangement kept. null: none has a surface under it.
 */
function firstToTouch(rests                                )              {
  let best              = null;
  for (const r of rests) {
    if (!r || r.below === null || r.bottom < r.below - ON_EPS) continue;
    if (!best || r.bottom - r.below < best.bottom - best.below ) best = r;
  }
  return best;
}

__def(__exports, "BREAK_PX", () => BREAK_PX);
__def(__exports, "BREAK_PX_TOUCH", () => BREAK_PX_TOUCH);
__def(__exports, "ON_EPS", () => ON_EPS);
__def(__exports, "liftDetent", () => liftDetent);
__def(__exports, "stepDetent", () => stepDetent);
__def(__exports, "freeHeld", () => freeHeld);
__def(__exports, "firstToTouch", () => firstToTouch);
};
__defs[33] = function (__exports) {
'use strict';
// input.ts

// Pointer, wheel and key input in the game page while editing, plus the
// handles drawn next to the selected object.
//
// Rules (CONTRACT.md §2), and why:
// - Pressing an object only SELECTS it, on release, if the pointer did not
//   travel. Dragging anywhere else — including over objects that are not
//   picked — looks around (3D) or pans (2D). When ANY drag on an object moved
//   it (before 2026-10-16), fingers meant to select or look around nudged
//   things and a large ground mesh was easy to grab by accident.
// - Dragging the object that is ALREADY picked moves it (rebrand 2026-10-16:
//   the tool strip under it replaced the four round handles, and "drag the
//   thing itself" is what every other editor does). It needs a pick first, so
//   a stray drag never moves anything; very large objects (ground, sky: their
//   on-screen part 60 % of the window or more) and locked ones still look
//   around when dragged, which keeps the accident above impossible.
// - Tool modes (play test 2026-10-16): a press on a strip button (or
//   M / H / T / S) CHOOSES that tool and it stays pressed; then a drag
//   ANYWHERE on the game does it to what is picked — move follows the drag,
//   height goes with the vertical drag, turn with the horizontal drag (on the
//   chosen axis), size grows dragging right / up and shrinks left / down.
//   Before, only "drag the object" moved without holding a button; turn,
//   height and size needed the mouse held ON the small button while moving,
//   which felt unnatural in the play test. A drag started on a button still
//   works the old way. With a tool chosen, looking around is Option-drag
//   (orbit), right / middle drag (pan), Space held, two fingers on touch,
//   the wheel / trackpad; with nothing picked a drag always looks around
//   (there is nothing to act on). Escape: closes the choices, then drops the
//   tool, then the pick. A tap still picks (the tool stays chosen).
// - Pressing the same spot again picks the next object under it (the one
//   behind), so small objects hidden by large ones stay reachable.
// - A tap on "nothing" drops the pick (a web demo try 2026-10-18: "I want to click
//   an empty spot to deselect, and I can't"). Nothing = no object there, OR
//   only the background: a ground / background (Item.backdrop) or an object
//   whose on-screen part covers 60 % of the window or more (HUGE_ON_SCREEN,
//   the same rule that makes a drag on it look around). People call the sky,
//   the sea and the grass "nothing"; a tap there used to pick the ground. Such
//   objects are picked from the list. A press that travels past the tap slop
//   is a look-around and keeps the pick (as in other 3D editors: turning the
//   view never changes what is picked). The 3D side of "no object there" is in
//   adapters/three/pick.js (a box near the press is not enough: the lighthouse's
//   light beam made its box cover half the sky).

// - One gesture = one undo step: every `moved` of a gesture is sent, the last
//   one carries `end: true` and `from` (the pose before the gesture).
// - Listeners sit on window in the capture phase and are installed before any
//   game code, so they run first and can stop the game from also reacting.
// - A blur (the shell taking focus after a selection) must NOT forget an
//   active pointer: the next pointermove would otherwise be dropped and the
//   drag would stop half-way. Stale pointers are cleaned up by reliable
//   signals instead (a mouse move with no buttons pressed, a new press with
//   the same id). A release is taken from the first sign of it — pointerup,
//   lostpointercapture with no button, click, a pointerup in the page above —
//   at once, never on the next press (first-click pass 2, see onLost).
// - Several objects (CONTRACT.md §1.8): Shift+click (or a press in "select
//   several" mode) adds or removes one; Shift+drag from an empty spot (or a
//   mouse drag from an empty spot in that mode) draws a box. The handles then
//   sit under the whole group and move / turn / resize all of it (group.ts).
//   WHY not a plain drag for the box: a plain drag has always looked around,
//   on objects and next to them, and that must keep working the same.
// - Camera up / down (3D, play test 2026-10-18; rise.ts says why and how it is
//   found): the ↑↓ buttons (a click = a step, held = keeps going, dragged =
//   follows the drag) and E / Q when nothing is picked or while looking
//   around. A press on the buttons is never a tap on "nothing": the pick stays.
// - Fly (3D, camera-wasd pass 2026-10-18 — "anyone who has used a 3D game engine moves the camera with WASD too"):
//   W / S forward / back LEVEL (along the ground the way the camera faces: looking down, the height stays — a try
//   2026-10-19: "W/S as level forward / back"; it followed the line of sight on 10-18), A / D left / right, E / Q
//   straight up / down (Unreal's E up / Q down), Shift ×3 — smooth
//   while held, stopped on release (each frame, core.time.raf), at a speed the adapter takes from the scene's size
//   (adapters/three/camera.js fly). When: with nothing picked always (W A S D have no other job then: the tool keys
//   need a pick); with something picked only while the right button is held (Unity / Unreal / Godot's fly mode),
//   because then S is the Size tool and E / Q turn the pick — those keep their meaning without the right button.
//   E / Q also fly while looking around in the other ways (Space held, a middle / ⌥ drag), as before. Holding the
//   right button and pressing a fly key turns that drag into a fly-through look (view.look: the view turns where
//   the camera stands, as in the engines) instead of a pan, and its release opens no menu. Keys pressed in the
//   editor page come as studio:core/fly (shell/main.ts decides there). Never by itself: no key, no move.
// - The place's menu (context menu, 2026-10-18; a request after a try of the editor: "right-click in each place should bring up the menu for it —
//   in the scene, duplicate, delete, that kind of thing"): a right-click that did not travel (Mac: also Control-click),
//   or a touch held still for LONG_PRESS_MS away from the strip's buttons, sends placement/context; the editor page
//   draws the menu (shell/context-menu.ts). An object under it that is not picked yet is picked first (select(),
//   never focus: the camera stays where it is), as other 3D / 2D tools do; one already in the selection keeps the
//   whole selection. Nothing under it (or only the ground) keeps the pick: the menu then has Deselect. A right DRAG
//   still pans (the menu waits for the release, as in Blender / Unity), so the press never moves the view by itself.
// - Snap to surfaces (3D, a try of the editor, 2026-10-19; bridge/snap.ts has the rules): while a move or height drag is under way
//   the adapter snaps (setSnap on; off when the gesture ends). The height drag stops on the first surface below
//   (liftDetent); Ctrl or ⌥ held during the drag frees it, and pressing / letting go of them re-reads the drag at
//   once (no need to move the pointer).
const { UI } = __require(13);
                                             
const { nativeClearTimeout, nativeNow, nativeSetTimeout } = __require(0);
const { keyStep } = __require(29);
                                             
                                                
const { HANDLE_LABELS, MANY_LABEL, OFF_LINES, gameNote, READOUT_WORDS, TOOL_HINT, choiceFromEvent, createHandles, handleFromEvent, isMotionKey, moreFromEvent, motionFromEvent, toolFromKey } = __require(30);
                                                     
const { createRiseButtons } = __require(31);
const { BREAK_PX, BREAK_PX_TOUCH, firstToTouch, freeHeld, liftDetent } = __require(32);
const { canLift, offWhy } = __require(26);
const { beginGroup, groupAnchor, groupLift, groupMove, groupPoses, groupRotate, groupScale } = __require(27);

                            
                         
             
                                  
                                     
                   
                                                        
                                                                                         
                                                               
                                                            
                      
                                                                               
                                                                                  
                  
                        
                                                                                                                     
                                 
                                                                                                        
                      
 

                              
                
                           
                            
                                  
                                                                                           
                               
                                                                             
                                         
                                                                        
                                         
                                                                          
                    
                                                                                   
                                                                                    
                                                                                                          
                      
                                                                              
                             
                                                                                                        
                                              
                                          
                                                                                
                                                         
                                                                                                                        
                                 
     
                                                                                                                         
                                                                                                                         
                           
     
                                             
                 
 

               
             
               
            
            
             
             
                 
                 
                                                                          
               
                                                                                                                  
                 
                                                                                                                                  
                 
 

/** What the current single-pointer gesture does. */
           
                                                                     
                                  
                                                                                                                    
                                                                                                                                 
                                                                                                                                          
                   
                                                           
                                                                                                                       
                                                               
                    
                     

const SNAP = (15 * Math.PI) / 180;
const SNAP_WINDOW = (3 * Math.PI) / 180;
/** Tool dragged anywhere: radians of turn per px of horizontal drag (0.01 ≈ 0.57°/px: a full turn in ~630 px, 15° in ~26 px). */
const TURN_PER_PX = 0.01;
/** Size per px of drag (right / up = bigger): ×2 after ~140 px of travel, ×0.5 after the same the other way. */
const SIZE_PER_PX = 0.005;
/** localStorage flag: the "how to look around" line was seen (it shows once, on this computer). */
const HINT_SEEN = 'gameStudio.toolHint.v1';
/** An object whose on-screen part covers this share of the window or more is "huge" (a ground): a drag on it looks around, and a tap on it is a tap on nothing (deselect, 2026-10-18). 0.6 (W1 merge); 0.4 of the whole projected box before. */
const HUGE_ON_SCREEN = 0.6;
/**
 * A press held this long on the turn / size button (without moving) opens its choices, like the ▾ (tool options,
 * play test 2026-10-18). 450 ms: past a tap (~100-200 ms) and a hesitant press-then-drag, short of iOS's 500 ms callout.
 * The same length opens the place's menu on a touch held anywhere else on the game (context menu, 2026-10-18): one
 * long press, one feel; the two never meet (the strip's is on its buttons only, the menu's never starts on them).
 */
const LONG_PRESS_MS = UI.longPressMs;
/** Control-click is the Mac's right-click (one-button mice, trackpads without two-finger click set up). */
const MAC = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || globalThis.navigator?.userAgent || '');
/**
 * Camera up / down (rise.ts), as shares of the game's height: a click on ↑ / ↓ moves a tenth (big enough to see,
 * small enough to aim: ~10 clicks lift the view by a whole screen); E / Q a twentieth per press — key repeat
 * (~30 / s) then gives ~1.5 screens a second; Shift = a fifth of that (as Shift = fine for the other keys).
 */
const RISE_STEP = 0.1;
const RISE_KEY_STEP = 0.05;
/** Held this long on ↑ / ↓ without moving, the camera keeps going at RISE_HOLD_PER_S screens a second until let go. */
const RISE_HOLD_MS = 350;
const RISE_HOLD_PER_S = 0.6;
/**
 * Fly keys (see the header) by KeyboardEvent.code, the key's PLACE: WASD stays under the left hand on AZERTY / QWERTZ
 * as in the engines. (E / Q were read by e.key before; on QWERTY that is the same.) `[right, up, forward]`.
 */
const FLY_DIRS                                           = { w: [0, 0, 1], s: [0, 0, -1], a: [-1, 0, 0], d: [1, 0, 0], e: [0, 1, 0], q: [0, -1, 0] };
const FLY_CODES                         = { KeyW: 'w', KeyA: 'a', KeyS: 's', KeyD: 'd', KeyE: 'e', KeyQ: 'q' };
/** Shift while flying: ×3 (engines' "fast"; Shift = fine for the step keys, but flying slower than this is never wanted). */
const FLY_FAST = 3;
/**
 * A fresh press moves this many seconds' worth at once, then the hold goes on smoothly: a tap still moves visibly.
 * 0.06 s ≈ the E / Q step before flying (RISE_KEY_STEP, a twentieth of the view), so a tap of E feels as it did.
 */
const FLY_KICK_S = 0.06;

/** A field of the page's own (the game's inputs, a contenteditable): its keys are typing, never flying. */
function typingIn(t                    )          {
  const el = t                      ;
  if (!el || typeof el.tagName !== 'string') return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || !!el.isContentEditable;
}

function wrap(a        )         {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}
const samePose = (a      , b      ) => JSON.stringify(a) === JSON.stringify(b);
/** One number for a pose's size (the first of three when they differ), never 0. */
const sizeOf = (p      ) => Math.abs((Array.isArray(p.s) ? p.s[0] : p.s) ?? 1) || 1;

/** Share of the window (0–1) covered by the object's on-screen part (its box, clipped to the window). */
function screenShareOf(adapter               , win        , k        )         {
  // 3D: the adapter's own measure (a ground running on under the camera; see StudioAdapter.coverage).
  try {
    const c = adapter.coverage?.(k);
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  } catch {
    /* fall back to the box */
  }
  const r = adapter.anchor(k)?.rect;
  if (!r) return 0;
  // Clipped: the rect is the projected box, so it runs past the window's edges (see grabbable below).
  const vw = win.innerWidth, vh = win.innerHeight;
  const cw = Math.max(0, Math.min(vw, r.x + r.w) - Math.max(0, r.x));
  const ch = Math.max(0, Math.min(vh, r.y + r.h) - Math.max(0, r.y));
  return vw * vh > 0 ? (cw * ch) / (vw * vh) : 0;
}

/**
 * What a tap at (x, y) may pick, best first: pickNear without the ground / background (an Item.backdrop, or a huge
 * object: what a person calls "nothing" when tapping, see the header). Module-level (first-click pass, 2026-10-20) so
 * the editor can read a press made while it was still getting ready (early-press.ts) the same way a tap is read.
 */
function tappableAt(adapter               , items        , win        , x        , y        , radius        )           {
  try {
    return adapter.pickNear(x, y, radius).filter((k) => !items.find((i) => i.key === k)?.backdrop && screenShareOf(adapter, win, k) < HUGE_ON_SCREEN);
  } catch {
    return [];
  }
}

function attachInput(deps           )              {
  const { adapter, win, post, state, select, selectMany, step, markDirty, tools, edits, core } = deps;
  const toolEvent = (type                        , p     ) => ({ type, x: p.x, y: p.y, pointerType: p.type, shift: p.shift });
  const doc = win.document;
  const ptrs = new Map             ();
  let mode       = { kind: 'none' };
  let lastTap                                                      = null;
  let lang       = 'en';
  const handles          = createHandles(doc, adapter.dim === '3d' && !!adapter.nudgeY);
  // Camera up / down: 3D adapters with view.rise only (2D has no height to go up: its view only pans and zooms).
  const riseUi = adapter.dim === '3d' && adapter.view.rise ? createRiseButtons(doc) : null;
  const riseLabels = () => riseUi?.setLabels(lang, !!state.selected);
  riseLabels();
  /** Camera up (dy > 0) / down by dy px; the view state goes to the shell when the gesture or key ends. */
  const riseBy = (dy        ) => {
    if (!adapter.view.rise || !dy) return;
    adapter.view.rise(dy);
    markDirty();
  };
  // Held ↑ / ↓: keeps going every frame after RISE_HOLD_MS (stops by itself once the gesture is no longer 'rise').
  // core.time.raf, not win.requestAnimationFrame: while editing the game's frames are frozen, and the page's rAF is
  // the game's (core/time.ts) — the first try used it and a held ↑ moved one step only (2026-10-18).
  let riseFrame = 0;
  let riseLast = 0;
  const riseHold = (now        ) => {
    riseFrame = 0;
    if (mode.kind !== 'rise' || mode.follow) return;
    if (now - mode.t0 >= RISE_HOLD_MS) {
      const dt = Math.min(0.1, (now - Math.max(riseLast, mode.t0 + RISE_HOLD_MS)) / 1000);
      riseBy((mode.dir === 'up' ? 1 : -1) * RISE_HOLD_PER_S * dt * win.innerHeight);
      riseLast = now;
    }
    riseFrame = core.time.raf(riseHold);
  };
  const riseEnd = () => {
    if (riseFrame) core.time.cancelRaf(riseFrame);
    riseFrame = 0;
    riseUi?.setActive(null);
    post({ type: 'studio:core/view-state', state: adapter.view.state() });
  };
  // Fly (see the header): keys held in the game page / in the shell, Shift for each, and the frame that moves.
  const flyHeld = new Set        ();
  let flyFast = false;
  let shellFly           = [];
  let shellFast = false;
  let flyFrame = 0;
  let flyLast = 0;
  let flyMoved = false;
  const canFly = () => adapter.dim === '3d' && !!adapter.view.fly;
  const rightHeld = () => [...ptrs.values()].some((p) => p.type === 'mouse' && p.button === 2);
  /** May this key fly now? W A S D: nothing picked, or the right button held. E / Q: also while looking around (as before). */
  const flyOk = (k        ) =>
    !state.selected || rightHeld() || ((k === 'e' || k === 'q') && (spaceHeld || mode.kind === 'look' || [...ptrs.values()].some(looksAround)));
  /** Move by `dt` seconds of every key that may fly now; true when something moved. */
  const flyBy = (keys                  , dt        , fast         , all = false) => {
    let r = 0, u = 0, f = 0;
    for (const k of keys) {
      if (!all && !flyOk(k)) continue;
      const d = FLY_DIRS[k];
      r += d[0];
      u += d[1];
      f += d[2];
    }
    if (!r && !u && !f) return false;
    const m = dt * (fast ? FLY_FAST : 1);
    adapter.view.fly (r * m, u * m, f * m);
    // The right-drag under way turns where the camera stands from now on (onMove) and opens no menu (onUp).
    for (const p of ptrs.values()) if (p.type === 'mouse' && p.button === 2) p.flew = true;
    flyMoved = true;
    markDirty();
    return true;
  };
  const flyStep = (now        ) => {
    flyFrame = 0;
    if (!flyHeld.size && !shellFly.length) {
      flyStop();
      return;
    }
    const dt = Math.min(0.1, (now - flyLast) / 1000);
    flyLast = now;
    if (dt > 0) {
      flyBy(flyHeld, dt, flyFast);
      flyBy(shellFly, dt, shellFast, true);
    }
    flyFrame = core.time.raf(flyStep);
  };
  const flyStart = () => {
    if (flyFrame) return;
    flyLast = nativeNow();
    flyFrame = core.time.raf(flyStep);
  };
  /** Every key let go (or the page lost them): stop, and tell the shell where the view ended (kept across reloads). */
  const flyStop = () => {
    if (flyFrame) core.time.cancelRaf(flyFrame);
    flyFrame = 0;
    if (flyMoved) post({ type: 'studio:core/view-state', state: adapter.view.state() });
    flyMoved = false;
  };
  const flyKeyOf = (e               )                => FLY_CODES[e.code] ?? (e.code ? null : (FLY_CODES[`Key${e.key.toUpperCase()}`] ?? null));
  // A press on the picked object: a drag from it moves it (see the header).
  let grabStart = false;
  // The chosen strip tool (stays until another is chosen or Escape), and a press that will use it.
  let tool                    = null;
  let toolStart = false;
  // Space held (in the game page, or in the shell via placement/look): drags look around.
  let spaceHeld = false;
  let hintShown = false;
  let hintTimer = 0;
  const hintSeen = () => {
    try {
      return win.localStorage.getItem(HINT_SEEN) === '1';
    } catch {
      return false;
    }
  };
  const touchFirst = () => win.matchMedia?.('(pointer: coarse)').matches ?? false;
  const showHint = () => {
    if (!tool || hintShown || hintSeen()) return;
    hintShown = true;
    const words = TOOL_HINT[lang] || TOOL_HINT.en;
    const rw = READOUT_WORDS[lang] || READOUT_WORDS.en;
    // The way the drag works now (a tilt chosen on the ▾ says "tilt forward", not "turn").
    const name = tool === 'rotate' && canTurn() && state.axis !== 'y' ? rw[state.axis === 'x' ? 'tipX' : 'tipZ'] : rw[tool];
    handles.hint(touchFirst() ? words.touch(name) : words.mouse(name));
    // Gone after the first drag with the tool (it was read and used), or after 8 s.
    nativeClearTimeout(hintTimer);
    hintTimer = nativeSetTimeout(() => handles.hint(null), 8000);
  };
  const hintUsed = () => {
    if (!hintShown) return;
    handles.hint(null);
    try {
      win.localStorage.setItem(HINT_SEEN, '1');
    } catch {
      /* private window: shows again next time, which is fine */
    }
  };
  /** Can the chosen tool act on what is picked (its button is shown)? */
  const toolApplies = (k            ) => {
    const picked = state.items.filter((i) => (state.group.length > 1 ? state.group.includes(i.key) : i.key === state.selected));
    if (!picked.length) return false;
    if (k === 'move') return picked.some((i) => i.movable !== false);
    if (k === 'lift') return adapter.dim === '3d' && !!adapter.nudgeY && picked.some((i) => canLift(i));
    if (k === 'rotate') return picked.some((i) => i.rotatable);
    return picked.some((i) => i.scalable);
  };
  /**
   * Why tool `k` does not work on what is picked, or null (studio-tool-clear, 2026-10-23): the strip dims it and a press
   * on it, or its key, does nothing (studio-move-plain, 2026-10-23: the menu it opened is gone); the why is the small
   * line by the strip (noteOf). With several picked: off only when it works on none of them (the strip's old rule,
   * some()), and the why is the first one's.
   */
  const offOf = (k            )                => {
    if (k === 'lift' && !(adapter.dim === '3d' && adapter.nudgeY)) return null;
    const picked = state.items.filter((i) => (state.group.length > 1 ? state.group.includes(i.key) : i.key === state.selected));
    if (!picked.length) return null;
    const whys = picked.map((i) => offWhy(i, k));
    return whys.some((w) => w === null) ? null : whys[0] ;
  };
  const offLines = () => {
    const out                                      = {};
    for (const k of ['move', 'lift', 'rotate', 'scale']                ) {
      const w = offOf(k);
      if (w) out[k] = (OFF_LINES[lang] || OFF_LINES.en)[w][k];
    }
    return out;
  };
  /**
   * The one small line by the strip (studio-move-plain, 2026-10-23), or null: one thing the game moves — what the game
   * does to it and, when it moves it, that a move here sets where it starts (handles.ts gameNote); else the why of the
   * first dimmed tool. Several picked: the why only (a group has no one game motion to tell).
   */
  const noteOf = (off                                     )                => {
    const picked = state.items.filter((i) => (state.group.length > 1 ? state.group.includes(i.key) : i.key === state.selected));
    if (picked.length === 1 && picked[0] .held === 'game' && picked[0] .driven?.length) {
      const g = gameNote(lang, picked[0] .driven.filter((k) => k !== 'lift' || adapter.dim === '3d'));
      if (g) return g;
    }
    for (const k of ['move', 'lift', 'rotate', 'scale']                ) if (off[k]) return off[k] ;
    return null;
  };
  const stripCaps = () => {
    const off = offLines();
    return { off, note: noteOf(off) };
  };
  /**
   * Does the turn / size button have choices right now (its ▾ shows)? Turn: 3D (the axes, canTurn), or several picked
   * (together / each in place, 2D too: multi rotate, play test 2026-10-18 — before, several turned "together" upright
   * only and a 2D turn button had no ▾). Size: several picked (tool options, 2026-10-18).
   */
  const hasChoices = (kind                  ) =>
    kind === 'axis' ? (canTurn() || state.group.length > 1) && toolApplies('rotate') : state.group.length > 1 && toolApplies('scale');
  /** Open (`kind`) or close (null) the strip's choices, and tell the editor page so a press or Escape there closes them. */
  const menu = (kind                         ) => {
    const was = handles.menuOpen();
    // The turn button's choices: the axes (3D) and, with several picked, together / each in place under them.
    const turnRows = { axes: canTurn(), way: state.group.length > 1 ? state.turnMode : null };
    handles.menu(kind, kind === 'axis' ? state.axis : kind === 'scale' ? state.scaleMode : '', lang, turnRows);
    const now = handles.menuOpen();
    if (!!was !== !!now) post({ type: 'studio:placement/menu', open: !!now });
  };
  const chooseTool = (k                   , from                                    ) => {
    if (k === 'lift' && !(adapter.dim === '3d' && adapter.nudgeY)) return;
    // A tool that does not work on the pick is never chosen (a key, ⌘K, the editor page): nothing happens, and the
    // why is already the small line by the strip (studio-move-plain — before, a menu opened at the button).
    if (k && offOf(k)) return;
    const changed = k !== tool;
    tool = k;
    handles.setTool(k);
    if (changed) post({ type: 'studio:placement/tool', tool: k });
    // A tap on a button only chooses its tool, with the way last used (turn: upright at first; size: together).
    // The choices open from the ▾ in the button's corner or a long press (tool options, play test 2026-10-18: "nobody
    // presses a button twice"). History: the turn choices opened on the first tap until the polish pass 2026-10-16
    // (a newcomer had to answer "Turn / Tilt forward / Tilt sideways" first), then on a second tap, which nobody
    // found; the size choices (several picked) opened on the first tap until 2026-10-18.
    if (handles.menuOpen()) menu(null);
    if (k) showHint();
    else handles.hint(null);
  };
  /** The press looks around even with a tool chosen: Option, a right / middle button, or Space held. */
  const looksAround = (p     ) => p.type === 'mouse' && (p.button !== 0 || p.alt || spaceHeld);
  // 3D turns around three axes (adapter.turn). Groups too since 2026-10-18 (multi rotate; upright only before).
  const canTurn = () => adapter.dim === '3d' && !!adapter.turn;
  /** How the group turns now (the turn button's choices). */
  const turnWay = () => ({ axis: canTurn() ? state.axis : ('y'            ), mode: state.turnMode });
  let axisShown                  = null;
  const showAxis = () => {
    const ax           = canTurn() ? state.axis : 'y';
    if (ax === axisShown) return;
    axisShown = ax;
    handles.setAxis(ax, lang);
  };
  // What was picked when the turn way was last kept (selectionChanged resets the way on another pick).
  let pickSig = '';
  const setAxis = (ax                   ) => {
    const order             = ['y', 'x', 'z'];
    state.axis = ax === 'next' ? order[(order.indexOf(state.axis) + 1) % 3]  : ax;
    showAxis();
    if (handles.menuOpen() === 'axis') menu('axis');
  };
  const toggleMenu = (kind                  ) => menu(handles.menuOpen() === kind ? null : kind);
  // The long press on the turn / size button (LONG_PRESS_MS): armed at the press, checked when it fires.
  let pressTimer = 0;
  const armLongPress = (id        , kind                  ) => {
    nativeClearTimeout(pressTimer);
    pressTimer = nativeSetTimeout(() => {
      const p = ptrs.get(id);
      if (!p || ptrs.size !== 1 || (mode.kind !== 'handle' && mode.kind !== 'group') || mode.anywhere) return;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) return;
      // Held still: nothing changed yet, so ending the gesture records no undo step. Forget the pointer so its
      // release is not read as a tap (which would choose the tool, or close the choices again).
      endGesture();
      ptrs.delete(id);
      menu(kind);
    }, LONG_PRESS_MS);
  };

  // Stop page scrolling/zooming by touch while editing; restored on detach.
  const prevTouchAction = doc.documentElement.style.touchAction;
  doc.documentElement.style.touchAction = 'none';

  const opts = { capture: true, passive: false }                           ;
  const block = (e       ) => {
    // Keep the game from seeing input while it is being edited. Our own
    // handlers below run first because they were added before the game's.
    e.stopImmediatePropagation();
    if (e.cancelable && e.type !== 'keyup') e.preventDefault();
  };
  const blocked = ['mousedown', 'mouseup', 'mousemove', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend', 'touchcancel', 'contextmenu', 'keyup', 'keypress', 'gesturestart', 'gesturechange'];

  const emitMoved = (key        , pose      , extra                                                                      = {}) => {
    markDirty();
    post({ type: 'studio:placement/moved', key, pose, ...extra });
  };

  const startGroup = (handle            , p     , anywhere = false)       => {
    const session = beginGroup(adapter, state.group, state.selected );
    if (!session) return { kind: 'none' };
    const ga = groupAnchor(adapter, session.keys, session.primary);
    const data                         = { d: 0, f: 1 };
    if (ga) {
      data.angle = Math.atan2(p.y - ga.center[1], p.x - ga.center[0]);
      data.dist = Math.max(8, Math.hypot(p.x - ga.center[0], p.y - ga.center[1]));
    }
    snapOn(handle);
    detent = { through: null };
    data.breakPx = p.type === 'mouse' ? BREAK_PX : BREAK_PX_TOUCH;
    if (handle === 'lift') {
      // Same probe as one object, on the first member: world units per px.
      const a = adapter.anchor(session.primary);
      if (a && adapter.nudgeY) {
        data.gap = p.y - a.center[1];
        adapter.nudgeY(session.primary, 0.1);
        const b = adapter.anchor(session.primary);
        adapter.nudgeY(session.primary, -0.1);
        const px = b ? a.center[1] - b.center[1] : 0;
        data.k = Math.abs(px) > 0.5 ? 0.1 / px : 0.01;
      }
    }
    if (!anywhere) handles.setActive(handle);
    return { kind: 'group', handle, session, x0: p.x, y0: p.y, data, anywhere };
  };

  const moveGroup = (m                                  , p     ) => {
    const { session: s, data } = m;
    lastRead = p;
    if (m.handle === 'move' || m.handle === 'lift') adapter.setSnap?.({ on: true, free, skip: snapKeys() });
    const ga = groupAnchor(adapter, s.keys, s.primary);
    if (m.anywhere && (m.handle === 'rotate' || m.handle === 'scale')) {
      // The chosen tool dragged anywhere: the drag's own travel, from the press.
      if (m.handle === 'rotate') {
        let d = (p.x - m.x0) * TURN_PER_PX;
        const t = Math.round(d / SNAP) * SNAP;
        if (!p.shift && Math.abs(t - d) <= SNAP_WINDOW) d = t;
        groupRotate(adapter, adapter.dim, s, d, turnWay());
      } else groupScale(adapter, adapter.dim, s, Math.exp((p.x - m.x0 - (p.y - m.y0)) * SIZE_PER_PX), state.scaleMode);
    } else if (m.handle === 'move') groupMove(adapter, adapter.dim, s, p.x - m.x0, p.y - m.y0);
    else if (m.handle === 'rotate' && ga) {
      // The turn centre stays where the group started (s.center): measuring
      // around the moving middle would wobble.
      const ang = Math.atan2(p.y - s.center[1], p.x - s.center[0]);
      data.d = data.d  + wrap(ang - data.angle );
      data.angle = ang;
      let d = data.d ;
      // 15° steps within ±3° unless Shift, like one object.
      const t = Math.round(d / SNAP) * SNAP;
      if (!p.shift && Math.abs(t - d) <= SNAP_WINDOW) d = t;
      groupRotate(adapter, adapter.dim, s, d, turnWay());
    } else if (m.handle === 'scale') {
      const dist = Math.max(8, Math.hypot(p.x - s.center[0], p.y - s.center[1]));
      groupScale(adapter, adapter.dim, s, dist / data.dist , state.scaleMode);
    } else if (m.handle === 'lift') {
      const a = adapter.anchor(s.primary);
      if (!a) return;
      const err = a.center[1] - (p.y - data.gap );
      const keys = s.keys.filter((k) => canLift(s.items.get(k))); // the members groupLift moves (group.ts)
      const dy = Math.max(-5, Math.min(5, liftWith(keys, err * data.k , data.k , data.breakPx )));
      if (Math.abs(dy) > 1e-6) groupLift(adapter, s, dy);
    }
    markDirty();
    post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, s, false), press: m.handle });
    const from = s.from.get(s.primary), now = adapter.anchor(s.primary)?.pose;
    if (from && now) handles.readout(readout(m.handle, from, now, canTurn() ? state.axis : 'y'));
  };

  const startHandle = (handle            , p     , anywhere = false)       => {
    if (state.group.length > 1) return startGroup(handle, p, anywhere);
    const key = state.selected ;
    const a = adapter.anchor(key);
    if (!a) return { kind: 'none' };
    const from = a.pose;
    const data                         = { breakPx: p.type === 'mouse' ? BREAK_PX : BREAK_PX_TOUCH };
    snapOn(handle);
    detent = { through: null };
    if (handle === 'move') {
      if (!adapter.grab(key, p.x, p.y)) return { kind: 'none' };
    } else if (handle === 'rotate') {
      // 3D turns go around the middle of the object's box (adapter.turn): measure the finger around that.
      const r = a.rect;
      data.cx = canTurn() && r ? r.x + r.w / 2 : a.center[0];
      data.cy = canTurn() && r ? r.y + r.h / 2 : a.center[1];
      data.angle = Math.atan2(p.y - data.cy, p.x - data.cx);
      data.sign = 0; // learnt from the first response: +1 if pose.r grows with d
    } else if (handle === 'scale') {
      data.dist = Math.max(8, Math.hypot(p.x - a.center[0], p.y - a.center[1]));
    } else if (handle === 'lift') {
      // Keep the vertical gap between finger and pivot constant. World units
      // per screen px are measured once with a tiny probe move (undone at
      // once), because they depend on distance and camera angle.
      data.gap = p.y - a.center[1];
      const h = 0.1;
      adapter.nudgeY (key, h);
      const b = adapter.anchor(key);
      adapter.nudgeY (key, -h);
      const px = b ? a.center[1] - b.center[1] : 0;
      data.k = Math.abs(px) > 0.5 ? h / px : 0.01;
    }
    if (anywhere) {
      data.x0 = p.x;
      data.y0 = p.y;
      data.applied = 0; // turn: the screen angle given so far (the drag sets the total; the adapter takes steps)
    } else handles.setActive(handle);
    return { kind: 'handle', handle, key, from, last: from, data, anywhere };
  };

  const moveHandle = (m                                   , p     ) => {
    const { key, data } = m;
    lastRead = p;
    if (m.handle === 'move' || m.handle === 'lift') adapter.setSnap?.({ on: true, free, skip: snapKeys() });
    let pose       = m.last;
    if (m.anywhere && m.handle === 'rotate') {
      // Turn by the horizontal travel; 15° steps within ±3° of the gesture's total unless Shift.
      let want = (p.x - data.x0 ) * TURN_PER_PX;
      const t = Math.round(want / SNAP) * SNAP;
      if (!p.shift && Math.abs(t - want) <= SNAP_WINDOW) want = t;
      const dd = want - data.applied ;
      if (Math.abs(dd) > 1e-6) {
        pose = canTurn() ? adapter.turn (key, dd, state.axis) : adapter.rotate(key, dd);
        data.applied = want;
      }
    } else if (m.anywhere && m.handle === 'scale') {
      // Size by the travel right / up (left / down = smaller), as one factor from the start.
      const want = Math.exp((p.x - data.x0  - (p.y - data.y0 )) * SIZE_PER_PX);
      const now = adapter.anchor(key)?.pose;
      const f = now ? want / (sizeOf(now) / sizeOf(m.from)) : 1;
      if (Math.abs(f - 1) > 1e-4) pose = adapter.scale(key, f);
    } else if (m.handle === 'move') {
      pose = adapter.drag(key, p.x, p.y);
    } else if (m.handle === 'rotate') {
      const a = adapter.anchor(key);
      if (!a) return;
      const cx = data.cx ?? a.center[0], cy = data.cy ?? a.center[1];
      const ang = Math.atan2(p.y - cy, p.x - cx);
      const d = wrap(ang - data.angle );
      data.angle = ang;
      const before = adapter.anchor(key) .pose.r ?? 0;
      // 3D: around the chosen axis through the box middle; 2D (and adapters without turn): the old way.
      const turnBy = (dd        ) => (canTurn() ? adapter.turn (key, dd, state.axis) : adapter.rotate(key, dd));
      pose = turnBy(d);
      if (!data.sign && Math.abs(d) > 1e-4) data.sign = Math.sign(wrap((pose.r ?? 0) - before)) * Math.sign(d) || 1;
      // Snap to 15° steps within ±3° unless Shift is held (the vertical turn only: a tip has no "straight"
      // the editor knows of). The snap is applied to the object's own angle; `sign` maps it back to a screen delta.
      if (!p.shift && data.sign && (!canTurn() || state.axis === 'y')) {
        const r = pose.r ?? 0;
        const target = Math.round(r / SNAP) * SNAP;
        const off = target - r;
        if (Math.abs(off) <= SNAP_WINDOW && Math.abs(off) > 1e-6) pose = turnBy(off * data.sign);
      }
    } else if (m.handle === 'scale') {
      const a = adapter.anchor(key);
      if (!a) return;
      const dist = Math.max(8, Math.hypot(p.x - a.center[0], p.y - a.center[1]));
      const f = dist / data.dist ;
      data.dist = dist;
      if (Math.abs(f - 1) > 1e-4) pose = adapter.scale(key, f);
    } else if (m.handle === 'lift') {
      const a = adapter.anchor(key);
      if (!a) return;
      const target = p.y - data.gap ;
      const err = a.center[1] - target; // > 0: object is below where it should be
      // Going down, the bottom stops on the first surface below until the finger is breakPx past it (snap.ts).
      const dy = Math.max(-5, Math.min(5, liftWith([key], err * data.k , data.k , data.breakPx )));
      if (Math.abs(dy) > 1e-6) pose = adapter.nudgeY (key, dy);
    }
    m.last = pose;
    emitMoved(key, pose, { press: m.handle });
    handles.readout(readout(m.handle, m.from, pose, canTurn() ? state.axis : 'y'));
  };

  /** The readout's text: what this drag changed, from the pose before it. */
  const readout = (k            , from      , now      , axis          )         => {
    const w = READOUT_WORDS[lang] || READOUT_WORDS.en;
    const sgn = (v        , dp        ) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(dp)}`;
    const p0 = from.p, p1 = now.p;
    if (k === 'move') {
      // 3D: on the ground (X, Z, metres); 2D: the game's own x / y.
      const [a, b] = adapter.dim === '3d' ? [0, 2] : [0, 1];
      const dp = adapter.dim === '3d' ? 2 : 0;
      return `${w.move}  ${adapter.dim === '3d' ? 'X' : 'x'} ${sgn((p1[a] ?? 0) - (p0[a] ?? 0), dp)}  ${adapter.dim === '3d' ? 'Z' : 'y'} ${sgn((p1[b] ?? 0) - (p0[b] ?? 0), dp)}`;
    }
    if (k === 'lift') return `${w.lift}  ${sgn((p1[1] ?? 0) - (p0[1] ?? 0), 2)}`;
    if (k === 'rotate') {
      let d        ;
      if (axis === 'y') d = wrap((now.r ?? 0) - (from.r ?? 0));
      else {
        const i = axis === 'x' ? 0 : 1;
        d = wrap((now.t?.[i] ?? 0) - (from.t?.[i] ?? 0));
      }
      const deg = Math.round((d * 180) / Math.PI);
      return `${axis === 'x' ? w.tipX : axis === 'z' ? w.tipZ : w.rotate}  ${deg < 0 ? '−' : ''}${Math.abs(deg)}°`;
    }
    return `${w.scale}  ×${(sizeOf(now) / sizeOf(from)).toFixed(2)}`;
  };

  const endGesture = () => {
    if (mode.kind === 'handle' || mode.kind === 'group') {
      adapter.setSnap?.({ on: false });
      lastRead = null;
    }
    if (mode.kind === 'handle' || mode.kind === 'group') {
      handles.readout(null);
      if (mode.anywhere) hintUsed();
    }
    if (mode.kind === 'group') {
      handles.setActive(null);
      const poses = groupPoses(adapter, mode.session, true);
      if (poses.some((e) => !samePose(e.pose, e.from ))) {
        markDirty();
        post({ type: 'studio:placement/moved-group', poses, end: true, press: mode.handle });
      }
    }
    if (mode.kind === 'handle') {
      const m = mode;
      const pose = adapter.anchor(m.key)?.pose ?? m.last;
      handles.setActive(null);
      if (!samePose(pose, m.from)) emitMoved(m.key, pose, { end: true, from: m.from, press: m.handle });
    }
    mode = { kind: 'none' };
  };

  const screenShare = (k        ) => screenShareOf(adapter, win, k);
  /** What a tap at the point may pick, best first: pickNear without the background. */
  const tappable = (p     , radius        ) => tappableAt(adapter, state.items, win, p.x, p.y, radius);

  const tap = (p     ) => {
    const radius = p.type === 'mouse' ? UI.pickRadiusMouse : UI.pickRadiusTouch;
    const keys = tappable(p, radius);
    let key                = keys[0] ?? null;
    // Same spot again: walk to the next candidate (the object behind).
    if (lastTap && Math.hypot(lastTap.x - p.x, lastTap.y - p.y) <= radius && state.selected && keys.includes(state.selected)) {
      key = keys[(keys.indexOf(state.selected) + 1) % keys.length] ;
    }
    lastTap = { x: p.x, y: p.y, key };
    // Shift, or "select several" mode: add or take out one object.
    if (p.shift || state.multi) {
      if (!key) return;
      const has = state.group.includes(key);
      const keys = has ? state.group.filter((k) => k !== key) : [...state.group, key];
      selectMany(keys, has ? (keys[keys.length - 1] ?? null) : key);
      return;
    }
    select(key);
  };

  /**
   * The place's menu at the pointer (see the header): pick what is under it if it is not picked yet (no camera move),
   * then ask the editor page to draw the menu. The strip's own choices close first (one menu at a time).
   */
  const contextAt = (p     ) => {
    if (handles.menuOpen()) menu(null);
    const key = tappable(p, p.type === 'mouse' ? UI.pickRadiusMouse : UI.pickRadiusTouch)[0] ?? null;
    const picked = state.group.length > 1 ? state.group : state.selected ? [state.selected] : [];
    if (key && !picked.includes(key)) select(key);
    // The next plain tap on the same spot should not walk to the object behind (that is for a second LEFT press).
    lastTap = null;
    post({ type: 'studio:placement/context', key, x: p.x, y: p.y, touch: p.type !== 'mouse' });
  };
  // The touch held still for the menu (LONG_PRESS_MS): armed when a plain press starts, checked when it fires.
  let menuTimer = 0;
  const armMenuPress = (id        ) => {
    nativeClearTimeout(menuTimer);
    menuTimer = nativeSetTimeout(() => {
      const p = ptrs.get(id);
      if (!p || ptrs.size !== 1 || mode.kind !== 'pending') return;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) return;
      // Forget the pointer: its release must not also be read as a tap (which would pick or drop the pick again).
      ptrs.delete(id);
      mode = { kind: 'none' };
      contextAt(p);
    }, LONG_PRESS_MS);
  };

  /** Box selection: every listed object whose pivot is inside the band joins the selection. */
  let band                                                        = null;
  const finishBox = () => {
    const r = band;
    band = null;
    handles.box(null);
    if (!r) return;
    const inBox           = [];
    for (const it of state.items) {
      const a = adapter.anchor(it.key);
      if (!a || !a.visible) continue;
      const [x, y] = a.center;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) inBox.push(it.key);
    }
    if (!inBox.length) return;
    const keys = [...state.group, ...inBox.filter((k) => !state.group.includes(k))];
    selectMany(keys, state.selected && keys.includes(state.selected) ? state.selected : inBox[0] );
  };
  /** A mouse press that may become a box: Shift or "select several", and nothing (or only the ground) under the pointer. */
  const boxable = (p     ) => {
    if (p.type !== 'mouse' || p.button !== 0 || !(p.shift || state.multi)) return false;
    return tappable(p, UI.pickRadiusMouse).length === 0;
  };
  let boxStart = false;
  /** Tool dragged anywhere: the offset from the pointer to the object's point at the start. */
  let off = { x: 0, y: 0 };
  // Snap to surfaces: Ctrl / ⌥ held now (freeHeld), the height drag's stop state, and the last pointer a move / height
  // drag read (a Ctrl / ⌥ press re-reads it). The keys moving together are never a surface for each other.
  let free = false;
  let detent              = { through: null };
  let lastRead             = null;
  const snapKeys = () => (state.group.length > 1 ? state.group.slice() : state.selected ? [state.selected] : []);
  const snapOn = (handle            ) => {
    if (adapter.dim === '3d' && (handle === 'move' || handle === 'lift')) adapter.setSnap?.({ on: true, free, skip: snapKeys() });
  };
  /** The height drag's metres for the finger's `want`, with the stop on the surface below (several: the first to touch). */
  const liftWith = (keys          , want        , k        , breakPx        ) => {
    if (free || !adapter.rest) return want;
    const skip = snapKeys();
    const r = firstToTouch(keys.map((key) => adapter.rest (key, skip)));
    return liftDetent(r, want, k, detent, breakPx);
  };

  /** A plain press (no Shift, not picking several) on the picked object, which can be moved and is not huge. */
  const grabbable = (p     ) => {
    if (!state.selected || p.shift || state.multi || (p.type === 'mouse' && p.button !== 0)) return false;
    const picked = state.group.length > 1 ? state.group : [state.selected];
    let under           = [];
    try {
      under = adapter.pickNear(p.x, p.y, p.type === 'mouse' ? 2 : 10);
    } catch {
      return false;
    }
    const k = under.find((u) => picked.includes(u));
    if (!k) return false;
    const it = state.items.find((i) => i.key === k);
    if (!it || it.movable === false || it.backdrop) return false;
    // "Huge" = the part ON SCREEN covers 60 % or more of the window (a ground seen from above the horizon).
    // WHY clipped, and 60 not 40 (W1 merge, 2026-10-17): the rect is the projected box, so it runs past the
    // window's edges. Until W1-1 a pick glided the camera back and the barn of test/studio-unnamed shrank; with the
    // camera kept still, on a phone 390×844 its box is 483 px wide (x −77) = 56 % of the window, 45 % on screen,
    // and a drag on the barn turned the view instead of moving it. A ground plane covers ~75 %+ on screen.
    return screenShare(k) < HUGE_ON_SCREEN;
  };

  const twoFingers = () => {
    const [a, b] = [...ptrs.values()];
    return { dist: Math.hypot(a .x - b .x, a .y - b .y), cx: (a .x + b .x) / 2, cy: (a .y + b .y) / 2 };
  };

  // The Motion button as the editor page last described it (placement/motion): shown, has a motion, its words.
  let motion = { show: false, has: false, label: '', open: false };
  /** Tell the editor page the Motion button was pressed (`r` = the button's box; null = off screen: a key). */
  const pressMotion = (r                , touch         , keyboard         ) => {
    if (!state.selected) return;
    post({ type: 'studio:placement/motion-press', key: state.selected, x: r?.left ?? 0, y: r?.top ?? 0, w: r?.width ?? 0, h: r?.height ?? 0, touch, keyboard });
  };

  const onDown = (e              ) => {
    const h = handleFromEvent(e);
    block(e);
    // A press with an id we still hold means we missed its release.
    ptrs.delete(e.pointerId);
    // A new touch while nothing is down: clear leftovers from lost releases.
    if (e.pointerType !== 'mouse' && e.isPrimary) ptrs.clear();
    const p      = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, shift: e.shiftKey, alt: e.altKey,
      menu: e.pointerType === 'mouse' && (e.button === 2 || (MAC && e.button === 0 && e.ctrlKey && !e.metaKey)) };
    ptrs.set(e.pointerId, p);
    try {
      (e.target           ).setPointerCapture?.(e.pointerId);
    } catch {
      /* element may not accept capture (e.g. document) */
    }
    if (ptrs.size === 2) {
      nativeClearTimeout(menuTimer);
      // Second finger: whatever the first was doing turns into pinch/pan.
      if (mode.kind === 'handle' || mode.kind === 'group') endGesture();
      if (mode.kind === 'rise') riseEnd();
      mode = { kind: 'pinch', ...twoFingers() };
      return;
    }
    if (ptrs.size > 2) return;
    // Camera up / down: one step now, more while held (riseHold), or the drag's travel (onMove). Before the strip and
    // the tool: these buttons belong to the view, whatever is picked or chosen.
    const rd = riseUi?.fromEvent(e);
    if (rd) {
      if (handles.menuOpen()) menu(null);
      const t0 = nativeNow();
      mode = { kind: 'rise', dir: rd, t0, follow: false };
      riseLast = 0;
      riseUi .setActive(rd);
      riseBy((rd === 'up' ? 1 : -1) * RISE_STEP * win.innerHeight);
      if (!riseFrame) riseFrame = core.time.raf(riseHold);
      return;
    }
    // The ▾ in the turn / size button's corner: open (or close) its choices; the tool stays as it was.
    const more = moreFromEvent(e);
    if (more && state.selected && hasChoices(more)) {
      toggleMenu(more);
      ptrs.delete(e.pointerId);
      mode = { kind: 'none' };
      return;
    }
    // The Motion button (studio-motion-tool, 2026-10-22): not a tool — the editor page opens the pick's motion, or its
    // small menu at the button. On the press, as a menu button does (the editor's menu then takes the release).
    const mot = motionFromEvent(e);
    if (mot) {
      if (handles.menuOpen()) menu(null);
      ptrs.delete(e.pointerId);
      mode = { kind: 'none' };
      if (state.selected && !p.menu && motion.show) pressMotion(mot, p.type !== 'mouse', false);
      return;
    }
    // A choice in the strip's menu (turn axis / resize mode): it is used at once — its tool is chosen and the
    // button wears the choice's picture, so the strip says which way a drag works now.
    const choice = choiceFromEvent(e);
    if (choice) {
      if (choice.kind === 'axis') setAxis(choice.id            );
      else if (choice.kind === 'turn') {
        state.turnMode = choice.id === 'inplace' ? 'inplace' : 'spread';
        handles.setTurnMode(state.turnMode);
      } else {
        state.scaleMode = choice.id === 'inplace' ? 'inplace' : 'spread';
        handles.setScaleMode(state.scaleMode);
      }
      menu(null);
      const k             = choice.kind === 'scale' ? 'scale' : 'rotate';
      if (tool !== k) chooseTool(k, 'menu');
      ptrs.delete(e.pointerId);
      mode = { kind: 'none' };
      return;
    }
    // A dimmed tool: a press does nothing (studio-move-plain, 2026-10-23 — it opened a menu of why and what to do,
    // studio-tool-clear); the why is the small line by the strip. The press is still the strip's, not the game's.
    if (h && state.selected && offOf(h)) {
      ptrs.delete(e.pointerId);
      mode = { kind: 'none' };
      return;
    }
    if (h && state.selected) {
      mode = startHandle(h, p);
      if (mode.kind === 'none') {
        // The gesture could not start (Move: adapter.grab found no ground under the BUTTON — on Lantern Cove the
        // strip under the lighthouse is over the sea's far edge). The press still chooses the tool, as a tap would;
        // the drag-anywhere start (toolStart) grabs at the object's own point, which works (tool options, 2026-10-18).
        ptrs.delete(e.pointerId);
        chooseTool(h === tool ? null : h, 'strip');
        return;
      }
      const kind = h === 'rotate' ? 'axis' : h === 'scale' ? 'scale' : null;
      if (kind && hasChoices(kind)) armLongPress(e.pointerId, kind);
      return;
    }
    if (handles.menuOpen()) menu(null);
    if (tools.active() && tools.pointer(toolEvent('down', p))) {
      mode = { kind: 'tool' };
      markDirty();
      return;
    }
    // The Mac's Control-click is a right-click here: never a box, a tool drag or a grab (a drag from it looks around).
    boxStart = !p.menu && boxable(p);
    // A chosen tool that can act on the pick: a drag from here uses it (Shift at the press still draws a box from an empty spot).
    toolStart = !p.menu && !boxStart && !!tool && !!state.selected && !looksAround(p) && toolApplies(tool);
    grabStart = !p.menu && !boxStart && !toolStart && grabbable(p);
    mode = { kind: 'pending' };
    // A finger (or pen) held still here opens the place's menu. Not with a game tool (it took the press above).
    if (p.type !== 'mouse' && ptrs.size === 1) armMenuPress(p.id);
  };

  const onMove = (e              ) => {
    block(e);
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    // Mouse moving with no button pressed = we missed the release. But only once it has MOVED (past the tap slop from
    // where the pointer was): a no-button move on the spot is no news, and the real release follows.
    // WHY (first-click pass, 2026-10-20 — a try of test demo v16: "I click the lighthouse and it isn't selected"; a
    // real Chrome, the second click always worked): a real mouse can deliver the move that brought the cursor there
    // AFTER the press, with no button in it (the second click, on the same spot, has no such move). This line read it
    // as a lost release and ended the press without a tap, so the first click never selected. headless tests send
    // the move before the press and never saw it; test/studio-first-click.browser.mjs sends it after.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) <= UI.tapSlopPx) return;
      onUp(e);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.shift = e.shiftKey;
    free = freeHeld(e);
    if (mode.kind === 'pinch' && ptrs.size >= 2) {
      const t = twoFingers();
      if (mode.dist > 0 && t.dist > 0) adapter.view.zoom(t.dist / mode.dist, t.cx, t.cy);
      adapter.view.pan(t.cx - mode.cx, t.cy - mode.cy);
      mode = { kind: 'pinch', ...t };
      markDirty();
      return;
    }
    if (mode.kind === 'rise') {
      // Dragged on ↑ / ↓: from the slop on, the camera follows the drag (up = up, the whole travel), held-repeat stops.
      if (!mode.follow && Math.abs(p.y - p.sy) > UI.tapSlopPx) mode.follow = true;
      if (mode.follow) riseBy(-dy);
      return;
    }
    // A tool dragged anywhere reads the pointer shifted onto the object's point (see the start above).
    const v = mode.kind === 'handle' || mode.kind === 'group' ? (mode.anywhere ? { ...p, x: p.x + off.x, y: p.y + off.y } : p) : p;
    if (mode.kind === 'handle') {
      moveHandle(mode, v);
      return;
    }
    if (mode.kind === 'group') {
      moveGroup(mode, v);
      return;
    }
    if (mode.kind === 'pending' && boxStart && Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) mode = { kind: 'box' };
    if (mode.kind === 'box') {
      band = { x: Math.min(p.sx, p.x), y: Math.min(p.sy, p.y), w: Math.abs(p.x - p.sx), h: Math.abs(p.y - p.sy) };
      handles.box(band);
      return;
    }
    if (mode.kind === 'tool') {
      tools.pointer(toolEvent('move', p));
      markDirty();
      return;
    }
    if (mode.kind === 'pending' && toolStart && tool && Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) {
      // The chosen tool, from anywhere: start it at the object's own point on screen so move / height follow
      // the drag's travel (not the pointer's place: the press may be far from the object, even on the sky).
      toolStart = false;
      const k = state.selected ;
      const ga = state.group.length > 1 ? groupAnchor(adapter, state.group, k) : adapter.anchor(k);
      const c = ga ? { x: ga.center[0], y: ga.center[1] } : { x: p.sx, y: p.sy };
      const at      = { ...p, x: c.x, y: c.y };
      mode = startHandle(tool, at, true);
      if (mode.kind === 'handle' || mode.kind === 'group') {
        handles.setTool(tool);
        // From now on the pointer is read relative to the press, offset onto the object's point.
        off = { x: c.x - p.sx, y: c.y - p.sy };
        if (mode.kind === 'handle') {
          mode.data.x0 = c.x;
          mode.data.y0 = c.y;
        }
        const v = { ...p, x: p.x + off.x, y: p.y + off.y };
        if (mode.kind === 'handle') moveHandle(mode, v);
        else moveGroup(mode, v);
      }
      return;
    }
    if (mode.kind === 'pending' && grabStart && Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) {
      // Dragging the picked object: the move handle's gesture, started where the press was.
      grabStart = false;
      mode = startHandle('move', { ...p, x: p.sx, y: p.sy });
      if (mode.kind === 'handle') moveHandle(mode, p);
      else if (mode.kind === 'group') moveGroup(mode, p);
      return;
    }
    if (mode.kind === 'pending' && Math.hypot(p.x - p.sx, p.y - p.sy) > UI.tapSlopPx) {
      // Pan: middle or right button, Shift, or (2D) any drag. 3D left drag orbits.
      // (3D right drag used to orbit too; it pans now, like most 3D editors,
      // since Shift+drag from an empty spot became the box selection.)
      const pan = adapter.dim === '2d' || p.button === 1 || p.button === 2 || p.menu || p.shift || !adapter.view.orbit;
      mode = { kind: 'look', pan };
    }
    if (mode.kind === 'look') {
      // A right-drag while flying looks where the camera stands (the engines' fly mode; see the header).
      if (p.flew && adapter.view.look) adapter.view.look(dx, dy);
      else if (mode.pan) adapter.view.pan(dx, dy);
      else adapter.view.orbit (dx, dy);
      markDirty();
    }
  };

  const onUp = (e              ) => {
    block(e);
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    // pointerup = let go here; pointercancel / the no-button move of onMove = the press is over, no tap.
    if (e.type === 'pointerup') release(p, e);
    else end(p, false);
  };
  /**
   * The press `p` was let go, at `at` (a pointerup / click in this window) or where we last saw it (a release that came
   * another way): it ends now, a tap if it did not travel.
   * A release far from the press with no travel seen (mode still "pending") means we missed what came between — the
   * moves, or this press itself (first-click pass 2, below): the tap is read where the person let go, never on the old
   * press (that was "the previous object picked").
   */
  const release = (p     , at                                       ) => {
    if (at && mode.kind === 'pending' && Math.hypot(at.clientX - p.x, at.clientY - p.y) > UI.tapSlopPx) {
      p.x = p.sx = at.clientX;
      p.y = p.sy = at.clientY;
    }
    end(p, true);
  };
  /**
   * Releases that reach us some other way than this window's pointerup (first-click pass 2, 2026-10-20 — a try of test
   * demo v17 in a real Chrome 152, Mac: click the sailboat → nothing picked; click the lighthouse → the SAILBOAT picked;
   * a listener on the game window saw only `lostpointercapture`, buttons 0). The pointerup did not reach this window
   * then, or reached it only just before the next press, which then tapped the old press: "one click late". So a
   * release is taken AT ONCE from whichever comes first, and the later ones find no press (ptrs) and do nothing:
   * - lostpointercapture with no button down (onDown captures the press; the browser lets go when the button is up).
   *   With a button still down (the captured element went away, e.g. the strip re-drawn) the press goes on.
   * - click in this window (comes after the release; the mouseup does not — onDown's preventDefault stops it).
   * - pointerup / mouseup in the pages above the game frame (the editor page, the front page), when they can be
   *   reached (same origin): never blocked there, the press point is used (their coordinates are not the game's).
   * headless never showed it (the pointerup always came): test/studio-first-click-lag.browser.mjs holds it back,
   * sends it to the page above, or loses it together with the next press.
   */
  const onLost = (e              ) => {
    const p = ptrs.get(e.pointerId);
    if (p && e.buttons === 0) release(p);
  };
  /** The press a click / a release above is about: by its pointer id, else the only mouse press held. */
  const pressOf = (e            ) => {
    const id = (e                ).pointerId;
    if (typeof id === 'number' && ptrs.has(id)) return ptrs.get(id) ;
    const mice = [...ptrs.values()].filter((q) => q.type === 'mouse');
    return mice.length === 1 && ptrs.size === 1 ? mice[0]  : null;
  };
  const onClickEnd = (e            ) => {
    const p = pressOf(e);
    if (p) release(p, e);
  };
  const onUpAbove = (e            ) => {
    const p = pressOf(e);
    if (p && e.buttons === 0) release(p);
  };
  /** The pages above this game frame that we can reach (same origin), up to the top. */
  const above           = [];
  for (let w         = win; w.parent && w.parent !== w; ) {
    w = w.parent;
    try {
      void w.document; // throws for another origin: stop there
      above.push(w);
    } catch {
      break;
    }
  }

  /** The press `p` is over: a tap / the place's menu when `tapped` (let go without travel), else just ended. */
  const end = (p     , tapped         ) => {
    nativeClearTimeout(pressTimer);
    nativeClearTimeout(menuTimer);
    ptrs.delete(p.id);
    if (mode.kind === 'rise') {
      riseEnd();
      mode = { kind: 'none' };
      return;
    }
    // A right-click (no travel): the place's menu instead of a tap (it picks only what is not picked yet).
    if (mode.kind === 'pending' && tapped) {
      // A right press that flew (WASD held with it) was the engines' fly mode, not a click: no menu.
      if (p.menu) {
        if (!p.flew) contextAt(p);
      } else tap(p);
    }
    if (mode.kind === 'look' || mode.kind === 'pending') {
      post({ type: 'studio:core/view-state', state: adapter.view.state() });
      mode = { kind: 'none' };
    } else if (mode.kind === 'pinch') {
      // Lifting one of two fingers ends the pinch; the remaining finger
      // must not turn into a tap or a look-around.
      if (ptrs.size === 0) {
        post({ type: 'studio:core/view-state', state: adapter.view.state() });
        mode = { kind: 'none' };
      }
    } else if (mode.kind === 'handle' || mode.kind === 'group') {
      // A tap (no drag) on a strip button CHOOSES its tool (tool modes, see the header). On the chosen one
      // again: the others put the tool down; the turn button (3D, or several) and the size button (several)
      // open / close their choices — an unadvertised shortcut only since 2026-10-18 (the ▾ and the long press
      // are the way in; a second press is not something people try, play test 2026-10-18).
      const tap = !mode.anywhere && Math.hypot(p.x - p.sx, p.y - p.sy) <= UI.tapSlopPx;
      const which = mode.handle;
      const single = mode.kind === 'handle';
      endGesture();
      if (tap) {
        const choices = (which === 'rotate' && hasChoices('axis')) || (which === 'scale' && !single && hasChoices('scale'));
        if (which !== tool) chooseTool(which, 'strip');
        else if (choices) toggleMenu(which === 'rotate' ? 'axis' : 'scale');
        else chooseTool(null, 'strip');
      }
    } else if (mode.kind === 'box') {
      finishBox();
      mode = { kind: 'none' };
    } else if (mode.kind === 'tool') {
      tools.pointer(toolEvent('up', p));
      mode = { kind: 'none' };
    }
  };

  const onWheel = (e            ) => {
    // The web demo's front page, before the editor in it was first pressed (hosts/browser/embed.ts PAGE_WHEEL): the
    // wheel scrolls that page, not the view. Left for embed.ts's own listener (added after this one) to pass up.
    if ((win                                      ).__studioPageWheel === true) return;
    block(e);
    const px = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (!e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0.5) {
      // Two-finger trackpad scroll: pan.
      adapter.view.pan(-e.deltaX, -e.deltaY);
    } else {
      // Mouse wheel, or trackpad pinch (reported as ctrl+wheel).
      const k = e.ctrlKey ? 0.01 : 0.0015;
      adapter.view.zoom(Math.exp(-e.deltaY * px * k), e.clientX, e.clientY);
    }
    markDirty();
    post({ type: 'studio:core/view-state', state: adapter.view.state() });
  };

  /** Ctrl / ⌥ pressed or let go: during a move / height drag, read the drag again the new way at once. */
  const snapKey = (e               ) => {
    const now = freeHeld(e);
    if (now === free) return;
    free = now;
    if (!lastRead || !ptrs.has(lastRead.id)) return;
    if (mode.kind === 'handle' && (mode.handle === 'move' || mode.handle === 'lift')) moveHandle(mode, lastRead);
    else if (mode.kind === 'group' && (mode.handle === 'move' || mode.handle === 'lift')) moveGroup(mode, lastRead);
  };

  const onKey = (e               ) => {
    block(e);
    // Shortcuts that belong to the shell (undo, redo, save, escape...) are
    // forwarded so they work wherever focus is.
    post({ type: 'studio:core/key', key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey });
    flyFast = e.shiftKey;
    snapKey(e);
    // ⌘ / Ctrl / ⌥ with a fly key is a shortcut, not flying; and a Mac sends no keyup for keys let go while ⌘ is
    // down, so whatever was held stops here rather than flying on by itself.
    if (e.ctrlKey || e.metaKey || e.altKey) {
      flyHeld.clear();
      return;
    }
    const key = state.selected;
    // Fly (see the header): before the tool keys (S = Size with a pick) and the turn keys (E / Q), which keep their
    // meaning unless flying is allowed now. Not while typing in one of the game's own fields, nor composing (IME).
    const fk = canFly() && !e.isComposing && !typingIn(e.target) ? flyKeyOf(e) : null;
    if (fk && (flyHeld.has(fk) || flyOk(fk))) {
      if (!flyHeld.has(fk)) {
        flyHeld.add(fk);
        if (!e.repeat) flyBy([fk], FLY_KICK_S, e.shiftKey);
      }
      flyStart();
      return;
    }
    if (e.key === ' ') {
      spaceHeld = true;
      return;
    }
    if (e.key === 'Escape') {
      if (handles.menuOpen()) menu(null);
      else if (tool) chooseTool(null, 'key');
      else select(null);
      return;
    }
    // M / H / T / S: choose the strip's tool (with something picked, as the R key).
    const tk = e.shiftKey ? null : toolFromKey(e.key);
    if (tk && key) {
      chooseTool(tk, 'key');
      return;
    }
    // A / 5: the Motion button (studio-motion-tool), as a press on it. After fly: A with the right button held flies.
    if (!e.shiftKey && key && motion.show && isMotionKey(e.key) && !e.repeat && !typingIn(e.target)) {
      pressMotion(handles.motionRect(), false, true);
      return;
    }
    // R: the next turn axis (3D, one or several picked), with the choices shown for a moment of feedback.
    if ((e.key === 'r' || e.key === 'R') && key && canTurn()) {
      setAxis('next');
      if (!handles.menuOpen()) menu('axis');
      return;
    }
    // E / Q: camera up / down with nothing picked (they have no other job then) or while looking around (Space held,
    // a right / middle / ⌥ drag) — the 3D tools' habit. With something picked otherwise they still turn it (keyStep).
    const kl = e.key.toLowerCase();
    // Adapters without fly (rise only) keep the steps.
    if ((kl === 'e' || kl === 'q') && !canFly() && adapter.view.rise && (!key || spaceHeld || mode.kind === 'look' || [...ptrs.values()].some(looksAround))) {
      riseBy((kl === 'e' ? 1 : -1) * (e.shiftKey ? RISE_KEY_STEP / 5 : RISE_KEY_STEP) * win.innerHeight);
      post({ type: 'studio:core/view-state', state: adapter.view.state() });
      return;
    }
    if (!key) return;
    const s = keyStep(e.key, e.shiftKey, adapter.dim);
    if (s) step({ type: 'studio:placement/step', key, ...s, hold: e.repeat, keys: state.group.length > 1 ? state.group.slice() : undefined });
  };

  const onKeyUp = (e               ) => {
    if (e.key === ' ') spaceHeld = false;
    snapKey(e);
    flyFast = e.shiftKey;
    const fk = flyKeyOf(e);
    if (fk) flyHeld.delete(fk);
  };

  const onBlur = () => {
    spaceHeld = false;
    // The keyups go elsewhere now: stop flying (the next frame sees no key).
    flyHeld.clear();
    // Do NOT clear pointers here (see the header comment). Only stop showing
    // a pressed handle; the gesture itself continues if the finger is down.
    handles.setActive(mode.kind === 'handle' || mode.kind === 'group' ? mode.handle : null);
  };

  // The name tag over the picked object shows only while the mouse is over it (design review wave 1, W1-2 / N3, 2026-10-17).
  // WHY: picking put the same name on screen four times (the tag on the object, the list row, the card, the ask box's
  // chip); the card is what names it. On touch there is no hover, so no tag at all. `hover` = the mouse over the game
  // with no button down (null = gone / touch).
  // `armed`: the mouse has been off the picked object since it was picked. The click that picks leaves the mouse on
  // the object; without this the tag came back the same instant, which is "a tag when picked" again.
  let hover                                  = null;
  let hoverIn = false;
  let armed = false;
  const inRects = (rs                                                       ) =>
    armed && !!hover && rs.some((r) => hover .x >= r.x && hover .x <= r.x + r.w && hover .y >= r.y && hover .y <= r.y + r.h);
  const selectionRects = () => rectsOf(state.group.length > 1 ? state.group : state.selected ? [state.selected] : []);
  const onHover = (e              ) => {
    hover = e.pointerType === 'mouse' && e.buttons === 0 ? { x: e.clientX, y: e.clientY } : null;
    if (hover && !armed) {
      armed = true;
      if (inRects(selectionRects())) armed = false; // still on it: wait until it leaves
    }
    const now = inRects(selectionRects());
    if (now !== hoverIn) {
      hoverIn = now;
      markDirty();
    }
  };
  const onLeave = (e              ) => {
    if (e.relatedTarget) return;
    hover = null;
    if (hoverIn) {
      hoverIn = false;
      markDirty();
    }
  };
  // The window's listeners, in this order (added in it, taken off in it by detach()). `ignore` (pause-move, 2026-10-22):
  // a press on the paused game's own panel is not a press in the game — skipped by every listener here, so it reaches
  // the panel's buttons (block() would stop it at the window). Without `ignore` each listener is the function itself.
  const skip = deps.ignore;
  const g =                  (fn                ) => (skip ? (e   ) => void (skip(e) || fn(e)) : fn)                 ;
  const winListeners                                 = [
    ['pointerdown', g(onDown)],
    // Before onMove: its block() stops the other listeners on window.
    ['pointermove', g(onHover)],
    ['pointermove', g(onMove)],
    ['pointerout', g(onLeave)],
    ['pointerup', g(onUp)],
    ['pointercancel', g(onUp)],
    // The other ways a release comes (onLost above). Not blocked: lostpointercapture is the browser's own bookkeeping,
    // and the click is blocked by `block` (added below, after this one: it stops the listeners after it).
    ['lostpointercapture', g(onLost)],
    ['click', g(onClickEnd)],
    ['wheel', g(onWheel)],
    ['keydown', g(onKey)],
    ['blur', g(onBlur)],
    // Before the blocking listener for keyup (it stops the others on window): Space let go ends "Space held".
    ['keyup', g(onKeyUp)],
    // `passKeyUp` (pause-move): key releases still reach the game, as the pause promises (play-pause.ts: a key held at
    // the pause must not stay down in the game after Resume).
    ...blocked.filter((t) => !(deps.passKeyUp && t === 'keyup')).map((t)                          => [t, g(block)]),
  ];
  for (const [t, fn] of winListeners) win.addEventListener(t, fn, opts);
  for (const w of above) for (const t of ['pointerup', 'mouseup']         ) w.addEventListener(t, onUpAbove, { capture: true });

  // Pictures of the originals for stand-in copies, one capture per original.
  const ghostPics = new Map                                                                                     ();
  const drawGhosts = () => {
    const list = edits.ghosts();
    if (!list.length) {
      handles.ghosts([]);
      return;
    }
    const out                                   = [];
    for (const g of list) {
      let pic = ghostPics.get(g.src);
      if (!pic) {
        ghostPics.set(g.src, 'wait');
        const a = adapter.anchor(g.src);
        const r = a?.rect;
        const s0 = Array.isArray(a?.pose.s) ? a .pose.s[0] ?? 1 : (a?.pose.s                      ) ?? 1;
        void edits.capture(g.src, { size: 256 }).then((c) => {
          ghostPics.set(g.src, { src: c.ok && c.dataUrl ? c.dataUrl : null, w: r?.w ?? 40, h: r?.h ?? 40, r: a?.pose.r ?? 0, s: s0 });
          markDirty();
        }, () => ghostPics.set(g.src, { src: null, w: r?.w ?? 40, h: r?.h ?? 40, r: 0, s: 1 }));
        continue;
      }
      if (pic === 'wait') continue;
      const a = adapter.anchor(g.key);
      if (!a || !a.visible) continue;
      const s1 = Array.isArray(g.pose.s) ? g.pose.s[0] ?? 1 : g.pose.s ?? 1;
      const k = pic.s ? s1 / pic.s : 1;
      if (adapter.dim === '2d') {
        // The picture of the original, turned and sized by the copy's own change.
        const cx = a.rect ? a.rect.x + a.rect.w / 2 : a.center[0];
        const cy = a.rect ? a.rect.y + a.rect.h / 2 : a.center[1];
        out.push({ key: g.key, cx, cy, w: pic.w * k, h: pic.h * k, rot: (g.pose.r ?? 0) - pic.r, src: pic.src });
      } else if (a.rect) {
        out.push({ key: g.key, cx: a.rect.x + a.rect.w / 2, cy: a.rect.y + a.rect.h / 2, w: a.rect.w, h: a.rect.h, rot: 0, src: pic.src });
      }
    }
    handles.ghosts(out);
  };

  // The outlines: the shape from adapter.silhouette when it has one (three),
  // drawn again only when something it depends on changed and at most every
  // 40 ms (it costs extra renders); a rounded box per object otherwise.
  const shapes = { you: { sig: '', at: 0, shape: null                   }, ai: { sig: '', at: 0, shape: null                   }, hover: { sig: '', at: 0, shape: null                   } };
  let aiKeys           = [];
  let hoverKeys           = [];
  let aiLabel                = null;
  const shapeOf = (which                        , keys          , rects                                                       ) => {
    const c = shapes[which];
    if (!adapter.silhouette || !keys.length) {
      c.sig = '';
      c.shape = null;
      return null;
    }
    const sig = keys.join('\n') + '|' + rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`).join(';') + '|' + JSON.stringify(adapter.view.state());
    const now = nativeNow();
    if (sig !== c.sig && now - c.at > 40) {
      try {
        c.shape = adapter.silhouette(keys);
      } catch {
        c.shape = null;
      }
      c.sig = sig;
      c.at = now;
    } else if (sig !== c.sig) markDirty(); // come back next frame for the late update
    return c.shape;
  };
  const rectsOf = (keys          ) => {
    const out                                                        = [];
    for (const k of keys) {
      const a = adapter.anchor(k);
      if (a && a.visible && a.rect) out.push(a.rect);
    }
    return out;
  };

  /**
   * Where the strip goes with several picked (design review 2, item ⑤; asked in review 1 as ③): under the member
   * nearest the camera among those on screen — 12 px under it, as under one object, centred on the part of it that is
   * on screen. "On screen" = some of its box is inside the window (a pine half off the left edge counts: the person
   * sees it). "Nearest" = the lowest bottom edge: on a ground seen from above (every 3D editor view, and 2D's stage)
   * what is nearer stands lower. With none on screen: no strip (null; handles.place hides it) — a strip under nothing
   * says nothing.
   * WHY not the box round all of them (as before): three pines at the frame's left edge put the box's middle on empty
   * sea in front of the sea-arch, and the strip floated there, under nothing (review 2, photo 04).
   */
  const stripAnchor = (keys          )                => {
    const vw = win.innerWidth, vh = win.innerHeight;
    let best                = null;
    let bestBottom = -Infinity;
    for (const k of keys) {
      const a = adapter.anchor(k);
      if (!a || !a.visible) continue;
      const r = a.rect ?? { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
      const x0 = Math.max(0, r.x), x1 = Math.min(vw, r.x + r.w), y0 = Math.max(0, r.y), y1 = Math.min(vh, r.y + r.h);
      if (x1 - x0 < 4 || y1 - y0 < 4) continue;
      const bottom = r.y + r.h;
      if (bottom <= bestBottom) continue;
      bestBottom = bottom;
      // The part on screen: the strip goes under its middle (handles.place reads center x and the rect's top / bottom).
      best = { ...a, center: [(x0 + x1) / 2, a.center[1]], rect: { x: x0, y: r.y, w: x1 - x0, h: r.h } };
    }
    return best;
  };
  const place = () => {
    drawGhosts();
    showAxis();
    // The ▾ on the turn / size buttons: only while they have choices (it sits inside the button: the strip never moves).
    handles.setOptions({ axis: hasChoices('axis'), scale: hasChoices('scale'), axes: canTurn(), several: state.group.length > 1 }, lang);
    const key = state.selected;
    // The AI's marks first (under your own): what is picked is drawn in your colour only.
    const aiShown = aiKeys.filter((k) => !(key && (state.group.includes(k) || k === key)) && state.items.some((i) => i.key === k));
    const aiRects = rectsOf(aiShown);
    handles.ai(shapeOf('ai', aiShown, aiRects), aiRects, aiShown.length ? aiLabel : null);
    // What the mouse is over in the editor page (a row, the card, the chip): lit softly, under your pick's own mark.
    const hovered = hoverKeys.filter((k) => state.items.some((i) => i.key === k));
    const hoverRects = rectsOf(hovered);
    handles.hover(hovered.length ? shapeOf('hover', hovered, hoverRects) : null, hovered.length ? hoverRects : []);
    if (key && state.group.length > 1) {
      const items = state.items.filter((i) => state.group.includes(i.key));
      const keys = items.map((i) => i.key);
      const rects = rectsOf(keys);
      handles.selection(shapeOf('you', keys, rects), rects, inRects(rects) ? (MANY_LABEL[lang] || MANY_LABEL.en)(items.length) : null);
      handles.place(stripAnchor(keys), items.length ? stripCaps() : null, adapter.dim);
      return;
    }
    const a = key ? adapter.anchor(key) : null;
    const item = key ? state.items.find((i) => i.key === key) : undefined;
    const rects = a && a.visible && a.rect ? [a.rect] : [];
    // No tag for an object without a name: its label is its key (`path:3/0`), an inner handle a person must never see
    // (dogfood 2026-10-17, U4). The card names it ("Unnamed shape"). inRects: the tag shows only on hover (Ive wave 1, W1-2).
    handles.selection(item ? shapeOf('you', [key ], rects) : null, item ? rects : [], item && a?.visible && inRects(rects) && !item.unstable ? item.label : null);
    handles.place(a, item ? stripCaps() : null, adapter.dim);
  };

  return {
    frame: place,
    selectionChanged() {
      riseLabels();
      if (handles.menuOpen()) menu(null);
      // Another pick: the turn tool goes back to its own way, Turn (design review 2, item ③: the lighthouse's Tilt
      // forward stayed on the three pines picked next — strip picture and readout included — and a drag tilted them).
      // The same pick told again (a refresh of the list) keeps the chosen way.
      const sig = `${state.selected ?? ''}|${state.group.join(',')}`;
      if (sig !== pickSig) {
        pickSig = sig;
        if (state.axis !== 'y') setAxis('y');
        // A new pick lights up once (handles.flash): the moment the eye looks for what it picked.
        if (state.selected) handles.flash();
      }
      armed = false;
      hoverIn = false;
      place();
    },
    setAxis(ax) {
      if (!state.selected || !canTurn()) return;
      setAxis(ax);
      // The R key from the editor page: show the choices too, as the R key in the game does.
      if (!handles.menuOpen()) menu('axis');
    },
    setTool(k) {
      chooseTool(k, 'shell');
    },
    closeMenu() {
      if (handles.menuOpen()) menu(null);
    },
    setMotion(m) {
      motion = { show: !!m.show, has: !!m.has, label: String(m.label || ''), open: !!m.open };
      handles.setMotion(motion);
      place();
    },
    pressMotion() {
      if (motion.show) pressMotion(handles.motionRect(), false, true);
    },
    setLook(on) {
      spaceHeld = !!on;
    },
    setFly(keys, fast) {
      if (!canFly()) return;
      const next = keys.filter((k)              => k in FLY_DIRS);
      // A key just pressed in the shell moves at once, as in the game page (FLY_KICK_S).
      const fresh = next.filter((k) => !shellFly.includes(k));
      shellFly = next;
      shellFast = !!fast;
      if (fresh.length) flyBy(fresh, FLY_KICK_S, shellFast, true);
      if (next.length) flyStart();
    },
    setHandleSize(px) {
      handles.setSize(px);
      riseUi?.setSize(px);
      place();
    },
    setTheme(theme) {
      handles.setTheme(theme);
      riseUi?.setTheme(theme);
    },
    setInset(inset) {
      handles.setInset(inset);
      riseUi?.setInset(inset);
      place();
    },
    setAiMarks(keys, label) {
      aiKeys = keys.slice();
      aiLabel = label;
      shapes.ai.sig = '';
      place();
    },
    keyAt(x, y) {
      return tappableAt(adapter, state.items, win, x, y, UI.pickRadiusTouch)[0] ?? null;
    },
    setHover(keys) {
      if (keys.join('\n') === hoverKeys.join('\n')) return;
      hoverKeys = keys.slice();
      shapes.hover.sig = '';
      shapes.hover.at = 0; // a new row under the mouse draws at once (not after the 40 ms wait)
      place();
    },
    setLang(l) {
      lang = l;
      handles.setLabels(HANDLE_LABELS[lang] || HANDLE_LABELS.en);
      riseLabels();
      axisShown = null;
      showAxis();
    },
    detach() {
      endGesture();
      nativeClearTimeout(pressTimer);
      nativeClearTimeout(menuTimer);
      for (const [t, fn] of winListeners) win.removeEventListener(t, fn, opts);
      for (const w of above) for (const t of ['pointerup', 'mouseup']         ) w.removeEventListener(t, onUpAbove, { capture: true });
      nativeClearTimeout(hintTimer);
      handles.destroy();
      if (riseFrame) core.time.cancelRaf(riseFrame);
      if (flyFrame) core.time.cancelRaf(flyFrame);
      riseUi?.destroy();
      doc.documentElement.style.touchAction = prevTouchAction;
    },
  };
}

__def(__exports, "screenShareOf", () => screenShareOf);
__def(__exports, "tappableAt", () => tappableAt);
__def(__exports, "attachInput", () => attachInput);
};
__defs[34] = function (__exports) {
'use strict';
// observe.ts

// Watch the game play for a moment when editing starts, to find what it moves by itself (Item.held 'game').
//
// WHY (a hands-on try of 2026-10-19, item 5): "the pillars of this game flow toward you every frame and are put
// back far away, at a random place each time. So if I move one in the editor and save, that place is not kept."
// Nothing told them. Asked for: "before editing starts, run the game a little, find the objects whose position the
// game changes by itself, and say so on them" — this file is the finding; hold.ts holds them; the card says why.
//
// How: the editor freezes the game after its first frame (core/time.ts). Right after the edit view is up, the
// editor lets the game's own frames run for WATCH_MS (its draws stay held by the adapter, so the picture does not
// jump), freezes it again, compares every listed pose, and puts the moved objects back where the first frame had
// them (setPose, exact) — the scene the person edits is still the game's first picture.
// WHY not before the edit view: the first picture would then not be the game's first frame any more, and every
// test and reload that opens on it would move. WHY 0.6 s: a runner at 20 m/s moves a pillar 12 m, a slow bobbing
// coin a few cm; a game that only moves things after a key press or a timer is not caught (nothing to say then).
                                                      
                                        

const WATCH_MS = 600;

/** Smallest change that counts: 1 mm / 0.5 px, about 0.06°, 0.1 % of the size. Below that is float noise. */
const EPS = { p3: 1e-3, p2: 0.5, r: 1e-3, s: 1e-3 };

const scaleOf = (p      ) => (Array.isArray(p.s) ? p.s : [p.s ?? 1, p.s ?? 1, p.s ?? 1]);
const turnOf = (p      ) => [p.r ?? 0, ...(p.t ?? [0, 0])];
const angleGap = (a        , b        ) => {
  const d = Math.abs((((a - b) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
  return Math.min(d, 2 * Math.PI - d);
};

/** What changed for each key listed both times. Objects that came or went in between are left out. */
function drivenBetween(before        , after        , dim     )                      {
  const was = new Map(before.map((i) => [i.key, i.pose]         ));
  const out = new Map                ();
  for (const it of after) {
    const a = was.get(it.key);
    const b = it.pose;
    if (!a || !b) continue;
    const eps = dim === '3d' ? EPS.p3 : EPS.p2;
    const gap = (i        ) => Math.abs((a.p[i] ?? 0) - (b.p[i] ?? a.p[i] ?? 0)) > eps;
    // 3D: across the ground (x, z) apart from the height (y): a boat that bobs keeps the place it is given.
    const move = dim === '3d' ? gap(0) || gap(2) : gap(0) || gap(1);
    const lift = dim === '3d' && gap(1);
    const ta = turnOf(a), tb = turnOf(b);
    const turn = ta.some((v, i) => angleGap(v, tb[i] ) > EPS.r);
    const sa = scaleOf(a), sb = scaleOf(b);
    const size = sa.some((v, i) => Math.abs(v - sb[i] ) > EPS.s * Math.max(1, Math.abs(v)));
    if (move || lift || turn || size) out.set(it.key, { move, lift, turn, size });
  }
  return out;
}

__def(__exports, "WATCH_MS", () => WATCH_MS);
__def(__exports, "drivenBetween", () => drivenBetween);
};
__defs[35] = function (__exports) {
'use strict';
// timeline-path.ts

// The timeline in the game page (studio-timeline, 2026-10-22; CONTRACT.md §1.9): the poses the shell works out for the time line, and the picked object's
// path in 3D — Blender's motion path, Unity's trajectory.
//
// timeline/pose: each object put where the shell says (its place + its clip at the time line), through the copy/delete
//   layer (no game rules, no snapping: a grid snap would make a motion jump) and reported to nobody: a preview is not
//   an edit (input.ts still reads the object where it shows, so a drag starts from what the person sees).
// timeline/path: the curve through the position keys — the same curve the object follows (the loader's trackAt, with
//   the keys' eases), sampled and projected every frame, so it is a line in the 3D scene, not on the screen. Under it:
//   a faint copy of the curve at the object's resting height, and from each key a dashed line straight down to it (a
//   small shadow where it lands), so how high a point is reads from any side. A white dot with an orange ring on each
//   key (a picked one is filled orange), its time beside it, a small orange ring where the time line is.
// Dragging a dot: across the ground at its own height (adapter.toGround), or with Shift up and down (the ↑↓ tool's
//   job, here on the dot: px → metres measured at the dot). Live to the shell (timeline/point), one undo step there.
//
// WHY DOM in a shadow root, as handles.ts: the same look and hit in every engine, out of reach of the game's CSS.
// WHY the press is taken here before input.ts sees it: this file's window listeners are added when the editor is made,
// before input.ts attaches its own (capture listeners on one target run in the order they were added), so a press on
// a dot never selects or drags what is under it; any other press goes on to input.ts untouched.
// (This replaces motion.ts of motion-gui, the same day: its flat dotted path on the ground and its ▶ for one object.)
//
// studio-timeline-2 (2026-10-22): the path's shape by hand.
//   - A picked point shows its two handles (a small square on a thin line; handlesOf = the loader's own, so a handle
//     never seen before sits where the smooth curve already goes). Drag = timeline/handle (the other side lines up,
//     Alt: only this one; Shift: up / down). Only picked points: handles on every point would bury the path.
//   - A corner point (both handles 0) is drawn as a diamond; a double-click on a point makes / unmakes one
//     (timeline/corner).
//   - Over the path's line a dashed "+" follows the pointer with its time; a click there = timeline/insert (a key at
//     that moment). The line's hit is a wide transparent stroke under the dots, so the dots still win.
//   - The area's four floor corners are handles too: drag = its size from the opposite corner (Shift: its height).
// Positions: the place and the keys are the object's PARENT space; toScreen / toGround speak the scene's. They agree
// for objects at the top of the scene (every starter's); an object inside a moved group draws its path off by the
// group's offset (stage 2).
                                                                                                                     
const { handlesOf, trackAt } = __require(20);

const YOU = '#ff6b1a';
const WORDS                                                                                                                            = {
  en: { point: (t) => `Key at ${t} s: drag to move it, Shift+drag for up and down · double-click: corner`, area: 'The area: drag to move it, Shift+drag for up and down',
    handle: 'Handle: drag to bend the path · Alt: this side only · Shift: up / down', corner: 'Corner: drag to resize (the opposite corner stays) · Shift: height',
    line: (t) => `Click to add a key at ${t} s` },
  ja: { point: (t) => `${t} 秒のキー：引いて動かす・Shift で上下・ダブルクリックで角`, area: '範囲：引いて動かす・Shift で上下',
    handle: '取っ手：引いて道を曲げる・Alt で片側だけ・Shift で上下', corner: '隅：引いて大きさを変える（反対の隅はそのまま）・Shift で高さ',
    line: (t) => `押すと ${t} 秒にキー` },
};

const CSS = `
.root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.hit { pointer-events: auto; cursor: grab; fill: transparent; }
.hit.on { cursor: grabbing; }
.line { pointer-events: stroke; cursor: copy; fill: none; stroke: transparent; }
text { font: 600 11px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; fill: #fff; paint-order: stroke; stroke: rgba(0,0,0,.5); stroke-width: 3px; }
`;

                                   
                                  
                                                                                   
                           
                                                                                                     
                         
                               
               
                    
 

                               
                                   
                                                         
                
                                                          
                
 

                                                                                                     

function createTimelineView(d                  )               {
  const { win } = d;
  const doc = win.document;
  const host = doc.createElement('div');
  host.setAttribute('data-studio-ui', '');
  host.setAttribute('data-studio-timeline', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const root = doc.createElement('div');
  root.className = 'root';
  const NS = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(NS, 'svg')                 ;
  root.append(svg);
  shadow.append(style, root);
  let mounted = false;
  const mount = () => {
    if (!mounted && doc.body) (doc.body.append(host), (mounted = true));
  };

  let shown               = null;
  // The picked clip's area (studio-motion-triggers): a box in world space; its middle is a dot to drag (i = -1).
  let area                                                       = null;
  // A drag: a point (i ≥ 0), the area's middle (i = -1), a handle (`side`), an area corner (`corner` 0–3), or a press on
  // the line (`line`: a key there if it ends without moving). `moved` = past 3 px (a press that never moved posts nothing).
  let drag                                                                                                                                                 
                                                                                       = null;
  let drawn = '';
  // The "+" on the line under the pointer (its screen point and the clip's time there), and the line's samples.
  let ghost                                            = null;
  let samples                                                   = [];
  // The last press released on a point without moving (a second one soon after on the same point = a double-click).
  let lastUp                                   = null;

  /** The curve's points in the scene: `samples` per span between keys (the loader's own maths). */
  const curve = (s       , n = 20)                                    => {
    const ks = s.keys;
    if (ks.length < 2) return ks.map((k) => ({ w: k.v.map((v, i) => v + (s.base[i] ?? 0)), t: k.t }));
    const out                                    = [];
    for (let i = 0; i < ks.length - 1; i++) {
      const a = ks[i] .t, b = ks[i + 1] .t;
      for (let j = 0; j < n; j++) {
        const t = a + ((b - a) * j) / n;
        const v = trackAt(ks, t, true)                   ;
        if (v) out.push({ w: v.map((x, k) => x + (s.base[k] ?? 0)), t });
      }
    }
    const last = ks[ks.length - 1] ;
    out.push({ w: last.v.map((v, k) => v + (s.base[k] ?? 0)), t: last.t });
    return out;
  };
  /** A key's point in the scene, and its handle `side` (null at an end). */
  const keyW = (s       , i        ) => s.keys[i] .v.map((v, j) => v + (s.base[j] ?? 0));
  const handleW = (s       , i        , side              ) => {
    const h = (handlesOf(s.keys, i)                                                 )[side];
    return h ? keyW(s, i).map((v, j) => v + (h[j] ?? 0)) : null;
  };
  const isCorner = (k           ) => !!(k.in || k.out) && [k.in, k.out].every((h) => !h || Math.hypot(...h) < 1e-9);

  const draw = () => {
    const a = d.adapter();
    const s = shown;
    const hasPath = !!s && !!s.keys.length && !!a.toScreen && s.base.length === 3;
    const hasArea = !!area && !!a.toScreen && area.a.p.length === 3;
    if (!hasPath && !hasArea) {
      if (svg.firstChild) svg.replaceChildren();
      drawn = '';
      return;
    }
    const scr = (w          ) => a.toScreen (w);
    if (!hasPath) {
      const sig = JSON.stringify([areaSig(scr), drag?.i ?? 0]);
      if (sig === drawn) return;
      drawn = sig;
      mount();
      svg.replaceChildren();
      drawArea(scr);
      return;
    }
    if (!s) return;
    const pts = curve(s);
    const ground = (w          ) => [w[0] , s.base[1] , w[2] ];
    const line = pts.map((q) => scr(q.w));
    samples = pts.map((q, i) => ({ p: line[i] , t: q.t }));
    const shadowLine = pts.map((q) => scr(ground(q.w)));
    const keysW = s.keys.map((k) => k.v.map((v, i) => v + (s.base[i] ?? 0)));
    const keysS = keysW.map(scr);
    const dropS = keysW.map((w) => scr(ground(w)));
    const nowS = s.now ? scr(s.now.map((v, i) => v + (s.base[i] ?? 0))) : null;
    const hand = s.sel.flatMap((i) => (['in', 'out']         ).map((side) => {
      const w = s.keys[i] ? handleW(s, i, side) : null;
      return w ? { i, side, p: scr(w) } : null;
    })).filter((x)                                                                     => !!x);
    const sig = JSON.stringify([line, keysS, nowS, s.sel, drag?.i ?? -1, drag?.side ?? '', drag?.corner ?? -1, d.lang(), hasArea ? areaSig(scr) : null, hand, ghost, s.keys.map(isCorner)]);
    if (sig === drawn) return;
    drawn = sig;
    mount();
    svg.replaceChildren();
    const pathD = (ps                                ) => {
      let out = '';
      let pen = false;
      for (const p of ps) {
        if (!p) {
          pen = false;
          continue;
        }
        out += `${pen ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
        pen = true;
      }
      return out;
    };
    const stroke = (dd        , color        , width        , dash         ) => {
      const el = doc.createElementNS(NS, 'path');
      el.setAttribute('d', dd);
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke', color);
      el.setAttribute('stroke-width', String(width));
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      if (dash) el.setAttribute('stroke-dasharray', dash);
      svg.append(el);
    };
    const circle = (p                  , r        , fill        , ring         , width = 2.5) => {
      const c = doc.createElementNS(NS, 'circle');
      c.setAttribute('cx', p[0].toFixed(1));
      c.setAttribute('cy', p[1].toFixed(1));
      c.setAttribute('r', String(r));
      c.setAttribute('fill', fill);
      if (ring) (c.setAttribute('stroke', ring), c.setAttribute('stroke-width', String(width)));
      svg.append(c);
      return c;
    };
    // Underneath: the curve's shadow at the resting height, and each key's drop to it.
    stroke(pathD(shadowLine), 'rgba(0,0,0,.3)', 1.6, '2 5');
    keysS.forEach((p, i) => {
      const g = dropS[i];
      if (!p || !g || Math.hypot(p[0] - g[0], p[1] - g[1]) < 2) return;
      stroke(`M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${g[0].toFixed(1)} ${g[1].toFixed(1)}`, 'rgba(255,255,255,.8)', 1.2, '3 3');
      const e = doc.createElementNS(NS, 'ellipse');
      e.setAttribute('cx', g[0].toFixed(1));
      e.setAttribute('cy', g[1].toFixed(1));
      e.setAttribute('rx', '6');
      e.setAttribute('ry', '2.5');
      e.setAttribute('fill', 'rgba(0,0,0,.3)');
      svg.append(e);
    });
    // The path: a dark halo under an orange line (readable on any colour, as the outline's halo is).
    const dd = pathD(line);
    stroke(dd, 'rgba(0,0,0,.28)', 6);
    stroke(dd, YOU, 2.5);
    const coarse = win.matchMedia?.('(pointer: coarse)').matches;
    // The line's own hit (under the dots): a press here puts a key at that moment (studio-timeline-2).
    if (s.keys.length > 1) {
      const lh = doc.createElementNS(NS, 'path');
      lh.setAttribute('d', dd);
      lh.setAttribute('class', 'line');
      lh.setAttribute('stroke-width', coarse ? '24' : '14');
      lh.setAttribute('data-line', '');
      svg.append(lh);
    }
    if (ghost && !drag) {
      const g = circle(ghost.p, 7, 'rgba(255,255,255,.55)', '#fff', 2);
      g.setAttribute('stroke-dasharray', '3 2');
      g.setAttribute('pointer-events', 'none');
      const plus = doc.createElementNS(NS, 'text');
      plus.setAttribute('x', (ghost.p[0] - 3.5).toFixed(1));
      plus.setAttribute('y', (ghost.p[1] + 4).toFixed(1));
      plus.textContent = '+';
      const tl = doc.createElementNS(NS, 'text');
      tl.setAttribute('x', (ghost.p[0] + 12).toFixed(1));
      tl.setAttribute('y', (ghost.p[1] + 16).toFixed(1));
      tl.textContent = `+ ${ghost.t.toFixed(1)}s`;
      svg.append(plus, tl);
    }
    keysS.forEach((p, i) => {
      if (!p) return;
      const on = s.sel.includes(i) || drag?.i === i;
      // A corner (both handles 0): a diamond, so its shape reads from the mark itself.
      if (isCorner(s.keys[i] )) {
        const r = on ? 7.5 : 6.5;
        const dm = doc.createElementNS(NS, 'rect');
        dm.setAttribute('x', (p[0] - r).toFixed(1));
        dm.setAttribute('y', (p[1] - r).toFixed(1));
        dm.setAttribute('width', String(2 * r));
        dm.setAttribute('height', String(2 * r));
        dm.setAttribute('rx', '1.5');
        dm.setAttribute('transform', `rotate(45 ${p[0].toFixed(1)} ${p[1].toFixed(1)})`);
        dm.setAttribute('fill', on ? YOU : '#fff');
        dm.setAttribute('stroke', on ? '#fff' : YOU);
        dm.setAttribute('stroke-width', '2.5');
        dm.setAttribute('data-corner-point', String(i));
        svg.append(dm);
      } else circle(p, on ? 8.5 : 7, on ? YOU : '#fff', on ? '#fff' : YOU);
      const t = s.keys[i] .t;
      const label = doc.createElementNS(NS, 'text');
      label.setAttribute('x', (p[0] + 12).toFixed(1));
      label.setAttribute('y', (p[1] - 9).toFixed(1));
      label.textContent = `${t.toFixed(1)}s`;
      svg.append(label);
      // The hit area is bigger than the dot: 32 px across with a mouse, 44 with a finger.
      const hit = circle(p, coarse ? 22 : 16, 'transparent');
      hit.setAttribute('class', `hit${drag?.i === i ? ' on' : ''}`);
      hit.setAttribute('data-point', String(i));
      hit.setAttribute('role', 'button');
      hit.setAttribute('aria-label', WORDS[d.lang()].point(t.toFixed(1)));
      const tip = doc.createElementNS(NS, 'title');
      tip.textContent = WORDS[d.lang()].point(t.toFixed(1));
      hit.append(tip);
    });
    if (nowS) circle(nowS, 5, 'none', YOU, 2);
    // The picked points' handles, on top of everything (they are what a press there means).
    for (const x of hand) {
      const k = keysS[x.i];
      // A handle on its point (a corner's, or one seen end-on) is not drawn: it would cover the point's own press
      // (a double-click there makes the corner smooth again; Point ▾ does too).
      if (!x.p || !k || Math.hypot(x.p[0] - k[0], x.p[1] - k[1]) < 10) continue;
      stroke(`M${k[0].toFixed(1)} ${k[1].toFixed(1)}L${x.p[0].toFixed(1)} ${x.p[1].toFixed(1)}`, 'rgba(255,255,255,.95)', 1.4);
      const on = drag?.i === x.i && drag.side === x.side;
      square(x.p, on ? 6 : 5, on ? YOU : '#fff', on ? '#fff' : YOU);
      const hit = circle(x.p, coarse ? 22 : 12, 'transparent');
      hit.setAttribute('class', `hit${on ? ' on' : ''}`);
      hit.setAttribute('data-handle', `${x.i}:${x.side}`);
      hit.setAttribute('data-part', 'tl-handle');
      hit.setAttribute('aria-label', WORDS[d.lang()].handle);
      const tip = doc.createElementNS(NS, 'title');
      tip.textContent = WORDS[d.lang()].handle;
      hit.append(tip);
    }
    if (hasArea) drawArea(scr);
  };
  /** A small square (a handle, an area corner): `r` = half its side. */
  function square(p                  , r        , fill        , ring        ) {
    const q = doc.createElementNS(NS, 'rect');
    q.setAttribute('x', (p[0] - r).toFixed(1));
    q.setAttribute('y', (p[1] - r).toFixed(1));
    q.setAttribute('width', String(2 * r));
    q.setAttribute('height', String(2 * r));
    q.setAttribute('rx', '1.5');
    q.setAttribute('fill', fill);
    q.setAttribute('stroke', ring);
    q.setAttribute('stroke-width', '2');
    svg.append(q);
    return q;
  }

  /** The area's 8 corners in the scene (bottom 4, then top 4). */
  const corners = (b            ) => {
    const [x, y, z] = b.p                            ;
    const [w, h, dd] = b.size.map((v) => v / 2)                            ;
    return [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]].map(([i, j, k]) => [x + i  * w, y + j  * h, z + k  * dd]);
  };
  const areaSig = (scr                                          ) => (area ? [corners(area.a).map(scr), scr(area.a.p), area.label] : null);
  /** The box: dashed white edges, an orange floor, a white dot with an orange ring in its middle (dragged like a key's dot). */
  function drawArea(scr                                          ) {
    if (!area) return;
    const c = corners(area.a).map(scr);
    const NSs = NS;
    const poly = (ix          , fill        ) => {
      const ps = ix.map((i) => c[i]);
      if (ps.some((p) => !p)) return;
      const el = doc.createElementNS(NSs, 'polygon');
      el.setAttribute('points', ps.map((p) => `${p [0].toFixed(1)},${p [1].toFixed(1)}`).join(' '));
      el.setAttribute('fill', fill);
      svg.append(el);
    };
    poly([0, 1, 2, 3], 'rgba(255,107,26,.18)');
    for (const [i, j] of [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]]                           ) {
      const p = c[i], q = c[j];
      if (!p || !q) continue;
      const el = doc.createElementNS(NSs, 'path');
      el.setAttribute('d', `M${p[0].toFixed(1)} ${p[1].toFixed(1)}L${q[0].toFixed(1)} ${q[1].toFixed(1)}`);
      el.setAttribute('stroke', 'rgba(255,255,255,.92)');
      el.setAttribute('stroke-width', '1.5');
      el.setAttribute('stroke-dasharray', '5 4');
      el.setAttribute('fill', 'none');
      svg.append(el);
    }
    const m = scr(area.a.p);
    if (!m) return;
    const dot = doc.createElementNS(NSs, 'circle');
    dot.setAttribute('cx', m[0].toFixed(1));
    dot.setAttribute('cy', m[1].toFixed(1));
    dot.setAttribute('r', drag?.i === -1 ? '8.5' : '7.5');
    dot.setAttribute('fill', drag?.i === -1 ? YOU : '#fff');
    dot.setAttribute('stroke', drag?.i === -1 ? '#fff' : YOU);
    dot.setAttribute('stroke-width', '2.5');
    svg.append(dot);
    const top = c[6];
    if (top && area.label) {
      const t = doc.createElementNS(NSs, 'text');
      t.setAttribute('x', (top[0] + 8).toFixed(1));
      t.setAttribute('y', (top[1] - 6).toFixed(1));
      t.textContent = area.label;
      svg.append(t);
    }
    // The four floor corners (studio-timeline-2): drag = the size from the opposite corner, Shift = the height.
    const coarse = win.matchMedia?.('(pointer: coarse)').matches;
    for (let ci = 0; ci < 4; ci++) {
      const p = c[ci];
      if (!p) continue;
      const on = drag?.corner === ci;
      square(p, on ? 6 : 5, on ? YOU : '#fff', on ? '#fff' : YOU);
      const ch = doc.createElementNS(NSs, 'circle');
      ch.setAttribute('cx', p[0].toFixed(1));
      ch.setAttribute('cy', p[1].toFixed(1));
      ch.setAttribute('r', coarse ? '22' : '12');
      ch.setAttribute('class', `hit${on ? ' on' : ''}`);
      ch.setAttribute('data-corner', String(ci));
      ch.setAttribute('data-part', 'tl-area-corner');
      ch.setAttribute('aria-label', WORDS[d.lang()].corner);
      const tip = doc.createElementNS(NSs, 'title');
      tip.textContent = WORDS[d.lang()].corner;
      ch.append(tip);
      svg.append(ch);
    }
    const hit = doc.createElementNS(NSs, 'circle');
    hit.setAttribute('cx', m[0].toFixed(1));
    hit.setAttribute('cy', m[1].toFixed(1));
    hit.setAttribute('r', coarse ? '22' : '16');
    hit.setAttribute('class', `hit${drag?.i === -1 ? ' on' : ''}`);
    hit.setAttribute('data-point', '-1');
    hit.setAttribute('data-part', 'tl-area');
    hit.setAttribute('aria-label', WORDS[d.lang()].area);
    const tip = doc.createElementNS(NSs, 'title');
    tip.textContent = WORDS[d.lang()].area;
    hit.append(tip);
    svg.append(hit);
  }

  // ----- dragging a key's dot, a handle, the area or one of its corners; a press on the line -----
  /** What a press is on: a point (≥ 0) / the area's middle (-1), a handle, an area corner, the line — or nothing of ours. */
  const targetOf = (e       )                                                                                              => {
    for (const t of e.composedPath()) {
      if (!(t instanceof Element) || !svg.contains(t)) continue;
      const hd = t.getAttribute('data-handle');
      if (hd !== null) return { handle: [Number(hd.split(':')[0]), hd.split(':')[1]                ] };
      const cn = t.getAttribute('data-corner');
      if (cn !== null) return { corner: Number(cn) };
      const pt = t.getAttribute('data-point');
      if (pt !== null) return { point: Number(pt) };
      if (t.hasAttribute('data-line')) return { line: true };
    }
    return null;
  };
  const opts = { capture: true, passive: false }                           ;
  const take = (e       ) => {
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
  };
  const r3 = (v        ) => Math.round(v * 1000) / 1000;
  /** Metres per screen px at world point `w`, measured one metre up (Shift: up / down). */
  const mppAt = (w          ) => {
    const a = d.adapter();
    const p0 = a.toScreen?.(w), p1 = a.toScreen?.([w[0] , w[1]  + 1, w[2] ]);
    const px = p0 && p1 ? Math.abs(p1[1] - p0[1]) : 0;
    return px > 0.5 ? 1 / px : 0.02;
  };
  /** The line's sample nearest to the pointer (screen px), with its time; null farther than `max` px. */
  const nearest = (x        , y        , max        ) => {
    let best                                            = null, bd = max;
    for (let j = 0; j < samples.length - 1; j++) {
      const a = samples[j] , b = samples[j + 1] ;
      if (!a.p || !b.p) continue;
      // The closest point on the segment a–b (the samples are 20 per span: fine enough to read a time off).
      const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1];
      const f = Math.max(0, Math.min(1, ((x - a.p[0]) * dx + (y - a.p[1]) * dy) / (dx * dx + dy * dy || 1)));
      const px = a.p[0] + dx * f, py = a.p[1] + dy * f;
      const dd = Math.hypot(px - x, py - y);
      if (dd < bd) (bd = dd), (best = { p: [px, py], t: Math.round((a.t + (b.t - a.t) * f) * 20) / 20 });
    }
    return best;
  };
  const moveTo = (e              , end         ) => {
    if (!drag) return;
    if (drag.corner !== undefined && area) {
      // An area corner: the opposite floor corner stays; Shift = the height (the floor stays).
      const b = area.a;
      let p = b.p.slice(), size = b.size.slice();
      if (drag.up || e.shiftKey) {
        if (!drag.up) (drag.up = true), (drag.y0 = e.clientY), (drag.size0 = b.size.slice());
        const hh = Math.max(0.2, r3((drag.size0 [1] ?? 0) + (drag.y0 - e.clientY) * drag.mpp));
        size[1] = hh;
        p[1] = r3(drag.floor  + hh / 2);
      } else {
        const hit = d.adapter().toGround?.(e.clientX, e.clientY, drag.floor);
        const opp = corners(b)[(drag.corner + 2) % 4] ;
        if (hit) {
          const w = Math.max(0.2, Math.abs(hit[0]  - opp[0] )), dz = Math.max(0.2, Math.abs(hit[2]  - opp[2] ));
          const sx = Math.sign(hit[0]  - opp[0] ) || 1, sz = Math.sign(hit[2]  - opp[2] ) || 1;
          p = [r3(opp[0]  + (sx * w) / 2), b.p[1] , r3(opp[2]  + (sz * dz) / 2)];
          size = [r3(w), b.size[1] , r3(dz)];
        }
      }
      area = { ...area, a: { p, size } };
      d.post({ type: 'studio:timeline/area-moved', key: area.key, p, size, end });
      d.markDirty();
      return;
    }
    if (drag.i === -1 && area) {
      const b = area.a;
      let p = b.p.slice();
      if (drag.up || e.shiftKey) {
        if (!drag.up) (drag.up = true), (drag.y0 = e.clientY), (drag.start = b.p.slice());
        p = drag.start.slice();
        p[1] = r3((drag.start[1] ?? 0) + (drag.y0 - e.clientY) * drag.mpp);
      } else {
        const hit = d.adapter().toGround?.(e.clientX, e.clientY, drag.h);
        if (hit) p = [r3(hit[0] ), b.p[1] ?? 0, r3(hit[2] )];
      }
      area = { ...area, a: { ...b, p } };
      d.post({ type: 'studio:timeline/area-moved', key: area.key, p, end });
      d.markDirty();
      return;
    }
    if (!shown) return;
    const s = shown;
    const k = s.keys[drag.i];
    if (!k) return;
    if (drag.side) {
      // A handle: across the ground at its own height, or (Shift) up / down; an offset from its point.
      const pt = keyW(s, drag.i);
      let h = drag.start.slice();
      if (drag.up || e.shiftKey) {
        if (!drag.up) (drag.up = true), (drag.y0 = e.clientY), (drag.start = h.slice());
        h[1] = r3((drag.start[1] ?? 0) + (drag.y0 - e.clientY) * drag.mpp);
      } else {
        const hit = d.adapter().toGround?.(e.clientX, e.clientY, drag.h);
        if (hit) h = [r3(hit[0]  - pt[0] ), drag.start[1] ?? 0, r3(hit[2]  - pt[2] )];
      }
      s.keys[drag.i] = { ...k, [drag.side]: h };
      d.post({ type: 'studio:timeline/handle', key: s.key, i: drag.i, side: drag.side, h, alone: e.altKey, end });
      d.markDirty();
      return;
    }
    let v = k.v.slice();
    if (drag.up || e.shiftKey) {
      // Up / down: the screen's px turned into metres at the dot (measured when the drag began).
      if (!drag.up) (drag.up = true), (drag.y0 = e.clientY), (drag.start = k.v.slice());
      v = drag.start.slice();
      v[1] = r3((drag.start[1] ?? 0) + (drag.y0 - e.clientY) * drag.mpp);
    } else {
      const hit = d.adapter().toGround?.(e.clientX, e.clientY, drag.h);
      if (hit) v = [r3(hit[0]  - s.base[0] ), k.v[1] ?? 0, r3(hit[2]  - s.base[2] )];
    }
    s.keys[drag.i] = { ...k, v };
    d.post({ type: 'studio:timeline/point', key: s.key, i: drag.i, v, end });
    d.markDirty();
  };
  const begin = (e              , w          , more                                   ) => {
    drag = { i: -2, id: e.pointerId, h: w[1] ?? 0, up: e.shiftKey, y0: e.clientY, mpp: mppAt(w), start: [], x0: e.clientX, yy0: e.clientY, moved: false, ...more };
    ghost = null;
    drawn = '';
  };
  const onDown = (e              ) => {
    const at = shown || area ? targetOf(e) : null;
    if (!at || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (at.corner !== undefined && area) {
      take(e);
      const c = corners(area.a)[at.corner] ;
      return begin(e, c, { corner: at.corner, floor: c[1], size0: area.a.size.slice() });
    }
    if (at.point === -1 && area) {
      take(e);
      return begin(e, area.a.p, { i: -1, start: area.a.p.slice() });
    }
    if (!shown) return;
    if (at.handle) {
      const [i, side] = at.handle;
      const w = handleW(shown, i, side);
      if (!w) return;
      take(e);
      return begin(e, w, { i, side, start: w.map((v, j) => v - keyW(shown , i)[j] ) });
    }
    if (at.line) {
      take(e);
      const n = nearest(e.clientX - root.getBoundingClientRect().left, e.clientY - root.getBoundingClientRect().top, 40);
      return begin(e, [0, 0, 0], { line: n ? n.t : -1 });
    }
    if (at.point === undefined || at.point < 0) return;
    const k = shown.keys[at.point];
    if (!k) return;
    take(e);
    begin(e, keyW(shown, at.point), { i: at.point, start: k.v.slice() });
  };
  const onMove = (e              ) => {
    if (!drag) {
      // The "+" on the line follows a mouse over it (studio-timeline-2). Not taken: the game's own hover goes on.
      if (!shown || e.pointerType === 'touch') return;
      const over = targetOf(e)?.line;
      const r = root.getBoundingClientRect();
      const g = over ? nearest(e.clientX - r.left, e.clientY - r.top, 40) : null;
      if (JSON.stringify(g) !== JSON.stringify(ghost)) (ghost = g), (drawn = ''), d.markDirty();
      return;
    }
    if (e.pointerId !== drag.id) return;
    take(e);
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.yy0) < 3) return;
    drag.moved = true;
    if (drag.line === undefined) moveTo(e, false);
  };
  const onUp = (e              ) => {
    if (!drag || e.pointerId !== drag.id) return;
    take(e);
    const dg = drag;
    if (dg.line !== undefined) {
      // A press on the line that did not move: a key at that moment.
      if (!dg.moved && dg.line >= 0 && shown) d.post({ type: 'studio:timeline/insert', key: shown.key, t: dg.line });
    } else if (dg.moved) moveTo(e, true);
    else if (dg.i >= 0 && !dg.side && shown) {
      // A point pressed twice without moving (within 400 ms): a corner, or smooth again.
      const now = performance.now();
      if (lastUp && lastUp.i === dg.i && now - lastUp.at < 400) {
        d.post({ type: 'studio:timeline/corner', key: shown.key, i: dg.i });
        lastUp = null;
      } else lastUp = { i: dg.i, at: now };
    }
    drag = null;
    drawn = '';
    d.markDirty();
  };
  win.addEventListener('pointerdown', onDown, opts);
  win.addEventListener('pointermove', onMove, opts);
  win.addEventListener('pointerup', onUp, opts);
  win.addEventListener('pointercancel', onUp, opts);

  return {
    handle(msg) {
      if (msg.type === 'studio:timeline/pose') {
        const p = d.poser();
        for (const e of msg.poses) {
          try {
            p.setPose(e.key, e.pose        );
          } catch {
            /* gone (deleted, the page changing): the others go on */
          }
        }
        d.markDirty();
      } else if (msg.type === 'studio:timeline/area') {
        const mine = (drag?.i === -1 || drag?.corner !== undefined) && area && msg.key === area.key;
        // While the area or a corner is dragged, ours is newer (the label still follows the shell's).
        if (mine) area = { ...area , label: msg.label ?? area .label };
        else area = msg.key && msg.area ? { key: msg.key, a: structuredClone(msg.area), label: msg.label ?? '' } : null;
        drawn = '';
        d.markDirty();
      } else if (msg.type === 'studio:timeline/path') {
        // While a dot is dragged, the shell's echo of the same key keeps the dot under the finger (ours is newer).
        // A handle's drag takes the shell's keys (the other handle lining up is worked out there); a point's keeps ours.
        if (drag && shown && msg.key === shown.key && !drag.side) {
          shown = { ...shown, base: msg.base ?? shown.base, now: msg.now ?? null, sel: msg.sel ?? [] };
        } else if (drag?.side && shown && msg.key === shown.key && msg.keys?.length) {
          shown = { ...shown, base: msg.base ?? shown.base, keys: structuredClone(msg.keys), now: msg.now ?? null, sel: msg.sel ?? [] };
        } else {
          drag = null;
          shown = msg.key && msg.base && msg.keys?.length ? { key: msg.key, base: msg.base.slice(), keys: structuredClone(msg.keys), now: msg.now ?? null, sel: msg.sel ?? [] } : null;
        }
        drawn = '';
        d.markDirty();
      }
    },
    frame() {
      draw();
    },
    clear() {
      shown = null;
      area = null;
      drag = null;
      ghost = null;
      draw();
    },
  };
}

__def(__exports, "createTimelineView", () => createTimelineView);
};
__defs[36] = function (__exports) {
'use strict';
// ui-extras.ts

// UI stages 2–3 in the game page (studio-ui-edit-2, 2026-10-22; CONTRACT.md §1.11):
// what the UI layer does besides moving and resizing — the game's screens, sample values, an element's text / size /
// colours, a button's looks, and the theme's CSS variables. The editor (editor.ts) hands it every studio:ui/* message.
//
// The rule of the whole editor holds: nothing here is the game's code. Everything is undone at the end of editing
// (end(): Play in the same page shows the game as its code makes it, and a reload forgets it anyway), EXCEPT `set` and
// the theme: those are the person's layout, like a moved title, so they stay for Play — the loader (studio-placement.js)
// gives the same look to the game from placement.json.
//
// Screens (stage 2): containers marked data-studio-screen="title|play|pause|over|…". Showing one = the others get
// display: none !important, and the chosen one loses its `hidden` and, when its CSS still hides it, gets the display
// its own rules give it (the last rule of the page that matches it with another display; else block). The old
// attribute / inline values are kept and put back. The game's time stays frozen: its code never runs for this.
//
// Looks (stage 3): one style sheet in the game page (#studio-ui-edit), written again from the state on each change:
//   - the person's colours as the loader writes them (a plain rule for the normal look, !important for a state's), so
//     what the editor shows is what the game will show;
//   - a button's look shown on request ("Hover" on the card): the page's :hover / :active / :disabled rules that touch
//     that button, copied with the pseudo-class turned into [data-studio-state~="hover"] (CSS cannot be told "this is
//     hovered"), and the attribute on the button. Never the real `disabled`: a disabled button takes no pointer, and the
//     person must still be able to drag it;
//   - no transitions on marked elements while this sheet is up (a 0.2 s colour fade would make the card read the colour
//     halfway).
// The text and its size go on the text itself (uiTextPart, shared with the loader); the colour of a text inside the
// element too (inline); the colour of an element that is its own text (a button) and the fill in the sheet, inline only
// when the game's own normal rule is more specific than one attribute (the same test as the loader's).
                                                                                                                                       
const { uiTextNode, uiTextPart } = __require(20);

                               
              
                                 
                                                                                          
                 
 

                           
                                                                                               
                
                                                                                                                      
              
                                                                       
                                      
                                                                               
                                     
 

const KEY = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;
const THEME_NAME = /^--[A-Za-z0-9_-]{1,60}$/;
const STATES            = ['hover', 'active', 'disabled'];
const PSEUDO                          = { hover: /:hover\b/g, active: /:active\b/g, disabled: /:disabled\b/g };
const PSEUDO_CSS                          = { hover: ':hover', active: ':active', disabled: ':disabled' };

/** "rgb(255, 246, 216)" → "#fff6d8" (an alpha below 1 keeps the rgba() form: the colour field cannot show it). */
function hexColor(c        )         {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(c.trim());
  if (!m) return c.trim();
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (a < 1) return `rgba(${Math.round(+m[1] )}, ${Math.round(+m[2] )}, ${Math.round(+m[3] )}, ${Math.round(a * 1000) / 1000})`;
  return '#' + [m[1], m[2], m[3]].map((v) => Math.max(0, Math.min(255, Math.round(+v ))).toString(16).padStart(2, '0')).join('');
}
const clear = (c        ) => /^rgba\([^)]*,\s*0\)$/.test(c.replace(/\s+/g, ' ')) || c === 'transparent';

/** Split a selector list at its top-level commas (":is(a, b)" stays one). */
function splitSelectors(s        )           {
  const out           = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out.filter(Boolean);
}

function createUiExtras(deps              )           {
  const { win } = deps;
  const doc = win.document;

  // ---- the page's style rules (same-origin sheets only; a cross-origin one cannot be read and is skipped) ----
  const styleRules = ()                 => {
    const out                 = [];
    const walk = (list             ) => {
      for (const r of Array.from(list)) {
        if ((r                ).selectorText !== undefined && (r                ).style) out.push(r                );
        else if ((r                ).media && (r                ).cssRules) {
          if (win.matchMedia((r                ).media.mediaText || 'all').matches) walk((r                ).cssRules);
        } else if ((r                   ).cssRules) walk((r                   ).cssRules);
      }
    };
    for (const sh of Array.from(doc.styleSheets)) {
      if ((sh.ownerNode                  )?.id === 'studio-ui-edit' || (sh.ownerNode                  )?.id === 'studio-edit-layer') continue;
      try {
        walk(sh.cssRules);
      } catch {
        /* cross-origin: not readable */
      }
    }
    return out;
  };
  const matches = (el         , sel        ) => {
    try {
      return el.matches(sel);
    } catch {
      return false;
    }
  };

  // ---------------------------------------------------------------- screens
  const screenEls = () => Array.from(doc.querySelectorAll             ('[data-studio-screen]')).filter((e) => KEY.test(e.dataset.studioScreen || ''));
  const drawn = (e         ) => e.getClientRects().length > 0 && win.getComputedStyle(e).visibility !== 'hidden';
  let forced                = null;
  const kept = new Map                                                                                ();
  const keep = (e             , props          ) => {
    if (!kept.has(e)) kept.set(e, { hidden: e.getAttribute('hidden'), style: props.map((p) => [p, e.style.getPropertyValue(p), e.style.getPropertyPriority(p)]) });
  };
  const putBack = () => {
    for (const [e, k] of kept) {
      if (k.hidden === null) e.removeAttribute('hidden');
      else e.setAttribute('hidden', k.hidden);
      for (const [p, v, pr] of k.style) {
        if (v) e.style.setProperty(p, v, pr);
        else e.style.removeProperty(p);
      }
      if (!e.getAttribute('style')) e.removeAttribute('style');
    }
    kept.clear();
  };
  /** The display the page's own CSS gives this container when shown (not `none`), else block. */
  const ownDisplay = (e             )         => {
    let d = '';
    for (const r of styleRules()) {
      const v = r.style.getPropertyValue('display');
      if (v && v !== 'none' && matches(e, r.selectorText)) d = v;
    }
    return d || 'block';
  };
  const showScreen = (id               ) => {
    putBack();
    forced = id;
    if (id === null) return;
    for (const e of screenEls()) {
      keep(e, ['display', 'visibility', 'opacity']);
      if (e.dataset.studioScreen !== id) {
        e.style.setProperty('display', 'none', 'important');
        continue;
      }
      e.removeAttribute('hidden');
      if (win.getComputedStyle(e).display === 'none') e.style.setProperty('display', ownDisplay(e), 'important');
      const cs = win.getComputedStyle(e);
      if (cs.visibility === 'hidden') e.style.setProperty('visibility', 'visible', 'important');
      if (cs.opacity === '0') e.style.setProperty('opacity', '1', 'important');
    }
  };
  const screens = ()                 => {
    const seen = new Set        ();
    const out                 = [];
    for (const e of screenEls()) {
      const id = e.dataset.studioScreen ;
      if (seen.has(id)) continue;
      seen.add(id);
      const label = (e.dataset.studioScreenLabel || '').replace(/\s+/g, ' ').trim().slice(0, 40);
      out.push(label ? { id, label } : { id });
    }
    return out;
  };
  const current = ()                => forced ?? screenEls().find(drawn)?.dataset.studioScreen ?? null;
  const postScreens = () => {
    const list = screens();
    if (list.length) deps.post({ type: 'studio:ui/screens', screens: list, current: current(), forced: forced !== null });
  };

  // ---------------------------------------------------------------- elements
  const byKey = (key        )                => (KEY.test(key) ? Array.from(doc.querySelectorAll             (`[data-studio-key="${key}"]`)) : []);
  const first = (key        ) => byKey(key).find((e) => e.getClientRects().length) || null;
  const isButton = (e             ) => {
    const tag = e.tagName.toLowerCase();
    return tag === 'button' || e.getAttribute('role') === 'button' || (tag === 'input' && /^(button|submit|reset)$/.test((e                    ).type));
  };
  /** Where a sample value goes: the element's data-studio-value (a score's number), else its text. */
  const sampleTarget = (e             )                                             => {
    const v = e.matches('[data-studio-value]') ? e : e.querySelector             ('[data-studio-value]');
    if (v) return { el: v, value: true };
    const p = uiTextPart(e)                      ;
    return p ? { el: p, value: false } : null;
  };

  // The person's values (key → name or "@hover.color" → value) and the game's own, read once before the first change.
  const sets = new Map                                      ();
  const was = new Map                                      ();
  // Inline values this file wrote over, to put back when a value goes back to the game's (null).
  const inlineWas = new Map                                  ();
  const samples = new Map                                                             ();
  let shown                                         = null;

  const readNow = (e             )             => {
    const part = uiTextPart(e)                      ;
    const out             = {};
    if (part) {
      const n = uiTextNode(part)               ;
      if (n) out.text = n.data.replace(/\s+/g, ' ').trim();
      out.fontSize = Math.round(parseFloat(win.getComputedStyle(part).fontSize) * 10) / 10;
      out.color = hexColor(win.getComputedStyle(part).color);
    } else if (isButton(e)) out.color = hexColor(win.getComputedStyle(e).color);
    const bg = win.getComputedStyle(e).backgroundColor;
    if (!clear(bg)) out.background = hexColor(bg);
    return out;
  };
  /** The game's own value of one field (`name` or "@hover.color"), read the first time it is asked. */
  const wasOf = (key        , path        )                              => {
    const m = was.get(key) || new Map                         ();
    was.set(key, m);
    if (!m.has(path)) {
      const e = first(key);
      if (!e) return undefined;
      const [st, name] = path.startsWith('@') ? (path.slice(1).split('.')                         ) : [null, path              ];
      let v                             ;
      if (st) {
        // The state's look as the game draws it: shown without the person's own colours for that state.
        const keepShown = shown;
        const own = sets.get(key);
        const saved = own ? new Map(own) : null;
        if (own) for (const k of [...own.keys()]) if (k.startsWith(`@${st}.`)) own.delete(k);
        shown = { key, state: st };
        paint();
        v = readNow(e)[name                          ];
        if (own && saved) for (const [k, x] of saved) own.set(k, x);
        shown = keepShown;
        paint();
      } else v = readNow(e)[name];
      if (v !== undefined) m.set(path, v);
    }
    return m.get(path);
  };
  const setInline = (e             , prop        , v               ) => {
    const m = inlineWas.get(e) || new Map                ();
    inlineWas.set(e, m);
    if (!m.has(prop)) m.set(prop, e.style.getPropertyValue(prop));
    if (v === null) {
      const old = m.get(prop) || '';
      if (old) e.style.setProperty(prop, old);
      else e.style.removeProperty(prop);
    } else e.style.setProperty(prop, v);
  };

  let sheet                          = null;
  // While editing only: no transitions on marked elements (Play shows the game's own, with its fades).
  let editingNow = false;
  /** The style sheet (see the top): the person's colours, the shown state, no transitions. */
  const paint = () => {
    const rules           = [];
    for (const [key, m] of sets) {
      const sel = `[data-studio-key="${key}"]`;
      const e = first(key);
      const part = e ? (uiTextPart(e)                      ) : null;
      if (m.has('background')) rules.push(`${sel}{background-color:${m.get('background')}}`);
      if (m.has('color') && part === e) rules.push(`${sel}{color:${m.get('color')}}`);
      for (const st of STATES) {
        const on = `${sel}${PSEUDO_CSS[st]},${sel}[data-studio-state~="${st}"]`;
        const bg = m.get(`@${st}.background`), c = m.get(`@${st}.color`);
        if (bg !== undefined) rules.push(`${on}{background-color:${bg}!important}`);
        if (c !== undefined) rules.push(`${sel}${PSEUDO_CSS[st]},${sel}${PSEUDO_CSS[st]} *,${sel}[data-studio-state~="${st}"],${sel}[data-studio-state~="${st}"] *{color:${c}!important}`);
      }
    }
    // A shown state: the page's own rules for it, copied onto the attribute.
    for (const e of Array.from(doc.querySelectorAll             ('[data-studio-state]'))) delete e.dataset.studioState;
    if (shown) {
      const els = byKey(shown.key);
      for (const e of els) e.dataset.studioState = shown.state;
      const re = PSEUDO[shown.state];
      for (const r of styleRules()) {
        if (!r.selectorText.includes(PSEUDO_CSS[shown.state])) continue;
        const sels = splitSelectors(r.selectorText).filter((s) => {
          re.lastIndex = 0;
          if (!re.test(s)) return false;
          const base = s.replace(re, '') || '*';
          return els.some((e) => matches(e, base) || !!e.querySelector(base));
        });
        if (sels.length) rules.push(`${sels.map((s) => s.replace(re, `[data-studio-state~="${shown .state}"]`)).join(',')}{${r.style.cssText}}`);
      }
    }
    if (!rules.length && !shown && !editingNow) {
      sheet?.remove();
      sheet = null;
      return;
    }
    if (!sheet || !sheet.isConnected) {
      sheet = doc.createElement('style');
      sheet.id = 'studio-ui-edit';
      (doc.head || doc.documentElement).appendChild(sheet);
    }
    sheet.textContent = [...(editingNow ? ['[data-studio-key],[data-studio-key] *{transition:none!important}'] : []), ...rules].join('\n');
  };

  /** One field of one element: the person's value, or (null) the game's own again. */
  const setProp = (key        , name            , value                        , state          ) => {
    const els = byKey(key);
    if (!els.length) return;
    const path = state ? `@${state}.${name}` : name;
    if (state && name !== 'color' && name !== 'background') return;
    wasOf(key, path); // read before the first change
    const m = sets.get(key) || new Map                         ();
    sets.set(key, m);
    if (value === null) m.delete(path);
    else m.set(path, value);
    if (!m.size) sets.delete(key);
    for (const e of els) {
      const part = uiTextPart(e)                      ;
      if (state) continue; // states are the sheet's
      if (name === 'text' && part) {
        const n = uiTextNode(part)               ;
        if (!n) continue;
        // A sample in the same text goes: the words typed are the real ones now.
        const sm = samples.get(key);
        if (sm && sm.node === n) {
          n.data = sm.old;
          samples.delete(key);
        }
        const old = was.get(key)?.get('text');
        const words = value === null ? (typeof old === 'string' ? old : n.data.trim()) : String(value).slice(0, 200);
        const sp = /^(\s*)[\s\S]*?(\s*)$/.exec(n.data);
        n.data = (sp?.[1] ?? '') + words + (sp?.[2] ?? '');
      } else if (name === 'fontSize' && part) setInline(part, 'font-size', value === null ? null : `${Number(value)}px`);
      else if (name === 'color' && part && part !== e) setInline(part, 'color', value === null ? null : String(value));
    }
    paint();
    // The game's normal rule more specific than one attribute: the value inline (as the loader does).
    for (const e of els) {
      const part = uiTextPart(e)                      ;
      const check = (prop                              , v                             ) => {
        if (v === undefined) return setInline(e, prop, null);
        const now = hexColor(win.getComputedStyle(e).getPropertyValue(prop));
        if (now !== hexColor(cssColor(String(v)))) setInline(e, prop, String(v));
      };
      if (!state && name === 'background') check('background-color', sets.get(key)?.get('background'));
      if (!state && name === 'color' && part === e) check('color', sets.get(key)?.get('color'));
    }
  };
  const probe = doc.createElement('i');
  const cssColor = (c        ) => {
    probe.style.color = '';
    probe.style.color = c;
    probe.style.display = 'none';
    doc.documentElement.appendChild(probe);
    const v = win.getComputedStyle(probe).color;
    probe.remove();
    return v;
  };

  const sample = (key        , text               ) => {
    const e = first(key);
    if (!e) return;
    const old = samples.get(key);
    if (old) {
      if (old.node) old.node.data = old.old;
      else old.el.textContent = old.old;
      samples.delete(key);
    }
    if (text === null) return;
    const t = sampleTarget(e);
    if (!t) return;
    const words = text.slice(0, 200);
    if (t.value) {
      samples.set(key, { el: t.el, node: null, old: t.el.textContent || '' });
      t.el.textContent = words;
    } else {
      const n = uiTextNode(t.el)               ;
      if (!n) return;
      samples.set(key, { el: t.el, node: n, old: n.data });
      const sp = /^(\s*)[\s\S]*?(\s*)$/.exec(n.data);
      n.data = (sp?.[1] ?? '') + words + (sp?.[2] ?? '');
    }
  };

  const props = (key        )                 => {
    const e = first(key);
    if (!e) return null;
    const now = readNow(e);
    const part = uiTextPart(e);
    const st = shown && shown.key === key ? shown.state : null;
    // A look shown: its game's own colours read first, so this answer already carries them.
    if (st) for (const n of ['color', 'background']         ) wasOf(key, `@${st}.${n}`);
    const w             = {};
    for (const n of ['text', 'fontSize', 'color', 'background']         ) {
      const v = wasOf(key, n);
      if (v !== undefined) (w                           )[n] = v;
    }
    for (const s of STATES) {
      const o                          = {};
      for (const n of ['color', 'background']         ) if (was.get(key)?.has(`@${s}.${n}`)) o[n] = was.get(key) .get(`@${s}.${n}`);
      if (Object.keys(o).length) (w                           )[`@${s}`] = o;
    }
    const t = sampleTarget(e);
    const hint = (e.dataset.studioSample || t?.el.dataset.studioSample || '').slice(0, 200);
    return {
      key,
      state: st,
      button: isButton(e),
      text: part ? now.text ?? null : null,
      fontSize: part ? now.fontSize ?? null : null,
      color: now.color ?? null,
      background: now.background ?? null,
      was: w,
      sample: t ? { now: samples.get(key) ? (samples.get(key) .node ? samples.get(key) .node .data.trim() : samples.get(key) .el.textContent) : null, value: t.value, ...(hint ? { hint } : {}) } : null,
    };
  };
  const postProps = (key        ) => {
    const p = props(key);
    if (p) deps.post({ type: 'studio:ui/props', props: p });
  };

  // ---------------------------------------------------------------- theme
  const themeWas = new Map                ();
  const themeVars = ()               => {
    const names           = [];
    for (const r of styleRules()) {
      if (!splitSelectors(r.selectorText).some((s) => s === ':root' || s === 'html')) continue;
      for (let i = 0; i < r.style.length; i++) {
        const n = r.style[i] ;
        if (n.startsWith('--') && THEME_NAME.test(n) && !names.includes(n)) names.push(n);
      }
    }
    const cs = win.getComputedStyle(doc.documentElement);
    const out               = [];
    for (const name of names.slice(0, 100)) {
      const value = cs.getPropertyValue(name).trim();
      if (!value) continue;
      if (!themeWas.has(name)) themeWas.set(name, value);
      const type = /font|family|typeface/i.test(name) ? 'font' : (win                                 ).CSS?.supports?.('color', value) && !/^[\d.]+$/.test(value) ? 'color' : null;
      if (!type) continue;
      out.push({ name, type, value: type === 'color' ? hexColor(cssColor(value)) : value, was: type === 'color' ? hexColor(cssColor(themeWas.get(name) )) : themeWas.get(name)  });
    }
    return out;
  };
  const postTheme = () => {
    const vars = themeVars();
    if (vars.length) deps.post({ type: 'studio:ui/theme', vars });
  };
  const setTheme = (name        , value               ) => {
    if (!THEME_NAME.test(name)) return;
    if (!themeWas.has(name)) themeVars();
    if (value === null) doc.documentElement.style.removeProperty(name);
    else if (!/[;{}<>\\]/.test(value)) doc.documentElement.style.setProperty(name, value.slice(0, 200));
  };

  return {
    begin() {
      editingNow = true;
      if (forced !== null) showScreen(forced);
      paint();
      postScreens();
      postTheme();
    },
    end() {
      editingNow = false;
      for (const k of [...samples.keys()]) sample(k, null);
      shown = null;
      putBack();
      paint();
    },
    props,
    handle(msg) {
      switch (msg.type) {
        case 'studio:ui/screen':
          showScreen(typeof msg.id === 'string' && KEY.test(msg.id) ? msg.id : null);
          shown = null;
          paint();
          postScreens();
          deps.relist();
          return true;
        case 'studio:ui/sample':
          sample(msg.key, typeof msg.text === 'string' ? msg.text : null);
          postProps(msg.key);
          return true;
        case 'studio:ui/set':
          if (msg.name === 'text' || msg.name === 'fontSize' || msg.name === 'color' || msg.name === 'background') {
            const v = msg.value === null ? null : msg.name === 'fontSize' ? Math.max(1, Math.min(500, Number(msg.value) || 0)) : String(msg.value);
            setProp(msg.key, msg.name, v, msg.state && STATES.includes(msg.state) ? msg.state : undefined);
          }
          if (!msg.quiet) postProps(msg.key);
          return true;
        case 'studio:ui/state':
          shown = msg.key && msg.state && STATES.includes(msg.state) ? { key: msg.key, state: msg.state } : null;
          paint();
          if (msg.key) postProps(msg.key);
          return true;
        case 'studio:ui/theme-set':
          setTheme(msg.name, typeof msg.value === 'string' ? msg.value : null);
          if (!msg.quiet) postTheme();
          return true;
        case 'studio:ui/props-get':
          postProps(msg.key);
          return true;
        default:
          return false;
      }
    },
  };
}

__def(__exports, "hexColor", () => hexColor);
__def(__exports, "createUiExtras", () => createUiExtras);
};
__defs[37] = function (__exports) {
'use strict';
// ../shell/layers.ts

// Draw order (2D layers) in the shell: which object is in front of which.
// Pure functions over the item list (no DOM), so they are unit-tested.
//
// The adapter reports, per object, `layer` (the sibling list it is drawn in,
// usually its parent) and `pose.z` (its place among the LISTED objects of that
// list, 0 = back). Changing the order is one setPose with a new z, so undo,
// redo and the Save count reuse the pose machinery.
//
// WHY every target is "the z of another listed sibling" and never z ± 1: the
// adapter's ranks can have gaps (objects hidden by the game's rules are still
// counted), and moving to a sibling's z puts the object just past that
// sibling in the direction of travel. So "forward" always passes exactly one
// thing the person can see.
//
// Ground / background (Item.backdrop, play test 2026-10-16): "to back"
// once put a rock behind the ground, where it vanished. The backdrops at the
// back of a list stay there: they have no targets of their own, and nothing
// else goes behind them ("to back" = just in front of the ground).
                                           

                                                                    

/** True when the adapter can change the draw order of this object. */
const hasLayer = (it                  )                                 =>
  !!it && typeof it.layer === 'string' && typeof it.pose.z === 'number';

/** Listed objects drawn in the same list as `key`, back → front. */
function siblingsOf(items        , key        )         {
  const it = items.find((i) => i.key === key);
  if (!hasLayer(it)) return [];
  return items.filter((i) => hasLayer(i) && i.layer === it.layer).sort((a, b) => a.pose.z  - b.pose.z );
}

/**
 * How many siblings (back → front list) are ground / background kept at the
 * back: the lowest place anything else may take.
 */
function floorOf(sib        )         {
  let n = 0;
  while (n < sib.length && sib[n] .backdrop) n++;
  return n;
}

/** The z to send for a button/shortcut, or null when the object is already there (or is the ground). */
function layerTarget(items        , key        , op         )                {
  const sib = siblingsOf(items, key);
  const i = sib.findIndex((s) => s.key === key);
  if (i < 0 || sib.length < 2 || sib[i] .backdrop) return null;
  const floor = floorOf(sib);
  const to = op === 'toFront' ? sib.length - 1 : op === 'toBack' ? floor : op === 'forward' ? i + 1 : i - 1;
  if (to < floor || to >= sib.length || to === i) return null;
  return sib[to] .pose.z ;
}

/**
 * The z to send after a drag in the list. `frontIndex` = where the object was
 * dropped among its siblings as the list shows them (front first, 0 = top),
 * counted with the dragged object taken out.
 */
function dropTarget(items        , key        , frontIndex        )                {
  const sib = siblingsOf(items, key);
  const i = sib.findIndex((s) => s.key === key);
  if (i < 0 || sib[i] .backdrop) return null;
  const n = sib.length;
  // Front-first position k ↔ back-first rank n-1-k; dropped below the ground = just in front of it.
  const rank = Math.max(floorOf(sib), n - 1 - Math.max(0, Math.min(n - 1, Math.round(frontIndex))));
  return rank === i ? null : sib[rank] .pose.z ;
}

/** Keys of one list, back → front (what placement.json `order[].keys` holds). */
function orderOfLayer(items        , layer        )           {
  return items.filter((i) => hasLayer(i) && i.layer === layer).sort((a, b) => a.pose.z  - b.pose.z ).map((i) => i.key);
}

                           
             
                                                                                                 
                
 
                             
                                                                                         
                
                   
 

/**
 * The object list in draw order, front on top. Lists drawn inside a listed
 * object (Pixi: sprites in a container) are shown right under that object,
 * indented. Objects without a layer are not included (the caller shows them
 * after, as before).
 */
function layerBlocks(items        )               {
  const layered = items.filter(hasLayer);
  const keys = new Set(items.map((i) => i.key));
  const byLayer = new Map                ();
  for (const it of layered) {
    const arr = byLayer.get(it.layer ) || [];
    arr.push(it);
    byLayer.set(it.layer , arr);
  }
  for (const arr of byLayer.values()) arr.sort((a, b) => b.pose.z  - a.pose.z );
  const done = new Set        ();
  const walk = (layer        , depth        , rows            ) => {
    if (done.has(layer)) return; // a malformed adapter could report a cycle
    done.add(layer);
    for (const it of byLayer.get(layer) || []) {
      rows.push({ item: it, depth });
      if (byLayer.has(it.key)) walk(it.key, depth + 1, rows);
    }
  };
  const blocks               = [];
  for (const layer of byLayer.keys()) {
    if (keys.has(layer)) continue; // drawn inside a listed object: shown under it
    const rows             = [];
    walk(layer, 0, rows);
    blocks.push({ layer, rows });
  }
  // Lists whose parent object is listed but never reached (cycles): still show them.
  for (const layer of byLayer.keys()) {
    if (done.has(layer)) continue;
    const rows             = [];
    walk(layer, 0, rows);
    blocks.push({ layer, rows });
  }
  return blocks;
}

__def(__exports, "hasLayer", () => hasLayer);
__def(__exports, "siblingsOf", () => siblingsOf);
__def(__exports, "floorOf", () => floorOf);
__def(__exports, "layerTarget", () => layerTarget);
__def(__exports, "dropTarget", () => dropTarget);
__def(__exports, "orderOfLayer", () => orderOfLayer);
__def(__exports, "layerBlocks", () => layerBlocks);
};
__defs[38] = function (__exports) {
'use strict';
// ../shell/pose-compare.ts

// Pose rounding and comparison: the file's precision (1 mm or 0.1 px, 1e-4 rad) and "the same pose".
// Split out of placement-model.ts (2026-10-21) so the game page's ▶ Play code (bridge/play-arrange.ts) compares
// poses exactly as the editor does without bundling the whole model into studio-edit.js (it added 37 KB).
const { LIMITS } = __require(13);

function roundTo(v        , step        )         {
  return Math.round(v / step) * step;
}

/** Round a pose to the file's precision (1 mm or 0.1 px, 1e-4 rad). */
function roundPose(p      , dim     )       {
  const step = dim === '3d' ? LIMITS.step3d : LIMITS.step2d;
  const fix = (v        , s        ) => Number(roundTo(v, s).toFixed(6));
  const out       = { p: p.p.map((v) => fix(v, step)) };
  if (p.r !== undefined) out.r = fix(p.r, LIMITS.stepAngle);
  if (p.s !== undefined) out.s = Array.isArray(p.s) ? p.s.map((v) => fix(v, 0.0001)) : fix(p.s, 0.0001);
  // 3D tilt (rotation.x, rotation.z): only when the object was tipped (see Pose.t).
  if (p.t !== undefined && dim === '3d') out.t = [fix(p.t[0], LIMITS.stepAngle), fix(p.t[1], LIMITS.stepAngle)];
  return out;
}

/**
 * Two angles (already rounded) are the same turn: compared around the circle, not as numbers.
 *
 * WHY (90° bug, 2026-10-17): turning a 3D object past 90° about the up axis makes three.js write the same
 * rotation as x = ±π, y = π − θ, z = ±π. π rounds to 3.1416 in the file, which is a hair MORE than π, so the
 * adapter reads it back wrapped into (−π, π] as −3.14159 — the same turn, a different number. Comparing the
 * rounded JSON made every reopen of such a save show "Save · 1" with nothing changed.
 */
function sameAngle(a                    , b                    )          {
  if (a === undefined || b === undefined) return a === b;
  const TAU = Math.PI * 2;
  const d = Math.abs((((a - b) % TAU) + TAU) % TAU);
  // Half a rounding step: values one step apart (a real nudge) still differ.
  return Math.min(d, TAU - d) < LIMITS.stepAngle / 2;
}

function samePose(a                  , b                  , dim     )          {
  if (!a || !b) return a === b;
  const x = roundPose(a, dim), y = roundPose(b, dim);
  if (JSON.stringify(x.p) !== JSON.stringify(y.p) || JSON.stringify(x.s) !== JSON.stringify(y.s)) return false;
  if (!sameAngle(x.r, y.r)) return false;
  if (!x.t || !y.t) return !x.t === !y.t;
  return sameAngle(x.t[0], y.t[0]) && sameAngle(x.t[1], y.t[1]);
}

__def(__exports, "roundPose", () => roundPose);
__def(__exports, "samePose", () => samePose);
};
__defs[39] = function (__exports) {
'use strict';
// ../shell/timeline-model.ts

// The timeline's pure logic (studio-timeline, 2026-10-22; CONTRACT.md §1.9): clips and
// their keys, the pose an object shows at a time, the older motion shape read as a clip, a new motion, and the key
// edits the panel makes (set, move, delete, copy / paste, ease). No DOM: unit-tested in test/timeline.test.ts.
//
// WHY offsets from the place, not absolute values (Unity's clips hold absolute ones): the object's place
// (`objects` in placement.json) keeps its meaning — moving the object with the timeline folded carries the whole
// motion along, a level that puts the same object elsewhere reuses the motion, and the AI reads "turns 90° from where
// it stands". Position is added, angles are added, size is multiplied.
// WHY every change returns a new clip / motion: the undo stack keeps whole motions (`{ kind: 'motion', from, to }`,
// the change motion-gui added), so one edit = one snapshot, and nothing here mutates what the store holds.
                                                                                                                        
const { clipAt, motionAt } = __require(20);

const CHANNELS                  = ['p', 'r', 's'];
/** Two keys closer than this (seconds) are the same moment: a new key there replaces the old one. */
const SAME_T = 0.0005;
/** Keys dragged on the timeline snap to this (seconds); Alt drags freely. 1/20 s: fine enough for game motion, coarse enough to land on 1.0. */
const SNAP_T = 0.05;
const MIN_LEN = 0.1;
const MAX_LEN = 600;
const MAX_CLIPS = 16;
const MAX_KEYS = 256;
/** A new key's ease (Blender's and Unity's default curve: starts slowly, stops slowly). */
const DEFAULT_EASE             = 'ease';

                                                                                     

const rt = (t        ) => Math.round(t * 1000) / 1000;
const zeros = (n        ) => Array.from({ length: n }, () => 0);
const ones = (n        ) => Array.from({ length: n }, () => 1);
/** How many numbers one key of a channel holds: p / s 3 in 3D, 2 in 2D; r 3 in 3D, 1 in 2D. */
const width = (ch               , dim     ) => (dim === '3d' ? 3 : ch === 'r' ? 1 : 2);
/** The key value that changes nothing (the rest of a channel). */
const restOf = (ch               , dim     ) => (ch === 's' ? ones(width(ch, dim)) : zeros(width(ch, dim)));

/** Where a clip is at `t` (the loader's own maths, so the editor and the game agree). */
function offsetsAt(clip                               , t        )                              {
  return clipAt(clip, t)                               ;
}

/** The pose shown for an object at its place with these offsets. */
function compose(place      , at         , dim     )       {
  const out       = structuredClone(place);
  if (at.p) out.p = place.p.map((v, i) => v + (at.p [i] ?? 0));
  if (at.r) {
    if (dim === '3d') {
      out.r = (place.r ?? 0) + (at.r[1] ?? 0);
      const tx = (place.t?.[0] ?? 0) + (at.r[0] ?? 0), tz = (place.t?.[1] ?? 0) + (at.r[2] ?? 0);
      // A tilt only when there is one: a pose without `t` leaves the game's own x / z angles alone (contract Pose.t).
      if (place.t || Math.abs(tx) > 1e-9 || Math.abs(tz) > 1e-9) out.t = [tx, tz];
    } else out.r = (place.r ?? 0) + (at.r[0] ?? 0);
  }
  if (at.s) {
    const n = width('s', dim);
    const base = Array.isArray(place.s) ? place.s : Array.from({ length: n }, () => (typeof place.s === 'number' ? place.s : 1));
    const s = base.map((v, i) => v * (at.s [i] ?? 1));
    out.s = s.every((v) => Math.abs(v - s[0] ) < 1e-9) && !Array.isArray(place.s) ? s[0]  : s;
  }
  return out;
}

/** The offsets that turn `place` into `pose` (compose's inverse), for one channel. */
function offsetOf(place      , pose      , ch               , dim     )           {
  if (ch === 'p') return pose.p.map((v, i) => v - (place.p[i] ?? 0));
  if (ch === 'r') {
    if (dim !== '3d') return [(pose.r ?? 0) - (place.r ?? 0)];
    return [(pose.t?.[0] ?? 0) - (place.t?.[0] ?? 0), (pose.r ?? 0) - (place.r ?? 0), (pose.t?.[1] ?? 0) - (place.t?.[1] ?? 0)];
  }
  const n = width('s', dim);
  const vec = (s           ) => (Array.isArray(s) ? s : Array.from({ length: n }, () => (typeof s === 'number' ? s : 1)));
  const a = vec(place.s), b = vec(pose.s);
  return b.map((v, i) => (a[i] ? v / a[i]  : 1));
}

/** The channels whose value differs between two poses (what a drag / a typed number changed). */
function changedChannels(a      , b      , dim     )                  {
  const diff = (x          , y          , eps        ) => x.some((v, i) => Math.abs(v - (y[i] ?? 0)) > eps);
  const out                  = [];
  if (diff(a.p, b.p, 1e-6)) out.push('p');
  if (diff(offsetOf(a, b, 'r', dim), zeros(width('r', dim)), 1e-6)) out.push('r');
  if (diff(offsetOf(a, b, 's', dim), ones(width('s', dim)), 1e-6)) out.push('s');
  return out;
}

// ----- the older shape (v0.1.13) as a clip -----

/**
 * A motion in the timeline's shape: its clips as they are, or the older path / speed / repeat / spin turned into one
 * clip "Motion" that plays at the start. The path becomes position keys at the times the old constant speed reached
 * each point (straight lines: 'linear'); a loop gets its way back to the start as a last key; a spin becomes one turn
 * (0 → 360°, linear) that loops. With both, the spin is spread over the path's time.
 */
function toClips(m                           , dim     )                {
  if (!m) return null;
  if (m.clips?.length) return { clips: m.clips.map((c) => structuredClone(c)) };
  const keys                     = {};
  let len = 0;
  let repeat               = 'loop';
  if (m.path?.length) {
    const n = m.path[0] .length;
    const pts = [zeros(n), ...m.path.map((q) => q.slice())];
    repeat = m.repeat ?? 'pingpong';
    if (repeat === 'loop') pts.push(zeros(n));
    const speed = m.speed && m.speed > 0 ? m.speed : 1;
    let t = 0;
    keys.p = pts.map((v, i) => {
      if (i) t += Math.hypot(...v.map((x, k) => x - pts[i - 1] [k] )) / speed;
      return { t: rt(t), v, ease: 'linear'               };
    });
    len = Math.max(MIN_LEN, rt(t));
  }
  if (m.spin) {
    const turn = Math.sign(m.spin) * Math.PI * 2;
    const T = len || rt(Math.abs(turn / m.spin));
    len ||= Math.max(MIN_LEN, T);
    const v = (a        ) => (dim === '3d' ? [0, a, 0] : [a]);
    keys.r = [{ t: 0, v: v(0), ease: 'linear' }, { t: len, v: v(keys.p ? m.spin * len : turn), ease: 'linear' }];
  }
  if (!keys.p && !keys.r) return null;
  return { clips: [{ name: 'Motion', len, repeat, start: true, keys }] };
}

// ----- new motions (studio-no-presets, 2026-10-23) -----
// Until then this was "templates": the v0.1.13 kinds (Back and forth, Round, Once, Spin) kept as starting points, each
// with two or five keys the person never placed. A review, on seeing them in the menus: "what is this? presets? why
// are 'back and forth' and 'round' in there?" — and to "keep just 'Make a motion' and 'Use a saved motion'": "we don't
// need them" (10/23). A motion is made by showing it (timeline-wire make: where it stands is 0 s, a drag is the next
// key). A file whose motion goes back and forth still plays as it did: that is its `repeat` (and toClips above reads
// the older path / spin), never a template.

/** A motion with no keys yet: the clip menu's "+ Make a motion" on a thing that moves already (filled by the next move). */
function blankClip(name        )             {
  return { name, len: 2, repeat: 'once', keys: {} };
}
/** A scene (studio-timeline-2): an empty motion that holds several objects' rows (a cutscene; scene-motion.ts). Not a preset: no keys. */
function sceneClip(name        )             {
  return { name, len: 4, repeat: 'once', scene: true, keys: {} };
}

/** "Motion", or "Motion 2", "Motion 3"… — a name no clip of this object has. */
function freeName(clips              , base        )         {
  const taken = new Set(clips.map((c) => c.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}

// ----- keys -----

/** A key picked on the timeline: object, channel, time (a time names a key: two keys of a channel never share one). */
                         
              
                    
            
 
const refId = (r        ) => `${r.key}\n${r.ch}\n${rt(r.t)}`;
const sameT = (a        , b        ) => Math.abs(a - b) < SAME_T;

const sorted = (ks             ) => ks.slice().sort((a, b) => a.t - b.t);

/** The clip with a key at `t` on `ch` (replacing one at that moment, keeping its ease); the length grows to hold it. */
function setKey(c            , ch               , t        , v          , ease             )             {
  const out = structuredClone(c);
  const ks = out.keys[ch] ?? [];
  const at = ks.findIndex((k) => sameT(k.t, t));
  const key            = { t: rt(t), v: v.slice(), ease: ease ?? (at >= 0 ? ks[at] .ease : undefined) ?? DEFAULT_EASE };
  // A key set again keeps the path's handles it had (studio-timeline-2): moving a bent point keeps it bent.
  if (at >= 0 && ks[at] .in) key.in = ks[at] .in .slice();
  if (at >= 0 && ks[at] .out) key.out = ks[at] .out .slice();
  if (at >= 0) ks[at] = key;
  else if (ks.length < MAX_KEYS) ks.push(key);
  out.keys[ch] = sorted(ks);
  if (t > out.len) out.len = Math.min(MAX_LEN, rt(t));
  return out;
}

/** Keys of `c` (this object's) that `sel` picks. */
const picks = (sel          , key        ) => sel.filter((r) => r.key === key);
const isPicked = (sel          , ch               , t        ) => sel.some((r) => r.ch === ch && sameT(r.t, t));

/** The clip without the picked keys. A channel left with no key goes (that property then stays as placed). */
function deleteKeys(c            , key        , sel          )             {
  const mine = picks(sel, key);
  const out = structuredClone(c);
  for (const ch of CHANNELS) {
    const ks = (out.keys[ch] ?? []).filter((k) => !isPicked(mine, ch, k.t));
    if (ks.length) out.keys[ch] = ks;
    else delete out.keys[ch];
  }
  return out;
}

/**
 * The clip with the picked keys moved by `dt` seconds (kept between 0 and the length). A moved key that lands on a
 * key that was not moved replaces it (the dragged one wins, as in Blender). Returns the moved refs' new times too.
 */
function moveKeys(c            , key        , sel          , dt        )                                        {
  const mine = picks(sel, key);
  const out = structuredClone(c);
  const moved           = [];
  for (const ch of CHANNELS) {
    const ks = out.keys[ch];
    if (!ks) continue;
    const go = ks.filter((k) => isPicked(mine, ch, k.t)).map((k) => ({ ...k, t: rt(Math.min(out.len, Math.max(0, k.t + dt))) }));
    const stay = ks.filter((k) => !isPicked(mine, ch, k.t) && !go.some((g) => sameT(g.t, k.t)));
    // Two moved keys squeezed onto one moment (against 0 or the end): the later one wins.
    const merged = new Map                   ();
    for (const k of go) merged.set(Math.round(k.t * 1000), k);
    out.keys[ch] = sorted([...stay, ...merged.values()]);
    for (const k of merged.values()) moved.push({ key, ch, t: k.t });
  }
  return { clip: out, moved };
}

/** The picked keys' ease set to `ease`. */
function easeKeys(c            , key        , sel          , ease            )             {
  const mine = picks(sel, key);
  const out = structuredClone(c);
  for (const ch of CHANNELS) for (const k of out.keys[ch] ?? []) if (isPicked(mine, ch, k.t)) k.ease = ease;
  return out;
}

/** What ⌘C holds: keys by channel, their times from the earliest one copied (so ⌘V puts the first at the playhead). */
                                                                                                                             

function copyKeys(c            , key        , sel          )         {
  const mine = picks(sel, key);
  const out         = [];
  for (const ch of CHANNELS) for (const k of c.keys[ch] ?? []) if (isPicked(mine, ch, k.t)) out.push({ ch, dt: k.t, v: k.v.slice(), ease: k.ease, ...(k.in ? { in: k.in.slice() } : {}), ...(k.out ? { out: k.out.slice() } : {}) });
  const t0 = Math.min(...out.map((k) => k.dt));
  return out.map((k) => ({ ...k, dt: rt(k.dt - t0) }));
}

/** ⌘V: the copied keys put on this clip from `at` (a channel the clip's object cannot take — another dim — is skipped). */
function pasteKeys(c            , keys        , at        , dim     )                                                                        {
  let out = c;
  const pasted                                          = [];
  for (const k of keys) {
    if (k.v.length !== width(k.ch, dim)) continue;
    const t = rt(at + k.dt);
    if (t > MAX_LEN) continue;
    out = setKey(out, k.ch, t, k.v, k.ease);
    // The handles come along (a bent point pasted is bent the same way).
    const got = out.keys[k.ch] .find((x) => sameT(x.t, t)) ;
    if (k.in) got.in = k.in.slice();
    if (k.out) got.out = k.out.slice();
    pasted.push({ ch: k.ch, t });
  }
  return { clip: out, pasted };
}

/** Every key time of a clip (any channel), for the object's summary row. */
function keyTimes(c                               , chs                  = CHANNELS)           {
  const ts           = [];
  for (const ch of chs) for (const k of c?.keys[ch] ?? []) if (!ts.some((t) => sameT(t, k.t))) ts.push(k.t);
  return ts.sort((a, b) => a - b);
}

/** Snap a time to the timeline's grid (and to 0 … max). */
function snapT(t        , max        , free = false)         {
  const s = free ? rt(t) : Math.round(t / SNAP_T) * SNAP_T;
  return rt(Math.min(max, Math.max(0, s)));
}

/** A KeyboardEvent.code as a person reads it: "KeyE" → "E", "Digit1" → "1", "ArrowUp" → "↑", "Space" → "Space". */
function keyName(code        )         {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  const arrows                         = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  return arrows[code] ?? code;
}

/** "0:01.6" — minutes, seconds and a tenth (the time readout; tabular figures keep it still while it runs). */
function clock(t        )         {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

/** A motion (the store's shape) with clip `name` replaced by `c` (or added; null = removed). Empty → null. */
function withClip(m               , name        , c                   )                {
  // In place (a rename keeps the clip where it was in the menu), removed, or added at the end.
  const clips = (m?.clips ?? []).slice();
  const i = clips.findIndex((x) => x.name === name);
  if (i >= 0) c ? (clips[i] = c) : clips.splice(i, 1);
  else if (c) clips.push(c);
  return clips.length ? { clips } : null;
}

/** The older motion's pose at `t` (the editor still previews one it could not turn into a clip, e.g. a bad file). */
function legacyOffsets(m        , t        , dim     )          {
  const a = motionAt(m, t)                                          ;
  return { p: a.off, r: m.spin ? (dim === '3d' ? [0, a.turn, 0] : [a.turn]) : null, s: null };
}

__def(__exports, "CHANNELS", () => CHANNELS);
__def(__exports, "SAME_T", () => SAME_T);
__def(__exports, "SNAP_T", () => SNAP_T);
__def(__exports, "MIN_LEN", () => MIN_LEN);
__def(__exports, "MAX_LEN", () => MAX_LEN);
__def(__exports, "MAX_CLIPS", () => MAX_CLIPS);
__def(__exports, "MAX_KEYS", () => MAX_KEYS);
__def(__exports, "DEFAULT_EASE", () => DEFAULT_EASE);
__def(__exports, "width", () => width);
__def(__exports, "restOf", () => restOf);
__def(__exports, "offsetsAt", () => offsetsAt);
__def(__exports, "compose", () => compose);
__def(__exports, "offsetOf", () => offsetOf);
__def(__exports, "changedChannels", () => changedChannels);
__def(__exports, "toClips", () => toClips);
__def(__exports, "blankClip", () => blankClip);
__def(__exports, "sceneClip", () => sceneClip);
__def(__exports, "freeName", () => freeName);
__def(__exports, "refId", () => refId);
__def(__exports, "sameT", () => sameT);
__def(__exports, "setKey", () => setKey);
__def(__exports, "deleteKeys", () => deleteKeys);
__def(__exports, "moveKeys", () => moveKeys);
__def(__exports, "easeKeys", () => easeKeys);
__def(__exports, "copyKeys", () => copyKeys);
__def(__exports, "pasteKeys", () => pasteKeys);
__def(__exports, "keyTimes", () => keyTimes);
__def(__exports, "snapT", () => snapT);
__def(__exports, "keyName", () => keyName);
__def(__exports, "clock", () => clock);
__def(__exports, "withClip", () => withClip);
__def(__exports, "legacyOffsets", () => legacyOffsets);
};
__defs[40] = function (__exports) {
'use strict';
// play-arrange.ts

// ▶ Play inside the editor: the game as the editor shows it — the arrangement on screen, saved or not.
//
// WHY (a try of the editor, 2026-10-21: "I moved things, pressed Play without Save, and everything was reset. People want to try
// a change in Play first, then save it"): before, Play showed only what the game's own code does. A game that reads
// placement.json itself (the loader, src/loader) got the moves because the editor writes its hidden draft before Play
// (shell/main.ts keepNow); a game that does not (one the AI just made, before "add the loader") came up at its code's
// layout, and so did every UI move. Since the polish pass of 2026-10-16 Play already showed the copies and deletions
// (they lived only in placement.json); now it shows the moves, the draw orders and the UI places as well.
//
// The file is the editor's draft (the same placement.json the loader reads: on disk with the local studio, in this
// browser in the web demo, src/hosts/browser/game-placement.js), read by the bridge when Play opens the page. Nothing is
// written: Save still writes the file the AI is told about.
//
// Only what the page shows AS ITS CODE MAKES IT is changed, so applying twice is harmless:
//   - a moved object only while it stands at its `was` (the code's own pose): a game whose loader already put it
//     there is left alone, and so is an object the game itself moved since (physics, a boat on the waves);
//   - a copy only when the page does not have that key; a deletion only while the object still looks as `was`;
//   - a reordered list only while it is still in the code's order (`was`).
// The UI (`ui`) goes through the loader's own placeUi() (shared with the editor's UI layer), which sets the same
// offset again rather than adding to it.
                                                                                   
const { hasLayer, orderOfLayer } = __require(37);
const { samePose } = __require(38);
const { compose, legacyOffsets } = __require(39);
const { motionRunner, resolveClip } = __require(20);

                                                                                                                                  
                                                                                                   
                                                                         
                                                             
                           
                
                                  
                  
                      
                  
                                   
                                                                          
                      
 

const nums = (v         )                => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const num = (v         )              => typeof v === 'number' && Number.isFinite(v);
/** A pose of the file, or null when it is not one (the file is untrusted: a hand edit, an older version). */
function poseOf(e                                                        , base       )              {
  if (!nums(e.p)) return null;
  const out       = { p: e.p.slice() };
  const r = num(e.r) ? e.r : base?.r;
  if (r !== undefined) out.r = r;
  const s = num(e.s) || nums(e.s) ? e.s : base?.s;
  if (s !== undefined) out.s = Array.isArray(s) ? s.slice() : s;
  const t = nums(e.t) && e.t.length === 2 ? e.t : base?.t;
  if (t) out.t = [t[0] , t[1] ];
  return out;
}
const flat = (p      )       => ({ ...p, z: undefined });

/**
 * Put the file's arrangement on the page's objects (see the top of this file). Returns how many changes were made.
 * `a`: the page's adapter, with objects listed.
 */
function arrangeInPlay(a               , file                 )         {
  if (!file || typeof file !== 'object') return 0;
  const dim      = file.dim === '2d' ? '2d' : '3d';
  let shown = 0;
  const list = () => a.list();
  const find = (k        ) => list().find((i) => i.key === k);
  const put = (k        , p      , what        ) => {
    try {
      if (a.setPose(k, p)) shown++;
    } catch (err) {
      console.warn(`[studio] could not show ${what} ${k} in Play:`, err);
    }
  };

  // Deletions first: an object deleted in the editor is not among the moves.
  if (a.remove && Array.isArray(file.removed)) {
    for (const r of file.removed) {
      const it = typeof r?.key === 'string' ? find(r.key) : undefined;
      if (!it || (typeof r.label === 'string' && r.label !== it.label)) continue;
      const wp = r.was && nums(r.was.p) ? r.was.p : null;
      if (wp && it.pose && it.pose.p.some((v, i) => Math.abs(v - (wp[i] ?? 0)) > 1e-3)) continue;
      try {
        if (a.remove(it.key)) shown++;
      } catch {
        /* keep it */
      }
    }
  }

  // Moves: only an object the page shows where its code puts it (`was`).
  if (file.objects && typeof file.objects === 'object') {
    for (const [k, e] of Object.entries(file.objects)) {
      const it = e && typeof e === 'object' ? find(k) : undefined;
      if (!it || !e.was) continue;
      const was = poseOf(e.was, it.pose), want = poseOf(e, it.pose);
      if (!was || !want) continue;
      if (!samePose(flat(it.pose), flat(was), dim) || samePose(flat(it.pose), flat(want), dim)) continue;
      put(k, want, 'the move of');
    }
  }

  // Copies (polish pass 2026-10-16): a clone of the original as it stands, so it looks right but does not act (a boat
  // that floats, a coin that spins) until the AI adds it to the code. A key the page already has is left alone.
  if (a.clone && Array.isArray(file.added)) {
    for (const e of file.added) {
      if (typeof e?.key !== 'string' || typeof e.from !== 'string') continue;
      if (find(e.key) || !find(e.from)) continue;
      const pose = poseOf(e);
      if (!pose) continue;
      try {
        if (!a.clone(e.from, e.key)) continue;
        a.setPose(e.key, pose);
        shown++;
      } catch (err) {
        console.warn('[studio] could not show the copy ' + e.key + ' in Play:', err);
      }
    }
  }

  // Draw orders (2D): a list still in the code's order gets the editor's (z slots, as the editor's own reorder does).
  if (Array.isArray(file.order)) {
    for (const o of file.order) {
      if (typeof o?.in !== 'string' || !Array.isArray(o.keys)) continue;
      const layer = o.in;
      const raw = list().filter((i) => hasLayer(i) && i.layer === layer);
      const now = orderOfLayer(raw, layer);
      const keys = (o.keys             ).filter((k)              => typeof k === 'string' && now.includes(k));
      if (keys.join('\n') === now.filter((k) => keys.includes(k)).join('\n')) continue;
      if (Array.isArray(o.was)) {
        const was = (o.was             ).filter((k)              => typeof k === 'string');
        if (now.filter((k) => was.includes(k)).join('\n') !== was.filter((k) => now.includes(k)).join('\n')) continue;
      }
      const slots = raw.filter((i) => keys.includes(i.key)).map((i) => i.pose.z ).sort((x, y) => x - y);
      keys.forEach((k, i) => {
        const it = raw.find((x) => x.key === k) ;
        put(k, { ...find(k)?.pose ?? it.pose, z: slots[i]  }, 'the draw order of');
      });
    }
  }
  return shown;
}

/**
 * The draft's motions in ▶ Play (motion-gui, 2026-10-22; the timeline's clips since studio-timeline), for a game whose
 * loader does not run them: a game the AI made before "add the loader", or one with an older copy of it. Every frame
 * of the page (its own requestAnimationFrame: Play is not frozen), each object is put at its place + its clip that
 * plays at the start (clipAt) — or the older path / spin (motionAt) — through the adapter, as the loader would. A clip
 * that waits for a cue does not play here: the cue is the game's code, which the AI writes. Keys the page's loader
 * already moves (the global set it keeps, src/loader) are left alone, so nothing moves twice. Call after arrangeInPlay
 * (the place is the arranged one). Returns the keys it moves.
 * `live`: ▶ Play in the same page (fast switch, 2026-10-22; play-switch.ts) — false once the page is back in Edit, and
 * the motions stop there (the page's loop would otherwise go on moving them under the editor). Absent = for the page's
 * life, as a Play page always was.
 */
function moveInPlay(a               , file                 , win                            , live                )           {
  const motion = file && typeof file === 'object' && file.motion && typeof file.motion === 'object' ? file.motion : null;
  if (!motion) return [];
  const byLoader = (win                                                      )[Symbol.for('game-studio.motion')];
  const items = a.list();
  const runs                                                                           = [];
  // Clips (a Library motion by `use`, or keys of their own) start and stop by the loader's own rules (motionRunner,
  // studio-motion-triggers): the game starting, a time, a key, another clip's end. Cues the game's code gives (touch,
  // a named cue, words) cannot happen here: the AI writes them.
  const lib = Array.isArray(file .motions) ? file .motions : [];
  const clipped                                                                    = [];
  for (const [key, m] of Object.entries(motion)) {
    if (byLoader?.has(key) || !m || typeof m !== 'object') continue;
    const it = items.find((i) => i.key === key);
    if (!it) continue;
    const dim      = it.pose.p.length === 3 ? '3d' : '2d';
    const mm = m          ;
    const clips = Array.isArray(mm.clips) ? (mm.clips.map((c) => resolveClip(c, lib, key)).filter(Boolean)                ) : [];
    const pathOk = Array.isArray(mm.path) && mm.path.length > 0 && mm.path.every((q) => nums(q) && q.length === it.pose.p.length);
    if (clips.length) clipped.push({ key, clips, base: structuredClone(flat(it.pose)), dim });
    else if (!mm.clips && (pathOk || num(mm.spin))) runs.push({ key, at: (t) => legacyOffsets(mm, t, dim), base: structuredClone(flat(it.pose)), dim });
  }
  if (!runs.length && !clipped.length) return [];
  const t0 = win.performance.now();
  const run = motionRunner(clipped.map((c) => ({ key: c.key, clips: c.clips })));
  run.fire({ on: 'start' }, t0);
  // Any of a clip's ways to start (studio-timeline-2: `whens`, from resolveClip) may be a key.
  if (clipped.some((c) => c.clips.some((x) => ((x                                                  ).whens ?? [x.when                   ]).some((w) => w?.on === 'key')))) {
    win.addEventListener('keydown', (e) => !e.repeat && run.fire({ on: 'key', key: e.code }, win.performance.now()));
  }
  const tick = (now        ) => {
    if (live && !live()) return;
    const t = Math.max(0, (now - t0) / 1000);
    for (const r of runs) {
      try {
        a.setPose(r.key, compose(r.base, r.at(t), r.dim));
      } catch {
        /* the game took it away: the others go on */
      }
    }
    for (const [key, at] of run.step(now, () => null)) {
      const c = clipped.find((x) => x.key === key);
      try {
        if (c) a.setPose(key, compose(c.base, at           , c.dim));
      } catch {
        /* gone */
      }
    }
    win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);
  return [...runs.map((r) => r.key), ...clipped.map((c) => c.key)];
}

__def(__exports, "arrangeInPlay", () => arrangeInPlay);
__def(__exports, "moveInPlay", () => moveInPlay);
};
__defs[41] = function (__exports) {
'use strict';
// play-switch.ts

// ▶ Play and back in the same page (fast switch, 2026-10-22; a try of the editor: "every time I play and go back to edit it loads
// again — tedious"). CONTRACT.md §3.5.2, contract.ts `studio:core/play`.
//
// Before: Play and Edit each opened the game page again (`?studio=edit` or not). Going back to Edit took seconds: the
// game loads, the adapter is found, the list is made, every row's picture drawn again. Now the edit page itself becomes
// Play and comes back:
//
//   Play (go)   1. wait for the editor's first moments (its watch of what the game moves, the self-check: both move
//                  objects and put them back; a start in between would start from a moment of the watch)
//               2. keep where everything stands — the edit layout: each layer's listed poses (copies included) and,
//                  where the adapter can (three.js), the whole scene (watch(true), as the editor's own watch does)
//               3. the editor puts its tools away (core/edit off: the game's own camera and HUD, no handles, no input)
//               4. the draft's motions start (moveInPlay, as a Play page's loader would; see `live`)
//               5. the game goes on: frames, clock (core/time.ts `clock`: the time spent editing is not a frame step),
//                  sound (a pause's hold, when Edit held it); play-ask wakes (play/hello: ask, pause, move work as on a
//                  Play page)
//   Edit (back) 1. play-ask sleeps (Move, the chat, the field put away), the motions stop
//               2. the game is held as a pause holds it (frames, clock, sound, the mouse let go)
//               3. everything goes back to where Play found it: what the game moved while playing (the hero, an enemy,
//                  the camera) is not kept. "Put in layout" from a pause is the shell's: it sends those after this.
//                  Where the adapter can (three.js, watch(false, true); studio-edit-restore, 2026-10-23: "after playing,
//                  Edit came back in the middle of the game"), the scene too: what the game added while playing (a
//                  bullet, an obstacle it spawned) is held out of it and what it took away (a coin) is back, so Edit
//                  shows the scene the person was editing. The next Play hands those back to the game first (go 2.):
//                  its code still holds them, and Play goes on from the game's own state (below).
//               4. the editor is up again on the edit camera it had (core/edit on with the shell's view state)
//
// WHY "Play starts from the layout, Edit goes back to it" (the call made for this change, as recommended): Edit is where the
// layout is made, so what Edit shows must be the layout, never "wherever the game left things" (a person would save a
// moment of play as their layout without knowing). And Play from the same picture the person just arranged is what
// they asked to see. What does NOT go back: the game's own state that is not an object's pose — the score, a timer, an
// enemy's health, things the game made or took away while playing. For those, "Play from the start" (⌘K, Play's ▾)
// opens a new page as Play always did.
//
// The motions (studio-no-reload, 2026-10-22: "when I go back to edit after playing, don't load"): the game's own copy of
// the loader (studio-placement.js) runs them from the draft, every `when` included (a click, an area, a cue, the game's
// playMotion()) — its play hook (loaderPlay below). Before, a page opened for Edit never started the loader's motions,
// so a draft with a clip that waits for something opened a new Play page (= loading) every time. What the loader does
// not move (a game without it, an older copy, a copy the editor made that the loader cannot find) moveInPlay moves, as
// it did. Back in Edit both stop before everything goes back.
//
// Not here (the shell decides, main.ts canPlayHere): a page whose editor is not up (still loading, no adapter), and a
// draft whose motions wait for something only the game's loader runs when this page's loader is an older copy without
// the hook (core/ready `motionHere` false): those open a new Play page as before.
                                                          
                                             
                                          
const { moveInPlay } = __require(40);
                                                   

                                 
                                  
             
                 
                         
 

                             
                                                                                                                         
                                                                                                               
                                                        
                            
 

/** The loader's play hook (studio-placement.js `hook`): one per copy of the loader on the page. */
                      
                 
                                                                                
               
 
/** The copies of the loader on the page that can play here: those that placed a world (the game's, not the editor's). */
function loaderPlay(win                            )               {
  const set = (win                                                          )[Symbol.for('game-studio.play')];
  return set ? [...set].filter((h) => {
    try {
      return h.has();
    } catch {
      return false;
    }
  }) : [];
}

function createPlaySwitch(d                )             {
  const { win, core, editor, playAsk } = d;
  let playing = false;
  // Which Play this is: the motions of an earlier one stop (moveInPlay `live`).
  let run = 0;
  // Where Play found everything (go 2.), per layer.
  let kept                                                                                    = [];
  // The edit camera as it was at Play (the world's; the UI has none): exactly what Edit comes back to. The shell's kept
  // view state (core/view-state) can lag a glide's last step, and a camera a hair off reads as "it moved".
  let editView          = undefined;
  let chain                = Promise.resolve();

  const listOf = (a               ) => {
    try {
      return a.list();
    } catch {
      return [];
    }
  };

  // The loader copies that run this Play's motions (stopped in back()).
  let loaders               = [];

  async function go(motion                                     , motions                       ) {
    if (playing) return;
    await editor.settled();
    playing = true;
    const mine = ++run;
    const layers = editor.playLayers();
    try {
      editView = editor.layer() === 'world' ? editor.driven.view.state() : undefined;
    } catch {
      editView = undefined;
    }
    kept = layers.map((l) => ({ ...l, poses: listOf(l.edits).map((i) => [i.key, structuredClone(i.pose)]                  ) }));
    for (const l of layers) {
      try {
        l.raw.watch?.(true, true);
      } catch {
        /* the listed poses above still go back */
      }
    }
    editor.handle({ type: 'studio:core/edit', on: false });
    let moving           = [];
    if (motion && typeof motion === 'object') {
      // The game's loader first: it runs every `when`, on the objects the game itself holds. The keys it moves go into
      // its global set, which moveInPlay leaves alone.
      loaders = loaderPlay(win);
      for (const h of loaders) {
        try {
          moving.push(...h.start({ motion, motions }));
        } catch (e) {
          console.warn('[studio] Play: the loader could not start the motions:', e);
        }
      }
      // The rest through the editor's copies layer (a copy that moves is the editor's object). Its first listed layer
      // is the world's when the game has one (editor.ts playLayers).
      const world = layers[0]?.edits;
      if (world) {
        try {
          moving.push(...moveInPlay(world, { motion, motions }, win, () => run === mine && playing));
        } catch (e) {
          console.warn('[studio] Play: the motions could not start:', e);
        }
      }
    }
    playAsk.wake(Promise.resolve(moving));
    // Held by a pause before (Edit holds the game with it, back below): its resume brings the sound back too.
    if (playAsk.hold?.paused) playAsk.hold.resume();
    else core.time.thaw();
  }

  function back(viewState         ) {
    if (!playing) return;
    playing = false;
    run++;
    playAsk.sleep();
    if (playAsk.hold) playAsk.hold.pause();
    else core.time.freeze();
    // The loader's motions stop where they are; everything goes back just below.
    for (const h of loaders) {
      try {
        h.stop();
      } catch {
        /* the poses below */
      }
    }
    loaders = [];
    for (const l of kept) {
      try {
        l.raw.watch?.(false, true);
      } catch {
        /* the listed poses below */
      }
    }
    for (const l of kept) {
      for (const [key, pose] of l.poses) {
        try {
          l.edits.setPose(key, pose);
        } catch {
          /* the game took it away: the others go back */
        }
      }
    }
    kept = [];
    const view = editView !== undefined ? editView : viewState;
    editView = undefined;
    editor.handle({ type: 'studio:core/edit', on: true, viewState: view });
  }

  return {
    get playing() {
      return playing;
    },
    handle(m) {
      chain = chain.then(() => (m.on ? go(m.motion, m.motions) : back(m.viewState))).catch((e) => console.warn('[studio] Play / Edit switch failed:', e));
    },
  };
}

__def(__exports, "loaderPlay", () => loaderPlay);
__def(__exports, "createPlaySwitch", () => createPlaySwitch);
};
__defs[42] = function (__exports) {
'use strict';
// editor.ts

// Edit session inside the game page: applies shell messages to the adapter,
// runs the studio's own draw loop while the game is frozen, and reports
// changes back. Pointer gestures and handles are attached by input.ts.
const { UI } = __require(13);
                                             
const { nativeClearTimeout, nativeNow, nativeSetTimeout } = __require(0);
const { withRules } = __require(24);
const { withEdits } = __require(25);
const { beginGroup, groupAnchor, groupLift, groupMove, groupPoses, groupRotate, groupScale, groupShift } = __require(27);
const { createToolHost } = __require(28);
const { attachInput, tappableAt } = __require(33);
                                                  
const { firstToTouch, stepDetent } = __require(32);
const { createHoldState, withHold } = __require(26);
const { drivenBetween, WATCH_MS } = __require(34);
const { runSelfCheck, SECOND_LOOK_MS, worthASecondLook } = __require(23);
const { createTimelineView } = __require(35);
const { createUiExtras } = __require(36);
const { loaderPlay } = __require(41);

                             
                                                                                                                     
                                
     
                                                                                                                 
                                                        
     
                            
     
                                                                                                                    
                                                                                                                      
     
                  
                                                                                        
                     
                                                                                 
                    
             
                                  
                                     
                                                                                                                            
                        
     
                                                                                                                    
                                                                                                                    
                                                                                                                   
                                                                                                                        
                                                                                                
     
                   
                                                                                                        
                                 
 

                         
                                   
                                                                              
                                    
                                                                                                                                    
                                 
                                             
                     
                                                                                                                     
                   
     
                                                                                                                 
                                                                                                                     
                                                                                         
     
                                                                    
     
                                                                                                                       
                                                                                                                     
                               
     
                           
 

/** Shared state between the editor and the input layer. */
                            
                   
                                                                          
                          
                                                                                                  
                  
                                                                                         
                 
                
                                                                                               
                 
                                                                                                 
                            
                                                                                                                   
                           
 

function createEditor(deps            )         {
  const { core, win } = deps;
  // Every edit goes through the copy/delete layer, the game rules layer and what the editor holds still (the ground,
  // what the game moves itself: hold.ts); the adapter itself is unaware of all three.
  // UI stage 1 (2026-10-19): one such stack per layer — the world's, and the UI's (no game rules: .studio/studio.json
  // speaks of world objects; no hold either: grounds and the game's own motion are world things) — and `raw` /
  // `edits` / `adapter` are the current layer's. Everything below reads those three names when it runs, so switching
  // layers (setLayer) is: input off, swap the three, input on. One layer at a time keeps input.ts / handles.ts as they
  // are (the design's "switch, don't merge" for stages 1–3).
  // merge of 2026-10-19: the hold layer (fb-safe) sits on top of the world's stack only; the watch of the game
  // (watchGame) reads and puts back the world's `ruled`, whichever layer is being edited.
                                                                                                                        
  const hold = createHoldState();
  const stackOf = (a               , rules             , held         )        => {
    const e = withEdits(a);
    const ruled = withRules(e, rules);
    return { raw: a, edits: e, ruled, driven: held ? withHold(ruled, hold) : ruled };
  };
  const world               = deps.adapter ? stackOf(deps.adapter, deps.rules, true) : null;
  const uiStack               = deps.ui ? stackOf(deps.ui, { config: null, ext: [] }, false) : null;
  let layer            = world ? 'world' : 'ui';
  const first = (world || uiStack) ;
  let raw = first.raw;
  let edits = first.edits;
  let adapter = first.driven;
  // The world's edit camera while the UI is edited (the UI has no camera: the world shows the player's view then).
  let worldView          = undefined;
  // While the game is watched (watchGame): the last pose the editor itself gave each world object (a saved placement
  // re-applied, a drag), so those are neither taken for the game's motion nor undone when the watch ends.
  let watchBase                           = null;
  const watchSet = new Set        (); // the keys the editor posed during the watch: put back after watch(false)
  // While the self-check runs (it moves one object and puts it back where it found it, across several frames — seconds
  // on a slow GPU): the poses the editor itself gives the world's objects meanwhile, given again after it. WHY (fast
  // switch, 2026-10-22): a number typed on the card while the check ran was undone by the check's "put back" (the web
  // demo, PC: the lighthouse typed to X -18 stood at -24 again). A new page at Play used to hide it; Play in the same
  // page showed it in the game and back in Edit.
  let checkSet                           = null;
  const post = (msg               ) => {
    if (checkSet && layer === 'world') {
      if (msg.type === 'studio:placement/moved') checkSet.set(msg.key, msg.pose);
      else if (msg.type === 'studio:placement/moved-group') for (const m of msg.poses) checkSet.set(m.key, m.pose);
    }
    // Only the world's moves: a UI key posed meanwhile is not a world object to put back (merge of 2026-10-19).
    if (watchBase && layer === 'world') {
      if (msg.type === 'studio:placement/moved') (watchBase.set(msg.key, msg.pose), watchSet.add(msg.key));
      else if (msg.type === 'studio:placement/moved-group') for (const m of msg.poses) (watchBase.set(m.key, m.pose), watchSet.add(m.key));
    }
    deps.post(msg);
  };
  // UI stages 2–3 (ui-extras.ts): another screen shown = the UI layer's list again, without a pick that is gone.
  const uiExtras = deps.ui && deps.uiDom ? createUiExtras({ win, post: (m) => post(m), relist: () => {
    if (!uiStack) return;
    if (layer !== 'ui') {
      try {
        post({ type: 'studio:placement/items', items: uiStack.driven.list(), layer: 'ui' });
      } catch {
        /* listed when switched to */
      }
      return;
    }
    state.selected = null;
    state.group = [];
    refreshItems();
    input?.selectionChanged();
    postSelected();
    dirtyFrame = true;
  } }) : null;
  const state            = { editing: false, selected: null, group: [], multi: false, items: [], axis: 'y', scaleMode: 'spread', turnMode: 'spread' };
  // The timeline (studio-timeline, 2026-10-22; timeline-path.ts): the poses at the time line and the picked object's
  // path in 3D. Made here, before input.ts attaches, so a press on a path point reaches it first (timeline-path.ts says why).
  const timeline = createTimelineView({ win, adapter: () => adapter, poser: () => edits, post: (m) => post(m), lang: () => lang,
    markDirty: () => (dirtyFrame = true) });
  let lang       = 'en';
  let loopId = 0;
  let dirtyFrame = true;
  let input                     = null;
  let checked = false;
  let pendingHandlePx = 0;
  // Viewport px the shell's floating panels cover (core/ui inset), and the AI's last marks.
  let inset        = { top: 0, right: 0, bottom: 0, left: 0 };
  let theme                   = 'dark';
  let aiMarks                                           = { keys: [], label: null };
  // The strip's Motion button as the editor page last described it (placement/motion), kept for a new input (a layer switch).
  let motionBtn = { show: false, has: false, label: '', open: false };
  // The game's UI shown (faded) while the world is edited: the shell's eye button (core/ui-peek). Off = hidden, the
  // default every time the editor opens (paintLayers).
  let uiPeek = false;
  // Step runs (keyboard/button repeats) fold into one undo step: remember the
  // pose before the run and close it when a non-hold step arrives or after a
  // quiet gap.
  let stepRun                                                                                                                             = null;

  const refreshItems = () => {
    try {
      state.items = adapter.list();
    } catch (e) {
      post({ type: 'studio:core/error', message: `list() failed: ${(e         ).message}` });
      state.items = [];
    }
    post({ type: 'studio:placement/items', items: state.items, ...itemsLayer() });
  };
  /** placement/items' `layer`, only for a game that has a UI (otherwise the message is what it always was). */
  const itemsLayer = ()                        => (uiStack ? { layer } : {});
  /** The view state goes to the shell (kept for the next reload) only for the world: the UI has no camera. */
  const postView = () => {
    if (layer === 'world') post({ type: 'studio:core/view-state', state: adapter.view.state() });
  };
  const ready = () => {
    post({ type: 'studio:core/ready', kind: adapter.kind, dim: adapter.dim, version: adapter.version, editing: state.editing, rise: adapter.dim === '3d' && !!adapter.view.rise, fly: adapter.dim === '3d' && !!adapter.view.fly,
      drop: adapter.dim === '3d' && !!adapter.drop,
      // The game's loader can run every motion in this page (play-switch.ts): ▶ Play then never needs a new page for them.
      ...(loaderPlay(win).length ? { motionHere: true } : {}),
      ...(uiStack ? { layers: (world ? ['world', 'ui'] : ['ui'])               , layer } : {}) });
  };
  /**
   * Which layer can be touched, by brightness alone (design §2.3 ③): editing the UI dims the world 15 %; editing the
   * world HIDES the UI (a try of the editor, 2026-10-20, "the UI is always there, in the way": the title, the Start button and the
   * score sat over the trees and lanterns, faded to half, hard to see past and to click past). The shell's eye button
   * (⇧U, core/ui-peek) shows it again faded to half, as before. Hidden or faded, the UI takes no pointer then
   * (`pointer-events: none` on it and inside it), so a click on a title selects the tree behind it and the game's
   * buttons show no hover. A style sheet in the game page while editing, gone at the end (Play shows the game as it
   * is). `filter`, not `opacity` / `visibility`: it multiplies with the game's own opacity (a hidden overlay at 0
   * stays hidden) and a child's own `visibility: visible` cannot bring it back. Only when the game has both layers.
   */
  const paintLayers = () => {
    if (!uiStack || !world) return;
    const doc = win.document;
    let el = doc.getElementById('studio-edit-layer')                           ;
    if (!state.editing) {
      el?.remove();
      return;
    }
    if (!el) {
      el = doc.createElement('style');
      el.id = 'studio-edit-layer';
      (doc.head || doc.documentElement).appendChild(el);
    }
    const top = '[data-studio-key]:not([data-studio-key] [data-studio-key])';
    el.textContent = layer === 'ui'
      ? 'canvas:not([data-studio-key]){filter:brightness(.85)}'
      : `${top}{filter:opacity(${uiPeek ? '.5' : '0'})}[data-studio-key],[data-studio-key] *{pointer-events:none!important}`;
  };

  const frame = () => {
    loopId = core.time.raf(frame);
    if (!state.editing) return;
    // Redraw every frame while editing: cheap for edit scenes, and it keeps
    // the picture correct when an engine re-uploads textures lazily.
    try {
      adapter.render();
      // On the UI layer the world still needs drawing (a 2D world draws only when asked while time is frozen).
      if (world && adapter !== world.driven) world.driven.render();
    } catch {
      /* keep the loop alive; the error was reported when it first happened */
    }
    input?.frame();
    toolHost.frame();
    timeline.frame();
    dirtyFrame = false;
  };

  // eslint-disable-next-line prefer-const -- assigned once below, used by closures declared first
  let toolHost                                   ;
  const postSelected = () => {
    const item = state.items.find((i) => i.key === state.selected);
    post({ type: 'studio:placement/selected', key: state.selected, item, keys: state.group.slice() });
    // A UI element picked: what the card's text / colour rows show (UI stages 2–3).
    if (layer === 'ui' && state.selected && state.group.length <= 1) {
      const p = uiExtras?.props(state.selected);
      if (p) post({ type: 'studio:ui/props', props: p });
    }
  };
  /**
   * Picked from the list: bring the object into view ONLY if it is not
   * already there (design pass "apple", reviews 2026-10-16). Before, every
   * list pick centred the object, so a 2D game that fits the frame slid
   * sideways and lost its edges, the first pick in "Select" mode pushed the
   * rest of the group out of view, and nothing put the view back. Picking
   * in the game never moved the view; now the list behaves the same while
   * the object is on screen. "On screen" = the object's box (and the row of
   * handles under it) inside the game frame with a small margin; on a phone
   * the frame is what is above the sheet (the sheet resizes the frame, it is
   * not drawn over it). While "Select" (several) is on, the view never moves:
   * picking several is done while looking at the whole scene.
   */
  const FOCUS_MARGIN = 12;
  const HANDLE_ROW = 64; // the handles sit under the object (bridge/handles.ts)
  const inView = (key        ) => {
    const a = adapter.anchor(key);
    if (!a || !a.visible) return false;
    // The free part of the frame: the shell's floating panels (inspector card, ask bar) cover the rest.
    const r = a.rect ?? { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
    const x0 = inset.left, y0 = inset.top;
    // The card covers the top right corner only (rightTo): an object below it is not hidden by it.
    const right = inset.rightTo === undefined || r.y < inset.rightTo ? inset.right : 0;
    const w = window.innerWidth - right, h = window.innerHeight - inset.bottom;
    // Bigger than the frame (a ground, a sky): in view when its middle is.
    if (r.w > w - x0 - 2 * FOCUS_MARGIN || r.h > h - y0 - 2 * FOCUS_MARGIN) return a.center[0] > x0 && a.center[0] < w && a.center[1] > y0 && a.center[1] < h;
    return r.x >= x0 + FOCUS_MARGIN && r.y >= y0 + FOCUS_MARGIN && r.x + r.w <= w - FOCUS_MARGIN && r.y + r.h + Math.min(HANDLE_ROW, (h - y0) / 4) <= h;
  };
  /**
   * The free part of the frame (what no floating panel covers) for an object
   * whose box top is at `y`.
   */
  const freeArea = (y        ) => {
    const right = inset.rightTo === undefined || y < inset.rightTo ? inset.right : 0;
    return { x0: inset.left, y0: inset.top, x1: window.innerWidth - right, y1: window.innerHeight - inset.bottom };
  };
  /**
   * Slide the view (pan only, no zoom or turn) by the least that puts the
   * object's box and its strip inside the free part of the frame (2026-10-16,
   * tool modes pass). WHY: the adapters' view.focus centres in the WHOLE
   * frame; on a phone with the list sheet open (and the card over it) the
   * centre is under the sheet, so the picked object and its strip stayed
   * hidden (ive-finish.md §7, studio-fit on the phone). pan() is exact for
   * 2D and close for 3D (it moves the ground under the finger), so a few
   * measured steps converge.
   */
  const slideIntoFree = (key        ) => {
    for (let i = 0; i < 6; i++) {
      const a = adapter.anchor(key);
      if (!a || !a.visible) return false;
      const r = a.rect ?? { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
      const f = freeArea(r.y);
      const room = f.y1 - f.y0;
      const strip = Math.min(HANDLE_ROW, room / 4);
      const fit = (lo        , hi        , a0        , a1        ) => {
        // Too big for the room: its middle to the room's middle. Otherwise the least move that fits it.
        if (a1 - a0 > hi - lo) return (lo + hi) / 2 - (a0 + a1) / 2;
        if (a0 < lo) return lo - a0;
        if (a1 > hi) return hi - a1;
        return 0;
      };
      const dx = fit(f.x0 + FOCUS_MARGIN, f.x1 - FOCUS_MARGIN, r.x, r.x + r.w);
      const dy = fit(f.y0 + FOCUS_MARGIN, f.y1 - FOCUS_MARGIN, r.y, r.y + r.h + strip);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return true;
      adapter.view.pan(dx, dy);
    }
    return inView(key);
  };
  /**
   * Picking never moves the camera (design review wave 1, W1-1 / M3 / U5, 2026-10-17): "the view belongs to whoever made the
   * game; the tool doesn't move it by itself". Before, the first pick glided the 3D camera up to a 30° editing angle
   * (the lighthouse became a 30 px dot under the sky), the phone's sheet and ⌘K list slid or pulled the view each time
   * they opened, and a list pick re-framed with a zoom. Now the ONE case that moves it: a pick from the list (`focus`)
   * of an object that is not in the seen part of the frame — then, in 0.35 s, the least sideways slide (pan only: no
   * turn, no zoom) that puts it (and its strip) inside the middle 60 % of that part.
   */
  const CENTRE = 0.6; // 0.6 = the middle 60 % of the seen part (the review's number); 1.0 = just inside the edges
  const GLIDE_MS = 350;
  let panGlide = 0;
  // The last pick from the list and when (see core/ui below): the card that the pick brings can make a phone's sheet
  // taller a moment later and cover the object the person just asked to see.
  let listPick                                     = null; // the running slide's generation (0 = none); a new pick stops the old one where it is
  /**
   * The least pan that brings `key` into the middle part, measured step by step: sideways first, then up / down.
   * WHY measured, one axis at a time (found while writing W1-1, Lantern Cove's opening view, 2° down): pan() moves the
   * ground at the point the camera turns round, so an object nearer than that point moves more (a pine moved ~1.8 px
   * per px and overshot to the far side), and "up the screen" from a near-level view carries the ground tens of metres
   * while things near the horizon hardly rise — and slide sideways as they come closer. So each axis takes steps of
   * (what is still needed ÷ how far the last step moved it per px); an up / down step that does not help, or that pushes
   * the object back out sideways, is taken back and the slide stops there (sideways is the part that always works).
   */
  const panIntoMiddle = (key        )                          => {
    const need = () => {
      const a = adapter.anchor(key);
      if (!a || !a.visible) return null;
      const r = a.rect ?? { x: a.center[0] - a.size / 2, y: a.center[1] - a.size / 2, w: a.size, h: a.size };
      const f = freeArea(r.y);
      const mx = ((f.x1 - f.x0) * (1 - CENTRE)) / 2, my = ((f.y1 - f.y0) * (1 - CENTRE)) / 2;
      const strip = Math.min(HANDLE_ROW, (f.y1 - f.y0) / 4);
      const fit = (lo        , hi        , a0        , a1        ) => {
        if (a1 - a0 > hi - lo) return (lo + hi) / 2 - (a0 + a1) / 2;
        if (a0 < lo) return lo - a0;
        if (a1 > hi) return hi - a1;
        return 0;
      };
      return [fit(f.x0 + mx, f.x1 - mx, r.x, r.x + r.w), fit(f.y0 + my, f.y1 - my, r.y, r.y + r.h + strip)]                    ;
    };
    if (!need()) return null;
    const total                   = [0, 0];
    for (const ax of [0, 1, 0]         ) {
      let gain = 1; // screen px the object moved per px of pan, measured (may be negative, see below)
      let scale = 0.5; // the share of the measured need a step asks for: half at first (gain unknown), then all
      for (let i = 0; i < 8; i++) {
        const d = need();
        if (!d || Math.abs(d[ax]) < 1) break;
        const step = (d[ax] / gain) * scale;
        const before = adapter.anchor(key)?.center;
        adapter.view.pan(ax ? 0 : step, ax ? step : 0);
        const after = need();
        const now = adapter.anchor(key)?.center;
        const g = before && now ? (now[ax] - before[ax]) / step : NaN;
        const usable = Math.abs(g) > 0.05 && Math.abs(g) < 5;
        // Up / down may push it a little sideways (it comes nearer off the middle): up to 15 % of the width, put right by
        // the last sideways pass below.
        const worse = !after || Math.abs(after[ax]) > Math.abs(d[ax]) * 0.95 || (ax === 1 && Math.abs(after[0]) > Math.abs(d[0]) + win.innerWidth * 0.15);
        if (worse) {
          adapter.view.pan(ax ? 0 : -step, ax ? -step : 0); // linear in both adapters: exactly back
          // It went the other way (3D, up / down: an object between the camera and the point it turns round moves
          // against the ground, Lantern Cove's lighthouse on a phone): the measured sign, half steps. Too far (out of
          // sight, or past the place): a smaller step. Neither helps after a few tries: stop where it is.
          if (usable && g * gain < 0) gain = g;
          scale /= 2;
          if (scale < 0.05) break;
          continue;
        }
        total[ax] += step;
        if (usable) gain = g;
        scale = Math.min(1, scale * 2);
      }
    }
    return total;
  };
  const focusIfHidden = (key        ) => {
    if (state.multi || inView(key)) return;
    const gen = ++panGlide;
    const from = adapter.view.state();
    const total = panIntoMiddle(key);
    if (!total) {
      // Not drawn at all from here (behind the camera, hidden): the adapter's focus is the only way to show it.
      // Rare (a list pick of something behind you); it frames the object like before.
      adapter.view.focus(key);
      slideIntoFree(key);
      postView();
      return;
    }
    if (!adapter.view.restore) {
      postView();
      return; // no way back to the start: the slide happens at once
    }
    // Back to where it was, then the same slide over 0.35 s (ease out), as pan() steps that add up to `total`.
    adapter.view.restore(from);
    const t0 = nativeNow();
    let done = 0;
    const tick = () => {
      if (gen !== panGlide || !state.editing) return;
      const t = Math.min(1, (nativeNow() - t0) / GLIDE_MS);
      const e = 1 - (1 - t) ** 3;
      adapter.view.pan(total[0] * (e - done), total[1] * (e - done));
      done = e;
      dirtyFrame = true;
      if (t < 1) core.time.raf(tick);
      else {
        panGlide = 0;
        postView();
      }
    };
    core.time.raf(tick);
  };
  // List thumbnails waiting to be drawn (placement/thumbs), newest request first.
  let thumbQueue                                       = [];
  let thumbRunning = false;
  // One picture per turn of the page's event loop, each after the next painted frame (speed pass, 2026-10-17).
  // WHY: capture() is synchronous and `await` alone only yields a microtask, so the whole queue used to run as ONE
  // task. The game, the bridge and the shell share a thread, so nothing painted until every picture was drawn:
  // on a slow GPU (SwiftShader in the play test) the list of Lantern Cove appeared 4.8 s after it was ready, and
  // the shell's second request (the rows in view) arrived after the queue had emptied, so all 15 were drawn twice.
  // Now the list and the editor's first frame paint first, the pictures fill in one by one, and a request that
  // arrives meanwhile is merged with what is still queued.
  const nextTurn = () => new Promise      ((r) => core.time.raf(() => nativeSetTimeout(r, 0)));
  const drawThumbs = async () => {
    thumbRunning = true;
    try {
      for (let q = (await nextTurn(), thumbQueue.shift()); q; q = (await nextTurn(), thumbQueue.shift())) {
        let src                = null;
        try {
          const r = await adapter.capture(q.key, { size: q.size });
          if (r.ok && r.dataUrl && r.dataUrl.startsWith('data:image/png;base64,')) src = r.dataUrl;
        } catch {
          /* no thumbnail: the shell shows a placeholder */
        }
        post({ type: 'studio:placement/thumb', key: q.key, src, size: q.size });
      }
    } finally {
      thumbRunning = false;
    }
  };
  // (W1-1: the frame changing size — the phone's sheet, the caption line — no longer slides the view to keep the pick
  // in sight. It did, and every sheet / ⌘K list opening moved the camera; the person's view stays theirs.)
  // (W1-1: the first pick's glide from the opening view up to a 30° editing angle — adapter view.settle, polish pass
  // 2026-10-16 — is gone. It was the "camera flies into the sky" of review photo 02 / 12. The adapters keep settle();
  // the editor no longer calls it. ⌘K "Back to the opening view" still glides home.)
  const select = (key               , focus = false) => {
    state.selected = key && state.items.some((i) => i.key === key) ? key : null;
    state.group = state.selected ? [state.selected] : [];
    if (state.selected && focus) {
      focusIfHidden(state.selected);
      listPick = { key: state.selected, at: nativeNow() };
    } else {
      panGlide = 0;
      listPick = null;
    }
    input?.selectionChanged();
    postSelected();
  };
  const selectMany = (keys          , primary               , focus = false) => {
    const known = new Set(state.items.map((i) => i.key));
    state.group = [...new Set(keys)].filter((k) => known.has(k));
    state.selected = primary && state.group.includes(primary) ? primary : (state.group[state.group.length - 1] ?? null);
    if (state.selected && focus && state.group.length === 1) focusIfHidden(state.selected);
    input?.selectionChanged();
    postSelected();
  };

  const poseOf = (key        )              => {
    const it = adapter.list().find((i) => i.key === key);
    return it ? it.pose : null;
  };

  const closeStepRun = () => {
    if (!stepRun) return;
    nativeClearTimeout(stepRun.timer);
    const { key, from, op, group } = stepRun;
    stepRun = null;
    if (group) {
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, group, true), end: true, press: pressOf(op), hold: true });
      return;
    }
    const pose = poseOf(key);
    if (pose) post({ type: 'studio:placement/moved', key, pose, end: true, from, press: pressOf(op), hold: true });
  };

  /**
   * A keyboard / button step on a whole selection. Steps add up from the
   * start of a held run (`total`), so the run is one absolute group move.
   */
  const groupStep = (m                                                           , keys          ) => {
    let run = stepRun && stepRun.group && stepRun.op === m.op && m.hold ? stepRun : null;
    if (!run) {
      const g = beginGroup(adapter, keys, m.key);
      if (!g) return;
      run = { key: m.key, from: g.from.get(g.primary) , op: m.op, timer: 0, group: g, total: m.op === 'scale' ? 1 : 0, dx: 0, dy: 0 };
    }
    const g = run.group ;
    if (m.op === 'move') {
      // Arrow keys move by screen px: the same as dragging the move handle by that much (on surfaces too, snap.ts).
      run.dx += m.dx || 0;
      run.dy += m.dy || 0;
      adapter.setSnap?.({ on: true, skip: keys });
      groupMove(adapter, adapter.dim, g, run.dx, run.dy);
      adapter.setSnap?.({ on: false });
    } else if (m.op === 'drop') {
      // End with several picked: each onto the surface under it, as Unreal's End does (the others are not floors).
      for (const k of g.keys) adapter.drop?.(k, keys);
    } else if (m.op === 'rotate') {
      run.total += m.d || 0;
      // Q / E: upright, as for one object (the axis is the turn tool's), together or each in place as chosen.
      groupRotate(adapter, adapter.dim, g, run.total, { mode: state.turnMode });
    } else if (m.op === 'scale') {
      run.total *= m.d || 1;
      groupScale(adapter, adapter.dim, g, run.total, state.scaleMode);
    } else if (m.op === 'lift') {
      // PgDn: the step ends on the surface the first member meets (snap.ts stepDetent).
      const d = adapter.rest ? stepDetent(firstToTouch(g.keys.map((k) => adapter.rest (k, keys))), m.d || 0) : m.d || 0;
      groupLift(adapter, g, d);
    }
    dirtyFrame = true;
    if (m.hold) {
      stepRun = run;
      nativeClearTimeout(run.timer);
      run.timer = nativeSetTimeout(closeStepRun, 400);
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, g, false), press: pressOf(m.op), hold: true });
    } else {
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, g, true), end: true, press: pressOf(m.op) });
    }
  };

  /** The handle a step counts as for the shell (Drop to floor changes the height: the Height handle's). */
  const pressOf = (op        ) => (op === 'drop' ? 'lift' : op)                                        ;

  const step = (m                                                           ) => {
    const keys = m.keys && m.keys.length > 1 ? m.keys : null;
    if (stepRun && (stepRun.key !== m.key || stepRun.op !== m.op || !m.hold || !!stepRun.group !== !!keys)) closeStepRun();
    if (keys) {
      groupStep(m, keys);
      return;
    }
    const from = poseOf(m.key);
    if (!from) return;
    let pose       = from;
    if (m.op === 'move') {
      const a = adapter.anchor(m.key);
      if (!a) return;
      const [x, y] = a.center;
      adapter.setSnap?.({ on: true, skip: [m.key] });
      if (adapter.grab(m.key, x, y)) pose = adapter.drag(m.key, x + (m.dx || 0), y + (m.dy || 0));
      adapter.setSnap?.({ on: false });
    } else if (m.op === 'rotate') pose = adapter.rotate(m.key, m.d || 0);
    else if (m.op === 'scale') pose = adapter.scale(m.key, m.d || 1);
    else if (m.op === 'lift' && adapter.nudgeY) {
      // PgDn: a step that would cross the surface below ends on it; the next goes through (snap.ts stepDetent).
      const d = adapter.rest ? stepDetent(adapter.rest(m.key, [m.key]), m.d || 0) : m.d || 0;
      pose = adapter.nudgeY(m.key, d);
    } else if (m.op === 'drop' && adapter.drop) pose = adapter.drop(m.key, [m.key]);
    dirtyFrame = true;
    if (m.hold) {
      if (!stepRun) stepRun = { key: m.key, from, op: m.op, timer: 0, total: 0, dx: 0, dy: 0 };
      nativeClearTimeout(stepRun.timer);
      stepRun.timer = nativeSetTimeout(closeStepRun, 400);
      post({ type: 'studio:placement/moved', key: m.key, pose, press: pressOf(m.op), hold: true });
    } else {
      post({ type: 'studio:placement/moved', key: m.key, pose, end: true, from, press: pressOf(m.op) });
    }
  };

  /**
   * Make copies and put each one a little to the side, so it is visible at
   * once and can be moved right away. Where:
   * - a copy of a copy made in this session: at the same spacing again
   *   (copy, move the copy, copy again = a row with even gaps);
   * - otherwise: just to the right of the original(s) on screen (a group
   *   keeps its shape: everyone moves the same way).
   * With a `pose` (redo, reopening) the copy goes exactly there.
   * `at: 'view'` (the Library's "Add to scene", 2026-10-18): the copies go to the middle of the free part of the
   * frame instead (what the card and the ask bar leave), keeping the group's shape — on the original's ground in
   * 3D (a drag of the screen box, as the move tool does), so "add a pine" lands where the person is looking.
   */
  const copy = (reqs                                                   , at         ) => {
    const done                                                                    = [];
    const failed           = [];
    const before = new Map(adapter.list().map((i) => [i.key, i]));
    const fresh                                       = [];
    for (const r of reqs) {
      const made = edits.make(r.key, r.from);
      if (!made) {
        failed.push(r.key);
        continue;
      }
      if (r.pose) adapter.setPose(r.key, r.pose);
      else fresh.push({ key: r.key, from: r.from });
      done.push({ key: r.key, from: r.from, pose: r.pose , ghost: made.ghost || undefined });
    }
    // Spacing of copies of copies, in parent space.
    const rest                                       = [];
    if (at === 'view' && fresh.length && toView(fresh)) fresh.length = 0;
    for (const f of fresh) {
      const src = before.get(f.from);
      const orig = src?.copyOf ? before.get(src.copyOf) : undefined;
      const gap = src && orig ? src.pose.p.map((v, i) => v - (orig.pose.p[i] ?? 0)) : null;
      if (src && gap && gap.some((v) => Math.abs(v) > 1e-6)) {
        const next       = { ...structuredClone(src.pose), p: src.pose.p.map((v, i) => v + (gap[i] ?? 0)) };
        delete next.z; // a copy keeps its own place in the draw order (right after the original)
        adapter.setPose(f.key, next);
      } else rest.push(f);
    }
    if (rest.length) {
      // One screen offset for all: the width of what was copied, plus a gap.
      const sources = rest.map((f) => f.from);
      const ga = groupAnchor(adapter, sources, sources[0] );
      const dx = ga && ga.rect ? Math.max(24, Math.min(400, ga.rect.w + 12)) : 40;
      // A copy of what the game moves is held like its original (hold.ts), but this first step beside it is the
      // editor's own: let it through, then hold it.
      for (const f of rest) hold.placing.add(f.key);
      try {
        const g = beginGroup(adapter, rest.map((f) => f.key), rest[0] .key);
        // 3D: groupMove moves the first copy on the ground and the others by the same metres.
        if (g) groupMove(adapter, adapter.dim, g, dx, 0);
      } finally {
        hold.placing.clear();
      }
    }
    for (const d of done) d.pose = adapter.anchor(d.key)?.pose ?? d.pose;
    dirtyFrame = true;
    refreshItems();
    post({ type: 'studio:placement/added', items: done.filter((d) => d.pose), failed });
    // The copies become the selection, so they can be moved (or copied again) at once.
    if (done.length) selectMany(done.map((d) => d.key), done[done.length - 1] .key);
  };

  /**
   * Place the Library's "Add to scene" copies (copy with `at: 'view'`) where they can be seen whole. True when done.
   * The rule (design review 2, 2026-10-19, item ①): the copy keeps the original's size and must show inside the middle
   * 60 % of the frame, no taller than 35 % of it — never "in front of the camera, covering the view".
   * 1. Beside the original, one of its widths over (toward the middle of the frame, else the other side), when the
   *    original is on screen: the person sees the new one next to the one they know.
   * 2. Otherwise (the original off screen, or both sides fail the rule): the middle of what the camera sees, at about
   *    the original's distance. 3D: points on the original's ground down the middle line of the free area (toGround);
   *    of the ones that pass the rule, the one whose screen height is nearest the original's (= the same distance).
   *    2D: the middle of the free area (a 2D copy's size does not depend on where it stands).
   * 3. Nothing passes (a giant object, no ground under the middle): the candidate that shows smallest.
   * WHY: the first version (2026-10-18) always went to "the ground below the middle"; in Lantern Cove that ground is
   * right under a low camera, and the sea-stack copy stood in front of it, covering ~45 % of the view and the
   * lighthouse, with its strip off screen (review 2, photo 11).
   */
  const toView = (fresh                                      )          => {
    const keys = fresh.map((f) => f.key);
    const g = beginGroup(adapter, keys, keys[0] );
    if (!g) return false;
    // The copies stand exactly where the originals are (made this frame): the originals' box is theirs.
    const ga = groupAnchor(adapter, fresh.map((f) => f.from), fresh[0] .from);
    const W = win.innerWidth, H = win.innerHeight;
    const shown = () => {
      const a = groupAnchor(adapter, keys, g.primary);
      return a && a.visible && a.rect ? a.rect : null;
    };
    // The rule above: height ≤ 35 % of the frame, middle inside the middle 60 % (20 %–80 % both ways).
    const passes = (r                                                       ) => !!r && r.h <= H * 0.35 + 0.5
      && r.x + r.w / 2 >= W * 0.2 && r.x + r.w / 2 <= W * 0.8 && r.y + r.h / 2 >= H * 0.2 && r.y + r.h / 2 <= H * 0.8;
    const h0 = ga?.rect?.h ?? 0;
    // Tried placements: how to put the group there again, and its screen box there.
    const tried                                                                                       = [];
    const attempt = (put            ) => {
      put();
      const r = shown();
      tried.push({ put, r });
      return passes(r);
    };
    // 1. Beside the original.
    const W0 = ga?.rect?.w ?? 0;
    if (ga && ga.visible && ga.rect && W0 > 0) {
      const toMiddle = ga.center[0] <= W / 2 ? 1 : -1;
      const gap = Math.max(8, W0 * 0.1);
      for (const dir of [toMiddle, -toMiddle]) {
        if (attempt(() => groupMove(adapter, adapter.dim, g, dir * (W0 + gap), 0))) return true;
      }
    }
    // 2. The middle of the view at about the original's distance.
    const area = freeArea(inset.top);
    const tx = (area.x0 + area.x1) / 2, ty = (area.y0 + area.y1) / 2;
    const lead = g.from.get(g.primary);
    const good                                                                                = [];
    if (adapter.dim === '3d' && lead && adapter.toGround) {
      for (let f = 0.3; f <= 0.901; f += 0.05) {
        const y = area.y0 + (area.y1 - area.y0) * f;
        const hit = adapter.toGround(tx, y, lead.p[1] ?? 0);
        if (!hit) continue;
        const put = () => {
          groupShift(adapter, g, [hit[0]  - (lead.p[0] ?? 0), 0, hit[2]  - (lead.p[2] ?? 0)]);
          // Now in front of the camera: its pivot onto the screen point, so a long thing is placed by its middle.
          const a = adapter.anchor(g.primary);
          const g2 = a && a.visible ? beginGroup(adapter, keys, g.primary) : null;
          if (g2 && a) groupMove(adapter, '3d', g2, tx - a.center[0], y - a.center[1]);
        };
        if (attempt(put)) good.push({ put, r: tried[tried.length - 1] .r  });
      }
    } else if (ga) {
      const put = () => groupMove(adapter, adapter.dim, g, tx - ga.center[0], ty - ga.center[1]);
      if (attempt(put)) good.push({ put, r: tried[tried.length - 1] .r  });
    }
    if (good.length) {
      good.sort((a, b) => Math.abs(a.r.h - h0) - Math.abs(b.r.h - h0));
      good[0] .put();
      return true;
    }
    // 3. Nothing passed: the smallest one seen (a visible one first).
    const seen = tried.filter((x) => x.r).sort((a, b) => a.r .h - b.r .h);
    if (!seen.length) return false;
    seen[0] .put();
    return true;
  };

  /**
   * Once, right after the edit view is up: let the game's own frames run for WATCH_MS, find what it moved by itself
   * (observe.ts), put those back where the first frame had them, and hold them (hold.ts: "the game moves this").
   * Not skipped when core.time counted no game frame: a three.js game's frames are held by the adapter's own boot.js
   * (raw.watch), not by core.time, so that count stays 0 there (found on the runner of that try, 2026-10-19).
   */
  let watched = false;
  // The watch and the self-check of the first edit (settled()); resolved when there is neither.
  let firstMoments                   = Promise.resolve();
  const watchGame = async () => {
    if (watched) return;
    watched = true;
    // The world's objects only (UI stage 1 merged in, 2026-10-19): a game with only a UI has nothing to watch.
    if (!world) return;
    const { raw, ruled } = world;
    let before        ;
    try {
      before = ruled.list();
    } catch {
      return;
    }
    watchBase = new Map(before.map((i) => [i.key, i.pose]         ));
    core.time.thaw();
    raw.watch?.(true);
    await new Promise((r) => nativeSetTimeout(r, WATCH_MS));
    const base = watchBase;
    watchBase = null;
    // Left editing meanwhile (Play): the game runs on as it should; nothing to put back.
    if (!state.editing) {
      raw.watch?.(false);
      return;
    }
    core.time.freeze();
    // Read what moved BEFORE watch(false): an adapter may put its whole scene back then (three.js does).
    let after         = [];
    try {
      after = ruled.list();
    } catch {
      /* nothing found: the scene is put back below all the same */
    }
    raw.watch?.(false);
    const was = after.map((i) => ({ ...i, pose: base.get(i.key) ?? i.pose }));
    hold.driven = drivenBetween(was, after, world.driven.dim);
    // What the game moved, and what the editor posed meanwhile (a saved layout re-applied, an early drag), which an
    // adapter's watch(false) may have put back to the first frame with the rest of the scene.
    for (const k of new Set([...hold.driven.keys(), ...watchSet])) {
      const p = base.get(k);
      if (p) ruled.setPose(k, p);
    }
    watchSet.clear();
    if (!hold.driven.size) return;
    dirtyFrame = true;
    // The UI being edited by then (a reload that asked for it): the world's list, now with `held`, goes out marked as
    // the world's, the way setEditing sends the other layer's list.
    if (layer !== 'world') {
      try {
        post({ type: 'studio:placement/items', items: world.driven.list(), layer: 'world' });
      } catch {
        /* listed when switched to */
      }
      return;
    }
    refreshItems();
    postSelected();
    input?.selectionChanged();
  };

  const setEditing = (on         , viewState          ) => {
    if (on === state.editing) return;
    if (on) {
      core.time.freeze();
      try {
        state.items = adapter.begin();
      } catch (e) {
        post({ type: 'studio:core/error', message: `begin() failed: ${(e         ).message}` });
      }
      // A tap made while the editor was getting ready (early-press.ts): read HERE, on the picture it was made on (begin()
      // opens on the game's own camera), before a saved view or "everything in frame" below moves the view. Picked once
      // input is attached (below).
      const early = deps.earlyTaps?.take() ?? null;
      const earlyKey = early ? (tappableAt(adapter, state.items, win, early.x, early.y, early.type === 'mouse' ? UI.pickRadiusMouse : UI.pickRadiusTouch)[0] ?? null) : null;
      // Paused in Play: the view the person paused on (three.js begin() stands the edit camera where the player's was).
      if (deps.paused) { /* keep it */ }
      else if (viewState !== undefined && adapter.view.restore) adapter.view.restore(viewState);
      else {
        // The opening view: the game's own camera when the adapter has one (three.js, polish pass 2026-10-16),
        // else everything in frame. Told to the shell at once, so a reload opens on it too (the three.js state
        // carries `home`, so the first pick after a reload still glides).
        if (adapter.view.home) adapter.view.home();
        else adapter.view.frameAll();
        // Tell the shell the first view too (not only after the person moves the camera): a reload
        // after the AI's change then opens on the same view, even when the AI's new objects would
        // make "frame all" choose another one (AI feel, 2026-10-16).
        postView();
      }
      // The other layer starts too (UI: its CSS animations pause), but stays out of reach until switched to.
      for (const o of others()) {
        try {
          o.driven.begin();
        } catch (e) {
          post({ type: 'studio:core/error', message: `begin() failed: ${(e         ).message}` });
        }
      }
      state.editing = true;
      // The screen chosen before (Play → Edit in the same page) again, the person's looks, and the screens / theme
      // for the shell (UI stages 2–3). Before the lists, so they list that screen's elements.
      uiExtras?.begin();
      if (layer === 'ui') state.items = adapter.list();
      post({ type: 'studio:placement/items', items: state.items, ...itemsLayer() });
      // The other layer's list too, once (UI stage 1): the shell keeps the UI's saved places in the file and shows them
      // even when the person never switches to the UI.
      for (const o of others()) {
        try {
          post({ type: 'studio:placement/items', items: o.driven.list(), layer: o === uiStack ? 'ui' : 'world' });
        } catch {
          /* listed when switched to */
        }
      }
      attach();
      if (earlyKey) select(earlyKey);
      toolHost.announce();
      paintLayers();
      if (!loopId) loopId = core.time.raf(frame);
      // Paused in Play: the game stays still (no watch) and no check (see EditorDeps.paused).
      const watching = deps.paused ? Promise.resolve() : watchGame();
      if (!checked) firstMoments = watching;
      if (!checked && !deps.paused) {
        // Self-check once, in edit mode (3D adapters only know screen
        // positions once their edit camera exists).
        checked = true;
        // After the list and the first picture have painted (speed pass, 2026-10-17): the check draws twice and reads
        // the canvas back, which waits for the GPU to finish. Run at once, on a slow GPU it held the first paint of
        // the list by about a second (Lantern Cove in the play test's software GL).
        // After the watch too (watchGame): the check moves an object and reads it back, which the game's own motion
        // would spoil while it runs.
        // The adapter of the layer edited first (the world's; a reload asking for the UI switches a moment later).
        const checkOn = raw;
        const checkOnce = () => {
          checkSet = new Map();
          return runSelfCheck(checkOn, core, win).finally(() => {
            const given = checkSet ;
            checkSet = null;
            if (!world) return;
            for (const [k, p] of given) {
              try {
                world.ruled.setPose(k, p);
              } catch {
                /* gone meanwhile */
              }
            }
            if (given.size) dirtyFrame = true;
          });
        };
        firstMoments = watching
          .then(nextTurn)
          .then(nextTurn)
          .then(checkOnce)
          // A second look before saying anything (polish-1022, 2026-10-22). WHY: the docs' photo of our own Lantern
          // Cove, taken on a busy machine, showed "Moving things may not show in this game yet"; opened with the CPU
          // slowed 4×, the check sometimes read its test move undone ("asked x −21.1, read back −22") — the game was
          // still settling under it, the adapter was fine. A broken adapter fails the same way twice; only the
          // checks that move the sample get the second look, never "no adapter" or "no objects".
          .then(async (result) => {
            if (result.ok || !worthASecondLook(result) || !state.editing) return result;
            await new Promise((r) => nativeSetTimeout(r, SECOND_LOOK_MS));
            await nextTurn();
            return state.editing ? checkOnce() : result;
          })
          .then((result) => post({ type: 'studio:core/check', result }))
          .catch((e) => console.warn('[studio] self-check failed:', e));
      }
    } else {
      closeStepRun();
      toolHost.activate(null);
      input?.detach();
      input = null;
      state.editing = false;
      // Screens, samples and a shown button look go back to the game's (its set / theme stay: the layout).
      uiExtras?.end();
      for (const a of [adapter, ...others().map((o) => o.driven)]) {
        try {
          a.end();
        } catch {
          /* the page is usually reloaded after editing anyway */
        }
      }
      paintLayers();
    }
    ready();
  };
  /** The layers other than the current one (UI stage 1; none for a game without a UI). */
  const others = () => [world, uiStack].filter((x)             => !!x && x.driven !== adapter);
  /** Input on the current layer's adapter, with the shell's settings. */
  const attach = () => {
    // The input posts view-state itself (wheel, look-around): on the UI layer that is the 2D base's unused view, which
    // must not replace the world camera the shell keeps for the next reload.
    const inPost = (m               ) => {
      if (m.type !== 'studio:core/view-state' || layer === 'world') post(m);
    };
    input = attachInput({ adapter, edits, core, win, post: inPost, state, select, selectMany, step, tools: toolHost, markDirty: () => (dirtyFrame = true),
      ...(deps.paused ? { passKeyUp: true } : {}), ...(deps.ignore ? { ignore: deps.ignore } : {}) });
    if (pendingHandlePx) input.setHandleSize(pendingHandlePx);
    input.setInset(inset);
    input.setTheme(theme);
    if (aiMarks.keys.length) input.setAiMarks(aiMarks.keys, aiMarks.label);
    input.setMotion(motionBtn);
    input.setLang(lang);
  };
  // A core/layer that came before editing started (the shell sends it right after core/edit on a reload).
  let wantLayer                   = null;
  /**
   * Switch what is edited (core/layer, UI stage 1; design §2.2): 1. drop the pick and the input, 2. swap the adapter
   * stack, 3. input again, 4. tell the shell (core/ready with `layer`, then that layer's list). The world's edit
   * camera goes to the game's own view while the UI is edited (the UI sits on the player's picture) and comes back
   * after.
   */
  const setLayer = (to           ) => {
    const next = to === 'ui' ? uiStack : world;
    if (!next) return;
    if (!state.editing) {
      wantLayer = to;
      return;
    }
    if (next.driven === adapter) {
      ready();
      refreshItems();
      return;
    }
    closeStepRun();
    toolHost.activate(null);
    panGlide = 0;
    listPick = null;
    state.selected = null;
    state.group = [];
    input?.detach();
    input = null;
    if (world) {
      if (to === 'ui') {
        worldView = world.driven.view.state();
        if (world.driven.view.home) world.driven.view.home();
      } else if (worldView !== undefined && world.driven.view.restore) world.driven.view.restore(worldView);
    }
    layer = to;
    raw = next.raw;
    edits = next.edits;
    adapter = next.driven;
    try {
      state.items = adapter.list();
    } catch {
      state.items = [];
    }
    attach();
    paintLayers();
    dirtyFrame = true;
    ready();
    post({ type: 'studio:placement/items', items: state.items, ...itemsLayer() });
    postSelected();
  };

  toolHost = createToolHost({ win, adapter, state, post, select: (k) => select(k), lang: () => lang, markDirty: () => (dirtyFrame = true) });
  toolHost.register(deps.tools);

  return {
    get driven() {
      return adapter;
    },
    layer: () => layer,
    announce: ready,
    playLayers: () => [world, uiStack].filter((x)             => !!x).map((x) => ({ raw: x.raw, edits: x.edits })),
    settled: () => firstMoments.then(() => undefined),
    addTools(list) {
      toolHost.register(list);
      if (state.editing) toolHost.announce();
    },
    handle(msg) {
      switch (msg.type) {
        case 'studio:core/config':
          deps.rules.config = msg.config && typeof msg.config === 'object' ? msg.config : null;
          if (state.editing) refreshItems();
          break;
        case 'studio:core/ui':
          input?.setHandleSize(msg.handlePx);
          pendingHandlePx = msg.handlePx;
          if (msg.theme === 'dark' || msg.theme === 'light') {
            theme = msg.theme;
            input?.setTheme(theme);
          }
          if (msg.inset) {
            // What the panels cover (the strip and "is it in view" read it). W1-1: a sheet rising or going away no
            // longer slides the view to keep the pick clear of it (it moved the camera every time); see focusIfHidden.
            const grew = msg.inset.bottom > inset.bottom + 40;
            inset = { ...msg.inset };
            input?.setInset(inset);
            // The one exception: a list pick's own card made the sheet rise within 1 s of the pick. That is still
            // "show me what I picked from the list" (the same slide-if-hidden), not the sheet moving the camera.
            const lp = listPick;
            if (grew && lp && lp.key === state.selected && nativeNow() - lp.at < 1000) {
              listPick = null;
              nativeSetTimeout(() => {
                if (state.selected === lp.key) focusIfHidden(lp.key);
              }, 60);
            }
          }
          break;
        case 'studio:placement/axis':
          input?.setAxis(msg.axis);
          break;
        case 'studio:placement/tool':
          input?.setTool(msg.tool === 'move' || msg.tool === 'rotate' || msg.tool === 'lift' || msg.tool === 'scale' ? msg.tool : null);
          dirtyFrame = true;
          break;
        case 'studio:placement/motion':
          // studio-motion-tool: the Motion button after the strip's tools. `label` is shown as text only (title, aria).
          motionBtn = { show: !!msg.show, has: !!msg.has, label: typeof msg.label === 'string' ? msg.label.slice(0, 160) : '', open: !!(msg                      ).open };
          input?.setMotion(motionBtn);
          // Its key or ⌘K in the editor page: answered as a press on the button (motion-press with its place).
          if ((msg                       ).press) input?.pressMotion();
          dirtyFrame = true;
          break;
        case 'studio:placement/look':
          input?.setLook(!!msg.on);
          break;
        case 'studio:core/fly':
          input?.setFly(Array.isArray(msg.keys) ? msg.keys : [], !!msg.fast);
          break;
        case 'studio:placement/menu':
          input?.closeMenu();
          break;
        case 'studio:placement/marks':
          aiMarks = { keys: Array.isArray(msg.keys) ? msg.keys.filter((k) => typeof k === 'string').slice(0, 500) : [], label: typeof msg.label === 'string' ? msg.label.slice(0, 80) : null };
          input?.setAiMarks(aiMarks.keys, aiMarks.label);
          dirtyFrame = true;
          break;
        case 'studio:placement/at':
          // studio-motion-flow: a Library motion held over the game — which object is under it (answered at once).
          if (typeof msg.x === 'number' && typeof msg.y === 'number') post({ type: 'studio:placement/at-is', id: Number(msg.id) || 0, key: input?.keyAt(msg.x, msg.y) ?? null });
          break;
        case 'studio:placement/hover':
          input?.setHover(Array.isArray(msg.keys) ? msg.keys.filter((k) => typeof k === 'string').slice(0, 500) : []);
          dirtyFrame = true;
          break;
        case 'studio:tool/activate':
          toolHost.activate(msg.id);
          dirtyFrame = true;
          break;
        case 'studio:tool/restore':
          toolHost.restore(msg.id, msg.data);
          break;
        case 'studio:tool/collect':
          toolHost.collect();
          break;
        case 'studio:tool/saved':
          toolHost.saved(msg.ids);
          break;
        case 'studio:timeline/pose':
        case 'studio:timeline/path':
        case 'studio:timeline/area':
          if (state.editing && layer === 'world') timeline.handle(msg);
          break;
        case 'studio:core/edit':
          if (!msg.on) timeline.clear();
          setEditing(msg.on, msg.viewState);
          if (msg.on && wantLayer) {
            const w = wantLayer;
            wantLayer = null;
            setLayer(w);
          }
          break;
        case 'studio:core/layer':
          if (msg.layer !== layer) timeline.clear();
          if (msg.layer === 'world' || msg.layer === 'ui') setLayer(msg.layer);
          break;
        case 'studio:ui/screen':
        case 'studio:ui/sample':
        case 'studio:ui/set':
        case 'studio:ui/state':
        case 'studio:ui/theme-set':
        case 'studio:ui/props-get':
          if (state.editing && uiStack) uiExtras?.handle(msg);
          dirtyFrame = true;
          break;
        case 'studio:core/ui-peek':
          uiPeek = !!msg.on;
          paintLayers();
          dirtyFrame = true;
          break;
        case 'studio:core/view': {
          const v = msg.view;
          if (v.action === 'frameAll') adapter.view.frameAll();
          // The opening view again: the game camera's (three.js) or, without home(), "everything", which is what a
          // 2D editor opened on (setEditing).
          else if (v.action === 'home') {
            if (adapter.view.home) adapter.view.home({ glide: true });
            else adapter.view.frameAll();
          } else if (v.action === 'focus') adapter.view.focus(v.key);
          else if (v.action === 'zoom') adapter.view.zoom(v.factor);
          else if (v.action === 'orbit') adapter.view.orbit?.(v.dx, v.dy);
          else if (v.action === 'pan') adapter.view.pan(v.dx, v.dy);
          // Camera up / down from the editor page (⌘K, E / Q there): `by` is a share of the game's height.
          else if (v.action === 'rise') adapter.view.rise?.(v.by * win.innerHeight);
          else if (v.action === 'restore') adapter.view.restore?.(v.state);
          dirtyFrame = true;
          postView();
          break;
        }
        case 'studio:core/lang':
          lang = msg.lang;
          input?.setLang(msg.lang);
          break;
        case 'studio:placement/list':
          refreshItems();
          break;
        case 'studio:placement/select':
          if (Array.isArray(msg.keys) && msg.keys.length > 1) selectMany(msg.keys, msg.key, msg.focus);
          else select(msg.key, msg.focus);
          break;
        case 'studio:placement/multi':
          state.multi = !!msg.on;
          break;
        case 'studio:placement/copy':
          closeStepRun();
          copy(msg.items, msg.at);
          break;
        case 'studio:placement/remove': {
          closeStepRun();
          const gone = edits.removeKeys(msg.keys);
          if (gone.length) {
            state.group = state.group.filter((k) => !gone.includes(k));
            if (state.selected && gone.includes(state.selected)) state.selected = state.group[state.group.length - 1] ?? null;
            dirtyFrame = true;
          }
          refreshItems();
          input?.selectionChanged();
          postSelected();
          break;
        }
        case 'studio:placement/restore':
          closeStepRun();
          if (edits.restoreKeys(msg.keys).length) dirtyFrame = true;
          refreshItems();
          break;
        case 'studio:placement/pose': {
          // Meant for the layer not being edited (the UI's saved places pushed while the world is edited): set there,
          // quietly — the shell already knows the pose, and its `moved` handler speaks for the current layer.
          const other = msg.layer && msg.layer !== layer ? (msg.layer === 'ui' ? uiStack : world) : null;
          if (other) {
            other.driven.setPose(msg.key, msg.pose);
            dirtyFrame = true;
            break;
          }
          closeStepRun();
          const zBefore = msg.pose.z !== undefined ? poseOf(msg.key)?.z : undefined;
          const pose = adapter.setPose(msg.key, msg.pose);
          dirtyFrame = true;
          // No `end`: the shell already recorded this as undo/redo. `set`: an echo of the shell's own pose (a place),
          // never a gesture — the timeline must not take it for a drag to key (studio-timeline).
          if (pose) post({ type: 'studio:placement/moved', key: msg.key, pose, set: true });
          // A new draw order (2D layers) also shifts the z of the siblings:
          // send the whole list so the shell's order and file stay right.
          if (pose && pose.z !== undefined && pose.z !== zBefore) refreshItems();
          break;
        }
        case 'studio:placement/step':
          if (state.editing) step(msg);
          break;
        case 'studio:placement/unhold':
          // "Make movable" on a held ground (hold.ts): the tools work on it again, for this session.
          for (const k of msg.keys) hold.freed.add(k);
          refreshItems();
          postSelected();
          input?.selectionChanged();
          break;
        case 'studio:placement/thumbs': {
          // One queue, drawn one at a time; the newest request goes FIRST (tool-modes pass, 10/16). The shell
          // asks for the rows you can see whenever the list scrolls, so with hundreds of objects the rows in
          // view are drawn next instead of after every earlier request (before: each request ran on its own,
          // 200 at most, in list order — rows further down stayed empty boxes).
          // Up to 384: the Library's tiles ask for twice their size on screen (Ive review 3 ⑧, 2026-10-20; the list's
          // rows ask for 96). A key asked for at another size is a different picture, so it stays queued.
          const size = Math.min(384, Math.max(16, msg.size | 0));
          const fresh = msg.keys.filter((k) => typeof k === 'string').slice(0, 500);
          const ahead = new Set(fresh);
          thumbQueue = [...fresh.map((key) => ({ key, size })), ...thumbQueue.filter((q) => !(ahead.has(q.key) && q.size === size))].slice(0, 2000);
          if (!thumbRunning) void drawThumbs();
          break;
        }
        case 'studio:library/assets': {
          const uses                                                        = {};
          for (const it of state.items.length ? state.items : adapter.list()) {
            try {
              const a = adapter.assetsOf(it.key);
              if (a.length) uses[it.key] = a;
            } catch {
              /* skip objects the adapter cannot explain */
            }
          }
          post({ type: 'studio:library/assets', loads: core.loads.entries(), uses });
          break;
        }
        case 'studio:library/preview':
          // Image swap preview is a library-tool feature implemented through
          // the adapter later; acknowledge so the shell does not wait forever.
          post({ type: 'studio:library/previewed', url: msg.url, ok: false });
          break;
      }
    },
  };
}

__def(__exports, "createEditor", () => createEditor);
};
__defs[43] = function (__exports) {
'use strict';
// ../shell/line-fade.ts

// The AI's finished line goes by itself (2026-10-20: "this line is always there, it's in the way" — the line "● Moved the pillar to the
// middle of the road (in the game) / 1 thing changed" stayed over the game until the next request).
//
// What fades: a line that only REPORTS (done, undone, redone in the editor; "fixed" over the game while playing).
// What stays: a line that needs the person — the AI's question (asking), a failure (failed: they have to decide what
// to do next, and the reason is the one thing to read twice), and every "on it" phase (sent, seen, working…: the
// person is waiting for it, and it is the only sign that something is happening).
//
// How long: long enough to read it twice, no longer. A report is read once when it appears and once more when the
// person looks back from the game to check it; ~250 ms a word is a slow reading pace, so 5 s covers the short ones
// ("Done." / "1 thing changed"), and the AI's own sentence gets a little more per character up to 10 s (longer than
// that is no longer a report, it is a fixture). While the pointer is over the line or the keyboard is in it, it never
// goes; after it leaves, LINE_GRACE_MS more so it does not vanish the moment the mouse slides off.
//
// Pure, so test/line-fade.test.ts reads the rules without a browser; main.ts (the editor) and bridge/play-ask.ts (over
// the game) run the timers.
                                            

/** The shortest a finished line stays (ms): "Done." read twice. */
const LINE_MIN_MS = 5000;
/** The longest (ms): a long reply from the AI. */
const LINE_MAX_MS = 10_000;
/** Extra time per character of the line's text (ms): ~20 characters a second, a calm pace in English and in Japanese. */
const LINE_PER_CHAR_MS = 50;
/** After the pointer / focus leaves the line (ms). */
const LINE_GRACE_MS = 2000;
/** The fade itself (ms; shell.css and bridge/play-ask.ts use the same). */
const LINE_FADE_MS = 400;

/** Phases whose line goes by itself. Everything else stays as long as it is true. */
function lineFades(ph         )          {
  return ph === 'done' || ph === 'undone' || ph === 'redone';
}

/** How long a finished line with this text stays (ms). */
function lineStayMs(text        )         {
  const n = [...(text || '')].length;
  return Math.max(LINE_MIN_MS, Math.min(LINE_MAX_MS, LINE_MIN_MS + Math.max(0, n - 20) * LINE_PER_CHAR_MS));
}

/**
 * What a finished line is about, so the same report that faded does not come back on the next poll (every 3 s the
 * line is drawn again) or after a save with nothing new: the phase, the AI's status time and its note. A new report
 * (another request done, Undo, Redo) has another key and shows again. `turn` counts the Undo / Redo presses, so
 * Undo → Redo → Undo shows "Back to before" again (same phase, same status, a new press).
 */
function lineKey(ph         , statusAt                             , note                    , turn = 0)         {
  return `${ph}|${statusAt ?? ''}|${note ?? ''}|${turn}`;
}

__def(__exports, "LINE_MIN_MS", () => LINE_MIN_MS);
__def(__exports, "LINE_MAX_MS", () => LINE_MAX_MS);
__def(__exports, "LINE_PER_CHAR_MS", () => LINE_PER_CHAR_MS);
__def(__exports, "LINE_GRACE_MS", () => LINE_GRACE_MS);
__def(__exports, "LINE_FADE_MS", () => LINE_FADE_MS);
__def(__exports, "lineFades", () => lineFades);
__def(__exports, "lineStayMs", () => lineStayMs);
__def(__exports, "lineKey", () => lineKey);
};
__defs[44] = function (__exports) {
'use strict';
// ../shell/icons.ts

// Line icons for the shell, drawn here (no icon font, no images from a
// third party). One grid for all of them: 20×20 view box, 1.5 px stroke, round
// ends, `currentColor`, so every icon takes the button's text colour and
// weight and they read as one family next to the system font.
//
// WHY drawn icons instead of the Unicode signs used before (↶ ↷ ⚙ ⋯ ⧉): the
// signs came from whatever font the system picked, at different sizes and
// weights per OS, and sat off the text baseline. A tool that should disappear
// behind the game cannot have its few marks look accidental (design pass
// 2026-10-16, "apple").
//
// Visual pass 2026-10-16 ("visual"): the first set mixed stroke weights
// (1.6 lines, 2.6 dots, 1.0 on the filled ones), square and round corners,
// and marks of different optical size, so a row of them looked drawn by
// three hands. One rule now, the way a Mac pro app's symbol set is built:
//   - 20×20 grid, artwork inside a 14 px live area (3..17), centred;
//   - every line is 1.5 px ON SCREEN (vector-effect: non-scaling-stroke, the
//     width comes from CSS --studio-icon-stroke), whatever size the icon is
//     drawn at, so an 18 px toolbar icon and a 14 px chevron weigh the same
//     as the regular weight of the system font beside them;
//   - round caps and joins; boxes have 1.5 corners, never sharp;
//   - dots are real filled circles (r 1.3), not zero-length strokes (those
//     changed size with the stroke and looked blotchy at 2.6);
//   - filled shapes (play, stop, spark) are filled AND stroked, so their
//     corners round off the same way the lines do.
const NS = 'http://www.w3.org/2000/svg';

/**
 * Artwork per icon, parts joined with "|". A part is SVG path data, or
 * "o cx cy" for a dot (filled circle, r 1.3), or "O cx cy r" for a ring.
 */
const PATHS                         = {
  undo: 'M7 4.5 3.5 8 7 11.5|M3.5 8h8.25a4.25 4.25 0 0 1 0 8.5H9',
  redo: 'M13 4.5 16.5 8 13 11.5|M16.5 8H8.25a4.25 4.25 0 0 0 0 8.5H11',
  // Four rounded corners: "show the whole scene".
  frame: 'M3.5 7.5V5A1.5 1.5 0 0 1 5 3.5h2.5|M12.5 3.5H15A1.5 1.5 0 0 1 16.5 5v2.5|M16.5 12.5V15a1.5 1.5 0 0 1-1.5 1.5h-2.5|M7.5 16.5H5A1.5 1.5 0 0 1 3.5 15v-2.5',
  // The same four corners around a dot: "the picture the game opens on" (back to the opening view, speed pass).
  opening: 'M3.5 7.5V5A1.5 1.5 0 0 1 5 3.5h2.5|M12.5 3.5H15A1.5 1.5 0 0 1 16.5 5v2.5|M16.5 12.5V15a1.5 1.5 0 0 1-1.5 1.5h-2.5|M7.5 16.5H5A1.5 1.5 0 0 1 3.5 15v-2.5|o 10 10',
  // A window with an arrow out of its top-right corner: "open this in a large window" (the side window's Open large).
  openLarge: 'M11.5 3.5h5v5|M16.5 3.5 10 10|M14.5 11.5V15a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5h3.5',
  // Two sliders with their knobs: "how the editor looks".
  look: 'M3.5 6.5h5|M12.5 6.5h4|O 10.5 6.5 2|M3.5 13.5h2|M9.5 13.5h7|O 7.5 13.5 2',
  play: 'M6.5 5.1v9.8a.9.9 0 0 0 1.37.77l8-4.9a.9.9 0 0 0 0-1.54l-8-4.9a.9.9 0 0 0-1.37.77z',
  stop: 'M6.5 5.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1z',
  // Pause while playing (2026-10-22): two bars, filled like play / stop.
  pause: 'M6.25 5h2a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1-.75-.75v-8.5A.75.75 0 0 1 6.25 5z|M11.75 5h2a.75.75 0 0 1 .75.75v8.5a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1-.75-.75v-8.5a.75.75 0 0 1 .75-.75z',
  // Pause-move (2026-10-22): the strip's own Move sign (bridge/handles.ts), four ways out of the middle.
  move: 'M10 3.5v13|M3.5 10h13|M8 5.5l2-2 2 2|M8 14.5l2 2 2-2|M5.5 8l-2 2 2 2|M14.5 8l2 2-2 2',
  // The AI: a four-point spark.
  spark: 'M10 3.5c.55 3.2 2.3 4.95 5.5 5.5-3.2.55-4.95 2.3-5.5 5.5-.55-3.2-2.3-4.95-5.5-5.5 3.2-.55 4.95-2.3 5.5-5.5z',
  more: 'o 5 10|o 10 10|o 15 10',
  list: 'M7.5 5.5h9|M7.5 10h9|M7.5 14.5h9|o 4 5.5|o 4 10|o 4 14.5',
  // Two rounded sheets, the front one whole.
  copy: 'M9 7.5h6A1.5 1.5 0 0 1 16.5 9v6a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 15V9A1.5 1.5 0 0 1 9 7.5z|M12.5 5A1.5 1.5 0 0 0 11 3.5H5A1.5 1.5 0 0 0 3.5 5v6A1.5 1.5 0 0 0 5 12.5',
  trash: 'M3.5 5.5h13|M8 5.5V4.25a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75V5.5|M5.5 5.5l.75 10.1a1 1 0 0 0 1 .9h5.5a1 1 0 0 0 1-.9l.75-10.1|M8.5 8.5v5|M11.5 8.5v5',
  chevronUp: 'M5.5 12.5 10 8l4.5 4.5',
  chevronDown: 'M5.5 7.5 10 12l4.5-4.5',
  chevronLeft: 'M12 5l-5 5 5 5',
  chevronRight: 'M8 5l5 5-5 5',
  check: 'M4.5 10.5l3.5 3.5 7.5-8',
  arrowUp: 'M10 15.5v-11|M5.5 9 10 4.5 14.5 9',
  // Layers (2D draw order): a bar = the end of the stack.
  toFront: 'M4.5 3.5h11|M10 16.5v-9|M6 11.5l4-4 4 4',
  forward: 'M10 16v-11|M6 9l4-4 4 4',
  backward: 'M10 4v11|M6 11l4 4 4-4',
  toBack: 'M4.5 16.5h11|M10 3.5v9|M6 8.5l4 4 4-4',
  send: 'M10 16V4.5|M5 9.5 10 4.5l5 5',
  // Rebrand 2026-10-16: the left column's two places and the ⌘K actions.
  // A box seen from a corner: "the scene".
  // The UI layer (UI stage 1): a screen with a title bar and a button — "the things drawn over the game".
  uiLayer: 'M5 4.5h10A1.5 1.5 0 0 1 16.5 6v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 14V6A1.5 1.5 0 0 1 5 4.5z|M6.5 8h5|M6.5 12.5h3.5',
  // A UI element's kind in the list and on the card (UI stage 1): text (a T), a button, a picture.
  uiText: 'M5.5 5h9|M10 5v10.5',
  uiButton: 'M5.5 6.5h9a2.5 2.5 0 0 1 2.5 2.5v2a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 11V9a2.5 2.5 0 0 1 2.5-2.5z|M7.5 10h5',
  uiImage: 'M5 4.5h10A1.5 1.5 0 0 1 16.5 6v8a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 14V6A1.5 1.5 0 0 1 5 4.5z|M3.5 13l4-4 3 3 2-2 4 4|o 12.5 8',
  cube: 'M10 3.5 16 6.75v6.5L10 16.5 4 13.25v-6.5L10 3.5z|M4 6.75 10 10l6-3.25|M10 10v6.5',
  // Four tiles: "the files".
  grid: 'M4.5 3.5h3.5a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z|M12 3.5h3.5a1 1 0 0 1 1 1V8a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z|M4.5 11H8a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1z|M12 11h3.5a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H12a1 1 0 0 1-1-1V12a1 1 0 0 1 1-1z',
  eye: 'M2.5 10s2.75-5 7.5-5 7.5 5 7.5 5-2.75 5-7.5 5-7.5-5-7.5-5z|O 10 10 2.25',
  // The eye struck through: "the game's UI is hidden while you edit the world" (layer-switch.ts).
  eyeOff: 'M2.5 10s2.75-5 7.5-5 7.5 5 7.5 5-2.75 5-7.5 5-7.5-5-7.5-5z|O 10 10 2.25|M4 16 16 4',
  plus: 'M10 4.5v11|M4.5 10h11',
  // The plus without its upright: one point fewer on a motion's path (motion-gui, 2026-10-22).
  minus: 'M4.5 10h11',
  // The plus turned 45°: close a note.
  close: 'M6 6l8 8|M14 6l-8 8',
  // The shortcut sheet (⌘K "Keyboard shortcuts"): a key cap with a row of keys and the space bar.
  keyboard: 'M4.5 5.5h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 13V7a1.5 1.5 0 0 1 1.5-1.5z|o 6.5 8.5|o 10 8.5|o 13.5 8.5|M7.5 11.75h5',
  swap: 'M4 7h11.5|M12.5 4l3 3-3 3|M16 13H4.5|M7.5 10l-3 3 3 3',
  globe: 'O 10 10 6.5|M3.5 10h13|M10 3.5c-2.2 2.4-2.2 10.6 0 13|M10 3.5c2.2 2.4 2.2 10.6 0 13',
  hand: 'M7 10V5.25a1.25 1.25 0 0 1 2.5 0V9|M9.5 8.5V4.25a1.25 1.25 0 0 1 2.5 0V9|M12 8.75V5.5a1.25 1.25 0 0 1 2.5 0V11a5.5 5.5 0 0 1-5.5 5.5h-.3a4.5 4.5 0 0 1-3.6-1.8L3.3 12.2a1.3 1.3 0 0 1 2-1.6L7 12',
  layers: 'M10 3.5 16.5 7 10 10.5 3.5 7 10 3.5z|M3.5 10.25 10 13.75l6.5-3.5|M3.5 13.5 10 17l6.5-3.5',
  // The studio's mark: two cards (the KUMODeck "deck"), a little apart. The
  // front one filled = the scene you have open; the one behind, a line = the
  // code under it. Simple enough to hold at 16 px.
  mark: 'M8.5 3.5h6A2 2 0 0 1 16.5 5.5v6|M5.5 6.5h6A2 2 0 0 1 13.5 8.5v6a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z',
  // Six dots: "drag me" (list grips).
  grip: 'o 7.5 5.5|o 12.5 5.5|o 7.5 10|o 12.5 10|o 7.5 14.5|o 12.5 14.5',
  // The tool strip's four tools (the same pictures as the strip in the game, on this 20 grid): ⌘K rows.
  toolMove: 'M10 3.5v13|M3.5 10h13|M8 5.5l2-2 2 2|M8 14.5l2 2 2-2|M5.5 8l-2 2 2 2|M14.5 8l2 2-2 2',
  toolLift: 'M10 3.5v13|M7 6.5l3-3 3 3|M7 13.5l3 3 3-3',
  toolRotate: 'M16 10a6 6 0 1 1-1.76-4.24|M14.75 3v3.25H11.5',
  toolScale: 'M4.5 15.5 15.5 4.5|M11 4.5h4.5V9|M4.5 11v4.5H9',
  // The strip's Motion button (studio-motion-tool; bridge/handles.ts MOTION_ICON on this grid): a path to the thing at its end.
  toolMotion: 'M16.5 16c-3.75 0-4.2-5.8-7.1-7.9S5.8 6.7 4.6 5.4|o 16.5 16|O 4.6 5.4 2.2',
};

/** Icons drawn filled as well as stroked (they read too thin as outlines). */
const FILLED = new Set(['play', 'stop', 'spark', 'pause']);
/** Icons whose LAST part is filled (the mark's front card). */
const LAST_FILLED = new Set(['mark']);

function part(d        , filled         )             {
  if (d[0] === 'o' || d[0] === 'O') {
    const [, cx, cy, r] = d.split(' ');
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', cx);
    c.setAttribute('cy', cy);
    if (d[0] === 'o') {
      // A dot: fill only, so its size does not depend on the stroke width.
      c.setAttribute('r', '1.3');
      c.setAttribute('fill', 'currentColor');
      c.setAttribute('stroke', 'none');
    } else {
      c.setAttribute('r', r);
      c.setAttribute('fill', 'none');
    }
    return c;
  }
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', filled ? 'currentColor' : 'none');
  return p;
}

function icon(name                             )                {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon icon-${name}`);
  // Stroke colour, caps and joins on the <svg> (inherited by every part); the
  // width comes from CSS (svg.icon { stroke-width: var(--studio-icon-stroke) })
  // so a .studio/ui/studio.css can make every icon bolder in one place.
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const filled = FILLED.has(name);
  const parts = (PATHS[name] || '').split('|');
  for (const [i, d] of parts.entries()) {
    const el = part(d, filled || (LAST_FILLED.has(name) && i === parts.length - 1));
    // The same on-screen line width at every icon size (see the rule above).
    el.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(el);
  }
  return svg;
}

/**
 * Put an icon and a label into a button. `showLabel: false` keeps the label
 * for screen readers and the tooltip only (icon-only toolbar buttons).
 * Re-rendering a button goes through here, so textContent never wipes the icon.
 */
function setButton(b                   , name               , label        , showLabel = true, tip         )       {
  b.replaceChildren();
  if (name) b.append(icon(name));
  if (showLabel) {
    const s = document.createElement('span');
    s.className = 'label';
    s.textContent = label;
    b.append(s);
  }
  b.setAttribute('aria-label', label);
  if (tip !== undefined) b.title = tip;
  else if (!showLabel) b.title = label;
}

__def(__exports, "icon", () => icon);
__def(__exports, "setButton", () => setButton);
};
__defs[45] = function (__exports) {
'use strict';
// play-shot.ts

// The picture and the UI that go with a request made while playing (CONTRACT.md §3.5; 2026-10-20: "I asked the AI
// while playing and it ignored the UI on screen").
//
// WHY this file: the first picture (2026-10-20) drew only the page's canvases. A game's HUD, title, buttons and score
// are usually HTML over the canvas, so the AI got a picture without them and could not tell what the person was
// looking at when they said "make the score bigger" or "this button is in the way". `shootPage` is a screenshot of
// the page as the player sees it: canvases AND the HTML over them, painted into one canvas. One picture is all that
// goes (a UI list in words was tried the same day and taken out: "a screenshot is enough").
//
// WHY a small painter of our own, not the usual ways:
// - the browser's own screen capture (getDisplayMedia) asks the person every time with a dialog — in the middle of a
//   run; the brief says no dialog;
// - there is no library here (the bridge is one file that goes into every game page);
// - the SVG <foreignObject> route loads asynchronously, drops the game's style sheets unless each one is copied in,
//   and in some browsers marks the canvas unreadable (then there is no picture at all).
// The painter draws what HUDs are made of — boxes with a background colour, a border and round corners, text in its
// font and colour, images from the game's own site — in the page's painting order (in-flow first, then positioned
// boxes by z-index), synchronously, at the moment Enter is pressed.
// NOT drawn (the AI sees the UI's place and words, not its finish): CSS gradients, shadows and glows (text-shadow,
// box-shadow), CSS background images, inline SVG, rotations (a turned box is drawn upright in its bounds), pictures
// from another site (drawing one would make the whole picture unreadable), what is typed in a game's input field
// (its value is not text in the page), anything inside a shadow root or an iframe.
//
// The editor's own parts (the ask overlay, the tool strip) are never drawn: `skip` names them.

/** Widest picture sent (px). Enough to read a sign in the game; a 1024 px JPEG is ~100-250 KB. */
const SHOT_W = 1024;
/** Text the painter draws at most (characters): a long credits page would otherwise take long frames to paint. */
const PAINT_CHARS = 4000;


// ---------------------------------------------------------------------------
// The page (browser only)
// ---------------------------------------------------------------------------

                                      

const isTransparent = (c        ) => !c || c === 'transparent' || /rgba\([^)]*,\s*0(\.0+)?\)$/.test(c) || /\/\s*0(\.0+)?\)$/.test(c);
const sameSite = (win     , src        ) => {
  if (!src) return false;
  if (/^(data|blob):/.test(src)) return true;
  try {
    return new URL(src, win.location.href).origin === win.location.origin;
  } catch {
    return false;
  }
};
const shown = (cs                     ) => cs.display !== 'none' && cs.visibility !== 'hidden' && cs.visibility !== 'collapse';
const onScreen = (r         , vw        , vh        ) => r.width >= 1 && r.height >= 1 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;

/**
 * The game as the player sees it — canvases and the HTML UI over them — scaled to SHOT_W at most, as a JPEG. null when
 * nothing could be drawn (an empty page) or the browser refuses (a canvas with pictures from another site).
 */
function shootPage(win     , skip                          )                {
  const doc = win.document;
  const vw = win.innerWidth, vh = win.innerHeight;
  if (!vw || !vh) return null;
  const k = Math.min(1, SHOT_W / vw);
  const out = doc.createElement('canvas');
  out.width = Math.round(vw * k);
  out.height = Math.round(vh * k);
  const g = out.getContext('2d');
  if (!g) return null;
  g.scale(k, k);
  // The page's own colour under everything (CSS gives the body's to the whole page when the root has none).
  const rootBg = [doc.documentElement, doc.body].map((e) => (e ? win.getComputedStyle(e).backgroundColor : '')).find((c) => !isTransparent(c));
  g.fillStyle = rootBg || '#000';
  g.fillRect(0, 0, vw, vh);
  let drawn = 0;
  let chars = 0;
  const range = doc.createRange();

  // Positioned boxes are painted after the flow, lowest z-index first (CSS painting order, simplified: a box with
  // z-index auto takes its parent's).
  const later                                                                  = [];
  let order = 0;

  const box = (el         , cs                     , r         , alpha        ) => {
    const bg = cs.backgroundColor;
    const bw = parseFloat(cs.borderTopWidth) || 0;
    const bc = cs.borderTopColor;
    const paintBg = !isTransparent(bg);
    const paintBorder = bw > 0 && cs.borderTopStyle !== 'none' && !isTransparent(bc);
    if (!paintBg && !paintBorder) return;
    const rad = Math.min(r.width / 2, r.height / 2, cs.borderTopLeftRadius.endsWith('%') ? (parseFloat(cs.borderTopLeftRadius) / 100) * r.width : parseFloat(cs.borderTopLeftRadius) || 0);
    g.globalAlpha = alpha;
    g.beginPath();
    if (rad > 0 && typeof g.roundRect === 'function') g.roundRect(r.left, r.top, r.width, r.height, rad);
    else g.rect(r.left, r.top, r.width, r.height);
    if (paintBg) {
      g.fillStyle = bg;
      g.fill();
    }
    if (paintBorder) {
      g.lineWidth = bw;
      g.strokeStyle = bc;
      g.stroke();
    }
    drawn++;
  };

  const text = (node      , cs                     , alpha        ) => {
    const raw = node.data;
    if (!raw.trim() || chars > PAINT_CHARS) return;
    const tt = cs.textTransform;
    const show = (s        ) => (tt === 'uppercase' ? s.toUpperCase() : tt === 'lowercase' ? s.toLowerCase() : s);
    g.globalAlpha = alpha;
    g.fillStyle = cs.color;
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    g.textBaseline = 'middle';
    const ls = parseFloat(cs.letterSpacing);
    if ('letterSpacing' in g) (g                                                        ).letterSpacing = Number.isFinite(ls) ? `${ls}px` : '0px';
    // Word by word, each where the browser laid it out (wrapped lines, centred text and all); a word the browser broke
    // over two lines (no spaces: Japanese) letter by letter.
    const re = /\S+/g;
    let m                        ;
    while ((m = re.exec(raw)) && chars <= PAINT_CHARS) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const rects = range.getClientRects();
      if (rects.length === 1) {
        const q = rects[0] ;
        if (onScreen(q, vw, vh)) g.fillText(show(m[0]), q.left, q.top + q.height / 2);
        chars += m[0].length;
        continue;
      }
      let i = m.index;
      for (const ch of m[0]) {
        range.setStart(node, i);
        range.setEnd(node, i + ch.length);
        const q = range.getClientRects()[0];
        if (q && onScreen(q, vw, vh)) g.fillText(show(ch), q.left, q.top + q.height / 2);
        i += ch.length;
        chars++;
      }
    }
    drawn++;
  };

  const paint = (el         , alpha        , z        , top         ) => {
    if (skip(el)) return;
    const cs = win.getComputedStyle(el);
    if (cs.display === 'none') return;
    const a = alpha * (Number(cs.opacity) || (cs.opacity === '0' ? 0 : 1));
    if (a <= 0.01) return;
    const positioned = cs.position !== 'static';
    const zi = cs.zIndex === 'auto' ? z : Number(cs.zIndex) || 0;
    if (positioned && !top) {
      later.push({ el, z: zi, order: order++, alpha });
      return;
    }
    const tag = el.tagName;
    const r = el.getBoundingClientRect();
    const visible = cs.visibility === 'visible' && onScreen(r, vw, vh);
    if (visible && el !== doc.documentElement && el !== doc.body) box(el, cs, r, a);
    if (visible && tag === 'CANVAS') {
      try {
        g.globalAlpha = a;
        g.drawImage(el                     , r.left, r.top, r.width, r.height);
        drawn++;
      } catch {
        /* this one cannot be read; the others still can */
      }
      return;
    }
    if (visible && (tag === 'IMG' || tag === 'VIDEO')) {
      const m = el                                       ;
      const src = tag === 'IMG' ? m.currentSrc || m.src : m.currentSrc || m.src;
      // Only the game's own pictures: one from another site would make the whole picture unreadable.
      const ready = tag === 'IMG' ? m.complete && m.naturalWidth > 0 : m.readyState >= 2;
      if (ready && sameSite(win, src)) {
        try {
          g.globalAlpha = a;
          g.drawImage(m, r.left, r.top, r.width, r.height);
          drawn++;
        } catch {
          /* not drawable */
        }
      }
      return;
    }
    if (tag === 'SVG' || tag === 'svg' || tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEMPLATE' || tag === 'IFRAME') return;
    for (const c of Array.from(el.childNodes)) {
      if (c.nodeType === 3) {
        if (shown(cs)) text(c        , cs, a);
      } else if (c.nodeType === 1) paint(c           , a, zi, false);
    }
  };

  paint(doc.documentElement, 1, 0, true);
  while (later.length) {
    later.sort((x, y) => x.z - y.z || x.order - y.order);
    const next = later.shift() ;
    paint(next.el, next.alpha, next.z, true);
  }
  g.globalAlpha = 1;
  if (!drawn) return null;
  try {
    return out.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}

__def(__exports, "SHOT_W", () => SHOT_W);
__def(__exports, "shootPage", () => shootPage);
};
__defs[46] = function (__exports) {
'use strict';
// play-pause.ts

// Pause while playing (2026-10-22: "pause where something bothers you and chat with the AI"): what stops the
// game, and what puts it back exactly where it was. The chat over the paused game is play-chat.ts; the key, the
// corner button and the messages are wired in play-ask.ts. CONTRACT.md §3.5.1.
//
// What a pause holds:
// - the frames: core time's freeze() (the same hold the editor uses in Edit), so every engine that draws through
//   requestAnimationFrame stops — three.js setAnimationLoop, Pixi's Ticker, Phaser, hand-made loops;
// - the clock: core/play-clock.ts takes the paused time out of performance.now() and the frame timestamps, so the first
//   frame after Resume steps one frame, not the whole pause; with it the game's setTimeout / setInterval wait and
//   Date.now() stops (core/play-timers.ts, polish-1022), so a game stepped by a timer stops too;
// - the sound: the game's AudioContexts are suspended and its playing <audio> / <video> paused; Resume brings back
//   only what was playing (a context the game had suspended itself stays suspended);
// - the input: no key press and no pointer reaches the game (the veil over it takes the pointer; play-ask.ts's first
//   listener on the window drops the keys). Key RELEASES still reach it: a key held when P was pressed and let go
//   during the pause would otherwise stay "down" in the game, and the hero would run on by itself after Resume.
//
// Not held (CONTRACT.md §3.5.1): new Date(), promises and microtasks, requestIdleCallback, a Worker's own timers.
// Until polish-1022 (2026-10-22) a game stepped only by setTimeout / setInterval or Date.now() was not held either.
                                                  
                                                       

                             
                                                        
                                                    
 

/** Is this key press "pause / resume"? P with no modifier, never while the game's own text field (or ours) has focus. */
function isPauseKey(e                                                                                                               , typing         )          {
  if (typing || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
  // By the character (p / P with Shift), or the physical key when a layout or an IME gives another character for it
  // (a Japanese keyboard in kana input gives a kana for the P key).
  return e.key === 'p' || e.key === 'P' || e.code === 'KeyP';
}

                     
                
                           
                          
 

/**
 * Keep every AudioContext the game makes (the constructor is wrapped before any game code), so a pause can quiet it.
 * Weak: a context the game drops is not kept alive by this list.
 */
function watchAudio(win                            )                    {
  const made                            = [];
  const g = win                                      ;
  for (const name of ['AudioContext', 'webkitAudioContext']) {
    const Orig = g[name]                                                    ;
    if (typeof Orig !== 'function' || (Orig                               ).__studioPause) continue;
    // A subclass, not a function: `new AudioContext()` and `instanceof AudioContext` both keep working, and an engine
    // that subclasses it (rare) still gets a real context.
    const Kept = class extends (Orig                                   ) {
      constructor(...a           ) {
        super(...a);
        if (typeof WeakRef === 'function') made.push(new WeakRef(this                        ));
      }
    };
    Object.defineProperty(Kept, 'name', { value: Orig.name });
    (Kept                                         ).__studioPause = true;
    try {
      g[name] = Kept;
    } catch {
      /* read-only global: sound keeps playing in a pause, nothing else changes */
    }
  }
  return () => made.map((r) => r.deref()).filter((c)                 => !!c);
}

                            
                           
                                                      
                   
                               
                    
 

function createPauseHold(win                            , parts            )            {
  const doc = win.document;
  const contexts = watchAudio(win);
  let paused = false;
  // What the pause itself stopped, so Resume brings back only that.
  let quieted              = [];
  let stilled                     = [];
  let wasFrozen = false;

  return {
    get paused() {
      return paused;
    },
    pause() {
      if (paused) return false;
      paused = true;
      // Frozen already (the editor's own hold, a game still loading): leave it frozen on Resume too.
      wasFrozen = parts.time.frozen;
      parts.time.freeze();
      parts.clock.stop();
      quieted = contexts().filter((c) => c.state === 'running');
      for (const c of quieted) c.suspend().catch(() => {});
      stilled = [...doc.querySelectorAll('audio, video')].filter((m)                        => {
        const e = m                    ;
        return !e.paused && !e.ended;
      });
      for (const m of stilled) {
        try {
          m.pause();
        } catch {
          /* fine */
        }
      }
      // A first-person game holds the mouse: let go, so the person can use the chat.
      try {
        if (doc.pointerLockElement) doc.exitPointerLock();
      } catch {
        /* nothing locked */
      }
      return true;
    },
    resume() {
      if (!paused) return false;
      paused = false;
      parts.clock.go();
      if (!wasFrozen) parts.time.thaw();
      for (const c of quieted) c.resume().catch(() => {});
      for (const m of stilled) m.play().catch(() => {});
      quieted = [];
      stilled = [];
      return true;
    },
  };
}

__def(__exports, "isPauseKey", () => isPauseKey);
__def(__exports, "createPauseHold", () => createPauseHold);
};
__defs[47] = function (__exports) {
'use strict';
// play-chat.ts

// The chat over a paused game (pause, 2026-10-22; CONTRACT.md §3.5.1).
//
// The person pressed P (or ❚❚) in ▶ Play: the game is held where it was (play-pause.ts) and this panel opens over it —
// on the right on a wide screen, as a sheet at the foot on a narrow one. They write, their AI answers, as many times as
// they like; P or "Resume" goes back to the game exactly where it stopped.
//
// WHY no new path to the AI: each message is the same `play` request as the ✦ field's (play-ask.ts), marked `paused`.
// The first one carries the moment taken when the game stopped (picture, player's camera, what was near, the console);
// the next ones carry the talk so far (`history`) and the first one's id (`chat`), so the AI reads one record and
// knows the whole conversation (the host also keeps it as .studio/chat/<id>.json). The AI's replies are the same
// status line the editor already turns into the line over the game (shell/play-ask.ts playLine): its `done` /
// `asking` / `failed` note becomes a reply here, its `received` / `working` the "looking" row while it works.
//
// Lives in play-ask.ts's shadow root and top layer, so it draws over a full-screen game and the game's CSS cannot
// reach it. No colour but the AI's violet, as everywhere in the editor.
                                               
const { icon } = __require(44);

                           
                    
               
                                                                                                       
                            
                     
                   
                
 

/** The turns the next request carries (`history`): the last 12, each cut to 300 characters (HANDOFF_LIMITS). */
const HISTORY_MAX = 12;
function historyOf(turns            )                                             {
  return turns.slice(-HISTORY_MAX).map((t) => ({ who: t.who, text: t.text.length > 300 ? t.text.slice(0, 299) + '…' : t.text }));
}

/**
 * The pure part (test/pause.test.ts): what a new line from the editor does to the chat.
 * - `awaiting`: a message was kept (play/sent ok) and its answer has not come yet. Only then does a finished line
 *   (fixed / failed / asking) become a NEW reply: before the request is kept, the editor may still be showing the
 *   previous request's line, which is already in the chat.
 * - A finished line while not awaiting updates the last reply in place (the AI's files settled and Reload appeared,
 *   "More in Claude" came) — never a second copy of it.
 * - looking / fixing / kept: the row under the talk that says the AI is on it (`live`); a reply clears it. Always
 *   shown: the editor sends these only for the latest request made in this Play, which is the person's own.
 */
                            
                    
                    
                        
 
function chatOnLine(m           , s                 )            {
  if (!s) return { ...m, live: null };
  const finished = s.state === 'fixed' || s.state === 'failed' || s.state === 'asking';
  if (!finished) return { ...m, live: s };
  const turn           = { who: 'ai', text: s.text, state: s.state };
  if (s.choices?.length) turn.choices = s.choices.slice();
  if (s.reload) turn.reload = true;
  if (s.more) turn.more = s.more;
  if (m.awaiting) return { turns: [...m.turns, turn], awaiting: false, live: null };
  const last = m.turns[m.turns.length - 1];
  if (last && last.who === 'ai') return { turns: [...m.turns.slice(0, -1), turn], awaiting: false, live: null };
  return { ...m, live: null };
}

const CHAT_CSS = `
.veil { position: absolute; inset: 0; pointer-events: auto; background: rgba(8, 8, 14, .22); }
/* As tall as the talk, up to the game's height (the first look had it full height: a dark slab with one line of help in
   its middle, over a third of the game the person had stopped to look at). */
.chat { position: absolute; top: 14px; right: 14px; max-height: calc(100% - 28px); width: min(360px, calc(100% - 28px)); pointer-events: auto;
  border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; }
.chat .top { display: flex; align-items: center; gap: 10px; padding: 12px 10px 10px 14px; border-bottom: 1px solid rgba(255,255,255,.08); }
.chat .title { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.chat .title b { font-weight: 600; font-size: 14px; }
.chat .title .sees { color: rgba(255,255,255,.55); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat .talk { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; }
.chat .empty { color: rgba(255,255,255,.55); font-size: 13px; line-height: 1.45; }
.chat .you { align-self: flex-end; max-width: 85%; background: rgba(255,255,255,.12); padding: 7px 11px; border-radius: 12px 12px 4px 12px;
  white-space: pre-wrap; overflow-wrap: anywhere; }
.chat .ai { align-self: stretch; display: flex; gap: 9px; }
.chat .ai .dot { margin-top: 5px; }
.chat .ai .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.chat .ai .said { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
.chat .ai.failed .said { color: rgba(255,255,255,.75); }
.chat .ai .more { color: rgba(255,255,255,.5); font-size: 12px; }
.chat .ai .acts { display: flex; gap: 6px; flex-wrap: wrap; }
.chat .live { display: flex; gap: 9px; align-items: center; color: rgba(255,255,255,.7); }
.chat .live .dot { animation: pulse 1.1s ease-in-out infinite; }
.chat form { display: flex; align-items: center; gap: 8px; margin: 0 10px 10px; padding: 6px 6px 6px 12px; border-radius: 12px;
  background: rgba(255,255,255,.07); border: 1px solid rgba(139,124,255,.45); }
.chat form:focus-within { box-shadow: 0 0 0 3px rgba(139,124,255,.18); }
.chat form input { all: unset; flex: 1; min-width: 0; font: 500 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; padding: 5px 0; }
.chat form input::placeholder { color: rgba(255,255,255,.5); }
.chat .send { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: #8b7cff; color: #fff; flex: none; }
.chat .send:disabled { background: rgba(255,255,255,.12); color: rgba(255,255,255,.4); cursor: default; }
.chat .send svg { width: 14px; height: 14px; stroke-width: 2px; }
.chat .send:focus-visible { outline: 2px solid #8b7cff; outline-offset: 2px; }
button.b .k { opacity: .55; font-weight: 500; margin-left: 6px; font-size: 11px; }
.pause { pointer-events: auto; width: 32px; height: 32px; border-radius: 16px; display: grid;
  place-items: center; cursor: pointer; color: inherit; transition: opacity .3s; opacity: .92; }
.pause:hover { opacity: 1; }
.pause svg { width: 14px; height: 14px; }
.pause:focus-visible { outline: 2px solid #8b7cff; outline-offset: 2px; }
@media (max-width: 639px) {
  .chat { top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: 55%; border-radius: 16px 16px 0 0; border-bottom: 0; }
  .chat form { margin-bottom: max(10px, env(safe-area-inset-bottom)); }
}
@media (pointer: coarse) {
  .pause { width: 44px; height: 44px; border-radius: 22px; }
  .chat .send { width: 36px; height: 36px; }
  button.b .k { display: none; }
}
@media (prefers-reduced-motion: reduce) { .chat .live .dot { animation: none; } }
`;

                              
                
                                                          
                                                                                                              
                           
                                                                                
                 
                 
     
                                                                                                                   
                                                                                                
     
                                                                                                 
 

                       
                                                                    
                                
                                   
                                                                                                             
                                           
                
                           
                         
                                 
                          
                                                              
                 
 

function createChat(o             )       {
  const { el, w } = o;
  let model            = { turns: [], awaiting: false, live: null };
  let open = false;
  let sending = false;
  let sendFailed = false;
  let sees = '';

  const veil = el('div', 'veil');
  veil.dataset.part = 'pause-veil';
  veil.hidden = true;
  const panel = el('section', 'chat glass');
  panel.dataset.part = 'pause-chat';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  const top = el('div', 'top');
  const title = el('div', 'title');
  const head = el('b', '');
  const seesEl = el('span', 'sees');
  title.append(head, seesEl);
  const resumeBtn = el('button', 'b', '')                     ;
  resumeBtn.type = 'button';
  resumeBtn.dataset.action = 'pause-resume';
  resumeBtn.addEventListener('click', () => o.resume());
  // "Move" left of Resume: the panel's one other way, so both are where the eye already is (design.md §5).
  const moveBtn = o.move ? (el('button', 'b', '')                     ) : null;
  if (moveBtn && o.move) {
    moveBtn.type = 'button';
    moveBtn.dataset.action = 'pause-move';
    const m = o.move;
    moveBtn.addEventListener('click', () => m.toggle());
  }
  top.append(title, ...(moveBtn ? [moveBtn] : []), resumeBtn);
  const talk = el('div', 'talk');
  talk.setAttribute('aria-live', 'polite');
  const form = el('form', '');
  const input = el('input', '')                    ;
  input.type = 'text';
  input.maxLength = 500;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('enterkeyhint', 'send');
  const sendBtn = el('button', 'send')                     ;
  sendBtn.type = 'submit';
  sendBtn.append(icon('send'));
  form.append(input, sendBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(input.value);
  });
  input.addEventListener('input', () => {
    sendFailed = false;
    sendBtn.disabled = !input.value.trim() || sending;
  });
  panel.append(top, talk, form, ...(o.move ? [o.move.card] : []));

  function submit(text        ) {
    const t = text.trim();
    if (!t || sending) return;
    sending = true;
    sendFailed = false;
    // The talk so far goes with it (the AI's question included, so a choice answers it).
    const history = historyOf(model.turns);
    model = { ...model, turns: [...model.turns, { who: 'you', text: t }], live: null };
    input.value = '';
    render();
    o.send(t, history);
  }

  function render() {
    const moving = !!o.move?.on();
    // Moving: no veil (the objects are what the person looks at, and the presses go to them) and the card in the
    // talk's place. The talk is kept as it was for "Chat".
    veil.hidden = !open || moving;
    panel.hidden = !open;
    panel.classList.toggle('moving', moving);
    if (!open) return;
    // Words only: a 12 px ❚❚ before "Paused" read as a stray mark (design pass, 2026-10-22).
    head.textContent = w('paused');
    // Moving: the line under "Paused" says what to do (the card says what happened to the picked one).
    seesEl.textContent = moving ? w('movePick') : sees;
    talk.hidden = moving;
    form.hidden = moving;
    if (o.move) o.move.card.hidden = !moving;
    if (moveBtn) {
      moveBtn.replaceChildren();
      const ic = el('span', 'ic');
      ic.append(icon(moving ? 'spark' : 'move'));
      moveBtn.append(ic, o.doc.createTextNode(moving ? w('talk') : w('move')));
      moveBtn.title = moving ? w('talkTip') : w('moveTip');
      moveBtn.setAttribute('aria-pressed', String(moving));
      // Nothing to move with (no adapter found for this game): no button that would do nothing.
      moveBtn.hidden = !moving && !o.move .can();
    }
    resumeBtn.replaceChildren(o.doc.createTextNode(w('resume')), el('span', 'k', 'P'));
    resumeBtn.title = w('resumeTip');
    input.placeholder = sending ? w('sending') : sendFailed ? w('sendFail') : w('chatPlaceholder');
    input.disabled = sending;
    sendBtn.disabled = sending || !input.value.trim();
    sendBtn.setAttribute('aria-label', w('send'));
    talk.replaceChildren();
    if (!model.turns.length) talk.append(el('div', 'empty', w('chatEmpty')));
    model.turns.forEach((t, i) => {
      if (t.who === 'you') {
        talk.append(el('div', 'you', t.text));
        return;
      }
      const row = el('div', `ai${t.state === 'failed' ? ' failed' : ''}`);
      row.dataset.part = 'pause-reply';
      const body = el('div', 'body');
      body.append(el('div', 'said', t.text));
      const last = i === model.turns.length - 1;
      const acts = el('div', 'acts');
      // Choices answer only the question still open (the last turn): an old question's buttons would answer nothing.
      if (last && t.state === 'asking' && t.choices) {
        t.choices.forEach((c, n) => {
          const b = el('button', n === 0 ? 'b primary' : 'b', c)                     ;
          b.type = 'button';
          b.addEventListener('click', () => submit(c));
          acts.append(b);
        });
      }
      if (last && t.reload) {
        const b = el('button', 'b primary', w('reload'))                     ;
        b.type = 'button';
        b.dataset.action = 'pause-reload';
        b.title = w('reloadTip');
        b.addEventListener('click', () => o.reload());
        acts.append(b);
      }
      if (acts.childNodes.length) body.append(acts);
      // "More in Claude": words, not a button (a web page cannot bring the AI's window forward), as the line's.
      if (last && t.more) body.append(el('div', 'more', t.more));
      row.append(el('span', 'dot'), body);
      talk.append(row);
    });
    const live = model.live;
    if (live && (live.state === 'looking' || live.state === 'fixing' || live.state === 'kept')) {
      const row = el('div', 'live');
      row.dataset.part = 'pause-live';
      row.append(el('span', 'dot'), el('span', '', live.text));
      talk.append(row);
    }
    talk.scrollTop = talk.scrollHeight;
  }

  return {
    parts: [veil, panel],
    input,
    get isOpen() {
      return open;
    },
    get busy() {
      return sending;
    },
    open(s, draft) {
      // A new pause is a new moment, so a new talk (showing the last one is for a later stage).
      model = { turns: [], awaiting: false, live: null };
      sending = false;
      sendFailed = false;
      sees = s;
      open = true;
      input.value = draft || '';
      render();
      input.focus({ preventScroll: true });
    },
    close() {
      open = false;
      input.blur();
      render();
    },
    line(s) {
      model = chatOnLine(model, s);
      render();
    },
    sent(ok) {
      sending = false;
      if (ok) model = { ...model, awaiting: true };
      else {
        // Not kept: the words go back in the field to send again.
        sendFailed = true;
        const last = model.turns[model.turns.length - 1];
        if (last && last.who === 'you') {
          input.value = last.text;
          model = { ...model, turns: model.turns.slice(0, -1) };
        }
      }
      render();
      if (open) input.focus({ preventScroll: true });
    },
    render,
  };
}

__def(__exports, "HISTORY_MAX", () => HISTORY_MAX);
__def(__exports, "historyOf", () => historyOf);
__def(__exports, "chatOnLine", () => chatOnLine);
__def(__exports, "CHAT_CSS", () => CHAT_CSS);
__def(__exports, "createChat", () => createChat);
};
__defs[48] = function (__exports) {
'use strict';
// play-move.ts

// Move things where the game stopped (pause stage 2, 2026-10-22: "stop in the middle of the game and move things").
//
// The person paused ▶ Play (play-pause.ts) and pressed "Move" in the pause panel (or M). The editor's own editor
// (editor.ts, the one Edit uses) wakes up INSIDE the paused game page: the same pick, the same orange outline, the same
// strip under the object (move · height · turn · size), the same snap onto surfaces. Everything stays where it was at
// the pause — the camera too: the view is the player's, not the edit camera (EditorDeps.paused).
//
// What happens after (design.md §5):
//   - Resume: the game goes on from where things now stand (the objects themselves were moved; nothing to apply).
//   - "Put in layout": that object's place goes to the editor as a move made in Edit would (studio:placement/moved,
//     with `end` and `from`) — an unsaved change like any other: Save · N counts it, the draft carries it, ▶ Play asks
//     "Save and play / Try without saving" about it next time, and Edit shows it. Nothing else does that: a place not
//     put in the layout lives only in this play ("Only in this play") and is gone when the game opens again.
//   - What the game moves itself — an enemy, a bullet, a boat the game sails, a motion given in Edit — says "Just for
//     this moment" and has no "Put in layout": its place now is a point in the middle of a run, and kept, the next
//     start would put it there (and the game would move it away again at once). Found by comparing where each object
//     is at the pause with where it was when Play started (or where the person last left it): anything that moved by
//     itself in between, anything the game made since (not there at the start), and anything the draft's motions move.
//   - "Put back": where it was at the pause.
//
// WHY not the editor page's own Edit mode (send the shell to Edit): Edit opens a new game page — the moment (the enemy
// mid-jump, the ball in the air) would be gone, which is the whole point of pausing. And the game can be full screen,
// where only its own page shows: so the card lives in the pause panel, in the game page, like the chat.
//
// WHY nothing of the editor's chatter reaches the editor page: its messages are Edit's (core/ready says "editing",
// view-state would replace the edit camera kept for Edit, core/key would run the editor's shortcuts — P there is ▶
// Play). Only "Put in layout" goes out, as the one message Edit itself sends for a move.
                                                                                                                       
const { UI } = __require(13);
                                             
                                                    
const { createEditor } = __require(42);
const { drivenBetween } = __require(34);
const { nativeSetTimeout } = __require(0);

/** One pose as observe.ts compares them (it reads only key and pose). */
const one = (key        , pose      ) => [{ key, pose }                   ];

/** Why an object can only be moved for this moment (null = it can go in the layout). */
                                                         

/**
 * The pure part (test/pause.test.ts): can this object's place go in the layout? `start` = the poses when Play started
 * (after the editor's draft was shown), `mine` = where the person left objects in an earlier pause of this play (the
 * game did not move those: the person did), `moving` = the keys the draft's motions move, `now` = its pose at the pause.
 */
function momentWhy(key        , now      , start                   , mine                   , moving             , dim             )            {
  if (moving.has(key)) return 'motion';
  const was = mine.get(key) ?? start.get(key);
  if (!was) return 'new';
  return drivenBetween(one(key, was), one(key, now), dim).size ? 'game' : null;
}

/** Two poses the same, as the editor counts it (observe.ts' smallest change). */
function samePose(a                  , b                  , dim             )          {
  if (!a || !b) return a === b;
  return !drivenBetween(one('k', a), one('k', b), dim).size;
}

/** "X 8.5 · Y 0.0 · Z 9.6" (3D, metres) / "X 120 · Y 40" (2D, px): the card's numbers, as Edit's card rounds them. */
function poseWords(p      , dim             )         {
  // `+ 0` after rounding: no "-0.0" for a height a hair under the ground.
  const n = (v                    ) => (dim === '3d' ? (Math.round((v ?? 0) * 10) / 10 + 0).toFixed(1) : String(Math.round(v ?? 0) + 0));
  return dim === '3d' ? `X ${n(p.p[0])} · Y ${n(p.p[1])} · Z ${n(p.p[2])}` : `X ${n(p.p[0])} · Y ${n(p.p[1])}`;
}

const MOVE_CSS = `
.chat .card { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 8px; }
.chat .card .name { font-weight: 600; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat .card .nums { color: rgba(255,255,255,.55); font: 500 12px/1.3 ui-monospace, SFMono-Regular, Menlo, monospace; }
.chat .card .why { color: rgba(255,255,255,.7); line-height: 1.45; }
.chat .card .why b { font-weight: 600; color: #f4f4f6; }
.chat .card .acts { display: flex; gap: 6px; flex-wrap: wrap; }
.chat .card .hint { color: rgba(255,255,255,.55); font-size: 12px; line-height: 1.45; }
/* "Put in layout" is the person's own hand (orange, as Edit's outline and Save), not the AI's violet. */
.chat .card button.b.keep { background: #ff6b1a; color: #fff; }
.chat .card button.b.keep:hover { background: #ff7d36; }
button.b.on { background: rgba(255,255,255,.22); }
button.b .ic { display: inline-grid; vertical-align: -2px; margin-right: 6px; }
button.b .ic svg { width: 14px; height: 14px; }
`;

                                  
                                  
             
                     
                                                                                   
                                      
                                                                                                      
                              
                                                             
                                   
                                                                                                              
                           
                   
                                  
                         
                                                                      
                                  
                                                                     
                                
                                                
                      
 

                           
                                                     
                       
                                 
                             
                                                                                                
                    
                                                                                               
                   
                                                                     
               
                                                                                              
                  
                                   
                 
     
                                                                                                                    
                                                                                                                      
                                                                                                                
     
                                             
 

function createPlayMove(o                 )           {
  const { win, el, w } = o;
  let editor                = null;
  let editorOf                       = null;
  let on = false;
  // Play's start, the person's own places, and the motions (see momentWhy).
  let start                           = null;
  const mine = new Map              ();
  let moving = new Set        ();
  // This pause: each object's pose at the pause and why it is "this moment only" (computed once per pause, before any
  // drag), the objects moved since, and what went in the layout (its pose then).
  let atPause                           = null;
  let why = new Map                   ();
  const kept = new Map              ();
  let pick                = null;
  const items = new Map              ();
  let insetSig = '';

  const list = (a               )         => {
    try {
      return a.list();
    } catch {
      return [];
    }
  };
  // Where everything was when Play started: once the draft is shown and the game lists its objects (looked for every
  // 150 ms for up to ~30 s after the first frame: a big scene on a slow machine lists late — Lantern Cove in the
  // headless test's software GL took more than the 5 s showFileEditsInPlay waits). A pause before that takes the
  // pause's own list.
  // `run`: which Play this is (▶ Play in the same page, fast switch 2026-10-22: each Play of an edit page starts these
  // again, restart() below); a look still going from an earlier Play stops.
  let run = 0;
  const findStart = (arranged                   ) => {
    const mine0 = ++run;
    void arranged.then(async (keys) => {
      if (mine0 !== run) return;
      moving = new Set(keys);
      await o.core.time.firstFrame();
      for (let i = 0; i < 200 && !start && !atPause && mine0 === run; i++) {
        const a = o.adapter();
        const l = a ? list(a) : [];
        if (l.length) {
          if (!atPause) start = new Map(l.map((it) => [it.key, it.pose]         ));
          return;
        }
        await new Promise((r) => nativeSetTimeout(r, 150));
      }
    }).catch(() => {});
  };
  findStart(o.arranged);

  const card = el('div', 'card');
  card.dataset.part = 'pause-move-card';

  const dimOf = () => editorOf?.dim ?? '3d';
  const poseNow = (key        )                   => {
    const a = editor?.driven;
    if (!a) return undefined;
    return list(a).find((i) => i.key === key)?.pose;
  };

  /** The editor's messages: the card follows the pick and the moves; nothing goes to the editor page. */
  const fromEditor = (m               ) => {
    if (m.type === 'studio:placement/selected') {
      pick = m.key;
      if (m.item) items.set(m.item.key, m.item);
      draw();
    } else if (m.type === 'studio:placement/items') {
      for (const it of m.items) items.set(it.key, it);
    } else if (m.type === 'studio:placement/moved') {
      if (m.key === pick) draw();
    } else if (m.type === 'studio:placement/moved-group') {
      if (m.poses.some((p) => p.key === pick)) draw();
    }
  };

  const tell = (m               ) => editor?.handle(m);

  /** What the panel covers, so the strip and the camera-height buttons stay clear of it (Edit's core/ui inset). */
  const sendInset = () => {
    const p = o.panel();
    if (!p || !on) return;
    const r = p.getBoundingClientRect();
    const W = win.innerWidth, H = win.innerHeight;
    // A sheet across the foot (narrow screens) covers the bottom; the card at the top right covers the right.
    const inset        = r.width > W * 0.7 ? { top: 0, right: 0, bottom: Math.max(0, Math.round(H - r.top)), left: 0 } : { top: 0, right: Math.max(0, Math.round(W - r.left)), bottom: 0, left: 0 };
    const sig = JSON.stringify(inset);
    if (sig === insetSig) return;
    insetSig = sig;
    tell({ type: 'studio:core/ui', handlePx: o.handlePx(), theme: 'dark', inset });
  };

  function button(cls        , text        , tip        , action        , fn            ) {
    const b = el('button', `b ${cls}`.trim(), text)                     ;
    b.type = 'button';
    b.title = tip;
    b.dataset.action = action;
    b.addEventListener('click', (e) => {
      fn();
      // Pressed with the mouse or a finger: the keys go back to the game page (the editor's M / T / arrows), not to the
      // panel. From the keyboard (Enter on it: detail 0) the focus stays.
      if (e.detail > 0) b.blur();
    });
    return b;
  }

  function putInLayout(key        ) {
    const pose = poseNow(key);
    if (!pose) return;
    // `from`: where the editor page has it now (what Undo in Edit goes back to) — the last place put in the layout in
    // this play, else Play's start (the draft and the code, as the game opened).
    const from = kept.get(key) ?? start?.get(key) ?? atPause?.get(key);
    o.post({ type: 'studio:placement/moved', key, pose, end: true, ...(from ? { from } : {}) });
    kept.set(key, pose);
    draw();
  }
  function putBack(key        ) {
    const to = atPause?.get(key);
    if (!to) return;
    tell({ type: 'studio:placement/pose', key, pose: to });
    // Put in the layout during this pause: the layout goes back with it (to the editor page, one more move — its Undo
    // in Edit steps through both).
    const k = kept.get(key);
    if (k && !samePose(k, to, dimOf())) {
      o.post({ type: 'studio:placement/moved', key, pose: to, end: true, from: k });
      kept.delete(key);
    }
    draw();
  }

  function draw() {
    card.replaceChildren();
    if (!on) return;
    const key = pick;
    if (!key) {
      card.append(el('div', 'hint', w('moveHow')));
      done();
      return;
    }
    const it = items.get(key);
    const pose = poseNow(key) ?? it?.pose;
    const dim = dimOf();
    card.append(el('div', 'name', it?.label || key));
    if (pose) card.append(el('div', 'nums', poseWords(pose, dim)));
    const moved = !!pose && !samePose(pose, atPause?.get(key), dim);
    const acts = el('div', 'acts');
    const reason = why.get(key) ?? null;
    if (reason) {
      const p = el('div', 'why');
      p.dataset.part = 'pause-move-moment';
      p.append(el('b', '', w('moveMoment')), o.win.document.createTextNode(' · ' + w('moveMomentWhy')));
      card.append(p);
    } else {
      const inLayout = !!pose && kept.has(key) && samePose(kept.get(key), pose, dim);
      if (inLayout) {
        const p = el('div', 'why', w('moveIn'));
        p.dataset.part = 'pause-move-in';
        card.append(p);
      } else if (moved) {
        const p = el('div', 'why', w('moveOnly'));
        p.dataset.part = 'pause-move-only';
        card.append(p);
        acts.append(button('keep', w('toLayout'), w('toLayoutTip'), 'pause-to-layout', () => putInLayout(key)));
      } else card.append(el('div', 'hint', w('moveHow')));
    }
    if (moved) acts.append(button('', w('putBack'), w('putBackTip'), 'pause-put-back', () => putBack(key)));
    if (acts.childNodes.length) card.append(acts);
    done();
  }
  /** The panel drawn with the new card, then what it covers now (a phone's sheet grows with the card: the strip under
   * the pick must stay above it — measured before the card was drawn, the strip sat under the sheet's top). */
  function done() {
    o.changed();
    sendInset();
  }

  return {
    get on() {
      return on;
    },
    card,
    picked: () => !!pick,
    start() {
      if (on) return true;
      const a = o.adapter();
      if (!a) return false;
      if (!editor || editorOf !== a) {
        editorOf = a;
        // The world only: the game's HTML UI is not moved from a pause (it is laid out by the page, not by a moment).
        editor = createEditor({ adapter: a, ui: null, core: o.core, win, post: fromEditor, rules: o.rules, tools: [], paused: true, ignore: o.ignore });
        // For tests (test/studio-pause.browser.mjs), like `_debug` in Edit and `_play`: where an object is on screen,
        // what is right under a point, and why it is "this moment only". Not enumerable, nothing else uses it.
        const api = (win                                        ).__gameStudio;
        const ed = editor;
        if (api && !Object.prototype.hasOwnProperty.call(api, '_move')) {
          Object.defineProperty(api, '_move', {
            value: Object.freeze({
              anchor: (k        ) => ed.driven.anchor(k),
              // `r`: the pick's own slack (UI.pickRadiusMouse / Touch) to ask what a press there picks; 0 = right under it.
              under: (x        , y        , r = 0) => { try { return ed.driven.pickNear(x, y, r)[0] ?? null; } catch { return null; } },
              list: () => list(ed.driven),
              why: (k        ) => why.get(k) ?? null,
            }),
            enumerable: false,
          });
        }
      }
      // Once per pause, before any drag: each object's pose now, and which ones the game moves itself.
      if (!atPause) {
        const now = list(a);
        atPause = new Map(now.map((i) => [i.key, i.pose]         ));
        if (!start) start = new Map(atPause);
        why = new Map(now.map((i) => [i.key, momentWhy(i.key, i.pose, start , mine, moving, a.dim)]         ));
      }
      on = true;
      insetSig = '';
      tell({ type: 'studio:core/lang', lang: o.lang() });
      tell({ type: 'studio:core/config', config: o.config() });
      tell({ type: 'studio:core/edit', on: true });
      sendInset();
      draw();
      return true;
    },
    stop() {
      if (!on) return;
      tell({ type: 'studio:placement/select', key: null });
      tell({ type: 'studio:core/edit', on: false });
      on = false;
      pick = null;
      draw();
    },
    resumed() {
      // What the person moved stays theirs: the next pause does not take it for the game's own motion.
      if (atPause && editorOf) {
        for (const it of list(editorOf)) {
          const was = atPause.get(it.key);
          if (why.get(it.key) || !was || samePose(was, it.pose, editorOf.dim)) continue;
          mine.set(it.key, it.pose);
        }
      }
      atPause = null;
      why = new Map();
    },
    render: () => draw(),
    restart(arranged) {
      start = null;
      mine.clear();
      kept.clear();
      moving = new Set();
      atPause = null;
      why = new Map();
      pick = null;
      findStart(arranged);
    },
  };
}

/** The strip's button size when the editor page did not say (play/on handlePx): Edit's, bigger for a finger. */
function defaultHandlePx(win        )         {
  return win.matchMedia && win.matchMedia('(pointer: coarse)').matches ? UI.handlePxPhone : UI.handlePx;
}

__def(__exports, "momentWhy", () => momentWhy);
__def(__exports, "samePose", () => samePose);
__def(__exports, "poseWords", () => poseWords);
__def(__exports, "MOVE_CSS", () => MOVE_CSS);
__def(__exports, "createPlayMove", () => createPlayMove);
__def(__exports, "defaultHandlePx", () => defaultHandlePx);
};
__defs[49] = function (__exports) {
'use strict';
// play-ask.ts

// Ask your AI while you play (CONTRACT.md §3.5, 2026-10-20: "develop while you play, full screen").
//
// The person is in ▶ Play, something goes wrong ("the character vanished when I stopped here"), and they press ` (or
// the small mark in the corner), type it and press Enter. The game does not stop: the field sits over it, takes the
// keys only while it has focus, and closes on Enter. What came with the words is the MOMENT, gathered here in the
// game page because only the page has it: a picture of the game, where the player's camera was, what was near it,
// and the console (errors, warnings, the last lines). The editor page keeps it as a "play" request and the AI's
// progress comes back as one small line at the top ("Your AI is looking" → "Fixing it" → "Fixed · Reload").
//
// WHY in the game page and not the editor page: full screen. A game that goes full screen (its own button, F11 does
// not count) shows only its own page, so anything drawn by the editor around the frame is gone. The overlay is a
// popover (the browser's top layer), shown again whenever full screen changes, so it draws over a full-screen canvas
// too. It lives in a shadow root so the game's CSS cannot reach it and its CSS cannot reach the game.
//
// WHY ` (the backquote): it is the "console" key of PC games — the key players already press to talk to the game's
// makers — and almost no game uses it for play (WASD, arrows, Space, Enter, Shift, E, R, Q, Tab, Esc and the numbers
// all are; "/" opens chat in many). Enter, R or a letter would fight the game. On a Japanese keyboard ` is Shift+@;
// the corner mark is there for every keyboard and for touch.
//
// Nothing here runs unless the editor says an AI can get the request (play/on): the offline web demo shows nothing.
                                                                                                                                         
const { isStudioMessage } = __require(13);
const { LINE_FADE_MS, LINE_GRACE_MS, lineStayMs } = __require(43);
const { icon } = __require(44);
const { shootPage } = __require(45);
const { createPauseHold, isPauseKey } = __require(46);
const { CHAT_CSS, createChat } = __require(47);
const { createPlayMove, defaultHandlePx, MOVE_CSS } = __require(48);
                                             
                                                    
const { nativeSetTimeout, nativeClearTimeout } = __require(0);

                                 
                                  
                       
                                                                                                         
                               
                                                                                                              
                     
                                                                                                                  
                                                                         
     
                                                                                                                        
                                                                                                                         
     
                    
 

/** What play-switch.ts needs of this module in an edit page. */
                                
                                                                                                                                      
                                  
                                                                                                                    
                                          
                                                                                                                       
                
 

// ---------------------------------------------------------------------------
// The console, kept from the first line (pure parts exported for test/play-ask.test.ts)
// ---------------------------------------------------------------------------

                           
                          
               
                              
            
 

/** How many lines of each kind go with a request: every error / warning there is room for, plus the last few lines. */
const LOG_ERRORS = 20;
const LOG_TAIL = 10;
const LOG_KEEP = 200;

/**
 * Below this width the field says it short ("Tell your AI what’s wrong"): the full sentence ("What went wrong? Your AI
 * sees this moment.") was cut to "…sees this momen" on a 390 px phone (Ive review 3, ④, 2026-10-20). The same width as
 * the CSS below that hides the field's hint.
 */
const NARROW_PX = 520;

/** One console call as one line: strings as they are, errors by their message (first line of the stack), objects as JSON. */
function logText(args           )         {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return a.stack ? a.stack.split('\n').slice(0, 2).join(' ') : `${a.name}: ${a.message}`;
    try {
      const s = JSON.stringify(a);
      return s === undefined ? String(a) : s;
    } catch {
      return String(a);
    }
  }).join(' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

/**
 * What of the console goes with a request: the last LOG_ERRORS errors and warnings and the last LOG_TAIL lines of any
 * kind, oldest first, each with how long before the request it was written. A game that logs every frame would
 * otherwise push the one error that matters out of the picture.
 */
function pickLogs(all            , now        )            {
  const keep = new Set          ();
  const bad = all.filter((e) => e.level !== 'log');
  for (const e of bad.slice(-LOG_ERRORS)) keep.add(e);
  for (const e of all.slice(-LOG_TAIL)) keep.add(e);
  return all.filter((e) => keep.has(e)).map((e) => ({ level: e.level, text: e.text, ago: Math.max(0, Math.round((now - e.t) / 100) / 10) }));
}

/**
 * Is this key press "ask my AI"? The backquote with no modifier (Shift allowed: it IS the backquote on a Japanese
 * keyboard), never while the game's own text field has focus (a chat box, a name entry).
 */
function isAskKey(e                                                                                                , typing         )          {
  if (typing || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
  // By the character, not the physical key: on a US keyboard that is the key left of 1, on a Japanese one Shift+@
  // (whose physical "Backquote" key is the half-width / full-width key there, and Shift+` on a US keyboard is ~).
  return e.key === '`';
}

/**
 * 2D: what is on screen, nearest the middle first (`screen` 0–1 in the page). The player is usually there in a game
 * that follows them; in one that does not, these are still the things in the picture.
 */
function near2D(items                                                                 , centerOf                                          , w        , h        , max = 12)             {
  const out                                  = [];
  for (const it of items) {
    const c = centerOf(it.key);
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || c[0] < 0 || c[1] < 0 || c[0] > w || c[1] > h) continue;
    const e                           = { key: it.key, screen: [c[0] / w, c[1] / h], m: Math.hypot(c[0] - w / 2, c[1] - h / 2) };
    if (it.label) e.label = it.label;
    if (it.pose) e.pose = it.pose;
    out.push(e);
  }
  out.sort((a, b) => a.m - b.m);
  return out.slice(0, max).map(({ m: _m, ...e }) => e);
}

// ---------------------------------------------------------------------------
// The picture (play-shot.ts: a screenshot — the canvases and the HTML UI over them)
// ---------------------------------------------------------------------------

/**
 * A WebGL canvas forgets its picture right after each frame is shown, so reading it later (when Enter is pressed)
 * gives black. Asking for `preserveDrawingBuffer` keeps the last frame readable. Only in ▶ Play inside the editor
 * (this module never runs elsewhere), where a picture is worth the small cost (the first try left the engine's own
 * `false` alone and every three.js picture came out black, 2026-10-20).
 */
function keepWebGLPictures(win                            ) {
  const proto = win.HTMLCanvasElement && win.HTMLCanvasElement.prototype;
  if (!proto || (proto.getContext                              ).__studioPlay) return;
  const orig = proto.getContext;
  const wrapped = function (                         type        , attrs                          ) {
    if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
      // Always on: three.js (and most engines) pass `preserveDrawingBuffer: false` explicitly, as their default.
      attrs = { ...(attrs || {}), preserveDrawingBuffer: true };
    }
    return (orig                                                       ).call(this, type, attrs);
  }                                                        ;
  wrapped.__studioPlay = true;
  proto.getContext = wrapped;
}

// ---------------------------------------------------------------------------
// The overlay
// ---------------------------------------------------------------------------

// Violet is the AI's colour everywhere in the editor (#8b7cff, CONTRACT.md §2); nothing else here is coloured.
const CSS = `
:host { all: initial; }
.wrap { position: fixed; inset: 0; pointer-events: none; font: 500 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #f4f4f6; -webkit-font-smoothing: antialiased; }
.glass { background: rgba(18, 18, 24, .84); -webkit-backdrop-filter: blur(14px) saturate(1.2); backdrop-filter: blur(14px) saturate(1.2);
  border: 1px solid rgba(255,255,255,.10); box-shadow: 0 8px 30px rgba(0,0,0,.35); }
.mark { position: absolute; right: 14px; bottom: 14px; pointer-events: auto; display: flex; align-items: center; gap: 8px;
  height: 32px; padding: 0 12px 0 10px; border-radius: 16px; cursor: pointer; color: inherit; font: inherit;
  transition: opacity .3s, padding .3s; opacity: .92; }
.mark:hover { opacity: 1; }
.mark .word { white-space: nowrap; }
.mark.small .word { display: none; }
.mark.small { padding: 0 10px; }
/* After its first 5 s the mark is only ✦ and \`; the pointer on it says what it is again: "Ask your AI \`" (Ive review
   3, ④: the bare mark said nothing until pressed). No title tooltip on top of it (the words ARE the tooltip). */
.mark.small:hover .word, .mark.small:focus-visible .word { display: inline; }
.mark.small:hover, .mark.small:focus-visible { padding: 0 12px 0 10px; }
kbd { font: 600 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace; padding: 3px 6px; border-radius: 5px;
  background: rgba(255,255,255,.12); color: #f4f4f6; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: #8b7cff; flex: none; box-shadow: 0 0 0 3px rgba(139,124,255,.22); }
.busy .dot { animation: pulse 1.1s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(139,124,255,.0); opacity: .55; } }
/* The way in (the corner mark and the field) carries the editor's ask mark, ✦ (shell/icons.ts 'spark', the same as the
   editor's "Ask your AI…" field: one sign for "ask your AI" everywhere — Ive review 3, ④). The violet glow the dot had
   stays, as a soft light round the spark. The line at the top keeps the dot: it is the AI's state, as "● AI" is. */
.spark { width: 14px; height: 14px; flex: none; color: #8b7cff; display: grid; filter: drop-shadow(0 0 3px rgba(139,124,255,.55)); }
.spark svg { width: 14px; height: 14px; stroke-width: 1.5px; }
.busy .spark { animation: glow 1.1s ease-in-out infinite; }
@keyframes glow { 50% { filter: drop-shadow(0 0 0 rgba(139,124,255,0)); opacity: .55; } }
.bar { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); width: min(560px, calc(100% - 32px));
  pointer-events: auto; border-radius: 14px; padding: 8px 8px 8px 14px; display: flex; align-items: center; gap: 10px;
  border-color: rgba(139,124,255,.55); box-shadow: 0 0 0 3px rgba(139,124,255,.18), 0 10px 34px rgba(0,0,0,.4); }
.bar input { all: unset; flex: 1; min-width: 0; font: 500 15px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; padding: 6px 0; }
.bar input::placeholder { color: rgba(255,255,255,.5); }
.bar .hint { color: rgba(255,255,255,.55); font-size: 12px; white-space: nowrap; }
button.b { all: unset; cursor: pointer; pointer-events: auto; padding: 6px 11px; border-radius: 9px; font-weight: 600; white-space: nowrap;
  background: rgba(255,255,255,.10); color: #f4f4f6; }
button.b:hover { background: rgba(255,255,255,.18); }
button.b.primary { background: #8b7cff; color: #fff; }
button.b.primary:hover { background: #9a8dff; }
button.b:focus-visible, .mark:focus-visible { outline: 2px solid #8b7cff; outline-offset: 2px; }
.line { position: absolute; left: 50%; top: 14px; transform: translateX(-50%); max-width: calc(100% - 32px); pointer-events: auto;
  border-radius: 14px; padding: 8px 10px 8px 14px; display: flex; align-items: center; gap: 10px; }
.line .say { display: flex; flex-direction: column; min-width: 0; }
.line .head { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.line .sub { color: rgba(255,255,255,.55); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* "More in Claude" at the end of the small row (2026-10-21, as the editor's line, shell.css .has-more): it never shrinks;
   what was asked is the part cut with "…", so the row stays one line on a phone and in the side window too. */
.line .sub.has-more { display: flex; gap: 6px; min-width: 0; }
.line .sub.has-more > .said { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.line .sub.has-more > .sep, .line .sub.has-more > .more { flex: none; }
.line .acts { display: flex; gap: 6px; flex: none; }
.x { all: unset; cursor: pointer; width: 22px; height: 22px; display: grid; place-items: center; border-radius: 6px; color: rgba(255,255,255,.6); font-size: 15px; }
.x:hover { background: rgba(255,255,255,.12); color: #fff; }
.choices { display: flex; gap: 6px; flex-wrap: wrap; }
/* "Fixed" goes by itself after it was read (line-fade.ts, 2026-10-20); the corner mark's dot keeps a stronger ring while
   the fix waits for Reload (\` or the mark, then Enter). */
.line { transition: opacity .4s cubic-bezier(.2,.8,.2,1), transform .4s cubic-bezier(.2,.8,.2,1); }
.line.fading { opacity: 0; transform: translateX(-50%) translateY(-4px); }
.mark.ready .spark { filter: drop-shadow(0 0 2px #8b7cff) drop-shadow(0 0 6px rgba(139,124,255,.8)); }
[hidden] { display: none !important; }
@media (max-width: 520px) {
  .line { top: 10px; padding: 7px 8px 7px 12px; }
  .bar { bottom: 12px; }
  .bar .hint { display: none; }
}
/* Touch: no key to show, and a mark a finger can hit (44 px, UI.handlePxPhone). */
@media (pointer: coarse) {
  kbd { display: none; }
  .mark { height: 44px; border-radius: 22px; padding: 0 16px 0 14px; }
  .mark.small { padding: 0 17px; }
}
@media (prefers-reduced-motion: reduce) { .busy .dot, .busy .spark { animation: none; } .line { transition: none; } }
/* The corner (pause, 2026-10-22): ❚❚ left of the mark, the same glass and height. The two sit in one row at the corner
   so the button follows the mark when it grows (hover) or shrinks (after 5 s). */
.corner { position: absolute; right: 14px; bottom: 14px; display: flex; align-items: center; gap: 8px; pointer-events: none; }
.corner .mark { position: static; }
` + CHAT_CSS + MOVE_CSS;

                                    

function startPlayAsk(o                )                {
  const { win, parentOrigin } = o;
  // Play in the same page (fast switch): false while the edit page is in Edit (see PlayAskOptions.standby).
  let awake = !o.standby;
  let arranged = o.move?.arranged ?? Promise.resolve([]            );
  const doc = win.document;
  keepWebGLPictures(win);
  // Made now, before the game's code: it keeps the AudioContexts the game makes so a pause can quiet them.
  const hold                   = o.pause ? createPauseHold(win, o.pause) : null;

  // ----- the console, from the first line the game writes -----
  const logs             = [];
  const keepLog = (level                   , args           ) => {
    const text = logText(args);
    if (!text || text.startsWith('[studio]')) return; // the editor's own lines are not the game's
    logs.push({ level, text, t: win.performance.now() });
    if (logs.length > LOG_KEEP) logs.splice(0, logs.length - LOG_KEEP);
  };
  const con = win.console                                                        ;
  for (const [name, level] of [['error', 'error'], ['warn', 'warn'], ['log', 'log'], ['info', 'log']]         ) {
    const orig = con[name];
    if (typeof orig !== 'function') continue;
    con[name] = function (...args           ) {
      try {
        keepLog(level, args);
      } catch {
        /* never break the game's logging */
      }
      return orig.apply(this, args);
    };
  }
  win.addEventListener('error', (e            ) => {
    if (!e.message) return;
    const file = e.filename ? e.filename.split(/[?#]/)[0] .split('/').pop() : '';
    keepLog('error', [`${e.message}${file ? ` (${file}${e.lineno ? ':' + e.lineno : ''})` : ''}`]);
  });
  win.addEventListener('unhandledrejection', (e                       ) => {
    const r = e.reason                                    ;
    keepLog('error', ['Unhandled rejection: ' + (r && typeof r.message === 'string' ? r.message : String(e.reason))]);
  });

  const post = (m               ) => {
    try {
      win.parent.postMessage(m, parentOrigin);
    } catch {
      /* parent gone */
    }
  };

  // ----- the overlay, built when the editor says an AI can get the request -----
  let words               = null;
  let host                     = null;
  let root                    = null;
  let mark                   , bar             , input                  , hint             , line             ;
  // Pause (2026-10-22): the corner's ❚❚, the chat over the paused game, and what the first message of a pause carries.
  let pauseBtn                           = null;
  let chat              = null;
  // Stage 2: moving things while paused (the editor in the paused page, its card in the panel), and what play/on gave it.
  let move                  = null;
  let moveConfig                    = null;
  let moveHandlePx = 0;
  let lang              = 'en';
  let pausedMoment                       = null;
  let chatId = '';
  // Which field is waiting for play/sent: the ✦ field's, or the chat's.
  let sentTo                 = 'bar';
  let state                  = null;
  let barOpen = false;
  let sending = false;
  let sendFailed = false;
  let dismissed = '';
  // Does this page draw the corner mark? The editor says (play/on `mark`): on a phone the way in is its ✦ in the top bar,
  // left of Edit, because the corner sat on the game's own words at the foot ("WASD works too", Ive review 3, ④). In
  // full screen the editor's bar is gone, so the mark comes back here whatever the editor said.
  let markOn = true;
  // "Fixed" fades by itself like the editor's finished line (line-fade.ts): `fadeSig` is the line whose timer runs; when
  // it is due the line goes the way × goes (`dismissed`). Not "failed" / "asking" / "kept": those need the person.
  let fadeSig = '';
  let fadeTimer = 0;
  let leftAt = 0;
  // The corner mark's words shrink after 5 s (build, and again after each reshow).
  let smallTimer = 0;
  const w = (k        ) => (words && words[k]) || '';
  const spark = () => {
    const s = el('span', 'spark');
    s.append(icon('spark'));
    return s;
  };

  const el =                                        (tag   , cls        , text         ) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  /** Over everything, full screen too: the top layer. Shown again after each full-screen change so it is on top. */
  const lift = () => {
    if (!host || !awake) return;
    const p = host                                                                        ;
    if (typeof p.showPopover === 'function') {
      try {
        if (host.matches(':popover-open')) p.hidePopover ();
        p.showPopover();
        return;
      } catch {
        /* not in the document yet, or popovers off */
      }
    }
    // No popover support: inside the full-screen element when it can hold children (a canvas cannot).
    const fs = doc.fullscreenElement;
    const into = fs && fs.tagName !== 'CANVAS' && fs.tagName !== 'VIDEO' ? fs : doc.body || doc.documentElement;
    if (host.parentNode !== into) into.appendChild(host);
  };

  function build() {
    if (host) return;
    host = doc.createElement('game-studio-play');
    host.setAttribute('popover', 'manual');
    // Kept when an adapter hides the game's own HUD for editing (three.js hideOverlays, data-studio-keep): moving things
    // while paused (play-move.ts) wakes the editor, and this overlay holds its panel.
    host.setAttribute('data-studio-keep', '');
    // The popover's own box: invisible and click-through; only the parts inside take the pointer.
    host.style.cssText = 'all:initial;position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    const style = el('style', '');
    style.textContent = CSS;
    const wrap = el('div', 'wrap');
    mark = el('button', 'mark glass')                     ;
    mark.type = 'button';
    mark.dataset.part = 'play-ask-mark';
    mark.append(spark(), el('span', 'word', w('ask')), el('kbd', '', '`'));
    mark.setAttribute('aria-label', w('askTip'));
    mark.addEventListener('click', () => openBar());
    bar = el('div', 'bar glass');
    bar.dataset.part = 'play-ask-bar';
    bar.hidden = true;
    input = el('input', '')                    ;
    input.type = 'text';
    input.maxLength = 500;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('enterkeyhint', 'send');
    hint = el('span', 'hint');
    const close = el('button', 'x', '×')                     ;
    close.type = 'button';
    close.title = w('close');
    close.setAttribute('aria-label', w('close'));
    close.addEventListener('click', () => closeBar());
    bar.append(spark(), input, hint, close);
    line = el('div', 'line glass');
    line.dataset.part = 'play-ask-line';
    line.hidden = true;
    line.setAttribute('role', 'status');
    line.setAttribute('aria-live', 'polite');
    // In the line = it stays (and coming back during the fade stops it).
    line.addEventListener('pointerenter', () => holdLine());
    line.addEventListener('focusin', () => holdLine());
    line.addEventListener('pointerleave', () => (leftAt = win.performance.now()));
    line.addEventListener('focusout', () => (leftAt = win.performance.now()));
    const corner = el('div', 'corner');
    if (hold) {
      pauseBtn = el('button', 'pause glass')                     ;
      pauseBtn.type = 'button';
      pauseBtn.dataset.part = 'pause-button';
      pauseBtn.append(icon('pause'));
      pauseBtn.addEventListener('click', () => void pauseNow());
      if (o.move) {
        const mv = o.move;
        move = createPlayMove({
          win, core: mv.core, rules: mv.rules, arranged, adapter: () => findAdapter(), post, el, w,
          lang: () => lang, config: () => moveConfig, handlePx: () => moveHandlePx || defaultHandlePx(win),
          panel: () => (chat ? chat.parts[1]  : null), ignore: (e) => isOurs(e), changed: () => chat?.render(),
        });
      }
      const m = move;
      chat = createChat({
        doc, el, w,
        send: (text, history) => void sendChat(text, history),
        resume: () => resumeNow(),
        reload: () => post({ type: 'studio:play/reload' }),
        ...(m ? { move: { card: m.card, on: () => m.on, picked: () => m.picked(), can: () => !!findAdapter(), toggle: () => toggleMove() } } : {}),
      });
      corner.append(pauseBtn);
    }
    corner.append(mark);
    // The veil and the chat last: the ✦ field stays the overlay's first input (what reads the overlay finds it as
    // before), and they are never shown with the line or the field anyway.
    wrap.append(corner, line, bar, ...(chat ? chat.parts : []));
    root.append(style, wrap);
    // A press on the overlay is not a press in the game (a game that shoots on click must not shoot). Stopped where
    // it leaves the overlay, so the overlay's own buttons still get it; a game listening in the capture phase on the
    // window would still see it (rare).
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'wheel', 'contextmenu']         ) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }
    (doc.body || doc.documentElement).appendChild(host);
    lift();
    // The short or the long placeholder (NARROW_PX) follows the window.
    win.addEventListener('resize', () => (render(), move?.render()));
    // "Ask your AI `" for a few seconds when Play starts, then only the dot and the key: seen once, then out of the way.
    smallTimer = nativeSetTimeout(() => mark.classList.add('small'), 5000);
    render();
  }

  const isOurs = (e       ) => !!host && e.composedPath().includes(host);
  const gameTyping = () => {
    const a = doc.activeElement                      ;
    return !!a && a !== host && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  };

  // Registered now, before any game code: the first listener on the window in the capture phase, so the game never
  // sees a key meant for the field (its own listeners on window / document come after this one).
  for (const type of ['keydown', 'keyup', 'keypress']         ) {
    win.addEventListener(type, (e               ) => {
      if (!words) return;
      // Moving while paused: the keys are the editor's (M / H / T / S, arrows, Escape…) unless the chat's field has them.
      if (hold?.paused && move?.on && !(isOurs(e) && root?.activeElement === chat?.input)) {
        if (type === 'keydown' && isPauseKey(e, gameTyping())) {
          e.preventDefault();
          e.stopImmediatePropagation();
          resumeNow();
        } else if (type === 'keydown' && e.key === 'Escape' && !move.picked()) {
          // Escape: the editor drops its tool, then the pick; with nothing picked it takes the person back to the talk.
          e.preventDefault();
          e.stopImmediatePropagation();
          toggleMove();
        } else if (isOurs(e)) e.stopImmediatePropagation();
        // Anything else goes on to the editor's input (input.ts), which keeps it from the game.
        return;
      }
      if (isOurs(e)) {
        // The field's keys are handled here and go no further: stopping them at the window in the capture phase is
        // the only way to keep them from a game's own listeners, and it also keeps them from the field's, so Enter
        // and Escape are read here. Letters still type (nothing prevents their default).
        e.stopImmediatePropagation();
        if (type === 'keydown') (hold?.paused ? chatKey(e) : fieldKey(e));
        return;
      }
      if (hold?.paused) {
        // Paused: no key press reaches the game. Releases do (play-pause.ts: a key held at the pause must not stay
        // down in the game). P or Escape resumes; any other key is the person reaching for the chat: it gets focus.
        if (type === 'keyup') return;
        e.stopImmediatePropagation();
        if (type !== 'keydown') return;
        if (isPauseKey(e, gameTyping()) || e.key === 'Escape') {
          e.preventDefault();
          resumeNow();
        } else if (move && (e.key === 'm' || e.key === 'M' || e.code === 'KeyM') && !e.ctrlKey && !e.metaKey && !e.altKey && !gameTyping()) {
          // M: Move (its tooltip says so), as the editor's own key for the Move tool.
          e.preventDefault();
          toggleMove();
        }
        return;
      }
      if (type === 'keydown' && !barOpen && hold && isPauseKey(e, gameTyping())) {
        e.preventDefault();
        e.stopImmediatePropagation();
        void pauseNow();
      } else if (type !== 'keydown' && hold && !barOpen && (e.key === 'p' || e.key === 'P' || e.code === 'KeyP') && !gameTyping()) {
        // The release (and keypress) of the P that paused: not the game's either.
        e.stopImmediatePropagation();
      } else if (type === 'keydown' && !barOpen && isAskKey(e, gameTyping())) {
        e.preventDefault();
        e.stopImmediatePropagation();
        openBar();
      } else if (type !== 'keydown' && e.key === '`' && !gameTyping()) {
        e.stopImmediatePropagation();
      }
    }, true);
  }
  /** The chat's field while paused: Enter sends, Escape resumes (the words stay in the field for the next pause). */
  function chatKey(e               ) {
    if (!chat || e.target !== host || !root || root.activeElement !== chat.input) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      resumeNow();
    } else if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      chat.input.form?.requestSubmit();
    }
  }
  function fieldKey(e               ) {
    if (e.target !== host || !root || root.activeElement !== input) return;
    sendFailed = false;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBar();
    } else if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      void submit();
    }
  }
  // Full screen changes whether the mark is drawn here (markOn), so draw again too.
  doc.addEventListener('fullscreenchange', () => (lift(), render()));
  doc.addEventListener('webkitfullscreenchange', () => (lift(), render()));

  function openBar() {
    if (!host) return;
    barOpen = true;
    // The field open again = the person looks for what happened: a "fixed" line that faded comes back (and goes again).
    if (state && state.state === 'fixed' && dismissed === JSON.stringify(state) && dismissed === fadeSig) {
      dismissed = '';
      fadeSig = '';
    }
    // Pointer-locked games (first person) hold the mouse; let go so the person can type and click.
    try {
      if (doc.pointerLockElement) doc.exitPointerLock();
    } catch {
      /* nothing locked */
    }
    render();
    input.focus({ preventScroll: true });
  }
  function closeBar() {
    barOpen = false;
    input.value = '';
    input.blur();
    render();
    // Back to the game: its canvas takes the keys again.
    try {
      win.focus();
    } catch {
      /* fine */
    }
  }

  // ----- pause (play-pause.ts holds the game; play-chat.ts is the talk over it) -----
  async function pauseNow() {
    if (!hold || !chat || !host || hold.paused) return;
    // Words already typed in the ✦ field move to the chat (the person was about to ask; now they can talk).
    const draft = barOpen ? input.value.trim() : '';
    if (barOpen) closeBar();
    hold.pause();
    // The moment, taken at once: the picture is of the game as it stopped (the overlay is never in it), the console
    // as it was. The first message of this pause carries it.
    pausedMoment = await moment('');
    chatId = '';
    const logs = pausedMoment.type === 'studio:play/ask' ? pausedMoment.logs || [] : [];
    const errs = logs.filter((l) => l.level === 'error').length;
    const sees = errs ? `${w('sees')} · ${(errs === 1 ? w('seesError') : w('seesErrors')).replace('#', String(errs))}` : w('sees');
    if (!hold.paused) return; // resumed while the picture was taken
    chat.open(sees, draft);
    post({ type: 'studio:play/paused', on: true });
    render();
  }
  /** Move ↔ Chat in the paused panel (play-move.ts). */
  function toggleMove() {
    if (!move || !chat || !hold?.paused) return;
    if (move.on) {
      move.stop();
      chat.render();
      chat.input.focus({ preventScroll: true });
      return;
    }
    chat.input.blur();
    (root?.activeElement                      )?.blur();
    if (!move.start()) return;
    chat.render();
    // The keys go to the page (the editor's), not to a button of the panel that kept the focus.
    try {
      win.focus();
    } catch {
      /* fine */
    }
  }
  function resumeNow() {
    if (!hold || !hold.paused) return;
    // The editor goes first (its own frame loop and the adapter's edit view end), then the game runs on from where the
    // objects now are.
    if (move) {
      move.stop();
      move.resumed();
    }
    hold.resume();
    chat?.close();
    pausedMoment = null;
    post({ type: 'studio:play/paused', on: false });
    render();
    try {
      win.focus();
    } catch {
      /* fine */
    }
  }
  async function sendChat(text        , history                                            ) {
    sentTo = 'chat';
    // The first message: the moment of the pause. The next ones: the talk so far and the first one's id; the moment
    // is in that first record (and in .studio/chat/<id>.json), the game has not moved since.
    const base                = !chatId && pausedMoment && pausedMoment.type === 'studio:play/ask' ? { ...pausedMoment } : { type: 'studio:play/ask', text, size: [win.innerWidth, win.innerHeight] };
    if (base.type !== 'studio:play/ask') return;
    base.text = text;
    base.paused = true;
    if (chatId) base.chat = chatId;
    if (history.length) base.history = history;
    post(base);
  }

  /** The state's line in reply to Enter on an empty field: a fix to load (Reload), or nothing to do. */
  async function submit() {
    const text = input.value.trim();
    if (!text) {
      if (state && state.state === 'fixed' && state.reload) {
        closeBar();
        post({ type: 'studio:play/reload' });
      }
      return;
    }
    if (sending) return;
    sentTo = 'bar';
    if (state && state.state === 'asking') {
      sending = true;
      post({ type: 'studio:play/answer', text });
      return;
    }
    sending = true;
    render();
    post(await moment(text));
  }

  /** The words and the moment: picture, player's camera, what is near, the console. Each part is optional. */
  async function moment(text        )                         {
    const now = win.performance.now();
    // The picture with the game's HTML UI, without the editor's own parts (this overlay, the editor's tools).
    const notOurs = (e         ) => e === host || e.tagName === 'GAME-STUDIO-PLAY' || e.hasAttribute('data-studio-ui');
    const shot = shootPage(win, notOurs) || undefined;
    let view                                                                                 ;
    let near                        ;
    const a = findAdapter();
    if (a) {
      try {
        const items = a.list();
        const byKey = new Map(items.map((i) => [i.key, i]));
        const p = a.dim === '3d' && a.player ? a.player() : null;
        if (p) {
          view = { eye: p.eye, target: p.target };
          if (p.near) {
            near = p.near.map((n) => {
              const it = byKey.get(n.key);
              const e           = { key: n.key, d: n.d };
              const label = n.label || it?.label;
              if (label) e.label = label;
              if (it?.pose) e.pose = it.pose;
              if (n.screen) e.screen = n.screen;
              return e;
            });
          }
        } else if (a.dim === '2d') {
          near = near2D(items, (k) => {
            const an = a.anchor(k);
            return an ? an.center : null;
          }, win.innerWidth, win.innerHeight);
        }
      } catch (e) {
        keepLog('warn', ['[game-studio] could not read the scene for the request: ' + String((e         )?.message || e)]);
      }
    }
    const out                = { type: 'studio:play/ask', text, size: [win.innerWidth, win.innerHeight] };
    if (shot) out.shot = shot;
    if (view) out.view = view;
    if (near && near.length) out.near = near;
    const l = pickLogs(logs, now);
    if (l.length) out.logs = l;
    if (doc.fullscreenElement) out.fullscreen = true;
    return out;
  }

  let adapter                       = null;
  function findAdapter()                       {
    if (adapter) return adapter;
    for (const p of o.probes()) {
      try {
        const a = p.found();
        if (a) return (adapter = a);
      } catch {
        /* the next one */
      }
    }
    return null;
  }

  // ----- the "fixed" line's own clock -----
  function fadeFor(s                 , sig        ) {
    if (!s || s.state !== 'fixed' || sig === dismissed) {
      if (fadeSig !== sig) {
        nativeClearTimeout(fadeTimer);
        fadeSig = '';
      }
      return;
    }
    if (fadeSig === sig) return;
    fadeSig = sig;
    line.classList.remove('fading');
    nativeClearTimeout(fadeTimer);
    fadeTimer = nativeSetTimeout(lineDue, lineStayMs(s.text + (s.asked || '')));
  }
  function lineDue() {
    // Held: the pointer or the keyboard is in it, it just left, or the field is open (the line is what they reply to).
    if (line.matches(':hover') || line.matches(':focus-within') || barOpen || win.performance.now() - leftAt < LINE_GRACE_MS) {
      fadeTimer = nativeSetTimeout(lineDue, 500);
      return;
    }
    line.classList.add('fading');
    const reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    fadeTimer = nativeSetTimeout(() => {
      line.classList.remove('fading');
      dismissed = fadeSig;
      render();
    }, reduce ? 0 : LINE_FADE_MS);
  }
  function holdLine() {
    if (!line.classList.contains('fading')) return;
    line.classList.remove('fading');
    nativeClearTimeout(fadeTimer);
    fadeTimer = nativeSetTimeout(lineDue, LINE_GRACE_MS);
  }

  // ----- drawing: the corner mark, the field, the line -----
  function render() {
    if (!host) return;
    const s = state;
    const busy = !!s && (s.state === 'looking' || s.state === 'fixing');
    mark.classList.toggle('busy', busy);
    const paused = !!hold?.paused;
    mark.hidden = barOpen || paused || !(markOn || !!doc.fullscreenElement);
    if (pauseBtn) {
      pauseBtn.hidden = mark.hidden;
      pauseBtn.title = w('pauseTip');
      pauseBtn.setAttribute('aria-label', w('pauseTip'));
    }
    chat?.render();
    bar.hidden = !barOpen;
    bar.classList.toggle('busy', sending);
    input.disabled = sending;
    const asking = !!s && s.state === 'asking';
    const narrow = win.innerWidth < NARROW_PX;
    input.placeholder = sending ? w('sending') : sendFailed ? w('sendFail') : asking ? w('answerPlaceholder') : w(narrow ? 'placeholderShort' : 'placeholder');
    hint.textContent = s && s.state === 'fixed' && s.reload ? w('enterReloads') : '';
    hint.hidden = !hint.textContent;

    line.replaceChildren();
    const sig = s ? JSON.stringify(s) : '';
    // Paused: the chat says what the AI does (its replies are the same lines), so the line over the game waits.
    line.hidden = !s || sig === dismissed || paused;
    fadeFor(s, sig);
    // A fix that waits for Reload after its line went: the corner dot says so (` or the mark, then Enter reloads).
    const waiting = !!s && s.state === 'fixed' && !!s.reload && line.hidden;
    mark.classList.toggle('ready', waiting);
    // The reload waiting is the one thing the mark's words do not say: only then a tooltip.
    mark.title = waiting ? w('reloadTip') : '';
    mark.setAttribute('aria-label', waiting ? w('reloadTip') : w('askTip'));
    if (!s || line.hidden) return;
    line.classList.toggle('busy', busy);
    const say = el('div', 'say');
    say.append(el('span', 'head', s.text));
    if (s.more) {
      // Words only, not a button (as the editor's line): a web page cannot bring the AI's own window to the front.
      const sub = el('span', 'sub has-more');
      if (s.asked) {
        const sep = el('span', 'sep', '·');
        sep.setAttribute('aria-hidden', 'true');
        sub.append(el('span', 'said', s.asked), sep);
      }
      const more = el('span', 'more', s.more);
      more.dataset.part = 'play-ask-more';
      sub.append(more);
      say.append(sub);
    } else if (s.asked) say.append(el('span', 'sub', s.asked));
    line.append(el('span', 'dot'), say);
    line.title = [s.asked ? `${s.text} — ${s.asked}` : s.text, s.more].filter(Boolean).join(' · ');
    const acts = el('div', 'acts');
    if (s.state === 'asking' && s.choices && s.choices.length) {
      const row = el('div', 'choices');
      s.choices.forEach((c, i) => {
        const b = el('button', i === 0 ? 'b primary' : 'b', c)                     ;
        b.type = 'button';
        b.addEventListener('click', () => {
          sending = true;
          render();
          post({ type: 'studio:play/answer', text: c });
        });
        row.append(b);
      });
      acts.append(row);
    }
    if (s.state === 'fixed' && s.reload) {
      const b = el('button', 'b primary', w('reload'))                     ;
      b.type = 'button';
      b.dataset.action = 'play-reload';
      b.title = w('reloadTip');
      b.addEventListener('click', () => post({ type: 'studio:play/reload' }));
      acts.append(b);
    }
    if (s.state === 'fixed' || s.state === 'failed' || s.state === 'kept') {
      // "Keep playing": the line goes; the fix waits for Reload (or for the next time the game opens).
      const x = el('button', 'x', '×')                     ;
      x.type = 'button';
      x.title = w('keep');
      x.setAttribute('aria-label', w('keep'));
      x.addEventListener('click', () => {
        dismissed = sig;
        render();
      });
      acts.append(x);
    }
    if (acts.childNodes.length) line.append(acts);
  }

  win.addEventListener('message', (ev              ) => {
    if (ev.source !== win.parent || ev.origin !== parentOrigin || !isStudioMessage(ev.data)) return;
    // An edit page in Edit: Play's messages are not for it (a late play/state after the switch back, say).
    if (!awake) return;
    const m = ev.data                 ;
    if (m.type === 'studio:play/on') {
      words = m.words;
      lang = m.lang === 'ja' ? 'ja' : 'en';
      if (m.config !== undefined) moveConfig = m.config ?? null;
      if (typeof m.handlePx === 'number' && m.handlePx > 0) moveHandlePx = m.handlePx;
      markOn = m.mark !== false;
      // Sent again when the editor's layout changes (a phone turned, a window made narrow): only the mark changes.
      // An overlay put away by sleep() (Play in the same page, again): shown, its words in full for a few seconds again.
      if (host && host.style.display === 'none') reshow();
      else if (host) render();
      else if (doc.body) build();
      else doc.addEventListener('DOMContentLoaded', build, { once: true });
    } else if (m.type === 'studio:play/open') {
      // The editor's ✦ (phone): the same as ` or the corner mark. Paused: the chat is the way to ask; its field.
      if (hold?.paused && chat) chat.input.focus({ preventScroll: true });
      else if (host && !barOpen) openBar();
    } else if (m.type === 'studio:play/pause') {
      // The editor's ❚❚ (phone): the same as P or the corner button.
      if (hold?.paused) resumeNow();
      else void pauseNow();
    } else if (m.type === 'studio:play/state') {
      state = m.state;
      if (hold?.paused && chat) chat.line(m.state);
      render();
    } else if (m.type === 'studio:play/sent' && sentTo === 'chat' && chat) {
      sentTo = 'bar';
      if (m.ok && m.id && !chatId) chatId = m.id;
      chat.sent(m.ok);
    } else if (m.type === 'studio:play/sent') {
      sending = false;
      sendFailed = !m.ok;
      if (m.ok) closeBar();
      else {
        render();
        input.focus({ preventScroll: true });
      }
    }
  });
  /** The overlay again after sleep(): as build() shows it the first time. */
  function reshow() {
    if (!host) return;
    host.style.removeProperty('display');
    lift();
    mark.classList.remove('small');
    nativeClearTimeout(smallTimer);
    smallTimer = nativeSetTimeout(() => mark.classList.add('small'), 5000);
    render();
  }

  if (awake) post({ type: 'studio:play/hello' });
  return {
    hold,
    wake(next) {
      if (awake) return;
      awake = true;
      arranged = next;
      move?.restart(next);
      post({ type: 'studio:play/hello' });
    },
    sleep() {
      if (!awake) return;
      // Moving while paused: its editor goes first (the edit page's own editor comes up right after, play-switch.ts).
      if (move?.on) move.stop();
      if (hold?.paused && chat) {
        chat.close();
        pausedMoment = null;
        chatId = '';
        post({ type: 'studio:play/paused', on: false });
      }
      if (barOpen) closeBar();
      awake = false;
      words = null;
      state = null;
      dismissed = '';
      sending = false;
      sendFailed = false;
      nativeClearTimeout(fadeTimer);
      fadeSig = '';
      if (host) {
        // Not `hidden`: the host's inline `all: initial` would win over it. Out of the top layer too.
        host.style.setProperty('display', 'none');
        try {
          if (host.matches(':popover-open')) (host                                         ).hidePopover();
        } catch {
          /* no popovers */
        }
      }
    },
  };
}

__def(__exports, "LOG_ERRORS", () => LOG_ERRORS);
__def(__exports, "LOG_TAIL", () => LOG_TAIL);
__def(__exports, "NARROW_PX", () => NARROW_PX);
__def(__exports, "logText", () => logText);
__def(__exports, "pickLogs", () => pickLogs);
__def(__exports, "isAskKey", () => isAskKey);
__def(__exports, "near2D", () => near2D);
__def(__exports, "startPlayAsk", () => startPlayAsk);
};
__defs[50] = function (__exports) {
'use strict';
// levels.ts

// studio.levels(list) on the game page (levels, 2026-10-22; CONTRACT.md §1.10). Pure, so it is unit-tested.
//
// The game says which levels its code has; the editor's URL (studioLevel / studioBuild, set by the shell's loadGame)
// says which one to show. The answer is { id, build }: `id` = the level the editor shows (it may be one made in the
// editor, which the code does not have yet), `build` = the code's level to build for it (an editor-made level is built
// from the level it was copied from, and placement.json's entry for `id` is laid over it).
//
// WHY the URL and not a message: the game picks its level while it starts, before the editor could answer anything,
// and a page opened again (a reload, ▶ Play, the AI's change) must come back on the same level by itself.
// WHY null outside the editor's frame: in the shipped game (or the game opened on its own) the game's own progress
// picks the level; the studio must not.
const { KEY_RE, LOCAL_PATHS } = __require(13);

/** The game's list, cleaned: ids that fit a key (KEY_RE), each once, labels as text (≤ 120 characters). */
function cleanLevels(list         )              {
  const out              = [];
  const seen = new Set        ();
  for (const x of Array.isArray(list) ? list.slice(0, 100) : []) {
    const id = typeof x === 'string' ? x : x && typeof x === 'object' ? (x                    ).id : null;
    if (typeof id !== 'string' || !KEY_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const label = x && typeof x === 'object' ? (x                       ).label : undefined;
    out.push(typeof label === 'string' && label.trim() ? { id, label: label.trim().slice(0, 120) } : { id });
  }
  return out;
}

/**
 * What studio.levels() answers, and the list sent to the editor; null = not in the editor's frame, or no levels.
 * A URL that names a level the code does not have and no `build` it has falls back to the first level.
 */
function pickLevel(list         , href        , inFrame         )                                                  {
  const levels = cleanLevels(list);
  if (!levels.length || !inFrame) return null;
  const ids = new Set(levels.map((l) => l.id));
  let q                 ;
  try {
    q = new URL(href).searchParams;
  } catch {
    q = new URLSearchParams();
  }
  const want = q.get(LOCAL_PATHS.levelParam) || '';
  const build = q.get(LOCAL_PATHS.buildParam) || '';
  if (ids.has(build) && KEY_RE.test(want)) return { levels, pick: { id: want, build } };
  if (ids.has(want)) return { levels, pick: { id: want, build: want } };
  return { levels, pick: { id: levels[0] .id, build: levels[0] .id } };
}

__def(__exports, "cleanLevels", () => cleanLevels);
__def(__exports, "pickLevel", () => pickLevel);
};
__defs[51] = function (__exports) {
'use strict';
// early-press.ts

// A tap in the game while the editor is still getting ready (first-click pass, 2026-10-20).
//
// WHY: the game draws (the lighthouse is right there) a moment before the editor can pick anything: the bridge waits
// for the scene's objects, then the editor page answers core/ready with core/edit, and only then does input.ts listen.
// On a slow network or GPU that is a second or more, and the only sign is a small grey line in the list ("Finding
// objects you can move…"), away from the game (a phone's list is closed). A click in that moment went to the game and was gone: nothing got
// selected, and the person clicked again (a try of test demo v16: "I click the lighthouse and it isn't selected").
// Decision (design, this pass): don't throw the click away and don't add a "please wait" sign — remember the last
// tap, and when the editor begins, pick what was under it. The editor reads it right after adapter.begin(), while the
// view is still the picture the person tapped on (three.js and 2D both open on the game's own camera there), before
// a saved view or "everything in frame" moves it (editor.ts setEditing).
//
// Only a plain tap counts: the primary pointer, the left button, no modifier, released within the tap slop. A drag or a
// right-click drops it, and a later tap replaces it (the last one is what the person meant). The listeners sit on the game
// window in the capture phase, never block anything (the game still runs and gets its input until the editor begins),
// and go away once the editor has taken the tap.
const { UI } = __require(13);

                           
            
            
                                                                                          
               
 

                            
                                                                                         
                          
 

function watchEarlyTaps(win        )            {
  let down                                     = null;
  let tap                  = null;
  const opts = { capture: true };
  const onDown = (e              ) => {
    tap = null;
    down = e.isPrimary && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
      ? { id: e.pointerId, x: e.clientX, y: e.clientY, type: e.pointerType }
      : null;
  };
  const onMove = (e              ) => {
    if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) > UI.tapSlopPx) down = null;
  };
  const onUp = (e              ) => {
    if (down && e.pointerId === down.id && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= UI.tapSlopPx) {
      tap = { x: down.x, y: down.y, type: down.type };
    }
    down = null;
  };
  // A release that does not come as a pointerup here (first-click pass 2, input.ts onLost): the capture let go with no
  // button down (when the game captured the press) counts as the release, at the press point.
  const onLost = (e              ) => {
    if (down && e.pointerId === down.id && e.buttons === 0) tap = { x: down.x, y: down.y, type: down.type };
    if (down && e.pointerId === down.id) down = null;
  };
  const onCancel = () => (down = null);
  win.addEventListener('pointerdown', onDown, opts);
  win.addEventListener('pointermove', onMove, opts);
  win.addEventListener('pointerup', onUp, opts);
  win.addEventListener('pointercancel', onCancel, opts);
  win.addEventListener('lostpointercapture', onLost, opts);
  let done = false;
  return {
    take() {
      if (done) return null;
      done = true;
      win.removeEventListener('pointerdown', onDown, opts);
      win.removeEventListener('pointermove', onMove, opts);
      win.removeEventListener('pointerup', onUp, opts);
      win.removeEventListener('pointercancel', onCancel, opts);
      win.removeEventListener('lostpointercapture', onLost, opts);
      return tap;
    },
  };
}

__def(__exports, "watchEarlyTaps", () => watchEarlyTaps);
};
__defs[52] = function (__exports) {
'use strict';
// bridge.ts

// The bridge: the studio's side inside the game page.
//
// It owns the global API (window.studio), finds an adapter, runs the
// adapter self-check, and translates between the shell's messages and the
// adapter. Pointer input and handles live in input.ts / handles.ts; this file
// only wires them up.
const { CONTRACT_VERSION, LOCAL_PATHS, isStudioMessage } = __require(13);
const { installCore } = __require(16);
const { installPlayClock } = __require(18);
const { adapterFromPort2D } = __require(19);
const { findDomUi, uiAdapterFromPort } = __require(22);
const { runSelfCheck } = __require(23);
const { createEditor } = __require(42);
const { startPlayAsk } = __require(49);
const { createPlaySwitch } = __require(41);
const { arrangeInPlay, moveInPlay } = __require(40);
const { applyPlacement, placementForLevel } = __require(20);
const { pickLevel } = __require(50);
const { watchEarlyTaps } = __require(51);
                                                    
const { nativeSetTimeout } = __require(0);

                                
                           
                                   
 

/** Read the edit flag and the shell's origin from the page URL. */
function readEditParams(href        )                                          {
  const u = new URL(href);
  const [flagKey, flagVal] = LOCAL_PATHS.editFlag.split('=')                    ;
  const edit = u.searchParams.get(flagKey) === flagVal;
  let parentOrigin = u.origin;
  const p = u.searchParams.get(LOCAL_PATHS.parentParam);
  if (p) {
    try {
      parentOrigin = new URL(p).origin;
    } catch {
      /* malformed: stay on our own origin, which the shell can always reach locally */
    }
  }
  return { edit, parentOrigin };
}

function startBridge(opts               )       {
  const win = opts.win || window;
  const { edit, parentOrigin } = readEditParams(win.location.href);
  // Outside edit mode (e.g. the game opened directly while the server runs)
  // the script only publishes no-op API so `studio.ready()` calls are harmless.
  const inFrame = win.parent && win.parent !== win;
  // ▶ Play inside the editor: the game's clock, so a pause (P) takes no time (core/play-clock.ts). Before the core and
  // before any game code, so the game's first performance.now() and every frame's timestamp already go through it.
  // In the edit page too since ▶ Play in the same page (fast switch, 2026-10-22; play-switch.ts): there it stops with
  // every hold of the game (time.ts `clock`), so the page that becomes Play steps one frame, not the minutes of Edit.
  const playClock = inFrame ? installPlayClock(win) : null;
  const core       = installCore({ freezeAfterFirstFrame: edit && !!inFrame, firstFrameTimeoutMs: 4000, win,
    ...(playClock ? { stamp: playClock.at } : {}), ...(playClock && edit ? { clock: playClock } : {}) });

  // Probes registered by the game folder (.studio/adapter.js) go first so an
  // AI-written adapter can override a built-in one.
  const gameProbes                 = [];
  // The UI seat (UI stage 1, CONTRACT.md §1.1): ports the game registered with studio.registerUI(), asked before the
  // built-in DOM UI adapter. A separate list from the world's probes, so a UI never competes with three.js or the
  // game's own adapter for the one world slot.
  const uiPorts                                                                   = [];
  // .studio/tools.js (loaded before the game) may call studio.extend() before
  // the editor exists; keep what it gave and hand it over when editing starts.
  const rules              = { config: null, ext: [] };
  const pendingTools             = [];
  let editorRef                = null;
  const attached                            = [];

  const api               = {
    version: CONTRACT_VERSION,
    ready: () => core.time.ready(),
    attach(parts) {
      attached.push(parts);
      win.dispatchEvent(new CustomEvent('studio:attach', { detail: parts }));
    },
    registerAdapter(probe) {
      try {
        probe.install(core);
      } catch (e) {
        console.warn('[studio] adapter install failed:', e);
      }
      gameProbes.push(probe);
    },
    register2D(port) {
      const get = typeof port === 'function' ? port : () => port;
      let built                       = null;
      api.registerAdapter({
        kind: 'port2d',
        install() {},
        found() {
          if (built) return built;
          const p = get()                 ;
          if (!p) return null;
          built = adapterFromPort2D(p, core);
          return built;
        },
      });
    },
    registerUI(port) {
      uiPorts.push({ get: typeof port === 'function' ? port : () => port, built: null });
    },
    core,
    // Levels (2026-10-22, bridge/levels.ts): the code's levels go to the editor (once per page), and the page builds
    // the level the editor's URL asks for. Outside the editor's frame: null, the game picks its level itself.
    levels(list) {
      const r = pickLevel(list, win.location.href, !!inFrame);
      if (!r) return null;
      if (inFrame) {
        try {
          const msg                = { type: 'studio:core/levels', levels: r.levels, current: r.pick.id };
          win.parent.postMessage(msg, parentOrigin);
        } catch {
          /* parent gone */
        }
      }
      return r.pick;
    },
    extend(ext               ) {
      if (!ext || typeof ext !== 'object') return;
      rules.ext.push(ext);
      const list = Array.isArray(ext.tools) ? ext.tools : [];
      if (editorRef) editorRef.addTools(list);
      else pendingTools.push(...list);
    },
  };
  for (const p of opts.builtins) {
    try {
      p.install(core);
    } catch (e) {
      console.warn('[studio] built-in adapter install failed:', e);
    }
  }
  /**
   * ▶ Play inside the editor: the game as the editor shows it, saved or not (play-arrange.ts says why and what). The
   * file is the editor's draft, written just before Play opened this page (shell keepNow). Its UI places go through the
   * loader's own applyPlacement(document, …) (placeUi: the same offset set again, never added), the world's through the
   * page's adapter once it lists its objects.
   */
  async function showFileEditsInPlay()                    {
    let file                                     = null;
    try {
      const res = await fetch(new URL('placement.json', win.location.href).href, { cache: 'no-cache' });
      if (res.ok) file = await res.json();
    } catch {
      return [];
    }
    if (!file || typeof file !== 'object') return [];
    // A game with levels (2026-10-22): only the level this page shows (the URL's studioLevel; none = nothing moves).
    if (Array.isArray((file                        ).levels)) file = placementForLevel(file, new URL(win.location.href).searchParams.get(LOCAL_PATHS.levelParam) || '');
    if (!file) return [];
    if (file.ui && typeof file.ui === 'object') {
      try {
        await applyPlacement(win.document, { tool: 'placement', objects: {}, ui: file.ui });
      } catch {
        /* the UI stays as the game draws it */
      }
    }
    const busy = (file.objects && Object.keys(file.objects).length) || file.added?.length || file.removed?.length || file.order?.length
      || (file.motion && Object.keys(file.motion).length);
    if (!busy) return [];
    await core.time.firstFrame();
    // The game may build its scene a little after its first frame (as in edit mode): look for up to ~5 s.
    let a                       = null;
    for (let i = 0; i < 35; i++) {
      for (const p of [...gameProbes, ...opts.builtins]) {
        try {
          a = p.found();
        } catch {
          a = null;
        }
        if (a) break;
      }
      try {
        if (a && a.list().length) break;
      } catch {
        /* not ready */
      }
      await new Promise((r) => nativeSetTimeout(r, 150));
    }
    if (!a) return [];
    const shown = arrangeInPlay(a, file);
    if (shown) console.info(`[studio] Play: ${shown} change${shown === 1 ? '' : 's'} from the editor shown (saved or not, not in the code yet)`);
    // The draft's motions (motion-gui, 2026-10-22), for the objects the page's own loader does not move.
    const moving = moveInPlay(a, file, win);
    if (moving.length) console.info(`[studio] Play: ${moving.length} motion${moving.length === 1 ? '' : 's'} from the editor played (not in the code yet)`);
    // The keys those motions move: a pause shows them as "just for this moment" (play-move.ts).
    return moving;
  }

  /**
   * Tell the editor when the game's own page throws (polish pass 2026-10-16, "never stuck"): before, a game that
   * stopped on an error left the editor saying "Waiting for the game to draw…" forever, or Play showed a frozen
   * picture, with the reason only in the browser console a newcomer never opens. The shell turns it into one line
   * that says what to do. The first 3 per page load (an error inside a frame loop repeats 60 times a second).
   */
  function watchGameErrors() {
    let sent = 0;
    const send = (message        , where         ) => {
      if (sent >= 3) return;
      sent++;
      try {
        const msg                = { type: 'studio:core/game-error', message: String(message).slice(0, 300), where };
        win.parent.postMessage(msg, parentOrigin);
      } catch {
        /* parent gone */
      }
    };
    win.addEventListener('error', (e            ) => {
      // Only script errors: a missing picture fires 'error' on the <img>, not here (it does not bubble).
      if (!e.message) return;
      const file = e.filename ? e.filename.split(/[?#]/)[0] .split('/').pop() : '';
      send(e.message, file ? `${file}${e.lineno ? ':' + e.lineno : ''}` : undefined);
    });
    win.addEventListener('unhandledrejection', (e                       ) => {
      const r = e.reason                                    ;
      send(r && typeof r.message === 'string' ? r.message : String(e.reason));
    });
  }

  const g = win                                      ;
  g.__gameStudio = api;
  const prior = g.studio                                       ;
  if (prior === undefined) g.studio = api;
  else if (prior && typeof prior === 'object' && typeof prior.attach === 'function' && typeof prior.ready === 'function') {
    // The built-in three.js boot script published its own `studio` (attach /
    // waitForReady / ready) a moment earlier. Merge into that object so a game
    // calling studio.ready() reaches both the three.js hold and core time,
    // and studio.register2D() etc. still exist.
    const threeReady = prior.ready                         ;
    const threeAttach = prior.attach                        ;
    const coreReady = api.ready;
    const coreAttach = api.attach;
    prior.ready = (o          ) => {
      threeReady(o);
      // ready() before the game drew anything: the three.js boot lets ONE
      // frame run (so the game places its camera) and holds right after it,
      // with the layout put back as it was at ready() (boot.js, polish pass
      // 2026-10-16). Core time must not freeze before that frame, so tell it
      // "ready" once the boot holds (or after 1.6 s, if no frame comes).
      const boot = g.__studioThree                                                                                                     ;
      if (boot && boot.holdAfterCamera && !boot.held && boot.on) {
        let done = false;
        const go = () => {
          if (done) return;
          done = true;
          coreReady();
        };
        boot.on((t) => {
          if (t === 'hold') go();
        });
        nativeSetTimeout(go, 1600);
      } else coreReady();
    };
    prior.attach = (o                         ) => {
      threeAttach(o);
      coreAttach(o);
    };
    for (const k of ['version', 'registerAdapter', 'register2D', 'registerUI', 'core', 'extend', 'levels']         ) prior[k] = api[k];
    api.ready = prior.ready              ;
    api.attach = prior.attach                                        ;
  }

  if (inFrame) watchGameErrors();
  // ▶ Play inside the editor: ask your AI without stopping (play-ask.ts, §3.5). Installed now, before the game's code,
  // so the console is kept from its first line and the ask key is the first listener on the window.
  // In the edit page too, asleep (`standby`) until the page becomes Play (play-switch.ts, fast switch 2026-10-22): its
  // key listener must be the first on the window, and the AudioContexts the game makes must be kept from the start.
  let playAsk                       = null;
  let playSwitch                    = null;
  if (inFrame) {
    // For tests (test/studio-play-unsaved.browser.mjs), like `_debug` in edit mode: the page's objects as its adapter
    // lists them while playing, to compare with what the editor showed. Not enumerable, nothing else uses it.
    Object.defineProperty(api, '_play', {
      value: Object.freeze({
        // Play in the same page (test/studio-fast-switch.browser.mjs): is this edit page playing now? A Play page: true.
        playing: () => (edit ? !!playSwitch?.playing : true),
        list: () => {
          // An edit page playing (fast switch): what it shows, through the editor's copies and deletions — the page's
          // own objects as a Play page's draft would have made them.
          const l = edit ? editorRef?.playLayers()[0] : null;
          if (l) return l.edits.list();
          for (const p of [...gameProbes, ...opts.builtins]) {
            try {
              const a = p.found();
              if (a) return a.list();
            } catch {
              /* next */
            }
          }
          return null;
        },
      }),
      enumerable: false,
    });
    // The edit page shows the draft already (the editor's own work): nothing to arrange; Play gives its motions then.
    const arranged = edit ? Promise.resolve([]            ) : showFileEditsInPlay();
    // Pause-move (stage 2): the editor that wakes in a paused game needs the core and the game's rules, and the draft's
    // motions (what the game page moves for the editor) to say "just for this moment" on them.
    playAsk = startPlayAsk({ win, parentOrigin, probes: () => [...gameProbes, ...opts.builtins], standby: edit,
      ...(playClock ? { pause: { time: core.time, clock: playClock }, move: { core, rules, arranged } } : {}) });
  }
  if (!edit || !inFrame) return;
  // A tap in the game before the editor is ready is kept for it (early-press.ts): from the very start, before the game's code.
  const earlyTaps = watchEarlyTaps(win);

  const post = (msg               ) => {
    try {
      win.parent.postMessage(msg, parentOrigin);
    } catch {
      /* parent gone */
    }
  };
  post({ type: 'studio:core/hello', contract: CONTRACT_VERSION });

  let editor                = null;
  const queue                  = [];

  win.addEventListener('message', (ev              ) => {
    if (ev.source !== win.parent || ev.origin !== parentOrigin) return;
    if (!isStudioMessage(ev.data)) return;
    const msg = ev.data                 ;
    // Play / Edit in this page (play-switch.ts): the shell sends it only once the editor is up.
    if (msg.type === 'studio:core/play') {
      playSwitch?.handle(msg);
      return;
    }
    if (editor) editor.handle(msg);
    else queue.push(msg);
  });

  const adapterFailed = new Set        ();
  const findAdapter = ()                       => {
    for (const p of [...gameProbes, ...opts.builtins]) {
      try {
        const a = p.found();
        if (a) return a;
      } catch (e) {
        console.warn(`[studio] adapter "${p.kind}" failed:`, e);
        // Once per adapter: the shell says what to do (the look-again loop below calls this many times).
        if (!adapterFailed.has(p.kind)) {
          adapterFailed.add(p.kind);
          post({ type: 'studio:core/error', message: `${p.kind}: ${(e         )?.message ?? String(e)}` });
        }
      }
    }
    return null;
  };
  /**
   * The UI layer's adapter (UI stage 1), or null — then everything below runs exactly as before. Order: the game's
   * registerUI() ports, then the built-in DOM UI (elements marked data-studio-key). Not for a game whose world IS
   * the DOM (a port named 'dom', examples/dom-board): its pieces carry data-studio-key as world objects, and they
   * stay there; elements the world already lists are skipped for any game.
   */
  // The UI found is the built-in DOM one (not a game's registerUI port): screens, text and colours apply (ui-extras.ts).
  let uiDom = false;
  const findUi = (world                      )                       => {
    uiDom = false;
    for (const u of uiPorts) {
      try {
        if (u.built) return u.built;
        const p = u.get();
        if (p) return (u.built = uiAdapterFromPort(p, core, win));
      } catch (e) {
        console.warn('[studio] UI port failed:', e);
      }
    }
    if (world && world.kind === 'dom') return null;
    try {
      const skip = () => {
        try {
          return new Set(world ? world.list().map((i) => i.key) : []);
        } catch {
          return new Set        ();
        }
      };
      const dom = findDomUi(core, win, skip);
      uiDom = !!dom;
      return dom;
    } catch (e) {
      console.warn('[studio] DOM UI adapter failed:', e);
      return null;
    }
  };

  core.time.firstFrame().then(async () => {
    // Engines often build the scene a little after their first frame (async
    // asset loading: Phaser's preload, a glTF loader, fonts). Freezing right
    // there would show — and list — nothing. So until an adapter answers with
    // at least one object, let the game run and look again; freeze as soon as
    // there is something to edit. studio.ready() from the game skips the wait
    // (the game knows best), and after ~8 s we stop waiting and report.
    const hasObjects = (a                      ) => {
      try {
        return !!a && a.list().length > 0;
      } catch {
        return false;
      }
    };
    let adapter = findAdapter();
    // The wait is the world's alone (a title shown before the 3D models load must not stop it early). One
    // exception (UI stage 1): no world adapter at all but a UI — an HTML-only game — stops after ~1 s instead of 8.
    let uiOnly                       = null;
    for (let i = 0; !hasObjects(adapter) && !core.time.readyCalled && i < 55; i++) {
      if (!adapter && i >= 6 && (uiOnly = findUi(null))) break;
      post({ type: 'studio:core/wait', reason: adapter ? 'no-objects' : 'no-adapter' });
      core.time.thaw();
      await new Promise((r) => nativeSetTimeout(r, 150));
      adapter = findAdapter();
    }
    core.time.freeze();
    const ui = adapter ? findUi(adapter) : uiOnly || findUi(null);
    if (!adapter && !ui) {
      // Report "no adapter" now; a found adapter is checked by the editor
      // right after begin(), when 3D adapters have their edit camera.
      post({ type: 'studio:core/check', result: await runSelfCheck(null, core, win) });
      post({ type: 'studio:core/wait', reason: 'no-adapter' });
      return;
    }
    editor = createEditor({ adapter, ui, uiDom: !!ui && uiDom, core, win, post, rules, tools: pendingTools.splice(0), earlyTaps });
    editorRef = editor;
    if (playAsk) playSwitch = createPlaySwitch({ win, core, editor, playAsk });
    // Read-only peek for headless tests and debugging (not part of the contract):
    // where the handles of an object are, and what is selected.
    // Through the editor's layers, so copies, deletions and rules show as the shell sees them.
    // under(x, y): the object right under a point of the game (radius 0: no finger slack), or null. Tests use it to
    // choose something to tap that nothing stands in front of (W1 merge 2026-10-17: in test/web-demo the earlier
    // visits' saves had moved a sailboat in front of the small sea stack, and the tap rightly picked the boat).
    // The layer being edited now (UI stage 1: `layer()` says which; the world's unless switched).
    const ed = editor;
    const found = () => ed.driven;
    const debug = Object.freeze({ anchor: (k        ) => found().anchor(k), list: () => found().list(), view: () => found().view.state(), foot: (k        ) => found().foot?.(k) ?? null,
      middle: (k        ) => found().middle?.(k) ?? null, layer: () => ed.layer(),
      // Snap to surfaces (test/studio-snap-surface.browser.mjs): bottom / surface heights, and a scene point on screen.
      rest: (k        ) => found().rest?.(k) ?? null, toScreen: (p          ) => found().toScreen?.(p) ?? null,
      under: (x        , y        ) => { try { return found().pickNear(x, y, 0)[0] ?? null; } catch { return null; } } });
    // Absent while this page plays (fast switch, 2026-10-22): the screen tests read "_debug there = the editor is up,
    // gone = Play" (and `_play` for Play's list), as when Play was always another page.
    Object.defineProperty(api, '_debug', { get: () => (playSwitch?.playing ? undefined : debug), enumerable: false });
    // core/ready (with `drop` for snap to surfaces, and the layers for UI stage 1): editor.ts ready().
    editor.announce();
    for (const m of queue.splice(0)) editor.handle(m);
  });
}

__def(__exports, "readEditParams", () => readEditParams);
__def(__exports, "startBridge", () => startBridge);
};
__defs[53] = function (__exports) {
'use strict';
// main.ts

// Entry of dist/studio-edit.js — the edit script injected as the first child
// of <head> in the game page, so it runs before any game code.
//
// Order matters:
// 1. core (time control + load log) wraps browser APIs before the game uses them
// 2. built-in probes install their engine hooks (e.g. __THREE_DEVTOOLS__)
// 3. window.studio is published so `.studio/adapter.js` (loaded next by the
//    host, still before the game) can register an AI-written adapter
// 4. after the first frame, the bridge picks an adapter and talks to the shell
// Capture the browser's own rAF before any wrapper (see core/native.ts).
__require(0);
// boot.js (classic, side effects only) must run before everything else of
// the three.js adapter: it installs __THREE_DEVTOOLS__ and wraps rAF/render.
__require(1);
const { threeProbe } = __require(12);
const { startBridge } = __require(52);

startBridge({ builtins: [threeProbe] });


};
__require(53);
})();
