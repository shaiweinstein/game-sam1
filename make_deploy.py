#!/usr/bin/env python3
"""Assemble the public `deploy/` bundle — MONETIZATION-AND-LICENSING.md §6.

Stdlib only. Layout produced:

    deploy/
      index.html               ← the home page  ┐ every site/pages/*.html rendered
      privacy.html, faq/, …    ← the website    ┘ through site/base.html
      robots.txt               ← crawler rules + Sitemap: pointer
      sitemap.xml              ← GENERATED: every page + /play/ (+ <lastmod>)
      THIRD-PARTY-NOTICES.md   (also rendered as /credits/)
      landing/                 ← landing.css, img/, printables/ (paper-doll
                                  PDFs from tools/make_printables.py) — never
                                  the capture script (.py files are banned)
      play/                    ← ONLY the game: index.html, css/, js/, lib/,
                                  beach3d/** (incl. assets/), library/**
                                  (StoryWeaver books — manifest.json resolved
                                  by the game as
                                  new URL('library/manifest.json', document.baseURI))

Hard guarantees (real asserts at the end — the script fails LOUDLY):
  * no spike*/, tests/, shots*/, .playwright-mcp/, .git* anywhere
  * no *.py at all (kills *_test.py, serve.py, capture scripts)
  * no *.md except THIRD-PARTY-NOTICES.md, lib/three/README.md and
    library/CREDITS.md (three.js's own vendoring notice and the CC BY
    storybook credits — licensing requires both)
  * no *-login.md, no "mixamo" in any path
  * deploy/index.html is the LANDING page, not the root game index
  * favicon.ico at deploy root is a real 3-image ICO (16/32/48 PNG payloads)
    and both shipped pages link /favicon.ico (no inline data-URI SVG icon)
  * every pages[].audio clip ships next to its book.json, >2KB, with the
    mp3/wav magic its extension claims; every non-empty-text page carries
    its pages[].audio stamp (full-narration coverage; empty-text pages
    legitimately have none); shipped audio count == source
    count (the forbidden() scan must never reject narration audio); the
    MiMo TTS credit line ships in library/CREDITS.md whenever any book
    has narration; book 14838 ships >= 20 clips (the trial tripwire)
Run from anywhere: paths resolve relative to this file.
"""
import html
import json
import re
import shutil
import struct
import sys
import xml.dom.minidom
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parent
DEPLOY = REPO / "deploy"

# The ONLY .md files allowed in the public bundle (everything else is a dev
# plan doc). lib/three/README.md carries the vendored three.js notice (§1
# requires it); library/CREDITS.md carries the CC BY 4.0 storybook credits.
# Matched by suffix so the check works repo- AND deploy-relative (i.e. both
# `library/CREDITS.md` and `play/library/CREDITS.md` pass `forbidden()`).
MD_ALLOWLIST_SUFFIXES = ("THIRD-PARTY-NOTICES.md", "lib/three/README.md",
                         "library/CREDITS.md")

EXCLUDED_DIR_PARTS = ("spike", "tests", "shots", ".playwright-mcp", ".git")
EXCLUDED_SUBSTRINGS = ("mixamo",)          # any path part, case-insensitive
EXCLUDED_NAMES = ("serve.py",)            # not needed on real hosts

# Verbatim narration credit required in library/CREDITS.md whenever any
# shipped book.json carries pages[].audio (tools/fetch_books.py audio
# writes the matching line on regeneration). Either exact line is accepted;
# while tools/voice/base.mp3 exists the voiceclone variant is required (the
# clips were synthesized anchored to that base sample).
TTS_CREDIT_LINE = ("Page narration audio generated with Xiaomi MiMo TTS "
                   "(mimo-v2.5-tts-voicedesign).")
TTS_CREDIT_LINE_CLONE = (
    "Page narration audio generated with Xiaomi MiMo TTS "
    "(base voice designed with mimo-v2.5-tts-voicedesign, narration "
    "synthesized with mimo-v2.5-tts-voiceclone).")
BASE_VOICE_SAMPLE = REPO / "tools" / "voice" / "base.mp3"
AUDIO_SUFFIXES = (".mp3", ".wav")

# Favicon / app-icon set shipped at the deploy ROOT. Googlebot-Image 404'd
# /favicon.ico while the pages carried only inline data-URI SVG icons (the
# SERP favicon program wants a real icon file at a crawlable URL).
ICON_FILES = ("favicon.ico", "icon.svg",
              "icon-16.png", "icon-32.png", "icon-48.png",
              "icon-180.png", "icon-192.png", "icon-512.png",
              "apple-touch-icon.png")

# Deterministic <lastmod> stamped into every sitemap.xml <url> at build time.
# A FIXED date — never date.today() — so the generated file is reproducible.
# A page can override it with "lastmod" in its <!--page {...}--> header.
SITEMAP_LASTMOD = "2026-09-26"

# ---- the static website (ADSENSE-REAPPLY-PLAN.md §3) --------------------------
# site/base.html is the one shared template; site/pages/*.html are content
# fragments, each starting with a <!--page {json}--> header (path, title,
# description, image, nav, crumbs, changefreq, priority) and an optional
# <!--head-->...<!--/head--> block. Fragments may use {{books}}, {{notices}},
# {{book_credits}}, {{printables}}, … which are generated below from the repo's
# own data, so the book list and credits can never drift from the library.
SITE = REPO / "site"
SITE_URL = "https://lily.game"
NAV = (("/activities/", "Activities", "activities"),
       ("/printables/", "Printables", "printables"),
       ("/library/", "Books", "library"),
       ("/parents/", "Parents", "parents"),
       ("/about/", "About", "about"))
ADSENSE_LOADER = ("pagead2.googlesyndication.com/pagead/js/adsbygoogle.js"
                  "?client=ca-pub-8606608049292845")
# Strings that must never ship: the old visible ad placeholders and
# unfilled slot ids made the site look unfinished to the AdSense review
# ("Low value content", 2026-09-26).
PLACEHOLDER_MARKERS = ("ad-hint", "YYYYYYYYYY", "Advertisement placeholder",
                       "nothing renders here", 'class="ad-slot')
PAGE_META = re.compile(r"\A<!--page\s*(\{.*?\})\s*-->\s*", re.S)
HEAD_BLOCK = re.compile(r"<!--head-->\n?(.*?)<!--/head-->\n?", re.S)


def forbidden(rel: Path) -> str | None:
    """Return a human-readable reason why rel must never ship, else None."""
    parts = rel.parts
    lowered = [p.lower() for p in parts]
    for part in lowered:
        if part.startswith(EXCLUDED_DIR_PARTS):
            return f"excluded directory: {'/'.join(parts)}"
        if "mixamo" in part:
            return f"mixamo material: {'/'.join(parts)}"
    name = rel.name
    if name.endswith(".py") or name.endswith(".pyc"):
        return f"python file: {rel}"
    if name in EXCLUDED_NAMES:
        return f"excluded name: {rel}"
    if name.endswith(".md") and not str(rel).endswith(MD_ALLOWLIST_SUFFIXES):
        return f"plan/doc markdown: {rel}"
    if name.endswith("-login.md"):
        return f"credentials file: {rel}"
    return None


def copy_tree(src: Path, dst: Path) -> int:
    n = 0
    for f in sorted(src.rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(REPO)
        reason = forbidden(rel)
        if reason:
            print(f"  skipping {rel}: {reason}")
            continue
        target = dst / f.relative_to(src)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(f, target)
        n += 1
    return n


def md_inline(text: str) -> str:
    """Escape one line of markdown and apply `code`, **bold**, [links](url) and bare-URL links."""
    out = []
    for i, chunk in enumerate(re.split(r"(`[^`]*`)", text)):
        if i % 2:
            out.append(f"<code>{html.escape(chunk[1:-1])}</code>")
            continue
        s = html.escape(chunk, quote=False)
        s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
        s = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2">\1</a>', s)
        s = re.sub(r'(?<!href=")(?<![">/])(https?://[^\s<)]+[^\s<).,;:])', r'<a href="\1">\1</a>', s)
        s = re.sub(r"(?<![\w/.])(www\.[a-z0-9.-]+\.[a-z]{2,})(?![\w/])", r'<a href="https://\1">\1</a>', s)
        out.append(s)
    return "".join(out)


def md_to_html(text: str) -> str:
    """Tiny stdlib markdown renderer for the two notice files (headings, lists, blockquotes, rules,
    paragraphs). The file's own '# title' line is dropped and levels shift down one (## -> h2)."""
    blocks, para, items, quote = [], [], [], []

    def flush():
        if para:
            blocks.append("<p>" + md_inline(" ".join(para)) + "</p>")
            para.clear()
        if items:
            blocks.append("<ul>" + "".join(f"<li>{md_inline(' '.join(i))}</li>" for i in items) + "</ul>")
            items.clear()
        if quote:
            blocks.append("<blockquote><p>" + md_inline(" ".join(quote)) + "</p></blockquote>")
            quote.clear()

    for line in text.splitlines():
        stripped = line.strip()
        heading = re.match(r"(#{1,4})\s+(.*)", stripped)
        if heading:
            flush()
            level = len(heading.group(1))
            if level > 1:
                slug = re.sub(r"[^a-z0-9]+", "-", heading.group(2).lower()).strip("-")
                blocks.append(f'<h{level} id="{slug}">{md_inline(heading.group(2))}</h{level}>')
        elif stripped in ("---", "***"):
            flush()
            blocks.append("<hr>")
        elif not stripped:
            flush()
        elif stripped.startswith("> "):
            if para or items:
                flush()
            quote.append(stripped[2:])
        elif re.match(r"[-*] ", stripped):
            if para or quote:
                flush()
            items.append([stripped[2:]])
        elif items and line.startswith("  "):
            items[-1].append(stripped)            # continuation of the last list item
        else:
            if items or quote:
                flush()
            para.append(stripped)
    flush()
    return "\n".join(blocks)


def load_pages() -> list[dict]:
    pages = []
    for f in sorted((SITE / "pages").glob("*.html")):
        text = f.read_text(encoding="utf-8")
        m = PAGE_META.match(text)
        assert m, f"site/pages/{f.name}: missing <!--page {{json}}--> header"
        meta = json.loads(m.group(1))
        body = text[m.end():]
        head = ""
        hm = HEAD_BLOCK.search(body)
        if hm:
            head, body = hm.group(1).rstrip(), body[:hm.start()] + body[hm.end():]
        for key in ("path", "title", "description", "image"):
            assert meta.get(key), f"site/pages/{f.name}: page header lacks {key!r}"
        assert meta["path"].startswith("/"), f"site/pages/{f.name}: path must start with /"
        meta.update(source=f.name, head_extra=head, body=body.rstrip())
        pages.append(meta)
    paths = [p["path"] for p in pages]
    assert len(paths) == len(set(paths)), f"duplicate page paths: {paths}"
    return pages


def page_file(path: str) -> Path:
    """URL path -> file inside deploy/ ('/' -> index.html, '/faq/' -> faq/index.html)."""
    rel = path.lstrip("/")
    return DEPLOY / (rel + "index.html" if rel == "" or rel.endswith("/") else rel)


def books_html() -> str:
    manifest = json.loads((REPO / "library" / "manifest.json").read_text(encoding="utf-8"))
    blurbs = json.loads((SITE / "data" / "books.json").read_text(encoding="utf-8"))
    out = ['    <ol class="book-list">']
    for e in manifest["books"]:
        book = json.loads((REPO / "library" / e["book"]).read_text(encoding="utf-8"))
        blurb = blurbs.get(str(e["id"]))
        assert blurb, f"site/data/books.json has no blurb for book {e['id']} ({e['title']})"
        who = ", ".join(book["authors"])
        art = ", ".join(book.get("illustrators") or [])
        translator = ""
        # StoryWeaver title pages carry the real credit line. For translated
        # books book.json lists the TRANSLATOR under "authors", so prefer the
        # title page ("Author: X Illustrator: Y Translator: Z") when present.
        credit = re.search(r"Authors?: (.+?) Illustrators?: (.+?)(?: Translators?: (.+))?$",
                           " ".join((book["pages"][0].get("text") or "").split()))
        if credit:
            who, art, translator = credit.group(1), credit.group(2), credit.group(3) or ""
        byline = f"by {who}" + (f", illustrated by {art}" if art and art != who else "") \
            + (f", translated by {translator}" if translator else "")
        lic = "Public domain" if book["license"] == "Public Domain" else book["license"]
        out.append(f"""      <li class="book">
        <img src="/play/library/{html.escape(e['thumb'])}" alt="Cover of {html.escape(e['title'])}" loading="lazy" width="160" height="160">
        <div>
          <h2>{html.escape(e['title'])}</h2>
          <p class="book-meta">{html.escape(byline)} · Level {e['level']} · {e['pageCount']} pages · {book['publishedYear']}</p>
          <p>{html.escape(blurb)}</p>
          <p class="book-source">{html.escape(book.get('publisher') or 'Project Gutenberg')} · {lic} · <a href="{html.escape(e['sourceUrl'])}">original source</a></p>
        </div>
      </li>""")
    out.append("    </ol>")
    assert len(manifest["books"]) == len([k for k in blurbs if not k.startswith("_")]), \
        "site/data/books.json blurbs don't match the library manifest"
    return "\n".join(out)


def printables_fragments() -> dict:
    data = json.loads((REPO / "landing" / "printables" / "printables.json").read_text(encoding="utf-8"))
    cards = ['    <ul class="printables">']
    for s in data["sheets"]:
        kb = round(s["bytes"] / 1024)
        cards.append(f"""      <li class="printable">
        <img src="/landing/printables/{s['preview']}" alt="Paper doll of Lily with {html.escape(s['hairName'])} hair" loading="lazy" width="320" height="387">
        <p class="printable-name">{html.escape(s['hairName'])}</p>
        <a class="download-button" href="/landing/printables/{s['pdf']}" download>⬇ Download PDF <span>({kb} KB)</span></a>
      </li>""")
    cards.append("    </ul>")
    names = {3: "tops", 4: "bottoms", 5: "shoes and swimsuits"}
    previews = "\n".join(
        f'      <figure><img src="/landing/printables/{p}" alt="Printable sheet page with {names.get(int(re.search(r"(\d+)", p).group(1)), "clothes")}, each piece with grey fold tabs" loading="lazy" width="640" height="828"></figure>'
        for p in data["wardrobePreviews"])
    first = data["sheets"][0]
    return {"printables": "\n".join(cards), "wardrobe_previews": previews,
            "printables_pieces": str(first["pieces"]), "printables_pages": str(first["pages"]),
            "printables_paper": html.escape(data["paper"])}


def render_site(pages: list[dict]) -> None:
    base = (SITE / "base.html").read_text(encoding="utf-8")
    generated = {
        "books": books_html(),
        "notices": md_to_html((REPO / "THIRD-PARTY-NOTICES.md").read_text(encoding="utf-8")),
        "book_credits": md_to_html((REPO / "library" / "CREDITS.md").read_text(encoding="utf-8")),
        **printables_fragments(),
    }
    for page in pages:
        body = page["body"]
        for key, value in generated.items():
            body = body.replace("{{" + key + "}}", value)
        nav = "\n".join(
            f'          <li><a href="{href}"' + (' aria-current="page"' if page.get("nav") == key else "")
            + f">{label}</a></li>" for href, label, key in NAV)
        nav += '\n          <li><a class="nav-play" href="/play/">▶ Play</a></li>'
        crumbs = ""
        if page.get("crumbs"):
            here = page.get("crumb") or page["title"].split(" — ")[0].split(":")[0]
            trail = "".join(f'<li><a href="{href}">{html.escape(label)}</a></li>' for label, href in page["crumbs"])
            crumbs = (f'  <nav class="crumbs wrap" aria-label="Breadcrumb"><ol><li><a href="/">Home</a></li>'
                      f'{trail}<li aria-current="page">{html.escape(here)}</li></ol></nav>')
        values = {"title": html.escape(page["title"]), "description": html.escape(page["description"]),
                  "og_title": html.escape(page.get("og_title") or page["title"]),
                  "path": page["path"], "image": page["image"], "head_extra": page["head_extra"],
                  "nav": nav, "crumbs": crumbs, "body": body}
        out = base
        for key, value in values.items():
            out = out.replace("{{" + key + "}}", value)
        assert "{{" not in out, f"{page['source']}: unfilled placeholder {re.findall(r'{{[a-z_]+}}', out)}"
        target = page_file(page["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(out, encoding="utf-8")


def sitemap_xml(pages: list[dict]) -> str:
    urls = [(p["path"], p.get("lastmod", SITEMAP_LASTMOD), p.get("changefreq", "monthly"),
             p.get("priority", "0.5")) for p in pages]
    urls.append(("/play/", SITEMAP_LASTMOD, "monthly", "0.9"))
    urls.sort(key=lambda u: (u[0] != "/", u[0]))
    rows = "\n".join(f"  <url><loc>{SITE_URL}{loc}</loc><lastmod>{mod}</lastmod>"
                     f"<changefreq>{freq}</changefreq><priority>{prio}</priority></url>"
                     for loc, mod, freq, prio in urls)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + rows + "\n</urlset>\n")


class LinkCollector(HTMLParser):
    """Collects href/src values and <h1> count from one shipped page."""
    def __init__(self):
        super().__init__()
        self.links, self.h1 = [], 0

    def handle_starttag(self, tag, attrs):
        if tag == "h1":
            self.h1 += 1
        for name, value in attrs:
            if name in ("href", "src") and value:
                self.links.append(value)


def main() -> int:
    # ---- sanity of the sources before touching anything ------------------
    for must in ("site/base.html", "site/pages/index.html", "site/data/books.json",
                 "THIRD-PARTY-NOTICES.md", "robots.txt", "ads.txt",
                 "index.html", "css", "js", "lib", "beach3d",
                 "landing/img/hero-beach.png", "landing/printables/printables.json"):
        src = REPO / must
        assert src.exists(), f"missing source {must} — nothing to deploy"
    pages = load_pages()

    # ---- assemble ---------------------------------------------------------
    if DEPLOY.exists():
        shutil.rmtree(DEPLOY)
    DEPLOY.mkdir()

    # 1) the website: every site/pages/*.html rendered through site/base.html
    #    (index.html = the home page, /privacy.html, /faq/index.html, …)
    render_site(pages)

    # 2) standalone public files + crawler files (robots/ads.txt once lived
    #    only on the server and died to `rsync --delete` — they are now
    #    first-class repo sources shipped through this same allowlist).
    #    THIRD-PARTY-NOTICES.md still ships verbatim next to its rendered
    #    /credits/ page.
    for name in ("THIRD-PARTY-NOTICES.md", "robots.txt", "ads.txt"):
        assert forbidden(Path(name)) is None, f"forbidden public file: {name}"
        shutil.copy2(REPO / name, DEPLOY / name)
    # sitemap.xml is GENERATED from the page list (+ /play/), with a
    # deterministic <lastmod> in every <url> (protocol order inside <url>:
    # loc, lastmod, changefreq, priority).
    (DEPLOY / "sitemap.xml").write_text(sitemap_xml(pages), encoding="utf-8")

    # 2b) favicon + app icons at the deploy ROOT — /favicon.ico must exist
    #     as a REAL file (Googlebot-Image 404'd it; inline data-URI SVG icons
    #     don't qualify for Google's SERP favicon program)
    for name in ICON_FILES:
        assert (REPO / name).is_file(), f"missing icon source: {name}"
        assert forbidden(Path(name)) is None, f"forbidden public file: {name}"
        shutil.copy2(REPO / name, DEPLOY / name)

    # 3) landing/ assets: landing.css (+ any top-level landing js) and the
    #    css/js/img subdirs — copy_tree never allows .py
    n_landing = 0
    for f in sorted(list((REPO / "landing").glob("*.css")) +
                   list((REPO / "landing").glob("*.js"))):
        assert forbidden(f.relative_to(REPO)) is None, "forbidden landing asset"
        (DEPLOY / "landing").mkdir(exist_ok=True)
        shutil.copy2(f, DEPLOY / "landing" / f.name)
        n_landing += 1
    for sub in ("css", "js", "img", "printables"):
        d = REPO / "landing" / sub
        if d.is_dir():
            n_landing += copy_tree(d, DEPLOY / "landing" / sub)
    assert n_landing >= 1 + 7, "landing assets incomplete"
    assert (DEPLOY / "landing" / "landing.css").exists(), "landing.css missing"
    assert len(list((DEPLOY / "landing" / "img").glob("*.png"))) == 7, \
        "landing/img did not ship all seven screenshots"

    # 4) play/ = the game only
    (DEPLOY / "play").mkdir()
    shutil.copy2(REPO / "index.html", DEPLOY / "play" / "index.html")
    n_play = 1  # the game's index itself
    for sub in ("css", "js", "lib", "beach3d", "library"):
        n_play += copy_tree(REPO / sub, DEPLOY / "play" / sub)

    # ---- verify the shipped tree with real assertions ---------------------
    files = [f for f in sorted(DEPLOY.rglob("*")) if f.is_file()]
    for f in files:
        rel = f.relative_to(DEPLOY)
        reason = forbidden(rel)
        assert reason is None, f"BUNDLED A FORBIDDEN FILE: {rel}: {reason}"
        # belt & braces: dir-part and mixamo scans again on the SHIPPED tree
        low = [p.lower() for p in rel.parts]
        assert not any(p.startswith(("spike", "tests", "shots", ".git"))
                       or p == ".playwright-mcp" or "mixamo" in p for p in low), \
            f"excluded directory leaked: {rel}"
    # deploy/index.html must be the home page, not the game's old index
    root_index = (REPO / "index.html").read_text(encoding="utf-8")
    shipped = (DEPLOY / "index.html").read_text(encoding="utf-8")
    assert 'id="play-cta" class="play-button" href="/play/"' in shipped \
        and shipped != root_index, "deploy/index.html is not the home page"
    assert (DEPLOY / "play" / "index.html").read_text(encoding="utf-8") \
        == root_index, "play/index.html is not the game's index"
    # favicon.ico is a REAL 3-image ICO (16/32/48 PNG payloads) and both
    # shipped pages link it from the site root (absolute /favicon.ico so the
    # game under /play/ resolves it too) — no inline data-URI SVG icon left
    for name in ICON_FILES:
        assert (DEPLOY / name).is_file(), f"icon missing at deploy root: {name}"
    ico = (DEPLOY / "favicon.ico").read_bytes()
    assert ico[:4] == b"\x00\x00\x01\x00", "favicon.ico: bad ICONDIR header"
    (ico_count,) = struct.unpack_from("<H", ico, 4)
    assert ico_count == 3, f"favicon.ico: expected 3 images, found {ico_count}"
    for i, want in enumerate((16, 32, 48)):
        w, h, _cc, _res, _planes, _bpp, size, off = struct.unpack_from(
            "<BBBBHHII", ico, 6 + 16 * i)
        assert (w, h) == (want, want), \
            f"favicon.ico entry {i}: {w}x{h} != {want}x{want}"
        assert ico[off:off + 4] == b"\x89PNG", \
            f"favicon.ico entry {i}: payload is not a PNG"
        assert off + size <= len(ico), f"favicon.ico entry {i}: truncated payload"
        iw, ih = struct.unpack_from(">II", ico, off + 16)  # IHDR dims
        assert (iw, ih) == (want, want), \
            f"favicon.ico entry {i}: PNG is {iw}x{ih}, expected {want}x{want}"
    site_files = [page_file(p["path"]) for p in pages]
    for f in site_files + [DEPLOY / "play" / "index.html"]:
        text = f.read_text(encoding="utf-8")
        assert 'href="/favicon.ico"' in text, f"{f.relative_to(DEPLOY)} lacks the /favicon.ico link"
        assert "data:image/svg+xml" not in text, \
            f"{f.relative_to(DEPLOY)} still carries an inline data-URI SVG icon"
    # the website pages: AdSense site code on every information page but
    # never in the game; no placeholder ad boxes; one <h1>, a unique title and
    # description each; and every internal link/src resolves to a shipped file
    titles, descriptions = set(), set()
    for f in site_files:
        rel = f.relative_to(DEPLOY)
        text = f.read_text(encoding="utf-8")
        assert text.count(ADSENSE_LOADER) == 1, f"{rel}: AdSense site code missing or duplicated"
        for marker in PLACEHOLDER_MARKERS:
            assert marker not in text, f"{rel}: ad placeholder leaked ({marker!r})"
        title = re.search(r"<title>(.*?)</title>", text).group(1)
        desc = re.search(r'<meta name="description" content="(.*?)">', text).group(1)
        assert title not in titles, f"{rel}: duplicate <title> {title!r}"
        assert desc not in descriptions, f"{rel}: duplicate meta description"
        titles.add(title)
        descriptions.add(desc)
        parser = LinkCollector()
        parser.feed(text)
        assert parser.h1 == 1, f"{rel}: expected exactly one <h1>, found {parser.h1}"
        for link in parser.links:
            url = urlparse(link)
            if url.scheme in ("mailto", "tel") or link.startswith("#"):
                continue
            if url.scheme in ("http", "https") and url.netloc != "lily.game":
                continue                          # external link (Google, StoryWeaver, licences, …)
            assert url.scheme or link.startswith("/"), \
                f"{rel}: relative link {link!r} (use /paths — pages live at different depths)"
            target = DEPLOY / (url.path or "/").lstrip("/")
            if url.path.endswith("/"):
                target = target / "index.html"
            assert target.is_file(), f"{rel}: broken link {link}"
    play_html = (DEPLOY / "play" / "index.html").read_text(encoding="utf-8")
    assert "adsbygoogle" not in play_html and "googlesyndication" not in play_html, \
        "the game page must never carry ad code"
    # printables: one PDF + preview per hairstyle, as printables.json lists
    printables = json.loads((REPO / "landing" / "printables" / "printables.json").read_text(encoding="utf-8"))
    for sheet in printables["sheets"]:
        pdf = (DEPLOY / "landing" / "printables" / sheet["pdf"]).read_bytes()
        assert pdf[:5] == b"%PDF-" and len(pdf) == sheet["bytes"], f"printable {sheet['pdf']} missing or stale"
        assert (DEPLOY / "landing" / "printables" / sheet["preview"]).is_file(), f"missing {sheet['preview']}"
    assert len(printables["sheets"]) == 6, f"expected 6 hairstyle PDFs, found {len(printables['sheets'])}"
    # the seven card images made it
    assert len(list((DEPLOY / "landing" / "img").glob("*.png"))) == 7, \
        "landing/img did not ship all seven screenshots"
    # crawler files shipped and are well-formed (rsync --delete lost the
    # server-only originals once; the bundle must never come out without them)
    robots = (DEPLOY / "robots.txt").read_text(encoding="utf-8")
    assert "\r" not in robots, "robots.txt must be LF-only"
    assert "User-agent: *" in robots and "Allow: /" in robots \
        and "Sitemap: https://lily.game/sitemap.xml" in robots, \
        "robots.txt incomplete"
    dom = xml.dom.minidom.parse(str(DEPLOY / "sitemap.xml"))
    locs = [t.firstChild.data for t in dom.getElementsByTagName("loc")]
    want = {SITE_URL + p["path"] for p in pages} | {SITE_URL + "/play/"}
    assert set(locs) == want and len(locs) == len(want), \
        f"sitemap.xml locs wrong: {sorted(set(locs) ^ want)}"
    for loc in locs:
        path = loc[len(SITE_URL):]
        target = DEPLOY / path.lstrip("/")
        assert (target / "index.html" if path.endswith("/") else target).is_file(), \
            f"sitemap lists {loc} but no file ships for it"
    lastmods = [t.firstChild.data for t in dom.getElementsByTagName("lastmod")]
    assert len(lastmods) == len(locs) and all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", m) for m in lastmods), \
        f"sitemap.xml lastmod wrong: {lastmods}"
    # ads.txt must declare our AdSense publisher — without it Google shows
    # "Not found" and serves no ads (it also died to rsync --delete once)
    ads = (DEPLOY / "ads.txt").read_text(encoding="utf-8")
    assert "pub-8606608049292845" in ads and "DIRECT" in ads \
        and "\r" not in ads, "ads.txt missing or malformed"
    # library/ (StoryWeaver CC BY 4.0 books + public-domain Beatrix Potter
    # titles) must ship INSIDE the game bundle:
    # play/index.html resolves `new URL('library/manifest.json',
    # document.baseURI)` — without this tree the books 404 in production.
    lib_root = DEPLOY / "play" / "library"
    manifest = json.loads(
        (lib_root / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["count"] == 28, \
        f"library manifest count wrong: {manifest['count']}"
    entries = manifest["books"]
    assert [e["shelfOrder"] for e in entries] == list(range(1, 29)), \
        "library books not sorted contiguous shelfOrder 1..28"
    for e in entries:
        for key in ("thumb", "book"):
            p = lib_root / e[key]
            assert p.is_file(), f"manifest {key} missing: {e[key]}"
    any_audio = False
    for book_json in sorted((lib_root / "books").glob("*/book.json")):
        book = json.loads(book_json.read_text(encoding="utf-8"))
        # license-aware rule: CC BY books must name CC BY, Public Domain books
        # must name "public domain"; EVERY book's attribution carries its year.
        license_name = str(book["license"])
        attribution = str(book["attribution"])
        if license_name.startswith("CC BY"):
            assert "CC BY" in attribution, \
                f"{book_json.parent.name}: attribution lacks CC BY"
        else:
            assert license_name == "Public Domain", \
                f"{book_json.parent.name}: wrong license {book['license']!r}"
            assert "public domain" in attribution.lower(), \
                f"{book_json.parent.name}: attribution lacks 'public domain'"
        assert str(book["publishedYear"]) in attribution, \
            f"{book_json.parent.name}: attribution lacks the year"
        assert book["pageCount"] == len(book["pages"]), \
            f"{book_json.parent.name}: pageCount {book['pageCount']} " \
            f"!= {len(book['pages'])} pages"
        for page in book["pages"]:
            img = page.get("image", "")
            if img:
                assert (book_json.parent / img).is_file(), \
                    f"{book_json.parent.name}: page image missing: {img}"
            # full-narration coverage: every non-empty-text page must carry
            # its pages[].audio stamp (empty-text pages legitimately have
            # none); the stamped clip itself is validated just below.
            text = (page.get("text") or "").strip()
            audio = page.get("audio") or ""
            assert audio or not text, \
                f"{book_json.parent.name}: text page {page.get('n')} " \
                f"lacks pages[].audio"
            if not audio:
                continue
            any_audio = True
            # narration clip (pages[].audio, stamped by tools/fetch_books.py
            # audio): must ship beside its book.json, be >2KB and carry the
            # magic its extension claims (mp3: ID3 or 0xFFEx frame sync;
            # wav: RIFF/WAVE).
            clip = book_json.parent / audio
            assert clip.is_file(), \
                f"{book_json.parent.name}: page audio missing: {audio}"
            blob = clip.read_bytes()
            assert len(blob) > 2048, \
                f"{book_json.parent.name}: audio <=2KB: {audio} ({len(blob)} bytes)"
            ext = clip.suffix.lower()
            if ext == ".mp3":
                assert blob[:3] == b"ID3" \
                    or (blob[0] == 0xFF and (blob[1] & 0xE0) == 0xE0), \
                    f"{book_json.parent.name}: not mp3 magic (ID3 or FF sync): {audio}"
            elif ext == ".wav":
                assert blob[:4] == b"RIFF" and blob[8:12] == b"WAVE", \
                    f"{book_json.parent.name}: not wav magic (RIFF/WAVE): {audio}"
            else:
                raise AssertionError(
                    f"{book_json.parent.name}: unexpected audio extension: {audio}")
    credits = lib_root / "CREDITS.md"
    assert credits.is_file() and "CC BY" in credits.read_text(encoding="utf-8"), \
        "library/CREDITS.md missing or lacks CC BY"
    book_dirs = [d for d in sorted((lib_root / "books").iterdir()) if d.is_dir()]
    assert len(book_dirs) == 28, \
        f"shipped book dirs wrong: {len(book_dirs)}"
    # narration audio batch rules: the forbidden() scan must NOT reject
    # audio (verified explicitly for both spellings and both extensions),
    # the shipped mp3/wav count must equal the SOURCE count (nothing was
    # silently skipped on the way in), any narration must come with its
    # MiMo TTS credit, and the book 14838 trial must never vanish.
    for probe in ("library/books/14838/audio/page-01.mp3",
                  "play/library/books/14838/audio/page-01.mp3",
                  "library/books/14838/audio/page-01.wav"):
        assert forbidden(Path(probe)) is None, \
            f"forbidden() must NOT reject narration audio: {probe}"
    src_audio = sum(1 for f in (REPO / "library").rglob("*")
                    if f.is_file() and f.suffix.lower() in AUDIO_SUFFIXES)
    n_mp3 = sum(1 for f in lib_root.rglob("*")
                if f.is_file() and f.suffix.lower() == ".mp3")
    n_wav = sum(1 for f in lib_root.rglob("*")
                if f.is_file() and f.suffix.lower() == ".wav")
    assert n_mp3 + n_wav == src_audio, \
        f"shipped audio count {n_mp3 + n_wav} != source count {src_audio}"
    if any_audio:
        credit_lines = [line.strip() for line in
                        credits.read_text(encoding="utf-8").splitlines()]
        has_design = TTS_CREDIT_LINE in credit_lines
        has_clone = TTS_CREDIT_LINE_CLONE in credit_lines
        if BASE_VOICE_SAMPLE.is_file():
            assert has_clone, \
                "library/CREDITS.md lacks the voiceclone MiMo TTS narration " \
                "credit line (tools/voice/base.mp3 exists)"
        else:
            assert has_design or has_clone, \
                "library/CREDITS.md lacks the exact MiMo TTS narration credit line"
    n_14838 = sum(1 for f in (lib_root / "books" / "14838").glob("audio/*")
                  if f.is_file() and f.suffix.lower() in AUDIO_SUFFIXES)
    assert n_14838 >= 20, \
        f"book 14838 ships only {n_14838} narration clips — the trial vanished"

    # ---- summary -----------------------------------------------------------
    total = sum(f.stat().st_size for f in files)
    top = sorted(files, key=lambda f: f.stat().st_size, reverse=True)[:10]
    lib_files = [f for f in files if f.is_relative_to(DEPLOY / "play" / "library")]
    lib_bytes = sum(f.stat().st_size for f in lib_files)
    n_book_files = sum(1 for f in lib_files
                       if f.is_relative_to(DEPLOY / "play" / "library" / "books"))
    print(f"\ndeploy/ — {len(files)} files, {total / 1024 / 1024:.2f} MiB")
    print(f"library/: {lib_bytes / 1024 / 1024:.2f} MiB, "
          f"{n_book_files} book files, "
          f"{n_mp3} mp3 + {n_wav} wav narration clips ({n_14838} in book 14838, "
          f"{src_audio} on disk), "
          f"deploy total {total / 1024 / 1024:.2f} MiB")
    print("largest files:")
    for f in top:
        print(f"  {f.stat().st_size / 1024:9.1f} KiB  {f.relative_to(DEPLOY)}")
    print("\nSAFE: no excluded patterns present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
