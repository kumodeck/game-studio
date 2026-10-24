// studio-card-doors (2026-10-23): "one way in, a light card" — the rules that are easy to undo by accident.
//
// 1. Two uniforms (studio-uniforms' ✦ rule, the plan's inventory item 4): a plain button acts in the editor at once and
//    NEVER writes in the ask box; a ✦ button only puts a draft there and the cursor — nothing is sent until the person
//    sends. Read from the source: every place that writes in the box (focusAsk with words) and every place that sends
//    at once (askAi) is in the tables below, each with why it may. A new caller fails here until it is added on purpose.
// 2. The object's right-click menu has no "Copy" and no "Unlock" (one word for one thing; one way to unlock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { contextRows } from '../src/shell/context-rows.ts';

const src = (f: string) => readFileSync(new URL(`../src/shell/${f}`, import.meta.url), 'utf8');
/** The code lines (not comments) of a file that contain `needle`, trimmed. */
const callers = (text: string, needle: string) =>
  text.split('\n').map((l) => l.trim()).filter((l) => l.includes(needle) && !l.startsWith('//') && !l.startsWith('*'));

test('the ask box gets words only from ✦ buttons (focusAsk callers)', () => {
  const lines = callers(src('main.ts'), 'focusAsk(').filter((l) => !l.startsWith('function focusAsk'));
  // Each allowed caller, by a piece of its line → why it is a ✦ (a draft, nothing sent).
  const allowed: Array<[RegExp, string]> = [
    [/^askAi: host\.offline \? undefined : \(\) => focusAsk\(\),$/, 'the Library\'s ✦ Ask AI… (cursor only)'],
    [/^focusAsk\(t\(paths\.length > 1 \? 'lib\.addFilesText'/, 'the Library\'s ✦ Add to scene (a draft: adding is code)'],
    [/^focusAsk\(\);$/, '✦ rows: ask about the pick / the files / a motion (cursor only)'],
    [/^focusAsk\(t\(keys\.length > 1 \? 'ctx\.nameTextMany'/, 'nameDraft: ✦ Ask AI to name it…'],
    [/^ask: \(\) => focusAsk\(\),$/, 'the menu\'s ✦ Ask rows (cursor only)'],
    [/^focusAsk\(text\);$/, 'Ideas for your AI: ✦ Ask Claude… (a draft)'],
    // studio-code-torule (2026-10-24): ✦ Turn into a rule — the draft "Turn into a close rule", sent by the person.
    [/^focusAsk\(draft\);$/, 'askMotion: ✦ Ask AI on a motion (cursor only) / ✦ Turn into a rule… (its draft)'],
    [/^focusAsk\(t\('toRule\.draft'\)\);$/, 'the card\'s ✦ Turn into a rule (a draft)'],
    // studio-to-coords (2026-10-24): the line after a drag the rule kept still — ✦ Ask Claude: "Let me move Street lamps
    // sideways too" puts that draft in the box (the person sends it).
    [/^ask: \(draft\) => focusAsk\(draft\),$/, 'a rule\'s object held still: ✦ Ask for that knob (a draft)'],
  ];
  for (const l of lines) assert.ok(allowed.some(([re]) => re.test(l)), `a new caller writes in the ask box: ${l}`);
});

test('nothing is sent at once except what the person sends (askAi callers)', () => {
  const lines = callers(src('main.ts'), 'askAi(').filter((l) => !l.startsWith('async function askAi'));
  const allowed: Array<[RegExp, string]> = [
    [/^ask: \(keys, text, files\) => \(answering\(\) \? answerAi\(text\) : askAi\(\{ kind: 'ask'/, 'the ask box\'s own send'],
    // studio-code-torule: the same send, written out (the words of ✦ Turn into a rule go with `intent: 'to-code'`).
    [/^return askAi\(\{ kind: 'ask', text, objects: requestObjects\(keys\)/, 'the ask box\'s own send (with ✦ Turn into a rule\'s intent)'],
    [/^return askAi\(\{ kind: 'answer'/, 'the answer the person typed to the AI\'s question'],
    [/^void askAi\(\{ kind: 'play'/, 'the pause ask box\'s own send'],
    [/^ask: \(r\) => askAi\(r\),$/, 'the Library tool\'s ctx.ask (its own buttons: studio-library, not this step)'],
    // The web demo (host.offline) has no ask box to draft in: these stay its way, and askAi tells it cannot send.
    [/^askName: \(keys\) => askAi\(\{ kind: 'name'/, 'askName: only when nameDraft is absent (host.offline)'],
    [/^run: \(\) => \(host\.offline \? void askAi\(\{ kind: 'name'/, '⌘K Name the unnamed: a draft unless offline'],
    [/^send: \(step, text\) => askAi\(\{ kind: 'next-step'/, 'Ideas: only without draft (offline)'],
  ];
  for (const l of lines) assert.ok(allowed.some(([re]) => re.test(l)), `a new caller sends at once: ${l}`);
  // The two drafts that replaced sends are wired.
  assert.match(src('main.ts'), /nameDraft: host\.offline \? undefined : \(keys\) => nameDraft\(keys\)/);
  assert.match(src('main.ts'), /draft: host\.offline \? undefined : \(text\) => \{/);
  assert.match(src('next-steps.ts'), /if \(d\.draft\) return d\.draft\(/);
  // The list's "Ask AI to name them" drafts first.
  assert.match(src('placement-panel.ts'), /const askNames = async \(keys: string\[\]\) => \{\n\s+if \(d\.nameDraft\) return d\.nameDraft\(keys\);/);
});

test('the object\'s menu: no Copy, no Unlock (PC and phone, locked or not)', () => {
  const base = { dim: '3d' as const, offline: false, editing: true, picked: 1, movable: 1, unnamed: 0, anyPicked: true, items: 9, clip: 1, canUndo: true, canRedo: false };
  for (const f of [base, { ...base, movable: 0, held: 1 }, { ...base, compact: true }, { ...base, picked: 3, movable: 3 }]) {
    const ids = contextRows('object', f).map((r) => ('sep' in r ? '—' : r.id));
    assert.ok(!ids.includes('copy'), ids.join(' '));
    assert.ok(!ids.includes('unhold'), ids.join(' '));
  }
  // Paste stays while something is copied (⌘C is still a key).
  assert.ok(contextRows('object', base).some((r) => !('sep' in r) && r.id === 'paste'));
});
