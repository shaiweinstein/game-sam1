#!/usr/bin/env python3
"""2D dress-up FIT contracts: does each garment actually sit on the body?

Companion to tests/character_svg_test.py (which checks purity/isolation/layer
order). This file only checks geometry: every catalog item is rendered on the
real body and measured against the anatomy anchors exported by
window.CharacterRenderer.anchors (BODY_ANCHORS in js/character.js).

Requires a running game HTTP server (default: http://localhost:8123), Python
Playwright, and its Chromium browser. This test never manages the server.
Example: /tmp/kilo/venv/bin/python tests/character_fit_test.py

Checks are measured from SVG geometry (getBBox + sampled path points), never
from screenshot pixels. ACTIVE rules gate the run; rules still owed work by
WARDROBE-FIT-PLAN.md steps 3-5 are reported as `pending` and only asserted
under --strict, so the suite is green while the audit list stays visible.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
body { margin:0; } #probe, svg.character { width:600px; height:680px; display:block; }
</style><script src="js/state.js"></script><script src="js/character.js"></script>
</head><body><div id="probe"></div></body></html>"""

# Tolerances (viewBox units). Kept here, not in the art file, so a designer can
# retune strictness without touching render code.
LIMITS = {
    "ink": 0.6,                 # slack for stroke caps outside the viewBox
    "hemOverlap": 0.0,          # tucked hem must reach the waistband
    "fringeOverEyes": 0.0,      # hair-front must stay above the eye centres
    "sleeveShoulderOverhang": 6.0,   # fabric may pass the arm this much at the shoulder
    "sleeveHemUndercoverage": 3.0,   # fabric may fall short of the arm this much at the hem
    "shoeAnkleRise": 2.0,       # shoe opening must reach this far above the foot end
    "shoeSoleContact": 4.0,     # sole must come within this of the sole line
    "shoeCuffGap": 2.0,         # bare leg allowed between a long hem and the shoe opening
    "ankleLengthBand": 12.0,    # hems this close to leg.endY are "ankle length" (pants)
    "headwearSeatZone": 34.0,   # head of the seat band = anchors.head.top .. +34
    "headwearSeatDepth": 0.5,   # share of headwear points that must land in the seat band
}

CONTRACTS = r"""(limits) => {
  const R = window.CharacterRenderer, A = R.anchors, C = R.catalog;
  if (!A) throw new Error('CharacterRenderer.anchors is missing (BODY_ANCHORS in js/character.js)');
  const L = limits;
  const fail = [], pending = [], notes = [];
  const probe = document.getElementById('probe');
  const SLOTS = ['hair','top','bottom','shoes','extra','swimsuit'];
  const BASE = {hair:'hair1', top:'top1', bottom:'bottom1', shoes:'shoes1', extra:null, swimsuit:'suit1'};
  const HEADWEAR = ['extra1','extra3','extra5','extra6','extra7'];   /* worn on the head */
  const SHOE_BOTTOMS = ['bottom1','bottom3','bottom7'];               /* skirt / shorts / jeans */

  function draw(patch) {
    const outfit = Object.assign({}, BASE, patch);
    for (const slot of SLOTS) GameState.setOutfitSlot(slot, outfit[slot]);
    R.forget(probe); probe.innerHTML = '';
    R.render(probe, {size:'big', characterId:'lily'});
    const svg = probe.querySelector('svg.character');
    if (patch.__skip) R.setPreviewSkip(probe, patch.__skip);
    return probe.querySelector('svg.character');
  }
  const box = b => ({x:+b.x.toFixed(1), y:+b.y.toFixed(1),
                     right:+(b.x+b.width).toFixed(1), bottom:+(b.y+b.height).toFixed(1)});
  function layers(svg) {
    const m = {};
    svg.querySelectorAll('[data-layer]').forEach(g => {
      if (!g.childElementCount) return;
      const u = unionInk(g);
      if (u) m[g.getAttribute('data-layer')] = box(u);
    });
    return m;
  }
  /* Sample a path's outline into viewBox points (strokes included via width). */
  function points(el, n) {
    let total = 0; try { total = el.getTotalLength(); } catch (e) { return []; }
    if (!total) return [];
    const step = total / n, out = [];
    for (let i = 0; i <= n; i++) {
      const p = el.getPointAtLength(Math.min(total, i * step));
      out.push([p.x, p.y]);
    }
    return out;
  }
  const layerPaths = (svg, layer) =>
    Array.from(svg.querySelectorAll('[data-layer="' + layer + '"] path'));
  const num = (el, name, fallback) => {
    const v = parseFloat(el.getAttribute(name));
    return isNaN(v) ? fallback : v;
  };
  const paintHalf = el => (el.getAttribute('stroke') && el.getAttribute('stroke') !== 'none'
    ? num(el, 'stroke-width', 1) / 2 : 0);
  const halfOf = el => Math.max(paintHalf(el), parseFloat(el.dataset.paint || '0') || 0);
  const grow = (b, h) => ({ x: b.x - h, y: b.y - h, width: b.width + h * 2, height: b.height + h * 2,
                            right: b.x + b.width + h, bottom: b.y + b.height + h });
  /* Union of everything a subtree actually puts on screen. getBBox() reports
     geometry only, so a fat round-capped stroke (tee and sweater sleeves) would
     otherwise be measured ~9u thinner than it draws — in the viewBox check and in
     the thumbnail crops alike. */
  function unionInk(root) {
    let x = Infinity, y = Infinity, r = -Infinity, b = -Infinity, any = false;
    Array.from(root.querySelectorAll('*')).forEach(el => {
      if (el.tagName === 'defs' || el.closest('defs')) return;
      if (el.getAttribute('display') === 'none') return;
      const q = grow(el.getBBox(), halfOf(el));
      any = true;
      x = Math.min(x, q.x); y = Math.min(y, q.y);
      r = Math.max(r, q.right); b = Math.max(b, q.bottom);
    });
    return any ? { x: x, y: y, right: r, bottom: b, width: r - x, height: b - y } : null;
  }
  /* Outer edge of the real arm at a y band, from the body's own arm strokes. */
  function armEdge(svg, side, y0, y1) {
    const half = A.arm.halfOutline;
    let best = side === 'right' ? -Infinity : Infinity, found = false;
    layerPaths(svg, 'body').forEach(el => {
      if (num(el, 'stroke-width', 0) !== A.arm.outlineWidth) return;
      const pts = points(el, 240);
      if (!pts.length) return;
      const isRight = pts[0][0] > A.head.cx;
      if (isRight !== (side === 'right')) return;
      pts.forEach(([x, y]) => {
        if (y < y0 || y > y1) return;
        found = true;
        best = side === 'right' ? Math.max(best, x + half) : Math.min(best, x - half);
      });
    });
    return found ? best : null;
  }
  /* Fabric extreme over the same band, for a garment layer. */
  function fabricEdge(svg, layer, side, y0, y1) {
    let best = side === 'right' ? -Infinity : Infinity, found = false;
    layerPaths(svg, layer).forEach(el => {
      const half = paintHalf(el);
      points(el, 240).forEach(([x, y]) => {
        if (y < y0 || y > y1) return;
        found = true;
        best = side === 'right' ? Math.max(best, x + half) : Math.min(best, x - half);
      });
    });
    return found ? best : null;
  }

  /* ---------- R1/R2/R3: every item on the body ---------- */
  function checkInk(label, svg) {
    const m = layers(svg);
    Object.keys(m).forEach(layer => {
      const b = m[layer];
      if (layer === 'shadow') return;
      if (b.x < -L.ink || b.y < -L.ink || b.right > A.view.width + L.ink ||
          b.bottom > A.view.height + L.ink)
        fail.push('R1 OUTSIDE VIEWBOX ' + label + ' layer=' + layer + ' ' + JSON.stringify(b));
    });
    return m;
  }

  /* R3 — sleeves must follow the arm curve (flagged items only). */
  const SHOULDER_BAND = [A.shoulderY + 6, A.shoulderY + 16];   /* 170..180 */
  const HEM_BAND = [A.waistY, A.waistY + 10];                   /* 200..210 */
  Object.keys(C.top).forEach(id => {
    const item = C.top[id];
    const svg = draw({top:id});
    checkInk('top/' + id, svg);
    if (!item.sleeved) return;
    ['left','right'].forEach(side => {
      const armShoulder = armEdge(svg, side, SHOULDER_BAND[0], SHOULDER_BAND[1]);
      const armHem = armEdge(svg, side, HEM_BAND[0], HEM_BAND[1]);
      const clothShoulder = fabricEdge(svg, 'top', side, SHOULDER_BAND[0], SHOULDER_BAND[1]);
      const clothHem = fabricEdge(svg, 'top', side, HEM_BAND[0], HEM_BAND[1]);
      if ([armShoulder, armHem, clothShoulder, clothHem].some(v => v === null)) {
        fail.push('R3 UNMEASURABLE sleeve top/' + id + ' ' + side); return;
      }
      const overhang = side === 'right' ? clothShoulder - armShoulder : armShoulder - clothShoulder;
      const uncovered = side === 'right' ? armHem - clothHem : clothHem - armHem;
      if (overhang > L.sleeveShoulderOverhang)
        fail.push('R3 SLEEVE OVERHANG top/' + id + ' ' + side + ' +' + overhang.toFixed(1) +
                  'u past the arm at y' + SHOULDER_BAND.join('-') + ' (max ' + L.sleeveShoulderOverhang + ')');
      if (uncovered > L.sleeveHemUndercoverage)
        fail.push('R3 ARM OUTSIDE SLEEVE top/' + id + ' ' + side + ' arm shows ' +
                  uncovered.toFixed(1) + 'u beyond the hem at y' + HEM_BAND.join('-') +
                  ' (max ' + L.sleeveHemUndercoverage + ')');
    });
  });

  /* R4 — fringe stays clear of the eye centres. */
  Object.keys(C.hair).forEach(id => {
    const svg = draw({hair:id});
    const m = checkInk('hair/' + id, svg);
    if (m['hair-front'] && m['hair-front'].bottom > A.eyes.bottom + L.fringeOverEyes)
      fail.push('R4 FRINGE OVER EYES hair/' + id + ' bottom y' + m['hair-front'].bottom +
                ' > eye bottom y' + A.eyes.bottom);
  });

  /* R2 — tucked hems must reach the waistband; nothing may go astray. */
  Object.keys(C.top).forEach(topId => {
    const top = C.top[topId];
    Object.keys(C.bottom).forEach(bottomId => {
      const svg = draw({top:topId, bottom:bottomId});
      const m = checkInk('top/' + topId + '+bottom/' + bottomId, svg);
      if (top.coversBottom || top.untucked || !m.top || !m.bottom) return;
      if (m.top.bottom < m.bottom.y - L.hemOverlap)
        fail.push('R2 BARE TORSO top/' + topId + '+bottom/' + bottomId +
                  ' hem y' + m.top.bottom + ' above waistband y' + m.bottom.y);
    });
  });

  /* ---------- Pending (plan steps 3-5) ---------- */
  Object.keys(C.shoes).forEach(id => {
    SHOE_BOTTOMS.forEach(bottomId => {
      const svg = draw({shoes:id, bottom:bottomId});
      const m = checkInk('shoes/' + id + '+' + bottomId, svg);
      if (!m.shoes) return;
      const b = m.shoes, tag = 'shoes/' + id + '+' + bottomId;
      if (b.y > A.leg.endY - L.shoeAnkleRise)
        pending.push('S1 SHOE BELOW FOOT ' + tag + ' opening y' + b.y +
                     ' > ankle line y' + (A.leg.endY - L.shoeAnkleRise));
      if (b.bottom < A.soleY - L.shoeSoleContact)
        pending.push('S2 FLOATING SOLE ' + tag + ' sole y' + b.bottom + ' < ' + (A.soleY - L.shoeSoleContact));
      /* A garment cut to reach the ankle (jeans) must meet the shoe opening;
         bare leg under a skirt or shorts hem is correct art, not a violation. */
      const hem = m.bottom ? m.bottom.bottom : null;
      if (hem !== null && hem >= A.leg.endY - L.ankleLengthBand && b.y > hem + L.shoeCuffGap)
        pending.push('S4 CUFF/SHOE GAP ' + tag + ' hem y' + hem + ' to shoe opening y' + b.y +
                     ' leaves the leg tip (ink ends y' + A.leg.skinInkBottom + ') showing');
    });
  });

  Object.keys(C.extra).forEach(id => {
    if (HEADWEAR.indexOf(id) === -1) {
      const svg = draw({extra:id});
      checkInk('extra/' + id, svg);
      return;
    }
    Object.keys(C.hair).forEach(hairId => {
      const svg = draw({extra:id, hair:hairId});
      const m = checkInk('extra/' + id + '+hair/' + hairId, svg);
      const b = m['extra-front'];
      if (!b) return;
      const tag = 'extra/' + id + '+hair/' + hairId;
      const seatTop = A.head.top - 2, seatBottom = A.head.top + L.headwearSeatZone;
      const insideX = b.x < A.head.right && b.right > A.head.left;
      if (!insideX)
        pending.push('H1 HEADWEAR OFF HEAD ' + tag + ' ink x' + b.x + '..' + b.right +
                     ' misses head x' + A.head.left + '..' + A.head.right);
      if (b.bottom > A.eyes.top)
        pending.push('H2 HEADWEAR OVER EYES ' + tag + ' bottom y' + b.bottom + ' > eyes top y' + A.eyes.top);
      let inside = 0, total = 0;
      svg.querySelectorAll('[data-layer="extra-front"] > *').forEach(el => {
        points(el, 120).forEach(([x, y]) => {
          total++;
          if (x >= A.head.left && x <= A.head.right && y >= seatTop && y <= seatBottom) inside++;
        });
      });
      const share = total ? inside / total : 0;
      notes.push({item:'extra/' + id, hair:hairId, seatShare:+share.toFixed(2),
                  ink:{y:b.y, bottom:b.bottom, x:b.x, right:b.right}});
      if (share < L.headwearSeatDepth)
        pending.push('H3 HEADWEAR FLOATS ' + tag + ' only ' + (share * 100).toFixed(0) +
                     '% of the ink is seated in the crown band y' + seatTop + '..' + seatBottom);
    });
  });

  /* Backpack panel must not be wider than the torso it sits behind. */
  (function () {
    const svg = draw({extra:'extra4'});
    const back = layers(svg)['extra-back'];
    if (back && (back.x < A.torso.left || back.right > A.torso.right || back.bottom > A.torso.bottom))
      pending.push('B1 BACKPACK PANEL OVERFLOWS torso x' + A.torso.left + '..' + A.torso.right +
                   ' y..' + A.torso.bottom + ' panel ' + JSON.stringify(back));
  })();

  /* Swimsuits in wardrobe preview mode. */
  Object.keys(C.swimsuit).forEach(id => {
    checkInk('swimsuit/' + id, draw({swimsuit:id, __skip:['top','bottom','shoes']}));
  });

  /* R7 — picker thumbnails must not clip their own art. */
  let thumbnails = 0;
  SLOTS.forEach(slot => {
    Object.keys(C[slot]).forEach(id => {
      const host = document.createElement('div');
      probe.appendChild(host);
      R.renderItemPreview(host, slot, id, {characterId:'lily'});
      const svg = host.querySelector('svg.wardrobe-item-preview');
      if (!svg) { fail.push('R7 NO THUMBNAIL ' + slot + '/' + id); return; }
      thumbnails++;
      const vb = (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
      if (vb.length !== 4 || vb.some(isNaN)) { fail.push('R7 BAD VIEWBOX ' + slot + '/' + id); return; }
      const ink = unionInk(svg);
      if (!ink) { fail.push('R7 EMPTY THUMBNAIL ' + slot + '/' + id); return; }
      const slack = 0.5;
      if (ink.x < vb[0] - slack || ink.y < vb[1] - slack ||
          ink.right > vb[0] + vb[2] + slack || ink.bottom > vb[1] + vb[3] + slack)
        fail.push('R7 THUMBNAIL CLIPPED ' + slot + '/' + id + ' ink ' + JSON.stringify(ink) +
                  ' crop ' + svg.getAttribute('viewBox'));
      host.remove();
    });
  });

  R.forget(probe); probe.innerHTML = '';
  return {
    status: fail.length ? 'failed' : (pending.length ? 'pending' : 'passed'),
    limits: L, activeFailures: fail, pendingViolations: pending,
    counts: {thumbnails: thumbnails, seatNotes: notes.length},
    seatTable: notes
  };
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8123", help="Running game server URL")
    parser.add_argument("--output", default="/tmp/kilo/wardrobe-fit", help="JSON evidence directory")
    parser.add_argument("--strict", action="store_true",
                        help="Also assert the rules owed by plan steps 3-5")
    args = parser.parse_args()

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={"width": 1280, "height": 900},
                                          reduced_motion="reduce")
            try:
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("console", lambda message: errors.append(message.text)
                        if message.type == "error" else None)
                page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}")
                        if response.status >= 400 else None)
                url = args.url.rstrip("/") + "/__character_fit_test__"
                page.route(url, lambda route: route.fulfill(status=200, content_type="text/html",
                                                            body=HTML))
                page.goto(url, wait_until="networkidle")
                report = page.evaluate(CONTRACTS, LIMITS)
                assert not errors, errors

                output = Path(args.output)
                output.mkdir(parents=True, exist_ok=True)
                (output / "fit-results.json").write_text(json.dumps(report, indent=2) + "\n")

                active, pending = report["activeFailures"], report["pendingViolations"]
                for line in active:
                    print("FAIL:", line)
                for line in pending:
                    print(("FAIL:" if args.strict else "TODO:").ljust(6), line)
                assert not active, f"{len(active)} active fit violation(s)"
                if args.strict:
                    assert not pending, f"{len(pending)} fit violation(s) owed by plan steps 3-5"

                print(("PASS" if not pending else "PASS (with pending work)") +
                      ": sleeves/hems/fringe/thumbnails on " +
                      str(report["counts"]["thumbnails"]) + " thumbnails; " +
                      f"{len(pending)} pending; evidence -> {output / 'fit-results.json'}")
            finally:
                context.close()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
