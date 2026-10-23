// "Ideas for your AI" page (was "Next steps with KUMODeck"): things the
// person can hand to their AI from the editor.
//
// Order (UI/UX 2026-10-16, verganti C): first what the AI can do inside this
// game (fit the editor to it, change the editor's look, add a tool), then the
// KUMODeck steps (publish, multiplayer, ...). KUMODeck reads as one of the
// things your AI can do, not as a shop shelf in an OSS tool.
//
// Rules this page keeps:
// - Nothing happens until a button is pressed, and the ✦ button only writes the idea in the ask box (studio-card-doors,
//   2026-10-23): the person sends it from there. The page never contacts any
//   service; a sent ask only calls host.request(), which keeps the request
//   for the agent (locally .studio/requests/<id>.json, plus
//   .studio/next-step.md for KUMODeck steps).
// - The agent checks with the user before signing in, uploading or changing code.
// - No prices in the UI (they change); a link to the pricing page instead.
import type { AiStepId, Lang, NextStepId, StudioHost } from '../contract.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';

/** The only place the KUMODeck site address appears in the shell. */
export const KUMODECK_PRICING_URL = 'https://kumodeck.com/pricing';

export type StepId = AiStepId | NextStepId;
export const AI_STEPS: AiStepId[] = ['fit', 'look', 'tool'];
export const NEXT_STEPS: NextStepId[] = ['publish', 'multiplayer', 'save-data', 'ai-assets'];

export interface NextStepsDeps {
  host: StudioHost;
  lang: () => Lang;
  t(key: string): string;
  back(): void;
  /** Hand the step to the AI (host.request with kind "next-step"); resolves true when kept. Only without `draft`. */
  send(step: StepId, text: string): Promise<boolean>;
  /**
   * ✦ (studio-card-doors, 2026-10-23; the ✦ rule of studio-uniforms): put the words in the ask box, cursor there, and
   * close this page — nothing is sent until the person sends. Absent (the web demo: no ask box) = `send`.
   */
  draft?(text: string): void;
}

export function renderNextSteps(el: HTMLElement, d: NextStepsDeps, open: StepId | null, onOpen: (id: StepId | null) => void): void {
  el.replaceChildren();
  const top = h('div', { class: 'page-head' },
    // "‹ Close" / "‹ Back" left, the title centred: a page you step into and out of.
    h('button', { type: 'button', class: 'link', onclick: () => (open ? onOpen(null) : d.back()) }, icon('chevronLeft'), d.t(open ? 'btn.back' : 'btn.close')),
    h('h2', { text: d.t('next.title') }));
  el.append(top);
  if (!open) {
    el.append(h('p', { class: 'page-intro', text: d.t('next.intro') }));
    const group = (title: string, ids: StepId[], intro?: string) => {
      const ul = h('ul', { class: 'steps' });
      for (const id of ids) {
        ul.append(h('li', {},
          h('button', { type: 'button', class: 'step', dataset: { step: id }, onclick: () => onOpen(id) },
            h('strong', { text: d.t(`next.${id}`) }),
            h('span', { text: d.t(`next.${id}.desc`) }))));
      }
      el.append(h('h3', { class: 'steps-title', text: title }));
      if (intro) el.append(h('p', { class: 'muted small-text', text: intro }));
      el.append(ul);
    };
    group(d.t('next.group.game'), AI_STEPS);
    group(d.t('next.group.kumodeck'), NEXT_STEPS, d.t('next.kumodeckIntro'));
    return;
  }
  const kumodeck = (NEXT_STEPS as StepId[]).includes(open);
  const note = h('p', { class: 'note', role: 'status' });
  // Editable: "snap to a 1 m grid" is an example; the person says what they want.
  const promptBox = h('textarea', { class: 'prompt', rows: 3, maxlength: 500, 'aria-label': d.t('next.edit') });
  promptBox.value = d.t(`next.prompt.${open}`);
  const detail = h('div', { class: 'step-detail' });
  el.append(detail);
  el = detail;
  el.append(h('h3', { text: d.t(`next.${open}`) }), h('p', { text: d.t(`next.${open}.desc`) }));
  if (kumodeck) {
    el.append(
      h('p', { class: 'muted', text: d.t('next.cost') }),
      h('p', {}, h('a', { href: KUMODECK_PRICING_URL, target: '_blank', rel: 'noopener noreferrer', text: d.t('next.pricing') })));
  }
  el.append(
    h('label', { class: 'set-label', text: d.t('next.edit') }),
    promptBox,
    h('div', { class: 'step-actions' },
      h('button', { type: 'button', class: d.draft ? 'primary ai' : 'primary', dataset: { action: 'ask' }, text: d.draft ? `✦ ${d.t('next.ask')}…` : d.t('next.ask'), onclick: async () => {
        if (d.draft) return d.draft(promptBox.value.trim() || d.t(`next.prompt.${open}`));
        const ok = await d.send(open, promptBox.value.trim() || d.t(`next.prompt.${open}`)).catch(() => false);
        note.textContent = ok ? d.t('next.sent') : d.t('ask.fail');
      } }),
      h('button', { type: 'button', dataset: { action: 'copy' }, text: d.t('next.copy'), onclick: async () => {
        try {
          await navigator.clipboard.writeText(promptBox.value);
        } catch {
          promptBox.select(); // clipboard blocked: leave it selected for Ctrl+C
        }
        note.textContent = d.t('next.copied');
      } })),
    note,
  );
}
