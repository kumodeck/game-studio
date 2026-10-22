// The game's own copy of the loader (studio-placement.js), answered with the editor's (integrate 1023, 2026-10-23).
//
// WHY: a game copies the loader into its folder once (`import { applyPlacement, stopMotion } from './studio-placement.js'`)
// and keeps that copy. The editor moves on: v0.1.24's ▶ Play in the edit page runs the draft's motions through the
// loader's play hook (bridge/play-switch.ts, CONTRACT.md §3.5.3), which an older copy does not have. A try of the editor
// with a real game (six motions, a copy from before the hook) still met a new page — a load — on every Play → Edit. So the
// editor's server answers a request for the game's copy with its own loader, the one its bridge was built with. Only in
// what the server sends: the file on disk is never changed (the game played anywhere else keeps its copy; the AI copies
// the new one in when it is asked to). The edit page and every Play page the editor opens come from this server, so
// both get the same loader.
//
// How a copy is known (CONTRACT.md §3.5.3): the file is named `studio-placement.js` (any folder of the game) and its
// first line is one of the loader's own headers — the built file's "// KUMODeck Game Studio placement loader" (every
// copy since the first release; build.mjs minifyLoader writes it) or the source's "// studio-placement.js: apply
// placement.json" (src/loader, for a copy taken from the repository) — and it exports `applyPlacement`. Anything else
// with that name (the game's own file, a re-export, a copy rewritten by hand into something else) goes out as it is.
// Every export of an older copy is still in the current loader (they were only ever added), so the game's imports keep
// working.
//
// Not chosen: replacing only copies without the play hook. The bridge and the loader speak one protocol (the hook, the
// clip shapes); the editor's own loader is the one sure to match the editor. A game's copy newer than the editor (a
// newer plugin in another folder) is the rare case, and the newer editor comes with the same update.

/** The file name the loader is copied under (skills/arrange: "copy studio-placement.js next to the game"). */
export const LOADER_NAME = 'studio-placement.js';
/** A copy bigger than this is not the loader (the built file is < 29 KB, the source ~90 KB). */
export const LOADER_COPY_MAX = 512 * 1024;
const HEADERS = ['// KUMODeck Game Studio placement loader', '// studio-placement.js: apply placement.json'];

/** True when `text` is a copy of Game Studio's loader (any version), by its first line and its applyPlacement. */
export function isLoaderCopy(text) {
  if (typeof text !== 'string') return false;
  const first = text.replace(/^﻿/, '').trimStart().split('\n', 1)[0];
  return HEADERS.some((h) => first.startsWith(h)) && /\bexport\s+async\s+function\s+applyPlacement\s*\(/.test(text);
}

/** True when the path (absolute or relative) names a file the server should look at as a possible copy. */
export function mayBeLoaderCopy(file, size) {
  return (file.split(/[\\/]/).pop() || '') === LOADER_NAME && size <= LOADER_COPY_MAX;
}
