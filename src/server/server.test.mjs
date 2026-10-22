// Tests for the local studio server: the guards first, then the host API.
// Run: node --test src/server/server.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from './server.mjs';
import { isLoaderCopy, mayBeLoaderCopy } from './loader-copy.mjs';
import { injectEditScript, safeAssetName } from './files.mjs';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A game folder inside a parent folder that also holds a secret, so escapes have something to find.
async function fixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'game-studio-test-'));
  const root = path.join(base, 'game');
  await fs.mkdir(path.join(root, 'assets'), { recursive: true });
  await fs.writeFile(path.join(base, 'secret.txt'), 'TOP-SECRET');
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html><html><head><title>t</title></head><body><script type="module" src="game.js"></script></body></html>');
  await fs.writeFile(path.join(root, 'game.js'), "load('assets/tree.png'); load(\"sounds/missing.mp3\"); for (const k of ks) load(`assets/${k}.svg`);\n");
  await fs.writeFile(path.join(root, 'style.css'), 'body { background: url(bg.jpg) }');
  await fs.writeFile(path.join(root, 'assets/tree.png'), 'PNGDATA');
  await fs.writeFile(path.join(root, 'assets/old.png'), 'OLD');
  await fs.writeFile(path.join(root, 'bg.jpg'), 'JPG');
  await fs.writeFile(path.join(root, '.env'), 'API_KEY=nope');
  await fs.symlink(path.join(base, 'secret.txt'), path.join(root, 'link-out.txt'));
  await fs.writeFile(path.join(root, 'media.mp3'), Buffer.alloc(1000, 7));
  return { base, root };
}

async function start(opts = {}) {
  const fx = await fixture();
  const lines = [];
  const started = await startStudioServer({ root: fx.root, log: (l) => lines.push(l), ...opts });
  // close() also removes the temporary folders.
  const srv = { ...started, close: async () => { await started.close(); await fs.rm(fx.base, { recursive: true, force: true }); } };
  const token = new URL(srv.url).searchParams.get('t');
  const host = new URL(srv.origin).host;
  const cookie = `studio_${srv.port}=${token}`;
  // Raw HTTP so tests control every header (fetch would fix Host and refuse some headers).
  const req = (method, p, { headers = {}, body } = {}) =>
    new Promise((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: srv.port, method, path: p, headers: { host, cookie, ...headers } }, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
      });
      r.on('error', reject);
      r.end(body);
    });
  return { ...fx, srv, token, cookie, host, lines, req };
}

const placement = (objects) => JSON.stringify({ version: 1, tool: 'placement', dim: '3d', objects });

test('no pass, wrong pass, wrong Host: refused before anything else', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  for (const p of ['/', '/index.html', '/__studio/', '/__studio/api/open', '/__studio/api/assets', '/__studio/api/link']) {
    const r = await s.req('GET', p, { headers: { cookie: '' } });
    assert.equal(r.status, 403, p);
  }
  assert.equal((await s.req('GET', '/__studio/?t=wrong', { headers: { cookie: '' } })).status, 403);
  assert.equal((await s.req('GET', '/index.html', { headers: { cookie: `studio_${s.srv.port}=wrong` } })).status, 403);
  // DNS rebinding: right cookie and pass, but the page was reached through another name.
  const evil = await s.req('GET', '/index.html', { headers: { host: `evil.example:${s.srv.port}` } });
  assert.equal(evil.status, 403);
  assert.doesNotMatch(evil.text, /<html/);
  const evil2 = await s.req('GET', `/__studio/?t=${s.token}`, { headers: { host: 'evil.example', cookie: '' } });
  assert.equal(evil2.status, 403);
});

test('the pass is traded for a SameSite=Strict cookie and removed from the URL', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = await s.req('GET', `/__studio/?t=${s.token}`, { headers: { cookie: '' } });
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/__studio/');
  assert.match(r.headers['set-cookie'][0], new RegExp(`^studio_${s.srv.port}=${s.token}; Path=/; HttpOnly; SameSite=Strict$`));
  assert.equal((await s.req('GET', '/__studio/', { headers: { cookie: r.headers['set-cookie'][0].split(';')[0] } })).status, 200);
  // localhost works as well as 127.0.0.1.
  assert.equal((await s.req('GET', '/index.html', { headers: { host: `localhost:${s.srv.port}` } })).status, 200);
});

test('a game\'s own "?t=" query is not mistaken for the pass', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = await s.req('GET', '/game.js?t=12345');
  assert.equal(r.status, 200);
  assert.match(r.text, /load\(/);
});

test('files outside the folder, hidden files and outside symlinks are never served', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const tries = ['/../secret.txt', '/%2e%2e/secret.txt', '/assets/..%2f..%2fsecret.txt', '/assets/%2e%2e%2f%2e%2e%2fsecret.txt', '/..%5csecret.txt', '/link-out.txt', '/.env', '/%2eenv', '/assets/../../secret.txt'];
  for (const p of tries) {
    const r = await s.req('GET', p);
    assert.notEqual(r.status, 200, p);
    assert.doesNotMatch(r.text, /TOP-SECRET|API_KEY/, p);
  }
  assert.equal((await s.req('GET', '/link-out.txt')).status, 403);
  assert.equal((await s.req('GET', '/.env')).status, 404);
});

test('HTML responses get the edit script first in <head>; the file on disk is unchanged', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = await s.req('GET', '/index.html');
  assert.equal(r.status, 200);
  assert.match(r.text, /^<!doctype html><html><head><script src="\/__studio\/studio-edit\.js" data-studio-edit><\/script><script src="\/__studio\/game-adapter\.js" data-studio-adapter><\/script><script src="\/__studio\/game-tools\.js" data-studio-tools><\/script><title>/);
  assert.doesNotMatch(await fs.readFile(path.join(s.root, 'index.html'), 'utf8'), /studio-edit/);
  // Non-HTML is served as is.
  assert.equal((await s.req('GET', '/game.js')).text, await fs.readFile(path.join(s.root, 'game.js'), 'utf8'));
  // The directory URL serves index.html (also injected).
  assert.match((await s.req('GET', '/assets/../index.html')).text, /studio-edit/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(r.headers['content-security-policy'], /frame-ancestors 'self'/);
});

test('the game\'s copy of the loader goes out as the editor\'s own; the file on disk and look-alikes stay (integrate 1023)', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  // An older copy: the built file's header, applyPlacement, no play hook (as a game keeps it from before v0.1.24).
  const old = '// KUMODeck Game Studio placement loader (MIT). Applies placement.json to a three.js Scene or PixiJS stage.\n'
    + 'export async function applyPlacement(root, source) { return { applied: [] }; }\nexport function stopMotion() {}\n';
  await fs.writeFile(path.join(s.root, 'studio-placement.js'), old);
  await fs.mkdir(path.join(s.root, 'js'));
  await fs.writeFile(path.join(s.root, 'js/studio-placement.js'), old);
  // Same name, not the loader (the game's own file): as it is.
  await fs.mkdir(path.join(s.root, 'own'));
  const own = '// my placement helpers\nexport async function applyPlacement() {}\n';
  await fs.writeFile(path.join(s.root, 'own/studio-placement.js'), own);
  const current = await (await s.req('GET', '/__studio/studio-placement.js')).text;
  assert.match(current, /game-studio\.play/);
  for (const p of ['/studio-placement.js', '/js/studio-placement.js']) {
    const r = await s.req('GET', p);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /^text\/javascript/);
    assert.equal(r.text, current, p);
  }
  assert.equal((await s.req('GET', '/own/studio-placement.js')).text, own);
  assert.equal(await fs.readFile(path.join(s.root, 'studio-placement.js'), 'utf8'), old);
  // HEAD answers the same length, no body.
  const h = await s.req('HEAD', '/studio-placement.js');
  assert.equal(Number(h.headers['content-length']), Buffer.byteLength(current));
});

test('isLoaderCopy: every shape the loader was copied in, and nothing else', () => {
  const pkg = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  return Promise.all([
    fs.readFile(path.join(pkg, 'skills/arrange/bin/studio-placement.js'), 'utf8'),
    fs.readFile(path.join(pkg, 'src/loader/studio-placement.js'), 'utf8'),
  ]).then(([built, source]) => {
    assert.equal(isLoaderCopy(built), true);
    assert.equal(isLoaderCopy(source), true);
    assert.equal(isLoaderCopy('\uFEFF' + built), true);
    assert.equal(isLoaderCopy('// KUMODeck Game Studio placement loader\nexport const x = 1;\n'), false);
    assert.equal(isLoaderCopy("export * from '../../src/loader/studio-placement.js';\n"), false);
    assert.equal(isLoaderCopy(undefined), false);
    assert.equal(mayBeLoaderCopy('/g/js/studio-placement.js', 1000), true);
    assert.equal(mayBeLoaderCopy('/g/studio-placement.js.map', 1000), false);
    assert.equal(mayBeLoaderCopy('/g/my-studio-placement.js', 1000), false);
    assert.equal(mayBeLoaderCopy('/g/studio-placement.js', 10 * 1024 * 1024), false);
  });
});

test('injectEditScript handles pages without <head> and with attributes', () => {
  assert.equal(injectEditScript('<HEAD lang="x"><b>', '/e.js'), '<HEAD lang="x"><script src="/e.js" data-studio-edit></script><b>');
  assert.equal(injectEditScript('<!DOCTYPE html><canvas>', '/e.js'), '<!DOCTYPE html><script src="/e.js" data-studio-edit></script><canvas>');
  assert.equal(injectEditScript('<canvas>', '/e.js'), '<script src="/e.js" data-studio-edit></script><canvas>');
  // <header> is not <head>.
  assert.match(injectEditScript('<header></header>', '/e.js'), /^<script/);
});

test('save: valid files are written canonically and announced in one stdout line', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = await s.req('PUT', '/__studio/api/files/placement', { body: placement({ b: { p: [1.23456, 0, 0] }, 'path:0/1': { r: 1 } }) });
  assert.equal(r.status, 200, r.text);
  const disk = await fs.readFile(path.join(s.root, 'placement.json'), 'utf8');
  assert.equal(JSON.parse(disk).objects.b.p[0], 1.235);
  assert.ok(disk.indexOf('"b"') < disk.indexOf('"path:0/1"'));
  assert.deepEqual(s.lines, ['studio: saved placement.json (2 objects, 1 without a stable name)']);
  const lib = await s.req('PUT', '/__studio/api/files/library', { body: JSON.stringify({ version: 1, tool: 'library', unused: ['assets/old.png'] }) });
  assert.equal(lib.status, 200, lib.text);
  assert.equal(s.lines[1], 'studio: saved library.json (0 replaced, 0 added, 1 unused)');
  // load returns the saved value.
  const load = JSON.parse((await s.req('GET', '/__studio/api/files/placement')).text);
  assert.equal(load.value.objects.b.p[0], 1.235);
  // No temp files left behind.
  assert.deepEqual((await fs.readdir(s.root)).filter((f) => f.endsWith('.tmp')), []);
});

test('save: ?handoff=0 keeps the file quietly (no request, no stdout line)', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = await s.req('PUT', '/__studio/api/files/placement?handoff=0', { body: placement({ b: { p: [2, 0, 0] } }) });
  assert.equal(r.status, 200, r.text);
  assert.equal(JSON.parse(r.text).request, undefined);
  assert.equal(JSON.parse(await fs.readFile(path.join(s.root, 'placement.json'), 'utf8')).objects.b.p[0], 2);
  assert.deepEqual(s.lines, []);
  assert.deepEqual(await fs.readdir(path.join(s.root, '.studio/requests')).catch(() => []), []);
  // Save afterwards: the same file, a request and the line.
  const h = await s.req('PUT', '/__studio/api/files/placement', { body: placement({ b: { p: [2, 0, 0] } }) });
  assert.ok(JSON.parse(h.text).request);
  assert.deepEqual(s.lines, ['studio: saved placement.json (1 object)']);
});

test('save: invalid files are refused and the old file stays', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  await s.req('PUT', '/__studio/api/files/placement', { body: placement({ a: { p: [0, 0, 0] } }) });
  const before = await fs.readFile(path.join(s.root, 'placement.json'), 'utf8');
  for (const body of [placement({ a: { p: [0, 1e9, 0] } }), '{"__proto__":{},"version":1}', 'not json', JSON.stringify({ version: 1, tool: 'library' })]) {
    const r = await s.req('PUT', '/__studio/api/files/placement', { body });
    assert.equal(r.status, 422, body);
    assert.ok(JSON.parse(r.text).details.length > 0);
  }
  const huge = await s.req('PUT', '/__studio/api/files/placement', { body: 'x'.repeat(300 * 1024) });
  assert.equal(huge.status, 413);
  assert.equal(await fs.readFile(path.join(s.root, 'placement.json'), 'utf8'), before);
});

test('writes: cross-origin requests are refused; the game folder is read-only', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const body = placement({ a: { p: [0, 0, 0] } });
  assert.equal((await s.req('PUT', '/__studio/api/files/placement', { body, headers: { origin: 'http://evil.example' } })).status, 403);
  assert.equal((await s.req('PUT', '/__studio/api/files/placement', { body, headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal((await s.req('PUT', '/__studio/api/files/placement', { body, headers: { origin: s.srv.origin, 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.equal((await s.req('PUT', '/index.html', { body: 'pwned' })).status, 405);
  assert.equal((await s.req('POST', '/game.js', { body: 'pwned' })).status, 405);
  assert.equal((await s.req('PUT', '/__studio/api/files/index', { body })).status, 404);
  assert.equal((await s.req('PUT', '/__studio/api/files/..%2Findex', { body })).status, 404);
  assert.match(await fs.readFile(path.join(s.root, 'index.html'), 'utf8'), /<title>t<\/title>/);
});

test('save refuses to write through a symlinked or non-file placement.json', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  await fs.symlink(path.join(s.base, 'secret.txt'), path.join(s.root, 'placement.json'));
  const r = await s.req('PUT', '/__studio/api/files/placement', { body: placement({ a: { p: [0, 0, 0] } }) });
  assert.equal(r.status, 409);
  assert.equal(await fs.readFile(path.join(s.base, 'secret.txt'), 'utf8'), 'TOP-SECRET');
  await fs.mkdir(path.join(s.root, 'library.json'));
  assert.equal((await s.req('PUT', '/__studio/api/files/library', { body: '{"version":1,"tool":"library"}' })).status, 409);
});

test('addAsset: adds new files only, never overwrites, limits type and size', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const a = await s.req('POST', '/__studio/api/assets?name=' + encodeURIComponent('My Tree (final).PNG'), { body: 'NEW1' });
  assert.equal(a.status, 201, a.text);
  assert.equal(JSON.parse(a.text).path, 'assets/my-tree-final.png');
  const b = await s.req('POST', '/__studio/api/assets?name=tree.png', { body: 'NEW2' });
  assert.equal(JSON.parse(b.text).path, 'assets/tree-2.png');
  assert.equal(await fs.readFile(path.join(s.root, 'assets/tree.png'), 'utf8'), 'PNGDATA'); // untouched
  assert.equal(await fs.readFile(path.join(s.root, 'assets/tree-2.png'), 'utf8'), 'NEW2');
  assert.equal((await s.req('POST', '/__studio/api/assets?name=evil.js', { body: 'x' })).status, 415);
  assert.equal((await s.req('POST', '/__studio/api/assets?name=index.html', { body: 'x' })).status, 415);
  const traversal = await s.req('POST', '/__studio/api/assets?name=' + encodeURIComponent('../../escape.png'), { body: 'x' });
  assert.equal(JSON.parse(traversal.text).path, 'assets/escape.png');
  const big = await s.req('POST', '/__studio/api/assets?name=big.glb', { headers: { 'content-length': String(101 * 1024 * 1024) }, body: '' }).catch((e) => ({ status: 'reset', e }));
  assert.ok(big.status === 413 || big.status === 'reset');
  assert.deepEqual(s.lines, ['studio: added assets/my-tree-final.png', 'studio: added assets/tree-2.png', 'studio: added assets/escape.png']);
});

test('safeAssetName', () => {
  assert.equal(safeAssetName('a/b/../Rock.GLB'), 'rock.glb');
  assert.equal(safeAssetName('..png'), 'asset.png');
  assert.equal(safeAssetName('\u00e9\u00e8.png'), 'asset.png');
  assert.equal(safeAssetName('x.exe'), null);
  assert.equal(safeAssetName('.htaccess'), null);
});

test('assets: lists asset files with the code that names them, plus missing names', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = JSON.parse((await s.req('GET', '/__studio/api/assets')).text);
  const byPath = Object.fromEntries(r.assets.map((a) => [a.path, a]));
  assert.deepEqual(byPath['assets/tree.png'].refsInCode, ['game.js']);
  assert.equal(byPath['assets/tree.png'].type, 'image');
  assert.equal(byPath['assets/tree.png'].size, 7);
  assert.deepEqual(byPath['assets/old.png'].refsInCode, []);
  assert.deepEqual(byPath['bg.jpg'].refsInCode, ['style.css']);
  assert.equal(byPath['media.mp3'].type, 'audio');
  assert.equal(byPath['link-out.txt'], undefined);
  assert.deepEqual(r.missing, [{ ref: 'sounds/missing.mp3', in: ['game.js'] }]);
});

test('next step: writes .studio/next-step.md and one line; nothing else', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = await s.req('POST', '/__studio/api/next-step', { body: '{"id":"publish"}' });
  assert.equal(r.status, 200, r.text);
  const md = await fs.readFile(path.join(s.root, '.studio/next-step.md'), 'utf8');
  assert.match(md, /^# Next step: Publish to KUMODeck/);
  assert.match(md, /Ask the user to confirm/);
  assert.doesNotMatch(md, /\$\d/); // no prices
  assert.deepEqual(s.lines, ['studio: next-step publish .studio/next-step.md']);
  assert.equal((await s.req('POST', '/__studio/api/next-step', { body: '{"id":"__proto__"}' })).status, 400);
  assert.equal((await s.req('POST', '/__studio/api/next-step', { body: '{"id":"rm -rf"}' })).status, 400);
  // .studio is never served.
  assert.equal((await s.req('GET', '/.studio/next-step.md')).status, 404);
});

test('delete request: hands the checked files to the agent and deletes nothing', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = await s.req('POST', '/__studio/api/next-step', { body: JSON.stringify({ id: 'delete-files', files: ['assets/old.png', 'bg.jpg', 'assets/old.png'] }) });
  assert.equal(r.status, 200, r.text);
  const md = await fs.readFile(path.join(s.root, '.studio/next-step.md'), 'utf8');
  assert.match(md, /^# Next step: Delete unused files/);
  assert.match(md, /- `assets\/old\.png`\n- `bg\.jpg`/);
  assert.match(md, /Ask the user to confirm/);
  assert.doesNotMatch(md, /KUMODeck/);
  assert.deepEqual(s.lines, ['studio: next-step delete-files .studio/next-step.md']);
  // The files are still there: the editor never deletes.
  assert.equal(await fs.readFile(path.join(s.root, 'assets/old.png'), 'utf8'), 'OLD');
  for (const files of [[], ['../secret.txt'], ['.env'], ['nope.png'], ['assets'], ['link-out.txt'], 'x', [1]]) {
    const bad = await s.req('POST', '/__studio/api/next-step', { body: JSON.stringify({ id: 'delete-files', files }) });
    assert.equal(bad.status, 400, `${JSON.stringify(files)} → ${bad.text}`);
  }
});

test('delete request through /request (the Library since the AI-partner merge): same check, same file and line, one record', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = await s.req('POST', '/__studio/api/request', { body: JSON.stringify({ kind: 'next-step', step: 'delete-files', text: '', lang: 'ja', files: ['bg.jpg', 'assets/old.png', 'bg.jpg'] }) });
  assert.equal(r.status, 200, r.text);
  const md = await fs.readFile(path.join(s.root, '.studio/next-step.md'), 'utf8');
  assert.match(md, /^# Next step: Delete unused files/);
  assert.match(md, /- `assets\/old\.png`\n- `bg\.jpg`/);
  assert.deepEqual(s.lines, ['studio: next-step delete-files .studio/next-step.md']);
  const recs = await listRequests(s.root);
  assert.equal(recs.length, 1);
  const rec = JSON.parse(await fs.readFile(path.join(s.root, '.studio/requests', recs[0]), 'utf8'));
  assert.deepEqual([rec.kind, rec.step, rec.files], ['next-step', 'delete-files', ['.studio/next-step.md', 'assets/old.png', 'bg.jpg']]);
  assert.equal(await fs.readFile(path.join(s.root, 'assets/old.png'), 'utf8'), 'OLD');
  // Shape errors are 422 (handoff.mjs); a path that is not a plain file in the folder is 400 (the host's check).
  for (const files of [[], ['../secret.txt'], ['.env'], 'x', [1]]) {
    const bad = await s.req('POST', '/__studio/api/request', { body: JSON.stringify({ kind: 'next-step', step: 'delete-files', text: '', files }) });
    assert.equal(bad.status, 422, `${JSON.stringify(files)} → ${bad.text}`);
  }
  for (const files of [['nope.png'], ['assets'], ['link-out.txt']]) {
    const bad = await s.req('POST', '/__studio/api/request', { body: JSON.stringify({ kind: 'next-step', step: 'delete-files', text: '', files }) });
    assert.equal(bad.status, 400, `${JSON.stringify(files)} → ${bad.text}`);
  }
  assert.equal((await listRequests(s.root)).length, 1);
});

test('open, range requests and the fallback page', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  assert.deepEqual(JSON.parse((await s.req('GET', '/__studio/api/open')).text), { gameUrl: '/index.html', origin: s.srv.origin, lanUrl: null, title: 't' });
  const part = await s.req('GET', '/media.mp3', { headers: { range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers['content-range'], 'bytes 10-19/1000');
  assert.equal(part.text.length, 10);
  assert.equal((await s.req('GET', '/media.mp3', { headers: { range: 'bytes=5000-' } })).status, 416);
  assert.match((await s.req('GET', '/__studio/')).text, /createLocalHost/);
  assert.match((await s.req('GET', '/__studio/host.js')).text, /export function createLocalHost/);
  assert.match((await s.req('GET', '/__studio/studio-placement.js')).text, /export async function applyPlacement/);
  assert.equal((await s.req('GET', '/__studio/studio-edit.js')).status, 200);
  assert.equal((await s.req('GET', '/__studio/api/lan-qr.svg')).status, 404); // only with --lan
});

test('"Open large": the printed link, pass included, only to a page holding the cookie', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = await s.req('GET', '/__studio/api/link');
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(r.text).url, s.srv.url);
  // The link opens the editor in a fresh browser (no cookie yet), as the side window's large window does.
  const fresh = await s.req('GET', new URL(JSON.parse(r.text).url).pathname + new URL(JSON.parse(r.text).url).search, { headers: { cookie: '' } });
  assert.equal(fresh.status, 302);
  assert.equal((await s.req('GET', '/__studio/api/link', { headers: { cookie: '' } })).status, 403);
});

test('--lan mode serves the QR of the editor link', async (t) => {
  const s = await start({ isLan: true });
  t.after(() => s.srv.close());
  assert.equal(JSON.parse((await s.req('GET', '/__studio/api/open')).text).lanUrl, s.srv.url);
  const svg = await s.req('GET', '/__studio/api/lan-qr.svg');
  assert.equal(svg.status, 200);
  assert.match(svg.text, /^<svg/);
  assert.equal((await s.req('GET', '/__studio/api/lan-qr.svg', { headers: { cookie: '' } })).status, 403);
});

test('a built UI folder replaces the fallback page and the edit script stub', async (t) => {
  const ui = await fs.mkdtemp(path.join(os.tmpdir(), 'game-studio-ui-'));
  await fs.writeFile(path.join(ui, 'index.html'), '<p>real shell</p>');
  await fs.writeFile(path.join(ui, 'studio-edit.js'), 'window.REAL_EDIT = 1;');
  const s = await start({ uiDir: ui });
  t.after(() => s.srv.close());
  assert.equal((await s.req('GET', '/__studio/')).text, '<p>real shell</p>');
  assert.equal((await s.req('GET', '/__studio/studio-edit.js')).text, 'window.REAL_EDIT = 1;');
  for (const p of ['/__studio/..%2f..%2fsecret.txt', '/__studio/%2e%2e/%2e%2e/secret.txt']) {
    const r = await s.req('GET', p);
    assert.notEqual(r.status, 200, p);
    assert.doesNotMatch(r.text, /TOP-SECRET/);
  }
  await fs.rm(ui, { recursive: true, force: true });
});

test('the built studio.mjs runs on its own and prints the ready line', { timeout: 20000 }, async (t) => {
  const { base, root } = await fixture();
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const child = spawn(process.execPath, [path.join(PKG, 'skills/arrange/bin/studio.mjs'), root, '--no-open'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGTERM'));
  const line = await new Promise((resolve, reject) => {
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) resolve(buf.split('\n')[0]);
    });
    child.on('exit', (code) => reject(new Error('exited ' + code)));
  });
  const m = /^studio: ready (http:\/\/127\.0\.0\.1:(\d+)\/__studio\/\?t=[A-Za-z0-9_-]{22})$/.exec(line);
  assert.ok(m, line);
  const res = await fetch(m[1], { redirect: 'manual' });
  assert.equal(res.status, 302);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const page = await fetch(`http://127.0.0.1:${m[2]}/index.html`, { headers: { cookie } });
  assert.match(await page.text(), /studio-edit\.js/);
  const save = await fetch(`http://127.0.0.1:${m[2]}/__studio/api/files/placement`, { method: 'PUT', headers: { cookie }, body: placement({ a: { p: [1, 2, 3] } }) });
  assert.equal(save.status, 200);
  assert.ok((await fs.readFile(path.join(root, 'placement.json'), 'utf8')).includes('"a"'));
});

test('game-adapter.js serves .studio/adapter.js only (plain file), else an empty script', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  let r = await s.req('GET', '/__studio/game-adapter.js');
  assert.equal(r.status, 200);
  assert.match(r.text, /no \.studio\/adapter\.js/);
  await fs.mkdir(path.join(s.root, '.studio'));
  await fs.writeFile(path.join(s.root, '.studio/adapter.js'), 'window.__adapterLoaded = 1;');
  r = await s.req('GET', '/__studio/game-adapter.js');
  assert.equal(r.text, 'window.__adapterLoaded = 1;');
  assert.match(r.headers['content-type'], /javascript/);
  // Other dot-files stay hidden, and a symlinked adapter is not followed.
  assert.equal((await s.req('GET', '/.studio/adapter.js')).status, 404);
  await fs.rm(path.join(s.root, '.studio/adapter.js'));
  await fs.symlink(path.join(s.base, 'secret.txt'), path.join(s.root, '.studio/adapter.js'));
  r = await s.req('GET', '/__studio/game-adapter.js');
  assert.doesNotMatch(r.text, /TOP-SECRET/);
});

test('check: a failed self-check is written to .studio/check.md with one stdout line', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const origin = s.srv.origin;
  const post = (body) => s.req('POST', '/__studio/api/check', { headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let r = await post({ ok: true, kind: 'three', checks: [{ id: 'adapter-found', ok: true }] });
  assert.equal(r.status, 204);
  assert.ok(s.lines.some((l) => l === 'studio: check ok (three)'));
  r = await post({ ok: false, kind: 'pixi', sample: 'hero', checks: [{ id: 'has-objects', ok: true }, { id: 'screen-changes', ok: false, detail: 'same picture' }] });
  assert.equal(r.status, 204);
  assert.ok(s.lines.some((l) => l.startsWith('studio: check failed: screen-changes')));
  const md = await fs.readFile(path.join(s.root, '.studio/check.md'), 'utf8');
  assert.match(md, /FAIL `screen-changes` — same picture/);
  assert.equal((await post({ nope: 1 })).status, 400);
  // Objects without a name: one more line, so the agent can offer once to name them (play test 2026-10-16).
  const before = s.lines.length;
  await post({ ok: true, kind: 'pixi', unnamed: ['path:1', 'path:6', 'not a key!'], unnamedCount: 2, checks: [{ id: 'adapter-found', ok: true }] });
  assert.deepEqual(s.lines.slice(before), ['studio: check ok (pixi)', 'studio: unnamed 2 objects without a name: path:1, path:6']);
  const before2 = s.lines.length;
  await post({ ok: true, kind: 'three', checks: [{ id: 'adapter-found', ok: true }] });
  assert.deepEqual(s.lines.slice(before2), ['studio: check ok (three)'], 'no line when every object has a name');
});

test('ui/prefs.json, studio.json, ui/ files and tool data live under .studio/ (fixed names only)', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const origin = s.srv.origin;
  const w = { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
  // Nothing yet.
  assert.deepEqual(JSON.parse((await s.req('GET', '/__studio/api/ui')).text), { value: null });
  assert.deepEqual(JSON.parse((await s.req('GET', '/__studio/api/config')).text), { value: null });
  // UI preferences round-trip.
  let r = await s.req('PUT', '/__studio/api/ui', { headers: w, body: JSON.stringify({ version: 1, panel: 'left' }) });
  assert.equal(r.status, 200);
  assert.equal(JSON.parse(await fs.readFile(path.join(s.root, '.studio/ui/prefs.json'), 'utf8')).panel, 'left');
  assert.equal(JSON.parse((await s.req('GET', '/__studio/api/ui')).text).value.panel, 'left');
  assert.equal((await s.req('PUT', '/__studio/api/ui', { headers: w, body: '[1]' })).status, 400);
  // The game's settings are read only (written by the AI, not by the editor).
  await fs.writeFile(path.join(s.root, '.studio/studio.json'), '{"version":1,"snap":{"grid":1}}');
  assert.deepEqual(JSON.parse((await s.req('GET', '/__studio/api/config')).text).value, { version: 1, snap: { grid: 1 } });
  assert.equal((await s.req('PUT', '/__studio/api/config', { headers: w, body: '{}' })).status, 404);
  await fs.writeFile(path.join(s.root, '.studio/studio.json'), '{oops');
  assert.match(JSON.parse((await s.req('GET', '/__studio/api/config')).text).error, /not valid JSON/);
  // Tool data: id pattern enforced, one stdout line per save.
  r = await s.req('PUT', '/__studio/api/data/track', { headers: w, body: JSON.stringify({ points: [[0, 0], [1, 2]] }) });
  assert.equal(r.status, 200);
  assert.ok(s.lines.includes('studio: saved .studio/data/track.json'));
  assert.deepEqual(JSON.parse((await s.req('GET', '/__studio/api/data/track')).text).value, { points: [[0, 0], [1, 2]] });
  assert.equal((await s.req('PUT', '/__studio/api/data/..%2Fx', { headers: w, body: '{}' })).status, 404);
  assert.equal((await s.req('PUT', '/__studio/api/data/Bad_Id', { headers: w, body: '{}' })).status, 404);
  // The AI's rewrite of the editor look: served to the shell from fixed routes.
  assert.match((await s.req('GET', '/__studio/game-ui.css')).text, /no \.studio\/ui\/studio\.css/);
  await fs.writeFile(path.join(s.root, '.studio/ui/studio.css'), ':root { --studio-accent: red; }');
  await fs.writeFile(path.join(s.root, '.studio/ui/shell.js'), 'studioShell.hide("next");');
  r = await s.req('GET', '/__studio/game-ui.css');
  assert.equal(r.text, ':root { --studio-accent: red; }');
  assert.match(r.headers['content-type'], /text\/css/);
  assert.equal((await s.req('GET', '/__studio/game-ui.js')).text, 'studioShell.hide("next");');
  // tools.js is served from its own route only.
  await fs.writeFile(path.join(s.root, '.studio/tools.js'), 'window.__tools = 1;');
  assert.equal((await s.req('GET', '/__studio/game-tools.js')).text, 'window.__tools = 1;');
  assert.equal((await s.req('GET', '/.studio/tools.js')).status, 404);
});

// ---------------------------------------------------------------------------------------------
// Hand-offs to the AI (CONTRACT.md §3.4)

const listRequests = async (root) => (await fs.readdir(path.join(root, '.studio/requests')).catch(() => [])).filter((n) => n.endsWith('.json')).sort();

test('request: kept as .studio/requests/<id>.json first, then one line', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const body = JSON.stringify({ kind: 'ask', text: 'add 3 more\nin a row', lang: 'en', dim: '3d', unsaved: 2,
    objects: [{ key: 'barrel', label: 'Barrel', pose: { p: [1.23456, 0, -2], r: 0.5 } }] });
  const r = await s.req('POST', '/__studio/api/request', { body, headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 200, r.text);
  const v = JSON.parse(r.text);
  assert.match(v.id, /^\d{8}-\d{6}-\d{3}-ask-[0-9a-f]{4}$/);
  const files = await listRequests(s.root);
  assert.deepEqual(files, [`${v.id}.json`]);
  const rec = JSON.parse(await fs.readFile(path.join(s.root, '.studio/requests', files[0]), 'utf8'));
  assert.equal(rec.version, 1);
  assert.equal(rec.kind, 'ask');
  assert.equal(rec.text, 'add 3 more in a row'); // one line: no line breaks reach the agent
  assert.deepEqual(rec.objects, [{ key: 'barrel', label: 'Barrel', pose: { p: [1.235, 0, -2], r: 0.5 } }]);
  assert.equal(rec.unsaved, 2);
  assert.ok(Date.parse(rec.at) <= Date.now());
  assert.deepEqual(s.lines, [`studio: request ask .studio/requests/${v.id}.json "add 3 more in a row" (Barrel)`]);
  // Bad requests are refused and nothing is written.
  for (const bad of [{ kind: 'ask', text: '', objects: [{ key: 'a' }] }, { kind: 'name', text: '' }, { kind: 'saved', text: 'x' },
    { kind: 'name', objects: [{ key: 'has space' }] }, { kind: 'next-step', step: 'rm -rf' }, [1]]) {
    assert.equal((await s.req('POST', '/__studio/api/request', { body: JSON.stringify(bad) })).status, 422, JSON.stringify(bad));
  }
  assert.equal((await s.req('POST', '/__studio/api/request', { body: 'nope' })).status, 400);
  assert.equal((await listRequests(s.root)).length, 1);
  // Never served to the browser.
  assert.equal((await s.req('GET', `/.studio/requests/${v.id}.json`)).status, 404);
});

test('request: "play" (asked while playing, §3.5) keeps its picture as .studio/play/<id>.jpg and names it in the record', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
  const body = JSON.stringify({ kind: 'play', text: 'the character vanished here', lang: 'en', dim: '3d',
    shot: 'data:image/jpeg;base64,' + jpeg.toString('base64'), view: { eye: [0, 2, 5], target: [0, 1, -5] },
    near: [{ key: 'hero', d: 1.5 }], logs: [{ level: 'error', text: 'TypeError: hero is undefined', ago: 0.4 }] });
  const r = await s.req('POST', '/__studio/api/request', { body });
  assert.equal(r.status, 200, r.text);
  const v = JSON.parse(r.text);
  assert.match(v.id, /^\d{8}-\d{6}-\d{3}-play-[0-9a-f]{4}$/);
  const rec = JSON.parse(await fs.readFile(path.join(s.root, '.studio/requests', `${v.id}.json`), 'utf8'));
  assert.equal(rec.shot, `.studio/play/${v.id}.jpg`, 'the record names the file, not the bytes');
  assert.deepEqual(await fs.readFile(path.join(s.root, rec.shot)), jpeg);
  assert.deepEqual(rec.near, [{ key: 'hero', d: 1.5 }]);
  assert.equal(rec.logs[0].level, 'error');
  assert.deepEqual(s.lines, [`studio: request play .studio/requests/${v.id}.json "the character vanished here" (while playing, picture .studio/play/${v.id}.jpg, 1 error)`]);
  // Never served to the browser.
  assert.equal((await s.req('GET', `/${rec.shot}`)).status, 404);
  // A picture that is not one is refused, and nothing is kept.
  const bad = await s.req('POST', '/__studio/api/request', { body: JSON.stringify({ kind: 'play', text: 'x', shot: 'data:text/html;base64,PGgxPg==' }) });
  assert.equal(bad.status, 422);
  assert.equal((await listRequests(s.root)).length, 1);
});

test('request: next steps — KUMODeck ones keep next-step.md and their line, AI ones get a request line', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r1 = await s.req('POST', '/__studio/api/request', { body: JSON.stringify({ kind: 'next-step', step: 'publish', text: 'Publish it', lang: 'en' }) });
  assert.equal(r1.status, 200, r1.text);
  assert.match(await fs.readFile(path.join(s.root, '.studio/next-step.md'), 'utf8'), /^# Next step: Publish to KUMODeck/);
  const r2 = await s.req('POST', '/__studio/api/request', { body: JSON.stringify({ kind: 'next-step', step: 'fit', text: 'snap to 1 m', lang: 'en' }) });
  const id2 = JSON.parse(r2.text).id;
  assert.deepEqual(s.lines, ['studio: next-step publish .studio/next-step.md', `studio: request next-step fit .studio/requests/${id2}.json "snap to 1 m"`]);
  const recs = await listRequests(s.root);
  assert.equal(recs.length, 2);
  // Both can be written in the same millisecond (then the random tail orders them): find by step.
  const all = await Promise.all(recs.map(async (n) => JSON.parse(await fs.readFile(path.join(s.root, '.studio/requests', n), 'utf8'))));
  const first = all.find((r) => r.step === 'publish');
  assert.deepEqual([first.step, first.files], ['publish', ['.studio/next-step.md']]);
});

test('saves are kept as "saved" requests too; the save line stays the same', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const r = await s.req('PUT', '/__studio/api/files/placement', { body: placement({ tree: { p: [1, 2, 3] } }) });
  assert.equal(r.status, 200, r.text);
  const v = JSON.parse(r.text);
  assert.match(v.request, /-saved-/);
  assert.equal(typeof v.at, 'number');
  assert.deepEqual(s.lines, ['studio: saved placement.json (1 object)']);
  const rec = JSON.parse(await fs.readFile(path.join(s.root, '.studio/requests', `${v.request}.json`), 'utf8'));
  assert.deepEqual([rec.kind, rec.files, rec.text], ['saved', ['placement.json'], '1 object']);
});

test('status: the agent\'s .studio/status.json, read leniently, with the time it was written', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  // status and time only: `watching` and `code` (AI feel) have their own tests in ai-feel.test.mjs.
  const get = async () => {
    const { status, time } = JSON.parse((await s.req('GET', '/__studio/api/status')).text);
    return { status, time };
  };
  assert.deepEqual(await get(), { status: null, time: null });
  await fs.mkdir(path.join(s.root, '.studio'), { recursive: true });
  await fs.writeFile(path.join(s.root, '.studio/status.json'), JSON.stringify({ state: 'done', changed: 3, note: 'Added 3 barrels', extra: 'dropped', request: 'nope' }));
  const v = await get();
  assert.deepEqual(v.status, { version: 1, state: 'done', changed: 3, note: 'Added 3 barrels' });
  assert.ok(Math.abs(v.time - Date.now()) < 60_000);
  await fs.writeFile(path.join(s.root, '.studio/status.json'), '{ broken');
  assert.deepEqual(await get(), { status: null, time: null });
  await fs.writeFile(path.join(s.root, '.studio/status.json'), JSON.stringify({ state: 'exploded' }));
  assert.deepEqual(await get(), { status: null, time: null });
});

test('status: which AI started the editor (`agent`, which-ai.mjs) for the line\'s "More in Claude" (2026-10-21)', async (t) => {
  const agentOf = async (env) => {
    const s = await start({ env });
    t.after(() => s.srv.close());
    return JSON.parse((await s.req('GET', '/__studio/api/status')).text).agent;
  };
  assert.equal(await agentOf({ CLAUDECODE: '1' }), 'claude');
  assert.equal(await agentOf({ CODEX_SANDBOX: 'seatbelt' }), 'codex');
  // A plain terminal (CODEX_HOME alone is a shell-profile setting, not Codex running): left out.
  assert.equal(await agentOf({ PATH: '/usr/bin', CODEX_HOME: '/x' }), undefined);
  // The plugin's wake hook waits for this folder (Claude Code only): Claude, whatever the environment says.
  const s = await start({ env: { CODEX_SANDBOX: 'seatbelt' } });
  t.after(() => s.srv.close());
  await fs.mkdir(path.join(s.root, '.studio'), { recursive: true });
  await fs.writeFile(path.join(s.root, '.studio/wake.json'), JSON.stringify({ version: 1, pid: process.pid, at: new Date().toISOString() }));
  assert.equal(JSON.parse((await s.req('GET', '/__studio/api/status')).text).agent, 'claude');
});

test('title: the page <title>, or the folder name when the title says nothing', async (t) => {
  const s = await start();
  t.after(() => s.srv.close());
  const title = async () => JSON.parse((await s.req('GET', '/__studio/api/open')).text).title;
  await fs.writeFile(path.join(s.root, 'index.html'), '<html><head><title> Crate &amp; Barrel\n Rush </title></head></html>');
  assert.equal(await title(), 'Crate & Barrel Rush');
  await fs.writeFile(path.join(s.root, 'index.html'), '<html><head><title>Vite App</title></head></html>');
  assert.equal(await title(), 'game'); // the fixture's folder name
  await fs.writeFile(path.join(s.root, 'index.html'), '<html><body>no title</body></html>');
  assert.equal(await title(), 'game');
});

test('studio.mjs --requests / --status: what the agent runs', async (t) => {
  const fx = await fixture();
  t.after(() => fs.rm(fx.base, { recursive: true, force: true }));
  const lines = [];
  const srv = await startStudioServer({ root: fx.root, log: (l) => lines.push(l) });
  const token = new URL(srv.url).searchParams.get('t');
  const post = (p, body) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: srv.port, method: 'POST', path: p, headers: { host: new URL(srv.origin).host, cookie: `studio_${srv.port}=${token}` } }, (res) => {
      const c = [];
      res.on('data', (x) => c.push(x));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(c).toString('utf8'))));
    });
    r.on('error', reject);
    r.end(body);
  });
  const a = await post('/__studio/api/request', JSON.stringify({ kind: 'ask', text: 'make it glow', objects: [{ key: 'lamp' }] }));
  await new Promise((r) => setTimeout(r, 5));
  const b = await post('/__studio/api/request', JSON.stringify({ kind: 'name', text: '', objects: [{ key: 'path:3' }] }));
  await srv.close();
  const cli = path.join(PKG, 'src/server/cli.mjs');
  const run = (...args) => new Promise((resolve) => {
    const p = spawn(process.execPath, [cli, fx.root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
  });
  const listed = await run('--requests');
  assert.equal(listed.code, 0, listed.err);
  assert.deepEqual(listed.out.trim().split('\n').map((l) => JSON.parse(l).id), [a.id, b.id]);
  const rec = await run('--status', 'received');
  assert.equal(rec.code, 0, rec.err);
  let st = JSON.parse(await fs.readFile(path.join(fx.root, '.studio/status.json'), 'utf8'));
  assert.deepEqual([st.state, st.request], ['received', b.id]); // default: the newest waiting request
  const done = await run('--status', 'done', '--request', a.id, '--changed', '1', '--note', 'Glows now');
  assert.equal(done.code, 0, done.err);
  st = JSON.parse(await fs.readFile(path.join(fx.root, '.studio/status.json'), 'utf8'));
  assert.deepEqual([st.state, st.request, st.changed, st.note, st.handled], ['done', a.id, 1, 'Glows now', [a.id]]);
  // Only requests up to --request moved to done/; the newer one still waits.
  assert.deepEqual((await run('--requests')).out.trim().split('\n').map((l) => JSON.parse(l).id), [b.id]);
  assert.ok(await fs.stat(path.join(fx.root, '.studio/requests/done', `${a.id}.json`)));
  assert.equal((await run('--status', 'exploded')).code, 2);
});

test('a port already in use: the editor opens on a free one and says so in one line (never stops)', async (t) => {
  const busy = http.createServer();
  await new Promise((r) => busy.listen(0, '127.0.0.1', r));
  const taken = busy.address().port;
  t.after(() => new Promise((r) => busy.close(r)));
  const { srv, lines } = await start({ port: taken });
  t.after(() => srv.close());
  assert.notEqual(srv.port, taken);
  const line = lines.find((l) => l.startsWith(`studio: port ${taken} is in use`));
  assert.ok(line, `no line about the busy port: ${lines.join(' | ')}`);
  assert.match(line, new RegExp(`opened on port ${srv.port} instead`));
});
