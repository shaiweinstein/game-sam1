/* ============================================================
   beach3d/character3d.js — Lily 4 + locomotion (B1 walk/wade,
   B2 swim/float)

   Loads beach3d/assets/lily4_full.glb (9 clips, 65 bones),
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
     float→approved head-up Swim at a slow crawl + gentle bob
     ride→Sit · surf→SurfRide (pre-wired for B3/B4, clips cached)

   Land contact is measured AFTER animation blending, using a small
   support set cached from the loaded foot skin and Idle/Walk clips.
   The lowest sole follows sand at its own x/z, not a clip-wide lift
   at the hips. Water transitions retain an eased root-y channel;
   attached boat/surf heights bypass ground contact entirely.

   B2 sea reach: the B1 shore clamp is GONE — the sea is playable
   to the deep-edge margin SEA_DEEP_Z. In the sea she glides:
   release decelerates into the float stance (no ground friction
   in water; the 2D snap-stop stays on land/foam).
   ============================================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { moveAroundProps } from "./collision3d.js";
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

/* Shared with pointer picking, surf spawns, and boat bounds. */
export const SEA_DEEP_Z = WORLD.box.zMin;

/* Accepted head-up swim/float origin depth below the animated surface.
   Keep this profile unchanged; the separate freestyle skin audit is in README. */
export const SWIM_SINK = 0.065;
/* Measured using face/chest/back skin against waterSurfaceY, never hair bounds. */
const FREESTYLE = { clip: "SwimFreestyle", ts: 1, water: true, sink: 0.09 };
/* Foot skin reaches 0.385 m from the anchor; 0.41 also covers the curved
   shore's lateral slope. The blend needs 0.365 m, more than the 0.194 m kick.
   Reserve clearance at low water, not a passing crest (wave bound 0.0604 m). */
const FREESTYLE_REACH = 0.41, FREESTYLE_LOW_WATER = WORLD.water.y - 0.061;
const FREESTYLE_ENTER_DEPTH = 0.405, FREESTYLE_EXIT_DEPTH = 0.38;
/* Swim gait rate = actual speed / full-speed ref, clamped to the
   spec band; float always idles the accepted head-up clip. */
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
const SOLE_CLEARANCE = 0.003;
/* the one 2D water talk line (js/beach-boat.js disembark — same
   event: dropping INTO the sea with a splash). */
const SPLASH_TALK = "Splash! 🌊";

/* stance → { clip, timeScale at full speed, root-lift m, water, bob } */
const STANCES = {
  stand: { clip: "Idle", ts: 1.00 },
  walk:  { clip: "Walk", ts: 1.00 },
  wade:  { clip: "Walk", ts: 0.80 },
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

/* Load-time only: find the actual skinned support vertices in 48 poses of
   each land clip, against nine slope normals spanning the shore ramp at any
   yaw. No archived indices, bone-origin soles, or per-tick mesh scan.
   At most 2 clips * 48 poses * 9 normals * 2 feet survive, usually far fewer.
   Keep their real skin weights: blended poses are evaluated live, not looked
   up in a phase curve. The temporary mixer restores the untouched rest pose. */
function cacheSoleSupport(root, clips) {
  const feet = [[], []];
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const { skinIndex, skinWeight } = mesh.geometry.attributes;
    const sides = mesh.skeleton.bones.map(b =>
      /Left(Foot|Toe)/.test(b.name) ? 0 : /Right(Foot|Toe)/.test(b.name) ? 1 : -1);
    for (let i = 0; i < skinIndex.count; i++) {
      const weights = [0, 0];
      for (let j = 0; j < 4; j++) {
        const side = sides[skinIndex.getComponent(i, j)];
        if (side >= 0) weights[side] += skinWeight.getComponent(i, j);
      }
      for (let side = 0; side < 2; side++) {
        if (weights[side] >= 0.5) feet[side].push({ mesh, index: i });
      }
    }
  });
  const sampler = new THREE.AnimationMixer(root);
  const support = new Set(), p = new THREE.Vector3();
  const slopes = [];
  for (const x of [-0.35, 0, 0.35]) for (const z of [-0.35, 0, 0.35]) slopes.push([x, z]);
  for (const clip of clips) {
    if (clip.name !== "Idle" && clip.name !== "Walk") continue;
    const action = sampler.clipAction(clip).play();
    for (let frame = 0; frame < 48; frame++) {
      action.time = clip.duration * frame / 48;
      sampler.update(0);
      root.updateMatrixWorld(true);
      for (const candidates of feet) {
        const heights = slopes.map(() => Infinity), lowest = [];
        for (const candidate of candidates) {
          candidate.mesh.getVertexPosition(candidate.index, p).applyMatrix4(candidate.mesh.matrixWorld);
          for (let s = 0; s < slopes.length; s++) {
            const h = p.y + p.x * slopes[s][0] + p.z * slopes[s][1];
            if (h < heights[s]) { heights[s] = h; lowest[s] = candidate; }
          }
        }
        for (const candidate of lowest) support.add(candidate);
      }
    }
    action.stop();
  }
  sampler.uncacheRoot(root);
  return [...support];
}

/* fx (optional): { splash(x, z), talk(text) } — waterline splash
   VFX + speech hook, wired by beach3d.js to world.splash and
   BeachScene.say. */
export function createCharacter(renderer, scene, reducedMotion, fx, movement = {}) {
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
    speed01: 1,
    /* B2 sea glide and shared root height. Ground contact follows the
       blended pose; water entry/exit eases without lagging the land gait. */
    vx: 0, vz: 0,
    rootY: sandY(WORLD.rest.x, WORLD.rest.z),
    snapY: false,                           /* teleport → plant instantly */
    foam: 0                                 /* waterline break fade 0..1 */
  };

  let mixer = null;
  const actions = {};          /* clipName -> AnimationAction */
  let current = null;          /* { clipName, action } */
  let swimStyle = "head-up", swimFade = null;
  let freestyleDepthReady = false, swimDepth = null;
  let ready = false;
  let disposed = false;
  let rideDriven = false, ridePaddling = false;
  let rideStance = "ride", rideSurfaceY = null;
  let lastWaveT = 0;
  let soleSupport = [];
  const solePoint = new THREE.Vector3();
  let groundOffset = 0; // only water/ride exits ease; never lag the land gait
  const materials = new Map();
  const suitMeshes = { one: [], tank: [], crop: [] };
  const hairMeshes = { hair1: [], hair2: [], hair3: [], hair4: [], hair5: [], hair6: [] };
  let bakedFace = null;
  let requestedSuit = "suit1", requestedFriend = "lily";
  let requestedHair = "hair1", appliedHair = null;
  let appliedSuit = null, appliedFriend = null, suitKey = null;
  let pendingFriend = null;
  let visible = true, ballPose = null;
  const poseBones = [];
  const shoulder = new THREE.Vector3(), elbow = new THREE.Vector3(), wrist = new THREE.Vector3();
  const handTarget = new THREE.Vector3(), elbowTarget = new THREE.Vector3(), direction = new THREE.Vector3();
  const bend = new THREE.Vector3(), before = new THREE.Vector3(), after = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), parentRotation = new THREE.Quaternion();

  function restoreBallPose() {
    for (const { bone, original } of poseBones) bone.quaternion.copy(original);
    poseBones.length = 0;
  }

  function applyBallPose() {
    if (!ballPose) return;
    const { kind, amount } = ballPose;
    mixRoot.updateMatrixWorld(true);
    // Two short arm chains reach the back/sides of the large ball. This local
    // overlay is restored before the mixer, so no clip or other actor changes.
    const aim = (bone, joint, target) => {
      bone.getWorldPosition(before);
      joint.getWorldPosition(after).sub(before).normalize();
      before.subVectors(target, before).normalize();
      rotation.setFromUnitVectors(after, before);
      bone.getWorldQuaternion(parentRotation);
      rotation.multiply(parentRotation);
      bone.parent.getWorldQuaternion(parentRotation).invert();
      bone.quaternion.copy(parentRotation.multiply(rotation));
      bone.updateWorldMatrix(false, true);
    };
    for (const side of ["Left", "Right"]) {
      const arm = model.getObjectByName("mixamorig" + side + "Arm");
      const forearm = model.getObjectByName("mixamorig" + side + "ForeArm");
      const hand = model.getObjectByName("mixamorig" + side + "Hand");
      if (!arm || !forearm || !hand) continue;
      for (const bone of [arm, forearm]) poseBones.push({ bone, original: bone.quaternion.clone() });
      arm.getWorldPosition(shoulder); forearm.getWorldPosition(elbow); hand.getWorldPosition(wrist);
      const upper = shoulder.distanceTo(elbow), lower = elbow.distanceTo(wrist);
      const sign = side === "Left" ? 1 : -1;
      const height = kind === "pickup" ? 0.5 - 0.24 * Math.sin(amount * Math.PI)
        : kind === "throw" ? 0.55 + 0.18 * Math.sin(amount * Math.PI) : 0.5;
      handTarget.set(sign * 0.15, model.position.y + height, kind === "throw" ? 0.2 + amount * 0.1 : 0.27);
      mixRoot.localToWorld(handTarget);
      direction.subVectors(handTarget, shoulder);
      const distance = Math.min(direction.length(), upper + lower - 0.001);
      direction.normalize();
      handTarget.copy(shoulder).addScaledVector(direction, distance);
      const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
      bend.set(sign * 0.5, -1, 0).transformDirection(mixRoot.matrixWorld);
      bend.addScaledVector(direction, -bend.dot(direction)).normalize();
      elbowTarget.copy(shoulder).addScaledVector(direction, along)
        .addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
      aim(arm, forearm, elbowTarget);
      aim(forearm, hand, handTarget);
    }
  }

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

  function setHair(id) {
    if (disposed) return false;
    requestedHair = typeof id === "string" && Object.hasOwn(hairMeshes, id) &&
      window.CharacterRenderer?.catalog?.hair?.[id] ? id : "hair1";
    if (!ready) return false;
    const selected = hairMeshes[requestedHair].length ? requestedHair : "hair1";
    if (!hairMeshes[selected].length) return false;
    if (appliedHair === selected) return true;
    for (const [name, meshes] of Object.entries(hairMeshes)) {
      for (const mesh of meshes) mesh.visible = name === selected;
    }
    appliedHair = selected;
    return true;
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
          const hair = /^Hair_(hair[1-6])(?:_|$)/.exec(parent.name);
          if (hair) {
            hairMeshes[hair[1]].push(o);
            o.visible = false; // no stacked styles on the first rendered frame
            break;
          }
          if (parent.name.startsWith("Suit_Tank_")) { suitMeshes.tank.push(o); break; }
          if (parent.name.startsWith("Suit_Crop_")) { suitMeshes.crop.push(o); break; }
          parent = parent.parent;
        }
      });
      soleSupport = cacheSoleSupport(gltf.scene, gltf.animations);
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
      setHair(requestedHair);
      setFriend(requestedFriend).then(() => resolve(!disposed));
    }, undefined, () => resolve(false));
  });

  const stanceCfg = (name = loco.stance) =>
    name === "swim" && swimStyle === "freestyle" && freestyleDepthReady
      ? FREESTYLE : STANCES[name] || STANCES.stand;
  const gliding = () => loco.zone === "sea" && (loco.vx !== 0 || loco.vz !== 0);

  function disposeMeshes(root) {
    const maps = new Set(), skeletons = new Set();
    root.traverse(o => {
      if (!o.isMesh) return;
      if (o.skeleton) skeletons.add(o.skeleton);
      o.geometry.dispose();
      if (o.material.map) maps.add(o.material.map);
      o.material.dispose();
    });
    if (bakedFace) maps.add(bakedFace); // may no longer be attached to the head
    for (const map of maps) if (!cachedFaceTextures.has(map)) map.dispose();
    for (const skeleton of skeletons) skeleton.dispose();
  }

  /* gait rate: full ts when idle (breathing Idle), ease-following
     ts while walking (2D: actual displacement drives the gait).
     In the sea the SWIM clip rate follows ACTUAL speed ÷ 1.32 m/s,
     clamped to the spec band; float crawls the same clip at 0.25
     (the swim→float release therefore decelerates the stroke too). */
  function applyTimeScale() {
    if (!ready || !current) return;
    if (reducedMotion()) {
      swimFade = null;
      if (current.clipName === "SwimFreestyle" && current.action.getEffectiveTimeScale() !== 0) {
        parkIfNeeded();
      }
      /* A frozen mixer cannot finish a crossfade, on land or on a ride. */
      for (const a of Object.values(actions)) if (a !== current.action) a.stop();
      current.action.stopFading().setEffectiveWeight(1);
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
  const PARK_TIME = { Swim: 1.13, SwimFreestyle: (1 + 136 * 7 / 12) / 30 };
  function parkIfNeeded() {
    if (ready && reducedMotion() && current) {
      current.action.time = PARK_TIME[current.clipName] || 0;
    }
  }

  function setSwimStyle(style) {
    if (disposed || (style !== "head-up" && style !== "freestyle")) return false;
    if (swimStyle === style) return true;
    swimStyle = style;
    if (ready && !rideDriven) setStance(loco.stance);
    return true;
  }

  function changeAction(clip) {
    const next = actions[clip];
    if (swimFade || clip === "SwimFreestyle" || current?.clipName === "SwimFreestyle") {
      // Snapshot the actual blended pose weights, including interrupted fades.
      // Reuse the nine cached actions; reversing never resets a contributing one.
      const starts = Object.values(actions).filter(a => a.isScheduled() && a.enabled)
        .map(a => [a, a.getEffectiveWeight()]);
      const total = starts.reduce((sum, [, w]) => sum + w, 0) || 1;
      for (const entry of starts) {
        entry[1] /= total;
        entry[0].stopFading().setEffectiveWeight(entry[1]);
      }
      if (!starts.some(([a]) => a === next)) {
        const phase = current && /^Swim/.test(current.clipName)
          ? current.action.time / current.action.getClip().duration : 0;
        next.reset().setEffectiveWeight(0).play();
        if (/^Swim/.test(clip)) next.time = phase * next.getClip().duration;
        starts.push([next, 0]);
      }
      swimFade = { starts, elapsed: 0, next };
    } else {
      next.reset().setEffectiveWeight(1).play();
      if (current) {
        current.action.fadeOut(CROSSFADE);
        next.fadeIn(CROSSFADE);
      }
    }
    current = { clipName: clip, action: next };
  }

  function advanceSwimFade(dt) {
    if (!swimFade) return;
    const f = swimFade;
    const progress = Math.min(1, (f.elapsed += dt) / CROSSFADE);
    for (const [a, start] of f.starts) {
      a.setEffectiveWeight(start * (1 - progress) + (a === f.next ? progress : 0));
      if (progress === 1 && a !== f.next) a.stop();
    }
    if (progress === 1) swimFade = null;
  }

  function setStance(name) {
    if (!STANCES[name] || !ready) return;
    if (name === "swim" || name === "float") {
      // Check the whole foot reach now and after the existing fade's travel,
      // so the return to Head-up finishes BEFORE the kick reaches shallows.
      const bed = Math.max(
        sandY(loco.x, loco.z + FREESTYLE_REACH),
        sandY(loco.x + loco.vx * CROSSFADE, loco.z + loco.vz * CROSSFADE + FREESTYLE_REACH)
      );
      swimDepth = FREESTYLE_LOW_WATER - bed;
      // Physical readiness belongs to the water, not the selected stroke.
      // Head-up swimming and resting retain/recheck the same depth history.
      freestyleDepthReady = swimDepth >= (freestyleDepthReady ? FREESTYLE_EXIT_DEPTH : FREESTYLE_ENTER_DEPTH);
    } else {
      freestyleDepthReady = false;
      swimDepth = null;
    }
    const cfg = stanceCfg(name);
    const next = actions[cfg.clip];
    if (!next) return;
    if (name === loco.stance && current?.action === next) return;
    const sameAction = current && current.action === next;
    loco.stance = name;
    if (sameAction) {                      /* walk→wade: same clip */
      applyTimeScale();
      return;
    }
    changeAction(cfg.clip);
    applyTimeScale();
    parkIfNeeded();
  }

  /* ---------- the playable box (one place) ----------
     B2: the old B1 shore clamp is gone — the sea is playable to
     the deep-edge margin; the x/z box keeps her on the strip. */
  function clampPoint(x, z) {
    const b = movement.bounds || WORLD.box;
    const tx = clamp(x, b.xMin, b.xMax);
    let tz = clamp(z, b.zMin, b.zMax);
    tz = Math.max(tz, SEA_DEEP_Z);
    return { x: tx, z: tz };
  }

  function moveTo(x, z) {
    let p = clampPoint(x, z);
    if (movement.obstacles) p = moveAroundProps(loco, p, movement.obstacles());
    loco.x = p.x; loco.z = p.z;
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
          moveTo(loco.x + loco.vx * dt, loco.z + loco.vz * dt);
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
      moveTo(t.x, t.z);                         /* arrival also respects props */
      loco.vx = loco.vz = 0;
      loco.moving = false;
      loco.target = null; loco.targetSrc = null;
      refreshZone();
      return;
    }
    const factor = clamp(
      LOCO_MIN_SPEED + (1 - LOCO_MIN_SPEED) * Math.min(1, dist / LOCO_EASE_RANGE),
      LOCO_MIN_SPEED, 1);
    const v = (LOCO_SPEED[loco.zone] || LOCO_SPEED.sand) * factor * (movement.speedScale || 1);
    const dirx = dx / dist, dirz = dz / dist;
    const oldX = loco.x, oldZ = loco.z;
    if (loco.zone === "sea") {
      const k = 1 - Math.exp(-6 * dt);
      loco.vx += (dirx * v - loco.vx) * k;
      loco.vz += (dirz * v - loco.vz) * k;
      let g = Math.hypot(loco.vx, loco.vz) * dt;
      if (g > dist) g = dist;                    /* no overshoot */
      moveTo(loco.x + (loco.vx / Math.max(1e-9, Math.hypot(loco.vx, loco.vz))) * g,
        loco.z + (loco.vz / Math.max(1e-9, Math.hypot(loco.vx, loco.vz))) * g);
      loco.speed01 = Math.hypot(loco.vx, loco.vz) / LOCO_SPEED.sea;
    } else {
      let stepLen = v * dt;
      if (stepLen > dist) stepLen = dist;        /* snap-arrive exactly */
      moveTo(loco.x + dirx * stepLen, loco.z + dirz * stepLen);
      loco.vx = loco.vz = 0;
      loco.speed01 = factor * Math.min(1.6, movement.speedScale || 1);
    }
    loco.moving = Math.hypot(loco.x - oldX, loco.z - oldZ) > 1e-6;
    /* zone from the NEW position (2D uses the returned anchor);
       sea-boundary crossings splash (+ the ported talk line) */
    const zn = refreshZone();
    /* stance table (2D driveRig): sea moving→swim, foam moving→
       wade, land moving→walk; the idle half lives in update(). */
    if (loco.moving) setStance(zn === "sea" ? "swim" : zn === "foam" ? "wade" : "walk");
    /* yaw toward the movement direction (smoothed in update) */
    loco.yawTarget = Math.atan2(dx, dz) + FWD_YAW;
  }

  /* ---------- per-frame entry (beach3d.js owns the loop) ----------
     tNow = the world wave clock (frozen under reduced motion), used
     to sample the same animated water surface the mesh draws. */
  function update(dt, tNow) {
    if (!ready) return;
    restoreBallPose();
    const t = tNow || 0;
    lastWaveT = t;
    if (rideDriven) {
      groundOffset = null;
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
      advanceSwimFade(dt);
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
    if (!loco.moving && (!gliding() || (swimStyle === "freestyle" && loco.zone === "sea"))) {
      setStance(loco.zone === "sea" ? "float" : "stand");
    } else if (!loco.moving) {
      // Head-up keeps its existing glide stance, but still rechecks depth.
      setStance(loco.stance);
    }

    applyTimeScale();
    advanceSwimFade(dt);
    mixer.update(reducedMotion() ? 0 : dt);
    mixRoot.position.set(loco.x, 0, loco.z);
    mixRoot.rotation.y = loco.yaw;

    /* Resolve the blended skin, not either source clip. Translate only Y:
       the swing foot retains its authored clearance, and support can pass
       between heel/toe/feet without a planting latch or a yaw-dependent pop. */
    const cfg = stanceCfg();
    const gy = sandY(loco.x, loco.z);
    const surf = waterSurfaceY(loco.x, loco.z, t);
    const bob = (cfg.bob && !reducedMotion())
      ? BOB_AMP * Math.sin(t * 2 * Math.PI * BOB_HZ) : 0;
    let targetY = surf - (cfg.sink ?? SWIM_SINK) + bob;
    if (!cfg.water) {
      targetY = -Infinity;
      mixRoot.updateMatrixWorld(true);
      for (const { mesh, index } of soleSupport) {
        mesh.getVertexPosition(index, solePoint).applyMatrix4(mesh.matrixWorld);
        targetY = Math.max(targetY, sandY(solePoint.x, solePoint.z) - solePoint.y);
      }
      targetY = Number.isFinite(targetY) ? targetY + model.position.y + SOLE_CLEARANCE : gy;
    }
    const ease = 1 - Math.exp(-ROOT_Y_RATE * dt);
    if (loco.snapY) {
      loco.rootY = targetY; loco.snapY = false; groundOffset = 0;
    } else if (cfg.water) {
      loco.rootY += (targetY - loco.rootY) * ease;
      groundOffset = null;
    } else {
      // Ease only the entry mismatch, not the changing sole height: damping
      // the latter reintroduces sinking/hover during each half of the stride.
      if (groundOffset === null) groundOffset = loco.rootY - targetY;
      groundOffset *= 1 - ease;
      loco.rootY = targetY + groundOffset;
    }
    model.position.y = loco.rootY;
    applyBallPose();
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
    shadow.visible = visible && zoneAt(loco.x, loco.z) !== "sea";
  }

  /* ---------- locomotion public surface (mirrors BeachGame) ---------- */
  return {
    ready: readyPromise,
    root: mixRoot,
    loco,
    setStance,
    setSwimStyle,
    swimStatus() {
      return {
        selected: swimStyle,
        mode: !ready ? "loading" : rideDriven ? rideStance === "surf" ? "surf" : "boat"
          : loco.zone !== "sea" ? "shore" : loco.stance === "swim" && loco.moving ? "swim" : "rest",
        effective: current?.clipName === "SwimFreestyle" ? "freestyle" : "head-up",
        ready: freestyleDepthReady,
        reducedMotion: reducedMotion()
      };
    },
    setSuit,
    setHair,
    setFriend,
    setVisible(on) {
      visible = !!on;
      mixRoot.visible = visible;
      shadow.visible = visible && loco.zone !== "sea";
    },
    setBallPose(kind, amount = 0) { ballPose = kind ? { kind, amount } : null; },
    facePoint(x, z) { loco.yawTarget = Math.atan2(x - loco.x, z - loco.z); },
    appearance() {
      return {
        suit: appliedSuit, friend: appliedFriend, hair: appliedHair,
        visibleHair: Object.fromEntries(Object.entries(hairMeshes).map(([k, v]) =>
          [k, v.filter(m => m.visible).length])),
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
      groundOffset = null;
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
        if (swimFade) changeAction(clipName);
        else {
          const next = actions[clipName];
          next.reset().setEffectiveWeight(1).play();
          current.action.fadeOut(CROSSFADE);
          current = { clipName, action: next };
        }
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
          active: a.isScheduled() && a.enabled,
          w: +a.getEffectiveWeight().toFixed(3)
        };
      }
      if (!current) return { all };
      const a = current.action;
      return {
        stance: loco.stance,
        swimStyle,
        swimDepthGuard: {
          active: swimStyle === "freestyle" && loco.stance === "swim" && !freestyleDepthReady,
          depth: swimDepth, enter: FREESTYLE_ENTER_DEPTH, exit: FREESTYLE_EXIT_DEPTH
        },
        sink: stanceCfg().water ? stanceCfg().sink ?? SWIM_SINK : null,
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
      if (disposed) return;
      disposed = true;
      ready = false;
      if (mixer) { mixer.stopAllAction(); mixer.uncacheRoot(model.children[0]); }
      soleSupport = [];
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
      loco.rootY = sandY(loco.x, loco.z);
      groundOffset = 0;
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
