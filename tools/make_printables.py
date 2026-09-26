#!/usr/bin/env python3
"""Export the game's printable paper-doll sheet as ready-to-print PDFs for the website's /printables/ page.

Usage:  python3 tools/make_printables.py

The sheet is NOT re-implemented here: the game's own js/print-dolls.js builds it (same art, same mm scale, same fold
tabs) and Chromium prints it with the game's @media print CSS. The in-game "Print paper dolls" button is untouched;
this only saves the same output as files, one PDF per hairstyle, plus small preview images.

Writes landing/printables/:
    lily-paper-dolls-<hairId>.pdf    one US Letter PDF per hairstyle (dolls + the whole wardrobe)
    doll-<hairId>.png                the doll in that hairstyle (preview on the page)
    wardrobe-<n>.png                 pages 3-5 of the first PDF (tops, bottoms, shoes & swimsuits; page 2 is the spare doll), rendered with
                                     pdftoppm (poppler-utils) so the preview is exactly what prints
    printables.json                  what make_deploy.py renders: hair names, files, sizes, page counts

Starts serve.py if localhost:8123 is not answering (like landing/capture_shots.py).
"""
import io
import json
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "landing" / "printables"
BASE = "http://localhost:8123"
PREVIEW_MAX = (640, 900)  # preview PNGs are downscaled into this box


def server_up() -> bool:
    try:
        urllib.request.urlopen(BASE + "/", timeout=2)
        return True
    except OSError:
        return False


def save_preview(png: bytes, path: Path) -> None:
    img = Image.open(io.BytesIO(png)).convert("RGBA")
    img.thumbnail(PREVIEW_MAX)
    img.save(path, optimize=True)


def main() -> int:
    server = None
    if not server_up():
        server = subprocess.Popen([sys.executable, str(REPO / "serve.py")], cwd=REPO,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            if server_up():
                break
            time.sleep(0.2)
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*"):
        old.unlink()
    items = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 900}, device_scale_factor=2)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(BASE + "/", wait_until="networkidle")
            page.click("#welcome-start")                      # the welcome card blocks PrintDolls.open()
            page.wait_for_function("window.PrintDolls && window.CharacterRenderer")
            page.evaluate("PrintDolls.open()")
            page.wait_for_function("PrintDolls.summary().dolls > 0")
            hairs = page.evaluate("""() => Object.keys(CharacterRenderer.catalog.hair)
                                       .map(id => [id, CharacterRenderer.getItemName('hair', id)])""")
            buttons = page.locator("#print-hair-choice button")
            assert buttons.count() == len(hairs), f"{buttons.count()} hair buttons for {len(hairs)} hairstyles"
            for i, (hair_id, hair_name) in enumerate(hairs):
                buttons.nth(i).click()
                page.wait_for_timeout(300)
                summary = page.evaluate("PrintDolls.summary()")
                pdf_name = f"lily-paper-dolls-{hair_id}.pdf"
                page.emulate_media(media="print")
                page.pdf(path=str(OUT / pdf_name), format="Letter", print_background=True,
                         prefer_css_page_size=True)
                page.emulate_media(media="screen")
                pdf = (OUT / pdf_name).read_bytes()
                n_pages = len(re.findall(rb"/Type\s*/Page[^s]", pdf))
                assert pdf[:5] == b"%PDF-" and n_pages >= 2, f"{pdf_name}: bad PDF ({n_pages} pages)"
                save_preview(page.locator(".print-doll").first.screenshot(), OUT / f"doll-{hair_id}.png")
                items.append({"hairId": hair_id, "hairName": hair_name, "pdf": pdf_name,
                              "preview": f"doll-{hair_id}.png", "bytes": len(pdf), "pages": n_pages,
                              "pieces": summary["pieces"]})
                print(f"  {pdf_name}: {n_pages} pages, {len(pdf) // 1024} KB, {summary['pieces']} pieces")
            assert not errors, f"page errors: {errors}"
            browser.close()
    finally:
        if server:
            server.terminate()
    wardrobe = []
    for n in (3, 4, 5):
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run(["pdftoppm", "-f", str(n), "-l", str(n), "-r", "110", "-png", "-singlefile",
                            str(OUT / items[0]["pdf"]), f"{tmp}/page"], check=True)
            save_preview((Path(tmp) / "page.png").read_bytes(), OUT / f"wardrobe-{n}.png")
        wardrobe.append(f"wardrobe-{n}.png")
    (OUT / "printables.json").write_text(json.dumps({"paper": "US Letter", "sheets": items, "wardrobePreviews": wardrobe},
                                                    indent=2) + "\n",
                                         encoding="utf-8")
    print(f"wrote {len(items)} PDFs + previews to {OUT.relative_to(REPO)}/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
