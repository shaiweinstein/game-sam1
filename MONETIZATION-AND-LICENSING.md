# MONETIZATION-AND-LICENSING.md — can this game be hosted + earn from ads?

Status: research complete (2026-09-18) · companion to the new `landing.html`.
Verdict first: **yes, you can host this publicly and run Google AdSense on it** — the code
license set is fully permissive and all art/audio is self-owned — with **four must-do items**
(2 security, 2 policy) and one realistic expectation: **kids content = reduced ad serving**
under Google's Families/COPPA rules, so budget for contextual (non-personalized) ads.

---

## 1. Licenses of everything shipped — all compatible with ad monetization

| Dependency | Version | License | Obligation | Status |
|---|---|---|---|---|
| three.js (`lib/three/`) | r170 | MIT | header intact in `three.module.js` + `lib/three/README.md` | ✅ keep as is |
| three addons (GLTFLoader, BufferGeometryUtils, OrbitControls, MarchingCubes) | r170 | MIT (part of three) | upstream ships no per-file header; covered by the three README | ⚠️ `OrbitControls.js`/`MarchingCubes.js` are **untracked in git** — commit them (also a functional must for the sandcastle builder) |
| Phaser (`lib/phaser.min.js`) | 3.90.0 (patched) | MIT | ⚠️ minified file carries **no** license text → MIT notice-preservation formally unmet | FIX: add `THIRD-PARTY-NOTICES.md` entry (created with the landing page) |
| DragonBonesJS (`lib/dbjs/`) | 5.7 | MIT | LICENSE file already vendored | ✅ (spike2-only, not loaded by the game) |
| SkelForm runtime (`lib/skelform/`) | — | MIT | LICENSE file already vendored | ✅ |
| JSZip (`lib/skelform/jszip.js`) | 3.10.1 | dual MIT **or** GPLv3 — use the MIT option | header intact in the file | ✅ |
| Fonts | — | none loaded (system font stack only) | none | ✅ |
| Audio | — | 100% procedural WebAudio (`js/sounds.js`) | none | ✅ |
| Art (2D SVG, 3D GLBs, atlases) | — | self-authored (Blender scripts in `spike3/blender/`, project SVG pipeline) | none | ✅ except Mixamo, below |

**No copyleft/GPL code is linked** (JSZip's GPLv3 option is unused; choosing MIT means no
viral obligations). MIT only requires keeping copyright notices — nothing forces you to
open-source the game or blocks advertising. Monetizing ads is 100% license-safe.

## 2. ⚠️ The one asset-provenance item: Mixamo animation clips

The shipped `beach3d/assets/lily4_full.glb` embeds retargeted animation clips downloaded
from Adobe Mixamo (`spike3/assets/mixamo/*.fbx`: walk/run/swim/sit/surf/cheer/wave…).

Per Adobe's Mixamo terms + official FAQ:
- ✅ Using Mixamo characters/animations **in a commercial game, royalty-free, is the
  intended use** ("if your Unreal game has Mixamo animations in it then you are fine").
  No attribution required.
- ❌ What is forbidden is **distributing the raw character/animation files** (FBX/DAE) —
  i.e. the `spike3/assets/mixamo/` folder must NEVER be publicly served, and no asset-pack
  redistribution of any kind.
- ❌ The 2021 Addl-Terms also ban using Mixamo content to train ML/AI (not applicable here).

**Action:** the deploy builder (see §6) excludes `spike*/` entirely, so the public bundle
contains only the compiled GLB — exactly the permitted usage. Keep the FBXs private.

## 3. Login-file hygiene (verified CLEAN — no emergency)

`adobe-login.md`, `Mixamo-login.md`, `loongbones-login.md` hold plaintext credentials.
Re-verified on 2026-09-18 directly against git (`git ls-files` → none tracked;
`git log --all -- '*-login.md'` → never committed; `.gitignore` line 19 covers them):
**the files exist only in the working tree, were never in the index or history, and are
correctly ignored.** Nothing is exposed, nothing to purge, no rotation needed on that account.
Keep it that way:
1. Don't force-add them (`git add -f`) — the ignore rule already protects normal `git add .`.
2. `make_deploy.py` additionally excludes `*-login.md` (plus all `spike*/`/tests) from the
   public bundle with hard asserts — a mis-deploy is covered too (verified: `grep -ri login
   deploy/` returns nothing).
3. Treat the passwords as exposed only if the raw folder itself is ever shared/zip-published.
   (An earlier audit pass claimed they were committed — that was checked and found false.)

## 4. AdSense eligibility — what Google checks (and where this project stands)

| Requirement | Situation |
|---|---|
| Own domain + HTTPS, editable HTML source | yours to set up (Netlify/GitHub Pages/static host all fine — the game is pure static, zero backend, zero external requests — great for review) |
| Original, substantial content; site not "just a tool" | a bare game page = "insufficient content" (the #1 rejection reason) → **this is exactly why the landing page matters**: real sections (gameplay, how-to-play, parents, FAQ) written for humans |
| Privacy Policy page (must disclose Google ads + cookies), About/Contact reachable | created alongside the landing (`privacy.html`); fill the contact email |
| Cookie consent (GDPR/CCPA) | AdSense's **Ultimate Consent Manager (UMP)** or equivalent — include the consent-mode lines (stubbed in the page) |
| No invalid traffic, no ads near controls, no deceptive layouts | the game UI gets **no ads**; ads live on the landing page only |
| Prohibited content | clean: no gambling/violence/data-collection; nothing to fix |
| Site must have existed & gathered some organic traffic for a few weeks | plan the application **after** launch + some real visitors, not day 1 |

## 5. 👧 The child-directed question (biggest revenue consideration)

Lily's game is clearly child-oriented (animated kid, dress-up, beach play). Under COPPA +
Google's Families policies you must declare the audience and Google then restricts ads:
- **Child-directed treatment** (declare in AdSense + tag ad requests, e.g.
  `requestNonPersonalizedAds`/`tagForChildDirectedTreatment`): interest-based and remarketing
  ads are **disabled** — contextual ads only, restricted categories (no adult/teen media,
  beauty, dating, scary content, etc.) → **lower CPMs (often 30-70% less)**.
- **"Mixed audience"** alternative (general/parent audience + children): more demanding under
  the 2025 FTC COPPA rule (age-screening, privacy notices, data-retention policy). Not worth
  the compliance surface for a small hobby site.
- Practical, honest recommendation:
  1. Run AdSense on the **landing page only** (readers are mostly parents).
  2. Set the site to **child-directed / non-personalized ads** in the AdSense UI (one setting;
     safest, and Google may classify it yourself anyway — misdeclaring it risks the account).
  3. Keep ads **out of the game page** (`index.html`): better for the AdSense placement policy
     (never near interactive controls) and for the child experience.
  4. Later option: Google's **H5 Games Ads** (by-application product for HTML5 games —
     interstitial/rewarded around gameplay). Requires an approved AdSense account + their
     form; the game's fully-local save/state design fits it fine.
- Realistic expectation: kid-site contextual ads pay little (think $0.5-2 RPM ranges, highly
  variable); the goal at first traffic levels is validating that people love the game, not
  meaningful income. Nothing about the licenses prevents trying.

## 6. Deployment shape (built by `make_deploy.py` with the landing page)

- Repo keeps its dev layout (tests load `/` = the game — untouched).
- `make_deploy.py` assembles a clean public `deploy/`:
  - `index.html` ← landing page (the new one) + `landing/` assets, `privacy.html`
  - `play/` ← only the game: `index.html`, `css/`, `js/`, `lib/`, `beach3d/**` (code+`assets/`)
  - EXCLUDED: `spike*/`, `tests/`, `beach3d/*_test.py`, `*.md` plans, `shots*/`,
    `spike3/assets/mixamo/` (FBX!), `*-login.md`, `serve.py` (not needed on real hosts),
    `.git*`, `spike/ref` SkelForm example + `skellina.skf` sample.
  - Includes `THIRD-PARTY-NOTICES.md` (MIT notices: three, Phaser, DragonBones, SkelForm, JSZip).
- Result: permitted Mixamo usage, preserved MIT notices, no credentials, no dev cruft, and a
  static bundle any CDN/static host can serve.

## 7. Honest answers to "can I make money?"

- **Legally**: yes — permissive MIT stack, self-owned art (with Mixamo handled as above), and
  Google's program policies are satisfiable. You're not blocked by any license.
- **Practically**: approval requires a content-rich site + a few weeks of organic traffic +
  consent + child-directed settings; earnings from a kids' browser game with contextual ads
  are modest unless traffic is substantial (thousands of pageviews/day). AdSense for
  kids-oriented sites behaves; the alternative networks that promise higher payouts often
  serve ad content inappropriate for children — not recommended for this audience.
- **Do now**: commit the 2 untracked addon files (`lib/three/addons/{controls,objects}/`),
  run `make_deploy.py` review, publish, add Search Console, apply to AdSense after a few
  weeks, and consider H5 Games Ads once approved.
