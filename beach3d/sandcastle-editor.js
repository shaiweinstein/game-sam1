/* ============================================================
   beach3d/sandcastle-editor.js — sand-castle builder session
   (tasks 4/5 skeleton; task 6: field → MarchingCubes mesh and
    pointer sculpting with a cursor ring; task 7: undo/redo +
    smooth/flatten brushes + template/reset/onChange seams; task 8:
    tap-to-commit stamps + decor records (flag/shell/seaweed) as
    tiny shared-geometry meshes rebuilt from the record array;
    task 9: module-level buildBakedGeometry()/buildDecorMeshes()/
    bakeMaterial() helpers the beach bake reuses — same mapping,
    same shapes, no drift;
    pile-fix 2026-09-18: pile/carve deposits seat on the plot GROUND
    footprint (the mesh-following raycast made drags climb their own
    surface into ~1 m arms), the brush got a dome falloff, and a
    renderFrame hold-repeat + path-interpolated domes make deposition
    even and bounded — see the pile-fix comments at the constants,
    applyAtFootprint()/applyPath() and renderFrame().
    POUR MODEL 2026-09-18 (round 3): the ellipsoid-seat pile path is gone —
    every pile application is a column-wise cone-of-repose pour
    (field.pourCone: material only ever lands ON the local surfaceY, the
    Gauss-Seidel angle-of-repose cap forbids any slope steeper than ~37°),
    so piling reads as pouring: banks follow the ground, mounds grow up
    AND out, tower caps still build — see the constants block + field module.)

   Owns the builder's private THREE.Scene + camera + OrbitControls.
   It renders through the beach's single WebGLRenderer (one context,
   one canvas — plan §5); the main beach scene and camera are never
   touched while a session is open, so there is nothing to restore.

   world.js exports sandY() as a module function (character3d imports
   it the same way), but its gradientMap() / makeSkyTexture() are
   module-private — the two tiny helpers below replicate them. Keep
   them in sync with world.js if the toon ramp or sky ever changes.

   ------------------------------------------------------------------
   MarchingCubes mapping (task 6 decision, source-verified against the
   vendored r170 file):

   • The addon never polygonizes the outer cell layer: update() loops
     cube roots x/y,z ∈ [1, size-3] (smin2 = size-2), so a surface
     crossing between samples k/k+1 is only drawn when a cube root sits
     at k, i.e. for crossings between samples 1…size-2.
   • That means our data must keep MC samples 0, 1 and size-2, size-1
     air: crossing (0,1) happens iff sample 1 is solid and needs root 0
     (never looped); crossing (size-2,size-1) happens iff sample size-2
     is solid and needs root size-2 (never looped).
     • Our grid cell (x,y,z) therefore maps to MC sample (x+2,y+2,z+2)
       with MC resolution N+4 (100 at N=96): data occupies samples
      2..N+1 and the outer 2+2 stay air, and every data/air boundary
      crossing lands on a looped root. (The earlier plan idea of
      resolution N+2 with a +1 offset does NOT hold up: data at samples
      1..N would leave the (0,1) and (N,N+1) crossings undrawn — open
      skins whenever solid touches our grid boundary, e.g. piles near
      the plot rim.)
    • Field values are our raw byte densities (0..255); isolation 80 →
      SOLID=160 sits well above the threshold, air 0 well below. The
      surface lands between an air sample (0) and a solid sample (255)
      at 80/255 ≈ 0.31 cell from the air side — ≈ 0.19 cell (~0.7 cm at
      the N=64 cell). Invisible at our scale.
   • normal_cache staleness: reset() (r170, "wipe the normal cache")
     zeroes field, palette and ONLY the X component of each cached
     normal triple — which is exactly the sentinel compNorm() checks
     (`normal_cache[q3] === 0.0`). So after every reset() all
     subsequently polygonized cells recompute their full normal from
     the freshly refilled field; stale Y/Z components are never read
     before compNorm overwrites them. Verified in source: the standard
     reset() → refill → update() cycle needs NO extra cache wipe.
    • Poly budget: MC_MAX_TRIS = 100000 triangles (see the constant — at
      N=64 a fully-featured keep ≈ 21k, fort ≈ 21k; a dense hand-sculpted
      castle approaches 40k). Still ONE mesh so the beach draw-call budget
      is unaffected. At N=32 the old 30k cap was ample; at 4× the surface
      detail it would silently truncate.

     Local→world algebra (cell k's center sits at sample k+MC_OFF):
       local(sample s) = 2s/MC_SIZE − 1;  adjacent samples = 2/MC_SIZE
       mesh.scale      = CELL / (2/MC_SIZE)  (= 1.16875 at N=64, where
                         CELL = PLOT.size/N = 2.2/64 = 0.034375 m)
       our cell 0 center: local L0 = 2·MC_OFF/MC_SIZE − 1
                          L0·scale = −PLOT.size/2 exactly
       position.axis    = meters(cell 0 center) − L0·scale
         x/z: (PLOT.axis − PLOT.size/2 + CELL/2) + PLOT.size/2
            = PLOT.axis + CELL/2
         y:   VISUAL PASS 2026-09-18 — the whole mesh SINKS MC_SINK cells
              below the plot plane (row-0 bottom edge = planeY − MC_SINK·CELL):
              position.y = planeY + PLOT.size/2 + CELL/2 − MC_SINK·CELL.
              The first BASE_ROWS−1 rows are the field module's wide buried
              root and the rim row its rounded mound skirt (see fillBase);
              sinking buries ALL of them under the ground mat/sand, so what
              the player sees is structures (rows ≥ BASE_ROWS, whose bottom
              now straddles the plane) emerging directly from the sand —
              never a slab edge, never a floating bottom shell. Row y's top
              surface therefore sits at planeY + (y + 1 − MC_SINK)·CELL −
              ≈0.19·CELL — and every decor record stores exactly that
              (row + 1 − MC_SINK)·CELL height at placement time so
              decorations stay welded to the surface they were placed on.
              The beach bake applies the exact same sink inside
              buildBakedGeometry's freeze transform, so the baked castle
              buries into the real beach sand identically.
    ------------------------------------------------------------------ */

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { sandY, blobShadowTexture } from "./world.js";
import {
  N, SOLID, MAX_Y, STAMPS, CELL, PLOT_SIZE, BASE_ROWS,
  createField, pourCone, carveBrush, smoothBrush, flattenBrush,
  stampAt, smoothForRender, smoothForRenderInto,
  transferToMc, invalidateMcNormals, brushDirtyBox, pourDirtyBox,
  encode, decode,
  applyTemplate as templateFill, clearField, countSolid, surfaceY,
  snapshot, restore
} from "./sandcastle-field.js";

/* Plot geometry (plan §11 — fixed; sandcastle3d.js imports this).
   RESOLUTION PASS 2026-09-18: size comes from the field module (PLOT_SIZE)
   so the physical plot is the single source of truth and CELL = size/N
   stays consistent with every metre↔cell conversion in the field module. */
export const PLOT = { x: -3.9, z: 1.9, size: PLOT_SIZE };

/* Default builder camera pose (plan: plot surface sits ~0.2 high). */
const CAM_POS = [-3.9, 2.6, 4.4];
const CAM_TARGET = [-3.9, 0.35, 1.9];

/* --- task 6 constants (see the mapping note above) -----------------
    RESOLUTION PASSES 2026-09-18: everything DERIVES from the field module's
    N (pass 2 benches at 96 — cell ≈ 2.3 cm) or is declared in METRES and
    converted with m2cf/m2ci below, so the physical look survives any future
    resolution change. */
const MC_SIZE = N + 4;              /* resolution; our grid at +2 offset (100 @N=96) */
const MC_OFF = 2;
const MC_ISOLATION = 80;
/* MEASURED worst case at N=96 (resolution pass 2, MarchingCubes-node on
   the headless rig's JS engine): keep 51 940 tris, fort 48 256, and a
   maximally sculpted keep+40-pours+8-towers field 110 104. Cap = 160 000
   ≥ measured worst × 1.4 headroom; buffer memory = 160k × 9 floats × 2
   buffers (position+normal) ≈ 11.5 MB per instance (≤ ~15 MB budget).
   Exceeding it truncates geometry — rebuildMesh warns explicitly (the
   addon also warns in update()). */
const MC_MAX_TRIS = 160000;
/* Local CELL is the field module's (PLOT.size / N) — imported above. */
const MC_SCALE = CELL * MC_SIZE / 2;/* meters per MC local unit */
/* Visual pass 2026-09-18 (A): the whole MC mesh — live AND baked — sinks
   the field module's foundation rows (buried root + mound skirt) below
   the sand line; structures (rows ≥ BASE_ROWS) emerge from the sand
   instead of standing on a bright slab. BASE_ROWS scales with N so the
   buried physical depth (0.1375 m) is constant. */
const MC_SINK = BASE_ROWS;

/* Physical sizing (metres = the value that cell count had at the reference
   N=32) → runtime cells: m2cf keeps fractions (radii, growth, gates),
   m2ci rounds to whole cells for counts/offsets. */
const m2cf = (m) => (m * N) / PLOT.size;
const m2ci = (m) => Math.max(1, Math.round(m2cf(m)));
const REF_CELL = 2.2 / 32;                     /* m per reference cell */
const ref = (c32) => c32 * REF_CELL;           /* old-cell count → metres */

/* POUR MODEL (pile physics redesign 2026-09-18, round 3). The pile tool no
   longer seats ellipsoid domes in the air (PILE_OVER let each dome ride the
   previous one's summit — one fast drag chained into a 40° ski-jump ramp of
   ~7200 voxels). Instead every application is field.pourCone(): a shallow
   cone of repose written STRICTLY column-wise from each column's surfaceY
   up (support invariant: solid is only ever added ON TOP of solid — ground,
   earlier sand, or a tower cap) and Gauss-Seidel relaxed so no column ends
   more than tan(37°) rows above its neighbours — repeated pours grow a
   mound UP AND OUT together, and no sequence can chain a steeper slope.
   Footprint (x,z) stays ground-plane-locked (groundFootprint), so a drag
   lays a low bank ALONG THE GROUND. Rates: one tap = a ~4-6 cm scoop;
   a hold saturates at PILE_MAX_STACK domes ≈ a tidy ~15-25 cm mound in
   ~0.6-0.8 s; a fast diagonal drag totals a few hundred voxels (measured
   ~250-500 vs the old 7200) — a sand bank, never a ski jump. All sizes in
   metres → runtime cells via m2cf; the physics constants live with
   pourCone in sandcastle-field.js (POUR_REPOSE_DEG re-exported there). */
const BRUSH_R = m2cf(0.17875);        /* 2.6 cells ≈ 18 cm — carve only now */
const POUR_R0 = m2cf(0.115);          /* first pour's base radius ≈ 11.5 cm
                                          (tap ~14 cm base per spec; the
                                          repose clamping — not the radius —
                                          caps the height) */
const POUR_GROW = m2cf(0.028);        /* radius gain per stacked pour (≈0.8 cell) */
const POUR_R_MAX = m2cf(0.34);        /* ≈ 34 cm — max pour footprint (the
                                          repose cone's base: r_end·0.75 sets
                                          the saturating mound height ≈ 0.2 m) */
const POUR_PEAK = m2cf(0.038);        /* ≈ 1.1 rows: repeat pour adds ~1 row
                                          at the centre — holds climb one
                                          row per PILE_RATE_MS beat */
const POUR_PEAK_TAP = m2cf(0.06);     /* ≈ 1.7 rows → 2: a gesture's first
                                          pour is instantly visible past the
                                          MC isolation (80) + countSolid */
const PILE_RATE_MS = 75;              /* hold-repeat cadence (spec 60-75 ms) */
const PILE_MAX_STACK = 10;            /* pours per gesture per STACK_NEAR-cell
                                          neighbourhood (rate-independent):
                                          saturates a hold at the repose cone
                                          (~0.2 m) — no spire, no ramp, at any
                                          pointer/frame event rate */
const PATH_MIN_MS = 40;               /* min gap between path-dome bursts */
const PATH_STEP = m2cf(ref(0.9));     /* distance between domes along a fast drag */
const CARVE_DELTA = Math.round(SOLID * 0.35);
const REBUILD_MS = 80;              /* drag rebuild throttle */
/* Task 7/8: full tool set. Stamps + decor commit ONCE on pointerDOWN
   (commitTap); pile/carve/smooth/flatten paint through applyTool(). */
const DECOR_KINDS = ["flag", "shell", "seaweed"];
const DECOR_MAX = 12;               /* plan §4: decor stays a small list */
const DECOR_SINK = 0.012;           /* m sunk below the row top — nothing floats */
const STAMP_MARGIN = m2ci(ref(4));  /* anchors this many cells (0.275 m)
                                       inside the plot bounds */
const TOOLS = ["pile", "carve", "smooth", "flatten"]
  .concat(STAMPS, DECOR_KINDS);
const SOFT_R = m2cf(ref(2.5));      /* smooth/flatten brush radius (0.172 m) */
const UNDO_MAX = 25;   /* plan §6. At N=96 snapshots are compact-RLE strings
                          (typically 5–50 KB, worst measured sculpt ≈ 47 KB)
                          → full 25-deep history < 1.2 MB, vs ~22 MB raw. */
/* Pile-fix anti-runaway neighbourhood: dome centers within ±2 cells @32
   (0.1375 m) of a column all count against PILE_MAX_STACK for it. */
const STACK_NEAR = m2ci(ref(2));
/* Pointer-motion gates in cells @32 → runtime cells: 1 cell for pile path
   moves, 0.5 cell for mesh-following smooth/flatten strokes. */
const MOVE_MIN = m2cf(ref(1));
const HOVER_MIN = m2cf(ref(0.5));
/* Plane-fallback acceptance margin: a click far outside the plot
   (pointing at the sea) must not pile sand at the rim. */
const PLANE_MARGIN = 0.5;

/* ============================================================
   VISUAL PASS 2026-09-18 — B (form reads) / E (beach ground).

   The builder used to COPY the beach stage's lighting (ambient 0.65 +
   directional 1.7) and the shared 4-step ramp whose top steps are all
   near-white. With a ~0.9-bright sand albedo every face then summed
   past 1.0 and clipped: castle, slab and ground all landed on the
   brightest toon band → flat mono-tan, no form from any angle. The
   values below deliberately break from the stage copy — lower ambient,
   a strong sun raised off the horizon so top/side/back faces occupy
   DIFFERENT ramp bands, and a ramp whose darkest step actually darkens:
     ramp ≈ [0.44, 0.64, 0.84, 1.0]  (was [0.58, 0.71, 0.86, 1.0])
     top face ≈ band 3, lit sides band 2, shade sides 1, backs 0.
   Colours separate silhouette vs ground: packed warm sand
   (0xe7c68a) on cool-wet sand (0xd4b47e).
   ============================================================ */
const CASTLE_COLOR = 0xf3d99e;     /* warm LIGHT packed sand — resolution
                                       pass 2026-09-18: lifted + warmed vs
                                       the old 0xe7c68a so castle/pile
                                       silhouettes pop off the mat (the
                                       ramp keeps the bands tasteful) */
const GROUND_COLOR = 0xd0a76b;     /* darker, cooler wet sand (was
                                       0xdfbc86) — widens the value gap to
                                       CASTLE_COLOR without going garish */
const MARK_COLOR = 0xb18d57;       /* faint plot ring on the mat */
const WET_RING_COLOR = 0x000000;   /* subtle wet-sand shade just beyond the
                                       plot ring (pass E light touch-up) */
const WET_RING_OP = 0.06;
const AMBIENT_I = 0.5;            /* was 0.65 — high enough to wash every
                                      band, low enough to keep side faces
                                      tinted (beach stage uses 0.65) */
const HEMI_SKY = 0xcfe8ff, HEMI_GROUND = 0xb98f5a, HEMI_I = 0.3;
const SUN_I = 1.7;                 /* ≥ beach-stage punch — the one light
                                      that MUST differ face-to-face */
const SUN_POS = [2.0, 3.2, 2.0];   /* ~50° elevation from the SE: top on
                                      ramp band 3, the default cam's south
                                      face on band 2, opposite faces 1/0 —
                                      the low-angle form read we need */
const GROUND_SIZE = 16;            /* m — a beach, not a 2.2 m floating card */
const FOG_COLOR = 0xf2e6cf, FOG_NEAR = 10, FOG_FAR = 26;
const SHADOW_R = 1.18, SHADOW_OP = 0.4;   /* castle contact shadow disc */

/* QA camera presets (visual pass): deterministic side views so quality
   is judged from where the problems actually show. az = azimuth around
   the target (+z = 0, east positive), pol = polar from +y (1.4 ≈ near
   horizon; OrbitControls caps at 1.45), dist = orbit radius (m). */
const CAM_VIEWS = {
  low:    { az: 0.06, pol: 1.40, dist: 2.6 },
  corner: { az: 0.85, pol: 1.12, dist: 3.0 }
};

/* ============================================================
   Module-level decor factory + bake helpers (task 9).

   The tiny flag/shell/seaweed shapes moved here from inside
   createSandcastleEditor so the BAKED beach castle can rebuild the
   exact same meshes from the decor records — one factory, no drift
   between the builder view and the bake. The session still caches
   one assets bundle per open (build → dispose on close); every
   buildDecorMeshes(decor) call builds its own fresh bundle, which
   the caller disposes with the rest of the bake root.

   bakeGradientMap() is a THIRD replica of the world.js 4-step ramp
   (world.js module cache + the per-session replica below). Unlike
   the session copy it is never disposed: baked materials keep
   referencing it for the whole beach visit (a 4×1 DataTexture).
   ============================================================ */

let _bakeGradient = null;
function bakeGradientMap() {
  if (_bakeGradient) return _bakeGradient;
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
  _bakeGradient = t;
  return t;
}

/* VISUAL PASS B: the castle's OWN 4-step ramp, shared by the live
   builder mesh and the baked beach mesh so both read identically. The
   world ramp's floor step (0.58) barely separated the bands once the
   bright sand albedo was multiplied in; this floor (0.44) plus the
   rebalanced builder lighting puts top/side/shade faces on visibly
   different steps. Never disposed (module-shared, like _bakeGradient). */
const CASTLE_RAMP = new Uint8Array([
  112, 112, 112, 255,
  163, 163, 163, 255,
  214, 214, 214, 255,
  255, 255, 255, 255
]);
let _castleGradient = null;
function castleGradientMap() {
  if (_castleGradient) return _castleGradient;
  const t = new THREE.DataTexture(CASTLE_RAMP, 4, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  _castleGradient = t;
  return t;
}

/* One bundle of shared tiny geometries + toon materials (shapes and
   colors identical to the task 8 session set). */
function buildDecorAssets(grad) {
  const mat = (color, extra = {}) =>
    new THREE.MeshToonMaterial({ color, gradientMap: grad, ...extra });
  /* flag: pole (base at origin) + right-triangle pennant via
     ShapeGeometry (XY plane, double-sided). */
  const poleGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.42, 8);
  poleGeo.translate(0, 0.21, 0);
  const tri = new THREE.Shape();
  tri.moveTo(0, 0);
  tri.lineTo(0.16, 0.055);
  tri.lineTo(0, 0.11);
  tri.closePath();
  const flagGeo = new THREE.ShapeGeometry(tri);
  /* shell: squashed sphere laid flat on the ground. */
  const shellGeo = new THREE.SphereGeometry(0.09, 14, 10);
  shellGeo.scale(1, 0.55, 0.9);
  /* seaweed: three thin stems fanned from a shared base at y=0. */
  const weedGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6);
  weedGeo.translate(0, 0.15, 0);
  return {
    poleGeo, flagGeo, shellGeo, weedGeo,
    poleMat: mat(0xf5f0e6),
    flagMat: mat(0xd94f4f, { side: THREE.DoubleSide }),
    shellMat: mat(0xf2d7c4),
    weedMat: mat(0x5fa05f)
  };
}

function disposeDecorAssets(a) {
  if (!a) return;
  for (const k of Object.keys(a)) {
    if (a[k] && typeof a[k].dispose === "function") a[k].dispose();
  }
}

/* Record → mesh; contact point modeled at the local origin, so
   placement is one position.set from the record. */
function makeDecorMesh(kind, a) {
  if (kind === "flag") {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(a.poleGeo, a.poleMat));
    const flag = new THREE.Mesh(a.flagGeo, a.flagMat);
    flag.position.set(0.012, 0.31, 0);   /* vertical edge hugs the pole */
    g.add(flag);
    return g;
  }
  if (kind === "shell") {
    const m = new THREE.Mesh(a.shellGeo, a.shellMat);
    m.rotation.y = 0.7;                  /* deterministic lay-flat tilt */
    return m;
  }
  if (kind === "seaweed") {
    const g = new THREE.Group();
    const stems = [
      [0.02, -0.01, 0.30, 0.0, 0.06],
      [-0.03, 0.0, -0.24, 0.5, -0.05],
      [0.01, 0.03, 0.06, -0.6, -0.30]
    ];                                  /* [x, z, rotX, rotY, rotZ] */
    for (const [sx, sz, rx, ry, rz] of stems) {
      const s = new THREE.Mesh(a.weedGeo, a.weedMat);
      s.position.set(sx, 0, sz);
      s.rotation.set(rx, ry, rz);
      g.add(s);
    }
    return g;
  }
  return null;
}

/* BAKE: rebuild the decor records as meshes in PLOT-LOCAL meters —
   origin at the plot center ON the sand plane, so the caller plants
   the returned group inside a root positioned at
   (PLOT.x, sandY(PLOT.x, PLOT.z), PLOT.z) and everything lands at the
   exact world spot the builder session showed (session decorWorld()
   = these offsets + planeY; identical numbers). The caller owns
   disposal (traverse the root with the rest of the bake).

   RESOLUTION PASS: records are stored IN METRES ({ t, x, y, z } —
   commitTap converts cell+row to the plot-local centre / row-top height,
   sandcastle3d.loadSaved migrates old cell-int records), so decor survives
   any resolution change without reinterpretation. DECOR_SINK still buries
   the contact a hair below the recorded surface. */
export function buildDecorMeshes(decor) {
  const group = new THREE.Group();
  if (!Array.isArray(decor)) return group;
  const usable = decor.filter((d) => d && DECOR_KINDS.includes(d.t) &&
    [d.x, d.y, d.z].every(Number.isFinite));
  if (!usable.length) return group;
  const a = buildDecorAssets(bakeGradientMap());
  for (const d of usable) {
    const m = makeDecorMesh(d.t, a);
    if (!m) continue;
    m.position.set(d.x, d.y - DECOR_SINK, d.z);
    group.add(m);
  }
  if (!group.children.length) disposeDecorAssets(a);
  return group;
}

/* BAKE: run the SAME MarchingCubes conversion as the live session
   (resolution N+4, isolation 80, +2 sample offset, smoothForRender
   pre-pass — see the mapping note at the top) and freeze the result
   into a compact BufferGeometry in PLOT-LOCAL meters with normals:

     castleLocal = offset + MC_SCALE · local(sample)
       offset.x/z = CELL/2        (cell 0 center: plot corner + CELL/2)
       offset.y   = PLOT.size/2 + CELL/2 − MC_SINK·CELL
                    (row-0 bottom edge MC_SINK cells UNDER the sand plane
                     — the beach bake then buries the foundation root +
                     mound skirt exactly like the builder sinks them under
                     its ground mat, so no beige box floats on the sand)

   VISUAL PASS C/B extras: the density goes through smoothForRender
   (closes pits / evens lumps before polygonizing), and the frozen
   geometry gets vertex colours — a gentle darker→wet tint toward the
   base (fake AO / wet-sand line). The bake geometry is one-shot, so
   this is cheap and never touches the live rebuild path's cost.

   The caller adds the geometry to a mesh/group positioned at
   (PLOT.x, sandY(PLOT.x, PLOT.z), PLOT.z), which reproduces the
   builder mesh's world transform (mc.position − plotCenter +
   MC_SCALE·local). Returns null for an empty conversion (no solid
   vertices at all). */
export function buildBakedGeometry(field) {
  if (!field || field.length !== N * N * N) return null;
  const dummy = new THREE.MeshBasicMaterial();
  const mc = new MarchingCubes(MC_SIZE, dummy, false, false, MC_MAX_TRIS);
  mc.isolation = MC_ISOLATION;
  mc.reset();                    /* zeroes field + invalidates normals */
  const src = smoothForRender(field);   /* render-only smoothing (C) */
  /* Same transfer the incremental editor uses — full-grid here, one code
     path for both, so the bake can never drift from the live mesh. */
  transferToMc(src, mc.field, MC_SIZE, MC_OFF, 0, N - 1, 0, N - 1, 0, N - 1);
  mc.update();
  let geo = null;
  if (mc.count > 0) {
    /* Compact slice of the used vertex span (the addon reuses one big
       preallocated buffer; count = live vertex count, drawRange). */
    const g = mc.geometry;
    geo = new THREE.BufferGeometry();
    geo.setAttribute("position",
      new THREE.BufferAttribute(g.getAttribute("position").array.slice(0, mc.count * 3), 3));
    geo.setAttribute("normal",
      new THREE.BufferAttribute(g.getAttribute("normal").array.slice(0, mc.count * 3), 3));
    geo.applyMatrix4(new THREE.Matrix4().makeTranslation(
      CELL / 2, PLOT.size / 2 + CELL / 2 - MC_SINK * CELL, CELL / 2
    ).multiply(new THREE.Matrix4().makeScale(MC_SCALE, MC_SCALE, MC_SCALE)));
    bakeWetLine(geo);
  }
  mc.geometry.dispose();
  dummy.dispose();
  return geo;
}

/* BAKE-only two-tone: darken + slightly cool the vertices toward the
   sand line (y ≈ 0 local), full colour by ~0.55 m up — reads as a wet
   base line / gentle ambient occlusion under the bright toon sun. */
function bakeWetLine(geo) {
  const pos = geo.getAttribute("position");
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, (pos.getY(i) + 0.06) / 0.55));
    const s = 0.66 + 0.34 * t;
    col[i * 3] = s;
    col[i * 3 + 1] = s;
    col[i * 3 + 2] = s + (1 - t) * 0.08;   /* wet sand runs cooler */
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
}

/* BAKE: toon material for the frozen castle mesh — the builder's
   EXACT castle look (CASTLE_COLOR + the custom high-contrast ramp,
   flatShading stays false → smooth addon normals). One fresh material
   per bake; the shared module ramps are never disposed. */
export function bakeMaterial() {
  return new THREE.MeshToonMaterial({
    color: CASTLE_COLOR,
    gradientMap: castleGradientMap(),
    vertexColors: true          /* bakeWetLine colours ride the bake */
  });
}

export function createSandcastleEditor(world, deps = {}) {
  const char = deps.character || null;   /* Lily — kept visible while open */
  let active = false;
  let scene = null, camera = null, controls = null, ro = null;
  let sky = null;   /* this session's sky CanvasTexture — ours to dispose */
  let movedChar = false;   /* her root is parked in this scene */

  let _gradientMap = null;
  function gradientMap() {
    /* world.js gradientMap() replica (4-step toon ramp). */
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

  function makeSkyTexture() {
    /* world.js makeSkyTexture() replica (same stops as the stage sky). */
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

  function resize(w, h) {
    if (!active || !camera || !w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ---- task 6 session state ---------------------------------------- */
  let field = null;          /* Uint8Array(N³) from sandcastle-field.js */
  let mc = null;             /* MarchingCubes mesh (this session) */
  /* INCREMENTAL REBUILD state (resolution pass 2 — at 100³ the full
     reset+refill+update every 75-80 ms is ~90 ms of JS; per-brush-volume
     application keeps steady-state at the brush's own cost):
       renderBuf — the last-applied SMOOTHED field (cell coords), the
                   authoritative mirror of what sits in mc.field (+2).
       dirtyBox  — union bbox of raw-field writes since the last applied
                   state (cell coords), or null = nothing dirty / full done.
       forceFull — set by open/undo/redo/template/reset and at every stroke
                   start: the NEXT rebuild is a full anchor rebuild; between
                   those, rebuilds stay incremental. (Task spec: "Full
                   rebuild stays for open/undo/template/reset + first stroke
                   commit".) */
  let renderBuf = null;
  let dirtyBox = null;
  let forceFull = true;
  let ring = null;           /* brush cursor ring */
  let plotY = 0;             /* plane height for this session */
  let tool = "pile";
  /* Input arbitration: at most one painting pointer; any other pointer
     while one paints (second touch finger) hands the gesture to
     OrbitControls. orbitPtrs covers right-drag/middle/shift-drags and
     touch pinch-rotate so the ring stays out of the way. */
  let paintPtr = null;
  let orbitPtrs = new Set();
  let lastGX = 0, lastGY = 0, lastGZ = 0;   /* last brush application point */
  /* Pile-fix (2026-09-18) anchoring + rate-limit state. The pile/carve
     DEPOSIT footprint comes from the plot ground plane (paintFx/Fz, fixed
     under a still cursor), never from the live mesh: a mesh-following
     raycast re-seated the brush higher every pointermove, so a single
     diagonal drag climbed gy 1.88 → 13.12 (leaning ~0.9 m "arms"). The
     vertical center instead follows the aimed column's own surfaceY. */
  const paintNd = new THREE.Vector2();      /* painting pointer's last NDC pos */
  let paintFx = 0, paintFz = 0;             /* current anchored footprint */
  let paintGroundOk = false;                /* footprint landed on the plot */
  let lastApplyGX = 0, lastApplyGZ = 0;     /* last pile/carve deposit center */
  let lastApplyAt = 0;                      /* time of the last paint apply */
  let pileArmed = false;                    /* gesture's next dome = boosted first */
  /* Pile-fix anti-runaway hard cap: pile domes this gesture per footprint
     column (floor(gz)·N + floor(gx) keys). A still hold or a violent
     same-spot jitter can never stack beyond PILE_MAX_STACK applications —
     a tidy bounded mound regardless of frame/pointer event rate. Cleared
     at stroke start/end/close (one gesture = one budget). */
  let gestureStacks = new Map();
  let lastRebuildAt = 0;
  let lastHit = null;        /* QA diagnostic: { grid, onPlane } of last cast */
  let rebuildMs = 0;         /* EMA of rebuild cost, for state() */
  let rebuildKind = null;    /* QA: "full" | "incr" of the last rebuild */
  /* Task 7: undo/redo (one snapshot per action, never per cell) + the
     per-stroke bookkeeping the snapshot timing needs. Task 8: decor
     records { t, x, y, z } (GRID cell coords, ints) live here, ride
     every snapshot, and render as tiny meshes in decorGroup. */
  let undoStack = [];
  let redoStack = [];
  let decor = [];
  let decorGroup = null;           /* scene group rebuilt from `decor` */
  let decorAssets = null;          /* shared tiny geometries/materials */
  let tapGesture = false;          /* pointerdown committed a tap tool */
  let pulseT = 0;                  /* tap feedback: ring pulse deadline */
  let pendingSnap = null;          /* captured at stroke start, pushed on first write */
  let strokeSnapshotted = false;   /* lazy: captured before first write */
  let strokeChanged = false;
  let flattenPlaneY = null;        /* captured at a flatten stroke's start */
  let changeCb = null;             /* toolbar enablement callback */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const planeHit = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let detachInput = null;

  /* Union a (clamped) cell bbox into the dirty region since the last
     applied state. All field writes in this session flow through paths
     that call this with their footprint box (brushDirtyBox/pourDirtyBox
     mirrors of the field-module write bounds, stamp envelopes); whole-
     field ops go through rebuildFull() instead, which ignores the box. */
  function markDirty(x0, x1, y0, y1, z0, z1) {
    const a = Math.max(0, x0 | 0), b = Math.min(N - 1, x1 | 0);
    const c = Math.max(0, y0 | 0), d = Math.min(N - 1, y1 | 0);
    const e = Math.max(0, z0 | 0), f = Math.min(N - 1, z1 | 0);
    if (a > b || c > d || e > f) return;
    if (!dirtyBox) dirtyBox = { x0: a, x1: b, y0: c, y1: d, z0: e, z1: f };
    else {
      const D = dirtyBox;
      if (a < D.x0) D.x0 = a; if (b > D.x1) D.x1 = b;
      if (c < D.y0) D.y0 = c; if (d > D.y1) D.y1 = d;
      if (e < D.z0) D.z0 = e; if (f > D.z1) D.z1 = f;
    }
  }

  function rebuildMesh(full = false) {
    if (!mc || !field) return;
    if (!full && !forceFull && !dirtyBox) return;   /* nothing to do */
    const t0 = performance.now();
    mc.isolation = MC_ISOLATION;
    const incremental = !full && !forceFull && !!renderBuf && !!dirtyBox;
    if (incremental) {
      /* TARGETED APPLICATION (resolution pass 2). Re-smooth ONLY the dirty
         cells (their smoothing output depends only on raw src 3×3×3 →
         byte-identical to the full pass over the same cells), grow by 1 for
         the smoothing write shadow, transfer those cells into mc.field at
         the +2 sample offset, and zero ONLY the affected normal_cache
         sentinels (cells ∪ face-neighbours — compNorm semantics verified
         against the vendored r170 source). update() re-polygonizes with
         the fresh field + recomputed normals → identical geometry to a
         reset+full-refill of the same field (node-equivalence test pins
         this byte-for-byte). */
      const D = dirtyBox;
      const x0 = D.x0 - 1, x1 = D.x1 + 1, y0 = D.y0 - 1, y1 = D.y1 + 1,
            z0 = D.z0 - 1, z1 = D.z1 + 1;
      smoothForRenderInto(field, renderBuf, x0, x1, y0, y1, z0, z1);
      transferToMc(renderBuf, mc.field, MC_SIZE, MC_OFF, x0, x1, y0, y1, z0, z1);
      invalidateMcNormals(mc.normal_cache, MC_SIZE, MC_OFF, x0, x1, y0, y1, z0, z1);
      dirtyBox = null;
      forceFull = false;
    } else {
      mc.reset();                    /* zeroes field + invalidates normals */
      /* Full path: our grid (index x + N·y + N²·z) into MC samples
         (x+2, y+2, z+2) via the field-module transfer helper (same loop the
         bake uses). VISUAL PASS C: bytes go through smoothForRender first
         (render-only; the raw field stays exactly as sculpted/saved). */
      renderBuf = smoothForRender(field);
      transferToMc(renderBuf, mc.field, MC_SIZE, MC_OFF, 0, N - 1, 0, N - 1, 0, N - 1);
      dirtyBox = null;
      forceFull = false;
    }
    mc.update();
    /* init() ships boundingSphere radius 1 around the origin; our data
       cube corners reach ≈1.54 local. Only used for raycast/frustum
       broad phase — widen it instead of chasing edge misses. */
    mc.geometry.boundingSphere.radius = 2;
    if (mc.count / 3 > MC_MAX_TRIS) {
      /* Silent-truncation guard (the addon's own update() warn is generic;
         this names our knob). */
      console.warn("[sandcastle] MarchingCubes geometry overflow: " +
        Math.round(mc.count / 3) + " tris > cap " + MC_MAX_TRIS +
        " — raise MC_MAX_TRIS in sandcastle-editor.js");
    }
    const ms = performance.now() - t0;
    rebuildMs = rebuildMs ? rebuildMs * 0.7 + ms * 0.3 : ms;
    rebuildKind = incremental ? "incr" : "full";
    lastRebuildAt = performance.now();
  }

  /* ---- task 8: decor --------------------------------------------------
     Tiny flag/shell/seaweed meshes built from the `decor` record array
     ({ t, x, y, z } in PLOT-LOCAL METRES — never written into the density
     field; resolution-pass 2026-09-18 moved them out of cell ints so
     saves survive resolution changes). Task 9: the shapes live in the
     MODULE-LEVEL factory (buildDecorAssets/makeDecorMesh above) so the
     baked beach castle reuses the exact same geometry — the session only
     caches one assets bundle per open and disposes it on close. */

  /* Record → world meters: records store PLOT-LOCAL metres directly
     (commitTap wrote cell centre (cx+0.5)·CELL − size/2 and row-top
     (row+1−MC_SINK)·CELL at placement time — resolution-proof), so the
     session just offsets by the plot center and planeY and buries the
     contact by DECOR_SINK. Mirrored (identically) by buildDecorMeshes
     for the beach bake. */
  function decorWorld(d) {
    return [
      PLOT.x + d.x,
       plotY + d.y - DECOR_SINK,
       PLOT.z + d.z
     ];
   }

  /* Refresh the decor group from the record array — called after every
     commit and every restore (undo/redo/template/reset) and on open. */
  function rebuildDecor() {
    if (!decorGroup) return;
    for (let i = decorGroup.children.length - 1; i >= 0; i--)
      decorGroup.remove(decorGroup.children[i]);
    for (const d of decor) {
      const m = makeDecorMesh(d && d.t, decorAssets);
      if (!m) continue;
      const w = decorWorld(d);
      m.position.set(w[0], w[1], w[2]);
      decorGroup.add(m);
    }
  }

  /* Single seam where the PAINT tools modify the field during a
     stroke. g = fractional cell-index coords (cell k's center = k).
     flatten reads flattenPlaneY (captured per stroke in strokeApply);
     if a caller ever skips that capture the field module clamps
     undefined to plane 1, so worst case it levels toward the base.
     Task 8: stamps + decor do NOT flow through here — they are
     discrete pointerdown commits via commitTap() (drag paints
     nothing for them). */
  function applyTool(gx, gy, gz, rad, pour) {
    if (!field) return false;
    /* INCREMENTAL (resolution pass 2): every successful write registers
       its field-module-mirrored footprint box; the next rebuildMesh(false)
       applies only that union. */
    let changed = false, box = null;
    if (tool === "pile") {
      /* POUR MODEL: the seat params (fractional footprint + rate/stack-capped
         cone size) come pre-computed in `pour` from applyAtFootprint.
         pourCone writes each affected column strictly from its own
         surfaceY upward under a repose-capped cone — material can only
         land ON solid (ground, earlier sand, or a tower cap: buildability
         kept), and the built-in angle-of-repose relaxation makes ANY slope
         above ~37° impossible — the old PILE_OVER floating-ellipsoid chain
         (ski-jump ramps) is structurally gone. */
      if (!pour) return false;
      /* DIRTY BOX BEFORE THE WRITE: pourDirtyBox reads each column's PRE-
         pour surface to tighten its y span; computing it after pourCone
         would read the already-raised surfaces and could MISS the lowest
         newly-written rows when the pour covers its whole patch uniformly. */
      box = pourDirtyBox(gx, gz, pour.r, pour.peak, field);
      changed = pourCone(field, gx, gz, pour.r, pour.peak);
    } else if (tool === "carve") {
      changed = carveBrush(field, gx, gy, gz, BRUSH_R, CARVE_DELTA);
      if (changed) box = brushDirtyBox(gx, gy, gz, BRUSH_R);
    } else if (tool === "smooth") {
      changed = smoothBrush(field, gx, gy, gz, SOFT_R);
      if (changed) box = brushDirtyBox(gx, gy, gz, SOFT_R);
    } else if (tool === "flatten") {
      changed = flattenBrush(field, gx, gy, gz, SOFT_R, flattenPlaneY);
      if (changed) box = brushDirtyBox(gx, gy, gz, SOFT_R);
    }
    if (changed && box) markDirty(box.x0, box.x1, box.y0, box.y1, box.z0, box.z1);
    return changed;
  }

  /* ---- task 7: undo/redo + change notification ---------------------- */

  function notifyChange() {
    if (!changeCb || !field) return;
    changeCb({
      solid: countSolid(field),
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0
    });
  }

  /* Snapshot pushing is inlined at each commit site (stroke first
     write, template fill) because each needs slightly different
     bookkeeping; task 8's stamps/decor add their own one-per-action
     pushes. Every commit also clears the redo branch and respects
     the UNDO_MAX cap. */

  /* Undo/redo at N=96: raw Uint8Array snapshots would cost 0.88 MB each
     (25 × = ~22 MB), so the stacks store the compact RLE form instead —
     encode/decode is byte-exact lossless (node suite pins undo fidelity),
     a typical castle is 5–50 KB, and the whole history stays <1 MB.
     UNDO_MAX 25 (plan §6) now costs memory that is a rounding error. */
  function snapEnc() {
    const s = snapshot(field, decor);          // copies BOTH
    return { enc: encode(s.field), decor: s.decor };
  }

  function snapDecode(s) {
    if (!s || typeof s.enc !== "string") return null;
    const f = decode(s.enc);                   // runtime-size paranoia inside
    if (!f) return null;
    return {
      field: f,
      decor: Array.isArray(s.decor)
        ? s.decor.map((d) => (d && typeof d === "object" ? { ...d } : d))
        : []
    };
  }

  function undo() {
    if (!field || !undoStack.length) return false;
    const cur = snapEnc();
    const s = snapDecode(undoStack.pop());
    if (!s) return false;
    redoStack.push(cur);
    field = s.field;
    decor = s.decor;
    rebuildMesh(true);      /* whole-field restore → full anchor */
    rebuildDecor();     /* restored records re-render (task 8) */
    notifyChange();
    return true;
  }

  function redo() {
    if (!field || !redoStack.length) return false;
    const cur = snapEnc();
    const s = snapDecode(redoStack.pop());
    if (!s) return false;
    undoStack.push(cur);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    field = s.field;
    decor = s.decor;
    rebuildMesh(true);
    rebuildDecor();     /* restored records re-render (task 8) */
    notifyChange();
    return true;
  }

  /* Template fill: one snapshot for the whole action (not per stamp
     cell the field module writes). DECISION (task 8): templates clear
     the FIELD but KEEP decor — presets are ground plans, and a kid's
     collected shells shouldn't vanish when trying a layout. The group
     is still refreshed (records unchanged → same meshes). */
  function applyTemplate(id) {
    if (!field) return false;
    const before = snapEnc();
    if (!templateFill(field, id)) return false;
    undoStack.push(before);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
    rebuildMesh(true);      /* whole-field fill → full anchor */
    rebuildDecor();     /* decor kept — refresh anyway (restore path) */
    notifyChange();
    return true;
  }

  /* Reset = base plinth only, decor gone. Requirement A (task 7): the
     confirmed reset is a point of no return — clearField + rebuild +
     BOTH stacks cleared; the double-press arm in the toolbar is the
     guard, so the pre-reset state is deliberately NOT kept undoable.
     Task 8: reset also clears the decor records (a full clear means
     everything), which task 7 left untouched. */
  function resetField() {
    if (!field) return false;
    clearField(field);
    decor = [];
    undoStack.length = 0;
    redoStack.length = 0;
    rebuildMesh(true);      /* whole-field clear → full anchor */
    rebuildDecor();
    notifyChange();
    return true;
  }

  function onChange(cb) {
    changeCb = typeof cb === "function" ? cb : null;
  }

  /* The first BASE_ROWS are base-only in the field module (sphereBounds
     floors y there), so a brush centered on the bare plane (gy = −0.5)
     reaches no modifiable row at all. Lift plane hits onto the surface so
     piling works on the empty plot: center just above the topmost solid
     row of that column (base mound top = BASE_ROWS−1 → gy = BASE_ROWS−0.5
     → piles start at the first modifiable row).
     (Visual pass note: with the mesh sunk MC_SINK cells, the row above
     the base straddles the plane, so even off-plinth plane piles (the
     foundation rows stay air there) have their bottom skin polygonized
     a hair UNDER the ground mat — covered, no open underside, no floating
     shell.) */
  function liftedGy(gy, gx, gz) {
    const sx = Math.max(0, Math.min(N - 1, Math.floor(gx)));
    const sz = Math.max(0, Math.min(N - 1, Math.floor(gz)));
    return Math.max(gy, surfaceY(field, sx, sz) + 0.5);
  }

  /* Pile-fix A: tools whose DEPOSIT is anchored to the ground footprint
     (see the state block above). smooth/flatten keep the mesh raycast —
     they level what they see and cannot runaway-climb. */
  function isGroundPainer() {
    return tool === "pile" || tool === "carve";
  }

  /* Ray → plot ground plane, clamped inside the plot; null off-plot
     (same PLANE_MARGIN acceptance as the castPointer plane fallback, so
     pointing at the sea deposits nothing). This is the pile/carve
     footprint source: it does NOT move when the sand it builds rises. */
  function groundFootprint(ndcV) {
    if (!camera) return null;
    raycaster.setFromCamera(ndcV, camera);
    groundPlane.constant = -plotY;
    if (!raycaster.ray.intersectPlane(groundPlane, planeHit)) return null;
    const half = PLOT.size / 2;
    if (planeHit.x < PLOT.x - half - PLANE_MARGIN || planeHit.x > PLOT.x + half + PLANE_MARGIN ||
        planeHit.z < PLOT.z - half - PLANE_MARGIN || planeHit.z > PLOT.z + half + PLANE_MARGIN) {
      return null;
    }
    const p = new THREE.Vector3(
      Math.max(PLOT.x - half, Math.min(PLOT.x + half, planeHit.x)),
      plotY,
      Math.max(PLOT.z - half, Math.min(PLOT.z + half, planeHit.z))
    );
    return { p, grid: gridCoords(p) };
  }

  /* Pile-fix A: seat the brush at the aimed column's CURRENT top so new
     sand merges with the mound and grows it upward evenly (never floats,
     never chases the live mesh surface). Rows 0-1 are base-only, hence
     the row-2 floor; MAX_Y caps reach like the field module does. */
  function seatedGy(gx, gz) {
    const sx = Math.max(0, Math.min(N - 1, Math.floor(gx)));
    const sz = Math.max(0, Math.min(N - 1, Math.floor(gz)));
    return Math.max(BASE_ROWS, Math.min(MAX_Y, surfaceY(field, sx, sz) + 0.5));
  }

  /* QA-only tallest-column scan backing state().maxH (see state()). */
  function maxSurfaceH() {
    let m = 0;
    for (let z = 0; z < N; z++)
      for (let x = 0; x < N; x++) {
        const y = surfaceY(field, x, z);
        if (y > m) m = y;
      }
    return m;
  }

  /* world point → fractional cell-index coords:
     meters = regionEdge + (g + 0.5)·CELL  →  g = (m − edge)/CELL − 0.5 */
  function gridCoords(p) {
    return [
      (p.x - (PLOT.x - PLOT.size / 2)) / CELL - 0.5,
      (p.y - plotY) / CELL - 0.5,
      (p.z - (PLOT.z - PLOT.size / 2)) / CELL - 0.5
    ];
  }

  function eventNdc(ev) {
    const r = world.canvas.getBoundingClientRect();
    ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -(((ev.clientY - r.top) / r.height) * 2 - 1);
    return ndc;
  }

  /* Raycast the sculpt mesh; on a miss fall back to the plot plane
     (requirement D) so piling works on the empty plot. SPLIT (pile-fix):
     castNdc works from a stored NDC position so renderFrame's hold-repeat
     can re-cast for smooth/flatten without a live event; castPointer is
     the event wrapper. The MESH hit drives the ring/hover visuals only —
     pile/carve deposits come from groundFootprint instead. */
  function castNdc(ndcV) {
    if (!camera || !mc) return null;
    raycaster.setFromCamera(ndcV, camera);
    const hit = raycaster.intersectObject(mc, false)[0];
    if (hit && hit.face) {
      const n = hit.face.normal.clone().transformDirection(mc.matrixWorld);
      lastHit = { onPlane: false, ny: +n.y.toFixed(2), grid: null };
      const g = gridCoords(hit.point);
      lastHit.grid = [+g[0].toFixed(2), +g[1].toFixed(2), +g[2].toFixed(2)];
      return { p: hit.point, n, grid: g, onPlane: false };
    }
    groundPlane.constant = -plotY;
    if (!raycaster.ray.intersectPlane(groundPlane, planeHit)) return null;
    const half = PLOT.size / 2;
    if (planeHit.x < PLOT.x - half - PLANE_MARGIN || planeHit.x > PLOT.x + half + PLANE_MARGIN ||
        planeHit.z < PLOT.z - half - PLANE_MARGIN || planeHit.z > PLOT.z + half + PLANE_MARGIN) {
      return null;
    }
    const p = new THREE.Vector3(
      Math.max(PLOT.x - half, Math.min(PLOT.x + half, planeHit.x)),
      plotY,
      Math.max(PLOT.z - half, Math.min(PLOT.z + half, planeHit.z))
    );
    lastHit = { onPlane: true, ny: 1, grid: null };
    {
      const g = gridCoords(p);
      lastHit.grid = [+g[0].toFixed(2), +g[1].toFixed(2), +g[2].toFixed(2)];
    }
    return { p, n: new THREE.Vector3(0, 1, 0), grid: gridCoords(p), onPlane: true };
  }

  function castPointer(ev) {
    return castNdc(eventNdc(ev));
  }

  function showRing(hit) {
    ring.position.copy(hit.p).addScaledVector(hit.n, 0.01);
    ring.material.color.set(tool === "carve" ? 0x7a5a3a : 0xffffff);
    ring.visible = true;
  }

  /* ---- task 8: tap-to-commit (stamps + decor) ------------------------- */

  function isTapTool() {
    return STAMPS.includes(tool) || DECOR_KINDS.includes(tool);
  }

  /* ONE pointerdown = ONE commit. Anchor from the fractional grid hit
     exactly as applyTool receives it; stamps root on the CURRENT
     surface via surfaceY (field-module anchor semantics — do not
     reimplement shapes), decor sits ON the surface. The anchor is
     clamped STAMP_MARGIN (0.275 m) inside the plot so shapes stay clear
     of the never-polygonized MC border. One pre-state snapshot per
     commit; a no-op stamp (e.g. against the MAX_Y cap) commits nothing
     and pushes no snapshot. Decor caps at DECOR_MAX by dropping the
     oldest record (undo stays consistent — snapshots carry the full
     list). RESOLUTION PASS: decor records are PLOT-LOCAL METRES (see
     decorWorld) so they survive a future resolution change; stamp radii
     are the physical moat 0.275 m / others 0.206 m, converted to cells. */
  function commitTap(hit) {
    if (!field || !ring) return false;
    const [gx, , gz] = hit.grid;
    const before = snapEnc();               /* PRE-state for the stack */
    let applied = false;
    if (STAMPS.includes(tool)) {
      const lo = STAMP_MARGIN + 1, hi = N - 1 - STAMP_MARGIN;
      let sx = Math.round(gx), sz = Math.round(gz);
      sx = Math.max(lo, Math.min(hi, sx));
      sz = Math.max(lo, Math.min(hi, sz));
      const sy = surfaceY(field, sx, sz);
      const r = tool === "moat" ? m2ci(ref(4)) : m2ci(ref(3));
      applied = stampAt(field, sx, sy, sz, tool, r, 0);   /* orient 0 = x axis */
      /* A discrete commit = its own anchor: full rebuild (cheap per tap;
         no dirty-box bookkeeping needed for stamp footprints, whose
         extents vary per kind — stairs reach ~24 cells along one axis). */
      if (applied) rebuildMesh(true);
    } else {
      /* cell coords stay integers for the surface scan; the RECORD is
         stored in plot-local metres (x/z = cell centre, y = row-top
         height above the sand plane) — the save-safe form. */
      const cx = Math.max(1, Math.min(N - 2, Math.round(gx)));
      const cz = Math.max(1, Math.min(N - 2, Math.round(gz)));
      const row = surfaceY(field, cx, cz);
      decor.push({
        t: tool,
        x: (cx + 0.5) * CELL - PLOT.size / 2,
        y: (row + 1 - MC_SINK) * CELL,
        z: (cz + 0.5) * CELL - PLOT.size / 2
      });
      if (decor.length > DECOR_MAX) decor.shift();
      rebuildDecor();
      applied = true;   /* a decor add always lands (cap drops oldest) */
    }
    if (!applied) return false;
    undoStack.push(before);
    if (undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack.length = 0;
    notifyChange();
    pulseRing(hit);
    return true;
  }

  /* Commit feedback: the cursor ring puffs 1.4× for 150 ms (one-shot,
     then renderFrame hides it — a 150 ms scale pulse, kept even under
     reduced motion: no sustained animation, no camera motion). */
  function pulseRing(hit) {
    ring.position.copy(hit.p).addScaledVector(hit.n, 0.02);
    ring.visible = true;
    pulseT = performance.now() + 150;
  }

  /* Apply the tool at a hit; rebuild throttled to every REBUILD_MS while
     a stroke is live (brush still applies on every qualifying move).
     Task 7 timing: the stroke's ONE undo snapshot is pushed just before
     the first mutating write (a pointerdown that never touches the
     plot — sky click — pollutes nothing); the redo branch clears then.
     Flatten: the leveling plane is the RAW height under the pointer at
     the stroke's first application (plane hits are NOT lifted for the
     plane value — flattening from the floor cuts down — while the
     brush CENTER is still lifted so the brush reaches live rows). */
  function strokeApply(hit) {
    if (isTapTool()) return;   /* stamps/decor commit only in commitTap */
    const rawGy = hit.grid[1];
    /* POUR MODEL: pile hits carry `pour` (cone params) and have NO vertical
       component at all — pourCone seats every column on its own surfaceY,
       so the generic plane lift must not invent a gy for them. carve hits
       still seat through seatedGy/liftedGy exactly as before. */
    const gy = hit.onPlane && !hit.seated && !hit.pour
      ? liftedGy(rawGy, hit.grid[0], hit.grid[2]) : rawGy;
    if (tool === "flatten" && flattenPlaneY === null) {
      flattenPlaneY = Math.max(1, Math.min(MAX_Y, Math.round(rawGy)));
    }
    /* Capture pre-stroke state once; commit it to the stack only when
       a write actually lands (a carve drag over bare plinth air must
       not leave a no-op undo entry). Tap tools never reach here. */
    if (!strokeSnapshotted) {
      pendingSnap = snapEnc();
      strokeSnapshotted = true;
    }
    if (applyTool(hit.grid[0], gy, hit.grid[2], hit.rad, hit.pour)) {
      if (pendingSnap) {
        undoStack.push(pendingSnap);
        if (undoStack.length > UNDO_MAX) undoStack.shift();
        redoStack.length = 0;
        pendingSnap = null;
      }
      strokeChanged = true;
      if (performance.now() - lastRebuildAt >= REBUILD_MS) rebuildMesh();
    }
    lastGX = hit.grid[0]; lastGY = gy; lastGZ = hit.grid[2];
  }

  /* POUR MODEL: one scoop at the ground-anchored footprint. NO vertical
     anchor exists for the pile tool at all — pourCone re-reads each
     column's own surfaceY internally (a still hold stacks in place,
     bounded by PILE_RATE_MS + PILE_MAX_STACK; a drag lays ground-hugging
     cones along the path; a tower cap pours on its cap). strokeApply keeps
     the ONE-snapshot per gesture semantics untouched (snapshot-gated).
     lastHit reports the footprint + the deposit's ACTUAL resulting column
     top (surfaceY after the pour), so QA measures what landed. */
  function applyAtFootprint(gx, gz) {
    lastApplyGX = gx;
    lastApplyGZ = gz;
    lastApplyAt = performance.now();
    if (tool === "pile") {
      /* Rate-independent anti-runaway: pours this gesture whose centers
         sit within ±STACK_NEAR cells (≈6.9 cm) of this footprint column.
         A still hold tops out after PILE_MAX_STACK domes — the repose
         relaxation + these caps together are why the mound saturates at
         the cone instead of chaining up (the old ski-jump). */
      const fx = Math.floor(gx), fz = Math.floor(gz);
      let near = 0;
      for (let j = -STACK_NEAR; j <= STACK_NEAR; j++)
        for (let i = -STACK_NEAR; i <= STACK_NEAR; i++)
          near += gestureStacks.get((fz + j) * N + (fx + i)) || 0;
      if (near >= PILE_MAX_STACK) return;   /* mound complete — no spire */
      const key = fz * N + fx;
      const atSpot = gestureStacks.get(key) || 0;
      gestureStacks.set(key, atSpot + 1);
      /* Pours AT THE SAME SPOT (hold/jitter, one key) grow the cone WIDER
         — up to POUR_R_MAX — so the mound relaxes up AND OUT into a true
         repose cone (≈ 0.15-0.2 m after ~0.6 s). Path pours move to fresh
         keys every step, so a drag keeps the narrow POUR_R0 base: a low
         ground bank (~2-3 rows), even where two segments cross at a
         corner. The hard anti-runaway cap is the neighbourhood `near`. */
      const r = Math.min(POUR_R_MAX, POUR_R0 + POUR_GROW * atSpot);
      const peak = pileArmed ? POUR_PEAK_TAP : POUR_PEAK;
      pileArmed = false;
      strokeApply({ grid: [gx, 0, gz], onPlane: true, pour: { r, peak } });
      const sx = Math.max(0, Math.min(N - 1, fx));
      const sz = Math.max(0, Math.min(N - 1, fz));
      lastHit = {
        onPlane: true, ny: 1,
        grid: [+gx.toFixed(2), +(surfaceY(field, sx, sz) + 0.5).toFixed(2),
               +gz.toFixed(2)]
      };
      return;
    }
    const gy = seatedGy(gx, gz);
    lastHit = {
      onPlane: true, ny: 1,
      grid: [+gx.toFixed(2), +gy.toFixed(2), +gz.toFixed(2)]
    };
    strokeApply({ grid: [gx, gy, gz], onPlane: true, rad: BRUSH_R });
  }

  /* Pile-fix B: a fast drag must lay an EVEN ridge — deposit intermediate
     domes along the footprint path at ≤ PATH_STEP-cell spacing (no gaps,
     no dense stacking). The move handler's ≥1-cell + PATH_MIN_MS gate is
     the per-second bound: one burst = one budgeted application event. */
  function applyPath(gx, gz) {
    const dx = gx - lastApplyGX, dz = gz - lastApplyGZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const n = Math.max(1, Math.min(40, Math.ceil(dist / PATH_STEP)));
    for (let k = 1; k <= n; k++)
      applyAtFootprint(lastApplyGX + dx * k / n, lastApplyGZ + dz * k / n);
  }

  /* Ring at a ground-footprint point (pile/carve painting): the plane hit
     projects exactly under the cursor, so the ring still tracks it. */
  function showRingAt(p) {
    ring.position.copy(p).addScaledVector(UP, 0.01);
    ring.material.color.set(tool === "carve" ? 0x7a5a3a : 0xffffff);
    ring.visible = true;
  }

  function endStroke() {
    if (paintPtr === null) return;
    const tap = tapGesture;
    paintPtr = null;
    tapGesture = false;
    lastRebuildAt = 0;
    if (!tap) rebuildMesh();            /* taps already rebuilt in commitTap */
    if (tap && pulseT && performance.now() < pulseT) {
      /* keep the commit pulse alive; renderFrame expires it */
    } else {
      ring.visible = false;
      pulseT = 0;
    }
    if (strokeChanged) notifyChange();   /* toolbar enablement, once */
    strokeChanged = false;
    strokeSnapshotted = false;
    pendingSnap = null;
    flattenPlaneY = null;
    /* pile-fix: gesture-scoped anchoring/rate state resets with the stroke */
    paintGroundOk = false;
    pileArmed = false;
    gestureStacks.clear();
    lastApplyAt = 0;
  }

  /* ---- pointer input (ours first, then OrbitControls') ---------------
     DOM spec: listeners on the SAME element fire in REGISTRATION order —
     a capture flag does not reorder target-phase listeners. So we attach
     our handlers BEFORE constructing OrbitControls and thereby run
     first; the mouseButtons config below is what the controls' own
     pointerdown handler then reads. */

  function onPointerDown(ev) {
    if (!active || !field) return;
    if (paintPtr !== null) {
      /* Stroke live + another pointer landed (two-finger touch): hand
         the gesture to OrbitControls (touches.TWO = dolly-rotate). */
      endStroke();
      orbitPtrs.add(ev.pointerId);
      return;
    }
    if (ev.button === 0 && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      paintPtr = ev.pointerId;   /* OrbitControls captures it for us */
      lastRebuildAt = 0;         /* stroke start rebuilds immediately */
      forceFull = true;          /* first stroke commit = full anchor rebuild */
      pileArmed = true;          /* the gesture's FIRST dome gets the boost */
      gestureStacks.clear();     /* one stack budget per gesture */
      paintGroundOk = false;
      const nd = eventNdc(ev);
      paintNd.copy(nd);
      if (isTapTool()) {
        /* Task 8: stamps/decor commit ONCE on pointerdown; the rest of
           the gesture is swallowed (no drag-painting). A miss (sky
           click) commits nothing; orbit stays on right-drag/two-finger. */
        tapGesture = true;
        ring.visible = false;
        const hit = castPointer(ev);
        if (hit) commitTap(hit);   /* success → pulse ring feedback */
        return;
      }
      if (isGroundPainer()) {
        /* Pile-fix A: EXACTLY one application on pointerdown, seated on
           the ground footprint (never the mesh), ring anchored with it. */
        const g = groundFootprint(nd);
        if (g) {
          paintGroundOk = true;
          paintFx = g.grid[0];
          paintFz = g.grid[2];
          showRingAt(g.p);
          applyAtFootprint(paintFx, paintFz);
        }
        return;
      }
      const hit = castPointer(ev);
      if (hit) {
        showRing(hit);
        strokeApply(hit);        /* first application rebuilds at once */
        lastApplyAt = performance.now();
      }
      return;
    }
    /* shift/ctrl+left, middle, right or extra touch pointers → camera. */
    orbitPtrs.add(ev.pointerId);
    ring.visible = false;
  }

  function onPointerMove(ev) {
    if (!active || !field) return;
    if (ev.pointerId === paintPtr) {
      if (tapGesture) return;   /* tap commit already done; gesture inert */
      const nd = eventNdc(ev);
      paintNd.copy(nd);
      if (isGroundPainer()) {
        /* Pile-fix A+B: footprint from the ground plane (stationary cursor
           ⇒ stationary footprint ⇒ clean vertical mound via the frame hold).
           Moves ≥1 cell (≥PATH_MIN_MS apart) lay an interpolated dome path;
           sub-cell jitter passes the time gate only — no dense stacking. */
        const g = groundFootprint(nd);
        if (!g) { ring.visible = false; paintGroundOk = false; return; }
        paintGroundOk = true;
        const fx = g.grid[0], fz = g.grid[2];
        paintFx = fx;
        paintFz = fz;
        showRingAt(g.p);
        if (!strokeSnapshotted) { applyAtFootprint(fx, fz); return; }
        const dx = fx - lastApplyGX, dz = fz - lastApplyGZ;
        if (dx * dx + dz * dz >= MOVE_MIN * MOVE_MIN &&
            performance.now() - lastApplyAt >= PATH_MIN_MS) applyPath(fx, fz);
        return;
      }
      const hit = castPointer(ev);
      if (!hit) { ring.visible = false; return; }
      showRing(hit);
      const g = hit.grid;
      const dx = g[0] - lastGX, dy = g[1] - lastGY, dz = g[2] - lastGZ;
      if (dx * dx + dy * dy + dz * dz < HOVER_MIN * HOVER_MIN) return;   /* < 0.5 ref-cell */
      strokeApply(hit);
      lastApplyAt = performance.now();
      return;
    }
    pulseT = 0;   /* any fresh pointer activity ends the one-shot pulse */
    if (orbitPtrs.has(ev.pointerId)) return;   /* camera drag: no ring */
    if (ev.buttons === 0) {                    /* hover: cursor ring only */
      const hit = castPointer(ev);
      if (hit) showRing(hit); else ring.visible = false;
    }
  }

  function onPointerUp(ev) {
    if (ev.pointerId === paintPtr) { endStroke(); return; }
    orbitPtrs.delete(ev.pointerId);
  }

  function wireInput(canvas) {
    const events = new AbortController();
    canvas.addEventListener("pointerdown", onPointerDown, { signal: events.signal });
    canvas.addEventListener("pointermove", onPointerMove, { signal: events.signal });
    canvas.addEventListener("pointerleave", () => { if (paintPtr === null) ring.visible = false; },
      { signal: events.signal });
    /* up/cancel on window: strokes survive capture loss, missed canvas
       ups and pointer-off-window glitches */
    window.addEventListener("pointerup", onPointerUp, { signal: events.signal });
    window.addEventListener("pointercancel", onPointerUp, { signal: events.signal });
    return () => events.abort();
  }

  function open(initial) {
    if (active) return;
    active = true;
    scene = new THREE.Scene();
    sky = makeSkyTexture();
    scene.background = sky;
    /* VISUAL PASS B: the stage values (ambient 0.65 + directional 1.7)
       blew every face past the toon ramp's top step — the whole castle
       clipped to one bright tan and read as a flat cut-out from any
       side angle. Lower ambient + a dim hemisphere ground-fill + one
       strong LOW sun, paired with the darker-floored CASTLE_RAMP below,
       spread top/side/shade faces over 3-4 distinct bands. */
    scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_I));
    scene.add(new THREE.HemisphereLight(HEMI_SKY, HEMI_GROUND, HEMI_I));
    const sun = new THREE.DirectionalLight(0xfff2dc, SUN_I);
    sun.position.set(SUN_POS[0], SUN_POS[1], SUN_POS[2]);
    scene.add(sun);
    /* Fades the (now large) ground mat's far edge into the sky's warm
      bottom stop so the builder reads as a beach horizon, not a card
      floating in the sky. Castle/decor/ring materials opt out (fog:
      false) — only the mat recedes. */
    scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);

    plotY = sandY(PLOT.x, PLOT.z);

    /* Plot floor: a wide wet-sand beach mat (visual pass E — the old
       lone 2.2 m quad read as a floating beige card from low angles).
       Slightly cooler/darker than the castle so silhouettes separate.
       The plot plane itself (piling raycasts, ring, shadow) still lives
       at exactly plotY. */
    const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
    geo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(geo, new THREE.MeshToonMaterial({
      color: GROUND_COLOR,
      gradientMap: gradientMap()
    }));
    ground.position.set(PLOT.x, plotY, PLOT.z);
    scene.add(ground);

    /* Resolution pass polish (pass E light touch-up): a slightly darker
       wet-sand annulus hugging the plot edge so the buildable disc reads
       as damp sand the castle was packed from — a transparent darkening
       (unlit) rather than a new albedo, so it can never fight the toon
       ramp. 2.5 mm above the mat (below the marking + contact shadow),
       fog-aware like the mat, depthWrite off. +1 draw call in the BUILDER
       scene only (the beach bake never sees it). */
    const wetRing = new THREE.Mesh(
      new THREE.RingGeometry(1.08, 2.9, 48),
      new THREE.MeshBasicMaterial({
        color: WET_RING_COLOR, transparent: true, opacity: WET_RING_OP,
        depthWrite: false, side: THREE.DoubleSide
      })
    );
    wetRing.rotation.x = -Math.PI / 2;
    wetRing.position.set(PLOT.x, plotY + 0.002, PLOT.z);
    scene.add(wetRing);

    /* Task 5 (restyled pass E): the buildable-area marking is now a
       faint RING at the plot edge instead of a filled disc — the disc
       fought the new contact shadow for the "ground" read. Unlit, 4 mm
       above the plane (no z-fighting), fog-exempt. */
    const mark = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1.05, 48),
      new THREE.MeshBasicMaterial({
        color: MARK_COLOR,
        transparent: true, opacity: 0.35, depthWrite: false
      })
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(PLOT.x, plotY + 0.004, PLOT.z);
    scene.add(mark);

    /* VISUAL PASS A: soft contact shadow under the castle footprint —
       world.js's radial-gradient blob texture (the very same recipe the
       baked beach castle and every plantProp use), ~plot radius, low
       opacity so it grounds the mass without painting the mat grey.
       depthWrite off + renderOrder 1: it lies over the mat and behind
       the opaque castle geometry (depth-tested), never over Lily. */
    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(SHADOW_R, 28),
      new THREE.MeshBasicMaterial({
        map: blobShadowTexture(), transparent: true,
        opacity: SHADOW_OP, depthWrite: false
      })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.renderOrder = 1;
    contact.position.set(PLOT.x, plotY + 0.008, PLOT.z);
    scene.add(contact);

    /* Task 6: density field session + MarchingCubes mesh. Task 10: the
       session may be SEEDED from the persisted save — open(initial) with
       { field, decor } restores() a copy into the session (a corrupt/
       mismatched initial state falls back to the fresh base-only field).
       A fresh session's field is the base MOUND only: its buried root +
       skirt sink under the mat (MC_SINK), so an empty plot shows clean
       sand with the faint plot ring — the castle silhouette only starts
       at row 2. Warmer (packed-sand) than the wet mat so sculpted mass
       separates from the ground line. */
    field = createField();
    decor = [];
    if (initial && typeof initial === "object") {
      const seeded = restore(initial);
      if (seeded) { field = seeded.field; decor = seeded.decor; }
    }
    const mcMat = new THREE.MeshToonMaterial({
      color: CASTLE_COLOR,
      gradientMap: castleGradientMap(),
      fog: false
      /* flatShading stays false: the addon's compNorm central-difference
         normals + smoothing pre-pass give round, not boxy, shading. */
    });
    mc = new MarchingCubes(MC_SIZE, mcMat, false, false, MC_MAX_TRIS);
    mc.isolation = MC_ISOLATION;
    mc.frustumCulled = false;   /* init() ships a radius-1 local sphere;
                                   one mesh, always on screen while open */
    /* See the mapping note: scale 1.2375, cell 0 center at plot corner
       + CELL/2, and the whole mesh SUNK MC_SINK cells so the foundation
       mound hides under the ground mat and structures emerge from it. */
    mc.position.set(PLOT.x + CELL / 2,
      plotY + PLOT.size / 2 + CELL / 2 - MC_SINK * CELL,
      PLOT.z + CELL / 2);
    mc.scale.setScalar(MC_SCALE);
    scene.add(mc);
    rebuildMesh(true);

    /* Brush cursor ring: flat ring, billboarded to the camera each
       frame; white for pile, dark brown for carve. */
    ring = new THREE.Mesh(
      new THREE.RingGeometry(0.12, 0.15, 32),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.8,
        depthTest: false, side: THREE.DoubleSide
      })
    );
    ring.renderOrder = 10;
    ring.visible = false;
    scene.add(ring);

    /* Task 8: decor group + shared tiny meshes; rebuilt from the
       record array (fresh session → empty). */
    decorAssets = buildDecorAssets(gradientMap());
    decorGroup = new THREE.Group();
    scene.add(decorGroup);
    rebuildDecor();

    /* Task 5: keep Lily standing at her stand point inside the builder
       view — reparent her mixRoot into this scene (three.js detaches it
       from world.scene automatically). The beach loop still runs
       character.update() every frame, so her Idle mixer and grounding
       stay live; locomotion is disabled by sandcastle3d.arrive(). */
    if (char?.root?.isObject3D) {
      scene.add(char.root);
      movedChar = true;
    }

    const canvas = world.canvas;
    camera = new THREE.PerspectiveCamera(38,
      (canvas.clientWidth || 1) / (canvas.clientHeight || 1), 0.1, 60);
    camera.position.set(CAM_POS[0], CAM_POS[1], CAM_POS[2]);
    camera.lookAt(CAM_TARGET[0], CAM_TARGET[1], CAM_TARGET[2]);

    /* OUR listeners first (registration order = run order at target),
       THEN OrbitControls — see the input note above. */
    detachInput = wireInput(canvas);
    controls = new OrbitControls(camera, canvas);
    /* Left-drag / one-finger paint; rotate on right-drag, shift/ctrl+left
       or two fingers (plan §5 mobile: pile/carve paint with one finger).
       Desktop trackpad fallback rides an r170 OrbitControls quirk
       (onMouseDown): with LEFT=PAN, shift/ctrl/cmd+left substitutes
       ROTATE for PAN — and since enablePan is false, a plain left-drag
       is inert (paint wins) while a shift+left-drag orbits. */
    controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    controls.target.set(CAM_TARGET[0], CAM_TARGET[1], CAM_TARGET[2]);
    controls.enablePan = false;
    controls.minDistance = 1.2;
    controls.maxDistance = 8;
    controls.maxPolarAngle = 1.45;   /* never dive below the ground */
    controls.update();

    /* The beach has no window-resize hook (world.js observes the host
       element); the editor follows the shared canvas while open. */
    ro = new ResizeObserver(() => resize(canvas.clientWidth, canvas.clientHeight));
    ro.observe(canvas);

    /* One change callback on open so the toolbar's Undo/Redo start
       correctly disabled. Seeded sessions also start with EMPTY stacks:
       undo/redo history is session-local (plan §6 — freed on exit), so
       the saved shape has no history to undo into. That is correct for a
       fresh session; a kid wanting the pre-edit shape back uses Reset's
       undo-free semantics deliberately. */
    notifyChange();
  }

  function close() {
    if (!active) return;
    active = false;
    /* Restore Lily to the beach scene BEFORE anything here disposes:
       the traverse below destroys mesh geometry/materials, and her
       model must not be in this scene when it runs. */
    if (movedChar) {
      movedChar = false;
      world.scene.add(char.root);
    }
    if (detachInput) { detachInput(); detachInput = null; }
    if (ro) { ro.disconnect(); ro = null; }
    if (controls) { controls.dispose(); controls = null; }
    if (scene) {
      scene.traverse((node) => {
        if (!node.isMesh) return;
        node.geometry.dispose();
        node.material.dispose();
      });
      scene = null;
    }
    if (sky) { sky.dispose(); sky = null; }
    if (_gradientMap) { _gradientMap.dispose(); _gradientMap = null; }
    /* Task 8: decor meshes ride the scene traverse above; the shared
       tiny geometries/materials go explicitly (some may never have
       been attached to a mesh). */
    disposeDecorAssets(decorAssets);
    decorAssets = null;
    decorGroup = null;
    /* MC internals (field, normal_cache, buffers) ride the geometry
       dispose above; drop the references so GC can take the rest.
       Task 7: undo/redo stacks are session-local (plan §6 — memory is
       freed on exit). The chosen TOOL persists across sessions within
       one beach visit (task 6 behavior — the toolbar re-syncs its
       pressed state from the editor on attach). */
    mc = null; ring = null; field = null;
    /* incremental-rebuild state (re-seeded on the next open) */
    renderBuf = null; dirtyBox = null; forceFull = true; rebuildKind = null;
    undoStack = []; redoStack = []; decor = [];
    tapGesture = false; pulseT = 0;
    strokeSnapshotted = false; strokeChanged = false; flattenPlaneY = null;
    pendingSnap = null;
    paintPtr = null; orbitPtrs.clear();
    paintGroundOk = false; pileArmed = false; lastApplyAt = 0;
    gestureStacks = new Map();
    rebuildMs = 0; lastRebuildAt = 0;
    camera = null;
  }

  /* Per-frame entry from beach3d.js: controls easing + editor render
     through the shared renderer. Returns false when idle. */
  function renderFrame(dt) {
    if (!active || !scene || !camera || !controls) return false;
    controls.update();
    /* Pile-fix B: hold-repeat. A still pointer fires no pointermove, so
       holding used to do NOTHING (and jitter painted unevenly). While a
       paint stroke is live we keep applying at the last anchored footprint
       at most every PILE_RATE_MS — a comfortable bounded mound, never a
       runaway spire (the footprint can't climb: it's ground-seated).
       Smooth/flatten re-cast the stored screen position for the mesh hit —
       they follow what they see and add no mass, so no runaway risk. */
    if (paintPtr !== null && !tapGesture && field) {
      const hnow = performance.now();
      if (hnow - lastApplyAt >= PILE_RATE_MS) {
        if (isGroundPainer()) {
          if (paintGroundOk) applyAtFootprint(paintFx, paintFz);
        } else {
          const hit = castNdc(paintNd);
          if (hit) strokeApply(hit);
        }
        lastApplyAt = hnow;
      }
    }
    if (ring.visible) {
      ring.quaternion.copy(camera.quaternion);   /* billboard */
      const now = performance.now();
      if (pulseT) {
        if (now < pulseT) {
          ring.scale.setScalar(1.4);             /* tap-commit pulse */
        } else {
          pulseT = 0;
          ring.scale.setScalar(1);
          ring.visible = false;
        }
      } else if (ring.scale.x !== 1) {
        ring.scale.setScalar(1);
      }
    }
    world.renderer.render(scene, camera);
    return true;
  }

  function setTool(t) {
    if (!TOOLS.includes(t)) return false;
    tool = t;
    return true;
  }

  function state() {
    /* tallest column (rows + metres) — anti-runaway QA (pile-fix). The
       METRES value is resolution-proof (maxH rows scale with N), which is
       what sandcastle_test.py pins against the pre-fix runaway arm. */
    const mh = field ? maxSurfaceH() : 0;
    return {
      active,
      tool,
      n: N, cell: +CELL.toFixed(5),
      stats: field
        ? { solid: countSolid(field), tris: mc ? Math.round(mc.count / 3) : 0 }
        : null,
      maxH: mh,
      maxHM: +(mh * CELL).toFixed(3),
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      /* Task 8: decor diagnostics — count + a copy of the records. */
      decorCount: decor.length,
      decor: decor.map((d) => ({ ...d })),
      lastRebuildMs: rebuildMs ? +rebuildMs.toFixed(2) : 0,
      lastRebuildKind: rebuildKind,   /* QA: "full" | "incr" (pass 2) */
      lastHit,   /* QA diagnostic */
      plotY,     /* QA: plane height (sandY at the plot center) */
      /* QA diagnostics only (mirrors __beach3d.state().cam). */
      cam: camera
        ? [+camera.position.x.toFixed(3), +camera.position.y.toFixed(3), +camera.position.z.toFixed(3)]
        : null
    };
  }

  /* QA hook: editor-space world point → page CSS px (same contract as
     world.project, but through the builder camera). */
  function project(x, y, z) {
    if (!camera) return null;
    const v = new THREE.Vector3(x, y, z).project(camera);
    const r = world.canvas.getBoundingClientRect();
    return {
      x: r.left + (v.x * 0.5 + 0.5) * r.width,
      y: r.top + (1 - (v.y * 0.5 + 0.5)) * r.height,
      behind: v.z > 1
    };
  }

  /* QA hook (visual pass): deterministically PARK the builder camera on a
     spherical orbit around the current target — az = azimuth (rad; +z
     under the plot = 0, +x/east positive), pol = polar angle from +y
     (rad; ~1.4 = near-horizon side view, clamped to the control's
     maxPolarAngle so presets can't dive under the sand), dist = orbit
     radius (m, clamped to the user's zoom bounds). OrbitControls.update()
     re-derives its spherical from the camera position each frame, so a
     direct position park survives the per-frame controls.update(). */
  function orbitTo(az, pol, dist) {
    if (!active || !camera || !controls) return false;
    az = Number(az); pol = Number(pol); dist = Number(dist);
    if (!Number.isFinite(az) || !Number.isFinite(pol) || !Number.isFinite(dist)) return false;
    pol = Math.min(controls.maxPolarAngle, Math.max(0.05, pol));
    dist = Math.min(controls.maxDistance, Math.max(controls.minDistance, dist));
    const t = controls.target;
    camera.position.set(
      t.x + dist * Math.sin(pol) * Math.sin(az),
      t.y + dist * Math.cos(pol),
      t.z + dist * Math.sin(pol) * Math.cos(az)
    );
    camera.lookAt(t);
    controls.update();
    return true;
  }

  /* QA hook (visual pass): named presets — 'default' restores the
     straight-down builder pose (also what the pointer-aim tests project
     through), 'low' is a near-horizon side view (dist 2.6, pol 1.4) and
     'corner' a 3/4 view — the angles the real quality shows at. */
  function setCamView(name) {
    if (!active || !camera || !controls) return false;
    if (name === "default") {
      camera.position.set(CAM_POS[0], CAM_POS[1], CAM_POS[2]);
      controls.target.set(CAM_TARGET[0], CAM_TARGET[1], CAM_TARGET[2]);
      camera.lookAt(controls.target);
      controls.update();
      return true;
    }
    const v = CAM_VIEWS[name];
    if (!v) return false;
    return orbitTo(v.az, v.pol, v.dist);
  }

  return {
    open, close, isActive: () => active, renderFrame, resize, state,
    setTool, project, setCamView, orbitTo,
    /* Task 7: toolbar wiring — history + whole-field actions. */
    undo, redo, applyTemplate, resetField, onChange,
    /* Task 9: bake seams — the LIVE field reference (read at exit)
       and a deep copy of the decor records. */
    getField: () => field,
    getDecor: () => decor.map((d) => ({ ...d })),
    /* Assigned by sandcastle3d.js (Done/Escape paths in later tasks). */
    onExit: null
  };
}
