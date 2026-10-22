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
  rowWhen(key: string): { when: MotionWhen; until: MotionUntil | null; repeat: MotionRepeat } | null;
  defaultArea(): MotionArea;
  player: string | null;
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
  /** When the focused clip starts / stops (null = never stops). */
  setWhen(w: MotionWhen): void;
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
  t(key: string, vars?: Record<string, string | number>): string;
}

/** A row's height: 28 px (a mouse), 36 on a phone (shell.css --tl-row; read so the rows and the lanes agree). */
const ROW_PX = 28;

export function createTimelinePanel(view: () => TimelineView, act: TimelineActs) {
  const t = act.t;
  const head = h('div', { class: 'tl-head' });
  // The clip's "when" (studio-motion-triggers): Starts ▾ [its field]  Stops ▾ [its field]  …  Try ▶ ▶ ▶
  const whenRow = h('div', { class: 'tl-when-row', dataset: { part: 'tl-when-row' } });
  const ruler = h('div', { class: 'tl-ruler', role: 'slider', 'aria-valuemin': '0', dataset: { part: 'tl-ruler' } });
  const names = h('div', { class: 'tl-names' });
  const lanes = h('div', { class: 'tl-lanes', dataset: { part: 'tl-lanes' } });
  const playhead = h('div', { class: 'tl-playhead', dataset: { part: 'tl-playhead' } }, h('span', { class: 'tl-cap' }));
  const boxEl = h('div', { class: 'tl-box', hidden: true });
  const track = h('div', { class: 'tl-track' }, ruler, lanes, playhead, boxEl);
  const body = h('div', { class: 'tl-body' }, h('div', { class: 'tl-names-col' }, h('div', { class: 'tl-ruler-pad' }), names), track);
  const el = h('section', { class: 'timeline', tabindex: '-1', 'aria-label': t('tl.title'), dataset: { part: 'timeline' } }, head, whenRow, body);

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
    if (c) {
      items.push(select('tl-repeat', t('tl.repeat'), (['once', 'loop', 'pingpong'] as MotionRepeat[]).map((r) => [r, t(`tl.repeat.${r}`)]), c.repeat ?? 'once', (r) => act.repeat(r as MotionRepeat)));
      // The motion is the Library's: used by 2 or more objects, a key changed here changes them all — say so, small.
      if (v.uses > 1) items.push(h('span', { class: 'tl-uses', title: t('tl.usesTip'), dataset: { part: 'tl-uses' }, text: t('tl.uses', { n: v.uses }) }));
    }
    const ease = select('tl-ease', t('tl.easeTip'), [...(v.ease === 'mixed' || !v.ease ? [['', v.ease ? '—' : t('tl.ease'), true] as [string, string, boolean]] : []),
      ...(['linear', 'ease', 'step'] as MotionEase[]).map((e) => [e, t(`tl.ease.${e}`)] as [string, string])], v.ease && v.ease !== 'mixed' ? v.ease : '', (e) => act.ease(e as MotionEase));
    ease.classList.toggle('off', !v.ease);
    ease.classList.add('tl-ease-pick');
    (ease.firstChild as HTMLSelectElement).disabled = !v.ease;
    items.push(h('span', { class: 'tl-gap' }), ease);
    items.push(h('button', { type: 'button', class: 'icon-btn tl-fold', dataset: { action: 'tl-fold' }, title: t('tl.fold'), 'aria-label': t('tl.fold'), onclick: () => act.fold() }, icon('chevronDown')));
    // Narrow: the end of the first row (▶ time ● ⌄); the menus start a new one (shell.css). Nothing on PC.
    items.push(h('span', { class: 'tl-break', 'aria-hidden': 'true' }));
    head.replaceChildren(...items);
    renderWhen(v);
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

  /** The second row: when the focused clip starts and stops, and the scene's cues to try. */
  function renderWhen(v: TimelineView) {
    const c = v.clip;
    const w = v.when;
    const items: Node[] = [];
    if (c && w) {
      items.push(h('span', { class: 'tl-lbl', text: t('tl.starts') }));
      // Starts ▾: two groups, so the person sees which ones the AI has to connect (purple ✦, the AI's colour).
      const s = h('select', { 'aria-label': t('tl.starts'), title: t('tl.startsTip'), dataset: { part: 'tl-starts' } });
      for (const [label, list] of [[t('tl.when.self'), SELF_TRIGGERS], [`✦ ${t('tl.when.ai')}`, AI_TRIGGERS]] as Array<[string, MotionTrigger[]]>) {
        const g = h('optgroup', { label });
        for (const on of list) {
          const o = h('option', { value: on, text: t(`tl.when.${on}`) });
          if (on === 'after' && !v.afterOpts.length) o.disabled = true;
          if (on === w.on) o.selected = true;
          g.append(o);
        }
        s.append(g);
      }
      s.addEventListener('change', () => act.setWhen(fresh(s.value as MotionTrigger, v)));
      items.push(h('span', { class: `tl-pick tl-starts${AI_TRIGGERS.includes(w.on) ? ' ai' : ''}` }, s, icon('chevronDown')));
      items.push(...whenField(w, v));
      // Stops ▾: never / after N rounds / a cue; then: stay or go back.
      const u = v.until;
      const kind = u?.times ? 'times' : u?.cue ? 'cue' : 'never';
      items.push(h('span', { class: 'tl-lbl tl-lbl-stops', text: t('tl.stops') }));
      items.push(select('tl-stops', t('tl.stops'), [['never', t('tl.until.never')], ['times', t('tl.until.times')], ['cue', t('tl.until.cue')]], kind, (k) =>
        act.setUntil(k === 'never' ? null : k === 'times' ? { times: 3, ...(u?.then ? { then: u.then } : {}) } : { cue: v.cueNames[0] ?? cueSlug(`${c.name}-stop`), ...(u?.then ? { then: u.then } : {}) })));
      if (u?.times) items.push(field('tl-times', t('tl.until.timesTip'), String(u.times), '3em', (x) => {
        const n = Math.round(parseFloat(x));
        if (n >= 1) act.setUntil({ ...u, times: Math.min(1000, n) });
        else render();
      }, 'decimal'), h('span', { class: 'tl-of', text: t('tl.until.timesUnit') }));
      if (u?.cue) items.push(cueMenu('tl-until-cue', t('tl.until.cue'), u.cue, v.cueNames, (n) => act.setUntil({ ...u, cue: n })));
      if (u) items.push(select('tl-then', t('tl.then'), [['stay', t('tl.then.stay')], ['reset', t('tl.then.reset')]], u.then ?? 'stay', (x) => act.setUntil({ ...u, then: x === 'reset' ? 'reset' : undefined })));
    } else items.push(h('span', { class: 'tl-lbl', text: t('tl.when.none') }));
    // Try: one ▶ per cue in the scene (Unity's Animator: the Parameters' Trigger buttons).
    items.push(h('span', { class: 'tl-gap' }));
    const tries = h('span', { class: 'tl-tries', dataset: { part: 'tl-tries' } }, h('span', { class: 'tl-lbl', text: t('tl.try') }));
    for (const q of v.cues) {
      tries.append(h('button', { type: 'button', class: `tl-cue${q.on ? ' on' : ''}${q.ai ? ' ai' : ''}`, title: t(q.ai ? 'tl.try.aiTip' : 'tl.try.tip', { name: q.label }), dataset: { cue: q.id, part: 'tl-cue' },
        onclick: () => act.tryCue(q.id) }, h('i', { 'aria-hidden': 'true' }, icon('play')), h('span', { text: q.label })));
    }
    if (v.trying) tries.append(h('button', { type: 'button', class: 'tl-cue stop', title: t('tl.try.stop'), dataset: { part: 'tl-try-stop' }, onclick: () => act.tryStop() }, h('i', { 'aria-hidden': 'true' }, icon('pause')), h('span', { text: t('tl.try.stop') })));
    items.push(tries);
    whenRow.replaceChildren(...items);
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
  function whenField(w: MotionWhen, v: TimelineView): Node[] {
    if (w.on === 'time') return [field('tl-after', t('tl.when.afterTip'), String(w.after), '3em', (x) => {
      const n = parseFloat(x.replace(',', '.'));
      if (n >= 0) act.setWhen({ on: 'time', after: Math.min(600, Math.round(n * 1000) / 1000) });
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
          act.setWhen({ on: 'key', key: e.code });
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
        act.setWhen({ on: 'after', use: use!, ...(key && key !== v.focus ? { key } : {}) });
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
        act.setWhen({ ...w, area: { ...w.area, size: sz } });
      })];
    }
    if (w.on === 'cue') return [cueMenu('tl-cue-name', t('tl.when.cue'), w.cue, v.cueNames, (n) => act.setWhen({ on: 'cue', cue: n }))];
    if (w.on === 'say') {
      const f = field('tl-when', t('tl.when'), w.say ?? '', '200px', (x) => act.setWhen(x.trim() ? { on: 'say', say: x.trim().slice(0, 200) } : { on: 'say' }));
      f.classList.add('tl-when');
      f.placeholder = t('tl.when');
      return [f];
    }
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
    let y = 0;
    for (const r of v.rows) {
      const chs = CHANNELS.filter((ch) => r.clip?.keys[ch]?.length);
      const name = h('div', { class: `tl-name${r.picked ? ' picked' : ''}`, style: `height:${ROW}px`, dataset: { row: r.key } },
        h('button', { type: 'button', class: `tl-twist${r.open ? ' open' : ''}`, 'aria-expanded': String(r.open), title: t('tl.expand'), 'aria-label': t('tl.expand'), onclick: () => act.openRow(r.key) }, icon('chevronRight')),
        h('button', { type: 'button', class: 'tl-obj', text: r.label, onclick: () => act.pickRow(r.key) }),
        r.clip ? h('span', { class: 'tl-clipname', text: r.clip.name }) : null,
        (() => {
          const rw = v.rowWhen(r.key);
          if (!rw || v.narrow) return null;
          const ai = AI_TRIGGERS.includes(rw.when.on);
          return h('span', { class: `tl-whenchip${ai ? ' ai' : ''}`, dataset: { part: 'tl-whenchip' }, text: whenShort(t, rw.when, rw.until, rw.repeat) });
        })());
      names.append(name);
      const lane = h('div', { class: `tl-lane${r.picked ? ' picked' : ''}`, style: `top:${y}px;height:${ROW}px`, dataset: { lane: r.key } });
      lanes.append(lane);
      laneList.push({ key: r.key, ch: null, y });
      drawKeys(lane, r, null, keyTimes(r.clip), v);
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
    lanes.style.height = `${y}px`;
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
    el.classList.toggle('rec', v.auto);
    el.classList.toggle('narrow', v.narrow);
    renderHead(v);
    renderRows(v);
    renderRuler(v);
    place(v);
  }

  // The track's width changes with the window: the keys' places come from it.
  new ResizeObserver(() => el.isConnected && !el.hidden && render()).observe(track);

  return { el, render, place };
}
