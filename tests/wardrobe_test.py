#!/usr/bin/env python3
"""Focused UI regression. Run with /tmp/kilo/venv/bin/python against serve.py."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright


SLOTS = ("hair", "top", "bottom", "shoes", "extra", "swimsuit")
VIEWPORTS = (("desktop", 1280, 900), ("phone", 390, 740), ("small", 320, 568),
             ("landscape", 1024, 600), ("zoom-equivalent", 640, 450))


def tab(page, slot):
    # Keyboard selection also tests roving tabs and row-only scrolling.
    page.locator('.wardrobe-tab[aria-selected="true"]').focus()
    page.keyboard.press("Home")
    for _ in range(SLOTS.index(slot)):
        page.keyboard.press("ArrowRight")
    expect(page.locator(f'#wardrobe-tab-{slot}')).to_be_focused()


def item(page, item_id):
    return page.locator(f'#wardrobe-items button[data-item-id="{item_id}"]')


def choose(page, slot, item_id):
    tab(page, slot)
    item(page, item_id).click()
    expect(item(page, item_id)).to_have_attribute("aria-pressed", "true")


def outfit(page):
    return page.evaluate("GameState.getOutfit()")


def layout(page):
    return page.evaluate("""() => {
      const box = e => {
        const r = e.getBoundingClientRect();
        return {x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom};
      };
      const stage = document.querySelector('#character-stage-wardrobe');
      const svg = stage.querySelector('svg');
      const matrix = svg.getScreenCTM(), view = svg.viewBox.baseVal;
      const ink = svg.querySelector('.character-root').getBBox();
      const panel = document.querySelector('#wardrobe-panel');
      return {viewport:[innerWidth,innerHeight], page:[document.documentElement.scrollWidth,
        document.documentElement.scrollHeight], mainScroll:document.querySelector('.game-main').scrollTop,
        stage:box(stage), svg:box(svg), art:{x:matrix.e,y:matrix.f,
          width:view.width*matrix.a,height:view.height*matrix.d,
          right:matrix.e+view.width*matrix.a,bottom:matrix.f+view.height*matrix.d},
        uniform:Math.abs(matrix.a-matrix.d)<0.001,
        inkFits:ink.x >= 0 && ink.y >= 0 && ink.x+ink.width <= view.width && ink.y+ink.height <= view.height,
        panel:box(panel),
        panelScroll:panel.scrollTop, panelScrollHeight:panel.scrollHeight,
        controls:[...document.querySelectorAll('.wardrobe-return:not([hidden]), .wardrobe-undo, .nav-button')].map(box),
        first:box(panel.querySelector('button')), last:box(panel.querySelector('button:last-child'))};
    }""")


def inside(inner, outer):
    return (inner["x"] >= outer["x"] - 1 and inner["y"] >= outer["y"] - 1 and
            inner["right"] <= outer["right"] + 1 and inner["bottom"] <= outer["bottom"] + 1)


def assert_layout(page):
    data = layout(page)
    w, h = data["viewport"]
    viewport = {"x": 0, "y": 0, "right": w, "bottom": h}
    assert data["page"] == [w, h], data
    assert data["mainScroll"] == 0, data
    assert data["uniform"] and data["inkFits"] and inside(data["art"], data["stage"]), data
    assert inside(data["stage"], viewport) and inside(data["panel"], viewport), data
    assert data["art"]["height"] >= 100, data
    for control in data["controls"]:
        assert control["width"] >= 43 and control["height"] >= 43 and inside(control, viewport), data
    return data


def layers(page, selector):
    return page.locator(selector).evaluate("""e => Object.fromEntries(
      [...e.querySelectorAll('[data-layer]')].map(g => [g.dataset.layer, g.childElementCount]))""")


def assert_clothed(page):
    for selector in ("#character-stage-kitchen", ".friend-stage", ".place-character:has(svg)"):
        for stage in page.locator(selector).all():
            painted = stage.evaluate("e => e.querySelector('[data-layer=top]').childElementCount")
            assert painted > 0, selector


def fresh_page(browser, args, width=1280, height=900, touch=False):
    context = browser.new_context(viewport={"width": width, "height": height},
                                  has_touch=touch, reduced_motion="reduce")
    page = context.new_page()
    page.set_default_timeout(15000)
    errors = []
    external = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
    page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}")
            if response.status >= 400 else None)
    host = urlparse(args.url).netloc
    page.on("request", lambda request: external.append(request.url)
            if urlparse(request.url).scheme in ("http", "https") and urlparse(request.url).netloc != host else None)
    page.goto(args.url, wait_until="networkidle")
    assert page.evaluate("typeof CharacterRenderer.renderItemPreview === 'function'"), "Renderer API not integrated"
    page.locator("#welcome-start").click()
    return context, page, errors, external


def renderer_contract(page):
    assert page.evaluate("""() => {
      const before = JSON.stringify(GameState.get()), saved = localStorage.getItem('lily-game-save-v1');
      let notifications = 0;
      const unsubscribe = GameState.onChange(() => notifications++);
      const stage = document.createElement('div');
      document.body.append(stage);
      for (const [slot, items] of Object.entries(CharacterRenderer.catalog)) {
        for (const id of Object.keys(items)) {
          CharacterRenderer.renderItemPreview(stage, slot, id, {characterId:'amara'});
          if (!stage.querySelector('svg.wardrobe-item-preview') || stage.querySelector('svg.character')) return false;
        }
      }
      const stable = before === JSON.stringify(GameState.get()) &&
        saved === localStorage.getItem('lily-game-save-v1') && notifications === 0;
      const markup = stage.innerHTML;
      GameState.setEnergy(GameState.getEnergy());
      const unregistered = stage.innerHTML === markup;
      stage.remove(); unsubscribe();
      return stable && unregistered;
    }""")


def undo_and_picker(page):
    tab(page, "hair")
    page.keyboard.press("End")
    expect(page.locator("#wardrobe-tab-swimsuit")).to_be_focused()
    page.keyboard.press("ArrowRight")
    expect(page.locator("#wardrobe-tab-hair")).to_be_focused()
    page.keyboard.press("ArrowLeft")
    expect(page.locator("#wardrobe-tab-swimsuit")).to_be_focused()
    choose(page, "top", "top3")
    choose(page, "bottom", "bottom3")
    item(page, "bottom3").click()  # Reselect must not replace the real undo.
    page.evaluate("""() => {
      window.originalTile = document.activeElement;
      window.originalArt = originalTile.querySelector('svg');
      GameState.changeEnergy(1);
    }""")
    assert page.evaluate("document.activeElement === originalTile && originalArt === originalTile.querySelector('svg')")
    tab(page, "extra")  # Undo still knows which slot changed, not the active tab.
    page.locator("#wardrobe-undo").click()
    assert outfit(page)["top"] == "top3" and outfit(page)["bottom"] == "bottom1"
    expect(page.locator("#wardrobe-undo")).to_be_disabled()
    choose(page, "extra", "extra3")
    item(page, "").click()
    assert outfit(page)["extra"] is None
    item(page, "").click()
    page.locator("#wardrobe-undo").click()
    assert outfit(page)["extra"] == "extra3"
    choose(page, "hair", "hair6")
    page.evaluate("GameState.setOutfitSlot('shoes', 'shoes2')")
    expect(page.locator("#wardrobe-undo")).to_be_disabled()
    choose(page, "top", "top4")
    page.evaluate("GameState.setCharacterId('amara')")
    expect(page.locator("#wardrobe-undo")).to_be_disabled()
    # Palette redraw must preserve the focused tile and picker scroll.
    choose(page, "hair", "hair2")
    page.evaluate("window.oldArt = document.querySelector('.wardrobe-item-art').innerHTML")
    page.evaluate("GameState.setCharacterId('mei')")
    expect(item(page, "hair2")).to_be_focused()
    assert page.evaluate("oldArt !== document.querySelector('.wardrobe-item-art').innerHTML")
    page.evaluate("GameState.reset()")
    choose(page, "top", "top3")
    choose(page, "top", "top1")  # Reset is identical to the current outfit now.
    expect(page.locator("#wardrobe-undo")).to_be_enabled()
    before_reset = page.evaluate("GameState.get()")
    assert before_reset["location"]["id"] == "home"
    reset_notification = page.evaluate("""() => {
      let notification;
      const unsubscribe = GameState.onChange((state, reason) => { notification = {state, reason}; });
      GameState.reset();
      unsubscribe();
      return notification;
    }""")
    assert page.evaluate("GameState.get()") == before_reset
    assert reset_notification == {"state": before_reset, "reason": "reset"}
    expect(page.locator("#wardrobe-undo")).to_be_disabled()
    expect(page.locator("#wardrobe-return")).to_be_hidden()
    choose(page, "bottom", "bottom7")
    saved_suit = outfit(page)["swimsuit"]
    choose(page, "top", "top2")
    tab(page, "bottom")
    expect(page.locator("#wardrobe-hint")).to_have_text("Dress covers bottoms. Choose a top.")
    assert layers(page, "#character-stage-wardrobe")["bottom"] == 0
    assert outfit(page)["bottom"] == "bottom7" and outfit(page)["swimsuit"] == saved_suit
    choose(page, "top", "top1")
    assert layers(page, "#character-stage-wardrobe")["bottom"] > 0
    assert outfit(page)["bottom"] == "bottom7"
    for remembered_slot, destination in (("shoes", "kitchen"), ("swimsuit", "friends")):
        tab(page, remembered_slot)
        page.locator(f'.nav-button[data-screen="{destination}"]').click()
        assert layers(page, "#character-stage-wardrobe")["top"] > 0
        assert_clothed(page)
        page.locator('.nav-button[data-screen="wardrobe"]').click()
        expect(page.locator(f"#wardrobe-tab-{remembered_slot}")).to_be_focused()
        expect(page.locator(f"#wardrobe-tab-{remembered_slot}")).to_have_attribute("aria-selected", "true")
        expect(page.locator("#wardrobe-return")).to_be_hidden()
        assert (layers(page, "#character-stage-wardrobe")["top"] == 0) == (remembered_slot == "swimsuit")
        assert_clothed(page)
    # Reset while away also expires the remembered category.
    page.evaluate("GameUI.showScreen('friends'); GameState.reset(); GameUI.showScreen('wardrobe')")
    expect(page.locator("#wardrobe-tab-hair")).to_be_focused()
    expect(page.locator("#wardrobe-undo")).to_be_disabled()
    expect(page.locator("#wardrobe-return")).to_be_hidden()


def beach_entry(page, move_before_change=False):
    page.locator('.nav-button[data-screen="map"]').click()
    if page.evaluate("GameState.getLocation().id") != "beach":
        page.locator('.place[data-place-id="beach"]').click()
        page.wait_for_function("GameState.getLocation().id === 'beach'")
    page.locator("#beach-play-button").click()
    shore = None
    if move_before_change:
        page.evaluate("__beach3d.waitReady()")
        page.wait_for_function("__beach3d.state()?.surf?.ready")
        shore = page.evaluate("__beach3d.state()")
        page.evaluate("__beach3d.teleport(0, -3.5)")
        page.get_by_role("button", name="Start surfing").click()
        assert page.evaluate("__beach3d.state().surf.enabled")
    page.locator('[data-activity-id="swimsuits"]').click()
    expect(page.locator("#wardrobe-tab-swimsuit")).to_be_focused()
    expect(page.locator("#wardrobe-return")).to_be_visible()
    assert not page.evaluate("BeachScene.isOpen() || Beach3D.isOpen()")
    assert page.evaluate("__beach3d.state() === null")
    expect(page.locator(".beach3d-host")).to_have_count(0)
    return shore


def navigation(page, output):
    page.evaluate("GameState.setCharacterId('amara')")
    shore = beach_entry(page, move_before_change=True)
    before = page.evaluate("GameState.get()")
    page.evaluate("""() => {
      window.travelWrites = 0;
      const setter = GameState.setLocation;
      GameState.setLocation = (...args) => { travelWrites++; return setter(...args); };
    }""")
    for suit in ("suit2", "suit3", "suit5"):
        item(page, suit).click()
        assert not page.evaluate("BeachScene.isOpen()")
    tab(page, "extra")
    expect(page.locator("#wardrobe-return")).to_be_visible()
    page.screenshot(path=str(output / "ui-beach-wardrobe.png"))
    page.locator("#wardrobe-return").click()
    expect(page.locator("#screen-map")).to_have_class("screen active")
    assert page.evaluate("BeachScene.isOpen() && BeachScene.getMode() === 'sand'")
    assert page.evaluate("travelWrites") == 0
    assert page.evaluate("GameState.getEnergy()") == before["energy"]
    assert page.evaluate("GameState.getLocation()") == before["location"]
    assert page.evaluate("Beach3D.isOpen()"), "Expected the real 3D engine for return verification"
    page.evaluate("__beach3d.waitReady()")
    appearance = page.evaluate("__beach3d.appearance()")
    assert appearance["suit"] == "suit5", appearance
    assert "amara" in json.dumps(appearance), appearance
    state = page.evaluate("__beach3d.state()")
    assert state["surf"]["counter"] == 0 and not state["surf"]["riding"], state
    assert not state["surf"]["enabled"] and (state["x"], state["z"]) == (shore["x"], shore["z"]), state
    page.screenshot(path=str(output / "ui-beach-return.png"))
    page.locator("#beach-close").click()
    expect(page.locator("#screen-map")).to_be_visible()
    page.locator('.nav-button[data-screen="wardrobe"]').click()
    expect(page.locator("#wardrobe-return")).to_be_hidden()
    expect(page.locator("#wardrobe-tab-extra")).to_have_attribute("aria-selected", "true")
    for exit_kind in ("direct", "normal", "location", "reset", "reload"):
        beach_entry(page)
        if exit_kind == "direct":
            page.evaluate("GameUI.showScreen('kitchen')")
            assert layers(page, "#character-stage-wardrobe")["top"] > 0
            assert_clothed(page)
            page.evaluate("GameUI.showScreen('wardrobe')")
        elif exit_kind == "normal":
            page.locator('.nav-button[data-screen="wardrobe"]').click()
        elif exit_kind == "location":
            page.evaluate("GameState.setLocation('home', 'Home')")
        elif exit_kind == "reset":
            page.evaluate("GameState.reset()")
        else:
            page.reload(wait_until="networkidle")
            page.locator("#welcome-continue").click()
        expect(page.locator("#wardrobe-return")).to_be_hidden()
        page.wait_for_timeout(100)  # Outlast the removed two-rAF handoff.
        expected_slot = "hair" if exit_kind in ("reset", "reload") else "swimsuit"
        expect(page.locator(f"#wardrobe-tab-{expected_slot}")).to_have_attribute("aria-selected", "true")
        assert (layers(page, "#character-stage-wardrobe")["top"] == 0) == (expected_slot == "swimsuit")
        assert_clothed(page)
    # Rapid synchronous departure cannot re-enable swimsuit preview later.
    beach_entry(page)
    page.evaluate("GameUI.showScreen('friends')")
    page.wait_for_timeout(100)
    assert layers(page, "#character-stage-wardrobe")["top"] > 0
    for screen in ("kitchen", "map", "friends", "wardrobe"):
        page.locator(f'.nav-button[data-screen="{screen}"]').click()
        expect(page.locator(f"#screen-{screen}")).to_be_visible()
    assert_clothed(page)


def viewport_matrix(browser, args, output):
    results = {}
    for name, width, height in VIEWPORTS:
        context, page, errors, external = fresh_page(browser, args, width, height, width < 600)
        try:
            results[name] = assert_layout(page)
            assert inside(results[name]["first"], results[name]["panel"]), results[name]
            if name == "desktop":
                assert results[name]["art"]["height"] > 450
            page.screenshot(path=str(output / f"ui-{name}-initial.png"))
            for slot in SLOTS:
                tab(page, slot)
                page.locator("#wardrobe-items button").last.focus()
                page.keyboard.press("Enter")
                data = assert_layout(page)
                assert inside(data["last"], data["panel"]), data
            choose(page, "hair", "hair6")
            choose(page, "shoes", "shoes2")
            choose(page, "extra", "extra3")
            assert_layout(page)
            page.screenshot(path=str(output / f"ui-{name}-sunhat.png"))
            choose(page, "extra", "extra5")
            assert_layout(page)
            page.screenshot(path=str(output / f"ui-{name}-hat.png"))
            # Native touch scroll input (not page scrolling) in phone contexts.
            if width < 600:
                tab(page, "top")
                panel = page.locator("#wardrobe-panel").bounding_box()
                cdp = context.new_cdp_session(page)
                x, y = panel["x"] + panel["width"] / 2, panel["y"] + panel["height"] - 12
                for _ in range(8):
                    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
                    for distance in (25, 50, 75):
                        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y-distance}]})
                    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
                page.wait_for_function("""() => {
                  const p = document.querySelector('#wardrobe-panel');
                  return p.scrollTop + p.clientHeight >= p.scrollHeight - 2;
                }""")
                data = assert_layout(page)
                assert inside(data["last"], data["panel"]), data
            beach_entry(page)
            results[name + "-return"] = assert_layout(page)
            page.screenshot(path=str(output / f"ui-{name}-swimsuit.png"))
            choose(page, "top", "top2")
            tab(page, "bottom")
            entry = assert_layout(page)
            assert inside(entry["first"], entry["panel"]), entry
            assert entry["first"]["width"] >= 44 and entry["first"]["height"] >= 44, entry
            if name == "small":
                assert entry["art"]["height"] >= 150, entry
                results["small-dress-entry"] = entry
                page.screenshot(path=str(output / "ui-small-dress-entry.png"))
            page.locator("#wardrobe-items button").last.focus()
            results[name + "-dress"] = assert_layout(page)
            page.screenshot(path=str(output / f"ui-{name}-dress.png"))
            assert inside(results[name + "-dress"]["last"], results[name + "-dress"]["panel"]), results[name + "-dress"]
            assert not errors, errors
            assert not external, external
        finally:
            context.close()
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8123")
    parser.add_argument("--output", default="/tmp/kilo/wardrobe-improvements")
    parser.add_argument("--layout-only", action="store_true")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            if not args.layout_only:
                context, page, errors, external = fresh_page(browser, args)
                try:
                    renderer_contract(page)
                    undo_and_picker(page)
                    navigation(page, output)
                    assert not errors, errors
                    assert not external, external
                    print("PASS: renderer, Undo, scoped previews, navigation, reset/reload, screens, network")
                finally:
                    context.close()
            results = viewport_matrix(browser, args, output)
            (output / "ui-layout.json").write_text(json.dumps(results, indent=2))
            for name, data in results.items():
                print(f"PASS: {name}: art {data['art']['width']:.0f}x{data['art']['height']:.0f}, "
                      f"picker {data['panel']['width']:.0f}x{data['panel']['height']:.0f}")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
