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
- **Prep in flight (verdict-independent):** downloading the additional
  Mixamo clips the full build needs (swim, surf paddle/ride, sit, idle,
  run, cheer) → `spike3/assets/mixamo/`.

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
