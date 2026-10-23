// "Two uniforms" (studio-uniforms, 2026-10-23): a plain button acts in the editor at
// once (⌘Z undoes) and never writes in the AI box; a ✦ row only puts a draft there. This file covers what the hand now
// does itself instead of typing into the box — Rename in place (placement.json `names`) — and the menus' words.
// The press-every-plain-button check in the real editor is test/studio-uniforms.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/uniforms.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { displayName, useGivenNames } from '../src/shell/names.ts';
import { Levels } from '../src/shell/levels.ts';
import { validatePlacement } from '../src/schema/index.ts';
import { translate } from '../src/shell/i18n.ts';
import { KEYMAP } from '../src/shell/keymap.ts';
import type { Item, PlacementFile } from '../src/contract.ts';

const item = (key: string, p: number[]): Item => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p, r: 0, s: 1 } });
const file = (extra: Partial<PlacementFile> = {}): PlacementFile => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, ...extra });

test('Rename in place: one Save count, written as `names`, back to nothing on undo, kept by Save', () => {
  const m = new PlacementModel();
  m.setItems([item('ship', [0, 0, 4]), item('gate', [0, 0, -22])], '3d');
  assert.equal(m.rename('ship', '  Hero ship '), null, 'no name before');
  assert.equal(m.nameOf('ship'), 'Hero ship', 'trimmed');
  assert.equal(m.dirty(), 1);
  assert.ok(m.changedKeys().has('ship'), 'its row gets the unsaved dot');
  assert.deepEqual(m.result().names, { 'ship': 'Hero ship' });
  assert.deepEqual(m.result().objects, {}, 'a rename is not a move');
  m.markSaved();
  assert.equal(m.dirty(), 0);
  // Back to the game's own name: the entry goes, one change again until saved.
  assert.equal(m.rename('ship', ''), 'Hero ship');
  assert.equal(m.result().names, undefined);
  assert.equal(m.dirty(), 1);
  // A deleted object's name is not written (the AI takes the object out).
  m.rename('gate', 'Big gate');
  m.remove('gate');
  assert.equal(m.result().names, undefined);
});

test('a saved name comes back on reopening, and the file is checked', () => {
  const f = file({ names: { ship: 'Hero ship' } });
  const v = validatePlacement(f);
  assert.ok(v.ok);
  assert.deepEqual(v.ok && v.value.names, { ship: 'Hero ship' });
  const m = new PlacementModel();
  m.restore(v.ok ? v.value : null);
  m.setItems([item('ship', [0, 0, 4])], '3d');
  assert.equal(m.nameOf('ship'), 'Hero ship');
  assert.equal(m.dirty(), 0, 'saved, not a change');
  assert.equal(validatePlacement(file({ names: { 'bad key!': 'x' } })).ok, false);
  assert.equal(validatePlacement(file({ names: { ship: 3 as unknown as string } })).ok, false);
  // Per level with levels (like motion): never at the top next to `levels`.
  assert.equal(validatePlacement(file({ names: { ship: 'A' }, levels: [{ id: 'a' }] })).ok, false);
  assert.ok(validatePlacement(file({ levels: [{ id: 'a', names: { ship: 'A' } }] })).ok);
});

test('names are a level\'s own: kept on a switch and written into the level', () => {
  const lv = new Levels();
  lv.fromGame([{ id: 'meadow' }, { id: 'cave' }], 'meadow');
  lv.stash({ objects: {}, names: { boat: 'Red boat' } }, 1);
  lv.current = 'cave';
  const out = lv.compose(file({ names: { buoy: 'Buoy' } }));
  assert.equal(out.names, undefined);
  assert.deepEqual(out.levels!.map((l) => l.names), [{ boat: 'Red boat' }, { buoy: 'Buoy' }]);
});

test('the name shows everywhere displayName does (list, card, chip, menus), until cleared', () => {
  const names = new Map([['ship', 'Hero ship']]);
  useGivenNames((k) => names.get(k));
  try {
    const t = (k: string) => k;
    assert.equal(displayName({ key: 'ship', label: 'ship', kinds: ['mesh'] }, t), 'Hero ship');
    assert.equal(displayName({ key: 'gate', label: 'gate', kinds: ['mesh'] }, t), 'gate');
    // A UI element keeps its own name (it is renamed in its HTML, not here).
    assert.notEqual(displayName({ key: 'ship', label: 'ship', kinds: ['ui'] }, t), 'Hero ship');
  } finally {
    useGivenNames(() => undefined);
  }
});

test('a rename is one undo step', () => {
  const u = new UndoStack();
  assert.ok(u.push({ changes: [{ kind: 'name', key: 'ship', from: null, to: 'Hero ship' }] }));
  assert.equal(u.push({ changes: [{ kind: 'name', key: 'ship', from: 'A', to: 'A' }] }), false, 'the same name again is nothing');
  assert.deepEqual(u.undo()?.changes[0], { kind: 'name', key: 'ship', from: null, to: 'Hero ship' });
});

test('the words: F2 is Rename in the one key table; ✦ rows say "Ask AI to …" with an ellipsis, in both languages', () => {
  assert.deepEqual(KEYMAP.find((k) => k.id === 'rename')?.keys, ['F2']);
  for (const k of ['ctx.askObject', 'ctx.askMany', 'ctx.askGame', 'ctx.askMotion', 'ctx.nameAsk', 'ctx.nameAskMany', 'lib.askAboutIt', 'lib.addFileAi']) {
    const en = translate('en', k, { name: 'ship', n: 2 }), ja = translate('ja', k, { name: 'ship', n: 2 });
    assert.match(en, /^Ask AI .*…$/, `${k}: ${en}`);
    assert.match(ja, /AI に頼む…$/, `${k}: ${ja}`);
  }
  // A plain row never promises a draft: Rename has no "…" any more (it is a field, not a request).
  assert.equal(translate('en', 'ctx.rename'), 'Rename');
  assert.equal(translate('ja', 'ctx.rename'), '名前を変える');
  for (const k of ['level.first', 'level.nth', 'level.blank', 'level.duplicate', 'level.made', 'level.madeTouch', 'level.madeClose', 'level.undoMade', 'ctx.nameText', 'ctx.renameLabel', 'undo.rename']) {
    for (const lang of ['en', 'ja'] as const) assert.notEqual(translate(lang, k), k, `${lang}: ${k}`);
  }
  // level-menu2 (2026-10-23): the line after New level / Duplicate is one short sentence with the undo key.
  assert.equal(translate('en', 'level.made', { name: 'Level 2', key: '⌘Z' }), 'Level 2 made. ⌘Z to undo.');
  assert.equal(translate('ja', 'level.made', { name: 'レベル 2', key: '⌘Z' }), 'レベル 2 を作りました。⌘Z で取り消し');
});
