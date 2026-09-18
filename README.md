# 🌈 Lily's Dress-Up Adventure — [play it at lily.game](https://lily.game)

An open-source browser game built by a dad and his daughters: Lily tries on
outfits and swimsuits, cooks pancake breakfasts in the kitchen, hangs out with
friends, and plays on a full 3D beach — swimming, surfing, a duck boat, ball
catch, and a freeform **sandcastle builder** whose creations stay on the beach
when you come back.

**Play:** https://lily.game (no install, no account, works on phones/tablets/desktops)

## Why it's safe for kids

No sign-up, no chat, no third-party trackers or ads in the game itself; the
only saves are your browser's own localStorage; the only downloads come from
this one site. A small, clearly-labeled ad area on the landing page (not the
game) keeps it free — served child-directed/non-personalized per Google's
Families policies. Details in `privacy.html` and
[`MONETIZATION-AND-LICENSING.md`](MONETIZATION-AND-LICENSING.md).

## Repository map

| Path | What |
|---|---|
| `index.html`, `js/` | 2D game shell: screens, wardrobe, kitchen, friends, energy, map (vanilla JS + vendored Phaser for the beach canvas mode) |
| `beach3d/` | the 3D beach (three.js r170): world, character, surf/boat/ball, and the sandcastle builder (`sandcastle-field/editor/3d.js` — marching-cubes density sculpting with poured-sand physics) |
| `beach3d/assets/` | GLB character/props (license: `LICENSE-ASSETS`) |
| `lib/three`, `lib/phaser.min.js` | vendored engines (MIT — see `THIRD-PARTY-NOTICES.md`) |
| `spike/`, `spike2/`, `spike3/` | development rigs (SVG character pipeline, DragonBones/SkelForm experiments, Blender GLB toolchain) — dev-only, excluded from deploys |
| `beach3d/*_test.py`, `tests/` | Playwright/python regression suites (run against `serve.py` on :8123) |
| `landing.html`, `make_deploy.py`, `deploy/` | public marketing/AdSense landing + the static-site deploy builder (asserts dev files never ship) |

## Develop locally

```sh
python3 serve.py          # serves the repo at http://localhost:8123 (the game)
python3 -B beach3d/sandcastle_test.py   # example regression suite
python3 make_deploy.py    # builds the clean public bundle into deploy/
```

The 3D beach loads as ES modules, so it requires an http:// origin (a plain
`file://` open gracefully falls back to the 2D beach).

## License

* **Code** — MIT © 2026 Shai Weinstein and his daughters ([LICENSE](LICENSE)).
* **Art & 3D assets** — CC BY-NC 4.0 ([LICENSE-ASSETS](LICENSE-ASSETS)),
  with third-party-derived parts governed by [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
  (notably: animation clips retargeted into the shipped GLBs come from Adobe
  Mixamo, used under Adobe's terms — the raw Mixamo source files are
  intentionally not distributed here).

Built with 💛 and far too much coffee.
