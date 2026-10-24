// The UI element's card rows below its offset and size (UI stages 2–3, studio-ui-edit-2, 2026-10-22;
// CONTRACT.md §1.11): what it says and how it looks, read from the game (the bridge's
// ui/props) and changed in place.
//
//   State   Normal | Hover | Pressed | Disabled      (a button only: shows that look in the game)
//   Text    [Glow Garden      ][72 px] ↺           (its main text and that text's size; not for words mixed with a value)
//   Color   [■ #fff6d8]                ↺
//   Fill    [■ #ffcf6e]                ↺              (a box with a fill, or a button)
//   Sample  999,999 · Long name · Empty · [ … ] ×    (only while editing: never saved)
//
// The text's size sits in the Text row, not a row of its own: the card's "Size" above is already the element's scale
// (1.00), and two rows called Size would read as one thing said twice.
// The same rows as the numbers above them (.fields: a grey label, a value that gets a fill on hover): the card stays
// one plate that grew, not a second panel (Ive: "the tools quieter than the game"). No new colour: the colour fields
// show the game's colours, the editor's own are its greys. "↺" (the game's own value) only where a value was changed.
// With a state other than Normal only Colour and Fill are shown: the state's own colours (a button's hover fill).
//
// Every change is one undo step and one Save count (main.ts: the ui-set change); a colour dragged in the picker shows
// live in the game and becomes one step when the picker closes. Nothing here talks to the game: the deps do.
import type { UiProps, UiState } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface UiCardDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  /** The props the bridge last sent for this key (null until they come). */
  props(key: string): UiProps | null;
  /** The look shown now on the card's element (null = normal). */
  state(key: string): UiState | null;
  setState(key: string, s: UiState | null): void;
  /** True when this field differs from the game's own (the "↺" is shown). */
  changed(key: string, path: string): boolean;
  /** Change one field (`path` 'text' | 'fontSize' | 'color' | 'background' | '@hover.color' …). `live`: no undo step yet. */
  set(key: string, path: string, value: string | number | null, live?: boolean): void;
  /** Show a sample in the element (null = its own text again). */
  sample(key: string, text: string | null): void;
}

const STATES: Array<UiState | null> = [null, 'hover', 'active', 'disabled'];

export function createUiCard(d: UiCardDeps) {
  let el: HTMLElement | null = null;
  let forKey: string | null = null;

  const row = (label: string, part: string, ...cells: Array<HTMLElement | null>) =>
    [h('span', { class: 'f-l', text: label, dataset: { for: part } }), h('div', { class: 'f-cells ui-cells', dataset: { part } }, ...cells.filter((c): c is HTMLElement => !!c))];
  const back = (key: string, path: string) => (d.changed(key, path)
    ? h('button', { type: 'button', class: 'icon-btn ui-back', dataset: { action: 'ui-back', path }, title: d.t('uiLook.back'), 'aria-label': d.t('uiLook.back'), onclick: () => d.set(key, path, null) }, icon('undo'))
    : null);
  /** A one-line field that commits on Enter / leaving it (Escape puts the value back). */
  const textField = (value: string, label: string, commit: (v: string) => void, opts: { mode?: string; part: string }) => {
    const input = h('input', { type: 'text', value, autocomplete: 'off', spellcheck: false, 'aria-label': label, dataset: { part: opts.part }, ...(opts.mode ? { inputmode: opts.mode } : {}) }) as HTMLInputElement;
    input.addEventListener('keydown', (e) => {
      // The editor's own keys (⌘Z, arrows, Delete) must not act on the game while typing.
      e.stopPropagation();
      if (e.key === 'Enter') input.blur();
      else if (e.key === 'Escape') {
        input.value = value;
        input.blur();
      }
    });
    input.addEventListener('change', () => input.value !== value && commit(input.value));
    return h('label', { class: 'num wide ui-text' }, input);
  };
  /** A colour: the swatch opens the system picker (live in the game while it moves), the text takes #rrggbb / rgb(). */
  const colourField = (key: string, path: string, value: string, label: string) => {
    const hex6 = /^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{3}$/i.test(value) ? '#' + [...value.slice(1)].map((c) => c + c).join('') : '#000000';
    const sw = h('input', { type: 'color', value: hex6, 'aria-label': label, dataset: { part: `${path}-swatch` } }) as HTMLInputElement;
    sw.addEventListener('input', () => d.set(key, path, sw.value, true));
    sw.addEventListener('change', () => d.set(key, path, sw.value));
    const txt = textField(value, label, (v) => d.set(key, path, v.trim()), { part: `${path}-text` });
    return h('div', { class: 'ui-colour' }, h('span', { class: 'ui-swatch', style: `--c:${value}` }, sw), txt);
  };

  /** The rows for one UI element (empty when the bridge has said nothing of it yet, or it has nothing to change). */
  function render(key: string): HTMLElement[] {
    forKey = key;
    const p = d.props(key);
    if (!p) {
      el = h('div', { class: 'fields ui-look', dataset: { part: 'ui-look', key }, hidden: true });
      return [el];
    }
    const st = d.state(key);
    const parts: HTMLElement[] = [];
    if (p.button) {
      const seg = h('div', { class: 'seg ui-states', role: 'radiogroup', 'aria-label': d.t('uiLook.state'), dataset: { part: 'ui-state' } },
        ...STATES.map((s) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(s === st), dataset: { state: s || 'normal' }, text: d.t(`uiLook.state.${s || 'normal'}`),
          onclick: () => s !== st && d.setState(key, s) })));
      parts.push(...row(d.t('uiLook.state'), 'ui-state-row', seg));
    }
    const pre = st ? `@${st}.` : '';
    if (!st && p.text !== null) {
      const size = p.fontSize !== null ? textField(String(Math.round(p.fontSize * 10) / 10), d.t('uiLook.size'), (v) => {
        const n = parseFloat(v.replace(',', '.'));
        if (Number.isFinite(n) && n >= 1 && n <= 500) d.set(key, 'fontSize', Math.round(n * 10) / 10);
      }, { mode: 'decimal', part: 'ui-size' }) : null;
      size?.classList.add('ui-px');
      size?.append(h('span', { class: 'ui-unit', text: 'px' }));
      // One ↺ for the row: the text and its size go back together.
      const changed = d.changed(key, 'text') || d.changed(key, 'fontSize');
      const undoRow = changed ? h('button', { type: 'button', class: 'icon-btn ui-back', dataset: { action: 'ui-back', path: 'text' }, title: d.t('uiLook.back'), 'aria-label': d.t('uiLook.back'),
        onclick: () => {
          if (d.changed(key, 'text')) d.set(key, 'text', null);
          if (d.changed(key, 'fontSize')) d.set(key, 'fontSize', null);
        } }, icon('undo')) : null;
      parts.push(...row(d.t('uiLook.text'), 'ui-text-row', h('div', { class: 'ui-text-cells' }, textField(p.text, d.t('uiLook.text'), (v) => d.set(key, 'text', v), { part: 'ui-text' }), size), undoRow));
    }
    if (p.color !== null) parts.push(...row(d.t('uiLook.color'), 'ui-color-row', colourField(key, `${pre}color`, p.color, d.t('uiLook.color')), back(key, `${pre}color`)));
    if (p.background !== null || p.button) parts.push(...row(d.t('uiLook.fill'), 'ui-fill-row', colourField(key, `${pre}background`, p.background ?? '#000000', d.t('uiLook.fill')), back(key, `${pre}background`)));
    if (!st && p.sample) {
      const s = p.sample;
      // A value the game writes (a score, a timer) gets numbers; words get a long name. Both get Empty.
      // A bar (a UI drawn in the canvas with kind 'bar', studio-canvas-ui 2026-10-24): full, half, empty — said in words.
      const picks = s.bar ? ['1', '0.5', '0'] : [s.hint, s.value ? '999,999' : d.t('uiLook.sample.long'), ''].filter((x, i, a) => x !== null && x !== undefined && a.indexOf(x) === i) as string[];
      const word = (v: string) => (s.bar ? d.t(v === '1' ? 'uiLook.sample.full' : v === '0.5' ? 'uiLook.sample.half' : 'uiLook.sample.empty') : v === '' ? d.t('uiLook.sample.empty') : v);
      const chips = picks.map((v) => h('button', { type: 'button', class: 'pill ui-sample', 'aria-pressed': String(s.now === v), dataset: { sample: v || 'empty' },
        text: word(v), onclick: () => d.sample(key, s.now === v ? null : v) }));
      const own = s.bar ? null : textField(s.now !== null && !picks.includes(s.now) ? s.now : '', d.t('uiLook.sample.own'), (v) => d.sample(key, v === '' ? null : v), { part: 'ui-sample-own' });
      if (own) (own.querySelector('input') as HTMLInputElement).placeholder = d.t('uiLook.sample.ownHint');
      const off = s.now !== null ? h('button', { type: 'button', class: 'icon-btn ui-back', dataset: { action: 'ui-sample-off' }, title: d.t('uiLook.sample.off'), 'aria-label': d.t('uiLook.sample.off'), onclick: () => d.sample(key, null) }, icon('close')) : null;
      parts.push(...row(d.t('uiLook.sample'), 'ui-sample-row', h('div', { class: 'ui-samples' }, ...chips, own), off));
      parts.push(h('p', { class: 'muted note-line ui-sample-note', dataset: { part: 'ui-sample-note' }, text: d.t('uiLook.sample.note') }));
    }
    el = h('div', { class: 'fields ui-look', dataset: { part: 'ui-look', key } }, ...parts);
    if (!parts.length) el.hidden = true;
    return [el];
  }

  return {
    render,
    /**
     * New props came: draw the rows again in place — unless a field of them is being typed in (the typing wins; the
     * rows are drawn when it is done) or the colour picker is open.
     */
    refresh(key: string) {
      if (!el || !el.isConnected || forKey !== key) return false;
      if (el.contains(document.activeElement)) return true;
      const old = el;
      const [next] = render(key);
      old.replaceWith(next!);
      return true;
    },
  };
}
