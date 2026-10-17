// Hand-offs between the editor and the user's AI agent (contract 3.4): "requests" the person
// sends from the editor (ask about these objects, name this object, a next step, a save) and the
// one "status" the agent writes back (received / working / done, how many things it changed).
//
// WHY files with a fixed shape, and why here: the person talks to the AI in the AI's own window
// (Claude Code, a terminal, a cloud session), never in the editor. The editor's side of the
// conversation is one-way and has to survive the AI not watching at that moment, so every request
// is kept as a small JSON record first (locally .studio/requests/<id>.json) and the agent reads
// all of them when the person says "look". The same shapes will be read and written through the
// KUMODeck API / MCP tools by a hosted editor, so the shell, the local server and a hosted server
// all normalise with this one module, like studio-files.mjs does for the result files.
//
// Plain JavaScript, no imports: runs in Node, in the browser and inside the bundled CLI.

export const HANDOFF_LIMITS = Object.freeze({
  maxText: 500, // the person's words; a request is one sentence or two, not a document
  maxObjects: 50, // a multi-selection larger than this is described by its first 50 objects
  maxLabel: 120,
  maxNote: 300,
  maxBytes: 64 * 1024,
  maxFiles: 200, // delete-files: the same limit as POST /next-step
});

// 'saved' and 'undone' are written by the host itself, never sent by the browser: 'saved' on every
// Save, 'undone' when the person pressed "Undo AI change" and the host put the game's files back
// (AI feel, 2026-10-16), so the agent does not build on code that is gone.
export const REQUEST_KINDS = Object.freeze(['ask', 'name', 'next-step', 'saved', 'undone']);
/** Next steps that stay inside this game (no service involved), shown first on the next-steps page. */
export const AI_STEP_IDS = Object.freeze(['fit', 'look', 'tool']);
/** Next steps that use KUMODeck (the server also writes .studio/next-step.md for these). */
export const KUMODECK_STEP_IDS = Object.freeze(['publish', 'multiplayer', 'save-data', 'ai-assets']);
/**
 * Next steps that carry a list of files: the Library's "Ask my AI to delete it" on unused files.
 * Sent through the same request as every other step (merge of edit-ops + AI partner, 2026-10-16),
 * so the AI line in the editor follows it too. The host checks each file exists before keeping it.
 */
export const FILE_STEP_IDS = Object.freeze(['delete-files']);
export const AI_STATES = Object.freeze(['received', 'working', 'done', 'failed']);

const KEY_OK = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;
const ID_OK = /^[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-z-]{2,10}-[0-9a-f]{4}$/;

/** One line of text: control characters and line breaks become spaces, trimmed and cut to max. */
function oneLine(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const isFin = (x) => typeof x === 'number' && Number.isFinite(x);
const roundTo = (x, step) => Math.round(x * step) / step;

/** A pose as the editor has it right now (may be unsaved); dropped when it is not a sane pose. */
function cleanPose(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.p) || (p.p.length !== 2 && p.p.length !== 3) || !p.p.every(isFin)) return undefined;
  const out = { p: p.p.map((v) => roundTo(v, 1000)) };
  if (isFin(p.r)) out.r = roundTo(p.r, 10000);
  if (Array.isArray(p.t) && p.t.length === 2 && p.t.every(isFin)) out.t = [roundTo(p.t[0], 10000), roundTo(p.t[1], 10000)];
  if (isFin(p.s) && p.s > 0) out.s = roundTo(p.s, 10000);
  else if (Array.isArray(p.s) && p.s.length === 3 && p.s.every((v) => isFin(v) && v > 0)) out.s = p.s.map((v) => roundTo(v, 10000));
  if (isFin(p.z)) out.z = Math.round(p.z);
  return out;
}

/**
 * Check what the shell sends (StudioRequestInput) and return the record to store, or errors.
 * The host adds `id` and `at`; nothing from the browser decides file names or times.
 *
 * @param {unknown} input
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function normalizeRequestInput(input) {
  const errors = [];
  const r = input && typeof input === 'object' && !Array.isArray(input) ? input : null;
  if (!r) return { ok: false, errors: ['request must be a JSON object'] };
  const kind = r.kind;
  // 'saved' records are written by the host itself when a result file is saved, never sent.
  if (kind !== 'ask' && kind !== 'name' && kind !== 'next-step') errors.push('kind must be "ask", "name" or "next-step"');
  const text = oneLine(r.text, HANDOFF_LIMITS.maxText);
  if (kind === 'ask' && !text) errors.push('an "ask" request needs the person\'s words in "text"');
  const out = { kind, text };
  if (kind === 'next-step') {
    const known = [...AI_STEP_IDS, ...KUMODECK_STEP_IDS, ...FILE_STEP_IDS];
    if (!known.includes(r.step)) errors.push(`unknown step (known: ${known.join(', ')})`);
    else out.step = r.step;
    if (FILE_STEP_IDS.includes(r.step)) {
      // Only the shape here (strings, no "..", no hidden parts); whether each one is a real file
      // in the game folder is the host's check (it has the folder).
      const files = Array.isArray(r.files) ? r.files : [];
      if (!files.length || files.length > HANDOFF_LIMITS.maxFiles) errors.push(`"files" must list 1 to ${HANDOFF_LIMITS.maxFiles} files`);
      else if (!files.every((f) => typeof f === 'string' && f.length <= 512 && !f.startsWith('/') && !f.includes('\\') && f.split('/').every((seg) => seg && seg !== '..' && !seg.startsWith('.')))) errors.push('"files" must be paths inside the game folder');
      else out.files = [...new Set(files)].sort();
    }
  }
  if (r.objects !== undefined) {
    if (!Array.isArray(r.objects)) errors.push('objects must be a list');
    else {
      out.objects = [];
      for (const o of r.objects.slice(0, HANDOFF_LIMITS.maxObjects)) {
        if (!o || typeof o !== 'object' || typeof o.key !== 'string' || !KEY_OK.test(o.key)) {
          errors.push('every object needs a valid "key"');
          break;
        }
        const e = { key: o.key };
        const label = oneLine(o.label, HANDOFF_LIMITS.maxLabel);
        if (label && label !== o.key) e.label = label;
        const pose = cleanPose(o.pose);
        if (pose) e.pose = pose;
        if (o.unstable === true) e.unstable = true;
        out.objects.push(e);
      }
      if (r.objects.length > HANDOFF_LIMITS.maxObjects) out.moreObjects = r.objects.length - HANDOFF_LIMITS.maxObjects;
    }
  }
  // "name" is always about objects. "ask" with no objects is about the whole
  // game (the ask strip with nothing picked: "make it night", "add enemies";
  // design-pass reviews 2026-10-16); it still needs words.
  if (kind === 'name' && !(out.objects && out.objects.length)) errors.push('a "name" request names at least one object');
  if (r.lang === 'en' || r.lang === 'ja') out.lang = r.lang;
  if (Number.isInteger(r.unsaved) && r.unsaved > 0) out.unsaved = Math.min(r.unsaved, 100000);
  if (r.dim === '2d' || r.dim === '3d') out.dim = r.dim;
  // "ask" only: the camera when they asked (contract StudioRequestInput.view). Dropped, never an error, when it is
  // not two points: it is a hint for placing new things, the request works without it.
  const pt = (a) => Array.isArray(a) && a.length === 3 && a.every((x) => isFin(x) && Math.abs(x) < 1e7);
  if (kind === 'ask' && r.view && pt(r.view.eye) && pt(r.view.target)) {
    out.view = { eye: r.view.eye.map((x) => roundTo(x, 1000)), target: r.view.target.map((x) => roundTo(x, 1000)) };
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/**
 * Request id = file name stem: sortable by time, says what it is, never repeats in practice.
 * "20261016-153012-482-ask-9f3c" (UTC).
 */
export function requestId(kind, now = new Date(), rand = Math.random) {
  const d = now.toISOString(); // 2026-10-16T15:30:12.482Z
  const stamp = `${d.slice(0, 4)}${d.slice(5, 7)}${d.slice(8, 10)}-${d.slice(11, 13)}${d.slice(14, 16)}${d.slice(17, 19)}-${d.slice(20, 23)}`;
  const tail = Math.floor(rand() * 0x10000).toString(16).padStart(4, '0');
  return `${stamp}-${kind}-${tail}`;
}

export function isRequestId(id) {
  return typeof id === 'string' && ID_OK.test(id);
}

/**
 * Read what the agent wrote to the status (locally .studio/status.json). Hand-written by an AI, so
 * lenient: anything unknown is dropped and a broken file reads as "no status" instead of an error.
 *
 * @returns {{ state: string, request?: string, changed?: number, note?: string, at?: string } | null}
 */
export function normalizeStatus(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!AI_STATES.includes(raw.state)) return null;
  const out = { version: 1, state: raw.state };
  if (isRequestId(raw.request)) out.request = raw.request;
  if (Array.isArray(raw.handled)) {
    const ids = raw.handled.filter(isRequestId).slice(0, 200);
    if (ids.length) out.handled = ids;
  }
  if (Number.isInteger(raw.changed) && raw.changed >= 0) out.changed = Math.min(raw.changed, 100000);
  const note = oneLine(raw.note, HANDOFF_LIMITS.maxNote);
  if (note) out.note = note;
  if (typeof raw.at === 'string' && !Number.isNaN(Date.parse(raw.at))) out.at = new Date(Date.parse(raw.at)).toISOString();
  return out;
}

/**
 * Did the agent see this request? Yes when the status names it (request / handled), or when the
 * status was written at or after the request (the agent read the whole folder after "look").
 *
 * @param {{ id: string, at: number }} req  `at` in ms
 * @param {object | null} status  normalised status
 * @param {number | null} statusTime  when the status was last written (ms), from the host
 */
export function statusCovers(req, status, statusTime) {
  if (!req || !status) return false;
  if (status.request === req.id || (status.handled && status.handled.includes(req.id))) return true;
  // Ids sort by time, so a later id in "request" also means the agent read past this one.
  if (status.request && isRequestId(req.id) && status.request > req.id) return true;
  const t = typeof statusTime === 'number' ? statusTime : status.at ? Date.parse(status.at) : NaN;
  return typeof t === 'number' && Number.isFinite(t) && t >= req.at;
}
