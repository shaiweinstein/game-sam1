#!/usr/bin/env python3
"""Printable paper-doll sheet contracts (js/print-dolls.js).

Requires the running game server (default: http://localhost:8123), Python
Playwright and its Chromium. This test never manages the server.
Example: /tmp/kilo/venv/bin/python tests/print_dolls_test.py

What it pins down:
  * the sheet opens from the wardrobe, prints free, and closes cleanly;
  * the SCALE contract - every box is its own crop times one shared
    mm-per-unit factor, which is what makes printed clothes fit the doll;
  * the doll wears the white tank top + shorts, nothing else, no shadow;
  * fold tabs and dashed cut lines exist where they must and not where they
    should not;
  * print-media isolation (the game chrome must not print);
  * a real US Letter PDF, whose page count must match the sheet's pages -
    the check that catches a group overflowing its page.
Nothing here is judged from screenshot pixels.
"""
import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

CONTRACTS = r"""() => {
  const R = window.CharacterRenderer, sheet = document.getElementById('print-sheet');
  const SLOTS = ['top', 'bottom', 'shoes', 'swimsuit', 'extra'];
  const fail = [], notes = {};
  if (!sheet || sheet.hasAttribute('hidden')) return {fail: ['print sheet is not open'], notes};

  if (!document.body.classList.contains('print-dolls-open'))
    fail.push('body.print-dolls-open missing while the sheet is open');

  const list = sel => Array.from(sheet.querySelectorAll(sel));
  const boxOf = svg => (svg.getAttribute('viewBox') || '').split(/\s+/).map(Number);
  const mm = v => parseFloat(v) || 0;
  const k = window.PrintDolls.mmPerUnit;

  /* ---------- Scale: each box is its own crop at the SAME factor ---------- */
  const checkScale = (svg, label) => {
    const vb = boxOf(svg);
    /* Min-x/min-y may legitimately be off-box (the party hat crop starts at
       y=-10); only the width and height have to be real extents. */
    if (vb.length !== 4 || vb.some(isNaN) || vb[2] <= 0 || vb[3] <= 0)
      return fail.push(label + ' has no usable viewBox: ' + svg.getAttribute('viewBox'));
    const wantW = +(vb[2] * k).toFixed(2), wantH = +(vb[3] * k).toFixed(2);
    const gotW = mm(svg.style.width), gotH = mm(svg.style.height);
    if (Math.abs(gotW - wantW) > 0.06 || Math.abs(gotH - wantH) > 0.06)
      fail.push(label + ' prints ' + gotW + 'x' + gotH + 'mm but crop ' + vb[2] + 'x' + vb[3] +
                'u at ' + k + ' mm/unit wants ' + wantW + 'x' + wantH + 'mm');
  };

  const dolls = list('.print-doll svg');
  const wantDolls = window.PrintDolls.summary().dolls;
  if (dolls.length !== wantDolls) fail.push('dolls: got ' + dolls.length + ', want ' + wantDolls);
  dolls.forEach((svg, i) => checkScale(svg, 'doll#' + i));

  const pieces = list('.print-piece svg');
  const wantPieces = SLOTS.reduce((n, slot) => n + Object.keys(R.catalog[slot]).length, 0);
  if (pieces.length !== wantPieces)
    fail.push('pieces: got ' + pieces.length + ', the catalog has ' + wantPieces);
  list('.print-piece').forEach(li => {
    const svg = li.querySelector('svg');
    if (svg) checkScale(svg, li.dataset.slot + '/' + li.dataset.itemId);
    const label = li.querySelector('.print-piece-name');
    const wanted = R.getItemName(li.dataset.slot, li.dataset.itemId);
    if (!label || !label.textContent.trim())
      fail.push('piece ' + li.dataset.slot + '/' + li.dataset.itemId + ' has no printed name');
    else if (wanted && label.textContent.trim() !== wanted)
      fail.push('piece ' + li.dataset.itemId + ' is labelled "' + label.textContent.trim() +
                '" but the catalog calls it "' + wanted + '"');
  });

  /* ---------- The doll: underclothes on, everything else off ---------- */
  /* Tonal separation is the contract: the tank is pure white #ffffff, the
     shorts are grey #e8ebf5. White shorts under a white tank printed as ONE
     dress (parent rejection), so each layer is checked against its OWN fill. */
  const filled = (el, want) => !!el && !!el.querySelector('[fill="' + want + '"]');
  dolls.forEach((svg, i) => {
    const tag = 'doll#' + i;
    const L = name => svg.querySelector('[data-layer="' + name + '"]');
    if (!L('body') || !L('body').childElementCount) fail.push(tag + ' body layer is empty');
    if (!filled(L('top'), '#ffffff') || !filled(L('bottom'), '#e8ebf5'))
      fail.push(tag + ' is missing the white tank top (#ffffff) + grey shorts (#e8ebf5)');
    /* ---------- The shorts are real snug shorts: sample the grey fill ----------
       filled('#e8ebf5') alone still passes a grey skirt over bare legs, so
       measure the silhouette directly. UNDER_MARKUP.bottom is ONE grey-filled
       main path plus two fill="none" waistband seams (js/character.js).
       isPointInFill must find fabric on BOTH leg columns (x137/x163 at
       y230/240/252 - the seat and the pant tubes) and across the waistband
       under the tank-hem tuck (150,212 - the band's top edge starts at
       (119,204) and dips under the shirt hem toward (150,215), so y212 is
       solid band at the centre). The inseam apex sits ON the crotch line
       (150,247) with a solid grey panel ABOVE it (fabric at (150,240) - that
       panel is denim-shorts anatomy, not a diaper, because the sides are
       snug; a slit there is the leotard cut that failed earlier review), and
       the wedge between the tubes opens only BELOW the apex: (150,250) and
       (150,252) stay bare, and (150,258) below the hems must be bare too -
       fabric down there is the panel-to-the-hem diaper regression.
       The doll svg has no transforms, so viewBox units are
       user units for createSVGPoint. */
    const bottomG = L('bottom');
    if (!bottomG) {
      fail.push(tag + ' has no bottom layer to measure the shorts against');
    } else {
      const pants = Array.from(bottomG.querySelectorAll('path'))
        .filter(p => p.getAttribute('fill') === '#e8ebf5')[0];
      if (!pants) {
        fail.push(tag + ' bottom layer has no grey-filled (#e8ebf5) main path to sample');
      } else {
        const inFill = (x, y) => {
          const pt = svg.createSVGPoint();
          pt.x = x;
          pt.y = y;
          return pants.isPointInFill(pt);
        };
        const legFabric = (x, y, where) => {
          if (!inFill(x, y)) fail.push(tag + ' bottom is a skirt: no fabric ' + where +
                    ' at (' + x + ',' + y + ') - the snug shorts must cover both leg columns');
        };
        const panelFabric = (x, y) => {
          if (!inFill(x, y)) fail.push(tag + ' bottom is a leotard: the crotch slit rises to y' + y +
                    ' - the inseam apex must sit at the crotch line (150,247)');
        };
        const wedgeBare = (x, y) => {
          if (inFill(x, y)) fail.push(tag + ' bottom is a diaper/panel: fabric reaches (' + x + ',' + y + ')' +
                    ' - the inseam wedge must open below the apex (150,247), not run to the hem');
        };
        if (!inFill(150, 212))
          fail.push(tag + ' bottom has no filled waistband: the band must carry fabric' +
                    ' across the waist under the tank-hem tuck at (150,212)');
        legFabric(137, 230, 'on the left leg column at the hip');
        legFabric(163, 230, 'on the right leg column at the hip');
        legFabric(137, 240, 'on the left leg column at mid-thigh');
        legFabric(163, 240, 'on the right leg column at mid-thigh');
        legFabric(137, 252, 'on the left pant tube at the hem');
        legFabric(163, 252, 'on the right pant tube at the hem');
        panelFabric(150, 240);
        wedgeBare(150, 250);
        wedgeBare(150, 252);
        wedgeBare(150, 258);
      }
      const pb = bottomG.getBBox();
      if (pb.y + pb.height < 250)
        fail.push(tag + ' bottom is a skirt: it only reaches y' + (pb.y + pb.height).toFixed(0) +
                  ' - the pant tubes must hem in the thigh window (y256), not stop above it');
      if (pb.y + pb.height > 268)
        fail.push(tag + ' bottom hangs to y' + (pb.y + pb.height).toFixed(0) +
                  ' - the hems must stay at y256; bare knees are the whole point');
      if (pb.y > 206)
        fail.push(tag + ' bottom starts at y' + pb.y.toFixed(0) + ' - the waistband must start' +
                  ' at the tuck under the tank hem (y204)');
    }
    const topG = L('top');
    if (topG) {
      const tb = topG.getBBox();
      if (tb.y + tb.height > 212)
        fail.push(tag + ' tank top reaches y' + (tb.y + tb.height).toFixed(0) +
                  ' and eats the shorts waistband');
    }
    if (L('shoes') && L('shoes').childElementCount) fail.push(tag + ' should print bare-footed');
    if (L('shadow')) fail.push(tag + ' should not print a ground shadow');
    if (!L('hair-front') || !L('hair-front').childElementCount) fail.push(tag + ' has no hair');
    if (!svg.querySelector('g[data-tab="stand"]')) fail.push(tag + ' has no stand tab');
    /* Nothing may print below her feet except that tab. The ground shadow hides
       inside BODY_MARKUP rather than in a layer of its own, so a "no shadow
       layer" assertion on its own would happily pass with the puddle printed. */
    Array.from(svg.querySelectorAll('*')).forEach(el => {
      if (el.closest('g[data-tab="stand"]') || typeof el.getBBox !== 'function') return;
      const b = el.getBBox();
      if (b.bottom > 314)
        fail.push(tag + ' paints below the feet (to y' + b.bottom.toFixed(0) +
                  ') - only the stand tab belongs there');
    });
  });

  /* ---------- Cut guides ---------- */
  const perItem = (slot, sel) => {
    const items = Object.keys(R.catalog[slot]).length;
    return {items, groups: list('.print-piece[data-slot="' + slot + '"] ' + sel).length};
  };
  const tops = perItem('top', 'g[data-tab="shoulders"]');
  const bottoms = perItem('bottom', 'g[data-tab="waist"]');
  if (tops.groups !== tops.items)
    fail.push('tops: ' + tops.groups + ' shoulder-tab groups for ' + tops.items + ' tops');
  if (bottoms.groups !== bottoms.items)
    fail.push('bottoms: ' + bottoms.groups + ' waist tabs for ' + bottoms.items + ' bottoms');
  ['shoes', 'swimsuit', 'extra'].forEach(slot => {
    const n = list('.print-piece[data-slot="' + slot + '"] g[data-tab]').length;
    if (n) fail.push(slot + ': should carry no fold tabs, found ' + n);
  });
  const tabGroups = list('g[data-tab]').length;
  const folds = list('g[data-tab] [stroke-dasharray]').length;
  if (!tabGroups) fail.push('no fold tabs anywhere');
  if (folds < tabGroups) fail.push('tabs without a dashed fold line: ' + folds + ' of ' + tabGroups);
  list('g[data-tab="shoulders"]').forEach(g => {
    const b = g.getBBox();
    if (b.y > 168 || b.height < 8)
      fail.push('a shoulder tab sits at y' + b.y.toFixed(0) + ' - it must be above the shoulder line');
  });

  notes.scaleMmPerUnit = k;
  notes.dollHeightMm = dolls.length ? mm(dolls[0].style.height) : 0;
  notes.tallestPieceMm = +Math.max(0, ...pieces.map(svg => mm(svg.style.height))).toFixed(2);
  notes.pages = list('.print-page').length;
  notes.groups = list('.print-group-title').map(h => h.textContent);
  notes.howTo = list('.print-how li').map(li => li.textContent);
  notes.belongs = (sheet.querySelector('.print-belongs') || {}).textContent || '';
  if (notes.pages !== window.PrintDolls.summary().sheets)
    fail.push('sheet has ' + notes.pages + ' page sections, summary says ' + window.PrintDolls.summary().sheets);
  if (notes.tallestPieceMm > 120)
    fail.push('a piece prints ' + notes.tallestPieceMm + 'mm tall - it will not fit the sheet');
  if (notes.dollHeightMm > 150)
    fail.push('the doll prints ' + notes.dollHeightMm + 'mm tall - it must stay under 150mm so the how-to, one doll and the belongs-to line fit page 1');
  if (notes.groups.length !== SLOTS.length)
    fail.push('expected a heading per slot, got ' + notes.groups.join(' | '));
  if (notes.howTo.length < 4) fail.push('the sheet lost its how-to steps');
  if (!/belongs to/.test(notes.belongs)) fail.push('the sheet lost its "belongs to" line');
  return {fail, notes, counts: {dolls: dolls.length, pieces: pieces.length, wantPieces: wantPieces}};
}"""


def fresh_page(browser, url):
    context = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
    page = context.new_page()
    errors, external = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("request", lambda r: external.append(r.url)
            if not r.url.startswith(("http://localhost", "http://127.0.0.1", "data:", "blob:")) else None)
    page.goto(url, wait_until="networkidle")
    if page.locator("#welcome-start").count():
        page.locator("#welcome-start").click()
        page.wait_for_timeout(50)
    return context, page, errors, external


def open_sheet(page):
    page.evaluate("window.GameUI.showScreen('wardrobe')")
    button = page.locator("#wardrobe-print")
    expect(button).to_be_visible()
    expect(button).to_have_text(re.compile("Print paper dolls"))
    sheet = page.locator("#print-sheet")
    expect(sheet).to_be_hidden()                       # must not leak onto the screen
    energy_before = page.evaluate("GameState.getEnergy()")
    worn_hair_before = page.evaluate("GameState.getOutfit().hair")
    button.click()
    expect(sheet).to_be_visible()
    assert page.evaluate("GameState.getEnergy()") == energy_before, "printing must be free"
    return sheet, worn_hair_before


def hair_picker(page, worn_hair_before):
    swatches = page.locator("#print-hair-choice button")
    available = page.evaluate("Object.keys(CharacterRenderer.catalog.hair).length")
    assert swatches.count() == available, f"hair picker shows {swatches.count()} of {available} styles"
    assert page.locator('#print-hair-choice button[aria-pressed="true"]').count() == 1, \
        "exactly one hairstyle should be chosen by default"
    doll = page.locator(".print-doll svg").first
    before = doll.evaluate("svg => svg.querySelector('[data-layer=\"hair-front\"]').innerHTML")
    wanted = page.evaluate(
        "() => Array.from(document.querySelectorAll('#print-hair-choice button'))"
        ".find(b => b.getAttribute('aria-pressed') !== 'true').dataset.hairId")
    page.locator(f'#print-hair-choice button[data-hair-id="{wanted}"]').click()
    after = doll.evaluate("svg => svg.querySelector('[data-layer=\"hair-front\"]').innerHTML")
    assert after != before, f"choosing {wanted} did not re-hair the printed doll"
    assert page.locator(f'#print-hair-choice button[data-hair-id="{wanted}"][aria-pressed="true"]').count() == 1
    assert page.evaluate("GameState.getOutfit().hair") == worn_hair_before, \
        "the print sheet must not change what Lily actually wears in the game"


def print_isolation(page):
    page.emulate_media(media="print")
    for sel in ("header", "nav", "#screen-wardrobe", "#talk-bubble", "#beach-scene", ".print-toolbar"):
        loc = page.locator(sel)
        if loc.count():
            assert not loc.first.is_visible(), f"{sel} must not reach the printer"
    assert page.locator("#print-sheet").is_visible(), "the sheet itself must print"
    assert page.locator(".print-page").count() == page.evaluate("PrintDolls.summary().sheets"), \
        "the dolls get their own sheet page, then the wardrobe flows"


def pdf_page_count(page, output):
    # pdf() renders with whatever media is emulated, and the print rules are the
    # whole point: under screen styles the sheet is a fixed overlay, so Chromium
    # would clip it to a single viewport-height page.
    page.emulate_media(media="print")
    try:
        pdf = page.pdf(format="Letter", print_background=True,
                       margin={"top": "12.7mm", "bottom": "12.7mm", "left": "12.7mm", "right": "12.7mm"})
    finally:
        page.emulate_media(media="screen")
    (output / "paper-dolls.pdf").write_bytes(pdf)
    assert len(pdf) > 20000, f"PDF is implausibly small ({len(pdf)} bytes)"
    counts = [int(m) for m in re.findall(rb"/Count (\d+)", pdf)]
    assert counts, "no page count found in the PDF"
    return max(counts)


def viewport_matrix(browser, url):
    """The print UI must stay usable on the same viewports the game supports.
    wardrobe_test.py has a matrix like this, but its beach step fails first, so
    the print sheet needs its own or nothing would ever catch an overflow."""
    results = {}
    for name, width, height in (("phone", 390, 740), ("small", 320, 568), ("landscape", 1024, 600)):
        context = browser.new_context(viewport={"width": width, "height": height})
        page = context.new_page()
        try:
            page.goto(url, wait_until="networkidle")
            if page.locator("#welcome-start").count():
                page.locator("#welcome-start").click()
            page.evaluate("GameUI.showScreen('wardrobe')")
            heading = page.evaluate("""() => {
              const h = document.querySelector('.wardrobe-heading');
              const r = document.getElementById('wardrobe-print').getBoundingClientRect();
              return {overflow: h.scrollWidth > h.clientWidth + 1,
                      button: [Math.round(r.width), Math.round(r.height)],
                      onScreen: r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1};
            }""")
            assert not heading["overflow"], f"{name}: the wardrobe heading overflows once the print button is there"
            assert heading["onScreen"], f"{name}: the print button is off screen"
            assert heading["button"][1] >= 44, f"{name}: print button is only {heading['button'][1]}px tall"

            page.evaluate("PrintDolls.open()")
            sheet = page.evaluate("""() => {
              const s = document.getElementById('print-sheet');
              const tb = s.querySelector('.print-toolbar');
              const strip = document.getElementById('print-hair-choice');
              const rect = el => el.getBoundingClientRect();
              const go = rect(document.getElementById('print-go'));
              const close = rect(document.getElementById('print-close'));
              const last = rect(strip.lastElementChild);
              return {open: !s.hasAttribute('hidden'),
                      toolbarOverflow: tb.scrollWidth > tb.clientWidth + 1,
                      hairOverflow: strip.scrollWidth > strip.clientWidth + 1,
                      go: [Math.round(go.width), Math.round(go.height)],
                      goOnScreen: go.right <= innerWidth + 1 && go.width >= 44,
                      closeOnScreen: close.right <= innerWidth + 1 && close.width >= 44,
                      lastHairOnScreen: last.right <= innerWidth + 1 && last.bottom <= innerHeight + 1,
                      chips: strip.children.length,
                      /* Truncation lives on the label span, not the button box. */
                      truncated: Array.from(strip.querySelectorAll('.print-hair-name'))
                        .filter(el => el.scrollWidth > el.clientWidth + 1)
                        .map(el => el.textContent)};
            }""")
            for key in ("toolbarOverflow", "hairOverflow"):
                assert not sheet[key], f"{name}: print toolbar {key}"
            for key in ("goOnScreen", "closeOnScreen"):
                assert sheet[key], f"{name}: {key} failed ({sheet['go']}px)"
            assert sheet["lastHairOnScreen"], f"{name}: the last hairstyle chip is pushed off screen"
            assert not sheet["truncated"], f"{name}: hairstyle labels truncated: {sheet['truncated']}"
            results[name] = {"heading": heading, "sheet": sheet}
        finally:
            context.close()
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8123", help="Running game server URL")
    parser.add_argument("--output", default="/tmp/kilo/print-paper-dolls", help="Evidence directory")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = None
        try:
            context, page, errors, external = fresh_page(browser, args.url)
            _, worn_hair_before = open_sheet(page)

            report = page.evaluate(CONTRACTS)
            for line in report["fail"]:
                print("FAIL:", line)
            assert not report["fail"], f"{len(report['fail'])} paper-doll violation(s)"

            hair_picker(page, worn_hair_before)
            summary = page.evaluate("PrintDolls.summary()")
            print_isolation(page)

            pages = pdf_page_count(page, output)
            assert pages == summary["pages"], \
                f"the sheet promises about {summary['pages']} {summary['paper']} pages but the PDF " \
                f"came out {pages} - update PAGES_ESTIMATE only if that is the layout you want"

            page.locator("#print-close").click()
            expect(page.locator("#print-sheet")).to_be_hidden()
            assert page.evaluate("document.body.classList.contains('print-dolls-open')") is False, \
                "closing must drop the print class"
            assert page.evaluate("document.activeElement.id") == "wardrobe-print", \
                "closing should hand focus back to the print button"

            # Fresh contexts: the sheet is a fixed overlay on the same page.
            viewports = viewport_matrix(browser, args.url)

            (output / "print-results.json").write_text(json.dumps(
                {"summary": summary, "notes": report["notes"], "pdfPages": pages,
                 "viewports": viewports}, indent=2) + "\n")
            assert not errors, errors
            assert not external, external
            print(f"PASS: paper dolls - {summary['dolls']} dolls + {summary['pieces']} pieces on "
                  f"{pages} {summary['paper']} pages at {report['notes']['scaleMmPerUnit']:.4f} mm/unit "
                  f"({', '.join(f'{k}: {v["sheet"]["chips"]} chips ok' for k, v in viewports.items())}); "
                  f"evidence -> {output / 'print-results.json'}")
        finally:
            if context:
                context.close()
            browser.close()


if __name__ == "__main__":
    main()
