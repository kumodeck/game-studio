// report.md for one play test run. Plain Markdown, links relative to the
// report so the folder can be moved or committed as is.
//
// The machine part (timing, steps, stumbles found by the script, console
// errors, every English text seen) is written here. The judged part (which
// stumble hurts most, which English reads oddly) is the play tester's: the
// "Reviewer notes" heading is left for that, above the machine part, so a
// reader sees the judgement first.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = { 3: 'blocked / broken', 2: 'got lost or waited', 1: 'small' };
const sec = (s) => (s == null ? '-' : `${s.toFixed(1)} s`);
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

export function writeReport({ outDir, branch, commit, worktree, node, ffmpeg, when, empty, runs }) {
  const L = [];
  L.push(`# Play test — ${branch}`, '');
  L.push(`- When: ${when.toISOString()}`, `- Branch: \`${branch}\` @ \`${commit}\``, `- Worktree: \`${worktree}\``);
  L.push(`- Node ${node} · ${ffmpeg} · headless Chrome (fresh profile), en-US`);
  L.push(`- Samples: ${[...new Set(runs.map((r) => r.sample))].join(', ')} · PC 1280×800 (mouse) and phone 390×844 (touch)`);
  L.push('', '## Reviewer notes', '', '_(filled in by the play tester after watching the videos)_', '');

  // ---- timing: the numbers a reader looks for first ----
  L.push('## Timing', '');
  const done = runs.filter((r) => r.steps);
  const names = [];
  for (const r of done) for (const m of r.timing || []) if (!names.includes(m.name)) names.push(m.name);
  L.push(`| | ${done.map((r) => r.tag).join(' | ')} |`, `|---|${done.map(() => '---:').join('|')}|`);
  for (const n of names) {
    const kind = done.flatMap((r) => r.timing).find((m) => m.name === n)?.kind;
    L.push(`| ${esc(n)} _(${kind})_ | ${done.map((r) => sec(r.timing.find((m) => m.name === n)?.s)).join(' | ')} |`);
  }
  L.push('', '"since start" counts from launching `studio.mjs`; "took" is from the press to the answer on screen.', '');

  // ---- stumbles found by the script, heaviest first ----
  L.push('## Stumbles found by the script (heaviest first)', '');
  const all = done.flatMap((r) => (r.stumbles || []).map((s) => ({ ...s, tag: r.tag })));
  all.sort((a, b) => b.weight - a.weight);
  if (!all.length) L.push('None.');
  for (const s of all) L.push(`- **${W[s.weight]}** · ${s.tag}: ${esc(s.text)}${s.shot ? ` ([picture](${s.shot}))` : ''}`);
  L.push('');

  // ---- empty folder ----
  if (empty) {
    L.push('## Starting in an empty folder', '');
    if (empty.ready.url) L.push(`The editor served a page after ${sec(empty.ready.s)}.`, '', ...empty.shots.map((s) => `![${s.caption}](${s.file})`));
    else {
      L.push(`No page: the editor exited (code ${empty.exit ?? 'still running'}) and printed:`, '', '```');
      L.push(...[...empty.stdout, ...empty.stderr.split('\n')].filter(Boolean).slice(0, 12), '```');
    }
    L.push('');
  }

  // ---- each run ----
  for (const r of runs) {
    if (r.missing) {
      L.push(`## ${r.sample}`, '', `No \`index.html\` at \`${r.src}\` — skipped.`, '');
      continue;
    }
    L.push(`## ${r.tag}`, '', `Sample \`${r.src}\`.${r.crashed ? ` **The run crashed:** ${esc(r.crashed)}` : ''}`, '');
    if (r.video?.path) L.push(`Video: [${r.tag}.mp4](${r.tag}.mp4) (${r.video.seconds} s, ${(r.video.bytes / 1048576).toFixed(1)} MB)`, '');
    else if (r.video) L.push(`Video: none (${esc(r.video.error)})`, '');
    L.push('| Step | | Took | What happened |', '|---|---|---:|---|');
    for (const s of r.steps) L.push(`| ${s.name} | ${s.ok ? 'ok' : '**failed**'} | ${sec(s.s)} | ${esc(s.note)} |`);
    L.push('');
    for (const s of r.shots || []) if (s.file) L.push(`**${esc(s.caption)}**`, '', `![${esc(s.caption)}](${s.file})`, '');
    if (r.placement) {
      const keys = Object.keys(r.placement.objects || {});
      L.push(`placement.json after Save: ${keys.length} changed (${keys.join(', ')}), ${(r.placement.added || []).length} added, ${(r.placement.removed || []).length} removed.`, '');
    }
    if (r.requests?.length) L.push(`Requests for the AI: ${r.requests.map((f) => `\`.studio/requests/${f}\``).join(', ')}`, '');
    L.push(`Console: ${r.errors?.length || 0} error(s), ${r.warnings?.length || 0} warning(s).`);
    if (r.errors?.length) L.push('', '```', ...r.errors.slice(0, 10).map((e) => e.slice(0, 300)), '```');
    if (r.stdout?.length) L.push('', '<details><summary>Editor output</summary>', '', '```', ...r.stdout.slice(0, 40), '```', '', '</details>');
    L.push('');
  }

  // ---- every English text seen, for the language review ----
  const texts = [...new Set(done.flatMap((r) => r.texts || []))].sort((a, b) => a.localeCompare(b));
  L.push('## Every text seen on screen', '', `${texts.length} strings (visible text, button labels, tooltips, placeholders), for the English review.`, '');
  L.push('<details><summary>Show</summary>', '', ...texts.map((t) => `- ${esc(t)}`), '', '</details>', '');

  const file = join(outDir, 'report.md');
  writeFileSync(file, L.join('\n'));
  return file;
}
