// The AI's question, answered in the editor (hands-on test 2026-10-19).
//
// Before, the line said "Your AI has a question — answer it in Claude Code" and the only way to answer was another
// window, with the ask field right below. Now the question comes with what the person needs to answer it:
// - its answers as buttons (status `choices`, written by `--status asking --choice …`), and the ask field answers in
//   their own words: either one goes back to the AI as an `answer` request;
// - the objects it is about (status `about`), lit in the scene;
// - what changes, side by side: the AI's own two lines (`before` / `after`), or, when it named one object and gave
//   none, that object's pose in the game's code next to its pose in the editor now (what the person moved).
// Pure functions, tested without a browser (test/ai-ask.test.ts); main.ts draws what they return.
import type { Dim, Pose, StudioStatus } from '../contract.ts';

export interface AskView {
  question: string;
  choices: string[];
  about: string[];
  compare: { before: string; after: string } | null;
}

const num = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return String(Object.is(r, -0) ? 0 : r);
};

/**
 * One object's change as two short lines ("y 0" / "y 16"): only what differs, position first, then turn and size.
 * null when nothing differs. `words` = the localised "turn" / "size".
 */
export function poseChange(was: Pose | undefined, now: Pose | undefined, dim: Dim, words: { turn: string; size: string }): { before: string; after: string } | null {
  if (!was || !now) return null;
  const b: string[] = [];
  const a: string[] = [];
  const axes = dim === '3d' ? ['x', 'y', 'z'] : ['x', 'y'];
  axes.forEach((ax, i) => {
    const x = was.p[i] ?? 0;
    const y = now.p[i] ?? 0;
    // 1 cm / 0.1 px: below that it is the file's rounding, not a change the person made.
    if (Math.abs(x - y) >= (dim === '3d' ? 0.01 : 0.1)) {
      b.push(`${ax} ${num(x)}`);
      a.push(`${ax} ${num(y)}`);
    }
  });
  const deg = (r: number | undefined) => Math.round(((r ?? 0) * 180) / Math.PI);
  // The turn the editor's ring gives (r = rotation.y in 3D, the angle in 2D); a tilt (t) is rare and left out.
  const turnOf = (p: Pose) => deg(p.r);
  if (turnOf(was) !== turnOf(now)) {
    b.push(`${words.turn} ${turnOf(was)}°`);
    a.push(`${words.turn} ${turnOf(now)}°`);
  }
  const sizeOf = (p: Pose) => (Array.isArray(p.s) ? Math.max(...p.s) : (p.s ?? 1));
  if (Math.abs(sizeOf(was) - sizeOf(now)) >= 0.01) {
    b.push(`${words.size} ${num(sizeOf(was))}×`);
    a.push(`${words.size} ${num(sizeOf(now))}×`);
  }
  return b.length ? { before: b.join(' · '), after: a.join(' · ') } : null;
}

/**
 * What to show for an `asking` status. `poses` gives an object's pose in the game's code (`was`) and in the editor
 * now, for the one-object fallback of the comparison.
 */
export function askView(st: StudioStatus | null, poses: (key: string) => { was?: Pose; now?: Pose }, dim: Dim, words: { turn: string; size: string }): AskView | null {
  if (!st || st.state !== 'asking') return null;
  const about = st.about ?? [];
  let compare = st.before && st.after ? { before: st.before, after: st.after } : null;
  if (!compare && about.length === 1) {
    const p = poses(about[0]!);
    compare = poseChange(p.was, p.now, dim, words);
  }
  return { question: st.note ?? '', choices: st.choices ?? [], about, compare };
}
