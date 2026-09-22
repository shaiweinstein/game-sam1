/* Library garments, in the GLB's mesh/bind space (metres, Y up, +Z front).
 * Tops retain the body's welded shoulder topology and exact skin weights.
 * Trousers extend the existing connected swimsuit-shorts/gusset topology,
 * not separate leg tubes. Dresses join the bodice's actual boundary loop.
 * The only body change is a reversible index mask at covered crease seams;
 * original positions/weights, skeleton, clips, hair and extras stay intact.
 */
import * as THREE from "three";

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TOPS = {
  top1: { hem: .392, sleeve: .495, ease: .0045 },
  top2: { hem: .393, sleeveless: true, ease: .0045, dress: true },
  top3: { hem: .373, sleeve: .401, ease: .0065 },
  top4: { hem: .392, sleeve: .495, ease: .0045 },
  top5: { hem: .380, sleeve: .495, ease: .005 },
  top6: { hem: .392, sleeve: .495, ease: .0045 },
  top7: { hem: .373, sleeve: .401, ease: .007, hood: true },
  top8: { hem: .392, sleeve: .495, ease: .0045 }
};
const BOTTOMS = {
  bottom1: { hem: .190, radius: .143, artHem: 276 },
  bottom2: { hem: .182, radius: .151, artHem: 281 },
  bottom3: { hem: .180, pants: true, artHem: 284 },
  bottom4: { hem: .182, radius: .176, artHem: 284, folds: .007 },
  bottom5: { hem: .185, radius: .147, artHem: 280, folds: .002 },
  bottom6: { hem: .180, radius: .151, artHem: 282, folds: .002 },
  bottom7: { hem: .058, pants: true, artHem: 298 },
  bottom8: { hem: .172, radius: .165, artHem: 286, folds: .004 }
};
const DRESS = { hem: .177, radius: .157, artHem: 285, folds: .002 };

// The authored leg profile in build_lily4.py, before subdivision. Radius is
// given a small clothing allowance, not the old cylindrical sleeve/leg ease.
const LEG = [
  [.278, .0560, -.0070, .0485], [.252, .0566, -.0035, .0474],
  [.222, .0571, -.0005, .0455], [.192, .0578, .0030, .0425],
  [.165, .0584, .0050, .0401], [.154, .0586, .0045, .0400],
  [.142, .0588, .0040, .0396], [.130, .0590, .0020, .0400],
  [.118, .0592, .0000, .0404], [.092, .0597, -.0030, .0358],
  [.068, .0601, -.0040, .0284], [.058, .0605, -.0020, .0270]
];
function legAt(y) {
  y = clamp(y, LEG[LEG.length - 1][0], LEG[0][0]);
  for (let j = 0; j < LEG.length - 1; j++) {
    const a = LEG[j], b = LEG[j + 1];
    if (y <= a[0] && y >= b[0]) {
      const t = (a[0] - y) / (a[0] - b[0]);
      return a.map((n, k) => THREE.MathUtils.lerp(n, b[k], t));
    }
  }
  return LEG[0];
}
function normalizedWeights(entries) {
  const weights = [...entries].filter(([, w]) => w > 1e-8).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = weights.reduce((n, [, w]) => n + w, 0);
  return new Map(weights.map(([i, w]) => [i, w / sum]));
}
function interpolate(a, b, t) {
  const weights = new Map();
  for (const [i, w] of a.w) weights.set(i, w * (1 - t));
  for (const [i, w] of b.w) weights.set(i, (weights.get(i) || 0) + w * t);
  return { p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), w: normalizedWeights(weights) };
}
function clip(poly, field) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = field(a), db = field(b);
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) out.push(interpolate(a, b, da / (da - db)));
  }
  return out;
}
function readVertices(mesh) {
  const a = mesh.geometry.attributes;
  return Array.from({ length: a.position.count }, (_, i) => {
    const weights = new Map();
    for (let k = 0; k < 4; k++) {
      const w = a.skinWeight.getComponent(i, k);
      if (w) weights.set(a.skinIndex.getComponent(i, k), w);
    }
    return { p: new THREE.Vector3().fromBufferAttribute(a.position, i),
      n: new THREE.Vector3().fromBufferAttribute(a.normal, i), w: weights };
  });
}
function triangles(mesh, vertices) {
  const idx = mesh.geometry.index, out = [];
  for (let i = 0; i < idx.count; i += 3) out.push([vertices[idx.getX(i)], vertices[idx.getX(i + 1)], vertices[idx.getX(i + 2)]]);
  return out;
}
function triangulate(poly, out) {
  for (let i = 1; i < poly.length - 1; i++) out.push([poly[0], poly[i], poly[i + 1]]);
}
function subdivide(tri, depth, out) {
  if (!depth) { out.push(tri); return; }
  const [a, b, c] = tri, ab = interpolate(a, b, .5), bc = interpolate(b, c, .5), ca = interpolate(c, a, .5);
  for (const t of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) subdivide(t, depth - 1, out);
}

export function createGarments(body, gradientMap) {
  const originalBodyGeometry = body.geometry;
  const skeleton = body.skeleton, names = skeleton.bones.map(b => b.name);
  const bone = name => names.indexOf("mixamorig" + name);
  const armWeight = v => [...v.w].reduce((sum, [i, w]) => sum + (/Arm|Hand/.test(names[i]) ? w : 0), 0);
  const vertices = readVertices(body), bodyTriangles = triangles(body, vertices);
  const skinBands = new Map();
  for (const tri of bodyTriangles) {
    const lo = Math.min(...tri.map(v => v.p.y)), hi = Math.max(...tri.map(v => v.p.y));
    if (lo > .425 || hi < .030 || tri.some(v => armWeight(v) > .01)) continue;
    const sample = { vertices: tri, triangle: new THREE.Triangle(...tri.map(v => v.p)),
      bounds: new THREE.Box3().setFromPoints(tri.map(v => v.p)) };
    for (let row = Math.floor(lo / .01) - 2; row <= Math.floor(hi / .01) + 2; row++) {
      if (!skinBands.has(row)) skinBands.set(row, []);
      skinBands.get(row).push(sample);
    }
  }
  const candidates = [], seeds = [];
  body.parent.parent.traverse(o => {
    if (!o.isSkinnedMesh || !/^suitTank(Bottom|Trim)$/.test(o.material.name)) return;
    const tris = triangles(o, readVertices(o));
    if (o.material.name === "suitTankBottom") for (let i = 0; i < tris.length; i++) seeds.push(candidates.length + i);
    candidates.push(...tris);
  });
  // glTF groups by material, not by garment: TankTrim also contains the
  // vest's neckline/hem. Follow welded adjacency from the shorts themselves
  // so no detached vest trim sneaks into the trouser template.
  const vertexKey = v => v.p.toArray().map(n => n.toFixed(6)).join();
  const adjacency = new Map();
  candidates.forEach((tri, i) => tri.forEach(v => {
    const key = vertexKey(v);
    if (!adjacency.has(key)) adjacency.set(key, []);
    adjacency.get(key).push(i);
  }));
  const selected = new Set(seeds), queue = [...seeds];
  for (let j = 0; j < queue.length; j++) for (const v of candidates[queue[j]]) {
    for (const i of adjacency.get(vertexKey(v))) if (!selected.has(i)) { selected.add(i); queue.push(i); }
  }
  const shorts = [...selected].map(i => candidates[i]);
  let group = null, disposed = false;
  let maskedBodyGeometry = null;
  const resources = [], pendingImages = new Set();
  const pantsTemplates = new Map();

  const closest = new THREE.Vector3(), bary = new THREE.Vector3(), nearestPoint = new THREE.Vector3();
  function bodyWeights(p) {
    // Barycentric transfer from a real skin triangle, including the pelvis.
    // A nearest-vertex field misses triangle interiors and biases the inner
    // thigh toward Hips. Constrain the leg side and exclude arms/hands.
    let nearest = null, distance = Infinity;
    for (const sample of skinBands.get(Math.floor(p.y / .01)) || []) {
      if (p.y < .240 && sample.vertices.every(v => v.p.x * p.x < 0)) continue;
      sample.bounds.clampPoint(p, closest);
      if (closest.distanceToSquared(p) > distance) continue;
      sample.triangle.closestPointToPoint(p, closest);
      const d = closest.distanceToSquared(p);
      if (d < distance) { distance = d; nearest = sample; nearestPoint.copy(closest); }
    }
    nearest.triangle.getBarycoord(nearestPoint, bary);
    const weights = new Map();
    nearest.vertices.forEach((v, j) => {
      for (const [i, w] of v.w) weights.set(i, (weights.get(i) || 0) + w * bary.getComponent(j));
    });
    return normalizedWeights(weights);
  }
  function shirtWeights(p) {
    const spine = clamp((p.y - .36) / .14, 0, 1);
    return normalizedWeights(new Map([[bone("Hips"), 1 - spine], [bone("Spine"), spine]]));
  }
  function skirtWeights(p, angle) {
    const t = .88 * (1 - smooth(.190, .345, p.y));
    const left = .5 + .5 * Math.sin(angle);
    return normalizedWeights(new Map([[bone("Hips"), 1 - t],
      [bone("LeftUpLeg"), t * left], [bone("RightUpLeg"), t * (1 - left)]]));
  }

  function topTemplate(style) {
    const out = [];
    const hemField = v => v.p.y - THREE.MathUtils.lerp(style.hem, style.sleeve || style.hem, smooth(.30, .75, armWeight(v)));
    const neckField = v => .579 - .014 * Math.max(0, v.p.z / .075) + .007 * Math.min(1, Math.abs(v.p.x) / .10) - v.p.y;
    for (const tri of bodyTriangles) {
      let poly = clip(clip(tri, hemField), neckField);
      if (style.sleeveless) poly = clip(poly, v => .38 - armWeight(v));
      if (poly.length < 3) continue;
      poly = poly.map(v => {
        const ease = style.ease + .004 * (1 - smooth(.395, .440, v.p.y)) * (1 - armWeight(v));
        const hood = style.hood ? .022 * Math.exp(-(((v.p.y - .550) / .030) ** 2)) * smooth(.015, .060, -v.p.z) : 0;
        const p = v.p.clone().addScaledVector(v.n, ease + hood);
        // A planar hem is also the dress's shared, welded skirt boundary.
        if (Math.abs(v.p.y - style.hem) < 1e-6) p.y = style.hem;
        return { ...v, p };
      });
      triangulate(poly, out);
    }
    return out;
  }

  function maskCoveredCreases(style, bottomStyle) {
    // The source body's concave axilla folds into itself during the walk.
    // Its fitted shell follows that fold; only the strictly covered internal
    // shoulder seam is culled. Full trousers also cover the medial thigh crease,
    // whose Hips-heavy skin can fold through the connected gusset. Limit that
    // mask to a narrow inner-thigh strip far above the ankle. Shorts retain
    // all leg triangles: a rest-Y cut cannot describe their moving opening.
    // Keep the rest of both legs, every calf, hand and opening untouched.
    // Retain vertex numbering for the character's cached sole supports.
    if (style.sleeveless) return;
    const kept = [], source = originalBodyGeometry.index;
    let axilla = 0, inseam = 0;
    const coveredAxilla = v => {
      const arm = armWeight(v), p = v.p;
      const hem = THREE.MathUtils.lerp(style.hem, style.sleeve || style.hem, smooth(.30, .75, arm));
      // Include the torso side of the crease too: it is Spine-weighted,
      // even though it borders the same armpit as the Arm-weighted side.
      return p.y > .480 && p.y < .535 && Math.abs(p.x) > .090 && Math.abs(p.x) < .136 &&
        p.y > hem + .002;
    };
    const coveredInseam = v => bottomStyle.pants && bottomStyle.hem < .10 && v.p.y > .165 &&
      v.p.y < .265 && Math.abs(v.p.x) < .032;
    for (let i = 0; i < source.count; i += 3) {
      const ids = [source.getX(i), source.getX(i + 1), source.getX(i + 2)];
      if (ids.every(id => coveredAxilla(vertices[id]))) axilla++;
      else if (ids.every(id => coveredInseam(vertices[id]))) inseam++;
      else kept.push(...ids);
    }
    const removed = axilla + inseam;
    if (!removed) return;
    maskedBodyGeometry = originalBodyGeometry.clone();
    maskedBodyGeometry.setIndex(kept);
    maskedBodyGeometry.userData = { ...originalBodyGeometry.userData,
      libraryMask: { region: "covered crease seams only", removedTriangles: removed, axilla, inseam } };
    body.geometry = maskedBodyGeometry;
    body.boundingBox = body.boundingSphere = null;
  }

  function skirtTemplate(style, top = null) {
    const out = top || [], waist = top ? TOPS.top2.hem : .401;
    let prev = [];
    if (top) {
      const boundary = new Map();
      for (const tri of top) for (const v of tri) {
        if (Math.abs(v.p.y - waist) < 1e-6) boundary.set(v.p.toArray().map(n => n.toFixed(6)).join(), v);
      }
      prev = [...boundary.values()].sort((a, b) => Math.atan2(a.p.x, a.p.z + .004) - Math.atan2(b.p.x, b.p.z + .004));
    } else {
      for (let i = 0; i < 64; i++) {
        const a = i * Math.PI * 2 / 64;
        const p = new THREE.Vector3(.104 * Math.sin(a), waist, -.004 + .079 * Math.cos(a));
        prev.push({ p, n: new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), w: shirtWeights(p) });
      }
    }
    const angles = prev.map(v => Math.atan2(v.p.x, v.p.z + .004));
    const levels = 26;
    for (let j = 1; j <= levels; j++) {
      const t = j / levels, y = THREE.MathUtils.lerp(waist, style.hem, t);
      const radius = y > .305 ? THREE.MathUtils.lerp(.104, .121, (waist - y) / (waist - .305)) :
        THREE.MathUtils.lerp(.121, style.radius, (.305 - y) / (.305 - style.hem));
      const row = angles.map(a => {
        const fold = (style.folds || 0) * smooth(.1, 1, t) * Math.cos(a * 12);
        const p = new THREE.Vector3((radius + fold) * Math.sin(a), y,
          -.004 + (radius * .76 + fold) * Math.cos(a));
        return { p, n: new THREE.Vector3(Math.sin(a), .2, Math.cos(a)).normalize(),
          w: y > .345 ? shirtWeights(p) : skirtWeights(p, a) };
      });
      for (let i = 0; i < row.length; i++) {
        const k = (i + 1) % row.length;
        out.push([prev[i], row[i], row[k]], [prev[i], row[k], prev[k]]);
      }
      prev = row;
    }
    return out;
  }

  function pantsTemplate(style) {
    if (pantsTemplates.has(style.hem)) return pantsTemplates.get(style.hem);
    const dense = [];
    for (const tri of shorts) {
      const clipped = []; triangulate(clip(tri, v => .401 - v.p.y), clipped);
      // Uniform refinement keeps shared edges conforming (no T-junction
      // between a dense knee and an unsubdivided pelvis).
      for (const t of clipped) subdivide(t, 1, dense);
    }
    const cache = new Map();
    function extend(v) {
      if (cache.has(v)) return cache.get(v);
      const p = v.p.clone();
      if (p.y < .240) {
        const oldY = p.y, newY = .240 - (.240 - oldY) * (.240 - style.hem) / (.240 - .197);
        const old = legAt(oldY), next = legAt(newY), side = p.x >= 0 ? 1 : -1;
        const scale = (next[3] + .0065) / (old[3] + .008);
        p.x = side * next[1] + (p.x - side * old[1]) * scale;
        p.z = next[2] + (p.z - old[2]) * scale;
        p.y = newY;
      }
      const w = bodyWeights(p);
      // A continuous 2mm fit allowance covers the body's curved triangle
      // interiors as well as its sampled vertices. Keep the waist fixed and
      // carry the underlying weights with this offset (don't re-sample the
      // inflated inner thigh and accidentally increase its Hips influence).
      const blend = 1 - smooth(.220, .270, p.y), leg = legAt(p.y);
      const center = new THREE.Vector3(Math.sign(p.x) * leg[1] * blend, p.y,
        THREE.MathUtils.lerp(-.004, leg[2], blend));
      const outward = p.clone().sub(center); outward.y = 0;
      p.addScaledVector(outward.normalize(), .002 * (1 - smooth(.385, .401, p.y)));
      const result = { p, n: v.n, w };
      cache.set(v, result); return result;
    }
    const template = dense.map(tri => tri.map(extend));
    pantsTemplates.set(style.hem, template);
    return template;
  }

  function paint(slot, id, main, trim) {
    const canvas = document.createElement("canvas"); canvas.width = 1024; canvas.height = 1024;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = main; ctx.fillRect(0, 0, 1024, 1024);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4; resources.push(texture);
    // The catalog's actual local SVG art is paint, not floating geometry.
    const markup = window.CharacterRenderer?.catalog?.[slot]?.[id]?.front || "";
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="1024" viewBox="70 150 160 170" preserveAspectRatio="none">${markup}</svg>`;
    // Self-contained data avoids revoking a blob URL before the browser has
    // consumed it during synchronous outfit changes or scene teardown.
    const image = new Image();
    const pending = { image, cancelled: false }; pendingImages.add(pending);
    const ready = new Promise(resolve => {
      const finish = () => {
        image.onload = image.onerror = null;
        pendingImages.delete(pending); resolve();
      };
      image.onload = () => {
        if (!pending.cancelled) {
          ctx.drawImage(image, 0, 0, 512, 1024);
          // Rear stripes/plaid continue around the surface; front motifs stay front.
          if (["top4", "top5", "bottom2", "bottom5", "bottom6"].includes(id)) ctx.drawImage(image, 512, 0, 512, 1024);
          // Reserved texels for sleeve cloth/cuff paint. The 2D catalog's
          // drawn arm outlines must not be projected as loops onto 3D arms.
          ctx.fillStyle = main; ctx.fillRect(0, 0, 24, 24);
          ctx.fillStyle = trim; ctx.fillRect(0, 1000, 24, 24);
          texture.needsUpdate = true;
        }
        finish();
      };
      image.onerror = finish;
      pending.finish = finish;
    });
    image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    const material = new THREE.MeshToonMaterial({ color: 0xffffff, map: texture, side: THREE.DoubleSide, gradientMap });
    resources.push(material);
    return { material, ready };
  }

  function addMesh(tris, id, slot, style, colors) {
    const positions = [], normals = [], weights = [], joints = [], uv = [], indices = [], lookup = new Map();
    const welded = new Map();
    const canonical = v => {
      const key = v.p.toArray().map(n => Math.round(n * 1e6)).join();
      if (!welded.has(key)) welded.set(key, v);
      return welded.get(key);
    };
    const dress = !!style.dress;
    const artY = p => {
      if (slot === "top" && (!dress || p.y >= .393)) {
        return 162 + (.578 - p.y) / (.578 - style.hem) * (dress ? 54 : style.hem < .39 ? 82 : 70);
      }
      const waist = dress ? .393 : .401, hem = dress ? DRESS.hem : style.hem;
      return (dress ? 216 : 232) + (waist - p.y) / (waist - hem) * ((dress ? DRESS.artHem : style.artHem) - (dress ? 216 : 232));
    };
    for (const tri of tris) {
      const front = tri.reduce((n, v) => n + v.p.z, 0) / 3 >= -.004;
      const sleeve = slot === "top" && !dress && tri.reduce((n, v) => n + armWeight(v), 0) / 3 > .35;
      for (const source of tri) {
        // UV/material seams may duplicate vertices, but their positions AND
        // weights must be bit-identical. Otherwise independently clipped /
        // interpolated edges can leave raster cracks when the bones bend.
        const v = canonical(source);
        const u = sleeve ? .01 : (clamp((150 + v.p.x * 333.333 - 70) / 160, 0, 1) + (front ? 0 : 1)) * .5;
        const vv = sleeve ? (Math.abs(v.p.y - style.sleeve) < .004 && armWeight(v) > .75 ? .01 : .99) : clamp(1 - (artY(v.p) - 150) / 170, 0, 1);
        const key = [...v.p.toArray(), u, vv, ...[...v.w].flat()].map(n => n.toFixed(7)).join();
        if (!lookup.has(key)) {
          lookup.set(key, positions.length / 3); positions.push(...v.p.toArray()); normals.push(...v.n.toArray()); uv.push(u, vv);
          const w = [...v.w]; for (let k = 0; k < 4; k++) { joints.push(w[k]?.[0] || 0); weights.push(w[k]?.[1] || 0); }
        }
        indices.push(lookup.get(key));
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(joints, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
    geometry.setIndex(indices);
    if (style.pants || slot === "bottom") geometry.computeVertexNormals();
    resources.push(geometry);
    const { material, ready } = paint(slot, id, colors.main, colors.trim);
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.name = "clothes_" + (dress ? "dress" : slot === "top" ? "top" : style.pants ? "pants" : "skirt");
    mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false;
    mesh.bindMode = body.bindMode;
    // An explicit bind matrix is essential: bind(skeleton) recalculates the
    // shared inverse binds and corrupts both the body and other garments.
    mesh.bind(skeleton, body.bindMatrix);
    mesh.raycast = () => {}; // clothing must not intercept library floor taps
    group.add(mesh);
    return ready;
  }

  function clear() {
    if (maskedBodyGeometry) {
      body.geometry = originalBodyGeometry;
      body.boundingBox = body.boundingSphere = null;
      maskedBodyGeometry.dispose(); maskedBodyGeometry = null;
    }
    if (group) { group.removeFromParent(); group = null; }
    for (const pending of pendingImages) {
      pending.cancelled = true; pending.finish();
    }
    for (const resource of resources.splice(0)) resource.dispose();
  }
  function build(outfit, colorFor) {
    clear(); if (disposed) return null;
    const top = Object.hasOwn(TOPS, outfit.top) ? outfit.top : "top1";
    const bottom = Object.hasOwn(BOTTOMS, outfit.bottom) ? outfit.bottom : "bottom1";
    const style = TOPS[top], bottomStyle = BOTTOMS[bottom];
    group = new THREE.Group(); group.name = "clothes_garments";
    group.matrixAutoUpdate = false; group.matrix.copy(body.matrix);
    body.parent.add(group);
    const topTris = topTemplate(style);
    if (style.dress) skirtTemplate(DRESS, topTris);
    const ready = [addMesh(topTris, top, "top", style, colorFor("top", top))];
    if (!style.dress) ready.push(addMesh(bottomStyle.pants ? pantsTemplate(bottomStyle) : skirtTemplate(bottomStyle),
      bottom, "bottom", bottomStyle, colorFor("bottom", bottom)));
    maskCoveredCreases(style, bottomStyle);
    group.userData.ready = Promise.all(ready);
    return group;
  }
  return { build, clear,
    setVisible(on) {
      body.geometry = on && maskedBodyGeometry ? maskedBodyGeometry : originalBodyGeometry;
      body.boundingBox = body.boundingSphere = null;
    },
    dispose() { clear(); pantsTemplates.clear(); disposed = true; } };
}
