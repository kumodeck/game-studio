// The UI layer's side of the saved file (UI stage 1, 2026-10-19). Pure functions, no DOM, so they are unit-tested
// (test/ui-layer.test.ts).
//
// WHY a second PlacementModel instead of new code: the UI layer is a 2D layer like any other — moved, saved, counted
// in "Save · 3", put back on reopen — and PlacementModel already does all of it. Only the file shape differs: the
// world writes `objects` (with `was`, the numbers the AI searches the code for), the UI writes `ui` (offsets from
// where the game's CSS puts the element: the original is always p [0, 0], s 1, and the key finds the element). So
// the UI model is given its entries as `objects` with that `was`, and its result is turned back into `ui` here.
import type { PlacementFile, PlacementThemeEntry, PlacementUiEntry, UiStyleSet } from '../contract.ts';

/** The original of every UI element: where the game's own CSS puts it. */
const ORIGIN = { p: [0, 0], r: 0, s: 1 };

/** The saved file as the UI model reads it (its `ui` as 2D objects with `was` = the origin), or null. */
export function uiAsPlacement(file: PlacementFile | null): PlacementFile | null {
  if (!file || !file.ui) return null;
  const objects: PlacementFile['objects'] = {};
  for (const [k, e] of Object.entries(file.ui)) {
    objects[k] = { p: [e.p[0], e.p[1]], r: 0, s: e.s ?? 1, was: { ...ORIGIN, p: [0, 0] }, ...(e.label ? { label: e.label } : {}) };
  }
  return { version: 1, tool: 'placement', dim: '2d', space: 'local', objects };
}

/** The UI model's result as placement.json `ui` entries (moved / resized elements only). */
export function uiEntries(result: PlacementFile): Record<string, PlacementUiEntry> {
  const out: Record<string, PlacementUiEntry> = {};
  for (const [k, e] of Object.entries(result.objects)) {
    if (!e.p) continue;
    const s = typeof e.s === 'number' ? e.s : Array.isArray(e.s) ? e.s[0] : 1;
    const o: PlacementUiEntry = { p: [e.p[0] ?? 0, e.p[1] ?? 0] };
    if (s !== undefined && s !== 1) o.s = s;
    if (e.label && e.label !== k) o.label = e.label;
    if (!o.p[0] && !o.p[1] && o.s === undefined) continue;
    out[k] = o;
  }
  return out;
}

/**
 * UI stages 2–3 (2026-10-22): the moves (uiEntries) with what else the file says of each element — its look changed on
 * the card (`set` / `setWas`, ui-style-model.ts) and its screen. An element whose look changed but which did not move is
 * written at p [0, 0] (the schema wants a `p`; [0, 0] = "where the game's CSS puts it"). The screen is written for every
 * entry whose element sits in a data-studio-screen container; `label` for a look-only entry from the list.
 */
export function withLooks(moves: Record<string, PlacementUiEntry>, looks: Record<string, { set: UiStyleSet; setWas?: UiStyleSet }>,
  screens: Map<string, string>, labels: Map<string, string>): Record<string, PlacementUiEntry> {
  const out: Record<string, PlacementUiEntry> = {};
  for (const [k, e] of Object.entries(moves)) out[k] = { ...e };
  for (const [k, l] of Object.entries(looks)) {
    const label = labels.get(k);
    const e = out[k] || { p: [0, 0], ...(label && label !== k ? { label } : {}) };
    e.set = l.set;
    if (l.setWas) e.setWas = l.setWas;
    out[k] = e;
  }
  for (const [k, e] of Object.entries(out)) {
    const sc = screens.get(k);
    if (sc) e.screen = sc;
  }
  return out;
}

/**
 * The file to write: the world's file, plus `ui` and `uiView` when any UI element is off its original, and `theme`
 * when a theme variable changed (UI stage 3). Without either the world's file comes back as it is — the same object,
 * so a game without data-studio-key writes the same bytes as before UI stage 1.
 */
export function withUi(world: PlacementFile, ui: Record<string, PlacementUiEntry> | undefined, view: [number, number] | null, theme?: Record<string, PlacementThemeEntry>): PlacementFile {
  const hasUi = !!ui && Object.keys(ui).length > 0;
  const hasTheme = !!theme && Object.keys(theme).length > 0;
  if (!hasUi && !hasTheme) return world;
  const out: PlacementFile = { ...world };
  if (hasUi) {
    out.ui = ui;
    if (view && view[0] > 0 && view[1] > 0) out.uiView = [Math.round(view[0]), Math.round(view[1])];
  }
  if (hasTheme) out.theme = theme;
  return out;
}
