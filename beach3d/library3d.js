/* ============================================================
   beach3d/library3d.js — 3D library scene entry (Library tasks
   1–4: room + skeleton, dress-up clothes, navigate like the beach,
   cozy room shell; task 5: the furniture pass — merged bookshelves
   + spine-atlas books, reading table + stools, pendants, reading
   nook, spinning globe, wall decor, furniture collisions; task 6:
   polish — per-piece solids meshes + camera-line occluder fade,
   stuck-target bail, lower pendants)

   ES module loaded next to beach3d.js via the same import map
   ("three" / "three/addons/" → vendored lib/three/, offline, no
   build step, no CDN, no network fetches beyond same-origin
   assets).

   Public surface mirrors window.Beach3D's open/close contract:

     window.LibraryScene = {
       open(stageEl) -> bool,   close(), isOpen(),
       supported() -> bool,     reducedMotion() -> bool
     }

   open() returns false when WebGL is missing or the scene cannot
   boot — js/map.js then shows a friendly talk-bubble line instead
   of a dead overlay. On success open() itself reveals the overlay
   (drops .hidden from #library-stage, same hidden-utility the
   beach scene uses) and focuses #library-close, so the click/
   Escape wiring can simply call close().

     Navigation:
    - warm wooden-floor room, walls, baseboard, soft warm light (task 1)
    - a requestAnimationFrame render loop (was static frames): advances
      character3d's per-frame update(dt, tNow) so her walk mixer + the
      2D stepLocomotion port finally run; guarded on `opened && !hidden`
    - floor navigation: tap/click (and optional drag-to-steer) raycasts
      the flat floor at y=0 → the character's existing setTarget path,
      clamped to a walkable rect inset from the walls; the 2D snap-stop
      halts her cleanly on arrival
     - an elevated overview from the OPEN front; fixed height, depth and
       view direction, with bounded sideways tracking only as needed
    - Back / Escape close and now also cancel the loop + drop listeners

    Task 3 does NOT change the beach path. The only additions to
    character3d.js are optional movement.groundY / movement.zoneAt
    overrides (default = exact beach sandY/zoneAt); the library passes
     room/rug heights and a sand zone so she grounds on the visible floor
     and never reads the beach sea zone and starts a swim.

    Test hook: window.__library3d (see bottom) for Playwright — now
    includes screenPointFor(x,z) so QA can turn a world floor point into
    a canvas pixel and drive a real mouse click.
    ============================================================ */

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { webglSupported, isSoftwareGL } from "./world.js";
import { createCharacter } from "./character3d.js";
import { createClothes } from "./clothes3d.js";

/* ---------- cached prefers-reduced-motion (beach3d.js pattern) ----- */
let rmMatches = false;
try {
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  rmMatches = !!mql.matches;
  const onChange = () => { rmMatches = !!mql.matches; };
  if (typeof mql.addEventListener === "function") mql.addEventListener("change", onChange);
  else if (typeof mql.addListener === "function") mql.addListener(onChange);
} catch (e) { rmMatches = false; }
function reducedMotion() { return rmMatches; }

let scene = null;
let camera = null;
let renderer = null;
let character = null;
let clothes = null;
let hostEl = null;
let resizeObserver = null;
let unsubscribeAppearance = null;
let opened = false;
let renderScheduled = false;
let supportChecked = false;
let supportedFlag = false;
/* frame loop + input + overview-camera state */
let loopId = null;
let lastT = 0;
let unwireInput = null;
let charReady = false;
/* task 5: furniture — spinning globe mesh + collision discs (beach format:
   {id, x, z, radius} circles, exactly what collision3d.moveAroundProps
   sweeps against via character3d's movement.obstacles()) */
let globe = null;
let libObstacles = [];
/* task 6: per-piece occluder meshes (rebuilt every visit by buildFurniture)
   + stuck-target bail state; see updateOccluderFade / updateStuck below */
let occluders = [];
let stuckT = 0, stuckAX = null, stuckAZ = 0;
/* QA camPose (Playwright): while a pose is active the rAF loop KEEPS
   animating (character update, globe spin, occluder fade, render) but the
   follow-camera step is skipped — camera.position is placed on an orbit
   around her live loco anchor instead. Nothing else reads these vars. */
let camPose = null;          /* {azimuth, elevation, dist, lookY} | null */
let camGlide = 0;            /* seconds of softened follow damping left */
const _poseLook = new THREE.Vector3();

function supported() {
  if (!supportChecked) {
    supportChecked = true;
    supportedFlag = webglSupported();
  }
  return supportedFlag;
}

/* ---------- procedural 📚 sign — canvas texture, zero assets ------- */

function emojiSignTexture(emoji) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);
  let font = "200px serif";
  try {
    ctx.font = font;
    const m = ctx.measureText(emoji);
    const w = m.width || 200;
    const h = (m.actualBoundingBoxAscent || 150) + (m.actualBoundingBoxDescent || 50);
    const fit = Math.max(0.3, Math.min(1, 216 / Math.max(w, h)));
    if (fit < 1) {
      font = Math.round(200 * fit) + "px serif";
      ctx.font = font;
    }
  } catch (e) { /* keep the plain font */ }
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  /* stroke UNDER the fill (strokeText after fillText would cover it):
     a dark outline so the sign reads against any wall colour */
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(6, Math.round(parseFloat(font) * 0.06));
  ctx.strokeStyle = "rgba(46, 26, 14, 0.95)";
  ctx.strokeText(emoji, 128, 138);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(emoji, 128, 138);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- procedural window "sky" — ONE shared canvas gradient ----
   Same pattern as emojiSignTexture / world.js makeSkyTexture: a tiny
   8×128 vertical gradient, unlit MeshBasicMaterial → the panes glow
   gently regardless of the interior lights (the "sunlit" cue, zero
   shadow cost). Both windows share this one texture + material. */

function windowSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 8; c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "#cfe3f0");    /* pale warm blue up top  */
  grad.addColorStop(0.62, "#eeece0"); /* haze middle            */
  grad.addColorStop(1, "#fff1d6");    /* cream near the sill    */
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- room ---------------------------------------------------- */

const WOOD = 0x8a5a33;          /* warm oak floor   */
const BASEBOARD = 0x54341d;     /* darker trim      */
const WALL_WARM = 0xd7b488;     /* sunlit wall      */
const WALL_SHADE = 0xb08c60;    /* side walls       */
const CEILING_TONE = 0xc9ab80;  /* warm dim ceiling — reads deeper than the
                                   walls so the lamps (task 5) pool light on it */
const WAINSCOT = 0x8a5f38;      /* wood-panel band along every wall */
const PILASTER = 0xe0c395;      /* pale trim pilasters + rail moulding */
const TRIM = 0xf2e3c8;          /* window frames, mullions and sills  */
const RUG = 0x7fb0a2;           /* muted teal central rug             */
const RUG_BORDER = 0x5d8c80;    /* darker border ring under the rug   */
const LAMP_WARM = 0xffd9a0;     /* key light + lamp pool colour       */

const ROOM = { w: 16, d: 14, h: 6, backZ: -6, sideX: 8 };
const RUG_LAYERS = [
  { w: 7.2, d: 5.2, y: .006, color: RUG_BORDER, name: "library_rug_border" },
  { w: 6.4, d: 4.4, y: .012, color: RUG, name: "library_rug_inner" }
];
const RUG_Z = -.8, GROUND_EPSILON = 1e-9;

// The visible planes and contact field share dimensions/heights. Pointer
// picking still uses the original mathematical floor plane; no camera changes.
export function libraryGroundY(x, z) {
  let height = 0;
  for (const layer of RUG_LAYERS) if (Math.abs(x) <= layer.w / 2 + GROUND_EPSILON &&
    Math.abs(z - RUG_Z) <= layer.d / 2 + GROUND_EPSILON) height = layer.y;
  return height;
}

// Sample height discontinuities on the actual world-space support surface.
// Vertex-only tests can miss a rug corner lying inside a sole triangle.
libraryGroundY.sampleTriangle = (a, b, c, emit) => {
  const vertices = [a, b, c];
  const minX = Math.min(a.x, b.x, c.x), maxX = Math.max(a.x, b.x, c.x);
  const minZ = Math.min(a.z, b.z, c.z), maxZ = Math.max(a.z, b.z, c.z);
  for (const layer of RUG_LAYERS) {
    const left = -layer.w / 2, right = layer.w / 2, back = RUG_Z - layer.d / 2, front = RUG_Z + layer.d / 2;
    if (maxX < left || minX > right || maxZ < back || minZ > front) continue;
    if (minX >= left && maxX <= right && minZ >= back && maxZ <= front) continue;
    let polygon = vertices;
    for (const [axis, value, sign] of [["x", left, 1], ["x", right, -1], ["z", back, 1], ["z", front, -1]]) {
      const clipped = [];
      for (let i = 0; i < polygon.length; i++) {
        const p = polygon[i], q = polygon[(i + 1) % polygon.length];
        const dp = (p[axis] - value) * sign, dq = (q[axis] - value) * sign;
        if (dp >= 0) clipped.push(p);
        if ((dp >= 0) !== (dq >= 0)) {
          const hit = p.clone().lerp(q, dp / (dp - dq)); hit[axis] = value; clipped.push(hit);
        }
      }
      polygon = clipped;
    }
    for (const point of polygon) emit(point);
  }
};
const WAINSCOT_H = 1.1;
/* five pilasters, evenly spaced 3.7 m apart; the 📚 sign hangs on the
   centre one like a plaque, windows sit in the two bays flanking it */
const PILASTERS_X = [-7.4, -3.7, 0, 3.7, 7.4];
const WINDOWS = { xs: [-1.85, 1.85], w: 1.2, h: 2.4, cy: 3 };

/* Task 5 hangs two pendant lamps here; the warm PointLights below already
   live at these anchors, so fixtures and light pools always agree.
   Plain [x, y, z] triples — reused by task 5 and the QA hook. */
export const LAMP_ANCHORS = [
  [-3.6, 5.45, -0.4],
  [3.6, 5.45, -0.4]
];

/* Shared-geometry/material kit for ONE visit. close() disposes through the
   scene traverse — geometry/material.dispose() is idempotent, so meshes
   that share a cached box or material are fully covered by the existing
   teardown (and re-open rebuilds a fresh kit). Keeps draw calls cheap
   without leaking VRAM. */
function createKit() {
  const geos = new Map();
  const mats = new Map();
  return {
    boxGeo(w, h, d) {
      const k = `b${w}x${h}x${d}`;
      let g = geos.get(k);
      if (!g) geos.set(k, g = new THREE.BoxGeometry(w, h, d));
      return g;
    },
    planeGeo(w, h, rotX) {
      const k = `p${w}x${h}x${rotX}`;
      let g = geos.get(k);
      if (!g) {
        g = new THREE.PlaneGeometry(w, h);
        if (rotX) g.rotateX(rotX);
        geos.set(k, g);
      }
      return g;
    },
    std(color, extra) {
      const k = `s${color}|${JSON.stringify(extra || {})}`;
      let m = mats.get(k);
      if (!m) mats.set(k, m = new THREE.MeshStandardMaterial(
        { color, roughness: 0.95, metalness: 0.0, ...(extra || {}) }));
      return m;
    }
  };
}

function addBox(kit, w, h, d, color, x, y, z, parent, extra) {
  const mesh = new THREE.Mesh(kit.boxGeo(w, h, d), kit.std(color, extra));
  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function buildRoom(parent) {
  const kit = createKit();

  const floor = new THREE.Mesh(
    kit.planeGeo(ROOM.w, ROOM.d, -Math.PI / 2),
    kit.std(WOOD, { roughness: 0.8 })
  );
  parent.add(floor);

  /* Double-sided walls overlap slightly at the corners to avoid light
     leaks. The ceiling closes the space above the walls; the camera looks
     into the room through its open front. */
  const wallOpts = { side: THREE.DoubleSide, roughness: 1.0 };
  const sideZ = ROOM.backZ + ROOM.d / 2 - 0.2;   /* side/ceiling centre */
  const back = new THREE.Mesh(
    kit.planeGeo(ROOM.w + 0.4, ROOM.h, 0), kit.std(WALL_WARM, wallOpts));
  back.position.set(0, ROOM.h / 2, ROOM.backZ);
  parent.add(back);
  for (const sx of [-1, 1]) {
    const wall = new THREE.Mesh(
      kit.planeGeo(ROOM.d + 0.8, ROOM.h, 0), kit.std(WALL_SHADE, wallOpts));
    wall.position.set(sx * ROOM.sideX, ROOM.h / 2, sideZ);
    wall.rotation.y = -sx * Math.PI / 2;
    parent.add(wall);
  }
  const ceil = new THREE.Mesh(
    kit.planeGeo(ROOM.w + 0.1, ROOM.d + 0.8, Math.PI / 2),
    kit.std(CEILING_TONE, wallOpts));
  ceil.position.set(0, ROOM.h, sideZ);
  parent.add(ceil);

  /* baseboards: back (kept from task 1) + the two side walls */
  addBox(kit, ROOM.w + 0.2, 0.28, 0.1, BASEBOARD, 0, 0.14, ROOM.backZ + 0.05, parent);
  for (const sx of [-1, 1]) {
    addBox(kit, 0.1, 0.28, ROOM.d + 0.4, BASEBOARD,
      sx * (ROOM.sideX - 0.05), 0.14, sideZ, parent);
  }

  /* wainscot: a darker wood band up to WAINSCOT_H along every wall,
     capped by a thin pale rail box (moulding). Overshoot each corner so
     the three bands overlap — no slits at the joints. */
  addBox(kit, ROOM.w + 0.12, WAINSCOT_H, 0.08, WAINSCOT,
    0, WAINSCOT_H / 2, ROOM.backZ + 0.04, parent);
  for (const sx of [-1, 1]) {
    addBox(kit, 0.08, WAINSCOT_H, ROOM.d + 0.5, WAINSCOT,
      sx * (ROOM.sideX - 0.04), WAINSCOT_H / 2, sideZ, parent);
  }
  addBox(kit, ROOM.w + 0.16, 0.07, 0.13, PILASTER,
    0, WAINSCOT_H + 0.035, ROOM.backZ + 0.045, parent);
  for (const sx of [-1, 1]) {
    addBox(kit, 0.13, 0.07, ROOM.d + 0.5, PILASTER,
      sx * (ROOM.sideX - 0.045), WAINSCOT_H + 0.035, sideZ, parent);
  }

  /* five pale pilasters break up the long back wall; full height, they
     also visually tie the wainscot rail into the ceiling */
  for (const px of PILASTERS_X) {
    addBox(kit, 0.5, ROOM.h, 0.12, PILASTER, px, ROOM.h / 2, ROOM.backZ + 0.06, parent);
  }

  /* two tall windows in the bays flanking the centre, each: frame box
     sunk to the wall, shared gradient "sky" plane just in front, a slim
     mullion cross and a little sill. No dynamic shadows anywhere (beach
     perf rule) — the emissive-looking sky does the sunlit work. */
  const skyMat = new THREE.MeshBasicMaterial({ map: windowSkyTexture() });
  for (const wx of WINDOWS.xs) {
    addBox(kit, WINDOWS.w + 0.36, WINDOWS.h + 0.36, 0.08, TRIM,
      wx, WINDOWS.cy, ROOM.backZ + 0.04, parent);
    const sky = new THREE.Mesh(
      kit.planeGeo(WINDOWS.w, WINDOWS.h, 0), skyMat);
    sky.position.set(wx, WINDOWS.cy, ROOM.backZ + 0.085);
    parent.add(sky);
    addBox(kit, 0.06, WINDOWS.h, 0.03, TRIM, wx, WINDOWS.cy, ROOM.backZ + 0.105, parent);
    addBox(kit, WINDOWS.w, 0.06, 0.03, TRIM, wx, WINDOWS.cy, ROOM.backZ + 0.105, parent);
    addBox(kit, WINDOWS.w + 0.5, 0.07, 0.18, TRIM,
      wx, WINDOWS.cy - WINDOWS.h / 2 - 0.02, ROOM.backZ + 0.1, parent);
  }

  /* central rug: two stacked planes (darker border ring shows as a frame).
     y is a few mm over the floor — no z-fighting — and wireInput raycasts
     the MATH plane at y=0 (never scene children), so walk targets are
     completely unaffected by what sits on top. */
  for (const layer of RUG_LAYERS) {
    const rug = new THREE.Mesh(kit.planeGeo(layer.w, layer.d, -Math.PI / 2), kit.std(layer.color, { roughness: 1.0 }));
    rug.position.set(0, layer.y, RUG_Z); rug.name = layer.name; parent.add(rug);
  }

  /* Unlit library plaque on the centre pilaster, between the windows. */
  const signTex = emojiSignTexture("📚");
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.4),
    new THREE.MeshBasicMaterial({ map: signTex, transparent: true })
  );
  sign.position.set(0, 2.5, ROOM.backZ + 0.13);
  parent.add(sign);
  return { sign };
}

/* ============================================================
   TASK 5 — the furniture pass

   Everything is procedural and merged for draw-call economy:
   - ONE dark-wood mesh holds all 6 bookshelf cases (bake() vertex-colours
     every part, mergeGeometries welds them — boat3d's duck pattern),
    - ONE mesh holds every book row: thin boxes whose UVs are remapped into
      a shared 1024² canvas "book-spines atlas" (8 seeded-random spine rows),
    - task 6 re-split the vertex-coloured solids mesh PER PIECE (armchair,
      side table, floor lamp, table, each stool, globe stand, each pendant,
      frames) so the occluder fade can dim only what crosses the
      camera→character line — one own-material mesh per piece, ONE unlit
      glow mesh for all bulbs,
   - the globe is the only animated piece (slow 0.1 rad/s spin, RM-stilled)
     so it stays its own mesh; banner + framed pictures are one extra
     basic-material quad each (shared 2-up picture atlas).
   Collisions: every solid footprint registers beach-format circles
   {id, x, z, radius} — wide boxes get 2-3 overlapping discs.
   ============================================================ */

/* deterministic RNG (mulberry32) — the atlas and book rows vary between
   shelves but the ROOM looks identical on every visit/re-open */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* bright-but-warm spine palette — same family as the house palette */
const BOOK_SPINE_COLORS = ["#d94f3d", "#e8963a", "#f2c94c", "#6fae5c",
  "#4fa3a0", "#5b8fc9", "#9a6fb0", "#e88fa8", "#f2e3c8", "#b5651d",
  "#c94f6d", "#3f7d5c"];

/* 1024² book-spines atlas: 8 rows × 128 px, each row a shelf's worth of
   random-width colourful spines with title dashes, occasional leaners and
   bare gaps for charm. Row r covers v ∈ [1-(r+1)/8, 1-r/8] (flipY). */
function bookSpineAtlas(rand) {
  const S = 1024, ROWS = 8, RH = S / ROWS;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#241408";                 /* dark shelf shadow behind books */
  g.fillRect(0, 0, S, S);
  for (let row = 0; row < ROWS; row++) {
    const baseY = (row + 1) * RH;          /* books stand on the row's floor */
    let x = 3 + rand() * 10;
    while (x < S - 30) {
      if (rand() < 0.07) { x += 18 + rand() * 26; continue; }   /* bare gap  */
      const bw = 22 + Math.floor(rand() * 44);
      const bh = RH * (0.74 + rand() * 0.22);
      const lean = rand() < 0.1;
      const col = BOOK_SPINE_COLORS[(rand() * BOOK_SPINE_COLORS.length) | 0];
      g.save();
      g.translate(x + (lean ? bw / 2 : 0), baseY);
      if (lean) g.rotate(rand() < 0.5 ? -0.16 : 0.16);
      if (lean) g.translate(-bw / 2, 0);
      g.fillStyle = col;
      g.fillRect(0, -bh, bw, bh);
      g.strokeStyle = "rgba(28, 15, 6, 0.5)";
      g.lineWidth = 3;
      g.strokeRect(1.5, -bh + 1.5, bw - 3, bh - 3);
      if (rand() < 0.72) {                 /* cream title dashes catch the eye */
        g.fillStyle = "rgba(255, 247, 228, 0.9)";
        const ty = -bh * (0.66 + rand() * 0.14);
        g.fillRect(bw * 0.18, ty, bw * 0.64, 6);
        g.fillRect(bw * 0.28, ty + 13, bw * 0.44, 5);
      }
      g.restore();
      x += bw + 3 + rand() * 3 + (lean ? 9 : 0);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* LIBRARY banner — house-style text (dark stroke UNDER cream fill on a
   warm plank), same recipe as the 📚 emoji sign plaque */
function bannerTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 170;
  const g = c.getContext("2d");
  const r = 30;                            /* rounded warm-wood plank */
  g.beginPath();
  g.moveTo(r, 8); g.lineTo(512 - r, 8); g.quadraticCurveTo(504, 8, 504, 8 + r);
  g.lineTo(504, 162 - r); g.quadraticCurveTo(504, 162, 504 - r, 162);
  g.lineTo(r, 162); g.quadraticCurveTo(8, 162, 8, 162 - r);
  g.lineTo(8, 8 + r); g.quadraticCurveTo(8, 8, r, 8);
  g.closePath();
  g.fillStyle = "#7a4a28";
  g.fill();
  g.lineWidth = 10;
  g.strokeStyle = "#2e1a0e";
  g.stroke();
  g.textAlign = "center";
  g.textBaseline = "middle";
  let px = 104;
  for (;;) {                             /* shrink-to-fit (emojiSignTexture's trick) */
    g.font = `bold ${px}px Georgia, serif`;
    if (g.measureText("LIBRARY").width <= 440 || px < 60) break;
    px -= 6;
  }
  g.lineJoin = "round";
  g.miterLimit = 2;
  g.lineWidth = 14;                        /* stroke UNDER the fill */
  g.strokeStyle = "rgba(30, 16, 6, 0.95)";
  g.strokeText("LIBRARY", 256, 90);
  g.fillStyle = "#f7e9cc";
  g.fillText("LIBRARY", 256, 90);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* globe skin — 256×128 equirect "blue marble for kids": teal ocean,
   chunky warm-green land blobs + a cream polar cap. The spin is only
   delightful if the rotation is VISIBLE, which a flat sphere can't do. */
function globeTexture() {
  const c = document.createElement("canvas");
  c.width = 256; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#3f8e96";
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = "#6fae5c";
  const blobs = [[36, 44, 26, 20], [70, 78, 18, 14], [120, 40, 30, 18],
    [150, 84, 22, 16], [205, 52, 26, 22], [236, 96, 16, 12], [10, 100, 20, 10]];
  for (const [x, y, rx, ry] of blobs) {
    g.beginPath();
    g.ellipse(x, y, rx, ry, (x % 3) * 0.4, 0, Math.PI * 2);
    g.fill();
    if (x + rx > 256) {                   /* wrap so no seam gap */
      g.beginPath();
      g.ellipse(x - 256, y, rx, ry, (x % 3) * 0.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.fillStyle = "#eef6ef";
  g.fillRect(0, 0, 256, 9);               /* north polar cap        */
  g.fillRect(0, 119, 256, 9);             /* south polar ice        */
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* one 512×256 atlas, two framed side-wall pictures (left u-half / right
   u-half) — simple crayon shapes so the frames read as kids' art */
function paintingsTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 256;
  const g = c.getContext("2d");
  /* picture 1: sun over green hills */
  g.fillStyle = "#f2e3c8"; g.fillRect(0, 0, 256, 256);
  g.fillStyle = "#f2c94c";
  g.beginPath(); g.arc(62, 62, 34, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#e8963a"; g.lineWidth = 7;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    g.beginPath();
    g.moveTo(62 + Math.cos(a) * 44, 62 + Math.sin(a) * 44);
    g.lineTo(62 + Math.cos(a) * 58, 62 + Math.sin(a) * 58);
    g.stroke();
  }
  g.fillStyle = "#6fae5c";
  g.beginPath(); g.arc(70, 300, 150, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#3f7d5c";
  g.beginPath(); g.arc(210, 315, 150, 0, Math.PI * 2); g.fill();
  /* picture 2: moon and stars */
  g.fillStyle = "#5b78a8"; g.fillRect(256, 0, 256, 256);
  g.fillStyle = "#fff1d6";
  g.beginPath(); g.arc(380, 100, 42, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#5b78a8";
  g.beginPath(); g.arc(400, 86, 36, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#f7e9cc";
  for (const [sx, sy] of [[300, 60], [330, 160], [470, 60], [460, 180], [300, 210], [420, 210]]) {
    g.beginPath(); g.arc(sx, sy, 5, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------- merge plumbing (boat3d's vertex-colour bake, reused) ------ */

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _mat = new THREE.Matrix4();

/* translation+rotation matrix (Euler order Y·X·Z via THREE.Euler(rx,ry,rz)) */
function M4(x, y, z, ry, rx, rz) {
  _e.set(rx || 0, ry || 0, rz || 0);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  return new THREE.Matrix4().compose(_v, _q, _one);
}

/* bake one primitive into parts[]: non-indexed, transformed, vertex-coloured */
function bake(parts, geo, color, m) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (m) g.applyMatrix4(m);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(cols, 3));
  parts.push(g);
}

/* same without colours (the atlas-textured book/picture meshes) */
function bakePlain(parts, geo, m) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (m) g.applyMatrix4(m);
  parts.push(g);
}

/* remap every UV into [u0,u1]×[v0,v1] — picks an atlas band per book row */
function remapUV(g, u0, u1, v0, v1) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
}

function mergedMesh(parts, material) {
  const geo = mergeGeometries(parts, false);
  for (const g of parts) g.dispose();
  const mesh = new THREE.Mesh(geo, material);
  return mesh;
}

/* ---------- the furnished room ----------------------------------------
   Layout map (metres, floor plane; room x∈[-8,8], back wall z=-6):
     back wall : bookshelf  x=-5.35 / +5.35 (outer bays between pilasters;
               x=±1.85 stays FREE — that's the window band, x=0 the 📚 sign)
     side walls: bookshelves x=∓7.65 at z=-3.0 and z=+1.0, facing inward
     rug centre: reading table (0,-0.8) + 2 stools at (-0.6,-1.9)/(-0.75,-0.1)
     back-right: nook — armchair (5.65,-3.45) yawed to room centre,
               side table (6.75,-2.3), floor lamp (7.0,-3.95) + own PointLight
     front-left: globe on a stand (-5.5, 1.7), the spinning delight
     ceiling   : pendant cords/shades/bulbs at both LAMP_ANCHORS
     walls     : LIBRARY banner above the 📚 sign (x=0, y=3.58);
               one framed picture per side wall at z=-1.0 in the shelf gap
   --------------------------------------------------------------------- */
function buildFurniture(parent) {
  const rand = mulberry32(0xB00BE5);
  const obstacles = [];
  const caseParts = [];   /* all shelf cases  → one dark-wood mesh */
  const bookParts = [];   /* all book rows    → one atlas mesh     */
  const glowParts = [];   /* bulbs            → one unlit warm mesh */

  /* task 6: the old single vertex-coloured "everything else" merge is split
     PER PIECE so the occluder fade can dim only the prop standing on the
     camera→character line (one global merge could only fade ALL or NONE).
     Every registered piece carries its own MeshStandardMaterial instance —
     per-frame opacity/transparent flips never touch its siblings. The wall
     frames + the glow mesh stay unregistered (wall-hugging / unlit bulbs).
     Draw-call budget: +10 tiny meshes over the ~60 calls task 5 measured —
     still far under the 90 gate. */
  const occluders = [];
  function addPiece(parts) {
    const mesh = mergedMesh(parts, new THREE.MeshStandardMaterial(
      { vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
    parent.add(mesh);
    return mesh;
  }
  function registerOccluder(name, mesh) {
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const h = new THREE.Vector3();
    bb.getSize(h).multiplyScalar(0.5);
    occluders.push({ name, mesh, mat: mesh.material,
      c: bb.getCenter(new THREE.Vector3()), h });
    return mesh;
  }

  const SHELF_WOOD = 0x4a2c17;
  const SHELF_BACK = 0x3a2212;
  const SHELF_CROWN = 0x5d3a1f;

  /* ---- 1. six bookshelf units (w2.2 × h3.4 × d0.5) ---- */
  const SHELVES = [
    { x: -5.35, z: -5.65, ry: 0, id: "shelf-bl" },
    { x: 5.35, z: -5.65, ry: 0, id: "shelf-br" },
    { x: -7.65, z: -3.0, ry: Math.PI / 2, id: "shelf-l1" },
    { x: -7.65, z: 1.0, ry: Math.PI / 2, id: "shelf-l2" },
    { x: 7.65, z: -3.0, ry: -Math.PI / 2, id: "shelf-r1" },
    { x: 7.65, z: 1.0, ry: -Math.PI / 2, id: "shelf-r2" }
  ];
  for (const sh of SHELVES) {
    const base = M4(sh.x, 0, sh.z, sh.ry);
    const L = (geo, color, x, y, z, rx) =>
      bake(caseParts, geo, color, base.clone().multiply(M4(x, y, z, 0, rx || 0)));
    /* case: sides, top, bottom, back, mid divider, 4 shelves, crown */
    L(new THREE.BoxGeometry(0.08, 3.4, 0.5), SHELF_WOOD, -1.06, 1.7, 0);
    L(new THREE.BoxGeometry(0.08, 3.4, 0.5), SHELF_WOOD, 1.06, 1.7, 0);
    L(new THREE.BoxGeometry(2.2, 0.08, 0.5), SHELF_WOOD, 0, 3.36, 0);
    L(new THREE.BoxGeometry(2.2, 0.08, 0.5), SHELF_WOOD, 0, 0.04, 0);
    L(new THREE.BoxGeometry(2.04, 3.24, 0.05), SHELF_BACK, 0, 1.7, -0.215);
    L(new THREE.BoxGeometry(0.05, 3.24, 0.44), SHELF_WOOD, 0, 1.7, 0.02);
    for (let k = 1; k <= 4; k++)
      L(new THREE.BoxGeometry(2.04, 0.06, 0.46), SHELF_WOOD, 0, 0.08 + k * 0.648, 0.02);
    L(new THREE.BoxGeometry(2.32, 0.12, 0.56), SHELF_CROWN, 0, 3.46, 0.02);
    /* books: 5 bays × 2 sections, each a UV-remapped slab into a random
       atlas row band; per-shelf h/w jitter keeps rows lively */
    for (let bay = 0; bay < 5; bay++) {
      const boardTop = bay === 0 ? 0.08 : 0.08 + bay * 0.648 + 0.03;
      for (const sx of [-0.535, 0.535]) {
        const h = 0.4 + rand() * 0.06;
        const d = 0.33 + rand() * 0.05;
        const g = new THREE.BoxGeometry(0.95, h, d);
        const row = (rand() * 8) | 0;
        remapUV(g, 0, 1, 1 - (row + 1) / 8, 1 - row / 8);
        bakePlain(bookParts, g, base.clone().multiply(M4(sx, boardTop + h / 2, 0.02)));
      }
    }
    /* collision: 3 overlapping discs along the unit's long axis */
    const lx = Math.cos(sh.ry), lz = -Math.sin(sh.ry);
    for (let j = -1; j <= 1; j++) {
      obstacles.push({ id: `${sh.id}${j + 2}`, x: sh.x + lx * j * 0.85,
        z: sh.z + lz * j * 0.85, radius: 0.27 });
    }
  }
  const caseMesh = mergedMesh(caseParts, new THREE.MeshStandardMaterial(
    { vertexColors: true, roughness: 0.92, metalness: 0 }));
  parent.add(caseMesh);
  const booksMesh = mergedMesh(bookParts, new THREE.MeshStandardMaterial(
    { map: bookSpineAtlas(rand), roughness: 0.95, metalness: 0 }));
  parent.add(booksMesh);

  /* ---- 2. reading table + stools + table-top books ---- */
  /* the table-top books ride the TABLE piece so they fade with it (books
     floating at full opacity over a ghosted table would look broken) */
  const tableParts = [];
  bake(tableParts, new THREE.BoxGeometry(2.0, 0.08, 0.9), 0x9c6b3e, M4(0, 0.76, -0.8));
  bake(tableParts, new THREE.BoxGeometry(1.72, 0.14, 0.72), 0x8a5a33, M4(0, 0.65, -0.8));
  for (const tx of [-0.85, 0.85])
    for (const tz of [-0.33, 0.33])
      bake(tableParts, new THREE.BoxGeometry(0.1, 0.68, 0.1), 0x7a4a28, M4(tx, 0.34, -0.8 + tz));
  /* stools tuck at the long table edges but sit LEFT of the door axis:
     the natural spawn→nook corridor only grazes the table discs (clean
     slide), never a stool/table wedge (audited: a centre stool trapped
     the sweep at its stagnation point) */
  const STOOLS = [{ x: -0.6, z: -1.9, a0: 0.4 }, { x: -0.75, z: -0.1, a0: 1.3 }];
  for (const st of STOOLS) {
    const parts = [];
    bake(parts, new THREE.CylinderGeometry(0.24, 0.24, 0.07, 14), 0xc98d54,
      M4(st.x, 0.45, st.z));
    for (let a = 0; a < 3; a++) {
      const ang = st.a0 + a * Math.PI * 2 / 3;
      bake(parts, new THREE.CylinderGeometry(0.03, 0.026, 0.44, 6), 0x7a4a28,
        M4(st.x + Math.cos(ang) * 0.16, 0.22, st.z + Math.sin(ang) * 0.16));
    }
    registerOccluder(`stool-${st.x}`, addPiece(parts));
    obstacles.push({ id: `stool-${st.x}`, x: st.x, z: st.z, radius: 0.32 });
  }
  /* stacked books + one open book on the table */
  [0xd94f3d, 0x5b8fc9, 0xf2c94c].forEach((col, i) => {
    bake(tableParts, new THREE.BoxGeometry(0.42, 0.055, 0.3), col,
      M4(-0.55, 0.828 + i * 0.056, -0.72, (i - 1) * 0.14));
  });
  bake(tableParts, new THREE.BoxGeometry(0.035, 0.03, 0.32), 0xb5651d, M4(0.5, 0.815, -0.86));
  bake(tableParts, new THREE.BoxGeometry(0.22, 0.018, 0.3), 0xfbf3e0, M4(0.385, 0.832, -0.86, 0, 0, 0.16));
  bake(tableParts, new THREE.BoxGeometry(0.22, 0.018, 0.3), 0xfbf3e0, M4(0.615, 0.832, -0.86, 0, 0, -0.16));
  registerOccluder("table", addPiece(tableParts));
  /* table footprint: 5 discs hugging the 2.0×0.9 top outline */
  for (const [ox, oz] of [[-0.6, -0.98], [0.6, -0.98], [-0.6, -0.62], [0.6, -0.62], [0, -0.8]])
    obstacles.push({ id: `table-${ox}-${oz}`, x: ox, z: oz,
      radius: ox === 0 && oz === -0.8 ? 0.5 : 0.45 });

  /* ---- 3. pendant lamps: cords reach the ceiling, lights at LAMP_ANCHORS ---- */
  for (const [lx, , lz] of LAMP_ANCHORS) {
    const parts = [];
    bake(parts, new THREE.CylinderGeometry(0.015, 0.015, 0.92, 6), 0x3a2517,
      M4(lx, 5.56, lz));
    bake(parts, new THREE.ConeGeometry(0.32, 0.4, 16, 1, true), 0xe8963a,
      M4(lx, 4.9, lz));
    bake(glowParts, new THREE.SphereGeometry(0.07, 10, 8), 0xffe9b8, M4(lx, 4.78, lz));
    registerOccluder(`pendant-${lx > 0 ? "r" : "l"}`, addPiece(parts));
  }

  /* ---- 4. reading nook: armchair + side table + floor lamp ----
     Pulled 0.25 m clear of the back-right WALK corner so the corner
     stays reachable (armchair discs would otherwise graze it). */
  const baseA = M4(5.65, 0, -3.45, -1.0);
  const chairParts = [];
  const A = (geo, color, x, y, z, rx) =>
    bake(chairParts, geo, color, baseA.clone().multiply(M4(x, y, z, 0, rx || 0)));
  const CHAIR = 0xd96b4f;
  A(new THREE.BoxGeometry(0.92, 0.3, 0.82), CHAIR, 0, 0.3, 0.04);
  A(new THREE.BoxGeometry(0.92, 0.82, 0.2), CHAIR, 0, 0.68, -0.36, -0.1);
  A(new THREE.BoxGeometry(0.2, 0.52, 0.88), CHAIR, -0.46, 0.44, 0.02);
  A(new THREE.BoxGeometry(0.2, 0.52, 0.88), CHAIR, 0.46, 0.44, 0.02);
  A(new THREE.BoxGeometry(0.76, 0.14, 0.6), 0xf2b23e, 0, 0.52, 0.1);
  for (const fx of [-0.38, 0.38])
    for (const fz of [-0.3, 0.4])
      A(new THREE.BoxGeometry(0.09, 0.16, 0.09), 0x54341d, fx, 0.08, fz);
  registerOccluder("armchair", addPiece(chairParts));
  obstacles.push({ id: "armchair-a", x: 5.4, z: -3.29, radius: 0.48 });
  obstacles.push({ id: "armchair-b", x: 5.9, z: -3.61, radius: 0.5 });

  const sideParts = [];
  bake(sideParts, new THREE.CylinderGeometry(0.26, 0.26, 0.06, 14), 0x9c6b3e, M4(6.75, 0.52, -2.3));
  bake(sideParts, new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), 0x7a4a28, M4(6.75, 0.26, -2.3));
  bake(sideParts, new THREE.CylinderGeometry(0.2, 0.22, 0.05, 12), 0x7a4a28, M4(6.75, 0.025, -2.3));
  bake(sideParts, new THREE.BoxGeometry(0.14, 0.12, 0.1), 0xc94f6d, M4(6.75, 0.61, -2.3, 0.4));
  registerOccluder("side-table", addPiece(sideParts));
  obstacles.push({ id: "side-table", x: 6.75, z: -2.3, radius: 0.3 });

  const lampParts = [];
  bake(lampParts, new THREE.CylinderGeometry(0.24, 0.26, 0.05, 14), 0x54341d, M4(7.0, 0.025, -3.95));
  bake(lampParts, new THREE.CylinderGeometry(0.028, 0.028, 1.52, 8), 0xc9a24b, M4(7.0, 0.8, -3.95));
  bake(lampParts, new THREE.ConeGeometry(0.3, 0.4, 14, 1, true), 0xffd9a0, M4(7.0, 1.68, -3.95));
  bake(glowParts, new THREE.SphereGeometry(0.07, 10, 8), 0xffe9b8, M4(7.0, 1.58, -3.95));
  registerOccluder("floor-lamp", addPiece(lampParts));
  const lampPool = new THREE.PointLight(0xffc890, 4.5, 4.2, 2);
  lampPool.position.set(7.0, 1.5, -3.95);
  parent.add(lampPool);
  obstacles.push({ id: "floor-lamp", x: 7.0, z: -3.95, radius: 0.26 });

  /* ---- 5. globe on a stand (front-left), spins in the loop ---- */
  const standParts = [];
  bake(standParts, new THREE.CylinderGeometry(0.26, 0.3, 0.05, 14), 0x8a5f38, M4(-5.5, 0.025, 1.7));
  bake(standParts, new THREE.CylinderGeometry(0.04, 0.05, 0.52, 8), 0xc9a24b, M4(-5.5, 0.31, 1.7));
  bake(standParts, new THREE.CylinderGeometry(0.1, 0.06, 0.07, 10), 0xc9a24b, M4(-5.5, 0.59, 1.7));
  registerOccluder("globe-stand", addPiece(standParts));
  obstacles.push({ id: "globe", x: -5.5, z: 1.7, radius: 0.3 });
  const globeTilt = new THREE.Group();
  globeTilt.position.set(-5.5, 0.93, 1.7);
  globeTilt.rotation.z = 0.26;             /* classic leaning-globe tilt */
  const globeMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 20, 14),
    new THREE.MeshStandardMaterial({ map: globeTexture(), roughness: 0.8, metalness: 0 })
  );
  globeTilt.add(globeMesh);
  parent.add(globeTilt);
  /* task 6: the sphere is its own mesh with its own material already — and
     it counts ("it's in a walkable corner"); the fade applies matrixWorld
     to the LOCAL centre, so the tilt group is handled for free */
  registerOccluder("globe", globeMesh);

  /* ---- 6. wall decor: LIBRARY banner above the 📚 sign, framed pictures
        on both side walls (they fit the z∈[-1.9,-0.1] gap between the two
        shelf units on each wall) ---- */
  const banner = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 0.52),
    new THREE.MeshBasicMaterial({ map: bannerTexture(), transparent: true })
  );
  banner.position.set(0, 3.5, ROOM.backZ + 0.135);
  parent.add(banner);

  const picParts = [];
  const frameParts = [];
  for (const [sx, u0] of [[-1, 0], [1, 0.5]]) {
    bake(frameParts, new THREE.BoxGeometry(0.06, 0.85, 0.65), 0x54341d,
      M4(sx * (ROOM.sideX - 0.08), 2.35, -1.0));
    const p = new THREE.PlaneGeometry(0.55, 0.75);
    remapUV(p, u0, u0 + 0.5, 0, 1);
    bakePlain(picParts, p, M4(sx * (ROOM.sideX - 0.115), 2.35, -1.0, -sx * Math.PI / 2));
  }
  const picsMesh = mergedMesh(picParts, new THREE.MeshBasicMaterial(
    { map: paintingsTexture() }));
  parent.add(picsMesh);
  /* the two frames hug the side walls, outside the camera→character
     corridor, so they merge as a plain,
     unregistered piece, same wall-hugging class as the shelf cases */
  addPiece(frameParts);

  /* ---- merged meshes for the shared unlit glow (all bulbs in one) ---- */
  parent.add(mergedMesh(glowParts, new THREE.MeshBasicMaterial({ vertexColors: true })));

  return { globe: globeMesh, obstacles, occluders };
}

/* ---------- walkable floor + stable overview --------------------------
   The room has no front wall: the camera may sit beyond the floor's +7
   edge. Keep its height below the ceiling and its x inside the side walls.
   Moving Lily never changes depth, height, FOV or pitch. Desktop leaves
   the middle of the room still; narrow views translate sideways like the
   beach's land camera. Both position and target receive the SAME offset. */
const CAM = { fov: 38, pos: [0, 3.9, 8.6], target: [0, 0.9, -1],
  followRate: 6, deadZone: 1.4, maxShift: 4.6 };
const WALK = { xMin: -6.0, xMax: 6.0, zMin: -4.6, zMax: 2.6 };

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/* Reset on open; also reused for the smooth return from a QA orbit. */
const camSmooth = {
  inited: false,
  pos: new THREE.Vector3(),
  look: new THREE.Vector3()
};
const _camGoal = new THREE.Vector3();
const _lookGoal = new THREE.Vector3();

function updateFollowCamera(dt) {
  if (!camera || !character) return;
  const a = character.getAnchor();
  if (!camSmooth.inited) {
    camSmooth.pos.copy(camera.position);
    camSmooth.look.set(CAM.target[0], CAM.target[1], CAM.target[2]);
    camSmooth.inited = true;
  }
  // Blend at tablet widths instead of jumping at the portrait breakpoint.
  const wide = clamp((camera.aspect - 0.75) / 0.75, 0, 1);
  // Leave two metres of lateral floor in frame even at the nearest WALK row.
  const deadZone = CAM.deadZone * wide;
  const shiftLimit = THREE.MathUtils.lerp(WALK.xMax, CAM.maxShift, wide);
  const shift = clamp(a.x - clamp(a.x, -deadZone, deadZone), -shiftLimit, shiftLimit);
  _camGoal.fromArray(CAM.pos); _camGoal.x += shift;
  _lookGoal.fromArray(CAM.target); _lookGoal.x += shift;
  const k = 1 - Math.exp(-CAM.followRate * (camGlide > 0 ? 0.45 : 1) * (dt || 0));
  if (camGlide > 0) camGlide = Math.max(0, camGlide - (dt || 0));
  camSmooth.pos.lerp(_camGoal, k);
  camSmooth.look.lerp(_lookGoal, k);
  camera.position.copy(camSmooth.pos);
  camera.lookAt(camSmooth.look);
  camera.updateMatrixWorld();
}

/* ---------- QA camPose (Playwright) ---------------------------------
    PM inspection orbit: while setCamPose armed a pose, the rAF loop
    keeps running every animation (her walk mixer + stepLocomotion are
    untouched — only updateFollowCamera is skipped). The camera is
    re-placed from her LIVE loco anchor every frame, so the pose orbits
    a WALKING character:
      position (charX + d·sin(az), max(0.3, charYbase + d·sin(el)),
               charZ + d·cos(az)),  charYbase = 0 (flat room floor)
      look-at  (charX, charYbase + lookY, charZ)
    Deliberately unclamped (normal play uses the bounded overview)
    and updateMatrixWorld() keeps raycasts/occluder maths honest mid-pose. */
function updatePoseCamera() {
  if (!camera || !character || !camPose) return;
  const a = character.getAnchor();
  const baseY = 0;                            /* charYbase — the room floor */
  camera.position.set(
    a.x + camPose.dist * Math.sin(camPose.azimuth),
    Math.max(0.3, baseY + camPose.dist * Math.sin(camPose.elevation)),
    a.z + camPose.dist * Math.cos(camPose.azimuth)
  );
  _poseLook.set(a.x, baseY + camPose.lookY, a.z);
  camera.lookAt(_poseLook);
  camera.updateMatrixWorld();
}

function numOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

/* Arm the inspection orbit (defaults suit a waist-height rear-quarter).
   Returns false — a pure no-op — unless the scene is open and walking. */
function setCamPose(p) {
  if (!opened || !camera || !character || !charReady) return false;
  const src = p || {};
  camPose = {
    azimuth: numOr(src.azimuth, 0),
    elevation: numOr(src.elevation, 0.35),
    dist: Math.max(0.4, numOr(src.dist, 3)),
    lookY: numOr(src.lookY, 1)
  };
  camGlide = 0;
  updatePoseCamera();                        /* take effect THIS frame too */
  return true;
}

/* Drop the pose and hand the camera back to the follow path WITHOUT a
   snap: re-sync the smoothed follow state to the live camera, then the
   next updateFollowCamera frames ease from the pose back to the standard
   overview (camGlide softens the damping constant for the return leg). */
function clearCamPose() {
  if (!camPose) return false;
  camPose = null;
  if (camera) {
    camSmooth.inited = true;
    camSmooth.pos.copy(camera.position);     /* glide starts from the pose */
    camSmooth.look.copy(_poseLook);
    camGlide = 0.9;                          /* softened return damping */
  }
  return true;
}

/* ---------- task 6: occluder fade + stuck-target bail ------------------
   Furniture can stand on the camera→character line:
   the nook armchair when she walks into the corner behind it, the table
   when she stops south of it, the globe when she passes under it. The
   standard fix: every registered per-piece mesh measures, per frame, how
   close it sits to the camera→character segment and eases its (own)
   material between opacity 0.35 and 1.0 — `transparent` flips only while
   the fade is active so sorting stays cheap at 1.0 (three r170 buckets
   the render list from material.transparent every frame and transparent
   is NOT part of the program cache key — verified against the vendored
   build — so the toggle never recompiles a shader).

   Two gates, both per piece (the plain bounding-SPHERE+margin formula
   PM sketched was tried first and over-fades: the tall floor-lamp sphere
   r≈1.02 swallowed the whole nook even 1 m beside the line, and the flat
   2 m table sphere covered her while standing in FRONT of the table):
   1. LATERAL — distance from the segment's closest point to the piece's
      world AABB ≤ margin (0.35). A box hugs the real silhouette.
   2. DEPTH — the box must reach back PAST her: minimum box-corner
      projection along the view axis (centre projection minus the box's
      support along û) < segment length − pad (0.25). A prop behind her
      cannot hide her, end of story.
   The corner-chair case passes both easily (parked south of it the
   segment runs straight through the chair's box).

   NEVER registered: the character, both shelf case meshes + the books
   atlas mesh (wall-hugging), wall planes, sign/banner/picture quads. */
const FADE = { margin: 0.35, min: 0.35, k: 8, pad: 0.25, charY: 0.95 };
const _fadeChar = new THREE.Vector3();
const _fadeSeg = new THREE.Vector3();
const _fadeC = new THREE.Vector3();
const _fadeV = new THREE.Vector3();

function updateOccluderFade(dt) {
  if (!occluders.length || !camera || !character) return;
  const a = character.getAnchor();
  _fadeChar.set(a.x, FADE.charY, a.z);          /* her chest, not her feet */
  _fadeSeg.subVectors(_fadeChar, camera.position);
  const len = Math.max(_fadeSeg.length(), 1e-6);
  const ux = _fadeSeg.x / len, uy = _fadeSeg.y / len, uz = _fadeSeg.z / len;
  const ease = Math.min(1, FADE.k * (dt || 0));
  for (const oc of occluders) {
    /* world AABB ≈ LOCAL box centre through matrixWorld + the local half
       extents (all pieces sit on the scene's identity basis; the globe
       sphere's cube half-extents are tilt-invariant) */
    _fadeC.copy(oc.c).applyMatrix4(oc.mesh.matrixWorld);
    _fadeV.subVectors(_fadeC, camera.position);
    /* depth gate: nearest box corner along û still camera-side of her */
    const support = oc.h.x * Math.abs(ux) + oc.h.y * Math.abs(uy) + oc.h.z * Math.abs(uz);
    if (_fadeV.dot(_fadeSeg) / len - support >= len - FADE.pad) {
      oc._solid = true;                          /* behind her — never fade */
    } else {
      const t = clamp(_fadeV.dot(_fadeSeg) / (len * len), 0, 1);
      const qx = Math.abs(_fadeC.x - (camera.position.x + _fadeSeg.x * t)) - oc.h.x;
      const qy = Math.abs(_fadeC.y - (camera.position.y + _fadeSeg.y * t)) - oc.h.y;
      const qz = Math.abs(_fadeC.z - (camera.position.z + _fadeSeg.z * t)) - oc.h.z;
      oc._solid = !(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2 + Math.max(qz, 0) ** 2
        < FADE.margin * FADE.margin);
    }
    const goal = oc._solid ? 1 : FADE.min;
    const m = oc.mat;
    if (m.opacity !== goal) {
      m.opacity += (goal - m.opacity) * ease;
      if (Math.abs(goal - m.opacity) < 0.004) m.opacity = goal;
    }
    const trans = m.opacity < 0.999;
    if (m.transparent !== trans) m.transparent = trans;
  }
}

/* Stagnation: when the target lies INSIDE an obstacle ring (nook corner
   behind the armchair, dead-centre into the table) moveAroundProps parks
   her at the ring edge every substep — character3d derives `moving` from
   actual displacement (line 796: >1e-6 m), so a fully cancelled walk
   leaves `loco.target` set with zero progress: the old target lingers,
   the stance jitters between walk-pokes and idle, and nothing tells her
   to give up. Bail rule: a live target with sub-STUCK.speed ground speed
   for STUCK.hold seconds → clearTarget() (the very setter the pointer
   release path uses; called WITHOUT a source filter so QA "program"
   targets clear exactly like "pointer" ones) and the next tap starts
   fresh. Speed comes from per-frame anchor deltas — no character3d edits. */
const STUCK = { speed: 0.05, hold: 1.2 };

function updateStuck(dt) {
  const a = character.getAnchor();
  if (stuckAX !== null && dt > 1e-6) {
    const speed = Math.hypot(a.x - stuckAX, a.z - stuckAZ) / dt;
    if (character.loco.target && speed < STUCK.speed) {
      if ((stuckT += dt) >= STUCK.hold) {
        character.clearTarget();
        stuckT = 0;
      }
    } else stuckT = 0;
  }
  stuckAX = a.x;
  stuckAZ = a.z;
}

function buildView() {
  const cam = new THREE.PerspectiveCamera(CAM.fov, 1, 0.1, 60);
  cam.position.set(CAM.pos[0], CAM.pos[1], CAM.pos[2]);
  cam.lookAt(CAM.target[0], CAM.target[1], CAM.target[2]);
  return cam;
}

/* ---------- lights (task 4 retune) ------------------------------------
    - warmer, stronger ambient: the whole room reads cozy even in the
      corners the keys miss
    - soft warm key from front-top (camera side — keeps Lily's face lit)
      + a second "daylight" key raking down from the window band so the
      frames/pilasters read sunlit; ZERO shadow maps anywhere (beach
      perf rule) — the emissive-looking window panes do the sunlit work
    - two gentle distance-limited PointLights at the task-5 LAMP_ANCHORS
      so the pendant fixtures will slot straight into existing pools.
      decay 2 / distance 9.5 → warm pools on the rug, cheap on the toon
      shader (2 dir + 2 point is still a tiny light list). */
function buildLights(parent) {
  parent.add(new THREE.AmbientLight(0xfff1dc, 0.92));
  const warm = new THREE.DirectionalLight(LAMP_WARM, 1.15);
  warm.position.set(2.5, 5.5, 5.0);
  parent.add(warm);
  /* a second soft key angled DOWN from the window band (front-high −Z)
     so the pale pilasters/frames near the windows pick up "daylight" and
     the room reads sunlit from the middle, not just the lamp pools */
  const day = new THREE.DirectionalLight(0xfff0d0, 0.85);
  day.position.set(-1.5, 5.8, -3.5);
  parent.add(day);
  for (const [x, y, z] of LAMP_ANCHORS) {
    const pool = new THREE.PointLight(LAMP_WARM, 9.0, 9.5, 2);
    pool.position.set(x, y, z);
    parent.add(pool);
  }
}

/* ---------- coalesced static rendering ------------------------------ */

function updateView() {
  if (!renderer || !camera || !hostEl) return;
  const w = hostEl.clientWidth, h = hostEl.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = w + "px";
  renderer.domElement.style.height = h + "px";
  camera.aspect = w / h;
  /* Keep vertical floor/headroom consistent. Beach-style horizontal-FOV
     preservation here would expose the open-front void on a tall phone. */
  camera.fov = CAM.fov;
  camera.updateProjectionMatrix();
}

function renderNow() {
  if (!opened || !renderer) return;
  updateView();
  renderer.render(scene, camera);
}

/* one frame per burst: open, resize, GLB/extra-texture landings */
function requestRender() {
  if (!opened || renderScheduled) return;
  renderScheduled = true;
  requestAnimationFrame(() => {
    renderScheduled = false;
    renderNow();
  });
}

/* ---------- frame loop (task 3) ---------------------------------------
   The beach runs one in beach3d.js and the character only advances
   inside her public update(dt, tNow) — mixer, stepLocomotion, yaw ease
   and ground contact all live in there; the library mirrors it with the
   same ≤1/60 substep + 0.5 s elapsed clamp, and adds the follow camera.
   tNow (the beach wave clock) is unused on dry land → 0. */

function startLoop() {
  if (!opened || document.hidden || loopId !== null) return;
  lastT = performance.now();
  const tick = (now) => {
    loopId = null;
    if (!opened || document.hidden) return;      /* hidden → idle until resume */
    loopId = requestAnimationFrame(tick);
    const elapsed = clamp((now - lastT) / 1000, 0, 0.5);
    lastT = now;
    if (character) {
      let remaining = elapsed;
      while (remaining > 1e-6) {
        const dt = Math.min(1 / 60, remaining);
        remaining -= dt;
        character.update(dt, 0);
      }
      /* task 6: fade runs AFTER the camera so it measures the line she is
         actually seen through this frame; the stuck-bail last (its clear
         takes effect on the next tick's update).
         QA camPose: when armed, the pose REPLACES the follow step only —
         everything else above/below (character.update, fade, bail, the
         render) runs exactly as in normal play. */
      if (charReady) {
        if (camPose) updatePoseCamera();
        else updateFollowCamera(elapsed);
        updateOccluderFade(elapsed);
        updateStuck(elapsed);
      }
    }
    /* task 5: the globe is the one animated prop — a gentle 0.1 rad/s
       spin on its tilted axis, still under prefers-reduced-motion */
    if (globe && !reducedMotion()) globe.rotation.y += 0.1 * elapsed;
    renderNow();
  };
  loopId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (loopId !== null) { cancelAnimationFrame(loopId); loopId = null; }
}

/* ---------- floor navigation (task 3) ---------------------------------
   Same plumbing as beach3d.js wireInput: first-down-wins tracked pointer,
   setPointerCapture so a drag keeps steering off-canvas, and a
   pointer→floor raycast (world.js pickGround pattern, but the library's
   floor is the flat y=0 plane, no sand field). Point-and-go twist vs the
   beach: RELEASE KEEPS the target — she finishes the walk to the tapped
   spot and character3d's 2D snap-stop halts her there. setTarget clamps
   to the WALK rect through movement.bounds; a miss (ray above the
   horizon) simply doesn't move her. */

function wireInput(canvas) {
  const events = new AbortController();
  const on = (type, handler, options = {}) =>
    canvas.addEventListener(type, handler, { ...options, signal: events.signal });
  const ray = new THREE.Raycaster();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const toFloor = (ev) => {
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    ray.setFromCamera({
      x: ((ev.clientX - r.left) / r.width) * 2 - 1,
      y: -(((ev.clientY - r.top) / r.height) * 2 - 1)
    }, camera);
    return ray.ray.intersectPlane(floorPlane, hit) ? hit : null;
  };
  let tracked = null;                            /* first-down wins */
  on("pointerdown", (ev) => {
    if (!opened || document.hidden || !charReady || tracked !== null) return;
    const p = toFloor(ev);
    if (!p) return;
    tracked = ev.pointerId;
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ok */ }
    character.setTarget(p.x, p.z, "pointer");
    ev.preventDefault();
  });
  on("pointermove", (ev) => {                    /* drag-to-steer */
    if (!opened || ev.pointerId !== tracked || document.hidden) return;
    const p = toFloor(ev);
    if (p) character.setTarget(p.x, p.z, "pointer");
  });
  const up = (ev) => {
    if (ev.pointerId === tracked) tracked = null; /* target survives release */
  };
  on("pointerup", up);
  on("pointercancel", up);
  on("lostpointercapture", up);
  /* hidden pauses the loop and releases a held press (beach policy);
     resume restarts with a fresh time origin — no catch-up jump */
  const visibility = () => {
    if (!opened) return;
    if (document.hidden) {
      stopLoop();
      character?.clearTarget("pointer");
      tracked = null;
    } else startLoop();
  };
  document.addEventListener("visibilitychange", visibility, { signal: events.signal });
  return () => {
    character?.clearTarget("pointer");
    tracked = null;
    events.abort();
  };
}

/* ---------- appearance -------------------------------------------------
   Hair + extra ride character3d's existing mesh-switching; the dress-up
   top/bottom/shoes go through clothes3d (Task 2). The swimsuit is hidden
   for the whole library visit — she wears her outfit, not her swimwear.
   Re-run on every GameState change while open (beach3d.js pattern). */

function syncAppearance() {
  try {
    if (!opened || !character) return false;
    const outfit = window.GameState?.getOutfit?.();
    const hairOK = character.setHair(outfit?.hair);
    const extraOK = character.setExtra(outfit?.extra);
    if (clothes) clothes.apply(outfit);
    requestRender();
    return !!(hairOK && extraOK);
  } catch (e) { return false; }
}

/* ---------- overlay plumbing ----------
   The overlay IS #library-stage (one full-screen div in index.html,
   mirroring the beach's hidden-utility mechanism): open() reveals it
   by dropping .hidden, the close wiring re-hides it. */

function overlayOf(stageEl) {
  return stageEl || document.getElementById("library-stage");
}

function focusFirst() {
  const btn = document.getElementById("library-close");
  if (btn) btn.focus({ preventScroll: true });
}

function focusMap() {
  const mapButton = document.querySelector('.nav-button[data-screen="map"]');
  if (mapButton) mapButton.focus({ preventScroll: true });
}

/* ---------- bookshelf chooser seam (js/books.js / BooksUI) ----------
   #library-read-button opens the BooksUI shelf overlay; Back/Escape
   consult BooksUI.handleBack() FIRST so they peel shelf → library →
   map one level at a time. The read button is the bottom-center
   primary action (see css/style.css — its box must never cover a
   floor walk-route click point). Bound once: library reopen must
   not stack listeners. */

let readBtnWired = false;

function wireReadButton() {
  const btn = document.getElementById("library-read-button");
  if (!btn || readBtnWired) return;
  readBtnWired = true;
  btn.addEventListener("click", () => {
    const books = window.BooksUI;
    if (books && typeof books.openShelf === "function") {
      books.openShelf();
    } else {
      const ui = window.GameUI;
      if (ui && typeof ui.setTalk === "function") {
        ui.setTalk("The bookshelf is still being built! Come back soon! 📚");
      }
    }
  });
}

function showReadButton(show) {
  const btn = document.getElementById("library-read-button");
  if (btn) btn.classList.toggle("hidden", !show);
}

/* ---------- open / close ---------- */

function open(stageEl) {
  if (opened) return true;
  const overlay = overlayOf(stageEl || null);
  const host = stageEl || overlay;
  if (!supported() || !host) return false;
  hostEl = document.createElement("div");
  hostEl.className = "library3d-host";
  hostEl.style.cssText = "position:absolute;inset:0;z-index:3;overflow:hidden";
  host.appendChild(hostEl);
  try {
    /* same canvas policy as world.js: antialias off on software GL,
       device-pixel-ratio capped at 2, half of that on software GL */
    const software = isSoftwareGL();
    renderer = new THREE.WebGLRenderer({ antialias: !software });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * (software ? 0.5 : 1));
    renderer.setClearColor(0x3a2517, 1);
    hostEl.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.touchAction = "none";
    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("aria-label", "The library. Shhh… books everywhere.");

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x33210f);   /* warm dim interior */
    camera = buildView();
    camSmooth.inited = false;          /* this visit re-inits the follow state */
    camPose = null; camGlide = 0;      /* QA: no stale inspection orbit       */
    charReady = false;
    buildLights(scene);
    buildRoom(scene);
    /* task 5: furniture — merged meshes + collision discs. Built BEFORE
       the character so movement.obstacles() already has the real list. */
    const furn = buildFurniture(scene);
    globe = furn.globe;
    libObstacles = furn.obstacles;
    /* task 6: this visit's per-piece occluder meshes (fresh materials every
       open — the fade state can never bleed across visits) */
    occluders = furn.occluders || [];
    stuckT = 0; stuckAX = null; stuckAZ = 0;

    /* movement options (task 3, all consumed by character3d):
       bounds → every setTarget/teleport/clampPoint lands inside the room;
      groundY → room floor and the two rug layers (beach sandY would hover her up
       to 30 cm and drag the blob shadow across the beach height field);
       zoneAt → always "sand": the beach zone map calls the world origin
       SEA (shoreline z≈0.53), which would park her in the prone swim
       clip the moment update() first runs; speedScale → the 1.1 m/s
       beach stroll scaled up for a kid pacing across a 12 m room. */
    character = createCharacter(renderer, scene, reducedMotion, null, {
      bounds: WALK,
      /* task 5: furniture discs — moveAroundProps sweeps these every
         substep (same {id,x,z,radius} format the beach props use) */
      obstacles: () => libObstacles,
      groundY: libraryGroundY,
      zoneAt: () => "sand",
      speedScale: 1.5
    });
    const loadingCharacter = character;
    character.ready.then((ok) => {
      if (!opened || character !== loadingCharacter) return;
      if (!ok) { console.error("library3d: GLB failed to load"); requestRender(); return; }
      /* she stands INSIDE the room, facing the camera (the glb faces
         +Z, the camera sits at +Z — yaw π turns her around). Placement
         must wait for ready: teleport() no-ops while the GLB loads.
         After ready the loop owns her (walking retargets yaw).
         Default friend Lily is the load default. */
      character.teleport(0, 0);
      character.loco.yaw = character.loco.yawTarget = Math.PI;
      /* Dressed, not swimming: swimsuit off, procedural clothes on
         (created NOW so the bind-pose bones exist for anchoring). */
      character.setSwimsuitVisible(false);
      clothes = createClothes(character);
      syncAppearance();
      charReady = true;                 /* arms pointer walks + camera follow */
    });

    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(requestRender);
      resizeObserver.observe(hostEl);
    }
    unwireInput = wireInput(renderer.domElement);
    opened = true;
    unsubscribeAppearance = window.GameState?.onChange?.(syncAppearance) || null;
    renderNow();                      /* host is visible NOW: paint frame 0 */
    startLoop();
  } catch (e) {
    opened = false;
    stopLoop();
    if (unwireInput) { unwireInput(); unwireInput = null; }
    if (unsubscribeAppearance) { unsubscribeAppearance(); unsubscribeAppearance = null; }
    if (clothes) { clothes.dispose(); clothes = null; }
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (character) { character.dispose(); character = null; }
    if (renderer) {
      try { renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); }
      catch (e2) { /* teardown best-effort */ }
      renderer = null;
    }
    if (hostEl) { hostEl.remove(); hostEl = null; }
    scene = camera = null;
    supportedFlag = false;
    return false;
  }
  /* success: reveal the overlay ourselves (same .hidden utility the
     beach scene uses) and move focus to Back, exactly like the beach
     shell does — the click wiring only ever needs close(). The read
     button joins the top chrome here (hidden again on close()). */
  if (overlay) overlay.classList.remove("hidden");
  wireReadButton();
  showReadButton(true);
  focusFirst();
  return true;
}

function close() {
  if (!opened) return;
  opened = false;
  charReady = false;
  /* Bookshelf seam: peel any open shelf first (BooksUI.close() hands
     focus back to the read button), then hide that button too. */
  if (window.BooksUI && window.BooksUI.isOpen && window.BooksUI.isOpen()) window.BooksUI.close();
  showReadButton(false);
  stopLoop();                                    /* task 3: cancel rAF */
  if (unwireInput) { unwireInput(); unwireInput = null; }
  if (unsubscribeAppearance) { unsubscribeAppearance(); unsubscribeAppearance = null; }
  if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
  if (clothes) { clothes.dispose(); clothes = null; }
  if (character) {
    /* Back clicked mid-GLB-load: character3d's mixer guard can throw
       before its model child exists — never let teardown die half-done
       (the renderer + host below must always go). */
    try { character.dispose(); } catch (e) { /* already gone */ }
    character = null;
  }
  if (scene) {
    /* deep-dispose geometries/materials; canvas textures are disposed
       explicitly (world.js skips isCanvasTexture because it reuses them
       across visits — we own ours, one context per visit) */
    scene.traverse((o) => {
      if (o.isMesh || o.isSprite || o.isPoints) {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.map) m.map.dispose();
          if (m.alphaMap) m.alphaMap.dispose();
          m.dispose();
        }
      }
    });
    if (scene.background && scene.background.isTexture) scene.background.dispose();
    scene.clear();
    scene = null;
  }
  globe = null;                                  /* task 5: furniture refs go with it */
  libObstacles = [];
  occluders = [];                                /* task 6: per-visit fade roster */
  stuckT = 0; stuckAX = null; stuckAZ = 0;
  camPose = null; camGlide = 0;                  /* QA: inspection orbit dies too */
  if (renderer) {
    renderer.dispose();
    /* This renderer never returns: permanent context loss, beach3d policy. */
    renderer.forceContextLoss();
    renderer.domElement.remove();
    renderer = null;
  }
  camera = null;
  if (hostEl) { hostEl.remove(); hostEl = null; }
}

/* ---------- self-contained wiring (there is no library shell file;
   this module owns its overlay like js/beach.js owns the beach's) ---- */

function hideOverlay() {
  const overlay = overlayOf(null);
  if (overlay) overlay.classList.add("hidden");
}

function init() {
  const closeBtn = document.getElementById("library-close");
  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      /* Bookshelf first: Back peels shelf → library → map, one
         level at a time (BooksUI seam — see wireReadButton above). */
      if (window.BooksUI && window.BooksUI.handleBack()) return;
      close();
      hideOverlay();
      focusMap();
    });
  }
  document.addEventListener("keydown", (event) => {
    if (opened && (event.key === "Escape" || event.key === "Esc")) {
      if (window.BooksUI && window.BooksUI.handleBack()) return;
      close();
      hideOverlay();
      focusMap();
    }
  });
  wireReadButton();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

/* ---------- public surface (mirrors window.Beach3D) ----------------- */

window.LibraryScene = {
  open, close, isOpen: () => opened, supported, reducedMotion, syncAppearance
};

/* ---------- test hook (Playwright) ---------------------------------- */

window.__library3d = {
  state: () => opened && {
    opened,
    loop: loopId !== null,
    charReady,
    camera: camera ? [+camera.position.x.toFixed(3), +camera.position.y.toFixed(3),
      +camera.position.z.toFixed(3), +camera.fov.toFixed(2)] : null,
    character: character ? (() => {
      const a = character.getAnchor();
      const t = character.loco.target;
      return {
        x: +a.x.toFixed(3), z: +a.z.toFixed(3), yaw: +character.loco.yaw.toFixed(3),
        moving: character.isMoving(),
        stance: character.stanceName(),
        target: t ? { x: +t.x.toFixed(3), z: +t.z.toFixed(3) } : null
      };
    })() : null,
    renderScheduled,
    /* QA: draw-frame counter — freeze proof that the loop stopped */
    frame: renderer ? renderer.info.render.frame : 0
  },
  clothesState: () => (clothes ? clothes.state() : null),
  appearance: () => (character ? character.appearance() : null),
  /* QA: the beach foam splat must never render in the dry library */
  foamVisible: () => {
    const f = character && character.root.getObjectByName("foamRing");
    return f ? f.visible : null;
  },
  syncAppearance,
  render: renderNow,
  /* QA: keep this handle across close() — the retired renderer's
     info.render.frame must stop advancing (the loop is its only driver) */
  rendererRef: () => renderer,
  /* QA (fit-refit): scene handle for world-space garment/skin bbox
     probes — same spirit as rendererRef, read-only inspection. */
  sceneRef: () => scene,
  /* QA (fix-2): camera handle for ray-through-pixel object IDs. */
  cameraRef: () => camera,
  waitReady: () => (character ? character.ready : Promise.resolve(false)),
  /* QA: programmatic walk (same clamped setTarget path the pointer uses) */
  setTarget: (x, z) => !!(character && charReady && character.setTarget(x, z, "program")),
  /* QA: last-frame draw-call + triangle budget (task 4 perf gate) */
  perf: () => (renderer ? {
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles
  } : null),
  /* QA / task 5: ceiling lamp anchors the pendant fixtures must reuse */
  lampAnchors: () => LAMP_ANCHORS.map(([x, y, z]) => ({ x, y, z })),
  /* QA / task 5: collision discs (beach format) + globe spin readout */
  obstaclesList: () => libObstacles.map((o) => ({ ...o })),
  globeSpin: () => (globe ? +globe.rotation.y.toFixed(4) : null),
  /* QA / task 6: live fade roster — per registered occluder piece, the
     own-material opacity + transparent flag the frame loop is easing */
  occluderFade: () => occluders.map((o) => ({
    name: o.name,
    opacity: +o.mat.opacity.toFixed(3),
    transparent: !!o.mat.transparent,
    half: [+o.h.x.toFixed(3), +o.h.y.toFixed(3), +o.h.z.toFixed(3)]
  })),
  /* QA / camPose: PM inspection orbit. setCamPose keeps the rAF loop
     (walk + all animation) running but replaces the follow-camera step
     with an orbit placed from her LIVE loco anchor each frame —
     position (x + d·sin az, max(0.3, d·sin el), z + d·cos az), look-at
     (x, lookY, z). clearCamPose hands back to the follow camera,
     re-synced so it glides back instead of snapping. Both no-op (false)
     outside a ready open visit. occluderFade keeps easing through the
     pose camera — same loop, same line maths. */
  setCamPose,
  clearCamPose,
  camPoseState: () => (camPose ? { ...camPose, glide: +camGlide.toFixed(2) } : null),
  /* QA: live animation phase — poll to catch stride poses mid-walk.
     t = seconds into the weighted clip (mixer-local), moving = loco
     moving flag, poseName = the clip name driving the mixer right now
     (Idle / Walk / Swim / … or a one-shot like Cheer). */
  walkPhase: () => (opened && character ? {
    t: +character.currentClipTime().toFixed(3),
    moving: character.isMoving(),
    poseName: character.currentClipName()
  } : null),
  /* QA framing: world floor point (x, 0, z) → PAGE CSS px for page.mouse.
     Inverse of wireInput's toFloor(): NDC from the live camera matrix,
     then the canvas rect — so a click at these pixels raycasts back to
     (x, 0, z) on the walk plane. */
  screenPointFor(x, z) {
    if (!camera || !renderer || !Number.isFinite(x) || !Number.isFinite(z)) return null;
    camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, 0, z).project(camera);
    const r = renderer.domElement.getBoundingClientRect();
    return {
      x: r.left + (v.x * 0.5 + 0.5) * r.width,
      y: r.top + (1 - (v.y * 0.5 + 0.5)) * r.height,
      behind: v.z > 1
    };
  }
};
