/* Browser half of garment_test.py. Test-only: never imported by the game.
 * Every measured position is skinned from its actual geometry attribute.
 * Numerical cuff caps close the real animated rim for classification only;
 * they are never added to the scene or to production garment geometry.
 */
import * as T from "three";
import { createCharacter } from "../character3d.js";
import { createClothes } from "../clothes3d.js";

const RAY_LENGTH = .8, TOLERANCE = .001;
const PHASE_COUNT = 129, LEGACY_FRAMES = [15, 16, 17, 18, 19, 20, 21];
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const sameArray = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const worldVertex = (mesh, index, target = new T.Vector3()) =>
  mesh.getVertexPosition(index, target).applyMatrix4(mesh.matrixWorld);

// Independent reference, including bind/model/world transforms. In particular,
// applyBoneTransform(i, new Vector3()) does NOT read vertex i's source position.
export function manualVertex(mesh, index) {
  const a = mesh.geometry.attributes;
  const input = new T.Vector3().fromBufferAttribute(a.position, index).applyMatrix4(mesh.bindMatrix);
  const out = new T.Vector3(), matrix = new T.Matrix4(), point = new T.Vector3();
  for (let k = 0; k < 4; k++) {
    const joint = a.skinIndex.getComponent(index, k), weight = a.skinWeight.getComponent(index, k);
    matrix.multiplyMatrices(mesh.skeleton.bones[joint].matrixWorld, mesh.skeleton.boneInverses[joint]);
    out.addScaledVector(point.copy(input).applyMatrix4(matrix), weight);
  }
  return out.applyMatrix4(mesh.bindMatrixInverse).applyMatrix4(mesh.matrixWorld);
}

// Double-sided ray/triangle distance, with only a barycentric roundoff allowance.
// Without this, a ray exactly on a welded edge can miss BOTH adjacent triangles.
const edge1 = new T.Vector3(), edge2 = new T.Vector3(), cross = new T.Vector3();
const delta = new T.Vector3(), secondCross = new T.Vector3();
function triangleDistance(ray, a, b, c) {
  edge1.subVectors(b, a); edge2.subVectors(c, a); cross.crossVectors(ray.direction, edge2);
  const determinant = edge1.dot(cross);
  if (Math.abs(determinant) < 1e-16) return Infinity;
  delta.subVectors(ray.origin, a);
  const u = delta.dot(cross) / determinant;
  secondCross.crossVectors(delta, edge1);
  const v = ray.direction.dot(secondCross) / determinant;
  const distance = edge2.dot(secondCross) / determinant;
  return u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9 && distance >= 0 ? distance : Infinity;
}

export class Surface {
  constructor(mesh) {
    this.mesh = mesh;
    const a = mesh.geometry.attributes.position, index = mesh.geometry.index;
    this.points = Array.from({ length: a.count }, (_, i) => new T.Vector3().fromBufferAttribute(a, i));
    this.faces = Array.from({ length: index.count / 3 }, (_, i) =>
      [index.getX(i * 3), index.getX(i * 3 + 1), index.getX(i * 3 + 2)]);
    const centers = this.faces.map(ids => ids.reduce((p, i) => p.add(this.points[i]), new T.Vector3()).multiplyScalar(1 / 3));
    const build = ids => {
      const box = new T.Box3().setFromPoints(ids.map(i => centers[i]));
      if (ids.length <= 12) return { box, ids };
      const size = box.getSize(new T.Vector3());
      const axis = size.x > size.y ? (size.x > size.z ? "x" : "z") : (size.y > size.z ? "y" : "z");
      ids.sort((a, b) => centers[a][axis] - centers[b][axis]);
      const mid = ids.length >> 1;
      return { box, left: build(ids.slice(0, mid)), right: build(ids.slice(mid)) };
    };
    this.tree = build(this.faces.map((_, i) => i));
    this.ray = new T.Ray(); this.boxHit = new T.Vector3();
  }
  update() {
    this.points.forEach((p, i) => worldVertex(this.mesh, i, p));
    const refit = node => {
      node.box.makeEmpty();
      if (node.ids) for (const t of node.ids) for (const i of this.faces[t]) node.box.expandByPoint(this.points[i]);
      else { refit(node.left); refit(node.right); node.box.union(node.left.box).union(node.right.box); }
      node.box.expandByScalar(1e-10);
    };
    refit(this.tree);
  }
  cast(origin, direction) {
    this.ray.set(origin, direction);
    let distance = Infinity, face = -1;
    const walk = node => {
      if (!this.ray.intersectBox(node.box, this.boxHit)) return;
      if (!node.box.containsPoint(origin) && this.boxHit.distanceTo(origin) > distance + 1e-9) return;
      if (node.ids) {
        for (const t of node.ids) {
          const [a, b, c] = this.faces[t];
          const d = triangleDistance(this.ray, this.points[a], this.points[b], this.points[c]);
          if (d < distance) { distance = d; face = t; }
        }
      } else { walk(node.left); walk(node.right); }
    };
    walk(this.tree); return { distance, face };
  }
  nearest(point) {
    const triangle = new T.Triangle(), closest = new T.Vector3();
    let distance = Infinity, result = null;
    const walk = node => {
      node.box.clampPoint(point, closest);
      if (closest.distanceToSquared(point) > distance * distance) return;
      if (node.ids) {
        for (const face of node.ids) {
          triangle.set(...this.faces[face].map(i => this.points[i]));
          triangle.closestPointToPoint(point, closest);
          const d = closest.distanceTo(point);
          if (d < distance) {
            distance = d; const normal = triangle.getNormal(new T.Vector3());
            result = { face, distance, point: closest.clone(), normal,
              signedDistance: point.clone().sub(closest).dot(normal) };
          }
        }
      } else { walk(node.left); walk(node.right); }
    };
    walk(this.tree); return result;
  }
}

export class CuffOpenings {
  constructor(mesh) {
    this.mesh = mesh;
    const a = mesh.geometry.attributes.position;
    // Actual outer hem vertices of bottom7, not a guessed world-Y cutoff.
    // Subdivision gives 64 vertices per rim; duplicated UV vertices are welded.
    this.rings = [1, -1].map(sign => {
      const unique = new Map();
      for (let i = 0; i < a.count; i++) {
        if (Math.abs(a.getY(i) - .058) > 1e-6 || a.getX(i) * sign <= 0) continue;
        const p = new T.Vector3().fromBufferAttribute(a, i);
        unique.set(p.toArray().map(v => v.toFixed(6)).join(), { index: i, rest: p });
      }
      const ring = [...unique.values()].sort((a, b) =>
        Math.atan2(a.rest.x - sign * .0605, a.rest.z + .002) -
        Math.atan2(b.rest.x - sign * .0605, b.rest.z + .002));
      assert(ring.length === 64, "Authored cuff loop changed; opening oracle needs review");
      return ring;
    });
    this.ray = new T.Ray();
  }
  update(surface) {
    this.disks = this.rings.map(ring => {
      const points = ring.map(v => surface.points[v.index]);
      return { points, center: points.reduce((s, p) => s.add(p), new T.Vector3()).multiplyScalar(1 / points.length) };
    });
  }
  crossings(origin, direction, before = RAY_LENGTH) {
    this.ray.set(origin, direction);
    const hits = [];
    this.disks.forEach(({ points, center }, side) => {
      for (let i = 0; i < points.length; i++) {
        // Reverse the +Y winding: a lower opening's outward normal points down.
        const a = points[(i + 1) % points.length], b = points[i];
        const distance = triangleDistance(this.ray, center, a, b);
        if (distance >= before - 1e-7) continue;
        const normal = new T.Triangle(center, a, b).getNormal(new T.Vector3());
        hits.push({ side, distance, entry: normal.dot(direction) < 0,
          point: this.ray.at(distance, new T.Vector3()).toArray() });
      }
    });
    hits.sort((a, b) => a.distance - b.distance);
    return hits.filter((h, i) => !i || h.side !== hits[i - 1].side || Math.abs(h.distance - hits[i - 1].distance) > 1e-7);
  }
}

function classify(surface, openings, origin, direction) {
  const real = surface.cast(origin, direction);
  if (real.distance <= RAY_LENGTH + TOLERANCE) return { kind: "covered", real };
  // Keep the sample and the original failure. It is an opening sightline ONLY
  // if the ray entered the actual animated cuff before reaching the skin and
  // has not crossed fabric or exited another opening on the way to that point.
  const crossings = openings.crossings(origin, direction);
  const balance = crossings.reduce((n, h) => n + (h.entry ? 1 : -1), 0);
  return { kind: balance === 1 && real.distance > RAY_LENGTH ? "open-cuff" : "leak", real, crossings };
}

function assertWeights(mesh, source) {
  assert(mesh.isSkinnedMesh && mesh.skeleton === source.skeleton, "Garment must share the actual body skeleton");
  assert(mesh.bindMatrix.equals(source.bindMatrix), "Garment bind matrix changed");
  assert(mesh.bindMode === source.bindMode, "Garment bind mode changed");
  const a = mesh.geometry.attributes;
  let blended = 0, maxError = 0;
  const legInfluences = { Left: { kneeBlend: 0, calf: 0, ankleBlend: 0 }, Right: { kneeBlend: 0, calf: 0, ankleBlend: 0 } };
  for (let i = 0; i < a.position.count; i++) {
    let sum = 0, nonzero = 0;
    const byBone = {};
    for (let k = 0; k < 3; k++) assert(Number.isFinite(a.position.getComponent(i, k)), "Nonfinite garment vertex");
    for (let k = 0; k < 4; k++) {
      const w = a.skinWeight.getComponent(i, k), joint = a.skinIndex.getComponent(i, k);
      assert(Number.isFinite(w) && w >= 0 && Number.isInteger(joint) && joint >= 0 && joint < source.skeleton.bones.length, "Invalid skin influence");
      sum += w; if (w > 0) nonzero++;
      byBone[source.skeleton.bones[joint].name] = (byBone[source.skeleton.bones[joint].name] || 0) + w;
    }
    if (nonzero > 1) blended++;
    maxError = Math.max(maxError, Math.abs(sum - 1));
    if (mesh.name === "clothes_pants") {
      const side = a.position.getX(i) >= 0 ? "Left" : "Right", y = a.position.getY(i), n = "mixamorig" + side;
      const up = byBone[n + "UpLeg"] || 0, leg = byBone[n + "Leg"] || 0, foot = byBone[n + "Foot"] || 0;
      if (y > .13 && y < .19 && up > .05 && leg > .05) legInfluences[side].kneeBlend++;
      if (y > .09 && y < .135 && leg > .95) legInfluences[side].calf++;
      if (y < .09 && leg > .05 && foot > .05) legInfluences[side].ankleBlend++;
    }
  }
  assert(maxError < 1e-5 && blended > 100, "Garment is unnormalized or rigidly weighted");
  if (mesh.name === "clothes_pants") for (const side of Object.values(legInfluences))
    assert(side.kneeBlend > 20 && side.calf > 50 && side.ankleBlend > 20, "Jeans lost actual knee/calf/ankle influences");
  return { vertices: a.position.count, blended, maxWeightError: maxError,
    ...(mesh.name === "clothes_pants" ? { legInfluences } : {}) };
}

export async function createFixture(durations) {
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(400, 500); renderer.setPixelRatio(1); renderer.setClearColor(0xe6edf3);
  const scene = new T.Scene(); scene.add(new T.AmbientLight(0xfff1dc, .92));
  for (const [intensity, position] of [[1.15, [2.5, 5.5, 5]], [.85, [-1.5, 5.8, -3.5]]]) {
    const light = new T.DirectionalLight(0xfff1dc, intensity); light.position.set(...position); scene.add(light);
  }
  const character = createCharacter(renderer, scene, () => false, null, { groundY: () => 0, zoneAt: () => "sand" });
  const clothes = createClothes(character);
  assert(!clothes.apply({ top: "top3", bottom: "bottom7", shoes: "shoes1" }), "Pre-ready apply should queue");
  assert(await character.ready, "Character failed to load");
  character.teleport(0, 0); character.setEnabled(false); character.setSwimsuitVisible(false); character.setHair("hair5");
  const body = character.root.getObjectByName("Torso001"), originalGeometry = body.geometry;
  const inverseReferences = [...body.skeleton.boneInverses];
  const inverseValues = inverseReferences.map(m => [...m.elements]);
  const bodyAttributes = Object.fromEntries(["position", "skinIndex", "skinWeight"].map(name =>
    [name, Array.from(originalGeometry.attributes[name].array)]));
  const rest = Array.from({ length: originalGeometry.attributes.position.count }, (_, i) =>
    new T.Vector3().fromBufferAttribute(originalGeometry.attributes.position, i));
  const candidates = rest.map((_, i) => i).filter(i => {
    const a = originalGeometry.attributes; let arm = 0;
    for (let k = 0; k < 4; k++) if (/Arm|Hand/.test(body.skeleton.bones[a.skinIndex.getComponent(i, k)].name)) arm += a.skinWeight.getComponent(i, k);
    // EXACT legacy set, including the failed y=.0633125 ankle samples. No
    // raising the lower bound to miss calves/cuffs, nor per-pose exclusions.
    return arm < .01 && rest[i].y >= .060 && rest[i].y < .397;
  });
  assert(candidates.includes(9339) && candidates.length > 4000, "Original ankle sample was excluded");
  const state = { renderer, scene, character, clothes, body, originalGeometry, inverseReferences,
    inverseValues, bodyAttributes, rest, candidates, durations, surface: null, openings: null, bodySurface: null };
  state.apply = async shoes => {
    assert(clothes.apply({ top: "top3", bottom: "bottom7", shoes }), "Clothing apply failed");
    await character.root.getObjectByName("clothes_garments").userData.ready;
    const pants = character.root.getObjectByName("clothes_pants");
    state.surface = new Surface(pants); state.openings = new CuffOpenings(pants); state.bodySurface = new Surface(body);
    return pants;
  };
  state.freeze = (clip, time, yaw = 0) => {
    character.loco.moving = clip === "Walk"; character.setStance(clip === "Walk" ? "walk" : "stand");
    character.update(.35, 0); // finish only the previous stance blend
    character.probePose(time); character.loco.yaw = character.loco.yawTarget = yaw;
    character.update(0, 0); character.root.updateMatrixWorld(true);
    assert(character.currentClipName() === clip && Math.abs(character.currentClipTime() - time) < 1e-6, "Pose was not frozen at the requested phase");
  };
  state.updateSurfaces = () => {
    character.root.updateMatrixWorld(true); state.surface.update(); state.bodySurface.update(); state.openings.update(state.surface);
  };
  state.probe = index => {
    const p = state.bodySurface.points[index], r = rest[index];
    // This is an intentional arbitrary bind-space centre, initialized BEFORE
    // skinning with this vertex's weights. Actual vertices use worldVertex().
    const center = body.applyBoneTransform(index, new T.Vector3(r.y < .28 ? Math.sign(r.x) * .058 : 0, r.y, -.003)).applyMatrix4(body.matrixWorld);
    const outward = p.clone().sub(center).normalize(), origin = p.clone().addScaledVector(outward, RAY_LENGTH);
    const direction = outward.negate();
    return { p, origin, direction, result: classify(state.surface, state.openings, origin, direction) };
  };
  await state.apply("shoes1");
  return state;
}

export function runShoe(f, shoes) {
  const { character: c, body, clothes, rest, candidates, durations, surface, openings, bodySurface } = f;
  const pants = surface.mesh, group = c.root.getObjectByName("clothes_garments");
  const report = { shoes, weights: group.children.map(m => assertWeights(m, body)),
    candidates: candidates.length, phases: {}, rawFlags: [], leaks: [], manualMaxError: 0, mask: body.geometry.userData.libraryMask };
  const rendered = new Set(body.geometry.index.array);
  assert(rendered.has(9339), "Regression sample was hidden by a body mask");
  for (const [name, values] of Object.entries(f.bodyAttributes))
    assert(sameArray(Array.from(body.geometry.attributes[name].array), values), `Body ${name} was altered to hide a fit failure`);
  const currentTriangles = new Set();
  for (let i = 0; i < body.geometry.index.count; i += 3) currentTriangles.add([0, 1, 2].map(k => body.geometry.index.getX(i + k)).join());
  for (let i = 0; i < f.originalGeometry.index.count; i += 3) {
    const ids = [0, 1, 2].map(k => f.originalGeometry.index.getX(i + k));
    if (ids.some(j => rest[j].y < .165)) assert(currentTriangles.has(ids.join()), "A calf/ankle triangle was hidden");
  }
  const poses = [];
  for (const clip of ["Walk", "Idle"]) for (let frame = 0; frame < PHASE_COUNT; frame++)
    poses.push({ stage: clip, frame, time: Math.min(durations[clip] - 1e-7, durations[clip] * frame / 128) });
  for (const stage of ["enter", "exit"]) for (let frame = 0; frame <= 36; frame++) poses.push({ stage, frame, time: frame / 120 });
  for (const phase of poses) {
    if (phase.stage === "enter" || phase.stage === "exit") {
      if (!phase.frame) {
        f.freeze(phase.stage === "enter" ? "Idle" : "Walk", phase.stage === "enter" ? 2.3 : .8);
        c.loco.moving = phase.stage === "enter"; c.setStance(phase.stage === "enter" ? "walk" : "stand");
      }
      c.update(phase.frame ? 1 / 120 : 0, 0);
    } else f.freeze(phase.stage, phase.time);
    f.updateSurfaces();
    const stats = report.phases[phase.stage] ||= { poses: 0, samples: 0, occluded: 0, covered: 0, openCuff: 0, leaks: 0 };
    stats.poses++;
    assert(pants.matrixWorld.equals(body.matrixWorld), "Garment and source use different mesh/world spaces");
    for (const [mesh, ids] of [[body, [9339, 10354]], [pants, openings.rings.map(r => r[0].index)]])
      for (const i of ids) report.manualMaxError = Math.max(report.manualMaxError, manualVertex(mesh, i).distanceTo(worldVertex(mesh, i)));
    for (const index of candidates) {
      const { p, origin, direction, result } = f.probe(index);
      stats.samples++;
      // A source component can lie behind another body surface. Preserve and
      // count it as occluded, rather than claiming it was clothing-covered.
      const skinHit = bodySurface.cast(origin, direction);
      if (Math.abs(skinHit.distance - RAY_LENGTH) > 1e-4) { stats.occluded++; continue; }
      if (result.kind === "covered") { stats.covered++; continue; }
      const nearest = surface.nearest(p);
      const record = { ...phase, index, point: p.toArray(), legacyDistance: result.real.distance,
        classification: result.kind, crossings: result.crossings, nearestFabricDistance: nearest.distance,
        nearestSignedDistance: nearest.signedDistance };
      report.rawFlags.push(record);
      if (result.kind === "open-cuff") stats.openCuff++;
      else { stats.leaks++; report.leaks.push(record); }
    }
  }
  // Reproduce rather than erase the old failed phases, for EVERY shoe option.
  const oldFrames = [...new Set(report.rawFlags.filter(r => r.stage === "Idle").map(r => r.frame))].sort((a, b) => a - b);
  assert(sameArray(oldFrames, LEGACY_FRAMES), "Did not reproduce the seven original Idle phases");
  assert(report.rawFlags.filter(r => r.stage === "Idle" && r.index === 9339).length === 7, "Original failing vertex was dropped");
  assert(report.rawFlags.filter(r => r.stage === "Idle" && r.index === 10354).length === 5, "Second original failing vertex was dropped");
  report.openingSummary = {
    originalFlaggedFrames: oldFrames,
    nearestFabricRange: [Math.min(...report.rawFlags.map(r => r.nearestFabricDistance)), Math.max(...report.rawFlags.map(r => r.nearestFabricDistance))],
    entryBeforeSkinRange: [Math.min(...report.rawFlags.flatMap(r => r.crossings.map(h => RAY_LENGTH - h.distance))),
      Math.max(...report.rawFlags.flatMap(r => r.crossings.map(h => RAY_LENGTH - h.distance)))]
  };
  assert(report.manualMaxError < 1e-8, "CPU skinning disagrees with independent bind-space math");
  assert(report.phases.Walk.poses === 129 && report.phases.Idle.poses === 129, "Incomplete gait sampling");
  assert(report.phases.enter.poses === 37 && report.phases.exit.poses === 37, "Incomplete transition sampling");
  assert(Object.values(report.phases).every(s => s.covered > 10000 && s.samples === s.poses * candidates.length), "Empty or suppressed coverage");

  // Negative control: 4mm outside an actual mid-calf outer triangle must FAIL,
  // unlike a sightline that enters the cuff. This prevents an 'always open'
  // oracle from accepting rigid/misweighted trousers or real skin leaks.
  f.freeze("Idle", durations.Idle * 18 / 128); f.updateSurfaces();
  const a = pants.geometry.attributes.position;
  let negative = null;
  for (const ids of surface.faces) {
    const bind = ids.map(i => new T.Vector3().fromBufferAttribute(a, i));
    const center = bind.reduce((p, v) => p.add(v), new T.Vector3()).multiplyScalar(1 / 3);
    const normal = new T.Triangle(...bind).getNormal(new T.Vector3());
    if (center.x < .085 || center.y < .11 || center.y > .14 || normal.x < .8) continue;
    const tri = new T.Triangle(...ids.map(i => surface.points[i]));
    const outward = tri.getNormal(new T.Vector3()), point = tri.getMidpoint(new T.Vector3()).addScaledVector(outward, .004);
    negative = classify(surface, openings, point.clone().addScaledVector(outward, RAY_LENGTH), outward.negate()); break;
  }
  assert(negative?.kind === "leak", "Deliberate covered-skin penetration was accepted");
  report.negativeControl = { classification: negative.kind, outsideDistance: negative.real.distance - RAY_LENGTH };
  assert(clothes.state().applied === `top3|bottom7|${shoes}`, "Clothing state does not match requested shoes");
  return report;
}

class AnimatedHem {
  constructor(mesh) {
    const p = mesh.geometry.attributes.position, index = mesh.geometry.index;
    this.bindY = Infinity;
    for (let i = 0; i < p.count; i++) this.bindY = Math.min(this.bindY, p.getY(i));
    const key = i => [p.getX(i), p.getY(i), p.getZ(i)].map(n => Math.round(n * 1e6)).join();
    const points = new Map(), edges = new Map();
    for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i) - this.bindY) < 1e-6)
      points.set(key(i), { index: i, angle: Math.atan2(p.getX(i), p.getZ(i) + .004) });
    for (let i = 0; i < index.count; i += 3) for (let j = 0; j < 3; j++) {
      const a = key(index.getX(i + j)), b = key(index.getX(i + (j + 1) % 3));
      if (a === b || !points.has(a) || !points.has(b)) continue;
      const edge = [a, b].sort().join("|"); edges.set(edge, (edges.get(edge) || 0) + 1);
    }
    const loop = [...points].sort((a, b) => a[1].angle - b[1].angle);
    assert(loop.length >= 32, "Skirt/dress has no sufficiently sampled real hem");
    for (let i = 0; i < loop.length; i++) {
      const edge = [loop[i][0], loop[(i + 1) % loop.length][0]].sort().join("|");
      assert(edges.get(edge) === 1, "Hem samples are not the actual welded boundary loop");
    }
    this.indices = loop.map(([, v]) => v.index);
  }
  update(surface, rootInverse) {
    const points = this.indices.map(i => surface.points[i].clone().applyMatrix4(rootInverse));
    this.center = points.reduce((p, v) => p.add(v), new T.Vector3()).multiplyScalar(1 / points.length);
    const ring = points.map(p => ({ p, angle: Math.atan2(p.x - this.center.x, p.z - this.center.z) }));
    let winding = 0;
    for (let i = 0; i < ring.length; i++) {
      const d = ring[(i + 1) % ring.length].angle - ring[i].angle, arc = Math.atan2(Math.sin(d), Math.cos(d));
      // Sorting a folded/non-star-shaped loop would invent a different hem.
      assert(arc >= -1e-7 && arc < Math.PI, "Animated hem requires a non-radial coverage oracle"); winding += arc;
    }
    assert(Math.abs(winding - Math.PI * 2) < 1e-5, "Animated hem lost its closed winding");
    this.ring = ring.sort((a, b) => a.angle - b.angle);
  }
  at(point) {
    let dx = point.x - this.center.x, dz = point.z - this.center.z;
    const length = Math.hypot(dx, dz);
    if (length < 1e-10) { dx = 0; dz = 1; } else { dx /= length; dz /= length; }
    const angle = Math.atan2(dx, dz), ring = this.ring;
    let lo = 0, hi = ring.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ring[mid].angle < angle) lo = mid + 1; else hi = mid; }
    const next = lo % ring.length, a = ring[(next + ring.length - 1) % ring.length].p, b = ring[next].p;
    const ex = b.x - a.x, ez = b.z - a.z, ax = a.x - this.center.x, az = a.z - this.center.z;
    const denominator = dx * ez - dz * ex;
    assert(Math.abs(denominator) > 1e-14, "Degenerate animated hem segment");
    const fraction = (ax * dz - az * dx) / denominator;
    assert(fraction >= -1e-6 && fraction <= 1 + 1e-6, "Ray missed its actual hem segment");
    // Intersect the posed straight edge itself, not an angle-interpolated or
    // static Y approximation. Below/at this opening is intentionally bare.
    const y = T.MathUtils.lerp(a.y, b.y, T.MathUtils.clamp(fraction, 0, 1));
    return { y, above: point.y - y, direction: new T.Vector3(dx, 0, dz) };
  }
}

function skirtProbe(surface, hem, root, rootInverse, point, waistY) {
  const local = point.clone().applyMatrix4(rootInverse), opening = hem.at(local);
  // A one-micron numerical boundary guard is below the unchanged 1mm leak
  // tolerance. No calf/thigh band is discarded in bind space.
  if (opening.above < -1e-6) return { kind: "belowHem", aboveHem: opening.above };
  if (opening.above <= 1e-6) return { kind: "hemEdge", aboveHem: opening.above };
  if (local.y > waistY) return { kind: "aboveWaist", aboveHem: opening.above };
  const direction = opening.direction.transformDirection(root.matrixWorld).negate();
  const origin = point.clone().addScaledVector(direction, -RAY_LENGTH);
  const hit = surface.cast(origin, direction), depth = hit.distance - RAY_LENGTH;
  return { kind: depth > TOLERANCE ? "leak" : "covered", depth, aboveHem: opening.above, origin, direction };
}

export async function runSkirtDress(f) {
  const { character: c, body, clothes, originalGeometry, rest, durations } = f;
  const attributes = originalGeometry.attributes;
  const candidates = rest.map((_, i) => i).filter(i => {
    let arm = 0;
    for (let k = 0; k < 4; k++) if (/Arm|Hand/.test(body.skeleton.bones[attributes.skinIndex.getComponent(i, k)].name)) arm += attributes.skinWeight.getComponent(i, k);
    return arm < .01 && rest[i].y > .025 && rest[i].y < .397;
  });
  assert(candidates.length > 5000 && candidates.includes(11007) && candidates.includes(13168), "Historical knee samples were excluded");
  const poses = [];
  for (const clip of ["Walk", "Idle"]) for (let frame = 0; frame < PHASE_COUNT; frame++) {
    let time = Math.min(durations[clip] - 1e-7, durations[clip] * frame / 128);
    if (clip === "Walk" && frame === 96) { assert(Math.abs(time - .800) < 1e-6, "Historical .800 phase moved"); time = .800; }
    poses.push({ stage: clip, frame, time });
  }
  for (const stage of ["enter", "exit"]) for (let frame = 0; frame <= 36; frame++) poses.push({ stage, frame, time: frame / 120 });
  const reports = {};
  // Two representative cases only. Existing six-shoe jeans/texture/lifecycle
  // assertions remain unchanged; no outfit Cartesian product is necessary.
  for (const [label, top, name, historical] of [["skirt", "top1", "clothes_skirt", 11007], ["dress", "top2", "clothes_dress", 13168]]) {
    assert(clothes.apply({ top, bottom: "bottom1", shoes: "shoes1" }), "Skirt/dress apply failed");
    await c.root.getObjectByName("clothes_garments").userData.ready;
    const mesh = c.root.getObjectByName(name), surface = new Surface(mesh), bodySurface = new Surface(body), hem = new AnimatedHem(mesh);
    const inverse = new T.Matrix4(), hip = c.root.getObjectByName("mixamorigHips"), hipPoint = new T.Vector3();
    const report = { candidates: candidates.length, hemVertices: hem.indices.length, bindHemY: hem.bindY,
      weights: assertWeights(mesh, body), phases: {}, leaks: [], historical: null, manualMaxError: 0, negatives: {} };
    reports[label] = report;
    for (const [key, values] of Object.entries(f.bodyAttributes))
      assert(sameArray(Array.from(body.geometry.attributes[key].array), values), "Skirt/dress altered body " + key);
    const present = new Set();
    for (let i = 0; i < body.geometry.index.count; i += 3) present.add([0, 1, 2].map(k => body.geometry.index.getX(i + k)).join());
    for (let i = 0; i < originalGeometry.index.count; i += 3) {
      const face = [0, 1, 2].map(k => originalGeometry.index.getX(i + k));
      if (face.some(j => rest[j].y < .397)) assert(present.has(face.join()), "Skirt/dress hid lower-body triangles");
    }
    const update = () => {
      c.root.updateMatrixWorld(true); inverse.copy(c.root.matrixWorld).invert(); surface.update(); bodySurface.update(); hem.update(surface, inverse);
      hip.getWorldPosition(hipPoint).applyMatrix4(inverse);
    };
    const region = index => rest[index].y >= .18 ? "thigh" : rest[index].y >= .12 ? "knee" : "calfAnkle";
    for (const phase of poses) {
      if (phase.stage === "enter" || phase.stage === "exit") {
        if (!phase.frame) {
          f.freeze(phase.stage === "enter" ? "Idle" : "Walk", phase.stage === "enter" ? 2.3 : .8);
          c.loco.moving = phase.stage === "enter"; c.setStance(phase.stage === "enter" ? "walk" : "stand");
        }
        c.update(phase.frame ? 1 / 120 : 0, 0);
      } else f.freeze(phase.stage, phase.time);
      update();
      const stats = report.phases[phase.stage] ||= { poses: 0, samples: 0, belowHem: 0, hemEdge: 0, aboveWaist: 0, occluded: 0,
        covered: 0, leaks: 0, thigh: 0, knee: 0, calfAnkle: 0, liftedFromBelowBindHem: 0, maxPenetration: -Infinity };
      stats.poses++;
      assert(mesh.matrixWorld.equals(body.matrixWorld), "Skirt/dress uses the wrong mesh/world space");
      for (const [m, i] of [[body, historical], [mesh, hem.indices[0]]])
        report.manualMaxError = Math.max(report.manualMaxError, manualVertex(m, i).distanceTo(worldVertex(m, i)));
      for (const index of candidates) {
        stats.samples++;
        const p = bodySurface.points[index], probe = skirtProbe(surface, hem, c.root, inverse, p, hipPoint.y + .052);
        if (phase.stage === "Walk" && phase.frame === 96 && index === historical)
          report.historical = { time: phase.time, index, restY: rest[index].y, classification: probe.kind, aboveHem: probe.aboveHem };
        if (probe.kind !== "covered" && probe.kind !== "leak") { stats[probe.kind]++; continue; }
        if (Math.abs(bodySurface.cast(probe.origin, probe.direction).distance - RAY_LENGTH) > 1e-4) { stats.occluded++; continue; }
        stats[region(index)]++;
        if (rest[index].y < hem.bindY) stats.liftedFromBelowBindHem++;
        stats.maxPenetration = Math.max(stats.maxPenetration, probe.depth);
        if (probe.kind === "covered") stats.covered++;
        else {
          stats.leaks++;
          report.leaks.push({ ...phase, index, region: region(index), aboveHem: probe.aboveHem,
            depth: Number.isFinite(probe.depth) ? probe.depth : null });
        }
      }
    }
    assert(report.historical?.time === .800 && report.manualMaxError < 1e-8, "Historical pose or CPU skinning was not checked");
    for (const [stage, count] of [["Walk", 129], ["Idle", 129], ["enter", 37], ["exit", 37]]) {
      const s = report.phases[stage];
      assert(s.poses === count && s.samples === count * candidates.length, "Incomplete skirt/dress cycle or dropped samples");
      assert(s.covered > 10000 && s.belowHem > 10000, "Vacuous fabric/open-hem coverage");
      assert(s.samples === s.covered + s.leaks + s.occluded + s.belowHem + s.hemEdge + s.aboveWaist, "Unaccounted skin samples");
    }
    assert(report.phases.Walk.knee > 100 && report.phases.Walk.liftedFromBelowBindHem > 100, "Raised knees below the REST hem were missed");

    f.freeze("Walk", .800); update();
    // Reproduce the original single-Hips attachment STRATEGY on a private
    // copy of this template. The visible production mesh/clip is untouched.
    const badGeometry = mesh.geometry.clone(), hips = body.skeleton.bones.indexOf(hip);
    for (let i = 0; i < badGeometry.attributes.position.count; i++) {
      badGeometry.attributes.skinIndex.setXYZW(i, hips, 0, 0, 0); badGeometry.attributes.skinWeight.setXYZW(i, 1, 0, 0, 0);
    }
    const bad = new T.SkinnedMesh(badGeometry, mesh.material); bad.bind(body.skeleton, body.bindMatrix); bad.visible = false; mesh.parent.add(bad);
    try {
      c.root.updateMatrixWorld(true); const rigid = new Surface(bad), rigidHem = new AnimatedHem(bad); rigid.update(); rigidHem.update(rigid, inverse);
      const failure = { time: .800, considered: 0, covered: 0, leaks: 0, thigh: 0, knee: 0, examples: [] };
      for (const index of candidates) {
        const p = bodySurface.points[index], probe = skirtProbe(rigid, rigidHem, c.root, inverse, p, hipPoint.y + .052);
        if (!probe.origin || Math.abs(bodySurface.cast(probe.origin, probe.direction).distance - RAY_LENGTH) > 1e-4) continue;
        failure.considered++;
        if (probe.kind === "covered") failure.covered++;
        else if (probe.kind === "leak") {
          failure.leaks++; if (region(index) === "thigh") failure.thigh++; if (region(index) === "knee") failure.knee++;
          if (failure.examples.length < 8) failure.examples.push({ index, region: region(index), aboveHem: probe.aboveHem, depth: probe.depth });
        }
      }
      assert(failure.considered > 500 && failure.leaks > 0 && failure.thigh + failure.knee > 0, "Rigid attachment escaped the above-hem skin check");
      report.negatives.rigidHips = failure;
    } finally { bad.removeFromParent(); badGeometry.dispose(); }

    // Deliberate 4mm skin breach through a real panel, safely ABOVE the posed
    // hem. It must fail, while a point just below that same hem stays an opening.
    let deliberate = null;
    const a = mesh.geometry.attributes.position;
    for (const face of surface.faces) {
      const y = face.reduce((sum, i) => sum + a.getY(i), 0) / 3;
      if (y < .235 || y > .280) continue;
      const triangle = new T.Triangle(...face.map(i => surface.points[i])), n = triangle.getNormal(new T.Vector3());
      const point = triangle.getMidpoint(new T.Vector3()).addScaledVector(n, .004);
      const probe = skirtProbe(surface, hem, c.root, inverse, point, hipPoint.y + .052);
      if (!probe.origin || probe.aboveHem < .010 || n.dot(probe.direction) > -.8) continue;
      assert(probe.kind === "leak" && probe.depth > .001, "Deliberate above-hem breach was waived as an opening");
      const local = point.clone().applyMatrix4(inverse), edge = hem.at(local); local.y = edge.y - .005;
      const below = skirtProbe(surface, hem, c.root, inverse, local.applyMatrix4(c.root.matrixWorld), hipPoint.y + .052);
      assert(below.kind === "belowHem", "Intentional exposure below the animated hem was called a leak");
      deliberate = { depth: probe.depth, aboveHem: probe.aboveHem, classification: probe.kind, belowHemControl: below.kind }; break;
    }
    assert(deliberate, "No meaningful above-hem negative control"); report.negatives.deliberate = deliberate;
  }
  return reports;
}

export async function finishChecks(f) {
  const { character: c, body, clothes, originalGeometry, inverseReferences, inverseValues } = f;
  const info = { invariance: [], lifecycle: {} };
  await f.apply("shoes1"); f.freeze("Idle", f.durations.Idle * 18 / 128); f.updateSurfaces();
  const reference = f.surface.points.map(p => p.clone().applyMatrix4(c.root.matrixWorld.clone().invert()));
  for (const yaw of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
    c.teleport(2, 1); f.freeze("Idle", f.durations.Idle * 18 / 128, yaw); f.updateSurfaces();
    const inverse = c.root.matrixWorld.clone().invert();
    const maxError = Math.max(...f.surface.points.map((p, i) => p.clone().applyMatrix4(inverse).distanceTo(reference[i])));
    const classification = f.probe(9339).result.kind;
    assert(maxError < 1e-6 && classification === "open-cuff", "Translated/yawed opening classification changed");
    info.invariance.push({ yaw, maxError, classification });
  }
  assert(body.skeleton.boneInverses.every((m, i) => m === inverseReferences[i] && sameArray(m.elements, inverseValues[i])), "Shared inverse binds were recalculated");
  const zero = body.applyBoneTransform(9339, new T.Vector3()).applyMatrix4(body.matrixWorld);
  assert(zero.distanceTo(worldVertex(body, 9339)) > .01, "Uninitialized-input negative control is ineffective");
  info.correctVertexInitialization = true;
  const group = c.root.getObjectByName("clothes_garments"), masked = body.geometry;
  assert(clothes.apply({ top: "top3", bottom: "bottom7", shoes: "shoes1" }) && c.root.getObjectByName("clothes_garments") === group, "Idempotent apply rebuilt clothing");
  clothes.setVisible(false); assert(body.geometry === originalGeometry && !group.visible, "Hide failed to restore body");
  clothes.setVisible(true); assert(body.geometry === masked && group.visible, "Show failed to restore the bounded mask");
  let disposed = 0; group.children.forEach(m => m.geometry.addEventListener("dispose", () => disposed++));
  clothes.apply({ top: "top2", bottom: "bottom7", shoes: "shoes1" });
  await c.root.getObjectByName("clothes_garments").userData.ready;
  assert(body.geometry === originalGeometry && disposed === 2 && !c.root.getObjectByName("clothes_pants"), "Outfit change leaked geometry/masking");
  await f.apply("shoes6"); clothes.dispose();
  assert(body.geometry === originalGeometry && !c.root.getObjectByName("clothes_garments") && !c.root.getObjectByName("clothes_shoe_Left"), "Dispose failed to restore original body/remove clothes");
  assert(!originalGeometry.userData.libraryMask, "Original geometry metadata was mutated");
  info.lifecycle = { pendingApply: true, idempotence: true, hideShow: true, outfitChange: true, disposal: true, inverseBindsUnchanged: true };
  return info;
}

export async function rapidAppearanceChecks() {
  await import("../library3d.js");
  const stage = document.getElementById("library-stage"), state = window.GameState;
  const originalImage = window.Image, createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL;
  const images = [], textures = new Map(), groups = new Set(), readiness = [], liveSVG = new Set();
  let svgCreated = 0, svgRevoked = 0, slotChanges = 0, reopens = 0;
  const digest = canvas => {
    const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 4) hash = Math.imul(hash ^
      ((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3]), 16777619);
    return hash >>> 0;
  };
  const watch = () => {
    const group = window.__library3d.sceneRef()?.getObjectByName("clothes_garments");
    if (!group || groups.has(group)) return group;
    groups.add(group); readiness.push(group.userData.ready);
    group.traverse(mesh => {
      const texture = mesh.material?.map;
      if (!texture?.isCanvasTexture || textures.has(texture)) return;
      const record = { texture, retired: null };
      textures.set(texture, record);
      texture.addEventListener("dispose", () => {
        // Record the state AT disposal, not before it could finish painting.
        record.retired ||= { version: texture.version, digest: digest(texture.image) };
      });
    });
    return group;
  };
  const set = (slot, id) => { state.setOutfitSlot(slot, id); slotChanges++; watch(); };
  const waitReady = async () => {
    assert(await window.__library3d.waitReady(), "Library character did not become ready");
    const group = watch(); assert(group, "Missing final garment group");
    await group.userData.ready;
    assert(window.__library3d.sceneRef().getObjectByName("clothes_garments") === group, "Awaited a retired garment");
    return group;
  };
  const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const pmBurst = () => {
    // EXACT reported sequence, in one JS turn, with no await between setters.
    set("top", "top2"); set("bottom", "bottom7"); set("shoes", "shoes4");
  };
  window.Image = new Proxy(originalImage, {
    construct(target, args, newTarget) {
      const image = Reflect.construct(target, args, newTarget); images.push(image); return image;
    }
  });
  URL.createObjectURL = blob => {
    const url = createURL.call(URL, blob);
    if (blob.type === "image/svg+xml") { svgCreated++; liveSVG.add(url); }
    return url;
  };
  URL.revokeObjectURL = url => {
    if (liveSVG.delete(url)) svgRevoked++;
    return revokeURL.call(URL, url);
  };
  try {
    // Establish the PM's starting outfit before opening, then allow that
    // initial paint to finish. Only the subsequent rapid changes race.
    set("top", "top3"); set("bottom", "bottom7"); set("shoes", "shoes2");
    assert(window.LibraryScene.open(stage), "Library failed to open"); await waitReady();
    pmBurst(); await waitReady();
    for (let cycle = 0; cycle < 3; cycle++) {
      // Both the reset and reported burst are synchronous. Close and reopen
      // before the final Image load event has an opportunity to run.
      set("top", "top3"); set("bottom", "bottom7"); set("shoes", "shoes2");
      pmBurst(); window.LibraryScene.close();
      assert(window.LibraryScene.open(stage), "Immediate reopen failed"); reopens++;
      await waitReady();
    }
    const final = await waitReady(), dress = final.getObjectByName("clothes_dress");
    assert(dress?.material.map, "Final saved dress is missing");
    assert(window.__library3d.clothesState().applied === "top2|bottom7|shoes4", "Final outfit is stale");
    const texture = dress.material.map, canvas = texture.image;
    assert(texture.version >= 2, "Readiness resolved without painting the final texture");
    const pixel = (x, y) => Array.from(canvas.getContext("2d").getImageData(
      Math.round((x - 70) / 160 * 512), Math.round((y - 150) / 170 * 1024), 1, 1).data);
    // Actual bound texture, not catalog metadata or a fresh reference image:
    // all four gold sparkles must be present on the purple dress canvas.
    const motif = [[128, 192], [165, 186], [150, 257], [122, 244]].map(([x, y]) => ({ x, y, rgba: pixel(x, y) }));
    assert(motif.every(({ rgba: p }) => p[0] > 230 && p[1] > 200 && p[2] < 200 && p[3] === 255), "Final dress sparkle motif was not painted");
    const base = pixel(150, 235);
    assert(Math.abs(base[0] - 165) <= 1 && Math.abs(base[1] - 107) <= 1 && Math.abs(base[2] - 214) <= 1, "Final dress base color is stale");
    window.__library3d.render();
    const atlas = canvas.toDataURL();
    window.LibraryScene.close();
    // Wait for every observed Image decode, including retired paints. This
    // detects late writes rather than taking a snapshot before they can run.
    const decodes = await Promise.allSettled(images.filter(image => image.src).map(image => image.decode()));
    await Promise.all(readiness); await frames();
    const retired = [...textures.values()];
    assert(retired.length >= 12 && retired.every(r => r.retired), "Race did not retire enough real textures");
    const cancelledBeforePaint = retired.filter(r => r.retired.version === 1).length;
    assert(cancelledBeforePaint >= 6, "Test did not cancel pending paints");
    const lateUpdates = retired.filter(r => r.texture.version !== r.retired.version || digest(r.texture.image) !== r.retired.digest).length;
    assert(lateUpdates === 0, "A disposed texture/canvas was updated by a late callback");
    return { slotChanges, reopens, groups: groups.size, retiredTextures: retired.length, cancelledBeforePaint, lateUpdates,
      decodedImages: decodes.length, decodeFailures: decodes.filter(r => r.status === "rejected").length,
      svgObjectURLs: { created: svgCreated, revoked: svgRevoked, live: liveSVG.size },
      finalOutfit: "top2|bottom7|shoes4", textureVersion: texture.version, motif, base, atlas };
  } finally {
    window.LibraryScene.close(); window.Image = originalImage;
    URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL;
  }
}

export function evidence(f) {
  const { renderer, scene, character: c, body } = f;
  const sheet = document.createElement("canvas"); sheet.width = 1200; sheet.height = 550;
  sheet.id = "garment-cuff-evidence";
  const ctx = sheet.getContext("2d"); ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, 1200, 550);
  ctx.font = "16px sans-serif"; ctx.fillStyle = "#18212b";
  const time = f.durations.Idle * 18 / 128;
  f.freeze("Idle", time); f.updateSurfaces();
  const probe = f.probe(9339), outward = probe.direction.clone().negate();
  // Isolated inspection cameras only; no library/beach camera is accessed.
  const full = new T.OrthographicCamera(-.48, .48, .60, -.60, .001, 10);
  full.position.set(0, .51, 3); full.lookAt(0, .51, 0);
  renderer.render(scene, full); ctx.drawImage(renderer.domElement, 0, 35, 400, 500);
  const close = new T.OrthographicCamera(-.040, .040, .050, -.050, .001, 2);
  close.position.copy(probe.p).addScaledVector(outward, .3); close.lookAt(probe.p);
  renderer.render(scene, close); ctx.drawImage(renderer.domElement, 400, 35, 400, 500);
  // Exact cross-section through the ray and the ORIGINAL posed triangles.
  // A ray-aligned camera projects entry and skin onto the same pixel; this
  // orthogonal diagram makes their separation visible without altering any
  // mesh, clothing material, shoe visibility, or game camera.
  const horizontal = probe.direction.clone();
  const vertical = new T.Vector3(0, 1, 0).addScaledVector(horizontal, -horizontal.y).normalize();
  const planeNormal = horizontal.clone().cross(vertical).normalize();
  const project = p => {
    const d = p.clone().sub(probe.p), x = d.dot(horizontal), y = d.dot(vertical);
    return [820 + (x + .025) / .11 * 360, 70 + (.040 - y) / .085 * 430];
  };
  ctx.save(); ctx.beginPath(); ctx.rect(810, 50, 380, 470); ctx.clip();
  const section = (surface, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
    for (const ids of surface.faces) {
      const points = ids.map(i => surface.points[i]), distances = points.map(p => p.clone().sub(probe.p).dot(planeNormal)), intersections = [];
      for (let i = 0; i < 3; i++) {
        const j = (i + 1) % 3, a = distances[i], b = distances[j];
        if (Math.abs(a) < 1e-10) intersections.push(points[i]);
        if (a * b < 0) intersections.push(points[i].clone().lerp(points[j], a / (a - b)));
      }
      if (intersections.length >= 2) { ctx.moveTo(...project(intersections[0])); ctx.lineTo(...project(intersections[1])); }
    }
    ctx.stroke();
  };
  section(f.bodySurface, "#bc8252"); section(f.surface, "#235690");
  const entry = new T.Vector3().fromArray(probe.result.crossings[0].point);
  ctx.strokeStyle = "#009bbb"; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.beginPath();
  ctx.moveTo(...project(probe.p.clone().addScaledVector(horizontal, -.025)));
  ctx.lineTo(...project(probe.p.clone().addScaledVector(horizontal, .075))); ctx.stroke(); ctx.setLineDash([]);
  const mark = (point, color) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(...project(point), 4, 0, Math.PI * 2); ctx.fill(); };
  mark(probe.p, "#e02929"); mark(entry, "#009bbb");
  ctx.restore();
  ctx.fillStyle = "#18212b";
  ctx.fillText(`Idle ${time.toFixed(3)}s — unchanged jeans`, 10, 23);
  ctx.fillText("Same pose: natural cuff + existing shoe", 410, 23);
  ctx.fillText("Exact posed section: blue cloth / tan skin", 810, 23);
  ctx.font = "14px sans-serif";
  const lead = (RAY_LENGTH - probe.result.crossings[0].distance) * 1000;
  const clearance = f.surface.nearest(probe.p).distance * 1000;
  ctx.fillText(`Cyan: cuff entry ${lead.toFixed(2)} mm before red skin vertex. Nearest fabric ${clearance.toFixed(2)} mm away. No added garment surface.`, 10, 543);
  sheet.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;display:block";
  document.body.append(sheet);
  return { time, vertex: 9339, point: worldVertex(body, 9339).toArray(), classification: probe.result.kind };
}
