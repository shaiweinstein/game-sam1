# spike2 — DragonBones × Phaser 3 pipeline spike (M0) notes

**Status: PROOF ACHIEVED.** A hand-authored DragonBones 5.5 JSON armature
(`assets/girl.json`) loads through the vendored DragonBones 5.7 runtime
(`../lib/dbjs/dragonBones.min.js`, including the official Phaser 3 plugin)
and animates on a real Phaser 3 scene, with runtime animation switching
(walk/swim) and facing flip. Fully offline: every request is `localhost:8123`
(see verification results at the bottom).

Run: `python3 serve.py` → <http://localhost:8123/spike2/>

Files: `index.html` (page + compat shim), `spike2.js` (game/scene/toolbar),
`assets/girl.json` (armature), `assets/girl_tex.json` (atlas JSON),
`assets/girl.png` (atlas PNG), `shots/` (verification screenshots).

---

## 1. Authoring route used (and why)

Two routes were planned for creating the test armature:

- **Route 1 — LoongBones web editor.** Explored in depth via headless
  Playwright; works for *authoring*, but **export and save are
  login-gated**, so it cannot be used in this offline, no-accounts
  environment.
- **Route 2 — Hand-crafted 5.5 JSON + atlas.** ✅ **This is what shipped.**
  The 5.5 skeleton/atlas JSON format is simple enough to author by hand for
  a stick-figure rig, and it exercises the exact same runtime path a real
  LoongBones 5.5 export would.

### LoongBones editor findings (from the Route 1 exploration)

- `https://loongbones.app` is **DNS-blocked in this environment**.
  `https://www.loongbones.com/editor/` works (editor **v1.2.3**).
- No login wall for *creating and editing* projects: we successfully created
  a project, inserted the preset humanoid rig (人形骨架) and an auto
  stick-man skin (火柴人) headlessly.
- The **export dialog** (toolbar icon, top-right) includes a **data version
  dropdown with options `6.0` and `5.5`**.
- Hitting export (or save) fails without an account:
  `POST /api/user/checkVip` → `{"code":"error","message":"未登录，请先登录"}`
  ("not logged in, please log in first"); save shows toast `保存失败`
  ("save failed").
- **Consequence for M2 (real art):** exporting at **5.5** from LoongBones
  is compatible with the vendored 5.7 runtime (it accepts
  4.0/4.5/5.0/5.5/5.6 — see `../lib/dbjs/README.md`). Exporting at 6.0
  would NOT load with this runtime.

## 2. The assets

### `assets/girl.json` — DragonBones 5.5 armature data

- `version: "5.5"`, `compatibleVersion: "5.5"`, `frameRate: 24`.
- One armature `girl`, 8 bones:
  `root` (at 0,0 = the feet) → `hip` (0,-87) → `spine` (0,-40) →
  `head` (0,-30); `armL`/`armR` (±16,0 on spine); `legL`/`legR` (±10,0 on
  hip). Total height ≈ 203px in data units → scaled 1.6× in the scene.
- 7 slots: `pelvis`, `torso`, `legL`, `legR`, `armL`, `armR`, `head`,
  each parented to its bone. The default (unnamed) `skin` maps each slot to
  a display with a vertical `transform.y` offset so the part textures sit
  on the right bone joint (e.g. `leg` display y+43 from the hip, `head`
  display y-16 from the head bone).
- Two animations, both 24 frames, `playTimes: 0` (loop forever):
  - **walk**: legL/legR rotate `28 → 0 → -28 → 0 → 28` (6f steps, opposite
    phases); armL/armR rotate `∓22` opposite phase; hip bobs
    `y: -4 → 1 → -4 → 1`; spine rocks `±2°`.
  - **swim**: root rotates `70 → 86 → 70` (body lies nearly horizontal,
    rocking); armL/armR sweep a full circle `0 → 120 → 240 → 360` with
    `clockwise: 1` (dolphin-style stroke); hip bobs `y: -4 → 4`; spine
    rocks `±6°`.
- `defaultActions: [{ "gotoAndPlay": "walk" }]` — walk auto-plays on build.

### `assets/girl_tex.json` — atlas (SubTexture format)

Five parts in one 256×128 PNG: `head` 48×48 @ (4,4), `torso` 44×62 @ (60,4),
`pelvis` 40×30 @ (112,4), `arm` 16×64 @ (160,4), `leg` 18×86 @ (184,4).
`imagePath: "girl.png"`. Display names in the armature reference these
sub-texture names (`leg` is shared by legL/legR, `arm` by armL/armR).

## 3. DragonBones 5.5 JSON format details (learned while hand-authoring)

Verified against the vendored 5.7 runtime parser (`dragonBones.js`):

- **Coordinate system:** data coordinates **are** screen coordinates —
  **Y is down**, so body "up" is **negative Y**. There is no axis flip in
  this runtime (`DragonBones.yDown === true`). The armature origin
  (`root` bone at 0,0) is where the display is placed on screen — we put
  it at the **feet**. The character "faces" **+X** (flip with `scaleX < 0`).
- **Rotation keys** use `"rotate": <degrees>`; **positive = clockwise on
  screen** (Y-down). For full-circle sweeps use `"clockwise": 1` so the
  tween goes the long way (0→120→240→360, not the short 360°→0° way).
- **`"duration"` is in frames** (not seconds); the animation's
  `"frameRate"` (here 24) converts it.
- **`"tweenEasing": 0`** = linear. Omitting `tweenEasing` on a key means
  *step* (hold value until next key) — always write `0` for smooth motion.

**D0 addendum (2026-09-06, verified against the 5.7 runtime source):**

- `tweenEasing` semantics: `< 0` = ease-in, `(0..1]` = ease-out,
  `> 1` = ease-in-out (0 = linear, as above).
- Timeline values are **additive offsets on the bind pose** — author the
  bind pose as a relaxed A-pose and the data stays small.
- Full-circle sweeps can be written as monotonically increasing rotate
  values (0→120→240→360) **without** the `clockwise` flag — the parser
  keeps them unwound (M0 used the flag; both work).
- A proper 2D gait needs joints: single-segment limbs can only pendulate.
  D0's 14-bone rig (shoulder/upper-arm/fore-arm, thigh/shin) + dense
  3-frame key grid with shaped values + per-segment easing is what makes
  the walk read as a walk (planted phase, knee flex to ~40° mid-swing,
  2×-frequency body bob, eased decel into heel-strike).
- **Last key quirk:** the final key of a loop typically repeats the first
  key's value with `"duration": 0` (it carries the loop-end value; the
  previous key's duration is what stretches to the animation end).
- **`"playTimes": 0`** = infinite loop; `1..N` = N plays;
  **`"defaultActions": [{ "gotoAndPlay": "<anim>" }]`** sets the animation
  that auto-plays when the armature is built.
- There is **no special treatment of a bone named `root`** — it is just a
  bone. (We use it as the body's pivot so swim can rotate the whole body.)
- Bone/skin display `transform` objects accept `x`, `y`, `rotate`,
  `scaleX`, `scaleY` (degrees for rotate) — all optional.
- Slot → display mapping lives under `skin[].slot[].display[]`; the display
  `"name"` must match an atlas sub-texture name.

## 4. Phaser 3.90 patched-build quirks & the shim

`lib/phaser.min.js` in this repo is a **patched Phaser 3.90** build.
Everything below was hit (or verified) during the spike. **Do not "fix" the
Phaser file** — shim around it (the shim is in `index.html`).

1. **Render-type constants are non-standard.**
   `Phaser.AUTO = 0, Phaser.CANVAS = 1, Phaser.WEBGL = 2, Phaser.HEADLESS = 3`
   (stock 3.90: AUTO 0, CANVAS 1, WEBGL 2 — and `WEBGL | CANVAS` is the
   stock idiom for "auto"). Here `WEBGL | CANVAS = 3 = HEADLESS`, and
   HEADLESS **silently** runs the game with `game.renderer === null`
   (headless step, no canvas, no error) — a silent no-render trap.
   Always pass an explicit `Phaser.AUTO`, `Phaser.CANVAS`, or
   `Phaser.WEBGL`.
2. **`Phaser.Renderer.WebGL.Pipelines.TextureTintPipeline` is not exposed
   on the global**, but the DragonBones plugin's `TextureTintPipeline`
   inherits from it. Without a base class the plugin file throws during
   *evaluation* and nothing registers. → Shim stubs an inert base class
   (the plugin overrides everything it needs; plain untinted slot sprites
   don't actually route through it in canvas mode).
3. **`WebGLRenderer` lacks `hasPipeline()` / `addPipeline()`** (stock 3.90
   has them). The pipeline manager exists as `renderer.pipelines` with
   `.has()` / `.add()` → shim adds both methods delegating to the manager.
4. **The pipeline manager's `add()` calls `pipeline.boot()` and
   `pipeline.resize()`** → the stub prototype needs no-op `boot()` /
   `resize()` / `flush()` and sets `hasBooted = true` (the real boot also
   emits events; the stub doesn't need them).
5. **The WebGL `Pipeline` constructor signature is `(config)`** (single
   arg) and derives the renderer via `this.renderer = config.game.renderer`
   — NOT `(scene, config)`. Relevant if you ever make the WebGL path work
   (see next section).
6. **`game.scene.getScene(key)` returns `null` at script-load time** —
   i.e. immediately after `new Phaser.Game(...)`, before the scene manager
   has registered the scene's key (verified live with a `__spike2`-assignment
   probe: `getSceneAtLoad: "null"`; found by ~2s). **Never capture
   `getScene(...)` in a closure at load time** — resolve it lazily inside
   event handlers / callbacks. (The first version of `spike2.js` captured
   it at load and every button threw `Cannot read properties of null`.)
7. **`GameObject.setPipeline(name)` is null-safe in this build:** if the
   named pipeline doesn't exist (or there's no pipeline manager), it's a
   no-op — which is exactly why canvas mode survives the plugin's
   `setPipeline("PhaserTextureTintPipeline")` calls in slot constructors.
8. **DragonBones port naming gotcha:** in the 5.7 JS port, a bone's
   `rotation` property is the **skewY in radians** (Transform stores
   skewX as `skew`, skewY as `rotation`) — it is NOT the bone's rotation
   angle. To read a bone's actual orientation use
   `Math.atan2(b.globalTransformMatrix.b, b.globalTransformMatrix.a)`
   (radians). `bone.x`/`bone.y` are local pose offsets, not world position.

## 5. The `setPipeline` crash and why the spike uses CANVAS

Under WebGL (via `Phaser.AUTO` in a browser with WebGL) the chain was:

1. Slot sprites (`SlotImage`/`SlotSprite`, `dragonBones.js` lines 15436–15467)
   call `this.setPipeline("PhaserTextureTintPipeline")` in their
   constructors, so every slot sprite carries the plugin's tint pipeline.
2. The plugin's `TextureTintPipeline` inherits the **stub** base class (see
   quirk #2), whose no-op `super(config)` never sets `this.renderer`
   (in a real build the single-`config` constructor would do
   `this.renderer = config.game.renderer`).
3. At render time `TextureTintPipeline.batchSprite` (line 15726) does
   `this.renderer.setPipeline(this)` → **`TypeError: Cannot read properties
   of undefined (reading 'setPipeline')`** every frame.

**Fix applied (simplest robust one):** `type: Phaser.CANVAS` in
`spike2.js`. Why it's clean:

- The scene plugin registers the tint pipeline **only when
  `renderType === Phaser.WEBGL`** (line 15934), so under canvas nothing is
  registered;
- the slot constructors' `setPipeline("PhaserTextureTintPipeline")`
  becomes a no-op (quirk #7);
- canvas 2D rendering ignores `sprite.pipeline` entirely;
- plain (untinted) armatures render identically in either mode.

If a future milestone *needs* WebGL-specific features, the options are:
re-implement the tint pipeline's `boot`/`batchSprite` against this build's
pipeline API (its constructor takes `{ game, renderer }` — quirk #5 — so a
stub base that sets `this.renderer = config.game.renderer` would at least
get the instance wired up), or no-op `batchSprite` and rely on the default
pipeline (loses per-slot tinting, which the game doesn't use yet).

## 6. Plugin API notes for M1/M2

- **Scene plugin registration** (game config, once):
  ```js
  plugins: { scene: [{
    key: 'DragonBones',
    plugin: dragonBones.phaser.plugin.DragonBonesScenePlugin,
    mapping: 'dragonbone'
  }] }
  ```
- **Create the armature:**
  - `this.load.dragonbone(key, textureURL, atlasURL, skeletonURL)` —
    **arg order is texture PNG first**, then atlas JSON, then skeleton JSON
    (easy to mix up with other engine bindings).
  - `var display = this.add.armature(armatureName, dragonBonesName)` —
    first arg is the **armature name inside the JSON** (here `"girl"`),
    second is the **loader key** (also `"girl"`). Returns an
    `ArmatureDisplay` (a Phaser `Container`), added to the display list.
- **Swap / control animations:**
  - `display.animation.play(name)` — restarts that animation at frame 0.
    `playTimes` optional: `0` = loop forever, `1..N` = N plays.
  - `display.animation.stop()`, `playTimes`, `timeScale` available on the
    `Animation`/`AnimationState` objects.
  - This build's `Animation.play(animationName, playTimes)` has **no
    startTime parameter**; to seek mid-animation use the (beta)
    `animation._animationConfig.position = <seconds>` + `playConfig`, or
    just let it loop.
  - The scene plugin advances the DragonBones `WorldClock` each frame —
    **do not** add the display to `updateList` or call update manually.
- **Flip facing:** `display.scaleX = -display.scaleX` (or set
  `SCALE * facing`). The rig is symmetric front-facing, so the flip is
  subtle visually — verified via `scaleX === -1.6` and state, not pixels.
- **Slot tint:** `SlotImage`/`SlotSprite` request
  `"PhaserTextureTintPipeline"` for tinted display replacement
  (`ReplaceSlotDisplay`); in this build that path is broken under WebGL and
  unused under canvas. **Tinting slots is not available in M0** — don't
  design M1 art around per-slot tints unless we fix the pipeline path.
- **Reading bone state (debug/pose checks):**
  `display.armature.getBone(name).globalTransformMatrix` →
  `atan2(b, a)` = orientation (radians); `display.armature.getSlot(name)`
  → the slot (its `.display` is the Phaser sprite).
- **Multiple armatures / other data:** each `load.dragonbone(key, ...)`
  key is independent; `add.armature` can create many displays from one
  data set. `this.dragonbone.createDragonBones(key)` (scene plugin) builds
  the data without a display if you need to share it.

## 7. Verification results (2026-09-05, headless Chromium via Playwright)

- **Console:** zero errors, zero warnings, zero `pageerror`. (Only the
  informational Phaser boot banner and the DragonBones version line.)
  The earlier `[WebGL] GPU stall due to ReadPixels` warning was a headless
  SwiftShader screenshot artifact and does not occur in canvas mode.
- **Offline:** every request was `http://localhost:8123/...`
  (`/spike2/`, `phaser.min.js`, `dragonBones.min.js`, `spike2.js`,
  `girl.png`, `girl_tex.json`, `girl.json` + one `blob:` URL for a local
  texture). No external requests.
- **FPS:** 60 (rAF counter over 1.5 s).
- **Bone angles (global orientation, degrees) — objective animation proof:**
  - walk t0: legL −11.2 / legR +11.2 / armL +9.6 / armR −8.0
  - walk t+0.5s: legL +16.8 / legR −16.8 / armL −14.4 / armR +12.0
    → legs/arms swapped phase (half a 1.0 s cycle apart).
  - swim t0: legs 81.2 (horizontal) / arms −155.2
  - swim t+0.48s: legs 74.3 / arms +29.1 → mid-stroke vs opposite stroke.
- **Flip:** label `girl · walk · 1.6x · facing left`, `facing: -1`,
  `scaleX: -1.6` after one click; back to right after a second.
- **Screenshots** (`shots/`, visually inspected):
  - `walk_1.png` — mid-stride, legs drawn together, arms at sides.
  - `walk_2.png` — legs scissored wide (A-shape), one arm swung across torso.
  - `swim_1.png` — body near-horizontal at the waterline, one arm raised mid-stroke.
  - `swim_2.png` — same horizontal pose, arms swung in front of the torso (opposite stroke phase).
  - `walk_flipped.png` — walk, facing left (state-verified).

## 8. What M1 should do (handoff)

- Replace the stick rig with real art authored in the LoongBones editor
  (export at **5.5** — login/account needed for export; or continue
  hand-authoring small rigs), reusing the exact pipeline proven here:
  `load.dragonbone` → `add.armature` → `animation.play`.
- Keep `type: Phaser.CANVAS` (and the shim in `index.html`) until someone
  deliberately makes the WebGL pipeline path work on the patched build.
- Keep the lazy `getScene` pattern (quirk #6) in any page-level code.
