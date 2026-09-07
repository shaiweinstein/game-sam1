# Beach Play v2 — "Make the girl actually be Lily"

**Supersedes `BEACH-GAME-PLAN.md` (v1, Aug 2026).** v1 tried to fix the
character by re-doing the rig *in code* (procedural containers → SkelForm
→ flat-parts FK). Three generations of in-code rigs, and per the verdict
that stands (from the parent + daughter, taken as given without
investigation): the girl still looks bad, moves unnaturally, and does not
look like the Lily from the dress-up pages. v2 changes course: **a real
2D skeletal-animation pipeline** — author once in a proper rigging tool,
play it in our existing Phaser scene. The current rig code is not
debugged; it is replaced, then deleted.

## The three complaints, mapped to fixes

| Complaint | Root fix |
|---|---|
| "She doesn't look like the Lily in the dress-up pages" | Build the beach character **from the same SVG art** the dress-up page uses (`js/character.js` → `BODY_MARKUP` + `CHARACTERS` palettes + wardrobe swimsuits), cut into rig parts. No re-drawn approximation. |
| "Her movements are not natural" | Author **real animation cycles** (walk, wade, front-crawl, paddle, surf) in a bone-rig editor with live preview, proper timing/easing/secondary motion — instead of hand-tuned rotation numbers in JS. |
| "The character looks horrible" | Same art as the dress-up page + proper cycles = the two complaints above are the same fix. |

## What we keep (do not rebuild)

- **Phaser 3.90.0 world** (already vendored, `lib/phaser.min.js`): canvas
  beach scene, animated water, pointer input, duck-boat logic
  (`js/beach-boat.js`), wave/surf logic (`js/beach-surf.js`), castle
  builder, sounds, speech, energy, save.
- **`js/character.js`** as the single source of truth for what Lily looks
  like (palettes, hair/body markup), and **`js/wardrobe.js`** (incl. the
  6 swimsuits) as the source of truth for what she wears.

## Research summary (Sept 2026)

| Tool | Cost | What it is | Verdict |
|---|---|---|---|
| **LoongBones** (DragonBones) Web editor — `loongbones.app/editor` | **Free.** In-browser, no install, any OS. Actively maintained (v1.1.5, Jan 2026). | 2D bone-rig authoring: bones, slots, **skins** (outfit swap), keyframes, IK, meshes, live preview, import PNG/JPG. | ✅ **Authoring tool.** |
| **DragonBonesJS** runtime + **official Phaser 3.x plugin** (`github.com/DragonBones/DragonBonesJS` → `Phaser/3.x`) | **Free, MIT.** | Plays the rig **inside our Phaser canvas**; runtime slot recolor; one-line skin swap ("avatar system" is a first-class feature); vendorable locally (offline-safe, like `phaser.min.js`). | ✅ **Runtime.** Matches our vendored Phaser 3.90.0 exactly. |
| **Rive** | Editor free (browser). **Since Oct 2025, exporting `.riv` files requires the paid "Cadet" plan ($9–17/mo).** Runtime is MIT. | Excellent interactive animation + state machines. | ⚠️ Fallback / paid upgrade path. No official Phaser integration (DIY canvas compositing). |
| **Spine** | $69 (Essential) / $299 (Pro, with IK) one-time. Trial cannot ship. | Industry-standard 2D skeletal tool. | ❌ Not free. |
| **Mixamo** (Adobe) | Free (Adobe account), royalty-free for personal **and** commercial, no redistribution of raw files. | 3D characters + motion-captured animations (walk/run/swim). | ⚠️ Only relevant to the 3D alternative (Option B) — a 3D avatar does not look like the dress-up Lily. |
| **Godot 4** | Free, MIT. | Full engine: 2D bones, IK, water shaders, web (WASM) export. | ❌ Separate engine/stack; iframe + COOP/COEP headers; breaks single-page consistency with the dress-up screens. |
| Free 2D swim/surf sprite packs (itch.io CC0, e.g. "Free Swimming Characters Animation") | Free | Pixel-art swim cycles (sprite sheets). | ⏱️ **Timing references only** (how arm/leg phases move) — pixel style ≠ Lily, not used as art. |

### Why LoongBones/DragonBones wins for this project

1. **Whole pipeline is free** — editor AND runtime. (Rive now pays at export;
   Spine pays at license.)
2. **Official Phaser 3 integration** — the rig renders *inside* our existing
   canvas, so waterline occlusion (tint over submerged body), wake/splash
   particles, camera bob, and z-ordering all keep working as ordinary Phaser
   layering. (Rive renders to its own canvas → DOM-overlay hack + export
   paywall.)
3. **Native "skins" + slot recolor** — one rig, many looks:
   - skin "street" (land outfit) ↔ skin "swimsuit" (each of the 6 suits),
   - per-friend skin/hair colors via runtime slot tint, from the same
     `CHARACTERS` palette tokens the dress-up page uses.
   This is the mechanism that guarantees *she is Lily (or Amara/Mei/Sofia)*,
   including the exact suit chosen in the wardrobe.
4. **Editor runs in the browser** — no Windows/Mac desktop dependency;
   import/export is JSON + PNG atlas, vendorable offline.

## Architecture

```
js/character.js (SVG source of truth)
        │  re-slice into rig parts (one-time art task)
        ▼
parts/lily/*.svg ──rasterize (Playwright/Chromium, 2–3×)──▶ assets/lily-atlas.png
        │                                                        │
        │ keyframe cycles (LoongBones web editor, browser)       │
        ▼                                                        ▼
  lily.dbproj ──export──▶ assets/lily.rig.json + atlas ◀── DragonBonesJS
                                                                  │ (MIT, vendored in lib/)
                                                                  ▼
                              js/beach-rig-db.js (NEW — only BeachRig consumer)
                                                                  │
            existing game logic (beach-game.js / beach-boat.js / beach-surf.js)
            pointer→walk/wade/swim · board/hop-off duck · steer duck · catch wave
            state ──▶ animation name + params (speed, facing, bob)
```

- `lib/dbjs/` — vendored DragonBonesJS runtime + Phaser 3 plugin (no CDN).
- `js/beach-rig-db.js` — NEW. Owns armature creation, skin/palette setup,
  animation-state transitions, world position/rotation. Exposes the same
  minimal surface the old rig had so the boat/surf/game files barely change.
- `js/beach-rig.js`, `js/beach-rig-skf.js`, `js/beach-rig-v2.js`,
  `js/beach-parts.js`, `lib/skelform/` — **deleted** in the cleanup mission
  (after the new rig is verified working).
- All other files (world, input, boat, surf, castle, wardrobe, state, sounds,
  chrome) stay; they were the "playable" part that already works.

## Mission breakdown (sequential; each = one code-worker mission)

### M0 — Spike: prove the free pipeline end-to-end (decision gate)
- Vendor DragonBonesJS + Phaser 3 plugin into `lib/dbjs/`.
- In the LoongBones **web editor** (browser), build a tiny test armature
  (simple girl: head/torso/2 arms/2 legs), keyframe two loops: `walk` +
  `swim`, export JSON + atlas.
- Load it in a spike page (`spike2/`) inside a Phaser 3.90 canvas —
  **offline**, same page structure as the real game.
- **Gate:** plays smoothly at 60 fps, offline, in this project's setup.
  Pass → proceed. Fail → pivot: (a) desktop DragonBones 5.6 editor (free,
  legacy export format), or (b) Rive with the $9/mo export plan, or (c)
  sprite-sheet-baking path (see insurance).

### M1 — Rig art: slice Lily into parts (code-as-art)
- Extract `BODY_MARKUP` into separate parts: hair-back, hair-front, head
  (face), torso, upper-arm ×2, forearm ×2, hand ×2, thigh ×2, shin ×2, foot
  ×2 — same geometry, same rounded style, no redesign.
- Outfit variants as rig **skins**: "street" (current top/bottom/shoes
  markup) + the 6 wardrobe swimsuits (1-piece vs 2-piece layering per the
  existing catalog).
- Rasterize each part at 2–3× to `assets/lily-atlas.png` (Playwright
  screenshot of each SVG — same toolchain as the E2E suite).
- **Check:** side-by-side screenshot vs. the dress-up page's standing Lily —
  must be visually the same girl.

### M2 — Rig authoring: the actual animation (the daughter's bar lives here)
- Build the full skeleton in the editor; keyframe all cycles with real
  principles (contact/passing timing, anticipation, overlap, follow-through,
  hair + cloth secondary motion, arm/leg phase offset for the crawl):
  `idle-land`, `idle-water` (bob+breath), `walk`, `wade`, `swim` (crawl),
  `dive-in`, `splash-out`, `sit-boat`, `paddle-boat` (arms in water,
  alternating), `surf-paddle`, `surf-stand` (crouch + balance arms),
  `surf-ride` (lean/steer poses), `wipeout` (big harmless splash),
  `cheer` / `wave-greet`.
- Reference for timing: Mixamo swim previews (watch only, free), itch.io
  CC0 swim packs (arm/leg phase), classic swim-cycle breakdowns.
- Export → GIF loops → **review by parent + daughter** before M3.
- This is the mission most likely to need a few iterations. That is
  expected and budgeted — the review loop is the quality control.

### M3 — Game integration
- `js/beach-rig-db.js` replaces the rig consumer: map existing gameplay
  states → animation + params:
  - pointer-hold on sand → `walk` toward pointer (facing flip, speed by
    distance), release → `idle-land`;
  - shallows → `wade`; water → `swim` (stroke speed follows pointer
    distance; stop → `idle-water` bob);
  - water entry → `dive-in` + splash; exit → `splash-out` + walk out;
  - near duck + board → `sit-boat`; in boat → `paddle-boat`, pointer steers
    the duck like a boat (wake trail, bobbing); hop-off → splash;
  - wave set approaching → `surf-paddle`; catch window → `surf-stand` →
    `surf-ride` (pointer steers); miss/fall → `wipeout` + big splash,
    zero penalty, wave counter keeps working;
  - friend selection → per-friend slot tint (CHARACTERS palettes);
    wardrobe swimsuit choice → rig skin; "Change suit" shortcut stays.
- Waterline occlusion: translucent water tint drawn **over** the submerged
  lower body (now trivial — same canvas).
- Keep: speech hooks, sounds, castle builder, energy-free beach,
  reduced-motion (amplitude → near-static), mobile touch.

### M4 — Juice pass
- Splash particles (hands/feet/entry/exit), duck wake, gentle camera bob
  (no shake — kid comfort), surf-ride speed lines, cheer pop on wave catch.

### M5 — Cleanup, verification, hand-off
- Delete all old rig code: `js/beach-rig.js`, `js/beach-rig-skf.js`,
  `js/beach-rig-v2.js`, `js/beach-parts.js`, `lib/skelform/`, dead rig CSS,
  and the `?skfrig=1` / `?rig2=1` flags in `index.html`.
- Playwright E2E: pointer-hold moves her across the sea (sampled joint
  angles change → proof of real animation), board/steer/hop-off duck,
  catch/ride/wipeout wave, suit switch visible in rig, all 4 friends tint
  correctly, mobile 420×720 touch, reduced-motion, 60 fps frame-time
  sampling, zero console errors, dress-up/kitchen/map/friends regression,
  save integrity.
- Hand-off note for the parent: how to play, where each file lives, how to
  re-export the rig if animations ever need tweaking.

## Insurance policy

**Author once, render twice.** If the runtime integration turns out to be
awkward after M0/M1 (it shouldn't — official plugin, matching Phaser
version), the same exported rig can be **baked to PNG sprite sheets**
(headless capture of the rig, frame by frame) and played as ordinary Phaser
sprite-sheet animations with zero gameplay changes. No animation work is
ever thrown away.

## Acceptance bar (the daughter's complaints, inverted)

1. The beach girl is unmistakably the dress-up-page girl — same face, hair,
   and the swimsuit chosen in the wardrobe; switch friends → correct skin/
   hair colors.
2. Motion reads as real: arms stroke and legs kick (not a static rotated
   body), hair and clothes move with follow-through, walk is a real cycle.
3. All five playable loops work: **point→walk**, **point→swim**, **board
   and hop off the duck**, **steer the duck around like a boat**,
   **catch a wave** (and wipe out, harmlessly, sometimes).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| LoongBones export format ↔ DragonBonesJS runtime mismatch | M0 gate exists exactly for this. Fallback: desktop DragonBones 5.6 editor (free, same team, legacy format) → else Rive (pay $9/mo for export) → else sprite-sheet bake. |
| Good swim/surf cycles need iteration | Reference timing sources listed; parent+daughter review loop at M2 exit; M2 may span 2–3 worker missions. |
| WebGL on very old iPads | Phaser already auto-falls back to canvas; DragonBones Phaser plugin works on both renderers (verify once in E2E with forced canvas type). |
| Project has **no git history** — deleting old rigs loses all history | `git init` + commit the current tree **before** M0 starts; commit at every mission boundary. |
| Editor is a cloud service (browser) — needs internet to author | Authoring is a one-time/occasional task; runtime is fully offline. Exported JSON+PNG are vendored in the repo. |

## Status

- **M0 ✅ (2026-09-05, commit `0d184c6`)** — pipeline proven end-to-end:
  - Runtime vendored: DragonBonesJS @ commit `64b6c69` (2025-05-24), core
    5.7.0, Phaser 3 plugin 5.6.2 → `lib/dbjs/` (MIT, see `lib/dbjs/README.md`).
  - LoongBones web editor (`www.loongbones.com/editor`, v1.2.3): authoring
    works **without** an account, but **export/save are login-gated** (free
    account). Export version dropdown: `6.0` / `5.5` → **must export 5.5**
    (vendored runtime accepts 4.0–5.6, NOT 6.0). `loongbones.app` is
    DNS-blocked in this environment; use the `.com` URL.
  - Fallback route proven: hand-authored 5.5 JSON + atlas plays in Phaser —
    `spike2/` (8-bone test girl, `walk` + `swim` loops, facing flip, 60 fps,
    fully offline, zero console errors).
  - **The project's Phaser 3.90 is a PATCHED build** — 8 documented quirks
    (`spike2/NOTES.md` §4), incl. `WEBGL|CANVAS === HEADLESS` (silent
    no-render trap) and a missing WebGL pipeline base class. All new pages
    copy the spike's pattern: `type: Phaser.CANVAS` + the inline compat
    shim in `spike2/index.html` + lazy `getScene`.
  - **Slot tinting is unavailable in this build** (`spike2/NOTES.md` §6)
    → per-friend colors come from **per-friend body atlases** (4 small PNGs,
    one shared rig JSON) + one **shared clothing/suits atlas** (fixed
    colors), not from runtime tint. Friend switch = swap atlas / rebuild
    the small armature (cheap, rare).
- **D0 ✅ (commit `e47d711`) → REJECTED by the parent (2026-09-06):**
  properly-keyframed 2D gait/crawl on the jointed stick rig (before/after
  GIFs + slow-mo page at `spike2/demo.html`) — verdict: *"doesn't look like
  a human moves, at all."* Structural 2D limits (in-plane limbs, no depth,
  no real weight, crude art) cannot reach the family's bar of "a person
  moving." **The 2D path is shelved; 3D is the primary track.**
- **M1 ⏸ shelved** — 2D art slice will not proceed. History safe in git.
- **S1 ✅ (commit `9dee564`) → family: "close — fix specifics"** — 3D chibi
  Lily (Blender, toon) + orbit viewer + Mixamo in-place walk in `spike3/`.
  Verdict: swimsuit reads as a skirt, no feet, helmet hair, hidden neck,
  body reads "chess piece," not kid.
- **S2 ✅ (commit `cb25a63`) → family: "improving — walk + hands still off"** —
  one-piece swimsuit (Sunny #ffd93d/#ff9a3d + daisy), bare kid feet,
  kid-proportioned body, visible neck. Verdict: keep improving — walk not
  working well, hair still helmet-like, hands/shoulders weird mid-walk,
  shoulders too big.
- **S3 ✅ (commit `a78e280`) → family re-review of v3 PENDING (sole gate)** —
  Walk export fixed (GLB had exported only the HairCap mesh; root cause:
  glTF exporter derives inverseBindMatrices from bone rest; fix:
  armature-local rest conform + per-bone basis rebake, verified to
  0.000038). Hair rebuilt: snug cap (no shelf), scalloped bangs, curtain
  side locks to waist, long back mantle. Kid-sized shoulder caps,
  2-segment arms with elbow bend + mitten hands, bigger feet with toes,
  flat chest, smooth chin, continuous leg lofts. Face texture and swimsuit
  untouched (both already family-passed). Two internal vision iteration
  rounds. QA: 60 fps settled idle AND walking, zero console errors, fully
  offline, v1/v2/v3 toggle + Walk on all, 2D reference panel. Review
  assets: `spike3/shots3/` stills, `orbit3.gif`, `walk-orbit3.gif`.
- **Next fork (family verdict on v3):** "that's Lily" → full 3D beach build
  (3D scene: sand/water/duck boat/surfboard, follow camera, pointer-raycast
  movement, 3D swimsuits + 4 friends, gameplay loops ported from
  `js/beach-game.js` / `beach-boat.js` / `beach-surf.js`). "Fix specifics" →
  S4 polish mission on `spike3/blender/build_lily3.py` + walk pipeline.
- **S4 ✅ (commit `fbd1d6b`) → family re-review of v4 PENDING (sole gate)** —
  Family's v3 note was "swimsuit: parts of front and back are not covered"
  (arrows at front + back crotch). Diagnosis: main-suit front hem rose to
  z0.244 at center (skin at front crotch under the sagging trim V); back
  hem sat at z0.262–0.292 (top of butt) with the two open leg-tab lofts
  leaving a ~5cm skin slit down the center back. Fix (build_lily4*.py):
  - **P0 full coverage:** below the hip line the suit cross-section blends
    torso-ellipse → figure-8 thigh wraps with fabric bridges across the
    crotch FRONT and BACK; continuous hem z≈0.212 all the way around
    (front AND back), only an invisible 8mm front-center notch. Separate
    SuitTab/TrimTab meshes deleted (absorbed into main suit). Verified
    closed at all six idle angles + 3 walk-front + 3 walk-back mid-stride.
  - **P1 silhouette:** shallow scoop (front-center z0.528, dip 0.028; sides
    0.556) — no halter.
  - **P2 daisy:** solid overlapping flower (4 petals r11.5mm @ ±15mm + 7.5mm
    center, 2mm seated at z0.478) — reads as the 2D clover.
  - **P3 color:** suit/daisy get a 3-step toon ramp + 0.34 emissive so the
    lit yellow reads bright (front belly ≈ (255,225,64) vs #ffd93d
    (255,217,61)); skin/hair/face untouched (v3-vs-v4 diff is swimsuit-only).
  - Walk export: per-vertex binding (thigh wraps → UpLeg side×height ramp,
    crotch bridge → Hips/Spine); GLB 40001/40001 verts weighted, 65 joints,
    32 parts, S3 conform/rebake diff 0.000038 intact; skin-sim 0 unbound.
  - Viewer: v4 (new) is the DEFAULT, v1/v2/v3 still toggleable, Walk works
    on all four, __spike3 hooks intact. QA: 56–60 fps idle+walk, 0 console/
    page errors, fully offline. Stills `spike3/shots4/` + `orbit4.gif` +
    `walk-orbit4.gif`; v4-vs-2D compare at /tmp/kilo/suit_compare_v4.png.
- **S3+ ✅ (commit `773c5f7`)** — 7 extra Mixamo clips fetched + verified for
  the full build (all FBX Binary, 30fps, Without Skin, 65-bone mixamorig,
  0 meshes): Swim-FrontCrawl (137f in-place), Surf-Paddle (218f in-place,
  sub: single-oar canoe paddle — no surf clip exists), Surf-Ride (31f in-place,
  sub: skateboarding idle), Sit-Relaxed (64f in-place, girl-on-bench),
  Idle-Standing (299f in-place), Running (23f in-place), Cheer (88f),
  Wave-Greet (17f). → `spike3/assets/mixamo/`. Trim Idle(299f)/Paddle(218f)
  at retarget for tighter loops.
- **Family verdict on v4 (2026-09-06): APPROVED — "that's Lily."** → full 3D
  beach build begins (below).

## Full 3D beach build (approved 2026-09-06)

Replaces the Phaser `WorldScene` (2D) with a three.js world in the same
overlay (`#beach-scene` in `js/beach.js`). DOM chrome stays: `#beach-talk`
bubble, `#beach-close` (⬅️/Escape), `#beach-actions` bar, 🌊 N wave chip.
Gameplay rules, constants, input model, speech lines and the 5 synth SFX
(`pop/yummy/travel/cheer/oops` via `window.GameSounds.play`) carry over from
`beach-game.js` / `beach-boat.js` / `beach-surf.js` (recon brief 2026-09-06
is the spec; exact tuning sheets `LOCO_SPEED`, `BOAT`, `SURF` quoted there).

**Architecture (new files, 2D stays until B6 verification):**
```
beach3d/
  beach3d.js      — module entry; window.Beach3D = { open(stageEl), close(),
                  isOpen(), locomotion: {getAnchor,isMoving,setEnabled,
                  setTarget}, reducedMotion() }  ← mirrors BeachGame's public
                  surface so js/beach.js swaps BeachGame→Beach3D in a few lines
  world.js        — renderer (spike3 patterns: software-GL probe, adaptive
                  scale), fixed 3/4 high camera, lights + 4-step toon ramp
                  (suit 3-step bright ramp), sky gradient + sun, sand plane
                  with shoreline curve + wet-sand band, animated water
                  (semi-transparent toon, foam line at shore), props
                  (umbrella, ball, shells, starfish) + blob shadows
  character3d.js  — Lily 4 (lily4_full.glb): AnimationMixer + stance map
                  stand→Idle / walk→Walk / wade→Walk+submerge / swim→Swim /
                  float→Idle+bob / ride→Sit / surf→SurfRide; yaw-to-moving
                  direction (smoothed); speed→timeScale; waterline offset
                  (hip at water for swim/float, soles on anchor on land);
                  suit material swap (6 suits) + friend material swap (4
                  palettes, per-friend face textures)
  boat3d.js       — 3D duck boat (Blender): tap-hull-to-board (proximity +
                  auto-approach invite, 20s timeout), Sit + Paddle clips,
                  hold-drag steer (sea-only, clamped), wake trail, bob on
                  wave phase, hop via button or auto at shore
  surf3d.js       — 3D surfboard (pink/teal stripe) + shoreward-approaching
                  wave swell (foam crest); 🏄 button / Space catch (window:
                  in sea + |dist| ≤ radius); ride = SurfRide clip on board
                  following crest, steer = carve along the wave face;
                  roll-off at sand = SUCCESS +1 (2D parity: no wipeout ever)
```
- **World scale** (meters): character ≈1.0m tall (B0-verified: soles z≈0,
  crown ≈0.99; Walk clip's lowest foot contact is −0.144 → root-lift the
  character ~0.15m so the deepest sole touch = ground, verify in stills);
  beach strip x ∈ [-7, 7];
  z: deep sea −9 → back of sand +5; shoreline/foam near z 0; duck parked in
  mid-sea (2D: fx .72/fy .60); waves spawn deep-sea and travel shoreward
  (2D: right→left at 0.16 width-u/s → 3D: ~1.1 m/s toward shore, first wave
  1.8s, gap 2.2–4.8s).
- **Camera decision:** FIXED 3/4 high angle showing most of the beach
  (matches the 2D "whole world visible" feel; a kid-follow camera is
  disorienting and hides the duck/waves). Character moves + rotates in all
  directions (family's "every direction" bar met); gentle wheel/pinch zoom
  allowed. If the family wants a follow cam later, it is a camera-mode swap.
- **Input:** pointer raycast to ground/water plane = target; press-hold to
  move (first-down wins, drag re-targets, release stops) — same as 2D.
  Boat/surf keep the 2D handoff pattern: `locomotion.setEnabled(false)` →
  own the anchor → re-enable (adopts position, "she pops out swimming,
  never teleports").
- **State:** beach stays energy-free, wave counter session-only, nothing
  persisted (2D parity). Friend/suit come from GameState (`characterId`,
  `outfit.swimsuit`) with live re-sync (the 🩱 "Change swimsuit" shortcut
  round-trips through the wardrobe).
- **Mobile + reduced motion:** 420×720, `touch-action:none` on the canvas,
  one-pointer contract, cached `prefers-reduced-motion` — RM keeps control
  (movement/wave travel/steer) but freezes shimmer/bob/animation amplitude
  (parked stance frames), 2D policy verbatim.
- **Suits (3D):** geometry variants: 1pc (v4 suit, recolored per catalog),
  tankini (vest + high-waist shorts: suit2, suit4), crop set (top + shorts:
  suit5); per-suit colors from `CATALOG.swimsuit[*].colors`; daisy emblem on
  suit1 only, small trim-colored emblem elsewhere. Friends: skin/hair
  material swaps + per-friend face textures (regenerate `face_texture.png`
  per palette from the 2D face markup).
- **Animation pack (B0):** `beach3d/assets/lily4_full.glb` — one GLB, 8
  clips from `spike3/assets/mixamo/`: Walk (existing retarget, keep the
  damped-swing + conform fix), Idle (Idle-Standing, trimmed to a seamless
  breathing loop), Swim (Swim-FrontCrawl, in-place, loop), Sit
  (Sit-Relaxed girl-on-bench, loop), Paddle (Surf-Paddle = single-oar canoe
  paddle, trimmed to one stroke cycle), SurfRide (Surf-Ride = skate idle
  balance, loop), Cheer (one-shot), Greet (one-shot). In-place normalize:
  zero the Hips translation channels on every clip. No run clip (2D game has
  no running; Running.fbx kept in repo for later).

**Mission status:**
- **B0 ✅ (commit `aca2b1d`)** — `beach3d/assets/lily4_full.glb`: 8 clips,
  all gates passed (Walk regression 1.4e-05 vs lily4_walk.glb; Hips exactly
  constant on the 7 normalized clips; 40,001 verts; 65 joints; three.js bench
  clean, 32 stills in `spike3/shots5/`, test page `spike3/clips3.html` with
  `window.__clips3`). Clip data for the game side: Walk 1.033s loop (keeps
  ±4cm authored sway, intentional), Idle 9.933s loop (untouched 299f — fine,
  or trim later), Swim 4.533s loop, Sit 2.1s loop (chair-sit: hips 0.32, toes
  −0.11 → duck needs a ~0.35m seat), Paddle 7.233s loop (single-oar sweeps),
  SurfRide 1.0s loop (deep balanced crouch, parent to board), Cheer 2.9s
  one-shot, Greet 0.53s one-shot (near-rest end frame). MESH Z RANGES: Walk
  −0.144…0.992, Idle −0.016…0.990, Swim −0.163…0.406 (prone: chest/head
  0.34–0.41, hips ≈0.01, toes −0.18 → for a mid-torso waterline put the node
  origin ~0.1–0.15m UNDER the surface), Sit −0.110…0.810, Paddle −0.333…0.562
  (hands dip to −0.26 → board deck must sit ≤ −0.26), SurfRide −0.170…0.800,
  Cheer −0.037…0.959, Greet −0.006…1.005. GLB quirk: sampler times start at
  1/30s (duration reads one frame long; loops seamless, last≡first).
- **B1 ✅ (commit `94b64da`)** — 3D beach world live in the real game:
  `beach3d/{beach3d,world,character3d}.js` + index.html importmap/module
  (root-level paths `./lib/three/...`) + minimal js/beach.js wiring
  (Beach3D.open when available, 2D fallback until B6). Fixed 3/4 camera:
  pos (0, 3.6, 10.4), target (0, 1.66, 2.64), fov 38, zoom 0.8–1.6;
  horizon ~45%. Sky gradient + sun, sand + wet band + props (umbrella,
  ball, starfish, shells), water with 2D-parity crest wave sheets
  (occupy z −6.8…−3.4; splash VFX must ride `waterSurfaceY`). Walk/Wade
  working (press-hold raycast, yaw-to-moving, root-lift so feet never clip).
  QA: ~55 fps avg under software-GL dev box (adaptive pixel scale to 0.5;
  real GPU expected 60), 420×720 touch OK, reduced-motion static water +
  positional walk, open/close×2 leak-stable, zero console errors, offline.
  Stills: `beach3d/shots/final_0*` + run7 mobile/RM. **B2 notes:** sea
  clamp is `SEA_CLAMP_Z = 0.10` in `clampPoint()` (character3d.js); stance
  map already resolves swim/float/ride/surf (cached clips); seabed profile
  deepens beyond bedTo −7.0.
- **Missions (sequential; family interim review after B2):**
- **B2** — swim loop: swim/float stances, water entry/exit splashes,
  waterline occlusion. → **FAMILY INTERIM REVIEW** (walk+wade+swim).
- **B3** — duck boat loop (model + board/paddle/steer/hop + wake + talk).
- **B4** — surfboard + wave loop (catch/ride/roll-off + counter + talk).
- **B5** — 6 suits + 4 friends (geometry variants, colors, face textures,
  GameState wiring + live re-sync).
- **B6** — juice (press ripples, splashes, wake, foam puffs, cheer pop) +
  sound triggers + mobile/reduced-motion pass + Playwright E2E (all 5 loops,
  suit/friend switches, fps sampling, zero console errors, offline,
  dress-up/kitchen/map/friends regression, save integrity) → then CLEANUP:
  delete `js/beach-game.js`, `js/beach-boat.js`, `js/beach-surf.js`,
  `js/beach-rig.js`, `js/beach-rig-skf.js`, `js/beach-rig-v2.js`,
  `js/beach-parts.js`, `lib/skelform/`, `spike/`, `spike2/`, the
  `?skfrig=1`/`?rig2=1` flags + dead DOM-art code in js/beach.js → hand-off
  note for the parent.

**Deferred (not in this build, note to parent at hand-off):** sandcastle
builder (2D DOM art; would need a 3D rebuild — ask the family after B6),
running speed (clip already in repo), voice/TTS (game is text-bubble only).

## 2D-vs-3D decision (raised by the parent, Sept 2026)

Parent + daughter may require **all-direction, all-angle** movement
("walk/swim every direction, natural from every angle, still Lily, same for
surfing and duck riding"). Only a 3D scene delivers that honestly.

**Decision method:** a **"3D Lily spike" (S1)** — Blender-modeled 3D chibi
Lily (her proportions/palette/hair/face), toon-shaded, orbitable 360°, with
a real Mixamo walk — compared side-by-side (with the D0 2D demo GIFs) by
the family. Whichever she says "that's Lily!" wins.

### 3D path (if it wins) — research summary (Sept 2026)

| Piece | Choice | Cost |
|---|---|---|
| Animation source | **Mixamo** (free, royalty-free; swim + surf clips exist; free Adobe account to download — creds via gitignored `adobe-login.md`) | Free |
| Modeling/rigging/conversion | **Blender 5.0.1 — already installed** on this box; fully scriptable (Python); model Lily, bind to Mixamo skeleton (auto-weights; skip Mixamo auto-rigger — it dislikes chibi proportions), FBX→glTF | Free |
| Web engine | **three.js** (single vendored file; GLTFLoader + AnimationMixer play Mixamo clips; MeshToonMaterial = cel look; ocean shader examples). Babylon.js is the alternative (built-in WaterMaterial + ToonMaterial). | Free |
| Character | 3D **version** of Lily — same chibi proportions, palette, hair, dot-face (as a 2D texture patch on the head for max fidelity), cel-shaded. NOT a pixel copy of the 2D art. Dress-up page stays 2D. | — |
| Scene | 3D beach: sand, water shader, 3D duck boat, surfboard, props; third-person follow camera; pointer raycast to ground = move target | — |
| Outfits | 3D street outfit + 6 swimsuits (color/geometry swaps), 4 friends (material swaps) | — |

Honest 3D risks: "3D version reads as Lily?" (the spike tests exactly this);
chibi-on-mocap tweaks (bone-length/scale, arm reach); 3D outfit art for
6 suits × 4 friends; bigger build than the 2D path.

## Decisions (confirmed with the parent, Sept 2026)

1. **Approach: A** — Rigged 2D Lily via the free LoongBones (DragonBones)
   pipeline.
2. **Animation authoring: the agent animates** — the rig + cycles are
   authored in the LoongBones web editor (driven via browser automation
   with visual verification). The parent reviews **GIF loops / a review
   page** and approves or requests changes before integration. The parent
   stays the final quality judge (and the daughter with her).
3. **Old rig files: delete** once the new rig passes M5's E2E — after
   `git init` + commits so history is safe.

**Authoring/review loop (M2+):** coder builds/keys cycles → exports →
`review/` page (serve via `serve.py`) plays all loops side by side +
GIFs → parent opens it, gives feedback → iterate.
