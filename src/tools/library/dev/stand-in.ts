// TEST DOUBLE for the dev harness only — not shipped.
//
// Stands in for the real edit script (src/bridge + src/core + adapters)
// inside the game iframe, just far enough to exercise the library tool:
// - finds the engine roots through the same public hooks the adapters use
//   (three.js `__THREE_DEVTOOLS__`, PixiJS `__PIXI_APP_INIT__`),
// - answers studio:library/assets with the browser's resource timing list
//   (instead of src/core's load log) and object -> files from in-game.ts,
// - applies studio:library/preview with in-game.ts (the real code),
// - remembers studio:placement/select so the harness can show it.
//
// It must load before the game code; the dev server injects it as the first
// script of <head>.

import type { AssetRef, LoadEntry } from '../../../contract.ts';
import { assetsFromScene, previewImage } from '../in-game.ts';

type Any = Record<string, any>;

const roots: Any[] = [];
const g = globalThis as Any;

// three.js: the engine dispatches 'observe' with each Scene and renderer it creates.
const devtools = new EventTarget();
devtools.addEventListener('observe', (e) => {
  const o = (e as CustomEvent).detail;
  if (o?.isScene && !roots.includes(o)) roots.push(o);
});
g.__THREE_DEVTOOLS__ = devtools;
// PixiJS v8: Application.init calls this with the app.
g.__PIXI_APP_INIT__ = (app: Any) => {
  if (app?.stage && !roots.includes(app.stage)) roots.push(app.stage);
};

function loads(): LoadEntry[] {
  return (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).map((r) => {
    const status = (r as Any).responseStatus as number | undefined;
    const how: LoadEntry['how'] = r.initiatorType === 'img' ? 'image' : r.initiatorType === 'fetch' ? 'fetch'
      : r.initiatorType === 'xmlhttprequest' ? 'xhr' : r.initiatorType === 'audio' || r.initiatorType === 'video' ? 'audio'
        : r.initiatorType === 'css' ? 'css' : r.initiatorType === 'script' ? 'script' : 'other';
    return { url: r.name, how, t: r.startTime, ok: status ? status < 400 : undefined };
  });
}

/** Top-level objects of each root, keyed like the adapters do (name/label, else a path). */
function uses(): Record<string, AssetRef[]> {
  const out: Record<string, AssetRef[]> = {};
  roots.forEach((root, ri) => {
    (root.children as Any[]).forEach((o, i) => {
      const key = (o.name || o.label || `path:${ri}/${i}`) as string;
      const refs = assetsFromScene(o);
      if (refs.length) out[key] = refs;
    });
  });
  return out;
}

const parentOrigin = new URLSearchParams(location.search).get('studioParent') || location.origin;

addEventListener('message', async (e) => {
  if (e.source !== parent || e.origin !== parentOrigin) return;
  const m = e.data as Any;
  if (!m || typeof m.type !== 'string') return;
  if (m.type === 'studio:library/assets') {
    parent.postMessage({ type: 'studio:library/assets', loads: loads(), uses: uses() }, parentOrigin);
  } else if (m.type === 'studio:library/preview') {
    const n = await previewImage(roots, String(m.url), m.to == null ? null : String(m.to)).catch(() => 0);
    parent.postMessage({ type: 'studio:library/previewed', url: m.url, ok: n > 0 }, parentOrigin);
  } else if (m.type === 'studio:placement/select') {
    g.__studioSelected = m.key;
    parent.postMessage({ type: 'studio:placement/selected', key: m.key }, parentOrigin);
  }
});
