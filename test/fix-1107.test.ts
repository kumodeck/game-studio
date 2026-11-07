// studio-fix-1107 (2026-11-07): four small fixes found while taking the launch pictures and testing ● Clip, the parts
// that can be checked without a browser. The screens themselves (before / after) were checked in a headless browser.
//   1. Ideas for your AI (the plate over the game, PC): its head hid nothing — scrolled rows showed through
//      "‹ Close · Ideas for your AI".
//   2. The first pause's line "Next frame . · ⚑ Make this a checkpoint" covered Neon Run's ⚠ BOSS at 1016 px.
//   3. Lantern Cove's "Try asking" answer (the stand-in AI's three lighthouses) put all three outside the opening camera.
//   4. The web demo's build stopped at "marble-rain/index.html still loads from a CDN" (Phaser from a classic <script>).
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stepTipPlace, STEP_TIP_LOW, STEP_TIP_MID, STEP_TIP_TOP } from '../src/shell/moment.ts';
import { lighthouseSpots, planFor } from './ai-feel/fake-agent.mjs';
import { CDN, classicScriptsToVendor } from '../scripts/web-demo-cdn.mjs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------- 1. the Ideas plate's head
test('1: the Ideas plate\'s head is the plate\'s glass (twice), edge to edge and at the very top', () => {
  const css = read('src/shell/shell.css');
  const rule = /\.page-window-plate \.page-head \{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the rule is there');
  const body = rule[1];
  assert.doesNotMatch(body, /background:\s*transparent/, 'not clear any more');
  assert.match(body, /background-color:\s*var\(--glass-thick\)/);
  assert.match(body, /background-image:\s*linear-gradient\(var\(--glass-thick\),\s*var\(--glass-thick\)\)/, 'laid twice: 94 % alone let words through');
  // The plate's padding (8 top, 16 sides) is what the head takes back, so no row shows above it or at its sides.
  const plate = /\.page-window-plate \{[^}]*padding:\s*(\d+)px (\d+)px/.exec(css);
  assert.ok(plate);
  const [top, side] = [Number(plate[1]), Number(plate[2])];
  assert.match(body, new RegExp(`top:\\s*-${top}px`));
  assert.match(body, new RegExp(`margin:\\s*-${top}px -${side}px 0`));
  assert.match(body, new RegExp(`padding:\\s*${4 + top}px ${side}px 8px`), 'the words stay where they were (4 px + the plate\'s 8)');
});

// ---------------------------------------------------------------- 2. the first pause's line and a centred banner
// The editor at 1016 × 608 and 1280 × 800 as measured in the headless browser (11/7): the stage from 8 px, ▶| and ⚑
// 28 px wide at 433 and 513, the pill 247 px wide. Neon Run's ⚠ BOSS: centred in the game, 134 px wide, 14–50 px down.
const STEP = { left: 433, width: 28 }, FLAG = { left: 513, width: 28 }, PILL = 247;
const boss = (stageW: number) => ({ l: stageW / 2 - 67, r: stageW / 2 + 67, t: 14, b: 50 });
const covers = (p: { left: number; top: number }, b: ReturnType<typeof boss>) => p.left < b.r && p.left + PILL > b.l && p.top < b.b && p.top + 27 > b.t;

test('2: at 1016 px the pill hangs under the game\'s top row, its arrows still under ▶| and ⚑', () => {
  const p = stepTipPlace({ left: 8, width: 1000 }, STEP, FLAG, PILL);
  assert.equal(p.top, STEP_TIP_LOW);
  assert.equal(covers(p, boss(1000)), false, 'off ⚠ BOSS');
  assert.equal(p.left, 513 + 28 + 10 - 8 - PILL, 'its right end just past ⚑\'s, as before');
  assert.equal(p.two, true);
  // The arrows (10 px squares, 5 px either side of the button's middle).
  assert.equal(p.left + 8 + p.a1 + 5, 433 + 14);
  assert.equal(p.left + 8 + p.a2 + 5, 513 + 14);
  // Without the fix it covered it: the same pill at the top.
  assert.equal(covers({ left: p.left, top: STEP_TIP_TOP }, boss(1000)), true, 'the bug');
});

test('2: at 1280 px and wider the pill stays at the top (it ends left of the middle)', () => {
  for (const w of [1264, 1424, 1904]) {
    const p = stepTipPlace({ left: 8, width: w }, STEP, FLAG, PILL);
    assert.equal(p.top, STEP_TIP_TOP, `${w}`);
    assert.equal(covers(p, boss(w)), false, `${w}`);
  }
});

test('2: without ⚑ the pill starts under ▶| (one arrow); the band rule is the same', () => {
  const p = stepTipPlace({ left: 8, width: 1264 }, STEP, null, 120);
  assert.equal(p.two, false);
  assert.equal(p.left, Math.round(433 + 14 - 8 - 19));
  assert.equal(p.top, STEP_TIP_TOP);
  // A pill that reaches into the middle band, even by a pixel, goes down.
  const c = 600, edge = { left: 0, width: c * 2 };
  assert.equal(stepTipPlace(edge, { left: c - STEP_TIP_MID - 28, width: 28 }, null, 100).top, STEP_TIP_LOW);
  assert.equal(stepTipPlace(edge, { left: c - STEP_TIP_MID - 200, width: 28 }, null, 100).top, STEP_TIP_TOP);
});

// ---------------------------------------------------------------- 3. Lantern Cove's three lighthouses
// terrain.js's height() (the module imports three.js for its texture; height itself needs nothing) and main.js's two
// opening cameras, read from the files so the test follows the sample.
const terrain = read('starters/lantern-cove/js/terrain.js');
const fnText = terrain.slice(terrain.indexOf('function hash2'), terrain.indexOf('/**\n * The height field'));
const sea = /const SEA_FLOOR = (-?[\d.]+);/.exec(terrain)![1];
const height = new Function(`const SEA_FLOOR = ${sea};\n${fnText.replace(/export /g, '')}\nreturn height;`)() as (x: number, z: number) => number;
const main = read('starters/lantern-cove/js/main.js');
const v3 = (name: string, which: string) => {
  const m = new RegExp(`const ${name} = \\{ pos: new THREE\\.Vector3\\(([^)]*)\\), look: new THREE\\.Vector3\\(([^)]*)\\) \\}`).exec(main);
  assert.ok(m, `${name} camera in main.js`);
  return (which === 'pos' ? m[1] : m[2]).split(',').map(Number) as [number, number, number];
};
const FOV = /camera\.fov = camera\.aspect < 1 \? (\d+) : (\d+);/.exec(main)!;
type V = [number, number, number];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V): V => { const l = Math.hypot(...a); return [a[0] / l, a[1] / l, a[2] / l]; };
/** The point in the camera's frame: [-1, 1] on both axes is in view. */
function ndc(cam: { pos: V; look: V; fov: number; aspect: number }, p: V): [number, number] {
  const f = norm(sub(cam.look, cam.pos)), r = norm(cross(f, [0, 1, 0])), u = cross(r, f);
  const d = sub(p, cam.pos), z = dot(d, f), t = Math.tan((cam.fov * Math.PI) / 360);
  return [dot(d, r) / z / t / cam.aspect, dot(d, u) / z / t];
}
const LIGHTHOUSE_H = 12.6; // the main lighthouse's height to its top (props.js: the brass ball at 12.6)

test('3: every stand-in lighthouse stands on land, inside the opening camera that asked (both edges, foot and top)', () => {
  const wide = { pos: v3('LANDSCAPE', 'pos'), look: v3('LANDSCAPE', 'look'), fov: Number(FOV[2]) };
  const tall = { pos: v3('PORTRAIT', 'pos'), look: v3('PORTRAIT', 'look'), fov: Number(FOV[1]) };
  const cases = [
    // The editor's game frame at 1016 × 608 is about 4:3 (760 × 556), wider screens up to 16:9 and past it.
    ...[1.33, 1.6, 1.78, 2.0].map((aspect) => ({ cam: { ...wide, aspect }, view: { eye: wide.pos } })),
    // A portrait phone: 390 × 844 less the bars, about 0.46.
    ...[0.46, 0.56].map((aspect) => ({ cam: { ...tall, aspect }, view: { eye: tall.pos } })),
  ];
  for (const { cam, view } of cases) {
    const spots = lighthouseSpots(view);
    assert.equal(spots.length, 3);
    for (const [key, x, z, s] of spots) {
      const h = height(x, z);
      assert.ok(h > 1, `${key}: on land (${h.toFixed(1)} m)`);
      const foot = ndc(cam, [x, h, z]), top = ndc(cam, [x, h + LIGHTHOUSE_H * s, z]);
      for (const [nx, ny] of [foot, top]) {
        assert.ok(Math.abs(nx) < 0.9 && Math.abs(ny) < 0.9, `${key} at aspect ${cam.aspect}: in view (${nx.toFixed(2)}, ${ny.toFixed(2)})`);
      }
    }
    assert.equal(new Set(spots.map((sp) => sp[0])).size, 3, 'three names');
  }
  // No view in the ask (an old request): the wide camera's spots.
  assert.deepEqual(lighthouseSpots(null), lighthouseSpots({ eye: wide.pos }));
});

test('3: the stand-in writes the spots of the camera that asked into the game', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'fix1107-cove-'));
  try {
    cpSync(new URL('../starters/lantern-cove', import.meta.url), tmp, { recursive: true });
    const plan = planFor(tmp, 'en', { eye: [-4, 4.6, 36] });
    for (const step of plan.steps) step();
    const out = readFileSync(join(tmp, 'js/main.js'), 'utf8');
    assert.ok(out.includes(JSON.stringify(lighthouseSpots({ eye: [-4, 4.6, 36] }))), 'the portrait spots');
    assert.equal(plan.changed, 3);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- 4. Marble Rain's Phaser in the web demo
test('4: a classic <script src> from jsDelivr points at vendor/ (Marble Rain\'s Phaser); nothing else changes', () => {
  const html = read('starters/marble-rain/index.html');
  const { html: out, urls } = classicScriptsToVendor(html, '../../');
  assert.deepEqual(urls, ['https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js']);
  assert.ok(CDN.test(urls[0]));
  assert.match(out, /<script src="\.\.\/\.\.\/vendor\/phaser@3\.80\.1\/dist\/phaser\.min\.js"><\/script>/);
  assert.doesNotMatch(out, /https?:\/\/cdn\./, 'the build\'s own check passes');
  assert.match(out, /<script type="module" src="game\.js"><\/script>/, 'the game\'s own module is left alone');
  // The sample itself keeps its CDN line (what --starter copies into a person's folder).
  assert.match(html, /https:\/\/cdn\.jsdelivr\.net\/npm\/phaser@3\.80\.1/);
  // Another origin is left as it is (the build then stops on it, as before), and so is a page without one.
  const other = '<script src="https://example.invalid/x.js"></script>';
  assert.deepEqual(classicScriptsToVendor(other, '../').urls, []);
  assert.equal(classicScriptsToVendor(other, '../').html, other);
  const lantern = read('starters/lantern-cove/index.html');
  assert.equal(classicScriptsToVendor(lantern, '../../').html, lantern, 'an import map page: untouched here');
});
