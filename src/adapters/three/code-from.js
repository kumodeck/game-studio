// Where in the game's code an object came from (pause-ask stage 2, 2026-11-02; the `from` hint of the handoff). Decided
// 2026-11-02: the AI should judge "from the code AND from the picture" what is going on in the paused
// moment. The picture it already gets; this is the code's half: boot.js keeps an Error from the moment the game first
// added each object (Object3D.prototype.add), and this reads its stack for the first line that is the GAME's — not
// Game Studio's own scripts (/__studio/), not three.js, not a package (node_modules, a bundler's deps), not another
// origin (a CDN). That line is "the code that put this object in the scene": a boss spawned in src/boss.js:42.
//
// A HINT, never a fact the editor acts on: the add may be in a helper ("addToScene(o)" in src/util.js), a bundled game
// has one big file, a minified one has line 1. The request says "from" and the AI opens it and looks; wrong is harmless,
// absent is fine (the AI searches by the object's key, as before). Plain JS, no imports: test/code-from.test.mjs.

/** Library / tooling files that are never "the game's line". */
const NOT_GAME = /(^|\/)(__studio|node_modules|@vite|@fs|@id)\/|(^|\/)three(\.module|\.core|\.webgpu|\.cjs)?(\.min)?\.js$|(^|\/)(OrbitControls|GLTFLoader|BufferGeometryUtils)\.js$/;

/**
 * The game's first frame in `stack` (an Error's stack text, Chrome / Safari / Firefox forms), as a path inside the game
 * folder and a line: { file: 'src/boss.js', line: 42 }, or null.
 * @param {string} stack
 * @param {string} origin  the page's origin ("http://localhost:5173"): only its files are the game's
 */
export function codeFromStack(stack, origin) {
  if (typeof stack !== 'string' || !stack) return null;
  const lines = stack.split('\n');
  for (const l of lines) {
    const m = /((?:https?|file):\/\/[^\s()@]+?):(\d+)(?::(\d+))?\)?\s*$/.exec(l.trim());
    if (!m) continue;
    let u;
    try {
      u = new URL(m[1]);
    } catch {
      continue;
    }
    if (origin && u.origin !== origin) continue;
    let file;
    try {
      file = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    } catch {
      continue;
    }
    if (!file || NOT_GAME.test(file) || file.split('/').some((seg) => seg.startsWith('.') || seg === '..')) continue;
    const line = Number(m[2]);
    if (!Number.isInteger(line) || line < 1) continue;
    return { file: file.slice(0, 200), line };
  }
  return null;
}

/**
 * The code place of `obj` or the nearest of its parents that the game added itself (the key may be a mesh inside the
 * group the game added). `addedAt` = boot.js's WeakMap of Errors.
 */
export function codeFromObject(obj, addedAt, origin) {
  for (let o = obj, i = 0; o && i < 8; o = o.parent, i++) {
    const err = addedAt && addedAt.get(o);
    if (!err) continue;
    const at = codeFromStack(err.stack, origin);
    if (at) return at;
  }
  return null;
}
