/* ============================================================
   beach3d/character3d.js — Lily 4 + locomotion (B1 walk/wade,
   B2 swim/float)

   Loads beach3d/assets/lily4_full.glb (8 Mixamo clips, 65 bones),
   toonifies exactly like spike3 and drives the AnimationMixer from
   a stance map. Movement uses the 2D press-hold RULES ported from
   js/beach-game.js stepLocomotion/driveRig (zone speeds, ease-out
   near the target with a speed FLOOR, snap-stop, stance =
   zone × moving). The pointer plumbing (first-down-wins, program
   targets surviving release) lives in beach3d.js and drives the
   setTarget/clearTarget API here.

   Stances (2D driveRig table, sea half landed in B2):
     stand→Idle · walk→Walk · wade→Walk (slow ts, water at shins)
     swim→Swim  (prone crawl, root y rides the water surface:
                 node origin SWIM_SINK below it → mid-torso
                 waterline per the B0 clip data)
     float→Swim at a slow crawl + gentle bob (face-down treading)
     ride→Sit · surf→SurfRide (pre-wired for B3/B4, clips cached)

   Root-lift (B0 note): the Walk clip's deepest sole contact is
   −0.144 m and Idle's −0.016 m — the model node is lifted per
   stance so the deepest touch lands exactly on the sand surface
   (she never clips through it). Land/water heights share ONE eased
   root-y channel, so wade→swim sinks and swim→wade rises
   continuously (no snapping) while the clip crossfades.

   B2 sea reach: the B1 shore clamp is GONE — the sea is playable
   to the deep-edge margin SEA_DEEP_Z. In the sea she glides:
   release decelerates into the float stance (no ground friction
   in water; the 2D snap-stop stays on land/foam).
   ============================================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  toonify, blobShadowTexture, sandY, zoneAt, waterSurfaceY, WORLD
} from "./world.js";

const GLB_URL = new URL("./assets/lily4_full.glb", import.meta.url).href;
const friendFaces = new Map();
const cachedFaceTextures = new Set();

function friendFace(id, baked) {
  if (id === "lily") return Promise.resolve(baked);
  if (!friendFaces.has(id)) {
    const pending = new THREE.TextureLoader().loadAsync(
      new URL(`./assets/face_${id}.png`, import.meta.url).href
    ).then(texture => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false; // glTF's UV convention, unlike TextureLoader's default
      texture.anisotropy = baked.anisotropy;
      cachedFaceTextures.add(texture);
      return texture;
    }).catch(() => {
      friendFaces.delete(id); // allow a later open to retry a failed local fetch
      return null;
    });
    friendFaces.set(id, pending);
  }
  return friendFaces.get(id);
}

/* 2D LOCO_SPEED { sand .25, foam .18, sea .30 } width-units/s scaled
   to ≈1.05 body-lengths/s (spec B1). sea is the B2 swim speed
   (≈1.32 m/s ≈ 1.3 body-lengths/s — spec band 1.2–1.3). */
export const LOCO_SPEED = { sand: 1.10, foam: 0.80, sea: 1.32 };
/* 2D ease/stop ratios kept at the B1 meter scale: full gait past
   0.45 m from the target, floor 0.45, snap-stop within 0.12 m. */
const LOCO_EASE_RANGE = 0.45;
const LOCO_MIN_SPEED = 0.45;
const LOCO_STOP_DIST = 0.12;

/* B2 replaces the B1 shore clamp with a DEEP-EDGE margin: she swims
   all the way to the far water but stays this side of z −6.5 —
   past it come the wave crest sheets (z −6.8…−3.4) and the styled
   horizon band, and the seabed keeps falling (bedTo −7.0). The
   foam band is untouched: it stays the wade zone. */
export const SEA_DEEP_Z = -6.5;

/* Swim/float root sink — node origin this far BELOW the animated
   water surface. MEASURED on the shipped head-up clip (boneY audit,
   node-relative world-Y over the stroke cycle): hips −0.07…−0.04,
   mid-spine −0.05…−0.03, upper-chest (Spine2) −0.01…+0.02, neck
   +0.03…+0.06, head bone +0.02…+0.05. 0.065 puts the waterline at
   the chin/upper-chest of the head-up freestyle stroke: face just
   clear (breathing side only — no crescent), back + shoulders at
   the surface, hips/thighs/legs submerged and visible through the
   0.9-alpha toon water. (B2-swim2: the clip was converted from
   face-down crawl to head-up in build_lily4_full.py §6c, which
   changed this measurement; the value itself is unchanged.) */
export const SWIM_SINK = 0.065;
/* swim gait rate = actual speed ÷ full-speed ref, clamped to the
   spec band; float idles the SAME clip at a slow crawl. */
const SWIM_TS_MIN = 0.5, SWIM_TS_MAX = 1.4;
const FLOAT_TS = 0.25;
/* float bob: head-up treading, ±2 cm at 0.4 Hz on the wave clock
   (frozen with the clock under reduced motion). */
const BOB_AMP = 0.02, BOB_HZ = 0.4;
/* water glide (release → float): velocity eases out instead of the
   land snap-stop; ~0.2 m of drift before she settles. */
const GLIDE_RATE = 5.0, GLIDE_STOP_SPEED = 0.05;
/* shared eased root-y + clip crossfade for the wade↔swim sink/rise
   (≈0.3 s to be visually seamless, spec 0.25–0.35 s). */
const ROOT_Y_RATE = 9.0, CROSSFADE = 0.30;
/* the one 2D water talk line (js/beach-boat.js disembark — same
   event: dropping INTO the sea with a splash). */
const SPLASH_TALK = "Splash! 🌊";

/* stance → { clip, timeScale at full speed, root-lift m, water, bob } */
const STANCES = {
  stand: { clip: "Idle", ts: 1.00, lift: 0.017 },
  walk:  { clip: "Walk", ts: 1.00, lift: 0.145 },
  wade:  { clip: "Walk", ts: 0.80, lift: 0.145 },
  swim:  { clip: "Swim", ts: 1.00, water: true },
  float: { clip: "Swim", ts: FLOAT_TS, water: true, bob: true },
  /* pre-wired for B3/B4 — one line each, clips already cached: */
  ride:  { clip: "Sit",  ts: 1.00, lift: 0.111 },
  surf:  { clip: "SurfRide", ts: 1.00, lift: 0.171 }
};

/* The glTF model faces +Z (B0 build convention). If a still ever
   shows moonwalking this constant flips by π. */
const FWD_YAW = 0;

/* waterline foam break: soft white ellipse sprite (2D parity: the
   paintSubmerge surface-ellipse pair — without the break the prone
   body at game-camera scale reads as a grey smudge; the line is
   what sells "half of her is UNDER"). Module-cached texture. */
let _foamBreakTex = null;
function foamBreakTexture() {
  if (_foamBreakTex) return _foamBreakTex;
  const s = 64;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  _foamBreakTex = new THREE.CanvasTexture(c);
  _foamBreakTex.colorSpace = THREE.SRGBColorSpace;
  return _foamBreakTex;
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* fx (optional): { splash(x, z), talk(text) } — waterline splash
   VFX + speech hook, wired by beach3d.js to world.splash and
   BeachScene.say. */
export function createCharacter(renderer, scene, reducedMotion, fx) {
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

  /* waterline foam break — child of mixRoot so it rides position +
     yaw for free; local y = live surface height each frame */
  const foamRing = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: foamBreakTexture(), transparent: true, opacity: 0,
      depthWrite: false, side: THREE.DoubleSide
    })
  );
  foamRing.rotation.x = -Math.PI / 2;
  /* across × along the body — B2 audit: the original 0.44×0.86 ellipse
     hid behind her silhouette; 0.9×1.5 wraps the ~0.9 m prone body so
     the white waterline break reads from side and front, matching the
     2D submerge-ellipse reference. */
  foamRing.scale.set(0.9, 1.5, 1);
  foamRing.position.set(0, 0, 0.06);          /* chest sits fwd of origin */
  foamRing.renderOrder = 4;                   /* above water 2, sheets 3 */
  foamRing.visible = false;
  mixRoot.add(foamRing);

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
    speed01: 1,
    /* B2: smoothed world velocity (sea glide) + the single eased
       root height shared by land (sandY+lift) and water (surface−
       sink) so every height change lerps, never snaps. */
    vx: 0, vz: 0,
    rootY: sandY(WORLD.rest.x, WORLD.rest.z) + STANCES.stand.lift,
    snapY: false,                           /* teleport → plant instantly */
    foam: 0                                 /* waterline break fade 0..1 */
  };

  let mixer = null;
  const actions = {};          /* clipName -> AnimationAction */
  let current = null;          /* { clipName, action } */
  let ready = false;
  let disposed = false;
  let rideDriven = false, ridePaddling = false;
  let rideStance = "ride", rideSurfaceY = null;
  let lastWaveT = 0;
  const materials = new Map();
  const suitMeshes = { one: [], tank: [], crop: [] };
  let bakedFace = null;
  let requestedSuit = "suit1", requestedFriend = "lily";
  let appliedSuit = null, appliedFriend = null, suitKey = null;
  let pendingFriend = null;

  function recolor(name, color, emissive = false) {
    for (const m of materials.get(name) || []) {
      m.color.set(color);
      if (emissive) m.emissive.copy(m.color).multiplyScalar(0.34);
    }
  }

  function setSuit(id) {
    try {
      const colors = window.CharacterRenderer?.catalog?.swimsuit?.[id]?.colors;
      if (disposed || typeof id !== "string" || !colors) return false;
      requestedSuit = id;
      if (!ready) return false;
      const group = colors.twoPiece ? (id === "suit5" ? "crop" : "tank") : "one";
      const key = [id, colors.main, colors.trim, colors.bottom, group].join("|");
      if (suitKey === key) return true;
      for (const [name, meshes] of Object.entries(suitMeshes)) {
        for (const mesh of meshes) mesh.visible = name === group;
      }
      // The original torso loft has inward faces, previously covered by the
      // one-piece. Render both sides when the crop exposes that midriff.
      for (const m of materials.get("skin") || []) {
        const side = group === "crop" ? THREE.DoubleSide : THREE.FrontSide;
        if (m.side !== side) { m.side = side; m.needsUpdate = true; }
      }
      const prefix = group === "one" ? "suit" : group === "tank" ? "suitTank" : "suitCrop";
      recolor(prefix + "Main", colors.main, true);
      recolor(prefix + "Trim", colors.trim, true);
      recolor(prefix + "Bottom", colors.bottom, true);
      // Only Sunny has white flower petals; the other one-pieces get a trim emblem.
      recolor("daisyPetal", id === "suit1" ? "#fff9ec" : colors.trim, true);
      appliedSuit = id;
      suitKey = key;
      return true;
    } catch (e) { return false; }
  }

  function setFriend(id) {
    try {
      const palette = window.CHARACTERS?.[id];
      if (disposed || !["lily", "amara", "mei", "sofia"].includes(id) || !palette) {
        return Promise.resolve(false);
      }
      requestedFriend = id;
      if (!ready || !bakedFace) return Promise.resolve(false);
      if (appliedFriend === id) return Promise.resolve(true);
      if (pendingFriend?.id === id) return pendingFriend.promise;
      const promise = friendFace(id, bakedFace).then(texture => {
        if (!texture || disposed || requestedFriend !== id) return false;
        recolor("skin", palette.skin);
        recolor("hairMain", palette.hairMain);
        recolor("hairShade", palette.hairShade);
        for (const m of materials.get("faceTexture") || []) {
          m.map = texture;
          m.needsUpdate = true;
        }
        appliedFriend = id;
        return true;
      }).catch(() => false).finally(() => {
        if (pendingFriend?.promise === promise) pendingFriend = null;
      });
      pendingFriend = { id, promise };
      return promise;
    } catch (e) { return Promise.resolve(false); }
  }

  const readyPromise = new Promise((resolve) => {
    new GLTFLoader().load(GLB_URL, (gltf) => {
      if (disposed) { disposeMeshes(gltf.scene); resolve(false); return; }
      const originals = new Set();
      const names = new Map();
      gltf.scene.traverse(o => {
        if (o.isMesh) { originals.add(o.material); names.set(o, o.material.name); }
      });
      toonify(gltf.scene, renderer);
      originals.forEach(m => m.dispose());
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        const name = names.get(o);
        o.material.name = name;
        if (!materials.has(name)) materials.set(name, []);
        materials.get(name).push(o.material);
        if (name === "faceTexture") bakedFace = o.material.map;
        if (/^suitMain$|^suitTrim$|^daisyPetal$/.test(name)) suitMeshes.one.push(o);
        let parent = o;
        while (parent && parent !== gltf.scene) {
          if (parent.name.startsWith("Suit_Tank_")) { suitMeshes.tank.push(o); break; }
          if (parent.name.startsWith("Suit_Crop_")) { suitMeshes.crop.push(o); break; }
          parent = parent.parent;
        }
      });
      model.add(gltf.scene);
      mixer = new THREE.AnimationMixer(gltf.scene);
      for (const clip of gltf.animations) {
        let playable = clip;
        if (clip.name === "Paddle") {
          /* The canoe clip's hips are 0.296 m below Sit. Keep the authored
             stroke/rotations, but seat its constant root at Sit's anchor. */
          playable = clip.clone();
          const seat = gltf.animations.find(c => c.name === "Sit")
            .tracks.find(t => t.name === "mixamorigHips.position");
          const hips = playable.tracks.find(t => t.name === seat.name);
          for (let i = 0; i < hips.values.length; i += 3) {
            hips.values.set(seat.values.subarray(0, 3), i);
          }
        }
        const a = mixer.clipAction(playable);
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
      setSuit(requestedSuit);
      setFriend(requestedFriend).then(() => resolve(!disposed));
    }, undefined, () => resolve(false));
  });

  const stanceCfg = () => STANCES[loco.stance] || STANCES.stand;
  const gliding = () => loco.zone === "sea" && (loco.vx !== 0 || loco.vz !== 0);

  function disposeMeshes(root) {
    const maps = new Set();
    root.traverse(o => {
      if (!o.isMesh) return;
      o.geometry.dispose();
      if (o.material.map) maps.add(o.material.map);
      o.material.dispose();
    });
    if (bakedFace) maps.add(bakedFace); // may no longer be attached to the head
    for (const map of maps) if (!cachedFaceTextures.has(map)) map.dispose();
  }

  /* gait rate: full ts when idle (breathing Idle), ease-following
     ts while walking (2D: actual displacement drives the gait).
     In the sea the SWIM clip rate follows ACTUAL speed ÷ 1.32 m/s,
     clamped to the spec band; float crawls the same clip at 0.25
     (the swim→float release therefore decelerates the stroke too). */
  function applyTimeScale() {
    if (!ready || !current) return;
    if (reducedMotion()) {
      /* A frozen mixer cannot finish crossfades into/out of a ride. */
      if (rideDriven || loco.stance === "ride") {
        for (const a of Object.values(actions)) if (a !== current.action) a.stop();
        current.action.stopFading().setEffectiveWeight(1);
      }
      current.action.setEffectiveTimeScale(0);
      return;
    }
    const cfg = stanceCfg();
    let f;
    if (rideDriven && ridePaddling) {
      f = Math.max(0.4, loco.speed01);
    } else if (cfg.water) {
      f = (loco.stance === "swim" && loco.moving)
        ? clamp(loco.speed01, SWIM_TS_MIN, SWIM_TS_MAX)
        : cfg.ts;
    } else {
      f = cfg.ts * (loco.moving ? loco.speed01 : 1);
    }
    current.action.setEffectiveTimeScale(f);
  }

  /* reduced motion: clock frozen — park a GOOD static frame whenever
     the stance swaps: standing clips park at frame 0 (clean contact);
     the prone Swim clip parks mid-recovery (head+arm up — frame 0 is
     the catch with the face in the water, which reads as drowning
     when frozen). */
  const PARK_TIME = { Swim: 1.13 };
  function parkIfNeeded() {
    if (ready && reducedMotion() && current) {
      current.action.time = PARK_TIME[current.clipName] || 0;
    }
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
    if (current) current.action.fadeOut(CROSSFADE);
    current = { clipName: cfg.clip, action: next };
    applyTimeScale();
    parkIfNeeded();
  }

  /* ---------- the playable box (one place) ----------
     B2: the old B1 shore clamp is gone — the sea is playable to
     the deep-edge margin; the x/z box keeps her on the strip. */
  function clampPoint(x, z) {
    const b = WORLD.box;
    const tx = clamp(x, b.xMin, b.xMax);
    let tz = clamp(z, b.zMin, b.zMax);
    tz = Math.max(tz, SEA_DEEP_Z);
    return { x: tx, z: tz };
  }

  /* ---------- sea-boundary crossing (2D locoFrame rule) ----------
     Splash whenever she crosses INTO or OUT OF the sea (sand↔foam
     alone = just wet feet, 2D parity). Checked per substep so the
     splash lands exactly on the crossing point. Talk: the one 2D
     water line exists — "Splash! 🌊" (beach-boat disembark) — ported
     on entry; leaving the water stays wordless, like the 2D. */
  function refreshZone() {
    const zn = zoneAt(loco.x, loco.z);
    if (zn === loco.zone) return zn;
    const was = loco.zone;
    loco.zone = zn;
    if (fx && fx.splash && (zn === "sea") !== (was === "sea")) {
      fx.splash(loco.x, loco.z);
      if (zn === "sea" && fx.talk) fx.talk(SPLASH_TALK);
    }
    return zn;
  }

  /* ---------- one locomotion tick (2D stepLocomotion port, meters) ----------
     Land/foam keep the 2D direct step + snap-stop. In the SEA the
     velocity eases toward the desired heading (ease-in press,
     ease-out near the target via `factor`, and a release GLIDE —
     "swim→float: decelerate, settle"; motion is never teleported). */
  function step(dt) {
    const t = loco.target;
    if (!t) {
      loco.moving = false;
      if (gliding()) {
        const k = Math.exp(-GLIDE_RATE * dt);
        loco.vx *= k; loco.vz *= k;
        if (Math.hypot(loco.vx, loco.vz) < GLIDE_STOP_SPEED) {
          loco.vx = loco.vz = 0;
        } else {
          loco.x += loco.vx * dt;
          loco.z += loco.vz * dt;
          const c = clampPoint(loco.x, loco.z);
          loco.x = c.x; loco.z = c.z;
          loco.speed01 = Math.hypot(loco.vx, loco.vz) / LOCO_SPEED.sea;
          refreshZone();          /* a glide out of the sea splashes too */
        }
      } else {
        loco.vx = loco.vz = 0;
      }
      return;
    }
    const dx = t.x - loco.x, dz = t.z - loco.z;
    const dist = Math.hypot(dx, dz);
    if (dist < LOCO_STOP_DIST) {
      loco.x = t.x; loco.z = t.z;                /* snap-arrive exactly */
      loco.vx = loco.vz = 0;
      loco.moving = false;
      loco.target = null; loco.targetSrc = null;
      refreshZone();
      return;
    }
    const factor = clamp(
      LOCO_MIN_SPEED + (1 - LOCO_MIN_SPEED) * Math.min(1, dist / LOCO_EASE_RANGE),
      LOCO_MIN_SPEED, 1);
    const v = (LOCO_SPEED[loco.zone] || LOCO_SPEED.sand) * factor;
    const dirx = dx / dist, dirz = dz / dist;
    if (loco.zone === "sea") {
      const k = 1 - Math.exp(-6 * dt);
      loco.vx += (dirx * v - loco.vx) * k;
      loco.vz += (dirz * v - loco.vz) * k;
      let g = Math.hypot(loco.vx, loco.vz) * dt;
      if (g > dist) g = dist;                    /* no overshoot */
      loco.x += (loco.vx / Math.max(1e-9, Math.hypot(loco.vx, loco.vz))) * g;
      loco.z += (loco.vz / Math.max(1e-9, Math.hypot(loco.vx, loco.vz))) * g;
      loco.speed01 = Math.hypot(loco.vx, loco.vz) / LOCO_SPEED.sea;
    } else {
      let stepLen = v * dt;
      if (stepLen > dist) stepLen = dist;        /* snap-arrive exactly */
      loco.x += dirx * stepLen;
      loco.z += dirz * stepLen;
      loco.vx = loco.vz = 0;
      loco.speed01 = factor;   /* gait rate follows the ease (2D) */
    }
    const clamped = clampPoint(loco.x, loco.z);
    loco.x = clamped.x; loco.z = clamped.z;
    loco.moving = true;
    /* zone from the NEW position (2D uses the returned anchor);
       sea-boundary crossings splash (+ the ported talk line) */
    const zn = refreshZone();
    /* stance table (2D driveRig): sea moving→swim, foam moving→
       wade, land moving→walk; the idle half lives in update(). */
    setStance(zn === "sea" ? "swim" : zn === "foam" ? "wade" : "walk");
    /* yaw toward the movement direction (smoothed in update) */
    loco.yawTarget = Math.atan2(dx, dz) + FWD_YAW;
  }

  /* ---------- per-frame entry (beach3d.js owns the loop) ----------
     tNow = the world wave clock (frozen under reduced motion), used
     to sample the same animated water surface the mesh draws. */
  function update(dt, tNow) {
    if (!ready) return;
    const t = tNow || 0;
    lastWaveT = t;
    if (rideDriven) {
      loco.rootY = rideSurfaceY === null
        ? waterSurfaceY(loco.x, loco.z, t) + STANCES[rideStance].lift
          + Math.sin(t * Math.PI * 2 * 0.55 + 1.3) * 0.03
        : rideSurfaceY + STANCES[rideStance].lift;
      mixRoot.position.set(loco.x, 0, loco.z);
      mixRoot.rotation.y = loco.yaw;
      model.position.y = loco.rootY;
      shadow.visible = foamRing.visible = false;
      loco.foam = 0;
      applyTimeScale();
      mixer.update(reducedMotion() ? 0 : dt);
      return;
    }
    if (loco.enabled && dt > 0) step(dt);

    /* smooth yaw, exponential damping ~10/s (spec) — in the sea it
       keeps swinging toward the glide direction while she settles */
    const k = 1 - Math.exp(-10 * dt);
    let d = loco.yawTarget - loco.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 0.003) loco.yaw += d * k;
    else loco.yaw = loco.yawTarget;

    /* stopped → the 2D idle half of the table: sea → float,
       foam/sand → stand */
    if (!loco.moving && !gliding()) {
      setStance(loco.zone === "sea" ? "float" : "stand");
    }

    /* ONE eased root-height channel: land stances plant on the sand
       (surface + eased lift), water stances ride the animated
       surface at the SWIM_SINK mid-torso waterline, float adds the
       gentle bob (frozen with the wave clock under reduced motion).
       Crossings between the two therefore sink/rise smoothly —
       wade→swim dives, swim→wade rises at the waterline, nothing
       ever snaps or teleports. */
    const cfg = stanceCfg();
    loco.lift += ((cfg.lift || 0) - loco.lift) * (1 - Math.exp(-12 * dt));
    const gy = sandY(loco.x, loco.z);
    const surf = waterSurfaceY(loco.x, loco.z, t);
    const bob = (cfg.bob && !reducedMotion())
      ? BOB_AMP * Math.sin(t * 2 * Math.PI * BOB_HZ) : 0;
    const targetY = cfg.water ? surf - SWIM_SINK + bob : gy + loco.lift;
    if (loco.snapY) { loco.rootY = targetY; loco.snapY = false; }
    else loco.rootY += (targetY - loco.rootY) * (1 - Math.exp(-ROOT_Y_RATE * dt));
    mixRoot.position.set(loco.x, 0, loco.z);
    mixRoot.rotation.y = loco.yaw;
    model.position.y = loco.rootY;
    shadow.position.set(loco.x, gy + 0.008, loco.z);

    /* waterline break: fades in over the sink, rides the live
       surface (mixRoot y=0 → local y IS world height). Static under
       reduced motion — it only tracks position, no animation. */
    loco.foam += ((cfg.water ? 0.9 : 0) - loco.foam) * (1 - Math.exp(-8 * dt));
    foamRing.material.opacity = loco.foam;
    foamRing.visible = loco.foam > 0.02;
    foamRing.position.y = surf + 0.014;
    /* no puddle-shadow on her in deep water (it would sit on the
       seabed metres below; the water hides it anyway — fade it out
       early so nothing dark bleeds through the translucent plane) */
    shadow.visible = zoneAt(loco.x, loco.z) !== "sea";

    applyTimeScale();
    mixer.update(reducedMotion() ? 0 : dt);
  }

  /* ---------- locomotion public surface (mirrors BeachGame) ---------- */
  return {
    ready: readyPromise,
    root: mixRoot,
    loco,
    setStance,
    setSuit,
    setFriend,
    appearance() {
      return {
        suit: appliedSuit, friend: appliedFriend,
        visible: Object.fromEntries(Object.entries(suitMeshes).map(([k, v]) =>
          [k, v.filter(m => m.visible).length])),
        materials: Object.fromEntries([...materials].map(([k, v]) =>
          [k, { color: "#" + v[0].color.getHexString(), type: v[0].type,
            map: v[0].map?.uuid || null }])),
        cachedFaces: cachedFaceTextures.size
      };
    },
    attachRide(x, z, yaw, stance = "ride", surfaceY = null) {
      if (!ready || ![x, z, yaw].every(Number.isFinite)) return false;
      if (!STANCES[stance] || (surfaceY !== null && !Number.isFinite(surfaceY))) return false;
      rideDriven = true;
      rideStance = stance; rideSurfaceY = surfaceY;
      loco.x = x; loco.z = z; loco.yaw = loco.yawTarget = yaw;
      loco.zone = "sea";
      loco.target = loco.targetSrc = null;
      loco.vx = loco.vz = 0; loco.moving = false;
      loco.rootY = surfaceY === null
        ? waterSurfaceY(x, z, lastWaveT) + STANCES[stance].lift
          + Math.sin(lastWaveT * Math.PI * 2 * 0.55 + 1.3) * 0.03
        : surfaceY + STANCES[stance].lift;
      mixRoot.position.set(x, 0, z);
      mixRoot.rotation.y = yaw;
      model.position.y = loco.rootY;
      shadow.visible = foamRing.visible = false;
      return true;
    },
    detachRide() {
      if (rideDriven && reducedMotion() && current) current.action.stop();
      rideDriven = ridePaddling = false;
      loco.zone = zoneAt(loco.x, loco.z);
      loco.speed01 = 1;
      setStance(loco.zone === "sea" ? "float" : "stand");
    },
    setRidePaddling(held, speed01) {
      if (!ready || !rideDriven) return;
      ridePaddling = !!held;
      loco.speed01 = clamp(speed01, 0, 1);
      const clipName = held ? "Paddle" : "Sit";
      if (current.clipName !== clipName) {
        const next = actions[clipName];
        next.reset().setEffectiveWeight(1).play();
        current.action.fadeOut(CROSSFADE);
        current = { clipName, action: next };
        parkIfNeeded();
      }
      applyTimeScale();
    },
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
      loco.vx = loco.vz = 0; loco.snapY = true;
      loco.zone = zoneAt(p.x, p.z);
    },
    /* eased root height + live zone (QA waterline asserts) */
    getRootY: () => model.position.y,
    /* QA: world-space Y of named bones at the current pose — proves
       exactly what the waterline crosses (B2 swim-look audit) */
    boneHeights(names) {
      if (!ready) return null;
      const out = {};
      const v = new THREE.Vector3();
      /* live bone names drop the glTF ":" (mixamorigHips) — try both */
      const find = (n) => model.getObjectByName(n) ||
        model.getObjectByName(n.replace(":", ""));
      for (const n of names) {
        const bone = find(n);
        if (bone) { bone.getWorldPosition(v); out[n] = +v.y.toFixed(4); }
      }
      return out;
    },
    /* QA: which clip is driving the pose right now (stance/pose
       audits — e.g. B2 swim-look gate, B3/B4 stance-map checks) */
    actionInfo() {
      const all = {};
      for (const name of Object.keys(actions)) {
        const a = actions[name];
        all[name] = {
          run: a.isRunning(),
          w: +a.getEffectiveWeight().toFixed(3)
        };
      }
      if (!current) return { all };
      const a = current.action;
      return {
        stance: loco.stance,
        clip: current.clipName,
        playing: a.isRunning(),
        weight: +a.getEffectiveWeight().toFixed(3),
        time: +a.time.toFixed(3),
        timeScale: +a.getEffectiveTimeScale().toFixed(3),
        all
      };
    },
    /* QA: bake one frozen pose at clip time s (used to pick the RM
       park frame; harmless mid-run — the next frame re-advances) */
    probePose(s) {
      if (!ready || !current) return;
      current.action.time = s;
      mixer.update(0);
    },
    /* full teardown with the world (one context per beach visit) */
    dispose() {
      disposed = true;
      ready = false;
      if (mixer) mixer.stopAllAction();
      disposeMeshes(model);
      scene.remove(mixRoot);
      scene.remove(shadow);
      shadow.geometry.dispose();
      shadow.material.dispose();
      foamRing.geometry.dispose();
      foamRing.material.dispose();   /* texture is module-cached (stable count) */
    },
    reset() {
      rideDriven = ridePaddling = false;
      loco.x = WORLD.rest.x; loco.z = WORLD.rest.z;
      loco.yaw = loco.yawTarget = 0;
      loco.target = null; loco.targetSrc = null;
      loco.enabled = true; loco.moving = false;
      loco.vx = loco.vz = 0; loco.speed01 = 1;
      loco.rootY = sandY(loco.x, loco.z) + STANCES.stand.lift;
      loco.snapY = true;
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
