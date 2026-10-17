// Static file server for the 2D adapter browser tests.
//
// It mimics the two things the real local host (src/server) does that matter
// to an adapter (CONTRACT.md §1.4, LOCAL_PATHS in src/contract.ts):
//   1. HTML pages opened with ?studio=edit get the edit script injected as the
//      first child of <head>, followed by the game folder's .studio/adapter.js,
//      so both run before any game code.
//   2. placement.json is served from a scratch folder the test writes to, so
//      "save, then reload and apply" can be checked without touching the
//      example folders.
// The edit script here is test/adapters-2d/studio-stub.js, a stand-in for the
// real bridge until it lands (see that file).
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css',
  '.wasm': 'application/wasm', '.pck': 'application/octet-stream',
};

/**
 * @param {string} root folder served at "/" (oss/game-studio)
 * @param {string} scratch folder holding per-example placement.json files: <scratch>/<example>.json
 */
export function startServer(root, scratch) {
  const here = resolve(root, 'test/adapters-2d');
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let path = normalize(decodeURIComponent(url.pathname));
    if (path.includes('..')) return void res.writeHead(400).end();
    if (path === '/__studio/studio-edit.js') return send(res, join(here, 'studio-stub.js'));
    // /examples/<name>/placement.json -> scratch copy (404 when the test has not saved one)
    const pm = path.match(/^\/examples\/([^/]+)\/placement\.json$/);
    if (pm) {
      const f = join(scratch, `${pm[1]}.json`);
      return existsSync(f) ? send(res, f) : void res.writeHead(404).end();
    }
    let file = join(root, path);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) return void res.writeHead(404).end();
    if (file.endsWith('.html') && url.searchParams.get('studio') === 'edit') {
      const dir = path.endsWith('/') ? path : path.replace(/[^/]*$/, '');
      const inject = '<script src="/__studio/studio-edit.js"></script>'
        + (existsSync(join(root, dir, '.studio/adapter.js')) ? `<script src="${dir}.studio/adapter.js"></script>` : '');
      const html = readFileSync(file, 'utf8').replace(/<head[^>]*>/i, (m) => m + inject);
      res.writeHead(200, { 'content-type': TYPES['.html'], 'cache-control': 'no-store' });
      return void res.end(html);
    }
    send(res, file);
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => {
    res({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) });
  }));
}

function send(res, file) {
  const headers = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' };
  // Godot web exports need cross-origin isolation for threads; harmless elsewhere.
  if (file.includes('/godot-')) Object.assign(headers, { 'cross-origin-opener-policy': 'same-origin', 'cross-origin-embedder-policy': 'require-corp' });
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}
