// A small fake KUMODeck on 127.0.0.1 for "Make with AI" (src/server/kumo.mjs): the routes the
// studio server calls, with a balance, the one-time AI terms, a picture made at once, a 3D model
// done on the second look and a sound made at once (the audio route, 2026-10-22 generate-ui). Used by
// test/studio-kumo.browser.mjs, test/studio-generate.browser.mjs and test/kumo-try.mjs. Nothing
// leaves the machine; the "token" is a made-up string.
import http from 'node:http';

export const FAKE_KUMO_TOKEN = 'kds_fake_SECRET_never_in_page_0123456789';
export const FAKE_KUMO_PROJECT = '11111111-1111-4111-8111-111111111111';
const TOKEN = FAKE_KUMO_TOKEN;
const PROJECT = FAKE_KUMO_PROJECT;

/**
 * A small fake KUMODeck (the routes kumo.mjs calls). The 3D job is done on the second look.
 * delayMs: each look at a 3D job, and each sound, waits this long (the "Making…" tile and clock get time to show).
 * modelBytes: size of the 3D file (over 10 MB = the "heavy" line; the real AI model was 45.7 MB).
 */
/** A real 0.3-second WAV (a soft 440 Hz tone), so the editor's ▶ can play what the fake made. */
function wav() {
  const rate = 8000, n = 2400;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000 * (1 - i / n)), 44 + i * 2);
  return b;
}

export async function fakeKumoServer({ delayMs = 0, modelBytes = 0 } = {}) {
  // inputs: the input of every job asked for (the 3D one must carry faceLimit 5000: kumo.mjs KUMO_3D_FACE_LIMIT;
  // a sound carries its task and the pinned model: kumo.mjs KUMO_SOUND_MODELS)
  const st = { balance: 500, terms: false, n: 0, jobs: new Map(), posts: 0, inputs: [] };
  const srv = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const json = (status, v) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { error: { code: 'unauthorized', message: 'Session expired or invalid' } });
    if (req.headers['x-kumo-client'] !== 'game-studio') return json(403, { error: { code: 'feature_unavailable', message: 'not available' } });
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/v1/money/prepaid') return json(200, { balance: st.balance, owed: 0, currency: 'usd' });
    if (p === '/v1/projects') return json(200, { projects: [{ id: PROJECT, name: 'Stars' }] });
    if (p === '/v1/platform/info') return json(200, { dashboardUrl: 'http://127.0.0.1:9/dashboard' });
    const create = /^\/v1\/projects\/[^/]+\/ai\/(image|3d|audio)\/jobs$/.exec(p);
    if (create && req.method === 'POST' && create[1] === 'audio') {
      // Sounds are made at once, like a picture (the real audio route is sync: routes3d.ts FAMILY_AUDIO).
      // 1 cent each here (the real ones are $0.002 / s, $0.05 / 1,000 characters or $0.0376 a piece: kumo.mjs kumoSoundPrice).
      st.posts++;
      st.inputs.push({ kind: 'audio', task: body.task, model: body.routing?.model, ...body.input });
      if (body.acceptTerms === true) st.terms = true;
      if (!st.terms) return json(403, { error: { code: 'ai_terms_not_accepted', message: 'You must accept the KUMODeck AI terms' } });
      if (st.balance < 1) return json(402, { error: { code: 'insufficient_credits', message: 'Not enough' } });
      // delayMs: the "Making…" line and tile get time to show (the real ones take seconds)
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      st.balance -= 1;
      const id = `0000000${++st.n}-0000-4000-8000-000000000000`;
      const stem = { 'audio.sfx': 'coin-pickup', 'audio.music': 'calm-harbor', 'audio.voice': 'welcome' }[body.task] || 'sound';
      // the real voice lines come back as mp3 and the rest as wav (the server's pipelines.ts); all of them are wav bytes here
      const file = { name: `${stem}${body.task === 'audio.voice' ? '.mp3' : '.wav'}`, url: `/v1/files/${id}.wav` };
      const job = { id, status: 'succeeded', task: body.task, costUsdMicros: 10000, assets: [{ id: 'a', files: [file] }] };
      st.jobs.set(id, job);
      return json(200, { job });
    }
    if (create && req.method === 'POST') {
      st.posts++;
      st.inputs.push({ kind: create[1], ...body.input });
      if (body.acceptTerms === true) st.terms = true;
      if (!st.terms) return json(403, { error: { code: 'ai_terms_not_accepted', message: 'You must accept the KUMODeck AI terms' } });
      const cost = create[1] === 'image' ? 1 : 20;
      if (st.balance < cost) return json(402, { error: { code: 'insufficient_credits', message: 'Not enough' } });
      st.balance -= cost;
      const id = `0000000${++st.n}-0000-4000-8000-000000000000`;
      const file = create[1] === 'image' ? { name: 'star-sky.png', url: `/v1/files/${id}.png` } : { name: 'chest.glb', url: `/v1/files/${id}.glb` };
      const job = { id, status: create[1] === 'image' ? 'succeeded' : 'running', costUsdMicros: cost * 10000, assets: [{ id: 'a', files: [file] }], looks: 0 };
      st.jobs.set(id, job);
      return json(create[1] === 'image' ? 200 : 202, { job: { ...job, assets: job.status === 'succeeded' ? job.assets : [] } });
    }
    const poll = /^\/v1\/projects\/[^/]+\/ai\/3d\/jobs\/([^/]+)$/.exec(p);
    if (poll) {
      const job = st.jobs.get(poll[1]);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (++job.looks >= 2) job.status = 'succeeded';
      return json(200, { job: { ...job, assets: job.status === 'succeeded' ? job.assets : [] } });
    }
    if (p.startsWith('/v1/files/')) {
      // a real 1×1 PNG for the picture (so the grid can show it), bytes for the model
      const bytes = p.endsWith('.wav')
        ? wav()
        : p.endsWith('.png')
        ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
        : modelBytes ? Buffer.concat([Buffer.from('glTF-BINARY-FAKE'), Buffer.alloc(modelBytes - 16)]) : Buffer.from('glTF-BINARY-FAKE');
      res.writeHead(200, { 'content-length': String(bytes.length) });
      return res.end(bytes);
    }
    json(404, { error: { code: 'not_found', message: p } });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const api = `http://127.0.0.1:${srv.address().port}`;
  return {
    st,
    api,
    /** What `npx kumodeck login` would have saved in ~/.kumo/credentials.json for this fake. */
    credentials: () => JSON.stringify({ version: 1, default: api, servers: { [api]: { token: TOKEN, email: 'maker@example.com', developerId: 'd', savedAt: 'x', origin: 'cli_grant' } } }),
    close: () => new Promise((r) => srv.close(r)),
  };
}
