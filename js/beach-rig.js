/* ============================================================
   Lily's Dress-Up Adventure — Beach character rig (mission 4)

      window.BeachRig — a nested-Container vector kid drawn with
      Graphics, whose JOINTS ARE REAL PIVOTS (Containers) animated
      every frame. Ships with `stand`, `float` (mission 4) plus the
      mission 5-6 gait stances `walk`, `wade`, `swim`, all driven by
      ONE speed-scaled phase accumulator; pointer locomotion
      (mission 7) and suits (mission 14) build on the structure.

     RIG CONVENTIONS — missions 5-7 rely on these:
       • root is a Phaser.Container positioned AT THE HIP point of
         the character. World placement goes through the fractional
         anchor (setAnchor) — root.x/y is recomputed from it every
         frame (anchor px + stance root-offset), so never write
         root.x/.y directly.
        • S = character height in px = clamp(100, 0.30*layout.h, 210).
          All shapes are drawn in local units at BUILD time only —
          Graphics are NEVER re-traced per frame. Animation is pure
          container rotation/position. Two small exceptions, both
          ANIMATION JUICE and neither per-frame geometry churn:
          the blink overlay (gfx.blink, a couple of rounded rects,
          repainted ONLY while a blink is in flight) and the head
          layer retraced when a stance swap changes the mouth mood.
       • Limb chain: each segment is a Container PIVOTED AT ITS
         JOINT; its capsule Graphics extends along LOCAL +Y (down
         at angle 0). Joint angles are set in DEGREES with
         POSITIVE = SWING TOWARD THE FACING DIRECTION (+X when
         flip=false): angle a tips the limb's far end to world dir
         (sin a, cos a). setAngle() converts (rotation = -a).
         Segments nest: shoulder → upperArm + elbow(0,upperLen)
         → forearm + hand; hip → thigh + knee(0,thighLen) → shin
         → foot.
       • Facing: root.scaleX = ±1 (setFlip). Negative scaleX mirrors
         positions AND angles, so stance presets stay facing-correct.
        • Stances are pure functions of (t, dt, stance, reducedMotion):
          STANCES[name].apply(ctx) with ctx = {t, dt, k, S, speed,
          phase, cycleHz, cycleParity, joints, root, shadowG,
          setAngle(name,deg), setRootOffset(fx,fy)}.
          k = motion amplitude (0 under reduced motion — the same
          apply() then parks the rig in the static base pose, and
          the gait phase FREEZES at the stance's mid-pose, CYCLES
          table below). Gait stances (walk/wade/swim) drive every
          cycle term from ctx.phase — an angle f(TAU*phase), never
          sin(t) — so setSpeed() changes rate without a pose jump.
          Add a new stance with BeachRig.defineStance(name, {apply})
          — no refactor needed.
        • JUICE PASS: update() runs applyStance() then applyJuice()
          — a centralized per-frame polish pass that writes the head
          bone's Y bob, the hair-back lag bone (gfx.hairBack lives in
          joints.hair, low-passed opposite the head motion), and the
          blink overlay. It is stance-aware but lives OUTSIDE the
          stance functions, so no stance can leave a stale head/hair
          offset, and reduced motion (k = 0) parks every juice value
          at 0: no blink, no bob, no jitter.

       NESTING (paint order back→front):
        root (hip, depth 15 — above waterG(5), below DOM castle z4)
        ├─ shadowG            soft ellipse under the feet (stand only)
        └─ torso              rotation pivots AT THE HIP, so the
           ├─ hipB  (legBack)   thighB → kneeB → shinB + footB
           ├─ shoulderB        upperB → elbowB → foreB + handB
            ├─ torsoG           rounded torso + swimsuit (recolorable, mission 14)
            ├─ strapsG          suit shoulder straps (on the chest, under the hair)
            ├─ head (0, -0.46S + juice bob)
            │    ├─ hairB bone (0, hairLag)  hair-back mass (secondary bounce)
            │    ├─ headG                    face (eyes → blink lid sits on top)
            │    ├─ hairFG                   bangs
            │    └─ blinkG                   eyelid overlay (only repainted mid-blink)
           ├─ hipF  (legFront) thighF → kneeF → shinF + footF
           └─ shoulderF        upperF → elbowF → foreF + handF
         The hip/shoulder pivots are separated in x (hipB/F ±.055S,
         shoulderB/F ∓/+.060S) so the two legs / two arms read as
         distinct limbs (SVG dress-up girl: legs at x138/x162 with a
         visible gap, arms splayed from the shoulder tips).
         Deviations from the mission sheet: armBack paints just
         behind torsoG but in FRONT of legBack (it lives inside the
         torso container so it inherits breathing sway — the overlap
         zone never shows); hair-front lives INSIDE the head
         container so bangs follow head rotation (still the topmost
         part of the head). Both keep the spec's visible stack:
         back limbs < torso < head < front limbs.

      MISSION 6 — PRONE WINDMILL (the sign trap, resolved with the
      real chain at S=193): setAngle values are TORSO-RELATIVE and
      limb angles COMPOSE, so the world direction of the hand line
      is W = torsoAngle + shoulderAngle (+elbow for the forearm),
      with 0° = straight down, +90° = facing dir. The float stance
      hid this (both arms near-static); a crawl windmill must keep
      W sweeping a full 360° per cycle. Solution (see swim stance +
      windmillAngle/windmillBend):

        at(φ) = -78 + 4k·sin(2πφ)                    body roll
        W(φ)  = 75 → -20     smoothstep, φ∈[0,.5]    pull: entry
                               (forward-down, +75°) sweeping under
                               the chest to the hip (-20°)
        W(φ)  = -20 → -285   smoothstep, φ∈[.5,1]    recovery:
                               up OVER the head (through -180° at
                               φ≈0.78) to re-entry; -285 ≡ +75 so
                               the pose is C0 at the phase wrap,
                               and W is monotonic = ONE revolution
                               per cycle (a sinusoid would be a
                               pendulum — verified & rejected).
        shoulder = W - at                    (torso-relative!)
        elbow    = -5 - 65k·bend(φ)  bend = smoothstep up on
                   φ .50-.58, down on .66-.76: high-elbow exit,
                   arm STRAIGHT over the crown (a bent elbow at
                   the apex kept the tip under the hair — fixed).
        back arm: same map at (φ+0.5) mod 1 → 180° anti-phase.
      Sampled hand-tip / crown ROOT-FRAME coords (module, speed 1,
      S=192.9; y down, "over" = crown.y - tip.y > 0 → above head):

        φ     shF°  elF°   tipF(x,y)      tipB(x,y)    crownY  over
        0.000  153   -5   ( 0.561, 0.074)( 0.116,0.237) -0.274  -
        0.125  135   -5   ( 0.523, 0.138)(-0.025,-0.120) -0.297  -
        0.250  102   -5   ( 0.385, 0.254)( 0.106,-0.378) -0.306  -
        0.375   70   -5   ( 0.204, 0.286)( 0.537,-0.207) -0.297  -
        0.500   58   -5   ( 0.125, 0.276)( 0.552,0.035) -0.274  -
        0.625   19  -70   (-0.012,-0.057)( 0.519,0.124) -0.250  -
        0.750  -70   -7   ( 0.120,-0.305)( 0.383,0.249) -0.240 +0.065
        0.813 -119   -5   ( 0.383,-0.306)( 0.287,0.275) -0.243 +0.064
        0.875 -163   -5   ( 0.549,-0.143)( 0.200,0.271) -0.250  -
        1.000 -207   -5   ( 0.561, 0.074)( 0.116,0.237) -0.274  -
      Dense 2400-frame extremes: tip clears crown by 0.097S (18.8px,
      odd-parity breath cycles shift the crown), front x-travel
      0.593S, pull depth 0.074..0.287S under the hip at chest-front
      x — all acceptance gates measured through the real container
      tree, not re-derived by hand.

     The module is lazy: it touches window.BeachGame / window.GameState
     / window.CHARACTERS only at call time, never at load time, so
     its <script> order relative to beach-game.js is irrelevant
     (attach only happens from WorldScene.create).

     Public API (window.BeachRig):
       attach(scene)              idempotent; builds rig from
                                  GameState.getCharacter().id,
                                  default suit, stance 'stand',
                                  anchor fx 0.5 on the sand,
                                  depth 15; hooks scene 'shutdown'
       detach()                  destroy + null refs (safe twice)
       isAttached()              -> boolean
       onResize()                re-derive S from layout.h, repaint
                                  all Graphics, keep fractional anchor
       update(timeMs, dtMs)      called from scene.update every frame
        setStance(name)           'stand' | 'float' | defined names
        getStance()               -> current stance name
        setSpeed(v01)             mission 5: locomotion intensity
                                   0..1 (clamped, NaN keeps last);
                                   scales stance cycleHz, NEVER
                                   jumps the phase
        getSpeed()                -> current speed 0..1
        setFlip(bool)             facing: scaleX = b ? -1 : 1
        setCharacter(id)          repaint with window.CHARACTERS[id]
        setSuitColors({main,trim,bottom,twoPiece})   mission 14 hook
        setAnchor(fx, fy)         fractional stage anchor (0..1)
        getAnchor()               -> {fx, fy} or null
        joints                    getter -> rig.joints map or null
        root                      getter -> root Container or null
        waterlineOffset()         -> 0.10*S px or null. MISSION 7:
                                   while floating, put the anchor on
                                   the foam line so the hip sits
                                   ~0.10*S of a 1.0S-tall body below
                                   it (≈40% of the body under water).
        setWaterline(fyOrNull)    mission 6: fractional stage y of
                                   the local foam line (or null to
                                   clear) for submersion compositing
        getSubmergeInfo()         {cx, cy, S, waterY} px or null —
                                   null when not attached / no
                                   waterline / stance not
                                   float|swim|wade / waterline below
                                   sand reach. Detached-safe.
        paintSubmerge(g, info)    draw wash + surface ellipses +
                                   wake on a scene Graphics (the
                                   scene owns depth-16 compositing)
        defineStance(name, def)   register a stance for missions 5-7
   ============================================================ */

(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  /* ---------- module state (all nulled by detach) ---------- */
  let scene = null;      // WorldScene the rig is attached to
  let rig = null;        // { root, joints, gfx, shadowG, S, ... }
  let anchor = { fx: 0.5, fy: 0.82 }; // fractional anchor (feet / waterline)
  let charId = "lily";
  let stanceName = "stand";
  let flipped = false;
  let lastT = 0;       // seconds from the last update() frame (for stance swaps)

  /* ---- mission 5: phase/rate engine --------------------------
     All gait cycles are driven by ONE phase accumulator (0..1),
     never by raw sin(t): changing setSpeed() slides cycleHz but
     NEVER jumps the phase, so poses stay continuous.
       speed      0..1 locomotion intensity (setSpeed, NaN-safe)
       phase      cycle position 0..1, advanced dt*cycleHz/frame
       cycleCount increments on every phase wrap — stances use
                  its parity (e.g. swim breathing every other cycle)
       headSm     swim head-roll smoother state (deg, NaN = fresh)
       waterlineFy fractional stage y of the local waterline, set
                  by mission 7 via setWaterline (null = unset)     */
  let speed = 0;
  let phase = 0;
  let cycleCount = 0;
  let headSm = NaN;
  let waterlineFy = null;

  /* ---- animation JUICE state (blink / hair lag) -----------------
     Everything here is driven from update()'s clock only — re-applies
     (setStance/onResize/setCharacter, dt = 0) never touch it, so a
     blink can't be fast-forwarded by a stance swap. All reset by
     resetJuice() on attach/detach. */
  const BLINK_DUR = 0.28;   // total close+hold+open seconds (~120ms eased each way)
  let blinkNext = NaN;      // t (s) at which the next blink starts (NaN = unscheduled)
  let blinkAt = NaN;        // t (s) of the in-flight blink start (NaN = eyes open)
  let lidAmt = 0;           // eyelid closure 0 (open) .. 1 (shut)
  let paintedLid = -1;      // lid value currently traced on gfx.blink (-1 = force)
  let hairLag = 0;          // low-passed hair-back bone y offset (px, + = down)

  function resetJuice() {
    blinkNext = NaN;
    blinkAt = NaN;
    lidAmt = 0;
    paintedLid = -1;
    hairLag = 0;
  }

  /* Suit (mission 14 recolors via setSuitColors).
     main = one-piece / top, trim = top-edge stripe,
     bottom = 2-piece bottom color.
     Boot default MIRRORS catalog suit1 ("Sunny One-Piece", yellow) so
     there is NO wrong-colored flash between BeachRig.attach and the
     first syncSuitToRig() — previously a pink that matched no suit in
     the wardrobe, desyncing the canvas rig from the SVG character. */
  let suit = {
    main: 0xffd93d,
    trim: 0xff9a3d,
    bottom: 0xffd93d,
    twoPiece: false
  };
  const SUIT_DEFAULT = { main: "#ffd93d", trim: "#ff9a3d", bottom: "#ffd93d", twoPiece: false };

  /* Soft cartoon outline, same ink family as the DOM art
     (PAL.ink in beach-game.js / #3a2e6e ellipses in character.js).
     The alpha is kept LOW: this outline is drawn as a GROWN COPY of each
     shape (see the fill-shape trick below), so on the THIN limbs a strong
     alpha paints a thick indigo band that reads as a GREY wash over the
     warm skin. A light alpha keeps it a soft rim; the big face/torso are
     unaffected (their fill dominates). */
  const OUTLINE = 0x3a2e6e;
  const OUTLINE_ALPHA = 0.09;
  const SHADOW_ALPHA = 0.10;
  /* Back-limb depth shade: skin mixed 18% toward this WARM brown (not a
     grey-brown — the old 0x7a5c46 dulled the far limbs to a grey wash). */
  const SHADE_TARGET = 0x9c6b3f;

  /* ---------- tiny pure helpers (load-free, no DOM) ---------- */

  function num(v, fallback) {
    return (typeof v === "number" && isFinite(v)) ? v : fallback;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /* "#rrggbb" → 0xrrggbb (int passes through). */
  function hexInt(v, fallback) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") {
      const m = /^#?([0-9a-fA-F]{6})$/.exec(v.trim());
      if (m) return parseInt(m[1], 16);
    }
    return fallback;
  }

  /* Blend two 0xRRGGBB ints, t in [0,1] — same math as
     beach-game.js mixColor. */
  function mixColor(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g2 = Math.round(ag + (bg - ag) * t);
    const b2 = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g2 << 8) | b2;
  }

  function palette() {
    const chars = window.CHARACTERS;
    const c = (chars && chars[charId]) || (chars && chars.lily) || {};
    return {
      skin: hexInt(c.skin, 0xffdcc0),
      skinShade: hexInt(c.skinShade, 0xe8b48e),
      face: hexInt(c.face, 0x4a3226),
      hairMain: hexInt(c.hairMain, 0x8a5a3a),
      hairShade: hexInt(c.hairShade, 0x5e3a22),
      blush: num(c.blushOpacity, 0.8)
    };
  }

  function layoutNow() {
    const B = window.BeachGame;
    return (B && typeof B.layout === "function") ? B.layout() : null;
  }

  function motionAmplitude() {
    const B = window.BeachGame;
    try {
      return (B && typeof B.reducedMotion === "function" && B.reducedMotion()) ? 0 : 1;
    } catch (e) {
      return 1;
    }
  }

  /* {x,y} ring approximating an ellipse — beach-game.js keeps no
     fillEllipse convention in this vendored build, same trick. */
  function ellipsePts(cx, cy, rx, ry) {
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = (TAU / 14) * i;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return pts;
  }

  /* Polyline sample of a circular arc [a0,a1] (radians). */
  function arcPts(cx, cy, r, a0, a1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return out;
  }

  /* Elliptic arc/polyline sample [a0,a1] (radians, y-down screen
     angles: 0 = right, π/2 = bottom, 3π/2 = top). Head/hair shapes
     need true ellipses + open arcs, which ellipsePts/arcPts don't
     give; n+1 inclusive points, caller closes polygons. */
  function ellArcPts(cx, cy, rx, ry, a0, a1, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return out;
  }

  /* Closed n-point elliptic ring (no duplicated seam point — same
     convention as ellipsePts, but with a selectable resolution). */
  function ellRingPts(cx, cy, rx, ry, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (TAU / n) * i;
      out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return out;
  }

  /* Quadratic Bézier polyline p0→p1(ctrl)→p2, n+1 inclusive points —
     scalloped bangs edges are exactly the SVG's Q-segment chains
     (e.g. hair1/hair6 front fringe), resampled. */
  function quadPts(p0, p1, p2, n) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t;
      out.push({
        x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
      });
    }
    return out;
  }

  /* ---------- geometry (all fractions of S, spec-fixed) ---------- */

  function computeS() {
    const L = layoutNow();
    const h = L ? L.h : (scene && scene.scale ? scene.scale.height : 0);
    return clamp(0.30 * (num(h, 0) || 467), 100, 210);
  }

  /* Segment lengths / widths — mission 5-7 limbs read these off
     rig.geo so pivots and capsules never disagree.

     BODY REBUILD (SVG dress-up parity): the torso is no longer a
     capsule fused with the thighs — it is a rounded vase/trapezoid
     (paintTorso) ending in a hip row ABOVE the leg pivots, with TWO
     distinct legs separated in x (hipHx), matching the SVG's two
     stroke-legs at x138/x162. Proportions lifted from character.js
     BODY_MARKUP mapped onto this rig's fixed skeleton (head/hip
     anchors are an external contract — the SVG's own torso/leg
     ratios are stubbier than the rig's and were re-scaled to fit):
       • torso hip/tip half-width 0.113S → width 0.226S = 0.66× the
         0.34S head width (SVG: rect 68 wide vs head 116 = 0.59×);
       • waist pinches to 0.104S at y ≈ -0.150S (SVG rx26 narrows at
         y205 ≈ 48% of torso height — same relative waist);
       • shoulder tips ±0.113S at y -0.335S, arm-root flare ±0.148S
         (SVG arm sockets (122/178,172) with 15w caps), neckline
         corners ±0.052S — inside the ±0.105S hair-frame limit;
       • hips (leg pivots) at y -0.020S, ±0.055S in x; the gap
         between the 0.058S-wide leg capsules ≈ 0.05S always shows.
      Arms are 0.036S wide (was 0.056 — 35% thinner) and TAPER along
      their length (see armWidths/legWidths — shoulder → elbow → wrist
      and hip → knee → ankle); hands are small wrist-scaled discs, no
      longer the handR ball that made every joint read as a doll. */
  function computeGeo(S) {
    return {
      S: S,
      headY: -0.46 * S,       // head center above the hip (headR 0.155S → chin at -0.305S)
      headR: 0.155 * S,       // head VERTICAL radius (y) — chin/neck line, unchanged
      headRx: 0.17 * S,       // head HORIZONTAL radius (x) — SVG head 58×55 is a
                               //  touch wider than tall; face features are drawn
                               //  in fractions of headRx (see paintHead)
      shoulderY: -0.25 * S,   // arm pivot row — chin at -0.305S, capsule top
                               //  (-0.25 - armW/2 ≈ -0.268S) hangs CLEAR of it;
                               //  chain 0.29S (upper+fore+hand) puts the hand
                               //  right at the hip row in 'stand'
      shoulderFx: 0.060 * S,   // forward set (near-side arm hangs at the
                                //  torso front edge in side view); back arm -x.
                                //  Center 0.060 + capsule hw 0.018 stays under
                                //  the shoulder tip (torsoHW 0.113) so the arm
                                //  roots fuse into the flare with no seam.
                                //  Keep moderate: prone torso -78° rotates +x
                                //  into screen-y (±0.059S float-leg effect).
      shoulderBx: -0.060 * S,
      hipY: -0.020 * S,        // leg pivot row — inside the torso's hip block
                               //  (hem dips below it, so stance rotation can
                               //  never open a skin gap at the hip)
      hipHx: 0.055 * S,        // HALF SEPARATION of the two leg pivots
                               //  (hipF +x, hipB -x) — SVG legs at 150±12 =
                               //  ±0.044S widened a hair so the distinct-leg
                               //  gap survives the thicker capsule rims
      torsoHW: 0.113 * S,      // torso half-width at shoulder tips / hips
      neckHW: 0.052 * S,       // neckline corners (±0.052S < 0.105S hair limit)
      torsoTop: -0.350 * S,    // strap-tip line (neck corners sit at -0.340S)
      torsoBot: 0.010 * S,     // hem center dips onto the upper thigh (SVG
                               //  one-piece hem line); corners round at -0.002S
       limbW: 0.052 * S,        // LEGS — tapered thigh/shin half-widths scale
                                //  off this (see legWidths: hip 1.06 / knee
                                //  0.84 / ankle 0.70 — a gentle child taper)
       armW: 0.040 * S,         // ARMS — tapered upper/fore half-widths scale
                                //  off this (see armWidths: shoulder 1.10 /
                                //  elbow 0.88 / wrist 0.68 — a bit more
                                //  presence than the old 0.036S spindly arm,
                                //  still thinner than the 0.052S legs)
      upperLen: 0.15 * S,
      foreLen: 0.14 * S,
      thighLen: 0.16 * S,
      shinLen: 0.15 * S,
      handR: 0.027 * S,        // round hand disc ≈ 1.5× arm radius
      footRx: 0.040 * S,       // bare foot oval, 0.08S long…
      footRy: 0.020 * S,       // …0.04S tall, nudged toward the facing dir
      standHipH: 0.310 * S,    // hip height above the sand anchor
                               // (thigh .16 + shin .15 + footRy .020 − |hipY| .020;
                               //  hip pivots sit .020S ABOVE the torso origin)
       /* THIN outline band: this is grown behind every shape as the soft
          outline. A thick band (0.016S) covers most of a thin limb's width
          and reads as a GREY wash + grey rings where two caps meet at a
          joint. 0.009S keeps a soft rim but lets the warm skin core
          dominate the limbs. */
       outlinePad: Math.max(1.0, 0.009 * S),
      lineWidth: Math.max(1.2, 0.008 * S)
    };
  }

  /* ---------- shape painters (build-time only) ---------- */

  /* TAPERED capsule from local (0,0) to (0,len): PROXIMAL half-width
     `hwA` at the pivot end, DISTAL half-width `hwB` at the far end,
     soft dark outline behind (fill-shape outline trick — stroke-only
     capsules are fiddly on this build). Two end circles + a connecting
     trapezoid give a smooth cone with rounded caps: the limb narrows
     along its length instead of reading as a uniform stick. */
  function drawTaperedCapsule(g, len, hwA, hwB, fill, pad) {
    g.fillStyle(OUTLINE, OUTLINE_ALPHA);
    g.fillCircle(0, 0, hwA + pad);
    g.fillCircle(0, len, hwB + pad);
    g.fillPoints([
      { x: -(hwA + pad), y: 0 }, { x: (hwA + pad), y: 0 },
      { x: (hwB + pad), y: len }, { x: -(hwB + pad), y: len }
    ], true);
    g.fillStyle(fill, 1);
    g.fillCircle(0, 0, hwA);
    g.fillCircle(0, len, hwB);
    g.fillPoints([
      { x: -hwA, y: 0 }, { x: hwA, y: 0 },
      { x: hwB, y: len }, { x: -hwB, y: len }
    ], true);
  }

  /* Constant-width capsule — the old limb shell, now just the
     hwA === hwB case of the tapered one (kept for any caller that
     wants a straight tube). */
  function drawCapsule(g, len, hw, fill, pad) {
    drawTaperedCapsule(g, len, hw, hw, fill, pad);
  }

  /* Outlined disc (soft dark fill behind, like the capsules). */
  function drawDisc(g, x, y, r, fill, pad) {
    g.fillStyle(OUTLINE, OUTLINE_ALPHA);
    g.fillCircle(x, y, r + pad);
    g.fillStyle(fill, 1);
    g.fillCircle(x, y, r);
  }

  /* Fill-only joint BRIDGE disc (NO outline). At every shared pivot
     (shoulder/hip/elbow/knee) the parent's end cap and the child's
     start cap stack two alpha-0.12 OUTLINE discs into a ~0.24 dark
     ring — the Barbie ball-joint seam. Drawn LAST in the segment's
     own fill colour `c` (which already includes the back-limb shade,
     so it always matches its neighbourhood) on top of the pivot, it
     swallows the ring; the single-outline rim just outside the disc
     survives, keeping the soft house outline on the OUTER silhouette.
     Disk centred on the pivot ⇒ rotation-invariant: seamless at any
     joint angle. */
  function fillDisc(g, x, y, r, color) {
    g.fillStyle(color, 1);
    g.fillCircle(x, y, r);
  }

  /* MINIMAL joint SEAM COVER (the ball-killer). At every shared pivot the
     parent's distal cap and the child's proximal cap share ONE radius, so
     their fills already coincide (no seam) and their soft outline rings
     coincide into a single clean rim. The old full-circle BRIDGE disc was
     radius (joint + pad) SOLID — a bulging ball wider than the limb. This
     replaces it: a flat patch of the limb's OWN fill colour at EXACTLY the
     joint half-width (never + pad), centred on the pivot. It is the same
     size as the caps it sits on, so it never bulges past the silhouette or
     erases the soft outline ring — it only guarantees the two caps' fills
     are seamless (an anti-aliasing safety net). Reads as a smooth bend,
     not a knob. */
  function seamCover(g, x, y, r, color) {
    g.fillStyle(color, 1);
    g.fillCircle(x, y, r);
  }

  /* SOFT LIMB SHADING — one consistent light from the TOP-LEFT, so every
     limb carries a very soft, low-alpha shadow along its RIGHT/BOTTOM edge
     (local +X, which is the facing/right side of a downward limb). A thin
     flat band of the limb's own colour darkened toward a warm shadow tone —
     the house style is flat fills + a soft outline, so NO gradients/blur.
     `c` is already the (possibly back-limb-darkened) fill colour, so the
     FAR limb's shadow is the darkest, keeping it receding. The band hugs
     the outer ~45% of the right side and the distal cap's lower-right, so
     the limb reads as rounded, not flat, while staying subtle (kids' game). */
  function limbShadow(g, len, hwA, hwB, c, alpha) {
    const tone = mixColor(c, 0x7a5c46, 0.35);
    const inner = 0.55;                    // inner edge at 55% of the width
    g.fillStyle(tone, alpha);
    g.fillPoints([
      { x: hwA * inner, y: 0 },             // inner edge, proximal
      { x: hwA, y: 0 },                     // right edge, proximal
      { x: hwB, y: len },                   // right edge, distal (the taper)
      { x: hwB * 0.71, y: len + hwB * 0.71 }, // distal cap, lower-right arc (45°)
      { x: hwB * inner, y: len + hwB }      // inner edge, distal bottom
    ], true);
  }

  /* SUBTLE BEND CREASE — a thin, very low-alpha darker arc on the INSIDE
     (concave) of an elbow/knee bend to suggest a fold. Kept faint
     (alpha ≈0.15) so it reads as a hint, not a heavy line (kid-friendly).
     `side` +1 = the +X (facing) side — the elbow's usual inside;
     `side` -1 = the -X (back) side — the knee's usual inside. */
  function bendCrease(g, c, radius, side, lineWidth) {
    const mid = side > 0 ? 0 : Math.PI;    // 0 = +X, π = -X
    g.lineStyle(Math.max(1, lineWidth * 0.9), mixColor(c, 0x5e3a22, 0.45), 0.15);
    g.strokePoints(arcPts(0, 0, radius, mid - 0.62, mid + 0.62, 7), false);
  }

  /* Radial grow/shrink of a point ring: every point moves `pad` px away
     from (cx,cy) — grow > 0 makes the soft outline shell one pad thicker
     (capsule-house style), grow < 0 insets (fabric riding inside skin). */
  function ringGrow(pts, cx, cy, pad) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].x - cx, dy = pts[i].y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      out.push({ x: pts[i].x + dx * pad / d, y: pts[i].y + dy * pad / d });
    }
    return out;
  }

  /* Close a right-half chain (top axis point → bottom axis point, all
     x ≥ 0) into a symmetric ring by appending its x-negated reverse.
     Duplicated on-axis endpoints are harmless for fillPoints. */
  function mirrorAppend(right) {
    const out = right.slice();
    for (let i = right.length - 1; i >= 0; i--) {
      out.push({ x: -right[i].x, y: right[i].y });
    }
    return out;
  }

  /* LIMB TAPER CHAINS — single source of truth for the half-widths so
     ADJACENT segments meet FLUSH at every shared pivot (the parent's
     distal radius IS the child's proximal radius): the two end caps
     share one radius, so they form ONE continuous limb — not two balls
     meeting at a knob. The taper is GENTLE (a child's limbs are full,
     not spindly): a small deltoid/hip flare easing down to the
     wrist/ankle, so each joint reads as a smooth bend of the same
     width as the limb, never a wider ball. Arms narrow shoulder →
     elbow → wrist, legs hip → knee → ankle. */
  function armWidths(geo) {
    const a = geo.armW / 2;
    return {
      shoulder: a * 1.10,   // a full little deltoid where the arm meets the torso
      elbow: a * 0.88,      // shared by upper-arm distal ↔ forearm proximal (gentle)
      wrist: a * 0.68,      // forearm distal (the gentle taper's end)
      hand: a * 0.80        // mitten a touch WIDER than the wrist (0.68) — not a ball
    };
  }

  function legWidths(geo) {
    const l = geo.limbW / 2;
    return {
      hip: l * 1.06,        // full at the hip block
      knee: l * 0.84,       // shared by thigh distal ↔ shin proximal (gentle)
      ankle: l * 0.70       // shin distal, inside the foot (full, not spindly)
    };
  }

  /* Build a right-half Q-chain from (S, x0,y0, cx1,ey1,e1x,e1y, ...). */
  function halfChain(S) {
    const a = Array.prototype.slice.call(arguments, 1);
    const P = function (x, y) { return { x: x * S, y: y * S }; };
    let out = [P(a[0], a[1])];
    for (let i = 2; i + 3 < a.length; i += 4) {
      out = out.concat(quadPts(out[out.length - 1], P(a[i], a[i + 1]), P(a[i + 2], a[i + 3]), 6));
    }
    return out;
  }

  function paintFore(g, geo, color, shade) {
    const c = shade ? mixColor(color, SHADE_TARGET, 0.18) : color;
    const aw = armWidths(geo);
    const pad = geo.outlinePad;
    const a = geo.armW / 2;
    /* tapered forearm: starts at the SHARED elbow radius (flush with the
       upper arm's distal cap — ONE continuous limb, no knob) and narrows
       GENTLY to the wrist, so it reads as a defined little arm, not a
       spindly stick. */
    drawTaperedCapsule(g, geo.foreLen, aw.elbow, aw.wrist, c, pad);
    /* MINIMAL elbow seam cover — exactly the shared elbow radius (the old
       full (elbow + pad) SOLID disc was the ball-joint knob). */
    seamCover(g, 0, 0, aw.elbow, c);
    /* MITTEN HAND — a bit WIDER than the wrist, with a soft thumb nub on
       the facing (+x) side. A real little hand, not a ball: the palm
       flares out from the narrow wrist and rounds off at the fingers. */
    const hy = geo.foreLen;
    const hw = aw.hand, wh = aw.wrist;
    const hd = 0.95 * a;
    const tx = 0.80 * a, ty = hy + 0.50 * a, tr = 0.34 * a;
    const hand = [
      { x: -wh, y: hy },
      { x: -hw * 0.95, y: hy + 0.16 * a },
      { x: -hw, y: hy + 0.45 * a },
      { x: -hw * 0.86, y: hy + hd * 0.82 },
      { x: -hw * 0.45, y: hy + hd },
      { x: 0, y: hy + hd * 1.03 },
      { x: hw * 0.50, y: hy + hd * 0.96 },
      { x: hw * 0.80, y: hy + hd * 0.60 },
      { x: tx + tr * 0.35, y: ty - tr * 0.95 },   // thumb nub (facing side)
      { x: tx + tr, y: ty - tr * 0.35 },
      { x: tx + tr * 1.05, y: ty + tr * 0.35 },
      { x: tx + tr * 0.45, y: ty + tr * 0.95 },
      { x: hw * 0.62, y: ty + tr * 1.05 },
      { x: hw * 0.92, y: hy + 0.28 * a },
      { x: wh, y: hy }
    ];
    g.fillStyle(OUTLINE, OUTLINE_ALPHA);
    g.fillPoints(ringGrow(hand, 0, hy + hd * 0.5, pad), true);
    g.fillStyle(c, 1);
    g.fillPoints(hand, true);
  }

  function paintUpper(g, geo, color, shade) {
    const c = shade ? mixColor(color, SHADE_TARGET, 0.18) : color;
    const aw = armWidths(geo);
    const pad = geo.outlinePad;
    /* tapered upper arm: a full little deltoid (shoulderHw) at the pivot,
       narrowing GENTLY to the SHARED elbowHw at the far end (flush with
       the forearm's proximal cap — one continuous limb, no knob). */
    drawTaperedCapsule(g, geo.upperLen, aw.shoulder, aw.elbow, c, pad);
    /* shoulder seam: the pivot sits deep inside the torso (shoulderFx
       0.060S < torsoHW 0.113S), so a flat patch of exactly the cap
       radius (NOT + pad) keeps the interior seamless without printing a
       ball on the chest. The upper arm's distal cap gets the same patch
       so the elbow is seamless from BOTH sides (the forearm repeats it on
       its proximal end — two flush caps + these flat patches = a bend). */
    seamCover(g, 0, 0, aw.shoulder, c);
    seamCover(g, 0, geo.upperLen, aw.elbow, c);
  }

  function paintThigh(g, geo, color, shade) {
    const c = shade ? mixColor(color, SHADE_TARGET, 0.18) : color;
    const lw = legWidths(geo);
    const pad = geo.outlinePad;
    /* tapered thigh: full at the hip, narrowing GENTLY to the SHARED
       kneeHw at the far end (the shin starts at exactly this radius —
       one continuous leg, no ball). */
    drawTaperedCapsule(g, geo.thighLen, lw.hip, lw.knee, c, pad);
    /* hip + knee MINIMAL seam covers (flat, exactly the cap radius — the
       old (hip + pad) solid disc was the ball). */
    seamCover(g, 0, 0, lw.hip, c);
    seamCover(g, 0, geo.thighLen, lw.knee, c);
    /* Swimsuit leg tab: the suit's lower edge rides the UPPER THIGH and
       rotates WITH the leg, so the torso hem (painted behind the front
       leg, over the back one) can never open a skin gap at any stance
       angle. Two-piece uses suit.bottom (separate shorts); one-piece
       continues suit.main down from the torso. The width TRACKS the
       thigh's taper (so it hugs the leg, no gap at the hip) and the
       bottom edge is a soft scalloped FABRIC HEM with a 1px darker line. */
    const raw = suit.twoPiece ? suit.bottom : suit.main;
    const bandC = shade ? mixColor(raw, SHADE_TARGET, 0.18) : raw;
    const top = -0.014 * geo.S;             // tucks under the torso hem
    const tabH = 0.062 * geo.S;             // hem ≈ 39% down the thigh
    const bottom = top + tabH;
    const tFrac = tabH / geo.thighLen;      // how far down the thigh (0..1)
    const wTop = lw.hip * 0.98;             // fabric rides just inside the skin
    const wBottom = (lw.hip + (lw.knee - lw.hip) * tFrac) * 0.98;
    const dip = 0.0035 * geo.S;             // shallow hem scallop depth
    const hem = function (hw, yOff) {       // scalloped edge, right→left
      const out = [];
      const n = 6;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        out.push({ x: hw - 2 * hw * t, y: yOff + (i % 2 === 1 ? dip : 0) });
      }
      return out;
    };
    const tab = [
      { x: -wTop, y: top }, { x: wTop, y: top }, { x: wBottom, y: bottom }
    ].concat(hem(wBottom, bottom)).concat([{ x: -wTop, y: top }]);
    const tabShell = [
      { x: -wTop, y: top }, { x: wTop, y: top }, { x: wBottom + pad, y: bottom + pad }
    ].concat(hem(wBottom + pad, bottom + pad)).concat([{ x: -wTop, y: top }]);
    g.fillStyle(OUTLINE, OUTLINE_ALPHA);
    g.fillPoints(tabShell, true);
    g.fillStyle(bandC, 1);
    g.fillPoints(tab, true);
    /* 1px-darker hem line riding the scalloped bottom edge */
    g.lineStyle(Math.max(1, geo.lineWidth * 0.85), mixColor(bandC, 0x000000, 0.20), 0.5);
    g.strokePoints(hem(wBottom, bottom), false);
  }

  /* Shin capsule + BARE FOOT (feet are painted last inside the knee
     container, so they rotate with the shin). */
  function paintShin(g, geo, color, shade) {
    const c = shade ? mixColor(color, SHADE_TARGET, 0.18) : color;
    const lw = legWidths(geo);
    const pad = geo.outlinePad;
    /* tapered shin: starts at the SHARED knee radius (flush with the
       thigh's distal cap — one continuous leg, no ball) and narrows
       GENTLY to the ankle. */
    drawTaperedCapsule(g, geo.shinLen, lw.knee, lw.ankle, c, pad);
    /* knee MINIMAL seam cover (flat, exactly the shared knee radius —
       the old (knee + pad) solid disc was the ball). */
    seamCover(g, 0, 0, lw.knee, c);
    /* BARE FOOT — a real little foot, not a plain oval: a rounded TOE
       pointing the facing (+x) way, an arch, and a slightly RAISED heel
       (the sole under the heel sits a touch higher than under the ball).
       Centred on the ankle line (fy unchanged: segment lengths are
       fixed), the top edge matches the ankle cap width so it fuses in. */
    const ax = 0, ay = geo.shinLen;
    const fx = 0.018 * geo.S;                 // nudged toward the facing dir
    const frx = geo.footRx, fry = geo.footRy;
    const foot = [
      { x: -lw.ankle, y: ay },                          // ankle back (meets shin)
      { x: fx - frx, y: ay + fry * 0.55 },              // heel back edge
      { x: fx - frx * 0.82, y: ay + fry * 0.78 },       // heel sole (RAISED)
      { x: fx - frx * 0.25, y: ay + fry * 0.92 },       // arch
      { x: fx + frx * 0.35, y: ay + fry },              // ball (lowest point)
      { x: fx + frx * 0.82, y: ay + fry * 0.88 },       // toe front-bottom
      { x: fx + frx, y: ay + fry * 0.50 },              // toe tip (front)
      { x: fx + frx * 0.72, y: ay + fry * 0.22 },       // toe top
      { x: fx + frx * 0.15, y: ay + fry * 0.08 },       // instep (near ankle)
      { x: lw.ankle, y: ay }                            // ankle front (meets shin)
    ];
    g.fillStyle(OUTLINE, OUTLINE_ALPHA);
    g.fillPoints(ringGrow(foot, fx, ay + fry * 0.5, pad), true);
    g.fillStyle(c, 1);
    g.fillPoints(foot, true);
  }

  /* ---------- torso silhouette rings (build-time only) ---------- */

  /* SKIN ring — the child's BODY silhouette (vase with a real
     HOURGLASS), mapped from BODY_MARKUP's rect(116..184 × 164..250,
     rx26) + arm-socket caps, re-scaled to this rig's hip anchor:
     neckline corners (±0.052S, < the 0.105S hair-frame limit) dip
     through the scoop center, run over the shoulder TIPS (±0.113S =
     geo.torsoHW, 0.66× head width — the SVG's 68/116 torso:head
     ratio), flare to the arm-root line the SVG's round-capped strokes
     print (±0.148S), tuck at the armpit, carry a gentle BUST fullness
     (0.108S at y −0.210S), pinch to 0.098S at the WAIST (y −0.150S —
     narrower than before so the hourglass reads against the suit),
     ease out through a soft BELLY, and FLARE to 0.120S at the HIP
     (wider than the 0.113S shoulders → hips > shoulders = a child's
     body, not a column). The hem rounds to a corner and dips to
     +0.010S at center, still BELOW the hip pivots (−0.020S sit deep
     inside the hip block, so stance rotation can never open a gap). */
  function torsoSkinRing(geo) {
    return mirrorAppend(halfChain(geo.S,
      0.000, -0.320,   /* neckline dip center */
      0.030, -0.330, 0.052, -0.336,   /* rise to neck corner */
      0.080, -0.338, 0.104, -0.326,   /* shoulder tip (narrowed — was 0.113) */
      0.120, -0.332, 0.128, -0.308,   /* round onto the arm root (was 0.148) */
      0.114, -0.290, 0.106, -0.270,   /* armpit tuck (was 0.117) */
      0.110, -0.236, 0.108, -0.210,   /* gentle bust fullness */
      0.102, -0.186, 0.098, -0.150,   /* → waist pinch (0.098S) */
      0.098, -0.112, 0.120, -0.040,   /* belly → hip flare (0.120S) */
      0.118, -0.014, 0.102, -0.004,   /* rounded hem corner */
      0.050, 0.008, 0.000, 0.010));   /* hem center */
  }

  /* FABRIC HEM — the suit's lower edge WRAPS around the hip flare
     instead of a hard straight cut: a smooth quadratic from the hem
     corner (under the widest point of the hip) down to the center
     point (which dips LOWER, following the hip curve), resampled as N
     gentle scallop arcs — the soft edge of a real hem. The same points
     double as the 1px-darker hem-line stroke in paintTorso. */
  function fabricHem(geo, xCorner, yCorner, yCenter, n, dip) {
    const S = geo.S;
    const p0 = { x: xCorner * S, y: yCorner * S };
    /* the wrap control sags the edge around the hip (lower than the
       straight corner→center chord) */
    const pc = { x: xCorner * 0.52 * S, y: (yCorner + yCenter) * 0.5 * S + 0.004 * S };
    const p1 = { x: 0, y: yCenter * S };
    const onLine = function (t) {
      const u = 1 - t;
      return {
        x: u * u * p0.x + 2 * u * t * pc.x + t * t * p1.x,
        y: u * u * p0.y + 2 * u * t * pc.y + t * t * p1.y
      };
    };
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = onLine(i / n), b = onLine((i + 1) / n);
      /* one scallop: quad arc through a, b dipping `dip*S` below the
         segment midpoint (the control sits 2× the dip out) */
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 2 * dip * S };
      if (i > 0) pts.push(a);
      for (const q of quadPts(a, c, b, 4)) pts.push(q);
    }
    return pts;
  }

  /* The right half (x ≥ 0, top→bottom) of a mirrorAppend ring — the
     rings are built as right-half + x-negated reverse, so the first
     half of the array IS the right edge. */
  function rightHalf(ring) {
    return ring.slice(0, (ring.length / 2) | 0);
  }

  function mirrorX(pts) {
    const out = [];
    for (let i = 0; i < pts.length; i++) out.push({ x: -pts[i].x, y: pts[i].y });
    return out;
  }

  /* Soft SHADING BAND hugging an edge chain (top→bottom): the outer
     edge is the chain itself (the suit/skin silhouette edge), the
     inner edge is every point pulled `inset` px toward the x=0
     centerline — a closed polygon strictly INSIDE the silhouette, so
     nothing pokes past the soft outline. Pass the right half for the
     shadow side (light from the top-left) or mirrorX(right) for the
     lit side. */
  function edgeBand(pts, inset) {
    const inner = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      inner.push({ x: p.x - (p.x >= 0 ? inset : -inset), y: p.y });
    }
    return pts.concat(inner);
  }

  /* ONE-PIECE suit ring (suit1 "Sunny One-Piece"): the SCOOP is
     deepened to −0.262S so a short skin NECK band (~0.03S) shows
     between the chin (−0.305S) and the suit — she is not head-on-body.
     Sides ride ~1.02× the body ring (the SVG stroke overhangs the
     torso by 2 units) so no skin seam shows at the fabric edge, and
     the hem WRAPS the hip flare on a scalloped fabricHem (dipping onto
     the thigh tab band, still overlapping it at any stance). The
     crotch gap is left to the two thigh tabs — each tab is a separate
     rotating graphic, so the two-leg gap always shows. */
  function suitBodyRing(geo) {
    const S = geo.S;
    const upper = halfChain(S,
      0.000, -0.262,   /* scoop center — deepened for the visible neck */
      0.036, -0.290, 0.068, -0.312,   /* rise to strap seat (narrowed + lowered) */
      0.094, -0.328, 0.106, -0.308,   /* shoulder-tip corner (was 0.120) */
      0.112, -0.294, 0.109, -0.272,   /* pit side (was 0.121) */
      0.112, -0.236, 0.111, -0.212,   /* bust */
      0.105, -0.186, 0.102, -0.152,   /* waist (just outside the skin) */
      0.102, -0.112, 0.123, -0.040,   /* hip flare (just outside the skin) */
      0.121, -0.012, 0.105, -0.002);  /* rounded hem corner */
    return mirrorAppend(upper.concat(fabricHem(geo, 0.105, -0.002, 0.018, 5, 0.0035)));
  }

  /* TWO-PIECE vest top (suit2/4 tankinis + suit5 crop): same
     neckline/bust/waist as the one-piece (the deepened scoop too),
     hemmed across the high waist — that hem is tucked OVER the
     shorts' waistband, so it stays a smooth rounded edge (the wrap
     hem + hem line belong to the shorts at the hip). */
  function suitTopRing(geo) {
    const S = geo.S;
    return mirrorAppend(halfChain(S,
      0.000, -0.262,   /* scoop center (matches the one-piece) */
      0.036, -0.290, 0.068, -0.312,   /* narrowed + lowered (matches one-piece) */
      0.094, -0.328, 0.106, -0.308,
      0.112, -0.294, 0.109, -0.272,
      0.112, -0.236, 0.111, -0.212,
      0.105, -0.186, 0.102, -0.152,
      0.104, -0.140, 0.090, -0.136,   /* rounded side hem */
      0.045, -0.128, 0.000, -0.128)); /* hem center dip */
  }

  /* TWO-PIECE high-waisted shorts (the SVG wraps each thin leg): a
     straight waistband OVERLAPPING the vest hem (no belly gap) down
     through the SAME hip flare the one-piece uses, ending on the same
     wrapped scalloped fabricHem, continuing onto the thighs via the
     tab bands in paintThigh. */
  function suitBottomRing(geo) {
    const S = geo.S;
    const upper = halfChain(S,
      0.000, -0.168,   /* waistband center */
      0.060, -0.170, 0.104, -0.166,   /* straight to sides */
      0.111, -0.104, 0.123, -0.040,   /* hip flare (matches the one-piece) */
      0.121, -0.012, 0.105, -0.002);  /* rounded hem corner */
    return mirrorAppend(upper.concat(fabricHem(geo, 0.105, -0.002, 0.018, 5, 0.0035)));
  }

  /* FABRIC shading for one suit piece (its ring + base color): a soft
     darker band along the right/lower edge (the shadow side — the same
     top-left light the limb pass uses, so the suit rounds with the
     body) and a faint lighter sheen on the left/lit edge. Flat fills
     at low alpha, strictly inside the silhouette (edgeBand), and the
     tones are mixed FROM the suit color via mixColor, so any suit from
     setSuitColors gets the fabric look — nothing hardcoded to yellow. */
  function fabricShade(g, ring, c, insetShadow, insetLight) {
    const right = rightHalf(ring);
    g.fillStyle(mixColor(c, 0x000000, 0.30), 0.13);
    g.fillPoints(edgeBand(right, insetShadow), true);
    g.fillStyle(mixColor(c, 0xffffff, 0.50), 0.10);
    g.fillPoints(edgeBand(mirrorX(right), insetLight), true);
  }

  /* The 1px-darker HEM LINE riding the suit's scalloped lower edge —
     same stroke convention as the thigh-tab hem line. */
  function strokeHemLine(g, geo, xCorner, yCorner, yCenter, n, dip, c) {
    const hem = fabricHem(geo, xCorner, yCorner, yCenter, n, dip);
    g.lineStyle(Math.max(1, geo.lineWidth * 0.85), mixColor(c, 0x000000, 0.20), 0.5);
    g.strokePoints(hem, false);
    g.strokePoints(mirrorX(hem), false);
  }

  /* Torso skin + swimsuit, recolored by setSuitColors (mission 14).
     One-piece = full main over the silhouette + fabric shading +
     wrapped hem line + trim neckline crescent; two-piece = high-waist
     shorts (suit.bottom, drawn first, same shading + hem line) + vest
     top (suit.main) overlapping the waistband, same trim crescent.
     Body shading (skin) uses the SAME top-left light as the limbs: a
     soft shadow band on the right/lower edge, a faint sheen on the
     lit left edge, and a very soft chin shadow on the neck band. */
  function paintTorso(g, geo) {
    const S = geo.S;
    const p = palette();
    const skin = torsoSkinRing(geo);
    /* soft outline shell — same grow-by-pad trick as the capsules */
    g.fillStyle(OUTLINE, OUTLINE_ALPHA);
    g.fillPoints(ringGrow(skin, 0, -0.165 * S, geo.outlinePad), true);
    g.fillStyle(p.skin, 1);
    g.fillPoints(skin, true);
    /* soft SHADOW under the chin on the neck band — very low alpha,
       separates the head from the body without a hard line. (The earlier
       right-edge grey shadow band + left sheen on the skin are removed:
       on the thin neck/shoulders they read as a dull grey rim, so the
       visible skin is now clean warm skin, matching the face.) */
    const skinShadowTone = mixColor(p.skin, 0x7a5c46, 0.35);
    g.fillStyle(skinShadowTone, 0.10);
    g.fillPoints(ellipsePts(0, -0.299 * S, 0.046 * S, 0.013 * S), true);
    if (suit.twoPiece) {
      const shorts = suitBottomRing(geo);
      g.fillStyle(suit.bottom, 1);
      g.fillPoints(shorts, true);
      fabricShade(g, shorts, suit.bottom, 0.016 * S, 0.010 * S);
      strokeHemLine(g, geo, 0.105, -0.002, 0.018, 5, 0.0035, suit.bottom);
      const vest = suitTopRing(geo);
      g.fillStyle(suit.main, 1);
      g.fillPoints(vest, true);
      fabricShade(g, vest, suit.main, 0.013 * S, 0.008 * S);
    } else {
      const one = suitBodyRing(geo);
      g.fillStyle(suit.main, 1);
      g.fillPoints(one, true);
      fabricShade(g, one, suit.main, 0.016 * S, 0.010 * S);
      strokeHemLine(g, geo, 0.105, -0.002, 0.018, 5, 0.0035, suit.main);
    }
    /* neckline trim — trim half-disc riding the DEEPENED scoop, then a
       smaller suit.main half-disc over it leaves a crescent edging the
       neckline (reads as the SVG's suit stroke). The crescent follows
       the new scoop line and its top chord sits ~0.029S BELOW the
       chin line (-0.305S), so a real short band of neck skin shows
       between face and suit — she is not head-on-body. */
    g.fillStyle(suit.trim, 1);
    g.fillPoints(ellArcPts(0, -0.276 * S, 0.082 * S, 0.030 * S, 0, Math.PI, 12), true);
    g.fillStyle(suit.main, 1);
    g.fillPoints(ellArcPts(0, -0.283 * S, 0.073 * S, 0.023 * S, 0, Math.PI, 12), true);
  }

  /* Shoulder straps — a SEPARATE Graphics drawn IN FRONT of torsoG so
     the bands read over the chest skin, and behind the head so the
     bob's side panels frame them. Each strap runs from the sternum
     top out to the shoulder tip (SVG: suit tops start at 124..127/165
     beside the scoop and sit on the arm sockets), as a capsule bar. */
  function drawBar(g, x0, y0, x1, y1, hw, fill, pad) {
    const dx = x1 - x0, dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const shell = function (r, color, alpha) {
      g.fillStyle(color, alpha);
      g.fillCircle(x0, y0, r);
      g.fillCircle(x1, y1, r);
      g.fillPoints([
        { x: x0 + nx * r, y: y0 + ny * r },
        { x: x1 + nx * r, y: y1 + ny * r },
        { x: x1 - nx * r, y: y1 - ny * r },
        { x: x0 - nx * r, y: y0 - ny * r }
      ], true);
    };
    shell(hw + pad, OUTLINE, OUTLINE_ALPHA);
    shell(hw, fill, 1);
  }

  function paintStraps(g, geo) {
    const S = geo.S;
    const hw = 0.018 * S;
    for (let s = -1; s <= 1; s += 2) {
      /* from the sternum (over the chest skin) out to the SHOULDER
         TIP (now ±0.106S, -0.308S after the narrowing) — the cap at the
         tip fuses the strap into the suit's shoulder corner, suit.main */
      drawBar(g, s * 0.050 * S, -0.300 * S, s * 0.098 * S, -0.306 * S, hw, suit.main, geo.outlinePad);
    }
  }

  /* Eye geometry as fractions of f = headRx — the BASE sizes; the
     actual asymmetric 3/4 placements come from eyePositions below.
     paintHead draws eyes + shines + brows off that table and
     paintBlink slides a lid over EXACTLY the same boxes, so the two
     can never desync. */
  const EYE = { ex: 0.375, ey: 0.15, erx: 0.15, ery: 0.185 };

  /* 3/4-view eyes — SINGLE SOURCE OF TRUTH for paintHead AND
     paintBlink. The face is baked looking toward +X (the facing side);
     setFlip's root.scaleX = -1 mirrors the whole head Graphics, so the
     SAME art makes her look left when flipped — no facing input needed
     here. NEAR (facing) eye keeps the full EYE width; FAR eye is
     foreshortened to ≈0.75× and pulled inward; the whole feature
     cluster rides FACE_SHIFT (+0.13f) toward +X. Both eyes share
     EYE.ey; outer edges 0.42+0.15 = 0.57f and -0.16-0.113 = -0.273f
     stay well inside the skin ellipse (|x| + rx < 1.0f) at all y. */
  const FACE_SHIFT = 0.13;
  function eyePositions(f) {
    return [
      { x:  0.42 * f, y: EYE.ey * f, rx: 0.150 * f, ry: EYE.ery * f }, /* near */
      { x: -0.16 * f, y: EYE.ey * f, rx: 0.113 * f, ry: EYE.ery * f }  /* far  */
    ];
  }

  /* Mouth mood by stance (cheap character joy): 'hype' = excited open
     O for the adrenaline stances, the default 'smile' open-smile arc
     everywhere else (stand/walk/wade/float/ride). Baked into the head
     Graphics — setStance retraces ONLY the head layer on a mood flip. */
  function mouthMood(name) {
    return (name === "surf" || name === "swim") ? "hype" : "smile";
  }

  /* Head center sits at container origin: skin ellipse + the dress-up
     SVG's face, translated 1:1 from BODY_MARKUP (head rx58/ry55 in a
     300-unit space → features are fractions of the head's rx).
     Same character as the dress-up girl: a rounder-than-before head
     (rx 0.17S by ry 0.155S — slightly wider than tall, chin line and
      every body joint UNCHANGED), a 3/4-view pair of big oval eyes
      looking toward +X at +0.15r (near eye full-width on the facing
      side, far eye foreshortened ≈0.75× — see eyePositions; the whole
      feature cluster rides FACE_SHIFT toward +X, and setFlip's
      root.scaleX = −1 mirror turns the gaze left when flipped), each
      with the
      SVG's big upper-left + tiny lower-right white shines, thin arched
      brows, #ffc9dc blush ovals at the palette's
      blushOpacity (near cheek full, far cheek smaller and pulled
      in), and a small OPEN smile (dark half-disc + pink
      tongue hint, echoing the SVG's round-cap curve), biased +X. Every feature
     lands within |x| < 0.81r and y < 0.74r so nothing hits the chin
     or slides off at any stance; sizes stay well above sub-pixel at
     the ~40px phone head (r ≈ 20px → eyes ~6×7.4px, shines ~2px). */
  function paintHead(g, geo, mood) {
    const p = palette();
    const rx = geo.headRx;
    const ry = geo.headR;       // vertical — keeps the -0.305S chin line
    const pad = geo.outlinePad;
    /* f = face unit = head rx; every fraction below is of f. */
    const f = rx;
    /* skin ellipse, soft OUTLINE_ALPHA rim like the capsules/discs */
    g.fillStyle(OUTLINE, OUTLINE_ALPHA);
    g.fillPoints(ellRingPts(0, 0, rx + pad, ry + pad, 24), true);
    g.fillStyle(p.skin, 1);
    g.fillPoints(ellRingPts(0, 0, rx, ry, 24), true);
    /* eyes — 3/4 view looking toward +X via eyePositions (near eye
       full-width on the facing side, far eye foreshortened ≈0.75× and
       pulled inward). The blink overlay (paintBlink) reads the SAME
       descriptor list, so lids always track the eyes. */
    const eyes = eyePositions(f);
    const ey = EYE.ey * f;
    g.fillStyle(p.face, 1);
    for (const e of eyes) g.fillPoints(ellRingPts(e.x, e.y, e.rx, e.ry, 16), true);
    /* double shines — big dot upper-left, tiny dot lower-right of
       each eye (SVG r3.2/1.6 → 0.052f/0.026f), offsets and radii
       scaled by each eye's own width so both shine pairs stay
       strictly inside their (now unequal) eyes. */
    for (const e of eyes) {
      const s = e.rx / (EYE.erx * f);        // 1 near, ~0.75 far
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(e.x - 0.06 * f * s, e.y - 0.08 * f, 0.052 * f * s);
      g.fillStyle(0xffffff, 0.8);
      g.fillCircle(e.x + 0.05 * f * s, e.y + 0.07 * f, 0.026 * f * s);
    }
    /* brows — thin hairShade arches floating in the skin band between
       the fringe (lowest bang dip −0.17f) and the eye tops (−0.035f):
       ends at −0.07f, peak at −0.13f. One arch per eye at the eye's
       own x; the FAR brow is narrower (rx scaled like the eye) so the
       turn reads above the eyes too. */
    g.lineStyle(Math.max(1.2, geo.lineWidth * 0.9), p.hairShade, 0.7);
    for (const e of eyes) {
      const brx = 0.16 * f * (e.rx / (EYE.erx * f));
      g.strokePoints(ellArcPts(e.x, e.y - 0.155 * f, brx, 0.125 * f,
        (Math.PI + 0.55), TAU - 0.55, 8), false);
    }
    /* blush — asymmetric to sell the turn: NEAR cheek keeps the full
       SVG ellipse (11×7 → 0.185f/0.105f) at (+0.60f, +0.47f); the FAR
       cheek shrinks to ≈0.7× and slides toward the nose/center-up at
       (−0.34f, +0.45f), so it partly hides behind the face's near
       side. Both stay inside the skin ellipse. */
    g.fillStyle(0xffc9dc, 0.72 * p.blush);
    g.fillPoints(ellRingPts(0.60 * f, 0.47 * f, 0.185 * f, 0.105 * f, 14), true);
    g.fillPoints(ellRingPts(-0.34 * f, 0.45 * f, 0.130 * f, 0.074 * f, 14), true);
    /* mouth — two moods (see mouthMood):
       'smile' = the SVG's Q-curve mouth (±14 wide, 8 deep → ×0.15f
       down-shift) as a filled face-dark half-disc 0.20f × 0.16f with
       a tiny pink tongue — reads "happy" at 40px where a 1px stroked
       arc smears away (stand/walk/wade/float/ride keep this).
       'hype'  = excited OPEN O for surf/swim: a full face-dark oval
       0.25f × 0.33f with the pink tongue resting inside its bottom —
       every point stays within the |x|<0.81f / y<0.91f feature box. */
    if (mood === "hype") {
      /* open-O biased +0.11f toward the facing side; bottom stays
         well inside the hype y<0.91f box (0.60f+0.165f = 0.765f) */
      const mx = 0.11 * f;
      g.fillStyle(p.face, 1);
      g.fillPoints(ellRingPts(mx, 0.60 * f, 0.125 * f, 0.165 * f, 14), true);
      g.fillStyle(0xff8fb8, 1);
      g.fillPoints(ellRingPts(mx, 0.695 * f, 0.065 * f, 0.048 * f, 12), true);
    } else {
      /* smile half-disc — center at +0.11f, then a gentle rotation
         (slope ≈ 0.10) about that center: the FAR (−x) corner lifts a
         couple px and the NEAR corner dips a couple px, so the mouth
         line reads as turned toward +X. Deepest point (x = mx) is
         unmoved, keeping the 0.74f feature-box bottom exactly where
         it was. */
      const mx = 0.11 * f, my = 0.58 * f;
      const smile = ellArcPts(mx, my, 0.20 * f, 0.16 * f, 0, Math.PI, 10);
      for (const q of smile) q.y += 0.10 * (q.x - mx);
      g.fillStyle(p.face, 1);
      g.fillPoints(smile, true);
      g.fillStyle(0xff8fb8, 1);
      g.fillCircle(mx, 0.655 * f, 0.07 * f);
    }
  }

  /* Blink LID overlay — a separate Graphics inside the head bone,
     painted AFTER (on top of) eyes and bangs. Nothing here retraces
     the head art: `lid` ∈ [0,1] slides a rounded SKIN bar down over
     each eye box (top edge = eye top, so the brows above and the
     fringe stay untouched), a soft skinShade crease rides the bar's
     lower edge, and past 0.8 closure a short face-dark "lash line"
      pill fades in at the eye base so a shut blink reads as a drawn
      closed eye instead of blank skin. Geometry comes from the same
      eyePositions descriptors paintHead used, lid fractions are of f —
      all finite at any lid/size (radius clamped under half the bar
      height). */
  function paintBlink(g, geo, lid) {
    const amt = clamp(num(lid, 0), 0, 1);
    if (amt <= 0.01) return;                  // open — nothing traced
    const p = palette();
    const f = geo.headRx;
    /* iterate the SAME eyePositions descriptors paintHead drew the
       eyes from — near lid wide, far lid narrower, each centered on
       its own eye; lid-top = e.y - e.ry still clears the brows. */
    for (const e of eyePositions(f)) {
      const top = e.y - e.ry;                 // eye-box top (clears the brows)
      const h = 2 * e.ry * amt;               // lid grows DOWN over the eye
      const r = Math.min(e.rx, h) * 0.5;
      const creaseH = Math.min(h, e.ry * 0.30);
      g.fillStyle(p.skin, 1);
      g.fillRoundedRect(e.x - e.rx, top, 2 * e.rx, h, r);
      /* lid crease — darker skin band riding the closing edge */
      g.fillStyle(p.skinShade, 0.5);
      g.fillRoundedRect(e.x - e.rx * 0.92, top + h - creaseH,
        2 * e.rx * 0.92, creaseH, Math.min(r * 0.8, creaseH * 0.45));
      /* closed-eye lash line fades in over the last 20% of closure */
      if (amt > 0.8) {
        const lh = Math.max(1.3, e.ry * 0.16);
        g.fillStyle(p.face, 0.9 * ((amt - 0.8) / 0.2));
        g.fillRoundedRect(e.x - e.rx * 0.88, e.y + e.ry * 0.18,
          2 * e.rx * 0.88, lh, lh / 2);
      }
    }
  }

  /* Back hair (drawn under headG) — ONE helmet/bob polygon (right-half
     chain mirrored like torsoSkinRing, all fractions of f = headRx):
     a soft crown cap hugging just outside the skull (top ≈ 1.14f),
     cheek bulges to ±1.15f framing the face, bob TIPS at ≈ ±1.02f /
     +1.08f just past chin height on the SIDES, and a BOTTOM-INNER
     edge that curves back UP through (±0.46f, +0.62f) to (0, +0.55f)
     at the center. Only the TOP and the two SIDES poke outside the
     skin ellipse, so the hair reads as a bob framing the face — the
     old concentric mass ellipse + side panels dipped below the skin
     all the way around and printed a brown donut ring (hair hanging
     under the chin). The skin ellipse painted ON TOP hides every
     point inside the face silhouette. Drawn twice: a hairShade
     pad-larger outline shell (ringGrow, same trick as paintTorso —
     the SVG strokes hair with __HAIRSHADE__) under the hairMain
     fill, plus one low-alpha hairShade depth sliver at each bob TIP. */
  function paintHairBack(g, geo) {
    const p = palette();
    const f = geo.headRx;
    const pad = geo.outlinePad;
    const bob = mirrorAppend(halfChain(f,
      0.000, -1.140,   /* crown center — soft cap, NOT a donut */
      0.300, -1.130, 0.620, -1.040,   /* arc over the skull */
      1.020, -0.600, 1.150, 0.150,    /* temple → cheek bulge (widest) */
      1.160, 0.620, 1.020, 1.080,     /* side → bob tip beside the jaw */
      0.860, 0.980, 0.460, 0.620,     /* tip edge sweeps UP behind the jaw */
      0.240, 0.600, 0.000, 0.550));   /* high center hem — hidden under face */
    /* soft outline shell — pad-larger hairShade underlay */
    g.fillStyle(p.hairShade, 1);
    g.fillPoints(ringGrow(bob, 0, -0.05 * f, pad), true);
    g.fillStyle(p.hairMain, 1);
    g.fillPoints(bob, true);
    /* depth slivers low inside each bob tip — hair-END hints at the
       hem line, strictly inside the silhouette */
    g.fillStyle(p.hairShade, 0.30);
    for (let s = -1; s <= 1; s += 2) {
      g.fillPoints(ellRingPts(s * 0.90 * f, 0.84 * f, 0.13 * f, 0.06 * f, 14), true);
    }
  }

  /* Bangs cap over the FOREHEAD (topmost part of the head container)
     — the hair1 "front" of the dress-up SVG translated to canvas: a
     SOLID filled cap hugging the skull (outer 1.01f/0.97f so it sits
     just INSIDE the new hairBack helmet outline and the two merge
     into one hair mass instead of printing a second rim), side
     corners sweeping down to temple height (±0.96f, +0.27f), and a
     bottom edge of FOUR shallow scallop bumps across the brow line:
     fringe corners at y = −0.27f, Q-dips to −0.17f (hair6-style
     scallops), which stays clear of the brows (peak −0.13f) and
     eyes (tops −0.035f) so no strand touches a feature. The helmet
     sides in paintHairBack frame the cheeks — no separate side locks
     (they read as earmuffs) — and a faint lighter arc glosses the
     crown. Shade pass (pad-larger, edge nudged down) under the main
     pass = the house soft outline, same trick as the capsules. */
  function paintHairFront(g, geo) {
    const p = palette();
    const f = geo.headRx;
    const pad = geo.outlinePad;
    /* cap polygon: elliptic top arc 0.9π → 2.1π (left corner, over
       the crown, right corner) then the brow edge right → left. */
    function capPoly(rx, ry, cy, yBrow, yCtrl) {
      const arc = ellArcPts(0, cy, rx, ry, 0.90 * Math.PI, 2.10 * Math.PI, 20);
      const R = arc[arc.length - 1];
      const L = arc[0];
      const fx = 0.60 * f, mid = (yBrow + R.y) / 2;
      /* fringe part skew — the central dip and its two control points
         slide ≈0.08f toward −X (the FAR side of the turned face) so
         the bangs read as swept across a head looking +X. Only X
         moves: dip bottoms stay at yBrow/yCtrl, so brow/eye vertical
         clearance is bit-identical to the symmetric version. */
      const sk = -0.08 * f;
      const P = function (x, y) { return { x: x, y: y }; };
      const edge = []
        .concat(quadPts(R, P(0.92 * f, mid), P(fx, yBrow), 8))
        .concat(quadPts(P(fx, yBrow), P(0.45 * f, yCtrl), P(0.30 * f, yBrow), 6))
        .concat(quadPts(P(0.30 * f, yBrow), P(0.07 * f, yCtrl), P(sk, yBrow), 6))
        .concat(quadPts(P(sk, yBrow), P(-0.23 * f, yCtrl), P(-0.30 * f, yBrow), 6))
        .concat(quadPts(P(-0.30 * f, yBrow), P(-0.45 * f, yCtrl), P(-fx, yBrow), 6))
        .concat(quadPts(P(-fx, yBrow), P(-0.92 * f, mid), L, 8));
      return arc.concat(edge);
    }
    /* fringe: corners −0.27f, Q controls −0.07f → dip bottoms −0.17f */
    g.fillStyle(p.hairShade, 1);
    g.fillPoints(capPoly(1.01 * f + pad, 0.97 * f + pad, -0.03 * f,
      -0.27 * f + pad * 1.4, -0.07 * f + pad * 1.4), true);
    g.fillStyle(p.hairMain, 1);
    g.fillPoints(capPoly(1.01 * f, 0.97 * f, -0.03 * f,
      -0.27 * f, -0.07 * f), true);
    /* crown gloss — short lighter arc high on the cap */
    g.lineStyle(Math.max(1.4, 0.045 * f), mixColor(p.hairMain, 0xffffff, 0.28), 0.45);
    g.strokePoints(ellArcPts(0, -0.03 * f, 0.80 * f, 0.76 * f,
      1.28 * Math.PI, 1.72 * Math.PI, 10), false);
  }

  function paintShadow(g, geo) {
    g.fillStyle(OUTLINE, SHADOW_ALPHA);
    g.fillPoints(ellipsePts(0, 0, 0.24 * geo.S, 0.052 * geo.S), true);
  }

  /* ---------- build / repaint ---------- */

  function makeJoint(x, y) {
    const c = scene.add.container(x, y);
    c.setDepth(0);
    return c;
  }

  function buildRig() {
    const S = computeS();
    const geo = computeGeo(S);

    const r = {
      S: S,
      geo: geo,
      rootOff: { x: 0, y: -geo.standHipH },
      root: scene.add.container(0, 0)
    };
    r.root.setDepth(15);

    r.joints = {
      torso: makeJoint(0, 0),
      head: makeJoint(0, geo.headY),
      /* hair-bounce bone: hosts gfx.hairBack so the back-hair mass
         can lag the head (applyJuice low-passes its y offset) —
         secondary motion without re-tracing any art. */
      hair: makeJoint(0, 0),
      shoulderB: makeJoint(geo.shoulderBx, geo.shoulderY),
      elbowB: makeJoint(0, geo.upperLen),
      shoulderF: makeJoint(geo.shoulderFx, geo.shoulderY),
      elbowF: makeJoint(0, geo.upperLen),
      hipB: makeJoint(-geo.hipHx, geo.hipY),
      kneeB: makeJoint(0, geo.thighLen),
      hipF: makeJoint(geo.hipHx, geo.hipY),
      kneeF: makeJoint(0, geo.thighLen)
    };

    r.gfx = {
      shadow: scene.add.graphics(),
      upperB: scene.add.graphics(), foreB: scene.add.graphics(),
      thighB: scene.add.graphics(), shinB: scene.add.graphics(),
      upperF: scene.add.graphics(), foreF: scene.add.graphics(),
      thighF: scene.add.graphics(), shinF: scene.add.graphics(),
      torso: scene.add.graphics(), straps: scene.add.graphics(),
      hairBack: scene.add.graphics(), head: scene.add.graphics(), hairFront: scene.add.graphics(),
      blink: scene.add.graphics()   // eyelid overlay — repainted only mid-blink
    };

    /* nesting + paint order (back → front), see header diagram */
    r.joints.elbowB.add([r.gfx.foreB]);
    r.joints.shoulderB.add([r.gfx.upperB, r.joints.elbowB]);
    r.joints.kneeB.add([r.gfx.shinB]);
    r.joints.hipB.add([r.gfx.thighB, r.joints.kneeB]);
    r.joints.elbowF.add([r.gfx.foreF]);
    r.joints.shoulderF.add([r.gfx.upperF, r.joints.elbowF]);
    r.joints.kneeF.add([r.gfx.shinF]);
    r.joints.hipF.add([r.gfx.thighF, r.joints.kneeF]);
    r.joints.hair.add([r.gfx.hairBack]);
    r.joints.head.add([r.joints.hair, r.gfx.head, r.gfx.hairFront, r.gfx.blink]);
    r.joints.torso.add([
      r.joints.hipB, r.joints.shoulderB, r.gfx.torso, r.gfx.straps,
      r.joints.head, r.joints.hipF, r.joints.shoulderF
    ]);
    r.shadowG = r.gfx.shadow; // stance fades this (visible on land)
    /* hipB lives INSIDE torso (like shoulderB) so the back leg
       inherits the prone -78° in float/swim — as a root child it
       hung straight DOWN from the hip through the water. torso
       pivots at the hip (0,0), so hipB's local (0, hipY) is
       identical either way. Paint order: back leg behind everything
       else in the torso stack. */
    r.root.add([r.gfx.shadow, r.joints.torso]);

    rig = r;
    repaintAll();
    applyStance(0, 0); // park in the base pose before the first frame
    placeRoot();
    return r;
  }

  /* Repaint every Graphics at the current S/palette/suit.
     Called at build, on setCharacter, setSuitColors and onResize —
     never per frame. */
  function repaintAll() {
    if (!rig) return;
    const geo = rig.geo;
    const p = palette();
    const G = rig.gfx;

    /* ellipse is drawn at ITS local origin — park it just under the
       feet (root sits standHipH .310S above the anchor → soles at
       local .310S, shadow rides .012S lower like before) */
    G.shadow.setPosition(0, 0.322 * geo.S);
    G.shadow.clear(); paintShadow(G.shadow, geo);
    G.upperB.clear(); paintUpper(G.upperB, geo, p.skin, true);
    G.foreB.clear(); paintFore(G.foreB, geo, p.skin, true);
    G.thighB.clear(); paintThigh(G.thighB, geo, p.skin, true);
    G.shinB.clear(); paintShin(G.shinB, geo, p.skin, true);
    G.upperF.clear(); paintUpper(G.upperF, geo, p.skin, false);
    G.foreF.clear(); paintFore(G.foreF, geo, p.skin, false);
    G.thighF.clear(); paintThigh(G.thighF, geo, p.skin, false);
    G.shinF.clear(); paintShin(G.shinF, geo, p.skin, false);
    G.torso.clear(); paintTorso(G.torso, geo);
    G.straps.clear(); paintStraps(G.straps, geo);
    G.hairBack.clear(); paintHairBack(G.hairBack, geo);
    G.head.clear(); paintHead(G.head, geo, mouthMood(stanceName));
    G.hairFront.clear(); paintHairFront(G.hairFront, geo);
    /* keep the lid overlay consistent: a repaint wipes the head eyes,
       so retrace the CURRENT lid state (paintedLid=-1 → open → no-op
       clear is the common case) */
    G.blink.clear();
    paintBlink(G.blink, geo, lidAmt);
    paintedLid = lidAmt;
  }

  /* ---------- joint angle + placement helpers ---------- */

  function setAngle(name, deg) {
    const j = rig && rig.joints[name];
    if (!j) return;
    const a = num(deg, 0);
    /* positive angle swings the limb toward the facing dir (+X):
       Phaser rotation is CW on screen and the limb lies on +Y,
       so rotation = -angle. */
    j.rotation = -a * DEG;
  }

  function setRootOffset(fx, fy) {
    rig.rootOff.x = num(fx, 0) * rig.S;
    rig.rootOff.y = num(fy, 0) * rig.S;
  }

  function anchorPx() {
    const L = layoutNow();
    if (!L) return null;
    return L.px(clamp(anchor.fx, 0, 1), clamp(anchor.fy, 0, 1));
  }

  function placeRoot() {
    if (!rig) return;
    const pt = anchorPx();
    if (!pt) return;
    rig.root.setPosition(pt.x + rig.rootOff.x, pt.y + rig.rootOff.y);
  }

  /* ---------- stances ---------- */

  /* Per-stance cycle rate in Hz at speed v ∈ [0,1] (mission 5),
     and the PARK phase frozen under reduced motion (k = 0).
     stand keeps its original sin(t) idle math and never reads
     ctx.phase; float rocks/waves ON the phase (seesaw + hand-wave
     bell window) but its park phase 0 sits outside the window, so
     k = 0 still yields the static base pose. Their entries exist
     so the engine has a sane Hz for every stance and parity keeps
     ticking. */
  const CYCLES = {
    stand: { hz: function () { return 0.6; }, park: 0 },
    float: { hz: function () { return 0.6; }, park: 0 },
    walk: { hz: function (v) { return 1.6 + 1.2 * v; }, park: 0.15 },
    wade: { hz: function (v) { return 1.0 + 0.8 * v; }, park: 0.15 },
    swim: { hz: function (v) { return 0.7 + 0.5 * v; }, park: 0.25 }, // mid-stroke
    /* mission 8 ride: the phase IS the paddle stroke — 0.55 Hz at
       idle, ~2 Hz at full paddle; park 0 = neutral shoulder 40° pose */
    ride: { hz: function (v) { return 0.55 + 1.45 * v; }, park: 0 }
  };
  const CYCLE_DEFAULT = { hz: function () { return 0.6; }, park: 0 };

  function stanceHz(name, v) {
    const c = CYCLES[name] || CYCLE_DEFAULT;
    return c.hz(v);
  }

  function stancePark(name) {
    const c = CYCLES[name] || CYCLE_DEFAULT;
    return c.park;
  }

  /* Windmill helpers for the swim stance (mission 6). Derivation +
     numbers: the swim comment below and the header table. */

  function smoothstep(u) {
    const v = clamp(u, 0, 1);
    return v * v * (3 - 2 * v);
  }

  /* Blink envelope over p ∈ [0,1) of BLINK_DUR: eased shut over the
     first 43% (~120ms), a ~40ms hold fully closed, eased open over
     the last 43%. C0 everywhere: blinkShape(0)=blinkShape(1)=0. */
  function blinkShape(p) {
    if (p <= 0 || p >= 1) return 0;
    if (p < 0.43) return smoothstep(p / 0.43);
    if (p < 0.57) return 1;
    return smoothstep((1 - p) / 0.43);
  }

  /* Monotonic WORLD angle (deg, 0 = straight down, +90 = facing
     dir) of the hand line over one cycle: pull 75°→−20° across the
     first half, recovery −20°→−285° across the second. Winding the
     recovery down to −285° keeps the value strictly decreasing and
     −285 ≡ 75 (mod 360), so the pose is C0 at the phase wrap while
     the arm completes exactly one revolution per cycle. */
  function windmillAngle(u) {
    const w = u - Math.floor(u);
    return w < 0.5
      ? 75 + (-20 - 75) * smoothstep(w / 0.5)
      : -20 + (-285 - (-20)) * smoothstep((w - 0.5) / 0.5);
  }

  /* High-elbow window: ramps 0→1 over phase 0.50..0.58 (hand exits
     the water at the hip), holds, falls 1→0 over 0.66..0.76 — the
     arm is fully extended again as it passes over the crown, which
     is what lets the HAND TIP clear the hair (0.093S margin at
     S=193, phase 0.78). */
  function windmillBend(u) {
    return smoothstep((u - 0.5) / 0.08) * (1 - smoothstep((u - 0.66) / 0.10));
  }

  /* Each stance: apply(ctx) sets ALL joint angles + root offset +
     shadow alpha as a PURE function of ctx.t / ctx.k (motion
     amplitude, 0 when reduced motion → static base pose).
     ctx.setAngle(name, degrees), ctx.setRootOffset(fracS, fracS).
     Mission 5 adds: ctx.speed (0..1), ctx.phase (0..1 gait cycle
     position), ctx.cycleHz, ctx.cycleParity (cycleCount & 1) and
     ctx.dt (seconds since last frame, 0 on re-applies). Gait
     stances must derive every cycle term from ctx.phase — the
     angle formula has to be continuous mod 1 in phase. */
  const STANCES = {
    /* upright on sand, feet anchored; slow breathing sway.
       Juice pass adds the head-bone ±1.2%S breath lift on the SAME
       0.5 Hz clock (mirrors br), so torso tilt + head bob + arm sway
       all breathe together. */
    stand: {
      shadow: 1,
      apply: function (ctx) {
        const t = ctx.t, k = ctx.k;
        const br = Math.sin(t * Math.PI) * k;        // breath cycle ~0.5 Hz
        const ws = Math.sin(t * 1.1) * k;            // weight shift, slower
        ctx.setAngle("torso", br * 2);
        ctx.setAngle("head", -br * 2);               // counter-rotate
        /* arms splay ~18° so BOTH hands clear the torso edges (±0.113S
           hips) and read against the sky/water — pivots at ±0.060S put
           a straight-hanging arm INSIDE the silhouette, which hid the
           back arm entirely. Hand x = .060 + .29·sin18 = ±.150S ≈ the
           SVG's hand line (98/202 = ±.155S). The ±4k° sway rides the
           breath; elbows counter ±1.5° so the hands trail a beat. */
        ctx.setAngle("shoulderF", 18 + br * 4);
        ctx.setAngle("shoulderB", -18 + br * 4);
        ctx.setAngle("elbowF", 8 + br * 1.5);
        ctx.setAngle("elbowB", 8 - br * 1.5);
        ctx.setAngle("hipF", 1.5 + ws * 1.5);
        ctx.setAngle("hipB", -1.5 + ws * 1.5);
        ctx.setAngle("kneeF", 2 + ws * 1.0);
        ctx.setAngle("kneeB", -2 + ws * 1.0);
        /* hip→sole = thigh .16 + shin .15 + footRy .020 − |hipY| .020
           = .310S, so root parks .310S up to keep the soles exactly
           on the anchor (shadow at .322S reads under the feet). The
           two hips sit at x ±.055S — a clear two-leg gap. */
        ctx.setRootOffset(0, -0.310 - br * 0.006);    // breathe up/down a hair
      }
    },
    /* prone horizontal treading: body almost flat, face tipped up,
       arms pressed in front, tiny alternating leg flutter 1.2 Hz,
       a slow ±3° phase-locked SEE-SAW rock and, once per cycle, a
       one-hand WAVE out of the foam (see wave bell below).
       MISSION 7: set the anchor on the foam line — the hip then
       rides waterlineOffset()=0.10*S of the ~1.0S-tall body below
       it (≈40% of the body under water).
       Angle solution re-verified for the current skeleton (head
       center -0.46S, shoulder row -0.25S/±0.060S, hip row -0.020S/
       ±0.055S): head center sits at x=0 in the torso frame, so the
       net head rotation (−78+70 = −8°, face 8° above the body line)
       is EXACTLY the approved one — counter-rotating to +66 would tip
       the chin 4° further up and regress the silhouette. The root
       offset −0.035S parks the hip point on the approved silhouette;
       the body-art rebuild moved the hip row 0.035S up the torso axis
       (the soles follow ≈0.012S toward the head when prone — still
       under the water wash) and the ±0.055S hip separation turns into
       a natural front/back leg height split at −78° (tread angles
       unchanged). */
     float: {
      shadow: 0,
      apply: function (ctx) {
        const t = ctx.t, k = ctx.k;
        const u = ctx.phase;
        const th = TAU * u;
        const sway = Math.sin(t * 1.1) * k;
        const flut = Math.sin(t * TAU * 1.2) * k;  // leg flutter 1.2 Hz
        const press = Math.sin(t * 2.0) * k;       // arm tread press
        const bob = Math.sin(t * 1.4) * k;
        const seesaw = Math.sin(th) * k;           // cycle-locked body rock
        /* ONE-HAND WAVE — front arm lifts clear of the water in a
           cosine bell over phase .72…96 (2 elbow flaps inside), then
           slides back to treading. Bell ends at 0 with 0 slope →
           continuous at the wrap; PARK phase 0 sits outside the
           window so reduced motion keeps the exact static float. */
        const wave = (u >= 0.72 && u <= 0.96)
          ? (0.5 - 0.5 * Math.cos(TAU * (u - 0.72) / 0.24)) * k
          : 0;
        const flap = Math.sin(TAU * 2 * (u - 0.72) / 0.24) * wave;
        ctx.setAngle("torso", -78 + sway * 2.5 + seesaw * 3);
        ctx.setAngle("head", 70 - sway * 1.5 - seesaw * 2.5);  // face looks up (net -8° kept)
        ctx.setAngle("shoulderF", 118 + press * 7 - 55 * wave);  // lifts out to wave
        ctx.setAngle("elbowF", 34 + Math.cos(t * 2.0) * 9 * k + 40 * flap);
        ctx.setAngle("shoulderB", 112 - press * 7 + 6 * seesaw);
        ctx.setAngle("elbowB", 40 - Math.cos(t * 2.0) * 9 * k);
        ctx.setAngle("hipF", -8 + flut * 6);
        ctx.setAngle("kneeF", 14 - flut * 4);
        ctx.setAngle("hipB", -8 - flut * 6);       // alternating
        ctx.setAngle("kneeB", 16 + flut * 4);
        ctx.setRootOffset(0.005 * seesaw, -0.035 + bob * 0.012); // seesaw tips along too
      }
    },

         /* ---- mission 5: walking. ONE gait cycle per ctx.phase turn;
        every term is f(TAU*phase) so setSpeed() never snaps the
        pose. th = cycle angle, c = cos th, s = sin th.
        • hipF = +28·c / hipB = −28·c (opposite legs, facing-forward
          at phase 0). Hips also sit at x ±.055S, so the two legs
          visibly separate through the whole gait (SVG two-leg gap).
        • knee = −40·max(0, ∓c): only the leg swinging BACKWARD
          flexes (shin trails, − = away from facing), zero-crossing
          is smooth.
        • bob: rootOffset(0, −0.310 − 0.014·|s|) — rides UP at leg
          pass. Verified with the real chain for the old 0.012·|s|:
          the sole never drops below the sand anchor (penetration
          0 ≤ 0.02S) because the straight-leg drop 0.310S ≈ the base
          height, and the foot x travel = 0.335S ≥ 0.3S (see harness
          report); deepening the bob only raises the soles higher at
          pass and leaves the c=±1 extremes (full swing, soles at the
          base height) untouched, so the gate still holds.
        • arms counter-swing the legs HARDER: shoulderF = −30·c,
          shoulderB = +30·c, elbows flex 25°→38° on each arm's
          FORWARD swing (opposite-phase max(0,±c)) so the arms lead
          the step instead of hanging. Juice adds the ±1%S head-bone
          bounce and the low-passed counter-step hair lag.
        • head: torso counter-roll −2.5·s; the head adds a −3.5·c
          tilt OPPOSITE the leg drive (|2·s − 3.5·c| ≤ ~4°) — the
          whole head bone rocks against the step, which carries the
          bangs cap and (via the lagging hair bone) fakes the SVG
          hair-bounce. Root x sways ±0.004S at sin(2θ) — the hip
          push, continuous mod ½-cycle. */
    walk: {
      shadow: 1,
      apply: function (ctx) {
        const k = ctx.k;
        const th = TAU * ctx.phase;
        const s = Math.sin(th) * k, c = Math.cos(th) * k;
        ctx.setAngle("torso", -2.5 * s);             // pelvis roll (hip sway)
        ctx.setAngle("head", 2 * s - 3.5 * c);       // counter-roll + hair-bounce tilt
        ctx.setAngle("shoulderF", -30 * c);          // arms counter-swing the legs
        ctx.setAngle("shoulderB", 30 * c);
        /* elbow flexes on the FORWARD swing: shoulderF = −30c points
           F forward when c<0, B forward when c>0 — max(0,·) keeps it
           continuous at the wrap and never under the old 25° hold. */
        ctx.setAngle("elbowF", 25 + 13 * Math.max(0, -c));
        ctx.setAngle("elbowB", 25 + 13 * Math.max(0, c));
        ctx.setAngle("hipF", 28 * c);
        ctx.setAngle("hipB", -28 * c);
        ctx.setAngle("kneeF", -40 * Math.max(0, -c));
        ctx.setAngle("kneeB", -40 * Math.max(0, c));
        /* hip sway = pelvis push at DOUBLE the step rate: sin(2θ) is
           period-½ in phase → continuous at the wrap. Bob deepened to
           0.014|s| so the bounce reads with the stronger arms. */
        ctx.setRootOffset(0.004 * Math.sin(2 * th) * k, -0.310 - 0.014 * Math.abs(s));
      }
    },

    /* ---- mission 5: wading. Walk mechanics, smaller + higher
       steps (hip ±16, knee −35) at the slower wade Hz. Arms now
       ALTERNATE with the legs like the walk upgrade (−12 center
       keeps the reach-forward bias of the old held pose): the near
       arm swings −34→+10, the far arm mirrors, elbows flex on each
       forward swing. Same sin(2θ) hip sway (smaller) and the head
       counter-tilt against the step; juice bobs the head and lags
       the hair, so she visibly fights the current a little. */
    wade: {
      shadow: 1,
      apply: function (ctx) {
        const k = ctx.k;
        const th = TAU * ctx.phase;
        const s = Math.sin(th) * k, c = Math.cos(th) * k;
        ctx.setAngle("torso", -2.5 * s);
        ctx.setAngle("head", 1.5 * s - 2.5 * c);    // counter + hair-bounce tilt
        ctx.setAngle("shoulderF", -12 - 22 * c);    // alternating, biased forward
        ctx.setAngle("shoulderB", 12 + 22 * c);
        ctx.setAngle("elbowF", 25 + 11 * Math.max(0, -c));
        ctx.setAngle("elbowB", 25 + 11 * Math.max(0, c));
        ctx.setAngle("hipF", 16 * c);
        ctx.setAngle("hipB", -16 * c);
        ctx.setAngle("kneeF", -35 * Math.max(0, -c));
        ctx.setAngle("kneeB", -35 * Math.max(0, c));
        ctx.setRootOffset(0.003 * Math.sin(2 * th) * k, -0.97 * (0.310 + 0.012 * Math.abs(s)));
      }
    },

    /* ---- mission 6: front-crawl SWIM, side view.
       PRONE WINDMILL — the sign trap resolved empirically (see
       header block + harness): limb angles passed to setAngle are
       TORSO-RELATIVE, so at torso −78° a "forward" arm is NOT
       shoulder≈+70; the WORLD hand direction is W = at + a_sh
       (at = torso angle). Mapping below was solved by sweeping
       phase ∈ [0,1) at S=193 through the real rotation chain and
       checking the world hand-tip path.

         Wwind(u): monotonic world sweep of the hand line —
           pull (u<0.5):     75° → −20°   smoothstep (entry forward-
                             down under the chest → back at the hip;
                             0° = straight down, 90° = forward)
           recovery(u≥0.5):  −20° → −285° smoothstep (= +75°−360°,
                             continuous at wrap): up past the hip,
                             OVER THE HEAD (≈−180° at u≈0.78),
                             forward to re-entry.
         shoulderF = Wwind(u) − at   (torso-relative)
         elbow windmill bend: −(5 + 65·bp(u)) with the high-elbow
           window bp = smoothstep rise 0.50→0.58, fall 0.66→0.76 —
           70° bent at the exit, arm STRAIGHT over the crown so the
           tip actually clears the hair.
         back arm: same mapping at (u+0.5) mod 1 (half-cycle = 180°
           offset ≥ 60° anti-phase).
         flutter kick: hip −4 ±12·sin(4·TAU·u), knees ±8° anti-phase
           with their hip (integer 4× ⇒ continuous at wrap).
         head: 70° base counter-rot; on ODD cycleParity a bell
           window u∈[0.45,0.75] lifts it 64°→86°→64° (cosine bell),
           even cycles hold ~70°; the command is rate-limited to
           ≤8°/frame via headSm so parity flips never snap.
         body roll ±4° and root bob ±0.008S at the phase rate.
       Harness-measured at S=193, speed 1: tip clears the crown by
       0.093S (17.9 px) at phase 0.78; pull tip depth 0.074–0.287S
       under the hip at chest-front x 0.13–0.56S; hand-tip x travel
       0.593S. Full sampled table in the file header. */
    swim: {
      shadow: 0,
      apply: function (ctx) {
        const k = ctx.k;
        const u = ctx.phase;                       // 0..1 gait position
        const th = TAU * u;
        const at = -78 + 4 * k * Math.sin(th);     // body roll ±4°
        /* — monotonic windmill world-angle of the hand line — */
        const Wf = windmillAngle(u);
        const Wb = windmillAngle(u + 0.5);
        ctx.setAngle("torso", at);
        ctx.setAngle("shoulderF", Wf - at);
        ctx.setAngle("elbowF", -5 - 65 * k * windmillBend(u));
        ctx.setAngle("shoulderB", Wb - at);
        ctx.setAngle("elbowB", -5 - 65 * k * windmillBend((u + 0.5) % 1));
        /* flutter kick 4× cycle rate — a touch bigger than the old
           ±12/±8 (hips ±13, knees ±9): at 4× the phase rate this is
           the lively white-water buzz, while the monotonic windmill
           above stays the ONE arm reaching out of the water per
           half-cycle (recovery, u .5..1 → over the crown). */
        const fl = Math.sin(4 * th) * k;
        ctx.setAngle("hipF", -4 + 13 * fl);
        ctx.setAngle("hipB", -4 - 13 * fl);
        ctx.setAngle("kneeF", 6 - 9 * fl);          // anti-phase knees
        ctx.setAngle("kneeB", 6 + 9 * fl);
        /* breathing: every OTHER cycle (parity), bell over
           phase 0.45..0.75: 64° → 86° → 64°; rate-limited
           ≤8°/frame so parity flips smooth instead of snapping. */
        let target = 70;
        if (k > 0 && (ctx.cycleParity & 1)) {
          const bell = (u >= 0.45 && u <= 0.75)
            ? 0.5 - 0.5 * Math.cos(TAU * (u - 0.45) / 0.3)
            : 0;
          target = 70 + k * (-6 + 22 * bell);
        }
        const dt = num(ctx.dt, 0);
        if (!isFinite(headSm) || dt <= 0) {
          headSm = target;
        } else {
          headSm += clamp(target - headSm, -8, 8);
        }
        ctx.setAngle("head", headSm);
        ctx.setRootOffset(0, -0.035 - 0.008 * k * Math.sin(th));
      }
    },

    /* ---- mission 8: riding the duck boat. Upright SEATED on the
       boat's seat: the hull front (gunwale/bow, drawn at depth 16 by
       js/beach-boat.js) hides everything below the thighs. Angles are
       POSITIVE TOWARD the facing dir, so hip −40 sweeps the thighs
       back/under the seat front and knee +70 swings the shins
       forward-down — legs dangle into the hull, mostly hidden anyway.
       Arms: while ctx.speed > 0.06 (boat steered) they PADDLE in
       anti-phase off the cycle — shoulderF = 40 + 25k·sin(2πphase),
       shoulderB = 40 − 25k·sin(2πphase), elbows ±20° counter — so the
       stroke speeds up with the boat (CYCLES.ride hz(v)) and never
       snaps on a setSpeed change. Idle: arms rest at the gunwale with
       a gentle ±4° float on ctx.t (like stand's breath terms).
       Torso leans back −8°, ±2k phase sway; head counter small;
       root parks at −0.28S (seated low — the boat anchor sits ~0.10S
       above the hull centre, waterlineOffset convention). */
    ride: {
      shadow: 0,
      apply: function (ctx) {
        const t = ctx.t, k = ctx.k;
        const th = TAU * ctx.phase;
        const sway = Math.sin(t * 1.15) * k;          // easy body sway
        const paddle = Math.sin(th) * k;              // stroke swing
        const bal = Math.sin(t * 2.7) * k;            // slow balance rock
        const bal2 = Math.sin(t * 4.6 + 1.7) * k;     // faster micro-correction
        ctx.setAngle("torso", -8 + sway * 2 + bal * 1.5);
        ctx.setAngle("head", 6 - sway * 1.5 - bal * 1.5);   // small counter
        ctx.setAngle("hipF", -40);
        ctx.setAngle("hipB", -40);
        ctx.setAngle("kneeF", 70);
        ctx.setAngle("kneeB", 70);
        if (ctx.speed > 0.06) {
          /* paddling: stroke stays the driver, but BOTH arms ride a
             ±6k° counter-balance sway so the boat reads wobbly */
          ctx.setAngle("shoulderF", 40 + 25 * paddle + bal2 * 6);
          ctx.setAngle("shoulderB", 40 - 25 * paddle + bal2 * 6);
          ctx.setAngle("elbowF", 20 - 20 * paddle);   // counter-bend
          ctx.setAngle("elbowB", 20 + 20 * paddle);
        } else {
          const rest = Math.sin(t * 1.6) * k * 5;     // ±5° idle float
          ctx.setAngle("shoulderF", 30 + rest + bal2 * 5);
          ctx.setAngle("shoulderB", 18 - rest + bal2 * 5);
          ctx.setAngle("elbowF", 18);
          ctx.setAngle("elbowB", 16);
        }
        /* weight shift: whole body slides a couple px across the
           seat, slow rock + fast correction mixed */
        ctx.setRootOffset(0.005 * bal + 0.003 * bal2, -0.28 + sway * 0.005);
      }
    },

     /* ---- mission 9: standing on a surfboard. Athletic crouch —
        torso −10° lean forward (negative tips the crown toward the
        facing dir, the convention ride/float already use), BOTH legs
        in a surf squat: hip base −25° swings the thighs back under
        the body, knee +45° drives the shins forward so the soles
        stay roughly under the hips. Feet APART along the board: the
        front hip gets +8 (foot ≈ +0.078S ahead of the hip line), the
        back hip −8 (foot ≈ −0.111S behind) — the hip pivots' own
        ±0.055S x-separation widens the base beyond what the angles
        alone gave. Arms OUT for
        balance: shoulders ±65°, elbows 20°, with a ±7k° balance
        wobble + ±3k° quick micro-correction on the shoulders, a
        ±2.5k° torso sway, a tiny ±3k° knee pump and a ±0.011S
        root-x weight shift — all ctx.t-driven (like stand/float/
        ride idle terms) at raised ~0.65–1.1 Hz frequencies so it
        reads as ACTIVE balancing, amplitude-scaled by
        (0.4+0.6·speed)·k, so reduced motion (k=0) parks the static
        crouch. Mouth flips to the excited open O (mouthMood). Root offset −0.283S:
        bent legs (−hipY .020 + .16·cos17 + .15·cos28 + footRy .020
        ≈ .285 front / .281 back) park the soles ON the anchor —
        js/beach-surf.js sets the anchor at the board deck line. */
    surf: {
      shadow: 0,
      apply: function (ctx) {
        const t = ctx.t, k = ctx.k;
        const v = 0.4 + 0.6 * clamp(num(ctx.speed, 0), 0, 1);
        const wob = Math.sin(t * 4.1) * k * v;          // balance wobble (~0.65 Hz)
        const wob2 = Math.sin(t * 6.8 + 2.1) * k * v;   // quick micro-correction
        const pump = Math.sin(t * 5.2 + 1.2) * k * v;   // tiny knee pump
        ctx.setAngle("torso", -10 + wob * 2.5 + wob2 * 0.8);   // lean + ±2.5° sway + jitter
        ctx.setAngle("head", 8 - wob * 2 - wob2 * 0.7);         // eyes up the line
        ctx.setAngle("shoulderF", 65 + wob * 7 + wob2 * 3);     // arms OUT, counter-balancing
        ctx.setAngle("elbowF", 20 + pump * 4);
        ctx.setAngle("shoulderB", -65 - wob * 7 + wob2 * 3);
        ctx.setAngle("elbowB", 20 - pump * 4);
        ctx.setAngle("hipF", -17 + pump * 1.5);         // crouch −25 + front set
        ctx.setAngle("kneeF", 45 - pump * 3);
        ctx.setAngle("hipB", -33 - pump * 1.5);         // crouch −25 + back set
        ctx.setAngle("kneeB", 45 + pump * 3);
        /* weight shift: hips slide ±0.011S across the board (slow
           wobble + faster correction) while the soles stay planted
           on the anchor line within ~2px at any S */
        ctx.setRootOffset(0.004 * wob + 0.007 * wob2, -0.283 + pump * 0.004);
      }
    }
  };

  function applyStance(tSec, dtSec) {
    if (!rig) return;
    const st = STANCES[stanceName] || STANCES.stand;
    const k = motionAmplitude();
    const S = rig.S;
    st.apply({
      t: tSec,
      dt: dtSec,
      k: k,
      S: S,
      speed: speed,
      phase: phase,
      cycleHz: stanceHz(stanceName, speed),
      cycleParity: cycleCount & 1,
      joints: rig.joints,
      root: rig.root,
      shadowG: rig.shadowG,
      setAngle: setAngle,
      setRootOffset: setRootOffset
    });
    if (rig.shadowG) {
      const sa = num(st.shadow, 1);
      rig.shadowG.setAlpha ? rig.shadowG.setAlpha(sa) : (rig.shadowG.alpha = sa);
    }
  }

  /* ---------- animation juice pass ----------
     Runs after applyStance EVERY update() frame (never on the dt=0
     re-apply paths, so stance swaps/repaints can't fast-forward it).
     Writes three things outside the stance system, which keeps all
     stances pure:
       • head bone y-bob (breath on stand, step bounce on walk/wade,
         surface seesaw on swim/float) — ±1-2% of S, never stale
         because every branch (incl. the k=0 default) writes it;
       • hairLag — a simple low-pass of gfx.hairBack's container y,
         chasing -1.7× the head bob (plus a counter-step term on the
         gait stances) so the back-hair mass trails the head like a
         secondary spring;
       • blink — schedules eyes-closed events every ~2.5-5s using the
         same wall clock as everything else; repaints the lid overlay
         only when the closure actually moved (a blink redraws ~7
         frames total; open frames cost one float compare).
     Reduced motion (k=0): lid pinned open, blink unscheduled, bob and
     lag chase 0 — the pass becomes two setPosition(0)-equivalents.   */
  function applyJuice(t, dt, k, rewound) {
    const geo = rig.geo;
    const S = rig.S;
    const th = TAU * phase;
    /* head-bone bob (px, + = down) */
    let bob = 0;
    if (k > 0) {
      if (stanceName === "stand") {
        bob = -Math.sin(t * Math.PI) * 0.012 * S;     // 0.5 Hz breath (matches stand's br)
      } else if (stanceName === "walk") {
        bob = -Math.sin(th) * 0.010 * S;              // step bounce
      } else if (stanceName === "wade") {
        bob = -Math.sin(th) * 0.008 * S;
      } else if (stanceName === "float" || stanceName === "swim") {
        bob = -Math.sin(th) * 0.006 * S;              // surface seesaw on the head
      }
    }
    rig.joints.head.setPosition(0, geo.headY + (isFinite(bob) ? bob : 0));
    /* hair-back lag bone — first-order low-pass toward the opposite
       of the head motion (α ≈ 14/s, dt clamped upstream so α ∈ [0,1]) */
    let lagTarget = -1.7 * bob;
    if (k > 0 && (stanceName === "walk" || stanceName === "wade")) {
      lagTarget += Math.sin(th + 1.25) * 0.008 * S;   // counter-step swing
    }
    if (!isFinite(hairLag)) hairLag = lagTarget;
    hairLag += (lagTarget - hairLag) * clamp((dt > 0 ? dt : 1 / 60) * 14, 0, 1);
    if (!isFinite(hairLag)) hairLag = 0;
    rig.joints.hair.setPosition(0, hairLag);
    /* blink scheduling — random 2.5..5s gap; k=0 pins it open and
       un-scheduled; a clock rewind (scene restart) re-seeds instead
       of letting a stale blinkAt drive lidAmt wild */
    if (k <= 0 || rewound) {
      blinkNext = NaN;
      blinkAt = NaN;
      lidAmt = 0;
    } else {
      if (!isFinite(blinkNext)) blinkNext = t + 1.2 + 2.2 * Math.random();
      if (!isFinite(blinkAt) && t >= blinkNext) blinkAt = t;
      if (isFinite(blinkAt)) {
        const p = (t - blinkAt) / BLINK_DUR;
        if (!(p < 1)) {
          blinkAt = NaN;
          blinkNext = t + 2.5 + 2.5 * Math.random();
          lidAmt = 0;
        } else {
          lidAmt = blinkShape(p);
        }
      } else {
        lidAmt = 0;
      }
    }
    if (Math.abs(lidAmt - paintedLid) > 0.02 || (lidAmt > 0) !== (paintedLid > 0)) {
      paintedLid = lidAmt;
      const BG = rig.gfx.blink;
      BG.clear();
      paintBlink(BG, geo, lidAmt);
    }
  }

  function currentWaveTime() {
    const B = window.BeachGame;
    return (B && typeof B.wavePhase === "function") ? num(B.wavePhase(), 0) : 0;
  }

  /* ---------- public API ---------- */

  function attach(sc) {
    if (!sc || !sc.add || typeof sc.add.container !== "function") return false;
    if (rig && scene === sc) return true;   // idempotent
    if (rig) detach();                       // re-attach onto a fresh scene

    scene = sc;
    const gs = window.GameState;
    if (gs && typeof gs.getCharacter === "function") {
      const c = gs.getCharacter();
      if (c && typeof c.id === "string" && c.id) charId = c.id;
    }
    /* stand on the sand: fx mid-stage, 12% into the sand band —
       KEPT IN SYNC with LOCO_REST_F in beach-game.js (mission 7
       locomotion initializes its anchor from getAnchor() when this
       attach ran first, and must agree with it when it did not). */
    const L = layoutNow();
    const sandTop = L ? L.sandTop : 0.72;
    anchor = { fx: 0.5, fy: sandTop + 0.12 * (1 - sandTop) };
    flipped = false;

    /* Module state SURVIVES detach (this IIFE runs once), so a stale
       stance (e.g. 'float' from before the player left the beach)
       would desync from the locomotion's initLocomotion, which always
       assumes the rig boots on 'stand' — driveRig then skips the
       setStance call (stance === loco.stance) and she reopens lying
       down. Reset the full pose state here so 'stand' is the truth. */
    stanceName = "stand";
    speed = 0;
    phase = 0;
    cycleCount = 0;
    headSm = NaN;
    waterlineFy = null;
    resetJuice();                            // fresh blink/hair state per rig

    buildRig();
    rig.root.setScale(flipped ? -1 : 1);

    if (sc.events && typeof sc.events.once === "function") {
      sc.events.once("shutdown", detach);   // module refs die with the game
    }
    return true;
  }

  function detach() {
    if (rig) {
      if (rig.root && typeof rig.root.destroy === "function") {
        rig.root.destroy();
      }
      rig = null;
    }
    scene = null;
    headSm = NaN;          // smoother state is per-rig
    resetJuice();          // blink/hairLag too — next build starts fresh
  }

  function isAttached() {
    return !!rig;
  }

  function onResize() {
    if (!rig) return;
    const S = computeS();
    if (S === rig.S) return;                 // height unchanged — keep art
    rig.S = S;
    rig.geo = computeGeo(S);
    const j = rig.joints;
    /* re-place the pivots at the new segment scale */
    j.head.setPosition(0, rig.geo.headY);
    j.shoulderB.setPosition(rig.geo.shoulderBx, rig.geo.shoulderY);
    j.shoulderF.setPosition(rig.geo.shoulderFx, rig.geo.shoulderY);
    j.elbowB.setPosition(0, rig.geo.upperLen);
    j.elbowF.setPosition(0, rig.geo.upperLen);
    j.hipB.setPosition(-rig.geo.hipHx, rig.geo.hipY);
    j.hipF.setPosition(rig.geo.hipHx, rig.geo.hipY);
    j.kneeB.setPosition(0, rig.geo.thighLen);
    j.kneeF.setPosition(0, rig.geo.thighLen);
    repaintAll();
    applyStance(currentWaveTime(), 0);
    placeRoot();
  }

  function update(timeMs, dtMs) {
    if (!rig) return;
    const t = num(timeMs, 0) / 1000;
    const dt = clamp(num(dtMs, 0) / 1000, 0, 0.1);
    /* scene restarts reset Phaser's clock — juice re-seeds its blink
       schedule instead of chasing a negative elapsed time */
    const rewound = t + 0.0005 < lastT;
    lastT = t;
    /* phase accumulator — the ONLY gait clock. dt = 0 re-applies
       (stance swap, repaint, resize) never advance it. Under
       reduced motion it parks at the stance's mid-pose instead,
       so every cycle term stays finite and the same apply()
       produces a static base pose. */
    const k = motionAmplitude();
    if (k > 0) {
      phase += dt * stanceHz(stanceName, speed);
      while (phase >= 1) { phase -= 1; cycleCount++; }
    } else {
      phase = stancePark(stanceName);
    }
    applyStance(t, dt);
    applyJuice(t, dt, k, rewound);
    placeRoot();
  }

  function setStance(name) {
    if (!STANCES[name]) return false;        // unknown → keep current
    const prevMood = mouthMood(stanceName);
    stanceName = name;
    phase = 0;                               // fresh cycle per stance
    cycleCount = 0;
    headSm = NaN;                            // drop smoother state
    if (rig) {
      /* the mouth is baked into the head Graphics — retrace ONLY
         that layer when the swap flips the mood (not per frame) */
      if (mouthMood(name) !== prevMood) {
        rig.gfx.head.clear();
        paintHead(rig.gfx.head, rig.geo, mouthMood(name));
      }
      applyStance(lastT, 0);
      placeRoot();
    }
    return true;
  }

  function getStance() {
    return stanceName;
  }

  /* Locomotion intensity 0..1 (mission 7 drives it from pointer
     speed). NaN/garbage → keep current; out-of-range → clamp.
     Only the cycle RATE changes — phase continues uninterrupted,
     so a speed step never snaps a pose. */
  function setSpeed(v01) {
    speed = clamp(num(v01, speed), 0, 1);
    return true;
  }

  function getSpeed() {
    return speed;
  }

  function setFlip(b) {
    flipped = !!b;
    /* NOTE: setScale(v) sets BOTH axes — v=-1 on Y would turn the
       rig head-over-heels (the "upside-down swimmer" bug). Facing
       mirror must touch X only. */
    if (rig) rig.root.setScale(flipped ? -1 : 1, 1);
  }

  function setCharacter(id) {
    if (typeof id !== "string" || !id) return false;
    const chars = window.CHARACTERS;
    if (!chars || !chars[id]) return false;
    if (id === charId && rig) return true;
    charId = id;
    repaintAll();
    if (rig) {
      applyStance(currentWaveTime(), 0);
      placeRoot();
    }
    return true;
  }

  function setSuitColors(colors) {
    if (!colors || typeof colors !== "object") return false;
    if (colors.main != null) suit.main = hexInt(colors.main, suit.main);
    if (colors.trim != null) suit.trim = hexInt(colors.trim, suit.trim);
    if (colors.bottom != null) suit.bottom = hexInt(colors.bottom, suit.bottom);
    if (colors.twoPiece != null) suit.twoPiece = !!colors.twoPiece;
    repaintAll();
    return true;
  }

  function setAnchor(fx, fy) {
    const x = num(fx, NaN), y = num(fy, NaN);
    if (!isFinite(x) || !isFinite(y)) return false;
    anchor = { fx: clamp(x, 0, 1), fy: clamp(y, 0, 1) };
    placeRoot();
    return true;
  }

  function getAnchor() {
    return rig ? { fx: anchor.fx, fy: anchor.fy } : null;
  }

  function waterlineOffset() {
    return rig ? 0.10 * rig.S : null;
  }

  /* ---------- mission 6: submersion compositing ---------- */

  /* Local waterline for the submerged-body wash. fy = FRACTIONAL
     stage y (BeachGame.foamEdgeY() ÷ layout.h, or the anchor fy
     when riding the foam). Null clears. Invalid non-null values
     keep the previous state. */
  function setWaterline(fyOrNull) {
    if (fyOrNull == null) { waterlineFy = null; return true; }
    const v = num(fyOrNull, NaN);
    if (!isFinite(v)) return false;
    waterlineFy = clamp(v, 0, 1);
    return true;
  }

  /* What the scene needs to know to composite submersion:
     {cx, cy, S, waterY} in canvas px (cx/cy = hip point, waterY =
     waterline px), or null when there is nothing to draw:
       • no waterline set / no layout / detached,
       • stance is land-locked (anything but float|swim|wade),
       • waterline below the sand reach (waterY > sandY(0)+0.15S —
         the swimmer is standing on dry sand, no wash).
     Detached-safe: callable before attach(). */
  function getSubmergeInfo() {
    if (!rig || waterlineFy == null) return null;
    if (stanceName !== "float" && stanceName !== "swim" && stanceName !== "wade") return null;
    const L = layoutNow();
    if (!L) return null;
    const S = rig.S;
    const waterY = clamp(waterlineFy, 0, 1) * L.h;
    const sandY0 = L.sandTop * L.h;
    if (!isFinite(waterY) || !isFinite(sandY0)) return null;
    if (waterY > sandY0 + 0.15 * S) return null;
    return { cx: num(rig.root.x, NaN), cy: num(rig.root.y, NaN), S: S, waterY: waterY };
  }

  /* Paint the submerged half of the body under the waterline on a
     scene-owned Graphics (beach-game.js calls this every frame at
     depth 16, just above the rig):
       (a) translucent aqua wash over the body column below the
           surface (rounded rect cx±0.62S, from just under the
           waterline to the sand line),
       (b) two white surface ellipses at the waterline — the break
           in the body line,
       (c) while moving (speed>0.05) in swim/float: two wake arcs
           trailing opposite the facing, alpha pulsing with
           BeachGame.wavePhase(); static alphas under reduced
           motion. No-ops on null/garbage input — fully
           detached-safe. */
  function paintSubmerge(g, info) {
    if (!g || !info) return;
    const cx = num(info.cx, NaN), cy = num(info.cy, NaN);
    const S = num(info.S, 0), waterY = num(info.waterY, NaN);
    if (!(isFinite(cx) && isFinite(cy) && isFinite(waterY) && S > 0)) return;
    const L = layoutNow();
    const sandY0 = L ? L.sandTop * L.h : waterY + 1.1 * S;

    /* (a) underwater tint: TWO feathered ellipses (wide faint +
       narrow denser) instead of a hard rounded rect — a rect reads
       as a glass pane floating on the textured sea. The tint hugs
       the LOCAL waterline just under the body: its bottom edge is
       clamped BOTH to the sand line and to waterY + 0.85S, so it
       never smears a gray blob across dry sand when she swims far
       from shore. */
    const top = waterY + 0.06 * S;
    const maxBot = Math.min(sandY0 - 0.04 * S, waterY + 0.85 * S);
    const ryOuter = Math.max(0.08 * S, (maxBot - top) / 2);
    const tintCy = top + ryOuter;
    g.fillStyle(0x49c1dd, 0.15);
    g.fillPoints(ellipsePts(cx, tintCy, 1.05 * S, ryOuter), true);
    g.fillStyle(0x49c1dd, 0.20);
    g.fillPoints(ellipsePts(cx, top + 0.8 * ryOuter, 0.72 * S, 0.8 * ryOuter), true);

    /* (b) surface ellipse pair at the waterline break */
    const ey = waterY + 0.02 * S;
    g.fillStyle(0xffffff, 0.50);
    g.fillPoints(ellipsePts(cx, ey, 0.55 * S, 0.05 * S), true);
    g.fillStyle(0xffffff, 0.35);
    g.fillPoints(ellipsePts(cx, ey, 0.38 * S, 0.05 * S), true);

    /* (c) wake — only while genuinely moving through the surface */
    if (speed > 0.05 && (stanceName === "swim" || stanceName === "float")) {
      const rm = motionAmplitude() === 0;
      const wp = currentWaveTime();
      /* trailing = opposite the facing direction */
      const back = flipped ? 0 : Math.PI;    // radians, screen frame
      const oy = waterY + 0.03 * S;
      const lw = Math.max(1.2, 0.012 * S);
      let a1, a2;
      if (rm) { a1 = 0.22; a2 = 0.14; }
      else {
        a1 = clamp(0.14 + 0.10 * Math.sin(TAU * wp * 0.5), 0, 1);
        a2 = clamp(0.10 + 0.07 * Math.sin(TAU * wp * 0.5 + 1.9), 0, 1);
      }
      g.lineStyle(lw, 0xffffff, a1);
      g.strokePoints(arcPts(cx, oy, 0.52 * S, back - 0.42, back + 0.42, 7), false);
      g.lineStyle(lw * 0.8, 0xffffff, a2);
      g.strokePoints(arcPts(cx, oy, 0.68 * S, back - 0.30, back + 0.30, 7), false);
    }
  }

  /* Missions 5-7: register { shadow?, apply(ctx) } as a new stance.
     `apply` MUST be a pure function of ctx.t/ctx.k — set every
     joint every call (no accumulation). */
  function defineStance(name, def) {
    if (!name || !def || typeof def.apply !== "function") return false;
    STANCES[name] = def;
    return true;
  }

  const api = {
    attach: attach,
    detach: detach,
    isAttached: isAttached,
    onResize: onResize,
    update: update,
    setStance: setStance,
    getStance: getStance,
    setSpeed: setSpeed,
    getSpeed: getSpeed,
    setFlip: setFlip,
    setCharacter: setCharacter,
    setSuitColors: setSuitColors,
    setAnchor: setAnchor,
    getAnchor: getAnchor,
    waterlineOffset: waterlineOffset,
    setWaterline: setWaterline,
    getSubmergeInfo: getSubmergeInfo,
    paintSubmerge: paintSubmerge,
    defineStance: defineStance,
    SUIT_DEFAULT: SUIT_DEFAULT
  };
  Object.defineProperty(api, "joints", { get: function () { return rig ? rig.joints : null; } });
  Object.defineProperty(api, "root", { get: function () { return rig ? rig.root : null; } });
  /* geometry table (S + all segment lengths in px) or null — the
     same numbers the capsules were drawn with. */
  Object.defineProperty(api, "geo", { get: function () { return rig ? rig.geo : null; } });

  window.BeachRig = api;
})();
