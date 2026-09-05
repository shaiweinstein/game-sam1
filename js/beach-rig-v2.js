/* ============================================================
   Lily's Dress-Up Adventure — Beach character rig V2 (flat
   parts + tiny forward-kinematics pass), feature-flagged
   drop-in replacement.

      This is the "rig v2" integration: instead of the hand-drawn
      nested-Container vector kid in js/beach-rig.js (or the
      SkelForm armature in js/beach-rig-skf.js), it rasterizes
      the 12 clean SVG parts from window.BeachParts
      (js/beach-parts.js) — one square canvas per part with the
      part's PIVOT JOINT at the exact canvas center, limbs
      straightened to hang down (+y) — and renders them as a
      FLAT LIST of Phaser sprites inside ONE Container. A tiny
      forward-kinematics (FK) pass re-poses those sprites every
      frame from the 13 named bones in BeachParts.SKELETON, so
      the whole character is just sprites positioned + rotated
      in container-local viewBox units.

      FEATURE FLAG (default OFF — the old procedural rig is the
      fallback): at the very bottom this module overwrites
      window.BeachRig with THIS rig ONLY when
        window.__useRig2 === true
        or the URL has a `rig2` key (e.g. ?rig2=1)
      Otherwise it leaves window.BeachRig (set by beach-rig.js)
      alone. Load order in index.html: beach-rig.js first, then
      beach-parts.js + this file, so the flag can overwrite.

    CONTRACT — identical public surface to the old BeachRig:
        attach(scene) detach() isAttached() onResize()
        update(timeMs, dtMs) setStance(name) getStance()
        setSpeed(v) getSpeed() setFlip(bool) setCharacter(id)
        setSuitColors({...}) setAnchor(fx,fy) getAnchor()
        waterlineOffset() setWaterline(fy|null)
        getSubmergeInfo() paintSubmerge(g, info) defineStance(name, def)
      plus the joints / root / geo getters (root is the rig
      container; joints & geo are null — there is no procedural
      skeleton here).

    POSITIONING (matches the old rig's placeRoot contract):
        • S  = character height in px = clamp(100, 0.30*layout.h, 210),
               the SAME S the old rig uses.
        • root is a Phaser.Container placed at the HIP point. Its
          position = anchorPx + rootOffset (rootOffset in px, per
          stance), recomputed every frame via placeRoot() from the
          fractional anchor — never write root.x/.y by hand.
        • The parts live in a 400x400 y-down "viewBox" space with
          the hip at (200, 250), the feet at y=342 and the head
          top at y=44 (METRICS.height = 298 units, METRICS.
          hipAboveFeet = 92). The container is scaled by
          K = S / METRICS.height (px per viewBox unit) so the
          character is S px tall, and the hip sits
          (hipAboveFeet/height) ≈ 0.3087*S above the feet anchor
          (rootOffset (0, -0.3087*S) for the upright stances) so
          the soles land on the anchor.
        • Each part sprite lives in container-local VIEWBOX
          UNITS, at its bone's FK world position relative to the
          hip with the bone's FK world rotation. The canvas pivot
          IS the sprite origin (setOrigin 0.5,0.5 + scale
          1/RENDER_SCALE), so placement is exact; the container's
          K (and ±K for facing) turns those into px, so the
          sprites are never re-scaled by S per frame.

    ANIMATION (this step):
        `stand` (upright on sand, gentle breathing), `walk` (sand
        side-scroll gait) and `wade` (shallow water) have
        apply(); float/swim/ride/surf still fall back to stand's
        pose — those ports land in a later step. ctx.setAngle()
        maps the old rig's joint names onto the v2 bones (torso ->
        root, head -> neck, shoulderF -> shoulderR, ...; unknown
        names ignored). Sign convention (uniform): localRot =
        -angleDeg * PI/180 — a positive limb angle swings the limb
        toward the facing direction (+x screen unflipped), which
        for a down-hanging limb is a counter-clockwise screen
        rotation, i.e. NEGATIVE Phaser rotation. Same sign for
        torso/head: a positive torso angle tips the crown toward
        the facing direction.
        GAIT: a per-stance cycle rate (CYCLES[name].hz(speed))
        drives a module phase accumulator in [0,1) plus a
        cycleCount; ALL gait terms derive from the phase — never
        the raw clock — so setSpeed() changes never snap the
        pose. ctx also carries { phase, cycleHz, cycleParity }.
        POSE BLENDING: stances write TARGET angles; the FK reads
        a blended `cur` pose. In steady state cur IS the target,
        exactly — no per-frame low-pass, so the gait runs at full
        amplitude and zero lag. A stance change (setStance on an
        ACTUAL change) freezes the current blended pose/root/
        shadow into an `xfade` snapshot and, for a short window
        (0.22 s, smoothstep-eased), lerps cur from the snapshot
        to the new stance's per-frame targets (shortest-arc
        wrapDeg on the joints so a joint never spins across the
        ±180 seam; no wrap on the root offset or shadow alpha).
        After the window cur snaps to the targets exactly.
        dt<=0 and reduced motion snap instead of crossfading.
        GROUND SHADOW: a scene Graphics at depth 14 (just under
        the rig's 15), redrawn every frame as a soft ellipse at
        the FEET anchor; per-stance alpha (land stances 1, water
        0) crossfades with the same stance-change window and
        drawing is skipped below 0.01.
        update() advances the module clock by dt (clamped 0..0.1s)
        and re-poses; reduced motion (BeachGame.reducedMotion())
        zeroes the amplitude, holds the clock at 0 and parks the
        gait phase at the stance's value — the static base pose.

    SUITS / CHARACTERS (this step):
        setCharacter / setSuitColors are present for API parity
        and store their state; they are read at build time to
        choose the BeachParts palette, but a live re-render on
        change is a later task.

    The module is lazy: it touches window.BeachGame /
    window.GameState / window.CHARACTERS / window.BeachParts only
    at call time, never at parse time, so its <script> order only
    needs to be AFTER beach-rig.js (so the flag can overwrite)
    and AFTER beach-parts.js (for the palette/part data).
    ============================================================ */

(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  /* ---------- rig constants ---------- */
  const RENDER_SCALE = 2;            // canvas px per viewBox unit (BeachParts.render scale)
  const TEX_PREFIX = "beachrig2_";   // texture key prefix; keys = <prefix><gen>_<partId>
  const ROOT_DEPTH = 15;             // same depth the old rig's root uses
  const SHADOW_DEPTH = 14;           // ground shadow sits just under the rig
  const XFADE_DUR = 0.22;            // s; stance-change crossfade window
  const REST_Y = -0.3087;            // resting root offset (fraction of S), upright stances

  /* Fallback if BeachParts.METRICS is ever missing; keeps the math
     pure and parse-free (BeachParts is read at call time only). */
  const METRICS_FALLBACK = { hipX: 200, hipY: 250, feetY: 342, headTopY: 44, height: 298, hipAboveFeet: 92 };

  /* ---------- module state (reset by attach / detach) ---------- */
  let scene = null;        // WorldScene the rig is attached to
  let rig = null;          // { root, S, K, bones, bonesByName, tSec, rootOff, poseTgt, poseCur, rootTgt, rootCur }
  let texKeys = [];        // texture keys added by the current build (removed in detach)
  let genCounter = 0;      // increments per build so texture keys stay unique
  let anchor = { fx: 0.5, fy: 0.82 };         // fractional anchor (feet / waterline)
  let charId = "lily";
  let stanceName = "stand";
  let flipped = false;
  let speed = 0;
  let waterlineFy = null;
  let loading = false;
  let loadToken = 0;       // guards against a stale async render building a dead scene
  let phase = 0;           // gait phase in [0,1) — the only clock for gait terms
  let cycleCount = 0;      // completed gait cycles (parity = F/B limb pairing)
  let shadowG = null;      // scene Graphics for the ground shadow (depth 14)
  let shadowCur = 1;       // blended shadow alpha (per-stance target: land 1, water 0)
  /* Stance-change crossfade state: a FROZEN snapshot of the current
     blended pose (per-joint angles), root offset (fractions of S)
     and shadow alpha at the last ACTUAL stance change. For
     xfade.dur seconds after the change, blendPose lerps cur from
     this snapshot to the new stance's per-frame targets (eased by
     smoothstep); in steady state cur is an exact copy of the
     targets. Inactive at attach / first build (snap). */
  let xfade = {
    active: false,
    t: 0,
    dur: XFADE_DUR,
    pose: {},                 // frozen poseCur (deg, old-rig joint names)
    root: { x: 0, y: REST_Y },// frozen rootCur (fractions of S)
    shadow: 1                 // frozen shadowCur
  };

  /* Suit state (mission 14 hook) — stored; read at build time to
     build the BeachParts palette (live re-render is a later task). */
  let suit = { main: 0xffd93d, trim: 0xff9a3d, bottom: 0xffd93d, twoPiece: false };
  const SUIT_DEFAULT = { main: "#ffd93d", trim: "#ff9a3d", bottom: "#ffd93d", twoPiece: false };

  /* ---------- tiny pure helpers (load-free, no DOM) ---------- */

  function num(v, fallback) {
    return (typeof v === "number" && isFinite(v)) ? v : fallback;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  /* Wrap a degree delta into [-180, 180) — the shortest arc, so a
     joint easing toward a target across the ±180 seam does not
     spin the long way round. */
  function wrapDeg(d) {
    let x = d % 360;
    if (x >= 180) x -= 360;
    if (x < -180) x += 360;
    return x;
  }

  /* Smoothstep easing on u in [0,1] (zero first/second derivative at
     the ends) — the stance-change crossfade curve. */
  function smoothstep(u) {
    return u * u * (3 - 2 * u);
  }

  function hexInt(v, fallback) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string") {
      const m = /^#?([0-9a-fA-F]{6})$/.exec(v.trim());
      if (m) return parseInt(m[1], 16);
    }
    return fallback;
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

  function currentWaveTime() {
    const B = window.BeachGame;
    return (B && typeof B.wavePhase === "function") ? num(B.wavePhase(), 0) : 0;
  }

  /* {x,y} ring approximating an ellipse — same convention as the old
     rig / beach-game.js (14 points), used by paintSubmerge. */
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

  /* BeachParts metrics, read lazily (fallback keeps the math safe). */
  function metrics() {
    const P = window.BeachParts;
    return (P && P.METRICS) ? P.METRICS : METRICS_FALLBACK;
  }

  /* Fraction of S the hip sits above the feet anchor:
     METRICS.hipAboveFeet / METRICS.height ≈ 0.3087. */
  function hipFrac() {
    const m = metrics();
    return m.hipAboveFeet / m.height;
  }

  /* ---------- sizing + placement (old-rig contract) ---------- */

  function computeS() {
    const L = layoutNow();
    const h = L ? L.h : (scene && scene.scale ? scene.scale.height : 0);
    return clamp(0.30 * (num(h, 0) || 467), 100, 210);
  }

  /* Registry of the seven known stance names (the same keys the old
     / skf rig exposes). THIS STEP: every stance uses the upright
     offset (hip hipFrac()*S above the feet anchor, so the soles sit
     on the anchor); per-stance offsets land with the gait/surf port
     — the structure is already per-stance. */
  const STANCE_OFFSETS = {
    stand: true,
    float: true,
    walk: true,
    wade: true,
    swim: true,
    ride: true,
    surf: true
  };

  function stanceOffset(name) {
    /* This step: all stances use the upright offset. */
    return { x: 0, y: -hipFrac() };
  }

  function anchorPx() {
    const L = layoutNow();
    if (!L) return null;
    return L.px(clamp(anchor.fx, 0, 1), clamp(anchor.fy, 0, 1));
  }

  /* root.position = anchorPx + rootOffset (px). The offset is the
     BLENDED current root offset (rootCur, fractions of S) — eased
     each frame toward the stance's per-frame target (the stance's
     resting offset, overridden by setRootOffset). The container
     origin IS the hip point. */
  function placeRoot() {
    if (!rig) return;
    const pt = anchorPx();
    if (!pt) return;
    rig.rootOff.x = rig.rootCur.x * rig.S;
    rig.rootOff.y = rig.rootCur.y * rig.S;
    rig.root.setPosition(pt.x + rig.rootOff.x, pt.y + rig.rootOff.y);
  }

  /* container scale K = S / METRICS.height (px per viewBox unit);
     facing mirrors X (the same ±1-X trick as the old rig's setFlip). */
  function applyContainerScale() {
    if (!rig) return;
    const K = rig.S / metrics().height;
    rig.K = K;
    rig.root.setScale(flipped ? -K : K, K);
  }

  /* ---------- stances + angle mapping ---------- */

  /* Old-rig joint name -> v2 bone name. `torso` drives the ROOT bone
     (the whole body pivots at the hip); `head` drives `neck`. The
     F/B names map onto the R/L bones (F = facing = +x unflipped = R).
     Unknown names are ignored by setAngle. */
  const ANGLE_TO_BONE = {
    torso: "root",
    head: "neck",
    shoulderF: "shoulderR",
    shoulderB: "shoulderL",
    elbowF: "elbowR",
    elbowB: "elbowL",
    hipF: "hipR",
    hipB: "hipL",
    kneeF: "kneeR",
    kneeB: "kneeL",
    hairBack: "hairBack",
    hairFront: "hairFront"
  };
  const JOINT_NAMES = Object.keys(ANGLE_TO_BONE);   // the pose-blend joint set

  /* Per-stance gait cycle: hz(v) = cycles per second at speed v;
     park = the phase held under reduced motion (k=0). update()
     advances the module `phase` by dt*hz(speed) and counts full
     cycles — gait terms always derive from phase, never raw t. */
  const CYCLES = {
    stand: { hz: function (v) { return 0.6; }, park: 0 },
    float: { hz: function (v) { return 0.6; }, park: 0 },
    walk:  { hz: function (v) { return 1.6 + 1.2 * v; }, park: 0.15 },
    wade:  { hz: function (v) { return 1.0 + 0.8 * v; }, park: 0.15 },
    swim:  { hz: function (v) { return 0.7 + 0.5 * v; }, park: 0.25 },
    ride:  { hz: function (v) { return 0.55 + 1.45 * v; }, park: 0 },
    surf:  { hz: function (v) { return 0.6; }, park: 0 }
  };

  /* Ground shadow alpha per stance (water stances have no ground
     shadow); the CURRENT alpha crossfades toward it over the
     stance-change window (exact copy in steady state). */
  const SHADOW_ALPHA = { stand: 1, float: 0, walk: 1, wade: 1, swim: 0, ride: 0, surf: 0 };

  /* Stance registry. ctx = { t (seconds), dt, k (motion amplitude
     0|1), S, speed, phase, cycleHz, cycleParity, setAngle,
     setRootOffset }. `stand`, `walk` and `wade` are defined in this
     step; stances without an apply() fall back to stand in
     update(). */
  const STANCES = {
    stand: {
      /* Upright on sand with gentle breathing + a micro weight sway. */
      apply: function (ctx) {
        const br = Math.sin(ctx.t * Math.PI) * ctx.k;
        const ws = Math.sin(ctx.t * 1.1) * ctx.k;
        ctx.setAngle("torso", br * 2);
        ctx.setAngle("head", -br * 2);
        ctx.setAngle("shoulderF", 22 + br * 3);
        ctx.setAngle("shoulderB", -22 + br * 3);
        ctx.setAngle("elbowF", 6 + br * 1.5);
        ctx.setAngle("elbowB", 6 - br * 1.5);
        ctx.setAngle("hipF", 1.5 + ws * 1.5);
        ctx.setAngle("hipB", -1.5 + ws * 1.5);
        ctx.setAngle("kneeF", 1 + ws);
        ctx.setAngle("kneeB", -1 + ws);
        ctx.setRootOffset(0, -hipFrac() - br * 0.004);
      }
    },
    walk: {
      /* Sand side-scroll gait, one cycle per phase turn: arms
         counter-swing the legs (the 18° base splay keeps the hands
         off the body), the elbow flexes on the forward swing, only
         the backward-swinging leg bends (the shin trails), and the
         root bobs UP at leg pass. With F = right / B = left the
         swings run in the screen plane — intended for the
         front-view chibi walking sideways. The gait shrinks as she
         eases out (amp -> 0.55 at speed 0). */
      apply: function (ctx) {
        const th = TAU * ctx.phase;
        const s = Math.sin(th) * ctx.k;
        const c = Math.cos(th) * ctx.k;
        const amp = 0.55 + 0.45 * ctx.speed;
        ctx.setAngle("torso", -3 - 2.5 * s);
        ctx.setAngle("head", 1 + 2 * s - 3 * c);
        /* Front-view pendulum: a sideways-walking front-view chibi swings
           BOTH arms the SAME screen way, trailing the step (toward -x when
           c>0, +x when c<0) — antiphase would flare them out then pinch in
           together. The 18° base splay keeps the hands off the body; both
           elbows bend as the arms trail behind (swung toward -x). */
        ctx.setAngle("shoulderF", 18 - 20 * c * amp);
        ctx.setAngle("shoulderB", -18 - 20 * c * amp);
        ctx.setAngle("elbowF", 14 + 16 * Math.max(0, c) * amp);
        ctx.setAngle("elbowB", 14 + 16 * Math.max(0, c) * amp);
        ctx.setAngle("hipF", 28 * c * amp);
        ctx.setAngle("hipB", -28 * c * amp);
        ctx.setAngle("kneeF", -42 * Math.max(0, -c) * amp);
        ctx.setAngle("kneeB", -42 * Math.max(0, c) * amp);
        ctx.setRootOffset(0.004 * Math.sin(2 * th) * ctx.k, -0.3087 - 0.014 * Math.abs(s) * amp);
      }
    },
    wade: {
      /* Shallow water: higher, smaller, slower steps with the hips
         a bit lower (0.97x rest height); the hands reach ahead in
         the water (shoulders biased forward). Same phase/amp
         structure as walk. */
      apply: function (ctx) {
        const th = TAU * ctx.phase;
        const s = Math.sin(th) * ctx.k;
        const c = Math.cos(th) * ctx.k;
        const amp = 0.55 + 0.45 * ctx.speed;
        ctx.setAngle("torso", -4 - 2.5 * s);
        ctx.setAngle("head", 1.5 + 1.5 * s - 2.5 * c);
        /* Front-view pendulum like walk, but the arms are biased ahead of
           her (toward +x) reaching through the water: shoulderF leads and
           both swing the SAME screen way (toward -x when c>0, +x when c<0);
           both elbows bend as the arms trail behind (swung toward -x). */
        ctx.setAngle("shoulderF", 26 - 18 * c * amp);
        ctx.setAngle("shoulderB", -6 - 18 * c * amp);
        ctx.setAngle("elbowF", 26 + 12 * Math.max(0, c) * amp);
        ctx.setAngle("elbowB", 26 + 12 * Math.max(0, c) * amp);
        ctx.setAngle("hipF", 18 * c * amp);
        ctx.setAngle("hipB", -18 * c * amp);
        ctx.setAngle("kneeF", -36 * Math.max(0, -c) * amp);
        ctx.setAngle("kneeB", -36 * Math.max(0, c) * amp);
        ctx.setRootOffset(0.003 * Math.sin(2 * th) * ctx.k, -0.97 * (0.3087 + 0.012 * Math.abs(s) * amp));
      }
    }
  };

  /* Writes a joint's TARGET angle (deg); the blended cur pose —
     what the FK actually reads — eases toward it each frame.
     Joints a stance does not set keep their last target. Unknown
     joint names are ignored. */
  function setAngle(name, deg) {
    const bn = ANGLE_TO_BONE[name];
    if (!rig || !bn) return;
    rig.poseTgt[name] = num(deg, rig.poseTgt[name]);
  }

  /* ---------- palette (lazy: char + suit state at build time) ------ */

  function charColorsNow() {
    const chars = window.CHARACTERS;
    return chars ? chars[charId] : undefined;
  }

  /* 0xRRGGBB int -> '#rrggbb' (BeachParts.paletteFor's input form). */
  function toHex(v) {
    const n = (typeof v === "number" && isFinite(v)) ? (v | 0) : 0;
    const s = (n & 0xffffff).toString(16);
    return "#" + "000000".slice(0, 6 - s.length) + s;
  }

  function suitColorsAsHex() {
    return {
      main: toHex(suit.main),
      trim: toHex(suit.trim),
      bottom: toHex(suit.bottom),
      twoPiece: suit.twoPiece
    };
  }

  /* ---------- async render + build ---------- */

  function loadRig() {
    const P = window.BeachParts;
    if (!P || typeof P.render !== "function" || typeof P.paletteFor !== "function") return;
    const token = ++loadToken;
    loading = true;
    const palette = P.paletteFor(charColorsNow(), suitColorsAsHex());
    P.render(palette, RENDER_SCALE)
      .then(function (res) {
        /* Stale render (re-attach/detach happened) or the scene is
           gone — drop it so we never build into a dead scene. */
        if (token !== loadToken || !scene) return;
        buildRig(res);
        loading = false;
      })
      .catch(function () {
        /* Leave the rig unbuilt. beach-game.js guards every call on
           isAttached(), so a failed render degrades to "no
           character" on the flagged path without crashing. */
        if (token === loadToken) loading = false;
      });
  }

  function buildRig(res) {
    if (!scene) return;
    const P = window.BeachParts;
    const S = computeS();

    const root = scene.add.container(0, 0);
    root.setDepth(ROOT_DEPTH);

    /* Ground shadow: a scene-level Graphics just under the rig,
       cleared + redrawn every frame in px at the feet anchor. */
    shadowG = scene.add.graphics();
    shadowG.setDepth(SHADOW_DEPTH);

    /* Bone runtime from BeachParts.SKELETON (parent-before-child).
       lx/ly = own pivot minus parent pivot (viewBox units; root
       stays 0,0). The FK pass derives wx/wy/wrot from these each
       frame — the leg hip pivots (184/216, 250) are ON the root
       row, so hipL/hipR get lx = ∓16, ly = 0. */
    const bones = [];
    const bonesByName = {};
    for (let i = 0; i < P.SKELETON.length; i++) {
      const def = P.SKELETON[i];
      const bone = {
        name: def.name,
        index: i,
        parentIndex: -1,
        px: def.pivot[0],
        py: def.pivot[1],
        lx: 0,
        ly: 0,
        angleDeg: 0,
        wx: 0,
        wy: 0,
        wrot: 0,
        sprite: null
      };
      bones.push(bone);
      bonesByName[def.name] = bone;
    }
    for (let i = 0; i < bones.length; i++) {
      const bone = bones[i];
      const def = P.SKELETON[i];
      if (def.parent == null) continue;           // root: lx/ly stay 0,0
      const parent = bonesByName[def.parent];
      bone.parentIndex = parent.index;
      bone.lx = bone.px - parent.px;
      bone.ly = bone.py - parent.py;
    }

    /* One canvas texture per part (key unique per build via the gen
       counter); one sprite per bone that carries a part. Sprites are
       added to the container in ascending part z (stable), so
       hair-back (z 1) is at the back and hair-front (z 8) on top. */
    genCounter++;
    texKeys = [];
    const zOf = {};
    for (let i = 0; i < P.PARTS.length; i++) zOf[P.PARTS[i].id] = P.PARTS[i].z;
    const records = [];
    for (let i = 0; i < bones.length; i++) {
      const partId = P.SKELETON[i].part;
      const entry = partId ? res[partId] : null;
      if (!entry) continue;
      const bone = bones[i];
      const key = TEX_PREFIX + genCounter + "_" + partId;
      scene.textures.addCanvas(key, entry.canvas);
      texKeys.push(key);
      const sprite = scene.add.sprite(0, 0, key);
      sprite.setOrigin(0.5, 0.5);          // fractional center — the pivot joint
      sprite.setScale(1 / RENDER_SCALE);   // canvas is RENDER_SCALE px per viewBox unit
      bone.sprite = sprite;
      records.push({ bone: bone, z: num(zOf[partId], 0) });
    }
    records.sort(function (a, b) { return a.z - b.z; });
    for (let i = 0; i < records.length; i++) root.add(records[i].bone.sprite);

    /* Pose-blend state: target angles per joint (what the stance's
       apply() writes) + the blended current angles the FK reads.
       All targets start at 0; the root offset starts at the stand
       rest offset. */
    const poseTgt = {};
    const poseCur = {};
    for (let i = 0; i < JOINT_NAMES.length; i++) {
      const n = JOINT_NAMES[i];
      poseTgt[n] = 0;
      poseCur[n] = 0;
    }

    rig = {
      S: S,
      K: S / metrics().height,
      root: root,
      bones: bones,
      bonesByName: bonesByName,
      tSec: 0,              // module clock (seconds)
      rootOff: { x: 0, y: 0 },
      poseTgt: poseTgt,     // target joint angles (deg), old-rig joint names
      poseCur: poseCur,     // blended current angles (deg) — the FK reads these
      rootTgt: { x: 0, y: REST_Y },   // target root offset (fractions of S)
      rootCur: { x: 0, y: REST_Y }    // blended current root offset (fractions of S)
    };

    applyContainerScale();
    placeRoot();
    /* First pose: drive the stance's apply() once and snap the
       blended pose to it (dt<=0 — no crossfade from an unbuilt
       pose). Any stale crossfade from a previous attach is dropped. */
    xfade.active = false;
    xfade.t = 0;
    shadowCur = SHADOW_ALPHA[stanceName] || 0;
    update(0, 0);
  }

  /* FK pass over the 13 bones (parent-before-child), in
     container-local viewBox units relative to the hip:
       root:  wx=wy=0, wrot = localRot
       child: wrot = parent.wrot + localRot
              wx = parent.wx + lx·cos(parent.wrot) − ly·sin(parent.wrot)
              wy = parent.wy + lx·sin(parent.wrot) + ly·cos(parent.wrot)
     Sign convention (uniform): localRot = -angleDeg·DEG — positive
     angles swing a limb toward the facing direction (+x unflipped),
     a counter-clockwise screen rotation (negative Phaser rotation)
     for a down-hanging limb; same sign for torso/head. */
  function poseNow() {
    if (!rig) return;
    const bones = rig.bones;
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      const localRot = -b.angleDeg * DEG;
      if (b.parentIndex < 0) {
        b.wx = 0;
        b.wy = 0;
        b.wrot = localRot;
      } else {
        const p = bones[b.parentIndex];
        b.wrot = p.wrot + localRot;
        b.wx = p.wx + b.lx * Math.cos(p.wrot) - b.ly * Math.sin(p.wrot);
        b.wy = p.wy + b.lx * Math.sin(p.wrot) + b.ly * Math.cos(p.wrot);
      }
      if (b.sprite) {
        b.sprite.setPosition(b.wx, b.wy);
        b.sprite.rotation = b.wrot;
      }
    }
  }

  /* Resolve the blended pose the FK reads (poseCur, never the
     targets), then push it into the bones:
       • steady state (no active crossfade): cur is an EXACT copy of
         the stance's targets — the gait runs at full amplitude,
         zero lag;
       • for XFADE_DUR s after an ACTUAL stance change: lerp cur
         from the frozen xfade snapshot to the per-frame targets,
         eased by smoothstep(xfade.t / xfade.dur) — shortest-arc
         wrapDeg on the joints so no joint spins across the ±180
         seam, no wrap on the root offset (fractions of S) and the
         shadow alpha; deactivates at the end of the window.
     Snap (exact copy, no crossfade, deactivate) when there is no
     dt (build / dt<=0) or under reduced motion (k=0). */
  function blendPose(dt, k) {
    const cur = rig.poseCur, tgt = rig.poseTgt;
    if (xfade.active) {
      if (dt > 0 && k !== 0) {
        xfade.t += dt;
        const w = smoothstep(clamp(xfade.t / xfade.dur, 0, 1));
        for (let i = 0; i < JOINT_NAMES.length; i++) {
          const n = JOINT_NAMES[i];
          cur[n] = xfade.pose[n] + wrapDeg(tgt[n] - xfade.pose[n]) * w;
        }
        const rc = rig.rootCur, rt = rig.rootTgt;
        rc.x = xfade.root.x + (rt.x - xfade.root.x) * w;
        rc.y = xfade.root.y + (rt.y - xfade.root.y) * w;
        shadowCur = xfade.shadow + ((SHADOW_ALPHA[stanceName] || 0) - xfade.shadow) * w;
        if (xfade.t >= xfade.dur) xfade.active = false;
      } else {
        /* dt<=0 or reduced motion: snap instead of crossfading. */
        xfade.active = false;
      }
    }
    if (!xfade.active) {
      for (let i = 0; i < JOINT_NAMES.length; i++) cur[JOINT_NAMES[i]] = tgt[JOINT_NAMES[i]];
      rig.rootCur.x = rig.rootTgt.x;
      rig.rootCur.y = rig.rootTgt.y;
      shadowCur = SHADOW_ALPHA[stanceName] || 0;
    }
    for (let i = 0; i < JOINT_NAMES.length; i++) {
      const b = rig.bonesByName[ANGLE_TO_BONE[JOINT_NAMES[i]]];
      if (b) b.angleDeg = cur[JOINT_NAMES[i]];
    }
  }

  /* Ground shadow under the feet anchor (drawn in px). `lift` = how
     far the current root offset sits ABOVE the rest offset (REST_Y),
     normalized over 0.02*S — the ellipse shrinks as she bobs up.
     Cleared every frame; skipped entirely once the blended alpha has
     faded below 0.01 (water stances). */
  function drawShadow() {
    if (!rig || !shadowG) return;
    shadowG.clear();
    if (shadowCur < 0.01) return;
    const pt = anchorPx();
    if (!pt) return;
    const lift = clamp((REST_Y - rig.rootCur.y) / 0.02, 0, 1);
    const rx = 0.20 * rig.S * (1 - 0.35 * lift);
    const ry = 0.032 * rig.S * (1 - 0.35 * lift);
    shadowG.fillStyle(0x3a2e6e, 0.11 * shadowCur);
    shadowG.fillEllipse(pt.x, pt.y, rx, ry);
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
       KEPT IN SYNC with LOCO_REST_F (0.12) in beach-game.js, so the
       locomotion's fallback anchor (used while the async parts
       render is in flight) matches the rig's own default exactly. */
    const L = layoutNow();
    const sandTop = L ? L.sandTop : 0.72;
    anchor = { fx: 0.5, fy: sandTop + 0.12 * (1 - sandTop) };
    flipped = false;
    stanceName = "stand";   // full pose reset, like the old rig (see its attach)
    speed = 0;
    phase = 0;              // gait state resets with the pose
    cycleCount = 0;
    waterlineFy = null;

    /* Rig v2 builds ASYNC (BeachParts rasterizes 12 SVG canvases),
       so it becomes live a tick or two after this returns. Until
       then isAttached() is false and every other method no-ops
       safely; beach-game.js already guards its per-frame pushes on
       isAttached(). */
    loadRig();

    if (sc.events && typeof sc.events.once === "function") {
      sc.events.once("shutdown", detach);
    }
    return true;
  }

  function detach() {
    loadToken++;                 // cancel any in-flight render
    loading = false;
    if (rig) {
      if (rig.root && typeof rig.root.destroy === "function") {
        rig.root.destroy();      // destroys the part sprites (children) too
      }
      rig = null;
    }
    if (shadowG && typeof shadowG.destroy === "function") {
      shadowG.destroy();         // the ground shadow is scene-level, not a child
    }
    shadowG = null;
    if (scene && scene.textures && typeof scene.textures.remove === "function") {
      for (let i = 0; i < texKeys.length; i++) {
        const key = texKeys[i];
        if (typeof scene.textures.exists !== "function" || scene.textures.exists(key)) {
          scene.textures.remove(key);
        }
      }
    }
    texKeys = [];
    scene = null;
    waterlineFy = null;
  }

  function isAttached() {
    return !!rig;
  }

  function onResize() {
    if (!rig) return;
    const S = computeS();
    if (S === rig.S) return;                 // height unchanged — nothing to do
    rig.S = S;
    applyContainerScale();   // rescale the container (sprites stay in viewBox units)
    placeRoot();
  }

  function update(timeMs, dtMs) {
    if (!rig) return;
    const dt = clamp(num(dtMs, 0) / 1000, 0, 0.1);   // seconds; cap a big tab-out gap
    const k = motionAmplitude();
    /* Reduced motion: hold the clock at 0 and k=0 — the static base
       pose. Otherwise advance the module clock. */
    rig.tSec = (k > 0) ? (rig.tSec + dt) : 0;
    /* Gait phase: advanced by the stance's cycle rate at the current
       speed (gait terms derive from phase, never raw t, so setSpeed
       changes never snap); k=0 parks it at the stance's phase. */
    const cyc = CYCLES[stanceName] || CYCLES.stand;
    if (k > 0) {
      phase += dt * cyc.hz(speed);
      while (phase >= 1) { phase -= 1; cycleCount++; }
    } else {
      phase = cyc.park;
    }
    /* Per-frame root target: the stance's resting offset, overridden
       by setRootOffset inside the stance's apply() below. */
    const so = stanceOffset(stanceName);
    rig.rootTgt.x = so.x;
    rig.rootTgt.y = so.y;
    const ctx = {
      t: rig.tSec,
      dt: dt,
      k: k,
      S: rig.S,
      speed: speed,
      phase: phase,
      cycleHz: cyc.hz(speed),
      cycleParity: cycleCount & 1,
      setAngle: setAngle,
      setRootOffset: function (fx, fy) {
        rig.rootTgt.x = num(fx, 0);
        rig.rootTgt.y = num(fy, 0);
      }
    };
    /* Stances without an apply() (float/swim/ride/surf this step,
       and any registered before defineStance lands one) fall back to
       stand's pose. */
    const st = STANCES[stanceName];
    const apply = (st && typeof st.apply === "function") ? st.apply : STANCES.stand.apply;
    apply(ctx);
    blendPose(dt, k);
    poseNow();
    placeRoot();
    drawShadow();
  }

  function setStance(name) {
    if (!STANCE_OFFSETS[name]) return false;   // unknown -> keep current
    if (stanceName === name) return true;
    stanceName = name;
    phase = 0;          // fresh gait cycle on an actual stance change
    cycleCount = 0;
    if (rig) {
      /* ACTUAL stance change: freeze the current blended pose/root/
         shadow as the crossfade origin; blendPose lerps from it to
         the new stance's per-frame targets for xfade.dur seconds. */
      const pc = rig.poseCur, xp = (xfade.pose = {});
      for (let i = 0; i < JOINT_NAMES.length; i++) {
        const n = JOINT_NAMES[i];
        xp[n] = pc[n];
      }
      xfade.root.x = rig.rootCur.x;
      xfade.root.y = rig.rootCur.y;
      xfade.shadow = shadowCur;
      xfade.active = true;
      xfade.t = 0;
      placeRoot();
    } else {
      /* No rig yet (attach / first build): snap, no crossfade. */
      xfade.active = false;
      xfade.t = 0;
    }
    return true;
  }

  function getStance() {
    return stanceName;
  }

  function setSpeed(v01) {
    speed = clamp(num(v01, speed), 0, 1);
    return true;
  }

  function getSpeed() {
    return speed;
  }

  function setFlip(b) {
    flipped = !!b;
    if (rig) applyContainerScale();   // mirrors the whole container on X
  }

  function setCharacter(id) {
    if (typeof id !== "string" || !id) return false;
    const chars = window.CHARACTERS;
    if (!chars || !chars[id]) return false;
    if (id === charId && rig) return true;
    charId = id;
    /* The palette is chosen from charId at build time; a live
       re-render on character change is a later task. Method kept for
       API parity. */
    return true;
  }

  function setSuitColors(colors) {
    if (!colors || typeof colors !== "object") return false;
    if (colors.main != null) suit.main = hexInt(colors.main, suit.main);
    if (colors.trim != null) suit.trim = hexInt(colors.trim, suit.trim);
    if (colors.bottom != null) suit.bottom = hexInt(colors.bottom, suit.bottom);
    if (colors.twoPiece != null) suit.twoPiece = !!colors.twoPiece;
    /* A live re-render in the new suit colors is a later step —
       stored for now. */
    return true;
  }

  function setAnchor(fx, fy) {
    const x = num(fx, NaN), y = num(fy, NaN);
    if (!isFinite(x) || !isFinite(y)) return false;
    anchor = { fx: clamp(x, 0, 1), fy: clamp(y, 0, 1) };
    if (rig) placeRoot();
    return true;
  }

  function getAnchor() {
    return rig ? { fx: anchor.fx, fy: anchor.fy } : null;
  }

  function waterlineOffset() {
    return rig ? 0.10 * rig.S : null;
  }

  function setWaterline(fyOrNull) {
    if (fyOrNull == null) { waterlineFy = null; return true; }
    const v = num(fyOrNull, NaN);
    if (!isFinite(v)) return false;
    waterlineFy = clamp(v, 0, 1);
    return true;
  }

  /* Submersion compositing info — identical contract to the old rig:
     {cx, cy, S, waterY} in px (cx/cy = the hip point, which is the
     container origin; waterY = waterline px), or null when there is
     nothing to draw (no waterline / no layout / detached / land
     stance / waterline below sand reach). Detached-safe. */
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

  /* Paint the submerged wash + waterline break + wake on a
     scene-owned Graphics (beach-game.js clears + calls this every
     frame at depth 16). Copied from the old rig — it is
     self-contained over `info` and the module's speed/flipped/stance
     state. No-ops on null/garbage. */
  function paintSubmerge(g, info) {
    if (!g || !info) return;
    const cx = num(info.cx, NaN), cy = num(info.cy, NaN);
    const S = num(info.S, 0), waterY = num(info.waterY, NaN);
    if (!(isFinite(cx) && isFinite(cy) && isFinite(waterY) && S > 0)) return;
    const L = layoutNow();
    const sandY0 = L ? L.sandTop * L.h : waterY + 1.1 * S;

    const top = waterY + 0.06 * S;
    const maxBot = Math.min(sandY0 - 0.04 * S, waterY + 0.85 * S);
    const ryOuter = Math.max(0.08 * S, (maxBot - top) / 2);
    const tintCy = top + ryOuter;
    g.fillStyle(0x49c1dd, 0.15);
    g.fillPoints(ellipsePts(cx, tintCy, 1.05 * S, ryOuter), true);
    g.fillStyle(0x49c1dd, 0.20);
    g.fillPoints(ellipsePts(cx, top + 0.8 * ryOuter, 0.72 * S, 0.8 * ryOuter), true);

    const ey = waterY + 0.02 * S;
    g.fillStyle(0xffffff, 0.50);
    g.fillPoints(ellipsePts(cx, ey, 0.55 * S, 0.05 * S), true);
    g.fillStyle(0xffffff, 0.35);
    g.fillPoints(ellipsePts(cx, ey, 0.38 * S, 0.05 * S), true);

    if (speed > 0.05 && (stanceName === "swim" || stanceName === "float")) {
      const rm = motionAmplitude() === 0;
      const wp = currentWaveTime();
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

  /* API parity: the old rig lets missions register procedural
     stances. Registered definitions are stored so update() calls
     their apply(); they also get a STANCE_OFFSETS key so setStance()
     honors the name. */
  function defineStance(name, def) {
    if (!name || !def || typeof def.apply !== "function") return false;
    STANCES[name] = def;
    if (!STANCE_OFFSETS[name]) STANCE_OFFSETS[name] = true;
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
    /* Read-only snapshot for browser verification (cheap). */
    debug: function () {
      return {
        stance: stanceName,
        phase: phase,
        cycleCount: cycleCount,
        speed: speed,
        cur: rig ? Object.assign({}, rig.poseCur) : {},
        rootOff: rig ? { x: rig.rootCur.x, y: rig.rootCur.y } : {},
        xfade: { active: xfade.active, t: xfade.t }
      };
    },
    _wrapDeg: wrapDeg,     // exported for the Node harness
    SUIT_DEFAULT: SUIT_DEFAULT
  };
  /* root = the rig container (hip origin). joints/geo: rig v2 has no
     procedural skeleton or geometry table — null (the old rig returns
     null for these when unattached too, and consumers guard on them). */
  Object.defineProperty(api, "joints", { get: function () { return null; } });
  Object.defineProperty(api, "root", { get: function () { return rig ? rig.root : null; } });
  Object.defineProperty(api, "geo", { get: function () { return null; } });

  /* ---------- feature flag (default OFF: old rig is the fallback) ---
     Overwrite window.BeachRig (set by beach-rig.js) with THIS rig
     ONLY when explicitly opted in: window.__useRig2, or a `rig2` key
     in the URL (?rig2=1). Otherwise leave the old rig in place. */
  if (window.__useRig2 || new URLSearchParams(location.search).has("rig2")) {
    window.BeachRig = api;
  }
})
();
