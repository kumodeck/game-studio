// "This moment" — the paused moment's numbers at the top of its list (pause-edit stage 2, 2026-10-28; CONTRACT.md §1.14).
//
// The request (2026-10-28): "pause in the middle of a scene and give instructions, by hand or to the AI". Stage 1 made
// the paused moment the editor; the score, the time left and the health stayed out of reach — they live in the game's
// JS, which the editor cannot see. Once the AI names them in the game's code (the loader's codeMoment({ values })),
// this block lists them over the moment's objects (01-decisions.md decision 13; the mock's 2nd frame):
//
//   This moment                0:42.3
//   Score        [ 12480 ]
//   Time left    [ 18 s  ]
//   Health       [ 3 / 5 ]
//   Wave           boss            ← no set(): shown only (grey)
//
// Each number is the rules' knob (knob.ts: drag left / right, press to type, ↑ / ↓) — one way to turn a number
// everywhere. A change is for this moment only: the game's set(v), then ONE frame drawn with time stopped (the HUD shows
// it), never in the scene (no Save · N, nothing written to a file), one ⌘Z step while paused, gone from the history at
// ▶ Resume (undo.ts dropMoment). The first value of a game is changed by asking in the field ("start with 90 seconds").
//
// A game without codeMoment: one line, "The game’s numbers, like the score, aren’t shown here yet." and ✦ Have {ai} make
// this moment editable (the draft in the field; the request's `intent: 'moment-values'`). The editor does not know what
// numbers a game has, so the line names none ("like the score"). The web demo (no AI): the line alone.
//
// Pure of the editor's state: main.ts gives it the values (`studio:moment/values`) and does what a change means.
import type { MomentValue } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { afterKnob, knobEl, knobHeld, knobNumber } from './knob.ts';

/** The knob's step for a value: its own, else whole numbers when it is shown whole (round 0: a score). */
export function momentStep(x: Pick<MomentValue, 'step' | 'round'>): number | undefined {
  return x.step ?? (x.round === 0 ? 1 : undefined);
}

/** A value as the list writes it: whole for a count or round 0, else two decimals at most ("18.4"). */
export function momentNumber(v: number, x: Pick<MomentValue, 'step' | 'round'>): string {
  const s = momentStep(x);
  if (!s && x.round !== undefined && x.round > 0) return String(Math.round(v * 10 ** x.round) / 10 ** x.round + 0);
  return knobNumber(v, s);
}

/**
 * " / 5" after a value with a top and no unit (a health of 3 of 5: "3 / 5"), in the knob's box as its unit — beside the
 * box it pushed that row's box out of line with the others (the first photo); '' otherwise.
 */
export function momentOf(x: Pick<MomentValue, 'max' | 'unit'>): string {
  return x.max !== undefined && !x.unit ? ` / ${knobNumber(x.max)}` : '';
}

export interface MomentValuesDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  /** The AI's name for ✦ ({ai}). */
  aiVars(): Record<string, string>;
  /** No AI here (the web demo): the one line alone. */
  offline(): boolean;
  /** The game's time, as the top bar writes it ("0:42.3"). */
  clock(): string;
  /** A value turned: live (`end` false: the game draws it, no ⌘Z step) or done (one ⌘Z step back to `from`). */
  change(id: string, v: number, end: boolean, from: number): void;
  /** ✦ Have {ai} make this moment editable: the draft in the field (the person sends it). */
  ask(): void;
}

export interface MomentValuesBlock {
  el: HTMLElement;
  /** The values heard (null = the game has none; undefined = not heard yet: the head alone). */
  show(values: MomentValue[] | null | undefined): void;
  /** Not in a paused moment: away. */
  hide(): void;
  /** The game's time in the head moved (a Next frame). */
  tick(): void;
}

export function createMomentValues(d: MomentValuesDeps): MomentValuesBlock {
  const time = h('span', { class: 'mv-time mono', dataset: { part: 'moment-time' } });
  // Its words are set at every render: the block is made before the person's language is read (a Japanese editor
  // showed "This moment" once).
  const title = h('span', { class: 'list-title' });
  const head = h('div', { class: 'mv-head' }, title, time);
  const body = h('div', { class: 'mv-body', dataset: { part: 'moment-values-body' } });
  const el = h('section', { class: 'moment-values', hidden: true, dataset: { part: 'moment-values' } }, head, body);
  let shown: MomentValue[] | null | undefined;

  const row = (x: MomentValue): HTMLElement => {
    const unit = x.unit ? unitText(d.t, x.unit) : momentOf(x);
    if (x.set && x.v !== null) {
      const knob = knobEl({ label: x.name, unit, v: x.v, min: x.min, max: x.max, step: momentStep(x), tip: d.t('rule.knobTip'), part: `moment-knob-${x.id}`,
        set: (v, end, from) => d.change(x.id, v, end, from) });
      return h('div', { class: 'mv-row', dataset: { id: x.id, part: 'moment-value' } }, knob);
    }
    // Shown only (no set, words, or a get() that failed): grey, the reason in its tip.
    const words = x.v !== null ? `${momentNumber(x.v, x)}${unit}` : x.error ? '—' : x.text || '—';
    const tip = x.error ? d.t('moment.valueBroken') : d.t('moment.valueOnly');
    return h('div', { class: 'mv-row off', title: tip, dataset: { id: x.id, part: 'moment-value', off: x.error ? 'broken' : 'shown' } },
      h('span', { class: 'knob-l', text: x.name }), h('span', { class: 'mv-v mono', text: words }));
  };

  function render() {
    // A knob held by a drag keeps its box (the drag's pointer capture): the rows are drawn again when it is let go.
    if (knobHeld(body)) {
      afterKnob(render);
      return;
    }
    title.textContent = d.t('moment.values');
    el.setAttribute('aria-label', d.t('moment.values'));
    time.textContent = d.clock();
    const v = shown;
    if (v === undefined) {
      body.replaceChildren();
      return;
    }
    if (!v || !v.length) {
      // The game has no codeMoment (decision 13; the plan's "③ when there is no hook": one line, ✦ only drafts).
      const line = h('p', { class: 'mv-none muted', dataset: { part: 'moment-none' }, text: d.t('moment.noValues') });
      // The card's ✦ buttons' look (placement-panel.ts aiButton: violet = the AI), its words in a span (one line, "…").
      const ask = d.offline() ? null : h('button', { type: 'button', class: 'link-btn mv-ask ai', dataset: { action: 'moment-values-ask', part: 'moment-values-ask' },
        title: d.t('moment.valuesAsk', d.aiVars()), onclick: () => d.ask() },
        h('span', { class: 'ai-spark', 'aria-hidden': 'true' }, icon('spark')), h('span', { class: 'label', text: d.t('moment.valuesAsk', d.aiVars()) }));
      body.replaceChildren(line, ...(ask ? [ask] : []));
      return;
    }
    body.replaceChildren(...v.map(row));
  }

  return {
    el,
    show(values) {
      shown = values;
      el.hidden = false;
      render();
    },
    hide() {
      shown = undefined;
      el.hidden = true;
      body.replaceChildren();
    },
    tick() {
      if (!el.hidden) time.textContent = d.clock();
    },
  };
}

/** A unit as the knobs say it (" s" in the person's language, "°"); the code's own word after a space when the editor has none. */
export function unitText(t: (key: string) => string, u: string): string {
  const s = t(`hands.unit.${u}`);
  return s === `hands.unit.${u}` ? ` ${u}` : s;
}
