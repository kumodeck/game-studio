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
import type { CodeAvoidInfo, CodeKnob, CodeMotionInfo, CodePlaceInfo, Dim, Item, KnobValue, LibraryMotion, Motion, MotionClip, MotionKey, MotionRepeat, MotionUntil, MotionWhen, PlacementPlace, PlaceOffset, Pose } from '../contract.ts';
import { HANDS_MAKE_WHEN, handsAvoid, handsClip, handsMotion, handsPose, handsSaid, readHandsInput } from '../schema/hands.mjs';
import { roundKnob, turnKnobs } from './code-places.ts';
import { CODE_LEN } from './motion-library.ts';
import { MOTION_SAMPLES, gapText, motionGap, placeGaps, timeText, type HandMotion, type HandSpot, type MotionGap, type PlaceGap } from './to-rule.ts';

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
  clipSet(key: string, clipName: string, o: { when?: MotionWhen | MotionWhen[]; until?: MotionUntil | null; off?: boolean }): boolean;
  libSet(name: string, o: { repeat?: MotionRepeat; len?: number; knobs?: Record<string, KnobValue> | null }): boolean;
  /**
   * The game page's code motions, code layouts and keep-out conditions (studio-code-base, 2026-10-24; bridge
   * code-lists.ts) as last listed: [] for a game without them.
   */
  codeMotions(): CodeMotionInfo[];
  codePlaces(): CodePlaceInfo[];
  codeAvoids(): CodeAvoidInfo[];
  /** Read the game again (the AI has just written code) and wait for its list; false = it did not come back. */
  reloadGame(): Promise<boolean>;
  /** The level on screen's changes to one code layout (null = none), and the layouts it has changes for. */
  place(id: string): PlacementPlace | null;
  placeIds(): string[];
  /** Set them (null = none): one undo change, counted on Save, and the game shows the layout so (it reads it again). */
  setPlace(id: string, e: PlacementPlace | null): void;
  /**
   * ✦ Turn into a rule (studio-code-torule, 2026-10-24): a rule motion's offsets over `len` seconds, `per` places, as
   * the game page runs its at() (studio:timeline/code-points) — null when the page did not answer. Absent: not measured.
   */
  ruleSamples?(code: string, knobs: Record<string, number>, len: number, per: number): Promise<MotionKey[] | null>;
  /**
   * The AI swapped a rule in for the hand's shape (`--replace`): what it replaced and how close it came, for the
   * comparison on screen until Save (shell/to-rule.ts RuleCompare; the layout's objects lit violet, as the AI's).
   */
  swapped?(s: { kind: 'place'; id: string; spots: HandSpot[]; gap: PlaceGap | null } | { kind: 'motion'; name: string; hand: HandMotion; gap: MotionGap | null }): void;
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

  // ----- code motions and code layouts (studio-code-base, 2026-10-24; CONTRACT.md §1.9.4, §1.12) -----
  // The AI has just written codeMotion / codePlace / codeAvoid into the game's code when it sends these: a page that does
  // not list the id yet reads the game again first (decision 5) — the person is never asked to press Reload.
  async function findCode<T>(get: () => T[], idOf: (x: T) => string, id: string): Promise<T | null> {
    const find = () => get().find((x) => idOf(x) === id) ?? null;
    if (find()) return find();
    await d.reloadGame();
    return find();
  }
  const hasNo = (fn: string, id: string, ids: string[]) => `the game has no ${fn}('${id}') (it has: ${ids.length ? ids.map((i) => `'${i}'`).join(', ') : 'none'})`;
  /** "Gap 4 m, Count 5": the knobs as the person reads them (the code's label and unit). */
  const knobWords = (code: Record<string, CodeKnob>, vals: Record<string, number>) => Object.entries(vals).map(([n, v]) => {
    const k = code[n];
    const u = k?.unit ? d.t(`hands.unit.${k.unit}`) : '';
    return `${k?.label ?? n} ${roundKnob(v)}${u === `hands.unit.${k?.unit}` ? ` ${k?.unit}` : u}`;
  }).join(', ');
  /** The knobs' numbers now: the file's v over the code's. */
  const knobsNow = (code: Record<string, CodeKnob>, file?: Record<string, KnobValue>) => Object.fromEntries(Object.entries(code).map(([n, k]) => [n, file?.[n]?.v ?? k.v]));
  const unknownKnob = (fn: string, code: Record<string, CodeKnob>, set: Record<string, number>) => {
    const bad = Object.keys(set).find((n) => !(n in code));
    return bad ? `${fn} has no knob "${bad}" (its knobs: ${Object.keys(code).join(', ') || 'none'})` : null;
  };
  /** A unit as the knobs say it (" m", " s"); the code's own word when the editor has none. */
  const unit = (u: string) => {
    const s = d.t(`hands.unit.${u}`);
    return s === `hands.unit.${u}` ? ` ${u}` : s;
  };
  /** A gap in the AI's line (English, exact enough to quote): 3D metres to the centimetre, 2D whole pixels. */
  const gapNum = (x: number) => (d.dim() === '2d' ? `${Math.round(x)} px` : `${Math.round(x * 100) / 100} m`);
  /** A code layout's objects are its own keys: "hex-3" of codePlace('hex'). */
  const ofPlace = (p: CodePlaceInfo, key: string) => p.keys.includes(key) || (key.startsWith(`${p.id}-`) && /^[1-9][0-9]{0,3}$/.test(key.slice(p.id.length + 1)));
  /**
   * An object a rule layout places, not put by hand (studio-to-coords, 2026-10-24: "a rule's thing stays a rule however
   * it is moved"): object.move / turn / scale / ground would give it a coordinate of its own and take it out of its rule
   * — the AI is told the ways that keep it a rule instead (its knobs), or that say so (a pin, Convert to coordinates).
   */
  const ruleHeld = (key: string): string | null => {
    const p = (d.codePlaces?.() ?? []).find((x) => x.keys.includes(key));
    const e = p ? d.place(p.id) : null;
    if (!p || e?.hand || e?.pins?.[key]) return null;
    return `${key} is placed by codePlace('${p.id}') (its rule) and stays in it: change the rule's numbers with place.set --knobs, `
      + `move the whole rule with place.set --offsets (every object: [{"way":"side","how":"same","v":1}]), `
      + `put just this one by hand with place.set --pin, or turn the whole layout into coordinates with place.set --hand`;
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
        // A code motion's knobs (studio-code-base): turned like the person's knob on the timeline, { v, was = the code's }.
        const knobs = async (libName: string): Promise<{ error?: string; words?: string }> => {
          const l = d.lib(libName);
          if (!l) return { error: `no motion "${libName}" in the Library (${libHint()})` };
          if (l.code && (op.repeat || op.len)) return { error: `"${libName}" is a code motion: its length and repeat are its codeMotion('${l.code}')'s` };
          if (!op.knobs) return {};
          if (!l.code) return { error: `"${libName}" is a motion of points, not code: it has no knobs (motion.code with "replace" turns it into code)` };
          const info = await findCode(d.codeMotions, (c) => c.code, l.code);
          if (!info) return { error: hasNo('codeMotion', l.code, d.codeMotions().map((c) => c.code)) };
          const bad = unknownKnob(`codeMotion('${l.code}')`, info.knobs, op.knobs);
          if (bad) return { error: bad };
          d.libSet(libName, { knobs: turnKnobs(l.knobs, op.knobs, info.knobs) ?? null });
          return { words: knobWords(info.knobs, op.knobs) };
        };
        if (op.key) {
          if (need(op.key)) return { error: need(op.key)! };
          const r = handsClip(d.motionOf(op.key)?.clips ?? [], op.name, op.key);
          if (r.error) return { error: r.error };
          const k = await knobs(r.clip.use ?? r.clip.name);
          if (k.error) return { error: k.error };
          if (op.when !== undefined || op.until !== undefined || op.off !== undefined) d.clipSet(op.key, r.clip.name, { when: op.when, until: op.until, off: op.off });
          if (op.repeat || op.len) d.libSet(r.clip.use ?? r.clip.name, { repeat: op.repeat, len: op.len });
          if (op.off !== undefined && !op.knobs && op.when === undefined && op.until === undefined) return { words: { name: r.clip.name, obj: name(op.key) }, wordsKey: op.off ? 'hands.motion.off' : 'hands.motion.on' };
          return { words: { name: r.clip.name, obj: name(op.key), ...(k.words ? { what: k.words } : {}) }, ...(k.words ? { wordsKey: 'hands.motion.knobs' } : {}) };
        }
        if (!d.lib(op.name)) return { error: `no motion "${op.name}" in the Library (${libHint()})` };
        const k = await knobs(op.name);
        if (k.error) return { error: k.error };
        if (k.words && !op.when && !op.until && !op.repeat && !op.len) return { words: { name: op.name, what: k.words }, wordsKey: 'hands.motion.knobs' };
        if (op.when !== undefined || op.until !== undefined) {
          const on = d.keys().filter((k) => (d.motionOf(k)?.clips ?? []).some((c) => c.use === op.name));
          if (!on.length) return { error: `"${op.name}" is on no object: put it on one first (motion.attach)` };
          for (const k of on) d.clipSet(k, (d.motionOf(k)!.clips!.find((c) => c.use === op.name))!.name, { when: op.when, until: op.until });
        }
        if (op.repeat || op.len) d.libSet(op.name, { repeat: op.repeat, len: op.len });
        return { words: { name: op.name, obj: '' } };
      }
      case 'motion.code': {
        if (op.key && need(op.key)) return { error: need(op.key)! };
        const info = await findCode(d.codeMotions, (c) => c.code, op.code);
        if (!info) return { error: hasNo('codeMotion', op.code, d.codeMotions().map((c) => c.code)) };
        const named = d.lib(op.name);
        // The same code already in the Library is that motion (the person may have renamed it): one motion, one set of knobs.
        const there = named?.code === op.code ? op.name : !(named && op.replace) ? d.libNames().find((n) => d.lib(n)?.code === op.code) : undefined;
        const words = (n: string) => ({ name: n, obj: op.key ? name(op.key) : '' });
        if (there) {
          if (!op.key) return { name: there, words: words(there) };
          let c = (d.motionOf(op.key)?.clips ?? []).find((x) => (x.use ?? x.name) === there);
          if (!c) {
            if (!d.attach(op.key, there)) return { error: `${op.key} cannot take another motion` };
            c = (d.motionOf(op.key)?.clips ?? []).find((x) => (x.use ?? x.name) === there);
            // Like a motion the AI makes: it starts with the game unless the op says otherwise (HANDS_MAKE_WHEN).
            if (c) d.clipSet(op.key, c.name, { when: op.when ?? ({ ...HANDS_MAKE_WHEN } as MotionWhen), until: op.until });
          } else if (op.when !== undefined || op.until !== undefined) d.clipSet(op.key, c.name, { when: op.when, until: op.until });
          const now = (d.motionOf(op.key)?.clips ?? []).find((x) => (x.use ?? x.name) === there);
          return { name: there, when: now?.when, words: words(there) };
        }
        const len = info.round && info.round >= 0.1 && info.round <= 600 ? info.round : CODE_LEN;
        const m = { name: op.name, len, keys: {}, code: op.code } as LibraryMotion;
        // ✦ Turn into a rule (studio-code-torule): the points it had, kept to measure the rule against (and to compare on
        // screen until Save) — the shape the person made, not the file's (it may not be saved yet).
        const hand: HandMotion | null = named && op.replace && !named.code && named.keys?.p?.length
          ? { keys: structuredClone(named.keys.p), len: named.len, ...(named.repeat ? { repeat: named.repeat } : {}) } : null;
        const r = d.make(op.key ?? null, m, { when: op.when, until: op.until, replace: op.replace, whenOf: () => ({ ...HANDS_MAKE_WHEN }) as MotionWhen });
        if ('error' in r) return { error: r.error };
        if (!hand) return { name: r.name, when: r.when, replaced: !!(named && op.replace), words: words(r.name) };
        // How close the rule came, measured here (the person reads the editor's number, not the AI's word for it): one
        // round of the rule — what its violet line shows — at 64 places, each against the points at the same time.
        const round = info.round && info.round > 0 ? info.round : CODE_LEN;
        const pts = d.ruleSamples ? await d.ruleSamples(op.code, knobsNow(info.knobs, d.lib(r.name)?.knobs), round, MOTION_SAMPLES) : null;
        const g = pts?.length ? motionGap(hand, pts).max : null;
        d.swapped?.({ kind: 'motion', name: r.name, hand, gap: g });
        const w = { ...words(r.name), ...(g ? { gap: gapText(g.d, d.dim(), unit), t: timeText(g.t) } : {}) };
        return { name: r.name, when: r.when, replaced: true, words: w, wordsKey: g ? 'hands.motion.toRule' : 'hands.motion.toRuleSame',
          gapSaid: g ? `; the editor measured how close it is: the largest gap is ${gapNum(g.d)} at ${timeText(g.t)} s of a ${timeText(round)} s round (${pts!.length} places against the ${hand.keys.length} points it had)` : '' };
      }
      case 'place.code': {
        // ✦ Turn into a rule (studio-code-torule): where the hand-placed objects stand NOW, read before the game is read
        // again for the new layout — each to be compared with the rule's object of the same number (`replace` order).
        const hand: HandSpot[] = (Array.isArray(op.replace) ? op.replace as string[] : []).flatMap((k, i) => {
          const ps = d.item(k) ? d.pose(k) : undefined;
          return ps ? [{ key: k, label: name(k), p: ps.p.slice(), n: i + 1 }] : [];
        });
        const info = await findCode(d.codePlaces, (p) => p.id, op.id);
        if (!info) return { error: hasNo('codePlace', op.id, d.codePlaces().map((p) => p.id)) };
        const e = d.place(op.id) ?? {};
        const what = [d.t('hands.place.count', { n: info.keys.length }), knobWords(info.knobs, knobsNow(info.knobs, e.knobs))].filter(Boolean).join(' · ');
        if (!op.replace) return { keys: info.keys.length, words: { name: info.name, what }, wordsKey: 'hands.place.code' };
        // ✦ To code: the hand-placed objects are hidden until the AI takes them out of the code (one ⌘Z brings them back).
        const gone = op.replace.filter((k: string) => !d.item(k) && !(e.from ?? []).includes(k));
        if (gone.length === op.replace.length) return { error: `no object ${gone[0]} in the editor${hint()}` };
        d.setPlace(op.id, { ...e, from: [...new Set([...(e.from ?? []), ...op.replace])] });
        // How close: each hand object against the rule's object of its number, where it stands now (the model's pose).
        const g = hand.length ? placeGaps(hand, (n) => (info.keys.includes(`${op.id}-${n}`) ? d.pose(`${op.id}-${n}`)?.p : null)) : null;
        if (hand.length) d.swapped?.({ kind: 'place', id: op.id, spots: hand, gap: g?.max ?? null });
        const max = g?.max;
        return { keys: info.keys.length, words: { name: info.name, n: op.replace.length, what, ...(max ? { obj: max.label, gap: gapText(max.d, d.dim(), unit) } : {}) },
          wordsKey: max ? 'hands.place.toRule' : 'hands.place.codeReplace',
          gapSaid: max ? `; the editor measured how close it is: the largest gap is ${max.key} ↔ ${op.id}-${max.n}, ${gapNum(max.d)} (${hand.length - g!.unmatched} of ${hand.length} compared${g!.unmatched ? `; ${g!.unmatched} with no object of that number in the rule` : ''})` : '' };
      }
      case 'place.set': {
        const info = await findCode(d.codePlaces, (p) => p.id, op.id);
        if (!info) return { error: hasNo('codePlace', op.id, d.codePlaces().map((p) => p.id)) };
        const e: PlacementPlace = d.place(op.id) ?? {};
        const n = d.dim() === '2d' ? 2 : 3;
        const parts: string[] = [];
        if (op.knobs) {
          const bad = unknownKnob(`codePlace('${op.id}')`, info.knobs, op.knobs);
          if (bad) return { error: bad };
          e.knobs = turnKnobs(e.knobs, op.knobs, info.knobs);
          parts.push(knobWords(info.knobs, op.knobs));
        }
        if (op.pin) {
          if (!ofPlace(info, op.pin.key)) return { error: `"${op.pin.key}" is not one of codePlace('${op.id}')'s objects (${info.keys.slice(0, 8).join(', ') || 'it has none'})` };
          if (op.pin.p.length !== n) return { error: `a position has ${n} numbers in a ${d.dim().toUpperCase()} game` };
          e.pins = { ...(e.pins ?? {}), [op.pin.key]: { p: op.pin.p.slice(), ...(op.pin.r !== undefined ? { r: op.pin.r } : {}), ...(op.pin.s !== undefined ? { s: op.pin.s } : {}) } };
          parts.push(d.t('hands.place.pin', { obj: name(op.pin.key) }));
        }
        if (op.unpin === '*') {
          // Every one placed by hand back on the rule (studio-hand-marks; the card's "All back to rule"): one ⌘Z.
          if (e.hand) return { error: `codePlace('${op.id}') is converted to coordinates (hand: true): --hand false puts it back on the code` };
          const n = Object.keys(e.pins ?? {}).filter((k) => info.keys.includes(k)).length || Object.keys(e.pins ?? {}).length;
          if (!n) return { error: `codePlace('${op.id}') has nothing placed by hand (every object follows the code already)` };
          delete e.pins;
          parts.push(d.t('hands.place.unpinAll', { n }));
        } else if (op.unpin) {
          if (!e.pins?.[op.unpin]) return { error: `${op.unpin} is not placed by hand (it follows the code already)` };
          delete e.pins[op.unpin];
          parts.push(d.t('hands.place.unpin', { obj: name(op.unpin) }));
        }
        if (op.hand === true) {
          // Place by hand: where each object stands now becomes its own place (the AI writes them out as a list on Save).
          const pins: NonNullable<PlacementPlace['pins']> = {};
          for (const k of info.keys) {
            const ps = d.pose(k);
            if (ps) pins[k] = { p: ps.p.slice(), ...(ps.r !== undefined ? { r: ps.r } : {}), ...(ps.s !== undefined && ps.s !== 1 ? { s: ps.s } : {}), ...(ps.t ? { t: [ps.t[0], ps.t[1]] as [number, number] } : {}) };
          }
          e.pins = pins;
          e.hand = true;
          parts.push(d.t('hands.place.hand'));
        } else if (op.hand === false) {
          delete e.hand;
          delete e.pins;
          parts.push(d.t('hands.place.unhand'));
        }
        // studio-offsets: the rule's shifts as a whole list ([] = none) — what the person's drags make; on Save the AI
        // writes them into the rule and sends [] (the code is the truth).
        if (op.offsets) {
          if (op.offsets.length) e.offsets = structuredClone(op.offsets);
          else delete e.offsets;
          parts.push(op.offsets.length ? d.t('hands.place.offsets', { what: op.offsets.map((o: PlaceOffset) => `${d.t(`offset.way.${o.way}`)} · ${d.t(`offset.${o.how}`)} ${Array.isArray(o.v) ? o.v.join(', ') : o.v}`).join(', ') }) : d.t('hands.place.noOffsets'));
        }
        d.setPlace(op.id, e);
        return { words: { name: info.name, what: parts.join(', ') } };
      }
      case 'place.avoid': {
        const info = await findCode(d.codePlaces, (p) => p.id, op.id);
        if (!info) return { error: hasNo('codePlace', op.id, d.codePlaces().map((p) => p.id)) };
        let cond: CodeAvoidInfo | null = null;
        if (op.code) {
          cond = await findCode(d.codeAvoids, (a) => a.code, op.code);
          if (!cond) return { error: hasNo('codeAvoid', op.code, d.codeAvoids().map((a) => a.code)) };
          const bad = op.knobs && unknownKnob(`codeAvoid('${op.code}')`, cond.knobs, op.knobs);
          if (bad) return { error: bad };
        }
        const e: PlacementPlace = d.place(op.id) ?? {};
        const boxes = (e.avoid ?? []).filter((a) => 'box' in a).length;
        const was = (e.avoid ?? [])[typeof op.remove === 'number' ? op.remove : -1] ?? (e.avoid ?? []).find((a) => 'code' in a && a.code === (op.remove ?? op.code));
        const o = op.box && !op.name ? { ...op, name: d.t('place.boxName', { n: boxes + 1 }) } : op;
        const r = handsAvoid(e, o, d.dim() === '2d' ? 2 : 3, cond ? Object.fromEntries(Object.entries(cond.knobs).map(([k, v]) => [k, v.v])) : {});
        if (r.error) return { error: r.error };
        // A condition the code names already, switched back on with nothing changed: no entry (the file keeps changes only).
        if (e.avoid) e.avoid = e.avoid.filter((a) => !('code' in a && info.avoid.includes(a.code) && !a.off && !a.knobs));
        d.setPlace(op.id, e);
        const label = (a: unknown) => {
          const x = a as { code?: string; name?: string; knobs?: Record<string, KnobValue> } | undefined;
          if (!x) return '';
          if (!x.code) return x.name ?? '';
          const c = d.codeAvoids().find((y) => y.code === x.code);
          return [c?.name ?? x.code, c ? knobWords(c.knobs, knobsNow(c.knobs, x.knobs)) : '', c?.after ?? ''].filter(Boolean).join(' ');
        };
        const now = op.remove !== undefined ? was : op.box ? e.avoid?.[e.avoid.length - 1] : (e.avoid ?? []).find((a) => 'code' in a && a.code === op.code) ?? { code: op.code };
        const key = op.remove !== undefined ? 'hands.place.avoidRemove' : op.off === true ? 'hands.place.avoidOff' : r.changed ? 'hands.place.avoidSet' : 'hands.place.avoid';
        return { changed: r.changed, words: { name: info.name, what: label(now) }, wordsKey: key };
      }
      case 'object.move':
      case 'object.turn':
      case 'object.scale': {
        if (need(op.key)) return { error: need(op.key)! };
        if (ruleHeld(op.key)) return { error: ruleHeld(op.key)! };
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
        if (ruleHeld(op.key)) return { error: ruleHeld(op.key)! };
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
        return { list: codeList(d.list() as Record<string, unknown>) };
      default:
        return { error: `unknown op ${op.do}` };
    }
  }

  /**
   * `list` with the game's code: each code motion with its code id and knobs (the file's numbers over the code's,
   * `missing` when the game has no such codeMotion), and every code layout with its objects, knobs, pins and keep-out
   * areas — so "make the gap smaller" or "keep them off the road" can be done without asking the person.
   */
  function codeList(l: Record<string, unknown>): Record<string, unknown> {
    const cm = new Map(d.codeMotions().map((c) => [c.code, c]));
    const knobsOut = (code: Record<string, CodeKnob>, file?: Record<string, KnobValue>) => Object.fromEntries(Object.entries(code).map(([n, k]) => [n, { ...k, v: file?.[n]?.v ?? k.v, ...(file?.[n] ? { code: k.v } : {}) }]));
    const motions = (Array.isArray(l.motions) ? l.motions : []).map((m: { name: string }) => {
      const lm = d.lib(m.name);
      if (!lm?.code) return m;
      const c = cm.get(lm.code);
      const { len: _len, repeat: _repeat, ...rest } = m as { name: string; len?: number; repeat?: string };
      return { ...rest, code: lm.code, ...(c ? { knobs: knobsOut(c.knobs, lm.knobs), round: c.round, ...(c.note ? { note: c.note } : {}), ...(c.game ? { game: true } : {}) } : { missing: true, ...(lm.knobs ? { knobs: lm.knobs } : {}) }) };
    });
    const ps = d.codePlaces();
    const places: unknown[] = ps.map((p) => {
      const e = d.place(p.id) ?? {};
      // studio-offsets: its offsets and each object's row / rank / what they add (the editor counts the ranks, so the
      // AI writing them into at() on Save does not count them itself: 01-decisions.md 9).
      const objects = p.rows?.some(Boolean) ? p.keys.map((k) => {
        const r = p.rows![Number(k.slice(p.id.length + 1)) - 1];
        return r ? { key: k, line: r.line, rank: r.rank, ...(r.offset ? { offset: r.offset } : {}) } : { key: k };
      }) : null;
      return { id: p.id, name: p.name, keys: p.keys, knobs: knobsOut(p.knobs, e.knobs), ...(p.drag ? { drag: p.drag } : {}), ...(e.pins ? { pins: Object.keys(e.pins) } : {}), ...(e.hand ? { hand: true } : {}),
        ...(p.kind ? { kind: p.kind } : {}), ...(e.offsets ? { offsets: e.offsets } : {}), ...(objects ? { objects } : {}),
        avoid: [...p.avoid.filter((a) => !(e.avoid ?? []).some((x) => 'code' in x && x.code === a)).map((a) => ({ code: a })), ...(e.avoid ?? [])].map((a) => {
          if ('box' in a) return a;
          const c = d.codeAvoids().find((x) => x.code === a.code);
          return { ...a, ...(c ? { name: c.name, ...(c.after ? { after: c.after } : {}), knobs: knobsOut(c.knobs, a.knobs) } : { missing: true }) };
        }), ...(p.skipped.length ? { skipped: p.skipped } : {}), ...(e.from ? { from: e.from } : {}) };
    });
    // Changes kept for a layout the game does not have (any more): the AI fixes its code, or takes them out.
    for (const id of d.placeIds()) if (!ps.some((p) => p.id === id)) places.push({ id, missing: true, ...d.place(id) });
    return { ...l, motions, ...(places.length ? { places } : {}) };
  }

  /** The person's words for one op ("Claude took “Row” off Blue pillar"), with the AI's name. */
  function words(op: Op, did: Did, ai: Record<string, string>): string {
    const w = did.words ?? {};
    const key = typeof did.wordsKey === 'string' ? did.wordsKey : op.do === 'motion.make' && !op.key ? 'hands.motion.makeLib' : op.do === 'motion.code' && !op.key ? 'hands.motion.codeLib'
      : op.do === 'motion.set' && !w.obj ? 'hands.motion.setLib' : `hands.${op.do}`;
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
        // ✦ Turn into a rule: the editor's measure goes after what was done, for the AI to quote in its one line.
        results.push({ do: op.do, ok: true, said: handsSaid(op, did) + (typeof did.gapSaid === 'string' ? did.gapSaid : ''), ...(did.list ? { list: did.list } : {}) });
        // Save, a reload and a look are not changes to undo: the line names only what changed.
        if (op.do !== 'save' && op.do !== 'editor.reload' && op.do !== 'list') {
          if (lead < 0 && ['motion.make', 'motion.attach', 'motion.code', 'place.code'].includes(op.do)) lead = said.length;
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
