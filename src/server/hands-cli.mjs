// `studio.mjs <game folder> --do …`: the AI does editor work itself (studio-ai-hands, 2026-10-24; CONTRACT.md §3.6).
//
//   --do motion.detach --key pillar-1 --name Row                      one op from flags
//   --do '{"do":"motion.make","name":"Spiral","len":4,"repeat":"loop","points":[[0,0,0],…],"key":"pillar-1"}'
//   --do '[{"do":"motion.detach","key":"pillar-1","name":"Row"},{"do":"motion.attach","key":"pillar-1","name":"Spiral"}]'
//
// The editor open: the ops go to the page (hands-relay.mjs) and happen there, on screen — one ⌘Z undoes them, they count
// on Save · n, and the page says "Claude took “Row” off Blue pillar". No editor open (not started, or no page): the same
// ops are written into placement.json (schema/hands.mjs applyHandsToFile, checked by the file's validator), and the
// editor shows them when it opens. Either way one stdout line per op:
//   studio: did took "Row" off pillar-1 - in the editor (on screen now; ⌘Z there undoes it)
//   studio: do failed motion.detach - pillar-1 has no motion "Row" (its motions: "Spiral")
// then, with an editor running, the reply line (the link first in the AI's answer, open-in.mjs).
// Exit 0 = every op done, 1 = one or more failed (the rest were done), 2 = the ops could not be read.
//
// WHY this exists (a request, 2026-10-24): an AI asked to take a motion off an object answered with four steps for the
// person to click. The editor's work is the AI's to do; only the person's Save stays the person's (`save` exists for when
// they say "save it").
import { realpathSync } from 'node:fs';
import { applyHandsToFile, readHandsInput } from '../schema/hands.mjs';
import { validateStudioFile } from '../schema/studio-files.mjs';
import { readResultFile, writeResultFile } from './files.mjs';
import { agentFromEnv } from './which-ai.mjs';

/** The flags an op's fields come from after `--do <op>` (cli.mjs parseArgs). Booleans take no value. */
export const HANDS_FLAG_FIELDS = Object.freeze(['key', 'name', 'to', 'by', 'len', 'repeat', 'when', 'until', 'points', 'keys', 'ease', 'id', 'level',
  // Code motions and layouts (studio-code-base): --code spiral, --knobs '{"gap":4}', --pin '{"key":"hex-3","p":[…]}',
  // --unpin hex-3, --box '{"p":[…],"size":[…]}', --remove 0 | road.
  'code', 'knobs', 'pin', 'unpin', 'box', 'remove',
  // studio-offsets: --offsets '[{"way":"side","how":"same","v":1}]' (a rule's shifts; '[]' takes them off).
  'offsets']);
// A flag of these alone is true; one followed by true / false / a [list] takes it (--hand false, place.code's
// --replace '["lamp-1","lamp-2"]': the hand-placed objects it takes the place of).
export const HANDS_FLAG_BOOLS = Object.freeze(['all', 'replace', 'deg', 'editor', 'hand', 'off']);
/** Fields that are always words (a key "2" stays the text "2"); the others are JSON when they read as JSON. */
const HANDS_TEXT_FIELDS = new Set(['key', 'name', 'id', 'level', 'repeat', 'ease', 'code', 'unpin']);

/** A true / false flag's value: the next word when it is true, false or a [list] (then `used`), else true. */
export function handsBoolValue(next) {
  const t = typeof next === 'string' ? next.trim() : '';
  if (t === 'true' || t === 'false') return { value: t === 'true', used: true };
  if (t.startsWith('[')) {
    try {
      return { value: JSON.parse(t), used: true };
    } catch {
      return { value: t, used: true };
    }
  }
  return { value: true, used: false };
}

/** The value of an op flag: numbers, [lists] and {objects} as JSON, anything else (key:E, a name) as it is. */
export function handsFlagValue(field, raw) {
  if (HANDS_TEXT_FIELDS.has(field)) return raw;
  // A rename's "to" is a name even when it looks like a number ("2"): only move / turn / scale amounts are JSON.
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** What --do was given: JSON (an op or a list) as it is, else one op named by the word with the flags' fields. */
export function handsInput(args) {
  const v = String(args.do ?? '').trim();
  if (v.startsWith('{') || v.startsWith('[')) return v;
  const op = { do: v, ...(args.doFields || {}) };
  if ((op.do === 'object.rename' || op.do === 'motion.rename' || op.do === 'level.rename') && op.to !== undefined) op.to = String(op.to);
  return op;
}

/**
 * Ask the running editor (its server.json entry) to do `ops`. { editor: true, results } when a page did them, { editor:
 * false } when no page is open, { error } when the server could not be reached or the page did not answer.
 */
export async function askEditor(server, ops, by) {
  try {
    const r = await fetch(`${server.origin}/__studio/hands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-studio-agent': server.stopToken },
      body: JSON.stringify({ ops, ...(by ? { by } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await r.json().catch(() => null);
    if (r.status === 422) return { error: (j?.details || [j?.error || 'ops were not read']).join('; ') };
    if (!r.ok || !j) return { error: j?.error || `the editor answered ${r.status}`, editor: j?.editor };
    return j;
  } catch (e) {
    return { error: `the editor could not be reached (${String(e && e.message).slice(0, 80)})` };
  }
}

/**
 * --do. `running`: the editor running for this folder ({ url, origin, stopToken } from server.json) or null;
 * `replyLine(url)`: the line that puts the link first in the AI's answer.
 */
export async function handsCommand(root, args, { running, replyLine, out = (l) => process.stdout.write(l + '\n') }) {
  const read = readHandsInput(handsInput(args));
  if (!read.ok) {
    for (const e of read.errors) out(`studio: do failed - ${e}`);
    out('studio: do help - ops and their fields: CONTRACT.md §3.6, or the arrange skill ("Do it in the editor yourself")');
    return 2;
  }
  const ops = read.ops;
  const by = agentFromEnv(process.env);
  if (running) {
    const r = await askEditor(running, ops, by);
    if (r.editor && Array.isArray(r.results)) {
      const code = printResults(r.results, ops, 'in the editor (on screen now; ⌘Z there undoes it)', out);
      out(replyLine(running.url));
      return code;
    }
    if (r.editor || (r.error && r.editor !== false)) {
      // A page is open but did not answer, or the server could not be reached: writing the file now could be overwritten
      // by the page's own draft a moment later, so nothing is written. The AI tries again (or reads why).
      out(`studio: do failed - ${r.error || 'the editor did not answer'}; nothing was changed. Run the same --do again`);
      return 1;
    }
  }
  // No editor page open: the same ops on placement.json, then the file's own check before anything is written.
  const rootReal = realpathSync(root);
  const { text, error } = await readResultFile(rootReal, 'placement');
  if (error) {
    out(`studio: do failed - ${error}`);
    return 1;
  }
  let file = null;
  if (text !== null) {
    const v = validateStudioFile(text, { tool: 'placement' });
    if (!v.ok) {
      out(`studio: do failed - placement.json is not valid (${v.errors.slice(0, 2).join('; ')}); open the editor (it starts from the game) or fix the file`);
      return 1;
    }
    file = v.value;
  }
  // No file yet: its 2D / 3D from the ops' own numbers (a [x, y] place = 2D), else 3D (three.js, the editor's default).
  const dim = file?.dim ?? (ops.some((o) => [o.to, o.by, o.points?.[0]].some((v) => Array.isArray(v) && v.length === 2)) ? '2d' : '3d');
  const { file: next, results } = applyHandsToFile(file, ops, { dim });
  // Only a change is written (`list` reads, `save` has nothing to do without an editor).
  if (results.some((x, i) => x.ok && ops[i].do !== 'list' && ops[i].do !== 'save')) {
    const v = validateStudioFile(next, { tool: 'placement' });
    if (!v.ok) {
      out(`studio: do failed - the result would not be a valid placement.json (${v.errors.slice(0, 3).join('; ')}); nothing was written`);
      return 1;
    }
    await writeResultFile(rootReal, 'placement', v.json);
  }
  const where = running ? 'in placement.json (the editor is running but no page has it open: it shows there when the page opens)'
    : 'in placement.json (no editor is running: it shows when the editor opens)';
  const code = printResults(results, ops, where, out);
  if (running) out(replyLine(running.url));
  return code;
}

function printResults(results, ops, where, out) {
  let failed = 0;
  results.forEach((x, i) => {
    // `list` is read only: its answer on one line, JSON (the objects' keys, the names the person sees, their motions).
    if (x && x.ok && x.list) out(`studio: list ${JSON.stringify(x.list)}`);
    else if (x && x.ok) out(`studio: did ${x.said || ops[i]?.do} - ${where}`);
    else {
      failed++;
      out(`studio: do failed ${ops[i]?.do ?? ''} - ${(x && x.error) || 'not done'}`);
    }
  });
  return failed ? 1 : 0;
}
