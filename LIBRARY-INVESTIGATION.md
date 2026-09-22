# 📚 Library / Reading-Nook Investigation — Free Kids Books + Monetization

**Date:** 2026-09-20 · **Status:** investigation only, no code written.
**Question from the daughter:** can the game have a Library place (like the beach, later a
park) where she can *read books* — using free books from an API — and can we *still run
AdSense ads* while doing it?

**Short answers: yes, yes, and yes** — with one architecture choice (curated on our own
server, not live third-party embedding) that keeps every policy, license, and our
zero-external-requests/zero-cookie rules intact.

---

## 1. Where free kids books come from (verified today)

| Source | Size | License | API / access | Commercial use (ads)? | Verdict |
|---|---|---|---|---|---|
| **StoryWeaver** (Pratham Books) | ~71k stories, 183 languages, leveled 1–4, richly illustrated | **CC BY 4.0** on *all* stories & images — explicitly "even commercially" with attribution | ✅ verified today: public `GET /api/v1/stories/:id` JSON (metadata, no auth); full catalog via sitemap (1,657 English story URLs w/ ids); official "data exchange" API `/api/v0/story/:uuid` (+pdf/epub/images) exists but needs a **free token** (apply via dev@storyweaver.org.in) | ✅ with attribution | ⭐ **Primary choice** — purpose-built open children's library |
| **Bloom Library** (SIL Global) | thousands of early-reader books, many languages | Content mostly CC BY (per-book check); platform code **MIT** | ✅ `bloom-player`: an MIT-licensed, **iframe-based book player** made for embedding (`bloomplayer.htm?url=<book>`); OPDS catalog documented; BloomPUB books = zipped HTML we can host | ✅ | ⭐ **Runner-up + free player tech** — we can vendor their MIT player + self-host books |
| **Project Gutenberg** via **Gutendex** | 70k+ public-domain books incl. classic children's lit | US public domain (text; check scans' artwork date) | REST JSON `https://gutendex.com/books?search=…` (host unreachable from this sandbox — worked previously from other nets; verify from VPS) | ✅ (PD) | Good for *older* readers (chapter books), weak for picture books |
| **Standard Ebooks** | curated public-domain classics | **entire ebook file dedicated to public domain via CC0** (text, markup, cover art) | GitHub repo + site downloads (epub/hf) | ✅ (none needed) | Best-quality PD classics when she outgrows picture books |
| Internet Archive / Open Library "borrow" | millions | ⚠️ scanned-book lending = post-*Hachette v. IA* (2023) legal grey; DRM, library-card required | metadata API open; *reading* is not embeddable | — | ❌ **avoid** in-app; parents can use it themselves |
| Epic!, Vooks, StoryBots, etc. | big | commercial subscriptions, no redistribution | paid/partner-only | — | ❌ not usable |
| Storyline Online / YouTube read-alouds | video | videos are CC BY-**NC**-ND on StoryWeaver's side; YouTube embeds set cookies | iframe embed | ⚠️ NC/ND forbids; cookies break "0 cookie" rule | ❌ skip (keep the no-cookie promise) |

Also noted: **BookDash / Pratham / Litsani / IBBY iReads** collections — all CC BY
picture-book sources, same reuse rules as StoryWeaver. Precedent: an app called
"BookCloud" ships today built entirely on StoryWeaver CC BY + public-domain books.

## 2. Recommended integration: "curated shelf on our own server"

Don't call third-party APIs at game runtime. Instead:

```
[one-time build tool]                      [player]
pick books (sitemap/API)      →   download web-PDF/EPUB/BloomPUB
extract pages (img + text)    →   compress (webp + text overlay)
attach required attribution   →   deploy/library/books/<id>/*.json|webp
                                     ↑ fetched same-origin, on first open,
                                       cached by browser (Cache API)
```

- **In-game UX:** a Library room scene (same pattern as the beach: new scene +
  portal), walk Lily to a bookshelf → shelf UI (cover grid, "Level 1/2" reading
  bands) → page-flip reader overlay (prev/next, big text, parent-tappable read-to-me
  later via on-device TTS — zero network).
- **Zero-external-requests preserved:** books served by *our* nginx, same origin as
  the game. No CORS problems (a real blocker for direct browser→third-party fetches),
  no third-party cookies, works after first load even mostly-offline.
- **Budget:** current whole bundle is only **12 MB**. Books lazy-load ~300–800 KB each
  web-optimized (vs 1–5 MB source PDFs); a starter shelf of 12–20 curated titles adds
  ~0 MB to first load.
- **Attribution (CC BY requirement):** every book's own copyright/credits page ships
  with it + a "About these books" panel in the reader listing titles/authors/
  illustrators/publisher/funder + "CC BY 4.0" links, in StoryWeaver's prescribed
  format; repo gets a `LICENSE-BOOKS.md`. This is also a goodwill feature for
  Pratham/SIL (their mission is exactly this reuse).
- **Runtime-API option exists too** (StoryWeaver's v0 data-exchange token + a thin
  nginx proxy for CORS/robots) — worth requesting the free token anyway, but the
  curated shelf is sturdier for a kids' product: no surprise content, no downtime.

## 3. Can we still monetize? ✅ Yes — policy-by-policy

1. **Copyright ("content must be yours or licensed")** — public domain needs no
   license; CC BY 4.0 *explicitly permits commercial use* with attribution. We'd hold
   rights for every byte shipped. (Rule we adopt: **never** CC-NC or CC-ND content,
   because site ads make usage commercial and page-ripping is a derivative.)
2. **"Insufficient original content"** — this policy targets *copy sites* that
   republish others' content with no added value. Our site is an **original game**
   (our code, our art, our world); a reading nook with openly-licensed books + our own
   reader/scene/leveling UI is "additional functionality", which the policy names as
   the cure. Ads stay on the landing page, which is 100% original.
3. **Framing policy** ("ads must not be placed on pages that frame someone else's
   site") — moot by design: books are served from our own origin (no third-party
   iframes), and the game page carries **zero ads** anyway. Ads exist only on
   lily.game landing.
4. **Child-directed handling** — already solved: landing has TFAT `limited ads`;
   game/book pages have no ad code at all; no Analytics/cookies. Books are served
   by our nginx — no data flows to any third party from a child's device.
5. **AdSense review timing** — the Library feature is genuinely new, substantive
   content; adding it *before* the account review finishes helps the
   "value to users" case.

**Bottom line: yes — ads on the landing page + openly-licensed books in-game are
compatible, provided (a) we stick to PD/CC BY (never NC/ND), (b) attribution ships
with every book, (c) no third-party embeds/cookies in the reading experience.**

## 4. Risks & watch-outs

- **Per-book license check still required** even inside CC-BY platforms (translations
  occasionally carry different credits/funders; Bloom books vary CC BY vs CC BY-SA —
  SA only matters if we modify the books; displaying as-is is fine).
- **PD illustration dates:** US works published ≤1929 are PD (pre-1930 bar as of 2026);
  prefer platform-native CC art over random old scans.
- **StoryWeaver scraping etiquette:** if we batch-download, be gentle (sequential,
  with delays, cache forever); or use their free data-exchange token which is made
  for this.
- **Content moderation:** platform content is professionally curated, but a kids'
  product should ship only a human-reviewed curated list — the daughter gets veto
  power over the starter shelf.
- **Future "read-to-me" TTS:** use on-device `speechSynthesis` (no network, no
  cookies) — never a cloud TTS API, to keep the promise.

## 5. Suggested next steps (when we build it)

1. Pick ~12 starter titles with the daughter (levels 1–2, StoryWeaver English +
   a few Bloom); I shortlist by reads/likes + pre-review appropriateness.
2. Prototype the ingest script (download → pages.json + webp → attribution block) —
   small, offline, testable like the sandcastle pipeline.
3. Build the Library room scene reusing the beach/portal architecture, then the
   reader overlay.
4. Add `LICENSE-BOOKS.md` + per-book credits; email StoryWeaver for the data-exchange
   token (free) if we ever want live browse.
