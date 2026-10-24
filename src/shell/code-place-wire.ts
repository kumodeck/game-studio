// The game's code layouts in the editor page (studio-code-knobs, 2026-10-24; the plan's step 2:
// "hand and rule"). The two needs of 10/24 this answers (a request that day):
//   1. "Things placed procedurally … I want to fine-tune by hand — but keep them procedural": a layout's object shows the
//      card's Layout ("Layout  Line · 4  [Rule]") with its knobs; turning one, or dragging an object in the game (the
//      game page finds the knob: bridge/code-place.ts), changes the rule's number and every object follows. ⌥ (or a
//      layout without a `drag` knob) puts just that one by hand: "Manually overridden [Reset to rule]".
//   2. "Things placed by coordinates … fix them by hand, as coordinates": a hand object is as it was; "Convert to
//      coordinates" turns a whole layout into coordinates (one ⌘Z).
// The words on screen are "rule" (chosen on 10/24) and Gemini's wording of that day — never "code".
//
// studio-to-coords (2026-10-24; a request that day: "a rule's object should stay a rule however it is moved; to make it your own
// shape, a button converts the rule to coordinates"): only ⌥ ever takes one object out of its rule (its pin), and it says
// so ("Placed Street lamps 3 by hand · ⌘Z undoes it · Reset to rule") — the card and the list then mark it "Hand-placed".
// Any other move of a rule's object (a turn, a lift, a key step, a game's tool: the CRYSTAL FIELD try of that day, where a
// lamp lifted without ⌥ silently left its row) is put back where the rule puts it, with why and ✦ to ask for the knob.
//
// What the person changes lives in the level's `places` (code-places.ts PlaceStore; CONTRACT.md §1.12): knobs as
// { v, was }, pins, hand. Every change is one ⌘Z and one Save count per layout (the plan's decision 16); the game page
// lays the layout out again IN PLACE (studio:place/layout) — the first step reloaded the game for each number.
//
// studio-code-torule (2026-10-24, need 3 — the other way round): after the AI swapped a layout in for hand-placed
// objects (✦ Turn into a rule), the card's Layout has "◉ Compare with original" and "Max deviation: lamp-3 (0.6 m)",
// and the guide sends where those hand objects stood (orange dots and thin lines in the game) — until Save.
import type { CodePlaceInfo, Dim, PlaceCompareMarks, PlacementPlace, PlaceWay, Pose, ShellToBridge } from '../contract.ts';
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
  /**
   * The line over the ask field ("Converted the hex rule to coordinates · ⌘Z undoes it"); `actions` = pressable words
   * after it ("Reset to rule", "✦ Ask Claude: …"). `undo` false = the line has no "⌘Z undoes it" (nothing was done).
   */
  told(text: string, actions?: Array<{ label: string; run(): void }>, undo?: boolean): void;
  /** The object's name as the list says it ("Street lamps 3"). */
  name?(key: string): string;
  /** ✦: put these words in the chat box for what is picked (nothing is sent). */
  ask?(draft: string): void;
  /** A finger is the pointer (no ⌥ key: the words leave it out). */
  touch?(): boolean;
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
  /**
   * A move / turn / resize of a layout's object (the game's echo). true = taken (not a move of the object): with ⌥
   * (`alone`), or one already by hand, its pin; else it goes back where the rule puts it, with why (`press`: the tool).
   */
  moved(key: string, pose: Pose, end: boolean, alone?: boolean, press?: 'move' | 'rotate' | 'lift' | 'scale'): boolean;
  /** A number typed on a layout's object's card: its pin. true = taken. */
  setPose(key: string, pose: Pose): boolean;
  /** studio:place/knob from the game page: a drag of an object turned the layout's knob (`knobs`: several at once). */
  knob(m: { id: string; knob: string; v: number; end: boolean; knobs?: Record<string, number> }): void;
  /** studio:place/held from the game page: a drag the rule did not follow — why, ⌥, and ✦ to ask for that knob. */
  held(m: { id: string; key: string; way: PlaceWay }): void;
  /**
   * Key steps (arrows, Q / E, PgUp / PgDn, End) on these keys: the ones that may move; a rule's objects stay, and why
   * (`quiet`: a held key's repeats — said once already).
   */
  steps(keys: string[], quiet?: boolean): string[];
  /** studio:place/poses / a new list: the rule's places are the code's, not moves. */
  poses(poses: Array<{ key: string; pose: Pose }>): void;
  /** Send the level's `places` to the game page and lay these layouts out again (absent: all). */
  layout(ids?: string[]): void;
  /** Send the guide (violet rings) for the picked object's layout, when it changed. */
  guide(force?: boolean): void;
  /** The card's ⋯ / right-click rows for `key`: "Convert to coordinates", or "Reset to rule" for one placed by hand. */
  rows(key: string): Array<{ id: string; label: string; run(): void }>;
  /** "Convert to coordinates" (the card's button): every object of layout `id` put by hand where it stands (one ⌘Z). */
  individually(id: string): void;
  /** The mouse over these objects' list rows / the card (main.ts hover): their layouts' rings too. [] = it left. */
  hover(keys: string[]): void;
  /** "hex Gap → 4 m" for each knob turned since the last Save (the Save receipt). */
  savedWords(): string[];
  /**
   * The list's heading tag for a layout's objects ("Rule"), and the group they share; `hand` = this one is put by hand
   * apart from its rule (its mark "Hand-placed" and "Reset to rule").
   */
  listTag(key: string): { group: string; tag: string; tip: string; hand?: { tag: string; tip: string; reset: string; run(): void } } | null;
  /**
   * A group's move / turn / resize ended (placement/moved-group): the layouts' objects among them become their pins —
   * the changes for the same undo step as the others' moves, and the poses that were not a layout's.
   */
  groupMoved(poses: Array<{ key: string; pose: Pose; from?: Pose }>, end: boolean, alone?: boolean): { rest: Array<{ key: string; pose: Pose; from?: Pose }>; changes: Array<{ kind: 'code-place'; key: string; from: PlacementPlace | null; to: PlacementPlace | null }> };
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
  const withKnob = (p: CodePlaceInfo, name: string, v: number): PlacementPlace => withKnobs(p, { [name]: v });
  const withKnobs = (p: CodePlaceInfo, set: Record<string, number>): PlacementPlace => {
    const e = entry(p.id);
    return { ...e, knobs: turnKnobs(e.knobs, set, p.knobs) };
  };
  const nameOf = (key: string) => d.name?.(key) ?? key;
  /** Is `key` held by its rule (not the whole layout by hand, not put by hand alone)? */
  const ruled = (p: CodePlaceInfo, key: string) => !entry(p.id).hand && !entry(p.id).pins?.[key];
  /** Take `key`'s pin off: back where the rule puts it (one ⌘Z). */
  function unpin(p: CodePlaceInfo, key: string) {
    const e = entry(p.id);
    const pins = { ...(e.pins ?? {}) };
    delete pins[key];
    d.commit(p.id, d.store().get(p.id), { ...e, pins });
  }
  /**
   * Why a rule's object did not move that way (the line over the ask field, studio-to-coords): "Street lamps: sideways
   * position is set by the rule · ⌥-drag to move just this one · ✦ Ask Claude: “Let me move Street lamps sideways too”".
   */
  function sayHeld(p: CodePlaceInfo, way: PlaceWay) {
    const group = way === 'group';
    const why = group ? t('rule.heldGroup', { name: p.name }) : t('rule.held', { name: p.name, what: t(`rule.held.${way}`) });
    const alone = d.touch?.() ? '' : ` · ${t(group ? 'rule.heldAloneGroup' : 'rule.heldAlone')}`;
    const draft = t(`rule.draft.${way}`, { name: p.name });
    d.told(`${why}${alone}`, d.ask ? [{ label: t('rule.heldAsk', { draft }), run: () => d.ask!(draft) }] : [], false);
  }
  /** A pose as `key`'s pin (one ⌘Z), told when it is the first time this one leaves its rule (⌥). */
  function pin(p: CodePlaceInfo, key: string, pose: Pose) {
    const e = entry(p.id);
    const first = !e.hand && !e.pins?.[key];
    d.commit(p.id, d.store().get(p.id), { ...e, pins: { ...(e.pins ?? {}), [key]: pinOf(pose, d.dim()) } });
    if (first) d.told(t('rule.pinnedDone', { obj: nameOf(key) }), [{ label: t('rule.reset'), run: () => {
      const q = d.list().find((x) => x.id === p.id);
      if (q && entry(q.id).pins?.[key]) unpin(q, key);
    } }]);
  }
  const PRESS_WAY: Record<'move' | 'rotate' | 'lift' | 'scale', PlaceWay> = { move: 'move', rotate: 'turn', lift: 'up', scale: 'size' };
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

  /** The Layout block: "Layout  Line · 4  [Rule]", the knobs, "Convert to coordinates" and "No. 2". */
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

  /**
   * "Convert to coordinates" (studio-to-coords; it was "Place individually"): every object of the layout put where it
   * stands now, by hand — the rule becomes one coordinate each (one ⌘Z). The motion side's button has the same words.
   */
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
        // Its mark "Hand-placed" (the list's too, studio-to-coords) and the way back.
        const back = h('button', { type: 'button', class: 'link-btn', title: t('rule.resetTip'), dataset: { action: 'rule-reset', part: 'rule-reset' }, onclick: () => unpin(p, key) }, t('rule.reset'));
        return { els: [h('div', { class: 'rule-pinned', dataset: { part: 'rule-pinned' } },
          h('span', { class: 'pill hand-tag', title: t('rule.handTip'), dataset: { part: 'rule-hand-tag' }, text: t('rule.handTag') }), h('span', { text: t('rule.pinned') }), back)], numbers: true };
      }
      return { els: [layoutBlock(p, key)], numbers: false };
    },
    moved(key, pose, end, alone, press) {
      const p = layoutOf(key);
      if (!p) return false;
      if (ruled(p, key) && !alone) {
        // Not ⌥: never out of its rule (studio-to-coords). The game page keeps a drag still already (bridge/code-place.ts);
        // this is the rest — a key step, a game's tool, a drop to the floor: back where the rule puts it, and why.
        if (end) {
          layout([p.id]);
          sayHeld(p, PRESS_WAY[press ?? 'move']);
        }
        return true;
      }
      // While the drag goes on, the model follows the game (the card's numbers) without counting it as a move.
      d.codePoses([{ key, pose }]);
      if (!end) return true;
      pin(p, key, pose);
      return true;
    },
    setPose(key, pose) {
      const p = layoutOf(key);
      if (!p) return false;
      // The card shows a rule's object no numbers to type (its Layout instead): one that gets here anyway stays in its rule.
      if (ruled(p, key)) {
        layout([p.id]);
        return true;
      }
      const e = entry(p.id);
      d.commit(p.id, d.store().get(p.id), { ...e, pins: { ...(e.pins ?? {}), [key]: pinOf(pose, d.dim()) } });
      return true;
    },
    knob(m) {
      const p = d.list().find((x) => x.id === m.id);
      const set = Object.fromEntries(Object.entries(m.knobs ?? { [m.knob]: m.v }).filter(([n, v]) => !!p && n in p.knobs && typeof v === 'number'));
      if (!p || !Object.keys(set).length) return;
      const next = withKnobs(p, set);
      if (!m.end) setLive(p.id, next, true);
      else endLive(p.id, next);
    },
    held(m) {
      const p = d.list().find((x) => x.id === m.id);
      if (p) sayHeld(p, m.way);
    },
    steps(keys, quiet) {
      const held = keys.filter((k) => {
        const p = layoutOf(k);
        return !!p && ruled(p, k);
      });
      if (held.length && !quiet) {
        const p = layoutOf(held[0]!)!;
        d.told(t('rule.keys', { name: p.name }), [], false);
      }
      return keys.filter((k) => !held.includes(k));
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
      if (e.pins?.[key]) return [{ id: 'rule-reset', label: t('rule.reset'), run: () => unpin(p, key) }];
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
    groupMoved(poses, end, alone) {
      const rest: typeof poses = [];
      const next = new Map<string, PlacementPlace>();
      const back = new Set<string>();
      // The rule's objects ⌥ takes out of their rule now (told at the end, as one object's are).
      const first: Array<{ id: string; key: string }> = [];
      for (const x of poses) {
        const p = layoutOf(x.key);
        if (!p) {
          rest.push(x);
          continue;
        }
        // Not ⌥: a rule's object stays in its rule (the game page leaves them out of a group drag; a key step's group
        // may still bring one) — laid out again where the rule puts it.
        if (ruled(p, x.key) && !alone) {
          back.add(p.id);
          continue;
        }
        d.codePoses([{ key: x.key, pose: x.pose }]);
        if (!end) continue;
        if (ruled(p, x.key)) first.push({ id: p.id, key: x.key });
        const e = next.get(p.id) ?? entry(p.id);
        next.set(p.id, { ...e, pins: { ...(e.pins ?? {}), [x.key]: pinOf(x.pose, d.dim()) } });
      }
      const changes = [...next].map(([id, to]) => {
        const from = d.store().get(id);
        d.store().set(id, to);
        return { kind: 'code-place' as const, key: id, from, to: d.store().get(id) };
      });
      const again = new Set([...changes.map((c) => c.key), ...(end ? back : [])]);
      if (again.size) layout([...again]);
      // ⌥ took some out of their rule together: said as for one ("Placed Street lamps 2, Street lamps 3 by hand"), with
      // the way back for all of them (studio-to-coords: never out of a rule without being told).
      if (first.length) {
        const names = first.slice(0, 3).map((x) => nameOf(x.key)).join(', ') + (first.length > 3 ? ` +${first.length - 3}` : '');
        d.told(t(first.length > 1 ? 'rule.pinnedDoneMany' : 'rule.pinnedDone', { obj: names }), [{ label: t('rule.reset'), run: () => {
          for (const x of first) {
            const q = d.list().find((y) => y.id === x.id);
            if (q && entry(q.id).pins?.[x.key]) unpin(q, x.key);
          }
        } }]);
      }
      return { rest, changes };
    },
    listTag(key) {
      const p = layoutOf(key);
      if (!p || entry(p.id).hand) return null;
      const tag = { group: `rule:${p.id}`, tag: t('rule.tag'), tip: t('rule.tagTip') };
      // Put by hand apart from its rule (⌥): its mark and the way back, in the list too (studio-to-coords — "a lamp left
      // floating in the row, and nobody notices").
      return entry(p.id).pins?.[key]
        ? { ...tag, hand: { tag: t('rule.handTag'), tip: t('rule.handTip'), reset: t('rule.reset'), run: () => unpin(p, key) } }
        : tag;
    },
  };
}
