// The keyboard shortcut sheet: every key of the editor in one place (basics pass, 2026-10-18). Opened with `?`, from
// the ⌘K row "Keyboard shortcuts", and closed with Esc, a press outside, or ×. The rows come from keymap.ts, the
// same table the tooltips and ⌘K print, so the sheet never lists a key that does not work.
//
// Look (the design review's measure: the tools quieter than the game): one glass plate
// over the game, the game dimmed behind it as for ⌘K (one thing to look at), no colour, names in the text grey and
// keys in the third grey, three columns on a PC (Edit · Tools · View), one on a phone. Only what applies to this game
// (no Height in 2D, the draw-order keys only in 2D).
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { KEYMAP, keysOf, type KeyGroup } from './keymap.ts';

export interface ShortcutSheetDeps {
  t(key: string): string;
  mac(): boolean;
  dim(): '2d' | '3d';
  /** The game has a UI layer (rows marked `ui` in the key table show only then). */
  hasUi?(): boolean;
  /** The game has levels (rows marked `levels` show only then). */
  hasLevels?(): boolean;
  /** Playing with a pause (the rows' `playing` names show then: P = Pause / Resume). */
  playing?(): boolean;
  /** Opened / closed (main.ts shows the scrim and tells the game what is covered). */
  changed(open: boolean): void;
}

export function createShortcutSheet(d: ShortcutSheetDeps) {
  const el = h('div', { class: 'keys-sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1', hidden: true, dataset: { part: 'shortcuts' } });
  let open = false;

  function render() {
    const title = h('h2', { id: 'studio-keys-title', text: d.t('keys.title') });
    el.setAttribute('aria-labelledby', 'studio-keys-title');
    const close = h('button', { type: 'button', class: 'icon-btn', dataset: { action: 'keys-close' }, 'aria-label': d.t('btn.close'), onclick: () => hide() }, icon('close'));
    const cols = h('div', { class: 'keys-cols' });
    // One column each; "Play" heads the camera's column (fix 1 ✕13: P · . · ` sat under "Camera"). A fourth column of
    // its own would wrap under Edit at the sheet's width and leave a hole.
    const columns: KeyGroup[][] = d.dim() === '2d' ? [['edit'], ['tools'], ['play', 'view'], ['layers']] : [['edit'], ['tools'], ['play', 'view']];
    for (const col of columns) {
      const holder = col.length > 1 ? h('div', { class: 'keys-col' }) : cols;
      if (holder !== cols) cols.append(holder);
      for (const g of col) {
        const dl = h('dl', { class: 'keys-list' });
        for (const k of KEYMAP.filter((x) => x.group === g && (!x.dim || x.dim === d.dim()) && (!x.ui || !!d.hasUi?.()) && (!x.levels || !!d.hasLevels?.()))) {
          const keys = keysOf(k.id, d.mac());
          // The grey line: when the key does this ("Nothing selected"), then the row's own note (keymap.ts `when`).
          const note = [k.when ? d.t(`keys.when.${k.when}`) : '', k.note ? d.t(k.note) : ''].filter(Boolean).join(' · ');
          dl.append(h('div', { class: 'keys-row', dataset: { key: k.id } },
            h('dt', {}, k.playing && d.playing?.() ? k.playing.map((x) => d.t(x)).join(' / ') : d.t(k.label || `keys.${k.id}`), note ? h('span', { class: 'keys-note', text: note }) : null),
            h('dd', {}, ...(k.mark && !keys.length ? [h('span', { class: 'keys-mark', 'aria-hidden': 'true' }, icon(k.mark))] : []),
              ...keys.flatMap((s, i) => [i ? h('span', { class: 'keys-or', text: ' ' }) : null, h('kbd', { text: s })]))));
        }
        // 2D adds a fourth group (draw order); the columns wrap (shell.css .keys-cols).
        holder.append(h('section', { class: `keys-group keys-${g}` }, h('h3', { text: d.t(`keys.group.${g}`) }), dl));
      }
    }
    el.replaceChildren(h('div', { class: 'keys-head' }, title, close), cols, h('p', { class: 'keys-foot', text: d.t('keys.foot') }));
  }

  function show() {
    render();
    open = true;
    el.hidden = false;
    d.changed(true);
    // Focus on the plate itself (so Esc reaches it and Tab starts inside), not on ×: a key-opened sheet would draw
    // the focus ring round × in orange, and orange means "what you selected" only (design review, colour rule).
    el.focus({ preventScroll: true });
  }
  function hide() {
    if (!open) return;
    open = false;
    el.hidden = true;
    d.changed(false);
  }
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      hide();
    }
  });
  return { el, show, hide, toggle: () => (open ? hide() : show()), isOpen: () => open, render: () => open && render() };
}
