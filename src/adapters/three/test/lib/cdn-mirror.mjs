// Optional offline CDN: answer https://cdn.jsdelivr.net/npm/three@<ver>/<path> from local copies of three.js, so the
// headless tests run without network. The samples keep their real CDN URLs; only the test browser is redirected.
//
//   STUDIO_THREE_DIRS="0.186.1=/path/to/three-0.186.1,0.170.0=/path/to/three-0.170.0"
//
// Each path is an unpacked `three` npm package (has build/ and examples/). A missing *.min.js falls back to the
// unminified file of the same name. Without the variable the browser simply uses the network.
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function mirrorDirs() {
  const out = new Map();
  for (const part of (process.env.STUDIO_THREE_DIRS || '').split(',')) {
    const [ver, dir] = part.split('=');
    if (ver && dir) out.set(ver.trim(), dir.trim());
  }
  return out;
}

export async function enableMirror(page, dirs) {
  if (!dirs.size) return;
  await page.send('Fetch.enable', { patterns: [{ urlPattern: 'https://cdn.jsdelivr.net/*' }] });
  page.on('Fetch.requestPaused', async (p) => {
    const m = p.request.url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/three@([^/]+)\/(.+?)(\?.*)?$/);
    const dir = m && dirs.get(m[1]);
    let file = dir && join(dir, m[2]);
    if (file && !existsSync(file) && file.endsWith('.min.js')) file = file.replace(/\.min\.js$/, '.js');
    if (!file || !existsSync(file)) {
      await page.send('Fetch.continueRequest', { requestId: p.requestId }).catch(() => {});
      return;
    }
    let body = await readFile(file);
    // three.module.min.js imports ./three.core.min.js; when only unminified files exist, point it at those
    if (!dir.endsWith('min') && file.endsWith('.js')) body = Buffer.from(String(body).replace(/(['"])\.\/three\.core\.min\.js\1/g, (_, q) => (existsSync(join(dir, 'build', 'three.core.min.js')) ? `${q}./three.core.min.js${q}` : `${q}./three.core.js${q}`)));
    await page.send('Fetch.fulfillRequest', {
      requestId: p.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'content-type', value: 'text/javascript' }, { name: 'access-control-allow-origin', value: '*' }],
      body: body.toString('base64')
    }).catch(() => {});
  });
}
