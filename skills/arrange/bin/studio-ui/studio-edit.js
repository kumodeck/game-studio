/* KUMODeck Game Studio 0.1.5 — MIT License — built file, edit src/ instead */
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
const nativeCancelRaf                       =
  typeof window !== 'undefined' ? window.cancelAnimationFrame.bind(window) : (id) => clearTimeout(id);

__def(__exports, "nativeRaf", () => nativeRaf);
__def(__exports, "nativeCancelRaf", () => nativeCancelRaf);
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

/** Screen box of ONE mesh's own geometry box (not its children), in ndc like screenRect, or null. */
function meshScreenRect(mesh, viewProj) {
  const b = localBox(mesh);
  if (!b) return null;
  let r = null;
  for (const c of boxCorners(b[0], b[1])) {
    const q = project(viewProj, applyM4(mesh.matrixWorld.elements, c));
    if (q[3] <= 0) continue;
    if (!r) r = [q[0], q[1], q[0], q[1]];
    else (r[0] = Math.min(r[0], q[0])), (r[1] = Math.min(r[1], q[1])), (r[2] = Math.max(r[2], q[0])), (r[3] = Math.max(r[3], q[1]));
  }
  return r;
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
    const r = screenRect(c.object, viewProj);
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
 *   fly(r, u, f):  WASD — the camera and its turning point together, scaled to the scene (see fly)
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
     * the normal speed (the bridge passes the frame's dt; Shift multiplies it). fwd follows the line of sight, so W
     * dives where you look, as in Unity / Unreal / Godot; up is straight up (the same as rise), right is level.
     * Speed: FLY_PER_S of the distance to the turning point, kept within 0.25–2 scene radii — the view crosses
     * about the same share of the screen per second in a small room and on Lantern Cove, slows down close to a
     * small prop, and never crawls (or races) when zoomed very far in (or out). The height keeps rise's bound;
     * sideways has none, as pan (engines let you fly anywhere, under the ground too).
     */
    fly(right, up, fwd) {
      const sp = FLY_PER_S * Math.min(Math.max(st.distance, st.radius * 0.25), st.radius * 2);
      const cp = Math.cos(st.pitch);
      const look = [-cp * Math.sin(st.yaw), -Math.sin(st.pitch), -cp * Math.cos(st.yaw)];
      const side = [Math.cos(st.yaw), 0, -Math.sin(st.yaw)];
      st.target = v.add(st.target, v.scale(v.add(v.add(v.scale(side, right), [0, up, 0]), v.scale(look, fwd)), sp));
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

function captureObject({ renderer, scene, render, boot, baseCamera, yaw }, object, size = 128) {
  const canvas = renderer.domElement;
  const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
  const px = Math.max(16, Math.min(size, canvas.width, canvas.height));
  scene.updateMatrixWorld(true);
  const box = worldBox(object);
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
const { project, rayFromCamera, rayPlaneY, viewProjOf, wrapAngle } = __require(3);
const { pickNear: pickNearImpl, screenRect, screenShare, worldBox } = __require(4);
const { createEditView, yawOfCamera } = __require(5);
const { captureObject } = __require(6);
const { assetsOf: assetsOfImpl } = __require(7);
const { focusSphere, sceneSphere } = __require(8);

const DEG = Math.PI / 180;
const S_MIN = 0.01;
const S_MAX = 1000;

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
      setTimeout(tick, 50);
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
  const leaveHome = () => { atHome = false; glide = 0; };
  /**
   * Move the edit camera from view state `from` to `to` in 0.6 s (ease in-out), starting at `from`. Any look-around
   * gesture (leaveHome / a new glide) stops it where it is. `done` runs at the end. `stop()` true ends it early (the
   * glide home stops once the person moved the view: atHome went false).
   */
  function glideTo(from, to, done, stop) {
    view.set(from);
    const gen = ++glide;
    const t0 = performance.now();
    const MS = 600;
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const lerp = (a, b, k) => a + (b - a) * k;
    // The short way round (yaw is unbounded after orbiting: 350° → 10° turns 20°, not 340°).
    const yawTo = from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw));
    const step = () => {
      if (gen !== glide || !editing || (stop && stop())) return;
      const t = Math.min(1, (performance.now() - t0) / MS);
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
  function item(c) {
    const o = c.object;
    const pose = poseOf(o);
    return {
      key: c.key,
      label: c.label,
      kinds: kindsOf(o),
      group: groupOf(c),
      unstable: c.unstable || undefined,
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

  /** Hide the game's own DOM (HUD, menus, touch sticks) next to the canvas while editing — it would cover objects. */
  function hideOverlays() {
    for (let el = canvas; el && el.parentElement; el = el.parentElement) {
      for (const sib of el.parentElement.children) {
        if (sib === el || sib.hasAttribute('data-studio-keep') || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(sib.tagName)) continue;
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
      return refresh().map(item);
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

    /** Start a move: the press point is caught on the horizontal plane at the pivot height; drag() keeps that offset. */
    grab(key, ndcX, ndcY) {
      const o = objectOf(key);
      if (!o || !view) return false;
      syncView();
      const pivot = pivotOf(o);
      const hit = rayPlaneY(rayFromCamera(view.camera, ndcX, ndcY), pivot[1]);
      if (!hit) return false;
      grabs.set(key, { y: pivot[1], off: [hit[0] - pivot[0], hit[2] - pivot[2]] });
      return true;
    },

    drag(key, ndcX, ndcY) {
      const o = objectOf(key);
      if (!o || !view) return null;
      if (!grabs.has(key) && !adapter.grab(key, ndcX, ndcY)) return poseOf(o);
      syncView();
      const g = grabs.get(key);
      const hit = rayPlaneY(rayFromCamera(view.camera, ndcX, ndcY), g.y);
      if (!hit) return poseOf(o); // pointing at the sky: keep the object where it is
      const w = worldOrigin(o);
      setWorldPosition(o, [hit[0] - g.off[0], w[1], hit[2] - g.off[1]]);
      touch();
      return poseOf(o);
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
      const now = performance.now();
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
__defs[10] = function (__exports) {
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
                                                                     
const { createThreeAdapter } = __require(9);
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
    setPose: (key, p) => raw.setPose(key, p),
    capture: (key, o) => raw.capture(key, o),
    silhouette: (keys) => raw.silhouette(keys),
    clone: (key, newKey) => raw.clone(key, newKey),
    remove: (key) => raw.remove(key),
    putBack: (key) => raw.putBack(key),
    assetsOf: (key) => raw.assetsOf(key),
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
__defs[11] = function (__exports) {
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
 * corner; below it the game is free to the edge).
 */
                                                                                                     

/** shell -> bridge */
                           
                                                                  
                                                  
                                            
                                     
     
                                                                              
                                                                        
                                                                       
     
                                                                                             
                                                                                                              
                                                   
     
                                                                            
                                                                           
                                                                          
                                                                                                                    
                                                                                                                    
                                                                                                      
     
                                                                                                            
                                                                   
                                                       
                                                        
                                                              
     
                                                                               
                                                                               
                                                                              
                                      
     
                                                                                                                                                                   
                                                                     
                                     
                                                                      
                                                                                     
                                                             
     
                                                                      
                                                                             
                                                                           
                                             
     
                                                                                         
     
                                                                            
                                                                                
     
                                                                      
                                                                                       
                                                              
                                                                                                   
                                                             
                                                                                             
                                                  
     
                                                                                                                      
                                                                                                                 
                                                                               
     
                                                              
     
                                                                                                             
                                                                                                                   
     
                                                  
                                                       
                                                              
                                                                                
                                   
                                                 

/** bridge -> shell */
                           
                                                                            
                                                   
                                                                                
                                                                                   
                                                                                                                     
                                                                                                              
                                                                                                                                 
                                                      
                                                          
                                                                                      
                                                                                                                      
                                                  
                                                                                                               
                                                                       
                                                     
                                                                                           
     
                                                                          
                                                                             
                                                                       
                                                       
     
                                                                                                                                                         
     
                                                                              
                                                                             
                                                                         
     
                                                                                                                                                                                 
                                                                                                            
                                                                                                                                  
                                                                       
                                                                                     
                                                             
                                                                                                                       
                                                    
     
                                                                                                                   
                                                                                                                    
                                                                                                                
                                                                                                                    
     
                                                                                                  
                                                                                           
                                                                  
                                                   
                                                       
                                                                             
                                                                              

                                                          

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
                              
                     
                
                 
 

                             
                                                                       
                                                                       
                                                           
                                             
     
                                                                          
                                                                         
                                                                          
                                                                           
                                                                             
                                                                            
                   
     
                                                                                                                                                        
                                                                       
                                                                           
                                 
                                                                               
                                                  
     
                                                                             
                                                               
                                                                
     
                                                                                                                
     
                                                                   
                                                                             
                                                                           
                                                                        
     
                                                                                                                   
     
                                                                           
                                                                            
                                                                           
                                                                            
                                                       
     
                                                                                                                            
     
                                                                             
                                                                         
                                                                          
                                                                             
                                                                          
                                                                    
     
                                                                                                                                                      
     
                                                                              
                                                                       
     
                                                      
                                                                      
                             
                                                                   
                                                                                                        
                                           
                                               
                                         
                                                                                
                                                                                          
                                          
     
                                                                    
                                                                            
                                                                           
                                                                             
              
     
                             
     
                                                                              
                                                                                
                                                                       
                                                                            
                                                              
     
                           
 

/** The person's KUMODeck sign-in as the editor sees it (never a key). */
                             
                    
                                                          
                       
                                               
                    
                 
                  
                                  
                        
                    
                                                                
                           
                                                                             
                                                
                                                             
                       
                                                                            
                                                 
                                       
                   
                                            
 

                          
             
                 
                 
                                                  
                      
                               
                                            
 

/**
 * A KUMODeck refusal, in a code the editor words itself: signed_out,
 * needs_terms (agree once, then send again with acceptTerms), not_enough
 * (balance), not_open / not_allowed (not available to this account yet),
 * no_project, too_many, unreachable, failed …
 */
                              
            
               
                  
                        
                     
 

                                     
                 
                 
                  
                                
                                                       
                          
                
                                                                   
                        
 

                                   
                 
                    
                        
 

                           
                                
                                                             
                                                                                                                                                   
                                                                       
                                                                                  
                                                                   
 

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
__defs[12] = function (__exports) {
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
__defs[13] = function (__exports) {
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
// setTimeout/setInterval or audio clocks are not frozen here; adapters can add
// their own pause()/resume() for those.
//
// WHY "after the first frame": edit mode should show the scene as the game
// first draws it. Freezing before any frame shows an empty canvas; freezing
// later lets objects move away from their start positions. A game can call
// studio.ready() to pick the moment itself (e.g. after async loading).
//
// The studio's own drawing uses raf(), which always reaches the real browser
// function, so the editor keeps animating handles while the game is frozen.
                                                  
const { nativeCancelRaf, nativeRaf } = __require(0);

                                   

                              
                                                                                  
                                 
                                                                                        
                               
                                   
 

                                                      
                                                  
                
                                                                            
                              
                                                                                  
                             
                                                  
                                
 

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
        e.cb(t);
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
    for (const id of [...pending.keys()]) schedule(id);
  }

  if (opts.firstFrameTimeoutMs) {
    const ms = opts.firstFrameTimeoutMs;
    const start = () => win.setTimeout(() => {
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
__defs[14] = function (__exports) {
'use strict';
// ../core/index.ts

// src/core: shared services inside the game page (time control, load log).
// Installed by the edit script before any game code runs.
                                                  
const { installLoads } = __require(12);
const { installTime } = __require(13);

                                           
                        
 

function installCore(opts             )       {
  return { time: installTime(opts), loads: installLoads(opts.win) };
}

__def(__exports, "installCore", () => installCore);
};
__defs[15] = function (__exports) {
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
const { LIMITS } = __require(11);
                                       

                                                            

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
__defs[16] = function (__exports) {
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
const { KEY_RE } = __require(11);
                                             

                                               

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
  // few px may not change a 32×32 fingerprint in a meaningful way).
  const sample = items.find((it) => {
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
__def(__exports, "runSelfCheck", () => runSelfCheck);
};
__defs[17] = function (__exports) {
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
      return fix(key, inner.drag(key, x, y), true);
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
__defs[18] = function (__exports) {
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
__defs[19] = function (__exports) {
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
  for (const k of s.keys) if (movable(s, k) && s.items.get(k)?.liftable !== false) adapter.nudgeY(k, dy);
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
__defs[20] = function (__exports) {
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
const { TOOL_ID_RE } = __require(11);
                                             

                               
                                  
                         
                   
                                     
                                       
                   
                        
 

                           
                                    
                                    
                                                                       
                                       
                    
                
                                           
                  
                             
                   
                 
 

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
__defs[21] = function (__exports) {
'use strict';
// ../core/keys.ts

// Keyboard steps shared by the bridge (keys pressed while the game frame has
// focus) and the shell (keys pressed in the side panel), so both feel the same.
                                                    

                                                                                                              

/**
 * Keyboard steps on the selected object. Screen-relative so they feel the
 * same in 2D and 3D: arrows move 10 px on screen (Shift: 1 px), Q/E rotate
 * 15° (Shift: 1°), PageUp/PageDown raise/lower (3D), +/- scale by 10%.
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
__defs[22] = function (__exports) {
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
const { UI } = __require(11);

                                   

/** The tools' keys (also in the tooltips and in ⌘K): the English initials, none taken by another single key (Q/E steps, R axis, F, P). */
const TOOL_KEYS                             = { move: 'M', lift: 'H', rotate: 'T', scale: 'S' };
/** 1–4: the same tools in the 3D strip's order (basics pass, 2026-10-18; shell/keymap.ts). Not W/E/R: E turns, R is the axis. */
const TOOL_NUMBERS                             = { move: '1', lift: '2', rotate: '3', scale: '4' };
const toolFromKey = (key        )                    =>
  (Object.keys(TOOL_KEYS)                ).find((k) => TOOL_KEYS[k] === key.toUpperCase() || TOOL_NUMBERS[k] === key) ?? null;

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
 * The one line shown the first time a tool is chosen (then never again on
 * this computer): what a drag does now and how to look around instead.
 * Mac 3D tools' habits: Option-drag orbits, right / middle drag pans, Space
 * held = the hand; on touch one finger is the tool, two fingers look.
 */
const TOOL_HINT                                                                                     = {
  en: { mouse: (t) => `Drag anywhere: ${t} · Look around: ⌥-drag, right-drag, or hold Space · Esc: no tool`, touch: (t) => `One finger: ${t} · Two fingers: look around` },
  ja: { mouse: (t) => `どこでも引く: ${t} ・ 見回す: ⌥ か右ボタンで引く、Space を押しながら ・ Esc: 道具をやめる`, touch: (t) => `1 本指: ${t} ・ 2 本指: 見回す` },
};
/**
 * Added to the turn tool's first-time line in 3D: where the tilts are. Was "Press Turn again to tilt" (polish pass
 * 2026-10-16); play test 2026-10-18: "nobody presses a button twice" — the tilts are behind the ▾ on the button now.
 */
const TILT_HINT                       = {
  en: ' · Tilt: ▾ on Turn',
  ja: ' ・ 倒すのは「回す」の ▾ から',
};
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
button:active, button.on { color: #1c1c1e; background: #f5f5f7; cursor: grabbing; transition-duration: 0s; }
button:focus-visible { outline: 2px solid ${YOU}; outline-offset: 1px; }
button[hidden] { display: none; }
/* Touch: past 44 px for the finger, whatever the drawn size. */
@media (pointer: coarse) { button::after { content: ""; position: absolute; inset: -2px; } }
svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.6px; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
.big svg { width: 20px; height: 20px; }
svg * { vector-effect: non-scaling-stroke; }
/* Outlines: a canvas per shape, a rounded box when there is no shape. */
.ol { position: absolute; pointer-events: none; }
.box { position: absolute; border: 1.5px solid var(--c); border-radius: 6px; box-sizing: border-box; pointer-events: none; }
/* Name tags: the only filled colour on the game (your hand / the AI's hand), round-ended so they read as labels. */
.tag { position: absolute; display: none; height: 22px; padding: 0 9px; border-radius: 999px; align-items: center; gap: 4px; color: #fff; white-space: nowrap; font-weight: 600;
  transform: translate(-50%, -100%); box-shadow: 0 1px 2px rgba(0,0,0,.2), 0 4px 12px rgba(0,0,0,.18); max-width: 60vw; overflow: hidden; text-overflow: ellipsis; }
.tag.you { background: ${YOU}; }
.tag.ai { background: ${AI}; }
/* Stand-in copy: see-through picture of the original, dashed edge ("dashed = not real yet"). */
.ghost { position: absolute; opacity: .6; outline: 1.5px dashed rgba(255,255,255,.9); border-radius: 4px; pointer-events: none; background-size: 100% 100%; }
.band { position: absolute; border: 1px solid ${YOU}; border-radius: 2px; background: rgba(255,107,26,.1); display: none; pointer-events: none; }
/* The choices over the strip: big buttons, a picture over a short word. */
.menu { position: absolute; display: none; gap: 2px; padding: 6px; border-radius: 18px; transform: translateX(-50%);
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); animation: rise .24s cubic-bezier(.2,.8,.2,1); }
@keyframes rise { from { opacity: 0; transform: translateX(-50%) translateY(6px) scale(.985); } }
.menu button { width: auto; min-width: 76px; height: auto; padding: 8px 10px 6px; display: grid; gap: 4px; justify-items: center; cursor: pointer;
  font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; color: #a1a1a6; border-radius: 12px; }
.menu button svg { width: 24px; height: 24px; }
/* The chosen way: ink, not orange (orange is the picked object, on the game). */
.menu button.chosen { color: #1c1c1e; background: #f5f5f7; box-shadow: none; }
@media (pointer: coarse) { .menu button { min-width: 88px; min-height: 64px; } }
/* Two rows (3D, several picked): the axes, a hairline, then Together / Each in place — the size menu's words and
   order (multi rotate, 2026-10-18). Each row centred, the menu as wide as the wider row. */
.menu.rows { flex-direction: column; align-items: center; }
.menu .mrow { display: flex; gap: 2px; }
.menu .msep { align-self: stretch; height: .5px; margin: 4px 6px; background: rgba(255,255,255,.14); }
.root.light .menu .msep { background: rgba(0,0,0,.1); }
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
.root.light .menu button.chosen { color: #fff; background: #1d1d1f; }
.root.light button { color: #6e6e73; }
.root.light button:hover { color: #1d1d1f; background: rgba(0,0,0,.045); }
.root.light button.rest { color: #1d1d1f; background: rgba(0,0,0,.075); }
.root.light button:active, .root.light button.on { color: #fff; background: #1d1d1f; }
/* The readout while a drag works, and the first-time hint line: the same glass, the small size, tabular digits (rule 4). */
.chip, .hint { position: absolute; display: none; align-items: center; height: 24px; padding: 0 10px; border-radius: 999px; white-space: nowrap;
  font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif; font-variant-numeric: tabular-nums; color: #f5f5f7;
  background: rgba(28, 28, 30, .86); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.09), 0 1px 1px rgba(0,0,0,.2), 0 10px 32px rgba(0,0,0,.36);
  backdrop-filter: blur(30px); -webkit-backdrop-filter: blur(30px); }
.chip { transform: translateY(-50%); }
.hint { height: 32px; padding: 0 14px; font-weight: 400; transform: translateX(-50%); max-width: calc(100vw - 24px); overflow: hidden; text-overflow: ellipsis; animation: rise .24s cubic-bezier(.2,.8,.2,1); }
.root.light .chip, .root.light .hint { color: #1d1d1f; backdrop-filter: blur(30px) saturate(1.25); -webkit-backdrop-filter: blur(30px) saturate(1.25); background: rgba(251,251,253,.8); box-shadow: inset 0 0 0 .5px rgba(255,255,255,.7), 0 1px 1px rgba(0,0,0,.04), 0 10px 32px rgba(0,0,0,.13); }
@media (pointer: coarse) { .hint { height: 36px; font-size: 13px; } }
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
/** Draw a 2 px ring just outside the mask's shape, in `color`, on a faint dark halo. */
function ring(doc          , el                   , o         , color        ) {
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
  stamp(3 * dpr);
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
    const t = 2 * dpr;
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
  // Keep only the ring: the object itself stays exactly as the game draws it.
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(o.mask, 0, 0, W, H);
  g.globalCompositeOperation = 'source-over';
}

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
  // Order of the strip: move, height, turn, size (where it is, then how it sits).
  const kinds               = hasLift ? ['move', 'lift', 'rotate', 'scale'] : ['move', 'rotate', 'scale'];
  for (const k of kinds) {
    const b = doc.createElement('button');
    b.type = 'button';
    b.dataset.studioHandle = k;
    b.setAttribute('aria-label', HANDLE_LABELS.en[k]);
    b.title = HANDLE_LABELS.en[k];
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
  buttons.move.classList.add('rest');
  for (const k of kinds) buttons[k].setAttribute('aria-pressed', 'false');
  // One layer per kind of mark, bottom to top: ghosts, AI outlines, your outline, tags, strip, band.
  const ghostLayer = doc.createElement('div');
  const aiLayer = doc.createElement('div');
  const selLayer = doc.createElement('div');
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
    b.title = `${w[0]}${way} (${TOOL_KEYS.rotate}) — ${w[1]}`;
    b.setAttribute('aria-label', `${w[0]}${way} (${TOOL_KEYS.rotate})`);
  };
  let held                    = null;
  let chosen                    = null;
  const paintButtons = () => {
    for (const k of kinds) {
      buttons[k].classList.toggle('on', k === held || (k === chosen && !held));
      buttons[k].setAttribute('aria-pressed', String(k === chosen));
    }
    // While a tool is chosen or another button is held, move is not "the one at rest" any more.
    buttons.move.classList.toggle('rest', !chosen && (!held || held === 'move'));
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
    const vw = win.innerWidth - inset.left - inset.right;
    hintEl.style.left = `${inset.left + vw / 2}px`;
    hintEl.style.top = `${win.innerHeight - inset.bottom - 12 - hintEl.offsetHeight}px`;
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
  root.append(ghostLayer, aiLayer, selLayer, aiTag, youTag, row, menuEl, chip, hintEl, band);
  shadow.append(style, root);
  (doc.body || doc.documentElement).appendChild(host);

  const win = doc.defaultView ;
  let size         = UI.handlePx;
  let inset        = { top: 0, right: 0, bottom: 0, left: 0 };

  /** Fill a layer with the shape's ring, or with one box per rect; returns the box round all of it. */
  const outline = (layer             , shape                , rects        , color        )              => {
    if (shape) {
      let c = layer.firstElementChild                            ;
      if (!c || c.tagName !== 'CANVAS' || layer.children.length !== 1) {
        layer.replaceChildren();
        c = doc.createElement('canvas');
        c.className = 'ol';
        layer.append(c);
      }
      ring(doc, c, shape, color);
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
      if (!show || !a || !caps) {
        positionMenu();
        positionChip();
        return;
      }
      buttons.move.hidden = caps.movable === false;
      buttons.rotate.hidden = !caps.rotatable;
      buttons.scale.hidden = !caps.scalable;
      if (buttons.lift) buttons.lift.hidden = dim !== '3d' || caps.liftable === false;
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
        positionMenu();
        return;
      }
      const n = kinds.filter((k) => !buttons[k].hidden).length;
      if (n === 0) row.style.display = 'none';
      // .big (finger size): no gaps, 2 px in (W1-2); else 2 px gaps, 4 px in.
      const big = size >= 40;
      const rowW = big ? n * size + 4 : n * size + (n - 1) * 2 + 4;
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
          b.title = words[id] [1];
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
      menuEl.classList.toggle('rows', axes && !!way);
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
    setLabels(labels) {
      for (const k of kinds) {
        buttons[k].setAttribute('aria-label', labels[k]);
        // The turn button's tooltip names its axis (setAxis), with the key.
        if (k !== 'rotate' || !buttons[k].dataset.axis) buttons[k].title = labels[k];
      }
    },
    selection(shape, rects, tag) {
      tagAt(youTag, outline(selLayer, shape, rects, YOU), tag);
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
__def(__exports, "HANDLE_LABELS", () => HANDLE_LABELS);
__def(__exports, "READOUT_WORDS", () => READOUT_WORDS);
__def(__exports, "TOOL_HINT", () => TOOL_HINT);
__def(__exports, "TILT_HINT", () => TILT_HINT);
__def(__exports, "MORE_LABELS", () => MORE_LABELS);
__def(__exports, "AXIS_WORDS", () => AXIS_WORDS);
__def(__exports, "SCALE_WORDS", () => SCALE_WORDS);
__def(__exports, "TURN_WAY_WORDS", () => TURN_WAY_WORDS);
__def(__exports, "MANY_LABEL", () => MANY_LABEL);
__def(__exports, "createHandles", () => createHandles);
__def(__exports, "moreFromEvent", () => moreFromEvent);
__def(__exports, "choiceFromEvent", () => choiceFromEvent);
__def(__exports, "handleFromEvent", () => handleFromEvent);
};
__defs[23] = function (__exports) {
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
const { UI } = __require(11);

                                    

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
__defs[24] = function (__exports) {
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
//   the same id).
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
//   W / S forward / back along the line of sight, A / D left / right, E / Q straight up / down, Shift ×3 — smooth
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
const { UI } = __require(11);
                                             
const { keyStep } = __require(21);
                                             
                                                
const { HANDLE_LABELS, MANY_LABEL, READOUT_WORDS, TILT_HINT, TOOL_HINT, choiceFromEvent, createHandles, handleFromEvent, moreFromEvent, toolFromKey } = __require(22);
                                                     
const { createRiseButtons } = __require(23);
const { beginGroup, groupAnchor, groupLift, groupMove, groupPoses, groupRotate, groupScale } = __require(19);

                            
                         
             
                                  
                                     
                   
                                                        
                                                                                         
                                                               
                                                            
                      
                                                                               
                                                                                  
                  
                        
 

                              
                
                           
                            
                                  
                                                                                           
                               
                                                                             
                                         
                                                                        
                                         
                                                                          
                    
                                                                              
                             
                                                                                                        
                                              
                                          
                                                                                
                                                         
                 
 

               
             
               
            
            
             
             
                 
                 
                                                                          
               
                                                                                                                  
                 
                                                                                                                                  
                 
 

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
    flyLast = win.performance.now();
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
    const name = (READOUT_WORDS[lang] || READOUT_WORDS.en)[tool];
    const more = tool === 'rotate' && canTurn() ? (TILT_HINT[lang] || TILT_HINT.en) : '';
    handles.hint((touchFirst() ? words.touch(name) : words.mouse(name)) + more);
    // Gone after the first drag with the tool (it was read and used), or after 8 s.
    win.clearTimeout(hintTimer);
    hintTimer = win.setTimeout(() => handles.hint(null), 8000);
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
    if (k === 'lift') return adapter.dim === '3d' && !!adapter.nudgeY && picked.some((i) => i.liftable !== false && i.movable !== false);
    if (k === 'rotate') return picked.some((i) => i.rotatable);
    return picked.some((i) => i.scalable);
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
    win.clearTimeout(pressTimer);
    pressTimer = win.setTimeout(() => {
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
      const dy = Math.max(-5, Math.min(5, err * data.k ));
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
    const data                         = {};
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
      const dy = Math.max(-5, Math.min(5, err * data.k ));
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

  /** Share of the window (0–1) covered by the object's on-screen part (its box, clipped to the window). */
  const screenShare = (k        ) => {
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
  };
  /** The ground / background (or a huge object): what a person calls "nothing" when tapping (see the header). */
  const background = (k        ) => !!state.items.find((i) => i.key === k)?.backdrop || screenShare(k) >= HUGE_ON_SCREEN;
  /** What a tap at the point may pick, best first: pickNear without the background. */
  const tappable = (p     , radius        ) => {
    try {
      return adapter.pickNear(p.x, p.y, radius).filter((k) => !background(k));
    } catch {
      return [];
    }
  };

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
    win.clearTimeout(menuTimer);
    menuTimer = win.setTimeout(() => {
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
      win.clearTimeout(menuTimer);
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
      const t0 = win.performance.now();
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
    // Mouse moving with no button pressed = we missed the release.
    if (e.pointerType === 'mouse' && e.buttons === 0) {
      onUp(e);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    p.shift = e.shiftKey;
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
    win.clearTimeout(pressTimer);
    win.clearTimeout(menuTimer);
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    ptrs.delete(e.pointerId);
    if (mode.kind === 'rise') {
      riseEnd();
      mode = { kind: 'none' };
      return;
    }
    // A right-click (no travel): the place's menu instead of a tap (it picks only what is not picked yet).
    if (mode.kind === 'pending' && e.type === 'pointerup') {
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

  const onKey = (e               ) => {
    block(e);
    // Shortcuts that belong to the shell (undo, redo, save, escape...) are
    // forwarded so they work wherever focus is.
    post({ type: 'studio:core/key', key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey });
    flyFast = e.shiftKey;
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
  win.addEventListener('pointerdown', onDown, opts);
  // Before onMove: its block() stops the other listeners on window.
  win.addEventListener('pointermove', onHover, opts);
  win.addEventListener('pointermove', onMove, opts);
  win.addEventListener('pointerout', onLeave, opts);
  win.addEventListener('pointerup', onUp, opts);
  win.addEventListener('pointercancel', onUp, opts);
  win.addEventListener('wheel', onWheel, opts);
  win.addEventListener('keydown', onKey, opts);
  win.addEventListener('blur', onBlur, opts);
  // Before the blocking listener for keyup (it stops the others on window): Space let go ends "Space held".
  win.addEventListener('keyup', onKeyUp, opts);
  for (const t of blocked) win.addEventListener(t, block, opts);

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
  const shapes = { you: { sig: '', at: 0, shape: null                   }, ai: { sig: '', at: 0, shape: null                   } };
  let aiKeys           = [];
  let aiLabel                = null;
  const shapeOf = (which              , keys          , rects                                                       ) => {
    const c = shapes[which];
    if (!adapter.silhouette || !keys.length) {
      c.sig = '';
      c.shape = null;
      return null;
    }
    const sig = keys.join('\n') + '|' + rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)},${Math.round(r.h)}`).join(';') + '|' + JSON.stringify(adapter.view.state());
    const now = win.performance.now();
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
    if (key && state.group.length > 1) {
      const items = state.items.filter((i) => state.group.includes(i.key));
      const keys = items.map((i) => i.key);
      const rects = rectsOf(keys);
      handles.selection(shapeOf('you', keys, rects), rects, inRects(rects) ? (MANY_LABEL[lang] || MANY_LABEL.en)(items.length) : null);
      const ga = groupAnchor(adapter, state.group, key);
      handles.place(ga, items.length ? {
        rotatable: items.some((i) => i.rotatable), scalable: items.some((i) => i.scalable),
        movable: items.some((i) => i.movable !== false), liftable: items.some((i) => i.liftable !== false && i.movable !== false),
      } : null, adapter.dim);
      return;
    }
    const a = key ? adapter.anchor(key) : null;
    const item = key ? state.items.find((i) => i.key === key) : undefined;
    const rects = a && a.visible && a.rect ? [a.rect] : [];
    // No tag for an object without a name: its label is its key (`path:3/0`), an inner handle a person must never see
    // (dogfood 2026-10-17, U4). The card names it ("Unnamed shape"). inRects: the tag shows only on hover (Ive wave 1, W1-2).
    handles.selection(item ? shapeOf('you', [key ], rects) : null, item ? rects : [], item && a?.visible && inRects(rects) && !item.unstable ? item.label : null);
    handles.place(a, item ? { rotatable: item.rotatable, scalable: item.scalable, movable: item.movable !== false, liftable: item.liftable !== false } : null, adapter.dim);
  };

  return {
    frame: place,
    selectionChanged() {
      riseLabels();
      if (handles.menuOpen()) menu(null);
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
    setLang(l) {
      lang = l;
      handles.setLabels(HANDLE_LABELS[lang] || HANDLE_LABELS.en);
      riseLabels();
      axisShown = null;
      showAxis();
    },
    detach() {
      endGesture();
      win.clearTimeout(pressTimer);
      win.clearTimeout(menuTimer);
      win.removeEventListener('pointerdown', onDown, opts);
      win.removeEventListener('pointermove', onMove, opts);
      win.removeEventListener('pointermove', onHover, opts);
      win.removeEventListener('pointerout', onLeave, opts);
      win.removeEventListener('pointerup', onUp, opts);
      win.removeEventListener('pointercancel', onUp, opts);
      win.removeEventListener('wheel', onWheel, opts);
      win.removeEventListener('keydown', onKey, opts);
      win.removeEventListener('blur', onBlur, opts);
      win.removeEventListener('keyup', onKeyUp, opts);
      win.clearTimeout(hintTimer);
      for (const t of blocked) win.removeEventListener(t, block, opts);
      handles.destroy();
      if (riseFrame) core.time.cancelRaf(riseFrame);
      if (flyFrame) core.time.cancelRaf(flyFrame);
      riseUi?.destroy();
      doc.documentElement.style.touchAction = prevTouchAction;
    },
  };
}

__def(__exports, "attachInput", () => attachInput);
};
__defs[25] = function (__exports) {
'use strict';
// editor.ts

// Edit session inside the game page: applies shell messages to the adapter,
// runs the studio's own draw loop while the game is frozen, and reports
// changes back. Pointer gestures and handles are attached by input.ts.
                                                                                                                                               
                                             
const { withRules } = __require(17);
const { withEdits } = __require(18);
const { beginGroup, groupAnchor, groupLift, groupMove, groupPoses, groupRotate, groupScale, groupShift } = __require(19);
const { createToolHost } = __require(20);
const { attachInput } = __require(24);
const { runSelfCheck } = __require(16);

                             
                                                                         
                         
                                                                                        
                     
                                                                                 
                    
             
                                  
                                     
 

                         
                                   
                                                                              
                                    
                                                                                                           
                        
 

/** Shared state between the editor and the input layer. */
                            
                   
                                                                          
                          
                                                                                                  
                  
                                                                                         
                 
                
                                                                                               
                 
                                                                                                 
                            
                                                                                                                   
                           
 

function createEditor(deps            )         {
  const { core, win, post } = deps;
  const raw = deps.adapter;
  // Every edit goes through the copy/delete layer and the game rules layer;
  // the adapter itself is unaware of both.
  const edits = withEdits(raw);
  const adapter = withRules(edits, deps.rules);
  const state            = { editing: false, selected: null, group: [], multi: false, items: [], axis: 'y', scaleMode: 'spread', turnMode: 'spread' };
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
    post({ type: 'studio:placement/items', items: state.items });
  };

  const frame = () => {
    loopId = core.time.raf(frame);
    if (!state.editing) return;
    // Redraw every frame while editing: cheap for edit scenes, and it keeps
    // the picture correct when an engine re-uploads textures lazily.
    try {
      adapter.render();
    } catch {
      /* keep the loop alive; the error was reported when it first happened */
    }
    input?.frame();
    toolHost.frame();
    dirtyFrame = false;
  };

  // eslint-disable-next-line prefer-const -- assigned once below, used by closures declared first
  let toolHost                                   ;
  const postSelected = () => {
    const item = state.items.find((i) => i.key === state.selected);
    post({ type: 'studio:placement/selected', key: state.selected, item, keys: state.group.slice() });
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
      post({ type: 'studio:core/view-state', state: adapter.view.state() });
      return;
    }
    if (!adapter.view.restore) {
      post({ type: 'studio:core/view-state', state: adapter.view.state() });
      return; // no way back to the start: the slide happens at once
    }
    // Back to where it was, then the same slide over 0.35 s (ease out), as pan() steps that add up to `total`.
    adapter.view.restore(from);
    const t0 = win.performance.now();
    let done = 0;
    const tick = () => {
      if (gen !== panGlide || !state.editing) return;
      const t = Math.min(1, (win.performance.now() - t0) / GLIDE_MS);
      const e = 1 - (1 - t) ** 3;
      adapter.view.pan(total[0] * (e - done), total[1] * (e - done));
      done = e;
      dirtyFrame = true;
      if (t < 1) core.time.raf(tick);
      else {
        panGlide = 0;
        post({ type: 'studio:core/view-state', state: adapter.view.state() });
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
  const nextTurn = () => new Promise      ((r) => core.time.raf(() => win.setTimeout(r, 0)));
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
        post({ type: 'studio:placement/thumb', key: q.key, src });
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
      listPick = { key: state.selected, at: win.performance.now() };
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
    win.clearTimeout(stepRun.timer);
    const { key, from, op, group } = stepRun;
    stepRun = null;
    if (group) {
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, group, true), end: true, press: op          , hold: true });
      return;
    }
    const pose = poseOf(key);
    if (pose) post({ type: 'studio:placement/moved', key, pose, end: true, from, press: op          , hold: true });
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
      // Arrow keys move by screen px: the same as dragging the move handle by that much.
      run.dx += m.dx || 0;
      run.dy += m.dy || 0;
      groupMove(adapter, adapter.dim, g, run.dx, run.dy);
    } else if (m.op === 'rotate') {
      run.total += m.d || 0;
      // Q / E: upright, as for one object (the axis is the turn tool's), together or each in place as chosen.
      groupRotate(adapter, adapter.dim, g, run.total, { mode: state.turnMode });
    } else if (m.op === 'scale') {
      run.total *= m.d || 1;
      groupScale(adapter, adapter.dim, g, run.total, state.scaleMode);
    } else if (m.op === 'lift') groupLift(adapter, g, m.d || 0);
    dirtyFrame = true;
    if (m.hold) {
      stepRun = run;
      win.clearTimeout(run.timer);
      run.timer = win.setTimeout(closeStepRun, 400);
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, g, false), press: m.op, hold: true });
    } else {
      post({ type: 'studio:placement/moved-group', poses: groupPoses(adapter, g, true), end: true, press: m.op });
    }
  };

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
      if (adapter.grab(m.key, x, y)) pose = adapter.drag(m.key, x + (m.dx || 0), y + (m.dy || 0));
    } else if (m.op === 'rotate') pose = adapter.rotate(m.key, m.d || 0);
    else if (m.op === 'scale') pose = adapter.scale(m.key, m.d || 1);
    else if (m.op === 'lift' && adapter.nudgeY) pose = adapter.nudgeY(m.key, m.d || 0);
    dirtyFrame = true;
    if (m.hold) {
      if (!stepRun) stepRun = { key: m.key, from, op: m.op, timer: 0, total: 0, dx: 0, dy: 0 };
      win.clearTimeout(stepRun.timer);
      stepRun.timer = win.setTimeout(closeStepRun, 400);
      post({ type: 'studio:placement/moved', key: m.key, pose, press: m.op, hold: true });
    } else {
      post({ type: 'studio:placement/moved', key: m.key, pose, end: true, from, press: m.op });
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
      const g = beginGroup(adapter, rest.map((f) => f.key), rest[0] .key);
      // 3D: groupMove moves the first copy on the ground and the others by the same metres.
      if (g) groupMove(adapter, adapter.dim, g, dx, 0);
    }
    for (const d of done) d.pose = adapter.anchor(d.key)?.pose ?? d.pose;
    dirtyFrame = true;
    refreshItems();
    post({ type: 'studio:placement/added', items: done.filter((d) => d.pose), failed });
    // The copies become the selection, so they can be moved (or copied again) at once.
    if (done.length) selectMany(done.map((d) => d.key), done[done.length - 1] .key);
  };

  /**
   * Put new copies in the middle of the free part of the frame (copy with `at: 'view'`). True when done.
   * 2D: a screen drag of the group from where the originals' box is drawn to the middle (stage space).
   * 3D: "on the ground where the camera looks". The middle of the view is often sky or far hills (Lantern Cove opens
   * on the player's camera, its horizon a little under the middle), so the spot is the first point straight down
   * from the middle whose ray meets the original's ground (toGround at its height): the lead copy's origin goes
   * there (the others by the same metres), then — now in front of the camera — a drag of its pivot onto that screen
   * point, so a long thing (the pier) is placed by its middle, not its origin. WHY: the first try (2026-10-18) only
   * dragged from the original's screen point to the middle; that ray hit the sky, the drag kept the object where it
   * was, and the pier copy stayed at the frame's right edge (off screen on a phone). Without toGround, or with no
   * ground anywhere under the middle: the drag from the originals' box, as in 2D.
   */
  const toView = (fresh                                      )          => {
    const keys = fresh.map((f) => f.key);
    const area = freeArea(inset.top);
    const tx = (area.x0 + area.x1) / 2, ty = (area.y0 + area.y1) / 2;
    const g = beginGroup(adapter, keys, keys[0] );
    if (!g) return false;
    const lead = g.from.get(g.primary);
    if (adapter.dim === '3d' && lead && adapter.toGround) {
      // From the middle down to 85 % of the free height: 0.5 = the middle itself (a camera looking down at the ground).
      for (const f of [0.5, 0.58, 0.66, 0.75, 0.85]) {
        const y = area.y0 + (area.y1 - area.y0) * f;
        const hit = adapter.toGround(tx, y, lead.p[1] ?? 0);
        if (!hit) continue;
        groupShift(adapter, g, [hit[0]  - (lead.p[0] ?? 0), 0, hit[2]  - (lead.p[2] ?? 0)]);
        const a = adapter.anchor(g.primary);
        const g2 = a && a.visible ? beginGroup(adapter, keys, g.primary) : null;
        if (g2 && a) groupMove(adapter, '3d', g2, tx - a.center[0], y - a.center[1]);
        return true;
      }
    }
    // The originals' box: the copies stand exactly there, but were made this frame (not drawn yet).
    const ga = groupAnchor(adapter, fresh.map((f) => f.from), fresh[0] .from);
    if (!ga || !ga.visible) return false;
    groupMove(adapter, adapter.dim, g, tx - ga.center[0], ty - ga.center[1]);
    return true;
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
      if (viewState !== undefined && adapter.view.restore) adapter.view.restore(viewState);
      else {
        // The opening view: the game's own camera when the adapter has one (three.js, polish pass 2026-10-16),
        // else everything in frame. Told to the shell at once, so a reload opens on it too (the three.js state
        // carries `home`, so the first pick after a reload still glides).
        if (adapter.view.home) adapter.view.home();
        else adapter.view.frameAll();
        // Tell the shell the first view too (not only after the person moves the camera): a reload
        // after the AI's change then opens on the same view, even when the AI's new objects would
        // make "frame all" choose another one (AI feel, 2026-10-16).
        post({ type: 'studio:core/view-state', state: adapter.view.state() });
      }
      state.editing = true;
      post({ type: 'studio:placement/items', items: state.items });
      input = attachInput({ adapter, edits, core, win, post, state, select, selectMany, step, tools: toolHost, markDirty: () => (dirtyFrame = true) });
      toolHost.announce();
      if (pendingHandlePx) input.setHandleSize(pendingHandlePx);
      input.setInset(inset);
      input.setTheme(theme);
      if (aiMarks.keys.length) input.setAiMarks(aiMarks.keys, aiMarks.label);
      input.setLang(lang);
      if (!loopId) loopId = core.time.raf(frame);
      if (!checked) {
        // Self-check once, in edit mode (3D adapters only know screen
        // positions once their edit camera exists).
        checked = true;
        // After the list and the first picture have painted (speed pass, 2026-10-17): the check draws twice and reads
        // the canvas back, which waits for the GPU to finish. Run at once, on a slow GPU it held the first paint of
        // the list by about a second (Lantern Cove in the play test's software GL).
        void nextTurn()
          .then(nextTurn)
          .then(() => runSelfCheck(raw, core, win))
          .then((result) => post({ type: 'studio:core/check', result }));
      }
    } else {
      closeStepRun();
      toolHost.activate(null);
      input?.detach();
      input = null;
      state.editing = false;
      try {
        adapter.end();
      } catch {
        /* the page is usually reloaded after editing anyway */
      }
    }
    post({ type: 'studio:core/ready', kind: adapter.kind, dim: adapter.dim, version: adapter.version, editing: state.editing, rise: adapter.dim === '3d' && !!adapter.view.rise, fly: adapter.dim === '3d' && !!adapter.view.fly });
  };

  toolHost = createToolHost({ win, adapter, state, post, select: (k) => select(k), lang: () => lang, markDirty: () => (dirtyFrame = true) });
  toolHost.register(deps.tools);

  return {
    driven: adapter,
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
            if (grew && lp && lp.key === state.selected && win.performance.now() - lp.at < 1000) {
              listPick = null;
              win.setTimeout(() => {
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
        case 'studio:core/edit':
          setEditing(msg.on, msg.viewState);
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
          post({ type: 'studio:core/view-state', state: adapter.view.state() });
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
          closeStepRun();
          const zBefore = msg.pose.z !== undefined ? poseOf(msg.key)?.z : undefined;
          const pose = adapter.setPose(msg.key, msg.pose);
          dirtyFrame = true;
          // No `end`: the shell already recorded this as undo/redo.
          if (pose) post({ type: 'studio:placement/moved', key: msg.key, pose });
          // A new draw order (2D layers) also shifts the z of the siblings:
          // send the whole list so the shell's order and file stay right.
          if (pose && pose.z !== undefined && pose.z !== zBefore) refreshItems();
          break;
        }
        case 'studio:placement/step':
          if (state.editing) step(msg);
          break;
        case 'studio:placement/thumbs': {
          // One queue, drawn one at a time; the newest request goes FIRST (tool-modes pass, 10/16). The shell
          // asks for the rows you can see whenever the list scrolls, so with hundreds of objects the rows in
          // view are drawn next instead of after every earlier request (before: each request ran on its own,
          // 200 at most, in list order — rows further down stayed empty boxes).
          const size = Math.min(256, Math.max(16, msg.size | 0));
          const fresh = msg.keys.filter((k) => typeof k === 'string').slice(0, 500);
          const ahead = new Set(fresh);
          thumbQueue = [...fresh.map((key) => ({ key, size })), ...thumbQueue.filter((q) => !ahead.has(q.key))].slice(0, 2000);
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
__defs[26] = function (__exports) {
'use strict';
// bridge.ts

// The bridge: the studio's side inside the game page.
//
// It owns the global API (window.studio), finds an adapter, runs the
// adapter self-check, and translates between the shell's messages and the
// adapter. Pointer input and handles live in input.ts / handles.ts; this file
// only wires them up.
const { CONTRACT_VERSION, LOCAL_PATHS, isStudioMessage } = __require(11);
const { installCore } = __require(14);
const { adapterFromPort2D } = __require(15);
const { runSelfCheck } = __require(16);
const { createEditor } = __require(25);
                                                    

                                
                           
                                   
 

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
  const core       = installCore({ freezeAfterFirstFrame: edit && !!inFrame, firstFrameTimeoutMs: 4000, win });

  // Probes registered by the game folder (.studio/adapter.js) go first so an
  // AI-written adapter can override a built-in one.
  const gameProbes                 = [];
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
    core,
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
   * ▶ Play inside the editor: show the saved copies (and deletions) the AI has
   * not put in the code yet, as the editor shows them (polish pass 2026-10-16,
   * play test stumble 2). WHY: a copy lives only in placement.json `added`
   * until the AI writes it into the code; the game's loader only moves
   * existing objects, so every copy vanished in Play and a first-time user
   * read it as "Copy is broken". Same rules as reopening the editor (shell
   * placement-model.ts applyFileEdits): a key the game already has is an
   * ordinary object now (skipped); a `removed` key is hidden only while its
   * label and pose still match `was`. The copy is a clone of the original as
   * it stands, so it looks right but does not act (a boat that floats, a
   * coin that spins) until the AI adds it to the code. Games run outside the
   * editor get the same copies from studio-placement.js (src/loader).
   */
  async function showFileEditsInPlay() {
                                                                                                       
                                                                             
    let file                                                  = null;
    try {
      const res = await fetch(new URL('placement.json', win.location.href).href, { cache: 'no-cache' });
      if (res.ok) file = await res.json();
    } catch {
      return;
    }
    const added = Array.isArray(file?.added) ? file .added  : [];
    const removed = Array.isArray(file?.removed) ? file .removed  : [];
    if (!added.length && !removed.length) return;
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
      await new Promise((r) => win.setTimeout(r, 150));
    }
    if (!a || !a.clone) return;
    let shown = 0;
    const has = (k        ) => a .list().some((i) => i.key === k);
    for (const e of added) {
      if (typeof e.key !== 'string' || typeof e.from !== 'string' || !Array.isArray(e.p)) continue;
      if (has(e.key) || !has(e.from)) continue;
      try {
        if (!a.clone(e.from, e.key)) continue;
        const pose                          = { p: e.p };
        if (typeof e.r === 'number') pose.r = e.r;
        if (e.s !== undefined) pose.s = e.s;
        if (Array.isArray(e.t)) pose.t = e.t;
        a.setPose(e.key, pose         );
        shown++;
      } catch (err) {
        console.warn('[studio] could not show the copy ' + e.key + ' in Play:', err);
      }
    }
    if (a.remove) {
      const items = a.list();
      for (const r of removed) {
        const it = typeof r.key === 'string' ? items.find((i) => i.key === r.key) : undefined;
        if (!it || (typeof r.label === 'string' && r.label !== it.label)) continue;
        const wp = r.was && Array.isArray(r.was.p) ? (r.was.p            ) : null;
        if (wp && it.pose && it.pose.p.some((v, i) => Math.abs(v - (wp[i] ?? 0)) > 1e-3)) continue;
        try {
          if (a.remove(it.key)) shown++;
        } catch {
          /* keep it */
        }
      }
    }
    if (shown) console.info(`[studio] Play: ${shown} saved cop${shown === 1 ? 'y or deletion' : 'ies or deletions'} shown (not in the code yet)`);
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
        win.setTimeout(go, 1600);
      } else coreReady();
    };
    prior.attach = (o                         ) => {
      threeAttach(o);
      coreAttach(o);
    };
    for (const k of ['version', 'registerAdapter', 'register2D', 'core', 'extend']         ) prior[k] = api[k];
    api.ready = prior.ready              ;
    api.attach = prior.attach                                        ;
  }

  if (inFrame) watchGameErrors();
  if (!edit && inFrame) void showFileEditsInPlay();
  if (!edit || !inFrame) return;

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
    for (let i = 0; !hasObjects(adapter) && !core.time.readyCalled && i < 55; i++) {
      post({ type: 'studio:core/wait', reason: adapter ? 'no-objects' : 'no-adapter' });
      core.time.thaw();
      await new Promise((r) => win.setTimeout(r, 150));
      adapter = findAdapter();
    }
    core.time.freeze();
    if (!adapter) {
      // Report "no adapter" now; a found adapter is checked by the editor
      // right after begin(), when 3D adapters have their edit camera.
      post({ type: 'studio:core/check', result: await runSelfCheck(null, core, win) });
      post({ type: 'studio:core/wait', reason: 'no-adapter' });
      return;
    }
    editor = createEditor({ adapter, core, win, post, rules, tools: pendingTools.splice(0) });
    editorRef = editor;
    // Read-only peek for headless tests and debugging (not part of the contract):
    // where the handles of an object are, and what is selected.
    // Through the editor's layers, so copies, deletions and rules show as the shell sees them.
    // under(x, y): the object right under a point of the game (radius 0: no finger slack), or null. Tests use it to
    // choose something to tap that nothing stands in front of (W1 merge 2026-10-17: in test/web-demo the earlier
    // visits' saves had moved a sailboat in front of the small sea stack, and the tap rightly picked the boat).
    const found = editor.driven;
    Object.defineProperty(api, '_debug', {
      value: Object.freeze({ anchor: (k        ) => found.anchor(k), list: () => found.list(), view: () => found.view.state(), foot: (k        ) => found.foot?.(k) ?? null,
        middle: (k        ) => found.middle?.(k) ?? null,
        under: (x        , y        ) => { try { return found.pickNear(x, y, 0)[0] ?? null; } catch { return null; } } }),
      enumerable: false,
    });
    post({ type: 'studio:core/ready', kind: adapter.kind, dim: adapter.dim, version: adapter.version, editing: false, rise: adapter.dim === '3d' && !!adapter.view.rise, fly: adapter.dim === '3d' && !!adapter.view.fly });
    for (const m of queue.splice(0)) editor.handle(m);
  });
}

__def(__exports, "readEditParams", () => readEditParams);
__def(__exports, "startBridge", () => startBridge);
};
__defs[27] = function (__exports) {
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
const { threeProbe } = __require(10);
const { startBridge } = __require(26);

startBridge({ builtins: [threeProbe] });


};
__require(27);
})();
