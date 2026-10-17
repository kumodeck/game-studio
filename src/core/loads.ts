// Load log: which files the game actually loaded while it ran.
//
// The library uses this to mark assets as "loaded while playing" versus
// "only mentioned in code" or "unused", and adapters use the order of loads
// to guess which model file an object came from.
//
// WHY PerformanceObserver first: the Resource Timing buffer sees every network
// load the page makes — <img>, CSS url(), fetch, XHR, <audio>, scripts, font
// files — no matter which API the game or its engine used, and `buffered: true`
// also returns loads that started before this script. Wrapping fetch/XHR on top
// only adds the success flag (Resource Timing has no reliable status before
// Chrome 109 and none at all for opaque responses).
// data: and blob: URLs never appear; they are not files in the game folder.
import type { LoadEntry, LoadLog } from '../contract.ts';

const MAX_ENTRIES = 5000;

function howFromInitiator(t: string): LoadEntry['how'] {
  switch (t) {
    case 'img':
    case 'image':
    case 'input':
      return 'image';
    case 'css':
    case 'link':
      return 'css';
    case 'fetch':
      return 'fetch';
    case 'xmlhttprequest':
      return 'xhr';
    case 'script':
      return 'script';
    case 'audio':
    case 'video':
      return 'audio';
    default:
      return 'other';
  }
}

export function installLoads(win: Window & typeof globalThis = window): LoadLog {
  const list: LoadEntry[] = [];
  const byUrl = new Map<string, LoadEntry>();
  const subs = new Set<(e: LoadEntry) => void>();

  function add(url: string, how: LoadEntry['how'], ok?: boolean): void {
    let abs: string;
    try {
      abs = new URL(url, win.location.href).href;
    } catch {
      return;
    }
    if (abs.startsWith('data:') || abs.startsWith('blob:')) return;
    // The studio's own files are not game assets. The local server serves them
    // at /__studio/; the web demo (src/hosts/browser) at <site>/__studio/, and
    // the site may live under a sub-path, so any /__studio/ segment counts.
    if (new URL(abs).pathname.includes('/__studio/')) return;
    const known = byUrl.get(abs);
    if (known) {
      if (ok !== undefined) known.ok = ok;
      // Prefer the more specific kind (e.g. image over other).
      if (known.how === 'other' && how !== 'other') known.how = how;
      return;
    }
    if (list.length >= MAX_ENTRIES) return;
    const e: LoadEntry = { url: abs, how, t: Math.round(win.performance.now()), ok };
    list.push(e);
    byUrl.set(abs, e);
    for (const cb of subs) {
      try {
        cb(e);
      } catch {
        /* a broken listener must not break the game's loading */
      }
    }
  }

  try {
    const po = new win.PerformanceObserver((l) => {
      for (const r of l.getEntries() as PerformanceResourceTiming[]) {
        const status = (r as PerformanceResourceTiming & { responseStatus?: number }).responseStatus;
        add(r.name, howFromInitiator(r.initiatorType), status ? status < 400 : undefined);
      }
    });
    po.observe({ type: 'resource', buffered: true });
  } catch {
    /* very old browsers: fall back to the wrappers below only */
  }

  const realFetch = win.fetch;
  if (typeof realFetch === 'function') {
    win.fetch = function fetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      add(url, 'fetch');
      return realFetch.call(win, input, init).then(
        (res) => {
          add(url, 'fetch', res.ok);
          return res;
        },
        (err) => {
          add(url, 'fetch', false);
          throw err;
        },
      );
    } as typeof win.fetch;
  }

  const XHR = win.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    XHR.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      const u = String(url);
      add(u, 'xhr');
      this.addEventListener('loadend', () => add(u, 'xhr', this.status > 0 && this.status < 400));
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XHR.prototype.open;
  }

  return {
    entries: () => list.slice(),
    on(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}
