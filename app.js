/* Swiss bird recognition quiz.
   Photos come from iNaturalist (research-grade observations made in
   Switzerland), the Wikipedia lead image and Wikimedia Commons search;
   sounds from Wikimedia Commons (mostly xeno-canto recordings).
   Media lists are cached in localStorage, and thin or partial results are
   re-fetched later instead of being cached forever. */

const ROUND_LEN = 10;
const N_OPTIONS = 4;
const XP_PER_LEVEL = 100;

const T = {
  en: {
    title: "Swiss Birds",
    tagline: "Learn to recognize the common birds of Switzerland",
    level: "Level", bestStreak: "Best streak", accuracy: "Accuracy", mastered: "Mastered",
    practice: "Practice",
    groups: { all: "All birds", garden: "Gardens", forest: "Forests", water: "Water",
              open: "Fields", mountain: "Alps", raptor: "Raptors & owls" },
    modes: {
      photo: ["Photo quiz", "Name the bird in the photo"],
      sound: ["Sound quiz", "Name the bird from its song"],
      pickphoto: ["Find the bird", "Pick the right photo for a name"],
      soundphoto: ["Song → photo", "Hear a song, pick the singer's photo"],
      lookalike: ["Look-alikes", "Tricky choices between similar birds"],
      review: ["Review", "Focus on the birds you get wrong"],
      mixed: ["Mixed", "A bit of everything"],
    },
    whichBird: "Which bird is this?", whoSings: "Who is singing?",
    findBird: "Find the", whichPhoto: "Which bird is singing?",
    correct: "Correct!", wrong: "Not quite…",
    next: "Next", finish: "See results",
    loading: "Loading…", playHint: "Tap to play the recording",
    error: "Could not load media. Check your connection.", retry: "Retry",
    roundDone: "Round complete!", xpGained: "XP earned",
    playAgain: "Play again", home: "Menu",
    source: "Recording source", photoSource: "Photo source",
    credits: "Photos: iNaturalist, Wikipedia & Wikimedia Commons · Sounds: Wikimedia Commons / xeno-canto",
    xpToNext: "XP to next level",
  },
  fr: {
    title: "Oiseaux de Suisse",
    tagline: "Apprends à reconnaître les oiseaux communs de Suisse",
    level: "Niveau", bestStreak: "Meilleure série", accuracy: "Précision", mastered: "Maîtrisés",
    practice: "S'entraîner sur",
    groups: { all: "Tous", garden: "Jardins", forest: "Forêts", water: "Eau",
              open: "Champs", mountain: "Alpes", raptor: "Rapaces & chouettes" },
    modes: {
      photo: ["Quiz photos", "Nomme l'oiseau sur la photo"],
      sound: ["Quiz sons", "Nomme l'oiseau à son chant"],
      pickphoto: ["Trouve l'oiseau", "Choisis la bonne photo pour un nom"],
      soundphoto: ["Chant → photo", "Écoute un chant, trouve le chanteur"],
      lookalike: ["Sosies", "Choix difficiles entre oiseaux semblables"],
      review: ["Révision", "Les oiseaux sur lesquels tu te trompes"],
      mixed: ["Mixte", "Un peu de tout"],
    },
    whichBird: "Quel est cet oiseau ?", whoSings: "Qui chante ?",
    findBird: "Trouve :", whichPhoto: "Quel oiseau chante ?",
    correct: "Correct !", wrong: "Raté…",
    next: "Suivant", finish: "Voir les résultats",
    loading: "Chargement…", playHint: "Touche pour écouter l'enregistrement",
    error: "Impossible de charger le média. Vérifie ta connexion.", retry: "Réessayer",
    roundDone: "Manche terminée !", xpGained: "XP gagnés",
    playAgain: "Rejouer", home: "Menu",
    source: "Source de l'enregistrement", photoSource: "Source de la photo",
    credits: "Photos : iNaturalist, Wikipédia & Wikimedia Commons · Sons : Wikimedia Commons / xeno-canto",
    xpToNext: "XP avant le prochain niveau",
  },
};

const MODES = ["photo", "sound", "pickphoto", "soundphoto", "lookalike", "review", "mixed"];
const MODE_ICONS = { photo: "📷", sound: "🎵", pickphoto: "🔍", soundphoto: "🎧",
                     lookalike: "👯", review: "🔁", mixed: "🎲" };

/* ---------- persistent state ---------- */

const STATS_KEY = "birdrecog.stats.v1";
const MEDIA_KEY = "birdrecog.media.v5"; // v5: Wikipedia galleries + photo scores
const SEEN_KEY = "birdrecog.seen.v1";   // recently shown media per species
for (const old of ["birdrecog.media.v2", "birdrecog.media.v3", "birdrecog.media.v4"]) localStorage.removeItem(old);

function load(key, dflt) {
  try { return JSON.parse(localStorage.getItem(key)) || dflt; } catch { return dflt; }
}
function store(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { console.warn("storage full?", e); }
}

const stats = Object.assign(
  { lang: "en", xp: 0, bestStreak: 0, total: 0, correct: 0, group: "all", sp: {} },
  load(STATS_KEY, {})
);
stats.sp = stats.sp || {};
const mediaCache = load(MEDIA_KEY, {});
const seen = load(SEEN_KEY, {});

const saveStats = () => store(STATS_KEY, stats);
const saveMedia = () => store(MEDIA_KEY, mediaCache);
const saveSeen = () => store(SEEN_KEY, seen);

/* ---------- media fetching ---------- */

const MIN_GOOD = 6;              // fewer photos than this counts as a thin result
const FRESH_MS = 30 * 864e5;     // good results are kept for 30 days
const RETRY_MS = 10 * 60e3;      // thin / partial results are retried after 10 min
const MAX_IMGS = 50;

/* Photo quality tiers (img.q):
   1 = curated: photos in the species' Wikipedia articles (en/fr/de),
       Commons "Quality images" and "Featured pictures", and iNaturalist
       photos faved by 3+ people
   2 = decent: large Commons photos, iNaturalist photos faved at least once
   3 = rough: everything else — distant, blurry, odd angles, low resolution
   New birds are shown with tier 1 photos only; harder tiers are mixed in
   as you get a species right more often (see maxTierFor). */

function cacheEntry(sci) {
  return (mediaCache[sci] = mediaCache[sci] || {});
}

function isFresh(list, at, partial) {
  if (!list || !at) return false;
  const age = Date.now() - at;
  if (partial || list.length < MIN_GOOD) return age < RETRY_MS;
  return age < FRESH_MS;
}

// Files whose name suggests they don't show a living bird in the field:
// range maps, eggs (museum collections like MHNT), skeletons, drawings…
const NON_PHOTO =
  /\bmap\b|distribution|range map|\beggs?\b|\bnest\b|skull|skeleton|specimen|museum|mhnt|naturalis|drawing|illustration|diagram|stamp|logo|feather/i;

// Switzerland bounding box; falls back to all of Europe for rarer species.
const CH_BOX = "&swlat=45.8&swlng=5.9&nelat=47.85&nelng=10.5";
const EU_BOX = "&swlat=36&swlng=-10&nelat=60&nelng=30";

async function fetchINatImages(sci, box) {
  const url =
    "https://api.inaturalist.org/v1/observations?quality_grade=research&photos=true" +
    "&photo_license=cc0,cc-by,cc-by-sa,cc-by-nc,cc-by-nc-sa&per_page=40" +
    "&taxon_name=" + encodeURIComponent(sci) + box;
  const res = await fetch(url);
  if (!res.ok) throw new Error("inaturalist " + res.status);
  const j = await res.json();
  const imgs = [];
  for (const obs of j.results || []) {
    const ph = obs.photos?.[0];
    if (!ph?.url) continue;
    const dim = ph.original_dimensions;
    const lowRes = dim && Math.max(dim.width, dim.height) < 1000;
    imgs.push({
      q: lowRes ? 3 : obs.faves_count >= 3 ? 1 : obs.faves_count >= 1 ? 2 : 3,
      s: (obs.faves_count || 0) + (lowRes ? 0 : 0.5), // ranks photos within a tier
      u: ph.url.replace("/square.", "/large."),
      f: ph.url.replace("/square.", "/medium."),
      t: ph.url.replace("/square.", "/medium."), // smaller version for photo tiles
      p: "https://www.inaturalist.org/observations/" + obs.id,
      a: ph.attribution || "",
    });
  }
  return imgs;
}

async function fetchINat(sci) {
  const imgs = await fetchINatImages(sci, CH_BOX);
  if (imgs.length >= 15) return imgs;
  return imgs.concat(await fetchINatImages(sci, EU_BOX).catch(() => []));
}

async function fetchWikipediaImage(sci) {
  const url =
    "https://en.wikipedia.org/api/rest_v1/page/summary/" +
    encodeURIComponent(sci.replace(/ /g, "_"));
  const res = await fetch(url);
  if (!res.ok) throw new Error("wikipedia " + res.status);
  const j = await res.json();
  if (!j.thumbnail) return [];
  // Wikimedia only renders thumbnails at fixed bucket widths; 960px is one.
  const src = j.originalimage && j.originalimage.width < 960
    ? j.originalimage.source
    : j.thumbnail.source.replace(/\/\d+px-/, "/960px-");
  return [{ q: 1, s: 3, u: src, f: j.thumbnail.source, p: j.content_urls?.desktop?.page || "", a: "Wikipedia" }];
}

// Commons file search. `extra` narrows it, e.g. to curated categories.
async function commonsSearch(sci, extra, limit) {
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
    `&generator=search&gsrnamespace=6&gsrlimit=${limit}` +
    "&prop=imageinfo&iiprop=url|size&iiurlwidth=960" +
    "&gsrsearch=" + encodeURIComponent(`"${sci}" filetype:bitmap ${extra}`);
  const res = await fetch(api);
  if (!res.ok) throw new Error("commons " + res.status);
  const j = await res.json();
  const imgs = [];
  for (const p of Object.values(j.query?.pages || {})) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    if (!/\.jpe?g$/i.test(info.url)) continue; // maps/drawings are usually png/svg
    if (NON_PHOTO.test(p.title)) continue;
    if (info.width < 500 || info.height < 400) continue;
    imgs.push({
      w: Math.max(info.width, info.height),
      u: info.thumburl || info.url, f: info.url, p: info.descriptionurl, a: "Wikimedia Commons",
    });
  }
  return imgs;
}

// All photos used in the species' Wikipedia articles: chosen by editors, so
// usually clear identification shots. Different languages pick different ones.
async function fetchWikipediaGallery(sci, lang) {
  const url =
    `https://${lang}.wikipedia.org/api/rest_v1/page/media-list/` +
    encodeURIComponent(sci.replace(/ /g, "_"));
  const res = await fetch(url);
  if (!res.ok) throw new Error("wikipedia media " + res.status);
  const j = await res.json();
  const imgs = [];
  for (const it of j.items || []) {
    if (it.type !== "image" || !/\.jpe?g$/i.test(it.title || "")) continue;
    if (NON_PHOTO.test(it.title)) continue;
    const srcs = (it.srcset || []).map((x) => (x.src.startsWith("//") ? "https:" + x.src : x.src));
    if (!srcs.length) continue;
    const big = srcs[srcs.length - 1];
    imgs.push({
      q: 1, s: it.leadImage ? 3 : 2,
      u: /\/\d+px-/.test(big) ? big.replace(/\/\d+px-/, "/960px-") : big,
      f: big,
      p: "https://commons.wikimedia.org/wiki/" + encodeURIComponent(it.title.replace(/ /g, "_")),
      a: "Wikipedia",
    });
  }
  return imgs;
}

const fetchWikipediaGalleries = (sci) =>
  Promise.allSettled(["en", "fr", "de"].map((l) => fetchWikipediaGallery(sci, l))).then((rs) => {
    if (rs.every((r) => r.status === "rejected")) throw rs[0].reason;
    return rs.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  });

const fetchCommonsCurated = (sci) =>
  commonsSearch(sci, "incategory:Quality_images|Featured_pictures_on_Wikimedia_Commons", 30)
    .then((imgs) => imgs.map(({ w, ...img }) => ({ ...img, q: 1, s: 2 })));

const fetchCommonsImages = (sci) =>
  commonsSearch(sci, "", 30)
    .then((imgs) => imgs.map(({ w, ...img }) => ({ ...img, q: w >= 1600 ? 2 : 3, s: w / 1000 })));

// Give up on a slow source instead of holding the whole question back.
const withTimeout = (p, ms) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);

const inflight = {};

// Wikimedia serves one file at many sizes (…/thumb/x/xy/Name.jpg/960px-Name.jpg);
// identify it by file name so the same picture isn't counted twice.
function fileKey(url) {
  if (!/wikimedia|wikipedia/.test(url)) return url;
  return decodeURIComponent(url.split("/").pop()).replace(/^\d+px-/, "").toLowerCase();
}

async function getImages(sci) {
  const entry = cacheEntry(sci);
  if (isFresh(entry.imgs, entry.imgsAt, entry.imgsPartial)) return entry.imgs;
  const key = "img:" + sci;
  if (inflight[key]) return inflight[key];
  return (inflight[key] = (async () => {
    try {
      const sources = [fetchWikipediaImage, fetchWikipediaGalleries, fetchCommonsCurated,
                       fetchCommonsImages, fetchINat];
      const results = await Promise.allSettled(sources.map((f) => withTimeout(f(sci), 9000)));
      if (results.every((r) => r.status === "rejected")) {
        if (entry.imgs?.length) return entry.imgs; // keep the stale list
        throw results[0].reason;
      }
      // Merge, best tier first, so the cap only ever drops rough photos.
      const byUrl = new Map();
      for (const r of results)
        if (r.status === "fulfilled")
          for (const img of r.value) {
            const k = fileKey(img.u);
            const prev = byUrl.get(k);
            if (!prev || img.q < prev.q) byUrl.set(k, img);
          }
      const imgs = [...byUrl.values()]
        .sort((a, b) => a.q - b.q || (b.s || 0) - (a.s || 0))
        .slice(0, MAX_IMGS);
      // Don't let a flaky refresh shrink a good list we already had.
      if ((entry.imgs?.length || 0) > imgs.length) return entry.imgs;
      entry.imgs = imgs;
      entry.imgsAt = Date.now();
      entry.imgsPartial = results.some((r) => r.status === "rejected");
      saveMedia();
      return entry.imgs;
    } finally {
      delete inflight[key];
    }
  })());
}

async function getAudio(sci) {
  const entry = cacheEntry(sci);
  if (isFresh(entry.audio, entry.audioAt, false) || (entry.audio?.length >= 3 && entry.audioAt))
    return entry.audio;
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
    "&generator=search&gsrnamespace=6&gsrlimit=15&prop=imageinfo&iiprop=url" +
    "&gsrsearch=" + encodeURIComponent(`"${sci}" filetype:audio`);
  let res;
  try {
    res = await fetch(api);
    if (!res.ok) throw new Error("commons " + res.status);
  } catch (e) {
    if (entry.audio?.length) return entry.audio;
    throw e;
  }
  const j = await res.json();
  const mp3s = [], oggs = [];
  for (const p of Object.values(j.query?.pages || {})) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const item = { u: info.url, p: info.descriptionurl };
    if (/\.(mp3|wav)$/i.test(info.url)) mp3s.push(item);
    else if (/\.(ogg|oga)$/i.test(info.url)) {
      // iOS Safari can't play ogg — use the Commons mp3 transcode instead.
      const name = info.url.split("/").pop();
      item.u =
        info.url.replace("/wikipedia/commons/", "/wikipedia/commons/transcoded/") +
        "/" + name + ".mp3";
      oggs.push(item);
    }
  }
  entry.audio = mp3s.concat(oggs);
  entry.audioAt = Date.now();
  saveMedia();
  return entry.audio;
}

// Pick a photo/recording the player hasn't seen recently for this species.
function pickMedia(sci, list) {
  if (!list?.length) return null;
  const recentUrls = seen[sci] || [];
  const keep = Math.min(recentUrls.length, list.length - 1);
  const avoid = new Set(recentUrls.slice(-keep));
  const fresh = list.filter((m) => !avoid.has(m.u));
  const m = rand(fresh.length ? fresh : list);
  seen[sci] = recentUrls.filter((u) => u !== m.u).concat(m.u).slice(-25);
  saveSeen();
  return m;
}

/* ---------- helpers ---------- */

const $ = (id) => document.getElementById(id);
const tr = () => T[stats.lang];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function weightedPick(items, weight) {
  const ws = items.map(weight);
  let r = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) if ((r -= ws[i]) <= 0) return items[i];
  return items[items.length - 1];
}

function level() { return Math.floor(stats.xp / XP_PER_LEVEL) + 1; }

function spStats(sci) { return stats.sp[sci] || [0, 0]; } // [right, wrong]
function isMastered(sci) {
  const [r, w] = spStats(sci);
  return r >= 3 && r / (r + w) >= 0.8;
}

function activePool() {
  return stats.group === "all" ? BIRDS : BIRDS.filter((b) => b.group === stats.group);
}

/* ---------- round state ---------- */

let round = null;    // { mode, n, score, streak, xpGained }
let question = null; // { bird, qMode, answerKind, media, options:[{bird,img}] }
let recent = [];     // recently asked species, avoided when picking
const reserved = new Set(); // species of questions currently being prepared
let upcoming = [];   // prefetched questions (promises), next one first
const audio = new Audio();

audio.addEventListener("ended", () => $("eq").classList.remove("playing"));
audio.addEventListener("pause", () => $("eq").classList.remove("playing"));
audio.addEventListener("play", () => $("eq").classList.add("playing"));

/* ---------- question generation ---------- */

// Wrong answers: look-alikes come from the same family first, then the same
// habitat; normal questions draw from the practice pool, topped up from all.
function pickDistractors(bird, n, lookalike) {
  const others = BIRDS.filter((b) => b !== bird);
  const tiers = lookalike
    ? [others.filter((b) => b.fam === bird.fam),
       others.filter((b) => b.fam !== bird.fam && b.group === bird.group),
       others]
    : [activePool().filter((b) => b !== bird), others];
  const out = [];
  for (const tier of tiers)
    for (const b of shuffle([...tier]))
      if (out.length < n && !out.includes(b)) out.push(b);
  return out;
}

function candidateBirds(kind) {
  const field = kind === "sound" ? "audio" : "imgs";
  return activePool().filter((b) => {
    if (recent.includes(b.sci) || reserved.has(b.sci)) return false;
    const cached = mediaCache[b.sci]?.[field];
    return cached === undefined || cached.length > 0;
  });
}

// Order candidates: random, or weighted toward mistakes for review mode.
function orderCandidates(cands, review) {
  if (!review) return shuffle(cands);
  const out = [], left = [...cands];
  while (left.length && out.length < 8) {
    const b = weightedPick(left, (x) => {
      const [r, w] = spStats(x.sci);
      return (1 + 3 * w) / (1 + r);
    });
    out.push(b);
    left.splice(left.indexOf(b), 1);
  }
  return out;
}

// How rough a photo may be for this bird, given how well you know it.
function maxTierFor(sci) {
  const [right] = spStats(sci);
  return right < 2 ? 1 : right < 4 ? 2 : 3;
}

const MIN_VARIETY = 6; // never cycle through fewer photos than this

async function photoFor(bird) {
  const imgs = await getImages(bird.sci); // sorted best first
  if (!imgs?.length) return null;
  const max = maxTierFor(bird.sci);
  const allowed = imgs.filter((m) => m.q <= max);
  // Too few good photos for this bird? Top up with the best-ranked of the
  // rest rather than showing the same two pictures over and over.
  for (const m of imgs)
    if (allowed.length < MIN_VARIETY && m.q > max) allowed.push(m);
  return pickMedia(bird.sci, allowed);
}

async function makeQuestion(mode) {
  let sub = mode;
  if (mode === "mixed") sub = rand(["photo", "sound", "pickphoto", "soundphoto"]);
  if (mode === "review" || mode === "lookalike") sub = rand(["photo", "photo", "sound"]);

  const qMode = sub === "sound" || sub === "soundphoto" ? "sound" : "photo";
  const answerKind = sub === "pickphoto" || sub === "soundphoto" ? "photo" : "name";
  const lookalike = mode === "lookalike";

  // Cap network attempts so an offline session shows the retry screen
  // instead of hammering the APIs for every species.
  const cands = orderCandidates(candidateBirds(qMode), mode === "review").slice(0, 8);
  for (const bird of cands) {
    if (reserved.has(bird.sci)) continue;
    reserved.add(bird.sci);
    try {
      let media = null;
      if (sub === "sound" || sub === "soundphoto") media = pickMedia(bird.sci, await getAudio(bird.sci));
      else if (sub === "photo") media = await photoFor(bird);
      if (!media && sub !== "pickphoto") continue; // no media for this species

      let options;
      if (answerKind === "name") {
        options = [bird, ...pickDistractors(bird, N_OPTIONS - 1, lookalike)].map((b) => ({ bird: b }));
      } else {
        // Photo answers: need a photo for the target and for each distractor.
        const pool = [bird, ...pickDistractors(bird, N_OPTIONS + 1, lookalike)];
        const got = await Promise.all(pool.map((b) => photoFor(b).catch(() => null)));
        if (!got[0]) continue;
        options = [{ bird, img: got[0] }];
        for (let i = 1; i < pool.length && options.length < N_OPTIONS; i++)
          if (got[i]) options.push({ bird: pool[i], img: got[i] });
        if (options.length < N_OPTIONS) continue;
      }

      recent.push(bird.sci);
      if (recent.length > Math.min(8, Math.floor(activePool().length / 2))) recent.shift();
      return { bird, qMode: sub === "pickphoto" ? "none" : qMode, answerKind, media, options: shuffle(options) };
    } catch (e) {
      console.warn("media fetch failed for", bird.sci, e);
    } finally {
      reserved.delete(bird.sci);
    }
  }
  return null; // everything failed (offline?)
}

/* ---------- prefetching ---------- */

const PREFETCH = 2; // questions prepared ahead while you answer

function preloadImage(url) {
  return new Promise((resolve) => {
    if (!url) return resolve();
    const im = new Image();
    const done = () => resolve();
    im.onload = im.onerror = done;
    setTimeout(done, 10000); // don't hold the question back forever
    im.src = url;
  });
}

const tileUrl = (img) => img.t || img.u;

// Download the question's photos / recording so it shows instantly.
async function preloadQuestion(q) {
  if (!q) return q;
  const urls = [];
  if (q.qMode === "photo") urls.push(q.media.u);
  if (q.answerKind === "photo") for (const o of q.options) urls.push(tileUrl(o.img));
  if (q.qMode === "sound") {
    const a = new Audio();
    a.preload = "auto";
    a.src = q.media.u;
    q.audioEl = a;
  }
  await Promise.all(urls.map(preloadImage));
  return q;
}

function fillQueue() {
  const r = round;
  if (!r) return;
  while (upcoming.length < PREFETCH && r.made < ROUND_LEN) {
    r.made++;
    const p = makeQuestion(r.mode).then(preloadQuestion);
    p.catch(() => {});
    upcoming.push(p);
  }
}

/* ---------- rendering ---------- */

function show(screen) {
  for (const s of ["home", "quiz", "results"])
    $("screen-" + s).classList.toggle("hidden", s !== screen);
}

function renderHome() {
  const t = tr();
  document.documentElement.lang = stats.lang;
  document.title = t.title;
  $("t-title").textContent = t.title;
  $("t-tagline").textContent = t.tagline;
  $("t-level").textContent = t.level;
  $("t-best-streak").textContent = t.bestStreak;
  $("t-accuracy").textContent = t.accuracy;
  $("t-mastered").textContent = t.mastered;
  $("t-practice").textContent = t.practice;
  $("t-credits").textContent = t.credits;
  $("lang-en").classList.toggle("active", stats.lang === "en");
  $("lang-fr").classList.toggle("active", stats.lang === "fr");

  $("stat-level").textContent = level();
  $("stat-streak").textContent = stats.bestStreak;
  $("stat-accuracy").textContent = stats.total
    ? Math.round((100 * stats.correct) / stats.total) + "%"
    : "–";
  const pool = activePool();
  $("stat-mastered").textContent = `${pool.filter((b) => isMastered(b.sci)).length}/${pool.length}`;
  const into = stats.xp % XP_PER_LEVEL;
  $("xp-fill").style.width = into + "%";
  $("xp-text").textContent = `${XP_PER_LEVEL - into} ${t.xpToNext}`;

  const chips = $("group-chips");
  chips.innerHTML = "";
  for (const g of ["all", ...GROUPS]) {
    const n = g === "all" ? BIRDS.length : BIRDS.filter((b) => b.group === g).length;
    const c = document.createElement("button");
    c.className = "chip" + (stats.group === g ? " active" : "");
    c.textContent = `${t.groups[g]} · ${n}`;
    c.onclick = () => { stats.group = g; recent = []; saveStats(); renderHome(); };
    chips.appendChild(c);
  }

  const modes = $("mode-buttons");
  modes.innerHTML = "";
  for (const m of MODES) {
    const b = document.createElement("button");
    b.className = "mode-btn" + (m === "mixed" ? " wide" : "");
    b.innerHTML =
      `<span class="mode-icon">${MODE_ICONS[m]}</span>` +
      `<span class="mode-text"><span class="mode-name"></span><span class="mode-desc"></span></span>`;
    b.querySelector(".mode-name").textContent = t.modes[m][0];
    b.querySelector(".mode-desc").textContent = t.modes[m][1];
    b.onclick = () => startRound(m);
    modes.appendChild(b);
  }
  show("home");
}

function showMediaError() {
  const t = tr();
  $("media-card").classList.remove("hidden");
  $("media-loader").classList.add("hidden");
  $("media-error").classList.remove("hidden");
  $("t-error").textContent = t.error;
  $("btn-retry").textContent = t.retry;
}

async function nextQuestion() {
  const t = tr();
  audio.pause();
  $("feedback").classList.add("hidden");
  $("screen-quiz").classList.remove("answered");
  window.scrollTo({ top: 0 });
  $("options").innerHTML = "";
  $("options").classList.remove("grid");
  const img = $("media-img");
  img.classList.add("hidden");
  img.onload = img.onerror = null;
  img.removeAttribute("src"); // don't flash the previous bird when reshown
  $("media-card").classList.remove("hidden");
  $("media-sound").classList.add("hidden");
  $("media-error").classList.add("hidden");
  $("media-loader").classList.remove("hidden");
  $("t-loading").textContent = t.loading;
  $("progress-fill").style.width = (100 * round.n) / ROUND_LEN + "%";
  $("streak-badge").textContent = "🔥 " + round.streak;
  $("question-text").textContent = "…";

  const myRound = round;
  if (!upcoming.length) { round.made = Math.max(round.made, round.n); fillQueue(); }
  question = await upcoming.shift().catch(() => null);
  if (round === myRound) fillQueue(); // start preparing the one after
  if (round !== myRound) return; // user quit while loading
  if (!question) { round.made--; return showMediaError(); }

  const q = question;
  if (q.qMode === "none") {
    $("question-text").innerHTML = "";
    $("question-text").append(t.findBird + " ");
    const strong = document.createElement("strong");
    strong.textContent = q.bird[stats.lang];
    $("question-text").append(strong);
    $("media-card").classList.add("hidden");
  } else if (q.qMode === "sound") {
    $("question-text").textContent = q.answerKind === "photo" ? t.whichPhoto : t.whoSings;
    $("media-loader").classList.add("hidden");
    $("media-sound").classList.remove("hidden");
    $("play-hint").textContent = t.playHint;
    audio.src = q.media.u;
    audio.load();
  } else {
    $("question-text").textContent = t.whichBird;
    // keep the spinner up until the new photo has actually loaded
    img.onload = () => {
      $("media-loader").classList.add("hidden");
      img.classList.remove("hidden");
    };
    img.onerror = () => {
      img.onerror = showMediaError; // fallback failed too — offer a retry
      img.src = q.media.f;
    };
    img.src = q.media.u;
  }

  if (q.answerKind === "photo") $("options").classList.add("grid");
  for (const opt of q.options) {
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.dataset.sci = opt.bird.sci;
    if (q.answerKind === "photo") {
      btn.classList.add("photo-opt");
      const im = document.createElement("img");
      im.alt = "?";
      im.draggable = false;
      im.onerror = () => { im.onerror = null; im.src = opt.img.f; };
      im.src = tileUrl(opt.img);
      const cap = document.createElement("span");
      cap.className = "photo-cap";
      cap.textContent = opt.bird[stats.lang];
      btn.append(im, cap);
    } else {
      btn.textContent = opt.bird[stats.lang];
    }
    btn.onclick = () => answer(opt.bird, btn);
    $("options").appendChild(btn);
  }
}

function answer(chosen, btn) {
  const t = tr();
  const q = question;
  const good = chosen === q.bird;
  round.n++;
  stats.total++;
  const sp = (stats.sp[q.bird.sci] = spStats(q.bird.sci));
  if (good) {
    sp[0]++;
    round.score++;
    round.streak++;
    stats.correct++;
    stats.bestStreak = Math.max(stats.bestStreak, round.streak);
    const gained = 10 + Math.min(round.streak - 1, 5) * 2 + (round.mode === "lookalike" ? 5 : 0);
    round.xpGained += gained;
    stats.xp += gained;
  } else {
    sp[1]++;
    // Picking the wrong bird also counts as a confusion for that bird.
    const cs = (stats.sp[chosen.sci] = spStats(chosen.sci));
    cs[1]++;
    round.streak = 0;
  }
  saveStats();

  let correctBtn;
  for (const el of $("options").children) {
    el.disabled = true;
    if (el.dataset.sci === q.bird.sci) {
      el.classList.add("correct");
      correctBtn = el;
    }
  }
  if (!good) btn.classList.add("wrong");
  $("screen-quiz").classList.add("answered");
  if (correctBtn) correctBtn.scrollIntoView({ block: "center", behavior: "smooth" });

  $("progress-fill").style.width = (100 * round.n) / ROUND_LEN + "%";
  $("streak-badge").textContent = "🔥 " + round.streak;

  const other = stats.lang === "en" ? "fr" : "en";
  const fb = $("feedback");
  fb.classList.remove("hidden", "good", "bad");
  fb.classList.add(good ? "good" : "bad");
  $("feedback-title").textContent = good ? t.correct : t.wrong;
  $("feedback-bird").textContent = `${q.bird[stats.lang]} · ${q.bird[other]}`;
  $("feedback-sci").textContent = q.bird.sci;

  // Source link: the recording for sound questions, else the photo shown.
  const photo = q.qMode === "photo" ? q.media : q.options.find((o) => o.bird === q.bird)?.img;
  const src = $("feedback-src");
  const srcMedia = q.qMode === "sound" ? q.media : photo;
  src.textContent = q.qMode === "sound"
    ? t.source
    : t.photoSource + (photo?.a ? " · " + photo.a : "");
  src.href = srcMedia?.p || "#";
  $("btn-next").textContent = round.n >= ROUND_LEN ? t.finish : t.next;
}

function renderResults() {
  const t = tr();
  audio.pause();
  const pct = round.score / ROUND_LEN;
  $("results-emoji").textContent = pct >= 0.8 ? "🏆" : pct >= 0.5 ? "🎉" : "🐣";
  $("t-round-done").textContent = t.roundDone;
  $("results-score").textContent = `${round.score} / ${ROUND_LEN}`;
  $("results-details").textContent =
    `+${round.xpGained} ${t.xpGained} · ${t.level} ${level()}`;
  $("btn-again").textContent = t.playAgain;
  $("btn-home").textContent = t.home;
  show("results");
}

/* ---------- flow ---------- */

function startRound(mode) {
  round = { mode, n: 0, made: 0, score: 0, streak: 0, xpGained: 0 };
  upcoming = [];
  show("quiz");
  nextQuestion();
}

function setLang(lang) {
  stats.lang = lang;
  saveStats();
  renderHome();
}

/* ---------- wiring ---------- */

$("lang-en").onclick = () => setLang("en");
$("lang-fr").onclick = () => setLang("fr");

$("btn-play").onclick = () => {
  if (audio.paused) audio.play();
  else audio.pause();
};
$("btn-next").onclick = () => (round.n >= ROUND_LEN ? renderResults() : nextQuestion());
$("btn-retry").onclick = () => nextQuestion();
$("btn-quit").onclick = () => { round = null; upcoming = []; audio.pause(); renderHome(); };
$("btn-again").onclick = () => startRound(round.mode);
$("btn-home").onclick = () => renderHome();

renderHome();
