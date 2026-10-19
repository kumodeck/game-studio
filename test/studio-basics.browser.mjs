// The basic actions with BOTH a button and a shortcut (basics pass, 2026-10-18 — from a try of the editor: "basic actions: undo,
// redo… keyboard shortcuts are needed, and buttons too"). With the real server and the built editor:
//
// PC 1280×800 (mouse), Lantern Cove (3D) and Firefly Ruins (2D):
//   1. Undo / Redo are in the top bar from the start, dimmed (disabled), and stay at the same place all along
//   2. a step with an arrow key → Undo is on; its tooltip (hover) says "Undo: move <name>" and "⌘Z"
//   3. the Undo button / Redo button, then ⌘Z, ⇧⌘Z, ⌘Z, ⌘Y: the pose goes back and forth exactly
//   4. Delete (Backspace) → gone; the Undo button → back; ⌘Y → gone; ⌘Z → back
//   5. ⌘D → a copy; the Undo button → gone; the Redo button → back; ⌘Z
//   6. ⌘C, ⌘V → a copy of what was copied; ⌘Z
//   7. ⌘A → everything selected; Esc → nothing; 3 → the Turn tool in the game's strip (1 → Move)
//   8. typing in the ask field: ⌘A, ⌘C, ⌘V, ⌘D, ⌘Z, Backspace, Delete do nothing to the scene (no copy, nothing
//      deleted, the undo history untouched, the selection kept)
//   9. ? → the shortcut sheet (Undo ⌘Z listed); Esc closes it; ⌘K → "Keyboard shortcuts" opens it too
//  10. the view did not move on any of it (wave 1: the camera stays still)
// Phone 390×844 (touch), Lantern Cove: Undo / Redo always in the top bar, 44 × 44 or more; the card's Delete and
// Duplicate, undone and redone with the bar's buttons.
//
//   node test/studio-basics.browser.mjs [--shots <dir>] [--only pc|phone] [--game lantern-cove|firefly-ruins] [--dark]
// --shots <dir> also writes photos there (light, and dark with --dark).
// Exit 1 on failure.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const SHOTS = opt('--shots') ? resolve(opt('--shots')) : null;
const DARK = args.includes('--dark');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const GAMES = [
  { id: 'lantern-cove', pick: 'lighthouse', name: 'Lighthouse' },
  { id: 'firefly-ruins', pick: 'urn', name: 'urn' },
].filter((g) => !opt('--game') || g.id === opt('--game'));
const SIZES = [
  { id: 'pc', w: 1280, h: 800, touch: false },
  { id: 'phone', w: 390, h: 844, touch: true },
].filter((s) => !opt('--only') || s.id === opt('--only'));

const WIN = `document.querySelector('iframe').contentWindow`;
const DBG = `${WIN}.__gameStudio._debug`;
// The headless browser runs on this machine: ⌘ on a Mac, Ctrl elsewhere (the editor reads navigator.platform).
const MAC = process.platform === 'darwin';
const MOD = MAC ? 4 : 2;
const CODES = { Escape: ['Escape', 27], Backspace: ['Backspace', 8], Delete: ['Delete', 46], ArrowRight: ['ArrowRight', 39], '?': ['Slash', 191] };
/** One key press (down + up) with modifiers (1 Alt, 2 Ctrl, 4 Meta, 8 Shift). */
const key = async (page, k, modifiers = 0) => {
  const [code, vk] = CODES[k] || [/^\d$/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`, k.toUpperCase().charCodeAt(0)];
  const base = { key: k, code, windowsVirtualKeyCode: vk, modifiers };
  await page.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  if (k.length === 1 && !(modifiers & (2 | 4))) await page.send('Input.dispatchKeyEvent', { type: 'char', ...base, text: k });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(120);
};

let failed = 0;
let browser = null, srv = null, root = null;
const fresh = async (g) => {
  await browser?.close();
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
  root = mkdtempSync(join(tmpdir(), 'studio-basics-'));
  cpSync(join(PKG, 'starters', g.id), root, { recursive: true });
  srv = await startStudioServer({ root, uiDir: join(PKG, 'skills/arrange/bin/studio-ui'), log: () => {} });
  browser = await launch();
};

try {
  for (const g of GAMES) {
    for (const sz of SIZES) {
      if (sz.touch && g.id !== 'lantern-cove') continue;
      const tag = `${g.id}-${sz.id}${DARK ? '-dark' : ''}`;
      await fresh(g);
      const page = await newPage(browser, { width: sz.w, height: sz.h, mobile: sz.touch });
      if (DARK) await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
      const shot = async (name) => SHOTS && writeFileSync(join(SHOTS, `${sz.id}-${g.id === 'lantern-cove' ? '3d' : '2d'}-${name}${DARK ? '-dark' : ''}.png`), await page.screenshot());
      const ev = (e) => page.eval(e);
      const keys = async () => JSON.parse(await ev(`JSON.stringify(${DBG}.list().map((i) => i.key))`));
      const pose = async (k) => ev(`JSON.stringify(${DBG}.list().find((i) => i.key === ${JSON.stringify(k)})?.pose ?? null)`);
      const selected = () => ev('studioShell.selected()');
      const view = () => ev(`JSON.stringify(${DBG}.view())`);
      const btn = (a) => ev(`(() => { const b = [...document.querySelectorAll('.top [data-action=${a}]')].find((e) => e.offsetParent); if (!b) return null;
        const r = b.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, left: r.left, disabled: b.disabled }); })()`).then((s) => JSON.parse(s || 'null'));
      const press = async (sel) => {
        const at = JSON.parse(await ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.offsetParent && !e.disabled); if (!b) return null;
          b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return JSON.stringify([r.left + r.width / 2, r.top + r.height / 2]); })()`) || 'null');
        assert.ok(at, `${tag}: ${sel} is on screen and enabled`);
        if (sz.touch) await page.tap(at[0], at[1]);
        else await page.click(at[0], at[1]);
        await sleep(350);
      };
      const until = (expr, what, ms = 4000) => page.waitFor(expr, ms).catch(() => { throw new Error(`${tag}: ${what}`); });
      try {
        await page.goto(srv.url);
        await page.waitFor(`document.querySelectorAll('.obj').length > 0 && !!${WIN}.__gameStudio?._debug`, 30000);
        await sleep(1200);
        // 1. Undo / Redo from the start, dimmed.
        const u0 = await btn('undo'), r0 = await btn('redo');
        assert.ok(u0 && r0, `${tag}: Undo and Redo are in the top bar from the start`);
        assert.ok(u0.disabled && r0.disabled, `${tag}: both dimmed while there is nothing to undo`);
        if (sz.touch) assert.ok(u0.w >= 44 && u0.h >= 44 && r0.w >= 44 && r0.h >= 44, `${tag}: 44 × 44 on the phone (${u0.w}×${u0.h})`);
        const v0 = await view();
        const n0 = (await keys()).length;
        if (!sz.touch) {
          await shot('1-open');
          // Pick from the list (a real click on the row).
          await ev(`document.querySelector('.obj[data-key=${JSON.stringify(g.pick)}]')?.scrollIntoView({ block: 'center' })`);
          const row = JSON.parse(await ev(`(() => { const r = document.querySelector('.obj[data-key=${JSON.stringify(g.pick)}]').getBoundingClientRect(); return JSON.stringify([r.left + 60, r.top + r.height / 2]); })()`));
          await page.click(row[0], row[1]);
          await until(`studioShell.selected() === ${JSON.stringify(g.pick)}`, `a click on the row selects ${g.pick}`);
          await sleep(300);
          // 2. A step with an arrow key, then the tooltip of Undo.
          const p0 = await pose(g.pick);
          await key(page, 'ArrowRight');
          await until(`!document.querySelector('.top [data-action=undo]').disabled`, 'an arrow step makes Undo pressable');
          const p1 = await pose(g.pick);
          assert.notEqual(p1, p0, `${tag}: the arrow key moved ${g.pick}`);
          const u1 = await btn('undo');
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: u1.x - 30, y: u1.y + 200 });
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: u1.x, y: u1.y });
          await until(`(() => { const t = document.querySelector('.tip'); return t && !t.hidden; })()`, 'hovering Undo shows its tooltip', 2000);
          const tip = JSON.parse(await ev(`JSON.stringify({ text: document.querySelector('.tip > span').textContent, kbd: document.querySelector('.tip kbd').textContent })`));
          assert.match(tip.text, /^Undo: move /, `${tag}: the tooltip names what Undo changes (${tip.text})`);
          assert.equal(tip.kbd, MAC ? '⌘Z' : 'Ctrl+Z', `${tag}: and its key`);
          await shot('2-undo-tooltip');
          // The title is lent to the tip while hovered, so the browser's own bubble never shows too.
          assert.equal(await ev(`document.querySelector('.top [data-action=undo]').hasAttribute('title')`), false, `${tag}: no second (browser) tooltip`);
          // 3. Buttons, then keys.
          await press('.top [data-action=undo]');
          assert.equal(await pose(g.pick), p0, `${tag}: the Undo button puts it back`);
          assert.equal((await btn('redo')).disabled, false, `${tag}: Redo is pressable after Undo`);
          await press('.top [data-action=redo]');
          assert.equal(await pose(g.pick), p1, `${tag}: the Redo button moves it again`);
          await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 780 });
          await key(page, 'z', MOD);
          assert.equal(await pose(g.pick), p0, `${tag}: ⌘Z`);
          await key(page, 'z', MOD | 8);
          assert.equal(await pose(g.pick), p1, `${tag}: ⇧⌘Z`);
          await key(page, 'z', MOD);
          await key(page, 'y', MOD);
          assert.equal(await pose(g.pick), p1, `${tag}: ⌘Y redoes too`);
          await key(page, 'z', MOD);
          assert.equal(await pose(g.pick), p0, `${tag}: back where it was`);
          // 4. Delete.
          if ((await selected()) !== g.pick) await ev(`studioShell.actions.select(${JSON.stringify(g.pick)})`);
          await key(page, 'Backspace');
          await until(`!${DBG}.list().some((i) => i.key === ${JSON.stringify(g.pick)})`, 'Backspace deletes the selection');
          await press('.top [data-action=undo]');
          await until(`${DBG}.list().some((i) => i.key === ${JSON.stringify(g.pick)})`, 'the Undo button brings it back');
          await key(page, 'y', MOD);
          await until(`!${DBG}.list().some((i) => i.key === ${JSON.stringify(g.pick)})`, '⌘Y deletes it again');
          await key(page, 'z', MOD);
          await until(`${DBG}.list().some((i) => i.key === ${JSON.stringify(g.pick)})`, '⌘Z brings it back again');
          // 5. Duplicate.
          await ev(`studioShell.actions.select(${JSON.stringify(g.pick)})`);
          await sleep(300);
          await key(page, 'd', MOD);
          await until(`${DBG}.list().length === ${n0 + 1}`, '⌘D duplicates');
          await press('.top [data-action=undo]');
          await until(`${DBG}.list().length === ${n0}`, 'the Undo button takes the duplicate away');
          await press('.top [data-action=redo]');
          await until(`${DBG}.list().length === ${n0 + 1}`, 'the Redo button brings the duplicate back');
          await key(page, 'z', MOD);
          await until(`${DBG}.list().length === ${n0}`, '⌘Z takes it away');
          // 6. Copy, paste.
          await ev(`studioShell.actions.select(${JSON.stringify(g.pick)})`);
          await sleep(300);
          await key(page, 'c', MOD);
          await key(page, 'v', MOD);
          await until(`${DBG}.list().length === ${n0 + 1}`, '⌘C then ⌘V pastes a copy');
          await key(page, 'z', MOD);
          await until(`${DBG}.list().length === ${n0}`, '⌘Z takes the pasted copy away');
          // 7. Select all, Esc, tool keys.
          await key(page, 'a', MOD);
          await until(`document.querySelectorAll('li.obj[aria-selected=true]').length > 1`, '⌘A selects everything');
          await key(page, 'Escape');
          await until(`studioShell.selected() === null`, 'Esc drops the selection');
          await ev(`studioShell.actions.select(${JSON.stringify(g.pick)})`);
          await sleep(400);
          await key(page, '3');
          const pressed = (k) => `(() => { const host = ${WIN}.document.querySelector('[data-studio-ui]'); const b = host && host.shadowRoot.querySelector('[data-studio-handle=${k}]'); return !!b && b.getAttribute('aria-pressed') === 'true'; })()`;
          await until(pressed('rotate'), '3 chooses the Turn tool');
          await key(page, '1');
          await until(pressed('move'), '1 chooses the Move tool');
          await key(page, 'Escape');
          // 8. Typing in the ask field (the web demo has none: only with an AI behind the editor).
          const ask = await ev(`!!document.querySelector('.ask-input') && !!document.querySelector('.ask-input').offsetParent`);
          if (ask) {
            await ev(`studioShell.actions.select(${JSON.stringify(g.pick)})`);
            await sleep(300);
            await ev(`document.querySelector('.ask-input').focus()`);
            await page.send('Input.insertText', { text: 'make it taller' });
            const before = { keys: await keys(), sel: await selected(), undo: await ev(`document.querySelector('.top [data-action=undo]').disabled`), pose: await pose(g.pick) };
            for (const [k, m] of [['a', MOD], ['c', MOD], ['v', MOD], ['d', MOD], ['z', MOD], ['y', MOD], ['Backspace', 0], ['Delete', 0], ['3', 0]]) await key(page, k, m);
            await sleep(500);
            assert.deepEqual(await keys(), before.keys, `${tag}: keys typed in the ask field neither copy nor delete`);
            assert.equal(await selected(), before.sel, `${tag}: …nor change the selection`);
            assert.equal(await pose(g.pick), before.pose, `${tag}: …nor undo / redo a move`);
            assert.equal(await ev(`document.querySelector('.top [data-action=undo]').disabled`), before.undo, `${tag}: …nor touch the history`);
            await ev(`(() => { const i = document.querySelector('.ask-input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.blur(); })()`);
          }
          // 9. The shortcut sheet.
          await page.click(row[0], row[1]);
          await sleep(300);
          await key(page, '?', 8);
          await until(`!document.querySelector('[data-part=shortcuts]').hidden`, '? opens the shortcut sheet');
          const undoRow = await ev(`document.querySelector('[data-part=shortcuts] .keys-row[data-key=undo]')?.textContent || ''`);
          assert.ok(undoRow.includes('Undo') && undoRow.includes(MAC ? '⌘Z' : 'Ctrl+Z'), `${tag}: the sheet lists Undo ⌘Z (${undoRow})`);
          const lift = await ev(`!!document.querySelector('[data-part=shortcuts] .keys-row[data-key=lift]')`);
          assert.equal(lift, g.id === 'lantern-cove', `${tag}: the Height tool is listed only in 3D`);
          await shot('3-shortcuts');
          await key(page, 'Escape');
          await until(`document.querySelector('[data-part=shortcuts]').hidden`, 'Esc closes the sheet');
          assert.equal(await selected(), g.pick, `${tag}: Esc closed the sheet only (the selection stays)`);
          await key(page, 'k', MOD);
          await until(`!!document.querySelector('.palette [data-action=shortcuts]')`, '⌘K lists "Keyboard shortcuts"');
          await shot('4-palette');
          await press('.palette [data-action=shortcuts]');
          await until(`!document.querySelector('[data-part=shortcuts]').hidden`, 'the ⌘K row opens the sheet');
          await press('[data-action=keys-close]');
          await until(`document.querySelector('[data-part=shortcuts]').hidden`, '× closes the sheet');
        } else {
          await shot('1-open');
          // Phone: select (not what is tested here), then the card's buttons and the bar's Undo / Redo.
          await ev(`studioShell.actions.select(${JSON.stringify(g.pick)})`);
          await until(`!!document.querySelector('.card-slot [data-action=remove]')?.offsetParent`, 'the card shows Delete');
          await sleep(400);
          await shot('2-picked');
          await press('.card-slot [data-action=remove]');
          await until(`!${DBG}.list().some((i) => i.key === ${JSON.stringify(g.pick)})`, 'the card’s Delete deletes');
          await press('.top [data-action=undo]');
          await until(`${DBG}.list().some((i) => i.key === ${JSON.stringify(g.pick)})`, 'the bar’s Undo brings it back');
          await shot('3-after-undo');
          await press('.top [data-action=redo]');
          await until(`!${DBG}.list().some((i) => i.key === ${JSON.stringify(g.pick)})`, 'the bar’s Redo deletes it again');
          await press('.top [data-action=undo]');
          await until(`${DBG}.list().some((i) => i.key === ${JSON.stringify(g.pick)})`, 'Undo again');
          await ev(`studioShell.actions.select(${JSON.stringify(g.pick)})`);
          await until(`!!document.querySelector('.card-slot [data-action=copy]')?.offsetParent`, 'the card shows Duplicate');
          await press('.card-slot [data-action=copy]');
          await until(`${DBG}.list().length === ${n0 + 1}`, 'the card’s Duplicate duplicates');
          await press('.top [data-action=undo]');
          await until(`${DBG}.list().length === ${n0}`, 'Undo takes the duplicate away');
          await press('.top [data-action=redo]');
          await until(`${DBG}.list().length === ${n0 + 1}`, 'Redo brings it back');
          // The sheet from "…" (the ⌘K list): one column on the phone.
          // The list sheet slides away when closed (still laid out), so open it by its button first.
          if ((await ev(`document.querySelector('.shell').dataset.sheet`)) !== 'open') await press('[data-action=sheet]');
          await until(`document.querySelector('.shell').dataset.sheet === 'open'`, 'the list button opens the sheet');
          await sleep(400);
          await press('.sheet-more');
          await until(`!!document.querySelector('.palette [data-action=shortcuts]')?.offsetParent`, '"…" lists "Keyboard shortcuts"');
          await press('.palette [data-action=shortcuts]');
          await until(`!document.querySelector('[data-part=shortcuts]').hidden`, 'the row opens the sheet on the phone');
          await shot('4-shortcuts');
          await press('[data-action=keys-close]');
        }
        // 1. (end) Undo / Redo did not move.
        const u9 = await btn('undo');
        assert.ok(u9, `${tag}: Undo still in the bar`);
        assert.ok(Math.abs(u9.left - u0.left) <= 1, `${tag}: Undo stayed in place (${u0.left} → ${u9.left})`);
        // 10. The view.
        assert.equal(await view(), v0, `${tag}: the view did not move`);
        const errors = page.logs.filter((l) => l.startsWith('exception'));
        assert.deepEqual(errors, [], 'page errors');
        console.log(`  ✓ ${tag}`);
      } catch (e) {
        failed++;
        console.log(`  ✗ ${tag}: ${e.message}`);
        if (SHOTS) writeFileSync(join(SHOTS, `fail-${tag}.png`), await page.screenshot());
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  await srv?.close();
  if (root) rmSync(root, { recursive: true, force: true });
}
if (failed) process.exit(1);
console.log('studio-basics: ok');
