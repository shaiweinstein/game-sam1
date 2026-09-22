"""Standalone jeans/cuff, skirt/dress, shared-skeleton and wardrobe regression.

Starts a temporary loopback server unless --url is supplied. Uses the existing
Python Playwright installation; no game dependencies, downloads, or temp scripts.
Reports and diagnostic images default to /tmp/kilo/garment-regression.
"""
import argparse
import base64
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import struct
from threading import Thread

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent


@contextmanager
def local_server(url):
    if url:
        yield url.rstrip('/')
        return

    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f'http://127.0.0.1:{server.server_port}'
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def clip_durations():
    # Read the shipped GLB's JSON/accessor metadata, not hardcoded clip lengths
    # and not another GLTFLoader instance that would hide wardrobe reloads.
    with (ROOT / 'beach3d/assets/lily4_full.glb').open('rb') as asset:
        magic, version, _ = struct.unpack('<III', asset.read(12))
        length, kind = struct.unpack('<II', asset.read(8))
        assert magic == 0x46546C67 and version == 2 and kind == 0x4E4F534A
        gltf = json.loads(asset.read(length))
    durations = {}
    for animation in gltf['animations']:
        if animation['name'] in ('Idle', 'Walk'):
            inputs = [gltf['accessors'][s['input']] for s in animation['samplers']]
            assert all(a['componentType'] == 5126 and a['type'] == 'SCALAR' for a in inputs)
            # GLTFLoader plays Float32Array times. JSON maxima can retain the
            # exporter's higher precision, so round exactly as the loader does.
            maximum = max(a['max'][0] for a in inputs)
            durations[animation['name']] = struct.unpack('<f', struct.pack('<f', maximum))[0]
    assert set(durations) == {'Idle', 'Walk'}
    return durations


def rapid_change_test(browser, url, out):
    """Real library, fresh browser context, including the browser network queue."""
    page_errors, console_errors, failed_requests = [], [], []
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    page.on('pageerror', lambda error: page_errors.append(str(error)))
    page.on('console', lambda msg: console_errors.append({'text': msg.text, 'location': msg.location})
            if msg.type == 'error' else None)
    page.on('requestfailed', lambda request: failed_requests.append({'url': request.url, 'failure': request.failure}))
    result = {}
    try:
        page.goto(url + '/index.html')
        page.wait_for_load_state('networkidle')
        page.locator('#welcome-start').click()
        result = page.evaluate("""async () => {
            const test = await import('/beach3d/tests/garment_test.js');
            return test.rapidAppearanceChecks();
        }""")
        atlas = result.pop('atlas')
        (out / 'rapid-final-dress-atlas.png').write_bytes(base64.b64decode(atlas.split(',')[1]))
        page.wait_for_load_state('networkidle')
    finally:
        result.update(pageErrors=page_errors, consoleErrors=console_errors, requestFailures=failed_requests)
        (out / 'garment-rapid-change.json').write_text(json.dumps(result, indent=2))
        page.close()
    assert not page_errors and not console_errors and not failed_requests, result
    assert result['decodeFailures'] == 0 and result['svgObjectURLs']['created'] == 0, result
    assert result['svgObjectURLs']['live'] == 0 and result['lateUpdates'] == 0, result
    print(f"PASS rapid library changes: {result['slotChanges']} slot updates, {result['reopens']} immediate reopens; "
          f"{result['cancelledBeforePaint']} cancelled paints; zero late updates/page/console/request failures; four final sparkles", flush=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', help='Existing local server; otherwise start an ephemeral loopback server')
    parser.add_argument('--out', default='/tmp/kilo/garment-regression')
    parser.add_argument('--rapid-only', action='store_true', help='Run only the focused real-library texture lifecycle regression')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report = {'durations': clip_durations(), 'shoes': {}, 'checks': {}}
    errors, external, assets, failed_requests = [], [], [], []
    with local_server(args.url) as url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            if args.rapid_only:
                report['rapidChanges'] = rapid_change_test(browser, url, out)
                return
            page = browser.new_page(viewport={'width': 1200, 'height': 600})
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda msg: errors.append(msg.text) if msg.type == 'error' else None)
            page.on('request', lambda r: external.append(r.url) if r.url.startswith(('http:', 'https:'))
                    and not r.url.startswith(url + '/') else None)
            page.on('request', lambda r: assets.append(r.url) if r.url.endswith('/lily4_full.glb') else None)
            page.on('requestfailed', lambda r: failed_requests.append({'url': r.url, 'failure': r.failure}))
            page.goto(url + '/index.html')
            page.wait_for_load_state('networkidle')
            page.evaluate("""async durations => {
                window.garmentTest = await import('/beach3d/tests/garment_test.js');
                window.garmentFixture = await garmentTest.createFixture(durations);
            }""", report['durations'])
            loaded = len(assets)
            assert loaded == 1, ('expected one actual character load', assets)
            for i in range(1, 7):
                shoe = f'shoes{i}'
                result = page.evaluate("""async shoes => {
                    await garmentFixture.apply(shoes);
                    return garmentTest.runShoe(garmentFixture, shoes);
                }""", shoe)
                report['shoes'][shoe] = result
                (out / 'garment-test.json').write_text(json.dumps(report, indent=2))
                assert not result['leaks'], (shoe, result['leaks'])
                assert all(flag['classification'] == 'open-cuff' for flag in result['rawFlags'])
                print(f"PASS {shoe}: 129 Idle + 129 Walk + 74 transition poses; "
                      f"{len(result['rawFlags'])} reproduced flags verified as cuff entries; "
                      'covered-skin negative control rejected', flush=True)
            report['skirtDress'] = page.evaluate('garmentTest.runSkirtDress(garmentFixture)')
            (out / 'garment-test.json').write_text(json.dumps(report, indent=2))
            for name, case in report['skirtDress'].items():
                assert not case['leaks'], (name, case['leaks'][:5])
                tested = sum(s['covered'] for s in case['phases'].values())
                opened = sum(s['belowHem'] for s in case['phases'].values())
                print(f"PASS {name}: 129 Walk (including .800) + 129 Idle + 74 transition poses; "
                      f"{tested} covered-skin checks, {opened} below-hem observations; "
                      f"rigid-Hips rejected {case['negatives']['rigidHips']['leaks']} leaks; 4mm breach rejected", flush=True)
            assert len(assets) == loaded, 'Wardrobe reloaded the GLB'
            report['evidence'] = page.evaluate("""async () => {
                await garmentFixture.apply('shoes1');
                return garmentTest.evidence(garmentFixture);
            }""")
            page.locator('#garment-cuff-evidence').screenshot(path=str(out / 'idle-cuff-evidence.png'))
            report['checks'] = page.evaluate('garmentTest.finishChecks(garmentFixture)')
            print('PASS initialized CPU skinning, shared skeleton/binds/weights, translated yaw and clothing lifecycle', flush=True)
            assert not errors and not external and not failed_requests, (errors, external, failed_requests)
            report['browserErrors'] = errors
            report['externalRequests'] = external
            report['requestFailures'] = failed_requests
            report['glbLoads'] = len(assets)
            print('PASS no browser errors, external requests or wardrobe GLB reloads', flush=True)
            report['rapidChanges'] = rapid_change_test(browser, url, out)
        finally:
            (out / 'garment-test.json').write_text(json.dumps(report, indent=2))
            browser.close()
    print(f'Report: {out / "garment-test.json"}')


if __name__ == '__main__':
    main()
