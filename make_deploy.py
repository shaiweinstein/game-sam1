#!/usr/bin/env python3
"""Assemble the public `deploy/` bundle — MONETIZATION-AND-LICENSING.md §6.

Stdlib only. Layout produced:

    deploy/
      index.html               ← landing.html (Play link rewritten to play/)
      privacy.html
      robots.txt               ← crawler rules + Sitemap: pointer
      sitemap.xml              ← / , /play/ , /privacy.html (+ <lastmod>)
      THIRD-PARTY-NOTICES.md
      landing/                 ← css/, js/ (if present), img/ — never the
                                  capture script (.py files are banned outright)
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
  * every pages[].audio clip ships next to its book.json, >2KB, with the
    mp3/wav magic its extension claims; every non-empty-text page carries
    its pages[].audio stamp (full-narration coverage; empty-text pages
    legitimately have none); shipped audio count == source
    count (the forbidden() scan must never reject narration audio); the
    MiMo TTS credit line ships in library/CREDITS.md whenever any book
    has narration; book 14838 ships >= 20 clips (the trial tripwire)
Run from anywhere: paths resolve relative to this file.
"""
import json
import re
import shutil
import sys
import xml.dom.minidom
from pathlib import Path

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

# Deterministic <lastmod> stamped into every sitemap.xml <url> at build time.
# A FIXED date — never date.today() — so the generated file is reproducible.
SITEMAP_LASTMOD = "2026-09-23"


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


def main() -> int:
    # ---- sanity of the sources before touching anything ------------------
    for must in ("landing.html", "privacy.html", "THIRD-PARTY-NOTICES.md",
                 "robots.txt", "sitemap.xml", "ads.txt",
                 "index.html", "css", "js", "lib", "beach3d",
                 "landing/img/hero-beach.png"):
        src = REPO / must
        assert src.exists(), f"missing source {must} — nothing to deploy"

    # ---- assemble ---------------------------------------------------------
    if DEPLOY.exists():
        shutil.rmtree(DEPLOY)
    DEPLOY.mkdir()

    # 1) index.html ← landing.html with the Play link pointed at the game.
    #    Unique anchor (not a blanket replace): the <a id="play-cta" ...>
    #    tag itself must contain the href being rewritten.
    landing = (REPO / "landing.html").read_text(encoding="utf-8")
    pattern = re.compile(
        r'(<a\b[^>]*\bid="play-cta"[^>]*\bhref=")index\.html(")', re.S)
    rewritten, n = pattern.subn(r'\g<1>play/index.html\g<2>', landing)
    assert n == 1, f"expected exactly 1 play-cta link in landing.html, found {n}"
    assert 'href="play/index.html"' in rewritten and \
        'href="index.html"' not in rewritten, "Play link rewrite failed"
    (DEPLOY / "index.html").write_text(rewritten, encoding="utf-8")

    # 2) standalone public docs + crawler files (robots/sitemap/ads.txt once
    #    lived only on the server and died to `rsync --delete` — they are now
    #    first-class repo sources shipped through this same allowlist)
    for name in ("privacy.html", "THIRD-PARTY-NOTICES.md",
                 "robots.txt", "ads.txt"):
        assert forbidden(Path(name)) is None, f"forbidden public file: {name}"
        shutil.copy2(REPO / name, DEPLOY / name)
    # sitemap.xml is GENERATED (not copied): the repo URL list gets a
    # deterministic <lastmod> stamped into every <url> (sitemap protocol
    # order inside <url>: loc, lastmod, changefreq, priority).
    sitemap, n_loc = re.subn(r"</loc>",
                             f"</loc><lastmod>{SITEMAP_LASTMOD}</lastmod>",
                             (REPO / "sitemap.xml").read_text(encoding="utf-8"))
    assert n_loc == 3, f"sitemap.xml should hold 3 <loc> URLs, found {n_loc}"
    (DEPLOY / "sitemap.xml").write_text(sitemap, encoding="utf-8")

    # 3) landing/ assets: landing.css (+ any top-level landing js) and the
    #    css/js/img subdirs — copy_tree never allows .py
    n_landing = 0
    for f in sorted(list((REPO / "landing").glob("*.css")) +
                   list((REPO / "landing").glob("*.js"))):
        assert forbidden(f.relative_to(REPO)) is None, "forbidden landing asset"
        (DEPLOY / "landing").mkdir(exist_ok=True)
        shutil.copy2(f, DEPLOY / "landing" / f.name)
        n_landing += 1
    for sub in ("css", "js", "img"):
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
    # deploy/index.html must be the landing page, not the game's old index
    root_index = (REPO / "index.html").read_text(encoding="utf-8")
    shipped = (DEPLOY / "index.html").read_text(encoding="utf-8")
    assert "play-cta" in shipped and shipped != root_index, \
        "deploy/index.html is not the landing page"
    assert (DEPLOY / "play" / "index.html").read_text(encoding="utf-8") \
        == root_index, "play/index.html is not the game's index"
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
    assert locs == ["https://lily.game/", "https://lily.game/play/",
                    "https://lily.game/privacy.html"], \
        f"sitemap.xml locs wrong: {locs}"
    lastmods = [t.firstChild.data for t in dom.getElementsByTagName("lastmod")]
    assert lastmods == [SITEMAP_LASTMOD] * 3, \
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
