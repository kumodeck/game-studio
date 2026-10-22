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

  // motion (motion-gui, 2026-10-22): the maths shared with the editor, and the loader running it from the game's frames.
  test(`${label}: motionAt — back and forth, loop, once, spin`, () => {
    const { motionAt } = mod;
    const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
    const pp = { path: [[4, 0, 0]], speed: 2, repeat: 'pingpong' };
    assert.ok(close(motionAt(pp, 0).off, [0, 0, 0]));
    assert.ok(close(motionAt(pp, 1).off, [2, 0, 0]));
    assert.ok(close(motionAt(pp, 2).off, [4, 0, 0]));
    assert.ok(close(motionAt(pp, 3).off, [2, 0, 0]), 'on its way back');
    assert.ok(close(motionAt(pp, 4).off, [0, 0, 0]), 'back at the start');
    // No repeat = pingpong; no speed = 1 unit a second.
    assert.ok(close(motionAt({ path: [[4, 0, 0]] }, 5).off, [3, 0, 0]));
    // A square loop of side 2 at 1 m/s: corners at 2, 4, 6 s, the start again at 8 s.
    const sq = { path: [[2, 0, 0], [2, 0, 2], [0, 0, 2]], speed: 1, repeat: 'loop' };
    assert.ok(close(motionAt(sq, 3).off, [2, 0, 1]));
    assert.ok(close(motionAt(sq, 7).off, [0, 0, 1]), 'the closing side, back towards the start');
    assert.ok(close(motionAt(sq, 9).off, [1, 0, 0]), 'and round again');
    const once = { path: [[0, 0, 3]], speed: 1, repeat: 'once' };
    assert.equal(motionAt(once, 1).done, false);
    assert.ok(close(motionAt(once, 10).off, [0, 0, 3]));
    assert.equal(motionAt(once, 10).done, true);
    assert.equal(motionAt({ spin: 2 }, 1.5).turn, 3);
    assert.equal(motionAt({ spin: 2 }, 1.5).off, null);
    // 2D: the same with two numbers.
    assert.ok(close(motionAt({ path: [[100, 0]], speed: 50 }, 1).off, [50, 0]));
    // Bad input never throws.
    assert.equal(motionAt(null, 1).off, null);
    assert.equal(motionAt({ path: [['x']] }, 1).off, null);
  });

  // The timeline's clips (studio-timeline, 2026-10-22): `start` plays at once, the others wait for playMotion.
  test(`${label}: clips — start plays, a cue (playMotion) takes over, stopMotion(key) stops one`, async () => {
    const s = threeScene();
    const frames = [];
    const keep = { raf: globalThis.requestAnimationFrame, loc: globalThis.location, now: performance.now };
    let now = 1000;
    performance.now = () => now;
    globalThis.requestAnimationFrame = (cb) => frames.push(cb);
    try {
      globalThis.location = { search: '' };
      const clips = [
        { name: 'Bob', len: 2, repeat: 'pingpong', start: true, keys: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 2, v: [0, 2, 0] }] } },
        { name: 'Open', len: 1, keys: { r: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 1, v: [0, 1, 0] }], s: [{ t: 1, v: [2, 2, 2] }] } },
      ];
      const file = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: { hero: { p: [1, 0, 0] } }, motion: { hero: { clips } } };
      const report = await applyPlacement(s.scene, file);
      assert.deepEqual(report.motion, ['hero']);
      now = 2000;
      frames.shift()(now);
      assert.deepEqual([s.marked.position.x, s.marked.position.y], [1, 1], 'the start clip: half way up at 1 s');
      assert.equal(mod.playMotion('hero', 'Nope'), false);
      assert.equal(mod.playMotion('hero', 'Open'), true, 'a cue');
      now = 2500;
      frames.shift()(now);
      assert.equal(s.marked.rotation.y, 0.5, 'Open: half turned at 0.5 s');
      assert.deepEqual([s.marked.position.x, s.marked.position.y], [1, 1], 'Open has no position keys: the position stays where Bob left it');
      assert.equal(s.marked.scale.x, 2, 'a size key multiplies the size');
      assert.deepEqual(mod.clipOf('hero', 'Open').keys, clips[1].keys);
      mod.stopMotion('hero');
      frames.shift()?.(3000);
      assert.equal(frames.length, 0, 'nothing left to run: the loop ends');
      assert.equal(s.marked.rotation.y, 0.5, 'stopped where it was');
      // Inside the editor nothing plays, cues included.
      globalThis.location = { search: '?studio=edit' };
      assert.equal(mod.playMotion('hero', 'Open'), false);
    } finally {
      globalThis.requestAnimationFrame = keep.raf;
      performance.now = keep.now;
      if (keep.loc === undefined) delete globalThis.location;
      else globalThis.location = keep.loc;
      mod.stopMotion();
    }
  });

  // When a motion plays (studio-motion-triggers, 2026-10-22): the Library's motions used by name, and the triggers.
  test(`${label}: motionRunner — start, time, key, after, cue to stop, rounds, reset, enter`, () => {
    const { motionRunner, resolveClip } = mod;
    const lib = [
      { name: 'Hop', len: 1, keys: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 1, v: [0, 2, 0] }] } },
      { name: 'Spin', len: 2, repeat: 'loop', keys: { r: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 2, v: [0, 4, 0] }] } },
    ];
    const r = (c) => resolveClip(c, lib);
    const run = motionRunner([
      { key: 'buoy', clips: [r({ use: 'Spin', when: { on: 'start' }, until: { times: 2 } })] },
      { key: 'crate', clips: [r({ use: 'Hop', when: { on: 'key', key: 'KeyE' } })] },
      { key: 'door', clips: [r({ use: 'Hop', when: { on: 'after', use: 'Hop', key: 'crate' } })] },
      { key: 'lamp', clips: [r({ use: 'Spin', when: { on: 'time', after: 3 }, until: { cue: 'day', then: 'reset' } })] },
      { key: 'gate', clips: [r({ use: 'Hop', when: { on: 'enter', area: { p: [10, 0, 0], size: [2, 2, 2] }, who: 'player' } })] },
      { key: 'chest', clips: [r({ use: 'Hop', when: { on: 'cue', cue: 'chest-opened' } })] },
    ]);
    assert.equal(r({ use: 'Nope' }), null, 'a Library motion that is not there');
    assert.deepEqual(r({ name: 'Old', len: 1, start: true, keys: {} }).when, { on: 'start' }, "studio-timeline's start: true");
    assert.deepEqual(r({ name: 'Old', len: 1, when: 'when the player is near', keys: {} }).when, { on: 'say', say: 'when the player is near' });
    run.fire({ on: 'start' }, 0);
    let at = run.step(1000, () => [0, 0, 0]);
    assert.deepEqual(at.get('buoy').r, [0, 2, 0], 'the start clip plays');
    assert.equal(at.has('crate'), false, 'the key clip waits');
    assert.equal(run.fire({ on: 'key', key: 'KeyQ' }, 1000), 0, 'another key: nothing');
    run.fire({ on: 'key', key: 'KeyE' }, 1000);
    at = run.step(1500, () => [0, 0, 0]);
    assert.deepEqual(at.get('crate').p, [0, 1, 0], 'E: crate hops');
    at = run.step(2100, () => [0, 0, 0]);
    assert.deepEqual(at.get('crate').p, [0, 2, 0], 'once: holds its last pose');
    assert.equal(run.playing().get('door'), 'Hop', "door's Hop starts when crate's Hop ends");
    at = run.step(3100, () => [0, 0, 0]);
    assert.ok(at.has('lamp'), 'time: 3 s after the start');
    // buoy: 2 rounds of a 2 s loop = stops at 4 s, staying where it was.
    at = run.step(4500, () => [0, 0, 0]);
    assert.ok(Math.abs(at.get('buoy').r[1] - 4) < 1e-3, 'until times: stays at the end of its 2nd round');
    assert.equal(run.playing().has('buoy'), false);
    run.fire({ on: 'cue', cue: 'day' }, 4500);
    assert.deepEqual(run.step(4600, () => null).get('lamp').r, [0, 0, 0], 'until cue + reset: back on its first pose');
    assert.equal(run.playing().has('gate'), false);
    run.step(4700, (who) => (who === 'player' ? [10.5, 0, 0.5] : null));
    assert.equal(run.playing().get('gate'), 'Hop', 'enter: the player walked into the box');
    run.fire({ on: 'cue', cue: 'chest-opened' }, 5000);
    assert.equal(run.playing().get('chest'), 'Hop', 'a named cue');
    run.fire({ on: 'touch', key: 'crate' }, 5000);
    run.stop();
    assert.equal(run.step(6000, () => null).size, 0, 'stop(): nothing more');
    // A once motion with rounds: it plays again from its start each round, then stops on its last pose.
    const hop3 = motionRunner([{ key: 'crate', clips: [r({ use: 'Hop', when: { on: 'start' }, until: { times: 3 } })] }]);
    hop3.fire({ on: 'start' }, 0);
    assert.deepEqual(hop3.step(1500, () => null).get('crate').p, [0, 1, 0], 'half way through its 2nd round');
    assert.equal(hop3.playing().get('crate'), 'Hop');
    assert.deepEqual(hop3.step(3200, () => null).get('crate').p, [0, 2, 0], 'after 3 rounds: on its last pose');
    assert.equal(hop3.playing().has('crate'), false);
  });

  // studio-timeline-2 (2026-10-22): the path's handles (a Bézier span only where one was bent), `when` as a list, scenes.
  test(`${label}: handles — smooth spans unchanged, a bent span follows its handles, a corner comes straight in`, () => {
    const { trackAt, handlesOf, motionRunner, resolveClip } = mod;
    const ks = [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 1, v: [2, 1, 0], ease: 'linear' }, { t: 2, v: [4, 0, 0], ease: 'linear' }];
    const smooth = trackAt(ks, 0.5, true);
    const h = handlesOf(ks, 1);
    assert.deepEqual(h.in.map((x) => +x.toFixed(4)), [-0.6667, 0, 0]);
    const bent = ks.map((k, i) => (i === 1 ? { ...k, in: h.in, out: h.out } : k));
    assert.deepEqual(trackAt(bent, 0.5, true).map((x) => +x.toFixed(6)), smooth.map((x) => +x.toFixed(6)), 'the smooth handles written out: the same curve');
    const up = ks.map((k, i) => (i === 1 ? { ...k, in: [0, -2, 0], out: [0, 2, 0] } : k));
    assert.ok(trackAt(up, 1.5, true)[1] > trackAt(ks, 1.5, true)[1] + 0.3, 'bent up: the span after rises');
    const corner = ks.map((k, i) => (i === 1 ? { ...k, in: [0, 0, 0], out: [0, 0, 0] } : k));
    assert.deepEqual(trackAt(corner, 1, true), [2, 1, 0]);
    const lib = [{ name: 'Go', len: 1, tracks: { a: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 1, v: [1, 0, 0] }] }, b: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 1, v: [0, 1, 0] }] } } }];
    const run = motionRunner(['a', 'b'].map((key) => ({ key, clips: [resolveClip({ use: 'Go', when: [{ on: 'cue', cue: 'go' }, { on: 'key', key: 'KeyG' }] }, lib, key)] })));
    run.fire({ on: 'key', key: 'KeyG' }, 0);
    assert.deepEqual([...run.playing().keys()], ['a', 'b'], 'the second way, and the whole scene');
  });

  test(`${label}: motions in the file — use, key press, cue(), touch(), playMotion of a Library motion`, async () => {
    const s = threeScene();
    const frames = [];
    const keep = { raf: globalThis.requestAnimationFrame, loc: globalThis.location, now: performance.now, ael: globalThis.addEventListener };
    const listeners = {};
    let now = 1000;
    performance.now = () => now;
    globalThis.requestAnimationFrame = (cb) => frames.push(cb);
    globalThis.addEventListener = (type, f) => (listeners[type] ||= []).push(f);
    try {
      globalThis.location = { search: '' };
      const file = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
        motions: [{ name: 'Hop', len: 1, keys: { p: [{ t: 0, v: [0, 0, 0], ease: 'linear' }, { t: 1, v: [0, 2, 0] }] } }],
        motion: { hero: { clips: [{ use: 'Hop', when: { on: 'key', key: 'KeyE' } }] }, tree: { clips: [{ use: 'Hop', when: { on: 'cue', cue: 'go' } }] } } };
      const report = await applyPlacement(s.scene, file);
      assert.deepEqual(report.motion, ['hero', 'tree']);
      assert.ok(report.motionWaits.some((w) => w.includes('cue')), 'a cue clip is reported as waiting for the game');
      listeners.keydown.forEach((f) => f({ code: 'KeyE', target: null }));
      now = 1500;
      frames.shift()(now);
      assert.equal(s.marked.position.y, 1, 'E pressed: half way up');
      assert.equal(mod.cue('go'), true);
      now = 2000;
      frames.shift()(now);
      assert.equal(s.tree1.position.y, 1, "cue('go') started the tree's Hop");
      assert.equal(mod.playMotion('odd', 'Hop'), false, 'no object with that key');
      assert.equal(mod.playMotion('Big_Rock_', 'Hop'), true, 'a Library motion on an object it is not attached to');
      now = 2250;
      frames.shift()(now);
      assert.equal(s.odd.position.y, 0.5);
    } finally {
      globalThis.requestAnimationFrame = keep.raf;
      globalThis.addEventListener = keep.ael;
      performance.now = keep.now;
      if (keep.loc === undefined) delete globalThis.location;
      else globalThis.location = keep.loc;
      mod.stopMotion();
    }
  });

  test(`${label}: motion runs from the game's frames, not inside the editor`, async () => {
    const s = threeScene();
    const frames = [];
    const keep = { raf: globalThis.requestAnimationFrame, loc: globalThis.location, now: performance.now };
    let now = 1000;
    performance.now = () => now;
    globalThis.requestAnimationFrame = (cb) => frames.push(cb);
    try {
      globalThis.location = { search: '' };
      const file = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: { hero: { p: [1, 0, 0] } },
        motion: { hero: { path: [[0, 0, -4]], speed: 2, repeat: 'once' }, tree: { spin: 1 }, gone: { spin: 1 }, 'tree#2': { path: [[1, 2]] } } };
      const report = await applyPlacement(s.scene, file);
      assert.deepEqual(report.motion, ['hero', 'tree'], 'a missing key and a 2-number path in 3D are left out');
      assert.deepEqual([s.marked.position.x, s.marked.position.z], [1, 0], 'not moved before the first frame');
      now = 2000;
      frames.shift()(now);
      assert.deepEqual([s.marked.position.x, s.marked.position.y, s.marked.position.z], [1, 0, -2], 'the place + the path at 1 s');
      assert.equal(s.tree1.rotation.y, 1);
      assert.equal(frames.length, 1, 'asks for the next frame');
      mod.stopMotion();
      frames.shift()(3000);
      assert.equal(frames.length, 0, 'stopMotion() stops it');
      assert.equal(s.marked.position.z, -2);
      // Inside the editor (studio=edit): the editor owns every pose, nothing runs.
      globalThis.location = { search: '?studio=edit&parent=x' };
      const s2 = threeScene();
      const r2 = await applyPlacement(s2.scene, file);
      assert.equal(r2.motion, undefined);
      assert.equal(frames.length, 0);
    } finally {
      globalThis.requestAnimationFrame = keep.raf;
      performance.now = keep.now;
      if (keep.loc === undefined) delete globalThis.location;
      else globalThis.location = keep.loc;
      mod.stopMotion();
    }
  });

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

  // Levels (2026-10-22): one world part per level; only the level passed is applied, none without `level`.
  test(`${label}: levels — only the level being built is applied`, async () => {
    const file = {
      version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
      levels: [
        { id: 'meadow', objects: { tree: { p: [1, 0, 0] } } },
        { id: 'cave', objects: { tree: { p: [9, 0, 0] } }, removed: [{ key: 'hero' }] },
      ],
    };
    const warns = [];
    const orig = console.warn;
    console.warn = (m) => warns.push(m);
    try {
      const a = threeScene();
      assert.deepEqual((await applyPlacement(a.scene, file, { level: 'cave' })).applied, ['tree', 'hero']);
      assert.equal(a.tree1.position.x, 9);
      assert.equal(a.marked.visible, false, 'the cave level deleted hero');
      const b = threeScene();
      assert.deepEqual((await applyPlacement(b.scene, file, { level: 'meadow' })).applied, ['tree']);
      assert.equal(b.tree1.position.x, 1);
      const c = threeScene();
      assert.deepEqual((await applyPlacement(c.scene, file)).applied, [], 'no level given: nothing moves');
      assert.equal(c.tree1.position.x, 0);
      assert.match(warns.join('\n'), /pass \{ level \}/);
      const d = threeScene();
      assert.deepEqual((await applyPlacement(d.scene, file, { level: 'summit' })).applied, [], 'a level the file does not list');
    } finally {
      console.warn = orig;
    }
    assert.equal(mod.placementForLevel(file, 'cave').levels, undefined);
    assert.deepEqual(mod.placementForLevel(file, 'cave').removed, [{ key: 'hero' }]);
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

// 28 KB since UI stages 2–3 (set / theme, 2026-10-22; 24 since motion triggers, 16 since the timeline, 12 since
// motion-gui, 9 since UI stage 1, 6 before). The same limit as src/server/build.mjs LOADER_LIMIT.
// 28 KB since the timeline's second stage (handles, `when` lists, scenes: studio-timeline-2, 2026-10-22; 24 since
// motion triggers, 16 since the timeline, 12 since motion-gui, 9 since UI stage 1, 6 before). The same limit as
// src/server/build.mjs LOADER_LIMIT.
test('the built loader is under 28 KB', () => {
  assert.ok(readFileSync(BUILT).length < 28 * 1024);
});
