/* ============================================================
    Lily's Dress-Up Adventure — Map screen (the little town)
    Shows a lively town board: roads linking the places, trees,
    flowers, a fountain and little people. The chosen friend's
    marker stands on the current place; travelling between places
    costs a little energy. Never punishing: if she's too hungry
    to travel, the game gently suggests a snack instead of failing.

    Places are positioned by their CENTER (cx/cy in % of the
    board); .place has transform: translate(-50%,-50%) in CSS.

    Travelling now WALKS the chosen friend (in her current outfit)
    overland along the road network — a BFS route through the
    ROADS graph — instead of teleporting a dot. On narrow screens
    (list mode) or reduced-motion preferences the trip completes
    instantly (teleport) since the 2D board isn't visible anyway.
    Sound comes for free from sounds.js: the energy spend fires
    'travel', the arrival setLocation fires 'cheer'.

    Exposes window.MapWorld = { places, roads, centerOf(id),
    placeButtonEl(id), boardEl } so other tasks can reuse the
    town coordinates without duplicating.

    Uses window.GameState, window.CharacterRenderer, window.GameUI,
    window.GameText.
    ============================================================ */

(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  /* ---------- Places (cx/cy = button CENTER in % of the board) ---------- */

  const PLACES = [
    { id: "home",    name: "🏠 Home",      cx: 22, cy: 60, cost: 0  },
    { id: "park",    name: "🌳 Park",      cx: 50, cy: 26, cost: 8  },
    { id: "school",  name: "🏫 School",    cx: 78, cy: 52, cost: 10 },
    { id: "library", name: "📚 Library",   cx: 26, cy: 20, cost: 8  },
    { id: "shop",    name: "🛍️ Toy Shop", cx: 55, cy: 74, cost: 12 },
    { id: "grandma", name: "💜 Grandma's", cx: 84, cy: 24, cost: 15 },
    { id: "beach",   name: "🏖️ Beach",    cx: 85, cy: 80, cost: 15 }
  ];

  /* ---------- Road network: pairs of neighbouring place ids ---------- */

  const ROADS = [
    ["home", "park"],
    ["park", "school"],
    ["park", "library"],
    ["school", "grandma"],
    ["home", "shop"],
    ["shop", "school"],
    ["shop", "beach"],
    ["home", "library"]
  ];

  /* ---------- Decorations: static emoji dotted around the town ---------- */

  const DECOR = [
    { emoji: "🌳", x: 42, y: 13, anim: "sway" },   // beside the park
    { emoji: "🌲", x: 58, y: 15 },
    { emoji: "🌳", x: 63, y: 33, anim: "sway" },   // between park and school
    { emoji: "🌴", x: 93, y: 71 },                 // near the beach
    { emoji: "🌷", x: 37, y: 33, size: "1.2rem" }, // along the roads
    { emoji: "🌼", x: 16, y: 36, size: "1.2rem" },
    { emoji: "🌸", x: 45, y: 61, size: "1.2rem" },
    { emoji: "🌷", x: 68, y: 64, size: "1.2rem" },
    { emoji: "🌼", x: 91, y: 42, size: "1.2rem" },
    { emoji: "⛲", x: 36, y: 47, size: "2.2rem", anim: "bob" }, // town fountain
    { emoji: "🏡", x: 10, y: 78 },
    { emoji: "🏡", x: 68, y: 15 },
    { emoji: "🪑", x: 29, y: 44, size: "1.3rem" }, // bench by the fountain
    { emoji: "🌲", x: 8,  y: 45 },
    { emoji: "🐦", x: 31, y: 6,  size: "1.1rem", anim: "bob" }, // sky birds
    { emoji: "🐦", x: 62, y: 8,  size: "1.1rem", anim: "bob" }
  ];

  /* ---------- Little people: a dozen-ish folk living the town life ---------- */

  const FOLK = [
    { emoji: "🚶‍♀️", x: 46, y: 47, anim: "bob" },  // strolling to the fountain
    { emoji: "🧍‍♀️", x: 60, y: 44 },               // near the school road
    { emoji: "👩‍🦳", x: 83, y: 66 },               // outside the school
    { emoji: "🧒", x: 45, y: 87, anim: "sway" },  // below the toy shop
    { emoji: "🐕", x: 39, y: 80, flip: true },    // dog on a walk
    { emoji: "👨‍👩‍👧", x: 66, y: 84 },          // family heading to the beach
    { emoji: "🚶‍♂️", x: 12, y: 26, flip: true }   // walker up the library road
  ];

  const ALREADY_TALK = "We're already here! 💕";

  /* Dynamic copy: built with the chosen friend's name. */
  function hungryTalk() {
    const name = window.GameText ? window.GameText.name() : "Lily";
    return name + " is too hungry to travel! 🍎 Give her a snack first!";
  }

  /* One kid-friendly arrival message per place */
  const ARRIVAL_TALKS = {
    home: "Home sweet home! 💕",
    park: "The flowers are so pretty! 🌸",
    library: "Shhh… let's read a story! 📖",
    school: "Time to learn and play! 🏫",
    beach: "Look at the waves! 🌊",
    shop: "So many toys to see! 🧸",
    grandma: "Grandma gives the best hugs! 💜"
  };

  /* ---------- Walk timing: consistent speed, capped so trips stay snappy ---------- */

  const WALK_SPEED_PX_PER_S = 190;
  const WALK_MIN_MS = 900;   // one short hop still reads as a walk
  const WALK_MAX_MS = 4500;  // long trips never feel boring

  /* ---------- Module state ---------- */

  let boardEl = null;
  let isWalking = false;      // blocks clicks while she is mid-trip
  let activeWalk = null;      // { el, flipEl, way, startTs, durationMs, rafId, done, onDone }

  /* ---------- Helpers ---------- */

  function findPlace(placeId) {
    for (let i = 0; i < PLACES.length; i++) {
      if (PLACES[i].id === placeId) return PLACES[i];
    }
    return null;
  }

  function getPlaceButton(placeId) {
    if (!boardEl) return null;
    return boardEl.querySelector('.place[data-place-id="' + placeId + '"]');
  }

  function getCharacterContainer(placeId) {
    const button = getPlaceButton(placeId);
    return button ? button.querySelector(".place-character") : null;
  }

  /* Clear every marker (including any mid-walk hiding class), then
     draw small Lily into the current place's slot only. Idempotent —
     safe to call on any change, including right after a walk lands. */
  function renderMarker(placeId) {
    if (!boardEl) return;
    const containers = boardEl.querySelectorAll(".place-character");
    for (let i = 0; i < containers.length; i++) {
      // Un-register before clearing, or refreshAll() would paint a
      // standing Lily back into every place we've ever visited.
      if (window.CharacterRenderer && window.CharacterRenderer.forget) {
        window.CharacterRenderer.forget(containers[i]);
      }
      containers[i].innerHTML = "";
      containers[i].classList.remove("walking-out");
    }
    const current = getCharacterContainer(placeId);
    if (current && window.CharacterRenderer) {
      window.CharacterRenderer.render(current, { size: "small" });
    }
  }

  function updateCurrentPlaceText(location) {
    const el = document.getElementById("current-place");
    if (!el) return;
    const name = window.GameText ? window.GameText.name() : "Lily";
    el.textContent = name + " is at: " + location.name;
  }

  /* The 🌊 Play at the Beach! button only shows while she is AT the
     beach; it opens the beach overlay (js/beach.js). */
  function updateBeachPlayButton(locationId) {
    const btn = document.getElementById("beach-play-button");
    if (!btn) return;
    btn.classList.toggle("hidden", locationId !== "beach");
  }

  /* ---------- 🛣 roads + 🌳 town dressing ---------- */

  /* One SVG layer, viewBox 0..100 on both axes with
     preserveAspectRatio="none", so cx/cy percentages map 1:1 onto
     the board. Strokes use vector-effect: non-scaling-stroke so
     they keep a constant pixel width whatever the board's aspect. */
  function renderRoads() {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "map-road");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");

    const base = document.createElementNS(SVG_NS, "g");
    const dashes = document.createElementNS(SVG_NS, "g");

    ROADS.forEach(function (road) {
      const a = findPlace(road[0]);
      const b = findPlace(road[1]);
      if (!a || !b) return;
      [["road", base], ["road-dash", dashes]].forEach(function (pair) {
        const line = document.createElementNS(SVG_NS, "line");
        line.setAttribute("class", pair[0]);
        line.setAttribute("x1", a.cx);
        line.setAttribute("y1", a.cy);
        line.setAttribute("x2", b.cx);
        line.setAttribute("y2", b.cy);
        pair[1].appendChild(line);
      });
    });

    svg.appendChild(base);   // thick tan road under…
    svg.appendChild(dashes); // …the dashed white center line
    boardEl.appendChild(svg);
  }

  function makeDecorItem(entry, extraClass) {
    const item = document.createElement("span");
    item.className = "map-decor-item" + (extraClass ? " " + extraClass : "");
    item.style.left = entry.x + "%";
    item.style.top = entry.y + "%";
    /* Flip on the outer (centering) item so the inner sway/bob
       animation never overrides the mirror transform. */
    if (entry.flip) {
      item.style.transform = "translate(-50%,-50%) scaleX(-1)";
    }
    const glyph = document.createElement("span");
    glyph.className = "decor-emoji" + (entry.anim ? " decor-" + entry.anim : "");
    if (entry.size) glyph.style.fontSize = entry.size;
    glyph.textContent = entry.emoji;
    item.appendChild(glyph);
    return item;
  }

  function renderDecor() {
    const layer = document.createElement("div");
    layer.className = "map-decor";
    layer.setAttribute("aria-hidden", "true");

    DECOR.forEach(function (d) {
      layer.appendChild(makeDecorItem(d));
    });
    FOLK.forEach(function (p) {
      layer.appendChild(makeDecorItem(p, "folk"));
    });

    boardEl.appendChild(layer);
  }

  /* ---------- 🛣 road graph + BFS routes ---------- */

  /* Adjacency built once from the same ROADS list that paints the
     SVG roads, so the walk always follows a visible tan road. */
  function buildAdjacency() {
    const adj = {};
    PLACES.forEach(function (p) { adj[p.id] = []; });
    ROADS.forEach(function (road) {
      if (adj[road[0]] && adj[road[1]]) {
        adj[road[0]].push(road[1]);
        adj[road[1]].push(road[0]);
      }
    });
    return adj;
  }

  const ADJACENCY = buildAdjacency();

  /* Shortest place-id route from startId to goalId over the road
     graph (e.g. [home, park, school]). Falls back to a straight
     [start, goal] line if either end is unknown or unroutable. */
  function findRoute(startId, goalId) {
    if (!ADJACENCY[startId] || !ADJACENCY[goalId]) return [startId, goalId];
    if (startId === goalId) return [startId];

    const prev = {};
    const seen = {};
    const queue = [startId];
    seen[startId] = true;

    while (queue.length) {
      const cur = queue.shift();
      const neighbors = ADJACENCY[cur];
      for (let i = 0; i < neighbors.length; i++) {
        const next = neighbors[i];
        if (seen[next]) continue;
        seen[next] = true;
        prev[next] = cur;
        if (next === goalId) {
          const route = [goalId];
          let at = goalId;
          while (at !== startId) {
            at = prev[at];
            route.unshift(at);
          }
          return route;
        }
        queue.push(next);
      }
    }
    return [startId, goalId]; // disconnected graph: walk straight there
  }

  /* ---------- 🚶 the walking friend (overland travel on the roads) ---------- */

  function prefersReducedMotion() {
    return !!(window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /* ≤640px the board becomes a vertical list (see style.css), so a
     2D walk is meaningless there — complete the trip instantly. */
  function isListMode() {
    return !!(window.matchMedia &&
      window.matchMedia("(max-width: 640px)").matches);
  }

  /* "🏫 School" -> "School", for kid-readable walk chatter. */
  function shortPlaceName(placeId) {
    const place = findPlace(placeId);
    if (!place) return "the next place";
    return place.name.replace(/^[^A-Za-z]+/, "");
  }

  /* End the walk: cancel its frame loop, remove the walker element,
     fire onDone exactly once. Also used for the instant-teleport paths. */
  function finishWalk(walk) {
    if (!walk || walk.done) return;
    walk.done = true;
    if (walk.rafId) window.cancelAnimationFrame(walk.rafId);
    if (walk.el && walk.el.parentNode) walk.el.parentNode.removeChild(walk.el);
    /* Drop the walker's bob container from the renderer registry too,
       so nothing keeps repainting the character we just removed. */
    if (walk.el && window.CharacterRenderer && window.CharacterRenderer.forget) {
      const bob = walk.el.querySelector(".map-walker-bob");
      if (bob) window.CharacterRenderer.forget(bob);
    }
    activeWalk = null;
    walk.onDone();
  }

  function cancelActiveWalk() {
    if (activeWalk) finishWalk(activeWalk);
  }

  /* Three nested layers, one transform each, so they never fight:
     outer .map-walker = position (JS translate),
     middle .map-walker-flip = direction (scaleX mirror),
     inner .map-walker-bob = step waddle (CSS keyframes).
     The character SVG is rendered INTO the bob layer, so it always
     shows the chosen friend in her CURRENT outfit (CharacterRenderer
     reads GameState and re-renders registered instances on change). */
  function createWalkerEl() {
    const walker = document.createElement("div");
    walker.className = "map-walker";
    walker.setAttribute("aria-hidden", "true");

    const flip = document.createElement("div");
    flip.className = "map-walker-flip";

    const bob = document.createElement("div");
    bob.className = "map-walker-bob walking";
    if (window.CharacterRenderer) {
      window.CharacterRenderer.render(bob, { size: "small" });
    }

    flip.appendChild(bob);
    walker.appendChild(flip);
    boardEl.appendChild(walker);
    return { el: walker, flipEl: flip };
  }

  /* Feet sit on the road point: anchor the walker box at its
     bottom-center. px/py are board-relative pixel coordinates. */
  function placeWalkerAt(walk, px, py) {
    walk.el.style.transform =
      "translate(" + px + "px," + py + "px) translate(-50%,-90%)";
  }

  /* One animation frame: convert the %-waypoints to live board
     pixels (robust to resize / layout changes), interpolate along
     the polyline, face the travel direction, finish on arrival. */
  function walkerFrame(now) {
    const walk = activeWalk;
    if (!walk || walk.done) return;

    /* Left the map screen mid-walk, or the board vanished: don't
       dangle — land her at the destination instantly instead. */
    if (!walk.el.isConnected || !boardEl ||
        boardEl.clientWidth === 0 || boardEl.clientHeight === 0) {
      finishWalk(walk);
      return;
    }

    if (!walk.startTs) walk.startTs = now;

    const W = boardEl.clientWidth;
    const H = boardEl.clientHeight;
    const pts = walk.way.map(function (p) {
      return { x: (p.xPct / 100) * W, y: (p.yPct / 100) * H };
    });

    let total = 0;
    const segs = [];
    for (let i = 1; i < pts.length; i++) {
      const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      segs.push(len);
      total += len;
    }

    const t = walk.durationMs > 0
      ? Math.min(1, (now - walk.startTs) / walk.durationMs)
      : 1;

    let dist = total * t;
    let idx = 0;
    while (idx < segs.length - 1 && dist > segs[idx]) {
      dist -= segs[idx];
      idx++;
    }
    const a = pts[idx];
    const b = pts[idx + 1] || a;
    const f = segs[idx] > 0 ? Math.min(1, dist / segs[idx]) : 1;
    placeWalkerAt(walk, a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);

    /* Face along the road; near-vertical segments keep last facing. */
    const dx = b.x - a.x;
    if (Math.abs(dx) > 0.5) {
      walk.flipEl.classList.toggle("face-left", dx < 0);
    }

    if (t >= 1) {
      finishWalk(walk);
      return;
    }
    walk.rafId = window.requestAnimationFrame(walkerFrame);
  }

  /* Walk from fromId to toId along the road network, then run onDone.
     Callers set/clear isWalking around this; onDone fires exactly once
     whether the trip animated, teleported (reduced motion / list mode)
     or got cut short by a screen change. */
  function startWalk(fromId, toId, onDone) {
    cancelActiveWalk(); // defensive: never two walkers at once

    const walk = {
      el: null,
      flipEl: null,
      way: [],
      startTs: 0,
      durationMs: 0,
      rafId: 0,
      done: false,
      onDone: onDone
    };
    activeWalk = walk;

    /* %-waypoints along the BFS route; unknown ids → straight line. */
    const route = findRoute(fromId, toId);
    route.forEach(function (id) {
      const place = findPlace(id);
      if (place) walk.way.push({ xPct: place.cx, yPct: place.cy });
    });
    if (walk.way.length < 2) {
      finishWalk(walk); // nothing to walk (bad ids / degenerate route)
      return;
    }

    /* Instant-trip escapes: reduced motion, mobile list layout, or a
       board that isn't visible/laid out right now. */
    if (prefersReducedMotion() || isListMode() ||
        !boardEl || boardEl.clientWidth === 0) {
      finishWalk(walk);
      return;
    }

    /* Duration = path pixel length at the board's current size. */
    const W = boardEl.clientWidth;
    const H = boardEl.clientHeight;
    let totalPx = 0;
    for (let i = 1; i < walk.way.length; i++) {
      const dx = ((walk.way[i].xPct - walk.way[i - 1].xPct) / 100) * W;
      const dy = ((walk.way[i].yPct - walk.way[i - 1].yPct) / 100) * H;
      totalPx += Math.hypot(dx, dy);
    }
    walk.durationMs = Math.max(
      WALK_MIN_MS,
      Math.min(WALK_MAX_MS, (totalPx / WALK_SPEED_PX_PER_S) * 1000)
    );

    /* Hide the standing marker at the START so only the walker is
       visible mid-trip; the arrival setLocation → renderMarker
       clears the class and paints her at the destination. */
    const startMarker = getCharacterContainer(fromId);
    if (startMarker) startMarker.classList.add("walking-out");

    const created = createWalkerEl();
    walk.el = created.el;
    walk.flipEl = created.flipEl;
    placeWalkerAt(walk, (walk.way[0].xPct / 100) * W, (walk.way[0].yPct / 100) * H);

    const ui = window.GameUI;
    if (ui) ui.setTalk("Off to " + shortPlaceName(toId) + "! 🚶‍♀️");

    walk.rafId = window.requestAnimationFrame(walkerFrame);
  }

  /* ---------- Click handling ---------- */

  function onPlaceClick(event) {
    /* Mid-walk she is committed to the current trip: ignore ALL
       clicks so she can't be double-moved or double-charged. */
    if (isWalking) return;

    const button = event.currentTarget;
    const place = findPlace(button.getAttribute("data-place-id"));
    if (!place) return;

    const gs = window.GameState;
    const ui = window.GameUI;
    const renderer = window.CharacterRenderer;
    const location = gs.getLocation();

    // Already standing here: just a happy bounce, no energy cost.
    if (place.id === location.id) {
      if (ui) ui.setTalk(ALREADY_TALK);
      if (renderer) renderer.playAnimation(getCharacterContainer(place.id), "bounce");
      if (place.id === "beach" && window.BeachScene) window.BeachScene.open();
      return;
    }

    // Not enough energy: friendly snack suggestion, no penalty.
    const newEnergy = gs.spend(place.cost);
    if (newEnergy === null) {
      if (ui) ui.setTalk(hungryTalk());
      if (renderer) renderer.playAnimation(getCharacterContainer(location.id), "bounce");
      return;
    }

    /* Affordable trip! Energy is paid upfront (spend() already
       notified listeners — sounds.js fires the 'travel' whoosh).
       setLocation happens only when she ARRIVES, so the marker
       never teleports ahead of her: during the walk the start
       marker is hidden and the walker is the only "her" on the
       board. renderMarker (via setLocation's notify) then paints
       her standing at the destination and clears the hiding
       class; sounds.js adds the arrival 'cheer' after. */
    isWalking = true;
    startWalk(location.id, place.id, function () {
      gs.setLocation(place.id, place.name);
      if (renderer) renderer.playAnimation(getCharacterContainer(place.id), "cheer");
      if (ui) ui.setTalk(ARRIVAL_TALKS[place.id] || "We made it! ✨");
      isWalking = false;
    });
  }

  /* ---------- State sync ---------- */

  function onStateChanged(snapshot) {
    updateCurrentPlaceText(snapshot.location);
    updateBeachPlayButton(snapshot.location.id);
    // Idempotent re-render: keeps the marker on the right place and
    // refreshes her outfit + the name copy too (cheap, and never
    // double-renders ghosts).
    renderMarker(snapshot.location.id);
  }

  /* ---------- Build the board ---------- */

  function renderPlaces() {
    PLACES.forEach(function (place) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "place";
      button.setAttribute("data-place-id", place.id);
      /* cx/cy is the button center; CSS translate(-50%,-50%)
         anchors the box around that point. */
      button.style.left = place.cx + "%";
      button.style.top = place.cy + "%";

      const label = document.createElement("span");
      label.className = "place-label";
      label.textContent = place.name;

      const badge = document.createElement("span");
      badge.className = "cost-badge";
      badge.textContent = "💛 " + place.cost;

      const marker = document.createElement("span");
      marker.className = "place-character";

      button.appendChild(label);
      button.appendChild(badge);
      button.appendChild(marker);
      button.addEventListener("click", onPlaceClick);
      boardEl.appendChild(button);
    });
  }

  function init() {
    /* Beach play button (lives in the map screen markup, index.html). */
    const beachPlayBtn = document.getElementById("beach-play-button");
    if (beachPlayBtn) {
      beachPlayBtn.addEventListener("click", function () {
        if (window.BeachScene) window.BeachScene.open();
      });
    }
    if (window.GameState) {
      updateBeachPlayButton(window.GameState.getLocation().id);
    }

    boardEl = document.getElementById("map-board");
    if (!boardEl) return;

    /* Layer order (also DOM order): roads (z0) under decor (z1)
       under the walking friend (z2) under the place buttons (z3) —
       see the z-indexes in css/style.css. */
    renderRoads();
    renderDecor();
    renderPlaces();

    const gs = window.GameState;
    const location = gs.getLocation();
    updateCurrentPlaceText(location);
    renderMarker(location.id);

    /* friends.js (which defines GameText) is deferred AFTER this file,
       so the very first paint may not see the chosen name yet. When
       that happens, repaint the copy once DOMContentLoaded fires —
       by then every deferred script has run. */
    if (!window.GameText && document.readyState !== "complete") {
      document.addEventListener("DOMContentLoaded", function () {
        updateCurrentPlaceText(gs.getLocation());
      });
    }

    gs.onChange(onStateChanged);
  }

  /* ---------- Read-only town data for later tasks (walking Lily) ---------- */

  window.MapWorld = {
    places: PLACES,
    roads: ROADS,
    centerOf: function (placeId) {
      const place = findPlace(placeId);
      return place ? { xPct: place.cx, yPct: place.cy } : null;
    },
    placeButtonEl: function (placeId) {
      return getPlaceButton(placeId);
    },
    get boardEl() {
      return boardEl;
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
