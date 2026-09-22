"""Standalone library bookshelf + story reader regression (window.BooksUI).

Starts a temporary loopback server unless --url is supplied. Uses the existing
Python Playwright installation; no game dependencies, downloads, or temp
scripts. Reports and diagnostic images default to /tmp/kilo/book-test.

Phases (assert hard; --quick runs 1-3 only):
  1. data     — pure-Python manifest/book.json/image audit (no browser).
  2. shelf    — real #library-read-button click: 28 cards in manifest shelf
                order, thumbs decoded, level badges, state()/list().
  3. reader   — REAL button clicks through book 369 (__books.goPage only where
                noted): page 1 -> next x2 -> prev -> Arrow keys, goPage(10),
                credits entry with VERBATIM attribution + license/source
                hrefs, Read again, credits button, prev-from-credits.
  4. edge     — book 7 page 9 text-only (img hidden without src) and book 2
                page 13 image-only (no tall blank text box).
  5. peel     — warm manifest (ONE fetch for the whole session), a second
                book's state().bookId, #bookreader/#bookshelf/#library peel to
                the map, warm re-entry, Escape one level per press.
  6. rapid    — the wardrobe lesson: 5 un-awaited openBook(369); openBook(2);
                closeBook() bursts + 2 immediate #library-close/reopen storms;
                zero errors, state()/DOM agreement, no blob: src left behind,
                no late callbacks (state frozen across a 300ms settle with the
                watchers still attached).
  7. portrait — 390x844: 2-column shelf, >=44px reader controls, >=22px story
                text, CDP touchscreen swipe flips 1 / 10 -> 2 / 10, credits
                reachable with the attribution visible.
  8. tts      — the 🔊 Read page narration ladder (js/books.js): book 14838
                (27 MiMo TTS mp3s) data-layer clip audit (>=20 stamped
                pages[].audio, every clip >2KB with ID3/FF mp3 magic and an
                audio/page-NN.mp3 name matching its page) plus the
                full-narration coverage invariant (EVERY non-empty-text page
                of all 28 books stamps pages[].audio with a >2KB mp3 clip on
                disk — empty-text pages legitimately have none), a REAL
                #bookreader-tts click on 14838 p1 (>=44px, playing:true /
                source:"audio", exactly one #bookreader-audio pointed at
                page-01.mp3, currentTime grows across 600ms WITHOUT a seek,
                second click stops + rewinds), natural el.ended on the 4.5s
                p4 clip then one press replays, the stop rules (mid-play
                next, goPage(5) own clip, closeBook + reopen on a FRESH
                Audio element, #library-close, 10x tts()+closeBook() storm —
                each zombie-tested by firing the stale onended and freezing
                300ms), the speech fallback ladder via page.add_init_script
                stubs armed BEFORE the app scripts (localService Samantha
                wins over remote Google US English with rate 1.0 and the
                page text verbatim; a mid-speak page turn cancel()s and
                stays playing:false across a late onend; remote-only voices
                -> disabled "No reading voice on this device yet"; natural
                headless zero-voice -> same disabled state) — all three
                fallback cases run against a SIMULATED un-narrated book 369:
                an init-script fetch wrapper rewrites the book.json response
                to strip every pages[].audio field (a Response clone with all
                other fields verbatim) so the real no-audio ladder grades the
                stubs (369 now ships full narration, so its real pages[].audio
                would win the audio-first ladder and skip the fallback), and
                the button hiding while the credits sheet shows.

Every phase gates its own console errors, page errors, request failures and
ZERO external http(s) requests (same-origin only). Book ids 369/2/7/98/14838
below are the shipped manifest ids: 369 "The Red Raincoat" (10 pages), 2
"Smile Please!" (13 pages, page 13 image-only), 7 "Fat King Thin Dog" (9
pages, page 9 text-only), 98 "Rani's First Day at School" (7 pages), 14838
"The Tale of Peter Rabbit" (27 pages, 27 narration mp3s under audio/).
"""
import argparse
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from threading import Thread
import time

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parent.parent

REQUIRED_FIELDS = ('id', 'title', 'sourceUrl', 'language', 'level', 'pageCount',
                   'license', 'licenseUrl', 'attribution', 'copyrightNotice',
                   'publisher', 'publishedYear', 'authors', 'illustrators', 'pages')
WATCH_KEYS = ('pageErrors', 'consoleErrors', 'requestFailures', 'external')
PHASES = ('data', 'shelf', 'reader', 'edge', 'peel', 'rapid', 'portrait', 'tts')


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


def rstrip_text(text):
    """Normalize ONLY trailing whitespace (line ends + whole-string tail)."""
    return '\n'.join(line.rstrip() for line in text.split('\n')).rstrip()


def attach_watchers(page, url, watch):
    page.on('pageerror', lambda e: watch['pageErrors'].append(str(e)))
    page.on('console', lambda m: watch['consoleErrors'].append(
        {'text': m.text, 'location': m.location}) if m.type == 'error' else None)
    page.on('requestfailed', lambda r: watch['requestFailures'].append(
        {'url': r.url, 'failure': r.failure}))
    page.on('request', lambda r: watch['external'].append(r.url)
            if r.url.startswith(('http:', 'https:')) and not r.url.startswith(url + '/') else None)
    page.on('request', lambda r: watch['manifestFetches'].append(r.url)
            if r.url.endswith('/library/manifest.json') else None)


def new_watch():
    return {k: [] for k in WATCH_KEYS + ('manifestFetches',)}


def phase_gate(check, page, watch, phase):
    """Per-phase console/page-error + request-failure + zero-external gates."""
    page.wait_for_load_state('networkidle')
    check(f'{phase}: zero page errors', not watch['pageErrors'], watch['pageErrors'])
    check(f'{phase}: zero console errors', not watch['consoleErrors'], watch['consoleErrors'])
    check(f'{phase}: zero request failures', not watch['requestFailures'], watch['requestFailures'])
    check(f'{phase}: zero external http(s) requests', not watch['external'], watch['external'])
    for key in WATCH_KEYS:
        watch[key][:] = []


# ----------------------------- phase 1: data (pure Python, no browser) ----

def phase_data(check):
    lib = ROOT / 'library'
    manifest = json.loads((lib / 'manifest.json').read_text(encoding='utf-8'))
    books = manifest.get('books') or []
    check('data: manifest count == 28', manifest.get('count') == 28, manifest.get('count'))
    check('data: manifest holds 28 rows', len(books) == 28, len(books))
    orders = sorted(entry.get('shelfOrder') for entry in books)
    check('data: shelfOrder 1..28 contiguous', orders == list(range(1, 29)), orders)

    disk_ids = sorted(p.name for p in (lib / 'books').iterdir() if p.is_dir())
    manifest_ids = sorted(str(entry['id']) for entry in books)
    check('data: exactly 28 book dirs on disk', len(disk_ids) == 28, disk_ids)
    check('data: manifest ids == disk ids', manifest_ids == disk_ids,
          (manifest_ids, disk_ids))

    ordered = sorted(books, key=lambda entry: entry['shelfOrder'])
    loaded = {}
    for entry in ordered:
        bid = str(entry['id'])
        thumb = lib / entry['thumb']
        book_path = lib / entry['book']
        check(f'data: {bid} thumb + book.json paths exist',
              thumb.is_file() and book_path.is_file(),
              (str(thumb), thumb.is_file(), str(book_path), book_path.is_file()))
        book = json.loads(book_path.read_text(encoding='utf-8'))
        loaded[bid] = book
        missing = [key for key in REQUIRED_FIELDS if key not in book]
        check(f'data: {bid} required fields present', not missing, missing)
        check(f'data: {bid} id matches manifest', book.get('id') == entry['id'], book.get('id'))
        attr = book.get('attribution') or ''
        license_name = str(book.get('license') or '')
        if license_name.startswith('CC BY'):
            attr_ok, attr_rule = 'CC BY' in attr, 'CC BY'
        else:
            attr_ok, attr_rule = 'public domain' in attr.lower(), 'public domain'
        check(f'data: {bid} license CC BY 4.0/Public Domain + attribution has '
              f'"{attr_rule}" and {book.get("publishedYear")}',
              license_name in {'CC BY 4.0', 'Public Domain'} and attr_ok
              and str(book.get('publishedYear')) in attr,
              (license_name, attr_ok, book.get('publishedYear')))
        check(f'data: {bid} language == English', book.get('language') == 'English',
              book.get('language'))
        pages = book.get('pages') or []
        check(f'data: {bid} pageCount == len(pages)', book.get('pageCount') == len(pages),
              (book.get('pageCount'), len(pages)))
        shape_ok, image_ok, bad = True, True, []
        for page in pages:
            image = page.get('image') or ''
            text = page.get('text') or ''
            if not (image or text):
                shape_ok = False
                bad.append({'n': page.get('n'), 'why': 'text and image both empty'})
            if image:
                img_path = lib / 'books' / bid / image
                if not img_path.is_file():
                    image_ok = False
                    bad.append({'n': page.get('n'), 'why': 'missing ' + image})
                else:
                    blob = img_path.read_bytes()
                    if blob[:2] != b'\xff\xd8' or len(blob) <= 2048:
                        image_ok = False
                        bad.append({'n': page.get('n'), 'why': 'not FFD8 JPEG >2KB',
                                    'bytes': len(blob), 'magic': blob[:2].hex()})
        check(f'data: {bid} every page has text or image (never both empty)', shape_ok, bad)
        check(f'data: {bid} page images exist, start FFD8, >2KB', image_ok, bad)
    return {'manifest': manifest, 'ordered': ordered, 'books': loaded}


# ----------------------------- browser helpers ----------------------------

def enter(page, url, check, phase, label='library 3D entered and char-ready'):
    """welcome (Continue / Let's Play) -> map -> library place -> 3D entry."""
    page.goto(url + '/index.html', wait_until='networkidle')
    if page.locator('#welcome-overlay').is_visible():
        if page.locator('#welcome-continue').is_visible():
            page.click('#welcome-continue')
        else:
            page.click('#welcome-start')
    nav = page.locator('.nav-button[data-screen="map"]')
    if nav.is_visible():
        nav.click()
    page.click('.place[data-place-id="library"]')
    reopen(page)
    check(f'{phase}: {label}',
          page.evaluate('!!(__library3d.state() && __library3d.state().charReady)'),
          page.evaluate('__library3d.state()'))


def reopen(page):
    if page.locator('#library-stage').is_hidden():
        page.click('#library-play-button')
    page.wait_for_function('!!(__library3d.state() && __library3d.state().charReady)', timeout=30000)
    page.wait_for_timeout(650)


def indicator(page):
    return page.evaluate('document.getElementById("bookreader-page").textContent')


def title_text(page):
    return page.evaluate('document.getElementById("bookreader-title").textContent')


def manifest_count(watch):
    return len(watch['manifestFetches'])


def state(page):
    return page.evaluate('window.__books.state()')


# ----------------------------- phase 2: shelf -----------------------------

def phase_shelf(check, page, out, data, watch, shots):
    check('shelf: #library-read-button visible over the library',
          page.locator('#library-read-button').is_visible())
    page.click('#library-read-button')
    page.wait_for_function(
        'document.querySelectorAll("button.bookshelf-card[data-book-id]").length === 28')
    cards = page.locator('button.bookshelf-card[data-book-id]')
    check('shelf: 28 bookshelf cards', cards.count() == 28, cards.count())
    titles = page.evaluate(
        '[...document.querySelectorAll("#bookshelf-grid .bookshelf-card-title")]'
        '.map(e => e.textContent)')
    expected = [entry['title'] for entry in data['ordered']]
    check('shelf: card titles match manifest shelf order', titles == expected,
          (titles, expected))
    page.wait_for_function("""() => {
        const imgs = [...document.querySelectorAll('img.bookshelf-card-thumb')];
        return imgs.length === 28 && imgs.every(i => i.complete && i.naturalWidth > 0);
    }""")
    widths = page.evaluate(
        '[...document.querySelectorAll("img.bookshelf-card-thumb")].map(i => i.naturalWidth)')
    check('shelf: every thumb decoded (naturalWidth > 0)',
          len(widths) == 28 and all(w > 0 for w in widths), widths)
    levels = page.evaluate(
        '[...document.querySelectorAll("#bookshelf-grid .bookshelf-card-level")]'
        '.map(e => e.textContent)')
    expected_levels = ['Level ' + str(entry['level']) for entry in data['ordered']]
    check('shelf: level badges match manifest levels', levels == expected_levels,
          (levels, expected_levels))
    shelf_state = state(page)
    check('shelf: state().manifestLoaded true', shelf_state['manifestLoaded'] is True, shelf_state)
    check('shelf: list() length 28', len(page.evaluate('window.__books.list()')) == 28)
    check('shelf: #bookshelf covers the stage with the reader closed',
          page.locator('#bookshelf').is_visible() and page.locator('#bookreader').is_hidden())
    path = out / 'shelf-desktop.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    phase_gate(check, page, watch, 'shelf')


# ----------------------------- phase 3: reader ----------------------------

def phase_reader(check, page, out, data, watch, shots):
    book = data['books']['369']
    page.click('button.bookshelf-card[data-book-id="369"]')
    page.wait_for_function(
        'window.__books.state().bookId == 369 && window.__books.state().pageCount === 10'
        ' && window.__books.state().view === "page"')
    check('reader: card tap opens book 369 on page 1', indicator(page) == '1 / 10', indicator(page))
    check('reader: title text visible = manifest title',
          title_text(page) == book['title'] and page.locator('#bookreader-title').is_visible(),
          title_text(page))
    page.wait_for_function(
        '() => { const i = document.getElementById("bookreader-img");'
        ' return i.complete && i.naturalWidth > 0; }')
    img = page.evaluate("""() => {
        const i = document.getElementById('bookreader-img');
        return {width: i.naturalWidth, fit: getComputedStyle(i).objectFit,
                hidden: i.classList.contains('hidden')}; }""")
    check('reader: #bookreader-img loaded and object-fit: contain',
          img['width'] > 0 and img['fit'] == 'contain' and not img['hidden'], img)
    path = out / 'reader-p1.png'
    page.screenshot(path=str(path))
    shots.append(str(path))

    page.click('#bookreader-next')
    check('reader: next -> 2 / 10', indicator(page) == '2 / 10', indicator(page))
    page.click('#bookreader-next')
    check('reader: next x2 -> 3 / 10', indicator(page) == '3 / 10', indicator(page))
    page.click('#bookreader-prev')
    check('reader: prev -> 2 / 10', indicator(page) == '2 / 10', indicator(page))
    path = out / 'reader-p2-after-clicks.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    page.keyboard.press('ArrowRight')
    check('reader: ArrowRight -> 3 / 10', indicator(page) == '3 / 10', indicator(page))
    page.keyboard.press('ArrowLeft')
    check('reader: ArrowLeft -> 2 / 10', indicator(page) == '2 / 10', indicator(page))

    jumped = page.evaluate('window.__books.goPage(10)')
    check('reader: __books.goPage(10) commits', jumped is True, jumped)
    check('reader: goPage(10) -> 10 / 10', indicator(page) == '10 / 10', indicator(page))
    path = out / 'reader-p10.png'
    page.screenshot(path=str(path))
    shots.append(str(path))

    page.click('#bookreader-next')  # last-page next IS the 🎉 credits entry
    page.wait_for_function(
        '!document.getElementById("bookreader-credits").classList.contains("hidden")')
    check('reader: next on last page opens the credits sheet',
          page.locator('#bookreader-credits').is_visible()
          and page.locator('#bookreader-pageview').is_hidden())
    attribution = page.evaluate(
        'document.getElementById("bookreader-credits-attribution").textContent')
    check('reader: attribution verbatim == book.json (trailing whitespace only)',
          rstrip_text(attribution) == rstrip_text(book['attribution']),
          (len(attribution), len(book['attribution'])))
    check('reader: attribution contains "CC BY"', 'CC BY' in attribution)
    license_href = page.evaluate(
        'document.getElementById("bookreader-credits-license").getAttribute("href")')
    check('reader: license link href == licenseUrl', license_href == book['licenseUrl'],
          (license_href, book['licenseUrl']))
    source_href = page.evaluate(
        'document.getElementById("bookreader-credits-source").getAttribute("href")')
    check('reader: source link href == sourceUrl', source_href == book['sourceUrl'],
          (source_href, book['sourceUrl']))
    path = out / 'reader-credits.png'
    page.screenshot(path=str(path))
    shots.append(str(path))

    page.click('#bookreader-again')
    check('reader: Read again -> back on page 1',
          indicator(page) == '1 / 10'
          and page.locator('#bookreader-pageview').is_visible(), indicator(page))
    path = out / 'reader-again-p1.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    page.click('#bookreader-credits-btn')
    check('reader: ℹ️ Credits button reopens the credits sheet',
          page.locator('#bookreader-credits').is_visible()
          and page.locator('#bookreader-pageview').is_hidden())
    page.click('#bookreader-prev')
    check('reader: prev from credits -> 10 / 10',
          indicator(page) == '10 / 10'
          and page.locator('#bookreader-pageview').is_visible(), indicator(page))
    phase_gate(check, page, watch, 'reader')


# ----------------------------- phase 4: edge pages ------------------------

def phase_edge(check, page, out, data, watch, shots):
    opened = page.evaluate('window.__books.openBook(7)')
    check('edge: fresh openBook(7) resolves', opened is True, opened)
    jumped = page.evaluate('window.__books.goPage(9)')
    check('edge: goPage(9) commits on book 7', jumped is True, jumped)
    check('edge: book 7 page 9 indicator 9 / 9', indicator(page) == '9 / 9', indicator(page))
    img = page.evaluate("""() => {
        const i = document.getElementById('bookreader-img');
        return {src: i.getAttribute('src'), clsHidden: i.classList.contains('hidden'),
                visible: !!(i.getClientRects().length)}; }""")
    check('edge: text-only page hides #bookreader-img and leaves NO src',
          img['clsHidden'] and img['src'] is None and not img['visible'], img)
    text = page.evaluate('document.getElementById("bookreader-text").textContent')
    check('edge: text-only page text contains "fat king is thin"', 'fat king is thin' in text,
          text)
    path = out / 'edge-textonly-7-p9.png'
    page.screenshot(path=str(path))
    shots.append(str(path))

    opened = page.evaluate('window.__books.openBook(2)')
    check('edge: fresh openBook(2) resolves', opened is True, opened)
    jumped = page.evaluate('window.__books.goPage(13)')
    check('edge: goPage(13) commits on book 2', jumped is True, jumped)
    check('edge: book 2 page 13 indicator 13 / 13', indicator(page) == '13 / 13', indicator(page))
    page.wait_for_function(
        '() => { const i = document.getElementById("bookreader-img");'
        ' return i.complete && i.naturalWidth > 0 && !i.classList.contains("hidden"); }')
    text_box = page.evaluate("""() => {
        const t = document.getElementById('bookreader-text');
        const r = t.getBoundingClientRect();
        return {height: r.height, visible: !!t.getClientRects().length,
                text: t.textContent}; }""")
    check('edge: image-only page shows the loaded illustration',
          page.evaluate('document.getElementById("bookreader-img").naturalWidth') > 0)
    check('edge: image-only page has no tall blank text box (hidden or zero height)',
          (not text_box['visible']) or text_box['height'] == 0, text_box)
    path = out / 'edge-imageonly-2-p13.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    phase_gate(check, page, watch, 'edge')


# ----------------------------- phase 5: peel + warm cache + lifecycle -----

def phase_peel(check, page, out, data, watch, shots):
    page.click('#bookreader-close')
    check('peel: #bookreader-close lands on the shelf (28 cards)',
          page.locator('#bookshelf').is_visible()
          and page.locator('button.bookshelf-card[data-book-id]').count() == 28)
    check('peel: manifest fetch count still 1 after closeBook',
          manifest_count(watch) == 1, manifest_count(watch))
    page.click('button.bookshelf-card[data-book-id="98"]')
    page.wait_for_function(
        'window.__books.state().bookId == 98 && window.__books.state().pageCount === 7')
    shelf_state = state(page)
    check('peel: reopened book state().bookId matches the tapped card (98)',
          shelf_state['bookId'] == 98 and title_text(page) == data['books']['98']['title'],
          (shelf_state, title_text(page)))
    check('peel: book 98 renders page 1',
          indicator(page) == '1 / ' + str(data['books']['98']['pageCount']), indicator(page))
    page.click('#bookreader-close')
    check('peel: #bookreader-close again -> shelf', page.locator('#bookshelf').is_visible()
          and page.locator('#bookreader').is_hidden())
    page.click('#bookshelf-close')
    check('peel: #bookshelf-close -> library with the read pill back',
          page.locator('#bookshelf').is_hidden()
          and page.locator('#library-read-button').is_visible()
          and not state(page)['open'])
    page.click('#library-close')
    check('peel: full #library-close peels to the map',
          page.locator('#library-stage').is_hidden()
          and page.locator('#map-board').is_visible())
    check('peel: manifest fetch STILL 1 after full library close',
          manifest_count(watch) == 1, manifest_count(watch))

    reopen(page)
    page.click('#library-read-button')
    page.wait_for_function(
        'document.querySelectorAll("button.bookshelf-card[data-book-id]").length === 28')
    check('peel: shelf opens warm on re-entry (28 cards)',
          page.locator('button.bookshelf-card[data-book-id]').count() == 28)
    check('peel: manifest fetch STILL 1 on the warm shelf',
          manifest_count(watch) == 1, manifest_count(watch))
    path = out / 'peel-warm-shelf.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    page.click('button.bookshelf-card[data-book-id="369"]')
    page.wait_for_function(
        'window.__books.state().bookId == 369 && window.__books.state().pageCount === 10')
    page.wait_for_function(
        '() => { const i = document.getElementById("bookreader-img");'
        ' return i.complete && i.naturalWidth > 0; }')
    check('peel: a book still renders after re-entry (369, 1 / 10)',
          indicator(page) == '1 / 10', indicator(page))
    path = out / 'peel-warm-book.png'
    page.screenshot(path=str(path))
    shots.append(str(path))

    page.keyboard.press('Escape')
    check('peel: Escape 1 peels reader -> shelf (one level)',
          page.locator('#bookshelf').is_visible() and page.locator('#bookreader').is_hidden()
          and page.locator('button.bookshelf-card[data-book-id]').count() == 28
          and state(page)['view'] == 'shelf')
    path = out / 'peel-escape-shelf.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    page.keyboard.press('Escape')
    check('peel: Escape 2 peels shelf -> library (one level)',
          page.locator('#bookshelf').is_hidden()
          and page.locator('#library-read-button').is_visible()
          and not state(page)['open'])
    path = out / 'peel-escape-library.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    page.keyboard.press('Escape')
    check('peel: Escape 3 peels library -> map (one level)',
          page.locator('#library-stage').is_hidden()
          and page.locator('#map-board').is_visible())
    path = out / 'peel-escape-map.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    check('peel: manifest fetched exactly once for the whole session',
          manifest_count(watch) == 1, manifest_count(watch))
    phase_gate(check, page, watch, 'peel')


# ----------------------------- phase 6: rapid / race ----------------------

def phase_rapid(check, page, out, data, watch, shots):
    reopen(page)
    check('rapid: library reopened for the race phase',
          page.locator('#library-read-button').is_visible())
    # 5 un-awaited bursts (the wardrobe lesson); the first two are chased
    # IMMEDIATELY by a library #library-close/reopen storm so teardown races
    # the in-flight book fetches and image callbacks.
    for i in range(5):
        page.evaluate("""() => {
            window.__books.openBook(369);
            window.__books.openBook(2);
            window.__books.closeBook();
        }""")
        if i < 2:
            for _ in range(3):  # peel reader/shelf/library levels in one storm
                page.locator('#library-close').dispatch_event('click')
            page.locator('#library-play-button').click()  # immediate reopen
    check('rapid: 5 bursts + 2 #library-close/reopen storms completed', True)

    snap = page.evaluate("""() => ({
        state: window.__books.state(),
        title: document.getElementById('bookreader-title').textContent,
        imgSrc: document.getElementById('bookreader-img').getAttribute('src'),
        readerHidden: document.getElementById('bookreader').classList.contains('hidden'),
        view: window.__books.state().view
    })""")
    check('rapid: state().title matches #bookreader-title text (or both empty on shelf)',
          snap['state']['title'] == snap['title'], snap)
    if snap['state']['view'] in ('page', 'credits'):
        check('rapid: reader visible when state() is on a page', not snap['readerHidden'], snap)
    else:
        check('rapid: reader hidden when state() is on the shelf', snap['readerHidden'], snap)
    blobs = page.evaluate(
        '[...document.querySelectorAll("[src]")].map(e => e.getAttribute("src"))'
        '.filter(s => s && s.startsWith("blob:"))')
    check('rapid: no src left pointing at blob:', not blobs, blobs)

    before = page.evaluate("""() => JSON.stringify({
        state: window.__books.state(),
        title: document.getElementById('bookreader-title').textContent,
        imgSrc: document.getElementById('bookreader-img').getAttribute('src'),
        readerHidden: document.getElementById('bookreader').classList.contains('hidden'),
        shelfHidden: document.getElementById('bookshelf').classList.contains('hidden')
    })""")
    marks = {key: len(watch[key]) for key in WATCH_KEYS}
    page.wait_for_timeout(300)  # watchers stay attached across the settle
    after = page.evaluate("""() => JSON.stringify({
        state: window.__books.state(),
        title: document.getElementById('bookreader-title').textContent,
        imgSrc: document.getElementById('bookreader-img').getAttribute('src'),
        readerHidden: document.getElementById('bookreader').classList.contains('hidden'),
        shelfHidden: document.getElementById('bookshelf').classList.contains('hidden')
    })""")
    check('rapid: state + DOM frozen across the 300ms settle (no late callbacks)',
          before == after, (before, after))
    check('rapid: watchers silent during the settle',
          all(len(watch[key]) == marks[key] for key in WATCH_KEYS),
          {key: watch[key][marks[key]:] for key in WATCH_KEYS})
    check('rapid: manifest fetched exactly once across the whole race',
          manifest_count(watch) == 1, manifest_count(watch))
    path = out / 'rapid-final.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    phase_gate(check, page, watch, 'rapid')


# ----------------------------- phase 7: portrait --------------------------

def swipe_left(page, x, y, dist=160, steps=8):
    """CDP touchscreen flick: horizontal-dominant left swipe (books.js flips)."""
    client = page.context.new_cdp_session(page)
    client.send('Input.dispatchTouchEvent',
                {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y}]})
    for i in range(1, steps + 1):
        client.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [
            {'x': x - dist * i / steps, 'y': y}]})
    client.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})


def phase_portrait(check, page, out, data, watch, shots):
    page.click('#library-read-button')
    page.wait_for_function(
        'document.querySelectorAll("button.bookshelf-card[data-book-id]").length === 28')
    columns = page.evaluate(
        'getComputedStyle(document.getElementById("bookshelf-grid")).gridTemplateColumns')
    check('portrait: shelf grid is 2 columns at 390px', len(columns.split()) == 2, columns)
    grid_box = page.locator('#bookshelf-grid').bounding_box()
    card_box = page.locator('button.bookshelf-card[data-book-id="369"]').bounding_box()
    check('portrait: cards fill ~half the grid width',
          0.35 * grid_box['width'] <= card_box['width'] <= 0.6 * grid_box['width'],
          (grid_box, card_box))
    path = out / 'portrait-shelf.png'
    page.screenshot(path=str(path))
    shots.append(str(path))

    page.click('button.bookshelf-card[data-book-id="369"]')
    page.wait_for_function(
        'window.__books.state().bookId == 369 && window.__books.state().pageCount === 10')
    check('portrait: reader opens on 1 / 10', indicator(page) == '1 / 10', indicator(page))
    for name, sel in (('prev', '#bookreader-prev'), ('next', '#bookreader-next'),
                      ('close', '#bookreader-close')):
        box = page.locator(sel).bounding_box()
        check(f'portrait: #{sel[1:]} box >= 44px',
              box['width'] >= 44 and box['height'] >= 44, box)
    font = page.evaluate(
        'parseFloat(getComputedStyle(document.getElementById("bookreader-text")).fontSize)')
    check('portrait: #bookreader-text font-size >= 22px on a text page', font >= 22, font)
    path = out / 'portrait-reader-p1.png'
    page.screenshot(path=str(path))
    shots.append(str(path))

    body = page.locator('#bookreader-body').bounding_box()
    swipe_left(page, body['x'] + body['width'] * 0.8, body['y'] + body['height'] * 0.5)
    check('portrait: touchscreen swipe left advances 1 / 10 -> 2 / 10',
          indicator(page) == '2 / 10', indicator(page))
    path = out / 'portrait-swipe-p2.png'
    page.screenshot(path=str(path))
    shots.append(str(path))

    for _ in range(8):  # 2 -> 10 with real taps
        page.click('#bookreader-next')
    check('portrait: next taps reach 10 / 10', indicator(page) == '10 / 10', indicator(page))
    page.click('#bookreader-next')  # 🎉 credits entry
    page.wait_for_function(
        '!document.getElementById("bookreader-credits").classList.contains("hidden")')
    check('portrait: credits reachable', page.locator('#bookreader-credits').is_visible())
    again_box = page.locator('#bookreader-again').bounding_box()
    check('portrait: #bookreader-again box >= 44px',
          again_box['width'] >= 44 and again_box['height'] >= 44, again_box)
    attribution = page.evaluate(
        'document.getElementById("bookreader-credits-attribution").textContent')
    attr_box = page.locator('#bookreader-credits-attribution').bounding_box()
    check('portrait: attribution visible on the credits sheet',
          'CC BY' in attribution and attr_box['height'] > 40, (attr_box, len(attribution)))
    path = out / 'portrait-credits.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    phase_gate(check, page, watch, 'portrait')


# ----------------------------- phase 8: tts (🔊 Read page) -----------------

TTS_NO_VOICE_TITLE = 'No reading voice on this device yet'
TTS_CREDIT_LINE = ('Page narration audio generated with Xiaomi MiMo TTS '
                   '(mimo-v2.5-tts-voicedesign).')
TTS_CREDIT_LINE_CLONE = ('Page narration audio generated with Xiaomi MiMo TTS '
                         '(base voice designed with mimo-v2.5-tts-voicedesign, '
                         'narration synthesized with mimo-v2.5-tts-voiceclone).')

# speechSynthesis / SpeechSynthesisUtterance stub — MUST be armed with
# page.add_init_script BEFORE the app scripts load so js/books.js grades
# its whole fallback ladder against the stub (real getVoices/speak/cancel
# spies keep the zero-external guarantee: a non-local voice is never
# eligible and speak() touches no network).
TTS_STUB_TEMPLATE = """(() => {
  const voices = __VOICES__;
  const stub = { spoken: [], cancelCalls: 0, savedOnend: null };
  function Utter(text) {
    this.text = String(text == null ? '' : text);
    this.rate = 1;
    this.pitch = 1;
    this.voice = null;
    this.onend = null;
    this.onerror = null;
  }
  const synth = {
    getVoices: function () { return voices.slice(); },
    speak: function (utter) {
      stub.savedOnend = utter.onend;
      stub.spoken.push({
        text: String(utter.text || ''),
        rate: utter.rate,
        pitch: utter.pitch,
        voiceName: utter.voice ? String(utter.voice.name || '') : null,
        localService: utter.voice ? !!utter.voice.localService : null
      });
    },
    cancel: function () { stub.cancelCalls += 1; },
    pause: function () {},
    resume: function () {},
    addEventListener: function () {},
    removeEventListener: function () {},
    speaking: false,
    pending: false,
    paused: false
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utter, configurable: true });
  window.__ttsStub = stub;
})();"""

TTS_STUB_LOCAL_MIX = TTS_STUB_TEMPLATE.replace(
    '__VOICES__',
    "[{localService: true, lang: 'en-US', name: 'Samantha'},"
    " {localService: false, lang: 'en-US', name: 'Google US English'}]")
TTS_STUB_REMOTE_ONLY = TTS_STUB_TEMPLATE.replace(
    '__VOICES__',
    "[{localService: false, lang: 'en-US', name: 'Google US English'}]")

# fetch-rewrite fixture — also armed with page.add_init_script (alone for
# the natural no-stub case, alongside a speech stub otherwise): intercepts
# book 369's book.json response and REWRITES the parsed JSON to strip every
# pages[].audio field before returning it as a fresh Response (all other
# fields verbatim). Book 369 now ships full narration, so its real
# pages[].audio would win the audio-first ladder and the fallback would
# never run; this simulates an un-narrated book so the real UI code grades
# its no-audio ladder against the stubs. No product hooks.
TTS_FETCH_REWRITE = """(() => {
  const origFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const resp = await origFetch(...args);
    try {
      const req = args[0];
      const raw = (req && typeof req === 'object' && req.url) ? String(req.url) : String(req);
      if (!raw.split(/[?#]/)[0].endsWith('/books/369/book.json')) return resp;
      const data = await resp.clone().json();
      if (data && Array.isArray(data.pages)) {
        for (const pg of data.pages) {
          if (pg && typeof pg === 'object') { delete pg.audio; }
        }
      }
      return new Response(JSON.stringify(data), {
        status: resp.status,
        statusText: resp.statusText,
        headers: resp.headers
      });
    } catch (err) {
      return resp;
    }
  };
})();"""


def norm_ws(text):
    """Whitespace-normalized text (the speech-path text contract)."""
    return ' '.join((text or '').split())


def tts_snap(page):
    """Serialized TTS + button + <audio> state for the no-zombie settles."""
    return page.evaluate("""() => JSON.stringify({
        tts: window.__books.ttsState(),
        label: document.getElementById('bookreader-tts').textContent,
        playingClass: document.getElementById('bookreader-tts').classList.contains('is-playing'),
        audioEls: document.querySelectorAll('audio').length
    })""")


def tts_settle(check, page, name, must_be_playing):
    """Fire the saved STALE onended/onend hooks (the zombie), then require
    the state to stay frozen across a 300ms settle. The settle FAILS if no
    stale hook was captured — the zombie test must really have fired one."""
    fired = page.evaluate("""() => {
        let n = 0;
        if (typeof window.__ttsSavedOnended === 'function') { window.__ttsSavedOnended(); n++; }
        if (window.__ttsStub && typeof window.__ttsStub.savedOnend === 'function') {
            window.__ttsStub.savedOnend(); n++;
        }
        return n;
    }""")
    before = tts_snap(page)
    page.wait_for_timeout(300)
    after = tts_snap(page)
    playing = json.loads(before)['tts']['playing']
    check(name,
          fired >= 1 and before == after and playing == must_be_playing,
          {'firedStaleHooks': fired, 'before': before, 'after': after})


def phase_tts(check, page, browser, url, out, data, watch, shots):
    # ---- data layer: 14838's narration clips on disk (pure Python) -------
    book = data['books']['14838']
    stamped = [rec for rec in book['pages'] if rec.get('audio')]
    check('tts: data: book 14838 stamps audio on >= 20 pages',
          len(stamped) >= 20, len(stamped))
    audio_root = ROOT / 'library' / 'books' / '14838'
    bad_blob, bad_name = [], []
    for rec in stamped:
        rel, n = rec['audio'], int(rec['n'])
        clip = audio_root / rel
        if not clip.is_file():
            bad_blob.append({'n': n, 'why': 'missing ' + rel})
        else:
            blob = clip.read_bytes()
            mp3_magic = blob[:3] == b'ID3' or (blob[0] == 0xFF and (blob[1] & 0xE0) == 0xE0)
            if len(blob) <= 2048 or not mp3_magic:
                bad_blob.append({'n': n, 'why': 'not >2KB mp3 (ID3 or FF sync)',
                                 'bytes': len(blob), 'magic': blob[:4].hex()})
        if not re.fullmatch(r'audio/page-0*%d\.mp3' % n, rel):
            bad_name.append({'n': n, 'audio': rel})
    check('tts: data: every 14838 clip exists on disk, >2KB, mp3 magic (ID3 or FF sync)',
          not bad_blob, bad_blob)
    check('tts: data: clip names match audio/page-NN.mp3 of their page',
          not bad_name, bad_name)

    # ---- full-narration coverage: a hard invariant since TTS stamping ----
    # every non-empty-text page of ALL 28 books carries pages[].audio whose
    # clip exists on disk, >2KB, mp3 magic (empty-text pages legitimately
    # have no clip; a stamped clip is validated wherever it appears).
    miss, bad_clip = [], []
    for bid, bok in sorted(data['books'].items()):
        for rec in bok.get('pages') or []:
            text = (rec.get('text') or '').strip()
            rel = rec.get('audio') or ''
            if not text and not rel:
                continue
            if not rel:
                miss.append({'book': bid, 'n': rec.get('n'),
                             'why': 'non-empty text without pages[].audio'})
                continue
            clip = ROOT / 'library' / 'books' / bid / rel
            if not clip.is_file():
                bad_clip.append({'book': bid, 'n': rec.get('n'),
                                 'why': 'missing ' + rel})
            else:
                blob = clip.read_bytes()
                mp3_magic = (blob[:3] == b'ID3'
                             or (blob[0] == 0xFF and (blob[1] & 0xE0) == 0xE0))
                if len(blob) <= 2048 or not mp3_magic:
                    bad_clip.append({'book': bid, 'n': rec.get('n'),
                                     'why': 'not >2KB mp3 (ID3 or FF sync)',
                                     'bytes': len(blob),
                                     'magic': blob[:4].hex()})
    check('tts: data: full narration coverage: every non-empty-text page of '
          'all 28 books stamps pages[].audio (clip on disk >2KB, mp3 magic)',
          not miss and not bad_clip,
          {'books': len(data['books']), 'unstamped': miss, 'badClips': bad_clip})

    # ---- narration credit + voice provenance (pure Python) ----------------
    credits_path = ROOT / 'library' / 'CREDITS.md'
    credits_text = (credits_path.read_text(encoding='utf-8')
                    if credits_path.is_file() else '')
    base_exists = (ROOT / 'tools' / 'voice' / 'base.mp3').is_file()
    want_line = TTS_CREDIT_LINE_CLONE if base_exists else TTS_CREDIT_LINE
    other_line = TTS_CREDIT_LINE if base_exists else TTS_CREDIT_LINE_CLONE
    check('tts: data: CREDITS.md carries one narration credit line (voiceclone '
          'variant iff tools/voice/base.mp3 exists)',
          want_line in credits_text and other_line not in credits_text,
          {'baseSample': base_exists, 'wantPresent': want_line in credits_text,
           'otherPresent': other_line in credits_text})
    voice_json = ROOT / 'tools' / 'voice' / 'voice.json'
    v_ok, v_detail = True, 'absent (optional provenance)'
    if voice_json.is_file():
        try:
            v_data = json.loads(voice_json.read_text(encoding='utf-8'))
            blob = json.dumps(v_data, ensure_ascii=False)
            v_ok = ('mimo-v2.5-tts-voicedesign' in blob
                    and 'mimo-v2.5-tts-voiceclone' in blob)
            v_detail = {'modelDesignNamed': 'mimo-v2.5-tts-voicedesign' in blob,
                        'modelCloneNamed': 'mimo-v2.5-tts-voiceclone' in blob}
        except Exception as exc:
            v_ok, v_detail = False, 'unparseable: ' + str(exc)
    check('tts: data: tools/voice/voice.json (when present) parses and names '
          'both model ids', v_ok, v_detail)

    # ---- UI layer: REAL #bookreader-tts click, book 14838 page 1 ---------
    page.click('#library-read-button')
    page.wait_for_function(
        'document.querySelectorAll("button.bookshelf-card[data-book-id]").length === 28')
    page.click('button.bookshelf-card[data-book-id="14838"]')
    page.wait_for_function(
        'window.__books.state().bookId == 14838 && window.__books.state().pageCount === 27'
        ' && window.__books.state().view === "page"')
    btn_box = page.locator('#bookreader-tts').bounding_box()
    check('tts: #bookreader-tts visible and >= 44px on 14838 page 1',
          page.locator('#bookreader-tts').is_visible()
          and btn_box['width'] >= 44 and btn_box['height'] >= 44, btn_box)
    page.click('#bookreader-tts')
    page.wait_for_function('window.__books.ttsState().playing === true')
    st = page.evaluate('window.__books.ttsState()')
    check('tts: real click starts the audio ladder: playing:true, source:"audio"',
          st['playing'] is True and st['source'] == 'audio'
          and st['bookId'] == 14838 and st['page'] == 1, st)
    audio_info = page.evaluate("""() => {
        const all = [...document.querySelectorAll('audio')];
        const el = document.getElementById('bookreader-audio');
        return {count: all.length, single: all.length === 1 && all[0] === el,
                src: el ? el.getAttribute('src') : null};}""")
    check('tts: exactly one <audio> (#bookreader-audio) with src ending '
          'books/14838/audio/page-01.mp3',
          audio_info['single'] and (audio_info['src'] or '')
          .endswith('books/14838/audio/page-01.mp3'), audio_info)
    t0 = page.evaluate('document.getElementById("bookreader-audio").currentTime')
    page.wait_for_timeout(600)
    t1 = page.evaluate('document.getElementById("bookreader-audio").currentTime')
    check('tts: currentTime grows across 600ms (wait it out — never seek)',
          t1 > t0, (t0, t1))
    path = out / 'tts-audio-p1.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    page.click('#bookreader-tts')  # toggle OFF mid-clip
    stop = page.evaluate("""() => ({
        tts: window.__books.ttsState(),
        cur: document.getElementById('bookreader-audio').currentTime,
        label: document.getElementById('bookreader-tts').textContent})""")
    check('tts: second click stops (playing:false) and rewinds the clip to 0',
          stop['tts']['playing'] is False and stop['cur'] == 0
          and stop['label'] == '🔊 Read page', stop)

    # natural el.ended on the 4.5s page-04 clip, then one press = replay
    page.evaluate('window.__books.goPage(4)')
    page.click('#bookreader-tts')
    page.wait_for_function('window.__books.ttsState().playing === true')
    t_end = time.time()
    page.wait_for_function('window.__books.ttsState().playing === false', timeout=15000)
    ended = page.evaluate('document.getElementById("bookreader-audio").ended === true')
    check('tts: short page-04 clip ends naturally (el.ended) within 15s',
          ended is True and time.time() - t_end <= 15,
          {'ended': ended, 'seconds': round(time.time() - t_end, 2)})
    page.click('#bookreader-tts')  # ONE press after ended = replay
    st = page.evaluate('window.__books.ttsState()')
    check('tts: one press after ended replays the clip (playing:true, source:"audio")',
          st['playing'] is True and st['source'] == 'audio', st)

    # ---- stop rules (each with a stale-onended zombie settle) ------------
    page.evaluate('window.__books.goPage(1)')  # 12s clip = wide race window
    page.click('#bookreader-tts')
    page.wait_for_function('window.__books.ttsState().playing === true')
    page.evaluate("""() => {
        window.__ttsSavedOnended = document.getElementById('bookreader-audio').onended;
    }""")
    page.click('#bookreader-next')  # 1 -> 2 mid-play
    st = page.evaluate('window.__books.ttsState()')
    check('tts: mid-play #bookreader-next stops the clip (playing:false)',
          st['playing'] is False and st['page'] == 2, st)
    tts_settle(check, page,
               'tts: post-turn state frozen 300ms after the stale onended (no zombie flip)',
               must_be_playing=False)

    page.evaluate('window.__books.goPage(5)')
    started = page.evaluate('window.__books.tts()')
    page.wait_for_function('window.__books.ttsState().playing === true')
    src = page.evaluate('document.getElementById("bookreader-audio").getAttribute("src")')
    check('tts: goPage(5) + tts() works on the new page\'s own clip (src .../page-05.mp3)',
          started is True and (src or '').endswith('books/14838/audio/page-05.mp3'),
          (started, src))
    tts_settle(check, page,
               'tts: stale page-01 onended cannot kill the page-05 clip (no zombie flip)',
               must_be_playing=True)

    page.evaluate('window.__ttsPrevAudio = document.getElementById("bookreader-audio")')
    page.evaluate('window.__books.closeBook()')
    clean = page.evaluate("""() => ({
        tts: window.__books.ttsState(),
        audioEls: document.querySelectorAll('audio').length})""")
    check('tts: closeBook() mid-play cleans up (playing:false, source:"none", no <audio>)',
          clean['tts']['playing'] is False and clean['tts']['source'] == 'none'
          and clean['tts']['bookId'] is None and clean['audioEls'] == 0, clean)

    reopened = page.evaluate('window.__books.openBook(14838)')
    page.wait_for_function(
        'window.__books.state().bookId == 14838 && window.__books.state().pageCount === 27')
    started = page.evaluate('window.__books.tts()')
    page.wait_for_function('window.__books.ttsState().playing === true')
    fresh = page.evaluate("""() => {
        const all = [...document.querySelectorAll('audio')];
        const el = document.getElementById('bookreader-audio');
        return {count: all.length, fresh: !!el && el !== window.__ttsPrevAudio,
                src: el ? el.getAttribute('src') : null,
                tts: window.__books.ttsState()};}""")
    check('tts: reopen 14838 + tts() works again on a FRESH single Audio '
          '(src .../page-01.mp3)',
          reopened is True and started is True and fresh['count'] == 1
          and fresh['fresh'] is True and fresh['tts']['playing'] is True
          and (fresh['src'] or '').endswith('books/14838/audio/page-01.mp3'),
          (reopened, started, fresh))

    # #library-close is the library's one-level Back (handleBack). While the
    # reader modal is up its own chrome covers the pill (pointer events get
    # intercepted — see the rapid phase), so the seam is exercised with a
    # synthetic dispatch click, same as rapid's library-close storms.
    page.locator('#library-close').dispatch_event('click')  # mid-play teardown
    clean = page.evaluate("""() => ({
        tts: window.__books.ttsState(),
        audioEls: document.querySelectorAll('audio').length})""")
    check('tts: #library-close mid-play leaves a clean state (no narration, no <audio>)',
          clean['tts']['playing'] is False and clean['tts']['source'] == 'none'
          and clean['audioEls'] == 0, clean)

    page.evaluate('window.__books.openBook(14838)')
    page.wait_for_function(
        'window.__books.state().bookId == 14838 && window.__books.state().pageCount === 27')
    marks = {key: len(watch[key]) for key in WATCH_KEYS}
    page.evaluate("""() => {
        for (let i = 0; i < 10; i++) {
            window.__books.tts();
            window.__books.closeBook();
        }
    }""")
    before = tts_snap(page)
    page.wait_for_timeout(300)
    after = tts_snap(page)
    noisy = {key: watch[key][marks[key]:] for key in WATCH_KEYS}
    check('tts: 10x tts()/closeBook() storm: zero errors, state frozen 300ms',
          before == after and not any(noisy.values()),
          {'before': before, 'after': after, 'noise': noisy})

    # ---- fallback ladder on the SIMULATED un-narrated 369 (fetch-rewrite
    # fixture + speech stubs, every init script armed BEFORE app scripts) ---
    def fixture_page(*scripts, label):
        fp = browser.new_page(viewport={'width': 1280, 'height': 900})
        attach_watchers(fp, url, watch)
        for script in scripts:
            fp.add_init_script(script)  # BEFORE any app script runs on goto
        enter(fp, url, check, 'tts', label=label)
        return fp

    def open_fixture_369(fp):
        fp.click('#library-read-button')
        fp.wait_for_function(
            'document.querySelectorAll("button.bookshelf-card[data-book-id]").length === 28')
        fp.click('button.bookshelf-card[data-book-id="369"]')
        fp.wait_for_function(
            'window.__books.state().bookId == 369 && window.__books.state().pageCount === 10')

    # (a) localService Samantha + remote Google: the speech path
    sp = fixture_page(TTS_STUB_LOCAL_MIX, TTS_FETCH_REWRITE,
                      label='speech-stub page entered and char-ready')
    open_fixture_369(sp)  # a NO-audio book via the fetch-rewrite fixture
    st = sp.evaluate('window.__books.ttsState()')
    check('tts: speech stub grades a no-audio page source:"speech" (a local voice exists)',
          st['source'] == 'speech' and st['playing'] is False, st)
    sp.click('#bookreader-tts')  # REAL click — the same toggle as __books.tts()
    sp.wait_for_function('window.__books.ttsState().playing === true')
    st = sp.evaluate('window.__books.ttsState()')
    check('tts: speech stub start: playing:true, source:"speech"',
          st['playing'] is True and st['source'] == 'speech', st)
    spoken = sp.evaluate('window.__ttsStub.spoken')
    dom_text = sp.evaluate('document.getElementById("bookreader-text").textContent')
    page_text = data['books']['369']['pages'][0]['text']
    check('tts: speech stub speaks ONE utterance: rate 1.0, voice Samantha '
          '(local over remote), text == page text',
          len(spoken) == 1 and spoken[0]['rate'] == 1.0
          and spoken[0]['voiceName'] == 'Samantha' and spoken[0]['localService'] is True
          and norm_ws(spoken[0]['text']) == norm_ws(page_text) == norm_ws(dom_text),
          {'spoken': spoken, 'pageText': norm_ws(page_text)})
    path = out / 'tts-stub-speech.png'
    sp.screenshot(path=str(path))
    shots.append(str(path))
    cancels0 = sp.evaluate('window.__ttsStub.cancelCalls')
    sp.click('#bookreader-next')  # mid-speak page turn
    cancels1 = sp.evaluate('window.__ttsStub.cancelCalls')
    st = sp.evaluate('window.__books.ttsState()')
    check('tts: speech stub: mid-speak #bookreader-next calls cancel() and stops (playing:false)',
          cancels1 > cancels0 and st['playing'] is False and st['page'] == 2,
          (cancels0, cancels1, st))
    tts_settle(check, sp,
               'tts: speech stub: late onend after the turn keeps playing:false across '
               '300ms (no zombie flip)', must_be_playing=False)
    sp.close()

    # (b) remote-only voices: NEVER eligible (zero external requests)
    rp = fixture_page(TTS_STUB_REMOTE_ONLY, TTS_FETCH_REWRITE,
                      label='remote-stub page entered and char-ready')
    open_fixture_369(rp)
    st = rp.evaluate('window.__books.ttsState()')
    btn = rp.evaluate("""() => {
        const b = document.getElementById('bookreader-tts');
        return {disabled: b.disabled, title: b.title,
                hidden: b.classList.contains('hidden')};}""")
    check('tts: remote-only voices: source:"none", button disabled with the exact '
          'title "No reading voice on this device yet"',
          st['source'] == 'none' and st['playing'] is False and btn['disabled'] is True
          and not btn['hidden'] and btn['title'] == TTS_NO_VOICE_TITLE, (st, btn))
    started = rp.evaluate('window.__books.tts()')  # must refuse to speak
    spoken_n = rp.evaluate('window.__ttsStub.spoken.length')
    check('tts: remote-only voices: tts() refuses to speak (zero utterances, playing:false)',
          started is False and spoken_n == 0
          and rp.evaluate('window.__books.ttsState().playing') is False,
          (started, spoken_n))
    rp.close()

    # (c) natural headless (NO speech stub, same fetch-rewrite fixture):
    # zero voices -> the disabled state
    np = fixture_page(TTS_FETCH_REWRITE,
                      label='natural-headless page entered and char-ready')
    open_fixture_369(np)
    st = np.evaluate('window.__books.ttsState()')
    btn = np.evaluate("""() => {
        const b = document.getElementById('bookreader-tts');
        return {disabled: b.disabled, title: b.title};}""")
    check('tts: natural headless (no stub) on a no-audio page: source:"none", '
          'disabled "No reading voice on this device yet"',
          st['source'] == 'none' and st['playing'] is False and btn['disabled'] is True
          and btn['title'] == TTS_NO_VOICE_TITLE, (st, btn))
    np.close()

    # ---- credits sheet: the button hides with the page view --------------
    page.evaluate('window.__books.openBook(369)')  # bring the reader back up
    page.wait_for_function(
        'window.__books.state().bookId == 369 && window.__books.state().pageCount === 10')
    page.evaluate('window.__books.showCredits()')
    page.wait_for_function('window.__books.state().view === "credits"')
    hidden = page.evaluate("""() => {
        const b = document.getElementById('bookreader-tts');
        return b.classList.contains('hidden') && !b.getClientRects().length;}""")
    check('tts: #bookreader-tts hidden while the credits sheet shows', hidden)
    path = out / 'tts-credits.png'
    page.screenshot(path=str(path))
    shots.append(str(path))
    phase_gate(check, page, watch, 'tts')


# ----------------------------- main ---------------------------------------

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', help='Existing local server; otherwise start an ephemeral loopback server')
    parser.add_argument('--out', default='/tmp/kilo/book-test')
    parser.add_argument('--quick', action='store_true',
                        help='Run phases 1-3 only (data, shelf, reader) — CI smoke')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results, shots = {}, []
    started = time.time()

    def check(name, ok, detail=None):
        results[name] = {'pass': bool(ok), 'detail': detail}
        print(('PASS ' if ok else 'FAIL ') + name, flush=True)
        assert ok, (name, detail)

    data = phase_data(check)
    with local_server(args.url) as url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            watch = new_watch()
            page = browser.new_page(viewport={'width': 1280, 'height': 900})
            attach_watchers(page, url, watch)
            enter(page, url, check, 'shelf')
            phase_shelf(check, page, out, data, watch, shots)
            phase_reader(check, page, out, data, watch, shots)
            if not args.quick:
                phase_edge(check, page, out, data, watch, shots)
                phase_peel(check, page, out, data, watch, shots)
                phase_rapid(check, page, out, data, watch, shots)
                page.close()
                watch = new_watch()
                page = browser.new_page(viewport={'width': 390, 'height': 844}, has_touch=True)
                attach_watchers(page, url, watch)
                enter(page, url, check, 'portrait')
                phase_portrait(check, page, out, data, watch, shots)
                page.close()
                watch = new_watch()
                page = browser.new_page(viewport={'width': 1280, 'height': 900})
                attach_watchers(page, url, watch)
                enter(page, url, check, 'tts')
                phase_tts(check, page, browser, url, out, data, watch, shots)
        except Exception as exc:
            results['~failure'] = str(exc)
            try:
                path = out / 'failure.png'
                page.screenshot(path=str(path))
                shots.append(str(path))
                results['~failureState'] = {
                    'books': page.evaluate('window.__books ? window.__books.state() : null'),
                    'library': page.evaluate('__library3d ? __library3d.state() : null'),
                }
            except Exception:
                pass
            raise
        finally:
            checks = {k: v for k, v in results.items() if not k.startswith('~')}
            results['~passed'] = sum(1 for v in checks.values() if v['pass'])
            results['~failed'] = sum(1 for v in checks.values() if not v['pass'])
            results['~phaseCounts'] = {
                phase: {
                    'passed': sum(1 for k, v in checks.items()
                                  if k.startswith(phase + ':') and v['pass']),
                    'failed': sum(1 for k, v in checks.items()
                                  if k.startswith(phase + ':') and not v['pass']),
                } for phase in PHASES if any(k.startswith(phase + ':') for k in checks)}
            results['~screenshots'] = shots
            results['~manifestFetches'] = manifest_count(watch) if watch else None
            results['~quick'] = bool(args.quick)
            results['~total_seconds'] = round(time.time() - started, 1)
            (out / 'book-test.json').write_text(json.dumps(results, indent=2))
            browser.close()
    for phase, counts in results['~phaseCounts'].items():
        print(f"{phase}: {counts['passed']} passed / {counts['failed']} failed", flush=True)
    print('report: ' + str(out / 'book-test.json') +
          '  (' + str(results['~passed']) + ' passed / ' +
          str(results['~failed']) + ' failed, ' +
          str(results['~total_seconds']) + 's)', flush=True)


if __name__ == '__main__':
    main()
