// The editor's link, always with its pass, and where this person likes to open it (a try with v0.1.7 on 2026-10-21, the
// Claude app: "I want to open it in the browser; the app's pane first makes that a chore. Just paste the link").
//
// What went wrong that day: asked "open it in the new editor", the AI wrote two lines about the hidden pane and ⌘⇧B,
// then `http://127.0.0.1:<port>/__studio/` with no `?t=` — a link that only answers "Missing pass" in any other
// browser. The pane's tab shows that bare address (server.mjs trades the pass for a cookie and drops it from the URL),
// and the AI copied it from there. SKILL.md already said "the URL from studio: ready, exactly as printed". Written
// rules were not enough, so the CLI now gives the right link on its own:
//
// - `--link`: the running editor's link, pass included, as the only line on stdout (from .studio/server.json, which
//   the editor writes when it is up, lifecycle.mjs). Nothing to build, nothing to copy from a tab.
// - `--open-in browser|app`: remember where this person opens the editor, in `<game folder>/.studio/open.json`
//   (`{ "version": 1, "open": "browser" }`). With `browser`, `--detach` opens their default browser even when the
//   start line says `--no-open` (the Claude app's line), so the next session in the app does it right without having
//   to read anything. `app` puts it back to the pane next to the chat.
//   WHY a file of its own and not .studio/ui/prefs.json: the editor rewrites prefs.json from its Look page and drops
//   keys it does not know (ui-prefs.ts normalizeUi), so the choice would vanish the next time they change a colour.
//   And not .studio/studio.json: that is the game's rules (snap, bounds) the AI writes for the game, not this person's.
//
// No line anywhere prints the editor's address without its pass (test/link-first.test.mjs checks every output).

import { existsSync, realpathSync } from 'node:fs';
import { readStudioFile, writeStudioFile } from './files.mjs';

export const OPEN_PLACES = ['browser', 'app'];

/** The place this person chose (`'browser'` | `'app'`), or null (never said: the environment decides). */
export async function readOpenPlace(root) {
  if (!existsSync(root)) return null;
  const text = await readStudioFile(realpathSync(root), 'open.json', 4096).catch(() => null);
  try {
    const v = JSON.parse(text || 'null');
    return OPEN_PLACES.includes(v?.open) ? v.open : null;
  } catch {
    return null; // a hand-edited file that isn't JSON: as if never said
  }
}

export async function writeOpenPlace(root, place) {
  return writeStudioFile(realpathSync(root), 'open.json', JSON.stringify({ version: 1, open: place, at: new Date().toISOString() }, null, 2) + '\n');
}

/** A full editor link: the pass is in it. Anything else (a bare /__studio/) must never be printed as the link. */
export const hasPass = (url) => typeof url === 'string' && /\/__studio\/\?(?:.*&)?t=[A-Za-z0-9_-]{8,}/.test(url);

/** The line `--detach` adds after `studio: ready …` when the person opens it in their browser. */
export function browserLine(opened) {
  return opened
    ? 'studio: open browser - this person opens the editor in their browser (.studio/open.json): it opened there. Do not open it next to the chat; put the link first in your reply'
    : 'studio: open browser - this person opens the editor in their browser (.studio/open.json). To bring it up there again: --link --open. Put the link first in your reply';
}
