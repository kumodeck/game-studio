// ● Clip (stage 1 decided 2026-11-05, stage 2 decided 2026-11-05): the button in the top bar, Clip ⌄, the Before / After
// clip, and the line when the clip is saved. The rules are in clip-model.ts, the recording in the game page
// (bridge/play-clip.ts), the MP4 box in mp4.ts, the folder in src/server/clips.mjs. main.ts places the parts, forwards
// the game page's `studio:clip/*` messages, gives the game its tall window (shell.css [data-clip-shape]) and carries ✦
// Rewrite's small request to the AI.
//
// The flow (one press):
//   ● Clip → Play first if in Edit (a paused game resumes) → the next 8 s (6 / 8 / 12 in ⌄) are recorded: the button is red
//   "0:05 left · Stop" (studio-clip-3; it counted up before), the game has a red frame (only what is inside it is in the clip) and a thin bar of the time left. A
//   second press stops early (one more second for the mark, cut at the press: play-clip.ts). Then the line, where the
//   AI's line is:
//     row 1: ✓ Saved to Movies › KUMODeck (the file's name in its tooltip) / 8 s · Wide 1280×720 ⌄ · Show in Finder ·
//            Remove “Made with” · ✕   (walk 2 △9, decided 2026-11-06: was "Clip saved · <name>", both cut)
//     row 2: the post (the editor's language since walk 2 △11; no AI) · 102 / 280 · Copy post · ✦ Rewrite
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
// studio-clip-3 (decided 2026-11-06, the first things a person meets after the announcement):
//   - While recording the button says the time LEFT ("0:05 left · Stop"), then "Ending…" after Stop (the mark's second),
//     "Saving…" while the MP4 is written; a phone's round ● shows the seconds left ("5") instead of a bare dot.
//   - A phone's ● has no ⌄ (no room in the bar): holding ● (or a right-click anywhere) opens Clip options, and the saved
//     line's "8 s · Tall 720×1280 ⌄" opens them too, for the next clip — the same words as ⌄ on a computer.
//   - Post on X… (computer): X's compose page with the post written, and the clip shown in its folder — one press and
//     one drag, where it was Copy post, open X, paste, Show in Finder, drag.
//   - A picture from another site (and WebGPU from a bridge before stage 3): the line says what to do next, with "✦ Ask
//     Claude" to put the request in the field (not sent: the person sends it).
// Stage 3 (decided 2026-11-07):
//   - The game's sound in the clip (Clip options › "Record the game’s sound", on by default): the bridge sends it as AAC
//     before `done`, and both ends of the clip carry the same sound track. A game that made no sound gets no track; a
//     browser that cannot encode AAC saves the clip without sound and the line says so, with what to use instead.
//   - WebGPU games record (play-clip.ts takes their picture in their own frame).
// WHY no key (⌘K lists it instead): while playing, the keys are the game's (keymap.ts); a letter would fight its controls.
// WHY the next seconds, not the last ones: recording all through ▶ Play costs heat and battery, and a clip that only
// starts on a press never records what the person did not mean to show.
import type { BridgeToShell, ShellToBridge, StudioHost } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { MenuEntry } from './context-menu.ts';
import {
  BA_ADDS_SECONDS, BA_BEFORE_MS, BA_STILL_FPS, BA_WIPE_MS, CLIP_BITRATE, CLIP_CODEC, CLIP_FPS, CLIP_HOLD_MS, CLIP_LENGTHS, CLIP_MARK_LINES, CLIP_SHAPES, X_LIMIT,
  baSeconds, baWords, beforeAfterPost, beforeAfterStem, checkRewrite, clipShapeFor, clipSize, clipStem, downloadName, leftClock, postText, recLeftMs, withAddress, xComposeUrl, xLength,
  type ClipPrefs, type ClipRefusal, type ClipShape, type PostSay,
} from './clip-model.ts';
import { soundNoteKey, type ClipSoundState } from './clip-sound-model.ts';
import { muxMp4, type Mp4Audio, type Mp4Sample } from './mp4.ts';

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
  /** Put a request for the AI in the field (not sent), the game paused to show it; absent = no AI here (the web demo). */
  ask?(text: string): void;
  /** The state, for the page (data-clip on the shell: the red frame, the tall window, tests). */
  changed(state: ClipState, shape: ClipShape): void;
  /** The phone layout (Tall by default, Share… instead of Show in Finder). */
  phone(): boolean;
  /** Is an AI there to rewrite the post (the local host, an AI watching)? false = no ✦ Rewrite. */
  aiReady(): boolean;
  /** The AI's name for the post's words ("Claude", "Codex", "my AI"; in the post's language). */
  aiName(): string;
  /**
   * The post's words when the editor is not in English (walk 2 △11, decided 2026-11-06): the editor's translate() for
   * the `clip.post.*` keys; null = English (clip-model.ts writes it). Asked when the clip is saved: the language then.
   */
  postSay?(): PostSay | null;
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
  /** Stop was pressed: the clip runs one second more (the mark), the button says "Ending…". */
  let stopping = false;
  /** The clip's whole length (ms) and its still part (a Before / After's 2 s, encoded before `started`). */
  let lengthMs = 0;
  let stillMs = 0;
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
  /** Stage 3: the game's sound for this clip (`studio:clip/sound`, before `done`), null = the clip has none. */
  let audio: Mp4Audio | null = null;
  let saved: Saved | null = null;
  /** When the game page last said something about this clip: a page that went (Reload, Play from the start) says nothing more. */
  let heard = 0;
  /** No word from the game page for this long while recording: the clip is given up, and said so. */
  const SILENT_MS = 8000;

  // ----- the button: ● Clip | ⌄ (one capsule, like ▶ Play ⌄) -----
  const label = h('span', { class: 'clip-label' });
  // A phone's round ● while recording: the whole seconds left ("5"), where the computer's button has its words.
  const leftNum = h('span', { class: 'clip-left', 'aria-hidden': 'true', dataset: { part: 'clip-left' } });
  const btn = h('button', { type: 'button', class: 'clip-btn', dataset: { action: 'clip', part: 'clip' }, onclick: (e: MouseEvent) => {
    // The press that opened Clip options by holding is not also a ● Clip.
    if (held) return void (held = false);
    void press(e.timeStamp);
  } }, h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), leftNum, label);
  const more = h('button', { type: 'button', class: 'clip-more', dataset: { action: 'clip-more', part: 'clip-more' }, 'aria-haspopup': 'menu', onclick: () => openMenu(more) });
  // Holding ● opens Clip options (studio-clip-3): a phone has no ⌄. Opened when the finger LIFTS — WHY: Chrome's own
  // long-press sends a contextmenu while the finger is still down, and with the menu already open that landed on the
  // menu's outside catcher and closed it at once (the phone screen test). A timer of our own too, not only contextmenu:
  // iOS Safari sends none for a held button. A right-click (contextmenu with no finger down) opens it at once.
  let held = false;
  let pressing = false;
  let holdTimer = 0;
  btn.addEventListener('pointerdown', (e: PointerEvent) => {
    held = false;
    window.clearTimeout(holdTimer);
    if (state !== 'idle' || e.button > 0) return;
    pressing = true;
    holdTimer = window.setTimeout(() => (held = true), CLIP_HOLD_MS);
  });
  const lift = () => {
    window.clearTimeout(holdTimer);
    if (!pressing) return;
    pressing = false;
    // After the click this lift makes (which `held` swallows), so the menu is not closed by it.
    if (held) window.setTimeout(() => state === 'idle' && openMenu(btn), 0);
  };
  btn.addEventListener('pointerup', lift);
  btn.addEventListener('pointercancel', lift);
  btn.addEventListener('contextmenu', (e: Event) => {
    e.preventDefault();
    if (pressing) held = true;
    else if (state === 'idle') openMenu(btn);
  });
  const el = h('div', { class: 'clip-split', dataset: { part: 'clip-split' } }, btn, more);
  // The time left, a thin bar under the game's frame while recording (main.ts puts it in the stage).
  const bar = h('div', { class: 'clip-time', 'aria-hidden': 'true', dataset: { part: 'clip-time' } }, h('span'));

  // ----- the line when it is saved (main.ts puts it where the AI's line is) -----
  const line = h('div', { class: 'clip-line', role: 'status', 'aria-live': 'polite', hidden: true, dataset: { part: 'clip-line' } });
  // The clip's own one-line notes (a refusal, "X opened…", "Mark removed…") in the line's place on the stage, under the
  // saved rows when there are some (studio-clip-3, decided 2026-11-06). WHY not the editor's toast: it lives in the dock
  // at the foot, which is put away while the game plays — and a clip is made while playing, so its refusals ("this game
  // draws with WebGPU") and every note after a clip were never seen (found by the screen test of a refusal).
  const note = h('div', { class: 'clip-row clip-note', hidden: true, dataset: { part: 'clip-note' } });
  let noteTimer = 0;
  function say(text: string, ms = 6000, actions?: Array<{ label: string; run(): void }>) {
    window.clearTimeout(noteTimer);
    const acts = (actions ?? []).map((a) => h('button', { type: 'button', class: `link${a.label.startsWith('✦') ? ' spark' : ''}`, dataset: { action: 'clip-note-act' },
      text: a.label, onclick: () => (hideNote(), a.run()) }));
    note.replaceChildren(h('span', { class: 'clip-note-text', text }), ...acts,
      // Alone (no saved rows above it): its own ✕.
      ...(saved && !line.hidden ? [] : [h('button', { type: 'button', class: 'icon-only link clip-x', dataset: { action: 'clip-note-close' }, title: t('clip.close'),
        'aria-label': t('clip.close'), onclick: () => hideNote() }, icon('close'))]));
    note.hidden = false;
    if (!(saved && !line.hidden)) line.replaceChildren(note);
    else if (note.parentElement !== line) line.append(note);
    line.hidden = false;
    noteTimer = window.setTimeout(hideNote, ms);
  }
  function hideNote() {
    window.clearTimeout(noteTimer);
    note.hidden = true;
    // The note alone was the line: put it away too.
    if (!line.querySelector('.clip-row:not(.clip-note)')) line.hidden = true;
  }

  function setState(s: ClipState) {
    state = s;
    d.changed(s, shape);
    render();
  }

  /** The time left (ms): the whole length while starting, then counted down from `started`. */
  const left = () => recLeftMs({ totalMs: lengthMs, stillMs, elapsedMs: state === 'rec' ? performance.now() - startedAt : 0 });

  function render() {
    const recording = state === 'rec' || state === 'starting';
    btn.classList.toggle('on', recording);
    btn.classList.toggle('saving', state === 'saving');
    btn.disabled = state === 'saving';
    more.hidden = recording || state === 'saving';
    const ms = left();
    label.textContent = state === 'saving' ? t('clip.saving') : recording ? (stopping ? t('clip.ending') : t('clip.stop', { t: leftClock(ms) })) : t('clip.btn');
    leftNum.textContent = recording && !stopping ? String(Math.ceil(ms / 1000)) : '';
    btn.title = recording ? t('clip.stopTip') : booted && d.phone() ? t('clip.holdTip', { s: wanted.seconds }) : t('clip.tip', { s: wanted.seconds });
    btn.setAttribute('aria-label', recording ? `${label.textContent} · ${t('clip.stopTip')}` : btn.title);
    more.title = t('clip.more');
    more.setAttribute('aria-label', t('clip.more'));
    bar.hidden = !recording;
  }

  /** Clip options (⌄, holding ●, the saved line's shape), under `at`. */
  function openMenu(at: HTMLElement) {
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
    // Before / After is the length chosen plus its 2 s still (walk 2 △10, decided 2026-11-06): said here, under the
    // lengths, because the menu said "8 seconds ✓" right after a Before / After whose line said 10 s.
    rows.push({ note: t('clip.baAdds', { s: BA_ADDS_SECONDS }) });
    rows.push({ sep: true },
      { id: 'clip-mark', label: t('clip.mark'), checked: p.mark, run: () => (d.setPrefs({ ...d.prefs(), mark: !d.prefs().mark }), (wanted = d.prefs())) },
      { id: 'clip-words', label: t('clip.words'), checked: p.words, run: () => (d.setPrefs({ ...d.prefs(), words: !d.prefs().words }), (wanted = d.prefs())) },
      // Stage 3 (decided 2026-11-07): the game's sound, on by default; one row, as the mark's.
      { id: 'clip-sound', label: t('clip.sound'), checked: p.sound, run: () => (d.setPrefs({ ...d.prefs(), sound: !d.prefs().sound }), (wanted = d.prefs())) },
      { sep: true }, { note: `${t('clip.saveTo', { dir })} ${t('clip.local')}` });
    d.menu(at, rows);
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
    audio = null;
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
      stopping = true;
      render();
      return;
    }
    if (state !== 'idle') return;
    if (typeof (window as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') {
      say(t('clip.noEncoder'), 7000);
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
    lengthMs = wanted.seconds * 1000;
    stillMs = 0;
    render();
    const { w, h: hh } = clipSize(shape);
    d.post({ type: 'studio:clip/start', id, seconds: wanted.seconds, fps: CLIP_FPS, w, h: hh, codec: CLIP_CODEC, bitrate: CLIP_BITRATE,
      mark: wanted.mark, lines: [...CLIP_MARK_LINES], sound: wanted.sound });
    waitStarted(5000);
  }

  /**
   * ● Clip Before / After (stage 2): from the Before / After panel, the game paused at the Try's moment. The still part
   * is encoded first by the game page; it says `started` then, and the game resumes (startedNow).
   */
  async function beforeAfter(o: BeforeAfterInput) {
    if (state !== 'idle' || !d.playing()) return;
    if (typeof (window as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') {
      say(t('clip.noEncoder'), 7000);
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
      say(t('clip.failed', { msg: (e as Error).message }), 6000);
      return;
    }
    if (shape === 'tall') await settle();
    if (state !== 'starting') return;
    reset();
    // The After plays the length chosen in Clip options (walk 2 △10): it was a fixed 8 s whatever was chosen.
    const total = baSeconds(wanted.seconds);
    lengthMs = total * 1000;
    stillMs = BA_BEFORE_MS;
    render();
    const { w, h: hh } = clipSize(shape);
    const words = wanted.words ? baWords(o.asked) : '';
    d.post({ type: 'studio:clip/start', id, seconds: total, fps: CLIP_FPS, w, h: hh, codec: CLIP_CODEC, bitrate: CLIP_BITRATE,
      mark: wanted.mark, lines: [...CLIP_MARK_LINES], sound: wanted.sound,
      // "Before" / "After" in English whatever the editor's language: the video goes to X (as the mark's lines).
      before: { image, ms: BA_BEFORE_MS, wipeMs: BA_WIPE_MS, label: 'Before', after: 'After', stillFps: BA_STILL_FPS, ...(words ? { words } : {}) } });
    // The still part is encoded before `started`: on a slow machine that is a few seconds.
    waitStarted(20000);
  }

  /** Nothing back from the game page (an old bridge, a page that went): give up after a while. */
  function waitStarted(ms: number) {
    clock = window.setTimeout(() => {
      if (state === 'starting') (setState('idle'), say(t('clip.failed', { msg: 'no answer from the game' }), 6000));
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
        if (total > 0) lengthMs = total;
        startedAt = performance.now();
        stopping = false;
        setState('rec');
        // A Before / After: the Try's paused moment goes on now (its still part is in the clip already).
        if (ba && d.paused()) d.resume();
        clock = window.setInterval(() => {
          render();
          if (performance.now() - heard > SILENT_MS) {
            window.clearInterval(clock);
            id = '';
            setState('idle');
            say(t('clip.failed', { msg: 'the game page went' }), 6000);
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
      case 'studio:clip/sound':
        audio = { rate: m.rate, channels: m.channels, asc: new Uint8Array(m.asc), samples: m.chunks.map((c) => ({ data: new Uint8Array(c.data), ts: c.ts, dur: c.dur })) };
        break;
      case 'studio:clip/done':
        window.clearInterval(clock);
        void finish(m.seconds, m.markAt, m.sound);
        break;
      case 'studio:clip/error': {
        window.clearInterval(clock);
        window.clearTimeout(clock);
        stopping = false;
        setState('idle');
        const r = refusal(m.why, m.msg);
        const ask = r.ask && d.ask && !d.host.offline ? d.ask : null;
        say(r.text, ask ? 12000 : 9000, ask ? [{ label: t('clip.askAi'), run: () => ask(r.ask!) }] : undefined);
        break;
      }
    }
    return true;
  }

  /** The refusal's line and, where the AI can fix the game, the request ✦ Ask puts in the field (studio-clip-3). */
  function refusal(why: ClipRefusal, msg?: string): { text: string; ask?: string } {
    if (why === 'webgpu') return { text: t('clip.webgpu'), ask: t('clip.askWebgpu') };
    if (why === 'tainted') return { text: t('clip.tainted'), ask: t('clip.askTainted') };
    if (why === 'no-encoder') return { text: t('clip.noEncoder') };
    if (why === 'nothing') return { text: t('clip.nothing') };
    return { text: t('clip.failed', { msg: msg || '?' }) };
  }

  async function finish(length: number, markAt: number, soundState?: ClipSoundState) {
    stopping = false;
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
      // The sound (stage 3) is the same track in both ends: only the picture's last second differs.
      const sound = soundState === 'on' ? audio : null;
      file = muxMp4({ width: w, height: hh, avcc, samples: main, endUs, audio: sound });
      // The other end: the frames before the mark's second, then the second encoder's. Only when both encoders set up
      // the same way (the same SPS / PPS), so one MP4 header describes both — nearly always in one browser, checked.
      const cut = markAt - 1;
      if (altAvcc && sameBytes(altAvcc, avcc) && alt.length && alt[0]!.key) {
        other = muxMp4({ width: w, height: hh, avcc, samples: [...main.filter((s) => s.ts < cut), ...alt], endUs, audio: sound });
      }
    } catch (e) {
      setState('idle');
      say(t('clip.failed', { msg: (e as Error).message }), 8000);
      return;
    }
    main = [];
    alt = [];
    audio = null;
    const made = ba;
    ba = null;
    const stem = made ? beforeAfterStem(d.game()) : clipStem(d.game());
    const ok = await store(file, null, stem);
    if (!ok) return setState('idle');
    const words = wanted.words;
    const say = d.postSay?.() ?? undefined;
    const postFor = made
      ? (mk: boolean) => beforeAfterPost({ time: made.time, asked: made.asked, mark: mk, words, marked: made.marked, ai: d.aiName(), say })
      : (mk: boolean) => postText({ game: d.game(), seconds, mark: mk, say });
    const ctx: ClipPostContext = { seconds, shape, mark: wanted.mark, ...(made && words ? { asked: baWords(made.asked) } : {}) };
    saved = { ...ok, seconds, shape, mark: wanted.mark, other, file, post: postFor(wanted.mark), postFor, rewritten: false, rewriting: false, ctx };
    setState('idle');
    showLine();
    // Saved without its sound (stage 3): one line under the saved rows, with what to do (another browser / try again).
    const noteKey = soundNoteKey(soundState);
    if (noteKey) say(t(noteKey), 10000);
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
      say(t('clip.saveFailed', { msg: r.error }), 8000);
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
    // "✓ Saved to Movies › KUMODeck" (walk 2 △9, decided 2026-11-06): where to look, whole. The row said "Clip saved ·
    // neon-run-a-boss-comes-in…" and "… · Movies…", the name and the folder both cut; the name is the tooltip now.
    const head = h('div', { class: 'clip-row' },
      h('span', { class: 'clip-head', title: s.name }, icon('check'), h('strong', { dataset: { part: 'clip-saved' }, text: t(s.where === 'downloads' ? 'clip.downloaded' : 'clip.saved', { dir: where }) })),
      // The shape and length as a button (studio-clip-3): Clip options for the next clip — a phone's way to them (its ●
      // has no ⌄), and on a computer the place the person is looking at right after a clip.
      h('button', { type: 'button', class: 'clip-where', dataset: { action: 'clip-options' }, 'aria-haspopup': 'menu', title: t('clip.whereTip'),
        onclick: (e: MouseEvent) => openMenu(e.currentTarget as HTMLElement) },
      h('span', { text: t('clip.where', { s: s.seconds, shape: t(`clip.shape.${s.shape}`) }) }), icon('chevronDown')));
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
        onclick: () => void d.host.clips!.reveal(s.name).then((r) => !r.ok && say(t('clip.saveFailed', { msg: r.error || '?' }), 6000)) }));
    }
    // Remove “Made with” (walk 2 △9): it said "Remove mark", and a person who had just put ◎ marks on the frame read it
    // as those (in Japanese both were the same word). It is the "Made with KUMODeck" at the clip's end and the address.
    if (s.other) {
      head.append(h('button', { type: 'button', class: 'link', dataset: { action: 'clip-mark' }, title: t('clip.mark'), text: t(s.mark ? 'clip.markRemove' : 'clip.markAdd'), onclick: () => void swap() }));
    }
    head.append(h('button', { type: 'button', class: 'icon-only link clip-x', dataset: { action: 'clip-close' }, title: t('clip.close'), 'aria-label': t('clip.close'),
      onclick: () => ((line.hidden = true), (saved = null), (note.hidden = true)) }, icon('close')));
    const copyBtn = h('button', { type: 'button', class: 'link', dataset: { action: 'clip-copy' }, text: t('clip.copy'), onclick: () => void copy(s.post, copyBtn) });
    const draft = h('div', { class: 'clip-row clip-post' },
      h('span', { class: 'clip-x-mark', 'aria-hidden': 'true', text: '𝕏' }),
      h('span', { class: 'clip-text', dataset: { part: 'clip-post' }, title: post, text: post }),
      h('span', { class: `clip-count${n > X_LIMIT ? ' over' : ''}`, dataset: { part: 'clip-count' }, text: t('clip.count', { n }) }));
    // Post on X… (studio-clip-3): a computer only — a phone's Share… hands X's app the video and the post together.
    if (!d.phone()) {
      draft.append(h('button', { type: 'button', class: 'link primary', dataset: { action: 'clip-post-x' }, title: t('clip.postXTip', { dir: where }), text: t('clip.postX'),
        onclick: () => postOnX(s, where) }));
    }
    draft.append(copyBtn);
    // ✦ Rewrite (stage 2): only with an AI to ask (the plan: "not shown when no AI is connected").
    if (d.aiReady() || s.rewriting) {
      draft.append(h('button', { type: 'button', class: 'link spark', dataset: { action: 'clip-rewrite' }, disabled: s.rewriting, title: t('clip.rewriteTip'),
        onclick: () => void rewrite() }, icon('spark'), h('span', { text: t(s.rewriting ? 'clip.rewriting' : 'clip.rewrite') })));
    }
    line.replaceChildren(head, draft, note);
    line.hidden = false;
  }

  /** Remove “Made with” / Add “Made with” (the mark): the other end swapped in, saved over the same clip, and remembered for the next ones. */
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
    say(t(next ? 'clip.markOn' : 'clip.markOff'), 5000);
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
      say(t('clip.rewritten'), 4000);
    } else say(t(reply == null ? 'clip.rewriteNone' : c.why === 'long' ? 'clip.rewriteLong' : 'clip.rewriteEmpty', { n: c.n }), 7000);
    showLine();
  }

  /**
   * Post on X…: X's compose page in a new tab with the post written (the press itself opens it: a browser lets a page
   * open a tab only from a click), and the clip shown in its folder to drag in. Nothing is sent from here: X shows the
   * post and the person posts it.
   */
  function postOnX(s: Saved, where: string) {
    window.open(xComposeUrl(s.post), '_blank', 'noopener');
    if (s.reveal && d.host.clips) void d.host.clips.reveal(s.name).catch(() => null);
    say(t('clip.postXOpened', { dir: where }), 8000);
  }

  async function share(s: Saved) {
    try {
      await navigator.share({ files: [asFile(s)], text: s.post });
    } catch (e) {
      // Closed by the person (AbortError): nothing to say. Anything else: the one line, and they can Save instead.
      if ((e as Error)?.name !== 'AbortError') say(t('clip.shareFailed', { msg: (e as Error)?.message || '?' }), 6000);
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
  // `booted`: the first render runs while the editor is still being built (main.ts's phone() is not there yet), so the
  // phone's words come one microtask later.
  let booted = false;
  render();
  queueMicrotask(() => ((booted = true), render()));
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
