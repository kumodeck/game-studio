// studio-ai-hands (2026-10-24) in a headless browser: the AI does editor work itself, in the open editor.
// A request: "I asked Claude, and it asked me to do the Studio's hand work. That is the worst experience." Now the AI's
// `studio.mjs <game> --do …` reaches the open editor page (src/server/hands-relay.mjs → shell/ai-hands.ts) and the
// editor changes on screen. On Lantern Cove (Row on the rowboat and the buoy), one language a run (`--lang en|ja`),
// dark then light (one pair of pictures each):
//   detach   with the rowboat's card open, the AI takes "Row" off the rowboat: the card's Motion row is gone at once,
//            the buoy keeps Row, the line over the ask bar says "Claude took “Row” off rowboat · ⌘Z undoes it", and
//            Save counts it;
//   undo     ⌘Z (real keys) puts Row back on the rowboat and its card shows it again;
//   spiral   the AI makes "Spiral" from 49 points (a spiral it worked out) and puts it on the buoy: it is a Library
//            motion on the buoy's timeline (49 position keys, loop), not code; ONE ⌘Z takes back the whole job (the
//            detach of Row and the new motion together);
//   objects  (the first theme) move / turn / resize / rename / duplicate / delete in one job, ONE ⌘Z back; lifted and
//            put on the ground; a duplicate level named "Night cove", opened, and back to the first level.
// Pictures (`--shots <dir>`): <lang>-<theme>-<step>.png.
//
//   node test/studio-ai-hands.browser.mjs [--lang en|ja] [--themes dark,light] [--shots <dir>]
// Exit 1 on a failure.
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { askEditor } from '../src/server/hands-cli.mjs';
import { launch, newPage } from './adapters-2d/cdp.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const take = (flag, d = null) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : d;
};
const SHOTS = take('--shots') ? resolve(take('--shots')) : null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const UI = resolve(take('--ui', join(PKG, 'skills/arrange/bin/studio-ui')));
const LANG = take('--lang', 'en');
const THEMES = take('--themes', 'dark,light').split(',').filter((x) => x === 'dark' || x === 'light');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = LANG === 'ja' ? { took: 'Claude が rowboat から「Row」を外しました', off: '', undo: '⌘Z で戻せます' }
  : { took: 'Claude took “Row” off', off: '', undo: '⌘Z undoes it' };

let failed = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failed++;
};

const K = (t, v) => ({ t, v });
const FILE = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [{ name: 'Row', len: 2, repeat: 'pingpong', keys: { p: [K(0, [0, 0, 0]), K(1, [-2, 0, 1]), K(2, [-4, 0, 0])] } }],
  motion: { rowboat: { clips: [{ use: 'Row', when: { on: 'start' } }] }, buoy: { clips: [{ use: 'Row', when: { on: 'start' } }] } } };
// The spiral an AI works out: two turns of radius 1.2 m rising 3 m, from where the buoy stands (offsets start at 0).
const SPIRAL = Array.from({ length: 49 }, (_, i) => {
  const a = (i / 48) * Math.PI * 4;
  return [1.2 * Math.cos(a) - 1.2, (i / 48) * 3, 1.2 * Math.sin(a)].map((x) => Math.round(x * 1000) / 1000);
});

const TL = 'window.__studioTimeline';
const KEYS = { z: 90 };
async function key(page, k, modifiers = 0) {
  const down = { type: 'keyDown', key: k, code: `Key${k.toUpperCase()}`, windowsVirtualKeyCode: KEYS[k], modifiers };
  await page.send('Input.dispatchKeyEvent', down);
  await page.send('Input.dispatchKeyEvent', { ...down, type: 'keyUp' });
}

async function run(theme) {
  console.log(`${LANG} ${theme}`);
  const root = mkdtempSync(join(tmpdir(), 'studio-ai-hands-'));
  cpSync(join(PKG, 'starters/lantern-cove'), root, { recursive: true });
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps', 'open-line'] }));
  writeFileSync(join(root, 'placement.json'), JSON.stringify(FILE, null, 2));
  // No KUMODeck sign-in: the real ~/.kumo of the machine running this is never read.
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${LANG}-${theme}-${what}.png`), await page.screenshot());
    const select = async (k) => (await page.eval(`studioShell.actions.select(${JSON.stringify(k)})`), await sleep(900));
    const uses = (n) => page.eval(`${TL}.usage(${JSON.stringify(n)}).map((u) => u.key).sort().join(',')`);
    const cardMotion = () => page.eval(`(() => { const e = document.querySelector('[data-part=card] [data-part=motion-row]'); return e && e.offsetWidth ? e.textContent : ''; })()`);
    const toast = () => page.eval(`[...document.querySelectorAll('.ask-news:not([hidden]), .toast.on')].map((e) => e.textContent).join(' | ')`);
    const saveCount = () => page.eval(`document.querySelector('[data-action=save]')?.textContent ?? ''`);
    const ai = async (ops) => {
      const t0 = Date.now();
      const r = await askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
      if (process.env.HANDS_DEBUG) console.log(`    · ${ops.map((o) => o.do).join(', ')}: ${Date.now() - t0} ms${r.error ? ` (${r.error})` : ''}`);
      return r;
    };
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await sleep(2500);

    // ---- list: what the AI reads first — keys, the names the person sees, motions ----
    const l = (await ai([{ do: 'list' }])).results?.[0]?.list;
    const boat = l?.objects?.find((o) => o.key === 'rowboat');
    check(boat?.name === 'rowboat' && boat.motions?.join() === 'Row' && l.motions?.find((m) => m.name === 'Row')?.on?.sort().join() === 'buoy,rowboat', `list: the rowboat with its motion, Row on both (${JSON.stringify(boat)})`);

    // ---- detach: the card open on the rowboat, the AI takes Row off ----
    await select('rowboat');
    check((await cardMotion()).includes('Row'), `the rowboat's card shows its motion Row ("${await cardMotion()}")`);
    await shot('0-before');
    const r1 = await ai([{ do: 'motion.detach', key: 'rowboat', name: 'Row' }]);
    await sleep(700);
    check(r1.editor === true && r1.results?.[0]?.ok === true, `the editor did it (${JSON.stringify(r1)})`);
    check(/took "Row" off rowboat/.test(r1.results?.[0]?.said ?? ''), `the AI's line says what it did: "${r1.results?.[0]?.said}"`);
    check(!(await cardMotion()).includes('Row'), `the card's Motion row lost Row at once ("${await cardMotion()}")`);
    check((await uses('Row')) === 'buoy', `only the rowboat lost it: Row is on ${await uses('Row')}`);
    const t1 = await toast();
    check(t1.includes(W.took) && t1.includes(W.undo) && (LANG !== 'ja' || t1.includes(W.off)), `the line names who did it and the way back: "${t1}"`);
    check(/\d/.test(await saveCount()), `Save counts it ("${await saveCount()}")`);
    await shot('1-detached');

    // ---- undo: ⌘Z (real keys) puts Row back ----
    await page.eval(`document.activeElement?.blur?.()`);
    await key(page, 'z', 4);
    await sleep(800);
    check((await uses('Row')) === 'buoy,rowboat', `⌘Z put Row back on the rowboat (${await uses('Row')})`);
    check((await cardMotion()).includes('Row'), `…and the card shows it again ("${await cardMotion()}")`);

    // ---- spiral: one job, two ops — a timeline motion from points, never code ----
    const r2 = await ai([
      { do: 'motion.detach', key: 'buoy', name: 'Row' },
      { do: 'motion.make', name: 'Spiral', len: 4, repeat: 'loop', points: SPIRAL, key: 'buoy' },
    ]);
    await sleep(800);
    check(r2.results?.every((x) => x.ok), `both ops done (${JSON.stringify(r2.results)})`);
    const m = await page.eval(`JSON.stringify(${TL}.motionOf('buoy'))`).then(JSON.parse);
    const sp = m?.clips?.find((c) => c.name === 'Spiral');
    check(m?.clips?.length === 1 && sp?.keys?.p?.length === 49 && sp.repeat === 'loop' && sp.len === 4, `the buoy has only Spiral: 49 position keys, 4 s, loop (${JSON.stringify(m?.clips?.map((c) => [c.name, c.keys?.p?.length, c.len, c.repeat]))})`);
    await select('buoy');
    check((await cardMotion()).includes('Spiral'), `the buoy's card shows Spiral ("${await cardMotion()}")`);
    const t2 = await toast();
    check(t2.includes(LANG === 'ja' ? '「Spiral」を作って buoy に付けました' : 'made “Spiral” and put it on buoy') && t2.includes(LANG === 'ja' ? '件' : 'more change'), `one line for the job, the new motion first: "${t2}"`);
    await shot('2-spiral');
    await page.eval(`document.activeElement?.blur?.()`);
    await key(page, 'z', 4);
    await sleep(800);
    const back = await page.eval(`JSON.stringify(${TL}.motionOf('buoy'))`).then(JSON.parse);
    check(back?.clips?.length === 1 && back.clips[0].name === 'Row' && !(await page.eval(`studioShell.actions && ${TL}.usage('Spiral').length`)), `ONE ⌘Z took back the whole job: Row again, no Spiral (${JSON.stringify(back?.clips?.map((c) => c.name))})`);

    // ---- objects (first theme only): move / turn / resize / rename / duplicate / delete in one job, ONE ⌘Z back ----
    if (theme === THEMES[0]) {
      const r4 = await ai([
        { do: 'object.move', key: 'crate', by: [1, 0, 0] },
        { do: 'object.turn', key: 'crate', to: 90, deg: true },
        { do: 'object.scale', key: 'crate', by: 1.5 },
        { do: 'object.rename', key: 'crate', to: 'Supply crate' },
        { do: 'object.duplicate', key: 'crate', by: [0, 0, 2] },
        { do: 'object.delete', key: 'barrel' },
      ]);
      await sleep(1200);
      check(r4.results?.length === 6 && r4.results.every((x) => x.ok), `six object ops done (${JSON.stringify(r4.results?.map((x) => x.ok ? x.said : x.error))})`);
      const copy = /duplicated crate as (\S+)/.exec(r4.results?.[4]?.said ?? '')?.[1];
      const l4 = (await ai([{ do: 'list' }])).results[0].list;
      const crate = l4.objects.find((o) => o.key === 'crate');
      check(crate?.name === 'Supply crate' && !!copy && l4.objects.some((o) => o.key === copy) && !l4.objects.some((o) => o.key === 'barrel'), `the list: "Supply crate", its copy ${copy}, no barrel`);
      await page.eval(`document.activeElement?.blur?.()`);
      await key(page, 'z', 4);
      await sleep(1200);
      const l5 = (await ai([{ do: 'list' }])).results[0].list;
      check(l5.objects.find((o) => o.key === 'crate')?.name === 'crate' && !l5.objects.some((o) => o.key === copy) && l5.objects.some((o) => o.key === 'barrel'), `ONE ⌘Z: the name back, the copy gone, the barrel back`);
      // Drop to floor: lifted 2 m, then put on the ground by the game page.
      const r6 = await ai([{ do: 'object.move', key: 'crate', by: [0, 2, 0] }, { do: 'object.ground', key: 'crate' }]);
      check(r6.results?.every((x) => x.ok), `lifted and put back on the ground (${JSON.stringify(r6.results?.map((x) => x.ok ? x.said : x.error))})`);
      await page.eval(`document.activeElement?.blur?.()`);
      await key(page, 'z', 4);
      await sleep(600);
      // Levels: a duplicate of this level, named, opened; then back to the first.
      const r7 = await ai([{ do: 'level.duplicate', name: 'Night cove' }]);
      await sleep(1500);
      const lv = (await ai([{ do: 'list' }])).results[0].list;
      check(r7.results?.[0]?.ok && lv.level?.name === 'Night cove' && lv.levels?.length === 2, `a duplicate level "Night cove", opened (${JSON.stringify(lv.level)} of ${JSON.stringify(lv.levels)})`);
      await shot('3-level');
      // A level just made is one ⌘Z away (the editor's "Level 2 made · Undo"), named or not.
      await page.eval(`document.activeElement?.blur?.()`);
      await key(page, 'z', 4);
      await sleep(2500);
      const lu = (await ai([{ do: 'list' }])).results[0].list;
      check(!lu.levels || lu.levels.length === 1, `⌘Z took the new level away (${JSON.stringify(lu.levels ?? 'no levels')})`);
      const r7b = await ai([{ do: 'level.duplicate', name: 'Night cove' }]);
      await sleep(1500);
      const lv2 = (await ai([{ do: 'list' }])).results[0].list;
      check(r7b.results?.[0]?.ok && lv2.levels?.length === 2, `made again (${JSON.stringify(lv2.levels)})`);
      const r8 = await ai([{ do: 'level.switch', id: lv2.levels[0].id }]);
      await sleep(1500);
      check(r8.results?.[0]?.ok && (await ai([{ do: 'list' }])).results[0].list.level?.id === lv2.levels[0].id, `back to the first level (${JSON.stringify(r8.results?.[0])})`);
      const t8 = await toast();
      check(!/⌘Z/.test(t8), `opening a level does not promise ⌘Z: "${t8}"`);
    }

    // ---- a wrong name: an answer the AI can act on, nothing changed ----
    const r3 = await ai([{ do: 'motion.detach', key: 'rowboat', name: 'Hop' }]);
    check(r3.results?.[0]?.ok === false && /no motion "Hop".*"Row"/.test(r3.results[0].error), `a wrong name says which motions it has: "${r3.results?.[0]?.error}"`);
    check((await uses('Row')) === 'buoy,rowboat', `…and changes nothing`);
  } finally {
    await browser.close();
    await srv.close();
  }
}

for (const theme of THEMES) await run(theme);
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
