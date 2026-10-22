// UI stages 2–3 (studio-ui-edit-2, 2026-10-22): placement.json `ui.<key>.screen / set / setWas` and `theme` — the
// validator, the shell's store of looks (src/shell/ui-style-model.ts), the file it writes (ui-layer.ts withLooks /
// withUi), undo, and the loader's theme. The game page side (screens shown, sample values, a button's look, the
// card) is test/studio-ui-edit-2.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/ui-edit-2.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
import { UiStyleModel, pathsOf, sameVal, setOf } from '../src/shell/ui-style-model.ts';
import { withLooks, withUi } from '../src/shell/ui-layer.ts';
import { UndoStack } from '../src/shell/undo.ts';
import type { PlacementFile } from '../src/contract.ts';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {} } as const;

// ----- the validator -----

test('schema: screen, set, setWas and theme are read, rounded and sorted (same content = same bytes)', () => {
  const file = {
    ...base,
    ui: { 'title-card': { p: [0, -40], screen: 'title', set: { text: 'Night Garden', fontSize: 64.04, color: '#ffd9a0', '@hover': { background: 'rgb(1, 2, 3)' } }, setWas: { text: 'Glow Garden', fontSize: 72, color: '#fff6d8' } } },
    theme: { '--glow': { v: '#ff9f6e', was: '#ffcf6e' }, '--font-ui': { v: 'Georgia, serif' } },
  };
  const r = validateStudioFile(file) as { ok: boolean; value: PlacementFile; json: string };
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.ui!['title-card']!.set, { text: 'Night Garden', fontSize: 64, color: '#ffd9a0', '@hover': { background: 'rgb(1, 2, 3)' } });
  assert.equal(r.value.ui!['title-card']!.screen, 'title');
  assert.deepEqual(r.value.theme, { '--font-ui': { v: 'Georgia, serif' }, '--glow': { v: '#ff9f6e', was: '#ffcf6e' } });
  assert.equal((validateStudioFile(JSON.parse(r.json)) as { json: string }).json, r.json);
});

test('schema: a file without screen / set / theme is what it was', () => {
  const f = { ...base, ui: { a: { p: [1, 2] } } };
  const r = validateStudioFile(f) as { ok: boolean; value: Record<string, unknown> };
  assert.ok(r.ok);
  assert.equal('theme' in r.value, false);
  assert.deepEqual((r.value.ui as Record<string, unknown>).a, { p: [1, 2] });
});

test('schema: bad looks and themes are refused (no CSS can get out of its declaration)', () => {
  const bad = (extra: Record<string, unknown>) => (validateStudioFile({ ...base, ...extra }) as { ok: boolean }).ok;
  assert.equal(bad({ ui: { a: { p: [0, 0], set: { color: 'red;background:url(x)' } } } }), false);
  assert.equal(bad({ ui: { a: { p: [0, 0], set: { color: 'url(javascript:x)' } } } }), false);
  assert.equal(bad({ ui: { a: { p: [0, 0], set: { fontSize: 0 } } } }), false);
  assert.equal(bad({ ui: { a: { p: [0, 0], set: { fontSize: 501 } } } }), false);
  assert.equal(bad({ ui: { a: { p: [0, 0], set: { text: 'x'.repeat(201) } } } }), false);
  assert.equal(bad({ ui: { a: { p: [0, 0], set: { '@focus': { color: '#fff' } } } } }), false);
  assert.equal(bad({ ui: { a: { p: [0, 0], set: { '@hover': { text: 'no' } } } } }), false);
  assert.equal(bad({ ui: { a: { p: [0, 0], screen: 'has space' } } }), false);
  assert.equal(bad({ ui: { a: { p: [0, 0], wrong: 1 } } }), false);
  assert.equal(bad({ theme: { accent: { v: '#fff' } } }), false);
  assert.equal(bad({ theme: { '--a': { v: 'red}body{color:red' } } }), false);
  assert.equal(bad({ theme: { '--a': { v: '<b>' } } }), false);
  assert.equal(bad({ theme: { '--a': '#fff' } }), false);
  assert.equal(bad({ ui: { a: { p: [0, 0], set: { color: '#abc', background: 'hsl(40 90% 70%)', '@disabled': { color: 'grey' } } } } }), true);
});

// ----- the shell's store of looks -----

test('model: paths ↔ the file shape', () => {
  const set = { text: 'A', color: '#fff', '@hover': { background: '#000' }, '@active': { color: '#111', background: '#222' } };
  const m = pathsOf(set);
  assert.deepEqual([...m.keys()].sort(), ['@active.background', '@active.color', '@hover.background', 'color', 'text']);
  assert.deepEqual(setOf(m), set);
  assert.ok(sameVal('#FFF', '#ffffff'));
  assert.ok(sameVal(72, 72.01));
  assert.ok(!sameVal('A', 'a'));
});

test('model: a change counts once per element, back to the game\'s value counts nothing, Save clears it', () => {
  const m = new UiStyleModel();
  m.noteWas('title-card', { text: 'Glow Garden', color: '#fff6d8', fontSize: 72 });
  assert.equal(m.dirty(), 0);
  m.set('title-card', 'text', 'Night Garden');
  m.set('title-card', 'color', '#ffd9a0');
  assert.equal(m.dirty(), 1, 'one element, one count');
  assert.deepEqual([...m.changedKeys()], ['title-card']);
  assert.deepEqual(m.entries(), { 'title-card': { set: { text: 'Night Garden', color: '#ffd9a0' }, setWas: { text: 'Glow Garden', color: '#fff6d8' } } });
  m.set('title-card', 'color', '#FFF6D8'); // the game's own again (another spelling)
  assert.equal(m.value('title-card', 'color'), undefined);
  m.markSaved();
  assert.equal(m.dirty(), 0);
  m.set('title-card', 'text', null);
  assert.equal(m.dirty(), 1, 'taking a saved change away is a change');
  assert.deepEqual(m.entries(), {});
});

test('model: the theme — was from the bridge, result only for changed variables, the file\'s was wins', () => {
  const m = new UiStyleModel();
  m.noteThemeWas('--glow', '#ffcf6e');
  assert.equal(m.themeResult(), undefined);
  m.setTheme('--glow', '#ff9f6e');
  assert.deepEqual(m.themeResult(), { '--glow': { v: '#ff9f6e', was: '#ffcf6e' } });
  assert.equal(m.dirty(), 1);
  m.setTheme('--glow', '#ffcf6e');
  assert.equal(m.themeResult(), undefined, 'back to the game\'s value');
  // Reopened: the file says it; the bridge then reads the page, which the loader already recoloured — the file's was stays.
  const r = new UiStyleModel();
  r.restore({ ...base, objects: {}, theme: { '--glow': { v: '#ff9f6e', was: '#ffcf6e' } }, ui: { s: { p: [0, 0], set: { color: '#f00' }, setWas: { color: '#fff' } } } } as PlacementFile);
  r.noteThemeWas('--glow', '#ff9f6e');
  r.noteWas('s', { color: '#f00' });
  assert.equal(r.dirty(), 0);
  assert.equal(r.themeWasOf('--glow'), '#ffcf6e');
  assert.equal(r.wasOf('s', 'color'), '#fff');
  assert.deepEqual(r.replay(), { sets: [{ key: 's', path: 'color', value: '#f00' }], theme: [{ name: '--glow', value: '#ff9f6e' }] });
});

// ----- the file -----

test('file: looks join the moves; a look alone is written at p [0, 0]; screens for every entry', () => {
  const moves = { 'title-card': { p: [0, -40] as [number, number], label: 'Glow Garden' } };
  const looks = { 'start-button': { set: { background: '#ff9f6e' }, setWas: { background: '#ffcf6e' } } };
  const ui = withLooks(moves, looks, new Map([['title-card', 'title'], ['start-button', 'title']]), new Map([['start-button', 'Start']]));
  assert.deepEqual(ui, {
    'title-card': { p: [0, -40], label: 'Glow Garden', screen: 'title' },
    'start-button': { p: [0, 0], label: 'Start', screen: 'title', set: { background: '#ff9f6e' }, setWas: { background: '#ffcf6e' } },
  });
  // What the validator makes of it: the same.
  const world = { ...base, objects: {} } as PlacementFile;
  const f = withUi(world, ui, [1280, 800], { '--glow': { v: '#ff9f6e', was: '#ffcf6e' } });
  assert.ok((validateStudioFile(f) as { ok: boolean }).ok);
  assert.deepEqual(f.uiView, [1280, 800]);
});

test('file: no UI and no theme = the world\'s file itself (same object, same bytes); a theme alone has no uiView', () => {
  const world = { ...base, objects: { a: { p: [1, 0, 0] } } } as unknown as PlacementFile;
  assert.equal(withUi(world, withLooks({}, {}, new Map(), new Map()), [100, 100], undefined), world);
  const t = withUi(world, {}, [100, 100], { '--a': { v: '#fff' } });
  assert.deepEqual(t.theme, { '--a': { v: '#fff' } });
  assert.equal('ui' in t, false);
  assert.equal('uiView' in t, false);
});

test('undo: a look and a theme change are steps; the same value is no step', () => {
  const u = new UndoStack();
  assert.equal(u.push({ changes: [{ kind: 'ui-set', key: 'a', path: 'color', from: null, to: null }] }), false);
  assert.equal(u.push({ changes: [{ kind: 'ui-set', key: 'a', path: 'color', from: null, to: '#fff' }] }), true);
  assert.equal(u.push({ changes: [{ kind: 'ui-theme', key: '--a', from: '#000', to: '#000' }] }), false);
  assert.equal(u.push({ changes: [{ kind: 'ui-theme', key: '--a', from: null, to: '#000' }] }), true);
  // A copy (no `to`) is still always a step.
  assert.equal(u.push({ changes: [{ kind: 'add', key: 'c', from: 'a', pose: { p: [0, 0, 0], r: 0, s: 1 } }] }), true);
  assert.equal(u.size, 3);
});

// ----- the loader's theme (source and built) -----

for (const [name, file] of [['source', 'src/loader/studio-placement.js'], ['built', 'skills/arrange/bin/studio-placement.js']] as const) {
  test(`loader (${name}): theme → style.setProperty on <html>; a bad name or value is skipped`, async () => {
    const { applyPlacement } = await import(pathToFileURL(path.join(PKG, file)).href);
    const set: Record<string, string> = {};
    const g = globalThis as Record<string, unknown>;
    const prev = { document: g.document };
    g.document = { nodeType: 9, documentElement: { style: { setProperty: (n: string, v: string) => (set[n] = v) } }, querySelectorAll: () => [] };
    try {
      await applyPlacement(g.document, { ...base, theme: { '--glow': { v: '#ff9f6e', was: '#ffcf6e' }, 'no-dashes': { v: '#000' }, '--bad': { v: 'red;x' } } });
      assert.deepEqual(set, { '--glow': '#ff9f6e' });
    } finally {
      Object.assign(g, prev);
    }
  });
}
