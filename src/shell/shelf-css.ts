// The shelf's look (shelf.ts) and the guide's (samples-tour.ts), put in the page as one <style> by whichever runs.
// In this file and not shell.css (decided 2026-11-06): the shelf is a page of its own drawn before the editor, and the
// guide is gone after three tries; neither should weigh on the editor's sheet. Same tokens as shell.css (its six
// rules: the desk, one glass, orange = you, violet = the AI, nested corners, one motion curve), so both themes follow.
export const SHELF_CSS = `
.samples-page { min-height: 100vh; min-height: 100dvh; background: var(--studio-page); color: var(--studio-fg);
  font: 14px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.samples-page button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; text-align: inherit; min-height: 0; }
/* The editor's own button look (shell.css: inline-flex, centred, one line) is for its small presses; a card is a block. */
.samples-page button.samples-card, .samples-page button.samples-back { display: block; white-space: normal; text-align: left; border-radius: 14px; }
.samples-page button.samples-card:hover { background: var(--plate); }
.samples-bar { height: 44px; display: flex; align-items: center; gap: 10px; padding: 0 14px; }
.samples-logo { width: 16px; height: 16px; border-radius: 4px; background: var(--studio-fg); flex: none; }
.samples-crumb { font-weight: 600; white-space: nowrap; }
.samples-crumb .sep { color: var(--studio-muted); font-weight: 400; margin: 0 6px; }
.samples-sp { flex: 1; }
.samples-own { margin: 0; color: var(--studio-muted); font-size: 13px; text-align: right; }
.samples-own > span { color: var(--studio-fg); }
.samples-own code { font: 600 12px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--raise); padding: 2px 6px; border-radius: 5px; color: var(--studio-fg); }

.samples-main { padding: 26px 48px 48px; max-width: 1280px; margin: 0 auto; box-sizing: border-box; }
.samples-head { margin-bottom: 22px; }
.samples-head h1 { margin: 0; font-size: 28px; letter-spacing: -.02em; font-weight: 700; }
.samples-head p { margin: 6px 0 0; color: var(--studio-muted); font-size: 15px; max-width: 600px; }
/* Three across (six samples = two even rows), two on a narrow window, one on a phone. */
.samples-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; align-items: stretch; }
@media (max-width: 900px) { .samples-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

.samples-card { display: block; width: 100%; background: var(--plate); border-radius: 14px; overflow: hidden;
  box-shadow: var(--plate-shadow); position: relative; transition: transform .2s cubic-bezier(.2, .8, .2, 1), box-shadow .2s; }
.samples-card:not(.coming):hover, .samples-card:focus-visible, .samples-card.is-live { transform: translateY(-2px); box-shadow: 0 0 0 2px var(--studio-fg), var(--glass-shadow); outline: none; }
.samples-card.coming { cursor: default; }
.samples-card.coming .samples-pic { filter: saturate(.4); opacity: .7; }
.samples-pic { aspect-ratio: 16 / 10; background: #000; position: relative; overflow: hidden; }
.samples-pic img, .samples-live { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border: 0; display: block; }
.samples-live { opacity: 0; transition: opacity .3s ease-out; pointer-events: none; background: transparent; }
.samples-live.on { opacity: 1; }
.samples-blank { position: absolute; inset: 0; display: grid; place-items: center; color: rgba(255, 255, 255, .55); font-weight: 650; font-size: 18px;
  background: radial-gradient(120% 90% at 50% 60%, #2a2440, #0e0d14); }
.samples-tags { position: absolute; left: 10px; top: 10px; display: flex; gap: 6px; }
.samples-chip { font-size: 11.5px; font-weight: 600; padding: 3px 8px; border-radius: 999px; background: rgba(0, 0, 0, .55); color: #fff; }
.samples-chip.soon { background: rgba(255, 255, 255, .88); color: #1d1d1f; }
.samples-playing { position: absolute; right: 10px; bottom: 10px; font-size: 11.5px; color: #fff; background: rgba(0, 0, 0, .5);
  padding: 3px 8px; border-radius: 999px; display: none; align-items: center; gap: 5px; }
.samples-playing i { width: 6px; height: 6px; border-radius: 50%; background: #30d158; }
.is-live .samples-playing { display: flex; }
.samples-txt { padding: 12px 14px 14px; }
.samples-txt h3 { margin: 0; font-size: 15.5px; font-weight: 650; display: flex; align-items: baseline; gap: 8px; }
.samples-txt h3 small { font-size: 12px; color: var(--studio-muted); font-weight: 500; }
.samples-txt p { margin: 4px 0 0; color: var(--studio-muted); font-size: 13px; }

/* The grown card: the picture large on the left, the words and the one button on the right. */
.samples-big { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, 1fr); background: var(--plate); border-radius: 18px;
  overflow: hidden; box-shadow: var(--plate-shadow), var(--glass-shadow); }
.samples-big .samples-pic { aspect-ratio: auto; min-height: 460px; }
.samples-side { padding: 18px 24px 22px; display: flex; flex-direction: column; min-width: 0; }
.samples-page button.samples-back { color: var(--studio-muted); font-size: 13px; align-self: flex-start; margin-bottom: 10px; border-radius: 6px; padding: 2px 4px 2px 0; }
.samples-page button.samples-back:hover { color: var(--studio-fg); background: none; }
.samples-side h2 { margin: 0; font-size: 24px; letter-spacing: -.01em; }
.samples-meta { color: var(--studio-muted); font-size: 13px; margin: 2px 0 0; }
.samples-lead { margin: 12px 0 16px; font-size: 14.5px; }
.samples-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.samples-steps li { display: grid; grid-template-columns: 26px 1fr; gap: 10px; align-items: start; font-size: 13.5px; }
.samples-steps .num { width: 24px; height: 24px; border-radius: 50%; background: var(--raise-2); display: grid; place-items: center; font-weight: 650; font-size: 12px; }
.samples-steps b { font-weight: 650; }
.samples-steps b.rec { color: var(--rec); }
.samples-say { display: inline-block; margin-top: 5px; padding: 3px 9px; border-radius: 8px; background: var(--ai-soft); color: var(--ai-text); font-weight: 550; }
.samples-foot { margin-top: auto; padding-top: 20px; }
.samples-page button.samples-go { display: flex; align-items: center; justify-content: center; width: 100%; height: 42px; border-radius: 21px; font-weight: 600; background: var(--solid) !important; color: var(--solid-fg) !important; text-align: center !important; }
.samples-go:disabled { opacity: .6; cursor: progress; }
.samples-note { margin: 8px 0 0; font-size: 13px; color: var(--danger); }

/* Phone: one column, the bar's right side under the heading, the grown card stacked (picture over words). */
@media (max-width: 600px) {
  .samples-bar { padding: 0 16px; }
  .samples-own { display: none; }
  .samples-main { padding: 14px 16px 32px; }
  .samples-head h1 { font-size: 24px; }
  .samples-head p { font-size: 14px; }
  .samples-grid { grid-template-columns: 1fr; gap: 14px; }
  .samples-txt { padding: 10px 12px 12px; }
  .samples-big { grid-template-columns: 1fr; border-radius: 16px; }
  .samples-big .samples-pic { min-height: 0; aspect-ratio: 16 / 10; }
  .samples-side { padding: 14px 16px 18px; }
  .samples-side h2 { font-size: 21px; }
}

/* ---- the guide after a sample opens (samples-tour.ts) ---- */
.tour-card { position: fixed; z-index: 60; width: 340px; max-width: calc(100vw - 32px); box-sizing: border-box; padding: 14px 16px 12px;
  background: var(--glass-thick); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); border-radius: 14px;
  box-shadow: var(--glass-shadow), 0 0 0 .5px var(--glass-edge); color: var(--studio-fg);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif; animation: tour-in .24s cubic-bezier(.2, .8, .2, 1); }
@keyframes tour-in { from { opacity: 0; transform: translateY(-6px); } }
.tour-card .k { font-size: 12px; color: var(--studio-muted); display: flex; justify-content: space-between; align-items: center; }
.tour-card .dots { display: flex; gap: 4px; }
.tour-card .dots i { width: 6px; height: 6px; border-radius: 50%; background: var(--raise-3); }
.tour-card .dots i.on { background: var(--studio-fg); }
.tour-card h4 { margin: 6px 0 4px; font-size: 15px; font-weight: 650; }
.tour-card p { margin: 0; color: var(--studio-muted); }
.tour-card .row { margin-top: 10px; display: flex; gap: 8px; align-items: center; color: var(--studio-muted); font-size: 12.5px; }
.tour-card .row .sp { flex: 1; }
.tour-card kbd { letter-spacing: 0; font: 600 11.5px ui-monospace, Menlo, monospace; padding: 2px 7px; border-radius: 5px; background: var(--raise-2); color: var(--studio-fg); }
.tour-card button { font: inherit; border: 0; background: none; cursor: pointer; color: var(--studio-muted); padding: 4px 6px; border-radius: 6px; min-height: 0; }
.tour-card button:hover { color: var(--studio-fg); }
.tour-card button.next { background: var(--solid); color: var(--solid-fg); font-weight: 600; padding: 4px 12px; border-radius: 13px; }
.tour-ring { position: fixed; z-index: 59; pointer-events: none; border-radius: 999px; box-shadow: 0 0 0 2px var(--ai), 0 0 0 6px var(--ai-soft);
  animation: tour-ring 1.6s ease-in-out infinite; }
@keyframes tour-ring { 50% { box-shadow: 0 0 0 2px var(--ai), 0 0 0 9px transparent; } }
.try-ask { display: flex; gap: 8px; align-items: center; justify-content: center; flex-wrap: wrap; margin: 0 0 8px; pointer-events: auto; }
.try-ask em { font-style: normal; color: var(--studio-muted); font-size: 12.5px; padding: 6px 10px; border-radius: 999px;
  background: var(--glass); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); box-shadow: 0 0 0 .5px var(--glass-edge); }
.try-ask button { min-height: 0; display: inline-block; font: 550 13px/1.3 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; border: 0; cursor: pointer; padding: 6px 12px; border-radius: 999px;
  background: var(--glass); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); box-shadow: 0 0 0 .5px var(--glass-edge); color: var(--ai-text);
  max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 600px) { .tour-card { left: 16px !important; right: 16px !important; width: auto; } }
@media (prefers-reduced-motion: reduce) { .tour-card, .tour-ring { animation: none; } }
`;
