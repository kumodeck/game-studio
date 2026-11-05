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

/**
 * How long a CLI waits for the page's answer while the page says nothing (a page that never got the job, or is gone).
 * A page that has the job says "still on it" every HANDS_BEAT_MS (host-local.ts hands), and each beat gives it this
 * long again, up to HANDS_MAX_MS in all.
 *
 * WHY beats (decided 2026-11-05): a fixed 20 s was shorter than the editor's own waits for one job — up to 12 s for the
 * game to be listed (ai-hands.ts READY_WAIT_MS) and up to 15 s for the game read again (main.ts reloadGame: place.code
 * of a codePlace the page does not list yet, motion.code, a fold) — so on a slow or busy computer the CLI said "did
 * not answer; nothing was changed" while the page went on and did it a few seconds later (seen in the torule screen
 * test under load 50+). A longer fixed number would only move the edge; the page knows when it is still working.
 */
export const HANDS_WAIT_MS = 20_000;
/** The page's "still on it" beat (host-local.ts sends it this often while a job runs or waits its turn). */
export const HANDS_BEAT_MS = 5000;
/** The most a CLI waits for one job, beats or not: a page stuck inside a job still ends with an answer. */
export const HANDS_MAX_MS = 120_000;
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
    /**
     * Send a job to the newest page; resolves to its answer, null when it said nothing for `ms`, or { working: true }
     * when it was still on the job at `max`.
     */
    send(job, ms = HANDS_WAIT_MS, max = HANDS_MAX_MS) {
      const p = pages[pages.length - 1];
      if (!p) return Promise.resolve(null);
      const id = crypto.randomBytes(8).toString('hex');
      return new Promise((resolve) => {
        const end = Date.now() + Math.max(ms, max);
        const w = { resolve, timer: null, ms, end, beats: 0 };
        w.timer = setTimeout(() => {
          waiting.delete(id);
          resolve(null);
        }, ms);
        waiting.set(id, w);
        p.res.write(`event: job\ndata: ${JSON.stringify({ ...job, id })}\n\n`);
      });
    },
    /**
     * POST /__studio/api/hands/<id> from the page: its answer, or `{ working: true }` = "still on it" (the wait starts
     * again, never past the job's end). false = no CLI waits for it (late, or unknown).
     */
    answer(id, result) {
      const w = waiting.get(id);
      if (!w) return false;
      if (result && result.working === true) {
        clearTimeout(w.timer);
        w.beats++;
        // Past the job's end the page was still on it: { working: true } (server.mjs says so instead of "no answer").
        w.timer = setTimeout(() => {
          waiting.delete(id);
          w.resolve({ working: true });
        }, Math.max(0, Math.min(w.ms, w.end - Date.now())));
        return true;
      }
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
