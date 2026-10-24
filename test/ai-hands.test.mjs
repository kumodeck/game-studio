// The AI's hands (studio-ai-hands, 2026-10-24; CONTRACT.md §3.6): `studio.mjs <game> --do …` does editor work itself.
// A request: "I asked Claude, and it asked me to do the Studio's hand work. That is the worst experience."
//   - the ops (schema/hands.mjs): read loudly (a typo is an error, not ignored), a motion from points, the same file
//     shape the editor writes (validated), and refusals that say what to do;
//   - the CLI with no editor open: placement.json changed in place, one `studio: did …` line per op;
//   - the CLI with an editor page open (a stand-in page on the real server's event stream): the ops go to the page and
//     its answer is the CLI's — nothing is written to the file by the CLI then.
//
//   npm run build && node --test test/ai-hands.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyHandsToFile, handsMotion, readHandsInput } from '../src/schema/hands.mjs';
import { validateStudioFile } from '../src/schema/studio-files.mjs';
import { startStudioServer } from '../src/server/server.mjs';
import { askEditor, handsInput } from '../src/server/hands-cli.mjs';

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(PKG, 'skills/arrange/bin/studio.mjs');
const FAKE = join(PKG, 'test/first-run/starters/fake-3d');
const K = (t, v) => ({ t, v });
const BASE = () => ({ version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {},
  motions: [{ name: 'Row', len: 2, repeat: 'pingpong', keys: { p: [K(0, [0, 0, 0]), K(1, [-2, 0, 1]), K(2, [-4, 0, 0])] } }],
  motion: { 'pillar-1': { clips: [{ use: 'Row', when: { on: 'start' } }] }, 'pillar-6': { clips: [{ use: 'Row', when: { on: 'start' } }] } } });
const ops = (v) => {
  const r = readHandsInput(v);
  assert.ok(r.ok, JSON.stringify(r.errors));
  return r.ops;
};
const apply = (file, v) => {
  const r = applyHandsToFile(file, ops(v));
  const valid = validateStudioFile(r.file, { tool: 'placement' });
  assert.ok(valid.ok, JSON.stringify(valid.errors));
  return { ...r, file: valid.value };
};
const game = (name) => {
  const dir = mkdtempSync(join(tmpdir(), `studio-hands-${name}-`));
  cpSync(FAKE, dir, { recursive: true });
  return dir;
};
const cli = (args, env = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 30000, env: { ...process.env, CLAUDECODE: '1', ...env } });

test('ops are read loudly: an unknown op, an unknown field, a missing field each say what is wrong', () => {
  assert.match(readHandsInput('{"do":"motion.remove","key":"a"}').errors[0], /"do" must be one of motion\.make/);
  assert.match(readHandsInput({ do: 'motion.detach', key: 'a', clip: 'Row' }).errors[0], /unknown field "clip" \(it takes key, name, all, level\)/);
  assert.match(readHandsInput({ do: 'motion.attach', key: 'a' }).errors[0], /needs "name"/);
  assert.match(readHandsInput({ do: 'object.move', key: 'a' }).errors[0], /needs "to" or "by"/);
  assert.match(readHandsInput({ do: 'motion.make', name: 'S', len: 2 }).errors[0], /needs "points"/);
  assert.match(readHandsInput('not json').errors[0], /^not JSON/);
  // Short words for when: key:E is the KeyboardEvent.code, time / after / cue as the file has them.
  const [a, b, c] = ops([{ do: 'motion.attach', key: 'a', name: 'Hop', when: 'key:E' }, { do: 'motion.attach', key: 'a', name: 'Hop', when: ['click', 'time:2'] }, { do: 'motion.set', name: 'Hop', until: 'times:3' }]);
  assert.deepEqual(a.when, { on: 'key', key: 'KeyE' });
  assert.deepEqual(b.when, [{ on: 'click' }, { on: 'time', after: 2 }]);
  assert.deepEqual(c.until, { times: 3 });
});

test('the flags of one op: --do motion.detach --key pillar-1 --name Row, numbers and lists as JSON', () => {
  assert.deepEqual(handsInput({ do: 'motion.detach', doFields: { key: 'pillar-1', name: 'Row' } }), { do: 'motion.detach', key: 'pillar-1', name: 'Row' });
  assert.equal(handsInput({ do: ' [{"do":"save"}]' }), '[{"do":"save"}]');
  // A rename to "2" is the name "2", not the number.
  assert.deepEqual(handsInput({ do: 'object.rename', doFields: { key: 'crate', to: 2 } }), { do: 'object.rename', key: 'crate', to: '2' });
});

test('a motion from points: evenly over len, linear between them (no stop at every point), checked like the file', () => {
  const pts = Array.from({ length: 5 }, (_, i) => [i, i * 0.5, 0]);
  const m = handsMotion({ name: 'Spiral', len: 4, repeat: 'loop', points: pts }, '3d').motion;
  assert.deepEqual(m.keys.p.map((k) => k.t), [0, 1, 2, 3, 4]);
  assert.deepEqual(m.keys.p.map((k) => k.ease), ['linear', 'linear', 'linear', 'linear', undefined]);
  assert.equal(m.repeat, 'loop');
  assert.match(handsMotion({ name: 'S', points: [[0, 0], [1, 1]] }, '3d').error, /points must have 3 numbers/);
  // The file's own validator decides: a key after the end is refused before anything is changed.
  assert.match(handsMotion({ name: 'S', len: 1, keys: { p: [K(0, [0, 0, 0]), K(2, [1, 0, 0])] } }, '3d').error, /after the clip/);
});

test('no editor open: take "Row" off one pillar, make a spiral and put it on — the file the editor itself writes', () => {
  const pts = Array.from({ length: 49 }, (_, i) => [Math.cos(i / 8) - 1, i / 16, Math.sin(i / 8)].map((x) => Math.round(x * 1000) / 1000));
  const { file, results } = apply(BASE(), [
    { do: 'motion.detach', key: 'pillar-1', name: 'Row' },
    { do: 'motion.make', name: 'Spiral', len: 4, repeat: 'loop', points: pts, key: 'pillar-1' },
    { do: 'motion.attach', key: 'pillar-6', name: 'Spiral', when: 'start' },
  ]);
  assert.deepEqual(results.map((r) => r.ok), [true, true, true]);
  assert.equal(results[0].said, 'took "Row" off pillar-1');
  assert.equal(results[1].said, 'made "Spiral" (49 points, 4 s, loop) and put it on pillar-1, starts with the game');
  assert.deepEqual(file.motion['pillar-1'], { clips: [{ use: 'Spiral', when: { on: 'start' } }] });
  assert.deepEqual(file.motion['pillar-6'].clips.map((c) => c.use), ['Row', 'Spiral']);
  assert.equal(file.motions.find((m) => m.name === 'Spiral').keys.p.length, 49);
  // A motion made for an object that already moves still starts with the game (not "after Row", which loops for ever).
  const both = apply(BASE(), [{ do: 'motion.make', name: 'Spiral', points: [[0, 0, 0], [0, 1, 0]], key: 'pillar-6' }]);
  assert.deepEqual(both.file.motion['pillar-6'].clips, [{ use: 'Row', when: { on: 'start' } }, { use: 'Spiral', when: { on: 'start' } }]);
  // The same name again without replace: "Spiral 2" (never overwritten by accident); with replace: the same motion, new keys.
  const again = apply(file, [{ do: 'motion.make', name: 'Spiral', points: [[0, 0, 0], [0, 1, 0]] }]);
  assert.deepEqual(again.file.motions.map((m) => m.name), ['Row', 'Spiral', 'Spiral 2']);
  const fixed = apply(file, [{ do: 'motion.make', name: 'Spiral', points: [[0, 0, 0], [0, 1, 0]], replace: true }]);
  assert.equal(fixed.file.motions.find((m) => m.name === 'Spiral').keys.p.length, 2);
});

test('no editor open: delete, rename, repeat / when, and the reasons for what needs the editor', () => {
  const del = apply(BASE(), [{ do: 'motion.delete', name: 'Row' }]);
  assert.equal(del.results[0].said, 'deleted "Row" from the Library (it came off 2 objects)');
  assert.equal(del.file.motion, undefined);
  assert.equal(del.file.motions, undefined);
  const ren = apply(BASE(), [{ do: 'motion.rename', name: 'Row', to: 'Paddle' }, { do: 'motion.set', name: 'Paddle', repeat: 'loop', len: 4 }]);
  assert.deepEqual(ren.file.motion['pillar-1'].clips, [{ use: 'Paddle', when: { on: 'start' } }]);
  const p = ren.file.motions[0];
  assert.deepEqual([p.name, p.repeat, p.len, p.keys.p.map((k) => k.t)], ['Paddle', 'loop', 4, [0, 2, 4]]);
  const when = apply(BASE(), [{ do: 'motion.set', name: 'Row', key: 'pillar-6', when: 'key:E', until: 'times:2' }]);
  assert.deepEqual(when.file.motion['pillar-6'].clips[0], { use: 'Row', when: { on: 'key', key: 'KeyE' }, until: { times: 2 } });
  const no = applyHandsToFile(BASE(), ops([{ do: 'motion.detach', key: 'pillar-1', name: 'Hop' }, { do: 'object.ground', key: 'crate' }, { do: 'level.new' }, { do: 'motion.detach', key: 'pillar-2' }]));
  assert.deepEqual(no.results.map((r) => r.error), [
    'pillar-1 has no motion "Hop" (its motions: "Row")',
    'putting it on the ground needs the editor open (it measures what is under the object)',
    'a new (blank) level needs the editor open (it lists what the level keeps)',
    'pillar-2 has no motion',
  ]);
});

test('no editor open: objects — move, turn in degrees, scale by, rename, duplicate, delete', () => {
  const f = BASE();
  f.objects.crate = { p: [1, 0, 1], r: 0, s: 1, was: { p: [0, 0, 0] } };
  const { file, results } = apply(f, [
    { do: 'object.move', key: 'crate', by: [1, 0, 0] },
    { do: 'object.turn', key: 'crate', to: 90, deg: true },
    { do: 'object.scale', key: 'crate', by: 2 },
    { do: 'object.rename', key: 'crate', to: 'Hero crate' },
    { do: 'object.duplicate', key: 'crate', by: [0, 0, 2] },
    { do: 'object.delete', key: 'pillar-6' },
  ]);
  assert.ok(results.every((r) => r.ok), JSON.stringify(results));
  assert.deepEqual(file.objects.crate, { p: [2, 0, 1], r: 1.5708, s: 2, was: { p: [0, 0, 0] } });
  assert.deepEqual(file.names, { crate: 'Hero crate' });
  assert.deepEqual(file.added, [{ key: 'crate-2', from: 'crate', p: [2, 0, 3], r: 1.5708, s: 2 }]);
  assert.deepEqual(file.removed.map((r) => r.key), ['pillar-6']);
  assert.equal(file.motion['pillar-6'], undefined, 'a deleted object does not move');
  // An object the file does not know yet: a place is fine, "by" needs to know where it stands.
  const unknown = applyHandsToFile(BASE(), ops([{ do: 'object.move', key: 'rock', to: [3, 0, 0] }, { do: 'object.move', key: 'rock2', by: [1, 0, 0] }]));
  assert.equal(unknown.results[0].ok, true);
  assert.match(unknown.results[1].error, /where rock2 stands now is not known here: give "to"/);
});

test('no editor open: levels — rename keeps the code\'s name for the AI, duplicate is a level made from its code level', () => {
  const f = { version: 1, tool: 'placement', dim: '3d', space: 'local', objects: {}, levels: [{ id: 'meadow', label: 'Meadow' }, { id: 'cave', label: 'Cave' }] };
  const { file } = apply(f, [{ do: 'level.rename', id: 'cave', to: 'Crystal Hall' }, { do: 'level.duplicate', id: 'meadow', name: 'Meadow at night' }]);
  assert.deepEqual(file.levels.map((l) => [l.id, l.label, l.labelWas ?? null, l.from ?? null]), [
    ['meadow', 'Meadow', null, null], ['meadow-2', 'Meadow at night', null, 'meadow'], ['cave', 'Crystal Hall', 'Cave', null]]);
  assert.deepEqual(file.levelsWas, ['meadow', 'cave']);
  // With levels, a world op says which level.
  assert.match(applyHandsToFile(f, ops([{ do: 'object.move', key: 'a', to: [0, 0, 0] }])).results[0].error, /this game has levels: say which one with "level" \(meadow, cave\)/);
});

test('list with no editor open: what placement.json knows, and nothing is written', () => {
  const { results } = applyHandsToFile(BASE(), ops({ do: 'list' }));
  assert.deepEqual(results[0].list.objects, [{ key: 'pillar-1', motions: ['Row'] }, { key: 'pillar-6', motions: ['Row'] }]);
  assert.deepEqual(results[0].list.motions, [{ name: 'Row', len: 2, repeat: 'pingpong' }]);
});

test('CLI, no editor running: --do changes placement.json in place and prints one line per op', () => {
  const dir = game('cli-file');
  try {
    writeFileSync(join(dir, 'placement.json'), JSON.stringify(BASE()));
    const r = cli([dir, '--do', 'motion.detach', '--key', 'pillar-1', '--name', 'Row']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.stdout.trim(), 'studio: did took "Row" off pillar-1 - in placement.json (no editor is running: it shows when the editor opens)');
    const v = JSON.parse(readFileSync(join(dir, 'placement.json'), 'utf8'));
    assert.deepEqual(Object.keys(v.motion), ['pillar-6']);
    // A failed op: exit 1, the reason, and the file untouched by it.
    const bad = cli([dir, '--do', '{"do":"motion.detach","key":"pillar-1","name":"Row"}']);
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout.trim(), 'studio: do failed motion.detach - pillar-1 has no motion');
    const list = cli([dir, '--do', 'list']);
    assert.match(list.stdout, /^studio: list \{"from":"placement\.json/);
    const typo = cli([dir, '--do', 'motion.dettach', '--key', 'pillar-1']);
    assert.equal(typo.status, 2);
    assert.match(typo.stdout, /^studio: do failed - op: "do" must be one of/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A stand-in editor page on the server's event stream (what host-local.ts hands() does): answers each job with `answer`. */
async function fakePage(url, answer) {
  const r = await fetch(url, { redirect: 'manual' });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const origin = new URL(url).origin;
  const ac = new AbortController();
  const jobs = [];
  const res = await fetch(`${origin}/__studio/api/hands`, { headers: { cookie }, signal: ac.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  (async () => {
    let buf = '';
    const dec = new TextDecoder();
    try {
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const ev = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = /^event: job\ndata: (.*)$/m.exec(ev);
          if (!data) continue;
          const job = JSON.parse(data[1]);
          jobs.push(job);
          await fetch(`${origin}/__studio/api/hands/${job.id}`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify(answer(job)) });
        }
      }
    } catch {
      /* closed */
    }
  })();
  return { jobs, close: () => ac.abort() };
}

test('the relay: no page open = { editor: false } at once; a page open gets the job and its answer is the CLI\'s', async () => {
  const dir = game('relay');
  const srv = await startStudioServer({ root: dir, kumo: { home: join(dir, '.no-kumo-home'), env: {} }, log: () => {}, env: {} });
  try {
    const me = { origin: srv.origin, stopToken: srv.stopToken };
    const t0 = Date.now();
    assert.deepEqual(await askEditor(me, [{ do: 'save' }], 'claude'), { editor: false });
    assert.ok(Date.now() - t0 < 1500, 'no page ever opened: no wait');
    // The folder's secret is needed (a web page cannot reach it).
    const no = await fetch(`${srv.origin}/__studio/hands`, { method: 'POST', headers: { 'x-studio-agent': 'nope' }, body: '{}' });
    assert.equal(no.status, 403);
    const page = await fakePage(srv.url, (job) => ({ results: job.ops.map((o) => ({ do: o.do, ok: true, said: `did ${o.do}` })) }));
    await new Promise((r) => setTimeout(r, 200));
    const r = await askEditor(me, readHandsInput([{ do: 'motion.detach', key: 'pillar-1', name: 'Row' }]).ops, 'claude');
    assert.deepEqual(r, { editor: true, results: [{ do: 'motion.detach', ok: true, said: 'did motion.detach' }] });
    assert.deepEqual(page.jobs.map((j) => [j.by, j.ops]), [['claude', [{ do: 'motion.detach', key: 'pillar-1', name: 'Row' }]]]);
    // Bad ops never reach the page.
    assert.match((await askEditor(me, [{ do: 'motion.detach' }])).error, /needs "key"/);
    assert.equal(page.jobs.length, 1);
    page.close();
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI with the editor running: a page open → the ops happen there (the CLI writes nothing); none open → the file, and the link line', async () => {
  const dir = game('cli-editor');
  try {
    writeFileSync(join(dir, 'placement.json'), JSON.stringify(BASE()));
    const start = cli([dir, '--detach', '--no-open']);
    assert.equal(start.status, 0, start.stdout + start.stderr);
    const url = start.stdout.match(/^studio: ready (\S+) pid/m)[1];
    // No page has it open yet: the file, and the reply line so the AI's answer starts with the link.
    const a = cli([dir, '--do', 'motion.detach', '--key', 'pillar-6', '--name', 'Row']);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    assert.deepEqual(a.stdout.trim().split('\n'), [
      'studio: did took "Row" off pillar-6 - in placement.json (the editor is running but no page has it open: it shows there when the page opens)',
      `studio: reply with this link alone on the first line of your answer, exactly as printed: ${url}`,
    ]);
    const before = readFileSync(join(dir, 'placement.json'), 'utf8');
    const page = await fakePage(url, (job) => ({ results: job.ops.map((o) => ({ do: o.do, ok: true, said: `took "Row" off ${o.key}` })) }));
    await new Promise((r) => setTimeout(r, 300));
    // Async: the stand-in page answers from this process while the CLI waits.
    const out = await new Promise((resolve) => {
      const c = spawn(process.execPath, [CLI, dir, '--do', 'motion.detach', '--key', 'pillar-1', '--name', 'Row'], { env: { ...process.env, CLAUDECODE: '1' } });
      let s = '';
      c.stdout.on('data', (d) => (s += d));
      c.on('close', (code) => resolve({ code, s }));
    });
    assert.equal(out.code, 0, out.s);
    assert.deepEqual(out.s.trim().split('\n'), [
      'studio: did took "Row" off pillar-1 - in the editor (on screen now; ⌘Z there undoes it)',
      `studio: reply with this link alone on the first line of your answer, exactly as printed: ${url}`,
    ]);
    assert.equal(page.jobs[0].by, 'claude', 'the page is told which AI asked (its name is in the line)');
    assert.equal(readFileSync(join(dir, 'placement.json'), 'utf8'), before, 'the CLI did not write the file: the page did the work');
    page.close();
  } finally {
    cli([dir, '--stop']);
    rmSync(dir, { recursive: true, force: true });
  }
});

// Code motions and code layouts (studio-code-base, 2026-10-24; CONTRACT.md §1.9.4, §1.12, §3.6).
test('no editor open: motion.code puts a code motion on the timeline (the Library\'s { name, code } and a clip)', () => {
  const r = apply(BASE(), [{ do: 'motion.code', code: 'spiral', name: '螺旋', key: 'pillar-1' }]);
  assert.ok(r.results[0].ok, r.results[0].error);
  assert.deepEqual(r.file.motions.find((m) => m.code), { name: '螺旋', code: 'spiral' });
  assert.deepEqual(r.file.motion['pillar-1'].clips.at(-1), { use: '螺旋', when: { on: 'start' } });
  assert.match(r.results[0].said, /put the code motion "螺旋" \(codeMotion\('spiral'\)\) on pillar-1, starts with the game/);
  // The same code again on another object: the same Library motion (its knobs are one), not a second one with "2" after its name.
  const r2 = apply(r.file, [{ do: 'motion.code', code: 'spiral', name: 'Spiral', key: 'pillar-6' }]);
  assert.equal(r2.file.motions.filter((m) => m.code).length, 1);
  assert.equal(r2.file.motion['pillar-6'].clips.at(-1).use, '螺旋');
  // replace: the motion of points named "Row" becomes the code motion (every object keeps it).
  const r3 = apply(BASE(), [{ do: 'motion.code', code: 'row', name: 'Row', replace: true }]);
  assert.deepEqual(r3.file.motions, [{ name: 'Row', code: 'row' }]);
  assert.equal(r3.file.motion['pillar-6'].clips[0].use, 'Row');
  assert.match(r3.results[0].said, /turned "Row" into the code motion/);
  // A name taken by a motion of points, without replace: a new name.
  assert.equal(apply(BASE(), [{ do: 'motion.code', code: 'row', name: 'Row' }]).file.motions[1].name, 'Row 2');
});

test('no editor open: motion.set off writes the switch; knobs are refused (they are the editor\'s, or the code\'s)', () => {
  const r = apply(BASE(), [{ do: 'motion.set', name: 'Row', key: 'pillar-1', off: true }]);
  assert.equal(r.file.motion['pillar-1'].clips[0].off, true);
  assert.equal(apply(r.file, [{ do: 'motion.set', name: 'Row', key: 'pillar-1', off: false }]).file.motion['pillar-1'].clips[0].off, undefined);
  const k = applyHandsToFile(BASE(), ops([{ do: 'motion.set', name: 'Row', knobs: { radius: 3 } }]));
  assert.match(k.results[0].error, /no editor is open: change the number in the codeMotion\(\) in the game's code directly/);
  assert.match(readHandsInput({ do: 'motion.set', name: 'Row', off: true }).errors[0], /"off" is per object/);
  assert.match(readHandsInput({ do: 'motion.set', name: 'Row', knobs: { 'a b': 1 } }).errors[0], /"knobs" must be/);
  const code = apply(BASE(), [{ do: 'motion.code', code: 'row', name: 'Row', replace: true }]).file;
  assert.match(applyHandsToFile(code, ops([{ do: 'motion.set', name: 'Row', len: 3 }])).results[0].error, /is a code motion: its length and repeat are its codeMotion\('row'\)'s/);
});

test('no editor open: place.code --replace, place.set pin / unpin, place.avoid code / box / off / remove', () => {
  const file = { ...BASE(), objects: { 'lamp-1': { p: [1, 0, 0], was: { p: [0, 0, 0] } }, tree: { p: [2, 0, 2] } } };
  const r = apply(file, [{ do: 'place.code', id: 'lamp-row', replace: ['lamp-1', 'lamp-2'] }]);
  assert.deepEqual(r.file.places, { 'lamp-row': { from: ['lamp-1', 'lamp-2'] } });
  assert.ok(!r.file.objects['lamp-1'] && r.file.objects.tree, 'the replaced object\'s move is gone with it, the rest stay');
  assert.match(r.results[0].said, /put codePlace\('lamp-row'\) in place of lamp-1, lamp-2/);
  // Without replace: nothing to write (the code places it), and no empty entry is left.
  const r0 = apply(BASE(), [{ do: 'place.code', id: 'hex' }]);
  assert.equal(r0.file.places, undefined);
  const p = apply(BASE(), [
    { do: 'place.set', id: 'hex', pin: { key: 'hex-3', p: [-3.1, 0.95, -19] } },
    { do: 'place.avoid', id: 'hex', code: 'road' },
    { do: 'place.avoid', id: 'hex', box: { p: [-8.6, 0, -17], size: [3.2, 2, 5] }, name: '箱 1' },
    { do: 'place.avoid', id: 'hex', code: 'road', off: true },
  ]);
  assert.ok(p.results.every((x) => x.ok), JSON.stringify(p.results));
  assert.deepEqual(p.file.places.hex, { pins: { 'hex-3': { p: [-3.1, 0.95, -19] } }, avoid: [{ code: 'road', off: true }, { box: { p: [-8.6, 0, -17], size: [3.2, 2, 5] }, name: '箱 1' }] });
  assert.match(p.results[3].said, /changed the keep-out area codeAvoid\('road'\) on codePlace\('hex'\), switched off/);
  const q = apply(p.file, [{ do: 'place.avoid', id: 'hex', remove: 'road' }, { do: 'place.avoid', id: 'hex', remove: 0 }, { do: 'place.set', id: 'hex', unpin: 'hex-3' }]);
  assert.equal(q.file.places, undefined, 'all taken back: nothing left to write');
  // Refusals that say what to do.
  const bad = (op, re) => assert.match(applyHandsToFile(BASE(), ops([op])).results[0].error, re);
  bad({ do: 'place.set', id: 'hex', pin: { key: 'lamp-3', p: [0, 0, 0] } }, /not one of codePlace\('hex'\)'s objects/);
  bad({ do: 'place.set', id: 'hex', knobs: { gap: 4 } }, /no editor is open: change the number in codePlace\('hex'\)/);
  bad({ do: 'place.set', id: 'hex', hand: true }, /placing by hand needs the editor open/);
  bad({ do: 'place.avoid', id: 'hex', code: 'near-player', knobs: { r: 6 } }, /codeAvoid\('near-player'\)/);
  bad({ do: 'place.avoid', id: 'hex', remove: 2 }, /has no keep-out area 2/);
  assert.match(readHandsInput({ do: 'place.avoid', id: 'hex', code: 'road', box: { p: [0, 0, 0], size: [1, 1, 1] } }).errors[0], /one of them/);
  assert.match(readHandsInput({ do: 'place.code', id: 'Lamp Row' }).errors[0], /codePlace id/);
  assert.match(readHandsInput({ do: 'place.set', id: 'hex' }).errors[0], /needs one of "knobs", "pin", "unpin", "hand"/);
  // list with no editor open: the layouts the file has changes for.
  const l = applyHandsToFile(p.file, ops([{ do: 'list' }])).results[0].list;
  assert.deepEqual(l.places.map((x) => x.id), ['hex']);
});

test('the flags of the new ops: --code, --knobs as JSON, --replace with a list, --hand false', () => {
  assert.deepEqual(handsInput({ do: 'place.set', doFields: { id: 'hex', knobs: { gap: 4 } } }), { do: 'place.set', id: 'hex', knobs: { gap: 4 } });
  const r = spawnSync(process.execPath, [CLI, game('flags'), '--do', 'place.code', '--id', 'lamp-row', '--replace', '["lamp-1"]'], { encoding: 'utf8', env: { ...process.env, CLAUDECODE: '1' } });
  assert.match(r.stdout, /studio: did put codePlace\('lamp-row'\) in place of lamp-1/);
  const r2 = spawnSync(process.execPath, [CLI, game('flags2'), '--do', 'place.set', '--id', 'hex', '--hand', 'false'], { encoding: 'utf8', env: { ...process.env, CLAUDECODE: '1' } });
  assert.match(r2.stdout, /studio: do failed place.set - placing by hand needs the editor open/);
});
