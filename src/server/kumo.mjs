// Optional KUMODeck sign-in: make pictures and 3D models with AI, paid from the creator's KUMODeck
// prepaid balance (2026-10-16, the product decision: "a completely free AI game
// editor; sign in to KUMO and picture / 3D generation can be used from your credits").
//
// The editor works fully without this. Nothing here runs until the person opens "Make with AI" in
// the Assets page, and nothing is ever sent to KUMODeck without them pressing Make.
//
// How signing in works: we do not have our own login. We read the session the KUMODeck CLI saved
// (`npx kumodeck login`, the device-code flow on /cli/device, ~/.kumo/credentials.json), the same
// file and the same lookup order the CLI uses (the CLI's credentials.ts and context.ts):
//   API URL: KUMO_API_URL > "api" in kumo.json (the game folder or a parent) > the last server the CLI signed in to
//   project:  "projectId" in kumo.json, else one the person picks from their projects (kept in memory)
//
// Security (the key never reaches the browser):
// - The token stays in this process. API answers never include it, errors never echo it, the log
//   lines never print it. The browser only ever talks to this server (same pass + cookie as the
//   rest of the API, writes same-origin only: server.mjs).
// - We call only KUMODeck's own API at the signed-in URL, with "X-Kumo-Client: game-studio" (the
//   server opens its AI gate to the Game Studio sign-in only with that name and only when its flag
//   KUMO_AI_STUDIO_LOGIN is on: the server's AI project routes, routes3d.ts). Money, the AI terms and
//   the limits are the same as for the Preview connection: the server reserves from the balance and
//   answers 402 when it is not enough; we also check the balance first so the person sees why.
// - Files come back into assets/ through addAsset (add-only, never overwrites: files.mjs).
//
// Prices shown before Make (fal and Tripo at cost, no markup; the same numbers as
// the server's AI price table, pricing.ts, read 2026-10-15): see kumoImagePrice / kumo3dPrice.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Readable } from 'node:stream';
import { addAsset, httpError } from './files.mjs';

/** The name the KUMODeck server looks for (routes3d.ts STUDIO_CLIENT_HEADER / STUDIO_CLIENT_NAME). Change both together. */
const KUMO_CLIENT_HEADERS = { 'x-kumo-client': 'game-studio' };
/** What the person types to sign in (shown in the editor). */
export const KUMO_LOGIN_COMMAND = 'npx kumodeck login';
/** One 3D job is checked for this long per request from the editor (the server waits at most 30 s). */
const KUMO_3D_WAIT_SEC = 20;
/** Largest file we take back from KUMODeck (a textured Tripo model is a few MB; addAsset allows 100 MB). */
const KUMO_MAX_FILE = 100 * 1024 * 1024;

/**
 * Price of one picture in US dollars (what fal charges; KUMODeck adds nothing).
 * fal counts 1024 x 1024 as one megapixel, rounded up. standard = FLUX.1 schnell $0.003 / MP,
 * high = FLUX.2 pro $0.03 for the first MP + $0.015 for each further MP, seamless = Z-Image Turbo tiling $0.02 / MP.
 */
export function kumoImagePrice(o) {
  const mp = Math.max(1, Math.ceil(((o.width || 1024) * (o.height || 1024)) / (1024 * 1024)));
  if (o.tiling && o.tiling !== 'none') return 0.02 * mp;
  if (o.quality === 'high') return 0.03 + 0.015 * (mp - 1);
  return 0.003 * mp;
}

/** Price of one 3D model from words (Tripo: 20 credits with colour, 10 without; 1 credit = $0.01). */
export function kumo3dPrice(o) {
  return o.texture === false ? 0.1 : 0.2;
}

/** The server reserves whole cents, at least 1 (the server's credits.ts, reserveCents). */
const kumoCents = (usd) => Math.max(1, Math.ceil(Math.round(usd * 1e6) / 1e4));

/**
 * One per studio server. o.rootReal = the game folder. o.home / o.env / o.fetch can be replaced
 * in tests (a fake KUMODeck); by default the real HOME, process.env and fetch.
 */
export function createKumo(o) {
  const env = o.env || process.env;
  const doFetch = o.fetch || globalThis.fetch;
  const log = o.log || (() => {});
  let pickedProject = null;
  /** 3D jobs started in this run: id -> { prompt, status, path, costUsdMicros }. A job's file is saved once. */
  const jobs = new Map();

  async function readJsonFile(p) {
    try {
      return JSON.parse(await fs.readFile(p, 'utf8'));
    } catch {
      return null;
    }
  }

  /** kumo.json in the game folder or a parent (the CLI looks upward the same way). */
  async function projectFile() {
    let dir = o.rootReal;
    for (;;) {
      const v = await readJsonFile(path.join(dir, 'kumo.json'));
      if (v && typeof v.projectId === 'string') return v;
      const up = path.dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  }

  /** The CLI's sign-in for this game, or null. Read every time: signing in from a terminal needs no restart. */
  async function login() {
    const home = o.home || env.HOME || env.USERPROFILE || os.homedir();
    const creds = await readJsonFile(path.join(home, '.kumo', 'credentials.json'));
    if (!creds || creds.version !== 1 || !creds.servers || typeof creds.servers !== 'object') return null;
    const pf = await projectFile();
    const api = String(env.KUMO_API_URL || (pf && pf.api) || creds.default || '').replace(/\/+$/, '');
    const s = api ? creds.servers[api] : null;
    if (!s || typeof s.token !== 'string' || !s.token) return null;
    return { api, token: s.token, email: typeof s.email === 'string' ? s.email : '', projectId: pf ? pf.projectId : null };
  }

  /** Call KUMODeck. Answers { status, json } for JSON, or throws a plain error without the token. */
  async function call(lg, method, p, body) {
    const headers = { authorization: `Bearer ${lg.token}`, ...KUMO_CLIENT_HEADERS };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let r;
    try {
      r = await doFetch(lg.api + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      throw kumoFail('unreachable', `Could not reach ${new URL(lg.api).host}.`);
    }
    const json = await r.json().catch(() => null);
    return { status: r.status, json };
  }

  async function getFile(lg, url) {
    const r = await doFetch(lg.api + url, { headers: { authorization: `Bearer ${lg.token}`, ...KUMO_CLIENT_HEADERS } }).catch(() => null);
    if (!r || !r.ok) throw kumoFail('download_failed', 'The file was made but could not be downloaded. Try again from "Recent".');
    const len = Number(r.headers.get('content-length') || 0);
    if (len > KUMO_MAX_FILE) throw kumoFail('too_large', 'The file is larger than 100 MB.');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > KUMO_MAX_FILE) throw kumoFail('too_large', 'The file is larger than 100 MB.');
    return buf;
  }

  /** KUMODeck's error answer -> one code the editor knows, plus KUMODeck's own sentence. */
  function fromApi(res) {
    const e = (res.json && res.json.error) || {};
    const code = typeof e.code === 'string' ? e.code : '';
    const message = typeof e.message === 'string' ? e.message.slice(0, 300) : `HTTP ${res.status}`;
    if (res.status === 401) return kumoFail('signed_out', message);
    if (code === 'ai_terms_not_accepted') return kumoFail('needs_terms', message);
    if (res.status === 402 || code === 'insufficient_credits') return kumoFail('not_enough', message);
    if (code === 'feature_unavailable') return kumoFail('not_open', message);
    if (code === 'staging_not_allowed') return kumoFail('not_allowed', message);
    if (res.status === 429) return kumoFail('too_many', message);
    return kumoFail(code || 'failed', message);
  }

  async function balance(lg) {
    const r = await call(lg, 'GET', '/v1/money/prepaid');
    if (r.status !== 200 || !r.json) throw fromApi(r);
    return { cents: Number(r.json.balance) || 0, currency: String(r.json.currency || 'usd') };
  }

  async function projects(lg) {
    const r = await call(lg, 'GET', '/v1/projects');
    if (r.status !== 200 || !r.json) throw fromApi(r);
    return (r.json.projects || []).map((p) => ({ id: String(p.id), name: String(p.name || p.slug || p.id) }));
  }

  async function dashboardUrl(lg) {
    const r = await call(lg, 'GET', '/v1/platform/info').catch(() => null);
    const u = r && r.json && typeof r.json.dashboardUrl === 'string' ? r.json.dashboardUrl : null;
    return u && /^https?:\/\//.test(u) ? u : null;
  }

  /**
   * What the editor shows. Never the token. signedIn false = the "sign in" hint with the command.
   * project null + projects = the person picks one (no kumo.json in the folder).
   */
  async function status() {
    const lg = await login();
    if (!lg) return { signedIn: false, loginCommand: KUMO_LOGIN_COMMAND };
    const base = { signedIn: true, email: lg.email, server: new URL(lg.api).host, loginCommand: KUMO_LOGIN_COMMAND, jobs: [...jobs].map(([id, j]) => ({ id, ...j })) };
    try {
      const [bal, list, dash] = await Promise.all([balance(lg), projects(lg), dashboardUrl(lg)]);
      const id = lg.projectId || pickedProject;
      const project = id ? list.find((p) => p.id === id) || null : null;
      return {
        ...base,
        balanceCents: bal.cents,
        currency: bal.currency,
        topUpUrl: dash,
        project,
        fromFolder: !!lg.projectId,
        projects: project ? undefined : list.slice(0, 50),
      };
    } catch (e) {
      if (e.kumoCode === 'signed_out') return { signedIn: false, expired: true, loginCommand: KUMO_LOGIN_COMMAND };
      return { ...base, error: { code: e.kumoCode || 'failed', message: e.message } };
    }
  }

  async function pickProject(id) {
    const lg = await need();
    if (lg.projectId) throw kumoFail('from_folder', 'This folder already names its project in kumo.json.');
    const list = await projects(lg);
    if (!list.some((p) => p.id === id)) throw kumoFail('no_project', 'That project is not in this account.');
    pickedProject = id;
    return status();
  }

  async function need() {
    const lg = await login();
    if (!lg) throw kumoFail('signed_out', `Not signed in. Run ${KUMO_LOGIN_COMMAND} in a terminal.`);
    return lg;
  }
  async function needProject(lg) {
    const id = lg.projectId || pickedProject;
    if (!id) throw kumoFail('no_project', 'Choose which KUMODeck project these files belong to.');
    return id;
  }
  /** Stop before asking KUMODeck when the balance is clearly short (the server checks again: 402). */
  async function checkBalance(lg, usd) {
    const b = await balance(lg);
    const needCents = kumoCents(usd);
    if (b.cents < needCents) {
      const e = kumoFail('not_enough', `Your balance is ${(b.cents / 100).toFixed(2)} and this needs ${(needCents / 100).toFixed(2)}.`);
      e.extra = { balanceCents: b.cents, needCents };
      throw e;
    }
  }

  async function saveFile(lg, job) {
    const a = job.assets && job.assets[0];
    const f = a && (a.files.find((x) => /\.(glb|png|jpe?g|webp)$/i.test(x.name)) || a.files[0]);
    if (!f || typeof f.url !== 'string' || !f.url.startsWith('/v1/')) throw kumoFail('no_file', 'The job finished without a file.');
    const buf = await getFile(lg, f.url);
    const rel = await addAsset(o.rootReal, f.name, Readable.from([buf]), buf.length);
    log(`studio: added ${rel} (made with KUMODeck AI)`);
    return rel;
  }

  /** One picture (sync on KUMODeck: a few seconds). Answers { path, costUsdMicros, balanceCents }. */
  async function makeImage(b) {
    const lg = await need();
    const projectId = await needProject(lg);
    const input = kumoImageInput(b);
    await checkBalance(lg, kumoImagePrice({ ...input, quality: b.quality }));
    const r = await call(lg, 'POST', `/v1/projects/${encodeURIComponent(projectId)}/ai/image/jobs`, {
      task: 'image.picture',
      input,
      routing: { policy: b.quality === 'high' ? 'quality' : 'balanced' },
      ...(b.acceptTerms === true ? { acceptTerms: true } : {}),
    });
    if (r.status !== 200 && r.status !== 202) throw fromApi(r);
    const job = r.json.job;
    if (job.status !== 'succeeded') throw kumoFail(job.error?.code || 'failed', job.error?.message || `The picture was not made (${job.status}).`);
    const rel = await saveFile(lg, job);
    return { path: rel, costUsdMicros: job.costUsdMicros ?? null, balanceCents: (await balance(lg).catch(() => null))?.cents ?? null };
  }

  /** Start one 3D model from words (minutes on KUMODeck). Answers the job; the editor calls job3d until done. */
  async function make3d(b) {
    const lg = await need();
    const projectId = await needProject(lg);
    const prompt = kumoText(b.prompt, 1024);
    const texture = b.texture !== false;
    await checkBalance(lg, kumo3dPrice({ texture }));
    const r = await call(lg, 'POST', `/v1/projects/${encodeURIComponent(projectId)}/ai/3d/jobs`, {
      task: '3d.from_text',
      input: { prompt, texture },
      ...(b.acceptTerms === true ? { acceptTerms: true } : {}),
      waitSec: 0,
    });
    if (r.status !== 200 && r.status !== 202) throw fromApi(r);
    jobs.set(r.json.job.id, { projectId, prompt: prompt.slice(0, 80), status: r.json.job.status, path: null, costUsdMicros: null });
    return job3d(r.json.job.id);
  }

  /** Check one 3D job started in this run; when it succeeded, its model goes into assets/ (once). */
  async function job3d(id) {
    const j = jobs.get(id);
    if (!j) throw kumoFail('no_job', 'This job was not started from this editor run.');
    if (j.path || j.status === 'failed' || j.status === 'canceled') return { id, ...j };
    const lg = await need();
    const r = await call(lg, 'GET', `/v1/projects/${encodeURIComponent(j.projectId)}/ai/3d/jobs/${encodeURIComponent(id)}?waitSec=${KUMO_3D_WAIT_SEC}`);
    if (r.status !== 200) throw fromApi(r);
    const job = r.json.job;
    j.status = job.status;
    j.costUsdMicros = job.costUsdMicros ?? null;
    if (job.status === 'failed') j.error = { code: job.error?.code || 'failed', message: String(job.error?.message || '').slice(0, 300) };
    if (job.status === 'succeeded' && !j.path) j.path = await saveFile(lg, job);
    return { id, ...j };
  }

  // login() stays inside: it holds the token, which must not leave this module
  return { status, pickProject, makeImage, make3d, job3d };
}

/** The picture's input for KUMODeck (same limits as the server: tasks.ts pictureSide). */
function kumoImageInput(b) {
  const side = (v) => {
    const n = v === undefined ? 1024 : Number(v);
    if (!Number.isInteger(n) || n < 256 || n > 2048 || n % 64 !== 0) throw httpError(400, 'width and height are 256 to 2048, a multiple of 64');
    return n;
  };
  const tiling = b.tiling === undefined ? 'none' : String(b.tiling);
  if (!['none', 'both', 'horizontal', 'vertical'].includes(tiling)) throw httpError(400, 'tiling is none, both, horizontal or vertical');
  if (b.quality !== undefined && b.quality !== 'standard' && b.quality !== 'high') throw httpError(400, 'quality is standard or high');
  if (b.quality === 'high' && tiling !== 'none') throw httpError(400, 'seamless pictures have their own model; quality "high" does not apply');
  const format = b.format === 'png' ? 'png' : 'jpeg';
  const name = typeof b.name === 'string' && /^[a-z0-9][a-z0-9_-]{0,47}$/.test(b.name) ? b.name : undefined;
  return { prompt: kumoText(b.prompt, 1000), width: side(b.width), height: side(b.height), tiling, format, ...(name ? { name } : {}) };
}

function kumoText(v, max) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw httpError(400, 'say what to make');
  if (s.length > max) throw httpError(400, `at most ${max} characters`);
  return s;
}

/** An error the editor shows in its own words (kumoCode), with KUMODeck's sentence as detail. Status 200-ish for the editor: see server.mjs. */
function kumoFail(code, message) {
  const e = new Error(message);
  e.kumoCode = code;
  return e;
}
