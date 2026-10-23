// The strip keeps Move, and a tool that does not work says why (studio-tool-clear, 2026-10-23; a hands-on try on a neon
// runner: "the strip lost Move", "the motion menu makes no sense", "the when list — none of it makes sense"), without
// a browser: which tools are off and why (hold.ts offWhy), "Set where it starts" (hold.ts startSpot), the one line per
// case in both languages (handles.ts OFF_LINES), the rows a press opens (shell/tool-off.ts), and the "When" menu's
// words. The real editor on test/neon-run: test/studio-tool-clear.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/tool-clear.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Item, StripTool } from '../src/contract.ts';
import { createHoldState, holdItem, offWhy } from '../src/bridge/hold.ts';
import { OFF_LINES } from '../src/bridge/handles.ts';
import { toolOffEntries, type ToolOffDeps } from '../src/shell/tool-off.ts';
import { heldGameText } from '../src/shell/placement-panel.ts';
import { WHEN_TRIGGERS } from '../src/shell/timeline-panel.ts';
import { translate } from '../src/shell/i18n.ts';
import type { MenuEntry } from '../src/shell/context-menu.ts';

const item = (key: string, extra: Partial<Item> = {}): Item => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p: [0, 0, 0], r: 0, s: 1 }, ...extra });
const TOOLS: StripTool[] = ['move', 'lift', 'rotate', 'scale'];
const whys = (i: Item) => TOOLS.map((k) => offWhy(i, k));

test('offWhy: the hexagon the game slides has Move off "game" and the rest on; a ring it turns, Turn; an orb it pulses, Size', () => {
  const s = createHoldState();
  s.driven.set('hex-1', { move: true, lift: false, turn: false, size: false });
  s.driven.set('ring', { move: false, lift: false, turn: true, size: false });
  s.driven.set('orb', { move: false, lift: false, turn: false, size: true });
  assert.deepEqual(whys(holdItem(item('hex-1'), s, '3d')), ['game', null, null, null]);
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

test('"Set where it starts" (startSpot): Move and Height work again on what the game moves; its turn and size stay with the game', () => {
  const s = createHoldState();
  s.driven.set('hex-1', { move: true, lift: false, turn: true, size: false });
  s.freed.add('hex-1');
  const it = holdItem(item('hex-1'), s, '3d');
  assert.equal(it.held, 'game', 'still the game\'s: the card says what a move does now');
  assert.equal(it.startSpot, true);
  assert.deepEqual(whys(it), [null, null, 'game', null]);
  // Only turn / size driven: nothing to set the start of — freeing does not unlock them (a start angle would not show).
  s.driven.set('ring', { move: false, lift: false, turn: true, size: false });
  s.freed.add('ring');
  const ring = holdItem(item('ring'), s, '3d');
  assert.equal(ring.startSpot, undefined);
  assert.deepEqual(whys(ring), [null, null, 'game', null]);
  // The card's words follow.
  const t = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
  assert.match(heldGameText(it, '3d', t), /where it starts/);
  const plain = createHoldState();
  plain.driven.set('hex-1', { move: true, lift: false, turn: false, size: false });
  assert.match(heldGameText(holdItem(item('hex-1'), plain, '3d'), '3d', t), /only where it starts/, 'not freed: the old words');
});

test('OFF_LINES: every case says why AND what can be done, in both languages, in one line', () => {
  for (const lang of ['en', 'ja'] as const) {
    for (const [why, lines] of Object.entries(OFF_LINES[lang])) {
      for (const k of TOOLS) {
        const line = lines[k as StripTool];
        assert.ok(line && !line.includes('\n'), `${lang} ${why} ${k}`);
        assert.ok(line.length <= (lang === 'en' ? 90 : 48), `${lang} ${why} ${k}: one line (${line.length})`);
        // The second sentence is the way out: start spot, unlock, or the AI.
        assert.match(line, lang === 'en' ? /(You can|You choose|Ask AI)/ : /(決められ|解除できます|AI に)/, `${lang} ${why} ${k}: "${line}"`);
      }
    }
  }
  assert.equal(OFF_LINES.en.game.move, 'Your game moves this while playing. You choose only where it starts.');
  assert.equal(OFF_LINES.ja.game.move, 'この物は遊ぶとゲームが動かします。決められるのはスタート位置だけです。');
});

/** The menu a press on a dimmed tool opens, as words; the calls its rows make. */
function press(tool: StripTool, why: 'game' | 'ground' | 'locked' | 'none', ask = true) {
  const calls: string[] = [];
  const d: ToolOffDeps = {
    t: (k) => k,
    unhold: (k) => calls.push(`unhold ${k}`),
    choose: (k) => calls.push(`choose ${k}`),
    ask: ask ? (text) => calls.push(`ask ${text}`) : null,
  };
  const es = toolOffEntries(d, 'hex-1', tool, why, OFF_LINES.en[why][tool]);
  const rows = es.map((e: MenuEntry) => ('note' in e ? `> ${e.note}` : 'head' in e ? `# ${e.head}` : 'sep' in e ? '—' : e.label));
  const run = (label: string) => (es.find((e) => 'label' in e && e.label === label) as { run(): void }).run();
  return { rows, run, calls };
}

test('a press on a dimmed tool: the why, then what to do — set where it starts, make movable, or ask the AI', () => {
  const mv = press('move', 'game');
  assert.deepEqual(mv.rows, [`> ${OFF_LINES.en.game.move}`, 'tooloff.start.move', '—', 'tooloff.ask.moves']);
  mv.run('tooloff.start.move');
  assert.deepEqual(mv.calls, ['unhold hex-1', 'choose move'], 'the hold comes off and Move is in hand');
  mv.run('tooloff.ask.moves');
  assert.equal(mv.calls.at(-1), 'ask tooloff.askText.moves');
  assert.deepEqual(press('lift', 'game').rows.slice(1), ['tooloff.start.lift', '—', 'tooloff.ask.moves']);
  assert.deepEqual(press('rotate', 'game').rows.slice(1), ['tooloff.ask']);
  assert.deepEqual(press('scale', 'game').rows.slice(1), ['tooloff.ask']);
  const g = press('lift', 'ground');
  assert.deepEqual(g.rows.slice(1), ['hold.free', '—', 'tooloff.ask']);
  g.run('hold.free');
  assert.deepEqual(g.calls, ['unhold hex-1', 'choose lift']);
  assert.deepEqual(press('move', 'locked').rows.slice(1), ['tooloff.ask.rule']);
  assert.deepEqual(press('rotate', 'none').rows.slice(1), ['tooloff.ask']);
  // studio-uniforms: every ask row is a ✦ row (the AI's violet), after a line when plain rows come first.
  for (const e of toolOffEntries({ t: (k) => k, unhold: () => undefined, choose: () => undefined, ask: () => undefined }, 'hex-1', 'move', 'game', 'x')) {
    if ('id' in e && e.id === 'tool-off-ask') assert.equal(e.ai, true);
  }
  // No chat (the web demo): the way out that needs none stays; never only the why for what has one.
  assert.deepEqual(press('move', 'game', false).rows.slice(1), ['tooloff.start.move']);
});

test('the words of the strip, the Motion menu and "When" exist in both languages and use no maker\'s words', () => {
  const keys = ['tooloff.menu', 'tooloff.start.move', 'tooloff.start.lift', 'tooloff.ask', 'tooloff.ask.moves', 'tooloff.ask.rule', 'tooloff.askText.moves', 'tooloff.askText.turn',
    'tooloff.askText.size', 'tooloff.askText.rule', 'tooloff.askText.move', 'tooloff.askText.lift', 'tooloff.askText.rotate', 'tooloff.askText.scale', 'hold.gameStart',
    'motion.tool.none', 'motion.tool.make', 'motion.tool.saved', 'motion.tool.savedHead', 'tl.when.firstAt', 'tl.made', 'tl.when.selfHead', 'tl.when.aiHead',
    'tl.when.touchNow', 'tl.when.cueNow', 'tl.when.sayNow'];
  for (const lang of ['en', 'ja'] as const) for (const k of keys) assert.notEqual(translate(lang, k), k, `${lang}: ${k}`);
  // The "When" menu (studio-no-presets: Gemini's words, wording-gemini-1023.md B): "Trigger" with six, then "Ask AI to
  // Set Up" — no maker's words ("cue", "connects"); "a signal" is Gemini's word for what the game's code says.
  assert.deepEqual(WHEN_TRIGGERS, ['start', 'click', 'enter', 'key', 'time', 'after']);
  for (const lang of ['en', 'ja'] as const) {
    const words = [...WHEN_TRIGGERS, 'say', 'touchNow', 'cueNow', 'sayNow', 'selfHead', 'aiHead'].map((on) => translate(lang, `tl.when.${on}`)).join(' | ');
    assert.doesNotMatch(words, /cue|connects|つなぐ|ひとりでに|範囲|✦/i, `${lang}: ${words}`);
  }
  assert.equal(translate('en', 'tl.when.start'), 'On Game Start');
  assert.equal(translate('ja', 'tl.when.enter'), '近くに近づいたら');
  assert.equal(translate('ja', 'tl.when.selfHead'), 'きっかけを選ぶ');
  assert.equal(translate('ja', 'tl.when.aiHead'), 'AI に仕掛けを作ってもらう');
  assert.equal(translate('ja', 'motion.tool.make'), '動きを作る');
});
