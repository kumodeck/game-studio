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
// Talks only to host.kumo (src/server/kumo.mjs on the local server). The page never sees a key.
// Untrusted text (prompts, project names, KUMODeck's sentences) only goes through textContent.

import type { KumoHost, KumoJob, KumoRefusal, KumoStatus, Lang } from '../../contract.ts';
import { t } from './strings.ts';
import type { StringKey } from './strings.ts';

/** Prices before Make (USD, at cost). The same numbers as src/server/kumo.mjs kumoImagePrice / kumo3dPrice. */
export function picturePrice(o: { side: number; quality: PictureQuality }): number {
  const mp = Math.max(1, Math.ceil((o.side * o.side) / (1024 * 1024)));
  if (o.quality === 'seamless') return 0.02 * mp;
  if (o.quality === 'high') return 0.03 + 0.015 * (mp - 1);
  return 0.003 * mp;
}
export const modelPrice = (texture: boolean) => (texture ? 0.2 : 0.1);
/** The server reserves whole cents, at least 1 (kumo.mjs kumoCents). */
export const centsOf = (usd: number) => Math.max(1, Math.ceil(Math.round(usd * 1e6) / 1e4));
export const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
/** A balance (cents) in dollars: always 2 places ($0.05, not $0.050). */
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

type PictureQuality = 'standard' | 'high' | 'seamless';
type Kind = 'picture' | 'model';

export interface AiMakeDeps {
  kumo: KumoHost;
  lang: Lang;
  /** A new file is in assets/ (the panel lists it and marks it New). */
  onAdded(path: string): void;
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

export function mountAiMake(root: HTMLElement, deps: AiMakeDeps): { open(): void; close(): void; isOpen(): boolean } {
  const L = (k: StringKey, v?: Record<string, string | number>) => t(deps.lang, k, v);
  const box = h('div', 'gsl-ai');
  box.hidden = true;
  box.setAttribute('data-studio-part', 'ai-make');
  root.append(box);

  let st: KumoStatus | null = null;
  let kind: Kind = 'picture';
  let quality: PictureQuality = 'standard';
  let side = 1024;
  let texture = true;
  let prompt = '';
  let busy = false;
  /** Set when KUMODeck asked for the terms: the next Make sends acceptTerms (after the tick). */
  let askTerms = false;
  let agreed = false;
  let note: { text: string; detail?: string; bad?: boolean } | null = null;
  const polling = new Set<string>();

  const price = () => (kind === 'picture' ? picturePrice({ side, quality }) : modelPrice(texture));

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
    if (busy || !prompt.trim()) return;
    if (askTerms && !agreed) return;
    busy = true;
    note = { text: kind === 'picture' ? L('aiMakingPicture') : L('aiStartingModel') };
    render();
    const acceptTerms = askTerms && agreed ? true : undefined;
    try {
      if (kind === 'picture') {
        const r = await deps.kumo.makePicture({
          prompt: prompt.trim(),
          width: side,
          height: side,
          ...(quality === 'high' ? { quality: 'high' as const } : {}),
          ...(quality === 'seamless' ? { tiling: 'both' as const } : {}),
          ...(acceptTerms ? { acceptTerms } : {}),
        });
        if (!r.ok) refusal(r);
        else {
          askTerms = false;
          note = { text: L('aiAdded', { path: r.path }) };
          if (st && typeof r.balanceCents === 'number') st.balanceCents = r.balanceCents;
          deps.onAdded(r.path);
        }
      } else {
        const r = await deps.kumo.makeModel({ prompt: prompt.trim(), texture, ...(acceptTerms ? { acceptTerms } : {}) });
        if (!r.ok) refusal(r);
        else {
          askTerms = false;
          note = { text: L('aiModelStarted') };
          upsertJob(r);
          void follow(r.id);
        }
      }
    } finally {
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
    try {
      for (let i = 0; i < 60; i++) {
        const r = await deps.kumo.job(id);
        if (!r.ok) {
          if (r.code !== 'unreachable') break;
          await new Promise((res) => setTimeout(res, 5000));
          continue;
        }
        upsertJob(r);
        render();
        if (r.path) {
          deps.onAdded(r.path);
          note = { text: L('aiAdded', { path: r.path }) };
          render();
          break;
        }
        if (r.status === 'failed' || r.status === 'canceled') break;
      }
    } finally {
      polling.delete(id);
    }
  }

  // ---------- render ----------
  function render() {
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

    // kind
    const kinds = h('div', 'gsl-ai-kinds');
    kinds.setAttribute('role', 'group');
    for (const k of ['picture', 'model'] as Kind[]) {
      const b = h('button', 'gsl-chip', k === 'picture' ? L('aiPicture') : L('aiModel'));
      b.type = 'button';
      b.setAttribute('aria-pressed', String(kind === k));
      b.addEventListener('click', () => {
        kind = k;
        render();
      });
      kinds.append(b);
    }
    box.append(kinds);

    const ta = h('textarea', 'gsl-ai-prompt');
    ta.rows = 3;
    ta.maxLength = kind === 'picture' ? 1000 : 1024;
    ta.placeholder = kind === 'picture' ? L('aiPicturePh') : L('aiModelPh');
    ta.setAttribute('aria-label', L('aiPromptLabel'));
    ta.value = prompt;
    ta.addEventListener('input', () => {
      prompt = ta.value;
      makeBtn.disabled = !canMake();
    });
    box.append(ta);

    const opts = h('div', 'gsl-ai-opts');
    if (kind === 'picture') {
      const q = h('select', 'gsl-type');
      q.setAttribute('aria-label', L('aiQuality'));
      for (const [v, k] of [['standard', 'aiFast'], ['high', 'aiFine'], ['seamless', 'aiSeamless']] as const) {
        const o = h('option', undefined, L(k));
        o.value = v;
        o.selected = quality === v;
        q.append(o);
      }
      q.addEventListener('change', () => {
        quality = q.value as PictureQuality;
        render();
      });
      const s = h('select', 'gsl-type');
      s.setAttribute('aria-label', L('aiSize'));
      for (const n of [512, 1024, 2048]) {
        const o = h('option', undefined, `${n} × ${n}`);
        o.value = String(n);
        o.selected = side === n;
        s.append(o);
      }
      s.addEventListener('change', () => {
        side = Number(s.value);
        render();
      });
      opts.append(q, s);
    } else {
      const lab = h('label', 'gsl-ai-check');
      const cb = h('input');
      cb.type = 'checkbox';
      cb.checked = texture;
      cb.addEventListener('change', () => {
        texture = cb.checked;
        render();
      });
      lab.append(cb, document.createTextNode(L('aiTexture')));
      opts.append(lab);
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

    const cost = price();
    const need = centsOf(cost);
    const short = typeof st.balanceCents === 'number' && st.balanceCents < need;
    const priceLine = h('p', short ? 'gsl-ai-bad' : 'gsl-muted', short
      ? L('aiShort', { need: dollars(need), balance: dollars(st.balanceCents ?? 0) })
      : kind === 'picture' ? L('aiPicturePrice', { price: usd(cost) }) : L('aiModelPrice', { price: usd(cost) }));
    box.append(priceLine);

    const canMake = () => !busy && !short && !!prompt.trim() && (!askTerms || agreed);
    const makeBtn = h('button', 'gsl-btn gsl-primary gsl-ai-make', busy ? L('aiMaking') : L('aiMake', { price: usd(cost) }));
    makeBtn.type = 'button';
    makeBtn.disabled = !canMake();
    makeBtn.addEventListener('click', () => void make());
    box.append(makeBtn);

    if (note) {
      const p = h('p', note.bad ? 'gsl-ai-bad' : 'gsl-ai-note', note.text);
      p.setAttribute('role', 'status');
      box.append(p);
      if (note.detail) box.append(h('p', 'gsl-muted gsl-ai-detail', note.detail));
    }

    const jobs = (st.jobs || []).slice(-5).reverse();
    if (jobs.length) {
      const sec = h('div', 'gsl-section');
      sec.append(h('h4', undefined, L('aiRecent')));
      const ul = h('ul', 'gsl-files');
      for (const j of jobs) {
        const where = j.path ? j.path : j.status === 'failed' || j.status === 'canceled' ? L('aiJobFailed') : L('aiJobRunning');
        ul.append(h('li', undefined, `${j.prompt} — ${where}`));
      }
      sec.append(ul);
      box.append(sec);
    }
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
  };
  return api;
}
