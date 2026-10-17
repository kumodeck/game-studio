# src/adapters/three

Created: 2026-10-15
Purpose: the three.js adapter — lets the editor find, select and move objects in any game written with plain three.js
(r170 and r186 verified), without changes to the game's code. Implements the StudioAdapter interface of CONTRACT.md.

## How it hooks in

1. `boot.js` (classic script) is inserted as the FIRST script of the game page. It installs `window.__THREE_DEVTOOLS__`
   (three announces every Scene / WebGLRenderer to it), wraps `requestAnimationFrame` (so the game can be held),
   wraps `renderer.render` (to learn the player's camera) and records loads (for the asset library).
2. `adapter.js` (module) — `await whenThreeReady()` returns the adapter once the game has a scene and a camera.

Builds without the devtools hook: the game calls `studio.attach({ scene, renderer, camera })`.
Games whose start layout needs async work call `studio.waitForReady()` early and `studio.ready({ camera })` when done.

## Author marks (all optional)

| Mark | Meaning |
|---|---|
| `userData.studioKey = 'tree-1'` | stable key for placement.json (beats the name) |
| `userData.studio = false` | never list this object (or its children) |
| `userData.studio = 'children'` | list my children instead of me (level groups, glTF scene roots) |
| `userData.studioRotate = false` / `studioScale = false` | hide the rotate / scale handle |
| `userData.studioAsset = 'assets/x.glb'` | the file(s) this object is made of (makes the asset list certain) |

## Files

- `boot.js` — discovery, rAF holder, camera tracking, load records (runs before the game)
- `adapter.js` — the adapter: list, begin/end, pickNear, anchor, grab/drag, rotate, scale, nudgeY, setPose, capture, assetsOf, view
- `keys.js` — which objects are movable and their keys (pure; shared with the placement loader)
- `apply.js` — apply a placement.json to a scene (the three.js half of the loader)
- `pick.js` — bounds, ray casts, pickNear ordering rules
- `camera.js` — the edit camera (orbit / pan / zoom / frame)
- `focus.js` — what the edit camera frames: the object and its neighbours when picked from the list, the play area for frameAll (pure maths)
- `capture.js` — one-object thumbnails that bypass the game's render hooks
- `assets.js` — object → files it uses
- `math.js` — vector / matrix helpers (we do not import three; see the file)
- `dev/` — test harness standing in for the input bridge
- `test/` — unit tests and the headless real-input browser test

## Tests

    node --test oss/game-studio/src/adapters/three/test/keys.test.mjs
    node --test oss/game-studio/src/adapters/three/test/browser.test.mjs   # headless Chrome, see the file header
