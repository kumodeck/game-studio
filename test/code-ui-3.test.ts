// The canvas UI's stage 3 (studio-canvas-ui-3, 2026-10-24; CONTRACT.md §1.13): the loader's onChange (once now, again
// only when the box or the look changed, a new codeUi() starts with none), `size` as the engine's object (its
// getBounds() with its own scale taken out — no growth loop), the sample shown on a Text object while the editor holds
// the game, codeTheme() (getters, the file's `theme`, the editor's value, onChange) and var(--x) looks; the bridge's
// theme rows (code-theme.ts) one list with the CSS variables'; the HTML UI's edges (ui-edge.ts edgeOf, the file's
// `from` / `at` for an HTML element in ui-layer.ts withLooks); the AI's `ui.theme` (read, and --clear with no editor).
// The game page side (Phaser / Pixi in the editor, the Theme rows, the line while an HTML element is dragged) is
// test/studio-canvas-ui.browser.mjs --only phaser,pixi,theme,edges.
// Run: node --experimental-strip-types --no-warnings --test test/code-ui-3.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPlacement, codeTheme, codeUi } from '../src/loader/studio-placement.js';
import { applyHandsToFile, readHandsInput } from '../src/schema/hands.mjs';
import { withLooks } from '../src/shell/ui-layer.ts';
import { edgeOf } from '../src/bridge/ui-edge.ts';
import { mergeThemeVars } from '../src/bridge/code-theme.ts';
import type { UiEdgeInfo, UiThemeVar } from '../src/contract.ts';

const LIST = Symbol.for('game-studio.codeUis');
const FILE = Symbol.for('game-studio.codeUiFile');
const THEMES = Symbol.for('game-studio.codeThemes');
const THEME_FILE = Symbol.for('game-studio.codeThemeFile');
const g = globalThis as unknown as Record<string | symbol, unknown>;
const canvasOf = (cw: number, ch: number, w = cw, h = ch) => ({ clientWidth: cw, clientHeight: ch, width: w, height: h, getBoundingClientRect: () => ({ left: 0, top: 0, width: cw, height: ch, right: cw, bottom: ch }) });
const fresh = () => {
  (g[LIST] as Map<string, unknown> | undefined)?.clear();
  (g[THEMES] as Map<string, unknown> | undefined)?.clear();
  g[FILE] = new Map();
  g[THEME_FILE] = new Map();
};
/** A Phaser-like text: position, scale, its words, and getBounds() in the scaled size (as engines answer). */
const textObj = (w0: number, h0: number) => {
  const o = {
    x: 0, y: 0, scaleX: 1, scaleY: 1, text: '', w0, h0,
    setPosition(x: number, y: number) { (o.x = x), (o.y = y); return o; },
    setScale(s: number) { (o.scaleX = s), (o.scaleY = s); return o; },
    setText(t: string) { o.text = t; o.w0 = t ? t.length * 10 : 0; return o; },
    getBounds() { return { x: o.x, y: o.y, width: o.w0 * o.scaleX, height: o.h0 * o.scaleY }; },
  };
  return o;
};

test('onChange: once now, again only when the box or the look changes; the object\'s own scale is taken out of size', () => {
  fresh();
  const c = canvasOf(390, 844);
  const hud = textObj(80, 24);
  const ui = codeUi('distance', { at: { from: 'top-right', x: 16, y: 20 }, size: hud, units: 'canvas', look: { fontSize: 22, color: '#2b1d3a' }, canvas: c });
  const calls: Array<[number, number, number, string]> = [];
  ui.onChange((b, L) => {
    hud.setPosition(b.x, b.y).setScale(b.s);
    calls.push([b.x, b.y, b.s, String(L.color)]);
  });
  assert.deepEqual(calls, [[390 - 16 - 80, 20, 1, '#2b1d3a']], 'once at once, from the right edge');
  const e = (g[LIST] as Map<string, { poke(): boolean; live: unknown }>).get('distance')!;
  assert.equal(e.poke(), false, 'nothing changed: not called');
  // The editor makes it 1.5 times as big: called once, and its size read at scale 1 (no growth on the next poke).
  e.live = { p: [0, 0], s: 1.5, state: null, sample: null };
  assert.equal(e.poke(), true);
  assert.equal(calls.at(-1)![2], 1.5);
  assert.equal(ui.box().w, 120, 'the box is 80 × 1.5, not 80 × 1.5 × 1.5');
  assert.equal(e.poke(), false, 'and stays so');
  // A new round's codeUi() (new objects): none of the old onChange.
  codeUi('distance', { at: { from: 'top-right', x: 16, y: 20 }, size: textObj(80, 24), units: 'canvas', canvas: c });
  const n = calls.length;
  (g[LIST] as Map<string, { poke(): boolean }>).get('distance')!.poke();
  assert.equal(calls.length, n, 'the old function is not called for the new codeUi');
});

test('a sample on a Text object while the editor holds the game: shown on it, its own words back after', () => {
  fresh();
  const hud = textObj(0, 24);
  codeUi('score', { kind: 'text', at: { from: 'top-left', x: 16, y: 16 }, size: hud, sample: '9,999 m', canvas: canvasOf(800, 600) });
  const e = (g[LIST] as Map<string, { poke(): boolean; live: unknown; box(): { w: number } }>).get('score')!;
  e.live = { p: [0, 0], s: 1, state: null, sample: '9,999 m' };
  e.poke();
  assert.equal(hud.text, '9,999 m');
  assert.equal(e.box().w, 70, 'the box follows the words shown');
  e.live = { p: [0, 0], s: 1, state: null, sample: null };
  e.poke();
  assert.equal(hud.text, '', 'its own (empty) words back');
});

test('codeTheme: getters (the editor\'s, else the file\'s, else the code\'s), onChange, and a look of var(--x)', async () => {
  fresh();
  const T = codeTheme({ accent: { v: '#ffcf6e', label: 'Accent' }, ink: '#2b1d3a', 'font-title': { v: 'ui-serif, Georgia' } });
  assert.equal(T.accent, '#ffcf6e');
  const list = g[THEMES] as Map<string, { name: string; label: string | null; type: string; live: string | null }>;
  assert.deepEqual([...list.values()].map((e) => [e.name, e.label, e.type]), [['--accent', 'Accent', 'color'], ['--ink', null, 'color'], ['--font-title', null, 'font']]);
  const seen: string[] = [];
  T.onChange((v: Record<string, string>) => seen.push(v.accent));
  assert.deepEqual(seen, ['#ffcf6e'], 'once at once');
  const score = codeUi('score', { at: { from: 'top-left', x: 0, y: 0 }, size: [100, 20], look: { color: 'var(--accent)', background: 'var(--none, #101010)' }, canvas: canvasOf(800, 600) });
  assert.deepEqual([score.look().color, score.look().background], ['#ffcf6e', '#101010'], 'var() read, and a fallback');
  // The file (until Save) and then the editor's value.
  await applyPlacement(document0(), { version: 1, tool: 'placement', dim: '2d', space: 'local', objects: {}, theme: { '--accent': { v: '#7fd1ff', was: '#ffcf6e' } } });
  assert.equal(T.accent, '#7fd1ff');
  assert.equal(score.look().color, '#7fd1ff', 'the part follows the theme');
  assert.deepEqual(seen, ['#ffcf6e', '#7fd1ff'], 'onChange told when the file came');
  list.get('--accent')!.live = '#ff8fb1';
  assert.equal(T.accent, '#ff8fb1');
  const subs = g[Symbol.for('game-studio.codeThemeSubs')] as Set<{ poke(): boolean }>;
  for (const s of subs) s.poke();
  assert.equal(seen.at(-1), '#ff8fb1');
  // The person's own colour for that one part wins over the theme.
  (g[LIST] as Map<string, { live: unknown }>).get('score')!.live = { p: [0, 0], s: 1, state: null, sample: null, set: { color: '#ffffff' } };
  assert.equal(score.look().color, '#ffffff');
});

/** applyPlacement(document, …) with no DOM: the theme and the canvas UI's file only (a stand-in document). */
function document0() {
  return { nodeType: 9 } as unknown as Document;
}

test('the Theme: the CSS variables and the codeTheme as one list (the same name is one row, with the code\'s label)', () => {
  const css: UiThemeVar[] = [{ name: '--glow', type: 'color', value: '#ffcf6e', was: '#ffcf6e' }, { name: '--accent', type: 'color', value: '#111111', was: '#111111' }];
  const code: UiThemeVar[] = [{ name: '--accent', type: 'color', value: '#222222', was: '#222222', label: 'Accent' }, { name: '--ink', type: 'color', value: '#2b1d3a', was: '#2b1d3a', label: 'Ink' }];
  assert.deepEqual(mergeThemeVars(css, code).map((v) => [v.name, v.value, v.label ?? null]), [['--glow', '#ffcf6e', null], ['--accent', '#111111', 'Accent'], ['--ink', '#2b1d3a', 'Ink']]);
  assert.deepEqual(mergeThemeVars([], code), code);
});

test('the HTML UI\'s edges: the nearest of the 9 places of the window; the file\'s from / at only when it moved', () => {
  assert.deepEqual(edgeOf({ x: 1280 - 16 - 120, y: 24, w: 120, h: 40 }, 1280, 800), { from: 'top-right', at: [16, 24] });
  assert.deepEqual(edgeOf({ x: 640 - 100, y: 20, w: 200, h: 30 }, 1280, 800), { from: 'top', at: [0, 20] });
  assert.deepEqual(edgeOf({ x: 600, y: 380, w: 80, h: 40 }, 1280, 800), { from: 'center', at: [0, 0] });
  const edges = new Map<string, UiEdgeInfo>([['pause', { key: 'pause', from: 'top-right', at: [16, 24], box: [1144, 24, 120, 40], frame: [1280, 800] }], ['title', { key: 'title', from: 'top', at: [0, 80], box: [440, 80, 400, 60], frame: [1280, 800] }]]);
  const out = withLooks({ pause: { p: [900, 0] } }, { title: { set: { color: '#ffffff' }, setWas: { color: '#000000' } } }, new Map(), new Map(), new Map(), edges);
  assert.deepEqual(out.pause, { p: [900, 0], from: 'top-right', at: [16, 24] }, 'moved: where it keeps to');
  assert.deepEqual(out.title, { p: [0, 0], set: { color: '#ffffff' }, setWas: { color: '#000000' } }, 'a look alone: no edge (its CSS place stays)');
  // With no edges said (an older page), the bytes are the same as before.
  assert.equal(JSON.stringify(withLooks({ pause: { p: [900, 0] } }, {}, new Map(), new Map())), JSON.stringify({ pause: { p: [900, 0] } }));
});

test('the AI\'s ui.theme: read (a name with or without --, v or clear alone); with no editor, clear takes it out of the file', () => {
  const ok = readHandsInput([{ do: 'ui.theme', id: 'accent', v: ' #7fd1ff ' }, { do: 'ui.theme', id: '--glow', clear: true }]) as { ops: Array<Record<string, unknown>>; errors?: string[] };
  assert.ok(!ok.errors?.length, JSON.stringify(ok));
  assert.deepEqual(ok.ops.map((o) => [o.id, o.v ?? null, o.clear ?? null]), [['--accent', '#7fd1ff', null], ['--glow', null, true]]);
  for (const bad of [{ do: 'ui.theme', id: 'accent' }, { do: 'ui.theme', id: 'accent', v: 'red;}', }, { do: 'ui.theme', id: '9x', clear: true }, { do: 'ui.theme', id: 'a', v: '#fff', clear: true }]) {
    const r = readHandsInput([bad]) as { errors?: string[] };
    assert.ok(r.errors?.length, `refused: ${JSON.stringify(bad)}`);
  }
  const file = { version: 1, tool: 'placement', dim: '2d', space: 'local', objects: {}, theme: { '--accent': { v: '#7fd1ff', was: '#ffcf6e' } } };
  const r = applyHandsToFile(file, [{ do: 'ui.theme', id: '--accent', clear: true }, { do: 'ui.theme', id: '--accent', v: '#000000' }]);
  assert.equal(r.file.theme, undefined, 'out of the file');
  assert.equal(r.results[0].ok, true);
  assert.match(r.results[0].said, /took the theme's --accent out of placement\.json/);
  assert.equal(r.results[1].ok, false, 'a new value needs the editor (or the code)');
});
