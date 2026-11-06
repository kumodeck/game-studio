# big-swell

Created: 2026-11-06
Purpose: 3D starter (three.js), first on the sample shelf. A rough sea at sunset: ducks, buoys, a raft and crates ride
the waves, a big swell rolls in every 6 s and lifts them all, crates drop in with a splash. Water, physics and light
that read in 1 second and look good in a 10-second clip. Tap the water to drop a crate.

- `index.html`: the canvas, a small HUD (BIG SWELL / Tap the water to drop a crate / Afloat n), the import map
  (three 0.187.0 from jsDelivr)
- `game.js`: everything else (about 550 lines, one file on purpose: a newcomer's AI reads one file):
  - the sea: `seaAt(x, z, t)`, ONE height function used by both the surface you see and the floating things, so they
    ride exactly the waves on screen
  - the floating things: each is an editable group (what the editor moves) with a child `bob` (what the waves move),
    so a thing you drag keeps riding the waves from where you put it
  - the big swells (`SWELL_EVERY`, `SWELL_TALL`), the dropped crates and splashes (made by the game, never saved),
    the lighthouse and its beam
  - the number to ask an AI to change: `WAVE_HEIGHT` at the top (1.0 = rough sea; 2.0 = a storm)
  - auto quality: below ~45 fps in the first 2 s it renders at pixel ratio 1 (`setQuality`, the same rule as Lantern
    Cove), so it stays smooth on phones
- `studio-placement.js`: applies a saved `placement.json` at start (copy of the skill's loader, refreshed by the build)
- `starter.json`, `thumb.png`: what the shelf shows; `try` is the sample's "Try" (the thing to move, the second to
  pause at, the words to ask)
- `strings.json`: the Try's words in Japanese

No asset files: every picture is made by code, and the only thing loaded from outside is three.js. Everything moves by
the time between frames and is seeded, so the editor's Try replays to the same picture.

Objects: buoy ×2, duck ×2, raft, ball, crate ×2, rock ×2, lighthouse.

URL switches (tests and shots): `?fixed=30` (every frame advances exactly 1/30 s), `?quality=low|high` (skip the
automatic check).

Checked by `test/shelf-try.test.mjs` (the shape and the Try) and `test/studio-shelf-swell.browser.mjs` (speed on a
PC and a slowed phone; the Try in the editor up to ● Clip Before / After).
