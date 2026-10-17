// "View" settings page: the person adjusts the editor to their liking.
// Every change applies at once and is saved to .studio/ui.json (debounced by
// the caller), so there is no separate Apply/Save step to forget.
import type { Lang, UiPrefs } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { DEFAULT_UI, UI_LIMITS } from './ui-prefs.ts';

export interface SettingsDeps {
  t(key: string): string;
  prefs(): UiPrefs;
  change(next: UiPrefs): void;
  back(): void;
  /** Phone layout: the panel is always the bottom sheet there. */
  phone(): boolean;
  lang(): Lang;
  setLang(lang: Lang): void;
  /** The AI's look (.studio/ui/) is in use: the link that opens the editor without it (?ui=off). */
  aiLookOff?: string | null;
}

export function renderSettings(el: HTMLElement, d: SettingsDeps): void {
  el.replaceChildren();
  const p = d.prefs();
  const set = (patch: Partial<UiPrefs>) => d.change({ ...d.prefs(), ...patch, show: { ...d.prefs().show, ...(patch.show || {}) } });

  const choice = <K extends 'panel' | 'theme'>(key: K, values: Array<UiPrefs[K]>) => {
    const row = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': d.t(`ui.${key}`) });
    for (const v of values) {
      row.append(h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(p[key] === v), dataset: { ui: `${key}-${v}` },
        text: d.t(`ui.${key}.${v}`), onclick: () => set({ [key]: v } as Partial<UiPrefs>),
      }));
    }
    return h('div', { class: 'set-row' }, h('span', { class: 'set-label', text: d.t(`ui.${key}`) }), row);
  };
  const slider = (key: 'width' | 'height' | 'fontSize' | 'handleSize', unit: string) => {
    const [lo, hi] = UI_LIMITS[key];
    const out = h('output', { text: `${p[key]}${unit}` });
    const input = h('input', { type: 'range', min: lo, max: hi, step: 1, value: String(p[key]), dataset: { ui: key }, 'aria-label': d.t(`ui.${key}`) });
    input.addEventListener('input', () => {
      out.textContent = `${input.value}${unit}`;
      set({ [key]: Number(input.value) } as Partial<UiPrefs>);
    });
    return h('label', { class: 'set-row' }, h('span', { class: 'set-label', text: d.t(`ui.${key}`) }), input, out);
  };
  const toggles = h('div', { class: 'set-toggles' });
  for (const k of Object.keys(p.show) as Array<keyof UiPrefs['show']>) {
    const box = h('input', { type: 'checkbox', checked: p.show[k], dataset: { ui: `show-${k}` } });
    box.addEventListener('change', () => set({ show: { [k]: box.checked } as UiPrefs['show'] }));
    // Name left, switch right (as in system settings).
    toggles.append(h('label', { class: 'set-toggle' }, h('span', { text: d.t(`ui.show.${k}`) }), box));
  }

  // Language: each one in its own name (ui.lang.ja / ui.lang.en) so it can be
  // found whichever language the editor is in now.
  const langRow = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': d.t('ui.lang') });
  for (const v of ['ja', 'en'] as Lang[]) {
    const label = d.t(`ui.lang.${v}`);
    langRow.append(h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(d.lang() === v), dataset: { ui: `lang-${v}` },
      text: label, onclick: () => d.setLang(v),
    }));
  }
  const phone = d.phone();

  el.append(
    h('div', { class: 'page-head' },
      h('button', { type: 'button', class: 'link', dataset: { action: 'settings-back' }, onclick: () => d.back() }, icon('chevronLeft'), d.t('btn.close')),
      h('h2', { text: d.t('ui.title') })),
    h('p', { class: 'page-intro', text: d.t('ui.intro') }),
    // (el.append writes null as text: an empty fragment when there is no AI look.)
    d.aiLookOff ? h('p', { class: 'page-intro ai-look', dataset: { part: 'ai-look' } }, d.t('ui.aiLook') + ' ',
      h('a', { href: d.aiLookOff, text: d.t('ui.aiLookOff') })) : document.createDocumentFragment(),
    h('div', { class: 'set-row' }, h('span', { class: 'set-label', text: d.t('ui.lang') }), langRow),
    // On a phone the panel is always the sheet under the game, so "where" and
    // "width" do nothing there: show only the sheet height.
    ...(phone ? [] : [choice('panel', ['right', 'left', 'bottom'])]),
    phone || p.panel === 'bottom' ? slider('height', '%') : slider('width', 'px'),
    choice('theme', ['dark', 'light', 'auto']),
    slider('fontSize', 'px'),
    slider('handleSize', 'px'),
    h('div', { class: 'set-row set-col' }, h('span', { class: 'set-label', text: d.t('ui.show') }), toggles),
    h('button', { type: 'button', dataset: { action: 'ui-reset' }, text: d.t('ui.reset'), onclick: () => d.change({ ...DEFAULT_UI, show: { ...DEFAULT_UI.show } }) }),
  );
}
