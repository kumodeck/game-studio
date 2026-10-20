// UI stage 1 (2026-10-19): the game's HTML UI in placement.json `ui` — the validator, the loader (source and the
// built copy games get) and the shell's file maths (src/shell/ui-layer.ts, PlacementModel for the UI layer).
// The headless browser side (pick → drag → Save → reopen → Undo) is test/studio-ui-layer.browser.mjs.
// Run: node --experimental-strip-types --no-warnings --test test/ui-layer.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
import { normalizeRequestInput } from '../src/schema/handoff.mjs';
import { PlacementModel } from '../src/shell/placement-model.ts';
import { uiAsPlacement, uiEntries, withUi } from '../src/shell/ui-layer.ts';
import { UndoStack, poseChange } from '../src/shell/undo.ts';
import { contextRows } from '../src/shell/context-rows.ts';
import type { Item, PlacementFile } from '../src/contract.ts';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: { lighthouse: { p: [3.2, 0, -4], was: { p: [2, 0, -4] } } } };

// ----- the validator -----

test('schema: a file without ui is read exactly as before (same bytes)', () => {
  const r = validateStudioFile(base) as { ok: boolean; json: string; value: Record<string, unknown> };
  assert.ok(r.ok);
  assert.equal('ui' in r.value, false);
  assert.equal('uiView' in r.value, false);
  assert.equal(r.json, (validateStudioFile(JSON.parse(r.json)) as { json: string }).json);
});

test('schema: ui entries are rounded, s 1 is dropped, keys sorted, uiView whole px', () => {
  const r = validateStudioFile({ ...base, uiView: [1280.4, 800], ui: { score: { p: [-12.04, 8], label: 'Score 0' }, 'title-logo': { p: [0, -48.06], s: 1.20004 }, still: { p: [1, 2], s: 1 } } }) as { ok: boolean; value: PlacementFile; json: string };
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(r.value.ui, { score: { p: [-12, 8], label: 'Score 0' }, 'title-logo': { p: [0, -48.1], s: 1.2 }, still: { p: [1, 2] } });
  assert.deepEqual(r.value.uiView, [1280, 800]);
  // Canonical: key order in → the same text out.
  const again = validateStudioFile({ ...base, ui: { 'title-logo': { s: 1.2, p: [0, -48.1] }, still: { p: [1, 2] }, score: { label: 'Score 0', p: [-12, 8] } }, uiView: [1280, 800] }) as { json: string };
  assert.equal(again.json, r.json);
  assert.ok(r.json.indexOf('"score"') < r.json.indexOf('"title-logo"'));
});

test('schema: bad ui is refused (unknown field, bounds, scale range, key, no p)', () => {
  const bad = (ui: unknown, uiView?: unknown) => (validateStudioFile({ ...base, ui, ...(uiView ? { uiView } : {}) }) as { ok: boolean; errors?: string[] });
  assert.equal(bad({ a: { p: [0, 0], was: { p: [0, 0] } } }).ok, false);
  assert.equal(bad({ a: { p: [20000, 0] } }).ok, false);
  assert.equal(bad({ a: { p: [0, 0], s: 0.05 } }).ok, false);
  assert.equal(bad({ a: { p: [0, 0], s: 11 } }).ok, false);
  assert.equal(bad({ 'no spaces': { p: [0, 0] } }).ok, false);
  assert.equal(bad({ a: { s: 2 } }).ok, false);
  assert.equal(bad({ a: { p: [0, 0, 0] } }).ok, false);
  assert.equal(bad([]).ok, false);
  assert.equal(bad({ a: { p: [0, 0] } }, [0, 800]).ok, false);
  const many: Record<string, unknown> = {};
  for (let i = 0; i < 201; i++) many[`k${i}`] = { p: [1, 0] };
  assert.equal(bad(many).ok, false);
});

test('schema: an empty ui is left out (and its uiView with it)', () => {
  const r = validateStudioFile({ ...base, ui: {}, uiView: [100, 100] }) as { ok: boolean; value: Record<string, unknown> };
  assert.ok(r.ok);
  assert.equal('ui' in r.value, false);
  assert.equal('uiView' in r.value, false);
});

test('requests: layer "ui" is kept, anything else dropped', () => {
  const r = normalizeRequestInput({ kind: 'ask', text: 'make the title gold', lang: 'en', objects: [{ key: 'title-card' }], layer: 'ui' }) as { ok: boolean; value: Record<string, unknown> };
  assert.ok(r.ok);
  assert.equal(r.value.layer, 'ui');
  const w = normalizeRequestInput({ kind: 'ask', text: 'x', lang: 'en', layer: 'world' }) as { ok: boolean; value: Record<string, unknown> };
  assert.equal('layer' in w.value, false);
});

// ----- the loader (source and built) -----

/** A small stand-in for a DOM element with the parts the loader reads. */
function el(key: string, cs: { translate?: string; scale?: string; transform?: string; transformOrigin?: string } = {}, size = { w: 0, h: 0 }) {
  return { nodeType: 1, dataset: { studioKey: key }, style: { translate: '', scale: '' }, offsetWidth: size.w, offsetHeight: size.h,
    _cs: { translate: cs.translate ?? 'none', scale: cs.scale ?? 'none', transform: cs.transform ?? 'none', transformOrigin: cs.transformOrigin ?? `${size.w / 2}px ${size.h / 2}px` }, querySelectorAll: () => [] as unknown[] };
}
type El = ReturnType<typeof el>;
function fakeDom(els: El[]) {
  let observer: ((list: Array<{ addedNodes: unknown[] }>) => void) | null = null;
  const doc = { nodeType: 9, documentElement: {}, querySelectorAll: () => els };
  const g = globalThis as Record<string, unknown>;
  const prev = { document: g.document, getComputedStyle: g.getComputedStyle, MutationObserver: g.MutationObserver, fetch: g.fetch };
  g.document = doc;
  g.getComputedStyle = (e: El) => e._cs;
  g.MutationObserver = class {
    constructor(cb: (list: Array<{ addedNodes: unknown[] }>) => void) {
      observer = cb;
    }
    observe() {}
  };
  return {
    doc,
    add: (e: El) => observer?.([{ addedNodes: [e] }]),
    restore: () => Object.assign(g, prev),
  };
}

for (const [name, file] of [['source', 'src/loader/studio-placement.js'], ['built', 'skills/arrange/bin/studio-placement.js']] as const) {
  test(`loader (${name}): ui → translate / scale; left, top and transform untouched`, async () => {
    const { applyPlacement } = await import(pathToFileURL(path.join(PKG, file)).href);
    const title = el('title-card');
    const start = el('start-button', { translate: '-50% 0px' });
    const big = el('big', { scale: '2' });
    const own = el('own');
    own.style.translate = '5px 5px'; // the game moves this one itself
    const dom = fakeDom([title, start, big, own]);
    try {
      const scene = { isObject3D: true, children: [], userData: {} };
      const r = await applyPlacement(scene, { ...base, dim: '2d', objects: {}, ui: { 'title-card': { p: [0, -48], s: 1.2 }, 'start-button': { p: [10, -4] }, big: { p: [0, 0], s: 1.5 }, own: { p: [1, 1] }, gone: { p: [1, 1] } } });
      assert.equal(title.style.translate, '0px -48px');
      assert.equal(title.style.scale, '1.2');
      // The stylesheet's translate stays: the offset is added to it.
      assert.equal(start.style.translate, 'calc(-50% + 10px) calc(0px + -4px)');
      assert.equal(start.style.scale, '');
      assert.equal(big.style.scale, '3 3');
      assert.equal(own.style.translate, '5px 5px');
      assert.deepEqual(r.ui.applied.sort(), ['big', 'start-button', 'title-card']);
      assert.deepEqual(r.ui.missing.sort(), ['gone', 'own']);
      // Wrong dim for the world: the world is skipped (as before), the UI still applied (above).
      assert.deepEqual(r.applied, []);
      // An element made later (a game-over screen) gets its place too.
      const late = el('title-card');
      dom.add(late);
      assert.equal(late.style.translate, '0px -48px');
    } finally {
      dom.restore();
    }
  });

  test(`loader (${name}): a size keeps the middle — worked out from the box now, not saved`, async () => {
    const { placeUi, uiOffset } = await import(pathToFileURL(path.join(PKG, file)).href);
    const dom = fakeDom([]);
    try {
      // A 200 × 40 title centred with transform: translate(-50%, -50%) (= -100, -20 px), grown to 1.5: its box grows
      // around the box's own middle, which the transform moved 100 px left / 20 up of what is seen — so the seen middle
      // would slide 50 / 10 px. The translate puts that back.
      const title = el('t', { transform: 'matrix(1, 0, 0, 1, -100, -20)' }, { w: 200, h: 40 });
      assert.ok(placeUi(title, [0, 0], 1.5));
      assert.equal(title.style.translate, '50px 10px');
      assert.equal(title.style.scale, '1.5');
      assert.deepEqual(uiOffset(title), { p: [0, 0], s: 1.5 }, 'the saved offset is the middle\'s move only');
      // No transform, origin in the middle: nothing to correct.
      const plain = el('u', {}, { w: 80, h: 20 });
      placeUi(plain, [3, 4], 2);
      assert.equal(plain.style.translate, '3px 4px');
      // transform-origin: top left: grows down-right around the corner; the middle is kept by moving up-left.
      const corner = el('v', { transformOrigin: '0px 0px' }, { w: 80, h: 20 });
      placeUi(corner, [0, 0], 2);
      assert.equal(corner.style.translate, '-40px -10px');
    } finally {
      dom.restore();
    }
  });

  test(`loader (${name}): applyPlacement(document) is the UI only; no ui = no report.ui, nothing touched`, async () => {
    const { applyPlacement, placeUi, uiOffset } = await import(pathToFileURL(path.join(PKG, file)).href);
    const title = el('title-card');
    const dom = fakeDom([title]);
    try {
      const r = await applyPlacement(dom.doc, { ...base, ui: { 'title-card': { p: [4, 5] } } });
      assert.equal(title.style.translate, '4px 5px');
      assert.deepEqual(r.applied, []);
      assert.deepEqual(r.ui, { applied: ['title-card'], missing: [] });
      const plain = el('x');
      const dom2 = fakeDom([plain]);
      const r2 = await applyPlacement({ isObject3D: true, children: [], userData: {} }, base);
      assert.equal('ui' in r2, false);
      assert.equal(plain.style.translate, '');
      dom2.restore();
      // Back to the origin = nothing inline (the element is exactly as the game's CSS makes it).
      assert.ok(placeUi(title, [0, 0], 1));
      assert.equal(title.style.translate, '');
      assert.equal(title.style.scale, '');
      assert.deepEqual(uiOffset(title), { p: [0, 0], s: 1 });
    } finally {
      dom.restore();
    }
  });
}

// ----- the shell's file maths -----

const uiItem = (key: string, p: [number, number] = [0, 0], s = 1): Item => ({ key, label: key, kinds: ['ui', 'text'], rotatable: false, scalable: true, pose: { p, r: 0, s } });

test('shell: a game without UI writes the world file as it is (same object, same bytes)', () => {
  const world = new PlacementModel();
  world.setItems([{ key: 'a', label: 'a', kinds: ['mesh'], rotatable: true, scalable: true, pose: { p: [0, 0, 0], r: 0, s: 1 } }], '3d');
  world.moved('a', { p: [1, 0, 0], r: 0, s: 1 });
  const file = world.result();
  assert.equal(withUi(file, undefined, null), file);
  assert.equal(withUi(file, {}, [100, 100]), file);
});

test('shell: the UI model counts, saves and reopens moves as `ui` entries', () => {
  const ui = new PlacementModel();
  ui.setItems([uiItem('title-card'), uiItem('score')], '2d');
  assert.equal(ui.dirty(), 0);
  ui.moved('title-card', { p: [0, -48], r: 0, s: 1.2 });
  assert.equal(ui.dirty(), 1);
  const entries = uiEntries(ui.result());
  assert.deepEqual(entries, { 'title-card': { p: [0, -48], s: 1.2 } });
  const world = new PlacementModel();
  world.setItems([], '3d');
  const file = withUi(world.result(), entries, [1280, 800]);
  assert.deepEqual(file.ui, entries);
  assert.deepEqual(file.uiView, [1280, 800]);
  assert.ok((validateStudioFile(file) as { ok: boolean }).ok);
  ui.markSaved();
  assert.equal(ui.dirty(), 0);

  // Reopen without the loader: the game shows the original (0, 0) → the shell pushes the saved place back.
  const again = new PlacementModel();
  again.restore(uiAsPlacement(file));
  const apply = again.setItems([uiItem('title-card'), uiItem('score')], '2d');
  assert.deepEqual(apply, [{ key: 'title-card', pose: { p: [0, -48], r: 0, s: 1.2 } }]);
  assert.equal(again.dirty(), 0);
  // Reopen with the loader: the game already shows the saved place → nothing to push, nothing unsaved.
  const withLoader = new PlacementModel();
  withLoader.restore(uiAsPlacement(file));
  assert.deepEqual(withLoader.setItems([uiItem('title-card', [0, -48], 1.2), uiItem('score')], '2d'), []);
  assert.equal(withLoader.dirty(), 0);
  // Moved back to where the game's CSS puts it: no entry at all.
  withLoader.moved('title-card', { p: [0, 0], r: 0, s: 1 });
  assert.deepEqual(uiEntries(withLoader.result()), {});
  // An element the game no longer has stays in the file (as world orphans do).
  const orphan = new PlacementModel();
  orphan.restore(uiAsPlacement(file));
  orphan.setItems([uiItem('score')], '2d');
  assert.deepEqual(uiEntries(orphan.result()), { 'title-card': { p: [0, -48], s: 1.2 } });
});

test('shell: undo steps carry the layer they were made on', () => {
  const u = new UndoStack();
  let layer: 'ui' | undefined;
  u.layerNow = () => layer;
  u.push(poseChange('a', { p: [0, 0, 0] }, { p: [1, 0, 0] }));
  layer = 'ui';
  u.push(poseChange('title-card', { p: [0, 0] }, { p: [0, -10] }));
  assert.equal(u.undo()?.layer, 'ui');
  assert.equal(u.undo()?.layer, undefined);
});

test('shell: the UI layer menu has no copy / delete / Library / camera rows', () => {
  const facts = { dim: '2d' as const, offline: false, editing: true, picked: 1, movable: 1, unnamed: 0, anyPicked: true, items: 3, clip: 1, canUndo: true, canRedo: false };
  const ids = (place: 'object' | 'scene', ui: boolean) => contextRows(place, { ...facts, ui }).filter((r) => 'id' in r).map((r) => (r as { id: string }).id);
  assert.ok(ids('object', false).includes('duplicate'));
  for (const id of ['duplicate', 'copy', 'paste', 'remove', 'showInLibrary']) assert.ok(!ids('object', true).includes(id), id);
  for (const id of ['paste', 'frame', 'home']) assert.ok(!ids('scene', true).includes(id), id);
  assert.ok(ids('scene', true).includes('selectAll'));
});
