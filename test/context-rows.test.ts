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

test('an object in the scene: ask, rename, duplicate / copy / paste / delete, undo / redo', () => {
  const rows = contextRows('object', base);
  assert.deepEqual(ids(rows), ['ask', 'rename', '—', 'duplicate', 'copy', 'paste', 'remove', '—', 'showInLibrary', '—', 'undo', 'redo']);
  assert.equal(row(rows, 'paste')!.disabled, true, 'nothing copied yet: Paste is dimmed, not gone');
  assert.equal(row(rows, 'redo')!.disabled, true);
  assert.equal(row(rows, 'undo')!.disabled, false);
  assert.equal(row(rows, 'duplicate')!.disabled, false);
});

test('several picked: the same rows (they act on all), no Rename; unnamed ones get "name them"', () => {
  assert.deepEqual(ids(contextRows('object', { ...base, picked: 3, movable: 3 })), ['ask', '—', 'duplicate', 'copy', 'paste', 'remove', '—', 'showInLibrary', '—', 'undo', 'redo']);
  const named = contextRows('object', { ...base, picked: 3, movable: 3, unnamed: 2 });
  assert.equal(row(named, 'name')!.label, 'ctx.nameMany');
  assert.equal(row(contextRows('object', { ...base, unnamed: 1 }), 'name')!.label, 'ask.name');
});

test('locked objects (the game\'s rules): duplicate, copy and delete are dimmed', () => {
  const rows = contextRows('object', { ...base, movable: 0 });
  for (const id of ['duplicate', 'copy', 'remove']) assert.equal(row(rows, id)!.disabled, true, id);
});

test('the web demo (no AI behind it) has no "Ask your AI" and no naming, and no empty group left behind', () => {
  const obj = contextRows('object', { ...base, offline: true, unnamed: 1 });
  assert.deepEqual(ids(obj), ['duplicate', 'copy', 'paste', 'remove', '—', 'showInLibrary', '—', 'undo', 'redo']);
  const scene = contextRows('scene', { ...base, offline: true });
  assert.equal(ids(scene)[0], 'paste');
  assert.ok(!ids(scene).includes('ask'));
});

test('2D with draw order: the four layer moves, dimmed when the pick cannot go that way', () => {
  const rows = contextRows('object', { ...base, dim: '2d', layers: { forward: true, backward: false, toFront: true, toBack: false } });
  assert.deepEqual(ids(rows), ['ask', 'rename', '—', 'duplicate', 'copy', 'paste', 'remove', '—', 'showInLibrary', '—', 'layer-forward', 'layer-backward', 'layer-toFront', 'layer-toBack', '—', 'undo', 'redo']);
  assert.equal(row(rows, 'layer-backward')!.disabled, true);
  assert.equal(row(rows, 'layer-toFront')!.key, 'toFront');
  // A phone keeps the two big moves (the card's Layer row has the one-step ones).
  assert.deepEqual(ids(contextRows('object', { ...base, dim: '2d', compact: true, layers: { forward: true, backward: true, toFront: true, toBack: true } })).filter((i) => i.startsWith('layer')), ['layer-toFront', 'layer-toBack']);
  // 3D never lists them.
  assert.ok(!ids(contextRows('object', { ...base, layers: { forward: true } })).includes('layer-forward'));
});

test('nothing under the pointer: paste, select all, deselect, show all, opening view, undo / redo', () => {
  const rows = contextRows('scene', { ...base, clip: 2 });
  assert.deepEqual(ids(rows), ['ask', '—', 'paste', 'selectAll', 'deselect', '—', 'frame', 'home', '—', 'undo', 'redo']);
  assert.equal(row(rows, 'paste')!.disabled, false);
  assert.equal(row(rows, 'deselect')!.disabled, false);
  assert.equal(row(contextRows('scene', { ...base, anyPicked: false }), 'deselect')!.disabled, true);
  assert.equal(row(contextRows('scene', { ...base, items: 0 }), 'selectAll')!.disabled, true);
  assert.equal(row(rows, 'ask')!.label, 'ask.game');
});

test('while the game is not editable (loading): every row that changes the scene is dimmed', () => {
  for (const r of contextRows('object', { ...base, editing: false, clip: 1 })) {
    // Asking and the way to the Library change nothing in the scene: they stay.
    if (!('sep' in r) && !['ask', 'rename', 'showInLibrary', 'showFileInLibrary'].includes(r.id)) assert.equal(r.disabled, true, r.id);
  }
});

test('the Library: an object has Add to scene, Ask your AI, Details, Show in game, Duplicate, Delete; a file has Add to scene, Ask your AI, Details, Show just these objects, Replace', () => {
  assert.deepEqual(ids(contextRows('libObject', base)), ['addToScene', 'ask', '—', 'details', 'showInGame', '—', 'duplicate', 'remove']);
  assert.equal(row(contextRows('libObject', { ...base, movable: 0 }), 'addToScene')!.disabled, true, 'a locked object cannot be copied');
  const file = contextRows('libFile', { ...base, users: 0, exists: true });
  assert.deepEqual(ids(file), ['addFile', 'askFile', '—', 'details', 'showUsers', '—', 'replace']);
  assert.equal(row(file, 'addFile')!.disabled, false);
  assert.equal(row(contextRows('libFile', { ...base, exists: false }), 'addFile')!.disabled, true, 'a missing file cannot be added');
  assert.equal(row(file, 'showUsers')!.disabled, true, 'no object uses it');
  assert.equal(row(contextRows('libFile', { ...base, users: 3 }), 'showUsers')!.disabled, false);
});

test('use the Library: the Scene\'s object has Show in Library, and Show its asset in Library when it is drawn with a file (not on a phone)', () => {
  assert.deepEqual(ids(contextRows('object', { ...base, sourceFiles: 1 })).slice(8, 11), ['showInLibrary', 'showFileInLibrary', '—']);
  assert.ok(!ids(contextRows('object', { ...base, sourceFiles: 0 })).includes('showFileInLibrary'), 'drawn in code: no file to show');
  assert.ok(!ids(contextRows('object', { ...base, sourceFiles: 2, compact: true })).includes('showFileInLibrary'), 'a phone keeps the menu short');
  // The web demo: no AI rows; a file's Add to scene stays, dimmed (the detail says why).
  assert.deepEqual(ids(contextRows('libObject', { ...base, offline: true })), ['addToScene', '—', 'details', 'showInGame', '—', 'duplicate', 'remove']);
  const demo = contextRows('libFile', { ...base, offline: true, exists: true });
  assert.deepEqual(ids(demo), ['addFile', '—', 'details', 'showUsers', '—', 'replace']);
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
  assert.equal(translate('ja', 'ctx.showUsers'), '使っている物だけ見る');
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
