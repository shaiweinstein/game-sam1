/* ============================================================
   Lily's Dress-Up Adventure — Surfing (mission 9)

     window.BeachSurf — a catchable rideable wave in the canvas
     sea, built exactly like js/beach-boat.js: zero load-time
     dependencies (window.BeachGame / BeachRig / BeachScene /
     BeachBoat / GameSounds are only touched at call time), a
     null-safe singleton, full detached-safety — every public
     method no-ops before attach() / after detach(), and a
     module.exports seam for the headless acceptance harness.

     WorldScene.create() calls attach(scene) after BeachBoat,
     WorldScene.update() calls frame(time, delta) AFTER
     BeachBoat.frame and BEFORE BeachRig.update, so a ride
     pushes anchor/stance/speed/facing the same frame it moves.
     Scene 'shutdown' detaches (beach-game.js close() repeats it).

     STATE MACHINE: 'wait' (no wave) → after a spawn delay →
     'wave' (a rideable crest rolls right→left across the sea) →
     kid swims next to it (locomotion still on) → the 🏄 action
     button lights (.is-ready) while the crest passes her → tap →
     'riding' (loco disabled, surf owns the anchor, she stands on
     a board CARIED by the crest and carve-steers cross-shore) →
     gentle roll-off at the shore / wave edge → 'wait' again with
     a fresh spawn delay. The wave re-spawns forever; every ride
     ends as a SUCCESS (+1 wave on the chip) — no penalties, ever.

     LAYERS (depth order from beach-game.js: waterG 5, propsG 10,
     rippleG 14, rig 15, submergeG 16):
       waveG  depth 6  — the rideable crest (NEW layer, just above
                         the decorative water sheets, below props),
                         re-traced per frame (~30 commands, sized off
                         the rig's character height);
       boardG depth 14 — the surfboard UNDER the rig (15) so she
                        stands ON it + the board shadow + the
                        dismount foam rings.

     COEXISTENCE with the duck boat: canCatch() refuses while
     BeachBoat.riding(); this module's pointerdown refuses while
     the boat rides, and beach-boat.js gained the mirrored guards
     (its pointerdown refuses while surfing, and a pending 'invited'
     auto-swim cancels quietly during a surf ride). Cross-checks go
     through window.* existence tests only — no hard dependency.

     Reduced motion (BeachGame.reducedMotion() / wavePhase() pinned
     to 0): the wave still travels and steering still works (both
     are gameplay/control, same policy as the boat), but the crest
     bob, foam shimmer and spray jitter collapse to their resting
     frame and the dismount foam keeps only its alpha fade.
     ============================================================ */

(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  /* ---- mission 9 tuning sheet (fractional stage units unless
     noted) ---- */
  const SURF = {
    spawnFirst: 1.8,              // s of 'wait' before the first wave
    spawnMin: 2.2, spawnMax: 4.8, // respawn delay range after a wave/ride
    waveSpeed: 0.16,              // width units/s, right → left
    spawnFx: 1.08,                // enter just off the right edge
    despawnFx: -0.12,             // fully rolled out of view (missed)
    fxMin: 0.05, edgePad: 0.11,   // ride ends at boardFx <= 0.16 (edgePad
                                   //  was 0.02 → she was dumped at fx 0.07,
                                   //  half off the left edge — 0.16 keeps the
                                   //  dismount float fully on screen)
    catchRadius: 0.08,            // |crestFx − loco anchorFx| to catch
    seaGuard: 0.06,               // anchor fy must be < sandTop − 0.06
    bandUp: 0.06,                 // carve band top    = waveFy − 0.06
    bandLowPad: 0.04,             // carve band bottom = sandTop − 0.04
    shorePad: 0.05,               // boardFy >= sandTop − 0.05 → roll off
    pointPad: 0.03,               // hold counts only while fy < sandTop − 0.03
    carveSpeed: 0.14,             // max cross-shore fy/s while carving (applied in fy)
    /* carveStop / carveEase are measured in CORRECTED width units
       (dy / aspect) so surf's ease/stop trigger at the SAME on-screen
       distance as the boat's steer — previously they were raw fy
       fractions, which made the "same FEEL" comment false (finding 6).
       Rescaled from the old fy values to preserve behaviour on a
       ~1.9 aspect stage: stop 0.004·fy→0.002·w, ease 0.05·fy→0.026·w. */
    carveEase: 0.026,             // ease-out window near the carve target (width units)
    carveFloor: 0.4,              // speed FLOOR while held — never crawls
    carveStop: 0.002,             // snap-arrive on the carve target (width units)
    leanMax: 0.04,                // ± fx lean around the crest from pointer dx
    leanEase: 3.0,                // 1/s easing of the lean
    speedRef: 0.30,               // ride speed normaliser for rig.setSpeed
    tiltDeg: 7,                   // max board nose/tail tilt from carving
    crestHz: 0.45, bobPx: 4,      // crest bob (× wavePhase, frozen at 0 under RM)
    splashEvery: 0.09,            // width units between ride foam puffs
    splashLife: 0.8,              // s per foam ring (ride puffs + dismount)
    splashCap: 16,
    /* real-time substep policy — see BOAT.slice/frameCap / locoFrame */
    slice: 1 / 60,
    frameCap: 0.5
  };

  const RIDE_TALKS = ["Great ride! 🏄", "Woo! 🌊", "Again! 🏄"];

  /* Art palette — the old DOM crest's teals + the house ink; the
     board is the pink/teal candy scheme of the beach kit. */
  const COL = {
    ink: 0x3a2e6e, inkA: 0.12,
    face: 0x2f9fb5,      // rolling wave body (much taller/opaqueer
    faceDeep: 0x25809a,  //   than the ≤0.35-alpha decorative sheets)
    pale: 0x4fc3d9,      // inner wall catching the light
    foam: 0xffffff,
    boardPink: 0xff8fb8, boardTeal: 0x4fc3d9, deck: 0xfff9ec
  };

  /* ---------- module state (all nulled by detach) ---------- */
  let scene = null;
  let waveG = null;    // depth 6 — the rideable crest
  let boardG = null;   // depth 14 — board under the rig + foam rings
  let st = null;       // live state, see newState()
  let chipEl = null;   // "🌊 N" DOM chip (browser only, guarded)

  function newState() {
    return {
      mode: "wait",            // 'wait' | 'wave' | 'riding'
      wave: null,              // { fx, fy, seed } while 'wave'/'riding'
      spawnT: SURF.spawnFirst, // s of 'wait' left before the next wave
      boardFx: 0.5, boardFy: 0.6,
      lean: 0,                 // fx offset from the crest (eased)
      vy: 0,                   // cross-shore velocity fy/s (tilt + gait)
      steerHeld: false,        // event-driven hold (pointerdown sets, up clears)
      steerPointerId: null,    // owning finger id (multi-touch first-down-wins)
      steerFx: 0, steerFy: 0,  // clamped steer target while held (fractions)
      splashAcc: 0,            // distance accumulator for ride foam
      counter: 0,              // completed rides (the 🌊 N chip)
      lastReady: false,        // last published canCatch (button sync)
      splash: [],              // ride puffs + dismount foam {x,y px, t0 s}
      clock: 0                 // last frame time in seconds (foam ages)
    };
  }

  /* ---------- tiny pure helpers (browser-safe, NaN-safe) ---------- */

  function num(v, fallback) {
    return (typeof v === "number" && isFinite(v)) ? v : fallback;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function layoutNow() {
    const B = window.BeachGame;
    return (B && typeof B.layout === "function") ? B.layout() : null;
  }

  function usable(L) {
    return !!(L && L.w >= 2 && L.h >= 2);
  }

  function isReduced() {
    const B = window.BeachGame;
    try {
      return !!(B && typeof B.reducedMotion === "function" && B.reducedMotion());
    } catch (e) {
      return false;
    }
  }

  function waveTime() {
    const B = window.BeachGame;
    try {
      return (B && typeof B.wavePhase === "function") ? num(B.wavePhase(), 0) : 0;
    } catch (e) {
      return 0;
    }
  }

  function locoApi() {
    const B = window.BeachGame;
    return (B && B.locomotion) ? B.locomotion : null;
  }

  function rigApi() {
    return window.BeachRig || null;
  }

  function beachScene() {
    return window.BeachScene || null;
  }

  /* duck boat cross-check — lazy, no hard dependency */
  function boatRiding() {
    const BB = window.BeachBoat;
    try {
      return !!(BB && typeof BB.riding === "function" && BB.riding());
    } catch (e) {
      return false;
    }
  }

  function playSound(name) {
    try {
      if (window.GameSounds && typeof window.GameSounds.play === "function") {
        window.GameSounds.play(name);
      }
    } catch (e) { /* audio must never break the ride */ }
  }

  function say(text) {
    const BS = beachScene();
    if (BS && typeof BS.say === "function") {
      try { BS.say(text); } catch (e) { /* DOM gone mid-ride */ }
    }
  }

  function locoAnchor() {
    const loco = locoApi();
    if (!loco || typeof loco.getAnchor !== "function") return null;
    const a = loco.getAnchor();
    return (a && isFinite(a.fx) && isFinite(a.fy)) ? a : null;
  }

  function pointFrac(L, p) {
    if (!usable(L) || !p) return null;
    const x = num(p.x, NaN), y = num(p.y, NaN);
    if (!isFinite(x) || !isFinite(y)) return null;
    return { x: x / L.w, y: y / L.h };
  }

  function ellipseRing(cx, cy, rx, ry, n) {
    const pts = [];
    const count = n || 14;
    for (let i = 0; i < count; i++) {
      const a = (TAU / count) * i;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return pts;
  }

  function fillPoly(g, color, alpha, pts) {
    g.fillStyle(color, alpha);
    g.fillPoints(pts, true);
  }

  /* deterministic jitter in [0,1) — foam-dot scatter without state */
  function hash01(a) {
    const x = Math.sin(a * 127.1) * 43758.5453;
    return x - Math.floor(x);
  }

  /* ---------- ride / band geometry from the layout ---------- */

  function rideMetrics(L) {
    const seaTop = num(L.seaTop, 0.42);
    const sandTop = num(L.sandTop, 0.72);
    const waveFy = st.wave ? num(st.wave.fy, (seaTop + sandTop) / 2) : (seaTop + sandTop) / 2;
    const bandTop = seaTop + 0.04;
    const bandBottom = sandTop - SURF.bandLowPad;
    return {
      seaTop: seaTop, sandTop: sandTop,
      bandTop: Math.min(bandTop, bandBottom),
      bandBottom: bandBottom,
      faceTop: Math.min(waveFy - SURF.bandUp, bandBottom),  // wave-face band
      shore: sandTop - SURF.shorePad,
      pointerMax: sandTop - SURF.pointPad                   // hold guard
    };
  }

  /* Clamped steer target for a raw pointer position, or null when the
     point is out of the steerable sea band — same event-time guard
     shape as the boat (never poll activePointer.isDown). */
  function steerTargetAt(L, p) {
    const f = pointFrac(L, p);
    if (!f) return null;
    const m = rideMetrics(L);
    if (f.y >= m.pointerMax) return null;
    return {
      fx: clamp(f.x, 0, 1),
      fy: clamp(f.y, m.bandTop, m.bandBottom)
    };
  }

  /* ---------- the 🏄 action button (register once per attach) ----------
     'sand' is the bar's only DOM mode now (mission 15 retired the
     legacy water/swim modes), so the button is present on land
     whenever she could surf. 'boat' mode is deliberately absent (the
     boat owns the bar while riding). The button NEVER greys out: out
     of range it just says "Wait for a wave… 🌊" (the gentle
     no-penalty line the old DOM bar used). */
  function registerActivity() {
    const BS = beachScene();
    if (!BS || typeof BS.registerActivity !== "function") return;
    BS.registerActivity({
      id: "surfcatch",
      emoji: "🏄",
      label: "Catch the wave!",
      modes: ["sand"],
      onClick: function () { catchWave(); }
    });
  }

  /* .is-ready glow hook lives in css/style.css; when the button is
     not in the current bar (or there is no DOM at all) this no-ops. */
  function syncReadyButton(ready) {
    if (typeof document === "undefined" || !document.querySelector) return;
    try {
      const BS = beachScene();
      const ae = BS && BS.actionsEl;
      if (!ae || typeof ae.querySelector !== "function") return;
      const btn = ae.querySelector('[data-activity-id="surfcatch"]');
      if (btn && btn.classList && typeof btn.classList.toggle === "function") {
        btn.classList.toggle("is-ready", !!ready);
      }
    } catch (e) { /* DOM chrome is optional — never break a ride */ }
  }

  /* ---------- wave counter chip ("🌊 N", top-right of the overlay).
     Reuses the styled .beach-surf-chip CSS (position, chunky border)
     and sets its own display, so it is fully self-contained — the
     legacy DOM-surf gate that class used to need is gone.
     Guarded for no-DOM. ---- */
  function chipParent() {
    const BS = beachScene();
    const ae = BS && BS.actionsEl;
    if (ae && ae.parentNode) return ae.parentNode;
    return (typeof document !== "undefined" && document.querySelector)
      ? document.querySelector(".beach-scene") : null;
  }

  function syncChip() {
    if (typeof document === "undefined" || !document.createElement) return;
    try {
      const show = !!(st && st.counter > 0);
      if (!show) {
        if (chipEl && chipEl.parentNode) chipEl.parentNode.removeChild(chipEl);
        chipEl = null;
        return;
      }
      if (!chipEl) {
        const parent = chipParent();
        if (!parent || typeof parent.appendChild !== "function") return;
        chipEl = document.createElement("span");
        chipEl.className = "beach-surf-chip";
        chipEl.style.display = "flex";          // self-contained visibility
        chipEl.setAttribute("role", "status");
        chipEl.setAttribute("aria-label", "Waves caught");
        parent.appendChild(chipEl);
      }
      const want = "\uD83C\uDF0A " + st.counter;   // 🌊 N
      if (chipEl.textContent !== want) chipEl.textContent = want;
    } catch (e) { /* chip is optional decoration */ }
  }

  function destroyChip() {
    try {
      if (chipEl && chipEl.parentNode) chipEl.parentNode.removeChild(chipEl);
    } catch (e) { /* ignore */ }
    chipEl = null;
  }

  /* ---------- state transitions ---------- */

  function gapSeconds() {
    return SURF.spawnMin + Math.random() * (SURF.spawnMax - SURF.spawnMin);
  }

  function toWait(delay) {
    st.mode = "wait";
    st.wave = null;
    st.spawnT = num(delay, gapSeconds());
    st.steerHeld = false; st.steerPointerId = null; st.steerFx = 0; st.steerFy = 0;
    st.lean = 0; st.vy = 0; st.splashAcc = 0;
  }

  /* The wave aims at HER band (kid-friendly: swim out and it comes
     to roughly where you are), clamped to comfortable mid-sea. */
  function spawnWave(L) {
    const m = rideMetrics(L);
    const a = locoAnchor();
    const mid = (m.seaTop + m.sandTop) / 2;
    let fy = a ? a.fy : mid;
    fy += (Math.random() - 0.5) * 0.08;
    fy = clamp(fy, m.seaTop + 0.08, m.sandTop - 0.12);
    st.wave = { fx: SURF.spawnFx, fy: fy, seed: Math.random() * TAU };
    st.mode = "wave";
  }

  function catchWave() {
    if (!st || !scene) return false;
    if (!canCatch()) {
      say("Wait for a wave… 🌊");
      return false;
    }
    const L = layoutNow();
    const m = rideMetrics(L);
    const a = locoAnchor();
    st.mode = "riding";
    st.boardFx = st.wave.fx;
    st.boardFy = clamp(a ? a.fy : st.wave.fy,
      Math.max(m.faceTop, m.bandTop), m.bandBottom);
    st.lean = 0; st.vy = 0; st.splashAcc = 0;
    st.steerHeld = false; st.steerPointerId = null;  // clean hands at catch time
    const loco = locoApi();
    if (loco) loco.setEnabled(false);        // surf owns her (she's mid-sea)
    const R = rigApi();
    if (R && typeof R.setStance === "function") {
      R.setStance("surf");
      R.setSpeed(0);
      R.setWaterline(null);                  // fully above water on the board
      R.setFlip(true);                       // travel is leftward (toward shore)
    }
    playSound("cheer");
    say("WOOHOO! 🌊");
    return true;
  }

  /* Every ride ends as a success: counter++, foam, gentle hand-back
     to locomotion (she's in the sea → driveRig lands float/wade on
     its next frame — the stance is NEVER forced from here). */
  function endRide() {
    if (!st || st.mode !== "riding") return;
    st.counter += 1;
    st.steerHeld = false; st.steerPointerId = null;
    syncRigFromBoard();                      // final sync → loco adopts it
    const loco = locoApi();
    if (loco) loco.setEnabled(true);
    const R = rigApi();
    if (R && typeof R.setSpeed === "function") R.setSpeed(0);
    dismountFoam();
    say(RIDE_TALKS[(st.counter - 1) % RIDE_TALKS.length]);
    playSound("pop");
    toWait(gapSeconds());
    syncChip();
  }

  /* Quiet abort for detach/reset paths: no counter, no talk. */
  function abortRide() {
    if (!st || st.mode !== "riding") return;
    syncRigFromBoard();
    const loco = locoApi();
    if (loco) { try { loco.setEnabled(true); } catch (e) {} }
    const R = rigApi();
    if (R && typeof R.setSpeed === "function") R.setSpeed(0);
    toWait(gapSeconds());
  }

  /* ---------- riding: carried by the wave + event-driven carve ------
     ONE main axis (cross-shore fy): boardFx simply FOLLOWS the crest
     (so she glides left at waveSpeed), the held pointer's fy sets the
     carve target inside the wave-face band, and the pointer's fx
     offset from the crest gives a small ±0.04 lean around it. */

  function rideStep(L, dt) {
    const m = rideMetrics(L);
    const w = st.wave;
    if (!w) { toWait(gapSeconds()); return; }

    const aspect = (L.w > 0 && isFinite(L.h)) ? L.w / L.h : 1;

    w.fx -= SURF.waveSpeed * dt;             // the wave keeps rolling

    let vy = 0;
    let leanTarget = 0;
    if (st.steerHeld && dt > 0) {
      /* defensive re-clamp: band may have moved under a resize */
      const ty = clamp(st.steerFy, m.bandTop, m.bandBottom);
      const dy = ty - st.boardFy;            // fy delta (the carve axis)
      const dyW = dy / aspect;               // CORRECTED width units — same
                                             //  metric the boat's steer uses
      if (Math.abs(dyW) > SURF.carveStop) {
        /* same shape as the boat: ease-out inside carveEase, speed FLOOR */
        const factor = clamp(
          SURF.carveFloor + (1 - SURF.carveFloor) * Math.min(1, Math.abs(dyW) / SURF.carveEase),
          SURF.carveFloor, 1);
        const before = st.boardFy;
        const step = (dy > 0 ? 1 : -1) * SURF.carveSpeed * factor * dt;  // fy applied
        /* snap-arrive, compared in the corrected metric so it agrees with
           the ease/stop units: if the step (in width units) covers the
           remaining gap, land exactly on ty instead of overshooting */
        st.boardFy = (Math.abs(step) / aspect) >= Math.abs(dyW) ? ty : before + step;
        vy = (st.boardFy - before) / dt;
      }
      leanTarget = clamp(st.steerFx - w.fx, -SURF.leanMax, SURF.leanMax);
    }
    st.vy = vy;
    st.lean += (leanTarget - st.lean) * Math.min(1, dt * SURF.leanEase);
    st.boardFx = w.fx + st.lean;

    /* garbage-proof the board (a NaN must never reach the rig) */
    if (!isFinite(st.boardFx) || !isFinite(st.boardFy) || !isFinite(st.lean)) {
      st.boardFx = w.fx;
      st.boardFy = clamp(st.wave.fy, m.bandTop, m.bandBottom);
      st.lean = 0; st.vy = 0;
    }
    st.boardFy = clamp(st.boardFy, Math.max(m.faceTop, m.bandTop), m.bandBottom);
    st.boardFx = clamp(st.boardFx, 0, 1);

    /* ride foam behind the board (right = up-wave side) */
    st.splashAcc += SURF.waveSpeed * dt;
    while (st.splashAcc >= SURF.splashEvery) {
      st.splashAcc -= SURF.splashEvery;
      pushFoam(st.boardFx * L.w + 0.5 * boardLenPx(L), st.boardFy * L.h + 6);
    }

    /* roll-off: reached the left edge with the crest, the wave died,
       or she carved all the way down to the shallows */
    if (st.boardFx <= SURF.fxMin + SURF.edgePad ||
        w.fx <= SURF.despawnFx ||
        st.boardFy >= m.shore) {
      endRide();
    }
  }

  function syncRigFromBoard() {
    const R = rigApi();
    if (!R || typeof R.isAttached !== "function" || !R.isAttached()) return;
    const L = layoutNow();
    if (!usable(L)) return;
    R.setAnchor(st.boardFx, st.boardFy);     // surf stance parks the soles on the anchor
    R.setSpeed(clamp(Math.hypot(SURF.waveSpeed, num(st.vy, 0)) / SURF.speedRef, 0, 1));
    R.setFlip(true);                         // always travel left with the crest
  }

  /* ---------- foam rings (ride puffs + dismount splash) ---------- */

  function pushFoam(x, y) {
    if (!isFinite(x) || !isFinite(y)) return;
    st.splash = st.splash || [];
    st.splash.push({ x: x, y: y, t0: st.clock });
    while (st.splash.length > SURF.splashCap) st.splash.shift();
  }

  function dismountFoam() {
    const L = layoutNow();
    if (!usable(L)) return;
    const x = st.boardFx * L.w, y = st.boardFy * L.h;
    for (let i = 0; i < 4; i++) {
      pushFoam(x + (i - 1.5) * 14, y + (i % 2) * 8);
    }
  }

  function trimFoam() {
    if (!st.splash) return;
    for (let i = st.splash.length - 1; i >= 0; i--) {
      const age = st.clock - st.splash[i].t0;
      if (!(age >= 0) || age >= SURF.splashLife) st.splash.splice(i, 1);
    }
  }

  function drawFoam(g, L, rm) {
    if (!st.splash || !st.splash.length) return;
    const bandH = (num(L.sandTop, 0.72) - num(L.seaTop, 0.42)) * L.h;
    const rRef = Math.max(10, bandH * 0.10);
    for (let i = 0; i < st.splash.length; i++) {
      const f = st.splash[i];
      const age = st.clock - f.t0;
      if (!(age >= 0) || age >= SURF.splashLife) continue;
      const u = age / SURF.splashLife;
      const alpha = (1 - u) * (1 - u) * 0.6;
      const rad = (rm ? 1.6 : 0.4 + 1.6 * u) * rRef;
      g.lineStyle(Math.max(1.2, 0.004 * L.h), COL.foam, alpha);
      g.strokePoints(ellipseRing(f.x, f.y, rad, rad * 0.36, 12), true);
    }
  }

  /* ---------- wave crest drawing (depth 6, re-traced per frame) ----
     Visually DISTINCT from the mission-3 water sheets: those are
     pale translucent ribbons ≤0.35 alpha; this is a chunky OPAQUE
     BREAKING wave sized off the RIG's character height, not the sea
     band — a steep tall back face on the right (sea side), the top
     curling forward-left (the travel/shore direction) into a HOOKED
     LIP, a dark-teal tube-shadow crescent tucked in the hollow
     under the curl, a pale band of aerated water on the front face,
     and white water CLUSTERED AT THE LIP TIP, spilling down the
     front flank toward shore — never an arc of foam across the
     face. While riding the whole crest anchors to the BOARD (peak
     ~0.35·S above the deck, base sinking 0.27·S under it) so she
     visibly rides at the lip however she carves; approaching, the
     SAME silhouette swims at w.fx/w.fy, 0.80× smaller.
     Purely cosmetic: reads state, writes nothing, touches no SURF
     constant and never mutates w.fx / w.fy. */

  function drawWaveCrest(g, L, rm) {
    const w = st.wave;
    if (!w || w.fx > 1.15 || w.fx < SURF.despawnFx - 0.05) return;
    const S = clamp(0.30 * L.h, 100, 210);   // character height (beach-rig.js)
    const ride = st.mode === "riding" &&
      isFinite(st.boardFx) && isFinite(st.boardFy);
    const sc = ride ? 1 : 0.80;              // approach: same shape, a bit smaller
    const ry = 0.62 * S * sc;                // trough→peak ≈ 60% of her height
    const rx = clamp(1.28 * ry, 40, L.w * 0.22);
    const wp = waveTime();                   // 0 under reduced motion
    const bob = rm ? 0 : Math.sin(wp * TAU * SURF.crestHz + w.seed) * SURF.bobPx;

    let x, baseY;
    if (ride) {
      const deckY = st.boardFy * L.h + 0.035 * S;  // drawBoard's deck line
      x = st.boardFx * L.w + 0.22 * rx;            // peak sits just RIGHT
      baseY = deckY + 0.27 * S + bob;              //  of + above her feet
    } else {
      x = w.fx * L.w;
      baseY = w.fy * L.h + ry * 0.27 + bob;
    }

    /* breaking body — hand-placed silhouette. Each vertex is
       { fx: fraction of rx left(−)/right(+) of x, fy: fraction of
       ry above the base line }: back foot (0.92,0) rises STEEPLY
       (three fast-climbing points) to a rounded peak near centre
       (−0.02,1); the crest thrown forward-left ends in a hooked
       lip tip (−1.06,0.52); two points curl back RIGHT and DOWN
       under it (the open tube mouth); a concave front face drops
       to the shore-side trough (−1.14,0), and fillPoints closes
       along the waterline. */
    const shape = [
      [0.92, 0.00],                            // back foot (sea side)
      [0.74, 0.40], [0.56, 0.70], [0.34, 0.92], // steep tall back face
      [-0.02, 1.00],                           // rounded peak
      [-0.36, 0.97], [-0.68, 0.86],            // lip thrown forward
      [-0.94, 0.68], [-1.06, 0.52],            // outer bulge → lip tip
      [-1.00, 0.40], [-0.84, 0.32],            // curl back under (tube)
      [-0.92, 0.16], [-1.04, 0.05],            // concave face…
      [-1.14, 0.00]                            // …into the trough
    ];
    const body = [];
    for (let i = 0; i < shape.length; i++) {
      body.push({ x: x + shape[i][0] * rx, y: baseY - shape[i][1] * ry });
    }
    fillPoly(g, COL.face, 1, body);
    /* ink underlay along the exposed silhouette (house style);
       open polyline so the waterline itself stays unstroked */
    g.lineStyle(Math.max(1.5, 0.005 * L.h), COL.ink, COL.inkA);
    g.strokePoints(body, false);
    /* tube shadow — dark-teal crescent tucked in the hollow under
       the lip curl, so the overhang reads as a real barrel. */
    const hollowShape = [
      [-0.97, 0.45], [-0.89, 0.38], [-0.83, 0.33],   // along the lip underside
      [-0.88, 0.27], [-0.94, 0.31], [-0.98, 0.38]    // back arc inside the body
    ];
    const hollow = [];
    for (let i = 0; i < hollowShape.length; i++) {
      hollow.push({ x: x + hollowShape[i][0] * rx, y: baseY - hollowShape[i][1] * ry });
    }
    fillPoly(g, COL.faceDeep, 0.95, hollow);
    /* pale inner wall — the band of aerated water from the tube
       mouth down to the waterline on the front (left) face, the
       slope the girl rides. Same fx/fy mapping as the body. */
    const paleShape = [
      [-0.80, 0.30], [-0.90, 0.16], [-1.02, 0.05], [-1.10, 0.00],
      [-0.34, 0.00], [-0.30, 0.14], [-0.52, 0.26]
    ];
    const pale = [];
    for (let i = 0; i < paleShape.length; i++) {
      pale.push({ x: x + paleShape[i][0] * rx, y: baseY - paleShape[i][1] * ry });
    }
    fillPoly(g, COL.pale, 0.95, pale);
    /* white water — CLUSTERS at the lip tip (three discs bulging
       past the tip and along the lip's outer edge), a small cap on
       the peak, then a spillway of three shrinking discs falling
       from the tip down the front flank to the shore-side
       waterline. Deliberately NOT an arc marching up the face.
       RM: fixed radii and alphas — one calm resting frame. */
    const foamShape = [
      [-0.02, 1.03, 0.100],                   // peak cap
      [-1.06, 0.52, 0.135],                   // lip tip (biggest)
      [-0.95, 0.63, 0.115],                   // lip underside toward peak
      [-0.82, 0.72, 0.095],
      [-1.16, 0.30, 0.105],                   // spilling down the front…
      [-1.26, 0.14, 0.085],
      [-1.36, 0.03, 0.065]                    // …to the shore-side waterline
    ];
    for (let i = 0; i < foamShape.length; i++) {
      const f = foamShape[i];
      const shim = (rm || i > 2) ? 1 : 1 + 0.18 * Math.sin(wp * 2.4 + w.seed + i * 1.7);
      const rr = rx * f[2] * (0.9 + 0.2 * hash01(w.seed + i)) * shim;
      g.fillStyle(COL.foam, rm ? 0.92 : 0.92 + 0.08 * hash01(w.seed + i + 9));
      g.fillCircle(x + rx * f[0], baseY - ry * f[1], Math.max(2, rr));
    }
    /* a couple of spray dots off the travelling (left) lip */
    if (!rm) {
      for (let i = 0; i < 2; i++) {
        g.fillStyle(COL.foam, 0.65);
        g.fillCircle(x - rx * (1.18 + 0.24 * i),
          baseY - ry * (0.58 - 0.20 * i) - bob * 1.5,
          Math.max(1.5, S * 0.022));
      }
    }
  }

  /* ---------- surfboard drawing (depth 14, under the rig 15) ------
     A rounded candy board: pink deck, three teal stripes, cream
     nose dot, ink underlay — oriented along ±x (travel is left) and
     tilted slightly by the carve velocity. Local shape mapped by
     hand (this vendored Graphics has no transform stack). */

  function boardLenPx(L) {
    const sRig = clamp(0.30 * L.h, 100, 210);
    return 1.02 * sRig;
  }

  function drawBoard(g, L, rm) {
    if (st.mode !== "riding") return;
    const sRig = clamp(0.30 * L.h, 100, 210);
    const len = 1.02 * sRig;
    const wid = 0.30 * sRig;
    const bx = st.boardFx * L.w;
    const by = st.boardFy * L.h + 0.035 * sRig;   // deck just under her soles
    const tilt = clamp(num(st.vy, 0) / SURF.carveSpeed, -1, 1) * SURF.tiltDeg * DEG;
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const map = function (px, py) {
      return { x: bx + px * c - py * s, y: by + px * s + py * c };
    };

    /* soft light shadow ON the water under the board */
    fillPoly(g, COL.foam, 0.16, ellipseRing(bx, by + wid * 0.62, len * 0.46, wid * 0.30, 12));

    /* board outline: two sampled quadratic arcs (nose at −x = travel) */
    const deck = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const px = -len / 2 + len * t;
      const hw = wid / 2 * Math.sqrt(Math.max(0.02, 1 - Math.pow(2 * t - 1, 2)));
      deck.push(map(px, -hw));
    }
    for (let i = 10; i >= 0; i--) {
      const t = i / 10;
      const px = -len / 2 + len * t;
      const hw = wid / 2 * Math.sqrt(Math.max(0.02, 1 - Math.pow(2 * t - 1, 2)));
      deck.push(map(px, hw));
    }
    const inkRing = deck.map(function (p) {
      return { x: bx + (p.x - bx) * 1.1, y: by + (p.y - by) * 1.12 };
    });
    fillPoly(g, COL.ink, COL.inkA, inkRing);
    fillPoly(g, COL.boardPink, 1, deck);

    /* three teal stripes across the deck (clipped by construction:
       each strip's half-height is the local board width × 0.62) */
    const strips = [-0.24, -0.02, 0.20];
    for (let i = 0; i < strips.length; i++) {
      const t = strips[i] + 0.5;                  // 0..1 along the board
      const px = -len / 2 + len * t;
      const hw = wid / 2 * Math.sqrt(Math.max(0.02, 1 - Math.pow(2 * t - 1, 2))) * 0.72;
      const sw = len * 0.045;
      fillPoly(g, COL.boardTeal, 0.95, [
        map(px - sw, -hw), map(px + sw, -hw), map(px + sw, hw), map(px - sw, hw)
      ]);
    }
    /* cream nose dot (the DOM board has one) */
    const nose = map(-len * 0.36, 0);
    g.fillStyle(COL.deck, 1);
    g.fillCircle(nose.x, nose.y, Math.max(1.5, wid * 0.10));

    /* little wash where the board planing the face — skip under RM */
    if (!rm) {
      const wp = waveTime();
      for (let i = 0; i < 2; i++) {
        const wob = 0.5 + 0.5 * Math.sin(wp * 5 + i * 2.1);
        const p = map(len * (0.44 + 0.1 * i), wid * 0.20);
        g.fillStyle(COL.foam, 0.35 + 0.3 * wob);
        g.fillCircle(p.x, p.y, Math.max(1.5, wid * (0.10 + 0.06 * wob)));
      }
    }
  }

  /* ---------- per-frame entry (between BeachBoat.frame and Rig.update) */

  function frame(timeMs, dtMs) {
    if (!scene || !st || !waveG || !boardG) return;
    const L = layoutNow();
    if (!usable(L)) return;                   // keep last draw on junk sizes
    /* real elapsed, capped — ride physics substep like locoFrame so a
       boot hitch or GC pause never eats wave travel or carve distance */
    const elapsed = clamp(num(dtMs, 0) / 1000, 0, SURF.frameCap);
    st.clock = num(timeMs, 0) / 1000;
    const rm = isReduced();

    if (st.mode === "wait") {
      st.spawnT -= elapsed;                   // linear — one exact step
      if (st.spawnT <= 0) spawnWave(L);
    } else if (st.mode === "wave") {
      st.wave.fx -= SURF.waveSpeed * elapsed;
      if (st.wave.fx <= SURF.despawnFx) {     // rolled past un-caught: no fuss
        toWait(gapSeconds());
      }
    } else if (st.mode === "riding") {
      let rem = elapsed;
      while (rem > 0 && st.mode === "riding") {
        const slice = rem > SURF.slice ? rem - SURF.slice : 0;
        const s = rem - slice;
        rem = slice;
        rideStep(L, s);                       // may itself endRide()
      }
      if (st.mode === "riding") syncRigFromBoard();
    }

    const ready = canCatch();
    if (ready !== st.lastReady) {             // DOM sync ONLY on change —
      st.lastReady = ready;                   // no per-frame querySelector
      syncReadyButton(ready);
    }

    trimFoam();
    waveG.clear();
    boardG.clear();
    drawWaveCrest(waveG, L, rm);
    drawBoard(boardG, L, rm);
    drawFoam(boardG, L, rm);
  }

  /* ---------- pointer input (carve steering while riding) ----------
     Same discrete-event shape as beach-boat.js: down/drag SET the
     held target, up/outside CLEAR it, rideStep reads it every frame.
     All handlers null-safe (detach may land between events) and they
     bail while the duck boat owns her (coexistence). */

  function onPointerDown(p) {
    if (!scene || !st) return;
    if (boatRiding()) return;                 // the boat has input priority
    if (st.mode !== "riding") return;         // waves catch only via the button
    if (st.steerHeld && p.id !== st.steerPointerId) return;  // first-down wins
    const L = layoutNow();
    if (!usable(L)) return;
    const t = steerTargetAt(L, p);
    if (t) {
      st.steerHeld = true;
      st.steerPointerId = p.id;
      st.steerFx = t.fx; st.steerFy = t.fy;
    }
  }

  function onPointerMove(p) {
    if (!scene || !st || st.mode !== "riding") return;
    if (!st.steerHeld) return;                // plain hover: no steering
    if (!p || p.id !== st.steerPointerId || !p.isDown) return;  // owning finger only
    const L = layoutNow();
    if (!usable(L)) return;
    const t = steerTargetAt(L, p);
    /* dragged out of the sea band: keep the last target and stay held
       (dragging toward shore is exactly how you end the ride) */
    if (t) { st.steerFx = t.fx; st.steerFy = t.fy; }
  }

  function onPointerUp(p) {
    if (!scene || !st) return;
    if (p && p.id === st.steerPointerId) {    // a stranger's finger release
      st.steerHeld = false;                   //  must not drop the hold
      st.steerPointerId = null;
    }                                         //  (lean eases back on its own)
  }

  /* ---------- canCatch / public predicates ---------- */

  function riding() { return !!(st && st.mode === "riding"); }

  function canCatch() {
    if (!st || st.mode !== "wave" || !st.wave) return false;
    if (boatRiding()) return false;                       // no double rides
    const a = locoAnchor();
    if (!a) return false;
    const L = layoutNow();
    if (!usable(L)) return false;
    const sandTop = num(L.sandTop, 0.72);
    if (a.fy >= sandTop - SURF.seaGuard) return false;    // must be IN the sea
    return Math.abs(a.fx - st.wave.fx) <= SURF.catchRadius;
  }

  function counter() { return st ? st.counter : 0; }

  /* ---------- lifecycle ---------- */

  function attach(sc) {
    if (!sc || !sc.add || typeof sc.add.graphics !== "function") return false;
    if (scene === sc && waveG && boardG) return true;     // idempotent
    if (scene) detach();                                   // fresh scene

    scene = sc;
    st = newState();
    waveG = sc.add.graphics().setDepth(6);
    boardG = sc.add.graphics().setDepth(14);
    if (sc.input && typeof sc.input.on === "function") {
      sc.input.on("pointerdown", onPointerDown);
      sc.input.on("pointermove", onPointerMove);
      sc.input.on("pointerup", onPointerUp);
      sc.input.on("pointerupoutside", onPointerUp);
    }
    if (sc.events && typeof sc.events.once === "function") {
      sc.events.once("shutdown", detach);
    }
    registerActivity();
    syncChip();
    return true;
  }

  function detach() {
    if (scene && scene.input && typeof scene.input.off === "function") {
      scene.input.off("pointerdown", onPointerDown);
      scene.input.off("pointermove", onPointerMove);
      scene.input.off("pointerup", onPointerUp);
      scene.input.off("pointerupoutside", onPointerUp);
    }
    if (st) abortRide();                 // hand locomotion back, quietly
    if (waveG && typeof waveG.destroy === "function") waveG.destroy();
    if (boardG && typeof boardG.destroy === "function") boardG.destroy();
    waveG = null;
    boardG = null;
    destroyChip();
    scene = null;
    st = null;
  }

  /* Back to a fresh 'wait' (and zero the session counter) without
     unhooking — used by tests / open-cycle resets; ride-end goes
     through endRide() instead. */
  function reset() {
    if (!st) return false;
    abortRide();
    st.counter = 0;
    st.lastReady = false;
    if (st.splash) st.splash.length = 0;
    st.spawnT = SURF.spawnFirst;
    syncChip();
    return true;
  }

  /* ---------- public surface ---------- */

  const api = {
    attach: attach,
    detach: detach,
    reset: reset,
    frame: frame,
    isAttached: function () { return !!scene && !!st; },
    riding: riding,
    canCatch: canCatch,
    catchWave: catchWave,
    counter: counter
  };
  window.BeachSurf = api;

  /* Headless seam for the mission 9 acceptance harness (browser
     inert, same pattern as beach-boat.js): lets a Node test read
     the live state machine without widening the shipped surface. */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      surf: api,
      SURF: SURF,
      getState: function () { return st; }
    };
  }
})();
