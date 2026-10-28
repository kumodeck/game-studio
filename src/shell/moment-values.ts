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
// pause walk 2 fix (2026-10-28; a first-time person's walk of stages 1-3):
//   - ✕1: ⚑ (Make this a checkpoint) sits at the head's right, where the moment's clock was — "keep this moment" belongs
//     to "This moment", and a phone, whose top bar has no room for ⚑ (fix 1 ✕4), had it only as ⌘K's 7th row. The top
//     bar's ⚑ stays on PC. The clock went (✕8: it said "0:05.2" under the bar's "0:05.20" — the bar says it, always).
//   - ✕2: a game with neither values nor save / load showed two "not yet"s and two ✦ (here and under ⚑) for the one thing
//     a first-time person sees: connect this moment to the game. One line here and ONE ✦ — "Have {ai} connect this moment
//     to the game", `intent: 'moment-connect'`: the AI writes the values and save / load in one go (SKILL.md). ⚑'s line
//     points at the same ✦. A game that has save / load but no values keeps the old line ("…aren't shown here yet").
//   - ✕3: the web demo (no AI) shows nothing for a game without values (Lantern Cove has no score: "numbers like the score"
//     was a line with nothing to press, about numbers it does not have).
//   - ✕6: on a phone and in the side window the block is ONE line at first — "This moment · Score 13,072 · Time left 25 s"
//     with ⚑ at its right; a press opens the knobs. Three 44 px boxes filled the low sheet and left the list one row.
//   - ✕8: numbers have their thousands' "," (13,100), as a HUD prints them.
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

/**
 * A value as the list writes it: whole for a count or round 0, else two decimals at most ("18.4"); the thousands with ","
 * ("13,100": pause walk 2 ✕8 — the HUD said "SCORE 13,099" over the list's "13100", two numbers for one).
 */
export function momentNumber(v: number, x: Pick<MomentValue, 'step' | 'round'>): string {
  const s = momentStep(x);
  if (!s && x.round !== undefined && x.round > 0) return groupDigits(String(Math.round(v * 10 ** x.round) / 10 ** x.round + 0));
  return groupDigits(knobNumber(v, s));
}

/** "13100" → "13,100", "-1234.5" → "-1,234.5"; shorter numbers as they are (a year-like 2026 too: rare in a game's HUD). */
export function groupDigits(n: string): string {
  const m = /^(-?)(\d+)(\.\d+)?$/.exec(n);
  if (!m || m[2]!.length < 4) return n;
  return `${m[1]}${m[2]!.replace(/\B(?=(\d{3})+$)/g, ',')}${m[3] ?? ''}`;
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
  /** No AI here (the web demo): no ✦, and a game without values shows nothing (✕3). */
  offline(): boolean;
  /** A phone or the side window: the block folds to one line (✕6). */
  narrow(): boolean;
  /** A value turned: live (`end` false: the game draws it, no ⌘Z step) or done (one ⌘Z step back to `from`). */
  change(id: string, v: number, end: boolean, from: number): void;
  /** ✦ Have {ai} connect this moment to the game: the draft in the field (the person sends it). */
  ask(): void;
  /** ⚑ at the head's right, pressed: main.ts opens the name field under `at` (or ⚑'s one line). */
  checkpoint(at: HTMLElement): void;
}

export interface MomentValuesBlock {
  el: HTMLElement;
  /** ⚑ at the head's right (main.ts hangs the name field under it). */
  flagBtn: HTMLButtonElement;
  /**
   * The values heard (null = the game has none; undefined = not heard yet: the head alone). `checkpoint` = the game
   * can start from the middle (save / load): the line for a game without values says only what is missing.
   */
  show(values: MomentValue[] | null | undefined, o?: { checkpoint?: boolean }): void;
  /** Not in a paused moment: away. */
  hide(): void;
  /** Draw again when the language or the width changed (nothing else: a number may be being typed). */
  render(): void;
}

export function createMomentValues(d: MomentValuesDeps): MomentValuesBlock {
  // Its words are set at every render: the block is made before the person's language is read (a Japanese editor
  // showed "This moment" once).
  const title = h('span', { class: 'list-title' });
  // The folded line's numbers (narrow only): "Score 13,072 · Time left 25.06 s · Health 5 / 5", cut with "…".
  const sum = h('span', { class: 'mv-sum mono', dataset: { part: 'moment-sum' } });
  const fold = h('button', { type: 'button', class: 'mv-fold', dataset: { action: 'moment-values-fold', part: 'moment-values-fold' } }) as HTMLButtonElement;
  const flagBtn = h('button', { type: 'button', class: 'mv-flag', dataset: { action: 'checkpoint', part: 'moment-checkpoint' }, 'aria-haspopup': 'dialog' }) as HTMLButtonElement;
  flagBtn.addEventListener('click', () => d.checkpoint(flagBtn));
  const head = h('div', { class: 'mv-head' }, title, flagBtn);
  const body = h('div', { class: 'mv-body', dataset: { part: 'moment-values-body' } });
  const el = h('section', { class: 'moment-values', hidden: true, dataset: { part: 'moment-values' } }, head, body);
  let shown: MomentValue[] | null | undefined;
  let canKeep = false;
  // Narrow: folded until opened, and opened stays opened for this page (a person who turns numbers on a phone wants them
  // there at the next pause too).
  let open = false;
  // What the last drawing was for (the language, the width): the editor's every render asks again (main.ts renderAll),
  // and drawing the rows again then would take a number being typed out from under the person's keys.
  let drawnFor = '';
  const sigNow = () => `${d.t('moment.values')}|${d.narrow()}`;
  fold.addEventListener('click', () => {
    open = !open;
    render();
  });

  const unitOf = (x: MomentValue) => (x.unit ? unitText(d.t, x.unit) : momentOf(x));
  const row = (x: MomentValue): HTMLElement => {
    const unit = unitOf(x);
    if (x.set && x.v !== null) {
      const knob = knobEl({ label: x.name, unit, v: x.v, min: x.min, max: x.max, step: momentStep(x), tip: d.t('rule.knobTip'), part: `moment-knob-${x.id}`,
        format: (v) => momentNumber(v, x), set: (v, end, from) => d.change(x.id, v, end, from) });
      return h('div', { class: 'mv-row', dataset: { id: x.id, part: 'moment-value' } }, knob);
    }
    // Shown only (no set, words, or a get() that failed): grey, the reason in its tip.
    const words = x.v !== null ? `${momentNumber(x.v, x)}${unit}` : x.error ? '—' : x.text || '—';
    const tip = x.error ? d.t('moment.valueBroken') : d.t('moment.valueOnly');
    return h('div', { class: 'mv-row off', title: tip, dataset: { id: x.id, part: 'moment-value', off: x.error ? 'broken' : 'shown' } },
      h('span', { class: 'knob-l', text: x.name }), h('span', { class: 'mv-v mono', text: words }));
  };
  const said = (x: MomentValue) => `${x.name} ${x.v !== null ? `${momentNumber(x.v, x)}${unitOf(x)}` : x.text || '—'}`;

  function render() {
    // A knob held by a drag keeps its box (the drag's pointer capture): the rows are drawn again when it is let go.
    if (knobHeld(body)) {
      afterKnob(render);
      return;
    }
    drawnFor = sigNow();
    title.textContent = d.t('moment.values');
    el.setAttribute('aria-label', d.t('moment.values'));
    // ⚑ with its word on every width (✕11: the flag alone did not say what it is): "⚑ Checkpoint".
    flagBtn.replaceChildren(icon('flag'), h('span', { class: 'label', text: d.t('checkpoint.short') }));
    flagBtn.title = d.t('checkpoint.makeTip');
    flagBtn.setAttribute('aria-label', d.t('checkpoint.make'));
    const v = shown;
    const has = !!v && v.length > 0;
    // Narrow with values: the head is the fold — "▸ This moment Score 13,072 · …", a press opens the knobs.
    const folds = d.narrow() && has;
    el.dataset.fold = folds ? (open ? 'open' : 'closed') : '';
    if (folds) {
      sum.textContent = open ? '' : v!.map(said).join(' · ');
      fold.setAttribute('aria-expanded', String(open));
      fold.title = open ? d.t('sheet.fold') : d.t('moment.unfold');
      fold.replaceChildren(icon(open ? 'chevronDown' : 'chevronRight'), title, sum);
      if (fold.parentElement !== head) head.prepend(fold);
    } else {
      if (fold.parentElement) fold.remove();
      if (title.parentElement !== head) head.prepend(title);
    }
    if (v === undefined) {
      body.replaceChildren();
      return;
    }
    if (!has) {
      // The game has no codeMoment values (decision 13; ✕2: one line and one ✦ for the values and the checkpoints).
      const text = canKeep ? d.t('moment.noValues') : d.t('moment.noneBoth');
      const line = h('p', { class: 'mv-none muted', dataset: { part: 'moment-none' }, text });
      // The card's ✦ buttons' look (placement-panel.ts aiButton: violet = the AI), its words in a span.
      const ask = h('button', { type: 'button', class: 'link-btn mv-ask ai', dataset: { action: 'moment-connect-ask', part: 'moment-values-ask' },
        title: d.t('moment.connectAsk', d.aiVars()), onclick: () => d.ask() },
        h('span', { class: 'ai-spark', 'aria-hidden': 'true' }, icon('spark')), h('span', { class: 'label', text: d.t('moment.connectAsk', d.aiVars()) }));
      body.replaceChildren(line, ask);
      return;
    }
    body.replaceChildren(...(folds && !open ? [] : v!.map(row)));
  }

  return {
    el,
    flagBtn,
    show(values, o = {}) {
      shown = values;
      canKeep = !!o.checkpoint;
      // The web demo has no AI to ask: a game without values shows nothing at all (✕3), and nothing until they come.
      el.hidden = d.offline() && !(values && values.length);
      render();
    },
    hide() {
      shown = undefined;
      el.hidden = true;
      body.replaceChildren();
    },
    render() {
      if (!el.hidden && sigNow() !== drawnFor) render();
    },
  };
}

/** A unit as the knobs say it (" s" in the person's language, "°"); the code's own word after a space when the editor has none. */
export function unitText(t: (key: string) => string, u: string): string {
  const s = t(`hands.unit.${u}`);
  return s === `hands.unit.${u}` ? ` ${u}` : s;
}
