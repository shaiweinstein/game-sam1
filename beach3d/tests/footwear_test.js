/* Test-only footwear/contact fixture. No gameplay cameras or clips are edited.
 * Surface and manualVertex are the corrected GPU-equivalent skinning helpers
 * from the garment regression, not rest-position or bone-origin measurements.
 */
import * as T from "three";
import { createCharacter } from "../character3d.js";
import { createClothes } from "../clothes3d.js";
import { Surface, manualVertex } from "./garment_test.js";
import { libraryGroundY } from "../library3d.js";

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const RUGS = [
  { x0: -3.6, x1: 3.6, z0: -3.4, z1: 1.8, y: .006 },
  { x0: -3.2, x1: 3.2, z0: -3.0, z1: 1.4, y: .012 }
];
const worldVertex = (m, i, target = new T.Vector3()) => m.getVertexPosition(i, target).applyMatrix4(m.matrixWorld);
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

class FootOpenings {
  constructor(surface) {
    this.surface = surface; this.triangles = [];
    const edges = surface.mesh.userData.footwear.openingEdges;
    const adjacency = new Map();
    edges.forEach((e, i) => e.forEach(v => { if (!adjacency.has(v)) adjacency.set(v, []); adjacency.get(v).push(i); }));
    const seen = new Set(); this.loops = [];
    for (let i = 0; i < edges.length; i++) {
      if (seen.has(i)) continue;
      const indices = new Set(), queue = [i], group = [];
      seen.add(i);
      for (let j = 0; j < queue.length; j++) {
        const e = edges[queue[j]]; group.push(e);
        for (const v of e) { indices.add(v); for (const next of adjacency.get(v)) if (!seen.has(next)) { seen.add(next); queue.push(next); } }
      }
      this.loops.push({ edges: group, indices: [...indices] });
    }
    if (surface.mesh.userData.footwear.kind !== "sandal") {
      assert(this.loops.length === 1 && [...adjacency.values()].every(list => list.length === 2), "Shoe collar is not a closed actual edge loop");
    }
  }
  update() {
    const { mesh, points } = this.surface, meta = mesh.userData.footwear; this.triangles = [];
    for (const loop of this.loops) {
      if (meta.kind === "sandal") {
        // A sandal strap is an arch over the REAL footbed. Its front/back
        // mouths are bounded by the actual strap edges and that footbed, not
        // by a made-up anatomical Y band. These walls are numerical only.
        const projected = new Map();
        for (const i of loop.indices) {
          const p = new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position, i); p.y = meta.soleTop;
          mesh.applyBoneTransform(meta.supportIndices[0], p).applyMatrix4(mesh.matrixWorld); projected.set(i, p);
        }
        for (const [a, b] of loop.edges) {
          this.triangles.push(new T.Triangle(points[b], points[a], projected.get(a)), new T.Triangle(points[b], projected.get(a), projected.get(b)));
        }
      } else {
        const center = loop.indices.reduce((p, i) => p.add(points[i]), new T.Vector3()).multiplyScalar(1 / loop.indices.length);
        for (const [a, b] of loop.edges) this.triangles.push(new T.Triangle(center, points[b], points[a]));
      }
    }
  }
  enters(origin, direction) {
    const ray = new T.Ray(origin, direction), hits = [], p = new T.Vector3(), n = new T.Vector3();
    for (const t of this.triangles) if (ray.intersectTriangle(t.a, t.b, t.c, false, p)) {
      const distance = p.distanceTo(origin);
      if (distance < .3 - 1e-7) hits.push({ distance, entry: t.getNormal(n).dot(direction) < 0 });
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits.filter((h, i) => !i || Math.abs(h.distance - hits[i - 1].distance) > 1e-7)
      .reduce((sum, hit) => sum + (hit.entry ? 1 : -1), 0) === 1;
  }
}

function referenceGround(mode, x, z) {
  if (mode === "slope") return x * .08 + z * .12;
  let y = 0;
  if (mode === "library") for (const r of RUGS)
    if (x >= r.x0 - 1e-9 && x <= r.x1 + 1e-9 && z >= r.z0 - 1e-9 && z <= r.z1 + 1e-9) y = r.y;
  return y;
}

// Independent terrain oracle: intersect every sole edge with rectangle edges,
// and test rectangle corners barycentrically inside projected sole triangles.
// It deliberately does NOT call libraryGroundY.sampleTriangle (the producer).
function terrainSamples(points, faces, emit, highCut = Infinity) {
  const hit = new T.Vector3();
  for (const face of faces) {
    const [a, b, c] = face.map(i => points[i]);
    if (Math.min(a.y, b.y, c.y) > highCut) continue;
    const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x), minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z);
    for (const r of RUGS) {
      if (maxX < r.x0 || minX > r.x1 || maxZ < r.z0 || minZ > r.z1) continue;
      if (minX >= r.x0 && maxX <= r.x1 && minZ >= r.z0 && maxZ <= r.z1) continue;
      for (const [p, q] of [[a, b], [b, c], [c, a]]) for (const [axis, value] of [["x", r.x0], ["x", r.x1], ["z", r.z0], ["z", r.z1]]) {
        if (Math.abs(q[axis] - p[axis]) < 1e-12) continue;
        const t = (value - p[axis]) / (q[axis] - p[axis]);
        if (t < 0 || t > 1) continue;
        hit.copy(p).lerp(q, t); hit[axis] = value;
        if (hit.x >= r.x0 - 1e-9 && hit.x <= r.x1 + 1e-9 && hit.z >= r.z0 - 1e-9 && hit.z <= r.z1 + 1e-9) emit(hit);
      }
      const det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(det) < 1e-12) continue;
      for (const x of [r.x0, r.x1]) for (const z of [r.z0, r.z1]) {
        const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
        const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det, w = 1 - u - v;
        if (Math.min(u, v, w) >= -1e-9) emit(hit.set(x, u * a.y + v * b.y + w * c.y, z));
      }
    }
  }
}

function bodyFootIds(body) {
  const a = body.geometry.attributes;
  return Array.from({ length: a.position.count }, (_, i) => i).filter(i => {
    let w = 0;
    for (let k = 0; k < 4; k++) if (/Foot|Toe/.test(body.skeleton.bones[a.skinIndex.getComponent(i, k)].name)) w += a.skinWeight.getComponent(i, k);
    return w > .05;
  });
}

export async function createFootwearFixture(durations) {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(400, 500); renderer.setClearColor(0xe6edf3); renderer.setPixelRatio(1);
  const scene = new T.Scene(); scene.add(new T.AmbientLight(0xfff1dc, .92));
  for (const [intensity, pos] of [[1.15, [2.5, 5.5, 5]], [.85, [-1.5, 5.8, -3.5]]]) {
    const light = new T.DirectionalLight(0xfff1dc, intensity); light.position.set(...pos); scene.add(light);
  }
  let mode = "flat";
  const ground = (x, z) => mode === "library" ? libraryGroundY(x, z) : referenceGround(mode, x, z);
  const character = createCharacter(renderer, scene, () => false, null, {
    bounds: { xMin: -8, xMax: 8, zMin: -6, zMax: 4 }, groundY: ground, zoneAt: () => "sand"
  });
  assert(await character.ready, "Character did not load");
  character.teleport(0, 0); character.setEnabled(false); character.setSwimsuitVisible(false); character.setHair("hair5");
  const body = character.root.getObjectByName("Torso001"), originalGeometry = body.geometry;
  const attrs = Object.fromEntries(["position", "skinIndex", "skinWeight"].map(n => [n, Array.from(body.geometry.attributes[n].array)]));
  const inverses = body.skeleton.boneInverses.map(m => [...m.elements]);
  const rest = Array.from({ length: body.geometry.attributes.position.count }, (_, i) => new T.Vector3().fromBufferAttribute(body.geometry.attributes.position, i));
  const bareIds = bodyFootIds(body), bodySurface = new Surface(body);
  const footFaces = bodySurface.faces.filter(face => face.every(i => rest[i].y < .16));
  const normals = rest.map(() => new T.Vector3()), vector = new T.Vector3(), edge = new T.Vector3();
  const f = { renderer, scene, character, body, originalGeometry, attrs, inverses, rest, bareIds, bodySurface,
    durations, clothes: null, mode: "flat", feet: [], bare: {}, contacts: {} };
  f.terrain = name => { mode = f.mode = name; ground.sampleTriangle = name === "library" ? libraryGroundY.sampleTriangle : undefined; };
  f.freeze = (clip, time, yaw = 0) => {
    character.loco.moving = clip === "Walk"; character.setStance(clip === "Walk" ? "walk" : "stand");
    character.update(.35, 0); character.probePose(time); character.loco.yaw = character.loco.yawTarget = yaw;
    character.update(0, 0); character.root.updateMatrixWorld(true);
    assert(character.currentClipName() === clip && Math.abs(character.currentClipTime() - time) < 1e-6, "Non-deterministic pose");
  };
  f.refresh = (fit = false) => {
    character.root.updateMatrixWorld(true); for (const foot of f.feet) { foot.update(); foot.openings.update(); }
    if (fit) {
      bodySurface.update(); for (const n of normals) n.set(0, 0, 0);
      for (const [a, b, c] of footFaces) {
        vector.subVectors(bodySurface.points[b], bodySurface.points[a]); edge.subVectors(bodySurface.points[c], bodySurface.points[a]); vector.cross(edge);
        normals[a].add(vector); normals[b].add(vector); normals[c].add(vector);
      }
      normals.forEach(n => n.normalize());
    }
  };
  f.normals = normals;
  f.apply = async (shoes, bottom = "bottom3") => {
    if (!f.clothes) f.clothes = createClothes(character);
    assert(f.clothes.apply({ top: "top1", bottom, shoes }), "Outfit apply failed");
    await character.root.getObjectByName("clothes_garments").userData.ready;
    f.feet = ["Left", "Right"].map(side => character.root.getObjectByName("shoe_" + side)).filter(Boolean).map(m => {
      const surface = new Surface(m); surface.openings = new FootOpenings(surface); return surface;
    });
    return f.feet;
  };
  // Record the real untouched solver before ANY footwear has been created.
  for (const clip of ["Walk", "Idle"]) {
    f.bare[clip] = [];
    for (let frame = 0; frame <= 128; frame++) {
      f.freeze(clip, Math.min(durations[clip] - 1e-7, durations[clip] * frame / 128));
      const minima = [Infinity, Infinity];
      for (const i of bareIds) { const p = worldVertex(body, i); const side = rest[i].x >= 0 ? 0 : 1; minima[side] = Math.min(minima[side], p.y); }
      f.bare[clip].push({ frame, root: character.getRootY(), feet: minima });
    }
  }
  return f;
}

function checkStructure(f) {
  for (const [name, values] of Object.entries(f.attrs)) assert(equal(Array.from(f.body.geometry.attributes[name].array), values), "Footwear changed body " + name);
  assert(f.body.skeleton.boneInverses.every((m, i) => equal(m.elements, f.inverses[i])), "Shared inverse binds changed");
  const details = [];
  for (const { mesh } of f.feet) {
    assert(mesh.isSkinnedMesh && mesh.skeleton === f.body.skeleton && mesh.bindMatrix.equals(f.body.bindMatrix), "Wrong footwear skeleton/bind space");
    const a = mesh.geometry.attributes, metadata = mesh.userData.footwear;
    const footIndex = mesh.skeleton.bones.findIndex(b => b.name === "mixamorig" + metadata.side + "Foot");
    let maxError = 0, ankleBlends = 0;
    for (let i = 0; i < a.position.count; i++) {
      let sum = 0, foot = 0, leg = 0;
      for (let k = 0; k < 3; k++) assert(Number.isFinite(a.position.getComponent(i, k)), "Nonfinite shoe vertex");
      for (let k = 0; k < 4; k++) {
        const j = a.skinIndex.getComponent(i, k), w = a.skinWeight.getComponent(i, k);
        assert(Number.isInteger(j) && j >= 0 && j < mesh.skeleton.bones.length && Number.isFinite(w) && w >= 0, "Invalid shoe weight");
        sum += w; if (j === footIndex) foot += w; if (mesh.skeleton.bones[j].name.endsWith(metadata.side + "Leg")) leg += w;
      }
      maxError = Math.max(maxError, Math.abs(sum - 1)); if (leg > .05 && foot > .05) ankleBlends++;
    }
    assert(maxError < 1e-5, "Unnormalized footwear");
    if (metadata.kind === "boot") assert(ankleBlends > 100, "Boot shaft is rigidly Foot-parented");
    for (const i of metadata.supportIndices) {
      const total = [0, 1, 2, 3].reduce((s, k) => s + (a.skinIndex.getComponent(i, k) === footIndex ? a.skinWeight.getComponent(i, k) : 0), 0);
      assert(total > .99999, "Outsole is not rigid with the actual foot core");
    }
    assert(metadata.soleThickness > .003 && metadata.soleThickness < .006, "Plank-like or nonexistent sole");
    details.push({ side: metadata.side, vertices: a.position.count, triangles: mesh.geometry.index.count / 3,
      soleThickness: metadata.soleThickness, maxWeightError: maxError, ankleBlends, supportVertices: metadata.supportIndices.length });
  }
  return details;
}

function groundSample(f) {
  const perFoot = [], allGaps = [];
  let manualError = 0, probes = 0;
  for (const surface of f.feet) {
    const { mesh, points } = surface, meta = mesh.userData.footwear;
    let sole = Infinity, all = Infinity;
    const read = p => { probes++; sole = Math.min(sole, p.y - referenceGround(f.mode, p.x, p.z)); };
    for (const p of points) all = Math.min(all, p.y - referenceGround(f.mode, p.x, p.z));
    meta.supportIndices.forEach(i => read(points[i]));
    if (f.mode === "library") {
      terrainSamples(points, meta.supportFaces, read);
      // Also check EVERY shoe triangle against the actual rug rectangles;
      // vertex-only checks would miss a toe edge over a raised patch.
      terrainSamples(points, surface.faces, p => { all = Math.min(all, p.y - referenceGround(f.mode, p.x, p.z)); }, .016);
    }
    perFoot.push(sole); allGaps.push(Math.min(all, sole));
    for (const i of [meta.supportIndices[0], meta.supportIndices.at(-1)]) manualError = Math.max(manualError, manualVertex(mesh, i).distanceTo(points[i]));
  }
  return { support: Math.min(...perFoot), feet: perFoot, all: Math.min(...allGaps), manualError, probes };
}

function coveredSkin(id, p) {
  // Independent anatomical test regions. Intentional flat/sandal/slipper
  // openings are checked separately, not silently treated as covered skin.
  if (id === "shoes2") return p.y < .136;
  if (id === "shoes1" || id === "shoes6") return p.y < .070;
  if (id === "shoes3") return p.y < .025 || (p.z > .103 && p.y < .057);
  if (id === "shoes5") return p.y < .035 || (p.z > .068 && p.y < .063);
  return p.y < .001 || (p.y < .063 && ((p.z > .019 && p.z < .032) || (p.z > .074 && p.z < .091)));
}

function fitSample(f, id) {
  const stats = { tested: 0, occluded: 0, openings: 0, misses: 0, leaks: 0, maxPenetration: -Infinity, worst: null };
  for (let i = 0; i < f.rest.length; i++) {
    const p = f.rest[i];
    if (p.y < -.001 || p.y > .145 || !coveredSkin(id, p)) continue;
    const normal = f.normals[i]; if (normal.lengthSq() < .5) continue;
    const skin = f.bodySurface.points[i], origin = skin.clone().addScaledVector(normal, .3), direction = normal.clone().negate();
    if (Math.abs(f.bodySurface.cast(origin, direction).distance - .3) > 1e-4) { stats.occluded++; continue; }
    const surface = f.feet[p.x >= 0 ? 0 : 1], hit = surface.cast(origin, direction);
    stats.tested++;
    if (hit.distance > .301 && surface.openings.enters(origin, direction)) { stats.openings++; continue; }
    if (!Number.isFinite(hit.distance)) { stats.misses++; if (!stats.worst) stats.worst = { index: i, rest: p.toArray(), reason: "no shoe surface" }; continue; }
    const depth = hit.distance - .3;
    if (depth > .001) stats.leaks++;
    if (depth > stats.maxPenetration) { stats.maxPenetration = depth; stats.worst = { index: i, rest: p.toArray(), depth }; }
  }
  return stats;
}

export async function auditShoe(f, id) {
  const c = f.character; f.terrain("flat"); c.teleport(0, 0); await f.apply(id);
  const result = { id, structure: checkStructure(f), scenarios: {}, fit: { tested: 0, openings: 0, leaks: 0, misses: 0, maxPenetration: -Infinity, worst: null } };
  const poses = [];
  for (const clip of ["Walk", "Idle"]) for (let frame = 0; frame <= 128; frame++) poses.push({ clip, frame, time: Math.min(f.durations[clip] - 1e-7, f.durations[clip] * frame / 128) });
  for (const clip of ["enter", "exit"]) for (let frame = 0; frame <= 36; frame++) poses.push({ clip, frame, time: frame / 120 });
  for (const [name, mode, x, z, yaw] of [["floor", "flat", 0, 0, 0], ["rug", "library", 0, 0, Math.PI], ["border", "library", 3.4, 0, Math.PI / 2], ["slope", "slope", 1, 1, -Math.PI / 2]]) {
    f.terrain(mode); c.teleport(x, z);
    const stats = { poses: {}, minSupport: Infinity, maxSupport: -Infinity, minAnyShoe: Infinity, idleOtherMax: 0,
      swingMax: 0, maxManualError: 0, supportProbes: 0, failures: [] };
    for (const phase of poses) {
      if (phase.clip === "enter" || phase.clip === "exit") {
        if (!phase.frame) { f.freeze(phase.clip === "enter" ? "Idle" : "Walk", phase.clip === "enter" ? 2.3 : .8, yaw); c.loco.moving = phase.clip === "enter"; c.setStance(phase.clip === "enter" ? "walk" : "stand"); }
        c.update(phase.frame ? 1 / 120 : 0, 0);
      } else f.freeze(phase.clip, phase.time, yaw);
      f.refresh(name === "floor"); const sample = groundSample(f);
      stats.poses[phase.clip] = (stats.poses[phase.clip] || 0) + 1;
      stats.minSupport = Math.min(stats.minSupport, sample.support); stats.maxSupport = Math.max(stats.maxSupport, sample.support);
      stats.minAnyShoe = Math.min(stats.minAnyShoe, sample.all); stats.maxManualError = Math.max(stats.maxManualError, sample.manualError); stats.supportProbes += sample.probes;
      if (phase.clip === "Idle") stats.idleOtherMax = Math.max(stats.idleOtherMax, ...sample.feet);
      if (phase.clip === "Walk") stats.swingMax = Math.max(stats.swingMax, ...sample.feet);
      if (sample.support < .001 - 1e-6 || sample.support > .004 + 1e-6 || sample.all < -.001) stats.failures.push({ phase, ...sample });
      if (name === "floor") {
        const fit = fitSample(f, id); result.fit.tested += fit.tested; result.fit.openings += fit.openings; result.fit.leaks += fit.leaks; result.fit.misses += fit.misses;
        if (fit.maxPenetration > result.fit.maxPenetration) { result.fit.maxPenetration = fit.maxPenetration; result.fit.worst = { phase, ...fit.worst }; }
      }
    }
    result.scenarios[name] = stats;
  }
  // Move through both real height steps and the inner rug corner. These are
  // native ground solves at every pose, not geometry shifted in a screenshot.
  for (const corner of [false, true]) {
    f.terrain("library"); const stats = { poses: 129, minSupport: Infinity, maxSupport: -Infinity, minAnyShoe: Infinity, maxRootStep: 0, failures: [] };
    let before = null;
    for (let frame = 0; frame <= 128; frame++) {
      const t = frame / 128, x = corner ? 3.40 - .4 * t : 3.9 - 1.0 * t, z = corner ? 1.60 - .4 * t : 0;
      c.teleport(x, z); f.freeze("Walk", Math.min(f.durations.Walk - 1e-7, f.durations.Walk * t), corner ? -3 * Math.PI / 4 : -Math.PI / 2);
      f.refresh(); const sample = groundSample(f);
      stats.minSupport = Math.min(stats.minSupport, sample.support); stats.maxSupport = Math.max(stats.maxSupport, sample.support); stats.minAnyShoe = Math.min(stats.minAnyShoe, sample.all);
      if (before !== null) stats.maxRootStep = Math.max(stats.maxRootStep, Math.abs(c.getRootY() - before)); before = c.getRootY();
      if (sample.support < .001 - 1e-6 || sample.support > .004 + 1e-6 || sample.all < -.001) stats.failures.push({ frame, x, z, ...sample });
    }
    result.scenarios[corner ? "rug-corner" : "rug-edge"] = stats;
  }
  f.contacts[id] = result; return JSON.parse(JSON.stringify(result));
}

export async function behaviorChecks(f) {
  const c = f.character, result = {};
  f.terrain("flat"); c.teleport(0, 0); await f.apply("shoes1");
  // Original instep failure: the actual source vertex, not an invented point.
  f.freeze("Walk", .433333356); f.refresh(true);
  const i = 12250, p = f.bodySurface.points[i], n = f.normals[i], origin = p.clone().addScaledVector(n, .3), dir = n.clone().negate();
  const good = f.feet[1].cast(origin, dir).distance - .3;
  assert(good < -.001, "Original closed-shoe instep remains exposed"); result.originalInstepClearance = -good;
  // Recreate the REMOVED upper, not just rigid weights on the new fitted
  // shape. A rigid foot core is legitimate; the old guessed ellipse was not.
  // These are its original rings, pole and trim split. Expressing the old
  // bone-parented mesh as a one-bone SkinnedMesh is the same affine transform.
  const correct = f.feet[1].mesh, badGeometry = new T.BufferGeometry();
  const footJoint = correct.skeleton.bones.findIndex(b => b.name === "mixamorigRightFoot");
  const bindOrigin = new T.Vector3().applyMatrix4(correct.skeleton.boneInverses[footJoint].clone().invert())
    .applyMatrix4(correct.bindMatrix.clone().invert());
  const rings = [[-.022,.003,.006],[-.006,.033,.010],[.010,.048,.012],[.050,.053,.013],
    [.090,.055,.013],[.130,.052,.007],[.160,.042,-.004],[.186,.003,-.024]];
  const positions = [], joints = [], weights = [], indices = [], segments = 26;
  for (const [z, rx, top] of rings) {
    const cy = (top - .060) / 2, ry = (top + .060) / 2;
    const arc = Math.acos(T.MathUtils.clamp((-.040 - cy) / ry, -1, 1));
    for (let k = 0; k < segments; k++) {
      const angle = -arc + 2 * arc * k / (segments - 1);
      positions.push(bindOrigin.x + (rx < .004 ? 0 : rx * Math.sin(angle)), bindOrigin.y + cy + ry * Math.cos(angle), bindOrigin.z + z);
      joints.push(footJoint, 0, 0, 0); weights.push(1, 0, 0, 0);
    }
  }
  for (let j = 0; j + 1 < rings.length; j++) for (let k = 0; k + 1 < segments; k++) {
    const a = j * segments + k, b = a + 1, c = a + segments, d = c + 1; indices.push(b, a, c, b, c, d);
  }
  badGeometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  badGeometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(joints, 4));
  badGeometry.setAttribute("skinWeight", new T.Float32BufferAttribute(weights, 4)); badGeometry.setIndex(indices);
  const badMesh = new T.SkinnedMesh(badGeometry, correct.material); badMesh.bind(correct.skeleton, correct.bindMatrix);
  badMesh.visible = false; correct.parent.add(badMesh); c.root.updateMatrixWorld(true);
  try {
    const bad = new Surface(badMesh); bad.update();
    const badDepth = bad.cast(origin, dir).distance - .3;
    result.legacyHullInstepNegativeControl = badDepth;
    assert(badDepth > .001, `Original upper did not reproduce the instep failure: ${badDepth}`);
  } finally { badMesh.removeFromParent(); badGeometry.dispose(); }
  // Disabling the opt-in provider must reproduce the old grounding failure,
  // proving that a bare-skin floor measurement cannot pass this regression.
  c.setSoleSupportProvider(null); f.freeze("Walk", .325); f.refresh(); result.withoutShoeProvider = groundSample(f);
  assert(result.withoutShoeProvider.all < -.001, "Ground-provider negative control did not fail");
  f.clothes.setVisible(false); f.clothes.setVisible(true); f.freeze("Walk", .325); f.refresh();
  assert(groundSample(f).all > .001, "Restoring shoe provider did not restore contact");

  // Intentional openings: the same anatomical instep is visible in a flat,
  // sandal and open slipper, while toes/straps are tested for actual coverage.
  result.openings = {};
  for (const id of ["shoes3", "shoes4", "shoes5"]) {
    await f.apply(id); f.freeze("Idle", 0); f.refresh(true);
    const n = f.normals[i], point = f.bodySurface.points[i], hit = f.feet[1].cast(point.clone().addScaledVector(n, .3), n.clone().negate());
    result.openings[id] = { skinBeforeShoe: hit.distance > .3, distance: Number.isFinite(hit.distance) ? hit.distance : null };
    assert(hit.distance > .3, "Intentional foot opening was painted/closed over");
  }

  // Boot shaft must fit UNDER the unchanged jeans, including the live cuff.
  await f.apply("shoes2", "bottom7"); const pants = new Surface(c.root.getObjectByName("clothes_pants"));
  const boots = { samples: 0, failures: 0, maxEscape: -Infinity };
  for (let frame = 0; frame <= 128; frame++) {
    f.freeze("Walk", Math.min(f.durations.Walk - 1e-7, f.durations.Walk * frame / 128)); f.refresh(); pants.update();
    for (const foot of f.feet) {
      const a = foot.mesh.geometry.attributes;
      for (let j = 0; j < a.position.count; j++) {
        const y = a.position.getY(j); if (y < .083 || y > .130) continue;
        const source = new T.Vector3().fromBufferAttribute(a.position, j);
        const centre = foot.mesh.applyBoneTransform(j, new T.Vector3(Math.sign(source.x) * .060, y, -.003)).applyMatrix4(foot.mesh.matrixWorld);
        const normal = foot.points[j].clone().sub(centre).normalize(), hit = pants.cast(foot.points[j].clone().addScaledVector(normal, .3), normal.negate());
        const depth = hit.distance - .3; boots.samples++; boots.maxEscape = Math.max(boots.maxEscape, depth); if (depth > .001) boots.failures++;
      }
    }
  }
  result.bootJeans = boots; assert(boots.samples > 10000 && boots.failures === 0, "Boot shaft escapes the jeans");

  result.barefoot = {};
  for (const noShoe of [null, "none"]) {
    await f.apply(noShoe); assert(!f.clothes.state().footwear.registered && f.feet.length === 0, "No-shoe outfit retained support");
    let error = 0;
    for (const clip of ["Walk", "Idle"]) for (const row of f.bare[clip]) {
      f.freeze(clip, Math.min(f.durations[clip] - 1e-7, f.durations[clip] * row.frame / 128)); error = Math.max(error, Math.abs(c.getRootY() - row.root));
    }
    assert(error < 1e-9, "No-shoe grounding did not restore the untouched barefoot solver"); result.barefoot[String(noShoe)] = { maxRootError: error };
  }
  await f.apply("shoes6"); f.clothes.setVisible(false); f.freeze("Idle", 0);
  assert(!f.clothes.state().footwear.registered && Math.abs(c.getRootY() - f.bare.Idle[0].root) < 1e-9, "Hide did not unregister shoe support");
  f.clothes.setVisible(true); f.freeze("Idle", 0); f.refresh(); assert(groundSample(f).all > .001, "Show did not register support");

  let oldCalls = 0, newCalls = 0;
  const oldRelease = c.setSoleSupportProvider(() => oldCalls++), newRelease = c.setSoleSupportProvider(() => newCalls++);
  assert(!oldRelease(), "Old owner cleared a newer provider"); c.update(0, 0);
  assert(oldCalls === 0 && newCalls === 1, "Provider replacement ownership is incorrect");
  f.clothes.dispose(); c.update(0, 0); assert(newCalls === 2, "Clothing disposal removed someone else's provider");
  assert(newRelease(), "Current owner could not unregister");
  f.freeze("Idle", 0); assert(f.body.geometry === f.originalGeometry && Math.abs(c.getRootY() - f.bare.Idle[0].root) < 1e-9, "Dispose did not restore barefoot/body");
  let emptyCalls = 0; const emptyRelease = c.setSoleSupportProvider(emit => { emptyCalls++; emit(new T.Vector3(NaN, 0, 0)); });
  f.freeze("Idle", 0); assert(emptyCalls && Math.abs(c.getRootY() - f.bare.Idle[0].root) < 1e-9, "Empty/invalid samples do not fall back to barefoot"); emptyRelease();
  result.providerLifecycle = { change: true, noShoes: true, hideShow: true, disposal: true, ownership: true, emptyFallback: true };

  // A raised rug corner lies inside this triangle although every vertex is
  // outside the inner rectangle. This catches a vertex-only support solver.
  const triangle = [new T.Vector3(3.23, .005, 1.36), new T.Vector3(3.16, .005, 1.43), new T.Vector3(3.23, .005, 1.43)];
  const vertexHeight = Math.max(...triangle.map(p => libraryGroundY(p.x, p.z))), samples = [];
  libraryGroundY.sampleTriangle(...triangle, p => samples.push(p.clone()));
  const clippedHeight = Math.max(...samples.map(p => referenceGround("library", p.x, p.z)));
  assert(vertexHeight === .006 && clippedHeight === .012, "Rug-corner intersection was missed");
  result.cornerNegativeControl = { vertexOnlyHeight: vertexHeight, actualSupportHeight: clippedHeight };
  f.clothes = null; await f.apply("shoes1"); return result;
}

export async function auditBareRug(f) {
  await f.apply(null); f.terrain("library");
  const ids = new Set(f.bareIds), faces = f.bodySurface.faces.filter(face => face.some(i => ids.has(i)));
  const result = { samples: 0, min: Infinity, max: -Infinity, failures: [] };
  for (const corner of [false, true]) for (let frame = 0; frame <= 128; frame++) {
    const t = frame / 128; f.character.teleport(corner ? 3.4 - .4 * t : 3.9 - t, corner ? 1.6 - .4 * t : 0);
    f.freeze("Walk", Math.min(f.durations.Walk - 1e-7, f.durations.Walk * t), corner ? -3 * Math.PI / 4 : -Math.PI / 2);
    f.bodySurface.update(); let support = Infinity;
    const sample = p => { result.samples++; support = Math.min(support, p.y - referenceGround("library", p.x, p.z)); };
    f.bareIds.forEach(i => sample(f.bodySurface.points[i])); terrainSamples(f.bodySurface.points, faces, sample, .016);
    result.min = Math.min(result.min, support); result.max = Math.max(result.max, support);
    if (support < -.001 || support > .004) result.failures.push({ corner, frame, support });
  }
  f.terrain("flat"); f.character.teleport(0, 0); await f.apply("shoes1"); return result;
}

export async function inspectLibrary() {
  window.LibraryScene.open(document.getElementById("library-stage")); await window.__library3d.waitReady();
  const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await frame(); const scene = window.__library3d.sceneRef(); scene.updateMatrixWorld(true);
  const rectangles = ["library_rug_border", "library_rug_inner"].map(name => {
    const mesh = scene.getObjectByName(name); assert(mesh, "Missing real rug mesh");
    const b = new T.Box3().setFromObject(mesh); return { name, x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, y: b.max.y };
  });
  for (let i = 0; i < RUGS.length; i++) for (const key of ["x0", "x1", "z0", "z1", "y"])
    assert(Math.abs(rectangles[i][key] - RUGS[i][key]) < 1e-6, "Contact oracle disagrees with visible rug " + key);
  const samples = [];
  for (let i = 1; i <= 6; i++) {
    window.GameState.setOutfitSlot("shoes", "shoes" + i); await frame(); scene.updateMatrixWorld(true);
    const state = window.__library3d.clothesState(); assert(state.footwear.id === "shoes" + i && state.footwear.registered, "Live library did not register footwear");
    let min = Infinity, worldMin = Infinity;
    for (const side of ["Left", "Right"]) {
      const mesh = scene.getObjectByName("shoe_" + side);
      for (const index of mesh.userData.footwear.supportIndices) {
        const p = worldVertex(mesh, index); let floor = 0;
        for (const r of rectangles) if (p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1) floor = r.y;
        min = Math.min(min, p.y - floor); worldMin = Math.min(worldMin, p.y);
      }
    }
    assert(min >= .001 && min <= .004, "Real library sole is not on the actual rug");
    samples.push({ id: "shoes" + i, minGap: min, lowestWorldY: worldMin });
  }
  window.LibraryScene.close(); return { rectangles, samples };
}

export async function contactSheet(f, id, jeans = false) {
  f.terrain("flat"); f.character.teleport(0, 0); await f.apply(id, jeans ? "bottom7" : "bottom3");
  const sheet = document.createElement("canvas"); sheet.width = 1200; sheet.height = 930;
  const ctx = sheet.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, sheet.width, sheet.height); ctx.font = "15px sans-serif";
  const ground = new T.Mesh(new T.PlaneGeometry(3, 3), new T.MeshBasicMaterial({ color: 0xd6d6cd })); ground.rotation.x = -Math.PI / 2; f.scene.add(ground);
  f.renderer.setSize(300, 270);
  const grid = new T.GridHelper(3, 60, 0xb7b7b0, 0xc7c7bf); grid.position.y = .0001; f.scene.add(grid);
  const camera = new T.OrthographicCamera(-.27, .27, .20, -.20, .001, 5); camera.position.set(0, .15, .55); camera.lookAt(0, .075, .015);
  const phases = [["Idle", 0], ["Walk", .325], ["Walk", .800], ["Walk", .967]];
  for (let row = 0; row < 3; row++) for (let col = 0; col < phases.length; col++) {
    const [clip, time] = phases[col], yaw = [0, Math.PI / 2, Math.PI][row]; f.freeze(clip, time, yaw);
    f.renderer.render(f.scene, camera); const x = col * 300, y = row * 310;
    ctx.fillStyle = "#18212b"; ctx.fillText(`${id}${jeans ? " + jeans" : ""} / ${["front", "side", "back"][row]} / ${clip} ${time.toFixed(3)}s`, x + 7, y + 22);
    ctx.drawImage(f.renderer.domElement, x, y + 30, 300, 270);
  }
  ground.removeFromParent(); ground.geometry.dispose(); ground.material.dispose();
  grid.removeFromParent(); grid.geometry.dispose(); grid.material.dispose();
  return sheet.toDataURL();
}
