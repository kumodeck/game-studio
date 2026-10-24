// The game's code layouts in the editor page (studio-code-knobs, 2026-10-24; the plan's step 2:
// "hand and rule"). The two needs of 10/24 this answers (a request that day):
//   1. "Things placed procedurally … I want to fine-tune by hand — but keep them procedural": a layout's object shows the
//      card's Layout ("Layout  Line · 4  [Rule]") with its knobs; turning one, or dragging an object in the game (the
//      game page finds the knob: bridge/code-place.ts), changes the rule's number and every object follows. ⌥ (or a
//      layout without a `drag` knob) puts just that one by hand: "Manually overridden [Reset to rule]".
//   2. "Things placed by coordinates … fix them by hand, as coordinates": a hand object is as it was; "Place
//      individually" turns a whole layout into coordinates (one ⌘Z).
// The words on screen are "rule" (chosen on 10/24) and Gemini's wording of that day — never "code".
//
// What the person changes lives in the level's `places` (code-places.ts PlaceStore; CONTRACT.md §1.12): knobs as
// { v, was }, pins, hand. Every change is one ⌘Z and one Save count per layout (the plan's decision 16); the game page
// lays the layout out again IN PLACE (studio:place/layout) — the first step reloaded the game for each number.
//
// studio-code-torule (2026-10-24, need 3 — the other way round): after the AI swapped a layout in for hand-placed
// objects (✦ Turn into a rule), the card's Layout has "◉ Compare with original" and "Max deviation: lamp-3 (0.6 m)",
// and the guide sends where those hand objects stood (orange dots and thin lines in the game) — until Save.
import type { CodePlaceInfo, Dim, PlaceCompareMarks, PlacementPlace, Pose, ShellToBridge } from '../contract.ts';
import { h } from './dom.ts';
import { knobEl, knobNumber } from './knob.ts';
import { turnKnobs, type PlaceStore } from './code-places.ts';
import { roundPose } from './pose-compare.ts';
import { gapText, placeGaps, type HandSpot } from './to-rule.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;

export interface CodePlaceWireDeps {
  t: T;
  /** The game page's code layouts (studio:code-places), [] for a game without. */
  list(): CodePlaceInfo[];
  /** This level's `places` (the world model's PlaceStore: a level switch brings another). */
  store(): PlaceStore;
  /** The world model: a layout's objects stand where its rule puts them (placement-model.ts codePoses). */
  codePoses(poses: Array<{ key: string; pose: Pose }>): void;
  pose(key: string): Pose | undefined;
  dim(): Dim;
  send(m: ShellToBridge): void;
  /** One change of a layout: one undo step, then the game lays it out (main.ts setPlace). */
  commit(id: string, from: PlacementPlace | null, to: PlacementPlace | null): void;
  /**
   * A live change shown (a knob being turned): the Save count — and the card when `card` (a drag in the game; the card's
   * own knob is not drawn again under the pointer, which would drop its drag).
   */
  changed(card: boolean): void;
  /** The line over the ask field ("Placed hex ×4 individually · ⌘Z undoes it"). */
  told(text: string): void;
  selected(): string | null;
  group(): string[];
  /** The world is on screen and editable (no guide otherwise). */
  editing(): boolean;
  /**
   * ✦ Turn into a rule (studio-code-torule): the hand-placed objects layout `id` replaced, while the swap stands and until
   * Save ([] = none), and the comparison's switch (one for the card and the timeline's line).
   */
  compare?(id: string): HandSpot[];
  compareOn?(): boolean;
  setCompareOn?(on: boolean): void;
  /**
   * Every guide update (a pick, a change of the draft, a new list): the keep-out areas follow the same moments
   * (studio-code-keepout: keep-out-wire.ts sync). Absent = nothing.
   */
  guided?(force: boolean): void;
}

export interface CodePlaceWire {
  /** The code layout `key` is one of, or null. */
  layoutOf(key: string): CodePlaceInfo | null;
  /**
   * The card's Layout block for `key`: `numbers` false = it takes the place of Position / Rotation / Size (the rule
   * decides them); true = the object's own numbers stay (one put by hand, or the layout placed individually).
   */
  card(key: string): { els: HTMLElement[]; numbers: boolean } | null;
  /** A move / turn / resize of a layout's object (the game's echo): its pin. true = taken (not a move of the object). */
  moved(key: string, pose: Pose, end: boolean): boolean;
  /** A number typed on a layout's object's card: its pin. true = taken. */
  setPose(key: string, pose: Pose): boolean;
  /** studio:place/knob from the game page: a drag of an object turned the layout's knob. */
  knob(m: { id: string; knob: string; v: number; end: boolean }): void;
  /** studio:place/poses / a new list: the rule's places are the code's, not moves. */
  poses(poses: Array<{ key: string; pose: Pose }>): void;
  /** Send the level's `places` to the game page and lay these layouts out again (absent: all). */
  layout(ids?: string[]): void;
  /** Send the guide (violet rings) for the picked object's layout, when it changed. */
  guide(force?: boolean): void;
  /** The card's ⋯ / right-click rows for `key`: "Place individually", or "Reset to rule" for one placed by hand. */
  rows(key: string): Array<{ id: string; label: string; run(): void }>;
  /** "Place individually" (the card's button): every object of layout `id` put by hand where it stands (one ⌘Z). */
  individually(id: string): void;
  /** The mouse over these objects' list rows / the card (main.ts hover): their layouts' rings too. [] = it left. */
  hover(keys: string[]): void;
  /** "hex Gap → 4 m" for each knob turned since the last Save (the Save receipt). */
  savedWords(): string[];
  /** The list's heading tag for a layout's objects ("Rule"), and the group they share. */
  listTag(key: string): { group: string; tag: string; tip: string } | null;
  /**
   * A group's move / turn / resize ended (placement/moved-group): the layouts' objects among them become their pins —
   * the changes for the same undo step as the others' moves, and the poses that were not a layout's.
   */
  groupMoved(poses: Array<{ key: string; pose: Pose; from?: Pose }>, end: boolean): { rest: Array<{ key: string; pose: Pose; from?: Pose }>; changes: Array<{ kind: 'code-place'; key: string; from: PlacementPlace | null; to: PlacementPlace | null }> };
}

/** A pose as a pin (the file's rounding; no draw order). */
function pinOf(pose: Pose, dim: Dim): NonNullable<PlacementPlace['pins']>[string] {
  const r = roundPose(pose, dim);
  return { p: r.p, ...(r.r !== undefined ? { r: r.r } : {}), ...(r.s !== undefined ? { s: r.s } : {}), ...(r.t ? { t: r.t } : {}) };
}

export function createCodePlaceWire(d: CodePlaceWireDeps): CodePlaceWire {
  const t = d.t;
  // A knob being turned (the card's drag or a drag in the game): the layout's entry before it, for the one undo step.
  let liveFrom: { id: string; entry: PlacementPlace | null } | null = null;
  let guideSig = '';
  let hovered: string[] = [];
  const unit = (u: string) => (u ? t(`hands.unit.${u}`) : '');
  const layoutOf = (key: string) => d.list().find((p) => p.keys.includes(key)) ?? null;
  const entry = (id: string): PlacementPlace => d.store().get(id) ?? {};
  const nth = (p: CodePlaceInfo, key: string) => Number(key.slice(p.id.length + 1));

  function setLive(id: string, next: PlacementPlace, card: boolean) {
    if (!liveFrom || liveFrom.id !== id) liveFrom = { id, entry: d.store().get(id) };
    d.store().set(id, next);
    d.changed(card);
  }
  function endLive(id: string, next: PlacementPlace) {
    const from = liveFrom && liveFrom.id === id ? liveFrom.entry : d.store().get(id);
    liveFrom = null;
    d.store().set(id, from);
    d.commit(id, from, next);
  }
  const withKnob = (p: CodePlaceInfo, name: string, v: number): PlacementPlace => {
    const e = entry(p.id);
    return { ...e, knobs: turnKnobs(e.knobs, { [name]: v }, p.knobs) };
  };
  const knobNow = (p: CodePlaceInfo, name: string) => entry(p.id).knobs?.[name]?.v ?? p.knobs[name]!.v;

  function layout(ids?: string[]) {
    d.send({ type: 'studio:place/layout', places: d.store().result() ?? {}, ...(ids ? { ids } : {}) });
    guide(true);
  }

  function guide(force = false) {
    d.guided?.(force);
    const keys = [...(d.group().length > 1 ? d.group() : d.selected() ? [d.selected()!] : []), ...hovered];
    const ids = d.editing() ? [...new Set(keys.map((k) => layoutOf(k)?.id).filter((x): x is string => !!x))] : [];
    const places = ids.length ? d.store().result() ?? {} : {};
    const sel = d.selected();
    const compare = compareMarks(ids);
    const sig = JSON.stringify([ids, sel, ids.map((id) => places[id] ?? null), compare]);
    if (sig === guideSig && !force) return;
    if (!ids.length && !guideSig) return;
    guideSig = ids.length ? sig : '';
    d.send({ type: 'studio:place/guide', ids, sel, places, ...(Object.keys(compare).length ? { compare } : {}) });
  }
  /** The guide's orange marks (✦ Turn into a rule): for each shown layout with a swap to compare, where its hand objects stood. */
  function compareMarks(ids: string[]): Record<string, PlaceCompareMarks> {
    const out: Record<string, PlaceCompareMarks> = {};
    if (d.compareOn && !d.compareOn()) return out;
    for (const id of ids) {
      const spots = d.compare?.(id) ?? [];
      if (!spots.length) continue;
      const n = Math.max(...spots.map((x) => x.n));
      const was: Array<number[] | null> = Array.from({ length: n }, () => null);
      const names: Array<string | null> = Array.from({ length: n }, () => null);
      for (const x of spots) (was[x.n - 1] = x.p.slice()), (names[x.n - 1] = x.label);
      out[id] = { was, names };
    }
    return out;
  }
  /**
   * The card's comparison (studio-code-torule; the plan's picture n3-place): "◉ Compare with original" and, under it,
   * "Max deviation: lamp-3 (0.6 m)" — the hand object farthest from the rule's object of its number, where each stands
   * now (a knob turned, the card drawn again: the number follows). Orange: it is about the hand's shape.
   */
  function compareBlock(p: CodePlaceInfo): HTMLElement | null {
    const spots = d.compare?.(p.id) ?? [];
    if (!spots.length) return null;
    const on = d.compareOn?.() ?? true;
    const g = placeGaps(spots, (n) => (p.keys.includes(`${p.id}-${n}`) ? d.pose(`${p.id}-${n}`)?.p : null)).max;
    const sw = h('button', { type: 'button', class: 'tl-rule-sw cmp-sw', role: 'switch', 'aria-checked': String(on), title: t('toRule.compareTip'),
      'aria-label': t('toRule.compare'), dataset: { part: 'rule-compare-sw' }, onclick: () => d.setCompareOn?.(!on) }, h('i', {}));
    return h('div', { class: 'rule-compare', dataset: { part: 'rule-compare' } },
      h('label', { class: 'rule-compare-sw' }, sw, h('span', { text: t('toRule.compare') })),
      g ? h('p', { class: 'rule-gap', dataset: { part: 'rule-gap' }, text: t('toRule.maxPlace', { obj: g.label, gap: gapText(g.d, d.dim(), unit) }) }) : null);
  }

  /** The Layout block: "Layout  Line · 4  [Rule]", the knobs, "Place individually" and "No. 2". */
  function layoutBlock(p: CodePlaceInfo, key: string): HTMLElement {
    const kind = p.kind ? t(`rule.kind.${p.kind}`) : p.name;
    const head = h('div', { class: 'rule-head' },
      h('span', { class: 'f-l', text: t('rule.layout') }),
      h('strong', { class: 'rule-what', title: p.name, text: t('rule.layoutWhat', { kind, n: p.keys.length }) }),
      h('span', { class: 'pill rule-tag', title: t('rule.tagTip'), text: t('rule.tag') }));
    const knobs = Object.entries(p.knobs).map(([name, k]) => knobEl({
      label: k.label, unit: unit(k.unit), v: knobNow(p, name), min: k.min, max: k.max, step: k.step, tip: t('rule.knobTip'), part: `rule-knob-${name}`,
      set: (v, end) => {
        const next = withKnob(p, name, v);
        if (!end) {
          setLive(p.id, next, false);
          layout([p.id]);
        } else endLive(p.id, next);
      },
    }));
    // Pins of numbers the rule no longer has (the count turned down): kept, not used (the plan's decision 16).
    const unused = Object.keys(entry(p.id).pins ?? {}).filter((k) => !p.keys.includes(k) && !p.skipped.includes(k)).length;
    const foot = h('div', { class: 'rule-foot' },
      h('button', { type: 'button', class: 'link-btn rule-hand', title: t('rule.individuallyTip', { n: p.keys.length }), dataset: { action: 'rule-individually', part: 'rule-individually' },
        onclick: () => individually(p) }, t('rule.individually')),
      h('span', { class: 'muted rule-nth', text: t('rule.nth', { n: nth(p, key) }) }));
    return h('div', { class: 'rule-block', dataset: { part: 'rule-layout', id: p.id } }, head, h('div', { class: 'rule-knobs' }, ...knobs), compareBlock(p), foot,
      unused ? h('p', { class: 'muted note-line', text: t('rule.unusedPins', { n: unused }) }) : null);
  }

  /** "Place individually": every object of the layout put where it stands now, by hand (one ⌘Z). */
  function individually(p: CodePlaceInfo) {
    const e = entry(p.id);
    const pins: NonNullable<PlacementPlace['pins']> = { ...(e.pins ?? {}) };
    for (const k of p.keys) {
      const pose = d.pose(k);
      if (pose && !pins[k]) pins[k] = pinOf(pose, d.dim());
    }
    d.commit(p.id, d.store().get(p.id), { ...e, hand: true, pins });
    d.told(t('rule.individuallyDone', { name: p.name, n: p.keys.length }));
  }

  return {
    layoutOf,
    card(key) {
      const p = layoutOf(key);
      if (!p) return null;
      const e = entry(p.id);
      if (e.hand) return { els: [], numbers: true };
      if (e.pins?.[key]) {
        // Just this one put by hand: the rule's other objects stay; its own numbers are its place (orange, the hand).
        const back = h('button', { type: 'button', class: 'link-btn', title: t('rule.resetTip'), dataset: { action: 'rule-reset', part: 'rule-reset' }, onclick: () => {
          const pins = { ...(e.pins ?? {}) };
          delete pins[key];
          d.commit(p.id, d.store().get(p.id), { ...e, pins });
        } }, t('rule.reset'));
        return { els: [h('div', { class: 'rule-pinned', dataset: { part: 'rule-pinned' } }, h('span', { text: t('rule.pinned') }), back)], numbers: true };
      }
      return { els: [layoutBlock(p, key)], numbers: false };
    },
    moved(key, pose, end) {
      const p = layoutOf(key);
      if (!p) return false;
      // While the drag goes on, the model follows the game (the card's numbers) without counting it as a move.
      d.codePoses([{ key, pose }]);
      if (!end) return true;
      const e = entry(p.id);
      d.commit(p.id, d.store().get(p.id), { ...e, pins: { ...(e.pins ?? {}), [key]: pinOf(pose, d.dim()) } });
      return true;
    },
    setPose(key, pose) {
      const p = layoutOf(key);
      if (!p) return false;
      const e = entry(p.id);
      d.commit(p.id, d.store().get(p.id), { ...e, pins: { ...(e.pins ?? {}), [key]: pinOf(pose, d.dim()) } });
      return true;
    },
    knob(m) {
      const p = d.list().find((x) => x.id === m.id);
      if (!p || !(m.knob in p.knobs)) return;
      const next = withKnob(p, m.knob, m.v);
      if (!m.end) setLive(p.id, next, true);
      else endLive(p.id, next);
    },
    poses(poses) {
      const mine = poses.filter((x) => layoutOf(x.key));
      if (mine.length) d.codePoses(mine);
    },
    layout,
    guide,
    rows(key) {
      const p = layoutOf(key);
      const e = p ? entry(p.id) : null;
      if (!p || !e || e.hand) return [];
      if (e.pins?.[key]) return [{ id: 'rule-reset', label: t('rule.reset'), run: () => {
        const pins = { ...(entry(p.id).pins ?? {}) };
        delete pins[key];
        d.commit(p.id, d.store().get(p.id), { ...entry(p.id), pins });
      } }];
      return [{ id: 'rule-individually', label: t('rule.individually'), run: () => individually(p) }];
    },
    individually(id) {
      const p = d.list().find((x) => x.id === id);
      if (p) individually(p);
    },
    hover(keys) {
      hovered = keys.slice(0, 50);
      guide();
    },
    savedWords() {
      const out: string[] = [];
      for (const id of d.store().changedIds()) {
        const p = d.list().find((x) => x.id === id);
        const e = entry(id);
        if (!p) continue;
        let said = false;
        for (const [name, k] of Object.entries(e.knobs ?? {})) {
          const def = p.knobs[name];
          if (!def) continue;
          out.push(t('rule.saved', { name: p.name, knob: def.label, v: `${knobNumber(k.v, def.step)}${unit(def.unit)}` }));
          said = true;
        }
        if (!said) out.push(p.name);
      }
      return out;
    },
    groupMoved(poses, end) {
      const rest: typeof poses = [];
      const next = new Map<string, PlacementPlace>();
      for (const x of poses) {
        const p = layoutOf(x.key);
        if (!p) {
          rest.push(x);
          continue;
        }
        d.codePoses([{ key: x.key, pose: x.pose }]);
        if (!end) continue;
        const e = next.get(p.id) ?? entry(p.id);
        next.set(p.id, { ...e, pins: { ...(e.pins ?? {}), [x.key]: pinOf(x.pose, d.dim()) } });
      }
      const changes = [...next].map(([id, to]) => {
        const from = d.store().get(id);
        d.store().set(id, to);
        return { kind: 'code-place' as const, key: id, from, to: d.store().get(id) };
      });
      if (changes.length) layout(changes.map((c) => c.key));
      return { rest, changes };
    },
    listTag(key) {
      const p = layoutOf(key);
      if (!p || entry(p.id).hand) return null;
      return { group: `rule:${p.id}`, tag: t('rule.tag'), tip: t('rule.tagTip') };
    },
  };
}
