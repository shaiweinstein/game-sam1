/* Library footwear in the body's geometry/bind space. The upper is cut from
 * the real foot/ankle surface with its original skin weights. A foot-derived
 * perimeter joins it to a thin, closed outsole: no inset/hidden soles, torus
 * cuffs, rigid boot shafts, or skin replacement meshes.
 */
import * as T from "three";

const BASE = .010, SOLE_THICKNESS = .0042;
const smooth = (a, b, x) => { const t = T.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const STYLES = {
  shoes1: { kind: "sneaker", main: "#ff8fb8", trim: "#d9568a", sole: "#fff9ec", ease: .003, collar: .074 },
  shoes2: { kind: "boot", main: "#ffd93d", trim: "#e0b420", sole: "#e0b420", ease: .0035, collar: .140 },
  shoes3: { kind: "flat", main: "#ffc7d9", trim: "#f287ad", sole: "#f287ad", ease: .0028 },
  shoes4: { kind: "sandal", main: "#d29ce8", trim: "#a56bd6", sole: "#a56bd6", ease: .003 },
  shoes5: { kind: "bunny", main: "#fff9ec", trim: "#f287ad", sole: "#f287ad", ease: .004 },
  shoes6: { kind: "sport", main: "#4a90e2", trim: "#3273b8", sole: "#fff9ec", ease: .003, collar: .074 }
};

function weights(entries) {
  const values = [...entries].filter(([, w]) => w > 1e-9).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = values.reduce((s, [, w]) => s + w, 0);
  return new Map(values.map(([i, w]) => [i, w / sum]));
}
function mix(a, b, t) {
  const w = new Map();
  for (const [i, weight] of a.w) w.set(i, weight * (1 - t));
  for (const [i, weight] of b.w) w.set(i, (w.get(i) || 0) + weight * t);
  return { p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), w: weights(w) };
}
function clip(poly, field) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = field(a), db = field(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(mix(a, b, da / (da - db)));
  }
  return out;
}
function fan(poly, out) { for (let i = 1; i < poly.length - 1; i++) out.push([poly[0], poly[i], poly[i + 1]]); }
const key = v => v.p.toArray().map(n => Math.round(n * 1e6)).join();

function boundary(triangles) {
  const edges = new Map();
  for (const tri of triangles) for (let i = 0; i < 3; i++) {
    const a = tri[i], b = tri[(i + 1) % 3], k = [key(a), key(b)].sort().join("|");
    if (edges.has(k)) edges.get(k).count++;
    else edges.set(k, { a, b, count: 1 });
  }
  return [...edges.values()].filter(e => e.count === 1);
}

function hull(points) {
  const unique = new Map(points.map(p => [p.toArray().map(n => n.toFixed(6)).join(), p]));
  const sorted = [...unique.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const lower = [], upper = [];
  for (const p of sorted) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
function expandHull(points, padding) {
  return points.map((p, i) => {
    const before = p.clone().sub(points[(i + points.length - 1) % points.length]).normalize();
    const after = points[(i + 1) % points.length].clone().sub(p).normalize();
    const n1 = new T.Vector2(before.y, -before.x), n2 = new T.Vector2(after.y, -after.x);
    return p.clone().addScaledVector(n1.clone().add(n2), padding / (1 + n1.dot(n2)));
  });
}
function projectToHull(point, center, polygon) {
  const d = new T.Vector2(point.x - center.x, point.z - center.y);
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], e = b.clone().sub(a), q = a.clone().sub(center);
    const det = d.x * e.y - d.y * e.x;
    if (Math.abs(det) < 1e-12) continue;
    const t = (q.x * e.y - q.y * e.x) / det, u = (q.x * d.y - q.y * d.x) / det;
    if (t > 0 && u >= -1e-8 && u <= 1 + 1e-8) best = Math.min(best, t);
  }
  if (!Number.isFinite(best)) throw new Error("Foot-derived sole perimeter is not closed");
  return new T.Vector3(center.x + d.x * best, 0, center.y + d.y * best);
}

function openingHeight(style, p) {
  if (style.collar) return style.collar;
  if (style.kind === "flat") return Math.max(.036 + .024 * (1 - smooth(-.008, .030, p.z)), .038 + .048 * smooth(.060, .092, p.z));
  if (style.kind === "bunny") return Math.max(.048 + .014 * (1 - smooth(-.015, .020, p.z)), .048 + .038 * smooth(.022, .055, p.z));
  return .068; // sandal straps stop at the instep, never climb the calf
}

export function createFootwear(character, body, gradientMap) {
  const a = body.geometry.attributes, index = body.geometry.index;
  const source = Array.from({ length: a.position.count }, (_, i) => {
    const w = new Map();
    for (let k = 0; k < 4; k++) if (a.skinWeight.getComponent(i, k)) w.set(a.skinIndex.getComponent(i, k), a.skinWeight.getComponent(i, k));
    return { p: new T.Vector3().fromBufferAttribute(a.position, i), n: new T.Vector3().fromBufferAttribute(a.normal, i), w };
  });
  const anatomy = ["Left", "Right"].map((side, s) => {
    const sign = s ? -1 : 1, triangles = [];
    for (let i = 0; i < index.count; i += 3) {
      const tri = [source[index.getX(i)], source[index.getX(i + 1)], source[index.getX(i + 2)]];
      if (tri.some(v => v.p.y < .155) && tri.every(v => v.p.x * sign > 0)) triangles.push(tri);
    }
    const points = triangles.flat().filter(v => v.p.y < .070).map(v => v.p);
    const box = new T.Box3().setFromPoints(points), outline = hull(points.map(p => new T.Vector2(p.x, p.z)));
    const center = outline.reduce((s, p) => s.add(p), new T.Vector2()).multiplyScalar(1 / outline.length);
    const foot = body.skeleton.bones.findIndex(b => b.name === "mixamorig" + side + "Foot");
    const base = [];
    for (const tri of triangles) fan(clip(tri, v => v.p.y - BASE), base);
    const baseLoop = new Map();
    for (const { a, b } of boundary(base)) if (Math.abs(a.p.y - BASE) < 1e-6 && Math.abs(b.p.y - BASE) < 1e-6) {
      baseLoop.set(key(a), a); baseLoop.set(key(b), b);
    }
    if (foot < 0 || baseLoop.size < 24) throw new Error("Missing skinned foot anatomy");
    return { side, sign, foot, triangles, box, outline, center, baseLoop: [...baseLoop.values()] };
  });
  let group = null, current = null, shown = true, disposed = false, release = null;
  const resources = [], feet = [];
  const world = new T.Vector3();

  function makeMaterial(color, map = null) {
    const material = new T.MeshToonMaterial({ color, map, gradientMap, side: T.DoubleSide });
    resources.push(material); return material;
  }
  function paint(style, foot) {
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 512;
    const ctx = canvas.getContext("2d"), { box } = foot;
    ctx.fillStyle = style.main; ctx.fillRect(0, 0, 256, 512);
    const X = x => 128 + x / (box.max.x - box.min.x + .016) * 256;
    const Z = z => (z - box.min.z + .008) / (box.max.z - box.min.z + .016) * 512;
    ctx.lineCap = ctx.lineJoin = "round";
    if (style.kind === "sneaker") {
      ctx.strokeStyle = style.trim; ctx.lineWidth = 4;
      for (const z of [.030, .043, .056]) { ctx.beginPath(); ctx.moveTo(X(-.013), Z(z)); ctx.lineTo(X(.013), Z(z + .003)); ctx.stroke(); }
    } else if (style.kind === "sport") {
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 9; ctx.beginPath();
      for (const [i, x, z] of [[0, .008, .047], [1, -.007, .068], [2, .003, .068], [3, -.008, .090]])
        i ? ctx.lineTo(X(x), Z(z)) : ctx.moveTo(X(x), Z(z));
      ctx.stroke();
    } else if (style.kind === "flat") {
      ctx.strokeStyle = style.trim; ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(X(-.020), Z(.096)); ctx.quadraticCurveTo(X(0), Z(.090), X(.020), Z(.096)); ctx.stroke();
    } else if (style.kind === "sandal") {
      ctx.fillStyle = "#ffe9a8"; ctx.strokeStyle = "#e0b420"; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 7 : 16, angle = i * Math.PI / 5 - Math.PI / 2;
        const x = X(foot.sign * .014) + r * Math.cos(angle), y = Z(.083) + r * Math.sin(angle); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (style.kind === "bunny") {
      ctx.fillStyle = "#ffc9dc";
      for (const x of [-.017, .017]) { ctx.beginPath(); ctx.ellipse(X(x), Z(.111), 7, 9, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; texture.anisotropy = 4;
    resources.push(texture); return texture;
  }

  function buildFoot(foot, style) {
    const { center, side } = foot, soleTop = foot.box.min.y - .0008, soleBottom = soleTop - SOLE_THICKNESS;
    const polygon = expandHull(foot.outline, style.ease + .001);
    const rigid = new Map([[foot.foot, 1]]), triangles = [], supports = [];
    const vertex = (p, w = rigid) => ({ p, n: new T.Vector3(), w });
    const add = (vertices, material, support = false) => { triangles.push({ vertices, material }); if (support) supports.push(vertices); };
    const upper = [];
    for (const tri of foot.triangles) {
      const poly = clip(clip(tri, v => v.p.y - BASE), v => openingHeight(style, v.p) - v.p.y);
      if (style.kind === "sandal") {
        for (const [lo, hi] of [[.016, .035], [.070, .095]]) fan(clip(clip(poly, v => v.p.z - lo), v => hi - v.p.z), upper);
      } else fan(poly, upper);
    }
    const shifted = new Map();
    const offset = v => {
      const k = key(v);
      if (!shifted.has(k)) {
        const p = v.p.clone().addScaledVector(v.n, style.ease);
        if (Math.abs(v.p.y - BASE) < 1e-6) p.y = BASE;
        shifted.set(k, { ...v, p });
      }
      return shifted.get(k);
    };
    for (const tri of upper) {
      const top = tri.reduce((n, v) => n + v.n.y, 0) > 1.05;
      const cuff = style.kind === "boot" && tri.every(v => v.p.y > style.collar - .003);
      add(tri.map(offset), cuff ? 2 : top ? 0 : 3);
    }
    const edges = boundary(upper), baseEdges = edges.filter(e => Math.abs(e.a.p.y - BASE) < 1e-6 && Math.abs(e.b.p.y - BASE) < 1e-6);
    // A 1.2mm integrated lining edge follows the real cut/opening. It is not
    // a torus or a cover-up, and never closes intentional flat/sandal openings.
    for (const { a, b } of edges) if (!baseEdges.some(e => e.a === a && e.b === b)) {
      const inner = v => ({ ...v, p: v.p.clone().addScaledVector(v.n, style.ease - .0012) });
      add([offset(b), offset(a), inner(a)], 2); add([offset(b), inner(a), inner(b)], 2);
    }

    const perimeter = new Map();
    const projected = v => {
      const p = projectToHull(offset(v).p, center, polygon); p.y = soleTop;
      const k = p.toArray().map(n => Math.round(n * 1e6)).join();
      if (!perimeter.has(k)) perimeter.set(k, vertex(p));
      return perimeter.get(k);
    };
    foot.baseLoop.forEach(projected); baseEdges.forEach(e => { projected(e.a); projected(e.b); });
    const angle = v => Math.atan2(v.p.z - center.y, v.p.x - center.x);
    const ring = [...perimeter.values()].sort((a, b) => angle(a) - angle(b));
    const difference = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
    // Bridge to exactly the same perimeter used by the sole. Intermediate
    // perimeter vertices also belong to this bridge, preventing T-junctions.
    for (const { a, b } of baseEdges) {
      const start = projected(a), end = projected(b), aa = angle(start), span = difference(aa, angle(end));
      const chain = ring.map(v => ({ v, t: difference(aa, angle(v)) / span }))
        .filter(v => v.t > 1e-7 && v.t < 1 - 1e-7).sort((a, b) => a.t - b.t).map(v => v.v);
      const low = [start, ...chain, end], high = offset(a);
      // The joined lower toe/heel edge can contact a carpet step while the
      // foot rolls. It is real shoe surface, not an invisible stand-off pad.
      for (let i = 0; i + 1 < low.length; i++) add([high, low[i], low[i + 1]], 3, true);
      add([high, end, offset(b)], 3, true);
    }
    const middle = ring.map(v => vertex(new T.Vector3(v.p.x, soleBottom + .001, v.p.z)));
    const bottom = ring.map(v => {
      const p = v.p.clone(), inward = new T.Vector2(center.x - p.x, center.y - p.z).normalize();
      p.x += inward.x * .001; p.z += inward.y * .001; p.y = soleBottom; return vertex(p);
    });
    const topCenter = vertex(new T.Vector3(center.x, soleTop, center.y)), bottomCenter = vertex(new T.Vector3(center.x, soleBottom, center.y));
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      add([topCenter, ring[j], ring[i]], 4, true);
      add([bottomCenter, bottom[i], bottom[j]], 1, true);
      for (const [hi, lo] of [[ring, middle], [middle, bottom]]) {
        add([hi[i], hi[j], lo[j]], 1, true); add([hi[i], lo[j], lo[i]], 1, true);
      }
    }

    if (style.kind === "bunny") {
      // Small leaf-shaped ears seated on the actual vamp, not extra toe balls.
      const surface = upper.map(tri => tri.map(offset));
      const seat = (x, z) => {
        let best = null, height = -Infinity;
        for (const tri of surface) {
          const [a, b, c] = tri.map(v => v.p), det = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
          if (Math.abs(det) < 1e-12) continue;
          const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / det;
          const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / det, w = 1 - u - v;
          if (Math.min(u, v, w) < 0) continue;
          const y = u * a.y + v * b.y + w * c.y;
          if (y > height) { height = y; best = vertex(new T.Vector3(x, y, z), tri[0].w); }
        }
        return best;
      };
      for (const sign of [-1, 1]) {
        const root = seat(center.x + sign * .009, foot.box.max.z - .028);
        if (!root) continue;
        const leaf = [[-.003, 0], [-.006, .014], [-.004, .023], [0, .027], [.004, .023], [.006, .014], [.003, 0]];
        const front = leaf.map(([x, y]) => vertex(root.p.clone().add(new T.Vector3(x + sign * y * .15, y, .002 + y * .12)), root.w));
        const back = front.map(v => vertex(v.p.clone().add(new T.Vector3(0, 0, -.0025)), root.w));
        for (let i = 1; i + 1 < leaf.length; i++) { add([front[0], front[i], front[i + 1]], 3); add([back[0], back[i + 1], back[i]], 3); }
        for (let i = 0; i < leaf.length; i++) { const j = (i + 1) % leaf.length; add([front[i], back[i], back[j]], 3); add([front[i], back[j], front[j]], 3); }
        const inner = leaf.map(([x, y]) => vertex(root.p.clone().add(new T.Vector3(x * .52 + sign * y * .12, .003 + y * .72, .0023 + (.003 + y * .72) * .12)), root.w));
        for (let i = 1; i + 1 < leaf.length; i++) add([inner[0], inner[i], inner[i + 1]], 2);
      }
    }

    const positions = [], joints = [], skinWeights = [], uv = [], indices = [], lookup = new Map(), canonical = new Map();
    const put = v => {
      const k = key(v);
      if (!canonical.has(k)) canonical.set(k, v);
      v = canonical.get(k);
      if (!lookup.has(k)) {
        lookup.set(k, positions.length / 3); positions.push(...v.p.toArray());
        const entries = [...v.w]; for (let i = 0; i < 4; i++) { joints.push(entries[i]?.[0] || 0); skinWeights.push(entries[i]?.[1] || 0); }
        uv.push(.5 + (v.p.x - center.x) / (foot.box.max.x - foot.box.min.x + .016),
          1 - (v.p.z - foot.box.min.z + .008) / (foot.box.max.z - foot.box.min.z + .016));
      }
      return lookup.get(k);
    };
    const geometry = new T.BufferGeometry();
    for (let material = 0; material < 5; material++) {
      const start = indices.length;
      for (const tri of triangles) if (tri.material === material) indices.push(...tri.vertices.map(put));
      if (indices.length > start) geometry.addGroup(start, indices.length - start, material);
    }
    geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("skinIndex", new T.Uint16BufferAttribute(joints, 4));
    geometry.setAttribute("skinWeight", new T.Float32BufferAttribute(skinWeights, 4));
    geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
    resources.push(geometry);
    const mats = [makeMaterial(0xffffff, paint(style, foot)), makeMaterial(style.sole), makeMaterial(style.trim),
      makeMaterial(style.main), makeMaterial(style.main)];
    mats.forEach((m, i) => { m.name = ["shoe_upper", "shoe_sole", "shoe_trim", "shoe_quarter", "shoe_footbed"][i]; });
    const mesh = new T.SkinnedMesh(geometry, mats); mesh.name = "shoe_" + side;
    mesh.bindMode = body.bindMode; mesh.bind(body.skeleton, body.bindMatrix);
    mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false; mesh.raycast = () => {};
    const sideGroup = new T.Group(); sideGroup.name = "clothes_shoe_" + side; sideGroup.add(mesh); group.add(sideGroup);
    const supportFaces = supports.map(tri => tri.map(v => lookup.get(key(v))));
    const supportIndices = [...new Set(supportFaces.flat())];
    const openingEdges = edges.filter(e => !baseEdges.includes(e)).map(e =>
      [lookup.get(key(offset(e.a))), lookup.get(key(offset(e.b)))]);
    mesh.userData.footwear = { side, kind: style.kind, supportIndices, supportFaces,
      openingEdges, soleTop, soleBottom, baseY: BASE, soleThickness: SOLE_THICKNESS, collar: style.collar || null };
    feet.push({ mesh, supportIndices, supportFaces, points: new Map(supportIndices.map(i => [i, new T.Vector3()])) });
  }

  function sampleSupport(emit, ground) {
    for (const { mesh, supportIndices, supportFaces, points } of feet) {
      for (const i of supportIndices) { mesh.getVertexPosition(i, world).applyMatrix4(mesh.matrixWorld); points.get(i).copy(world); emit(world); }
      // Optional terrain discontinuities (the library's two rug rectangles).
      // Intersections are sampled on the real sole triangles, not a root-Y
      // approximation or an early step-up based on the character centre.
      if (ground.sampleTriangle) for (const face of supportFaces) ground.sampleTriangle(...face.map(i => points.get(i)), emit);
    }
  }
  function setVisible(on) {
    shown = !!on;
    if (group) group.visible = shown;
    if (!shown || !group) { release?.(); release = null; }
    else if (!release) release = character.setSoleSupportProvider?.(sampleSupport) || null;
  }
  function clear() {
    release?.(); release = null; group?.removeFromParent(); group = null; current = null;
    feet.length = 0; for (const resource of resources.splice(0)) resource.dispose();
  }
  function build(id) {
    clear(); if (disposed || id === null || id === "none") return null;
    current = Object.hasOwn(STYLES, id) ? id : "shoes1";
    group = new T.Group(); group.name = "clothes_footwear"; group.matrixAutoUpdate = false; group.matrix.copy(body.matrix); body.parent.add(group);
    for (const foot of anatomy) buildFoot(foot, STYLES[current]);
    setVisible(shown); return group;
  }
  return { build, clear, setVisible, state: () => ({ id: current, visible: shown, registered: !!release }),
    dispose() { clear(); disposed = true; } };
}
