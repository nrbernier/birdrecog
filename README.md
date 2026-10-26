# Swiss Birds — Oiseaux de Suisse 🐦

A phone-friendly quiz game to learn to recognize the ~125 common bird
species of Switzerland, by photo and by song. Bird names can be shown in
English or French.

**Play it here: https://nrbernier.github.io/birdrecog/**

## Run it

No build step, no dependencies — it's plain HTML/CSS/JS. Just serve the
directory and open it on your phone or browser:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

(Serving over HTTP is needed because the game fetches media from the
Wikimedia APIs; opening `index.html` directly from the filesystem may be
blocked by the browser.)

## How to play

- Pick a language (EN/FR, top right), optionally a habitat to practice
  (gardens, forests, water, fields, Alps, raptors & owls), and a mode:
  - **📷 Photo quiz** — name the bird in a photo
  - **🎵 Sound quiz** — name the bird from its song/call
  - **🔍 Find the bird** — given a name, pick the right photo among four
  - **🎧 Song → photo** — hear a song, pick the singer's photo (no names)
  - **👯 Look-alikes** — wrong answers come from the same family
    (tits, finches, warblers, raptors…) — harder, +5 XP per answer
  - **🔁 Review** — species you get wrong (or confuse with others) come up
    more often
  - **🎲 Mixed** — a bit of everything
- Each round has 10 questions. Correct answers earn XP (with a streak
  bonus). XP, level, best streak, accuracy and per-species results are
  saved in your browser (`localStorage`); a species counts as *mastered*
  after 3+ correct answers at ≥80% accuracy.

## Where the media comes from

- **Photos**: up to 40 per species — research-grade observations from
  [iNaturalist](https://www.inaturalist.org) made in Switzerland (topped up
  from the rest of Europe for rarer birds, CC-licensed photos only), the
  lead image of the species' Wikipedia article, and photos from the
  Wikimedia Commons search API (filenames suggesting maps, eggs, skeletons
  or drawings are filtered out). Recently shown photos of a species are
  avoided, so you keep seeing new pictures.
- **Sounds**: recordings on [Wikimedia Commons](https://commons.wikimedia.org)
  (largely mirrored from [xeno-canto](https://xeno-canto.org)), found via the
  Commons search API. OGG recordings are played through Commons' MP3
  transcodes so they work on iOS Safari.
- Media lists are cached in `localStorage` for 30 days. Thin or partial
  results (e.g. one API was down) are retried after 10 minutes instead of
  being cached for good. Each answer screen links to the source
  file page.

## Files

- `index.html` — markup for the three screens (home / quiz / results)
- `styles.css` — mobile-first styling
- `birds.js` — the species list (scientific / English / French names,
  habitat group and look-alike family)
- `app.js` — game logic, media fetching, i18n, persistence
