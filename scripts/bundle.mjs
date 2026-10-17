// A tiny, zero-dependency bundler for the studio's TypeScript sources.
//
// WHY this exists instead of esbuild/rollup: the plugin must install with
// nothing but Node (people add it to Claude Code or Codex and run it right
// away), and contributors should be able to rebuild it the same way. Node
// >= 22.13 ships `module.stripTypeScriptTypes`, so the only missing piece is
// joining ES modules into one file. That is all this does.
//
// Supported source subset (the build fails loudly on anything else, so a
// mistake shows up at build time, not in someone's game):
// - Erasable TypeScript only (no enum / namespace / parameter properties).
// - Relative imports with an explicit extension: `import { a, b as c } from './x.ts'`,
//   `import * as ns from './x.ts'`. Type-only imports must use `import type`.
// - Side-effect imports: `import './x.ts'`.
// - `export function|class|const|let|async function NAME`, `export { a, b as c }`,
//   `export { a } from './x.ts'`, `export * from './x.ts'`.
// - No default exports, no dynamic import of local files, no import cycles.
// - In `esm` format, `node:` built-ins may be imported (hoisted as real imports).
//
// Imports become plain bindings to the dependency's exports object, so they
// are not live: do not reassign exported `let` variables from outside.
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

// stripTypeScriptTypes prints an "experimental" warning on every build; it is
// expected (the API is the reason this bundler needs no dependencies).
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  if (String(warning).includes('stripTypeScriptTypes')) return;
  return emitWarning.call(process, warning, ...rest);
};

const IMPORT_RE = /^[ \t]*import\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]\s*;?/gm;
const SIDE_IMPORT_RE = /^[ \t]*import\s*['"]([^'"]+)['"]\s*;?/gm;
const EXPORT_FROM_RE = /^[ \t]*export\s+(type\s+)?(\*|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]\s*;?/gm;
const EXPORT_LIST_RE = /^[ \t]*export\s+(type\s+)?\{([\s\S]*?)\}\s*;?/gm;
const EXPORT_DECL_RE = /^([ \t]*)export\s+((?:async\s+)?function\*?\s+([A-Za-z_$][\w$]*)|class\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*))/gm;

function fail(file, msg) {
  throw new Error(`bundle: ${file}: ${msg}`);
}

/** Strip TypeScript (keeps line/column positions: types become spaces). */
function strip(file, src) {
  if (!file.endsWith('.ts')) return src;
  try {
    return stripTypeScriptTypes(src, { mode: 'strip' });
  } catch (e) {
    fail(file, `TypeScript that cannot be erased: ${e.message}`);
  }
}

function parseSpecifiers(file, list) {
  // "a, b as c" -> [['a','a'], ['b','c']]  (imported, local)
  return list.replace(/[{}]/g, '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    if (s.startsWith('type ')) return null; // inline `type X` specifier: erased
    const m = s.match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
    if (!m) fail(file, `unsupported import/export specifier "${s}"`);
    return [m[1], m[2] || m[1]];
  }).filter(Boolean);
}

/**
 * Bundle `entry` into one script.
 * @param {string} entry absolute path
 * @param {{ format: 'iife' | 'esm', globalName?: string, banner?: string }} opts
 * @returns {{ code: string, files: string[] }}
 */
export function bundle(entry, opts) {
  const format = opts.format;
  const modules = new Map(); // abs path -> { id, code }
  const order = [];
  const nodeImports = new Map(); // 'node:fs' -> alias
  const visiting = new Set();
  const root = dirname(entry);

  function load(file, from) {
    if (modules.has(file)) return modules.get(file).id;
    if (visiting.has(file)) fail(from, `import cycle through ${relative(root, file)}`);
    visiting.add(file);
    let src;
    try {
      src = readFileSync(file, 'utf8');
    } catch {
      fail(from, `cannot read ${file}`);
    }
    let code = strip(file, src);
    const exportsList = []; // [exportedName, expression]
    const pre = [];

    const dep = (spec) => {
      if (spec.startsWith('node:')) {
        if (format !== 'esm') fail(file, `node built-in "${spec}" in a browser bundle`);
        return null;
      }
      if (!spec.startsWith('.')) fail(file, `bare import "${spec}" (no dependencies allowed)`);
      if (!/\.(ts|js|mjs)$/.test(spec)) fail(file, `import "${spec}" needs an explicit .ts/.js extension`);
      return load(resolve(dirname(file), spec), file);
    };
    const nodeAlias = (spec) => {
      if (!nodeImports.has(spec)) nodeImports.set(spec, `__node_${nodeImports.size}`);
      return nodeImports.get(spec);
    };

    code = code.replace(EXPORT_FROM_RE, (_m, isType, what, spec) => {
      if (isType) return '';
      const id = dep(spec);
      if (what === '*') {
        pre.push(`__star(__exports, __require(${id}));`);
      } else {
        for (const [imp, loc] of parseSpecifiers(file, what)) exportsList.push([loc, `__require(${id}).${imp}`]);
      }
      return '';
    });
    // Side-effect imports first: IMPORT_RE would otherwise read `import './a.js';\n import { b } from …`
    // as one statement.
    code = code.replace(SIDE_IMPORT_RE, (_m, spec) => {
      if (spec.startsWith('node:')) {
        nodeAlias(spec);
        return '';
      }
      return `__require(${dep(spec)});`;
    });
    code = code.replace(IMPORT_RE, (_m, isType, what, spec) => {
      if (isType) return '';
      what = what.trim();
      const ns = what.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (spec.startsWith('node:')) {
        if (format !== 'esm') fail(file, `node built-in "${spec}" in a browser bundle`);
        const alias = nodeAlias(spec);
        if (ns) return `const ${ns[1]} = ${alias};`;
        if (!what.startsWith('{')) fail(file, `default import from "${spec}"; use { named } imports`);
        const parts = parseSpecifiers(file, what);
        return parts.length ? `const { ${parts.map(([i, l]) => (i === l ? i : `${i}: ${l}`)).join(', ')} } = ${alias};` : '';
      }
      const id = dep(spec);
      if (ns) return `const ${ns[1]} = __require(${id});`;
      if (!what.startsWith('{')) fail(file, `default import "${what}" (use named exports)`);
      const parts = parseSpecifiers(file, what);
      return parts.length ? `const { ${parts.map(([i, l]) => (i === l ? i : `${i}: ${l}`)).join(', ')} } = __require(${id});` : `__require(${id});`;
    });
    code = code.replace(EXPORT_LIST_RE, (_m, isType, list) => {
      if (isType) return '';
      for (const [loc, exp] of parseSpecifiers(file, list)) exportsList.push([exp, loc]);
      return '';
    });
    code = code.replace(EXPORT_DECL_RE, (_m, indent, decl, fn, cls, v) => {
      const name = fn || cls || v;
      exportsList.push([name, name]);
      return indent + decl;
    });
    if (/^[ \t]*export\s+default\b/m.test(code)) fail(file, 'default export (use named exports)');
    if (/^[ \t]*export\s+(const|let|var)\s*[{[]/m.test(code)) fail(file, 'destructuring export');
    if (/^[ \t]*export\s/m.test(code)) fail(file, 'unsupported export form');
    if (/\bimport\s*\(\s*['"]\.\.?\//.test(code)) fail(file, 'dynamic import of a local file');
    if (/^[ \t]*import\s/m.test(code)) fail(file, 'unsupported import form');

    const id = modules.size;
    // Getters keep exported functions/classes usable even though bindings are
    // copied: the defineProperty runs after the module body, and since there
    // are no cycles every importer runs after this module finished.
    const tail = exportsList.map(([name, expr]) => `__def(__exports, ${JSON.stringify(name)}, () => ${expr});`).join('\n');
    const body = `// ${relative(root, file) || file}\n${pre.join('\n')}\n${code}\n${tail}`;
    modules.set(file, { id, code: body });
    visiting.delete(file);
    order.push(file);
    return id;
  }

  const entryId = load(resolve(entry), entry);
  const runtime = [
    'const __defs = [];',
    'const __cache = [];',
    'function __def(o, k, get) { Object.defineProperty(o, k, { get, enumerable: true }); }',
    'function __star(o, src) { for (const k of Object.keys(src)) if (!(k in o)) __def(o, k, () => src[k]); }',
    'function __require(id) {',
    '  if (__cache[id]) return __cache[id];',
    '  const __exports = (__cache[id] = {});',
    '  __defs[id](__exports);',
    '  return __exports;',
    '}',
  ].join('\n');
  const mods = order
    .map((f) => modules.get(f))
    .sort((a, b) => a.id - b.id)
    .map((m) => `__defs[${m.id}] = function (__exports) {\n'use strict';\n${m.code}\n};`)
    .join('\n');
  const banner = opts.banner ? `${opts.banner}\n` : '';
  if (format === 'iife') {
    const assign = opts.globalName ? `globalThis[${JSON.stringify(opts.globalName)}] = ` : '';
    return { code: `${banner}(() => {\n${runtime}\n${mods}\n${assign}__require(${entryId});\n})();\n`, files: order };
  }
  const nodeHead = [...nodeImports].map(([spec, alias]) => `import * as ${alias} from '${spec}';`).join('\n');
  const entryExports = Object.keys(simulateExportNames(modules.get(resolve(entry)).code));
  const reexport = entryExports.length
    ? `const __entry = __require(${entryId});\n${entryExports.map((n) => `export const ${n} = __entry.${n};`).join('\n')}\n`
    : `__require(${entryId});\n`;
  return { code: `${banner}${nodeHead}\n${runtime}\n${mods}\n${reexport}`, files: order };
}

/** Names the entry module exports (read back from the generated __def calls). */
function simulateExportNames(code) {
  const out = {};
  for (const m of code.matchAll(/__def\(__exports, "([^"]+)"/g)) out[m[1]] = true;
  return out;
}
