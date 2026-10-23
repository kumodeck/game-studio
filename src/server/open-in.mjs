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
//   to read anything. `app` puts it back to the pane next to the chat (and from 2026-10-23 nothing opens by itself).
//   WHY a file of its own and not .studio/ui/prefs.json: the editor rewrites prefs.json from its Look page and drops
//   keys it does not know (ui-prefs.ts normalizeUi), so the choice would vanish the next time they change a colour.
//   And not .studio/studio.json: that is the game's rules (snap, bounds) the AI writes for the game, not this person's.
//
// No line anywhere prints the editor's address without its pass (test/link-first.test.mjs checks every output).
//
// The browser by default, and a line the AI can't miss (link always, 2026-10-23). Opened in the Claude app
// with v0.1.24, the AI started the editor with `--no-open`, put it in the pane next to the chat (preview_start) and
// answered with the app's "open" card and a sentence: no link anywhere in the reply, nothing in the person's browser.
// SKILL.md said "the link on the first line, every time" in two places; it was not followed. So, in the CLI:
// - Where it opens: their default browser unless they said otherwise (`openPlace` below). No open.json = browser,
//   in the app too; the pane next to the chat only after `--open-in app` ("open it next to the chat"), and then
//   nothing opens by itself. `--no-open` still holds when there is no choice on file (tests, a person who asked).
// - After every `studio: ready` (a fresh start, the same line run again, `--open-in`; `--link` on stderr) comes
//   `replyLine`: what to put first in the answer, with the link in it, so following the command's output is enough.
//   Then `openLine`: what happened to the browser, so the AI does not reach for the pane or say "it's open" when it
//   is not.

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

/**
 * Where the editor opens and whether it opens now. `place`: what open.json says (null = never said). Returns
 * { place, open }: place 'browser' | 'app' | 'none' (`--no-open` with nothing on file) | 'nowhere' (no browser can be
 * started from here), and open = start their default browser now.
 * WHY a remembered `browser` beats `--no-open`: an AI used to the app's old start line (`--detach --no-open`) would
 * otherwise keep the browser shut for a person who asked for it (link-first, 2026-10-21).
 */
export function openPlace({ place, noOpen = false, env = process.env, platform = process.platform }) {
  if (place === 'app') return { place: 'app', open: false };
  if (place !== 'browser' && noOpen) return { place: 'none', open: false };
  if (!canOpenBrowser(env, platform)) return { place: 'nowhere', open: false };
  return { place: 'browser', open: true };
}

/**
 * Can a browser be started for the person from this process? Not over SSH (the person's screen is elsewhere; on a
 * Mac `open` would put it on the remote machine's screen), not on Linux without a display. STUDIO_BROWSER (tests,
 * try-outs) always can. Best effort: a missing `xdg-open` is only found out when it fails (the log says so).
 */
export function canOpenBrowser(env = process.env, platform = process.platform) {
  if (env.STUDIO_BROWSER) return true;
  if (env.SSH_CONNECTION || env.SSH_TTY) return false;
  if (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
  return true;
}

/**
 * The line right after every `studio: ready`: the reply's first line, the link in it. WHY the link again, on its own
 * line: the AI copies from the line that tells it what to do, and "exactly as printed" leaves it nothing to build.
 */
export const replyLine = (url) => `studio: reply with this link alone on the first line of your answer, exactly as printed: ${url}`;

const OPEN_YOURSELF = 'After the link, tell them: "Open this link in your browser."';

/**
 * The line after `replyLine`: what happened to the browser. `how`: openPlace's place; `opened`: a browser was started
 * now; `seen`: the editor was opened somewhere before (the same line run again: no second tab).
 */
export function openLine(how, { opened = false, seen = false } = {}) {
  if (how === 'app') {
    return 'studio: open app - this person opens the editor next to the chat (.studio/open.json): nothing opened by itself. Open the link with preview_start; no such tool: ' + OPEN_YOURSELF;
  }
  if (how === 'none') return `studio: open none - nothing opened (--no-open). ${OPEN_YOURSELF}`;
  if (how === 'nowhere') return `studio: open none - no browser can be opened from here (SSH or no display). ${OPEN_YOURSELF}`;
  if (opened) return 'studio: open browser - it opened in their default browser. Do not also open it next to the chat (no preview_start); say it is open in their browser';
  return seen
    ? 'studio: open browser - already open in their browser, so no second tab was opened. If they cannot find it: --link --open'
    : 'studio: open browser - not opened now. To bring it up in their browser: --link --open';
}
