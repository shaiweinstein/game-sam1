"""Bounded scene/input/lifecycle regression; serve the game on localhost:8123.

Requires only Python Playwright and its Chromium. Uses an isolated, nonpersistent
browser context. Visibility and source-function pacing shims are policy tests,
not native OS-visibility tests or hardware GPU benchmarks.
"""
import argparse
import json
import math
from pathlib import Path

from playwright.sync_api import sync_playwright
from ground_contact_test import enter


# Compile the served source functions with finite clock/context shims. Never
# duplicate the pacing algorithm or require Node/the temporary performance audit.
SHIMS = """async () => {
    const entry = await (await fetch('/beach3d/beach3d.js')).text();
    const source = await (await fetch('/beach3d/world.js')).text();
    const loop = entry.slice(entry.indexOf('function startLoop()'), entry.indexOf('/* ---------- pointer input'));
    const classify = source.slice(source.indexOf('function rendererInfo(gl)'), source.indexOf('export function isSoftwareGL()'));
    if (!loop || !classify) throw Error('Source function boundaries changed');
    const rendererInfo = new Function('THREE', classify + ';return rendererInfo;')({REVISION:'shim'});
    const identities = [null, 'ANGLE (NVIDIA GeForce RTX)', 'Vulkan SwiftShader Device'];
    const backends = identities.map(name => rendererInfo({VENDOR:'v',RENDERER:'r',VERSION:'version',
        getExtension:()=>name===null?null:{UNMASKED_VENDOR_WEBGL:'uv',UNMASKED_RENDERER_WEBGL:'ur'},
        getParameter:k=>({v:'WebKit',r:'WebKit WebGL',version:'WebGL 2',uv:'',ur:name})[k]}).backend);
    const boot = new Function('world','surf','boat','character','performance','requestAnimationFrame', `
        let opened=true,loopId=null,lastT=0,waveT=0,frames=0,fpsWindow=0,fps=0;
        const document={hidden:false}, reducedMotion=()=>false, catchGame=null;
        ${loop}; startLoop(); startLoop(); return ()=>({fps,waveT});`);
    const pacing=[];
    for (const cap of [30,60]) for (const stall of [false,true]) {
        let now=0,next=null,renders=0,total=0,maxDt=0;
        const read=boot({frameCap:cap,stepZoom(){},updateCamera(){},animate(){},
            render(){renders++;},noteWindow(){}}, {update(){}}, {update(){}},
            {update(dt){total+=dt;maxDt=Math.max(maxDt,dt);},getAnchor(){},swimStatus(){return {mode:'shore'};}}, {now:()=>now}, cb=>{
                if(next) throw Error('Duplicate game RAF'); next=cb; return 1;
            });
        for(let i=1;i<=(stall?1:288);i++) {
            now=stall?2000:i*1000/144;
            const cb=next; next=null; cb(now);
        }
        pacing.push({cap,stall,renders,total,maxDt,...read()});
    }
    return {label:'source-function shims, not hardware measurements',backends,pacing};
}"""


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='/tmp/kilo/beach-polish')
    args=parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results, errors, external = {}, [], []

    def check(name, ok, detail=None):
        results[name] = {'pass': bool(ok), 'detail': detail}
        print(('PASS ' if ok else 'FAIL ') + name, flush=True)
        assert ok, (name, detail)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={'width':1280, 'height':800})
            page = context.new_page()
            page.set_default_timeout(15000)
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('request', lambda r: external.append(r.url) if r.url.startswith(('http:', 'https:'))
                    and not r.url.startswith('http://localhost:8123/') else None)
            enter(page)
            page.evaluate("""() => {
                window.sceneQA={camera:()=>{
                    const c=__qaWorld.camera;
                    return JSON.stringify([c.position.toArray(),c.quaternion.toArray(),c.projectionMatrix.elements]);
                },key:options=>{
                    const e=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,...options});
                    document.dispatchEvent(e);return e.defaultPrevented;
                },hide:value=>{
                    Object.defineProperty(document,'hidden',{configurable:true,get:()=>value});
                    Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>value?'hidden':'visible'});
                    document.dispatchEvent(new Event('visibilitychange'));
                },frozen:()=>{
                    const w=__qaWorld,sky=w.scene.getObjectByName('skyAccents');
                    const water=w.scene.children.find(m=>m.isMesh && m.material.isMeshBasicMaterial && m.material.vertexColors);
                    return {t:__beach3d.state().waveT,water:water.geometry.attributes.position.version,
                        clouds:sky.children.filter(o=>o.isSprite).map(o=>o.position.toArray()),
                        gulls:Array.from(sky.getObjectByName('gulls').geometry.attributes.position.array),
                        sheets:w.scene.children.filter(m=>m.isMesh && m.material.map?.wrapS===1000).map(m=>m.material.map.offset.toArray())};
                }};
            }""")
            diag = page.evaluate('__beach3d.performance()')
            cap = 30 if diag['backend'] == 'software' else 60
            check('actual-context diagnostics and frame budget', diag['backend'] in ('software','hardware','unknown')
                  and diag['frameCap'] == diag['effectiveFrameCap'] == cap and not diag['contextLost']
                  and (diag['backend'] != 'software' or diag['prScale'] == .5), diag)
            check('diagnostics match GL and are detached', page.evaluate("""()=>{
                const d=__beach3d.performance(),gl=__qaWorld.renderer.getContext();
                const same=d.renderer===gl.getParameter(gl.RENDERER) && d.webglVersion===gl.getParameter(gl.VERSION)
                    && d.drawingBuffer[0]===gl.drawingBufferWidth;
                d.frameCap=999; d.drawingBuffer[0]=0;
                return same && __beach3d.performance().frameCap!==999 && __beach3d.performance().drawingBuffer[0]>0;
            }"""))
            fixed = page.evaluate('sceneQA.camera()')
            for z in (2.6, .52, -3.8, -9.5):
                page.evaluate('z=>__beach3d.teleport(0,z)', z)
                page.wait_for_timeout(1800)
                if z > 0:
                    check(f'overview at z={z}', page.evaluate('sceneQA.camera()') == fixed)
                else:
                    check(f'swimmer focus at z={z}', page.evaluate('''z=>{
                        const w=__qaWorld,f=w.camFocus();return w.camMode()==='swimmer' &&
                            Math.hypot(f[0],f[1]-.17,f[2]-z)<.001 && w.zoomTarget()===1;
                    }''',z))
            page.evaluate('__beach3d.teleport(4.5,-3.5);__beach3d.setZoom(.81)')
            page.wait_for_timeout(1800)
            boat = page.evaluate('__beach3d.project(4.7,.12,-3.5)')
            page.mouse.click(boat['x'], boat['y'])
            page.wait_for_function('__beach3d.boat().riding')
            page.wait_for_timeout(2000)
            check('native boat boarding returns to overview preserving manual zoom', page.evaluate('''fixed=>{
                const expected=JSON.parse(fixed);expected[0]=[0,1.66+(3.6-1.66)*.81,2.64+(10.4-2.64)*.81];
                return sceneQA.camera()===JSON.stringify(expected) && __qaWorld.camMode()==='overview' && __qaWorld.zoomTarget()===.81;
            }''',fixed))
            page.get_by_role('button', name='Hop out & swim').click()
            page.wait_for_function('!__beach3d.boat().riding')
            page.wait_for_timeout(2000)
            check('boat hop restores float follow without resetting zoom',page.evaluate(
                '__qaWorld.camMode()==="swimmer" && __qaWorld.zoomTarget()===.81'))
            page.evaluate('__beach3d.setZoom(1)');page.wait_for_function('__qaWorld.zoom()===1')
            page.mouse.move(640,420)
            for i in range(3):
                page.mouse.wheel(0,-100)
                page.wait_for_function('v=>Math.abs(__qaWorld.zoomTarget()-v)<1e-9', arg=math.exp(-.12*(i+1)))
            page.mouse.wheel(0,300)
            page.wait_for_function('Math.abs(__qaWorld.zoomTarget()-1)<1e-9')
            check('native wheel direction and target accumulation', True)
            for _ in range(5):
                page.keyboard.press('Equal')
            check('rapid native keys accumulate on target', abs(page.evaluate('__qaWorld.zoomTarget()')-math.exp(-.4))<1e-9)
            for key, exponent in [('Minus',-.32), ('Shift+Equal',-.4), ('NumpadAdd',-.48), ('NumpadSubtract',-.4)]:
                page.keyboard.press(key)
                check(key+' direction', abs(page.evaluate('__qaWorld.zoomTarget()')-math.exp(exponent))<1e-9)
            before = page.evaluate('__qaWorld.zoomTarget()')
            check('modifier and unhandled keys not consumed', page.evaluate("""()=>[
                {key:'=',ctrlKey:true},{key:'-',metaKey:true},{key:'+',altKey:true},{key:'x'}
                ].every(o=>!sceneQA.key(o))""") and page.evaluate('__qaWorld.zoomTarget()') == before)
            for tag in ('input','textarea','select','div'):
                page.evaluate("""tag=>{const e=document.createElement(tag);e.id='scene-edit';
                    if(tag==='div')e.contentEditable='true';document.body.appendChild(e);e.focus();}""", tag)
                page.keyboard.press('Equal')
                check(tag+' editing ignores zoom', page.evaluate('__qaWorld.zoomTarget()') == before)
                page.evaluate('document.querySelector("#scene-edit").remove()')
            page.evaluate('__beach3d.setZoom(1); __beach3d.teleport(0,-8)')
            page.wait_for_function('__qaWorld.zoom()===1')
            page.wait_for_timeout(1800)
            target = page.evaluate('__beach3d.project(2,.12,-8)')
            page.mouse.move(target['x'],target['y']); page.mouse.down(); page.keyboard.down('Space')
            check('native pointer and Space hold', page.evaluate('__qaChar.loco.targetSrc==="pointer" && __beach3d.surf().armed'))
            page.evaluate('sceneQA.hide(true)')
            paused = page.evaluate('({frame:__qaWorld.renderer.info.render.frame,state:__beach3d.state()})')
            page.keyboard.press('Equal'); page.wait_for_timeout(650)
            check('synthetic hidden policy: zero renders and released inputs', page.evaluate("""a=>
                __qaWorld.renderer.info.render.frame===a.frame && __beach3d.state().waveT===a.state.waveT &&
                __qaChar.loco.target===null && !__beach3d.surf().armed && __qaWorld.zoomTarget()===1 &&
                __beach3d.performance().paused && __beach3d.performance().effectiveFrameCap===0""", paused))
            page.keyboard.up('Space'); page.mouse.up(); page.evaluate('sceneQA.hide(false)')
            page.wait_for_function('f=>__qaWorld.renderer.info.render.frame>f', arg=paused['frame'])
            resumed = page.evaluate('__beach3d.state()')
            check('resume has no hidden-time jump', 0<resumed['waveT']-paused['state']['waveT']<.25
                  and math.hypot(resumed['x']-paused['state']['x'], resumed['z']-paused['state']['z'])<.25)
            page.emulate_media(reduced_motion='reduce'); page.wait_for_function('__beach3d.state().rm')
            frozen = page.evaluate('sceneQA.frozen()')
            page.evaluate('__beach3d.setTarget(1,-8); __beach3d.splash(0,-8)'); page.keyboard.press('Equal')
            page.wait_for_timeout(1100)
            check('RM freezes decorations, not movement/zoom/VFX fades', page.evaluate('sceneQA.frozen()') == frozen
                  and page.evaluate('__beach3d.state().x>.5 && __qaWorld.zoom()<1 && __beach3d.state().splashes===0'))
            page.emulate_media(reduced_motion='no-preference'); page.wait_for_function('!__beach3d.state().rm')
            page.evaluate('__beach3d.setZoom(1); __beach3d.teleport(99,-99); __beach3d.setTarget(-99,-99)')
            check('shared deep teleport and target clamp', page.evaluate('__beach3d.state().z===-9.5 && __qaChar.loco.target.z===-9.5'))
            page.evaluate('__beach3d.teleport(0,-9.3); __beach3d.setTarget(0,-99)')
            page.wait_for_function('__beach3d.state().z===-9.5 && __qaWorld.zoom()===1')
            check('deep limit reached by live character steps', True)
            page.evaluate('__beach3d.setZoom(.73)');page.wait_for_function('__qaWorld.zoom()===.73')
            page.evaluate("""fixed=>{
                const q=sceneQA,render=__qaWorld.render;q.ride={overview:true,settled:true,legal:true};
                __qaWorld.render=()=>{
                    render();const s=__beach3d.state(),r=s.surf,a=q.ride,t=performance.now();
                    if(a.end!==undefined)return;
                    if(r.mode==='riding' && a.start===undefined){a.start=t;a.z0=r.crestZ;a.t0=s.waveT;}
                    if(a.start===undefined)return;
                    a.overview &&= s.camMode==='overview' && s.zoomTarget===.73;
                    if(t-a.start>3000)a.settled &&= q.camera()===q.fixed;
                    a.legal &&= s.z>=-9.5 && r.z>=-9.5 && Math.abs(s.x)<=6.2 && Math.abs(r.x)<=6.2;
                    if(!r.riding){a.end=t;a.z1=r.crestZ;a.t1=s.waveT;}
                };const expected=JSON.parse(fixed);
                expected[0]=[0,1.66+(3.6-1.66)*.73,2.64+(10.4-2.64)*.73];q.fixed=JSON.stringify(expected);
            }""",fixed)
            page.get_by_role('button', name='Start surfing').click()
            # Keep native focus: Start surfing followed by Space must still work.
            page.keyboard.down('Space'); page.wait_for_function('__beach3d.surf().riding', timeout=5000)
            page.keyboard.up('Space'); page.wait_for_function('sceneQA.ride.end!==undefined', timeout=13000)
            ride = page.evaluate('sceneQA.ride')
            ride['seconds'] = (ride['end']-ride['start'])/1000
            ride['speed'] = (ride['z1']-ride['z0'])/(ride['t1']-ride['t0'])
            check('native opt-in/Space early ride, settled overview, legal bounds and counter', ride['overview'] and ride['settled'] and ride['legal']
                  and 9.05<ride['seconds']<9.7 and abs(ride['speed']-1.1)<.005
                   and page.evaluate('__beach3d.surf().counter===1 && __beach3d.state().stance==="stand" && __qaWorld.zoomTarget()===.73'), ride)
            page.evaluate('window.retiredGL=__qaWorld.renderer.getContext()')
            page.click('#beach-close'); page.wait_for_function('retiredGL.isContextLost()')
            check('close loses old context and removes zoom handler', page.evaluate('__beach3d.performance()===null && !sceneQA.key({key:"="})'))
            page.click('.nav-button[data-screen="map"]'); page.click('.place[data-place-id="beach"]')
            if page.locator('#beach-scene').is_hidden():
                page.click('#beach-play-button')
            page.wait_for_function('__beach3d.state()?.surf?.ready && __beach3d.state()?.boat?.ready')
            assert page.evaluate('__beach3d.waitReady()')
            page.wait_for_function('__qaWorld.renderer.info.render.frame>2')
            check('reopen has a new working context and reset counter', page.evaluate("""()=>{
                const d=__beach3d.performance(),gl=__qaWorld.renderer.getContext();
                return retiredGL!==gl && retiredGL.isContextLost() && !d.contextLost && d.calls>0 &&
                    d.textures>0 && __beach3d.surf().counter===0;
            }"""))
            page.keyboard.press('Equal')
            check('reopen has exactly one zoom handler', abs(page.evaluate('__qaWorld.zoomTarget()')-math.exp(-.08))<1e-9)
            shims = page.evaluate(SHIMS)
            check('source renderer classification shims', shims['backends'] == ['unknown','hardware','software'])
            for row in shims['pacing']:
                expected = .5 if row['stall'] else 2
                check(f"source pacing cap={row['cap']} stall={row['stall']}",
                      abs(row['total']-expected)<1e-8 and abs(row['waveT']-expected)<1e-8 and row['maxDt']<=1/60+1e-9
                      and row['renders']==(1 if row['stall'] else 2*row['cap'])
                      and (row['fps']==1 if row['stall'] else abs(row['fps']-row['cap'])<=2), row)
            results['shim_scope'] = shims['label']
            check('no browser errors or external requests', not errors and not external, {'errors':errors,'external':external})
        except Exception as exc:
            results['failure'] = str(exc)
            raise
        finally:
            browser.close()
            (out/'scene-test.json').write_text(json.dumps(results, indent=2))
    print(f'Report: {out / "scene-test.json"}', flush=True)


if __name__ == '__main__':
    main()
