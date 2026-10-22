#!/usr/bin/env node
// Build the public docs (docs/site/lang/) into static pages: English at <out>/, Japanese at <out>/ja/.
//
//   node scripts/build-docs.mjs --out <dir>      # the docs alone (to look at them; the links to the front page miss)
//   build-web-demo.mjs calls buildDocs(<demo>/docs) so the demo site has /docs/ and /docs/ja/ (decided 2026-10-22).
//
// WHY Markdown as the source: the same files read on GitHub (docs/site/lang/en/*.md) and on the demo site, and anyone can
// fix a page without knowing this script. Each page starts with front matter:
//   title        the page's title (h1 is the page's own first line)
//   nav          its name in the side list (short)
//   order        its place in the side list
//   written-for  the Game Studio version the page was checked against. When a feature changes, the page is fixed and
//                this goes up (the README's "change a feature, fix its docs page" line). The footer shows it.
// Pictures: docs/site/lang/<lang>/media/*.webp come from the screen tests (docs/site/shots.json says which photo of
// which test). Diagrams: docs/site/lang/<lang>/media/*.svg. A page links them as media/<name>, the same in every
// language, and they are copied next to the pages (docs/media/, docs/ja/media/).
// WHY lang/<id>/: every language in a folder of its own; the Japanese one (words, pictures of the Japanese screen) sits
// in a lang/ folder like the editor's other translations.
//
// Look: the demo's front page (src/hosts/browser/index.html): the same colors, type and light / dark rule.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from './docs-md.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SITE = join(ROOT, 'docs/site');
const LANG_DIR = (id) => join(SITE, 'lang', id);
/** The languages, English first ("English first, Japanese too", 2026-10-22). `dir` = where its pages go in the output. */
export const LANGS = [
  { id: 'en', dir: '', name: 'English' },
  { id: 'ja', dir: 'ja/', name: '日本語' },
];

/** The pages of one language, in the side list's order: [{ file, meta, md }]. */
export function readPages(lang) {
  const dir = LANG_DIR(lang);
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'README.md')
    .map((file) => {
      const md = readFileSync(join(dir, file), 'utf8');
      return { file, md, meta: render(md).meta };
    })
    .sort((a, b) => Number(a.meta.order) - Number(b.meta.order));
}

/** A page's output path inside the docs folder: en/editing.md → editing.html, ja/index.md → ja/index.html. */
const outPath = (lang, file) => `${LANGS.find((l) => l.id === lang).dir}${file.replace(/\.md$/, '.html')}`;

/** Width and height of a PNG, WebP or SVG (for <img width height>: no jump while pictures load). */
export function imageSize(file) {
  const b = readFileSync(file);
  if (file.endsWith('.svg')) {
    const m = /viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/.exec(b.toString('utf8'));
    return m ? { width: Math.round(+m[1]), height: Math.round(+m[2]) } : null;
  }
  if (b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (kind === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L') {
      const v = b.readUInt32LE(21);
      return { width: 1 + (v & 0x3fff), height: 1 + ((v >> 14) & 0x3fff) };
    }
  }
  return null;
}

/**
 * Write the docs into `out` (emptied first).
 * opts.version: the Game Studio version (the footer). opts.repo: the public repository (links to files outside the
 * docs and "Edit this page"); null leaves them as plain text. opts.home: true when the demo's front page is one folder
 * up (the header's "Game Studio" and the tab icon point there); false for a docs-only build.
 */
export function buildDocs(out, { version, repo = null, home = true } = {}) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'docs.css'), CSS);
  writeFileSync(join(out, 'docs.js'), JS);
  const pages = Object.fromEntries(LANGS.map((l) => [l.id, readPages(l.id)]));
  for (const lang of LANGS) {
    const list = pages[lang.id];
    mkdirSync(join(out, lang.dir), { recursive: true });
    cpSync(join(LANG_DIR(lang.id), 'media'), join(out, lang.dir, 'media'), { recursive: true, filter: (f) => !f.endsWith('README.md') });
    list.forEach((page, n) => {
      const here = outPath(lang.id, page.file);
      const up = (p) => posix.relative(posix.dirname(here) || '.', p) || './';
      // An address in the Markdown (relative to docs/site/lang/<lang>/) → the address in the built site.
      const link = (href) => {
        if (/^(https?:|mailto:|#)/.test(href)) return href;
        const [path, hash = ''] = href.split('#');
        const site = posix.normalize(posix.join(lang.id, path)); // relative to docs/site/lang/
        const tail = hash ? `#${hash}` : '';
        let m;
        if ((m = /^(en|ja)\/([\w-]+\.md)$/.exec(site))) return up(outPath(m[1], m[2])).replace(/(^|\/)index\.html$/, '$1') + tail || `./${tail}`;
        if ((m = /^(en|ja)\/(media\/.+)$/.exec(site))) return up(`${LANGS.find((l) => l.id === m[1]).dir}${m[2]}`) + tail;
        // A file outside the docs (CONTRACT.md, the README…): on GitHub.
        const pkgPath = posix.normalize(posix.join('docs/site/lang', site));
        if (pkgPath.startsWith('..')) throw new Error(`${lang.id}/${page.file}: ${href} is outside the package`);
        return repo ? `${repo}/blob/main/${pkgPath}${tail}` : `#${tail}`;
      };
      const image = (src) => {
        const file = join(LANG_DIR(lang.id), src);
        if (!existsSync(file)) throw new Error(`${lang.id}/${page.file}: no picture ${src}`);
        return { src, ...imageSize(file) };
      };
      const { meta, html, headings } = render(page.md, { link, image });
      for (const k of ['title', 'nav', 'order', 'written-for']) if (!meta[k]) throw new Error(`${lang.id}/${page.file}: no "${k}" in its front matter`);
      const other = LANGS.find((l) => l.id !== lang.id);
      const otherHas = pages[other.id].some((p) => p.file === page.file);
      writeFileSync(join(out, here), pageHtml({
        lang, other, here, up, meta, html, headings, list, n, version, repo, home,
        otherHref: otherHas ? up(outPath(other.id, page.file)).replace(/(^|\/)index\.html$/, '$1') || './' : null,
        source: `docs/site/lang/${lang.id}/${page.file}`,
      }));
    });
  }
  return { pages: LANGS.reduce((n, l) => n + pages[l.id].length, 0) };
}

const T = {
  en: { docs: 'Docs', pages: 'Pages', onThisPage: 'On this page', prev: 'Previous', next: 'Next', writtenFor: 'Written for Game Studio {v}.',
    edit: 'Edit this page on GitHub', home: 'Game Studio', copy: 'Copy', copied: 'Copied', skip: 'Skip to the page' },
  ja: { docs: '使い方', pages: 'ページ', onThisPage: 'このページ', prev: '前へ', next: '次へ', writtenFor: 'ゲームスタジオ {v} に合わせて書いています。',
    edit: 'GitHub でこのページを直す', home: 'ゲームスタジオ', copy: 'コピー', copied: 'コピーしました', skip: '本文へ' },
};

function pageHtml({ lang, other, up, meta, html, headings, list, n, version, repo, home, otherHref, source }) {
  const t = T[lang.id];
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const href = (p) => up(outPath(lang.id, p.file)).replace(/(^|\/)index\.html$/, '$1') || './';
  // The front page is one folder above the docs; the Japanese docs open it in Japanese.
  const rootUp = lang.dir ? '../../' : '../';
  const homeHref = `${rootUp}${lang.id === 'ja' ? '?lang=ja' : ''}`;
  const nav = list.map((p, i) => `<li><a href="${href(p)}"${i === n ? ' aria-current="page"' : ''}>${esc(p.meta.nav)}</a></li>`).join('');
  const toc = headings.filter((h) => h.level === 2);
  const prev = list[n - 1];
  const next = list[n + 1];
  const pager = `<nav class="pager">${prev ? `<a class="prev" href="${href(prev)}"><span>${t.prev}</span>${esc(prev.meta.nav)}</a>` : '<span></span>'}${
    next ? `<a class="next" href="${href(next)}"><span>${t.next}</span>${esc(next.meta.nav)}</a>` : ''}</nav>`;
  const icons = home
    ? `  <link rel="icon" href="${rootUp}favicon.ico" sizes="32x32" />\n  <link rel="icon" href="${rootUp}favicon.svg" type="image/svg+xml" />\n  <link rel="apple-touch-icon" href="${rootUp}apple-touch-icon.png" />\n`
    : '';
  const asset = (f) => up(f);
  return `<!doctype html>
<html lang="${lang.id}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(meta.title)} · ${t.home} ${t.docs}</title>
  <meta name="description" content="${esc(meta.description || meta.title)}" />
${icons}  <link rel="stylesheet" href="${asset('docs.css')}" />
  <!-- Built from ${source} by scripts/build-docs.mjs (Game Studio ${version}). Edit the Markdown, not this file. -->
</head>
<body data-copy="${esc(t.copy)}" data-copied="${esc(t.copied)}">
  <a class="skip" href="#main">${t.skip}</a>
  <header class="top">
    <div class="bar">
      <a class="brand" href="${home ? homeHref : href(list[0])}">${home ? `<img src="${rootUp}favicon.svg" alt="" width="22" height="22" />` : ''}<span>${t.home}</span></a>
      <span class="sep" aria-hidden="true">/</span>
      <a class="section" href="${href(list[0])}">${t.docs}</a>
      <span class="grow"></span>
      ${otherHref ? `<a class="lang" href="${otherHref}" hreflang="${other.id}" lang="${other.id}">${other.name}</a>` : ''}
      ${repo ? `<a class="gh" href="${esc(repo)}" target="_blank" rel="noopener">GitHub</a>` : ''}
    </div>
  </header>
  <div class="layout">
    <nav class="side" aria-label="${t.pages}">
      <details class="pages" open>
        <summary>${t.pages}<span class="here">${esc(list[n].meta.nav)}</span></summary>
        <ol>${nav}</ol>
      </details>
    </nav>
    <main id="main">
      <article>
${html}
      </article>
      ${pager}
      <footer class="foot">
        <span>${t.writtenFor.replace('{v}', esc(meta['written-for']))}</span>
        ${repo ? `<a href="${esc(repo)}/blob/main/${source}" target="_blank" rel="noopener">${t.edit}</a>` : ''}
        <span>KUMODeck · <a href="mailto:support@kumodeck.com">support@kumodeck.com</a></span>
      </footer>
    </main>
    ${toc.length > 1 ? `<aside class="toc" aria-label="${t.onThisPage}"><p>${t.onThisPage}</p><ol>${toc.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join('')}</ol></aside>` : '<aside class="toc"></aside>'}
  </div>
  <script src="${asset('docs.js')}"></script>
</body>
</html>
`;
}

// The look: the demo's front page (src/hosts/browser/index.html) — its tokens, type, radius and light / dark rule.
// Three columns on a wide screen (pages · the page · on this page), two on a laptop, one on a phone (the page list
// folds into one row at the top).
const CSS = `/* KUMODeck Game Studio docs — built by scripts/build-docs.mjs */
:root {
  --bg: #fbfbfa; --card: #fff; --sunk: #f3f2ef; --text: #18181b; --text-2: #6b6b70; --line: rgba(0,0,0,.08);
  --accent: #ff6a2b; --link: #c4470f; --shadow: 0 1px 2px rgba(0,0,0,.04), 0 12px 40px rgba(0,0,0,.08); color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111113; --card: #1a1a1c; --sunk: #19191b; --text: #f2f2f3; --text-2: #9d9da3; --line: rgba(255,255,255,.09);
    --link: #ff8a55; --shadow: 0 1px 2px rgba(0,0,0,.3), 0 12px 40px rgba(0,0,0,.45); }
}
* { box-sizing: border-box; }
html { scroll-padding-top: 76px; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.65 system-ui, -apple-system, "Segoe UI", "Hiragino Sans", sans-serif; -webkit-text-size-adjust: 100%; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
.skip { position: absolute; left: -999px; top: 8px; }
.skip:focus { left: 16px; z-index: 10; background: var(--card); padding: 6px 12px; border-radius: 8px; }

header.top { position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: saturate(1.4) blur(12px); -webkit-backdrop-filter: saturate(1.4) blur(12px); border-bottom: 1px solid var(--line); }
/* 60 px with 6 px on top: the brand clears the "Test" chip KUMODeck's test version keeps at the top-left (4 px in, 16 px
   high), as the front page's header does. */
.bar { max-width: 1240px; margin: 0 auto; padding: 6px 24px 0; height: 60px; display: flex; align-items: center; gap: 10px; font-size: 14px; }
.brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); font-weight: 600; letter-spacing: -.01em; }
.brand img { width: 22px; height: 22px; display: block; }
.sep { color: var(--text-2); opacity: .6; }
.section { color: var(--text); font-weight: 500; }
.grow { flex: 1; }
.lang, .gh { color: var(--text-2); }
.lang:hover, .gh:hover { color: var(--text); text-decoration: none; }
.gh { margin-left: 14px; }

.layout { max-width: 1240px; margin: 0 auto; padding: 0 24px; display: grid; grid-template-columns: 200px minmax(0, 720px) 200px; gap: 48px; justify-content: space-between; }
.side, .toc { position: sticky; top: 60px; align-self: start; max-height: calc(100vh - 60px); overflow: auto; padding: 32px 0; font-size: 14px; }
.pages summary { list-style: none; display: none; }
.pages summary::-webkit-details-marker { display: none; }
.pages ol, .toc ol { list-style: none; margin: 0; padding: 0; }
.pages li a { display: block; padding: 6px 12px; margin-left: -12px; border-radius: 8px; color: var(--text-2); }
.pages li a:hover { color: var(--text); background: var(--sunk); text-decoration: none; }
.pages li a[aria-current] { color: var(--text); background: var(--sunk); font-weight: 600; }
.toc p { margin: 0 0 8px; font-size: 12px; font-weight: 600; color: var(--text-2); letter-spacing: .02em; }
.toc li a { display: block; padding: 4px 0; color: var(--text-2); line-height: 1.4; }
.toc li a:hover { color: var(--text); text-decoration: none; }

main { padding: 40px 0 0; min-width: 0; }
article { font-size: 16px; }
article h1 { font-size: 40px; line-height: 1.1; letter-spacing: -.025em; font-weight: 650; margin: 0 0 16px; text-wrap: balance; }
article h1 + p { font-size: 18px; color: var(--text-2); margin-top: 0; text-wrap: pretty; }
article h2 { font-size: 24px; letter-spacing: -.01em; font-weight: 600; margin: 56px 0 12px; padding-top: 24px; border-top: 1px solid var(--line); line-height: 1.25; }
article h3 { font-size: 17px; font-weight: 600; margin: 32px 0 8px; line-height: 1.35; }
article h4 { font-size: 15px; font-weight: 600; margin: 24px 0 4px; }
article h2, article h3 { position: relative; }
.anchor { position: absolute; left: -22px; color: var(--text-2); opacity: 0; font-weight: 400; padding-right: 6px; }
h2:hover .anchor, h3:hover .anchor, .anchor:focus { opacity: .7; text-decoration: none; }
article p, article li { text-wrap: pretty; }
article ul, article ol { padding-left: 22px; }
article li { margin: 4px 0; }
article li::marker { color: var(--text-2); }
article strong { font-weight: 600; }
code { font: .88em/1.5 ui-monospace, "SF Mono", Menlo, monospace; background: var(--sunk); border: 1px solid var(--line); border-radius: 6px; padding: 1px 5px; overflow-wrap: anywhere; }
kbd { display: inline-block; min-width: 1.6em; text-align: center; font: 600 .82em/1.5 system-ui, sans-serif; padding: 0 6px; border-radius: 6px; background: var(--card); border: 1px solid var(--line); box-shadow: 0 1px 0 var(--line); white-space: nowrap; }
.code { position: relative; margin: 16px 0; }
.code pre { margin: 0; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); overflow-x: auto; }
.code pre code { background: none; border: 0; padding: 0; font-size: 13px; white-space: pre; overflow-wrap: normal; }
.code button { position: absolute; top: 8px; right: 8px; border: 1px solid var(--line); background: var(--sunk); color: var(--text); font: 600 12px system-ui, sans-serif; padding: 4px 10px; border-radius: 8px; cursor: pointer; }
.code button.done { color: var(--accent); }
figure { margin: 24px 0; }
figure img { display: block; width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--line); box-shadow: var(--shadow); background: var(--sunk); }
figure img[src$=".svg"] { box-shadow: none; background: var(--card); }
figcaption { margin-top: 10px; font-size: 13px; color: var(--text-2); text-align: center; text-wrap: balance; }
blockquote { margin: 20px 0; padding: 12px 16px; border-radius: 12px; background: var(--sunk); border: 1px solid var(--line); font-size: 15px; }
blockquote p { margin: 4px 0; }
.table { overflow-x: auto; margin: 16px 0; border: 1px solid var(--line); border-radius: 12px; }
table { border-collapse: collapse; width: 100%; font-size: 14px; }
th, td { text-align: left; vertical-align: top; padding: 9px 14px; border-bottom: 1px solid var(--line); }
th { font-weight: 600; background: var(--sunk); }
tr:last-child td { border-bottom: 0; }

.pager { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 64px 0 0; }
.pager a { display: block; padding: 14px 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); color: var(--text); font-weight: 600; }
.pager a:hover { border-color: color-mix(in srgb, var(--accent) 55%, transparent); text-decoration: none; }
.pager a span { display: block; font-size: 12px; font-weight: 500; color: var(--text-2); }
.pager .next { text-align: right; grid-column: 2; }
.foot { display: flex; flex-wrap: wrap; gap: 8px 24px; justify-content: space-between; margin-top: 40px; padding: 24px 0 48px; border-top: 1px solid var(--line); font-size: 13px; color: var(--text-2); }
.foot a { color: var(--text-2); }
.foot a:hover { color: var(--text); }

/* A laptop: no "On this page" column. */
@media (max-width: 1180px) {
  .layout { grid-template-columns: 190px minmax(0, 1fr); gap: 40px; }
  .toc { display: none; }
}
/* A phone (the front page's line, 768): one column; the page list folds into one row under the bar. */
@media (max-width: 767.98px) {
  html { scroll-padding-top: 116px; }
  .bar { padding: 6px 16px 0; gap: 8px; }
  .gh { margin-left: 6px; }
  .layout { display: block; padding: 0 16px; }
  .side { position: sticky; top: 60px; z-index: 4; padding: 0; max-height: none; overflow: visible; margin: 0 -16px; background: var(--bg); border-bottom: 1px solid var(--line); }
  .pages summary { display: flex; gap: 8px; align-items: center; padding: 12px 16px; font-weight: 600; cursor: pointer; }
  .pages summary::after { content: ""; margin-left: auto; width: 8px; height: 8px; border-right: 2px solid var(--text-2); border-bottom: 2px solid var(--text-2); transform: rotate(45deg) translateY(-3px); }
  .pages[open] summary::after { transform: rotate(-135deg) translateY(-1px); }
  .pages .here { font-weight: 400; color: var(--text-2); }
  .pages .here::before { content: "·"; margin-right: 8px; }
  .pages ol { padding: 0 16px 12px; }
  .pages li a { margin-left: 0; padding: 10px 12px; }
  main { padding-top: 24px; }
  article h1 { font-size: 30px; }
  article h1 + p { font-size: 17px; }
  article h2 { font-size: 21px; margin-top: 44px; }
  .anchor { display: none; }
  figure { margin: 20px 0; }
  figure img { border-radius: 10px; }
  .pager { grid-template-columns: 1fr; }
  .pager .next { grid-column: 1; }
}
@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
`;

// The page's only script: a Copy button on each code block, and the phone's page list starting folded.
const JS = `/* KUMODeck Game Studio docs — built by scripts/build-docs.mjs */
(function () {
  var b = document.body;
  document.querySelectorAll('.code').forEach(function (box) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.dataset.copy;
    btn.addEventListener('click', function () {
      var text = box.querySelector('code').textContent;
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(text).then(function () {
        btn.textContent = b.dataset.copied; btn.classList.add('done');
        setTimeout(function () { btn.textContent = b.dataset.copy; btn.classList.remove('done'); }, 1800);
      });
    });
    box.append(btn);
  });
  // The page list is open in the HTML (so it reads without this script); a phone starts with it folded.
  var pages = document.querySelector('.pages');
  if (pages && matchMedia('(max-width: 767.98px)').matches) pages.open = false;
  if (pages) pages.addEventListener('click', function (e) { if (e.target.closest('a') && matchMedia('(max-width: 767.98px)').matches) pages.open = false; });
})();
`;

// ---- the command line: a docs-only build to look at ----
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  if (i < 0 || !process.argv[i + 1]) {
    console.error('usage: node scripts/build-docs.mjs --out <dir>');
    process.exit(2);
  }
  const out = resolve(process.argv[i + 1]);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const repo = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).repository || null;
  const { pages } = buildDocs(out, { version: pkg.version, repo, home: false });
  console.log(`docs: ${out} (${pages} pages)\n  ${relative(process.cwd(), join(out, 'index.html'))}`);
}
