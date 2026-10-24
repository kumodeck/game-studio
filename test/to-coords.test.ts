// studio-to-coords (2026-10-24): "a rule's thing should stay a rule however it is moved; to make it your own shape, a
// button converts the rule to coordinates" (a request that day), and the CRYSTAL FIELD try of that day — a lamp of a rule row
// dragged away from the road did nothing and said nothing, and lifted it silently left the row (a pin, no ⌥).
//   - `drag` by way: { along, side, up, turn, size }; a string is Move's (along) as before
//   - the game page's measures: how far the rule is from where the drag asked (Move on the ground, Height, Turn, Size),
//     whether it followed, and which way a Move it did not follow went (along the row / away from it)
//   - the shell: only ⌥ (`alone`) makes a pin, told with "Reset to rule"; anything else goes back with why and ✦; a
//     group keeps a rule's objects; key steps leave them; the list and the card mark one put by hand
//   - the words: "Convert to coordinates" for both, the motion's points relative (offsets from where the object stands)
//
//   node --experimental-strip-types --test test/to-coords.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlacement, codeMotion, codePlace, codePose } from '../src/loader/studio-placement.js';
import { dragKnobs, dragKnob, toolKnobs, poseGap, poseAsk, ruleLags, moveWay, heldChip, findBy, placeNote } from '../src/bridge/code-place.ts';
import { ruleAt } from '../src/bridge/code-motion.ts';
import { createCodePlaceWire } from '../src/shell/code-place-wire.ts';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { translate } from '../src/shell/i18n.ts';
import type { CodePlaceInfo, Item, PlacementPlace } from '../src/contract.ts';

const KNOBS = { gap: { v: 8, label: 'Gap', unit: 'm' }, side: { v: 4.8, label: 'From the road', unit: 'm' }, h: { v: 0, label: 'Height', unit: 'm' } };

test('drag by way: a name is Move\'s (along); an object names a knob per way; only knobs the layout has', () => {
  assert.deepEqual(dragKnobs({ drag: 'gap', knobs: KNOBS }), { along: 'gap' });
  assert.deepEqual(dragKnobs({ drag: { move: 'gap' }, knobs: KNOBS }), { along: 'gap' }, 'the first step\'s { move } is along');
  assert.deepEqual(dragKnobs({ drag: { along: 'gap', side: 'side', up: 'h', turn: 'nope' }, knobs: KNOBS }), { along: 'gap', side: 'side', up: 'h' });
  assert.deepEqual(toolKnobs({ drag: { along: 'gap', side: 'side', up: 'h' }, knobs: KNOBS }, 'move'), ['gap', 'side'], 'Move turns along and side together');
  assert.deepEqual(toolKnobs({ drag: { along: 'gap', side: 'side', up: 'h' }, knobs: KNOBS }, 'lift'), ['h']);
  assert.deepEqual(toolKnobs({ drag: 'gap', knobs: KNOBS }, 'rotate'), [], 'no knob to turn: the rule keeps its angle');
  assert.equal(dragKnob({ drag: { side: 'side' }, knobs: KNOBS }), 'side');
  assert.equal(dragKnob({ knobs: KNOBS }), null);
});

test('the measures: Move on the ground, Height up, Turn in radians, Size as a ratio; the rule followed or not', () => {
  assert.equal(poseGap('move', { p: [0, 5, 0] }, { p: [3, 0, 4] }), 5, 'Move: the ground only (a height is not a miss)');
  assert.equal(poseGap('move', { p: [0, 0] }, { p: [3, 4] }), 5, '2D: x and y');
  assert.equal(poseGap('lift', { p: [9, 1, 9] }, { p: [0, 3.5, 0] }), 2.5);
  assert.ok(Math.abs(poseGap('rotate', { p: [0, 0, 0], r: Math.PI - 0.1 }, { p: [0, 0, 0], r: -Math.PI + 0.1 }) - 0.2) < 1e-9, 'Turn: the short way round');
  assert.ok(Math.abs(poseGap('scale', { p: [0, 0, 0], s: 2 }, { p: [0, 0, 0], s: 1 }) - Math.log(2)) < 1e-9);
  assert.ok(Math.abs(poseGap('scale', { p: [0, 0, 0] }, { p: [0, 0, 0], s: [2, 2, 2] }) - Math.log(2)) < 1e-9, 'a rule without a size: 1');
  assert.equal(poseAsk('lift', { p: [0, 0, 0] }, { p: [0, 2, 0] }), 2);
  // Move / Height: on screen. 30 px left of 40 asked = it did not follow; 20 px of 400 = a wobble.
  assert.equal(ruleLags('move', 0, 0, { left: 30, asked: 40 }), true);
  assert.equal(ruleLags('move', 0, 0, { left: 20, asked: 400 }), false);
  assert.equal(ruleLags('move', 0, 0, { left: 60, asked: 400 }), false, 'most of the drag followed');
  assert.equal(ruleLags('rotate', 0.5, 0.6), true, 'Turn: 29° left of 34° asked');
  assert.equal(ruleLags('rotate', 0.1, 1.2), false, '6°: a wobble');
  assert.equal(ruleLags('scale', Math.log(1.5), Math.log(1.6)), true);
});

test('which way a Move the rule did not follow went: along a row, or away from it; anything else is "this way"', () => {
  // A row along -z (a road's lamps): number 1's neighbours at z = 0 and -16.
  const spots = [[4.8, 0, 0], [4.8, 0, -8], [4.8, 0, -16]];
  assert.equal(moveWay(spots, 1, [2, 0, 0.3], true), 'side', 'off to the side of the road');
  assert.equal(moveWay(spots, 1, [0.2, 0, -3], true), 'along');
  assert.equal(moveWay(spots, 0, [2, 0, 0], true), 'side', 'the first one: its neighbour after it');
  assert.equal(moveWay(spots, 1, [2, 0, 0], false), 'move', 'not a row: no along / side');
  assert.equal(heldChip('ja', 'side', false), '横の位置はルールで決まっています · ⌥ でこの 1 個だけ');
  assert.equal(heldChip('en', 'up', true), 'Height is set by the rule', 'a finger: no ⌥');
  assert.equal(placeNote('en', 'Street lamps', 12, ['Gap', 'From the road'], { narrow: false, touch: false }), 'Street lamps ×12 (rule): Drag to adjust Gap, From the road · ⌥-drag to move one');
});

test('the look-up for two knobs: along then side brings a lamp to where the finger is (the drag\'s coordinate search)', () => {
  // The rule of the CRYSTAL FIELD lamps, with "From the road" a knob (what SKILL.md now asks the AI for).
  const at = (i: number, k: Record<string, number>) => [k.side!, 0, -6 - i * k.gap!];
  const want = [6.5, 0, -6 - 2 * 5];
  const k = { gap: 8, side: 4.8 };
  for (let round = 0; round < 3; round++) for (const n of ['gap', 'side'] as const) {
    const v = findBy((x) => poseGap('move', { p: at(2, { ...k, [n]: x }) }, { p: want }), 0, 30);
    if (v !== null) k[n] = v;
  }
  assert.ok(Math.abs(k.gap - 5) < 1e-3 && Math.abs(k.side - 6.5) < 1e-3, `gap 5, side 6.5 (${JSON.stringify(k)})`);
});

test('the loader\'s whole formula pose for a drag: place, the turn round the up axis, the tilt, the size', async () => {
  globalThis[Symbol.for('game-studio.codePlaces') as unknown as keyof typeof globalThis] = undefined as never;
  const objs: Array<Record<string, unknown>> = [];
  const root = { isObject3D: true, children: [] as unknown[], add(o: { parent?: unknown }) { o.parent = root; this.children.push(o); }, remove() {}, traverse() {} };
  const obj = () => {
    const o = { isObject3D: true, name: '', userData: {}, children: [], visible: true,
      position: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); } },
      rotation: { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); } },
      scale: { x: 1, y: 1, z: 1, set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); }, setScalar(v: number) { Object.assign(this, { x: v, y: v, z: v }); } } };
    objs.push(o);
    return o;
  };
  codePlace('posts', { name: 'Posts', knobs: { h: { v: 1, label: 'Height', unit: 'm' } }, count: 2, make: obj, at: (i: number, k: Record<string, number>) => ({ p: [i, k.h, 0], r: [0.1, 0.5 * i, 0.2], s: 2 }) });
  await applyPlacement(root as never, {} as never);
  assert.deepEqual(codePose('posts', 1, { h: 3 }), { p: [1, 3, 0], r: 0.5, t: [0.1, 0.2], s: 2 });
  assert.equal(codePose('nope', 0, {}), null);
});

/** The shell's end of a lamp row, with what it tells (and the pressable words after it). */
function shell() {
  const model = new PlacementModel();
  const undo = new UndoStack();
  const sent: Array<{ type: string; ids?: string[] }> = [];
  const told: Array<{ text: string; acts: string[]; undo: boolean; hand?: boolean; run: Array<() => void> }> = [];
  const asked: string[] = [];
  const info: CodePlaceInfo = { id: 'lamp-row', name: 'Street lamps', keys: ['lamp-row-1', 'lamp-row-2', 'lamp-row-3'], skipped: [], knobs: { gap: { v: 8, label: 'Gap', unit: 'm' } }, drag: 'gap', avoid: [], kind: 'line' };
  const items: Item[] = info.keys.map((k, i) => ({ key: k, label: `Street lamps ${i + 1}`, kinds: ['mesh'], pose: { p: [4.8, 0, -6 - 8 * i] }, movable: true, rotatable: true, scalable: true } as unknown as Item));
  items.push({ key: 'crate', label: 'crate', kinds: ['mesh'], pose: { p: [0, 0, 0] }, movable: true, rotatable: true, scalable: true } as unknown as Item);
  model.restore(null);
  model.setItems(items, '3d');
  const commit = (id: string, from: PlacementPlace | null, to: PlacementPlace | null) => {
    model.places.set(id, to);
    undo.push({ changes: [{ kind: 'code-place', key: id, from, to: model.places.get(id) }] });
  };
  const w = createCodePlaceWire({
    t: (k, v) => translate('en', k, { ai: 'Claude', ...v }), list: () => [info], store: () => model.places, codePoses: (p) => model.codePoses(p), pose: (k) => model.pose(k), dim: () => '3d',
    send: (m) => sent.push(m as never), commit, changed: () => {}, selected: () => 'lamp-row-3', group: () => [], editing: () => true,
    // studio-offsets: the four choices swap the last step's end (main.ts does the same with undo.ts retarget).
    retarget: (id, to) => {
      if (!undo.retarget(id, to)) return false;
      model.places.set(id, to);
      return true;
    },
    told: (text, actions, u = true, hand = false) => told.push({ text, acts: (actions ?? []).map((a) => a.label), undo: u, hand, run: (actions ?? []).map((a) => () => a.run()) }),
    name: (k) => items.find((i) => i.key === k)?.label ?? k, ask: (draft) => asked.push(draft),
  });
  return { model, undo, w, sent, told, asked };
}

test('the shell: without ⌥ a rule\'s object never leaves its rule — a key step moves the whole rule (an offset), ✦ asks for the knob', () => {
  // studio-offsets (2026-10-24): to coords put a lifted lamp back and said why; the answer asked for that day was "a
  // rule's objects stay a rule however they are moved" — the whole row goes up with it (`offsets`), never a pin.
  const s = shell();
  // A lift / a key step / a game's tool moved lamp 3 (a drag in the game turns the rule itself: bridge/code-place.ts).
  assert.equal(s.w.moved('lamp-row-3', { p: [4.8, 3.2, -22] }, false, false, 'lift'), true, 'taken: not an object move');
  assert.equal(s.w.moved('lamp-row-3', { p: [4.8, 3.2, -22] }, true, false, 'lift'), true);
  assert.deepEqual(s.model.places.get('lamp-row'), { offsets: [{ way: 'up', how: 'same', v: 3.2 }] }, 'every lamp 3.2 m up — no pin (the CRYSTAL FIELD file had lamp-row-3 and -5 as pins)');
  assert.equal(s.undo.size, 1, 'one ⌘Z');
  assert.deepEqual(s.model.result().objects, {}, 'never an object entry');
  assert.ok(s.sent.some((m) => m.type === 'studio:place/layout' && m.ids?.includes('lamp-row')), 'laid out again with it');
  assert.ok(s.w.choices.isOpen(), 'the four choices are open (as after a drag)');
  assert.ok(s.sent.some((m) => m.type === 'studio:place/choices' && (m as { on?: boolean }).on), 'the game page knows (its 1–4 and Esc are theirs)');
  // Just this one (key 4; not a row here, so 1 and 4 only): the same ⌘Z ends at the pin instead.
  assert.equal(s.w.choices.choose(2), false, 'no zigzag without a row');
  assert.equal(s.w.choices.choose(4), true);
  assert.equal(s.undo.size, 1, 'choosing again adds no step');
  assert.deepEqual(s.model.places.get('lamp-row'), { pins: { 'lamp-row-3': { p: [4.8, 3.2, -22] } } }, 'Just this one: the others back, lamp 3 by hand');
  s.w.choices.close();
  // The game page's place/held (a group's turn it kept still): its line with ✦.
  s.w.held({ id: 'lamp-row', key: 'lamp-row-3', way: 'side' });
  const said = s.told.at(-1)!;
  assert.equal(said.text, 'Street lamps: sideways position is set by the rule · ⌥-drag to move just this one');
  assert.equal(said.undo, false, 'no "⌘Z undoes it": nothing was done');
  assert.deepEqual(said.acts, ['✦ Ask Claude: “Let me move Street lamps sideways too”']);
  said.run[0]!();
  assert.deepEqual(s.asked, ['Let me move Street lamps sideways too'], '✦ puts the draft in the chat box (nothing sent)');
});

test('the shell: ⌥ = just this one by hand, told with Back to rule; marked Placed by hand on the card and in the list', () => {
  const s = shell();
  s.w.moved('lamp-row-3', { p: [7, 0, -22] }, true, true, 'move');
  assert.deepEqual(s.model.places.get('lamp-row')?.pins, { 'lamp-row-3': { p: [7, 0, -22] } });
  const said = s.told.at(-1)!;
  // studio-hand-marks: the words of the hand-marks plan §2, in the hand's form (sand, the hand, the undo key last).
  assert.equal(said.text, 'Placed Street lamps 3 by hand (the rest stay on the rule)');
  assert.equal(said.undo, true, '"⌘Z undoes it" after it');
  assert.equal(said.hand, true, 'the hand\'s line');
  assert.deepEqual(said.acts, ['Revert']);
  const tag = s.w.listTag('lamp-row-3')!;
  assert.equal(tag.hand?.tag, 'By hand');
  assert.equal(s.w.listTag('lamp-row-2')!.hand, undefined, 'the others: the Rule tag only');
  // Already by hand: its moves are its pin, without ⌥ and without being told again.
  const n = s.told.length;
  s.w.moved('lamp-row-3', { p: [7.5, 0, -22] }, true, false, 'move');
  assert.deepEqual(s.model.places.get('lamp-row')?.pins?.['lamp-row-3'], { p: [7.5, 0, -22] });
  assert.equal(s.told.length, n);
  // Back to rule (the line's word): back in its rule, one more undo step.
  said.run[0]!();
  assert.deepEqual(s.model.places.get('lamp-row')?.pins ?? {}, {});
  assert.equal(s.undo.size, 3);
  // The list's word does the same.
  s.w.moved('lamp-row-1', { p: [7, 0, -6] }, true, true, 'move');
  s.w.listTag('lamp-row-1')!.hand!.run();
  assert.deepEqual(s.model.places.get('lamp-row')?.pins ?? {}, {});
});

test('the shell: a group moves a rule\'s objects as its offset (⌥ by hand); a group\'s turn keeps them and says why once', () => {
  // studio-offsets: several picked and moved = their rule moves with them, All the same (the ground and the height:
  // `move` / `up`), in the same undo step as the others' moves.
  const s = shell();
  const r = s.w.groupMoved([{ key: 'crate', pose: { p: [1, 0, 0] }, from: { p: [0, 0, 0] } }, { key: 'lamp-row-2', pose: { p: [5.8, 0, -14] }, from: { p: [4.8, 0, -14] } }], true, false);
  assert.deepEqual(r.rest.map((x) => x.key), ['crate'], 'the crate moves');
  assert.equal(r.changes.length, 1, 'the lamps: their rule\'s offset, in the same undo step');
  assert.deepEqual(r.changes[0]!.to, { offsets: [{ way: 'move', how: 'same', v: [1, 0] }] }, 'every lamp 1 m the same way — no pin');
  assert.ok(s.sent.some((m) => m.type === 'studio:place/layout'), 'the whole row laid out again');
  const r2 = s.w.groupMoved([{ key: 'lamp-row-2', pose: { p: [5.8, 0, -14] }, from: { p: [4.8, 0, -14] } }], true, true);
  assert.equal(r2.changes.length, 1, '⌥: its pin, in the same undo step as the others');
  assert.ok(r2.changes[0]!.to?.pins?.['lamp-row-2'], '…a pin');
  // Key steps of several: Move / Height go with the rest; a turn / size / End keeps a rule's objects, said once.
  assert.deepEqual(s.w.steps(['crate', 'lamp-row-1'], false, 'move'), ['crate', 'lamp-row-1']);
  assert.deepEqual(s.w.steps(['crate', 'lamp-row-1'], false, 'rotate'), ['crate']);
  assert.match(s.told.at(-1)!.text, /Street lamps is laid out by a rule, so it doesn’t move as a group/);
  const n = s.told.length;
  assert.deepEqual(s.w.steps(['crate', 'lamp-row-1'], true, 'rotate'), ['crate'], 'a held key: quiet');
  assert.equal(s.told.length, n);
  assert.deepEqual(s.w.steps(['lamp-row-2']), ['lamp-row-2'], 'one object steps (its rule\'s offset, or its pin)');
});

test('the shell: a drag that turned two knobs at once is one undo step (Move: along and side)', () => {
  const s = shell();
  const info = s.w.layoutOf('lamp-row-1')!;
  info.knobs.side = { v: 4.8, label: 'From the road', unit: 'm' };
  s.w.knob({ id: 'lamp-row', knob: 'gap', v: 6, end: false, knobs: { gap: 6, side: 5.5 } });
  s.w.knob({ id: 'lamp-row', knob: 'gap', v: 5, end: true, knobs: { gap: 5, side: 6.5 } });
  assert.equal(s.undo.size, 1);
  assert.deepEqual(s.model.places.get('lamp-row')?.knobs, { gap: { v: 5, was: 8 }, side: { v: 6.5, was: 4.8 } });
  delete info.knobs.side;
});

test('the words: "Convert to coordinates" for a rule motion and a rule layout; its line; a rule motion takes no points', () => {
  for (const lang of ['en', 'ja'] as const) assert.equal(translate(lang, 'rule.points'), translate(lang, 'rule.individually'), `${lang}: one button`);
  assert.equal(translate('ja', 'rule.individually'), '座標にする');
  assert.equal(translate('en', 'rule.points'), 'Convert to coordinates');
  assert.equal(translate('ja', 'rule.pointsDone', { name: 'らせん' }), 'らせんのルールを座標にしました');
  assert.equal(translate('ja', 'rule.individuallyDone', { name: '街灯', n: 12 }), '街灯のルールを座標にしました');
  assert.equal(translate('ja', 'hands.undo', { text: translate('ja', 'rule.pointsDone', { name: 'らせん' }), key: '⌘Z' }), 'らせんのルールを座標にしました · ⌘Z で戻せます', 'the brief\'s line');
  assert.match(translate('ja', 'rule.noKeys', { name: 'らせん' }), /座標にする/);
  assert.equal(translate('ja', 'rule.pinnedDone', { obj: '街灯 3' }), '街灯 3 を手で置きました（ほかはルールのまま）');
});

test('a rule motion\'s points are offsets from where the object stands (relative: the path goes with the object)', () => {
  // "Convert to coordinates" samples the rule like this (bridge/code-motion.ts timeline/code-points): at() offsets.
  codeMotion('spiral', { name: 'Spiral', knobs: { radius: { v: 2, label: 'Radius', unit: 'm' } }, round: 4,
    at: (t: number, k: Record<string, number>) => ({ p: [k.radius! * Math.cos((t / 4) * 2 * Math.PI) - k.radius!, 0, k.radius! * Math.sin((t / 4) * 2 * Math.PI)] }) });
  const first = ruleAt(globalThis as never, 'spiral', 0, { radius: 2 }, null, 3)!;
  const quarter = ruleAt(globalThis as never, 'spiral', 1, { radius: 2 }, null, 3)!;
  assert.deepEqual(first.p!.map((v) => Math.round(v * 1000) / 1000), [0, 0, 0], 'the first point is the object\'s own place (offset 0), wherever it stands');
  assert.deepEqual(quarter.p!.map((v) => Math.round(v * 1000) / 1000), [-2, 0, 2], 'not a place in the world');
});

test('the AI\'s object.move / turn / scale / ground on a rule\'s object: refused with the ways that keep it a rule', async () => {
  const { createAiHands } = await import('../src/shell/ai-hands.ts');
  const { UndoStack: Undo } = await import('../src/shell/undo.ts');
  const undo = new Undo();
  const poses = new Map([['lamp-row-3', { p: [4.8, 0, -22] }], ['lamp-row-2', { p: [4.8, 0, -14] }]]);
  const places: Record<string, PlacementPlace> = { 'lamp-row': { pins: { 'lamp-row-2': { p: [6, 0, -14] } } } };
  const info: CodePlaceInfo = { id: 'lamp-row', name: 'Street lamps', keys: ['lamp-row-1', 'lamp-row-2', 'lamp-row-3'], skipped: [], knobs: { gap: { v: 8, label: 'Gap', unit: 'm' } }, drag: 'gap', avoid: [] };
  const lines: string[] = [];
  const hands = createAiHands({
    t: (k, v) => translate('en', k, v), ready: () => true, playing: () => false, stopPlay: async () => undefined, toWorld: () => undefined, dim: () => '3d',
    item: (k) => ({ key: k, label: k, kinds: ['mesh'], rotatable: true, scalable: true }) as Item, label: (k) => k, keys: () => [...poses.keys()],
    pose: (k) => poses.get(k), setPose: (k, p) => void poses.set(k, p as never), ground: async () => true,
    codePlaces: () => [info], codeMotions: () => [], codeAvoids: () => [], place: (id) => places[id] ?? null, placeIds: () => Object.keys(places),
    undoBegin: () => undo.begin(), undoEnd: (w) => !!undo.end(w), done: (w) => void lines.push(w),
  } as never);
  const r = await hands.run({ id: '1', by: 'claude', ops: [{ do: 'object.move', key: 'lamp-row-3', by: [0, 3, 0] }] });
  assert.equal(r.results[0]!.ok, false);
  assert.match(r.results[0]!.error ?? '', /lamp-row-3 is placed by codePlace\('lamp-row'\) \(its rule\) and stays in it: change the rule's numbers with place.set --knobs/);
  assert.deepEqual(poses.get('lamp-row-3'), { p: [4.8, 0, -22] }, 'not moved');
  const r2 = await hands.run({ id: '2', by: 'claude', ops: [{ do: 'object.move', key: 'lamp-row-2', by: [1, 0, 0] }] });
  assert.equal(r2.results[0]!.ok, true, 'one put by hand already moves');
});

test('the shell: ⌥ with several picked puts each by hand together, told once with Back to rule for all', () => {
  const s = shell();
  const r = s.w.groupMoved([{ key: 'lamp-row-1', pose: { p: [6, 0, -6] }, from: { p: [4.8, 0, -6] } }, { key: 'lamp-row-2', pose: { p: [6, 0, -14] }, from: { p: [4.8, 0, -14] } }], true, true);
  assert.equal(r.changes.length, 1, 'one change of the layout (the same undo step as the others\' moves)');
  const said = s.told.at(-1)!;
  assert.equal(said.text, 'Placed 2 of Street lamps by hand', 'several of one rule: its name and how many (the hand-marks plan §2)');
  said.run[0]!();
  assert.deepEqual(s.model.places.get('lamp-row')?.pins ?? {}, {}, 'Back to rule: both back');
});
