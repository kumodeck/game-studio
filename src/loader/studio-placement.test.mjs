// Tests for the placement loader, run against both the source and the built (comment-stripped)
// copy that ships in skills/arrange/bin. Run: node --test src/loader/studio-placement.test.mjs
// The scene graphs are small stand-ins with the same fields three.js and PixiJS objects have; the
// real libraries are exercised by the headless browser check.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BUILT = path.join(PKG, 'skills/arrange/bin/studio-placement.js');

function vec3() {
  return { x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); return this; }, setScalar(s) { return this.set(s, s, s); } };
}
function obj3(name, children = [], userData = {}) {
  const o = { isObject3D: true, name, userData, children, position: vec3(), rotation: { x: 0, y: 0, z: 0 }, scale: vec3().set(1, 1, 1) };
  return o;
}
function vec2() {
  return { x: 0, y: 0, set(x, y = x) { Object.assign(this, { x, y }); } };
}
function sprite(label, children = [], studioKey) {
  return { label, studioKey, children, position: vec2(), rotation: 0, scale: vec2() };
}

function threeScene() {
  const trunk = obj3('tree');
  const tree1 = obj3('tree', [trunk]);
  const tree2 = obj3('tree');
  const marked = obj3('anything', [], { studioKey: 'hero' });
  const byId = obj3('', [], { id: 42 });
  const odd = obj3('Big Rock!');
  const hidden = obj3('', [obj3(''), obj3('deep')]);
  const scene = obj3('', [tree1, tree2, marked, byId, odd, hidden]);
  scene.isScene = true;
  return { scene, tree1, tree2, trunk, marked, byId, odd, hidden };
}

for (const [label, file] of [['source', './studio-placement.js'], ['built', pathToFileURL(BUILT).href]]) {
  const mod = await import(file);
  const { applyPlacement, findByKey } = mod;

  test(`${label}: three.js — keys resolve by mark, name, name#n, userData and path`, () => {
    const s = threeScene();
    assert.equal(findByKey(s.scene, 'hero'), s.marked);
    assert.equal(findByKey(s.scene, 'tree'), s.tree1);
    // "tree#2" is the second outermost "tree", not the trunk inside the first one.
    assert.equal(findByKey(s.scene, 'tree#2'), s.tree2);
    assert.equal(findByKey(s.scene, 'tree#3'), null);
    assert.equal(findByKey(s.scene, '42'), s.byId);
    assert.equal(findByKey(s.scene, 'Big_Rock_'), s.odd);
    assert.equal(findByKey(s.scene, 'path:5/1'), s.hidden.children[1]);
    assert.equal(findByKey(s.scene, 'path:9'), null);
    assert.equal(findByKey(s.scene, 'path:x'), null);
  });

  test(`${label}: three.js — applies p / r / s and reports`, async () => {
    const s = threeScene();
    const warns = [];
    const orig = console.warn;
    console.warn = (m) => warns.push(m);
    try {
      const report = await applyPlacement(s.scene, {
        version: 1, tool: 'placement', dim: '3d', space: 'local',
        objects: {
          tree: { p: [1, 2, 3], r: 0.5, s: 2 },
          'tree#2': { s: [1, 2, 3] },
          hero: { p: [0, 0, -4] },
          'path:5/1': { r: -1, unstable: true },
          gone: { p: [0, 0, 0] },
          broken: { p: [0, 0] },
          'Big_Rock_': { p: [0, 'x', 0] },
        },
      });
      assert.deepEqual(report.applied, ['tree', 'tree#2', 'hero', 'path:5/1']);
      assert.deepEqual(report.missing, ['gone', 'broken']);
      assert.deepEqual(report.unstable, ['path:5/1']);
      assert.deepEqual(report.skipped, ['Big_Rock_']);
      assert.deepEqual([s.tree1.position.x, s.tree1.position.y, s.tree1.position.z], [1, 2, 3]);
      assert.equal(s.tree1.rotation.y, 0.5);
      assert.deepEqual([s.tree1.scale.x, s.tree1.scale.z], [2, 2]);
      assert.deepEqual([s.tree2.scale.x, s.tree2.scale.y, s.tree2.scale.z], [1, 2, 3]);
      assert.equal(s.marked.position.z, -4);
      assert.equal(s.hidden.children[1].rotation.y, -1);
      assert.equal(s.odd.position.x, 0); // skipped entry left alone
      // One warning line per kind of problem, not one per key.
      assert.equal(warns.length, 2);
      assert.match(warns[0], /^\[studio\] placement\.json: 2 key\(s\) not found, ignored: gone, broken$/);
    } finally {
      console.warn = orig;
    }
  });

  test(`${label}: copies (added) are made from their original; deletions (removed) are hidden`, async () => {
    // A minimal clone()/add() like three's: same fields, own userData, parent link.
    const mk = (name, ud = {}) => {
      const o = obj3(name, [], ud);
      o.visible = true;
      o.clone = () => { const c = mk(o.name, JSON.parse(JSON.stringify(o.userData))); return c; };
      o.add = (c) => { c.parent = o; o.children.push(c); };
      return o;
    };
    const scene = mk('');
    scene.isScene = true;
    const crate = mk('crate', { studioKey: 'crate-1' });
    const rock = mk('rock');
    const coded = mk('crate', { studioKey: 'crate-9' }); // a copy the AI already put in the code
    for (const o of [crate, rock, coded]) scene.add(o);
    rock.position.set(1, 0, 1);
    const report = await applyPlacement(scene, {
      version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
      added: [
        { key: 'crate-5', from: 'crate-1', p: [4, 0, 2], r: 1, s: 2 },
        { key: 'crate-9', from: 'crate-1', p: [9, 9, 9] },
        { key: 'crate-6', from: 'nothing', p: [0, 0, 0] },
      ],
      removed: [{ key: 'rock', was: { p: [1, 0, 1] } }],
    });
    const copy = findByKey(scene, 'crate-5');
    assert.ok(copy && copy !== crate, 'the copy exists under its own key');
    assert.equal(copy.parent, scene);
    assert.deepEqual([copy.position.x, copy.position.z, copy.rotation.y, copy.scale.x], [4, 2, 1, 2]);
    assert.equal(crate.position.x, 0, 'the original stays where it was');
    assert.equal(coded.position.x, 0, 'a key the game already has is not copied again');
    assert.equal(rock.visible, false);
    assert.deepEqual(report.applied, ['crate-5', 'rock']);
    assert.deepEqual(report.missing, ['crate-6']);
    // Moved since it was deleted (the key now names something else): left alone.
    rock.visible = true;
    rock.position.set(5, 0, 5);
    await applyPlacement(scene, { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, removed: [{ key: 'rock', was: { p: [1, 0, 1] } }] });
    assert.equal(rock.visible, true);
  });

  test(`${label}: PixiJS — labels, studioKey, rotation and 2D scale`, async () => {
    const a = sprite('player');
    const b = sprite('coin');
    const c = sprite('coin');
    const marked = sprite('', [], 'boss');
    const stage = sprite('', [a, sprite('ui', [b]), c, marked]);
    const report = await applyPlacement(stage, {
      version: 1, tool: 'placement', dim: '2d',
      objects: { player: { p: [100, 50.5], r: 1.2, s: [-1, 1] }, 'coin#2': { s: 3 }, boss: { p: [7, 8] } },
    });
    assert.deepEqual(report.applied, ['player', 'coin#2', 'boss']);
    assert.deepEqual([a.position.x, a.position.y, a.rotation, a.scale.x, a.scale.y], [100, 50.5, 1.2, -1, 1]);
    assert.deepEqual([c.scale.x, c.scale.y], [3, 3]);
    assert.equal(b.scale.x, 0);
    assert.deepEqual([marked.position.x, marked.position.y], [7, 8]);
  });

  test(`${label}: PixiJS — draw order back -> front, keys stay findable`, async () => {
    // A tiny Container stand-in with Pixi's child-index methods.
    const box = (lbl, kids = []) => {
      const o = sprite(lbl, kids);
      for (const k of kids) k.parent = o;
      o.getChildIndex = (c) => o.children.indexOf(c);
      o.removeChild = (c) => { o.children.splice(o.children.indexOf(c), 1); c.parent = null; };
      o.addChildAt = (c, i) => { o.children.splice(i, 0, c); c.parent = o; };
      return o;
    };
    const bg = sprite('bg'), tree1 = sprite('tree'), tree2 = sprite('tree'), rock = sprite(''), house = sprite('house');
    const stage = box('', [bg, tree1, tree2, rock, house]);
    const report = await applyPlacement(stage, {
      version: 1, tool: 'placement', dim: '2d', objects: {},
      order: [{ in: 'stage', keys: ['path:3', 'house', 'tree#2', 'tree'] }],
    });
    assert.deepEqual(stage.children, [bg, rock, house, tree2, tree1], 'bg (not listed) keeps its place');
    assert.deepEqual(report.applied, ['order']);
    // Order-dependent keys were stamped, so they still find the same objects.
    assert.equal(findByKey(stage, 'path:3'), rock);
    assert.equal(findByKey(stage, 'tree#2'), tree2);
    assert.equal(findByKey(stage, 'tree'), tree1);
  });

  test(`${label}: never throws — missing file, bad JSON, wrong tool or dimension`, async () => {
    const orig = { fetch: globalThis.fetch, warn: console.warn };
    const warns = [];
    console.warn = (m) => warns.push(m);
    try {
      globalThis.fetch = async () => ({ ok: false, status: 404 });
      assert.deepEqual(await applyPlacement(threeScene().scene), { applied: [], missing: [], unstable: [], skipped: [] });
      assert.equal(warns.length, 0); // no file is normal, not a warning
      globalThis.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('Unexpected token'); } });
      assert.deepEqual((await applyPlacement(threeScene().scene)).applied, []);
      globalThis.fetch = orig.fetch;
      const url = 'data:application/json,' + encodeURIComponent(JSON.stringify({ version: 1, tool: 'placement', dim: '3d', objects: { tree: { p: [9, 9, 9] } } }));
      const s = threeScene();
      assert.deepEqual((await applyPlacement(s.scene, url)).applied, ['tree']);
      assert.equal(s.tree1.position.x, 9);
      assert.deepEqual((await applyPlacement(sprite('', []), url)).applied, []); // 3d file, 2d stage
      assert.deepEqual((await applyPlacement(s.scene, { tool: 'library' })).applied, []);
      assert.deepEqual((await applyPlacement(s.scene, null)).applied, []);
      assert.equal(warns.length, 4); // bad JSON, wrong dimension, wrong tool, no data
    } finally {
      globalThis.fetch = orig.fetch;
      console.warn = orig.warn;
    }
  });
}

// 9 KB since UI stage 1 (the `ui` part, 2026-10-19; was 6). The same limit as src/server/build.mjs LOADER_LIMIT.
test('the built loader is under 9 KB', () => {
  assert.ok(readFileSync(BUILT).length < 9 * 1024);
});
