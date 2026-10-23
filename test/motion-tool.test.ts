// The strip's Motion button (studio-motion-tool, 2026-10-22; a review of the object's tool strip: "wouldn't a
// motion button go well here?"), without a browser: what motion-tool.ts tells the game page (shown / the dot / the
// words), what a press does (the timeline on the motion, or the small menu: make one / use a saved one — studio-tool-clear
// 2026-10-23, before: the four kinds and the Library's motions),
// timeline-wire's make (studio-no-presets: the one way to make one — show it; the kinds and makeFrom are gone), and the keys
// (A / 5) in the three places that read them. The button in a real editor: test/studio-motion-tool.browser.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMotionTool, type MotionToolDeps } from '../src/shell/motion-tool.ts';
import { MotionLibrary } from '../src/shell/motion-library.ts';
import { MotionStore } from '../src/shell/motion-model.ts';
import { UndoStack } from '../src/shell/undo.ts';
import { createTimeline } from '../src/shell/timeline-wire.ts';
import type { TimelineView } from '../src/shell/timeline-panel.ts';
import { KEYMAP, keyOf } from '../src/shell/keymap.ts';
import { MOTION_KEYS, isMotionKey, toolFromKey } from '../src/bridge/handles.ts';
import { translate } from '../src/shell/i18n.ts';
import type { LibraryMotion, MotionClip, Pose, ShellToBridge } from '../src/contract.ts';
import type { MenuEntry } from '../src/shell/context-menu.ts';

// make → a move plays the motion (studio-no-presets): ▶'s frames are never run here.
globalThis.requestAnimationFrame ??= (() => 0) as never;
globalThis.cancelAnimationFrame ??= (() => {}) as never;

const hop: LibraryMotion = { name: 'Hop', len: 1, repeat: 'once', keys: { p: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 2, 0] }] } } as LibraryMotion;

/** A motion tool over plain stand-ins: `on` = each thing's motions, `lib` = the Library. */
function rig(o: { target?: string | null; on?: Record<string, string[]>; lib?: LibraryMotion[]; room?: boolean } = {}) {
  const sent: ShellToBridge[] = [];
  const calls: string[] = [];
  let menu: { entries: MenuEntry[]; x: number; y: number; place: string; avoid: DOMRect | null } | null = null;
  const st = { target: o.target === undefined ? 'crate' : o.target, on: o.on ?? {}, lib: o.lib ?? [hop], room: o.room ?? true, open: false };
  const d: MotionToolDeps = {
    t: (k, v) => (v?.name ? `${k}:${v.name}` : k),
    send: (m) => sent.push(m),
    target: () => st.target,
    motions: (k) => st.on[k] ?? [],
    library: () => st.lib,
    room: () => st.room,
    keyText: () => 'A',
    make: (k) => calls.push(`make ${k}`),
    attach: (k, n) => calls.push(`attach ${k} ${n}`),
    open: (k, n) => calls.push(`open ${k} ${n}`),
    menu: (entries, x, y, opt, avoid) => {
      menu = { entries, x, y, place: opt.place, avoid };
      st.open = true;
    },
    menuOpen: () => st.open,
    frame: () => ({ getBoundingClientRect: () => ({ left: 240, top: 44, width: 1000, height: 700 }) }) as HTMLIFrameElement,
  };
  return { tool: createMotionTool(d), sent, calls, st, menu: () => menu };
}

// DOMRect is a browser class; the tool builds one for the button's box.
(globalThis as { DOMRect?: unknown }).DOMRect ??= class {
  x: number;
  y: number;
  width: number;
  height: number;
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
  get left() { return this.x; }
  get top() { return this.y; }
  get right() { return this.x + this.width; }
  get bottom() { return this.y + this.height; }
};

test('sync: the button is shown for a thing that can move, with the dot and the words when it has a motion; nothing twice', () => {
  const r = rig();
  r.tool.sync();
  assert.deepEqual(r.sent.at(-1), { type: 'studio:placement/motion', show: true, has: false, label: 'pal.tool.motion  A', open: false });
  r.tool.sync();
  assert.equal(r.sent.length, 1, 'the same state is not sent again');
  r.st.on.crate = ['Hop'];
  r.tool.sync();
  assert.deepEqual(r.sent.at(-1), { type: 'studio:placement/motion', show: true, has: true, label: 'pal.tool.motionHas:Hop  A', open: false });
  // A new game page: told again although nothing changed here.
  const n = r.sent.length;
  r.tool.reset();
  r.tool.sync();
  assert.equal(r.sent.length, n + 1);
  r.st.target = null; // the ground, several picked, 2D, the UI layer, Play…
  r.tool.sync();
  assert.equal((r.sent.at(-1) as { show: boolean }).show, false);
});

test('press with a motion: the timeline opens on it (no menu)', () => {
  const r = rig({ on: { crate: ['Hop', 'Bob'] } });
  r.tool.press('crate', { x: 10, y: 20, w: 28, h: 28 }, false, false);
  assert.deepEqual(r.calls, ['open crate Hop']);
  assert.equal(r.menu(), null);
});

test('press with no motion: the small menu at the button — "No motion yet", then make one / use a saved one (no list of kinds)', () => {
  const r = rig();
  r.tool.press('crate', { x: 300, y: 500, w: 28, h: 28 }, false, false);
  const m = r.menu()!;
  assert.equal(m.place, 'motion');
  // Under the button from its left edge, in the editor page's px (the frame is at 240, 44).
  assert.equal(m.x, 540);
  assert.equal(m.y, 44 + 500 + 28 + 6);
  // A finger: the point is the button's top middle (the menu goes above it, out from under the finger).
  const f = rig();
  f.tool.press('crate', { x: 300, y: 500, w: 44, h: 44 }, true, false);
  assert.deepEqual([f.menu()!.x, f.menu()!.y], [540 + 22, 544]);
  assert.deepEqual([m.avoid!.left, m.avoid!.top, m.avoid!.width], [540, 544, 28]);
  const rows = (es: MenuEntry[]) => es.map((e) => ('head' in e ? `# ${e.head}` : 'sep' in e ? '—' : 'note' in e ? `> ${e.note}` : e.label));
  // A hands-on try, 10/23, on "New motion: Back and forth / Round / Once / Spin": "this makes no sense at all".
  assert.deepEqual(rows(m.entries), ['> motion.tool.none', 'motion.tool.make', 'motion.tool.saved'], 'two choices, nothing else');
  const run = (es: MenuEntry[], label: string) => (es.find((e) => 'label' in e && e.label === label) as { run(): void }).run();
  run(m.entries, 'motion.tool.make');
  assert.deepEqual(r.calls, ['make crate']);
  // "Use a saved motion": the same menu, in the same place, now with the Library's motions.
  run(m.entries, 'motion.tool.saved');
  const m2 = r.menu()!;
  assert.deepEqual(rows(m2.entries), ['# motion.tool.savedHead', 'Hop']);
  assert.deepEqual([m2.x, m2.y, m2.place], [540, 44 + 500 + 28 + 6, 'motion']);
  // The Library motion row shows its length where a menu shows a key.
  assert.equal((m2.entries.at(-1) as { key?: string }).key, '1 s');
  run(m2.entries, 'Hop');
  assert.deepEqual(r.calls, ['make crate', 'attach crate Hop']);
  // The button looks pressed while its menu is up.
  r.tool.sync();
  assert.equal((r.sent.at(-1) as { open: boolean }).open, true);
});

test('press: no "Use a saved motion" when the Library is empty or the thing is full; a key press opens it under the game\'s middle', () => {
  const r = rig({ lib: [] });
  r.tool.press('crate', { x: 0, y: 0, w: 0, h: 0 }, false, true);
  assert.equal(r.menu()!.entries.some((e) => 'id' in e && e.id === 'motion-lib'), false);
  assert.deepEqual([r.menu()!.x, r.menu()!.y, r.menu()!.avoid], [240 + 500, 44 + 350, null]);
  const full = rig({ room: false });
  full.tool.press('crate', { x: 1, y: 1, w: 28, h: 28 }, false, false);
  assert.equal(full.menu()!.entries.some((e) => 'id' in e && e.id === 'motion-lib'), false);
});

test('press for a thing that is not the target any more (picked away, Play) does nothing', () => {
  const r = rig({ target: 'barrel' });
  r.tool.press('crate', { x: 1, y: 1, w: 28, h: 28 }, false, false);
  assert.equal(r.menu(), null);
  assert.deepEqual(r.calls, []);
});

// ----- timeline-wire make: the same rig as test/motion-flow.test.ts -----
function timeline() {
  const places: Record<string, Pose> = { crate: { p: [0, 0, 0], r: 0, s: 1 }, barrel: { p: [5, 0, 0], r: 0, s: 1 } };
  const store = new MotionStore();
  const lib = new MotionLibrary();
  store.lib = lib;
  lib.set('Hop', hop as unknown as MotionClip);
  lib.markSaved();
  const undo = new UndoStack();
  let view!: () => TimelineView;
  let focused = 0;
  const stand = { el: { hidden: true } as HTMLElement, render() {}, place() {}, focusStarts: () => focused++ };
  const tl = createTimeline({
    store, lib, others: () => [], undo, send: () => {}, dim: () => '3d', usable: () => true, picked: () => 'crate',
    place: (k) => places[k], order: () => Object.keys(places), label: (k) => k, select: () => {}, changed: () => {},
    layout: () => {}, numbers: () => {}, narrow: () => false, t: (k) => k,
  }, (v) => ((view = v), stand as never));
  return { tl, lib, undo, view: () => view(), focused: () => focused };
}

test('make at 1 s ("Make a motion"): the plate opens on the thing at 1 s with no motion yet; one move makes it, and the line says what it does', () => {
  const r = timeline();
  r.tl.make('crate');
  assert.equal(r.tl.isOpen(), true);
  assert.equal(r.tl.state().time, 1, 'the time line already past 0 s: the next move is the second key');
  assert.equal(r.tl.motionOf('crate'), null, 'nothing made by a look');
  assert.equal(r.view().made ?? null, null);
  r.tl.moved('crate', { p: [2, 0, 0], r: 0, s: 1 }, true, { p: [0, 0, 0], r: 0, s: 1 });
  const c = r.tl.motionOf('crate')!.clips![0]!;
  assert.deepEqual(c.keys.p!.map((k) => k.t), [0, 1], 'where it stood is 0 s, where it was put is 1 s');
  assert.equal(r.view().made, 1, '"✓ moves from 0 s to 1 s · When does it move?"');
});

// ----- the keys: the table (the ? sheet, tooltips, ⌘K), the game page (handles.ts) and the editor page (main.ts) -----
test('the Motion keys: A and 5 with something picked, in the table, the game page and the editor page alike', () => {
  const row = KEYMAP.find((k) => k.id === 'motion')!;
  assert.deepEqual(row.keys, [...MOTION_KEYS]);
  assert.equal(row.when, 'picked', 'A with nothing picked flies left (the fly row says so)');
  assert.equal(row.dim, '3d');
  assert.equal(keyOf('motion', true), 'A');
  assert.ok(isMotionKey('a') && isMotionKey('A') && isMotionKey('5') && !isMotionKey('s'));
  assert.equal(toolFromKey('a'), null, 'not a drag tool');
  assert.equal(toolFromKey('5'), null);
  const main = readFileSync(new URL('../src/shell/main.ts', import.meta.url), 'utf8');
  assert.ok(main.includes("const MOTION_KEYS = new Set(['a', '5']);"), 'main.ts reads the same keys');
  for (const lang of ['en', 'ja'] as const) {
    for (const k of ['pal.tool.motion', 'pal.tool.motionHas', 'motion.tool.none', 'motion.tool.make', 'motion.tool.saved', 'motion.tool.savedHead', 'motion.tool.menu', 'keys.motion', 'tl.when.firstAt', 'tl.made']) {
      assert.notEqual(translate(lang, k), k, `${lang}: ${k}`);
    }
  }
  assert.match(translate('en', 'pal.tool.motionHas', { name: 'Hop' }), /Hop/);
  assert.match(translate('ja', 'pal.tool.motionHas', { name: 'Hop' }), /Hop/);
});
