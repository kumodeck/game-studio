// Can ▶ Play happen in the page on screen (no new page, no loading)? The motions' part of main.ts canPlayHere.
//
// WHY (studio-no-reload, 2026-10-22; a try of the editor: "when I go back to edit after playing, don't load — let me go back at
// once"): since the fast switch (v0.1.18) Play turned the edit page itself into Play, but a draft with any motion
// that did not start at once (a clip with a `when`: a key, a click, an area, a cue…) still opened a new Play page,
// because a page opened for Edit never started the loader's motions. Someone trying motions met that page load almost
// every time. Now the game's loader starts them in the edit page (studio-placement.js play hook, bridge/play-switch.ts),
// and the page says so (core/ready `motionHere`).
//
// Without the hook (a game with no loader, or an older copy of it served as it is: the local server answers the game's
// copy with its own loader since integrate 1023, src/server/loader-copy.mjs) the editor's own runner (play-arrange.ts
// moveInPlay) plays what needs nothing of the game: the start, a time, a key, another clip's end. A clip that waits for
// what only the game's loader sees (a click on the object, an area, a touch, a cue, the game's playMotion) opens a new
// Play page there, as before — an older loader on a Play page does run those.
import { whensOf } from '../loader/studio-placement.js';

/** The starts the editor's own runner plays (motionRunner fires `start` and `key`; `time` and `after` come by themselves). */
const BY_EDITOR = new Set(['start', 'time', 'key', 'after']);

/**
 * True when every motion of `motion` (placement.json's world `motion`) can play in this page. `motionHere`: the
 * page's loader has its play hook (core/ready).
 */
export function motionsPlayHere(motion: Record<string, unknown> | undefined, motionHere: boolean): boolean {
  if (motionHere) return true;
  for (const m of Object.values(motion || {})) {
    const clips = (m as { clips?: unknown[] } | undefined)?.clips;
    if (!Array.isArray(clips)) continue;
    for (const c of clips) {
      if (!c || typeof c !== 'object') continue;
      if (whensOf(c).some((w: { on: string }) => !BY_EDITOR.has(w.on))) return false;
    }
  }
  return true;
}
