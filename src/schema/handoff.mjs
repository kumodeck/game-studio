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

// The offsets' ways and hows (CONTRACT.md §1.12 "Offsets"; the same lists as studio-files.mjs — no imports here).
const OFFSET_WAYS_H = ['along', 'side', 'up', 'turn', 'size', 'move'];
const OFFSET_HOWS_H = ['same', 'zigzag', 'ramp', 'jitter'];

export const HANDOFF_LIMITS = Object.freeze({
  maxText: 500, // the person's words; a request is one sentence or two, not a document
  maxObjects: 50, // a multi-selection larger than this is described by its first 50 objects
  maxLabel: 120,
  maxNote: 300,
  maxBytes: 64 * 1024,
  maxFiles: 200, // delete-files: the same limit as POST /next-step
  maxAssets: 50, // files picked in the Library for an "ask" (the same as objects)
  maxObjectFiles: 8, // the files one object is drawn with (a model and its textures; more is cut, not refused)
  maxChoices: 4, // answer buttons under an `asking` question: more than four is a form, not a question
  maxChoice: 40, // one button's words ("Undo it", "Keep it as it is")
  maxAbout: 10, // objects a question is about (lit in the scene)
  maxCompare: 80, // one side of "before → after" under a question
  // "play" (asked while playing, 2026-10-20): the moment that comes with the words.
  maxShot: 1536 * 1024, // the picture as a data URL; a 1024 px JPEG is ~100-250 KB, a PNG of a busy scene more
  maxLogs: 30, // console lines: every error / warning plus the last few lines; more is noise the AI has to skip
  maxLog: 300, // one console line (a stack trace is cut: the first line says what broke)
  maxNear: 12, // things near the player: enough to name "this one", few enough to read
  maxHistory: 12, // pause (2026-10-22): the chat's earlier turns a message carries; the whole talk is in .studio/chat/
  maxPoints: 256, // ✦ Turn into a rule: a motion's points (the timeline's own limit, MAX_KEYS)
});

// 'saved' and 'undone' are written by the host itself, never sent by the browser: 'saved' on every
// Save, 'undone' when the person pressed "Undo AI change" and the host put the game's files back
// (AI feel, 2026-10-16), so the agent does not build on code that is gone.
// 'answer' (2026-10-19, hands-on test): the person's answer to the AI's `asking` question, given in the
// editor (a choice button or their own words in the ask field) instead of in the AI's window.
// 'play' (2026-10-20, "fix it while I play"): the person asked from inside ▶ Play — their words plus the moment (a
// picture of the game, the player's camera, what was near, the console's errors and last lines). Same flow as 'ask'.
export const REQUEST_KINDS = Object.freeze(['ask', 'name', 'next-step', 'saved', 'undone', 'answer', 'play']);
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
// `asking`: the agent waits for the person's answer in its own window; `note` is the question (dogfood 2026-10-17, U2).
export const AI_STATES = Object.freeze(['received', 'working', 'asking', 'done', 'failed']);

const KEY_OK = /^[A-Za-z0-9_:#.\-\/]{1,80}$/;
const ID_OK = /^[0-9]{8}-[0-9]{6}-[0-9]{3}-[a-z-]{2,10}-[0-9a-f]{4}$/;

/** One line of text: control characters and line breaks become spaces, trimmed and cut to max. */
function oneLine(v, max) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

const isFin = (x) => typeof x === 'number' && Number.isFinite(x);

/** A plain path inside the game folder: no leading "/", no "\\", no "..", no hidden parts (.studio, .git). */
const isFolderPath = (f) => typeof f === 'string' && f.length > 0 && f.length <= 512 && !f.startsWith('/') && !f.includes('\\')
  && f.split('/').every((seg) => seg && seg !== '..' && !seg.startsWith('.'));
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
  if (kind !== 'ask' && kind !== 'name' && kind !== 'next-step' && kind !== 'answer' && kind !== 'play') errors.push('kind must be "ask", "name", "next-step", "answer" or "play"');
  const text = oneLine(r.text, HANDOFF_LIMITS.maxText);
  if ((kind === 'ask' || kind === 'answer' || kind === 'play') && !text) errors.push(`an "${kind}" request needs the person's words in "text"`);
  const out = { kind, text };
  // "answer": which request the question was about (`to`, the status's request) and the question itself, so the
  // AI reading the record alone knows what "Keep it" answers. Both are hints: dropped, never an error, when odd.
  if (kind === 'answer') {
    if (isRequestId(r.to)) out.to = r.to;
    const q = oneLine(r.question, HANDOFF_LIMITS.maxNote);
    if (q) out.question = q;
  }
  if (kind === 'next-step') {
    const known = [...AI_STEP_IDS, ...KUMODECK_STEP_IDS, ...FILE_STEP_IDS];
    if (!known.includes(r.step)) errors.push(`unknown step (known: ${known.join(', ')})`);
    else out.step = r.step;
    if (FILE_STEP_IDS.includes(r.step)) {
      // Only the shape here (strings, no "..", no hidden parts); whether each one is a real file
      // in the game folder is the host's check (it has the folder).
      const files = Array.isArray(r.files) ? r.files : [];
      if (!files.length || files.length > HANDOFF_LIMITS.maxFiles) errors.push(`"files" must list 1 to ${HANDOFF_LIMITS.maxFiles} files`);
      else if (!files.every(isFolderPath)) errors.push('"files" must be paths inside the game folder');
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
        // The files it is drawn with ("use the Library", 2026-10-18): a hint for the AI, so a bad entry is dropped,
        // never an error (the request is the person's words; it must not fail over a file name).
        if (Array.isArray(o.files)) {
          const fs = [...new Set(o.files.filter(isFolderPath))].slice(0, HANDOFF_LIMITS.maxObjectFiles);
          if (fs.length) e.files = fs;
        }
        out.objects.push(e);
      }
      if (r.objects.length > HANDOFF_LIMITS.maxObjects) out.moreObjects = r.objects.length - HANDOFF_LIMITS.maxObjects;
    }
  }
  // "ask" only: files picked in the Library ("use the Library", 2026-10-18). Unlike an object's files these are
  // what the words are about ("add this to the scene"), so a list that is not plain folder paths is refused.
  if (r.assets !== undefined && kind === 'ask') {
    const as = Array.isArray(r.assets) ? r.assets : null;
    if (!as || as.length > HANDOFF_LIMITS.maxAssets) errors.push(`"assets" must list at most ${HANDOFF_LIMITS.maxAssets} files`);
    else if (!as.every(isFolderPath)) errors.push('"assets" must be paths inside the game folder');
    else if (as.length) out.assets = [...new Set(as)];
  }
  // "ask" only: motions picked in the Library (studio-motion-triggers, 2026-10-22): what "this motion" means in the
  // words. A hint like an object's files: a bad entry is dropped, never an error. Each keeps its name, length, repeat
  // and the objects it is on (key + when / until, as placement.json has them).
  if (r.motions !== undefined && kind === 'ask' && Array.isArray(r.motions)) {
    const ms = [];
    for (const m of r.motions.slice(0, 20)) {
      const name = m && typeof m.name === 'string' ? oneLine(m.name, 40) : '';
      if (!name || !isFin(m.len) || m.len <= 0) continue;
      const e = { name, len: roundTo(m.len, 1000) };
      if (m.repeat === 'loop' || m.repeat === 'pingpong') e.repeat = m.repeat;
      e.on = (Array.isArray(m.on) ? m.on : []).filter((o) => o && typeof o.key === 'string' && KEY_OK.test(o.key)).slice(0, 50).map((o) => {
        const x = { key: o.key };
        if (o.when && typeof o.when === 'object' && typeof o.when.on === 'string') x.when = JSON.parse(JSON.stringify(o.when));
        if (o.until && typeof o.until === 'object') x.until = JSON.parse(JSON.stringify(o.until));
        return x;
      });
      // ✦ Turn into a rule (studio-code-torule, 2026-10-24): the motion's position points, the shape the AI fits a rule
      // to — as placement.json keeps them (t, v, ease); a bad point is dropped, never an error (it is a hint).
      if (m.keys && typeof m.keys === 'object' && Array.isArray(m.keys.p)) {
        const p = m.keys.p.filter((k) => k && isFin(k.t) && Array.isArray(k.v) && (k.v.length === 2 || k.v.length === 3) && k.v.every(isFin)).slice(0, HANDOFF_LIMITS.maxPoints)
          .map((k) => ({ t: roundTo(k.t, 1000), v: k.v.map((x) => roundTo(x, 1000)), ...(k.ease === 'linear' || k.ease === 'step' || k.ease === 'ease' ? { ease: k.ease } : {}) }));
        if (p.length) e.keys = { p };
      }
      ms.push(e);
    }
    if (ms.length) out.motions = ms;
  }
  // "ask" only: the rule layouts the words are about (studio-code-keepout, 2026-10-24: the card's "✦ Describe with
  // text" under Keep-out areas), each with its keep-out areas as they are now. A hint like `motions`: a bad entry is
  // dropped, never an error.
  if (r.places !== undefined && kind === 'ask' && Array.isArray(r.places)) {
    const ps = [];
    const nums = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).filter(([k, v]) => /^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(k) && isFin(v)).slice(0, 3).map(([k, v]) => [k, roundTo(v, 10000)])) : {});
    for (const p of r.places.slice(0, 8)) {
      if (!p || typeof p.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(p.id)) continue;
      const e = { id: p.id, name: oneLine(typeof p.name === 'string' ? p.name : p.id, 40) || p.id, n: Number.isInteger(p.n) && p.n >= 0 ? Math.min(p.n, 1000) : 0 };
      const k = nums(p.knobs);
      if (Object.keys(k).length) e.knobs = k;
      e.avoid = (Array.isArray(p.avoid) ? p.avoid : []).slice(0, 16).flatMap((a) => {
        if (!a || typeof a !== 'object') return [];
        const off = a.off === true ? { off: true } : {};
        if (a.box && Array.isArray(a.box.p) && Array.isArray(a.box.size) && [...a.box.p, ...a.box.size].every(isFin)) {
          return [{ box: { p: a.box.p.slice(0, 3).map((v) => roundTo(v, 1000)), size: a.box.size.slice(0, 3).map((v) => roundTo(v, 1000)) }, ...(typeof a.name === 'string' && a.name.trim() ? { name: oneLine(a.name, 40) } : {}), ...off }];
        }
        if (typeof a.code !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(a.code)) return [];
        const ak = nums(a.knobs);
        return [{ code: a.code, ...(typeof a.name === 'string' && a.name.trim() ? { name: oneLine(a.name, 80) } : {}), ...(Object.keys(ak).length ? { knobs: ak } : {}), ...off }];
      });
      // ✦ Write into the rule (studio-writeback, 2026-10-24; `intent: "to-knob"`): the way the person wants in the rule,
      // the layout's offsets as they are, and each object's row / rank / what the offsets add — so the AI writes the
      // same shape into at() without counting ranks itself. Hints: a bad part is dropped.
      if (OFFSET_WAYS_H.includes(p.way)) e.way = p.way;
      const offs = (Array.isArray(p.offsets) ? p.offsets : []).slice(0, 8).filter((o) => o && OFFSET_WAYS_H.includes(o.way) && OFFSET_HOWS_H.includes(o.how)
        && (Array.isArray(o.v) ? o.v.length === 2 && o.v.every(isFin) : isFin(o.v)));
      if (offs.length) {
        e.offsets = offs.map((o) => ({ way: o.way, how: o.how, v: Array.isArray(o.v) ? o.v.map((x) => roundTo(x, 10000)) : roundTo(o.v, 10000),
          ...(o.odd === true ? { odd: true } : {}), ...(Number.isInteger(o.seed) ? { seed: o.seed } : {}) }));
      }
      const objs = (Array.isArray(p.objects) ? p.objects : []).slice(0, 200).filter((x) => x && typeof x.key === 'string' && /^[a-z0-9][a-z0-9-]{0,39}-[1-9][0-9]{0,3}$/.test(x.key));
      if (objs.length) {
        e.objects = objs.map((x) => ({ key: x.key, ...(Number.isInteger(x.line) && Number.isInteger(x.rank) ? { line: x.line, rank: x.rank } : {}),
          ...(Array.isArray(x.offset) && x.offset.length <= 3 && x.offset.every(isFin) ? { offset: x.offset.map((v) => roundTo(v, 10000)) } : {}) }));
      }
      ps.push(e);
    }
    if (ps.length) out.places = ps;
  }
  // "ask" only: what a button said the words are for ('avoid': a keep-out area for `places`; 'to-code': the plan's step 4;
  // 'to-knob': ✦ Write into the rule — that way of `places` into the rule as a number of its own, studio-writeback).
  if (kind === 'ask' && (r.intent === 'avoid' || r.intent === 'to-code' || r.intent === 'to-knob' || r.intent === 'ui-code')) out.intent = r.intent;
  // 'ui-code' (studio-canvas-ui stage 2, 2026-10-24: the line's "✦ Ask Claude to make this UI editable"): where the person
  // pressed on the game's screen, the dotted frames the editor showed, and the picture round the press. Hints like
  // `places`: a bad part is dropped, never an error — except a picture that is not a picture (the host writes it to a file).
  if (out.intent === 'ui-code') {
    const xy = (a) => Array.isArray(a) && a.length === 2 && a.every((v) => isFin(v) && Math.abs(v) < 1e6);
    if (xy(r.pressed)) out.pressed = r.pressed.map((v) => Math.round(v));
    if (Array.isArray(r.found)) {
      const fs = r.found.slice(0, 24).filter((f) => f && Array.isArray(f.box) && f.box.length === 4 && f.box.every((v) => isFin(v) && Math.abs(v) < 1e6)
        && (f.from === 'hud-canvas' || f.from === 'left-out')).map((f) => ({ box: f.box.map((v) => Math.round(v)), from: f.from }));
      if (fs.length) out.found = fs;
    }
    if (r.shot !== undefined) {
      const ok = typeof r.shot === 'string' && r.shot.length <= HANDOFF_LIMITS.maxShot && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(r.shot);
      if (!ok) errors.push(`"shot" must be a JPEG or PNG data URL of at most ${HANDOFF_LIMITS.maxShot} characters`);
      else out.shot = r.shot;
    }
  }
  // "name" is always about objects. "ask" with no objects is about the whole
  // game (the ask strip with nothing picked: "make it night", "add enemies";
  // design-pass reviews 2026-10-16); it still needs words.
  if (kind === 'name' && !(out.objects && out.objects.length)) errors.push('a "name" request names at least one object');
  if (r.lang === 'en' || r.lang === 'ja') out.lang = r.lang;
  if (Number.isInteger(r.unsaved) && r.unsaved > 0) out.unsaved = Math.min(r.unsaved, 100000);
  if (r.dim === '2d' || r.dim === '3d') out.dim = r.dim;
  // UI stage 1: the objects are HTML UI elements (data-studio-key). Anything else: left out (= the world, as before).
  if (r.layer === 'ui') out.layer = 'ui';
  // "ask" only: the camera when they asked (contract StudioRequestInput.view). Dropped, never an error, when it is
  // not two points: it is a hint for placing new things, the request works without it.
  const pt = (a) => Array.isArray(a) && a.length === 3 && a.every((x) => isFin(x) && Math.abs(x) < 1e7);
  if ((kind === 'ask' || kind === 'play') && r.view && pt(r.view.eye) && pt(r.view.target)) {
    out.view = { eye: r.view.eye.map((x) => roundTo(x, 1000)), target: r.view.target.map((x) => roundTo(x, 1000)) };
  }
  if (kind === 'play') Object.assign(out, playMoment(r, errors));
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/**
 * "play": the moment that comes with the words (contract §3.5). Everything here is a hint the bridge gathered, so a
 * bad part is dropped, never an error — except a picture that is not a picture (the host writes it to a file).
 * `shot` stays a data URL here; the host turns it into a file and puts the file's path in its place.
 */
function playMoment(r, errors) {
  const out = {};
  if (r.shot !== undefined) {
    const ok = typeof r.shot === 'string' && r.shot.length <= HANDOFF_LIMITS.maxShot && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+=*$/.test(r.shot);
    if (!ok) errors.push(`"shot" must be a JPEG or PNG data URL of at most ${HANDOFF_LIMITS.maxShot} characters`);
    else out.shot = r.shot;
  }
  if (Array.isArray(r.logs)) {
    const logs = [];
    for (const l of r.logs.slice(-HANDOFF_LIMITS.maxLogs)) {
      if (!l || typeof l !== 'object') continue;
      const level = l.level === 'error' || l.level === 'warn' ? l.level : 'log';
      const t = oneLine(l.text, HANDOFF_LIMITS.maxLog);
      if (!t) continue;
      const e = { level, text: t };
      if (isFin(l.ago) && l.ago >= 0) e.ago = roundTo(Math.min(l.ago, 86400), 10);
      logs.push(e);
    }
    if (logs.length) out.logs = logs;
  }
  if (Array.isArray(r.near)) {
    const near = [];
    for (const o of r.near.slice(0, HANDOFF_LIMITS.maxNear)) {
      if (!o || typeof o !== 'object' || typeof o.key !== 'string' || !KEY_OK.test(o.key)) continue;
      const e = { key: o.key };
      const label = oneLine(o.label, HANDOFF_LIMITS.maxLabel);
      if (label && label !== o.key) e.label = label;
      const pose = cleanPose(o.pose);
      if (pose) e.pose = pose;
      if (isFin(o.d) && o.d >= 0) e.d = roundTo(o.d, 100);
      if (Array.isArray(o.screen) && o.screen.length === 2 && o.screen.every((v) => isFin(v) && v > -1 && v < 2)) e.screen = o.screen.map((v) => roundTo(v, 1000));
      near.push(e);
    }
    if (near.length) out.near = near;
  }
  if (r.fullscreen === true) out.fullscreen = true;
  if (Array.isArray(r.size) && r.size.length === 2 && r.size.every((v) => Number.isInteger(v) && v > 0 && v < 100000)) out.size = r.size.slice();
  // Pause (2026-10-22): from the chat over a paused game. `chat` names the talk's first request (a "play" id); a bad one
  // is dropped (the words still go). `history`: the talk so far, each turn one line, the last HANDOFF_LIMITS.maxHistory.
  if (r.paused === true) {
    out.paused = true;
    if (typeof r.chat === 'string' && ID_OK.test(r.chat) && r.chat.includes('-play-')) out.chat = r.chat;
    if (Array.isArray(r.history)) {
      const hist = [];
      for (const h of r.history.slice(-HANDOFF_LIMITS.maxHistory)) {
        if (!h || (h.who !== 'you' && h.who !== 'ai')) continue;
        const t = oneLine(h.text, HANDOFF_LIMITS.maxNote);
        if (t) hist.push({ who: h.who, text: t });
      }
      if (hist.length) out.history = hist;
    }
    // Pause-edit (2026-10-28): ✦ Have Claude make it appear here — something the game made, dragged to where it should
    // appear. A hint like the rest: a bad part is dropped (then `made` too: without the object it says nothing).
    if (r.made === true && r.here && typeof r.here === 'object' && typeof r.here.key === 'string' && KEY_OK.test(r.here.key)) {
      const at = cleanPose(r.here.at);
      const to = cleanPose(r.here.to);
      if (at && to) {
        const here = { key: r.here.key, at, to };
        const label = oneLine(r.here.label, HANDOFF_LIMITS.maxLabel);
        if (label && label !== r.here.key) here.label = label;
        if (isFin(r.here.time) && r.here.time >= 0) here.time = roundTo(Math.min(r.here.time, 86400 * 7), 10);
        out.made = true;
        out.here = here;
      }
    }
    // Pause-edit stage 2 (2026-10-28; CONTRACT.md §1.14): ✦ Have Claude make this moment editable — the moment's list had
    // no codeMoment to show. The AI names the game's numbers once (SKILL.md "This moment"); the moment itself (picture,
    // camera, console) comes with the first request of the pause as for any paused message.
    if (r.intent === 'moment-values') out.intent = 'moment-values';
    // Pause-edit stage 3 (2026-10-28; CONTRACT.md §1.14 "Checkpoints"): ⚑'s ✦ Have Claude let the game start from here
    // ('moment-save': no save() / load() yet, or save() failed) and the line's ✦ when a checkpoint would not open
    // ('moment-load': load() threw, or is gone). `checkpoint` names it (its file id and name) with what went wrong: a hint
    // like the rest, a bad part dropped.
    if (r.intent === 'moment-save' || r.intent === 'moment-load') {
      out.intent = r.intent;
      const c = r.checkpoint && typeof r.checkpoint === 'object' ? r.checkpoint : null;
      if (c) {
        const cp = {};
        if (typeof c.id === 'string' && /^[\p{L}\p{N}][\p{L}\p{N}\p{M}_-]{0,59}$/u.test(c.id)) cp.id = c.id;
        const name = oneLine(c.name, HANDOFF_LIMITS.maxLabel);
        if (name) cp.name = name;
        const error = oneLine(c.error, HANDOFF_LIMITS.maxLog);
        if (error) cp.error = error;
        if (Array.isArray(c.logs)) {
          const logs = [];
          for (const l of c.logs.slice(-HANDOFF_LIMITS.maxLogs)) {
            if (!l || typeof l !== 'object') continue;
            const t = oneLine(l.text, HANDOFF_LIMITS.maxLog);
            if (t) logs.push({ level: l.level === 'error' || l.level === 'warn' ? l.level : 'log', text: t });
          }
          if (logs.length) cp.logs = logs;
        }
        if (Object.keys(cp).length) out.checkpoint = cp;
      }
    }
  }
  return out;
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
  // `asking` only (2026-10-19): the answers the person can press in the editor, the objects the question is about
  // (lit in the scene) and what changes ("before" / "after", one short line each). All optional: a question with
  // none of them still shows, with the ask field to answer in.
  if (raw.state === 'asking') {
    if (Array.isArray(raw.choices)) {
      const cs = [...new Set(raw.choices.map((c) => oneLine(c, HANDOFF_LIMITS.maxChoice)).filter(Boolean))].slice(0, HANDOFF_LIMITS.maxChoices);
      if (cs.length) out.choices = cs;
    }
    if (Array.isArray(raw.about)) {
      const ks = [...new Set(raw.about.filter((k) => typeof k === 'string' && KEY_OK.test(k)))].slice(0, HANDOFF_LIMITS.maxAbout);
      if (ks.length) out.about = ks;
    }
    const before = oneLine(raw.before, HANDOFF_LIMITS.maxCompare);
    const after = oneLine(raw.after, HANDOFF_LIMITS.maxCompare);
    if (before && after) {
      out.before = before;
      out.after = after;
    }
  }
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
