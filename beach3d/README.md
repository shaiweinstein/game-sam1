# beach3d — 3D Lily animation pack (B0)

`assets/lily4_full.glb` contains the shared Lily/friend body, three swimsuit
geometry groups, and **nine** clips (eight accepted Mixamo-based clips plus
the isolated stylized `SwimFreestyle`) on the 65-joint
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
| SwimFreestyle | loop | 137 | 4.533 | measured against live water below | world-pose seam 5.9e-5 |
| Sit | loop | 64 | 2.100 | −0.110 … 0.810 | 2.3e-5 / 2.7e-4 |
| Paddle | loop | 218 | 7.233 | −0.333 … 0.562 | 1.9e-5 / 4.1e-4 |
| SurfRide | loop | 31 | 1.000 | −0.170 … 0.800 | 3.2e-5 / 5.4e-7 |
| Cheer | one-shot | 88 | 2.900 | −0.037 … 0.959 | n/a |
| Greet | one-shot | 17 | 0.533 | −0.006 … 1.005 | n/a |

30 fps throughout. Loop endpoints match within the clip's measured tolerance.
The new action also canonicalizes exported quaternion signs without modifying
the original tracks. `AnimationClip.duration` reads one frame longer than
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
  **Swim**: the accepted head-up swim (converted from a face-down source in
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

## Wardrobe hairstyles

The pack contains `Hair_hair1` through `Hair_hair6`: center-part long curtains,
curly pigtails, a shorter bob, swept ponytail, space buns, and big curly hair,
following the six existing 2D catalog silhouettes. Each has its own closed
scalp and shares the 65-bone rig. Compact parts follow Head; long curtains
and the ponytail blend toward Spine. This is skinned hair, not hair physics.
Long curtains still briefly intersect the recovery arm in enlarged Swim side
views (frames 35/103); the ponytail's prone bend is stylized rather than physical.

`setHair(id)` selects mesh primitives, never shared material visibility.
`syncAppearance()` reads the existing saved `outfit.hair`; hair adds no new
preference or migration. Invalid/unavailable hairstyles render `hair1` without
changing the save. All hidden hair materials follow friend palette changes;
pink ties stay fixed. The clips workbench also defaults to just `hair1` and
has a hairstyle selector.

Head/face geometry, UVs and texture are unchanged. The eight original clips,
including the approved head-up `Swim`, remain unchanged. For geometry-only
rebuilds, set `LILY_REFERENCE_GLB` to an accepted full-pack GLB to additionally
require exact equality of every named animation track. `LILY_SKIP_PREVIEWS=1`
skips Blender still rendering; use the workbench and live beach for art review.

## Swim Style

The 3D beach action bar has a native, labeled `Head-up` / `Freestyle` selector.
It is available on shore and during rides, has a 44 px touch target, and does
not resize when its value changes. Space retains native UI behavior on focused
controls; focus/click the beach canvas for the existing hold-to-catch behavior.

On phones, select **Start surfing**, swim offshore, then use **Catch wave**.
Tap when a wave reaches the swimmer, or tap offshore to wait for the next wave
without keeping a finger down. **Cancel catch** cancels that queued catch.
Holding also works; releasing a long hold cancels the hold. Drag on the play
area to steer once riding. Blur, hidden tabs, action-bar replacement, stopping
surfing, and closing the beach clear queued catches and touch holds. Space and
touch holds are tracked independently; keyboard and assistive-technology
button clicks also work. On phones the primary controls stay in a compact
bottom toolbar; **Menu** contains the other activities and swim-style selector.
The speech bubble overlays the sky rather than shrinking the play area.

Movement is **press and hold**, not click-to-swim. Releasing to choose a style
rests in the original, face-visible Head-up float; selecting a style never
starts movement. Press and hold water again to use the chosen stroke. Freestyle
needs deeper water: from shore, hold farther toward the horizon until the
visible status says **Swimming Freestyle**. Drag while holding to change direction.
The fixed-height status below the selector always distinguishes the saved
selection from resting, shallow Head-up, active swimming, and a boat/surf ride's
next-swim preference. It also explains deliberately parked reduced-motion poses.
This is visible on touch screens and associated with the native selector, not
only a tooltip. Neither changing style nor changing status resizes the stage.

`GameState.getSwimStyle()` / `setSwimStyle()` persist a single top-level behavior
preference in the existing `lily-game-save-v1` save, not in the outfit or per
friend. Missing/invalid saves and reset default to `head-up`; changes notify
with reason `swimStyle`, cost no energy and leave location/outfit unchanged.
The existing reset reason and wardrobe Undo metadata remain intact.

| Selection | Moving Clip | Sink | Released/Idle | Reduced-Motion Moving Pose |
|---|---|---|---|---|
| Head-up (default) | Swim | 0.065 m | Original Swim float, 0.25x | Original 1.13 s park |
| Freestyle | SwimFreestyle in safe depth; otherwise Swim | 0.090 m freestyle / original 0.065 m Head-up | Crossfade to original head-up float, preference retained | Side breath at 2.678 s, or original Head-up park in shallows |

Both use the unchanged speed-following 0.5-1.4x gait range, movement speeds,
0.30 s pose crossfade and root-height damping rate 9/s. Freestyle returns to
float as soon as movement is released, while the existing glide finishes.
Interrupted style fades start from normalized live weights, preserve a running
contributor's phase, and settle to one of the nine cached actions. Style changes
do not reset anchors/targets, tilt the runtime root, interrupt land/ride clips,
reload the GLB, or alter the camera.

Freestyle has a small, hysteretic depth guard: enter at **0.405 m** effective
depth, and return to Head-up below **0.380 m** (2.5 cm hysteresis). This is a
conservative clearance depth, not just the instantaneous water depth at the
hips. It checks the seabed 0.41 m shoreward of the anchor and of the predicted
anchor after the existing 0.30 s crossfade, using current velocity. The reach
covers the measured 0.385 m foot envelope at any yaw and the curved shoreline's
lateral slope. The reference surface is `WORLD.water.y - 0.061`, below the
analytic waves' maximum 0.0604 m downward excursion, so a crest cannot enable
an unsafe stroke and passing waves cannot flap the guard.

The depth requirement was measured from 2,594 skinned foot/ankle vertices:
273 half-frame samples need 0.194279 m for the freestyle kick itself. Sampling
32 starting phases in each fade direction found a larger 0.364145 m requirement
during blends; the exit threshold reserves over 1 cm beyond that envelope.
The policy changes only effective clip/profile selection. It does not lift the
root to hide contact, modify sink values, add IK, or alter the seabed. The saved
preference stays `freestyle` while shallow water uses the approved Head-up
stroke. Physical depth readiness is tracked during both styles' swim/float
states, independently of the preference. Float remains Head-up; release,
Head-up selection/swimming, and Freestyle re-selection inside the hysteresis
band all retain that history. Unsafe depth (including lookahead), land, rides,
and reset clear readiness. Fresh entry into the band cannot gain readiness
until reaching the proper enter depth. The on-screen status tells
the player when Head-up is being used and how to reach Freestyle water without
changing the saved selection or moving the character automatically.
`__beach3d.action().swimDepthGuard` exposes `active`, conservative `depth`,
`enter`, and `exit`; the existing `clip` field remains the effective clip.

The builder copies the processed crawl before section 6c. Its source arm sweep
was too symmetric for freestyle, so section 6d authors alternating overarm
recovery/catch/pull, a flutter kick, and modest axial torso roll only on that
copy. The face normally points down; one smooth right-side breath coincides
with recovery. Both face and projected crown orientation are solved throughout,
with unit quaternions and matching loop endpoints. Elbow orientations interpolate
between stroke landmarks in joint space to avoid a rapid wrist twist during
recovery; the exported minimum adjacent quaternion dot is 0.9844. The original head-up solver
and all eight accepted tracks stay unchanged.

At the fixed QA anchor/wave phase, a 137-pose scan against `waterSurfaceY` gave
these signed skin clearances (metres, negative means immersed): freestyle mouth
-0.126 to +0.145, nose -0.119 to +0.146, chest -0.092 to -0.070, back +0.042 to
+0.064, hip -0.087 to -0.070. Head-up mouth stayed +0.259 to +0.290. These are
landmarks on the actual skin, not hair bounds or bone-origin proxies; moving
waves vary the exact values. The intentional side-breath tilt is not a fixed
upright crown constraint. The large stylized head can obscure the far recovery
arm, and long hair still bends/overlaps stylistically rather than physically.
The depth guard removes the extra shallow-entry overlap without changing the
accepted Head-up contact limitation. The original 360-step shallow out/back
audit now matches Head-up exactly (positive numbers below are overlap metres):

| Contact Sample | Head-up | Unguarded Freestyle | Guarded Freestyle |
|---|---:|---:|---:|
| Worst shallow out/back | 0.150867 | 0.199566 | 0.150867 |
| Worst wet-sand exit | 0.087445 | 0.073777 | 0.087445 |
| Exit after pose fade | 0.002860 | 0.002160 | 0.002860 |

Eight additional paired entry/exit paths at x=-2 and x=+2, with short/shallow
and full deep round trips, matched Head-up's worst entry/exit bounds in both
animated water and reduced motion. Anchor deltas were zero. Every sampled
pose with a freestyle contribution, including fades, cleared the seabed:
minimum 0.197468 m in animated deep trips and 0.358546 m in RM deep trips.
Both hysteresis histories stayed on their respective clips during 12-second
along-threshold traversals in each motion mode; animated water varied by over
0.10 m without a guard transition. A direct pre-guard runtime comparison also
confirmed identical Head-up entry/exit, anchor paths and fade weights.

Run the bounded style regression, including exact original tracks, rig and
images, unchanged deep loop/face/crown/water gates, guarded entry/exit and
threshold paths, fades, RM, persistence and layout:

```sh
python3 beach3d/swim_style_test.py
python3 beach3d/swim_style_test.py --reference /path/to/accepted-hair-full.glb
python3 beach3d/swim_style_test.py --out /tmp/kilo/swim-style/guard
python3 beach3d/swim_switch_test.py --out /tmp/kilo/swim-switch-fix/native
python3 beach3d/ground_contact_test.py --swim-style freestyle --label freestyle --out /tmp/kilo/swim-style
```

`swim_switch_test.py` exercises the real native selector and mouse/touch
press-hold, release and repress from shore at 1280x800 and 420x720. It records
near/mid/deep Head-up -> Freestyle -> Head-up flows, pointer capture/focus,
selected/requested/effective style, live action times/weights and actual skinned
mesh poses. Its filmstrips are advancing gameplay, not injected clip times or
programmatic locomotion targets. `--baseline` records the pre-fix missing-feedback
behavior without requiring the visible status regression to pass.
The same test covers rapid/repeated selections, live appearance notifications,
native RM movement, delayed character loading, Wardrobe/Continue followed by a
shore-to-Freestyle hold, reset, and next-swim selection during boat/surf rides.
`--extras-only` runs these lifecycle checks without recapturing the matrix.
`swim_style_test.py` additionally checks the formerly broken float/reselect/
restart sequence inside the guard's hysteresis band in both motion modes.
`swim_switch_test.py --hysteresis-only` focuses on native deep-to-band travel,
Head-up/Freestyle detours with holds/releases and rapid selections, followed by
unsafe exit and re-entry. The deterministic guard checks pin the same histories
at 0.389 m and immediately either side of the enter/exit thresholds.

`--reference` additionally requires exact equality of every mesh attribute,
index and embedded image, including the six accepted hairstyles. Reports and
style screenshots default to `/tmp/kilo/swim-style/`. Existing appearance,
ground and scene tests accept `--out` to keep this mission's evidence separate.
The guard follow-up evidence is under `/tmp/kilo/swim-style/guard/`, including
`guard-paths.json`, `head-up-unchanged.json`, `ground-guarded.json`, native UI/ride
results and shallow/deep control screenshots. Asset/builder SHA-256 checks
confirm that this runtime-only follow-up changed no GLBs, tracks or hairstyles.
The asset grows by 151,772 bytes from the accepted hair pack to 5,544,456 bytes;
style switching adds no meshes, draw calls or texture allocations.

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
python3 beach3d/appearance_test.py
python3 beach3d/scene_test.py
```

The test independently scans skinned foot/ankle vertices, records the loaded
GLB hash, and checks cycles, slopes, interrupted fades, and shore transitions.
Reports and optional screenshots go to `/tmp/kilo/lily-improvements/`.
The bounded appearance test covers all six styles/four palettes, pre-load and
fallback selection, the real wardrobe return/reload flow, offline switching,
and warmed context cleanup. Its report and screenshots go to
`/tmp/kilo/beach-hair/`.

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

## Swimmer camera and manual zoom

`world.js` smoothly follows the swimmer during both swimming and resting floats.
Walking, duck boating, and surfing return to the overview height and depth.
Portrait views keep tracking the player's horizontal position during those
modes so an off-center ride or landing cannot lose her offscreen. Ball catch
retains its centered two-character view.
There is **no automatic zoom**, including on entry, release, style selection,
boarding, landing, or resize. The user's chosen distance factor is retained.
The original default pose is preserved: position `(0, 3.6, 10.4)`, target
`(0, 1.66, 2.64)`, FOV `38`. The larger sea moves the visible horizon slightly
upward without moving the camera.

- Manual distance factor: **0.37 to 1.6**, default `1`; smaller is closer.
  The fixed floor keeps large hair and prone freestyle readable in portrait;
  0.30 clipped those bounds. There is no aspect-dependent or automatic zoom.
  Compared at the same focused pose, 0.37 is 32.7% less camera distance than
  the old 0.55 floor (2.96 m versus 4.40 m), with 1.51x projected body height.
  Position is `smoothedFocus + (originalBase - originalTarget) * zoom`.
  The fixed offset gives the same distance at every swim depth/direction.
  Orientation stays fixed. Resizing retains at least 38 degrees of horizontal
  field of view: portrait screens expand vertical FOV to fit side-on strokes
  in the taller play area, without changing the chosen distance factor.
- Swim focus uses anchor x/z and static waterline + **0.05 m** (y = 0.17),
  independent of heading, style, hair, breath, root height and animated waves.
  A critically damped spring at **24/s** retains velocity across entry/exit,
  with about 0.1 m following lag at full swim speed. Spring displacement limits
  long transitions to at most **8 m/s**, well above the 1.32 m/s swim speed.
  Integration slices of at most 1/120 s keep that bound consistent across frame
  rates; the camera matrices and sky placement update only once per frame.
  Reduced motion retains the same functional, non-bobbing tracking.
- Wheel up, `+`, `=`, and `NumpadAdd` zoom in. Wheel down, `-`, and
  `NumpadSubtract` zoom out. Two-finger spread zooms in; squeeze zooms out.
- Wheel/key deltas accumulate on `world.zoomTarget()`, not the eased
  `world.zoom()`. Key repeats are clamped to the range. Editing fields and
  Ctrl/Meta/Alt shortcuts are ignored; the document listener is removed on close.
- `world.setZoom(k)` and `__beach3d.setZoom(k)` remain available. Easing snaps
  exactly to the requested value on settle and persists across stance changes.
- Press-hold locomotion, boat steering/coasting, surf carving, and Space-hold
  wave catching retain their existing input contracts. No free camera panning
  is added. Dragging re-aims through the current camera; a stationary hold keeps
  its world target. Land/ride subjects can be outside a tightly zoomed overview;
  zoom out for the wider scene.

`__beach3d.state()` exposes `cam`, full-precision `camFull`, `camMode`
(`overview` or `swimmer`), smoothed `camFocus`, `zoomTarget`, and diagnostic-only
`rideAnchor`. The mode identifies the requested focus even while transitioning.
`camStep` and `camSpeed` are get-and-clear maxima of camera travel, including
follow and transitions. Settled overview without zoom has zero travel.
`renderer` includes `prScale`.

Run `python3 -B beach3d/camera_test.py` for native controls, deterministic follow
and smoothing checks, posed skin bounds, and full-viewport screenshots under
`/tmp/kilo/swimmer-camera/`. Posed checks are labeled separately from native
camera/input screenshots; no visual helper overrides the camera.
The bounds matrix covers 1280x800, 420x720 and 320x568, including steady
movement lag. The short 320px viewport checks camera fit only: its existing
page controls overflow vertically, and this camera change does not reflow them.

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

## Sand castle builder

The 3D beach action bar's 🏰 button (activity id `sandcastle`, modes
`["sand"]`, `only3D`; the 2D DOM builder keeps the `castle` id, which
`js/beach.js` hides in 3D) starts with a walk: Lily walks to the plot beside
the umbrella — plot center `(-3.9, 1.9)`, 2.2 m square; stand point
`(-2.55, 1.9)` — and the builder opens on arrival (anchor distance
< 0.35 m, 6 s walk timeout; the button is disabled while walking). The beach
switches to mode `castle`, which renders the action bar empty. Re-registering
the same activity id flips the label between "🏰 Build sand castle" and
"🏰 Edit sand castle" whenever a baked castle exists.

**Scene and camera model.** The builder session
(`beach3d/sandcastle-editor.js`) owns a private `THREE.Scene`,
`PerspectiveCamera`, and vendored three.js r170 `OrbitControls`
(`lib/three/addons/controls/OrbitControls.js`), rendered through the beach's
single `WebGLRenderer` and canvas — one context, one canvas; the main beach
scene and camera are never touched while a session is open, so there is
nothing to restore. Default pose: camera `(-3.9, 2.6, 4.4)` looking at
`(-3.9, 0.35, 1.9)`. `world.animate()` keeps running every frame; the
builder's per-frame `renderFrame()` only replaces `world.render()`, so the
sea clock never jumps and the beach resumes seamlessly on exit. The shared
canvas handlers (press-hold locomotion, beach zoom) go quiet while the
builder or its walk-in is active — `OrbitControls` listens on the same
element. Lily is hidden (`setEnabled(false)`) and faces the plot while
building.

**Field and tools.** The voxel field is a 32³ `Uint8Array`
(`beach3d/sandcastle-field.js`, pure logic, no three.js, no DOM; index
`x + 32y + 1024z`): density 0 = air, 255 = packed sand, `SOLID = 160` is the
stamp write target. Rows 0–1 are a protected tapered base plinth the brushes
and stamps can never enter (`modifiable()` gates rows 2–20); row 20's top
sits ≈ 1.44 m above the sand at `CELL = 2.2/32 ≈ 0.06875 m` per cell. The
mesh is the vendored r170 `MarchingCubes` addon
(`lib/three/addons/objects/MarchingCubes.js`) at resolution 36, isolation
80, triangle cap 30,000, with the grid copied into MC samples at a +2 offset
(without it our cells would land at samples 1..32, leaving the outer `0/1`
and `32/33` crossings undrawn — open skins at the plot rim). Field values
are raw byte densities; isolation 80 puts the surface ≈ 0.31 cell from the
air side, and 255-density skins bulge ≈ 0.19 cell (~1.3 cm) above a row top.

| Tool | Kind | Input | Notes |
|---|---|---|---|
| ✋ Pile / 🥄 Carve | brush, drag-paint | left-drag | ±56 density per application, ≈ 15 cm radius (2.2 cells) |
| 🌊 Smooth / 📏 Flatten | brush, drag-paint | left-drag | soft radius 2.5 cells; Flatten levels to the raw height under the pointer at stroke start |
| 🗼 Tower / 🧱 Wall / 🏰 Gate / 🪜 Stairs / 🕳 Moat | stamp, tap-to-commit | one pointerdown | anchors clamped 4 cells inside the plot rim (5–27); a sky click commits nothing |
| 🚩 Flag / 🐚 Shell / 🌿 Seaweed | decor, tap-to-commit | one pointerdown | ≤ 12 records, oldest dropped; sunk 0.012 m into the row top |

Stamps and decor commit exactly once on pointerdown; the rest of the gesture
is swallowed (no drag-painting). Undo/Redo keep 25 levels of 32 KB snapshots
— one per paint stroke, stamp, decor add or template fill — and the stacks
are session-local (fresh on every builder entry). The three template presets
(🏰 Keep / 🏰 Fort / 🏰 Mound) clear the field but keep decor: presets are
ground plans, and collected shells survive trying a layout. 🧺 Reset is a
double-press arm (3 s, red outline while armed): the confirmed reset clears
field, decor and both stacks and is deliberately undo-free.

**Controls.** Left-drag paints; Shift+drag, Ctrl/Meta+drag, right-drag or a
second finger orbit; middle-drag, wheel and pinch zoom. The mapping rides
an r170 `OrbitControls` quirk: `mouseButtons = { LEFT: PAN, MIDDLE: DOLLY,
RIGHT: ROTATE }` with `enablePan` false — with LEFT=PAN, shift/ctrl/cmd+left
substitutes ROTATE for PAN, so a plain left-drag is inert to the controls
(paint wins) while Shift+left-drag orbits; `touches = { ONE: null,
TWO: DOLLY_ROTATE }` keeps one-finger painting and two-finger
dolly-rotate. The editor's pointer handlers are registered before the
controls are constructed, so they run first (same-element listeners fire in
registration order); a second finger landing while a stroke is live hands
the gesture to `OrbitControls`. While a drag paints, rebuilds throttle to
every 80 ms (the brush still applies on every qualifying move).

**Toolbar and accessibility.** `#beach-sc-toolbar` is appended to
`#beach-stage`, so action-bar re-renders can never touch it (removed from
the DOM on exit, destroyed on beach dispose). Native buttons only, wrapped
in `role="toolbar"` / `aria-label="Sand castle tools"`: twelve tool pills
with `aria-pressed`, ↩️ Undo / ↪️ Redo with native disabled states, three
template presets (`title` + `aria-description`), the armed Reset, and
💾 Done. The
status line is a `<p role="status">` written only on change (height-stable,
`beach-swim-status` pattern). Touch targets are ≥ 44 px; on phones the
toolbar caps at 34 vh with a compact ≤ 620 px variant. Escape semantics live
in `js/beach.js`'s document keydown: while `phase === "building"` the
builder claims Escape first (exit, beach stays open); otherwise the existing
overlay-close runs. The builder must not resize the stage: on entry the
still-rendered sand-mode bar's height is published as `--sc-bar-h`, and
`.mode-castle .beach-actions:empty` keeps an invisible strip of exactly that
height in the flow while the toolbar offsets down into it.

**Exit and bake.** 💾 Done bakes the current field: ONE static
`BufferGeometry` from the same MarchingCubes conversion as the live session,
plus the ≤ 12 decor meshes and one blob-shadow disc (r 1.2 m, opacity 0.9)
in a single Group named `sandcastleBake`, planted at
`(PLOT.x, sandY(PLOT.x, PLOT.z), PLOT.z)` — the geometry is PLOT-local, so
the castle sits exactly where the builder showed it. Done also plays the new
`character.cheer()` one-shot (land-only, skipped under reduced motion) with
the talk line "A castle fit for a crab! 🏰". Escape bakes quietly. Exit
policy: non-empty field → always bake (replaces the previous root);
empty field with session changes (Reset / undo-to-empty) → bake removed and
the save cleared; empty, untouched session → previous bake kept. The
previous bake is hidden (not destroyed) while building. A walk-around
obstacle `world.addObstacle({ id: "sandcastle", radius: 1.15 })` joins the
same disc list `moveAroundProps` sweeps, so she walks around the plot. Draw
calls: measured desktop software-GL baseline 42 → 44 after a small bake
(+2); the budget is +2 typical, up to ≈ +14 with a full 12-record decor
list. ⬅️ Back / any beach close mid-build does NOT bake — the world is
being disposed; `dispose()` saves first, and the next `open()` re-bakes the
saved castle before the builder is ever entered.

**Persistence.** The castle lives in the existing `lily-game-save-v1` save
as a top-level `sandcastle` key `{ v: 1, grid: <RLE>, decor: [...] }` through
`GameState.getSandcastle()` / `setSandcastle()` / `clearSandcastle()`
(`js/state.js`). The RLE encodes the raw 32³ grid as base36 count `:`
base36 value pairs joined by `;` (e.g. `a:5;1a:3`), with `encode`/`decode`
in `sandcastle-field.js`. `setSandcastle()` stores a normalized defensive
copy and notifies reason `sandcastle` (the third named reason after
`swimStyle`/`reset`); `clearSandcastle()` exists because empty castles must
genuinely remove the key — `setSandcastle(null)` would be silently ignored
by validation. Autosave fires on every gesture end (the editor's change
callback → deduped save), and Done/Escape/Back re-save idempotently.
Load-on-open decodes the save and bakes immediately: the castle stands on
the beach before the builder is ever opened, and the button already reads
"🏰 Edit sand castle". A decor-only save seeds the builder records but never
bakes. Corrupt/oversized saves decode to null and self-heal silently on the
next real write. `GameState.reset()` clears the key and the bake live via
the `reset` reason subscription (the only subscription — no `sandcastle`
listener, writes stay one-way, no loops). Gotcha: the welcome screen's
"🎈 Let's Play!" always calls `GameState.reset()`, so it removes a saved
castle; "💛 Continue my game" preserves it. The builder's own Reset-all
(then Done/Escape with an empty field) also clears the save.

**Reduced motion.** No idle decor animation; the only kept feedback
animation is the 150 ms one-shot cursor-ring pulse (1.4× scale) on
stamp/decor commit. Everything else is instant.

**Performance.** Drag rebuilds cost an EMA-tracked 1.35–1.85 ms steady state
on software GL (`__beach3d.sandcastle.editState().lastRebuildMs`); the bake
is the same conversion plus a geometry freeze, a few ms. Undo snapshots are
32 KB copies; autosave writes are deduped by grid+decor key.

**Test API.** `window.__beach3d.sandcastle = { enter, exit, state, setTool,
applyTemplate, reset, bake, save, editState, projectPoint }`, where
`state()` = `{ phase ("idle"/"walking"/"building"), walking, tool,
stats: { solid, tris }, decorCount, baked, saved }`. `editState()` adds the
session-local extras (`canUndo`, `canRedo`, decor records, `lastRebuildMs`,
`plotY`, builder camera position, last raycast hit); `projectPoint()`
projects editor-space meters to screen px for deterministic aiming.

**Tests.** With the server on port 8123 and Python Playwright/Chromium
installed:

```sh
python3 -B beach3d/sandcastle_test.py                 # all sections, 57 checks
python3 -B beach3d/sandcastle_test.py --section desktop
python3 -B beach3d/sandcastle_test.py --section persist
python3 -B beach3d/sandcastle_test.py --section mobile
python3 -B beach3d/sandcastle_test.py --section lifecycle
```

Report and screenshots go to `/tmp/kilo/sandcastle/` (`--out` overrides).
Desktop/persist run 1280x800; mobile runs 420x720 with `has_touch` +
reduced motion. UI interactions are real clicks/taps/keys; the
`__beach3d.sandcastle` hooks are used only for state polling and
deterministic aiming, and artifacts stay outside the repository. Sections:
**desktop** — walk-in, toolbar, drag paint, undo/redo, fort template,
Done/bake, obstacle, draw-call budget, Escape-in-builder; **persist** —
autosave shape, reload + Continue reopen without entering the builder,
edit re-entry equality, corrupt-save self-heal, reset-all; **mobile** —
toolbar fit, 44 px targets, stable stage size, touchscreen tap stamp,
drag paint, Escape; **lifecycle** — close the beach mid-build → reopen via
the map → the autosaved castle is baked. The existing `scene_test.py` and
`catch_test.py` still pass.

Known limits, stated honestly: undo/redo history is session-local (every
entry starts empty); one castle at a time at the fixed plot; decor has no
physics and the blob shadow is static; no erosion, tide damage or melting —
the castle persists byte-identical between sessions.
