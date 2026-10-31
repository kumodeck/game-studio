# media

Created: 2026-10-17 (retaken on v0.1.11's screens on 2026-10-21)
Purpose: the pictures at the top of the README. Real screens of the editor (headless Chrome), nothing drawn over
them except the pointer.

- `studio-loop.webp` — the moving picture at the top of the README (14.6 s, loops, 880×496, 10 fps, 2.93 MB): type
  “Add three lighthouses around the island,” your AI adds them, only the new ones glow violet, Undo AI change, and back
  to the first picture. The AI's wait plays faster and says “Sped up.”
- `studio.jpg` — a still of the same moment (1600×1000), for places that don't play animations.
- `social-en.jpg`, `social-ja.jpg` — the link-preview pictures (og:image) of the web demo's pages, 1200×630, English
  and Japanese screens (added 2026-10-29). The `pc-light-*-picked.png` photo of `test/w1-shots.browser.mjs --only pc
  --theme light [--lang ja]` (the same run as the docs' `selected.webp`), its top 1280×672 scaled to 1200×630:
  `magick <photo> -crop 1280x672+0+0 +repage -resize 1200x630! -strip -quality 84 social-en.jpg`.
  `scripts/build-web-demo.mjs` copies them to the site's root.
