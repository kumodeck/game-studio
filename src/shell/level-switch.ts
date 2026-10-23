// The level switch (levels, 2026-10-22; CONTRACT.md §1.10), in the top bar's path since level-crumb (2026-10-22).
//
// Where: ▣ Studio / Three Isles / Scene / Meadow ⌄ — the game, the Scene, the level (level-menu2, 2026-10-23; a hands-on try
// of v0.1.25's "Studio / NEON DASH / [Levels ⌄] / Scene": "it's game name, scene, level name, isn't it").
// Until then the level sat between the game and the Scene (level-crumb, 2026-10-22). It is a part of the path that
// already says where you are, a word of it and not a framed button. Pressing it opens the levels' menu (the same plate
// as the right-click menu, context-menu.ts): every level (✓ on the one on screen, "[" / "]" on its neighbours), then
// New level, Duplicate, then Rename…, Move up, Move down, Delete level. Rename turns the crumb into a text field in place.
// The menu has no line of explanation and no ✦ AI row (level-menu2; a hands-on try: "New (blank) and Duplicate are
// enough — make it new, then ask the AI"). v0.1.25 had "This game has one level…", "Make Level 2 (a copy of this
// one)" and "✦ Ask AI for a different kind of level…".
// History: the first version (same day) made the Scene list's head the switch ("Meadow ⌄  1 of 3" instead of "In
// this scene"). A try of the editor (10/22): "where to switch levels is hard to find too" — the head read as a title,
// and a game without levels had no way in at all. The list's head is "In this scene" again: one door, not two.
//
// A game WITHOUT levels gets "Level 1 ⌄" where the level's name will be (addButton; level-menu2 — it was a framed
// "Levels ⌄" in v0.1.25, and a quiet "+ Level" after the path before studio-uniforms, 2026-10-23 — see addButton). Chosen over a ⌄ on the game's name with
// one row "Add levels…" (the other plan drawn for it): nobody opens a menu to find one row, and the
// "+" sits where the level will appear. It is the third grey and small, like the path's own words: the tools stay
// quieter than the game. What it does is main.ts's (a game whose code has one level gets the second one at once;
// otherwise the request is written into the ask field for the AI — nothing is sent until Enter).
//
// Look: no colour (orange stays "what you picked"); the crumb has the path's text colour and weight, a chevron in the
// third grey, and the bar's capsule fill only while hovered or open. "1 of 3" left the visible crumb (the path names
// places, it does not count them); the tooltip and the menu's order still say it.
import type { MenuEntry } from './context-menu.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { Levels } from './levels.ts';

export interface LevelSwitchDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  levels: Levels;
  /**
   * Open the menu with these rows under the crumb (main.ts's ctxMenu.show); `head` = the crumb's box, which the menu
   * must not cover (it says what the menu is about).
   */
  openMenu(entries: MenuEntry[], head: DOMRect): void;
  /** The key that goes to the level before / after ("[" / "]"; '' on a phone, which has no keyboard). */
  keyOf(id: 'levelPrev' | 'levelNext'): string;
  go(id: string): void;
  /** New level: a blank one (the ground / sky kept, nothing placed), opened (main.ts addLevel). */
  blank(): void;
  /** Duplicate: a copy of the one on screen, opened. */
  copy(): void;
  rename(id: string, label: string): void;
  move(id: string, by: -1 | 1): void;
  remove(id: string): void;
}

/** New level and Duplicate: the two ways to make a level, in both menus (a game with levels and one without). */
export function makeRows(d: Pick<LevelSwitchDeps, 't' | 'blank' | 'copy'>): MenuEntry[] {
  return [
    { id: 'level-new', label: d.t('level.blank'), run: () => d.blank() },
    { id: 'level-copy', label: d.t('level.duplicate'), run: () => d.copy() },
  ];
}

export function createLevelSwitch(d: LevelSwitchDeps) {
  let renaming = false;

  const entries = (): MenuEntry[] => {
    const lv = d.levels;
    const cur = lv.current;
    const i = lv.index();
    const prev = lv.step(-1), next = lv.step(1);
    const rows: MenuEntry[] = lv.list.map((e) => ({ id: `level:${e.id}`, label: lv.labelOf(e.id), checked: e.id === cur,
      key: e.id === prev ? d.keyOf('levelPrev') || undefined : e.id === next ? d.keyOf('levelNext') || undefined : undefined,
      run: () => e.id !== cur && d.go(e.id) }));
    rows.push(
      { sep: true },
      ...makeRows(d),
      { sep: true },
      { id: 'level-rename', label: d.t('level.rename'), run: () => startRename() },
      { id: 'level-up', label: d.t('level.up'), disabled: i <= 0, run: () => d.move(cur, -1) },
      { id: 'level-down', label: d.t('level.down'), disabled: i < 0 || i >= lv.list.length - 1, run: () => d.move(cur, 1) },
      { sep: true },
      { id: 'level-delete', label: d.t('level.delete'), disabled: lv.list.length <= 1, run: () => d.remove(cur) },
    );
    return rows;
  };

  let el: HTMLElement | null = null;
  let field: HTMLInputElement | null = null;
  function startRename() {
    renaming = true;
    // The crumb is drawn again by the bar (renderAll); the field takes its place there.
    const old = el;
    const f = render(true);
    if (f) old?.replaceWith(f);
  }

  /** Open the menu from the crumb (also ⌘K's "Levels…"). */
  function open() {
    if (el?.isConnected && el instanceof HTMLButtonElement) d.openMenu(entries(), el.getBoundingClientRect());
  }

  /**
   * The crumb: the button, or the name field while renaming; `live` = false while playing (the level's name as plain
   * words: you are in it, the menu would reload the game under the person's hands). null = a game without levels.
   */
  function render(live = true): HTMLElement | null {
    const lv = d.levels;
    if (!lv.active || !lv.list.length) return (el = null);
    const name = lv.labelOf(lv.current);
    if (renaming && live) {
      // The same field across redraws of the bar (any renderAll): what is typed and the focus stay. A blur commits
      // only when the field is still on the page and the focus went elsewhere.
      if (field) {
        requestAnimationFrame(() => field && document.activeElement !== field && field.focus());
        return (el = field);
      }
      const input = (field = h('input', { type: 'text', class: 'level-rename', value: name, maxlength: '120', 'aria-label': d.t('level.renameLabel'), dataset: { part: 'level-rename' } }) as HTMLInputElement);
      let done = false;
      const finish = (keep: boolean) => {
        if (done) return;
        done = true;
        renaming = false;
        field = null;
        const v = input.value.trim();
        if (keep && v && v !== name) d.rename(lv.current, v);
        else input.replaceWith(render() || h('span'));
      };
      input.addEventListener('keydown', (e) => {
        // The editor's own keys (⌘Z, Delete, arrows, [ ]…) must not act on the scene while typing a name.
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => setTimeout(() => input.isConnected && document.activeElement !== input && finish(true), 0));
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
      return (el = input);
    }
    const where = d.t('level.of', { n: lv.index() + 1, total: lv.list.length });
    if (!live) return (el = h('span', { class: 'level-here', text: name, title: `${name} · ${where}`, dataset: { part: 'level-here' } }));
    const b = h('button', { type: 'button', class: 'level-switch', dataset: { action: 'levels', part: 'level-switch' }, 'aria-haspopup': 'menu', title: d.t('level.switch', { name, where }) },
      h('span', { class: 'level-name', text: name }),
      icon('chevronDown'));
    b.addEventListener('click', () => d.openMenu(entries(), b.getBoundingClientRect()));
    return (el = b);
  }

  /**
   * "Level 1 ⌄" in the path (after "Scene"), for a game without levels (main.ts decides when it shows; `name` = the
   * code's one level's name, else "Level 1"). It opens a menu (`run(button)` → openAt), never acts at once —
   * studio-uniforms, 2026-10-23: it was "+ Level", which typed into the AI box, and a hands-on try asked for the menu
   * back. Since level-menu2 it looks like the crumb itself (shell.css: the same rules): the game already has one level,
   * so the path names it, and the menu says New level / Duplicate. v0.1.25's framed "Levels ⌄" read as a button
   * among the path's words.
   */
  function addButton(name: string, run: (b: HTMLElement) => void): HTMLElement {
    const b = h('button', { type: 'button', class: 'level-add', dataset: { action: 'level-add', part: 'level-add' }, 'aria-haspopup': 'menu', title: d.t('level.addTip', { name }) },
      h('span', { class: 'level-name', text: name }), icon('chevronDown'));
    b.addEventListener('click', () => run(b));
    return b;
  }
  /** Open `entries` under `b` (the "Levels ⌄" of a game without levels): the same place and plate as the crumb's menu. */
  function openAt(entries: MenuEntry[], b: HTMLElement) {
    d.openMenu(entries, b.getBoundingClientRect());
  }

  return { render, entries, open, openAt, addButton, isRenaming: () => renaming };
}
