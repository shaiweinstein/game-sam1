#!/usr/bin/env python3
"""S4 spike — Playwright capture of the v4 walk: asserts the v4 default,
clicks Walk, records a 360° orbit GIF of Lily walking in place (the
same pattern as shots3/make_walk_gif3.py).

Writes into spike3/shots4/:
  walk-orbit4.gif

Run (server must be up on :8123):
  /tmp/kilo/venv/bin/python spike3/shots4/make_walk_gif4.py
"""

import os

from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOT = os.path.join(ROOT, "spike3", "shots4")
URL = "http://localhost:8123/spike3/index.html"
VIEWPORT = {"width": 1280, "height": 800}
FIT = 2.55


def main():
    os.makedirs(SHOT, exist_ok=True)
    requests_log = []
    console_errors = []

    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport=VIEWPORT)
        pg.on("request", lambda r: requests_log.append(r.url))
        pg.on("console", lambda m: console_errors.append(m.text)
              if m.type == "error" else None)
        pg.on("pageerror", lambda e: console_errors.append(str(e)))
        pg.goto(URL)
        pg.wait_for_function("window.__spike3.ready.then(()=>true)", timeout=20000)
        assert pg.evaluate("window.__spike3.getModelVersion()") == "v4", \
            "expected v4 default"
        pg.wait_for_function("window.__spike3.whenWalkLoaded('v4').then(()=>true)",
                             timeout=30000)
        pg.wait_for_timeout(800)

        pg.locator("#walkBtn").click()
        pg.wait_for_function("window.__spike3.getWalk().playing", timeout=10000)
        pg.wait_for_timeout(600)

        pg.evaluate("window.__spike3.setAutoRotate(false)")
        pg.evaluate(f"window.__spike3.setZoom({FIT})")
        pg.wait_for_timeout(1000)

        vp = pg.locator("#viewport")

        print("walk orbit gif (v4)")
        N = 36
        frames = []
        for i in range(N):
            deg = i * (360.0 / N)
            pg.evaluate(f"window.__spike3.setThetaInstant({deg})")
            pg.wait_for_timeout(80)
            vp.screenshot(path="/tmp/kilo/_walk4_frame.png")
            im = Image.open("/tmp/kilo/_walk4_frame.png")
            w, h = im.size
            nw = 280
            nh = int(h * nw / w)
            frames.append(im.resize((nw, nh), Image.LANCZOS))
        frames[0].save(
            os.path.join(SHOT, "walk-orbit4.gif"),
            save_all=True, append_images=frames[1:],
            duration=90, loop=0, optimize=True,
        )
        print("  saved walk-orbit4.gif")

        fps = pg.evaluate("window.__spike3.fps()")
        walk = pg.evaluate("window.__spike3.getWalk()")
        b.close()

    bad = [u for u in requests_log
           if not (u.startswith("http://localhost:8123") or u.startswith("http://127.0.0.1:8123")
                   or u.startswith("data:") or u.startswith("blob:") or u.startswith("file://"))]
    print("\n--- walk verification (v4) ---")
    print("walk state:", walk)
    print("fps:", fps)
    print("console errors:", console_errors if console_errors else "NONE")
    print("total requests:", len(requests_log))
    print("non-local requests:", bad if bad else "NONE (fully offline)")
    path = os.path.join(SHOT, "walk-orbit4.gif")
    print(f"  walk-orbit4.gif: {os.path.getsize(path)//1024} KB" if os.path.exists(path)
          else "  walk-orbit4.gif: MISSING")
    if console_errors or bad:
        print("\nRESULT: NEEDS ATTENTION")
    else:
        print("\nRESULT: OK (v4 walk active, offline, no console errors)")


if __name__ == "__main__":
    main()
