"""Native press/hold/release swim-style regression on localhost:8123.

No teleports, program targets, mixer stepping or pose parking. --baseline records
the old UI failure without requiring the new visible status. Artifacts stay in
/tmp/kilo/swim-switch-fix. Requires Python Playwright and Pillow.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright
from ground_contact_test import enter


OBSERVE = """async () => {
    const T=await import('/lib/three/three.module.js'), W=await import('/beach3d/world.js');
    const c=__qaChar, v=new T.Vector3(), skin=[], bones=[];
    c.root.traverse(m=>{
        if(m.isBone)bones.push(m);
        if(!m.isSkinnedMesh || !m.visible)return;
        const a=m.geometry.attributes;
        // Read actual skinned face and limb vertices, in character-local space.
        if(m.material.name==='faceTexture' || m.material.name==='skin')
            for(let i=0;i<a.position.count;i+=Math.max(1,Math.floor(a.position.count/24)))skin.push({m,i});
    });
    window.nativeQA={events:[],sample(){
        c.root.updateMatrixWorld(true);
        const pose=skin.flatMap(({m,i})=>{
            m.getVertexPosition(i,v).applyMatrix4(m.matrixWorld);c.root.worldToLocal(v);
            // The mesh model follows the spatial water surface even under RM.
            // Remove that translation, not the skin deformation being measured.
            v.y-=c.getRootY();
            return v.toArray();
        });
        const canvas=__qaWorld.canvas,a=c.actionInfo(),l=c.loco;
        return {selected:document.querySelector('#beach-swim-style')?.value,
            saved:GameState.getSwimStyle(),action:a,moving:c.isMoving(),x:l.x,z:l.z,
            depth:W.WORLD.water.y-W.sandY(l.x,l.z),target:l.target,source:l.targetSrc,
            clearance:W.WORLD.water.y-.061-Math.max(W.sandY(l.x,l.z+.41),
                W.sandY(l.x+l.vx*.3,l.z+l.vz*.3+.41)),
            focus:document.activeElement.id || document.activeElement.tagName,
            capture:this.events.length?canvas.hasPointerCapture(this.events.at(-1).id):false,
            status:document.querySelector('#beach-swim-status')?.textContent || '',pose,
            bonePose:bones.flatMap(b=>[...b.position.toArray(),...b.quaternion.toArray()]),
            viewportHeight:innerHeight,stage:__qaWorld.canvas.getBoundingClientRect().toJSON(),
            feedback:(()=>{const n=document.querySelector('#beach-swim-status');
                return n && {box:n.getBoundingClientRect().toJSON(),height:n.clientHeight,
                    scroll:n.scrollHeight,display:getComputedStyle(n).display};})(),
            camera:[__qaWorld.camera.position.toArray(),__qaWorld.camera.quaternion.toArray(),__qaWorld.zoomTarget()],
            camMode:__qaWorld.camMode(),camFocus:__qaWorld.camFocus(),
            camStep:__qaWorld.camStep(),camSpeed:__qaWorld.camSpeed()};
    }};
    for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])
        __qaWorld.canvas.addEventListener(type,e=>nativeQA.events.push({type,id:e.pointerId,pointer:e.pointerType}));
}"""


class NativeInput:
    def __init__(self, page, touch):
        self.page, self.touch = page, touch
        self.cdp = page.context.new_cdp_session(page) if touch else None

    def point(self, x, z):
        # Follow can move the requested destination offscreen. Aim at the
        # farthest visible waypoint along the same world path, then re-aim.
        p = self.page.evaluate('''([x,z])=>{
            const w=__qaWorld,a=__qaChar.getAnchor(),r=w.canvas.getBoundingClientRect();
            const visible=p=>p.x>r.left+12 && p.x<r.right-12 && p.y>r.top+12 && p.y<r.bottom-12 && !p.behind;
            let p=w.project(x,.12,z);if(visible(p))return p;
            let lo=0,hi=1;
            for(let i=0;i<30;i++){const t=(lo+hi)/2;
                p=w.project(a.x+(x-a.x)*t,.12,a.z+(z-a.z)*t);
                if(visible(p))lo=t;else hi=t;
            }
            return w.project(a.x+(x-a.x)*lo,.12,a.z+(z-a.z)*lo);
        }''', [x,z])
        hit = self.page.evaluate('p=>document.elementFromPoint(p.x,p.y)?.tagName', p)
        assert hit == 'CANVAS', ('target not reachable through viewport', p, hit)
        return p

    def hold(self, x, z):
        p = self.point(x,z)
        if self.touch:
            self.cdp.send('Input.dispatchTouchEvent', {'type':'touchStart',
                'touchPoints':[{'x':p['x'],'y':p['y'],'id':1}]})
        else:
            self.page.mouse.move(p['x'],p['y']); self.page.mouse.down()

    def drag(self, x, z):
        p = self.point(x,z)
        if self.touch:
            self.cdp.send('Input.dispatchTouchEvent', {'type':'touchMove',
                'touchPoints':[{'x':p['x'],'y':p['y'],'id':1}]})
        else:
            self.page.mouse.move(p['x'],p['y'])

    def release(self):
        if self.touch:
            self.cdp.send('Input.dispatchTouchEvent', {'type':'touchEnd','touchPoints':[]})
        else:
            self.page.mouse.up()

    def travel(self, x, z):
        for _ in range(16):
            self.hold(x,z)
            self.page.wait_for_function('!__qaChar.loco.target', timeout=18000)
            self.release()
            self.page.wait_for_timeout(700)
            if self.page.evaluate('([x,z])=>Math.hypot(__qaChar.loco.x-x,__qaChar.loco.z-z)<.12',[x,z]):
                return
        raise AssertionError(('native waypoints did not reach destination',x,z))


def choose(page, style):
    select = page.locator('#beach-swim-style')
    if page.evaluate('navigator.maxTouchPoints>0'):
        select.tap()
    else:
        select.click()
    page.keyboard.press('Home' if style == 'head-up' else 'End')
    page.keyboard.press('Enter')
    page.wait_for_timeout(100)
    assert select.input_value() == style
    assert page.evaluate('document.activeElement.id') == 'beach-swim-style'


def record(page, out, label, shots=False):
    row = page.evaluate('nativeQA.sample()')
    if shots:
        page.screenshot(path=str(out/f'{label}.png'))
        p = page.evaluate('__beach3d.project(__qaChar.loco.x,.16,__qaChar.loco.z)')
        with Image.open(out/f'{label}.png') as image:
            crop = image.crop((p['x']-75,p['y']-70,p['x']+75,p['y']+50)).resize((300,240))
            crop.save(out/f'{label}-pose.png')
    return row


def feedback(row, expected):
    assert expected in row['status'], row['status']
    box = row['feedback']
    assert box and box['display'] != 'none' and box['height'] >= box['scroll']
    assert box['box']['width'] > 0 and box['box']['height'] > 0
    assert box['box']['bottom'] <= row['viewportHeight']


def hysteresis(page, native, out, prefix, rows):
    """Reach the same narrow depth band from shore using only held pointer input."""
    z = page.evaluate('''async()=>{
        const W=await import('/beach3d/world.js');let lo=-8,hi=-2;
        for(let i=0;i<40;i++){
            const z=(lo+hi)/2,d=W.WORLD.water.y-.061-W.sandY(0,z+.41);
            if(d>.3925)lo=z;else hi=z;
        }return (lo+hi)/2;
    }''')
    choose(page,'freestyle')
    native.travel(0,-7)
    # Approach the narrow band from a nearby resting point, rather than carrying
    # deep-water speed whose safety lookahead would correctly exit the band.
    native.travel(0,z-.3)
    native.hold(0,z)
    page.wait_for_function('__beach3d.action().clip==="SwimFreestyle"')
    page.wait_for_function('!__qaChar.loco.target',timeout=15000)
    native.release();page.wait_for_timeout(700)
    rows['arrival']=record(page,out,prefix+'-band-arrival',shots=True)
    feedback(rows['arrival'],'Freestyle ready. Resting Head-up.')
    for i,style in enumerate(('head-up','freestyle','head-up','freestyle','freestyle')):
        if i==3:
            for rapid in ('head-up','freestyle','head-up','freestyle'):
                choose(page,rapid)
        before=page.evaluate('({x:__qaChar.loco.x,z:__qaChar.loco.z})')
        choose(page,style)
        assert before==page.evaluate('({x:__qaChar.loco.x,z:__qaChar.loco.z})')
        label=prefix+f'-band-{i}-{style}'
        selected=record(page,out,label+'-selected',shots=True)
        sequence=rows[label]={'selected':selected,'hold':[]}
        native.hold(-1 if selected['x']>0 else 1,z)
        for frame in range(4):
            page.wait_for_timeout(350)
            row=record(page,out,label+f'-{frame}',shots=True)
            sequence['hold'].append(row)
            # Reverse before reaching the target to remain in this small band.
            native.drag(-1 if row['x']>0 else 1,z)
        native.release();page.wait_for_timeout(800)
        rest=sequence['rest']=record(page,out,label+'-rest')
        expected='SwimFreestyle' if style=='freestyle' else 'Swim'
        for row in [selected,*sequence['hold'],rest]:
            guard=row['action']['swimDepthGuard']
            assert guard['exit']<row['clearance']<guard['enter'], ('left hysteresis band',row['clearance'])
            assert row['saved']==row['selected']==row['action']['swimStyle']==style
        assert all(row['action']['clip']==expected for row in sequence['hold']), (label,sequence['hold'][-1]['action'])
        assert all(row['source']=='pointer' and row['moving'] and row['capture'] for row in sequence['hold'])
        assert len({row['action']['time'] for row in sequence['hold']})==4
        assert max(abs(a-b) for a,b in zip(sequence['hold'][0]['pose'],sequence['hold'][-1]['pose']))>.02
        assert rest['action']['stance']=='float' and rest['action']['clip']=='Swim' and not rest['capture']
        feedback(selected,('Freestyle' if style=='freestyle' else 'Head-up')+' ready. Resting Head-up.')
        feedback(sequence['hold'][-1],'Swimming '+('Freestyle' if style=='freestyle' else 'Head-up'))
        feedback(rest,'Resting Head-up')
        print(label,'PASS',expected,'clearance',rest['clearance'],flush=True)
    # Forget eligibility physically, even while Head-up is selected. Returning
    # to the band from shallower water must not inherit the former deep history.
    choose(page,'head-up');native.travel(0,-4)
    native.travel(0,z)
    choose(page,'freestyle');native.hold(1,z)
    page.wait_for_timeout(650)
    row=rows['unsafe-return']=record(page,out,prefix+'-unsafe-return',shots=True)
    assert row['action']['clip']=='Swim' and row['action']['swimDepthGuard']['active']
    assert .380<row['clearance']<.405
    feedback(row,'Freestyle selected; swimming Head-up in shallows')
    native.release();page.wait_for_timeout(800)
    native.hold(0,-7)
    page.wait_for_function('__beach3d.action().clip==="SwimFreestyle"',timeout=15000)
    rows['requalified']=record(page,out,prefix+'-requalified')
    assert rows['requalified']['clearance']>=.405
    native.release();page.wait_for_timeout(800)
    print(prefix,'PASS unsafe exit clears readiness until deep re-entry',flush=True)


def extras(page, native, out, prefix):
    """Reopening/loading, native restart, RM and live state sync without posing."""
    rows = {}
    native.travel(0,-6.5)
    before = page.evaluate('GameState.get()')
    for style in ('freestyle','head-up','freestyle','head-up','freestyle','freestyle'):
        choose(page,style)
    after = page.evaluate('GameState.get()')
    assert {k:v for k,v in before.items() if k!='swimStyle'} == {k:v for k,v in after.items() if k!='swimStyle'}
    feedback(record(page,out,prefix),'Freestyle ready. Resting Head-up.')
    # Native focused control keeps Space, rather than arming the wave catcher.
    page.click('[data-activity-id="surfcatch"]')
    choose(page,'freestyle')
    page.keyboard.press('Space');page.keyboard.press('Enter')
    assert not page.evaluate('__beach3d.surf().armed')
    assert page.evaluate('document.activeElement.id') == 'beach-swim-style'
    page.click('[data-activity-id="surfcatch"]')
    for style in ('freestyle','head-up','freestyle'):
        native.travel(-1.5,-6.5)
        choose(page,style)
        native.hold(1.5,-6.5)
        page.wait_for_timeout(650)
        a=record(page,out,prefix)
        # Appearance notifications must not rewind the stroke or preference.
        page.evaluate('''()=>{GameState.setOutfitSlot('hair','hair6');
            GameState.setOutfitSlot('swimsuit','suit5');GameState.setCharacterId('amara');
            for(let i=0;i<4;i++)Beach3D.syncAppearance();}''')
        page.wait_for_timeout(650)
        b=record(page,out,prefix)
        assert a['action']['clip']==b['action']['clip']==('SwimFreestyle' if style=='freestyle' else 'Swim')
        assert b['saved']==b['selected']==b['action']['swimStyle']==style
        assert b['action']['time']!=a['action']['time']
        native.release();page.wait_for_timeout(700)
    rows['sync']=b
    page.emulate_media(reduced_motion='reduce')
    for style in ('head-up','freestyle','freestyle'):
        native.travel(-1.5,-8)
        choose(page,style)
        native.hold(1.5,-8)
        page.wait_for_timeout(450);a=record(page,out,prefix)
        page.wait_for_timeout(450);b=record(page,out,prefix)
        assert a['action']['time']==b['action']['time']
        delta=max(abs(x-y) for x,y in zip(a['pose'],b['pose']))
        assert a['bonePose']==b['bonePose']
        # Float32 skin weights leave sub-micrometre roundoff after removing root travel.
        assert delta<1e-6, ('RM local skin drift',style,delta,a['action'],b['action'])
        assert abs(a['x']-b['x'])+abs(a['z']-b['z'])>.1
        feedback(b,'pose (reduced motion)')
        native.release();page.wait_for_timeout(700)
    rows['rm']=b
    page.emulate_media(reduced_motion='no-preference')
    page.click('[data-activity-id="swimsuits"]')
    # Choose the latest preference while a fresh character load is outstanding.
    pending=[]
    def delay(route):
        pending.append(route)
    page.route('**/beach3d/assets/lily4_full.glb',delay)
    page.get_by_role('button',name='Back to Beach').click()
    for style in ('head-up','freestyle','head-up','freestyle'):
        choose(page,style)
    assert pending
    for route in pending:route.fallback()
    page.unroute('**/beach3d/assets/lily4_full.glb',delay)
    assert page.evaluate('__beach3d.waitReady()')
    page.wait_for_function('__beach3d.appearance()?.friend==="amara"')
    page.evaluate(OBSERVE)
    feedback(record(page,out,prefix),'Freestyle selected. Press and hold water')
    rows['reopen']=page.evaluate('({state:GameState.get(),appearance:__beach3d.appearance()})')
    page.reload(wait_until='networkidle')
    page.click('#welcome-continue');page.click('.nav-button[data-screen="map"]');page.click('.place[data-place-id="beach"]')
    if page.locator('#beach-scene').is_hidden():page.click('#beach-play-button')
    assert page.evaluate('__beach3d.waitReady()')
    page.wait_for_function('__beach3d.appearance()?.friend==="amara"')
    page.evaluate(OBSERVE)
    assert page.evaluate('GameState.get()')==rows['reopen']['state']
    assert page.locator('#beach-swim-style').input_value()=='freestyle'
    # From the restored shore, one ordinary hold toward the horizon finds it.
    native.hold(0,-8)
    page.wait_for_function('__beach3d.action().clip==="SwimFreestyle"',timeout=15000)
    page.wait_for_timeout(600)
    rows['continueHold']=record(page,out,prefix+'-continue-hold',shots=True)
    feedback(rows['continueHold'],'Swimming Freestyle')
    native.release();page.wait_for_timeout(700)
    native.travel(0,2.6)
    feedback(record(page,out,prefix),'Freestyle selected. Press and hold water')
    page.evaluate('GameState.reset()');page.wait_for_timeout(100)
    rows['reset']=record(page,out,prefix)
    assert rows['reset']['selected']==rows['reset']['saved']==rows['reset']['action']['swimStyle']=='head-up'
    feedback(rows['reset'],'Head-up selected')
    if not native.touch:
        boat=page.evaluate('''()=>{const b=__beach3d.boat();return __beach3d.project(b.x,b.y+.3,b.z);}''')
        page.mouse.click(boat['x'],boat['y'])
        page.wait_for_function('__beach3d.boat().riding',timeout=16000)
        for style in ('freestyle','head-up'):
            choose(page,style)
            row=record(page,out,prefix)
            assert row['action']['clip']=='Sit' and page.evaluate('__beach3d.boat().riding')
            feedback(row,'selected for your next swim. Boat ride continues.')
        rows['boat']=row
        page.click('[data-activity-id="boathop"]')
        native.travel(-1,-8)
        page.click('[data-activity-id="surfcatch"]')
        page.locator('.beach3d-host canvas').focus()
        page.keyboard.down('Space')
        page.wait_for_function('__beach3d.surf().riding',timeout=18000)
        page.keyboard.up('Space')
        for style in ('freestyle','head-up'):
            choose(page,style)
            row=record(page,out,prefix)
            assert row['action']['clip']=='SurfRide' and page.evaluate('__beach3d.surf().riding')
            feedback(row,'selected for your next swim. Surfing continues.')
        rows['surf']=row
    return rows


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline',action='store_true')
    parser.add_argument('--extras-only',action='store_true',help='Run native lifecycle/RM checks without the filmstrip matrix')
    parser.add_argument('--hysteresis-only',action='store_true',help='Run native same-band style detours and unsafe re-entry')
    parser.add_argument('--out',default='/tmp/kilo/swim-switch-fix/native')
    args = parser.parse_args()
    out = Path(args.out); out.mkdir(parents=True,exist_ok=True)
    results, errors = {}, []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            for width,height,touch in ((1280,800,False),(420,720,True)):
                context = browser.new_context(viewport={'width':width,'height':height},has_touch=touch)
                page = context.new_page()
                page.on('pageerror',lambda e:errors.append(str(e)))
                enter(page); page.evaluate(OBSERVE)
                native = NativeInput(page,touch)
                span = 1.2 if touch else 3
                cases = results[str(width)] = {}
                try:
                    for zone,z in (() if args.extras_only or args.hysteresis_only else (('near',-1),('mid',-3.5),('deep',-6.5))):
                        for i,style in enumerate(('head-up','freestyle','head-up')):
                            label = f'{width}-{zone}-{i}-{style}'
                            # Central water is reachable on narrow screens and clear of the boat.
                            direction = 1 if i%2==0 else -1
                            native.travel(-direction*span,z)
                            choose(page,style)
                            idle = record(page,out,label+'-selected',shots=True)
                            assert idle['saved'] == idle['action']['swimStyle'] == style
                            assert idle['source'] is None and not idle['capture']
                            native.hold(direction*span,z)
                            page.wait_for_function('__qaChar.loco.moving && __qaChar.loco.targetSrc==="pointer"')
                            rows=[]
                            for frame in range(6):
                                page.wait_for_timeout(750)
                                rows.append(record(page,out,label+f'-{frame}',shots=True))
                                if rows[-1]['x']*direction > span-1.4:
                                    direction *= -1
                                    native.drag(direction*span,z)
                            native.release();page.wait_for_timeout(800)
                            rest=record(page,out,label+'-rest')
                            cases[label]={'idle':idle,'hold':rows,'rest':rest}
                            expected = 'SwimFreestyle' if style=='freestyle' and zone=='deep' else 'Swim'
                            assert all(r['moving'] and r['source']=='pointer' and r['capture'] for r in rows)
                            assert all(r['action']['clip']==expected for r in rows), label
                            assert len({r['action']['time'] for r in rows})>4
                            assert max(abs(a-b) for a,b in zip(rows[0]['pose'],rows[2]['pose']))>.02
                            assert rest['action']['stance']=='float' and rest['action']['clip']=='Swim'
                            assert rest['saved']==style and not rest['capture'] and rest['source'] is None
                            if not args.baseline:
                                feedback(idle,'Resting Head-up')
                                feedback(rest,'Resting Head-up')
                                for row in rows:
                                    feedback(row,'Freestyle selected; swimming Head-up in shallows'
                                             if style=='freestyle' and zone!='deep' else 'Swimming '+('Freestyle' if style=='freestyle' else 'Head-up'))
                                    assert row['camera'][1:]==idle['camera'][1:] and row['stage']==idle['stage']
                                    assert row['camMode']=='swimmer'
                                    assert abs(row['camFocus'][0]-row['x'])<.3 and abs(row['camFocus'][2]-row['z'])<.3
                                    assert row['camSpeed']<2 and row['camStep']<.65
                                    assert row['focus']=='CANVAS'
                                    active={k:v for k,v in row['action']['all'].items() if v['active']}
                                    assert set(active)=={expected} and abs(sum(v['w'] for v in active.values())-1)<.003
                            print(label, 'selected',idle['action']['clip'],'hold',rows[-1]['action']['clip'],
                                  'guard',rows[-1]['action']['swimDepthGuard'],'status',rows[-1]['status'],flush=True)
                    if not args.baseline and not args.extras_only:
                        cases['hysteresis']={}
                        hysteresis(page,native,out,str(width),cases['hysteresis'])
                    if not args.baseline and not args.hysteresis_only:
                        cases['extras']=extras(page,native,out,str(width))
                        print(width,'PASS rapid/reselect, live appearance, RM, delayed load, Wardrobe/Continue native hold, reset',flush=True)
                    cases['pointerEvents']=page.evaluate('nativeQA.events')
                except Exception:
                    cases['failureState']=page.evaluate('nativeQA.sample()')
                    cases['failureRide']=page.evaluate('({boat:__beach3d.boat(),surf:__beach3d.surf()})')
                    raise
                finally:
                    context.close()
            assert not errors,errors
        finally:
            browser.close()
            (out/'native-switch.json').write_text(json.dumps({'cases':results,'errors':errors},indent=2))
            for width in (1280,420):
                files=sorted(out.glob(f'{width}-deep-*-pose.png'))
                # Six real advancing frames per style; no posed/mixer-injected stills.
                files=[f for f in files if 'selected' not in f.name]
                if not files:continue
                film=Image.new('RGB',(6*300,3*270),'#fff9ec');draw=ImageDraw.Draw(film)
                for i,file in enumerate(files):
                    film.paste(Image.open(file),(i%6*300,i//6*270))
                    draw.text((i%6*300+5,i//6*270+245),file.stem,fill='#30234c')
                film.save(out/f'{width}-native-filmstrip.png')


if __name__ == '__main__':
    main()
