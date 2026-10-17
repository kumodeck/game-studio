// Unit tests for keys.js (candidate selection + keys) and the pure math. Plain objects stand in for Object3D.
// Run: node --test oss/game-studio/src/adapters/three/test/keys.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCandidates, sanitizeKey, KEY_RE } from '../keys.js';
import { invertM4, mulM4, rayTriangle, rayBox, wrapAngle } from '../math.js';

function node(props = {}, children = []) {
  const o = { name: '', userData: {}, children, visible: true, ...props };
  for (const c of children) c.parent = o;
  return o;
}
const mesh = (props = {}) => node({ isMesh: true, geometry: {}, ...props });
const scene = (children) => node({ isScene: true }, children);

test('direct children with meshes are candidates; unnamed ones get unstable path keys', () => {
  const s = scene([mesh(), node({ isLight: true }), mesh({ name: 'tree' }), node({}, [mesh()])]);
  const c = collectCandidates(s);
  assert.deepEqual(c.map((x) => x.key), ['path:0', 'tree', 'path:3']);
  assert.equal(c[0].unstable, true);
  assert.equal(c[1].unstable, false);
});

test('author mark beats name, and a later name cannot steal a marked key', () => {
  const s = scene([mesh({ name: 'crate' }), mesh({ name: 'other', userData: { studioKey: 'crate' } })]);
  const c = collectCandidates(s);
  assert.deepEqual(c.map((x) => [x.key, x.source]), [['crate#2', 'name'], ['crate', 'mark']]);
});

test('duplicate names become name#2, name#3 in traversal order', () => {
  const s = scene([mesh({ name: 'tree' }), mesh({ name: 'tree' }), mesh({ name: 'tree' })]);
  assert.deepEqual(collectCandidates(s).map((x) => x.key), ['tree', 'tree#2', 'tree#3']);
});

test('userData id/name are used before the path', () => {
  const s = scene([mesh({ userData: { id: 7 } }), mesh({ userData: { name: 'rock' } })]);
  assert.deepEqual(collectCandidates(s).map((x) => x.key), ['7', 'rock']);
});

test('a named group is one candidate (its parts are not listed), but a marked part is', () => {
  const car = node({ name: 'car' }, [mesh({ name: 'wheel' }), mesh({ name: 'body' }), mesh({ userData: { studioKey: 'spoiler' } })]);
  assert.deepEqual(collectCandidates(scene([car])).map((x) => x.key), ['car', 'spoiler']);
});

test('an unnamed mesh-less container under the scene lists its children; studio:"children" forces it', () => {
  const world = node({}, [mesh({ name: 'a' }), mesh({ name: 'b' })]);
  const level = node({ name: 'Scene', userData: { studio: 'children' } }, [mesh({ name: 'c' }), node({}, [mesh()])]);
  assert.deepEqual(collectCandidates(scene([world, level])).map((x) => x.key), ['a', 'b', 'c', 'path:1/1']);
});

test('excluded: studio:false, InstancedMesh, Points, helpers, cameras', () => {
  const s = scene([
    mesh({ userData: { studio: false } }),
    mesh({ isInstancedMesh: true }),
    node({ isPoints: true, geometry: {} }),
    node({ type: 'GridHelper', isLine: true }),
    node({ isCamera: true }, [mesh()]),
    mesh({ name: 'ok' })
  ]);
  assert.deepEqual(collectCandidates(s).map((x) => x.key), ['ok']);
});

test('names with odd characters are sanitized and keep the original as label', () => {
  const c = collectCandidates(scene([mesh({ name: 'Big Tree (1)' })]));
  assert.equal(c[0].key, 'Big_Tree__1_');
  assert.equal(c[0].label, 'Big Tree (1)');
  assert.match(sanitizeKey('x'.repeat(200)), KEY_RE);
  assert.match(sanitizeKey(''), KEY_RE);
});

test('a node without any mesh is not a candidate', () => {
  assert.deepEqual(collectCandidates(scene([node({ name: 'empty' })])), []);
});

test('math: invert × original = identity, ray hits', () => {
  const m = [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 5, 6, 7, 1];
  const id = mulM4(m, invertM4(m));
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(id[i] - (i % 5 === 0 ? 1 : 0)) < 1e-12);
  assert.equal(rayTriangle([0, 0, 5], [0, 0, -1], [-1, -1, 0], [1, -1, 0], [0, 1, 0]), 5);
  assert.equal(rayBox({ o: [0, 0, 5], d: [0, 0, -1] }, [-1, -1, -1], [1, 1, 1]), 4);
  assert.equal(rayBox({ o: [5, 5, 5], d: [0, 0, -1] }, [-1, -1, -1], [1, 1, 1]), null);
  assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-12);
  assert.ok(Math.abs(wrapAngle(-Math.PI) - Math.PI) < 1e-12);
});
