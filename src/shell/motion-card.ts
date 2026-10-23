// The card's Motion row (motion-gui → studio-timeline → studio-motion-triggers → studio-motion-flow, 2026-10-22 →
// studio-card-doors, 2026-10-23: one line, only when the object has a motion — see motionCardRow).
//
// History — studio-motion-flow (a hands-on try of v0.1.18, 2026-10-22: "I couldn't tell how to make a motion and then put it on objects"): the row
// had one menu ("None ▾") and ◆ Timeline whatever the object had, so an object with no motion showed no way in. Now:
//   no motion yet  →  [+ New motion]  [From Library ▾]        the two ways in, side by side (the second only when the
//                                                             Library has motions: no button that leads nowhere)
//   a motion       →  [Hop  ⌨ E · 3× ▾]  [◆ Timeline]         its name and when it plays; the ▾ is the menu it was
//                                                             (its other motions, attach more, take it off)
// "+ New motion" (the Library's tile says the same words) opens the timeline to make one on this object; an attach (either menu) opens the timeline on
// it with "When does it move?" open (timeline-wire show()). WHY no "when" menu of its own in the card: the timeline's
// second row has every "when" with its field (seconds, key, area, cue…); a second, smaller copy here would drift.
// Split out of timeline-wire.ts (970 lines) with this change; it only reads the timeline's state through `MotionCardDeps`.
import type { LibraryMotion, MotionClip } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

export interface MotionCardDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  /** This object's motions (resolved: each with its Library motion's len / repeat / keys). */
  clips(): MotionClip[];
  /** The one the timeline shows for it. */
  shown(): MotionClip | null;
  /** The Library's motions. */
  library(): LibraryMotion[];
  /** More can be attached (an object holds at most MAX_CLIPS). */
  room(): boolean;
  /** The timeline is open. */
  open(): boolean;
  /** Show another of its motions on the timeline. */
  choose(name: string): void;
  attach(name: string): void;
  detach(name: string): void;
  /** "+ New motion": the timeline opens with a new motion on this object. */
  make(): void;
  /** ◆ Timeline: open / fold it on this object. */
  toggle(): void;
  /** studio-motion-panel: "✦ Ask your AI about it…" — the chat box gets the "object · motion" chip. Absent = no AI here. */
  ask?(): void;
}

export function motionCardRow(d: MotionCardDeps): HTMLElement[] {
  // studio-card-doors (2026-10-23, a hands-on try: "I couldn't tell how to make a motion and then put it on objects";
  // "it's all over the place"): the card was a second way in — "+ Make a motion", "Use a saved motion ▾" and
  // "◆ Timeline", cut to "Use a sa…" / "Motion ▶ S…" on a 272 px card — beside the strip's Motion button. One way in
  // now (the plan's rule, docs 02-map): the strip's Motion. The card only SAYS what the object has, in one row —
  // "Motion  ship’s motion ›" (fix-0140: the name only, see below) — and a press on it opens the motion's timeline below the game.
  // No motion = no row at all (an empty "Motion: none" row would be one more thing to read and nothing to do there).
  // Its other motions, attach / take off and "Ask AI about it" are the timeline's (its ⋯ Fine-tune and the strip's
  // menu): the MotionCardDeps keep those for the timeline-wire caller, the card no longer uses them.
  const cs = d.clips();
  const c = d.shown() ?? cs[0];
  if (!c) return [];
  const label = h('span', { class: 'f-l', text: d.t('motion.label') });
  // fix-0140 (J1 of the first-run check, 2026-10-23 — the same kind as a hands-on try's "I can't read anything in this
  // UI"): the row was "lighthouse's motion · When game starts", and on a 1280 card it ended "lighthouse's motion ·
  // When …" (cut the same way in Japanese). The row now says only the motion's name; WHEN it plays is the
  // timeline's one-line sentence below the game (one place for it — a second, shorter copy here was the cut one).
  // whenOf / whenShort stay out of the card on purpose: don't add "when" back here, widen the timeline's line instead.
  const more = cs.length > 1 ? ` +${cs.length - 1}` : '';
  const open = d.open();
  const btn = h('button', { type: 'button', class: `motion-line${open ? ' on' : ''}`, 'aria-pressed': String(open), title: d.t('tl.openTip'), dataset: { action: 'timeline', part: 'motion-timeline-line' },
    onclick: () => (open ? undefined : d.toggle()) },
  h('span', { class: 'motion-line-text', text: `${c.name}${more}` }), icon('chevronRight'));
  return [label, h('div', { class: 'f-cells motion-cells', dataset: { part: 'motion-row' } }, btn)];
}
