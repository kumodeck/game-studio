// The local studio server: serves one game folder to the editor and writes the result files.
//
// It is the local version of the host interface (contract 3). It listens on 127.0.0.1 only (or on
// the LAN address with --lan), on a free port, and every request must carry the one-time pass.
//
// Threats it is built against, and the guard for each:
// - Another web page in the same browser calls http://127.0.0.1:<port>/ (CSRF / drive-by): it does
//   not know the pass, and the session cookie is SameSite=Strict, so its requests are refused.
//   Writes additionally require a same-origin Origin / Sec-Fetch-Site when the browser sends them.
// - DNS rebinding (evil.example resolving to 127.0.0.1): the Host header must be exactly the
//   address we listen on, otherwise 403 before anything else happens.
// - Reading files outside the game folder: see files.mjs (realpath check, no dot-files).
// - Overwriting the user's files: only our two result files are ever replaced; new assets get a
//   fresh name; nothing is deleted.
// - Someone on the same Wi-Fi (--lan): same pass requirement; there is no way to turn it off.
//
// URL layout:
//   /__studio/            the editor shell (built UI, or a small fallback page when not built)
//   /__studio/host.js     local host implementation for the shell
//   /__studio/studio-placement.js   the loader (so a game can try it before copying it in)
//   /__studio/api/...     JSON API (see handleApi)
//   /__studio/<file>      other files of the built UI (studio-edit.js, shell assets)
//   /<anything else>      the game folder; HTML responses get the edit script injected

import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateStudioFile, isSafeRelativePath, LIMITS, KEY_RE } from '../schema/studio-files.mjs';
import {
  RESULT_FILES, resolveInside, mimeOf, injectEditScript, writeResultFile, readResultFile, writeStudioNote, readGameAdapter, readStudioFile, writeStudioFile,
  readStudioFileInfo, writeNextStep, addAsset, httpError,
} from './files.mjs';
import { normalizeRequestInput, normalizeStatus, requestId, isRequestId, KUMODECK_STEP_IDS, FILE_STEP_IDS } from '../schema/handoff.mjs';
import { listAssets } from './assets.mjs';
import { nextStepMarkdown, NEXT_STEP_IDS } from './next-steps.mjs';
import { encodeQR, qrToSvg } from './qr.mjs';
import { embedded } from './embedded.mjs';
import { createKumo } from './kumo.mjs';
import { listGameFiles, codeSignature, snapshotGame, restoreGame } from './ai-undo.mjs';
import { readWatch, handoffLine } from './ai-watch.mjs';

const PREFIX = '/__studio/';
const EDIT_SCRIPT_URL = '/__studio/studio-edit.js';
const GAME_ADAPTER_URL = '/__studio/game-adapter.js';
const GAME_TOOLS_URL = '/__studio/game-tools.js';

/**
 * Start a server for one folder.
 * @param {object} o
 * @param {string} o.root        game folder (the folder that is served at "/")
 * @param {string} [o.entry]     page to open, relative to root (default index.html)
 * @param {string} [o.host]      address to listen on (default 127.0.0.1)
 * @param {number} [o.port]      0 = any free port (default)
 * @param {string} [o.uiDir]     folder with the built editor UI (index.html, studio-edit.js, ...)
 * @param {(line: string) => void} [o.log]  one line per event, for the agent (default: stdout)
 * @param {object} [o.kumo]    tests only: { home, env, fetch } for the optional KUMODeck sign-in (kumo.mjs)
 * @returns {Promise<{ url: string, origin: string, port: number, close: () => Promise<void> }>}
 */
export async function startStudioServer(o) {
  const rootReal = await fs.realpath(o.root);
  const entry = o.entry || 'index.html';
  const host = o.host || '127.0.0.1';
  const log = o.log || ((line) => process.stdout.write(line + '\n'));
  const uiDir = o.uiDir ? await fs.realpath(o.uiDir).catch(() => null) : null;
  // One pass per run. 128 bits; base64url so it survives being typed or put in a QR code.
  const token = crypto.randomBytes(16).toString('base64url');
  // A second secret, only for `studio.mjs <folder> --stop` (lifecycle.mjs), kept in .studio/server.json. WHY a
  // request and not only a signal (agent-solid pass 2026-10-17): in Codex's sandbox a command may not signal any
  // other process, not even the editor an earlier command of the same session started (kill → EPERM, and `ps`
  // itself is refused), so --stop asks the editor to stop itself. Separate from the pass: the pass is in the link
  // the person sees and in browser history, this one only in the folder.
  const stopToken = crypto.randomBytes(16).toString('base64url');

  const server = http.createServer();
  const listen = (port) => new Promise((resolve, reject) => {
    const fail = (e) => reject(e);
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      resolve();
    });
  });
  try {
    await listen(o.port || 0);
  } catch (e) {
    // The asked-for port is taken (often a second editor or a dev server): open on a free one and say so in one
    // line, instead of stopping with a stack trace (polish pass 2026-10-16, "never stuck").
    if (!(e && e.code === 'EADDRINUSE' && o.port)) throw e;
    await listen(0);
    log(`studio: port ${o.port} is in use, so the editor opened on port ${server.address().port} instead (to keep ${o.port}, close what uses it and start again)`);
  }
  const port = server.address().port;
  const hostPort = `${host.includes(':') ? `[${host}]` : host}:${port}`;
  const origin = `http://${hostPort}`;
  // localhost is accepted as well as the IP when listening on loopback (some tools rewrite it).
  const allowedHosts = new Set([hostPort]);
  if (host === '127.0.0.1') allowedHosts.add(`localhost:${port}`);
  const cookieName = `studio_${port}`;
  const url = `${origin}${PREFIX}?t=${token}`;
  const ctx = { rootReal, entry, uiDir, log, origin, url, isLan: o.isLan === true };
  // Optional KUMODeck sign-in for AI pictures / 3D (kumo.mjs). Reads the CLI's saved sign-in only
  // when the editor asks; holds the key here and never hands it to the browser.
  ctx.kumo = createKumo({ rootReal, log, ...(o.kumo || {}) });

  server.on('request', (req, res) => {
    handle(req, res).catch((e) => {
      const status = e.status || 500;
      if (status === 500) log(`studio: error ${String(e && e.message).split('\n')[0]}`);
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'internal error' : e.message });
      else res.destroy();
    });
  });

  async function handle(req, res) {
    setCommonHeaders(res);
    if (!allowedHosts.has(req.headers.host || '')) {
      return sendText(res, 403, 'Wrong Host header. Open the link printed by studio.mjs.');
    }
    const u = new URL(req.url, origin);

    // --stop from a sandboxed agent: no cookie (it is not a browser), the folder's stop secret instead.
    if (u.pathname === PREFIX + 'stop' && req.method === 'POST' && o.onStop) {
      if (!safeEqual(String(req.headers['x-studio-stop'] || ''), stopToken)) return sendJson(res, 403, { error: 'wrong stop token' });
      sendJson(res, 200, { ok: true });
      setImmediate(() => o.onStop());
      return;
    }

    // First visit: the pass arrives in the query. Trade it for a cookie and drop it from the URL,
    // so it does not stay in history, in the Referer of later requests, or in screenshots.
    // Only on the editor URL: games often use "?t=<time>" for cache busting on their own files.
    const t = u.pathname === PREFIX ? u.searchParams.get('t') : null;
    if (t !== null) {
      if (!safeEqual(t, token)) return sendText(res, 403, 'This link is not valid (the pass changes every time studio.mjs starts).');
      u.searchParams.delete('t');
      res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict`);
      res.writeHead(302, { Location: u.pathname + (u.search || '') });
      return res.end();
    }
    if (!safeEqual(readCookie(req, cookieName), token)) {
      return sendText(res, 403, 'Missing pass. Open the link printed by studio.mjs.');
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      // Browsers send Origin on cross-origin writes and Sec-Fetch-Site on all modern requests.
      // The cookie already blocks cross-site, this also blocks a same-site-but-other-port page.
      const ori = req.headers.origin;
      const site = req.headers['sec-fetch-site'];
      if ((ori && ori !== origin) || (site && site !== 'same-origin')) {
        return sendJson(res, 403, { error: 'cross-origin request refused' });
      }
    }

    if (u.pathname.startsWith(PREFIX + 'api/')) return handleApi(req, res, u, ctx);
    if (u.pathname === PREFIX || u.pathname + '/' === PREFIX) return serveShell(req, res, ctx);
    if (u.pathname.startsWith(PREFIX)) return serveUi(req, res, u.pathname.slice(PREFIX.length), ctx);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'the game folder is read-only' });
    if (u.pathname === '/') {
      res.writeHead(302, { Location: PREFIX });
      return res.end();
    }
    return serveGameFile(req, res, u.pathname, ctx);
  }

  return {
    url,
    origin,
    port,
    stopToken,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

// ---------------------------------------------------------------------------------------------
// API

async function handleApi(req, res, u, ctx) {
  const route = u.pathname.slice((PREFIX + 'api/').length);
  const m = req.method;

  if (route === 'open' && m === 'GET') {
    return sendJson(res, 200, {
      gameUrl: '/' + ctx.entry.split('/').map(encodeURIComponent).join('/'), origin: ctx.origin, lanUrl: ctx.isLan ? ctx.url : null,
      title: await gameTitle(ctx),
    });
  }

  const file = /^files\/(placement|library)$/.exec(route);
  if (file && m === 'GET') {
    const tool = file[1];
    const { text, error } = await readResultFile(ctx.rootReal, tool);
    if (text === null) return sendJson(res, 200, { value: null, error });
    const r = validateStudioFile(text, { tool });
    // An invalid file on disk (hand-edited, or from a newer version) is reported, not repaired:
    // the shell starts empty and the next save replaces it.
    return sendJson(res, 200, r.ok ? { value: r.value } : { value: null, error: `${RESULT_FILES[tool]} is not valid`, details: r.errors });
  }
  if (file && m === 'PUT') {
    const tool = file[1];
    const body = await readBody(req, LIMITS.maxBytes);
    const r = validateStudioFile(body.toString('utf8'), { tool });
    if (!r.ok) return sendJson(res, 422, { error: `${RESULT_FILES[tool]} was not saved`, details: r.errors });
    const name = await writeResultFile(ctx.rootReal, tool, r.json);
    // ?handoff=0: the editor's draft, written as the person works (since 2026-10-16) so closing the tab
    // loses nothing. The file is written, but no request is kept and nothing is printed: the AI is told
    // only when the person presses Save, so an agent watching stdout is not woken by every drag.
    if (u.searchParams.get('handoff') === '0') return sendJson(res, 200, { ok: true, path: name });
    // Every hand-off is also kept as a request record (§3.4), so an agent that was not watching finds
    // it when the person says "look". The stdout line stays the one agents already know.
    const rec = await recordRequest(ctx, { kind: 'saved', text: summary(r.value), files: [name] });
    ctx.log(`studio: saved ${name} (${summary(r.value)})`);
    return sendJson(res, 200, { ok: true, path: name, request: rec.id, at: rec.at, undo: rec.undo, ...(await readWatch(ctx.rootReal)) });
  }

  if (route === 'assets' && m === 'GET') {
    return sendJson(res, 200, await listAssets(ctx.rootReal));
  }
  if (route === 'assets' && m === 'POST') {
    const len = req.headers['content-length'] !== undefined ? Number(req.headers['content-length']) : undefined;
    const p = await addAsset(ctx.rootReal, u.searchParams.get('name') || '', req, len);
    ctx.log(`studio: added ${p}`);
    return sendJson(res, 201, { path: p });
  }

  if (route === 'next-step' && m === 'POST') {
    const body = await readBody(req, 4096);
    let id;
    let files;
    try {
      ({ id, files } = JSON.parse(body.toString('utf8')));
    } catch {
      throw httpError(400, 'body must be JSON like {"id":"publish"}');
    }
    // "Delete" on unused files in the Library: the editor never deletes anything itself. It hands
    // the list to the agent, which asks the creator first. Only plain files inside the folder.
    if (id === 'delete-files') files = await checkDeleteList(ctx.rootReal, files);
    const md = typeof id === 'string' ? nextStepMarkdown(id, new Date(), { files }) : null;
    if (!md) throw httpError(400, `unknown next step (known: ${NEXT_STEP_IDS.join(', ')})`);
    const p = await writeNextStep(ctx.rootReal, md);
    const rec = await recordRequest(ctx, { kind: 'next-step', step: id, text: '', files: [p] });
    ctx.log(`studio: next-step ${id} ${p}`);
    return sendJson(res, 200, { ok: true, path: p, request: rec.id });
  }

  // Hand-offs to the AI (CONTRACT.md §3.4): kept as .studio/requests/<id>.json first, then one
  // stdout line. The file is the main path (the agent reads every record when the person says
  // "look"); the line is a bonus that wakes an agent that happens to be watching the output.
  if (route === 'request' && m === 'POST') {
    const body = await readBody(req, 64 * 1024);
    let raw;
    try {
      raw = JSON.parse(body.toString('utf8'));
    } catch {
      throw httpError(400, 'body must be JSON');
    }
    const n = normalizeRequestInput(raw);
    if (!n.ok) return sendJson(res, 422, { error: 'request was not kept', details: n.errors });
    const v = n.value;
    // The Library's "Ask my AI to delete it": the same check as POST /next-step (real plain files
    // in the folder), and the same .studio/next-step.md + `studio: next-step delete-files` line.
    if (v.kind === 'next-step' && FILE_STEP_IDS.includes(v.step)) v.files = await checkDeleteList(ctx.rootReal, v.files);
    // KUMODeck steps (and delete-files) keep their long instructions in .studio/next-step.md and their old line.
    if (v.kind === 'next-step' && (KUMODECK_STEP_IDS.includes(v.step) || FILE_STEP_IDS.includes(v.step))) {
      const p = await writeNextStep(ctx.rootReal, nextStepMarkdown(v.step, new Date(), { files: v.files }));
      // files: the instructions first, then (delete-files) the files to delete, already checked.
      const rec = await recordRequest(ctx, { ...v, files: [p, ...(v.files || [])] });
      ctx.log(`studio: next-step ${v.step} ${p}`);
      return sendJson(res, 200, { ok: true, id: rec.id, at: rec.at, path: rec.path, undo: rec.undo, ...(await readWatch(ctx.rootReal)) });
    }
    const rec = await recordRequest(ctx, v);
    // The same line `studio.mjs --watch` prints for it (ai-watch.mjs), so either source reads alike.
    ctx.log(handoffLine(v, rec.path));
    // `watching`: is an AI's watch running right now? The editor says "your AI isn't watching" at
    // once instead of after 20 s (play test 10/16: 21 s of not knowing).
    return sendJson(res, 200, { ok: true, id: rec.id, at: rec.at, path: rec.path, undo: rec.undo, ...(await readWatch(ctx.rootReal)) });
  }

  // "Undo AI change" (ai-undo.mjs): put the game's files back as they were when request `to` was
  // made; the current files are kept first under a new id (`redo`), so the same route undoes it.
  // The AI is told with an `undone` request and the usual line.
  if (route === 'undo' && m === 'POST') {
    const body = await readBody(req, 4096);
    let to;
    let redo;
    try {
      ({ to, redo } = JSON.parse(body.toString('utf8')));
    } catch {
      throw httpError(400, 'body must be JSON like {"to":"<request id>"}');
    }
    if (!isRequestId(to)) throw httpError(400, '"to" must be a request id');
    const redoId = requestId('undone', new Date());
    const r = await restoreGame(ctx.rootReal, to, redoId);
    if (!r.ok) return sendJson(res, 404, { error: r.error });
    const changed = [...r.restored, ...r.removed];
    const text = redo === true
      ? `The person pressed Redo: the game's files are back as your change left them (${changed.length} file${changed.length === 1 ? '' : 's'}).`
      : `The person pressed "Undo AI change": the game's files are back as they were before request ${to} (${changed.length} file${changed.length === 1 ? '' : 's'}). Do not redo it unless they ask.`;
    // Kept under the redo snapshot's id: the record and the snapshot it points at share one name.
    const rec = await recordRequest(ctx, { kind: 'undone', text, files: changed.slice(0, 200) }, r.redo || undefined);
    ctx.log(handoffLine({ kind: 'undone', text }, rec.path));
    return sendJson(res, 200, { ok: true, restored: r.restored.length, removed: r.removed.length, redo: r.redo, id: rec.id, at: rec.at });
  }

  // The agent's status (.studio/status.json, written by the agent or `studio.mjs --status`), read
  // leniently: a broken file is "no status", never an error the person sees.
  if (route === 'status' && m === 'GET') {
    const f = await readStudioFileInfo(ctx.rootReal, 'status.json', 16 * 1024);
    let st = null;
    if (f) {
      try {
        st = normalizeStatus(JSON.parse(f.text));
      } catch {
        st = null;
      }
    }
    // + whether an AI's watch runs (and the last request it printed), and the game files'
    // signature: the editor reloads the game by itself when it changes (ai-undo.mjs).
    const files = await listGameFiles(ctx.rootReal);
    return sendJson(res, 200, { status: st, time: st && f ? Math.round(f.mtimeMs) : null, ...(await readWatch(ctx.rootReal)), code: codeSignature(files) });
  }

  // .studio/ui/prefs.json (the person's editor layout), .studio/studio.json (the game's settings, written
  // by the AI; read only here), .studio/data/<tool>.json (game tools' results). All plain JSON
  // objects; the shell normalises what it reads, so a hand-edited file cannot break the editor.
  const studioJson = async (rel, max) => {
    const text = await readStudioFile(ctx.rootReal, rel, max);
    if (text === null) return { value: null };
    try {
      return { value: JSON.parse(text) };
    } catch (e) {
      return { value: null, error: `.studio/${rel} is not valid JSON (${e.message})` };
    }
  };
  const putStudioJson = async (rel, max) => {
    const body = await readBody(req, max);
    let v;
    try {
      v = JSON.parse(body.toString('utf8'));
    } catch {
      throw httpError(400, 'body must be JSON');
    }
    if (rel === 'ui/prefs.json' && (!v || typeof v !== 'object' || Array.isArray(v))) throw httpError(400, 'body must be a JSON object');
    const p = await writeStudioFile(ctx.rootReal, rel, JSON.stringify(v, null, 2) + '\n');
    return p;
  };
  if (route === 'ui' && m === 'GET') return sendJson(res, 200, await studioJson('ui/prefs.json', 16 * 1024));
  if (route === 'ui' && m === 'PUT') {
    const p = await putStudioJson('ui/prefs.json', 16 * 1024);
    return sendJson(res, 200, { ok: true, path: p });
  }
  if (route === 'config' && m === 'GET') return sendJson(res, 200, await studioJson('studio.json', 64 * 1024));
  const data = /^data\/([a-z0-9][a-z0-9-]{0,39})$/.exec(route);
  if (data && m === 'GET') return sendJson(res, 200, await studioJson(`data/${data[1]}.json`, 256 * 1024));
  if (data && m === 'PUT') {
    const p = await putStudioJson(`data/${data[1]}.json`, 256 * 1024);
    await recordRequest(ctx, { kind: 'saved', text: '', files: [p] });
    ctx.log(`studio: saved ${p}`);
    return sendJson(res, 200, { ok: true, path: p });
  }

  if (route === 'check' && m === 'POST') {
    // Adapter self-check from the edit script (CONTRACT.md §1.5). A failure is written for the
    // agent to .studio/check.md and announced with one stdout line, so the agent can fix the
    // adapter it wrote without the user having to describe what looks wrong.
    const body = await readBody(req, 64 * 1024);
    let r;
    try {
      r = JSON.parse(body.toString('utf8'));
    } catch {
      throw httpError(400, 'body must be the self-check JSON');
    }
    if (!r || typeof r !== 'object' || !Array.isArray(r.checks)) throw httpError(400, 'body must be the self-check JSON');
    const failed = r.checks.filter((c) => c && c.ok === false && !c.skipped).map((c) => String(c.id).slice(0, 40));
    if (failed.length) {
      const p = await writeStudioNote(ctx.rootReal, 'check.md', checkMarkdown(r));
      ctx.log(`studio: check failed: ${failed.join(', ')} (see ${p})`);
    } else {
      ctx.log(`studio: check ok (${String(r.kind || 'adapter').slice(0, 40)})`);
    }
    // Objects with no name (path: keys): a separate line, so the agent can offer once to name them
    // before the person saves (names added later mean renaming keys in placement.json too).
    const unnamed = Array.isArray(r.unnamed) ? r.unnamed.filter((k) => typeof k === 'string' && KEY_RE.test(k)).slice(0, 8) : [];
    const n = Number.isInteger(r.unnamedCount) && r.unnamedCount >= unnamed.length ? Math.min(r.unnamedCount, 100000) : unnamed.length;
    if (n) ctx.log(`studio: unnamed ${n} object${n === 1 ? '' : 's'} without a name: ${unnamed.join(', ')}${n > unnamed.length ? ', …' : ''}`);
    res.writeHead(204);
    return res.end();
  }

  // Optional KUMODeck sign-in (kumo.mjs): status, pick a project, make a picture / a 3D model.
  // Answers never carry the KUMODeck key. A KUMODeck refusal (not signed in, terms, balance, ...)
  // is 422 { error, code } so the editor can show it in the person's words.
  const kumoRoute = /^kumo\/(status|project|image|model3d)(?:\/([0-9a-f-]{36}))?$/.exec(route);
  if (kumoRoute) {
    const [, what, id] = kumoRoute;
    const body = async () => {
      try {
        return JSON.parse((await readBody(req, 16 * 1024)).toString('utf8'));
      } catch {
        throw httpError(400, 'body must be JSON');
      }
    };
    try {
      if (what === 'status' && m === 'GET' && !id) return sendJson(res, 200, await ctx.kumo.status());
      if (what === 'project' && m === 'POST' && !id) return sendJson(res, 200, await ctx.kumo.pickProject(String((await body()).projectId || '')));
      if (what === 'image' && m === 'POST' && !id) return sendJson(res, 200, await ctx.kumo.makeImage(await body()));
      if (what === 'model3d' && m === 'POST' && !id) return sendJson(res, 200, await ctx.kumo.make3d(await body()));
      if (what === 'model3d' && m === 'GET' && id) return sendJson(res, 200, await ctx.kumo.job3d(id));
    } catch (e) {
      if (!e.kumoCode) throw e;
      return sendJson(res, 422, { error: e.message, code: e.kumoCode, ...(e.extra || {}) });
    }
    return sendJson(res, 404, { error: 'unknown API route' });
  }

  if (route === 'lan-qr.svg' && m === 'GET' && ctx.isLan) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    return res.end(qrToSvg(encodeQR(ctx.url)));
  }

  return sendJson(res, 404, { error: 'unknown API route' });
}

/**
 * Keep one hand-off record: .studio/requests/<id>.json. The id and time come from here (the host's
 * clock), never from the browser.
 */
async function recordRequest(ctx, v, fixedId) {
  const now = new Date();
  const id = fixedId || requestId(v.kind, now);
  // Before the AI can read the request: keep the game's files as they are now, so "Undo AI change"
  // can put them back (ai-undo.mjs). A folder too big to keep, or a failure, only means no undo.
  let undo = false;
  if (v.kind !== 'undone') {
    try {
      undo = await snapshotGame(ctx.rootReal, id);
    } catch (e) {
      ctx.log(`studio: note no undo for ${id} (${String(e && e.message).split('\n')[0]})`);
    }
  }
  const rec = { version: 1, id, at: now.toISOString(), ...v };
  const p = await writeStudioFile(ctx.rootReal, `requests/${id}.json`, JSON.stringify(rec, null, 2) + '\n');
  return { id, at: now.getTime(), path: p, undo };
}

// Names that say nothing about the game: then the folder name is the better title.
const GENERIC_TITLES = /^(|document|index|untitled|home|vite app|react app|game|my game|new game|three\.js|phaser|pixi(js)?)$/i;

/**
 * The game's name for the editor's title (the page <title>, or the folder name). The person should
 * see "their game" at the top, not the engine and its version (UI/UX review 2026-10-16).
 */
async function gameTitle(ctx) {
  let title = '';
  const r = await resolveInside(ctx.rootReal, '/' + ctx.entry);
  if (r.ok) {
    const html = await fs.readFile(r.abs, 'utf8').catch(() => '');
    const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html.slice(0, 64 * 1024));
    if (m) {
      title = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
    }
  }
  if (GENERIC_TITLES.test(title)) {
    // public/ (served folder of many starters) says nothing either: use the project folder's name.
    const base = path.basename(ctx.rootReal);
    title = base === 'public' || base === 'dist' || base === 'build' ? path.basename(path.dirname(ctx.rootReal)) : base;
  }
  return title.slice(0, 60);
}

/** .studio/check.md: what the adapter self-check found, written for the agent that wrote the adapter. */
function checkMarkdown(r) {
  const line = (c) => `- ${c.ok ? 'ok  ' : c.skipped ? 'skip' : 'FAIL'} \`${String(c.id).slice(0, 40)}\`${c.detail ? ' — ' + String(c.detail).slice(0, 300).replace(/[\r\n]+/g, ' ') : ''}`;
  return [
    '# Game Studio adapter self-check',
    '',
    `Adapter: ${String(r.kind || 'none').slice(0, 40)}${r.sample ? ` · tested on \`${String(r.sample).slice(0, 80)}\`` : ''}`,
    '',
    ...r.checks.slice(0, 20).map(line),
    '',
    'Fix `.studio/adapter.js` (see the arrange skill, "Write an adapter"), then reload the studio page.',
    'What each check means: CONTRACT.md §1.5.',
    '',
  ].join('\n');
}

/** The files of a delete request: 1–200 safe relative paths of existing files in the folder. */
async function checkDeleteList(rootReal, files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 200) throw httpError(400, '"files" must list 1 to 200 files');
  const out = [];
  for (const f of files) {
    if (!isSafeRelativePath(f) || f.split('/').some((seg) => seg.startsWith('.'))) throw httpError(400, `not a file in the game folder: ${String(f).slice(0, 80)}`);
    const r = await resolveInside(rootReal, '/' + f.split('/').map(encodeURIComponent).join('/'));
    // A folder resolves to its index.html, a symlink to its target: only the named file itself.
    if (!r.ok || r.rel !== f) throw httpError(400, `no such file: ${f}`);
    if (!out.includes(f)) out.push(f);
  }
  return out.sort();
}

function summary(v) {
  if (v.tool === 'placement') {
    const n = Object.keys(v.objects).length;
    const unstable = Object.values(v.objects).filter((o) => o.unstable).length;
    // Draw-order changes (2D layers) are named too, so the agent knows to look at `order`.
    const orders = (v.order || []).length;
    // Copies and deletions too: the agent has to add / remove code for them (skill §4).
    const added = (v.added || []).length;
    const removed = (v.removed || []).length;
    return `${n} object${n === 1 ? '' : 's'}${unstable ? `, ${unstable} without a stable name` : ''}${orders ? `, draw order changed in ${orders} list${orders === 1 ? '' : 's'}` : ''}`
      + `${added ? `, ${added} cop${added === 1 ? 'y' : 'ies'} added` : ''}${removed ? `, ${removed} deleted` : ''}`;
  }
  return `${v.replace.length} replaced, ${v.added.length} added, ${v.unused.length} unused`;
}

// ---------------------------------------------------------------------------------------------
// Static files

async function serveShell(req, res, ctx) {
  if (ctx.uiDir) {
    const r = await resolveInside(ctx.uiDir, '/index.html');
    if (r.ok) return sendFile(req, res, r.abs, r.stat);
  }
  // No built UI next to the server (development, or the UI is not built yet): a small page that
  // still lets a person (or a headless test) look at the game and save both files.
  return sendBody(req, res, 200, 'text/html; charset=utf-8', embedded('fallback.html'));
}

async function serveUi(req, res, name, ctx) {
  if (name === 'game-adapter.js') {
    const js = await readGameAdapter(ctx.rootReal);
    return sendBody(req, res, 200, 'text/javascript; charset=utf-8', js ?? '/* no .studio/adapter.js in this game folder */\n');
  }
  // The editor's own look, rewritten by the AI for this person (CONTRACT.md §8). Loaded by the
  // shell page only (not the game); an empty file when the folder has none.
  if (name === 'game-ui.css') {
    const css = await readStudioFile(ctx.rootReal, 'ui/studio.css', 256 * 1024);
    return sendBody(req, res, 200, 'text/css; charset=utf-8', css ?? '/* no .studio/ui/studio.css */\n');
  }
  if (name === 'game-ui.js') {
    const js = await readStudioFile(ctx.rootReal, 'ui/shell.js', 512 * 1024);
    return sendBody(req, res, 200, 'text/javascript; charset=utf-8', js ?? '/* no .studio/ui/shell.js */\n');
  }
  if (name === 'game-tools.js') {
    const js = await readStudioFile(ctx.rootReal, 'tools.js', 512 * 1024);
    return sendBody(req, res, 200, 'text/javascript; charset=utf-8', js ?? '/* no .studio/tools.js in this game folder */\n');
  }
  if (name === 'host.js') return sendBody(req, res, 200, 'text/javascript; charset=utf-8', embedded('host.js'));
  if (name === 'studio-placement.js') return sendBody(req, res, 200, 'text/javascript; charset=utf-8', embedded('studio-placement.js'));
  if (ctx.uiDir) {
    const r = await resolveInside(ctx.uiDir, '/' + name);
    if (r.ok) return sendFile(req, res, r.abs, r.stat);
  }
  if (name === 'studio-edit.js') {
    // Without the built edit script the game still runs; the shell can tell from the missing
    // "studio:*" messages that editing is unavailable.
    return sendBody(req, res, 200, 'text/javascript; charset=utf-8', '/* studio-edit.js is not built yet */\n');
  }
  return sendJson(res, 404, { error: 'not found' });
}

async function serveGameFile(req, res, pathname, ctx) {
  const r = await resolveInside(ctx.rootReal, pathname);
  if (!r.ok) return sendText(res, r.status, r.reason);
  if (/\.html?$/i.test(r.abs)) {
    // Inject into the response only; the file on disk is never changed.
    const html = await fs.readFile(r.abs, 'utf8');
    return sendBody(req, res, 200, 'text/html; charset=utf-8', injectEditScript(html, EDIT_SCRIPT_URL, GAME_ADAPTER_URL, GAME_TOOLS_URL));
  }
  return sendFile(req, res, r.abs, r.stat);
}

async function sendFile(req, res, abs, stat) {
  const type = mimeOf(abs);
  const size = stat.size;
  // Single byte ranges, because <audio> and <video> seek with Range requests and some browsers
  // refuse to loop or seek media served without them.
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0;
  let end = size - 1;
  let status = 200;
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
    } else {
      start = Math.max(0, size - Number(range[2]));
    }
    if (start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    status = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  }
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
  if (req.method === 'HEAD' || size === 0) return res.end();
  const handle = await fs.open(abs, 'r');
  const stream = handle.createReadStream({ start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

// ---------------------------------------------------------------------------------------------
// helpers

function setCommonHeaders(res) {
  // Everything here changes while the user edits; caching would show stale files after a save.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Only our own pages may frame the editor or the game (blocks click-jacking by other sites).
  res.setHeader('Content-Security-Policy', "frame-ancestors 'self'");
}

function sendBody(req, res, status, type, body) {
  const buf = Buffer.from(body);
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': buf.length });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function sendJson(res, status, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

function sendText(res, status, text) {
  const buf = Buffer.from(text + '\n');
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function readBody(req, max) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) throw httpError(413, `request body is larger than ${max} bytes`);
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}
