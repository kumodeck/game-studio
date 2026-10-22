// Tests for the optional KUMODeck sign-in (kumo.mjs) through the real studio server, against a fake
// KUMODeck (an in-memory fetch; nothing leaves the machine).
// Run: node --test src/server/kumo.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { startStudioServer } from './server.mjs';
import { kumoImagePrice, kumo3dPrice, kumoSoundPrice, KUMO_3D_FACE_LIMIT, KUMO_SOUND_MODELS } from './kumo.mjs';

const API = 'http://kumo.test';
const TOKEN = 'kds_test_SECRET_do_not_leak_0123456789';
const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

/**
 * Fake KUMODeck: the routes Game Studio calls. Every call must carry the CLI's token and the
 * Game Studio name (what the real server's gate checks: routes3d.ts).
 */
function fakeKumo({ balance = 500, terms = false } = {}) {
  const st = { balance, terms, calls: [], jobs: new Map(), creates: 0, inputs: [] };
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const err = (status, code, message) => json(status, { error: { code, message } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const h = init.headers || {};
    st.calls.push({ method: init.method || 'GET', path: u.pathname + u.search, client: h['x-kumo-client'] });
    if (h.authorization !== `Bearer ${TOKEN}`) return err(401, 'unauthorized', 'Session expired or invalid');
    if (h['x-kumo-client'] !== 'game-studio') return err(403, 'feature_unavailable', 'This feature is not currently available.');
    const p = u.pathname;
    if (p === '/v1/money/prepaid') return json(200, { balance: st.balance, owed: 0, currency: 'usd' });
    if (p === '/v1/projects') return json(200, { projects: [{ id: PROJECT, name: 'Canal' }, { id: OTHER, name: 'Other' }] });
    if (p === '/v1/platform/info') return json(200, { dashboardUrl: 'http://dash.test' });
    const create = /^\/v1\/projects\/([^/]+)\/ai\/(image|3d|audio)\/jobs$/.exec(p);
    if (create && init.method === 'POST' && create[2] === 'audio') {
      // A sound: made at once (the real audio route is sync), wav for sfx / music and mp3 for a voice line
      const b = JSON.parse(init.body);
      st.inputs.push({ task: b.task, model: b.routing?.model, ...b.input });
      if (b.acceptTerms === true) st.terms = true;
      if (!st.terms) return err(403, 'ai_terms_not_accepted', 'You must accept the AI terms');
      if (st.balance < 1) return err(402, 'insufficient_credits', 'Not enough prepaid balance');
      st.creates++;
      st.balance -= 1;
      const name = b.task === 'audio.voice' ? 'line.mp3' : b.task === 'audio.music' ? 'theme.wav' : 'coin.wav';
      const job = { id: `0000000${st.creates}-0000-4000-8000-000000000000`, projectId: create[1], task: b.task, status: 'succeeded', costUsdMicros: 4000, assets: [{ id: `a${st.creates}`, files: [{ name, url: `/v1/projects/${create[1]}/ai/audio/assets/a${st.creates}/files/${name}` }] }] };
      return json(200, { job });
    }
    if (create && init.method === 'POST') {
      const b = JSON.parse(init.body);
      st.inputs.push(b.input);
      if (b.acceptTerms === true) st.terms = true;
      if (!st.terms) return err(403, 'ai_terms_not_accepted', 'You must accept the AI terms');
      const cost = create[2] === 'image' ? 3 : 20;
      if (st.balance < cost) return err(402, 'insufficient_credits', 'Not enough prepaid balance');
      st.creates++;
      const id = `0000000${st.creates}-0000-4000-8000-000000000000`;
      st.balance -= cost;
      const file = create[2] === 'image'
        ? { name: `${b.input.name || 'picture'}.jpg`, url: `/v1/projects/${create[1]}/ai/image/assets/a${st.creates}/files/picture.jpg` }
        : { name: 'chest.glb', url: `/v1/projects/${create[1]}/ai/3d/assets/a${st.creates}/files/chest.glb` };
      const job = { id, projectId: create[1], task: b.task, status: create[2] === 'image' ? 'succeeded' : 'running', costUsdMicros: cost * 10000, assets: [{ id: `a${st.creates}`, files: [file] }] };
      st.jobs.set(id, job);
      return json(create[2] === 'image' ? 200 : 202, { job: { ...job, assets: job.status === 'succeeded' ? job.assets : [] } });
    }
    const poll = /^\/v1\/projects\/([^/]+)\/ai\/3d\/jobs\/([^/]+)$/.exec(p);
    if (poll) {
      const job = st.jobs.get(poll[2]);
      if (!job) return err(404, 'not_found', 'Job not found');
      // the first look still runs; the second one is done
      job.looks = (job.looks || 0) + 1;
      if (job.looks >= 2) job.status = 'succeeded';
      return json(200, { job: { ...job, assets: job.status === 'succeeded' ? job.assets : [] } });
    }
    if (/\/files\/.*\.(wav|mp3)$/.test(p)) return new Response('RIFFSOUND', { status: 200, headers: { 'content-length': '9' } });
    if (/\/files\//.test(p)) return new Response(p.endsWith('.glb') ? 'glTF-BINARY' : 'JPEGBYTES', { status: 200, headers: { 'content-length': p.endsWith('.glb') ? '11' : '9' } });
    return err(404, 'not_found', p);
  };
  return { st, fetch };
}

async function start({ signedIn = true, kumoJson = true, ...fake } = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'game-studio-kumo-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'game');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><title>t</title>');
  if (kumoJson) await fs.writeFile(path.join(root, 'kumo.json'), JSON.stringify({ projectId: PROJECT, api: API }));
  if (signedIn) {
    await fs.mkdir(path.join(home, '.kumo'), { recursive: true });
    await fs.writeFile(path.join(home, '.kumo', 'credentials.json'), JSON.stringify({ version: 1, default: API, servers: { [API]: { token: TOKEN, email: 'maker@example.com', developerId: 'd1', savedAt: 'x', origin: 'cli_grant' } } }));
  }
  const kumo = fakeKumo(fake);
  const lines = [];
  const srv = await startStudioServer({ root, log: (l) => lines.push(l), kumo: { home, env: {}, fetch: kumo.fetch } });
  const token = new URL(srv.url).searchParams.get('t');
  const host = new URL(srv.origin).host;
  const cookie = `studio_${srv.port}=${token}`;
  const texts = [];
  const req = (method, p, body, headers = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: '/__studio/api/' + p, headers: { host, cookie, 'content-type': 'application/json', ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          texts.push(text);
          resolve({ status: res.statusCode, json: JSON.parse(text || 'null') });
        });
      });
      r.on('error', reject);
      r.end(body === undefined ? undefined : JSON.stringify(body));
    });
  const close = async () => {
    await srv.close();
    // the key never reached the browser side or the agent's log
    for (const t of [...texts, ...lines]) assert.ok(!t.includes(TOKEN), `token leaked in: ${t.slice(0, 200)}`);
    await fs.rm(base, { recursive: true, force: true });
  };
  return { root, kumo, lines, req, close };
}

const assetsOf = async (root) => (await fs.readdir(path.join(root, 'assets')).catch(() => [])).sort();

test('prices shown before Make match the server table (fal / Tripo at cost)', () => {
  assert.equal(kumoImagePrice({ width: 1024, height: 1024 }), 0.003);
  assert.equal(kumoImagePrice({ width: 2048, height: 2048 }), 0.012);
  assert.equal(kumoImagePrice({ width: 1024, height: 1024, quality: 'high' }), 0.03);
  assert.equal(kumoImagePrice({ width: 2048, height: 1024, quality: 'high' }), 0.045);
  assert.equal(kumoImagePrice({ width: 1024, height: 1024, tiling: 'both' }), 0.02);
  assert.equal(kumo3dPrice({ texture: true }), 0.2);
  assert.equal(kumo3dPrice({ texture: false }), 0.1);
  // light 3D by default (faceLimit 5000, 2026-10-20) does not change the price shown before Make
  assert.equal(kumo3dPrice({ texture: true, faceLimit: KUMO_3D_FACE_LIMIT }), 0.2);
});

test('not signed in: the editor gets the sign-in command, nothing is called or written', async () => {
  const s = await start({ signedIn: false });
  try {
    const st = await s.req('GET', 'kumo/status');
    assert.equal(st.status, 200);
    assert.deepEqual(st.json, { signedIn: false, loginCommand: 'npx kumodeck login' });
    const r = await s.req('POST', 'kumo/image', { prompt: 'stone wall' });
    assert.equal(r.status, 422);
    assert.equal(r.json.code, 'signed_out');
    assert.equal(s.kumo.st.calls.length, 0);
    assert.deepEqual(await assetsOf(s.root), []);
  } finally {
    await s.close();
  }
});

test('signed in: status shows the account, balance and project (never the key); a picture lands in assets/ after the one-time terms', async () => {
  const s = await start();
  try {
    const st = await s.req('GET', 'kumo/status');
    assert.equal(st.status, 200);
    assert.equal(st.json.signedIn, true);
    assert.equal(st.json.email, 'maker@example.com');
    assert.equal(st.json.balanceCents, 500);
    assert.deepEqual(st.json.project, { id: PROJECT, name: 'Canal' });
    assert.equal(st.json.topUpUrl, 'http://dash.test');
    // every call names Game Studio (what the server's gate looks for)
    assert.ok(s.kumo.st.calls.every((c) => c.client === 'game-studio'));

    // AI terms not agreed yet: nothing made, the editor asks once
    const first = await s.req('POST', 'kumo/image', { prompt: 'mossy stone wall', name: 'wall' });
    assert.equal(first.status, 422);
    assert.equal(first.json.code, 'needs_terms');
    assert.equal(s.kumo.st.creates, 0);

    const ok = await s.req('POST', 'kumo/image', { prompt: 'mossy stone wall', name: 'wall', acceptTerms: true });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.path, 'assets/wall.jpg');
    assert.equal(ok.json.balanceCents, 497);
    assert.equal(await fs.readFile(path.join(s.root, 'assets/wall.jpg'), 'utf8'), 'JPEGBYTES');
    assert.ok(s.lines.some((l) => l === 'studio: added assets/wall.jpg (made with KUMODeck AI)'));

    // the second time needs no agreement; an existing name is never overwritten
    const again = await s.req('POST', 'kumo/image', { prompt: 'mossy stone wall', name: 'wall' });
    assert.equal(again.json.path, 'assets/wall-2.jpg');

    // input checked before KUMODeck is called
    const bad = await s.req('POST', 'kumo/image', { prompt: 'x', width: 1000 });
    assert.equal(bad.status, 400);
  } finally {
    await s.close();
  }
});

test('3D: starts, the editor checks until done, the model goes into assets/ once', async () => {
  const s = await start({ terms: true });
  try {
    const r = await s.req('POST', 'kumo/model3d', { prompt: 'a low wooden treasure chest' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.status, 'running');
    assert.equal(r.json.path, null);
    // light for a web game from the start: Tripo's face_limit 5000 (kumo.mjs KUMO_3D_FACE_LIMIT)
    assert.equal(KUMO_3D_FACE_LIMIT, 5000);
    assert.deepEqual(s.kumo.st.inputs, [{ prompt: 'a low wooden treasure chest', texture: true, faceLimit: 5000 }]);
    const done = await s.req('GET', `kumo/model3d/${r.json.id}`);
    assert.equal(done.json.status, 'succeeded');
    assert.equal(done.json.path, 'assets/chest.glb');
    const again = await s.req('GET', `kumo/model3d/${r.json.id}`);
    assert.equal(again.json.path, 'assets/chest.glb');
    assert.deepEqual(await assetsOf(s.root), ['chest.glb']);
    // the run's jobs are listed in the status (so a reload of the page finds them)
    const st = await s.req('GET', 'kumo/status');
    assert.equal(st.json.jobs[0].path, 'assets/chest.glb');
  } finally {
    await s.close();
  }
});

test('balance too low: stopped before anything is asked of KUMODeck', async () => {
  const s = await start({ balance: 10, terms: true });
  try {
    const r = await s.req('POST', 'kumo/model3d', { prompt: 'a chest' });
    assert.equal(r.status, 422);
    assert.equal(r.json.code, 'not_enough');
    assert.equal(r.json.balanceCents, 10);
    assert.equal(r.json.needCents, 20);
    assert.equal(s.kumo.st.creates, 0);
    assert.ok(!s.kumo.st.calls.some((c) => c.method === 'POST'));
    // a picture ($0.003 -> 1 cent) still fits
    const pic = await s.req('POST', 'kumo/image', { prompt: 'sky' });
    assert.equal(pic.status, 200, JSON.stringify(pic.json));
  } finally {
    await s.close();
  }
});

test('no kumo.json: the person picks one of their projects; writes from another site are refused', async () => {
  const s = await start({ kumoJson: false, terms: true });
  try {
    const st = await s.req('GET', 'kumo/status');
    assert.equal(st.json.project, null);
    assert.deepEqual(st.json.projects.map((p) => p.id), [PROJECT, OTHER]);
    const none = await s.req('POST', 'kumo/image', { prompt: 'sky' });
    assert.equal(none.json.code, 'no_project');
    const wrong = await s.req('POST', 'kumo/project', { projectId: '33333333-3333-4333-8333-333333333333' });
    assert.equal(wrong.json.code, 'no_project');
    const picked = await s.req('POST', 'kumo/project', { projectId: OTHER });
    assert.deepEqual(picked.json.project, { id: OTHER, name: 'Other' });
    const evil = await s.req('POST', 'kumo/image', { prompt: 'sky' }, { origin: 'http://evil.example' });
    assert.equal(evil.status, 403);
    const ok = await s.req('POST', 'kumo/image', { prompt: 'sky' });
    assert.equal(ok.status, 200);
    assert.ok(s.kumo.st.calls.some((c) => c.path === `/v1/projects/${OTHER}/ai/image/jobs`));
  } finally {
    await s.close();
  }
});

// ---- Sounds and the history (generate-ui, 2026-10-22) ----

test('sound prices shown before Make: the pinned models at cost (pricing.ts, read 2026-10-22)', () => {
  assert.equal(kumoSoundPrice({ kind: 'sfx', durationSec: 2 }), 0.004);
  assert.equal(kumoSoundPrice({ kind: 'sfx', durationSec: 5 }), 0.01);
  assert.equal(kumoSoundPrice({ kind: 'music', durationSec: 60 }), 0.0376);
  assert.equal(kumoSoundPrice({ kind: 'voice', text: 'a'.repeat(1000) }), 0.05);
  assert.deepEqual(KUMO_SOUND_MODELS, { sfx: 'elevenlabs-sound-effects-v2', music: 'stable-audio-3-medium', voice: 'elevenlabs-turbo-v2.5' });
});

test('a sound effect, music and a voice line land in assets/ with the right task and model; the history keeps the words', async () => {
  const s = await start();
  try {
    // the terms once, like a picture
    const first = await s.req('POST', 'kumo/sound', { kind: 'sfx', prompt: 'coin pickup, bright chime', durationSec: 1 });
    assert.equal(first.json.code, 'needs_terms');
    const sfx = await s.req('POST', 'kumo/sound', { kind: 'sfx', prompt: 'coin pickup, bright chime', durationSec: 1, acceptTerms: true });
    assert.equal(sfx.status, 200, JSON.stringify(sfx.json));
    assert.equal(sfx.json.path, 'assets/coin.wav');
    assert.equal(sfx.json.balanceCents, 499);
    const music = await s.req('POST', 'kumo/sound', { kind: 'music', prompt: 'calm harbor theme' });
    assert.equal(music.json.path, 'assets/theme.wav');
    const voice = await s.req('POST', 'kumo/sound', { kind: 'voice', prompt: 'Welcome to the cove!', voice: 'warm' });
    assert.equal(voice.json.path, 'assets/line.mp3');
    assert.deepEqual(s.kumo.st.inputs.slice(1), [
      { task: 'audio.sfx', model: 'elevenlabs-sound-effects-v2', prompt: 'coin pickup, bright chime', durationSec: 1 },
      { task: 'audio.music', model: 'stable-audio-3-medium', prompt: 'calm harbor theme', durationSec: 30, loop: true },
      { task: 'audio.voice', model: 'elevenlabs-turbo-v2.5', text: 'Welcome to the cove!', voice: 'warm' },
    ]);
    assert.ok(s.kumo.st.calls.some((c) => c.path === `/v1/projects/${PROJECT}/ai/audio/jobs`));
    assert.deepEqual(await assetsOf(s.root), ['coin.wav', 'line.mp3', 'theme.wav']);

    // .studio/generated.json: newest first, the words and options, no key, no KUMODeck address
    const raw = await fs.readFile(path.join(s.root, '.studio/generated.json'), 'utf8');
    assert.ok(!raw.includes(TOKEN) && !raw.includes(API));
    const items = JSON.parse(raw).items;
    assert.deepEqual(items.map((i) => [i.kind, i.prompt, i.path, i.options]), [
      ['voice', 'Welcome to the cove!', 'assets/line.mp3', { voice: 'warm' }],
      ['music', 'calm harbor theme', 'assets/theme.wav', { durationSec: 30, loop: true }],
      ['sfx', 'coin pickup, bright chime', 'assets/coin.wav', { durationSec: 1 }],
    ]);
    assert.ok(items.every((i) => typeof i.at === 'string' && i.costUsdMicros === 4000));
    // the editor gets it with the status ("Made here")
    const st = await s.req('GET', 'kumo/status');
    assert.deepEqual(st.json.made.map((i) => i.kind), ['voice', 'music', 'sfx']);
  } finally {
    await s.close();
  }
});

test('a sound out of range or of an unknown kind is refused before KUMODeck is asked', async () => {
  const s = await start({ terms: true });
  try {
    for (const b of [{ kind: 'sfx', prompt: 'x', durationSec: 30 }, { kind: 'music', prompt: 'x', durationSec: 2 }, { kind: 'voice', prompt: 'hi', voice: 'robot' }, { kind: 'video', prompt: 'x' }, { kind: 'voice', prompt: 'a'.repeat(501) }]) {
      const r = await s.req('POST', 'kumo/sound', b);
      assert.equal(r.status, 400, JSON.stringify(b));
    }
    assert.ok(!s.kumo.st.calls.some((c) => c.method === 'POST'));
  } finally {
    await s.close();
  }
});

test('pictures and 3D models go into the history too (3D once, when the model lands)', async () => {
  const s = await start({ terms: true });
  try {
    await s.req('POST', 'kumo/image', { prompt: 'night sky', quality: 'high', width: 512, height: 512 });
    const r = await s.req('POST', 'kumo/model3d', { prompt: 'a low wooden treasure chest', texture: false });
    await s.req('GET', `kumo/model3d/${r.json.id}`);
    await s.req('GET', `kumo/model3d/${r.json.id}`);
    const st = await s.req('GET', 'kumo/status');
    assert.deepEqual(st.json.made.map((i) => [i.kind, i.prompt, i.options]), [
      ['model', 'a low wooden treasure chest', { texture: false }],
      ['picture', 'night sky', { side: 512, quality: 'high' }],
    ]);
  } finally {
    await s.close();
  }
});

test('a broken .studio/generated.json reads as empty; the next make starts it again', async () => {
  const s = await start({ terms: true });
  try {
    await fs.mkdir(path.join(s.root, '.studio'), { recursive: true });
    await fs.writeFile(path.join(s.root, '.studio/generated.json'), '{ not json');
    const st = await s.req('GET', 'kumo/status');
    assert.deepEqual(st.json.made, []);
    await s.req('POST', 'kumo/sound', { kind: 'sfx', prompt: 'door creak' });
    const again = await s.req('GET', 'kumo/status');
    assert.deepEqual(again.json.made.map((i) => i.prompt), ['door creak']);
  } finally {
    await s.close();
  }
});
