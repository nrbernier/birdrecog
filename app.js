/* Swiss bird recognition quiz.
   Photos come from Wikipedia page summaries, sounds from Wikimedia Commons
   (mostly xeno-canto recordings). Media URLs are cached in localStorage. */

const ROUND_LEN = 10;
const N_OPTIONS = 4;
const XP_PER_LEVEL = 100;

const T = {
  en: {
    title: "Swiss Birds",
    tagline: "Learn to recognize the common birds of Switzerland",
    level: "Level", bestStreak: "Best streak", accuracy: "Accuracy",
    photos: "Photo quiz", sounds: "Sound quiz", mixed: "Mixed quiz",
    whichBird: "Which bird is this?", whoSings: "Who is singing?",
    correct: "Correct!", wrong: "Not quite…",
    next: "Next", finish: "See results",
    loading: "Loading…", playHint: "Tap to play the recording",
    error: "Could not load media. Check your connection.", retry: "Retry",
    roundDone: "Round complete!", xpGained: "XP earned",
    playAgain: "Play again", home: "Menu",
    source: "Source: Wikimedia Commons", wikiSource: "Photo: Wikipedia",
    credits: "Photos: Wikipedia · Sounds: Wikimedia Commons / xeno-canto",
    xpToNext: "XP to next level",
  },
  fr: {
    title: "Oiseaux de Suisse",
    tagline: "Apprends à reconnaître les oiseaux communs de Suisse",
    level: "Niveau", bestStreak: "Meilleure série", accuracy: "Précision",
    photos: "Quiz photos", sounds: "Quiz sons", mixed: "Quiz mixte",
    whichBird: "Quel est cet oiseau ?", whoSings: "Qui chante ?",
    correct: "Correct !", wrong: "Raté…",
    next: "Suivant", finish: "Voir les résultats",
    loading: "Chargement…", playHint: "Touche pour écouter l'enregistrement",
    error: "Impossible de charger le média. Vérifie ta connexion.", retry: "Réessayer",
    roundDone: "Manche terminée !", xpGained: "XP gagnés",
    playAgain: "Rejouer", home: "Menu",
    source: "Source : Wikimedia Commons", wikiSource: "Photo : Wikipédia",
    credits: "Photos : Wikipédia · Sons : Wikimedia Commons / xeno-canto",
    xpToNext: "XP avant le prochain niveau",
  },
};

/* ---------- persistent state ---------- */

const STATS_KEY = "birdrecog.stats.v1";
const MEDIA_KEY = "birdrecog.media.v1";

const stats = Object.assign(
  { lang: "en", xp: 0, bestStreak: 0, total: 0, correct: 0 },
  JSON.parse(localStorage.getItem(STATS_KEY) || "{}")
);
const mediaCache = JSON.parse(localStorage.getItem(MEDIA_KEY) || "{}");

function saveStats() { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); }
function saveMedia() { localStorage.setItem(MEDIA_KEY, JSON.stringify(mediaCache)); }

/* ---------- media fetching ---------- */

function cacheEntry(sci) {
  return (mediaCache[sci] = mediaCache[sci] || {});
}

async function getImage(sci) {
  const entry = cacheEntry(sci);
  if (entry.img !== undefined) return entry.img;
  const url =
    "https://en.wikipedia.org/api/rest_v1/page/summary/" +
    encodeURIComponent(sci.replace(/ /g, "_"));
  const res = await fetch(url);
  if (!res.ok) throw new Error("wikipedia " + res.status);
  const j = await res.json();
  let img = null;
  if (j.thumbnail) {
    // Wikimedia only renders thumbnails at fixed bucket widths; 960px is a
    // valid bucket and phone-retina friendly. Keep the API-provided thumb
    // as fallback in case a particular file rejects that size.
    const src = j.originalimage && j.originalimage.width < 960
      ? j.originalimage.source
      : j.thumbnail.source.replace(/\/\d+px-/, "/960px-");
    img = { url: src, fallback: j.thumbnail.source, page: j.content_urls?.desktop?.page || null };
  }
  entry.img = img;
  saveMedia();
  return entry.img;
}

async function getAudio(sci) {
  const entry = cacheEntry(sci);
  if (entry.audio !== undefined) return entry.audio;
  const api =
    "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*" +
    "&generator=search&gsrnamespace=6&gsrlimit=10&prop=imageinfo&iiprop=url" +
    "&gsrsearch=" + encodeURIComponent(`"${sci}" filetype:audio`);
  const res = await fetch(api);
  if (!res.ok) throw new Error("commons " + res.status);
  const j = await res.json();
  const pages = Object.values(j.query?.pages || {});
  const mp3s = [], oggs = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info) continue;
    const item = { url: info.url, page: info.descriptionurl };
    if (/\.(mp3|wav)$/i.test(info.url)) mp3s.push(item);
    else if (/\.(ogg|oga)$/i.test(info.url)) {
      // iOS Safari can't play ogg — use the Commons mp3 transcode instead.
      const name = info.url.split("/").pop();
      item.url =
        info.url.replace("/wikipedia/commons/", "/wikipedia/commons/transcoded/") +
        "/" + name + ".mp3";
      oggs.push(item);
    }
  }
  entry.audio = mp3s.length ? mp3s : oggs;
  saveMedia();
  return entry.audio;
}

/* ---------- helpers ---------- */

const $ = (id) => document.getElementById(id);
const tr = (key) => T[stats.lang][key];
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function level() { return Math.floor(stats.xp / XP_PER_LEVEL) + 1; }

/* ---------- round state ---------- */

let round = null; // { mode, n, score, streak, xpGained }
let question = null; // { bird, qMode, media, options }
let recent = []; // recently asked species, avoided when picking
const audio = new Audio();

audio.addEventListener("ended", () => $("eq").classList.remove("playing"));
audio.addEventListener("pause", () => $("eq").classList.remove("playing"));
audio.addEventListener("play", () => $("eq").classList.add("playing"));

/* ---------- question generation ---------- */

async function makeQuestion(mode) {
  const qMode = mode === "mixed" ? rand(["photo", "sound"]) : mode;
  // Cap network attempts so an offline/rate-limited session shows the
  // retry screen instead of hammering the API for every species. Species
  // already cached as having no media for this mode don't get a slot.
  const pool = shuffle(
    BIRDS.filter((b) => {
      if (recent.includes(b.sci)) return false;
      const cached = mediaCache[b.sci]?.[qMode === "sound" ? "audio" : "img"];
      return cached === undefined || (qMode === "sound" ? cached.length > 0 : !!cached);
    })
  ).slice(0, 8);
  for (const bird of pool) {
    try {
      const media = qMode === "sound" ? rand(await getAudio(bird.sci)) : await getImage(bird.sci);
      if (!media) continue; // no photo/recording for this species — skip it
      const options = shuffle([
        bird,
        ...shuffle(BIRDS.filter((b) => b !== bird)).slice(0, N_OPTIONS - 1),
      ]);
      recent.push(bird.sci);
      if (recent.length > 6) recent.shift();
      return { bird, qMode, media, options };
    } catch (e) {
      console.warn("media fetch failed for", bird.sci, e);
    }
  }
  return null; // everything failed (offline?)
}

/* ---------- rendering ---------- */

function show(screen) {
  for (const s of ["home", "quiz", "results"])
    $("screen-" + s).classList.toggle("hidden", s !== screen);
}

function renderHome() {
  const t = T[stats.lang];
  document.documentElement.lang = stats.lang;
  $("t-title").textContent = t.title;
  $("t-tagline").textContent = t.tagline;
  $("t-level").textContent = t.level;
  $("t-best-streak").textContent = t.bestStreak;
  $("t-accuracy").textContent = t.accuracy;
  $("t-photos").textContent = t.photos;
  $("t-sounds").textContent = t.sounds;
  $("t-mixed").textContent = t.mixed;
  $("t-credits").textContent = t.credits;
  $("lang-en").classList.toggle("active", stats.lang === "en");
  $("lang-fr").classList.toggle("active", stats.lang === "fr");

  $("stat-level").textContent = level();
  $("stat-streak").textContent = stats.bestStreak;
  $("stat-accuracy").textContent = stats.total
    ? Math.round((100 * stats.correct) / stats.total) + "%"
    : "–";
  const into = stats.xp % XP_PER_LEVEL;
  $("xp-fill").style.width = into + "%";
  $("xp-text").textContent = `${XP_PER_LEVEL - into} ${t.xpToNext}`;
  show("home");
}

async function nextQuestion() {
  const t = T[stats.lang];
  audio.pause();
  $("feedback").classList.add("hidden");
  $("options").innerHTML = "";
  $("media-img").classList.add("hidden");
  $("media-sound").classList.add("hidden");
  $("media-error").classList.add("hidden");
  $("media-loader").classList.remove("hidden");
  $("t-loading").textContent = t.loading;
  $("progress-fill").style.width = (100 * round.n) / ROUND_LEN + "%";
  $("streak-badge").textContent = "🔥 " + round.streak;
  $("question-text").textContent = "…";

  question = await makeQuestion(round.mode);
  if (!round) return; // user quit while loading
  $("media-loader").classList.add("hidden");

  if (!question) {
    $("media-error").classList.remove("hidden");
    $("t-error").textContent = t.error;
    $("btn-retry").textContent = t.retry;
    return;
  }

  $("question-text").textContent =
    question.qMode === "sound" ? t.whoSings : t.whichBird;

  if (question.qMode === "photo") {
    const img = $("media-img");
    img.onerror = () => { img.onerror = null; img.src = question.media.fallback; };
    img.src = question.media.url;
    img.classList.remove("hidden");
  } else {
    $("media-sound").classList.remove("hidden");
    $("play-hint").textContent = t.playHint;
    audio.src = question.media.url;
  }

  for (const b of question.options) {
    const btn = document.createElement("button");
    btn.className = "option-btn";
    btn.textContent = b[stats.lang];
    btn.onclick = () => answer(b, btn);
    $("options").appendChild(btn);
  }
}

function answer(chosen, btn) {
  const t = T[stats.lang];
  const good = chosen === question.bird;
  round.n++;
  stats.total++;
  if (good) {
    round.score++;
    round.streak++;
    stats.correct++;
    stats.bestStreak = Math.max(stats.bestStreak, round.streak);
    const gained = 10 + Math.min(round.streak - 1, 5) * 2;
    round.xpGained += gained;
    stats.xp += gained;
  } else {
    round.streak = 0;
  }
  saveStats();

  for (const el of $("options").children) {
    el.disabled = true;
    if (el.textContent === question.bird[stats.lang]) el.classList.add("correct");
  }
  if (!good) btn.classList.add("wrong");

  $("progress-fill").style.width = (100 * round.n) / ROUND_LEN + "%";
  $("streak-badge").textContent = "🔥 " + round.streak;

  const other = stats.lang === "en" ? "fr" : "en";
  const fb = $("feedback");
  fb.classList.remove("hidden", "good", "bad");
  fb.classList.add(good ? "good" : "bad");
  $("feedback-title").textContent = good ? t.correct : t.wrong;
  $("feedback-bird").textContent =
    `${question.bird[stats.lang]} · ${question.bird[other]}`;
  $("feedback-sci").textContent = question.bird.sci;
  const src = $("feedback-src");
  src.textContent = question.qMode === "sound" ? t.source : t.wikiSource;
  src.href = question.media.page || "#";
  $("btn-next").textContent = round.n >= ROUND_LEN ? t.finish : t.next;
}

function renderResults() {
  const t = T[stats.lang];
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
  round = { mode, n: 0, score: 0, streak: 0, xpGained: 0 };
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
for (const btn of document.querySelectorAll(".mode-btn"))
  btn.onclick = () => startRound(btn.dataset.mode);

$("btn-play").onclick = () => {
  if (audio.paused) audio.play();
  else audio.pause();
};
$("btn-next").onclick = () => (round.n >= ROUND_LEN ? renderResults() : nextQuestion());
$("btn-retry").onclick = () => nextQuestion();
$("btn-quit").onclick = () => { round = null; audio.pause(); renderHome(); };
$("btn-again").onclick = () => startRound(round.mode);
$("btn-home").onclick = () => renderHome();

renderHome();
