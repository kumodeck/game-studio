// The shelf: what the editor opens on in a folder without a game (decided 2026-11-06). Before, the AI asked
// "Start from a sample? 3D or 2D" in words and copied one in; with six samples words cannot show what they are, so
// the editor shows them moving and the person picks with their eyes. The AI asks nothing (SKILL.md §0).
//
// The screen, in the order it is met:
//   1. One heading, one line, the samples as cards in `order` (src/server/starters.mjs shelfList). Samples still
//      being made are "Coming" cards (no picture, not pressable). Top right: "Have a game already? … /arrange".
//   2. Pointing at a card plays THAT sample, live, in its picture (only one at a time; see `live` below for why it is
//      the game itself and not a video). Leaving the card stops it and frees its WebGL context.
//   3. A press makes the card grow into the shelf's place — not a dialog over it (no scrim, no ✕): the same picture
//      keeps playing, bigger, with one line about it, the three tries (Move → Play, then press P → ● Clip), the words
//      to ask in a violet tag, and ONE button: "Open <title>". "All samples" goes back.
//   4. Open: the server copies the sample into the folder (api/shelf/open) and the page reloads into the editor on
//      it; samples-tour.ts then shows the one-card guide (it learns which sample from sessionStorage).
//
// Phone (390 wide): one column; there is no pointing, so cards show their picture and the grown card plays.
//
// Built apart from main.ts on purpose: the editor's start needs a game page, the shelf has none. local.ts asks the
// server once (host.open → `shelf: true`) and starts one or the other.
import { LOCAL_PATHS, type StudioHost, type Lang } from '../contract.ts';
import { h } from './dom.ts';
import { detectLang } from './i18n.ts';
import { normalizeUi, effectiveTheme } from './ui-prefs.ts';
import { shelfText, askWords, moveWords, blurbWords } from './shelf-strings.ts';
import { SHELF_CSS } from './shelf-css.ts';

/** One card, as the server sends it (server.mjs api/shelf). */
export interface ShelfItem {
  id: string;
  title: string;
  dim: '3d' | '2d';
  blurb: string;
  /** The card's line in other languages (the sample's strings.json); `blurb` is English. */
  blurbs?: { ja?: string };
  order: number;
  coming?: boolean;
  thumb?: string | null;
  play?: string;
  engine?: string;
  // move = the placement name; moveName = how to call it per language; pauseAt = the GAME's clock (see pauseSeconds).
  try?: { move?: string; moveName?: { en?: string; ja?: string }; pauseAt?: number; ask?: { en?: string; ja?: string }; mark?: boolean } | null;
}

/** What samples-tour.ts needs after the reload: kept in sessionStorage for this tab only (not a preference). */
export const TOUR_KEY = 'studio.shelfTour';
export interface TourStart { id: string; title: string; try: ShelfItem['try'] }

/** How long a pointer must rest on a card before its game starts (a mouse sweeping across the grid starts nothing). */
const LIVE_DELAY_MS = 180;

/** The three tries of a sample, as plain data (test/shelf.test.ts): what each says, with the sample's own words. */
export function shelfSteps(lang: Lang, it: Pick<ShelfItem, 'id' | 'try'>) {
  const tr = it.try || {};
  const ask = askWords(lang, tr.ask);
  const move = moveWords(lang, tr);
  // Sentences meet with a space in English and with nothing between them in Japanese (after its full stop).
  const join = (parts: string[]) => parts.filter(Boolean).join(lang === 'ja' ? '' : ' ');
  return [
    { n: 1, head: shelfText(lang, 'step.move'), text: join([move ? shelfText(lang, 'step.move.with', { move }) : shelfText(lang, 'step.move.any'), shelfText(lang, 'step.move.more')]) },
    {
      n: 2, head: shelfText(lang, 'step.pause'),
      text: join([tr.pauseAt !== undefined ? shelfText(lang, 'step.pause.at', { s: pauseSeconds(tr.pauseAt) }) : shelfText(lang, 'step.pause.any'), ask ? shelfText(lang, 'step.pause.more') : '']),
      ask: ask || null,
    },
    { n: 3, head: shelfText(lang, 'step.clip'), text: shelfText(lang, 'step.clip.more'), rec: true },
  ];
}

/**
 * How far the game's own clock runs ahead of the editor's top-bar clock (seconds). Measured 2026-11-06 on Big Swell:
 * the game's clock read 7.6 s when the top bar read 0:07.01 — the game starts counting when its page loads, the top bar
 * when ▶ Play has it running. `try.pauseAt` is written in the game's clock (the tests and the clips pause by it).
 */
export const GAME_CLOCK_LEAD = 0.6;

/**
 * `try.pauseAt` (the game's clock) as the second the person sees on the top bar, in whole seconds: 7.6 → "7", the
 * "0:07" the bar shows then (decided 2026-11-06). Whole seconds because the lead varies a little with load time and the
 * words say "about"; floored like the bar's clock (clockText), so the guide never names a second the bar has not reached.
 */
export function pauseSeconds(pauseAt: number): string {
  return String(Math.max(0, Math.floor(pauseAt - GAME_CLOCK_LEAD + 1e-6)));
}

export function showShelf(host: StudioHost, shelfHost: ShelfHost): void {
  let lang: Lang = detectLang(location.search, navigator.language || 'en');
  const say = (k: Parameters<typeof shelfText>[1], v?: Record<string, string | number>) => shelfText(lang, k, v);
  const root = document.documentElement;
  const style = h('style', { text: SHELF_CSS, dataset: { studioShelf: '' } });
  document.head.append(style);
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  let prefs = normalizeUi(null);
  const theme = () => (root.dataset.theme = effectiveTheme(prefs, !!mq?.matches));
  theme();
  mq?.addEventListener?.('change', theme);

  const app = document.getElementById('app') || document.body;
  app.textContent = '';
  const page = h('div', { class: 'samples-page', dataset: { part: 'samples' } });
  app.append(page);

  let items: ShelfItem[] = [];
  let chosen: ShelfItem | null = null;
  let note = '';
  let busy = false;
  // The one live game (a card pointed at, or the grown card). Never two: each is a whole game with its own GPU work.
  let live: { id: string; frame: HTMLIFrameElement; at: HTMLElement } | null = null;
  let liveTimer = 0;

  /**
   * Play the sample in `at` (its picture box). WHY the game itself and not a short video (decided 2026-11-06): a
   * video per sample is a file to make again every time a sample changes (six of them, made by different people),
   * and it would be the only file on the shelf that is not code. The samples are small, run from seed and time,
   * and start in about a second; one at a time, stopped the moment the pointer leaves, costs less than six videos
   * decoding side by side. The picture stays under it until the game has drawn, so nothing flashes black.
   */
  function playIn(it: ShelfItem, at: HTMLElement) {
    if (!it.play || (live && live.id === it.id && live.at === at)) return;
    stopLive();
    const frame = h('iframe', { class: 'samples-live', src: it.play, title: it.title, tabindex: -1, 'aria-hidden': 'true', allow: 'autoplay' });
    frame.addEventListener('load', () => setTimeout(() => frame.classList.add('on'), 350));
    at.append(frame);
    at.closest('.samples-card, .samples-big')?.classList.add('is-live');
    live = { id: it.id, frame, at };
  }
  function stopLive() {
    clearTimeout(liveTimer);
    if (!live) return;
    live.at.closest('.samples-card, .samples-big')?.classList.remove('is-live');
    // about:blank first: some browsers keep a removed frame's WebGL context until the page is collected.
    live.frame.src = 'about:blank';
    live.frame.remove();
    live = null;
  }

  const canPoint = () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true;
  const phone = () => window.innerWidth < 600;

  function card(it: ShelfItem) {
    const pic = h('div', { class: 'samples-pic' });
    if (it.thumb) pic.append(h('img', { src: it.thumb, alt: '', draggable: false, decoding: 'async' }));
    else pic.append(h('div', { class: 'samples-blank', text: it.title }));
    const tags = h('div', { class: 'samples-tags' });
    if (it.coming) tags.append(h('span', { class: 'samples-chip soon', text: say('coming') }));
    pic.append(tags, h('span', { class: 'samples-playing', 'aria-hidden': 'true' }, h('i'), say('playing')));
    const el = h(it.coming ? 'div' : 'button', {
      class: `samples-card${it.coming ? ' coming' : ''}`,
      dataset: { id: it.id, part: 'samples-card' },
      ...(it.coming ? { 'aria-disabled': 'true' } : { type: 'button', 'aria-label': `${it.title}. ${blurbWords(lang, it)}` }),
    }, pic, h('div', { class: 'samples-txt' },
      h('h3', {}, it.title, h('small', { text: it.engine || say(it.dim === '3d' ? 'dim.3d' : 'dim.2d') })),
      h('p', { text: blurbWords(lang, it) })));
    if (it.coming) return el;
    const enter = () => {
      if (!canPoint()) return;
      clearTimeout(liveTimer);
      liveTimer = window.setTimeout(() => playIn(it, pic), LIVE_DELAY_MS);
    };
    const leave = () => {
      clearTimeout(liveTimer);
      if (live && live.at === pic) stopLive();
    };
    el.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && enter());
    el.addEventListener('pointerleave', leave);
    el.addEventListener('focus', () => enter());
    el.addEventListener('blur', leave);
    el.addEventListener('click', () => choose(it, el));
    return el;
  }

  function head() {
    const cmd = h('code', { text: '/arrange' });
    const how = say('own.how', { cmd: '\u0000' }).split('\u0000');
    return h('header', { class: 'samples-bar' },
      h('span', { class: 'samples-logo', 'aria-hidden': 'true' }),
      h('span', { class: 'samples-crumb' }, 'Studio', h('span', { class: 'sep', text: '/' }), say('crumb')),
      h('span', { class: 'samples-sp' }),
      h('p', { class: 'samples-own', dataset: { part: 'samples-own' } }, h('span', { text: say('own') }), ' ', how[0], cmd, how[1] || ''));
  }

  function grid() {
    stopLive();
    page.dataset.view = 'grid';
    page.replaceChildren(head(), h('main', { class: 'samples-main' },
      h('div', { class: 'samples-head' },
        h('h1', { text: say('title') }),
        h('p', { text: say('lead') })),
      h('div', { class: 'samples-grid', role: 'list' }, ...items.map((it) => {
        const c = card(it);
        c.setAttribute('role', 'listitem');
        return c;
      }))));
    document.title = `${say('title')} — Game Studio`;
  }

  /**
   * The grown card. It grows from the card's own place (FLIP: measured before and after, then animated with a
   * transform), so the eye follows the same picture: that is what makes it "this card, bigger" and not a new window.
   */
  function choose(it: ShelfItem, from: HTMLElement) {
    const before = from.querySelector('.samples-pic')?.getBoundingClientRect();
    const keep = live && live.id === it.id ? live.frame : null;
    chosen = it;
    note = '';
    page.dataset.view = 'big';
    const big = bigView(it);
    // The live game the pointer started keeps playing in the big picture (no restart): moved, not made again.
    if (keep && live) {
      const pic = big.querySelector('.samples-pic') as HTMLElement;
      live.at.closest('.samples-card')?.classList.remove('is-live');
      pic.append(keep);
      live.at = pic;
      big.classList.add('is-live');
    } else stopLive();
    page.replaceChildren(head(), h('main', { class: 'samples-main' }, big));
    if (!live) playIn(it, big.querySelector('.samples-pic') as HTMLElement);
    const pic = big.querySelector('.samples-pic') as HTMLElement;
    const after = pic.getBoundingClientRect();
    if (before && after.width && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const sx = before.width / after.width;
      const sy = before.height / after.height;
      pic.animate([
        { transform: `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${sx}, ${sy})`, transformOrigin: '0 0' },
        { transform: 'none', transformOrigin: '0 0' },
      ], { duration: 320, easing: 'cubic-bezier(.2, .8, .2, 1)' });
      big.querySelector('.samples-side')?.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 90, fill: 'backwards', easing: 'ease-out' });
    }
    document.title = `${it.title} — Game Studio`;
    (big.querySelector('[data-action=samples-open]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  function bigView(it: ShelfItem) {
    const steps = shelfSteps(lang, it);
    const openBtn = h('button', { type: 'button', class: 'samples-go', dataset: { action: 'samples-open', part: 'samples-open' }, onclick: () => void open(it) }, say('open', { title: it.title }));
    const line = h('p', { class: 'samples-note', role: 'status', dataset: { part: 'samples-note' }, text: note, hidden: !note });
    return h('section', { class: 'samples-big', dataset: { id: it.id, part: 'samples-big' }, 'aria-label': it.title },
      h('div', { class: 'samples-pic' }, ...(it.thumb ? [h('img', { src: it.thumb, alt: '', draggable: false })] : []),
        h('span', { class: 'samples-playing', 'aria-hidden': 'true' }, h('i'), say('playing'))),
      h('div', { class: 'samples-side' },
        h('button', { type: 'button', class: 'samples-back', dataset: { action: 'samples-back' }, onclick: () => back() }, '‹ ', say('back')),
        h('h2', { text: it.title }),
        h('p', { class: 'samples-meta', text: say('meta', { engine: it.engine || '', dim: say(it.dim === '3d' ? 'dim.3d' : 'dim.2d') }) }),
        h('p', { class: 'samples-lead', text: blurbWords(lang, it) }),
        h('ol', { class: 'samples-steps' }, ...steps.map((s) => h('li', {},
          h('span', { class: 'num', text: String(s.n) }),
          h('div', {}, h('b', { class: s.rec ? 'rec' : '', text: s.head }), ' ', s.text,
            ...(s.ask ? [h('br'), h('span', { class: 'samples-say', dataset: { part: 'samples-say' }, text: say('ask.quote', { text: s.ask }) })] : []))))),
        h('div', { class: 'samples-foot' }, openBtn, line)));
  }

  function back() {
    chosen = null;
    grid();
  }

  async function open(it: ShelfItem) {
    if (busy) return;
    busy = true;
    const btn = page.querySelector('[data-action=samples-open]') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = say('opening', { title: it.title });
    }
    const r = await shelfHost.open(it.id);
    if (r.ok) {
      try {
        sessionStorage.setItem(TOUR_KEY, JSON.stringify({ id: it.id, title: it.title, try: it.try ?? null } satisfies TourStart));
      } catch {
        // No storage (a private window): the sample still opens, only without the guide.
      }
      stopLive();
      location.reload();
      return;
    }
    busy = false;
    note = r.code === 'has-game' ? say('hasGame') : say('openFailed', { e: r.error });
    if (btn) {
      btn.disabled = false;
      btn.textContent = say('open', { title: it.title });
    }
    const line = page.querySelector('[data-part=samples-note]') as HTMLElement | null;
    if (line) {
      line.textContent = note;
      line.hidden = false;
    }
  }

  // Escape goes back from the grown card (the way out a person tries first; there is no ✕ to look for).
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && chosen && !busy) back();
  });
  // A phone turned to wide (or a window made narrow) must not leave a pointer-started game running in a card.
  window.addEventListener('resize', () => {
    if (!chosen && live && (phone() || !canPoint())) stopLive();
  });
  // A hidden tab plays nothing.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !chosen) stopLive();
  });

  void (async () => {
    const [ui, list] = await Promise.all([host.loadUi().catch(() => null), shelfHost.list()]);
    prefs = normalizeUi(ui);
    if (prefs.lang && !new URLSearchParams(location.search).get('lang')) lang = prefs.lang;
    root.lang = lang;
    theme();
    items = list?.items ?? [];
    grid();
    // ?sample=<id> opens straight on that sample's grown card (a link from the docs or a post; also the tests).
    const want = new URLSearchParams(location.search).get('sample');
    const it = want ? items.find((x) => x.id === want && !x.coming) : null;
    if (it) {
      const c = page.querySelector(`[data-id="${CSS.escape(it.id)}"]`) as HTMLElement | null;
      if (c) choose(it, c);
    }
  })();
}

/** The shelf's two calls (host-local.ts): the list, and "copy this one in". */
export interface ShelfHost {
  list(): Promise<{ items: ShelfItem[] } | null>;
  open(id: string): Promise<{ ok: true } | { ok: false; code?: string; error: string }>;
}

/**
 * The local server's side of the shelf (server.mjs api/shelf…). Apart from host-local.ts: the shelf exists only for
 * the local editor in a folder without a game, and nothing in the editor itself calls it.
 */
export function createShelfHost(base: string = LOCAL_PATHS.api): ShelfHost & { isShelf(): Promise<boolean> } {
  const get = async (path: string) => {
    const r = await fetch(base + path, { cache: 'no-store', credentials: 'same-origin' });
    return r.ok ? r.json() : null;
  };
  return {
    // Asked once before anything is drawn (local.ts): the shelf or the editor. Any failure = the editor, as before.
    isShelf: () => get('open').then((r) => r?.shelf === true, () => false),
    list: () => get('shelf').catch(() => null),
    async open(id) {
      try {
        const r = await fetch(base + 'shelf/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }), cache: 'no-store', credentials: 'same-origin' });
        const data = await r.json().catch(() => null);
        if (r.ok) return { ok: true };
        return { ok: false, code: typeof data?.code === 'string' ? data.code : undefined, error: (data && data.error) || `HTTP ${r.status}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  };
}
