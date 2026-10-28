// This moment's values in the game page (pause-edit stage 2, 2026-10-28; CONTRACT.md §1.14).
//
// The request (2026-10-28): "pause in the middle of a scene and give instructions, by hand or to the AI". The paused
// moment is the editor since stage 1; stage 2 shows the game's own numbers in it — the score, the time left, the health
// — and lets the person (or the AI: `--do moment.set`) change them for this moment only ("5 seconds left: I want to
// see the end"). The editor cannot know them; the AI names them once in the game's code with the loader's
// codeMoment({ values }), and this file is the hands in the game's page:
//   - read: each value's get() now, as plain data for the editor page (`studio:moment/values`). A get() that throws,
//     or answers something that is not a number, never stops the list: that one row says "—" (or its words) and the
//     AI reads why (decided with the plan's "Studio is the hands": a broken value must not break the moment);
//   - change: set(v) — kept inside min / max and on the step here, so the person's drag, a typed number and the AI's
//     op all land on the same value — then ONE frame drawn with time stopped (core time.step(), or the game's
//     studio.redraw(fn)): the HUD shows the new number at once and the game's time does not move (the same one-frame
//     draw as the canvas UI's card, code-ui.ts). Only while the game is paused (the moment): while it runs, the next
//     frame would already have changed it again, and the AI is told `the game is not paused`.
// Message driven and on its own listener, so it answers in an edit page (Edit, ▶ Play in the same page) and in a page
// opened for Play alike — the moment's editor may be either (play-move.ts) and `--do list` asks in Edit too.
import type { BridgeToShell, MomentValue, ShellToBridge } from '../contract.ts';
import { isStudioMessage } from '../contract.ts';
import { momentHooks } from './moment-load.ts';

/** One value as the loader keeps it (codeMoment, src/loader/studio-placement.js). */
interface Entry {
  id: string;
  name: string;
  get: () => unknown;
  set: ((v: number) => void) | null;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  round?: number;
}

type Win = Window & typeof globalThis;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The loader's list in this page (null = the game never called codeMoment). */
export function momentEntries(win: Win): Map<string, Entry> | null {
  const g = (win as unknown as Record<symbol, unknown>)[Symbol.for('game-studio.moment')] as { values?: unknown } | undefined;
  return g && g.values instanceof Map ? (g.values as Map<string, Entry>) : null;
}

/** "Error: x is undefined" → "x is undefined", cut to one line for the list's tooltip and the AI's line. */
const why = (err: unknown) => String((err as Error)?.message ?? err).split('\n')[0]!.slice(0, 120);

/** One value now, as plain data. A broken get() is that row's `error`, never the list's. */
export function readValue(e: Entry): MomentValue {
  const base: MomentValue = { id: e.id, name: e.name, v: null, unit: e.unit || '', set: false,
    ...(num(e.min) ? { min: e.min } : {}), ...(num(e.max) ? { max: e.max } : {}), ...(num(e.step) ? { step: e.step } : {}), ...(num(e.round) ? { round: e.round } : {}) };
  let v: unknown;
  try {
    v = e.get();
  } catch (err) {
    return { ...base, error: why(err) };
  }
  if (num(v)) return { ...base, v, set: typeof e.set === 'function' };
  // Words, a true / false, an object: shown as words, never changed (a knob for "boss" or "true" would be a lie).
  let text = '';
  try {
    text = typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v) ?? String(v);
  } catch {
    text = String(v);
  }
  return { ...base, text: text.slice(0, 40) };
}

/** Every value now; null = no codeMoment in this page. */
export function readMoment(win: Win): MomentValue[] | null {
  const m = momentEntries(win);
  return m ? [...m.values()].map(readValue) : null;
}

/**
 * The value a change puts in (pure; test/moment-values.test.ts): on the step (counted from min when there is one, so
 * min 1 step 2 gives 1, 3, 5), then inside min / max, without float dust (0.1 + 0.2).
 */
export function fitValue(v: number, e: Pick<MomentValue, 'min' | 'max' | 'step'>): number {
  let x = v;
  if (num(e.step) && e.step > 0) {
    const from = num(e.min) ? e.min : 0;
    x = from + Math.round((x - from) / e.step) * e.step;
  }
  if (num(e.min) && x < e.min) x = e.min;
  if (num(e.max) && x > e.max) x = e.max;
  return Number(x.toPrecision(12)) + 0;
}

/**
 * Change one value: set(fit(v)). The AI's line words the refusals (CONTRACT.md §3.6), so they say what to do next.
 * Does not draw: the caller draws one frame once the change is in.
 */
export function setValue(win: Win, id: string, v: unknown): { ok: true; v: number } | { ok: false; error: string } {
  const m = momentEntries(win);
  if (!m) return { ok: false, error: 'the game has no codeMoment() (SKILL.md "This moment": write one, then editor.reload)' };
  const e = m.get(id);
  if (!e) return { ok: false, error: `the game's codeMoment() has no "${id}" (it has: ${[...m.keys()].map((k) => `"${k}"`).join(', ') || 'none'})` };
  if (typeof e.set !== 'function') return { ok: false, error: `"${id}" (${e.name}) is shown only: its codeMoment() value has no set(v)` };
  if (!num(v)) return { ok: false, error: '"v" must be a number' };
  const now = readValue(e);
  if (now.error) return { ok: false, error: `"${id}" (${e.name}): its get() failed (${now.error})` };
  if (now.v === null) return { ok: false, error: `"${id}" (${e.name}) is not a number now (${now.text ?? '?'})` };
  const to = fitValue(v, e);
  try {
    e.set(to);
  } catch (err) {
    return { ok: false, error: `"${id}" (${e.name}): its set(v) failed (${why(err)})` };
  }
  const after = readValue(e);
  return { ok: true, v: after.v ?? to };
}

export interface MomentValuesOptions {
  win: Win;
  parentOrigin: string;
  /** The game is paused now (play-pause.ts): a change is only for a paused moment. */
  paused(): boolean;
  /** Draw the game's ONE frame with time stopped (studio.redraw(fn), else core time.step()). */
  draw(): void;
}

/** Answer the editor page's `moment/ask` and `moment/set` in this game page. */
export function startMomentValues(o: MomentValuesOptions): void {
  const { win } = o;
  const post = (msg: BridgeToShell) => {
    try {
      win.parent.postMessage(msg, o.parentOrigin);
    } catch {
      /* parent gone */
    }
  };
  win.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== win.parent || ev.origin !== o.parentOrigin || !isStudioMessage(ev.data)) return;
    const m = ev.data as ShellToBridge;
    if (m.type === 'studio:moment/ask') {
      // `settle` (the moment just came up): the first frame drawn after a pause runs the game's update with the time
      // between its last frame and the pause (its dt, a few ms) — drawn now, before the person changes anything, every
      // later one-frame draw has none and a value set stays as set (a typed 5 showed 4.98 when this frame came after
      // the set). Only a game with codeMoment, only paused: nothing else is drawn for it.
      if (m.settle && o.paused() && momentEntries(win)) {
        try {
          o.draw();
        } catch (err) {
          console.warn('[studio] the game failed drawing one frame:', err);
        }
      }
      // `checkpoint` (stage 3): ⚑ knows at once whether this game can start from the middle.
      post({ type: 'studio:moment/values', values: readMoment(win), checkpoint: !!momentHooks(win) });
    } else if (m.type === 'studio:moment/set') {
      const n = num(m.n) ? { n: m.n } : {};
      if (!o.paused()) {
        post({ type: 'studio:moment/values', values: readMoment(win), checkpoint: !!momentHooks(win), set: { id: String(m.id), ...n, ok: false, error: 'the game is not paused' } });
        return;
      }
      const r = setValue(win, String(m.id), m.v);
      if (r.ok) {
        try {
          o.draw();
        } catch (err) {
          console.warn('[studio] the game failed drawing one frame:', err);
        }
      }
      post({ type: 'studio:moment/values', values: readMoment(win), checkpoint: !!momentHooks(win), set: { id: String(m.id), ...n, ...r } });
    }
  });
}
