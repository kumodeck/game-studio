// The web demo (no AI behind it) on a phone 390×844, one object picked: does the list button still take a row of
// its own under the card? (A hands-on try of 2026-10-19, item 6: "the list button alone uses a whole row at the
// bottom of the phone screen — put it in the card's row or the top bar".) No assertions: prints the rows and saves a
// picture, so the same script shows the "before" and the "after".
//
//   node test/fb-safe-demo-phone.browser.mjs --shots <dir> [--tag before|after] [--from <another oss/game-studio>]
// --from: build the demo from another checkout (e.g. a worktree of the commit before the fix) for the "before".
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage } from './adapters-2d/cdp.mjs';
import { startHost } from './web-demo-host.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const SHOTS = resolve(opt('--shots') || join(tmpdir(), 'fb-safe-demo'));
mkdirSync(SHOTS, { recursive: true });
const TAG = opt('--tag') || 'now';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = mkdtempSync(join(tmpdir(), 'fb-safe-demo-'));
const DIR = join(tmp, 'site');
execFileSync(process.execPath, [join(resolve(opt('--from') || PKG), 'scripts/build-web-demo.mjs'), '--out', DIR], { stdio: 'ignore' });
const host = await startHost({ dir: DIR });
const browser = await launch();
// The rows at the bottom: each visible plate (card, list button bar) with its top and height.
const ROWS = `JSON.stringify([['card', '.card-slot > .card'], ['list button', '.dock .bar']].map(([n, s]) => {
  const e = document.querySelector(s); if (!e || !e.offsetParent) return null; const r = e.getBoundingClientRect();
  return n + '@' + Math.round(r.top) + '+' + Math.round(r.height) + ' x' + Math.round(r.left); }).filter(Boolean))`;
try {
  const page = await newPage(browser, { width: 390, height: 844, mobile: true });
  try {
    await page.goto(`${host.url}studio/?game=lantern-cove&lang=ja`);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!document.querySelector('iframe')?.contentWindow.__gameStudio?._debug`, 30000);
    await sleep(2000);
    const keys = await page.eval(`studioShell.items().map((i) => i.key)`);
    await page.eval(`studioShell.actions.select(${JSON.stringify(keys.includes('lighthouse') ? 'lighthouse' : keys[0])})`);
    await sleep(1200);
    writeFileSync(join(SHOTS, `demo-phone-390x844-${TAG}-picked.png`), await page.screenshot());
    console.log(`demo phone ${TAG}: ${await page.eval(ROWS)}`);
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
  await host.close();
  rmSync(tmp, { recursive: true, force: true });
}
