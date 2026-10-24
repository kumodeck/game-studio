// One knob of a rule (studio-code-knobs, 2026-10-24; the plan's step 2, item 1: "one part, the same on the card and on
// the timeline's line"): a layout's Gap or Count, a rule motion's Radius or Lap — the numbers the AI wrote into the game's
// codePlace() / codeMotion() for a person to turn ("closer", "bigger", "faster").
//
//   Gap  [ 6 m ]        the name (quiet), then the number in a box with a thin line under it: where the number sits
//        ‾‾‾‾‾          between the knob's min and max (none written: ten times round it).
//
// How it is turned (the same as the card's position numbers, so nothing new to learn):
//   - drag left / right on the box: the number follows the drag inside its range, live (the game moves as it goes);
//     letting go is ONE ⌘Z and one Save count (`end`) — the plan's decision 8 / 16;
//   - a press without a drag: the box becomes a field — type any number, also outside the range (the person's intent;
//     only the file's own limit stops it), Enter keeps, Esc puts the old one back;
//   - ↑ / ↓ with the box focused: ±0.1, Shift ±1 (a knob with `step: 1` — a count — ±1 always), each press one ⌘Z.
// WHY no slider element: a native range input cannot take a number outside its range nor show "6 m", and the card's
// numbers already taught "drag the label, press to type"; one way to turn a number everywhere.
import { h } from './dom.ts';

export interface KnobOpts {
  /** The knob's name in the person's words ("Gap", "Radius"). */
  label: string;
  /** The unit as shown after the number (" m", " s", "°"; '' = none). */
  unit: string;
  v: number;
  min?: number;
  max?: number;
  /** 1 = whole numbers (a count). */
  step?: number;
  /** data-part of the box (tests, the walk-through). */
  part?: string;
  /** The box's tooltip ("Drag left or right · click to type"). */
  tip: string;
  /** The number turned: `end` false = live (no undo step), true = done (one undo step, from `from`). */
  set(v: number, end: boolean, from: number): void;
  /** The mouse over the knob / not (the guide in the game lights while it is turned). Absent = nothing. */
  hover?(on: boolean): void;
}

/** px of drag across the whole range (min → max): about a card's width, so a hand can land on a number. */
const RANGE_PX = 160;

/** A knob's range for the drag: its min / max, else ten times round its number. */
export function rangeOf(o: Pick<KnobOpts, 'v' | 'min' | 'max'>): [number, number] {
  const span = Math.max(1, Math.abs(o.v)) * 10;
  return [o.min ?? (o.v > 0 ? 0 : o.v - span), o.max ?? o.v + span];
}

/** The number as the box writes it: a count whole, others to two decimals at most. */
export function knobNumber(v: number, step?: number): string {
  if (step && step >= 1) return String(Math.round(v));
  const r = Math.round(v * 100) / 100;
  return String(r === 0 ? 0 : r);
}

/** Snap a dragged number: a count to whole numbers, others to a hundredth of the range (no 6.0137 m from a drag). */
export function snapKnob(v: number, o: Pick<KnobOpts, 'step' | 'v' | 'min' | 'max'>): number {
  if (o.step && o.step >= 1) return Math.round(v);
  const [lo, hi] = rangeOf(o);
  const q = Math.pow(10, Math.floor(Math.log10(Math.max(1e-6, (hi - lo) / 100))));
  return Math.round(v / q) * q;
}

export function knobEl(o: KnobOpts): HTMLElement {
  const [lo, hi] = rangeOf(o);
  const whole = !!o.step && o.step >= 1;
  const val = h('span', { class: 'knob-v', text: `${knobNumber(o.v, o.step)}${o.unit}` });
  const fill = h('i', {});
  const bar = h('span', { class: 'knob-bar', 'aria-hidden': 'true' }, fill);
  const box = h('span', { class: 'knob-box', tabindex: '0', role: 'slider', title: o.tip, 'aria-label': o.label,
    'aria-valuemin': String(lo), 'aria-valuemax': String(hi), 'aria-valuenow': String(o.v), dataset: { part: o.part ?? 'knob' } }, val, bar);
  const el = h('label', { class: 'knob' }, h('span', { class: 'knob-l', text: o.label }), box);
  let now = o.v;
  const show = (v: number) => {
    now = v;
    val.textContent = `${knobNumber(v, o.step)}${o.unit}`;
    box.setAttribute('aria-valuenow', String(v));
    fill.style.width = `${Math.max(0, Math.min(100, ((v - lo) / (hi - lo || 1)) * 100))}%`;
  };
  show(o.v);
  if (o.hover) {
    el.addEventListener('pointerenter', () => o.hover!(true));
    el.addEventListener('pointerleave', () => o.hover!(false));
  }

  // Drag (pointer capture on the box, as the card's number labels) — or a press that becomes a field.
  let drag: { x: number; v: number; moved: boolean } | null = null;
  box.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    box.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, v: now, moved: false };
    box.classList.add('on');
  });
  const valueAt = (dr: { x: number; v: number }, e: PointerEvent) => {
    const per = (hi - lo) / RANGE_PX;
    const v = dr.v + (e.clientX - dr.x) * per * (e.shiftKey ? 0.1 : 1);
    return snapKnob(Math.max(lo, Math.min(hi, v)), o);
  };
  box.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) < 3) return;
    drag.moved = true;
    const v = valueAt(drag, e);
    if (v !== now) (show(v), o.set(v, false, drag.v));
  });
  const finish = (e: PointerEvent, keep: boolean) => {
    if (!drag) return;
    const dr = drag;
    drag = null;
    box.classList.remove('on');
    if (!dr.moved) {
      if (keep) type();
      return;
    }
    const v = keep ? valueAt(dr, e) : dr.v;
    show(v);
    o.set(v, true, dr.v);
  };
  box.addEventListener('pointerup', (e) => finish(e, true));
  box.addEventListener('pointercancel', (e) => finish(e, false));

  // ↑ / ↓: one step, one undo step each.
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      return type();
    }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    const by = (whole ? 1 : e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowUp' ? 1 : -1);
    const from = now;
    const v = whole ? Math.round(from + by) : Math.round((from + by) * 1000) / 1000;
    show(v);
    o.set(v, true, from);
  });

  /** The box becomes a field: any number (outside the range too), Enter / leaving keeps, Esc goes back. */
  function type() {
    const f = h('input', { type: 'text', inputmode: 'decimal', class: 'knob-in', autocomplete: 'off', spellcheck: false, 'aria-label': o.label, dataset: { part: `${o.part ?? 'knob'}-in` } });
    f.value = knobNumber(now, o.step);
    let done = false;
    const end = (keep: boolean) => {
      if (done) return;
      done = true;
      const v = parseFloat(f.value.replace(',', '.'));
      f.replaceWith(box);
      if (keep && Number.isFinite(v)) {
        const w = whole ? Math.round(v) : v;
        const from = now;
        show(w);
        if (w !== from) o.set(w, true, from);
      }
    };
    f.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') end(true);
      if (e.key === 'Escape') end(false);
    });
    f.addEventListener('blur', () => end(true));
    box.replaceWith(f);
    f.focus();
    f.select();
  }
  return el;
}
