# Beach Play Rebuild — "Make it feel like a computer game"

## Problem (daughter's feedback, verified)
The current DOM/CSS beach is a **pose-swap toy**, not a game:
1. Swimming doesn't look like swimming — static rotated body, **no arm/leg motion**.
2. **No control** over where/how she swims — clicking a button plays a canned animation.
3. Character doesn't actually travel across the water while swimming/surfing.
4. No swimsuits.

Root cause: DOM/CSS keyframes can't do real locomotion, limb rigs, or pointer-driven play.

## Research summary (Aug 2026)
| Option | Verdict |
|---|---|
| **Phaser 3.90.0** (MIT, UMD `phaser.min.js` 1.2 MB → ~300 KB gzip) | ✅ **Chosen.** WebGL renderer with automatic canvas fallback, built-in input (mouse+touch identical API), tweens, particles, scene lifecycle. No build step — one `<script>` tag, vendorable locally (offline-safe). A decade of docs/examples. |
| Phaser 4.2.1 | Newest stable, same idea, but smaller example corpus and avoidable API drift for a kids' 2D scene. Revisit later, not needed now. |
| PixiJS 8.20.1 | Pure renderer (WebGL2/WebGPU) — we'd hand-roll input, loop, tweens, particles. More code, more bugs. |
| Three.js (3D) | A 3D ocean is the wrong complexity for a dress-up mini-game; hard to keep the cute 2D style. |
| Kaboom/gooey engines | Fun but adds abstraction without replacing our main need (custom animated rig). |

**Rendering approach:** procedural **vector character rig** drawn with Phaser `Graphics` inside nested `Container`s (torso / head / 2×[upper arm, forearm] / 2×[thigh, shin]). Each joint is a container whose `rotation` we animate every frame → real freestyle strokes, flutter kick, walk cycle, surf crouch. Colors come from the existing per-friend palettes (`CHARACTERS` skin/hair tokens in `js/character.js`) and the new swimsuit → every friend looks right without sprite sheets, and the rounded cartoon style matches the current art.

## Target experience
- Open beach → **full canvas scene**: same cute look (sun, clouds, gulls, layered waves, sand, umbrella, shells) but now drawn in WebGL with live water motion.
- **Hold the mouse/finger anywhere → Lily swims there with animated front-crawl**, stops and bobs when released. Tap on sand → she walks (real walk cycle). Water entry = dive + splash; exit at shore = walk out of the shallows.
- **Duck boat**: swim to it, press board → sits in boat, paddling arms, pointer steers, wake trail.
- **Surfing**: paddle to a wave (hold toward it), press Catch near a breaking wave → stand-up on board (crouch + balance arms), ride across the screen steering with pointer, wipeout = big harmless splash. Wave counter stays.
- **Sandcastle**: tap the build pad on the sand, keep the 5-tap build stage art (re-drawn in canvas), sparkles.
- **🩱 Swimsuits**: new wardrobe tab (6 suits — one-piece, bikini, tankini, sport, ruffle, striped; 2-piece vs 1-piece changes how the rig is painted). She wears the chosen suit in the water, normal outfit on land. Quick "Change suit" button in the beach action bar.
- Energy stays free at the beach; no failure states; nothing faster than a happy swim.

## Architecture
- `lib/phaser.min.js` — vendored (no CDN dependency at runtime).
- `js/beach-game.js` — NEW. Owns the Phaser game: lifecycle (`BeachGame.open(stageEl)/close()`, create once per open, `destroy(true)` on close to release WebGL context), world layout, input, entities.
- `js/beach.js` — SHRINKS to the DOM chrome it already does well: overlay, header/close, action bar buttons → thin commands into `BeachGame`, speech, castle state. All DOM mode-animations (`--boat-x`, `--surf-x`, wave sweeps, mode classes) deleted.
- `js/state.js` — add `outfit.swimsuit` (default `suit1`; existing load loop tolerates old saves).
- `js/wardrobe.js` + `js/character.js` — swimsuit catalog + render layer (naked body base under street clothes is already how items layer, so suits slot in).
- `css/style.css` — delete dead beach animation blocks; add canvas sizing + touch-action rules.

## Global TODOs (each = one code-worker mission)
### Foundation
1. Vendor Phaser 3.90.0 (`lib/phaser.min.js`, script tag in `index.html`); boot a transparent canvas over `#beach-stage` inside the overlay; `Scale.FIT` fixed 1280×720 logical world; lifecycle create-on-open / destroy-on-close; WebGL active + console clean.
2. World layout constants (sky/sea/sand bands, waterline at the old `--sea-top`, shore line, safe bounds) + canvas background: gradient sky, sun+rays, drifting clouds, gulls, sand, umbrella, shells, starfish, ball (match current palette).
3. Animated water: sine waterline with foam, shallow/deep color bands, sparkles; reduced-motion amplitude → near-static.

### Character rig
4. Rig core: nested-container vector swimmer parameterized by skin/hair/suit colors; facing flip; idle bob + floating-in-place pose.
5. Walk cycle (sand) + wade cycle (shallows, body upright, legs lift).
6. Swim cycle: alternating front-crawl arms, flutter kick, body roll, head turn to breathe; lower body occluded by translucent water overlay → "in the water" look.
7. Pointer locomotion: hold-to-move toward pointer (mouse & touch), release → stop & bob; target ripple marker; auto switch walk/wade/swim by zone; dive splash on entry, walk-out on exit; soft bounds; kid-gentle speeds.

### Gameplay
8. Boat: ride state (paddling arms sit in duck boat), pointer steering moves boat, bobbing + wake; board/hop-off near it.
9. Surf: wave set generator; paddle mode; catch window → stand-up (crouch, balance arms) → ride the face steering with pointer; miss/wipeout = splash, no penalty; wave counter + sounds.
10. Castle builder ported to canvas at a fixed sand pad (5 stages + sparkle finale + rebuild), kept reachable via existing action button.
11. Juice pass: splash particles (hands, feet, entries), dive arc, pop/cheer/oops sounds, speech-line hooks, small screen-free camera feel (no shaking — kid comfort).

### Swimsuits
12. State: `outfit.swimsuit` + save-migration test.
13. Wardrobe: "🩱 Swimsuits" tab, 6 catalog items (SVG with existing palette-token conventions), preview on dress-up screen.
14. Beach rig consumes chosen suit (1-piece vs 2-piece rendering; colors), "Change suit" shortcut in beach action bar.

### Cleanup & verification
15. Remove all dead DOM beach-mode code/CSS; keep chrome, speech, actions registry working.
16. E2E Playwright verification: sampled limb rotations change during swim (proof of animation), pointer-hold moves character across the sea, boat steering, catch/ride/wipeout, castle stages, suit switch visible in rig, mobile 420×720 touch, reduced-motion, 60 fps sanity (frame-time sampling), zero console errors, existing screens regression, save integrity.
17. Final review pass + hand-off summary for the parent (how to play).

**Acceptance bar (from the kid's complaints):** she can point anywhere and Lily *swims there, stroking with arms and kicking legs, crossing real distance*; surfing and boating steer continuously; and there's a swimsuit aisle in the wardrobe.

## Risks
- WebGL on very old iPads → Phaser auto canvas fallback (verify once on Safari).
- Repeated open/close context leaks → full `game.destroy(true)` + single-instance guard.
- Phaser + our IIFE style → keep game logic in `beach-game.js`, expose only `window.BeachGame.open/close/setCommand`; no globals leaks.
