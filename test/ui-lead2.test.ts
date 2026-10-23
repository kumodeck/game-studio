// UI lead, round 2 (studio-ui-lead2, 2026-10-23): the rows' order is the person's, no "New: Scene", Gemini's words, and
// the next five of studio-ui-lead. Without a browser (the plate in a real editor: test/studio-ui-lead2.browser.mjs):
//   1. the rows: a pick moves no row (the request: "the one I pick jumps to the top and the order changes every time");
//      a scene's rows are in the scene's order (its tracks), reorder() changes it — one undo step, a Library change —
//      and the file keeps the order (`order` next to `tracks` — the file sorts object keys; a Library read back has it);
//   2. no "New: Scene": the plate's menu and the wire have no `new:scene`, its words are gone; a scene made before opens as it did;
//   3. the words: Gemini's table (wording-gemini-1023b), both languages; the merged ⋯ row "Loop & End";
//   4. the plate's code and CSS: the grip on a scene's rows, the focused row's "+" (no link row), the ⋯ rows, the names
//      column grows with the names, "✦ AI" on a narrow plate, the card's Motion row wraps, the presence line is the bar's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore, roundLib } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineActs, TimelineView } from '../src/shell/timeline-panel.ts';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
import { translate } from '../src/shell/i18n.ts';
import type { LibraryMotion, MotionKey, Pose } from '../src/contract.ts';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../src/shell');
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');
/** A source without its comments (a design note's words are not the words on screen). */
const code = (f: string) => read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const between = (s: string, from: string, to: string) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));

const ROW: MotionKey[] = [{ t: 0, v: [0, 0, 0] }, { t: 1.5, v: [-2, 0, 1] }, { t: 3, v: [-4, 0, 0] }];
const BOB: MotionKey[] = [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [0, 0.4, 0] }];

function rig(given?: { motions?: LibraryMotion[]; motion?: Record<string, { clips: Array<{ name: string; use: string; len: number; when: { on: 'start' }; keys: Record<string, never> }> }> }) {
  const places: Record<string, Pose> = { lighthouse: { p: [0, 0, -9], r: 0, s: 1 }, boat: { p: [0, 0, 0], r: 0, s: 1 }, buoy: { p: [5, 0, 0], r: 0, s: 1 },
    crate: { p: [9, 0, 9], r: 0, s: 1 }, rock: { p: [3, 0, 3], r: 0, s: 1 } };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  if (given) {
    for (const m of given.motions ?? []) lib.set(m.name, m);
    for (const [k, m] of Object.entries(given.motion ?? {})) store.set(k, m);
  } else {
    lib.set('Row', { name: 'Row', len: 3, repeat: 'pingpong', keys: { p: ROW } });
    lib.set('Bob', { name: 'Bob', len: 2, keys: { p: BOB } });
    store.set('boat', { clips: [{ name: 'Row', use: 'Row', len: 3, when: { on: 'key', key: 'KeyE' }, keys: {} }] });
    store.set('buoy', { clips: [{ name: 'Bob', use: 'Bob', len: 2, when: { on: 'start' }, keys: {} }] });
  }
  lib.markSaved();
  store.markSaved();
  const undo = new UndoStack();
  let picked: string | null = 'boat';
  let group: string[] = ['boat'];
  let changed = 0;
  let acts!: TimelineActs;
  let view!: () => TimelineView;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {}, focusStarts() {} };
  const tl = createTimeline({
    store, lib, others: () => [], undo, send: () => {}, dim: () => '3d', usable: () => true, picked: () => picked, group: () => group,
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: (k) => ((picked = k), (group = [k])), changed: () => changed++,
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k, v) => (v?.name ? `${k}:${v.name}` : k),
  }, (v, a) => ((view = v), (acts = a), stand as never));
  tl.setOpen(true);
  const undoAll = () => {
    const step = undo.peekUndo()!;
    for (const c of step.changes.slice().reverse()) if (c.kind === 'motion' || c.kind === 'motion-lib' || c.kind === 'motion-rename') tl.apply(c, 'undo');
    undo.undo();
  };
  const pick = (k: string | null, several?: string[]) => {
    picked = several ? null : k;
    group = several ?? (k ? [k] : []);
  };
  const rows = () => view().rows.map((r) => r.key);
  const file = () => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, motion: store.result('3d', () => false), motions: lib.result((m: LibraryMotion) => roundLib(m)) });
  return { store, lib, undo, tl, acts: () => acts, view: () => view(), pick, rows, undoAll, file, changed: () => changed };
}

// ----- 1. the rows' order -----
test('rows: a pick moves no row; a scene\'s rows are in the scene\'s order; reorder() changes it in one undo step; the file keeps it', () => {
  const r = rig();
  r.acts().link!('crate');
  r.acts().link!('buoy');
  assert.deepEqual(r.rows(), ['boat', 'crate', 'buoy'], 'the scene\'s order: the boat, then the linked ones as linked');
  for (const k of ['buoy', 'crate', 'boat']) {
    r.pick(k);
    assert.deepEqual(r.rows(), ['boat', 'crate', 'buoy'], `${k} picked: the same order`);
    assert.deepEqual(r.view().rows.map((x) => x.picked), ['boat', 'crate', 'buoy'].map((x) => x === k), `${k} picked: lit where it is`);
  }
  assert.equal(typeof r.acts().reorder, 'function', 'the wire gives the plate reorder()');
  // The buoy dragged to the top (index 0 among the other two).
  const steps = r.undo.size;
  const was = r.changed();
  r.acts().reorder!('buoy', 0);
  assert.deepEqual(r.rows(), ['buoy', 'boat', 'crate']);
  assert.deepEqual(r.lib.get('Row')!.order, ['buoy', 'boat', 'crate'], 'the order is the scene motion\'s `order`');
  assert.equal(r.undo.size, steps + 1, 'one undo step');
  assert.equal(r.undo.peekUndo()!.changes[0]!.kind, 'motion-lib', 'a Library change (the motion is saved with its order)');
  assert.ok(r.changed() > was, 'the Save count hears of it');
  assert.ok(r.lib.changedNames().includes('Row'), 'Row counts as changed');
  // The boat dragged below the crate (index 2 = after both others); the same place again is no step.
  r.acts().reorder!('boat', 2);
  assert.deepEqual(r.rows(), ['buoy', 'crate', 'boat']);
  r.acts().reorder!('boat', 2);
  assert.equal(r.undo.size, steps + 2, 'dropped where it was: no step');
  // The file: `order` written, the schema takes it and keeps it through its canonical text (object keys sorted), a
  // Library read back has the order; a file with a bad order is refused.
  const f = r.file();
  const v = validateStudioFile(f, { tool: 'placement' });
  assert.ok(v.ok, JSON.stringify(v));
  const row = (f.motions as LibraryMotion[]).find((m) => m.name === 'Row')!;
  assert.deepEqual(row.order, ['buoy', 'crate', 'boat']);
  const back = JSON.parse(v.json!) as { motions: LibraryMotion[] };
  assert.deepEqual(back.motions.find((m) => m.name === 'Row')!.order, ['buoy', 'crate', 'boat'], 'the canonical text keeps the array\'s order');
  assert.deepEqual(Object.keys(back.motions.find((m) => m.name === 'Row')!.tracks!), ['boat', 'buoy', 'crate'], '(its object keys are sorted: why `order` is an array)');
  const again = new MotionLibrary();
  again.restore(back as never);
  assert.deepEqual(Object.keys(again.get('Row')!.tracks!).length, 3);
  assert.deepEqual(again.get('Row')!.order, ['buoy', 'crate', 'boat'], 'read back in the same order');
  const bad = JSON.parse(JSON.stringify(f)) as { motions: LibraryMotion[] };
  bad.motions.find((m) => m.name === 'Row')!.order = ['buoy', 'crate'];
  assert.ok(!validateStudioFile(bad, { tool: 'placement' }).ok, 'an order that misses a track is refused');
  // Undo twice: the first order again.
  r.undoAll();
  r.undoAll();
  assert.deepEqual(r.rows(), ['boat', 'crate', 'buoy']);
  // Not a scene: reorder() does nothing (no grips are drawn then).
  r.acts().leave!('crate');
  r.acts().leave!('buoy');
  assert.equal(r.view().scene, null);
  const n = r.undo.size;
  r.acts().reorder!('boat', 0);
  assert.equal(r.undo.size, n);
  // Several picked, every motion shown: the list's order, never the picked one first.
  r.pick(null, ['buoy', 'boat']);
  assert.deepEqual(r.rows(), ['boat', 'buoy'], 'several picked: the list\'s order');
  r.pick('buoy');
  r.acts().showAll!(true);
  assert.deepEqual(r.rows(), ['boat', 'buoy'], 'every motion: the list\'s order, the buoy picked and not moved');
});

// ----- 2. no "New: Scene" -----
test('the clip menu has no "New: Scene" (one way in: + Make a motion; linking makes a scene); a scene made before opens as it did', () => {
  for (const f of ['timeline-panel.ts', 'timeline-wire.ts', 'timeline-model.ts']) {
    const c = code(f);
    assert.ok(!c.includes('new:scene') && !c.includes('sceneClip') && !c.includes('tl.tpl.scene') && !c.includes('tl.scene.new'), `${f}: no scene line`);
  }
  assert.ok(code('timeline-panel.ts').includes("'new:make'"), '"+ Make a motion" stays');
  for (const lang of ['en', 'ja'] as const) for (const k of ['tl.new', 'tl.tpl.scene', 'tl.scene.new']) assert.equal(translate(lang, k), k, `${lang}: ${k} is gone`);
  // A file with a scene motion (made with the old "New: Scene", or by linking): it opens on its objects, in its order.
  const r = rig({
    motions: [{ name: 'Arrival', len: 4, keys: {}, tracks: { buoy: { p: BOB }, boat: { p: ROW }, crate: {} } }],
    motion: { boat: { clips: [{ name: 'Arrival', use: 'Arrival', len: 4, when: { on: 'start' }, keys: {} }] }, buoy: { clips: [{ name: 'Arrival', use: 'Arrival', len: 4, when: { on: 'start' }, keys: {} }] },
      crate: { clips: [{ name: 'Arrival', use: 'Arrival', len: 4, when: { on: 'start' }, keys: {} }] } },
  });
  assert.deepEqual(r.view().scene, { name: 'Arrival', n: 3 });
  assert.deepEqual(r.rows(), ['buoy', 'boat', 'crate'], 'the tracks as written (no `order` in the file): not the list\'s, not the picked one first');
  r.pick('crate');
  assert.deepEqual(r.rows(), ['buoy', 'boat', 'crate']);
  assert.deepEqual(r.view().rows.map((x) => x.member), [true, true, true]);
});

// ----- 3. the words -----
test('the words are Gemini\'s (wording-gemini-1023b), in both languages', () => {
  const table: Array<[string, string, string]> = [
    ['tl.sel', '選択中: 2', '2 selected'],
    ['tl.ease', '進み方', 'Pace'],
    ['tl.ease.ease', 'なめらかに（自然な加減速）', 'Smooth (slow start & stop)'],
    ['tl.ease.linear', 'ずっと同じ速さ', 'Steady'],
    ['tl.ease.step', '待ってからパッと飛ぶ', 'Hold, then jump'],
    ['tl.point', '通り道', 'Path'],
    ['tl.point.smooth', '丸くなめらかに', 'Smooth curve'],
    ['tl.point.corner', 'カクッとまっすぐ', 'Sharp corner'],
    ['tl.point.custom', 'じぶんで調整', 'Custom'],
    ['tl.sel.delete', '消す', 'Delete'],
    ['tl.when.also', '動かすきっかけ', 'Trigger'],
    ['tl.all.k', '表示する行', 'Tracks'],
    ['tl.loopEnd', '終わり方とくり返し', 'Loop & End'],
  ];
  for (const [k, ja, en] of table) {
    assert.equal(translate('ja', k, { n: 2 }), ja, `ja ${k}`);
    assert.equal(translate('en', k, { n: 2 }), en, `en ${k}`);
  }
  // The words that go with them exist in both languages.
  for (const lang of ['en', 'ja'] as const) for (const k of ['tl.rowDrag', 'tl.askShort', 'tl.then', 'tl.moreTip', 'tl.easeTip', 'tl.pointTip']) assert.notEqual(translate(lang, k), k, `${lang}: ${k}`);
  // The old words are nowhere on screen.
  const i18n = read('i18n.ts').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  // (the labels and menu lines themselves: Delete's tooltip, "delete the picked keys", is a sentence that may keep the old words)
  for (const w of ["'選んだキー · {n}'", "'次のキーまで'", "'ゆっくり出て、ゆっくり着く'", "'道の曲がり方'", "'角で'", "'手で曲げた'", "'ほかにも'", "'止まり方'", "'Keys picked · {n}'", "'To the next key'", "'Eases in and out'", "'Path turns'", "'At a corner'", "'Bent by hand'", "'Also starts'"]) {
    assert.ok(!i18n.includes(w), `"${w}" is gone`);
  }
});

// ----- 4. the plate's code and CSS -----
test('the plate: a grip on a scene\'s rows, the focused row\'s "+", one "Loop & End" row in ⋯, "✦ AI" narrow; the CSS: the names column grows, the card wraps', () => {
  const panel = code('timeline-panel.ts');
  const rows = between(panel, 'function renderRows(', 'function allRow(');
  assert.ok(rows.includes('grip(r)') && rows.includes("dataset: { row: r.key, ...(drag ? { drag: '1' } : {}) }"), 'a scene\'s rows carry a grip');
  assert.ok(rows.includes('linkBtn(v)') && !rows.includes('linkRow('), 'the focused row has the "+"; no link row under the rows');
  assert.match(rows, /v\.scene && v\.scene\.n > 1 && r\.member && act\.reorder/, 'grips only in a scene of two or more');
  const drag = between(panel, 'function grip(', 'function drawKeys(');
  assert.ok(drag.includes('setPointerCapture') && drag.includes('act.reorder?.(') && drag.includes("'ArrowUp'") && drag.includes("'ArrowDown'"), 'a drag with pointer capture; ↑ / ↓ on the grip');
  const more = between(panel, 'function renderMore(', 'function fresh(');
  assert.ok(more.includes("'tl-more-loop'") && more.includes("t('tl.loopEnd')") && !more.includes("'tl-more-stops'") && !more.includes("'tl-more-repeat'"), 'Repeat and Stops are one row, "Loop & End"');
  assert.ok(more.includes("'tl-more-link'") && more.includes("t('tl.link')"), '"+ Link an object" in words, in the Tracks row');
  const head = between(panel, 'function renderHead(', 'const field = ');
  assert.ok(head.includes("t('tl.askShort')") && head.includes("'tl-ask-s'"), '"✦ AI" for a narrow plate');
  assert.equal(typeof (panel.match(/reorder\?\(key: string, to: number\): void/) ?? [])[0], 'string', 'TimelineActs.reorder');
  const css = read('shell.css');
  assert.match(css, /\.tl-body \{[^}]*grid-template-columns: fit-content\(var\(--tl-names-max\)\) minmax\(0, 1fr\)/, 'the names column is as wide as the names, up to a cap');
  assert.match(css, /\.tl-names-col \{ min-width: var\(--tl-names\); \}/);
  assert.match(css, /\.timeline \{[^}]*--tl-names: 140px; --tl-names-max: 300px/);
  for (const sel of ['.tl-grip {', '.tl-drop-mark {', '.tl-link-add {', '.tl-link-hint {', '.tl-name.dragging, .tl-lane.dragging {']) assert.ok(css.includes(`\n${sel}`), `${sel} is styled`);
  assert.match(css, /\.timeline\.narrow \.tl-ask-s \{ display: inline; \}/);
  assert.doesNotMatch(css, /\.timeline\.narrow \.tl-head > \.tl-ask \{[^}]*width: var\(--h\)/, 'the narrow ✦ is not a square any more');
  assert.match(css, /\.tl-ask \.icon \{[^}]*color: var\(--ai-text\)/, 'the spark in the readable tint (light: darker)');
  assert.match(css, /\.motion-cells \{[^}]*flex-wrap: wrap/, 'the card\'s Motion row wraps instead of cutting the menu');
  assert.match(css, /\.motion-cells \.motion-pick \{ flex: 1 1 150px; \}/);
  assert.match(css, /\.shell:not\(\[data-layout="phone"\]\) \.presence-row \.presence \{[^}]*width: 100%/, 'the presence line is the bar\'s own top on a PC');
  assert.match(css, /\.tl-more-k \{[^}]*width: 9\.5em/, '"終わり方とくり返し" on one line, PC and phone');
  assert.match(css, /\.timeline\.narrow \.tl-obj \{[^}]*-webkit-line-clamp: 2/, 'a phone\'s long name wraps to two lines');
});
