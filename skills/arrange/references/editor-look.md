# Change how the editor looks

The editor page (the "shell" around the game) can be rewritten for one game folder by three files under
`.studio/ui/`. The editor reads them every time it opens. Nothing else changes: not the editor's own files, not the
game, not the saved files.

| File | Use it for |
|---|---|
| `.studio/ui/prefs.json` | The settings the user can also change on the editor's **Look** page (⌘K → Editor look…) |
| `.studio/ui/studio.css` | Colours, sizes, spacing, layout — any CSS, loaded after the editor's own |
| `.studio/ui/shell.js` | Behaviour: move the panel, hide parts, add buttons that call editor actions, rename labels |

**The way back:** add `&ui=off` to the editor URL (the original look; nothing from `.studio/ui/` is loaded or
written), or delete `.studio/ui/`.

What is safe to change: everything you can see in the editor page. What is out of reach on purpose: the game page,
the tool strip, outlines and name tags inside the game, the save format and validation, the server. Do not try to get around that
(for example by reaching into the game iframe from `shell.js`).

## `prefs.json`

```json
{
  "version": 1,
  "panel": "right",
  "width": 320,
  "height": 42,
  "theme": "light",
  "fontSize": 16,
  "handleSize": 60,
  "show": { "thumbs": true, "numbers": true, "help": false, "adapter": true, "play": true,
            "frame": true, "lang": false, "next": false, "tools": true },
  "lang": "ja"
}
```

`panel`: `left` (default) | `right` | `bottom` (phones always use a sheet from the bottom). `width` 240–640 px (the
list column, default 248), `height` 25–75 % (bottom panel and the phone sheet), `theme` `dark` | `light` | `auto`,
`fontSize` 12–20 (default 13; phones add 2), `handleSize` 24–72 (the tool strip's buttons, default 28; phones never
draw them below 44).
Unknown fields are ignored and numbers are clamped, so a typo cannot break the editor.

## `studio.css`

Colours are CSS variables on `:root` (set per theme). Override them with `:root[data-theme]` so your values win in
both themes:

```css
/* Warm light colours, rounder buttons */
:root[data-theme] {
  --studio-page: #fdf0d8; --studio-bg: #fff7e6; --studio-card: #ffffff; --studio-fg: #3b2a12; --studio-muted: #8a6d3b;
  --studio-line: #f0d9a8; --studio-accent: #e8590c; color-scheme: light;
}
button { border-radius: 999px; }
```

The base colours (set these first; every other colour is worked out from them): `--studio-page` (the top bar),
`--studio-bg` (the list column), `--studio-card` (the plates over the game: the picked object's card, the ask bar, the
⌘K list, news; drawn a little see-through), `--studio-fg` (text), `--studio-muted` (second text), `--studio-line`
(lines inside a plate), `--studio-accent` (**your hand**: the picked object's dot, chip and outline in the editor page).
Then: `--raise` `--raise-2` `--raise-3` (control fills: rest / hover / pressed), `--line` (the softest line),
`--text-3` (third text: counts, hints), `--solid` `--solid-fg` (the one solid button, Play), `--ai` `--ai-soft`
`--ai-text` (**your AI's hand**: the spark, the AI's marks), `--you-soft` `--you-text` (the picked object's chip),
`--live` (the AI answered), `--danger`, `--x` `--y` `--z` (the axis letters), `--scrim` (the dim behind the ⌘K list),
`--shadow`, `--studio-thumb` (behind pictures). Sizes: `--studio-font` (the base size), `--studio-panel-w`
`--studio-panel-h`, `--r` (6 px: buttons, fields, rows) `--R` (12 px: plates), `--h` (28 px: buttons and rows; 44 on a
phone) `--bar` (44 px: the top bar and the ask bar). Text sizes `--fs-s` `--fs` `--fs-l` follow `--studio-font`;
numbers use `--mono`. Motion `--dur` `--ease`. The names from before the 2026-10-16 redesign (`--studio-btn`,
`--studio-input`, `--studio-ok`, `--studio-link`…) still exist and read from the ones above. The tool strip,
outlines and name tags over the game keep their colours whatever the theme (orange and violet mean the same thing
everywhere; the strip follows light / dark). The Assets panel (the library) uses the same colours.

Parts have `data-part` attributes: `app` `header` (the top bar: where you are, Saved, the AI, Play) `brand` (▣ Studio /
game / place) `tools` (game tools) `top-actions` (Play) `footer` (Save; Undo on a phone) `save-state` ("✓ Saved" after Save) `peer`
(the AI's dot) `side` (the list column) `tabs` (the Scene / Assets rows) `status` `panel` `noname` (at the column's
foot) `stage` (the game, edge to edge) `card` (the picked object's card; inside it `edit-ops` (copy / delete) `fine`
(the numbers) `layer` `rules` `assets`) `inspector` (where the card floats on PC) `dock` (the bar at the bottom of the
game: news, the phone card, the ⌘K list, the ask field) `ai` (the news line about requests and your status) `palette`
(the ⌘K list) `ask` (the ask field) `bar` (the row holding the ask field; on a phone also the list button)
`assets-page`. Buttons have `data-action`: `play` `save` (Save · 3) `undo` `redo` `sheet` `palette` `ask-ai`
`ask-name` `ask-name-all` `ai-reload` `ai-show` `copy` `remove` `multi` `open-asset` `layer-…`, and your own
`custom-<id>`. The rows of the ⌘K list carry the same `data-action` (`play` `assets` `undo` `redo` `frame` `settings`
`next` `lang` `multi` `select-all` `copy` `remove` `save`) or `data-step` (an idea for the AI).

```css
/* Bigger buttons and text (for a touch screen or a projector) */
:root { --studio-font: 17px; --h: 40px; }
[data-part="top-actions"] button, [data-part="footer"] button { min-height: 36px; font-weight: 600; }
```

## `shell.js`

Runs in the editor page after it has started, with `window.studioShell`:

```js
// List on the right, no ideas in ⌘K, a "Show all" button in the top bar, a friendlier label for Save.
studioShell.setPrefs({ panel: 'right', width: 300 });
studioShell.hide('next');
studioShell.addButton({ id: 'frame-all', label: 'Show all', where: 'footer', onClick: () => studioShell.actions.frameAll() });
studioShell.setText('en', { 'btn.save': 'Keep my layout' }); // also 'ja' for Japanese UI text
```

| Member | Does |
|---|---|
| `part(name)` | The element of a part (see `data-part` above) |
| `addButton({ id, label, where, title, onClick })` | `where`: `top-actions` (default, next to Play), `footer` (top bar, next to Save), `bar` (next to the ask field), `tools` |
| `hide(what)` / `show(what)` | `thumbs` `numbers` `help` `adapter` `play` `frame` (Show all in ⌘K) `lang` (a language word in the top bar) `next` (the ideas in ⌘K) `tools` |
| `prefs()` / `setPrefs(patch)` | Read / change `prefs.json` (saved) |
| `setText(lang, { key: text })` | Replace UI text (`btn.save`, `btn.undo`, `tool.placement`, `ask.game`, …) or add your own keys for `t()` |
| `t(key)`, `lang()` | Text in the current language |
| `items()`, `selected()` | The object list and the selection |
| `actions.undo / redo / save / select(key) / selectMany(keys) / copy / remove / switchTool(id) / frameAll / openSettings / openNextSteps / activateTool(id)` | Editor actions |
| `on('selected' \| 'items' \| 'moved' \| 'saved', cb)` | Events (`saved` = the user pressed Save); returns an unsubscribe function |

Keep `shell.js` small and only about the editor page. If it throws, the editor still works (the error is in the
browser console); fix it or open with `&ui=off`.

## Examples for common requests

| The user says | Do |
|---|---|
| "Put the list on the right" | `prefs.json`: `"panel": "right"` (or `studioShell.setPrefs({ panel: 'right' })`) |
| "Make it light" / "darker" | `prefs.json`: `"theme": "light"`; for other colours, `studio.css` variables |
| "Bigger handles / text" | `prefs.json`: `"handleSize": 44` (the strip's buttons), `"fontSize": 16` |
| "Bigger buttons" | `studio.css` (see above) |
| "Fewer things on screen" | `studioShell.hide('play'); hide('next')`; there is little else: the list, the card and the ask bar are the editor |
| "A button that frames the selected object" | `addButton({ …, onClick: () => studioShell.actions.select(studioShell.selected()) })` |
| "Back to normal" | Delete `.studio/ui/` |
