"""Native catch/collision/lifecycle checks on the existing localhost:8123 server.

Uses an isolated Chromium profile. Catch is driven by real mouse/touch/buttons;
collision fixtures use QA placement, then native press/hold locomotion. Explicit
algorithm checks are separate from the native cases. No asset or save edits.
"""
import argparse
import json
import math
from pathlib import Path

from playwright.sync_api import sync_playwright
from ground_contact_test import enter


TRACE = """() => {
    window.catchTrace=[];
    const sample=()=>{
        const c=__beach3d.catch(),p=__beach3d.state();
        if(c && p) catchTrace.push({time:performance.now(),phase:c.phase,ball:c.ball,
            flight:c.flight,player:{x:p.x,z:p.z},friend:c.friend && {x:c.friend.x,z:c.friend.z,entered:c.friend.entered},
            obstacles:__beach3d.collisions()});
        if(window.traceCatch)requestAnimationFrame(sample);
    };
    window.traceCatch=true;sample();
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='/tmp/kilo/beach-catch')
    parser.add_argument('--section', choices=['all', 'native', 'collision', 'lifecycle', 'mobile', 'acceptance', 'review'], default='all')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results, errors, external = {}, [], []

    def check(name, ok, detail=None):
        results[name] = {'pass': bool(ok), 'detail': detail}
        print(('PASS ' if ok else 'FAIL ') + name, flush=True)
        assert ok, (name, detail)

    def state(page):
        return page.evaluate('__beach3d.catch()')

    def wait_phase(page, phase, timeout=45000):
        page.wait_for_function('p=>__beach3d.catch()?.phase===p', arg=phase, timeout=timeout)

    def ball_tap(page, touch=False):
        p = page.evaluate('(()=>{const b=__beach3d.catch().ball;return __beach3d.project(b.x,b.y,b.z)})()')
        (page.touchscreen.tap if touch else page.mouse.click)(p['x'], p['y'])

    def stop(page):
        page.get_by_role('button', name='Stop playing', exact=True).click()
        wait_phase(page, 'ground')

    def new_page(browser, mobile=False, audit=False, registry=False):
        context = browser.new_context(viewport={'width':420 if mobile else 1280, 'height':720 if mobile else 800},
                                      has_touch=mobile, is_mobile=mobile)
        page = context.new_page()
        page.set_default_timeout(20000)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'ERR_FAILED' not in m.text else None)
        page.on('request', lambda r: external.append(r.url) if r.url.startswith(('http:', 'https:'))
                and not r.url.startswith('http://localhost:8123/') else None)
        if audit:
            def expose_mixers(route):
                response = route.fetch()
                body = response.text().replace('mixer = new THREE.AnimationMixer(gltf.scene);',
                    'mixer = new THREE.AnimationMixer(gltf.scene); '
                    '(window.__qaMixers ||= new WeakMap()).set(mixRoot, {mixer, actions});')
                route.fulfill(response=response, body=body)
            page.route('**/beach3d/character3d.js', expose_mixers)
        if registry:
            def expose_registry(route):
                response = route.fetch()
                body = response.text().replace('const activities = [];',
                    'const activities = []; window.__qaActivities = activities;')
                route.fulfill(response=response, body=body)
            page.route('**/js/beach.js', expose_registry)
        enter(page)
        return context, page

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            if args.section in ('all', 'native'):
                context, page = new_page(browser)
                page.evaluate('GameState.setOutfitSlot("swimsuit","suit2");GameState.setOutfitSlot("hair","hair3")')
                page.wait_for_function('__beach3d.appearance().suit==="suit2" && __beach3d.appearance().hair==="hair3"')
                save = page.evaluate('localStorage.getItem("lily-game-save-v1")')
                appearance = page.evaluate('__beach3d.appearance()')
                page.screenshot(path=str(out / 'desktop-ground.png'))
                page.evaluate(TRACE)
                ball_tap(page)
                check('native existing ball starts a collision-safe approach', state(page)['phase'] == 'approach')
                check('Throw unavailable until both players arrive', page.get_by_role('button', name='Throw ball').is_disabled())
                check('duplicate start rejected', not page.evaluate('__beach3d.catchStart()'))
                wait_phase(page, 'entering')
                page.wait_for_function('__beach3d.catch().friend?.entered && __beach3d.catch().friend.x>-4')
                page.screenshot(path=str(out / 'desktop-entry.png'))
                wait_phase(page, 'ready')
                ready = state(page)
                check('random OTHER friend with independent suit and hair', ready['friend']['id'] != appearance['friend']
                      and ready['friend']['suit'] in [f'suit{i}' for i in range(1, 7)]
                      and ready['friend']['hair'] in [f'hair{i}' for i in range(1, 7)]
                      and ready['friend']['appearance']['friend'] == ready['friend']['id'], ready['friend'])
                check('player appearance and persistent save unchanged', page.evaluate('localStorage.getItem("lily-game-save-v1")') == save
                      and page.evaluate('__beach3d.appearance().materials') == appearance['materials'])
                independent = page.evaluate("""()=>{
                    const a=[],b=[];
                    __qaChar.root.traverse(m=>{if(m.isSkinnedMesh)a.push(m)});
                    __qaWorld.scene.getObjectByName('catchFriend').traverse(m=>{if(m.isSkinnedMesh)b.push(m)});
                    window.playerDisposals=0;
                    for(const mesh of a) for(const resource of [mesh.material,mesh.geometry])
                        resource.addEventListener('dispose',()=>playerDisposals++);
                    return a.length && b.length && a.every(x=>b.every(y=>x.material!==y.material &&
                        x.geometry!==y.geometry && x.skeleton!==y.skeleton && x.skeleton.bones[0]!==y.skeleton.bones[0]));
                }""")
                check('loaded materials, geometry, skeletons and bones are independent', independent)
                hands = page.evaluate("""async()=>{
                    const {Vector3}=await import('/lib/three/three.module.js'),b=__beach3d.catch().ball;
                    __qaChar.root.updateMatrixWorld(true);
                    return ['Left','Right'].map(side=>__qaChar.root.getObjectByName('mixamorig'+side+'Hand')
                        .getWorldPosition(new Vector3()).distanceTo(new Vector3(b.x,b.y,b.z)));
                }""")
                check('both hands visibly reach the held ball surface', all(abs(d - .26) < .11 for d in hands), hands)
                check('boat and surf mutually gated during catch', page.evaluate('!__beach3d.boatBoard() && !__beach3d.surfToggle() && !__beach3d.surfCatch()'))
                page.keyboard.press('Minus')
                zoom = page.evaluate('__beach3d.state().zoomTarget')
                page.wait_for_timeout(600)
                page.screenshot(path=str(out / 'desktop-ready.png'))
                page.get_by_role('button', name='Throw ball', exact=True).click()
                page.wait_for_function('__beach3d.catch().phase==="outbound" && __beach3d.catch().flight.time>.3')
                page.screenshot(path=str(out / 'desktop-arc.png'))
                wait_phase(page, 'friendCatch')
                check('visible friend catch and held ball', state(page)['holder'] == 'friend' and state(page)['catches'] == 1)
                page.screenshot(path=str(out / 'desktop-friend-catch.png'))
                wait_phase(page, 'ready')
                check('friendly automatic return catches without auto-rethrow', state(page)['catches'] == 2 and state(page)['throws'] == 1)
                page.wait_for_timeout(800)
                check('ready waits for another player interaction', state(page)['phase'] == 'ready')
                ball_tap(page)
                wait_phase(page, 'outbound')
                wait_phase(page, 'ready')
                friend_point = page.evaluate('(()=>{const f=__beach3d.catch().friend;return __beach3d.project(f.x,.8,f.z)})()')
                page.mouse.click(friend_point['x'], friend_point['y'])
                wait_phase(page, 'outbound')
                check('ball and friend taps both throw', state(page)['throws'] == 3)
                page.get_by_role('button', name='Stop playing', exact=True).click()
                wait_phase(page, 'leaving')
                leaving = state(page)
                page.wait_for_function('__beach3d.catch().friend?.x < -2.3')
                page.screenshot(path=str(out / 'desktop-drop-exit.png'))
                check('Stop mid-flight lands ball before friend exits', leaving['ball']['grounded'] and leaving['friend']['entered'])
                wait_phase(page, 'ground')
                check('friend fully disposed without disposing player resources', page.evaluate(
                    '!__qaWorld.scene.getObjectByName("catchFriend") && playerDisposals===0'))
                check('zoom and save survive catch and Stop', page.evaluate('__beach3d.state().zoomTarget') == zoom
                      and page.evaluate('localStorage.getItem("lily-game-save-v1")') == save)
                trace = page.evaluate('window.traceCatch=false;catchTrace')
                (out / 'native-trace.json').write_text(json.dumps(trace, indent=2))
                arcs = [s for s in trace if s['flight'] and s['phase'] in ('outbound', 'inbound')]
                check('both flight directions have substantial visible arcs', all(any(s['phase'] == phase and
                      s['ball']['y'] > max(s['flight']['from']['y'], s['flight']['to']['y']) + .8 for s in arcs)
                      for phase in ('outbound', 'inbound')))
                minimum = min(math.hypot(a['x']-o['x'], a['z']-o['z']) - o['radius'] - .26
                              for s in trace for a in [s['player']] + ([s['friend']] if s['friend'] and s['friend']['entered'] else [])
                              for o in s['obstacles'])
                check('all observed approach, entry and exit anchors clear both colliders', minimum > -.003, minimum)
                entry = [s for s in trace if s['phase'] == 'entering' and s['friend'] and s['friend']['entered']]
                walk = next(s for s in entry if s['friend']['x'] > -1.3)
                seconds = (walk['time'] - entry[0]['time']) / 1000
                check('guest quickly walks across the scene instead of teleporting', seconds < 5
                      and len({round(s['friend']['x'], 2) for s in entry}) > 20, {'seconds': seconds})
                context.close()

            if args.section in ('all', 'collision'):
                context, page = new_page(browser)
                page.evaluate('__beach3d.setZoom(1.6)')
                page.wait_for_timeout(1000)
                # Fixture placement only; the following movement uses native holds.
                def hold_to(x, z, ms):
                    target = page.evaluate('p=>__beach3d.project(p[0],.12,p[1])', [x, z])
                    page.mouse.move(target['x'], target['y']); page.mouse.down()
                    page.wait_for_timeout(ms); page.mouse.up()
                    return page.evaluate('__beach3d.state()')
                page.evaluate('__beach3d.teleport(-4.3,1.9)'); page.wait_for_timeout(100)
                blocked = hold_to(-6.1, 1.9, 2300)
                check('native hold cannot cross umbrella POST', blocked['x'] > -5.11 and abs(blocked['z'] - 1.9) < .015, blocked)
                page.screenshot(path=str(out / 'collision-post.png'))
                page.evaluate('__beach3d.teleport(-4.3,2.55)'); page.wait_for_timeout(100)
                under = hold_to(-6.1, 2.55, 2300)
                check('can walk under canopy outside narrow post collider', under['x'] < -5.8, under)
                page.evaluate('__beach3d.teleport(4,3.4)'); page.wait_for_timeout(100)
                blocked_ball = hold_to(6.1, 3.4, 2300)
                check('native hold cannot cross grounded ball', blocked_ball['x'] <= 4.681 and abs(blocked_ball['z'] - 3.4) < .015, blocked_ball)
                page.screenshot(path=str(out / 'collision-ball.png'))
                ball_tap(page)
                wait_phase(page, 'ready')
                check('pickup succeeds directly from grounded ball collision contact', True)
                stop(page)
                dropped = state(page)['ball']
                page.evaluate('b=>__beach3d.teleport(b.x-1.1,b.z)', dropped)
                page.wait_for_timeout(100)
                blocked_drop = hold_to(dropped['x'] + 1.1, dropped['z'], 2200)
                check('dropped ball collider follows its new ground position', blocked_drop['x'] < dropped['x'] - .519, blocked_drop)
                # Restore the original ball by a real close/open before the post-route fixture.
                page.click('#beach-close'); page.click('#beach-play-button')
                page.wait_for_function('__beach3d.state()?.boat?.ready && __beach3d.state()?.surf?.ready')
                page.evaluate('__beach3d.waitReady()')
                page.evaluate('__beach3d.teleport(-6.05,1.9)'); page.wait_for_timeout(100)
                page.get_by_role('button', name='Play catch', exact=True).click()
                check('scripted approach routes around post rather than trapping', len(state(page)['playerPath']) > 1, state(page)['playerPath'])
                wait_phase(page, 'ready')
                stop(page)
                algorithms = page.evaluate("""async()=>{
                    const {moveAroundProps,routeAroundProps}=await import('/beach3d/collision3d.js');
                    const o=[{x:0,z:0,radius:.26}],from={x:-2,z:0};
                    const sweep=moveAroundProps(from,{x:2,z:0},o);
                    const escape=moveAroundProps({x:0,z:0},{x:1,z:0},o);
                    const path=routeAroundProps(from,{x:2,z:0},o,{xMin:-3,xMax:3,zMin:-3,zMax:3});
                    return {sweep,escape,path};
                }""")
                check('explicit swept long-step, overlap recovery and path checks', algorithms['sweep']['x'] < -.519
                      and algorithms['escape']['x'] >= .52 and len(algorithms['path']) > 1, algorithms)
                context.close()

            if args.section in ('all', 'lifecycle'):
                context, page = new_page(browser)
                palette = []
                page.route('**/beach3d/assets/face_mei.png', lambda r: palette.append(r))
                page.evaluate('GameState.setCharacterId("mei")')
                page.wait_for_timeout(200)
                check('active palette request is delayed for identity race', len(palette) == 1 and page.evaluate('__beach3d.appearance().friend') == 'lily')
                page.get_by_role('button', name='Play catch', exact=True).click()
                check('guest excludes both requested and still-displayed player identity', state(page)['friend']['id'] not in ('lily', 'mei'))
                stop(page)
                palette[0].continue_()
                page.wait_for_function('__beach3d.appearance().friend==="mei"')
                page.unroute('**/beach3d/assets/face_mei.png')
                for phase in ('approach', 'pickup', 'entering', 'inbound'):
                    page.get_by_role('button', name='Play catch', exact=True).click()
                    if phase == 'inbound':
                        wait_phase(page, 'ready')
                        page.get_by_role('button', name='Throw ball', exact=True).click()
                    wait_phase(page, phase)
                    stop(page)
                    check('Stop safely cancels ' + phase, state(page)['ball']['grounded'] and state(page)['friend'] is None)
                page.get_by_role('button', name='Play catch', exact=True).click()
                wait_phase(page, 'ready')
                page.evaluate('GameState.setCharacterId(__beach3d.catch().friend.id)')
                check('active character conflict removes duplicate synchronously', state(page)['friend'] is None)
                wait_phase(page, 'ground')
                page.get_by_role('button', name='Play catch', exact=True).click()
                wait_phase(page, 'ready')
                check('next guest excludes the newly active identity', page.evaluate('__beach3d.catch().friend.id!==GameState.getCharacter().id'))
                stop(page)
                page.evaluate('__beach3d.teleport(0,2.6)'); page.wait_for_timeout(200)
                target = page.evaluate('__beach3d.project(2,.12,2.6)')
                page.mouse.move(target['x'], target['y']); page.mouse.down()
                page.evaluate('window.dispatchEvent(new Event("blur"))')
                released = page.evaluate('__beach3d.state()')
                page.wait_for_timeout(600)
                check('blur releases native locomotion and capture state', page.evaluate('__beach3d.input().pointer===null && __qaChar.loco.target===null')
                      and abs(page.evaluate('__beach3d.state().x') - released['x']) < .025)
                page.mouse.up()
                page.evaluate('__beach3d.boatBoard()')
                check('catch rejected during boat ride', not page.evaluate('__beach3d.catchStart()'))
                page.get_by_role('button', name='Hop out & swim').click()
                page.get_by_role('button', name='Start surfing').click()
                page.get_by_role('button', name='Play catch').click()
                check('starting catch disarms surfing safely', page.evaluate('!__beach3d.surf().enabled && !__beach3d.surf().armed'))
                stop(page)
                for i in range(3):
                    page.get_by_role('button', name='Play catch').click()
                    if i == 1:
                        wait_phase(page, 'ready')
                        page.get_by_role('button', name='Throw ball').click()
                        wait_phase(page, 'outbound')
                    page.click('#beach-close')
                    check(f'close clears catch and context {i}', page.evaluate('__beach3d.catch()===null && __beach3d.state()===null && __qaWorld.renderer.getContext().isContextLost()'))
                    page.click('#beach-play-button')
                    page.wait_for_function('__beach3d.state()?.boat?.ready && __beach3d.state()?.surf?.ready')
                    page.evaluate('__beach3d.waitReady()')
                    check(f'reopen has one fresh grounded ball and no guest {i}', state(page)['phase'] == 'ground'
                          and state(page)['ball']['x'] == 5.2 and state(page)['friend'] is None
                          and page.locator('[data-activity-id="catchplay"]').count() == 1)
                # Delay only the NEXT guest request, then Stop before its loader resolves.
                pending = []
                page.route('**/beach3d/assets/lily4_full.glb', lambda r: pending.append(r))
                page.get_by_role('button', name='Play catch').click()
                page.wait_for_timeout(200)
                check('guest request is actually pending', len(pending) == 1)
                stop(page)
                pending[0].continue_()
                page.wait_for_timeout(1800)
                check('late guest load after Stop cannot revive activity', state(page)['phase'] == 'ground' and state(page)['friend'] is None
                      and page.evaluate('!__qaWorld.scene.getObjectByName("catchFriend")'))
                pending.clear()
                page.get_by_role('button', name='Play catch').click()
                page.wait_for_timeout(200)
                page.click('#beach-close')
                pending[0].continue_()
                page.wait_for_timeout(1200)
                check('late guest load after close cannot revive a disposed world', page.evaluate('__beach3d.catch()===null && !__qaWorld.scene.getObjectByName("catchFriend")'))
                page.unroute('**/beach3d/assets/lily4_full.glb')
                page.click('#beach-play-button')
                page.wait_for_function('__beach3d.state()?.boat?.ready && __beach3d.state()?.surf?.ready')
                page.evaluate('__beach3d.waitReady()')
                # Upload the bounded, intentionally shared face cache first.
                # Guest churn must not be confused with first-use palette uploads.
                for active in ('lily', 'amara', 'mei', 'sofia'):
                    page.evaluate('id=>GameState.setCharacterId(id)', active)
                    page.wait_for_function('id=>__beach3d.appearance().friend===id', arg=active)
                    page.wait_for_timeout(150)
                resources = []
                for i in range(6):
                    # Deterministic random boundary samples exercise all six choices.
                    # Native activity, independent GLTF loads and mixers remain unmodified.
                    value = (i + .1) / 6
                    active = ['lily', 'amara', 'mei', 'sofia'][i % 4]
                    page.evaluate('id=>GameState.setCharacterId(id)', active)
                    page.wait_for_function('id=>__beach3d.appearance().friend===id', arg=active)
                    saved = page.evaluate('localStorage.getItem("lily-game-save-v1")')
                    page.evaluate('''v=>{window.nativeRandom=Math.random;let n=0;Math.random=()=>++n<=3?v:nativeRandom();
                        const b=__beach3d.catch().ball;__beach3d.teleport(b.x-.8,b.z)}''', value)
                    page.get_by_role('button', name='Play catch').click()
                    page.evaluate('Math.random=nativeRandom')
                    page.wait_for_function('__beach3d.catch().friend?.ready')
                    guest = state(page)['friend']
                    check(f'randomized wardrobe variant {i+1} applied without save changes', guest['appearance']['suit'] == f'suit{i+1}'
                          and guest['appearance']['hair'] == f'hair{i+1}' and guest['appearance']['friend'] == guest['id']
                          and guest['id'] != active and page.evaluate('localStorage.getItem("lily-game-save-v1")') == saved, guest['id'])
                    wait_phase(page, 'ready')
                    times = state(page)['friend']['action']['time']
                    page.evaluate('__qaChar.probePose(.1)')
                    check(f'independent guest mixer {i+1}', abs(state(page)['friend']['action']['time'] - times) < .2)
                    stop(page)
                    page.wait_for_timeout(150)
                    resources.append(page.evaluate('({g:__qaWorld.stats().geometries,t:__qaWorld.stats().textures})'))
                check('guest churn leaves bounded GPU resources after disposal', max(r['g'] for r in resources) == min(r['g'] for r in resources)
                      and max(r['t'] for r in resources) == min(r['t'] for r in resources), resources)
                context.close()

            if args.section in ('all', 'mobile'):
                context, page = new_page(browser, mobile=True)
                page.emulate_media(reduced_motion='reduce')
                page.get_by_role('button', name='Play catch', exact=True).tap()
                wait_phase(page, 'ready')
                context.set_offline(True)
                page.screenshot(path=str(out / 'mobile-ready.png'))
                check('portrait touch controls stay reachable', page.get_by_role('button', name='Throw ball').is_visible()
                      and page.get_by_role('button', name='Stop playing').is_visible())
                page.get_by_role('button', name='Throw ball', exact=True).tap()
                page.wait_for_function('__beach3d.catch().phase==="outbound" && __beach3d.catch().flight.time>.35')
                page.screenshot(path=str(out / 'mobile-arc.png'))
                wait_phase(page, 'ready')
                check('RM and offline retain functional arc and automatic return', state(page)['catches'] == 2)
                ball_tap(page, touch=True)
                wait_phase(page, 'inbound')
                stop(page)
                check('touch Stop safely drops return flight while offline', state(page)['ball']['grounded'])
                context.close()

            if args.section in ('all', 'review'):
                context, page = new_page(browser, registry=True)

                def reopen():
                    page.click('#beach-play-button')
                    page.wait_for_function('__beach3d.state()?.boat?.ready && __beach3d.state()?.surf?.ready')
                    page.evaluate('__beach3d.waitReady()')

                def close_check(label):
                    page.click('#beach-close')
                    check('close releases all catch registry specs and buttons ' + label, page.evaluate('''()=>
                        !__qaActivities.some(s=>['catchplay','catchthrow','catchstop'].includes(s.id)) &&
                        !document.querySelector('[data-activity-id^="catch"]') && __beach3d.catch()===null'''))

                def boat_tap():
                    boat = page.evaluate('(()=>{const b=__beach3d.boat();return __beach3d.project(b.x,b.y+.3,b.z)})()')
                    page.mouse.click(boat['x'], boat['y'])

                for label, x, z in (('ball-head-on', 5.3, 4.78), ('post-head-on', -6.105, 2.277)):
                    page.evaluate('p=>__beach3d.teleport(p[0],p[1])', [x, z])
                    page.wait_for_timeout(150)
                    page.evaluate(TRACE)
                    boat_tap()
                    invitation = page.evaluate('__beach3d.boat()')
                    check('native boat tap plans route around ' + label, invitation['mode'] == 'invited'
                          and len(invitation['invitePath']) > 1, invitation['invitePath'])
                    page.wait_for_function('__beach3d.boat().riding', timeout=22000)
                    trace = page.evaluate('window.traceCatch=false;catchTrace')
                    minimum = min(math.hypot(s['player']['x']-o['x'], s['player']['z']-o['z']) - o['radius'] - .26
                                  for s in trace for o in s['obstacles'])
                    check('scripted boat approach boards without collider penetration ' + label, minimum >= -.003
                          and page.evaluate('__beach3d.boat().inviteT<20 && __beach3d.boat().invitePath.length===0'), minimum)
                    (out / ('boat-route-' + label + '.json')).write_text(json.dumps(trace, indent=2))
                    page.screenshot(path=str(out / ('boat-route-' + label + '.png')))
                    close_check(label)
                    reopen()

                page.evaluate('__beach3d.teleport(5.3,4.78)')
                page.wait_for_timeout(150)
                boat_tap()
                check('boat route can be cancelled by native walking input', page.evaluate('__beach3d.boat().invitePath.length>1'))
                point = page.evaluate('__beach3d.project(3.8,.12,3.4)')
                page.mouse.move(point['x'], point['y']); page.mouse.down()
                page.wait_for_timeout(150)
                check('manual hold replaces invitation rather than following its route', page.evaluate(
                    '__beach3d.boat().mode==="rest" && __beach3d.boat().invitePath.length===0 && __qaChar.loco.targetSrc==="pointer"'))
                page.mouse.up()
                page.wait_for_timeout(100)
                check('manual release stays released after invitation cancellation', page.evaluate('__qaChar.loco.target===null'))

                guarded = page.evaluate('''()=>{
                    const old={id:'registry-test',label:'Old',modes:[],onClick(){}};
                    const current={id:'registry-test',label:'Current',modes:[],onClick(){}};
                    BeachScene.registerActivity(old);BeachScene.registerActivity(current);
                    const retained=!BeachScene.unregisterActivity(old.id,old) && __qaActivities.includes(current);
                    const removed=BeachScene.unregisterActivity(current.id,current);
                    return retained && removed && !BeachScene.unregisterActivity(current.id,current) &&
                        !__qaActivities.some(s=>s.id==='registry-test');
                }''')
                check('unregister matches current spec and is safe for stale or repeated cleanup', guarded)

                for phase in ('ground', 'approach', 'outbound'):
                    check('reopened registry owns exactly three unique catch specs before ' + phase, page.evaluate('''()=>{
                        const ids=__qaActivities.filter(s=>['catchplay','catchthrow','catchstop'].includes(s.id)).map(s=>s.id);
                        return ids.length===3 && new Set(ids).size===3;
                    }''') and page.locator('[data-activity-id="catchplay"]').count() == 1)
                    if phase != 'ground':
                        page.get_by_role('button', name='Play catch', exact=True).click()
                        check('catch controls are not duplicated during ' + phase,
                              page.locator('[data-activity-id="catchthrow"]').count() == 1
                              and page.locator('[data-activity-id="catchstop"]').count() == 1)
                    if phase == 'outbound':
                        wait_phase(page, 'ready')
                        page.get_by_role('button', name='Throw ball', exact=True).click()
                        wait_phase(page, 'outbound')
                    close_check(phase)
                    # Repeating teardown must not recreate any closed-visit entries.
                    page.evaluate('BeachScene.close()')
                    check('repeated close remains unregistered ' + phase, page.evaluate(
                        '!__qaActivities.some(s=>["catchplay","catchthrow","catchstop"].includes(s.id))'))
                    reopen()
                close_check('final')
                context.close()

            if args.section in ('all', 'acceptance'):
                context, page = new_page(browser, audit=True)
                baseline = page.evaluate("""async()=>{
                    const THREE=await import('/lib/three/three.module.js');
                    const {GLTFLoader}=await import('/lib/three/addons/loaders/GLTFLoader.js');
                    const clean=await new GLTFLoader().loadAsync('/beach3d/assets/lily4_full.glb');
                    const player=__qaChar, api=__beach3d;
                    const cleanMixer=new THREE.AnimationMixer(clean.scene);
                    const cleanIdle=cleanMixer.clipAction(clean.animations.find(c=>c.name==='Idle')).play();
                    const poseError=()=>{
                        const action=__qaMixers.get(player.root).actions.Idle;
                        cleanIdle.time=action.time;cleanMixer.update(0);
                        let position=0,quaternion=0,scale=0,bones=0;
                        player.root.traverse(b=>{
                            if(!b.isBone)return;
                            const reference=clean.scene.getObjectByName(b.name);bones++;
                            position=Math.max(position,b.position.distanceTo(reference.position));
                            // q and -q represent the same rotation.
                            const a=b.quaternion.toArray(),r=reference.quaternion.toArray();
                            quaternion=Math.max(quaternion,Math.min(Math.hypot(...a.map((v,i)=>v-r[i])),
                                Math.hypot(...a.map((v,i)=>v+r[i]))));
                            scale=Math.max(scale,b.scale.distanceTo(reference.scale));
                        });
                        return {position,quaternion,scale,bones,clip:api.action().clip};
                    };
                    const ownership=()=>{
                        const p=player.getAnchor(),s=api.state(),guest=__qaWorld.scene.getObjectByName('catchFriend');
                        return __qaChar===player && __beach3d===api && player.root!==guest &&
                            Math.abs(s.x-p.x)<.001 && Math.abs(s.z-p.z)<.001 &&
                            api.appearance().friend===player.appearance().friend &&
                            api.appearance().friend===GameState.getCharacter().id;
                    };
                    const framing=()=>{
                        const rect=__qaWorld.canvas.getBoundingClientRect();
                        const bounds=root=>{
                            const box={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};
                            root.updateMatrixWorld(true);
                            root.traverse(m=>{
                                if(!m.isMesh)return;
                                for(let a=m;a;a=a.parent)if(!a.visible)return;
                                const v=new THREE.Vector3();
                                for(let i=0;i<m.geometry.attributes.position.count;i++){
                                    m.getVertexPosition(i,v).applyMatrix4(m.matrixWorld);
                                    const p=api.project(v.x,v.y,v.z);
                                    box.left=Math.min(box.left,p.x);box.right=Math.max(box.right,p.x);
                                    box.top=Math.min(box.top,p.y);box.bottom=Math.max(box.bottom,p.y);
                                }
                            });
                            return {...box,fits:box.left>=rect.left+6 && box.right<=rect.right-6 &&
                                box.top>=rect.top+6 && box.bottom<=rect.bottom-6};
                        };
                        return {player:bounds(player.root),friend:bounds(__qaWorld.scene.getObjectByName('catchFriend')),
                            ball:bounds(__qaWorld.ball.root),zoom:api.state().zoomTarget,mode:api.state().camMode};
                    };
                    window.catchAcceptance={player,api,poseError,ownership,framing};
                    return poseError();
                }""")
                check('untouched loaded rig is a precise Idle transform oracle', baseline['bones'] > 40
                      and max(baseline[k] for k in ('position', 'quaternion', 'scale')) < 1e-7, baseline)
                page.get_by_role('button', name='Play catch', exact=True).click()
                wait_phase(page, 'ready')
                check('NPC creation leaves __qaChar and __beach3d owned by player', page.evaluate('catchAcceptance.ownership()'))
                independent = page.evaluate("""()=>{
                    const guest=__qaWorld.scene.getObjectByName('catchFriend');
                    const p=__qaMixers.get(__qaChar.root),g=__qaMixers.get(guest);
                    const bones=[];guest.traverse(b=>{if(b.isBone)bones.push(b)});
                    const snapshot=()=>bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.scale.toArray()]);
                    const before=JSON.stringify(snapshot()),time=g.actions.Idle.time,old=p.actions.Idle.time;
                    __beach3d.probePose((old+.317)%p.actions.Idle.getClip().duration);
                    const separate=p.mixer!==g.mixer && p.actions.Idle!==g.actions.Idle &&
                        p.actions.Idle.time!==old && time===g.actions.Idle.time && before===JSON.stringify(snapshot());
                    __beach3d.probePose(old);
                    return separate;
                }""")
                check('native mixer and action instances are independent and player probe cannot move guest bones', independent)
                page.wait_for_timeout(400)
                held = page.evaluate('catchAcceptance.poseError()')
                check('pose oracle detects active procedural arm overlay', held['quaternion'] > .01, held)
                for width, height in ((1280, 800), (420, 720), (320, 720)):
                    page.set_viewport_size({'width': width, 'height': height})
                    page.wait_for_timeout(500)
                    frame = page.evaluate('catchAcceptance.framing()')
                    check(f'normal overview fits both loaded characters and ball at {width}px without zoom reset',
                          all(frame[k]['fits'] for k in ('player', 'friend', 'ball')) and frame['zoom'] == 1
                          and frame['mode'] == 'overview', frame)
                    page.screenshot(path=str(out / f'catch-staging-{width}.png'))
                page.set_viewport_size({'width': 1280, 'height': 800})
                page.wait_for_timeout(400)
                page.keyboard.press('Minus')
                zoom = page.evaluate('__beach3d.state().zoomTarget')
                for i in range(4):
                    page.get_by_role('button', name='Throw ball', exact=True).click()
                    wait_phase(page, 'friendCatch')
                    check(f'player ownership remains correct while guest holds ball {i+1}', page.evaluate('catchAcceptance.ownership()'))
                    wait_phase(page, 'ready')
                    pose = page.evaluate('catchAcceptance.poseError()')
                    check(f'repeated throw {i+1} changes no bone translations or scales', max(pose['position'], pose['scale']) < 1e-7, pose)
                stop(page)
                page.wait_for_timeout(650)
                pose = page.evaluate('catchAcceptance.poseError()')
                check('four full throw-return cycles leave no persistent procedural transform drift',
                      max(pose[k] for k in ('position', 'quaternion', 'scale')) < 1e-7, pose)
                for phase in ('pickup', 'windup', 'outbound', 'inbound'):
                    page.get_by_role('button', name='Play catch', exact=True).click()
                    if phase != 'pickup':
                        wait_phase(page, 'ready')
                        page.get_by_role('button', name='Throw ball', exact=True).click()
                    wait_phase(page, phase)
                    stop(page)
                    page.wait_for_timeout(650)
                    pose = page.evaluate('catchAcceptance.poseError()')
                    check('cancel during ' + phase + ' restores all original animated bone transforms',
                          max(pose[k] for k in ('position', 'quaternion', 'scale')) < 1e-7, pose)
                page.emulate_media(reduced_motion='reduce')
                page.get_by_role('button', name='Play catch', exact=True).click()
                wait_phase(page, 'ready')
                page.get_by_role('button', name='Throw ball', exact=True).click()
                wait_phase(page, 'inbound')
                stop(page)
                page.wait_for_timeout(650)
                pose = page.evaluate('catchAcceptance.poseError()')
                check('RM cancellation restores bone transforms without relying on advancing animation time',
                      max(pose[k] for k in ('position', 'quaternion', 'scale')) < 1e-7, pose)
                check('repeated throws and cancels retain player hooks and chosen zoom',
                      page.evaluate('catchAcceptance.ownership() && __beach3d.state().zoomTarget') == zoom)
                context.close()

            check('no uncaught browser errors', not errors, errors)
            check('no external network dependencies', not external, external)
        finally:
            (out / ('catch-' + args.section + '.json')).write_text(json.dumps(results, indent=2))
            browser.close()


if __name__ == '__main__':
    main()
