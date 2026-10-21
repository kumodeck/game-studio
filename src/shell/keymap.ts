// Every keyboard shortcut of the editor, in ONE table (basics pass, 2026-10-18: "undo, redo… need keyboard
// shortcuts, and need buttons too" — a request from a try of the editor). The table is what the tooltips, the ⌘K rows and the shortcut sheet
// (`?`, shortcuts.ts) print, so a key shown anywhere is the key that works. The keys themselves are still read in
// main.ts `shortcut()` and, while the game frame has focus, in bridge/input.ts (M/H/T/S, 1–4, R, Q/E, arrows…);
// test/keymap.test.ts keeps this table and those two places saying the same.
//
// Choices (for people used to other 3D / 2D tools):
// - ⌘ on Apple keyboards, Ctrl elsewhere; both work on every system (main.ts reads ctrl || meta).
// - Redo: ⇧⌘Z and ⌘Y (Mac), Ctrl+Y and Ctrl+Shift+Z (Windows). The first one is the one a tooltip shows.
// - Delete: Delete or Backspace (⌫). Duplicate ⌘D (as Figma / Blender's Shift+D family). Copy / paste ⌘C / ⌘V
//   (paste = a duplicate of what was copied, next to it).
// - Tools: the English initials M / H / T / S (since tool modes, 2026-10-18) and 1–4 in the strip's order.
//   NOT W / E / R (Unity, Maya): E already turns 15° and R picks the next turn axis, and taking them would change
//   what people here learned in the first wave. Numbers are free and are what many tools use for modes.
// - W A S D (+ E / Q) fly the 3D camera as in the engines (camera-wasd, 2026-10-18): alone with nothing picked; with a
//   pick only while the right button is held, so S (Size) and E / Q (turn) keep their meaning (bridge/input.ts).
//   W / S go level (wasd-level, 2026-10-19), E up / Q down as in Unreal; the note under the row says "level".
// - `?` (Shift+/) opens the sheet; Esc closes it.
// - None of these act while typing in a field (main.ts): the field keeps its own ⌘Z, ⌘A, ⌘C, ⌘V, Delete.
//   Only ⌘S (save) and ⌘K (all actions) still work there.

export type KeyGroup = 'edit' | 'tools' | 'view' | 'layers';

export interface KeyDef {
  /** Also the i18n key `keys.<id>` for its name in the sheet (unless `label` names another string). */
  id: string;
  group: KeyGroup;
  /** Each entry is one way to press it, written for a Mac ("⌘Z") — `keyText` turns it into "Ctrl+Z" elsewhere. */
  keys: string[];
  /** i18n key for the name, when another string already says it (btn.undo…). */
  label?: string;
  /** Only in 3D / only in 2D. */
  dim?: '2d' | '3d';
  /** Only in games with a UI layer (UI stage 1: an element marked data-studio-key). */
  ui?: true;
  /** i18n key of a short line under the name in the sheet: WHEN the key works, if that needs saying (fly). */
  note?: string;
  /**
   * When this key does THIS (a key that does two things by the moment): with something selected, with nothing
   * selected, or while a strip tool is chosen. The sheet writes it first on the grey line under the name
   * (`keys.when.<when>`). Ive review 3 ⑦ (2026-10-20): the sheet listed Q E and E Q, S and WASD, Esc and Esc with no word
   * on which is which; test/keymap.test.ts now fails if one key is in two rows without a `when` that tells them apart.
   * Rows are not added for it: the condition is on the row that has the key.
   */
  when?: 'picked' | 'nothing' | 'tool';
}

export const KEYMAP: KeyDef[] = [
  { id: 'undo', group: 'edit', keys: ['⌘Z'], label: 'btn.undo' },
  { id: 'redo', group: 'edit', keys: ['⇧⌘Z', '⌘Y'], label: 'btn.redo' },
  { id: 'copy', group: 'edit', keys: ['⌘C'] },
  { id: 'paste', group: 'edit', keys: ['⌘V'] },
  { id: 'duplicate', group: 'edit', keys: ['⌘D'], label: 'ops.copy' },
  { id: 'remove', group: 'edit', keys: ['⌫', 'Delete'], label: 'ops.remove' },
  { id: 'selectAll', group: 'edit', keys: ['⌘A'], label: 'pal.selectAll' },
  { id: 'deselect', group: 'edit', keys: ['Esc'], label: 'ops.selectNone' },
  { id: 'save', group: 'edit', keys: ['⌘S'], label: 'btn.save' },
  { id: 'move', group: 'tools', keys: ['M', '1'] },
  { id: 'lift', group: 'tools', keys: ['H', '2'], dim: '3d' },
  { id: 'rotate', group: 'tools', keys: ['T', '3'] },
  { id: 'scale', group: 'tools', keys: ['S', '4'] },
  { id: 'axis', group: 'tools', keys: ['R'], dim: '3d' },
  // Esc: puts a chosen strip tool down first; with no tool chosen it deselects (the edit row).
  { id: 'noTool', group: 'tools', keys: ['Esc'], when: 'tool' },
  { id: 'nudge', group: 'tools', keys: ['←↑↓→', '⇧ ←↑↓→'] },
  { id: 'turnStep', group: 'tools', keys: ['Q', 'E'], when: 'picked' },
  { id: 'liftStep', group: 'tools', keys: ['PgUp', 'PgDn'], dim: '3d' },
  // Snap to surfaces (a try of the editor, 2026-10-19, bridge/snap.ts): End drops onto the surface below, as Unreal's End; Ctrl or
  // ⌥ held during a move / height drag stops the snapping (Blender's Ctrl; ⌥ for Mac hands — Ctrl-click is the Mac's
  // right click). A Mac laptop's End is fn + →.
  { id: 'drop', group: 'tools', keys: ['End'], dim: '3d' },
  { id: 'free', group: 'tools', keys: ['⌃', '⌥'], dim: '3d', note: 'keys.free.note' },
  { id: 'sizeStep', group: 'tools', keys: ['+', '−'] },
  { id: 'play', group: 'view', keys: ['P'], label: 'btn.play' },
  { id: 'frame', group: 'view', keys: ['F'], label: 'btn.frame' },
  { id: 'home', group: 'view', keys: ['⇧F'], label: 'pal.home' },
  { id: 'look', group: 'view', keys: ['Space'] },
  // Camera up / down (camera-up pass, 2026-10-18; merged with basics in integrate1): E / Q with nothing picked, and
  // Space+E / Q with a pick (plain E / Q turn the pick then — the turnStep row). Written as E / Q with the Space+ keys
  // in the one-line note under the name (the second design review's ⑪, 2026-10-19: the row said only Space+E / Q, so
  // the plain E / Q people use most — nothing picked — was written nowhere). The name stays short (a longer one,
  // "… (E / Q with nothing picked)", wrapped to three lines in the sheet).
  { id: 'camera', group: 'view', keys: ['E', 'Q'], dim: '3d', note: 'keys.camera.note', when: 'nothing' },
  // Fly (camera-wasd pass, 2026-10-18: "anyone who has used a 3D game engine moves the camera with WASD too"): one row,
  // the rule under its name (`note`, also the ⌘K row's words): WASD alone with nothing picked; with a pick, hold the
  // right button (S is the Size tool and E / Q turn then). E / Q fly up / down in the same moments (the camera row).
  // The note is one line since the second design review (⑪, 2026-10-19; it was three).
  { id: 'fly', group: 'view', keys: ['WASD'], dim: '3d', note: 'keys.fly.note', when: 'nothing' },
  { id: 'palette', group: 'view', keys: ['⌘K'], label: 'foot.palette' },
  { id: 'shortcuts', group: 'view', keys: ['?'] },
  // U: World ⇄ UI (UI stage 1, 2026-10-19). U for UI; free in this table. Not Tab: it moves the browser's focus.
  { id: 'layer', group: 'view', keys: ['U'], ui: true },
  // ⇧U: the game's UI shown / hidden while the world is edited (a try of the editor, 2026-10-20: hidden by default, "in the way").
  // Shift + the layer's own key: the same thing (the UI), looked at instead of switched to. Plain U stays the switch.
  { id: 'uiPeek', group: 'view', keys: ['⇧U'], ui: true },
  { id: 'forward', group: 'layers', keys: ['⌘]'], label: 'layer.forward', dim: '2d' },
  { id: 'backward', group: 'layers', keys: ['⌘['], label: 'layer.backward', dim: '2d' },
  { id: 'toFront', group: 'layers', keys: ['⇧⌘]'], label: 'layer.toFront', dim: '2d' },
  { id: 'toBack', group: 'layers', keys: ['⇧⌘['], label: 'layer.toBack', dim: '2d' },
];

/** ⌘K / Ctrl+K: the Mac spelling as written in KEYMAP, or the Windows / Linux one. */
export function keyText(mac: string, onMac: boolean): string {
  if (onMac) return mac;
  // Windows order is Ctrl+Shift+Z; the Mac writes ⇧⌘Z.
  const shift = mac.includes('⇧') && mac !== '⇧ ←↑↓→';
  let k = mac.replace('⇧', '').replace('⌘', '');
  if (k === '⌫') k = 'Backspace';
  // Held alone (the snap-free keys): the names written on PC keyboards.
  if (k === '⌃') k = 'Ctrl';
  if (k === '⌥') k = 'Alt';
  const parts = [mac.includes('⌘') ? 'Ctrl' : '', shift ? 'Shift' : '', k].filter(Boolean);
  return mac === '⇧ ←↑↓→' ? 'Shift ←↑↓→' : parts.join('+');
}

/** Every way to press `id` on this system ("⇧⌘Z", "⌘Y"), first = the one tooltips show. */
export function keysOf(id: string, onMac: boolean): string[] {
  const d = KEYMAP.find((k) => k.id === id);
  if (!d) return [];
  // On Windows Ctrl+Y is the redo people know first (Office); Ctrl+Shift+Z second.
  const keys = !onMac && id === 'redo' ? ['⌘Y', '⇧⌘Z'] : !onMac && id === 'remove' ? ['Delete', '⌫'] : d.keys;
  return keys.map((k) => keyText(k, onMac));
}

/** The key a tooltip or a ⌘K row shows for `id` ("⌘Z", "Ctrl+Y"), or ''. */
export const keyOf = (id: string, onMac: boolean): string => keysOf(id, onMac)[0] ?? '';

/** The tooltip line: "Undo: move lighthouse" + two spaces + "⌘Z" (no brackets: the key reads as a key). */
export const tipText = (label: string, key: string): string => (key ? `${label}  ${key}` : label);
