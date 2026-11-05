// ● Clip, stage 1 (decided 2026-11-05): the button in the top bar, Clip ⌄, and the line when the clip is saved. The rules
// are in clip-model.ts, the recording in the game page (bridge/play-clip.ts), the MP4 box in mp4.ts, the folder in
// src/server/clips.mjs. main.ts places the parts and forwards the game page's `studio:clip/*` messages.
//
// The flow (one press):
//   ● Clip → Play first if in Edit (a paused game resumes) → the next 8 s (6 / 8 / 12 in ⌄) are recorded: the button is red
//   "0:03 · Stop", the game has a red frame (only what is inside it is in the clip) and a thin bar of the time left. A
//   second press stops early (one more second for the mark). Then the line, where the AI's line is:
//     row 1: ✓ Clip saved · neon-run-clip-1.mp4 / 8 s · Wide 1280×720 · Movies › KUMODeck · Show in Finder · Remove mark · ✕
//     row 2: the post (English, the same words with no AI) · 102 / 280 · Copy post
//   The web demo has no folder: the clip is a download, and its line says so.
// WHY no key (⌘K lists it instead): while playing, the keys are the game's (keymap.ts); a letter would fight its controls.
// WHY the next seconds, not the last ones: recording all through ▶ Play costs heat and battery, and a clip that only
// starts on a press never records what the person did not mean to show.
import type { BridgeToShell, ShellToBridge, StudioHost } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { MenuEntry } from './context-menu.ts';
import {
  CLIP_BITRATE, CLIP_CODEC, CLIP_FPS, CLIP_LENGTHS, CLIP_MARK_LINES, CLIP_WIDE, X_LIMIT,
  clipStem, downloadName, postText, recClock, xLength, type ClipPrefs, type ClipRefusal,
} from './clip-model.ts';
import { muxMp4, type Mp4Sample } from './mp4.ts';

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
  /** The state, for the page (data-clip on the shell: the red frame, tests). */
  changed(state: ClipState): void;
}

export type ClipState = 'idle' | 'starting' | 'rec' | 'saving';

/** What was saved, kept for the line's buttons (Show in Finder, the swap). */
interface Saved {
  name: string;
  /** Where it is ('movies' | 'videos'), or 'downloads' in the web demo. */
  where: string;
  reveal?: 'finder' | 'folder';
  seconds: number;
  mark: boolean;
  /** The other end, ready to swap in without recording again (null: the second encoder's setup differed). */
  other: Uint8Array | null;
  file: Uint8Array;
}

export function createClip(d: ClipDeps) {
  const { t } = d;
  let state: ClipState = 'idle';
  let id = '';
  let startedAt = 0;
  let clock: number | undefined;
  let total = 0;
  let wanted: ClipPrefs = d.prefs();
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
  const btn = h('button', { type: 'button', class: 'clip-btn', dataset: { action: 'clip', part: 'clip' }, onclick: () => void press() },
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
    d.changed(s);
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
    const rows: MenuEntry[] = [{ head: t('clip.length') }];
    for (const s of CLIP_LENGTHS) {
      rows.push({ id: `clip-${s}`, label: t('clip.lengthRow', { s }), checked: p.seconds === s, run: () => (d.setPrefs({ ...d.prefs(), seconds: s }), (wanted = d.prefs()), render()) });
    }
    rows.push({ sep: true },
      { id: 'clip-mark', label: t('clip.mark'), checked: p.mark, run: () => (d.setPrefs({ ...d.prefs(), mark: !d.prefs().mark }), (wanted = d.prefs())) },
      { sep: true }, { note: `${t('clip.saveTo', { dir })} ${t('clip.local')}` });
    d.menu(more, rows);
  }

  /** ● Clip pressed (the button, ⌘K). */
  async function press() {
    if (state === 'rec') {
      d.post({ type: 'studio:clip/stop', id });
      return;
    }
    if (state !== 'idle') return;
    if (typeof (window as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') {
      d.toast(t('clip.noEncoder'), 7000);
      return;
    }
    setState('starting');
    if (!d.playing() && !(await d.play())) {
      setState('idle');
      return;
    }
    if (d.paused()) d.resume();
    wanted = d.prefs();
    id = `clip-${Date.now().toString(36)}`;
    main = [];
    alt = [];
    avcc = null;
    altAvcc = null;
    d.post({ type: 'studio:clip/start', id, seconds: wanted.seconds, fps: CLIP_FPS, w: CLIP_WIDE.w, h: CLIP_WIDE.h, codec: CLIP_CODEC, bitrate: CLIP_BITRATE,
      mark: wanted.mark, lines: [...CLIP_MARK_LINES] });
    // Nothing back from the game page (an old bridge, a page that went): give up after a while.
    clock = window.setTimeout(() => {
      if (state === 'starting') (setState('idle'), d.toast(t('clip.failed', { msg: 'no answer from the game' }), 6000));
    }, 5000);
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
    let file: Uint8Array;
    let other: Uint8Array | null = null;
    try {
      main.sort((a, b) => a.ts - b.ts);
      alt.sort((a, b) => a.ts - b.ts);
      if (!avcc || !main.length) throw new Error('no video');
      const endUs = Math.round(length * 1e6);
      file = muxMp4({ width: CLIP_WIDE.w, height: CLIP_WIDE.h, avcc, samples: main, endUs });
      // The other end: the frames before the mark's second, then the second encoder's. Only when both encoders set up
      // the same way (the same SPS / PPS), so one MP4 header describes both — nearly always in one browser, checked.
      const cut = markAt - 1;
      if (altAvcc && sameBytes(altAvcc, avcc) && alt.length && alt[0]!.key) {
        other = muxMp4({ width: CLIP_WIDE.w, height: CLIP_WIDE.h, avcc, samples: [...main.filter((s) => s.ts < cut), ...alt], endUs });
      }
    } catch (e) {
      setState('idle');
      d.toast(t('clip.failed', { msg: (e as Error).message }), 8000);
      return;
    }
    main = [];
    alt = [];
    const ok = await store(file, null);
    if (!ok) return setState('idle');
    saved = { ...ok, seconds, mark: wanted.mark, other, file };
    setState('idle');
    showLine();
  }

  /** Save (the server's folder) or download (the web demo). `replace` = the name of the clip saved before. */
  async function store(file: Uint8Array, replace: string | null): Promise<{ name: string; where: string; reveal?: 'finder' | 'folder' } | null> {
    const blob = new Blob([file as BlobPart], { type: 'video/mp4' });
    if (!d.host.clips) {
      const name = replace ?? downloadName(d.game(), new Date());
      const a = h('a', { href: URL.createObjectURL(blob), download: name, hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      return { name, where: 'downloads' };
    }
    const r = await d.host.clips.save(blob, replace ? { replace } : { stem: clipStem(d.game()) });
    if (!r.ok) {
      d.toast(t('clip.saveFailed', { msg: r.error }), 8000);
      return null;
    }
    return { name: r.name, where: r.where, reveal: r.reveal };
  }

  function showLine() {
    if (!saved) return;
    const s = saved;
    const post = postText({ game: d.game(), seconds: s.seconds, mark: s.mark });
    const n = xLength(post);
    const where = t(`clip.dir.${s.where}`);
    const head = h('div', { class: 'clip-row' },
      h('span', { class: 'clip-head' }, icon('check'), h('strong', { text: t(s.where === 'downloads' ? 'clip.downloaded' : 'clip.saved', { name: s.name }) })),
      h('span', { class: 'clip-where', text: t('clip.where', { s: s.seconds, dir: where }) }));
    if (s.reveal && d.host.clips) {
      head.append(h('button', { type: 'button', class: 'link', dataset: { action: 'clip-reveal' }, text: t(s.reveal === 'finder' ? 'clip.finder' : 'clip.folder'),
        onclick: () => void d.host.clips!.reveal(s.name).then((r) => !r.ok && d.toast(t('clip.saveFailed', { msg: r.error || '?' }), 6000)) }));
    }
    if (s.other) {
      head.append(h('button', { type: 'button', class: 'link', dataset: { action: 'clip-mark' }, text: t(s.mark ? 'clip.markRemove' : 'clip.markAdd'), onclick: () => void swap() }));
    }
    head.append(h('button', { type: 'button', class: 'icon-only link clip-x', dataset: { action: 'clip-close' }, title: t('clip.close'), 'aria-label': t('clip.close'),
      onclick: () => ((line.hidden = true), (saved = null)) }, icon('close')));
    const copyBtn = h('button', { type: 'button', class: 'link', dataset: { action: 'clip-copy' }, text: t('clip.copy'), onclick: () => void copy(post, copyBtn) });
    const draft = h('div', { class: 'clip-row clip-post' },
      h('span', { class: 'clip-x-mark', 'aria-hidden': 'true', text: '𝕏' }),
      h('span', { class: 'clip-text', dataset: { part: 'clip-post' }, text: post }),
      h('span', { class: `clip-count${n > X_LIMIT ? ' over' : ''}`, dataset: { part: 'clip-count' }, text: t('clip.count', { n }) }),
      copyBtn);
    line.replaceChildren(head, draft);
    line.hidden = false;
  }

  /** "Remove mark" / "Add mark": the other end swapped in, saved over the same clip, and remembered for the next ones. */
  async function swap() {
    if (!saved?.other) return;
    const s = saved;
    const next = !s.mark;
    const ok = await store(s.other, s.name);
    if (!ok) return;
    saved = { ...s, name: ok.name, mark: next, file: s.other, other: s.file };
    d.setPrefs({ ...d.prefs(), mark: next });
    wanted = d.prefs();
    showLine();
    d.toast(t(next ? 'clip.markOn' : 'clip.markOff'), 5000);
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

  render();
  return {
    el,
    bar,
    line,
    press: () => void press(),
    onMessage,
    render,
    get state() {
      return state;
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
