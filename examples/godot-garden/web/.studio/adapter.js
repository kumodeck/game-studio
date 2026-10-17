// KUMODeck Game Studio — example 2D adapter for a Godot 4 Web export.
//
// HOW TO USE: copy this file to `.studio/adapter.js` next to the exported
// index.html, and studio_bridge.gd (same folder) into the Godot project as
// the Autoload "StudioBridge". It only runs inside the studio's edit mode.
//
// The Godot side answers every question (see studio_bridge.gd); this file only
// turns window pixels into CSS pixels of the page and implements Port2D.
//
// Time: Godot draws from its own main loop (driven by requestAnimationFrame).
// If the studio held those callbacks, Godot would stop drawing too and the
// edit view would never update. So this adapter hands Godot the real
// requestAnimationFrame and pauses the GAME inside Godot instead
// (SceneTree.paused: logic stops, drawing goes on).
(function () {
  'use strict';
  const studio = window.__gameStudio || window.studio;
  if (!studio) return;

  // Installed before the game's scripts: every rAF on this page is Godot's.
  window.requestAnimationFrame = (cb) => studio.core.time.raf(cb);
  window.cancelAnimationFrame = (id) => studio.core.time.cancelRaf(id);

  const bridge = () => window.godotStudio || null;
  const ask = (op, extra) => {
    const b = bridge();
    b.out = 'null';
    b.call(JSON.stringify({ op, ...extra }));
    return JSON.parse(b.out);
  };
  // EDIT HERE if the page has more than one canvas.
  const canvas = () => document.querySelector('canvas');
  // Window pixels (Godot) -> CSS px (page).
  function css() {
    const cv = canvas();
    const r = cv.getBoundingClientRect();
    return [r.width / cv.width, 0, 0, r.height / cv.height, r.left, r.top];
  }
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];

  studio.register2D(() => {
    if (!bridge() || !canvas()) return null;
    return {
      name: 'godot',
      version: bridge().version,
      objects: () => ask('objects') || [],
      get: (key) => ask('get', { key }),
      set: (key, pose) => { ask('set', { key, pose }); },
      parentToScreen(key) {
        const m = ask('parentToScreen', { key });
        return m ? mul(css(), m) : null;
      },
      bounds(key) {
        const b = ask('bounds', { key });
        if (!b) return null;
        const k = css();
        return { x: k[4] + b.x * k[0], y: k[5] + b.y * k[3], w: b.w * k[0], h: b.h * k[3] };
      },
      // Godot keeps drawing every frame by itself (see the note at the top).
      render() {},
      setView(v) {
        const k = css();
        ask('setView', { view: { x: v.x / k[0], y: v.y / k[3], zoom: v.zoom } });
      },
      pause: () => { ask('pause'); },
      resume: () => { ask('resume'); },
      assetsOf: (key) => ask('assets', { key }) || [],
      canvas,
    };
  });
})();
