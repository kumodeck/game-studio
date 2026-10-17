/**
 * Dune Runner — a small Phaser endless runner (offline copy of a starter
 * template, with nothing changed except the lines marked "studio").
 *
 * It shows what a typical generated game looks like to the studio: most
 * objects have no name (they get unstable tree-path keys), art is generated at
 * boot (no files to list), and the player is an Arcade Physics body.
 * The lines marked "studio" are what an AI agent adds after reading the game:
 * names for the things worth moving, and the placement.json loader call.
 */
import { loadPlacement, applyPlacement } from './placement.js'; // studio

const W = 390;
const H = 844;
const GROUND_Y = 640;
const PX_PER_M = 40; // 40 px of scrolling = 1 m
const placement = await loadPlacement(); // studio
let best = 0;

class Boot extends Phaser.Scene {
  constructor() {
    super('boot');
  }
  create() {
    // Generate every texture once. WHY: a starter should run from a single folder with no asset pipeline.
    const g = this.add.graphics();
    g.fillStyle(0x2b1d3a).fillRoundedRect(0, 0, 34, 44, 10).fillStyle(0xffffff).fillCircle(24, 14, 5).fillStyle(0x2b1d3a).fillCircle(25, 14, 2);
    g.generateTexture('runner', 34, 44).clear();
    g.fillStyle(0x3f8f5a).fillRoundedRect(0, 8, 26, 56, 8).fillRoundedRect(-2, 20, 10, 20, 5).fillRoundedRect(20, 14, 10, 18, 5);
    g.generateTexture('cactus', 32, 64).clear();
    g.fillStyle(0xd9a45b).fillRect(0, 0, 64, 16).fillStyle(0xc48c45).fillRect(0, 16, 64, 300);
    g.generateTexture('ground', 64, 316).clear();
    g.fillStyle(0xffffff, 0.8).fillCircle(20, 20, 20).fillCircle(46, 16, 16).fillCircle(66, 22, 14);
    g.generateTexture('cloud', 84, 42).destroy();
    this.scene.start('run');
  }
}

class Run extends Phaser.Scene {
  constructor() {
    super('run');
  }

  create() {
    this.cameras.main.setBackgroundColor('#ffe8c7');
    this.add.circle(300, 190, 70, 0xff9a52, 0.9).setName('sun'); // studio: name
    this.clouds = [0, 1, 2].map((i) => this.add.image(80 + i * 140, 120 + i * 60, 'cloud').setAlpha(0.8).setName('cloud')); // studio: name
    this.ground = this.add.tileSprite(W / 2, GROUND_Y + 158, W, 316, 'ground');
    this.floor = this.physics.add.staticImage(W / 2, GROUND_Y + 8, 'ground').setDisplaySize(W, 16).setVisible(false).refreshBody();

    this.player = this.physics.add.sprite(90, GROUND_Y - 40, 'runner').setName('player'); // studio: name
    this.player.body.setGravityY(2200);
    this.physics.add.collider(this.player, this.floor);

    this.cacti = this.physics.add.group({ allowGravity: false, immovable: true });
    this.physics.add.overlap(this.player, this.cacti, () => this.crash());

    const font = { fontFamily: 'ui-rounded, system-ui, sans-serif', color: '#2b1d3a' };
    this.hud = this.add.text(16, 20, '', { ...font, fontSize: '22px', fontStyle: 'bold' }).setDepth(10);
    this.panel = this.add.container(W / 2, 330).setDepth(20);

    const jump = () => this.jump();
    this.input.on('pointerdown', jump);
    this.input.keyboard.on('keydown-SPACE', jump);
    this.input.keyboard.on('keydown-UP', jump);

    this.state = 'ready';
    this.showPanel(['DUNE RUNNER', '', 'Tap / Space to jump', 'Tap to start']);
    applyPlacement(this, placement); // studio: after everything exists, before the first update
  }

  jump() {
    if (this.state === 'ready') return this.startRun();
    if (this.state === 'over') {
      // Ignore taps for a moment so the tap that killed you does not instantly restart
      if (this.time.now - this.overAt > 700) this.scene.restart();
      return;
    }
    if (this.player.body.blocked.down) this.player.setVelocityY(-900);
  }

  startRun() {
    this.state = 'run';
    this.panel.removeAll(true);
    this.speed = 320;
    this.distance = 0;
    this.nextCactus = 600;
  }

  update(_time, deltaMs) {
    const dt = Math.min(deltaMs, 50) / 1000;
    for (const c of this.clouds) {
      c.x -= (this.state === 'run' ? 20 : 8) * dt;
      if (c.x < -60) c.x = W + 60;
    }
    if (this.state !== 'run') return;
    this.speed = Math.min(760, this.speed + 9 * dt); // slow ramp: the run gets harder, never unfair
    const dx = this.speed * dt;
    this.distance += dx / PX_PER_M;
    this.ground.tilePositionX += dx;
    this.nextCactus -= dx;
    if (this.nextCactus <= 0) {
      const c = this.cacti.create(W + 30, GROUND_Y - 32, 'cactus');
      c.body.setSize(22, 56);
      // Gap shrinks with speed but always leaves at least one full jump arc of space
      this.nextCactus = Phaser.Math.Between(260, 520) + this.speed * 0.25;
    }
    for (const c of this.cacti.getChildren()) {
      c.x -= dx;
      c.body.updateFromGameObject();
      if (c.x < -40) c.destroy();
    }
    this.hud.setText(`${Math.floor(this.distance)} m`);
  }

  crash() {
    if (this.state !== 'run') return;
    this.state = 'over';
    this.overAt = this.time.now;
    this.cameras.main.shake(160, 0.01);
    this.player.setTint(0xff5a3c);
    const meters = Math.floor(this.distance);
    best = Math.max(best, meters);
    this.showPanel([`${meters} m`, 'Tap to run again', '', `BEST  ${best} m`]);
  }

  showPanel(lines) {
    this.panel.removeAll(true);
    const height = 60 + lines.length * 34;
    this.panel.add(this.add.rectangle(0, height / 2 - 30, 330, height, 0xfff6e8, 0.94).setStrokeStyle(3, 0x2b1d3a));
    const font = { fontFamily: 'ui-rounded, system-ui, sans-serif', color: '#2b1d3a' };
    lines.forEach((l, i) => this.panel.add(this.add.text(0, i * 34, l, { ...font, fontSize: i === 0 ? '34px' : '17px', fontStyle: i === 0 ? 'bold' : 'normal' }).setOrigin(0.5, 0)));
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: W,
  height: H,
  backgroundColor: '#ffe8c7',
  // FIT + CENTER: portrait 390×844 on phones, letterboxed on desktops (same layout everywhere)
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [Boot, Run],
});
