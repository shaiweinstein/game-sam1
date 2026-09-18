"""Capture real game screenshots for the landing page (landing/img/).

Usage:  python3 landing/capture_shots.py

Starts serve.py if localhost:8123 is not answering. Reuses the proven
`enter()` loader/entry helper from beach3d/ground_contact_test.py and the
boat-boarding flow from beach3d/scene_test.py (projected hull click).
Every wait is explicit (state polling or a fixed settle), no sleeps-as-
prayer. Shots are element screenshots at DPR2 (crisp text), cropped to
the card aspect where the subject needs it, then downscaled + compressed
to ≤ ~300 KB PNGs so the page stays light.

Only the capture script touches the page (visibility:hidden on the beach
talk bubble so its rounded edge never bleeds into the stage crop). The
game itself is never modified.
"""
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "landing" / "img"
BASE = "http://localhost:8123"
MAX_BYTES = 300_000      # per-image budget
MAX_WIDTH = 1280         # shipped width (captures are DPR2, downscaled)
CARD_ASPECT = 1.6        # 16:10 — the card image box in landing.css
STAGE = "#beach-stage"   # the beach canvas container (no action bar chrome)

sys.path.insert(0, str(REPO / "beach3d"))
from ground_contact_test import enter  # noqa: E402  (same server, same entry)

# The talk bubble and the Back button sit above the stage and their
# chunky borders/shadows bleed into the top rows of the clip; remove
# them for captures (the live game keeps both).
HIDE_TALK = "#beach-talk, .beach-close { display: none !important; }"


def server_up():
    try:
        with urllib.request.urlopen(BASE + "/index.html", timeout=1):
            return True
    except OSError:
        return False


def ensure_server():
    if server_up():
        return None
    proc = subprocess.Popen(
        [sys.executable, "serve.py"], cwd=REPO,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        if server_up():
            return proc
        time.sleep(0.2)
    proc.terminate()
    raise RuntimeError("serve.py did not come up on :8123")


def prepare(src: Path, crop: str | None):
    """Optional 16:10 subject crop (center/left/right), downscale, compress."""
    img = Image.open(src)
    if crop:
        w = round(img.height * CARD_ASPECT)
        if w < img.width:
            x0 = {"left": 0, "center": (img.width - w) // 2,
                  "right": img.width - w}[crop]
            img = img.crop((x0, 0, x0 + w, img.height))
    if img.width > MAX_WIDTH:
        h = round(img.height * MAX_WIDTH / img.width)
        img = img.resize((MAX_WIDTH, h), Image.LANCZOS)
    for colors in (None, 256, 224, 192, 160, 128):
        out = img.quantize(colors, method=Image.MEDIANCUT) if colors else img
        out.save(src, "PNG", optimize=True, compress_level=9)
        if src.stat().st_size <= MAX_BYTES:
            return
    raise RuntimeError(f"{src.name} will not fit in {MAX_BYTES} bytes")


def shot(page, name, crop=None, selector=None, clip=None, settle_ms=0):
    if settle_ms:
        page.wait_for_timeout(settle_ms)
    path = OUT / name
    if clip is not None:
        page.screenshot(path=str(path), clip=clip)
    elif selector:
        page.locator(selector).first.screenshot(path=str(path))
    else:
        page.screenshot(path=str(path))
    prepare(path, crop)
    print(f"  {name:32s} {path.stat().st_size // 1024:>4d} KB")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = ensure_server()
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 800},
                                    device_scale_factor=2)
            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text)
                    if m.type == "error" else None)

            enter(page)  # welcome → map → beach → 3D ready
            page.add_style_tag(content=HIDE_TALK)
            # The two gulls drift near the viewport's top edge and get
            # clipped into odd dark tabs in stills — hide for captures
            # only (the live game keeps them; __qaWorld comes from the
            # proven ground_contact_test.expose() patch).
            page.evaluate("__qaWorld.scene.getObjectByName('gulls').visible = false")

            # ---- 1) hero: Lily beside the umbrella (left-subject crop) --
            page.evaluate("__beach3d.teleport(-3.7, 2.7); __beach3d.setZoom(1)")
            shot(page, "hero-beach.png", crop="left", selector=STAGE,
                 settle_ms=2000)

            # ---- 4) boat ride (scene_test's hull click), steer centre ---
            page.evaluate("__beach3d.teleport(4.5, -3.5); __beach3d.setZoom(0.81)")
            page.wait_for_timeout(1900)
            hull = page.evaluate("__beach3d.project(4.7, 0.12, -3.5)")
            page.mouse.click(hull["x"], hull["y"])
            page.wait_for_function("__beach3d.boat().riding", timeout=15000)
            page.evaluate("__beach3d.boatSetTarget(0.5, -4.2)")
            try:
                page.wait_for_function(
                    "(() => { const b = __beach3d.boat();"
                    " return b.mode === 'riding' && Math.abs(b.x) < 2.6; })()",
                    timeout=14000)
            except Exception:
                pass  # coasting may stall near shore; frame whatever we get
            page.evaluate("__beach3d.setZoom(0.7)")
            shot(page, "card-beach-play.png", crop="center", selector=STAGE,
                 settle_ms=2000)
            page.get_by_role("button", name="Hop out & swim").click()
            page.wait_for_function("!__beach3d.boat().riding", timeout=10000)
            page.evaluate("__beach3d.setZoom(1)")
            page.wait_for_timeout(1500)

            # ---- 5) sandcastle builder, Fort template, corner camera ---
            page.evaluate("__beach3d.sandcastle.enter()")
            page.wait_for_function(
                "__beach3d.sandcastle.state()?.phase === 'building'", timeout=20000)
            page.evaluate('__beach3d.sandcastle.applyTemplate("fort")')
            page.evaluate("__beach3d.sandcastle.setCamView('corner')")
            page.wait_for_timeout(900)
            # Clip from stage top down to the toolbar's bottom so the tool
            # pills (which hang below the stage edge) are fully in frame.
            clip = page.evaluate("""() => {
                const s = document.querySelector('#beach-stage')
                    .getBoundingClientRect();
                const tb = document.querySelector('#beach-sc-toolbar');
                const bottom = tb ? tb.getBoundingClientRect().bottom : s.bottom;
                return { x: s.x, y: s.y, width: s.width,
                         height: Math.min(bottom + 6, innerHeight) - s.y };
            }""")
            shot(page, "card-sandcastle-build.png", crop="center", clip=clip)

            # ---- 6) baked castle in the world view (left-subject crop) --
            page.evaluate("__beach3d.sandcastle.exit()")   # exit bakes
            page.wait_for_function(
                "(() => { const s = __beach3d.sandcastle.state();"
                " return s && s.phase === 'idle' && s.baked; })()", timeout=15000)
            shot(page, "card-sandcastle-baked.png", crop="left", selector=STAGE,
                 settle_ms=1800)

            # ---- 2) dress-up: wardrobe open -----------------------------
            # (the close button is display:none during beach stills —
            # dispatch programmatically; same handler, same code path)
            page.evaluate("document.getElementById('beach-close').click()")
            page.click('.nav-button[data-screen="wardrobe"]')
            page.wait_for_selector("#wardrobe-items button", timeout=10000)
            page.wait_for_timeout(700)  # screen-pop animation settles
            shot(page, "card-dressup.png", selector="#screen-wardrobe")

            # ---- 3) kitchen: serving a treat ----------------------------
            page.click('.nav-button[data-screen="kitchen"]')
            page.wait_for_selector("#food-menu .food-item", timeout=10000)
            page.evaluate("document.querySelector('.game-main').scrollTop = 0")
            page.click("#food-menu .food-item:nth-child(4)")   # pancakes
            page.wait_for_timeout(300)  # the treat is mid-flight toward Lily
            # Clip just below the food grid: no white band under the screen.
            clip = page.evaluate("""() => {
                const r = document.querySelector('#screen-kitchen')
                    .getBoundingClientRect();
                const g = document.querySelector('#food-menu')
                    .getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width,
                         height: Math.min(g.bottom, r.bottom) - r.y };
            }""")
            shot(page, "card-kitchen.png", clip=clip)

            browser.close()
            if console_errors:
                print("console errors:", *console_errors, sep="\n  ")
    finally:
        if server:
            server.terminate()


if __name__ == "__main__":
    main()
