// UI stages 2–3 in the shell (studio-ui-edit-2, 2026-10-22): the one place that ties the screens' head (ui-screens.ts),
// the card's look rows (ui-card.ts), the Theme fold (ui-theme.ts) and their store (ui-style-model.ts) to the bridge
// (studio:ui/* messages, ui-extras.ts there) and to undo / Save. main.ts only calls in (its 4,000 lines stay as they
// were but for the calls): the placement panel's uiHead / uiLook / uiFoot, the bridge messages, undo's ui-set /
// ui-theme changes, the Save count and the file.
//
// What is kept where:
//   - the looks and the theme: the model (saved in placement.json, undone, counted);
//   - the screen shown, a button's look shown, sample values: the game page only (the bridge puts them back at the
//     end of editing) and here only to draw the card — never saved. A new game page starts without them.
import type { BridgeToShell, CodeUiInfo, Item, PlacementFile, PlacementUiEntry, ShellToBridge, UiPropName, UiProps, UiState, UiThemeVar } from '../contract.ts';
import type { MenuEntry } from './context-menu.ts';
import { createUiCard } from './ui-card.ts';
import { withLooks } from './ui-layer.ts';
import { createUiScreens } from './ui-screens.ts';
import { UiStyleModel, validLook, validTheme } from './ui-style-model.ts';
import { createUiTheme } from './ui-theme.ts';
import type { Change, UndoEntry } from './undo.ts';

export interface UiWireDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  send(m: ShellToBridge): void;
  /** Record one undo step (false = nothing changed). */
  push(e: UndoEntry): boolean;
  /** A look or the theme changed: the Save count, the rows' dots, the draft. */
  changed(): void;
  /** Draw the list and the card again (a screen shown, the theme's variables came). */
  render(): void;
  openMenu(entries: MenuEntry[], head: DOMRect): void;
  /** The UI layer is the one edited now. */
  onUi(): boolean;
}

// "Back to the game's own" is sent as the game's own value when the file knows it (setWas / the theme's was), not as
// null: a page opened again has the saved look already (the game's loader gave it), so the bridge's own reading of
// "the game's value" is the saved one there, and null would put that back.

/** '@hover.color' → { state: 'hover', name: 'color' }; 'text' → { name: 'text' }. */
const splitPath = (path: string): { state?: UiState; name: UiPropName } => {
  if (!path.startsWith('@')) return { name: path as UiPropName };
  const [st, n] = path.slice(1).split('.') as [UiState, UiPropName];
  return { state: st, name: n };
};

export function createUiWire(d: UiWireDeps) {
  const model = new UiStyleModel();
  const props = new Map<string, UiProps>();
  let vars: UiThemeVar[] = [];
  // The screen of each UI element seen (an element of another screen keeps its screen when that screen is not shown),
  // and its words (the `label` of an element written for its look alone).
  const screenOf = new Map<string, string>();
  const labels = new Map<string, string>();
  // A button's look shown in the game (one element at a time) and the sample values shown (both: this page only).
  let shown: { key: string; state: UiState } | null = null;
  const samples = new Map<string, string>();
  // A colour picker moving: the value before it opened, so its close is one undo step from there.
  const liveFrom = new Map<string, string | number | null>();
  // studio-canvas-ui (2026-10-24): the game's codeUis as the page last listed them (studio:ui/codes) — the file's
  // `code` / `from` / `at` and the AI's `list` — and the HTML keys they clash with; the AI's ui.code checks waiting.
  let codes = new Map<string, CodeUiInfo>();
  let clash: string[] = [];
  let checkId = 0;
  const checks = new Map<number, (r: Array<{ key: string; ok: boolean; why?: string; note?: string }>) => void>();

  const setLook = (key: string, path: string, value: string | number | null, live = false) => {
    const { state, name } = splitPath(path);
    // A value the file could not hold (a colour CSS does not know, a size out of range): not taken, the row redrawn.
    if (value !== null && !validLook(path, typeof value === 'string' ? value.trim() : value)) {
      if (!live) d.send({ type: 'studio:ui/props-get', key });
      return;
    }
    if (typeof value === 'string' && name !== 'text') value = value.trim();
    const id = `${key}\n${path}`;
    if (live) {
      if (!liveFrom.has(id)) liveFrom.set(id, model.value(key, path) ?? null);
      d.send({ type: 'studio:ui/set', key, name, value, ...(state ? { state } : {}), quiet: true });
      return;
    }
    const from = liveFrom.has(id) ? liveFrom.get(id)! : model.value(key, path) ?? null;
    liveFrom.delete(id);
    model.set(key, path, value);
    const to = model.value(key, path) ?? null;
    d.push({ changes: [{ kind: 'ui-set', key, path, from, to }] });
    d.send({ type: 'studio:ui/set', key, name, value: to ?? model.wasOf(key, path) ?? null, ...(state ? { state } : {}) });
    d.changed();
  };
  const setTheme = (name: string, value: string | null, live = false) => {
    if (value !== null && !validTheme(value, vars.find((v) => v.name === name)?.type)) {
      theme.refresh();
      return;
    }
    if (value !== null) value = value.trim();
    const id = `theme\n${name}`;
    if (live) {
      if (!liveFrom.has(id)) liveFrom.set(id, model.theme(name) ?? null);
      d.send({ type: 'studio:ui/theme-set', name, value, quiet: true });
      return;
    }
    const from = (liveFrom.has(id) ? liveFrom.get(id) : model.theme(name)) ?? null;
    liveFrom.delete(id);
    model.setTheme(name, value);
    const to = model.theme(name) ?? null;
    d.push({ changes: [{ kind: 'ui-theme', key: name, from: from === null ? null : String(from), to }] });
    d.send({ type: 'studio:ui/theme-set', name, value: to ?? model.themeWasOf(name) ?? null });
    d.changed();
  };

  const screens = createUiScreens({ t: d.t, openMenu: d.openMenu, go: (id) => d.send({ type: 'studio:ui/screen', id }) });
  const card = createUiCard({
    t: d.t,
    props: (k) => props.get(k) ?? null,
    state: (k) => (shown && shown.key === k ? shown.state : null),
    setState: (k, s) => {
      shown = s ? { key: k, state: s } : null;
      d.send({ type: 'studio:ui/state', key: k, state: s });
    },
    changed: (k, path) => model.value(k, path) !== undefined,
    set: setLook,
    sample: (k, text) => {
      if (text === null) samples.delete(k);
      else samples.set(k, text);
      d.send({ type: 'studio:ui/sample', key: k, text });
    },
  });
  const theme = createUiTheme({
    t: d.t,
    vars: () => vars,
    changed: (n) => model.theme(n) !== undefined,
    set: setTheme,
  });

  return {
    model,
    head: () => screens.render(),
    look: (key: string) => card.render(key),
    foot: () => theme.render(),
    /** The bridge's ui/* messages; false = not one of them. */
    handle(m: BridgeToShell): boolean {
      if (m.type === 'studio:ui/codes') {
        codes = new Map(m.list.map((c) => [c.key, c]));
        clash = m.clash.slice();
        return true;
      }
      if (m.type === 'studio:ui/code-checked') {
        checks.get(m.id)?.(m.results);
        checks.delete(m.id);
        return true;
      }
      if (m.type === 'studio:ui/screens') {
        screens.update(m.screens, m.current);
        if (d.onUi()) d.render();
        return true;
      }
      if (m.type === 'studio:ui/props') {
        props.set(m.props.key, m.props);
        model.noteWas(m.props.key, m.props.was);
        if (!card.refresh(m.props.key) && d.onUi()) d.render();
        return true;
      }
      if (m.type === 'studio:ui/theme') {
        const first = !vars.length;
        vars = m.vars.slice(0, 100);
        for (const v of vars) model.noteThemeWas(v.name, v.was);
        if (first) d.render();
        else theme.refresh();
        return true;
      }
      return false;
    },
    /** A UI list came: each element's screen and words (written with a look of its own). */
    noteItems(items: Item[]) {
      for (const it of items) {
        if (it.screen) screenOf.set(it.key, it.screen);
        labels.set(it.key, it.label);
      }
    },
    /** The pick changed: a button's look shown on another element goes back to its normal one. */
    picked(key: string | null) {
      if (shown && shown.key !== key) {
        d.send({ type: 'studio:ui/state', key: shown.key, state: null });
        shown = null;
      }
    },
    /** The game's page put its editing away (Play) or a new page came: what only lived in it is gone. */
    pageReset() {
      shown = null;
      samples.clear();
      liveFrom.clear();
      props.clear();
    },
    /** A new page's UI: the looks and the theme the editor holds, given to it again (quietly: no props back). */
    replay() {
      const r = model.replay();
      for (const n of r.theme) d.send({ type: 'studio:ui/theme-set', name: n.name, value: n.value, quiet: true });
      for (const s of r.sets) {
        const { state, name } = splitPath(s.path);
        d.send({ type: 'studio:ui/set', key: s.key, name, value: s.value, ...(state ? { state } : {}), quiet: true });
      }
    },
    /** Undo / redo of a look or a theme change (main.ts applyEntry). */
    apply(c: Change, dir: 'undo' | 'redo') {
      if (c.kind === 'ui-set') {
        const v = dir === 'undo' ? c.from : c.to;
        model.set(c.key, c.path, v);
        const { state, name } = splitPath(c.path);
        d.send({ type: 'studio:ui/set', key: c.key, name, value: model.value(c.key, c.path) ?? model.wasOf(c.key, c.path) ?? null, ...(state ? { state } : {}) });
      } else if (c.kind === 'ui-theme') {
        model.setTheme(c.key, dir === 'undo' ? c.from : c.to);
        d.send({ type: 'studio:ui/theme-set', name: c.key, value: model.theme(c.key) ?? model.themeWasOf(c.key) ?? null });
      }
    },
    /** The opened file: its looks, theme and screens. */
    restore(file: PlacementFile | null) {
      model.restore(file);
      for (const [k, e] of Object.entries(file?.ui || {})) if (e.screen) screenOf.set(k, e.screen);
    },
    /** placement.json `ui`: the moves with each element's look and screen (ui-layer.ts withLooks). */
    entries(moves: Record<string, PlacementUiEntry>): Record<string, PlacementUiEntry> {
      return withLooks(moves, model.entries(), screenOf, labels, codes);
    },
    /** The AI's ui.set look (ai-hands.ts): as the card's row — one undo step, sent to the game, counted. */
    setLookFor: (key: string, path: string, value: string | number) => setLook(key, path, value),
    /** The page is read again (the AI's ui.code): the old page's codeUi list must not answer for the new code. */
    resetCodes() {
      codes = new Map();
      clash = [];
    },
    /** The game's codeUis (studio-canvas-ui), as last listed; [] for a game without them. */
    codes: (): CodeUiInfo[] => [...codes.values()],
    /** codeUi ids an HTML element's key already uses. */
    clash: () => clash.slice(),
    /** The AI's ui.code: does each picture follow its box (code-ui.ts check)? null = the page did not answer. */
    check(keys: string[]): Promise<Array<{ key: string; ok: boolean; why?: string; note?: string }> | null> {
      const id = ++checkId;
      return new Promise((res) => {
        const timer = setTimeout(() => {
          checks.delete(id);
          res(null);
        }, 6000);
        checks.set(id, (r) => {
          clearTimeout(timer);
          res(r);
        });
        d.send({ type: 'studio:ui/code-check', id, keys });
      });
    },
    /**
     * The AI wrote this element's look into the code (`ui.set --clear`): out of the file without a change of the
     * person's (not on ⌘Z, not on Save · n), as place.code --fold does for a layout.
     */
    forgetLook(key: string) {
      model.forget(key);
      shown = shown && shown.key === key ? null : shown;
      samples.delete(key);
    },
  };
}

export type UiWire = ReturnType<typeof createUiWire>;
