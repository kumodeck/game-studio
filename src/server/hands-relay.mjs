// The relay between the AI's `--do` and the editor page that is open (studio-ai-hands, 2026-10-24; CONTRACT.md §3.6).
//
// The editor page keeps one Server-Sent Events stream open (GET /__studio/api/hands). `studio.mjs <game> --do …` posts
// its ops to POST /__studio/hands with the folder's secret; the newest open page gets them as one `job` event, does them
// in the editor (on screen, one ⌘Z, counted on Save · n) and posts what happened back to /__studio/api/hands/<id>; that
// answer is the CLI's answer. No page open = { editor: false }: the CLI then writes placement.json itself.
//
// WHY a stream and not the status poll the page already runs (every 0.7–3 s): the poll stops while the tab is hidden,
// and a browser window under the Claude app counts as hidden in Chrome (window occlusion). The AI's op would wait until
// the person looked. A stream's events arrive in a hidden tab at once. WHY the newest page only: the same editor open
// twice (two tabs) would do the op twice; the newest is the one the person just opened or reloaded.
import crypto from 'node:crypto';

/** How long a CLI waits for the page's answer (a copy waits for the game page; 20 s is far beyond a busy page). */
export const HANDS_WAIT_MS = 20_000;
/** A page whose stream just dropped (a reload, a blip) gets this long to come back before the CLI writes the file. */
const HANDS_GRACE_MS = 6000;
const HANDS_PING_MS = 15_000;

export function createHandsRelay() {
  /** @type {Array<{ res: import('node:http').ServerResponse, at: number, ping: NodeJS.Timeout }>} */
  const pages = [];
  const waiting = new Map();
  let droppedAt = 0;

  function drop(p) {
    clearInterval(p.ping);
    const i = pages.indexOf(p);
    if (i >= 0) pages.splice(i, 1);
    droppedAt = Date.now();
  }

  return {
    /** GET /__studio/api/hands from the editor page: the stream it is sent jobs on. */
    open(req, res) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      // retry: the browser's EventSource comes back by itself after a drop (a sleep, the server restarted).
      res.write('retry: 2000\n\n');
      const p = { res, at: Date.now(), ping: setInterval(() => res.write(': ping\n\n'), HANDS_PING_MS) };
      pages.push(p);
      req.on('close', () => drop(p));
    },
    /** Is a page open now — or was one a moment ago and may be back soon (then wait for it)? */
    async ready() {
      if (pages.length) return true;
      const end = droppedAt + HANDS_GRACE_MS;
      while (!pages.length && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
      return pages.length > 0;
    },
    /** Send a job to the newest page; resolves to its answer, or null when it did not answer in `ms`. */
    send(job, ms = HANDS_WAIT_MS) {
      const p = pages[pages.length - 1];
      if (!p) return Promise.resolve(null);
      const id = crypto.randomBytes(8).toString('hex');
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          resolve(null);
        }, ms);
        waiting.set(id, { resolve, timer });
        p.res.write(`event: job\ndata: ${JSON.stringify({ ...job, id })}\n\n`);
      });
    },
    /** POST /__studio/api/hands/<id> from the page: its answer. false = no CLI waits for it (late, or unknown). */
    answer(id, result) {
      const w = waiting.get(id);
      if (!w) return false;
      clearTimeout(w.timer);
      waiting.delete(id);
      w.resolve(result);
      return true;
    },
    close() {
      for (const p of pages.slice()) {
        clearInterval(p.ping);
        p.res.end();
      }
      pages.length = 0;
      for (const w of waiting.values()) (clearTimeout(w.timer), w.resolve(null));
      waiting.clear();
    },
  };
}
