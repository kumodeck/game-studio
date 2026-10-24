// studio-offsets (2026-10-24): the editor's sums for a rule's offsets (src/shell/offset-model.ts) — a drag added to the
// rule's rows (merged, the row turned goes last, a row back to nothing goes), the four choices' shapes, how far a drag
// went in the dragged object's frame. WHY: "a lamp dragged away from the road did nothing" (the CRYSTAL FIELD
// try); now the whole rule follows, and the file keeps only which way, how and how much.
//   node --experimental-strip-types --test test/offset-model.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addOffset, dragAmount, lastOf, movesRank, noAmount, rowAt, snapAmount, type FrameRow } from '../src/shell/offset-model.ts';

const left: FrameRow = { line: 0, rank: 2, along: [0, -1], side: [-1, 0] };
const right: FrameRow = { line: 1, rank: 2, along: [0, -1], side: [1, 0], mirror: true };

test('a drag added to the rows: one row per way and how, merged; the one turned goes last; back to nothing goes', () => {
  let o = addOffset(undefined, { way: 'side', d: 1 }, 'same', 2)!;
  assert.deepEqual(o, [{ way: 'side', how: 'same', v: 1 }], '(1) the whole row 1 m from the road');
  o = addOffset(o, { way: 'up', d: 0.5 }, 'same', 2)!;
  o = addOffset(o, { way: 'side', d: 0.5 }, 'same', 3)!;
  assert.deepEqual(o, [{ way: 'up', how: 'same', v: 0.5 }, { way: 'side', how: 'same', v: 1.5 }], 'a second sideways All the same adds to it, and goes last');
  assert.deepEqual(lastOf(o, 'side'), { way: 'side', how: 'same', v: 1.5 }, 'the next sideways drag turns it');
  o = addOffset(o, { way: 'side', d: -1.5 }, 'same', 0)!;
  assert.deepEqual(o, [{ way: 'up', how: 'same', v: 0.5 }], 'dragged back: the row goes');
});

test('zigzag: the dragged one\'s parity (odd = its rank is odd); ramp: per one, never from the nearest', () => {
  assert.deepEqual(addOffset([], { way: 'side', d: 1.5 }, 'zigzag', 1), [{ way: 'side', how: 'zigzag', v: 1.5, odd: true }], '(2) lamp of rank 1: the odd ones');
  assert.deepEqual(addOffset([], { way: 'side', d: 1.5 }, 'zigzag', 2), [{ way: 'side', how: 'zigzag', v: 1.5 }], 'rank 2: the even ones (no odd)');
  const z = [{ way: 'side' as const, how: 'zigzag' as const, v: 1.5, odd: true as const }];
  assert.equal(movesRank(z[0]!, 3), true);
  assert.equal(movesRank(z[0]!, 2), false, 'the other parity does not move');
  assert.deepEqual(addOffset(z, { way: 'side', d: 0.5 }, 'zigzag', 3), [{ way: 'side', how: 'zigzag', v: 2, odd: true }], 'its width turned');
  assert.deepEqual(addOffset([], { way: 'side', d: 3.2 }, 'ramp', 4), [{ way: 'side', how: 'ramp', v: 0.8 }], '(3) the far one 3.2 m out: 0.8 m each');
  assert.equal(addOffset([], { way: 'side', d: 1 }, 'ramp', 0), null, 'the nearest cannot start a ramp');
  assert.equal(movesRank({ way: 'side', how: 'ramp', v: 1 }, 0), false);
  assert.deepEqual(rowAt({ way: 'side', how: 'ramp', v: 0.8 }, 4), 3.2);
  assert.ok(Math.abs((rowAt({ way: 'size', how: 'ramp', v: 1.1 }, 2) as number) - 1.2) < 1e-9);
});

test('size multiplies (ramp: 1 + (v − 1) × rank), move is the ground and "same" only', () => {
  assert.deepEqual(addOffset([{ way: 'size', how: 'same', v: 1.2 }], { way: 'size', d: 1.5 }, 'same', 0), [{ way: 'size', how: 'same', v: 1.8 }]);
  const r = addOffset([], { way: 'size', d: 1.4 }, 'ramp', 4)!;
  assert.deepEqual(r, [{ way: 'size', how: 'ramp', v: 1.1 }], 'the far one 1.4×: 1.1 each');
  assert.deepEqual(addOffset([{ way: 'size', how: 'same', v: 2 }], { way: 'size', d: 0.5 }, 'same', 0), [], '×1 again: no row');
  assert.deepEqual(addOffset([], { way: 'move', d: [1.2, -0.5] }, 'same', 0), [{ way: 'move', how: 'same', v: [1.2, -0.5] }]);
  assert.equal(addOffset([], { way: 'move', d: [1, 0] }, 'zigzag', 1), null);
});

test('how far a drag went: along or side in the dragged one\'s frame (side + = away from the road on both sides), turn mirrored', () => {
  const from = { p: [-5.6, 0, -18] };
  assert.deepEqual(dragAmount('move', left, from, { p: [-6.6, 0, -18.2] }, 3), { way: 'side', d: 1.0 }, 'left lamp to the left: +1 away from the road');
  assert.deepEqual(dragAmount('move', right, { p: [5.6, 0, -18] }, { p: [6.6, 0, -18] }, 3), { way: 'side', d: 1 }, 'right lamp to the right: +1 too');
  const a = dragAmount('move', left, from, { p: [-5.7, 0, -20] }, 3);
  assert.equal(a.way, 'along');
  assert.ok(Math.abs((a.d as number) - 2) < 1e-9, 'along: away from lamp 1');
  assert.equal(dragAmount('move', left, from, { p: [-5.7, 0, -20] }, 3, 'side').way, 'side', 'a way kept for the drag');
  assert.deepEqual(dragAmount('move', null, { p: [1, 0, 1] }, { p: [2, 0, 0.5] }, 3), { way: 'move', d: [1, -0.5] }, 'not a row: the ground');
  assert.deepEqual(dragAmount('lift', left, from, { p: [-5.6, 0.5, -18] }, 3), { way: 'up', d: 0.5 });
  const t = dragAmount('rotate', right, { p: [0, 0, 0], r: 0 }, { p: [0, 0, 0], r: Math.PI / 6 }, 3);
  assert.equal(t.way, 'turn');
  assert.ok(Math.abs((t.d as number) + 30) < 1e-9, 'the second row\'s turn is mirrored, so the row turns the dragged one as dragged');
  assert.deepEqual(dragAmount('scale', null, { p: [0, 0, 0], s: 1 }, { p: [0, 0, 0], s: 1.5 }, 3), { way: 'size', d: 1.5 });
  assert.deepEqual(snapAmount({ way: 'side', d: 1.04 }, 3), { way: 'side', d: 1 }, 'a hand lands on 1.0 m');
  assert.deepEqual(snapAmount({ way: 'turn', d: 14.6 }, 3), { way: 'turn', d: 15 });
  assert.equal(noAmount({ way: 'side', d: 0 }), true);
  assert.equal(noAmount({ way: 'size', d: 1 }), true);
});

test('eight rows at most (a ninth would not save): a new row is refused, the rows there still turn', () => {
  const eight = Array.from({ length: 8 }, (_, i) => ({ way: (['along', 'side', 'up', 'turn'] as const)[i % 4], how: (['same', 'ramp'] as const)[Math.floor(i / 4)], v: 2 }));
  assert.equal(addOffset(eight, { way: 'size', d: 1.2 }, 'same', 1), null, 'a ninth: no');
  assert.equal(addOffset(eight, { way: 'side', d: 1 }, 'same', 1)!.length, 8, 'the sideways row there: turned');
});
