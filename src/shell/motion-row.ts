// The card's Motion row (motion-gui, 2026-10-22: asked for as "build an object's movement with the GUI").
//
// Under Position / Angle / Size, one more property of the object: how it moves by itself.
//   Motion  [Back and forth ▾]  ▶          the menu: None, Back and forth, Loop, Once, Spin; ▶ plays it here
//           1.5 m/s      − 2 +             speed (drag the unit to change it, or type), the path's points
// The points themselves are dragged in the game (bridge/motion.ts draws them while the object is picked).
//
// WHY a row of the card and not a fifth button on the strip under the object: the strip is the hand's tools (move,
// height, turn, size — what a drag does now); a motion is a property of the object, like its place, so it sits with
// the place (design.md §1, plan B left out). WHY a native <select>: the four kinds are words, the platform's menu reads
// them aloud, works with a finger and a keyboard, and needs no menu of our own on a card that already floats.
// One element per job, no colour of its own (orange is the path in the game; the row is the card's grey).
//
// Built with h() and textContent only (CONTRACT.md §5). Pure DOM, no state: the card calls motionRow() on each render.
import type { Dim, Motion } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { addPoint, dropPoint, kindOf, withKind, type MotionKind } from './motion-model.ts';

export interface MotionRowDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  dim(): Dim;
  motion(key: string): Motion | null;
  /**
   * A change from the row. `live`: while a speed drag is on (no undo step; the model and the game follow). `from`: the
   * motion before a drag, given with its last change (one undo step from it). `seed`: a path kind was just chosen and
   * has no points yet (the game picks them in sight).
   */
  setMotion(key: string, m: Motion | null, opts?: { live?: boolean; from?: Motion | null; seed?: boolean }): void;
  /** The key whose motion plays on the card's ▶ now (null = none). */
  playing(): string | null;
  play(key: string | null): void;
}

const KINDS: MotionKind[] = ['none', 'pingpong', 'loop', 'once', 'spin'];
const DEG = 180 / Math.PI;

/** The Motion row: label and cells for the card's `.fields` grid (two cells, or four with the second line). */
export function motionRow(d: MotionRowDeps, key: string): HTMLElement[] {
  const m = d.motion(key);
  const kind = kindOf(m);
  const dim = d.dim();
  const sel = h('select', { class: 'motion-kind', 'aria-label': d.t('motion.label'), dataset: { part: 'motion-kind' } });
  for (const k of KINDS) {
    const o = h('option', { value: k, text: d.t(`motion.${k}`) });
    if (k === kind) o.selected = true;
    sel.append(o);
  }
  sel.addEventListener('change', () => {
    const want = sel.value as MotionKind;
    const next = withKind(m, want, dim);
    // A path kind with no points yet: the game picks the first ones where the person can see them (seed).
    d.setMotion(key, next, { seed: !!next?.path && !next.path.length });
  });
  const cells = h('div', { class: 'f-cells motion-cells' }, h('span', { class: 'motion-pick' }, sel, icon('chevronDown')));
  const out: HTMLElement[] = [h('span', { class: 'f-l', text: d.t('motion.label') }), cells];
  if (kind === 'none' || !m) return out;
  // ▶ / ■: this object's motion, in the scene as it stands (nothing else moves; the game is not started).
  const on = d.playing() === key;
  const play = h('button', { type: 'button', class: `icon-btn motion-play${on ? ' on' : ''}`, 'aria-pressed': String(on), dataset: { action: 'motion-play', part: 'motion-play' },
    title: d.t(on ? 'motion.stop' : 'motion.play'), 'aria-label': d.t(on ? 'motion.stop' : 'motion.play'), onclick: () => d.play(on ? null : key) }, icon(on ? 'stop' : 'play'));
  cells.append(play);

  // Second line: the speed, and the path's points (− n +).
  const spin = kind === 'spin';
  const unit = spin ? d.t('motion.degPerSec') : dim === '3d' ? d.t('motion.mPerSec') : d.t('motion.pxPerSec');
  // Spin is shown in degrees a second (people say "a quarter turn a second", not 1.57 rad), written in radians.
  const read = (x: Motion) => (spin ? (x.spin ?? 0) * DEG : x.speed ?? 0);
  const write = (x: Motion, v: number): Motion => (spin ? { ...x, spin: v / DEG } : { ...x, speed: v });
  const show = (v: number) => (spin ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
  const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: false, 'aria-label': `${d.t('motion.speed')} (${unit})`, dataset: { part: 'motion-speed' } });
  input.value = show(read(m));
  input.addEventListener('focus', () => input.select());
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  // A spin may turn either way (a minus turns it clockwise); a path speed is more than 0.
  const ok = (v: number) => Number.isFinite(v) && (spin ? v !== 0 && Math.abs(v) <= 5000 : v > 0 && v <= (dim === '3d' ? 1000 : 100000));
  input.addEventListener('change', () => {
    const v = parseFloat(input.value.replace(',', '.'));
    if (!ok(v)) {
      input.value = show(read(m));
      return;
    }
    d.setMotion(key, write(m, v));
  });
  // The unit is the handle, as the letters X / Y / Z are for the place: drag it left / right (Shift: finer).
  const grab = h('span', { class: 'scrub motion-unit', text: unit, title: d.t('placement.scrub') });
  const per = spin ? 1 : dim === '3d' ? 0.02 : 1;
  let drag: { x: number; v: number; moved: boolean } | null = null;
  const valueAt = (e: PointerEvent) => {
    const v = drag!.v + (e.clientX - drag!.x) * per * (e.shiftKey ? 0.1 : 1);
    const r = Math.round(v / (per / 10)) * (per / 10);
    return spin ? r : Math.max(per / 10, r);
  };
  grab.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    grab.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, v: read(m), moved: false };
    grab.classList.add('on');
  });
  grab.addEventListener('pointermove', (e) => {
    if (!drag || (!drag.moved && Math.abs(e.clientX - drag.x) < 3)) return;
    drag.moved = true;
    const v = valueAt(e);
    if (!ok(v)) return;
    input.value = show(v);
    d.setMotion(key, write(m, v), { live: true });
  });
  const finish = (e: PointerEvent, keep: boolean) => {
    if (!drag) return;
    const dr = drag;
    grab.classList.remove('on');
    if (!dr.moved) {
      drag = null;
      if (keep) input.focus();
      return;
    }
    const v = valueAt(e);
    drag = null;
    d.setMotion(key, keep && ok(v) ? write(m, v) : m, { from: m });
  };
  grab.addEventListener('pointerup', (e) => finish(e, true));
  grab.addEventListener('pointercancel', (e) => finish(e, false));
  const speed = h('label', { class: 'num motion-speed' }, input, grab);
  const line = h('div', { class: 'f-cells motion-more' }, speed);
  if (!spin && m.path) {
    const n = m.path.length;
    const less = h('button', { type: 'button', class: 'icon-btn', disabled: n <= 1, title: d.t('motion.less'), 'aria-label': d.t('motion.less'), dataset: { action: 'motion-less' }, onclick: () => d.setMotion(key, dropPoint(m)) }, icon('minus'));
    const more = h('button', { type: 'button', class: 'icon-btn', disabled: n >= 32, title: d.t('motion.more'), 'aria-label': d.t('motion.more'), dataset: { action: 'motion-more' }, onclick: () => d.setMotion(key, addPoint(m)) }, icon('plus'));
    // The count says what − / + change; its words are the tooltip ("2 points"), the cell itself keeps one line.
    line.append(h('span', { class: 'motion-points', title: d.t('motion.points', { n }), dataset: { part: 'motion-points' } }, less, h('span', { class: 'n', text: String(n), 'aria-label': d.t('motion.points', { n }) }), more));
  }
  out.push(h('span', { class: 'f-l' }), line);
  return out;
}
