/* sandcastle-field.js — pure density-field logic for the 3D sand castle builder.
   No three.js, no DOM. Grid: Uint8Array(N³), index i = x + N·y + N·N·z, y up.
   Density 0 = air, 255 = fully packed sand; SOLID is the write target for stamps.

    RESOLUTION PASS 2026-09-18 — the grid is parameterized on a single N (was a
    hard 32). Every shape constant that used to be "N=32 cell units" is now
    declared in METRES — via ref(), the physical size of one old cell
    (2.2 m / 32 = 6.875 cm) — and converted back to cells with cells(), so the
    PHYSICAL plot (PLOT_SIZE = 2.2 m) and the physical look of the castle are
    unchanged across resolutions. Motivation: at 6.9 cm cells the MarchingCubes
    surface melted every crisp feature (1-cell crenellation notches became
    rounded blobs, straight wall faces went wavy); N=64 (cell ≈ 3.4 cm) gave
    every feature 2+ samples across and N=96 (cell ≈ 2.3 cm, RESOLUTION PASS 2
    below) doubles the samples again so wall faces read flat and crenellations
    stand as distinct teeth.

    RESOLUTION PASS 2 (2026-09-18) — N 64 → 96. Physical sizes UNCHANGED (the
    metre helpers keep every constant honest); what changed is the grid, so
    the 3.4× cell count made the per-edit MarchingCubes work the bottleneck:
    rebuildMesh is now INCREMENTAL (editor dirty-region helper + the region
    forms below), which is what keeps sculpting responsive at 100³. */

export const N = 96;                  /* grid samples per side — THE resolution knob */
export const PLOT_SIZE = 2.2;         /* m — physical plot edge (editor PLOT.size) */
export const CELL = PLOT_SIZE / N;    /* m per cell (≈ 2.29 cm at N=96) */
export const SOLID = 160;             /* packed-sand write density */

/* metres helpers — one place converts physical → grid units */
const REF_CELL = 2.2 / 32;                          /* m — one cell at the old N=32 */
const ref = (c32) => c32 * REF_CELL;                 /* old-cell count → metres */
const cells = (m, min = 1) => Math.max(min, Math.round(m / CELL));  /* m → int cells */

const SIZE = N * N * N;
const THRESH = SOLID / 2;             // "solid enough" for surface/empty checks

/* Build cap ~1.4 m (plan §11): row count = round(1.4 m / cell) — 20 at the
   reference N=32 (exactly the old MAX_Y), 41 at N=64. Above it everything
   stays air; brushes/stamps clamp their tops here. */
export const MAX_Y = Math.round(1.4 / CELL);

/* Foundation rows 0..BASE_ROWS−1 (protected, never brushed): the buried
   root + rounded skirt of fillBase. 2 rows at the reference grid (0.1375 m
   tall), 4 at N=64 — the mound keeps its physical shape at any resolution,
   and the editor's MC_SINK sinks exactly these rows under the sand line. */
export function baseRowsFor(n) {
  return Math.max(2, Math.round(ref(2) * n / PLOT_SIZE));
}
export const BASE_ROWS = baseRowsFor(N);

/* Base plinth footprint — old HALF=13, TAPER=4 (Manhattan corner cut) and
   BRIM=7 (row-1 skirt rounding margin) cells → metres → runtime cells, so
   the buried root + rounded skirt keep the same shape at the new N. */
const HALF = cells(ref(13));
const TAPER = cells(ref(4));
const BRIM = cells(ref(7));

export const STAMPS = ["tower", "wall", "gate", "stairs", "moat"];

const LABELS = { tower: "Tower", wall: "Wall", gate: "Gate", stairs: "Stairs", moat: "Moat" };

export function stampLabel(kind) {
  if (LABELS[kind]) return LABELS[kind];
  return typeof kind === "string" && kind ? kind[0].toUpperCase() + kind.slice(1) : "";
}

const idx = (x, y, z) => x + N * y + N * N * z;

function isField(field) {
  return field instanceof Uint8Array && field.length === SIZE;
}

function clampInt(v, lo, hi) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return lo;
  return n < lo ? lo : n > hi ? hi : n;
}

export function inBounds(x, y, z) {
  return Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(z) &&
    x >= 0 && x < N && y >= 0 && y < N && z >= 0 && z < N;
}

export function modifiable(x, y, z) {
  return inBounds(x, y, z) && y >= BASE_ROWS && y <= MAX_Y;
}

function inBaseMask(x, z) {
  const dx = Math.abs(x - (N - 1) / 2), dz = Math.abs(z - (N - 1) / 2);
  return dx <= HALF && dz <= HALF && dx + dz <= HALF * 2 - TAPER;
}

/* Foundation = a natural low plot-hugging sand MOUND, not a full-footprint
   flat slab (visual pass 2026-09-18: rows 0-1 at 255 across the whole mask
   rendered from a side angle as a bright table floating above the sand).
   Shape (BASE_ROWS rows, physical size fixed across resolutions):
      rows 0..BASE_ROWS−2: solid across the whole mask — the wide BURIED
             root that keeps everything connected (structures/piles never
             float and there is never an open bottom shell; the editor/bake
             sink it below the visible sand line, so its edge is never seen).
      row BASE_ROWS−1 (the rim row): a rounded dome — full density (255)
             while ≥ BRIM cells inside ANY mask boundary (every stamp/pile
             anchor sits there: keep towers at b = BRIM·scale, fort terrace
             centre deeper), then a LINEAR density ramp down to air at the
             rim. The distance-to-rim b is measured against all three mask
             edges (both Chebyshev sides and the Manhattan corner cut), so
             the skirt rounds down uniformly toward the ground along every
             side — not just the diagonal corners. Because the
             MarchingCubes transfer INTERPOLATES densities (isolation 80),
             this byte ramp polygonizes as a rounded mound sinking into the
             sand — no sharp vertical slab edge and nothing bright sticking
             up at the rim.
   The foundation rows keep their byte-grid semantics: protected, never
   brushed (modifiable()/sphereBounds still gate every brush to
   BASE_ROWS..MAX_Y), and the RLE save format is untouched. */

export function fillBase(field) {
  if (!isField(field)) return field;
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const dx = Math.abs(x - (N - 1) / 2), dz = Math.abs(z - (N - 1) / 2);
      if (!inBaseMask(x, z)) continue;
      for (let y = 0; y < BASE_ROWS - 1; y++)
        field[idx(x, y, z)] = 255;               // buried foundation root
      const b = Math.min(HALF - dx, HALF - dz, HALF * 2 - TAPER - (dx + dz));
      field[idx(x, BASE_ROWS - 1, z)] =
        b >= BRIM ? 255 : Math.max(0, Math.round((255 * b) / BRIM));
    }
  return field;
}

export function createField() {
  return fillBase(new Uint8Array(SIZE));
}

export function clearField(field) {
  if (!isField(field)) return field;
  field.fill(0);
  return fillBase(field);
}

/* Topmost buildable row with solid density in a column; BASE_ROWS−1 = base top. */
export function surfaceY(field, x, z) {
  x = clampInt(x, 0, N - 1);
  z = clampInt(z, 0, N - 1);
  for (let y = MAX_Y; y >= BASE_ROWS; y--)
    if (field[idx(x, y, z)] >= THRESH) return y;
  return BASE_ROWS - 1;
}

/* --- brushes ----------------------------------------------------------- */

/* Radius clamp in metres (0.5…6 old cells), compared in runtime cells. */
const BRUSH_R_LO = ref(0.5) / CELL;
const BRUSH_R_HI = ref(6) / CELL;
function brushRad(rad) {
  const v = Number(rad);
  return Number.isFinite(v) ? Math.min(BRUSH_R_HI, Math.max(BRUSH_R_LO, v)) : BASE_ROWS;
}

/* Cell range a sphere touches, restricted to modifiable rows (BASE_ROWS..MAX_Y). */
function sphereBounds(cx, cy, cz, rad) {
  return [
    clampInt(Math.ceil(cx - rad), 0, N - 1),
    clampInt(Math.floor(cx + rad), 0, N - 1),
    Math.max(BASE_ROWS, clampInt(Math.ceil(cy - rad), 0, N - 1)),
    Math.min(MAX_Y, clampInt(Math.floor(cy + rad), 0, N - 1)),
    clampInt(Math.ceil(cz - rad), 0, N - 1),
    clampInt(Math.floor(cz + rad), 0, N - 1),
  ];
}

/* --- dirty-region boxes for the editor's incremental MC rebuild ----------
   Pure mirrors of the write footprints above (same clamp/round formulas),
   so the editor threads ONE source of truth through its write paths and
   the node equivalence test drives the very same geometry. Boxes are
   {x0,x1,y0,y1,z0,z1} cell-inclusive; callers may clamp further. */

/* pile/carve/smooth/flatten sphere footprint (ky = pileBrush's ySquash). */
export function brushDirtyBox(cx, cy, cz, rad, ky = 1) {
  if (![cx, cy, cz, rad].every(Number.isFinite)) return null;
  const r = brushRad(rad);
  const ys = Number(ky);
  const k = Number.isFinite(ys) && ys > 0.2 && ys <= 1 ? ys : 1;
  const [x0, x1, , , z0, z1] = sphereBounds(cx, cy, cz, r);
  return {
    x0, x1, z0, z1,
    y0: Math.max(BASE_ROWS, clampInt(Math.ceil(cy - r * k), 0, N - 1)),
    y1: Math.min(MAX_Y, clampInt(Math.floor(cy + r * k), 0, N - 1)),
  };
}

/* pourCone footprint: the column patch. Writes only ever land ON each
   column's own surface, so when `field` is supplied the y span tightens to
   [minSurface+1 … maxSurface + round(peakClamped)] instead of the whole
   modifiable column — a drag over flat ground dirties ~6 rows of y, not 61,
   which is the difference between update()-bound and update()+smoothing-
   bound steady cost. Without `field` (caller can't see it) falls back to
   the full [BASE_ROWS..MAX_Y] span — still correct, just wider. */
export function pourDirtyBox(fx, fz, r, peak, field = null) {
  if (![fx, fz, r].every(Number.isFinite)) return null;
  const rr = Math.min(BRUSH_R_HI, Math.max(0.5, Number(r)));
  const rc = Math.ceil(rr);
  const x0 = clampInt(Math.floor(fx) - rc, 0, N - 1);
  const x1 = clampInt(Math.ceil(fx) + rc, 0, N - 1);
  const z0 = clampInt(Math.floor(fz) - rc, 0, N - 1);
  const z1 = clampInt(Math.ceil(fz) + rc, 0, N - 1);
  let y0 = BASE_ROWS, y1 = MAX_Y;
  const pk = Number(peak);
  if (isField(field) && Number.isFinite(pk) && pk > 0) {
    // pourCone's own (3a) cap: no column grows more than r·REPOSE_SLOPE rows
    const hCap = Math.min(Math.round(pk), Math.round(rr * REPOSE_SLOPE));
    let minS = MAX_Y + 1, maxS = BASE_ROWS - 1;
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        const s = surfaceY(field, x, z);
        if (s < minS) minS = s;
        if (s > maxS) maxS = s;
      }
    y0 = Math.max(BASE_ROWS, minS + 1);
    y1 = Math.min(MAX_Y, Math.max(maxS, minS) + hCap);
    if (y0 > y1) { y0 = BASE_ROWS; y1 = MAX_Y; }
  }
  return { x0, x1, z0, z1, y0, y1 };
}

function centerOk(cx, cy, cz) {
  return [cx, cy, cz].every(Number.isFinite);
}

/* Pile ball. Default adds a uniform +delta (flat top — used by the mound
   template). falloff=true (pile-fix 2026-09-18) tapers the add linearly
   from the center to the shell — add = round(delta·(1 − dist/rad)),
   clamped ≥ 0 and skipped at 0 — so freeform piles read as rounded sand
   domes instead of flat-topped cylinders whose overlaps merged into fat
   lumps. The foundation rows and the MAX_Y cap already come for free via
   sphereBounds; additive only, so carve/smooth/flatten/stamps are
   untouched and old 6-arg callers see identical behavior.
   ySquash (visual pass D 2026-09-18, default 1 = old circle): scales the
   vertical axis of the ball — values < 1 make a WIDER-THAN-TALL ellipsoid
   dome, the poured-sand angle-of-repose shape; the editor applies a
   squashed profile to every repeat of a hold so stacked domes spread the
   mound sideways instead of racking up a flat-topped column.
   rad is in RUNTIME CELLS (the editor converts metres once — all physical
   sizing lives at the call sites). */
export function pileBrush(field, cx, cy, cz, rad, delta, falloff = false, ySquash = 1) {
  if (!isField(field)) return false;
  const d = Number(delta);
  if (!Number.isFinite(d) || d <= 0) return false;
  cx = Number(cx); cy = Number(cy); cz = Number(cz);
  if (!centerOk(cx, cy, cz)) return false;
  rad = brushRad(rad);
  const ys = Number(ySquash);
  const ky = Number.isFinite(ys) && ys > 0.2 && ys <= 1 ? ys : 1;
  /* Ellipsoid: full rad horizontally, rad·ky vertically (ky=1 → the
     original sphere bounds + d² exactly). sphereBounds gives the x/z
     spans from rad; the y span is recomputed from the squashed radius. */
  const [x0, x1, , , z0, z1] = sphereBounds(cx, cy, cz, rad);
  const y0 = Math.max(BASE_ROWS, clampInt(Math.ceil(cy - rad * ky), 0, N - 1));
  const y1 = Math.min(MAX_Y, clampInt(Math.floor(cy + rad * ky), 0, N - 1));
  const r2 = rad * rad;
  let changed = false;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = (y - cy) / ky, dz = z - cz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r2) continue;
        let add = d;
        if (falloff) {
          add = Math.round(d * (1 - Math.sqrt(d2) / rad));
          if (add <= 0) continue;
        }
        const i = idx(x, y, z);
        const v = Math.min(255, Math.round(field[i] + add));
        if (v !== field[i]) { field[i] = v; changed = true; }
      }
  return changed;
}

/* ---- POUR MODEL (pile physics redesign 2026-09-18, round 3) -------------
   Real poured sand lands where it falls and slides until every slope is at
   or below the angle of repose. The old pile tool seated an ellipsoid dome
   ABOVE the surface (PILE_OVER) and let each dome ride the previous one's
   summit — a drag "chased" its own elevation into a smooth ~40° ski-jump
   ramp that filled the plot. pourCone replaces that for the pile tool:

     pourCone(field, fx, fz, r, peak)   — r and peak in RUNTIME CELLS
     (fractional), everything else derived; deterministic and pure w.r.t.
     the field (same input field + args → same output grid).
     RE-PINNED for the resolution passes (2026-09-18, N=64 then N=96 — the
     model is resolution-INVARIANT: slopes are METRES/METRES, anti-runaway
     caps are absolute METRES, so every test pin holds at N=32/64/96/128).

   1. SUPPORT RULE (structural, no floating voxels ever): sand is written
      strictly column-wise from each column's own surfaceY upward — cell
      (x, s+1, z) is written only after (x, s, z) is known solid (it is, by
      definition of surfaceY; rows BASE_ROWS-1 sit on the protected base),
      so a pour can only ADD ON TOP of existing solid: on fresh ground the
      bank sits on the base, on an earlier pour it sits on that pour, and
      on a tower cap it lands on the cap (raise structures by pouring).
      There is deliberately NO center/seat parameter — nothing can hang in
      the air, and no term can lift a deposit above the column it lands on.

   2. CONE PROFILE: the column at horizontal distance ρ from (fx,fz) gains
      h(ρ) = peak·min(1, (r − ρ)/0.35r) rows — a TRAPEZOID dome: full
      height across the middle 65% of the footprint, linear taper to zero
      at the rim, whole rows only (round(h) < 1 writes nothing, so edges
      are sparse, never a cylinder). A pure 1−ρ/r cone would deposit sand
      only within ~0.55r, and the repose relaxation below would then pin
      the mound to ~0.4r tall no matter how many pours land; the trapezoid
      lets the shoulders receive sand, so stacked pours grow a mound UP
      AND OUT into a genuine repose cone (that's what pouring does).

   3. ANGLE OF REPOSE (~37° — dry sand): two caps enforce it.
      a. single-pour: peak ≤ r·REPOSE_SLOPE (the dome you dump can't be
         steeper than a repose cone on its own footprint);
      b. superposition: a Gauss-Seidel relaxation over the affected patch
         after the cone heights are computed — column top ≤ neighbour
         column top + REPOSE_SLOPE rows per cell, seeded from the untouched
         columns ringing the patch (and from MAX_Y). This is what actually
         kills the ramp: no SEQUENCE of pours can chain upward faster than
         the ground allows — the mound grows up AND out together, like real
         pouring, and on a tall body the seeds are that body's own columns,
         so build-on-top still works.
   Returns true if any cell changed; clamps to modifiable rows
   (BASE_ROWS..MAX_Y) like every other brush. */
const REPOSE_DEG = 37;                        /* dry-sand angle of repose */
const REPOSE_SLOPE = Math.tan(REPOSE_DEG * Math.PI / 180);  /* ≤ rows/cell */
const REPOSE_STEP8 = Math.round(REPOSE_SLOPE * 8);  /* cap steps, 1/8 rows */
export const POUR_REPOSE_DEG = REPOSE_DEG;

export function pourCone(field, fx, fz, r, peak) {
  if (!isField(field)) return false;
  fx = Number(fx); fz = Number(fz); r = Number(r); peak = Number(peak);
  if (![fx, fz, r, peak].every(Number.isFinite)) return false;
  if (r <= 0 || peak <= 0) return false;
  r = Math.min(BRUSH_R_HI, Math.max(0.5, r));
  peak = Math.min(peak, r * REPOSE_SLOPE);     /* (3a) single-pour cap */
  const rc = Math.ceil(r);
  const bx0 = clampInt(Math.floor(fx) - rc, 0, N - 1);
  const bx1 = clampInt(Math.ceil(fx) + rc, 0, N - 1);
  const bz0 = clampInt(Math.floor(fz) - rc, 0, N - 1);
  const bz1 = clampInt(Math.ceil(fz) + rc, 0, N - 1);

  /* desired tops (eighths of a row) from the cone on each column's own
     surface; −1 marks columns outside the cone */
  const W = bx1 - bx0 + 1;
  const top8 = new Int32Array(W * (bz1 - bz0 + 1)).fill(-1);
  const surf = new Int32Array(W * (bz1 - bz0 + 1));
  for (let z = bz0; z <= bz1; z++)
    for (let x = bx0; x <= bx1; x++) {
      const rho = Math.hypot(x - fx, z - fz);
      const k = (z - bz0) * W + (x - bx0);
      const s = Math.min(MAX_Y, surfaceY(field, x, z));
      surf[k] = s;
      if (rho > r) continue;
      const h = peak * Math.min(1, (r - rho) / (0.35 * r));   // trapezoid
      if (h < 0.5) continue;                   // rounds to no whole row
      top8[k] = Math.min(MAX_Y, s + Math.round(h)) * 8;
    }

  /* (3b) repose relaxation: seed columns outside the cone (and the patch
     border) at their current surface; sweep until no top can drop further.
     Gauss-Seidel converges in a few passes over a ≤ 2r-wide patch. */
  const H = bz1 - bz0 + 1;
  for (let pass = 0; pass < 64; pass++) {
    let moved = false;
    for (let z = bz0; z <= bz1; z++)
      for (let x = bx0; x <= bx1; x++) {
        const k = (z - bz0) * W + (x - bx0);
        if (top8[k] < 0) continue;
        let cap = top8[k];
        for (let d = 0; d < 4; d++) {
          const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
          const nz = z + (d === 2 ? -1 : d === 3 ? 1 : 0);
          let nt;
          if (nx < bx0 || nx > bx1 || nz < bz0 || nz > bz1)
            nt = (BASE_ROWS - 1) * 8;            // off-patch = ground plane
          else {
            const nk = (nz - bz0) * W + (nx - bx0);
            nt = top8[nk] < 0 ? surf[nk] * 8 : top8[nk];  // untouched = ground
          }
          const v = nt + REPOSE_STEP8;
          if (v < cap) cap = v;
        }
        if (cap < top8[k]) { top8[k] = cap; moved = true; }
      }
    if (!moved) break;
  }

  /* write column-wise, bottom-up, one row at a time → support invariant */
  let changed = false;
  for (let z = bz0; z <= bz1; z++)
    for (let x = bx0; x <= bx1; x++) {
      const k = (z - bz0) * W + (x - bx0);
      if (top8[k] < 0) continue;
      const top = Math.floor(top8[k] / 8);
      for (let y = surf[k] + 1; y <= top; y++) {
        if (y < BASE_ROWS || y > MAX_Y) continue;
        const i = idx(x, y, z);
        if (field[i] < SOLID) { field[i] = SOLID; changed = true; }
      }
    }
  return changed;
}

export function carveBrush(field, cx, cy, cz, rad, delta) {
  if (!isField(field)) return false;
  const d = Number(delta);
  if (!Number.isFinite(d) || d <= 0) return false;
  cx = Number(cx); cy = Number(cy); cz = Number(cz);
  if (!centerOk(cx, cy, cz)) return false;
  rad = brushRad(rad);
  const [x0, x1, y0, y1, z0, z1] = sphereBounds(cx, cy, cz, rad);
  const r2 = rad * rad;
  let changed = false;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy, dz = z - cz;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        const i = idx(x, y, z);
        const v = Math.max(0, Math.round(field[i] - d));
        if (v !== field[i]) { field[i] = v; changed = true; }
      }
  return changed;
}

export function smoothBrush(field, cx, cy, cz, rad) {
  if (!isField(field)) return false;
  cx = Number(cx); cy = Number(cy); cz = Number(cz);
  if (!centerOk(cx, cy, cz)) return false;
  rad = brushRad(rad);
  const [x0, x1, y0, y1, z0, z1] = sphereBounds(cx, cy, cz, rad);
  const r2 = rad * rad;
  const copy = field.slice();   // one order-independent pass over the sphere
  let changed = false;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy, dz = z - cz;
        if (dx * dx + dy * dy + dz * dz > r2) continue;
        let sum = 0, cnt = 0;
        for (let nz = z - 1; nz <= z + 1; nz++)
          for (let ny = y - 1; ny <= y + 1; ny++)
            for (let nx = x - 1; nx <= x + 1; nx++) {
              if (nx < 0 || nx >= N || ny < 0 || ny >= N || nz < 0 || nz >= N) continue;
              sum += copy[idx(nx, ny, nz)];
              cnt++;
            }
        const i = idx(x, y, z);
        const v = Math.round(sum / cnt);
        if (v !== field[i]) { field[i] = v; changed = true; }
      }
  return changed;
}

export function flattenBrush(field, cx, cy, cz, rad, planeY) {
  if (!isField(field)) return false;
  cx = Number(cx); cy = Number(cy); cz = Number(cz);
  if (!centerOk(cx, cy, cz)) return false;
  rad = brushRad(rad);
  const plane = clampInt(planeY, BASE_ROWS - 1, MAX_Y);
  const [x0, x1, y0, y1, z0, z1] = sphereBounds(cx, cy, cz, rad);
  const r2 = rad * rad;
  let changed = false;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx, dy = y - cy, dz = z - cz;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist > rad) continue;
        const fall = 1 - dist / rad;
        const i = idx(x, y, z);
        const v = field[i];
        const nv = y > plane
          ? Math.round(v * (1 - fall))                  // above plane: pull down toward 0
          : Math.round(v + (SOLID - v) * fall);         // at/below: raise toward SOLID
        if (nv !== v) { field[i] = nv; changed = true; }
      }
  return changed;
}

 /* --- render smoothing (visual pass 2026-09-18; RE-PINNED for N=64 and
    N=96 2026-09-18)

    Pure PRE-RENDER pass used by the MarchingCubes transfer (editor
    rebuildMesh + buildBakedGeometry): a gentle 3×3×3 close-and-blend that
    closes sub-cell pits and evens the stacked-dome lumps without erasing
    thin features. The rules are CELL-COUNT based (26-neighbour statistics
    inside a fixed 3×3×3 window), which is exactly what survived the N
    bumps: at any resolution doubling every preserved feature (gate arch,
    crenellation notch, courtyard pocket) doubles its cell size, so its
    open cells see the SAME fraction of solid neighbours — the 18/26 fill
    and ≤4 delete gates were re-verified against all five preservation
    cases at N=64 and again at N=96 (test-field suite) and hold without
    tightening. Rules (all feature-preserving):
       • a sub-threshold cell is FILLED only when ≥ 18 of its 26 neighbours
         are solid — an enclosed or deep surface pit. Concave courtyard
         side-pockets and the wide gate arch each see fewer solid
         neighbours and stay open (a plain 14-majority glued the keep's
         inner corners — pinned by test);
       • a solid cell is DELETED only as a near-detached grain (≤ 4 solid
         neighbours) — the MC wart nobody wants;
       • everything solid gets a mild mean-blend (72% self / 28% neighbour
         average) clamped to stay ≥ THRESH, so density evenness improves but
         nothing crosses into air — towers, crenellation notches and the
         gate opening survive by construction;
       • the foundation rows and the 1-cell border the addon never
         polygonizes are copied through untouched;
       • PURE: returns a new array and never mutates `src` — the saved byte
         grid, undo snapshots and surfaceY/countSolid QA all keep seeing
         the raw field.

    REGION FORM (resolution pass 2 — the incremental-rebuild seam): every
    output cell depends ONLY on raw `src` bytes in its own 3×3×3 window, so
    recomputing a dirty cell range reproduces the full pass BYTE-IDENTICALLY
    inside that range (pinned by the node equivalence test). `region` is a
    WRITE bbox in cell indices; reads still take the ±1 raw margin.
    smoothForRender(src) without a region stays the exact full pass. */

/* Canonical interior the pass writes (everything else copies through). */
const SR_X0 = 1, SR_X1 = N - 2, SR_Y0 = BASE_ROWS, SR_Y1 = MAX_Y - 1,
      SR_Z0 = 1, SR_Z1 = N - 2;

/* Recompute the smoothing into `out` (a SIZE-byte Uint8Array, e.g. the
   editor's persistent render mirror) for cells inside the write bbox,
   clamped to the grid. Inside the canonical interior the statistical pass
   runs; bbox cells OUTSIDE it (the copy-through border/foundation/cap rows,
   which brushes CAN touch at the x/z edges) are refreshed from raw `src` —
   exactly what the full pass copies through — so a region pass is
   byte-identical to smoothForRender(src) over the written bbox no matter
   what `out` held before. src is never mutated. */
export function smoothForRenderInto(src, out, wx0, wx1, wy0, wy1, wz0, wz1) {
  if (!isField(src) || !(out instanceof Uint8Array) || out.length !== SIZE) return;
  const x0 = Math.max(0, Math.min(N - 1, Math.round(wx0)));
  const x1 = Math.min(N - 1, Math.max(0, Math.round(wx1)));
  const y0 = Math.max(0, Math.min(N - 1, Math.round(wy0)));
  const y1 = Math.min(N - 1, Math.max(0, Math.round(wy1)));
  const z0 = Math.max(0, Math.min(N - 1, Math.round(wz0)));
  const z1 = Math.min(N - 1, Math.max(0, Math.round(wz1)));
  const ix0 = Math.max(SR_X0, x0), ix1 = Math.min(SR_X1, x1);
  const iy0 = Math.max(SR_Y0, y0), iy1 = Math.min(SR_Y1, y1);
  const iz0 = Math.max(SR_Z0, z0), iz1 = Math.min(SR_Z1, z1);
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++) {
      const innerY = y >= iy0 && y <= iy1;
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y, z);
        if (!(innerY && x >= ix0 && x <= ix1 && z >= iz0 && z <= iz1)) {
          out[i] = src[i];                       // copy-through rows/cells
          continue;
        }
        const v = src[i];
        let sum = v, cnt = 1, k = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy && !dz) continue;
              const nv = src[i + dx + N * dy + N * N * dz];
              sum += nv;
              cnt++;
              if (nv >= THRESH) k++;
            }
        if (v < THRESH) {
          if (k >= 18) out[i] = SOLID;            // close enclosed / deep pits
          else out[i] = v;                       // stay open (raw copy)
        } else if (k <= 4) {
          out[i] = 0;                             // drop near-detached grains
        } else {
          const b = Math.round(v * 0.72 + (sum / cnt) * 0.28);
          out[i] = b < THRESH ? THRESH : b > 255 ? 255 : b;   // stay solid
        }
      }
    }
}

export function smoothForRender(src) {
  if (!isField(src)) return src;
  const out = Uint8Array.from(src);
  smoothForRenderInto(src, out, SR_X0, SR_X1, SR_Y0, SR_Y1, SR_Z0, SR_Z1);
  return out;
}

/* --- MarchingCubes transfer helpers (pure; resolution pass 2) -----------
   The editor's INCREMENTAL rebuild writes only dirty cells into the
   addon's flat `field` (its +2 sample offset) and invalidates only the
   affected `normal_cache` sentinels instead of the old reset()+full-refill
   every edit. Semantics verified against the vendored r170 source:
     • compNorm(q) recomputes normal triple q iff normal_cache[q*3] === 0
       (the X component is the sentinel), and its central differences read
       field[q±1], field[q±yd], field[q±zd] — the SIX face neighbours; so
       after a field write at sample s, exactly {s} ∪ s's 6-neighbours can
       hold stale cached normals, and zeroing just those X slots is
       sufficient AND byte-identical to a full reset()+update() (unchanged
       cells recompute to the same values either way).
     • update() polygonizes cube roots 1…size−3, so samples 0,1,size−2,
       size−1 must stay air — our data at +2 occupies samples 2…N+1.
   These live here (not in the editor) so the node equivalence test imports
   the SAME code the editor runs. Generic over (size, off): dst/q3 indexing
   follows the addon's own flat-field convention. */

/* Write cell region [x0..x1]×[y0..y1]×[z0..z1] (clamped to the grid) of
   `src` (a render-density Uint8Array in CELL coords) into the addon field
   `dst` (Float32Array size³) at the +off sample offset. Returns the number
   of samples written (QA). */
export function transferToMc(src, dst, size, off, x0, x1, y0, y1, z0, z1) {
  if (!(src instanceof Uint8Array) || src.length !== SIZE) return 0;
  if (!dst || dst.length !== size * size * size) return 0;
  const cx0 = Math.max(0, Math.min(N - 1, x0 | 0)), cx1 = Math.max(0, Math.min(N - 1, x1 | 0));
  const cy0 = Math.max(0, Math.min(N - 1, y0 | 0)), cy1 = Math.max(0, Math.min(N - 1, y1 | 0));
  const cz0 = Math.max(0, Math.min(N - 1, z0 | 0)), cz1 = Math.max(0, Math.min(N - 1, z1 | 0));
  const size2 = size * size;
  let written = 0;
  for (let z = cz0; z <= cz1; z++) {
    const dz = z + off;
    for (let y = cy0; y <= cy1; y++) {
      const dy = y + off;
      const sRow = size2 * dz + size * dy + off;
      const fRow = N * y + N * N * z;
      for (let x = cx0; x <= cx1; x++) { dst[sRow + x] = src[fRow + x]; written++; }
    }
  }
  return written;
}

/* Invalidate cached normals for cell region (converted to samples at +off)
   GROWN BY 1 in every direction: the written samples themselves plus the
   face neighbours whose central difference reads them. Only the X
   component (the compNorm sentinel) needs zeroing — reset() itself zeroes
   nothing else that matters (stale Y/Z are only ever read after compNorm
   rewrote them). */
export function invalidateMcNormals(normalCache, size, off, x0, x1, y0, y1, z0, z1) {
  if (!normalCache || normalCache.length !== size * size * size * 3) return 0;
  const cx0 = Math.max(0, Math.min(N - 1, x0 | 0)), cx1 = Math.max(0, Math.min(N - 1, x1 | 0));
  const cy0 = Math.max(0, Math.min(N - 1, y0 | 0)), cy1 = Math.max(0, Math.min(N - 1, y1 | 0));
  const cz0 = Math.max(0, Math.min(N - 1, z0 | 0)), cz1 = Math.max(0, Math.min(N - 1, z1 | 0));
  const size2 = size * size;
  const sx0 = cx0 + off - 1, sx1 = cx1 + off + 1;
  const sy0 = cy0 + off - 1, sy1 = cy1 + off + 1;
  const sz0 = cz0 + off - 1, sz1 = cz1 + off + 1;
  let zeroed = 0;
  for (let z = sz0; z <= sz1; z++)
    for (let y = sy0; y <= sy1; y++) {
      const row = size2 * z + size * y;
      for (let x = sx0; x <= sx1; x++) { normalCache[(row + x) * 3] = 0.0; zeroed++; }
    }
  return zeroed;
}

/* --- stamps ------------------------------------------------------------

   Every stamp dimension is declared in metres (the physical size it had at
   the reference N=32, `cells(ref(k))`) and converted at runtime — at N=64
   that doubles the cell counts, which is the whole point: 4-cell wall
   faces, 2-cell-deep crenellation notches and 6-cell gate openings now
   carry enough geometry for MarchingCubes to render CRISP edges instead of
   the 6.9 cm blob-melt. `r` arrives in runtime cells (already converted by
   the caller). */

/* Rect write respecting base rows and the height cap; carve empties, else
   raises to SOLID (keeping anything denser already there). */
function writeBox(field, x0, x1, y0, y1, z0, z1, carve) {
  let changed = false;
  for (let z = Math.max(0, z0); z <= Math.min(N - 1, z1); z++)
    for (let y = Math.max(BASE_ROWS, y0); y <= Math.min(MAX_Y, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(N - 1, x1); x++) {
        const i = idx(x, y, z);
        if (carve) {
          if (field[i] !== 0) { field[i] = 0; changed = true; }
        } else if (field[i] < SOLID) { field[i] = SOLID; changed = true; }
      }
  return changed;
}

const CAP_H = cells(ref(2));          // tower cap thickness (0.1375 m)
const CAP_BRIM = cells(ref(2));       // cap overhang beyond the shaft
const CAP_NOTCH_W = cells(ref(2));    // cap crenel slot width
const SHAFT_2R = 2;                   // shaft height = 2·r (was r*2 at any N)

function stampTower(field, x, z, r) {
  const gy = surfaceY(field, x, z);
  const top = Math.min(MAX_Y, gy + r * SHAFT_2R);
  if (top <= gy) return false;
  let changed = false;
  for (let dz = -r; dz <= r; dz++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r) continue;
      changed = writeBox(field, x + dx, x + dx, gy + 1, top, z + dz, z + dz, false) || changed;
    }
  const cr = r + CAP_BRIM, capY0 = top + 1, capY1 = Math.min(MAX_Y, top + CAP_H);
  if (capY0 <= capY1) {
    for (let dz = -cr; dz <= cr; dz++)
      for (let dx = -cr; dx <= cr; dx++) {
        if (dx * dx + dz * dz > cr * cr) continue;
        changed = writeBox(field, x + dx, x + dx, capY0, capY1, z + dz, z + dz, false) || changed;
      }
    /* Four cardinal crenel slots cut into the OUTER BRIM of the cap
       (tip-side only, CAP_NOTCH_W cells deep + wide) — carving the full
       brim depth would let a big keep's cap slots saw through the
       curtain-wall crests they overhang (the reference design carved
       tip-side blocks). */
    const halfW = Math.floor(CAP_NOTCH_W / 2);
    for (const [ux, uz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      let x0, x1, z0, z1;
      if (ux) {
        x0 = x + ux * cr - (ux > 0 ? CAP_NOTCH_W - 1 : 0);
        x1 = x0 + CAP_NOTCH_W - 1;
        z0 = z - halfW; z1 = z + halfW;
      } else {
        z0 = z + uz * cr - (uz > 0 ? CAP_NOTCH_W - 1 : 0);
        z1 = z0 + CAP_NOTCH_W - 1;
        x0 = x - halfW; x1 = x + halfW;
      }
      changed = writeBox(field, x0, x1, capY0, capY1, z0, z1, true) || changed;
    }
  }
  return changed;
}

/* Lowest ground along the wall span keeps the wall rooted on uneven terrain. */
function wallGround(field, x, z, r, orient) {
  let gy = MAX_Y;
  for (const t of [-r, 0, r]) {
    const s = surfaceY(field, orient ? x : x + t, orient ? z + t : z);
    if (s < gy) gy = s;
  }
  return gy;
}

const WALL_T = cells(ref(2));         // wall thickness (0.1375 m — 4 cells @64)
const CRN_PERIOD = cells(ref(2));     // crenel repeat (merlon + notch) — 4 @64
const CRN_NOTCH = cells(ref(1));      // notch width within the period — 2 @64
const CRN_DEPTH = cells(ref(1.5));    // notch depth from the wall crest — 3 @64
                                      // (deeper than the reference 1 row:
                                      // stronger shadow line so the crest
                                      // reads crisp through the MC interp)

function stampWall(field, x, z, r, orient, crenel) {
  const gy = wallGround(field, x, z, r, orient);
  const y1 = Math.min(MAX_Y, gy + Math.round(r * 1.5));
  if (y1 <= gy) return false;
  let changed = orient
    ? writeBox(field, x, x + WALL_T - 1, gy + 1, y1, z - r, z + r, false)
    : writeBox(field, x - r, x + r, gy + 1, y1, z, z + WALL_T - 1, false);
  if (crenel) {
    for (let t = -r; t <= r; t++) {
      const m = (((t + r) % CRN_PERIOD) + CRN_PERIOD) % CRN_PERIOD;
      if (m < CRN_NOTCH) continue;                 // merlon stays
      changed = (orient
        ? writeBox(field, x, x + WALL_T - 1, y1 - CRN_DEPTH + 1, y1, z + t, z + t, true)
        : writeBox(field, x + t, x + t, y1 - CRN_DEPTH + 1, y1, z, z + WALL_T - 1, true)) || changed;
    }
  }
  return changed;
}

const GATE_HW = Math.max(1, Math.floor(cells(ref(3)) / 2));   // opening half-width (1 @32)
const GATE_ARCH_H = cells(ref(4));      // clear opening height (0.275 m — 8 @64)
const GATE_LINTEL = cells(ref(2));      // header rows above the arch (2 @64)
const GATE_SLACK = cells(ref(1));       // opening overshoot beyond the wall faces

function stampGate(field, x, y, z, r, orient) {
  const g = wallGround(field, x, z, r, orient);
  const ay = Math.round(Number(y));
  let floor = Number.isFinite(ay) ? Math.min(ay, g) : g;
  floor = Math.max(BASE_ROWS - 1, Math.min(MAX_Y - 1, floor));
  // Tall enough for the arch + its header even on short stamp radii.
  const y1 = Math.min(MAX_Y,
    floor + Math.max(Math.round(r * 1.5), GATE_ARCH_H + GATE_LINTEL));
  if (y1 <= floor) return false;
  let changed = orient
    ? writeBox(field, x, x + WALL_T - 1, floor + 1, y1, z - r, z + r, false)
    : writeBox(field, x - r, x + r, floor + 1, y1, z, z + WALL_T - 1, false);
  /* U-shaped opening through the wall (GATE_SLACK cells past each face),
     closed by a GATE_LINTEL-row header so it reads as an ARCH rather than
     a slit. Identical to the old 3-wide × 4-high cut at the reference
     resolution (half-width 1, arch 4, header = whatever the wall height
     leaves). */
  const hw = GATE_HW;
  let yTop = Math.min(y1, floor + GATE_ARCH_H);
  if (yTop > y1 - GATE_LINTEL) yTop = Math.max(floor + 1, y1 - GATE_LINTEL);
  changed = (orient
    ? writeBox(field, x - GATE_SLACK, x + WALL_T - 1 + GATE_SLACK,
      floor + 1, yTop, z - hw, z + hw, true)
    : writeBox(field, x - hw, x + hw, floor + 1, yTop,
      z - GATE_SLACK, z + WALL_T - 1 + GATE_SLACK, true)) || changed;
  return changed;
}

const STAIR_RISE = cells(ref(1));       // rows per step (0.06875 m — 2 @64)

function stampStairs(field, x, z, r, orient) {
  const gy = surfaceY(field, x, z);
  const steps = Math.min(5, Math.floor((MAX_Y - gy) / STAIR_RISE));
  if (steps <= 0) return false;
  const stepW = Math.max(1, Math.round(r / 2));
  const width = Math.max(2, r), half = Math.floor((width - 1) / 2);
  let changed = false;
  for (let s = 0; s < steps; s++) {
    const a = s * stepW, b = a + stepW - 1, y1 = gy + (s + 1) * STAIR_RISE;
    if (y1 > MAX_Y) break;
    changed = (orient
      ? writeBox(field, x - half, x - half + width - 1, gy + 1, y1, z + a, z + b, false)
      : writeBox(field, x + a, x + b, gy + 1, y1, z - half, z - half + width - 1, false)) || changed;
  }
  return changed;
}

const MOAT_W = cells(ref(1));           // ring half-width (2 @64)

function stampMoat(field, x, z, r) {
  let changed = false;
  const rIn = (r - MOAT_W) * (r - MOAT_W), rOut = (r + MOAT_W) * (r + MOAT_W);
  for (let dz = -(r + MOAT_W); dz <= r + MOAT_W; dz++)
    for (let dx = -(r + MOAT_W); dx <= r + MOAT_W; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 > rOut || d2 < rIn) continue;
      const cx = x + dx, cz = z + dz;
      if (cx < 0 || cx >= N || cz < 0 || cz >= N) continue;
      const sc = surfaceY(field, cx, cz);
      for (let y = BASE_ROWS; y <= sc; y++) {   // down to base top, never into the foundation
        const i = idx(cx, y, cz);
        if (field[i] !== 0) { field[i] = 0; changed = true; }
      }
    }
  return changed;
}

const STAMP_R_LO = cells(ref(2));       // 0.1375 m (2 @32)
const STAMP_R_HI = cells(ref(6));       // 0.4125 m (6 @32)

export function stampAt(field, x, y, z, kind, r, orient) {
  if (!isField(field) || !STAMPS.includes(kind)) return false;
  x = clampInt(x, 0, N - 1);
  z = clampInt(z, 0, N - 1);
  r = clampInt(r, STAMP_R_LO, STAMP_R_HI);
  orient = orient ? 1 : 0;
  switch (kind) {
    case "tower": return stampTower(field, x, z, r);
    case "wall": return stampWall(field, x, z, r, orient, true);
    case "gate": return stampGate(field, x, y, z, r, orient);
    case "stairs": return stampStairs(field, x, z, r, orient);
    default: return stampMoat(field, x, z, r);
  }
}

/* --- templates ---------------------------------------------------------

   The layouts are the SAME physical designs as before: every coordinate is
   the old N=32 offset in metres (ref(k)), converted to runtime cells. The
   centre is (N−1)/2 rounded (16 at 32, 32 at 64 — identical layout). */

function layoutC() { return Math.round((N - 1) / 2); }

export function applyTemplate(field, id) {
  if (!isField(field)) return false;
  const C = layoutC();
  const baseTop = BASE_ROWS - 1;
  if (id === "keep") {
    clearField(field);
    const KO = cells(ref(5));                      // corner/tower ring offset (11/21 @32)
    const cornerR = cells(ref(2)), keepR = cells(ref(3));
    for (const [ox, oz] of [[-KO, -KO], [KO, -KO], [-KO, KO], [KO, KO]])
      stampTower(field, C + ox, C + oz, cornerR);
    const curtainR = cells(ref(5));
    stampWall(field, C, C - KO, curtainR, 0, true);   // south curtain
    stampWall(field, C, C + KO, curtainR, 0, true);   // north curtain
    stampWall(field, C - KO, C, curtainR, 1, true);   // west curtain
    stampWall(field, C + KO, C, curtainR, 1, true);   // east curtain
    /* Central keep on a slim rock-like pedestal (0.1375 m taller than the
       reference layout): at the finer grid the curtain crests reach the
       same height as a flush keep and the silhouette loses its hero —
       the pedestal makes the keep tower read ABOVE the walls from low
       angles, which is the whole "real castle" read. */
    const ped = cells(ref(2));
    writeBox(field, C - keepR + 1, C + keepR - 1, BASE_ROWS, BASE_ROWS + ped - 1,
             C - keepR + 1, C + keepR - 1, false);
    stampTower(field, C, C, keepR);                   // central keep
    stampGate(field, C, baseTop, C - KO, keepR, 0);   // gate cut last, through the south wall
    return true;
  }
  if (id === "fort") {
    clearField(field);
    const terrR = cells(ref(12));                   // raised terrace so the moat has ground
    const terrTop = BASE_ROWS + cells(ref(2)) - 1;  // 2 rows @32 (0.1375 m), 4 @64
    for (let dz = -terrR; dz <= terrR; dz++)
      for (let dx = -terrR; dx <= terrR; dx++)
        if (dx * dx + dz * dz <= terrR * terrR)
          writeBox(field, C + dx, C + dx, BASE_ROWS, terrTop, C + dz, C + dz, false);
    stampMoat(field, C, C, cells(ref(8)));
    const fo = cells(ref(4));                       // fort tower/wall ring offset (12/20 @32)
    const tR = cells(ref(2));
    stampTower(field, C - fo, C + fo, tR);
    stampTower(field, C + fo, C + fo, tR);
    const fortWallR = cells(ref(4));
    stampWall(field, C, C - fo, fortWallR, 0, true);
    stampWall(field, C, C + fo, fortWallR, 0, true);
    stampWall(field, C - fo, C, fortWallR, 1, true);
    stampWall(field, C + fo, C, fortWallR, 1, true);
    stampGate(field, C, terrTop, C - fo, cells(ref(3)), 0);
    return true;
  }
  if (id === "mound") {
    clearField(field);
    pileBrush(field, C, BASE_ROWS + cells(ref(1)), C, cells(ref(8)), 255);
    pileBrush(field, C, BASE_ROWS, C, cells(ref(5)), 255);
    stampTower(field, C, C, cells(ref(2)));
    return true;
  }
  return false;
}

/* --- stats / persistence ----------------------------------------------- */

export function countSolid(field) {
  let n = 0;
  for (let y = BASE_ROWS; y <= MAX_Y; y++)
    for (let z = 0; z < N; z++) {
      const row = N * y + N * N * z;
      for (let x = 0; x < N; x++) if (field[row + x] >= THRESH) n++;
    }
  return n;
}

export function isFieldEmpty(field) {
  return countSolid(field) === 0;   // base alone counts as an empty castle
}

function copyDecor(decor) {
  if (!Array.isArray(decor)) return [];
  return decor.map((d) => (d && typeof d === "object" ? { ...d } : d));
}

export function snapshot(field, decor) {
  const f = field && typeof field.length === "number" ? Uint8Array.from(field) : new Uint8Array(SIZE);
  return { field: f, decor: copyDecor(decor) };
}

export function restore(state) {
  if (!state || typeof state !== "object") return null;
  const f = state.field;
  const valid = f instanceof Uint8Array
    ? f.length === SIZE
    : Array.isArray(f) && f.length === SIZE;
  if (!valid) return null;
  return { field: Uint8Array.from(f), decor: copyDecor(state.decor) };
}

/* --- RLE persistence (COMPACTED resolution pass 2 — same scan, bytes) ----

   A detailed castle at N=96 measured 42–73 KB as the legacy base36
   "count:value;…" string (keep 42 KB, sculpted worst-case 73 KB — over
   the localStorage comfort of the state guard), so runs are now
   BYTE-PACKED and base64'd: "~" + base64( per run [varint(count−1), value] ).
   Identical left-to-right maximal-run segmentation → deterministic and
   trivially reversible; the "~" marker can never occur in the base36
   alphabet, so the LEGACY form (v:1 saves + pre-compaction v:2) keeps
   decoding through parseLegacyRuns(). Both decoders are
   validateLength-paranoid: truncated varints/values, junk chars, bad
   padding, non-canonical varints and wrong totals all → null. */

const B64A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64R = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64A.charCodeAt(i)] = i;
  return t;
})();

function toB64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 3) {
    const b0 = u8[i], b1 = i + 1 < u8.length ? u8[i + 1] : -1,
          b2 = i + 2 < u8.length ? u8[i + 2] : -1;
    s += B64A[b0 >> 2] + B64A[((b0 & 3) << 4) | ((b1 < 0 ? 0 : b1) >> 4)] +
         (b1 < 0 ? "=" : B64A[((b1 & 15) << 2) | ((b2 < 0 ? 0 : b2) >> 6)]) +
         (b2 < 0 ? "=" : B64A[b2 & 63]);
  }
  return s;
}

function b64v(str, i) {
  const ch = str.charCodeAt(i);
  return ch < 128 ? B64R[ch] : -1;
}

function fromB64(str) {
  const L = str.length;
  if (!L || L % 4 !== 0) return null;
  let padEq = 0;                                   // trailing '=' count
  if (str[L - 1] === "=") padEq++;
  if (padEq && str[L - 2] === "=") padEq++;
  // '=' allowed ONLY as the final padEq characters
  if (padEq ? str.indexOf("=", L - padEq) !== L - padEq || str.indexOf("=") !== L - padEq
            : str.indexOf("=") !== -1) return null;
  const clean = padEq ? str.slice(0, L - padEq) + "AAAA".slice(0, padEq) : str;
  const out = new Uint8Array(L / 4 * 3 - padEq);
  let p = 0;
  for (let i = 0; i < L; i += 4) {
    const a = b64v(clean, i), b = b64v(clean, i + 1),
          c = b64v(clean, i + 2), d = b64v(clean, i + 3);
    if (a < 0 || b < 0 || c < 0 || d < 0) return null;   // junk char
    const bits = (a << 18) | (b << 12) | (c << 6) | d;
    if (p < out.length) out[p++] = (bits >> 16) & 255;
    if (p < out.length) out[p++] = (bits >> 8) & 255;
    if (p < out.length) out[p++] = bits & 255;
  }
  return p === out.length ? out : null;
}

/* Parse the compact payload into flat [count, value] pairs (null = junk).
   Canonical-varint paranoia: a multi-byte varint whose final group is zero
   is non-canonical → reject. */
function parseCompactRuns(b64) {
  const bytes = fromB64(b64);
  if (!bytes || !bytes.length) return null;
  const runs = [];
  let p = 0;
  while (p < bytes.length) {
    let c = 0, shift = 0, b, groups = 0;
    do {
      if (p >= bytes.length) return null;             // truncated varint
      b = bytes[p++]; groups++;
      c |= (b & 127) << shift;
      shift += 7;
      if (shift > 28) return null;                    // count way out of range
    } while (b & 128);
    if (groups > 1 && (b & 127) === 0) return null;   // non-canonical padding
    if (p >= bytes.length) return null;               // missing value byte
    const v = bytes[p++];
    c += 1;
    if (!Number.isSafeInteger(c) || c < 1) return null;
    runs.push(c, v);
  }
  return runs;
}

const B36 = /^[0-9a-zA-Z]+$/;

/* Legacy base36 form: count ":" value pairs joined by ";". */
function parseLegacyRuns(str) {
  const runs = [];
  let total = 0;
  for (const part of str.split(";")) {
    const ci = part.indexOf(":");
    if (ci <= 0 || ci === part.length - 1) return null;
    const cs = part.slice(0, ci), vs = part.slice(ci + 1);
    if (!B36.test(cs) || !B36.test(vs)) return null;
    const c = parseInt(cs, 36), v = parseInt(vs, 36);
    if (!Number.isSafeInteger(c) || !Number.isSafeInteger(v)) return null;
    if (c < 1 || v < 0 || v > 255) return null;
    total += c;
    runs.push(c, v);
  }
  runs.total = total;
  return runs;
}

function fillRuns(runs, out, maxTotal) {
  let pos = 0;
  for (let k = 0; k < runs.length; k += 2) {
    pos += runs[k];
    if (pos > maxTotal) return false;
    out.fill(runs[k + 1], pos - runs[k], pos);
  }
  return true;
}

export function encode(field) {
  const n = field.length;
  let bytes = 0, i = 0;
  while (i < n) {                                      // pass 1: exact size
    const v = field[i];
    let j = i + 1;
    while (j < n && field[j] === v) j++;
    let c = j - i - 1;
    do { c >>>= 7; bytes++; } while (c);
    bytes++;                                           // value byte
    i = j;
  }
  const buf = new Uint8Array(bytes);
  let p = 0; i = 0;
  while (i < n) {                                      // pass 2: pack
    const v = field[i];
    let j = i + 1;
    while (j < n && field[j] === v) j++;
    let c = j - i - 1;
    while (c >= 128) { buf[p++] = (c & 127) | 128; c >>>= 7; }
    buf[p++] = c;
    buf[p++] = v;
    i = j;
  }
  return "~" + toB64(buf);
}

/* Runs of either format, validated to a total ≤ maxTotal (shared paranoia). */
function runsOf(str, maxTotal) {
  const runs = (str[0] === "~")
    ? parseCompactRuns(str.slice(1))
    : parseLegacyRuns(str);
  if (!runs) return null;
  let total = 0;
  for (let k = 0; k < runs.length; k += 2) {
    total += runs[k];
    if (total > maxTotal) return null;
  }
  return runs;
}

/* Decode at the RUNTIME size — wrong-length or garbage → null (either
   format). validateLength paranoia: runs must fill EXACTLY SIZE bytes. */
export function decode(str) {
  if (typeof str !== "string" || str.length === 0) return null;
  const runs = runsOf(str, SIZE);
  if (!runs) return null;
  let total = 0;
  for (let k = 0; k < runs.length; k += 2) total += runs[k];
  if (total !== SIZE) return null;
  const out = new Uint8Array(SIZE);
  return fillRuns(runs, out, SIZE) ? out : null;
}

/* --- SAVE MIGRATION (resolution passes 2026-09-18) -----------------------

    SAVE-FORMAT DECISION (resolution pass 2): the RLE string itself stays
    HEADERLESS; the SAVE RECORD carries the grid size — GameState's
    sandcastle key is { v:2, n:<runtime N>, grid, decor } and `decode(str)`
    keeps its validateLength paranoia (rejects anything whose run total is
    not exactly the runtime SIZE). An old save (any v:1, or v:2 written at a
    different n) loads through decodeAny(), which infers the native size
    from the total (perfect-cube paranoia — the same check as decode) and
    resample() maps it onto the runtime grid. v:1 existed only at the
    reference N=32 (the feature is a day old; the N=64 build already wrote
    v:2 with n), so no "assume last v1 N" guess is needed — the total IS
    the evidence. MAX_MIGRATE_N bounds the allocation a hostile string
    could force (the state.js size guard already caps the string itself). */

const MAX_MIGRATE_N = 160;

/* Decode an RLE string at whatever native size its total implies. When
   `expectN` is given (the record's declared n) the inferred size MUST
   match it — a mismatch is treated as corrupt (null), never migrated. */
export function decodeAny(str, expectN = null) {
  if (typeof str !== "string" || str.length === 0) return null;
  const runs = runsOf(str, MAX_MIGRATE_N * MAX_MIGRATE_N * MAX_MIGRATE_N);
  if (!runs || !runs.length) return null;
  let total = 0;
  for (let k = 0; k < runs.length; k += 2) total += runs[k];
  const n = Math.round(Math.cbrt(total));
  if (n < 2 || n > MAX_MIGRATE_N || n * n * n !== total) return null;
  if (expectN != null && expectN !== n) return null;
  const out = new Uint8Array(total);
  fillRuns(runs, out, total);
  return { field: out, n };
}

/* Light trilinear resample of a density field decoded at srcN onto the
   runtime grid. Cell-centre aligned, so an exact 2× upscale maps the
   isosurface (and the THRESH byte bands around it) to the same physical
   position — a migrated castle renders recognizably identical, never
   shifted or blobbed out. */
export function resample(src, srcN) {
  if (!src || src.length !== srcN * srcN * srcN || srcN < 2 || srcN > MAX_MIGRATE_N)
    return null;
  const out = new Uint8Array(SIZE);
  const s2 = srcN * srcN;
  const sc = srcN / N;
  for (let z = 0; z < N; z++) {
    let fz = (z + 0.5) * sc - 0.5;
    if (fz < 0) fz = 0; else if (fz > srcN - 1) fz = srcN - 1;
    const z0 = Math.floor(fz), z1 = Math.min(srcN - 1, z0 + 1), tz = fz - z0;
    for (let y = 0; y < N; y++) {
      let fy = (y + 0.5) * sc - 0.5;
      if (fy < 0) fy = 0; else if (fy > srcN - 1) fy = srcN - 1;
      const y0 = Math.floor(fy), y1 = Math.min(srcN - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < N; x++) {
        let fx = (x + 0.5) * sc - 0.5;
        if (fx < 0) fx = 0; else if (fx > srcN - 1) fx = srcN - 1;
        const x0 = Math.floor(fx), x1 = Math.min(srcN - 1, x0 + 1), tx = fx - x0;
        const a = src[x0 + srcN * y0 + s2 * z0] * (1 - tx) * (1 - ty) * (1 - tz)
                + src[x1 + srcN * y0 + s2 * z0] * tx * (1 - ty) * (1 - tz)
                + src[x0 + srcN * y1 + s2 * z0] * (1 - tx) * ty * (1 - tz)
                + src[x1 + srcN * y1 + s2 * z0] * tx * ty * (1 - tz)
                + src[x0 + srcN * y0 + s2 * z1] * (1 - tx) * (1 - ty) * tz
                + src[x1 + srcN * y0 + s2 * z1] * tx * (1 - ty) * tz
                + src[x0 + srcN * y1 + s2 * z1] * (1 - tx) * ty * tz
                + src[x1 + srcN * y1 + s2 * z1] * tx * ty * tz;
        out[idx(x, y, z)] = Math.round(a);
      }
    }
  }
  return out;
}

/* Legacy decor records are CELL COORDS at the save's own resolution
   ({ t, x:cell, y:row, z:cell } ints); the saved form now lives in
   plot-LOCAL METRES so records survive any future resolution change.
   Same physical placement maths the editor uses: cell centre and row-top
   (with the source resolution's own MC_SINK == baseRowsFor(n)) — a
   migrated record stands exactly where it stood before the migration. */
export function migrateDecor(decor, srcN) {
  if (!Array.isArray(decor)) return [];
  if (!(srcN >= 2 && srcN <= MAX_MIGRATE_N)) return [];
  const cell = PLOT_SIZE / srcN;
  const sink = baseRowsFor(srcN);
  return decor
    .filter((d) => d && typeof d === "object" && Number.isFinite(d.x) &&
      Number.isFinite(d.y) && Number.isFinite(d.z))
    .map((d) => ({
      t: d.t,
      x: (d.x + 0.5) * cell - PLOT_SIZE / 2,
      y: (d.y + 1 - sink) * cell,
      z: (d.z + 0.5) * cell - PLOT_SIZE / 2
    }));
}
