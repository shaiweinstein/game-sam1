/* ============================================================
   Lily's Dress-Up Adventure — Beach scene overlay

   Full-screen "play at the beach" overlay opened from the map
   (see js/map.js: the 🌊 Play at the Beach! button and re-tapping
   the beach while already there).

   Owns the SHELL (open/close, talk bubble) plus the layered beach
   ART built inside #beach-stage: sky (sun/clouds/gulls), sea
   (wave bands/foam), sand (dot texture) and props (umbrella,
   ball, shells, starfish). While the Phaser canvas game runs
   (js/beach-game.js) it draws the same world on canvas and the
   .game-active class on the OVERLAY hides these DOM layers and
   #beach-character; without Phaser they remain the whole scene.
   (Mission 15 retired the legacy DOM play system — swim/wade,
   duck boat and surf are now canvas-only.)

   ACTIVITY FRAMEWORK — the reusable half: the character is in
   exactly one MODE at a time ('sand' on open) and #beach-actions
   auto-renders one button per registered activity visible in the
   current mode. Modes TODAY: 'sand' is the only DOM placement
   (no per-mode CSS needed — the base rule is the standing look);
   'boat' is a bar-gating marker set by js/beach-boat.js while the
   CANVAS duck boat is ridden, nothing else moves #beach-character
   any more.

     BeachScene.registerActivity({ id, emoji, label, modes, onClick })
       id      unique string (re-registering REPLACES, no dupes)
       emoji   short prefix on the button, e.g. '🏄'
       label   short button text
       modes   array of mode names the button appears in, or '*'
               for any/always
       onClick(ctx) fired with a fresh context on every tap:
         ctx.talk(msg)            set #beach-talk text (+ pop)
         ctx.sound(name)          window.GameSounds.play(name), guarded
         ctx.mode                 the mode name at click time
         ctx.setMode(name)        switch mode + re-render the bar
         ctx.getMode()            current mode name
         ctx.character            the #beach-character element
         ctx.stageEl / ctx.actionsEl / ctx.talkEl
         ctx.addSceneEl(el, layer)  append el to a named scene layer
                                   ('sky' | 'sea' | 'sand' | 'props',
                                   default 'props'); returns el
         ctx.removeSceneEl(el)    detach an element added earlier
         ctx.reducedMotion()      true under prefers-reduced-motion

     BeachScene.setMode(name) / getMode()
     BeachScene.onModeChange(fn)  subscribe; returns unsubscribe
     BeachScene.say(text)         talk line for canvas modules that
                                  have no click ctx (js/beach-boat.js)

   ACTIVITIES OWNED HERE (the survivors of mission 15):
     'castle'    — DOM sandcastle on the props layer, which paints
                   ABOVE the canvas (.game-active keeps .beach-castle
                   visible), so it works in both modes.
     'swimsuits' — modes '*'; closes the beach and hands off to the
                   wardrobe swimsuit tab; syncSuitToRig() pushes the
                   chosen suit into the canvas rig (mission 14).
     'boathop'   — modes ['boat']; the "Hop out & swim" button the
                   canvas boat ride shows, routed to BeachBoat.hop().
     js/beach-surf.js registers 'surfcatch' itself on attach.

   HOW TO ADD AN ACTIVITY (any task, from its own module):
     BeachScene.registerActivity({ id: 'castle', emoji: '🏰',
       label: 'Build a castle', modes: ['sand'],
       onClick: function (ctx) { ... ctx.addSceneEl(castleEl, 'props') } });
   No new code in this file — setMode/renderActions discover both
   automatically. A new DOM MODE needs only a
   .beach-scene.mode-<name> .beach-character-stage rule in
   css/style.css ("Beach activity modes") if it should move her.

   Exposes window.BeachScene = { open, close, isOpen,
     registerActivity, say, setMode, getMode, onModeChange, reducedMotion,
     get stageEl(), get actionsEl(), get talkEl(), get characterEl() }

   Uses window.GameState, window.CharacterRenderer, window.GameText;
   drives window.BeachGame / BeachBoat / BeachRig, all OPTIONAL —
   every call site guards, so a missing Phaser changes nothing but
   the visuals.
   ============================================================ */

(function () {
  "use strict";

  let overlayEl = null;
  let stageEl = null;
  let actionsEl = null;
  let talkEl = null;
  let characterEl = null;   // lazy <div id="beach-character"> inside the stage
  let sceneBuilt = false;   // true once the art layers exist inside #beach-stage
  let openState = false;
  /* B1: which engine painted THIS visit — true = three.js beach3d
     (window.Beach3D), false = the 2D Phaser canvas (or DOM art).
     Set in open(), read by close() and renderActions(). */
  let using3D = false;

  /* ---------- Activity framework state (see the header docs) ---------- */

  let currentMode = "sand";     // mode name on open; setMode() switches it
  const activities = [];        // registered specs: {id, emoji, label, modes, onClick}
  const modeHooks = [];         // onModeChange subscribers
  const sceneLayers = {};       // layerName → layer element, captured in ensureScene()
                                // (keys: 'sky' | 'sea' | 'sand' | 'props')

  /* ---------- Sandcastle builder state (activity 'castle') ----------
     PERSISTS across mode switches within one beach visit: the element
     lives in the props layer and the stage counter lives here, so a
     canvas boat ride out and back never touches either. close() wipes
     both, mirroring the mode reset there. */

  let castleStage = 0;          // 0..5 pieces built so far (0 = nothing)
  let castleEl = null;          // container div, addSceneEl'd ONCE

  function friendName() {
    return window.GameText ? window.GameText.name() : "Lily";
  }

  /* Dynamic copy: built with the chosen friend's name. */
  function welcomeTalk() {
    return friendName() + " loves the beach! Splash and play! 🌊";
  }

  function cacheDom() {
    if (overlayEl) return true;
    overlayEl = document.getElementById("beach-scene");
    if (!overlayEl) return false;
    stageEl = document.getElementById("beach-stage");
    actionsEl = document.getElementById("beach-actions");
    talkEl = document.getElementById("beach-talk");
    return true;
  }

  /* Create the character container on first open and let the shared
     renderer paint the chosen friend into it. Registered renderer
     instances re-render themselves on any GameState change (new
     friend, new outfit), so there is nothing to sync here. */
  function ensureCharacter() {
    if (characterEl || !stageEl) return;
    characterEl = document.createElement("div");
    /* .character-stage is the renderer's sizing hook (see style.css),
       exactly like the friends.js previews do with .friend-stage. */
    characterEl.className = "beach-character-stage character-stage";
    characterEl.id = "beach-character";
    stageEl.appendChild(characterEl);
    if (window.CharacterRenderer) {
      window.CharacterRenderer.render(characterEl, { size: "big" });
    }
  }

  /* ============================================================
     Beach art — DOM built once inside #beach-stage on first open

     ZONE GEOMETRY (for later tasks): the bands are positioned in
     CSS from custom properties on .beach-scene:
       --sea-top:  42%  — horizon (sky/sea boundary)
       --sand-top: 72%  — waterline (sea/sand boundary)
     both as % of #beach-stage height. Layer order & z-index:
       .beach-sky (1) → .beach-sea (2) → .beach-sand (3, holds
       .beach-foam) → .beach-props (4: umbrella/ball/shells/
        starfish/flower) → .beach-character-stage (6). The canvas
      game mirrors these same zone anchors in js/beach-game.js;
      anything new (DOM or canvas) should anchor to
      --sea-top/--sand-top too. All ambient motion is pure CSS
      keyframes (transform/opacity) disabled under reduced-motion.
     ============================================================ */

  /* Tiny markup helpers (same hand-rolled SVG feel as character.js) */

  function el(className, html) {
    const node = document.createElement("div");
    node.className = className;
    if (html) node.innerHTML = html;
    return node;
  }

  function svgMarkup(viewBox, body, attrs) {
    return (
      '<svg viewBox="' + viewBox + '" xmlns="http://www.w3.org/2000/svg" ' +
      'aria-hidden="true"' + (attrs ? " " + attrs : "") + ">" + body + "</svg>"
    );
  }

  /* Point on a circle, "x,y" for polygon lists. */
  function pt(cx, cy, r, a) {
    return (
      (cx + r * Math.cos(a)).toFixed(1) + "," +
      (cy + r * Math.sin(a)).toFixed(1)
    );
  }

  /* Sun: warm disc + 12 soft rays whose <g> rotates slowly (CSS). */
  function sunMarkup() {
    let rays = "";
    for (let i = 0; i < 12; i++) {
      const a = (Math.PI / 6) * i;
      rays +=
        '<polygon points="' +
        pt(60, 60, 30, a - 0.11) + " " + pt(60, 60, 30, a + 0.11) + " " +
        pt(60, 60, 48, a) + '"/>';
    }
    return svgMarkup(
      "0 0 120 120",
      '<g class="beach-sun-rays" fill="#ffe170">' + rays + "</g>" +
      '<circle cx="60" cy="60" r="27" fill="#ffd93d"/>' +
      '<circle cx="60" cy="60" r="27" fill="none" stroke="#f7bd2a" stroke-width="3"/>' +
      '<ellipse cx="52" cy="50" rx="10" ry="7" fill="#ffec9e" opacity="0.9"/>'
    );
  }

  /* Fluffy cloud: overlapping white puffs with a cool underside. */
  const CLOUD_SVG = svgMarkup(
    "0 0 150 62",
    '<g fill="#ffffff">' +
    '<circle cx="55" cy="27" r="21"/>' +
    '<circle cx="88" cy="23" r="23"/>' +
    '<circle cx="114" cy="35" r="16"/>' +
    '<rect x="30" y="30" width="96" height="22" rx="11"/>' +
    "</g>" +
    '<rect x="36" y="44" width="84" height="8" rx="4" fill="#dceffd"/>'
  );

  /* Seagull: a hand-drawn double-arc "m". */
  const GULL_SVG = svgMarkup(
    "0 0 44 18",
    '<path d="M5 13 Q 13 3 22 11 Q 31 3 39 13" fill="none" ' +
    'stroke="#5d4b8e" stroke-width="3.2" stroke-linecap="round"/>'
  );

  /* Seamless wave band: the Q…T chain has a 150-unit period, so the
     left half of the 1200-wide path is identical to the right half —
     translating the element -50% (its 200% width) loops with no jump. */
  function waveSvg() {
    let d = "M0 22 Q 37.5 6 75 22";
    for (let x = 150; x <= 1200; x += 75) d += " T " + x + " 22";
    d += " L 1200 48 L 0 48 Z";
    return svgMarkup(
      "0 0 1200 48",
      '<path d="' + d + '" fill="#ffffff"/>',
      'preserveAspectRatio="none"'
    );
  }

  /* Foam edge: full-width band with a scalloped bottom rim (same
     T-chain trick, period 75) plus a pale blue fringe peeking below. */
  function foamSvg() {
    let d = "M0 14 Q 18.75 24 37.5 14";
    for (let x = 75; x <= 1200; x += 37.5) d += " T " + x + " 14";
    d += " L 1200 0 L 0 0 Z";
    return svgMarkup(
      "0 0 1200 28",
      '<path d="' + d + '" fill="#d2f0fb" transform="translate(0 -4)"/>' +
      '<path d="' + d + '" fill="#ffffff"/>',
      'preserveAspectRatio="none"'
    );
  }

  /* Scallop shell: fan with ribs radiating from the top hinge. */
  const SCALLOP_SVG = svgMarkup(
    "0 0 100 76",
    '<path d="M50 8 C 26 8 8 28 6 50 C 20 64 36 70 50 70 ' +
    'C 64 70 80 64 94 50 C 92 28 74 8 50 8 Z" fill="#ffd1e3" ' +
    'stroke="#f26d9d" stroke-width="5" stroke-linejoin="round"/>' +
    '<g stroke="#f26d9d" stroke-width="3.5" stroke-linecap="round" fill="none">' +
    '<path d="M50 14 L50 65"/><path d="M50 14 L23 56"/><path d="M50 14 L77 56"/>' +
    '<path d="M50 14 L11 42"/><path d="M50 14 L89 42"/>' +
    "</g>"
  );

  /* Spiral shell: one stroked spiral, thick white + thin lavender core
     = candy-swirl look. */
  const SPIRAL_SVG = (function () {
    const d = "M12 70 C 24 42 44 22 62 25 C 84 29 90 52 73 62 " +
      "C 60 70 45 64 44 53 C 43 44 52 39 59 44";
    return svgMarkup(
      "0 0 100 80",
      '<path d="' + d + '" fill="none" stroke="#ffffff" stroke-width="16" stroke-linecap="round"/>' +
      '<path d="' + d + '" fill="none" stroke="#b9a3e8" stroke-width="6" stroke-linecap="round"/>'
    );
  })();

  /* Starfish: rounded 5-point star with little dots. */
  function starfishMarkup() {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI / 5) * i - Math.PI / 2 + 0.35;
      const r = i % 2 === 0 ? 34 : 15;
      pts.push(pt(50, 52, r, angle));
    }
    return svgMarkup(
      "0 0 100 104",
      '<g transform="rotate(8 50 52)">' +
      '<polygon points="' + pts.join(" ") + '" fill="#ffb84d" ' +
      'stroke="#3a2e6e" stroke-width="4" stroke-linejoin="round"/>' +
      '<circle cx="50" cy="48" r="3" fill="#e8963a"/>' +
      '<circle cx="43" cy="57" r="2.4" fill="#e8963a"/>' +
      '<circle cx="58" cy="58" r="2.4" fill="#e8963a"/>' +
      "</g>"
    );
  }

  /* Beach ball: six palette-colored wedges around a hub. */
  function ballMarkup() {
    const colors = ["#ff8fb8", "#ffd93d", "#4fc3d9"];
    let wedges = "";
    for (let i = 0; i < 6; i++) {
      const a0 = -Math.PI / 2 + (Math.PI / 3) * i;
      const a1 = a0 + Math.PI / 3;
      const x1 = (50 + 42 * Math.cos(a0)).toFixed(1);
      const y1 = (50 + 42 * Math.sin(a0)).toFixed(1);
      const x2 = (50 + 42 * Math.cos(a1)).toFixed(1);
      const y2 = (50 + 42 * Math.sin(a1)).toFixed(1);
      wedges +=
        '<path d="M50 50 L' + x1 + " " + y1 + " A 42 42 0 0 1 " + x2 + " " + y2 +
        'Z" fill="' + colors[i % 3] + '"/>';
    }
    return svgMarkup(
      "0 0 100 100",
      wedges +
      '<circle cx="50" cy="50" r="42" fill="none" stroke="#3a2e6e" stroke-width="4"/>' +
      '<circle cx="50" cy="50" r="6" fill="#fff9ec" stroke="#3a2e6e" stroke-width="3"/>'
    );
  }

  /* Umbrella: bamboo pole behind a 5-wedge pink/yellow scalloped
     canopy that dips between each rib, topped with a little finial. */
  const UMBRELLA_SVG = svgMarkup(
    "0 0 120 168",
    '<path d="M60 14 L60 162" stroke="#d99a5b" stroke-width="6" stroke-linecap="round"/>' +
    '<g stroke="#3a2e6e" stroke-width="3.5" stroke-linejoin="round">' +
    '<path d="M60 14 Q 26 24 4 60 Q 15 71 26 60 Z" fill="#ff8fb8"/>' +
    '<path d="M60 14 L26 60 Q 37 71 48 60 Z" fill="#ffd93d"/>' +
    '<path d="M60 14 L48 60 Q 59 71 70 60 Z" fill="#ff8fb8"/>' +
    '<path d="M60 14 L70 60 Q 81 71 92 60 Z" fill="#ffd93d"/>' +
    '<path d="M60 14 L92 60 Q 103 71 116 60 Q 94 24 60 14 Z" fill="#ff8fb8"/>' +
    "</g>" +
    '<circle cx="60" cy="11" r="5" fill="#fff9ec" stroke="#3a2e6e" stroke-width="3"/>'
  );

  /* ============================================================
     Sandcastle art — staged builder (activity 'castle')

     One SVG, viewBox 0 0 220 210, ground line around y=174. The
     art is CUMULATIVE: castleArtMarkup(stage) always redraws every
     piece from mound up to the current stage, so a stage change is
     just "swap innerHTML on the single container". Group order is
     fixed (mound → wall → keep → towers → flag/moat/shells →
     sparkles) so later pieces sit BEHIND the keep's door etc. no
     matter which stage added them. Palette: warm tans with soft
     brown ink, plus the umbrella's pink/yellow and the shells'
     pink so the castle reads as part of the same scene.
     ============================================================ */

  const CASTLE_INK = "#a06a35"; // warm brown outline for the sand blocks

  /* Mini scallop (same silhouette family as SCALLOP_SVG, unit-scaled
     around its own origin so one string serves all three placements). */
  const CASTLE_SHELL =
    '<path d="M0 -6 C -7 -6 -11 -1 -11 4 C -6 8 -2 9 0 9 C 2 9 6 8 11 4 ' +
    'C 11 -1 7 -6 0 -6 Z" fill="#ffd1e3" stroke="#f26d9d" stroke-width="2.2" ' +
    'stroke-linejoin="round"/>' +
    '<g stroke="#f26d9d" stroke-width="1.6" stroke-linecap="round" fill="none">' +
    '<path d="M0 -3 L0 7"/><path d="M0 -3 L-6 4"/><path d="M0 -3 L6 4"/></g>';

  /* Four-point twinkle star, centered on its own origin. */
  const CASTLE_STAR =
    '<path d="M0 -8 L2.4 -2.4 L8 0 L2.4 2.4 L0 8 L-2.4 2.4 L-8 0 L-2.4 -2.4 Z" ' +
    'fill="#fff9ec" stroke="#ffd93d" stroke-width="2" stroke-linejoin="round"/>';

  /* stage 1 — damp-sand plate + low hand-drawn mound with a highlight. */
  const CASTLE_MOUND =
    '<ellipse cx="110" cy="174" rx="100" ry="17" fill="#d9a86b" ' +
    'stroke="' + CASTLE_INK + '" stroke-width="3"/>' +
    '<path d="M32 172 Q 40 138 76 128 Q 110 120 144 128 Q 180 138 188 172 Z" ' +
    'fill="#e8c39e" stroke="' + CASTLE_INK + '" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M58 158 Q 78 142 104 138" fill="none" stroke="#f6ddb6" ' +
    'stroke-width="4" stroke-linecap="round"/>';

  /* stage 2 — main keep: merlons, block seams, glow door + window. */
  const CASTLE_KEEP =
    '<g fill="#e8c39e" stroke="' + CASTLE_INK + '" stroke-width="3">' +
    '<rect x="84" y="58" width="13" height="22" rx="3"/>' +
    '<rect x="103" y="58" width="13" height="22" rx="3"/>' +
    '<rect x="122" y="58" width="13" height="22" rx="3"/>' +
    "</g>" +
    '<rect x="84" y="74" width="52" height="88" rx="6" fill="#e8c39e" ' +
    'stroke="' + CASTLE_INK + '" stroke-width="3"/>' +
    '<g stroke="#c98f52" stroke-width="2.5" stroke-linecap="round" fill="none">' +
    '<path d="M87 104 H133"/><path d="M87 128 H133"/>' +
    '<path d="M110 104 V128"/><path d="M98 78 V90"/><path d="M122 90 V100"/>' +
    "</g>" +
    '<path d="M99 162 L99 144 Q99 131 110 131 Q121 131 121 144 L121 162 Z" ' +
    'fill="#fff9ec" stroke="' + CASTLE_INK + '" stroke-width="2.5"/>' +
    '<circle cx="110" cy="115" r="6.5" fill="#fff9ec" stroke="' + CASTLE_INK + '" stroke-width="2.5"/>';

  /* stage 3 — low front wall (behind the keep), two side towers with
     pink cone roofs and tiny yellow finials. */
  const CASTLE_WALL =
    '<rect x="58" y="140" width="104" height="22" rx="4" fill="#e8c39e" ' +
    'stroke="' + CASTLE_INK + '" stroke-width="3"/>' +
    '<path d="M61 152 H159" stroke="#c98f52" stroke-width="2.5" stroke-linecap="round" fill="none"/>';

  const CASTLE_TOWERS =
    '<rect x="42" y="102" width="30" height="60" rx="5" fill="#e8c39e" ' +
    'stroke="' + CASTLE_INK + '" stroke-width="3"/>' +
    '<rect x="148" y="102" width="30" height="60" rx="5" fill="#e8c39e" ' +
    'stroke="' + CASTLE_INK + '" stroke-width="3"/>' +
    '<g fill="#ffc9dc" stroke="#f26d9d" stroke-width="3" stroke-linejoin="round">' +
    '<polygon points="57,62 36,106 78,106"/>' +
    '<polygon points="163,62 142,106 184,106"/>' +
    "</g>" +
    '<g fill="#ffd93d" stroke="#f7bd2a" stroke-width="2.5">' +
    '<circle cx="57" cy="58" r="3.5"/><circle cx="163" cy="58" r="3.5"/>' +
    "</g>" +
    '<g fill="#fff9ec" stroke="' + CASTLE_INK + '" stroke-width="2.2">' +
    '<circle cx="57" cy="124" r="4.5"/><circle cx="163" cy="124" r="4.5"/>' +
    "</g>";

  /* stage 4 — pennant flag on the keep + dashed moat ring + shells. */
  const CASTLE_FLAG =
    '<path d="M110 60 V26" stroke="' + CASTLE_INK + '" stroke-width="2.5" stroke-linecap="round"/>' +
    '<polygon points="111,27 134,35 111,43" fill="#ff8fb8" stroke="#f26d9d" ' +
    'stroke-width="2.5" stroke-linejoin="round"/>' +
    '<circle cx="110" cy="24" r="3" fill="#ffd93d" stroke="#f7bd2a" stroke-width="2.5"/>';

  const CASTLE_MOAT =
    '<ellipse cx="110" cy="178" rx="108" ry="24" fill="none" stroke="#c98f52" ' +
    'stroke-width="5" stroke-dasharray="9 7" stroke-linecap="round"/>';

  const CASTLE_SHELLS =
    '<g transform="translate(64 189) rotate(-8) scale(0.9)">' + CASTLE_SHELL + "</g>" +
    '<g transform="translate(156 190) rotate(7) scale(0.8)">' + CASTLE_SHELL + "</g>" +
    '<g transform="translate(110 196) scale(0.7)">' + CASTLE_SHELL + "</g>";

  /* stage 5 — twinkling stars. Outer <g> PLACES (transform attr), inner
     .beach-sparkle ANIMATES (CSS scale/opacity only) — same split as
     the gulls, so the twinkle never fights the placement. */
  const CASTLE_SPARKLE_SPOTS = [
    [34, 80, 1, 1], [188, 72, 2, 0.8], [72, 34, 3, 0.75],
    [152, 28, 4, 1], [110, 8, 5, 0.7], [20, 142, 6, 0.85]
  ];

  function castleSparkles() {
    return CASTLE_SPARKLE_SPOTS.map(function (s) {
      return '<g transform="translate(' + s[0] + " " + s[1] + ") scale(" + s[3] + ')">' +
        '<g class="beach-sparkle beach-sparkle-' + s[2] + '">' + CASTLE_STAR + "</g></g>";
    }).join("");
  }

  /* Cumulative art for a stage (1..5); anything else renders nothing. */
  function castleArtMarkup(stage) {
    if (stage < 1) return "";
    const parts = [CASTLE_MOUND];
    if (stage >= 3) parts.push(CASTLE_WALL);
    if (stage >= 2) parts.push(CASTLE_KEEP);
    if (stage >= 3) parts.push(CASTLE_TOWERS);
    if (stage >= 4) parts.push(CASTLE_FLAG + CASTLE_MOAT + CASTLE_SHELLS);
    if (stage >= 5) parts.push(castleSparkles());
    return svgMarkup("0 0 220 210", parts.join(""));
  }

  function castleTalkFor(stage) {
    if (stage === 1) return "A big pile of sand! ⏳";
    if (stage === 2) return "The main tower goes up! 🏰";
    if (stage === 3) return "Two more towers — it's getting tall! ✨";
    if (stage === 4) return "A flag and a shell border! 🐚";
    if (stage === 5) return friendName() + " builds a MAGICAL sandcastle! ✨🏰✨";
    return "";
  }

  function buildSkyLayer() {
    const sky = el("beach-sky");
    sky.appendChild(el("beach-sun", sunMarkup()));
    const cloudClasses = ["beach-cloud-1", "beach-cloud-2", "beach-cloud-3"];
    for (let i = 0; i < cloudClasses.length; i++) {
      sky.appendChild(el("beach-cloud " + cloudClasses[i], CLOUD_SVG));
    }
    const gullClasses = ["beach-gull-1", "beach-gull-2"];
    for (let i = 0; i < gullClasses.length; i++) {
      /* Outer div glides across (CSS drift), inner div bobs —
         two transforms can't share one element. */
      const gull = el("beach-gull " + gullClasses[i]);
      gull.appendChild(el("beach-gull-bob", GULL_SVG));
      sky.appendChild(gull);
    }
    return sky;
  }

  function buildSeaLayer() {
    const sea = el("beach-sea");
    for (let i = 1; i <= 3; i++) {
      sea.appendChild(el("beach-wave beach-wave-" + i, waveSvg()));
    }
    return sea;
  }

  function buildSandLayer() {
    const sand = el("beach-sand");
    /* Foam rides the sand's top edge (the --sand-top waterline). */
    sand.appendChild(el("beach-foam", foamSvg()));
    return sand;
  }

  function buildPropsLayer() {
    const props = el("beach-props");
    props.appendChild(el("beach-prop beach-umbrella", UMBRELLA_SVG));
    props.appendChild(el("beach-prop beach-shell-b", SPIRAL_SVG));
    props.appendChild(el("beach-prop beach-shell-a", SCALLOP_SVG));
    props.appendChild(el("beach-prop beach-shell-c", SCALLOP_SVG));
    props.appendChild(el("beach-prop beach-starfish", starfishMarkup()));
    props.appendChild(el("beach-prop beach-ball", ballMarkup()));
    /* The only emoji in the sand — one little hibiscus. */
    props.appendChild(el("beach-prop beach-flower", "🌺"));
    return props;
  }

  function ensureScene() {
    if (sceneBuilt || !stageEl) return;
    sceneLayers.sky = buildSkyLayer();
    sceneLayers.sea = buildSeaLayer();
    sceneLayers.sand = buildSandLayer();
    sceneLayers.props = buildPropsLayer();
    stageEl.appendChild(sceneLayers.sky);
    stageEl.appendChild(sceneLayers.sea);
    stageEl.appendChild(sceneLayers.sand);
    stageEl.appendChild(sceneLayers.props);
    sceneBuilt = true;
  }

  /* ============================================================
     Activity framework — modes, activity bar, ctx

     setMode() only swaps a "mode-<name>" class on the OVERLAY and
     re-renders the bar; every placement/animation for a mode lives
     in css/style.css ("Beach activity modes"). Adding a mode is
     therefore a CSS rule + a registering activity, never a change
     in this file.
     ============================================================ */

  function getMode() {
    return currentMode;
  }

  /* true when the player asked the OS to dial animations down. */
  function reducedMotion() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  /* Talk-bubble update with the same pop re-trigger GameUI.setTalk
     uses (js/main.js) — class off, forced reflow, class on. */
  function setTalk(message) {
    if (!talkEl) return;
    talkEl.textContent = message;
    talkEl.classList.remove("pop");
    void talkEl.offsetWidth;
    talkEl.classList.add("pop");
  }

  /* Public speech line (mission 8): what canvas modules call when no
     click ctx exists — e.g. js/beach-boat.js on board/hop-out. Same
     behavior as an activity's ctx.talk (setTalk + pop); ignore
     garbage so a broken line can never blank the bubble. */
  function say(text) {
    if (typeof text !== "string" || !text) return;
    setTalk(text);
  }

  function playSound(name) {
    if (window.GameSounds && typeof window.GameSounds.play === "function") {
      window.GameSounds.play(name);
    }
  }

  /* Drop an element into a named scene layer ('sky' | 'sea' |
     'sand' | 'props', default 'props') and hand it back. */
  function addSceneEl(node, layerName) {
    if (!node) return node;
    const layer = sceneLayers[layerName] || sceneLayers.props;
    if (layer) layer.appendChild(node);
    return node;
  }

  function removeSceneEl(node) {
    if (node && node.parentNode) node.parentNode.removeChild(node);
  }

  /* Castle remains 2D-only; B3/B4 register their own ride actions. */
  const HIDDEN_IN_3D = { castle: true };

  function activityVisible(spec) {
    if (using3D && HIDDEN_IN_3D[spec.id]) return false;
    if (spec.modes === "*") return true;
    return Array.isArray(spec.modes) && spec.modes.indexOf(currentMode) !== -1;
  }

  /* Fresh context per click so ctx.mode always matches the click. */
  function makeCtx() {
    return {
      talk: setTalk,
      sound: playSound,
      mode: currentMode,
      setMode: setMode,
      getMode: getMode,
      character: characterEl,
      stageEl: stageEl,
      actionsEl: actionsEl,
      talkEl: talkEl,
      addSceneEl: addSceneEl,
      removeSceneEl: removeSceneEl,
      reducedMotion: reducedMotion
    };
  }

  /* Rebuilds #beach-actions: one button per activity visible in the
     current mode (emoji + short label, 44px+ targets via CSS). */
  function renderActions() {
    if (!actionsEl) return;
    actionsEl.textContent = "";
    activities.forEach(function (spec) {
      if (!activityVisible(spec)) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "beach-action-button";
      button.setAttribute("data-activity-id", spec.id);
      button.textContent = spec.emoji ? spec.emoji + " " + spec.label : spec.label;
      button.addEventListener("click", function () {
        try {
          spec.onClick(makeCtx());
        } catch (e) {
          /* One broken activity must never take the whole bar down. */
        }
      });
      actionsEl.appendChild(button);
    });
    if (openState && using3D) {
      const label = document.createElement("label");
      label.className = "beach-swim-style";
      label.textContent = "Swim Style";
      const select = document.createElement("select");
      select.id = "beach-swim-style";
      select.title = "Freestyle starts in deep water. Shallows and resting use Head-up.";
      select.setAttribute("aria-description", select.title);
      select.setAttribute("aria-describedby", "beach-swim-status");
      [["head-up", "Head-up"], ["freestyle", "Freestyle"]].forEach(function (entry) {
        const option = document.createElement("option");
        option.value = entry[0]; option.textContent = entry[1]; select.appendChild(option);
      });
      select.value = window.GameState.getSwimStyle();
      select.addEventListener("change", function () {
        window.GameState.setSwimStyle(select.value);
      });
      label.appendChild(select);
      actionsEl.appendChild(label);
      const status = document.createElement("p");
      status.id = "beach-swim-status";
      status.className = "beach-swim-status";
      status.setAttribute("role", "status");
      actionsEl.appendChild(status);
      syncSwimStatus();
    }
  }

  /* Called by the existing scene loop and preference sync, not another timer.
     Only replace changed text: keep the native selector and its focus intact. */
  function syncSwimStatus() {
    const node = openState && document.getElementById("beach-swim-status");
    const status = node && window.Beach3D?.swimStatus?.();
    if (!status) return;
    const freestyle = status.selected === "freestyle";
    const name = freestyle ? "Freestyle" : "Head-up";
    let text;
    if (status.mode === "loading") text = name + " selected. Loading swimmer...";
    else if (status.mode === "boat" || status.mode === "surf") {
      text = name + " selected for your next swim. " + (status.mode === "boat" ? "Boat ride" : "Surfing") + " continues.";
    } else if (status.mode === "shore") {
      text = name + " selected. Press and hold water to swim." + (freestyle ? " Aim farther toward the horizon." : " Release to rest.");
    } else if (status.mode === "rest") {
      text = freestyle && !status.ready
        ? "Freestyle selected. Resting Head-up. Hold farther toward the horizon for deeper water."
        : name + " ready. Resting Head-up. Press and hold water to swim.";
    } else if (freestyle && status.effective !== "freestyle") {
      text = "Freestyle selected; swimming Head-up in shallows. Hold farther toward the horizon for deeper water.";
    } else {
      text = "Swimming " + name + ". Release to rest Head-up.";
      if (status.reducedMotion) text = name + " pose (reduced motion). Hold water to move; release to rest Head-up.";
    }
    if (node.textContent !== text) node.textContent = text;
  }

  function registerActivity(spec) {
    if (!spec || typeof spec.id !== "string" || !spec.id ||
        typeof spec.onClick !== "function") {
      return;
    }
    /* Re-registering an id replaces it in place (no duplicate buttons,
       stable order for later tasks that hotfix an activity). */
    for (let i = 0; i < activities.length; i++) {
      if (activities[i].id === spec.id) {
        activities.splice(i, 1, spec);
        renderActions();
        return;
      }
    }
    activities.push(spec);
    renderActions();
  }

  function setMode(name) {
    if (typeof name !== "string" || !name || !cacheDom()) return;
    /* Drop ANY stale mode-* class, not just the tracked one, so the
       overlay never carries two mode classes if state got out of sync. */
    const stale = [];
    for (let i = 0; i < overlayEl.classList.length; i++) {
      const cls = overlayEl.classList[i];
      if (cls.indexOf("mode-") === 0) stale.push(cls);
    }
    stale.forEach(function (cls) {
      overlayEl.classList.remove(cls);
    });
    currentMode = name;
    overlayEl.classList.add("mode-" + currentMode);
    renderActions();
    /* Internal onModeChange hooks (BeachScene.onModeChange) — a broken
       listener must never break the mode switch itself. */
    modeHooks.slice().forEach(function (hook) {
      try {
        hook(currentMode);
      } catch (e) {
        /* ignore */
      }
    });
  }

  /* Subscribe to mode switches: fn(modeName). Returns an unsubscribe
     function (same pattern as GameState.onChange). */
  function onModeChange(callback) {
    if (typeof callback !== "function") {
      return function noopUnsubscribe() {};
    }
    modeHooks.push(callback);
    return function unsubscribe() {
      const index = modeHooks.indexOf(callback);
      if (index !== -1) modeHooks.splice(index, 1);
    };
  }

  /* ---------- Sandcastle activity (staged builder, 'sand' mode) ----------
     One button, five taps: each tap adds the next piece to the SAME
     container (never a second element); the sixth tap starts over. */

  function wireCastleActivity() {
    registerActivity({
      id: "castle",
      emoji: "🏰",
      label: "Build a sandcastle",
      modes: ["sand"],
      onClick: function (ctx) {
        /* Container goes into the props layer exactly once; stage
           changes only swap its innerHTML. */
        if (!castleEl) {
          castleEl = el("beach-prop beach-castle");
          ctx.addSceneEl(castleEl, "props");
        }
        if (castleStage >= 5) {
          castleStage = 1; /* finished → same button rebuilds from scratch */
          ctx.talk("Let's build another one! 🔁");
          ctx.sound("pop");
        } else {
          castleStage += 1;
          ctx.talk(castleTalkFor(castleStage));
          ctx.sound(castleStage === 5 ? "cheer" : "pop");
        }
        castleEl.innerHTML = castleArtMarkup(castleStage);
      }
    });
  }

  /* ---------- Boat hop-out button (id 'boathop', 'boat' mode) ----------
     js/beach-boat.js owns the whole canvas duck-boat ride: boarding
     happens IN-GAME (tap the hull → BS.setMode("boat"), which is the
     ONLY way 'boat' mode can ever be entered now), and the bar shows
     this button while riding. onClick routes straight to
     BeachBoat.hop() — a guarded no-op unless actually riding — and
     that module's disembark() restores the previous mode, so the bar
     flips back to the castle after every ride. The legacy DOM boat
     (hull art, steering loop and its bar entries) was removed with
     mission 15. */

  function wireBoatHopActivity() {
    registerActivity({
      id: "boathop",
      emoji: "🏊",
      label: "Hop out & swim",
      modes: ["boat"],
      onClick: function () {
        if (window.BeachBoat && typeof window.BeachBoat.hop === "function") {
          window.BeachBoat.hop();
        }
      }
    });
  }

  /* ---------- Swimsuit sync + shortcut (mission 14) ----------
     The canvas rig (js/beach-rig.js) builds with its DEFAULT suit at
     WorldScene.create; the outfit slot lives in GameState, so every
     beach open and every swimsuit change must push
     CharacterRenderer.catalog.swimsuit[id].colors into
     BeachRig.setSuitColors. attach happens whenever Phaser boots the
     scene (same tick or a few frames after BeachGame.open), so one
     immediate try plus a 0ms timeout plus a bounded rAF retry loop
     (≈1s, stops the instant a sync lands or the beach closes) covers
     every timing without touching the game modules. All of it is
     guarded/idempotent and can never throw into the open path. */

  let suitSyncRaf = null;

  /* Paint the chosen swimsuit onto the live rig. Returns true only
     when a sync actually landed (rig attached + setSuitColors ok),
     which is what the retry loop below uses as its stop signal. */
  function syncSuitToRig() {
    try {
      if (!window.BeachRig || typeof window.BeachRig.isAttached !== "function" ||
          !window.BeachRig.isAttached()) {
        return false;
      }
      let colors = null;
      let cat = null;
      try {
        const gs = window.GameState;
        const id = (gs && typeof gs.getOutfit === "function") ? gs.getOutfit().swimsuit : null;
        cat = window.CharacterRenderer && window.CharacterRenderer.catalog &&
          window.CharacterRenderer.catalog.swimsuit;
        if (cat && id && cat[id] && cat[id].colors) colors = cat[id].colors;
      } catch (e) {
        colors = null; /* catalog/state unreadable → fall back below */
      }
      if (!colors) {
        /* Prefer catalog suit1 (the single source of truth) so the
           canvas rig can never show an off-catalog color; the inline
           literal (matching suit1) is only the last-resort fallback
           when even the catalog is unreadable. */
        colors = (cat && cat.suit1 && cat.suit1.colors) ||
          { main: "#ffd93d", trim: "#ff9a3d", bottom: "#ffd93d", twoPiece: false };
      }
      return window.BeachRig.setSuitColors(colors) !== false;
    } catch (e) {
      return false; /* never throw out of the beach open/change path */
    }
  }

  function stopSuitSyncRetry() {
    if (suitSyncRaf !== null) {
      cancelAnimationFrame(suitSyncRaf);
      suitSyncRaf = null;
    }
  }

  function scheduleSuitSync() {
    stopSuitSyncRetry();
    syncSuitToRig();                    /* rig may already be attached */
    window.setTimeout(syncSuitToRig, 0); /* cheap next-task retry */
    let frames = 60;                    /* bounded rAF: Phaser scene boot */
    const tick = function () {
      suitSyncRaf = null;
      if (!openState) return;           /* closed → next open reschedules */
      if (syncSuitToRig()) return;      /* landed: stop hammering */
      if (--frames > 0) suitSyncRaf = requestAnimationFrame(tick);
    };
    suitSyncRaf = requestAnimationFrame(tick);
  }

  /* 🩱 button: registered right after 'castle' in init() so it sits
     next to the sandcastle in the bar; modes '*' keeps it visible in
     every mode — sand and the canvas boat's 'boat' alike, the one bar
     entry that is never mode-gated. Closes the beach (full close()
     teardown: castle + Phaser cleaned) and hands off to the wardrobe
     screen + swimsuit tab. */
  function wireSwimsuitActivity() {
    registerActivity({
      id: "swimsuits",
      emoji: "🩱",
      label: "Change swimsuit",
      modes: "*",
      onClick: function () {
        if (!openState) return;
        window.GameUI.showScreen("wardrobe", { fromBeach: true });
      }
    });
  }

  function open() {
    if (!cacheDom()) return;
    overlayEl.classList.remove("hidden");
    openState = true;
    if (talkEl) talkEl.textContent = welcomeTalk();
    ensureScene();
    ensureCharacter();
    /* B1: prefer the three.js beach (beach3d/beach3d.js, module —
       window.Beach3D). open() returns false when WebGL is missing
       or the boot failed, and the 2D Phaser canvas takes the visit
       instead — the game never hard-dead-ends on a bad device.
       The game-active class lives on the OVERLAY — not the stage —
       so its CSS reaches both the #beach-stage art layers and
       #beach-character, hiding the DOM backdrop the canvas now
       paints (css/style.css "Beach game (Phaser) host" section).
       The engine decision runs BEFORE setMode so the (3D-filtered)
       action bar renders in one pass. */
    overlayEl.classList.add("game-active");
    using3D = false;
    if (window.Beach3D && window.Beach3D.open(stageEl)) {
      using3D = true;
    } else if (window.BeachGame) {
      window.BeachGame.open(stageEl);
    }
    /* Always start on the sand: reopening never leaves her in the
       'boat' bar-mode from a finished ride. setMode also (re)builds
       the action bar for 'sand'. */
    setMode("sand");
    /* mission 14: push the chosen swimsuit into the canvas rig —
       immediate + 0ms + bounded rAF retries (the rig attaches inside
       Phaser's scene create, timing not fixed). */
    if (!using3D) scheduleSuitSync();
    document.getElementById("beach-close").focus({ preventScroll: true });
  }

  function close() {
    if (!cacheDom()) return;
    overlayEl.classList.add("hidden");
    openState = false;
    /* mission 14: stop any in-flight suit-sync retry; the rig is about
       to detach with the game, and the next open reschedules. */
    stopSuitSyncRetry();
    /* Reset the mode while the overlay is display:none (so any bar
       re-render lands hidden); open() calls setMode('sand') again —
       that repeat is a cheap no-op which also re-renders the
       sand-mode bar. */
    setMode("sand");
    /* Sandcastle is playtime within ONE visit: wipe stage + element
       (mirroring the mode reset above) so reopening the beach starts
       fresh. The props layer itself stays built; only our child goes. */
    castleStage = 0;
    if (castleEl) {
      removeSceneEl(castleEl);
      castleEl = null;
    }
    /* Canvas engine: full destroy on every visit — no live game
       survives a hidden overlay, and the next open() boots fresh
       (2D Phaser OR the B1 3D beach, whichever ran this visit). */
    if (using3D) {
      if (window.Beach3D) window.Beach3D.close();
      using3D = false;
    } else if (window.BeachGame) {
      window.BeachGame.close();
    }
    overlayEl.classList.remove("game-active");
    const mapButton = document.querySelector('.nav-button[data-screen="map"]');
    if (mapButton) mapButton.focus({ preventScroll: true });
  }

  function isOpen() {
    return openState;
  }

  /* ---------- Wiring ---------- */

  function init() {
    if (!cacheDom()) return;

    const closeBtn = document.getElementById("beach-close");
    if (closeBtn) closeBtn.addEventListener("click", close);

    /* The three activities this file still owns; canvas modules
       register their own through window.BeachScene.registerActivity
       (see header docs — js/beach-surf.js adds 'surfcatch'). */
    wireCastleActivity();
    /* mission 14: registered here (not later) so the 🩱 button sits
       right after 🏰 in the bar — registration order IS render order. */
    wireSwimsuitActivity();
    wireBoatHopActivity();

    /* Mission 14: a swimsuit chosen in the wardrobe while the beach
       happens to be open repaints the rig immediately. syncSuitToRig
       is already rig-guarded, and isOpen() keeps mid-boot state
       changes from doing anything. */
    if (window.GameState && typeof window.GameState.onChange === "function") {
      window.GameState.onChange(function () {
        if (isOpen() && !using3D) syncSuitToRig();
        const select = isOpen() && document.getElementById("beach-swim-style");
        if (select) select.value = window.GameState.getSwimStyle();
      });
    }

    /* Escape closes the overlay while it is open. */
    document.addEventListener("keydown", function (event) {
      if (openState && (event.key === "Escape" || event.key === "Esc")) {
        close();
      }
      /* Spacebar = tap the 🏄 button: surf exposes catchWave() and it
         is fully self-guarded (out of the water or no wave near → the
         same "Wait for a wave…" line as the button). preventDefault so
         the key never also scrolls the panel or space-activates a
         focused DOM button underneath. */
      if (openState && !using3D && (event.key === " " || event.key === "Spacebar") &&
          window.BeachSurf && typeof window.BeachSurf.catchWave === "function") {
        event.preventDefault();
        window.BeachSurf.catchWave();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  /* ---------- Public API (activity framework + DOM getters) ---------- */

  window.BeachScene = {
    open: open,
    close: close,
    isOpen: isOpen,
    registerActivity: registerActivity,
    say: say,                      // speech line for canvas modules (mission 8)
    syncSwimStatus: syncSwimStatus,
    setMode: setMode,
    getMode: getMode,
    onModeChange: onModeChange,
    reducedMotion: reducedMotion, // same helper ctx.reducedMotion uses
    get stageEl() {
      cacheDom();
      return stageEl;
    },
    get actionsEl() {
      cacheDom();
      return actionsEl;
    },
    get talkEl() {
      cacheDom();
      return talkEl;
    },
    get characterEl() {
      cacheDom();
      return characterEl;
    }
  };
})();
