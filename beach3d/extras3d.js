/* ============================================================
   beach3d/extras3d.js — procedural wardrobe "extra" props (3D)

   The GLB has no extra meshes (hair + swimsuit only), so the 2D
   `extra` slot (extra1..extra7) is rebuilt here from simple
   three.js primitives and parented to the character's Mixamo bones.

   Props are authored in MODEL SPACE (up = +Y, forward = +Z) at the
   skeleton's bind pose, then converted into the target bone's local
   space while the skeleton is still in bind pose (before the
   AnimationMixer starts). From then on each prop follows its bone's
   animation. Anchors are measured from the live bind-pose bone
   world positions, not hard-coded.

   Colors mirror the 2D catalog (js/character.js ITEMS.extra) so the
   props read as the same dress-up items. MeshToonMaterial +
   flatShading with the character's own toon ramp keeps the cel look.
   ============================================================ */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const EXTRA_IDS = ["extra1", "extra2", "extra3", "extra4", "extra5", "extra6", "extra7"];

/* 2D catalog palette (js/character.js ITEMS.extra). */
const C = {
  red: 0xff6b6b,
  green: 0x6bd66b,
  vine: 0x3fa93f,
  gold: 0xe0b420,
  yellow: 0xffd93d,
  sparkle: 0xffe9a8,
  pink: 0xff8fb8,
  pinkDark: 0xd9568a,
  pinkLight: 0xffc9dc,
  purple: 0xa56bd6,
  white: 0xfff9ec
};

/* Five-point star, extruded thin and centred — the wand tip. */
function starGeometry(outer, inner, points, depth) {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i) shape.lineTo(x, y); else shape.moveTo(x, y);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: false, curveSegments: 1
  });
  geo.center();
  return geo;
}

export function createExtras({ gradientMap } = {}) {
  let root = null;
  let appliedId = null;
  const groups = {};
  const materials = new Map();
  const geometries = new Set();

  function material(color) {
    if (!materials.has(color)) {
      const m = new THREE.MeshToonMaterial({ color, flatShading: true });
      if (gradientMap) m.gradientMap = gradientMap;
      materials.set(color, m);
    }
    return materials.get(color);
  }

  function geo(factory) {
    const g = factory();
    geometries.add(g);
    return g;
  }

  /* One prop mesh: never picks (raycast stubbed) and never casts shadow. */
  function add(group, geometry, color, pos, rot, scale) {
    const mesh = new THREE.Mesh(geometry, material(color));
    mesh.raycast = () => {};
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    if (scale) mesh.scale.set(scale[0], scale[1], scale[2]);
    group.add(mesh);
    return mesh;
  }

  /* ---- individual props (model-space layout, origin at anchor) ---- */

  function buildBow() {
    const g = new THREE.Group();
    const lobe = geo(() => new THREE.SphereGeometry(1, 10, 8));
    const knot = geo(() => new THREE.SphereGeometry(0.015, 8, 6));
    add(g, lobe, C.red, [-0.032, 0, 0], [0, 0, 0], [0.04, 0.028, 0.022]);
    add(g, lobe, C.red, [0.032, 0, 0], [0, 0, 0], [0.04, 0.028, 0.022]);
    add(g, knot, C.red, [0, 0.002, 0.004]);
    /* little green leaf above the knot */
    add(g, geo(() => new THREE.ConeGeometry(0.016, 0.034, 6)), C.green,
      [0.012, 0.03, 0.004], [0.1, 0, -0.7]);
    return g;
  }

  function buildWand() {
    const g = new THREE.Group();
    const shaft = geo(() => {
      const s = new THREE.CylinderGeometry(0.008, 0.008, 0.24, 8);
      s.translate(0, 0.12, 0);
      return s;
    });
    add(g, shaft, C.gold);
    add(g, geo(() => starGeometry(0.04, 0.018, 5, 0.014)), C.yellow, [0, 0.256, 0]);
    add(g, geo(() => new THREE.SphereGeometry(0.01, 6, 5)), C.sparkle, [0.055, 0.305, 0.01]);
    add(g, geo(() => new THREE.SphereGeometry(0.008, 6, 5)), C.sparkle, [-0.05, 0.23, 0.012]);
    return g;
  }

  function buildSunHat() {
    const g = new THREE.Group();
    /* Brim wide enough to read as a sun hat and crown dome tall/wide
       enough to cap the head so the scalp does not poke through. */
    add(g, geo(() => new THREE.CylinderGeometry(0.25, 0.255, 0.016, 28)), C.yellow, [0, 0, 0]);
    add(g, geo(() => new THREE.SphereGeometry(0.178, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2)),
      C.yellow, [0, 0.008, 0], null, [1, 0.95, 1]);
    add(g, geo(() => new THREE.CylinderGeometry(0.182, 0.182, 0.03, 22)), C.pink, [0, 0.02, 0]);
    return g;
  }

  function buildBackpack() {
    const g = new THREE.Group();
    const body = geo(() => new THREE.BoxGeometry(0.11, 0.12, 0.055));
    add(g, body, C.pink, [0, 0, 0]);
    /* rounded top flap + a darker pocket line, both chunky and readable */
    add(g, geo(() => new THREE.BoxGeometry(0.1, 0.045, 0.05)), C.pink, [0, 0.066, -0.004]);
    /* two darker straps down the visible (back-facing) face */
    const strap = geo(() => new THREE.BoxGeometry(0.016, 0.1, 0.014));
    add(g, strap, C.pinkDark, [-0.032, -0.006, -0.032]);
    add(g, strap, C.pinkDark, [0.032, -0.006, -0.032]);
    return g;
  }

  function buildPartyHat() {
    const g = new THREE.Group();
    const coneH = 0.14, coneR = 0.062;
    add(g, geo(() => new THREE.ConeGeometry(coneR, coneH, 14)), C.pink,
      [0, coneH / 2, 0]);
    /* stripe rings: short cylinders hugging the cone at two heights */
    add(g, geo(() => new THREE.CylinderGeometry(0.047, 0.051, 0.02, 14)), C.yellow,
      [0, 0.04, 0]);
    add(g, geo(() => new THREE.CylinderGeometry(0.027, 0.032, 0.018, 14)), C.purple,
      [0, 0.076, 0]);
    add(g, geo(() => new THREE.SphereGeometry(0.02, 8, 6)), C.purple, [0, coneH + 0.006, 0]);
    return g;
  }

  function buildCrown() {
    const g = new THREE.Group();
    const ringR = 0.225;
    add(g, geo(() => new THREE.TorusGeometry(ringR, 0.012, 8, 28)), C.vine,
      [0, 0, 0], [Math.PI / 2, 0, 0]);
    const flowers = [
      { a: 0.0, c: C.pink }, { a: 1.05, c: C.white }, { a: 2.09, c: C.yellow },
      { a: 3.14, c: C.pink }, { a: 4.19, c: C.white }, { a: 5.24, c: C.yellow }
    ];
    /* Merge each flower's spheres into one mesh per material at build time
       instead of emitting 31 tiny meshes. Each sub-geometry bakes its own
       world offset via .translate() so the layout is byte-identical to the
       old per-mesh version; the yellow mesh also absorbs every center
       sphere (they share the C.yellow material). Result: vine + pink +
       white + yellow = 4 meshes / 4 draw calls (was 31 / ~27). */
    const byColor = new Map();
    const push = (color, x, y, z, radius, w, h) => {
      const part = new THREE.SphereGeometry(radius, w, h);
      part.translate(x, y, z);
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color).push(part);
    };
    for (const f of flowers) {
      const cx = Math.sin(f.a) * ringR, cz = Math.cos(f.a) * ringR;
      for (let i = 0; i < 4; i++) {
        const p = (i / 4) * Math.PI * 2;
        push(f.c, cx + Math.cos(p) * 0.014, 0.012, cz + Math.sin(p) * 0.014,
          0.017, 7, 6);
      }
      push(C.yellow, cx, 0.02, cz, 0.009, 6, 5);
    }
    for (const [color, parts] of byColor) {
      add(g, geo(() => mergeGeometries(parts, false)), color);
    }
    return g;
  }

  function buildCatEars() {
    const g = new THREE.Group();
    const ear = geo(() => new THREE.ConeGeometry(0.04, 0.095, 5));
    const inner = geo(() => new THREE.ConeGeometry(0.022, 0.055, 5));
    for (const s of [-1, 1]) {
      add(g, ear, C.white, [s * 0.085, 0.047, 0], [0.06, 0, s * -0.18]);
      add(g, inner, C.pinkLight, [s * 0.085, 0.055, 0.014], [0.06, 0, s * -0.18]);
    }
    return g;
  }

  const BUILDERS = {
    extra1: buildBow,
    extra2: buildWand,
    extra3: buildSunHat,
    extra4: buildBackpack,
    extra5: buildPartyHat,
    extra6: buildCrown,
    extra7: buildCatEars
  };

  /* Bind-pose model-space anchor for a bone (falls back to the
     measured bind positions if a name is ever absent). */
  function bonePos(modelRoot, name, fallback) {
    modelRoot.updateMatrixWorld(true);
    const bone = modelRoot.getObjectByName(name);
    if (!bone) return fallback.clone();
    return modelRoot.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
  }

  function place(group, modelRoot, bone, pos, quat) {
    modelRoot.updateMatrixWorld(true);
    bone.updateWorldMatrix(true, false);
    const desired = new THREE.Matrix4().compose(
      pos, quat || new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    const world = new THREE.Matrix4().multiplyMatrices(modelRoot.matrixWorld, desired);
    const local = new THREE.Matrix4().copy(bone.matrixWorld).invert().multiply(world);
    local.decompose(group.position, group.quaternion, group.scale);
    bone.add(group);
  }

  function attach(modelRoot) {
    if (root) return;
    root = modelRoot;
    const headTop = bonePos(modelRoot, "mixamorigHeadTop_End", new THREE.Vector3(0, 0.824, 0.044));
    const spine2 = bonePos(modelRoot, "mixamorigSpine2", new THREE.Vector3(0, 0.539, -0.027));
    const hand = bonePos(modelRoot, "mixamorigRightHand", new THREE.Vector3(-0.145, 0.399, 0));

    const boneOf = {
      extra1: modelRoot.getObjectByName("mixamorigHead") || null,
      extra2: modelRoot.getObjectByName("mixamorigRightHand") || null,
      extra3: modelRoot.getObjectByName("mixamorigHead") || null,
      extra4: modelRoot.getObjectByName("mixamorigSpine2") || null,
      extra5: modelRoot.getObjectByName("mixamorigHead") || null,
      extra6: modelRoot.getObjectByName("mixamorigHead") || null,
      extra7: modelRoot.getObjectByName("mixamorigHead") || null
    };

    /* Model-space placement: authored up = +Y, forward = +Z. Head props
       clear the hair volume (crown reaches ≈H+0.185) so they sit on top
       of the head rather than inside it. */
    const H = headTop;
    const placements = {
      extra1: [H.clone().add(new THREE.Vector3(0.07, 0.135, 0.02)), null],
      extra2: [hand.clone().add(new THREE.Vector3(0.0, -0.02, 0.0)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(1.35, 0.62, -1.55))],
      extra3: [H.clone().add(new THREE.Vector3(0, 0.185, 0)), null],
      extra4: [spine2.clone().add(new THREE.Vector3(0, -0.09, -0.135)), null],
      extra5: [H.clone().add(new THREE.Vector3(0, 0.17, -0.005)),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.12, 0, 0))],
      extra6: [H.clone().add(new THREE.Vector3(0, 0.105, 0)), null],
      extra7: [H.clone().add(new THREE.Vector3(0, 0.175, 0)), null]
    };

    for (const id of EXTRA_IDS) {
      const group = BUILDERS[id]();
      group.name = "extra_" + id;
      const bone = boneOf[id];
      const [pos, quat] = placements[id];
      if (bone) place(group, modelRoot, bone, pos, quat);
      else group.position.copy(pos);
      group.visible = false;
      group.traverse(o => { if (o.isMesh) { o.raycast = () => {}; o.castShadow = false; } });
      (bone || modelRoot).add(group);
      groups[id] = group;
    }
    appliedId = null;
  }

  function setExtra(id) {
    const target = typeof id === "string" && EXTRA_IDS.includes(id) ? id : null;
    for (const key of EXTRA_IDS) {
      const g = groups[key];
      if (g) g.visible = key === target;
    }
    appliedId = target;
    return target !== null;
  }

  function applied() {
    return appliedId;
  }

  function dispose() {
    for (const id of Object.keys(groups)) {
      const g = groups[id];
      if (g.parent) g.parent.remove(g);
      delete groups[id];
    }
    for (const g of geometries) g.dispose();
    geometries.clear();
    for (const m of materials.values()) m.dispose();
    materials.clear();
    root = null;
    appliedId = null;
  }

  return { attach, setExtra, applied, dispose };
}
