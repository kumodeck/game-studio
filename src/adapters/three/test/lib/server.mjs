// Static server for the headless tests: serves oss/game-studio/, injects the editor scripts into example pages
// (what the local studio server does for real), and keeps saved placement.json files in memory.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.glb': 'model/gltf-binary' };
const BOOT = '<script src="/src/adapters/three/boot.js"></script>';
const HARNESS = '<script type="module" src="/src/adapters/three/dev/harness.js"></script>';

export async function startServer(root) {
  const saved = new Map(); // "/examples/<name>/placement.json" → body
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'PUT' && url.pathname.endsWith('/placement.json')) {
      let body = '';
      for await (const c of req) body += c;
      saved.set(url.pathname, body);
      res.writeHead(204).end();
      return;
    }
    if (url.pathname.endsWith('/placement.json')) {
      const b = saved.get(url.pathname);
      if (b == null) return void res.writeHead(404).end();
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(b);
      return;
    }
    const file = normalize(join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root + sep)) return void res.writeHead(403).end();
    try {
      let body = await readFile(file.endsWith(sep) ? join(file, 'index.html') : file);
      const ext = extname(file) || '.html';
      if (ext === '.html' && url.pathname.startsWith('/examples/')) {
        // boot.js must be the first script (before the import map and the game); the harness is a module, so it goes last
        body = Buffer.from(String(body).replace(/<head>/i, `<head>${BOOT}`).replace(/<\/body>/i, `${HARNESS}</body>`));
      }
      res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, saved, close: () => new Promise((r) => server.close(r)) };
}
