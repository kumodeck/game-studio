/**
 * Coin Hop — a one-room Phaser 3 platformer, as an AI writes one when asked for "a small Phaser game"
 * (dogfood 2026-10-17: Phaser 3.80.1 from the CDN, art drawn with Graphics and baked into textures,
 * Arcade Physics, objects named with setName). The lines marked "studio" are what an AI agent adds:
 * the placement.json loader. A drifting cloud checks that the editor holds the game's time.
 */
import { loadPlacement, applyPlacement } from './placement.js'; // studio

const W = 800;
const H = 450;
const placement = await loadPlacement(); // studio

class Room extends Phaser.Scene {
  constructor() { super('room'); }

  create() {
    this.makeTextures();
    this.cameras.main.setBackgroundColor('#1d2b53');
    this.cloud = this.add.image(120, 70, 'cloud').setName('cloud').setAlpha(0.7);

    // Platforms: [x, y, width, name]; x/y is the top-left corner, height 16.
    this.platforms = this.physics.add.staticGroup();
    for (const [x, y, w, name] of [[0, 434, W, 'floor'], [150, 340, 140, 'step-1'], [340, 270, 140, 'step-2'], [530, 200, 120, 'step-3'], [660, 130, 140, 'door-ledge']]) {
      this.platforms.create(x + w / 2, y + 8, 'plat').setName(name).setDisplaySize(w, 16).refreshBody();
    }
    this.coins = this.physics.add.staticGroup();
    for (const [x, y] of [[220, 310], [410, 240], [590, 170]]) this.coins.create(x, y, 'coin').setName('coin');
    this.door = this.physics.add.staticImage(760, 106, 'door').setName('door');
    this.player = this.physics.add.sprite(60, 360, 'player').setName('player').setCollideWorldBounds(true);

    applyPlacement(this, placement); // studio: after everything exists, before the colliders

    this.physics.add.collider(this.player, this.platforms);
    this.physics.add.overlap(this.player, this.coins, (_p, c) => { c.destroy(); this.score++; this.hud.setText(`Coins ${this.score}/3`); });
    this.keys = this.input.keyboard.addKeys('LEFT,RIGHT,UP,SPACE');
    this.score = 0;
    // HUD: fixed to the screen (scrollFactor 0), so the editor leaves it out.
    this.hud = this.add.text(12, 10, 'Coins 0/3', { fontFamily: 'monospace', fontSize: '16px', color: '#fff' }).setScrollFactor(0);
  }

  makeTextures() {
    if (this.textures.exists('player')) return;
    const g = this.add.graphics();
    g.fillStyle(0xff77a8).fillRect(0, 0, 20, 28).fillStyle(0xffffff).fillRect(11, 7, 5, 5);
    g.generateTexture('player', 20, 28).clear();
    g.fillStyle(0x83769c).fillRect(0, 0, 32, 16).fillStyle(0xc2c3c7).fillRect(0, 0, 32, 4);
    g.generateTexture('plat', 32, 16).clear();
    g.fillStyle(0xffec27).fillCircle(8, 8, 8);
    g.generateTexture('coin', 16, 16).clear();
    g.fillStyle(0xab5236).fillRect(0, 0, 32, 48).fillStyle(0x7e2553).fillRect(4, 4, 24, 44);
    g.generateTexture('door', 32, 48).clear();
    g.fillStyle(0xffffff).fillCircle(20, 20, 20).fillCircle(46, 16, 16).fillCircle(66, 22, 14);
    g.generateTexture('cloud', 84, 42).destroy();
  }

  update(_t, dt) {
    this.cloud.x = (this.cloud.x + dt * 0.02) % (W + 60);
    const k = this.keys;
    const dir = k.RIGHT.isDown - k.LEFT.isDown;
    this.player.setVelocityX(dir * 200);
    if ((k.UP.isDown || k.SPACE.isDown) && this.player.body.blocked.down) this.player.setVelocityY(-460);
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  pixelArt: true,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { gravity: { y: 900 } } },
  scene: Room,
});
