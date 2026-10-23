// Levels (2026-10-22, CONTRACT.md §1.10): the shell's level list (src/shell/levels.ts), the game
// page's studio.levels() answer (src/bridge/levels.ts) and placement.json's `levels` (the one validator).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Levels, slugOf } from '../src/shell/levels.ts';
import { cleanLevels, pickLevel } from '../src/bridge/levels.ts';
import { validatePlacement } from '../src/schema/index.ts';
import type { PlacementFile } from '../src/contract.ts';

const CODE = [{ id: 'meadow', label: 'Meadow' }, { id: 'cave', label: 'Cave' }, { id: 'summit', label: 'Summit' }];
const file = (objects: PlacementFile['objects'] = {}): PlacementFile => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects });
const rock = { p: [2, 0, 1], was: { p: [0, 0, 1] } };

test('a game with one level (or none): nothing changes, the file keeps its bytes', () => {
  const lv = new Levels();
  lv.load(file({ rock }));
  assert.equal(lv.fromGame([{ id: 'main' }], 'main'), false);
  assert.equal(lv.active, false);
  const f = file({ rock });
  assert.equal(lv.compose(f), f, 'the same object back');
});

test('three levels: the list follows the code; the file gets every level, no levelsWas while nothing differs', () => {
  const lv = new Levels();
  lv.load(file({ rock }));
  assert.equal(lv.fromGame(CODE, 'meadow', { objects: { rock } }), true);
  assert.deepEqual(lv.list.map((e) => lv.labelOf(e.id)), ['Meadow', 'Cave', 'Summit']);
  const out = lv.compose(file({ rock }));
  assert.deepEqual(out.objects, {});
  assert.deepEqual(out.levels, [{ id: 'meadow', label: 'Meadow', objects: { rock } }, { id: 'cave', label: 'Cave' }, { id: 'summit', label: 'Summit' }]);
  assert.equal(out.levelsWas, undefined);
  assert.ok(validatePlacement(out).ok);
});

test('switching keeps each level\'s layout and unsaved count; Save clears them', () => {
  const lv = new Levels();
  lv.fromGame(CODE, 'meadow');
  lv.stash({ objects: { rock } }, 1);
  lv.current = 'cave';
  assert.deepEqual(lv.viewOf('meadow').objects, { rock }, 'a fresh model restores Meadow from here');
  assert.deepEqual(lv.viewOf('cave').objects, {});
  assert.equal(lv.dirtyElsewhere(), 1);
  const out = lv.compose(file({ gem: { p: [1, 1, 1], was: { p: [0, 1, 1] } } }));
  assert.deepEqual(out.levels!.map((l) => Object.keys(l.objects || {})), [['rock'], ['gem'], []]);
  lv.markSaved();
  assert.equal(lv.dirtyElsewhere(), 0);
});

test('copy, rename, move and delete: one change each, written for the AI (from, labelWas, levelsWas)', () => {
  const lv = new Levels();
  lv.fromGame(CODE, 'cave');
  const id = lv.copy({ objects: { rock } });
  assert.equal(id, 'cave-2');
  assert.equal(lv.labelOf(id), 'Cave 2');
  assert.equal(lv.build(id), 'cave', 'built from the level it was copied from');
  assert.deepEqual(lv.list.map((e) => e.id), ['meadow', 'cave', 'cave-2', 'summit'], 'right after the one on screen');
  lv.current = id;
  assert.equal(lv.copy({ objects: {} }), 'cave-3', 'a copy of a copy: the next number, built from the same code level');
  assert.equal(lv.build('cave-3'), 'cave');
  assert.ok(lv.rename('summit', 'Top'));
  assert.equal(lv.rename('summit', 'Top'), false, 'the same name is no change');
  assert.ok(lv.move('summit', -1));
  assert.equal(lv.move('meadow', -1), false, 'already first');
  assert.equal(lv.remove('meadow'), '', 'not the one on screen');
  assert.equal(lv.structDirty, 5, 'two copies, a rename, a move, a delete');
  const out = lv.compose(file());
  assert.deepEqual(out.levels!.map((l) => [l.id, l.label, l.from, l.labelWas]), [
    ['cave', 'Cave', undefined, undefined],
    ['cave-2', 'Cave 2', 'cave', undefined],
    ['summit', 'Top', undefined, 'Summit'],
    ['cave-3', 'Cave 3', 'cave', undefined],
  ]);
  assert.deepEqual(out.levelsWas, ['meadow', 'cave', 'summit'], 'meadow is missing from levels = deleted');
  const v = validatePlacement(out);
  assert.ok(v.ok, v.ok ? '' : v.errors.join('; '));
  // Read back: the same list and the same bytes.
  const again = new Levels();
  again.load(v.ok ? v.value : null);
  again.current = 'cave-3';
  assert.deepEqual(again.compose(file()), out);
});

test('deleting the level on screen goes to its neighbour; the last level stays', () => {
  const lv = new Levels();
  lv.fromGame(CODE, 'summit');
  assert.equal(lv.remove('summit'), 'cave', 'the last in the list: the one before it');
  lv.current = 'cave';
  assert.equal(lv.remove('cave'), 'meadow');
  lv.current = 'meadow';
  assert.equal(lv.remove('meadow'), null, 'never the last one');
});

// level-crumb (2026-10-22): "+ Level" in a game whose code has one level, and the [ / ] keys.
test('a game whose code has one level: "+ Level" makes the second one from what is on screen', () => {
  const lv = new Levels();
  lv.load(file({ rock }));
  assert.equal(lv.fromGame([{ id: 'main', label: 'Island' }], 'main', { objects: { rock } }), false, 'no crumb yet');
  assert.deepEqual(lv.single, { id: 'main', label: 'Island' });
  const id = lv.start({ objects: { rock } });
  assert.equal(id, 'island-2');
  assert.equal(lv.active, true);
  assert.equal(lv.single, null);
  assert.deepEqual(lv.list.map((e) => lv.labelOf(e.id)), ['Island', 'Island 2']);
  assert.equal(lv.build(id), 'main', 'built from the code\'s one level');
  assert.equal(lv.dirtyElsewhere(), 1, 'one change on Save');
  const out = lv.compose(file({ rock }));
  assert.deepEqual(out.levels!.map((l) => [l.id, l.from ?? null, Object.keys(l.objects || {})]), [['main', null, ['rock']], ['island-2', 'main', ['rock']]]);
  assert.deepEqual(out.levelsWas, ['main']);
  assert.ok(validatePlacement(out).ok);
  // The page that opens on the copy says the same one level: the person's list stays.
  assert.equal(lv.fromGame([{ id: 'main', label: 'Island' }], 'island-2'), true);
  assert.deepEqual(lv.list.map((e) => e.id), ['main', 'island-2']);
});

test('a game that never says its levels: "+ Level" has nothing to start from (main.ts asks the AI)', () => {
  const lv = new Levels();
  lv.load(file({ rock }));
  assert.equal(lv.single, null);
  assert.equal(lv.start({ objects: { rock } }), '');
  assert.equal(lv.active, false);
  const f = file({ rock });
  assert.equal(lv.compose(f), f);
});

test('step: the level before / after the one on screen, no wrapping round', () => {
  const lv = new Levels();
  lv.fromGame(CODE, 'meadow');
  assert.equal(lv.step(-1), '');
  assert.equal(lv.step(1), 'cave');
  lv.current = 'summit';
  assert.equal(lv.step(-1), 'cave');
  assert.equal(lv.step(1), '');
});

test('the code changes under the editor: an applied copy and a new level are taken in, the person\'s order stays', () => {
  const lv = new Levels();
  lv.fromGame(CODE, 'meadow');
  lv.copy({ objects: {} });
  lv.move('summit', -1);
  lv.markSaved();
  // The AI added "meadow-2" to the code (as the copy said) and a new level "lake".
  lv.fromGame([...CODE, { id: 'meadow-2', label: 'Meadow 2' }, { id: 'lake', label: 'Lake' }], 'meadow');
  assert.deepEqual(lv.list.map((e) => e.id), ['meadow', 'meadow-2', 'summit', 'cave', 'lake']);
  assert.equal(lv.build('meadow-2'), 'meadow-2', 'the code has it now: built as itself');
  const out = lv.compose(file());
  assert.equal(out.levels!.find((l) => l.id === 'meadow-2')!.from, undefined);
});

test('slugOf: ids that fit a key', () => {
  assert.equal(slugOf('Cave 2'), 'cave-2');
  assert.equal(slugOf('  Écho — Hall!! '), 'echo-hall');
  assert.equal(slugOf('洞窟'), 'level');
});

test('studio.levels(): the editor URL picks the level; outside the editor, null', () => {
  const list = ['meadow', { id: 'cave', label: ' Cave ' }, 'bad id', 'meadow'];
  assert.deepEqual(cleanLevels(list), [{ id: 'meadow' }, { id: 'cave', label: 'Cave' }]);
  const at = (q: string) => `http://127.0.0.1:5/index.html?studio=edit${q}`;
  assert.deepEqual(pickLevel(list, at(''), true)!.pick, { id: 'meadow', build: 'meadow' }, 'none asked: the first');
  assert.deepEqual(pickLevel(list, at('&studioLevel=cave'), true)!.pick, { id: 'cave', build: 'cave' });
  assert.deepEqual(pickLevel(list, at('&studioLevel=cave-2&studioBuild=cave'), true)!.pick, { id: 'cave-2', build: 'cave' }, 'an editor-made level');
  assert.deepEqual(pickLevel(list, at('&studioLevel=gone'), true)!.pick, { id: 'meadow', build: 'meadow' }, 'unknown: the first');
  assert.equal(pickLevel(list, at('&studioLevel=cave'), false), null, 'not in the editor frame');
  assert.equal(pickLevel([], at(''), true), null);
});

test('placement.json levels: checked like the top, errors say which level', () => {
  const ok = validatePlacement({ ...file(), levels: [{ id: 'a', objects: { rock } }, { id: 'b', from: 'a' }], levelsWas: ['a'] });
  assert.ok(ok.ok);
  const bad = validatePlacement({ ...file(), levels: [{ id: 'a', objects: { rock: { p: [1] } } }, { id: 'a' }, { id: 'c', from: 'zzz' }] });
  assert.equal(bad.ok, false);
  const errors = bad.ok ? [] : bad.errors.join('\n');
  assert.match(errors as string, /levels\[0\]\.objects\["rock"\]/);
  assert.match(errors as string, /levels\[1\]\.id: "a" is listed twice/);
  assert.match(errors as string, /levels\[2\]\.from/);
  const both = validatePlacement({ ...file({ rock }), levels: [{ id: 'a' }] });
  assert.equal(both.ok, false, 'top objects and levels at once');
  assert.equal(validatePlacement({ ...file(), levelsWas: ['a'] }).ok, false, 'levelsWas only with levels');
});

// integrate3 (2026-10-22): motion-gui's `motion` is part of a level's world — its keys are that level's objects.
test('motions are a level\'s own: kept on a switch, written into the level, checked there, applied per level', async () => {
  const boat = { path: [[3, 0, 0]], speed: 1.5, repeat: 'pingpong' as const };
  const lv = new Levels();
  lv.fromGame(CODE, 'meadow', { objects: {}, motion: { boat } });
  assert.deepEqual(lv.viewOf('meadow').motion, { boat }, 'the opened file\'s motion belongs to the level on screen');
  lv.stash({ objects: {}, motion: { boat } }, 1);
  lv.current = 'cave';
  const out = lv.compose({ ...file(), motion: { buoy: { spin: 1 } } });
  assert.equal(out.motion, undefined, 'no motion at the top next to levels');
  assert.deepEqual(out.levels!.map((l) => l.motion), [{ boat }, { buoy: { spin: 1 } }, undefined]);
  assert.ok(validatePlacement(out).ok);
  const top = validatePlacement({ ...file(), motion: { boat }, levels: [{ id: 'a' }] });
  assert.equal(top.ok, false, 'top motion and levels at once');
  const bad = validatePlacement({ ...file(), levels: [{ id: 'a', removed: [{ key: 'boat' }], motion: { boat } }] });
  assert.equal(bad.ok, false, 'a deleted object does not move, inside a level too');
  const { placementForLevel } = await import('../src/loader/studio-placement.js');
  assert.deepEqual(placementForLevel(out, 'meadow').motion, { boat });
  assert.equal(placementForLevel(out, 'summit').motion, undefined);
});

// studio-uniforms (2026-10-23): "Levels ⌄" in a game whose code has NO levels makes Level 2 here and now (a hands-on try:
// "+ Level typed into the AI box — makes no sense"; then "it just makes it without asking?? there used to be a menu").
test('a game without levels: "Make Level 2" — Level 1 is what is on screen, a copy opens; the file says the code has none (levelsWas: [])', async () => {
  const lv = new Levels();
  lv.load(file({ rock }));
  assert.equal(lv.single, null);
  const id = lv.start({ objects: { rock } }, 'レベル 1');
  assert.equal(id, 'level-2', 'a Japanese name still gets a word in its id');
  assert.equal(lv.active, true);
  assert.deepEqual(lv.list.map((e) => lv.labelOf(e.id)), ['レベル 1', 'レベル 2']);
  assert.equal(lv.list[0]!.id, 'level-1');
  assert.equal(lv.build(id), 'level-1', 'the editor builds the game as it is, Level 2\'s entries over it');
  assert.equal(lv.dirtyElsewhere(), 1, 'one press, one change on Save');
  const out = lv.compose(file({ rock }));
  assert.deepEqual(out.levelsWas, [], 'the code has no levels yet');
  assert.deepEqual(out.levels!.map((l) => [l.id, l.label, l.from ?? null, Object.keys(l.objects || {})]),
    [['level-1', 'レベル 1', null, ['rock']], ['level-2', 'レベル 2', 'level-1', ['rock']]]);
  const v = validatePlacement(out);
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  assert.deepEqual(v.ok && v.value.levelsWas, [], 'kept through the validator');
  // Read back (the editor opened again before the AI added studio.levels()): the same list, the same build.
  const again = new Levels();
  again.load(v.ok ? v.value : null);
  assert.equal(again.active, true);
  assert.deepEqual(again.code, []);
  assert.equal(again.build('level-2'), 'level-1');
  assert.deepEqual(again.compose(file()).levelsWas, []);
  // The game's loader, still called without { level }: Level 1 outside the editor (the shipped game keeps its layout).
  const { levelOfCodeless, placementForLevel } = await import('../src/loader/studio-placement.js');
  assert.equal(levelOfCodeless(out), 'level-1');
  assert.deepEqual(placementForLevel(out, levelOfCodeless(out)).objects, { rock });
  // Any other file with levels still needs { level } (a level's layout never lands on another).
  assert.equal(levelOfCodeless({ ...out, levelsWas: ['level-1'] }), '');
  assert.equal(levelOfCodeless({ ...out, levelsWas: undefined }), '');
  // A from that is not a level of the list is still an error.
  assert.equal(validatePlacement({ ...out, levels: [{ id: 'level-1' }, { id: 'level-2', from: 'nowhere' }] }).ok, false);
  // After the AI: the game says both levels; the person's list stays, the code has them now.
  assert.equal(lv.fromGame([{ id: 'level-1', label: 'レベル 1' }, { id: 'level-2', label: 'レベル 2' }], 'level-2'), true);
  assert.deepEqual(lv.code, ['level-1', 'level-2']);
  assert.equal(lv.compose(file()).levelsWas, undefined);
});

test('"Make Level 2" taken back (⌘Z / the line\'s Undo): a game with one level again, Level 1\'s layout returned', () => {
  const lv = new Levels();
  lv.load(file({ rock }));
  const id = lv.start({ objects: { rock } }, 'Level 1');
  lv.stash({ objects: { rock } }, 0);
  lv.current = id;
  const back = lv.unstart(null);
  assert.deepEqual(back, { world: { objects: { rock } } });
  assert.equal(lv.active, false);
  assert.equal(lv.dirtyElsewhere(), 0);
  const f = file({ rock });
  assert.equal(lv.compose(f), f, 'the file keeps its bytes again');
  // A game whose code has one level gets its `single` back (so "Levels ⌄" makes the copy from it again).
  const one = new Levels();
  one.fromGame([{ id: 'main' }], 'main');
  one.start({ objects: {} });
  assert.ok(one.unstart({ id: 'main' }));
  assert.deepEqual(one.single, { id: 'main' });
  // Not after the list changed: a third level, or a level of the code.
  const three = new Levels();
  three.start({ objects: {} }, 'Level 1');
  three.copy({ objects: {} });
  assert.equal(three.unstart(null), null);
  const code = new Levels();
  code.fromGame(CODE, 'meadow');
  assert.equal(code.unstart(null), null);
});
