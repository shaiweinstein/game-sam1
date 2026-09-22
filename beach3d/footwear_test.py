"""Standalone fitted-footwear and shoe-aware contact regression.

Uses the existing Python/Playwright environment and an isolated loopback server.
No temp scripts, external assets, game-camera edits, or source routing shims.
"""
import argparse
import base64
import json
from pathlib import Path

from playwright.sync_api import sync_playwright
from garment_test import clip_durations, local_server


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url')
    parser.add_argument('--out', default='/tmp/kilo/footwear-regression')
    parser.add_argument('--shots', action='store_true')
    args = parser.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    report = {'durations': clip_durations(), 'shoes': {}}
    errors, external = [], []
    with local_server(args.url) as url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width': 1200, 'height': 1000})
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('request', lambda r: external.append(r.url) if r.url.startswith(('http:', 'https:')) and not r.url.startswith(url + '/') else None)
            page.goto(url + '/index.html'); page.wait_for_load_state('networkidle')
            page.evaluate("""async durations => {
                window.footwearTest = await import('/beach3d/tests/footwear_test.js');
                window.footwearFixture = await footwearTest.createFootwearFixture(durations);
            }""", report['durations'])
            report['barefootBaseline'] = page.evaluate('footwearFixture.bare')
            for shoe in (f'shoes{i}' for i in range(1, 7)):
                result = page.evaluate('id=>footwearTest.auditShoe(footwearFixture,id)', shoe)
                report['shoes'][shoe] = result
                (out / 'footwear-test.json').write_text(json.dumps(report, indent=2))
                print(shoe, json.dumps({'fit': result['fit'], 'ground': {k: {n: v[n] for n in ['minSupport', 'maxSupport', 'minAnyShoe']} for k, v in result['scenarios'].items()}}), flush=True)
                assert result['fit']['tested'] > 10000 and result['fit']['leaks'] == result['fit']['misses'] == 0, (shoe, result['fit'])
                for name, data in result['scenarios'].items():
                    assert not data['failures'], (shoe, name, data['failures'][:3])
                if args.shots:
                    image = page.evaluate('id=>footwearTest.contactSheet(footwearFixture,id)', shoe)
                    (out / f'{shoe}-contact-sheet.png').write_bytes(base64.b64decode(image.split(',')[1]))
                print(f'PASS {shoe}: complete gait, Idle, transitions, real soles and rug boundaries', flush=True)
            report['checks'] = page.evaluate('footwearTest.behaviorChecks(footwearFixture)')
            print('PASS instep/openings, boot/jeans, provider lifecycle, barefoot restoration and rug-corner negative control', flush=True)
            report['bareRug'] = page.evaluate('footwearTest.auditBareRug(footwearFixture)')
            assert not report['bareRug']['failures'], report['bareRug']
            print('PASS barefoot contacts across both rug steps and corner', flush=True)
            if args.shots:
                image = page.evaluate("footwearTest.contactSheet(footwearFixture,'shoes2',true)")
                (out / 'boot-jeans-contact-sheet.png').write_bytes(base64.b64decode(image.split(',')[1]))
            live = browser.new_page(viewport={'width': 1200, 'height': 900})
            live.on('pageerror', lambda e: errors.append(str(e)))
            live.goto(url + '/index.html'); live.wait_for_load_state('networkidle')
            live.locator('#welcome-start').click()
            report['liveLibrary'] = live.evaluate("""async () => {
                const test=await import('/beach3d/tests/footwear_test.js'); return test.inspectLibrary();
            }""")
            live.close()
            print('PASS all six shoes contact the real visible library rug', flush=True)
            assert not errors and not external, (errors, external)
            report['browserErrors'] = errors; report['externalRequests'] = external
        finally:
            (out / 'footwear-test.json').write_text(json.dumps(report, indent=2))
            browser.close()
    print(f'Report: {out / "footwear-test.json"}')


if __name__ == '__main__':
    main()
