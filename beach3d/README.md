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
  **Swim**: prone; chest/head sits ≈ 0.34–0.41 above origin, hips ≈ 0.01,
  toes ≈ −0.18 — for a waterline through mid-torso put the node origin
  ≈ 0.1–0.15 m below the surface. **Paddle**: low kneel on the board, head
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
