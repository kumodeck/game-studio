# src/hosts

Created: 2026-10-16
Purpose: StudioHost implementations (CONTRACT.md §3) other than the local
server's (`src/shell/host-local.ts`, which talks to `src/server`).

## Contents

- `browser/` — the browser-only web demo: no server API, no pass, no AI;
  everything is kept in the browser (IndexedDB). Built into one static folder
  by `scripts/build-web-demo.mjs`.
