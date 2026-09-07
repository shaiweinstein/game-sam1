# beach3d — 3D Lily animation pack (B0)

`assets/lily4_full.glb` is the final Lily v4 skinned mesh (40,001 verts, one
7-material joined mesh, 65-joint `LilyRig` skin — byte-compatible layout with
`spike3/assets/lily4_walk.glb`) carrying **eight** retargeted Mixamo clips in
one file, all built through the exact conform/inverseBind pipeline of
`spike3/blender/build_lily4_full.py` (single shared rest, per-clip action
copies, copy-fidelity < 1e-4 asserted per clip).

## Clips

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
  clear on the breathing side, back + shoulders at the surface, hips/legs
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

```
/usr/bin/blender --background --python spike3/blender/build_lily4_full.py
```

## Blender 5.0 gotchas (both hit, both solved in the script)

1. `bpy.ops.import_scene.fbx` is **broken** in Blender 5.0 — the script calls
   the addon directly: `from io_scene_fbx import import_fbx;
   import_fbx.load(Shim(), bpy.context, filepath=…)` with a tiny `report()`
   shim object.
2. Blender 5.0 slotted actions removed `action.fcurves` — all F-Curve access
   goes through `action.layers[*].strips[*].channelbags[*].fcurves`
   (`collect_fcs()` in the script).

## Camera (B2-cam) — the two-framing swim camera

`world.js` owns the camera (see the `B2-cam` comment block there). It is a
zone-driven, **two-framing** camera with **one constant orientation** — the
B1 establishing shot's direction, which never rotates. The camera only ever
translates and dollies along that fixed axis, so the horizon sits at the same
viewport height (~45%) in both framings (no reframe, no wobble, mid-glide
included).

- **LAND** (zone `sand|foam`): the B1 establishing shot, kept pixel-identical —
  pos `(0, 3.6, 10.4)`, lookAt `(0, 1.66, 2.64)`. Zoom behaves exactly as B1:
  `pos = target + (base − target) × zoom`. On settled sand the position is set
  by the exact formula (no residual ease), so the B1 framing is bit-identical.
- **SEA** (zone `sea`): the follow rig —
  `pos = swimmerAnchor + SEA_OFFSET × zoom`, `lookAt = pos + VIEW × SEA_LOOK`.
  `swimmerAnchor = (anchor.x, rootY, anchor.z)` is her **eased** root height,
  so the rig rides the waterline with her (wave + bob), never the seabed.
  `SEA_OFFSET = −VIEW × SEA_DIST` is collinear with the view axis **by
  construction**, so she sits on the frame-centre line. `SEA_DIST = 7.0 m` is
  the readability distance (her above-water swim mass ≈ 80 px at 1280×800)
  that also keeps the exit glide short enough to re-lock B1 before she is dry.
  `SEA_LOOK = SEA_DIST + 0.6` puts the look point 0.6 m past her.

**Motion:** the actual camera eases toward its target exponentially
(`CAM_RATE 5 s⁻¹`) with a gentle velocity cap (`CAM_VMAX 2.5 m/s`). The
~4.1 m land↔sea glide takes ~2 s while every 50 ms step stays ≤ 0.125 m (no
pop); the in-sea follow settles in ~0.3–0.5 s and lags a full-speed swimmer by
only `1.32/5 ≈ 0.26 m`. The chase `dt` is clamped to `1/30 s` so a dropped
frame can never concentrate a big jump (per-frame travel ≤ 0.083 m). A
sub-millimetre snap locks the camera exactly onto the B1 shot on the sand.

**Zoom** (wheel/pinch, 0.8–1.6, persists across transitions): LAND scales
`(base − target)` exactly as B1; SEA scales the rig offset (the 14° geometry
is kept, only the rig distance changes). The zoom ease **snaps** to its target
on settle so "back to 1.0" is exact (no sub-millimetre residue).

**Reduced motion:** the water keeps its resting frame (existing policy); camera
transitions run uncapped at `CAM_RATE_RM 25 s⁻¹` (≤ 0.2 s, near-instant) and
the follow is lag-free — no per-frame camera jitter. Positional control of the
character is untouched.

**B3 (duck boat)** reuses the SEA framing for the ride stance: feed the boat's
anchor/rootY/zone through the same `updateCamera()` entry — rig, ease, cap,
zoom and RM policy all apply unchanged.

**Test hooks** (`window.__beach3d.state()`): `cam` (3-decimal position),
`camFull` (full precision), `camMode` (`land|sea`), and the no-pop audit
`camStep`/`camSpeed` (get-and-clear max per-frame travel / real-time speed).
