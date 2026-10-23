// The strip keeps Move, and a tool that does not work says why (studio-tool-clear, 2026-10-23; a hands-on try on a neon
// runner: "the strip lost Move", "the motion menu makes no sense", "the when list — none of it makes sense"), without
// a browser: which tools are off and why (hold.ts offWhy), Move on what the game moves is the plain Move and sets where
// it starts (hold.ts startSpot — studio-move-plain, 2026-10-23: no slash, no menu, no step first), the one line per case
// in both languages (handles.ts OFF_LINES, gameNote), and the "When" menu's words. The real editor on test/neon-run:
// test/studio-tool-clear.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/tool-clear.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Item, StripTool } from '../src/contract.ts';
import { createHoldState, holdItem, offWhy } from '../src/bridge/hold.ts';
import { OFF_LINES, gameNote } from '../src/bridge/handles.ts';
import { heldGameText } from '../src/shell/placement-panel.ts';
import { WHEN_TRIGGERS } from '../src/shell/timeline-panel.ts';
import { translate } from '../src/shell/i18n.ts';

const item = (key: string, extra: Partial<Item> = {}): Item => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p: [0, 0, 0], r: 0, s: 1 }, ...extra });
const TOOLS: StripTool[] = ['move', 'lift', 'rotate', 'scale'];
const whys = (i: Item) => TOOLS.map((k) => offWhy(i, k));

test('offWhy: the hexagon the game slides has every tool on (Move sets where it starts); a ring it turns, Turn off; an orb it pulses, Size', () => {
  const s = createHoldState();
  s.driven.set('hex-1', { move: true, lift: false, turn: false, size: false });
  s.driven.set('ring', { move: false, lift: false, turn: true, size: false });
  s.driven.set('orb', { move: false, lift: false, turn: false, size: true });
  assert.deepEqual(whys(holdItem(item('hex-1'), s, '3d')), [null, null, null, null], 'studio-move-plain: Move is the plain Move');
  assert.deepEqual(whys(holdItem(item('ring'), s, '3d')), [null, null, 'game', null]);
  assert.deepEqual(whys(holdItem(item('orb'), s, '3d')), [null, null, null, 'game']);
  assert.deepEqual(whys(holdItem(item('gate'), s, '3d')), [null, null, null, null], 'nothing moves the gate: every tool works');
});

test('offWhy: a held ground, a locked object, a thing that cannot turn — each its own why, never "nothing"', () => {
  const s = createHoldState();
  assert.deepEqual(whys(holdItem(item('road', { backdrop: true }), s, '3d')), ['ground', 'ground', 'ground', 'ground']);
  assert.deepEqual(whys(item('crate', { movable: false, liftable: false, rotatable: false, scalable: false })), ['locked', 'locked', 'locked', 'locked']);
  assert.deepEqual(whys(item('sign', { rotatable: false })), [null, null, 'none', null]);
  assert.equal(offWhy(undefined, 'move'), null);
});

test('startSpot: Move and Height on what the game moves work with no step first; its turn and size stay with the game', () => {
  const s = createHoldState();
  s.driven.set('hex-1', { move: true, lift: false, turn: true, size: false });
  const it = holdItem(item('hex-1'), s, '3d');
  assert.equal(it.held, 'game', 'still the game\'s: the card says what a move does now');
  assert.equal(it.startSpot, true, 'never freed: no menu, no "Set where it starts" first');
  assert.deepEqual(whys(it), [null, null, 'game', null]);
  // Only turn / size driven: nothing to set the start of (a start angle would not show).
  s.driven.set('ring', { move: false, lift: false, turn: true, size: false });
  const ring = holdItem(item('ring'), s, '3d');
  assert.equal(ring.startSpot, undefined);
  assert.deepEqual(whys(ring), [null, null, 'game', null]);
  // The card's words follow.
  const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
  assert.match(heldGameText(it, '3d', t), /where it starts/);
});

test('the small line by the strip (gameNote): what the game does, and that a move here sets where it starts — short, no AI row', () => {
  assert.equal(gameNote('ja', ['move']), '遊ぶとゲームが動かします。ここで動かすとスタート位置が変わります。');
  assert.equal(gameNote('en', ['move']), 'Your game moves this while playing. Moving it here sets where it starts.');
  assert.equal(gameNote('ja', ['move', 'turn']), '遊ぶとゲームが動かし、回します。ここで動かすとスタート位置が変わります。');
  assert.equal(gameNote('en', ['lift', 'turn', 'size']), 'Your game moves, turns and resizes this while playing. Moving it here sets where it starts.');
  assert.equal(gameNote('ja', ['turn']), '遊ぶとゲームが回します。');
  assert.equal(gameNote('en', ['size']), 'Your game resizes this while playing.');
  assert.equal(gameNote('en', []), '');
  for (const lang of ['en', 'ja'] as const) {
    const line = gameNote(lang, ['move', 'turn', 'size']);
    assert.ok(line.length <= (lang === 'en' ? 100 : 48), `${lang}: one short line (${line.length})`);
    assert.doesNotMatch(line, /AI|✦/, `${lang}: the ask box is where the AI is asked`);
  }
});

test('OFF_LINES: every case says why AND what can be done, in both languages, in one line', () => {
  for (const lang of ['en', 'ja'] as const) {
    for (const [why, lines] of Object.entries(OFF_LINES[lang])) {
      for (const k of TOOLS) {
        const line = lines[k as StripTool];
        assert.ok(line && !line.includes('\n'), `${lang} ${why} ${k}`);
        assert.ok(line.length <= (lang === 'en' ? 90 : 48), `${lang} ${why} ${k}: one line (${line.length})`);
        // The second sentence is the way out: start spot, unlock, or the AI.
        assert.match(line, lang === 'en' ? /(You can|You choose|Ask your AI)/ : /(決められ|解除できます|AI に)/, `${lang} ${why} ${k}: "${line}"`);
      }
    }
  }
  assert.equal(OFF_LINES.en.game.move, 'Your game moves this while playing. You choose only where it starts.');
  assert.equal(OFF_LINES.ja.game.move, 'この物は遊ぶとゲームが動かします。決められるのはスタート位置だけです。');
});

test('the words of the card, the Motion menu and "When" exist in both languages and use no maker\'s words', () => {
  const keys = ['hold.gameStart',
    'motion.tool.none', 'motion.tool.make', 'motion.tool.saved', 'motion.tool.savedHead', 'tl.when.firstAt', 'tl.made.more', 'tl.when.selfHead', 'tl.when.aiHead',
    'tl.when.touchNow', 'tl.when.cueNow', 'tl.when.sayNow'];
  for (const lang of ['en', 'ja'] as const) for (const k of keys) assert.notEqual(translate(lang, k), k, `${lang}: ${k}`);
  // The "When" menu (studio-no-presets: Gemini's words, wording-gemini-1023.md B): "Trigger" with six, then "Ask AI to
  // Set Up" — no maker's words ("cue", "connects"); "a signal" is Gemini's word for what the game's code says.
  assert.deepEqual(WHEN_TRIGGERS, ['start', 'click', 'enter', 'key', 'time', 'after']);
  for (const lang of ['en', 'ja'] as const) {
    const words = [...WHEN_TRIGGERS, 'say', 'touchNow', 'cueNow', 'sayNow', 'selfHead', 'aiHead'].map((on) => translate(lang, `tl.when.${on}`)).join(' | ');
    assert.doesNotMatch(words, /cue|connects|つなぐ|ひとりでに|範囲|✦/i, `${lang}: ${words}`);
  }
  // studio-words-plan (2026-10-23; Gemini 1023c): short sentences, not Title Case labels.
  assert.equal(translate('en', 'tl.when.start'), 'When game starts');
  assert.equal(translate('ja', 'tl.when.enter'), '近づいたら'); // fix-0140 ③: the old words said "near" twice
  assert.equal(translate('ja', 'tl.when.selfHead'), 'きっかけを選ぶ');
  assert.equal(translate('ja', 'tl.when.aiHead'), 'あなたの AI に仕掛けを作ってもらう');
  assert.equal(translate('ja', 'motion.tool.make'), '動きを作る');
});

test('the dimmed tool\'s menu is gone (studio-move-plain): no tooloff.* words, no slash across a dimmed tool', async () => {
  for (const lang of ['en', 'ja'] as const) for (const k of ['tooloff.menu', 'tooloff.start.move', 'tooloff.ask']) assert.equal(translate(lang, k), k, `${lang}: ${k}`);
  const { readFileSync } = await import('node:fs');
  const handles = readFileSync(new URL('../src/bridge/handles.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(handles, /button\.off::before/, 'no slash: the dimmed tool keeps its own icon');
  assert.doesNotMatch(readFileSync(new URL('../src/contract.ts', import.meta.url), 'utf8'), /placement\/tool-off/);
});
