# beach3d — 3D Lily animation pack (B0)

`assets/lily4_full.glb` contains the shared Lily/friend body, three swimsuit
geometry groups, and **eight** retargeted Mixamo clips on the 65-joint
`LilyRig`. The body-quality pass corrects outward skin surfaces, connects
the upper body and hands, and replaces overlapping foot pieces with continuous
leg/foot surfaces. Garments retain the material and variant names used by
the runtime appearance setters.

The mesh layout is not byte-compatible with the original Walk reference.
The shared skeleton/rest transforms and animation tracks remain compatible;
`spike3/blender/build_lily4_full.py` checks Walk against
`spike3/assets/lily4_walk.glb` with a tolerance of 1e-4. The accepted head,
face UVs, and head-up Swim orientation are preserved.

## Clips

The mesh ranges below are historical B0 measurements, not clearance guarantees
for the revised body. Check the current skinned surfaces in their posed state
when changing ground contact, garment fit, or ride attachment heights.

| name | mode | frames | duration (s) | mesh z-range (m) | loop seam (trans / rot, first vs last sample) |
|---|---|---|---|---|---|
| Walk | loop | 32 | 1.033 | −0.144 … 0.992 | 2.8e-5 / 4.7e-5 |
| Idle | loop | 299 | 9.933 | −0.016 … 0.990 | 2.9e-5 / 2.7e-6 |
| Swim | loop | 137 | 4.533 | −0.163 … 0.406 | 2.2e-5 / 9.6e-5 |
| Sit | loop | 64 | 2.100 | −0.110 … 0.810 | 2.3e-5 / 2.7e-4 |
| Paddle | loop | 218 | 7.233 | −0.333 … 0.562 | 1.9e-5 / 4.1e-4 |
| SurfRide | loop | 31 | 1.000 | −0.170 … 0.800 | 3.2e-5 / 5.4e-7 |
| Cheer | one-shot | 88 | 2.900 | −0.037 … 0.959 | n/a |
| Greet | one-shot | 17 | 0.533 | −0.006 … 1.005 | n/a |

30 fps throughout. Every looper's last frame duplicates frame 1 (authored by
Mixamo, kept on purpose): three.js `LoopRepeat` then plays a seamless
C1-continuous cycle, and `AnimationClip.duration` reads one frame longer than
the table (sampling starts at t = 1/30 s, e.g. Walk = 1.067).

## Notes for the game side

- **In-place:** `mixamorig:Hips` LOCATION channels are exactly constant per
  clip (verified 0.0 dev in the GLB) for all clips **except Walk**, which
  intentionally keeps Walking.fbx's authored ±4 cm root sway because its
  tracks are bit-identical to the approved `lily4_walk.glb` (regression
  worst-diff 1.4e-5 < 1e-4).
- **Stance heights** (three.js bone y at mid-frame, node origin = feet plane):
  standing clips hips ≈ 0.30–0.34, head-top ≈ 1.0. **Sit**: hip/seat ≈ 0.32
  above origin and toes −0.11 **below** it — the clip is a chair-sit: place the
  node so the seat lands on a ~0.35 m bench, or lift the origin by 0.11 m.
  **Swim**: head-up freestyle (converted from a face-down crawl in
  `build_lily4_full.py` §6c); with the node origin `SWIM_SINK = 0.065` m
  below the surface the waterline sits at the chin/upper-chest — face just
   clear and facing forward, back + shoulders at the surface, hips/legs
  submerged and visible through the 0.9-alpha toon water.
  **Paddle**: low kneel on the board, head
  ≈ 0.21, hands sweep down to ≈ −0.26 (below the deck). **SurfRide**: deep
  balanced crouch, hips ≈ 0.15, head ≈ 0.46, mesh sinks to −0.17 at wobble
  extremes (fine when parented to a board).
- **Cheer** (2.9 s) and **Greet** (0.53 s) are one-shots: play with
  `LoopOnce` + `clampWhenFinished` (or crossfade back to Idle; Greet's last
  pose is already near-rest).
- Workbench previews: rerun the build script (writes `/tmp/kilo/prev5/*.png`);
  runtime test bench: `spike3/clips3.html` (serve repo root, open
  `/spike3/clips3.html`), captures via `spike3/shots5/make_shots5.py`
  → `spike3/shots5/<Clip>-f<k>[-side].png`.

## Rebuild

```sh
/usr/bin/blender --background --python spike3/blender/build_lily4.py
/usr/bin/blender --background --python spike3/blender/build_lily4_full.py
```

Rebuild the base model first after geometry changes; the full-pack builder
imports `spike3/assets/lily4.glb`. Runtime skin uses outward-facing surfaces
with `FrontSide`, including when two-piece swimsuits expose the torso.

## Ground contact and validation

`character3d.js` resolves land height from the current blended skin pose,
using a bounded support set sampled from the loaded feet and Idle/Walk clips.
It targets 3 mm of sole clearance against `sandY` at each support point.
This replaces the historical clip-wide Walk/Idle lifts; the old mesh minimum
alone is not a suitable root-height correction for every frame of a stride.
Water transitions remain eased, and boat/surf attachment heights bypass this
land correction.

With the game served on port 8123, run in a Python environment with Playwright
and its Chromium browser installed:

```sh
python3 beach3d/ground_contact_test.py --shots --label local
```

The test independently scans skinned foot/ankle vertices, records the loaded
GLB hash, and checks cycles, slopes, interrupted fades, and shore transitions.
Reports and optional screenshots go to `/tmp/kilo/lily-improvements/`.

Limits: this is vertical grounding, not horizontal foot locking or IK.
Swim-to-wade feet can briefly remain below wet sand during the 0.30 s pose
transition before settling. Extreme raised-arm Cheer poses also retain some
underarm compression; successful clip-copy and rest-topology checks do not
constitute an exhaustive posed collision audit.

## Blender 5.0 gotchas (both hit, both solved in the script)

1. `bpy.ops.import_scene.fbx` is **broken** in Blender 5.0 — the script calls
   the addon directly: `from io_scene_fbx import import_fbx;
   import_fbx.load(Shim(), bpy.context, filepath=…)` with a tiny `report()`
   shim object.
2. Blender 5.0 slotted actions removed `action.fcurves` — all F-Curve access
   goes through `action.layers[*].strips[*].channelbags[*].fcurves`
   (`collect_fcs()` in the script).

## Manual overview camera

`world.js` owns one fixed beach overview for walking, swimming, duck boating,
and surfing. There is **no zone-driven follow, recentering, or automatic zoom**.
The original default pose is preserved: position `(0, 3.6, 10.4)`, target
`(0, 1.66, 2.64)`, FOV `38`. The larger sea moves the visible horizon slightly
upward without moving the camera.

- Manual distance factor: **0.55 to 1.6**, default `1`; smaller is closer.
  Position is always `target + (base - target) * zoom`. Orientation and FOV
  remain fixed; only a resize changes the aspect projection.
- Wheel up, `+`, `=`, and `NumpadAdd` zoom in. Wheel down, `-`, and
  `NumpadSubtract` zoom out. Two-finger spread zooms in; squeeze zooms out.
- Wheel/key deltas accumulate on `world.zoomTarget()`, not the eased
  `world.zoom()`. Key repeats are clamped to the range. Editing fields and
  Ctrl/Meta/Alt shortcuts are ignored; the document listener is removed on close.
- `world.setZoom(k)` and `__beach3d.setZoom(k)` remain available. Easing snaps
  exactly to the requested value on settle and persists across stance changes.
- Press-hold locomotion, boat steering/coasting, surf carving, and Space-hold
  wave catching retain their existing input contracts. No free camera panning
  is added. Distant swimmers remain small, and lateral edges can be offscreen
  in portrait or close zoom; zoom out for the wider overview.

`__beach3d.state()` exposes `cam`, full-precision `camFull`, `camMode` (always
`overview`), `zoomTarget`, and diagnostic-only `rideAnchor`. `camStep` and
`camSpeed` are get-and-clear maxima of manual zoom travel; without zoom input
both remain zero across zone/ride changes. `renderer` now includes `prScale`.

## Sea, sky, and range

- Water remains unlit `MeshBasicMaterial` with vertex colors and opacity `0.9`.
  The offshore/mid/shallow blues are `#246bc1`, `#388fda`, and `#78bdf0`;
  the surf face shares the deep blue and lifts toward `#65b0ed` at the lip.
  Waterline and foam behavior, character skin, and attachment heights are unchanged.
- Three soft cloud groups share one cached canvas texture/material. Two small
  gently flapping gulls share one ten-triangle batch. Like the sun, they occupy
  viewport-relative sky positions, away from the controls and horizon. Total
  added sky cost: **4 draw calls, 16 triangles, 1 texture**. No per-frame canvas
  painting, spawning, reflections, postprocessing, or new dependencies.
- `WORLD.box.zMin = -9.5` is the shared swimmer/target/teleport deep limit.
  `SEA_DEEP_Z` aliases it. Surf spawns `0.8 m` farther out at `-10.3`; its
  QA swimmer placement is `zMin + 0.8`. Catching waits until the board's
  `crestZ + 0.3` pocket is also inside the playable box.
- Water and seabed extend to `-12.2`, containing the whole surf profile
  `[-1.55, 1.05]` plus its up-to-`0.17 m` ripple. Surface damping and the blue
  gradient use that far edge; the decorative wave bands are redistributed.
  Rendered planes extend to `x = +/-32`, with sand behind the camera view to
  `z = 12`. Grid budgets stay **64 x 40 water**, **56 x 48 sand**; the surf
  profile retains its **80** horizontal segments.
- Wave speed stays **1.1 m/s toward +z**, with unchanged opt-in and Space-hold
  semantics. The extra `3 m` adds about **2.73 s** to a comparable early ride.
  Browser QA measured catch-to-landing at **6.53 s baseline / 9.25 s extended**.
- Boat depth is inset `0.4 m` from the shared deep limit (`-9.1`). Its lateral
  bounds inset `0.2 m` from the playable box so the offset seat stays legal.
  Surf carving, its following board, and its parked board use the shared x bounds.

Reduced motion freezes the decorative clock: water, shore foam, wave-sheet
offsets, clouds, and gulls are not rebuilt when that clock is unchanged.
Manual zoom, positional control, shoreward surf travel, and VFX fading continue.
Unlit water no longer recomputes unused vertex normals each frame.
Desktop, 420x720 portrait, wide zoom limits, repeated
open/close, and the unchanged `ground_contact_test.py` were checked. Headless
browser frame rate is not evidence of hardware GPU performance.

## Performance and lifecycle

The actual rendering context, not just the antialiasing probe, selects the
budget: known software renderers (SwiftShader, llvmpipe, softpipe, WARP, etc.)
render at up to **30 FPS**; hardware and unknown backends at up to **60 FPS**.
Masked WebKit/ANGLE identities alone are reported as unknown, not hardware.
No telemetry, driver changes, or browser flags are required by the game.

Software rendering explicitly starts at the existing **0.5 pixel-scale floor**
times device DPR capped at 2. This trades sharpness for resource savings rather
than spending the frame cap's savings on a higher resolution. At device DPR 1,
a 1280x652 stage renders at 640x326. Hardware/unknown start at scale 1 and retain
the previous downward adaptation toward 0.5; slow-window thresholds are relative
to the selected frame cap. Frame rate alone does not measure CPU/GPU efficiency.

RAF deadlines retain their phase across 90/120/144 Hz displays; skipped render
callbacks still contribute elapsed time to the unchanged locomotion substeps
and shoreward wave speed. Hidden documents cancel RAF, release held input, and
resume with a fresh time origin. Blur releases pointer, ride, and Space holds;
zoom repeats after blur need a new press. Closing removes canvas and global
input/visibility listeners, disposes resources, and explicitly loses the permanently retired
renderer context. Cached JS cloud/wave/gradient textures upload into the next
visit's new context; a retained JS context wrapper is not a live GPU context.

While the beach is open, inspect locally in the browser console:

```js
window.__beach3d.performance()
```

The detached diagnostic snapshot includes Three.js revision, WebGL version,
masked/unmasked vendor and renderer (when available), backend classification,
device and actual pixel ratios, drawing-buffer size, configured/effective frame
caps, FPS, pause state, context-loss status, draw calls, triangles, and resource
counts. It returns `null` after close; changing a snapshot does not change policy.

With the existing server on port 8123 and Python Playwright/Chromium installed,
run the bounded scene/control/lifecycle regression in a fresh isolated context:

```sh
python3 -B beach3d/scene_test.py
```

It reuses the grounding test's entry helper, checks native controls and a full
early surf ride, and writes `/tmp/kilo/beach-polish/scene-test.json`. Synthetic
visibility and actual-source-function pacing/long-stall FPS shims verify policy;
they are not native OS-visibility tests or hardware GPU benchmarks. The test does
not start/stop the server or touch a user's browser profile.
