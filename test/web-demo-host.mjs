// A static server that serves the built web demo the way KUMODeck's test
// version does, for test/web-demo.browser.mjs.
//
// WHY not python3 -m http.server any more (2026-10-16): the first demo passed
// there and then "saving does not work" on the hosted test version. The cause
// turned out to be the editor itself (Save's slot, see shell/main.ts), but the
// differences of the real host were all suspects and none was tested. They are
// copied here so each one is covered from now on:
// - every HTML page gets the "This is a test version." bar before </head>
//   (a fixed element on <html>, in a closed shadow root, pointer-events on,
//   shrinks to a "Test" chip after 6 s) — also inside the game's iframe;
// - the site sits under a sub path (`base`, default /kd/studio-demo/), so
//   nothing may assume it is at the root;
// - cache headers: HTML `no-cache` + weak ETag, other files
//   `public, max-age=0, must-revalidate` + ETag, and 304 for If-None-Match;
// - a folder without "/" is a 308 to the "/" form (query kept);
// - a missing file is a 404 HTML page (not JSON), e.g. the sample's placement.json;
// - a CSP like the host's, minus https: (so a CDN or an API call also fails here).
//
// startHost({ dir, base }) → { url, close() }.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; connect-src 'self' blob: data:; "
  + "img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; "
  + "worker-src 'self' blob:; frame-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'";

// The same kind of bar as the host's (not its exact code): what matters is a fixed,
// clickable element at the top of every page and frame, added at DOMContentLoaded.
export const TEST_BAR = `
<!-- test version bar (shown only on the test version) -->
<script>(function(){var K="test-version-bar";try{if(sessionStorage.getItem(K))return}catch(e){}function show(){var h=document.createElement("test-version-bar");var r=h.attachShadow({mode:"closed"});r.innerHTML="<style>:host{all:initial}div{position:fixed;top:6px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;gap:10px;align-items:center;padding:3px 6px 3px 12px;border-radius:999px;background:rgba(17,17,17,.82);color:#fff;font:12px/18px system-ui,sans-serif;white-space:nowrap;pointer-events:auto}div.min{top:4px;left:4px;transform:none;padding:0 7px;font-size:10px;line-height:16px;opacity:.8}div.min .full,div.min button,div:not(.min) .chip{display:none}button{all:unset;cursor:pointer;width:18px;text-align:center}</style><div role=status><span class=chip>Test</span><span class=full>This is a test version.</span><button type=button aria-label=Close>×</button></div>";var d=r.querySelector("div");setTimeout(function(){d.className="min"},6000);r.querySelector("button").onclick=function(e){e.stopPropagation();h.remove();try{sessionStorage.setItem(K,"1")}catch(e){}};document.documentElement.appendChild(h)}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",show);else show()})();</script>
`;

const NOT_FOUND = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><main>Not found</main></body></html>';

export function startHost({ dir, base = '/kd/studio-demo/' }) {
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const send = (status, headers, body) => {
      res.writeHead(status, { 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    if (!u.pathname.startsWith(base)) return send(404, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' }, NOT_FOUND);
    let rel = decodeURIComponent(u.pathname.slice(base.length));
    let file = normalize(join(dir, rel));
    if (!file.startsWith(normalize(dir))) return send(404, { 'content-type': TYPES['.html'] }, NOT_FOUND);
    let st = null;
    try {
      st = statSync(file);
    } catch {
      /* missing */
    }
    if (st?.isDirectory()) {
      if (rel && !rel.endsWith('/')) return send(308, { location: `${u.pathname}/${u.search}` }, '');
      file = join(file, 'index.html');
      try {
        st = statSync(file);
      } catch {
        st = null;
      }
    }
    if (!st) return send(404, { 'content-type': TYPES['.html'], 'cache-control': 'no-cache' }, NOT_FOUND);
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    let body = readFileSync(file);
    const html = type.startsWith('text/html');
    if (html) body = Buffer.from(body.toString('utf8').replace('</head>', `${TEST_BAR}</head>`));
    const hash = createHash('sha256').update(body).digest('hex');
    const etag = html ? `W/"${hash}"` : `"${hash}"`;
    const headers = { 'content-type': type, etag, 'cache-control': html ? 'no-cache' : 'public, max-age=0, must-revalidate' };
    if (req.headers['if-none-match'] === etag) return send(304, headers, '');
    send(200, headers, body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}${base}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}
