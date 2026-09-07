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
   (+ the B1 sea clamp inside character3d.js).

   Reduced motion (cached matchMedia + change listener, 2D
   pattern): the water/foam keep their resting frame, the gait
   clock freezes — control and positional movement keep working.

   Test hook: window.__beach3d (see bottom) for Playwright.
   ============================================================ */

import { createWorld, webglSupported, shorelineZ } from "./world.js";
import { createCharacter } from "./character3d.js";

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
  character = createCharacter(world.renderer, world.scene, reducedMotion);
  wireInput(world.canvas);
  opened = true;
  character.ready.then((ok) => { if (!ok) console.error("beach3d: GLB failed to load"); });
  startLoop();
  return true;
}

function close() {
  if (!opened) return;
  opened = false;
  if (loopId !== null) { cancelAnimationFrame(loopId); loopId = null; }
  /* full teardown per visit — one WebGL context per beach session,
     never a leak across open/close cycles (2D parity) */
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
      let remaining = raw;
      while (remaining > 1e-6) {
        const dt = Math.min(1 / 60, remaining);
        remaining -= dt;
        if (character) character.update(dt);
      }
      world.animate(waveT);
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
    if (p) character.setTarget(p.x, p.z, "pointer");
    ev.preventDefault();
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!character || ev.pointerId !== trackedPointer) return;
    const p = toWorld(ev);
    if (p) character.setTarget(p.x, p.z, "pointer");    /* drag re-targets */
  });
  const up = (ev) => {
    if (ev.pointerId !== trackedPointer) return;
    trackedPointer = null;
    if (character) character.clearTarget("pointer");    /* release stops */
  };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
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
  open, close,
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
  state: () => {
    if (!character) return null;
    const a = character.getAnchor();
    return {
      x: +a.x.toFixed(3), z: +a.z.toFixed(3), zone: a.zone,
      stance: character.stanceName(), moving: character.isMoving(),
      shoreZ: +shorelineZ(a.x).toFixed(3),
      waveT: +waveT.toFixed(3),
      fps, zoom: +world.zoom().toFixed(2),
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
  stop: () => character && character.clearTarget("pointer"),
  waitReady: () => (character ? character.ready : Promise.resolve(false)),
  /* deterministic walk stills: teleport + pose via a short program
     target, so screenshots land where QA aims them */
  teleport: (x, z) => character && character.teleport(x, z)
};
