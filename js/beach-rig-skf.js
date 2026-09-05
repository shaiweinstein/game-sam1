/* ============================================================
   Lily's Dress-Up Adventure — Beach character rig, SkelForm
   (lily.skf) EDITION (feature-flagged drop-in replacement).

     This is the skf-rig integration: instead of the hand-drawn
     nested-Container vector kid in js/beach-rig.js, it loads the
     lily.skf armature (a ZIP: armature.json + atlas0.png) with
     JSZip, drives the vendored SkelForm runtime per frame
     (SkfGenericTimeFrame -> SkfGenericAnimate -> SkfGenericConstruct)
     and renders every textured bone as a Phaser sprite — the exact
     approach proven in spike/lily.js, but repackaged as the same
     window.BeachRig contract so beach-game.js / beach-boat.js /
     beach-surf.js work UNCHANGED.

     FEATURE FLAG (default OFF — the old procedural rig is the
     fallback): at the very bottom this module overwrites
     window.BeachRig with THIS rig ONLY when
       window.__useSkfRig === true
       or the URL has a `skfrig` key (e.g. ?skfrig=1)
     Otherwise it leaves window.BeachRig (set by beach-rig.js)
     alone. Load order in index.html is: beach-rig.js first, then
     this file, so the flag can overwrite.

   CONTRACT — identical public surface to the old BeachRig:
       attach(scene) detach() isAttached() onResize()
       update(timeMs, dtMs) setStance(name) getStance()
       setSpeed(v) getSpeed() setFlip(bool) setCharacter(id)
       setSuitColors({...}) setAnchor(fx,fy) getAnchor()
       waterlineOffset() setWaterline(fy|null)
       getSubmergeInfo() paintSubmerge(g, info) defineStance(name, def)
     plus the joints / root / geo getters (root is the rig container;
     joints & geo are null — there is no procedural skeleton here).

   POSITIONING (matches the old rig's placeRoot contract):
       • S  = character height in px = clamp(100, 0.30*layout.h, 210),
              the SAME S the old rig uses.
       • root is a Phaser.Container placed at the HIP point. Its
         position = anchorPx + rootOffset (rootOffset in px, per stance),
         recomputed every frame via placeRoot() from the fractional
         anchor — never write root.x/.y by hand.
       • The lily.skf armature is ~604 armature units tall in its
         REST pose (head top y~-86 to feet y~-679, texture extent),
         with the root/hip bone at (400, -500) and the feet ~179-190
         units below it. The container is scaled by K = S / 604 so the
         whole character is S px tall, and the hip sits 0.315*S ABOVE
         the feet anchor (rootOffset (0, -0.315*S) for the upright
         stances) so the soles land on the anchor — mirroring the old
         rig's standHipH 0.310*S.
       • Each bone sprite lives in container-local ARMATURE UNITS:
             local.x = boneWorld.x - hipX
             local.y = hipY - boneWorld.y      (Y-up -> Y-down flip)
           the container's K (and ±K for facing) turns those into px,
           so the sprites are never re-scaled by S per frame.

   ANIMATION (this step):
       Every stance currently plays the skf "Stand" animation (the
       walk/swim/surf/suit-recolor animations land in a later step).
       setStance() stores the stance and re-derives the root offset;
       update() advances the anim clock by dt and re-poses the bones.
       Reduced motion (BeachGame.reducedMotion()) holds the clock at
       frame 0 — the static rest pose.

   SUITS / CHARACTERS (this step):
       setCharacter / setSuitColors are present for API parity and
       store their state, but the skf suit recolor (via armature
       styles) is a later step — lily.skf ships with the yellow Sunny
       One-Piece baked in.

   The module is lazy: it touches window.BeachGame / window.GameState
   / window.CHARACTERS / JSZip / SkfGeneric* only at call time, never
   at parse time, so its <script> order only needs to be AFTER
   beach-rig.js (so the flag can overwrite) and the skelform libs.
   ============================================================ */

(function () {
  "use strict";

  const TAU = Math.PI * 2;

  /* ---------- skf source + rig constants ---------- */
  const SKF_FILE = "spike/lily.skf";          // stable path TBD; spike for now
  const ATLAS_KEY = "beach_lily_atlas";       // Phaser texture key for atlas0.png
  const ARM_HEIGHT = 604;                     // armature units, head-top -> feet (rest extent)
  const UPRIGHT_HIP = 0.315;                  // fraction of S: hip above the feet anchor
  const FALLBACK_HIP = { x: 400, y: -500 };   // lily root/hip armature pos (derived, fallback)
  const ROOT_DEPTH = 15;                      // same depth the old rig's root uses

  /* ---------- module state (all reset by detach) ---------- */
  let scene = null;        // WorldScene the rig is attached to
  let rig = null;          // { root, S, K, armature, activeStyles, anim,
                           //   boneSprites[], hipX, hipY, animTime, rootOff }
  let anchor = { fx: 0.5, fy: 0.82 };         // fractional anchor (feet / waterline)
  let charId = "lily";
  let stanceName = "stand";
  let flipped = false;
  let speed = 0;
  let waterlineFy = null;
  let loading = false;
  let loadToken = 0;       // guards against a stale async load building a dead scene

  /* Suit state (mission 14 hook) — stored for API parity; the skf
     recolor via armature styles is a later step, so this only mirrors
     the catalog default and is not applied to the baked-in texture. */
  let suit = { main: 0xffd93d, trim: 0xff9a3d, bottom: 0xffd93d, twoPiece: false };
  const SUIT_DEFAULT = { main: "#ffd93d", trim: "#ff9a3d", bottom: "#ffd93d", twoPiece: false };

  /* ---------- tiny pure helpers (load-free, no DOM) ---------- */

  function num(v, fallback) {
    return (typeof v === "number" && isFinite(v)) ? v : fallback;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
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

  /* ---------- sizing + placement (old-rig contract) ---------- */

  function computeS() {
    const L = layoutNow();
    const h = L ? L.h : (scene && scene.scale ? scene.scale.height : 0);
    return clamp(0.30 * (num(h, 0) || 467), 100, 210);
  }

  /* Per-stance root offsets as a FRACTION of S (px = frac * S).
     THIS STEP: every stance plays the upright "Stand" skf animation,
     so all stances use the upright offset (hip 0.315*S above the feet
     anchor, so the soles sit on the anchor). When real per-stance skf
     gait animations land, tune these per stance — the structure is
     already per-stance. (Reusing the old rig's per-stance offsets now
     would desync, because those offsets were solved for prone/gait
     body poses we are not reproducing yet.) */
  const STANCE_OFFSETS = {
    stand: { x: 0, y: -UPRIGHT_HIP },
    float: { x: 0, y: -UPRIGHT_HIP },
    walk:  { x: 0, y: -UPRIGHT_HIP },
    wade:  { x: 0, y: -UPRIGHT_HIP },
    swim:  { x: 0, y: -UPRIGHT_HIP },
    ride:  { x: 0, y: -UPRIGHT_HIP },
    surf:  { x: 0, y: -UPRIGHT_HIP }
  };
  const DEFAULT_OFFSET = { x: 0, y: -UPRIGHT_HIP };

  function stanceOffset(name) {
    return STANCE_OFFSETS[name] || DEFAULT_OFFSET;
  }

  function anchorPx() {
    const L = layoutNow();
    if (!L) return null;
    return L.px(clamp(anchor.fx, 0, 1), clamp(anchor.fy, 0, 1));
  }

  /* root.position = anchorPx + rootOffset (px), rootOffset per stance.
     The container origin IS the hip point. */
  function placeRoot() {
    if (!rig) return;
    const pt = anchorPx();
    if (!pt) return;
    const off = stanceOffset(stanceName);
    rig.rootOff.x = off.x * rig.S;
    rig.rootOff.y = off.y * rig.S;
    rig.root.setPosition(pt.x + rig.rootOff.x, pt.y + rig.rootOff.y);
  }

  /* container scale K = S/604 (px per armature unit); facing mirrors X
     (the same ±1-X trick as the old rig's setFlip). */
  function applyContainerScale() {
    if (!rig) return;
    const K = rig.S / ARM_HEIGHT;
    rig.K = K;
    rig.root.setScale(flipped ? -K : K, K);
  }

  /* ---------- async load + build ---------- */

  function loadRig() {
    const token = ++loadToken;
    loading = true;
    /* Reuse spike/lily.js's loader: fetch the .skf (ZIP), parse
       armature.json, decode atlas0.png into a Phaser image texture. */
    fetch(SKF_FILE)
      .then(function (res) {
        if (!res.ok) { throw new Error("HTTP " + res.status); }
        return res.arrayBuffer();
      })
      .then(function (buf) { return JSZip.loadAsync(new Uint8Array(buf)); })
      .then(function (zip) {
        return Promise.all([
          zip.files["armature.json"].async("string"),
          zip.files["atlas0.png"].async("uint8array")
        ]);
      })
      .then(function (parts) {
        const armature = JSON.parse(parts[0]);
        const url = URL.createObjectURL(new Blob([parts[1]], { type: "image/png" }));
        return new Promise(function (resolve, reject) {
          const img = new Image();
          img.onload = function () { URL.revokeObjectURL(url); resolve({ armature: armature, img: img }); };
          img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode atlas0.png")); };
          img.src = url;
        });
      })
      .then(function (r) {
        /* Stale load (re-attach/detach happened) or the scene is gone —
           drop it so we never build into a dead scene or double-build. */
        if (token !== loadToken || !scene) return;
        buildRig(r.armature, r.img);
        loading = false;
      })
      .catch(function () {
        /* Leave the rig unbuilt. beach-game.js guards every call on
           isAttached(), so a failed skf load degrades to "no character"
           on the flagged path without crashing the scene. */
        if (token === loadToken) loading = false;
      });
  }

  function buildRig(armature, img) {
    if (!scene) return;
    const S = computeS();

    /* one style ("Default"), fallback styles[0] — the spike's rule */
    let activeStyle = null;
    for (let i = 0; i < armature.styles.length; i++) {
      if (armature.styles[i].name === "Default") { activeStyle = armature.styles[i]; break; }
    }
    if (!activeStyle) activeStyle = armature.styles[0];
    const activeStyles = [activeStyle];
    const anim = armature.animations && armature.animations[0];
    if (!anim) return;

    /* hip / root origin: the root bone (parent_id === -1) rest position.
       Deriving it keeps the origin glued to the real hip if the skf is
       ever re-exported with different numbers. */
    let hipX = FALLBACK_HIP.x, hipY = FALLBACK_HIP.y;
    for (let i = 0; i < armature.bones.length; i++) {
      if (armature.bones[i].parent_id === -1) {
        hipX = armature.bones[i].init_pos.x;
        hipY = armature.bones[i].init_pos.y;
        break;
      }
    }

    const root = scene.add.container(0, 0);
    root.setDepth(ROOT_DEPTH);

    scene.textures.addImage(ATLAS_KEY, img);
    const atlas = scene.textures.get(ATLAS_KEY);

    /* one frame + sprite per textured bone (visuals_id !== -1) */
    const records = [];
    for (let bi = 0; bi < armature.bones.length; bi++) {
      const bone = armature.bones[bi];
      if (bone.visuals_id === -1) continue;
      const visual = armature.visuals[bone.visuals_id];
      const tex = SkfGenericGetBoneTexture(visual.tex, activeStyles);
      if (!tex) continue;
      /* tex.offset/size are atlas pixels with a top-left origin — the
         same convention as Phaser frame regions. */
      atlas.add(tex.name, 0, tex.offset.x, tex.offset.y, tex.size.x, tex.size.y);
      records.push({ boneIndex: bi, z: visual.zindex, name: tex.name });
    }
    /* Painter's order by visual.zindex (stable: records were built in
       bone order, so ties keep bone order). */
    records.sort(function (a, b) { return a.z - b.z; });

    const boneSprites = [];
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      const sprite = scene.add.sprite(0, 0, ATLAS_KEY, rec.name);
      sprite.setOrigin(0.5, 0.5);   // fractional center (setDisplayOrigin takes PIXELS)
      sprite.setDepth(rec.z);
      rec.sprite = sprite;
      root.add(sprite);
      boneSprites.push(rec);
    }

    rig = {
      S: S,
      K: S / ARM_HEIGHT,
      root: root,
      armature: armature,
      activeStyles: activeStyles,
      anim: anim,
      boneSprites: boneSprites,
      hipX: hipX,
      hipY: hipY,
      animTime: 0,
      rootOff: { x: 0, y: 0 }
    };

    applyContainerScale();
    placeRoot();
    poseNow();   // drive one frame so the character is live immediately
  }

  /* Drive one skf frame and write each sprite's local pose.
     SkelForm is Y-up, Phaser is Y-down: flip Y on the local position and
     negate the rotation. The sprite frame IS the texture region and the
     sprite scale is the bone's RELATIVE scale — the container's K turns
     armature units into px, so we never multiply by S here. */
  function poseNow() {
    if (!rig) return;
    const arm = rig.armature;
    const anim = rig.anim;
    const frame = SkfGenericTimeFrame(rig.animTime, anim, false, true);
    /* The vendored SkfGenericAnimate reads a GLOBAL `anim` for its
       keyframe-loop bound (a quirk of lib/skelform/skelform-js.js) —
       the spike sets window.anim before calling. Replicate exactly. */
    window.anim = anim;
    SkfGenericAnimate(arm.bones, [anim], [frame], [0]);
    const bones = SkfGenericConstruct(arm);   // world pos/rot/scale per bone
    const hipX = rig.hipX, hipY = rig.hipY;
    for (let i = 0; i < rig.boneSprites.length; i++) {
      const rec = rig.boneSprites[i];
      const b = bones[rec.boneIndex];
      const sp = rec.sprite;
      sp.x = b.pos.x - hipX;          // container-local armature x
      sp.y = hipY - b.pos.y;          // Y flip: armature up -> local -y
      sp.rotation = -b.rot;           // negated for the Y flip
      sp.setScale(b.scale.x, b.scale.y);
      sp.setVisible(!b.hidden);
    }
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
       locomotion's fallback anchor (used while the async skf load is
       in flight) matches the rig's own default exactly. */
    const L = layoutNow();
    const sandTop = L ? L.sandTop : 0.72;
    anchor = { fx: 0.5, fy: sandTop + 0.12 * (1 - sandTop) };
    flipped = false;
    stanceName = "stand";   // full pose reset, like the old rig (see its attach)
    speed = 0;
    waterlineFy = null;

    /* The skf rig builds ASYNC (fetch + JSZip + texture decode), so it
       becomes live a tick or two after this returns. Until then
       isAttached() is false and every other method no-ops safely;
       beach-game.js already guards its per-frame pushes on isAttached(). */
    loadRig();

    if (sc.events && typeof sc.events.once === "function") {
      sc.events.once("shutdown", detach);
    }
    return true;
  }

  function detach() {
    loadToken++;                 // cancel any in-flight load
    loading = false;
    if (rig) {
      if (rig.root && typeof rig.root.destroy === "function") {
        rig.root.destroy();      // destroys the bone sprites (children) too
      }
      rig = null;
    }
    if (scene && scene.textures && typeof scene.textures.remove === "function" &&
        scene.textures.exists(ATLAS_KEY)) {
      scene.textures.remove(ATLAS_KEY);
    }
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
    applyContainerScale();   // rescale the container (sprites stay in armature units)
    placeRoot();
  }

  function update(timeMs, dtMs) {
    if (!rig) return;
    const dt = clamp(num(dtMs, 0), 0, 100);  // ms; cap a big tab-out gap
    /* Advance the anim clock (all stances play "Stand" this step).
       Reduced motion holds the clock at frame 0 — the static rest pose. */
    if (motionAmplitude() > 0) {
      rig.animTime += dt;
    } else {
      rig.animTime = 0;
    }
    poseNow();
    placeRoot();
  }

  function setStance(name) {
    if (!STANCE_OFFSETS[name]) return false;   // unknown -> keep current
    if (stanceName === name) return true;
    stanceName = name;
    /* This step: stances select which skf animation to play (all map to
       "Stand") and set the per-stance root offset. */
    if (rig) placeRoot();
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
    /* The skf character is baked (lily); per-character skf armatures +
       suit recolor are a later step. Method kept for API parity. */
    return true;
  }

  function setSuitColors(colors) {
    if (!colors || typeof colors !== "object") return false;
    if (colors.main != null) suit.main = hexInt(colors.main, suit.main);
    if (colors.trim != null) suit.trim = hexInt(colors.trim, suit.trim);
    if (colors.bottom != null) suit.bottom = hexInt(colors.bottom, suit.bottom);
    if (colors.twoPiece != null) suit.twoPiece = !!colors.twoPiece;
    /* Recolor via skf armature styles is a later step — stored for now. */
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
     nothing to draw (no waterline / no layout / detached / land stance /
     waterline below sand reach). Detached-safe. */
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

  /* Paint the submerged wash + waterline break + wake on a scene-owned
     Graphics (beach-game.js clears + calls this every frame at depth 16).
     Copied from the old rig — it is self-contained over `info` and the
     module's speed/flipped/stance state. No-ops on null/garbage. */
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

  /* API parity: the old rig lets missions register procedural stances.
     The skf rig has no procedural apply(); we still accept the name so
     setStance() honors it (it plays "Stand" until gait skf anims land). */
  function defineStance(name, def) {
    if (!name || !def || typeof def.apply !== "function") return false;
    if (!STANCE_OFFSETS[name]) STANCE_OFFSETS[name] = { x: 0, y: -UPRIGHT_HIP };
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
  /* root = the rig container (hip origin). joints/geo: the skf rig has no
     procedural skeleton or geometry table — null (the old rig returns
     null for these when unattached too, and consumers guard on them). */
  Object.defineProperty(api, "joints", { get: function () { return null; } });
  Object.defineProperty(api, "root", { get: function () { return rig ? rig.root : null; } });
  Object.defineProperty(api, "geo", { get: function () { return null; } });

  /* ---------- feature flag (default OFF: old rig is the fallback) ---
     Overwrite window.BeachRig (set by beach-rig.js) with THIS rig ONLY
     when explicitly opted in: window.__useSkfRig, or a `skfrig` key in
     the URL (?skfrig=1). Otherwise leave the old rig in place. */
  if (window.__useSkfRig || new URLSearchParams(location.search).has("skfrig")) {
    window.BeachRig = api;
  }
})
();
