#!/usr/bin/env python3
"""S4 spike — Playwright verification of Lily v4: idle stills, 360° orbit
GIF, console-error + offline request-log check, and fps.

Same flow as shots3/make_shots3.py but for the v4 model (v4 is the viewer
default; asserted).

Writes into spike3/shots4/:
  front.png back.png left.png right.png q45.png q135.png
  walk-front1..3.png walk-back1..3.png  orbit4.gif
  (walk-orbit4.gif comes from make_walk_gif4.py)

Run (server must be up on :8123):
  /tmp/kilo/venv/bin/python spike3/shots4/make_shots4.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

try:
    from PIL import Image
except ImportError:
    print("Pillow missing in this interpreter"); sys.exit(1)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOT = os.path.join(ROOT, "spike3", "shots4")
URL = "http://localhost:8123/spike3/index.html"
VIEWPORT = {"width": 1280, "height": 800}
FIT = 2.55          # radius that frames the full v4 body in this viewport


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
            "expected v4 to be the default active model"
        pg.wait_for_timeout(1500)
        pg.evaluate("window.__spike3.setAutoRotate(false)")
        pg.evaluate(f"window.__spike3.setZoom({FIT})")
        pg.wait_for_timeout(1200)

        def shot(name, deg=None, zoom=None, element=None, settle=1100):
            if deg is not None:
                pg.evaluate(f"window.__spike3.setViewDeg({deg})")
            if zoom is not None:
                pg.evaluate(f"window.__spike3.setZoom({zoom})")
            if deg is not None or zoom is not None:
                pg.wait_for_timeout(settle)
            target = pg.locator(element) if element else pg
            target.screenshot(path=os.path.join(SHOT, name))
            print("  saved", name)

        print("angle shots (v4 idle)")
        shot("front.png", deg=0)
        shot("back.png", deg=180)
        # her left is +X, so the left profile is seen from the +X camera
        shot("left.png", deg=90)
        shot("right.png", deg=-90)
        shot("q45.png", deg=45)
        shot("q135.png", deg=135)

        # walk stills: deterministic phases (mid-stride legs-apart = 0.18
        # and 0.52, passing = 0.02), front and back — the family's arrows
        # were at the crotch, and the coverage must hold at every phase.
        print("walk stills (v4)")
        pg.wait_for_function(
            "window.__spike3.whenWalkLoaded('v4').then(()=>true)", timeout=30000)
        pg.locator("#walkBtn").click()
        pg.wait_for_function("window.__spike3.getWalk().playing", timeout=10000)
        pg.wait_for_timeout(1200)
        for view, deg in (("front", 0), ("back", 180)):
            pg.evaluate(f"window.__spike3.setViewDeg({deg})")
            pg.wait_for_timeout(900)
            for tag, wt in (("1", 0.02), ("2", 0.18), ("3", 0.52)):
                pg.evaluate(f"window.__spike3.setWalkTime({wt})")
                pg.wait_for_timeout(250)
                pg.evaluate(f"window.__spike3.setWalkTime({wt})")
                shot(f"walk-{view}{tag}.png", element="#viewport", settle=0)
        # stop walking again — orbit4.gif must show the IDLE model
        # (the walking orbit GIF is the separate make_walk_gif4.py run)
        pg.locator("#walkBtn").click()
        pg.wait_for_timeout(900)

        # ---- 360° orbit GIF (viewport only, downsampled for size) ----
        print("orbit gif")
        N = 36
        frames = []
        vp = pg.locator("#viewport")
        for i in range(N):
            deg = i * (360.0 / N)
            pg.evaluate(f"window.__spike3.setThetaInstant({deg})")
            pg.wait_for_timeout(80)
            vp.screenshot(path="/tmp/kilo/_orbit4_frame.png")
            im = Image.open("/tmp/kilo/_orbit4_frame.png")
            w, h = im.size
            nw = 280
            nh = int(h * nw / w)
            frames.append(im.resize((nw, nh), Image.LANCZOS))
        frames[0].save(
            os.path.join(SHOT, "orbit4.gif"),
            save_all=True, append_images=frames[1:],
            duration=90, loop=0, optimize=True,
        )
        print("  saved orbit4.gif")

        fps = pg.evaluate("window.__spike3.fps()")
        b.close()

    bad = [u for u in requests_log
           if not (u.startswith("http://localhost:8123") or u.startswith("http://127.0.0.1:8123")
                   or u.startswith("data:") or u.startswith("blob:") or u.startswith("file://"))]
    print("\n--- verification (v4) ---")
    print("fps:", fps)
    print("console errors:", console_errors if console_errors else "NONE")
    print("total requests:", len(requests_log))
    print("non-local requests:", bad if bad else "NONE (fully offline)")
    for f in ("front.png", "back.png", "left.png", "right.png", "q45.png",
              "q135.png",
              "walk-front1.png", "walk-front2.png", "walk-front3.png",
              "walk-back1.png", "walk-back2.png", "walk-back3.png",
              "orbit4.gif"):
        path = os.path.join(SHOT, f)
        print(f"  {f}: {os.path.getsize(path)//1024} KB" if os.path.exists(path) else f"  {f}: MISSING")
    gif_kb = os.path.getsize(os.path.join(SHOT, "orbit4.gif")) // 1024
    if console_errors or bad or fps < 55:
        print("\nRESULT: NEEDS ATTENTION")
    else:
        print("\nRESULT: OK (offline, no console errors, ~60fps)"
              + ("" if gif_kb <= 2048 else "  [orbit4.gif > 2MB!]"))


if __name__ == "__main__":
    main()
