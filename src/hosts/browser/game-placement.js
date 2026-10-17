// Web demo only: answers the sample's own `fetch('./placement.json')` from the
// save kept in this browser (IndexedDB, written by src/hosts/browser/host.ts).
//
// WHY: with the local studio, Save writes placement.json next to the game, and
// the game's loader (studio-placement.js / placement.js) applies it on start —
// in edit mode and in Play. The demo has no server to write to, so without
// this the game would start from its code's layout and Play would show the
// objects back where they began. Injected first in each sample page by
// scripts/build-web-demo.mjs, with data-game="<id>".
//
// Must stay in step with store.ts (database, store) and host.ts (key "<id>/file/placement").
(function () {
  var game = document.currentScript && document.currentScript.dataset.game;
  if (!game || !window.indexedDB || !window.fetch) return;
  var here = new URL('placement.json', location.href).href;
  var realFetch = window.fetch.bind(window);

  function saved() {
    return new Promise(function (resolve) {
      var open;
      try {
        open = indexedDB.open('kumodeck-game-studio-demo', 1);
      } catch (e) {
        resolve(null);
        return;
      }
      open.onupgradeneeded = function () { open.result.createObjectStore('kv'); };
      open.onerror = function () { resolve(null); };
      open.onsuccess = function () {
        try {
          var r = open.result.transaction('kv', 'readonly').objectStore('kv').get(game + '/file/placement');
          r.onsuccess = function () { resolve(r.result || null); };
          r.onerror = function () { resolve(null); };
        } catch (e) {
          resolve(null);
        }
      };
    });
  }

  // Read the save NOW, while the page is still loading the engine and the game's modules, not when the
  // game asks. WHY (2026-10-17): opening IndexedDB takes longer than a frame the first time. A game that
  // does `await applyPlacement(...)` and only then sizes its stage (Firefly Ruins: fit() after it) was
  // frozen by the editor during that wait — the bridge freezes at the first frame that has objects
  // unless the game calls studio.ready() — so on a phone the editor kept the un-fitted stage (a small,
  // cut picture, and the adapter self-check "screen-changes" failed). With the save already in hand the
  // answer is ready at once and the game finishes its setup before the next frame.
  // A save made later in this page (the editor's Save, then Play) reloads the page, so one read per load is enough.
  var pending = saved();

  // Hold the game's frames while its placement.json answer is on the way, until the game has used it.
  // WHY (2026-10-17): reading the save early (above) was not enough. On a later visit the engine comes
  // from the browser cache, the game asks before IndexedDB has answered, and a frame runs during that
  // wait; the editor freezes the game at its first frame that has objects (unless the game calls
  // studio.ready(), which Firefly Ruins does not), so it froze before the game's own fit() and kept a
  // small, cut stage (seen at 430 px; the adapter self-check "screen-changes" failed). With the local
  // studio the 404 / file answer comes from the server within a frame, so the order holds there.
  // This script runs before the edit script, so the editor's own rAF wrapper (core/time.ts) and its
  // captured "native" rAF both sit on top of this one; nothing is held when no answer is on the way.
  var waiting = 0;
  var nextId = 1;
  var realIds = {}; // our id -> the browser's id of the current try
  var realRaf = window.requestAnimationFrame.bind(window);
  var realCancel = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    var id = nextId++;
    var tick = function (t) {
      if (waiting > 0) {
        realIds[id] = realRaf(tick);
        return;
      }
      delete realIds[id];
      cb(t);
    };
    realIds[id] = realRaf(tick);
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    if (realIds[id] !== undefined) realCancel(realIds[id]);
    delete realIds[id];
  };
  // Let go after the game's `await` chain has run on: a task later than the last answer it read.
  // Never longer than 2 s (under the editor's 4 s "no first frame" limit), whatever the game does.
  function hold() {
    waiting++;
    var done = false;
    var cap = setTimeout(release, 2000);
    function release() {
      if (done) return;
      done = true;
      clearTimeout(cap);
      waiting--;
    }
    return function later() { setTimeout(release, 0); };
  }

  window.fetch = function (input, init) {
    var url;
    try {
      url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, location.href);
    } catch (e) {
      return realFetch(input, init);
    }
    if (url.origin + url.pathname !== here) return realFetch(input, init);
    var letGo = hold();
    return pending.then(function (v) {
      // No save yet = the same as a game without placement.json: 404, the loader keeps the code's layout.
      if (!v) {
        letGo();
        return new Response('{"error":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } });
      }
      var res = new Response(JSON.stringify(v), { status: 200, headers: { 'content-type': 'application/json' } });
      // The loader reads it with res.json(); let go once that is read (or after the 2 s cap if it never is).
      var json = res.json.bind(res);
      res.json = function () {
        return json().then(function (x) { letGo(); return x; }, function (e) { letGo(); throw e; });
      };
      return res;
    });
  };
})();
