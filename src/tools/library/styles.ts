// Library panel styles, injected once. Class names start with "gsl-" so they
// never collide with the shell's or another tool's.
//
// Colours come from the shell's custom properties when it defines them
// (--studio-*), with light/dark fallbacks so the panel also looks right in
// the dev harness on its own. The panel adapts to its container width, not
// the window: the shell puts it in a right column on PC and in a bottom sheet
// on phones.

const CSS = `
.gsl{--gsl-bg:var(--studio-bg,#f7f8fa);--gsl-fg:var(--studio-fg,#17202a);--gsl-muted:var(--studio-muted,#5d6b7a);
--gsl-line:var(--studio-line,#d9dee5);--gsl-card:var(--studio-card,#fff);--gsl-accent:var(--studio-accent,#2f6fed);
--gsl-used:#1f9d55;--gsl-code:#b7791f;--gsl-unused:#718096;--gsl-missing:#d64545;
container-type:inline-size;display:flex;flex-direction:column;gap:8px;height:100%;min-height:0;box-sizing:border-box;
padding:10px;background:var(--gsl-bg);color:var(--gsl-fg);font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){.gsl{--gsl-bg:var(--studio-bg,#14181e);--gsl-fg:var(--studio-fg,#e6ebf1);--gsl-muted:var(--studio-muted,#9aa7b5);
--gsl-line:var(--studio-line,#2c333d);--gsl-card:var(--studio-card,#1c222a);--gsl-accent:var(--studio-accent,#6b9bff)}}
.gsl *{box-sizing:border-box}
.gsl-bar{display:flex;gap:6px;flex-wrap:wrap}
.gsl-search{flex:1 1 140px;min-width:0;padding:7px 9px;border:1px solid var(--gsl-line);border-radius:8px;background:var(--gsl-card);color:inherit;font:inherit}
.gsl-type{padding:6px;border:1px solid var(--gsl-line);border-radius:8px;background:var(--gsl-card);color:inherit;font:inherit}
.gsl-btn{padding:6px 10px;border:1px solid var(--gsl-line);border-radius:8px;background:var(--gsl-card);color:inherit;font:inherit;cursor:pointer;min-height:32px}
.gsl-btn:disabled{opacity:.5;cursor:default}
.gsl-primary{background:var(--gsl-accent);border-color:var(--gsl-accent);color:#fff}
.gsl-chips{display:flex;gap:6px;flex-wrap:wrap}
.gsl-more,.gsl-more-menu{display:none}
.gsl-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:1px solid var(--gsl-line);border-radius:999px;background:var(--gsl-card);color:inherit;font:inherit;cursor:pointer}
.gsl-chip[aria-pressed=true]{border-color:var(--gsl-accent);box-shadow:inset 0 0 0 1px var(--gsl-accent)}
.gsl-chip b{font-variant-numeric:tabular-nums}
.gsl-dot{width:8px;height:8px;border-radius:50%}
.gsl-dot-used{background:var(--gsl-used)}.gsl-dot-codeOnly{background:var(--gsl-code)}.gsl-dot-unused{background:var(--gsl-unused)}.gsl-dot-missing{background:var(--gsl-missing)}
.gsl-count{color:var(--gsl-muted);font-size:12px}
.gsl-grid{flex:1 1 auto;min-height:80px;overflow:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px;align-content:start;border-radius:8px}
.gsl-grid.gsl-dragover,.gsl-drop.gsl-dragover{outline:2px dashed var(--gsl-accent);outline-offset:-2px}
.gsl-tile{display:flex;flex-direction:column;gap:4px;padding:6px;border:1px solid var(--gsl-line);border-radius:10px;background:var(--gsl-card);color:inherit;font:inherit;text-align:left;cursor:pointer;min-width:0}
.gsl-tile:focus-visible{outline:2px solid var(--gsl-accent);outline-offset:1px}
.gsl-tile.gsl-open{border-color:var(--gsl-accent);box-shadow:0 0 0 1px var(--gsl-accent)}
.gsl-thumb{position:relative;aspect-ratio:1;border-radius:7px;overflow:hidden;display:grid;place-items:center;
background:repeating-conic-gradient(#8881 0 25%,#0000 0 50%) 0 0/16px 16px;color:var(--gsl-muted)}
.gsl-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.gsl-icon{font-size:26px}
.gsl-font-sample{font-size:34px;color:var(--gsl-fg)}
.gsl-play{position:absolute;right:6px;bottom:6px;width:36px;height:36px;border-radius:50%;border:0;background:var(--gsl-accent);color:#fff;font-size:14px;cursor:pointer}
.gsl-name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gsl-meta{display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-width:0}
.gsl-badge{font-size:11px;padding:1px 6px;border-radius:999px;color:#fff;white-space:nowrap}
.gsl-badge-used{background:var(--gsl-used)}.gsl-badge-codeOnly{background:var(--gsl-code)}.gsl-badge-unused{background:var(--gsl-unused)}.gsl-badge-missing{background:var(--gsl-missing)}
.gsl-tag{font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--gsl-line);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.gsl-tag-new{border-color:var(--gsl-accent);color:var(--gsl-accent)}
.gsl-tag-del{border-color:var(--gsl-missing);color:var(--gsl-missing)}
.gsl-del{color:var(--gsl-missing)}
.gsl-empty{grid-column:1/-1;color:var(--gsl-muted);padding:16px;text-align:center}
.gsl-readfail{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--gsl-missing);border-radius:10px;background:var(--gsl-card)}
.gsl-readfail[hidden]{display:none}
.gsl-readfail>span{flex:1 1 180px;min-width:0;overflow-wrap:anywhere}
.gsl-detail{border:1px solid var(--gsl-line);border-radius:10px;background:var(--gsl-card);padding:10px;max-height:55%;overflow:auto;flex:0 0 auto}
.gsl-dhead{display:grid;grid-template-columns:96px 1fr auto;gap:10px;align-items:start}
.gsl-dtitle{display:flex;flex-direction:column;min-width:0;gap:2px}
.gsl-dtitle b{overflow-wrap:anywhere}
.gsl-path{color:var(--gsl-muted);font-size:12px;overflow-wrap:anywhere}
.gsl-close{width:32px;padding:0}
.gsl-dinfo{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0}
.gsl-hint{color:var(--gsl-muted)}
.gsl-size{margin-left:auto;color:var(--gsl-muted);font-variant-numeric:tabular-nums}
.gsl-section{margin-top:8px}
.gsl-section h4{margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--gsl-muted)}
.gsl-muted{margin:0;color:var(--gsl-muted)}
.gsl-keys{display:flex;flex-wrap:wrap;gap:6px}
.gsl-key{padding:4px 9px;border-radius:7px;border:1px solid var(--gsl-accent);background:transparent;color:var(--gsl-accent);font:inherit;cursor:pointer;min-height:30px}
.gsl-guess{font-style:normal;color:var(--gsl-muted)}
.gsl-files{margin:0;padding-left:18px;overflow-wrap:anywhere}
.gsl-replace{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.gsl-repline{display:flex;flex-wrap:wrap;gap:6px;overflow-wrap:anywhere}
.gsl-picker{width:100%;border-top:1px solid var(--gsl-line);padding-top:8px}
.gsl-pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:6px}
.gsl-small{padding:4px;font-size:12px}
.gsl-drop{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:12px;border:1.5px dashed var(--gsl-line);border-radius:10px;color:var(--gsl-muted);cursor:pointer}
.gsl-ai{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--gsl-line);border-radius:10px;background:var(--gsl-card);flex:0 0 auto;max-height:70%;overflow:auto}
.gsl-ai p{margin:0}
.gsl-ai-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.gsl-ai-acct{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--gsl-muted);font-size:12px;font-variant-numeric:tabular-nums}
.gsl-ai-link{color:var(--gsl-accent)}
.gsl-ai-kinds,.gsl-ai-opts{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.gsl-ai-prompt{width:100%;resize:vertical;padding:7px 9px;border:1px solid var(--gsl-line);border-radius:8px;background:var(--gsl-bg);color:inherit;font:inherit}
.gsl-ai-check{display:flex;gap:6px;align-items:center}
.gsl-ai-terms{border-top:1px solid var(--gsl-line);padding-top:8px;display:flex;flex-direction:column;gap:6px}
.gsl-ai-cmd{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.gsl-ai-cmd code{padding:6px 9px;border-radius:7px;background:var(--gsl-bg);border:1px solid var(--gsl-line);font:12px ui-monospace,SFMono-Regular,Menlo,monospace;user-select:all}
.gsl-ai-make,.gsl-ai-again{align-self:flex-start}
.gsl-ai-bad{color:var(--gsl-missing)}
.gsl-ai-note{color:var(--gsl-fg)}
.gsl-ai-detail{font-size:12px;overflow-wrap:anywhere}
.gsl-ai-wait{font-size:12px;font-variant-numeric:tabular-nums}
.gsl-ai-late{color:var(--gsl-code)}
.gsl-heavy{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.gsl-heavy p{margin:0;color:var(--gsl-code)}
.gsl-thumb-wait .gsl-icon{animation:gsl-wait 1.6s ease-in-out infinite}
.gsl-thumb-wait::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 30%,rgba(255,255,255,.14) 50%,transparent 70%);background-size:220% 100%;animation:gsl-sweep 1.8s linear infinite;pointer-events:none}
.gsl-wait-label{position:absolute;left:4px;right:4px;bottom:6px;text-align:center;font-size:11px;line-height:1.2;color:var(--gsl-muted)}
.gsl-thumb-wait:has(.gsl-wait-label) .gsl-icon{margin-bottom:22px}
.gsl-tag-making{font-variant-numeric:tabular-nums}
@keyframes gsl-wait{50%{opacity:.35}}
@keyframes gsl-sweep{from{background-position:120% 0}to{background-position:-120% 0}}
@media (prefers-reduced-motion:reduce){.gsl-thumb-wait .gsl-icon,.gsl-thumb-wait::after{animation:none}}
.gsl-foot{display:flex;gap:8px;align-items:center;min-height:32px}
.gsl-status{flex:1;color:var(--gsl-muted);overflow:hidden;text-overflow:ellipsis}
.gsl-pending{color:var(--gsl-code);font-weight:600}
@container (max-width:420px){.gsl-grid{grid-template-columns:repeat(auto-fill,minmax(84px,1fr))}.gsl-dhead{grid-template-columns:64px 1fr auto}.gsl-detail{max-height:60%}}
`;

let done = false;
export function injectStyles(doc: Document = document): void {
  if (done) return;
  done = true;
  const s = doc.createElement('style');
  s.dataset.studio = 'library';
  s.textContent = CSS;
  doc.head.append(s);
}
