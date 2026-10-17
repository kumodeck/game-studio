// Garden — a tiny PixiJS v8 scene made to exercise the studio's Pixi adapter.
//
// It has the cases a real game has:
//   - Sprites with textures loaded from files (assets/*.svg)
//   - labelled objects (stable keys) and unlabelled ones (tree-path keys, unstable)
//   - a nested Container (a fence of posts): the fence and each post can move
//   - a repeated label (two "tree" sprites -> keys tree, tree#2)
//   - a studioKey marker, which wins over the label
//   - a UI layer and a background marked `studio = false`, which the studio leaves out
//   - a stage that is scaled to fit the window (the world is 800 x 600)
//   - a drifting cloud, to show that edit mode freezes time
import { Application, Assets, Container, Graphics, Sprite, Text } from 'pixi.js';
import { loadPlacement, applyPlacement } from './placement.js';

const W = 800;
const H = 600;
const app = new Application();
await app.init({ resizeTo: window, background: 0xb9e0a8, antialias: true });
document.body.appendChild(app.canvas);
const placement = await loadPlacement();

const tex = {};
for (const k of ['tree', 'rock', 'flower', 'house', 'post']) tex[k] = await Assets.load(`assets/${k}.svg`);
const sprite = (k, x, y, label) => {
  const s = new Sprite(tex[k]);
  s.anchor.set(0.5);
  s.position.set(x, y);
  if (label) s.label = label;
  return s;
};

const bg = new Graphics().rect(0, 0, W, H).fill(0xcfeec0);
bg.studio = false; // background: never offered for moving
const ground = new Graphics().rect(0, H - 120, W, 120).fill(0x9fd88a); // unlabelled (unstable key)
const cloud = new Graphics().ellipse(0, 0, 60, 22).fill({ color: 0xffffff, alpha: 0.9 });
cloud.label = 'cloud';
cloud.position.set(120, 80);
const house = sprite('house', 620, 380, 'house');
const tree1 = sprite('tree', 200, 400, 'tree');
const tree2 = sprite('tree', 300, 420, 'tree'); // same label -> "tree#2"
tree2.scale.set(0.8);
const rock = sprite('rock', 460, 470); // no label -> tree-path key
const flower = sprite('flower', 520, 480, 'flower');
flower.studioKey = 'flower-by-rock'; // the game's own marker beats the label

const fence = new Container({ label: 'fence' });
fence.position.set(120, 470);
for (let i = 0; i < 5; i++) fence.addChild(sprite('post', i * 22, 0, `post-${i + 1}`));

const ui = new Container({ label: 'ui' });
ui.studio = false; // HUD layer: left out with everything inside it
ui.addChild(new Text({ text: 'Garden', style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fill: 0x2b4d2f } }));
ui.position.set(16, 16);

app.stage.addChild(bg, ground, cloud, house, tree1, tree2, rock, flower, fence, ui);

// Fit the 800 x 600 world into the window, centred (letterboxed).
function fit() {
  const s = Math.min(app.screen.width / W, app.screen.height / H);
  app.stage.scale.set(s);
  app.stage.position.set((app.screen.width - W * s) / 2, (app.screen.height - H * s) / 2);
}
app.renderer.on('resize', fit);
fit();

applyPlacement(app.stage, placement);

app.ticker.add((t) => {
  cloud.x += t.deltaMS * 0.03;
  if (cloud.x > W + 80) cloud.x = -80;
});
