// The right-click / long-press menu, per place (context menu, 2026-10-18): which rows each place lists, which are
// dimmed, that the names and keys are the editor's own (one action, one name, one key everywhere), and where the menu
// opens near the window's edges. The menu in the real editor (opening, choosing, Esc, the camera staying put) is
// test/studio-context-menu.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/context-rows.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { contextRows, type CtxFacts, type CtxRow } from '../src/shell/context-rows.ts';
import { placeMenu } from '../src/shell/context-menu.ts';
import { KEYMAP } from '../src/shell/keymap.ts';
import { translate } from '../src/shell/i18n.ts';

const base: CtxFacts = {
  dim: '3d', offline: false, editing: true, picked: 1, movable: 1, unnamed: 0, anyPicked: true,
  items: 8, clip: 0, canUndo: true, canRedo: false,
};
const ids = (rows: CtxRow[]) => rows.map((r) => ('sep' in r ? '—' : r.id));
const row = (rows: CtxRow[], id: string) => rows.find((r) => !('sep' in r) && r.id === id) as Exclude<CtxRow, { sep: true }> | undefined;

test('an object in the scene (PC): rename, duplicate / copy / delete, show in Library, then ✦ ask — 7 rows at most, no undo / redo', () => {
  const rows = contextRows('object', base);
  assert.deepEqual(ids(rows), ['rename', '—', 'duplicate', 'copy', 'remove', '—', 'showInLibrary', '—', 'ask']);
  assert.ok(!row(rows, 'paste'), 'nothing copied: no Paste row (not a dimmed one)');
  assert.equal(row(rows, 'duplicate')!.disabled, false);
  const withClip = contextRows('object', { ...base, clip: 1 });
  assert.deepEqual(ids(withClip), ['rename', '—', 'duplicate', 'copy', 'paste', 'remove', '—', 'showInLibrary', '—', 'ask']);
  assert.ok(withClip.filter((r) => !('sep' in r)).length <= 7, 'review 2 ②: 7 rows at most');
  // studio-uniforms (two uniforms): Rename acts in place with its key; ✦ rows are marked and last.
  assert.equal(row(rows, 'rename')!.key, 'rename');
  assert.equal(row(rows, 'rename')!.ai, undefined);
  assert.equal(row(rows, 'ask')!.ai, true);
  for (const id of ['undo', 'redo', 'showFileInLibrary']) assert.ok(!ids(contextRows('object', { ...base, clip: 1, sourceFiles: 1 })).includes(id), id);
});

test('several picked: the same rows (they act on all), no Rename; unnamed ones get "name them"', () => {
  assert.deepEqual(ids(contextRows('object', { ...base, picked: 3, movable: 3 })), ['duplicate', 'copy', 'remove', '—', 'showInLibrary', '—', 'ask']);
  const named = contextRows('object', { ...base, picked: 3, movable: 3, unnamed: 2 });
  assert.equal(row(named, 'name')!.label, 'ctx.nameAskMany');
  assert.equal(row(named, 'name')!.ai, true, 'naming is a ✦ draft, like every ask');
  assert.equal(row(contextRows('object', { ...base, unnamed: 1 }), 'name')!.label, 'ctx.nameAsk');
  assert.ok(!ids(contextRows('object', { ...base, unnamed: 1 })).includes('rename'), 'an unnamed object is named by the AI first');
});

test('locked objects (the game\'s rules): duplicate, copy and delete are dimmed on a PC', () => {
  const rows = contextRows('object', { ...base, movable: 0 });
  for (const id of ['duplicate', 'copy', 'remove']) assert.equal(row(rows, id)!.disabled, true, id);
});

test('a phone: 5 rows at most, none dimmed — ask, rename, show in Library, (2D) to front / to back', () => {
  const phone = { ...base, compact: true, clip: 2 };
  assert.deepEqual(ids(contextRows('object', phone)), ['rename', '—', 'showInLibrary', '—', 'ask']);
  const two = contextRows('object', { ...phone, dim: '2d', layers: { forward: true, backward: true, toFront: true, toBack: true } });
  assert.deepEqual(ids(two), ['rename', '—', 'showInLibrary', '—', 'layer-toFront', 'layer-toBack', '—', 'ask']);
  // At the front already: "to front" is left out, not dimmed.
  assert.deepEqual(ids(contextRows('object', { ...phone, dim: '2d', layers: { forward: false, backward: true, toFront: false, toBack: true } })).filter((i) => i.startsWith('layer')), ['layer-toBack']);
  for (const f of [phone, { ...phone, movable: 0 }, { ...phone, editing: false }, { ...phone, dim: '2d' as const, layers: { toFront: true, toBack: true } }]) {
    for (const p of ['object', 'scene'] as const) {
      const rs = contextRows(p, f).filter((r) => !('sep' in r));
      assert.ok(rs.length <= 5, `${p}: ${rs.length} rows`);
      assert.ok(rs.every((r) => !('sep' in r) && !r.disabled), `${p}: a dimmed row`);
    }
  }
});

test('the web demo (no AI behind it) has no "Ask your AI" and no naming, and no empty group left behind', () => {
  const obj = contextRows('object', { ...base, offline: true, unnamed: 1 });
  assert.deepEqual(ids(obj), ['duplicate', 'copy', 'remove', '—', 'showInLibrary']);
  const scene = contextRows('scene', { ...base, offline: true });
  assert.equal(ids(scene)[0], 'selectAll');
  assert.ok(!ids(scene).includes('ask'));
});

test('2D with draw order: to front / to back only (one step is ⌘] ⌘[ and the card), dimmed on a PC when it cannot go', () => {
  const rows = contextRows('object', { ...base, dim: '2d', layers: { forward: true, backward: false, toFront: true, toBack: false } });
  assert.deepEqual(ids(rows), ['rename', '—', 'duplicate', 'copy', 'remove', '—', 'showInLibrary', '—', 'layer-toFront', 'layer-toBack', '—', 'ask']);
  assert.equal(row(rows, 'layer-toBack')!.disabled, true);
  assert.equal(row(rows, 'layer-toFront')!.key, 'toFront');
  // 3D never lists them.
  assert.ok(!ids(contextRows('object', { ...base, layers: { toFront: true } })).includes('layer-toFront'));
});

test('nothing under the pointer: only rows that can act — paste, select all, deselect, show all, opening view', () => {
  const rows = contextRows('scene', { ...base, clip: 2 });
  assert.deepEqual(ids(rows), ['paste', 'selectAll', 'deselect', '—', 'frame', 'home', '—', 'ask']);
  assert.ok(rows.every((r) => 'sep' in r || !r.disabled), 'no dimmed rows');
  assert.deepEqual(ids(contextRows('scene', { ...base, anyPicked: false })), ['selectAll', '—', 'frame', 'home', '—', 'ask'], 'Deselect only while something is picked; Paste only with something copied');
  assert.ok(!ids(contextRows('scene', { ...base, items: 0 })).includes('selectAll'));
  assert.equal(row(rows, 'ask')!.label, 'ctx.askGame');
  assert.equal(row(rows, 'ask')!.ai, true);
});

test('while the game is not editable (loading): nothing that changes the scene can be chosen', () => {
  for (const r of [...contextRows('object', { ...base, editing: false, clip: 1 }), ...contextRows('scene', { ...base, editing: false, clip: 1 })]) {
    // Asking, the way to the Library and Deselect change nothing in the scene: they stay.
    if (!('sep' in r) && !['ask', 'rename', 'showInLibrary', 'deselect'].includes(r.id)) assert.equal(r.disabled, true, r.id);
  }
});

test('the Library: an object has Add to scene, Show in game, Delete, ✦ ask (no Duplicate); a file has Replace, ✦ add, ✦ ask', () => {
  assert.deepEqual(ids(contextRows('libObject', base)), ['addToScene', '—', 'showInGame', 'remove', '—', 'ask']);
  assert.equal(row(contextRows('libObject', { ...base, movable: 0 }), 'addToScene')!.disabled, true, 'a locked object cannot be copied');
  const file = contextRows('libFile', { ...base, users: 0, exists: true });
  assert.deepEqual(ids(file), ['replace', '—', 'addFile', 'askFile']);
  assert.equal(row(file, 'addFile')!.disabled, false);
  // A new object from a file is code: its "add" is a ✦ request (a draft in the box), not a plain row.
  assert.equal(row(file, 'addFile')!.ai, true);
  assert.equal(row(file, 'addFile')!.label, 'lib.addFileAi');
  assert.equal(row(contextRows('libFile', { ...base, exists: false }), 'addFile')!.disabled, true, 'a missing file cannot be added');
  // The web demo: no AI rows; a file's Add to scene stays, dimmed (the detail says why).
  assert.deepEqual(ids(contextRows('libObject', { ...base, offline: true })), ['addToScene', '—', 'showInGame', 'remove']);
  const demo = contextRows('libFile', { ...base, offline: true, exists: true });
  assert.deepEqual(ids(demo), ['replace', '—', 'addFile']);
  assert.equal(row(demo, 'addFile')!.disabled, true);
});

test('every row has words in English and Japanese, and every key is a row of the one shortcut table', () => {
  const places = ['object', 'scene', 'libObject', 'libFile'] as const;
  const facts: CtxFacts = { ...base, dim: '2d', unnamed: 1, sourceFiles: 1, layers: { forward: true, backward: true, toFront: true, toBack: true } };
  for (const p of places) {
    for (const r of [...contextRows(p, facts), ...contextRows(p, { ...base, picked: 1 })]) {
      if ('sep' in r) continue;
      for (const lang of ['en', 'ja'] as const) {
        const s = translate(lang, r.label);
        assert.ok(s && s !== r.label, `${lang}: ${r.label}`);
      }
      if (r.key) assert.ok(KEYMAP.some((k) => k.id === r.key), `${r.id}: key ${r.key} is in keymap.ts`);
    }
  }
  // The same words as the buttons / sheet for the same action.
  assert.equal(translate('en', 'ops.copy'), 'Duplicate');
    assert.equal(translate('ja', 'ctx.replace'), '差し替え…');
});

test('the menu opens at the pointer and moves in at the window edges', () => {
  // Room everywhere: its corner 2 px off the pointer.
  assert.deepEqual(placeMenu(100, 100, 200, 300, 1280, 800), { left: 102, top: 102 });
  // Near the right edge it opens to the left; near the bottom, upwards.
  assert.deepEqual(placeMenu(1200, 700, 200, 300, 1280, 800), { left: 998, top: 398 });
  // A finger: centred above it, never off the window.
  assert.deepEqual(placeMenu(195, 600, 224, 300, 390, 844, true), { left: 83, top: 284 });
  assert.deepEqual(placeMenu(10, 100, 224, 300, 390, 844, true), { left: 8, top: 124 });
  // Taller than the window: pinned to the margin.
  assert.equal(placeMenu(100, 100, 200, 900, 1280, 800).top, 8);
});

test('a phone: the menu opened by a finger stays 8 px above the card / ask box (review 2 ②)', () => {
  // A finger low on the game, the card's top at 600: the menu ends at 592 at the latest.
  const p = placeMenu(195, 640, 224, 230, 390, 844, true, 600);
  assert.ok(p.top + 230 <= 592, `bottom ${p.top + 230}`);
  // No floor: the window's bottom, as before.
  assert.deepEqual(placeMenu(195, 600, 224, 300, 390, 844, true), { left: 83, top: 284 });
});

test('an object with a motion: "✦ Ask AI about “Hop”…" after ✦ Ask (studio-motion-panel), not with several picked or no AI', () => {
  const rows = contextRows('object', { ...base, motion: 'Hop' });
  assert.deepEqual(ids(rows).slice(-3), ['—', 'ask', 'askMotion']);
  assert.equal(translate('ja', row(rows, 'askMotion')!.label, { name: 'Hop' }), '「Hop」について AI に頼む…');
  assert.ok(!ids(contextRows('object', { ...base, motion: 'Hop', picked: 2, movable: 2 })).includes('askMotion'), 'several picked');
  assert.ok(!ids(contextRows('object', { ...base, motion: 'Hop', offline: true })).includes('askMotion'), 'the web demo has no AI');
});
