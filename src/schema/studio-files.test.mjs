// Tests for the shared validator (contract 4). Run: node --test src/schema/studio-files.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStudioFile, canonicalJSON, isSafeRelativePath, LIMITS } from './studio-files.mjs';

const ok = (input, opts) => {
  const r = validateStudioFile(input, opts);
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
  return r;
};
const bad = (input, pattern, opts) => {
  const r = validateStudioFile(input, opts);
  assert.equal(r.ok, false, 'expected the file to be refused');
  if (pattern) assert.match(r.errors.join('\n'), pattern);
  return r;
};
const place3d = (objects) => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects });
const place2d = (objects) => ({ version: 1, tool: 'placement', dim: '2d', objects });

test('placement: the example from the contract passes and keeps its meaning', () => {
  const r = ok(
    place3d({
      'tree-01': { p: [3.25, 0, -4.1], r: 1.5708, s: 1.2, was: { p: [2.0, 0, -4.1], r: 0, s: 1 }, label: 'tree-01' },
      'path:0/3/1': { p: [0, 1.5, 0], unstable: true, was: { p: [0, 1, 0] } },
    }),
  );
  assert.deepEqual(r.value.objects['tree-01'].p, [3.25, 0, -4.1]);
  assert.equal(r.value.objects['tree-01'].r, 1.5708);
  assert.equal(r.value.objects['path:0/3/1'].unstable, true);
  assert.ok(r.json.endsWith('\n'));
  assert.deepEqual(JSON.parse(r.json), r.value);
});

test('placement: rounds to 1 mm / 0.1 px / 1e-4 rad and prints short decimals', () => {
  const r3 = ok(place3d({ a: { p: [1.23456, -0.00049, 7.0005], r: 0.123456, s: 1.000049 } }));
  assert.deepEqual(r3.value.objects.a.p, [1.235, 0, 7.001]);
  assert.equal(r3.value.objects.a.r, 0.1235);
  assert.equal(r3.value.objects.a.s, 1);
  assert.doesNotMatch(r3.json, /0000000|9999999/);
  const r2 = ok(place2d({ a: { p: [100.04, -33.36] } }));
  assert.deepEqual(r2.value.objects.a.p, [100, -33.4]);
});

test('placement: angles wrap into (-pi, pi]', () => {
  const r = ok(place3d({ a: { r: Math.PI * 3 }, b: { r: -Math.PI }, c: { r: -Math.PI / 2 - Math.PI * 4 } }));
  assert.equal(r.value.objects.a.r, 3.1416);
  assert.equal(r.value.objects.b.r, 3.1416);
  assert.equal(r.value.objects.c.r, -1.5708);
});

test('placement: scale may be uniform, per axis, or mirrored; never zero', () => {
  assert.equal(ok(place3d({ a: { s: [2, 2, 2] } })).value.objects.a.s, 2);
  assert.deepEqual(ok(place3d({ a: { s: [1, 2, 3] } })).value.objects.a.s, [1, 2, 3]);
  assert.deepEqual(ok(place2d({ a: { s: [-1, 1] } })).value.objects.a.s, [-1, 1]);
  bad(place3d({ a: { s: 0 } }), /must not be 0/);
  bad(place3d({ a: { s: [1, 1] } }), /3 numbers/);
});

test('placement: same content in a different key order gives the same bytes', () => {
  const a = ok(place3d({ b: { p: [1, 2, 3], s: 2 }, a: { r: 1, p: [0, 0, 0] } }));
  const b = ok({ objects: { a: { p: [0, 0, 0], r: 1 }, b: { s: 2, p: [1, 2, 3] } }, space: 'local', dim: '3d', tool: 'placement', version: 1 });
  assert.equal(a.json, b.json);
  // Validating the output again is a fixed point.
  assert.equal(ok(a.json).json, a.json);
});

test('placement: refuses bad keys, too many objects, out-of-range and non-finite values', () => {
  bad(place3d({ 'has space': { p: [0, 0, 0] } }), /key must match/);
  bad(place3d({ ['x'.repeat(81)]: { p: [0, 0, 0] } }), /key must match/);
  const many = {};
  for (let i = 0; i <= LIMITS.maxObjects; i++) many['o' + i] = { p: [0, 0, 0] };
  bad(place3d(many), /at most 500/);
  bad(place3d({ a: { p: [0, 10001, 0] } }), /between/);
  ok(place2d({ a: { p: [0, 10001] } })); // 2D has the larger pixel bound
  bad(place2d({ a: { p: [0, 100001] } }), /between/);
  bad(place3d({ a: { p: [0, '1', 0] } }), /finite number/);
  bad(place3d({ a: { p: [0, 0] } }), /3 numbers/);
  bad('{"version":1,"tool":"placement","dim":"3d","objects":{"a":{"p":[0,1e999,0]}}}', /finite/);
  bad(place3d({ a: {} }), /at least one of p, r, s/);
});

test('placement: refuses unknown fields and wrong header values', () => {
  bad(place3d({ a: { p: [0, 0, 0], color: 'red' } }), /color: unknown field/);
  bad({ ...place3d({}), extra: 1 }, /extra: unknown field/);
  bad({ ...place3d({}), version: 2 }, /version/);
  bad({ ...place3d({}), dim: '4d' }, /dim/);
  bad({ ...place3d({}), space: 'world' }, /space/);
  bad(place3d({}), /expected "library"/, { tool: 'library' });
});

test('refuses __proto__ / constructor / prototype anywhere', () => {
  bad('{"version":1,"tool":"placement","dim":"3d","objects":{"__proto__":{"p":[0,0,0]}}}', /__proto__/);
  bad('{"__proto__":{"polluted":true},"version":1,"tool":"placement","dim":"3d","objects":{}}', /__proto__/);
  bad('{"version":1,"tool":"library","replace":[{"from":"a.png","to":"b.png","constructor":1}]}', /constructor/);
  assert.equal({}.polluted, undefined);
});

test('labels lose control characters and are capped', () => {
  const r = ok(place3d({ a: { p: [0, 0, 0], label: 'tree\u0000\n<b>' + 'x'.repeat(200) } }));
  assert.ok(r.value.objects.a.label.startsWith('tree<b>'));
  assert.equal(r.value.objects.a.label.length, LIMITS.maxLabel);
});

test('path: keys are always marked unstable', () => {
  assert.equal(ok(place3d({ 'path:0/1': { p: [0, 0, 0] } })).value.objects['path:0/1'].unstable, true);
  assert.equal(ok(place3d({ a: { p: [0, 0, 0], unstable: false } })).value.objects.a.unstable, undefined);
});

test('refuses input that is too large or not JSON', () => {
  bad('x'.repeat(LIMITS.maxBytes + 1), /larger than/);
  bad('{not json', /not valid JSON/);
  bad('[]', /JSON object/);
});

test('library: the example from the contract passes', () => {
  const r = ok({
    version: 1,
    tool: 'library',
    replace: [{ from: 'assets/tree.png', to: 'assets/tree-autumn.png', usedBy: ['tree-02', 'tree-01', 'tree-01'] }],
    added: [{ file: 'assets/rock.glb', place: { key: 'added-1', p: [1, 0, 2], r: 0, s: 1 } }],
    unused: ['assets/old-bg.png', 'assets/a.png', 'assets/old-bg.png'],
  });
  assert.deepEqual(r.value.replace[0].usedBy, ['tree-01', 'tree-02']);
  assert.deepEqual(r.value.unused, ['assets/a.png', 'assets/old-bg.png']);
  assert.deepEqual(r.value.added[0].place, { key: 'added-1', p: [1, 0, 2], r: 0, s: 1 });
});

test('library: missing lists become empty lists; order-free lists are canonical', () => {
  const a = ok({ version: 1, tool: 'library' });
  assert.deepEqual(a.value, { version: 1, tool: 'library', replace: [], added: [], unused: [] });
  const x = ok({ version: 1, tool: 'library', replace: [{ from: 'b.png', to: 'c.png' }, { from: 'a.png', to: 'c.png' }], unused: ['z', 'y'] });
  const y = ok({ unused: ['y', 'z'], replace: [{ to: 'c.png', from: 'a.png' }, { to: 'c.png', from: 'b.png' }], tool: 'library', version: 1 });
  assert.equal(x.json, y.json);
});

test('library: paths must stay inside the folder; remote URLs only as "from"', () => {
  bad({ version: 1, tool: 'library', unused: ['../secret.png'] }, /relative path/);
  bad({ version: 1, tool: 'library', unused: ['/etc/passwd'] }, /relative path/);
  bad({ version: 1, tool: 'library', unused: ['a\\b.png'] }, /relative path/);
  bad({ version: 1, tool: 'library', added: [{ file: 'C:/x.png' }] }, /relative path/);
  ok({ version: 1, tool: 'library', replace: [{ from: 'https://cdn.example.org/t.png', to: 'assets/t.png' }] });
  bad({ version: 1, tool: 'library', replace: [{ from: 'a.png', to: 'https://cdn.example.org/t.png' }] }, /relative path/);
  bad({ version: 1, tool: 'library', replace: [{ from: 'a.png', to: 'a.png' }] }, /the same/);
  bad({ version: 1, tool: 'library', replace: [{ from: 'a.png', to: 'b.png' }, { from: 'a.png', to: 'c.png' }] }, /more than once/);
  bad({ version: 1, tool: 'library', added: [{ file: 'a.glb', place: { key: 'bad key', p: [0, 0, 0] } }] }, /key/);
});

test('isSafeRelativePath', () => {
  for (const p of ['a.png', 'assets/x/y.glb', 'assets/caf\u00e9.png', '.well-known/x']) assert.ok(isSafeRelativePath(p), p);
  for (const p of ['', '/a', 'a//b', 'a/./b', 'a/../b', '..', 'a\u0000b', 'D:x', 'a\\b']) assert.ok(!isSafeRelativePath(p), p);
});

test('canonicalJSON sorts keys at every level', () => {
  assert.equal(canonicalJSON({ b: 1, a: { d: 1, c: [{ f: 1, e: 2 }] } }), '{\n  "a": {\n    "c": [\n      {\n        "e": 2,\n        "f": 1\n      }\n    ],\n    "d": 1\n  },\n  "b": 1\n}\n');
  // Number arrays on one line; string arrays and empty containers as below.
  assert.equal(canonicalJSON({ p: [3.25, 0, -4.1], u: ['a', 'b'], e: [], o: {} }), '{\n  "e": [],\n  "o": {},\n  "p": [3.25, 0, -4.1],\n  "u": [\n    "a",\n    "b"\n  ]\n}\n');
  // Same value as JSON.stringify, only the whitespace differs.
  const v = { a: [1, [2, 3], { b: 'x"y' }], n: null, t: true };
  assert.deepEqual(JSON.parse(canonicalJSON(v)), v);
});

test('placement: 2D draw order keeps the key order and sorts the lists', () => {
  const r = ok({
    ...place2d({ house: { p: [620, 380], was: { p: [600, 380] } } }),
    order: [
      { in: 'stage', keys: ['tree', 'house', 'path:6'], was: ['house', 'tree', 'path:6'] },
      { in: 'fence', keys: ['post-2', 'post-1'] },
    ],
  });
  assert.deepEqual(r.value.order.map((o) => o.in), ['fence', 'stage']);
  assert.deepEqual(r.value.order[1].keys, ['tree', 'house', 'path:6'], 'back -> front order is the content');
  assert.deepEqual(r.value.order[1].was, ['house', 'tree', 'path:6']);
  assert.match(r.json, /"keys": \[\n/);
  // A file with only an order change (no moved object) is fine.
  ok({ ...place2d({}), order: [{ in: 'stage', keys: ['a', 'b'] }] });
});

test('placement: draw order is refused for 3D, duplicates and bad keys', () => {
  bad({ ...place3d({}), order: [{ in: 'scene', keys: ['a', 'b'] }] }, /only 2D/);
  bad({ ...place2d({}), order: [{ in: 'stage', keys: ['a', 'a'] }] }, /listed twice/);
  bad({ ...place2d({}), order: [{ in: 'stage', keys: ['a'] }, { in: 'stage', keys: ['b'] }] }, /listed twice/);
  bad({ ...place2d({}), order: [{ in: 'st age', keys: ['a'] }] }, /in/);
  bad({ ...place2d({}), order: [{ in: 'stage', keys: [] }] }, /non-empty/);
  bad({ ...place2d({}), order: [{ in: 'stage', keys: ['a'], z: 1 }] }, /unknown field/);
  bad({ ...place2d({}), order: { stage: ['a'] } }, /must be an array/);
});

test('placement: copies keep the order they were made in, deletions are sorted', () => {
  const r = ok({
    ...place3d({ 'crate-1': { p: [1, 0, 0], was: { p: [0, 0, 0] } } }),
    added: [
      { key: 'crate-5', from: 'crate-1', p: [2.00004, 0, 0], r: 0.3, s: 1, label: 'crate-5' },
      { key: 'crate-6', from: 'crate-5', p: [3, 0, 0] },
    ],
    removed: [{ key: 'lamp', was: { p: [0, 0, -5], r: 0, s: 1 } }, { key: 'barrel' }, { key: 'path:0/7' }],
  });
  assert.deepEqual(r.value.added.map((a) => a.key), ['crate-5', 'crate-6']);
  assert.deepEqual(r.value.added[0].p, [2, 0, 0]);
  assert.deepEqual(r.value.removed.map((x) => x.key), ['barrel', 'lamp', 'path:0/7']);
  assert.equal(r.value.removed[2].unstable, true);
  ok({ ...place2d({}), added: [{ key: 'star-4', from: 'star-1', p: [10, 20] }] });
});

test('placement: bad copies and deletions are refused', () => {
  bad({ ...place3d({}), added: [{ key: 'a', from: 'a', p: [0, 0, 0] }] }, /same/);
  bad({ ...place3d({}), added: [{ key: 'a', from: 'b' }] }, /required/);
  bad({ ...place3d({}), added: [{ key: 'a', from: 'b', p: [0, 0] }] }, /3 numbers/);
  bad({ ...place3d({}), added: [{ key: 'a', from: 'b', p: [0, 0, 0] }, { key: 'a', from: 'b', p: [1, 0, 0] }] }, /twice/);
  bad({ ...place3d({}), added: [{ key: 'a b', from: 'b', p: [0, 0, 0] }] }, /key/);
  bad({ ...place3d({}), added: [{ key: 'a', from: 'b', p: [0, 0, 0], z: 1 }] }, /unknown field/);
  bad({ ...place3d({ a: { p: [0, 0, 0] } }), added: [{ key: 'a', from: 'b', p: [0, 0, 0] }] }, /also in objects/);
  bad({ ...place3d({}), added: [{ key: 'a', from: 'b', p: [0, 0, 0] }], removed: [{ key: 'a' }] }, /also in added/);
  bad({ ...place3d({}), removed: [{ key: 'a' }, { key: 'a' }] }, /twice/);
  bad({ ...place3d({}), removed: ['a'] }, /must be an object/);
});

test('placement: t (3D tilt) is optional, two angles, 3D only; files without it read as before', () => {
  const r = validateStudioFile(JSON.stringify({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: { a: { p: [0, 0, 0], t: [Math.PI * 3, -0.5] }, b: { p: [1, 0, 0] } } }), { tool: 'placement' });
  assert.ok(r.ok, JSON.stringify(r.errors));
  assert.equal(r.value.objects.a.t.length, 2);
  assert.ok(Math.abs(Math.abs(r.value.objects.a.t[0]) - Math.PI) < 1e-3, 'angles are normalised');
  assert.equal(r.value.objects.b.t, undefined);
  const only = validateStudioFile(JSON.stringify({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: { a: { t: [0.1, 0] } } }), { tool: 'placement' });
  assert.ok(only.ok, 'a tilt alone is a change');
  for (const bad of [{ dim: '2d', objects: { a: { p: [0, 0], t: [0, 0] } } }, { dim: '3d', objects: { a: { p: [0, 0, 0], t: [0] } } }, { dim: '3d', objects: { a: { p: [0, 0, 0], t: ['x', 0] } } }]) {
    const v = validateStudioFile(JSON.stringify({ version: 1, tool: 'placement', space: 'local', ...bad }), { tool: 'placement' });
    assert.equal(v.ok, false, JSON.stringify(bad));
  }
});

// When a motion plays and the Library's motions (studio-motion-triggers, 2026-10-22).
test('placement: motions and when / until', () => {
  const hop = { name: 'Hop', len: 0.6, keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 0.3, v: [0, 1, 0] }] } };
  const file = { ...place3d({}), motions: [hop], motion: {
    crate: { clips: [{ use: 'Hop', when: { on: 'key', key: 'KeyE' }, until: { times: 3, then: 'stay' } }] },
    gate: { clips: [{ use: 'Hop', when: { on: 'enter', area: { p: [1, 0, 2], size: [4, 2, 3] }, who: 'player' } }] },
    chest: { clips: [{ name: 'Open', use: 'Hop', when: { on: 'cue', cue: 'chest-opened' }, until: { cue: 'chest-closed', then: 'reset' } }] },
    old: { clips: [{ name: 'Row', len: 2, start: true, keys: {} }, { name: 'Wave', len: 1, when: 'when the player waves', keys: {} }] },
  } };
  const r = ok(file);
  assert.deepEqual(r.value.motions, [hop]);
  assert.deepEqual(r.value.motion.crate.clips[0], { use: 'Hop', when: { on: 'key', key: 'KeyE' }, until: { times: 3 } }, '"stay" is the default: not written');
  assert.equal(r.value.motion.chest.clips[0].name, 'Open');
  assert.equal(r.value.motion.old.clips[1].when, 'when the player waves', "studio-timeline's words still read");
  bad({ ...file, motions: [] }, /uses "Hop", which is not in motions/);
  bad({ ...file, motion: { a: { clips: [{ use: 'Hop', when: { on: 'cue', cue: 'Chest Opened' } }] } } }, /cue name/);
  bad({ ...file, motion: { a: { clips: [{ use: 'Hop', when: { on: 'fly' } }] } } }, /when\.on/);
  bad({ ...file, motion: { a: { clips: [{ use: 'Hop', keys: {} }] } } }, /keys/);
  bad({ ...file, motions: [{ ...hop, when: { on: 'start' } }] }, /when/);
});
