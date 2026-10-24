// The AI's hands in the editor (studio-ai-hands, 2026-10-24; CONTRACT.md §3.6): the editor's end of
// `studio.mjs <game> --do …`. The local server hands the page a job (host.hands, an event stream); this does each op
// with the editor's own edits — the timeline's attach / detach / delete, the card's pose, Rename, Duplicate, Delete,
// New level, Save — so what the AI does is exactly what the person's hands would have done: on screen at once, ONE ⌘Z
// for the whole job (UndoStack begin / end), counted on Save · n, and said in one line over the ask bar ("Claude took
// “Row” off Blue pillar · ⌘Z undoes it"), with the AI's name, so the person knows who changed it.
//
// WHY (a request, 2026-10-24): "I asked Claude, and it asked me to do the Studio's hand work. That is the worst
// experience." / "The editor and Claude don't mesh." What the ops mean (which clip "Row" is, the pose after "by", a
// motion from points, the default start) is schema/hands.mjs's — the same functions the CLI uses on placement.json when
// no editor is open, so the two never disagree.
//
// Pure of the DOM: every effect goes through HandsDeps (main.ts wires them), so test/ai-hands.test.ts runs it with
// stand-ins.
import type { Dim, Item, LibraryMotion, Motion, MotionClip, MotionRepeat, MotionUntil, MotionWhen, Pose } from '../contract.ts';
import { HANDS_MAKE_WHEN, handsClip, handsMotion, handsPose, handsSaid, readHandsInput } from '../schema/hands.mjs';

export interface HandsJob {
  id: string;
  ops: unknown;
  /** Which AI asked (the CLI's environment, which-ai.mjs): its name is in the line. Absent = "your AI". */
  by?: 'claude' | 'codex';
}
export interface HandsResult {
  do: string;
  ok: boolean;
  /** English, for the AI's `studio: did …` line (hands.mjs handsSaid). */
  said?: string;
  error?: string;
  /** `list`: what the editor has (the CLI prints it as one JSON line). */
  list?: unknown;
}
type Op = Record<string, any> & { do: string };
/** What one op did, for its result line and the person's line: hands.mjs handsSaid's extras plus the words' vars. */
type Did = { error?: string; words?: Record<string, string | number>; [k: string]: unknown };

export interface HandsDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  /** The editor shows the game and has its list (the bridge answered): ops can run. */
  ready(): boolean;
  playing(): boolean;
  /** Back to Edit from ▶ Play (the AI's change is on the editing page, not on the run). */
  stopPlay(): Promise<void>;
  /** The world layer (the AI's ops are about objects, never the game's HTML UI). */
  toWorld(): void;
  dim(): Dim;
  item(key: string): Item | undefined;
  /** The object's name as the person sees it (names.ts displayName). */
  label(key: string): string;
  keys(): string[];
  /** Where the object stands (its place; the model's pose). */
  pose(key: string): Pose | undefined;
  /** Move it there: one undo change, on screen, counted (the card's numbers do the same). */
  setPose(key: string, pose: Pose): void;
  rename(key: string, to: string): boolean;
  /** ⌘D on one object; the copy's key once the game page made it, else null. */
  duplicate(key: string): Promise<string | null>;
  remove(key: string): void;
  /** Drop to floor (End); false when the game cannot (2D, or no surface under it). */
  ground(key: string): Promise<boolean>;
  /** The object's motions as the timeline sees them (each clip with its Library motion's keys). */
  motionOf(key: string): Motion | null;
  /** Its clips as the file has them (use + when): the default start reads these. */
  rawClips(key: string): MotionClip[];
  lib(name: string): LibraryMotion | null;
  libNames(): string[];
  usage(name: string): number;
  attach(key: string, name: string): boolean;
  detach(key: string, clipName: string): void;
  deleteLib(name: string): void;
  renameLib(from: string, to: string): string | null;
  make(key: string | null, m: LibraryMotion, o: { when?: MotionWhen | MotionWhen[]; until?: MotionUntil | null; replace?: boolean; whenOf?: (clips: MotionClip[]) => MotionWhen }): { name: string; when?: unknown } | { error: string };
  clipSet(key: string, clipName: string, o: { when?: MotionWhen | MotionWhen[]; until?: MotionUntil | null }): boolean;
  libSet(name: string, o: { repeat?: MotionRepeat; len?: number }): boolean;
  levels: {
    active(): boolean;
    current(): string;
    ids(): string[];
    label(id: string): string;
    /** New level (blank) / Duplicate of the one on screen, opened; its id, or null. */
    add(kind: 'blank' | 'copy'): Promise<string | null>;
    go(id: string): Promise<boolean>;
    rename(id: string, to: string): boolean;
    /** Name the level just made (it stays "just made": ⌘Z still takes it away, name and all). */
    nameNew(id: string, to: string): boolean;
  };
  /** The person's Save (only when they asked the AI for it). */
  save(): Promise<boolean>;
  reload(editor: boolean): void;
  /** `list`: every object of the level on screen (key, the name the person sees, its motions), the Library, the levels. */
  list(): unknown;
  undoBegin(): void;
  /** Close the job's undo step; true when it holds a change (⌘Z takes it back). */
  undoEnd(words: string): boolean;
  /**
   * The job is done: draw again, keep the draft, say `words` (what the AI did, the person's language) over the ask bar —
   * with "⌘Z undoes it" only when `undoable` (a level opened or renamed is not on ⌘Z; a level just made is).
   */
  done(words: string, undoable: boolean): void;
}

/** How long a job waits for the editor to be ready (a page that is still opening the game). */
const READY_WAIT_MS = 12_000;

export function createAiHands(d: HandsDeps) {
  // One job at a time, in the order they came (two quick --do from the AI must not interleave their ops).
  let queue: Promise<unknown> = Promise.resolve();
  const name = (key: string) => d.label(key);

  async function waitReady(): Promise<boolean> {
    const end = Date.now() + READY_WAIT_MS;
    while (!d.ready()) {
      if (Date.now() > end) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
    return true;
  }

  /** The object an op names, or the reason it isn't there. */
  const need = (key: string): string | null => (d.item(key) ? null : `no object ${key} in the editor${hint()}`);
  const hint = () => {
    const ks = d.keys();
    return ks.length ? ` (objects: ${ks.slice(0, 12).join(', ')}${ks.length > 12 ? ', …' : ''})` : '';
  };
  const libHint = () => {
    const ns = d.libNames();
    return ns.length ? ns.map((n) => `"${n}"`).join(', ') : 'it has none';
  };

  async function one(op: Op): Promise<Did> {
    if (op.level && d.levels.active() && op.level !== d.levels.current()) {
      if (!d.levels.ids().includes(op.level)) return { error: `no level "${op.level}" (${d.levels.ids().join(', ')})` };
      if (!(await d.levels.go(op.level)) || !(await waitReady())) return { error: `could not open the level ${op.level}` };
    }
    switch (op.do) {
      case 'motion.make': {
        if (op.key && need(op.key)) return { error: need(op.key)! };
        const made = handsMotion(op, d.dim());
        if (made.error) return { error: made.error };
        // Without `when` it starts with the game (hands.mjs HANDS_MAKE_WHEN: the person asked for it to move now).
        const r = d.make(op.key ?? null, made.motion as LibraryMotion, { when: op.when, until: op.until, replace: op.replace, whenOf: () => ({ ...HANDS_MAKE_WHEN }) as MotionWhen });
        if ('error' in r) return { error: r.error };
        const m = d.lib(r.name);
        return { motion: m, when: r.when, words: { name: r.name, obj: op.key ? name(op.key) : '' } };
      }
      case 'motion.attach': {
        if (need(op.key)) return { error: need(op.key)! };
        if (!d.lib(op.name)) return { error: `no motion "${op.name}" in the Library (${libHint()})` };
        if ((d.motionOf(op.key)?.clips ?? []).some((c) => (c.use ?? c.name) === op.name)) return { error: `${op.key} has "${op.name}" already (motion.set changes when it starts)` };
        if (!d.attach(op.key, op.name)) return { error: `${op.key} cannot take another motion` };
        const c = (d.motionOf(op.key)?.clips ?? []).find((x) => (x.use ?? x.name) === op.name);
        if (c && (op.when !== undefined || op.until !== undefined)) d.clipSet(op.key, c.name, { when: op.when, until: op.until });
        const now = (d.motionOf(op.key)?.clips ?? []).find((x) => (x.use ?? x.name) === op.name);
        return { when: now?.when, words: { name: op.name, obj: name(op.key) } };
      }
      case 'motion.detach': {
        if (need(op.key)) return { error: need(op.key)! };
        const clips = d.motionOf(op.key)?.clips ?? [];
        if (op.all) {
          if (!clips.length) return { error: `${op.key} has no motion` };
          for (const c of clips) d.detach(op.key, c.name);
          return { all: clips.map((c) => `"${c.name}"`).join(', '), words: { name: clips.map((c) => c.name).join(', '), obj: name(op.key) } };
        }
        const r = handsClip(clips, op.name, op.key);
        if (r.error) return { error: r.error };
        d.detach(op.key, r.clip.name);
        return { clip: r.clip.name, words: { name: r.clip.name, obj: name(op.key) } };
      }
      case 'motion.delete': {
        if (!d.lib(op.name)) return { error: `no motion "${op.name}" in the Library (${libHint()})` };
        const from = d.usage(op.name);
        d.deleteLib(op.name);
        return { from, words: { name: op.name } };
      }
      case 'motion.rename': {
        if (!d.lib(op.name)) return { error: `no motion "${op.name}" in the Library (${libHint()})` };
        const to = d.renameLib(op.name, op.to);
        if (!to) return { error: `could not rename "${op.name}"` };
        return { to, words: { name: op.name, to } };
      }
      case 'motion.set': {
        if (op.key) {
          if (need(op.key)) return { error: need(op.key)! };
          const r = handsClip(d.motionOf(op.key)?.clips ?? [], op.name, op.key);
          if (r.error) return { error: r.error };
          if (op.when !== undefined || op.until !== undefined) d.clipSet(op.key, r.clip.name, { when: op.when, until: op.until });
          if (op.repeat || op.len) d.libSet(r.clip.use ?? r.clip.name, { repeat: op.repeat, len: op.len });
          return { words: { name: r.clip.name, obj: name(op.key) } };
        }
        if (!d.lib(op.name)) return { error: `no motion "${op.name}" in the Library (${libHint()})` };
        if (op.when !== undefined || op.until !== undefined) {
          const on = d.keys().filter((k) => (d.motionOf(k)?.clips ?? []).some((c) => c.use === op.name));
          if (!on.length) return { error: `"${op.name}" is on no object: put it on one first (motion.attach)` };
          for (const k of on) d.clipSet(k, (d.motionOf(k)!.clips!.find((c) => c.use === op.name))!.name, { when: op.when, until: op.until });
        }
        if (op.repeat || op.len) d.libSet(op.name, { repeat: op.repeat, len: op.len });
        return { words: { name: op.name, obj: '' } };
      }
      case 'object.move':
      case 'object.turn':
      case 'object.scale': {
        if (need(op.key)) return { error: need(op.key)! };
        const from = d.pose(op.key);
        if (!from) return { error: `${op.key} cannot be moved here` };
        const it = d.item(op.key)!;
        if (op.do === 'object.move' && it.movable === false) return { error: `${op.key} is locked by this game's rules (.studio/studio.json)` };
        if (op.do === 'object.turn' && !it.rotatable) return { error: `${op.key} does not turn in this game` };
        if (op.do === 'object.scale' && !it.scalable) return { error: `${op.key} does not resize in this game` };
        const r = handsPose(op, from, d.dim());
        if (r.error) return { error: r.error };
        d.setPose(op.key, r.pose as Pose);
        return { pose: r.pose, words: { obj: name(op.key) } };
      }
      case 'object.rename': {
        if (need(op.key)) return { error: need(op.key)! };
        if (d.item(op.key)!.unstable) return { error: `${op.key} has no name in the code yet: name it there first (a mark, §5), then rename` };
        const was = name(op.key);
        if (!d.rename(op.key, op.to)) return { error: `${op.key} already has that name` };
        return { words: { obj: was, to: op.to } };
      }
      case 'object.duplicate': {
        if (need(op.key)) return { error: need(op.key)! };
        const copy = await d.duplicate(op.key);
        if (!copy) return { error: `the game could not copy ${op.key}` };
        if (op.to || op.by) {
          const r = handsPose({ ...op, do: 'object.move' }, d.pose(copy), d.dim());
          if (!r.error) d.setPose(copy, r.pose as Pose);
        }
        return { copy, words: { obj: name(op.key) } };
      }
      case 'object.delete': {
        if (need(op.key)) return { error: need(op.key)! };
        const was = name(op.key);
        d.remove(op.key);
        return { words: { obj: was } };
      }
      case 'object.ground': {
        if (need(op.key)) return { error: need(op.key)! };
        if (!(await d.ground(op.key))) return { error: `${op.key} did not move: there is nothing under it to stand on, or this game cannot (2D)` };
        return { words: { obj: name(op.key) } };
      }
      case 'level.new':
      case 'level.duplicate': {
        if (op.do === 'level.duplicate' && op.id && op.id !== d.levels.current()) {
          if (!d.levels.ids().includes(op.id)) return { error: `no level "${op.id}" (${d.levels.ids().join(', ')})` };
          await d.levels.go(op.id);
        }
        const id = await d.levels.add(op.do === 'level.new' ? 'blank' : 'copy');
        if (!id) return { error: 'the level could not be made' };
        if (op.name) d.levels.nameNew(id, op.name);
        // The new level's game page: the next op of the job works on what it lists.
        await waitReady();
        const label = d.levels.label(id);
        return { id, label, words: { level: label } };
      }
      case 'level.rename': {
        const id = op.id ?? d.levels.current();
        if (!d.levels.active() || !d.levels.ids().includes(id)) return { error: d.levels.active() ? `no level "${id}" (${d.levels.ids().join(', ')})` : 'this game has no levels yet (level.new or level.duplicate makes the second one)' };
        if (!d.levels.rename(id, op.to)) return { error: `the level ${id} is called that already` };
        return { id, words: { to: op.to } };
      }
      case 'level.switch': {
        if (!d.levels.active() || !d.levels.ids().includes(op.id)) return { error: d.levels.active() ? `no level "${op.id}" (${d.levels.ids().join(', ')})` : 'this game has no levels' };
        if (!(await d.levels.go(op.id)) || !(await waitReady())) return { error: `could not open the level ${op.id}` };
        return { words: { level: d.levels.label(op.id) } };
      }
      case 'save':
        return (await d.save()) ? { words: {} } : { error: 'Save did not go through (the line in the editor says why)' };
      case 'editor.reload':
        d.reload(!!op.editor);
        return { words: {} };
      case 'list':
        return { list: d.list() };
      default:
        return { error: `unknown op ${op.do}` };
    }
  }

  /** The person's words for one op ("Claude took “Row” off Blue pillar"), with the AI's name. */
  function words(op: Op, did: Did, ai: Record<string, string>): string {
    const w = did.words ?? {};
    const key = op.do === 'motion.make' && !op.key ? 'hands.motion.makeLib' : op.do === 'motion.set' && !w.obj ? 'hands.motion.setLib' : `hands.${op.do}`;
    return d.t(key, { ...ai, ...w });
  }

  async function now(job: HandsJob): Promise<{ results: HandsResult[] }> {
    const read = readHandsInput(job.ops);
    if (!read.ok) return { results: [{ do: '?', ok: false, error: read.errors.join('; ') }] };
    const ops = read.ops as Op[];
    if (!(await waitReady())) return { results: ops.map((op) => ({ do: op.do, ok: false, error: 'the editor is still opening the game: run the same --do again in a moment' })) };
    if (d.playing()) await d.stopPlay();
    d.toWorld();
    // The AI's name for its line: the one that asked (by), else the editor's own guess ({ai}).
    const ai: Record<string, string> = job.by ? { ai: d.t(`ai.name.${job.by}`), Ai: d.t(`ai.name.${job.by}`) } : {};
    const results: HandsResult[] = [];
    const said: string[] = [];
    // ⌘Z after the job: its undo step, or a level it made last (New level / Duplicate are taken back by ⌘Z until the
    // next change); a level opened or renamed is not.
    let levelLast: 'made' | 'other' | null = null;
    // The job's line leads with what the person asked for: a motion made or put on (the detach before it is the tidy-up).
    let lead = -1;
    d.undoBegin();
    for (const op of ops) {
      let did: Did;
      try {
        did = await one(op);
      } catch (e) {
        did = { error: String((e as Error)?.message || e).slice(0, 200) };
      }
      if (did.error) results.push({ do: op.do, ok: false, error: did.error });
      else {
        if (op.do.startsWith('level.')) levelLast = op.do === 'level.new' || op.do === 'level.duplicate' ? 'made' : 'other';
        results.push({ do: op.do, ok: true, said: handsSaid(op, did), ...(did.list ? { list: did.list } : {}) });
        // Save, a reload and a look are not changes to undo: the line names only what changed.
        if (op.do !== 'save' && op.do !== 'editor.reload' && op.do !== 'list') {
          if (lead < 0 && (op.do === 'motion.make' || op.do === 'motion.attach')) lead = said.length;
          said.push(words(op, did, ai));
        }
        else if (!said.length && op.do === 'save') said.push(d.t('hands.save', ai));
      }
    }
    const first = said[Math.max(0, lead)] ?? '';
    const text = said.length > 1 ? d.t('hands.more', { text: first, n: said.length - 1 }) : first;
    const step = d.undoEnd(text);
    if (text) d.done(text, levelLast ? levelLast === 'made' : step);
    return { results };
  }

  return {
    /** Do a job from the AI; resolves to what each op did (the CLI prints one line each). */
    run(job: HandsJob): Promise<{ results: HandsResult[] }> {
      const p = queue.then(() => now(job));
      queue = p.catch(() => undefined);
      return p;
    },
  };
}
