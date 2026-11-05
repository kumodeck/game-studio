// ● Clip (stage 1 decided 2026-11-05, stage 2 decided 2026-11-05): the button in the top bar, Clip ⌄, the Before / After
// clip, and the line when the clip is saved. The rules are in clip-model.ts, the recording in the game page
// (bridge/play-clip.ts), the MP4 box in mp4.ts, the folder in src/server/clips.mjs. main.ts places the parts, forwards
// the game page's `studio:clip/*` messages, gives the game its tall window (shell.css [data-clip-shape]) and carries ✦
// Rewrite's small request to the AI.
//
// The flow (one press):
//   ● Clip → Play first if in Edit (a paused game resumes) → the next 8 s (6 / 8 / 12 in ⌄) are recorded: the button is red
//   "0:03 · Stop", the game has a red frame (only what is inside it is in the clip) and a thin bar of the time left. A
//   second press stops early (one more second for the mark, cut at the press: play-clip.ts). Then the line, where the
//   AI's line is:
//     row 1: ✓ Clip saved · neon-run-clip-1.mp4 / 8 s · Wide 1280×720 · Movies › KUMODeck · Show in Finder · Remove mark · ✕
//     row 2: the post (English, the same words with no AI) · 102 / 280 · Copy post · ✦ Rewrite
//   The web demo has no folder: the clip is a download, and its line says so.
// Stage 2:
//   - ● Clip Before / After, from the paused ask's Before / After panel (moment-try.ts; main.ts openCompare): the asked
//     frame still for 2 s ("Before", the asked words) → a wipe → the same moment with the new code, played 7 s ("After")
//     → the mark's second. The game is the Try's, paused at the moment: it resumes once the still part is encoded.
//   - Wide / Tall in ⌄ (a phone records Tall until the person chooses): Tall gives the game a 9:16 window while recording.
//   - ✦ Rewrite: the post rewritten by the person's AI (a small `clip-post` request), checked (X's count, the address
//     per the mark) before it replaces the post. Not there when no AI is connected (the web demo, nobody watching).
//   - A phone: Share… (the system's share sheet with the MP4, Web Share) instead of Show in Finder — the MP4 is on the
//     computer, the person is on the phone; a phone that cannot share files gets Save (a download) instead.
// WHY no key (⌘K lists it instead): while playing, the keys are the game's (keymap.ts); a letter would fight its controls.
// WHY the next seconds, not the last ones: recording all through ▶ Play costs heat and battery, and a clip that only
// starts on a press never records what the person did not mean to show.
import type { BridgeToShell, ShellToBridge, StudioHost } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { MenuEntry } from './context-menu.ts';
import {
  BA_AFTER_SECONDS, BA_BEFORE_MS, BA_STILL_FPS, BA_WIPE_MS, CLIP_BITRATE, CLIP_CODEC, CLIP_FPS, CLIP_LENGTHS, CLIP_MARK_LINES, CLIP_SHAPES, X_LIMIT,
  baWords, beforeAfterPost, beforeAfterStem, checkRewrite, clipShapeFor, clipSize, clipStem, downloadName, postText, recClock, withAddress, xLength,
  type ClipPrefs, type ClipRefusal, type ClipShape,
} from './clip-model.ts';
import { muxMp4, type Mp4Sample } from './mp4.ts';

/** What ✦ Rewrite tells the AI with the post (StudioRequestInput.clip). */
export interface ClipPostContext {
  seconds: number;
  shape: ClipShape;
  mark: boolean;
  /** A Before / After: what the person asked (their words, when they keep them on). */
  asked?: string;
}

export interface ClipDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  host: StudioHost;
  post(m: ShellToBridge): void;
  playing(): boolean;
  paused(): boolean;
  /** Start ▶ Play (Play's own choice window and all); resolves true once the game page is playing, false if it isn't. */
  play(): Promise<boolean>;
  resume(): void;
  game(): string;
  prefs(): ClipPrefs;
  setPrefs(p: ClipPrefs): void;
  menu(at: HTMLElement, rows: MenuEntry[]): void;
  toast(text: string, ms?: number): void;
  /** The state, for the page (data-clip on the shell: the red frame, the tall window, tests). */
  changed(state: ClipState, shape: ClipShape): void;
  /** The phone layout (Tall by default, Share… instead of Show in Finder). */
  phone(): boolean;
  /** Is an AI there to rewrite the post (the local host, an AI watching)? false = no ✦ Rewrite. */
  aiReady(): boolean;
  /** The AI's name for the post's words ("Claude", "Codex", "my AI": English, the post is). */
  aiName(): string;
  /** ✦ Rewrite: the post to the AI as a small request; resolves with its reply (the new post), or null (none came). */
  rewrite(text: string, ctx: ClipPostContext): Promise<string | null>;
}

export type ClipState = 'idle' | 'starting' | 'rec' | 'saving';

/** A Before / After to make (main.ts openCompare): the asked frame, the words, the ask's second. */
export interface BeforeAfterInput {
  /** The asked frame, marks drawn on (a data URL). */
  before: string;
  asked: string;
  /** The ask's second in the game (s). */
  time: number;
  /** The person had marks on the frame. */
  marked: boolean;
}

/** What was saved, kept for the line's buttons (Show in Finder, the swap, Share…, ✦ Rewrite). */
interface Saved {
  name: string;
  /** Where it is ('movies' | 'videos'), or 'downloads' in the web demo. */
  where: string;
  reveal?: 'finder' | 'folder';
  seconds: number;
  shape: ClipShape;
  mark: boolean;
  /** The other end, ready to swap in without recording again (null: the second encoder's setup differed). */
  other: Uint8Array | null;
  file: Uint8Array;
  /** The post as shown; `postFor` writes it again for the other mark; `rewritten`: the AI's words (the address follows the mark). */
  post: string;
  postFor: (mark: boolean) => string;
  rewritten: boolean;
  rewriting: boolean;
  ctx: ClipPostContext;
}

export function createClip(d: ClipDeps) {
  const { t } = d;
  let state: ClipState = 'idle';
  let id = '';
  let startedAt = 0;
  let clock: number | undefined;
  let total = 0;
  let wanted: ClipPrefs = d.prefs();
  let shape: ClipShape = clipShapeFor(wanted, false);
  /** The clip being made is a Before / After (its words and post), else null. */
  let ba: BeforeAfterInput | null = null;
  let main: Mp4Sample[] = [];
  let alt: Mp4Sample[] = [];
  let avcc: Uint8Array | null = null;
  let altAvcc: Uint8Array | null = null;
  let saved: Saved | null = null;
  /** When the game page last said something about this clip: a page that went (Reload, Play from the start) says nothing more. */
  let heard = 0;
  /** No word from the game page for this long while recording: the clip is given up, and said so. */
  const SILENT_MS = 8000;

  // ----- the button: ● Clip | ⌄ (one capsule, like ▶ Play ⌄) -----
  const label = h('span', { class: 'clip-label' });
  const btn = h('button', { type: 'button', class: 'clip-btn', dataset: { action: 'clip', part: 'clip' }, onclick: (e: MouseEvent) => void press(e.timeStamp) },
    h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), label);
  const more = h('button', { type: 'button', class: 'clip-more', dataset: { action: 'clip-more', part: 'clip-more' }, 'aria-haspopup': 'menu', onclick: () => openMenu() });
  more.append(icon('chevronDown'));
  const el = h('div', { class: 'clip-split', dataset: { part: 'clip-split' } }, btn, more);
  // The time left, a thin bar under the game's frame while recording (main.ts puts it in the stage).
  const bar = h('div', { class: 'clip-time', 'aria-hidden': 'true', dataset: { part: 'clip-time' } }, h('span'));

  // ----- the line when it is saved (main.ts puts it where the AI's line is) -----
  const line = h('div', { class: 'clip-line', role: 'status', 'aria-live': 'polite', hidden: true, dataset: { part: 'clip-line' } });

  function setState(s: ClipState) {
    state = s;
    d.changed(s, shape);
    render();
  }

  function render() {
    const recording = state === 'rec' || state === 'starting';
    btn.classList.toggle('on', recording);
    btn.disabled = state === 'saving';
    more.hidden = recording;
    label.textContent = recording ? t('clip.stop', { t: recClock(state === 'rec' ? performance.now() - startedAt : 0) }) : t('clip.btn');
    btn.title = recording ? t('clip.stopTip') : t('clip.tip', { s: wanted.seconds });
    btn.setAttribute('aria-label', btn.title);
    more.title = t('clip.more');
    more.setAttribute('aria-label', t('clip.more'));
    bar.hidden = !recording;
  }

  function openMenu() {
    const p = d.prefs();
    const dir = d.host.clips ? t(placeKey(navigator.platform)) : t('clip.dir.downloads');
    const now = clipShapeFor(p, d.phone());
    const rows: MenuEntry[] = [{ head: t('clip.shape') }];
    for (const sh of CLIP_SHAPES) {
      rows.push({ id: `clip-${sh}`, label: t(`clip.shape.${sh}`), checked: now === sh, run: () => (d.setPrefs({ ...d.prefs(), shape: sh }), (wanted = d.prefs()), render()) });
    }
    rows.push({ sep: true }, { head: t('clip.length') });
    for (const s of CLIP_LENGTHS) {
      rows.push({ id: `clip-${s}`, label: t('clip.lengthRow', { s }), checked: p.seconds === s, run: () => (d.setPrefs({ ...d.prefs(), seconds: s }), (wanted = d.prefs()), render()) });
    }
    rows.push({ sep: true },
      { id: 'clip-mark', label: t('clip.mark'), checked: p.mark, run: () => (d.setPrefs({ ...d.prefs(), mark: !d.prefs().mark }), (wanted = d.prefs())) },
      { id: 'clip-words', label: t('clip.words'), checked: p.words, run: () => (d.setPrefs({ ...d.prefs(), words: !d.prefs().words }), (wanted = d.prefs())) },
      { sep: true }, { note: `${t('clip.saveTo', { dir })} ${t('clip.local')}` });
    d.menu(more, rows);
  }

  /**
   * The game's window takes its new shape (Tall) before the first frame: its resize and a few of its frames. A timer
   * only — WHY not this page's requestAnimationFrame: it stops in a tab that is not in front (a screen test's second
   * page waited 20 s), and the frames that matter are the game page's, not this one's.
   */
  const settle = () => new Promise<void>((ok) => window.setTimeout(ok, 500));

  function reset() {
    id = `clip-${Date.now().toString(36)}`;
    main = [];
    alt = [];
    avcc = null;
    altAvcc = null;
  }

  /**
   * ● Clip pressed (the button, ⌘K). `pressedAt`: the click's own time (Event.timeStamp, this page's clock), when there
   * is one — WHY not performance.now() here: on a busy machine the editor page and a same-site game share one thread, so
   * this handler itself runs late (the web demo's 1 s press came out 3.9 s); the event is stamped when the click happened.
   */
  async function press(pressedAt?: number) {
    if (state === 'rec') {
      // `at`: the press on the clock both pages share (see contract studio:clip/stop) — the clip is cut here, however
      // late the busy game page reads it.
      const at = typeof pressedAt === 'number' && pressedAt > 0 && pressedAt <= performance.now() ? pressedAt : performance.now();
      d.post({ type: 'studio:clip/stop', id, at: performance.timeOrigin + at });
      return;
    }
    if (state !== 'idle') return;
    if (typeof (window as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') {
      d.toast(t('clip.noEncoder'), 7000);
      return;
    }
    wanted = d.prefs();
    shape = clipShapeFor(wanted, d.phone());
    ba = null;
    setState('starting');
    if (!d.playing() && !(await d.play())) {
      setState('idle');
      return;
    }
    if (d.paused()) d.resume();
    if (shape === 'tall') await settle();
    if (state !== 'starting') return;
    reset();
    const { w, h: hh } = clipSize(shape);
    d.post({ type: 'studio:clip/start', id, seconds: wanted.seconds, fps: CLIP_FPS, w, h: hh, codec: CLIP_CODEC, bitrate: CLIP_BITRATE,
      mark: wanted.mark, lines: [...CLIP_MARK_LINES] });
    waitStarted(5000);
  }

  /**
   * ● Clip Before / After (stage 2): from the Before / After panel, the game paused at the Try's moment. The still part
   * is encoded first by the game page; it says `started` then, and the game resumes (startedNow).
   */
  async function beforeAfter(o: BeforeAfterInput) {
    if (state !== 'idle' || !d.playing()) return;
    if (typeof (window as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') {
      d.toast(t('clip.noEncoder'), 7000);
      return;
    }
    wanted = d.prefs();
    shape = clipShapeFor(wanted, d.phone());
    ba = o;
    setState('starting');
    let image: ArrayBuffer;
    try {
      image = await (await fetch(o.before)).arrayBuffer();
    } catch (e) {
      ba = null;
      setState('idle');
      d.toast(t('clip.failed', { msg: (e as Error).message }), 6000);
      return;
    }
    if (shape === 'tall') await settle();
    if (state !== 'starting') return;
    reset();
    const { w, h: hh } = clipSize(shape);
    const words = wanted.words ? baWords(o.asked) : '';
    d.post({ type: 'studio:clip/start', id, seconds: BA_BEFORE_MS / 1000 + BA_AFTER_SECONDS, fps: CLIP_FPS, w, h: hh, codec: CLIP_CODEC, bitrate: CLIP_BITRATE,
      mark: wanted.mark, lines: [...CLIP_MARK_LINES],
      // "Before" / "After" in English whatever the editor's language: the video goes to X (as the mark's lines).
      before: { image, ms: BA_BEFORE_MS, wipeMs: BA_WIPE_MS, label: 'Before', after: 'After', stillFps: BA_STILL_FPS, ...(words ? { words } : {}) } });
    // The still part is encoded before `started`: on a slow machine that is a few seconds.
    waitStarted(20000);
  }

  /** Nothing back from the game page (an old bridge, a page that went): give up after a while. */
  function waitStarted(ms: number) {
    clock = window.setTimeout(() => {
      if (state === 'starting') (setState('idle'), d.toast(t('clip.failed', { msg: 'no answer from the game' }), 6000));
    }, ms);
  }

  /** A `studio:clip/*` message from the game page; true when it was one. */
  function onMessage(m: BridgeToShell): boolean {
    if (!m.type.startsWith('studio:clip/')) return false;
    if (!('id' in m) || m.id !== id) return true;
    heard = performance.now();
    switch (m.type) {
      case 'studio:clip/started':
        window.clearTimeout(clock);
        total = m.total;
        startedAt = performance.now();
        setState('rec');
        // A Before / After: the Try's paused moment goes on now (its still part is in the clip already).
        if (ba && d.paused()) d.resume();
        clock = window.setInterval(() => {
          label.textContent = t('clip.stop', { t: recClock(performance.now() - startedAt) });
          if (performance.now() - heard > SILENT_MS) {
            window.clearInterval(clock);
            id = '';
            setState('idle');
            d.toast(t('clip.failed', { msg: 'the game page went' }), 6000);
          }
        }, 250);
        (bar.firstElementChild as HTMLElement).style.width = '0%';
        break;
      case 'studio:clip/progress':
        total = m.total;
        (bar.firstElementChild as HTMLElement).style.width = `${Math.min(100, (m.done / Math.max(1, m.total)) * 100)}%`;
        break;
      case 'studio:clip/config':
        if (m.alt) altAvcc = new Uint8Array(m.avcc);
        else avcc = new Uint8Array(m.avcc);
        break;
      case 'studio:clip/chunk':
        (m.alt ? alt : main).push({ data: new Uint8Array(m.data), key: m.key, ts: m.ts, dur: m.dur });
        break;
      case 'studio:clip/done':
        window.clearInterval(clock);
        void finish(m.seconds, m.markAt);
        break;
      case 'studio:clip/error':
        window.clearInterval(clock);
        window.clearTimeout(clock);
        setState('idle');
        d.toast(refusal(m.why, m.msg), 8000);
        break;
    }
    return true;
  }

  function refusal(why: ClipRefusal, msg?: string) {
    if (why === 'webgpu') return t('clip.webgpu');
    if (why === 'tainted') return t('clip.tainted');
    if (why === 'no-encoder') return t('clip.noEncoder');
    if (why === 'nothing') return t('clip.nothing');
    return t('clip.failed', { msg: msg || '?' });
  }

  async function finish(length: number, markAt: number) {
    setState('saving');
    const seconds = Math.round(length * 10) / 10;
    const { w, h: hh } = clipSize(shape);
    let file: Uint8Array;
    let other: Uint8Array | null = null;
    try {
      main.sort((a, b) => a.ts - b.ts);
      alt.sort((a, b) => a.ts - b.ts);
      if (!avcc || !main.length) throw new Error('no video');
      const endUs = Math.round(length * 1e6);
      file = muxMp4({ width: w, height: hh, avcc, samples: main, endUs });
      // The other end: the frames before the mark's second, then the second encoder's. Only when both encoders set up
      // the same way (the same SPS / PPS), so one MP4 header describes both — nearly always in one browser, checked.
      const cut = markAt - 1;
      if (altAvcc && sameBytes(altAvcc, avcc) && alt.length && alt[0]!.key) {
        other = muxMp4({ width: w, height: hh, avcc, samples: [...main.filter((s) => s.ts < cut), ...alt], endUs });
      }
    } catch (e) {
      setState('idle');
      d.toast(t('clip.failed', { msg: (e as Error).message }), 8000);
      return;
    }
    main = [];
    alt = [];
    const made = ba;
    ba = null;
    const stem = made ? beforeAfterStem(d.game()) : clipStem(d.game());
    const ok = await store(file, null, stem);
    if (!ok) return setState('idle');
    const words = wanted.words;
    const postFor = made
      ? (mk: boolean) => beforeAfterPost({ time: made.time, asked: made.asked, mark: mk, words, marked: made.marked, ai: d.aiName() })
      : (mk: boolean) => postText({ game: d.game(), seconds, mark: mk });
    const ctx: ClipPostContext = { seconds, shape, mark: wanted.mark, ...(made && words ? { asked: baWords(made.asked) } : {}) };
    saved = { ...ok, seconds, shape, mark: wanted.mark, other, file, post: postFor(wanted.mark), postFor, rewritten: false, rewriting: false, ctx };
    setState('idle');
    showLine();
  }

  /** Save (the server's folder) or download (the web demo). `replace` = the name of the clip saved before. */
  async function store(file: Uint8Array, replace: string | null, stem: string): Promise<{ name: string; where: string; reveal?: 'finder' | 'folder' } | null> {
    const blob = new Blob([file as BlobPart], { type: 'video/mp4' });
    if (!d.host.clips) {
      const name = replace ?? downloadName(d.game(), new Date()).replace(/-clip-/, stem.endsWith('-before-after') ? '-before-after-' : '-clip-');
      download(blob, name);
      return { name, where: 'downloads' };
    }
    const r = await d.host.clips.save(blob, replace ? { replace } : { stem });
    if (!r.ok) {
      d.toast(t('clip.saveFailed', { msg: r.error }), 8000);
      return null;
    }
    return { name: r.name, where: r.where, reveal: r.reveal };
  }

  function download(blob: Blob, name: string) {
    const a = h('a', { href: URL.createObjectURL(blob), download: name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }

  /** The saved clip as a File, for Share… (Web Share takes files). */
  const asFile = (s: Saved) => new File([s.file as BlobPart], s.name, { type: 'video/mp4' });
  /** Can this browser hand a video file to the system's share sheet? (Phones: Safari, Chrome on Android.) */
  function canShare(s: Saved): boolean {
    const n = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof n.share !== 'function' || typeof n.canShare !== 'function') return false;
    try {
      return n.canShare({ files: [asFile(s)] });
    } catch {
      return false;
    }
  }

  function showLine() {
    if (!saved) return;
    const s = saved;
    const post = s.post;
    const n = xLength(post);
    const where = t(`clip.dir.${s.where}`);
    const head = h('div', { class: 'clip-row' },
      h('span', { class: 'clip-head' }, icon('check'), h('strong', { text: t(s.where === 'downloads' ? 'clip.downloaded' : 'clip.saved', { name: s.name }) })),
      h('span', { class: 'clip-where', text: t('clip.where', { s: s.seconds, shape: t(`clip.shape.${s.shape}`), dir: where }) }));
    // A phone (stage 2): the clip is on the computer (or a download), the person on the phone — Share… hands the MP4 to
    // the phone's share sheet (X's app is in it); a phone that cannot share files saves it (a download) instead. Show in
    // Finder would open a window on the computer, out of sight.
    if (d.phone()) {
      if (canShare(s)) {
        head.append(h('button', { type: 'button', class: 'link primary', dataset: { action: 'clip-share' }, text: t('clip.share'), onclick: () => void share(s) }));
      } else if (s.where !== 'downloads') {
        head.append(h('button', { type: 'button', class: 'link', dataset: { action: 'clip-save' }, text: t('clip.saveHere'),
          onclick: () => download(new Blob([s.file as BlobPart], { type: 'video/mp4' }), s.name) }));
      }
    } else if (s.reveal && d.host.clips) {
      head.append(h('button', { type: 'button', class: 'link', dataset: { action: 'clip-reveal' }, text: t(s.reveal === 'finder' ? 'clip.finder' : 'clip.folder'),
        onclick: () => void d.host.clips!.reveal(s.name).then((r) => !r.ok && d.toast(t('clip.saveFailed', { msg: r.error || '?' }), 6000)) }));
    }
    if (s.other) {
      head.append(h('button', { type: 'button', class: 'link', dataset: { action: 'clip-mark' }, text: t(s.mark ? 'clip.markRemove' : 'clip.markAdd'), onclick: () => void swap() }));
    }
    head.append(h('button', { type: 'button', class: 'icon-only link clip-x', dataset: { action: 'clip-close' }, title: t('clip.close'), 'aria-label': t('clip.close'),
      onclick: () => ((line.hidden = true), (saved = null)) }, icon('close')));
    const copyBtn = h('button', { type: 'button', class: 'link', dataset: { action: 'clip-copy' }, text: t('clip.copy'), onclick: () => void copy(s.post, copyBtn) });
    const draft = h('div', { class: 'clip-row clip-post' },
      h('span', { class: 'clip-x-mark', 'aria-hidden': 'true', text: '𝕏' }),
      h('span', { class: 'clip-text', dataset: { part: 'clip-post' }, title: post, text: post }),
      h('span', { class: `clip-count${n > X_LIMIT ? ' over' : ''}`, dataset: { part: 'clip-count' }, text: t('clip.count', { n }) }),
      copyBtn);
    // ✦ Rewrite (stage 2): only with an AI to ask (the plan: "not shown when no AI is connected").
    if (d.aiReady() || s.rewriting) {
      draft.append(h('button', { type: 'button', class: 'link spark', dataset: { action: 'clip-rewrite' }, disabled: s.rewriting, title: t('clip.rewriteTip'),
        onclick: () => void rewrite() }, icon('spark'), h('span', { text: t(s.rewriting ? 'clip.rewriting' : 'clip.rewrite') })));
    }
    line.replaceChildren(head, draft);
    line.hidden = false;
  }

  /** "Remove mark" / "Add mark": the other end swapped in, saved over the same clip, and remembered for the next ones. */
  async function swap() {
    if (!saved?.other) return;
    const s = saved;
    const next = !s.mark;
    const ok = await store(s.other, s.name, '');
    if (!ok) return;
    // The post follows the mark: written again (the editor's words), or the AI's words with the address put right.
    const post = s.rewritten ? withAddress(s.post, next) : s.postFor(next);
    saved = { ...s, name: ok.name, mark: next, file: s.other, other: s.file, post, ctx: { ...s.ctx, mark: next } };
    d.setPrefs({ ...d.prefs(), mark: next });
    wanted = d.prefs();
    showLine();
    d.toast(t(next ? 'clip.markOn' : 'clip.markOff'), 5000);
  }

  /** ✦ Rewrite: the AI's version of the post, checked (X's count, the address per the mark) before it is shown. */
  async function rewrite() {
    const s = saved;
    if (!s || s.rewriting) return;
    s.rewriting = true;
    showLine();
    const reply = await d.rewrite(s.post, { ...s.ctx, mark: s.mark }).catch(() => null);
    s.rewriting = false;
    if (saved !== s) return; // closed, or another clip since
    const c = checkRewrite(reply, s.mark);
    if (c.ok) {
      s.post = c.text;
      s.rewritten = true;
      d.toast(t('clip.rewritten'), 4000);
    } else d.toast(t(reply == null ? 'clip.rewriteNone' : c.why === 'long' ? 'clip.rewriteLong' : 'clip.rewriteEmpty', { n: c.n }), 7000);
    showLine();
  }

  async function share(s: Saved) {
    try {
      await navigator.share({ files: [asFile(s)], text: s.post });
    } catch (e) {
      // Closed by the person (AbortError): nothing to say. Anything else: the one line, and they can Save instead.
      if ((e as Error)?.name !== 'AbortError') d.toast(t('clip.shareFailed', { msg: (e as Error)?.message || '?' }), 6000);
    }
  }

  async function copy(text: string, b: HTMLButtonElement) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // No clipboard permission (an http page on another machine): the old way, a selected field.
      const ta = h('textarea', { class: 'clip-copy-src' });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (ok) {
      b.textContent = t('clip.copied');
      window.setTimeout(() => (b.textContent = t('clip.copy')), 2000);
    }
  }

  let wasReady = false;
  render();
  return {
    el,
    bar,
    line,
    press: () => void press(),
    beforeAfter: (o: BeforeAfterInput) => void beforeAfter(o),
    onMessage,
    render,
    /** The AI came or went (main.ts's status poll): the line's ✦ Rewrite with it. */
    aiChanged() {
      const r = d.aiReady();
      if (r === wasReady) return;
      wasReady = r;
      if (saved && !line.hidden) showLine();
    },
    get state() {
      return state;
    },
    get shape() {
      return shape;
    },
    /** For tests: the last saved clip's bytes. */
    _last: () => saved?.file ?? null,
  };
}

/** The folder's words for this system: macOS Movies, elsewhere Videos (the server says it too, once a clip is saved). */
function placeKey(platform: string) {
  return /mac/i.test(platform) ? 'clip.dir.movies' : 'clip.dir.videos';
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
