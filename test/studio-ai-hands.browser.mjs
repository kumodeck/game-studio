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
//   code     (studio-code-base, 2026-10-24: "a motion made by maths, not points — what then?" and the four user needs;
//            the first theme, or `--only code`) Neon Run with a row of hexagons the AI wrote in code — codePlace('hexrow')
//            next to the old hand-placed hex-1 … hex-4 — and a code motion codeMotion('spiral'): `list` names the layout
//            and its objects (the layout's name and a number on the card); place.code --replace hides the hand hexagons and ONE ⌘Z brings
//            them back; place.set --knobs {"gap":4} lays the row out 4 m apart (the game reads the draft again) and
//            ▶ Play shows it so; motion.code puts the spiral on the pillar's timeline (no points, nothing broken) and ▶ Play
//            moves it round; the draft placement.json has { places, motions[].code } and passes the file's check.
// Pictures (`--shots <dir>`): <lang>-<theme>-<step>.png.
//
//   node test/studio-ai-hands.browser.mjs [--lang en|ja] [--themes dark,light] [--only code|hands] [--shots <dir>]
// Exit 1 on a failure.
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startStudioServer } from '../src/server/server.mjs';
import { askEditor } from '../src/server/hands-cli.mjs';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
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
const ONLY = take('--only', 'hands,code').split(',');
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

// ---- code motions and code layouts (studio-code-base, 2026-10-24) ----
// Neon Run as the AI leaves it after "a row of hexagons 6 m apart, and spin the pillar in a spiral": the layout and the
// motion in the game's code (the old hand-placed hexagons still there until the AI takes them out on Save).
const NEON_CODE = `
    // The row of hexagons as the AI writes it in code (studio-code-base): "Gap" m apart, the editor's knobs.
    codePlace('hexrow', {
      name: '六角形の列',
      knobs: { n: { v: 4, label: '個数', unit: '', min: 1, max: 8, step: 1 }, gap: { v: 6, label: '間', unit: 'm', min: 2, max: 12 } },
      count: (k) => k.n,
      make: () => new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .5, 6), glow(0xffa21a, 1.3)),
      at: (i, k) => ({ p: [[-2.5, 2, -1, 3][i % 4], .95, -6 - i * k.gap], r: [Math.PI / 2, 0, 0] }),
      drag: 'gap',
    });
    // The pillar's spiral: radius and one turn are the editor's knobs.
    codeMotion('spiral', {
      name: '螺旋',
      knobs: { radius: { v: 2, label: '半径', unit: 'm', min: .2, max: 6 }, turn: { v: 4, label: '1 周', unit: 's', min: .5, max: 20 } },
      round: (k) => 2 * k.turn,
      at: (t, k) => { const a = (t / k.turn) * 2 * Math.PI; return { p: [k.radius * Math.cos(a) - k.radius, 0, k.radius * Math.sin(a)] }; },
    });
    window.__neon = { scene };
`;
async function runCode(theme) {
  console.log(`${LANG} ${theme} code`);
  const root = mkdtempSync(join(tmpdir(), 'studio-code-base-'));
  cpSync(join(PKG, 'test/neon-run'), root, { recursive: true });
  copyFileSync(join(PKG, 'skills/arrange/bin/studio-placement.js'), join(root, 'studio-placement.js'));
  const html = readFileSync(join(root, 'index.html'), 'utf8')
    .replace("import { applyPlacement } from './studio-placement.js';", "import { applyPlacement, codeMotion, codePlace } from './studio-placement.js';")
    .replace('    await applyPlacement(scene,', `${NEON_CODE}
    await applyPlacement(scene,`);
  writeFileSync(join(root, 'index.html'), html);
  mkdirSync(join(root, '.studio/ui'), { recursive: true });
  writeFileSync(join(root, '.studio/ui/prefs.json'), JSON.stringify({ version: 1, lang: LANG, theme, seen: ['timeline-steps', 'open-line'] }));
  const srv = await startStudioServer({ root, kumo: { home: join(root, '.no-kumo-home'), env: {} }, uiDir: UI, log: () => {}, env: {} });
  const browser = await launch();
  try {
    const page = await newPage(browser, { width: 1280, height: 800, cdnCache: process.env.STUDIO_CDN_CACHE });
    const shot = async (what) => SHOTS && writeFileSync(join(SHOTS, `${LANG}-${theme}-code-${what}.png`), await page.screenshot());
    const ai = (ops) => askEditor({ origin: srv.origin, stopToken: srv.stopToken }, ops, 'claude');
    const GW = `document.querySelector('iframe.game:not(.leaving)').contentWindow`;
    const row = `JSON.stringify([...${GW}[Symbol.for('game-studio.codePlaces')].get('hexrow').objs].map((o) => Math.round(o.position.z * 100) / 100))`;
    const handShown = `${GW}.__neon.scene.getObjectByName('hex-1')?.visible`;
    const toast = () => page.eval(`[...document.querySelectorAll('.ask-news:not([hidden]), .toast.on')].map((e) => e.textContent).join(' | ')`);
    const settled = async () => {
      await sleep(400);
      await page.waitFor(`!document.querySelector('iframe.game.leaving') && document.querySelectorAll('.obj').length > 0 && !!${GW}?.__neon`, 30000);
      await sleep(900);
    };
    const pressPlay = async () => {
      await page.eval(`document.querySelector('button.play').click()`);
      for (let i = 0; i < 8; i++) {
        await sleep(150);
        if (await page.eval(`(() => { const b = document.querySelector('[data-part=unsaved-guard]:not([hidden]) [data-action=guard-discard]'); if (b) b.click(); return !!b; })()`)) break;
      }
      await page.waitFor(`document.querySelector('.shell').dataset.playing === 'on'`, 30000);
      await sleep(1200);
    };
    const stopPlay = async () => {
      await page.eval(`document.querySelector('button.play').click()`);
      await page.waitFor(`document.querySelector('.shell').dataset.playing === 'off'`, 30000);
      await settled();
    };
    await page.goto(srv.url);
    await page.waitFor(`document.querySelectorAll('.obj').length > 0`, 90000);
    await settled();

    // ---- list: the layout, its objects under its name, the code motion not on the timeline yet ----
    const l = (await ai([{ do: 'list' }])).results?.[0]?.list;
    const hr = l?.places?.find((x) => x.id === 'hexrow');
    check(hr?.name === '六角形の列' && hr.keys?.join() === 'hexrow-1,hexrow-2,hexrow-3,hexrow-4' && hr.knobs?.gap?.v === 6, `list: the layout "六角形の列" with its 4 objects and its knobs (${JSON.stringify(hr)})`);
    check(l?.objects?.find((o) => o.key === 'hexrow-2')?.name === '六角形の列 2', `its objects are named by it: ${JSON.stringify(l?.objects?.find((o) => o.key === 'hexrow-2'))}`);
    await page.eval(`studioShell.actions.select('hexrow-2')`);
    await sleep(900);
    const card = await page.eval(`document.querySelector('[data-part=card]')?.innerText ?? ''`);
    check(card.includes('六角形の列 2'), `the card names it: "${card.split('\n').slice(0, 2).join(' / ')}"`);
    check(JSON.parse(await page.eval(row)).join() === '-6,-12,-18,-24', `the code put the row 6 m apart (${await page.eval(row)})`);
    await shot('0-row');

    // ---- place.code --replace: the hand hexagons hidden, ONE ⌘Z brings them back ----
    check((await page.eval(handShown)) === true, 'the hand-placed hex-1 is there before');
    const r1 = await ai([{ do: 'place.code', id: 'hexrow', replace: ['hex-1', 'hex-2', 'hex-3', 'hex-4'] }]);
    check(r1.editor === true && r1.results?.[0]?.ok, `place.code --replace done in the editor (${JSON.stringify(r1.results)})`);
    const t1 = await toast();
    check(t1.includes('六角形の列') && /⌘Z/.test(t1), `the line says what the AI did and the way back: "${t1}"`);
    await settled();
    check((await page.eval(handShown)) === false, 'the hand hexagons are hidden (the code row is in their place)');
    const l1 = (await ai([{ do: 'list' }])).results[0].list;
    check(l1.places?.find((x) => x.id === 'hexrow')?.from?.length === 4, `list: the layout replaced hex-1 … hex-4 (${JSON.stringify(l1.places?.find((x) => x.id === 'hexrow')?.from)})`);
    await page.eval(`document.activeElement?.blur?.()`);
    await key(page, 'z', 4);
    await settled();
    const l2 = (await ai([{ do: 'list' }])).results[0].list;
    check(!l2.places?.find((x) => x.id === 'hexrow')?.from && (await page.eval(handShown)) === true, `ONE ⌘Z: the hand hexagons are back, nothing replaced (${JSON.stringify(l2.places?.find((x) => x.id === 'hexrow')?.from ?? 'none')})`);

    // ---- motion.code: the spiral on the pillar's timeline (no points, nothing broken) ----
    const r3 = await ai([{ do: 'motion.code', code: 'spiral', name: '螺旋', key: 'pillar' }]);
    check(r3.results?.[0]?.ok, `motion.code done (${JSON.stringify(r3.results)})`);
    const t3 = await toast();
    check(t3.includes(LANG === 'ja' ? 'コードの動き「螺旋」' : 'the code motion “螺旋”'), `the line: "${t3}"`);
    const m = JSON.parse(await page.eval(`JSON.stringify(window.__studioTimeline.motionOf('pillar'))`));
    const sp = m?.clips?.find((c) => c.name === '螺旋');
    check(!!sp && !sp.keys?.p?.length && sp.len === 8, `the pillar's timeline has 螺旋, no points, one round (8 s) wide (${JSON.stringify(sp)})`);
    await page.eval(`studioShell.actions.select('pillar')`);
    await sleep(900);
    const cardM = await page.eval(`(() => { const e = document.querySelector('[data-part=card] [data-part=motion-row]'); return e && e.offsetWidth ? e.textContent : ''; })()`);
    check(cardM.includes('螺旋'), `the card's Motion row names it ("${cardM}")`);
    await shot('1-spiral');

    // ---- place.set --knobs {"gap":4}: the row 4 m apart in Edit; ▶ Play: still 4 m apart, and the pillar goes round ----
    const r2 = await ai([{ do: 'place.set', id: 'hexrow', knobs: { gap: 4 } }]);
    check(r2.results?.[0]?.ok, `place.set --knobs done (${JSON.stringify(r2.results)})`);
    const t2 = await toast();
    check(t2.includes('間 4 m'), `the line says the new Gap: "${t2}"`);
    await settled();
    check(JSON.parse(await page.eval(row)).join() === '-6,-10,-14,-18', `the row is 4 m apart now (${await page.eval(row)})`);
    check(/\d/.test(await page.eval(`document.querySelector('[data-action=save]')?.textContent ?? ''`)), 'Save counts it');
    await shot('2-gap4');
    await pressPlay();
    const playRow = JSON.parse(await page.eval(row));
    check(playRow.length === 4 && playRow.every((z, i) => !i || Math.abs(z - playRow[i - 1] + 4) < 1e-6), `▶ Play: the hexagons are 4 m apart (${playRow})`);
    // A frame counter of the game page's own (what a game's loop sees), to tell a stalled page from a stopped motion.
    await page.eval(`(() => { const w = ${GW}; w.__pp = 0; const loop = () => { w.__pp++; w.requestAnimationFrame(loop); }; w.requestAnimationFrame(loop); return true; })()`);
    const xs = [];
    for (let i = 0; i < 12; i++) {
      xs.push(await page.eval(`JSON.stringify([${GW}.__neon.scene.getObjectByName('pillar').position.x, ${GW}.__pp])`).then(JSON.parse));
      await sleep(400);
    }
    const x = xs.map((v) => v[0]);
    const turned = x.some((v, i) => i > 0 && v < x[i - 1] - 0.05) && x.some((v, i) => i > 0 && v > x[i - 1] + 0.05);
    check(Math.max(...x) - Math.min(...x) > 1 && turned, `▶ Play: the pillar goes round, out and back (x ${x.map((v) => v.toFixed(2)).join(', ')}; frames ${xs.map((v) => v[1]).join(',')})`);
    await shot('3-play');
    await stopPlay();

    // ---- the draft: places and the code motion, as the file's check wants them ----
    await sleep(1200);
    const draft = JSON.parse(readFileSync(join(root, 'placement.json'), 'utf8'));
    const v = validateStudioFile(draft, { tool: 'placement' });
    check(v.ok && JSON.stringify(draft.places?.hexrow) === JSON.stringify({ knobs: { gap: { v: 4, was: 6 } } }) && draft.motions?.some((x) => x.code === 'spiral' && x.name === '螺旋' && !x.keys)
      && draft.motion?.pillar?.clips?.some((c) => c.use === '螺旋'), `the draft placement.json: ${JSON.stringify({ places: draft.places, motions: draft.motions, pillar: draft.motion?.pillar })}`);
    const errs = page.logs.filter((x) => /^exception|^error/.test(x) && !/favicon|404/.test(x));
    check(!errs.length, `no errors on the page${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await browser.close();
    await srv.close();
  }
}

if (ONLY.includes('hands')) for (const theme of THEMES) await run(theme);
if (ONLY.includes('code')) await runCode(THEMES[0] ?? 'dark');
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
