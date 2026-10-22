// The level switch (levels, 2026-10-22; CONTRACT.md §1.10). In a game with levels, the
// list's head — "In this scene" — becomes the level's name: "Meadow ⌄  1 of 3". Pressing it opens the levels' menu
// (the same plate as the right-click menu, context-menu.ts): every level (✓ on the one on screen), then New level from
// Meadow, Rename…, Move up, Move down, Delete level. Rename turns the head into a text field in place.
//
// Look (the design's rule: the tools quieter than the game): no new button. The words that already said where you
// are become the way to go somewhere else — the head keeps the list title's grey and size, the chevron is the
// card's chevronDown, and "1 of 3" is the third grey. No colour: orange stays "what you picked".
//
// What each row does is main.ts's (it owns the game frame, the models and the draft); this file only draws and asks.
import type { MenuEntry } from './context-menu.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { Levels } from './levels.ts';

export interface LevelSwitchDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  levels: Levels;
  /**
   * Open the menu with these rows under the head (main.ts's ctxMenu.show); `head` = the head's box, which the menu
   * must not cover (it says what the menu is about).
   */
  openMenu(entries: MenuEntry[], head: DOMRect): void;
  go(id: string): void;
  copy(): void;
  rename(id: string, label: string): void;
  move(id: string, by: -1 | 1): void;
  remove(id: string): void;
}

export function createLevelSwitch(d: LevelSwitchDeps) {
  let renaming = false;

  const entries = (): MenuEntry[] => {
    const lv = d.levels;
    const cur = lv.current;
    const i = lv.index();
    const rows: MenuEntry[] = lv.list.map((e) => ({ id: `level:${e.id}`, label: lv.labelOf(e.id), checked: e.id === cur, run: () => e.id !== cur && d.go(e.id) }));
    rows.push(
      { sep: true },
      { id: 'level-new', label: d.t('level.new', { name: lv.labelOf(cur) }), run: () => d.copy() },
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
    // The head is drawn again by the list (renderListTools); the field takes its place there.
    const old = el;
    const field = render();
    if (field) old?.replaceWith(field);
  }

  /** The head for the list: the button, or the name field while renaming. null = a game without levels. */
  function render(): HTMLElement | null {
    const lv = d.levels;
    if (!lv.active || !lv.list.length) return (el = null);
    const name = lv.labelOf(lv.current);
    if (renaming) {
      // The same field across redraws of the list (a picture arriving redraws its head): what is typed and the focus
      // stay. A blur commits only when the field is still on the page and the focus went elsewhere.
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
        // The editor's own keys (⌘Z, Delete, arrows…) must not act on the scene while typing a name.
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
    const b = h('button', { type: 'button', class: 'level-switch', dataset: { action: 'levels', part: 'level-switch' }, 'aria-haspopup': 'menu', title: d.t('level.switch', { name }) },
      h('span', { class: 'level-name', text: name }),
      icon('chevronDown'),
      h('span', { class: 'level-n mono', text: d.t('level.of', { n: lv.index() + 1, total: lv.list.length }) }));
    b.addEventListener('click', () => d.openMenu(entries(), b.getBoundingClientRect()));
    return (el = b);
  }

  return { render, entries, isRenaming: () => renaming };
}
