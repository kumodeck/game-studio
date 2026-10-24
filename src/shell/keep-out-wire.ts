// Keep-out areas on the card (studio-code-keepout, 2026-10-24; the plan's step 3). Need 4 of 10/24: "when things are
// placed procedurally I want to mark NG areas — sometimes as coordinates, sometimes expressed as code". Under a rule
// layout's block ("Layout  Scatter · 12  [Rule]"):
//
//   Keep-out areas
//   [●] ▨ Box 1                       Hand   ⋯ ×      a box drawn on the ground (orange: the hand's)
//   [●] ▨ On the road                 Rule   ⋯        the layout's own codeAvoid() (violet dashed: a rule's)
//   [●] ▨ From the player [5 m] within Rule  ⋯ ×      a condition the AI added; its number is a knob
//   1 of 12 has no place to go
//   [+ Draw a box]  [✦ Describe with text]
//
// - the switch: off / on (a code's own condition off = `{ code, off: true }` in the file); × takes a row the file holds out
//   (the code's own conditions have none: they are switched off — keep-out-model.ts canRemove says why);
// - ⋯ "Also for <layout>": answer (a) of 10/24 — an area acts on its own layout only — so reaching a second
//   layout is said, never implied;
// - + Draw a box: the game page takes the next drag on the ground (bridge/keep-out.ts): the objects step out of the box
//   while it is drawn, and its end is one ⌘Z, one Save count ("Added “Box 1” to crystal's keep-out areas (2 moved out)");
// - ✦ Describe with text: the ask field gets the chips "crystal ×12" "Keep-out areas"; the request carries the layout
//   and its areas (`places`, `intent: 'avoid'`); the AI writes a codeAvoid() and adds it with `--do place.avoid` — the row
//   that arrives glows violet (main.ts calls aiChanged after a hands job's change).
// Every change is one ⌘Z and one Save count per layout (the plan's decision 16), like the layout's knobs (code-place-wire.ts).
// The words are "rule" for code (chosen on 10/24): the card never says "code".
import type { CodeAvoidInfo, CodePlaceInfo, PlacementPlace, RequestPlace, ShellToBridge } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { knobEl } from './knob.ts';
import type { PlaceStore } from './code-places.ts';
import { MAX_AVOID, addBox, canRemove, changedRows, copyRowTo, knobRow, knobsNow, nextBoxName, removeRow, rowKey, rowsOf, setBox, switchRow, type AvoidRow } from './keep-out-model.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;
type Entry = PlacementPlace | null;

export interface KeepOutWireDeps {
  t: T;
  /** The game page's rule layouts and keep-out conditions (studio:code-places). */
  list(): CodePlaceInfo[];
  avoids(): CodeAvoidInfo[];
  /** This level's `places` (the world model's PlaceStore). */
  store(): PlaceStore;
  send(m: ShellToBridge): void;
  /** One change of layout `id`'s entry: one undo step, laid out in the game (main.ts setPlace). */
  commit(id: string, from: Entry, to: Entry): void;
  /** Lay these layouts out again in the game with the draft (code-place-wire layout; a knob turned live). */
  layout(ids: string[]): void;
  /** A live change shown: the Save count, and the card when `card` (not under the card's own pointer). */
  changed(card: boolean): void;
  /** The line over the ask field ("… · ⌘Z undoes it"). */
  told(text: string): void;
  selected(): string | null;
  /** The world is on screen and editable. */
  editing(): boolean;
  /** "✦ Describe with text": the ask field about layout `id`'s keep-out areas. Absent (no AI here): no button. */
  ask?(id: string): void;
  /** The ⋯'s menu plate under `at`. */
  menu(at: HTMLElement, rows: Array<{ id: string; label: string; run(): void }>): void;
}

export interface KeepOutWire {
  /** The card's "Keep-out areas" for `key` (an object of a rule layout, not placed individually), or null. */
  block(key: string): HTMLElement | null;
  /** "Inside a keep-out area" for an object of a layout put by hand ("just this one") that stands in one, or null. */
  pinnedLine(key: string): HTMLElement | null;
  /** studio:place/avoid for the picked object's layout (when it changed, or `force`). */
  sync(force?: boolean): void;
  /** studio:place/avoid-box from the game page: a box drawn / moved / resized (live, then one undo step). */
  box(m: { id: string; i: number; p: number[]; size: number[]; end: boolean; out?: number; cancel?: boolean }): void;
  /** studio:place/avoid-knob: the ◇ of a condition dragged (live, then one undo step). */
  knob(m: { id: string; code: string; knob: string; v: number; end: boolean }): void;
  /** studio:place/avoid-inside: the layout's hand-put objects standing in one of its areas. */
  inside(m: { id: string; keys: string[] }): void;
  /** The layout "+ Draw a box" is on for, or null. */
  drawing(): string | null;
  /** Stop drawing (Esc, the button again, the game said so). true = it was on. */
  stopDraw(): boolean;
  /** A hands job changed layout `id`'s entry (the AI's place.avoid): the rows it added or changed glow violet. */
  aiChanged(id: string, before: Entry, after: Entry): void;
  /** The layout and its areas for a request (✦ Describe with text). */
  request(id: string): RequestPlace | null;
  /** The ask chip's words for layout `id` ("crystal ×12"). */
  chip(id: string): string;
}

/** How long a row the AI added stays lit (the same 2.4 s as the AI's light round the ask field). */
const LIT_MS = 2400;

export function createKeepOutWire(d: KeepOutWireDeps): KeepOutWire {
  const t = d.t;
  let drawingId: string | null = null;
  // A live change (a knob turned, a box being drawn or dragged): the entry before it, for the one undo step at its end.
  let liveFrom: { id: string; entry: Entry } | null = null;
  // The box being drawn now (its row says "drawing"), its name fixed when the drag began.
  let drawingBox: { id: string; name: string } | null = null;
  let sentSig = '';
  const inside = new Map<string, string[]>();
  const lit = new Map<string, number>();

  const layoutOf = (key: string) => d.list().find((p) => p.keys.includes(key)) ?? null;
  const info = (code: string) => d.avoids().find((a) => a.code === code) ?? null;
  const entry = (id: string): Entry => d.store().get(id);
  const unit = (u: string) => (u ? t(`hands.unit.${u}`) : '');
  const boxName = (n: number) => t('place.boxName', { n });

  function setLive(id: string, next: Entry, card: boolean) {
    if (!liveFrom || liveFrom.id !== id) liveFrom = { id, entry: d.store().get(id) };
    d.store().set(id, next);
    d.changed(card);
  }
  function endLive(id: string, next: Entry) {
    const from = liveFrom && liveFrom.id === id ? liveFrom.entry : d.store().get(id);
    liveFrom = null;
    d.store().set(id, from);
    d.commit(id, from, next);
  }
  /** The entry a live change starts from (before the drag), so a drag's steps replace each other, never add up. */
  const base = (id: string): Entry => (liveFrom && liveFrom.id === id ? liveFrom.entry : entry(id));

  /** The row's words: "Box 1", "On the road", or a condition with its knobs between its two halves. */
  function rowWords(p: CodePlaceInfo, row: AvoidRow): Array<Node | string> {
    if (row.kind === 'box') {
      const name = row.name ?? boxName(row.n);
      return [drawingBox && drawingBox.id === p.id && drawingBox.name === name ? `${name} ${t('keepout.drawingRow')}` : name];
    }
    const c = info(row.code);
    if (!c) return [`${row.code} `, h('span', { class: 'muted', text: t('keepout.missing') })];
    const now = knobsNow(c.knobs, row.knobs);
    const knobs = Object.entries(c.knobs).map(([name, k]) => knobEl({
      label: k.label, unit: unit(k.unit), v: now[name]!, min: k.min, max: k.max, step: k.step, tip: t('rule.knobTip'), part: `ko-knob-${row.code}-${name}`,
      set: (v, end) => {
        const r = rowsOf(p.avoid, base(p.id)).find((x) => x.kind === 'code' && x.code === row.code) ?? row;
        const next = knobRow(base(p.id), r, name, v, c.knobs);
        if (!end) {
          setLive(p.id, next, false);
          d.layout([p.id]);
        } else endLive(p.id, next);
      },
    }));
    return [c.name, ...knobs, ...(c.after ? [c.after] : [])];
  }

  /** The words of a row as one line (a toast, the ⋯ menu): knobs as numbers. */
  function rowText(row: AvoidRow): string {
    if (row.kind === 'box') return row.name ?? boxName(row.n);
    const c = info(row.code);
    if (!c) return row.code;
    const now = knobsNow(c.knobs, row.knobs);
    const ks = Object.entries(c.knobs).map(([n, k]) => `${Math.round(now[n]! * 100) / 100}${unit(k.unit)}`);
    return [c.name, ...ks, c.after ?? ''].filter(Boolean).join(' ');
  }

  function rowEl(p: CodePlaceInfo, row: AvoidRow): HTMLElement {
    const on = !row.off;
    const k = rowKey(row);
    const sw = h('button', { type: 'button', class: 'ko-sw', role: 'switch', 'aria-checked': String(on), title: t(on ? 'keepout.offTip' : 'keepout.onTip'),
      'aria-label': `${rowText(row)}: ${t(on ? 'keepout.offTip' : 'keepout.onTip')}`, dataset: { part: 'ko-sw' },
      onclick: () => d.commit(p.id, entry(p.id), switchRow(entry(p.id), row, !on)) }, h('i', {}));
    const mark = h('span', { class: `ko-mark ${row.kind}`, 'aria-hidden': 'true' });
    const words = h('span', { class: 'ko-words', title: rowText(row) }, ...rowWords(p, row));
    const tag = h('span', { class: `ko-tag ${row.kind}`, title: t(row.kind === 'box' ? 'keepout.handTip' : 'keepout.ruleTip'), text: t(row.kind === 'box' ? 'keepout.hand' : 'keepout.rule') });
    const others = d.list().filter((x) => x.id !== p.id);
    const more = others.length ? h('button', { type: 'button', class: 'icon-btn ko-more', title: t('keepout.more'), 'aria-label': t('keepout.more'), dataset: { part: 'ko-more' },
      onclick: (e: Event) => d.menu(e.currentTarget as HTMLElement, others.slice(0, 8).map((o) => ({ id: `ko-also-${o.id}`, label: t('keepout.alsoFor', { name: o.name }), run: () => alsoFor(p, row, o) }))) }, icon('more')) : null;
    const x = canRemove(row) ? h('button', { type: 'button', class: 'icon-btn ko-x', title: t('keepout.remove'), 'aria-label': `${rowText(row)}: ${t('keepout.remove')}`, dataset: { part: 'ko-x' },
      onclick: () => d.commit(p.id, entry(p.id), removeRow(entry(p.id), row)) }, '×') : h('span', { class: 'ko-x-gap', 'aria-hidden': 'true' });
    const el = h('div', { class: `ko-row${on ? '' : ' off'}`, dataset: { part: 'ko-row', row: k } }, sw, mark, words, tag, more, x);
    // The row the AI just added or changed: violet for a moment, picked up where it was if the card is drawn again.
    const until = lit.get(`${p.id}\n${k}`);
    if (until && until > Date.now()) {
      el.classList.add('lit');
      el.style.animationDelay = `${-(LIT_MS - (until - Date.now()))}ms`;
    }
    return el;
  }

  /** "Also for <layout>": the row copied to another layout's list (one ⌘Z). */
  function alsoFor(p: CodePlaceInfo, row: AvoidRow, o: CodePlaceInfo) {
    const to = copyRowTo(entry(o.id), o.avoid, row);
    if (!to) return d.told(t('keepout.alsoHas', { what: rowText(row), name: o.name }));
    d.commit(o.id, entry(o.id), to);
    d.told(t('keepout.alsoDone', { what: rowText(row), name: o.name }));
  }

  function block(key: string): HTMLElement | null {
    const p = layoutOf(key);
    if (!p || entry(p.id)?.hand) return null;
    const rows = rowsOf(p.avoid, entry(p.id));
    const full = (entry(p.id)?.avoid?.length ?? 0) >= MAX_AVOID;
    const drawOn = drawingId === p.id;
    const draw = h('button', { type: 'button', class: `ko-add${drawOn ? ' on' : ''}`, 'aria-pressed': String(drawOn), disabled: full && !drawOn,
      title: full ? t('keepout.full', { n: MAX_AVOID }) : t('keepout.drawTip'), dataset: { part: 'ko-draw' },
      onclick: () => (drawOn ? stopDraw() : startDraw(p.id)) }, t('keepout.draw'));
    const ask = d.ask ? h('button', { type: 'button', class: 'ko-add ai', title: t('keepout.describeTip'), dataset: { part: 'ko-describe' },
      onclick: () => d.ask!(p.id) }, t('keepout.describe')) : null;
    const all = p.keys.length + p.skipped.length;
    const head = h('div', { class: 'ko-head', title: t('keepout.titleTip') }, t('keepout.title'));
    // None yet: the title and the two buttons on ONE line. WHY: a phone's card grew by the list's height for every rule
    // layout, and its sheet then covered the very object picked (the step-2 phone run, 10/24); the card stays as short
    // as it was until an area is wanted.
    if (!rows.length) {
      return h('div', { class: 'ko-block one', dataset: { part: 'ko', id: p.id } }, h('div', { class: 'ko-foot' }, head, draw, ask),
        p.skipped.length ? h('p', { class: 'note-line ko-skipped', dataset: { part: 'ko-skipped' }, text: t('keepout.skipped', { n: p.skipped.length, all }) }) : null,
        drawOn ? h('p', { class: 'muted ko-hint', text: t('keepout.drawHint') }) : null);
    }
    return h('div', { class: 'ko-block', dataset: { part: 'ko', id: p.id } }, head,
      h('div', { class: 'ko-rows' }, ...rows.map((r) => rowEl(p, r))),
      p.skipped.length ? h('p', { class: 'note-line ko-skipped', dataset: { part: 'ko-skipped' }, text: t('keepout.skipped', { n: p.skipped.length, all }) }) : null,
      h('div', { class: 'ko-foot' }, draw, ask),
      drawOn ? h('p', { class: 'muted ko-hint', text: t('keepout.drawHint') }) : null);
  }

  function startDraw(id: string) {
    drawingId = id;
    sync(true);
    d.changed(true);
  }
  function stopDraw(): boolean {
    if (!drawingId) return false;
    drawingId = null;
    drawingBox = null;
    sync(true);
    d.changed(true);
    return true;
  }

  function sync(force = false) {
    const key = d.editing() ? d.selected() : null;
    const p = key ? layoutOf(key) : null;
    const id = p && !entry(p.id)?.hand ? p.id : null;
    if (drawingId && drawingId !== id) (drawingId = null), (drawingBox = null);
    const m: ShellToBridge = { type: 'studio:place/avoid', id, entry: id ? entry(id) : null, draw: !!id && drawingId === id };
    const sig = JSON.stringify(m);
    if (sig === sentSig && !force) return;
    if (!id && !sentSig) return;
    sentSig = id ? sig : '';
    d.send(m);
  }

  return {
    block,
    pinnedLine(key) {
      const p = layoutOf(key);
      if (!p || !inside.get(p.id)?.includes(key)) return null;
      return h('p', { class: 'ko-inside', title: t('keepout.insideTip'), dataset: { part: 'ko-inside' } }, h('span', { class: 'ko-mark box', 'aria-hidden': 'true' }), t('keepout.inside'));
    },
    sync,
    box(m) {
      const p = d.list().find((x) => x.id === m.id);
      if (!p) return;
      if (m.cancel) {
        // Esc in the middle of a drag: the entry as it was, no undo step; the game page put the objects back already.
        if (liveFrom && liveFrom.id === m.id) d.store().set(m.id, liveFrom.entry);
        liveFrom = null;
        drawingBox = null;
        if (m.i === -1) drawingId = null;
        sync(true);
        d.changed(true);
        return;
      }
      const from = base(m.id);
      const box = { p: m.p, size: m.size };
      if (m.i === -1 && !drawingBox) drawingBox = { id: m.id, name: nextBoxName(from, boxName) };
      const next = m.i === -1 ? addBox(from, box, drawingBox!.name) : setBox(from, m.i, box);
      // Live: the card and the Save count only — the game page has laid the layout out itself (its objects step out).
      if (!m.end) return setLive(m.id, next, true);
      const name = drawingBox?.name;
      drawingBox = null;
      endLive(m.id, next);
      if (m.i === -1) {
        drawingId = null;
        d.told(m.out ? t('keepout.addedOut', { name: p.name, what: name ?? '', n: m.out }) : t('keepout.added', { name: p.name, what: name ?? '' }));
      }
      sync(true);
    },
    knob(m) {
      const p = d.list().find((x) => x.id === m.id);
      const c = info(m.code);
      if (!p || !c || !(m.knob in c.knobs)) return;
      const row = rowsOf(p.avoid, base(m.id)).find((x) => x.kind === 'code' && x.code === m.code);
      if (!row) return;
      const next = knobRow(base(m.id), row, m.knob, m.v, c.knobs);
      if (!m.end) {
        setLive(m.id, next, true);
        d.layout([m.id]);
      } else endLive(m.id, next);
    },
    inside(m) {
      const was = JSON.stringify(inside.get(m.id) ?? []);
      if (m.keys.length) inside.set(m.id, m.keys.slice());
      else inside.delete(m.id);
      if (was !== JSON.stringify(m.keys)) d.changed(true);
    },
    drawing: () => drawingId,
    stopDraw,
    aiChanged(id, before, after) {
      const p = d.list().find((x) => x.id === id);
      if (!p) return;
      const until = Date.now() + LIT_MS;
      for (const k of changedRows(p.avoid, before, after)) lit.set(`${id}\n${k}`, until);
    },
    request(id) {
      const p = d.list().find((x) => x.id === id);
      if (!p) return null;
      const e = entry(id);
      const knobs = Object.fromEntries(Object.entries(p.knobs).map(([n, k]) => [n, e?.knobs?.[n]?.v ?? k.v]));
      return {
        id, name: p.name, n: p.keys.length, ...(Object.keys(knobs).length ? { knobs } : {}),
        avoid: rowsOf(p.avoid, e).map((r) => {
          if (r.kind === 'box') return { box: { p: r.box.p.slice(), size: r.box.size.slice() }, ...(r.name ? { name: r.name } : {}), ...(r.off ? { off: true as const } : {}) };
          const c = info(r.code);
          return { code: r.code, ...(c ? { name: rowText(r) } : {}), ...(c && Object.keys(c.knobs).length ? { knobs: knobsNow(c.knobs, r.knobs) } : {}), ...(r.off ? { off: true as const } : {}) };
        }),
      };
    },
    chip(id) {
      const p = d.list().find((x) => x.id === id);
      return p ? `${p.name} ×${p.keys.length + p.skipped.length}` : id;
    },
  };
}
