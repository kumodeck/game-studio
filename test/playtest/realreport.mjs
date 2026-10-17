// report.md and transcript.md for one real-agent run (realagent.mjs). Written even when the run stopped early, so
// a failed start still leaves the conversation to read.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function writeRealReport(dir, R) {
  mkdirSync(dir, { recursive: true });
  const L = [];
  L.push(`# Real-agent play test: ${R.agent}`, '');
  if (R.fatal) L.push(`**Stopped:** ${R.fatal.split('\n')[0]}`, '');
  if (R.verdict) L.push(`**${R.verdict}**${R.cost ? ` · model cost about $${R.cost.toFixed(2)}` : ''} · ${R.toolCalls ?? 0} tool calls`, '');
  L.push('## Steps', '', '| Step | Passed | What happened |', '|---|---|---|');
  for (const s of R.steps || []) L.push(`| ${s.name} | ${s.ok ? 'yes' : '**no**'} | ${cell(s.note)} |`);
  L.push('', '## Seconds', '', '| Wait | Seconds |', '|---|---|');
  for (const [k, v] of Object.entries(R.times || {})) L.push(`| ${k} | ${v} |`);
  L.push('', '(Times named "since start" are from the first message; the others from the newcomer\'s own press.)', '');
  L.push('## Questions the agent asked', '');
  if (!(R.questions || []).length) L.push('None.');
  for (const q of R.questions || []) L.push(`- **${q.phase} / ${q.kind}** at ${q.s} s → answered "${q.reply}"`, `  > ${q.text.replace(/\n+/g, ' ').slice(-400)}`);
  L.push('', '## Stumbles (heaviest first)', '');
  if (!(R.stumbles || []).length) L.push('None noticed by the script.');
  for (const s of [...(R.stumbles || [])].sort((a, b) => b.w - a.w)) L.push(`- (${s.w}) ${s.text} — at ${s.s} s`);
  L.push('', '## Notes', '', ...(R.notes || []).map((n) => `- ${n}`));
  if (R.leftover?.length) L.push(`- still running at the end (stopped by the play test): ${R.leftover.map((l) => `\`${l}\``).join(', ')}`);
  L.push('', '## Video and pictures', '');
  if (R.video?.path) L.push(`- [${R.agent}.mp4](${R.agent}.mp4) (${(R.video.bytes / 1e6).toFixed(1)} MB, ${R.video.seconds} s recorded; waits over 6 s are shortened in the video)`);
  else if (R.video?.error) L.push(`- no video: ${R.video.error}`);
  for (const s of R.shots || []) if (s.file) L.push('', `**${s.caption}**`, '', `![${s.caption.replace(/[[\]]/g, '')}](${s.file})`);
  L.push('', '## What the editor said, over time', '', '| s | AI line | dot | frames | rows | violet | text |', '|---|---|---|---|---|---|---|');
  for (const e of R.timeline || []) L.push(`| ${e.s} | ${e.ph} | ${e.peer} | ${e.frames} | ${e.rows} | ${e.marked} | ${cell(e.text)} |`);
  L.push('', 'The whole conversation: [transcript.md](transcript.md)', '');
  writeFileSync(join(dir, 'report.md'), L.join('\n'));

  const T = [`# Transcript: ${R.agent}`, '', 'user = the newcomer (the play test), agent = what the AI said, tool = what it ran.', ''];
  for (const l of R.transcript || []) {
    const text = l.who === 'agent' || l.who === 'user' ? l.text : l.text.slice(0, 400);
    T.push(`**${l.s.toFixed(1)} s · ${l.who}**`, '', l.who === 'tool' || l.who === 'tool-error' ? '```\n' + text + '\n```' : text, '');
  }
  writeFileSync(join(dir, 'transcript.md'), T.join('\n'));
}

const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
