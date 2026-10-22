// What "Make with AI" made in this game folder: .studio/generated.json (generate-ui, 2026-10-22; the product request of 10/22:
// "3D, images, sound and so on each get a proper screen for making them", the brief asks for a history: what was made,
// with which words, make it again, change it a little).
//
// One line per file that landed in assets/: the kind, the words, the options, the file and what it cost. The editor's
// "Made here" list reads it (kumo.mjs status), its Again / Change put a line back in the form (nothing is sent until
// Make), and the person's AI can read it to know what a file was made from ("make another one like the coin sound").
//
// WHY a file and not memory: the 3D jobs list (kumo.mjs `jobs`) is lost on restart, and "what did I ask for last
// week" is the question the history answers. WHY .studio/: it is the editor's own folder in the game (never served to
// the game, never read by the game's code), and only this server writes it (files.mjs STUDIO_WRITABLE; there is no
// route that takes it from the browser). No keys and no KUMODeck URLs go in it — only what the person typed and chose.

import { readStudioFile, writeStudioFile } from './files.mjs';

/** Newest first, at most this many (a busy week of making is well under it; the file stays a few tens of KB). */
export const GENERATED_MAX = 200;
/** What the editor shows and Again / Change can fill: kinds of the form (ai-make.ts / gen-kinds.ts Kind). */
export const GENERATED_KINDS = ['picture', 'model', 'sfx', 'music', 'voice'];
const MAX_BYTES = 512 * 1024;

/** The list, newest first. A missing or hand-broken file reads as empty (the editor must still open). */
export async function readGenerated(rootReal) {
  const text = await readStudioFile(rootReal, 'generated.json', MAX_BYTES).catch(() => null);
  if (!text) return [];
  try {
    const v = JSON.parse(text);
    return Array.isArray(v?.items) ? v.items.filter(isItem).slice(0, GENERATED_MAX) : [];
  } catch {
    return [];
  }
}

function isItem(x) {
  return !!x && typeof x === 'object' && GENERATED_KINDS.includes(x.kind) && typeof x.prompt === 'string' && typeof x.path === 'string';
}

/** One write at a time per folder: two makes landing together (a sound while a 3D model finishes) must both stay. */
const chains = new Map();

/**
 * Add one line at the top. item: { id, kind, prompt, options, path, costUsdMicros }; `at` is added here.
 * Never throws: the file is already in assets/, and a history that could not be written must not turn that into
 * an error on screen (it is logged by the caller's log only when it matters).
 */
export function addGenerated(rootReal, item) {
  const prev = chains.get(rootReal) || Promise.resolve();
  const next = prev.then(async () => {
    const items = await readGenerated(rootReal);
    const line = {
      id: String(item.id || ''),
      at: new Date().toISOString(),
      kind: item.kind,
      prompt: String(item.prompt).slice(0, 1024),
      options: item.options && typeof item.options === 'object' ? item.options : {},
      path: item.path,
      costUsdMicros: typeof item.costUsdMicros === 'number' ? item.costUsdMicros : null,
    };
    // The same job twice (a 3D job looked at again after it landed) is one line.
    const rest = items.filter((x) => !line.id || x.id !== line.id);
    await writeStudioFile(rootReal, 'generated.json', JSON.stringify({ version: 1, items: [line, ...rest].slice(0, GENERATED_MAX) }, null, 2) + '\n');
    return line;
  }).catch(() => null);
  chains.set(rootReal, next);
  return next;
}
