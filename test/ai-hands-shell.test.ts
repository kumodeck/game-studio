// The editor's end of the AI's hands (studio-ai-hands, 2026-10-24; shell/ai-hands.ts, undo.ts begin / end), without a
// browser: a job of several ops is ONE undo step with the AI's words, ops run in order and one at a time, a wrong name
// changes nothing and says why, and the line names the AI that asked.
//   node --experimental-strip-types --no-warnings --test test/ai-hands-shell.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiHands, type HandsDeps } from '../src/shell/ai-hands.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { translate } from '../src/shell/i18n.ts';
import type { Item, LibraryMotion, Motion, Pose } from '../src/contract.ts';

test('UndoStack.begin / end: every push in between is one entry; nothing pushed = no entry', () => {
  const u = new UndoStack();
  u.push({ changes: [{ kind: 'pose', key: 'a', from: { p: [0, 0, 0] }, to: { p: [1, 0, 0] } }] });
  u.begin();
  u.push({ changes: [{ kind: 'motion', key: 'b', from: { clips: [] }, to: null }] });
  u.push({ changes: [{ kind: 'pose', key: 'c', from: { p: [0, 0, 0] }, to: { p: [0, 2, 0] } }] });
  const e = u.end('Claude took “Row” off b');
  assert.equal(u.size, 2);
  assert.deepEqual(e?.changes.map((c) => c.key), ['b', 'c']);
  assert.equal(u.peekUndo()?.ai, 'Claude took “Row” off b');
  u.begin();
  assert.equal(u.end('nothing'), null);
  assert.equal(u.size, 2);
});

/** A small editor: two pillars, Row on both; the stand-ins record what was called. */
function editor() {
  const undo = new UndoStack();
  const calls: string[] = [];
  const lib = new Map<string, LibraryMotion>([['Row', { name: 'Row', len: 2, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [1, 0, 0] }] } }]]);
  const motion = new Map<string, Motion | null>([['pillar-1', { clips: [{ name: 'Row', use: 'Row', len: 2, keys: {} }] }], ['pillar-6', { clips: [{ name: 'Row', use: 'Row', len: 2, keys: {} }] }]]);
  const poses = new Map<string, Pose>([['pillar-1', { p: [0, 0, 0], r: 0, s: 1 }], ['pillar-6', { p: [5, 0, 0], r: 0, s: 1 }]]);
  const items: Item[] = ['pillar-1', 'pillar-6'].map((key) => ({ key, label: key === 'pillar-1' ? 'Blue pillar' : 'Blue pillar 6', kinds: ['mesh'], rotatable: true, scalable: true }));
  let lines: string[] = [];
  const d: HandsDeps = {
    t: (k, v) => translate('en', k, v),
    ready: () => true,
    playing: () => false,
    stopPlay: async () => undefined,
    toWorld: () => undefined,
    dim: () => '3d',
    item: (k) => items.find((i) => i.key === k),
    label: (k) => items.find((i) => i.key === k)?.label ?? k,
    keys: () => items.map((i) => i.key),
    pose: (k) => poses.get(k),
    setPose: (k, p) => {
      undo.push({ changes: [{ kind: 'pose', key: k, from: poses.get(k)!, to: p }] });
      poses.set(k, p);
    },
    rename: () => true,
    duplicate: async () => null,
    remove: () => undefined,
    ground: async () => false,
    motionOf: (k) => motion.get(k) ?? null,
    rawClips: (k) => motion.get(k)?.clips ?? [],
    lib: (n) => lib.get(n) ?? null,
    libNames: () => [...lib.keys()],
    usage: (n) => [...motion.values()].filter((m) => m?.clips?.some((c) => c.use === n)).length,
    attach: (k, n) => {
      calls.push(`attach ${k} ${n}`);
      const m = motion.get(k);
      motion.set(k, { clips: [...(m?.clips ?? []), { name: n, use: n, len: 1, keys: {} }] });
      undo.push({ changes: [{ kind: 'motion', key: k, from: m ?? null, to: motion.get(k)! }] });
      return true;
    },
    detach: (k, c) => {
      calls.push(`detach ${k} ${c}`);
      const m = motion.get(k)!;
      const rest = m.clips!.filter((x) => x.name !== c);
      motion.set(k, rest.length ? { clips: rest } : null);
      undo.push({ changes: [{ kind: 'motion', key: k, from: m, to: motion.get(k) ?? null }] });
    },
    deleteLib: () => undefined,
    renameLib: () => null,
    make: (k, m) => {
      calls.push(`make ${k} ${m.name} ${m.keys.p?.length}`);
      lib.set(m.name, m);
      undo.push({ changes: [{ kind: 'motion-lib', key: m.name, from: null, to: m }] });
      if (k) d.attach(k, m.name);
      return { name: m.name, when: { on: 'start' } };
    },
    clipSet: () => true,
    libSet: () => true,
    levels: { active: () => false, current: () => '', ids: () => [], label: () => '', add: async () => null, go: async () => false, rename: () => false, nameNew: () => false },
    save: async () => true,
    reload: () => undefined,
    undoBegin: () => undo.begin(),
    undoEnd: (w) => !!undo.end(w),
    done: (w, can) => void lines.push(can ? w : `${w} (no undo)`),
  };
  return { d, undo, calls, motion, poses, lines: () => lines, clear: () => (lines = []) };
}

test('a job: take Row off, make a spiral from points, put it on — one ⌘Z, the AI\'s words, the results the CLI prints', async () => {
  const e = editor();
  const hands = createAiHands(e.d);
  const pts = Array.from({ length: 9 }, (_, i) => [Math.cos(i), i / 4, Math.sin(i)].map((x) => Math.round(x * 1000) / 1000));
  const r = await hands.run({ id: '1', by: 'claude', ops: [{ do: 'motion.detach', key: 'pillar-1', name: 'Row' }, { do: 'motion.make', name: 'Spiral', len: 4, repeat: 'loop', points: pts, key: 'pillar-1' }] });
  assert.deepEqual(r.results.map((x) => [x.ok, x.said]), [[true, 'took "Row" off pillar-1'], [true, 'made "Spiral" (9 points, 4 s, loop) and put it on pillar-1, starts with the game']]);
  assert.deepEqual(e.calls, ['detach pillar-1 Row', 'make pillar-1 Spiral 9', 'attach pillar-1 Spiral']);
  assert.equal(e.undo.size, 1, 'one undo step for the whole job');
  // The line leads with what was asked for (the motion made), names the AI, and counts the rest.
  assert.deepEqual(e.lines(), ['Claude made “Spiral” and put it on Blue pillar, and 1 more change']);
  assert.equal(e.undo.peekUndo()?.ai, 'Claude made “Spiral” and put it on Blue pillar, and 1 more change');
});

test('a wrong name, a missing object: nothing changes, the answer says what is there', async () => {
  const e = editor();
  const hands = createAiHands(e.d);
  const r = await hands.run({ id: '2', ops: [{ do: 'motion.detach', key: 'pillar-1', name: 'Hop' }, { do: 'object.move', key: 'pillar-9', to: [0, 0, 0] }] });
  assert.deepEqual(r.results.map((x) => x.error), ['pillar-1 has no motion "Hop" (its motions: "Row")', 'no object pillar-9 in the editor (objects: pillar-1, pillar-6)']);
  assert.equal(e.undo.size, 0);
  assert.deepEqual(e.lines(), []);
});

test('jobs run one at a time, in order; a move by an amount starts from where it stands', async () => {
  const e = editor();
  const hands = createAiHands(e.d);
  const a = hands.run({ id: 'a', ops: [{ do: 'object.move', key: 'pillar-6', by: [1, 0, 0] }] });
  const b = hands.run({ id: 'b', ops: [{ do: 'object.move', key: 'pillar-6', by: [1, 0, 0] }] });
  await Promise.all([a, b]);
  assert.deepEqual(e.poses.get('pillar-6')!.p, [7, 0, 0]);
  assert.equal(e.undo.size, 2, 'two jobs, two steps');
  // No `by`: "your AI" (the editor's own guess of the name).
  assert.equal(e.lines()[0], 'Your AI moved Blue pillar 6');
});

// Code motions and code layouts (studio-code-base, 2026-10-24): the editor's end of motion.code / place.* / list.
import { PlaceStore } from '../src/shell/code-places.ts';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { roundLib } from '../src/shell/motion-model.ts';
import type { CodeMotionInfo, CodePlaceInfo, PlacementPlace } from '../src/contract.ts';

const HEX: CodePlaceInfo = { id: 'hex', name: '六角形の列', keys: ['hex-1', 'hex-2', 'hex-3', 'hex-4'], skipped: [], drag: 'gap', avoid: ['road'],
  knobs: { n: { v: 4, label: '個数', unit: '', step: 1 }, gap: { v: 6, label: '間', unit: 'm', min: 2, max: 12 } } };
const SPIRAL: CodeMotionInfo = { code: 'spiral', name: '螺旋', round: 8, knobs: { radius: { v: 2, label: '半径', unit: 'm' }, turn: { v: 4, label: '1 周', unit: 's' } } };

/** The small editor above, with the game's code lists (empty until the "game" is read again) and a layout store. */
function codeEditor(o: { listed?: boolean } = {}) {
  const e = editor();
  const store = new PlaceStore();
  let listed = o.listed ?? true;
  let reloads = 0;
  const libSets: unknown[] = [];
  const clipSets: unknown[] = [];
  Object.assign(e.d, {
    t: (k: string, v?: Record<string, string | number>) => translate('ja', k, v),
    codeMotions: () => (listed ? [SPIRAL] : []),
    codePlaces: () => (listed ? [HEX] : []),
    codeAvoids: () => (listed ? [{ code: 'road', name: '道の上', knobs: {} }, { code: 'near-player', name: 'プレイヤーから', after: '以内', knobs: { r: { v: 5, label: '距離', unit: 'm' } } }] : []),
    reloadGame: async () => {
      reloads++;
      listed = true;
      return true;
    },
    place: (id: string) => store.get(id),
    placeIds: () => store.ids(),
    setPlace: (id: string, p: PlacementPlace | null) => {
      const from = store.get(id);
      store.set(id, p);
      e.undo.push({ changes: [{ kind: 'code-place', key: id, from, to: store.get(id) }] });
    },
    libSet: (n: string, x: unknown) => (libSets.push([n, x]), true),
    clipSet: (k: string, c: string, x: unknown) => (clipSets.push([k, c, x]), true),
    list: () => ({ from: 'the editor', objects: [], motions: [{ name: 'Row', len: 2, repeat: 'once', on: [] }] }),
  } satisfies Partial<HandsDeps>);
  return { ...e, store, reloads: () => reloads, libSets, clipSets };
}

test('place.code: a game page without the layout yet is read again first; one it never has is a loud answer', async () => {
  const e = codeEditor({ listed: false });
  const hands = createAiHands(e.d);
  const r = await hands.run({ id: '1', by: 'claude', ops: [{ do: 'place.code', id: 'hex' }] });
  assert.equal(e.reloads(), 1, 'read again once, without asking the person');
  assert.deepEqual(r.results.map((x) => [x.ok, x.said]), [[true, 'showed codePlace(\'hex\') (4 objects) in the editor — nothing to write: the code places it']]);
  assert.deepEqual(e.lines(), ['Claude がルール「六角形の列」を出しました（4 個 · 個数 4, 間 6 m） (no undo)']);
  const r2 = await hands.run({ id: '2', ops: [{ do: 'place.code', id: 'lamp' }] });
  assert.equal(r2.results[0]!.error, "the game has no codePlace('lamp') (it has: 'hex')");
});

test('place.set knobs / pin, place.avoid — one ⌘Z for the job; a knob back on the code\'s number leaves the file', async () => {
  const e = codeEditor();
  const hands = createAiHands(e.d);
  const r = await hands.run({ id: '1', by: 'claude', ops: [
    { do: 'place.set', id: 'hex', knobs: { gap: 4 } },
    { do: 'place.set', id: 'hex', pin: { key: 'hex-3', p: [-3.1, 0.95, -19] } },
    { do: 'place.avoid', id: 'hex', code: 'near-player', knobs: { r: 6 } },
    { do: 'place.avoid', id: 'hex', box: { p: [-8, 0, -17], size: [3, 2, 5] } },
    { do: 'place.avoid', id: 'hex', code: 'road', off: true },
  ] });
  assert.ok(r.results.every((x) => x.ok), JSON.stringify(r.results));
  assert.deepEqual(e.store.get('hex'), {
    knobs: { gap: { v: 4, was: 6 } }, pins: { 'hex-3': { p: [-3.1, 0.95, -19] } },
    avoid: [{ code: 'near-player', knobs: { r: { v: 6, was: 5 } } }, { box: { p: [-8, 0, -17], size: [3, 2, 5] }, name: '四角 1' }, { code: 'road', off: true }],
  });
  assert.equal(e.undo.size, 1);
  assert.equal(e.lines()[0], 'Claude が「六角形の列」を変えました: 間 4 m（ほか 4 件）');
  // Back on the code's numbers, the road on again (it is the code's own condition): nothing left but the rest.
  await hands.run({ id: '2', ops: [{ do: 'place.set', id: 'hex', knobs: { gap: 6 } }, { do: 'place.avoid', id: 'hex', code: 'road', off: false }, { do: 'place.avoid', id: 'hex', remove: 0 }, { do: 'place.avoid', id: 'hex', remove: 0 }, { do: 'place.set', id: 'hex', unpin: 'hex-3' }] });
  assert.equal(e.store.get('hex'), null);
  // Loud answers: a knob the code does not have, an object that is not the layout's.
  const bad = await hands.run({ id: '3', ops: [{ do: 'place.set', id: 'hex', knobs: { size: 2 } }, { do: 'place.set', id: 'hex', pin: { key: 'pillar-1', p: [0, 0, 0] } }, { do: 'place.avoid', id: 'hex', code: 'lane' }] });
  assert.deepEqual(bad.results.map((x) => x.error), [
    `codePlace('hex') has no knob "size" (its knobs: n, gap)`,
    `"pillar-1" is not one of codePlace('hex')'s objects (hex-1, hex-2, hex-3, hex-4)`,
    `the game has no codeAvoid('lane') (it has: 'road', 'near-player')`,
  ]);
});

test('place.set --unpin "*": every one placed by hand back on the rule in one ⌘Z (the card\'s "All back to rule")', async () => {
  const e = codeEditor();
  const hands = createAiHands(e.d);
  await hands.run({ id: '1', ops: [
    { do: 'place.set', id: 'hex', knobs: { gap: 4 } },
    { do: 'place.set', id: 'hex', pin: { key: 'hex-2', p: [1, 0.95, -9] } },
    { do: 'place.set', id: 'hex', pin: { key: 'hex-3', p: [-3.1, 0.95, -19] } },
  ] });
  const before = e.undo.size;
  const r = await hands.run({ id: '2', by: 'claude', ops: [{ do: 'place.set', id: 'hex', unpin: '*' }] });
  assert.ok(r.results[0]!.ok, JSON.stringify(r.results));
  assert.deepEqual(e.store.get('hex'), { knobs: { gap: { v: 4, was: 6 } } }, 'the pins gone, the knob kept');
  assert.equal(e.undo.size, before + 1, 'one ⌘Z');
  assert.equal(e.lines().at(-1), 'Claude が「六角形の列」を変えました: 手で置いた物 2 個を元の位置に戻す');
  // Nothing placed by hand any more: a loud answer, nothing changed.
  const again = await hands.run({ id: '3', ops: [{ do: 'place.set', id: 'hex', unpin: '*' }] });
  assert.equal(again.results[0]!.error, `codePlace('hex') has nothing placed by hand (every object follows the code already)`);
  assert.equal(e.undo.size, before + 1);
});

test('motion.code: the Library gets { name, code } (one motion per code), on the object starting with the game; motion.set knobs / off', async () => {
  const e = codeEditor();
  const made: LibraryMotion[] = [];
  const make = e.d.make;
  e.d.make = (k, m, o) => (made.push(m), make(k, m, o));
  const hands = createAiHands(e.d);
  const r = await hands.run({ id: '1', by: 'claude', ops: [{ do: 'motion.code', code: 'spiral', name: '螺旋', key: 'pillar-1' }] });
  assert.ok(r.results[0]!.ok, r.results[0]!.error);
  assert.deepEqual(made[0], { name: '螺旋', len: 8, keys: {}, code: 'spiral' }, 'the strip is one round wide (8 s)');
  assert.equal(r.results[0]!.said, 'put the code motion "螺旋" (codeMotion(\'spiral\')) on pillar-1, starts with the game');
  assert.equal(e.lines()[0], 'Claude が Blue pillar に動きのルール「螺旋」を付けました');
  // The same code on another object: the same motion, attached (not a second motion with a "2" after its name).
  await hands.run({ id: '2', ops: [{ do: 'motion.code', code: 'spiral', name: 'Spiral', key: 'pillar-6' }] });
  assert.equal(made.length, 1);
  assert.ok(e.calls.includes('attach pillar-6 螺旋'));
  // Knobs: { v, was = the code's }; a code it does not have says which it has.
  const k = await hands.run({ id: '3', ops: [{ do: 'motion.set', name: '螺旋', knobs: { radius: 3 } }, { do: 'motion.set', name: '螺旋', key: 'pillar-1', off: true }, { do: 'motion.code', code: 'wave', name: '波' }] });
  assert.deepEqual(e.libSets[0], ['螺旋', { knobs: { radius: { v: 3, was: 2 } } }]);
  assert.deepEqual(e.clipSets.at(-1), ['pillar-1', '螺旋', { when: undefined, until: undefined, off: true }]);
  assert.equal(k.results[2]!.error, "the game has no codeMotion('wave') (it has: 'spiral')");
  assert.match(e.lines().at(-1)!, /「螺旋」を 半径 3 m にしました（ほか 1 件）/);
  // list: the code motion with its knobs, the layout with its objects and keep-out areas.
  const l = (await hands.run({ id: '4', ops: [{ do: 'list' }] })).results[0]!.list as { places: Array<{ id: string; keys: string[]; avoid: unknown[] }> };
  assert.equal(l.places[0]!.id, 'hex');
  assert.deepEqual(l.places[0]!.avoid, [{ code: 'road', name: '道の上', knobs: {} }]);
});

test('the shell keeps code motions and places through a save: a file with them, the same bytes again', () => {
  const lib = new MotionLibrary();
  lib.restore({ motions: [{ name: '螺旋', code: 'spiral', knobs: { radius: { v: 3, was: 2 } } } as unknown as LibraryMotion] });
  assert.equal(lib.get('螺旋')!.len, 4, 'the strip\'s width before the game page said its round');
  assert.deepEqual(lib.result((m) => roundLib(m)), [{ name: '螺旋', code: 'spiral', knobs: { radius: { v: 3, was: 2 } } }]);
  assert.deepEqual(lib.changedNames(), []);
  // The AI wrote 3 into the code: the knob leaves the file, and it is not a change of the person's.
  assert.equal(lib.settle([{ ...SPIRAL, knobs: { ...SPIRAL.knobs, radius: { v: 3, label: '半径', unit: 'm' } } }]), true);
  assert.deepEqual(lib.result((m) => roundLib(m)), [{ name: '螺旋', code: 'spiral' }]);
  assert.deepEqual(lib.changedNames(), []);
  assert.equal(lib.get('螺旋')!.len, 8, 'one round wide now');
  const st = new PlaceStore();
  st.restore({ hex: { knobs: { gap: { v: 4, was: 6 } } }, crystal: { avoid: [{ code: 'road', off: true }] } });
  assert.deepEqual(st.changedIds(), []);
  assert.equal(st.settle([{ ...HEX, knobs: { ...HEX.knobs, gap: { v: 4, label: '間', unit: 'm' } } }]), true);
  assert.deepEqual(st.result(), { crystal: { avoid: [{ code: 'road', off: true }] } });
  assert.deepEqual(st.changedIds(), []);
});

// studio-fix-0168 (2026-10-26; the x clips' "found 2"): after Save, the AI sends [ui.code, ui.set --clear] in one job
// (SKILL.md). The editor's line led with ui.code ("Claude made Distance movable in the editor…, and 1 more change"), so
// what was done — the place written into the game — hid in "1 more change". After a Save the writing leads.
test('ui.code + ui.set --clear in one job: the line leads with "wrote it into the game"', async () => {
  const e = editor();
  const ui: Item[] = [{ key: 'distance', label: 'Distance', kinds: ['ui'] }];
  let had = true;
  e.d.reloadGame = async () => true;
  e.d.ui = {
    show: () => true,
    items: () => ui,
    codes: () => [{ key: 'distance', name: 'Distance' }] as never,
    clash: () => [],
    resetCodes: () => undefined,
    pose: () => ({ p: [0, 0, 0] }),
    setPose: () => undefined,
    setLook: () => undefined,
    check: async (keys) => keys.map((key) => ({ key, ok: true })),
    clear: () => (had ? ((had = false), true) : false),
    entries: () => ({}),
  };
  const hands = createAiHands(e.d);
  await hands.run({ id: 'w', by: 'claude', ops: [{ do: 'ui.code', id: 'distance' }, { do: 'ui.set', id: 'distance', clear: true }] });
  assert.equal(e.lines().length, 1);
  assert.match(e.lines()[0]!, /^Claude wrote Distance into the game, and 1 more change/);
  // ui.code alone (no writing yet): its own words, as before.
  e.clear();
  await hands.run({ id: 'c', by: 'claude', ops: [{ do: 'ui.code', id: 'distance' }] });
  assert.match(e.lines()[0]!, /^Claude made Distance movable in the editor/);
});
