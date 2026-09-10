"""Focused mobile Catch wave regression; use the existing localhost:8123 server.

Run: /tmp/kilo/venv/bin/python -B beach3d/surf_touch_test.py
Only placement/spawn use QA hooks. Taps use touchscreen.tap and holds use CDP
Input.dispatchTouchEvent. Blur/hidden are explicit lifecycle-event fixtures;
lost capture releases a real native pointer capture. No runtime source rewrites
beyond ground_contact_test.enter's existing world/character exposure fixture.
"""
import argparse
import json
from pathlib import Path
import time
import traceback

from playwright.sync_api import sync_playwright
from ground_contact_test import enter


WAVE = '[data-activity-id="surfwave"]'
OBSERVE = """() => {
    window.surfTouchEvents = [];
    window.surfTouchSpeech = [];
    for (const type of ['pointerdown', 'pointerup', 'pointercancel',
                        'gotpointercapture', 'lostpointercapture', 'click']) {
        document.addEventListener(type, e => {
            const id = e.target.closest?.('[data-activity-id]')?.dataset.activityId;
            if (id === 'surfwave') surfTouchEvents.push({type, id: e.pointerId,
                detail: e.detail, trusted: e.isTrusted, pointerType: e.pointerType,
                surf: type === 'pointerdown' ? window.__beach3d?.surf() : undefined});
        }, true);
    }
    // Observe speech calls, not DOM mutations (identical hints can be coalesced).
    const say = BeachScene.say;
    BeachScene.say = function(text) {
        surfTouchSpeech.push(text);
        return say.apply(this, arguments);
    };
}"""


def require(ok, message, detail=None):
    if not ok:
        raise AssertionError(f"{message}: {json.dumps(detail)}")


class Touch:
    def __init__(self, page):
        self.page = page
        self.cdp = page.context.new_cdp_session(page)
        self.active = False
        self.x = self.y = 0

    def send(self, kind, x=None, y=None):
        if x is not None:
            self.x, self.y = x, y
        points = [] if kind in ('touchEnd', 'touchCancel') else [
            {'x': self.x, 'y': self.y, 'id': 1, 'radiusX': 3, 'radiusY': 3, 'force': 1}]
        self.cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})
        self.active = bool(points)

    def down(self):
        x, y = center(self.page, WAVE)
        self.send('touchStart', x, y)

    def cancel(self):
        if self.active:
            self.send('touchCancel')


def center(page, selector):
    button = page.locator(selector)
    button.scroll_into_view_if_needed()
    box = button.bounding_box()
    require(box is not None, 'Touch target has no bounding box', selector)
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    hit = page.evaluate('''p => {
        const hit = document.elementFromPoint(p.x, p.y);
        return {matches: !!hit?.closest(p.selector), element:hit?.outerHTML.slice(0, 300),
            viewport:{width:visualViewport.width, height:visualViewport.height,
                offsetLeft:visualViewport.offsetLeft, offsetTop:visualViewport.offsetTop}};
    }''', {'x': x, 'y': y, 'selector': selector})
    require(hit['matches'], 'Touch target is obscured or outside viewport', {'box': box, 'hit': hit})
    return x, y


def tap(page, selector):
    page.touchscreen.tap(*center(page, selector))


def surf(page):
    return page.evaluate('__beach3d.surf()')


def armed(page, expected):
    page.wait_for_function('v => __beach3d.surf()?.armed === v', arg=expected, timeout=1500)


def start(page):
    tap(page, '[data-activity-id="surfcatch"]')
    page.wait_for_function('__beach3d.surf()?.enabled')
    require(page.locator(WAVE).count() == 1, 'Start must register exactly one Catch wave button')
    page.wait_for_function('!document.querySelector(\'' + WAVE + '\').disabled')


def nearby(page):
    # Never move/rewind a live wave. Place the swimmer by its current crest, or
    # spawn a genuine sea-origin wave and let the native update loop advance it.
    page.evaluate('''() => {
        const s = __beach3d.surf();
        if (s.crestZ === null) {
            if (!__beach3d.surfWave(0)) throw Error('QA sea-origin wave spawn failed');
        } else __beach3d.teleport(0, Math.max(-9.4, s.crestZ));
    }''')
    page.wait_for_function('__beach3d.surf().canCatch', timeout=7000)


def released_does_not_catch(page):
    armed(page, False)
    require(not page.locator(WAVE).evaluate('(b) => b.classList.contains("is-held")'),
            'Release left held visual state')
    nearby(page)
    page.wait_for_timeout(250)
    require(not surf(page)['riding'] and not surf(page)['armed'],
            'Released input auto-caught the next catchable wave', surf(page))


def reopen(page):
    if page.evaluate('Beach3D.isOpen()'):
        tap(page, '#beach-close')
    tap(page, '#beach-play-button')
    page.wait_for_function('__beach3d.state()?.boat?.ready && __beach3d.state()?.surf?.ready')
    require(page.evaluate('__beach3d.waitReady()'), 'Reopened swimmer failed to load')
    page.evaluate('document.activeElement?.blur(); surfTouchEvents.length = surfTouchSpeech.length = 0')


def visibility(page, hidden):
    # Headless Chromium tabs do not reliably become hidden on bringToFront.
    # Exercise the shipped visibilitychange handler with a reversible fixture.
    page.evaluate('''hidden => {
        if (hidden) {
            Object.defineProperty(document, 'hidden', {configurable: true, value: true});
            Object.defineProperty(document, 'visibilityState', {configurable: true, value: 'hidden'});
        } else {
            delete document.hidden; delete document.visibilityState;
        }
        document.dispatchEvent(new Event('visibilitychange'));
    }''', hidden)


def lifecycle_visibility(page, touch):
    require(page.locator(WAVE).count() == 0, 'Catch wave exists before Start surfing')
    start(page)
    touch.down()
    armed(page, True)
    # Keyboard activates Stop without replacing the still-held native pointer.
    page.locator('[data-activity-id="surfcatch"]').focus()
    page.keyboard.press('Enter')
    require(page.locator(WAVE).count() == 0 and not surf(page)['armed']
            and not surf(page)['enabled'], 'Stop did not remove/disarm Catch wave', surf(page))
    touch.cancel()


def native_tap(page, touch):
    start(page)
    point = center(page, WAVE)
    nearby(page)
    # Resolve/scroll the target before the short-lived catch window opens.
    page.touchscreen.tap(*point)
    page.wait_for_function('__beach3d.surf().riding')
    page.wait_for_function('document.querySelector(\'' + WAVE + '\').disabled')
    require(page.evaluate('surfTouchEvents.some(e => e.type === "pointerdown" && '
                          'e.trusted && e.pointerType === "touch")'), 'Tap was not native touch')
    page.wait_for_function('__beach3d.surf().counter === 1 && !__beach3d.surf().riding', timeout=16000)
    require(page.evaluate('surfTouchSpeech.filter(s => s.startsWith("WOOHOO!")).length') == 1,
            'Single native tap produced duplicate successful catches')
    require(not surf(page)['armed'], 'Tap remained armed after landing', surf(page))


def early_hold(page, touch):
    start(page)
    page.evaluate('__beach3d.teleport(0, -8.7)')
    before = surf(page)
    require(before['crestZ'] is None and not before['canCatch'], 'Early-hold fixture was not early', before)
    touch.down()
    armed(page, True)
    page.wait_for_function('__beach3d.surf().riding', timeout=8000)
    require(surf(page)['spawnCount'] == before['spawnCount'] + 1,
            'Hold did not catch the next naturally spawned wave', surf(page))
    require(page.evaluate('__beach3d.input().pointer === null && __qaChar.loco.target === null'),
            'Activity hold leaked into canvas locomotion')
    # Advance the live ride past its first update: catching must not silently
    # disable/release an existing finger, even though new presses are gated.
    page.wait_for_timeout(300)
    held = page.locator(WAVE).evaluate('''b => ({surf:__beach3d.surf(),
        disabled:b.disabled, heldClass:b.classList.contains('is-held'),
        captured:b.hasPointerCapture(surfTouchEvents.findLast(e => e.type === 'pointerdown').id)})''')
    require(held['surf']['riding'] and held['surf']['armed'] and held['heldClass']
            and held['captured'] and not held['disabled'],
            'Existing native hold was lost when the wave became active', held)
    touch.send('touchMove', 4, 4)
    armed(page, True)
    touch.send('touchEnd')
    armed(page, False)
    require(surf(page)['riding'], 'Releasing the finger unexpectedly ended the ride', surf(page))
    page.wait_for_function('document.querySelector(\'' + WAVE + '\').disabled')
    require(not page.locator(WAVE).evaluate('(b) => b.classList.contains("is-held")'),
            'Physical release retained the held visual state')
    require(page.evaluate('surfTouchEvents.some(e => e.type === "pointerup" && e.trusted)'),
            'Ride hold did not end through a native pointerup')
    tap(page, WAVE)
    armed(page, False)
    require(page.evaluate('surfTouchSpeech.filter(s => s.startsWith("WOOHOO!")).length') == 1,
            'New button press during an active ride duplicated the catch')
    return {'held_during_ride': held, 'after_release_and_new_press': surf(page)}


def release_case(page, touch, kind):
    start(page)
    touch.down()
    armed(page, True)
    if kind == 'outside':
        touch.send('touchMove', 4, 4)
        touch.send('touchEnd')
    elif kind == 'pointercancel':
        touch.cancel()
        require(page.evaluate('surfTouchEvents.some(e => e.type === "pointercancel" && e.trusted)'),
                'CDP cancellation did not deliver a native pointercancel')
    elif kind == 'lostcapture':
        # Touch slop can suppress tiny pointermoves. Establish pending capture
        # first, then release it and send a distinct native move to flush loss.
        touch.send('touchMove', touch.x + 18, touch.y)
        page.wait_for_function('surfTouchEvents.some(e => e.type === "gotpointercapture")')
        page.evaluate('''() => {
            const b = document.querySelector('[data-activity-id="surfwave"]');
            const id = surfTouchEvents.findLast(e => e.type === 'pointerdown').id;
            if (!b.hasPointerCapture(id)) throw Error('Native pointer was not captured');
            b.releasePointerCapture(id);
        }''')
        touch.send('touchMove', touch.x + 18, touch.y)
        page.wait_for_function('surfTouchEvents.some(e => e.type === "lostpointercapture" && e.trusted)')
    elif kind == 'blur':
        page.evaluate('window.dispatchEvent(new Event("blur"))')
    elif kind == 'hidden':
        visibility(page, True)
        armed(page, False)
        visibility(page, False)
    released_does_not_catch(page)


def independent_holds(page, touch):
    start(page)
    page.evaluate('document.activeElement?.blur()')
    for release_first in ('Space', 'button'):
        page.keyboard.down('Space')
        touch.down()
        armed(page, True)
        if release_first == 'Space':
            page.keyboard.up('Space')
            armed(page, True)
            touch.cancel()
        else:
            touch.cancel()
            armed(page, True)
            page.keyboard.up('Space')
        armed(page, False)
    released_does_not_catch(page)


def pointer_click(page, touch):
    start(page)
    page.evaluate('surfTouchSpeech.length = surfTouchEvents.length = 0')
    tap(page, WAVE)  # On sand: both down and compatibility click can give hints.
    page.wait_for_timeout(150)
    events = page.evaluate('surfTouchEvents')
    require(any(e['type'] == 'click' and e['trusted'] and e['detail'] > 0 for e in events),
            'Fixture did not deliver a native pointer-generated click', events)
    hints = page.evaluate('surfTouchSpeech.filter(s => s.startsWith("Swim farther out")).length')
    require(hints == 1, 'Pointer-generated click duplicated or lost the catch request',
            {'hints': hints, 'events': events})
    released_does_not_catch(page)


def keyboard(page, touch, kind):
    if kind != 'global-space':
        start(page)
    nearby(page)
    if kind == 'accessible-click':
        page.locator(WAVE).evaluate('(b) => b.click()')  # AT detail=0 activation.
    elif kind == 'global-space':
        page.evaluate('document.activeElement?.blur()')
        page.keyboard.down('Space')
        page.wait_for_function('__beach3d.surf().riding')
        page.keyboard.up('Space')
    else:
        page.locator(WAVE).focus()
        page.keyboard.press(kind)
    page.wait_for_function('__beach3d.surf().riding')
    armed(page, False)
    require(page.evaluate('surfTouchSpeech.filter(s => s.startsWith("WOOHOO!")).length') == 1,
            'Keyboard/AT activation did not catch exactly once', kind)


def reopen_handlers(page, touch):
    for visit in range(2):
        start(page)
        touch.down()
        armed(page, True)
        page.locator('#beach-close').focus()
        page.keyboard.press('Enter')
        require(page.evaluate('__beach3d.surf() === null') and page.locator(WAVE).count() == 0,
                'Close retained surf state/control', visit)
        touch.cancel()
        reopen(page)
        require(page.locator(WAVE).count() == 0 and not surf(page)['armed'],
                'Reopen inherited a held button', visit)
        start(page)
        page.evaluate('surfTouchSpeech.length = 0')
        tap(page, WAVE)
        require(page.evaluate('surfTouchSpeech.filter(s => s.startsWith("Swim farther out")).length') == 1,
                'Reopened native tap has stale or duplicate handlers', visit)
        touch.down()
        armed(page, True)
        touch.cancel()
        armed(page, False)
        tap(page, '[data-activity-id="surfcatch"]')


def gates(page, touch):
    start(page)
    touch.down()
    armed(page, True)
    require(page.evaluate('__beach3d.boatBoard()'), 'Boat fixture failed to board')
    require(page.locator(WAVE).count() == 0 or page.locator(WAVE).is_disabled(),
            'Catch wave remains actionable during boat ride')
    armed(page, False)
    require(not page.evaluate('__beach3d.surfCatch() || __beach3d.catchStart()'),
            'Boat failed to gate wave/ball catch')
    page.evaluate('document.activeElement?.blur()')
    page.keyboard.press('Space')
    require(not surf(page)['riding'] and not surf(page)['armed'], 'Space acted during boat ride')
    touch.cancel()
    reopen(page)
    start(page)
    touch.down()
    armed(page, True)
    page.get_by_role('button', name='Play catch', exact=True).focus()
    page.keyboard.press('Enter')
    require(not surf(page)['enabled'] and not surf(page)['armed'] and page.locator(WAVE).count() == 0,
            'Starting ball catch retained mobile wave input', surf(page))
    require(not page.evaluate('__beach3d.surfToggle() || __beach3d.surfCatch()'),
            'Ball catch failed to gate surfing')
    touch.cancel()
    reopen(page)
    start(page)
    point = center(page, WAVE)
    nearby(page)
    page.touchscreen.tap(*point)
    page.wait_for_function('__beach3d.surf().riding')
    require(not page.evaluate('__beach3d.boatBoard() || __beach3d.catchStart()'),
            'Riding wave failed to gate boat/ball catch')


def activity_faults(page, touch):
    # Public-registry fixtures only: throwing neighboring controls must not
    # prevent Catch wave mounting, or stop its cleanup from releasing a hold.
    page.evaluate('''() => {
        window.surfTouchFaultCalls = {mount:0, cleanup:0};
        window.surfTouchFaults = [
            {id:'surf-touch-mount-fault', label:'QA mount', modes:['sand'], onClick(){},
                mount(){ surfTouchFaultCalls.mount++; throw Error('Expected QA mount failure'); }},
            {id:'surf-touch-cleanup-fault', label:'QA cleanup', modes:['sand'], onClick(){},
                mount(){ return () => {
                    surfTouchFaultCalls.cleanup++; throw Error('Expected QA cleanup failure');
                }; }}
        ];
        surfTouchFaults.forEach(s => BeachScene.registerActivity(s));
    }''')
    try:
        start(page)
        require(page.locator('#beach-swim-style').count() == 1,
                'Faulting activity prevented rendering the rest of the action bar')
        touch.down()
        armed(page, True)
        page.evaluate('BeachScene.unregisterActivity(surfTouchFaults[0].id, surfTouchFaults[0])')
        armed(page, False)
        require(page.locator(WAVE).count() == 1 and not page.locator(WAVE).evaluate(
            '(b) => b.classList.contains("is-held")'),
            'Earlier cleanup exception prevented Catch wave hold cleanup/remount')
        touch.cancel()
        page.evaluate('surfTouchSpeech.length = 0')
        tap(page, WAVE)
        require(page.evaluate('surfTouchSpeech.filter(s => s.startsWith("Swim farther out")).length') == 1,
                'Mount/cleanup exception left Catch wave handlers missing or duplicated')
        calls = page.evaluate('surfTouchFaultCalls')
        require(calls['mount'] > 0 and calls['cleanup'] > 0, 'Fault fixtures were not exercised', calls)
        return calls
    finally:
        page.evaluate('surfTouchFaults.forEach(s => BeachScene.unregisterActivity(s.id, s))')


def layout(page, touch):
    start(page)
    page.locator(WAVE).scroll_into_view_if_needed()
    detail = page.locator(WAVE).evaluate('''b => {
        const r = b.getBoundingClientRect(), bar = b.closest('#beach-actions');
        const a = bar.getBoundingClientRect(), v = visualViewport;
        return {width:r.width, height:r.height, left:r.left, right:r.right,
            top:r.top, bottom:r.bottom, viewportWidth:v.width, viewportHeight:v.height,
            barTop:a.top, barBottom:a.bottom, barWidth:bar.clientWidth,
            barScrollWidth:bar.scrollWidth, pageWidth:document.documentElement.clientWidth,
            pageScrollWidth:document.documentElement.scrollWidth,
            touchAction:getComputedStyle(b).touchAction};
    }''')
    require(detail['width'] >= 44 and detail['height'] >= 44,
            'Catch wave target is smaller than 44 CSS px', detail)
    require(detail['pageScrollWidth'] <= detail['pageWidth'] + 1
            and detail['barScrollWidth'] <= detail['barWidth'] + 1
            and detail['pageWidth'] <= detail['viewportWidth'] + 1,
            'Page/activity bar has horizontal overflow', detail)
    require(detail['left'] >= 0 and detail['right'] <= detail['viewportWidth'] + 1
            and detail['top'] >= max(0, detail['barTop']) - 1
            and detail['bottom'] <= min(detail['viewportHeight'], detail['barBottom']) + 1,
            'Catch wave is clipped/unreachable after normal scroll-into-view', detail)
    require(detail['touchAction'] == 'none', 'Catch wave hold permits native pan cancellation', detail)
    tap(page, WAVE)
    require(not surf(page)['armed'], 'Reachable mobile tap did not release')
    return detail


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='/tmp/kilo/surf-touch')
    parser.add_argument('--case', help='Run only case names containing this substring')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {'results': [], 'browser_errors': [], 'notes': [
        'Native CDP touch holds and touchscreen.tap; no surf state/clock patching.',
        'Fault isolation uses throwing activity callbacks registered through the public API.',
        'Blur and document.hidden/visibilitychange use synthetic lifecycle fixtures.']}
    started = time.monotonic()
    cases = [('visibility-start-stop', lifecycle_visibility), ('native-tap-catches-once', native_tap),
             ('early-hold-natural-wave', early_hold)]
    cases += [(f'release-{kind}', lambda p, t, k=kind: release_case(p, t, k))
              for kind in ('outside', 'pointercancel', 'lostcapture', 'blur', 'hidden')]
    cases += [('independent-space-button', independent_holds), ('pointer-click-no-duplicate', pointer_click)]
    cases += [(f'keyboard-{kind}', lambda p, t, k=kind: keyboard(p, t, k))
              for kind in ('accessible-click', 'Enter', 'Space', 'global-space')]
    cases += [('close-reopen-handlers', reopen_handlers), ('boat-catch-gates', gates),
              ('activity-mount-cleanup-faults', activity_faults)]
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for width, height in ((390, 740), (320, 568)):
                selected = (cases if width == 390 else []) + [(f'layout-{width}x{height}', layout)]
                selected = [(name, fn) for name, fn in selected if not args.case or args.case in name]
                if not selected:
                    continue
                context = browser.new_context(viewport={'width': width, 'height': height},
                                              has_touch=True, is_mobile=True, device_scale_factor=1)
                page = context.new_page()
                page.set_default_timeout(10000)
                current = {'case': 'setup'}
                page.on('pageerror', lambda e: report['browser_errors'].append(
                    {'case': current['case'], 'type': 'pageerror', 'message': str(e)}))
                page.on('console', lambda m: report['browser_errors'].append(
                    {'case': current['case'], 'type': 'console', 'message': m.text}) if m.type == 'error' else None)
                touch = Touch(page)
                try:
                    enter(page)
                    page.evaluate(OBSERVE)
                    for name, fn in selected:
                        current['case'] = name
                        row = {'name': name, 'viewport': [width, height], 'pass': False}
                        report['results'].append(row)
                        tick = time.monotonic()
                        try:
                            reopen(page)
                            row['detail'] = fn(page, touch)
                            row['pass'] = True
                        except Exception as exc:
                            row['error'] = str(exc)
                            row['traceback'] = traceback.format_exc()
                        finally:
                            try:
                                row['state'] = page.evaluate('({surf:__beach3d.surf(), boat:__beach3d.boat(), '
                                    'input:__beach3d.input(), events:surfTouchEvents, speech:surfTouchSpeech})')
                                shot = out / f'{name}.png'
                                page.screenshot(path=str(shot), timeout=5000)
                                row['screenshot'] = str(shot)
                            except Exception as exc:
                                row['artifact_error'] = str(exc)
                            visibility(page, False)
                            touch.cancel()
                            page.keyboard.up('Space')
                            page.keyboard.up('Enter')
                            row['seconds'] = round(time.monotonic() - tick, 2)
                            print(('PASS ' if row['pass'] else 'FAIL ') + name +
                                  (': ' + row['error'] if 'error' in row else ''), flush=True)
                            (out / 'report.json').write_text(json.dumps(report, indent=2))
                finally:
                    context.close()
        except Exception as exc:
            report['fatal_error'] = str(exc)
            report['fatal_traceback'] = traceback.format_exc()
        finally:
            browser.close()
            report['seconds'] = round(time.monotonic() - started, 2)
            report['passed'] = sum(row['pass'] for row in report['results'])
            report['failed'] = sum(not row['pass'] for row in report['results'])
            (out / 'report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != 'results'}, indent=2), flush=True)
    raise SystemExit(1 if report['failed'] or report['browser_errors'] or report.get('fatal_error') else 0)


if __name__ == '__main__':
    main()
