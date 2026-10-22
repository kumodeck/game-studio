# docs/site

Created: 2026-10-22
Purpose: the public docs of Game Studio, in English and Japanese. The demo site shows them at `/docs/` and
`/docs/ja/` (built by `scripts/build-docs.mjs`, called from `scripts/build-web-demo.mjs`). They read on GitHub too.

## Contents

- `lang/en/*.md` — the English pages (English is written first)
- `lang/ja/*.md` — the Japanese pages, the same file names (the language switch pairs them by name)
- `lang/<lang>/media/` — that language's pictures (`*.webp`, from the screen tests) and diagrams (`*.svg`, light and dark)
- `shots.json` — which photo of which screen test each picture is

## Keeping them right

- **Changed a feature? Fix its page in both languages,** and set `written-for` in the page's front matter to the
  version you checked it against. The footer of each page shows it.
- **Pictures:** never by hand. They are photos the screen tests take (`--shots`), in English for the English pages
  and in Japanese for the Japanese ones: `shots.json` lists the tests to run (with `--lang`) and which photo becomes
  which picture. A new picture = a line in `shots.json` (and, if no test takes it yet, a `--shots` step in a test).
- **Words:** `docs/VOICE.md`. Button names exactly as on screen (`src/shell/i18n.ts`). Only KUMODeck and
  support@kumodeck.com, no other company or person.
- **Markdown:** the part `scripts/docs-md.mjs` reads (its header lists it). Links between pages are `page.md`, and
  `page.md#heading` for a heading; pictures are `media/<name>`. `test/docs-site.test.mjs` builds the pages and fails
  on a broken link or picture; `test/docs-site.browser.mjs` opens them on a phone and a PC, light and dark.

## A page's front matter

```
---
title: Editing            the page's title
nav: Editing              its name in the side list
order: 2                  its place in the side list
written-for: 0.1.18       the version it was checked against
description: …            one line for search results
---
```
