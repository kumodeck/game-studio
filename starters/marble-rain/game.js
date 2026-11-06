/**
 * Marble Rain — hundreds of glowing marbles pour from a spout, bounce down through a triangle of pins and pile up in
 * the bins below (a Galton board). Phaser 3 with Matter physics, every picture drawn by code: no files to load.
 *
 * Made for the sample shelf (decided 2026-11-06): it has to read in one second, feel good in the editor, and make a
 * 10-second clip worth posting. So:
 *   - Move one pin in the editor and the marbles fall another way: the pins are real Matter bodies, and whenever the
 *     layout changed (layoutKey() below) the rain is worked out again from step 0 with the new layout (replay()), so
 *     ▶ Play shows the new layout's fall — the same one a fresh page shows at that second.
 *   - The same fall every time: the rain is seeded (SEED) and the physics steps at a fixed 1/60 s, counted from the
 *     game's own clock — so a run is the same run every load, and the editor's "try again from the same second"
 *     (Before / After) shows the same moment with the new code.
 *   - Light and motion carry the 2D: additive glow on marbles and pins, a short streak behind every moving marble,
 *     pins that flash in the colour of the marble that hit them, bands of colour that layer in the bins.
 *
 * Numbers to ask an AI to change are at the top: PADDLES (spinning paddles, empty at first), MARBLES, DROP_EVERY, SEED.
 *
 * Editable objects (named with setName, the key the editor and placement.json use): `spout`, every pin `pin-<row>-<n>`
 * (row 1 at the top, n from the left), and each paddle `paddle-<n>`. The marbles are bare Matter bodies drawn by images
 * marked `studio = false`: they are never listed, so their positions can never end up in placement.json.
 */
import { loadPlacement, applyPlacement } from './placement.js';

// ---------------------------------------------------------------- the numbers
// The board's own pixels are 1280 × 800 (the "board pixels": PADDLES, placement.json and the editor all use them).
//
// A tall screen outside the editor (a phone held upright, decided 2026-11-06): the same board, laid out tall. Fitting
// the wide board into 390 × 844 left it 390 × 244 — a strip in the middle of a dark page, the marbles 2 px. So on a tall
// screen the board is laid out 720 × 1360: the pins closer side by side (× 0.65) and further apart top to bottom
// (× 1.476), the bins taller, the marbles and pins their own size. On a 390 × 844 phone it shows at 0.54 instead of 0.30.
// Everything placed is mapped from board pixels with bx() / by() (the pins, the spout, the paddles, placement.json),
// so a layout made in the editor shows the same pins moved on the phone.
// WHY not inside the editor: the editor saves what it sees as placement.json, and that has to stay in board pixels;
// its frame is wide anyway. WHY not crop or zoom the camera instead: the board is wider than tall, so the most a crop
// gains is the side margins (about 1.2×). The tall layout is its own fall (another layout), still seeded and stepped
// at 1/60 s, so on a phone the same second is the same picture every time too.
const EDITING = typeof window !== 'undefined' && !!(window.__gameStudio || window.studio || document.querySelector('script[data-studio-edit]'));
const TALL = !EDITING && typeof innerHeight === 'number' && innerHeight > innerWidth * 1.15;
const KX = TALL ? 0.65 : 1; // 1 = the wide board as it is
const KY = TALL ? 1.476 : 1;
const W = TALL ? 720 : 1280;
const H = TALL ? 1360 : 800;
/** Board pixels → this screen's layout (the identity on a wide screen). */
const bx = (x) => W / 2 + (x - 640) * KX;
const by = (y) => (TALL ? 420 + (y - 190) * KY : y);
/** The rain's seed: the same seed = the same fall. */
const SEED = 20261106;
/** One physics step = 1/60 s, always (a fixed step is what makes the fall repeatable). */
const STEP_MS = 1000 / 60;
/** A new marble every N steps (2 = 30 a second). */
const DROP_EVERY = 2;
// Phones get fewer marbles (decided 2026-11-06: about 220 keeps a mid-range phone near 60 fps; a laptop takes 380).
const PHONE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 820;
/** At most this many marbles on the board; when there are this many, the floor opens and the bins empty. */
const MARBLES = PHONE ? 220 : 380;
/**
 * Spinning paddles: [x, y] in the board's pixels (1280 × 800; the spout is at 640, 34, the first pins at y 190), or
 * [x, y, length, turns a second]. Each is a glowing bar that turns and bats the marbles aside.
 */
const PADDLES = [];
const PADDLE_LENGTH = 140;
const PADDLE_TURNS = 0.45;

/** The most steps replay() works out again at once (900 = 15 s of rain, about a quarter second on a laptop). */
const REPLAY_MAX = 900;
const ROWS = 10; // rows of pins; row r (from 0) has r + 3 pins
// In board pixels, then laid out for this screen (bx / by above).
const PIN_DX = 80 * KX;
const PIN_DY = 42 * KY;
const PIN_TOP = by(190);
const BIN_TOP = by(620);
const FLOOR = by(792);
const WALL_L = bx(120);
const WALL_R = bx(1160);
const MARBLE_R = 6.5;
const PIN_R = 5.5;
// Neon bands: the colour changes every BAND marbles, so the bins fill in layers (it shows where each wave went).
const PALETTE = [0x3df2ff, 0xff4fd8, 0xffd23f, 0x7cff6b, 0x8a7dff, 0xff7a3d];
const BAND = 40;

// Park–Miller: tiny, fast and the same on every browser (Math.random is not seedable).
function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// placement.json is in board pixels: on a tall screen its places are laid out like everything else.
const placement = tallPlacement(await loadPlacement());
function tallPlacement(file) {
  if (!TALL || !file?.objects) return file;
  const objects = {};
  for (const [k, e] of Object.entries(file.objects)) objects[k] = Array.isArray(e?.p) && e.p.length >= 2 ? { ...e, p: [bx(e.p[0]), by(e.p[1]), ...e.p.slice(2)] } : e;
  return { ...file, objects };
}

class Board extends Phaser.Scene {
  constructor() { super('board'); }

  create() {
    this.makeTextures();
    const M = Phaser.Physics.Matter.Matter;
    this.Body = M.Body;
    this.Sleeping = M.Sleeping;

    const back = this.add.image(W / 2, H / 2, 'backdrop');
    back.studio = false; // the backdrop is not something to select

    // Walls, bin dividers and the floor: bodies only, drawn once in `frame` (not editable: the board itself).
    const wall = { isStatic: true, restitution: 0.3, friction: 0.05, label: 'wall' };
    this.matter.add.rectangle(WALL_L - 10, H / 2, 20, H * 2, wall);
    this.matter.add.rectangle(WALL_R + 10, H / 2, 20, H * 2, wall);
    this.floor = this.matter.add.rectangle(W / 2, FLOOR + 8, WALL_R - WALL_L, 16, { ...wall, label: 'floor' });
    const frame = this.add.graphics();
    frame.studio = false;
    frame.lineStyle(2, 0x6b5cff, 0.35).strokeRect(WALL_L, by(8), WALL_R - WALL_L, FLOOR - by(8));
    for (let k = 0; k < 12; k++) {
      const x = bx(200 + k * 80);
      this.matter.add.rectangle(x, (BIN_TOP + FLOOR) / 2, 4, FLOOR - BIN_TOP, wall);
      frame.fillStyle(0x8a7dff, 0.28).fillRoundedRect(x - 2, BIN_TOP, 4, FLOOR - BIN_TOP, 2);
    }
    // The floor's light: brighter while it is open (draw()).
    this.floorGlow = this.add.image(W / 2, FLOOR + 2, 'floorglow').setBlendMode(Phaser.BlendModes.ADD);
    this.floorGlow.studio = false;

    // The spout: where the rain comes from (editable: drag it and the rain comes from there).
    this.spout = this.add.image(W / 2, by(34), 'spout').setName('spout').setBlendMode(Phaser.BlendModes.ADD);

    // Pins: a triangle, row r with r + 3 pins, each a static Matter circle with its glow.
    this.pins = [];
    for (let r = 0; r < ROWS; r++) {
      const n = r + 3;
      for (let c = 0; c < n; c++) {
        const x = W / 2 + (c - (n - 1) / 2) * PIN_DX;
        const pin = this.matter.add.image(x, PIN_TOP + r * PIN_DY, 'pin', null, {
          isStatic: true, shape: { type: 'circle', radius: PIN_R }, restitution: 0.8, friction: 0.01, label: 'pin',
        });
        pin.setName(`pin-${r + 1}-${c + 1}`).setBlendMode(Phaser.BlendModes.ADD).setTint(0xa9dcff);
        pin.flash = 0;
        pin.flashColor = 0xffffff;
        this.pins.push(pin);
      }
    }

    // Paddles (PADDLES above): static bars the game turns every step (setAngle with its velocity, so a hit bats).
    this.paddles = PADDLES.map(([px, py, plen = PADDLE_LENGTH, turns = PADDLE_TURNS], i) => {
      const [x, y, len] = [bx(px), by(py), plen * KX]; // board pixels → this layout
      const key = this.paddleTexture(len);
      const p = this.matter.add.image(x, y, key, null, {
        isStatic: true, shape: { type: 'rectangle', width: len, height: 10 }, restitution: 0.85, friction: 0.01, label: 'paddle',
      });
      p.setName(`paddle-${i + 1}`).setBlendMode(Phaser.BlendModes.ADD);
      p.turns = turns;
      return p;
    });

    applyPlacement(this, placement); // after everything editable exists, before the first step

    // The marbles: Matter bodies without game objects, drawn by a pool of images (marked off for the editor): a solid
    // core each, and — only while it moves — an additive glow and a streak (one Graphics). WHY not glow them all: the
    // first try (2026-11-06) made every marble additive, and the full bins burned to one white mound with no colours.
    // Resting marbles stay solid, so the bins show the bands of colour; the falling ones carry the light.
    this.trails = this.add.graphics().setBlendMode(Phaser.BlendModes.ADD);
    this.trails.studio = false;
    this.pool = [];
    const glows = [];
    for (let i = 0; i < MARBLES + 40; i++) {
      const glow = this.add.image(-100, -100, 'glow').setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
      glow.studio = false;
      glows.push(glow);
    }
    for (let i = 0; i < MARBLES + 40; i++) {
      const core = this.add.image(-100, -100, 'marble').setVisible(false);
      core.studio = false;
      this.pool.push({ core, glow: glows[i] });
    }

    // A pin hit flashes in the hitting marble's colour.
    this.matter.world.on('collisionstart', (ev) => {
      for (const pair of ev.pairs) {
        const [a, b] = [pair.bodyA, pair.bodyB];
        const pin = a.label === 'pin' ? a : b.label === 'pin' ? b : null;
        const m = pin === a ? b : a;
        if (pin && m.marble && pin.gameObject) (pin.gameObject.flash = 1), (pin.gameObject.flashColor = m.marble.color);
      }
    });

    // A tap pours a handful at that x (its own random numbers: the seeded rain stays as it was until then).
    const pour = rng(SEED + 1);
    this.input.on('pointerdown', (p) => {
      const x = Phaser.Math.Clamp(p.worldX, WALL_L + 20, WALL_R - 20);
      for (let k = 0; k < 10; k++) this.addMarble(x + (pour() - 0.5) * 40, 20 + pour() * 30, (pour() - 0.5) * 1.2);
    });

    this.countEl = document.getElementById('count');
    this.marbles = [];
    this.restart();
    this.lastNow = null;
    this.clock = 0;

    // For tests and for whoever reads the page: the step and a digest of where every marble is (same run = same digest).
    window.marbleRain = { tall: TALL, step: () => this.step, count: () => this.marbles.length, paddles: () => this.paddles.length, digest: () => this.digest(), seen: () => ({ ...this.seen }) };
  }

  // ---------------------------------------------------------------- the rain
  /** Where the editable things stand now, as one string (pins, the spout, the paddles' places and turn). */
  layoutKey() {
    const f = (v) => v.toFixed(2);
    let s = `${f(this.spout.x)},${f(this.spout.y)}`;
    for (const p of this.pins) s += `|${f(p.x)},${f(p.y)}`;
    for (const p of this.paddles) s += `|${f(p.x)},${f(p.y)},${f(p.rotation === p.lastSet ? p.base : p.rotation)}`;
    return s;
  }

  /** Back to step 0 with the layout as it stands: no marbles, the seed again, the paddles at their own turn. */
  restart() {
    for (const m of this.marbles) this.matter.world.remove(m.body);
    for (const p of this.pool) p.core.setVisible(false), p.glow.setVisible(false);
    this.marbles = [];
    this.rand = rng(SEED);
    this.step = 0;
    this.made = 0;
    this.drain = 0;
    this.seen = {};
    this.openFloor(false);
    // A paddle's own turn: the one it was given (placement, the editor), not where the spinning had got to.
    for (const p of this.paddles) {
      if (p.base === undefined || p.rotation !== p.lastSet) p.base = p.rotation;
      this.Body.setAngle(p.body, p.base);
      p.lastSet = p.rotation;
    }
    this.key = this.layoutKey();
  }

  /**
   * Open (true) or close the floor. WHY move it rather than make it a sensor: Matter keeps the contact pairs of marbles
   * already resting on it, and a pair made before the change stays solid, so the piles would hang in the air.
   */
  openFloor(open) {
    this.Body.setPosition(this.floor, { x: W / 2, y: FLOOR + 8 + (open ? 600 : 0) });
  }

  /**
   * The rain as if the layout had always been this one: back to step 0, then every step up to where it was, at once.
   * WHY not just start again from the top (the first try, 2026-11-06): the editor's "same second" counts the game's
   * clock since the page opened, and its Try plays a fresh page up to that second. After Play → Edit → move a pin →
   * Play, a rain started over at the move was seconds behind that, and Before / After showed two different moments
   * (134 marbles against 231). Worked out again, the rain at any second is "this layout's rain at this second", which
   * is exactly what the fresh page shows. Past REPLAY_MAX steps (a long play) it starts again from the top instead,
   * so a Play never stalls on a long catch-up.
   */
  replay() {
    const to = this.step;
    this.restart();
    if (to > REPLAY_MAX) return;
    while (this.step < to) this.stepOnce();
  }

  addMarble(x, y, vx = 0) {
    if (this.marbles.length >= this.pool.length) return;
    const color = PALETTE[Math.floor(this.made / BAND) % PALETTE.length];
    this.made++;
    const body = this.matter.add.circle(x, y, MARBLE_R, {
      restitution: 0.6, friction: 0.01, frictionAir: 0.006, density: 0.002, label: 'marble', sleepThreshold: 40,
    });
    this.Body.setVelocity(body, { x: vx, y: 0.5 });
    body.marble = { color };
    this.marbles.push({ body, color });
  }

  /** One fixed step: drop a marble, turn the paddles, run Matter, empty the bins when full, fade the pin flashes. */
  stepOnce() {
    this.step++;
    if (!this.drain && this.step % DROP_EVERY === 0 && this.marbles.length < MARBLES) {
      this.addMarble(this.spout.x + (this.rand() - 0.5) * 24, this.spout.y + 8, (this.rand() - 0.5) * 0.6);
    }
    if (!this.drain && this.marbles.length >= MARBLES) {
      // Full: the floor opens for 1.6 s (every pile wakes up and falls out), then closes and the rain goes on.
      this.drain = 96;
      this.openFloor(true);
      for (const m of this.marbles) this.Sleeping.set(m.body, false);
    }
    if (this.drain && --this.drain === 0) this.openFloor(false);
    const t = this.step * STEP_MS / 1000;
    for (const p of this.paddles) {
      const a = p.base + t * p.turns * Math.PI * 2;
      this.Body.setAngle(p.body, a, true);
      p.lastSet = p.rotation;
    }
    this.matter.world.step(STEP_MS);
    for (let i = this.marbles.length - 1; i >= 0; i--) {
      const m = this.marbles[i];
      if (m.body.position.y > H + 60) {
        this.matter.world.remove(m.body);
        this.marbles.splice(i, 1);
      }
    }
    for (const p of this.pins) if (p.flash > 0) p.flash = Math.max(0, p.flash - 0.06);
    // Every second of the first 20: the digest then (window.marbleRain.seen), so two runs can be compared step by step.
    if (this.step % 60 === 0 && this.step <= 1200) this.seen[this.step] = this.digest();
  }

  /** One number for where every marble is (the same run gives the same number at the same step). */
  digest() {
    return this.marbles.reduce((h, m) => (h * 31 + Math.round(m.body.position.x * 10) * 7 + Math.round(m.body.position.y * 10)) % 1000000007, 7);
  }

  update() {
    // The game's own clock (inside the editor it leaves out the time paused or editing), in fixed steps.
    const now = performance.now();
    const dt = this.lastNow === null ? 0 : Math.min(250, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    // Moved in the editor since the rain started (a pin, the spout, a paddle): the rain is worked out again from step 0
    // with the new layout, up to the step it was at, in one go (replay()).
    if (this.layoutKey() !== this.key) this.replay();
    this.clock += dt;
    let n = 0;
    while (this.clock >= STEP_MS && n < 4) {
      this.stepOnce();
      this.clock -= STEP_MS;
      n++;
    }
    // Far behind (a slow phone, a tab in the background): skip ahead instead of a burst of steps.
    if (this.clock > STEP_MS * 4) this.clock = 0;
    this.draw();
  }

  draw() {
    const g = this.trails.clear();
    const pool = this.pool;
    let i = 0;
    for (; i < this.marbles.length; i++) {
      const { body, color } = this.marbles[i];
      const { x, y } = body.position;
      const { core, glow } = pool[i];
      core.setPosition(x, y).setVisible(true);
      if (core.tintTopLeft !== color) core.setTint(color), glow.setTint(color);
      const vx = body.velocity.x, vy = body.velocity.y;
      const v2 = vx * vx + vy * vy;
      // The glow fades in with speed (0 at rest, full from about 3 px a step).
      glow.setVisible(v2 > 0.2);
      if (v2 > 0.2) glow.setPosition(x, y).setAlpha(Math.min(1, v2 / 9));
      if (v2 > 1.5) g.lineStyle(MARBLE_R * 1.4, color, 0.3).lineBetween(x - vx * 3.5, y - vy * 3.5, x, y);
    }
    for (; i < pool.length && pool[i].core.visible; i++) pool[i].core.setVisible(false), pool[i].glow.setVisible(false);
    for (const p of this.pins) {
      if (p.flash > 0) p.setTint(p.flashColor).setAlpha(0.75 + 0.25 * p.flash);
      else if (p.alpha !== 0.85) p.setTint(0xa9dcff).setAlpha(0.85);
    }
    this.floorGlow.setAlpha(this.drain ? 1 : 0.45);
    if (this.countEl && this.step % 6 === 0) this.countEl.textContent = `Marbles ${this.marbles.length}`;
  }

  // ---------------------------------------------------------------- pictures (all drawn here: no files)
  makeTextures() {
    if (this.textures.exists('marble')) return;
    const canvas = (key, w, h, paint) => {
      const t = this.textures.createCanvas(key, w, h);
      paint(t.getContext(), w, h);
      t.refresh();
    };
    const glow = (c, x, y, r, stops) => {
      const gr = c.createRadialGradient(x, y, 0, x, y, r);
      for (const [at, col] of stops) gr.addColorStop(at, col);
      c.fillStyle = gr;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    };
    // A marble: a white-hot core and a soft halo; tinted per band (white × colour = the colour, the core stays bright).
    // A marble: a solid disc, lit from the top left (tinted per band: white × colour = the colour, the shine stays light).
    canvas('marble', 16, 16, (c) => {
      const gr = c.createRadialGradient(6, 5, 0.5, 8, 8, 8);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.35, '#f2f2f2');
      gr.addColorStop(0.85, '#b8b8b8');
      gr.addColorStop(1, 'rgba(150,150,150,0)');
      c.fillStyle = gr;
      c.beginPath();
      c.arc(8, 8, 7.6, 0, Math.PI * 2);
      c.fill();
    });
    // Its glow while it moves: a white-hot centre and a soft halo, additive.
    canvas('glow', 44, 44, (c) => glow(c, 22, 22, 22, [[0, 'rgba(255,255,255,0.9)'], [0.25, 'rgba(255,255,255,0.6)'], [0.5, 'rgba(255,255,255,0.18)'], [1, 'rgba(255,255,255,0)']]));
    canvas('pin', 36, 36, (c) => glow(c, 18, 18, 18, [[0, 'rgba(255,255,255,1)'], [0.28, 'rgba(255,255,255,0.9)'], [0.34, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]));
    canvas('spout', 90, 60, (c) => {
      glow(c, 45, 34, 30, [[0, 'rgba(255,255,255,0.9)'], [0.4, 'rgba(160,140,255,0.5)'], [1, 'rgba(120,90,255,0)']]);
      c.fillStyle = 'rgba(230,225,255,0.95)';
      c.beginPath();
      c.moveTo(18, 10); c.lineTo(72, 10); c.lineTo(52, 40); c.lineTo(38, 40); c.closePath();
      c.fill();
    });
    canvas('floorglow', WALL_R - WALL_L, 24, (c, w, h) => {
      const gr = c.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(138,125,255,0)');
      gr.addColorStop(0.5, 'rgba(160,150,255,0.8)');
      gr.addColorStop(1, 'rgba(138,125,255,0)');
      c.fillStyle = gr;
      c.fillRect(0, 0, w, h);
    });
    canvas('backdrop', W, H, (c, w, h) => {
      const sky = c.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#120a33');
      sky.addColorStop(0.55, '#0a0722');
      sky.addColorStop(1, '#05030f');
      c.fillStyle = sky;
      c.fillRect(0, 0, w, h);
      glow(c, w / 2, by(40), 420, [[0, 'rgba(120,90,255,0.35)'], [1, 'rgba(120,90,255,0)']]);
      glow(c, w / 2, h, 620, [[0, 'rgba(255,80,200,0.16)'], [1, 'rgba(255,80,200,0)']]);
      // A faint dot grid: the board reads as glass with depth, not a flat colour.
      const dots = rng(SEED + 2);
      c.fillStyle = 'rgba(200,210,255,0.08)';
      for (let y = 20; y < h; y += 28) for (let x = 20; x < w; x += 28) if (dots() < 0.8) c.fillRect(x, y, 1.5, 1.5);
    });
  }

  paddleTexture(len) {
    const key = `paddle-${Math.round(len)}`;
    if (this.textures.exists(key)) return key;
    const t = this.textures.createCanvas(key, len + 24, 34);
    const c = t.getContext();
    c.shadowColor = 'rgba(255,90,220,0.95)';
    c.shadowBlur = 12;
    c.fillStyle = '#ffd6f6';
    c.beginPath();
    c.roundRect(12, 12, len, 10, 5);
    c.fill();
    t.refresh();
    return key;
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  width: W,
  height: H,
  backgroundColor: '#07051a',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // autoUpdate off: the scene steps Matter itself at a fixed 1/60 s (stepOnce), the heart of "the same fall every time".
  physics: { default: 'matter', matter: { gravity: { y: 1 }, autoUpdate: false, enableSleeping: true, positionIterations: 6, velocityIterations: 4 } },
  scene: Board,
});
