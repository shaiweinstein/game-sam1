"""Swimmer camera regression on the existing localhost:8123 server.

Native full-viewport images use the real camera and input. Deterministic QA
pauses character/camera stepping, never overrides camera position or lookAt.
Software headless rendering is not a hardware FPS benchmark.
"""
import argparse
import json
import math
from pathlib import Path

from playwright.sync_api import sync_playwright
from ground_contact_test import enter
from swim_switch_test import NativeInput, choose


INSTALL = """async()=>{
    const T=await import('/lib/three/three.module.js'),W=await import('/beach3d/world.js');
    const w=__qaWorld,c=__qaChar,update=c.update,camera=w.updateCamera,v=new T.Vector3();
    window.cameraQA={w,c,W,
        pause(){c.update=()=>{};w.updateCamera=()=>{};},
        restore(){c.update=update;w.updateCamera=camera;},
        step(dt=1/60){camera(dt,c.getAnchor(),c.swimStatus().mode);},
        settle(){for(let i=0;i<240;i++)this.step();},
        sample(){const a=c.getAnchor(),f=w.camFocus(),p=w.project(a.x,.17,a.z),r=w.canvas.getBoundingClientRect();
            return {anchor:a,mode:w.camMode(),focus:f,position:w.camera.position.toArray(),
                quaternion:w.camera.quaternion.toArray(),fov:w.camera.fov,zoom:w.zoom(),target:w.zoomTarget(),
                center:[(p.x-r.left)/r.width,(p.y-r.top)/r.height],
                distance:w.camera.position.distanceTo(v.fromArray(f)),stage:r.toJSON()};},
        pose(style,hair,yaw,phase,moving=false){
            c.reset();c.teleport(0,-7);c.setHair(hair);c.setSwimStyle(style);
            c.loco.yaw=c.loco.yawTarget=yaw;c.setTarget(Math.sin(yaw)*5,-7+Math.cos(yaw)*2);
            for(let i=0;i<60;i++)update(1/60,0);
            c.probePose(phase);this.settle();
            if(moving){for(let i=0;i<15;i++){update(1/60,0);update(1/60,0);this.step(1/30);}c.probePose(phase);}
        },
        bounds(){c.root.updateMatrixWorld(true);w.camera.updateMatrixWorld(true);
            const b={left:Infinity,right:-Infinity,top:-Infinity,bottom:Infinity,near:Infinity,far:-Infinity};
            c.root.traverseVisible(m=>{if(!m.isSkinnedMesh)return;
                for(let i=0;i<m.geometry.attributes.position.count;i++){
                    m.getVertexPosition(i,v).applyMatrix4(m.matrixWorld);
                    const depth=-v.clone().applyMatrix4(w.camera.matrixWorldInverse).z;
                    b.near=Math.min(b.near,depth);b.far=Math.max(b.far,depth);v.project(w.camera);
                    b.left=Math.min(b.left,v.x);b.right=Math.max(b.right,v.x);
                    b.top=Math.max(b.top,v.y);b.bottom=Math.min(b.bottom,v.y);
                }
            });return b;
        },
        hide(value){Object.defineProperty(document,'hidden',{configurable:true,get:()=>value});
            document.dispatchEvent(new Event('visibilitychange'));},
        dynamics(dts){this.pause();c.reset();this.settle();
            let prev=w.camera.position.clone(),maxStep=0,maxSpeed=0;const rows=[];
            const advance=(dt,a,mode)=>{camera(dt,a,mode);const step=prev.distanceTo(w.camera.position);
                maxStep=Math.max(maxStep,step);maxSpeed=Math.max(maxSpeed,step/dt);prev.copy(w.camera.position);};
            // Same timed entry, steady travel, float and deep exit at each cadence.
            for(const phase of ['entry','travel','rest','exit']){
                let elapsed=0,i=0;const duration=phase==='travel'?3:4;
                while(elapsed<duration-1e-9){
                    const checkpoint=Math.min(duration,Math.floor(elapsed*4+1e-8)/4+.25);
                    const dt=Math.min(dts[i++%dts.length],checkpoint-elapsed);elapsed+=dt;
                    const a={x:phase==='entry'?0:phase==='travel'?1.32*elapsed:3.96,z:-7};
                    advance(dt,a,phase==='exit'?'shore':phase==='rest'?'rest':'swim');
                    if(Math.abs(elapsed-checkpoint)<1e-9)
                        rows.push({phase,time:elapsed,focus:w.camFocus(),position:w.camera.position.toArray()});
                }
            }
            return {rows,maxStep,maxSpeed};
        }
    };
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='/tmp/kilo/swimmer-camera')
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    results, errors, external = {}, [], []

    def check(name, ok, detail=None):
        results[name] = {'pass': bool(ok), 'detail': detail}
        print(('PASS ' if ok else 'FAIL ') + name, flush=True)
        assert ok, (name, detail)

    def shot(page, name):
        page.screenshot(path=str(out / (name + '.png')), full_page=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={'width':1280, 'height':800}, has_touch=True)
            page = context.new_page()
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('request', lambda r: external.append(r.url) if r.url.startswith(('http:', 'https:'))
                    and not r.url.startswith('http://localhost:8123/') else None)
            enter(page)
            page.evaluate(INSTALL)
            initial = page.evaluate('cameraQA.sample()')
            check('exact default overview', initial['position'] == [0,3.6,10.4] and initial['focus'] == [0,1.66,2.64]
                  and initial['mode'] == 'overview' and initial['target'] == 1 and initial['fov'] == 38, initial)
            shot(page,'native-default-land')
            native = NativeInput(page,False)
            native.hold(0,-7)
            page.wait_for_function('__qaChar.loco.z < -1.5', timeout=12000)
            shot(page,'native-default-entry-swim')
            check('native shore hold enters follow without auto zoom', page.evaluate(
                '__qaWorld.camMode()==="swimmer" && __qaWorld.zoomTarget()===1 && __qaChar.loco.targetSrc==="pointer"'))
            # Reproject through the moving camera, rather than reusing old pixels.
            native.drag(2,-7)
            page.wait_for_timeout(850)
            native.release()
            page.wait_for_timeout(1100)
            check('release keeps float focused', page.evaluate(
                '__qaChar.swimStatus().mode==="rest" && __qaWorld.camMode()==="swimmer" && __qaWorld.zoomTarget()===1'))
            native.travel(0,-7)
            choose(page,'head-up')
            canvas = page.locator('.beach3d-host canvas')
            canvas.focus()
            page.mouse.move(640,420)
            for _ in range(6):
                page.mouse.wheel(0,-600)
            page.wait_for_function('__qaWorld.zoom()===.37')
            check('native wheel reaches new minimum while floating',page.evaluate('__qaWorld.zoomTarget()===.37 && __qaWorld.camMode()==="swimmer"'))
            native.hold(.7,-7)
            page.wait_for_timeout(330)
            shot(page,'native-head-up-close')
            native.release();page.wait_for_timeout(900)
            choose(page,'freestyle')
            shot(page,'native-float-sidebar-selector')
            check('selector release retains focus and chosen zoom',page.evaluate(
                '__qaWorld.camMode()==="swimmer" && __qaWorld.zoomTarget()===.37 && __qaChar.swimStatus().mode==="rest"'))
            native.hold(-.7,-7);page.wait_for_timeout(420)
            shot(page,'native-freestyle-close')
            page.keyboard.press('Minus')
            check('minus during native swim',abs(page.evaluate('__qaWorld.zoomTarget()')-.37*math.exp(.08))<1e-9)
            page.keyboard.press('Equal')
            check('equals reverses accumulated zoom',abs(page.evaluate('__qaWorld.zoomTarget()')-.37)<1e-9)
            native.release();page.wait_for_timeout(900)
            for _ in range(30):page.keyboard.press('NumpadSubtract')
            page.wait_for_function('__qaWorld.zoom()===1.6')
            check('numpad minus reaches maximum',page.evaluate('__qaWorld.zoomTarget()===1.6'))
            page.keyboard.press('NumpadAdd');page.keyboard.press('Shift+Equal')
            check('numpad add and plus accumulate',abs(page.evaluate('__qaWorld.zoomTarget()')-1.6*math.exp(-.16))<1e-9)
            for _ in range(30):page.keyboard.press('Equal')
            page.wait_for_function('__qaWorld.zoom()===.37')
            check('keyboard reaches same new minimum',page.evaluate('__qaWorld.zoomTarget()===.37'))
            # Deterministic projected skin, separate from native screenshots above.
            page.evaluate('cameraQA.pause()')
            bounds = []
            for width,height in ((1280,800),(420,720),(320,568)):
                page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(150)
                for style in ('head-up','freestyle'):
                    for hair in range(1,7):
                        for yaw in (math.pi/2,-math.pi/2,0,math.pi):
                            samples=page.evaluate('''([style,hair,yaw])=>{
                                const rows=[];
                                for(const phase of [.05,1.5,2.678,3.5])for(const moving of [false,true]){
                                    cameraQA.pose(style,hair,yaw,phase,moving);
                                    rows.push({bounds:cameraQA.bounds(),camera:cameraQA.sample(),phase,moving});
                                }
                                return rows;
                            }''',[style,f'hair{hair}',yaw])
                            for row in samples:
                                b=row['bounds'];row.update(width=width,style=style,hair=hair,yaw=yaw)
                                bounds.append(row)
                                assert b['near']>.1 and b['far']<60, row
                                assert b['left']>-.98 and b['right']<.98 and b['bottom']>-.98 and b['top']<.98, row
                shot(page,f'posed-native-camera-{width}-bounds')
            check('all six hairstyles both strokes four headings fit at closest on desktop/420/320',True,
                  {'samples':len(bounds),'minNear':min(r['bounds']['near'] for r in bounds),
                   'maxAbsNdc':max(abs(r['bounds'][k]) for r in bounds for k in ('left','right','top','bottom'))})
            results['posed_bounds']=bounds
            page.set_viewport_size({'width':1280,'height':800});page.wait_for_timeout(150)
            page.evaluate('cameraQA.pose("head-up","hair1",Math.PI/2,1.5)')
            near=page.evaluate('({b:cameraQA.bounds(),s:cameraQA.sample()})')
            page.evaluate('__qaWorld.setZoom(.55)');page.wait_for_function('__qaWorld.zoom()===.55')
            page.evaluate('cameraQA.step()')
            old=page.evaluate('({b:cameraQA.bounds(),s:cameraQA.sample()})')
            ratio=(near['b']['top']-near['b']['bottom'])/(old['b']['top']-old['b']['bottom'])
            check('quantified closer range',ratio>1.4 and abs(old['s']['distance']/near['s']['distance']-.55/.37)<1e-9,
                  {'projectedHeightRatio':ratio,'oldDistance':old['s']['distance'],'newDistance':near['s']['distance']})
            page.evaluate('__qaWorld.setZoom(.37)');page.wait_for_function('__qaWorld.zoom()===.37')
            invariants=page.evaluate('''()=>{
                const q=cameraQA,w=q.w,c=q.c,rows=[];
                for(const [x,z] of [[-6.2,-1],[6.2,-1],[-6.2,-9.5],[6.2,-9.5],[0,-9.5]]){
                    c.teleport(x,z);q.settle();rows.push(q.sample());
                    const fixed=JSON.stringify(q.sample());
                    for(let i=0;i<120;i++){c.probePose(i/30);q.step();}
                    if(fixed!==JSON.stringify(q.sample()))throw Error('pose/wave bob reached camera');
                }
                return rows;
            }''')
            check('stable centered focus and fixed distance at all swim extremes',all(
                r['mode']=='swimmer' and r['target']==.37 and max(abs(v-.5) for v in r['center'])<1e-6
                and r['quaternion']==initial['quaternion'] and abs(r['distance']-near['s']['distance'])<1e-8 for r in invariants),invariants)
            cadence=[]
            for dts in ([1/30],[1/60],[.012,.047,.021,.036]):
                cadence.append(page.evaluate('dts=>cameraQA.dynamics(dts)',dts))
            check('bounded frame-rate independent entry/travel/float/exit',all(
                r['maxSpeed']<=8 and r['maxStep']<=8*.047 for r in cadence)
                and all(math.dist(a['focus'],b['focus'])<.04 for a,b in zip(cadence[0]['rows'],cadence[1]['rows']))
                and all(math.dist(a['focus'],b['focus'])<.04 for a,b in zip(cadence[1]['rows'],cadence[2]['rows'])),cadence)
            page.evaluate('cameraQA.restore();__beach3d.teleport(0,-7);Beach3D.syncAppearance()');page.wait_for_timeout(2600)
            page.emulate_media(reduced_motion='reduce')
            native.hold(.7,-7);page.wait_for_timeout(400);native.release();page.wait_for_timeout(1000)
            check('RM tracks without snapping or changing zoom',page.evaluate('''()=>{
                const s=cameraQA.sample();return s.mode==='swimmer' && s.target===.37 &&
                    Math.abs(s.focus[0]-s.anchor.x)<.01;
            }'''))
            page.evaluate('cameraQA.hide(true)')
            hidden=page.evaluate('({sample:cameraQA.sample(),frame:__qaWorld.renderer.info.render.frame})')
            page.wait_for_timeout(600)
            check('hidden pauses camera and rendering',hidden==page.evaluate('({sample:cameraQA.sample(),frame:__qaWorld.renderer.info.render.frame})'))
            page.evaluate('cameraQA.hide(false)');page.wait_for_timeout(100)
            resumed=page.evaluate('cameraQA.sample()')
            check('resume retains focus and zoom without catch-up jump',math.dist(resumed['position'],hidden['sample']['position'])<.01 and resumed['target']==.37)
            # Native phone pinch and close screenshots, no camera posing.
            page.emulate_media(reduced_motion='no-preference')
            page.set_viewport_size({'width':420,'height':720});page.wait_for_timeout(300)
            check('resize retains focus and zoom',page.evaluate('__qaWorld.zoomTarget()===.37 && __qaWorld.camMode()==="swimmer"'))
            page.evaluate('__qaWorld.setZoom(.55)');page.wait_for_function('__qaWorld.zoom()===.55')
            cdp=context.new_cdp_session(page)
            r=page.evaluate('__qaWorld.canvas.getBoundingClientRect().toJSON()');cy=r['y']+r['height']*.65
            cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':180,'y':cy,'id':1},{'x':240,'y':cy,'id':2}]})
            cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':140,'y':cy,'id':1},{'x':280,'y':cy,'id':2}]})
            cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            page.wait_for_function('__qaWorld.zoom()===.37')
            check('native touch spread reaches same minimum',page.evaluate('__qaWorld.zoomTarget()===.37'))
            page.wait_for_timeout(900)
            shot(page,'native-portrait-close-float')
            native=NativeInput(page,True)
            for style in ('head-up','freestyle'):
                choose(page,style);native.hold(page.evaluate('__qaChar.loco.x')+.5,-7);page.wait_for_timeout(330)
                shot(page,'native-portrait-close-'+style)
                native.release();page.wait_for_timeout(800)
            native.travel(0,1)
            page.wait_for_timeout(2200)
            land=page.evaluate('cameraQA.sample()')
            check('native return to shore preserves closest overview with portrait tracking',land['mode']=='overview' and land['target']==.37
                  and math.dist(land['position'],[land['anchor']['x'],1.66+1.94*.37,2.64+7.76*.37])<1e-8,land)
            shot(page,'native-land-return-closest')
            page.evaluate('__qaWorld.setZoom(1)');page.wait_for_function('__qaWorld.zoom()===1')
            shot(page,'native-land-return-default')
            # Warmed repeated transitions have no renderer resource growth.
            warmed=page.evaluate('__beach3d.performance()')
            page.evaluate('''()=>{cameraQA.pause();for(let i=0;i<30;i++){
                __qaChar.teleport(i%2?0:2,i%2?2.6:-7);cameraQA.settle();}cameraQA.restore();}''')
            page.wait_for_timeout(500)
            after=page.evaluate('__beach3d.performance()')
            check('camera transitions do not grow GPU resources',all(warmed[k]==after[k] for k in ('geometries','textures')),{'before':warmed,'after':after})
            check('no browser errors or external requests',not errors and not external,{'errors':errors,'external':external})
        except Exception as exc:
            results['failure']=str(exc)
            raise
        finally:
            browser.close()
            (out/'camera-test.json').write_text(json.dumps(results,indent=2))


if __name__ == '__main__':
    main()
