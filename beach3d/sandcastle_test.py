"""3D sand-castle feature regression (SAND-CASTLE-PLAN §8) against the
already-running localhost:8123 server.

Repo-style sibling of beach3d/catch_test.py: isolated Chromium contexts,
check(name, ok, detail) helper, report JSON + screenshots under
/tmp/kilo/sandcastle/, sections selectable via --section. UI interactions
are REAL clicks/taps/keys; the window.__beach3d.sandcastle QA hooks are
used only for state polling and deterministic aiming. Artifacts stay
outside the repository.

RESOLUTION PASSES 2026-09-18: the grid runs at N=96 (cell ≈ 2.3 cm). Volume
asserts scale with (n/32)**3 via editor state's n. POUR MODEL (2026-09-18
round 3): the pile is column-wise cones of repose (field.pourCone — no
floating seats, angle-of-repose relaxation); the anti-runaway cap is
asserted in METRES vs the PRE-GESTURE surface (hold rise ≤ 0.25, drag rise
≤ 0.15 + added ≤ 1200·(n/64)³ — strictly inside the old 0.42 pin, never
weakened). INCREMENTAL REBUILD (resolution pass 2): mid-drag steady-state
rebuilds must report the incremental kind with a far lower EMA than the
~90 ms a full 100³ rebuild costs. persist additionally covers the save
v:2 compact-RLE shape, the v:1 (N=32) SAVE-MIGRATION seed, and perf numbers.

Sections:
  desktop   — walk-in, toolbar, drag paint, undo/redo, fort template,
              Done/bake, obstacle, draw-call budget, Escape-in-builder,
              rebuild/bake perf record.
  persist   — autosave shape, reload+Continue reopen (no builder visit),
              edit re-entry equality, corrupt-save self-heal, v:1→v:2
              migration, reset-all.
  mobile    — 420x720 touch + reduced motion: toolbar fit, 44px targets,
              stable stage size, touchscreen tap stamp, drag paint, Escape.
  lifecycle — close the beach mid-build → reopen via map → autosave baked.

Run:  python3 -B beach3d/sandcastle_test.py            (all sections)
      python3 -B beach3d/sandcastle_test.py --section mobile
"""
import argparse
import json
import math
import socket
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright
from ground_contact_test import enter


def server_up(host="127.0.0.1", port=8123):
    try:
        with socket.create_connection((host, port), timeout=2):
            return True
    except OSError:
        return False


# ---------------------- v:1 (N=32) save-migration seed ----------------------
# A miniature pre-resolution castle, byte-identical to what the OLD field
# module produced: fillBase @32 + a 7x7x8 tower block + a low 5x5x4 block,
# RLE-encoded like encode() (base36 count ":" base36 value, ';' joined).
N_REF = 32


def _b36(n):
    if n == 0:
        return "0"
    d = "0123456789abcdefghijklmnopqrstuvwxyz"
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = d[r] + s
    return s


def _rle(bytes_):
    out, i, n = [], 0, len(bytes_)
    while i < n:
        v = bytes_[i]
        j = i + 1
        while j < n and bytes_[j] == v:
            j += 1
        out.append(_b36(j - i) + ":" + _b36(v))
        i = j
    return ";".join(out)


def v1_seed():
    """(rle string, expected rows>=2 solid count @32, decor cell records)."""
    size = N_REF ** 3
    f = bytearray(size)
    idx = lambda x, y, z: x + N_REF * y + N_REF * N_REF * z
    for z in range(N_REF):
        for x in range(N_REF):
            dx, dz = abs(x - (N_REF - 1) / 2), abs(z - (N_REF - 1) / 2)
            if dx <= 13 and dz <= 13 and dx + dz <= 22:
                f[idx(x, 0, z)] = 255
                b = min(13 - dx, 13 - dz, 22 - (dx + dz))
                f[idx(x, 1, z)] = 255 if b >= 7 else max(0, round(255 * b / 7))
    for z in range(13, 20):
        for x in range(13, 20):
            for y in range(2, 10):
                f[idx(x, y, z)] = 160
    for z in range(4, 9):
        for x in range(4, 9):
            for y in range(2, 6):
                f[idx(x, y, z)] = 120
    solid = sum(1 for z in range(N_REF) for x in range(N_REF) for y in range(2, 10)
                if f[idx(x, y, z)] >= 80)
    decor = [{"t": "flag", "x": 16, "y": 9, "z": 16},
             {"t": "shell", "x": 6, "y": 5, "z": 6}]
    return _rle(f), solid, decor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='/tmp/kilo/sandcastle')
    parser.add_argument('--section',
                        choices=['all', 'desktop', 'persist', 'mobile', 'lifecycle'],
                        default='all')
    parser.add_argument('--label', default='',
                        help='optional free-form run label stored in the report')
    args = parser.parse_args()
    if not server_up():
        print('FAIL server: no game server on http://localhost:8123 — '
              'start it with `python3 serve.py` (existing tests assume it is '
              'already running).', flush=True)
        sys.exit(1)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results, errors, external = {}, [], []
    started = time.time()

    def check(name, ok, detail=None):
        results[name] = {'pass': bool(ok), 'detail': detail}
        print(('PASS ' if ok else 'FAIL ') + name, flush=True)
        assert ok, (name, detail)

    def sc(page):
        return page.evaluate('__beach3d.sandcastle.state()')

    def es(page):
        return page.evaluate('__beach3d.sandcastle.editState()')

    def wait_building(page, timeout=15000):
        page.wait_for_function("__beach3d.sandcastle?.state?.()?.phase === 'building'",
                               timeout=timeout)

    def wait_idle(page, timeout=10000):
        page.wait_for_function("__beach3d.sandcastle?.state?.()?.phase === 'idle'",
                               timeout=timeout)

    def status(page):
        return page.evaluate(
            "document.querySelector('#beach-sc-toolbar .beach-sc-status')?.textContent")

    def plot_pt(page, dx, dy, dz):
        """Editor-space meters (plot-center relative, dy above the plot plane)
        → page CSS px through the builder camera."""
        return page.evaluate(
            'p=>__beach3d.sandcastle.projectPoint(p[0], __beach3d.sandcastle.editState().plotY + p[1], p[2])',
            [dx, dy, dz])

    def paint_drag(page, points, steps=8):
        first = points[0]
        page.mouse.move(first['x'], first['y'])
        page.mouse.down()
        for q in points[1:]:
            page.mouse.move(q['x'], q['y'], steps=steps)
        page.mouse.up()
        page.wait_for_timeout(350)   # stroke end → autosave + rebuild settle

    def read_save(page):
        return page.evaluate("""(() => {
            try { return JSON.parse(localStorage.getItem('lily-game-save-v1') || 'null'); }
            catch (e) { return null; } })()""")

    def open_beach(page, via_continue=False, timeout=30000):
        """Navigate to the 3D beach from wherever the page currently is.
        The welcome '🎈 Let's Play!' button ALWAYS GameState.reset()s — a
        page that should keep its save must arrive via '💛 Continue my
        game' (rendered only when a save exists)."""
        if page.locator('#welcome-overlay').is_visible():
            cont = page.locator('#welcome-continue')
            if via_continue and cont.is_visible():
                cont.click()
            else:
                page.click('#welcome-start')
        nav = page.locator('.nav-button[data-screen="map"]')
        if nav.is_visible():
            nav.click()
        page.click('.place[data-place-id="beach"]')
        if page.locator('#beach-scene').is_hidden():
            page.click('#beach-play-button')
        page.wait_for_function(
            "window.__beach3d?.state()?.boat?.ready && __beach3d.state().surf?.ready",
            timeout=timeout)
        assert page.evaluate('__beach3d.waitReady()'), 'GLB failed to load'
        page.wait_for_timeout(1200)

    def new_page(browser, mobile=False):
        kw = dict(viewport={'width': 420 if mobile else 1280,
                            'height': 720 if mobile else 800},
                  has_touch=mobile, is_mobile=mobile)
        if mobile:
            kw['reduced_motion'] = 'reduce'
        context = browser.new_context(**kw)
        page = context.new_page()
        page.set_default_timeout(20000)
        page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
        page.on('console', lambda m: errors.append(m.text)
                if m.type == 'error' and 'ERR_FAILED' not in m.text else None)
        page.on('request', lambda r: external.append(r.url)
                if r.url.startswith(('http:', 'https:'))
                and not r.url.startswith('http://localhost:8123/') else None)
        # enter() route-patches beach3d.js (__qaWorld/__qaChar) before goto.
        return context, page

    def stage_box(page):
        return page.evaluate("""(() => {
            const r = document.getElementById('beach-stage').getBoundingClientRect();
            return {w: +r.width.toFixed(2), h: +r.height.toFixed(2)}; })()""")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            # ------------------------------------------------- desktop ----
            if args.section in ('all', 'desktop'):
                t0 = time.time()
                errs0 = len(errors)
                context, page = new_page(browser)
                enter(page)
                baseline = page.evaluate('__beach3d.performance().calls')
                check('desktop idle draw-call baseline captured', 0 < baseline < 80, baseline)
                build = page.get_by_role('button', name='🏰 Build sand castle', exact=True)
                check('🏰 Build sand castle button visible (emoji in accessible name)',
                      build.is_visible())
                stage_sand = stage_box(page)
                build.click()
                wait_building(page, timeout=12000)
                check('walk-in ends in the builder within ~8s (phase=building)',
                      sc(page)['phase'] == 'building')
                check('desktop stage size unchanged between sand and castle mode',
                      all(abs(stage_sand[k] - stage_box(page)[k]) < 0.6 for k in ('w', 'h')),
                      [stage_sand, stage_box(page)])
                check('overlay carries the mode-castle class',
                      page.evaluate("document.getElementById('beach-scene').classList.contains('mode-castle')"))
                toolbar = page.locator('#beach-sc-toolbar')
                check('builder toolbar visible', toolbar.is_visible())
                nbtn = page.evaluate("document.querySelectorAll('#beach-sc-toolbar button').length")
                check('toolbar holds >= 15 buttons', nbtn >= 15, nbtn)
                check('status line shows the pile instruction',
                      status(page) == 'Pile: drag to add sand', status(page))
                check('normal action bar hidden while building',
                      page.evaluate("document.getElementById('beach-actions').children.length") == 0
                      and page.evaluate("getComputedStyle(document.getElementById('beach-actions')).visibility") == 'hidden',
                      page.evaluate("(() => { const a = document.getElementById('beach-actions'); return {kids: a.children.length, vis: getComputedStyle(a).visibility}; })()"))

                page.evaluate('__beach3d.sandcastle.setTool("pile")')
                n_rt = es(page).get('n') or 32          # runtime grid resolution
                vol = (n_rt / 32.0) ** 3                # same-volume cell count scale
                # POUR MODEL (2026-09-18 round 3) — the pinned runaway repro,
                # RE-PINNED STRONGER for the new physics: a STATIONARY hold
                # must saturate as a repose cone, measured ABOVE the
                # pre-gesture surface (maxHM is the editor's QA surfaceY
                # scan × CELL — never weakened). Old pins (history): the
                # pre-pour-era runaway reached gy 13.12 (~0.9 m arms); the
                # pass-D ellipsoid seat allowed 0.42 m. The pour model caps
                # a 0.6 s hold at 0.25 m of RISE (node-tested saturation
                # ~0.20) and 0.36 m absolute — strictly inside the old pin.
                st_h0 = es(page)                        # empty-field baseline
                hold = plot_pt(page, -3.9, .02, 1.9)
                page.mouse.move(hold['x'], hold['y'])
                page.mouse.down()
                page.wait_for_timeout(600)
                page.mouse.up()
                page.wait_for_timeout(250)
                st_h = es(page)
                solid_h = st_h['stats']['solid']
                rise_h = st_h['maxHM'] - st_h0['maxHM']
                check('0.6 s pile hold saturates at the repose cone '
                      '(rise <= 0.25 m, maxHM <= 0.36 m)',
                      rise_h <= 0.25 and st_h['maxHM'] <= 0.36,
                      [rise_h, st_h['maxHM']])
                results['~hold_height_m'] = st_h['maxHM']
                results['~hold_rise_m'] = rise_h
                check('pile hold deposits a visible mound (solid > 0)',
                      solid_h > 0, solid_h)
                # One press-hold-release = ONE undo step (the frame-hold
                # repeats share the gesture's single snapshot).
                page.get_by_role('button', name='↩️ Undo', exact=True).click()
                page.wait_for_timeout(250)
                check('whole hold gesture undoes in ONE step',
                      sc(page)['stats']['solid'] == 0, sc(page)['stats']['solid'])
                page.get_by_role('button', name='↪️ Redo', exact=True).click()
                page.wait_for_timeout(250)
                check('redo re-applies the whole hold gesture',
                      sc(page)['stats']['solid'] == solid_h,
                      [solid_h, sc(page)['stats']['solid']])
                page.get_by_role('button', name='↩️ Undo', exact=True).click()
                page.wait_for_timeout(250)

                pts = [plot_pt(page, -3.9, .25, 1.9), plot_pt(page, -3.5, .25, 2.2),
                       plot_pt(page, -4.3, .25, 1.6)]
                check('builder camera projects the plot for real drags',
                      all(pt and not pt['behind'] for pt in pts), pts)
                # POUR MODEL pin #2: one drag = a ground-hugging BANK. The
                # old ellipsoid-seat model turned a single 30-step diagonal
                # drag into a ~40° ski-jump ramp (7200+ solid, deposit gy
                # climbing with the cursor 4.9 → 13.9). The pour writes on
                # the LOCAL surfaceY only, so a drag may rise at most
                # 0.15 m above the pre-gesture surface and pour at most
                # ~1200 voxels AT THE REFERENCE N=64 (measured ~600-700;
                # node-pinned bank 0.10) — the cell budget scales with
                # (n/64)³, the PHYSICAL bank (rise in metres) does not.
                vol64 = (n_rt / 64.0) ** 3
                st_d0 = es(page)
                paint_drag(page, pts)
                st_d1 = es(page)
                solid1 = st_d1['stats']['solid']
                rise_d = st_d1['maxHM'] - st_d0['maxHM']
                added_d = solid1 - (st_d0['stats'] or {}).get('solid', 0)
                check('drag lays a low bank (rise <= 0.15 m, added <= %d)' % (1200 * vol64),
                      rise_d <= 0.15 and added_d <= 1200 * vol64, [rise_d, added_d])
                results['~drag_added'] = added_d
                check('real mouse drag piles sand (solid > 0)', solid1 > 0, solid1)
                # RESOLUTION PASS 2 perf: mid-drag rebuilds are INCREMENTAL
                # (dirty-region transfer + targeted normal-cache invalidation;
                # a full 100³ reset+smooth+refill would run ~90 ms here and
                # blow the 80 ms throttle). The EMA must sit far under the
                # full-rebuild cost — the acceptance budget is ~25 ms steady
                # (node-pinned byte-identical vs full); 40 allows rig jitter
                # incl. the one full anchor rebuild at the stroke's first
                # commit still decaying through the EMA.
                rb = es(page)['lastRebuildMs']
                kind = es(page).get('lastRebuildKind')
                results['~rebuild_ms'] = rb
                results['~rebuild_kind'] = kind
                check('steady-state rebuildMesh ran INCREMENTAL mid-drag',
                      kind == 'incr', kind)
                check('incremental rebuildMesh EMA well under the 80 ms throttle',
                      0 < rb <= 40, rb)

                page.get_by_role('button', name='↩️ Undo', exact=True).click()
                page.wait_for_timeout(250)
                solid_u = sc(page)['stats']['solid']
                check('toolbar Undo decreases solid', solid_u < solid1, [solid1, solid_u])
                page.get_by_role('button', name='↪️ Redo', exact=True).click()
                page.wait_for_timeout(250)
                check('toolbar Redo restores solid',
                      sc(page)['stats']['solid'] == solid1,
                      [solid1, sc(page)['stats']['solid']])

                page.get_by_role('button', name='🏰 Fort', exact=True).click()
                page.wait_for_timeout(300)
                solid_f = sc(page)['stats']['solid']
                # Fort template scales ~linearly with the cell count (shell,
                # not solid fill): > 500 @32 (measured 1409) → the same
                # physical floor scaled by vol.
                check('native Fort button fills the plot (scaled > 500*vol)',
                      solid_f > 500 * vol, solid_f)
                results['~fort_solid'] = solid_f
                check('status mentions the fort',
                      'fort' in (status(page) or '').lower(), status(page))
                page.get_by_role('button', name='↩️ Undo', exact=True).click()
                page.wait_for_timeout(250)
                check('Undo works after the template',
                      sc(page)['stats']['solid'] == solid1,
                      [solid1, sc(page)['stats']['solid']])
                page.get_by_role('button', name='↪️ Redo', exact=True).click()
                page.wait_for_timeout(250)
                check('Redo restores the fort',
                      sc(page)['stats']['solid'] == solid_f,
                      [solid_f, sc(page)['stats']['solid']])

                tris_live = es(page)['stats']['tris']
                page.get_by_role('button', name='💾 Done', exact=True).click()
                wait_idle(page)
                st = sc(page)
                check('Done returns to idle with the castle baked',
                      st['phase'] == 'idle' and st['baked'] is True, st)
                # RESOLUTION PASS perf record: one-shot bakeField ms + the
                # frozen mesh triangle count (ONE mesh → the draw-call
                # budget check below stays the arbiter of beach cost).
                results['~bake_ms'] = st.get('bakeMs')
                results['~bake_tris'] = tris_live
                page.screenshot(path=str(out / 'desktop-baked.png'))
                check('button label flips to 🏰 Edit sand castle',
                      page.get_by_role('button', name='🏰 Edit sand castle', exact=True).is_visible())

                page.evaluate('__beach3d.setTarget(-3.9, 1.9)')
                page.wait_for_timeout(3000)
                a = page.evaluate('(()=>{const s=__beach3d.state();return {x:s.x,z:s.z}})()')
                dist = math.hypot(a['x'] + 3.9, a['z'] - 1.9)
                check('baked castle obstacle stops her > 1.0 m from the plot',
                      dist > 1.0, round(dist, 3))
                page.evaluate('__beach3d.setTarget(0, 2.6)')
                page.wait_for_timeout(1000)

                calls = page.evaluate('__beach3d.performance().calls')
                check('baked castle stays inside the draw-call budget',
                      calls <= baseline + 14 and calls < 80,
                      {'baseline': baseline, 'after': calls})

                # ----------------------- visual QA captures (NON-FATAL) ---
                # Visual pass 2026-09-18: the default builder camera is
                # straight-down and hides form/grounding regressions, so QA
                # MUST also see the low side angles. These use the QA camera
                # hook (__beach3d.sandcastle.setCamView / orbitTo) and
                # record outcomes as '~'-entries (strings — never counted
                # as passes/failures; a capture error cannot break the run).
                def vshot(name, fn):
                    try:
                        fn()
                        page.wait_for_timeout(250)
                        page.screenshot(path=str(out / name))
                        results['~shot_' + name] = 'ok'
                    except Exception as e:
                        results['~shot_' + name] = 'ERROR ' + str(e)[:200]

                def cam_view(name):
                    page.evaluate('v => __beach3d.sandcastle.setCamView(v)', name)

                def bake_low_view(corner=False):
                    # Park the MAIN beach camera at the sand line beside the
                    # plot (runtime-patch updateCamera only, restore after).
                    page.evaluate("""(corner) => {
                        const w = __qaWorld;
                        if (!w.__uc) { w.__uc = w.updateCamera; }
                        w.updateCamera = () => {};
                        const g = w.scene.getObjectByName('sandcastleBake');
                        const y = g ? g.position.y : 0.2;
                        const cx = -3.9, cz = 1.9;
                        const px = corner ? cx + 2.0 : cx - 0.25;
                        const pz = corner ? cz + 1.85 : cz + 2.45;
                        w.camera.position.set(px, y + 0.30, pz);
                        w.camera.lookAt(cx, y + 0.40, cz);
                        w.camera.updateMatrixWorld();
                    }""", corner)

                def bake_restore():
                    page.evaluate("""() => {
                        const w = __qaWorld;
                        if (w.__uc) { w.updateCamera = w.__uc; delete w.__uc; }
                    }""")

                try:
                    def reset_field():
                        # double-press arm: first press disarms the second
                        btn = page.get_by_role('button', name='🧺 Reset', exact=True)
                        btn.click(); page.wait_for_timeout(150); btn.click()
                        page.wait_for_timeout(250)

                    page.get_by_role('button', name='🏰 Edit sand castle', exact=True).click()
                    wait_building(page)
                    reset_field()
                    page.evaluate('__beach3d.sandcastle.applyTemplate("keep")')
                    page.wait_for_timeout(300)
                    vshot('keep-low.png', lambda: cam_view('low'))
                    vshot('keep-corner.png', lambda: cam_view('corner'))
                    cam_view('default')          # pointer aiming projects through it
                    reset_field()
                    # Freeform pile like a kid would: a few bounded hold clusters
                    page.evaluate('__beach3d.sandcastle.setTool("pile")')
                    for (dx, dz) in [(0.0, 0.0), (0.35, 0.25), (-0.3, -0.2)]:
                        c = plot_pt(page, -3.9 + dx, .02, 1.9 + dz)
                        page.mouse.move(c['x'], c['y'])
                        page.mouse.down()
                        for i in range(20):
                            page.mouse.move(c['x'] + (0.6 if i % 2 else -0.6),
                                            c['y'] + (0.5 if i % 3 else -0.5))
                            page.wait_for_timeout(18)
                        page.mouse.up()
                        page.wait_for_timeout(120)
                    es_pile = es(page)
                    results['~pile_stats'] = 'maxHM=%s solid=%s' % (
                        es_pile.get('maxHM'), (es_pile.get('stats') or {}).get('solid'))
                    vshot('pile-low.png', lambda: cam_view('low'))
                    vshot('pile-corner.png', lambda: cam_view('corner'))
                    cam_view('default')
                    page.get_by_role('button', name='💾 Done', exact=True).click()
                    wait_idle(page)
                    # Bake shot = the FORT (the before-evidence bake was the
                    # fort template too — same subject for the before→after).
                    page.get_by_role('button', name='🏰 Edit sand castle', exact=True).click()
                    wait_building(page)
                    reset_field()
                    page.evaluate('__beach3d.sandcastle.applyTemplate("fort")')
                    page.wait_for_timeout(300)
                    # RESOLUTION PASS 2 captures: fort + mound at the crisp
                    # side angles (non-fatal '~' entries like the other shots).
                    vshot('fort-low.png', lambda: cam_view('low'))
                    vshot('fort-corner.png', lambda: cam_view('corner'))
                    reset_field()
                    page.evaluate('__beach3d.sandcastle.applyTemplate("mound")')
                    page.wait_for_timeout(300)
                    vshot('mound-low.png', lambda: cam_view('low'))
                    vshot('mound-corner.png', lambda: cam_view('corner'))
                    cam_view('default')
                    page.get_by_role('button', name='💾 Done', exact=True).click()
                    wait_idle(page)
                    # bake again from the FORT for the main-beach camera shots
                    page.get_by_role('button', name='🏰 Edit sand castle', exact=True).click()
                    wait_building(page)
                    reset_field()
                    page.evaluate('__beach3d.sandcastle.applyTemplate("fort")')
                    page.wait_for_timeout(300)
                    page.get_by_role('button', name='💾 Done', exact=True).click()
                    wait_idle(page)
                    vshot('bake-low.png', lambda: bake_low_view(False))
                    vshot('bake-corner.png', lambda: bake_low_view(True))
                    bake_restore()
                except Exception as e:
                    results['~shots_error'] = str(e)[:300]
                    try:
                        bake_restore()
                    except Exception:
                        pass
                # ----------------------------------------------------------

                page.get_by_role('button', name='🏰 Edit sand castle', exact=True).click()
                wait_building(page)
                page.keyboard.press('Escape')
                wait_idle(page)
                check('Escape exits the builder but keeps the beach open',
                      page.evaluate('__beach3d.state() !== null && Beach3D.isOpen()'))
                check('no uncaught browser errors (desktop)',
                      len(errors) == errs0, errors[errs0:])
                results['~desktop_seconds'] = round(time.time() - t0, 1)
                context.close()

            # ------------------------------------------------- persist ----
            if args.section in ('all', 'persist'):
                t0 = time.time()
                errs0 = len(errors)
                context, page = new_page(browser)
                enter(page)
                fresh = sc(page)
                check('fresh visit: no castle baked or saved',
                      fresh['baked'] is False and fresh['saved'] is False, fresh)
                page.get_by_role('button', name='🏰 Build sand castle', exact=True).click()
                wait_building(page)
                page.evaluate('__beach3d.sandcastle.applyTemplate("fort")')
                page.wait_for_timeout(250)
                solid_before = sc(page)['stats']['solid']
                n_rt = (es(page) or {}).get('n') or 32
                check('fort seeded before the save (scaled)',
                      solid_before > 500 * (n_rt / 32.0) ** 3, solid_before)
                page.get_by_role('button', name='🚩 Flag', exact=True).click()
                page.wait_for_timeout(200)
                tap = plot_pt(page, -3.9, .3, 1.9)
                page.mouse.move(tap['x'], tap['y'])
                page.mouse.down()
                page.mouse.up()
                page.wait_for_timeout(300)
                check('flag decor placed through the toolbar tool',
                      sc(page)['decorCount'] == 1, sc(page)['decorCount'])
                page.get_by_role('button', name='💾 Done', exact=True).click()
                wait_idle(page)
                check('setup Done bakes the castle', sc(page)['baked'] is True)

                save = read_save(page)
                sd = (save or {}).get('sandcastle')
                check('localStorage save holds a valid v:2 sandcastle key '
                      '(runtime n + compact grid > 100 chars)',
                      bool(sd) and sd.get('v') == 2 and sd.get('n') == n_rt
                      and isinstance(sd.get('grid'), str)
                      and len(sd['grid']) > 100 and isinstance(sd.get('decor'), list),
                      sd and {'v': sd.get('v'), 'n': sd.get('n'),
                              'len': len(sd.get('grid') or '')})
                # RESOLUTION PASS 2: the grid uses the COMPACT byte-packed
                # format (base64 behind the "~" marker — never a base36 ":"
                # run separator), and a real castle stays inside the guard.
                check('grid string is the compact ~base64 format under the 256 KB guard',
                      bool(sd) and sd['grid'].startswith('~') and ':' not in sd['grid']
                      and len(sd['grid']) < 262144,
                      sd and (sd.get('grid') or '')[:8])

                page.reload(wait_until='networkidle')
                open_beach(page, via_continue=True)
                st = sc(page)
                check('reload + Continue → castle baked WITHOUT entering the builder',
                      st['baked'] is True and st['phase'] == 'idle', st)
                check('bake mesh present and visible in the beach scene',
                      page.evaluate("(() => { const g = __qaWorld.scene.getObjectByName('sandcastleBake'); return !!g && g.visible; })()"))
                check('castle obstacle registered after reload',
                      any(o.get('id') == 'sandcastle'
                          for o in page.evaluate('__beach3d.collisions()')))
                page.screenshot(path=str(out / 'reload-baked.png'))
                check('label is 🏰 Edit sand castle after reload',
                      page.get_by_role('button', name='🏰 Edit sand castle', exact=True).is_visible())

                page.get_by_role('button', name='🏰 Edit sand castle', exact=True).click()
                wait_building(page)
                st2 = sc(page)
                check('edit re-entry loads the same solid count',
                      st2['stats']['solid'] == solid_before,
                      [solid_before, st2['stats']['solid']])
                check('edit re-entry restores the 1 decor record',
                      st2['decorCount'] == 1, st2['decorCount'])
                page.get_by_role('button', name='💾 Done', exact=True).click()
                wait_idle(page)

                page.evaluate("""() => {
                    const s = JSON.parse(localStorage.getItem('lily-game-save-v1'));
                    s.sandcastle = { v: 1, grid: 'garbage!!!', decor: [] };
                    localStorage.setItem('lily-game-save-v1', JSON.stringify(s)); }""")
                page.reload(wait_until='networkidle')
                open_beach(page, via_continue=True)
                st3 = sc(page)
                check('corrupt grid decodes to no castle (baked/saved false)',
                      st3['baked'] is False and st3['saved'] is False, st3)
                check('corrupt save shows the Build label',
                      page.get_by_role('button', name='🏰 Build sand castle', exact=True).is_visible())
                page.screenshot(path=str(out / 'persist-corrupt.png'))

                # ---- RESOLUTION PASS: v:1 (N=32) SAVE MIGRATION ----------
                # Seed an OLD-format save ({v:1, RLE of 32³, cell-int
                # decor}). The load path must decode at the save's native
                # size, TRILINEARLY RESAMPLE to runtime N and convert the
                # decor to plot-local metres — the castle survives
                # recognizably (non-empty field at N, same physical decor),
                # never vanishes/blobs/shifts. Storage stays v:1 bytes
                # until the player actually changes something (lazy
                # upgrade — the no-op-safe autosave design holds).
                grid1, solid1_ref, decor1 = v1_seed()
                page.evaluate("""([g, dec]) => {
                    const s = JSON.parse(localStorage.getItem('lily-game-save-v1') || '{}');
                    s.sandcastle = { v: 1, grid: g, decor: dec };
                    localStorage.setItem('lily-game-save-v1', JSON.stringify(s)); }""",
                    [grid1, decor1])
                page.reload(wait_until='networkidle')
                open_beach(page, via_continue=True)
                st5 = sc(page)
                check('v:1 (N=32) save migrates: baked on load + obstacle',
                      st5['baked'] is True and st5['phase'] == 'idle' and
                      any(o.get('id') == 'sandcastle'
                          for o in page.evaluate('__beach3d.collisions()')), st5)
                page.screenshot(path=str(out / 'migrate-bake.png'))
                sd5 = (read_save(page) or {}).get('sandcastle')
                check('migration is lazy: untouched load keeps the v:1 bytes',
                      bool(sd5) and sd5.get('v') == 1 and sd5.get('grid') == grid1,
                      bool(sd5) and sd5.get('v'))
                page.get_by_role('button', name='🏰 Edit sand castle', exact=True).click()
                wait_building(page)
                st6 = sc(page)
                es6 = es(page) or {}
                n_run = es6.get('n') or 32
                vol6 = (n_run / 32.0) ** 3
                check('migrated castle is a valid NON-EMPTY field at runtime N',
                      n_run != 32 and st6['stats']['solid'] > solid1_ref * vol6 * 0.55,
                      {'solid': st6['stats']['solid'], 'src': solid1_ref,
                       'expect~': round(solid1_ref * vol6)})
                c0 = 2.2 / 32.0
                exp = {('flag', 16, 9, 16): ((16 + 0.5) * c0 - 1.1, (9 + 1 - 2) * c0, (16 + 0.5) * c0 - 1.1),
                       ('shell', 6, 5, 6): ((6 + 0.5) * c0 - 1.1, (5 + 1 - 2) * c0, (6 + 0.5) * c0 - 1.1)}
                got = sorted(es6.get('decor') or [], key=lambda d: d['t'])
                check('migrated decor = plot-local metres at the SAME physical spot',
                      st6['decorCount'] == 2 and
                      all(abs(g['x'] - e[0]) < 2e-3 and abs(g['y'] - e[1]) < 2e-3 and
                          abs(g['z'] - e[2]) < 2e-3
                          for g, e in zip(got, [exp[('flag', 16, 9, 16)],
                                                exp[('shell', 6, 5, 6)]])),
                      got)
                page.evaluate('__beach3d.sandcastle.applyTemplate("keep")')
                page.wait_for_timeout(300)
                page.get_by_role('button', name='💾 Done', exact=True).click()
                wait_idle(page)
                sd6 = (read_save(page) or {}).get('sandcastle')
                check('real edit after migration re-saves as v:2 (runtime n)',
                      bool(sd6) and sd6.get('v') == 2 and sd6.get('n') == n_run
                      and sd6.get('grid') != grid1,
                      bool(sd6) and {'v': sd6.get('v'), 'n': sd6.get('n')})
                # ----------------------------------------------------------

                # The migration flow above left a baked keep → the button
                # is the Edit label here; the reset-all flow below works
                # from either entry point.
                for lab in ('🏰 Build sand castle', '🏰 Edit sand castle'):
                    if page.get_by_role('button', name=lab, exact=True).is_visible():
                        page.get_by_role('button', name=lab, exact=True).click()
                        break
                wait_building(page)
                reset = page.get_by_role('button', name='🧺 Reset', exact=True)
                reset.click()
                reset.click()
                page.wait_for_timeout(300)
                check('double-press reset clears field and decor',
                      sc(page)['stats']['solid'] == 0 and sc(page)['decorCount'] == 0,
                      sc(page))
                page.get_by_role('button', name='💾 Done', exact=True).click()
                wait_idle(page)
                page.wait_for_timeout(400)
                st4 = sc(page)
                save4 = read_save(page) or {}
                check('reset-all Done: no bake and the save key is cleared',
                      st4['baked'] is False and not save4.get('sandcastle'),
                      bool(save4.get('sandcastle')))
                check('label back to 🏰 Build sand castle',
                      page.get_by_role('button', name='🏰 Build sand castle', exact=True).is_visible())
                check('no uncaught browser errors (persist)',
                      len(errors) == errs0, errors[errs0:])
                results['~persist_seconds'] = round(time.time() - t0, 1)
                context.close()

            # -------------------------------------------------- mobile ----
            if args.section in ('all', 'mobile'):
                t0 = time.time()
                errs0 = len(errors)
                context, page = new_page(browser, mobile=True)
                enter(page)
                check('reduced motion context active',
                      page.evaluate('__beach3d.state().rm') is True)
                stage_before = stage_box(page)
                page.get_by_role('button', name='Menu', exact=True).tap()
                page.get_by_role('button', name='🏰 Build sand castle', exact=True).tap()
                wait_building(page)
                toolbar = page.locator('#beach-sc-toolbar')
                check('mobile builder toolbar visible', toolbar.is_visible())
                m = page.evaluate("""(() => {
                    const b = [...document.querySelectorAll('#beach-sc-toolbar button')];
                    return {n: b.length,
                            minH: Math.min(...b.map(x => x.getBoundingClientRect().height)),
                            toolH: document.getElementById('beach-sc-toolbar').getBoundingClientRect().height,
                            cap: innerHeight * 0.34}; })()""")
                check('mobile toolbar holds all buttons', m['n'] >= 15, m['n'])
                check('mobile touch targets >= 44px (43 rounding tolerance)',
                      m['minH'] >= 43, m)
                check('mobile toolbar height within 34vh cap', m['toolH'] <= m['cap'], m)
                stage_during = stage_box(page)
                check('mobile stage size unchanged between sand and castle mode',
                      abs(stage_before['w'] - stage_during['w']) < 0.6
                      and abs(stage_before['h'] - stage_during['h']) < 0.6,
                      [stage_before, stage_during])
                page.screenshot(path=str(out / 'mobile-toolbar.png'))

                page.evaluate('__beach3d.sandcastle.setTool("tower")')
                tap = plot_pt(page, -3.9, .3, 1.9)
                page.touchscreen.tap(tap['x'], tap['y'])
                page.wait_for_timeout(300)
                solid_t = sc(page)['stats']['solid']
                check('touchscreen tap commits a tower stamp (solid > 0)',
                      solid_t > 0, solid_t)

                page.evaluate('__beach3d.sandcastle.setTool("pile")')
                pts = [plot_pt(page, -4.3, .3, 2.3), plot_pt(page, -3.6, .3, 1.6)]
                paint_drag(page, pts)
                solid_m = sc(page)['stats']['solid']
                check('mouse drag piles sand in the touch context',
                      solid_m > solid_t, [solid_t, solid_m])

                page.keyboard.press('Escape')
                wait_idle(page)
                check('mobile Escape returns to the open beach',
                      page.evaluate('__beach3d.state() !== null && Beach3D.isOpen()'))
                check('no uncaught browser errors (mobile)',
                      len(errors) == errs0, errors[errs0:])
                results['~mobile_seconds'] = round(time.time() - t0, 1)
                context.close()

            # ----------------------------------------------- lifecycle ----
            if args.section in ('all', 'lifecycle'):
                t0 = time.time()
                errs0 = len(errors)
                context, page = new_page(browser)
                enter(page)
                page.get_by_role('button', name='🏰 Build sand castle', exact=True).click()
                wait_building(page)
                page.evaluate('__beach3d.sandcastle.setTool("pile")')
                pts = [plot_pt(page, -3.9, .25, 1.9), plot_pt(page, -3.7, .25, 2.1),
                       plot_pt(page, -4.1, .25, 1.7)]
                paint_drag(page, pts)
                solid_l = sc(page)['stats']['solid']
                check('mid-build stroke piles sand', solid_l > 0, solid_l)
                page.click('#beach-close')   # ⬅️ Back — beach close mid-build
                page.wait_for_function('window.__beach3d?.state?.() === null', timeout=10000)
                check('⬅️ Back closes the beach to the map',
                      page.locator('#beach-scene').is_hidden())
                open_beach(page)
                st = sc(page)
                check('reopen bakes the autosaved castle (close mid-build saved)',
                      st['baked'] is True and st['phase'] == 'idle', st)
                check('reopen label is 🏰 Edit sand castle',
                      page.get_by_role('button', name='🏰 Edit sand castle', exact=True).is_visible())
                page.screenshot(path=str(out / 'lifecycle-reopen.png'))
                page.get_by_role('button', name='🏰 Edit sand castle', exact=True).click()
                wait_building(page)
                check('reopened session seeds the mid-build stroke',
                      sc(page)['stats']['solid'] == solid_l,
                      [solid_l, sc(page)['stats']['solid']])
                page.keyboard.press('Escape')
                wait_idle(page)
                check('no uncaught browser errors (lifecycle)',
                      len(errors) == errs0, errors[errs0:])
                results['~lifecycle_seconds'] = round(time.time() - t0, 1)
                context.close()

            check('no external network dependencies', not external, external)
        finally:
            results['~label'] = args.label
            results['~total_seconds'] = round(time.time() - started, 1)
            results['~passed'] = sum(1 for v in results.values()
                                     if isinstance(v, dict) and v.get('pass'))
            results['~failed'] = sum(1 for v in results.values()
                                     if isinstance(v, dict) and not v.get('pass'))
            (out / 'sandcastle-test.json').write_text(json.dumps(results, indent=2))
            print('report: ' + str(out / 'sandcastle-test.json') +
                  '  (' + str(results['~passed']) + ' passed / ' +
                  str(results['~failed']) + ' failed, ' +
                  str(results['~total_seconds']) + 's)', flush=True)
            browser.close()


if __name__ == '__main__':
    main()
