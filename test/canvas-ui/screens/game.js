/**
 * test/canvas-ui/screens: a game whose whole UI is drawn in one canvas, on two screens — 'play' (a score whose box
 * follows its text, a health bar) and 'over' (a GAME OVER title and a RETRY button). Already through codeUi() (as the
 * AI writes it, SKILL.md "UI drawn in the canvas"), with `screen` on each, and the drawing asks the editor which screen
 * to draw (studio.screen(); the game's own state.screen otherwise).
 *
 * For test/studio-canvas-ui.browser.mjs --only screens (studio-canvas-ui stage 2, 2026-10-24): the UI list's head offers
 * the two screens; choosing "Game over" lists and draws its UI, and the game's own state (score, screen) stays as it was;
 * the bar's samples (full / half / empty); a long sample text widens the score's frame (size is a function).
 */
import { codeUi } from './studio-placement.js';

const c = document.getElementById('hud');
const ctx = c.getContext('2d');
// The game's own state: the editor never changes it (it only chooses what is drawn).
window.game = { score: 4200, hp: 6, screen: 'play' };

function resize() {
  c.width = innerWidth;
  c.height = innerHeight;
}
addEventListener('resize', resize);
resize();

const font = (L, s) => `bold ${L.fontSize * s}px "Courier New", monospace`;
const scoreText = () => `${scoreUi.look().text} ${scoreUi.value(game.score.toLocaleString('en-US'))}`;
// Its box follows its text (a sample of a long name makes it wider): size is a function, measured unscaled.
const scoreUi = codeUi('score', { name: 'Score', kind: 'text', screen: 'play', at: { from: 'top-left', x: 16, y: 16 },
  size: () => {
    ctx.font = font(scoreUi.look(), 1);
    return [Math.ceil(ctx.measureText(scoreText()).width) + 20, 36];
  },
  look: { text: 'SCORE', fontSize: 22, color: '#ffffff', background: '#22304a' }, sample: '999,999' });
const hpUi = codeUi('hp', { name: 'Health', kind: 'bar', screen: 'play', at: { from: 'top-left', x: 16, y: 64 }, size: [200, 16],
  look: { color: '#3ddc84', background: '#39404f' } });
const overUi = codeUi('over-title', { name: 'Game over', kind: 'text', screen: 'over', at: { from: 'center', x: 0, y: -40 }, size: [340, 60],
  look: { text: 'GAME OVER', fontSize: 48, color: '#ff4d6d' } });
const retryUi = codeUi('retry', { name: 'Retry', kind: 'button', screen: 'over', at: { from: 'center', x: 0, y: 50 }, size: [160, 48],
  look: { text: 'RETRY', fontSize: 20, color: '#111111', background: '#ffd166' }, states: { hover: { background: '#ffe29a' } } });

function draw() {
  const screen = globalThis.studio?.screen?.() || game.screen;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#101622';
  ctx.fillRect(0, 0, c.width, c.height);
  if (screen === 'play') {
    let b = scoreUi.box(), L = scoreUi.look();
    ctx.fillStyle = L.background;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.font = font(L, b.s);
    ctx.fillStyle = L.color;
    ctx.fillText(scoreText(), b.x + 10 * b.s, b.y + 25 * b.s);
    b = hpUi.box();
    L = hpUi.look();
    ctx.fillStyle = L.background;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = L.color;
    ctx.fillRect(b.x, b.y, b.w * hpUi.value(game.hp / 10), b.h);
  }
  if (screen === 'over') {
    let b = overUi.box(), L = overUi.look();
    ctx.font = font(L, b.s);
    ctx.fillStyle = L.color;
    ctx.textAlign = 'center';
    ctx.fillText(L.text, b.x + b.w / 2, b.y + 46 * b.s);
    b = retryUi.box();
    L = retryUi.look();
    ctx.fillStyle = L.background;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.font = font(L, b.s);
    ctx.fillStyle = L.color;
    ctx.fillText(L.text, b.x + b.w / 2, b.y + 31 * b.s);
    ctx.textAlign = 'left';
  }
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
