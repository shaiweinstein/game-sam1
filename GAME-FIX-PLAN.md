# GAME-FIX-PLAN.md — issues found in a full playthrough (2026-09-26)

**How this was checked:** a scripted playthrough in Chromium (Playwright, software WebGL) of every screen —
welcome, wardrobe (all 6 tabs, undo), print sheet, friends, kitchen, town-map travel to every place, the 3D library
(bookshelf, reader, narration, end credits), the 3D beach (swim, surf, catch, swimsuit change) and a reload — at
**phone 390×844 (touch), tablet 820×1180 (touch) and desktop 1366×768**, recording console errors, failed requests,
horizontal overflow and tap-target sizes; plus targeted probes (energy rules, trip timing, translated-book credits)
and all 17 regression suites (results in §5).

**What's healthy:** no JavaScript page errors, no failed or 4xx requests, no horizontal page scroll, every flow
completed. Energy rules behave (0–100 clamp, "too hungry to travel" below a trip's cost, food never costs), trips
arrive (Grandma's → Home 3.8 s), progress survives a reload ("Continue" appears), narration plays ("⏹ Stop" state),
and tap targets are ≥ 40 px everywhere except one (P3.1).

## P1 — correctness

### P1.1 Translators credited as authors for 4 books (CC BY attribution) — **fix first**
- **Seen:** *Smile Please!* shows **"by Manisha Chaudhry"** on its shelf card and **"Written by Manisha Chaudhry"** on
  "The End" credits. Manisha Chaudhry is the *translator*; the author is **Sanjiv Jaiswal 'Sanjay'** (the book's own
  title page says so). Same pattern for *The Bee and the Elephant* (author Long Ravy, tr. Celia Bolam), *The Three
  Little Kittens* (author Chou Chinith, tr. Magdalena Cooper) and *Rabbit Becomes a Chef* (author Chammi Iresha,
  tr. Magdalena Cooper).
- **Why it matters:** CC BY 4.0 requires correct attribution. The error also reaches `library/CREDITS.md` (its
  "CC BY attribution: … by <authors>" lines are built from the same field) and therefore the website's
  `/credits/` page. (The website's `/library/` list already shows the right names — `make_deploy.py` reads the
  title page — but the game and the credits file don't.)
- **Cause:** `tools/fetch_books.py` stores StoryWeaver's `authors` field, which holds the translator for
  translated books (lines ~574 / ~1175); `js/books.js` shows it as "by …" (l. 627) and "Written by …" (l. 886).
- **Fix:** in `fetch_books.py`, take author / illustrator / translator from the StoryWeaver credit data (or the title
  page's "Author: … Illustrator: … Translator: …" line), store `authors` + a new `translators` list in
  `book.json`/`manifest.json`, regenerate `CREDITS.md`; in `books.js` add "Translated by …" on the credits page and
  keep "by <author>" on the shelf. Add a `make_deploy.py` assert that each StoryWeaver book's first author matches
  its title-page "Author:" line.

### P1.2 Four regression suites fail — the tests are out of date, not the game (§5)
- Fix the tests so the suite is green again; otherwise real regressions will hide among known failures.

## P2 — layout and usability

### P2.1 Two different headers depending on the screen
- **Seen (all sizes):** the Dress Up screen uses a compact header (title, energy and sound in one row, small nav
  chips), while Kitchen, Map and Friends use a tall stacked header (big title, energy on its own line, big round nav
  buttons). The page visibly jumps when switching tabs.
- **Fix:** one header component for all four screens; pick the compact one (it's the one that fits phones).

### P2.2 Desktop: Kitchen / Map / Friends squeezed into a narrow column
- **Seen (1366×768):** these screens render in a ~430 px phone-width column with two-thirds of the window empty, yet
  their content runs below the fold (the kitchen's second food row, the map's Home/School/Toy Shop/Beach cards).
  The wardrobe on the same window uses the full width.
- **Fix:** give these screens the wardrobe's wide container on ≥ 1024 px (kitchen: Lily left, food grid right; map:
  board sized to the viewport height).

### P2.3 Phone: the header eats ~40 % of the screen outside the wardrobe
- **Seen (390×844):** on Kitchen the first food button starts at y≈717; on Friends only Lily's card is above the fold.
- **Fix:** comes with P2.1 (compact header everywhere); also shrink the talk bubble + helper text on phones.

### P2.4 Phone: the town map becomes a ~1,500 px vertical list
- **Seen:** below tablet width the board turns into 7 tall full-width cards (roads and scenery gone); the Beach —
  the most-used place — is the last card, ~1,400 px down.
- **Fix (pick one):** scale the real board to the phone width (it already works well at 820 px), or a compact 2-column
  grid of places with Beach and Library first.

### P2.5 Phone: the print-paper-dolls preview overflows sideways
- **Seen:** the sheet preview is laid out at printed-paper width, so the instructions and doll are cut off on the
  right (the page itself doesn't scroll; the preview pane does, awkwardly).
- **Fix:** scale the on-screen preview to fit the pane (`zoom`/`transform: scale()` on `.print-pages` for screen only);
  `@media print` stays untouched, so printed sizes don't change.

### P2.6 Book title page: credits run together as one line
- **Seen:** page 1 of every StoryWeaver book reads *"The Red Raincoat Author: Kiran Kasturia Illustrator: Zainab
  Tambawalla"* as a single run-on sentence (and the narrator reads it that way).
- **Fix:** in the reader, split a title page's text at "Author:", "Illustrator(s):" and "Translator:" and show them as
  lines under a larger title (narration can read "by Kiran Kasturia, illustrated by Zainab Tambawalla").

## P3 — polish

### P3.1 "📖 Read a book" button is 32 px tall on phones
- Below the 40–44 px minimum for small fingers. Give it `min-height: 44px` on narrow screens.

### P3.2 Beach extras: `flatShading` ignored on toon material (console warning ×15)
- `beach3d/extras3d.js:66` creates `MeshToonMaterial({ flatShading: true })`; three.js r170's toon material has no
  `flatShading`, so it warns on every extra and the intended faceted look is never applied.
- **Fix:** drop the option (accept smooth shading) or bake flat normals (`geometry.toNonIndexed()` +
  `computeVertexNormals()`) to keep the cel look. Removes the console noise.

### P3.3 "Play catch" from far away: ~10 s of walking before anything happens
- **Seen:** from behind the umbrella, Lily walks ~10.5 m to the ball at ~1.1 m/s (10 s), then ~4 s back to the
  throwing spot. It works, but it is a long wait for a 4-year-old after one tap.
- **Fix:** run instead of walk when the approach is longer than a few metres (the rig has a run clip), or start the
  friend walking toward Lily at the same time.

## 5. Regression suites

Full run of all 17 suites against `serve.py` (2026-09-26), then the 4 failures re-run alone (same result both times):

| Suite | Result |
|---|---|
| appearance, book, camera, footwear, garment, ground_contact, library_camera, sandcastle, scene, surf_touch, character_fit, character_svg, print_dolls | ✅ pass (13) |
| `beach3d/catch_test.py` | ❌ "scripted approach routes around post rather than trapping" |
| `beach3d/swim_style_test.py` | ❌ timeout selecting "Swim Style" at 420×720 |
| `beach3d/swim_switch_test.py` | ❌ timeout clicking `[data-activity-id="swimsuits"]` |
| `tests/wardrobe_test.py` | ❌ timeout clicking `[data-activity-id="swimsuits"]` in the phone-size viewport matrix |

**All four are test problems; the game behaves correctly** (verified by hand in the browser):
- **swim_style / swim_switch / wardrobe:** on narrow screens (≤ 620 px, or short touch screens) the beach bar is
  compact: "Change swimsuit", "Play catch", "Build sand castle" and the Swim Style picker live behind the **Menu**
  button (commit 9c7da77, 2026-09-11). Opening Menu shows them all at ≥ 44 px, and they work. The tests click them
  directly without opening Menu. **Fix:** a shared helper `open_beach_menu(page)` that clicks "Menu" when
  `.beach-actions.beach-compact` has a visible menu button, called before those clicks.
- **catch_test:** the game plans the detour correctly — immediately after "Play catch" the path is
  `[(-5.4, 2.29), (4.52, 3.4)]` (around the post, then to the ball), and Lily walks it and reaches "ready". The test
  reads the path a moment later, after the first waypoint has already been consumed, and sees one point. **Fix:**
  assert on the path from the first frame (e.g. record `playerPath` via a hook when the approach starts), or check
  that her track never crosses the post collider and the phase reaches "ready".

## 6. Suggested order

1. **P1.1** book credits (legal correctness, small, contained to the book pipeline + `books.js`).
2. **P1.2** repair the 4 tests, so every later change is checked by a green suite.
3. **P2.1–P2.3** one compact header + wide desktop layout (one CSS/markup pass; re-run `wardrobe_test`'s viewport matrix).
4. **P2.4** phone map, **P2.5** print preview, **P2.6** title pages.
5. **P3** polish items.
