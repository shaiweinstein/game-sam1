/* ============================================================
   beach3d/character3d.js — Lily 4 + B1 locomotion

   Loads beach3d/assets/lily4_full.glb (8 Mixamo clips, 65 bones),
   toonifies exactly like spike3 and drives the AnimationMixer from
   a stance map. Movement uses the 2D press-hold RULES ported from
   js/beach-game.js stepLocomotion/driveRig (zone speeds, ease-out
   near the target with a speed FLOOR, snap-stop, stance =
   zone × moving). The pointer plumbing (first-down-wins, program
   targets surviving release) lives in beach3d.js and drives the
   setTarget/clearTarget API here.

   B1 stances: stand→Idle, walk→Walk, wade→Walk (slower timeScale,
   water over her lower legs). The map already carries one-line
   entries for B2+ (swim→Swim, float→Idle+bob, ride→Sit,
   surf→SurfRide); those clips are loaded and cached on open.

   Root-lift (B0 note): the Walk clip's deepest sole contact is
   −0.144 m and Idle's −0.016 m — the model node is lifted per
   stance so the deepest touch lands exactly on the sand surface
   (she never clips through it); the lift eases with the crossfade.
   ============================================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { toonify, blobShadowTexture, shorelineZ, sandY, zoneAt, WORLD } from "./world.js";

const GLB_URL = new URL("./assets/lily4_full.glb", import.meta.url).href;

/* 2D LOCO_SPEED { sand .25, foam .18, sea .30 } width-units/s scaled
   to ≈1.05 body-lengths/s (spec B1). sea is the B2 swim speed. */
export const LOCO_SPEED = { sand: 1.10, foam: 0.80, sea: 1.32 };
/* 2D ease/stop ratios kept at the B1 meter scale: full gait past
   0.45 m from the target, floor 0.45, snap-stop within 0.12 m. */
const LOCO_EASE_RANGE = 0.45;
const LOCO_MIN_SPEED = 0.45;
const LOCO_STOP_DIST = 0.12;

/* B1 sea clamp — the ONE line to remove for B2 swimming: no target
   or position may pass shoreline − SEA_CLAMP_Z. (world.js documents
   the same note; set to Infinity-adjacent negative in B2.) */
export const SEA_CLAMP_Z = 0.10;

/* stance → { clip, timeScale at full speed, root-lift m, bob } */
const STANCES = {
  stand: { clip: "Idle", ts: 1.00, lift: 0.017 },
  walk:  { clip: "Walk", ts: 1.00, lift: 0.145 },
  wade:  { clip: "Walk", ts: 0.80, lift: 0.145 },
  /* pre-wired for B2/B3/B4 — one line each, clips already cached: */
  swim:  { clip: "Swim", ts: 1.00, lift: 0.0, water: true },
  float: { clip: "Idle", ts: 0.60, lift: 0.0, water: true, bob: true },
  ride:  { clip: "Sit",  ts: 1.00, lift: 0.111 },
  surf:  { clip: "SurfRide", ts: 1.00, lift: 0.171 }
};

/* The glTF model faces +Z (B0 build convention). If a still ever
   shows moonwalking this constant flips by π. */
const FWD_YAW = 0;

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

export function createCharacter(renderer, scene, reducedMotion) {
  const mixRoot = new THREE.Group();      /* position + yaw */
  const model = new THREE.Group();        /* root lift lives here */
  mixRoot.add(model);
  scene.add(mixRoot);

  /* blob shadow rides with her, flat on the sand surface */
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 32),
    new THREE.MeshBasicMaterial({
      map: blobShadowTexture(), transparent: true, depthWrite: false
    })
  );
  shadow.rotation.x = -Math.PI / 2;
  scene.add(shadow);

  const loco = {
    x: WORLD.rest.x, z: WORLD.rest.z,
    yaw: 0, yawTarget: 0,                   /* face the camera on open */
    target: null,                           /* {x,z} or null */
    targetSrc: null,                        /* "pointer" | "program" | null */
    enabled: true,
    moving: false,
    stance: "stand",
    zone: zoneAt(WORLD.rest.x, WORLD.rest.z),
    lift: STANCES.stand.lift,
    speed01: 1
  };

  let mixer = null;
  const actions = {};          /* clipName -> AnimationAction */
  let current = null;          /* { clipName, action } */
  let ready = false;

  const readyPromise = new Promise((resolve) => {
    new GLTFLoader().load(GLB_URL, (gltf) => {
      toonify(gltf.scene, renderer);
      model.add(gltf.scene);
      mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        const a = mixer.clipAction(clip);
        a.setLoop(THREE.LoopRepeat, Infinity);
        actions[clip.name] = a;
      }
      /* start on Idle */
      const first = actions[STANCES.stand.clip];
      first.reset();
      first.play();
      current = { clipName: STANCES.stand.clip, action: first };
      ready = true;
      parkIfNeeded();
      resolve(true);
    }, undefined, () => resolve(false));
  });

  const stanceCfg = () => STANCES[loco.stance] || STANCES.stand;

  /* gait rate: full ts when idle (breathing Idle), ease-following
     ts while walking (2D: actual displacement drives the gait). */
  function applyTimeScale() {
    if (!ready || !current) return;
    if (reducedMotion()) { current.action.setEffectiveTimeScale(0); return; }
    const cfg = stanceCfg();
    const f = loco.moving ? cfg.ts * loco.speed01 : cfg.ts;
    current.action.setEffectiveTimeScale(f);
  }

  /* reduced motion: clock frozen — park the pose at frame 0 (a
     clean contact frame) whenever the stance swaps. */
  function parkIfNeeded() {
    if (ready && reducedMotion() && current) current.action.time = 0;
  }

  function setStance(name) {
    if (!STANCES[name] || name === loco.stance || !ready) return;
    const cfg = STANCES[name];
    const next = actions[cfg.clip];
    if (!next) return;
    const sameAction = current && current.action === next;
    loco.stance = name;
    if (sameAction) {                      /* walk→wade: same clip */
      applyTimeScale();
      return;
    }
    next.reset();
    next.setEffectiveWeight(1);
    next.play();
    if (current) current.action.fadeOut(0.18);
    current = { clipName: cfg.clip, action: next };
    applyTimeScale();
    parkIfNeeded();
  }

  /* ---------- the B1 sea clamp + playable box (one place) ---------- */
  function clampPoint(x, z) {
    const b = WORLD.box;
    const tx = clamp(x, b.xMin, b.xMax);
    let tz = clamp(z, b.zMin, b.zMax);
    tz = Math.max(tz, shorelineZ(tx) - SEA_CLAMP_Z);   /* ← remove in B2 */
    return { x: tx, z: tz };
  }

  /* ---------- one locomotion tick (2D stepLocomotion port, meters) ---------- */
  function step(dt) {
    const t = loco.target;
    if (!t) { loco.moving = false; return; }
    const dx = t.x - loco.x, dz = t.z - loco.z;
    const dist = Math.hypot(dx, dz);
    if (dist < LOCO_STOP_DIST) {
      loco.moving = false;
      loco.target = null; loco.targetSrc = null;
      return;
    }
    const factor = clamp(
      LOCO_MIN_SPEED + (1 - LOCO_MIN_SPEED) * Math.min(1, dist / LOCO_EASE_RANGE),
      LOCO_MIN_SPEED, 1);
    const v = (LOCO_SPEED[loco.zone] || LOCO_SPEED.sand) * factor;
    let stepLen = v * dt;
    if (stepLen > dist) stepLen = dist;          /* snap-arrive exactly */
    loco.x += (dx / dist) * stepLen;
    loco.z += (dz / dist) * stepLen;
    const clamped = clampPoint(loco.x, loco.z);
    loco.x = clamped.x; loco.z = clamped.z;
    loco.moving = true;
    loco.speed01 = factor;   /* gait rate follows the ease (2D) */
    /* zone from the NEW position (2D uses the returned anchor);
       a change here is the future B2 splash/entry hook */
    const zn = zoneAt(loco.x, loco.z);
    if (zn !== loco.zone) loco.zoneCrossed = zn;  /* B2 reads + clears */
    loco.zone = zn;
    /* stance table (2D driveRig): sea→swim/float (B2), foam moving→
       wade, land moving→walk; the idle half lives in update(). */
    setStance(zn === "sea" ? "swim" : zn === "foam" ? "wade" : "walk");
    /* yaw toward the movement direction (smoothed in update) */
    loco.yawTarget = Math.atan2(dx, dz) + FWD_YAW;
  }

  /* ---------- per-frame entry (beach3d.js owns the loop) ---------- */
  function update(dt) {
    if (!ready) return;
    if (loco.enabled && dt > 0) step(dt);

    /* smooth yaw, exponential damping ~10/s (spec) */
    const k = 1 - Math.exp(-10 * dt);
    let d = loco.yawTarget - loco.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 0.003) loco.yaw += d * k;
    else loco.yaw = loco.yawTarget;

    /* stopped → stand everywhere B1 allows (2D: foam idle also
       stands; sea idle becomes "float" in B2 via the stance map) */
    if (!loco.moving && loco.stance !== "stand") setStance("stand");

    /* plant on the sand: eased root lift + surface height. water:
       true stances (B2) will float at the surface instead. */
    const cfg = stanceCfg();
    loco.lift += (cfg.lift - loco.lift) * (1 - Math.exp(-12 * dt));
    const gy = sandY(loco.x, loco.z);
    mixRoot.position.set(loco.x, 0, loco.z);
    mixRoot.rotation.y = loco.yaw;
    model.position.y = gy + loco.lift;
    shadow.position.set(loco.x, gy + 0.008, loco.z);

    applyTimeScale();
    mixer.update(reducedMotion() ? 0 : dt);
  }

  /* ---------- locomotion public surface (mirrors BeachGame) ---------- */
  return {
    ready: readyPromise,
    root: mixRoot,
    loco,
    setTarget(x, z, src) {
      if (!loco.enabled || !isFinite(x) || !isFinite(z)) return false;
      loco.target = clampPoint(x, z);
      loco.targetSrc = src || "program";
      return true;
    },
    /* release stops ONLY pointer-held targets (program targets —
       the B3 boat auto-swim — survive pointerup, 2D parity) */
    clearTarget(src) {
      if (loco.target && (!src || loco.targetSrc === src)) {
        loco.target = null;
        loco.targetSrc = null;
      }
    },
    setEnabled(b) {
      loco.enabled = !!b;
      if (!b) {
        loco.target = null; loco.targetSrc = null;
        loco.moving = false;
      }
    },
    isMoving() { return !!(loco.enabled && loco.moving); },
    getAnchor() { return { x: loco.x, z: loco.z, zone: loco.zone }; },
    stanceName() { return loco.stance; },
    /* QA/test hook: snap-place instantly (no walk time) */
    teleport(x, z) {
      const p = clampPoint(x, z);
      loco.x = p.x; loco.z = p.z;
      loco.target = null; loco.targetSrc = null; loco.moving = false;
      loco.zone = zoneAt(p.x, p.z);
    },
    /* full teardown with the world (one context per beach visit) */
    dispose() {
      ready = false;
      if (mixer) mixer.stopAllAction();
      model.traverse((o) => {
        if (o.isMesh && o.geometry) o.geometry.dispose();
      });
      scene.remove(mixRoot);
      scene.remove(shadow);
      shadow.geometry.dispose();
      shadow.material.dispose();
    },
    reset() {
      loco.x = WORLD.rest.x; loco.z = WORLD.rest.z;
      loco.yaw = loco.yawTarget = 0;
      loco.target = null; loco.targetSrc = null;
      loco.enabled = true; loco.moving = false;
      loco.zone = zoneAt(loco.x, loco.z);
      if (ready) {
        loco.stance = "walk";          /* force the re-push */
        setStance("stand");
        mixer.setTime(0);
      }
    },
    update
  };
}
