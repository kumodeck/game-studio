// The UI drawn in the canvas (studio-canvas-ui stage 1, 2026-10-24; CONTRACT.md §1.13): the loader's codeUi() — measured
// from the 9 places, in CSS px or the canvas's own px, the file's `from` / `at` read at draw time, the editor's offset and
// size keeping its middle, hit() (a box and a circle), value() with the editor's samples — the bridge's port (a key an
// HTML element takes is not listed), the file's `code` / `from` / `at` (validator, ui-layer.ts withLooks: HTML-only files
// keep their bytes) and the AI's ops (`ui.code` / `ui.set`, with and without the editor).
// The game page side (the frame, the card, one frame drawn, the 40 px check, ⌘Z, Play, Save) is
// test/studio-canvas-ui.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/code-ui.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlacement, codeUi, uiAtOf, uiBoxAt, uiNearest, UI_FROMS } from '../src/loader/studio-placement.js';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
import { applyHandsToFile, readHandsInput } from '../src/schema/hands.mjs';
import { withLooks } from '../src/shell/ui-layer.ts';
import { createCodeUi } from '../src/bridge/code-ui.ts';
import type { CodeUiInfo, PlacementUiEntry } from '../src/contract.ts';

const LIST = Symbol.for('game-studio.codeUis');
const FILE = Symbol.for('game-studio.codeUiFile');
const g = globalThis as unknown as Record<string | symbol, unknown>;
/** A canvas as the loader reads it: its CSS size and its own pixels. */
const canvasOf = (cw: number, ch: number, w = cw, h = ch) => ({ clientWidth: cw, clientHeight: ch, width: w, height: h, getBoundingClientRect: () => ({ left: 0, top: 0, width: cw, height: ch, right: cw, bottom: ch }) });
const fresh = () => {
  (g[LIST] as Map<string, unknown> | undefined)?.clear();
  g[FILE] = new Map();
};
const base = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {} } as const;
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('codeUi: box() from each of the 9 places, inward; uiAtOf is its inverse; uiNearest picks the closest place', () => {
  fresh();
  const c = canvasOf(800, 600);
  const want: Record<string, [number, number]> = {
    'top-left': [24, 18], top: [400 + 24 - 50, 18], 'top-right': [800 - 24 - 100, 18],
    left: [24, 300 + 18 - 20], center: [400 + 24 - 50, 300 + 18 - 20], right: [800 - 24 - 100, 300 + 18 - 20],
    'bottom-left': [24, 600 - 18 - 40], bottom: [400 + 24 - 50, 600 - 18 - 40], 'bottom-right': [800 - 24 - 100, 600 - 18 - 40],
  };
  for (const from of UI_FROMS) {
    const h = codeUi(`t-${from}`, { at: { from, x: 24, y: 18 }, size: [100, 40], canvas: c });
    const b = h.box();
    assert.deepEqual([b.x, b.y, b.w, b.h, b.s], [...want[from]!, 100, 40, 1], from);
    assert.deepEqual(uiAtOf(from, b.x, b.y, b.w, b.h, 800, 600), [24, 18], `${from}: back to its numbers`);
    assert.deepEqual(uiBoxAt(from, 24, 18, 100, 40, 800, 600), want[from], `${from}: uiBoxAt`);
  }
  assert.equal(uiNearest(390, 10, 20, 20, 800, 600), 'top');
  assert.equal(uiNearest(770, 560, 20, 20, 800, 600), 'bottom-right');
  assert.equal(uiNearest(10, 290, 20, 20, 800, 600), 'left');
  // A size that changes (a text measured each frame) and a square.
  let w = 50;
  const t = codeUi('grow', { at: { from: 'top-right', x: 10, y: 10 }, size: () => [w, 20], canvas: c });
  assert.equal(t.box().x, 800 - 10 - 50);
  w = 80;
  assert.equal(t.box().x, 800 - 10 - 80, 'the box follows the measured width');
  assert.deepEqual([codeUi('sq', { size: 72, canvas: c }).box().w, codeUi('sq', { size: 72, canvas: c }).box().h], [72, 72]);
});

test('codeUi: units — css (the game draws after ctx.scale(dpr)) or the canvas\'s own pixels', () => {
  fresh();
  const c = canvasOf(800, 600, 1600, 1200);
  const css = codeUi('css', { at: { from: 'bottom-right', x: 24, y: 24 }, size: 72, canvas: c });
  assert.deepEqual([css.box().x, css.box().y], [800 - 96, 600 - 96], 'css: the canvas is 800 × 600');
  const px = codeUi('px', { at: { from: 'bottom-right', x: 48, y: 48 }, size: 144, canvas: c, units: 'canvas' });
  assert.deepEqual([px.box().x, px.box().y], [1600 - 192, 1200 - 192], 'canvas: 1600 × 1200');
  // The editor's offsets are CSS px: 10 CSS px = 20 of the canvas's.
  const e = (g[LIST] as Map<string, { live: unknown }>).get('px')!;
  e.live = { p: [10, 0], s: 1, state: null, sample: null };
  assert.equal(px.box().x, 1600 - 192 + 20);
});

test('codeUi: the file — from / at place it on any canvas size; an offset with no from adds to the code\'s place', async () => {
  fresh();
  const small = canvasOf(800, 600), big = canvasOf(1600, 900);
  let c = small;
  const hp = codeUi('hp-bar', { at: { from: 'top-left', x: 16, y: 60 }, size: [214, 20], canvas: () => c });
  const sc = codeUi('score', { at: { from: 'top-left', x: 16, y: 12 }, size: [232, 40], canvas: () => c });
  assert.deepEqual([hp.box().x, hp.box().y], [16, 60], 'the code\'s place before any file');
  await applyPlacement(document0(), { ...base, ui: {
    'hp-bar': { code: 'hp-bar', p: [292.8, -40], s: 1.4, from: 'top', at: [0, 16] },
    score: { code: 'score', p: [4, 6] },
  } });
  // The bar: 1.4 × 214 wide, its middle on the canvas's middle, 16 px from the top — on both sizes.
  near(hp.box().w, 214 * 1.4, 'w');
  near(hp.box().x + hp.box().w / 2, 400, 'middle on 800');
  near(hp.box().y, 16, 'top');
  near(hp.box().s, 1.4, 's');
  c = big;
  near(hp.box().x + hp.box().w / 2, 800, 'middle on 1600: it keeps to the top middle');
  // The score: the code's place + the offset (a file written without from).
  c = small;
  assert.deepEqual([sc.box().x, sc.box().y], [20, 18]);
  // A file without the entry (the AI wrote it into the code): the code's place again.
  await applyPlacement(document0(), { ...base });
  assert.deepEqual([hp.box().x, hp.box().y, hp.box().w], [16, 60, 214]);
});

/** applyPlacement(document, …) with no DOM: a document that has no marked element. */
function document0() {
  return { nodeType: 9, querySelectorAll: () => [] } as unknown as Document;
}

test('codeUi: the editor\'s live offset and size — the middle stays where it is; the file\'s offset is where it starts', async () => {
  fresh();
  const c = canvasOf(800, 600);
  const h = codeUi('btn', { at: { from: 'top-left', x: 100, y: 100 }, size: [100, 50], canvas: c });
  const e = (g[LIST] as Map<string, { live: unknown }>).get('btn')!;
  e.live = { p: [10, -5], s: 2, state: null, sample: null };
  const b = h.box();
  assert.deepEqual([b.x + b.w / 2, b.y + b.h / 2, b.w, b.h, b.s], [160, 120, 200, 100, 2]);
  // With the file's from / at: live p is counted from the file's p (the place it had when editing began).
  e.live = null;
  await applyPlacement(document0(), { ...base, ui: { btn: { code: 'btn', p: [300, 0], from: 'top-right', at: [50, 100] } } });
  const f = h.box();
  assert.deepEqual([f.x, f.y], [800 - 50 - 100, 100]);
  e.live = { p: [300, 0], s: 1, state: null, sample: null };
  assert.deepEqual([h.box().x, h.box().y], [f.x, f.y], 'the same place when the editor starts from the file');
  e.live = { p: [320, 10], s: 1, state: null, sample: null };
  assert.deepEqual([h.box().x, h.box().y], [f.x + 20, f.y + 10]);
  await applyPlacement(document0(), { ...base });
});

test('codeUi: hit() — the box, a circle for a round button; value() — the editor\'s sample (a bar\'s as a number); look() / state()', () => {
  fresh();
  const c = canvasOf(800, 600);
  const btn = codeUi('jump', { kind: 'button', round: true, at: { from: 'bottom-right', x: 24, y: 24 }, size: 72, canvas: c,
    look: { text: 'JUMP', color: '#0b0b1a', background: '#56e3f5' }, states: { active: { background: '#2fb8d0' } } });
  const b = btn.box();
  assert.equal(btn.hit(b.x + 36, b.y + 36), true, 'the middle');
  assert.equal(btn.hit(b.x + 2, b.y + 2), false, 'a corner of the box is outside the circle');
  const sq = codeUi('pause', { kind: 'button', at: { from: 'top-right', x: 10, y: 10 }, size: [60, 30], canvas: c });
  assert.equal(sq.hit(800 - 10 - 59, 11), true, 'a box: its corner is inside');
  assert.equal(sq.hit(10, 10), false);
  const e = (g[LIST] as Map<string, { live: unknown }>).get('jump')!;
  assert.equal(btn.state(), null);
  assert.equal(btn.look().background, '#56e3f5');
  assert.equal(btn.look('active').background, '#2fb8d0', 'the game asks for its own pressed look');
  e.live = { p: [0, 0], s: 1, state: 'active', sample: null, set: { '@active': { background: '#ff8fb1' }, text: 'GO' } };
  assert.equal(btn.state(), 'active');
  assert.equal(btn.look().background, '#ff8fb1', 'the state the editor shows, with the person\'s colour');
  assert.equal(btn.look().text, 'GO');
  assert.equal(btn.look(null).background, '#56e3f5', 'the normal look when asked for none');
  const score = codeUi('score', { kind: 'text', canvas: c, size: [10, 10] });
  const bar = codeUi('hp', { kind: 'bar', canvas: c, size: [10, 10] });
  assert.equal(score.value(12480), 12480);
  (g[LIST] as Map<string, { live: unknown }>).get('score')!.live = { p: [0, 0], s: 1, state: null, sample: '999,999' };
  (g[LIST] as Map<string, { live: unknown }>).get('hp')!.live = { p: [0, 0], s: 1, state: null, sample: '0.5' };
  assert.equal(score.value(12480), '999,999');
  assert.equal(bar.value(0.7), 0.5);
});

test('codeUi: a bad id is said once and the handle still draws (the game never stops)', () => {
  fresh();
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (m: string) => said.push(m);
  try {
    const h = codeUi('Bad Id', { at: { x: 5, y: 6 }, size: [1, 1], canvas: canvasOf(10, 10) });
    assert.deepEqual([h.box().x, h.box().y], [5, 6]);
    assert.ok(!(g[LIST] as Map<string, unknown>).has('Bad Id'), 'not listed');
    assert.match(said.join('\n'), /codeUi\("Bad Id"\)/);
  } finally {
    console.warn = warn;
  }
});

test('the bridge\'s port: the codeUis listed top first; an id an HTML element\'s key takes is left out (the HTML one stays)', () => {
  fresh();
  const c = canvasOf(800, 600);
  codeUi('jump', { name: 'Jump', kind: 'button', at: { from: 'bottom-right', x: 24, y: 24 }, size: 72, canvas: c });
  codeUi('score', { name: 'スコア', kind: 'text', at: { from: 'top-left', x: 16, y: 12 }, size: [232, 40], canvas: c });
  codeUi('title', { name: 'Title', kind: 'text', at: { from: 'center', x: 0, y: 0 }, size: [300, 60], canvas: c });
  const posted: unknown[] = [];
  const info = console.info;
  console.info = () => {};
  try {
    const win = { innerWidth: 800, innerHeight: 600, document: { querySelectorAll: () => [] }, [LIST]: g[LIST], [FILE]: g[FILE] } as unknown as Window;
    const ui = createCodeUi({ win, core: { time: { frozen: true, step: () => true } } as never, post: (m) => posted.push(m), lang: () => 'en', redraw: () => null, domKeys: () => new Set(['title']) })!;
    const objs = ui.port.objects();
    assert.deepEqual(objs.map((o) => o.key), ['score', 'jump'], 'top first; "title" is the HTML element\'s');
    assert.deepEqual(objs[0]!.kinds, ['ui', 'text', 'named']);
    assert.equal(objs[0]!.label, 'スコア');
    assert.equal(objs[0]!.rotatable, false);
    // A move and a size through the port: the middle stays, the box grows.
    ui.port.set('score', { p: [10, 0], r: 0, s: 2 });
    const b = (g[LIST] as Map<string, { box(): { x: number; w: number } }>).get('score')!.box();
    assert.deepEqual([b.x + b.w / 2, b.w], [16 + 116 + 10, 464]);
    assert.deepEqual(ui.port.get('score'), { p: [10, 0], r: 0, s: 2 });
    // The card: the rows the look has, nothing else.
    const p = ui.props('score')!;
    assert.deepEqual([p.text, p.color, p.background, p.button], [null, null, null, false], 'no look given: no rows');
  } finally {
    console.info = info;
  }
});

test('the file: code / from / at read and checked; an HTML-only file keeps its bytes', () => {
  const r = validateStudioFile({ ...base, ui: { 'hp-bar': { code: 'hp-bar', p: [389.04, -40], s: 1.4, from: 'top', at: [0.04, 16] } } }) as { ok: boolean; value: { ui: Record<string, PlacementUiEntry> } };
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.ui['hp-bar'], { p: [389, -40], s: 1.4, code: 'hp-bar', from: 'top', at: [0, 16] });
  const bad = validateStudioFile({ ...base, ui: { a: { code: 'b', p: [0, 0] }, d: { code: 'd', p: [0, 0], from: 'middle', at: [1, 2] }, e: { p: [0, 0], from: 'top' } } }) as { ok: boolean; errors: string[] };
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('\n'), /ui\["a"\]\.code/);
  assert.match(bad.errors.join('\n'), /ui\["d"\]\.from: must be one of/);
  assert.match(bad.errors.join('\n'), /ui\["e"\]\.at: must be 2 numbers/);
  // Stage 3 (studio-canvas-ui-3): an HTML element's from / at (the nearest place of the window, for the AI's CSS on Save).
  const html3 = validateStudioFile({ ...base, ui: { c: { p: [300, 0], from: 'top-right', at: [16.04, 24] } } }) as { ok: boolean; value: { ui: Record<string, PlacementUiEntry> } };
  assert.ok(html3.ok, JSON.stringify(html3));
  assert.deepEqual(html3.value.ui.c, { p: [300, 0], from: 'top-right', at: [16, 24] });
  // withLooks: the codeUis' entries get code (and from / at when moved); HTML entries are exactly what they were.
  const moves = { title: { p: [0, -48] as [number, number], s: 1.2 }, 'hp-bar': { p: [10, 0] as [number, number] }, jump: { p: [0, 0] as [number, number] } };
  const looks = { jump: { set: { '@active': { background: '#ff8fb1' } }, setWas: { '@active': { background: '#2fb8d0' } } } };
  const html = withLooks({ title: moves.title }, {}, new Map(), new Map());
  const codes = new Map<string, CodeUiInfo>([['hp-bar', { key: 'hp-bar', name: 'HP', kind: 'bar', from: 'top', at: [0, 20], scale: 1, code: { from: 'top-left', x: 16, y: 60, scale: 1 }, look: [], box: [0, 0, 0, 0], size: [214, 20], frame: [800, 600, 1, 1] }],
    ['jump', { key: 'jump', name: 'Jump', kind: 'button', from: 'bottom-right', at: [24, 24], scale: 1, code: { from: 'bottom-right', x: 24, y: 24, scale: 1 }, look: ['background'], box: [0, 0, 0, 0], size: [72, 72], frame: [800, 600, 1, 1] }]]);
  const both = withLooks({ title: moves.title, 'hp-bar': moves['hp-bar'] }, looks, new Map(), new Map(), codes);
  assert.deepEqual(both.title, html.title, 'the HTML entry is the same');
  assert.deepEqual(JSON.stringify(withLooks({ title: moves.title }, {}, new Map(), new Map(), new Map())), JSON.stringify(html), 'no codeUi: the same bytes');
  assert.deepEqual(both['hp-bar'], { p: [10, 0], code: 'hp-bar', from: 'top', at: [0, 20] });
  assert.deepEqual(both.jump, { p: [0, 0], set: looks.jump.set, setWas: looks.jump.setWas, code: 'jump' }, 'a look alone keeps the code\'s place');
});

test('the AI\'s ops: ui.code / ui.set read; with no editor, clear takes the entry out and the rest is refused', () => {
  const r = readHandsInput('[{"do":"ui.code","id":"score,hp-bar"},{"do":"ui.set","id":"hp-bar","from":"top","p":[0,20],"s":1.4},{"do":"ui.set","id":"jump","set":{"@active":{"background":"#ff8fb1"}}},{"do":"ui.set","id":"hp-bar","clear":true}]');
  assert.ok(r.ok, JSON.stringify(r));
  // The read ops read again as they are (the CLI sends them to the editor, which reads them once more).
  assert.ok(readHandsInput(r.ops).ok, 'the read ops are valid input');
  for (const [ops, msg] of [
    ['{"do":"ui.code","id":"Score"}', /codeUi ids/],
    ['{"do":"ui.set","id":"x","clear":true,"p":[1,2]}', /"clear" alone/],
    ['{"do":"ui.set","id":"x","from":"top"}', /"from" goes with "p"/],
    ['{"do":"ui.set","id":"x","set":{"border":"red"}}', /the card's look/],
    ['{"do":"ui.set","id":"x"}', /needs one of/],
  ] as const) {
    const bad = readHandsInput(ops);
    assert.equal(bad.ok, false, ops);
    assert.match(bad.errors!.join('\n'), msg, ops);
  }
  const file = { ...base, ui: { 'hp-bar': { code: 'hp-bar', p: [3, 4] as [number, number] } }, uiView: [800, 600] as [number, number] };
  const out = applyHandsToFile(file, readHandsInput('[{"do":"ui.set","id":"hp-bar","clear":true},{"do":"ui.code","id":"hp-bar"},{"do":"ui.set","id":"hp-bar","p":[1,2]}]').ops);
  assert.equal(out.file.ui, undefined, 'the entry out, and uiView with it');
  assert.equal(out.file.uiView, undefined);
  assert.deepEqual(out.results.map((x: { ok: boolean }) => x.ok), [true, true, false]);
  assert.match(out.results[1].said, /no editor is open/);
  assert.match(out.results[2].error, /no editor is open: change hp-bar in the game's code directly/);
});
