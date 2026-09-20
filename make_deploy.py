#!/usr/bin/env python3
"""Assemble the public `deploy/` bundle — MONETIZATION-AND-LICENSING.md §6.

Stdlib only. Layout produced:

    deploy/
      index.html               ← landing.html (Play link rewritten to play/)
      privacy.html
      robots.txt               ← crawler rules + Sitemap: pointer
      sitemap.xml              ← / , /play/ , /privacy.html
      THIRD-PARTY-NOTICES.md
      landing/                 ← css/, js/ (if present), img/ — never the
                                  capture script (.py files are banned outright)
      play/                    ← ONLY the game: index.html, css/, js/, lib/,
                                  beach3d/** (incl. assets/)

Hard guarantees (real asserts at the end — the script fails LOUDLY):
  * no spike*/, tests/, shots*/, .playwright-mcp/, .git* anywhere
  * no *.py at all (kills *_test.py, serve.py, capture scripts)
  * no *.md except THIRD-PARTY-NOTICES.md and lib/three/README.md
    (the latter is three.js's own vendoring notice — §1 requires it)
  * no *-login.md, no "mixamo" in any path
  * deploy/index.html is the LANDING page, not the root game index
Run from anywhere: paths resolve relative to this file.
"""
import re
import shutil
import sys
import xml.dom.minidom
from pathlib import Path

REPO = Path(__file__).resolve().parent
DEPLOY = REPO / "deploy"

# The ONLY .md files allowed in the public bundle (everything else is a dev
# plan doc). lib/three/README.md carries the vendored three.js notice (§1
# requires it); matched by suffix so the check works repo- AND deploy-relative.
MD_ALLOWLIST_SUFFIXES = ("THIRD-PARTY-NOTICES.md", "lib/three/README.md")

EXCLUDED_DIR_PARTS = ("spike", "tests", "shots", ".playwright-mcp", ".git")
EXCLUDED_SUBSTRINGS = ("mixamo",)          # any path part, case-insensitive
EXCLUDED_NAMES = ("serve.py",)            # not needed on real hosts


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
                 "robots.txt", "sitemap.xml", "ads.txt"):
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
    for sub in ("css", "js", "img"):
        d = REPO / "landing" / sub
        if d.is_dir():
            n_landing += copy_tree(d, DEPLOY / "landing" / sub)
    assert n_landing >= 1 + 6, "landing assets incomplete"
    assert (DEPLOY / "landing" / "landing.css").exists(), "landing.css missing"
    assert len(list((DEPLOY / "landing" / "img").glob("*.png"))) == 6, \
        "landing/img did not ship all six screenshots"

    # 4) play/ = the game only
    (DEPLOY / "play").mkdir()
    shutil.copy2(REPO / "index.html", DEPLOY / "play" / "index.html")
    n_play = 1  # the game's index itself
    for sub in ("css", "js", "lib", "beach3d"):
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
    # the six card images made it
    assert len(list((DEPLOY / "landing" / "img").glob("*.png"))) == 6, \
        "landing/img did not ship all six screenshots"
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
    # ads.txt must declare our AdSense publisher — without it Google shows
    # "Not found" and serves no ads (it also died to rsync --delete once)
    ads = (DEPLOY / "ads.txt").read_text(encoding="utf-8")
    assert "pub-8606608049292845" in ads and "DIRECT" in ads \
        and "\r" not in ads, "ads.txt missing or malformed"

    # ---- summary -----------------------------------------------------------
    total = sum(f.stat().st_size for f in files)
    top = sorted(files, key=lambda f: f.stat().st_size, reverse=True)[:10]
    print(f"\ndeploy/ — {len(files)} files, {total / 1024 / 1024:.2f} MiB")
    print("largest files:")
    for f in top:
        print(f"  {f.stat().st_size / 1024:9.1f} KiB  {f.relative_to(DEPLOY)}")
    print("\nSAFE: no excluded patterns present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
