// What the right-click / long-press menu lists, per place (context menu, 2026-10-18 — a request after a try of the editor: "right-click in each
// place should bring up the menu for it — in the scene, duplicate, delete, that kind of thing"). Pure: no DOM, no
// state of its own, so test/context-rows.test.ts can say for every place which rows show, in which order, and which
// are dimmed. main.ts gives the facts (`CtxFacts`) and maps each row's id to the action it already has (the card's
// Duplicate, ⌘C, ⌘K's rows…): a menu row never does something no other control does.
//
// The places:
//   object   an object in the game, or its row in the scene list — what is picked (several = all of them)
//   scene    the game where nothing is (or only the ground / background) — the scene as a whole
//   libObject  an object's tile in the Library
//   libFile    a file's (asset's) tile in the Library
//
// "Use the Library" (2026-10-18): the Library's tiles lead with Add to scene and Ask your AI… (what a Library is for),
// and the Scene's objects get the way back: Show in Library, and Show its asset in Library when it is drawn with a file.
// A file's "Add to scene" is a request the AI carries out (it writes the code), so the web demo dims it instead of
// hiding it (the detail says why); its "Ask your AI…" goes, like every AI row there.
//
// Rules, and why:
// - The names are the ones the rest of the editor uses for the same action (ops.copy "Duplicate", keys.copy "Copy",
//   btn.undo…), and the key is the keymap.ts id, so the menu prints the key the sheet (?) and the tooltips print.
// - Rows that cannot act now are DIMMED, not removed (Undo with nothing to undo, Paste with nothing copied): a menu
//   whose rows come and go has to be read again every time; one that keeps its shape is found by position (Mac menus).
//   What does not belong to this game at all is left out: the draw-order rows outside 2D layers, "Ask your AI" in the
//   web demo (no AI behind it: the brief says so, and the demo has no ask box either — main.ts renderAll).
// - Short. Groups of two to four, a thin line between them; the destructive one (Delete) last in its group, never
//   first under the pointer.
import type { Dim } from '../contract.ts';
import type { LayerOp } from './layers.ts';

export type CtxPlace = 'object' | 'scene' | 'libObject' | 'libFile';

export interface CtxFacts {
  dim: Dim;
  /** The host has no AI behind it (the web demo, host.offline): no "Ask your AI". */
  offline: boolean;
  /** The game is open for editing (not loading, not playing). */
  editing: boolean;
  /** What the menu works on (object places): the picked keys, and how many of them can be moved / have no name. */
  picked: number;
  movable: number;
  unnamed: number;
  /** Anything picked at all (the scene's Deselect). */
  anyPicked: boolean;
  /** Objects in the scene (Select all). */
  items: number;
  /** Keys remembered by ⌘C that are still in the scene (Paste). */
  clip: number;
  canUndo: boolean;
  canRedo: boolean;
  /** 2D draw order: which of the four moves can still happen for the pick (empty / absent = no layers here). */
  layers?: Partial<Record<LayerOp, boolean>>;
  /** libFile: how many objects use the file ("Show just these objects"). */
  users?: number;
  /** libFile: the file is in the folder (a missing one cannot be added to the scene). */
  exists?: boolean;
  /** object: the asset files the one picked object is drawn with (0 / absent = drawn in code, or several picked). */
  sourceFiles?: number;
  /**
   * A phone (44 px rows): the draw order keeps its two big moves only, to front / to back. With all four a 2D object's
   * menu was 12 rows, ~560 px — taller than the room above or below a finger on a 390×844 phone, so it covered the
   * finger and half the game (test of 2026-10-18). The one-step moves stay on the card's Layer row.
   */
  compact?: boolean;
}

export type CtxRow =
  | {
      id: string;
      /** i18n key of the label (the shell's table; the Library's own words come through `text`). */
      label: string;
      /** keymap.ts id of the shortcut printed at the right, if any. */
      key?: string;
      disabled?: boolean;
    }
  | { sep: true };

const sep: CtxRow = { sep: true };

/** Drop separators at the ends and doubled ones (a group can be empty: no AI, no layers). */
function tidy(rows: CtxRow[]): CtxRow[] {
  const out: CtxRow[] = [];
  for (const r of rows) {
    if ('sep' in r && (!out.length || 'sep' in out[out.length - 1]!)) continue;
    out.push(r);
  }
  while (out.length && 'sep' in out[out.length - 1]!) out.pop();
  return out;
}

const LAYER_ROWS: Array<{ op: LayerOp; label: string }> = [
  { op: 'forward', label: 'layer.forward' },
  { op: 'backward', label: 'layer.backward' },
  { op: 'toFront', label: 'layer.toFront' },
  { op: 'toBack', label: 'layer.toBack' },
];

export function contextRows(place: CtxPlace, f: CtxFacts): CtxRow[] {
  const off = !f.editing;
  const history: CtxRow[] = [
    { id: 'undo', label: 'btn.undo', key: 'undo', disabled: off || !f.canUndo },
    { id: 'redo', label: 'btn.redo', key: 'redo', disabled: off || !f.canRedo },
  ];
  if (place === 'object') {
    const locked = off || f.movable === 0;
    const rows: CtxRow[] = [];
    // The AI first: it is what the editor is for (the ask box is about the pick; this puts the cursor in it).
    // Naming: a name lives in the game's code, so it is always the AI's job — one press asks for names when the pick
    // has unnamed objects (the card's "Ask your AI to name it"); one named object gets "Rename…" (its words go into
    // the ask box, nothing is sent until Enter). Several named objects: no rename (one name for many is not a rename).
    if (!f.offline) {
      rows.push({ id: 'ask', label: 'ask.chipOne' });
      if (f.unnamed > 0) rows.push({ id: 'name', label: f.picked > 1 ? 'ctx.nameMany' : 'ask.name' });
      else if (f.picked === 1) rows.push({ id: 'rename', label: 'ctx.rename' });
      rows.push(sep);
    }
    rows.push(
      { id: 'duplicate', label: 'ops.copy', key: 'duplicate', disabled: locked },
      { id: 'copy', label: 'keys.copy', key: 'copy', disabled: locked },
      { id: 'paste', label: 'keys.paste', key: 'paste', disabled: off || f.clip === 0 },
      { id: 'remove', label: 'ops.remove', key: 'remove', disabled: locked },
      sep,
      { id: 'showInLibrary', label: 'ctx.showInLibrary' },
    );
    // A phone keeps the menu short (see `compact`): its file is one press away on the card ("Assets: planks.jpg").
    if (f.sourceFiles && !f.compact) rows.push({ id: 'showFileInLibrary', label: 'ctx.showFileInLibrary' });
    if (f.dim === '2d' && f.layers && Object.keys(f.layers).length) {
      rows.push(sep);
      for (const l of LAYER_ROWS.filter((x) => !f.compact || x.op === 'toFront' || x.op === 'toBack')) rows.push({ id: `layer-${l.op}`, label: l.label, key: l.op, disabled: off || !f.layers[l.op] });
    }
    rows.push(sep, ...history);
    return tidy(rows);
  }
  if (place === 'scene') {
    const rows: CtxRow[] = [];
    if (!f.offline) rows.push({ id: 'ask', label: 'ask.game' }, sep);
    rows.push(
      { id: 'paste', label: 'keys.paste', key: 'paste', disabled: off || f.clip === 0 },
      { id: 'selectAll', label: 'pal.selectAll', key: 'selectAll', disabled: off || f.items === 0 },
      { id: 'deselect', label: 'ops.selectNone', key: 'deselect', disabled: !f.anyPicked },
      sep,
      { id: 'frame', label: 'btn.frame', key: 'frame', disabled: off },
      { id: 'home', label: 'pal.home', key: 'home', disabled: off },
      sep,
      ...history,
    );
    return tidy(rows);
  }
  if (place === 'libObject') {
    const locked = off || f.movable === 0;
    return tidy([
      { id: 'addToScene', label: 'lib.addToScene', disabled: locked },
      ...(f.offline ? [] : [{ id: 'ask', label: 'lib.askAi' }]),
      sep,
      { id: 'details', label: 'ctx.details' },
      { id: 'showInGame', label: 'ctx.showInGame' },
      sep,
      { id: 'duplicate', label: 'ops.copy', key: 'duplicate', disabled: locked },
      { id: 'remove', label: 'ops.remove', key: 'remove', disabled: locked },
    ]);
  }
  // libFile
  return tidy([
    { id: 'addFile', label: 'lib.addToScene', disabled: f.offline || f.exists === false },
    ...(f.offline ? [] : [{ id: 'askFile', label: 'lib.askAi' }]),
    sep,
    { id: 'details', label: 'ctx.details' },
    { id: 'showUsers', label: 'ctx.showUsers', disabled: !f.users },
    sep,
    { id: 'replace', label: 'ctx.replace' },
  ]);
}
