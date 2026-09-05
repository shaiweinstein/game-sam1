#!/usr/bin/env node
'use strict';
/*
 * gen-armature.js — generate Lily's SkelForm armature (armature.json) and pack
 * it into lily.skf (armature.json + atlas0.png).
 *
 * Coordinate convention:
 *   - Joint points are authored in a 400x400 viewBox, Y-DOWN.
 *   - Armature space is Y-UP at SCALE 2:  ax = x*2,  ay = -y*2.
 *   - Bone init_pos is RELATIVE to the parent bone's armature position.
 *   - init_rot is in radians, positive = counter-clockwise (Y-up).
 *
 * Limb textures are drawn with the proximal end UP (+y) and distal end DOWN (-y);
 * a texture bone at the segment midpoint rotated by A + PI/2 (A = atan2(v.y, v.x)
 * for segment vector v = D - P) points its distal end along the segment.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SPIKE = path.resolve(__dirname, '..');

// ---------------------------------------------------------------- inputs
const partsMapPath = path.join(SPIKE, 'parts-map.json');
const atlasPath = path.join(SPIKE, 'atlas.png');
if (!fs.existsSync(atlasPath)) {
  throw new Error(`missing atlas: ${atlasPath}`);
}
const partsMap = JSON.parse(fs.readFileSync(partsMapPath, 'utf8'));
if (partsMap.w !== 1024 || partsMap.h !== 1024) {
  throw new Error(`unexpected atlas size ${partsMap.w}x${partsMap.h}, expected 1024x1024`);
}

// viewBox (Y-down) -> armature (Y-up, scale 2)
const toArm = ([x, y]) => ({ x: x * 2, y: -(y * 2) });

// Joint points in viewBox coords (Y-down).
const JV = {
  root: [200, 250],
  neck: [200, 152],
  head: [200, 100],
  'hair-back': [200, 105],
  'hair-front': [200, 74],
  torso: [200, 212],
  'shoulder-L': [170, 168],
  'shoulder-R': [230, 168],
  // Arms hang 12° from vertical (was ~40°, then 20°): shoulder + (±len·sin12°, +len·cos12°),
  // preserving the original segment lengths (len_ua 24.8395, len_fa 21.0950).
  'elbow-L': [164.8356, 192.2967],
  'elbow-R': [235.1644, 192.2967],
  'wrist-L': [160.4497, 212.9307],
  'wrist-R': [239.5503, 212.9307],
  'hip-L': [184, 250],
  'hip-R': [216, 250],
  'knee-L': [182, 290],
  'knee-R': [218, 290],
  'ankle-L': [180, 326],
  'ankle-R': [220, 326],
};
const J = {};
for (const [name, pt] of Object.entries(JV)) J[name] = toArm(pt);

// ---------------------------------------------------------------- bones
const bones = [];
const visuals = [];

function addBone(name, parentId, abs, opts = {}) {
  const id = bones.length;
  const parent = parentId === -1 ? null : bones[parentId];
  const initPos =
    parentId === -1
      ? { x: abs.x, y: abs.y }
      : { x: abs.x - parent._abs.x, y: abs.y - parent._abs.y };
  const initRot = opts.initRot !== undefined ? opts.initRot : 0;
  let visualsId = -1;
  let zindex;
  if (opts.tex) {
    visualsId = visuals.length;
    zindex = opts.zindex;
    visuals.push({ tex: opts.tex, zindex, init_tex: opts.tex, init_zindex: zindex });
  }
  const bone = {
    id,
    name,
    parent_id: parentId,
  };
  if (opts.tex) {
    bone.tex = opts.tex;
    bone.zindex = zindex;
  }
  bone.pos = { x: initPos.x, y: initPos.y };
  bone.scale = { x: 1.0, y: 1.0 };
  bone.rot = initRot;
  bone.init_pos = { x: initPos.x, y: initPos.y };
  bone.init_rot = initRot;
  bone.init_scale = { x: 1.0, y: 1.0 };
  bone.ik_family_id = -1;
  bone.physics_id = -1;
  bone.visuals_id = visualsId;
  bone._abs = abs; // internal bookkeeping only (stripped before write)
  bones.push(bone);
  return id;
}

// Add a segment from an existing proximal joint bone to a new distal joint bone:
//   [texture bone at midpoint (rot A + PI/2), distal joint bone]
function addSegment(proxJointId, distName, dist, texName, zindex) {
  const prox = bones[proxJointId];
  const vx = dist.x - prox._abs.x;
  const vy = dist.y - prox._abs.y;
  const A = Math.atan2(vy, vx);
  addBone(
    texName,
    proxJointId,
    { x: prox._abs.x + vx / 2, y: prox._abs.y + vy / 2 },
    { tex: texName, zindex, initRot: A + Math.PI / 2 }
  );
  const distId = addBone(distName, proxJointId, dist);
  return distId;
}

// Pattern A: body parts (visual centered on bone, init_rot = 0)
addBone('root', -1, J.root);                                   // 0
addBone('torso', 0, J.torso, { tex: 'torso', zindex: 4 });      // 1
addBone('neck', 0, J.neck);                                     // 2
addBone('head', 2, J.head, { tex: 'head', zindex: 7 });         // 3
addBone('hair-back', 3, J['hair-back'], { tex: 'hair-back', zindex: 1 });   // 4
addBone('hair-front', 3, J['hair-front'], { tex: 'hair-front', zindex: 8 }); // 5

// Pattern B: limbs. Each arm: shoulder(joint) -> [uaTex, elbow(joint)];
// elbow -> [faTex, wrist(joint)]. Each leg: hip(joint) -> [thTex, knee(joint)];
// knee -> [shTex, ankle(joint)].
const shoulderL = addBone('shoulder-L', 0, J['shoulder-L']); // 6
const elbowL = addSegment(shoulderL, 'elbow-L', J['elbow-L'], 'upper-arm-L', 5); // 7,8
addSegment(elbowL, 'wrist-L', J['wrist-L'], 'forearm-hand-L', 6); // 9,10

const shoulderR = addBone('shoulder-R', 0, J['shoulder-R']); // 11
const elbowR = addSegment(shoulderR, 'elbow-R', J['elbow-R'], 'upper-arm-R', 5); // 12,13
addSegment(elbowR, 'wrist-R', J['wrist-R'], 'forearm-hand-R', 6); // 14,15

const hipL = addBone('hip-L', 0, J['hip-L']); // 16
const kneeL = addSegment(hipL, 'knee-L', J['knee-L'], 'thigh-L', 2); // 17,18
addSegment(kneeL, 'ankle-L', J['ankle-L'], 'shin-foot-L', 3); // 19,20

const hipR = addBone('hip-R', 0, J['hip-R']); // 21
const kneeR = addSegment(hipR, 'knee-R', J['knee-R'], 'thigh-R', 2); // 22,23
addSegment(kneeR, 'ankle-R', J['ankle-R'], 'shin-foot-R', 3); // 24,25

for (const b of bones) delete b._abs;

// ---------------------------------------------------------------- keyframes
/* Build the "Stand" keyframes: an explicit hold of the rest pose.
 *
 * WHY NOT AN EMPTY ARRAY: SkfGenericFormatFrame reads
 *   anim.keyframes[anim.keyframes.length - 1].frame
 * which throws on an empty array. And SkfGenericAnimate interpolates each
 * keyframe toward its next_kf, so we need a real next frame per element.
 *
 * We emit TWO keyframes per bone per element — one at frame 0 and one at
 * frame 30 — both holding the bone's init value. Interpolating between two
 * equal values is constant, so the pose is the rest pose for the whole loop
 * (30 frames @ 30fps = 1s, wrapped by isLoop).
 *
 * next_kf SEMANTICS (from the skellina sample + SkfGenericAnimate): a
 * keyframe's next_kf is the ARRAY INDEX of the NEXT keyframe for the SAME
 * bone+element (its interpolation target); -1 means "self" (last in chain).
 * It is NOT simply index+1 — the array is flat/interleaved across bones, so
 * index+1 would be a DIFFERENT bone's keyframe and would bleed that bone's
 * value in. Layout: the frame-0 block (all bones x elements) comes first,
 * then the identical frame-30 block, so frame-0 keyframe i targets i + perBlock
 * (its frame-30 twin); every frame-30 keyframe targets -1.
 *
 * Keyframes must be sorted by frame for the `if (kf.frame > frame) break`
 * loop — the frame-0 block then frame-30 block order satisfies that. */
function buildKeyframes(bones) {
  const ELEMENTS = ['PositionX', 'PositionY', 'Rotation', 'ScaleX', 'ScaleY'];
  const perBlock = bones.length * ELEMENTS.length; // 26 * 5 = 130
  const LOOP_FRAME = 30; // fps 30 -> 1s loop

  const initValue = (bone, element) => {
    switch (element) {
      case 'PositionX': return bone.init_pos.x;
      case 'PositionY': return bone.init_pos.y;
      case 'Rotation': return bone.init_rot;
      case 'ScaleX': return bone.init_scale.x;
      case 'ScaleY': return bone.init_scale.y;
    }
  };

  const keyframes = [];
  const push = (frame, boneId, element, nextKf) => {
    keyframes.push({
      frame,
      bone_id: boneId,
      element,
      value: initValue(bones[boneId], element),
      start_handle: { x: 0.0, y: 0.0 },
      end_handle: { x: 0.0, y: 0.0 },
      next_kf: nextKf,
      handle_preset: 'Linear',
    });
  };

  for (let bi = 0; bi < bones.length; bi++) {
    for (const element of ELEMENTS) {
      const idx = keyframes.length;
      push(0, bi, element, idx + perBlock); // -> matching frame-30 twin
    }
  }
  for (let bi = 0; bi < bones.length; bi++) {
    for (const element of ELEMENTS) {
      push(LOOP_FRAME, bi, element, -1); // last in its bone+element chain
    }
  }
  return keyframes;
}

// ---------------------------------------------------------------- armature
const armature = {
  version: '0.6.0', // copied from the sample (spike/skellina.skf)
  baked_ik: false,
  img_format: 'PNG',
  bones,
  animations: [
    { name: 'Stand', id: 0, fps: 30, keyframes: buildKeyframes(bones) },
  ],
  atlases: [
    { filename: 'atlas0.png', size: { x: 1024, y: 1024 } },
  ],
  styles: [
    {
      name: 'Default',
      textures: Object.entries(partsMap.parts).map(([name, r]) => ({
        name,
        offset: { x: r.x, y: r.y },
        size: { x: r.w, y: r.h },
        atlas_idx: 0,
      })),
    },
  ],
  visuals,
  inverse_kinematics: [],
  physics: [],
};

// ---------------------------------------------------------------- write + zip
const armaturePath = path.join(SPIKE, 'armature.json');
fs.writeFileSync(armaturePath, JSON.stringify(armature, null, 2) + '\n');
console.log(`wrote ${armaturePath} (${bones.length} bones, ${visuals.length} visuals)`);

const skfPath = path.join(SPIKE, 'lily.skf');
execSync('cp atlas.png atlas0.png && rm -f lily.skf && zip -j lily.skf armature.json atlas0.png', {
  cwd: SPIKE,
  stdio: 'inherit',
});
console.log(`wrote ${skfPath}`);
