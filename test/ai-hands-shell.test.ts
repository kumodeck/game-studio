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
