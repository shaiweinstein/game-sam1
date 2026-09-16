# 2D Dress-Up — Clothing Fit Audit & Fix Plan

**Scope:** the 2D SVG character (`js/character.js` catalog + compositing) and its picker
thumbnails. The 3D/canvas beach rig (`js/beach-rig*.js`, `beach-parts.js`) is separate art
and is only touched through the swimsuit `colors` contract.

**Status:** steps **0, 1, 2 implemented** (guard rails + anchor contract + sleeve rebuild).
Steps 3–5 (headwear, footwear, pattern/prop details) are still owed — every one of them is
already enumerated by rule id in the fit test's `pending` list, so the audit list is now
executable rather than prose.

Run the fit contract against a live server:

    python3 serve.py 8123          # or any static server on the repo root
    /tmp/kilo/venv/bin/python tests/character_fit_test.py
    /tmp/kilo/venv/bin/python tests/character_fit_test.py --strict   # enforce steps 3-5 too

Default mode asserts the rules that currently hold (R1/R2/R3/R4/R7) and prints the rest as
`TODO:` lines; `--strict` turns those into failures. Evidence JSON lands in
`--output` (`/tmp/kilo/wardrobe-fit/fit-results.json`), including a `seatTable` of per-hair
headwear measurements for Step 3.

Verified green in this environment: `tests/character_fit_test.py` contract → **0 active
failures**, and the pre-existing `tests/character_svg_test.py` contract → **status: passed**
(164 thumbnails, 64 top×bottom pairs, 24 friend-suit + 24 detail pairs). Both were executed
headlessly with the committed JS contracts.

---

## 1. Ground truth: the body anchors

`viewBox="0 0 300 340"`, `BODY_MARKUP` in `js/character.js:144-174`:

| Anchor | Value | Source |
|---|---|---|
| head ink | x 92..208, y 50..160 | `ellipse cx=150 cy=105 rx=58 ry=55` |
| eyes ink | y 92..114 | `ellipse cx=128/172 cy=103 ry=11` |
| torso ink | x 116..184, y 164..250 | `rect x=116 y=164 w=68 h=86 rx=26` |
| arm curve | (122,172)→Q(104,194)→(98,226) / mirrored | arm strokes, outline w=15, skin w=9 |
| hand centre | (98,226) / (202,226), ink to y≈233 | round cap |
| leg centres | x 138 & 162, y 248..302 | skin w=10 → ink x 133..143 / 157..167 |
| leg ink bottom | y ≈307 skin, ≈310 outline | round cap on w=17 outline |
| ground shadow | cy 328 | ellipse |

Reference layer order (`LAYER_ORDER`, `js/character.js:888`):
`shadow, hair-back, extra-back, body, swimsuit, top, bottom, shoes, hair-front, extra-front`
— so **headwear (`extra-front`) always paints over hair**, and `shoes` always paint over `bottom`.

---

## 2. Confirmed defects (measured)

### P1-A — Sleeves on all `TEE_PATH` tops don't follow the arms ✅ FIXED (step 2)
**Before** (straight sleeve tips `L 204 174` / `L 96 174`):
| measured | value |
|---|---|
| fabric past the arm at y170-180 | **+14.4u (left) / +14.6u (right)** — empty wing, max allowed 6 |
| arm showing past the sleeve hem at y200-210 | **7.0u / 6.8u** — arm poking out, max allowed 3 |
**Items:** `top1, top4, top5, top6, top7, top8` (6 of 8 tops) — `TEE_PATH` at `js/character.js:238`.

Measured sleeve bbox `x 96..204, y 162..244`, and the sleeve is four straight line
segments, while the arm is a quadratic that swings outward as it descends:

| y | arm outer edge (right) | sleeve outer edge | error |
|---|---|---|---|
| 174 | x≈187 | **x=204** | +17u of empty fabric sticking out past the arm |
| 206 | x≈204 | **x=195** | −9u: the arm pokes out *below/behind* the sleeve |

Visual result (verified in screenshots): stiff triangular "wings" at the shoulders, bare
upper arm, and the forearm emerging outside the sleeve hem.
**Proof the fix pattern already exists:** `top3 Sunny Sweater` (`js/character.js:362-381`)
draws its sleeves as strokes on the arm's own curve (`M 118 172 Q 104 194 99 218`, w=19
outline + w=13 fill) and looks correct.

**Fix shipped — and the lesson from a false start.** Attempt 1 kept the single filled sleeve
path and only re-angled its outer edge to be concentric with the arm. Numbers improved
(14.4u → ~4u) and the contract went green, **but the cards still looked wrong** — because
`renderItemPreview` draws a top with *no arms behind it*, a thumbnail can only ever
communicate the garment's own silhouette, and a filled flap reads as a wing wherever its edges
land. Attempt 2 adopted the `top3` pattern instead (arm curve stroked 19u trim + 13u fill,
round caps), which is what makes the silhouette read as a rounded sleeve.

| measured | original | attempt 1 | shipped |
|---|---|---|---|
| fabric past arm @y170-180 | +14.4 / +14.6u | ~4u | **+2.7u** |
| arm showing past cuff @y200-210 | 7.0 / 6.8u | ~0u | **1.0u** |
| `top3` reference (never complained) | +4.8u | +4.8u | +4.8u |

Rule for the rows still open: when an item is shown in the picker, judge its **isolated
silhouette**, not just its geometry against the dressed body.

### P1-A2 — Hard shoulder corners on the tee body and the dress ✅ FIXED
Found by eye after the sleeve fix: the garment *body* still ended in a sharp corner at
(x116/184, y162) which poked out from under the rounded sleeve cap, so every tee card read as
pointy "hanger shoulders" — the dress had the same corner (`M 116 162 … L 186 207`). Only
`top3` was right, because its body rounds that corner (`Q 186 162 186 186`).

**Fix:** `TEE_TORSO_PATH` shoulder corners became quadratics of radius ~12 (`Q 184 162 184 174`
and mirror) with the neckline now stopping short of them at x128/172; the dress body got the
same rounding. R3 is unchanged by it (+2.7u overhang, 1.0u uncovered at the cuff) — which is
exactly why this one needed an eye: the corner sits *inside* the sleeve's painted area, so no
edge-to-edge measurement can see it, yet the outline still drew a point.

### P1-B — Headwear floats off the head
| Item | ink bbox | problem |
|---|---|---|
| `extra6` Flower Crown | x 96..204, **y 73..97** | sits across the eyebrows (head top y50, eyes start y92). Needs to rise ~20–24u onto the hair dome. |
| `extra3` Sun Hat | x 74..226, **y 20..64** | the dome (y20..50) never overlaps the hair (hair1 dome top y44); the flat brim ellipse reads as a plate hovering at the crown. Drop ~10–14u / extend crown base to ≈y56. |
| `extra7` Cat Ears | x 106..194, y 18..60 | bases at y60 leave a white notch between the ears and the hair dome; spread and seat them into the hair. |
| `extra1` Strawberry Bow | **x 180..212**, y 38..72 | the head/hair edge at y60 is x≈183, so the bow hangs mostly outside the silhouette → "floating strawberry". Pull in/down to ≈x 168..200, y 44..78. |

### P1-C — Headwear × hairstyle collisions
`hair5 Space Buns` occupy x 71..229 / y 21..71 and `hair6 Big Curly` has curls at cy 44..56
r 21–22 — exactly the band where the hats/ears/crown live, and headwear paints **above** hair.
Verified bad combos: `extra3 × hair5` (hat squashed between buns), `extra7 × hair5`
(four ears), `extra6 × hair5/hair6` (crown buried in curls), `extra1 × hair6` (ok).
Two options, pick one in review:
- **Quick:** one global headwear seat (a `HEARLINE_Y` per item) tuned so it works for all 6 hairs.
- **Robust:** per-hair offset map on headwear items (`fitByHair: { hair5: [dx,dy], ... }`),
  applied when the `extra-front` layer is built. Costs ~15 lines in `buildSVG`.

### P2-A — Footwear sits under the feet instead of on them
| Item | ink | problem |
|---|---|---|
| `shoes3` Ballet Flats | y 302..322, **x 123..153 & 147..177** | top edge is 5u *below* the skin leg tip (307); the two flats **overlap each other by 6u** (rx15 is too wide for legs at 138/162). |
| `shoes4` Sparkle Sandals | sole **y 310..317** | the sole is entirely below the foot; the foot ends at 307 → hovering slippers. |
| `shoes5` Bunny Slippers | **ears reach y 273** vs cuff y 297 | ears sprout from the mid-shin, and are painted **over the jeans** in `bottom7` combos. |
| `shoes2` Rain Boots | y 296..322 (26u tall) | reads as a flat shoe, not a boot; shaft should reach ≈y 282 (then re-check vs `bottom3/bottom7` hems). |

### P2-B — Jeans hem vs shoe tops (bare ankle stub)
`bottom7` hem **y 298**; `shoes3` top 302, `shoes4` sole 310, and the leg ink runs to ≈307
→ a 4–9u band of bare skin between the cuff and the shoe (clearly visible with flats/sandals).
Fix by pairing the cuffs: jeans to ≈y 302 **and** shoe tops ≤ y 300.

### P2-C — `bottom6` Plaid Skirt pattern bleeds outside the silhouette
The comment at `js/character.js:522` claims the bands are "kept inside the skirt silhouette",
but they're plain strokes: `M 108 266 L 192 266` w=7 → x 104.5..195.5, while the skirt edge at
y266 is ≈x 105..195, and the vertical bands run to y 278..281 (past the hem curve). Confirmed
visually: blue rectangles jut out of both sides and the hem. Needs a `clipPath`/`mask` on the
skirt outline.
**⚠ Implementation trap:** the same markup string is rendered into *many* SVGs at once
(wardrobe stage, item thumbnails, `friends.js`, `map.js` walkers, `beach.js`), so a hard-coded
`clipPath id` will collide. Either hoist one shared `<defs>` or suffix ids at `buildSVG` time.

### P3 — Smaller items
- **`extra4` Tiny Backpack** (`js/character.js:683-697`): back panel x 100..200 / y 184..258 is
  wider than the torso (116..184) and hangs 8u below it → pink "fins" at the hips; the front
  straps are straight bars y 170..206 that stop mid-chest with round caps, so they never read as
  going over the shoulders.
- **`top6` Ladybug Tee** (`js/character.js:416-421`): antennae drawn at y 163..169 while the
  collar only dips to y≈168 → antennae render on the neck/above the fabric. Move to ≥y 170.
- **`top3` Sunny Sweater**: body path spans only x 138..186 at y162 with sleeves starting at
  (118/182, 172) → bare skin triangles on both shoulder caps.
- **`top2` Sparkly Dress**: hem y 285 is consistent with `bottom4/bottom8` (284/285) — *not* a
  length bug. The aesthetic issue is the straight tube bodice with square shoulder corners at
  (116,162)/(184,162) and no waist. Optional polish only.

---

## 3. Verified NOT broken (don't spend time here)
- No item's ink escapes the `300×340` viewBox — checked all 34 items, all slots.
- No skin gap between any tucked top hem (y 244) and any waistband (y 232) — now enforced by R2.
- `coversBottom` correctly hides `bottom` and never reveals the swimsuit; `untucked` reorders
  `bottom`/`top` correctly (`js/character.js:917-941`).
- **No picker thumbnail is clipped** — `renderItemPreview` already special-cases dresses
  (`js/character.js:1045` → `"82 150 136 146"`), which covers the y 285 dress hem.
- Swimsuit leg tabs (x 131..145 / 155..169) do cover the legs (x 133..143 / 157..167).

---

## 4. Fix plan (ordered, each step independently shippable)

**Step 0 — Guard rails first ✅ DONE.**
Committed as `tests/character_fit_test.py` (same shape as `tests/character_svg_test.py`:
routes a fixture document off the live origin, loads real `js/state.js` + `js/character.js`,
measures SVG geometry, never pixels). Rendered combinations: every item alone, all 8 tops ×
all 8 bottoms, all 6 shoes × {skirt, shorts, jeans}, all 7 extras × all 6 hairs, all swimsuits
in preview mode, and every picker thumbnail.

Rules as shipped:
| id | asserts | mode |
|---|---|---|
| R1 | every non-shadow layer's ink stays inside the 300×340 viewBox | active |
| R2 | a tucked top's hem reaches its bottom's waistband (no bare torso band) | active |
| R3 | `sleeved` tops: fabric ≤ 6u past the arm's outer edge at y170-180 **and** ≤ 3u short of it at y200-210 | active |
| R4 | hair fringe stays above the eye bottom (y 114) | active |
| R7 | each picker thumbnail's crop contains its own art | active |
| S1 / S4 | shoe opening must reach above the ankle line; an ankle-length hem must meet the shoe | pending (step 4) |
| H1 / H2 / H3 | headwear must intersect the head box, stay above the eyes, and seat ≥ 50% of its ink in the crown band | pending (step 3) |
| B1 | backpack panel must fit inside the torso silhouette | pending (step 5) |

Tolerances live in the test's `LIMITS` map, not in the art file.
*Deviation from the original wording:* no PNG contact sheet is committed — visual review ran
from the throwaway harness at `/tmp/fitcheck/harness.html` (anchor guides + per-slot grids),
and the committed test emits the JSON evidence instead. Re-add a screenshot target only if you
want it in CI.

**Step 1 — Anchor contract ✅ DONE.**
`BODY_ANCHORS` now sits directly under `BODY_MARKUP` in `js/character.js` (view / head / eyes /
torso / shoulderY / waistY / hipY / crotchY / arm curve + half-widths / leg centres + ink
bottoms / sole / ground), with a five-rule authoring contract in the comment above it, and is
exported as `window.CharacterRenderer.anchors` so the test reads the same numbers the art is
authored against (no duplicated magic constants). Item flag `sleeved: true` was added to the 7
items that cover the upper arm (top1/3/4/5/6/7/8); sleeveless items (the dress) omit it, which
is what stops the sleeve rule from firing on a bare-shoulder dress.

**Step 2 — Shared sleeve rebuilt ✅ DONE.**
`TEE_PATH`'s straight sleeve tips (`L 204 174 L 195 206` / `L 105 206 L 96 174`) are now curves
concentric with the arm (`C 189 167 195 185 204 206` and its mirror), with the armpit junction
moved to y 202 so the cuff reads as a cuff. Torso geometry is untouched, so `top1/4/5/6/7/8`
all changed together and `ITEM_VIEWBOXES.top` still contains the art (R7 green — no crop
re-tune needed). Measured after: overhang ≤ ~4u, arm show ≤ ~0u → R3 passes for all 7 sleeved
tops, and `top3` (which already used the stroke-on-curve pattern) still passes, which is the
control that proves the thresholds are fair rather than tuned to pass.

**Step 3 — Seat the headwear.**
Re-anchor `extra1/3/5/6/7` against the head box (numbers in §2 P1-B), then resolve the
hair collisions from §2 P1-C with the chosen option. Re-check `ITEM_VIEWBOXES.extra` per item.
*Effort M — or M+ if the per-hair offset map is chosen.*

**Step 4 — Footwear pass + jeans/shoe interface.**
`shoes3` (raise top to ≈298, narrow rx to ≈13, de-overlap), `shoes4` (raise sole to ≈300..316
with the foot inside it), `shoes5` (ears down to ≈y 288, bases tucked into the cuff), `shoes2`
(real shaft to ≈y 282); then fix `bottom7`'s hem so the cuff and shoe tops meet (P2-B).
Re-check `ITEM_VIEWBOXES.shoes` (`js/character.js:1014`).
*Effort M. Test all 6 shoes × {bottom1, bottom3, bottom7}.*

**Step 5 — Pattern bleed + prop details.**
`clipPath` the `bottom6` plaid bands (unique-id-safe per §2 P2-C); rework `extra4`'s pack size
and strap routing; lower `top6`'s ladybug antennae; close `top3`'s bare shoulder caps.
*Effort M. The clipPath id work is the only structural item here.*

**Step 6 — QA matrix + regression.**
Curated re-render: 6 hairs × 4 headwear extras (24), 8 tops × 3 bottom types (24), 6 shoes ×
3 bottoms (18), plus one non-default palette (e.g. `amara`) to catch tone-dependent contrast.
Then run `tests/character_svg_test.py`, `tests/wardrobe_test.py` (they assert `inkFits`,
preview scoping and layout — geometry edits must not break them) and the new fit test.
Regression surfaces that share this art: wardrobe stage + thumbnails, `friends.js` previews,
`map.js` markers/walkers, `beach.js` big stage.
*Effort S–M.*

**Suggested order:** 0 → 1 → 2 → 4 → 3 → 5 → 6 (Step 3 can swap with 4 depending on taste;
Step 2 alone removes the most obvious defect).

---

## 5. Constraints / risks to respect while fixing
- **Do not rename or reformat the swimsuit `colors` keys** (`main`, `trim`, `bottom`,
  `twoPiece`) — they are consumed by `js/beach-rig.js:2169`, `beach-rig-skf.js:496`,
  `beach-rig-v2.js:896` via `setSuitColors`.
- Keep `viewBox="0 0 300 340"`; `tests/wardrobe_test.py` asserts the art fits the stage box.
- Catalog markup is plain strings shared across simultaneous SVGs → any new element `id`
  must be per-instance or hoisted into one shared `<defs>`.
- Every geometry change must be re-validated against `ITEM_VIEWBOXES` (`js/character.js:1010-1023`)
  so picker thumbnails don't start clipping.
- Art-only changes; no `GameState`/storage/`aria` changes, so `wardrobe_test.py` expectations
  (markers, undo, tabs, scroll) stay valid.
- `tests/character_svg_test.py` uses SVG geometry contracts, not pixels — keep the
  `data-layer` group names intact so both the tests and the harness keep working.
