// Game rules layer (src/core/rules.ts) against a tiny fake adapter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRe, placeOnGrid, rulesFor, withRules, type RulesHolder } from '../src/core/rules.ts';
import type { Item, Pose, StudioAdapter } from '../src/contract.ts';

function fake(dim: '2d' | '3d' = '3d') {
  const poses = new Map<string, Pose>([
    ['crate', { p: [0, 0, 0], r: 0, s: 1 }],
    ['crate#2', { p: [5, 0, 0], r: 0, s: 1 }],
    ['ground', { p: [0, 0, 0], r: 0, s: 1 }],
    ['ui-label', { p: [0, 3, 0], r: 0, s: 1 }],
  ]);
  const item = (key: string): Item => ({ key, label: key, group: key.startsWith('crate') ? 'crate' : undefined, kinds: ['mesh'], rotatable: true, scalable: true, pose: structuredClone(poses.get(key)!) });
  let finger = [0, 0];
  const a: StudioAdapter = {
    kind: 'fake', dim,
    list: () => [...poses.keys()].map(item),
    begin: () => [...poses.keys()].map(item),
    end() {}, render() {},
    pickNear: () => [...poses.keys()],
    anchor: (k) => ({ center: [0, 0], size: 10, pose: structuredClone(poses.get(k)!), visible: true }),
    grab: (_k, x, y) => ((finger = [x, y]), true),
    drag(k, x, y) {
      const p = poses.get(k)!;
      p.p = [p.p[0]! + (x - finger[0]!) / 10, p.p[1]!, p.p[2]! + (y - finger[1]!) / 10];
      finger = [x, y];
      return structuredClone(p);
    },
    rotate(k, d) {
      const p = poses.get(k)!;
      p.r = (p.r ?? 0) + d;
      return structuredClone(p);
    },
    scale(k, f) {
      const p = poses.get(k)!;
      p.s = ((p.s as number) ?? 1) * f;
      return structuredClone(p);
    },
    nudgeY(k, dy) {
      const p = poses.get(k)!;
      p.p[1]! += dy;
      return structuredClone(p);
    },
    setPose(k, pose) {
      poses.set(k, structuredClone(pose));
      return structuredClone(pose);
    },
    capture: async () => ({ ok: false }),
    view: { pan() {}, zoom() {}, frameAll() {}, focus() {}, state: () => null },
    assetsOf: () => [],
  };
  return { a, poses };
}

test('globs match key, label or group', () => {
  assert.ok(globToRe('crate*').test('crate#2'));
  assert.ok(!globToRe('crate').test('crates'));
  assert.equal(rulesFor({ key: 'x', label: 'x', group: 'crate' }, { version: 1, rules: [{ match: 'crate', locked: true }] }).locked, true);
});

test('grid: 3D snaps x/z, keeps height; bounds clamp', () => {
  assert.deepEqual(placeOnGrid([1.26, 0.37, -2.74], 0.5, undefined, '3d'), [1.5, 0.37, -2.5]);
  assert.deepEqual(placeOnGrid([12, 0, -30], 1, { min: [-10, 0, -10], max: [10, 5, 10] }, '3d'), [10, 0, -10]);
  assert.deepEqual(placeOnGrid([13, 27], [16, 0], undefined, '2d'), [16, 27]);
});

test('drag snaps to the grid; hidden and locked objects are left alone', () => {
  const { a, poses } = fake();
  const holder: RulesHolder = { config: { version: 1, snap: { grid: 1 }, rules: [{ match: 'ui-*', hidden: true }, { match: 'ground', locked: true }] }, ext: [] };
  const r = withRules(a, holder);
  assert.deepEqual(r.list().map((i) => i.key), ['crate', 'crate#2', 'ground']);
  const ground = r.list().find((i) => i.key === 'ground')!;
  assert.equal(ground.movable, false);
  assert.equal(ground.rotatable, false);
  assert.equal(r.grab('ground', 0, 0), false);
  r.grab('crate', 0, 0);
  const p = r.drag('crate', 13, 26); // fake moves 1.3, 2.6
  assert.deepEqual(p.p, [1, 0, 3]);
  assert.deepEqual(poses.get('crate')!.p, [1, 0, 3]);
  assert.ok(!r.pickNear(0, 0, 10).includes('ui-label'));
});

test('angle snap accumulates small turns instead of swallowing them', () => {
  const { a } = fake();
  const r = withRules(a, { config: { version: 1, snap: { angle: 90 } }, ext: [] });
  let last = 0;
  for (let i = 0; i < 30; i++) last = r.rotate('crate', 0.03).r!; // 0.9 rad in small steps
  assert.ok(Math.abs(last - Math.PI / 2) < 1e-6, `expected 90°, got ${last}`);
  // Undo (setPose) is exact and resets the accumulator.
  r.setPose('crate', { p: [0, 0, 0], r: 0.1, s: 1 });
  assert.equal(r.list().find((i) => i.key === 'crate')!.pose.r, 0.1);
});

test('scale range and default size per kind; constrain() from tools.js has the last word', () => {
  const { a } = fake();
  const holder: RulesHolder = {
    config: { version: 1, rules: [{ match: 'crate*', scale: { default: 1.5, min: 0.5, max: 2 }, lockHeight: true }] },
    ext: [{ constrain: (_k, pose) => ({ ...pose, p: [pose.p[0]!, 0, Math.min(pose.p[2]!, 4)] }) }],
  };
  const r = withRules(a, holder);
  const c = r.list().find((i) => i.key === 'crate')!;
  assert.equal(c.defaultScale, 1.5);
  assert.equal(c.liftable, false);
  assert.equal(r.scale('crate', 10).s, 2);
  assert.equal(r.scale('crate', 0.01).s, 0.5);
  assert.equal(r.nudgeY!('crate', 3).p[1], 0, 'lockHeight');
  r.grab('crate', 0, 0);
  assert.equal(r.drag('crate', 0, 100).p[2], 4, 'constrain() clamps z');
});
