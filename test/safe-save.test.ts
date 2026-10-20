// "Check before saving" (a hands-on try of 2026-10-19, item 4: "the road went up 16 m and I could save it like
// that — show 'Raised the road 16 m' before saving"): which changes are big enough to be said, and the words.
// The sheet in the real editor is test/fb-safe-shots.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/safe-save.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Item, Pose } from '../src/contract.ts';
import { bigChanges } from '../src/shell/safe-save.ts';
import { translate } from '../src/shell/i18n.ts';

const item = (key: string, extra: Partial<Item> = {}): Item => ({ key, label: key, kinds: ['mesh'], rotatable: true, scalable: true, pose: { p: [0, 0, 0] }, ...extra });
const run = (items: Item[], was: Record<string, Pose>, now: Record<string, Pose>, dim: '2d' | '3d' = '3d', lang: 'ja' | 'en' = 'ja') =>
  bigChanges(items, new Set(Object.keys(now)), (k) => was[k], (k) => now[k], dim, (k, v) => translate(lang, k, v), (it) => (it.label === 'road' ? (lang === 'ja' ? '道路' : 'the road') : it.label));

test('the road of the hands-on try: lifted 16 m → "道路を 16 m 上げました" / "Raised the road 16 m"', () => {
  const road = item('road', { backdrop: true });
  const was = { road: { p: [0, 0, -120], r: 0, s: 1 } }, now = { road: { p: [0, 16, -120], r: 0, s: 1 } };
  assert.deepEqual(run([road], was, now).map((c) => c.text), ['道路を 16 m 上げました']);
  assert.deepEqual(run([road], was, now, '3d', 'en').map((c) => c.text), ['Raised the road 16 m']);
});

test('a ground: any change you can see counts (lowered, moved, turned, resized), one line each', () => {
  const road = item('road', { backdrop: true });
  const lines = run([road], { road: { p: [0, 0, 0], r: 0, s: 1 } }, { road: { p: [3, -0.5, 0], r: Math.PI / 6, s: 2 } }).map((c) => c.text);
  assert.deepEqual(lines, ['道路を 0.5 m 下げました', '道路を 3 m 動かしました', '道路を 30° 回しました', '道路を 2 倍の大きさにしました']);
  assert.deepEqual(run([road], { road: { p: [0, 0, 0] } }, { road: { p: [0, 0.01, 0] } }), [], '1 cm: rounding, not a change');
});

test('other 3D objects: only a slip (5 m up / down, 25 m across, 3× the size) — a normal placement is not asked about', () => {
  const crate = item('crate');
  assert.deepEqual(run([crate], { crate: { p: [0, 0, 0] } }, { crate: { p: [8, 1, 2] } }), []);
  assert.deepEqual(run([crate], { crate: { p: [0, 0, 0] } }, { crate: { p: [0, 12, 0] } }).map((c) => c.text), ['crateを 12 m 上げました']);
  assert.deepEqual(run([crate], { crate: { p: [0, 0, 0] } }, { crate: { p: [30, 0, 0] } }).map((c) => c.text), ['crateを 30 m 動かしました']);
});

test('2D: only the ground / background, in px; unchanged objects are not looked at', () => {
  const bg = item('bg', { backdrop: true, label: 'background' });
  assert.deepEqual(run([bg, item('hero')], { bg: { p: [0, 0] }, hero: { p: [0, 0] } }, { bg: { p: [0, 120] }, hero: { p: [900, 0] } }, '2d', 'en').map((c) => c.text), ['Moved background 120 px']);
  assert.deepEqual(bigChanges([bg], new Set(), () => ({ p: [0, 0] }), () => ({ p: [500, 0] }), '2d', (k) => k, (i) => i.label), []);
});
