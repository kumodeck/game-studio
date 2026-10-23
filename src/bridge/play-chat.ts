// The chat over a paused game (pause, 2026-10-22; CONTRACT.md §3.5.1).
//
// The person pressed P (or ❚❚) in ▶ Play: the game is held where it was (play-pause.ts) and this panel opens over it —
// on the right on a wide screen, as a sheet at the foot on a narrow one. They write, their AI answers, as many times as
// they like; P or "Resume" goes back to the game exactly where it stopped.
//
// WHY no new path to the AI: each message is the same `play` request as the ✦ field's (play-ask.ts), marked `paused`.
// The first one carries the moment taken when the game stopped (picture, player's camera, what was near, the console);
// the next ones carry the talk so far (`history`) and the first one's id (`chat`), so the AI reads one record and
// knows the whole conversation (the host also keeps it as .studio/chat/<id>.json). The AI's replies are the same
// status line the editor already turns into the line over the game (shell/play-ask.ts playLine): its `done` /
// `asking` / `failed` note becomes a reply here, its `received` / `working` the "looking" row while it works.
//
// Lives in play-ask.ts's shadow root and top layer, so it draws over a full-screen game and the game's CSS cannot
// reach it. No colour but the AI's violet, as everywhere in the editor.
import type { PlayLine } from '../contract.ts';
import { icon } from '../shell/icons.ts';

export interface ChatTurn {
  who: 'you' | 'ai';
  text: string;
  /** AI turns: how it ended (fixed = answered / fixed, failed, asking = a question with `choices`). */
  state?: PlayLine['state'];
  choices?: string[];
  reload?: boolean;
  more?: string;
}

/** The turns the next request carries (`history`): the last 12, each cut to 300 characters (HANDOFF_LIMITS). */
export const HISTORY_MAX = 12;
export function historyOf(turns: ChatTurn[]): Array<{ who: 'you' | 'ai'; text: string }> {
  return turns.slice(-HISTORY_MAX).map((t) => ({ who: t.who, text: t.text.length > 300 ? t.text.slice(0, 299) + '…' : t.text }));
}

/**
 * The pure part (test/pause.test.ts): what a new line from the editor does to the chat.
 * - `awaiting`: a message was kept (play/sent ok) and its answer has not come yet. Only then does a finished line
 *   (fixed / failed / asking) become a NEW reply: before the request is kept, the editor may still be showing the
 *   previous request's line, which is already in the chat.
 * - A finished line while not awaiting updates the last reply in place (the AI's files settled and Reload appeared,
 *   "More in Claude" came) — never a second copy of it.
 * - looking / fixing / kept: the row under the talk that says the AI is on it (`live`); a reply clears it. Always
 *   shown: the editor sends these only for the latest request made in this Play, which is the person's own.
 */
export interface ChatModel {
  turns: ChatTurn[];
  awaiting: boolean;
  live: PlayLine | null;
}
export function chatOnLine(m: ChatModel, s: PlayLine | null): ChatModel {
  if (!s) return { ...m, live: null };
  const finished = s.state === 'fixed' || s.state === 'failed' || s.state === 'asking';
  if (!finished) return { ...m, live: s };
  const turn: ChatTurn = { who: 'ai', text: s.text, state: s.state };
  if (s.choices?.length) turn.choices = s.choices.slice();
  if (s.reload) turn.reload = true;
  if (s.more) turn.more = s.more;
  if (m.awaiting) return { turns: [...m.turns, turn], awaiting: false, live: null };
  const last = m.turns[m.turns.length - 1];
  if (last && last.who === 'ai') return { turns: [...m.turns.slice(0, -1), turn], awaiting: false, live: null };
  return { ...m, live: null };
}

export const CHAT_CSS = `
.veil { position: absolute; inset: 0; pointer-events: auto; background: rgba(8, 8, 14, .22); }
/* As tall as the talk, up to the game's height (the first look had it full height: a dark slab with one line of help in
   its middle, over a third of the game the person had stopped to look at). */
.chat { position: absolute; top: 14px; right: 14px; max-height: calc(100% - 28px); width: min(360px, calc(100% - 28px)); pointer-events: auto;
  border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; }
.chat .top { display: flex; align-items: center; gap: 10px; padding: 12px 10px 10px 14px; border-bottom: 1px solid rgba(255,255,255,.08); }
.chat .title { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.chat .title b { font-weight: 600; font-size: 14px; }
/* Wraps instead of "Claude sees this mo…" (plan step 6: with ✥ Move and ▶ Resume P beside it the line was cut).
   keep-all (studio-fix-0142 ⑮, 2026-10-24): Japanese wraps only at a space or at the zero-width spaces its strings put
   between phrases (i18n.ts play.sees / play.chatEmpty) — before, it broke mid-word ("…sees this mome / nt" in Japanese).
   English is unchanged (it breaks at spaces anyway); overflow-wrap: anywhere stays as the last resort for a long word. */
.chat .title .sees { color: rgba(255,255,255,.55); font-size: 12px; word-break: keep-all; overflow-wrap: anywhere; }
.chat .talk { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; }
.chat .empty { color: rgba(255,255,255,.55); font-size: 13px; line-height: 1.45; word-break: keep-all; overflow-wrap: anywhere; }
.chat .you { align-self: flex-end; max-width: 85%; background: rgba(255,255,255,.12); padding: 7px 11px; border-radius: 12px 12px 4px 12px;
  white-space: pre-wrap; overflow-wrap: anywhere; }
.chat .ai { align-self: stretch; display: flex; gap: 9px; }
.chat .ai .dot { margin-top: 5px; }
.chat .ai .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.chat .ai .said { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.45; }
.chat .ai.failed .said { color: rgba(255,255,255,.75); }
.chat .ai .more { color: rgba(255,255,255,.5); font-size: 12px; }
.chat .ai .acts { display: flex; gap: 6px; flex-wrap: wrap; }
.chat .live { display: flex; gap: 9px; align-items: center; color: rgba(255,255,255,.7); }
.chat .live .dot { animation: pulse 1.1s ease-in-out infinite; }
.chat form { display: flex; align-items: center; gap: 8px; margin: 0 10px 10px; padding: 6px 6px 6px 12px; border-radius: 12px;
  background: rgba(255,255,255,.07); border: 1px solid rgba(139,124,255,.45); }
.chat form:focus-within { box-shadow: 0 0 0 3px rgba(139,124,255,.18); }
.chat form input { all: unset; flex: 1; min-width: 0; font: 500 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; padding: 5px 0; }
.chat form input::placeholder { color: rgba(255,255,255,.5); }
.chat .send { all: unset; cursor: pointer; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: #8b7cff; color: #fff; flex: none; }
.chat .send:disabled { background: rgba(255,255,255,.12); color: rgba(255,255,255,.4); cursor: default; }
.chat .send svg { width: 14px; height: 14px; stroke-width: 2px; }
.chat .send:focus-visible { outline: 2px solid #8b7cff; outline-offset: 2px; }
button.b .k { opacity: .55; font-weight: 500; margin-left: 6px; font-size: 11px; }
/* "❚❚ Pause and talk P" (plan step 6): the corner's one button, with its words always (it was a bare 32 px ❚❚ beside the
   ✦ mark; alone now, the words are what say it is the way to talk). The mark's glass, height and key cap. */
.pause { pointer-events: auto; height: 32px; padding: 0 10px 0 11px; border-radius: 16px; display: flex; align-items: center; gap: 8px;
  cursor: pointer; color: inherit; font: inherit; white-space: nowrap; transition: opacity .3s; opacity: .92; }
.pause:hover { opacity: 1; }
.pause .ic { display: grid; place-items: center; }
.pause svg { width: 14px; height: 14px; }
.pause:focus-visible { outline: 2px solid #8b7cff; outline-offset: 2px; }
@media (max-width: 639px) {
  .chat { top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: 55%; border-radius: 16px 16px 0 0; border-bottom: 0; }
  .chat form { margin-bottom: max(10px, env(safe-area-inset-bottom)); }
}
@media (pointer: coarse) {
  .pause { height: 44px; border-radius: 22px; padding: 0 16px 0 14px; }
  .chat .send { width: 36px; height: 36px; }
  button.b .k { display: none; }
}
@media (prefers-reduced-motion: reduce) { .chat .live .dot { animation: none; } }
`;

export interface ChatOptions {
  doc: Document;
  /** play-ask.ts's helpers, so both parts build alike. */
  el: <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string) => HTMLElementTagNameMap[K];
  w: (k: string) => string;
  send(text: string, history: Array<{ who: 'you' | 'ai'; text: string }>): void;
  resume(): void;
  reload(): void;
  /**
   * Moving things while paused (stage 2, play-move.ts): "Move" in the panel's top row, and the card that takes the
   * talk's place while it is on. Absent = no Move button (a game with no adapter to move with).
   */
  move?: { card: HTMLElement; on(): boolean; picked(): boolean; can(): boolean; toggle(): void };
}

export interface Chat {
  /** The veil and the panel, for play-ask.ts to put in its wrap. */
  readonly parts: HTMLElement[];
  readonly input: HTMLInputElement;
  /** A new pause: a new talk. `sees`: what the AI gets with the first message ("This moment · 2 errors"). */
  open(sees: string, draft?: string): void;
  close(): void;
  readonly isOpen: boolean;
  readonly busy: boolean;
  line(s: PlayLine | null): void;
  sent(ok: boolean): void;
  /** The words again after the editor gave them (play/on). */
  render(): void;
}

export function createChat(o: ChatOptions): Chat {
  const { el, w } = o;
  let model: ChatModel = { turns: [], awaiting: false, live: null };
  let open = false;
  let sending = false;
  let sendFailed = false;
  let sees = '';

  const veil = el('div', 'veil');
  veil.dataset.part = 'pause-veil';
  veil.hidden = true;
  const panel = el('section', 'chat glass');
  panel.dataset.part = 'pause-chat';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  const top = el('div', 'top');
  const title = el('div', 'title');
  const head = el('b', '');
  const seesEl = el('span', 'sees');
  title.append(head, seesEl);
  const resumeBtn = el('button', 'b', '') as HTMLButtonElement;
  resumeBtn.type = 'button';
  resumeBtn.dataset.action = 'pause-resume';
  resumeBtn.addEventListener('click', () => o.resume());
  // "Move" left of Resume: the panel's one other way, so both are where the eye already is (design.md §5).
  const moveBtn = o.move ? (el('button', 'b', '') as HTMLButtonElement) : null;
  if (moveBtn && o.move) {
    moveBtn.type = 'button';
    moveBtn.dataset.action = 'pause-move';
    const m = o.move;
    moveBtn.addEventListener('click', () => m.toggle());
  }
  top.append(title, ...(moveBtn ? [moveBtn] : []), resumeBtn);
  const talk = el('div', 'talk');
  talk.setAttribute('aria-live', 'polite');
  const form = el('form', '');
  const input = el('input', '') as HTMLInputElement;
  input.type = 'text';
  input.maxLength = 500;
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('enterkeyhint', 'send');
  const sendBtn = el('button', 'send') as HTMLButtonElement;
  sendBtn.type = 'submit';
  sendBtn.append(icon('send'));
  form.append(input, sendBtn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit(input.value);
  });
  input.addEventListener('input', () => {
    sendFailed = false;
    sendBtn.disabled = !input.value.trim() || sending;
  });
  panel.append(top, talk, form, ...(o.move ? [o.move.card] : []));

  function submit(text: string) {
    const t = text.trim();
    if (!t || sending) return;
    sending = true;
    sendFailed = false;
    // The talk so far goes with it (the AI's question included, so a choice answers it).
    const history = historyOf(model.turns);
    model = { ...model, turns: [...model.turns, { who: 'you', text: t }], live: null };
    input.value = '';
    render();
    o.send(t, history);
  }

  function render() {
    const moving = !!o.move?.on();
    // Moving: no veil (the objects are what the person looks at, and the presses go to them) and the card in the
    // talk's place. The talk is kept as it was for "Chat".
    veil.hidden = !open || moving;
    panel.hidden = !open;
    panel.classList.toggle('moving', moving);
    if (!open) return;
    // Words only: a 12 px ❚❚ before "Paused" read as a stray mark (design pass, 2026-10-22).
    head.textContent = w('paused');
    // Moving: the line under "Paused" says what to do (the card says what happened to the picked one).
    seesEl.textContent = moving ? w('movePick') : sees;
    talk.hidden = moving;
    form.hidden = moving;
    if (o.move) o.move.card.hidden = !moving;
    if (moveBtn) {
      moveBtn.replaceChildren();
      const ic = el('span', 'ic');
      ic.append(icon(moving ? 'spark' : 'move'));
      moveBtn.append(ic, o.doc.createTextNode(moving ? w('talk') : w('move')));
      moveBtn.title = moving ? w('talkTip') : w('moveTip');
      moveBtn.setAttribute('aria-pressed', String(moving));
      // Nothing to move with (no adapter found for this game): no button that would do nothing.
      moveBtn.hidden = !moving && !o.move!.can();
    }
    // "▶ Resume P" (plan step 6): the play mark says it is the game going on, beside "✥ Move".
    const playIc = el('span', 'ic');
    playIc.append(icon('play'));
    resumeBtn.replaceChildren(playIc, o.doc.createTextNode(w('resume')), el('span', 'k', 'P'));
    resumeBtn.title = w('resumeTip');
    input.placeholder = sending ? w('sending') : sendFailed ? w('sendFail') : w('chatPlaceholder');
    input.disabled = sending;
    sendBtn.disabled = sending || !input.value.trim();
    sendBtn.setAttribute('aria-label', w('send'));
    talk.replaceChildren();
    if (!model.turns.length) talk.append(el('div', 'empty', w('chatEmpty')));
    model.turns.forEach((t, i) => {
      if (t.who === 'you') {
        talk.append(el('div', 'you', t.text));
        return;
      }
      const row = el('div', `ai${t.state === 'failed' ? ' failed' : ''}`);
      row.dataset.part = 'pause-reply';
      const body = el('div', 'body');
      body.append(el('div', 'said', t.text));
      const last = i === model.turns.length - 1;
      const acts = el('div', 'acts');
      // Choices answer only the question still open (the last turn): an old question's buttons would answer nothing.
      if (last && t.state === 'asking' && t.choices) {
        t.choices.forEach((c, n) => {
          const b = el('button', n === 0 ? 'b primary' : 'b', c) as HTMLButtonElement;
          b.type = 'button';
          b.addEventListener('click', () => submit(c));
          acts.append(b);
        });
      }
      if (last && t.reload) {
        const b = el('button', 'b primary', w('reload')) as HTMLButtonElement;
        b.type = 'button';
        b.dataset.action = 'pause-reload';
        b.title = w('reloadTip');
        b.addEventListener('click', () => o.reload());
        acts.append(b);
      }
      if (acts.childNodes.length) body.append(acts);
      // "More in Claude": words, not a button (a web page cannot bring the AI's window forward), as the line's.
      if (last && t.more) body.append(el('div', 'more', t.more));
      row.append(el('span', 'dot'), body);
      talk.append(row);
    });
    const live = model.live;
    if (live && (live.state === 'looking' || live.state === 'fixing' || live.state === 'kept')) {
      const row = el('div', 'live');
      row.dataset.part = 'pause-live';
      row.append(el('span', 'dot'), el('span', '', live.text));
      talk.append(row);
    }
    talk.scrollTop = talk.scrollHeight;
  }

  return {
    parts: [veil, panel],
    input,
    get isOpen() {
      return open;
    },
    get busy() {
      return sending;
    },
    open(s, draft) {
      // A new pause is a new moment, so a new talk (showing the last one is for a later stage).
      model = { turns: [], awaiting: false, live: null };
      sending = false;
      sendFailed = false;
      sees = s;
      open = true;
      input.value = draft || '';
      render();
      input.focus({ preventScroll: true });
    },
    close() {
      open = false;
      input.blur();
      render();
    },
    line(s) {
      model = chatOnLine(model, s);
      render();
    },
    sent(ok) {
      sending = false;
      if (ok) model = { ...model, awaiting: true };
      else {
        // Not kept: the words go back in the field to send again.
        sendFailed = true;
        const last = model.turns[model.turns.length - 1];
        if (last && last.who === 'you') {
          input.value = last.text;
          model = { ...model, turns: model.turns.slice(0, -1) };
        }
      }
      render();
      if (open) input.focus({ preventScroll: true });
    },
    render,
  };
}
