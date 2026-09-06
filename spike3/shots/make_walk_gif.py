#!/usr/bin/env python3
"""S1 spike Phase 2 — Playwright capture of the walk:
clicks Walk, then records a 360° orbit GIF of Lily walking in place,
plus one front and one side still.

Writes into spike3/shots/:
  walk-orbit.gif  walk-front.png  walk-side.png

Run (server must be up on :8123, after make_shots.py assets exist):
  /tmp/kilo/venv/bin/python spike3/shots/make_walk_gif.py
"""

import os

from playwright.sync_api import sync_playwright
from PIL import Image

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOT = os.path.join(ROOT, "spike3", "shots")
URL = "http://localhost:8123/spike3/index.html"
VIEWPORT = {"width": 1280, "height": 800}


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
        pg.wait_for_function("window.__spike3.getWalk().available", timeout=30000)
        pg.wait_for_timeout(800)

        # start walking
        pg.locator("#walkBtn").click()
        pg.wait_for_function("window.__spike3.getWalk().playing", timeout=10000)
        pg.wait_for_timeout(600)  # let the fade-in finish

        pg.evaluate("window.__spike3.setAutoRotate(false)")
        pg.evaluate("window.__spike3.setZoom(2.1)")
        pg.wait_for_timeout(900)

        vp = pg.locator("#viewport")

        def shot(name, deg):
            pg.evaluate(f"window.__spike3.setViewDeg({deg})")
            pg.wait_for_timeout(1100)
            vp.screenshot(path=os.path.join(SHOT, name))
            print("  saved", name)

        shot("walk-front.png", 0)
        shot("walk-side.png", 90)

        # ---- 360° orbit GIF while she walks ----
        print("walk orbit gif")
        N = 36
        frames = []
        for i in range(N):
            deg = i * (360.0 / N)
            pg.evaluate(f"window.__spike3.setThetaInstant({deg})")
            pg.wait_for_timeout(80)
            vp.screenshot(path="/tmp/kilo/_walk_frame.png")
            im = Image.open("/tmp/kilo/_walk_frame.png")
            w, h = im.size
            nw = 280
            nh = int(h * nw / w)
            frames.append(im.resize((nw, nh), Image.LANCZOS))
        frames[0].save(
            os.path.join(SHOT, "walk-orbit.gif"),
            save_all=True, append_images=frames[1:],
            duration=90, loop=0, optimize=True,
        )
        print("  saved walk-orbit.gif")

        fps = pg.evaluate("window.__spike3.fps()")
        walk = pg.evaluate("window.__spike3.getWalk()")
        b.close()

    bad = [u for u in requests_log
           if not (u.startswith("http://localhost:8123") or u.startswith("http://127.0.0.1:8123")
                   or u.startswith("data:") or u.startswith("blob:") or u.startswith("file://"))]
    print("\n--- walk verification ---")
    print("walk state:", walk)
    print("fps:", fps)
    print("console errors:", console_errors if console_errors else "NONE")
    print("total requests:", len(requests_log))
    print("non-local requests:", bad if bad else "NONE (fully offline)")
    for f in ("walk-orbit.gif", "walk-front.png", "walk-side.png"):
        path = os.path.join(SHOT, f)
        print(f"  {f}: {os.path.getsize(path)//1024} KB" if os.path.exists(path) else f"  {f}: MISSING")
    if console_errors or bad:
        print("\nRESULT: NEEDS ATTENTION")
    else:
        print("\nRESULT: OK (walk active, offline, no console errors)")


if __name__ == "__main__":
    main()
