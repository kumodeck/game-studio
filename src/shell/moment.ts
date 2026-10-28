// The paused moment, the editor page's side (pause-edit, 2026-10-28; CONTRACT.md §3.5.1).
//
// The request (2026-10-28): "pause in the middle of a scene and give instructions, by hand or to the AI" — answered by
// making the paused moment the editor (and making the pause easier to find). While playing, P / ❚❚ Pause to edit holds the
// game (bridge/play-pause.ts) and wakes the editor over the frame it stopped at (bridge/play-move.ts): Edit's tools —
// the list (floating over the game, so the game's picture does not change size), the card, the strip, the one field at
// the foot, Undo / Redo, Save. "Edit" stays what it was (10/23): the scene before Play.
//
// This file is the top bar's part of it and the pure rules (test/pause.test.ts); main.ts wires the rest (the list's
// "Made by the game", the card's "Just for this moment", ⌘Z, the field's request):
//   - the guide's third crumb says where the game is: "● Playing 0:41.8" / "❚❚ Paused 0:42.3" — the game's own time
//     since ▶ Play (its clock, play/time; moved on here between messages), so "time can be stopped" is seen;
//   - Speed "1× ⌄" (1× · ½× · ¼×) while playing and paused: slow down BEFORE the boss comes is the answer to "the moment
//     is hard to catch" (02-find.md); every ▶ Play starts at 1×;
//   - ▶| Next frame while paused (the . key too; held = on at the speed);
//   - "❚❚ Pause to edit P" left of Edit on every screen (it was in the game's corner, and in the top bar on a phone
//     only); "▶ Resume P" while paused. A phone shows ❚❚ / ▶ alone (no room for words);
//   - the first ▶ Play of a person, one line under it: "Pause anytime to edit that very moment P" (once per person on
//     this device; gone at the first pause or after 8 s — the 10/23 "one line when it opens" manners).
//
// pause-edit fix 1 (2026-10-28, walk 1 of stage 1 as a first-time person):
//   - ✕8: paused, the clock has two places ("0:06.02"): one ▶| is 1/60 s, which "0:06.0" never showed (it took six
//     presses to move). The first pause of a person also hangs "Next frame ." under ▶| once (the first-Play line's
//     manners: gone at the first press of it, or after 8 s): without words ▶| read as a media player's "next".
//   - ✕4: a phone while playing writes whole seconds ("0:41", the plan's bar "Neon Run 0:41 · ¼× · ❚❚ · ■ Edit") and the
//     guide never shrinks (shell.css: the game's name gives way) — "0:01." was cut and 1× slid under ✦.
//   - ✕15: a phone while paused says "▶ Resume" in words: ▶ alone sat beside ▶| and ▶ of the speed menu (three play
//     signs in a row), and the room was there.
import type { MomentKind } from '../contract.ts';
import { h } from './dom.ts';
import { icon, setButton } from './icons.ts';
import { tipText } from './keymap.ts';

/**
 * "0:41.8": the game's time as the top bar writes it. Floored, so it never reads ahead of the game. `places` = digits
 * after the point: 1 (playing, "0:41.8"), 2 (paused, "0:41.83": one Next frame is 1/60 s — fix 1 ✕8), 0 (a phone while
 * playing, "0:41": the bar has no room for more).
 */
export function clockText(seconds: number, places: 0 | 1 | 2 = 1): string {
  const unit = 10 ** places;
  const n = Math.max(0, Math.floor((Number.isFinite(seconds) ? seconds : 0) * unit + 1e-6));
  const m = Math.floor(n / (60 * unit));
  const rest = n - m * 60 * unit;
  const s = Math.floor(rest / unit);
  return `${m}:${String(s).padStart(2, '0')}${places ? '.' + String(rest % unit).padStart(places, '0') : ''}`;
}
/** The clock's places in the top bar now (clockText): paused 2, a phone while playing 0, else 1. */
export function clockPlaces(paused: boolean, phone: boolean): 0 | 1 | 2 {
  return paused ? 2 : phone ? 0 : 1;
}

/** "1×", "½×", "¼×". */
export function speedText(rate: number): string {
  return rate === 0.5 ? '½×' : rate === 0.25 ? '¼×' : '1×';
}

/**
 * The game's clock as the editor page last heard it (play/time), moved on by the editor page's own clock in between:
 * `t` seconds at `at` (the editor page's performance.now), at `rate`, going when `running`.
 */
export interface HeardClock {
  t: number;
  rate: number;
  running: boolean;
  at: number;
}
export function clockNow(c: HeardClock | null, now: number): number {
  if (!c) return 0;
  return c.running ? c.t + Math.max(0, now - c.at) / 1000 * c.rate : c.t;
}

/**
 * The list's "Made by the game · N" (decision 5): what the game made since ▶ Play, one row per name with ×N (a game
 * with 200 bullets must not bury the list), in the list's order. `label` = the name the list shows.
 */
export function madeRows<T extends { key: string }>(items: T[], why: (key: string) => MomentKind | null, label: (it: T) => string): Array<{ name: string; keys: string[] }> {
  const out = new Map<string, string[]>();
  for (const it of items) {
    if (why(it.key) !== 'new') continue;
    const name = label(it);
    const l = out.get(name);
    if (l) l.push(it.key);
    else out.set(name, [it.key]);
  }
  return [...out].map(([name, keys]) => ({ name, keys }));
}

/**
 * Which of a step's moves are just for this moment (the game's objects) and which go in the scene (placed ones), for
 * one ⌘Z step (decision 6). Pure.
 */
export function splitMoves<T extends { key: string }>(moves: T[], why: (key: string) => MomentKind | null): { placed: T[]; moment: T[] } {
  const placed: T[] = [];
  const moment: T[] = [];
  for (const m of moves) (why(m.key) ? moment : placed).push(m);
  return { placed, moment };
}

export interface MomentBarDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  phone(): boolean;
  mac(): boolean;
  /** Playing now (▶ Play), and paused (the game held: the moment is up or coming). */
  playing(): boolean;
  paused(): boolean;
  /** The game's clock as last heard (play/time). */
  clock(): HeardClock | null;
  /** ❚❚ / ▶ Resume / ▶| / a speed: to the game page (play/pause, play/step, play/speed). */
  pause(): void;
  resume(): void;
  step(on: boolean): void;
  speed(rate: number): void;
  /**
   * The speeds' menu at the button (main.ts draws it with the context menu). `head` = its small title ("Speed": fix 1
   * ✕13 — "1× ✓ ½× ¼×" alone did not say what the numbers are).
   */
  menu(at: HTMLElement, rows: Array<{ id: string; label: string; checked?: boolean; key?: string; run(): void }>, head: string): void;
  /**
   * A first-time line was shown to this person (kept in the person's prefs): 'pause' = the first-Play line under ❚❚,
   * 'step' = "Next frame ." under ▶| at the first pause (fix 1 ✕8).
   */
  tipSeen(which: 'pause' | 'step'): boolean;
  seeTip(which: 'pause' | 'step'): void;
}

export interface MomentBar {
  /** In the top bar's guide, after the game's name: "● Playing 0:41.8" ▶| 1× ⌄. */
  guide: HTMLElement;
  /** Left of Edit: ❚❚ Pause to edit P / ▶ Resume P. */
  pauseBtn: HTMLButtonElement;
  /** Under the top bar, the first ▶ Play only. */
  tip: HTMLElement;
  /** Under ▶|, the first pause only: "Next frame ." (fix 1 ✕8). */
  stepTip: HTMLElement;
  /** ▶| itself (main.ts hangs stepTip under it). */
  stepBtn: HTMLButtonElement;
  /** At the game's foot for 2 s: "▶ Resumed from 0:42.3" (04-words.md; the dock with the toast is away while playing). */
  note: HTMLElement;
  flash(text: string): void;
  render(): void;
  /** A Next frame from elsewhere (the . key, ⌘K): the "Next frame ." line has done its work. */
  stepped(): void;
  /** A new ▶ Play (the first-Play line may show) / the end of one. */
  played(): void;
}

/** The first-Play line stays this long (02-find.md: "8 s or the first pause"). */
export const FIRST_TIP_MS = 8000;

export function createMomentBar(d: MomentBarDeps): MomentBar {
  const word = h('span', { class: 'play-word' });
  const mark = h('span', { class: 'play-mark', 'aria-hidden': 'true' });
  const time = h('span', { class: 'play-time mono', dataset: { part: 'play-time' } });
  const where = h('span', { class: 'play-where', dataset: { part: 'play-where' } }, mark, word, time);
  const stepBtn = h('button', { type: 'button', class: 'play-step', dataset: { action: 'play-step', part: 'play-step' } }) as HTMLButtonElement;
  const speedBtn = h('button', { type: 'button', class: 'play-speed', dataset: { action: 'play-speed', part: 'play-speed' }, 'aria-haspopup': 'menu' }) as HTMLButtonElement;
  const guide = h('span', { class: 'play-guide', hidden: true, dataset: { part: 'play-guide' } }, where, stepBtn, speedBtn);
  const pauseBtn = h('button', { type: 'button', class: 'play-pause', hidden: true, dataset: { action: 'play-pause', part: 'play-pause' } }) as HTMLButtonElement;
  const tip = h('div', { class: 'play-tip', role: 'status', hidden: true, dataset: { part: 'play-tip' } });
  const stepTip = h('div', { class: 'play-tip step-tip', role: 'status', hidden: true, dataset: { part: 'step-tip' } });
  const note = h('div', { class: 'play-flash', role: 'status', hidden: true, dataset: { part: 'play-flash' } });
  let noteTimer = 0;

  // Next frame: pressed = one frame, held = on at the speed (the game page steps; play/step on / off). A finger too.
  let held = false;
  const let_go = () => {
    if (!held) return;
    held = false;
    d.step(false);
  };
  stepBtn.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    held = true;
    stepTipOff();
    try {
      stepBtn.setPointerCapture(e.pointerId);
    } catch {
      /* fine */
    }
    d.step(true);
  });
  stepBtn.addEventListener('pointerup', let_go);
  stepBtn.addEventListener('pointercancel', let_go);
  stepBtn.addEventListener('lostpointercapture', let_go);
  // From the keyboard (Enter / Space on the button): one frame.
  stepBtn.addEventListener('click', (e) => {
    if (e.detail === 0) (stepTipOff(), d.step(true), d.step(false));
  });
  speedBtn.addEventListener('click', () => {
    const now = d.clock()?.rate ?? 1;
    const rows: Array<{ id: string; label: string; checked?: boolean; key?: string; run(): void }> = [1, 0.5, 0.25].map((r) => ({
      id: `speed-${r}`, label: speedText(r), checked: now === r, run: () => d.speed(r),
    }));
    if (d.paused()) rows.push({ id: 'step', label: d.t('play.step'), key: '.', run: () => (stepTipOff(), d.step(true), d.step(false)) });
    d.menu(speedBtn, rows, d.t('play.speed'));
  });
  pauseBtn.addEventListener('click', () => {
    if (d.paused()) d.resume();
    else d.pause();
  });

  // The first-Play line: shown once per person, gone at the first pause or after FIRST_TIP_MS.
  let tipTimer = 0;
  let tipOn = false;
  const tipOff = () => {
    if (!tipOn) return;
    tipOn = false;
    window.clearTimeout(tipTimer);
    tip.hidden = true;
    d.seeTip('pause');
  };
  // "Next frame ." under ▶| (fix 1 ✕8): the first pause of a person only; gone at the first step (the button or the .
  // key: stepped()), at Resume, or after FIRST_TIP_MS — then never again on this device.
  let stepTipTimer = 0;
  let stepTipOn = false;
  const stepTipOff = () => {
    if (!stepTipOn) return;
    stepTipOn = false;
    window.clearTimeout(stepTipTimer);
    stepTip.hidden = true;
    d.seeTip('step');
  };

  // The time moves on by itself between play/time messages (10 a second is what "0:41.8" shows).
  let ticker = 0;
  const tick = () => {
    time.textContent = clockText(clockNow(d.clock(), performance.now()), clockPlaces(d.playing() && d.paused(), d.phone()));
  };

  function render() {
    const playing = d.playing();
    const paused = playing && d.paused();
    guide.hidden = !playing;
    pauseBtn.hidden = !playing;
    if (!playing) {
      window.clearInterval(ticker);
      ticker = 0;
      tipOff();
      stepTipOff();
      note.hidden = true;
      return;
    }
    guide.dataset.state = paused ? 'paused' : 'playing';
    mark.replaceChildren(paused ? icon('pause') : h('span', { class: 'play-dot' }));
    word.textContent = paused ? d.t('play.paused') : d.t('status.playingShort');
    where.title = d.t('play.timeTip');
    tick();
    const running = !!d.clock()?.running && !paused;
    if (running && !ticker) ticker = window.setInterval(tick, 100);
    else if (!running && ticker) (window.clearInterval(ticker), (ticker = 0));
    stepBtn.hidden = !paused;
    setButton(stepBtn, 'stepFrame', d.t('play.step'), false, tipText(d.t('play.step'), '.'));
    const rate = d.clock()?.rate ?? 1;
    speedBtn.replaceChildren(h('span', { class: 'label', text: speedText(rate) }), icon('chevronDown'));
    speedBtn.title = d.t('play.speedTip');
    speedBtn.setAttribute('aria-label', `${d.t('play.speed')} ${speedText(rate)}`);
    speedBtn.dataset.rate = String(rate);
    const words = paused ? d.t('play.resume') : d.t('play.pauseEdit');
    // A phone: ❚❚ alone while playing (no room), "▶ Resume" in words while paused (fix 1 ✕15: the name is away then).
    setButton(pauseBtn, paused ? 'play' : 'pause', words, !d.phone() || paused, tipText(paused ? d.t('play.resumeTip') : d.t('play.pauseTip'), 'P'));
    if (!d.phone()) pauseBtn.append(h('kbd', { text: 'P' }));
    pauseBtn.dataset.state = paused ? 'paused' : 'playing';
    if (paused) tipOff();
    else stepTipOff();
    if (paused && !stepTipOn && !d.tipSeen('step')) {
      stepTipOn = true;
      stepTip.hidden = false;
      window.clearTimeout(stepTipTimer);
      stepTipTimer = window.setTimeout(stepTipOff, FIRST_TIP_MS);
    }
    tip.replaceChildren(h('span', { text: d.t('play.firstTip') }), d.phone() ? '' : h('kbd', { text: 'P' }));
    stepTip.replaceChildren(h('span', { text: d.t('play.step') }), d.phone() ? '' : h('kbd', { text: '.' }));
  }

  return {
    guide,
    pauseBtn,
    tip,
    stepTip,
    stepBtn,
    note,
    flash(text) {
      note.replaceChildren(icon('play'), h('span', { text }));
      note.hidden = false;
      window.clearTimeout(noteTimer);
      noteTimer = window.setTimeout(() => (note.hidden = true), 2000);
    },
    render,
    stepped: stepTipOff,
    played() {
      if (!d.playing() || d.tipSeen('pause') || tipOn) return;
      tipOn = true;
      tip.hidden = false;
      window.clearTimeout(tipTimer);
      tipTimer = window.setTimeout(tipOff, FIRST_TIP_MS);
    },
  };
}
