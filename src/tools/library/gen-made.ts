// What "Make with AI" shows after making (generate-ui, 2026-10-22): the "Just made" card and the "Made here" history.
//
// The card is the end of one flow — words → price → Make → wait → here it is → use it. It shows the thing itself
// (the image, ▶ for a sound, the name for a 3D model whose turning picture is the grid's tile) and the same two
// buttons a file's detail has, "Add to scene" and "Ask your AI…" (LibraryFileUse, "use the Library" 2026-10-18):
// one way to hand a file to the AI, not a second one. Without an AI behind the host (the dev harness) there are no
// buttons; the file is in assets/ either way.
//
// The history reads .studio/generated.json (src/server/generated.mjs) through the sign-in's status. Each line has
// Again (the same kind, words and choices back in the form, focus on Make) and Change (the same, focus in the words).
// Neither sends anything: money moves only on Make, where the price is written. WHY two buttons and not "Make again"
// in one press: a press that spends without showing the price would be the only one in the editor that does.
//
// Untrusted text (prompts, file names) only goes through textContent.

import type { KumoJob, KumoMade, Lang, LibraryFileUse } from '../../contract.ts';
import type { Kind } from './gen-kinds.ts';
import { KIND_WORDS } from './gen-kinds.ts';
import { t } from './strings.ts';
import type { StringKey } from './strings.ts';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const baseName = (p: string) => p.split('/').pop() || p;
/** A cost in dollars from micro-dollars: $0.004, $0.01 (not $0.010), $0.20. */
const costText = (micros: number) => {
  const d = micros / 1e6;
  return `$${d < 0.1 ? d.toFixed(3).replace(/(\.\d\d)0$/, '$1') : d.toFixed(2)}`;
};

export interface MadeDeps {
  lang: Lang;
  /** The file's address for <img> / <audio> (StudioHost.assetUrl). */
  assetUrl?(path: string): string;
  /** "Add to scene" / "Ask your AI…" on the file. Absent = no buttons. */
  files?: LibraryFileUse;
}

/** One player for every ▶ in the box: a second ▶ stops the first (two sounds at once help nobody judge either). */
let player: HTMLAudioElement | null = null;
let playingPath: string | null = null;

function playButton(path: string, d: MadeDeps): HTMLButtonElement {
  const L = (k: StringKey) => t(d.lang, k);
  const b = h('button', 'gsl-btn gsl-ai-play');
  b.type = 'button';
  const show = () => {
    const on = playingPath === path;
    b.textContent = on ? '■' : '▶';
    b.setAttribute('aria-label', on ? L('stop') : L('play'));
    b.setAttribute('aria-pressed', String(on));
  };
  show();
  b.addEventListener('click', () => {
    if (!d.assetUrl) return;
    player ||= new Audio();
    if (playingPath === path) {
      player.pause();
      playingPath = null;
    } else {
      player.src = d.assetUrl(path);
      player.currentTime = 0;
      playingPath = path;
      void player.play().catch(() => {
        playingPath = null;
        show();
      });
      player.onended = () => {
        playingPath = null;
        // every ▶ in the box shows ▶ again
        for (const el of document.querySelectorAll<HTMLButtonElement>('.gsl-ai-play')) {
          el.textContent = '▶';
          el.setAttribute('aria-pressed', 'false');
        }
      };
    }
    for (const el of document.querySelectorAll<HTMLButtonElement>('.gsl-ai-play')) {
      el.textContent = '▶';
      el.setAttribute('aria-pressed', 'false');
    }
    show();
  });
  return b;
}

/** The "Just made" card: the thing, its name, size and cost, and how to use it. */
export function madeCard(m: { kind: Kind; path: string; size?: string; costUsdMicros?: number | null }, d: MadeDeps): HTMLElement {
  const L = (k: StringKey, v?: Record<string, string | number>) => t(d.lang, k, v);
  // The card is the one line that says it worked (role status): no "Added …" sentence above it repeating the name
  // and size (the first version had both, and read twice; the review of the pictures, 2026-10-22).
  const card = h('div', 'gsl-section gsl-ai-made');
  card.dataset.kind = m.kind;
  card.setAttribute('role', 'status');
  card.append(h('h4', undefined, L('madeTitle')));
  const row = h('div', 'gsl-ai-made-row');
  if (m.kind === 'picture' && d.assetUrl) {
    const img = h('img', 'gsl-ai-made-pic');
    img.src = d.assetUrl(m.path);
    img.alt = '';
    row.append(img);
  } else if (m.kind === 'sfx' || m.kind === 'music' || m.kind === 'voice') {
    row.append(playButton(m.path, d));
  } else {
    row.append(h('span', 'gsl-ai-made-icon', '◆'));
  }
  const what = h('div', 'gsl-ai-made-what');
  what.append(h('b', undefined, baseName(m.path)));
  // where it is, how big, what it cost: "assets/ · 4.7 KB · $0.004"
  const folder = m.path.includes('/') ? m.path.slice(0, m.path.lastIndexOf('/') + 1) : '';
  const bits = [folder, m.size, typeof m.costUsdMicros === 'number' ? costText(m.costUsdMicros) : ''].filter(Boolean).join(' · ');
  if (bits) what.append(h('span', 'gsl-muted', bits));
  row.append(what);
  card.append(row);
  if (d.files?.add || d.files?.ask) {
    const acts = h('div', 'gsl-acts');
    if (d.files.add) {
      // ✦ (studio-uniforms, 2026-10-23): a new object from a file is the AI's work — the AI's uniform, a draft only.
      const add = h('button', 'gsl-btn gsl-primary gsl-add-scene ai', `✦ ${L('askAddFile')}`);
      add.type = 'button';
      add.addEventListener('click', () => d.files!.add!([m.path]));
      acts.append(add);
    }
    if (d.files.ask) {
      const ask = h('button', 'gsl-btn gsl-ask-file ai', `✦ ${L('askAiFile')}`);
      ask.type = 'button';
      ask.addEventListener('click', () => d.files!.ask!([m.path]));
      acts.append(ask);
    }
    card.append(acts);
  }
  return card;
}

/**
 * "Made here": 3D models still being made (or that failed) in this run first, then the history, newest first.
 * again / change: put a history line back in the form.
 */
export function madeHistory(
  jobs: KumoJob[],
  made: KumoMade[],
  d: MadeDeps & { again(m: KumoMade): void; change(m: KumoMade): void },
): HTMLElement | null {
  const L = (k: StringKey, v?: Record<string, string | number>) => t(d.lang, k, v);
  // A 3D job that landed is in the history already (generated.mjs writes it when the file lands).
  const open = jobs.filter((j) => !j.path).slice(-3).reverse();
  const lines = made.slice(0, 6);
  if (!open.length && !lines.length) return null;
  const sec = h('div', 'gsl-section gsl-ai-history');
  sec.append(h('h4', undefined, L('madeHere')));
  const ul = h('ul', 'gsl-ai-lines');
  for (const j of open) {
    const li = h('li', 'gsl-ai-line');
    li.append(h('span', 'gsl-ai-words', j.prompt));
    li.append(h('span', 'gsl-muted gsl-ai-where', `${L('kindModel')} · ${j.status === 'failed' || j.status === 'canceled' ? L('aiJobFailed') : L('aiJobRunning')}`));
    ul.append(li);
  }
  for (const m of lines) {
    const li = h('li', 'gsl-ai-line');
    li.dataset.kind = m.kind;
    const words = h('span', 'gsl-ai-words', m.prompt);
    words.title = m.prompt;
    // The words first (what the person remembers), then a quiet "Sound · assets/coin.wav". The kind was its own
    // column first and cut the words to "Coin pickup, brig…" on a phone (the review of the pictures, 2026-10-22).
    li.append(words);
    const where = h('span', 'gsl-muted gsl-ai-where', `${L(KIND_WORDS[m.kind].chip)} · ${m.path}`);
    li.append(where);
    const acts = h('span', 'gsl-ai-line-acts');
    if (m.kind === 'sfx' || m.kind === 'music' || m.kind === 'voice') acts.append(playButton(m.path, d));
    const again = h('button', 'gsl-link gsl-ai-again-line', L('again'));
    again.type = 'button';
    again.title = L('againTip');
    again.addEventListener('click', () => d.again(m));
    const change = h('button', 'gsl-link gsl-ai-change', L('change'));
    change.type = 'button';
    change.title = L('changeTip');
    change.addEventListener('click', () => d.change(m));
    acts.append(again, change);
    li.append(acts);
    ul.append(li);
  }
  sec.append(ul);
  return sec;
}
