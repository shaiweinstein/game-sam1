#!/usr/bin/env python3
"""S3 QA gate: v1/v2/v3 toggle each render + each version's Walk plays;
settled fps sampled in idle AND mid-walk per version; console errors and
non-local (offline) requests collected. Exits non-zero on any failure.

Run (server must be up on :8123):
  /tmp/kilo/venv/bin/python spike3/qa3.py
"""

import sys

from playwright.sync_api import sync_playwright

URL = "http://localhost:8123/spike3/index.html"
fails = []
errs = []
reqs = []

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    pg.on("request", lambda r: reqs.append(r.url))
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL)
    pg.wait_for_function("window.__spike3.ready.then(()=>true)", timeout=20000)
    pg.wait_for_timeout(1800)   # settle

    for v in ("v3", "v2", "v1", "v3"):        # v3 default, cycle, end v3
        pg.evaluate(f"window.__spike3.setModelVersion('{v}')")
        pg.wait_for_timeout(900)
        got = pg.evaluate("window.__spike3.getModelVersion()")
        if got != v:
            fails.append(f"toggle to {v} landed on {got}")
        fps_idle = pg.evaluate("window.__spike3.fps()")
        pg.wait_for_function(
            f"window.__spike3.whenWalkLoaded('{v}').then(()=>true)", timeout=30000)
        vis = pg.locator("#walkBtn").is_visible()
        if not vis:
            fails.append(f"{v}: Walk button hidden")
            continue
        if pg.evaluate("window.__spike3.getWalk().playing"):
            pg.locator("#walkBtn").click()     # stop leftover walk first
            pg.wait_for_timeout(400)
        pg.locator("#walkBtn").click()
        pg.wait_for_function("window.__spike3.getWalk().playing", timeout=10000)
        pg.wait_for_timeout(3500)              # fade-in + fps settle
        st = pg.evaluate("window.__spike3.getWalk()")
        if st["version"] != v:
            fails.append(f"walk active on {st['version']} while showing {v}")
        fps_walk = max(pg.evaluate("window.__spike3.fps()"),
                       (pg.wait_for_timeout(1200),
                        pg.evaluate("window.__spike3.fps()"))[1])
        print(f"{v}: idle fps {fps_idle}  walk fps {fps_walk}")
        if fps_idle < 57:
            fails.append(f"{v}: idle fps {fps_idle} < 57")
        if fps_walk < 57:
            fails.append(f"{v}: walk fps {fps_walk} < 57")
        pg.locator("#walkBtn").click()         # stop before version switch
        pg.wait_for_timeout(300)
    b.close()

bad = [u for u in reqs
       if not (u.startswith("http://localhost:8123") or u.startswith("http://127.0.0.1:8123")
               or u.startswith("data:") or u.startswith("blob:") or u.startswith("file://"))]
print("console errors:", errs if errs else "NONE")
print("non-local requests:", bad if bad else "NONE (fully offline)")
if errs:
    fails.append(f"{len(errs)} console errors")
if bad:
    fails.append(f"{len(bad)} non-local requests")
if fails:
    print("\nQA FAILED:")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("\nQA PASSED: toggle v1/v2/v3, Walk plays on all, ~60fps idle+walk, offline, no errors")
