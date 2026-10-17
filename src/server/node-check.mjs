// Node version check: the first code that runs in studio.mjs (build.mjs puts this module first,
// because cli.mjs imports it before anything else).
//
// WHY: the server uses things older Node does not have (the global WebSocket for --check-view,
// newer fs and Array methods). On an old Node it used to start and then fail with a stack trace
// deep inside, which a person new to Node cannot read. Now it stops at once with one line that
// says what to do. 22.13 = the oldest Node the editor is built and tested with (package.json
// "engines"; scripts/bundle.mjs needs its module.stripTypeScriptTypes).
//
// Keep this file to syntax that Node 14 still parses: if the bundle ever used syntax an old Node
// cannot parse, nothing here would run. (Checked by test/first-run.test.mjs with a real Node 20
// when one is installed.)

export const NODE_MIN = [22, 13];

/** The one line for a too-old Node ("20.20.0"), or null when it is new enough. */
export function nodeTooOld(version) {
  const m = /^v?(\d+)\.(\d+)/.exec(String(version || ''));
  if (!m) return null; // an odd runtime that does not say: let it try
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major > NODE_MIN[0] || (major === NODE_MIN[0] && minor >= NODE_MIN[1])) return null;
  return `Game Studio needs Node.js ${NODE_MIN[0]}.${NODE_MIN[1]} or later (you have ${String(version).replace(/^v/, '')}). Get the latest LTS at https://nodejs.org, then try again.`;
}

const NODE_TOO_OLD = nodeTooOld(process.versions.node);
if (NODE_TOO_OLD) {
  process.stderr.write(NODE_TOO_OLD + '\n');
  process.exit(1);
}
