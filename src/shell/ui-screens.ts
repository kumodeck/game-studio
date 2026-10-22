// The UI list's head in a game with screens (UI stage 2, studio-ui-edit-2, 2026-10-22;
// CONTRACT.md §1.11): "On screen" becomes the screen's name — "Title ⌄  1 of 4" — and pressing
// it opens the screens' menu (the same plate as the right-click menu and the levels' menu): one row per screen, ✓ on
// the one shown. Choosing one shows it in the game (the bridge's ui-extras.ts) and lists its elements.
//
// The same button as the level switch (level-switch.ts, its CSS class too): one way of saying "you are here, press to
// go elsewhere" in the editor. No new colour, no tab bar: the words that said where you are become the way to go.
//
// Names: the game's data-studio-screen-label, else a known id in words (title → Title, play → Playing, pause →
// Paused, over → Game over …, in the editor's language: i18n uiScreen.<id>), else the id as written.
import type { UiScreenInfo } from '../contract.ts';
import type { MenuEntry } from './context-menu.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface UiScreensDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  openMenu(entries: MenuEntry[], head: DOMRect): void;
  go(id: string): void;
}

/** The ids with a word of their own (i18n uiScreen.<id>). */
const KNOWN = ['title', 'menu', 'play', 'hud', 'pause', 'over', 'gameover', 'win', 'result', 'settings', 'shop', 'level'];

export function createUiScreens(d: UiScreensDeps) {
  let list: UiScreenInfo[] = [];
  let current: string | null = null;

  const nameOf = (s: UiScreenInfo) => s.label || (KNOWN.includes(s.id.toLowerCase()) ? d.t(`uiScreen.${s.id.toLowerCase()}`) : s.id);
  const entries = (): MenuEntry[] => list.map((s) => ({ id: `screen:${s.id}`, label: nameOf(s), checked: s.id === current, run: () => s.id !== current && d.go(s.id) }));

  return {
    /** From the bridge's ui/screens. */
    update(screens: UiScreenInfo[], now: string | null) {
      list = screens.slice(0, 50);
      current = now;
    },
    /** The screen shown now (null = none of them). */
    current: () => current,
    has: () => list.length > 0,
    entries,
    /** The head for the UI list, or null for a game without screens ("On screen" as before). */
    render(): HTMLElement | null {
      if (!list.length) return null;
      const s = list.find((x) => x.id === current);
      const name = s ? nameOf(s) : d.t('uiScreen.none');
      const i = s ? list.indexOf(s) : -1;
      const b = h('button', { type: 'button', class: 'level-switch screen-switch', dataset: { action: 'screens', part: 'screen-switch' }, 'aria-haspopup': 'menu', title: d.t('uiScreen.switch', { name }) },
        h('span', { class: 'level-name', text: name }),
        icon('chevronDown'),
        i >= 0 ? h('span', { class: 'level-n mono', text: d.t('level.of', { n: i + 1, total: list.length }) }) : null);
      b.addEventListener('click', () => d.openMenu(entries(), b.getBoundingClientRect()));
      return b;
    },
  };
}
