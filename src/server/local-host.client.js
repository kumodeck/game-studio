// The local implementation of the host interface (contract 3), used by the editor shell in the
// browser. The server serves this file at /__studio/host.js.
//
// Every place the editor can run (this local server now, a hosted version later) provides the same
// six methods; only this file knows that "local" means plain HTTP calls to the server that served
// the page. Authentication is the session cookie the server set when the page was opened with the
// one-time pass, so nothing secret appears in this file or in the shell.

const API = '/__studio/api';

async function call(method, url, body, headers) {
  const res = await fetch(url, { method, body, headers, cache: 'no-store', credentials: 'same-origin' });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON error page (for example a proxy); fall through with data = null.
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `HTTP ${res.status}`);
    err.status = res.status;
    err.details = data && data.details;
    throw err;
  }
  return data;
}

/** @returns {import('../contract').StudioHost & { listMissing(): Promise<object[]>, nextStep(id: string): Promise<{ ok: boolean }>, lanQrUrl(): string | null }} */
export function createLocalHost() {
  let lan = null;
  return {
    /** Where the game is and which origin its messages come from. */
    async open() {
      const r = await call('GET', `${API}/open`);
      lan = r.lanUrl || null;
      return { gameUrl: r.gameUrl, origin: r.origin };
    },

    /** The current placement.json / library.json, or null when there is none (or it is invalid). */
    async load(tool) {
      const r = await call('GET', `${API}/files/${encodeURIComponent(tool)}`);
      return r.value;
    },

    /** Validate and write. Never throws for a refused file: the shell shows `error`. */
    async save(tool, json) {
      try {
        const r = await call('PUT', `${API}/files/${encodeURIComponent(tool)}`, JSON.stringify(json), {
          'content-type': 'application/json',
        });
        return { ok: true, path: r.path };
      } catch (e) {
        const details = Array.isArray(e.details) ? `: ${e.details.join('; ')}` : '';
        return { ok: false, error: e.message + details };
      }
    },

    /** Asset files in the folder with the code files that mention each one. */
    async listAssets() {
      const r = await call('GET', `${API}/assets`);
      return r.assets;
    },

    /** URL the shell and the game can load an asset from. */
    assetUrl(p) {
      return '/' + String(p).split('/').map(encodeURIComponent).join('/');
    },

    /** Add a new file under assets/. Never overwrites: a taken name gets "-2", "-3", ... */
    async addAsset(file) {
      const r = await call('POST', `${API}/assets?name=${encodeURIComponent(file.name)}`, file, {
        'content-type': 'application/octet-stream',
      });
      return { path: r.path };
    },

    // ---- Not in the contract yet (proposed): extra data the local server can give cheaply. ----

    /** Names mentioned in code that match no file ("missing" in the library). */
    async listMissing() {
      const r = await call('GET', `${API}/assets`);
      return r.missing;
    },

    /** Hand a "next step" to the agent: writes .studio/next-step.md and prints one line. */
    async nextStep(id) {
      await call('POST', `${API}/next-step`, JSON.stringify({ id }), { 'content-type': 'application/json' });
      return { ok: true };
    },

    /** Hand a request to the AI (contract 3.4): kept as .studio/requests/<id>.json. */
    async request(r) {
      const v = await call('POST', `${API}/request`, JSON.stringify(r), { 'content-type': 'application/json' });
      return { ok: true, id: v.id, at: v.at };
    },

    /** The AI's latest status (.studio/status.json) and when it was written. */
    async status() {
      return call('GET', `${API}/status`);
    },

    /** With --lan: URL of an SVG QR code for opening the editor on a phone. Call open() first. */
    lanQrUrl() {
      return lan ? `${API}/lan-qr.svg` : null;
    },
  };
}
