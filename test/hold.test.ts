// What the editor holds still (a hands-on try of 2026-10-19, items 4 and 5): the 3D
// ground / road / sky found from names and sizes (adapters/three/ground.js), the objects the game moves by itself
// found by watching it play (bridge/observe.ts), how they are held (bridge/hold.ts: only what the game changes is off),
// the card's words for them, and the menu's "Make movable". The real editor on an AI-written runner is
// test/fb-safe-shots.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/hold.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Item, Pose, StudioAdapter } from '../src/contract.ts';
import { groundKeys } from '../src/adapters/three/ground.js';
import { canLift, createHoldState, holdItem, withHold } from '../src/bridge/hold.ts';
import { drivenBetween } from '../src/bridge/observe.ts';
import { LOCK_NOTE } from '../src/bridge/handles.ts';
import { heldGameText } from '../src/shell/placement-panel.ts';
import { contextRows } from '../src/shell/context-rows.ts';
import { translate } from '../src/shell/i18n.ts';

const box = (min: number[], max: number[]) => ({ min, max });
const item = (key: string, p: number[] = [0, 0, 0], extra: Partial<Item> = {}): Item => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p, r: 0, s: 1 }, ...extra });

test('groundKeys: the runner of that try — an unnamed flat road 10×300 m and a sky dome are found; pillars and the player are not', () => {
  const pillar = (i: number) => ({ key: `path:${4 + i}`, label: `path:${4 + i}`, named: false, box: box([5.4, 0, -i * 10 - 0.6], [6.6, 4.3, -i * 10 + 0.6]) });
  const list = [
    { key: 'path:0', label: 'path:0', named: false, box: box([-400, -400, -400], [400, 400, 400]) }, // sky sphere
    { key: 'path:3', label: 'path:3', named: false, box: box([-5, 0, -270], [5, 0, 30]) }, // road plane
    ...Array.from({ length: 12 }, (_, i) => pillar(i)),
    { key: 'path:16', label: 'path:16', named: false, box: box([-0.5, 0, 1.5], [0.5, 1, 2.5]) }, // player
  ];
  assert.deepEqual([...groundKeys(list)].sort(), ['path:0', 'path:3']);
});

test('groundKeys: a name\'s last word says so whatever the size (ground, main-road, 海); an unnamed key that happens to read "sky" does not count; never everything', () => {
  const small = box([0, 0, 0], [1, 1, 1]);
  const list = [
    { key: 'road', label: 'road', box: small },
    { key: 'umi', label: '海', box: small },
    { key: 'crate', label: 'crate', box: small },
    { key: 'skyline', label: 'skyline-sign', box: small },
    { key: 'sea-stack', label: 'sea-stack', box: small },
    { key: 'main-road', label: 'main-road', box: small },
    { key: 'Sky_01', label: 'Sky_01', box: small },
    { key: 'oceanFloor', label: 'oceanFloor', box: small },
    { key: 'road-sign', label: 'road-sign', box: small },
  ];
  assert.deepEqual([...groundKeys(list)].sort(), ['Sky_01', 'main-road', 'oceanFloor', 'road', 'umi'], 'the last word names it: a sea stack is a rock');
  assert.deepEqual([...groundKeys([{ key: 'sky', label: 'sky', named: false, box: small }, { key: 'b', label: 'b', box: small }])], [], 'a key is not a name');
  assert.deepEqual([...groundKeys([{ key: 'ground', label: 'ground', box: small }])], [], 'a scene of only a ground: it is the thing to place');
  assert.deepEqual([...groundKeys([{ key: 'a', label: 'a', box: small }, { key: 'b', label: 'b', box: box([0, 0, 0], [50, 0, 50]) }])], [], 'two boxes say nothing about what is typical');
});

test('drivenBetween: across the ground, height, turn and size apart; float noise and objects that came or went are left out', () => {
  const before = [item('pillar', [6, 0, -10]), item('boat', [2, 0.1, 3]), item('coin', [0, 1, 0]), item('crate', [1, 0, 1]), item('gone', [0, 0, 0])];
  const after = [
    item('pillar', [6, 0, -2.5]),
    item('boat', [2, 0.16, 3]),
    { ...item('coin', [0, 1, 0]), pose: { p: [0, 1, 0], r: 0.4, s: 1 } },
    item('crate', [1 + 1e-6, 0, 1]),
    item('new', [5, 5, 5]),
  ];
  const d = drivenBetween(before, after, '3d');
  assert.deepEqual(d.get('pillar'), { move: true, lift: false, turn: false, size: false });
  assert.deepEqual(d.get('boat'), { move: false, lift: true, turn: false, size: false }, 'a boat that bobs keeps its place');
  assert.deepEqual(d.get('coin'), { move: false, lift: false, turn: true, size: false });
  assert.equal(d.has('crate'), false, '1 µm is noise');
  assert.equal(d.has('new') || d.has('gone'), false);
  const d2 = drivenBetween([item('bird', [10, 20])], [item('bird', [14, 20])], '2d');
  assert.deepEqual(d2.get('bird'), { move: true, lift: false, turn: false, size: false });
});

test('holdItem: a 3D ground is held until freed; 2D grounds are left as they were; the game\'s own motion holds only what it changes', () => {
  const s = createHoldState();
  const road = item('road', [0, 0, 0], { backdrop: true });
  assert.deepEqual(
    (({ held, movable, liftable, rotatable, scalable }) => ({ held, movable, liftable, rotatable, scalable }))(holdItem(road, s, '3d')),
    { held: 'ground', movable: false, liftable: false, rotatable: false, scalable: false },
  );
  assert.equal(holdItem(road, s, '2d').held, undefined, '2D: draw order only, as before');
  s.freed.add('road');
  assert.equal(holdItem(road, s, '3d').held, undefined, '"Make movable"');
  s.driven.set('pillar', { move: true, lift: false, turn: false, size: false });
  const pillar = holdItem(item('pillar'), s, '3d');
  assert.equal(pillar.held, 'game');
  assert.deepEqual(pillar.driven, ['move']);
  assert.equal(pillar.movable, true, 'studio-move-plain: Move sets where it starts');
  assert.equal(pillar.startSpot, true);
  assert.equal(canLift(pillar), true, 'its height is kept: the Height tool still works');
  assert.equal(pillar.rotatable && pillar.scalable, true);
  s.driven.set('boat', { move: false, lift: true, turn: false, size: false });
  const boat = holdItem(item('boat'), s, '3d');
  assert.equal(boat.movable, true, 'a bobbing boat can still be moved across the water');
  assert.equal(canLift(boat), true, 'its start height is yours too (studio-move-plain)');
  assert.equal(canLift({ movable: false }), false, 'a locked object (game rules): no height either, as before');
});

test('withHold: drags, height steps, turns and resizes of what is held do nothing; setPose (undo, loading a save) still works', () => {
  const poses = new Map<string, Pose>([['road', { p: [0, 0, 0], r: 0, s: 1 }], ['pillar', { p: [6, 0, -10], r: 0, s: 1 }]]);
  const calls: string[] = [];
  const inner = {
    dim: '3d',
    list: () => [item('road', poses.get('road')!.p, { backdrop: true }), item('pillar', poses.get('pillar')!.p)],
    begin: () => inner.list(),
    anchor: (k: string) => ({ pose: poses.get(k)! }),
    grab: (k: string) => (calls.push(`grab ${k}`), true),
    drag: (k: string) => (calls.push(`drag ${k}`), poses.get(k)!),
    rotate: (k: string) => (calls.push(`rotate ${k}`), poses.get(k)!),
    scale: (k: string) => (calls.push(`scale ${k}`), poses.get(k)!),
    nudgeY: (k: string) => (calls.push(`nudgeY ${k}`), poses.get(k)!),
    setPose: (k: string, p: Pose) => (calls.push(`setPose ${k}`), poses.set(k, p), p),
  } as unknown as StudioAdapter;
  const s = createHoldState();
  s.driven.set('pillar', { move: true, lift: false, turn: false, size: false });
  const a = withHold(inner, s);
  a.list();
  assert.equal(a.grab('road', 0, 0), false);
  a.drag('road', 0, 0);
  a.nudgeY!('road', 16);
  a.rotate('road', 1);
  a.scale('road', 2);
  a.grab('pillar', 0, 0);
  a.nudgeY!('pillar', 1);
  a.rotate('pillar', 1);
  a.setPose('road', { p: [0, 16, 0] });
  assert.deepEqual(calls, ['grab pillar', 'nudgeY pillar', 'rotate pillar', 'setPose road'], 'the pillar\'s start spot can be dragged (studio-move-plain)');
  s.freed.add('road');
  a.list();
  a.nudgeY!('road', 1);
  assert.equal(calls.at(-1), 'nudgeY road', 'made movable: the tools work again');
});

test('the card\'s words: the tester\'s own sentence when the game moves it, then what can still be changed', () => {
  const ja = (k: string, v?: Record<string, string | number>) => translate('ja', k, v);
  const en = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
  const pillar = { driven: ['move' as const], movable: false, rotatable: true, scalable: true };
  assert.equal(heldGameText(pillar, '3d', ja), 'この物は遊ぶとゲームが動かします。決められるのはスタート位置だけです。高さ・向き・大きさは変えられます。');
  assert.equal(heldGameText(pillar, '3d', en), 'Your game moves this while playing. You choose only where it starts. You can still change its height, angle, and size.');
  assert.equal(heldGameText({ driven: ['lift'], movable: true, rotatable: true, scalable: true }, '3d', ja), 'この物の高さはゲームが変えます（ここで変えても残りません）。位置・向き・大きさは変えられます。');
  assert.equal(heldGameText({ driven: ['move', 'turn', 'size'], movable: false, rotatable: false, scalable: false }, '2d', en), 'Your game moves this while playing. You choose only where it starts.');
});

// studio-card-doors (2026-10-23): the one way to free a locked road is the "Unlock" in the line under the strip
// (bridge/handles.ts LOCK_NOTE); the menu (and the card) no longer list it.
test('the menu has no "Unlock" for a held ground; the line under the strip has it', () => {
  const base = { dim: '3d' as const, offline: false, editing: true, picked: 1, movable: 0, unnamed: 1, anyPicked: true, items: 15, clip: 0, canUndo: false, canRedo: false };
  const ids = (held?: number, editing = true) => contextRows('object', { ...base, held, editing }).map((r) => ('sep' in r ? '—' : r.id));
  assert.ok(!ids(1).includes('unhold') && !ids(0).includes('unhold'));
  assert.equal(translate('ja', 'hold.free'), '動かせるようにする');
  assert.equal(LOCK_NOTE.ja.unlock, translate('ja', 'hold.free'));
  assert.equal(LOCK_NOTE.en.unlock, translate('en', 'hold.free'));
});

// merge of 2026-10-19: Drop to floor (End, snap to surfaces) arrived next to the hold layer. It changes the height, so
// it follows the Height tool: a held road is not dropped, a pillar the game slides along the road still is.
test('withHold: Drop to floor follows the Height tool — a held ground stays, a game-moved pillar drops, a freed ground drops', () => {
  const poses = new Map<string, Pose>([['road', { p: [0, 16, 0], r: 0, s: 1 }], ['pillar', { p: [6, 3, -10], r: 0, s: 1 }]]);
  const calls: string[] = [];
  const inner = {
    dim: '3d',
    list: () => [item('road', poses.get('road')!.p, { backdrop: true }), item('pillar', poses.get('pillar')!.p)],
    begin: () => inner.list(),
    anchor: (k: string) => ({ pose: poses.get(k)! }),
    drop: (k: string) => (calls.push(`drop ${k}`), poses.get(k)!),
  } as unknown as StudioAdapter;
  const s = createHoldState();
  s.driven.set('pillar', { move: true, lift: false, turn: false, size: false });
  const a = withHold(inner, s);
  a.list();
  assert.deepEqual(a.drop!('road', ['road']), poses.get('road'), 'held: the pose stays');
  a.drop!('pillar', ['pillar']);
  assert.deepEqual(calls, ['drop pillar']);
  s.freed.add('road');
  a.list();
  a.drop!('road', ['road']);
  assert.equal(calls.at(-1), 'drop road');
  assert.equal(withHold({ ...inner, drop: undefined } as unknown as StudioAdapter, s).drop, undefined, 'no drop in the game: none here either');
});

// e2e-016 (2026-10-20): the copy of a pillar the game slides along the road was free to place; the AI then added it
// to the pillars and the game moved it every frame.
test('a copy of what the game moves is held like its original', () => {
  const s = createHoldState();
  s.driven.set('pillar-2', { move: true, lift: false, turn: false, size: false });
  const copy = holdItem(item('pillar-9', [3, 0, -40], { copyOf: 'pillar-2', movable: true, liftable: true }), s, '3d');
  assert.equal(copy.held, 'game');
  assert.deepEqual(copy.driven, ['move']);
  assert.equal(copy.movable, true, 'its start spot is yours, as its original\'s (studio-move-plain)');
  assert.equal(copy.startSpot, true);
  assert.equal(copy.scalable, true, 'its size is still yours');
  assert.equal(holdItem(item('barrel-2', [0, 0, 0], { copyOf: 'barrel' }), s, '3d').held, undefined, 'a copy of a still object is free');
});
