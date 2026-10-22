// "+ Link an object"'s list (studio-motion-focus, 2026-10-23): the scene's objects to put in the picked object's motion.
// A request (2026-10-23): "sometimes I want it to work with other objects, so let me add the ones to link". The plate's rows are the
// picked object only; this is the way to add the others — from the list (a find field: a scene has hundreds of
// objects), or, while it is open, a click on the object in the game (timeline-wire.ts linkPick).
//
// WHY the ⋯ popover (timeline-more.ts) and not a menu of its own: the same glass, the same Esc / press-outside, the same
// place above the plate — only its left edge on the button's. A press in the game does not close it (the game is
// another document): that press is the "click it in the game" way.
// WHY the list's order is the scene list's (left column), not "moving ones first": what links is often still (a door,
// a lamp); the same order as the list the person already knows. A moving one says its motion's name, small.
import { h } from './dom.ts';

export interface LinkItem {
  key: string;
  label: string;
  /** Its motion's name ("Row"), or '' with none. */
  note: string;
}

/** Fill `el` (the popover) with the title, the find field and the objects; `pick` = one chosen. */
export function fillLinkList(el: HTMLElement, o: { title: string; find: string; none: string; items: LinkItem[]; focus: boolean; pick(key: string): void }) {
  const list = h('div', { class: 'tl-link-list', role: 'listbox', 'aria-label': o.title });
  const find = h('input', { type: 'search', class: 'tl-link-find', placeholder: o.find, 'aria-label': o.find, autocomplete: 'off', spellcheck: false, dataset: { part: 'tl-link-find' } });
  const draw = () => {
    const q = find.value.trim().toLowerCase();
    const its = o.items.filter((i) => !q || i.label.toLowerCase().includes(q) || i.key.toLowerCase().includes(q));
    list.replaceChildren(...(its.length
      ? its.map((i) => h('button', { type: 'button', class: 'tl-link-item', role: 'option', dataset: { part: 'tl-link-item', key: i.key }, onclick: () => o.pick(i.key) },
        h('span', { class: 'tl-link-name', text: i.label }), i.note ? h('span', { class: 'tl-clipname', text: i.note }) : null))
      : [h('p', { class: 'tl-link-none', text: o.none })]));
  };
  find.addEventListener('input', draw);
  find.addEventListener('keydown', (e) => {
    // Enter = the first one found; ↓ = into the list (Esc is the popover's: closes it).
    if (e.key === 'Enter') list.querySelector<HTMLButtonElement>('.tl-link-item')?.click();
    if (e.key === 'ArrowDown') (e.preventDefault(), list.querySelector<HTMLButtonElement>('.tl-link-item')?.focus());
    if (e.key !== 'Escape') e.stopPropagation();
  });
  list.addEventListener('keydown', (e) => {
    const its = [...list.querySelectorAll<HTMLButtonElement>('.tl-link-item')];
    const i = its.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = i + (e.key === 'ArrowDown' ? 1 : -1);
      (n < 0 ? find : its[Math.min(n, its.length - 1)])?.focus();
    }
  });
  draw();
  el.replaceChildren(h('div', { class: 'tl-link-title', text: o.title }), find, list);
  // A phone's keyboard would cover half the screen for a list one can just tap: the field takes the keys on a PC only.
  if (o.focus) find.focus({ preventScroll: true });
}
