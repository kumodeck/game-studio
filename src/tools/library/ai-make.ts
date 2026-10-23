// "Make with AI" in the Assets page: pictures (fal) and 3D models (Tripo) through the person's
// KUMODeck sign-in, paid from their KUMODeck prepaid balance (2026-10-16).
//
// The product decision (10/16): "a completely free AI game editor, even without KUMO; sign in to KUMO and picture
// and 3D generation can be used from your credits". So:
// - The editor never needs this. The entry is ONE quiet button next to "Add files"; nothing is
//   fetched until it is opened, and the not-signed-in view is one sentence plus the command.
// - Before Make: the price of this one job and the balance are on screen; a short balance stops
//   here (the button says why) and the server stops again (402).
// - The AI terms: asked once, the first time KUMODeck says so (needs_terms); the person ticks
//   "I agree" and the same request goes again with acceptTerms. The server remembers it.
// - The result is a new file in assets/ (add-only, like "Add files"); placing it in the scene is
//   the person's or their AI's job.
//
// - Waiting is honest (polish pass 2026-10-17): the first real production run took 18.8 s for one
//   image and 182 s for one 3D model, while the panel said "a few seconds". The panel now says
//   "about 20 seconds" / "about 3 minutes" up front and, while it waits, shows the time so far
//   next to that estimate and what is happening (waiting for the AI provider, making it, copying
//   it into assets/). The Assets grid shows the same work as a "Making…" tile (onWork), so the
//   panel can be closed. No progress bar: the provider reports no progress, and a bar driven by
//   the clock would be a guess dressed up as a measurement.
// - Credits are read again after each job (the real run kept showing $4.13 after a $0.20 model
//   until the panel was reopened).
// - A heavy 3D model (the real one was 45.7 MB) says so when it lands, with one button that asks
//   the person's AI to make it lighter (askLighter). The editor never rewrites the file itself:
//   it only adds files, and how light is light enough depends on how the game uses the model,
//   which the AI can see and the editor can't.
//
// - The place to make things (generate-ui, 2026-10-22; the product request of 10/22: "3D, images, sound and so on each
//   get a proper screen for making them"): five kinds (image, 3D, sound effect, music, voice line; the sounds through
//   KUMODeck's audio route), example words one press puts in the box, a "Just made" card that shows the thing (▶ for
//   a sound) with "Add to scene" / "Ask your AI…", and "Made here" from .studio/generated.json with Again / Change.
//   No new button outside this box: the Library's head stays as it was. Kind data: gen-kinds.ts; card and history:
//   gen-made.ts.
//
// Talks only to host.kumo (src/server/kumo.mjs on the local server). The page never sees a key.
// Untrusted text (prompts, project names, KUMODeck's sentences) only goes through textContent.

import type { KumoHost, KumoJob, KumoMade, KumoRefusal, KumoStatus, Lang, LibraryFileUse } from '../../contract.ts';
import { DEFAULT_FORM, KINDS, KIND_WORDS, MAX_LEN, MUSIC_SECONDS, SFX_SECONDS, USUAL_SEC, VOICES, formFrom, isSound, priceOf, soundRequest } from './gen-kinds.ts';
import type { Form, Kind, PictureQuality } from './gen-kinds.ts';
import { madeCard, madeHistory } from './gen-made.ts';
import { t } from './strings.ts';
import type { StringKey } from './strings.ts';

export { USUAL_SEC };
/** The server reserves whole cents, at least 1 (kumo.mjs kumoCents). */
export const centsOf = (usd: number) => Math.max(1, Math.ceil(Math.round(usd * 1e6) / 1e4));
export const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
/** A balance (cents) in dollars: always 2 places ($0.05, not $0.050). */
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * The words on the Library's "✦ Make with AI" button (studio-library-shelf, 2026-10-23; the UI plan 5 #4). The first-run
 * walk (#12) pressed it to find out it needs a KUMODeck sign-in and money ("Checking your sign-in…" first): now the button
 * says it before the press — signed out "Make with AI · sign-in · paid", signed in "Make with AI · $4.20 left" (the balance
 * the status already has; nothing is worked out here). null = not known yet (the plain words, until the status comes).
 */
export function aiOpenLabel(lang: Lang, st: Pick<KumoStatus, 'signedIn' | 'balanceCents'> | null): string {
  if (!st) return t(lang, 'aiOpen');
  if (!st.signedIn) return t(lang, 'aiOpenSignIn');
  return typeof st.balanceCents === 'number' ? t(lang, 'aiOpenLeft', { balance: dollars(st.balanceCents) }) : t(lang, 'aiOpen');
}

/**
 * A 3D file heavier than this gets the "heavy for a web game" line and the "make it lighter"
 * button. 10 MB: most web game models are a few MB; the real AI model was 45.7 MB and took
 * 10–30 s just to draw its thumbnail.
 */
export const HEAVY_MODEL_BYTES = 10 * 1024 * 1024;

/** One thing being made right now (the Assets grid shows it as a "Making…" tile). */
export interface AiWork {
  id: string;
  kind: Kind;
  prompt: string;
  /** Date.now() when it started (or when this page first saw it, for a job from before a reload). */
  since: number;
}

/** "0:07", "3:02": time so far, for the waiting lines. */
export const elapsed = (since: number, now = Date.now()) => {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface AiMakeDeps {
  kumo: KumoHost;
  lang: Lang;
  /**
   * A new file is in assets/ (the panel lists it and marks it New). Resolves with its size once
   * the panel has listed it, for the "heavy" line.
   */
  onAdded(path: string): Promise<{ size?: number } | void> | void;
  /** What is being made changed (for the grid's "Making…" tiles). */
  onWork?(work: AiWork[]): void;
  /** Ask the person's AI to make a heavy model lighter. Resolves false when it couldn't be sent. Absent = no button. */
  askLighter?(path: string, size: number): Promise<boolean>;
  /** Format a byte count the way the panel does. */
  formatSize?(n: number): string;
  /** The file's address, for the card's image and ▶ (StudioHost.assetUrl). */
  assetUrl?(path: string): string;
  /** "Add to scene" / "Ask your AI…" on what was just made (the Library's own; absent = no buttons). */
  files?: LibraryFileUse;
  /** The sign-in / balance changed (the Library's button says it: aiOpenLabel). */
  onStatus?(st: KumoStatus): void;
}

/** The line under Make: what happened, plus what is being waited for or what to do next. */
interface Note {
  text: string;
  detail?: string;
  bad?: boolean;
  /** Still waiting: show the waiting line for this work. */
  wait?: { id: string; kind: Kind };
  /** A heavy 3D file just landed. */
  heavy?: { path: string; size: number };
  /** "Make it lighter" was sent to the AI. */
  sent?: boolean;
  /** What just landed: the "Just made" card (gen-made.ts). */
  made?: { kind: Kind; path: string; size?: string; costUsdMicros?: number | null };
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/** Words for a refusal code (the server's own sentence goes under it, smaller). */
const REFUSAL: Record<string, StringKey> = {
  signed_out: 'aiSignedOut',
  not_enough: 'aiNotEnough',
  not_open: 'aiNotOpen',
  not_allowed: 'aiNotAllowed',
  no_project: 'aiNoProject',
  too_many: 'aiTooMany',
  unreachable: 'aiUnreachable',
};

export function mountAiMake(root: HTMLElement, deps: AiMakeDeps): { open(): void; close(): void; isOpen(): boolean; peek(): Promise<void> } {
  const L = (k: StringKey, v?: Record<string, string | number>) => t(deps.lang, k, v);
  const box = h('div', 'gsl-ai');
  box.hidden = true;
  box.setAttribute('data-studio-part', 'ai-make');
  root.append(box);

  let st: KumoStatus | null = null;
  /** Every kind's choices in one object (gen-kinds.ts Form): switching kinds keeps the words and the choices. */
  let form: Form = { ...DEFAULT_FORM };
  let busy = false;
  /** After Again / Change: what gets the focus once the form is drawn again. */
  let focusNext: 'make' | 'prompt' | null = null;
  /** Set when KUMODeck asked for the terms: the next Make sends acceptTerms (after the tick). */
  let askTerms = false;
  let agreed = false;
  let note: Note | null = null;
  const polling = new Set<string>();
  /** When each piece of work started (a picture or a sound, made within one request: 'now'; 3D: the job id). */
  const since = new Map<string, number>();
  let tick = 0;
  /** The kind and words of the picture or sound being made now (the 'now' work). */
  let nowKind: Kind = 'picture';
  let nowFor = '';
  /** Sound kinds only when the host can make sounds (an older host offers images and 3D). */
  const kinds = () => KINDS.filter((k) => !isSound(k) || !!deps.kumo.makeSound);

  const price = () => priceOf(form);
  const fmtSize = (n: number) => (deps.formatSize ? deps.formatSize(n) : `${Math.round(n / 104857.6) / 10} MB`);

  /** Everything being made now, oldest first. */
  function work(): AiWork[] {
    const out: AiWork[] = [];
    const now = since.get('now');
    if (now !== undefined) out.push({ id: 'now', kind: nowKind, prompt: nowFor, since: now });
    for (const j of st?.jobs || []) {
      const t0 = since.get(j.id);
      if (t0 !== undefined && !j.path && j.status !== 'failed' && j.status !== 'canceled') out.push({ id: j.id, kind: 'model', prompt: j.prompt, since: t0 });
    }
    return out;
  }
  function workChanged() {
    const w = work();
    deps.onWork?.(w);
    // One clock for the waiting lines; only text changes each second (a full render would take
    // the focus out of the prompt box while the person types the next one).
    if (w.length && !tick) tick = window.setInterval(updateClocks, 1000);
    if (!w.length && tick) {
      window.clearInterval(tick);
      tick = 0;
    }
  }
  function updateClocks() {
    for (const el of box.querySelectorAll<HTMLElement>('[data-since]')) {
      const t0 = Number(el.dataset.since);
      el.textContent = elapsed(t0);
      const slow = el.closest<HTMLElement>('[data-usual]');
      const late = slow?.querySelector<HTMLElement>('.gsl-ai-late');
      if (slow && late) late.hidden = Date.now() - t0 < 2 * Number(slow.dataset.usual) * 1000;
    }
  }

  /**
   * Read the credits again (after a job: what the panel shows must be what is left), and the history: the server
   * wrote the new line in .studio/generated.json when the file landed.
   */
  async function refreshBalance() {
    const s = await deps.kumo.status().catch(() => null);
    if (s && st && typeof s.balanceCents === 'number') {
      st.balanceCents = s.balanceCents;
      if (s.made) st.made = s.made;
      render();
    }
  }

  /** The file is in assets/: say so, with its size, the "Just made" card, and the heavy line for a big 3D file. */
  async function added(path: string, k: Kind, costUsdMicros: number | null = null) {
    // The card says it (gen-made.ts); `text` stays for a host-less read of the note (and is not drawn with a card).
    note = { text: L('aiAdded', { path }), made: { kind: k, path, costUsdMicros } };
    render();
    const info = await deps.onAdded(path);
    const size = info && typeof info.size === 'number' ? info.size : undefined;
    if (note && note.made?.path === path && size) {
      note = { text: L('aiAddedSize', { path, size: fmtSize(size) }), made: { kind: k, path, size: fmtSize(size), costUsdMicros } };
      if (k === 'model' && size > HEAVY_MODEL_BYTES) note.heavy = { path, size };
      render();
    }
  }

  async function load() {
    st = null;
    render();
    st = await deps.kumo.status();
    render();
    for (const j of st.jobs || []) if (!j.path && (j.status === 'queued' || j.status === 'running')) void follow(j.id);
  }

  function refusal(r: KumoRefusal) {
    if (r.code === 'needs_terms') {
      askTerms = true;
      note = null;
      return;
    }
    const key = REFUSAL[r.code];
    note = { text: key ? L(key) : L('aiFailed'), detail: r.message, bad: true };
    if (r.code === 'signed_out') void load();
    if (typeof r.balanceCents === 'number' && st) st.balanceCents = r.balanceCents;
  }

  async function make() {
    if (busy || !form.prompt.trim()) return;
    if (askTerms && !agreed) return;
    busy = true;
    const f = { ...form };
    const k = f.kind;
    // A picture or a sound is made within the request: one 'now' piece of work with a clock. 3D starts a job.
    note = k === 'model' ? { text: L('aiStartingModel') } : { text: L(KIND_WORDS[k].making), wait: { id: 'now', kind: k } };
    if (k !== 'model') {
      since.set('now', Date.now());
      nowKind = k;
      nowFor = f.prompt.trim();
      workChanged();
    }
    render();
    const acceptTerms = askTerms && agreed ? true : undefined;
    try {
      if (k !== 'model') {
        const r = k === 'picture'
          ? await deps.kumo.makePicture({
              prompt: f.prompt.trim(),
              width: f.side,
              height: f.side,
              ...(f.quality === 'high' ? { quality: 'high' as const } : {}),
              ...(f.quality === 'seamless' ? { tiling: 'both' as const } : {}),
              ...(acceptTerms ? { acceptTerms } : {}),
            })
          : await deps.kumo.makeSound!({ ...soundRequest(f), ...(acceptTerms ? { acceptTerms } : {}) });
        since.delete('now');
        workChanged();
        if (!r.ok) refusal(r);
        else {
          askTerms = false;
          if (st && typeof r.balanceCents === 'number') st.balanceCents = r.balanceCents;
          // the history line is new either way (and the balance, when the answer had none)
          void refreshBalance();
          void added(r.path, k, r.costUsdMicros);
        }
      } else {
        const r = await deps.kumo.makeModel({ prompt: f.prompt.trim(), texture: f.texture, ...(acceptTerms ? { acceptTerms } : {}) });
        if (!r.ok) refusal(r);
        else {
          askTerms = false;
          since.set(r.id, Date.now());
          note = { text: L('aiModelStarted'), wait: { id: r.id, kind: 'model' } };
          upsertJob(r);
          workChanged();
          void follow(r.id);
        }
      }
    } finally {
      if (since.delete('now')) workChanged();
      busy = false;
      render();
    }
  }

  function upsertJob(j: KumoJob) {
    if (!st) return;
    const list = (st.jobs ||= []);
    const i = list.findIndex((x) => x.id === j.id);
    if (i >= 0) list[i] = j;
    else list.push(j);
  }

  /** Ask the local server about one 3D job until it is in assets/ or failed (each ask waits ~20 s there). */
  async function follow(id: string) {
    if (polling.has(id)) return;
    polling.add(id);
    // A job from before a reload: its clock starts now (KumoJob has no start time).
    if (!since.has(id)) since.set(id, Date.now());
    workChanged();
    try {
      for (let i = 0; i < 60; i++) {
        const r = await deps.kumo.job(id);
        if (!r.ok) {
          if (r.code !== 'unreachable') break;
          await new Promise((res) => setTimeout(res, 5000));
          continue;
        }
        upsertJob(r);
        workChanged();
        render();
        if (r.path) {
          void added(r.path, 'model', r.costUsdMicros);
          break;
        }
        if (r.status === 'failed' || r.status === 'canceled') {
          // Before, the note kept saying "Making the 3D model…" after a failure; the list said "not made".
          if (note?.wait?.id === id) note = { text: L('aiFailed'), detail: r.error?.message || L('aiJobFailed'), bad: true };
          render();
          break;
        }
      }
    } finally {
      polling.delete(id);
      since.delete(id);
      workChanged();
      // The job is over either way: what it cost is out of the credits now.
      void refreshBalance();
    }
  }

  /** The waiting line under the note: what is happening, the time so far, and the usual time. */
  function waitLine(w: { id: string; kind: Kind }): HTMLElement | null {
    const t0 = since.get(w.id);
    if (t0 === undefined) return null;
    const usual = USUAL_SEC[w.kind];
    const line = h('p', 'gsl-muted gsl-ai-wait');
    line.dataset.usual = String(usual);
    const job = w.kind === 'model' ? (st?.jobs || []).find((j) => j.id === w.id) : undefined;
    // Only the steps that differ from "making it" (the note above already says that): waiting in the
    // provider's queue, and the local server copying the finished file into assets/.
    const step = !job ? '' : job.status === 'queued' ? L('aiStepQueued') : job.status === 'succeeded' ? L('aiStepCopying') : '';
    if (step) line.append(document.createTextNode(`${step} · `));
    const clock = h('span', 'gsl-ai-clock', elapsed(t0));
    clock.dataset.since = String(t0);
    line.append(clock, document.createTextNode(` · ${L(KIND_WORDS[w.kind].usual)}`));
    const late = h('span', 'gsl-ai-late', ` ${L('aiLate')}`);
    late.hidden = Date.now() - t0 < 2 * usual * 1000;
    line.append(late);
    return line;
  }

  /** "45.7 MB is heavy for a web game" + one button that asks the AI to make it lighter. */
  function heavyBlock(hv: { path: string; size: number }): HTMLElement {
    const b = h('div', 'gsl-heavy');
    b.append(h('p', undefined, L('heavyModel', { size: fmtSize(hv.size) })));
    if (deps.askLighter) {
      const btn = h('button', 'gsl-btn gsl-ask-lighter', note?.sent ? L('askLighterSent') : L('askLighter'));
      btn.type = 'button';
      btn.disabled = !!note?.sent;
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const ok = await deps.askLighter!(hv.path, hv.size).catch(() => false);
        if (note) note.sent = ok;
        if (!ok && note) note.detail = L('askLighterFailed');
        render();
      });
      b.append(btn);
    }
    return b;
  }

  // ---------- render ----------
  function render() {
    if (st) deps.onStatus?.(st);
    // Keep the person typing: a job finishing while the prompt box has the focus re-renders.
    const typing = document.activeElement instanceof HTMLTextAreaElement && box.contains(document.activeElement)
      ? { a: document.activeElement.selectionStart, b: document.activeElement.selectionEnd } : null;
    renderBox();
    if (typing) {
      const ta = box.querySelector<HTMLTextAreaElement>('.gsl-ai-prompt');
      if (ta) {
        ta.focus();
        ta.setSelectionRange(typing.a, typing.b);
      }
    }
  }
  function renderBox() {
    box.replaceChildren();
    const head = h('div', 'gsl-ai-head');
    head.append(h('b', undefined, L('aiTitle')));
    const close = h('button', 'gsl-btn gsl-close', '×');
    close.type = 'button';
    close.setAttribute('aria-label', L('close'));
    close.addEventListener('click', () => api.close());
    head.append(close);
    box.append(head);

    if (!st) {
      box.append(h('p', 'gsl-muted', L('aiChecking')));
      return;
    }
    if (!st.signedIn) return renderSignIn(st);
    const acct = h('div', 'gsl-ai-acct');
    const bal = typeof st.balanceCents === 'number' ? dollars(st.balanceCents) : '—';
    acct.append(h('span', undefined, L('aiAccount', { email: st.email || '', balance: bal })));
    if (st.topUpUrl) {
      const a = h('a', 'gsl-ai-link', L('aiTopUp'));
      a.href = st.topUpUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      acct.append(a);
    }
    box.append(acct);
    if (st.error) box.append(h('p', 'gsl-ai-bad', st.error.message));
    if (!st.project) return renderPickProject(st);
    if (!st.fromFolder) box.append(h('p', 'gsl-muted', L('aiProject', { name: st.project.name })));

    // the kind: five chips (sounds only when the host can make them)
    const kindRow = h('div', 'gsl-ai-kinds');
    kindRow.setAttribute('role', 'group');
    kindRow.setAttribute('aria-label', L('kindsLabel'));
    for (const k of kinds()) {
      const b = h('button', 'gsl-chip', L(KIND_WORDS[k].chip));
      b.type = 'button';
      b.dataset.kind = k;
      b.setAttribute('aria-pressed', String(form.kind === k));
      b.addEventListener('click', () => {
        form = { ...form, kind: k };
        render();
      });
      kindRow.append(b);
    }
    box.append(kindRow);

    const kind = form.kind;
    const ta = h('textarea', 'gsl-ai-prompt');
    ta.rows = 3;
    ta.maxLength = MAX_LEN[kind];
    ta.placeholder = L(KIND_WORDS[kind].ph);
    ta.setAttribute('aria-label', L('aiPromptLabel'));
    ta.value = form.prompt;
    ta.addEventListener('input', () => {
      form.prompt = ta.value;
      // A voice line's price follows its length; the rest only needs Make to wake up.
      if (kind === 'voice') updatePrice();
      makeBtn.disabled = !canMake();
    });
    box.append(ta);

    // Example words (one press puts them in the box; nothing is sent). WHY: an empty box is the hardest part of
    // "make with AI" — the examples show the size and tone of words that work, for the kind chosen.
    const tryRow = h('p', 'gsl-muted gsl-ai-try');
    tryRow.append(h('span', undefined, L('tryLabel')));
    for (const key of KIND_WORDS[kind].examples) {
      const words = L(key);
      const b = h('button', 'gsl-link', words);
      b.type = 'button';
      b.addEventListener('click', () => {
        form.prompt = words;
        focusNext = 'prompt';
        render();
      });
      tryRow.append(b);
    }
    box.append(tryRow);

    const opts = h('div', 'gsl-ai-opts');
    const select = (label: StringKey, values: readonly (string | number)[], cur: string | number, word: (v: string | number) => string, set: (v: string) => void) => {
      const sel = h('select', 'gsl-type');
      sel.setAttribute('aria-label', L(label));
      // A value from the history that is not in the list (a hand-edited file) is still shown as chosen.
      const all = values.includes(cur) ? values : [...values, cur];
      for (const v of all) {
        const o = h('option', undefined, word(v));
        o.value = String(v);
        o.selected = v === cur;
        sel.append(o);
      }
      sel.addEventListener('change', () => {
        set(sel.value);
        render();
      });
      return sel;
    };
    const check = (word: StringKey, on: boolean, set: (v: boolean) => void) => {
      const lab = h('label', 'gsl-ai-check');
      const cb = h('input');
      cb.type = 'checkbox';
      cb.checked = on;
      cb.addEventListener('change', () => {
        set(cb.checked);
        render();
      });
      lab.append(cb, document.createTextNode(L(word)));
      return lab;
    };
    const secs = (v: string | number) => L('seconds', { n: v });
    if (kind === 'picture') {
      const qWord: Record<PictureQuality, StringKey> = { standard: 'aiFast', high: 'aiFine', seamless: 'aiSeamless' };
      opts.append(
        select('aiQuality', ['standard', 'high', 'seamless'], form.quality, (v) => L(qWord[v as PictureQuality]), (v) => (form.quality = v as PictureQuality)),
        select('aiSize', [512, 1024, 2048], form.side, (v) => `${v} × ${v}`, (v) => (form.side = Number(v))),
      );
    } else if (kind === 'model') {
      opts.append(check('aiTexture', form.texture, (v) => (form.texture = v)));
    } else if (kind === 'sfx') {
      opts.append(select('aiLength', SFX_SECONDS, form.sfxSec, secs, (v) => (form.sfxSec = Number(v))));
    } else if (kind === 'music') {
      opts.append(select('aiLength', MUSIC_SECONDS, form.musicSec, secs, (v) => (form.musicSec = Number(v))), check('aiLoop', form.loop, (v) => (form.loop = v)));
    } else {
      opts.append(select('aiVoice', VOICES, form.voice, (v) => L(`voice_${v}` as StringKey), (v) => (form.voice = v)));
    }
    box.append(opts);

    // the one-time AI terms (only after KUMODeck asked for them)
    if (askTerms) {
      const tb = h('div', 'gsl-ai-terms');
      tb.append(h('p', undefined, L('aiTermsIntro')));
      const ul = h('ul', 'gsl-files');
      for (const k of ['aiTerms1', 'aiTerms2', 'aiTerms3'] as StringKey[]) ul.append(h('li', undefined, L(k)));
      tb.append(ul);
      const lab = h('label', 'gsl-ai-check');
      const cb = h('input');
      cb.type = 'checkbox';
      cb.checked = agreed;
      cb.addEventListener('change', () => {
        agreed = cb.checked;
        makeBtn.disabled = !canMake();
      });
      lab.append(cb, document.createTextNode(L('aiTermsAgree')));
      tb.append(lab);
      box.append(tb);
    }

    // The price of this one and the balance, before Make (a short balance stops here and says why).
    const priceLine = h('p');
    box.append(priceLine);
    const makeBtn = h('button', 'gsl-btn gsl-primary gsl-ai-make');
    makeBtn.type = 'button';
    makeBtn.addEventListener('click', () => void make());
    box.append(makeBtn);
    let short = false;
    const canMake = () => !busy && !short && !!form.prompt.trim() && (!askTerms || agreed);
    function updatePrice() {
      const cost = price();
      const need = centsOf(cost);
      short = typeof st?.balanceCents === 'number' && st.balanceCents < need;
      priceLine.className = short ? 'gsl-ai-bad' : 'gsl-muted';
      priceLine.textContent = short ? L('aiShort', { need: dollars(need), balance: dollars(st?.balanceCents ?? 0) }) : L(KIND_WORDS[kind].price, { price: usd(cost) });
      makeBtn.textContent = busy ? L('aiMaking') : L('aiMake', { price: usd(cost) });
      makeBtn.disabled = !canMake();
    }
    updatePrice();

    if (note) {
      if (!note.made) {
        const p = h('p', note.bad ? 'gsl-ai-bad' : 'gsl-ai-note', note.text);
        p.setAttribute('role', 'status');
        box.append(p);
      }
      const wl = note.wait ? waitLine(note.wait) : null;
      if (wl) box.append(wl);
      if (note.detail) box.append(h('p', 'gsl-muted gsl-ai-detail', note.detail));
      if (note.made) box.append(madeCard(note.made, { lang: deps.lang, assetUrl: deps.assetUrl, files: deps.files }));
      if (note.heavy) box.append(heavyBlock(note.heavy));
    }

    const hist = madeHistory(st.jobs || [], st.made || [], {
      lang: deps.lang,
      assetUrl: deps.assetUrl,
      again: (m) => fill(m, 'make'),
      change: (m) => fill(m, 'prompt'),
    });
    if (hist) box.append(hist);

    if (focusNext) {
      const want = focusNext;
      focusNext = null;
      const el = want === 'make' ? makeBtn : ta;
      el.focus();
      if (el === ta) ta.setSelectionRange(ta.value.length, ta.value.length);
    }
  }

  /** Again / Change on a history line: its kind, words and choices back in the form. Nothing is sent. */
  function fill(m: KumoMade, then: 'make' | 'prompt') {
    // A sound line on a host that cannot make sounds stays where it is (no kind to show it in).
    if (!kinds().includes(m.kind)) return;
    form = formFrom(m, form);
    focusNext = then;
    note = null;
    render();
    box.querySelector('.gsl-ai-kinds')?.scrollIntoView({ block: 'nearest' });
  }

  function renderSignIn(s: KumoStatus) {
    box.append(h('p', undefined, s.expired ? L('aiExpired') : L('aiSignInWhy')));
    const row = h('div', 'gsl-ai-cmd');
    const code = h('code', undefined, s.loginCommand);
    const copy = h('button', 'gsl-btn', L('aiCopy'));
    copy.type = 'button';
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(s.loginCommand).then(() => (copy.textContent = L('aiCopied'))).catch(() => undefined);
    });
    row.append(code, copy);
    box.append(row, h('p', 'gsl-muted', L('aiSignInHow')));
    const again = h('button', 'gsl-btn gsl-ai-again', L('aiCheckAgain'));
    again.type = 'button';
    again.addEventListener('click', () => void load());
    box.append(again);
  }

  function renderPickProject(s: KumoStatus) {
    box.append(h('p', undefined, L('aiPickProject')));
    const sel = h('select', 'gsl-type');
    sel.setAttribute('aria-label', L('aiPickProject'));
    for (const p of s.projects || []) {
      const o = h('option', undefined, p.name);
      o.value = p.id;
      sel.append(o);
    }
    const use = h('button', 'gsl-btn gsl-primary', L('aiUseProject'));
    use.type = 'button';
    use.disabled = !(s.projects || []).length;
    use.addEventListener('click', async () => {
      const r = await deps.kumo.pickProject(sel.value);
      if ('ok' in r && r.ok === false) note = { text: L('aiFailed'), detail: r.message, bad: true };
      else st = r as KumoStatus;
      render();
    });
    const row = h('div', 'gsl-ai-opts');
    row.append(sel, use);
    box.append(row);
    if (!(s.projects || []).length) box.append(h('p', 'gsl-muted', L('aiNoProjects')));
  }

  const api = {
    open() {
      box.hidden = false;
      note = null;
      void load();
    },
    close() {
      box.hidden = true;
    },
    isOpen: () => !box.hidden,
    /**
     * Read the sign-in once without opening (the button's words, the UI plan 5 #4). Signed out it is a local file check;
     * signed in, the one balance read the open form would make anyway. Was: nothing asked until the press — which is
     * exactly why the press was needed to learn the price.
     */
    async peek() {
      if (st) return;
      const s = await deps.kumo.status().catch(() => null);
      if (s && !st && box.hidden) {
        st = s;
        deps.onStatus?.(s);
      }
    },
  };
  return api;
}
