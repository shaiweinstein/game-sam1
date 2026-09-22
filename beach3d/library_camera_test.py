"""Native library overview, floor-click navigation and lifecycle regression.

Runs an independent temporary loopback server, or uses --url. No character
teleports, setTarget calls, camera posing or time acceleration for navigation.
Screenshots/JSON are CSS-pixel gameplay evidence, not a hardware FPS benchmark.
"""
import argparse
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
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


INSTALL = """async () => {
    const T = await import('/lib/three/three.module.js'), q = __library3d;
    const v = new T.Vector3(), ray = new T.Raycaster();
    window.libraryQA = {
        sample() {
            const scene=q.sceneRef(), c=q.cameraRef(), r=q.rendererRef().domElement.getBoundingClientRect();
            scene.updateMatrixWorld(true); c.updateMatrixWorld(true);
            const bounds={left:Infinity,right:-Infinity,top:Infinity,bottom:-Infinity};
            scene.traverseVisible(m=>{
                if(!m.isSkinnedMesh)return;
                m.skeleton.update();
                for(let i=0;i<m.geometry.attributes.position.count;i++) {
                    m.getVertexPosition(i,v).applyMatrix4(m.matrixWorld).project(c);
                    bounds.left=Math.min(bounds.left,(v.x+1)*r.width/2);
                    bounds.right=Math.max(bounds.right,(v.x+1)*r.width/2);
                    bounds.top=Math.min(bounds.top,(1-v.y)*r.height/2);
                    bounds.bottom=Math.max(bounds.bottom,(1-v.y)*r.height/2);
                }
            });
            const a=q.state().character, free=[];
            for(let x=-6;x<=6;x+=.5)for(let z=-4.5;z<=2.6;z+=.5) {
                if(q.obstaclesList().some(o=>Math.hypot(x-o.x,z-o.z)<o.radius+.35))continue;
                const p=q.screenPointFor(x,z);
                if(p.behind || p.x<15 || p.x>r.width-15 || p.y<80 || p.y>r.height-15)continue;
                ray.setFromCamera({x:p.x/r.width*2-1,y:1-p.y/r.height*2},c);
                const hit=ray.intersectObjects(scene.children,true).find(h=>h.object.visible);
                if(hit && Math.abs(hit.point.y)<.025)free.push({x,z,screen:p});
            }
            // Every sampled view ray must meet the existing room, not void.
            let voidRays=0;
            for(const x of [-.98,-.5,0,.5,.98])for(const y of [-.98,-.5,0,.5,.98]) {
                ray.setFromCamera({x,y},c);
                if(!ray.intersectObjects(scene.children,true).length)voidRays++;
            }
            const banner=scene.children.find(m=>m.geometry?.parameters?.width===1.6 &&
                m.geometry?.parameters?.height===.52);
            const sign=[];
            for(const x of [-.8,.8])for(const y of [-.26,.26])
                sign.push(v.set(x,y,0).applyMatrix4(banner.matrixWorld).project(c).toArray());
            return {state:q.state(),position:c.position.toArray(),quaternion:c.quaternion.toArray(),
                bounds,height:bounds.bottom-bounds.top,fraction:(bounds.bottom-bounds.top)/r.height,
                viewport:[r.width,r.height],freeFloor:free.slice(0,12),freeFloorCount:free.length,
                voidRays,sign,fade:q.occluderFade(),
                lateral:[q.screenPointFor(a.x-2,a.z),q.screenPointFor(a.x+2,a.z)]};
        },
        hide(value) {
            Object.defineProperty(document,'hidden',{configurable:true,get:()=>value});
            document.dispatchEvent(new Event('visibilitychange'));
        },
        watch() {
            const c=q.cameraRef(), orientation=c.quaternion.clone(), position=c.position.clone();
            const result=this.monitor={frames:0,violations:[],faded:new Set(),maxStep:0};
            this.stop=false;
            const frame=()=>{
                if(this.stop || !q.state())return;
                const a=q.state().character;
                result.frames++;
                result.maxStep=Math.max(result.maxStep,c.position.distanceTo(position));position.copy(c.position);
                const fail=message=>{if(!result.violations.includes(message))result.violations.push(message);};
                if(a.x < -6.001 || a.x > 6.001 || a.z < -4.601 || a.z > 2.601)fail('escaped WALK');
                if(c.position.y!==3.9 || c.position.z!==8.6 || c.fov!==38 ||
                    Math.abs(c.position.x)>6.001 || 1-Math.abs(c.quaternion.dot(orientation))>1e-10)
                    fail('overview height/depth/FOV/direction changed');
                for(const o of q.obstaclesList())if(Math.hypot(a.x-o.x,a.z-o.z)<o.radius+.258)
                    fail('penetrated obstacle '+o.id);
                // Conservative body envelope, plus exact native skin at each screenshot.
                for(const x of [-.32,.32])for(const y of [0,1.08])for(const z of [-.3,.3]) {
                    v.set(a.x+x,y,a.z+z).project(c);
                    if(Math.max(Math.abs(v.x),Math.abs(v.y),Math.abs(v.z))>=1)fail('body left frustum');
                }
                if(c.aspect>=1.5)for(const x of [-2,2]) {
                    v.set(a.x+x,0,a.z).project(c);
                    if(Math.max(Math.abs(v.x),Math.abs(v.y),Math.abs(v.z))>=1)fail('lost 2m lateral floor');
                }
                q.occluderFade().filter(o=>o.opacity<.98).forEach(o=>result.faded.add(o.name));
                requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
        },
        finish() {this.stop=true;return {...this.monitor,faded:[...this.monitor.faded]};}
    };
}"""

# Human-style aisle waypoints: collision is slide-and-stop, not auto-pathfinding.
# Portrait legs are split into short visible clicks as the sideways camera follows.
ROUTE = [
    ('aisle-right', 1.7, .7), ('table-right', 1.7, -.8),
    ('table-back-right', 1.7, -2.9), ('table-back-left', -1.7, -2.9),
    ('table-left', -1.7, -.8), ('left-aisle', -3, -.8),
    ('back-aisle', -3, -4.6), ('corner-back-left', -6, -4.6),
    ('globe-left', -6, .7), ('globe-aisle', -4.4, .7),
    ('globe-right', -4.4, 1.7), ('globe-front', -4.4, 2.6),
    ('corner-front-left', -6, 2.6), ('front-aisle-left', -4.4, 2.6),
    ('front-aisle-right', 4.3, 2.6), ('nook-left', 4.3, -3.45),
    ('nook-back', 4.3, -4.6), ('corner-back-right', 6, -4.6),
    ('nook-back-return', 4.3, -4.6), ('nook-left-return', 4.3, -2),
    ('nook-right', 6, -2), ('corner-front-right', 6, 2.6),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', help='Existing server; default: ephemeral loopback server')
    parser.add_argument('--out', default='/tmp/kilo/library-overview')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    report, errors, external = {}, [], []
    with local_server(args.url) as url, sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width':1280,'height':800}, has_touch=True)
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('request', lambda r: external.append(r.url) if r.url.startswith(('http:', 'https:'))
                    and not r.url.startswith(url + '/') else None)
            page.goto(url + '/index.html', wait_until='networkidle')
            page.click('#welcome-start')
            page.click('.nav-button[data-screen="map"]')
            page.click('.place[data-place-id="library"]')

            def open_library():
                page.click('#library-play-button')
                page.wait_for_function('__library3d.state()?.charReady')
                page.wait_for_timeout(650)
                page.evaluate(INSTALL)

            def sample(name, desktop):
                row = page.evaluate('libraryQA.sample()')
                report[name] = row
                b = row['bounds']
                width, height = row['viewport']
                assert 2 < b['left'] < b['right'] < width-2, (name, b)
                assert 2 < b['top'] < b['bottom'] < height-2, (name, b)
                assert len(row['freeFloor']) >= 5 and row['voidRays'] == 0, (name, row)
                if desktop:
                    assert all(max(abs(v) for v in point) < 1 for point in row['sign']), (name, row['sign'])
                    assert all(0 < p['x'] < width and 0 < p['y'] < height and not p['behind']
                               for p in row['lateral']), (name, row['lateral'])
                page.screenshot(path=str(out / (name + '.png')))
                return row

            for label, width, height in [('desktop',1280,800), ('portrait',390,844)]:
                page.set_viewport_size({'width':width, 'height':height})
                open_library()
                idle = sample(f'after-{label}-idle', label == 'desktop')
                if label == 'desktop':
                    assert .14 <= idle['fraction'] <= .25, idle['fraction']
                    assert all(15 < p['x'] < width-15 and 80 < p['y'] < height-15
                               and not p['behind'] for p in idle['lateral']), idle['lateral']
                page.evaluate('libraryQA.watch()')
                clicks = []
                for name, x, z in ROUTE:
                    start = page.evaluate('__library3d.state().character')
                    count = max(1, math.ceil(math.hypot(x-start['x'], z-start['z']) / .85))
                    for i in range(1, count+1):
                        # Finish the soft pan before projecting the next click;
                        # an old pixel through a moving camera is a different floor point.
                        page.wait_for_timeout(350)
                        target = [start['x']+(x-start['x'])*i/count, start['z']+(z-start['z'])*i/count]
                        point = page.evaluate('([x,z])=>__library3d.screenPointFor(x,z)', target)
                        assert 8 < point['x'] < width-8 and 80 < point['y'] < height-8 and not point['behind'], (name, point)
                        page.mouse.click(point['x'], point['y'])
                        actual = page.evaluate('__library3d.state().character.target')
                        assert actual and math.dist([actual['x'], actual['z']], target) < .025, (name, actual, target)
                        clicks.append({'world':target, 'pixel':point, 'actual':actual})
                        if i == 1 and name in ('table-right','corner-back-left','corner-front-left','corner-back-right','corner-front-right'):
                            page.wait_for_function('__library3d.state().character.moving')
                            sample(f'after-{label}-{name}-moving', label == 'desktop')
                        page.wait_for_function('''([x,z])=>{const a=__library3d.state().character;
                            return !a.target && Math.hypot(a.x-x,a.z-z)<.06;}''', arg=target, timeout=5000)
                    page.wait_for_timeout(100)
                    if name.startswith('corner-') or name in ('table-left','table-right','globe-left','globe-right','nook-left','nook-right'):
                        sample(f'after-{label}-{name}', label == 'desktop')
                    print(f'PASS {label} real-click {name} ({x}, {z})', flush=True)
                monitor = page.evaluate('libraryQA.finish()')
                report[label+'-navigation'] = {'clickCount':len(clicks), 'clicks':clicks, **monitor}
                assert monitor['frames'] > 50 and not monitor['violations'], monitor
                assert 'armchair' in monitor['faded'], monitor
                chair = next(o for o in report[f'after-{label}-corner-back-right']['fade'] if o['name']=='armchair')
                assert chair['transparent'] and chair['opacity'] <= .5, chair
                # Drag is still steering; releasing still completes the walk.
                page.wait_for_timeout(350)
                point = page.evaluate('__library3d.screenPointFor(5.5,2.4)')
                page.mouse.move(point['x'], point['y']); page.mouse.down()
                first = page.evaluate('__library3d.state().character.target')
                point = page.evaluate('__library3d.screenPointFor(5.2,2.2)')
                page.mouse.move(point['x'], point['y'])
                drag = page.evaluate('__library3d.state().character.target')
                page.mouse.up()
                assert drag != first and math.dist([drag['x'],drag['z']], [5.2,2.2]) < .15, drag
                page.wait_for_function('''p=>{const a=__library3d.state().character;
                    return !a.target && Math.hypot(a.x-p.x,a.z-p.z)<.06;}''', arg=drag)
                # Real floor click beyond the front WALK edge must stop at 2.6,
                # not escape or silently restore the old cropped-feet limit 1.9.
                page.wait_for_timeout(350)
                point = page.evaluate('__library3d.screenPointFor(5.2,3)')
                assert 0 < point['x'] < width and 0 < point['y'] < height, point
                page.mouse.click(point['x'], point['y'])
                assert page.evaluate('__library3d.state().character.target.z') == 2.6
                page.wait_for_function('!__library3d.state().character.target && __library3d.state().character.z===2.6')
                page.wait_for_timeout(350)
                point = page.evaluate('__library3d.screenPointFor(6,2.6)')
                page.mouse.click(point['x'], point['y'])
                page.wait_for_function('!__library3d.state().character.target && __library3d.state().character.x>5.94')
                # Resize while standing in the near corner, not just at spawn.
                for rw, rh in ([(390,844),(1280,800)] if label=='desktop' else [(1280,800),(390,844)]):
                    page.set_viewport_size({'width':rw,'height':rh})
                    page.wait_for_timeout(900)
                    sample(f'after-{label}-corner-resize-{rw}', rw==1280)
                print(f'PASS {label}: {len(clicks)} clicks, idle {idle["height"]:.1f}px '
                      f'({idle["fraction"]:.1%}), {idle["freeFloorCount"]} visible free floor probes', flush=True)
                page.evaluate('window.retired=__library3d.rendererRef()')
                page.click('#library-close')
                page.wait_for_function('retired.getContext().isContextLost()')
                assert page.locator('#library-stage').is_hidden()
                assert page.locator('.library3d-host').count() == 0
                assert page.evaluate('document.activeElement.matches(".nav-button[data-screen=map]")')

            # Resize at an extreme, reduced motion, hidden/resume, QA orbit return,
            # and repeated native Back/Escape/reopen. No mutation of dress-up code.
            open_library()
            page.emulate_media(reduced_motion='reduce')
            spin = page.evaluate('__library3d.globeSpin()')
            point = page.evaluate('__library3d.screenPointFor(.7, .6)')
            page.mouse.click(point['x'], point['y'])
            page.wait_for_function('__library3d.state().character.x>.3')
            page.evaluate('libraryQA.hide(true)')
            frozen = page.evaluate('__library3d.state()')
            page.wait_for_timeout(300)
            assert frozen == page.evaluate('__library3d.state()')
            assert page.evaluate('__library3d.globeSpin()') == spin
            page.evaluate('libraryQA.hide(false)')
            page.wait_for_function('frame=>__library3d.state().frame>frame', arg=frozen['frame'])
            assert not page.evaluate('__library3d.state().character.target')
            page.emulate_media(reduced_motion='no-preference')
            assert page.evaluate('__library3d.setCamPose({azimuth:.2,elevation:.25,dist:3,lookY:.7})')
            page.wait_for_timeout(150)
            assert page.evaluate('__library3d.clearCamPose()')
            page.wait_for_timeout(2600)
            sample('after-portrait-orbit-return', False)
            for width, height in [(1280,800),(390,844),(1280,800)]:
                page.set_viewport_size({'width':width, 'height':height})
                page.wait_for_timeout(900)
                sample(f'after-resize-{width}', width == 1280)
            for _ in range(2):
                page.keyboard.press('Escape')
                assert page.locator('#library-stage').is_hidden()
                assert not page.evaluate('__library3d.state()')
                open_library()
                assert page.locator('.library3d-host canvas').count() == 1
                assert page.evaluate('__library3d.state().camera') == [0,3.9,8.6,38]
                assert page.evaluate('__library3d.camPoseState()') is None
            sample('after-desktop-reopen', True)
            report['lifecycle'] = 'PASS drag/release, Back/Escape, resize, reopen, RM, visibility, orbit return'
            assert not errors and not external, (errors, external)
            print('PASS lifecycle and no browser errors/external requests', flush=True)
        except Exception as exc:
            report['failure'] = str(exc)
            report['failureState'] = page.evaluate('__library3d.state()')
            page.screenshot(path=str(out / 'failure.png'))
            raise
        finally:
            report['browserErrors'], report['externalRequests'] = errors, external
            (out / 'library-camera-test.json').write_text(json.dumps(report, indent=2))
            browser.close()
    print(f'Report: {out / "library-camera-test.json"}')


if __name__ == '__main__':
    main()
