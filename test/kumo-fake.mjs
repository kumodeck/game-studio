// A small fake KUMODeck on 127.0.0.1 for "Make with AI" (src/server/kumo.mjs): the routes the
// studio server calls, with a balance, the one-time AI terms, a picture made at once and a 3D model
// done on the second look. Used by test/studio-kumo.browser.mjs and test/kumo-try.mjs. Nothing
// leaves the machine; the "token" is a made-up string.
import http from 'node:http';

export const FAKE_KUMO_TOKEN = 'kds_fake_SECRET_never_in_page_0123456789';
export const FAKE_KUMO_PROJECT = '11111111-1111-4111-8111-111111111111';
const TOKEN = FAKE_KUMO_TOKEN;
const PROJECT = FAKE_KUMO_PROJECT;

/** A small fake KUMODeck (the routes kumo.mjs calls). The 3D job is done on the second look. */
export async function fakeKumoServer({ delayMs = 0 } = {}) {
  const st = { balance: 500, terms: false, n: 0, jobs: new Map(), posts: 0 };
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
    const create = /^\/v1\/projects\/[^/]+\/ai\/(image|3d)\/jobs$/.exec(p);
    if (create && req.method === 'POST') {
      st.posts++;
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
      const bytes = p.endsWith('.png')
        ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
        : Buffer.from('glTF-BINARY-FAKE');
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
