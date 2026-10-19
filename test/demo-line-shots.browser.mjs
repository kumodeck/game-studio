// Pictures of the web demo's top line and bottom bar (2026-10-18): the sample list and the editor
// (Lantern Cove, nothing picked) at PC 1280×800 (mouse) and a phone 390×844 (touch, 2×), light and dark,
// English and Japanese. No assertions (test/web-demo.browser.mjs checks the demo); the same steps
// every time, so a "before" and an "after" run can be laid side by side.
//
//   node test/demo-line-shots.browser.mjs --dir <built web demo> --shots <dir>
//
// The site is served like KUMODeck's test version (test/web-demo-host.mjs), so its "Test" bar is in the
// pictures too; each picture waits until the bar has shrunk to its chip (after 6 s), as a visitor sees it.
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
const FRAME = `document.querySelector('iframe')`;

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
        await page.waitFor(`document.querySelectorAll('a.sample img').length === 2 && [...document.querySelectorAll('a.sample img')].every((i) => i.complete)`);
        await sleep(6800);
        writeFileSync(join(SHOTS, `${tag}-list.png`), await page.screenshot());
        await page.goto(`${host.url}studio/?game=lantern-cove&lang=${lang}`);
        await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${FRAME}?.contentWindow.__gameStudio?._debug`, 60000);
        await sleep(6800);
        writeFileSync(join(SHOTS, `${tag}-editor.png`), await page.screenshot());
        const words = await page.eval(`JSON.stringify({ top: document.querySelector('.demo-banner')?.textContent || '', bar: document.querySelector('[data-part=bar]')?.innerText || '' })`);
        console.log(`  ${tag}: ${words}`);
        await page.close?.();
      }
    }
  }
} finally {
  await browser.close();
  await host.close();
}
