// Marble Rain (starters/marble-rain, sample shelf, 2026-11-06), without a browser: the starter's shape, its copies of
// the Phaser adapter and loader, the `try` it offers, and the stand-in AI's fix for its ask. The game itself in the
// editor (move a pin → Save → Play → pause → ask → Before / After) is test/studio-marble-rain.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readStarters, starterFiles, pickStarter } from '../src/server/starters.mjs';
import { marbleRainPaddle } from './ai-feel/fake-agent.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(PKG, 'starters/marble-rain');
const read = (f) => readFileSync(join(PKG, f), 'utf8');

test('marble-rain: read as a 2D starter (order 4) with its thumb, after Firefly Ruins for "2d"', async () => {
  const list = await readStarters(join(PKG, 'starters'));
  const s = list.find((x) => x.id === 'marble-rain');
  assert.ok(s, 'listed');
  assert.equal(s.dim, '2d');
  assert.equal(s.order, 4);
  assert.equal(s.title, 'Marble Rain');
  assert.ok(s.thumb && s.thumb.endsWith('thumb.png'));
  // "--starter 2d" still opens the first 2D starter (Firefly Ruins, order 2): a new one never takes its place.
  assert.equal(pickStarter(list, '2d').id, 'firefly-ruins');
  assert.equal(pickStarter(list, 'marble-rain').id, 'marble-rain');
});

test('marble-rain: only the game is copied (the adapter, the loader, the page, the code)', async () => {
  assert.deepEqual(await starterFiles(DIR), ['.studio/adapter.js', 'game.js', 'index.html', 'placement.js']);
});

test('marble-rain: its adapter and loader are unchanged copies (they must not drift from what ships)', () => {
  assert.equal(read('starters/marble-rain/.studio/adapter.js'), read('src/adapters/phaser/adapter.js'));
  assert.equal(read('starters/marble-rain/placement.js'), read('examples/phaser-v3-hop/placement.js'));
});

test('marble-rain: the try names a pin the game makes, a second, and the words to ask', () => {
  const meta = JSON.parse(read('starters/marble-rain/starter.json'));
  const game = read('starters/marble-rain/game.js');
  const rows = Number(/const ROWS = (\d+);/.exec(game)?.[1]);
  assert.ok(rows > 0, 'ROWS in game.js');
  // Pins are named pin-<row>-<n>, row r (1-based) holding r + 2 pins (game.js create()).
  const pin = /^pin-(\d+)-(\d+)$/.exec(meta.try.move);
  assert.ok(pin, `try.move is a pin (${meta.try.move})`);
  const [r, n] = [Number(pin[1]), Number(pin[2])];
  assert.ok(r >= 1 && r <= rows && n >= 1 && n <= r + 2, `${meta.try.move} exists`);
  assert.match(game, /setName\(`pin-\$\{r \+ 1\}-\$\{c \+ 1\}`\)/, 'the pins are named that way');
  assert.ok(meta.try.pauseAt > 0 && meta.try.pauseAt < 10, 'paused while the marbles pour');
  assert.equal(meta.try.mark, true, 'the ask points at a spot (◎)');
  // English only here: oss/ holds no Japanese outside the i18n / strings files (the screen's translation lives there).
  assert.equal(meta.try.ask.en, 'Add a spinning paddle here.');
  // The line the AI's fix changes is there, empty (no paddle until someone asks).
  assert.match(game, /^const PADDLES = \[\];$/m);
});

test('marble-rain: no file is loaded and Phaser is pinned (no assets to fetch)', () => {
  const html = read('starters/marble-rain/index.html');
  assert.match(html, /cdn\.jsdelivr\.net\/npm\/phaser@3\.80\.1\/dist\/phaser\.min\.js/);
  const game = read('starters/marble-rain/game.js');
  assert.doesNotMatch(game, /this\.load\.|fetch\(/, 'nothing loaded by the game');
});

test('fake agent: Marble Rain\'s spinning paddle goes where the mark is (world, else the frame), once', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'marble-fix-'));
  try {
    cpSync(DIR, tmp, { recursive: true });
    const r = marbleRainPaddle(tmp, { marks: [{ n: 1, kind: 'point', screen: [0.5, 0.15], world: [641.4, 117.6] }] });
    assert.deepEqual(r.files, ['game.js']);
    assert.match(r.note, /spinning paddle/);
    const game = readFileSync(join(tmp, 'game.js'), 'utf8');
    assert.match(game, /^const PADDLES = \[\[641, 118\]\];$/m);
    // Asked again: the line is not empty any more, so nothing is written twice.
    assert.equal(marbleRainPaddle(tmp, { marks: [] }), null);
    cpSync(join(DIR, 'game.js'), join(tmp, 'game.js'));
    marbleRainPaddle(tmp, { marks: [{ n: 1, kind: 'area', screen: [0.4, 0.1, 0.6, 0.2] }] });
    assert.match(readFileSync(join(tmp, 'game.js'), 'utf8'), /^const PADDLES = \[\[640, 120\]\];$/m);
    // Not Marble Rain: no answer.
    assert.equal(marbleRainPaddle(join(PKG, 'examples/phaser-v3-hop'), {}), null);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// The tall layout (decided 2026-11-06): on an upright phone, outside the editor, the board is laid out 720 × 1360 instead
// of being shrunk to a strip. The lines that decide it are run here as they are written in game.js, with a stand-in
// window (the game itself needs Phaser and a page).
function layout({ editing = false, w, h }) {
  const src = read('starters/marble-rain/game.js');
  const from = src.indexOf('const EDITING =');
  const to = src.indexOf('const by = ', from);
  const lines = src.slice(from, src.indexOf('\n', to) + 1);
  const window = editing ? { __gameStudio: {} } : {};
  const document = { querySelector: () => null };
  return new Function('window', 'document', 'innerWidth', 'innerHeight', `${lines}\nreturn { TALL, W, H, bx, by };`)(window, document, w, h);
}

test('marble-rain: a phone held upright gets the tall board; a wide screen and the editor keep the board as it is', () => {
  const wide = layout({ w: 1280, h: 800 });
  assert.deepEqual([wide.TALL, wide.W, wide.H], [false, 1280, 800]);
  // Wide = the identity: the landscape fall (and every digest the browser test compares) is exactly as before.
  for (const [x, y] of [[640, 34], [120, 8], [1160, 792], [680.4, 190]]) assert.deepEqual([wide.bx(x), wide.by(y)], [x, y]);
  // In the editor, even a tall frame stays wide: placement.json must stay in board pixels.
  assert.equal(layout({ editing: true, w: 390, h: 844 }).TALL, false);
  const tall = layout({ w: 390, h: 844 });
  assert.deepEqual([tall.TALL, tall.W, tall.H], [true, 720, 1360]);
  // The board fits inside the tall world: the walls inside the sides, the spout below the title, the floor above the
  // bottom; and on 390 × 844 it shows at about 0.54 (the wide board: 0.30).
  assert.ok(tall.bx(120) > 0 && tall.bx(1160) < 720, 'walls inside');
  assert.ok(tall.by(34) > 150 && tall.by(792) < 1360 - 30, 'spout and floor inside');
  assert.ok(Math.min(390 / tall.W, 844 / tall.H) > 1.7 * Math.min(390 / 1280, 844 / 800), 'the board shows at least 1.7× bigger');
  // The middle stays the middle (a pin moved in the editor shows in the same place on the triangle).
  assert.equal(tall.bx(640), 360);
});
