/**
 * test/canvas-ui/pixi-bubbles: examples/pixi-bubbles/game.js AFTER the rewrite an AI makes for "make this UI editable"
 * (SKILL.md "UI drawn in the canvas", Pixi: studio-canvas-ui-3, 2026-10-24) — the score and the note under it are codeUis
 * kept as objects (size: the Text itself, onChange moves / sizes / colours it); the score's colour is the theme's gold
 * (codeTheme). The picture is the example's to the pixel. The screen test copies the example and puts this in.
 *
 * Bubble Pop — a small PixiJS v8 tapping game (offline copy of a starter
 * template, with nothing changed except the lines marked "studio").
 *
 * It shows what a typical generated Pixi game looks like to the studio: no
 * labels anywhere (top-level pieces get unstable tree-path keys), bubbles are
 * created at run time, and the menu panel is laid out by code. The lines
 * marked "studio" are what an AI agent adds after reading the game: labels for
 * the pieces worth moving, and the placement.json loader call.
 */
import { Application, Container, Graphics, Text } from 'pixi.js';
import { loadPlacement, applyPlacement } from './placement.js'; // studio
// studio: the UI drawn in the canvas (the editor's loader, copied in: SKILL.md Way 1) — its codeUi and the theme
import { applyPlacement as applyUi, codeTheme, codeUi } from './studio-placement.js';

const ROUND_SECONDS = 45;
const COMBO_WINDOW = 0.9; // seconds between pops that keep a combo alive
const PALETTE = [0x7ae0ff, 0xffd166, 0xff8fab, 0x9bf6a8, 0xc3a6ff];
const placement = await loadPlacement(); // studio
await applyUi(document, './placement.json'); // studio: the file's UI and theme until Save (the world is placement.js's)
// studio: the colours the UI shares (the editor's Theme)
const theme = codeTheme({ text: { v: '#ffffff', label: 'Text' }, note: { v: '#8fc6d4', label: 'Note' } });
let best = 0;

const app = new Application();
await app.init({ resizeTo: window, background: 0x0f2f3a, antialias: true, resolution: Math.min(devicePixelRatio || 1, 2), autoDensity: true });
document.body.appendChild(app.canvas);

const style = (size, fill = 0xffffff, weight = '700') => ({ fontFamily: 'ui-rounded, system-ui, sans-serif', fontSize: size, fill, fontWeight: weight });
const bubbles = new Container();
const fx = new Container();
const hud = new Text({ text: '', style: style(22) });
const status = new Text({ text: 'Offline example', style: style(13, 0x8fc6d4, '400') });
const panel = new Container({ label: 'panel' }); // studio: label
app.stage.addChild(bubbles, fx, hud, status, panel);
hud.position.set(16, 16);
status.position.set(16, 46);
// studio: the score and the note are UI the editor moves — each measured by its Text (CSS px: Pixi's autoDensity)
const scoreUi = codeUi('score', { name: 'Score', kind: 'text', at: { from: 'top-left', x: 16, y: 16 }, size: hud,
  look: { fontSize: 22, color: 'var(--text)' }, sample: '999   ⏱ 45' });
scoreUi.onChange((b, L) => {
  hud.position.set(b.x, b.y);
  hud.scale.set(b.s);
  hud.style.fontSize = L.fontSize;
  hud.style.fill = L.color;
});
const noteUi = codeUi('note', { name: 'Note', kind: 'text', at: { from: 'top-left', x: 16, y: 46 }, size: status,
  look: { text: 'Offline example', fontSize: 13, color: 'var(--note)' } });
noteUi.onChange((b, L) => {
  status.position.set(b.x, b.y);
  status.scale.set(b.s);
  status.text = noteUi.value(L.text);
  status.style.fontSize = L.fontSize;
  status.style.fill = L.color;
});

let state = 'menu';
let round = null;
let scoreText = ''; // studio: the score's words (value() shows the editor's sample over them)

function layoutPanel(lines) {
  panel.removeChildren();
  const w = Math.min(340, app.screen.width - 32);
  const body = new Container();
  let y = 0;
  for (const [i, l] of lines.entries()) {
    const t = new Text({ text: l, style: style(i === 0 ? 38 : 16, i === 0 ? 0xffd166 : 0xe6f6fb, i === 0 ? '800' : '400') });
    t.anchor.set(0.5, 0);
    t.y = y;
    body.addChild(t);
    y += t.height + 8;
  }
  const bg = new Graphics().roundRect(-w / 2, -24, w, y + 40, 22).fill({ color: 0x07202a, alpha: 0.9 }).stroke({ color: 0x7ae0ff, width: 2, alpha: 0.4 });
  panel.addChild(bg, body);
  panel.position.set(app.screen.width / 2, Math.max(90, app.screen.height / 2 - (y + 40) / 2));
  panel.visible = true;
}

function start() {
  state = 'play';
  panel.visible = false;
  bubbles.removeChildren();
  round = { t: 0, score: 0, pops: 0, combo: 0, lastPop: -9, spawn: 0, bestCombo: 0 };
}

function spawnBubble() {
  const r = 22 + Math.random() * 26;
  const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  const b = new Graphics().circle(0, 0, r).fill({ color, alpha: 0.35 }).stroke({ color, width: 3 }).circle(-r * 0.35, -r * 0.35, r * 0.18).fill({ color: 0xffffff, alpha: 0.7 });
  b.position.set(r + Math.random() * (app.screen.width - r * 2), app.screen.height + r);
  // Smaller bubbles rise faster: the "hard" targets are also the rewarding ones
  b.vy = 60 + (48 - r) * 3 + round.t * 2.2;
  b.phase = Math.random() * Math.PI * 2;
  b.r = r;
  b.eventMode = 'static';
  b.cursor = 'pointer';
  b.on('pointerdown', () => pop(b));
  bubbles.addChild(b);
}

function pop(b) {
  if (state !== 'play' || b.destroyed) return;
  round.combo = round.t - round.lastPop <= COMBO_WINDOW ? round.combo + 1 : 1;
  round.lastPop = round.t;
  round.bestCombo = Math.max(round.bestCombo, round.combo);
  const gain = Math.min(round.combo, 10) * (b.r < 30 ? 2 : 1);
  round.score += gain;
  round.pops += 1;
  const label = new Text({ text: `+${gain}`, style: style(18, 0xffd166) });
  label.anchor.set(0.5);
  label.position.copyFrom(b.position);
  label.life = 0.6;
  fx.addChild(label);
  b.destroy();
}

function finish() {
  state = 'over';
  bubbles.removeChildren().forEach((b) => b.destroy()); // clear the field so the results panel reads cleanly
  best = Math.max(best, round.score);
  layoutPanel([`${round.score}`, `points · ${round.pops} pops · best combo ×${round.bestCombo}`, `Best ${best}`, 'Tap to play again']);
}

// Tap anywhere to start / restart (bubbles handle their own taps during play)
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;
let overAt = 0;
app.stage.on('pointerdown', () => {
  if (state === 'menu') start();
  else if (state === 'over' && performance.now() - overAt > 800) start();
});
addEventListener('keydown', (e) => {
  if (e.key === ' ' || e.key === 'Enter') app.stage.emit('pointerdown');
});

app.ticker.add((ticker) => {
  const dt = Math.min(ticker.deltaMS, 50) / 1000;
  for (const f of [...fx.children]) {
    f.life -= dt;
    f.y -= 50 * dt;
    f.alpha = Math.max(0, f.life / 0.6);
    if (f.life <= 0) f.destroy();
  }
  // studio: the score's words through value() every frame (the editor's sample while one is shown; between rounds the
  // last round's words, '' before the first)
  if (state !== 'play') {
    hud.text = scoreUi.value(scoreText);
    return;
  }
  round.t += dt;
  const left = Math.max(0, ROUND_SECONDS - round.t);
  const comboText = round.combo > 1 && round.t - round.lastPop <= COMBO_WINDOW ? `   combo ×${round.combo}` : '';
  scoreText = `${round.score}   ⏱ ${Math.ceil(left)}${comboText}`;
  hud.text = scoreUi.value(scoreText);
  round.spawn -= dt;
  if (round.spawn <= 0) {
    spawnBubble();
    round.spawn = Math.max(0.22, 0.75 - round.t * 0.012);
  }
  for (const b of [...bubbles.children]) {
    b.y -= b.vy * dt;
    b.x += Math.sin(round.t * 2 + b.phase) * 20 * dt;
    if (b.y < -b.r) {
      round.combo = 0; // an escaped bubble breaks the combo
      b.destroy();
    }
  }
  if (left <= 0) {
    overAt = performance.now();
    finish();
  }
});

layoutPanel(['Bubble Pop', 'Pop bubbles fast to build a combo.', 'Small bubbles score double.', '', 'Tap to start']);
applyPlacement(app.stage, placement); // studio: after the menu panel is laid out
