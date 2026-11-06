// ● Clip, stage 1 (decided 2026-11-05): the pure rules — how long a clip is, what its file is called, the words of the X
// post that go with it and their count, and the "Made with KUMODeck Game Studio" mark at its end. Unit tests:
// test/clip-model.test.ts. The recording is in the game page (bridge/play-clip.ts), the MP4 box in shell/mp4.ts, the
// button and the line in shell/clip.ts.
//
// WHY a clip at all: a person who made or fixed something in their game wants to show it. Until now the editor had no
// way to turn that into a short video; one press of ● Clip now records the game's own picture (and its HTML UI) for a
// few seconds and saves an MP4 that X takes, with a post they can paste. Nothing is sent anywhere by the editor.

/** The lengths in Clip ⌄ (seconds). 8 s first: long enough for one move, short enough to watch twice on a phone. */
export const CLIP_LENGTHS = [6, 8, 12] as const;
export type ClipLength = (typeof CLIP_LENGTHS)[number];
export const CLIP_DEFAULT_LENGTH: ClipLength = 8;

/** Frames per second recorded: X plays 30 and 60; 30 keeps the encoder well ahead of real time on a laptop without a GPU. */
export const CLIP_FPS = 30;
/** Wide: 16:9, 1280×720 (stage 1). */
export const CLIP_WIDE = { w: 1280, h: 720 } as const;
/**
 * Tall (stage 2, decided 2026-11-05): 9:16, 720×1280 — what a phone shows full screen. Not a crop of the wide picture:
 * while it records, the editor gives the game a 9:16 window (shell.css [data-clip-shape="tall"]), so a game that lays
 * itself out to its window draws tall. 720×1280 and not 1080×1920: level 3.1 (CLIP_CODEC) holds exactly 3600
 * macroblocks a frame = 720×1280, so the same encoder setup serves both shapes, and the software encoder keeps up.
 */
export const CLIP_TALL = { w: 720, h: 1280 } as const;
export type ClipShape = 'wide' | 'tall';
export const CLIP_SHAPES: readonly ClipShape[] = ['wide', 'tall'];
/** The frame size of a shape. */
export function clipSize(shape: ClipShape): { w: number; h: number } {
  return shape === 'tall' ? CLIP_TALL : CLIP_WIDE;
}
/**
 * The shape a press records: the person's choice in Clip ⌄, else Tall on a phone (its window is tall already, and a
 * phone's clip is watched on a phone) and Wide elsewhere (decided 2026-11-05).
 */
export function clipShapeFor(p: Pick<ClipPrefs, 'shape'>, phone: boolean): ClipShape {
  return p.shape ?? (phone ? 'tall' : 'wide');
}
/** H.264 bits per second: ~6 MB for 12 s, far under X's limit (512 MB), sharp enough for small HUD text at 720p. */
export const CLIP_BITRATE = 4_000_000;
/**
 * The H.264 profile and level asked of the browser's encoder: Constrained Baseline, level 3.1 (1280×720 at 30 fps).
 * WHY baseline: every player plays it, X included, and it has no B-frames, so the MP4 needs no composition offsets
 * (shell/mp4.ts writes none). Checked in headless Chrome 153: Baseline / Main / High all encode; 60 frames in 0.6 s.
 */
export const CLIP_CODEC = 'avc1.42E01F';

/**
 * Does the end of a new clip carry the mark ("Made with KUMODeck Game Studio" + the GitHub address, its last second,
 * bottom right, small) and does the post carry the address — until the person chooses for themselves (then their choice
 * is kept, `ClipPrefs.mark`).
 * Default ON (option (a) of the plan, 2026-11-05): a clip that says where it was made lets the people who see it find
 * the editor; one press removes it, with no condition. The default is not final yet: changing it is this one line
 * (people who already chose keep their choice).
 */
export const CLIP_MARK_DEFAULT = true;

/** The mark's two lines (English: the video goes to X, whatever the editor's language). */
export const CLIP_MARK_LINES = ['Made with KUMODeck Game Studio', 'github.com/kumodeck/game-studio'] as const;
/** The address in the post (the same place as the mark's second line). */
export const CLIP_REPO_URL = 'https://github.com/kumodeck/game-studio';
/** The mark is on screen for this last part of the clip (seconds). */
export const CLIP_MARK_SECONDS = 1;

/** X's limit for a post (weighted characters, see xLength). */
export const X_LIMIT = 280;

/** What Clip ⌄ remembers (in the person's editor prefs, .studio/ui/prefs.json; in the browser for the web demo). */
export interface ClipPrefs {
  seconds: ClipLength;
  mark: boolean;
  /** Wide / Tall once chosen in Clip ⌄ (stage 2); absent = by the device (clipShapeFor). */
  shape?: ClipShape;
  /**
   * ● Clip Before / After: the person's own words ("Bring the boss in from here.") on the Before (stage 2). On by
   * default — they say what was asked; off for someone who does not want their words in a video (the plan: "the asked
   * words can be turned off in ⌄").
   */
  words: boolean;
}

/** A hand-edited or older prefs file reads as the defaults for anything it does not say right. */
export function normalizeClipPrefs(raw: unknown): ClipPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const seconds = CLIP_LENGTHS.includes(r.seconds as ClipLength) ? (r.seconds as ClipLength) : CLIP_DEFAULT_LENGTH;
  const mark = typeof r.mark === 'boolean' ? r.mark : CLIP_MARK_DEFAULT;
  const words = typeof r.words === 'boolean' ? r.words : true;
  return { seconds, mark, words, ...(r.shape === 'wide' || r.shape === 'tall' ? { shape: r.shape } : {}) };
}

/** Frames in a clip of `seconds` (whole frames). */
export function clipFrames(seconds: number, fps = CLIP_FPS): number {
  return Math.max(1, Math.round(seconds * fps));
}

/**
 * A clip stopped early (● Clip pressed again): it ends one mark-second after the press, so the mark still gets its whole
 * second — what comes after the press is the game going on, as before. Never longer than it was going to be. On the
 * frame grid (ms; `elapsedMs` = time recorded so far).
 */
export function endAfterStop(elapsedMs: number, endMs: number, fps = CLIP_FPS): number {
  const dt = 1000 / fps;
  return Math.min(endMs, Math.ceil((Math.max(elapsedMs, dt) + CLIP_MARK_SECONDS * 1000) / dt) * dt);
}

/**
 * A stop cut at the PRESS (stage 2, decided 2026-11-05; bridge/play-clip.ts). `nowMs` = the clip's time when the game
 * page reads the stop, `pressMs` = the clip's time of the press (the editor's clock), `liveFrom` = when the game's
 * picture started in the clip (a Before / After's still part comes first), `slot` = the grid slot of the last frame taken.
 * Returns the new end and mark-second, and `drop` = how many frames already taken are past the mark-second's start —
 * those are left out, and the next frame starts the mark's second. WHY: a busy game page took the message seconds late,
 * and a clip ended a second after the MESSAGE (2 s pressed, 4–6 s saved; the screen test failed at a load of 60–75).
 * Only before the mark's second has started (the bridge ignores a stop after that: the clip is nearly over, and its
 * last second is already encoded both ways).
 */
export function cutAtPress(o: { nowMs: number; pressMs: number; liveFrom: number; slot: number; endMs: number; fps?: number }) {
  const fps = o.fps ?? CLIP_FPS;
  const dt = 1000 / fps;
  const pressed = Math.min(o.nowMs, Math.max(o.liveFrom + dt, Number.isFinite(o.pressMs) ? o.pressMs : o.nowMs));
  const endMs = endAfterStop(pressed, o.endMs, fps);
  const tailMs = markStartMs(endMs);
  const tailSlot = Math.round(tailMs / dt);
  return { pressed, endMs, tailMs, tailSlot, drop: Math.max(0, o.slot - tailSlot + 1) };
}

/** When the mark's second starts (ms): one second before the end (a key frame there, so the ends can be swapped). */
export function markStartMs(endMs: number): number {
  return Math.max(0, endMs - CLIP_MARK_SECONDS * 1000);
}

/**
 * The file's name stem from the game's name: "Neon Run" → "neon-run-clip". Only a–z, 0–9 and "-" (a name the X file
 * picker, a phone and every system take as it is); a name with nothing left (one in Japanese script only) → "game-clip". The server
 * adds "-1", "-2"… (never overwrites, src/server/clips.mjs).
 */
export function clipStem(game: string): string {
  const slug = game
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return `${slug || 'game'}-clip`;
}

/** The download's name in the web demo, where there is no folder to look for a free one: the stem and the time. */
export function downloadName(game: string, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${clipStem(game)}-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.mp4`;
}

/**
 * The post that goes with the clip (English, AI-free, so it is there in the web demo too). It names the game and how long
 * the clip is; with the mark on, also where it was made and the address — off, neither (the mark and the address are
 * one switch: never a clip without the mark but with the address, or the other way round). No file place, no folder
 * name, no pass: nothing of this computer.
 */
export function postText(o: { game: string; seconds: number; mark: boolean; say?: PostSay }): string {
  const game = o.game.trim().replace(/\s+/g, ' ').slice(0, 60);
  // Another language (walk 2 △11, decided 2026-11-06): its own words from the editor's table (i18n.ts clip.post.*).
  if (o.say) {
    const what = o.say(game ? 'clip.post.clip' : 'clip.post.clipBare', { game, s: o.seconds });
    return o.mark ? o.say('clip.post.clipMade', { what, url: CLIP_REPO_URL }) : o.say('clip.post.clipPlain', { what });
  }
  // "an 8-second", "a 6-second" (said as "eight", "six").
  const a = /^(8|11|18)(\D|$)/.test(String(o.seconds)) ? 'an' : 'a';
  const what = game ? `${game}: ${a} ${o.seconds}-second clip from my web game` : `${a === 'an' ? 'An' : 'A'} ${o.seconds}-second clip from my web game`;
  return o.mark ? `${what}, made with KUMODeck Game Studio 👇 ${CLIP_REPO_URL}` : `${what} 👇`;
}

// X's own counting (twitter-text, v3 settings): a URL is 23 whatever its length; an emoji is 2 (one joined with ZWJ too);
// these ranges (Latin, common punctuation) are 1 each; everything else (Japanese, Chinese, …) is 2.
const WEIGHT1: Array<[number, number]> = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const URL_RE = /https?:\/\/[^\s]+/g;
const EMOJI_RE = /\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}️?)*/gu;

/** The post's length as X counts it (shown beside it as "96 / 280"). */
export function xLength(text: string): number {
  let n = 0;
  const rest = text.normalize('NFC').replace(URL_RE, () => ((n += 23), '')).replace(EMOJI_RE, () => ((n += 2), ''));
  for (const ch of rest) {
    const c = ch.codePointAt(0)!;
    n += WEIGHT1.some(([a, b]) => c >= a && c <= b) ? 1 : 2;
  }
  return n;
}

// ----- ● Clip Before / After (stage 2, decided 2026-11-05) -----
// After a fix asked from a paused moment (pause-ask stage 3: Before / After, ▶ Try from 0:05.02), one press makes the
// video of it: the frame the person asked from, still, with their mark and their words (Before) → a wipe → the same
// moment with the new code, played (After) → the mark on the last second. Three words at most on screen: "Before",
// "After" and what was asked — a phone's small screen reads that much while it plays.

/** The Before: the asked frame held this long (ms). */
export const BA_BEFORE_MS = 2000;
/** The wipe from Before to After, over the After's first frames (ms). */
export const BA_WIPE_MS = 300;
/**
 * The After (s) at the default length: 7 s of the new code playing, then the mark's second — with the Before, 10 s.
 * Since walk 2 (△10, decided 2026-11-06) the After follows the length chosen in Clip options (baSeconds): it was a
 * fixed 8, so the menu said "8 seconds ✓" while the Before / After just made was 10 s and picking 12 changed nothing.
 */
export const BA_AFTER_SECONDS = 8;
/** What the Before adds to a Before / After (s): said beside the length in Clip options ("Before / After adds 2 s"). */
export const BA_ADDS_SECONDS = BA_BEFORE_MS / 1000;
/** A Before / After's whole length (s) for the length chosen: the 2 s Before, then that length of the After. */
export function baSeconds(length: number): number {
  return BA_ADDS_SECONDS + length;
}
/** The Before's still frames are encoded at this rate (fps): nothing moves, so 10 a second is plenty and quick. */
export const BA_STILL_FPS = 10;
/** The longest asked words drawn on the Before (characters, then "…"): one or two lines on a phone. */
export const BA_WORDS_MAX = 90;

/** "neon-run-before-after" (the server adds "-1", "-2"…). */
export function beforeAfterStem(game: string): string {
  return clipStem(game).replace(/-clip$/, '-before-after');
}

/** The asked words as drawn on the Before: one line, quotes of their own taken off, cut at BA_WORDS_MAX with "…". */
export function baWords(asked: string): string {
  const one = asked.replace(/\s+/g, ' ').trim().replace(/^["“”'‘’「]+|["“”'‘’」]+$/g, '').trim();
  if (!one) return '';
  return one.length > BA_WORDS_MAX ? `${one.slice(0, BA_WORDS_MAX - 1).trimEnd()}…` : one;
}

/**
 * The post that goes with a Before / After (English, no AI): "Paused my game at 0:05, marked a spot and told Claude
 * “bring the boss in from here”. It fixed the code. Before → After 👇 <address>" (the plan's §1). The asked words are
 * cut so the whole post stays within X's 280; `words: false` (the person turned their words off) leaves them out.
 * `marked`: the Before had a mark of theirs. `ai`: the AI's name as the editor says it ("Claude", "Codex", "my AI").
 */
export function beforeAfterPost(o: { time: number; asked: string; mark: boolean; words: boolean; marked: boolean; ai: string; say?: PostSay }): string {
  const s = Math.max(0, Math.floor(o.time));
  const at = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (o.say) return beforeAfterPostSaid({ ...o, at, say: o.say });
  const tail = `It fixed the code. Before → After 👇${o.mark ? ` ${CLIP_REPO_URL}` : ''}`;
  const head = `Paused my game at ${at}${o.marked ? ', marked a spot' : ''}`;
  const plain = `${head} and asked ${o.ai} for a fix. ${tail}`;
  const w = o.words ? baWords(o.asked) : '';
  if (!w) return plain;
  // The words in “ ”, lower-case first letter when it reads as a sentence going on ("told Claude “bring…”").
  let words = w.replace(/[.!。]+$/, '');
  if (/^[A-Z][a-z]/.test(words)) words = words[0]!.toLowerCase() + words.slice(1);
  for (;;) {
    const post = `${head} and told ${o.ai} “${words}”. ${tail}`;
    if (xLength(post) <= X_LIMIT || words.length <= 8) return xLength(post) <= X_LIMIT ? post : plain;
    words = `${words.slice(0, Math.max(1, words.length - 12)).trimEnd()}…`;
  }
}

/**
 * The words of a post in a language other than English (walk 2 △11, decided 2026-11-06): the editor's translate() for
 * the `clip.post.*` keys of its table. Absent = English, written here (the web demo, the tests, an editor in English).
 * WHY: on a Japanese screen the post was English with only the asked words in Japanese ("…told Claude “<their words>”.
 * It fixed the code."); posted as it was, it read as two languages mixed. A person posts in the language they read.
 */
export type PostSay = (key: string, vars: Record<string, string | number>) => string;

/**
 * The Before / After post from the table's words: `clip.post.ba` (with the asked words) or `clip.post.baPlain`, `clip.post.baMarked`
 * for "marked a spot", the address after them with the mark. The same rules as English: the words cut to fit X's 280
 * (most non-Latin characters count 2 there), never the address without the mark.
 */
function beforeAfterPostSaid(o: { at: string; asked: string; mark: boolean; words: boolean; marked: boolean; ai: string; say: PostSay }): string {
  const vars = { at: o.at, ai: o.ai, marked: o.marked ? o.say('clip.post.baMarked', {}) : '' };
  const end = (post: string) => (o.mark ? `${post} ${CLIP_REPO_URL}` : post);
  const plain = end(o.say('clip.post.baPlain', vars));
  const w = o.words ? baWords(o.asked) : '';
  if (!w) return plain;
  let words = w.replace(/[.!\u3002\uff01]+$/u, '');
  for (;;) {
    const post = end(o.say('clip.post.ba', { ...vars, words }));
    if (xLength(post) <= X_LIMIT || words.length <= 4) return xLength(post) <= X_LIMIT ? post : plain;
    words = `${words.slice(0, Math.max(1, words.length - 6)).trimEnd()}…`;
  }
}

// ----- ✦ Rewrite (stage 2, decided 2026-11-05) -----
// The post's words rewritten by the person's AI (a small request, `intent: 'clip-post'`; SKILL.md "Clip post"). The
// AI's reply is checked here before it replaces the post: one line, within X's 280 as X counts, and the address follows
// the mark's one switch whatever the AI wrote (never a post without the mark but with the address, or the other way).

/** The post with the address put right for `mark`: every github.com/kumodeck/game-studio taken out, then one at the end when on. */
export function withAddress(text: string, mark: boolean): string {
  const bare = text
    .replace(/https?:\/\/(www\.)?github\.com\/kumodeck\/game-studio\/?/gi, ' ')
    .replace(/(^|\s)(www\.)?github\.com\/kumodeck\/game-studio\/?/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();
  return mark ? `${bare} ${CLIP_REPO_URL}` : bare;
}

export type RewriteCheck = { ok: true; text: string; n: number } | { ok: false; why: 'empty' | 'long'; n: number };

/** The AI's rewrite, checked: quotes round it taken off, one line, the address per `mark`, at most 280 (X's count). */
export function checkRewrite(reply: string | null | undefined, mark: boolean): RewriteCheck {
  const raw = String(reply ?? '');
  // The status note is cut at 300 characters with "…" (src/schema/handoff.mjs maxNote): a reply cut there was too long.
  if (raw.length >= 299 && raw.endsWith('…')) return { ok: false, why: 'long', n: xLength(raw) };
  const one = raw.replace(/\s+/g, ' ').trim().replace(/^["“”]+(.*?)["“”]+$/, '$1').trim();
  if (!one || one.replace(/https?:\/\/\S+/g, '').trim().length < 3) return { ok: false, why: 'empty', n: 0 };
  const text = withAddress(one, mark);
  const n = xLength(text);
  return n > X_LIMIT ? { ok: false, why: 'long', n } : { ok: true, text, n };
}

/** Why a clip could not be made, as the bridge says it (one line each in the editor's words). */
export type ClipRefusal = 'webgpu' | 'tainted' | 'no-encoder' | 'nothing' | 'failed';

/** "0:03" on the button while recording (whole seconds go up as the clip goes on). */
export function recClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ----- studio-clip-3 (decided 2026-11-06): what is going on while it records, and fewer steps to X -----

/**
 * The time LEFT while recording (ms), for "0:05 left · Stop" and a phone's round ● ("5"). WHY left, not so far: the
 * person pressed for "the next 8 s"; what they want to know is when it ends (stages 1–2 counted up: "0:03 · Stop").
 * `stillMs`: a Before / After's still part, encoded before `started`
 * (it is in the clip's length, not in the time the person waits).
 */
export function recLeftMs(o: { totalMs: number; stillMs?: number; elapsedMs: number }): number {
  return Math.max(0, o.totalMs - (o.stillMs ?? 0) - Math.max(0, o.elapsedMs));
}

/** "0:05" for the time left: whole seconds rounded UP (it says 0:01 until the very end, never 0:00 while recording). */
export function leftClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Holding ● this long opens Clip options (a phone's ● has no ⌄: the bar has no room). Shorter than the system's own
 * long-press menu on most phones, longer than a tap. */
export const CLIP_HOLD_MS = 500;

/**
 * X's compose page with the post written (its public "intent" address; nothing is sent until the person posts there).
 * WHY: from the saved line to a post on X was Copy post → open X → paste → Show in Finder → drag; Post on X… does the
 * first three in one press (and shows the clip in its folder on the computer), so it is one press and one drag. The
 * video itself cannot go in the address: X takes it only from the person (a drag, or the phone's Share…).
 */
export const X_COMPOSE = 'https://x.com/intent/post';
export function xComposeUrl(text: string): string {
  return `${X_COMPOSE}?text=${encodeURIComponent(text)}`;
}
