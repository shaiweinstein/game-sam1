/* ============================================================
   beach3d/beach3d.js — 3D beach module entry (B1)

   Classic-script pages load this as a <script type="module">; the
   import map in index.html resolves "three" / "three/addons/" to
   the vendored lib/three/ copies (offline, no build step).

   Public surface mirrors window.BeachGame so js/beach.js can swap
   BeachGame → Beach3D in a few lines:

     window.Beach3D = {
       open(stageEl) -> bool,   close(), isOpen(),
       supported() -> bool,     reducedMotion() -> bool,
       locomotion: { getAnchor() -> {x,z,zone}, isMoving(),
                     setEnabled(b), setTarget(x,z) }
     }

   open() returns false when WebGL is missing or the scene cannot
   boot — js/beach.js then keeps the 2D Phaser beach (silent
   fallback until B6). Input is the 2D press-hold contract:
   first pointer down wins, drag re-targets, release stops —
   raycast onto the water/sand plane, clamped to the playable box
   (+ the B2 deep-edge margin inside character3d.js).

   Reduced motion (cached matchMedia + change listener, 2D
   pattern): the water/foam keep their resting frame, the gait
   clock freezes — control and positional movement keep working.

   Test hook: window.__beach3d (see bottom) for Playwright.
   ============================================================ */

import {
  createWorld, webglSupported, shorelineZ, waterSurfaceY
} from "./world.js";
import { createCharacter } from "./character3d.js";
import * as boat from "./boat3d.js";
import * as surf from "./surf3d.js";

/* Speech hook for the 3D side (B2 talk port): js/beach.js owns the
   #beach-talk bubble; BeachScene.say is the canvas-module line API
   the 2D boat/surf modules already use. Guarded — the 3D scene may
   run with the shell detached in QA harnesses. */
function sayLine(text) {
  try {
    if (window.BeachScene && typeof window.BeachScene.say === "function") {
      window.BeachScene.say(text);
    }
  } catch (e) { /* bubble gone mid-splash — cosmetic only */ }
}

/* ---------- cached prefers-reduced-motion (js/beach-game.js L201) -- */
let rmMatches = false;
try {
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  rmMatches = !!mql.matches;
  const onChange = () => { rmMatches = !!mql.matches; };
  if (typeof mql.addEventListener === "function") mql.addEventListener("change", onChange);
  else if (typeof mql.addListener === "function") mql.addListener(onChange);
} catch (e) { rmMatches = false; }
function reducedMotion() { return rmMatches; }

let world = null;
let character = null;
let hostEl = null;
let opened = false;
let loopId = null;
let supportChecked = false;
let supportedFlag = false;
let unsubscribeAppearance = null;

function syncAppearance() {
  try {
    if (!opened || !character) return Promise.resolve(false);
    const gs = window.GameState;
    const suit = gs?.getOutfit?.().swimsuit;
    const id = gs?.getCharacter?.().id;
    const suitOK = character.setSuit(
      window.CharacterRenderer?.catalog?.swimsuit?.[suit]?.colors ? suit : "suit1"
    );
    return character.setFriend(id || "lily").then(friendOK => suitOK && friendOK);
  } catch (e) { return Promise.resolve(false); }
}

function supported() {
  if (!supportChecked) {
    supportChecked = true;
    supportedFlag = webglSupported();
  }
  return supportedFlag;
}

/* ---------- open / close ---------- */

function open(stageEl) {
  if (opened) return true;
  if (!supported() || !stageEl) return false;
  hostEl = document.createElement("div");
  hostEl.className = "beach3d-host";
  hostEl.style.cssText = "position:absolute;inset:0;z-index:3;overflow:hidden";
  stageEl.appendChild(hostEl);
  try {
    world = createWorld(hostEl);
  } catch (e) {
    hostEl.remove(); hostEl = null;
    supportedFlag = false;
    return false;
  }
  character = createCharacter(world.renderer, world.scene, reducedMotion, {
    splash: (x, z) => world.splash(x, z),
    talk: sayLine
  });
  boat.attach(world, character, world.renderer, {
    sound: (name) => window.GameSounds?.play(name)
  }, sayLine);
  surf.attach(world, character, world.renderer, {
    sound: (name) => window.GameSounds?.play(name)
  }, sayLine, {
    rideActive: boat.active,
    beforeCatch: () => {
      /* Cancel a pending auto-board without changing B3's invitation API. */
      if (boat.state()?.mode === "invited") boat.onPointerDown({});
      if (trackedPointer !== null) pointerWasRide = true;
    }
  });
  trackedPointer = null;
  wireInput(world.canvas);
  opened = true;
  const loadingCharacter = character;
  character.ready.then((ok) => {
    if (!opened || character !== loadingCharacter) return;
    if (!ok) console.error("beach3d: GLB failed to load");
    else syncAppearance();
  });
  unsubscribeAppearance = window.GameState?.onChange?.(syncAppearance) || null;
  startLoop();
  return true;
}

function close() {
  if (!opened) return;
  opened = false;
  if (unsubscribeAppearance) { unsubscribeAppearance(); unsubscribeAppearance = null; }
  if (loopId !== null) { cancelAnimationFrame(loopId); loopId = null; }
  /* full teardown per visit — one WebGL context per beach session,
     never a leak across open/close cycles (2D parity) */
  surf.dispose();
  boat.dispose();
  trackedPointer = null;
  if (character) character.dispose();
  if (world) world.dispose();
  character = null;
  world = null;
  if (hostEl) { hostEl.remove(); hostEl = null; }
}

/* ---------- frame loop (adaptive pixel scale, spike3 pattern) ---------- */

let frames = 0, fpsWindow = 0, fps = 0;
let lastT = 0, waveT = 0;

function startLoop() {
  lastT = performance.now();
  const tick = (now) => {
    if (!opened) return;
    loopId = requestAnimationFrame(tick);
    /* real-time locomotion even on long frames: substep ≤1/60,
       capped so a tab-out never teleports her (2D LOCO slices) */
    const raw = Math.min((now - lastT) / 1000, 0.5);
    lastT = now;
    const rm = reducedMotion();
    if (!rm) waveT += raw;
    if (world) {
      /* Surf's analytic movement cannot overshoot its target. Rebuild the
         wave once per render, not for every character/boat integration step. */
      surf.update(raw, waveT, rm);
      let remaining = raw;
      while (remaining > 1e-6) {
        const dt = Math.min(1 / 60, remaining);
        remaining -= dt;
        boat.update(dt, waveT, rm);
        if (character) character.update(dt, waveT);
      }
      world.stepZoom(raw);
      if (character) {
        /* B2-cam: the zone-driven two-framing camera (world.js
           camera block) — LAND = the exact B1 shot, SEA = the gentle
           follow rig on her eased root */
        const a = surf.getCameraAnchor() || boat.getCameraAnchor() || character.getAnchor();
        world.updateCamera(raw, rm, a.x, a.y ?? character.getRootY(), a.z, a.zone);
      }
      world.animate(waveT, raw, rm);
      world.render();
    }
    frames++; fpsWindow += raw;
    if (fpsWindow >= 0.5) {
      fps = Math.round(frames / fpsWindow);
      frames = 0; fpsWindow = 0;
      if (world) world.noteWindow(fps);
    }
  };
  loopId = requestAnimationFrame(tick);
}

/* ---------- pointer input (press-hold, first-down-wins, 2D) ---------- */

let trackedPointer = null;      /* first-down pointerId (one-pointer) */
let pointerWasRide = false;     /* auto-hop never hands an old hold to swimming */

function wireInput(canvas) {
  const toWorld = (ev) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const nx = ((ev.clientX - r.left) / r.width) * 2 - 1;
    const ny = -(((ev.clientY - r.top) / r.height) * 2 - 1);
    return world.pickGround(nx, ny);
  };
  canvas.addEventListener("pointerdown", (ev) => {
    if (!character || trackedPointer !== null) return;   /* first wins */
    trackedPointer = ev.pointerId;
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
    const p = toWorld(ev);
    if (!surf.onPointerDown(ev) && !boat.onPointerDown(ev) && p) character.setTarget(p.x, p.z, "pointer");
    pointerWasRide = surf.active() || boat.active();
    ev.preventDefault();
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!character || ev.pointerId !== trackedPointer) return;
    if (pointerWasRide && !surf.active() && !boat.active()) return;
    if (surf.active() || boat.active()) pointerWasRide = true;
    const p = toWorld(ev);
    if (!surf.onPointerMove(ev) && !boat.onPointerMove(ev) && p) character.setTarget(p.x, p.z, "pointer");
  });
  const up = (ev) => {
    if (ev.pointerId !== trackedPointer) return;
    trackedPointer = null;
    pointerWasRide = false;
    boat.onPointerUp(ev);
    surf.onPointerUp(ev);
    if (character) character.clearTarget("pointer");    /* release stops */
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  canvas.addEventListener("lostpointercapture", up);
  /* gentle wheel zoom 0.8×–1.6× */
  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    world.setZoom(world.zoom() * Math.exp(ev.deltaY * 0.0012));
  }, { passive: false });

  /* two-finger pinch = the same gentle zoom (the first finger keeps
     owning locomotion — the one-pointer contract is untouched) */
  const live = new Map();     /* pointerId -> {x,y} client coords */
  let pinchD0 = 0, pinchZ0 = 1;
  canvas.addEventListener("pointerdown", (ev) => {
    live.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (live.size === 2) {
      const [a, b] = [...live.values()];
      pinchD0 = Math.hypot(a.x - b.x, a.y - b.y);
      pinchZ0 = world.zoom();
    }
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!live.has(ev.pointerId)) return;
    live.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (live.size === 2 && pinchD0 > 8) {
      const [a, b] = [...live.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      world.setZoom(pinchZ0 * (d / pinchD0));
    }
  });
  const liveUp = (ev) => {
    live.delete(ev.pointerId);
    if (live.size < 2) pinchD0 = 0;
  };
  canvas.addEventListener("pointerup", liveUp);
  canvas.addEventListener("pointercancel", liveUp);
}

/* ---------- public surface (mirrors window.BeachGame) ---------- */

window.Beach3D = {
  open, close, syncAppearance,
  isOpen: () => opened,
  supported,
  reducedMotion,
  locomotion: {
    getAnchor: () => (character ? character.getAnchor() : null),
    isMoving: () => !!(character && character.isMoving()),
    setEnabled: (b) => character && character.setEnabled(b),
    setTarget: (x, z) => !!(character && character.setTarget(x, z, "program"))
  }
};

/* ---------- test hook (Playwright) ---------- */

window.__beach3d = {
  syncAppearance,
  appearance: () => character?.appearance() || null,
  setSuit: id => character?.setSuit(id) || false,
  setFriend: id => character?.setFriend(id) || Promise.resolve(false),
  state: () => {
    if (!character) return null;
    const a = character.getAnchor();
    return {
      x: +a.x.toFixed(3), z: +a.z.toFixed(3), zone: a.zone,
      stance: character.stanceName(), moving: character.isMoving(),
      boat: boat.state(),
      surf: surf.state(),
      cameraAnchor: surf.getCameraAnchor() || boat.getCameraAnchor(),
      shoreZ: +shorelineZ(a.x).toFixed(3),
      rootY: +character.getRootY().toFixed(3),
      waterY: +waterSurfaceY(a.x, a.z, waveT).toFixed(3),
      splashes: world ? world.splashCount() : 0,
      waveT: +waveT.toFixed(3),
      fps, zoom: +world.zoom().toFixed(2),
      /* B2-cam QA: the actual camera position + which framing owns
         it ("land" = exact B1 shot, "sea" = follow rig/glide) */
      cam: world ? [
        +world.camera.position.x.toFixed(3),
        +world.camera.position.y.toFixed(3),
        +world.camera.position.z.toFixed(3)
      ] : null,
      camMode: world ? world.camMode() : null,
      /* full-precision camera position (debug: 3-decimal cam can
         alias a mid-glide frame into a settled-looking value) */
      camFull: world ? [
        world.camera.position.x,
        world.camera.position.y,
        world.camera.position.z
      ] : null,
      /* no-pop audit (get-and-clear): max per-frame camera travel
         (m) and max real-time speed (m/s) since the last state() */
      camStep: world ? world.camStep() : 0,
      camSpeed: world ? world.camSpeed() : 0,
      renderer: world.renderer ? {
        calls: world.renderer.info.render.calls,
        tris: world.renderer.info.render.triangles,
        geometries: world.renderer.info.memory.geometries,
        textures: world.renderer.info.memory.textures
      } : null,
      rm: reducedMotion()
    };
  },
  setTarget: (x, z) => window.Beach3D.locomotion.setTarget(x, z),
  boat: boat.state,
  boatBoard: () => !surf.active() && boat.board(),
  boatHop: boat.hop,
  boatSetTarget: (x, z) => boat.active() && boat.onPointerDown({ x, z }),
  boatRelease: () => boat.onPointerUp(),
  surf: surf.state,
  surfToggle: () => surf.setSurfing(!surf.state()?.enabled),
  surfCatch: surf.catchWave,
  surfWave: surf.spawnWave,
  surfSetTarget: (x) => surf.onPointerDown({ x }),
  surfRelease: () => surf.onPointerUp(),
  stop: () => character && character.clearTarget("pointer"),
  /* active AnimationAction audit (clip/weight/time/timeScale) */
  action: () => (character ? character.actionInfo() : null),
  /* QA: world-space Y of named bones (swim waterline audit) */
  boneY: (names) => (character ? character.boneHeights(names) : null),
  waitReady: () => (character ? character.ready : Promise.resolve(false)),
  /* deterministic walk/swim stills: teleport + pose via a short
     program target, so screenshots land where QA aims them */
  teleport: (x, z) => character && character.teleport(x, z),
  /* force a waterline splash (QA of the B2 helper B3/B4 reuse) */
  splash: (x, z) => !!(world && world.splash(x, z)),
  /* QA framing: the gentle zoom is reachable without a wheel event */
  setZoom: (k) => { if (world) world.setZoom(k); },
  /* QA close-ups: world point → page CSS px */
  project: (x, y, z) => (world ? world.project(x, y, z) : null),
  /* QA: bake one frozen pose at clip time s (RM park-frame picking) */
  probePose: (s) => character && character.probePose(s)
};
