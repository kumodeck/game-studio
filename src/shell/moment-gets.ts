// "What Claude gets" — the four lines under the moment's small picture (pause-ask stage 2, 2026-11-02; README picture
// pc-2-what-claude-gets.png). Pressing the picture in the field opens them: what goes to the AI with the words, so the
// person can trust "Claude sees this" instead of guessing (decided 2026-11-02: the AI should judge from the picture AND the
// code — this is where the person sees that both go).
//   1. ▣ the frame (at 0:05.02), and the copy with the marks drawn on;
//   2. ◆ what the words are about — the selected / marked objects, what each is in this moment (placed / moved by the
//      game / made by the game) and the code line that first added it ("From src/boss.js:42");
//   3. # this moment's numbers (codeMoment: Score 13,097 · Time left 24.86 s), the level, what is near the player;
//   4. ⚑ this moment, kept ("Kept to replay from 0:05.02" / "Time only: 0:05.02" / "Not kept in the demo" since the
//      fix of 2026-11-02) (pause-ask stage 3, 2026-11-02: `back`) — so ▶ Try from 0:05.02 opens it again with the
//      AI's new code. "Whole" when the game has codeMoment save / load; else "the time only" (the AI is asked to add
//      them with the fix: decided 2026-11-02), and nothing in the web demo.
// Until stage 3 the console took the 4th row; it is still part of what goes, so its errors now say so under row 3
// ("1 error" there is often the reason for asking).
// The rows are pure (test/moment-gets.test.ts); the popover is a small card over the field (shell.css .moment-gets).
import type { CodeFrom, MomentMark, MomentObjectKind } from '../contract.ts';
import { h } from './dom.ts';
import { markNumber } from './moment-marks.ts';

export interface GetsInput {
  /** The frame's time, already as the clock writes it ("0:05.02"). */
  at: string;
  marks: MomentMark[];
  /**
   * The objects the words are about (selected, then the marked ones not selected: orderMarked), with their shown names.
   * `mine` = the person moved it (Save · N): "moved by you" — a placed object they did not touch is only "in the scene".
   */
  objects: Array<{ name: string; kind?: MomentObjectKind; from?: CodeFrom; mine?: boolean }>;
  /** This moment's values as the list shows them ("Score 13,097"), [] = the game has none (no codeMoment). */
  values: string[];
  level?: string;
  near: number;
  errors: number;
  logs: number;
  /**
   * pause-ask stage 3: what of this moment is kept with the ask (`back`): 'whole' = the game's save() (▶ Try opens this
   * very moment), 'time' = the time only (no save / load yet: a new run held at the same time), 'none' = nothing (the
   * web demo: no AI, no folder).
   */
  kept?: 'whole' | 'time' | 'none';
}

export interface GetsRow {
  icon: string;
  title: string;
  sub: string;
  /** A code place to show as code (monospace) in the sub line. */
  code?: string;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

/** A kind's place in the 2nd row's order: what the game made first, then what it moves, then what stands in the scene. */
const KIND_RANK: Record<MomentObjectKind, number> = { made: 0, moves: 1, placed: 2 };

/**
 * The marked objects in the order the 2nd row (and the request's `objects`) names them (pause-ask fix △1, decided
 * 2026-11-02): what the game made first, then what it moves, then what was placed — each kind in the order the game
 * page gave (an area's objects nearest its middle first: bridge editor.ts mark-at). WHY: a circle round the boss came
 * back as "road · placed by you +5 more": the road (under everything, first in the scene's list) hid the boss the
 * person circled, and the AI read the same order. The selected objects stay first (picked by hand: the clearest point).
 */
export function orderMarked(selected: string[], marked: string[], kindOf: (key: string) => MomentObjectKind | undefined): string[] {
  const rest = marked.filter((k, i) => !selected.includes(k) && marked.indexOf(k) === i);
  const rank = (k: string) => KIND_RANK[kindOf(k) ?? 'placed'];
  // Array.prototype.sort is stable: same kind = the page's order.
  return [...selected, ...rest.sort((a, b) => rank(a) - rank(b))];
}

/** A number for the spot's sub line: one decimal, a real minus sign (VOICE.md). */
const coord = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace(/^-/, '\u2212').replace(/^\u22120\.0$/, '0.0');

/** The 2nd row when no object is under the marks (fix △2): the first mark itself, and where it is in the world. */
function markRow(marks: MomentMark[], t: T): GetsRow {
  const m = marks[0]!;
  const n = markNumber(m.n);
  const w = m.world;
  // 3D: a point on the ground plane (toGround: y 0) → x and z; 2D: the stage point → x and y.
  const ground = m.kind === 'point' && w?.length === 3;
  const title = m.kind === 'area' ? t('gets.areaEmpty', { n }) : t(ground ? 'gets.spotGround' : 'gets.spot', { n });
  const more = marks.length > 1 ? ` ${t('gets.more', { n: marks.length - 1 })}` : '';
  const sub = m.kind === 'point' && w && w.length >= 2
    ? (w.length === 3 ? `x ${coord(w[0]!)}, z ${coord(w[2]!)}` : `x ${coord(w[0]!)}, y ${coord(w[1]!)}`)
    : t('gets.spotSub');
  return { icon: '◆', title: title + more, sub };
}

/** The four rows. Never fewer: a row with nothing to say says what WOULD go (so the card always reads the same). */
export function getsRows(g: GetsInput, t: T): GetsRow[] {
  const rows: GetsRow[] = [];
  const nums = g.marks.map((m) => markNumber(m.n)).join(' ');
  rows.push({ icon: '▣', title: g.marks.length ? t('gets.frameMarks', { t: g.at, marks: nums }) : t('gets.frame', { t: g.at }),
    sub: t(g.marks.length ? 'gets.frameSubMarks' : 'gets.frameSub') });
  const first = g.objects[0];
  if (first) {
    const kindWord = first.kind ? t(first.kind === 'placed' && first.mine ? 'gets.kind.mine' : `gets.kind.${first.kind}`) : '';
    const more = g.objects.length > 1 ? ` ${t('gets.more', { n: g.objects.length - 1 })}` : '';
    const code = first.from ? `${first.from.file}:${first.from.line}` : undefined;
    // "Made at game.js:121" for what the game made (the line that makes it), "Code: game.js:49" otherwise (fix △8).
    rows.push({ icon: '◆', title: `${first.name}${kindWord ? ` · ${kindWord}` : ''}${more}`, sub: code ? t(first.kind === 'made' ? 'gets.fromMade' : 'gets.from') : t('gets.where'), ...(code ? { code } : {}) });
  } else if (g.marks.length) {
    rows.push(markRow(g.marks, t));
  } else {
    rows.push({ icon: '◆', title: t('gets.nothing'), sub: t('gets.nothingSub') });
  }
  const third = [g.level ? t('gets.level', { level: g.level }) : '', g.near ? t('gets.near', { n: g.near }) : '', g.errors ? t('gets.errors', { n: g.errors }) : ''].filter(Boolean).join(' · ');
  rows.push({ icon: '#', title: g.values.length ? g.values.slice(0, 4).join(' · ') : t('gets.time', { t: g.at }), sub: third || t('gets.view') });
  // fix △3 (2026-11-02): the title says what is kept, so it never contradicts its own sub line ("This moment, kept" over
  // "The time only…" / "Not kept in this demo").
  const kept = g.kept ?? 'whole';
  const [kt, ks] = kept === 'whole' ? ['gets.kept', 'gets.keptWhole'] : kept === 'time' ? ['gets.keptTimeTitle', 'gets.keptTime'] : ['gets.keptNoneTitle', 'gets.keptNone'];
  rows.push({ icon: '⚑', title: t(kt, { t: g.at }), sub: t(ks, { t: g.at }) });
  return rows;
}

export interface MomentGets {
  el: HTMLElement;
  open(rows: GetsRow[], title: string): void;
  close(): void;
  isOpen(): boolean;
}

export function createMomentGets(): MomentGets {
  const el = h('div', { class: 'moment-gets', role: 'dialog', dataset: { part: 'moment-gets' }, hidden: true });
  const api: MomentGets = {
    el,
    open(rows, title) {
      el.replaceChildren(h('div', { class: 'moment-gets-title', text: title }), ...rows.map((r) => h('div', { class: 'moment-gets-row' },
        h('span', { class: 'moment-gets-icon', 'aria-hidden': 'true', text: r.icon }),
        h('span', { class: 'moment-gets-words' }, h('b', { text: r.title }),
          h('small', {}, r.sub, r.code ? ' ' : null, r.code ? h('code', { text: r.code }) : null)))));
      el.setAttribute('aria-label', title);
      el.hidden = false;
    },
    close() {
      el.hidden = true;
    },
    isOpen: () => !el.hidden,
  };
  return api;
}
