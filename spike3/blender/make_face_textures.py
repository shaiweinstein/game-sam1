#!/usr/bin/env python3
"""Deterministic B5 face remap. Run with /tmp/kilo/venv/bin/python.

Read palettes from js/character.js, preserve layout and antialias coverage.
RGB distance selects the nearest skin/feature/blush color segment; projecting
onto it recovers subpixel coverage rather than hard-quantizing soft edges.
The source's white eye glints are retained, including their feature AA edges.
PNG output has no timestamps/metadata; fixed compression, half-up rounding.
"""
from itertools import combinations
from pathlib import Path
import hashlib
import math
import re

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def rgb(hex_color):
    return tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5))


def blend(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def main():
    js = (ROOT / "js/character.js").read_text()
    block = re.search(r"const CHARACTERS = \{(.*?)\n  \};", js, re.S).group(1)
    palettes = {}
    for name, body in re.findall(r"(\w+): \{(.*?)\}", block, re.S):
        fields = dict(re.findall(r'(\w+): "(#[0-9a-f]+)"', body))
        opacity = re.search(r"blushOpacity: ([\d.]+)", body)
        palettes[name] = {k: rgb(v) for k, v in fields.items()}
        palettes[name]["opacity"] = float(opacity.group(1)) if opacity else 0.8
    pink = rgb(re.search(r'blush cheeks.*?fill="(#[0-9a-f]+)"', js, re.S).group(1))
    lily = palettes["lily"]
    # Rasterized source blush is already composited and rounded to bytes.
    blush = tuple(math.floor(v + 0.5) for v in blend(lily["skin"], pink, lily["opacity"]))
    source = (lily["skin"], lily["face"], blush, (255, 255, 255))
    image = Image.open(Path(__file__).with_name("face_texture.png")).convert("RGB")
    pixels = [image.getpixel((x, y)) for y in range(image.height) for x in range(image.width)]
    coverage = {}
    for p in sorted(set(pixels)):
        best = None
        for i, j in combinations(range(len(source)), 2):
            a, b = source[i], source[j]
            d = tuple(y - x for x, y in zip(a, b))
            t = max(0, min(1, sum((v - x) * dv for v, x, dv in zip(p, a, d)) /
                           sum(v * v for v in d)))
            error = sum((v - q) ** 2 for v, q in zip(p, blend(a, b, t)))
            candidate = (error, i, j, t)
            if best is None or candidate < best:
                best = candidate
        coverage[p] = best[1:]
    for name in ("amara", "mei", "sofia"):
        c = palettes[name]
        target = (c["skin"], c["face"], blend(c["skin"], pink, c["opacity"]), source[3])
        lookup = {p: tuple(math.floor(v + 0.5) for v in blend(target[i], target[j], t))
                  for p, (i, j, t) in coverage.items()}
        out = Image.new("RGB", image.size)
        out.putdata([lookup[p] for p in pixels])
        w, h = image.size
        assert all(out.getpixel((x, y)) == c["skin"]
                   for x, y in ([(x, y) for x in range(w) for y in (0, h - 1)] +
                                [(x, y) for y in range(h) for x in (0, w - 1)]))
        path = ROOT / f"beach3d/assets/face_{name}.png"
        out.save(path, compress_level=9, optimize=False)
        print(name, image.size, "blushOpacity", c["opacity"],
              "sha256", hashlib.sha256(path.read_bytes()).hexdigest())


if __name__ == "__main__":
    main()
