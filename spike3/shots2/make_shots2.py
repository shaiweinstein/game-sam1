#!/usr/bin/env python3
"""S2 spike — Playwright verification of Lily v2: screenshots, 360° orbit
GIF, console-error + offline request-log check, and fps.

Same flow as shots/make_shots.py but forces the v2 model first.

Writes into spike3/shots2/:
  front.png back.png left.png right.png  45.png 135.png 225.png
  face-closeup.png  with-2d-panel.png  orbit2.gif

Run (server must be up on :8123):
  /tmp/kilo/venv/bin/python spike3/shots2/make_shots2.py
"""

import os
import sys

from playwright.sync_api import sync_playwright

try:
    from PIL import Image
except ImportError:
    print("Pillow missing in this interpreter"); sys.exit(1)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOT = os.path.join(ROOT, "spike3", "shots2")
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
        assert pg.evaluate("window.__spike3.getModelVersion()") == "v2", \
            "expected v2 to be the default active model"
        # let the render settle / fps stabilise
        pg.wait_for_timeout(1500)
        pg.evaluate("window.__spike3.setAutoRotate(false)")

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

        print("angle shots (v2)")
        shot("front.png", deg=0)
        shot("back.png", deg=180)
        # her left is +X, so the left profile is seen from the +X camera
        shot("left.png", deg=90)
        shot("right.png", deg=-90)
        shot("45.png", deg=45)
        shot("135.png", deg=135)
        shot("225.png", deg=225)
        # reset zoom, then frame the head for a clean face close-up
        pg.evaluate("window.__spike3.setZoom(2.1)")
        pg.wait_for_timeout(400)
        shot("face-closeup.png", deg=0, zoom=1.15)

        # one frame that clearly shows the 2D reference panel side-by-side
        pg.evaluate("window.__spike3.setZoom(2.1)")
        pg.wait_for_timeout(400)
        shot("with-2d-panel.png", deg=0)

        # ---- 360° orbit GIF (viewport only, downsampled for size) ----
        print("orbit gif")
        N = 36
        frames = []
        vp = pg.locator("#viewport")
        for i in range(N):
            deg = i * (360.0 / N)
            pg.evaluate(f"window.__spike3.setThetaInstant({deg})")
            pg.wait_for_timeout(80)  # a couple of rendered frames
            vp.screenshot(path="/tmp/kilo/_orbit2_frame.png")
            im = Image.open("/tmp/kilo/_orbit2_frame.png")
            w, h = im.size
            nw = 280
            nh = int(h * nw / w)
            frames.append(im.resize((nw, nh), Image.LANCZOS))
        frames[0].save(
            os.path.join(SHOT, "orbit2.gif"),
            save_all=True, append_images=frames[1:],
            duration=90, loop=0, optimize=True,
        )
        print("  saved orbit2.gif")

        fps = pg.evaluate("window.__spike3.fps()")
        b.close()

    # ---- offline check ----
    bad = [u for u in requests_log
           if not (u.startswith("http://localhost:8123") or u.startswith("http://127.0.0.1:8123")
                   or u.startswith("data:") or u.startswith("blob:") or u.startswith("file://"))]
    print("\n--- verification (v2) ---")
    print("fps:", fps)
    print("console errors:", console_errors if console_errors else "NONE")
    print("total requests:", len(requests_log))
    print("non-local requests:", bad if bad else "NONE (fully offline)")
    for f in ("front.png", "back.png", "left.png", "right.png", "45.png",
              "135.png", "225.png", "face-closeup.png", "with-2d-panel.png",
              "orbit2.gif"):
        path = os.path.join(SHOT, f)
        print(f"  {f}: {os.path.getsize(path)//1024} KB" if os.path.exists(path) else f"  {f}: MISSING")
    gif_kb = os.path.getsize(os.path.join(SHOT, "orbit2.gif")) // 1024
    if console_errors or bad or fps < 55:
        print("\nRESULT: NEEDS ATTENTION")
    else:
        print("\nRESULT: OK (offline, no console errors, ~60fps)"
              + ("" if gif_kb <= 2048 else "  [orbit2.gif > 2MB!]"))


if __name__ == "__main__":
    main()
