// ▶ Play inside the editor: the game as the editor shows it — the arrangement on screen, saved or not.
//
// WHY (a try of the editor, 2026-10-21: "I moved things, pressed Play without Save, and everything was reset. People want to try
// a change in Play first, then save it"): before, Play showed only what the game's own code does. A game that reads
// placement.json itself (the loader, src/loader) got the moves because the editor writes its hidden draft before Play
// (shell/main.ts keepNow); a game that does not (one the AI just made, before "add the loader") came up at its code's
// layout, and so did every UI move. Since the polish pass of 2026-10-16 Play already showed the copies and deletions
// (they lived only in placement.json); now it shows the moves, the draw orders and the UI places as well.
//
// The file is the editor's draft (the same placement.json the loader reads: on disk with the local studio, in this
// browser in the web demo, src/hosts/browser/game-placement.js), read by the bridge when Play opens the page. Nothing is
// written: Save still writes the file the AI is told about.
//
// Only what the page shows AS ITS CODE MAKES IT is changed, so applying twice is harmless:
//   - a moved object only while it stands at its `was` (the code's own pose): a game whose loader already put it
//     there is left alone, and so is an object the game itself moved since (physics, a boat on the waves);
//   - a copy only when the page does not have that key; a deletion only while the object still looks as `was`;
//   - a reordered list only while it is still in the code's order (`was`).
// The UI (`ui`) goes through the loader's own placeUi() (shared with the editor's UI layer), which sets the same
// offset again rather than adding to it.
import type { Dim, Pose, StudioAdapter } from '../contract.ts';
import { hasLayer, orderOfLayer } from '../shell/layers.ts';
import { samePose } from '../shell/pose-compare.ts';
import { motionAt } from '../loader/studio-placement.js';

type Entry = { p?: unknown; r?: unknown; s?: unknown; t?: unknown; was?: { p?: unknown; r?: unknown; s?: unknown; t?: unknown } };
type Added = { key?: unknown; from?: unknown; p?: unknown; r?: unknown; s?: unknown; t?: unknown };
type Removed = { key?: unknown; label?: unknown; was?: { p?: unknown } };
type Order = { in?: unknown; keys?: unknown; was?: unknown };
export interface PlayFile {
  dim?: unknown;
  objects?: Record<string, Entry>;
  added?: Added[];
  removed?: Removed[];
  order?: Order[];
  motion?: Record<string, unknown>;
}

const nums = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A pose of the file, or null when it is not one (the file is untrusted: a hand edit, an older version). */
function poseOf(e: { p?: unknown; r?: unknown; s?: unknown; t?: unknown }, base?: Pose): Pose | null {
  if (!nums(e.p)) return null;
  const out: Pose = { p: e.p.slice() };
  const r = num(e.r) ? e.r : base?.r;
  if (r !== undefined) out.r = r;
  const s = num(e.s) || nums(e.s) ? e.s : base?.s;
  if (s !== undefined) out.s = Array.isArray(s) ? s.slice() : s;
  const t = nums(e.t) && e.t.length === 2 ? e.t : base?.t;
  if (t) out.t = [t[0]!, t[1]!];
  return out;
}
const flat = (p: Pose): Pose => ({ ...p, z: undefined });

/**
 * Put the file's arrangement on the page's objects (see the top of this file). Returns how many changes were made.
 * `a`: the page's adapter, with objects listed.
 */
export function arrangeInPlay(a: StudioAdapter, file: PlayFile | null): number {
  if (!file || typeof file !== 'object') return 0;
  const dim: Dim = file.dim === '2d' ? '2d' : '3d';
  let shown = 0;
  const list = () => a.list();
  const find = (k: string) => list().find((i) => i.key === k);
  const put = (k: string, p: Pose, what: string) => {
    try {
      if (a.setPose(k, p)) shown++;
    } catch (err) {
      console.warn(`[studio] could not show ${what} ${k} in Play:`, err);
    }
  };

  // Deletions first: an object deleted in the editor is not among the moves.
  if (a.remove && Array.isArray(file.removed)) {
    for (const r of file.removed) {
      const it = typeof r?.key === 'string' ? find(r.key) : undefined;
      if (!it || (typeof r.label === 'string' && r.label !== it.label)) continue;
      const wp = r.was && nums(r.was.p) ? r.was.p : null;
      if (wp && it.pose && it.pose.p.some((v, i) => Math.abs(v - (wp[i] ?? 0)) > 1e-3)) continue;
      try {
        if (a.remove(it.key)) shown++;
      } catch {
        /* keep it */
      }
    }
  }

  // Moves: only an object the page shows where its code puts it (`was`).
  if (file.objects && typeof file.objects === 'object') {
    for (const [k, e] of Object.entries(file.objects)) {
      const it = e && typeof e === 'object' ? find(k) : undefined;
      if (!it || !e.was) continue;
      const was = poseOf(e.was, it.pose), want = poseOf(e, it.pose);
      if (!was || !want) continue;
      if (!samePose(flat(it.pose), flat(was), dim) || samePose(flat(it.pose), flat(want), dim)) continue;
      put(k, want, 'the move of');
    }
  }

  // Copies (polish pass 2026-10-16): a clone of the original as it stands, so it looks right but does not act (a boat
  // that floats, a coin that spins) until the AI adds it to the code. A key the page already has is left alone.
  if (a.clone && Array.isArray(file.added)) {
    for (const e of file.added) {
      if (typeof e?.key !== 'string' || typeof e.from !== 'string') continue;
      if (find(e.key) || !find(e.from)) continue;
      const pose = poseOf(e);
      if (!pose) continue;
      try {
        if (!a.clone(e.from, e.key)) continue;
        a.setPose(e.key, pose);
        shown++;
      } catch (err) {
        console.warn('[studio] could not show the copy ' + e.key + ' in Play:', err);
      }
    }
  }

  // Draw orders (2D): a list still in the code's order gets the editor's (z slots, as the editor's own reorder does).
  if (Array.isArray(file.order)) {
    for (const o of file.order) {
      if (typeof o?.in !== 'string' || !Array.isArray(o.keys)) continue;
      const layer = o.in;
      const raw = list().filter((i) => hasLayer(i) && i.layer === layer);
      const now = orderOfLayer(raw, layer);
      const keys = (o.keys as unknown[]).filter((k): k is string => typeof k === 'string' && now.includes(k));
      if (keys.join('\n') === now.filter((k) => keys.includes(k)).join('\n')) continue;
      if (Array.isArray(o.was)) {
        const was = (o.was as unknown[]).filter((k): k is string => typeof k === 'string');
        if (now.filter((k) => was.includes(k)).join('\n') !== was.filter((k) => now.includes(k)).join('\n')) continue;
      }
      const slots = raw.filter((i) => keys.includes(i.key)).map((i) => i.pose.z!).sort((x, y) => x - y);
      keys.forEach((k, i) => {
        const it = raw.find((x) => x.key === k)!;
        put(k, { ...find(k)?.pose ?? it.pose, z: slots[i]! }, 'the draw order of');
      });
    }
  }
  return shown;
}

/**
 * The draft's motions in ▶ Play (motion-gui, 2026-10-22), for a game whose loader does not run them: a game the AI
 * made before "add the loader", or one with an older copy of it. Every frame of the page (its own
 * requestAnimationFrame: Play is not frozen), each object is put at its place + motionAt(t) through the adapter, as
 * the loader would. Keys the page's loader already moves (the global set it keeps, src/loader) are left alone, so
 * nothing moves twice. Call after arrangeInPlay (the place is the arranged one). Returns the keys it moves.
 */
export function moveInPlay(a: StudioAdapter, file: PlayFile | null, win: Window & typeof globalThis): string[] {
  const motion = file && typeof file === 'object' && file.motion && typeof file.motion === 'object' ? file.motion : null;
  if (!motion) return [];
  const byLoader = (win as unknown as Record<symbol, Set<string> | undefined>)[Symbol.for('game-studio.motion')];
  const items = a.list();
  const runs: Array<{ key: string; m: { path?: number[][]; spin?: number }; base: Pose }> = [];
  for (const [key, m] of Object.entries(motion)) {
    if (byLoader?.has(key) || !m || typeof m !== 'object') continue;
    const it = items.find((i) => i.key === key);
    const mm = m as { path?: unknown; spin?: unknown };
    const pathOk = Array.isArray(mm.path) && mm.path.length > 0 && mm.path.every((q) => nums(q) && q.length === (it?.pose.p.length ?? 0));
    if (!it || (!pathOk && !num(mm.spin))) continue;
    runs.push({ key, m: m as { path?: number[][]; spin?: number }, base: structuredClone(flat(it.pose)) });
  }
  if (!runs.length) return [];
  const t0 = win.performance.now();
  const tick = (now: number) => {
    const t = Math.max(0, (now - t0) / 1000);
    for (const r of runs) {
      const at = motionAt(r.m, t) as { off: number[] | null; turn: number };
      const pose: Pose = { ...r.base, p: at.off ? r.base.p.map((v, i) => v + (at.off![i] ?? 0)) : r.base.p.slice() };
      if (num(r.m.spin)) pose.r = (r.base.r ?? 0) + at.turn;
      try {
        a.setPose(r.key, pose);
      } catch {
        /* the game took it away: the others go on */
      }
    }
    win.requestAnimationFrame(tick);
  };
  win.requestAnimationFrame(tick);
  return runs.map((r) => r.key);
}
