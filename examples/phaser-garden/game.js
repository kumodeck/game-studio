// Garden — a tiny Phaser scene made to exercise the studio's Phaser adapter.
//
// It has the cases a real game has:
//   - images loaded from files (assets/*.svg), so "which file does this use" works
//   - named objects (stable keys) and unnamed ones (tree-path keys, flagged unstable)
//   - a nested Container (a fence made of posts) where both the fence and a post can move
//   - a repeated name (two "tree" objects -> keys tree, tree#2)
//   - a studioKey marker, which wins over the name
//   - a HUD text with scrollFactor 0 and a marked-off background, which the studio leaves out
//   - something that moves on its own (a drifting cloud) to show that edit mode freezes time
import { loadPlacement, applyPlacement } from './placement.js';

const W = 800;
const H = 600;
const placement = await loadPlacement();

class Garden extends Phaser.Scene {
  constructor() {
    super('garden');
  }

  preload() {
    for (const k of ['tree', 'rock', 'flower', 'house', 'post']) this.load.svg(k, `assets/${k}.svg`);
  }

  create() {
    const bg = this.add.rectangle(W / 2, H / 2, W, H, 0xcfeec0);
    bg.studio = false; // background: never offered for moving
    this.add.rectangle(W / 2, H - 60, W, 120, 0x9fd88a); // unnamed ground strip (unstable key)

    this.cloud = this.add.ellipse(120, 80, 120, 44, 0xffffff, 0.9).setName('cloud');
    this.add.image(620, 380, 'house').setName('house');
    this.add.image(200, 400, 'tree').setName('tree');
    this.add.image(300, 420, 'tree').setName('tree').setScale(0.8); // same name -> "tree#2"
    this.add.image(460, 470, 'rock'); // no name -> tree path key
    const flower = this.add.image(520, 480, 'flower').setName('flower');
    flower.studioKey = 'flower-by-rock'; // the game's own marker beats the name

    // A fence: a container that can be moved as a whole, with posts inside it.
    const fence = this.add.container(120, 470).setName('fence');
    for (let i = 0; i < 5; i++) fence.add(this.add.image(i * 22, 0, 'post').setName(`post-${i + 1}`));

    this.add.text(16, 16, 'Garden', { fontFamily: 'system-ui, sans-serif', fontSize: '22px', color: '#2b4d2f' })
      .setScrollFactor(0); // HUD: fixed to the screen, so the studio leaves it out

    applyPlacement(this, placement);
  }

  update(_t, dt) {
    // Drift so a frozen frame is easy to tell from a running game.
    this.cloud.x += dt * 0.03;
    if (this.cloud.x > W + 80) this.cloud.x = -80;
  }
}

window.game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#cfeec0',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [Garden],
});
