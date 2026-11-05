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
/** Wide only in stage 1 (Tall, a 9:16 window given to the game while recording, is stage 2). */
export const CLIP_WIDE = { w: 1280, h: 720 } as const;
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
}

/** A hand-edited or older prefs file reads as the defaults for anything it does not say right. */
export function normalizeClipPrefs(raw: unknown): ClipPrefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const seconds = CLIP_LENGTHS.includes(r.seconds as ClipLength) ? (r.seconds as ClipLength) : CLIP_DEFAULT_LENGTH;
  const mark = typeof r.mark === 'boolean' ? r.mark : CLIP_MARK_DEFAULT;
  return { seconds, mark };
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
export function postText(o: { game: string; seconds: number; mark: boolean }): string {
  const game = o.game.trim().replace(/\s+/g, ' ').slice(0, 60);
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

/** Why a clip could not be made, as the bridge says it (one line each in the editor's words). */
export type ClipRefusal = 'webgpu' | 'tainted' | 'no-encoder' | 'nothing' | 'failed';

/** "0:03" on the button while recording (whole seconds go up as the clip goes on). */
export function recClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
