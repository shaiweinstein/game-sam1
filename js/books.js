/* ============================================================
    Lily's Dress-Up Adventure — Library bookshelf + story reader
    The 📖 Read a book button inside the 3D library opens the
    full-stage shelf of storybook covers; a card opens the reader
    (#bookreader) over the same stage. Back/Escape peel one level
    at a time (reader → shelf → library → map) through handleBack().

    Paths are PAGE-relative on purpose (works at /index.html dev
    AND /play/index.html prod): the manifest is
    `new URL("library/manifest.json", document.baseURI)` and every
    thumb/book path resolves against the manifest's own URL with
    `new URL(entry.thumb, manifestUrl)` / `new URL(entry.book,
    manifestUrl)`; page images use
    `new URL("books/" + id + "/" + page.image, manifestUrl)`.
    NEVER "../library/".

    The manifest is fetched LAZILY on the first shelf open (the
    promise is cached — reopen never refetches) and stays
    same-origin only: zero external requests (the credits' Source
    and License links navigate only on a user click). On failure the
    shelf shows a visible "Can't load the bookshelf" retry state plus
    a friendly talk-bubble/console line.

    Per-book promise cache: each book.json is fetched once (keyed by
    id) and shared across reader sessions; a failed fetch is evicted
    so a retry can refetch.

    Race guard (the wardrobe lesson): a single monotonic `epoch` is
    bumped at the start of EVERY state transition (openBook, goPage,
    showCredits, closeBook, close). Each async continuation (book
    fetch, image loader) captures the epoch it started under and
    drops itself silently if the epoch has moved on — a cancelled
    switch can never flash the wrong book's page or fire a late
    update, and its listeners are detached before it is dropped
    (pendingImg's onload/onerror are nulled on every swap/close).

    Page narration (the 🔊 Read page button, #bookreader-tts): a
    page whose book.json carries `pages[].audio` (e.g.
    "audio/page-NN.mp3", resolved NEXT to page.image via pageUrl)
    plays that clip on ONE reused <audio> (created once per reader
    session, parked hidden as #bookreader-audio, released on
    teardown). Pages without `audio` fall back to LOCAL speech only:
    window.speechSynthesis speaking #bookreader-text with rate/pitch
    1.0 and a voice that is localService === true with an `en*` lang
    (Samantha/Allison/Ava/Susan/Zira/Jenny/Google US English are
    preferred IN THAT ORDER but ONLY when localService — a non-local
    voice would break the zero-external-requests guarantee and is
    never chosen). No page audio + no local en voice = the button is
    disabled (title "No reading voice on this device yet") but still
    visible. While reading the label toggles to `⏹ Stop`; a second
    press after it ends replays.

    STOP rules (nothing may survive a teardown): every narration run
    captures BOTH the current `epoch` and a private `ttsTick`
    counter; any later callback drops itself when either has moved.
    stopTTS() (pause/reset the Audio, detach utterance callbacks,
    speechSynthesis.cancel()) runs on every page turn (goPage — which
    is also prev/next/keys/swipe), showCredits/credits open,
    closeBook, close, and the openShelf-over-reader teardown; book
    switches additionally RELEASE the Audio element (teardownTTS).
    The credits view hides the button (it has its own actions).

    Public surface (mirrors the house open/close contract):

      window.BooksUI = {
        openShelf() -> bool,    close() -> bool,   isOpen() -> bool,
        state()  -> {open, manifestLoaded, count, books:[...],
                     view:'shelf'|'page'|'credits', bookId, page,
                     pageCount, title},
        list()   -> [book entries]  (empty until the manifest loads),
        handleBack() -> bool,   // true = consumed: one level peeled
                                // (reader → shelf → library)
        waitReady() -> Promise<boolean>, // ensures the manifest load
        openBook(id) -> Promise<boolean>,  // reader on page 1
        closeBook() -> bool     // reader → warm shelf (no refetch)
      }

    Book entries are the manifest rows plus two resolved URLs
    (thumbUrl, bookUrl).

    QA hook: window.__books = thin proxies over BooksUI for
    Playwright (openShelf, close, state, list, waitReady, openBook,
    closeBook, goPage, showCredits, tts, ttsState). goPage/showCredits
    fire the exact same code path as the reader buttons; tts() is the
    exact toggle the #bookreader-tts click fires (start for the
    current page / stop while playing / replay after it ends) and
    ttsState() -> {playing, source:'audio'|'speech'|'none', bookId,
    page} where `source` is what the current page would use ('none'
    = the disabled state).

    Uses window.GameUI.setTalk (optional — friendly fallback only).
    ============================================================ */

(function () {
  "use strict";

  /* ---------- module state ---------- */

  let shelfOpen = false;      /* the #bookshelf overlay is showing   */
  let readerOpen = false;     /* the #bookreader overlay is showing  */
  let manifestUrl = null;     /* absolute URL of library/manifest.json */
  let manifestPromise = null; /* cached load; cleared on failure so
                                 Retry/reopen can fetch fresh        */
  let books = null;           /* enriched entries once loaded, else null */
  let wired = false;          /* shelf DOM listeners bound once      */
  let readerWired = false;    /* reader DOM listeners bound once     */

  /* ---- reader session (see the race-guard note in the header) ---- */
  let epoch = 0;              /* monotonic transition token          */
  let bookCache = {};         /* id-keyed Promise<book.json> cache   */
  let curBook = null;         /* book.json of the open book, or null */
  let curBookId = null;       /* id of the open book (set at open)   */
  let curPage = 1;            /* 1-based page index                  */
  let curView = "page";       /* "page" | "credits" while readerOpen */
  let curTitle = "";          /* exactly what #bookreader-title shows */
  let pendingImg = null;      /* in-flight image loader we own       */

  /* ---- page narration (🔊 Read page) ---- */
  let ttsAudio = null;        /* ONE reused <audio> per reader
                                 session (lazy; hidden #bookreader-audio) */
  let ttsUtterance = null;    /* live SpeechSynthesisUtterance, if any    */
  let ttsPlaying = false;     /* narration active (button shows ⏹ Stop)  */
  let ttsTick = 0;            /* private cancel token: bumped by every
                                 start/stop so late media/speech
                                 callbacks drop themselves               */

  /* Friendly failure copy — the shelf/reader show the visible
     states; these are talk-bubble/console courtesy lines. */
  const LOAD_FAIL_TALK = "The storybooks are playing hide-and-seek! Tap try again! 📚";
  const MISSING_UI_TALK = "The bookshelf is still being built! Come back soon! 📚";
  const BOOK_FAIL_TALK = "This story is feeling shy! Try another book! 📖";

  /* ---------- tiny helpers (map.js spirit) ---------- */

  function byId(id) {
    return document.getElementById(id);
  }

  function talk(message) {
    const ui = window.GameUI;
    if (ui && typeof ui.setTalk === "function") ui.setTalk(message);
  }

  function warn(message, err) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("BooksUI: " + message, err);
    }
  }

  function normalizeId(rawId) {
    const num = Number(rawId);
    return Number.isFinite(num) ? num : rawId;
  }

  function idKey(rawId) {
    return String(rawId);
  }

  function reducedMotion() {
    return typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /* ---------- manifest (lazy, cached, same-origin only) ---------- */

  function ensureManifest() {
    if (!manifestPromise) {
      /* Page-relative recipe — same URL at /index.html and /play/. */
      manifestUrl = new URL("library/manifest.json", document.baseURI);
      manifestPromise = fetch(manifestUrl)
        .then(function (response) {
          if (!response.ok) throw new Error("manifest HTTP " + response.status);
          return response.json();
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.books)) {
            throw new Error("manifest is missing books[]");
          }
          /* Shelf order is display order; keep every raw field and
             add the two resolved URLs (thumb/book) — resolved
             against the manifest's own URL. */
          books = data.books
            .slice()
            .sort(function (a, b) { return (a.shelfOrder || 0) - (b.shelfOrder || 0); })
            .map(function (entry) {
              const copy = Object.assign({}, entry);
              copy.thumbUrl = new URL(entry.thumb, manifestUrl).href;
              copy.bookUrl = new URL(entry.book, manifestUrl).href;
              return copy;
            });
          return books;
        })
        .catch(function (err) {
          manifestPromise = null; /* Retry/reopen must be able to refetch */
          throw err;
        });
    }
    return manifestPromise;
  }

  function findEntry(rawId) {
    if (!books) return null;
    const key = idKey(rawId);
    for (let i = 0; i < books.length; i++) {
      if (idKey(books[i].id) === key) return books[i];
    }
    return null;
  }

  /* Page images sit NEXT to book.json: resolve them against the
     manifest URL with the same recipe the header documents. */
  function pageUrl(bookId, image) {
    return new URL("books/" + idKey(bookId) + "/" + image, manifestUrl).href;
  }

  /* Per-book promise cache: one fetch per book per session lifetime;
     failures are evicted so a retry can refetch. Results always land
     in the cache regardless of the epoch (data only) — RENDERS of a
     result are what the epoch gates. */
  function loadBook(entry) {
    const key = idKey(entry.id);
    if (!bookCache[key]) {
      bookCache[key] = fetch(entry.bookUrl)
        .then(function (response) {
          if (!response.ok) throw new Error("book HTTP " + response.status);
          return response.json();
        })
        .then(function (data) {
          if (!data || !Array.isArray(data.pages)) {
            throw new Error("book.json is missing pages[]");
          }
          /* Deterministic reading order even if pages arrive shuffled. */
          data.pages = data.pages
            .slice()
            .sort(function (a, b) { return (a.n || 0) - (b.n || 0); });
          return data;
        })
        .catch(function (err) {
          delete bookCache[key]; /* a later openBook may refetch */
          throw err;
        });
    }
    return bookCache[key];
  }

  /* ---------- image loading with stale-drop (race guard) ----------

     One pending loader at a time. Every swap and every close first
     detaches the previous loader's onload/onerror ("cancelled
     switches leave no listeners"), and every completion checks its
     captured epoch before it may touch the DOM. */

  function clearPendingImage() {
    if (pendingImg) {
      pendingImg.onload = null;
      pendingImg.onerror = null;
      pendingImg = null;
    }
  }

  function hideImg() {
    clearPendingImage();
    const img = byId("bookreader-img");
    if (!img) return;
    img.classList.add("hidden");
    /* removeAttribute — an empty src would request the page URL and
       flash a broken-image glyph; text-only pages must show NO img. */
    img.removeAttribute("src");
  }

  function swapImage(url, token) {
    clearPendingImage();
    const img = byId("bookreader-img");
    if (!img) return;
    const loader = new Image();
    pendingImg = loader;
    loader.onload = function () {
      loader.onload = loader.onerror = null;
      if (pendingImg === loader) pendingImg = null;
      if (token !== epoch) return; /* stale switch — drop silently */
      img.src = url;               /* cached: commits instantly     */
      img.classList.remove("hidden");
      if (!reducedMotion()) {
        /* ≤150ms opacity swap, disabled under reduced motion. */
        img.classList.remove("bookreader-swap");
        void img.offsetWidth;      /* restart the animation */
        img.classList.add("bookreader-swap");
      }
    };
    loader.onerror = function () {
      loader.onload = loader.onerror = null;
      if (pendingImg === loader) pendingImg = null;
      if (token !== epoch) return; /* never show a broken image */
      img.classList.add("hidden");
      img.removeAttribute("src");
    };
    loader.src = url;
  }

  /* Neighbor warm-up: plain detached <img>, NO listeners and NO DOM
     commit — it can only warm the HTTP/decode cache, never fire a
     late update. */
  function prefetch(url) {
    if (!url) return;
    const warm = new Image();
    warm.src = url;
  }

  function prefetchAround() {
    if (!curBook) return;
    const count = pageCount();
    [curPage - 1, curPage + 1, curPage + 2].forEach(function (n) {
      if (n < 1 || n > count) return;
      const page = curBook.pages[n - 1];
      if (page && page.image) prefetch(pageUrl(curBook.id, page.image));
    });
  }

  /* ---------- page narration (🔊 Read page / ⏹ Stop) ----------
     Source order: the page's own pages[].audio clip (resolved NEXT to
     page.image through pageUrl — one reused <audio>) → else LOCAL
     speech only (never a non-local voice: zero external requests).
     Late callbacks drop themselves on EITHER the reader `epoch` or
     the private `ttsTick` having moved (stop rules in the header). */

  /* Voice preference list — honored ONLY among localService en*
     voices (see pickLocalVoice). */
  const TTS_NAME_HINTS = ["samantha", "allison", "ava", "susan", "zira", "jenny", "google us english"];

  function pageAudioName() {
    if (!curBook || !Array.isArray(curBook.pages)) return "";
    const page = curBook.pages[curPage - 1];
    return page && typeof page.audio === "string" && page.audio ? page.audio : "";
  }

  /* The single fallback voice: localService === true AND lang starting
     "en". Among those, the first TTS_NAME_HINTS match in hint order;
     otherwise the first local en voice. Non-local voices are NEVER
     eligible (a remote engine can trigger network fetches). */
  function pickLocalVoice() {
    const synth = window.speechSynthesis;
    if (!synth || typeof synth.getVoices !== "function") return null;
    let voices;
    try {
      voices = synth.getVoices() || [];
    } catch (err) {
      return null;
    }
    const local = voices.filter(function (voice) {
      return !!voice && voice.localService === true &&
        typeof voice.lang === "string" && voice.lang.toLowerCase().indexOf("en") === 0;
    });
    if (!local.length) return null;
    for (let h = 0; h < TTS_NAME_HINTS.length; h++) {
      for (let i = 0; i < local.length; i++) {
        const name = String(local[i].name || "").toLowerCase();
        if (name.indexOf(TTS_NAME_HINTS[h]) !== -1) return local[i];
      }
    }
    return local[0];
  }

  /* What the CURRENT page would use: "audio" | "speech" | "none".
     "none" is the disabled-button state. */
  function ttsSourceForPage() {
    if (!readerOpen || !curBook || curView !== "page") return "none";
    if (pageAudioName()) return "audio";
    return pickLocalVoice() ? "speech" : "none";
  }

  function updateTtsButton() {
    const btn = byId("bookreader-tts");
    if (!btn) return;
    /* The button lives on page views only: the credits sheet has its
       own actions, and a loading/error reader has nothing to read. */
    const show = readerOpen && !!curBook && curView === "page";
    btn.classList.toggle("hidden", !show);
    if (ttsPlaying) {
      btn.textContent = "⏹ Stop";
      btn.classList.add("is-playing");
      btn.disabled = false;
      btn.removeAttribute("title");
      btn.setAttribute("aria-label", "Stop reading");
      return;
    }
    btn.classList.remove("is-playing");
    btn.textContent = "🔊 Read page";
    const avail = ttsSourceForPage();
    btn.disabled = avail === "none";
    if (avail === "none") {
      btn.setAttribute("title", "No reading voice on this device yet");
      btn.setAttribute("aria-label", "No reading voice on this device yet");
    } else if (avail === "audio") {
      btn.setAttribute("title", "Play this page's narration");
      btn.setAttribute("aria-label", "Read this page aloud");
    } else {
      btn.setAttribute("title", "Read this page aloud");
      btn.setAttribute("aria-label", "Read this page aloud");
    }
  }

  /* The single reused Audio element, created once per reader session
     and parked hidden inside #bookreader (queryable as
     #bookreader-audio / document audio tag for QA). No src is ever
     set until the user asks for narration — zero extra requests. */
  function ensureTtsAudio() {
    if (ttsAudio) return ttsAudio;
    const host = byId("bookreader");
    if (!host || typeof Audio !== "function") return null;
    const el = new Audio();
    el.id = "bookreader-audio";
    el.className = "hidden";
    el.setAttribute("aria-hidden", "true");
    el.preload = "auto";
    host.appendChild(el);
    ttsAudio = el;
    return el;
  }

  /* Idle-but-keep: narration ended/stopped inside the same reader
     session. The Audio element (and its src) stay ready for the
     one-press replay; every late callback is already dead. */
  function finishTTS() {
    ttsTick++;
    ttsPlaying = false;
    ttsUtterance = null;
    updateTtsButton();
  }

  /* Hard stop (the STOP rules): cancels speech AND the Audio cleanly.
     Runs on every page turn, credits open, closeBook, close, and
     teardown. Idempotent and always safe to call. */
  function stopTTS() {
    ttsTick++; /* every late onended/onend/onerror drops itself now */
    if (ttsUtterance) {
      ttsUtterance.onend = null;
      ttsUtterance.onerror = null;
      ttsUtterance = null;
    }
    const synth = window.speechSynthesis;
    if (synth && typeof synth.cancel === "function") {
      try { synth.cancel(); } catch (err) { /* some engines throw — silence */ }
    }
    if (ttsAudio) {
      ttsAudio.onended = null;
      ttsAudio.onerror = null;
      try { ttsAudio.pause(); } catch (err) { /* never armed — fine */ }
      try { ttsAudio.currentTime = 0; } catch (err) { /* no media yet */ }
    }
    ttsPlaying = false;
    updateTtsButton();
  }

  /* Book switch / reader teardown: stop, THEN release the session's
     Audio element (the next session creates its own — once each). */
  function teardownTTS() {
    stopTTS();
    if (ttsAudio) {
      const el = ttsAudio;
      ttsAudio = null;
      el.onended = el.onerror = null;
      el.removeAttribute("src");
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  }

  function startAudioTTS(name, tick, token) {
    const audio = ensureTtsAudio();
    const bid = curBook.id != null ? curBook.id : curBookId;
    if (!audio || bid == null || !manifestUrl) return false;
    const url = pageUrl(bid, name);
    audio.onended = function () {
      audio.onended = audio.onerror = null;
      if (tick !== ttsTick || token !== epoch) return; /* stale — drop */
      finishTTS();
    };
    audio.onerror = function () {
      audio.onended = audio.onerror = null;
      if (tick !== ttsTick || token !== epoch) return;
      finishTTS(); /* quiet: back to 🔊 Read page, no console noise */
    };
    if (audio.getAttribute("src") !== url) audio.src = url;
    try { audio.currentTime = 0; } catch (err) { /* fresh src — ok */ }
    ttsPlaying = true;
    updateTtsButton();
    let started = false;
    try {
      const playing = audio.play();
      started = true;
      if (playing && typeof playing.catch === "function") {
        playing.catch(function () {
          /* Autoplay block or decode failure: die quietly in place. */
          if (tick !== ttsTick || token !== epoch) return;
          stopTTS();
        });
      }
    } catch (err) {
      started = false;
    }
    if (!started) {
      stopTTS();
      return false;
    }
    return true;
  }

  function startSpeechTTS(voice, tick, token) {
    const synth = window.speechSynthesis;
    const textEl = byId("bookreader-text");
    /* NEVER fall through to the engine's default voice (it may be a
       non-local one): no verified local en voice → no speech. */
    if (!voice || !synth || typeof synth.speak !== "function") return false;
    /* The page text VERBATIM from the rendered node. */
    const text = textEl ? String(textEl.textContent || "") : "";
    const utter = new SpeechSynthesisUtterance(text);
    utter.voice = voice;
    utter.rate = 1.0;
    utter.pitch = 1.0;
    utter.onend = utter.onerror = function () {
      utter.onend = utter.onerror = null;
      if (tick !== ttsTick || token !== epoch) return;
      finishTTS();
    };
    ttsUtterance = utter;
    ttsPlaying = true;
    updateTtsButton();
    try {
      synth.cancel(); /* clear any stray queue BEFORE we speak */
      synth.speak(utter);
    } catch (err) {
      ttsUtterance = null;
      stopTTS();
      return false;
    }
    return true;
  }

  function startTTS() {
    if (!readerOpen || !curBook || curView !== "page") return false;
    const kind = ttsSourceForPage();
    if (kind === "none") return false;
    const tick = ++ttsTick;
    const token = epoch;
    if (kind === "audio") return startAudioTTS(pageAudioName(), tick, token);
    return startSpeechTTS(pickLocalVoice(), tick, token);
  }

  /* The exact #bookreader-tts click code path (and __books.tts):
     toggle — start for the current page, stop while it reads, replay
     on a press after it ends. Resulting playing state is returned. */
  function toggleTTS() {
    if (!readerOpen || !curBook || curView !== "page") return false;
    if (ttsPlaying) {
      stopTTS();
      return false;
    }
    return startTTS();
  }

  /* Voices load asynchronously in every browser: re-grade the button
     when they arrive (bound once from wireReader). */
  function wireVoices() {
    const synth = window.speechSynthesis;
    if (!synth || typeof synth.getVoices !== "function") return;
    if (typeof synth.addEventListener === "function") {
      synth.addEventListener("voiceschanged", function () { updateTtsButton(); });
    }
    try { synth.getVoices(); } catch (err) { /* engine missing — fine */ }
  }

  /* ---------- shelf DOM (static markup lives in index.html) ---------- */

  function wireShelf() {
    if (wired) return;
    const closeBtn = byId("bookshelf-close");
    const grid = byId("bookshelf-grid");
    if (!closeBtn || !grid) return;
    wired = true;
    closeBtn.addEventListener("click", function () {
      close();
    });
    /* One delegated tap target for every cover card. */
    grid.addEventListener("click", function (event) {
      const from = event.target;
      const card = from && from.closest ? from.closest(".bookshelf-card[data-book-id]") : null;
      if (!card) return;
      choose(card.getAttribute("data-book-id"));
    });
  }

  function showReadButton(show) {
    const btn = byId("library-read-button");
    if (btn) btn.classList.toggle("hidden", !show);
  }

  function renderLoading(grid) {
    grid.textContent = "";
    const note = document.createElement("p");
    note.className = "bookshelf-message bookshelf-message-loading";
    note.setAttribute("role", "status");
    note.textContent = "📚 Fetching stories…";
    grid.appendChild(note);
  }

  function renderCards(grid, entries) {
    grid.textContent = "";
    const frag = document.createDocumentFragment();
    entries.forEach(function (entry) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "bookshelf-card";
      card.setAttribute("data-book-id", String(entry.id));

      const img = document.createElement("img");
      img.className = "bookshelf-card-thumb";
      img.src = entry.thumbUrl;
      img.alt = "";
      card.appendChild(img);

      const title = document.createElement("span");
      title.className = "bookshelf-card-title";
      title.textContent = entry.title;
      card.appendChild(title);

      const by = document.createElement("span");
      by.className = "bookshelf-card-by";
      by.textContent = "by " + (entry.authors || []).join(", ");
      card.appendChild(by);

      const level = document.createElement("span");
      level.className = "bookshelf-card-level";
      level.textContent = "Level " + entry.level;
      card.appendChild(level);

      frag.appendChild(card);
    });
    grid.appendChild(frag);
  }

  function renderError(grid) {
    grid.textContent = "";
    const box = document.createElement("div");
    box.className = "bookshelf-message";
    box.setAttribute("role", "status");

    const title = document.createElement("p");
    title.className = "bookshelf-message-title";
    title.textContent = "😢 Can't load the bookshelf";
    box.appendChild(title);

    const hint = document.createElement("p");
    hint.className = "bookshelf-message-hint";
    hint.textContent = "The storybooks are hiding! Tap below to look again.";
    box.appendChild(hint);

    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "bookshelf-retry";
    retry.textContent = "🔄 Try again";
    retry.addEventListener("click", function () {
      loadInto(grid);
    });
    box.appendChild(retry);

    grid.appendChild(box);
  }

  function loadInto(grid) {
    renderLoading(grid);
    ensureManifest().then(
      function (entries) {
        renderCards(grid, entries);
      },
      function (err) {
        warn("can't load the bookshelf", err);
        talk(LOAD_FAIL_TALK);
        renderError(grid);
      }
    );
  }

  /* Card tap seam → the reader. */
  function choose(rawId) {
    openBook(rawId);
  }

  function showShelf() {
    const shelf = byId("bookshelf");
    const grid = byId("bookshelf-grid");
    if (!shelf || !grid) {
      talk(MISSING_UI_TALK);
      return false;
    }
    wireShelf();
    shelfOpen = true;
    shelf.classList.remove("hidden");
    showReadButton(false); /* the read pill hides while the shelf is open */
    if (books) renderCards(grid, books);
    else loadInto(grid);   /* lazy first fetch; cached promise after that */
    return true;
  }

  /* ---------- reader DOM ---------- */

  function wireReader() {
    if (readerWired) return;
    const root = byId("bookreader");
    const closeBtn = byId("bookreader-close");
    const prev = byId("bookreader-prev");
    const next = byId("bookreader-next");
    const creditsBtn = byId("bookreader-credits-btn");
    const again = byId("bookreader-again");
    const creditsClose = byId("bookreader-credits-close");
    const body = byId("bookreader-body");
    const ttsBtn = byId("bookreader-tts");
    if (!root || !closeBtn || !prev || !next || !body) return;
    readerWired = true;

    closeBtn.addEventListener("click", function () { closeBook(); });
    if (creditsClose) creditsClose.addEventListener("click", function () { closeBook(); });
    if (again) again.addEventListener("click", function () { goPage(1); });
    if (creditsBtn) creditsBtn.addEventListener("click", function () { showCredits(); });
    if (ttsBtn) ttsBtn.addEventListener("click", function () { toggleTTS(); });
    prev.addEventListener("click", function () { goPrev(); });
    next.addEventListener("click", function () { goNext(); });
    wireVoices(); /* async voice list → re-grades the TTS button */

    /* Arrow keys flip pages while the reader is open. One permanent
       document listener with an open-guard (the shelf's Escape seam
       lives in library3d → handleBack). */
    document.addEventListener("keydown", function (event) {
      if (!readerOpen) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    });

    /* Horizontal swipe flips pages (vertical scrolls the text —
       touch-action: pan-y on the body keeps native scroll). */
    let touchX = null, touchY = null;
    body.addEventListener("touchstart", function (event) {
      if (!event.touches || event.touches.length !== 1) { touchX = touchY = null; return; }
      touchX = event.touches[0].clientX;
      touchY = event.touches[0].clientY;
    }, { passive: true });
    body.addEventListener("touchend", function (event) {
      if (touchX === null || !event.changedTouches || !event.changedTouches.length) {
        touchX = touchY = null;
        return;
      }
      const dx = event.changedTouches[0].clientX - touchX;
      const dy = event.changedTouches[0].clientY - touchY;
      touchX = touchY = null;
      /* Horizontal-dominant flick of a comfortable width only. */
      if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) goNext(); else goPrev();
    }, { passive: true });
    body.addEventListener("touchcancel", function () {
      touchX = touchY = null;
    }, { passive: true });
  }

  function setTitle(text) {
    curTitle = text;
    const el = byId("bookreader-title");
    if (el) el.textContent = text;
  }

  function pageCount() {
    return curBook && Array.isArray(curBook.pages) ? curBook.pages.length : 0;
  }

  function setCreditsVisible(show) {
    const pageview = byId("bookreader-pageview");
    const credits = byId("bookreader-credits");
    if (pageview) pageview.classList.toggle("hidden", show);
    if (credits) credits.classList.toggle("hidden", !show);
  }

  function updateNav() {
    const prev = byId("bookreader-prev");
    const next = byId("bookreader-next");
    const indicator = byId("bookreader-page");
    const count = pageCount();
    if (!prev || !next || !indicator) return;
    if (curView === "credits") {
      prev.disabled = count < 1;    /* prev from credits = last page */
      next.disabled = true;         /* credits IS the end            */
      next.textContent = "➡️";
      next.setAttribute("aria-label", "Next page");
      indicator.textContent = count + " / " + count;
    } else {
      prev.disabled = curPage <= 1;
      /* Next is disabled at NO point on the book: on the last page it
         becomes the credits entry instead of dying. */
      next.disabled = false;
      if (count > 0 && curPage >= count) {
        next.textContent = "🎉";
        next.setAttribute("aria-label", "The End — read the credits");
      } else {
        next.textContent = "➡️";
        next.setAttribute("aria-label", "Next page");
      }
      indicator.textContent = curPage + " / " + count;
    }
  }

  function renderPage(n, token) {
    if (!curBook || token !== epoch) return false;
    const count = pageCount();
    if (count < 1) return false;
    curPage = Math.min(Math.max(1, Math.floor(n) || 1), count);
    curView = "page";
    setCreditsVisible(false);

    const root = byId("bookreader");
    const textWrap = byId("bookreader-textbox");
    const textEl = byId("bookreader-text");
    const page = curBook.pages[curPage - 1] || { image: "", text: "" };
    const imageName = typeof page.image === "string" ? page.image : "";
    const text = typeof page.text === "string" ? page.text : "";

    if (root) {
      root.classList.toggle("bookreader-textonly", !imageName);
      root.classList.toggle("bookreader-imageonly", imageName && !text);
      root.classList.toggle("bookreader-landscape", curBook.orientation === "landscape");
      root.classList.toggle("bookreader-portrait", curBook.orientation !== "landscape");
    }

    if (textEl && textWrap) {
      if (text) {
        textEl.textContent = text;   /* verbatim; white-space: pre-wrap */
        textWrap.classList.remove("hidden");
      } else {
        textEl.textContent = "";     /* image-only page: no empty box */
        textWrap.classList.add("hidden");
      }
      textWrap.scrollTop = 0;
    }

    const bid = curBook.id != null ? curBook.id : curBookId;
    if (imageName && bid != null && manifestUrl) {
      swapImage(pageUrl(bid, imageName), token);
    } else {
      hideImg();                     /* text-only page: no <img> at all */
    }

    updateNav();
    updateTtsButton();
    prefetchAround();
    return true;
  }

  function renderCredits(token) {
    if (!curBook || token !== epoch) return false;
    curView = "credits";
    /* The credits sheet IS the end of the book: the position becomes
       the last page (indicator "N / N", prev returns there). */
    curPage = Math.max(1, pageCount());
    setCreditsVisible(true);
    /* STOP rule: credits open — and the button hides (the credits
       sheet has its own actions). */
    stopTTS();
    updateTtsButton();

    const root = byId("bookreader");
    if (root) {
      root.classList.remove("bookreader-textonly", "bookreader-imageonly");
    }

    /* The CC BY requirement: the VERBATIM attribution text, fully
       rendered with line breaks preserved (textContent + pre-wrap). */
    const attr = byId("bookreader-credits-attribution");
    if (attr) attr.textContent = typeof curBook.attribution === "string" ? curBook.attribution : "";

    const title = byId("bookreader-credits-title");
    if (title) title.textContent = curBook.title || curTitle;

    const authors = byId("bookreader-credits-authors");
    if (authors) {
      const names = (curBook.authors || []).join(", ");
      authors.textContent = names ? "Written by " + names : "";
    }
    const illustrators = byId("bookreader-credits-illustrators");
    if (illustrators) {
      const names = (curBook.illustrators || []).join(", ");
      illustrators.textContent = names ? "Illustrated by " + names : "";
    }

    /* license + licenseUrl — visible link (navigates only on click). */
    const license = byId("bookreader-credits-license");
    if (license) {
      license.textContent = curBook.license || "";
      if (curBook.licenseUrl) license.setAttribute("href", curBook.licenseUrl);
      else license.removeAttribute("href");
    }

    /* sourceUrl — small clickable "Source: StoryWeaver" anchor. ZERO
       automatic external requests: href alone never fetches. */
    const source = byId("bookreader-credits-source");
    if (source) {
      if (curBook.sourceUrl) source.setAttribute("href", curBook.sourceUrl);
      else source.removeAttribute("href");
    }

    updateNav();
    hideImg(); /* the credits sheet replaces the illustration */
    return true;
  }

  /* Same code path as the prev/next buttons (and goPage/keys/swipe). */
  function goPrev() {
    if (!readerOpen || !curBook) return false;
    if (curView === "credits") return goPage(pageCount());
    if (curPage <= 1) return false;
    return goPage(curPage - 1);
  }

  function goNext() {
    if (!readerOpen || !curBook) return false;
    if (curView === "credits") return false;
    if (curPage >= pageCount()) return showCredits();
    return goPage(curPage + 1);
  }

  function showReader() {
    const root = byId("bookreader");
    const shelf = byId("bookshelf");
    if (shelf) shelf.classList.add("hidden");  /* the shelf goes quiet */
    if (root) root.classList.remove("hidden");
  }

  function hideReader() {
    const root = byId("bookreader");
    if (root) root.classList.add("hidden");
    clearPendingImage();
  }

  function showLoadingPage() {
    setCreditsVisible(false);
    hideImg();
    const textWrap = byId("bookreader-textbox");
    const textEl = byId("bookreader-text");
    if (textWrap) textWrap.classList.remove("hidden");
    if (textEl) textEl.textContent = "📚 Opening the story…";
    const root = byId("bookreader");
    if (root) root.classList.remove("bookreader-textonly", "bookreader-imageonly");
    const prev = byId("bookreader-prev");
    const next = byId("bookreader-next");
    if (prev) prev.disabled = true;
    if (next) next.disabled = true;
    const indicator = byId("bookreader-page");
    if (indicator) indicator.textContent = "…";
    updateTtsButton(); /* no book yet → 🔊 Read page hides */
  }

  function renderBookError() {
    setCreditsVisible(false);
    hideImg();
    setTitle("😢 Can't open this book");
    const textWrap = byId("bookreader-textbox");
    const textEl = byId("bookreader-text");
    if (textWrap) textWrap.classList.remove("hidden");
    const root = byId("bookreader");
    if (root) root.classList.remove("bookreader-imageonly");
    if (root) root.classList.add("bookreader-textonly");
    if (textEl) textEl.textContent = "This story won't open right now. Tap 📚 Bookshelf to pick another one.";
    const prev = byId("bookreader-prev");
    const next = byId("bookreader-next");
    if (prev) prev.disabled = true;
    if (next) next.disabled = true;
    const indicator = byId("bookreader-page");
    if (indicator) indicator.textContent = "…";
    updateTtsButton(); /* failed open → 🔊 Read page hides */
  }

  /* ---------- public surface ---------- */

  function openShelf() {
    const shelf = byId("bookshelf");
    const grid = byId("bookshelf-grid");
    if (!shelf || !grid) {
      talk(MISSING_UI_TALK);
      return false;
    }
    wireShelf();
    /* Opening the shelf over a reader tears the reader down cleanly
       (its in-flight work is dropped by the epoch bump). */
    if (readerOpen) {
      epoch++;
      teardownTTS(); /* no audio/speech may survive the teardown */
      readerOpen = false;
      curBook = null;
      curBookId = null;
      curPage = 1;
      curView = "page";
      setTitle("");
      hideReader();
    }
    shelfOpen = true;
    shelf.classList.remove("hidden");
    showReadButton(false); /* the read pill hides while the shelf is open */
    if (books) renderCards(grid, books);
    else loadInto(grid);   /* lazy first fetch; cached promise after that */
    const closeBtn = byId("bookshelf-close");
    if (closeBtn) closeBtn.focus({ preventScroll: true });
    return true;
  }

  /* openBook(id): fetch + cache the book.json (per-book promise
     cache), render the reader over the stage on page 1, hide the
     shelf (it stays warm — closeBook never refetches the manifest).
     Never rejects: resolves true when THIS call's render survived,
     false when superseded or on failure (card taps ignore it). */
  function openBook(rawId) {
    const id = normalizeId(rawId);
    const token = ++epoch;          /* every newer transition wins   */
    teardownTTS();                  /* book switch kills narration  */
    wireReader();
    readerOpen = true;
    shelfOpen = false;
    curView = "page";
    curBook = null;
    curBookId = id;
    curPage = 1;
    setTitle("");
    clearPendingImage();
    showReader();
    showReadButton(false);          /* hidden while the reader shows */
    showLoadingPage();

    return ensureManifest()
      .then(function () {
        const entry = findEntry(id);
        if (!entry) throw new Error("no manifest entry for book " + id);
        if (token === epoch) setTitle(entry.title || "");
        return loadBook(entry);
      })
      .then(function (data) {
        if (token !== epoch) return false;   /* stale — drop silently */
        curBook = data;
        if (data.id != null) curBookId = normalizeId(data.id);
        setTitle(data.title || curTitle);
        renderPage(1, token);
        return true;
      })
      .catch(function (err) {
        if (token !== epoch) return false;   /* stale failure: silent */
        warn("can't open book " + id, err);
        talk(BOOK_FAIL_TALK);
        renderBookError();
        return false;
      });
  }

  /* closeBook(): reader → warm shelf (page stays on the book's cache,
     the manifest is never refetched). */
  function closeBook() {
    if (!readerOpen) return false;
    epoch++;                       /* cancels in-flight loads/renders */
    teardownTTS();                 /* nothing may outlive the reader  */
    readerOpen = false;
    curBook = null;
    curBookId = null;
    curPage = 1;
    curView = "page";
    setTitle("");
    hideReader();
    showShelf();                   /* warm cards; no fetch when loaded */
    const closeBtn = byId("bookshelf-close");
    if (closeBtn) closeBtn.focus({ preventScroll: true });
    return true;
  }

  /* goPage(n): 1-based; the exact path the prev/next buttons fire. */
  function goPage(n) {
    if (!readerOpen || !curBook) return false;
    const token = ++epoch;
    stopTTS();                     /* STOP rule: any page turn      */
    return renderPage(n, token);
  }

  function showCredits() {
    if (!readerOpen || !curBook) return false;
    const token = ++epoch;
    stopTTS();                     /* STOP rule: credits open       */
    return renderCredits(token);
  }

  /* Full teardown: reader AND shelf. Clean even mid-fetch (the epoch
     bump drops the pending chain; no late DOM writes). */
  function close() {
    if (!shelfOpen && !readerOpen) return false;
    epoch++;
    teardownTTS();                 /* STOP rule: full teardown      */
    readerOpen = false;
    curBook = null;
    curBookId = null;
    curPage = 1;
    curView = "page";
    setTitle("");
    hideReader();
    shelfOpen = false;
    const shelf = byId("bookshelf");
    if (shelf) shelf.classList.add("hidden");
    showReadButton(true); /* back in the library: the read pill returns */
    const btn = byId("library-read-button");
    if (btn) btn.focus({ preventScroll: true });
    return true;
  }

  function isOpen() {
    return shelfOpen || readerOpen;
  }

  function state() {
    return {
      open: shelfOpen || readerOpen,
      manifestLoaded: !!books,
      count: books ? books.length : 0,
      books: books ? books.slice() : [],
      view: readerOpen ? curView : "shelf",
      bookId: readerOpen ? curBookId : null,
      page: readerOpen ? curPage : 0,
      pageCount: readerOpen ? pageCount() : 0,
      title: readerOpen ? curTitle : ""
    };
  }

  function list() {
    return books ? books.slice() : [];
  }

  /* The Back/Escape seam: true = consumed (one level peeled:
     reader(page or credits) → shelf → library), false = leave it to
     the library/map. */
  function handleBack() {
    if (readerOpen) {
      closeBook();
      return true;
    }
    if (!shelfOpen) return false;
    close();
    return true;
  }

  function waitReady() {
    return ensureManifest().then(
      function () { return true; },
      function () { return false; }
    );
  }

  window.BooksUI = {
    openShelf: openShelf,
    close: close,
    isOpen: isOpen,
    state: state,
    list: list,
    handleBack: handleBack,
    waitReady: waitReady,
    openBook: openBook,
    closeBook: closeBook
  };

  /* ---------- QA hook (Playwright) ---------- */

  window.__books = {
    openShelf: function () { return window.BooksUI.openShelf(); },
    close: function () { return window.BooksUI.close(); },
    isOpen: function () { return window.BooksUI.isOpen(); },
    state: function () { return window.BooksUI.state(); },
    list: function () { return window.BooksUI.list(); },
    waitReady: function () { return window.BooksUI.waitReady(); },
    openBook: function (id) { return window.BooksUI.openBook(id); },
    closeBook: function () { return window.BooksUI.closeBook(); },
    goPage: function (n) { return goPage(n); },
    showCredits: function () { return showCredits(); },
    /* The exact #bookreader-tts click code path (toggle: start / stop
       / replay). Resolves to the resulting playing state. */
    tts: function () { return toggleTTS(); },
    /* {playing, source:'audio'|'speech'|'none', bookId, page} —
       source is what the CURRENT page would use ("none" = the
       disabled-button state). */
    ttsState: function () {
      return {
        playing: ttsPlaying,
        source: ttsSourceForPage(),
        bookId: readerOpen ? curBookId : null,
        page: readerOpen ? curPage : 0
      };
    }
  };
})();
