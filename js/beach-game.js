/* ============================================================
   Lily's Dress-Up Adventure — Beach game (Phaser) foundation
   + WorldArt (mission 2: canvas daytime beach world,
               mission 3: animated ocean)
   + Locomotion (mission 7: press-and-hold pointer control)

     Owns a single Phaser.Game that lives INSIDE the beach
     overlay's #beach-stage while the scene is open, and dies
     with it. WorldArt draws the full cute beach scene — sky
     gradient, sun + spinning rays, drifting clouds, gliding
     gulls, layered sea, textured sand, umbrella, shells,
     starfish, beach ball, hibiscus — inside the canvas,
     mirroring the DOM art in js/beach.js / css/style.css
     (same hexes, same fractional anchors). While the game runs
     (.game-active on .beach-scene) the DOM sky/sea/sand bands
     and prop decorations are display:none'd; the sandcastle
     stays visible ABOVE the canvas.

     LIFECYCLE:
       BeachGame.open(stageEl)   idempotent; appends a .beach-game-host
                                 div into the stage and boots Phaser
                                 with a transparent canvas.
       BeachGame.close()         game.destroy(true) — one WebGL
                                 context per beach visit, never a
                                 leak across open/close cycles. Safe
                                 to call when never opened.
       BeachGame.isOpen()
       BeachGame.layout()        current { w, h, seaTop, sandTop,
                                 px, fx, yFromTop, xFromLeft,
                                 seaY, sandY } or null before the
                                 scene has a size.
       BeachGame.reducedMotion() live prefers-reduced-motion check.
       BeachGame.foamEdgeY(fx)   CURRENT animated foam-top y in
                                 canvas px at fractional x (0..1
                                 across the stage), or null while
                                 no scene has a size. Boats and
                                 swimmers (missions 4+) bob on
                                 this — it is the exact same math
                                 the frame pass draws with, so
                                 riders always sit on the visible
                                 edge. Under reduced motion it
                                 returns the flat resting edge.
        BeachGame.wavePhase()     global ocean time scalar in
                                  seconds (0 under reduced motion);
                                  the phase an entity animation
                                  would use for its own
                                  wave-synced wobble.
        BeachGame.locomotion      MISSION 7 — press-and-hold to
                                  move: Lily walks (sand), wades
                                  (foam) or swims (sea) toward the
                                  held point — drag to steer — and
                                  stops exactly where she is on
                                  release (floats/bobs in water,
                                  idles on sand). Kid-gentle capped
                                  speeds, ease-out near the target,
                                  ripple marker on press, splash on
                                  water entry/exit. ONE pointer is
                                  tracked (first-down wins) so
                                  multi-touch can't fight itself;
                                  DOM chrome above the canvas keeps
                                  its own clicks.
          .getAnchor() -> {fx,fy}   her current fractional anchor,
                                    or null while the game is closed
          .isMoving()  -> bool      true while heading somewhere
          .setEnabled(bool)         pause/resume. Disabled: pointer
                                    input ignored, stepping skipped,
                                    NOTHING pushed to BeachRig
                                    (stance/anchor/speed/waterline/
                                    facing all left alone) — mission
                                    8's duck boat takes the anchor
                                    over while riding and calls
                                    this around the ride. Re-enable
                                    adopts wherever the rig stands
                                    now, so hopping out of the boat
                                    never teleports her.
          .setTarget(fx,fy)         drive her programmatically —
                                    same zone speeds, auto-stops on
                                    arrival; false when closed /
                                    disabled / garbage input.

     WORLD LAYOUT: the scene reads the zone geometry from the SAME
     single source of truth the DOM art uses — the --sea-top /
     --sand-top custom properties on .beach-scene (css/style.css) —
     so canvas and DOM bands can never disagree. It re-measures on
     every Phaser resize (Scale.RESIZE mirrors the host box) and
     repaints the static layer at the new size.

     RENDER SPLIT (stays cheap):
       bgG      sky/sea/horizon/wet-sand/sun-disc; propsG the
                small ground props (shells, starfish, ball,
                flower) on TOP — ONE static Graphics each,
                replayed by Phaser but never re-traced, redrawn
                only in create() and on resize. Small props stay
                above the water (DOM z: .beach-props 4 >
                .beach-sea 2); the umbrella has its OWN front
                layer umbrellaG (depth 30) — a foreground prop
                planted in the sand, drawn in front of every
                dynamic depth (water, boats, rig, surf wave).
       animG    sun rays (10 tapered, spin + slow pulse), 3
                 clouds (4-puff drift + wrap), 2 gulls (glide +
                 bob + wing flap); cleared and re-traced every
                 frame. Under BeachGame.reducedMotion() the
                 frame pass draws ONE resting frame and stops.
        waterG   the ocean (mission 3 + scene art pass): 4
                 drifting sine wave sheets, 2 moving gloss
                 dashes, the lapping translucent wash strip, the
                 scalloped foam waterline + 5 popping bubbles,
                 10 sun glints; also cleared and re-traced every
                 frame, ON TOP of animG, BELOW propsG — under
                 ~60 primitives/frame, all in Phaser's replayed
                 buffers + two static ones. The static bg pass
                 additionally carries the wavy horizon + depth
                 bands, sun halo/glow rings and the two-band wet
                 sand with shell specks. Reduced motion
                 flattens every amplitude to 0 and freezes the
                 glints at seed 1 — one calm frame.

      The scene class is built lazily inside open() so this file
      stays safe to parse even if lib/phaser.min.js ever fails to
      load — window.BeachGame then simply never boots (beach.js
      guards every call with `if (window.BeachGame)` + an isOpen()
      check). js/beach-rig.js (window.BeachRig, mission 4) is wired
      in the same lazy spirit: WorldScene.create attaches it at
      depth 15 (above waterG/propsG), measure() forwards onResize,
      update() forwards (time, delta), and scene shutdown / close()
      detach it. Both directions guard for the module being absent.

      Exposes window.BeachGame = { open, close, isOpen, layout,
      reducedMotion, foamEdgeY, wavePhase, locomotion } — plus a
      module.exports test seam (browser-inert) for stepLocomotion.
     ============================================================ */

(function () {
  "use strict";

  let game = null;     // live Phaser.Game instance (null = closed)
  let hostEl = null;   // .beach-game-host div inside #beach-stage
  let layout = null;   // last-measured world layout (owned by the scene)

  /* Ocean state owned by the frame pass, read by the public API
     (foamEdgeY / wavePhase) so later missions bob on the EXACT
     same math the canvas draws. Updated in WorldArt.frame(). */
  let waveTime = 0;    // seconds scalar; pinned to 0 under reduced motion
  let waveAmp = 0;     // 1 = live drift, 0 = reduced-motion resting

  const TAU = Math.PI * 2;

  const SEA_TOP_FALLBACK = 0.42;   // mirrors --sea-top in css/style.css
  const SAND_TOP_FALLBACK = 0.72;  // mirrors --sand-top in css/style.css

  /* ============================================================
     WorldArt palette — every hex copied verbatim from
     css/style.css ("Beach scene ART layers") and the SVG markup
     in js/beach.js, so canvas and DOM can never visually drift.
     ============================================================ */

  const PAL = {
    /* .beach-sky gradient */
    skyTop: 0x7ec8f7, skyMid: 0xa8ddfb, skyLow: 0xd8f1ff,
    /* .beach-sea gradient: deep at the horizon → shallow aqua */
    seaDeep: 0x2b93b6, seaMid: 0x3cb0cf, seaShallow: 0x63d1e1,
    /* .beach-sand gradient + its two radial-gradient dot grains */
    sandTop: 0xffefc6, sandLow: 0xf6d78c,
    sandGrain: 0xce9642, sandGrainWhite: 0xffffff,
    /* sunMarkup(): disc, edge ring, glow ellipse, rays */
    sunDisc: 0xffd93d, sunEdge: 0xf7bd2a, sunGlow: 0xffec9e, sunRay: 0xffe170,
    /* CLOUD_SVG: white puffs + cool underside band */
    cloud: 0xffffff, cloudShade: 0xdceffd,
    /* GULL_SVG stroke */
    gull: 0x5d4b8e,
    /* UMBRELLA_SVG: bamboo pole, pink petals, yellow wedges, ink */
    pole: 0xd99a5b, petalPink: 0xff8fb8, wedgeYellow: 0xffd93d,
    ink: 0x3a2e6e, cream: 0xfff9ec,
    /* SCALLOP_SVG / SPIRAL_SVG */
    shellPink: 0xffd1e3, shellRose: 0xf26d9d, shellWhite: 0xffffff,
    shellLavender: 0xb9a3e8,
    /* starfishMarkup() */
    starOrange: 0xffb84d, starDot: 0xe8963a,
    /* ballMarkup() wedge cycle */
    ballPink: 0xff8fb8, ballYellow: 0xffd93d, ballAqua: 0x4fc3d9,
    /* mission 3 ocean glints (same warm white family as the sun) */
    sunGlint: 0xfff6c8
  };

  /* Gradient stops as [fraction, hex] pairs, exactly the CSS
     linear-gradient percentages of each DOM band. */
  const SKY_STOPS = [[0, PAL.skyTop], [0.45, PAL.skyMid], [1, PAL.skyLow]];
  const SEA_STOPS = [[0, PAL.seaDeep], [0.45, PAL.seaMid], [1, PAL.seaShallow]];
  const SAND_STOPS = [[0, PAL.sandTop], [1, PAL.sandLow]];

  /* Sun anchor (mission spec): top-right of the sky, sized off
     stage height. DOM equivalent: .beach-sun top:8%/right:9%. */
  const SUN = { fx: 0.88, fy: 0.14, rF: 0.05, minR: 14 };

  /* true when the player asked the OS to dial animations down.
     CACHED: matchMedia() allocates a MediaQueryList on every call, and
     reducedMotion() sits in the 60 Hz path — the art frame, boat and
     surf all poll it each frame. Evaluate once and refresh on change
     so the hot loop reads a plain boolean. (js/beach.js keeps its own
     click-time check; that one is not per-frame.) */
  let rmMatches = false;
  try {
    if (window.matchMedia) {
      var rmMql = window.matchMedia("(prefers-reduced-motion: reduce)");
      rmMatches = !!rmMql.matches;
      var onRmChange = function () { rmMatches = !!rmMql.matches; };
      if (typeof rmMql.addEventListener === "function") {
        rmMql.addEventListener("change", onRmChange);
      } else if (typeof rmMql.addListener === "function") {
        rmMql.addListener(onRmChange);          /* legacy Safari */
      }
    }
  } catch (e) { rmMatches = false; }

  function reducedMotion() {
    return rmMatches;
  }

  /* "42%" → 0.42 (clamped); anything unparseable → fallback.
     A unit-less number in (0, 1] is accepted as a fraction already,
     since some browsers hand back the raw token for custom props. */
  function parseBandFraction(raw, fallback) {
    if (typeof raw !== "string") return fallback;
    const text = raw.trim();
    if (!text) return fallback;
    if (text.charAt(text.length - 1) === "%") {
      const pct = parseFloat(text);
      if (isFinite(pct)) return Math.max(0, Math.min(1, pct / 100));
      return fallback;
    }
    const num = parseFloat(text);
    if (isFinite(num) && num > 0 && num <= 1) return num;
    return fallback;
  }

  /* Read the live zone custom properties off the overlay. */
  function measureBands() {
    let seaTop = SEA_TOP_FALLBACK;
    let sandTop = SAND_TOP_FALLBACK;
    const sceneEl = (hostEl && hostEl.closest)
      ? hostEl.closest(".beach-scene")
      : document.querySelector(".beach-scene");
    if (sceneEl && window.getComputedStyle) {
      const cs = window.getComputedStyle(sceneEl);
      seaTop = parseBandFraction(cs.getPropertyValue("--sea-top"), SEA_TOP_FALLBACK);
      sandTop = parseBandFraction(cs.getPropertyValue("--sand-top"), SAND_TOP_FALLBACK);
    }
    return { seaTop: seaTop, sandTop: sandTop };
  }

  /* ============================================================
     Small geometry helpers (pure math — the vendored Graphics
     has no transform stack, so every point is mapped by hand).
     ============================================================ */

  /* Blend two 0xRRGGBB ints, t in [0,1]. */
  function mixColor(a, b, t) {
    const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
    const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
    const r = Math.round(ar + (br - ar) * t);
    const g2 = Math.round(ag + (bg - ag) * t);
    const b2 = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g2 << 8) | b2;
  }

  /* Color of a [fraction, hex] stop list at fraction t. */
  function stopsColor(stops, t) {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0] || i === stops.length - 1) {
        const span = stops[i][0] - stops[i - 1][0];
        const f = span > 0 ? (t - stops[i - 1][0]) / span : 0;
        return mixColor(stops[i - 1][1], stops[i][1], Math.max(0, Math.min(1, f)));
      }
    }
    return stops[stops.length - 1][1];
  }

  /* Vertical gradient rect, drawn as ~3px-wide opaque strips that
     overlap 1px (no AA seams between rows). Static pass only —
     once per resize, never per frame. */
  function gradientRect(g, x, y, w, h, stops) {
    const rows = Math.max(1, Math.min(160, Math.round(h / 3)));
    const rowH = h / rows;
    for (let i = 0; i < rows; i++) {
      g.fillStyle(stopsColor(stops, (i + 0.5) / rows), 1);
      g.fillRect(x, y + i * rowH, w, rowH + 1);
    }
  }

  /* Sample a quadratic Bézier into an [[x,y]…] polyline in LOCAL
     prop coordinates (affine mapping afterwards is exact —
     sampling commutes with rotate/scale/translate). The first
     point is NOT repeated; concatenate after a moveTo point. */
  function quadPts(p0, cp, p1, n) {
    const segs = n || 6;
    const out = [];
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, u = 1 - t;
      out.push([
        u * u * p0[0] + 2 * u * t * cp[0] + t * t * p1[0],
        u * u * p0[1] + 2 * u * t * cp[1] + t * t * p1[1]
      ]);
    }
    return out;
  }

  /* Sample a cubic Bézier (same conventions as quadPts). */
  function cubicPts(p0, c1, c2, p1, n) {
    const segs = n || 8;
    const out = [];
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, u = 1 - t;
      out.push([
        u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
        u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1]
      ]);
    }
    return out;
  }

  /* {x,y} point ring for fillPoints (Graphics wants objects). */
  function toWorld(map, pts) {
    const out = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) out[i] = map(pts[i][0], pts[i][1]);
    return out;
  }

  /* [[x,y]…] ring → [{x,y}…] for fillPoints without a mapper
     (per-frame shapes that are already in canvas px). */
  function toObjects(ring) {
    const out = new Array(ring.length);
    for (let i = 0; i < ring.length; i++) {
      out[i] = { x: ring[i][0], y: ring[i][1] };
    }
    return out;
  }

  /* Mapper from a prop's raw SVG viewBox coords to canvas px:
     centered on (cx, cy), uniform scale s, rotation rot. */
  function makeMapper(cx, cy, vbW, vbH, s, rot) {
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const ox = vbW / 2, oy = vbH / 2;
    return function (lx, ly) {
      const dx = (lx - ox) * s, dy = (ly - oy) * s;
      return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
    };
  }

  /* CSS clamp(min, pct*stageW, max) — same width formula the DOM
   .beach-prop rules use, so props scale identically. */
  function clampedSize(w, minPx, pct, maxPx) {
    return Math.min(Math.max(minPx, pct * w), maxPx);
  }

  /* Resolve a prop cfg to its canvas box for the CURRENT layout —
     the exact math drawProp uses, factored out so drawPropsLayer can
     plant a contact shadow under each prop's footprint without
     duplicating the anchor/scale formulas. Shared by drawProp and
     the shadow helpers; static-pass only. */
  function propGeom(cfg) {
    /* hPct props size by STAGE HEIGHT (pxH = hPct·h) so their fy
       footprint is aspect-independent — used by the umbrella so
       its canopy always lands in the sky, above the swim/boat
       lane, on phones AND desktops. Others size by width. */
    const sizePx = (cfg.hPct)
      ? Math.max(cfg.min, Math.min(cfg.max || 1e9,
          cfg.hPct * layout.h * cfg.vb[0] / cfg.vb[1]))
      : clampedSize(layout.w, cfg.min, cfg.pct, cfg.max);
    const vbW = cfg.vb[0], vbH = cfg.vb[1];
    const s = sizePx / vbW;
    const pxH = vbH * s;
    const cx = (cfg.right != null)
      ? layout.w - cfg.right * layout.w - sizePx / 2
      : cfg.left * layout.w + sizePx / 2;
    const cy = layout.h - cfg.bottom * layout.h - pxH / 2;
    return {
      sizePx: sizePx, vbW: vbW, vbH: vbH, s: s, pxH: pxH,
      cx: cx, cy: cy, top: cy - pxH / 2, bottom: cy + pxH / 2
    };
  }

  /* Run a prop painter at the DOM rule's anchor: left/right/bottom
     fractions of the stage, height derived from the viewBox ratio.
     cfg: { vb, left|right, bottom, min, pct, max, rot, alpha }. */
  function drawProp(g, cfg, painter) {
    const geo = propGeom(cfg);
    painter(g, {
      map: makeMapper(geo.cx, geo.cy, geo.vbW, geo.vbH, geo.s, cfg.rot || 0),
      s: geo.s,
      rot: cfg.rot || 0,
      alpha: cfg.alpha == null ? 1 : cfg.alpha
    });
  }

  /* Fill a closed shape then outline it (traced twice: the
     vendored Graphics may or may not keep the path after
     fillPath, so never rely on it). ctx carries the alpha for
     partially transparent props (.beach-shell-c). */
  function fillStrokeLocal(g, ctx, localPts, fillColor, lineWidth, strokeColor) {
    const wp = toWorld(ctx.map, localPts);
    g.fillStyle(fillColor, ctx.alpha);
    g.fillPoints(wp, true);
    g.lineStyle(lineWidth * ctx.s, strokeColor, ctx.alpha);
    g.strokePoints(wp, true);
  }

  /* ============================================================
     Prop shape data — point lists transcribed from the SVG paths
     in js/beach.js (same coordinates, curves pre-sampled).
     ============================================================ */

  /* UMBRELLA_SVG, viewBox 0 0 120 168. Five wedges meeting at the
     tip (60,14), scalloped rim dips between the ribs. */
  const UMB_WEDGES = [
    { fill: PAL.petalPink, pts: [[60, 14]]
      .concat(quadPts([60, 14], [26, 24], [4, 60]), quadPts([4, 60], [15, 71], [26, 60])) },
    { fill: PAL.wedgeYellow, pts: [[60, 14], [26, 60]]
      .concat(quadPts([26, 60], [37, 71], [48, 60])) },
    { fill: PAL.petalPink, pts: [[60, 14], [48, 60]]
      .concat(quadPts([48, 60], [59, 71], [70, 60])) },
    { fill: PAL.wedgeYellow, pts: [[60, 14], [70, 60]]
      .concat(quadPts([70, 60], [81, 71], [92, 60])) },
    { fill: PAL.petalPink, pts: [[60, 14], [92, 60]]
      .concat(quadPts([92, 60], [103, 71], [116, 60]), quadPts([116, 60], [94, 24], [60, 14])) }
  ];

  /* SCALLOP_SVG, viewBox 0 0 100 76: fan outline + rib endpoints. */
  const SCALLOP_OUTLINE = [[50, 8]]
    .concat(
      cubicPts([50, 8], [26, 8], [8, 28], [6, 50]),
      cubicPts([6, 50], [20, 64], [36, 70], [50, 70]),
      cubicPts([50, 70], [64, 70], [80, 64], [94, 50]),
      cubicPts([94, 50], [92, 28], [74, 8], [50, 8])
    );
  const SCALLOP_RIB_ENDS = [[50, 65], [23, 56], [77, 56], [11, 42], [89, 42]];

  /* SPIRAL_SVG, viewBox 0 0 100 80: one thick/thin double stroke. */
  const SPIRAL_CURVE = [[12, 70]]
    .concat(
      cubicPts([12, 70], [24, 42], [44, 22], [62, 25]),
      cubicPts([62, 25], [84, 29], [90, 52], [73, 62]),
      cubicPts([73, 62], [60, 70], [45, 64], [44, 53]),
      cubicPts([44, 53], [43, 44], [52, 39], [59, 44])
    );

  /* Generic alternating-radius star ring: `points` tips (outer r
     rOut, inner valleys rIn), centred (cx, cy), first tip up + rot.
     Shared by the starfish prop and the ocean's 4-point glints
     (mission 3) — same cute geometry, different parameters. */
  function starPointRing(points, rOut, rIn, cx, cy, rot) {
    const steps = points * 2;
    const pts = [];
    for (let i = 0; i < steps; i++) {
      const angle = (TAU / steps) * i - Math.PI / 2 + rot;
      const r = i % 2 === 0 ? rOut : rIn;
      pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
    }
    return pts;
  }

  /* starfishMarkup(): 10 alternating-radius star points around
     (50,52); the SVG group's rotate(8 50 52) is baked in here. */
  const STAR_PTS = starPointRing(5, 34, 15, 50, 52, 0.35 + (8 * Math.PI) / 180);
  const STAR_DOTS = (function () {
    const a = (8 * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
    return [[50, 48, 3], [43, 57, 2.4], [58, 58, 2.4]].map(function (d) {
      const dx = d[0] - 50, dy = d[1] - 52;
      return [50 + dx * cos - dy * sin, 52 + dx * sin + dy * cos, d[2]];
    });
  })();

  /* ballMarkup() wedge color cycle. */
  const BALL_COLORS = [PAL.ballPink, PAL.ballYellow, PAL.ballAqua];

  /* Hibiscus petal centers (interpretation: the DOM flower is the
     🌺 emoji, so a cute 5-petal vector in palette pinks). */
  const FLOWER_PETALS = (function () {
    const pts = [];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (TAU / 5) * i;
      pts.push([30 + 15 * Math.cos(a), 30 + 15 * Math.sin(a)]);
    }
    return pts;
  })();

  /* Prop anchors — fractions copied from the .beach-* placement
     rules in css/style.css (left/right/bottom %, clamp sizes,
     the CSS rotate() transforms). */
  const PROPS = {
    /* hPct 0.62 + bottom 0.23: footprint is fy 0.15..0.77 on ANY
       aspect — canopy bottom lands at fy ≈ 0.42, above the swim/
       boat lane floor (0.46), pole foot planted just under the sand
       line. Previously width-sized from the sand: the canopy hung
       mid-sea and boats looked like they floated on the umbrella. */
    umbrella: { vb: [120, 168], left: 0.06, bottom: 0.23, min: 90, hPct: 0.62, max: 340 },
    shellA: { vb: [100, 76], left: 0.33, bottom: 0.09, min: 26, pct: 0.05, max: 62, rot: (-10 * Math.PI) / 180 },
    shellB: { vb: [100, 80], right: 0.30, bottom: 0.06, min: 24, pct: 0.046, max: 56, rot: (9 * Math.PI) / 180 },
    shellC: { vb: [100, 76], left: 0.47, bottom: 0.05, min: 20, pct: 0.036, max: 44, rot: (-4 * Math.PI) / 180, alpha: 0.96 },
    starfish: { vb: [100, 104], right: 0.15, bottom: 0.15, min: 28, pct: 0.055, max: 66, rot: (12 * Math.PI) / 180 },
    ball: { vb: [100, 100], right: 0.11, bottom: 0.08, min: 30, pct: 0.06, max: 74 },
    flower: { vb: [60, 60], left: 0.22, bottom: 0.06, min: 18, pct: 0.034, max: 34, rot: (-8 * Math.PI) / 180 }
  };

  /* Cloud + gull animation configs: heights are top % of the sky
     band (DOM % of .beach-sky, whose height is --sea-top + 2%),
     widths/periods/delays from .beach-cloud-N / .beach-gull-N.
     Travel span from the keyframes: clouds -32vw→122vw, gulls
     -18vw→120vw. `rest` = phase used under reduced motion, chosen
     so everything visible sits inside the scene. */
  const CLOUDS = [
    { topF: 0.16, min: 70, pct: 0.17, max: 190, period: 46, delay: 0, alpha: 0.92, rest: 0.30 },
    { topF: 0.44, min: 52, pct: 0.12, max: 140, period: 68, delay: 20, alpha: 0.84, rest: 0.62 },
    { topF: 0.70, min: 40, pct: 0.09, max: 110, period: 92, delay: 55, alpha: 0.76, rest: 0.85 }
  ];
  const GULLS = [
    { topF: 0.12, min: 20, pct: 0.04, max: 46, period: 34, delay: 0, rest: 0.45, phase: 0 },
    { topF: 0.26, min: 16, pct: 0.03, max: 36, period: 44, delay: 16, rest: 0.70, phase: 2.1 }
  ];

  /* ============================================================
     Ocean configs (mission 3) — the animated sea drawn over the
     static band. Fractions: yF positions INSIDE the sea band
     (0 = horizon, 1 = waterline, layout.seaY semantics);
     thickF/ampF/baseF/bottomF are fractions of stage HEIGHT;
     waveF is the wavelength as a fraction of stage WIDTH; period
     is the seconds for the phase to slide one full wavelength
     (dir alternates so neighbours drift past each other).
     Deepest ribbon hugs the horizon (thin, pale, slow); ribbons
     get brighter/livelier toward the shallows — the DOM
     .beach-wave-1..3 behaviour with one extra sheet added.
     ============================================================ */

  /* Deterministic [0,1) pseudo-random from two numbers (the GLSL
     fract(sin) trick) — sparkles/bubbles place themselves from it,
     so no state survives a frame and re-seeding is free. */
  function hash01(a, b) {
    const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* Sheet tints: pale blue near the horizon → pure white in the
     shallows (mixColor runs once at init). */
  const WAVE_COLORS = [
    mixColor(PAL.seaMid, PAL.cloud, 0.45),
    mixColor(PAL.seaMid, PAL.cloud, 0.65),
    mixColor(PAL.seaShallow, PAL.cloud, 0.80),
    PAL.cloud
  ];

  /* Scene art pass: nearer sheets get a bigger amplitude so the
     sea visibly steepens toward the shore. */
  const WAVES = [
    { yF: 0.10, thickF: 0.026, ampF: 0.004, waveF: 0.35, period: 27.0, dir: 1, alpha: 0.18, phase: 0.0 },
    { yF: 0.33, thickF: 0.032, ampF: 0.007, waveF: 0.28, period: 21.0, dir: -1, alpha: 0.22, phase: 2.1 },
    { yF: 0.57, thickF: 0.040, ampF: 0.013, waveF: 0.22, period: 16.0, dir: 1, alpha: 0.28, phase: 4.3 },
    { yF: 0.82, thickF: 0.048, ampF: 0.017, waveF: 0.18, period: 12.5, dir: -1, alpha: 0.35, phase: 1.2 }
  ];
  const RIB_SAMPLES = 36; // polyline segments per sheet (7 pts/wavelength min)

  /* Foam waterline straddling y = sandY(0): mean edge rides
     baseF*h ABOVE the sand line, swells with a main sine
     (~1.5% h, 8.4 s loop) plus a small faster harmonic and a
     smooth sin² SCALLOP term (rounded bulges along the baseline,
     scene art pass), fill extends bottomF*h INTO the sand.
     alpha mirrors .beach-foam's 0.92. foamTopAt stays THE shared
     waterline math — BeachGame.foamEdgeY and every rider keep
     sitting on the visible edge. wash* describe the translucent
     trailing strip that laps down the wet sand, driven by the
     same clock. */
  const FOAM = {
    baseF: 0.008,
    ampF: 0.015, waveF: 0.30, period: 8.4,
    harmF: 0.005, harmWaveF: 0.125, harmPeriod: 5.2, harmPhase: 1.7,
    scalF: 0.009, scalWaveF: 0.085, scalPeriod: 9.0,
    bottomF: 0.016,
    washF: 0.026, washLead: 0.010, washAlpha: 0.42,
    washPeriod: 6.4, washWaveF: 0.55, washPhase: 0.9,
    alpha: 0.92, samples: 40
  };

  /* 5 pop bubbles clinging to the foam edge; each swells and
     fades out over its `period` (deterministic hash01 phases —
     no state survives a frame), rides the live foam edge y, and
     jitters a few px sideways. */
  const FOAM_BUBBLES = (function () {
    const out = [];
    for (let i = 0; i < 5; i++) {
      out.push({
        fx: (i + 0.15 + 0.7 * hash01(i + 1, 31)) / 5, // even spread + jitter
        rF: 0.006 + 0.007 * hash01(i + 1, 57),
        period: 5.5 + 4.0 * hash01(i + 1, 83),
        phase: hash01(i + 1, 121),
        wob: hash01(i + 1, 151) * TAU
      });
    }
    return out;
  })();

  /* Sun halo + double-ring glow (scene art pass): radii × disc
     radius, sunGlow alpha steps — static bgG circles, softest
     outermost. HORIZON_AMPF is the wavy-horizon sine amplitude
     as a fraction of stage HEIGHT (floored to 2 px);
     HORIZON_WAVEF its wavelength as a fraction of stage WIDTH. */
  const SUN_HALO = [
    { rF: 2.35, alpha: 0.10 },
    { rF: 1.78, alpha: 0.13 },
    { rF: 1.34, alpha: 0.18 }
  ];
  const HORIZON_AMPF = 0.006;
  const HORIZON_WAVEF = 0.16;
  /* Per band: [top gap, thickness] in horizon-sine-amplitude
     units + darker-teal alpha. */
  const HORIZON_BANDS = [
    [0.9, 1.2, 0.16], [2.1, 1.5, 0.10], [3.6, 1.8, 0.065]
  ];

  /* Sun glints: 10 tiny 4-point stars over the upper 2/3 of the
     sea band, alpha pulsing 0 → 0.8 → 0 with per-glint period +
     phase, re-seeded (new random spots) every `reseed` seconds. */
  const SPARKS = {
    count: 10, reseed: 3.2,
    loF: 0.03, hiF: 0.66,          // sea-band fractions, upper 2/3
    sizeF: 0.0055, minSize: 2.5    // outer radius of the glint star
  };

  /* Static touches: darker line right at the horizon, and the
     "wet sand" the foam washes over (blend toward the brown grain
     hex, semi-opaque — reads as damp, not dirty). */
  const HORIZON_LINE = mixColor(PAL.seaDeep, 0x000000, 0.40);
  const WET_SAND = mixColor(PAL.sandTop, PAL.sandGrain, 0.55);

  /* Scene art pass 2 — prop shading + ground shadow tints. mixColor
     runs once at init (same pattern as WAVE_COLORS / WET_SAND above),
     so the static painters just reference finished hexes:
       SAND_MOUND  darker damp-sand tone the umbrella pole sits in
       POLE_SHADE  bamboo pole's dark side + base contact
       SHADOW_COOL translucent cool gray — umbrella canopy drop shadow
       SHADOW_PROP prop contact shadows (house ink blended cool, the
                   rig's shadow is plain ink @ 0.10 — same weight)
       SHELL_RIB   scallop inner ridge lines (rose pulled to ink)
       STAR_EDGE   starfish underside rim (orange pulled to ink) */
  const SAND_MOUND = mixColor(PAL.sandLow, PAL.sandGrain, 0.45);
  const POLE_SHADE = mixColor(PAL.pole, PAL.ink, 0.35);
  const SHADOW_COOL = mixColor(PAL.ink, PAL.cloudShade, 0.35);
  const SHADOW_PROP = mixColor(PAL.ink, PAL.cloudShade, 0.25);
  const SHELL_RIB = mixColor(PAL.shellRose, PAL.ink, 0.25);
  const STAR_EDGE = mixColor(PAL.starOrange, PAL.ink, 0.28);

  /* ============================================================
     Static passes — bands (+ horizon & wet-sand touches), sun
     disc on ONE Graphics; the small ground props on ANOTHER that
     sits above both per-frame layers (DOM z-order: props > sea);
     the umbrella on a THIRD front layer (depth 30) so actors —
     girl, duck, surf wave — always pass behind it. All are
     redrawn only on create()/resize.
     ============================================================ */

  /* Sun anchor in canvas px for the current layout. */
  function sunCenter() {
    return {
      x: layout.w * SUN.fx,
      y: layout.h * SUN.fy,
      r: Math.max(SUN.minR, layout.h * SUN.rF)
    };
  }

  /* {x,y} ring approximating an ellipse (no fillEllipse here). */
  function ellipsePts(cx, cy, rx, ry) {
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const a = (TAU / 14) * i;
      pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    }
    return pts;
  }

  /* Soft flattened ground-shadow ellipse — static pass only (props +
     umbrella repaint on create/resize), so ellipsePts's small ring
     allocation is as harmless here as in drawSunDisc. The rig uses
     the same trick for Lily's feet (js/beach-rig.js paintShadow:
     ink @ alpha 0.10), so props and character finally share one
     shadow language. */
  function shadowEllipse(g, x, y, rx, ry, color, alpha) {
    g.fillStyle(color, alpha);
    g.fillPoints(ellipsePts(x, y, rx, ry), true);
  }

  /* Two sparse dot grids over the sand — the .beach-sand
     radial-gradient texture: rgba(206,150,66,.28) r1.4 on a 26px
     grid at offset (4,6), and rgba(255,255,255,.40) r1.2 on a
     34px grid at offset (16,20). */
  function sandDots(g) {
    const top = layout.sandY(0);
    dotGrid(g, top, 26, 4, 6, 1.4, PAL.sandGrain, 0.28);
    dotGrid(g, top, 34, 16, 20, 1.2, PAL.sandGrainWhite, 0.40);
  }

  function dotGrid(g, top, size, offX, offY, r, color, alpha) {
    g.fillStyle(color, alpha);
    for (let x = offX % size; x < layout.w; x += size) {
      for (let y = top + (offY % size); y < layout.h; y += size) {
        g.fillCircle(x, y, r);
      }
    }
  }

  /* Soft halo + double-ring glow, then the disc itself (the
     tapered rays live in the animated pass). Scene art pass: the
     two largest translucent circles read as a warm glow, the
     faintest outer one as a very soft light halo.
      SVG units → canvas: the 120-unit box has disc r=27, so k is
      the px-per-SVG-unit factor for the drawn circles. */
  function drawSunDisc(g) {
    const sun = sunCenter();
    const k = sun.r / 27;
    for (let i = 0; i < SUN_HALO.length; i++) {
      g.fillStyle(PAL.sunGlow, SUN_HALO[i].alpha);
      g.fillCircle(sun.x, sun.y, sun.r * SUN_HALO[i].rF);
    }
    g.fillStyle(PAL.sunDisc, 1);
    g.fillCircle(sun.x, sun.y, sun.r);
    g.lineStyle(3 * k, PAL.sunEdge, 1);
    g.strokeCircle(sun.x, sun.y, sun.r);
    g.fillStyle(PAL.sunGlow, 0.9);
    g.fillPoints(ellipsePts(sun.x - 8 * k, sun.y - 10 * k, 10 * k, 7 * k), true);
  }

  /* Sand mound + bamboo pole + the five scalloped wedges + cream
     finial — same group order as UMBRELLA_SVG, plus the scene art
     pass 2 plant-in kit: a darker-sand mound the pole foot sits IN
     (with a lit crest + a dark contact ellipse so the base reads
     pressed into the beach), a shaded pole edge, alternating-panel
     wedge shading, a soft translucent over-rim on the scalloped
     outline, and the floating ball replaced by a knob stitched to
     the tip with a short ink stem. All static (umbrellaG repaints
     only on create/resize like before). */
  function paintUmbrella(g, ctx) {
    const s = ctx.s;
    const top = ctx.map(60, 14);
    const foot = ctx.map(60, 162);
    /* sand mound the pole is planted in — darker damp-sand tone,
       drawn under the pole so the shaft emerges from its centre */
    shadowEllipse(g, foot.x, foot.y, 17 * s, 5.2 * s, SAND_MOUND, 0.5);
    shadowEllipse(g, foot.x, foot.y - 1.6 * s, 10 * s, 3 * s, SAND_MOUND, 0.35);
    g.lineStyle(6 * s, PAL.pole, ctx.alpha);
    g.lineBetween(top.x, top.y, foot.x, foot.y);
    g.fillStyle(PAL.pole, ctx.alpha);
    g.fillCircle(top.x, top.y, 3 * s);
    g.fillCircle(foot.x, foot.y, 3 * s);
    /* pole shading: a darker strip down the side away from the
       high sun + the mound's contact shadow hugging the base */
    g.lineStyle(2 * s, POLE_SHADE, 0.75 * ctx.alpha);
    g.lineBetween(top.x + 1.8 * s, top.y + 5 * s, foot.x + 1.8 * s, foot.y - 1.2 * s);
    shadowEllipse(g, foot.x + 1.2 * s, foot.y + 0.8 * s, 5.2 * s, 1.8 * s, POLE_SHADE, 0.5);
    for (let i = 0; i < UMB_WEDGES.length; i++) {
      fillStrokeLocal(g, ctx, UMB_WEDGES[i].pts, UMB_WEDGES[i].fill, 3.5, PAL.ink);
    }
    /* alternating-panel shading: a thin ink veil over every second
       wedge (the yellows) so the canopy reads as round fabric */
    g.fillStyle(PAL.ink, 0.12);
    for (let i = 1; i < UMB_WEDGES.length; i += 2) {
      g.fillPoints(toWorld(ctx.map, UMB_WEDGES[i].pts), true);
    }
    /* soft dark rim: a wider translucent over-stroke of the same
       wedge outlines the hard 3.5 ink pass already draws */
    g.lineStyle(5.5 * s, PAL.ink, 0.16);
    for (let i = 0; i < UMB_WEDGES.length; i++) {
      g.strokePoints(toWorld(ctx.map, UMB_WEDGES[i].pts), true);
    }
    /* finial knob — attached to the tip with a short ink stem
       (was a ball hovering over the canopy seam) */
    const stem0 = ctx.map(60, 16);
    const stem1 = ctx.map(60, 10);
    g.lineStyle(2.6 * s, PAL.ink, 0.85);
    g.lineBetween(stem0.x, stem0.y, stem1.x, stem1.y);
    const f = ctx.map(60, 9);
    g.fillStyle(PAL.cream, ctx.alpha);
    g.fillCircle(f.x, f.y, 3.6 * s);
    g.lineStyle(2.6 * s, PAL.ink, ctx.alpha);
    g.strokeCircle(f.x, f.y, 3.6 * s);
  }

  /* Pink fan + five ribs radiating from the hinge (SCALLOP_SVG).
     Scene art pass 2: three thin darker ridge arcs running across
     the fan between the ribs (served by a soft shell-white dome
     highlight), so the flat pink reads as curved shell. */
  const SCALLOP_RIB_ORDER = [3, 1, 0, 2, 4];   // rib ends left→right
  const SCALLOP_ARC_FRACS = [0.42, 0.63, 0.84];
  function paintScallop(g, ctx) {
    fillStrokeLocal(g, ctx, SCALLOP_OUTLINE, PAL.shellPink, 5, PAL.shellRose);
    /* inner ridge arcs — hinge + f·(ribEnd − hinge), f < 1 keeps
       each chain safely inside the scalloped rim */
    g.lineStyle(1.5 * ctx.s, SHELL_RIB, 0.55 * ctx.alpha);
    for (let fi = 0; fi < SCALLOP_ARC_FRACS.length; fi++) {
      const f = SCALLOP_ARC_FRACS[fi];
      const arc = [];
      for (let k = 0; k < SCALLOP_RIB_ORDER.length; k++) {
        const e = SCALLOP_RIB_ENDS[SCALLOP_RIB_ORDER[k]];
        arc.push(ctx.map(50 + (e[0] - 50) * f, 14 + (e[1] - 14) * f));
      }
      g.strokePoints(arc, false);
    }
    const hinge = ctx.map(50, 14);
    g.lineStyle(3.5 * ctx.s, PAL.shellRose, ctx.alpha);
    g.fillStyle(PAL.shellRose, ctx.alpha);
    for (let i = 0; i < SCALLOP_RIB_ENDS.length; i++) {
      const end = ctx.map(SCALLOP_RIB_ENDS[i][0], SCALLOP_RIB_ENDS[i][1]);
      g.lineBetween(hinge.x, hinge.y, end.x, end.y);
      g.fillCircle(end.x, end.y, 1.75 * ctx.s); /* round-cap dot */
    }
    const hl = ctx.map(38, 32);
    g.fillStyle(PAL.shellWhite, 0.45 * ctx.alpha);
    g.fillPoints(ellipsePts(hl.x, hl.y, 7 * ctx.s, 3.8 * ctx.s), true);
  }

  /* Thick white stroke + thin lavender core on one path
     (SPIRAL_SVG) — candy-swirl look. Scene art pass 2: one extra
     inner spiral arc (same curve shrunk toward the eye) adds a
     second candy ridge so the swirl has depth instead of a single
     flat stripe. */
  const SPIRAL_EYE = [55, 48];        // visual centre of the curl
  const SPIRAL_INNER_K = 0.78;        // shrink of the extra arc
  function paintSpiral(g, ctx) {
    const wp = toWorld(ctx.map, SPIRAL_CURVE);
    const a = wp[0], b = wp[wp.length - 1];
    g.lineStyle(16 * ctx.s, PAL.shellWhite, ctx.alpha);
    g.strokePoints(wp, false);
    g.fillStyle(PAL.shellWhite, ctx.alpha);
    g.fillCircle(a.x, a.y, 8 * ctx.s);
    g.fillCircle(b.x, b.y, 8 * ctx.s);
    g.lineStyle(6 * ctx.s, PAL.shellLavender, ctx.alpha);
    g.strokePoints(wp, false);
    g.fillStyle(PAL.shellLavender, ctx.alpha);
    g.fillCircle(a.x, a.y, 3 * ctx.s);
    g.fillCircle(b.x, b.y, 3 * ctx.s);
    /* extra inner arc — thin, translucent lavender, sits inside
       the white band near the outer turns of the swirl */
    const k = SPIRAL_INNER_K, ex = SPIRAL_EYE[0], ey = SPIRAL_EYE[1];
    const inner = [];
    for (let i = 0; i < SPIRAL_CURVE.length; i++) {
      inner.push(ctx.map(
        ex + (SPIRAL_CURVE[i][0] - ex) * k,
        ey + (SPIRAL_CURVE[i][1] - ey) * k));
    }
    g.lineStyle(2.4 * ctx.s, PAL.shellLavender, 0.5 * ctx.alpha);
    g.strokePoints(inner, false);
  }

  /* Rounded 5-point star with three little dots (starfishMarkup).
     Scene art pass 2: a darker inner contour (0.86-scaled ring)
     reads as the underside edge catching shade, a short ridge line
     runs down each arm toward its tip, and the disc gets a centre
     dot to anchor the pattern. */
  function paintStarfish(g, ctx) {
    fillStrokeLocal(g, ctx, STAR_PTS, PAL.starOrange, 4, PAL.ink);
    const innerRing = [];
    for (let i = 0; i < STAR_PTS.length; i++) {
      innerRing.push(ctx.map(
        50 + (STAR_PTS[i][0] - 50) * 0.86,
        52 + (STAR_PTS[i][1] - 52) * 0.86));
    }
    g.lineStyle(2.2 * ctx.s, STAR_EDGE, 0.35 * ctx.alpha);
    g.strokePoints(innerRing, true);
    g.lineStyle(2.2 * ctx.s, PAL.starDot, 0.8 * ctx.alpha);
    for (let i = 0; i < 5; i++) {
      const tip = STAR_PTS[i * 2];      // even indices = outer tips
      const x0 = 50 + (tip[0] - 50) * 0.3, y0 = 52 + (tip[1] - 52) * 0.3;
      const x1 = 50 + (tip[0] - 50) * 0.72, y1 = 52 + (tip[1] - 52) * 0.72;
      const p0 = ctx.map(x0, y0), p1 = ctx.map(x1, y1);
      g.lineBetween(p0.x, p0.y, p1.x, p1.y);
    }
    const mid = ctx.map(50, 52);
    g.fillStyle(PAL.starDot, ctx.alpha);
    g.fillCircle(mid.x, mid.y, 3.2 * ctx.s);
    for (let i = 0; i < STAR_DOTS.length; i++) {
      const d = ctx.map(STAR_DOTS[i][0], STAR_DOTS[i][1]);
      g.fillCircle(d.x, d.y, STAR_DOTS[i][2] * ctx.s);
    }
  }

  /* Six color wedges around a cream hub (ballMarkup). The DOM
     ball's ±6° rotation is mid-bob keyframe, so the canvas ball
     sits unrotated. slice() maps directly: rot is 0 here, but the
     wedge angles still offset by ctx.rot for generality.
     Scene art pass 2: every seam between wedges is redrawn as a
     slightly bowed curve (alternating bulge so panels look inflated
     and round), and one squashed white blob up-left is the gloss. */
  function paintBall(g, ctx) {
    const c = ctx.map(50, 50);
    const r = 42 * ctx.s;
    for (let i = 0; i < 6; i++) {
      g.fillStyle(BALL_COLORS[i % 3], ctx.alpha);
      g.slice(c.x, c.y, r,
        -Math.PI / 2 + (Math.PI / 3) * i + ctx.rot,
        -Math.PI / 2 + (Math.PI / 3) * (i + 1) + ctx.rot);
      g.fillPath();
    }
    /* curved seams over the flat pie boundaries, hub → rim */
    g.lineStyle(1.8 * ctx.s, PAL.ink, 0.45 * ctx.alpha);
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (Math.PI / 3) * i + ctx.rot;
      const nx = Math.cos(a), ny = Math.sin(a);
      const bow = (i % 2 === 0 ? 1 : -1) * 0.2 * r;
      const sx = c.x + nx * 5 * ctx.s, sy = c.y + ny * 5 * ctx.s;
      const ex = c.x + nx * (r - 1.5), ey = c.y + ny * (r - 1.5);
      const cp = [c.x + nx * r * 0.55 - ny * bow, c.y + ny * r * 0.55 + nx * bow];
      g.strokePoints([{ x: sx, y: sy }].concat(
        toObjects(quadPts([sx, sy], cp, [ex, ey], 6))), false);
    }
    g.lineStyle(4 * ctx.s, PAL.ink, ctx.alpha);
    g.strokeCircle(c.x, c.y, r);
    g.fillStyle(PAL.cream, ctx.alpha);
    g.fillCircle(c.x, c.y, 6 * ctx.s);
    g.lineStyle(3 * ctx.s, PAL.ink, ctx.alpha);
    g.strokeCircle(c.x, c.y, 6 * ctx.s);
    /* gloss blob — high-left, opposite the contact shadow */
    g.fillStyle(PAL.shellWhite, 0.55 * ctx.alpha);
    g.fillPoints(ellipsePts(c.x - r * 0.42, c.y - r * 0.45,
      r * 0.2, r * 0.12), true);
  }

  /* Five pink petals, rose center, yellow-tipped stamen — the
     vector stand-in for the 🌺 emoji. Scene art pass 2: thin rose
     separators run out along the five lens lines where adjacent
     petal circles cross (bisector angles, r 6→19 in local units),
     and the centre disc gets a small yellow pistil dot. */
  function paintFlower(g, ctx) {
    for (let i = 0; i < FLOWER_PETALS.length; i++) {
      const p = ctx.map(FLOWER_PETALS[i][0], FLOWER_PETALS[i][1]);
      g.fillStyle(PAL.petalPink, ctx.alpha);
      g.fillCircle(p.x, p.y, 12 * ctx.s);
      g.lineStyle(2.5 * ctx.s, PAL.shellRose, ctx.alpha);
      g.strokeCircle(p.x, p.y, 12 * ctx.s);
    }
    g.lineStyle(1.6 * ctx.s, PAL.shellRose, 0.6 * ctx.alpha);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (TAU / 5) * i + (TAU / 10);
      const p0 = ctx.map(30 + Math.cos(a) * 6, 30 + Math.sin(a) * 6);
      const p1 = ctx.map(30 + Math.cos(a) * 19, 30 + Math.sin(a) * 19);
      g.lineBetween(p0.x, p0.y, p1.x, p1.y);
    }
    const mid = ctx.map(30, 30);
    g.fillStyle(PAL.shellRose, ctx.alpha);
    g.fillCircle(mid.x, mid.y, 7 * ctx.s);
    g.fillStyle(PAL.ballYellow, ctx.alpha);
    g.fillCircle(mid.x, mid.y, 2.6 * ctx.s);
    const tip = ctx.map(46, 12);
    g.lineStyle(2.5 * ctx.s, PAL.shellRose, ctx.alpha);
    g.lineBetween(mid.x, mid.y, tip.x, tip.y);
    g.fillStyle(PAL.ballYellow, ctx.alpha);
    g.fillCircle(tip.x, tip.y, 2.5 * ctx.s);
  }

  /* Background repaint: sky band → sea band → WAVY horizon (sky
     curtain + stacked teal depth bands) → sand texture → wet
     sand (two fading bands + shell specks) → sun + halo. Props
     moved to drawPropsLayer (mission 3) so the animated ocean can
     slide between them, exactly like the DOM stacking. Bands
     bleed 1px into each other so no hairline can open between
     gradient strips, same trick as the DOM layer bleed.
     Static — runs ONLY on create()/resize, so the wave sampling
     may allocate local point arrays freely (never per frame). */
  function drawStaticLayer(g) {
    if (!layout) return;
    g.clear();
    const w = layout.w;
    const h = layout.h;
    const seaY = layout.yFromTop(layout.seaTop);
    const sandY = layout.yFromTop(layout.sandTop);

    /* Wavy horizon (scene art pass, goal 3): the sea band is
       pushed hUp ABOVE the nominal line, then an opaque sky-low
       "curtain" with a sine bottom edge paints the excess back
       over — the sky/sea boundary is now a gentle wave, not a
       ruler line. hUp ≥ hAmp+2 guarantees the wave NEVER dips
       into the untouched gradient, so no hairline can open. */
    const hAmp = Math.max(2, h * HORIZON_AMPF);
    const hUp = hAmp + 2;
    const hK = TAU / (HORIZON_WAVEF * Math.max(w, 2));
    const horizonAt = function (x) {
      return seaY + hAmp * Math.sin(hK * x + 0.6);
    };

    gradientRect(g, 0, 0, w, seaY + 1, SKY_STOPS);
    gradientRect(g, 0, seaY - hUp, w, (sandY - seaY) + hUp + 1, SEA_STOPS);
    gradientRect(g, 0, sandY - 1, w, h - sandY + 1, SAND_STOPS);

    /* Sky curtain: straight top (inside the untouched gradient),
       wavy bottom = the horizon itself. */
    const HN = 32;
    const curtain = new Array(HN + 3);
    curtain[0] = { x: 0, y: seaY - hUp - 1 };
    curtain[1] = { x: w, y: seaY - hUp - 1 };
    for (let s = 0; s <= HN; s++) {
      const x = (w * s) / HN;
      curtain[2 + s] = { x: x, y: horizonAt(x) };
    }
    g.fillStyle(stopsColor(SKY_STOPS, 1), 1);
    g.fillPoints(curtain, true);

    /* Depth: three stacked translucent darker-teal sine bands
       clinging to the wavy line, thinner→wider, paler downward —
       the "deep water just under the horizon" cue. */
    for (let bi = 0; bi < HORIZON_BANDS.length; bi++) {
      const g0 = HORIZON_BANDS[bi][0] * hAmp;
      const g1 = g0 + HORIZON_BANDS[bi][1] * hAmp;
      const band = new Array((HN + 1) * 2);
      for (let s = 0; s <= HN; s++) {
        const x = (w * s) / HN;
        band[s] = { x: x, y: horizonAt(x) + g0 };
        band[2 * HN + 1 - s] = { x: x, y: horizonAt(x) + g1 };
      }
      g.fillStyle(HORIZON_LINE, HORIZON_BANDS[bi][2]);
      g.fillPoints(band, true);
    }

    sandDots(g);

    /* Wet sand (scene art pass, goal 7): TWO stacked translucent
       bands — a stronger one right at the waterline the animated
       foam washes over, fading through a paler second one into
       dry sand — plus a scattering of deterministic shell-speck
       dots (hash01, same as everything else here). */
    const wetH1 = Math.max(2, h * (FOAM.bottomF + 0.014));
    const wetH2 = Math.max(2, h * 0.030);
    g.fillStyle(WET_SAND, 0.55);
    g.fillRect(0, sandY, w, wetH1);
    g.fillStyle(WET_SAND, 0.22);
    g.fillRect(0, sandY + wetH1, w, wetH2);
    for (let i = 0; i < 12; i++) {
      const sx = hash01(i + 2, 17) * w;
      const sy = sandY + h * 0.006 + hash01(i + 2, 29) * (wetH1 + wetH2 * 0.6 - h * 0.012);
      const sr = 1.1 + 1.5 * hash01(i + 2, 43);
      g.fillStyle(i % 3 === 0 ? PAL.shellLavender
        : (i % 3 === 1 ? PAL.sandGrainWhite : PAL.shellPink), 0.45 + 0.3 * hash01(i + 2, 61));
      g.fillCircle(sx, sy, sr);
    }

    drawSunDisc(g);
  }

  /* Ground props on their own above-water layer — same paint
     order among themselves as before. The umbrella lives on its
     OWN front layer now (see drawUmbrellaLayer / depth 30), so
     these small props stay put: only the shells, starfish, ball
     and flower are drawn here, above the water and below actors.

     Scene art pass 2 — SHADOWS so nothing floats: the umbrella's
     cool-gray canopy shadow leads (everything else paints over
     it, and umbrellaG at depth 30 sits above this whole layer),
     then every sand prop gets a soft alpha-0.10 contact ellipse
     nudged slightly right+down under its footprint before it is
     drawn. Static — this layer only repaints on create/resize. */
  function shadowForProp(g, cfg, rxScale) {
    const geo = propGeom(cfg);
    const rx = geo.sizePx * rxScale;
    const ry = Math.max(2.5, rx * 0.26);
    shadowEllipse(g, geo.cx + rx * 0.18, geo.bottom + ry * 0.3,
      rx, ry, SHADOW_PROP, 0.10);
  }

  /* Canopy-width drop shadow on the sand around the pole foot.
     The umbrella is planted at local (60,162) of its 120×168 box
     (pole centre = bbox centre), so the shadow anchors straight
     below the canopy it falls from. */
  function drawUmbrellaShadow(g) {
    const geo = propGeom(PROPS.umbrella);
    const footY = geo.top + (162 / geo.vbH) * geo.pxH;
    shadowEllipse(g, geo.cx + geo.sizePx * 0.03, footY + geo.sizePx * 0.015,
      geo.sizePx * 0.5, Math.max(3.5, geo.sizePx * 0.055),
      SHADOW_COOL, 0.12);
  }

  function drawPropsLayer(g) {
    if (!layout) return;
    g.clear();
    drawUmbrellaShadow(g);
    shadowForProp(g, PROPS.shellA, 0.5);
    drawProp(g, PROPS.shellA, paintScallop);
    shadowForProp(g, PROPS.shellB, 0.44);
    drawProp(g, PROPS.shellB, paintSpiral);
    shadowForProp(g, PROPS.shellC, 0.5);
    drawProp(g, PROPS.shellC, paintScallop);
    shadowForProp(g, PROPS.starfish, 0.46);
    drawProp(g, PROPS.starfish, paintStarfish);
    shadowForProp(g, PROPS.ball, 0.4);
    drawProp(g, PROPS.ball, paintBall);
    shadowForProp(g, PROPS.flower, 0.46);
    drawProp(g, PROPS.flower, paintFlower);
  }

  /* The umbrella is a foreground prop planted in the sand, so it
     sits on its own layer at depth 30 — ABOVE every dynamic depth
     (water 0, boat back 13, ripples/board 14, rig 15, boat front
     and submerge 16). That keeps the girl, the duck and the surf
     wave passing BEHIND it, as a kid expects. Redrawn only on
     create()/resize like the other statics, never per frame. */
  function drawUmbrellaLayer(g) {
    if (!layout) return;
    g.clear();
    drawProp(g, PROPS.umbrella, paintUmbrella);
  }

  /* ============================================================
     Animated pass — sky: rays, clouds, gulls (animG); sea: the
     ocean below (waterG). Cleared and re-traced every frame —
     nothing else moves.
     ============================================================ */

  /* Reusable 5-point scratch ring for the sun rays (the animated
     pass must not allocate per frame, same rule as SCRATCH). */
  const RAY_PTS = (function () {
    const out = new Array(5);
    for (let i = 0; i < 5; i++) out[i] = { x: 0, y: 0 };
    return out;
  })();

  /* 10 rounded, slightly tapered rays (wide base → narrow tip
     with a raised round point), translucent sun-yellow, spinning
     with sun-spin's 60s period and breathing a 7.5s length pulse
     — both driven by the frame pass's `t` (waveTime), so under
     reduced motion (`frozen`) they park at rot 0, no pulse. */
  function drawSunRays(g, t, frozen) {
    const sun = sunCenter();
    const k = sun.r / 27;
    const rot = frozen ? 0 : t * (TAU / 60);
    const pulse = frozen ? 1 : 1 + 0.05 * Math.sin((TAU * t) / 7.5);
    const rIn = 31 * k;
    const rOut = 50 * k * pulse;
    const rTip = 52.5 * k * pulse;
    const wBase = 0.105, wTip = 0.032;
    g.fillStyle(PAL.sunRay, 0.85);
    for (let i = 0; i < 10; i++) {
      const a = (TAU / 10) * i + rot;
      RAY_PTS[0].x = sun.x + Math.cos(a - wBase) * rIn;
      RAY_PTS[0].y = sun.y + Math.sin(a - wBase) * rIn;
      RAY_PTS[1].x = sun.x + Math.cos(a - wTip) * rOut;
      RAY_PTS[1].y = sun.y + Math.sin(a - wTip) * rOut;
      RAY_PTS[2].x = sun.x + Math.cos(a) * rTip;
      RAY_PTS[2].y = sun.y + Math.sin(a) * rTip;
      RAY_PTS[3].x = sun.x + Math.cos(a + wTip) * rOut;
      RAY_PTS[3].y = sun.y + Math.sin(a + wTip) * rOut;
      RAY_PTS[4].x = sun.x + Math.cos(a + wBase) * rIn;
      RAY_PTS[4].y = sun.y + Math.sin(a + wBase) * rIn;
      g.fillPoints(RAY_PTS, true);
    }
  }

  /* One drifting cloud: four stacked puffs of different radii, a
     rounded body, cool underside — CLOUD_SVG shapes placed by
     hand (no rotation). Scene art pass: the extra small left puff
     breaks the plain blob silhouette into a fluffier one. */
  function drawCloud(g, x, y, s, alpha) {
    g.fillStyle(PAL.cloud, alpha);
    g.fillCircle(x + 34 * s, y + 38 * s, 13 * s);
    g.fillCircle(x + 55 * s, y + 27 * s, 21 * s);
    g.fillCircle(x + 88 * s, y + 23 * s, 23 * s);
    g.fillCircle(x + 114 * s, y + 35 * s, 16 * s);
    g.fillRoundedRect(x + 30 * s, y + 30 * s, 96 * s, 22 * s, 11 * s);
    g.fillStyle(PAL.cloudShade, alpha * 0.9);
    g.fillRoundedRect(x + 36 * s, y + 44 * s, 84 * s, 8 * s, 4 * s);
  }

  function drawClouds(g, t, frozen) {
    const bandH = (layout.seaTop + 0.02) * layout.h; /* .beach-sky height */
    for (let i = 0; i < CLOUDS.length; i++) {
      const c = CLOUDS[i];
      const sizePx = clampedSize(layout.w, c.min, c.pct, c.max);
      const p = frozen ? c.rest : ((t + c.delay) / c.period) % 1;
      const x = (-0.32 + 1.54 * p) * layout.w;   /* -32vw → 122vw */
      drawCloud(g, x, c.topF * bandH, sizePx / 150, c.alpha);
    }
  }

  /* Two-arc "m" silhouette with a gentle wing flap (the SVG's
     control points y 3 lift/lower) + the 2.6s bob; dots at the
     three key points fake SVG round line-caps. */
  function drawGull(g, x, y, s, flap) {
    const cy = 13 - 10 * flap;
    const local = [[5, 13]]
      .concat(quadPts([5, 13], [13, cy], [22, 11], 5),
        quadPts([22, 11], [31, cy], [39, 13], 5));
    const wp = [];
    for (let i = 0; i < local.length; i++) {
      wp.push({ x: x + local[i][0] * s, y: y + local[i][1] * s });
    }
    g.lineStyle(3.2 * s, PAL.gull, 1);
    g.strokePoints(wp, false);
    g.fillStyle(PAL.gull, 1);
    [0, 5, 10].forEach(function (i) {
      g.fillCircle(wp[i].x, wp[i].y, 1.6 * s);
    });
  }

  function drawGulls(g, t, frozen) {
    const bandH = (layout.seaTop + 0.02) * layout.h;
    for (let i = 0; i < GULLS.length; i++) {
      const gd = GULLS[i];
      const sizePx = clampedSize(layout.w, gd.min, gd.pct, gd.max);
      const s = sizePx / 44;
      const gh = 18 * s;
      const p = frozen ? gd.rest : ((t + gd.delay) / gd.period) % 1;
      const x = (-0.18 + 1.38 * p) * layout.w;  /* -18vw → 120vw */
      const bob = frozen ? 0 : Math.sin((TAU * t) / 2.6 + gd.phase) * 0.4 * gh;
      const flap = frozen ? 0.78 : 0.75 + 0.25 * Math.sin((TAU * t) / 0.9 + gd.phase);
      drawGull(g, x, gd.topF * bandH + bob, s, flap);
    }
  }

  /* ------------------------------------------------------------
     Ocean (mission 3) — drawn into waterG every frame. `amp`
     multiplies every sine amplitude: 0 under reduced motion, so
     all shapes collapse to their flat resting lines and nothing
     drifts, pulses or re-seeds.
     ------------------------------------------------------------ */

  /* Reusable polyline buffers (perf): the wave sheet and foam are
     re-traced EVERY frame; allocating fresh top/ring arrays + their
     point objects each frame was ~700 short-lived objects/frame — the
     bulk of the ocean pass's GC pressure (minor-GC jank on low-end
     tablets). fillPoints/strokePoints consume the points synchronously,
     and each draw completes before the next begins, so buffers keyed by
     segment count are safe to reuse across frames. */
  const SCRATCH = {};
  function getScratch(N) {
    let buf = SCRATCH[N];
    if (!buf) {
      buf = { top: new Array(N + 1), ring: new Array((N + 1) * 2) };
      for (let i = 0; i < N + 1; i++) buf.top[i] = { x: 0, y: 0 };
      for (let i = 0; i < (N + 1) * 2; i++) buf.ring[i] = { x: 0, y: 0 };
      SCRATCH[N] = buf;
    }
    return buf;
  }

  /* One undulating ribbon: sine-curve polyline of `thick` px,
     its lower edge wobbling a little out of phase so the sheet
     breathes, plus a brighter crest stroke along the top. */
  function drawWaveSheet(g, cfg, color, t, amp) {
    const w = layout.w, h = layout.h;
    const y0 = layout.seaY(cfg.yF);
    const k = TAU / (cfg.waveF * w);
    const A = cfg.ampF * h * amp;
    const drift = cfg.dir * (TAU * t) / cfg.period + cfg.phase;
    const thick = cfg.thickF * h;
    const N = RIB_SAMPLES;
    const sc = getScratch(N);
    const top = sc.top;
    const ring = sc.ring;
    for (let s = 0; s <= N; s++) {
      const x = (w * s) / N;
      const y = y0 + A * Math.sin(k * x + drift);
      const wob = amp ? Math.sin(k * x * 1.6 - drift * 0.7) * thick * 0.22 : 0;
      top[s].x = x; top[s].y = y;
      const b = ring[2 * N + 1 - s];
      b.x = x; b.y = y + thick + wob; // bottom, walked back
    }
    for (let s = 0; s <= N; s++) ring[s] = top[s];
    g.fillStyle(color, cfg.alpha);
    g.fillPoints(ring, true);
    g.lineStyle(Math.max(1, 0.0028 * h), color, Math.min(1, cfg.alpha + 0.28));
    g.strokePoints(top, false);
  }

  /* Foam top edge at canvas x — THE waterline math, shared by the
     drawer and BeachGame.foamEdgeY so riders sit on the drawn
     edge. Scene art pass adds the smooth sin² scallop term:
     rounded bulges along the sine baseline (a full period of the
     sin IS one scallop — no |sin| cusps). amp 0 → flat resting
     line just above the sand; w < 2 px (degenerate transition
     size) → same flat line, no kx blowup. */
  function foamTopAt(x, t, amp) {
    const shore = layout.sandY(0);
    const h = layout.h;
    const base = shore - FOAM.baseF * h;
    if (!amp || layout.w < 2) return base;
    const k = TAU / (FOAM.waveF * layout.w);
    const k2 = TAU / (FOAM.harmWaveF * layout.w);
    const k3 = TAU / (FOAM.scalWaveF * layout.w);
    const s3 = Math.sin(k3 * x - (TAU * t) / FOAM.scalPeriod);
    return base
      - FOAM.ampF * h * Math.sin(k * x - (TAU * t) / FOAM.period)
      - FOAM.harmF * h * Math.sin(k2 * x + (TAU * t) / FOAM.harmPeriod + FOAM.harmPhase)
      + FOAM.scalF * h * (s3 * s3 - 0.5);
  }

  /* Foam band bottom — the constant wet line the wash hangs off
     (sandY + bottomF·h), mirrored here so wash and band agree. */
  function foamBottomAt() {
    return layout.sandY(0) + FOAM.bottomF * layout.h;
  }

  /* Main foam band: from the animated scalloped top edge down to
     a flat bottom inside the wet strip, with a crisp crest stroke
     on the edge. */
  function drawFoam(g, t, amp) {
    const w = layout.w;
    const h = layout.h;
    const bottom = foamBottomAt();
    const N = FOAM.samples;
    const sc = getScratch(N);
    const top = sc.top;
    const ring = sc.ring;
    for (let s = 0; s <= N; s++) {
      const x = (w * s) / N;
      top[s].x = x; top[s].y = foamTopAt(x, t, amp);
      const b = ring[2 * N + 1 - s];
      b.x = x; b.y = bottom;
    }
    for (let s = 0; s <= N; s++) ring[s] = top[s];
    g.fillStyle(PAL.cloud, FOAM.alpha);
    g.fillPoints(ring, true);
    g.lineStyle(Math.max(1, 0.0035 * h), PAL.cloud, 1);
    g.strokePoints(top, false);
  }

  /* Trailing wash (scene art pass, goal 6): a translucent strip
     hanging below the foam band whose BOTTOM edge — the visible
     waterline on the sand — laps up and down the beach on a slow
     6.4 s cycle with a gentle travelling undulation, driven by
     the same wavePhase clock. Deterministic + frozen-safe (amp 0
     collapses it to a resting strip). Drawn BELOW the foam band,
     whose opaque scallops cover the shared top region. */
  function drawFoamWash(g, t, amp) {
    const w = layout.w, h = layout.h;
    const N = FOAM.samples;
    const sc = getScratch(N);
    const top = sc.top;
    const ring = sc.ring;
    const shore = layout.sandY(0);
    const k = TAU / (FOAM.washWaveF * w);
    const osc = (TAU * t) / FOAM.washPeriod + FOAM.washPhase;
    for (let s = 0; s <= N; s++) {
      const x = (w * s) / N;
      top[s].x = x; top[s].y = foamTopAt(x, t, amp) + FOAM.washLead * h;
      const wv = amp ? 0.5 + 0.5 * Math.sin(k * x + osc) : 0.55;
      const b = ring[2 * N + 1 - s];
      b.x = x;
      b.y = shore + (FOAM.bottomF + FOAM.washF * (0.35 + 0.65 * wv)) * h;
    }
    for (let s = 0; s <= N; s++) ring[s] = top[s];
    g.fillStyle(PAL.cloud, FOAM.washAlpha);
    g.fillPoints(ring, true);
  }

  /* Two bright gloss dashes riding nearer wave sheets (goal 4):
     small rounded rects sampled straight off the sheet's own sine
     so they stay ON the stripe while sliding shore-ward slowly.
     t is waveTime — pinned to 0 under reduced motion, so frozen
     means one static highlight, no motion. */
  function drawGlossDashes(g, t, amp) {
    const w = layout.w, h = layout.h;
    for (let i = 0; i < 2; i++) {
      const cfg = WAVES[2 + i];
      const k = TAU / (cfg.waveF * w);
      const A = cfg.ampF * h * amp;
      const drift = cfg.dir * (TAU * t) / cfg.period + cfg.phase;
      const p = ((t / (cfg.period * 0.9) + i * 0.55) % 1.14) - 0.07;
      const x = p * w;
      const y = layout.seaY(cfg.yF) + A * Math.sin(k * x + drift) + cfg.thickF * h * 0.3;
      const len = Math.max(16, w * 0.045);
      const th = Math.max(2, h * 0.004);
      g.fillStyle(PAL.cloud, 0.5);
      g.fillRoundedRect(x, y - th / 2, len, th, th / 2);
    }
  }

  /* Occasional bubble POP dots at the waterline (goal 6): each
     slot swells then fades out over its own period — visible only
     in its first 60% — positioned deterministically from hash01
     + the shared clock, riding foamTopAt so it never detaches.
     Frozen: calm resting dots mid-life, no jitter. */
  function drawFoamBubbles(g, t, amp) {
    for (let i = 0; i < FOAM_BUBBLES.length; i++) {
      const b = FOAM_BUBBLES[i];
      const u = amp ? (t / b.period + b.phase) % 1 : 0.45;
      if (amp && u > 0.6) continue;             // popped — resting slot
      const life = amp ? u / 0.6 : 0.75;
      const x = b.fx * layout.w + (amp ? Math.sin(t * 1.3 + b.wob) * 0.006 * layout.w : 0);
      const rBase = Math.max(2, b.rF * layout.h);
      const r = rBase * (0.45 + 0.55 * life);
      const y = foamTopAt(x, t, amp) - r * 0.35;
      g.fillStyle(PAL.cloud, amp ? 0.75 * (1 - life * life) : 0.45);
      g.fillCircle(x, y, r);
    }
  }

  /* 4-point glints, reused starPointRing geometry at ~4 px outer
     radius. Positions come from hash01(index, seed) with
     seed = floor(t / reseed) → whole set re-rolls every few
     seconds without keeping any state; alpha is a squared sine
     pulse (0 → 0.8 → 0) with per-glint period/phase so they
     twinkle out of step. Frozen: seed 1, steady 0.48 alpha. */
  function drawSparkles(g, t, amp) {
    const seed = amp ? Math.floor(t / SPARKS.reseed) : 1;
    for (let i = 0; i < SPARKS.count; i++) {
      const px = hash01(i * 3 + 1, seed * 7 + 2);
      const py = hash01(i * 3 + 2, seed * 7 + 5);
      const ps = hash01(i * 3 + 3, seed * 7 + 9);
      const x = px * layout.w;
      const y = layout.seaY(SPARKS.loF + py * (SPARKS.hiF - SPARKS.loF));
      const size = Math.max(SPARKS.minSize, SPARKS.sizeF * layout.h * (0.7 + 0.6 * ps));
      const pulse = amp
        ? Math.pow(Math.max(0, Math.sin(TAU * (t / (1.4 + 1.8 * ps)) + px * TAU)), 2)
        : 0.6;
      if (pulse <= 0.02) continue;
      const ring = starPointRing(4, size, size * 0.34, x, y, ps * 0.9);
      g.fillStyle(i % 2 === 0 ? PAL.sunGlint : PAL.cloud, 0.8 * pulse);
      g.fillPoints(toObjects(ring), true);
    }
  }

  /* Full ocean frame, back to front: deep sheets → gloss dashes
     → trailing wash → scalloped foam band → pop bubbles → glints.
     Guarded against the 1-px transition sizes Scale.RESIZE can
     hand us mid-animation. */
  function drawOcean(g, t, frozen) {
    if (layout.w < 2 || layout.h < 2) return;
    const amp = frozen ? 0 : 1;
    for (let i = 0; i < WAVES.length; i++) {
      drawWaveSheet(g, WAVES[i], WAVE_COLORS[i], t, amp);
    }
    drawGlossDashes(g, t, amp);
    drawFoamWash(g, t, amp);
    drawFoam(g, t, amp);
    drawFoamBubbles(g, t, amp);
    drawSparkles(g, t, amp);
  }

  /* ============================================================
     Public ocean hooks — read the module state the frame pass
     publishes (waveTime / waveAmp), so callers always agree with
     what was drawn this frame even when the pass is frozen.
     ============================================================ */

  /* Current animated foam-top y (px from stage top) at fractional
     x (0..1); null before the scene has a usable size. */
  function foamEdgeY(fx) {
    if (!layout || layout.w < 2 || layout.h < 2) return null;
    const f = Number(fx);
    const x = (isFinite(f) ? Math.max(0, Math.min(1, f)) : 0) * layout.w;
    return foamTopAt(x, waveTime, waveAmp);
  }

  /* Global ocean time scalar in seconds (0 under reduced motion). */
  function wavePhase() {
    return waveTime;
  }

  /* ============================================================
     Locomotion (mission 7) — press-and-hold pointer control.

     ALL motion math lives in FRACTIONAL stage units so the one
     pure tick below is unit-testable without Phaser or a DOM:
     stepLocomotion is module-scope only and reaches a Node test
     harness through the CommonJS seam at the bottom of this
     IIFE — it is deliberately NOT on window.

     Per frame (BEFORE BeachRig.update, which poses whatever this
     section pushed): step toward the held target, then drive the
     rig — speed from ACTUAL displacement ÷ zone max (so the
     ease-out near the target slows the gait cycle, not just the
     stride), stance by zone × moving (pushed only on CHANGE —
     setStance resets the phase, calling it every frame would
     freeze the walk), anchor + local waterline per the table in
     driveRig(), facing from the sign of horizontal motion, and a
     splash whenever she crosses the sea boundary.

     Waterline choice, documented per mission: in open sea there
     is no foam line above her — BeachGame.foamEdgeY() is the
     animated SHORE wash only — so swim/float treat HER OWN
     anchor fy as the local water surface: she carries her
     surface plane with her and the mission 6 submersion
     composite always breaks the body at her hip line. Wade uses
     the real animated foam edge at her fx (that IS the visible
     surface there); stand/walk clear it entirely.

       Speeds (in ASPECT-CORRECTED "screen-equivalent" units where
       1.0 dist = ONE STAGE WIDTH in either direction — a full-width
       crossing ≈ 3.3 s of swim, 4.0 s of walk):
         sand 0.25 · foam 0.18 · sea 0.30.
      Vertical drags used to be measured by raw dy, which the short
      stage height shrinks to ~53% of the on-screen distance the
      same fx fraction covers — that read as "near" under the old
      0.20 ease radius and crawled. Now dy is divided by the stage
      aspect (w/h) before measuring dist, ease only applies inside
      a SMALL radius (0.07 = 7% of stage width), and a speed FLOOR
      (0.45) keeps her moving briskly whenever a real target is
      held; she still snaps to a stop inside LOCO_STOP_DIST.
      ============================================================ */

  const LOCO_SPEED = { sand: 0.25, foam: 0.18, sea: 0.30 };
  const LOCO_EASE_RANGE = 0.07;   // corrected dist below which speed eases toward the floor
  const LOCO_MIN_SPEED = 0.45;    // speed floor while a real target is held — never crawls
  const LOCO_STOP_DIST = 0.018;   // "close enough" — she stops there (corrected units)
  /* Playable box: fx keeps her off both stage edges; fy can never
     climb above seaTop+0.02 (the horizon is not swimmable — that
     is the "sea bottom" clamp, far side of the band) nor sink
     past 0.98. Mission text's seaTop+0.04 = 0.46 shows up
     separately as the swim/float rig-anchor FLOOR in driveRig. */
  const LOCO_BOX = { fxMin: 0.04, fxMax: 0.96, fyPad: 0.02, fyMax: 0.98 };
  /* swim/float rig-anchor floor (seaTop fallback 0.42 + 0.04):
     the prone crown/hair must never poke into the sky band. */
  const LOCO_SEA_ANCHOR_FLOOR = 0.46;
  /* Rest spot on open: fx mid-stage, 12% down the sand band —
     KEPT IN SYNC with the rig.attach default in beach-rig.js
     (same 0.12); initLocomotion also adopts rig.getAnchor() when
     the rig is already attached, so the two can never disagree. */
  const LOCO_REST_F = 0.12;

  function locoNum(v, fallback) {
    return (typeof v === "number" && isFinite(v)) ? v : fallback;
  }

  function locoClamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /* Zone from fractional stage y. Foam band = sandTop-0.06 up to
     sandTop+0.02; above it sea, below it sand. */
  function zoneAtFy(fy, sandTop) {
    if (fy > sandTop + 0.02) return "sand";
    if (fy > sandTop - 0.06) return "foam";
    return "sea";
  }

  /* ONE pure locomotion tick. NEVER mutates its inputs.
       state      {anchor:{fx,fy}} (a bare {fx,fy} also accepted)
       target     {fx,fy} | null  (null = no destination → stop)
       dt         seconds; <=0/non-finite → no motion
       layoutFrac {seaTop,sandTop,aspect} | null (null on a
                  zero-size layout — the scene passes null until
                  it has a real measured size; safe no-op then.
                  aspect = stage w/h; missing/invalid → 1, which
                  degrades to the legacy raw-fraction metric)
      Returns {anchor, arrived, zone, moveDirX}:
       anchor    new clamped fractional position (stale anchors
                 are re-clamped into the box every tick, so a
                 resize can never leave her parked off-stage)
       arrived   within LOCO_STOP_DIST of the CLAMPED target, or
                 nothing could move her (no target / bad dt)
       zone      zone of the RETURNED anchor fy — speed is chosen
                 from where she IS at the tick start
       moveDirX  fx/SECOND of horizontal motion (sign = facing;
                 flips when a steering drag crosses her x) */
  function stepLocomotion(state, target, dt, layoutFrac) {
    const src = (state && state.anchor) ? state.anchor : state;
    const ax = locoNum(src && src.fx, NaN);
    const ay = locoNum(src && src.fy, NaN);
    const seaTop = layoutFrac ? locoNum(layoutFrac.seaTop, NaN) : NaN;
    const sandTop = layoutFrac ? locoNum(layoutFrac.sandTop, NaN) : NaN;
    /* Aspect correction: fx 1.0 spans the stage WIDTH, fy 1.0 the
       HEIGHT (~53% of it on a 1200×640 stage). Dividing dy by
       aspect re-expresses a vertical step in width-normalised
       "screen-equivalent" units, so dist, easing and the step all
       measure the SAME on-screen speed in every direction. */
    const aspectRaw = layoutFrac ? locoNum(layoutFrac.aspect, NaN) : NaN;
    const aspect = (isFinite(aspectRaw) && aspectRaw > 0) ? aspectRaw : 1;
    /* re-clamped start position (also the pass-through for every
       early return — garbage in, anchor unchanged out) */
    const fx0 = locoClamp(locoNum(ax, 0.5), LOCO_BOX.fxMin, LOCO_BOX.fxMax);
    const fy0 = (isFinite(seaTop))
      ? locoClamp(locoNum(ay, 0.8), seaTop + LOCO_BOX.fyPad, LOCO_BOX.fyMax)
      : locoNum(ay, 0.8);
    const zone0 = (isFinite(sandTop)) ? zoneAtFy(fy0, sandTop) : "sand";
    const idle = {
      anchor: { fx: fx0, fy: fy0 }, arrived: true, zone: zone0, moveDirX: 0
    };
    const usable = isFinite(ax) && isFinite(ay) &&
      isFinite(seaTop) && isFinite(sandTop) && sandTop > seaTop &&
      typeof dt === "number" && isFinite(dt) && dt > 0;
    if (!usable || !target) return idle;

    const fyMin = seaTop + LOCO_BOX.fyPad;
    /* clamp the DESTINATION too: measuring distance to an
       unreachable point would pin her at the box edge pushing
       forever instead of arriving */
    const tx = locoClamp(locoNum(target.fx, fx0), LOCO_BOX.fxMin, LOCO_BOX.fxMax);
    const ty = locoClamp(locoNum(target.fy, fy0), fyMin, LOCO_BOX.fyMax);
    const dx = tx - fx0, dy = ty - fy0;
    const dxS = dx;
    const dyS = dy / aspect;          // screen-equivalent (width units)
    const dist = Math.sqrt(dxS * dxS + dyS * dyS);
    if (dist < LOCO_STOP_DIST) return idle;   // stop where she is

    /* Floor + small ease radius: a held target always drives her at
       ≥ LOCO_MIN_SPEED of zone speed; only the last 7% of stage
       width eases, and inside stop-dist she snaps — no long crawl. */
    const speedFactor = locoClamp(
      LOCO_MIN_SPEED + (1 - LOCO_MIN_SPEED) * Math.min(1, dist / LOCO_EASE_RANGE),
      LOCO_MIN_SPEED, 1);
    const v = (LOCO_SPEED[zone0] || LOCO_SPEED.sand) * speedFactor;
    const step = v * dt;
    /* v·dt ≤ 0.30·0.1 = 0.03 while dist ≥ 0.018, so a long/degraded
       frame CAN overshoot — snap-arrive so she stops exactly on the
       clamped target instead of pushing past it. */
    if (step >= dist) {
      return {
        anchor: { fx: tx, fy: ty }, arrived: true,
        zone: zoneAtFy(ty, sandTop), moveDirX: (tx - fx0) / dt
      };
    }
    /* advance along the corrected unit direction in width units;
       the fy component converts back to fy fractions (× aspect)
       so the fy delta stays in fy units. */
    const nx = fx0 + (dxS / dist) * step;
    const ny = locoClamp(fy0 + (dyS / dist) * step * aspect, fyMin, LOCO_BOX.fyMax);
    return {
      anchor: { fx: nx, fy: ny }, arrived: false,
      zone: zoneAtFy(ny, sandTop), moveDirX: (nx - fx0) / dt
    };
  }

  /* ---------- live locomotion state (owned by the scene frames) ------
     Everything resets on open (initLocomotion, from create()) and on
     close (resetLocomotion) — nothing stale survives a cycle. */
  const loco = {
    enabled: true,
    anchor: null,      // {fx,fy} current — null = game closed
    target: null,      // {fx,fy} destination, null = stopped
    targetSrc: null,   // who owns the target: "pointer" (wireLocomotion)
                       // | "program" (locomotion.setTarget) — mission 8
    pointerId: null,   // tracked pointer id, null = none held
    stance: null,      // last stance pushed to the rig (change-only)
    prevZone: null,
    moving: false,
    clock: 0,          // ms timestamp of the last frame (ripple t0s)
    ripples: [],       // press/splash markers, spliced on expiry
    rippleG: null,     // depth-14 Graphics (below rig 15, above props)
    seed: 1            // splash jitter counter (hash01-fed)
  };

  /* Fractions for stepLocomotion, or null while the canvas has no
     usable size — the tick then no-ops (zero-size guard). aspect
     = w/h feeds the locomotion step's screen-equivalent units. */
  function locoBoxFrac() {
    return (layout && layout.w >= 2 && layout.h >= 2)
      ? { seaTop: layout.seaTop, sandTop: layout.sandTop, aspect: layout.w / layout.h }
      : null;
  }

  function initLocomotion() {
    const R = window.BeachRig;
    const ra = (R && R.isAttached && R.isAttached() && R.getAnchor)
      ? R.getAnchor() : null;
    const sandTop = layout ? layout.sandTop : SAND_TOP_FALLBACK;
    loco.anchor = ra
      ? { fx: ra.fx, fy: ra.fy }
      : { fx: 0.5, fy: sandTop + LOCO_REST_F * (1 - sandTop) };
    loco.target = null;
    loco.targetSrc = null;
    loco.pointerId = null;
    loco.enabled = true;
    loco.stance = "stand";     // rig.attach starts on 'stand'
    loco.prevZone = zoneAtFy(loco.anchor.fy, sandTop);
    loco.moving = false;
    loco.ripples.length = 0;
  }

  function resetLocomotion() {
    loco.anchor = null;
    loco.target = null;
    loco.targetSrc = null;
    loco.pointerId = null;
    loco.stance = null;
    loco.prevZone = null;
    loco.moving = false;
    loco.ripples.length = 0;
    loco.rippleG = null;       // scene owns it; destroyed with the game
    loco.enabled = true;
  }

  /* ---------- ripple markers (depth 14) ---------- */

  /* Marker size reference: the smaller stage dimension, floored so
     tiny transition sizes still draw something. */
  function rippleScale() {
    if (!layout) return 64;
    return Math.max(48, Math.min(layout.w, layout.h));
  }

  function trimRipples() {
    while (loco.ripples.length > 24) loco.ripples.shift();
  }

  function spawnPressRipple(px, py) {
    loco.ripples.push({ kind: "press", x: px, y: py, t0: loco.clock, life: 0.7 });
    trimRipples();
  }

  /* Shore-crossing splash: 3 offset expanding rings (staggered) +
     6 white dots arcing up on a parabola — cheap and kid-cute.
     Purely visual; the juice pass (mission 11) may replace it. */
  function spawnSplash(anchor) {
    if (!layout || !anchor) return;
    const p = layout.px(anchor.fx, anchor.fy);
    const rings = [];
    for (let k = 0; k < 3; k++) {
      rings.push({
        dx: (k - 1) * 0.035, dy: 0.006 * k,
        delay: 0.06 * k, r0: 0.02 + 0.015 * k, r1: 0.10 + 0.05 * k
      });
    }
    const dots = [];
    for (let d = 0; d < 6; d++) {
      const a = hash01(loco.seed + d, 7);
      const b = hash01(loco.seed + d, 11);
      const c = hash01(loco.seed + d, 13);
      dots.push({
        vx: (a - 0.5) * 0.5,               // RS px/sec sideways
        vy: 0.30 + 0.28 * b,               // RS px/sec up
        g: 0.85,                           // RS px/sec² down
        r: 0.004 + 0.004 * c,              // RS radius
        rest: -0.055 - 0.03 * a            // reduced-motion parked y (RS)
      });
    }
    loco.seed++;
    loco.ripples.push({
      kind: "splash", x: p.x, y: p.y, t0: loco.clock,
      life: 0.9, rings: rings, dots: dots
    });
    trimRipples();
  }

  /* Re-traced every frame (cleared + redrawn), splices expired
     entries back-to-front. Under reduced motion: static shapes —
     fixed radius rings and parked dots — the alpha fade stays, it
     is input feedback, not decoration. */
  function drawRipples(timeMs) {
    const g = loco.rippleG;
    if (!g) { loco.ripples.length = 0; return; }
    g.clear();
    if (!loco.ripples.length) return;
    const rm = reducedMotion();
    const RS = rippleScale();
    const arr = loco.ripples;
    for (let i = arr.length - 1; i >= 0; i--) {
      const r = arr[i];
      const age = (timeMs - r.t0) / 1000;
      if (!(age >= 0) || age >= r.life) { arr.splice(i, 1); continue; }
      const u = age / r.life;
      const fade = (1 - u) * (1 - u);
      if (r.kind === "press") {
        const rad = (rm ? 0.06 : 0.02 + 0.10 * u) * RS;
        g.lineStyle(Math.max(1.5, 0.008 * RS), PAL.cloud, 0.7 * fade + 0.05);
        g.strokeCircle(r.x, r.y, rad);
      } else {
        for (let k = 0; k < r.rings.length; k++) {
          const ring = r.rings[k];
          const span = 1 - ring.delay;
          const uu = locoClamp((u - ring.delay) / span, 0, 1);
          const rad = (rm ? ring.r0 + 0.5 * (ring.r1 - ring.r0)
                          : ring.r0 + (ring.r1 - ring.r0) * uu) * RS;
          const a = (1 - uu) * (1 - uu);
          g.lineStyle(Math.max(1.2, 0.006 * RS), PAL.cloud, 0.6 * a);
          g.strokeCircle(r.x + ring.dx * RS, r.y + ring.dy * RS, rad);
        }
        for (let d = 0; d < r.dots.length; d++) {
          const dot = r.dots[d];
          const x = r.x + dot.vx * RS * age;
          const y = rm ? r.y + dot.rest * RS
                       : r.y + (-dot.vy * age + dot.g * age * age) * RS;
          g.fillStyle(PAL.cloud, 0.85 * fade);
          g.fillCircle(x, y, Math.max(1.5, dot.r * RS * (1 - 0.4 * u)));
        }
      }
    }
  }

  /* ---------- push this tick's result into the rig ---------- */

  /* Stance / waterline / anchor decision table (zone = stepLocomotion):
       zone | moving → stance | rig anchor fy        | waterline fy
       -----+------------------+--------------------+---------------------------
       sea  | yes   → swim     | max(anchor.fy,0.46)| the rig anchor fy (own
          | no    → float    |                    | surface plane — see above)
       foam | yes   → wade     | anchor.fy (feet)   | foamEdgeY(fx)/h (real wash)
          | no    → stand    | anchor.fy (feet)   | null (stand clears it)
       sand | yes   → walk     | anchor.fy (feet)   | null
          | no    → stand    | anchor.fy (feet)   | null
     speed01 = actual |Δanchor|/dt ÷ zone max (ease-out shows up
     as a slower gait). setStance fires on CHANGE ONLY. */
  function driveRig(res, speed01) {
    const R = window.BeachRig;
    if (!R || !R.isAttached || !R.isAttached() || !res.anchor) return;
    R.setSpeed(locoClamp(speed01, 0, 1));
    const moving = loco.moving;
    let stance;
    if (res.zone === "sea") stance = moving ? "swim" : "float";
    else if (res.zone === "foam") stance = moving ? "wade" : "stand";
    else stance = moving ? "walk" : "stand";
    /* Always compare against the RIG's ACTUAL stance — loco.stance
       is only a hint; hijacking modules (boat 'ride', surf 'surf')
       change the pose while we are disabled, and comparing with the
       real value self-heals the first frame after they hand back. */
    if (typeof R.getStance === "function" ? R.getStance() !== stance : stance !== loco.stance) {
      R.setStance(stance);
    }
    loco.stance = stance;
    const rigY = (res.zone === "sea")
      ? Math.max(res.anchor.fy, LOCO_SEA_ANCHOR_FLOOR)
      : res.anchor.fy;
    R.setAnchor(res.anchor.fx, rigY);
    if (stance === "swim" || stance === "float") {
      R.setWaterline(rigY);   // she carries her own waterline (see top)
    } else if (stance === "wade") {
      const fe = foamEdgeY(res.anchor.fx);
      R.setWaterline((fe != null && layout) ? fe / layout.h : res.anchor.fy);
    } else {
      R.setWaterline(null);
    }
    if (Math.abs(res.moveDirX) > 0.004) R.setFlip(res.moveDirX < 0);
  }

  /* ---------- per-frame entry (called BEFORE BeachRig.update) ------ */
  /* Locomotion advances in REAL TIME even when frames are long
     (scene-boot WebGL/art-build hitches, GC pauses, slow tablets):
     we substep the elapsed time in ≤1/60s slices instead of the old
     single dt-clamped tick. Without this, every dropped frame ate
     wall-clock distance — the "she walks too slow right when the
     beach opens" bug the kid reported. Slices are cheap (a pure
     math step), capped per frame so a tab-out can never teleport
     her across the world in one visual jump. */
  const LOCO_SLICE = 1 / 60;
  const LOCO_FRAME_CAP = 0.5;

  function locoFrame(timeMs, deltaMs) {
    loco.clock = timeMs;
    if (loco.enabled && loco.anchor) {
      const frac = locoBoxFrac();
      const elapsed = locoClamp(locoNum(deltaMs, 0) / 1000, 0, LOCO_FRAME_CAP);
      /* a real tick needs time AND a measured stage — on a
         degenerate frame nothing moves and we must NOT eat the
         held target */
      const realTick = elapsed > 0 && frac != null;
      const asp = (frac && isFinite(frac.aspect) && frac.aspect > 0) ? frac.aspect : 1;
      let remaining = realTick ? elapsed : 0;
      let last = null;
      let moved = 0;
      while (remaining > 1e-6) {
        const dt = Math.min(LOCO_SLICE, remaining);
        remaining -= dt;
        const prev = loco.anchor;
        const res = stepLocomotion({ anchor: prev }, loco.target, dt, frac);
        loco.anchor = res.anchor;
        loco.moving = !res.arrived;
        /* arrived (or nothing to do) → drop the destination: holding
           still must NOT keep pushing, and drag-steering just sets a
           fresh target on the next pointermove */
        if (res.arrived && realTick) {
          loco.target = null;
          loco.targetSrc = null;   // mission 8: program targets self-clear on arrival
        }
        /* on-screen displacement in the SAME aspect-corrected width
           units the tick moves in, for the gait drive */
        moved += Math.hypot(res.anchor.fx - prev.fx, (res.anchor.fy - prev.fy) / asp);
        /* water entry/exit splash — checked PER SUBSTEP so a catch-up
           frame that crosses the shoreline still splashes exactly
           there (sand↔foam alone is just wet feet) */
        if (loco.prevZone && loco.prevZone !== res.zone &&
            (res.zone === "sea") !== (loco.prevZone === "sea")) {
          spawnSplash(res.anchor);
        }
        loco.prevZone = res.zone;
        last = res;
        if (res.arrived) break;
      }
      if (!last) {
        last = { anchor: loco.anchor, arrived: true,
                 zone: loco.prevZone || "sand", moveDirX: 0 };
      }
      const vel = (elapsed > 0 && loco.moving) ? moved / elapsed : 0;
      driveRig(last, vel / (LOCO_SPEED[last.zone] || LOCO_SPEED.sand));
    }
    drawRipples(timeMs);
  }

  /* Pointer wiring — ONE pointer, first-down wins until up, so a
     second finger can never hijack or double-target. Release =
     stop where she is (kinder than coasting to a stale destination).
     Handlers live on scene.input, so game.destroy(true) removes
     them with the game; every path still guards layout/anchor. */
  function wireLocomotion(scene) {
    const heldFrac = function (p) {
      if (!layout || layout.w < 2 || layout.h < 2) return null;
      return layout.fx(p.x, p.y);   // {x,y} = fractions of the stage
    };
    scene.input.on("pointerdown", function (p) {
      if (!loco.enabled || loco.pointerId !== null || !loco.anchor) return;
      const f = heldFrac(p);
      if (!f) return;
      loco.pointerId = p.id;
      loco.clock = scene.time.now;
      loco.target = { fx: f.x, fy: f.y };
      loco.targetSrc = "pointer";
      spawnPressRipple(p.x, p.y);
    });
    scene.input.on("pointermove", function (p) {
      if (p.id !== loco.pointerId || !p.isDown) return;
      const f = heldFrac(p);
      if (!f) return;
      loco.target = { fx: f.x, fy: f.y };   // drag to steer
      loco.targetSrc = "pointer";
    });
    const up = function (p) {
      if (p.id !== loco.pointerId) return;
      loco.pointerId = null;
      /* Release = stop here — but ONLY when the held destination came
         from this pointer (mission 8): a PROGRAMMATIC target (the tap-
         the-duck-boat auto-swim via locomotion.setTarget) must survive
         release; it self-clears on arrival in locoFrame, so existing
         setTarget users are unaffected. */
      if (loco.targetSrc === "pointer") {
        loco.target = null;
        loco.targetSrc = null;
      }
    };
    scene.input.on("pointerup", up);
    scene.input.on("pointerupoutside", up);
  }

  /* ---------- BeachGame.locomotion public surface ---------- */

  function locoGetAnchor() {
    return loco.anchor ? { fx: loco.anchor.fx, fy: loco.anchor.fy } : null;
  }

  function locoIsMoving() {
    return !!(loco.enabled && loco.moving);
  }

  function locoSetEnabled(b) {
    const on = !!b;
    if (on === loco.enabled) return;
    loco.enabled = on;
    const R = window.BeachRig;
    const ra = (R && R.isAttached && R.isAttached() && R.getAnchor)
      ? R.getAnchor() : null;
    if (!on) {
      loco.target = null;
      loco.targetSrc = null;
      loco.pointerId = null;
      loco.moving = false;
      if (R && R.isAttached && R.isAttached()) R.setSpeed(0);
    } else if (ra) {
      /* resume where the rider parked her — the boat dropped her
         off somewhere; adopt it instead of teleporting back */
      loco.anchor = { fx: ra.fx, fy: ra.fy };
      loco.stance = null;   // force the zone-appropriate stance push
      loco.prevZone = null; // no free splash on resume
    }
  }

  function locoSetTarget(fx, fy) {
    if (!loco.enabled || !loco.anchor || !locoBoxFrac()) return false;
    const x = locoNum(fx, NaN), y = locoNum(fy, NaN);
    if (!isFinite(x) || !isFinite(y)) return false;
    loco.target = { fx: x, fy: y };   // stepLocomotion clamps to the box
    loco.targetSrc = "program";       // survives pointerup (mission 8)
    return true;
  }

  /* ============================================================
      WorldArt glue — owns the three static layers (bgG, propsG,
      umbrellaG) plus the two per-frame layers (sky animG, sea
      waterG) and the redraw policy (statics on resize, frames
      every update, one frozen resting frame under reduced
      motion). Creation order below IS the paint order: bg → sky
      anim → ocean → props on top (DOM z-order: sea 2 < props 4);
      the umbrella then sits on its own depth-30 layer, in front
      of every dynamic depth (boardG/ripples 14, rig 15, boat
      front/submerge 16, surf wave 6) so nothing ever covers it.
      ============================================================ */

  function createWorldArt(scene) {
    const bgG = scene.add.graphics();
    const animG = scene.add.graphics();
    const waterG = scene.add.graphics();
    const propsG = scene.add.graphics();
    const umbrellaG = scene.add.graphics().setDepth(30);
    let frozen = false; // resting frame already drawn under reduced motion

    return {
      /* called from measure() whenever the layout changed */
      relayout: function () {
        drawStaticLayer(bgG);
        drawPropsLayer(propsG);
        drawUmbrellaLayer(umbrellaG); // static between resizes
        frozen = false; // force the animated pass to redraw at the new size
      },
      /* called every frame from update() */
      frame: function (timeMs) {
        const rm = reducedMotion();
        /* publish ocean time even when frozen/size-pending, so
           foamEdgeY()/wavePhase() never serve stale live motion */
        waveTime = (!layout || rm) ? 0 : timeMs / 1000;
        waveAmp = rm ? 0 : 1;
        if (!layout) return; // no size yet — draw nothing
        if (rm && frozen) return;
        animG.clear();
        waterG.clear();
        const t = waveTime;
        drawSunRays(animG, t, rm);
        drawClouds(animG, t, rm);
        drawGulls(animG, t, rm);
        drawOcean(waterG, t, rm);
        frozen = rm;
      }
    };
  }

  /* ============================================================
      WorldScene — built lazily so a missing Phaser global can never
      throw at parse time.
      ============================================================ */

  /* Scene shutdown (destroy) releases the rig's Phaser refs. */
  function detachRig() {
    if (window.BeachRig) window.BeachRig.detach();
  }

  function createWorldSceneClass() {
    return class WorldScene extends Phaser.Scene {
      constructor() {
        super("beach-world");
      }

      create() {
        /* art must exist before the first measure(): measure()
           triggers the very first static draw. */
        this.art = createWorldArt(this);
        this.measure();
        /* Scale.RESIZE keeps this.scale.width/height glued to the
           host box, so one listener covers window resizes, rotation,
           and the overlay appearing at a new size. */
        this.scale.on("resize", this.measure, this);
        /* character rig (mission 4+): lazy — the module only needs
           to exist by the time create() runs, not at parse time. */
        if (window.BeachRig) {
          window.BeachRig.attach(this);
          this.events.once("shutdown", detachRig);
          /* mission 6 submersion compositing: one per-frame layer
             directly ABOVE the rig (root depth 15) — the wash tints
             the submerged body half + waterline break. Cleared and
             re-painted every frame; stays EMPTY whenever the rig
             has no submerge info (land stance, no waterline, or
             detached mid-frame). */
          this.submergeG = this.add.graphics().setDepth(16);
        }
        /* mission 7: locomotion — ripple markers on their own
           layer (depth 14: above props/water, BELOW the rig 15 and
           the submerge composite 16, so splashes read as being
           behind/around her, and press markers never hide the
           kid). Init AFTER rig.attach so the rest anchor adopts
           the rig's own default (the two are kept in sync). */
        loco.rippleG = this.add.graphics().setDepth(14);
        initLocomotion();
        wireLocomotion(this);
        /* mission 8: the duck boat (js/beach-boat.js). Attach AFTER
           rig + locomotion wiring: its own pointerdown listener then
           runs after locomotion's (a tap on the hull both sets a walk/
           swim destination AND invites her to board), and frame()
           takes the anchor over around the ride. Null-safe — the
           module may simply not be loaded. */
        if (window.BeachBoat) window.BeachBoat.attach(this);
        /* mission 9: surfing (js/beach-surf.js). Attach after the
           boat: it registers the canvas 🏄 Catch-the-wave activity,
           spawns its rideable wave on depth 6 / board on depth 14,
           and takes the rig anchor over for a ride (locomotion
           disabled) exactly like the boat does. Null-safe. */
        if (window.BeachSurf) window.BeachSurf.attach(this);
      }

      /* Rebuild the shared layout object (also BeachGame.layout())
         and repaint the static world at the new size.
         Zero/partial sizes are possible mid-boot — keep the last
         known layout instead of publishing a broken one. */
      measure() {
        const w = this.scale.width;
        const h = this.scale.height;
        if (!(w > 0 && h > 0)) return;
        const bands = measureBands();
        const seaTop = bands.seaTop;    // horizon, fraction from stage top
        const sandTop = bands.sandTop;  // waterline, fraction from stage top
        layout = {
          w: w,
          h: h,
          seaTop: seaTop,
          sandTop: sandTop,
          /* fraction-of-stage point → pixel point */
          px: function (fx, fy) { return { x: fx * w, y: fy * h }; },
          /* pixel point → fraction-of-stage point */
          fx: function (x, y) { return { x: x / w, y: y / h }; },
          /* fraction of HEIGHT → canvas y measured from the top */
          yFromTop: function (f) { return f * h; },
          /* fraction of WIDTH → canvas x measured from the left */
          xFromLeft: function (f) { return f * w; },
          /* fraction inside the SEA band: 0 = horizon, 1 = waterline */
          seaY: function (f) { return (seaTop + f * (sandTop - seaTop)) * h; },
          /* fraction inside the SAND band: 0 = waterline, 1 = bottom */
          sandY: function (f) { return (sandTop + f * (1 - sandTop)) * h; }
        };
        if (this.art) this.art.relayout();
        if (window.BeachRig) window.BeachRig.onResize();
      }

      update(time, delta) {
        if (this.art) this.art.frame(time);
        /* mission 7: compute WHERE she is this frame and push the
           stance/anchor/speed/waterline into the rig BEFORE
           BeachRig.update poses it. */
        locoFrame(time, delta);
        /* mission 8: the boat runs AFTER locomotion (so it can adopt
           her anchor the frame she boards) and BEFORE BeachRig.update
           (so a ride pushes stance/anchor/speed/facing before the rig
           poses this frame — locoFrame itself is skipped while she
           rides, locomotion is disabled). */
        if (window.BeachBoat) window.BeachBoat.frame(time, delta);
        /* mission 9: surfing runs after the boat (never both at once —
           each module's input handlers bail while the OTHER rides) and
           BEFORE BeachRig.update so the surf stance is pushed then
           posed this frame. */
        if (window.BeachSurf) window.BeachSurf.frame(time, delta);
        if (window.BeachRig) window.BeachRig.update(time, delta);
        /* mission 6: submersion compositing, AFTER the rig posed so
           info reflects this frame's hip position. Detached-safe:
           getSubmergeInfo() -> null whenever unattached / no waterline
           / land stance, and paintSubmerge() no-ops on null. */
        if (window.BeachRig && this.submergeG) {
          this.submergeG.clear();
          const info = window.BeachRig.getSubmergeInfo();
          if (info) window.BeachRig.paintSubmerge(this.submergeG, info);
        }
      }
    };
  }

  /* ============================================================
     Lifecycle
     ============================================================ */

  /* Boot the canvas inside the given stage element. Idempotent:
     a second open() while one is running is a no-op. */
  function open(stageEl) {
    if (game) return;
    if (!stageEl || !window.Phaser) return;

    hostEl = document.createElement("div");
    hostEl.className = "beach-game-host";
    hostEl.setAttribute("aria-hidden", "true"); // pure decoration so far
    stageEl.appendChild(hostEl);

    game = new window.Phaser.Game({
      type: window.Phaser.AUTO,          // WebGL → canvas fallback
      parent: hostEl,
      backgroundColor: 0x000000,         // ignored while transparent
      render: { antialias: true, transparent: true },
      scale: {
        mode: window.Phaser.Scale.RESIZE,
        autoRound: false
      },
      scene: createWorldSceneClass()
    });
  }

  /* Full teardown: destroy(true) removes Phaser's canvas and every
     listener/RAF it owns; we remove the host div we created and drop
     the shared layout so nothing stale survives a close/open cycle.
     Safe to call when never opened. */
  function close() {
    if (game) {
      try {
        game.destroy(true);
      } catch (e) {
        /* already half-destroyed — nothing left to release */
      }
      game = null;
    }
    /* the scene's shutdown hook normally detaches the rig; belt and
       braces in case destroy() threw before firing it. */
    if (window.BeachRig) window.BeachRig.detach();
    if (window.BeachBoat) window.BeachBoat.detach();   // mission 8, same belt
    if (window.BeachSurf) window.BeachSurf.detach();   // mission 9, same belt
    if (hostEl && hostEl.parentNode) {
      hostEl.parentNode.removeChild(hostEl);
    }
    hostEl = null;
    layout = null;
    waveTime = 0;      // drop ocean state too — foamEdgeY() guards on
    waveAmp = 0;       // layout anyway, but nothing stale may linger
    resetLocomotion(); // mission 7: pointer/anchor/ripples reset per visit
  }

  function isOpen() {
    return !!game;
  }

  function getLayout() {
    return layout;
  }

  window.BeachGame = {
    open: open,
    close: close,
    isOpen: isOpen,
    layout: getLayout,
    reducedMotion: reducedMotion,
    foamEdgeY: foamEdgeY,
    wavePhase: wavePhase,
    locomotion: {
      getAnchor: locoGetAnchor,
      setEnabled: locoSetEnabled,
      isMoving: locoIsMoving,
      setTarget: locoSetTarget
    }
  };

  /* Headless-test seam: expose the PURE tick + constants to a Node
     `require` (unit tests, mission 7 acceptance harness) WITHOUT
     putting them on window. In a browser `module` is undefined, so
     the whole block is inert and nothing about the shipped surface
     changes. stepLocomotion itself reads no window/layout/DOM. */
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      stepLocomotion: stepLocomotion,
      LOCO_SPEED: LOCO_SPEED,
      LOCO_EASE_RANGE: LOCO_EASE_RANGE,
      LOCO_MIN_SPEED: LOCO_MIN_SPEED,
      LOCO_STOP_DIST: LOCO_STOP_DIST,
      LOCO_BOX: LOCO_BOX,
      zoneAtFy: zoneAtFy
    };
  }
})();
