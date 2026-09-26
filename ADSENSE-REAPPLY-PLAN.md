# ADSENSE-REAPPLY-PLAN.md — getting lily.game past "Low value content"

**Status (2026-09-26):** AdSense review result: *"Your site isn't ready to show ads — We found some policy violations:
Low value content."* Site ownership is verified. `ads.txt` is correct (`pub-8606608049292845`).
This plan turns the one-page site into a real multi-page site, removes what makes it look unfinished, builds up
index coverage and traffic, then reapplies. Related: `MONETIZATION-AND-LICENSING.md` §4–§7.

## 1. Diagnosis: what the reviewer saw (checked live on lily.game)

| # | Finding | Why it hurts |
|---|---|---|
| 1 | **Domain registered 2026-09-18**, reviewed ~1 week later, almost no traffic | The rejection text asks for "a consistent presence on the web" and "genuine user interest". A brand-new site fails this regardless of content |
| 2 | **Visible ad placeholders**: three "Advertisement" boxes saying *"Ad space (leaderboard 728×90) — nothing renders here until the owner pastes their AdSense unit."*; `data-ad-slot="YYYYYYYYYY"` in the source | Reads as an unfinished page built around ads. The strongest "low value" signal we control |
| 3 | **Only 3 URLs**: `/`, `/play/` (a canvas, no crawlable text), `/privacy.html`. `sitemap.xml` lists exactly these | "Thin site": one long landing page (~2,500 words) is still a single page. No About or Contact page (only `mailto:` and a `#parents` anchor) |
| 4 | **No sign of ongoing maintenance** on the site itself (no changelog, no dated content) | "Exhibits ongoing curation and structural maintenance" is one of the three listed requirements |
| 5 | Child-directed site (TFCD tagged) | Allowed, but reviewed conservatively and limited to non-personalized ads. Not something to change; just raises the bar for 1–4 |

## 2. Phase A — remove the "unfinished" signals (small, do first) — ✅ done 2026-09-26

- [x] **landing.html** (now `site/pages/index.html`): delete the three visible `.ad-slot` placeholder `<div>`s (`ad-label` + `ad-hint`), and the
      commented-out `<ins class="adsbygoogle" … data-ad-slot="YYYYYYYYYY">` blocks. Keep ONLY the AdSense loader
      `<script … adsbygoogle.js?client=ca-pub-8606608049292845>` in `<head>` (needed for the review) and the TFCD tag.
      Ad units come back in Phase E, after approval, with real slot numbers.
- [x] Drop the landing copy that talks about ad placement ("ads appear only on the landing page …") from the visible
      page; keep the ads/cookies disclosure in `privacy.html` (required).
- [x] **make_deploy.py guard:** assert that no shipped HTML contains `ad-hint`, `YYYYYYYYYY` or
      `Advertisement placeholder`, so placeholders can't come back by accident.
- [x] Footer: replace `THIRD-PARTY-NOTICES.md` (served as raw Markdown) with a rendered `/credits/` page (Phase B).

## 3. Phase B — a real multi-page site (the main work) — ✅ done 2026-09-26 (not yet deployed)

**Build approach:** keep it static and stdlib-only. Add `site/` with one content fragment per page
(`site/pages/<slug>.html`: title, description, body) and one shared template (`site/base.html`: `<head>` with
canonical/OG/icon links, header nav, footer). `make_deploy.py` renders each page to `deploy/<slug>/index.html` and
**generates `sitemap.xml` from the page list** (replacing the hard-coded 3-URL assert with "every page is in the
sitemap and every sitemap URL exists"). The landing page moves onto the same template, so nav/footer are identical
everywhere.

**Header nav on every page:** Play · Activities · Printables · Library · Parents · About

| Page | URL | Content (original text, written for parents) | Source material already in the repo |
|---|---|---|---|
| Home | `/` | Current landing, shortened to an overview that links to the pages below | `landing.html` |
| Activities hub | `/activities/` | One card per activity | `landing/img/card-*.png` |
| Dress-up | `/activities/dress-up/` | ~400–700 words each: what the child does, what it practises (choices, colours, fine motor, reading, counting…), tips for playing together, 2–4 screenshots, "Play" button | `WARDROBE-FIT-PLAN.md`, `card-dressup.png` |
| Kitchen | `/activities/kitchen/` | 〃 | `card-kitchen.png` |
| Beach play | `/activities/beach/` | 〃 | `BEACH-GAME-PLAN-V2.md`, `card-beach-play.png` |
| Sandcastle builder | `/activities/sandcastle/` | 〃 | `SAND-CASTLE-PLAN.md`, `card-sandcastle-*.png` |
| Story library | `/activities/library/` | How the reader + narration work, reading-level tips | `LIBRARY-INVESTIGATION.md`, `card-library.png` |
| **Printable paper dolls** | `/printables/` | The strongest "unique value" page: free printable Lily paper doll + wardrobe with fold tabs, how to print/cut/assemble, photos of a finished doll. Offline, screen-free, original art | `js/print-dolls.js` (render the sheet to a downloadable PDF/PNG at build time, or open the print view directly via `play/?print=dolls`) |
| Book list | `/library/` | The 28 books: cover, title, level, authors/illustrators, CC BY credit + StoryWeaver link, a **short original blurb** per book. Do NOT publish the full book texts as pages (duplicate of StoryWeaver = "copied content") | `library/manifest.json`, `library/CREDITS.md` |
| Parents' guide | `/parents/` | Safety & privacy (no accounts, no data, no in-game ads), screen-time ideas, age fit (4–9), accessibility, playing together | landing "For parents" section, expanded |
| FAQ | `/faq/` | Current 7 Q&As + more (devices, offline, saving, printing, narration voice) | landing FAQ |
| About | `/about/` | Who made it and why, how it's made (Blender + SVG, original art, narration) — a real person behind the site builds trust | README, plan docs |
| Contact | `/contact/` | Email, what to write about (bugs, ideas, parents' feedback), response expectation | footer `mailto:` |
| What's new | `/whats-new/` | Dated changelog, newest first; add an entry with every deploy | `git log` (library, favicon, SEO, sandcastle…) |
| Credits | `/credits/` | Rendered third-party notices + CC BY book credits | `THIRD-PARTY-NOTICES.md`, `library/CREDITS.md` |
| Privacy | `/privacy.html` | Unchanged, plus a link back into the nav | `privacy.html` |

**Screenshots:** extend `landing/capture_shots.py` to capture 2–4 shots per activity (the capture script already
exists and never ships).

**Quality bar per page:** a unique `<title>` and meta description, one `<h1>`, real paragraphs (not bullet dumps),
alt text on every image, internal links to related pages and to Play. No ads anywhere yet.

## 4. Phase C — get indexed (Search Console already set up; resubmit the new sitemap after deploying)

- [ ] Google Search Console (domain property): submit the generated `sitemap.xml`, request indexing for the new pages.
- [ ] Wait until Coverage shows the pages **indexed** (not "Discovered – currently not indexed").
- [ ] PageSpeed Insights on `/` and one activity page on mobile; fix anything red (image sizes: serve WebP/resized
      `card-*.png`; lazy-load below-the-fold images).
- [ ] Keep `/whats-new/` moving: a small real update every week or two (new outfit, book, printable) gives the
      "ongoing curation" signal.

## 5. Phase D — real visitors

- [ ] Share where parents of 4–9-year-olds are (parenting groups/forums, school/teacher contacts, friends), leading
      with the **free printable paper dolls** and the no-ads-in-game / no-accounts angle.
- [ ] An **itch.io** page for the game (free, HTML5) linking to lily.game.
- [ ] Optional parallel path: **Poki / CrazyGames** (HTML5 portals with their own players and ad revenue share).
      Check their current terms first: exclusivity, and what they allow for games aimed at young children.
- [ ] Watch Search Console clicks/impressions and simple visit counts (server access logs; no new tracking scripts —
      the privacy promise stays).

## 6. Phase E — reapply, then turn ads on

**Reapply when all are true:** Phase A and B are deployed · the pages show as indexed in Search Console · the domain is
~6–8+ weeks old · there are real daily visitors · `/whats-new/` has several dated entries.
Then tick "I confirm I have fixed the issues" → Request review. Reapplying earlier usually repeats the same result.

**After approval:**
- [ ] Create the ad units in AdSense, add them to the template for chosen pages (never inside `/play/`, never next to
      Play buttons), with the real `data-ad-slot` numbers.
- [ ] Consent: Google's certified CMP (Privacy & messaging → UMP) for EEA/UK/CH visitors.
- [ ] Keep child-directed treatment on (TFCD) — non-personalized ads only.

## 7. Open decisions

1. **Poki/CrazyGames in parallel?** It can bring players (and some revenue) much sooner than AdSense, but may require
   exclusivity or conflict with hosting ads on your own site. Decide before submitting anywhere.
2. **Printables format:** build-time PDF (best for parents, needs a headless-browser step in the build) or a print
   page that opens the existing `PrintDolls` sheet.
3. **A second language** (e.g. Hebrew) would double the real content, but only if you'll maintain it.
