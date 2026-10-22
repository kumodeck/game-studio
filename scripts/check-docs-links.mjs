#!/usr/bin/env node
// Check every link and picture in built docs pages (2026-10-22, the docs site's brief: "no broken links").
//
//   node scripts/check-docs-links.mjs --dir <a built web demo>   # checks <dir>/docs/**, links out to the front page too
//
// For each page under docs/: every href / src that is not http(s) or mailto must be a file in the built folder (a
// folder means its index.html), and a #heading must be an id on that page. Prints the broken ones; exit 1 if any.
// test/docs-site.test.mjs runs the same check on a fresh build.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}
const ids = new Map();
const idsOf = (file) => {
  if (!ids.has(file)) ids.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  return ids.get(file);
};

/** The broken links of every HTML page under `root`/`under`: [{ page, link, why }]. Also the pages checked. */
export function checkLinks(root, under = 'docs') {
  const broken = [];
  const pages = walk(join(root, under)).filter((f) => f.endsWith('.html'));
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
      const link = m[1].replace(/&amp;/g, '&');
      if (/^(https?:|mailto:)/.test(link)) continue;
      const [path, hash] = link.split('#');
      let target = path ? resolve(dirname(page), decodeURI(path.split('?')[0])) : page;
      if (path && (path.endsWith('/') || path === '.' || path === './' || (existsSync(target) && statSync(target).isDirectory()))) target = join(target, 'index.html');
      const where = relative(root, page);
      if (!target.startsWith(resolve(root))) broken.push({ page: where, link, why: 'outside the site' });
      else if (!existsSync(target)) broken.push({ page: where, link, why: 'no such file' });
      else if (hash && target.endsWith('.html') && !idsOf(target).has(decodeURIComponent(hash))) broken.push({ page: where, link, why: 'no such heading' });
    }
  }
  return { pages: pages.length, broken };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--dir');
  if (i < 0 || !process.argv[i + 1]) {
    console.error('usage: node scripts/check-docs-links.mjs --dir <built web demo>');
    process.exit(2);
  }
  const { pages, broken } = checkLinks(resolve(process.argv[i + 1]));
  for (const b of broken) console.log(`✗ ${b.page}: ${b.link} (${b.why})`);
  console.log(`docs links: ${pages} pages, ${broken.length} broken`);
  process.exit(broken.length || !pages ? 1 : 0);
}
