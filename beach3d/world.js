/* ============================================================
   beach3d/world.js — the 3D beach world (B1)

   Three.js scene mirroring the 2D beach rules (js/beach-game.js)
   in meters, character ≈1.0m tall, y-up:

      x ∈ [−7, 7]   the beach strip (playable box insets it)
      z > shoreline → sand (back edge z ≈ 6.4)
      z < shoreline → sea, far edge (the styled horizon) z = −7.5
     shoreline = SHORE(x), a gentle WAVE curve ≈ z 0.12..0.58
                 (2D: wavy --sand-top waterline).

   Zones (2D zoneAtFy port): sand z > S+0.30, foam band
   z ∈ (S−0.30, S+0.30], sea z ≤ S−0.30. B2 (swim): the sea is
   playable — the old B1 shore clamp is gone; character3d clamps
   the DEEP edge instead (SEA_DEEP_Z margin short of the far
   water line). The foam band stays the wade zone.

   Camera: FIXED 3/4 high angle (not a follow cam), gentle
   wheel/pinch zoom 0.8×–1.6× — tuned via stills so the sea/sky
   boundary (the far water edge = the "horizon") reads near the
   2D --sea-top proportion.

   Everything toon: MeshToonMaterial + the spike3 gradient ramps
   (4-step general, 3-step bright suit with 0.34 emissive lift),
   sky CanvasTexture background (#bfe6ff→#e8f7ff→#fff3dd), blob
   shadows from a shared radial-gradient texture. Renderer uses
   the spike3 software-GL probe + adaptive pixel scale.
   ============================================================ */

import * as THREE from "three";

/* ---------- world constants (meters) ---------- */

export const WORLD = {
  /* shoreline curve: z = SHORE_BASE + two gentle sines in x */
  shore: { base: 0.36, ampA: 0.16, kA: 0.52, phA: 0.85, ampB: 0.07, kB: 1.13, phB: 2.3 },
  /* zone bands relative to the shoreline z at the same x (2D port) */
  zoneSandDz: 0.30,     /* sand   = dz > +0.30 */
  zoneSeaDz: 0.30,      /* sea    = dz < −0.30 (foam between)  */
  /* sand height profile across the shore band (the waterline is
     where sandY equals WATER_Y); a gentle 0.9m-wide ramp then a
     slower rise to the back of the beach, and a seabed dropoff. */
  sand: { base: 0.06, wet: 0.14, rampA: -0.30, rampB: 0.60, backRise: 0.10, backFrom: 1.2, backTo: 5.6,
          bedDrop: 0.45, bedFrom: -0.9, bedTo: -7.0, halfX: 16, backZ: 6.4 },
  /* zFar is the SEA EDGE — the styled horizon line. At the 14° camera
     pitch below it projects to ≈45% viewport height (2D --sea-top).
     xHalf is wide so the far side edges stay outside the frustum
     (no visible plane sides). */
  water: { y: 0.12, xHalf: 16, zFar: -7.5, zNear: 0.92, segX: 64, segZ: 40,
           /* toon sea blues = the 2D .beach-sea gradient hexes */
           colDeep: 0x2b93b6, colMid: 0x3cb0cf, colShallow: 0x63d1e1,
           /* B1 approved look (commit 94b64da stills): flat toon
              blue at 0.9 — the submerged swimmer still reads
              through it (B2's per-vertex alpha grading washed the
              shallows out to pale sage: sand bleed over the blue) */
           opacity: 0.9 },
  /* playable box (raycast targets + step clamps) */
  box: { xMin: -6.2, xMax: 6.2, zMin: -9.0, zMax: 5.0 },
  /* fixed camera, ~14° down-tilt (stills round 1: 30° pushed the sea
     edge to 22% and showed the plane sides; 14° puts the edge at ~45%,
     shoreline ~62%, Lily ~55–74% — the 2D strip split). */
  cam: { fov: 38, pos: [0, 3.6, 10.4], target: [0, 1.66, 2.64],
         zoomMin: 0.8, zoomMax: 1.6 },
  rest: { x: 0, z: 2.6 }      /* where she stands on open (2D parity) */
};

/* shoreline z at world x (the wavy water curve) */
export function shorelineZ(x) {
  const s = WORLD.shore;
  return s.base + s.ampA * Math.sin(s.kA * x + s.phA) + s.ampB * Math.sin(s.kB * x + s.phB);
}

/* sand/seabed surface height at (x, z) — character grounding and
   every prop plant read this, so nothing ever floats or sinks. */
export function sandY(x, z) {
  const p = WORLD.sand;
  const dz = z - shorelineZ(x);
  let y = p.base + p.wet * smoothstep01((dz - p.rampA) / (p.rampB - p.rampA));
  y += p.backRise * smoothstep01((z - p.backFrom) / (p.backTo - p.backFrom));
  y -= p.bedDrop * smoothstep01((dz - p.bedFrom) / (p.bedTo - p.bedFrom));
  return y;
}

/* "sea band fraction" 0 at the far water edge → 1 at the shoreline
   (2D's sea-band fraction, ported for the water colour gradient) */
function seaBandFrac(z) {
  return smoothstep01((z - WORLD.water.zFar) / (shorelineZ(0) - WORLD.water.zFar));
}

function smoothstep01(t) {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* zone at a world point — the 2D zoneAtFy port:
   "sand" / "foam" / "sea" from the distance to the shoreline. */
export function zoneAt(x, z) {
  const dz = z - shorelineZ(x);
  if (dz > WORLD.zoneSandDz) return "sand";
  if (dz > -WORLD.zoneSeaDz) return "foam";
  return "sea";
}

/* ---------- the shared water surface height field ----------
   Used by the water mesh, the foam lap, the swimmer waterline
   (character3d B2) and the splash VFX — one source of truth so the
   body line and every surface-riding effect always agree (2D:
   foamEdgeY is THE shared waterline). 2–3 octaves, ≤0.06 m,
   ~0.3–0.6 Hz. t is the wave clock owned by beach3d.js; under
   reduced motion the clock freezes → the surface rests at its
   frame-0 shape. Exported for B3 (boat bob) and B4 (wave ride). */
const WAVE_A = 0.030, WAVE_B = 0.022, WAVE_C = 0.014;
export function waterSurfaceY(x, z, t) {
  /* amplitude damps to 0 in the wading band so legs see calm,
     readable water over the lower legs, and again to 0 at the far
     edge (stills round 1: wave vertices notched the sea/sky line) */
  const shoreF = smoothstep01((shorelineZ(x) - z) / 1.6);
  const farF = smoothstep01((z - WORLD.water.zFar) / 2.2);
  const f = shoreF * farF;
  return WORLD.water.y
    + Math.sin(x * 0.9 + t * 1.30) * WAVE_A * f
    + Math.sin(z * 1.7 - t * 2.05 + 1.1) * WAVE_B * f
    + Math.sin((x + z) * 2.6 + t * 3.6 + 2.7) * WAVE_C * 0.6 * f;
}

/* ---------- toon materials (spike3 patterns, verbatim shapes) ---------- */

let _gradientMap = null;
function gradientMap() {
  if (_gradientMap) return _gradientMap;
  const data = new Uint8Array([
    148, 148, 148, 255,
    180, 180, 180, 255,
    218, 218, 218, 255,
    255, 255, 255, 255
  ]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  _gradientMap = t;
  return t;
}

let _gradientMapSuit = null;
function gradientMapSuit() {
  if (_gradientMapSuit) return _gradientMapSuit;
  const data = new Uint8Array([
    214, 214, 214, 255,
    238, 238, 238, 255,
    255, 255, 255, 255
  ]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  _gradientMapSuit = t;
  return t;
}

const SUIT_MAT_RE = /suit|daisy/i;

/* Rebuild every mesh material as a MeshToonMaterial exactly like
   spike3: 4-step ramp everywhere, bright 3-step + 0.34 emissive for
   /suit|daisy/i, keep the head's face texture (anisotropy ≤ 4). */
export function toonify(root, renderer, meshMap) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    const src = node.material;
    const isSuit = SUIT_MAT_RE.test(src.name || "");
    const m = new THREE.MeshToonMaterial({
      color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
      gradientMap: isSuit ? gradientMapSuit() : gradientMap()
    });
    if (isSuit) {
      m.emissive = (src.color ? src.color.clone() : new THREE.Color(0xffffff))
        .multiplyScalar(0.34);
    }
    if (src.map) {
      m.map = src.map;
      m.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    }
    node.material = m;
    if (meshMap) meshMap[node.name] = node;
  });
}

/* ---------- canvas textures ---------- */

function makeSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#bfe6ff");
  grad.addColorStop(0.55, "#e8f7ff");
  grad.addColorStop(1, "#fff3dd");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _blobTex = null;
export function blobShadowTexture() {
  if (_blobTex) return _blobTex;
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(58,46,110,0.30)");
  grad.addColorStop(1, "rgba(58,46,110,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  _blobTex = new THREE.CanvasTexture(c);
  return _blobTex;
}

/* sun disc: warm core, soft rays ring, glow falloff (2D sunMarkup
   palette #ffd93d / #ffe170 / #ffec9e) */
function makeSunTexture() {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(255,240,180,1)");
  grad.addColorStop(0.26, "rgba(255,217,61,1)");
  grad.addColorStop(0.33, "rgba(255,225,112,0.95)");
  grad.addColorStop(0.42, "rgba(255,236,158,0.35)");
  grad.addColorStop(1, "rgba(255,236,158,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* foam band: opacity gradient across the strip (u = across shore,
   v = along it) — white crest fading to nothing at both ends. */
function makeFoamTexture() {
  const w = 8, h = 64;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(255,255,255,0)");
  grad.addColorStop(0.28, "rgba(255,255,255,0.95)");
  grad.addColorStop(0.55, "rgba(210,240,251,0.85)");
  grad.addColorStop(1, "rgba(210,240,251,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  return new THREE.CanvasTexture(c);
}

/* wave-sheet crest pattern: one seamless tile of staggered toon
   smile-arcs (2D .beach-wave SVG read). Cached per sheet index so
   reopens never re-upload (texture-count stability in QA). */
const _waveSheetTex = [null, null, null];
function makeWaveSheetTexture(i) {
  if (_waveSheetTex[i]) return _waveSheetTex[i];
  const w = 128, h = 32;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.strokeStyle = "rgba(255,255,255,1)";
  g.lineWidth = 5;
  g.lineCap = "round";
  const arc = (cx, cy, r) => {
    g.beginPath();
    g.arc(cx, cy, r, Math.PI * 1.12, Math.PI * 1.88);
    g.stroke();
  };
  arc(w * 0.25, h * 0.42, 13);
  arc(w * 0.75, h * 0.42, 13);
  arc(w * 0.50, h * 0.92, 13);
  arc(0,        h * 0.92, 13);
  arc(w,        h * 0.92, 13);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  _waveSheetTex[i] = t;
  return t;
}

/* ---------- helpers ---------- */

/* Deterministic [0,1) pseudo-random — the 2D hash01 (js/beach-game.js)
   so speck placements are stable across reloads. */
function hash01(a, b) {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function mixHex(a, b, t) {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

function blobShadow(radius, opacity) {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 28),
    new THREE.MeshBasicMaterial({
      map: blobShadowTexture(), transparent: true,
      opacity: opacity == null ? 1 : opacity, depthWrite: false
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = 1;
  return m;
}

/* plant a prop group on the sand: y = surface height, shadow under
   its footprint. */
function plantProp(scene, group, x, z, shadowR, shadowOp) {
  const y = sandY(x, z);
  group.position.set(x, y, z);
  if (shadowR) {
    const sh = blobShadow(shadowR, shadowOp);
    sh.position.y = 0.006;                 /* just above the sand, local to the group */
    group.add(sh);
  }
  scene.add(group);
  return group;
}

/* ============================================================
   createWorld(hostEl) — builds renderer/scene/camera and every
   static + animated piece. Returns the frame API used by
   beach3d.js; the module owns the animation loop and input.
   ============================================================ */

export function isSoftwareGL() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                   : gl.getParameter(gl.RENDERER)) || "";
    /* lose the probe context cleanly */
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    return /swiftshader|llvmpipe|softpipe/i.test(r);
  } catch (e) { return false; }
}

export function webglSupported() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    return true;
  } catch (e) { return false; }
}

/* deep-dispose a subtree (one WebGL context per beach visit) */
function disposeNode(node) {
  node.traverse((o) => {
    if (o.isMesh || o.isSprite || o.isPoints) {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.map && m.map.isCanvasTexture !== true) m.map.dispose();
        if (m.alphaMap) m.alphaMap.dispose();
        m.dispose();
      }
    }
  });
}

export function createWorld(hostEl) {
  const SOFTWARE_GL = isSoftwareGL();
  const renderer = new THREE.WebGLRenderer({ antialias: !SOFTWARE_GL });
  renderer.setClearColor(0xbfe6ff, 1);
  hostEl.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  canvas.style.display = "block";
  canvas.style.touchAction = "none";

  const scene = new THREE.Scene();
  scene.background = makeSkyTexture();

  const camCfg = WORLD.cam;
  const camBase = new THREE.Vector3(camCfg.pos[0], camCfg.pos[1], camCfg.pos[2]);
  const camTarget = new THREE.Vector3(camCfg.target[0], camCfg.target[1], camCfg.target[2]);
  const camera = new THREE.PerspectiveCamera(camCfg.fov, 1, 0.1, 60);

  /* zoom dolly: camera moves along the (camBase−target) ray; the
     LOOK target lifts slightly with zoom so the framing stays put. */
  let zoom = 1, zoomTarget = 1;
  function applyZoom() {
    camera.position.copy(camTarget).addScaledVector(
      new THREE.Vector3().subVectors(camBase, camTarget), zoom);
    camera.lookAt(camTarget);
  }

  /* ---------- lights (spike3 pattern) ---------- */
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7);
  sun.position.set(0.9, 1.1, 3.9);
  scene.add(sun);

  /* ---------- sand (wet band + specks baked in vertex colors) ---------- */
  const sandGeo = new THREE.PlaneGeometry(
    WORLD.sand.halfX * 2, WORLD.sand.backZ - WORLD.water.zFar,
    56, 48);
  sandGeo.rotateX(-Math.PI / 2);
  sandGeo.translate(0, 0, (WORLD.sand.backZ + WORLD.water.zFar) / 2);
  {
    const pos = sandGeo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const SAND = 0xf2d9a6;                       /* spike3 toon sand */
    const WET = mixHex(SAND, 0xd9a86b, 0.55);    /* damp-sand tint   */
    const cDry = new THREE.Color(SAND), cWet = new THREE.Color(WET);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, sandY(x, z));
      const dz = z - shorelineZ(x);
      const wetF = smoothstep01((0.78 - dz) / 0.85);     /* ~1m band   */
      tmp.copy(cDry).lerp(cWet, 0.85 * wetF);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    sandGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    sandGeo.computeVertexNormals();
  }
  const sandMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: gradientMap() });
  const sandMesh = new THREE.Mesh(sandGeo, sandMat);
  scene.add(sandMesh);

  /* pebble specks — one cheap InstancedMesh of tiny squashed spheres */
  {
    const N = 26;
    const geo = new THREE.SphereGeometry(1, 6, 4);
    const mat = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradientMap() });
    const inst = new THREE.InstancedMesh(geo, mat, N);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const ptv = new THREE.Vector3();
    const cols = [0xce9642, 0xfff6e3, 0xb9a3e8, 0xd9a86b];
    for (let i = 0; i < N; i++) {
      const x = (hash01(i + 1, 17) * 2 - 1) * 6.1;
      const z = 1.1 + hash01(i + 1, 29) * 3.9;
      const r = 0.022 + 0.02 * hash01(i + 1, 43);
      ptv.set(x, sandY(x, z) + r * 0.35, z);
      sc.set(r, r * 0.55, r);
      m4.compose(ptv, q, sc);
      inst.setMatrixAt(i, m4);
      inst.setColorAt(i, new THREE.Color(cols[i % cols.length]));
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    scene.add(inst);
  }

  /* ---------- water (animated toon plane, semi-transparent) ---------- */
  const wCfg = WORLD.water;
  const waterGeo = new THREE.PlaneGeometry(wCfg.xHalf * 2, wCfg.zNear - wCfg.zFar,
    wCfg.segX, wCfg.segZ);
  waterGeo.rotateX(-Math.PI / 2);
  waterGeo.translate(0, 0, (wCfg.zNear + wCfg.zFar) / 2);
  {
    const pos = waterGeo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const cDeep = new THREE.Color(wCfg.colDeep), cMid = new THREE.Color(wCfg.colMid),
          cShal = new THREE.Color(wCfg.colShallow);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const f = seaBandFrac(z);
      if (f < 0.5) tmp.copy(cDeep).lerp(cMid, f * 2);
      else tmp.copy(cMid).lerp(cShal, (f - 0.5) * 2);
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
      pos.setY(i, 0);
    }
    waterGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  }
  const waterMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: wCfg.opacity,
    depthWrite: false
  });
  const waterMesh = new THREE.Mesh(waterGeo, waterMat);
  waterMesh.renderOrder = 2;               /* after sand, before foam */
  scene.add(waterMesh);

  /* (waterSurfaceY now lives at module scope — see the shared
     height-field block above; the mesh, foam, swimmer and splashes
     all sample it so nothing ever disagrees on where water is) */
  function updateWater(t) {
    const pos = waterGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      pos.setY(i, waterSurfaceY(x, z, t));
    }
    pos.needsUpdate = true;
    waterGeo.computeVertexNormals();
  }

  /* ---------- foam band (lapping strip along the shoreline) ---------- */
  const FOAM_COLS = 112, FOAM_ROWS = 4;
  const foamGeo = new THREE.BufferGeometry();
  {
    const verts = new Float32Array(FOAM_COLS * FOAM_ROWS * 3);
    const uvs = new Float32Array(FOAM_COLS * FOAM_ROWS * 2);
    const idx = [];
    for (let c = 0; c < FOAM_COLS; c++) {
      const u = c / (FOAM_COLS - 1);
      const x = -WORLD.sand.halfX + u * WORLD.sand.halfX * 2;
      for (let r = 0; r < FOAM_ROWS; r++) {
        const v = r / (FOAM_ROWS - 1);
        const i3 = (c * FOAM_ROWS + r) * 3;
        verts[i3] = x; verts[i3 + 1] = 0; verts[i3 + 2] = 0;
        const i2 = (c * FOAM_ROWS + r) * 2;
        uvs[i2] = v; uvs[i2 + 1] = u;   /* gradient runs across shore */
      }
    }
    for (let c = 0; c < FOAM_COLS - 1; c++) {
      for (let r = 0; r < FOAM_ROWS - 1; r++) {
        const a = c * FOAM_ROWS + r, b = a + 1,
              d = (c + 1) * FOAM_ROWS + r, e = d + 1;
        idx.push(a, b, d, b, e, d);
      }
    }
    foamGeo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    foamGeo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    foamGeo.setIndex(idx);
  }
  const foamMat = new THREE.MeshBasicMaterial({
    map: (() => { const t = makeFoamTexture(); t.colorSpace = THREE.SRGBColorSpace; return t; })(),
    transparent: true, opacity: 0.92, depthWrite: false, side: THREE.DoubleSide
  });
  /* ---------- sea wave sheets (2D .beach-wave-1/2/3 port) ----------
     Three translucent crest-pattern strips sliding across the calm
     far sea — the 2D bands sit at 10/40/66% of the sea with
     opacity .30/.40/.55 and 22s/15s/9s(rev) slide periods. Textures
     are module-cached so reopen adds zero GPU textures. */
  const SHEETS = [
    { z: -6.8, d: 0.70, repeat: 12, opacity: 0.45, slide:  0.03 },
    { z: -5.3, d: 0.90, repeat: 9,  opacity: 0.60, slide:  0.05 },
    { z: -3.4, d: 1.10, repeat: 7,  opacity: 0.70, slide: -0.07 }
  ];
  const sheetMeshes = SHEETS.map((cfg, i) => {
    const tex = makeWaveSheetTexture(i);
    tex.repeat.set(cfg.repeat, 1);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(wCfg.xHalf * 2 + 8, cfg.d),
      new THREE.MeshBasicMaterial({
        map: tex, transparent: true, opacity: cfg.opacity,
        depthWrite: false, color: 0xeaf9ff
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, wCfg.y + 0.08, cfg.z);   /* above the max swell 0.06 */
    m.renderOrder = 3;
    scene.add(m);
    return { m, cfg };
  });
  function updateWaveSheets(t) {
    for (const { m, cfg } of sheetMeshes) {
      m.material.map.offset.x = (t * cfg.slide) % 1;
    }
  }

  /* ---------- splash VFX (B2 — the shared waterline splash) ----------
     splash(x, z) drops an entry/exit splash on the water: two
     staggered expanding rings + six gravity droplets, every piece
     riding waterSurfaceY. B3 (duck hop-off) and B4 (surf entry)
     reuse THIS helper. Cost: two InstancedMeshes (+2 draw calls
     total, ever), pooled, capped at 24 live splashes (2D: max 24
     ripples, life 0.9 s). Additive white: fading the instance color
     toward black IS the alpha ramp — no per-instance transparency.
     Updated on the REAL clock: under reduced motion the shapes park
     at mid-expansion (2D drawRipples policy) but the fade stays —
     it reads as input feedback, not decoration. */
  const SPLASH_MAX = 24, SPLASH_LIFE = 0.9, RING_LIFE = 0.8;
  const RING_R = [0.62, 0.40];            /* main + staggered ring, m */
  const splashes = [];
  let splashSeed = 1;
  const ringGeo = new THREE.RingGeometry(0.82, 1.0, 28);
  ringGeo.rotateX(-Math.PI / 2);
  const splashRings = new THREE.InstancedMesh(ringGeo,
    new THREE.MeshBasicMaterial({
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide
    }), SPLASH_MAX * 2);
  splashRings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  splashRings.frustumCulled = false;
  splashRings.renderOrder = 3;
  splashRings.count = 0;
  scene.add(splashRings);
  const splashDrops = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 6, 4),
    new THREE.MeshBasicMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
    }), SPLASH_MAX * 6);
  splashDrops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  splashDrops.frustumCulled = false;
  splashDrops.renderOrder = 3;
  splashDrops.count = 0;
  scene.add(splashDrops);

  function splash(x, z) {
    const dots = [];
    for (let d = 0; d < 6; d++) {
      const a = hash01(splashSeed * 7 + d, 17);
      const b = hash01(splashSeed * 13 + d, 29);
      const c = hash01(splashSeed * 31 + d, 41);
      const ang = a * Math.PI * 2;
      const sp = 0.45 + 0.70 * b;                    /* m/s sideways */
      dots.push({
        vx: Math.cos(ang) * sp, vz: Math.sin(ang) * sp,
        vy: 1.5 + 0.9 * c,                           /* m/s up       */
        r: 0.014 + 0.016 * a                         /* m droplet    */
      });
    }
    splashSeed++;
    splashes.push({ x, z, age: 0, dots });
    if (splashes.length > SPLASH_MAX) splashes.shift();
  }

  const _spM = new THREE.Matrix4();
  const _spQ = new THREE.Quaternion();
  const _spP = new THREE.Vector3();
  const _spS = new THREE.Vector3();
  const _spC = new THREE.Color();
  function updateSplashes(dt, t, rm) {
    if (!splashes.length) return;
    for (let i = splashes.length - 1; i >= 0; i--) {
      splashes[i].age += dt;
      if (splashes[i].age >= SPLASH_LIFE) splashes.splice(i, 1);
    }
    let ri = 0, di = 0;
    for (const s of splashes) {
      const surf = waterSurfaceY(s.x, s.z, t);
      for (let k = 0; k < 2; k++) {
        const ra = s.age - 0.1 * k;
        if (ra < 0 || ra >= RING_LIFE) continue;
        const u = ra / RING_LIFE;
        const grow = rm ? 0.5 : Math.sqrt(u);        /* fast out, ease off */
        const rad = 0.12 + (RING_R[k] - 0.12) * grow;
        const alpha = (1 - u) * (1 - u) * (k === 0 ? 0.85 : 0.55);
        _spP.set(s.x, surf + 0.014, s.z);
        _spS.set(rad, rad, rad);
        _spM.compose(_spP, _spQ, _spS);
        splashRings.setMatrixAt(ri, _spM);
        _spC.setScalar(alpha);
        splashRings.setColorAt(ri, _spC);
        ri++;
      }
      for (const d of s.dots) {
        const tau = rm ? 0.16 : s.age;               /* parked arc frame */
        const arc = d.vy * tau - 3.4 * tau * tau;    /* apex ≈0.2 m     */
        if (arc <= 0.002) continue;                  /* already re-entered */
        const x = s.x + d.vx * tau, z = s.z + d.vz * tau;
        const fade = (1 - tau / 0.8) * (1 - tau / 0.8) * 0.9;
        _spP.set(x, waterSurfaceY(x, z, t) + arc, z);
        _spS.set(d.r, d.r * 1.3, d.r);
        _spM.compose(_spP, _spQ, _spS);
        splashDrops.setMatrixAt(di, _spM);
        _spC.setScalar(fade);
        splashDrops.setColorAt(di, _spC);
        di++;
      }
    }
    splashRings.count = ri;
    splashDrops.count = di;
    if (ri) {
      splashRings.instanceMatrix.needsUpdate = true;
      if (splashRings.instanceColor) splashRings.instanceColor.needsUpdate = true;
    }
    if (di) {
      splashDrops.instanceMatrix.needsUpdate = true;
      if (splashDrops.instanceColor) splashDrops.instanceColor.needsUpdate = true;
    }
  }

  function updateFoam(t) {
    const pos = foamGeo.attributes.position;
    const lap = 0.16 * Math.sin(t * 0.55);           /* slow breathe  */
    for (let c = 0; c < FOAM_COLS; c++) {
      const u = c / (FOAM_COLS - 1);
      const x = -WORLD.sand.halfX + u * WORLD.sand.halfX * 2;
      const s = shorelineZ(x);
      const lapHere = lap + 0.07 * Math.sin(x * 0.8 + t * 0.7);
      for (let r = 0; r < FOAM_ROWS; r++) {
        const v = r / (FOAM_ROWS - 1);
        /* rows: outer (in water) → inner (up the wet sand) */
        const z = s - 0.42 + v * (0.78 + lapHere);
        const i3 = (c * FOAM_ROWS + r) * 3;
        pos.setX(i3 / 3, x);
        pos.setY(i3 / 3, waterSurfaceY(x, z, t) + 0.014);
        pos.setZ(i3 / 3, z);
      }
    }
    pos.needsUpdate = true;
  }

  /* ---------- sun sprite (2D anchor: 88% across, 14% down) ---------- */
  const sunTex = makeSunTexture();
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: sunTex, transparent: true, depthWrite: false, depthTest: false
  }));
  sunSprite.renderOrder = 0;               /* behind the world: sky paint */
  scene.add(sunSprite);
  function placeSunSprite() {
    /* anchor it at (fx, fy) fractions of the VIEWPORT via NDC */
    const ndc = new THREE.Vector3(0.76, 0.72, 0.985);
    ndc.unproject(camera);
    const dir = ndc.sub(camera.position).normalize();
    sunSprite.position.copy(camera.position).addScaledVector(dir, 30);
    const h = 0.11 * (2 * camera.position.distanceTo(camTarget) *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    sunSprite.scale.set(h * 2.6, h * 2.6, 1);
  }

  /* ---------- props (2D PROPS anchors ported to world coords) ---------- */

  function buildUmbrella() {
    const g = new THREE.Group();
    const poleMat = new THREE.MeshToonMaterial({ color: 0xd99a5b, gradientMap: gradientMap() });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.85, 8), poleMat);
    pole.position.y = 0.92;
    g.add(pole);
    /* 12-slice cone, alternating pink/yellow wedges via vertex colors */
    const canopy = new THREE.ConeGeometry(1.05, 0.52, 12, 1, true);
    canopy.translate(0, 0.26, 0);
    const cn = canopy.toNonIndexed();
    const cpos = cn.attributes.position;
    const ccol = new Float32Array(cpos.count * 3);
    const pink = new THREE.Color(0xff8fb8), yel = new THREE.Color(0xffd93d);
    for (let tri = 0; tri < cpos.count / 3; tri++) {
      let sx = 0, sz = 0;
      for (let k = 0; k < 3; k++) {
        sx += cpos.getX(tri * 3 + k); sz += cpos.getZ(tri * 3 + k);
      }
      const c = Math.sin(Math.atan2(sz, sx) * 6) > 0 ? pink : yel;
      for (let k = 0; k < 3; k++) {
        ccol[(tri * 3 + k) * 3] = c.r;
        ccol[(tri * 3 + k) * 3 + 1] = c.g;
        ccol[(tri * 3 + k) * 3 + 2] = c.b;
      }
    }
    cn.setAttribute("color", new THREE.BufferAttribute(ccol, 3));
    const canopyMesh = new THREE.Mesh(cn, new THREE.MeshToonMaterial({
      vertexColors: true, gradientMap: gradientMap(), side: THREE.DoubleSide
    }));
    canopyMesh.position.y = 1.78;
    canopyMesh.rotation.z = 0.07;
    g.add(canopyMesh);
    const finial = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6),
      new THREE.MeshToonMaterial({ color: 0xfff9ec, gradientMap: gradientMap() }));
    finial.position.y = 1.88;
    g.add(finial);
    return g;
  }

  function buildBall() {
    const r = 0.26;
    const geo = new THREE.SphereGeometry(r, 18, 12).toNonIndexed();
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const cs = [new THREE.Color(0xff8fb8), new THREE.Color(0xffd93d),
                new THREE.Color(0x4fc3d9), new THREE.Color(0xff8fb8),
                new THREE.Color(0xffd93d), new THREE.Color(0x4fc3d9)];
    for (let tri = 0; tri < pos.count / 3; tri++) {
      let sx = 0, sz = 0;
      for (let k = 0; k < 3; k++) {
        sx += pos.getX(tri * 3 + k); sz += pos.getZ(tri * 3 + k);
      }
      let a = Math.atan2(sz, sx) + Math.PI;          /* 0..2π */
      const ci = Math.min(5, Math.floor(a / (Math.PI / 3)));
      const c = cs[ci];
      for (let k = 0; k < 3; k++) {
        col[(tri * 3 + k) * 3] = c.r;
        col[(tri * 3 + k) * 3 + 1] = c.g;
        col[(tri * 3 + k) * 3 + 2] = c.b;
      }
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const g = new THREE.Group();
    const ball = new THREE.Mesh(geo, new THREE.MeshToonMaterial({
      vertexColors: true, gradientMap: gradientMap()
    }));
    ball.position.y = r;
    g.add(ball);
    return g;
  }

  function buildStarfish() {
    const shape = new THREE.Shape();
    const pts = 5, rOut = 0.19, rIn = 0.085;
    for (let i = 0; i < pts * 2; i++) {
      const a = (Math.PI / pts) * i - Math.PI / 2;
      const r = i % 2 === 0 ? rOut : rIn;
      const x = r * Math.cos(a), y = r * Math.sin(a);
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    const geo = new THREE.ExtrudeGeometry(shape,
      { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.03, bevelSegments: 2 });
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({
      color: 0xffb84d, gradientMap: gradientMap()
    }));
    const g = new THREE.Group();
    g.add(m);
    g.rotation.y = 0.5;
    m.position.y = 0.02;
    return g;
  }

  function buildScallop(color, rose) {
    /* squashed hemisphere fan — clam read from a 3/4 view */
    const geo = new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    const g = new THREE.Group();
    const shell = new THREE.Mesh(geo, new THREE.MeshToonMaterial({
      color: color, gradientMap: gradientMap()
    }));
    shell.scale.set(1, 0.42, 0.86);
    g.add(shell);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 6, 14),
      new THREE.MeshToonMaterial({ color: rose, gradientMap: gradientMap() }));
    rim.rotation.x = -Math.PI / 2;
    rim.scale.set(1, 0.86, 1);
    g.add(rim);
    return g;
  }

  function buildSpiral() {
    const g = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 10),
      new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradientMap() }));
    cone.rotation.x = Math.PI / 2 - 0.35;
    cone.position.y = 0.07;
    g.add(cone);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6),
      new THREE.MeshToonMaterial({ color: 0xb9a3e8, gradientMap: gradientMap() }));
    tip.position.set(0, 0.05, -0.08);
    g.add(tip);
    return g;
  }

  /* 2D PROPS anchors (js/beach-game.js) mapped fx→x, fy→z */
  plantProp(scene, buildUmbrella(), -5.4, 1.9, 0.95, 0.9);
  plantProp(scene, buildBall(), 5.2, 3.4, 0.3, 1);
  plantProp(scene, buildStarfish(), 4.2, 1.4, 0.2, 1);
  { const s = buildScallop(0xffd1e3, 0xf26d9d); s.rotation.y = -0.4; plantProp(scene, s, -1.9, 1.7, 0.16, 1); }
  { const s = buildScallop(0xffe7c9, 0xe8963a); s.rotation.y = 2.1;  plantProp(scene, s, -0.2, 4.3, 0.15, 1); }
  { const s = buildSpiral();                     s.rotation.y = 1.2;  plantProp(scene, s, 2.6, 2.1, 0.14, 1); }

  /* ---------- resize / render ---------- */
  const basePR = Math.min(window.devicePixelRatio || 1, 2);
  let prScale = SOFTWARE_GL ? 0.8 : 1.0;
  let slowWindows = 0;

  function resize() {
    const w = hostEl.clientWidth, h = hostEl.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(basePR * prScale);
    renderer.setSize(w, h, false);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyZoom();
    placeSunSprite();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(hostEl);
  resize();

  let pickRc = null, pickPlane = null, pickHit = null;

  /* adaptive pixel scale (spike3): two slow half-second windows step
     the render scale down toward 0.5× — the software-GL safety net. */
  function noteWindow(fps) {
    if (fps > 0 && fps < 58) slowWindows++;
    else slowWindows = 0;
    if (slowWindows >= 2 && prScale > 0.5) {
      prScale = Math.max(0.5, Math.round((prScale - 0.1) * 10) / 10);
      slowWindows = 0;
      resize();
    }
  }

  function setZoom(k) {
    zoomTarget = clamp(k, camCfg.zoomMin, camCfg.zoomMax);
  }

  return {
    renderer, scene, camera, canvas,
    camTarget,
    zoom: () => zoom,
    setZoom,
    stepZoom(dt) {
      const k = 1 - Math.exp(-8 * dt);
      if (Math.abs(zoomTarget - zoom) > 1e-4) {
        zoom += (zoomTarget - zoom) * k;
        applyZoom();
        placeSunSprite();
      }
    },
    /* frame pass; under reduced motion the caller simply never
       advances t (world stays on its resting frame). dt is the REAL
       frame delta — the splash VFX fade lives on it even when the
       wave clock is parked (2D RM policy). */
    animate(t, dt, rm) {
      updateWater(t);
      updateFoam(t);
      updateWaveSheets(t);
      updateSplashes(dt || 0, t, !!rm);
    },
    /* waterline splash helper — B2 swim entry/exit; B3/B4 reuse */
    splash,
    splashCount: () => splashes.length,
    render() { renderer.render(scene, camera); },
    resize, noteWindow,
    dispose() {
      ro.disconnect();
      disposeNode(scene);
      if (scene.background) scene.background.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
    /* QA: project a world point to PAGE CSS px (screenshot clips) */
    project(x, y, z) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      const r = canvas.getBoundingClientRect();
      return {
        x: r.left + (v.x * 0.5 + 0.5) * r.width,
        y: r.top + (1 - (v.y * 0.5 + 0.5)) * r.height,
        behind: v.z > 1
      };
    },
    /* pointer raycast → playable ground point (y = water/sand line) */
    pickGround(ndcX, ndcY) {
      if (!pickRc) {
        pickRc = new THREE.Raycaster();
        pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WORLD.water.y);
        pickHit = new THREE.Vector3();
      }
      pickRc.setFromCamera({ x: ndcX, y: ndcY }, camera);
      if (!pickRc.ray.intersectPlane(pickPlane, pickHit)) return null;
      const b = WORLD.box;
      return {
        x: clamp(pickHit.x, b.xMin, b.xMax),
        z: clamp(pickHit.z, b.zMin, b.zMax)
      };
    },
    stats() {
      return {
        calls: renderer.info.render.calls,
        tris: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        prScale
      };
    }
  };
}
