// Hand-offs to the AI (src/schema/handoff.mjs) and where the 3D edit camera
// looks when an object is picked from the list (src/adapters/three/focus.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRequestInput, normalizeStatus, requestId, isRequestId, statusCovers } from '../src/schema/handoff.mjs';
import { focusSphere, sceneSphere } from '../src/adapters/three/focus.js';

test('request ids sort by time and say what they are', () => {
  const a = requestId('ask', new Date('2026-10-16T15:30:12.482Z'), () => 0.5);
  assert.equal(a, '20261016-153012-482-ask-8000');
  assert.ok(isRequestId(a));
  const b = requestId('next-step', new Date('2026-10-16T15:30:13.001Z'), () => 0);
  assert.ok(isRequestId(b));
  assert.ok(a < b);
  assert.equal(isRequestId('../status'), false);
});

test('request input: one line of words, objects with keys, known steps only', () => {
  const ok = normalizeRequestInput({ kind: 'ask', text: '  make\r\nit glow  ', lang: 'ja', objects: [{ key: 'lamp', label: 'lamp', pose: { p: [1, NaN] } }], evil: 1 });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value, { kind: 'ask', text: 'make it glow', lang: 'ja', objects: [{ key: 'lamp' }] });
  const many = normalizeRequestInput({ kind: 'name', text: '', objects: Array.from({ length: 60 }, (_, i) => ({ key: `o${i}` })) });
  assert.ok(many.ok);
  assert.equal(many.value.objects.length, 50);
  assert.equal(many.value.moreObjects, 10);
  assert.equal(normalizeRequestInput({ kind: 'next-step', step: 'look', text: '' }).ok, true);
  assert.equal(normalizeRequestInput({ kind: 'next-step', step: 'constructor', text: '' }).ok, false);
  assert.equal(normalizeRequestInput({ kind: 'saved', text: 'x' }).ok, false); // only the host writes these
  // An ask with no objects = about the whole game; it still needs words. A name always needs objects.
  assert.deepEqual(normalizeRequestInput({ kind: 'ask', text: 'make it night', objects: [] }).value, { kind: 'ask', text: 'make it night', objects: [] });
  assert.equal(normalizeRequestInput({ kind: 'ask', text: '' }).ok, false);
  assert.equal(normalizeRequestInput({ kind: 'name', text: '', objects: [] }).ok, false);
  assert.equal(normalizeRequestInput({ kind: 'ask', text: 'x'.repeat(900), objects: [{ key: 'a' }] }).value.text.length, 500);
});

test('request input: delete-files carries a sorted, de-duplicated list of folder paths', () => {
  const ok = normalizeRequestInput({ kind: 'next-step', step: 'delete-files', text: '', files: ['b.png', 'a/c.png', 'b.png'] });
  assert.ok(ok.ok);
  assert.deepEqual(ok.value.files, ['a/c.png', 'b.png']);
  for (const files of [undefined, [], ['../x'], ['/etc/passwd'], ['.env'], ['a/.git/config'], ['a\\b'], [3], Array.from({ length: 201 }, (_, i) => `f${i}`)]) {
    assert.equal(normalizeRequestInput({ kind: 'next-step', step: 'delete-files', text: '', files }).ok, false, JSON.stringify(files)?.slice(0, 40));
  }
  // Other steps ignore "files".
  assert.equal(normalizeRequestInput({ kind: 'next-step', step: 'publish', text: '', files: ['x'] }).value.files, undefined);
});

test('request input: an ask keeps the camera it was asked from (eye, target), rounded; anything else drops it', () => {
  const v = normalizeRequestInput({ kind: 'ask', text: 'add 3 lighthouses', view: { eye: [1.23456, 4, -2], target: [0, 0.5, 0] } });
  assert.deepEqual(v.value.view, { eye: [1.235, 4, -2], target: [0, 0.5, 0] });
  assert.equal(normalizeRequestInput({ kind: 'ask', text: 'x', view: { eye: [1, 2], target: [0, 0, 0] } }).value.view, undefined);
  assert.equal(normalizeRequestInput({ kind: 'ask', text: 'x', view: { eye: [1, 2, NaN], target: [0, 0, 0] } }).value.view, undefined);
  assert.equal(normalizeRequestInput({ kind: 'name', text: '', objects: [{ key: 'a' }], view: { eye: [1, 2, 3], target: [0, 0, 0] } }).value.view, undefined);
});

test('status: lenient, unknown fields and bad values dropped', () => {
  assert.equal(normalizeStatus(null), null);
  assert.equal(normalizeStatus({ state: 'great' }), null);
  assert.deepEqual(normalizeStatus({ state: 'working', changed: -1, note: 'line\none', at: 'not a date', request: 'x' }), { version: 1, state: 'working', note: 'line one' });
});

test('statusCovers: by id, by a later id, or by time', () => {
  const req = { id: '20261016-153012-482-ask-8000', at: Date.parse('2026-10-16T15:30:12.482Z') };
  assert.equal(statusCovers(req, null, null), false);
  assert.equal(statusCovers(req, { state: 'received', request: req.id }, null), true);
  assert.equal(statusCovers(req, { state: 'done', request: '20261016-153100-000-name-0000' }, null), true);
  assert.equal(statusCovers(req, { state: 'done', request: '20261016-150000-000-ask-0000' }, req.at - 60_000), false);
  assert.equal(statusCovers(req, { state: 'received' }, req.at + 1000), true);
  assert.equal(statusCovers(req, { state: 'done' }, req.at - 1000), false);
  assert.equal(statusCovers(req, { state: 'done', handled: [req.id] }, null), true);
});

const box = (c, half) => ({ min: c.map((v) => v - half), max: c.map((v) => v + half) });

test('focus: a barrel shows its neighbours instead of filling the screen', () => {
  // Crates 1 m apart, each 0.5 m across (radius ≈ 0.43).
  const crates = [[0, 0.25, 0], [1.5, 0.25, 0], [3, 0.25, 0], [0, 0.25, 2], [6, 0.25, 6]].map((c) => box(c, 0.25));
  const f = focusSphere(crates[0], crates.slice(1), [0, 0, 0]);
  const old = Math.max(0.433 * 2.2, 1.5);
  assert.ok(f.radius > old * 1.4, `radius ${f.radius} should be wider than before (${old})`);
  // Second-nearest neighbour (2 m away) is inside the frame; the lone far one (8.5 m) is not.
  assert.ok(f.radius >= 2, `radius ${f.radius}`);
  assert.ok(f.radius < 8, `radius ${f.radius}`);
  assert.deepEqual(f.center, [0, 0, 0]);
});

test('focus: a huge ground frames the play area, not the whole plane', () => {
  const things = [[0, 0.5, 0], [2, 0.5, 1], [-2, 0.5, -1], [1, 0.5, -2]].map((c) => box(c, 0.5));
  const ground = { min: [-100, -0.1, -100], max: [100, 0, 100] };
  const sc = sceneSphere([ground, ...things]);
  assert.ok(sc.r < 5, `scene radius ${sc.r} leaves the ground out`);
  const f = focusSphere(ground, things, [0, 0, 0]);
  assert.ok(f.radius <= sc.r * 1.1 + 1e-9, `radius ${f.radius}`);
  assert.deepEqual(f.center.map((v) => Math.round(v * 100) / 100), sc.c.map((v) => Math.round(v * 100) / 100));
});

test('frame all: a flat ground a little bigger than 20× an object is left out too', () => {
  const things = [[-3, 0.4, -1], [2, 0.4, 2], [3, 0.4, -3], [0, 0.4, -5]].map((c) => box(c, 0.4));
  const ground = { min: [-12, 0, -12], max: [12, 0, 12] }; // 24 × 24, as in the three-crates sample
  const sc = sceneSphere([ground, ...things]);
  assert.ok(sc.r < 7, `scene radius ${sc.r}`);
});

test('focus: a single object still gets a sane frame', () => {
  const f = focusSphere(box([0, 0, 0], 1), [], [0, 0, 0]);
  assert.ok(f.radius >= 0.5 && f.radius <= 2, `radius ${f.radius}`);
});
