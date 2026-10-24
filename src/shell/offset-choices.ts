// The four choices under a rule drag, and the card's offset rows (studio-offsets, 2026-10-24; the plan's decisions 1, 5,
// 6 and its first picture).
//
// WHY (the CRYSTAL FIELD try that day): "a lamp dragged away from the road did nothing" — now every lamp follows
// from the drag's first step (bridge/code-place.ts), and when the finger lets go, the line where Studio always speaks
// (over the ask field) offers how the rest should have followed: All the same (or the code knob's name) · Zigzag ·
// Ramp · Just this one, and ✦ Make this way a knob. Nothing has to be pressed (the drag did the first); a pointer over
// one shows that shape in place; a press (or key 1–4) swaps it IN THE SAME ⌘Z (undo.ts retarget); Esc or the next
// action closes them. Ramp is dim when the nearest one was dragged ("ramps start from the nearest"); a layout that is
// not a row has All the same and Just this one only (zigzag and ramp need an order). NOT beside the object: there it
// hid the front of the row the person wants to see (tried in the plan's mock).
//
// The card's rows (decision 6): each offset under the code's knobs — its dot picture, "Sideways · Zigzag width", a
// number box (the knobs' part: drag left / right, press to type), ✦ and ⋯ Remove. Violet like the knobs (both are the
// rule); the dot picture alone tells the editor's from the code's. A new row lights once.
import type { CodePlaceInfo, Dim, OffsetHow, OffsetWay, PlacementPlace, PlaceOffset, Pose } from '../contract.ts';
import { h } from './dom.ts';
import { knobEl } from './knob.ts';
import { addOffset, type OffsetAmount } from './offset-model.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;
type Pin = NonNullable<PlacementPlace['pins']>[string];

const SVG = 'http://www.w3.org/2000/svg';
/**
 * The small picture of how five objects are shifted (the plan's first picture): all the same, every other one, a little more
 * each one, just one. Drawn in currentColor (violet on the card, the line's colour in the choices).
 */
export function offsetPic(kind: OffsetHow | 'one'): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 30 12');
  svg.setAttribute('width', '30');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('off-pic');
  for (let i = 0; i < 5; i++) {
    const y = kind === 'same' ? 6 : kind === 'zigzag' ? (i % 2 ? 3 : 9) : kind === 'ramp' ? 10 - i * 2 : i === 2 ? 3 : 9;
    const c = document.createElementNS(SVG, 'circle');
    c.setAttribute('cx', String(3 + i * 6));
    c.setAttribute('cy', String(y));
    c.setAttribute('r', kind === 'one' && i === 2 ? '2.4' : '1.8');
    c.setAttribute('fill', 'currentColor');
    if (kind === 'one' && i !== 2) c.setAttribute('opacity', '.45');
    svg.append(c);
  }
  return svg;
}

/** What studio:place/dragged told (contract BridgeToShell): the four choices are made from it. */
export interface Dragged {
  id: string;
  key: string;
  way: OffsetWay;
  d: number | [number, number];
  rank: number;
  row: boolean;
  did: 'knob' | OffsetHow;
  knob?: string;
  pose: Pose;
  skipped?: number;
}

export interface OffsetChoicesDeps {
  t: T;
  dim(): Dim;
  place(id: string): CodePlaceInfo | null;
  /** The object's name as the list says it ("Street lamps 3"). */
  name(key: string): string;
  /** A pose as a pin (the file's rounding). */
  pinOf(pose: Pose): Pin;
  /** Put this entry in the draft and lay the layout out (no undo step): a pointer over a choice, or a choice made. */
  show(id: string, e: PlacementPlace | null): void;
  /** The drag's undo step ends at `e` now (the same ⌘Z), and the Save count / card follow. */
  retarget(id: string, e: PlacementPlace | null): void;
  /** ✦ Make this way a knob: a draft in the chat box (nothing is sent; the AI's side is stage 3). */
  ask?(draft: string): void;
  /** The choices opened / closed: the game page's keys 1–4 and Esc are theirs while open (studio:place/choices). */
  opened(on: boolean): void;
  /** "Placed Street lamps 5 by hand" with Reset to rule (code-place-wire's pin words). */
  pinned?(key: string): void;
}

interface Choice {
  id: 'first' | 'zigzag' | 'ramp' | 'one';
  label: string;
  pic: OffsetHow | 'one';
  tip: string;
  /** The layout's entry with this choice; null = it cannot say this drag (a ramp from the nearest). */
  entry: PlacementPlace | null;
}

/**
 * Each choice keeps its key whatever is offered (a layout that is not a row has 1 and 4 only): the hand learns "4 = just
 * this one" once (the plan: keys 1–4 for the four).
 */
const KEY_OF: Record<Choice['id'], number> = { first: 1, zigzag: 2, ramp: 3, one: 4 };

export interface OffsetChoices {
  el: HTMLElement;
  /** The drag's step is committed (from `e0` to `now`): show the four. */
  open(m: Dragged, e0: PlacementPlace | null, now: PlacementPlace | null): void;
  close(): void;
  isOpen(): boolean;
  /** Choice 1–4 (a key: 1 All the same / the knob, 2 Zigzag, 3 Ramp, 4 Just this one): true = taken. */
  choose(n: number): boolean;
}

/** "Sideways +1.0 m" / "Turn +15°" / "Size ×1.20" / "Position X +1.0 Z −0.5 m": what a drag did, for the line. */
export function amountWords(t: T, way: OffsetWay, d: number | [number, number], dim: Dim): string {
  const u = t(`hands.unit.${dim === '3d' ? 'm' : 'px'}`);
  const dp = dim === '3d' ? 1 : 0;
  const sg = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(dp)}`;
  if (Array.isArray(d)) return `${t('offset.way.move')} ${dim === '3d' ? 'X' : 'x'} ${sg(d[0])} ${dim === '3d' ? 'Z' : 'y'} ${sg(d[1])}${u}`;
  if (way === 'turn') return `${t('offset.way.turn')} ${d < 0 ? '−' : '+'}${Math.abs(Math.round(d))}°`;
  if (way === 'size') return `${t('offset.way.size')} ×${d.toFixed(2)}`;
  return `${t(`offset.way.${way}`)} ${sg(d)}${u}`;
}

const tidy = (e: PlacementPlace): PlacementPlace | null => {
  const o = structuredClone(e);
  if (!o.offsets?.length) delete o.offsets;
  if (o.pins && !Object.keys(o.pins).length) delete o.pins;
  return Object.keys(o).length ? o : null;
};

export function createOffsetChoices(d: OffsetChoicesDeps): OffsetChoices {
  const t = d.t;
  // Made when first asked for (main.ts puts it in the news card): the wire's tests run without a page.
  let made: HTMLElement | null = null;
  const box = () => (made ??= h('div', { class: 'offset-choices', role: 'group', 'aria-label': t('offset.title'), dataset: { part: 'offset-choices' }, hidden: true }));
  let state: { m: Dragged; list: Choice[]; on: number; peek: number | null; lead: string } | null = null;

  /** The four for this drag (decision 1, 5): from the layout's entry before it (`e0`) and what the drag did (`now`). */
  function choicesFor(m: Dragged, e0: PlacementPlace | null, now: PlacementPlace | null): Choice[] {
    const base = e0 ?? {};
    const amt = { way: m.way, d: m.d } as OffsetAmount;
    const withHow = (how: OffsetHow): PlacementPlace | null => {
      const offs = addOffset(base.offsets, amt, how, m.rank);
      return offs ? tidy({ ...base, offsets: offs }) : null;
    };
    const p = d.place(m.id);
    const knob = m.did === 'knob' && m.knob && p?.knobs[m.knob] ? p.knobs[m.knob]!.label : null;
    const list: Choice[] = [knob
      ? { id: 'first', label: t('offset.knob', { knob }), pic: 'same', tip: t('offset.sameTip'), entry: now }
      : { id: 'first', label: t('offset.same'), pic: 'same', tip: t('offset.sameTip'), entry: m.did === 'same' ? now : withHow('same') }];
    // Zigzag and ramp need an order (a row); a move of what is not a row is "same" only.
    if (m.row && m.way !== 'move') {
      list.push({ id: 'zigzag', label: t('offset.zigzag'), pic: 'zigzag', tip: t('offset.zigzagTip'), entry: m.did === 'zigzag' ? now : withHow('zigzag') });
      list.push({ id: 'ramp', label: t('offset.ramp'), pic: 'ramp', tip: m.rank < 1 ? t('offset.rampNear') : t('offset.rampTip'), entry: m.did === 'ramp' ? now : m.rank < 1 ? null : withHow('ramp') });
    }
    // A choice that would need a ninth row (decision 6): dim, and its tooltip says why (a ramp from the nearest one
    // keeps its own why).
    for (const c of list) if (!c.entry && !(c.id === 'ramp' && m.rank < 1)) c.tip = t('offset.limit');
    list.push({ id: 'one', label: t('offset.one'), pic: 'one', tip: t('offset.oneTip'),
      entry: tidy({ ...base, pins: { ...(base.pins ?? {}), [m.key]: d.pinOf(m.pose) } }) });
    return list;
  }

  function render() {
    if (typeof document === 'undefined') return;
    const el = box();
    el.replaceChildren();
    if (!state) {
      el.hidden = true;
      return;
    }
    const s = state;
    el.hidden = false;
    el.append(h('span', { class: 'oc-lead', dataset: { part: 'offset-lead' }, text: s.lead }));
    s.list.forEach((c, i) => {
      const b = h('button', {
        type: 'button', class: `oc-btn${i === s.on ? ' on' : ''}${c.entry ? '' : ' dim'}`, 'aria-pressed': String(i === s.on),
        'aria-disabled': c.entry ? undefined : 'true', title: t('offset.keyTip', { tip: c.tip, n: KEY_OF[c.id] }), dataset: { part: `offset-${c.id}`, n: String(KEY_OF[c.id]) },
        onclick: () => pick(i),
        onpointerenter: () => peek(i),
        onpointerleave: () => peek(null),
      }, offsetPic(c.pic), h('span', { text: c.label }), h('kbd', { text: String(KEY_OF[c.id]) }));
      el.append(b);
    });
    if (d.ask) {
      const p = d.place(s.m.id);
      el.append(h('button', { type: 'button', class: 'oc-ask', title: t('offset.toKnobTip'), dataset: { part: 'offset-ask' },
        onclick: () => {
          const name = p?.name ?? s.m.id;
          const draft = t('offset.draft', { name, way: t(`offset.way.${s.m.way}`) });
          close();
          d.ask!(draft);
        } }, `✦ ${t('offset.toKnob')}`));
    }
  }

  /** A pointer over a choice: that shape in place (the draft only); off it: back to the one chosen. */
  function peek(i: number | null) {
    if (!state || state.peek === i) return;
    const c = i === null ? null : state.list[i];
    if (c && !c.entry) return;
    state.peek = i;
    d.show(state.m.id, (c ?? state.list[state.on]!).entry);
  }

  function pick(i: number): boolean {
    const s = state;
    const c = s?.list[i];
    if (!s || !c || !c.entry) return false;
    s.peek = null;
    if (i !== s.on) {
      s.on = i;
      d.retarget(s.m.id, c.entry);
      if (c.id === 'one') {
        s.lead = t('offset.oneDone', { obj: d.name(s.m.key) });
        d.pinned?.(s.m.key);
      } else s.lead = t('offset.lead', { obj: d.name(s.m.key), what: amountWords(t, s.m.way, s.m.d, d.dim()) });
    }
    d.show(s.m.id, c.entry);
    render();
    return true;
  }

  function close() {
    if (!state) return;
    const s = state;
    state = null;
    // A pointer was over one: back to the one chosen.
    if (s.peek !== null) d.show(s.m.id, s.list[s.on]!.entry);
    render();
    d.opened(false);
  }

  return {
    get el() {
      return box();
    },
    open(m, e0, now) {
      const list = choicesFor(m, e0, now);
      const on = Math.max(0, list.findIndex((c) => (m.did === 'knob' || m.did === 'same' ? c.id === 'first' : c.id === m.did)));
      state = { m, list, on, peek: null, lead: t('offset.lead', { obj: d.name(m.key), what: amountWords(t, m.way, m.d, d.dim()) }) };
      render();
      d.opened(true);
    },
    close,
    isOpen: () => !!state,
    choose: (n) => {
      const i = state ? state.list.findIndex((c) => KEY_OF[c.id] === n) : -1;
      return i >= 0 && pick(i);
    },
  };
}

/** The card's words for an offset row: "Sideways · Zigzag width". */
export const offsetRowWords = (t: T, o: PlaceOffset) => t(`offset.row.${o.how}`, { way: t(`offset.way.${o.way}`) });

export interface OffsetRowsOpts {
  t: T;
  dim: Dim;
  offs: PlaceOffset[];
  /** The row to light once (it was just made), or -1. */
  lit: number;
  /** Row i's number turned (live, then `end`); null = removed. */
  set(i: number, row: PlaceOffset | null, end: boolean): void;
  ask?(i: number): void;
  /** ⋯: its menu at the button (Remove). */
  menu?(at: HTMLElement, rows: Array<{ id: string; label: string; run(): void }>): void;
}

/**
 * The card's offset rows under the rule's knobs (decision 6). A number box like a knob's (the same part): a way's
 * number in m / px, °, × (size); a move's two numbers (X and Z). ⋯ → Remove: the objects go back by that much.
 */
export function offsetRowsEl(o: OffsetRowsOpts): HTMLElement | null {
  if (!o.offs.length) return null;
  const t = o.t;
  const u = (w: OffsetWay) => (w === 'turn' ? '°' : w === 'size' ? '×' : t(`hands.unit.${o.dim === '3d' ? 'm' : 'px'}`));
  const span = (w: OffsetWay, how: OffsetHow) => (w === 'turn' ? 90 : w === 'size' ? 1 : o.dim === '3d' ? (how === 'ramp' ? 1 : 5) : 200);
  const rows = o.offs.map((r, i) => {
    const boxes = r.way === 'move'
      ? (['X', o.dim === '3d' ? 'Z' : 'Y'] as const).map((ax, j) => knobEl({
        label: ax, unit: u('move'), v: r.v[j]!, min: r.v[j]! - span('move', 'same'), max: r.v[j]! + span('move', 'same'), tip: t('rule.knobTip'), part: `offset-row-${i}-${j}`,
        set: (v, end) => {
          const nv: [number, number] = [r.v[0], r.v[1]];
          nv[j] = Math.round(v * 10000) / 10000;
          o.set(i, { ...r, v: nv }, end);
        },
      }))
      : [knobEl({
        label: offsetRowWords(t, r), unit: u(r.way), v: r.v,
        min: r.way === 'size' ? Math.max(0.01, r.v - span(r.way, r.how)) : r.v - span(r.way, r.how), max: r.v + span(r.way, r.how),
        tip: t('rule.knobTip'), part: `offset-row-${i}`,
        set: (v, end) => o.set(i, { ...r, v: Math.round(v * 10000) / 10000 } as PlaceOffset, end),
      })];
    const more = h('button', { type: 'button', class: 'icon-btn off-more', title: t('offset.more'), 'aria-label': t('offset.more'), dataset: { part: `offset-row-${i}-more` },
      onclick: (e: Event) => o.menu?.(e.currentTarget as HTMLElement, [{ id: 'offset-remove', label: t('offset.remove'), run: () => o.set(i, null, true) }]) }, '⋯');
    return h('div', { class: `off-row${i === o.lit ? ' lit' : ''}`, title: t('offset.rowTip'), dataset: { part: 'offset-row', way: r.way, how: r.how } },
      offsetPic(r.how), h('span', { class: 'off-words', text: offsetRowWords(t, r) }), h('span', { class: 'off-boxes' }, ...boxes),
      o.ask ? h('button', { type: 'button', class: 'icon-btn off-ask', title: t('offset.toKnob'), 'aria-label': t('offset.toKnob'), dataset: { part: `offset-row-${i}-ask` }, onclick: () => o.ask!(i) }, '✦') : null,
      o.menu ? more : null);
  });
  return h('div', { class: 'off-rows', dataset: { part: 'offset-rows' } }, ...rows);
}
