// studio.levels(list) on the game page (levels, 2026-10-22; CONTRACT.md §1.10). Pure, so it is unit-tested.
//
// The game says which levels its code has; the editor's URL (studioLevel / studioBuild, set by the shell's loadGame)
// says which one to show. The answer is { id, build }: `id` = the level the editor shows (it may be one made in the
// editor, which the code does not have yet), `build` = the code's level to build for it (an editor-made level is built
// from the level it was copied from, and placement.json's entry for `id` is laid over it).
//
// WHY the URL and not a message: the game picks its level while it starts, before the editor could answer anything,
// and a page opened again (a reload, ▶ Play, the AI's change) must come back on the same level by itself.
// WHY null outside the editor's frame: in the shipped game (or the game opened on its own) the game's own progress
// picks the level; the studio must not.
import { KEY_RE, LOCAL_PATHS, type LevelInfo, type LevelPick } from '../contract.ts';

/** The game's list, cleaned: ids that fit a key (KEY_RE), each once, labels as text (≤ 120 characters). */
export function cleanLevels(list: unknown): LevelInfo[] {
  const out: LevelInfo[] = [];
  const seen = new Set<string>();
  for (const x of Array.isArray(list) ? list.slice(0, 100) : []) {
    const id = typeof x === 'string' ? x : x && typeof x === 'object' ? (x as { id?: unknown }).id : null;
    if (typeof id !== 'string' || !KEY_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const label = x && typeof x === 'object' ? (x as { label?: unknown }).label : undefined;
    out.push(typeof label === 'string' && label.trim() ? { id, label: label.trim().slice(0, 120) } : { id });
  }
  return out;
}

/**
 * What studio.levels() answers, and the list sent to the editor; null = not in the editor's frame, or no levels.
 * A URL that names a level the code does not have and no `build` it has falls back to the first level.
 */
export function pickLevel(list: unknown, href: string, inFrame: boolean): { levels: LevelInfo[]; pick: LevelPick } | null {
  const levels = cleanLevels(list);
  if (!levels.length || !inFrame) return null;
  const ids = new Set(levels.map((l) => l.id));
  let q: URLSearchParams;
  try {
    q = new URL(href).searchParams;
  } catch {
    q = new URLSearchParams();
  }
  const want = q.get(LOCAL_PATHS.levelParam) || '';
  const build = q.get(LOCAL_PATHS.buildParam) || '';
  if (ids.has(build) && KEY_RE.test(want)) return { levels, pick: { id: want, build } };
  if (ids.has(want)) return { levels, pick: { id: want, build: want } };
  return { levels, pick: { id: levels[0]!.id, build: levels[0]!.id } };
}
