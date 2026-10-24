// "Theme" under the UI list (UI stage 3, studio-ui-edit-2, 2026-10-22; asked for as "change the theme's colours and
// fonts and the whole UI follows — fixing buttons one by one is too much"; CONTRACT.md §1.11).
// The game's CSS variables on :root / html (the bridge's ui/theme: colours and fonts only), one row each:
//
//   Theme  5                                        ⌄
//     glow          [■ #ffcf6e]   ↺
//     font-display  [ui-serif, Georgia, serif]
//
// A fold of the list's foot, closed until pressed (the list is what the column is for; the theme is changed now and
// then). Rows read like the card's (.fields): the variable's name without its "--", grey; the value as the card shows
// colours. Changing one recolours every rule that uses it at once (style.setProperty on the game's <html>); one undo
// step and one Save count each (main.ts: the ui-theme change). A game without such variables has no Theme row at all
// (the skill asks the AI, once, whether to gather its colours into variables). A UI the game draws in its canvas has
// its theme in the code (codeTheme, studio-canvas-ui-3, 2026-10-24): the same rows, named by the code's label.
import type { UiThemeVar } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface UiThemeDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  vars(): UiThemeVar[];
  changed(name: string): boolean;
  /** Change one variable (null = the game's own). `live`: shown, no undo step yet (the colour picker moving). */
  set(name: string, value: string | null, live?: boolean): void;
}

export function createUiTheme(d: UiThemeDeps) {
  let open = false;
  let el: HTMLElement | null = null;

  const field = (v: UiThemeVar) => {
    const input = h('input', { type: 'text', value: v.value, autocomplete: 'off', spellcheck: false, 'aria-label': v.name, dataset: { part: 'theme-text' } }) as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') {
        input.value = v.value;
        input.blur();
      }
    });
    input.addEventListener('change', () => input.value.trim() && input.value !== v.value && d.set(v.name, input.value.trim()));
    return h('label', { class: 'num wide ui-text' }, input);
  };

  function render(): HTMLElement | null {
    const vars = d.vars();
    if (!vars.length) return (el = null);
    const head = h('button', { type: 'button', class: 'ui-theme-head', 'aria-expanded': String(open), dataset: { action: 'ui-theme', part: 'ui-theme-head' },
      onclick: () => {
        open = !open;
        const next = render();
        if (next && el0) el0.replaceWith(next);
      } },
    h('span', { class: 'list-title', text: d.t('uiTheme.title') }), h('span', { class: 'count n mono', text: String(vars.length) }), icon(open ? 'chevronUp' : 'chevronDown'));
    const body = h('div', { class: 'fields ui-theme-rows', dataset: { part: 'ui-theme-rows' }, hidden: !open });
    for (const v of vars) {
      // A codeTheme's label (the canvas UI's theme, studio-canvas-ui-3: "Accent", in the person's words), else the CSS
      // variable's name without its "--" — one list, the same rows (no mark of how the game makes it).
      const name = v.label || v.name.replace(/^--/, '');
      const cells: HTMLElement[] = [];
      if (v.type === 'color') {
        const hex6 = /^#[0-9a-f]{6}$/i.test(v.value) ? v.value : '#000000';
        const sw = h('input', { type: 'color', value: hex6, 'aria-label': name, dataset: { part: 'theme-swatch' } }) as HTMLInputElement;
        sw.addEventListener('input', () => d.set(v.name, sw.value, true));
        sw.addEventListener('change', () => d.set(v.name, sw.value));
        cells.push(h('div', { class: 'ui-colour' }, h('span', { class: 'ui-swatch', style: `--c:${v.value}` }, sw), field(v)));
      } else cells.push(field(v));
      if (d.changed(v.name)) cells.push(h('button', { type: 'button', class: 'icon-btn ui-back', dataset: { action: 'theme-back' }, title: d.t('uiLook.back'), 'aria-label': d.t('uiLook.back'), onclick: () => d.set(v.name, null) }, icon('undo')));
      body.append(h('span', { class: v.label ? 'f-l' : 'f-l mono', title: v.name, text: name }), h('div', { class: 'f-cells ui-cells', dataset: { part: 'theme-row', name: v.name } }, ...cells));
    }
    const el0 = h('div', { class: 'ui-theme', dataset: { part: 'ui-theme', open: open ? 'on' : 'off' } }, head, body);
    return (el = el0);
  }

  return {
    render,
    /** New values came: the rows again in place, unless one is being typed in or picked. */
    refresh() {
      if (!el || !el.isConnected || el.contains(document.activeElement)) return;
      const old = el;
      const next = render();
      if (next) old.replaceWith(next);
      else old.remove();
    },
  };
}
