# SAND-CASTLE-PLAN.md — 3D Sand Castle Building Simulator

Status: **plan (no code written yet)** · Date: 2026-09-17
Feature: a **Build sand castle** button on the 3D beach play interface. The character
walks to the umbrella, enters a flexible 3D sand-castle build simulator, and the finished
castle **stays on the beach scenery** after exiting (and after closing/reopening the beach).

---

## 1. Where this fits in the existing game

Relevant facts from the codebase (verified, with references):

| Fact | Where |
|---|---|
| 3D beach is three.js **r170** ES modules, vendored in `lib/three/` (import map: `three`, `three/addons/`) | `index.html:15-22`, `lib/three/three.module.js:6` |
| Only addons present: `GLTFLoader`, `BufferGeometryUtils`. `lib/three/addons/controls/` is **empty** (no OrbitControls) | `lib/three/addons/` |
| Single scene, single renderer, one WebGL context per beach visit; full dispose on close | `beach3d/beach3d.js:102-171`, `beach3d/world.js:1112` |
| Action bar = native `<button>`s registered via `BeachScene.registerActivity({id, emoji, label, modes, onClick, only3D})` | `js/beach.js:622-763` |
| The old 2D DOM castle builder is hidden in 3D via `HIDDEN_IN_3D = { castle: true }` → our new activity must use a **different id** | `js/beach.js:592`, 2D builder at `js/beach.js:339-468` |
| Walk-then-activate precedent: tap boat hull → programmatic walk target → `board()` on arrival | `beach3d/boat3d.js:132-153, 62-78` |
| Programmatic locomotion: `character.setTarget(x, z, src)`, `clearTarget()`, `setEnabled(false)`, `facePoint(x,z)`, `teleport(x,z)` (QA) | `beach3d/character3d.js:921-952` |
| Sub-modes never move the main camera; they disable locomotion and swap `BeachScene.setMode()`; restore via saved `prevMode` | `boat3d.js:64-96`, `catch3d.js:65-111` |
| Ground height for props = `sandY(x, z)`; props planted via `plantProp(scene, group, x, z, shadowR, shadowOp)` + blob shadow | `world.js:71-78, 341-351` |
| Umbrella at **(-5.4, 1.9)** (post collider r 0.045); playable box x ±6.2, z −9.5…5.0; spawn/rest (0, 2.6) | `world.js:55, 60, 1000-1009` |
| Save: `lily-game-save-v1` top-level keys (`swimStyle` is the template for a new validated key + notify reason) | `js/state.js:29, 219-225, 315-332` |
| Tests: Playwright + Chromium against `http://localhost:8123`; best template is `catch_test.py` (native buttons, mobile + reduced-motion sections, save-unchanged checks) | `beach3d/catch_test.py`, `ground_contact_test.py:enter()` |
| Perf: software renderers capped 30 FPS, `prScale` 0.5 floor; draw-call counts asserted in tests | `world.js:419-424, 1019-1055` |
| Talk lines are short, warm, emoji-suffixed | `js/beach.js:461-467` |

## 2. Approach chosen (after research)

### Options considered

| Option | Idea | Verdict |
|---|---|---|
| **A. Voxel density field + marching cubes** | Sculpt a 3D density grid with round brushes; render as one smooth organic mesh | ✅ Most flexible; looks like real packed sand; trivial persistence (one byte array); one draw call on the beach |
| B. Castle-kit stamping only | Place/stack prebuilt primitives (tower cone, wall block…) | Guaranteed pretty but **not flexible**; placement UX complex; persistence = transform lists |
| C. Heightmap sculpting | Raise/lower a sand patch | Simple but **no overhangs/towers/arches** — kills the castle fantasy |
| D. Separate app/page (own canvas) | Full-screen builder outside the beach | Breaks the "one beach stage" pattern, heavier lifecycle, feels disconnected |

### Chosen: **A + B hybrid**

A voxel **density field** (freeform pile/carve/smooth — maximal flexibility) **plus stamp
brushes** that write classic castle shapes (tower, wall, gate, stairs, moat) into the same
field, **plus** a few non-voxel decorations (flag, shell) stored as small extra records.
Freeform + guaranteed-good-results, one serializable representation, one baked mesh on the
beach. This is the nicest fit for "as flexible as possible" while staying kid-friendly.

Rendering tech: vendor three.js r170's **`MarchingCubes`** addon (single file, MIT,
`three/addons/objects/MarchingCubes.js`) and drive it with `setCell()` from our own
`Uint8Array` grid. Vendor **`OrbitControls`** (`three/addons/controls/OrbitControls.js`)
for the builder camera. No other new dependencies.

Why MarchingCubes over hand-written surface nets: it ships with the exact vendored r170
revision, is battle-tested, ~1 file, and at our 32³ resolution a full rebuild is
sub-millisecond-to-few-ms. (Fallback documented in §11 if the blobby look disappoints.)

## 3. UX flow

1. **Button**: `🏰 Build sand castle` registered by the 3D module (`only3D: true`,
   `modes: ["sand"]`), gated like the boat (hidden during rides/catch). When a castle
   already exists the label becomes `🏰 Edit sand castle`.
2. **Walk-in**: click → button disables → Lily gets a programmatic `setTarget()` to the
   stand point beside the plot (reusing the boat's walk-then-activate pattern, with a
   per-frame arrival check + 6 s timeout fallback). A one-line talk: `"Time to build! 🏰"`.
3. **Enter builder** on arrival: `BeachScene.setMode("castle")`, `character.setEnabled(false)`
   (she stays standing/kneeling at the plot edge, facing the plot), main input released,
   **render loop switches to the builder's own Scene + camera** (main camera untouched —
   nothing to save/restore). A bottom toolbar replaces the action bar (same compact
   mobile pattern as the swim-style selector).
4. **Build**: orbit camera (drag rotate / wheel & pinch zoom), pointer or touch paints
   the field. Autosaves the grid at every stroke end.
5. **Done (💾)**: saves, bakes the field into one static mesh, adds it to the main beach
   scene at the plot (planted on `sandY`, blob shadow, obstacle entry so Lily walks
   around it), returns to `"sand"` mode, plays `Cheer` + talk line
   `"A castle fit for a crab! 🏰"`.
6. **Persistence**: the grid + decorations live in `GameState` → castle survives beach
   close/reopen and full page reload. Re-entering the builder loads the existing field.
7. **Escape** while in builder exits the builder (does **not** close the whole beach) —
   requires a small gate in `js/beach.js`'s Escape handler.

## 4. Architecture

### New files

| File | Role |
|---|---|
| `lib/three/addons/objects/MarchingCubes.js` | vendored r170, header/license intact |
| `lib/three/addons/controls/OrbitControls.js` | vendored r170, header/license intact |
| `beach3d/sandcastle-field.js` | **pure logic**, no three.js: density grid (Uint8Array 32³), brushes (pile/carve/smooth/flatten), stamps (tower/wall/gate/stairs/moat), base plinth + buildable-height mask, undo snapshots, **RLE serialize/deserialize**, template presets |
| `beach3d/sandcastle-editor.js` | builder session: own `THREE.Scene` + camera + OrbitControls + lights (same ambient/dir params as world) + shared sky texture; MarchingCubes mesh rebuilt from field; raycast brush input + cursor ring; toolbar DOM wiring; `renderFrame()` used by the main loop |
| `beach3d/sandcastle3d.js` | integration: activity registration, walk-in flow, mode plumbing, bake-on-exit into main scene, obstacle registration, persistence glue, `dispose()`; exposes `window.__beach3d.sandcastle` test API |
| `beach3d/sandcastle_test.py` | Playwright regression (template: `catch_test.py`) |

### Edited files (small, surgical)

| File | Change |
|---|---|
| `beach3d/beach3d.js` | import + attach sandcastle; in the rAF branch render the editor scene when active (skip `world` render only — **keep** `world.animate(t)` so the sea clock never jumps); add `sandcastle` state to `__beach3d.state()`; unregister on close |
| `beach3d/world.js` | tiny API: `addObstacle(entry)` / `removeObstacle(id)` (obstacle list currently fixed at build: `world.obstacles()`, L1005-1009); export/reuse `blobShadowTexture()` |
| `js/state.js` | new top-level save key `sandcastle` with `getSandcastle()` / `setSandcastle(data)` (validating parse, self-healing on corrupt data, `notify("sandcastle")`) — mirrors `swimStyle` at L219-225 |
| `js/beach.js` | Escape handler gate: if `Beach3D.sandcastleActive()` → exit builder instead of closing the beach |
| `css/style.css` | `.beach-sc-*` toolbar/panel styles (reuse action-button pill look, 44 px targets, height-stable status line) |
| `beach3d/README.md` | document the feature, its controls, save shape and test commands |

### Data model

```
field          Uint8Array(32*32*32)          // density 0 (air) … 255 (packed sand)
   index       x + 32*y + 32*32*z            // y up; cell size = PLOT/32
   footprint   plot 2.2 m × 2.2 m centered at (-3.9, 1.9)   // beside umbrella post (-5.4, 1.9)
   base        bottom 2 layers pre-filled solid in a rounded-square mask → castle
               never floats; brushes may not dig below the base
   height cap  brushes refuse above ~1.4 m (row 20) — keeps her reach believable
decor          [{ t: "flag"|"shell"|"seaweed", x, y, z, r, c }]  // field-space coords
save shape     sandcastle: { v: 1, grid: "<RLE-base64>", decor: [...] }
               worst-case RLE ≈ a few KB → localStorage-safe; >60 KB guard → reject
baked result   one BufferGeometry (MarchingCubes output frozen), MeshToonMaterial in the
               world's sand tone + toon gradientMap, planted at (cx, sandY(cx,cz), cz);
               decor = ≤4 tiny meshes; blob shadow; obstacle { id:"castle", r≈1.15 }
```

MarchingCubes integration notes (from the vendored source): `isolation` ≈ 80, field values
0…~160 (solid sand ≈ 150+); the addon **never polygonizes the outer cell layer** and its
`normal_cache` is not invalidated by `setCell` — so every rebuild is
`reset()` → refill from our grid → `update()` (32³ refill is trivial, and it also
sidesteps stale normals). Mesh lives in normalized −1…1 space → set `mesh.scale` to
plot/2.

### Tools (v1)

| Tool | Effect on field |
|---|---|
| ✋ Pile | add round density brush on surface (raycast to MC mesh, or plot plane when empty) |
| 🥄 Carve | subtract brush (same radius) |
| 🌊 Smooth | local blur of density around the hit point |
| 📏 Flatten | pull density toward the hit plane height in radius |
| 🗼 Tower / 🧱 Wall / 🏰 Gate / 🪜 Stairs | stamps: write cylinder+cone / box / box−cylinder (negative density = arch) / stepped boxes, auto-planted on current surface, preview ghost follows pointer, tap to commit |
| 🕳️ Moat | carve ring stamp |
| 🚩 Flag / 🐚 Shell / 🌿 Seaweed | decor: placed at raycast hit + normal offset; stored separately (not in field) |
| ↩️ Undo / ↪️ Redo | field + decor snapshots, cap 25 |
| 🧺 Reset | double-press inline confirm (no `confirm()` dialogs) |
| 📋 Templates | 3 presets (Classic keep / Big fort / Little mound) that fill the field — one tap each |
| 💾 Done | save + bake + exit (single obvious exit; autosave already covered mid-session) |

Status line (height-stable, `role="status"`) explains the active tool, e.g.
`"Pile: drag to add sand"`. Buttons are native `<button>`s with `aria-pressed` for the
active tool.

## 5. Constraints honored (project conventions)

- **One renderer, one canvas**: builder renders through the same `WebGLRenderer`; no
  context churn. Main scene objects are untouched while the builder is active (the
  established pattern is one scene + visibility toggles; a second *scene* with a branch
  in the render call is the smallest safe extension, and the main camera is never moved
  so there is nothing to restore).
- **Toon look**: builder materials reuse `MeshToonMaterial` + the same gradient ramp,
  ambient 0.65 / directional 1.7 lighting values, shared sky `CanvasTexture`.
- **No new deps** beyond two vendored three.js addon files (same policy as GLTFLoader).
- **Reduced motion**: no idle decor animation (flags park), no camera tween on enter/exit
  (instant swap, optional 0.25 s CSS fade skipped in RM).
- **Mobile portrait (420×720)**: compact bottom toolbar, ≥44 px targets, drag paints,
  one-finger orbit when a tool is "select/decor", two-finger orbit/pinch always; toolbar
  must not resize the stage (action-bar `max-height: 34vh` pattern).
- **Energy**: building costs nothing (precedent: swim style).
- **2D fallback**: without WebGL the button never registers (2D DOM castle remains as-is).
- **Accessibility**: native buttons, `aria-pressed`, keyboard Enter/Space on buttons,
  Escape = leave builder first, status line announced via `role="status"`.

## 6. Performance budget

- Field edits: MC rebuild throttled to ~80 ms during a drag; measured cost at 32³ is a
  few ms even on software GL (only on input, never per frame).
- Baked beach result: **1 draw call** + ≤4 decor meshes + 1 blob shadow (beach scene
  currently asserts modest draw-call totals; +≤6 is the budget).
- No new per-frame work when idle in either mode; builder pause on `document.hidden`
  follows the existing rAF policy.
- Memory: undo snapshots ≤ 25 × 32 KB ≈ 800 KB, freed on exit.

## 7. Persistence & lifecycle edge cases

- Autosave grid on **every stroke end** (crash/context-loss loses nothing), on Done, and
  on any forced exit (beach close, `visibilitychange`).
- Beach `close()` mid-build: save current field, dispose editor, restore `"sand"` mode —
  next `open()` shows the baked castle.
- Corrupt/oversized save → ignored (empty plot), save self-heals on next write.
- `GameState.reset()` naturally clears the castle (whole-save reset, consistent).
- Empty field on Done → nothing baked, button stays "Build sand castle".
- WebGL context loss during build → existing close path disposes; autosave keeps the work.

## 8. Test plan (`beach3d/sandcastle_test.py`, Playwright, port 8123)

Sections (report + screenshots under `/tmp/kilo/sandcastle/`, `check()` helper,
`enter()` reused from `ground_contact_test.py`):

1. **Desktop flow**: button visible in `"sand"` mode → click → Lily walks near umbrella
   (anchor within ~1.3 m of plot) → builder opens (`setMode("castle")`, toolbar present,
   locomotion disabled) → native pointer paint changes voxel stats → Done → baked mesh
   exists in main scene, obstacle blocks her path, button now says "Edit".
2. **Persistence**: close & reopen beach → castle mesh still present; reload page →
   still present; `localStorage["lily-game-save-v1"]` contains valid `sandcastle`.
3. **Edit re-entry**: Edit loads previous grid (field hash equal) → modify → Done →
   mesh updated, still one draw call budget.
4. **Undo/Reset/Templates**: undo restores hash; template fills field; reset double-press
   clears.
5. **Escape & lifecycle**: Escape exits builder only; closing beach mid-build saves and
   disposes; reopen clean; `world.stats().calls` within budget.
6. **Mobile 420×720**: toolbar layout, touch paint works, Menu/actions bar unaffected;
   stage size unchanged while building.
7. **Reduced motion**: enter/build/exit with `reduced_motion='reduce'`, no animation
   errors, status text intact.
8. **No-op safety**: opening builder and leaving with no edits leaves the save byte-identical.
9. Test API: `window.__beach3d.sandcastle = { active, stats(), gridHash(), enter(), exit(),
   applyTemplate(i), paint(x,y,z,d) }` for deterministic checks, alongside real pointer tests.

## 9. Implementation order (small sequential tasks)

1. Vendor `MarchingCubes.js` + `OrbitControls.js` (r170) into `lib/three/addons/…`; smoke-import.
2. `sandcastle-field.js`: grid, brushes, stamps, masks, RLE, templates (pure JS, no three.js).
3. `state.js`: `sandcastle` key + get/set + validation + `notify("sandcastle")`.
4. `sandcastle3d.js` skeleton: activity button, walk-in flow, enter/exit mode plumbing
   (editor scene still empty), bus gating, Escape gate in `beach.js`.
5. `sandcastle-editor.js`: scene/lights/sky/orbit camera + render branch in the loop;
   verify open/close & camera restore.
6. Field → MarchingCubes mesh; brush raycast input; cursor ring; rebuild throttle.
7. Toolbar DOM + CSS; tool switching; status line; undo/redo/reset/templates.
8. Stamps + decor placement.
9. Exit bake: static mesh + shadow + obstacle (`world.addObstacle/removeObstacle`) +
   Cheer/talk + button label switching to "Edit".
10. Persistence glue + autosave-on-stroke + load-on-open + close-mid-build path.
11. `sandcastle_test.py` sections 1-9; fix fallout.
12. README documentation + final QA screenshots + perf snapshot.

## 10. Non-goals (v1)

- Multiple castles / free plot placement (save format keeps an `id` field so this can be
  added later). The plot is fixed beside the umbrella, per the requested flow.
- Physics (erosion, tide damage), multi-texture sand layers, sharing/exporting designs.
- Any change to the existing 2D DOM castle builder (stays hidden in 3D, untouched).

## 11. Key defaults (decision record)

| Decision | Value |
|---|---|
| Activity id / emoji / label | `sandcastle` / 🏰 / "Build sand castle" → "Edit sand castle" |
| Plot center / size / resolution | (-3.9, 1.9) / 2.2 m square / 32³ (cell ≈ 6.9 cm) |
| Stand point / face target | (-2.55, 1.9) facing the plot (dry sand, clear of post & camera) |
| Build height cap | ~1.4 m (row 20) |
| New mode name | `"castle"` (bar-level), camera untouched (overview continues to exist beneath) |
| Save key / notify reason | `sandcastle` / `"sandcastle"` |
| Isolation / solid density | 80 / ~150 (scaled 0…255 → 0…~160) |
