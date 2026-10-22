// The public docs on the demo site (docs/ and docs/ja/, 2026-10-22), in a headless browser, served the way KUMODeck's
// test version does (test/web-demo-host.mjs: the test chip in every page, a sub path, its CSP).
//
//   node test/docs-site.browser.mjs [--dir <built web demo>] [--shots <dir>] [--pages index,editing,…]
//
// Without --dir it builds the demo into a temporary folder first (scripts/build-web-demo.mjs).
// For each page, English and Japanese, at PC 1280×800 and a phone 390×844 (touch), light and dark:
//   - it loads with no error, no request that fails, every picture drawn (naturalWidth > 0)
//   - nothing wider than the screen (no sideways scroll), the brand clear of the test chip
//   - dark: the page's background is dark (the tokens follow prefers-color-scheme)
//   - phone: the page list starts folded and opens with a tap
// The front page: its "Docs" link opens docs/ (English) and docs/ja/ (?lang=ja).
// --shots: <lang>-<page>-<pc|phone>-<light|dark>.png, the top of each page (and editing's Save part, scrolled).
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const PAGES = (opt('--pages') || 'index,getting-started,editing,play,motion,levels,ui,make-with-ai,how-it-works,faq').split(',');
// The pictures: these pages at every size; the rest are checked without one (keeps the folder small).
const PICTURED = ['index', 'editing', 'play', 'how-it-works'];
let DIR = opt('--dir') ? resolve(opt('--dir')) : null;
if (!DIR) {
  DIR = mkdtempSync(join(tmpdir(), 'docs-site-demo-'));
  execFileSync(process.execPath, [join(PKG, 'scripts/build-web-demo.mjs'), '--out', DIR], { stdio: 'inherit' });
}
const host = await startHost({ dir: DIR });
const browser = await launch();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const SIZES = [
  { id: 'pc', width: 1280, height: 800 },
  { id: 'phone', width: 390, height: 844, mobile: true },
];

async function open(size, theme) {
  const page = await newPage(browser, { width: size.width, height: size.height, mobile: !!size.mobile });
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await page.send('Network.enable');
  page.failedRequests = [];
  browser.on((m) => {
    if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) page.failedRequests.push(`${m.params.response.status} ${m.params.response.url}`);
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) page.failedRequests.push(`failed ${m.params.errorText}`);
  });
  return page;
}

try {
  for (const lang of ['en', 'ja']) for (const size of SIZES) for (const theme of ['light', 'dark']) {
    const tag = `${lang} ${size.id} ${theme}`;
    console.log(tag);
    const page = await open(size, theme);
    try {
      for (const name of PAGES) {
        page.failedRequests.length = 0;
        const url = `${host.url}docs/${lang === 'ja' ? 'ja/' : ''}${name === 'index' ? '' : `${name}.html`}`;
        await page.goto(url);
        // Every picture: lazy ones too (scrolled into view one by one, as a reader would).
        await page.eval(`(async () => { for (const i of document.querySelectorAll('article img')) { i.loading = 'eager'; } window.scrollTo(0, 0); return true; })()`);
        await page.waitFor(`[...document.querySelectorAll('img')].every((i) => i.complete)`, 15000).catch(() => {});
        await sleep(300);
        const r = JSON.parse(await page.eval(`JSON.stringify({
          lang: document.documentElement.lang,
          h1: document.querySelector('article h1')?.textContent || '',
          wide: document.documentElement.scrollWidth - innerWidth,
          broken: [...document.querySelectorAll('img')].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')),
          bg: getComputedStyle(document.body).backgroundColor,
          brand: (() => { const b = document.querySelector('.brand').getBoundingClientRect(); return { top: b.top, left: b.left }; })(),
          folded: !!document.querySelector('.pages') && !document.querySelector('.pages').open,
        })`));
        const errors = page.logs.filter((l) => l.startsWith('exception') || l.startsWith('error'));
        check(r.lang === lang && r.h1, `${name}: “${r.h1}”`);
        check(!errors.length && !page.failedRequests.length, `${name}: no errors, nothing missing ${[...errors, ...page.failedRequests].join(' · ')}`);
        check(!r.broken.length, `${name}: every picture drawn ${r.broken.join(' ')}`);
        check(r.wide <= 0, `${name}: nothing wider than the screen (${r.wide})`);
        const [cr, cg, cb] = r.bg.match(/\d+/g).map(Number);
        check(theme === 'dark' ? cr + cg + cb < 120 : cr + cg + cb > 600, `${name}: ${theme} background (${r.bg})`);
        // The test chip: 4..20 px from the top, 4..~44 px from the left. The brand sits below it or right of it.
        check(r.brand.top >= 20 || r.brand.left >= 44, `${name}: the brand clears the test chip (${Math.round(r.brand.left)}, ${Math.round(r.brand.top)})`);
        if (size.mobile) check(r.folded, `${name}: phone: the page list starts folded`);
        page.logs.length = 0;
        if (SHOTS && PICTURED.includes(name)) {
          writeFileSync(join(SHOTS, `${lang}-${name}-${size.id}-${theme}.png`), await page.screenshot());
          if (name === 'editing') {
            await page.eval(`document.getElementById('${lang === 'ja' ? '保存' : 'save'}').scrollIntoView()`);
            await sleep(400);
            writeFileSync(join(SHOTS, `${lang}-${name}-save-${size.id}-${theme}.png`), await page.screenshot());
          }
        }
      }
      if (size.mobile) {
        // The page list opens with a tap and lists every page.
        const at = JSON.parse(await page.eval(`(() => { const s = document.querySelector('.pages summary').getBoundingClientRect(); return JSON.stringify([s.left + s.width / 2, s.top + s.height / 2]); })()`));
        await page.tap(at[0], at[1]);
        await sleep(300);
        const n = await page.eval(`document.querySelector('.pages').open ? [...document.querySelectorAll('.pages li a')].filter((a) => a.offsetParent).length : 0`);
        check(n === 10, `phone: a tap opens the page list (${n} pages)`);
        if (SHOTS && theme === 'light') writeFileSync(join(SHOTS, `${lang}-pages-open-phone-${theme}.png`), await page.screenshot());
      }
    } finally {
      await page.close();
    }
  }

  // The front page's one link to the docs, in both languages.
  for (const lang of ['en', 'ja']) {
    const page = await open(SIZES[0], 'light');
    await page.goto(`${host.url}${lang === 'ja' ? '?lang=ja' : ''}`);
    await page.waitFor(`document.getElementById('docs')?.textContent`);
    const link = JSON.parse(await page.eval(`JSON.stringify({ text: document.getElementById('docs').textContent, href: document.getElementById('docs').href })`));
    check(link.href === `${host.url}docs/${lang === 'ja' ? 'ja/' : ''}`, `front page (${lang}): “${link.text}” → ${link.href}`);
    await page.goto(link.href);
    check((await page.eval(`document.documentElement.lang`)) === lang, `front page (${lang}): the link opens the ${lang} docs`);
    // And back: the docs' "Game Studio" opens the front page.
    const home = await page.eval(`document.querySelector('.brand').href`);
    check(home === `${host.url}${lang === 'ja' ? '?lang=ja' : ''}`, `docs (${lang}): the brand goes back to the front page (${home})`);
    await page.close();
  }
} finally {
  await browser.close?.();
  await host.close?.();
}
assert.equal(failed, 0, `${failed} check(s) failed`);
console.log('docs site: ok');
