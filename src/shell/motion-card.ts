// The card's Motion row (motion-gui → studio-timeline → studio-motion-triggers → studio-motion-flow, 2026-10-22).
//
// studio-motion-flow (a hands-on try of v0.1.18, 2026-10-22: "I couldn't tell how to make a motion and then put it on objects"): the row
// had one menu ("None ▾") and ◆ Timeline whatever the object had, so an object with no motion showed no way in. Now:
//   no motion yet  →  [+ New motion]  [From Library ▾]        the two ways in, side by side (the second only when the
//                                                             Library has motions: no button that leads nowhere)
//   a motion       →  [Hop  ⌨ E · 3× ▾]  [◆ Timeline]         its name and when it plays; the ▾ is the menu it was
//                                                             (its other motions, attach more, take it off)
// "+ New motion" (the Library's tile says the same words) opens the timeline to make one on this object; an attach (either menu) opens the timeline on
// it with "When does it move?" open (timeline-wire show()). WHY no "when" menu of its own in the card: the timeline's
// second row has every "when" with its field (seconds, key, area, cue…); a second, smaller copy here would drift.
// Split out of timeline-wire.ts (970 lines) with this change; it only reads the timeline's state through `MotionCardDeps`.
import type { LibraryMotion, MotionClip, MotionRepeat, MotionUntil, MotionWhen } from '../contract.ts';
import { whenOf } from '../loader/studio-placement.js';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { whenShort } from './timeline-panel.ts';

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
  const cs = d.clips();
  const c = d.shown();
  const others = d.library().filter((m) => !cs.some((x) => (x.use ?? x.name) === m.name));
  const label = h('span', { class: 'f-l', text: d.t('motion.label') });
  /** The Library's other motions as a menu (`first`: the menu's own first line, shown on the button). */
  const attachMenu = (sel: HTMLSelectElement) => {
    const g = h('optgroup', { label: d.t('motion.attach') });
    for (const m of others) g.append(h('option', { value: `attach:${m.name}`, text: `${m.name} · ${Math.round(m.len * 10) / 10} s` }));
    sel.append(g);
  };
  if (!cs.length) {
    const make = h('button', { type: 'button', class: 'motion-make', dataset: { action: 'motion-make', part: 'motion-make' }, title: d.t('motion.makeTip'), onclick: () => d.make() },
      h('span', { 'aria-hidden': 'true', text: '+' }), h('span', { text: d.t('motion.make') }));
    const cells = h('div', { class: 'f-cells motion-cells motion-cells-new' }, make);
    if (others.length && d.room()) {
      const sel = h('select', { class: 'motion-kind', 'aria-label': d.t('motion.attach'), title: d.t('motion.attach'), dataset: { part: 'motion-from-lib' } });
      sel.append(h('option', { value: '', text: d.t('motion.fromLib') }));
      attachMenu(sel);
      sel.addEventListener('change', () => sel.value.startsWith('attach:') && d.attach(sel.value.slice(7)));
      cells.append(h('span', { class: 'motion-pick motion-from-lib' }, sel, icon('chevronDown')));
    }
    return [label, cells];
  }
  // A motion: its name and when it plays, on the menu's button (a <select> shows its picked option's text).
  const pick = h('select', { class: 'motion-kind', 'aria-label': d.t('motion.label'), dataset: { part: 'motion-clip' } });
  const mine = h('optgroup', { label: d.t('motion.on') });
  for (const x of cs) {
    const o = h('option', { value: x.name, text: `${x.name}  ${whenShort(d.t, whenOf(x) as MotionWhen, (x.until ?? null) as MotionUntil | null, (x.repeat ?? 'once') as MotionRepeat)}` });
    if (x.name === c?.name) o.selected = true;
    mine.append(o);
  }
  pick.append(mine);
  if (others.length && d.room()) attachMenu(pick);
  if (c && d.ask) pick.append(h('option', { value: 'ask', text: `✦ ${d.t('motion.ask', { name: c.name })}` }));
  if (c) pick.append(h('option', { value: 'detach', text: d.t('motion.detach', { name: c.name }) }));
  pick.addEventListener('change', () => {
    const v = pick.value;
    if (v === 'ask') {
      // A menu line that does something, not a value: the menu shows the motion again (the chat box takes the cursor).
      pick.value = c?.name ?? '';
      d.ask?.();
    } else if (v.startsWith('attach:')) d.attach(v.slice(7));
    else if (v === 'detach' && c) d.detach(c.name);
    else d.choose(v);
  });
  const open = d.open();
  const btn = h('button', { type: 'button', class: `motion-tl${open ? ' on' : ''}`, 'aria-pressed': String(open), title: d.t('tl.openTip'), dataset: { action: 'timeline', part: 'motion-timeline' },
    onclick: () => d.toggle() }, h('span', { class: 'tl-diamond' }), h('span', { text: d.t('tl.open') }));
  return [label, h('div', { class: 'f-cells motion-cells' }, h('span', { class: 'motion-pick' }, pick, icon('chevronDown')), btn)];
}
