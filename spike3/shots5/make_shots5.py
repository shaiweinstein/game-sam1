#!/usr/bin/env python3
"""B0 — three.js runtime verification of beach3d/assets/lily4_full.glb.

For every clip in spike3/clips3.html: 3 deterministic frames (first, mid,
last) from the front + the mid frame from the side. Uses the __clips3
freeze/seek hook so poses are exact, not race-of-the-clock.

Run (serve.py must be up on :8123, repo root):
  /tmp/kilo/venv/bin/python spike3/shots5/make_shots5.py
"""

import os
import sys
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOT = os.path.join(ROOT, "spike3", "shots5")
URL = "http://localhost:8123/spike3/clips3.html"
VIEWPORT = {"width": 640, "height": 640}

# clip -> (frames total) at 30fps authored (verified against the GLB)
CLIPS = {
    "Walk": 32, "Idle": 299, "Swim": 137, "Sit": 64,
    "Paddle": 218, "SurfRide": 31, "Cheer": 88, "Greet": 17,
}


def main():
    os.makedirs(SHOT, exist_ok=True)
    console_errors = []
    bad_requests = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport=VIEWPORT)
        pg.on("console", lambda m: console_errors.append(m.text)
              if m.type == "error" else None)
        pg.on("pageerror", lambda e: console_errors.append(str(e)))
        pg.on("requestfailed", lambda r: bad_requests.append(r.url))
        pg.goto(URL)
        pg.wait_for_function("window.__clips3.ready.then(()=>true)", timeout=30000)
        info = pg.evaluate("window.__clips3.clips()")
        print("loaded clip durations:",
              {n: round(v["duration"], 3) for n, v in info.items()})
        vp = pg.locator("#viewport")

        for name, total in CLIPS.items():
            mids = (1 + total) // 2
            for f in (1, mids, total):
                pg.evaluate(f"window.__clips3.seek({name!r}, {f})")
                pg.evaluate(f"window.__clips3.setView({name!r}, 'front')")
                pg.wait_for_timeout(150)
                vp.screenshot(path=os.path.join(SHOT, f"{name}-f{f}.png"))
            pg.evaluate(f"window.__clips3.seek({name!r}, {mids})")
            pg.evaluate(f"window.__clips3.setView({name!r}, 'side')")
            pg.wait_for_timeout(150)
            vp.screenshot(path=os.path.join(SHOT, f"{name}-f{mids}-side.png"))
            print(f"  {name}: 4 shots")

        fps = pg.evaluate("window.__clips3.fps()")
        b.close()

    print("fps:", fps)
    print("console errors:", console_errors if console_errors else "NONE")
    print("request failures:", bad_requests if bad_requests else "NONE")
    files = sorted(os.listdir(SHOT))
    print(f"shots: {len(files)}")
    missing = [f"{n}-f{k}.png" for n, t in CLIPS.items()
               for k in (1, (1 + t) // 2, t)] + \
              [f"{n}-f{(1 + t) // 2}-side.png" for n, t in CLIPS.items()]
    miss = [m for m in missing if m not in files]
    print("missing:", miss if miss else "NONE")
    sys.exit(1 if (console_errors or bad_requests or miss) else 0)


if __name__ == "__main__":
    main()
