// Domino Spiral (starters/domino-spiral, the shelf's sample 4, 2026-11-06): the line laid from three placed points, the
// fall, the starter's shape, and the stand-in AI's one-number fix for its `try.ask`.
//
// WHY these: the sample's promise in the editor is "drag the head and the whole line follows, then ▶ falls along the
// path you made", and "Try replays to the same second". So: the path has no kink wherever the points are, moving the
// head leaves the spiral alone, the same points give the same dominoes, the fall is the same every run and reaches the
// middle, and taller dominoes (the ask) change the fall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layDominoes, pathPoints, entry, SPIRAL, MAX_DOMINOES } from '../starters/domino-spiral/js/path.js';
import { makeLine, touchAt } from '../starters/domino-spiral/js/topple.js';
import { readStarters, starterFiles } from '../src/server/starters.mjs';
import { shelfFix, SHELF_FIXES } from './ai-feel/fake-agent.mjs';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(PKG, 'starters/domino-spiral');
const GAME = readFileSync(join(DIR, 'game.js'), 'utf8');
/** A number at the top of game.js (`const NAME = 1.0;`). */
const num = (name) => Number(new RegExp(`const ${name} = ([\\d.]+);`).exec(GAME)?.[1]);
/** The three points as game.js ships them (`marker('head', x, z, …)`). */
const shipped = Object.fromEntries(['head', 'bend', 'center'].map((k) => {
  const m = new RegExp(`marker\\('${k}', (-?[\\d.]+), (-?[\\d.]+),`).exec(GAME);
  return [k, { x: Number(m[1]), z: Number(m[2]) }];
}));
const GAP = num('GAP');
const turnOf = (a, b) => Math.abs(((b - a + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

test('the shipped points lay about 400 dominoes, one GAP apart, starting at the head', () => {
  const d = layDominoes(shipped.head, shipped.bend, shipped.center, GAP);
  assert.ok(d.length >= 380 && d.length <= 480, `${d.length} dominoes`);
  assert.ok(Math.hypot(d[0].x - shipped.head.x, d[0].z - shipped.head.z) < 1e-9, 'the first stands on the head');
  for (let i = 1; i < d.length; i++) {
    const g = Math.hypot(d[i].x - d[i - 1].x, d[i].z - d[i - 1].z);
    // A chord of a curve is a little shorter than its arc: never longer, and only a little shorter even inside.
    assert.ok(g <= GAP + 1e-9 && g > GAP * 0.9, `gap ${i}: ${g.toFixed(3)}`);
  }
  const last = d[d.length - 1];
  const r = Math.hypot(last.x - shipped.center.x, last.z - shipped.center.z);
  assert.ok(Math.abs(r - SPIRAL.INNER) < GAP, `the last one is on the inner ring (r ${r.toFixed(2)})`);
  assert.deepEqual(layDominoes(shipped.head, shipped.bend, shipped.center, GAP), d, 'the same points, the same line');
});

test('no kink where the lead-in joins the spiral, wherever the points are dragged', () => {
  const cases = [
    shipped,
    { head: { x: -20, z: 12 }, bend: { x: -14, z: -6 }, center: shipped.center },
    { head: { x: 18, z: 10 }, bend: { x: 16, z: 2 }, center: { x: 0, z: -4 } }, // the lead-in on the right side
    { head: { x: -2, z: 16 }, bend: { x: 4, z: 14 }, center: { x: 2, z: -1 } }, // from the front
  ];
  for (const c of cases) {
    const d = layDominoes(c.head, c.bend, c.center, GAP);
    let worst = 0;
    for (let i = 1; i < d.length; i++) worst = Math.max(worst, turnOf(d[i - 1].yaw, d[i].yaw));
    // The inner ring (r 2.4) turns 0.5 / 2.4 ≈ 12° a domino; anything more is a kink in the path.
    assert.ok(worst < 0.25, `the sharpest turn between two dominoes ${(worst * 180 / Math.PI).toFixed(1)}° for ${JSON.stringify(c)}`);
  }
});

test('dragging the head a little moves the lead-in only: the spiral stays where it was', () => {
  const a = pathPoints(shipped.head, shipped.bend, shipped.center);
  const b = pathPoints({ x: shipped.head.x - 3, z: shipped.head.z + 2 }, shipped.bend, shipped.center);
  const tail = (p) => p.slice(-200).map((q) => [q.x.toFixed(6), q.z.toFixed(6)].join());
  assert.deepEqual(tail(b), tail(a));
  assert.deepEqual(entry({ x: shipped.head.x - 3, z: shipped.head.z + 2 }, shipped.bend, shipped.center), entry(shipped.head, shipped.bend, shipped.center), 'the same joint and winding');
  const far = layDominoes({ x: -200, z: 0 }, { x: -100, z: 0 }, shipped.center, GAP);
  assert.equal(far.length, MAX_DOMINOES, 'a very long lead-in stops at MAX_DOMINOES');
});

test('a domino touches the next one at the angle the geometry says', () => {
  // Standing next one: the top front corner travels h·sin θ and meets the back face gap − t away.
  assert.ok(Math.abs(touchAt(0, 1, 0.16, 0.5) - Math.asin(0.34)) < 1e-12);
  // Leaning on one lying flat: it stops short of flat by its thickness.
  assert.ok(Math.abs(touchAt(Math.PI / 2, 1, 0.16, 0.5) - (Math.PI / 2 - Math.asin(0.16))) < 1e-12);
});

/** The whole fall of the shipped line at height h: when half and all are down (s after the push). */
function fall(h, n) {
  const line = makeLine(n, { h, t: num('THICK'), gap: GAP, g: num('G') });
  line.push(0, 4);
  let t = 0, half = null, all = null;
  const dt = 1 / 240;
  while (t < 60) {
    line.step(dt);
    t += dt;
    const f = line.fallen();
    if (half === null && f >= n / 2) half = t;
    if (f === n) { all = t; break; }
  }
  return { half, all, th: Array.from(line.th) };
}

test('the fall: every domino goes down, the same way every run, and taller ones fall another way', () => {
  const n = layDominoes(shipped.head, shipped.bend, shipped.center, GAP).length;
  const h = num('DOMINO_HEIGHT');
  assert.equal(h, 1, 'game.js ships DOMINO_HEIGHT = 1.0 (the number the ask doubles)');
  const a = fall(h, n);
  assert.ok(a.all, 'all of them fall');
  assert.ok(a.th.every((x) => Number.isFinite(x) && x >= 0 && x <= Math.PI / 2 + 1e-9), 'every tilt between standing and flat');
  // The paused moment's second (starter.json try.pauseAt) is about half down: the ball hits ~1.3 s after Play.
  const pauseAt = JSON.parse(readFileSync(join(DIR, 'starter.json'), 'utf8')).try.pauseAt;
  assert.ok(Math.abs(a.half + 1.3 - pauseAt) < 1.2, `half down ${a.half.toFixed(2)} s after the hit, pauseAt ${pauseAt}`);
  assert.ok(a.all > 10 && a.all < 25, `all down in ${a.all.toFixed(1)} s (a 10-second clip holds the best half)`);
  assert.deepEqual(fall(h, n).th, a.th, 'the same run twice: the same tilts');
  const tall = fall(h * 2, n);
  assert.ok(tall.all && Math.abs(tall.half - a.half) > 1, `twice as tall: half down at ${tall.half.toFixed(2)} s, not ${a.half.toFixed(2)} s`);
});

test('the starter: on the shelf third, with its three tries, and copied without its picture', async () => {
  const meta = JSON.parse(readFileSync(join(DIR, 'starter.json'), 'utf8'));
  assert.equal(meta.order, 3);
  assert.equal(meta.try.move, 'head');
  assert.match(GAME, /marker\('head'/, 'the try\'s `move` is a placed point of the game');
  assert.equal(meta.try.ask.en, 'Make the dominoes twice as tall.');
  assert.deepEqual(Object.keys(meta.try.ask), ['en'], 'only English in starter.json');
  const words = JSON.parse(readFileSync(join(DIR, 'strings.json'), 'utf8'));
  assert.ok(words.ja?.try?.ask && words.ja?.blurb, 'the ask and the blurb in Japanese, in strings.json');
  const list = await readStarters(join(PKG, 'starters'));
  const s = list.find((x) => x.id === 'domino-spiral');
  assert.ok(s && s.dim === '3d' && s.thumb, 'listed as a 3D starter with its thumb');
  assert.equal(list.filter((x) => x.dim === '3d')[0].id, 'big-swell', '"3d" still picks Big Swell (order 0)');
  const files = await starterFiles(DIR);
  assert.deepEqual(files.filter((f) => /thumb|starter\.json|README/.test(f)), [], 'no picker files in the game');
  for (const f of ['index.html', 'game.js', 'js/path.js', 'js/topple.js', 'studio-placement.js']) assert.ok(files.includes(f), f);
  // No asset files: everything is drawn by code, three comes from the CDN (the shelf's rule).
  assert.deepEqual(files.filter((f) => !/\.(html|js)$/.test(f)), []);
  assert.equal(readFileSync(join(DIR, 'studio-placement.js'), 'utf8'), readFileSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), 'utf8'), 'the loader copy is current');
});

test('the stand-in AI: "twice as tall" doubles DOMINO_HEIGHT in one place, nothing on other games', () => {
  assert.ok(SHELF_FIXES.some((r) => r.id === 'domino-spiral'));
  const root = mkdtempSync(join(tmpdir(), 'domino-fix-'));
  try {
    cpSync(DIR, root, { recursive: true });
    const r = shelfFix(root, { lang: 'en' });
    assert.deepEqual(r.files, ['game.js']);
    assert.match(r.note, /twice as tall \(DOMINO_HEIGHT 1\.0 → 2\.0\)/);
    const after = readFileSync(join(root, 'game.js'), 'utf8');
    assert.match(after, /const DOMINO_HEIGHT = 2\.0;/);
    const changed = GAME.split('\n').filter((l, i) => l !== after.split('\n')[i]);
    assert.equal(changed.length, 1, 'one line changed');
    // Another game (a copy: shelfFix writes when it knows a game, so never the shipped folder; Lantern Cove has its own
    // row since 2026-11-06, so the plain example yard stands for "another game").
    const other = mkdtempSync(join(tmpdir(), 'domino-other-'));
    try {
      cpSync(join(PKG, 'examples/three-crates'), other, { recursive: true });
      assert.equal(shelfFix(other, { lang: 'en' }), null, 'another game: no fix');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
