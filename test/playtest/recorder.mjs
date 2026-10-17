// Recording for the play test: a video of one run (CDP screencast frames ->
// ffmpeg mp4), named screenshots, and a clock that keeps "how long did the
// person wait" apart from the pauses the script adds to look human.
//
// WHY screencast and not a screen recorder: the browser is headless and has no
// screen. Page.startScreencast sends a JPEG each time the page repaints (none
// while nothing changes), with a timestamp; ffmpeg's concat demuxer turns that
// list into a video where each frame stays up exactly until the next one, so
// waits in the video are real waits. No new packages: ffmpeg is the only extra
// and it is optional (no ffmpeg = no video, the rest of the report still works).
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** True when an ffmpeg with libx264 is on the PATH (or in STUDIO_FFMPEG). */
export function ffmpegBin() {
  const bin = process.env.STUDIO_FFMPEG || 'ffmpeg';
  const r = spawnSync(bin, ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  return r.status === 0 && /libx264/.test(r.stdout) ? bin : null;
}

/**
 * Start recording `page`. Returns { stop(mp4Path) } — stop() encodes the frames
 * and returns { path, bytes, seconds } or { error }.
 * maxWidth / maxHeight keep the frames (and the mp4) small: the video is for
 * seeing what happened, the PNG screenshots are for detail.
 */
export async function startVideo(page, { maxWidth, maxHeight, minGapMs = 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'studio-playtest-frames-'));
  const frames = [];
  const off = page.onEvent('Page.screencastFrame', (p) => {
    // minGapMs: keep at most one frame per gap (a 15-minute run of an animated 3D game at 60 fps would be ~50k
    // JPEGs). Every frame is still acknowledged, or Chrome stops sending.
    const ts = p.metadata.timestamp || Date.now() / 1000;
    if (minGapMs && frames.length && (ts - frames[frames.length - 1].t) * 1000 < minGapMs) {
      page.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
      return;
    }
    const file = join(dir, `f${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(p.data, 'base64'));
    frames.push({ file, t: p.metadata.timestamp || Date.now() / 1000 });
    page.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  });
  await page.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth, maxHeight, everyNthFrame: 1 });
  const started = Date.now() / 1000;
  return {
    async stop(mp4) {
      await page.send('Page.stopScreencast').catch(() => {});
      off();
      const ended = Date.now() / 1000;
      try {
        const bin = ffmpegBin();
        if (!bin) return { error: 'no ffmpeg with libx264 on the PATH (set STUDIO_FFMPEG)' };
        if (frames.length < 2) return { error: `only ${frames.length} frame(s) captured` };
        // concat list: each frame lasts until the next one; the last one 1 s.
        // A single wait longer than 6 s is cut to 6 s so the video stays short;
        // the real number is in the report's timing table.
        const lines = [];
        frames.forEach((f, i) => {
          const next = i + 1 < frames.length ? frames[i + 1].t : Math.min(f.t + 1, ended);
          const d = Math.min(6, Math.max(0.02, next - f.t));
          lines.push(`file '${f.file}'`, `duration ${d.toFixed(3)}`);
        });
        lines.push(`file '${frames[frames.length - 1].file}'`);
        const list = join(dir, 'list.txt');
        writeFileSync(list, lines.join('\n') + '\n');
        // crf 30 / 15 fps: a few MB for a 1-2 minute run. Raised once if it is still over 10 MB.
        for (const crf of [30, 36]) {
          const r = spawnSync(bin, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list,
            '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=15', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(crf),
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4], { encoding: 'utf8' });
          if (r.status !== 0) return { error: `ffmpeg: ${(r.stderr || '').trim().slice(0, 300)}` };
          const bytes = statSync(mp4).size;
          if (bytes <= 10 * 1024 * 1024 || crf === 36) return { path: mp4, bytes, seconds: Math.round(ended - started), frames: frames.length };
        }
        return { error: 'unreachable' };
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Timing helper. `mark(name)` stores seconds since `t0`; `measure(name, fn)`
 * runs fn and stores how long it took (the person's wait), in seconds.
 */
export function clock(t0 = Date.now()) {
  const marks = [];
  return {
    t0,
    marks,
    mark(name, note = '') {
      const s = (Date.now() - t0) / 1000;
      marks.push({ name, s, kind: 'since start', note });
      return s;
    },
    async measure(name, fn, note = '') {
      const a = Date.now();
      try {
        return await fn();
      } finally {
        marks.push({ name, s: (Date.now() - a) / 1000, kind: 'took', note });
      }
    },
  };
}

/** Screenshot writer for one run: files are numbered in the order taken. */
export function shooter(page, dir, prefix) {
  mkdirSync(dir, { recursive: true });
  let n = 0;
  const taken = [];
  return {
    taken,
    async shot(name, caption = '') {
      n += 1;
      const file = `${prefix}-${String(n).padStart(2, '0')}-${name}.jpg`;
      try {
        // JPEG 80: ~150 KB instead of ~800 KB PNG per 3D frame; dozens are committed per run.
        const r = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
        writeFileSync(join(dir, file), Buffer.from(r.data, 'base64'));
        taken.push({ file, caption });
      } catch (e) {
        taken.push({ file: null, caption: `${caption} (screenshot failed: ${e.message})` });
      }
      return file;
    },
  };
}
