// Firefly Ruins — an old stone gate by a still pond at sunset. Fireflies come out; tap to send a breeze.
//
// A 2D starter for KUMODeck Game Studio (PixiJS v8). Every picture is painted at load (paint.js), so there are no
// image files and it opens fast. The 14 things you can arrange are containers with a `studioKey` (objects.js);
// everything else (sky, hills, mist, light, pond, fireflies) is marked `studio = false`.
//
// Draw order, back to front:
//   sky · sun · hills · mist · bank → the ruins → light shafts (they fall ON the ruins) → pond (with the
//   reflection of everything above it) → boat and reeds (in the water) → fireflies, dust, leaves → vignette
//
// URL switches (tests and the shots in docs/): ?fixed=30 → each frame advances exactly 1/30 s.
import { Application, Container, Rectangle, Sprite } from 'pixi.js';
import { applyPlacement } from '../studio-placement.js';
import { paint } from './paint.js';
import { makeBackdrop, W, H, WATER } from './backdrop.js';
import { makeObjects } from './objects.js';
import { makePond } from './pond.js';
import { makeLife } from './life.js';

const params = new URLSearchParams(location.search);
const FIXED = Number(params.get('fixed')) || 0;

const app = new Application();
await app.init({ resizeTo: window, background: 0x16263d, antialias: true, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true, preserveDrawingBuffer: FIXED > 0 });
document.body.prepend(app.canvas);

const backdrop = makeBackdrop();
const objects = makeObjects();
const pond = makePond(app.renderer);
const life = makeLife(objects);
const vignette = new Sprite(paint(256, 160, (ctx, w, h) => {
  const g = ctx.createRadialGradient(w / 2, h * 0.55, h * 0.35, w / 2, h * 0.55, w * 0.62);
  g.addColorStop(0, 'rgba(8,10,20,0)'); g.addColorStop(1, 'rgba(8,10,20,0.55)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}));
vignette.studio = false;

app.stage.addChild(backdrop.back, backdrop.bank, ...objects.back, backdrop.shafts, pond.pond, ...objects.front, life.layer, vignette);
await applyPlacement(app.stage, './placement.json');

// ------------------------------------------------------------------ fit the 1280×800 world to any window
// Landscape: the whole world, centred. Portrait phones: zoom in on the middle (the gate, the head, the lantern)
// and put the waterline a little below the middle, so the reflection has room.
function fit() {
  const w = app.screen.width, h = app.screen.height;
  let s = Math.min(w / W, h / H);
  if (w < h) s = Math.max(s, w / (W * 0.55));
  const x = (w - W * s) / 2, y = w < h ? h * 0.56 - WATER * s : (h - H * s) / 2;
  app.stage.scale.set(s);
  app.stage.position.set(x, y);
  vignette.position.set(-x / s, -y / s);
  vignette.width = w / s;
  vignette.height = h / s;
}
app.renderer.on('resize', fit);
fit();

// ------------------------------------------------------------------ reflection (also before each editor frame)
const hideForReflection = [pond.pond, vignette, ...objects.front.filter((o) => o.studioKey === 'boat')];
function reflect() {
  const was = hideForReflection.map((o) => o.visible);
  hideForReflection.forEach((o) => (o.visible = false));
  pond.capture(app.stage);
  hideForReflection.forEach((o, i) => (o.visible = was[i]));
}
// The editor pauses the game and draws frames itself; .studio/adapter.js calls this first so the pond keeps
// mirroring what the user moves. Exists only while editing.
// The vignette is sized to the game's own view; under the editor's zoomed-out camera its edges would show, so the
// editor draws without it.
if (window.studio) window.studio.game = { beforeDraw() { vignette.visible = false; reflect(); } };

// ------------------------------------------------------------------ input: a tap sends a breeze; the bell rings
const hint = document.getElementById('hint');
app.stage.eventMode = 'static';
app.stage.hitArea = new Rectangle(-1e5, -1e5, 2e5, 2e5);
app.stage.on('pointerdown', (e) => {
  const p = e.getLocalPosition(app.stage);
  hint && hint.classList.add('gone');
  const bell = objects.all.find((o) => o.studioKey === 'bell');
  if (bell && bell.parent && bell.visible && Math.hypot(p.x - bell.x, p.y - (bell.y - 150 * bell.scale.y)) < 70 * Math.abs(bell.scale.x) + 20) {
    life.ring(1);
    return;
  }
  life.breeze(p.x, p.y);
  if (p.y > WATER + 4) pond.ripple(p.x, p.y, 1);
});

// Pose every moving part once now: the editor can pause the game before its first tick, and the fireflies, the
// cloth and the reflection must already look right in that very first frame.
backdrop.step(0, 0);
life.step(0, 1 / 60);
pond.step(0, 0);
reflect();
// Tell the editor the stage is fitted and posed, so it reads the objects now instead of waiting for a frame
// (Lantern Cove does the same). `?.` keeps the game running unchanged without the editor.
window.studio?.ready?.();

// ------------------------------------------------------------------ loop
let t = 0, frames = 0, firstFrameAt = 0;
const ft = [];
let rippleClock = 0;
app.ticker.add((tk) => {
  const real = tk.deltaMS / 1000;
  const dt = FIXED ? 1 / FIXED : Math.min(real, 1 / 20);
  t += dt;
  frames++;
  if (frames > 1 && !FIXED) { ft.push(tk.deltaMS); if (ft.length > 120) ft.shift(); }
  backdrop.step(t, dt);
  life.step(t, dt);
  pond.step(t, dt);
  // Now and then a fish touches the surface (the pond is alive even when nobody taps).
  rippleClock += dt;
  if (rippleClock > 3.2) { rippleClock = 0; pond.ripple(200 + ((t * 977) % 900), WATER + 30 + ((t * 131) % 120), 0.6); }
  reflect();
  if (!firstFrameAt) firstFrameAt = performance.now(); // ms since the page started loading (engine download included)
});

// Test hook (headless shots and the speed check in docs/). Not used by the game itself.
window.__ruins = {
  stats: () => ({ t, frames, first: firstFrameAt, fps: ft.length ? 1000 / (ft.slice(-60).reduce((a, b) => a + b, 0) / Math.min(60, ft.length)) : 0 }),
  breeze: (x, y) => { life.breeze(x, y); if (y > WATER) pond.ripple(x, y, 1); },
  ring: () => life.ring(1),
};
