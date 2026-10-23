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
// - The names are the ones the rest of the editor uses for the same action (ops.copy "Duplicate", btn.undo…), and the key is the keymap.ts id, so the menu prints the key the sheet (?) and the tooltips print.
// - SHORT, one way in per action (design review 2, 2026-10-19, item ②: the 3D menu was 9 rows, 2D 13, a phone's 9–11
//   covered the card and the ask box). What has a place that is always on screen is not repeated here: Undo / Redo
//   (the top bar), and on a phone Duplicate / Copy / Paste / Delete (the card's buttons). 2D draw order keeps the two
//   big moves (to front / to back); one step at a time is ⌘] ⌘[ and the card's Layer row. An object's asset file is
//   on the card ("Assets: planks.jpg"), so "Show its asset in Library" went too.
// - Rows that cannot act now: on a PC the object's Duplicate / Copy / Delete stay DIMMED for a locked pick (the
//   group keeps its shape, found by position as in Mac menus); everything else that cannot act is LEFT OUT — Paste
//   with nothing copied, Deselect with nothing picked, the scene's rows while loading, layer moves that cannot
//   happen. A phone never shows a dimmed row (review 2: "always dim" rows read as broken under a finger).
//   What does not belong to this game at all is left out: the draw-order rows outside 2D layers, "Ask your AI" in the
//   web demo (no AI behind it: the brief says so, and the demo has no ask box either — main.ts renderAll).
// - Groups of two to four, a thin line between them; the destructive one (Delete) last in its group, never
//   first under the pointer.
// - The Library: one action, one entrance. An object's tile: Add to scene / Ask your AI… / Show in game → / Delete
//   (no Duplicate: in the Library it did what Add to scene does, and the scene's Duplicate is the card and ⌘D). A
//   file's tile: Add to scene / Ask your AI… / Replace… (the objects that use it are chips in its detail).
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
  /**
   * object: how many of the picked are a held ground / road / sky (Item.held 'ground'). A hands-on try of
   * 2026-10-19 asked that freeing one take a step on purpose; since studio-card-doors (2026-10-23) that step is the
   * "Unlock" in the line under the strip only, so the menu lists nothing for it (the fact stays for scripts).
   */
  held?: number;
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
  /**
   * object, 3D: how many picked objects can be dropped to the floor (End; their height may change). Absent = no row
   * (2D, or an adapter without drop). A phone has no End key: the row is its only way to do it.
   */
  droppable?: number;
  /** object: the asset files the one picked object is drawn with (0 / absent = drawn in code, or several picked). */
  sourceFiles?: number;
  /**
   * A phone (44 px rows): the draw order keeps its two big moves only, to front / to back. With all four a 2D object's
   * menu was 12 rows, ~560 px — taller than the room above or below a finger on a 390×844 phone, so it covered the
   * finger and half the game (test of 2026-10-18). The one-step moves stay on the card's Layer row.
   */
  compact?: boolean;
  /**
   * UI stage 1: the menu is for the game's UI layer. Its elements move and resize only — no duplicate / copy / paste /
   * delete (placing new UI is stage 3) and no Library (an HTML element is not a Library object) — and the UI has no
   * camera, so no Frame / Back to the opening view.
   */
  ui?: boolean;
  /**
   * object: the one picked object's motion on screen (studio-motion-panel): "Ask your AI about “Hop”…" puts the
   * "object · motion" chip in the chat box. Absent = no motion, several picked, or no AI.
   */
  motion?: string;
}

export type CtxRow =
  | {
      id: string;
      /** i18n key of the label (the shell's table; the Library's own words come through `text`). */
      label: string;
      /** keymap.ts id of the shortcut printed at the right, if any. */
      key?: string;
      disabled?: boolean;
      /** A ✦ row (studio-uniforms): it only puts a draft in the AI box — drawn in the AI's violet (context-menu.ts). */
      ai?: true;
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

export function contextRows(place: CtxPlace, f: CtxFacts): CtxRow[] {
  const off = !f.editing;
  if (place === 'object') {
    const locked = off || f.movable === 0;
    const rows: CtxRow[] = [];
    // Two uniforms (studio-uniforms, 2026-10-23): plain rows act here at once (⌘Z undoes) and never
    // write in the AI box; ✦ rows only put a draft there, in their own group at the END, in the AI's violet. Before,
    // "Ask your AI…" was the first row looking like the others, and "Rename…" typed "Rename it to " into the box.
    // Rename (F2) is in place now: the card's name becomes a field (one named object; a name for many is no rename).
    // An unnamed object's name must first exist in the code: "✦ Ask AI to name it…" (a draft, like every ✦).
    if (!f.offline && f.picked === 1 && f.unnamed === 0 && !f.ui) rows.push({ id: 'rename', label: 'ctx.rename', key: 'rename' }, sep);
    // A phone: the card has Duplicate and Delete (and Copy / Paste are the same as Duplicate there) — not here.
    if (!f.compact && !f.ui) {
      // No "Copy" row (studio-card-doors, 2026-10-23; the glossary's "one thing, one word"): "Duplicate" and "Copy" side
      // by side read as the same action twice. ⌘C / ⌘V stay as keys; Paste stays while something is copied.
      rows.push({ id: 'duplicate', label: 'ops.copy', key: 'duplicate', disabled: locked });
      if (!off && f.clip > 0) rows.push({ id: 'paste', label: 'keys.paste', key: 'paste' });
      rows.push({ id: 'remove', label: 'ops.remove', key: 'remove', disabled: locked }, sep);
    }
    // Drop to floor (snap to surfaces, 2026-10-19): with the moves, before the way to the Library. A phone shows it only
    // when it can act (no dimmed rows there).
    if (f.droppable !== undefined && (!f.compact || (!off && f.droppable > 0))) rows.push({ id: 'drop', label: 'keys.drop', key: 'drop', disabled: off || f.droppable === 0 });
    // (No "Unlock" for a locked road since studio-card-doors: its one way is the word in the line under the strip.)
    if (!f.ui) rows.push({ id: 'showInLibrary', label: 'ctx.showInLibrary' });
    if (f.dim === '2d' && f.layers && Object.keys(f.layers).length) {
      const layers: CtxRow[] = [
        { id: 'layer-toFront', label: 'layer.toFront', key: 'toFront', disabled: off || !f.layers.toFront },
        { id: 'layer-toBack', label: 'layer.toBack', key: 'toBack', disabled: off || !f.layers.toBack },
      ];
      rows.push(sep, ...layers.filter((r) => !f.compact || !('sep' in r) && !r.disabled));
    }
    if (!f.offline) {
      rows.push(sep, { id: 'ask', label: f.picked > 1 ? 'ctx.askMany' : 'ctx.askObject', ai: true });
      if (f.motion && f.picked === 1) rows.push({ id: 'askMotion', label: 'ctx.askMotion', ai: true });
      if (f.unnamed > 0) rows.push({ id: 'name', label: f.picked > 1 ? 'ctx.nameAskMany' : 'ctx.nameAsk', ai: true });
    }
    return tidy(rows);
  }
  if (place === 'scene') {
    // Only what can act now (no dimmed rows): Paste when something is copied, Deselect when something is picked.
    const rows: CtxRow[] = [];
    if (!off) {
      if (f.clip > 0 && !f.compact && !f.ui) rows.push({ id: 'paste', label: 'keys.paste', key: 'paste' });
      if (f.items > 0) rows.push({ id: 'selectAll', label: 'pal.selectAll', key: 'selectAll' });
    }
    if (f.anyPicked) rows.push({ id: 'deselect', label: 'ops.selectNone', key: 'deselect' });
    if (!off && !f.ui) rows.push(sep, { id: 'frame', label: 'btn.frame', key: 'frame' }, { id: 'home', label: 'pal.home', key: 'home' });
    if (!f.offline) rows.push(sep, { id: 'ask', label: 'ctx.askGame', ai: true });
    return tidy(rows);
  }
  if (place === 'libObject') {
    const locked = off || f.movable === 0;
    return tidy([
      { id: 'addToScene', label: 'lib.addToScene', disabled: locked },
      sep,
      { id: 'showInGame', label: 'ctx.showInGame' },
      { id: 'remove', label: 'ops.remove', key: 'remove', disabled: locked },
      ...(f.offline ? [] : [sep, { id: 'ask', label: 'lib.askAboutIt', ai: true as const }]),
    ]);
  }
  // libFile: a new object from a file is code, so its "add" is a request — ✦, in the AI's group (the web demo keeps
  // it dimmed, the detail says why: a missing row reads as "can't be done").
  return tidy([
    { id: 'replace', label: 'ctx.replace' },
    sep,
    { id: 'addFile', label: 'lib.addFileAi', disabled: f.offline || f.exists === false, ai: true },
    ...(f.offline ? [] : [{ id: 'askFile', label: 'lib.askAboutIt', ai: true as const }]),
  ]);
}
