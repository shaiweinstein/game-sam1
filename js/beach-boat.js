/* ============================================================
   Lily's Dress-Up Adventure — Duck boat (mission 8)

     window.BeachBoat — a rideable yellow duck boat floating in
     the canvas sea, built the same lazy way as js/beach-rig.js:
     zero load-time dependencies (it only touches window.BeachGame
     / window.BeachRig / window.BeachScene / window.GameSounds at
     call time), a null-safe singleton, and full detached-safety —
     every public method no-ops before attach() / after detach().

     WorldScene.create() calls attach(scene) after the rig and the
     locomotion wiring, and WorldScene.update() calls
     frame(time, delta) AFTER locoFrame and BEFORE BeachRig.update,
     so a ride pushes the rig's anchor/stance/speed/facing the same
     frame it moves. Scene 'shutdown' detaches (beach-game.js
     close() repeats it as a belt).

     DRAWING SPLIT (Lily sits INSIDE the hull):
        backG   depth 13 — faint water reflection + stern/rear hull +
                belly + teardrop flank wing + tail flick + peeking
                orange feet + seat back + the fading white wake arcs
                (re-traced every frame, ~30 commands — well under the
                ocean pass budget);
        BeachRig root 15 / loco ripples 14 / submersion 16 sit between
        and above, and
        frontG  depth 16 — bow breast + neck + duck head (orange bill
                with a smile line, ink eye with shine dot, pink cheek)
                + the front gunwale band that
                covers her shins → the seated illusion.
     Both carry the SAME transform (position/bob-rotation/scaleX
     facing) set every frame; the hull art itself is in local px,
     sized from layout.h so the boat always reads proportional to
     Lily: S_rig = clamp(100, 0.30·h, 210), LEN = 1.5·S_rig·0.9,
     U = LEN/1.5 (the vertical unit — ≈ 0.9·S_rig).

     STATE MACHINE: 'rest' → tap the hull → 'invited' (locomotion
     setTarget drives her over programmatically — the pointerup
     PRESERVE in beach-game.js keeps that target alive after her
     finger lifts) → close enough in sea/foam → 'riding' (loco
     disabled, boat owns the anchor, hold+drag in the sea steers) →
     "Hop out & swim" button or paddling into the shallows → 'rest'
     (loco re-enabled, ADOPTING the boat's spot — she pops out
     swimming, never teleports). All gentle: no penalties, ever.
     'invited' quietly cancels after 20 s or on any new pointer
     press/drag away from the hull.

     Reduced motion (BeachGame.reducedMotion()): the bob/rotation
     are driven by BeachGame.wavePhase(), which is pinned to 0 →
     the boat FREEZES in one drawn resting frame; no wake is ever
     emitted. Steering still works (locomotion moves under RM too —
     it is control, not decoration).
    ============================================================ */

(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  /* ---- mission 8 tuning sheet (fractional stage units unless
     noted; "corrected" = screen-equivalent width units, dy/aspect,
     the same metric stepLocomotion uses) ---- */
  const BOAT = {
    restFx: 0.72, restFy: 0.60,   // spawn park spot, in the sea
    tapRadius: 0.12,              // corrected units around the anchor
    boardDist: 0.06,              // invited → board threshold
    inviteTimeout: 20,            // seconds before she "forgets"
    speed: 0.24,                  // width units/s while steered
    easeRange: 0.06,              // ease-out window near the target
    minFactor: 0.4,               // speed FLOOR while held — never crawls
    stopDist: 0.012,              // snap-arrive on the steering target
    drag: 2.5,                    // coast-down rate 1/s after release
    coastStop: 0.004,             // below this width/s she's stopped
    fxMin: 0.05, fxMax: 0.95,     // steering box: fx 0.05..0.95
    seaPad: 0.04,                 // box top  = seaTop  + 0.04
    sandPad: 0.04,                // box base = sandTop - 0.04
    pointerSeaPad: 0.03,          // hold counts only while fy < sandTop − 0.03
    shoreLine: 0.05,              // fy > sandTop − 0.05 → auto hop-out
    wakeEvery: 0.035,             // width units between wake arcs
    wakeCap: 12,
    wakeLife: 0.9,                // seconds per arc
    bobHz: 0.55, rotHz: 0.42,     // wave-synced bob/tilt rates (× wavePhase)
    bobPx: 3, rotDeg: 2,          // ± px heave, ± deg roll
    flipSpeed: 0.004,             // |vx| (fx/s) before she turns the bow
    seatFrac: 0.10,               // rig anchor = boat − 0.10·S px (waterlineOffset)
    /* Real-time substep policy — MUST stay in sync with locomotion
       (beach-game.js LOCO_SLICE / LOCO_FRAME_CAP): ride physics
       advance in ≤1/60s slices over up to 0.5s per frame, so long
       frames (scene boot, GC, slow tablets) never eat boat distance
       (the "too slow when the beach opens" fix applied to riding). */
    slice: 1 / 60,
    frameCap: 0.5
  };

  /* Art palette — the DOM duck boat's yellows + the house ink. */
  const COL = {
    ink: 0x3a2e6e, inkA: 0.12,
    hull: 0xffd94e, belly: 0xfff3c4, seat: 0xe8a93a,
    wing: 0xffe170, bill: 0xff9a3c, eye: 0x3a2e6e,
    cheek: 0xffb0c0, wake: 0xffffff,
    /* duck art pass: readable face + wing + feet + reflection */
    wingPatch: 0xf0c14b,  // darker flank wing (reads on 0xffd94e)
    feet: 0xff8a2e,       // orange web-feet bumps at the stern
    billEdge: 0xd9741f,   // smile line along the bill's lower edge
    eyeEdge: 0x241b4d,    // thin dark rim so the eye reads at scale
    shine: 0xffffff,      // eye sparkle
    reflect: 0xc9971f     // faint hull reflection on the water
  };

  /* ---------- module state (all nulled by detach) ---------- */
  let scene = null;
  let backG = null;    // depth 13 (stern + seat + wake)
  let frontG = null;   // depth 16 (bow + duck head + gunwale)
  let st = null;       // live state, see newState()

  function newState() {
    return {
      mode: "rest",            // 'rest' | 'invited' | 'riding'
      fx: BOAT.restFx, fy: BOAT.restFy,
      steerHeld: false,        // event-driven hold (pointerdown sets, up clears)
      steerPointerId: null,    // id of the finger that owns the hold (multi-touch)
      steerFx: 0, steerFy: 0,  // clamped steer target while held (fractions)
      vx: 0, vy: 0,            // velocity (fx/s, fy/s) — kept for coasting
      speedNow: 0,             // corrected width/s (drives wake + gait)
      flip: false,             // true = bow faces −x (left)
      wake: [],                // { x,y world px, t0 s, r0 px }
      wakeAcc: 0,
      inviteT: 0,              // seconds spent 'invited'
      prevMode: null,          // BeachScene mode to restore on hop-out
      sizeKey: -1,             // layout.h of the last frontG repaint
      clock: 0                 // last frame time in seconds (wake ages)
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

  /* Mission 9 coexistence: a canvas surf ride (js/beach-surf.js)
     must not be stolen from — pointer taps are carve-steering, and a
     pending 'invited' auto-swim must never hijack the rig mid-ride.
     Lazy window.* check: no hard dependency, no circular import. */
  function surfRiding() {
    const S = window.BeachSurf;
    try {
      return !!(S && typeof S.isAttached === "function" && S.isAttached() &&
                typeof S.riding === "function" && S.riding());
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

  /* Screen-equivalent (width-unit) distance, the loco metric. */
  function corrDist(ax, ay, bx, by, aspect) {
    const dx = ax - bx, dy = (ay - by) / aspect;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pointFrac(L, p) {
    if (!usable(L) || !p) return null;
    const x = num(p.x, NaN), y = num(p.y, NaN);
    if (!isFinite(x) || !isFinite(y)) return null;
    return { x: x / L.w, y: y / L.h };
  }

  /* ---------- hull geometry (local px, bow at +x, origin centred) --- */

  function boatDims(L) {
    const sRig = clamp(100, 0.30 * L.h, 210);   // beach-rig.js computeS()
    const len = 1.5 * sRig * 0.9;               // hull length ≈ 1.35·S_rig
    return { len: len, u: len / 1.5 };          // u = vertical unit ≈ 0.9·S_rig
  }

  function ellipseRing(cx, cy, rx, ry) {
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = (TAU / 14) * i;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return pts;
  }

  function fillEllipse(g, color, alpha, cx, cy, rx, ry) {
    g.fillStyle(color, alpha);
    g.fillPoints(ellipseRing(cx, cy, Math.max(0.5, rx), Math.max(0.5, ry)), true);
  }

  /* Ink underlay + fill, the rig's capsule trick for round blobs. */
  function softEllipse(g, color, cx, cy, rx, ry, pad) {
    fillEllipse(g, COL.ink, COL.inkA, cx, cy, rx + pad, ry + pad);
    fillEllipse(g, color, 1, cx, cy, rx, ry);
  }

  function fillPoly(g, color, alpha, pts) {
    g.fillStyle(color, alpha);
    g.fillPoints(pts, true);
  }

  function scalePoly(pts, k) {
    let cx = 0, cy = 0;
    for (let i = 0; i < pts.length; i++) { cx += pts[i].x; cy += pts[i].y; }
    cx /= pts.length; cy /= pts.length;
    return pts.map(function (p) {
      return { x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k };
    });
  }

  /* Teardrop ring (wing patch): sharp tip toward local −x (stern),
     round cap toward +x, tilted by `rot` so it follows the body
     slope. Isotropic px units — size both axes off U. */
  function teardropRing(cx, cy, reach, wid, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const pts = [];
    function put(px, py) {
      pts.push({ x: cx + px * c - py * s, y: cy + px * s + py * c });
    }
    put(-reach, 0);                                    // swept-back tip
    const th = Math.acos(clamp(-wid / reach, -1, 1));  // tangent contact
    for (let i = 0; i <= 12; i++) {
      const a = th - 2 * th * (i / 12);                // arc round the front
      put(wid * Math.cos(a), wid * Math.sin(a));
    }
    return pts;
  }

  /* Quadratic arc of n+1 points — the bill smile line. */
  function quadArc(x0, y0, cxq, cyq, x1, y1, n) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push({
        x: u * u * x0 + 2 * u * t * cxq + t * t * x1,
        y: u * u * y0 + 2 * u * t * cyq + t * t * y1
      });
    }
    return pts;
  }

  /* BACK layer: rear hull band + belly + painted flank wing + tail
     flick + the seat back she leans on. Re-traced per frame (wake
     shares the layer), all pure local math. */
  function paintHullBack(g, len, u) {
    const L = len, U = u;
    const pad = Math.max(1.5, 0.022 * U);
    /* faint reflection smear on the water, just under the hull —
       painted FIRST on backG, so it sits behind every hull shape and
       rides the boat's per-frame position/rotation/flip transform */
    fillEllipse(g, COL.reflect, 0.15, -0.05 * L, 0.40 * U, 0.54 * L, 0.06 * U);
    /* two orange feet peeking at the rear waterline — drawn before
       the hull ellipse so only the bumps below the hull edge show */
    softEllipse(g, COL.feet, -0.36 * L, 0.27 * U, 0.05 * L, 0.055 * U, pad * 0.5);
    softEllipse(g, COL.feet, -0.46 * L, 0.20 * U, 0.045 * L, 0.05 * U, pad * 0.5);
    /* tail flick up over the stern, ink underlay then fill */
    const tail = [
      { x: -0.38 * L, y: -0.08 * U },
      { x: -0.52 * L, y: -0.40 * U },
      { x: -0.44 * L, y: -0.05 * U },
      { x: -0.30 * L, y: 0.08 * U }
    ];
    fillPoly(g, COL.ink, COL.inkA, scalePoly(tail, 1.12));
    fillPoly(g, COL.hull, 1, tail);
    /* rear hull band + cream belly */
    softEllipse(g, COL.hull, -0.05 * L, 0, 0.50 * L, 0.30 * U, pad);
    fillEllipse(g, COL.belly, 1, -0.05 * L, 0.14 * U, 0.44 * L, 0.13 * U);
    /* teardrop wing patch on the flank — elongated, tip swept down
       toward the stern, round cap up front; tilted −12° with the body
       slope; sized to sit clear of the seat back above and the cream
       belly below so the darker yellow reads on the hull */
    const wing = teardropRing(-0.14 * L, -0.12 * U, 0.35 * U, 0.105 * U, -12 * DEG);
    fillPoly(g, COL.ink, COL.inkA, scalePoly(wing, 1.09));
    fillPoly(g, COL.wingPatch, 0.9, wing);
    /* seat back she sits on — stern side, behind her torso */
    const sw = 0.24 * L, sh = 0.13 * U, sx = -0.27 * L, sy = -0.36 * U;
    g.fillStyle(COL.ink, COL.inkA);
    g.fillRoundedRect(sx - pad, sy - pad, sw + 2 * pad, sh + 2 * pad, sh * 0.5);
    g.fillStyle(COL.seat, 1);
    g.fillRoundedRect(sx, sy, sw, sh, sh * 0.5);
  }

  /* FRONT layer: bow breast + neck + duck head + bill + eye + cheek
     + the front gunwale band that covers her legs. Repainted only
     when layout.h changes. */
  function paintHullFront(g, len, u) {
    const L = len, U = u;
    const pad = Math.max(1.5, 0.022 * U);
    /* bow breast curve (the rounded prow in front of her knees) */
    softEllipse(g, COL.hull, 0.16 * L, 0.01 * U, 0.34 * L, 0.29 * U, pad);
    fillEllipse(g, COL.belly, 1, 0.18 * L, 0.14 * U, 0.26 * L, 0.11 * U);
    /* neck rising from the bow */
    softEllipse(g, COL.hull, 0.30 * L, -0.40 * U, 0.075 * L, 0.30 * U, pad);
    /* head */
    softEllipse(g, COL.hull, 0.345 * L, -0.72 * U, 0.095 * L, 0.145 * U, pad);
    /* orange bill, base tucked under the head silhouette */
    const bill = [
      { x: 0.41 * L, y: -0.80 * U },
      { x: 0.56 * L, y: -0.74 * U },
      { x: 0.41 * L, y: -0.66 * U }
    ];
    fillPoly(g, COL.ink, COL.inkA, scalePoly(bill, 1.15));
    fillPoly(g, COL.bill, 1, bill);
    /* smile line — thin darker-orange arc inset along the bill's lower
       edge, sagging mid-way so the mouth corners curl up (a duck's
       mouth seam). Kept inside the triangle: the bill spans y −0.80→
       −0.66 (base) tapering to −0.74 at the tip. */
    g.lineStyle(Math.max(1, 0.011 * U), COL.billEdge, 0.85);
    g.strokePoints(quadArc(
      0.435 * L, -0.700 * U,
      0.495 * L, -0.704 * U,          // control pulls the middle toward the edge
      0.530 * L, -0.740 * U, 8), false);
    /* eye — rounder dot, thin dark rim so it reads at game scale */
    const er = Math.max(1.8, 0.034 * U);
    const ex = 0.365 * L, ey = -0.76 * U;
    g.fillStyle(COL.eyeEdge, 1);
    g.fillCircle(ex, ey, er + Math.max(0.8, 0.008 * U));
    g.fillStyle(COL.eye, 1);
    g.fillCircle(ex, ey, er);
    /* white shine dot, upper-left of the eye */
    g.fillStyle(COL.shine, 0.95);
    g.fillCircle(ex - er * 0.35, ey - er * 0.4, Math.max(0.7, er * 0.3));
    /* cheek dot */
    g.fillStyle(COL.cheek, 0.75);
    g.fillCircle(0.395 * L, -0.66 * U, Math.max(1.2, 0.045 * U));
    /* front gunwale band — paints OVER her shins (depth 16 > rig 15) */
    const gw = 0.42 * L, gh = 0.17 * U, gx = -0.05 * L, gy = -0.31 * U;
    g.fillStyle(COL.ink, COL.inkA);
    g.fillRoundedRect(gx - pad, gy - pad, gw + 2 * pad, gh + 2 * pad, gh * 0.5);
    g.fillStyle(COL.hull, 1);
    g.fillRoundedRect(gx, gy, gw, gh, gh * 0.5);
    g.fillStyle(COL.wing, 0.9);
    g.fillRoundedRect(gx + gw * 0.06, gy + gh * 0.18, gw * 0.88, gh * 0.3, gh * 0.15);
  }

  /* ---------- wave-locked bob (frozen-but-drawn under RM, because
     BeachGame.wavePhase() is pinned to 0 there) ---------- */
  function visualBob() {
    const B = window.BeachGame;
    let wp = 0;
    try {
      wp = (B && typeof B.wavePhase === "function") ? num(B.wavePhase(), 0) : 0;
    } catch (e) { wp = 0; }
    return {
      y: Math.sin(wp * TAU * BOAT.bobHz + 1.3) * BOAT.bobPx,
      rot: Math.sin(wp * TAU * BOAT.rotHz) * BOAT.rotDeg * DEG
    };
  }

  /* ---------- wake ripples (own array, cap, world px) ---------- */

  function pushWake(L, x, y, dims) {
    st.wake.push({
      x: x, y: y, t0: st.clock,
      r0: Math.max(2.5, 0.05 * dims.len)
    });
    while (st.wake.length > BOAT.wakeCap) st.wake.shift();
  }

  function emitWake(L, dt, dims) {
    if (isReduced()) return;                 // no emission under RM
    if (st.speedNow < BOAT.coastStop * 2) { st.wakeAcc = 0; return; }
    st.wakeAcc += st.speedNow * dt;
    while (st.wakeAcc >= BOAT.wakeEvery) {
      st.wakeAcc -= BOAT.wakeEvery;
      const dir = st.flip ? 1 : -1;          // stern trails the bow
      pushWake(L, st.fx * L.w + dir * 0.52 * dims.len,
                  st.fy * L.h + BOAT.bobPx, dims);
    }
  }

  function splashRipples(dims) {
    const L = layoutNow();
    if (!st || !usable(L)) return;
    for (let i = 0; i < 4; i++) {
      const a = (TAU / 4) * i + 0.6;
      pushWake(L, st.fx * L.w + Math.cos(a) * 0.34 * dims.len,
                  st.fy * L.h + Math.sin(a) * 0.30 * dims.u, dims);
    }
  }

  function trimWake() {
    for (let i = st.wake.length - 1; i >= 0; i--) {
      const age = st.clock - st.wake[i].t0;
      if (!(age >= 0) || age >= BOAT.wakeLife) st.wake.splice(i, 1);
    }
  }

  /* Wake arcs live in WORLD px; backG carries the boat transform,
     so each point is un-mapped (inverse rotate, un-mirror) before
     stroking. White arc, grows + fades; RM: static radius, alpha
     fade only. NOTE: this wake pool ages in SECONDS (st.clock);
     the locomotion ripple system (beach-game.js) ages in MS — keep
     units straight when touching either (they are deliberately
     separate systems: wake is drawn in the boat's LOCAL transform,
     ripples in world space). */
  function drawWake(g, L, t, rm, dims, bx, by, rot, sx) {
    for (let i = 0; i < st.wake.length; i++) {
      const wk = st.wake[i];
      const age = t - wk.t0;
      if (!(age >= 0) || age >= BOAT.wakeLife) continue;
      const u = age / BOAT.wakeLife;
      const alpha = (1 - u) * (1 - u) * 0.55;
      const rad = wk.r0 * (rm ? 1.5 : 1 + 1.6 * u);
      const dx = wk.x - bx, dy = wk.y - by;
      const c = Math.cos(rot), s = Math.sin(rot);
      const lx = (dx * c + dy * s) / sx;
      const ly = -dx * s + dy * c;
      const pts = [];
      for (let k2 = 0; k2 <= 7; k2++) {
        const a = Math.PI * (0.15 + 0.7 * (k2 / 7));   // lower half
        pts.push({ x: lx + rad * Math.cos(a), y: ly + rad * 0.35 * Math.sin(a) });
      }
      g.lineStyle(Math.max(1, 0.018 * dims.u), COL.wake, alpha);
      g.strokePoints(pts, false);
    }
  }

  /* ---------- state transitions ---------- */

  function startInvite() {
    const loco = locoApi();
    if (!loco || typeof loco.setTarget !== "function") return;
    /* programmatic drive — survives her finger lifting (targetSrc
       "program" in beach-game.js) and auto-arrives like a tap */
    if (!loco.setTarget(st.fx, st.fy)) return;   // closed/disabled/garbage
    st.mode = "invited";
    st.inviteT = 0;
    const BS = beachScene();
    st.prevMode = (BS && typeof BS.getMode === "function") ? BS.getMode() : null;
  }

  function board() {
    const loco = locoApi();
    const a = (loco && typeof loco.getAnchor === "function") ? loco.getAnchor() : null;
    if (a && isFinite(a.fx) && isFinite(a.fy)) {
      st.fx = a.fx; st.fy = a.fy;                // boat adopts HER anchor
    }
    st.vx = 0; st.vy = 0; st.speedNow = 0; st.wakeAcc = 0;
    st.steerHeld = false;                    // clean hands at board time
    st.steerPointerId = null;
    st.mode = "riding";
    if (loco) loco.setEnabled(false);            // hands the anchor over
    const R = rigApi();
    if (R && typeof R.setStance === "function") {
      R.setStance("ride");
      R.setSpeed(0);
      R.setWaterline(null);
    }
    const BS = beachScene();
    if (BS) {
      /* 'boat' mode makes the Hop-out button show (renderActions) */
      if (typeof BS.setMode === "function") { try { BS.setMode("boat"); } catch (e) {} }
      if (typeof BS.say === "function") {
        try { BS.say("Wheee! The duck boat! 🦆"); } catch (e) {}
      }
    }
    playSound("pop");
  }

  function disembark(reason) {
    if (!st || st.mode !== "riding") return;
    const dims = boatDimsSafe();
    st.mode = "rest";
    st.vx = 0; st.vy = 0; st.speedNow = 0;
    /* a shore auto-hop-out happens MID-drag — drop the held steer so
       the next ride starts clean (pointerup may never reach us after) */
    st.steerHeld = false;
    st.steerPointerId = null;
    /* park her exactly where the boat holds her (final sync), THEN
       hand back to locomotion — setEnabled(true) ADOPTS the rig
       anchor (no teleport); she's in the sea, so driveRig lands the
       float stance on its next frame */
    syncRigFromBoat();
    const loco = locoApi();
    if (loco) loco.setEnabled(true);
    if (dims) splashRipples(dims);
    const BS = beachScene();
    if (BS) {
      if (typeof BS.setMode === "function" &&
          typeof st.prevMode === "string" && st.prevMode) {
        try { BS.setMode(st.prevMode); } catch (e) {}   // bar back to castle etc.
      }
      if (typeof BS.say === "function") {
        try { BS.say("Splash! 🌊"); } catch (e) {}
      }
    }
    st.prevMode = null;
    void reason;                                 // 'button' | 'shore'
  }

  function boatDimsSafe() {
    const L = layoutNow();
    return usable(L) ? boatDims(L) : null;
  }

  /* ---------- riding: steering + per-frame rig sync ---------- */

  /* Steering-box metrics from the layout — the SAME formulas steer()
     and the old activePointer poll used, now shared with the pointer
     handlers so the event-time guard and the per-frame clamp can
     never drift apart. */
  function seaMetrics(L) {
    const seaTop = num(L.seaTop, 0.42);
    const sandTop = num(L.sandTop, 0.72);
    const fyMin = seaTop + BOAT.seaPad;
    const fyMax = Math.max(fyMin, sandTop - BOAT.sandPad);
    return {
      sandTop: sandTop, fyMin: fyMin, fyMax: fyMax,
      shore: sandTop - BOAT.shoreLine,
      pointerMax: sandTop - BOAT.pointerSeaPad   // hold guard (sea band only)
    };
  }

  /* Clamped steer target for a raw pointer position, or null when the
     point is outside the steerable sea band — the exact guard the old
     per-frame poll applied (f.y < sandTop − pointerSeaPad). */
  function steerTargetAt(L, p) {
    const f = pointFrac(L, p);
    if (!f) return null;
    const m = seaMetrics(L);
    if (f.y >= m.pointerMax) return null;
    return {
      fx: clamp(f.x, BOAT.fxMin, BOAT.fxMax),
      fy: clamp(f.y, m.fyMin, m.fyMax)
    };
  }

  function steer(L, aspect, dt, dims) {
    const m = seaMetrics(L);
    /* EVENT-DRIVEN (mirrors wireLocomotion in beach-game.js): the
       pointerdown/move listeners maintain st.steerHeld + steerFx/Fy;
       we never poll scene.input.activePointer — a poll could miss a
       hold or a drag between events. */
    const held = st.steerHeld && dt > 0;

    if (held) {
      /* targets are clamped at event time — defensively re-clamp */
      const tx = clamp(st.steerFx, BOAT.fxMin, BOAT.fxMax);
      const ty = clamp(st.steerFy, m.fyMin, m.fyMax);
      const dx = tx - st.fx, dyS = (ty - st.fy) / aspect;
      const d = Math.sqrt(dx * dx + dyS * dyS);
      if (d > BOAT.stopDist) {
        /* ease-out inside easeRange with a speed floor — same METRIC
           (corrected width units) and shape as stepLocomotion */
        const factor = clamp(
          BOAT.minFactor + (1 - BOAT.minFactor) * Math.min(1, d / BOAT.easeRange),
          BOAT.minFactor, 1);
        const v = BOAT.speed * factor;             // width units/s
        if (v * dt >= d) {
          /* snap-arrive (was missing → overshoot ping-pong on long
             frames): land exactly on the held target, never past it */
          st.fx = tx; st.fy = ty;
          st.vx = 0; st.vy = 0; st.speedNow = 0;
        } else {
          st.vx = (dx / d) * v;                      // fx/s
          st.vy = ((dyS / d) * v) * aspect;          // fy/s
          st.fx += st.vx * dt;
          st.fy += st.vy * dt;
          st.speedNow = v;
        }
      } else {
        st.vx = 0; st.vy = 0; st.speedNow = 0;
      }
    }
    if (!held) {
      /* release → gentle decel (drag 2.5/s) to a stop, coasting on */
      const decay = Math.exp(-BOAT.drag * dt);
      st.vx *= decay; st.vy *= decay;
      const v = Math.sqrt(st.vx * st.vx + (st.vy / aspect) * (st.vy / aspect));
      if (v < BOAT.coastStop) {
        st.vx = 0; st.vy = 0; st.speedNow = 0;
      } else {
        st.fx += st.vx * dt;
        st.fy += st.vy * dt;
        st.speedNow = v;
      }
    }

    /* clamp the box; garbage-proof the position */
    if (!isFinite(st.fx) || !isFinite(st.fy)) {
      st.fx = BOAT.restFx; st.fy = BOAT.restFy;
      st.vx = 0; st.vy = 0; st.speedNow = 0;
    }
    st.fx = clamp(st.fx, BOAT.fxMin, BOAT.fxMax);
    st.fy = clamp(st.fy, m.fyMin, m.fyMax);

    /* bow faces the travel direction; rig faces the bow with her */
    if (Math.abs(st.vx) > BOAT.flipSpeed) st.flip = st.vx < 0;

    void dims;

    /* paddled into the shallows → hop out swimming */
    if (st.fy > m.shore) {
      st.fy = m.shore;
      disembark("shore");
    }
  }

  function syncRigFromBoat() {
    const R = rigApi();
    if (!R || typeof R.isAttached !== "function" || !R.isAttached()) return;
    const L = layoutNow();
    if (!usable(L)) return;
    const offPx = num(R.waterlineOffset ? R.waterlineOffset() : null, 0) || 0;
    const bob = visualBob();
    const fy = clamp(st.fy + (bob.y - offPx) / L.h, 0, 1);
    R.setAnchor(st.fx, fy);
    R.setWaterline(null);
    R.setSpeed(clamp(st.speedNow / BOAT.speed, 0, 1));
    R.setFlip(!!st.flip);
  }

  /* ---------- pointer input (steering while riding + board invite) -----
     Same discrete-event shape as wireLocomotion() in beach-game.js:
     down/drag SET a held target, up/outside CLEARS it, and steer()
     reads the state every frame — no activePointer polling, so a
     hold/drag between Phaser events can never be missed. All handlers
     are null-safe (scene/st) because detach may land between events. */

  function onPointerDown(p) {
    if (!scene || !st) return;
    if (surfRiding()) return;                 // mission 9: the wave owns input
    if (st.mode === "riding") {
      /* hold in the sea band → start steering; never fall through to
         the board-invite logic below while riding. FIRST-DOWN WINS
         (same multi-touch contract as locomotion): a second finger
         can neither start nor steal the hold. */
      if (st.steerHeld && p.id !== st.steerPointerId) return;
      const L = layoutNow();
      if (usable(L)) {
        const t = steerTargetAt(L, p);
        if (t) {
          st.steerHeld = true;
          st.steerPointerId = p.id;
          st.steerFx = t.fx; st.steerFy = t.fy;
        }
      }
      return;
    }
    const L = layoutNow();
    if (!usable(L)) return;
    const f = pointFrac(L, p);
    if (!f) return;
    const d = corrDist(f.x, f.y, st.fx, st.fy, L.w / L.h);
    if (d <= BOAT.tapRadius) {
      if (st.mode === "rest") startInvite();
      else st.inviteT = 0;                 // re-tap the hull: fresh 20 s
    } else if (st.mode === "invited") {
      st.mode = "rest";                    // a new move elsewhere: quiet cancel
    }
  }

  function onPointerMove(p) {
    if (!scene || !st) return;
    if (st.mode === "riding") {
      if (!st.steerHeld) return;           // plain hover: no steering
      if (p.id !== st.steerPointerId || !p.isDown) return;  // not the owning finger
      const L = layoutNow();
      if (!usable(L)) return;
      const t = steerTargetAt(L, p);
      /* drag inside the sea band updates the target; dragged OUT of it
         we keep the last held target and stay held until pointerup —
         dragging toward shore then auto-hops-out via the shore check */
      if (t) { st.steerFx = t.fx; st.steerFy = t.fy; }
      return;
    }
    if (st.mode !== "invited" || !p || !p.isDown) return;
    const L = layoutNow();
    if (!usable(L)) return;
    const f = pointFrac(L, p);
    if (!f) return;
    if (corrDist(f.x, f.y, st.fx, st.fy, L.w / L.h) > BOAT.tapRadius) {
      st.mode = "rest";                    // dragged away → stay resting
    }
  }

  function onPointerUp(p) {
    if (!scene || !st) return;
    if (st.mode === "riding" && p && p.id === st.steerPointerId) {
      st.steerHeld = false;                // velocity decays via coast
      st.steerPointerId = null;
    }
    /* a non-owning finger's release must NOT drop the held steer */
    void p;
  }

  /* ---------- draw ---------- */

  function draw(L, t, rm, dims) {
    const bob = visualBob();
    const x = clamp(st.fx, 0, 1) * L.w;
    const y = clamp(st.fy, 0, 1) * L.h + bob.y;
    const sx = st.flip ? -1 : 1;
    if (st.sizeKey !== L.h) {
      st.sizeKey = L.h;
      frontG.clear();
      paintHullFront(frontG, dims.len, dims.u);
    }
    backG.clear();
    paintHullBack(backG, dims.len, dims.u);
    drawWake(backG, L, t, rm, dims, x, y, bob.rot, sx);
    backG.setPosition(x, y); frontG.setPosition(x, y);
    backG.setRotation(bob.rot); frontG.setRotation(bob.rot);
    backG.setScale(sx, 1); frontG.setScale(sx, 1);
  }

  /* ---------- per-frame entry (between locoFrame and Rig.update) --- */

  function frame(timeMs, dtMs) {
    if (!scene || !st || !backG || !frontG) return;
    const L = layoutNow();
    if (!usable(L)) return;                 // keep last draw on junk sizes
    /* real elapsed, capped like locomotion — see BOAT.slice/frameCap */
    const elapsed = clamp(num(dtMs, 0) / 1000, 0, BOAT.frameCap);
    const t = num(timeMs, 0) / 1000;
    st.clock = t;
    const rm = isReduced();
    const aspect = L.w / L.h;
    const dims = boatDims(L);

    if (st.mode === "invited") {
      if (surfRiding()) {
        st.mode = "rest";                     // mission 9: she's on a wave — quietly drop the invite
      } else {
        st.inviteT += elapsed;
        if (st.inviteT > BOAT.inviteTimeout) {
          st.mode = "rest";                   // she never came — no fuss
        } else {
          const loco = locoApi();
          const a = (loco && typeof loco.getAnchor === "function") ? loco.getAnchor() : null;
          if (a && isFinite(a.fx) && isFinite(a.fy) &&
              a.fy <= L.sandTop + 0.02 &&     // sea OR foam zone
              corrDist(a.fx, a.fy, st.fx, st.fy, aspect) < BOAT.boardDist) {
            board();
          }
        }
      }
    }

    if (st.mode === "riding") {
      /* substep the ride physics over real elapsed so long frames never
         eat distance (parity with locoFrame); draw/sync once afterwards */
      let rem = elapsed;
      while (rem > 0 && st.mode === "riding") {
        const slice = rem > BOAT.slice ? rem - BOAT.slice : 0;
        const s = rem - slice;
        rem = slice;
        steer(L, aspect, s, dims);            // may itself disembark('shore')
        if (st.mode === "riding") emitWake(L, s, dims);
      }
      if (st.mode === "riding") syncRigFromBoat();
    }

    trimWake();
    draw(L, t, rm, dims);
  }

  /* ---------- lifecycle ---------- */

  function attach(sc) {
    if (!sc || !sc.add || typeof sc.add.graphics !== "function") return false;
    if (scene === sc && backG && frontG) return true;   // idempotent
    if (scene) detach();                                 // fresh scene

    scene = sc;
    st = newState();
    backG = sc.add.graphics().setDepth(13);
    frontG = sc.add.graphics().setDepth(16);
    if (sc.input && typeof sc.input.on === "function") {
      sc.input.on("pointerdown", onPointerDown);
      sc.input.on("pointermove", onPointerMove);
      sc.input.on("pointerup", onPointerUp);
      sc.input.on("pointerupoutside", onPointerUp);
    }
    if (sc.events && typeof sc.events.once === "function") {
      sc.events.once("shutdown", detach);
    }
    return true;
  }

  function detach() {
    if (scene && scene.input && typeof scene.input.off === "function") {
      scene.input.off("pointerdown", onPointerDown);
      scene.input.off("pointermove", onPointerMove);
      scene.input.off("pointerup", onPointerUp);
      scene.input.off("pointerupoutside", onPointerUp);
    }
    if (backG && typeof backG.destroy === "function") backG.destroy();
    if (frontG && typeof frontG.destroy === "function") frontG.destroy();
    backG = null;
    frontG = null;
    scene = null;
    st = null;
  }

  /* Drop the boat back at its resting sea spot without unhooking
     (used by detach paths / tests; never touches locomotion or the
     rig — hop out through hop() instead). */
  function reset() {
    if (!st) return false;
    st.mode = "rest";
    st.fx = BOAT.restFx;
    st.fy = BOAT.restFy;
    st.vx = 0; st.vy = 0; st.speedNow = 0;
    st.steerHeld = false; st.steerPointerId = null; st.steerFx = 0; st.steerFy = 0;
    st.wake.length = 0; st.wakeAcc = 0;
    st.inviteT = 0;
    st.prevMode = null;
    return true;
  }

  /* ---------- public surface ---------- */

  function isAttached() { return !!scene && !!st; }
  function riding() { return !!(st && st.mode === "riding"); }
  /* the "Hop out & swim" action (beach.js, only while game-active) */
  function hop() {
    if (st && st.mode === "riding") disembark("button");
  }

  const api = {
    attach: attach,
    detach: detach,
    reset: reset,
    frame: frame,
    isAttached: isAttached,
    riding: riding,
    hop: hop
  };
  window.BeachBoat = api;

  /* Headless seam for the mission 8 acceptance harness (browser
     inert, same pattern as beach-game.js): lets a Node test read
     the live state machine without widening the shipped surface. */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      boat: api,
      BOAT: BOAT,
      getState: function () { return st; }
    };
  }
})();
