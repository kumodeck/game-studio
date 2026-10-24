// The timeline plate (studio-timeline, 2026-10-22; CONTRACT.md §1.9): what is drawn and
// what a press on it means. No state of its own beyond a drag in progress: timeline-wire.ts owns the state and gives
// a fresh `view()` each render; every press goes back as one call on `act`.
//
//   ▶ Preview  Repeat [Once ▾] · When does it move? [When game starts ▾] ▷  ✦ Turn into a rule   [Fine-tune] ✦ Ask AI ▾ ⌄
//   ✓ gate’s motion is made · Save puts it in the game · ✦ Turn it into a rule to adjust it with numbers  ← once made
//   2 selected   Pace [Smooth (slow start & stop) ▾]   Path [Smooth curve ▾]   🗑 Delete   ← only while keys are picked
//        0s    1s    2s    3s    4s                     ← the ruler: press / drag = the time (scrub)
//   ⠿ ▾ rowboat · Row   ◇─────────◇──────◇          +  ← one row per object (its keys at any property); ⠿ = drag the
//   ⠿ ▾ buoy            ◇──────◇                     ×    row (a scene's rows keep the person's order); + links an object
//       Position ◆─────────◆──────◆                     ← ▾ opens position / angle / size
//
// The line (studio-motion-line, 2026-10-23; a review of 10/22 "cluttered, hard to follow", 10/23 "none of it makes sense"):
// ▶ to watch it, "Repeat [Once ▾]" and "When does it move? [▾]". It was one sentence, "gate moves [Once ▾] in [4 s ▾]",
// until studio-no-sentence (2026-10-24, a hands-on try: "I can't make sense of it"; the seconds were also on the ruler, "which
// one is right?"): the length is now the last point's place on the ruler, and nowhere else. The timeline (ruler, rows, points) stays under it, always (the review of 10/23: "with a motion, the timeline
// should be out, not hidden away"). Everything else that ⋯ held — ● Rec motion, Loop & End, Trigger, Try, the motion's
// menu, Moving objects, + Link an object — is "Fine-tune": a sheet in the plate, left of the rows (one place, not a
// popover over the game), remembered open once opened (timeline-wire.ts FINE_SEEN). The ⋯ door is gone.
//
// Before that (studio-ui-lead, 2026-10-23; a hands-on try of v0.1.26 at 1800 px: "not one thing on it is readable"): what a
// hand needs every time — ▶, the time, ● Auto key, when it moves, ⋯, ✦, ⌄ — and nothing that is sometimes. The motion's
// name is in the row at the left and its menu (switch, rename, make, take off) is in ⋯; "✓ attached" is gone (the row
// and the card say the name; the ringed "When" is the next step); the picked keys' menus are a row of their own under
// the line, named for what they are ("Keys picked · 2 — To the next key …"; "Point" / "Keys" read as nothing). Nothing
// on the line shrinks or ends in "…": the line wraps to the narrow order instead (render() measures it).
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
import { CHANNELS, keyName, keyTimes, sameT, type KeyRef } from './timeline-model.ts';
import { knobEl } from './knob.ts';
import type { RuleKnob } from './rule-motion.ts';

/** Starts menu, in two groups: what the loader plays by itself, then what your AI connects in the game's code. */
export const SELF_TRIGGERS: MotionTrigger[] = ['start', 'time', 'key', 'click', 'after', 'enter'];
export const AI_TRIGGERS: MotionTrigger[] = ['touch', 'cue', 'say'];
/**
 * The "When" menu's order (startsMenu): one group, "Trigger" (studio-no-presets, 2026-10-23: the words asked of Gemini;
 * a design look: six under one heading read at a glance, and "More" was
 * one press more with no count behind "the three most used"), most used first; then "Ask AI to Set Up".
 * (studio-tool-clear had three up front and three under "More".)
 */
export const WHEN_TRIGGERS: MotionTrigger[] = ['start', 'click', 'enter', 'key', 'time', 'after'];
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
  // fix-0141 (H4, 2026-10-24): "Custom" with no words yet is not something the AI was asked — "✦ Ask Claude" (short.say)
  // read as a request nobody made. The same word as the Starts menu (tl.when.sayNow); with words it stays the AI's.
  if (w.on === 'say' && !w.say) return `${t('tl.when.sayNow')}${stop}`;
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
  /**
   * studio-code-knobs (2026-10-24): its clip is a rule motion — drawn as a violet strip one round wide ("Rule motion:
   * Spiral · Radius 2 m · Lap 4 s"), not keys. `off` = disabled (grey, dashed), `missing` = the game has no such rule.
   */
  rule?: { words: string; off: boolean; missing: boolean; round: number | null; len: number;
    /**
     * studio-code-torule (2026-10-24, ✦ Turn into a rule): the motion of points the AI replaced with this rule, until Save —
     * `was` = its points' times (small orange marks on the strip's lower edge: the hand's, to compare), `lit` = the strip
     * glows violet (what the AI just changed, as its other changes do).
     */
    was?: number[]; lit?: boolean } | null;
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
  /** studio-motion-flow: the focused clip's motion was just attached (the "When does it move?" menu is ringed: the next step), else null. */
  attached: string | null;
  /** studio-tool-clear: the focused object's first motion was just made by moving it — its last key's time (s), else null. */
  made?: number | null;
  /**
   * studio-no-presets: "Make a motion" on the focused object — 'drag' = waiting for the first move (the line: "drag it
   * where it should move, Esc to cancel"), 'more' = made, each next move adds a second ("Done" ends it); else null.
   */
  making?: 'drag' | 'more' | null;
  /** studio-motion-line: "Fine-tune" is open (its sheet beside the rows; remembered). Absent = closed. */
  fine?: boolean;
  /** studio-fix-0143 (⑨ B): folded to the line only — no rows, no Fine-tune sheet (Fine-tune brings them back). */
  slim?: boolean;
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
  /**
   * studio-code-knobs (2026-10-24): the focused clip is a rule motion — its knobs go on the line where "Repeat [Once ▾]"
   * is for a motion of points (a rule goes on; it has no "once"). `loading` = the game page has not said its knobs yet.
   */
  rule?: { knobs: RuleKnob[]; off: boolean; missing: boolean; loading: boolean; pointsTip: string;
    /**
     * studio-code-torule: the focused rule replaced a motion of points (until Save) — the line's right end has the switch
     * "Compare with original" and, on, "Max deviation 0.1 m (1.2 s)" (`gap`: the editor's measure; null = not measured).
     */
    compare?: { on: boolean; gap: string | null; at: string | null } | null } | null;
  /**
   * studio-motion-next (2026-10-24; a hands-on review: "✦ Turn into a rule is inside the row's ⋯ /
   * right-click — I can't find it"): the focused motion of points can be turned into a rule — the line has "✦ Turn into a
   * rule" beside Preview / Repeat / When. false: a rule motion already, under two points, no AI here.
   */
  canRule?: boolean;
  /**
   * The next step, once a motion is made (studio-motion-next; ● Rec motion turned off, or Done after making): one line
   * under the line — "✓ gate’s motion is made · Save puts it in the game · ✦ Turn it into a rule…". `name` = the motion's
   * name on screen. null = not now (Save, another object, making again, ✦ pressed).
   */
  next?: { name: string } | null;
}

export interface TimelineActs {
  play(on: boolean): void;
  scrub(t: number, end: boolean): void;
  auto(on: boolean): void;
  fold(): void;
  /** studio-no-presets: making ends ("Done" on the line; Esc does the same). Absent = no button. */
  done?(): void;
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
  /** studio-ui-lead: the picked keys' "Delete" button (a phone has no Delete key). Absent = no button. */
  deleteKeys?(): void;
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
  /** studio-motion-line: "Fine-tune" opened / closed (the wire remembers it). Absent = the sheet never opens. */
  fine?(on: boolean): void;
  /** The motion takes `s` seconds, its points scaled (studio-motion-line's "[1 s ▾]"; no button since studio-no-sentence — the last point sets the length). */
  stretch?(seconds: number): void;
  /** studio-timeline-2: the picked path points made smooth / corners (Point ▾). */
  point?(kind: PointKind): void;
  /** studio-motion-focus: an object linked to the focused motion (the list, or a click in the game), a linked row's ×. */
  link?(key: string): void;
  /**
   * studio-ui-lead2 (2026-10-23): a scene's row dragged by its grip (or ↑ / ↓ on the grip) to index `to` among the
   * other rows of the scene. The order is the scene's, saved with it. Absent = no grips.
   */
  reorder?(key: string, to: number): void;
  /** The list opened / closed: while it is open a click on an object in the game links it. */
  linking?(on: boolean): void;
  /** studio-code-knobs: a rule motion's knob on the line turned (live, then `end`: one undo step). */
  ruleKnob?(name: string, v: number, end: boolean): void;
  /** A rule motion's switch on `key`'s strip: disabled (it stays on the object and does not play) / enabled. */
  ruleOff?(key: string, off: boolean): void;
  /** "Convert to coordinates" on `key`'s strip: the rule's shape becomes a motion of points (one undo step). */
  rulePoints?(key: string): void;
  /** studio-code-torule: the line's "Compare with original" switched (the orange marks shown / hidden; nothing saved). */
  compare?(on: boolean): void;
  leave?(key: string): void;
  /** ⋯'s "Show every motion in the scene" on / off (the rows' "Show only the picked one" turns it off). */
  showAll?(on: boolean): void;
  /**
   * studio-motion-panel: ✦ Ask AI on the focused clip — the chat box below gets the "object · motion" chip and the cursor.
   * Absent = no AI here (the web demo): no button.
   */
  ask?(): void;
  /**
   * studio-motion-next: ✦ Ask AI opens a menu by what is asked — "Turn this motion into a rule / Make a new motion for me /
   * Ask anything" (`at` = the button, the menu goes under it). Absent = the button asks at once (`ask`).
   */
  askMenu?(at: HTMLElement): void;
  /** studio-motion-next: the line's "✦ Turn into a rule" (and the next-step line's): the card menu's ✦ Turn into a rule…. */
  toRule?(): void;
  t(key: string, vars?: Record<string, string | number>): string;
}

/** A row's height: 28 px (a mouse), 36 on a phone (shell.css --tl-row; read so the rows and the lanes agree). */
const ROW_PX = 28;

export function createTimelinePanel(view: () => TimelineView, act: TimelineActs) {
  const t = act.t;
  // One line (studio-motion-panel, 2026-10-22; it was three: the head, then "Starts … Stops …", then "Try ▶ ▶"):
  //   ▶ 0:01.6 / 4.0 s  ● Auto key  [Hop ▾]  Starts [Key ▾] [E] ▷  ·····  [Keys ▾]  ⋯  ✦ Ask AI  ⌄
  // what a hand needs every time; the sometimes ones were in ⋯ (now Fine-tune, studio-motion-line), the keys' ease only while keys are picked.
  const head = h('div', { class: 'tl-head', dataset: { part: 'tl-head' } });
  // "Fine-tune" (studio-motion-line): the rows ⋯ had, as a sheet in the plate (left of the rows; above them when narrow).
  const fineEl = h('div', { class: 'tl-fine', role: 'group', 'aria-label': t('tl.more'), hidden: true, dataset: { part: 'tl-fine' } });
  // studio-motion-focus: "+ Link an object"'s list, the same popover as ⋯ with its left edge on the button.
  const linkPop = createMorePop(() => el.closest<HTMLElement>('.shell') ?? document.body, t('tl.link'), () => act.linking?.(false), { left: true, width: 300, part: 'tl-link-pop' });
  // studio-ui-lead: the picked keys' row (under the line, only while keys are picked: what the pick is, where it is made).
  const selRow = h('div', { class: 'tl-sel', hidden: true, dataset: { part: 'tl-sel' } });
  const ruler = h('div', { class: 'tl-ruler', role: 'slider', 'aria-valuemin': '0', dataset: { part: 'tl-ruler' } });
  const names = h('div', { class: 'tl-names' });
  // The names column's head (over the rows, beside the ruler): "Linked · 3" when a scene is open — above the rows it names.
  const rulerPad = h('div', { class: 'tl-ruler-pad' });
  const lanes = h('div', { class: 'tl-lanes', dataset: { part: 'tl-lanes' } });
  const playhead = h('div', { class: 'tl-playhead', dataset: { part: 'tl-playhead' } }, h('span', { class: 'tl-cap' }));
  const boxEl = h('div', { class: 'tl-box', hidden: true });
  const track = h('div', { class: 'tl-track' }, ruler, lanes, playhead, boxEl);
  const body = h('div', { class: 'tl-body' }, h('div', { class: 'tl-names-col' }, rulerPad, names), track);
  // (studio-motion-flow's first-time three steps, .tl-coach, are gone — studio-motion-line: the line says the next step.)
  const main = h('div', { class: 'tl-main' }, fineEl, h('div', { class: 'tl-right' }, selRow, body));
  // studio-motion-next: the next step once a motion is made, under the line (full width: the line has no room for it, and
  // it stays when the plate is folded to the line — slim — since it is what to do now).
  const nextEl = h('div', { class: 'tl-next', role: 'status', hidden: true, dataset: { part: 'tl-next' } });
  const el = h('section', { class: 'timeline', tabindex: '-1', 'aria-label': t('tl.title'), dataset: { part: 'timeline' } }, head, nextEl, main);
  // The narrow order is on (a phone, the side window, or a plate too narrow for the line: render() measures).
  let tightNow = false;

  // Seconds ↔ px on the track (its own box: the names column is outside it).
  const pad = 12;
  // The ruler shows a little room past the longest motion (studio-no-sentence, 2026-10-24): the last point sets the
  // length now (the line's "[4 s ▾]" is gone), and a last point on the ruler's very end had nowhere to be dragged to —
  // a try: 1 s → 1.05 s. A quarter more, at least half a second (1 s → a 1.5 s ruler, 4 s → 5 s); the room is shaded
  // (.tl-after) as before, and the red line still stops at the motion's end (the wire's span).
  const span = () => {
    const s = Math.max(1, view().span);
    return s + Math.ceil(Math.max(0.5, s * 0.25) * 2) / 2;
  };
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
    const items: Node[] = [];
    // ▶ Preview (the words' table: "▶ Preview", apart from Play the game) — with a motion to watch.
    if (c) items.push(h('button', { type: 'button', class: `tl-play${v.playing ? ' on' : ''}`, dataset: { action: 'tl-play', part: 'tl-play' }, 'aria-pressed': String(v.playing),
      // aria-label: narrow, the word is hidden (shell.css) and the icon alone stays.
      title: `${t(v.playing ? 'tl.pause' : 'tl.play')}  Space`, 'aria-label': t(v.playing ? 'tl.pause' : 'tl.play'), onclick: () => act.play(!v.playing) }, icon(v.playing ? 'pause' : 'play'), h('span', { class: 'tl-play-w', 'aria-hidden': 'true', text: t(v.playing ? 'tl.pause' : 'tl.play') })));
    // (The time readout "0:01.6 / 4.0 s" and ● Rec motion were on the line: the time is the red line's cap on the ruler,
    // the length is where the last point stands on the ruler (studio-no-sentence: seconds in one place only), and
    // ● Rec motion is in Fine-tune — making a motion turns it on by itself.)
    items.push(...whenItems(v));
    // ✦ Turn into a rule (studio-motion-next): in the same row as Preview / Repeat / When — it was only in the row's ⋯ and
    // right-click, where a hands-on review did not find it. Not while making (the line is the step then) nor for a rule motion.
    if (c && v.canRule && act.toRule && v.making !== 'more') items.push(h('button', { type: 'button', class: 'tl-rule-btn', title: t('tl.ruleTip'),
      dataset: { action: 'tl-to-rule', part: 'tl-to-rule' }, onclick: () => act.toRule!() }, icon('spark'), h('span', { class: 'tl-rule-w', text: t('toRule.place') })));
    items.push(h('span', { class: 'tl-gap' }));
    // ✦ Turn into a rule (studio-code-torule): the comparison with the points it replaced, at the line's right end.
    if (c && v.rule?.compare) items.push(compareItem(v.rule.compare));
    // Fine-tune: also with no motion here when others move (its "Moving objects", studio-motion-focus).
    // Folded to the line (studio-fix-0143 ⑨ B): it is also the way back to the rows, so it is there, pointing up.
    if (c || v.moving || v.slim) {
      const on = !!v.fine && !v.slim;
      items.push(h('button', { type: 'button', class: `tl-fine-btn${on ? ' on' : ''}`, title: t('tl.moreTip'), 'aria-expanded': String(on),
        dataset: { action: 'tl-fine', part: 'tl-fine-btn' }, onclick: () => act.fine?.(!on) }, h('span', { class: 'tl-fine-w', text: t('tl.more') }), icon(on ? 'chevronDown' : 'chevronUp')));
    }
    if (c) {
      // ✦ Ask AI (a review of 2026-10-22: "a press puts the motion's and the object's names in the AI chat box, and you talk there"):
      // the chat box below gets the "object · motion" chip and the cursor; the words are the person's, nothing is sent yet.
      // studio-motion-next (a hands-on review, 10/24: "✦ Ask Claude" read as "make my motion a rule" too): a menu by what is asked —
      // Turn this motion into a rule / Make a new motion for me / Ask anything; each only puts a draft in the box.
      const menu = !!act.askMenu;
      if (act.ask) items.push(h('button', { type: 'button', class: 'tl-ask', title: menu ? t('tl.askMenuTip') : t('tl.askTip', { name: `${v.rows.find((r) => r.key === v.focus)?.label ?? v.focus} · ${c.name}` }),
        ...(menu ? { 'aria-haspopup': 'menu' } : {}),
        // Narrow (studio-ui-lead2): "✦ AI" — a phone's light screen showed a pale square with nothing readable in it.
        dataset: { action: 'tl-ask', part: 'tl-ask' }, onclick: (e: Event) => (menu ? act.askMenu!(e.currentTarget as HTMLElement) : act.ask!()) },
        icon('spark'), h('span', { class: 'tl-ask-w', text: t('tl.ask') }), h('span', { class: 'tl-ask-s', 'aria-hidden': 'true', text: t('tl.askShort') }), ...(menu ? [icon('chevronDown')] : [])));
    }
    items.push(h('button', { type: 'button', class: 'icon-btn tl-fold', dataset: { action: 'tl-fold' }, title: t('tl.fold'), 'aria-label': t('tl.fold'), onclick: () => (linkPop.hide(), act.fold()) }, icon('chevronDown')));
    // Narrow: the end of the first row (▶ and Repeat); the "when", Fine-tune, ✦ and ⌄ start a new one (shell.css).
    items.push(h('span', { class: 'tl-break', 'aria-hidden': 'true' }));
    head.replaceChildren(...items);
  }

  /**
   * The line's repeat (studio-no-sentence, 2026-10-24): "Repeat [Once ▾]" — the heading word always before the menu.
   * It was a sentence (studio-motion-line, v0.1.37): "gate moves [Once ▾] in [4 s ▾]" (the Japanese: name, length, repeat).
   * A hands-on try: "I can't make sense of it — loop and back and forth I get", "'Once' out of nowhere means nothing", and "the
   * timeline writes seconds, and here it writes seconds too: which one is right?" So: the menu says what it chooses
   * ("Repeat"), and the length is on the ruler only — the last point sets it (timeline-model.ts moveKeys); no seconds
   * here or in Fine-tune.
   */
  // One piece, the word and its menu together: narrow, the head hides its other labels ("When does it move?") — this
  // one stays, so "Once" never shows up on its own.
  function repeatItems(c: MotionClip): Node[] {
    return [h('span', { class: 'tl-rep', dataset: { part: 'tl-rep' } },
      h('span', { class: 'tl-rep-lbl', text: t('tl.repeat') }),
      select('tl-repeat-line', t('tl.repeat'), (['once', 'loop', 'pingpong'] as MotionRepeat[]).map((r) => [r, t(`tl.repeat.${r}`)]), c.repeat ?? 'once', (r) => act.repeat(r as MotionRepeat)))];
  }

  /**
   * A rule motion's knobs on the line (studio-code-knobs; shell/knob.ts — the same part as the card's Layout): "Radius
   * [2 m]  Lap [4 s]". The game page not there yet: nothing (the strip has its name); no such rule: the one line why.
   */
  function ruleItems(r: NonNullable<TimelineView['rule']>): Node[] {
    if (r.loading) return [];
    if (r.missing) return [h('span', { class: 'tl-lbl tl-rule-missing', title: t('rule.missingTip', { name: view().clip?.use ?? view().clip?.name ?? '' }), dataset: { part: 'tl-rule-missing' }, text: t('rule.missing') })];
    return [h('span', { class: 'tl-knobs', dataset: { part: 'tl-knobs' } }, ...r.knobs.map((k) => knobEl({ label: k.label, unit: k.unit ? t(`hands.unit.${k.unit}`) : '', v: k.v, min: k.min, max: k.max, step: k.step,
      tip: t('rule.knobTip'), part: `tl-knob-${k.name}`, set: (v, end) => act.ruleKnob?.(k.name, v, end) })))];
  }

  /**
   * "◉ Compare with original · Max deviation 0.1 m (1.2 s)" (studio-code-torule, 2026-10-24; the plan's picture
   * n3-motion: "the line's right: Compare with original · the largest gap"): the switch shows / hides the orange marks
   * (the strip's lower edge, the game's path); the number is the editor's own measure of the rule against the points.
   * Gone on Save (the AI takes the points out of the code then).
   */
  // Short of room (the line's 'snug' step, a narrow plate), the switch's words and the time go to its tooltip: the line
  // keeps "◉ Max deviation 0.1 m" — measured, not cut to "…" — instead of tipping the whole line into two rows (it did:
  // the first pictures of 10/24 lost "Preview" and "When does it move?" to it).
  function compareItem(cmp: { on: boolean; gap: string | null; at: string | null }): HTMLElement {
    const all = [t('toRule.compareMotion'), [cmp.gap, cmp.at].filter(Boolean).join('')].filter(Boolean).join(' · ');
    const sw = h('button', { type: 'button', class: 'tl-rule-sw cmp-sw', role: 'switch', 'aria-checked': String(cmp.on), title: `${all}\n${t('toRule.compareTip')}`,
      'aria-label': t('toRule.compareMotion'), dataset: { part: 'tl-compare-sw' }, onclick: () => act.compare?.(!cmp.on) }, h('i', {}));
    // The words press the switch too (a finger on a phone finds the line, not a 22 px switch).
    return h('span', { class: 'tl-compare', title: all, dataset: { part: 'tl-compare' }, onclick: (e: Event) => !sw.contains(e.target as Node) && act.compare?.(!cmp.on) }, sw,
      h('span', { class: 'tl-compare-w', text: `${t('toRule.compareMotion')}${cmp.gap ? ' ·' : ''}` }),
      cmp.gap ? h('span', { class: 'tl-compare-gap', dataset: { part: 'tl-compare-gap' }, text: cmp.gap }) : null,
      cmp.gap && cmp.at ? h('span', { class: 'tl-compare-t', text: cmp.at }) : null);
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

  /** Every way the focused clip starts, with one changed (`x`) or taken out (null): the whole list goes back (setWhen). */
  const sendWhen = (v: TimelineView, i: number, x: MotionWhen | null) => {
    const list = (v.whens?.length ? v.whens : [v.when!]).slice();
    if (x) list[i] = x;
    else list.splice(i, 1);
    act.setWhen(list.length > 1 ? list : list[0]!);
  };
  /**
   * The "When" menu: sentences — "Trigger" (six ways the editor plays by itself), then "Ask AI to Set Up" (studio-no-presets,
   * 2026-10-23, Gemini's words; studio-tool-clear had three up front, three under "More", one "Ask AI"). Before: ten rows in two groups named "Plays by itself" and "✦ Your AI connects it", with "A cue" —
   * a hands-on try: "none of it makes sense". What only the AI can wire (the player touching it, a moment in the game's own
   * code) is one row, "Ask AI: make it move when…", which puts the words in the chat box; a file that already has one of
   * those shows it as it is ("set up by your AI"), so the menu never reads blank. `groups` = false: one flat list (⋯'s
   * other ways, where the optgroups would only be noise).
   */
  const startsMenu = (part: string, label: string, w: MotionWhen, v: TimelineView, i: number, groups: boolean) => {
    const s = h('select', { 'aria-label': label, title: w.on === 'say' && w.say ? `${label}: ${w.say}` : label, dataset: { part, ...(i ? { i: String(i) } : {}) } });
    const add = (g: HTMLElement, on: MotionTrigger, text = t(`tl.when.${on}`)) => {
      const o = h('option', { value: on, text });
      if (on === 'after' && !v.afterOpts.length) o.disabled = true;
      if (on === w.on) o.selected = true;
      g.append(o);
    };
    const self = groups ? h('optgroup', { label: t('tl.when.selfHead') }) : s;
    // "After another motion ends" only when there is another motion to follow (or it is the one chosen): a row that
    // could only be greyed out is a row to read for nothing (the design look of 10/23).
    for (const on of WHEN_TRIGGERS) if (on !== 'after' || v.afterOpts.length || w.on === 'after') add(self, on);
    const ai = groups ? h('optgroup', { label: t('tl.when.aiHead') }) : s;
    if (w.on === 'touch' || w.on === 'cue') add(ai, w.on, t(`tl.when.${w.on}Now`));
    add(ai, 'say', t(w.on === 'say' ? 'tl.when.sayNow' : 'tl.when.say'));
    if (self !== s) s.append(self);
    if (ai !== s) s.append(ai);
    s.addEventListener('change', () => {
      const on = s.value as MotionTrigger;
      sendWhen(v, i, fresh(on, v));
      // "In the chat…" (studio-motion-panel): the words are said in the chat box, with this motion's chip — not in a
      // second field here (the strip had "Starts [In my words…] [When? (for your AI)]": two ways in for one thing).
      if (on === 'say') act.ask?.();
    });
    return h('span', { class: `tl-pick tl-starts${AI_TRIGGERS.includes(w.on) ? ' ai' : ''}${!i && (v.attached || (v.made && !v.making)) ? ' ask' : ''}` }, s, icon('chevronDown'));
  };

  /** The line's "when": Starts ▾ [its field] (+1) ▷ — or, with no motion, what makes one. */
  function whenItems(v: TimelineView): Node[] {
    const c = v.clip;
    const w = v.when;
    if (c && w) {
      const items: Node[] = [];
      // Making (studio-no-presets): the line is the step — "✓ Moves 0–1 s. Keep moving to add a second." and "Done" —
      // and nothing else: the "when" comes after Done (studio-ui-lead: one thing at a time on one line; before, the
      // sentence, "When does it move?", the menu and Done shared it, and every one of them was cut).
      if (v.making === 'more') {
        const said = `✓ ${t('tl.made.more', { t: Math.round((v.made ?? 0) * 10) / 10 })}`;
        items.push(h('span', { class: 'tl-lbl tl-first tl-made', dataset: { part: 'tl-made' }, text: said }));
        if (act.done) items.push(h('button', { type: 'button', class: 'tl-done', dataset: { part: 'tl-done', action: 'tl-done' }, title: t('tl.make.doneTip'), onclick: () => act.done!() }, t('tl.make.done')));
        return items;
      }
      // "When does it move?" always (the brief: the one label on the line that reads as is); just attached or just
      // made (Done pressed), the menu is ringed — the next step — with no "✓ attached" chip before it (studio-ui-lead:
      // the row and the card say the name; "attached" was a maker's word, the ux review of 10/23).
      // How it repeats first ("Repeat [Once ▾]", studio-no-sentence; it was studio-motion-line's sentence) — then when.
      // A rule motion (studio-code-knobs): its knobs here — it goes on as the game runs, so "Repeat [Once ▾]" would be wrong.
      items.push(...(v.rule ? ruleItems(v.rule) : repeatItems(c)), h('span', { class: 'tl-sep', 'aria-hidden': 'true', text: '·' }));
      items.push(h('span', { class: 'tl-lbl tl-when-lbl', text: t('tl.whenAsk') }));
      items.push(startsMenu('tl-starts', t('tl.starts'), w, v, 0, true), ...whenField(w, v, (x) => sendWhen(v, 0, x)));
      // The other ways it starts (studio-timeline-2's "or") live in Fine-tune; the line says there are some ("+1").
      const others = (v.whens?.length ?? 1) - 1;
      if (others > 0) items.push(h('button', { type: 'button', class: 'tl-or-more', title: t('tl.when.orMoreTip'), dataset: { part: 'tl-or-more' },
        onclick: () => (v.fine ? fineEl.querySelector<HTMLElement>('[data-part=tl-more-or] select, [data-part=tl-more-or] button')?.focus() : act.fine?.(true)) }, t('tl.when.orMore', { n: others })));
      // ▷ Try this one (the brief of 2026-10-22: "Try belongs with 'when'"): as if its start just happened. Every cue is in Fine-tune.
      const mine = v.cues.find((q) => q.id === v.tryId);
      if (v.trying) items.push(h('button', { type: 'button', class: 'icon-btn tl-try-this on', title: t('tl.try.stop'), 'aria-label': t('tl.try.stop'), dataset: { part: 'tl-try-this' }, onclick: () => act.tryStop() }, icon('pause')));
      else if (mine) items.push(h('button', { type: 'button', class: `icon-btn tl-try-this${mine.ai ? ' ai' : ''}`, title: t(mine.ai ? 'tl.try.aiTip' : 'tl.try.tip', { name: mine.label }),
        'aria-label': t('tl.try.tip', { name: mine.label }), dataset: { part: 'tl-try-this', cue: mine.id }, onclick: () => act.tryCue(mine.id) }, icon('play')));
      return items;
    }
    if (v.focus) {
      // An object with no motion yet (studio-motion-flow: "+ New motion" lands here): what makes one, in one line.
      const name = v.rows.find((r) => r.key === v.focus)?.label ?? v.focus;
      // studio-tool-clear: the time line already past 0 s (the strip's "Make a motion for this" opens at 1 s): one move
      // makes the motion — say where it is at 0 s and what to do now.
      const at = Math.round(v.time * 10) / 10;
      // studio-no-presets: "Make a motion" — the words of the brief (the review, 10/23): drag it there; Esc stops.
      const words = v.making === 'drag' ? t('tl.make.drag', { name }) : at > 0 ? t('tl.when.firstAt', { name, t: at }) : t('tl.when.first', { name });
      return [h('span', { class: 'tl-lbl tl-first', dataset: { part: 'tl-first' }, text: words })];
    }
    return [h('span', { class: 'tl-lbl tl-first', text: t('tl.when.none') })];
  }

  /**
   * Fine-tune's rows (studio-motion-line; they were ⋯'s): ● Rec motion, the motion's menu, Loop & End, Trigger (the other
   * ways it starts), Try (every cue), who else uses this motion, and Moving objects (+ Link an object, every motion).
   */
  function renderFine(v: TimelineView) {
    fineEl.hidden = !v.fine || !(v.clip || v.moving);
    if (fineEl.hidden) return void fineEl.replaceChildren();
    const c = v.clip;
    const w = v.when;
    const row = (part: string, label: string, ...kids: Array<Node | null>) =>
      h('div', { class: 'tl-more-row', dataset: { part } }, h('span', { class: 'tl-more-k', text: label }), h('div', { class: 'tl-more-v' }, ...kids));
    // Rows: every motion in the scene (studio-motion-focus, 2026-10-23: the plate shows the picked object only; the
    // whole scene stays one press away, here, where the sometimes-used things are). Last: it is about the plate, not the motion.
    // "Tracks" (studio-ui-lead2: Gemini's word for the row; it was "Rows"): "+ Link an object" in words (the row's "+"
    // opens the same list: pressed from here, the list opens on that "+"), then every motion / only the picked one.
    const allRow = row('tl-more-all', t('tl.all.k'),
      v.link && act.link ? h('button', { type: 'button', class: 'tl-all', dataset: { part: 'tl-more-link' }, title: t('tl.linkTip', { name: v.rows.find((r) => r.key === v.focus)?.label ?? v.focus ?? '' }),
        onclick: (e: Event) => toggleLink(names.querySelector<HTMLElement>('[data-part=tl-link]') ?? (e.currentTarget as HTMLElement)) }, icon('plus'), h('span', { text: t('tl.link') })) : null,
      act.showAll ? h('button', { type: 'button', class: `tl-all${v.all ? ' on' : ''}`, 'aria-pressed': String(!!v.all), dataset: { part: 'tl-all' },
        onclick: () => act.showAll!(!v.all) }, icon('list'), h('span', { text: t(v.all ? 'tl.all.off' : 'tl.all') })) : null);
    // ● Rec motion (studio-motion-line: it was on the line; making a motion turns it on by itself): first, as in the mock.
    const recRow = row('tl-more-rec', t('tl.auto'), h('button', { type: 'button', class: `tl-auto${v.auto ? ' on' : ''}`, dataset: { action: 'tl-auto', part: 'tl-auto' }, 'aria-pressed': String(v.auto),
      title: t(v.auto ? 'tl.autoOn' : 'tl.autoOff'), onclick: () => act.auto(!v.auto) }, h('span', { class: 'tl-dot' }), h('span', { class: 'tl-auto-w', text: t(v.auto ? 'tl.on' : 'tl.off') })));
    // studio-ui-lead: the motion's menu (which motion, + Make a motion, rename, take off) — first: it says
    // what the rows below are about. It was on the line, where it shrank to "Mo…".
    const clipRow = row('tl-more-clip', t('tl.clip'), clipMenu(v));
    if (!c || !w) return void fineEl.replaceChildren(clipRow, allRow);
    const rows: HTMLElement[] = [recRow, clipRow];
    // "Loop & End" (studio-ui-lead2, 2026-10-23; Gemini's words — "it is where loop, back and forth and stop are
    // chosen"): one row for the repeat menu and Stops ▾ (never / after N rounds / a cue) with, once it stops, stay or go
    // back. They were two rows, "Repeat" and "Stops" (a hands-on try read the old "how it stops" heading as nothing).
    // A rule motion (studio-code-knobs) has no repeat of its own (it goes on): only when it stops.
    const loop: Node[] = v.rule ? [] : [select('tl-repeat', t('tl.repeat'), (['once', 'loop', 'pingpong'] as MotionRepeat[]).map((r) => [r, t(`tl.repeat.${r}`)]), c.repeat ?? 'once', (r) => act.repeat(r as MotionRepeat))];
    const u = v.until;
    const kind = u?.times ? 'times' : u?.cue ? 'cue' : 'never';
    // fix-0140 (② of the first-run check, 2026-10-23): "Loop & End [Once] [Never]" read as "once, but it never stops?"
    // to a first-time maker. A motion that plays once already ends by itself, so the Stops menu is only for one that
    // goes on (Loop / Back and forth). An old motion that is Once WITH a stop (rounds or a signal) keeps the menu, so
    // what it has stays visible and can be set back to Never.
    // fix-0141 (D10 of the first-run check, 2026-10-24): "When signaled" (the Japanese says "a signal") is the game's code speaking —
    // a cue only the AI can wire up — and a first-time maker could pick it and get a motion that never stops for a reason
    // they cannot see. It is in the menu only when the motion already stops on a cue (the AI made it so), so what it has
    // stays visible and can be set back to Never / some rounds; otherwise the menu is Never / After some rounds.
    const stops: [string, string][] = [['never', t('tl.until.never')], ['times', t('tl.until.times')], ...(u?.cue ? [['cue', t('tl.until.cue')] as [string, string]] : [])];
    if ((c.repeat ?? 'once') !== 'once' || u || v.rule) loop.push(select('tl-stops', t('tl.stops'), stops, kind, (k) =>
      act.setUntil(k === 'never' ? null : k === 'times' ? { times: 3, ...(u?.then ? { then: u.then } : {}) } : { cue: v.cueNames[0] ?? cueSlug(`${c.name}-stop`), ...(u?.then ? { then: u.then } : {}) })));
    if (u?.times) loop.push(field('tl-times', t('tl.until.timesTip'), String(u.times), '3em', (x) => {
      const n = Math.round(parseFloat(x));
      if (n >= 1) act.setUntil({ ...u, times: Math.min(1000, n) });
      else render();
    }, 'decimal'), h('span', { class: 'tl-of', text: t('tl.until.timesUnit') }));
    if (u?.cue) loop.push(cueMenu('tl-until-cue', t('tl.until.cue'), u.cue, v.cueNames, (n) => act.setUntil({ ...u, cue: n })));
    if (u) loop.push(select('tl-then', t('tl.then'), [['stay', t('tl.then.stay')], ['reset', t('tl.then.reset')]], u.then ?? 'stay', (x) => act.setUntil({ ...u, then: x === 'reset' ? 'reset' : undefined })));
    rows.push(row('tl-more-loop', t('tl.loopEnd'), ...loop));
    // The other ways it starts (studio-timeline-2): each with its field and ×, then "+ Another trigger" (up to 4 in all;
    // fix-0140 ②: it was "+ or", in Japanese a one-letter button a first-time maker could not read).
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
    fineEl.replaceChildren(...rows);
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
    const pick = fineEl.querySelector('.tl-clip-pick');
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
      // studio-ui-lead2: a scene's rows (two or more) carry a grip — the order is the person's, dragged here (or ↑ / ↓
      // on the grip), never changed by a pick (the picked row is lit where it is).
      const drag = !!(v.scene && v.scene.n > 1 && r.member && act.reorder);
      const name = h('div', { class: `tl-name${r.picked ? ' picked' : ''}`, style: `height:${ROW}px`, dataset: { row: r.key, ...(drag ? { drag: '1' } : {}) } },
        drag ? grip(r) : null,
        h('button', { type: 'button', class: `tl-twist${r.open ? ' open' : ''}`, 'aria-expanded': String(r.open), title: t('tl.expand'), 'aria-label': t('tl.expand'), onclick: () => act.openRow(r.key) }, icon('chevronRight')),
        h('button', { type: 'button', class: 'tl-obj', text: r.label, onclick: () => act.pickRow(r.key) }),
        r.clip && !v.scene ? h('span', { class: 'tl-clipname', text: r.clip.name }) : null,
        (() => {
          const rw = v.rowWhen(r.key);
          // In a scene every row starts as one: the head says when, not each row. Only with every motion shown
          // (studio-ui-lead): the plate is the picked object's, whose "when" the line says — the chip cut the name ("gate Back an… ∞ Al…").
          if (!rw || tightNow || v.scene || !v.all) return null;
          const ai = AI_TRIGGERS.includes(rw.when.on);
          return h('span', { class: `tl-whenchip${ai ? ' ai' : ''}`, dataset: { part: 'tl-whenchip' }, text: whensShort(t, rw.whens ?? [rw.when], rw.until, rw.repeat) });
        })(),
        // A linked object can be unlinked (studio-timeline-2's ×; studio-motion-focus: not the row being made — the
        // picked / focused one is what the others are linked to). Shown on hover; on a phone always.
        v.scene && r.member && !r.picked && r.key !== v.focus && act.leave ? h('button', { type: 'button', class: 'icon-btn tl-leave', title: t('tl.scene.leave', { name: r.label, scene: v.scene.name }), 'aria-label': t('tl.scene.leave', { name: r.label, scene: v.scene.name }),
          dataset: { part: 'tl-leave', key: r.key }, onclick: () => act.leave!(r.key) }, icon('close')) : null,
        // The focused row's "+" (studio-ui-lead2): link an object to its motion — it was a row of its own under the
        // rows ("+ Link an object"), which took one of the plate's five rows always. The words are its tooltip and in ⋯.
        // studio-motion-line: only with Fine-tune open (the review of 10/23 keeps "+ Link an object" as a way in, there).
        r.key === v.focus && v.link && act.link && v.fine ? linkBtn(v) : null);
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
    lanes.style.height = `${y}px`;
  }

  /**
   * With every motion shown (allRow, above the rows; studio-motion-focus): what the rows are now, and the way back.
   */
  function allRow(v: TimelineView, y: number): number {
    if (!v.all || !act.showAll) return y;
    names.append(h('div', { class: 'tl-name tl-link-name', style: `height:${ROW}px` },
      h('button', { type: 'button', class: 'tl-link', dataset: { part: 'tl-all-off' }, onclick: () => act.showAll!(false) }, icon('close'), h('span', { text: t('tl.all.off') }))));
    lanes.append(h('div', { class: 'tl-lane tl-link-lane', style: `top:${y}px;height:${ROW}px` }, h('span', { class: 'tl-lane-hint', text: t('tl.all.on') })));
    return y + ROW;
  }
  /**
   * The focused row's "+" (studio-ui-lead2, 2026-10-23): link an object to the motion on the plate. Quiet (the third
   * colour, no fill; lit while its list is open) at the row's right end, where a linked row has its ×. Until now
   * "+ Link an object" was a row of its own under the rows: readable, but one of the plate's five rows, always (the
   * next-five list of studio-ui-lead). The words stay as its tooltip, in ⋯'s "Tracks" row, and as the list's title.
   */
  function linkBtn(v: TimelineView): HTMLElement {
    const on = !!v.link?.linking;
    const name = v.rows.find((r) => r.key === v.focus)?.label ?? v.focus ?? '';
    const btn = h('button', { type: 'button', class: `icon-btn tl-link-add${on ? ' on' : ''}`, 'aria-expanded': String(on), 'aria-haspopup': 'dialog',
      title: t('tl.linkTip', { name }), 'aria-label': t('tl.link'), dataset: { part: 'tl-link' }, onclick: () => toggleLink(btn) }, icon('plus'));
    return btn;
  }
  /** "+" pressed (the row's, or ⋯'s "+ Link an object"): its list over it (the scene's objects), or closed. */
  function toggleLink(btn: HTMLElement) {
    if (linkPop.open) return linkPop.hide();
    const v = view();
    if (!v.link) return;
    linkPop.show(btn);
    const name = v.rows.find((r) => r.key === v.focus)?.label ?? v.focus ?? '';
    // "or click an object in the game" was the link row's lane; it is the list's second line now.
    fillLinkList(linkPop.el, { title: t('tl.link.title', { name }), hint: t('tl.link.hint'), find: t('tl.link.find'), none: t('tl.link.none'), items: v.link.items(), focus: !tightNow, pick: (k) => act.link!(k) });
    act.linking?.(true);
  }

  // ----- the rows' order (studio-ui-lead2, 2026-10-23) -----
  // The request: "while I put together several objects' motions, the one I pick jumps to the top and the order
  // changes every time — I want to set the order myself". A scene's rows carry a grip at the left: a drag (pointer
  // capture on the grip, as the list's draw-order grip in placement-panel.ts) or ↑ / ↓ with the grip focused moves the
  // row; the wire keeps the order in the scene motion (saved with it). An orange line says where the row will land.
  let rowDrag: { key: string; name: HTMLElement; lane: HTMLElement | null; mark: HTMLElement; y0: number; moved: boolean } | null = null;
  const dragRows = () => [...names.querySelectorAll<HTMLElement>('.tl-name[data-drag]')];
  /** Where a drop at `y` lands: the index among the other draggable rows (the dragged one left out). */
  const dropIndex = (y: number, key: string) => {
    const rows = dragRows().filter((r) => r.dataset.row !== key);
    let i = 0;
    for (const r of rows) {
      const b = r.getBoundingClientRect();
      if (y > b.top + b.height / 2) i++;
    }
    return { i, rows };
  };
  const showMark = (y: number) => {
    const d = rowDrag!;
    const { i, rows } = dropIndex(y, d.key);
    if (!rows.length) return;
    const top = i < rows.length ? rows[i]!.getBoundingClientRect().top - 1 : rows[rows.length - 1]!.getBoundingClientRect().bottom - 1;
    d.mark.style.top = `${top - names.getBoundingClientRect().top}px`;
    d.mark.hidden = false;
  };
  function grip(r: TimelineRow): HTMLElement {
    const g = h('button', { type: 'button', class: 'tl-grip', title: t('tl.rowDrag'), 'aria-label': t('tl.rowDrag', { name: r.label }), dataset: { grip: r.key, part: 'tl-grip' } }, icon('grip'));
    g.addEventListener('click', (e) => e.stopPropagation());
    g.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      e.stopPropagation();
      act.touched();
      g.setPointerCapture(e.pointerId);
      const name = g.closest<HTMLElement>('.tl-name')!;
      const mark = h('div', { class: 'tl-drop-mark', hidden: true });
      names.append(mark);
      rowDrag = { key: r.key, name, lane: lanes.querySelector<HTMLElement>(`.tl-lane[data-lane="${CSS.escape(r.key)}"]:not([data-ch])`), mark, y0: e.clientY, moved: false };
    });
    g.addEventListener('pointermove', (e) => {
      if (!rowDrag) return;
      if (!rowDrag.moved && Math.abs(e.clientY - rowDrag.y0) > 4) {
        rowDrag.moved = true;
        rowDrag.name.classList.add('dragging');
        rowDrag.lane?.classList.add('dragging');
      }
      if (rowDrag.moved) showMark(e.clientY);
    });
    const finish = (e: PointerEvent, drop: boolean) => {
      if (!rowDrag) return;
      const d = rowDrag;
      rowDrag = null;
      d.name.classList.remove('dragging');
      d.lane?.classList.remove('dragging');
      d.mark.remove();
      if (!drop || !d.moved) return;
      act.reorder?.(d.key, dropIndex(e.clientY, d.key).i);
    };
    g.addEventListener('pointerup', (e) => finish(e, true));
    g.addEventListener('pointercancel', (e) => finish(e, false));
    // ↑ / ↓ on the grip: one row up or down (the grip keeps the keyboard through the redraw: render()).
    g.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      e.stopPropagation();
      const rows = dragRows();
      const i = rows.findIndex((x) => x.dataset.row === r.key);
      // `to` is the index among the other rows (this one left out): up = i − 1, down = i + 1 (after the next one).
      const to = Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowUp' ? -1 : 1)));
      if (i >= 0 && to !== i) act.reorder?.(r.key, to);
    });
    return g;
  }

  function drawKeys(lane: HTMLElement, r: TimelineRow, ch: MotionChannel | null, times: number[], v: TimelineView) {
    if (r.rule && !ch) return drawRule(lane, r, v);
    if (times.length > 1) lane.append(h('div', { class: 'tl-span', style: `left:${xOf(times[0]!)}px;width:${xOf(times[times.length - 1]!) - xOf(times[0]!)}px` }));
    for (const s of times) {
      const refs = refsAt(r, ch, s);
      const on = refs.length > 0 && refs.every((x) => v.picked(x));
      const label = t('tl.key', { ch: ch ? t(`tl.ch.${ch}`) : r.label, t: s.toFixed(2) });
      lane.append(h('div', { class: `tl-key${ch ? '' : ' sum'}${on ? ' on' : ''}`, style: `left:${xOf(s)}px`, role: 'button', 'aria-pressed': String(on), 'aria-label': label, title: label,
        dataset: { key: r.key, ch: ch ?? '', t: String(s), part: 'tl-key' } }));
    }
  }

  /**
   * A rule motion's strip (studio-code-knobs, 2026-10-24; the plan's first round, decision 6 and its picture one.png):
   * violet, with thin slanted lines (no points: its shape is the game's rule), one round wide and a thin line at every
   * round after it; a switch at its left (Disable / enable), its words from the knobs, and — on the picked row —
   * "Convert to coordinates". Disabled: grey and dashed. The game without that rule: dashed, "No motion rule found".
   */
  function drawRule(lane: HTMLElement, r: TimelineRow, v: TimelineView) {
    const rr = r.rule!;
    const len = rr.len > 0 ? rr.len : 4;
    const total = span();
    const strip = h('div', { class: `tl-rule${rr.off ? ' off' : ''}${rr.missing ? ' missing' : ''}${rr.lit ? ' lit' : ''}`, style: `left:${xOf(0)}px;width:${Math.max(24, xOf(total) - xOf(0))}px`,
      title: rr.missing ? t('rule.missingTip', { name: r.clip?.use ?? r.clip?.name ?? '' }) : t('rule.motionTip'), dataset: { part: 'tl-rule', key: r.key } });
    for (let k = 1; rr.round && k * len < total; k++) strip.append(h('i', { class: 'tl-rule-round', style: `left:${xOf(k * len) - xOf(0)}px` }));
    // ✦ Turn into a rule (studio-code-torule): where the points it replaced were, small orange marks on the lower edge.
    for (const w of rr.was ?? []) if (w <= total) strip.append(h('i', { class: 'tl-rule-was', style: `left:${xOf(w) - xOf(0)}px`, dataset: { part: 'tl-rule-was' } }));
    const sw = h('button', { type: 'button', class: 'tl-rule-sw', role: 'switch', 'aria-checked': String(!rr.off), title: t(rr.off ? 'rule.enableTip' : 'rule.disableTip'),
      'aria-label': t(rr.off ? 'rule.enableTip' : 'rule.disableTip'), dataset: { part: 'tl-rule-sw', ruleAct: '1' }, onclick: () => act.ruleOff?.(r.key, !rr.off) }, h('i', {}));
    const words = rr.missing ? t('rule.missing') : rr.off ? `${t('rule.disabled')} · ${rr.words}` : `${t('rule.motion')}: ${rr.words}`;
    strip.append(sw, h('span', { class: 'tl-rule-w', dataset: { part: 'tl-rule-words' }, text: words }));
    if (r.picked && !rr.missing && act.rulePoints) strip.append(h('button', { type: 'button', class: 'tl-rule-pts', title: v.rule?.pointsTip ?? '', dataset: { part: 'tl-rule-points', ruleAct: '1' },
      onclick: () => act.rulePoints!(r.key) }, t('rule.points')));
    lane.append(strip);
  }

  /** The keys one diamond stands for: one key, or every property's key at that time (an object row's diamond). */
  function refsAt(r: TimelineRow, ch: MotionChannel | null, s: number): KeyRef[] {
    const chs = ch ? [ch] : CHANNELS;
    return chs.filter((c) => r.clip?.keys[c]?.some((k) => sameT(k.t, s))).map((c) => ({ key: r.key, ch: c, t: s }));
  }
  const rowOf = (key: string) => view().rows.find((r) => r.key === key);

  // ----- presses on the track -----
  // `per` (keys): seconds per px when the press began. A drag can change the length (the last point sets it,
  // timeline-model.ts moveKeys) and with it the ruler's scale; measuring the move in the old scale keeps the point
  // from running away under the pointer as the ruler grows or shrinks.
  let drag: { kind: 'scrub' | 'keys' | 'box'; x0: number; y0: number; id: number; moved: boolean; add: boolean; refs?: KeyRef[]; per?: number } | null = null;
  const dtOf = (d: { x0: number; per?: number }, x: number) => (d.per !== undefined ? (x - d.x0) * d.per : tOf(x) - tOf(d.x0));
  track.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A rule motion strip's switch / "Convert to coordinates" (studio-code-knobs): their own press, not a scrub or a box.
    if ((e.target as HTMLElement).closest?.('[data-rule-act]')) return;
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
      drag = { kind: 'keys', x0: x, y0: y, id: e.pointerId, moved: false, add: add && on, refs, per: span() / Math.max(1, track.clientWidth - pad * 2) };
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
    else if (drag.kind === 'keys') act.drag(dtOf(drag, x), false, e.altKey);
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
      if (d.moved) act.drag(cancel ? 0 : dtOf(d, x), true, e.altKey);
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
    ruler.setAttribute('aria-valuenow', v.time.toFixed(2));
    ruler.setAttribute('aria-valuemax', span().toFixed(2));
  }

  function renderRuler(v: TimelineView) {
    ruler.replaceChildren();
    ruler.setAttribute('aria-label', t('tl.ruler'));
    ruler.title = t('tl.ruler');
    const s = span();
    // A tick every second (every half on a wide plate with a short span), labelled on whole seconds.
    const step = s <= 4 && !tightNow ? 0.5 : s <= 12 ? 1 : s <= 40 ? 5 : 10;
    for (let x = 0; x <= s + 1e-6; x += step) {
      const whole = Math.abs(x - Math.round(x)) < 1e-6;
      ruler.append(h('span', { class: `tl-tick${whole ? '' : ' half'}`, style: `left:${xOf(x)}px`, text: whole ? `${Math.round(x)}s` : '' }));
    }
    const c = v.clip;
    // Past the picked clip's end: shaded (drag its last point there and the motion gets longer — timeline-model.ts moveKeys).
    if (c && c.len < s) lanes.append(h('div', { class: 'tl-after', style: `left:${xOf(c.len)}px` }));
  }

  function render() {
    const v = view();
    // A menu of the head that has the keyboard keeps it through a redraw (the head is drawn anew each time): the
    // "When does it move?" focus after an attach (studio-motion-flow) would otherwise be lost to the next pick's echo.
    // …and ⋯'s menus the same (they are drawn anew with the head).
    const inMore = fineEl.contains(document.activeElement);
    const had = document.activeElement instanceof HTMLSelectElement && (el.contains(document.activeElement) || inMore) ? document.activeElement.dataset.part : null;
    // …and a row's grip (studio-ui-lead2): ↑ / ↓ on it redraws the rows; the keyboard stays on the same row's grip.
    const gripHad = document.activeElement instanceof HTMLElement && names.contains(document.activeElement) ? document.activeElement.dataset.grip : undefined;
    el.classList.toggle('rec', v.auto);
    // ⑨ B (studio-fix-0143): only the line — the rows and Fine-tune's sheet are not drawn (shell.css .timeline.slim).
    el.classList.toggle('slim', !!v.slim);
    tightNow = v.narrow;
    el.classList.toggle('narrow', tightNow);
    el.classList.remove('snug');
    renderHead(v);
    // One line when it fits, else the narrow order (▶ · time · ● … ⋯ ✦ ⌄, the "when" under them): measured, not a
    // width in px — what is on the line differs (a key's name, an area's size, "+1 more"), and nothing on it may shrink
    // to "…" (studio-ui-lead). ⌄ below ▶ = it wrapped.
    // fix-0140 (⑤ of the first-run check, 2026-10-23): a second trigger adds its "+1" chip, and at 1280 that alone
    // tipped the line into the narrow order — two rows, "When does it move?" gone, "Ask {ai}" down to "✦ AI". A step
    // before that now ('snug'): ▶ Preview as its icon (the word is its tooltip) and no ▷ Try on the line (Fine-tune's
    // Try has it). Only when the line still wraps does it take the narrow order.
    const wrapped = () => !el.hidden && el.isConnected && fold().offsetTop > play().offsetTop + play().offsetHeight / 2;
    if (!tightNow && wrapped()) {
      el.classList.add('snug');
      if (wrapped()) {
        el.classList.remove('snug');
        tightNow = true;
        el.classList.add('narrow');
        renderHead(v);
      }
    }
    renderFine(v);
    renderNext(v);
    if (had) (inMore ? fineEl : el).querySelector<HTMLSelectElement>(`select[data-part="${had}"]`)?.focus({ preventScroll: true });
    renderSel(v);
    // A scene (studio-timeline-2) says what it is — one motion, this many objects — over the rows it names. Said once
    // there are two (studio-motion-focus: a scene of one is the object's own motion, nothing to say).
    rulerPad.replaceChildren(...(v.clip && v.scene && v.scene.n > 1 ? [h('span', { class: 'tl-scene', title: t('tl.sceneTip'), dataset: { part: 'tl-scene' }, text: t('tl.scene', { n: v.scene.n }) })] : []));
    // A phone (studio-fix-0142, ⑬ of the fourth first-run check, 2026-10-24): ⌄ goes to the names column's head, over
    // the rows (the right of "Linked · 2"). In the head it had a row of its own — ▶ and Repeat fill the first row and
    // "when", Fine-tune and ✦ AI the second, at 44 px a finger each — which made a plate already 3/4 of the screen
    // taller. The side window keeps it in the head (there it fits on the first row). Moved after the measure above.
    const shell = el.closest<HTMLElement>('.shell');
    const foldEl = tightNow && shell?.dataset.layout === 'phone' && shell.dataset.fit !== 'side' ? head.querySelector<HTMLElement>('.tl-fold') : null;
    if (foldEl) rulerPad.append(foldEl);
    renderRows(v);
    if (gripHad) names.querySelector<HTMLElement>(`[data-grip="${CSS.escape(gripHad)}"]`)?.focus({ preventScroll: true });
    // The link list follows its button (drawn anew with the rows), and closes once it is done (linked, or Esc in the game).
    if (linkPop.open) {
      const b = names.querySelector<HTMLElement>('[data-part=tl-link]');
      if (!v.link?.linking || !b) linkPop.hide();
      else linkPop.place(b);
    }
    renderRuler(v);
    place(v);
  }

  /**
   * The next step once a motion is made (studio-motion-next, 2026-10-24; a hands-on review: "after making a motion there are three
   * things to press — ✦ Ask Claude, the box, Save — and I can't tell which"): "✓ gate’s motion is made · Save puts it in
   * the game · ✦ Turn it into a rule to adjust it with numbers". Save is the top bar's (one Save, save-loud.ts); the rule
   * part is a button, the same as the line's ✦ Turn into a rule. Its words never say "knob" (the glossary: a hands-on review did not
   * know the word).
   */
  function renderNext(v: TimelineView) {
    const n = v.clip && v.next && !v.making ? v.next : null;
    nextEl.hidden = !n;
    if (!n) return void nextEl.replaceChildren();
    nextEl.replaceChildren(icon('check'), h('span', { class: 'tl-next-w', dataset: { part: 'tl-next-made' }, text: t('tl.next.made', { name: n.name }) }),
      ...(v.canRule && act.toRule ? [h('span', { class: 'tl-next-dot', 'aria-hidden': 'true', text: '·' }),
        h('button', { type: 'button', class: 'tl-next-rule', title: t('tl.ruleTip'), dataset: { action: 'tl-next-rule', part: 'tl-next-rule' }, onclick: () => act.toRule!() },
          icon('spark'), h('span', { text: t('tl.next.rule') }))] : []));
  }

  // The line's first part (▶, or the "drag it" words with no motion yet): ⌄ below it = the line wrapped.
  const play = () => (head.firstElementChild as HTMLElement | null) ?? head;
  const fold = () => head.querySelector<HTMLElement>('.tl-fold') ?? head;

  /**
   * The picked keys' row (studio-ui-lead): "Keys picked · 2 — To the next key [Eases in and out ▾] — Path turns
   * [Smoothly ▾] — 🗑 Delete". Only while keys are picked. Before, "Point ▾" and "Keys ▾" sat on the line with no room
   * (every menu became "…") and with labels that said nothing ("Keys ▾ Ease in-out" read as the motion's speed, 10/22).
   * Delete is a button too: a phone has no Delete key.
   */
  function renderSel(v: TimelineView) {
    const n = v.ease ? allPicked(v).length : 0;
    selRow.hidden = !n;
    if (!n) return void selRow.replaceChildren();
    const group = (label: string, pick: Node) => h('span', { class: 'tl-sel-group' }, h('span', { class: 'tl-sel-lbl', text: label }), pick);
    const items: Node[] = [h('span', { class: 'tl-sel-n', dataset: { part: 'tl-sel-n' }, text: t('tl.sel', { n }) })];
    const ease = select('tl-ease', t('tl.easeTip'), [...(v.ease === 'mixed' ? [['', '—', true] as [string, string, boolean]] : []),
      ...(['ease', 'linear', 'step'] as MotionEase[]).map((e) => [e, t(`tl.ease.${e}`)] as [string, string])], v.ease !== 'mixed' ? v.ease! : '', (e) => act.ease(e as MotionEase));
    ease.classList.add('tl-ease-pick');
    items.push(group(t('tl.ease'), ease));
    // The path's points (studio-timeline-2): only while position keys are picked.
    if (v.point && act.point) {
      const opts: Array<[string, string, boolean?]> = [...(v.point === 'mixed' ? [['', '—', true] as [string, string, boolean]] : []),
        ['smooth', t('tl.point.smooth')], ['corner', t('tl.point.corner')], ['custom', t('tl.point.custom'), true]];
      const pt = select('tl-point', t('tl.pointTip'), opts, v.point === 'mixed' ? '' : v.point, (k) => act.point!(k as PointKind));
      pt.classList.add('tl-point-pick');
      items.push(group(t('tl.point'), pt));
    }
    if (act.deleteKeys) items.push(h('button', { type: 'button', class: 'tl-sel-del', title: t('tl.sel.deleteTip'), dataset: { part: 'tl-sel-del', action: 'tl-delete' }, onclick: () => act.deleteKeys!() },
      icon('trash'), h('span', { text: t('tl.sel.delete') })));
    selRow.replaceChildren(...items);
  }

  /** The motion's menu (in Fine-tune): this object's motions, then "+ Make a motion" and a new scene, then rename / take off. */
  function clipMenu(v: TimelineView): Node {
    const c = v.clip;
    const opts: Array<[string, string, boolean?]> = [];
    if (!v.clips.length) opts.push(['', t('tl.noClip'), true]);
    for (const n of v.clips) opts.push([n, n]);
    opts.push(['-', '──────', true]);
    // studio-no-presets (2026-10-23): no kinds here any more (Back and forth, Round, Once, Spin — studio-tool-clear had
    // kept them on a thing that moves already). The review: "we don't need them". "+ Make a motion" is the strip's and
    // the card's way (show it: the next move is its key). studio-ui-lead2 (10/23): "New: Scene — several objects" is
    // gone too (the request: "Make a motion, New — I can't tell what either does"): one way in; several objects are
    // the row's "+ Link an object" (a linked motion becomes a scene by itself).
    opts.push(['new:make', t('tl.make'), !v.focus]);
    if (c) opts.push(['rename', t('tl.rename')], ['delete', t('tl.delete')]);
    const clipSel = select('tl-clip', t('tl.clip'), opts, c?.name ?? '', (val) => {
      if (val === 'rename') return void renaming(c!.name);
      act.clip(val);
    });
    clipSel.classList.add('tl-clip-pick');
    return clipSel;
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

  /** The link list closed (the plate was hidden: the Library, Play, fold). Optional for the tests' stand-in panels. */
  const closeMore: (() => void) | undefined = () => linkPop.hide();
  /** A rule knob being turned on the line (studio-code-knobs): the strips' words follow without drawing the line again. */
  function ruleWords(key: string, words: string) {
    const w = lanes.querySelector<HTMLElement>(`.tl-rule[data-key="${CSS.escape(key)}"] .tl-rule-w`);
    if (w && !w.closest('.off, .missing')) w.textContent = `${t('rule.motion')}: ${words}`;
  }
  return { el, render, place, focusStarts, closeMore, ruleWords };
}
