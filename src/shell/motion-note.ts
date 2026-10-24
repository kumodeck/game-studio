// The motion's one line over the ask field (studio-motion-next-2, 2026-10-24; a hands-on review of v0.1.58).
//
// What it fixes: v0.1.57's next-step line ("✓ gate’s motion is made · Save puts it in the game · ✦ …", timeline-panel's
// .tl-next) showed only right after Done / Esc or ● Rec motion off — "I never saw it once". Reshaping a motion (a point or
// a handle dragged, the ease, the path, Repeat changed) — the common case — said nothing, the line sat under the plate's
// head where the eye does not go, and another pick or a fold took it away.
// Now ONE line, over the ask field (the dock, main.ts), where it is seen with the plate open, slim or folded:
//   - the picked object's motion has changes not saved → "gate’s motion changed · Save puts it in the game · ✦ Have
//     Claude rebuild it as a formula" (studio-words-formula 10/25; "… is made" for a motion new since the last save), for as long as that is so;
//   - ● Rec motion on (the plate open, a move adds a point) → "● Recording · press ● when you're done" (the second ● is a
//     button: Rec motion off), in place of the ✦ part — finish first, then the next step;
//   - another object picked, or none → "Not saved: gate’s motion (+1) · Save puts it in the game" (the name picks it);
//   - Save → the line goes (the AI line says "Saved: gate’s motion", save-receipt.ts).
// WHY over the field and not under the plate's head: the field is where the eye already is (it is the one thing always on
// screen while editing), and it stays when the plate is folded. The plate's own line (.tl-next) is gone: the same words in
// two places read as two things.
// WHY the top bar's Save glows instead of a Save in the line (two ways shown side by side, shots-2/): ONE Save (v0.1.9, a
// hands-on review: "why are there two buttons that do the same thing?"; save-loud.ts), and a Save in the line would read as
// "save this motion" while it saves every change. The line's dot and its "Save" are the Save's orange; main.ts rings the
// Save in the same orange while the line speaks of a change (`unsaved`).
// What to say is decided here without the DOM (noteOf), so test/motion-next-2.test.ts reads it without a browser.
import { h } from './dom.ts';
import { icon } from './icons.ts';

/** A motion with changes not saved: the object it is on and the motion's name on screen. */
export interface NoteMotion {
  key: string;
  /** The object's name in the list. */
  label: string;
  /** The motion's name on screen (the clip's). */
  name: string;
  /** New since the last save (its Library motion was not there): "is made", else "changed". */
  made: boolean;
}

export interface NoteIn {
  /** The motion the plate shows / the picked object's shown motion, when it has changes not saved; else null. */
  here: (NoteMotion & { canRule: boolean }) | null;
  /** ● Rec motion is on for the object on the plate (a move adds a point now). */
  rec: boolean;
  /** Every other motion with changes not saved (here's left out), in the list's order. */
  others: NoteMotion[];
}

export type Note = {
  /** here = the motion on screen changed; elsewhere = another object's did; null = no change to speak of (rec only). */
  change: { where: 'here' | 'elsewhere'; motion: NoteMotion; more: number } | null;
  rec: boolean;
  /** ✦ Have {ai} rebuild it as a formula: the changed motion here is points (two or more), not recording, an AI here. */
  rule: boolean;
} | null;

export function noteOf(s: NoteIn): Note {
  const change = s.here
    ? { where: 'here' as const, motion: s.here, more: 0 }
    : s.others[0] ? { where: 'elsewhere' as const, motion: s.others[0], more: s.others.length - 1 } : null;
  if (!change && !s.rec) return null;
  return { change, rec: s.rec, rule: !!s.here?.canRule && !s.rec };
}

export interface MotionNoteDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  /** ● pressed: Rec motion off (the plate's own ● in Fine-tune, timeline-wire acts.auto(false)). */
  recOff(): void;
  /** ✦ pressed: the same as the plate's ✦ Turn into a rule (a draft in the box below, nothing sent). Absent = no AI here. */
  toRule?(): void;
  /** Another object's motion's name pressed: pick that object (the plate then shows its motion). */
  pick(key: string): void;
}

export function createMotionNote(d: MotionNoteDeps) {
  const el = h('p', { class: 'motion-note', role: 'status', 'aria-live': 'polite', hidden: true, dataset: { part: 'motion-note' } });
  const dot = () => h('span', { class: 'mn-dot', 'aria-hidden': 'true', text: '·' });
  /** Draw `n` (null: hidden). Returns whether it speaks of a change not saved (main.ts rings the Save then). */
  function render(n: Note): boolean {
    el.hidden = !n;
    if (!n) {
      el.replaceChildren();
      delete el.dataset.kind;
      return false;
    }
    const t = d.t;
    const parts: Node[] = [];
    const c = n.change;
    el.dataset.kind = c ? c.where : 'rec';
    if (c) {
      // The Save's orange (shell.css --you): the dot at the start, and "Save" in "Save puts it in the game".
      parts.push(h('span', { class: 'mn-lead', 'aria-hidden': 'true' }));
      if (c.where === 'here') {
        parts.push(h('span', { class: 'mn-what', dataset: { part: 'motion-note-what' }, text: t(c.motion.made ? 'mnext2.made' : 'mnext2.changed', { name: c.motion.name }) }));
      } else {
        const name = h('button', { type: 'button', class: 'mn-go', title: t('mnext2.goTip', { obj: c.motion.label }), dataset: { action: 'motion-note-go', part: 'motion-note-go' },
          onclick: () => d.pick(c.motion.key) }, c.motion.name);
        parts.push(h('span', { class: 'mn-what', dataset: { part: 'motion-note-what' } }, t('mnext2.elsewhere'), ' ', name,
          ...(c.more ? [' ', t('mnext2.more', { n: c.more })] : [])));
      }
      parts.push(dot());
      // "Save puts it in the game": "Save" alone in the orange (the button's word), split on the {save} mark.
      const [a = '', b = ''] = t('mnext2.save', { save: '\u0000' }).split('\u0000');
      parts.push(h('span', { class: 'mn-save', dataset: { part: 'motion-note-save' } }, a, h('b', { class: 'mn-save-w', text: t('btn.save') }), b));
    }
    if (n.rec) {
      if (c) parts.push(dot());
      // "● Recording · press ● when you're done": the second ● is the button (Rec motion off), split on the {dot} mark.
      const [a = '', b = ''] = t('mnext2.recEnd', { dot: '\u0000' }).split('\u0000');
      parts.push(h('span', { class: 'mn-rec', dataset: { part: 'motion-note-rec' } }, h('span', { class: 'mn-rec-dot', 'aria-hidden': 'true' }), t('mnext2.rec')),
        dot(),
        h('span', { class: 'mn-rec-end' }, a,
          h('button', { type: 'button', class: 'mn-rec-off', title: t('mnext2.recOffTip'), 'aria-label': t('mnext2.recOffTip'), dataset: { action: 'motion-note-rec-off', part: 'motion-note-rec-off' }, onclick: () => d.recOff() },
            h('span', { class: 'mn-rec-dot' })), b));
    }
    if (n.rule && d.toRule) {
      parts.push(dot(), h('button', { type: 'button', class: 'mn-rule', title: t('tl.ruleTip'), dataset: { action: 'motion-note-rule', part: 'motion-note-rule' }, onclick: () => d.toRule!() },
        icon('spark'), h('span', { text: t('mnext2.line', { what: t('mnext2.toNumbers') }) })));
    }
    el.replaceChildren(...parts);
    return !!c;
  }
  return { el, render };
}
