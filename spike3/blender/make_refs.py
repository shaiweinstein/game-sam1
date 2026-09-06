#!/usr/bin/env python3
"""S1 3D Lily spike — rasterize 2D references with the game's own renderer.

Outputs
-------
spike3/ref/lily-2d.png      full Lily (default outfit: hair1/top1/bottom1/shoes1)
                            rendered by the game's real CharacterRenderer, 600x680
spike3/blender/face_texture.png  just her 2D face features (eyes/shine/blush/smile)
                            on a transparent background, 512x249. This exact 2D
                            region (viewBox x 98..202, y 93.5..144 of the game's
                            300x340 viewBox) is what gets mapped onto the front
                            of the 3D head (see build_lily.py face patch).

Run: /tmp/kilo/venv/bin/python spike3/blender/make_refs.py
"""

import os
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REF_DIR = os.path.join(ROOT, "spike3", "ref")
os.makedirs(REF_DIR, exist_ok=True)

LILY = {
    "skin": "#ffdcc0", "skinShade": "#e8b48e", "face": "#4a3226",
    "hairMain": "#8a5a3a", "hairShade": "#5e3a22",
}

# ---- 1. full character via the game's own character.js ----
FULL_PAGE = os.path.join(REF_DIR, "_render.html")
with open(FULL_PAGE, "w") as f:
    f.write("""<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:#fdfaff;}
  #c{width:600px;height:680px;}
  svg{display:block;}
</style></head><body><div id="c"></div>
<script src="../../js/character.js"></script>
<script>
  // No GameState loaded -> character.js falls back to the DEFAULT outfit
  // (hair1/top1/bottom1/shoes1) and the 'lily' palette, which is exactly
  // the reference we want.
  const svg = CharacterRenderer.render(document.getElementById('c'), {size:'big'});
  svg.setAttribute('width','600');
  svg.setAttribute('height','680');
  window.__ready = true;
</script></body></html>""")

# ---- 2. face texture: the 2D face region on a SKIN background ----
# Region: x 96..204, y 90..148 (game viewBox coords). This exact region is
# mapped onto the front of the 3D head (linear in x and z, see
# build_lily.py) with the rest of the head UV-clamped into the margin
# rows/columns — so the margin must be pure skin: eyes top at y92,
# blush spans x 99..201, smile bottom y142 — all inside [90..148]x[96..204].
# The head mesh is textured with this whole image (opaque, skin fill),
# which keeps one mesh and no patch seam.
FACE_PAGE = os.path.join(REF_DIR, "_face.html")
with open(FACE_PAGE, "w") as f:
    c = LILY
    f.write(f"""<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{{margin:0;padding:0;background:{c['skin']};}}</style></head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="96 90 108 58" width="512" height="275">
  <rect x="96" y="90" width="108" height="58" fill="{c['skin']}"/>
  <!-- eyes -->
  <ellipse cx="128" cy="103" rx="8.5" ry="11" fill="{c['face']}"/>
  <ellipse cx="172" cy="103" rx="8.5" ry="11" fill="{c['face']}"/>
  <!-- shine dots -->
  <circle cx="131.5" cy="98.5" r="3.2" fill="#ffffff"/>
  <circle cx="175.5" cy="98.5" r="3.2" fill="#ffffff"/>
  <circle cx="125.5" cy="107" r="1.6" fill="#ffffff" opacity="0.8"/>
  <circle cx="169.5" cy="107" r="1.6" fill="#ffffff" opacity="0.8"/>
  <!-- blush -->
  <ellipse cx="110" cy="122" rx="11" ry="7" fill="#ffc9dc" opacity="0.8"/>
  <ellipse cx="190" cy="122" rx="11" ry="7" fill="#ffc9dc" opacity="0.8"/>
  <!-- smile -->
  <path d="M 136 124 Q 150 140 164 124" fill="none" stroke="{c['face']}"
        stroke-width="4.5" stroke-linecap="round"/>
</svg></body></html>""")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        pg = browser.new_page(viewport={"width": 640, "height": 720})
        pg.goto("file://" + FULL_PAGE)
        pg.wait_for_function("window.__ready === true", timeout=10000)
        pg.wait_for_timeout(150)
        el = pg.locator("#c")
        el.screenshot(path=os.path.join(REF_DIR, "lily-2d.png"))

        pg2 = browser.new_page(viewport={"width": 512, "height": 249})
        pg2.goto("file://" + FACE_PAGE)
        pg2.wait_for_timeout(150)
        pg2.locator("svg").screenshot(path=os.path.join(
            os.path.dirname(__file__), "face_texture.png"))
        browser.close()
    print("wrote ref/lily-2d.png and blender/face_texture.png")


if __name__ == "__main__":
    main()
