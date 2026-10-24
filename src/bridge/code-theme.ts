// The theme of the UI the game draws in its canvas, in the game page (studio-canvas-ui-3, 2026-10-24; CONTRACT.md §1.13
// "Theme").
//
// An HTML game's theme is its CSS variables: "Theme" under the UI list changes one and every rule that uses it follows
// (ui-extras.ts). A canvas has no CSS, so the AI writes the colours and fonts the canvas UI shares once in the game's
// code — codeTheme({ accent: { v: '#ffcf6e', label: 'Accent' } }) in the loader — and the drawing reads them (T.accent,
// or a look's 'var(--accent)'). This file is the editor's hands on them: the same rows as the CSS variables (the name
// `--accent`, with the code's label), the same messages (studio:ui/theme / theme-set), so the shell's Theme fold, its
// undo, its Save count and the file (`theme: { "--accent": { v, was } }`) are the HTML theme's, unchanged — the person
// sees one theme, not "the canvas theme" (02-same.md: the same look, no mark of how it is made).
//
// A change is the editor's value on the game's codeTheme entry (`live`); the game draws one frame (code-ui.ts draws it:
// its handle() marks the picture changed for every theme-set) and the onChange of a Phaser / Pixi UI is told first.
// A CSS variable of the page with the same name is the same row (both change: ui-extras sets the CSS one).
import type { UiThemeVar } from '../contract.ts';

/** A codeTheme entry as the loader keeps it (src/loader/studio-placement.js codeTheme). */
interface Entry {
  name: string;
  v: string;
  label: string | null;
  type: 'color' | 'font';
  live: string | null;
}

const LIST = Symbol.for('game-studio.codeThemes');
const FILE = Symbol.for('game-studio.codeThemeFile');
const NAME = /^--[A-Za-z0-9_-]{1,60}$/;
const VALUE = /^[^;{}<>\\\u0000-\u001f\u007f]{1,200}$/;

/** The game's codeTheme entries (none = []). */
export function codeThemeEntries(win: Window): Entry[] {
  const m = (win as unknown as Record<symbol, unknown>)[LIST];
  return m instanceof Map ? (Array.from(m.values()) as Entry[]).filter((e) => e && typeof e.name === 'string' && typeof e.v === 'string') : [];
}

export interface CodeTheme {
  /** The rows for the shell's Theme fold (the CSS variables' shape, with the code's label); [] = the game has none. */
  vars(): UiThemeVar[];
  /** Change one (null = back to the file's / the code's); false = no codeTheme has that name. */
  set(name: string, value: string | null): boolean;
}

/** The game page's codeTheme rows. `hex` turns the browser's "rgb(255, 207, 110)" into "#ffcf6e" (ui-extras.ts hexColor: the shell's swatch wants it). */
export function createCodeTheme(win: Window, hex: (c: string) => string): CodeTheme {
  const doc = win.document;
  const probe = doc.createElement('i');
  const colour = (c: string) => {
    probe.style.color = '';
    probe.style.color = c;
    probe.style.display = 'none';
    doc.documentElement.appendChild(probe);
    const v = win.getComputedStyle(probe).color;
    probe.remove();
    return v ? hex(v) : c;
  };
  const fileOf = (name: string): string | undefined => {
    const m = (win as unknown as Record<symbol, unknown>)[FILE];
    return m instanceof Map ? (m.get(name) as string | undefined) : undefined;
  };
  return {
    vars: () => codeThemeEntries(win).slice(0, 100).map((e) => {
      const now = e.live || fileOf(e.name) || e.v;
      return { name: e.name, type: e.type, value: e.type === 'color' ? colour(now) : now, was: e.type === 'color' ? colour(e.v) : e.v, ...(e.label ? { label: e.label } : {}) };
    }),
    set(name, value) {
      const e = codeThemeEntries(win).find((x) => x.name === name);
      if (!e || !NAME.test(name)) return false;
      e.live = value !== null && VALUE.test(value.trim()) ? value.trim() : null;
      return true;
    },
  };
}

/** The CSS variables' rows and the codeTheme's as one list: a name both have is one row (the CSS one, with the code's label). */
export function mergeThemeVars(css: UiThemeVar[], code: UiThemeVar[]): UiThemeVar[] {
  const out = css.map((v) => {
    const c = code.find((x) => x.name === v.name);
    return c?.label && !v.label ? { ...v, label: c.label } : v;
  });
  for (const c of code) if (!out.some((v) => v.name === c.name)) out.push(c);
  return out.slice(0, 100);
}
