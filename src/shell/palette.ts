// The ⌘K list: ask the AI, find an action, find an object — one field.
//
// Rebrand 2026-10-16 ("one list, one card, one input"). Before, the editor
// had a row of buttons for things used once in a while (Show all, View,
// Ideas for your AI, Undo, Redo, the language) and a separate "Ideas" page.
// Now the ask bar at the bottom of the game is also the way to reach every
// action: press it (or ⌘K / Ctrl+K anywhere) and it grows a list upward —
// "Ask your AI" (examples for what is picked, the AI's own steps), "Actions"
// (with their keys), "With KUMODeck", "In the scene" — that narrows as you
// type. The order of what Enter does is the rule that makes one field work
// for both:
//   1. a typed word that names an action or an object → that row is first;
//   2. otherwise the first row is "Ask your AI: “what you typed”", so a
//      sentence is never swallowed by an action that happens to share a word.
// The arrow keys move the highlight; Escape closes the list (a second Escape
// lets go of the field). Every row is a real button (data-action / data-step),
// so it can be reached without the keyboard too.
//
// AI feel (2026-10-16, play test stumble 6): the field is first a place to
// write to the AI. Pressing it no longer opens the list (it covered half the
// game before a word was typed). The list opens on ⌘K / Ctrl+K (or the ⌘K
// row, the phone's list button, ↑ / ↓ in the field), and while typing only
// when the typed word names an action or an object (`suggests`): then just
// those rows show, so "undo" still finds Undo and a sentence never opens it.
//
// Its own search field (design review wave 1, W1-4 / N7, 2026-10-17). Opened on purpose (⌘K, the "…" on a phone, the ⌘K row,
// ↑ / ↓ in the ask box), the list now has a search field of its own at its top, and what is typed goes there. Before,
// the ask box WAS the list's field: with Editor view open, ⌘K then "Editor view" put those words in the ask box with
// its send button live, one Enter (or one tap) from sending a search to the AI. Sending something by mistake is what
// loses trust fastest, so the ask box's text is never touched by the ⌘K list now; "Ask your AI: “…”" in that list only
// moves the words into the ask box (focused, not sent). Typing in the ask box still shows suggestions (the `typed`
// mode below), and those still read the ask box: there the words were written in it on purpose.
import { h } from './dom.ts';
import { icon } from './icons.ts';

export type PaletteSection = 'ask' | 'actions' | 'kumodeck' | 'objects';

export interface PaletteRow {
  id: string;
  section: PaletteSection;
  label: string;
  /** Icon name (icons.ts), or a picture (objects). */
  icon?: string;
  thumb?: string | null;
  /** Key hint at the right end ("P", "⌘Z") or a count. */
  hint?: string;
  /** Extra words that find it ("undo" finds "Undo"; Japanese and English both). */
  words?: string;
  /** data-* on the row (data-action, data-step…), for tests and .studio/ui/. */
  data?: Record<string, string>;
  run(): void;
}

export interface PaletteDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  /** The ask field: read for suggestions while typing in it; the ⌘K list has its own search field (`search`). */
  input: HTMLInputElement;
  /** Every row that applies now (what is picked, what can be undone…). */
  rows(): PaletteRow[];
  /** "Ask your AI: …" — send the typed words (the ask form's own submit). */
  ask(): void;
  /** The list opened or closed (the shell dims the game behind it, but not for typed suggestions). */
  changed(open: boolean, typed?: boolean): void;
}

export interface Palette {
  el: HTMLElement;
  open(): void;
  close(): void;
  isOpen(): boolean;
  render(): void;
  /** The ⌘K list's own search field (W1-4). */
  search: HTMLInputElement;
}

const fold = (s: string) => s.toLowerCase().normalize('NFKC');

/**
 * How well a row matches the typed text: 2 = a word of the row starts with
 * it, 1 = it appears inside, 0 = no. Only short queries match actions and
 * objects (up to 3 words, 24 characters): a sentence is a request to the AI.
 */
export function matchScore(query: string, row: { label: string; words?: string }): number {
  const q = fold(query.trim());
  if (!q) return 0;
  if (q.length > 24 || q.split(/\s+/).length > 3) return 0;
  const hay = fold(`${row.label} ${row.words || ''}`);
  if (hay.split(/[\s/:·()「」“”,、.-]+/).some((w) => w && w.startsWith(q))) return 2;
  return hay.includes(q) ? 1 : 0;
}

/** What typing may suggest: the editor's own actions and the objects (KUMODeck steps and the AI's examples wait for ⌘K). */
const SUGGEST_SECTIONS: PaletteSection[] = ['actions', 'objects'];

/** Shortest typed word that may open the list by itself ("Ma" would match half the actions). */
export const SUGGEST_MIN = 3;

/**
 * Should typing open the list? Only when the text is a short query (matchScore's rule) that starts
 * a word of an action or an object: the AI's own examples ("Make it night") and the KUMODeck steps
 * do not count (the examples are sentences the person is about to write themselves).
 */
export function suggests(query: string, rows: Array<{ section: PaletteSection; label: string; words?: string }>): boolean {
  // Japanese (and other non-Latin) words are short: the Japanese word for "Assets" is two characters.
  const q = query.trim();
  if (q.length < (/[^\u0000-\u007f]/.test(q) ? 2 : SUGGEST_MIN)) return false;
  return rows.some((r) => SUGGEST_SECTIONS.includes(r.section) && matchScore(query, r) === 2);
}

export function createPalette(d: PaletteDeps): Palette {
  // The list's own field (W1-4), shown only when the list was opened on purpose; the rows go in `list` under it.
  const search = h('input', { type: 'text', class: 'p-search', dataset: { part: 'palette-search' }, autocomplete: 'off', spellcheck: 'false',
    enterkeyhint: 'go', placeholder: d.t('pal.search'), 'aria-label': d.t('pal.search'), role: 'combobox', 'aria-controls': 'studio-palette-list',
    'aria-expanded': 'true', 'aria-autocomplete': 'list' }) as HTMLInputElement;
  const list = h('div', { class: 'p-list', role: 'listbox', id: 'studio-palette-list', 'aria-label': d.t('pal.title') });
  const el = h('div', { class: 'palette', id: 'studio-palette', hidden: true }, search, list);
  let open = false;
  // Opened by typing (suggestions only) or on purpose (⌘K: everything).
  let typed = false;
  let rows: PaletteRow[] = [];
  let at = 0;

  const SECTIONS: PaletteSection[] = ['ask', 'actions', 'kumodeck', 'objects'];

  /** The field the rows are read from: the ask box for suggestions while typing in it, else the list's own field. */
  const field = () => (typed ? d.input : search);
  const build = (): PaletteRow[] => {
    const q = field().value.trim();
    const all = d.rows();
    if (!q) {
      // Nothing typed: the ask examples and the actions; objects only when searched.
      return all.filter((r) => r.section !== 'objects');
    }
    const scored = all.map((r) => ({ r, s: matchScore(q, r) })).filter((x) => x.s > 0);
    scored.sort((a, b) => b.s - a.s || SECTIONS.indexOf(a.r.section) - SECTIONS.indexOf(b.r.section));
    // From the ask box (typed): send it, as before. From the list's own field: put the words in the ask box and go
    // there, nothing sent (W1-4) — the person sends with their own Enter.
    const askRow: PaletteRow = {
      id: 'ask-text', section: 'ask', label: d.t('pal.askThis', { text: q.length > 60 ? q.slice(0, 59) + '…' : q }), icon: 'spark', hint: '↵',
      data: { action: 'ask-ai' }, run: typed ? () => d.ask() : () => {
        d.input.value = q;
        d.input.dispatchEvent(new Event('input', { bubbles: true }));
        d.input.focus();
      },
    };
    const found = scored.map((x) => x.r);
    // Opened by typing: only what the word named, then "Ask your AI: …" (Enter on a sentence is never taken).
    if (typed) return [...found.filter((r) => SUGGEST_SECTIONS.includes(r.section)), askRow];
    // Rule 2 above: the typed sentence comes first unless a word named something.
    return scored.length && scored[0]!.s === 2 ? [...found, askRow] : [askRow, ...found];
  };

  const render = () => {
    list.replaceChildren();
    search.hidden = typed;
    if (!open) return;
    rows = build();
    at = Math.max(0, Math.min(at, rows.length - 1));
    let last: PaletteSection | null = null;
    rows.forEach((r, i) => {
      if (r.section !== last && !(i === 0 && r.id === 'ask-text')) {
        list.append(h('div', { class: 'p-sec', role: 'presentation', text: d.t(`pal.${r.section}`) }));
      }
      last = r.section;
      const pic = r.thumb ? h('img', { class: 'thumb', alt: '', width: 16, height: 16, src: r.thumb }) : r.icon ? icon(r.icon) : h('span', { class: 'p-blank' });
      const b = h('button', { type: 'button', class: `p-row${i === at ? ' on' : ''}${r.section === 'ask' ? ' ai' : ''}`, role: 'option', 'aria-selected': String(i === at),
        id: `studio-pal-${i}`, dataset: { ...(r.data || {}), row: r.id },
        // mousedown, not click: the field must keep focus (a blur would close the list first).
        onmousedown: (e: Event) => e.preventDefault(),
        onclick: () => runAt(i) },
      pic, h('span', { class: 'p-label', text: r.label }), r.hint ? h('span', { class: 'p-k', text: r.hint }) : null);
      list.append(b);
    });
    field().setAttribute('aria-activedescendant', rows.length ? `studio-pal-${at}` : '');
    list.querySelector('.p-row.on')?.scrollIntoView({ block: 'nearest' });
  };

  const runAt = (i: number) => {
    const r = rows[i];
    if (!r) return;
    const wasTyped = typed;
    if (r.id !== 'ask-text') {
      // Suggestions: the word in the ask box was a search, so it goes. The ⌘K list never touches the ask box (W1-4).
      if (wasTyped) d.input.value = '';
      // Let go of the field: arrow keys move the picked object again, and the next press reopens the list.
      field().blur();
    }
    close();
    r.run();
  };

  const setOpen = (on: boolean, byTyping = false) => {
    if (on && open && typed && !byTyping) {
      // ⌘K while suggestions show: the whole list, in its own field (the words come along; the ask box keeps them too).
      typed = false;
      search.value = d.input.value;
      render();
      search.focus();
      d.changed(true, false);
      return;
    }
    if (open === on) return;
    open = on;
    typed = on && byTyping;
    el.hidden = !on;
    d.input.setAttribute('aria-expanded', String(on && typed));
    if (on) at = 0;
    if (!on) search.value = '';
    render();
    if (on && !typed) search.focus();
    d.changed(on, typed);
  };
  function close() {
    setOpen(false);
  }

  d.input.setAttribute('role', 'combobox');
  d.input.setAttribute('aria-controls', el.id);
  d.input.setAttribute('aria-expanded', 'false');
  d.input.setAttribute('aria-autocomplete', 'list');
  // No open on focus or click (see the top): the field is for writing to the AI.
  // A press on the page outside the bar closes it (the rows keep focus in the field, see mousedown above).
  // (Only the suggestions belong to the ask box; ⌘K moving the focus to the list's own field must not close it.)
  d.input.addEventListener('blur', () => {
    if (typed) setOpen(false);
  });
  search.addEventListener('blur', () => {
    if (!typed) setOpen(false);
  });
  search.addEventListener('input', () => {
    at = 0;
    render();
  });
  d.input.addEventListener('input', () => {
    at = 0;
    const q = d.input.value;
    if (open && !typed) {
      render();
      return;
    }
    // Suggestions come and go with the word: open while it names something, closed for a sentence.
    if (suggests(q, d.rows())) {
      if (!open) setOpen(true, true);
      else render();
    } else if (open) setOpen(false);
  });
  // Capture phase: runs before the ask box's own Enter / Escape handling.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.preventDefault();
      // stopPropagation too: the page's Escape (close Ideas / Editor view) waits for the next press.
      e.stopImmediatePropagation();
      e.stopPropagation();
      close();
      return;
    }
    if (!open) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!rows.length) return;
      at = (at + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
      render();
    } else if (e.key === 'Enter' && !e.isComposing) {
      const r = rows[at];
      // The typed request goes through the form (its own checks, its note). From the list's own field the ask row
      // only moves the words into the ask box (runAt below), so it is run like any row.
      if (!r || (r.id === 'ask-text' && typed)) {
        close();
        return;
      }
      e.preventDefault();
      runAt(at);
    }
  };
  d.input.addEventListener('keydown', onKey, true);
  search.addEventListener('keydown', (e) => {
    onKey(e);
    // Keys typed in the list's field are the list's (the editor's single-key shortcuts must not see them).
    e.stopPropagation();
  });

  return {
    el,
    search,
    open: () => setOpen(true),
    close,
    isOpen: () => open,
    render,
  };
}
