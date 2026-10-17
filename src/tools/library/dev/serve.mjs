// TEST DOUBLE for the dev harness only — a tiny stand-in for the local server
// (src/server), so the library tool can be tried and checked headless before
// the real server lands. It follows the local HTTP API of CONTRACT.md §3.2
// for the routes the library uses, with the same file rules (inside the
// folder only, add-only, extension and size limits), but no token and no
// Host check: it is for a developer's own machine and tests only.
//
//   node --experimental-strip-types serve.mjs <game-dir> [--port 0] [--schema <studio-files.mjs>]
//
// Prints "listening http://127.0.0.1:<port>/__studio/harness" when ready.
// `--schema` points at the shared validator module (validateStudioFile); by
// default src/schema/index.ts is used.
import { createServer } from 'node:http';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import { bundle } from '../../../../scripts/bundle.mjs';
import { buildAssetList } from '../refs.ts';
import { ASSET_EXT, IGNORED_DIRS, LIMITS } from '../../../contract.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const GAME = realpathSync(resolve(args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) || '.'));
const PORT = Number(opt('--port', '0'));
const SCHEMA = opt('--schema', null);

// The one validator, wrapped to the contract's validateLibrary() shape.
let validateLibrary;
let stringify;
if (SCHEMA) {
  const m = await import(pathToFileURL(resolve(SCHEMA)).href);
  validateLibrary = (j) => {
    const r = m.validateStudioFile(j, { tool: 'library' });
    return r.ok ? { ok: true, value: r.value, json: r.json } : { ok: false, errors: r.errors };
  };
  stringify = (v, r) => r.json ?? JSON.stringify(v, null, 2) + '\n';
} else {
  const m = await import(pathToFileURL(join(SRC, 'schema/index.ts')).href);
  validateLibrary = m.validateLibrary;
  stringify = (v) => m.stringifyResult(v);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.avif': 'image/avif', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf',
};

/** Resolve a URL path inside `root`; null if it leaves the folder (.., symlinks out). */
function inside(root, urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const abs = resolve(root, '.' + (p.startsWith('/') ? p : '/' + p));
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  if (!existsSync(abs)) return abs;
  const real = realpathSync(abs);
  return real === root || real.startsWith(root + sep) ? real : null;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (!IGNORED_DIRS.includes(name)) walk(abs, out);
    } else out.push({ path: relative(GAME, abs).split(sep).join('/'), size: st.size });
  }
  return out;
}

let standIn = null;
function standInScript() {
  standIn ??= bundle(join(HERE, 'stand-in.ts'), { format: 'iife', banner: '/* library harness stand-in (test double) */' }).code;
  return standIn;
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, max) {
  return new Promise((ok, fail) => {
    const parts = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > max) {
        fail(Object.assign(new Error('too big'), { status: 413 }));
        req.destroy();
      } else parts.push(c);
    });
    req.on('end', () => ok(Buffer.concat(parts)));
    req.on('error', fail);
  });
}

const ADD_EXT = Object.values(ASSET_EXT).flat();
function safeName(name) {
  const base = String(name).split(/[\\/]/).pop() || 'file';
  const ext = extname(base).slice(1).toLowerCase();
  const stem = base.slice(0, base.length - ext.length - (ext ? 1 : 0)).normalize('NFKC').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'file';
  return { stem, ext };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname;
  try {
    if (path === '/__studio/harness') return send(res, 200, readFileSync(join(HERE, 'harness.html')), MIME['.html']);
    if (path.startsWith('/__lib/')) {
      const file = inside(SRC, path.slice('/__lib'.length));
      if (!file || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, { error: 'not found' });
      let code = readFileSync(file, 'utf8');
      if (file.endsWith('.ts')) code = stripTypeScriptTypes(code, { mode: 'strip' });
      if (SCHEMA && file === join(SRC, 'schema/index.ts')) {
        // Swap the placeholder for the shared validator (same wrapper as above).
        code = `import { validateStudioFile } from '/__schema/real.mjs';
export function validateLibrary(j) { const r = validateStudioFile(j, { tool: 'library' }); return r.ok ? { ok: true, value: r.value } : { ok: false, errors: r.errors }; }
export function validatePlacement(j) { const r = validateStudioFile(j, { tool: 'placement' }); return r.ok ? { ok: true, value: r.value } : { ok: false, errors: r.errors }; }`;
      }
      return send(res, 200, code, MIME[extname(file)] || 'text/plain');
    }
    if (path === '/__schema/real.mjs' && SCHEMA) return send(res, 200, readFileSync(resolve(SCHEMA)), MIME['.mjs']);

    if (path === '/__studio/api/open') {
      const origin = `http://${req.headers.host}`;
      return send(res, 200, { gameUrl: `${origin}/index.html?studio=edit`, origin });
    }
    const resultM = path.match(/^\/__studio\/api\/result\/(library|placement)$/);
    if (resultM) {
      const file = join(GAME, `${resultM[1]}.json`);
      if (req.method === 'GET') return existsSync(file) ? send(res, 200, readFileSync(file)) : send(res, 204, '');
      if (req.method === 'PUT' && resultM[1] === 'library') {
        const raw = await readBody(req, LIMITS.maxResultBytes);
        let j;
        try {
          j = JSON.parse(raw.toString('utf8'));
        } catch {
          return send(res, 400, { ok: false, error: 'not JSON' });
        }
        const v = validateLibrary(j);
        if (!v.ok) return send(res, 400, { ok: false, error: v.errors.join('; ') });
        writeFileSync(file, stringify(v.value, v));
        console.log('studio: saved library.json');
        return send(res, 200, { ok: true });
      }
      return send(res, 405, { error: 'method' });
    }
    if (path === '/__studio/api/assets' && req.method === 'GET') {
      return send(res, 200, await buildAssetList(walk(GAME), async (p) => readFileSync(join(GAME, p), 'utf8')));
    }
    if (path === '/__studio/api/assets' && req.method === 'POST') {
      const { stem, ext } = safeName(url.searchParams.get('name') || '');
      if (!ADD_EXT.includes(ext)) return send(res, 415, { error: 'this file type cannot be added' });
      const body = await readBody(req, LIMITS.maxAssetBytes);
      mkdirSync(join(GAME, 'assets'), { recursive: true });
      for (let i = 1; i < 1000; i++) {
        const rel = `assets/${stem}${i > 1 ? `-${i}` : ''}.${ext}`;
        try {
          writeFileSync(join(GAME, rel), body, { flag: 'wx' }); // never overwrite
          return send(res, 201, { path: rel });
        } catch (e) {
          if (e.code !== 'EEXIST') throw e;
        }
      }
      return send(res, 409, { error: 'no free name' });
    }
    if (path.startsWith('/__studio/')) return send(res, 404, { error: 'not found' });

    // Game files. HTML gets the stand-in as the first script of <head>.
    const file = inside(GAME, path.endsWith('/') ? path + 'index.html' : path);
    if (!file || !existsSync(file) || !statSync(file).isFile()) return send(res, 404, 'not found', 'text/plain');
    const ext = extname(file).toLowerCase();
    if (ext === '.html') {
      const html = readFileSync(file, 'utf8');
      const tag = `<script>${standInScript().replace(/<\/script/gi, '<\\/script')}</script>`;
      const out = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
      return send(res, 200, out, MIME['.html']);
    }
    return send(res, 200, readFileSync(file), MIME[ext] || 'application/octet-stream');
  } catch (e) {
    return send(res, e.status || 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`listening http://127.0.0.1:${server.address().port}/__studio/harness`);
});
