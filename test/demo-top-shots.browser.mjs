// Pictures of the web demo's first page, the sample list (2026-10-19, the "use it on your own game → GitHub" line):
// PC 1280×800 (mouse) and a phone 390×844 (touch, 2×), light and dark, English and Japanese. On the phone
// the line sits under the two samples, so the page is also taken scrolled to its end. No assertions
// (test/web-demo.browser.mjs checks the line); the same steps every time, so a "before" and an "after" run can be laid
// side by side.
//
//   node test/demo-top-shots.browser.mjs --dir <built web demo> --shots <dir>
//
// Served like KUMODeck's test version (test/web-demo-host.mjs), so its "Test" bar is in the pictures too; each picture
// waits until the bar has shrunk to its chip (after 6 s), as a visitor sees it (same wait as demo-line-shots).
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const args = process.argv.slice(2);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const DIR = resolve(opt('--dir'));
const SHOTS = resolve(opt('--shots'));
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LAYOUTS = { pc: { width: 1280, height: 800 }, phone: { width: 390, height: 844, mobile: true } };

const host = await startHost({ dir: DIR });
const browser = await launch();
try {
  for (const [layout, size] of Object.entries(LAYOUTS)) {
    for (const theme of ['light', 'dark']) {
      for (const lang of ['en', 'ja']) {
        const page = await newPage(browser, size);
        await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
        const tag = `${layout}-${theme}-${lang}`;
        await page.goto(`${host.url}index.html?lang=${lang}`);
        await page.waitFor(`document.querySelectorAll('a.card img').length === 2 && [...document.querySelectorAll('a.card img')].every((i) => i.complete)`);
        await sleep(6800);
        writeFileSync(join(SHOTS, `${tag}-top.png`), await page.screenshot());
        if (layout === 'phone') {
          // The end of the page, where the line is (or, before it, where the footer is).
          await page.eval(`window.scrollTo(0, document.documentElement.scrollHeight)`);
          await sleep(400);
          writeFileSync(join(SHOTS, `${tag}-end.png`), await page.screenshot());
        }
        await page.close?.();
        console.log(`  shot ${tag}`);
      }
    }
  }
} finally {
  await browser.close();
  await host.close();
}
