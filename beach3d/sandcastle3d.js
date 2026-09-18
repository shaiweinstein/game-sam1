/* ============================================================
   beach3d/sandcastle3d.js — 3D sand-castle integration

   Skeleton (task 4): the 🏰 activity-bar button (3D only, "sand"
   mode only), the boat-style walk-then-activate flow (program
   target → stand point beside the plot → editor session) and the
   mode plumbing.

   Task 7: while phase === "building" this module also owns the
   builder toolbar DOM (#beach-sc-toolbar, appended to the beach
   stage so bar re-renders can't touch it — js/beach.js renders the
   action bar EMPTY in "castle" mode). Native buttons only: tool
   picker (aria-pressed), undo/redo, three template presets, the
   double-press reset arm and Done; plus the height-stable status
   line (beach-swim-status pattern).
   Task 8: three decor buttons (🚩 Flag / 🐚 Shell / 🌿 Seaweed) join
   the tool row after Moat — tap-to-commit placements like the stamps.

   Task 9 — BAKE ON EXIT: any builder exit while the beach stays open
   (💾 Done, Escape) turns the CURRENT session's density field into
   one static castle in the main scene:

     • mesh   = buildBakedGeometry(field) (MarchingCubes, editor's
                exact mapping) + bakeMaterial(), PLOT-local meters;
     • decor  = buildDecorMeshes(decor records), same tiny meshes;
     • root   = one THREE.Group named "sandcastleBake" at
                (PLOT.x, sandY(PLOT.x, PLOT.z), PLOT.z) — the geometry
                is PLOT-local, so the castle sits at the exact world
                position it had in the builder (no shift);
     • shadow = blob-shadow disc using world.js's exported
                blobShadowTexture(), planted at plantProp's recipe
                (+0.006 above the sand, depthWrite false, renderOrder 1);
     • obstacle = world.addObstacle({ id: "sandcastle", radius: 1.15 })
                into the same disc list moveAroundProps sweeps.

   Exit policy (decision record):
     • non-empty field  → ALWAYS bake (rebuild replaces the previous
       root; a fresh conversion is a few ms, always correct);
     • empty field, sessionDirty (Reset/undo-to-empty) → REMOVE the
       bake — clearing the castle is deliberate;
     • empty field, untouched session → keep the previous bake (user
       opened the editor, changed nothing, left);
      • beach close mid-build → NO bake: the beach (and its world) is
        being disposed; without task-10 persistence nothing could be
        shown on the next visit anyway.
    Rewarding exit (💾 Done only): deps.say talk line + character.cheer()
    one-shot. Escape leaves quietly.
    Continuity: while building, the baked root is hidden (visible=false)
    so the old bake never double-shows under the fresh session; it is
    replaced/reshown on exit.

    Task 10 — PERSISTENCE (plan §3.6 + §7): the castle lives in
    GameState's `sandcastle` key. RESOLUTION PASS 2026-09-18 versioned
    it: v:2 = { v:2, n:<runtime N>, grid:<RLE>, decor:<PLOT-LOCAL METRES> }.
    Old v:1 records (N=32 grid, cell-int decor) are DECODED AT THEIR OWN
    SIZE (decodeAny infers n from the RLE total), TRILINEARLY RESAMPLED to
    the runtime grid and their decor migrated to metres on load, so nobody
    loses an existing castle; storage is only rewritten (to v:2) once the
    player actually changes something — an untouched visit stays
    byte-identical:

      • AUTOSAVE on every editor onChange (stroke end, undo/redo,
        template, stamp, decor, reset) via saveSandcastle(); writes are
        deduped on a grid+decor key (lastSavedKey) so no-op gestures
        never touch localStorage;
      • an EMPTY castle (field base-only AND no decor) writes through
        GameState.clearSandcastle() instead — an empty build must clear
        the key, and setSandcastle(null) would be ignored by validation;
      • LOAD on beach open: getSandcastle() → decode() → non-empty field
        becomes savedField/savedDecor and is baked IMMEDIATELY (same
        bakeField the exit path uses) — the castle stands on the beach
        before the builder is ever opened, label reads "Edit sand
        castle"; a corrupt/oversized save decodes to null and is
        ignored silently (no bake, no log — quiet repo style);
      • the builder session is SEEDED from savedField/savedDecor
        (editor.open(initial)); Done/Escape refresh savedField from the
        session so the next open() re-bakes the same shape;
      • GameState.reset() clears the key → a dedicated "reset" reason
        subscription removes the bake + saved state live (the one
        justified subscription — writes stay one-way, reads at open/
        enter; no "sandcastle" subscription, no loops);
      • beach close mid-build: dispose() saves BEFORE teardown (the
        no-bake policy stays — the save makes it safe); next open()
        bakes from the save. A WebGL context loss mid-build survives
        the same way (autosave kept every stroke end).

    State machine: idle → (walking → building) → idle.
   walking cannot be canceled (short walk); a 6 s timeout guarantees
   arrival even if she is pinned elsewhere (plan §3.2).

   deps (built by beach3d.js open(), same wiring style as boat/surf):
      character    locomotion public API (setTarget/clearTarget/…)
      say(text)    BeachScene talk bubble hook
      sound(name)  GameSounds hook (used by later tasks)
      reducedMotion()  cached prefers-reduced-motion
      rideActive() true while boat/surf/catch own her — same bus they
                   use on each other, so the button is inert mid-ride
      stageEl      #beach-stage — the toolbar's host element
      GameState    js/state.js singleton (getSandcastle/setSandcastle/
                   clearSandcastle/onChange) — task 10 persistence glue
    ============================================================ */

import * as THREE from "three";
import {
  createSandcastleEditor, PLOT, buildBakedGeometry, buildDecorMeshes, bakeMaterial
} from "./sandcastle-editor.js";
import { sandY, blobShadowTexture } from "./world.js";
import { isFieldEmpty, encode, decode, decodeAny, resample, migrateDecor, N } from "./sandcastle-field.js";

const STAND = { x: -2.55, z: 1.9 };   /* walk stand point, facing the plot */
const ARRIVE_DIST = 0.35;             /* anchor distance that counts as arrival */
const WALK_TIMEOUT = 6;               /* s — guarantees the builder opens */

/* Task 9 bake constants (plan §4 / task sheet). */
const BAKE_NAME = "sandcastleBake";
const BAKE_OBSTACLE = { id: "sandcastle", radius: 1.15 };
const BAKE_SHADOW_R = 1.2;            /* blob-shadow disc radius (m) */
const BAKE_SHADOW_OP = 0.9;           /* plantProp's umbrella-scale opacity */
const DONE_TALK = "A castle fit for a crab! 🏰";

/* Toolbar copy (task 8). Decor buttons sit after Moat, before Undo —
   stamps and decor are all tap-to-commit tools. */
const TOOL_SPECS = [
  ["pile", "✋ Pile"], ["carve", "🥄 Carve"], ["smooth", "🌊 Smooth"],
  ["flatten", "📏 Flatten"], ["tower", "🗼 Tower"], ["wall", "🧱 Wall"],
  ["gate", "🏰 Gate"], ["stairs", "🪜 Stairs"], ["moat", "🕳 Moat"],
  ["flag", "🚩 Flag"], ["shell", "🐚 Shell"], ["seaweed", "🌿 Seaweed"]
];
const TOOL_HINTS = {
  pile: "Pile: drag to add sand",
  carve: "Carve: drag to scoop sand",
  smooth: "Smooth: drag to soften shapes",
  flatten: "Flatten: drag across to level sand",
  tower: "Tower: tap the ground to stamp",
  wall: "Wall: tap to stamp a wall",
  gate: "Gate: tap to cut a gateway",
  stairs: "Stairs: tap to stamp steps",
  moat: "Moat: tap to dig a ring",
  flag: "Flag: tap to plant",
  shell: "Shell: tap to place",
  seaweed: "Seaweed: tap to place"
};
/* Template presets: full names live in the title/status, short words
   on the 420px buttons. */
const TEMPLATE_SPECS = [
  ["keep", "🏰 Keep", "Classic keep", "Classic keep filled in 🏰"],
  ["fort", "🏰 Fort", "Big fort", "Big fort filled in 🏰"],
  ["mound", "🏰 Mound", "Little mound", "Little mound filled in 🏰"]
];
const RESET_ARM_MS = 3000;

export function createSandcastle(world, deps = {}) {
  const character = deps.character;
  let phase = "idle";
  let walkT = 0;
  let prevMode = null;    /* bar mode to restore on exit (boat3d.js:64) */
  let disposed = false;
  let btn = null;         /* live action-bar button, tracked via spec.mount */
  const editor = createSandcastleEditor(world, { character });

  /* Task 9 bake state — ONE baked castle at a time. */
  let bakeRoot = null;         /* THREE.Group in world.scene (or null) */
  let baked = false;
  let lastBakeMs = 0;          /* QA: last buildBakedGeometry cost (ms) */
  let sessionDirty = false;    /* any editor change since this session opened */

  /* Task 10 persistence state. savedField/savedDecor are the source of
     truth for both the beach bake (load-on-open) and the seeded builder
     session (arrive()) — a valid non-empty save only; decor rides along
     even for an empty field (a kid's shells must survive a Reset of the
     sand). lastSavedKey dedupes writes: grid AND decor, because a flag
     placed on an unchanged grid is still a save-worthy change. */
  let savedField = null;       /* Uint8Array(N³) or null (N from the field module) */
  let savedDecor = [];         /* [{ t, x, y, z }, …] */
  let saveHasCastle = false;   /* state().saved — non-empty castle in the save */
  let lastSavedKey = null;     /* dedupe key of the last write (or load) */

  function gameState() {
    return deps.GameState || window.GameState || null;
  }

  /* Stable small key for the write dedupe (decor ≤ 12 records). */
  function saveKey(grid, decor) {
    let k = grid;
    for (const d of decor || []) {
      if (d && typeof d === "object") k += "|" + d.t + "," + d.x + "," + d.y + "," + d.z;
    }
    return k;
  }

   /* ---- task 10: save --------------------------------------------------
      Serialize the LIVE editor session while building, else the last
      baked source of truth (savedField/savedDecor). One write shape
      everywhere: GameState.setSandcastle({ v:2, n:N, grid, decor }), or
      clearSandcastle() when the castle is empty (base-only field AND no
      decor) — see the module header. `n` records the grid's runtime
      resolution so a future build can resample an older save; `decor`
      is already in plot-local metres. Identical consecutive writes are
      skipped (autosave fires per gesture end; Done/Escape/close re-save
      idempotently for free). Guarded: a missing/old GameState is a
      silent no-op (session still works, nothing persists). */
   function saveSandcastle() {
     const gs = gameState();
     if (!gs || typeof gs.setSandcastle !== "function") return false;
     let field = null;
     let decor = [];
     if (editor.isActive() && editor.getField()) {
       field = editor.getField();
       decor = editor.getDecor();
     } else if (savedField) {
       field = savedField;
       decor = savedDecor;
     }
     if (!field) return false;
     const grid = encode(field);
     const key = saveKey(grid, decor);
     if (key === lastSavedKey) return false;
     if (isFieldEmpty(field) && !(decor && decor.length)) {
       /* Empty castle → the key must genuinely clear (never a stale
          save); skip the call when nothing is stored. */
       if (gs.getSandcastle?.()) gs.clearSandcastle?.();
       saveHasCastle = false;
     } else {
       gs.setSandcastle({ v: 2, n: N, grid, decor: decor || [] });
       saveHasCastle = !isFieldEmpty(field);
     }
     lastSavedKey = key;
     return true;
   }

   /* ---- task 10: load on beach open ------------------------------------
      getSandcastle() → decode (at the SAVE's OWN resolution) → a non-empty
      castle becomes the saved source of truth and is baked IMMEDIATELY
      (same bakeField the exit path uses): the castle stands on the beach
      before the builder is ever opened, obstacle included, label "Edit
      sand castle". RESOLUTION PASS: a save whose recorded/inferred n ≠
      runtime N is trilinearly resampled and its decor converted to metres
      (v:1 cell-int records) so old castles migrate instead of vanishing;
      a migrated castle renders recognizably the same. An empty castle
      (base-only) or a corrupt/oversized grid (both decoders → null) is
      treated as no castle — silently, matching the repo's quiet style;
      the stale bytes self-heal on the next real write. A decor-only
      save keeps savedField (the decoded base-only field) so the builder
      still seeds the records, but never bakes — the same rule the task
      9 exit path applies to an empty field. */
    function loadSaved() {
     const gs = gameState();
     const data = gs?.getSandcastle?.();
     savedField = null; savedDecor = []; saveHasCastle = false;
     lastSavedKey = null;
     if (!data || typeof data.grid !== "string") return false;
     /* Decode at the runtime size first (the common fresh-save fast path);
        on a length mismatch fall back to decodeAny — which infers the
        native n from the RLE total AND must agree with the record's
        declared n (a self-inconsistent {n, grid} is treated as corrupt,
        quiet-no-castle, exactly like garbage). `n` is advisory only for
        the FAST path bookkeeping; the total stays the size truth. */
     const declaredN = Number.isInteger(data.n) && data.n >= 2 && data.n <= 160
       ? data.n : null;
     let field = decode(data.grid);
     let saveN = field ? (declaredN || N) : 0;
     if (!field) {
       const any = decodeAny(data.grid, declaredN);
       if (!any) return false;                 /* corrupt/mismatched → no castle, no log */
       saveN = any.n;
       field = saveN === N ? any.field : resample(any.field, saveN);
       if (!field) return false;               /* resample rejected garbage */
     }
     /* v:1 always stored cell-int decor (N=32 design); v:2 stores metres
        whether or not its (advisory) n survived a hand-edit. The GRID
        length/resample path above stays driven by the RLE total itself. */
     savedDecor = (data.v === 1)
       ? migrateDecor(data.decor, saveN)
       : (Array.isArray(data.decor) ? data.decor : []);
     savedField = field;                    /* even base-only: seeds the session */
     saveHasCastle = !isFieldEmpty(field);
     lastSavedKey = saveKey(encode(field), savedDecor);
     if (saveHasCastle) bakeField(savedField, savedDecor);  /* mesh + obstacle + label */
     return saveHasCastle;
   }

  /* Task 7: toolbar DOM. The element is created once per beach open
     and survives builder sessions (removed from the DOM on exit,
     destroyed on beach dispose); undo/redo stacks live in the editor
     and ARE session-local. */
  let toolbar = null;
  let statusEl = null;
  let undoBtn = null;
  let redoBtn = null;
  let resetBtn = null;
  let curTool = "pile";
  let lastStatus = "";
  let resetArmed = false;
  let resetTimer = null;

  const rideActive = () => !!deps.rideActive?.();

  /* Height-stable status line: write only on change (syncSwimStatus
     pattern in js/beach.js) so the box never reflows. */
  function setStatus(text) {
    if (!statusEl || lastStatus === text) return;
    lastStatus = text;
    statusEl.textContent = text;
  }

  /* Editor → toolbar enablement (undo/redo disabled with empty
     stacks). Fires after undo/redo/stroke-end/template/reset and once
     on editor.open(). Task 9: every fire after open() also marks the
     session dirty (arrive() resets the flag AFTER open() returns, so
     the open()-fired initial callback is not counted as an edit).
     Task 10: every fire is also the AUTOSAVE point (plan §7 — every
     stroke end persists; the open()-fired fire dedupe-skips or is the
     seeded no-op). */
  editor.onChange(({ canUndo, canRedo }) => {
    sessionDirty = true;
    if (undoBtn) undoBtn.disabled = !canUndo;
    if (redoBtn) redoBtn.disabled = !canRedo;
    saveSandcastle();
  });

  /* Task 10: whole-save reset clears the sandcastle key — drop the
     bake + saved state LIVE so the beach shows an empty plot at once
     (the one justified GameState subscription; writes stay one-way,
     reads happen at open/enter — no "sandcastle" listener, no loops).
     Unsubscribed in dispose(). */
  const unsubscribeReset = gameState()?.onChange?.((snapshot, reason) => {
    if (reason !== "reset") return;
    savedField = null; savedDecor = []; saveHasCastle = false;
    lastSavedKey = null;
    removeBake();
  });

  function syncToolButtons() {
    if (!toolbar) return;
    toolbar.querySelectorAll(".beach-sc-tool[data-tool]").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.tool === curTool ? "true" : "false");
    });
  }

  /* Double-press reset (no confirm() dialogs, plan §4): the first
     press arms for 3 s, a second press inside the window clears. */
  function disarmReset(toHint) {
    const wasArmed = resetArmed;
    resetArmed = false;
    if (resetTimer !== null) { clearTimeout(resetTimer); resetTimer = null; }
    if (resetBtn) resetBtn.classList.remove("beach-sc-danger");
    if (toHint && wasArmed) setStatus(TOOL_HINTS[curTool] || TOOL_HINTS.pile);
  }

  function onResetClick() {
    if (!resetArmed) {
      resetArmed = true;
      if (resetBtn) resetBtn.classList.add("beach-sc-danger");
      setStatus("Tap Reset again to clear everything");
      resetTimer = setTimeout(() => disarmReset(true), RESET_ARM_MS);
      return;
    }
    disarmReset(false);
    if (editor.resetField()) setStatus("Cleared 🧺");
  }

  function buildToolbar() {
    const bar = document.createElement("div");
    bar.id = "beach-sc-toolbar";
    bar.className = "beach-sc-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Sand castle tools");

    for (const [id, label] of TOOL_SPECS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "beach-sc-tool";
      b.dataset.tool = id;
      b.textContent = label;
      b.setAttribute("aria-pressed", id === curTool ? "true" : "false");
      b.addEventListener("click", () => {
        if (setTool(id)) {
          curTool = id;
          syncToolButtons();
          setStatus(TOOL_HINTS[id]);
        }
      });
      bar.appendChild(b);
    }

    undoBtn = document.createElement("button");
    undoBtn.type = "button";
    undoBtn.className = "beach-sc-tool";
    undoBtn.textContent = "↩️ Undo";
    undoBtn.disabled = true;
    undoBtn.addEventListener("click", () => { if (editor.undo()) setStatus("Undone"); });
    bar.appendChild(undoBtn);

    redoBtn = document.createElement("button");
    redoBtn.type = "button";
    redoBtn.className = "beach-sc-tool";
    redoBtn.textContent = "↪️ Redo";
    redoBtn.disabled = true;
    redoBtn.addEventListener("click", () => { if (editor.redo()) setStatus("Redone"); });
    bar.appendChild(redoBtn);

    for (const [id, label, title, filled] of TEMPLATE_SPECS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "beach-sc-tool";
      b.textContent = label;
      b.title = title;
      b.setAttribute("aria-description", title);
      b.addEventListener("click", () => {
        if (editor.applyTemplate(id)) setStatus(filled);
      });
      bar.appendChild(b);
    }

    resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "beach-sc-tool";
    resetBtn.textContent = "🧺 Reset";
    resetBtn.addEventListener("click", onResetClick);
    bar.appendChild(resetBtn);

    const done = document.createElement("button");
    done.type = "button";
    done.className = "beach-sc-tool beach-sc-done";
    done.textContent = "💾 Done";
    /* Task 9: rewarding exit — bake + Cheer + talk line. */
    done.addEventListener("click", () => { exit(true); });
    bar.appendChild(done);

    statusEl = document.createElement("p");
    statusEl.className = "beach-sc-status";
    statusEl.setAttribute("role", "status");
    bar.appendChild(statusEl);
    return bar;
  }

  /* Attach before editor.open() in arrive(): open()'s change callback
     then lands on live Undo/Redo buttons, and the status line already
     shows the active tool's instruction. */
  function attachToolbar() {
    if (!deps.stageEl) return;
    if (!toolbar) toolbar = buildToolbar();
    const es = editor.state();
    curTool = es.tool || "pile";
    syncToolButtons();
    if (undoBtn) undoBtn.disabled = !es.canUndo;
    if (redoBtn) redoBtn.disabled = !es.canRedo;
    disarmReset(false);
    if (toolbar.parentNode !== deps.stageEl) deps.stageEl.appendChild(toolbar);
    setStatus(TOOL_HINTS[curTool] || TOOL_HINTS.pile);
  }

  function detachToolbar() {
    disarmReset(false);
    lastStatus = "";                      /* next attach rewrites it */
    if (toolbar && toolbar.parentNode) toolbar.parentNode.removeChild(toolbar);
  }

  /* id "sandcastle", NOT "castle": the 2D DOM builder owns that id and
     js/beach.js hides it in 3D (HIDDEN_IN_3D). */
  const spec = {
    id: "sandcastle", emoji: "🏰", label: "Build sand castle",
    modes: ["sand"], only3D: true,
    /* The bar re-renders on every register/mode change, so each fresh
       button re-applies the walk-phase disabled state. */
    mount(button) {
      btn = button;
      btn.disabled = phase === "walking";
      return () => { if (btn === button) btn = null; };
    },
    onClick: () => { enter(); }
  };

  /* ---- task 9: bake -------------------------------------------------
     The baked geometry/decor are PLOT-LOCAL (origin at the plot center
     ON the sand — see buildBakedGeometry/buildDecorMeshes comments in
     sandcastle-editor.js), so the root plants at the plot's sandY and
     everything lands exactly where the builder showed it. The shadow
     replicates world.plantProp's blobShadow recipe (CircleGeometry +
     the shared radial CanvasTexture, transparent, depthWrite false,
     renderOrder 1) at plantProp's local +0.006 height. */

  function disposeTree(root) {
    root.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry.dispose();
      const mats = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of mats) m.dispose();   /* map: blobShadowTexture is a
                                              shared CanvasTexture — the
                                              world keeps it cached. */
    });
  }

  function removeBake() {
    if (!bakeRoot) return;
    world?.removeObstacle?.(BAKE_OBSTACLE.id);
    if (bakeRoot.parent) bakeRoot.parent.remove(bakeRoot);
    disposeTree(bakeRoot);
    bakeRoot = null;
    baked = false;
    refreshButtonLabel();
  }

  /* Task 10: the single field+decor → beach-mesh conversion (formerly
     the exit-only bake): the load-on-open path and the exit path both
     call it, so a reloaded page shows EXACTLY the mesh Done would have
     produced (same geometry, material, shadow, obstacle, label). */
  function bakeField(field, decor) {
    if (!world || !world.scene) return false;
    const t0 = performance.now();
    const geo = buildBakedGeometry(field);
    lastBakeMs = +(performance.now() - t0).toFixed(1);   /* QA perf (state()) */
    if (!geo) return false;      /* no solid vertices — nothing to show */
    removeBake();                /* rebake replaces the previous castle */
    const root = new THREE.Group();
    root.name = BAKE_NAME;
    root.add(new THREE.Mesh(geo, bakeMaterial()));
    root.add(buildDecorMeshes(decor));
    const planeY = sandY(PLOT.x, PLOT.z);
    root.position.set(PLOT.x, planeY, PLOT.z);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(BAKE_SHADOW_R, 28),
      new THREE.MeshBasicMaterial({
        map: blobShadowTexture(), transparent: true,
        opacity: BAKE_SHADOW_OP, depthWrite: false
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.renderOrder = 1;
    shadow.position.y = 0.006;   /* plantProp's just-above-the-sand lift */
    root.add(shadow);
    world.scene.add(root);
    /* Walk-around disc for the character (world.addObstacle → the same
       list moveAroundProps sweeps every substep). */
    world.addObstacle?.({ id: BAKE_OBSTACLE.id, x: PLOT.x, z: PLOT.z,
      radius: BAKE_OBSTACLE.radius });
    bakeRoot = root;
    baked = true;
    refreshButtonLabel();
    return true;
  }

  /* Force a bake from the CURRENT session (tests; the exit path bakes
     by itself). No-op outside the building phase. */
  function bakeFromSession() {
    if (phase !== "building" || !editor.getField()) return false;
    return bakeField(editor.getField(), editor.getDecor());
  }

  /* The registered activity spec is static — flip the label by
     re-registering the SAME id: js/beach.js registerActivity replaces
     same id in place and re-renders the bar (verified L744-760), so
     the 🏰 button reads "Edit sand castle" whenever a bake exists. */
  function refreshButtonLabel() {
    spec.label = baked ? "Edit sand castle" : "Build sand castle";
    window.BeachScene?.registerActivity(spec);
  }

  function enter() {
    if (phase !== "idle" || rideActive()) return false;
    phase = "walking";
    walkT = 0;
    prevMode = window.BeachScene?.getMode() || "sand";
    character?.setTarget(STAND.x, STAND.z, "program");
    if (btn) btn.disabled = true;
    deps.say?.("Time to build! 🏰");
    return true;
  }

  function update(dt) {
    if (phase !== "walking" || !character) return;
    walkT += dt;
    const a = character.getAnchor();
    if (Math.hypot(a.x - STAND.x, a.z - STAND.z) <= ARRIVE_DIST ||
        walkT >= WALK_TIMEOUT) {
      arrive();
    }
  }

  function arrive() {
    phase = "building";
    character.clearTarget();
    character.setEnabled(false);
    character.facePoint(PLOT.x, PLOT.z);   /* she faces the plot */
    /* Stage-size stability (plan §5: the toolbar must not resize the
       stage): the castle bar-mode renders the action bar EMPTY and
       .beach-actions:empty display:none's it — without compensation the
       stage (and the 3D canvas inside it) would jump by the bar's own
       height the moment the builder opens, then jump back on exit.
       Measure the still-rendered sand-mode bar HERE (it still has its
       content) and publish its height as --sc-bar-h: the CSS reserves
       exactly that slot in castle mode (invisible strip kept in the
       flow) and offsets the toolbar down into it, so the stage AND the
       canvas keep their sand-mode size while building. */
    const bar = document.getElementById("beach-actions");
    if (bar && deps.stageEl) {
      const barH = Math.round(bar.getBoundingClientRect().height);
      deps.stageEl.style.setProperty("--sc-bar-h", barH + "px");
      bar.style.setProperty("--sc-bar-h", barH + "px");
    }
    window.BeachScene?.setMode("castle");  /* bar renders empty (js/beach.js) */
    attachToolbar();
    /* Task 10: seed the session from the saved castle (restore() copies,
       so the editor's field never aliases savedField); no save → fresh
       base-only field as before. open() fires the initial onChange —
       stacks start EMPTY even when seeded (session-local history), and
       the autosave dedupe-skips the unchanged seeded grid. */
    editor.open(savedField ? { field: savedField, decor: savedDecor } : null);
    sessionDirty = false;   /* the open()-fired callback is not an edit */
    /* Task 9 continuity: hide the previous bake while building so the
       fresh session's plinth is the only thing on the plot. */
    if (bakeRoot) bakeRoot.visible = false;
  }

  function exit(rewarded = false, opts = {}) {
    if (phase !== "building") return false;
    phase = "idle";
    /* Read the session state BEFORE close() drops it (getField returns
       the live Uint8Array — its bytes survive close; getDecor must be
       copied before close() empties the record list). */
    const field = editor.getField();
    const decor = editor.getDecor();
    const dirty = sessionDirty;
    sessionDirty = false;
    /* Task 10: the exit save (Done/Escape/Back) — autosave already
       caught every change, so this is a cheap idempotent re-save that
       also covers any state a future edit path might miss. */
    saveSandcastle();
    editor.close();
    detachToolbar();
    character?.setEnabled(true);
    /* Task 9: bake on any builder exit while the beach stays open.
       Non-empty field → always bake (replaces any previous root).
       Empty field → remove the bake only when the session had made
       changes (deliberate Reset/undo-to-empty), else keep + reshow
       the untouched previous castle. opts.noBake skips both (beach
       close mid-build: the world is going away — see dispose()). */
    if (opts.noBake !== true) {
      if (field && !isFieldEmpty(field)) {
        /* Task 10: the session becomes the saved source of truth — the
           next open()/save reads exactly these bytes (close() does not
           mutate them; the next session restore()s a copy). */
        savedField = field;
        savedDecor = decor;
        bakeField(field, decor);
      } else if (dirty) {
        /* Deliberate clear (Reset/undo-to-empty): drop the bake AND the
           saved source of truth. The save itself already happened via
           the reset's autosave (clearSandcastle). */
        savedField = null;
        savedDecor = [];
        removeBake();
      }
      if (bakeRoot) bakeRoot.visible = true;   /* end the building hide */
    }
    window.BeachScene?.setMode(prevMode || "sand");
    prevMode = null;
    /* Rewarding exit (💾 Done): proud talk + Cheer one-shot. Escape
       (and the test hook) leave quietly. */
    if (rewarded) {
      deps.say?.(DONE_TALK);
      character?.cheer?.();
    }
    return true;
  }

  /* Toolbar/tests: switch the tool while building (the toolbar buttons
     route through here; stamps/decor commit inside the editor's
     pointerdown handler — task 8). The editor's setTool guards the
     accepted set. */
  function setTool(t) {
    if (phase !== "building") return false;
    return editor.setTool(t);
  }

  function register() {
    window.BeachScene?.registerActivity(spec);
  }

  function unregister() {
    window.BeachScene?.unregisterActivity(spec.id, spec);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    /* Task 10: beach close mid-build → SAVE FIRST, teardown after. The
       session (if any) is still open here, so saveSandcastle serializes
       the live field — mid-build work survives the close even though
       nothing bakes into the dying world (no-bake policy unchanged).
       The next open() loads + bakes from the save. */
    saveSandcastle();
    if (unsubscribeReset) { unsubscribeReset(); }
    unregister();
    if (phase === "walking") {         /* mid-walk close: drop the target */
      character?.clearTarget();
      phase = "idle";
    }
    exit(false, { noBake: true });     /* no-op unless building — a beach
                                          close never bakes (world goes) */
    editor.close();                    /* idempotent teardown */
    removeBake();                      /* task 9: bake root + obstacle go */
    detachToolbar();                   /* beach close: toolbar DOM goes too */
    toolbar = null; statusEl = null;
    undoBtn = null; redoBtn = null; resetBtn = null;
    btn = null;
    bakeRoot = null; baked = false; sessionDirty = false;
  }

  /* Task 10: load + immediately bake a saved castle so the beach opens
     with the castle already standing (no builder visit needed). Runs at
     createSandcastle time — world.scene exists; spec.label is set
     before beach3d's register() call renders the bar. */
  loadSaved();

  /* Visual pass 2026-09-18: QA camera hook (QA-only, minimal). The
     editor's setCamView/orbitTo presets are how tests and human QA park
     the builder at a deterministic LOW side angle — the straight-down
     default camera hid the slab/mono-form problems this pass fixes, so
     every visual check must go through these. Attached here (not in
     beach3d.js) to keep the pass out of the integration module's diff;
     window.__beach3d exists at this point (beach3d.js assigns it at
     module load, before any open()). */
  if (window.__beach3d?.sandcastle) {
    window.__beach3d.sandcastle.setCamView = (name) => !!editor.setCamView?.(name);
    window.__beach3d.sandcastle.orbitTo = (az, pol, dist) => !!editor.orbitTo?.(az, pol, dist);
  }

  return {
    enter, exit, setTool,
    isActive: () => phase === "building",
    update, register, unregister, dispose, editor,
    /* Task 9: bake seam — force-bake from the live session (tests),
       plus bake state accessors. Task 10: saveSandcastle for the
       __beach3d.sandcastle.save() test hook (same dedupe-guarded path
       autosave uses). */
    bake: bakeFromSession,
    saveSandcastle,
    hasBake: () => baked,
    /* Consolidated (task 7): tool + voxel stats passthrough from the
       editor session, next to the walk/build phase. Task 9 adds the
       bake flag. Task 10 adds `saved` — a valid non-empty castle save
       exists (loaded or written this visit). */
    state: () => {
      const es = editor.state();
      return {
        phase,
        walking: phase === "walking",
        tool: es.tool,
        stats: es.stats,
        decorCount: es.decorCount,   /* task 8: decor passthrough */
        baked,                       /* task 9: castle on the beach */
        bakeMs: lastBakeMs,          /* QA: one-shot bake cost (perf report) */
        saved: saveHasCastle         /* task 10: castle in the save */
      };
    }
  };
}
