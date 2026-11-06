// The guide after a sample opens from the shelf (shelf.ts; decided 2026-11-06). One card at a time, three at most,
// the same three tries as the shelf promised: 1 Move → 2 Play, then press P → 3 ● Clip. The thing to press next wears
// a violet ring (▶ Play, then ● Clip) so it reads without reading. Skip ends it at any step and it never comes back on
// this device. Over the ask field: “Try asking ‘…’” — pressing it puts the sample's words in the field (nothing to
// type), and it goes once used.
//
// Not the first-run tips that were taken out on 2026-10-17 ("I don't need this"): those came for everyone in every
// game. This comes once, only to someone who just picked a sample on the shelf to try it, and only says what the
// shelf card already said, at the moment it applies.
//
// It reads the editor from outside (its data-part / data-action marks and the shell's data-playing / data-paused),
// so main.ts carries no tour code: when the guide is done there is nothing of it left running.
import type { Lang } from '../contract.ts';
import { h } from './dom.ts';
import { shelfText, askWords, moveWords } from './shelf-strings.ts';
import { SHELF_CSS } from './shelf-css.ts';
import { TOUR_KEY, pauseSeconds, type TourStart } from './shelf.ts';

/** Set once Skip or Done is pressed: no guide again on this device (any sample, any folder). */
export const TOUR_OFF_KEY = 'studio.shelfTour.off';
const STEP_KEY = 'studio.shelfTour.step';
/** How long to wait for the editor's buttons before showing the card anyway (a slow first open of three.js is ~9 s). */
const WAIT_MAX_MS = 20_000;

export type TourStep = 1 | 2 | 3;

/**
 * The next step from what the editor shows (pure; test/shelf.test.ts). A change made (Save shows) finishes Move;
 * playing skips ahead to Play; a paused moment finishes Play. Never goes back: a person who paused and then pressed
 * Edit is not asked to pause again.
 */
export function nextStep(now: TourStep, seen: { changed: boolean; playing: boolean; paused: boolean }): TourStep {
  let s = now;
  if (s === 1 && (seen.changed || seen.playing || seen.paused)) s = 2;
  if (s === 2 && seen.paused) s = 3;
  return s;
}

/**
 * The card's second line (pure; test/shelf.test.ts). `try.mark` (decided 2026-11-06, Marble Rain): the ask says
 * "here", so the Play card says to point with ◎ Mark first — one line in the same card, not a fourth step, and nothing
 * checks that a mark was made (asking without one still works).
 */
export function moreKey(step: TourStep, tr: { mark?: boolean } | null | undefined): 'tour.moveMore' | 'tour.playMore' | 'tour.playMoreMark' | 'tour.clipMore' {
  if (step === 1) return 'tour.moveMore';
  if (step === 2) return tr?.mark ? 'tour.playMoreMark' : 'tour.playMore';
  return 'tour.clipMore';
}

const store = (kind: 'local' | 'session') => {
  try {
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
};

export function startTour(): void {
  const ss = store('session');
  const ls = store('local');
  let start: TourStart | null = null;
  try {
    start = JSON.parse(ss?.getItem(TOUR_KEY) || 'null');
  } catch {
    start = null;
  }
  if (!start || typeof start.id !== 'string') return;
  const off = ls?.getItem(TOUR_OFF_KEY) === '1';
  const lang = (): Lang => (document.documentElement.lang === 'ja' ? 'ja' : 'en');
  const say = (k: Parameters<typeof shelfText>[1], v?: Record<string, string | number>) => shelfText(lang(), k, v);
  const tr = start.try || {};
  if (!document.querySelector('style[data-studio-shelf]')) document.head.append(h('style', { text: SHELF_CSS, dataset: { studioShelf: '' } }));

  let step: TourStep = (Number(ss?.getItem(STEP_KEY)) || 1) as TourStep;
  let card: HTMLElement | null = null;
  let ring: HTMLElement | null = null;
  let chips: HTMLElement | null = null;
  let raf = 0;
  let shownStep = 0;
  let shownLang = '';
  const t0 = Date.now();

  const $ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.offsetParent !== null) ?? null;
  const app = () => document.querySelector<HTMLElement>('[data-part=app]');

  function end(forever: boolean) {
    cancelAnimationFrame(raf);
    card?.remove();
    ring?.remove();
    card = ring = null;
    ss?.removeItem(STEP_KEY);
    // The guide is over; the "Try asking" words stay until used (they are the sample's, not the guide's).
    if (forever) ls?.setItem(TOUR_OFF_KEY, '1');
    if (used || !askWords(lang(), tr.ask)) ss?.removeItem(TOUR_KEY);
  }

  /** What the ring is around in this step, or null (Move: the thing to drag is inside the game, not a button). */
  function target(): HTMLElement | null {
    // ▶ Play first; once it plays, ❚❚ (P) is the press that finishes this step.
    if (step === 2) return (app()?.dataset.playing === 'on' ? $('[data-action=play-pause]') : null) || $('[data-action=play]');
    if (step === 3) return $('[data-action=clip]');
    return null;
  }

  function draw() {
    if (!card) {
      card = h('div', { class: 'tour-card', role: 'region', 'aria-label': start!.title, 'aria-live': 'polite', dataset: { part: 'samples-tour' } });
      document.body.append(card);
    }
    if (shownStep === step && shownLang === lang()) return;
    shownStep = step;
    shownLang = lang();
    const head = step === 1 ? (moveWords(lang(), tr) ? say('tour.move', { move: moveWords(lang(), tr) }) : say('tour.moveAny'))
      : step === 2 ? (tr.pauseAt !== undefined ? say('tour.play', { s: pauseSeconds(tr.pauseAt) }) : say('tour.playAny'))
      : say('tour.clip');
    const more = say(moreKey(step, tr));
    const row = h('div', { class: 'row' });
    if (step === 2) row.append(h('kbd', { text: 'P' }), h('span', { text: say('tour.key') }));
    row.append(h('span', { class: 'sp' }), h('button', { type: 'button', dataset: { action: 'tour-skip' }, onclick: () => end(true) }, say('tour.skip')));
    if (step === 1) row.append(h('button', { type: 'button', class: 'next', dataset: { action: 'tour-next' }, onclick: () => go(2) }, say('tour.next')));
    if (step === 3) row.append(h('button', { type: 'button', class: 'next', dataset: { action: 'tour-done' }, onclick: () => end(true) }, say('tour.done')));
    card.dataset.step = String(step);
    card.replaceChildren(
      h('div', { class: 'k' }, h('span', { text: say('tour.head', { title: start!.title, n: step, all: 3 }) }),
        h('span', { class: 'dots', 'aria-hidden': 'true' }, ...[1, 2, 3].map((i) => h('i', { class: i === step ? 'on' : '' })))),
      h('h4', { text: head }), h('p', { text: more }), row);
  }

  function go(s: TourStep) {
    step = s;
    ss?.setItem(STEP_KEY, String(s));
  }

  /** Every frame while the guide is up: follow the editor (step, the ring's button, where the card sits). */
  function tick() {
    raf = requestAnimationFrame(tick);
    const a = app();
    const ready = !!a && !!$('[data-action=play]') && ($('[data-part=wait-line]') === null || Date.now() - t0 > WAIT_MAX_MS);
    if (!ready) return;
    const save = $('[data-part=save]');
    go(nextStep(step, { changed: !!save, playing: a!.dataset.playing === 'on', paused: a!.dataset.paused === 'on' }));
    draw();
    const tg = target();
    const r = tg?.getBoundingClientRect();
    if (r && r.width) {
      if (!ring) {
        ring = h('div', { class: 'tour-ring', 'aria-hidden': 'true', dataset: { part: 'tour-ring' } });
        document.body.append(ring);
      }
      Object.assign(ring.style, { left: `${r.left - 3}px`, top: `${r.top - 3}px`, width: `${r.width + 6}px`, height: `${r.height + 6}px` });
    } else if (ring) {
      ring.remove();
      ring = null;
    }
    // Under the button the step is about (▶ Play's corner on Move too: that is where the next press is).
    const near = (r && r.width ? r : $('[data-action=play]')?.getBoundingClientRect()) ?? null;
    if (card && near) {
      card.style.top = `${Math.round(near.bottom + 12)}px`;
      card.style.right = `${Math.max(16, Math.round(window.innerWidth - near.right))}px`;
      card.style.left = 'auto';
    }
  }

  // ● Clip pressed in step 3 = the guide is done (the Clip's own line takes over from here).
  document.addEventListener('click', (e) => {
    if (card && step === 3 && (e.target as Element | null)?.closest?.('[data-action=clip]')) end(true);
  }, true);

  /**
   * “Try asking ‘…’” over the ask field. Pressing it fills the field; it goes once used. Kept in place by a slow check
   * (not once): the editor redraws its bottom bar (a phone's sheet, the paused moment), and the words follow the
   * editor's language, which is known only once the person's settings are read.
   */
  let used = false;
  let chipsLang = '';
  function keepChips() {
    const ask = askWords(lang(), tr.ask);
    const bar = document.querySelector<HTMLElement>('[data-part=bar]');
    const input = bar?.querySelector('input') as HTMLInputElement | null;
    if (used || !ask) return void clearInterval(chipTimer);
    if (!bar || !input) return;
    if (!chips || chipsLang !== lang()) {
      chips?.remove();
      chipsLang = lang();
      chips = h('div', { class: 'try-ask', dataset: { part: 'try-ask' } }, h('em', { text: say('try.ask') }),
        h('button', { type: 'button', title: say('try.askTip'), dataset: { action: 'try-ask' }, onclick: () => {
          input.value = ask;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus({ preventScroll: true });
          input.setSelectionRange?.(ask.length, ask.length);
          used = true;
          chips?.remove();
          chips = null;
          clearInterval(chipTimer);
          if (!card) ss?.removeItem(TOUR_KEY);
        } }, say('ask.quote', { text: ask })));
    }
    if (chips.nextElementSibling !== bar) bar.before(chips);
    // Hidden while the field has words of the person's own (the tag would cover what they are typing about).
    chips.hidden = input.value.trim() !== '' && input.value !== ask;
  }
  const chipTimer = window.setInterval(keepChips, 300);
  keepChips();
  if (off) return;
  raf = requestAnimationFrame(tick);
}
