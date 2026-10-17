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
    placed: false          // true from that render until the hold: the rest of that frame is not drawn (see wrapRender)
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
        if (state.held) { parked.set(id, cb); return; }
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
    var cbs = Array.from(parked.values());
    parked.clear();
    // Replay on a real frame so the game sees a fresh timestamp (its clock will report a long delta — games
    // normally clamp dt; the editor reloads the game after saving anyway).
    if (cbs.length && nativeRAF) nativeRAF(function (ts) { for (var i = 0; i < cbs.length; i++) cbs[i](ts); });
    emit('release');
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
    setTimeout(function () { if (state.waitingForReady) { state.waitingForReady = false; hold('ready-timeout'); } }, 8000);
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
        setTimeout(function () { if (state.holdAfterCamera) { state.holdAfterCamera = null; putBackLayout(); hold('ready'); } }, 1500);
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
  state.nativeRAF = nativeRAF;
  state.on = function (fn) { state.listeners.push(fn); };
  state.kindOf = kindOf;
  state.absUrl = absUrl;
})();
