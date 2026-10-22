// The timeline plate (studio-timeline, 2026-10-22; CONTRACT.md §1.9): what is drawn and
// what a press on it means. No state of its own beyond a drag in progress: timeline-wire.ts owns the state and gives
// a fresh `view()` each render; every press goes back as one call on `act`.
//
//   ▶  0:01.6 / [4.0] s   ● Auto key   [Row ▾]   ↔ [Back and forth ▾]   Plays [At start ▾]   Keys [Ease in-out ▾]   ⌄
//        0s    1s    2s    3s    4s                     ← the ruler: press / drag = the time (scrub)
//   ▾ rowboat   ◇─────────◇──────◇                      ← one row per object (its keys at any property)
//       Position ◆─────────◆──────◆                     ← ▾ opens position / angle / size
//
// WHY the plate redraws whole on render(): a few rows of a few keys (a game object's motion is tens of keys, not
// thousands), and one code path is easier to keep right than patching. A drag keeps its pointer capture on the track
// element, which is never replaced (only its children are), so a redraw mid-drag does not drop the drag.
// WHY native <select>s for the clip, repeat, start and ease: words a screen reader reads, a finger and a keyboard work,
// no menus of our own on a plate that floats (the card's Motion row made the same choice, motion-gui).
// Colours (shell.css rule 2 + its one exception here): orange = your hand (picked keys, the picked object's row),
// red = recording (● and the time line while auto key is on — the colour every camera and DAW uses for "writing now").
import type { MotionArea, MotionChannel, MotionClip, MotionEase, MotionRepeat, MotionTrigger, MotionUntil, MotionWhen } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { PointKind } from './path-edit.ts';
import { fillLinkList, type LinkItem } from './timeline-link.ts';
import { createMorePop } from './timeline-more.ts';
import { CHANNELS, clock, keyName, keyTimes, sameT, TEMPLATES, type KeyRef, type Template } from './timeline-model.ts';

/** Starts menu, in two groups: what the loader plays by itself, then what your AI connects in the game's code. */
export const SELF_TRIGGERS: MotionTrigger[] = ['start', 'time', 'key', 'click', 'after', 'enter'];
export const AI_TRIGGERS: MotionTrigger[] = ['touch', 'cue', 'say'];
/** "Chest opened!" → "chest-opened" (a cue name the game's code can say as is; CUE_RE in the schema). */
export const cueSlug = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'cue';

/** A row's "when" in a few characters (the timeline's name column, the card's menu): "∞ Always", "⌨ E", "✦ chest-opened". */
export function whenShort(t: (k: string, v?: Record<string, string | number>) => string, w: MotionWhen, until: MotionUntil | null, repeat: MotionRepeat): string {
  const stop = until?.times ? ` · ${until.times}×` : until?.cue ? ` → ${until.cue}` : '';
  if (w.on === 'start') return (repeat !== 'once' && !until ? `∞ ${t('tl.when.always')}` : `▶ ${t('tl.when.short.start')}`) + stop;
  if (w.on === 'time') return `⏱ ${w.after} s${stop}`;
  if (w.on === 'key') return `⌨ ${keyName(w.key)}${stop}`;
  if (w.on === 'after') return `↳ ${w.use}${stop}`;
  if (w.on === 'cue') return `✦ ${w.cue}${stop}`;
  return `${AI_TRIGGERS.includes(w.on) ? '✦ ' : ''}${t(`tl.when.short.${w.on}`)}${stop}`;
}

export interface TimelineRow {
  key: string;
  label: string;
  picked: boolean;
  open: boolean;
  clip: MotionClip | null;
  /** studio-timeline-2, with a scene open: in it (studio-motion-focus: a linked row's × takes it out). */
  member?: boolean;
}

/** Several ways to start, in a row's few characters: "▣ Area or ⌨ E" (studio-timeline-2). */
export function whensShort(t: (k: string, v?: Record<string, string | number>) => string, ws: MotionWhen[], until: MotionUntil | null, repeat: MotionRepeat): string {
  if (ws.length < 2) return whenShort(t, ws[0] ?? { on: 'say' }, until, repeat);
  return ws.map((w, i) => whenShort(t, w, i === ws.length - 1 ? until : null, repeat)).join(` ${t('tl.when.or')} `);
}

export interface TimelineView {
  time: number;
  /** Seconds the ruler shows (the longest clip on screen, at least 1). */
  span: number;
  playing: boolean;
  auto: boolean;
  /** The object whose clip the head's menus act on (the picked one, else the last row pressed). */
  focus: string | null;
  clips: string[];
  clip: MotionClip | null;
  rows: TimelineRow[];
  picked(r: KeyRef): boolean;
  /** The picked keys' ease: one of them, 'mixed', or null with nothing picked. */
  ease: MotionEase | 'mixed' | null;
  narrow: boolean;
  // studio-motion-triggers: the focused clip's start / stop, how many objects use its motion, the scene's cues.
  when: MotionWhen | null;
  until: MotionUntil | null;
  uses: number;
  cues: Array<{ id: string; label: string; ai: boolean; on: boolean }>;
  trying: boolean;
  cueNames: string[];
  afterOpts: Array<{ key: string; use: string; label: string }>;
  rowWhen(key: string): { when: MotionWhen; whens?: MotionWhen[]; until: MotionUntil | null; repeat: MotionRepeat } | null;
  defaultArea(): MotionArea;
  player: string | null;
  /** studio-motion-flow: the focused clip's motion was just attached ("✓ “Hop” attached · When does it move?"), else null. */
  attached: string | null;
  /** studio-motion-flow: the first-time steps are shown (while making: no keys yet; until "Got it" / × / Esc, once). */
  coach: boolean;
  // studio-timeline-2:
  /** Every way the focused clip starts (2–4 = any of them; one = `when`). */
  whens?: MotionWhen[];
  /** The scene open on the plate (a motion of several objects) and how many objects it moves, or null. */
  scene?: { name: string; n: number } | null;
  /** The picked position keys' point kind (Point ▾), or null with none picked. */
  point?: PointKind | 'mixed' | null;
  /** studio-motion-panel: the cue (an id of `cues`) that starts the focused clip — the line's ▷ Try. */
  tryId?: string | null;
  // studio-motion-focus (2026-10-23): the rows are the picked object's.
  /** "+ Link an object" under the rows (null: not now — nothing focused, or every motion shown); `linking` = its list is open. */
  link?: { linking: boolean; items(): LinkItem[] } | null;
  /** ⋯'s "Show every motion in the scene" is on (the rows as before: every moving object). */
  all?: boolean;
  /** How many objects move in the scene (⋯ is there for "every motion" even when the focused object has none). */
  moving?: number;
}

export interface TimelineActs {
  play(on: boolean): void;
  scrub(t: number, end: boolean): void;
  auto(on: boolean): void;
  fold(): void;
  /** The clip menu: a clip's name, `new:<template>`, `rename`, `delete`. */
  clip(value: string): void;
  rename(name: string): void;
  len(seconds: number): void;
  repeat(r: MotionRepeat): void;
  /** When the focused clip starts (a list of 2–4 = any of them) / stops (null = never stops). */
  setWhen(w: MotionWhen | MotionWhen[]): void;
  setUntil(u: MotionUntil | null): void;
  /** A cue's ▶ pressed ("that just happened"), and ■ to stop trying. */
  tryCue(id: string): void;
  tryStop(): void;
  ease(e: MotionEase): void;
  pickRow(key: string): void;
  openRow(key: string): void;
  /** Keys picked on the plate (add: Shift / ⌘ held, the others stay picked). */
  pickKeys(refs: KeyRef[], add: boolean): void;
  /** The picked keys dragged by dt seconds (live while the pointer is down, then `end`). `free`: Alt (no snapping). */
  drag(dt: number, end: boolean, free: boolean): void;
  /** A key was pressed on the plate (keyboard focus is on it): Delete, ⌘C / ⌘V, Space, K, ← →. true = used. */
  key(e: KeyboardEvent): boolean;
  /** The plate was pressed (the keyboard keys then belong to it, not to the scene). */
  touched(): void;
  /** The first-time steps closed ("Got it", ×): never shown again. */
  coachDone(): void;
  /** studio-timeline-2: the picked path points made smooth / corners (Point ▾). */
  point?(kind: PointKind): void;
  /** studio-motion-focus: an object linked to the focused motion (the list, or a click in the game), a linked row's ×. */
  link?(key: string): void;
  /** The list opened / closed: while it is open a click on an object in the game links it. */
  linking?(on: boolean): void;
  leave?(key: string): void;
  /** ⋯'s "Show every motion in the scene" on / off (the rows' "Show only the picked one" turns it off). */
  showAll?(on: boolean): void;
  /**
   * studio-motion-panel: ✦ Ask AI on the focused clip — the chat box below gets the "object · motion" chip and the cursor.
   * Absent = no AI here (the web demo): no button.
   */
  ask?(): void;
  t(key: string, vars?: Record<string, string | number>): string;
}

/** A row's height: 28 px (a mouse), 36 on a phone (shell.css --tl-row; read so the rows and the lanes agree). */
const ROW_PX = 28;

export function createTimelinePanel(view: () => TimelineView, act: TimelineActs) {
  const t = act.t;
  // One line (studio-motion-panel, 2026-10-22; it was three: the head, then "Starts … Stops …", then "Try ▶ ▶"):
  //   ▶ 0:01.6 / 4.0 s  ● Auto key  [Hop ▾]  Starts [Key ▾] [E] ▷  ·····  [Keys ▾]  ⋯  ✦ Ask AI  ⌄
  // what a hand needs every time; the sometimes ones are in ⋯ (timeline-more.ts), the keys' ease only while keys are picked.
  const head = h('div', { class: 'tl-head', dataset: { part: 'tl-head' } });
  const more = createMorePop(() => el.closest<HTMLElement>('.shell') ?? document.body, t('tl.more'), () => {
    head.querySelector('[data-part=tl-more-btn]')?.setAttribute('aria-expanded', 'false');
    head.querySelector('[data-part=tl-more-btn]')?.classList.remove('on');
  });
  // studio-motion-focus: "+ Link an object"'s list, the same popover as ⋯ with its left edge on the button.
  const linkPop = createMorePop(() => el.closest<HTMLElement>('.shell') ?? document.body, t('tl.link'), () => act.linking?.(false), { left: true, width: 300, part: 'tl-link-pop' });
  const ruler = h('div', { class: 'tl-ruler', role: 'slider', 'aria-valuemin': '0', dataset: { part: 'tl-ruler' } });
  const names = h('div', { class: 'tl-names' });
  const lanes = h('div', { class: 'tl-lanes', dataset: { part: 'tl-lanes' } });
  const playhead = h('div', { class: 'tl-playhead', dataset: { part: 'tl-playhead' } }, h('span', { class: 'tl-cap' }));
  const boxEl = h('div', { class: 'tl-box', hidden: true });
  const track = h('div', { class: 'tl-track' }, ruler, lanes, playhead, boxEl);
  const body = h('div', { class: 'tl-body' }, h('div', { class: 'tl-names-col' }, h('div', { class: 'tl-ruler-pad' }), names), track);
  // studio-motion-flow: the three steps, the first time the plate opens (over its right end; shell.css .tl-coach).
  const coach = h('div', { class: 'tl-coach', role: 'note', hidden: true, dataset: { part: 'tl-coach' } });
  const el = h('section', { class: 'timeline', tabindex: '-1', 'aria-label': t('tl.title'), dataset: { part: 'timeline' } }, head, body, coach);

  // Seconds ↔ px on the track (its own box: the names column is outside it).
  const pad = 12;
  const span = () => Math.max(1, view().span);
  const xOf = (s: number) => pad + (s / span()) * Math.max(1, track.clientWidth - pad * 2);
  const tOf = (x: number) => ((x - pad) / Math.max(1, track.clientWidth - pad * 2)) * span();
  const localX = (e: PointerEvent) => e.clientX - track.getBoundingClientRect().left;

  // ----- the head -----
  const select = (part: string, label: string, opts: Array<[string, string, boolean?]>, value: string, onchange: (v: string) => void) => {
    const s = h('select', { 'aria-label': label, title: label, dataset: { part } });
    for (const [v, text, disabled] of opts) {
      const o = h('option', { value: v, text });
      if (disabled) o.disabled = true;
      if (v === value) o.selected = true;
      s.append(o);
    }
    s.addEventListener('change', () => onchange(s.value));
    return h('span', { class: 'tl-pick' }, s, icon('chevronDown'));
  };

  function renderHead(v: TimelineView) {
    const c = v.clip;
    const play = h('button', { type: 'button', class: `icon-btn tl-play${v.playing ? ' on' : ''}`, dataset: { action: 'tl-play', part: 'tl-play' }, 'aria-pressed': String(v.playing),
      title: `${t(v.playing ? 'tl.pause' : 'tl.play')}  Space`, 'aria-label': t(v.playing ? 'tl.pause' : 'tl.play'), onclick: () => act.play(!v.playing) }, icon(v.playing ? 'pause' : 'play'));
    const now = h('span', { class: 'tl-now', dataset: { part: 'tl-now' }, text: clock(v.time) });
    const len = h('input', { type: 'text', inputmode: 'decimal', class: 'tl-len', 'aria-label': t('tl.len'), title: t('tl.len'), autocomplete: 'off', spellcheck: false, dataset: { part: 'tl-len' } });
    len.value = (c?.len ?? v.span).toFixed(1);
    len.disabled = !c;
    len.addEventListener('focus', () => len.select());
    len.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') len.blur();
      e.stopPropagation();
    });
    len.addEventListener('change', () => {
      const s = parseFloat(len.value.replace(',', '.'));
      if (Number.isFinite(s)) act.len(s);
      else len.value = (c?.len ?? v.span).toFixed(1);
    });
    const time = h('span', { class: 'tl-time' }, now, h('span', { class: 'tl-of', text: '/' }), len, h('span', { class: 'tl-of', text: 's' }));
    const auto = h('button', { type: 'button', class: `tl-auto${v.auto ? ' on' : ''}`, dataset: { action: 'tl-auto', part: 'tl-auto' }, 'aria-pressed': String(v.auto),
      title: t(v.auto ? 'tl.autoOn' : 'tl.autoOff'), onclick: () => act.auto(!v.auto) }, h('span', { class: 'tl-dot' }), h('span', { class: 'tl-auto-w', text: t('tl.auto') }));
    // The clip menu: this object's motions, then "New: <template>", then rename / delete.
    const opts: Array<[string, string, boolean?]> = [];
    if (!v.clips.length) opts.push(['', t('tl.noClip'), true]);
    for (const n of v.clips) opts.push([n, n]);
    opts.push(['-', '──────', true]);
    for (const k of TEMPLATES) opts.push([`new:${k}`, t('tl.new', { name: t(`tl.tpl.${k}`) }), !v.focus]);
    if (c) opts.push(['rename', t('tl.rename')], ['delete', t('tl.delete')]);
    const clipSel = select('tl-clip', t('tl.clip'), opts, c?.name ?? '', (val) => {
      if (val === 'rename') return void renaming(c!.name);
      act.clip(val);
    });
    clipSel.classList.add('tl-clip-pick');
    const items: Node[] = [play, time, auto, clipSel];
    // A scene (studio-timeline-2): says what it is — one motion, this many objects (its rows below).
    // Linked (studio-motion-focus): said once there are two (a scene of one is the object's own motion, nothing to say).
    if (c && v.scene && v.scene.n > 1) items.push(h('span', { class: 'tl-scene', title: t('tl.sceneTip'), dataset: { part: 'tl-scene' }, text: t('tl.scene', { n: v.scene.n }) }));
    items.push(...whenItems(v));
    items.push(h('span', { class: 'tl-gap' }));
    // Point ▾ (studio-timeline-2) and Keys ▾: only while a point / keys are picked — what the pick is, where the pick is
    // made. Keys ▾ was on the line always, greyed with no key picked ("Ease in-out" read as the motion's speed, 10/22).
    if (v.point && act.point) {
      const opts: Array<[string, string, boolean?]> = [...(v.point === 'mixed' ? [['', '—', true] as [string, string, boolean]] : []),
        ['smooth', t('tl.point.smooth')], ['corner', t('tl.point.corner')], ['custom', t('tl.point.custom'), true]];
      const pt = select('tl-point', t('tl.pointTip'), opts, v.point === 'mixed' ? '' : v.point, (k) => act.point!(k as PointKind));
      pt.classList.add('tl-point-pick');
      items.push(h('span', { class: 'tl-lbl', text: t('tl.point') }), pt);
    }
    if (v.ease) {
      const ease = select('tl-ease', t('tl.easeTip'), [...(v.ease === 'mixed' ? [['', '—', true] as [string, string, boolean]] : []),
        ...(['linear', 'ease', 'step'] as MotionEase[]).map((e) => [e, t(`tl.ease.${e}`)] as [string, string])], v.ease !== 'mixed' ? v.ease : '', (e) => act.ease(e as MotionEase));
      ease.classList.add('tl-ease-pick');
      items.push(h('span', { class: 'tl-lbl tl-ease-lbl', text: t('tl.ease') }), ease);
    }
    // ⋯ also with no motion here when others move: its "Show every motion in the scene" (studio-motion-focus).
    if (c || v.moving) {
      const open = more.open;
      items.push(h('button', { type: 'button', class: `icon-btn tl-more-btn${open ? ' on' : ''}`, title: t('tl.moreTip'), 'aria-label': t('tl.more'), 'aria-haspopup': 'dialog', 'aria-expanded': String(open),
        dataset: { action: 'tl-more', part: 'tl-more-btn' }, onclick: (e: Event) => toggleMore(e.currentTarget as HTMLElement) }, icon('more')));
    }
    if (c) {
      // ✦ Ask AI (a review of 2026-10-22: "a press puts the motion's and the object's names in the AI chat box, and you talk there"):
      // the chat box below gets the "object · motion" chip and the cursor; the words are the person's, nothing is sent yet.
      if (act.ask) items.push(h('button', { type: 'button', class: 'tl-ask', title: t('tl.askTip', { name: `${v.rows.find((r) => r.key === v.focus)?.label ?? v.focus} · ${c.name}` }),
        dataset: { action: 'tl-ask', part: 'tl-ask' }, onclick: () => act.ask!() }, icon('spark'), h('span', { class: 'tl-ask-w', text: t('tl.ask') })));
    }
    items.push(h('button', { type: 'button', class: 'icon-btn tl-fold', dataset: { action: 'tl-fold' }, title: t('tl.fold'), 'aria-label': t('tl.fold'), onclick: () => (more.hide(), act.fold()) }, icon('chevronDown')));
    // Narrow: the end of the first row (▶ time ● ⋯ ✦ ⌄); the motion and its "when" start a new one (shell.css). Nothing on PC.
    items.push(h('span', { class: 'tl-break', 'aria-hidden': 'true' }));
    head.replaceChildren(...items);
    if (!c && !v.moving) more.hide();
    else if (more.open) renderMore(v);
  }

  /** A small text field that acts on Enter / leaving (Esc: as it was). */
  const field = (part: string, label: string, value: string, width: string, done: (text: string) => void, mode: 'text' | 'decimal' = 'text') => {
    const f = h('input', { type: 'text', inputmode: mode, class: 'tl-field', 'aria-label': label, title: label, autocomplete: 'off', spellcheck: false, style: `width:${width}`, dataset: { part } });
    f.value = value;
    f.addEventListener('focus', () => f.select());
    f.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') f.blur();
      if (e.key === 'Escape') (f.value = value), f.blur();
    });
    f.addEventListener('change', () => done(f.value));
    return f;
  };
  /** A cue name menu: the scene's cues, then "New cue…" (the menu becomes a field for its name). */
  const cueMenu = (part: string, label: string, now: string, names: string[], pick: (name: string) => void) => {
    const all = [...new Set([now, ...names].filter(Boolean))];
    const m = select(part, label, [...all.map((n) => [n, n] as [string, string]), ['+', t('tl.cue.new')]], now, (val) => {
      if (val !== '+') return pick(val);
      const f = field(`${part}-new`, t('tl.cue.name'), '', '9em', (text) => (text.trim() ? pick(cueSlug(text)) : render()));
      f.placeholder = 'chest-opened';
      m.replaceWith(f);
      f.focus();
    });
    return m;
  };

  /** ⋯ pressed: open the sometimes-used settings over it, or close them. */
  function toggleMore(btn: HTMLElement) {
    if (more.open) return more.hide();
    more.show(btn);
    btn.classList.add('on');
    btn.setAttribute('aria-expanded', 'true');
    renderMore(view());
    more.el.querySelector<HTMLElement>('select, button, input')?.focus({ preventScroll: true });
  }

  /** Every way the focused clip starts, with one changed (`x`) or taken out (null): the whole list goes back (setWhen). */
  const sendWhen = (v: TimelineView, i: number, x: MotionWhen | null) => {
    const list = (v.whens?.length ? v.whens : [v.when!]).slice();
    if (x) list[i] = x;
    else list.splice(i, 1);
    act.setWhen(list.length > 1 ? list : list[0]!);
  };
  /** A "Starts" menu: what the loader plays by itself, then what your AI connects (purple ✦, the AI's colour). */
  const startsMenu = (part: string, label: string, w: MotionWhen, v: TimelineView, i: number, groups: boolean) => {
    const s = h('select', { 'aria-label': label, title: w.on === 'say' && w.say ? `${label}: ${w.say}` : label, dataset: { part, ...(i ? { i: String(i) } : {}) } });
    for (const [glabel, list] of [[t('tl.when.self'), SELF_TRIGGERS], [`✦ ${t('tl.when.ai')}`, AI_TRIGGERS]] as Array<[string, MotionTrigger[]]>) {
      const g = groups ? h('optgroup', { label: glabel }) : s;
      for (const on of list) {
        const o = h('option', { value: on, text: t(`tl.when.${on}`) });
        if (on === 'after' && !v.afterOpts.length) o.disabled = true;
        if (on === w.on) o.selected = true;
        g.append(o);
      }
      if (g !== s) s.append(g);
    }
    s.addEventListener('change', () => {
      const on = s.value as MotionTrigger;
      sendWhen(v, i, fresh(on, v));
      // "In the chat…" (studio-motion-panel): the words are said in the chat box, with this motion's chip — not in a
      // second field here (the strip had "Starts [In my words…] [When? (for your AI)]": two ways in for one thing).
      if (on === 'say') act.ask?.();
    });
    return h('span', { class: `tl-pick tl-starts${AI_TRIGGERS.includes(w.on) ? ' ai' : ''}${!i && v.attached ? ' ask' : ''}` }, s, icon('chevronDown'));
  };

  /** The line's "when": Starts ▾ [its field] (+1) ▷ — or, with no motion, what makes one. */
  function whenItems(v: TimelineView): Node[] {
    const c = v.clip;
    const w = v.when;
    if (c && w) {
      const items: Node[] = [];
      // Just attached (studio-motion-flow): say so where the "when" is chosen, and ask the question the menu answers.
      if (v.attached) items.push(h('span', { class: 'tl-attached', dataset: { part: 'tl-attached' }, text: `✓ ${t('tl.attached', { name: v.attached })}` }),
        h('span', { class: 'tl-lbl', text: t('tl.whenAsk') }));
      else items.push(h('span', { class: 'tl-lbl', text: t('tl.starts') }));
      items.push(startsMenu('tl-starts', t('tl.starts'), w, v, 0, true), ...whenField(w, v, (x) => sendWhen(v, 0, x)));
      // The other ways it starts (studio-timeline-2's "or") live in ⋯; the line says there are some ("+1").
      const others = (v.whens?.length ?? 1) - 1;
      if (others > 0) items.push(h('button', { type: 'button', class: 'tl-or-more', title: t('tl.when.orMoreTip'), dataset: { part: 'tl-or-more' },
        onclick: (e: Event) => (more.open || toggleMore(head.querySelector<HTMLElement>('[data-part=tl-more-btn]') ?? (e.currentTarget as HTMLElement))) }, t('tl.when.orMore', { n: others })));
      // ▷ Try this one (the brief of 2026-10-22: "Try belongs with 'when'"): as if its start just happened. Every cue is in ⋯.
      const mine = v.cues.find((q) => q.id === v.tryId);
      if (v.trying) items.push(h('button', { type: 'button', class: 'icon-btn tl-try-this on', title: t('tl.try.stop'), 'aria-label': t('tl.try.stop'), dataset: { part: 'tl-try-this' }, onclick: () => act.tryStop() }, icon('pause')));
      else if (mine) items.push(h('button', { type: 'button', class: `icon-btn tl-try-this${mine.ai ? ' ai' : ''}`, title: t(mine.ai ? 'tl.try.aiTip' : 'tl.try.tip', { name: mine.label }),
        'aria-label': t('tl.try.tip', { name: mine.label }), dataset: { part: 'tl-try-this', cue: mine.id }, onclick: () => act.tryCue(mine.id) }, icon('play')));
      return items;
    }
    if (v.focus) {
      // An object with no motion yet (studio-motion-flow: "+ New motion" lands here): what makes one, in one line.
      const name = v.rows.find((r) => r.key === v.focus)?.label ?? v.focus;
      return [h('span', { class: 'tl-lbl tl-first', dataset: { part: 'tl-first' }, text: t('tl.when.first', { name }) })];
    }
    return [h('span', { class: 'tl-lbl tl-first', text: t('tl.when.none') })];
  }

  /** ⋯'s rows: Repeat, Stops, the other ways it starts, Try (every cue), and who else uses this motion. */
  function renderMore(v: TimelineView) {
    const c = v.clip;
    const w = v.when;
    const row = (part: string, label: string, ...kids: Array<Node | null>) =>
      h('div', { class: 'tl-more-row', dataset: { part } }, h('span', { class: 'tl-more-k', text: label }), h('div', { class: 'tl-more-v' }, ...kids));
    // Rows: every motion in the scene (studio-motion-focus, 2026-10-23: the plate shows the picked object only; the
    // whole scene stays one press away, here, where the sometimes-used things are). Last: it is about the plate, not the motion.
    const allRow = row('tl-more-all', t('tl.all.k'), act.showAll ? h('button', { type: 'button', class: `tl-all${v.all ? ' on' : ''}`, 'aria-pressed': String(!!v.all), dataset: { part: 'tl-all' },
      onclick: () => (more.hide(), act.showAll!(!v.all)) }, icon('list'), h('span', { text: t(v.all ? 'tl.all.off' : 'tl.all') })) : null);
    const btn0 = head.querySelector<HTMLElement>('[data-part=tl-more-btn]');
    if (!c || !w) {
      if (!v.moving || !btn0) return more.hide();
      more.el.replaceChildren(allRow);
      return more.place(btn0);
    }
    const rows: HTMLElement[] = [];
    rows.push(row('tl-more-repeat', t('tl.repeat'), select('tl-repeat', t('tl.repeat'), (['once', 'loop', 'pingpong'] as MotionRepeat[]).map((r) => [r, t(`tl.repeat.${r}`)]), c.repeat ?? 'once', (r) => act.repeat(r as MotionRepeat))));
    // Stops ▾: never / after N rounds / a cue; then: stay or go back.
    const u = v.until;
    const kind = u?.times ? 'times' : u?.cue ? 'cue' : 'never';
    const stops: Node[] = [select('tl-stops', t('tl.stops'), [['never', t('tl.until.never')], ['times', t('tl.until.times')], ['cue', t('tl.until.cue')]], kind, (k) =>
      act.setUntil(k === 'never' ? null : k === 'times' ? { times: 3, ...(u?.then ? { then: u.then } : {}) } : { cue: v.cueNames[0] ?? cueSlug(`${c.name}-stop`), ...(u?.then ? { then: u.then } : {}) }))];
    if (u?.times) stops.push(field('tl-times', t('tl.until.timesTip'), String(u.times), '3em', (x) => {
      const n = Math.round(parseFloat(x));
      if (n >= 1) act.setUntil({ ...u, times: Math.min(1000, n) });
      else render();
    }, 'decimal'), h('span', { class: 'tl-of', text: t('tl.until.timesUnit') }));
    if (u?.cue) stops.push(cueMenu('tl-until-cue', t('tl.until.cue'), u.cue, v.cueNames, (n) => act.setUntil({ ...u, cue: n })));
    if (u) stops.push(select('tl-then', t('tl.then'), [['stay', t('tl.then.stay')], ['reset', t('tl.then.reset')]], u.then ?? 'stay', (x) => act.setUntil({ ...u, then: x === 'reset' ? 'reset' : undefined })));
    rows.push(row('tl-more-stops', t('tl.stops'), ...stops));
    // The other ways it starts (studio-timeline-2): each with its field and ×, then "+ or" (up to 4 in all).
    const ws = v.whens?.length ? v.whens : [w];
    const ors: Node[] = [];
    ws.slice(1).forEach((x, j) => {
      const i = j + 1;
      ors.push(h('span', { class: 'tl-or-way' }, h('span', { class: 'tl-or', text: t('tl.when.or') }), startsMenu('tl-starts-or', t('tl.when.orTip'), x, v, i, false),
        ...whenField(x, v, (y) => sendWhen(v, i, y), i),
        h('button', { type: 'button', class: 'icon-btn tl-or-x', title: t('tl.when.orRemove'), 'aria-label': t('tl.when.orRemove'), dataset: { part: 'tl-or-x', i: String(i) }, onclick: () => sendWhen(v, i, null) }, icon('close'))));
    });
    if (ws.length < 4) {
      // The next way: one not used yet, in the menu's order (a click, then a key…).
      const next = (['click', 'key', 'enter', 'time', 'cue', 'touch', 'start'] as MotionTrigger[]).find((on) => !ws.some((x) => x.on === on)) ?? 'key';
      ors.push(h('button', { type: 'button', class: 'tl-or-add', title: t('tl.when.orAddTip'), dataset: { part: 'tl-or-add' }, onclick: () => act.setWhen([...ws, fresh(next, v)]) }, t('tl.when.orAdd')));
    }
    rows.push(row('tl-more-or', t('tl.when.also'), ...ors));
    // Try: one ▶ per cue in the scene (Unity's Animator: the Parameters' Trigger buttons).
    const tries = v.cues.map((q) => h('button', { type: 'button', class: `tl-cue${q.on ? ' on' : ''}${q.ai ? ' ai' : ''}`, title: t(q.ai ? 'tl.try.aiTip' : 'tl.try.tip', { name: q.label }), dataset: { cue: q.id, part: 'tl-cue' },
      onclick: () => act.tryCue(q.id) }, h('i', { 'aria-hidden': 'true' }, icon('play')), h('span', { text: q.label })));
    if (v.trying) tries.push(h('button', { type: 'button', class: 'tl-cue stop', title: t('tl.try.stop'), dataset: { part: 'tl-try-stop' }, onclick: () => act.tryStop() }, h('i', { 'aria-hidden': 'true' }, icon('pause')), h('span', { text: t('tl.try.stop') })));
    rows.push(row('tl-tries', t('tl.try'), ...tries));
    // The motion is the Library's: used by 2 or more objects, a key changed here changes them all — say so, small.
    if (v.uses > 1 && !v.scene) rows.push(h('p', { class: 'tl-uses', title: t('tl.usesTip'), dataset: { part: 'tl-uses' }, text: t('tl.usesLong', { n: v.uses }) }));
    rows.push(allRow);
    more.el.replaceChildren(...rows);
    const btn = head.querySelector<HTMLElement>('[data-part=tl-more-btn]');
    if (btn) more.place(btn);
  }

  /** A trigger with its first values, when the Starts menu changes. */
  function fresh(on: MotionTrigger, v: TimelineView): MotionWhen {
    switch (on) {
      case 'time': return { on, after: 3 };
      case 'key': return { on, key: 'KeyE' };
      case 'after': return { on, use: v.afterOpts[0]!.use, key: v.afterOpts[0]!.key };
      case 'enter': return { on, area: v.defaultArea(), ...(v.player ? { who: v.player } : {}) };
      case 'cue': return { on, cue: v.cueNames[0] ?? cueSlug(`${v.clip?.name ?? 'motion'}`) };
      case 'say': return { on };
      default: return { on } as MotionWhen;
    }
  }

  /** The field next to Starts: seconds, the key, which motion, the area's size, the cue, the words. */
  function whenField(w: MotionWhen, v: TimelineView, set: (w: MotionWhen) => void = (x) => act.setWhen(x), i = 0): Node[] {
    // The second, third… way to start (studio-timeline-2) has its fields marked with its place (data-i).
    const tag = (n: Node[]) => (i && n.forEach((e) => e instanceof HTMLElement && (e.dataset.i = String(i))), n);
    return tag(whenFieldOf(w, v, set));
  }
  function whenFieldOf(w: MotionWhen, v: TimelineView, set: (w: MotionWhen) => void): Node[] {
    if (w.on === 'time') return [field('tl-after', t('tl.when.afterTip'), String(w.after), '3em', (x) => {
      const n = parseFloat(x.replace(',', '.'));
      if (n >= 0) set({ on: 'time', after: Math.min(600, Math.round(n * 1000) / 1000) });
      else render();
    }, 'decimal'), h('span', { class: 'tl-of', text: 's' })];
    if (w.on === 'key') {
      // Press, then press the key (the next key goes to this button only; Esc: as it was).
      const b = h('button', { type: 'button', class: 'tl-keycap', title: t('tl.when.keyTip'), dataset: { part: 'tl-key-pick' }, text: keyName(w.key) });
      b.addEventListener('click', () => {
        b.textContent = t('tl.when.keyPress');
        b.classList.add('listen');
        const onKey = (e: KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          b.removeEventListener('keydown', onKey);
          if (e.key === 'Escape') return render();
          set({ on: 'key', key: e.code });
        };
        b.addEventListener('keydown', onKey);
        b.addEventListener('blur', () => render(), { once: true });
      });
      return [b];
    }
    if (w.on === 'after') {
      const val = `${w.key ?? v.focus}\n${w.use}`;
      const opts = v.afterOpts.map((o) => [`${o.key}\n${o.use}`, o.label] as [string, string]);
      if (!opts.some((o) => o[0] === val)) opts.unshift([val, `${w.key ?? ''} · ${w.use}`]);
      return [select('tl-after-clip', t('tl.when.after'), opts, val, (x) => {
        const [key, use] = x.split('\n');
        set({ on: 'after', use: use!, ...(key && key !== v.focus ? { key } : {}) });
      })];
    }
    if (w.on === 'enter') {
      const size = w.area.size.map((n) => Math.round(n * 10) / 10).join(' × ');
      const unit = w.area.size.length === 3 ? 'm' : 'px';
      return [field('tl-area', t('tl.area.tip'), `${size} ${unit}`, '8.5em', (x) => {
        const n = x.replace(/[^0-9.,\s×x*]/g, ' ').split(/[\s×x*,]+/).map(parseFloat).filter((q) => q > 0);
        const k = w.area.size.length;
        if (!n.length) return render();
        const sz = Array.from({ length: k }, (_, i) => n[i] ?? n[n.length - 1]!);
        set({ ...w, area: { ...w.area, size: sz } });
      })];
    }
    if (w.on === 'cue') return [cueMenu('tl-cue-name', t('tl.when.cue'), w.cue, v.cueNames, (n) => set({ on: 'cue', cue: n }))];
    // 'say' has no field (studio-motion-panel): its words are said in the chat box, with the motion's chip (Starts ▾ title shows old ones).
    return [];
  }

  /** The clip menu's "Rename…": the menu becomes a field with the name, Enter / leaving keeps it, Esc goes back. */
  function renaming(name: string) {
    const pick = head.querySelector('.tl-clip-pick');
    if (!pick) return;
    const f = h('input', { type: 'text', class: 'tl-rename', 'aria-label': t('tl.renameTip'), title: t('tl.renameTip'), maxlength: '40', dataset: { part: 'tl-rename' } });
    f.value = name;
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      if (keep && f.value.trim() && f.value.trim() !== name) act.rename(f.value.trim());
      else render();
    };
    f.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    f.addEventListener('blur', () => finish(true));
    pick.replaceWith(f);
    f.focus();
    f.select();
  }

  // ----- rows and keys -----
  type Lane = { key: string; ch: MotionChannel | null; y: number };
  let laneList: Lane[] = [];

  let ROW = ROW_PX;
  function renderRows(v: TimelineView) {
    ROW = parseFloat(getComputedStyle(el).getPropertyValue('--tl-row')) || ROW_PX;
    names.replaceChildren();
    lanes.replaceChildren();
    laneList = [];
    if (!v.rows.length) {
      lanes.append(h('p', { class: 'tl-empty', text: t('tl.empty') }));
      return;
    }
    // Every motion shown: what the rows are, and the way back — on top (below, it scrolled out of a plate of 5 rows).
    let y = allRow(v, 0);
    for (const r of v.rows) {
      const chs = CHANNELS.filter((ch) => r.clip?.keys[ch]?.length);
      const name = h('div', { class: `tl-name${r.picked ? ' picked' : ''}`, style: `height:${ROW}px`, dataset: { row: r.key } },
        h('button', { type: 'button', class: `tl-twist${r.open ? ' open' : ''}`, 'aria-expanded': String(r.open), title: t('tl.expand'), 'aria-label': t('tl.expand'), onclick: () => act.openRow(r.key) }, icon('chevronRight')),
        h('button', { type: 'button', class: 'tl-obj', text: r.label, onclick: () => act.pickRow(r.key) }),
        r.clip && !v.scene ? h('span', { class: 'tl-clipname', text: r.clip.name }) : null,
        (() => {
          const rw = v.rowWhen(r.key);
          // In a scene every row starts as one: the head says when, not each row.
          if (!rw || v.narrow || v.scene) return null;
          const ai = AI_TRIGGERS.includes(rw.when.on);
          return h('span', { class: `tl-whenchip${ai ? ' ai' : ''}`, dataset: { part: 'tl-whenchip' }, text: whensShort(t, rw.whens ?? [rw.when], rw.until, rw.repeat) });
        })(),
        // A linked object can be unlinked (studio-timeline-2's ×; studio-motion-focus: not the row being made — the
        // picked / focused one is what the others are linked to). Shown on hover; on a phone always.
        v.scene && r.member && !r.picked && r.key !== v.focus && act.leave ? h('button', { type: 'button', class: 'icon-btn tl-leave', title: t('tl.scene.leave', { name: r.label, scene: v.scene.name }), 'aria-label': t('tl.scene.leave', { name: r.label, scene: v.scene.name }),
          dataset: { part: 'tl-leave', key: r.key }, onclick: () => act.leave!(r.key) }, icon('close')) : null);
      names.append(name);
      const lane = h('div', { class: `tl-lane${r.picked ? ' picked' : ''}`, style: `top:${y}px;height:${ROW}px`, dataset: { lane: r.key } });
      lanes.append(lane);
      laneList.push({ key: r.key, ch: null, y });
      drawKeys(lane, r, null, keyTimes(r.clip), v);
      // A linked object with no key yet (just linked): what gives it some, where they will be.
      if (v.scene && r.member && r.key !== v.focus && !keyTimes(r.clip).length) lane.append(h('span', { class: 'tl-lane-hint', text: t('tl.link.empty') }));
      y += ROW;
      if (!r.open) continue;
      for (const ch of CHANNELS) {
        names.append(h('div', { class: `tl-name sub${chs.includes(ch) ? '' : ' none'}`, style: `height:${ROW}px`, text: t(`tl.ch.${ch}`) }));
        const sub = h('div', { class: 'tl-lane sub', style: `top:${y}px;height:${ROW}px`, dataset: { lane: r.key, ch } });
        lanes.append(sub);
        laneList.push({ key: r.key, ch, y });
        drawKeys(sub, r, ch, keyTimes(r.clip, [ch]), v);
        y += ROW;
      }
    }
    y = linkRow(v, y);
    lanes.style.height = `${y}px`;
  }

  /**
   * Under the rows (studio-motion-focus): "+ Link an object" — quiet (the second colour, no fill) because the picked
   * object's own motion is the plate's subject; while its list is open the lane says "or click an object in the game".
   * With every motion shown (allRow, above the rows): what the rows are now, and the way back.
   */
  function allRow(v: TimelineView, y: number): number {
    if (!v.all || !act.showAll) return y;
    names.append(h('div', { class: 'tl-name tl-link-name', style: `height:${ROW}px` },
      h('button', { type: 'button', class: 'tl-link', dataset: { part: 'tl-all-off' }, onclick: () => act.showAll!(false) }, icon('close'), h('span', { text: t('tl.all.off') }))));
    lanes.append(h('div', { class: 'tl-lane tl-link-lane', style: `top:${y}px;height:${ROW}px` }, h('span', { class: 'tl-lane-hint', text: t('tl.all.on') })));
    return y + ROW;
  }
  function linkRow(v: TimelineView, y: number): number {
    if (!v.link || !act.link) return y;
    const on = v.link.linking;
    const btn = h('button', { type: 'button', class: `tl-link${on ? ' on' : ''}`, 'aria-expanded': String(on), 'aria-haspopup': 'dialog',
      title: t('tl.linkTip', { name: v.rows.find((r) => r.key === v.focus)?.label ?? v.focus ?? '' }), dataset: { part: 'tl-link' }, onclick: () => toggleLink(btn) }, icon('plus'), h('span', { text: t('tl.link') }));
    names.append(h('div', { class: 'tl-name tl-link-name', style: `height:${ROW}px` }, btn));
    lanes.append(h('div', { class: 'tl-lane tl-link-lane', style: `top:${y}px;height:${ROW}px` }, on && !v.narrow ? h('span', { class: 'tl-lane-hint', text: t('tl.link.hint') }) : null));
    return y + ROW;
  }
  /** "+ Link an object" pressed: its list over it (the scene's objects), or closed. */
  function toggleLink(btn: HTMLElement) {
    if (linkPop.open) return linkPop.hide();
    const v = view();
    if (!v.link) return;
    more.hide();
    linkPop.show(btn);
    const name = v.rows.find((r) => r.key === v.focus)?.label ?? v.focus ?? '';
    fillLinkList(linkPop.el, { title: t('tl.link.title', { name }), find: t('tl.link.find'), none: t('tl.link.none'), items: v.link.items(), focus: !v.narrow, pick: (k) => act.link!(k) });
    act.linking?.(true);
  }

  function drawKeys(lane: HTMLElement, r: TimelineRow, ch: MotionChannel | null, times: number[], v: TimelineView) {
    if (times.length > 1) lane.append(h('div', { class: 'tl-span', style: `left:${xOf(times[0]!)}px;width:${xOf(times[times.length - 1]!) - xOf(times[0]!)}px` }));
    for (const s of times) {
      const refs = refsAt(r, ch, s);
      const on = refs.length > 0 && refs.every((x) => v.picked(x));
      const label = t('tl.key', { ch: ch ? t(`tl.ch.${ch}`) : r.label, t: s.toFixed(2) });
      lane.append(h('div', { class: `tl-key${ch ? '' : ' sum'}${on ? ' on' : ''}`, style: `left:${xOf(s)}px`, role: 'button', 'aria-pressed': String(on), 'aria-label': label, title: label,
        dataset: { key: r.key, ch: ch ?? '', t: String(s), part: 'tl-key' } }));
    }
  }

  /** The keys one diamond stands for: one key, or every property's key at that time (an object row's diamond). */
  function refsAt(r: TimelineRow, ch: MotionChannel | null, s: number): KeyRef[] {
    const chs = ch ? [ch] : CHANNELS;
    return chs.filter((c) => r.clip?.keys[c]?.some((k) => sameT(k.t, s))).map((c) => ({ key: r.key, ch: c, t: s }));
  }
  const rowOf = (key: string) => view().rows.find((r) => r.key === key);

  // ----- presses on the track -----
  let drag: { kind: 'scrub' | 'keys' | 'box'; x0: number; y0: number; id: number; moved: boolean; add: boolean; refs?: KeyRef[] } | null = null;
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    act.touched();
    el.focus({ preventScroll: true });
    const x = localX(e);
    const y = e.clientY - lanes.getBoundingClientRect().top;
    const target = e.target as HTMLElement;
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    track.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (ruler.contains(target) || target === playhead || playhead.contains(target)) {
      drag = { kind: 'scrub', x0: x, y0: y, id: e.pointerId, moved: false, add };
      act.scrub(Math.max(0, tOf(x)), false);
      return;
    }
    const k = target.closest<HTMLElement>('[data-part=tl-key]');
    if (k) {
      const r = rowOf(k.dataset.key!);
      const refs = r ? refsAt(r, (k.dataset.ch || null) as MotionChannel | null, Number(k.dataset.t)) : [];
      const v = view();
      const on = refs.every((x) => v.picked(x));
      // A press on a picked key keeps the picking (so several drag together); Shift on a picked key unpicks it on release.
      if (!on) act.pickKeys(refs, add);
      drag = { kind: 'keys', x0: x, y0: y, id: e.pointerId, moved: false, add: add && on, refs };
      return;
    }
    drag = { kind: 'box', x0: x, y0: y, id: e.pointerId, moved: false, add };
  });
  track.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const x = localX(e);
    const y = e.clientY - lanes.getBoundingClientRect().top;
    if (!drag.moved && Math.hypot(x - drag.x0, y - drag.y0) < 3) return;
    drag.moved = true;
    if (drag.kind === 'scrub') act.scrub(Math.max(0, tOf(x)), false);
    else if (drag.kind === 'keys') act.drag(tOf(x) - tOf(drag.x0), false, e.altKey);
    else {
      const [l, r] = [Math.min(x, drag.x0), Math.max(x, drag.x0)];
      const [tp, bt] = [Math.min(y, drag.y0), Math.max(y, drag.y0)];
      const top = lanes.offsetTop;
      Object.assign(boxEl.style, { left: `${l}px`, width: `${r - l}px`, top: `${top + tp}px`, height: `${bt - tp}px` });
      boxEl.hidden = false;
    }
  });
  const up = (e: PointerEvent, cancel: boolean) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    const x = localX(e);
    const y = e.clientY - lanes.getBoundingClientRect().top;
    if (d.kind === 'scrub') act.scrub(Math.max(0, tOf(x)), true);
    else if (d.kind === 'keys') {
      if (d.moved) act.drag(cancel ? 0 : tOf(x) - tOf(d.x0), true, e.altKey);
      else if (d.add && d.refs) {
        // Shift-press on a picked key without moving: unpick it (the keys it stood for, kept from the press).
        const off = d.refs;
        act.pickKeys(allPicked(view()).filter((p) => !off.some((o) => o.ch === p.ch && o.key === p.key && sameT(o.t, p.t))), false);
      }
    } else {
      boxEl.hidden = true;
      if (!d.moved) {
        if (!d.add) act.pickKeys([], false);
        return;
      }
      const [t0, t1] = [tOf(Math.min(x, d.x0)), tOf(Math.max(x, d.x0))];
      const [y0, y1] = [Math.min(y, d.y0), Math.max(y, d.y0)];
      const v = view();
      const refs: KeyRef[] = [];
      for (const l of laneList) {
        if (l.y + ROW < y0 || l.y > y1) continue;
        const r = v.rows.find((x) => x.key === l.key);
        if (!r) continue;
        for (const s of keyTimes(r.clip, l.ch ? [l.ch] : CHANNELS)) if (s >= t0 && s <= t1) refs.push(...refsAt(r, l.ch, s));
      }
      act.pickKeys(refs, d.add);
    }
  };
  track.addEventListener('pointerup', (e) => up(e, false));
  track.addEventListener('pointercancel', (e) => up(e, true));
  // A double press on a key puts the time line on it (Blender: ctrl-click / Unity: double-click).
  track.addEventListener('dblclick', (e) => {
    const k = (e.target as HTMLElement).closest<HTMLElement>('[data-part=tl-key]');
    if (k) act.scrub(Number(k.dataset.t), true);
  });
  el.addEventListener('pointerdown', () => act.touched());
  el.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (act.key(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  });

  /** Every picked key of the rows on screen (for "unpick one"). */
  function allPicked(v: TimelineView): KeyRef[] {
    const out: KeyRef[] = [];
    for (const r of v.rows) for (const ch of CHANNELS) for (const k of r.clip?.keys[ch] ?? []) if (v.picked({ key: r.key, ch, t: k.t })) out.push({ key: r.key, ch, t: k.t });
    return out;
  }

  /** Only the time line and the readout: every frame while ▶ plays (the rows stay as they are). */
  function place(v: TimelineView = view()) {
    const x = xOf(Math.min(v.time, span()));
    playhead.style.transform = `translateX(${x.toFixed(1)}px)`;
    (playhead.firstChild as HTMLElement).textContent = v.time.toFixed(1);
    const now = head.querySelector('[data-part=tl-now]');
    if (now) now.textContent = clock(v.time);
    ruler.setAttribute('aria-valuenow', v.time.toFixed(2));
    ruler.setAttribute('aria-valuemax', span().toFixed(2));
  }

  function renderRuler(v: TimelineView) {
    ruler.replaceChildren();
    ruler.setAttribute('aria-label', t('tl.ruler'));
    ruler.title = t('tl.ruler');
    const s = span();
    // A tick every second (every half on a wide plate with a short span), labelled on whole seconds.
    const step = s <= 4 && !v.narrow ? 0.5 : s <= 12 ? 1 : s <= 40 ? 5 : 10;
    for (let x = 0; x <= s + 1e-6; x += step) {
      const whole = Math.abs(x - Math.round(x)) < 1e-6;
      ruler.append(h('span', { class: `tl-tick${whole ? '' : ' half'}`, style: `left:${xOf(x)}px`, text: whole ? `${Math.round(x)}s` : '' }));
    }
    const c = v.clip;
    // Past the picked clip's end: shaded (keys cannot go there; its length is the field in the head).
    if (c && c.len < s) lanes.append(h('div', { class: 'tl-after', style: `left:${xOf(c.len)}px` }));
  }

  function render() {
    const v = view();
    // A menu of the head that has the keyboard keeps it through a redraw (the head is drawn anew each time): the
    // "When does it move?" focus after an attach (studio-motion-flow) would otherwise be lost to the next pick's echo.
    // …and ⋯'s menus the same (they are drawn anew with the head).
    const inMore = more.el.contains(document.activeElement);
    const had = document.activeElement instanceof HTMLSelectElement && (el.contains(document.activeElement) || inMore) ? document.activeElement.dataset.part : null;
    el.classList.toggle('rec', v.auto);
    el.classList.toggle('narrow', v.narrow);
    renderHead(v);
    if (had) (inMore ? more.el : el).querySelector<HTMLSelectElement>(`select[data-part="${had}"]`)?.focus({ preventScroll: true });
    renderRows(v);
    // The link list follows its button (drawn anew with the rows), and closes once it is done (linked, or Esc in the game).
    if (linkPop.open) {
      const b = names.querySelector<HTMLElement>('[data-part=tl-link]');
      if (!v.link?.linking || !b) linkPop.hide();
      else linkPop.place(b);
    }
    renderRuler(v);
    renderCoach(v);
    place(v);
  }

  /**
   * The first-time steps (studio-motion-flow; a hands-on try, 2026-10-22: "I couldn't tell how to make a motion"): what the plate
   * is for, in the order a hand does it. Shown while v.coach; "Got it", × or Esc closes it for good (TimelineDeps.seen).
   */
  function renderCoach(v: TimelineView) {
    coach.hidden = !v.coach;
    if (!v.coach) return void coach.replaceChildren();
    if (coach.childElementCount) return;
    const done = () => act.coachDone();
    const steps = h('ol', {}, ...['tl.coach.1', 'tl.coach.2', 'tl.coach.3'].map((k, i) => h('li', {}, h('i', { 'aria-hidden': 'true', text: String(i + 1) }), h('span', { text: t(k) }))));
    coach.replaceChildren(
      h('div', { class: 'tl-coach-head' }, h('b', { text: t('tl.coach.title') }),
        h('button', { type: 'button', class: 'icon-btn tl-coach-x', 'aria-label': t('btn.close'), title: t('btn.close'), onclick: done }, icon('close'))),
      steps,
      h('div', { class: 'tl-coach-foot' }, h('button', { type: 'button', class: 'tl-coach-ok', dataset: { part: 'tl-coach-ok' }, text: t('tl.coach.ok'), onclick: done })));
  }

  /** "When does it move?" open after an attach: the Starts menu focused, and opened where the browser allows it. */
  function focusStarts() {
    const s = head.querySelector<HTMLSelectElement>('[data-part=tl-starts]');
    if (!s) return;
    s.focus({ preventScroll: true });
    try {
      (s as HTMLSelectElement & { showPicker?: () => void }).showPicker?.();
    } catch {
      /* no user gesture left (a drop that waited for the game's answer): focused, with its orange ring */
    }
  }

  // The track's width changes with the window: the keys' places come from it.
  new ResizeObserver(() => el.isConnected && !el.hidden && render()).observe(track);

    /** ⋯ closed (the plate was hidden: the Library, Play, fold). Optional for the tests' stand-in panels. */
  const closeMore: (() => void) | undefined = () => (more.hide(), linkPop.hide());
  return { el, render, place, focusStarts, closeMore };
}
