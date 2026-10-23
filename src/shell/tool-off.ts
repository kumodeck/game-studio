// A dimmed tool of the strip pressed (studio-tool-clear, 2026-10-23). The strip keeps the same four tools for every
// object (bridge/handles.ts); one that does not work on the pick is dimmed, and a press on it (or its key, or ⌘K)
// comes here as placement/tool-off. The editor's small menu opens at the button: the why in one sentence (the
// button's own tooltip, bridge/handles.ts OFF_LINES), then what can be done — never a sentence that ends on "you
// can't" (the brief, from a hands-on try: "the strip lost Move": the button was hidden and nothing said why).
//
//   the game moves its place / height  →  "Set where it starts" / "Set the height it starts at" (bridge/hold.ts
//                                          startSpot: Move and Height work again and are chosen) · Ask AI
//   the game turns it / sizes it       →  Ask AI (a start angle or size would not show: hold.ts)
//   a ground held still                →  "Make movable" (the card's and the menu's own row) · Ask AI
//   the game's rules lock it           →  Ask AI to change the rule
//   it cannot take the tool            →  Ask AI
//
// WHY the editor's menu (context-menu.ts) and not words in the game page: the rows act in the editor (the chat box,
// the hold), and the menu already has the glass, the keys, Esc, a finger's size — the Motion button's menu is the
// same menu, from the same strip (motion-tool.ts).
import type { StripTool } from '../contract.ts';
import type { MenuEntry } from './context-menu.ts';

export type OffWhy = 'game' | 'ground' | 'locked' | 'none';

export interface ToolOffDeps {
  t(key: string, vars?: Record<string, string | number>): string;
  /** "Set where it starts" / "Make movable": the hold comes off `key` (ShellToBridge placement/unhold). */
  unhold(key: string): void;
  /** Choose a tool of the strip (after the hold came off: the hand goes on with what it reached for). */
  choose(tool: StripTool): void;
  /** The chat box with the cursor in it and these words first (never sent); null = no chat here (the web demo). */
  ask: ((text: string) => void) | null;
}

/** The menu's rows for a dimmed `tool` on `key`, under its `line` (the why, already in the person's language). */
export function toolOffEntries(d: ToolOffDeps, key: string, tool: StripTool, why: OffWhy, line: string): MenuEntry[] {
  const out: MenuEntry[] = [{ note: line }];
  const ask = (label: string, text: string) => {
    // ✦ (studio-uniforms, 2026-10-23): the AI's uniform, after a line, so it is not read as one of the editor's own rows.
    if (d.ask) out.push(...(out.length > 1 ? [{ sep: true } as const] : []), { id: 'tool-off-ask', label: d.t(label), ai: true, run: () => d.ask!(d.t(text)) });
  };
  if (why === 'game') {
    if (tool === 'move' || tool === 'lift') {
      out.push({ id: 'tool-off-start', label: d.t(tool === 'move' ? 'tooloff.start.move' : 'tooloff.start.lift'), run: () => (d.unhold(key), d.choose(tool)) });
      ask('tooloff.ask.moves', 'tooloff.askText.moves');
    } else ask('tooloff.ask', tool === 'rotate' ? 'tooloff.askText.turn' : 'tooloff.askText.size');
  } else if (why === 'ground') {
    out.push({ id: 'tool-off-unhold', label: d.t('hold.free'), run: () => (d.unhold(key), d.choose(tool)) });
    ask('tooloff.ask', `tooloff.askText.${tool}`);
  } else if (why === 'locked') ask('tooloff.ask.rule', 'tooloff.askText.rule');
  else ask('tooloff.ask', `tooloff.askText.${tool}`);
  return out;
}
