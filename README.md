# Swiss Birds — Oiseaux de Suisse 🐦

A phone-friendly quiz game to learn to recognize the ~45 most common bird
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

- Pick a language (EN/FR, top right) and a mode:
  - **📷 Photo quiz** — identify the bird from a photo
  - **🎵 Sound quiz** — identify the bird from its song/call
  - **🎲 Mixed quiz** — both, at random
- Each round has 10 multiple-choice questions. Correct answers earn XP
  (with a streak bonus); XP, level, best streak and accuracy are saved in
  your browser (`localStorage`).

## Where the media comes from

- **Photos**: the lead image of each species' Wikipedia article, via the
  [Wikipedia REST API](https://en.wikipedia.org/api/rest_v1/).
- **Sounds**: recordings on [Wikimedia Commons](https://commons.wikimedia.org)
  (largely mirrored from [xeno-canto](https://xeno-canto.org)), found via the
  Commons search API. OGG recordings are played through Commons' MP3
  transcodes so they work on iOS Safari.
- Media URLs are cached in `localStorage` after first lookup, so repeat
  questions don't re-hit the APIs. Each answer screen links to the source
  file page.

## Files

- `index.html` — markup for the three screens (home / quiz / results)
- `styles.css` — mobile-first styling
- `birds.js` — the species list (scientific + English + French names)
- `app.js` — game logic, media fetching, i18n, persistence
