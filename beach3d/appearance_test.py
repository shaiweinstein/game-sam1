"""Bounded hair/palette/save/lifecycle regression; serve on localhost:8123.

Uses the existing Python Playwright environment, not a game dependency.
Artifacts stay in /tmp/kilo/beach-hair; browser storage is isolated.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright
from ground_contact_test import enter


INSPECT = """() => {
    const a=__beach3d.appearance(), palette=CHARACTERS[GameState.getCharacter().id];
    let triangles=0,calls=0,hairTriangles=0,hairCalls=0,checked=0;
    __qaChar.root.traverse(m=>{
        if(!m.isMesh)return;
        const n=m.material.name;
        const expected=n==='hairTie'?'#ff8fb8':n==='hairTieShade'?'#d9568a':palette[n];
        if(n.startsWith('hair')) {
            if('#'+m.material.color.getHexString()!==expected) throw Error('Palette mismatch: '+n);
            if(m.material.side!==0) throw Error('Hair must use FrontSide');
            checked++;
        }
    });
    __qaChar.root.traverseVisible(m=>{
        if(!m.isMesh)return;
        const t=(m.geometry.index?.count||m.geometry.attributes.position.count)/3;
        triangles+=t;calls++;
        if(m.material.name.startsWith('hair')){hairTriangles+=t;hairCalls++;}
    });
    if(checked!==16) throw Error('Expected all 16 hair primitives, including hidden styles');
    if(!a.visibleHair[a.hair] || Object.values(a.visibleHair).filter(Boolean).length!==1)
        throw Error('Expected exactly one visible hair group');
    return {hair:a.hair,friend:a.friend,triangles,calls,hairTriangles,hairCalls};
}"""


def wait_ready(page):
    page.wait_for_function('__beach3d.state()?.boat?.ready && __beach3d.state()?.surf?.ready')
    assert page.evaluate('__beach3d.waitReady()')
    page.wait_for_function('__beach3d.appearance()?.hair===GameState.getOutfit().hair')


def warm(page):
    for friend in ('amara', 'mei', 'sofia', 'lily'):
        page.evaluate('(id)=>GameState.setCharacterId(id)', friend)
        assert page.evaluate('__beach3d.syncAppearance()')
        for i in range(1, 7):
            page.evaluate('(i)=>{GameState.setOutfitSlot("hair","hair"+i);GameState.setOutfitSlot("swimsuit","suit"+i);}', i)
            page.wait_for_timeout(100)
    page.evaluate('GameState.setOutfitSlot("hair","hair1");GameState.setOutfitSlot("swimsuit","suit1")')
    page.wait_for_timeout(100)
    return page.evaluate('__beach3d.performance()')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', default='/tmp/kilo/beach-hair')
    args=parser.parse_args()
    out=Path(args.out); out.mkdir(parents=True, exist_ok=True)
    results, errors, external, assets = {}, [], [], []

    def check(name, ok, detail=None):
        results[name]={'pass':bool(ok),'detail':detail}
        print(('PASS ' if ok else 'FAIL ')+name, flush=True)
        assert ok, (name,detail)

    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        try:
            page=browser.new_page(viewport={'width':1280,'height':800})
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
            page.on('request',lambda r:external.append(r.url) if r.url.startswith(('http:','https:'))
                    and not r.url.startswith('http://localhost:8123/') else None)
            page.on('request',lambda r:assets.append(r.url) if r.url.endswith('/lily4_full.glb') else None)
            enter(page)
            page.emulate_media(reduced_motion='reduce')
            check('default saved hair',page.evaluate('__beach3d.appearance().hair')=='hair1')
            matrix=[]; loaded=len(assets)
            for friend in ('lily','amara','mei','sofia'):
                page.evaluate('(id)=>GameState.setCharacterId(id)',friend)
                assert page.evaluate('__beach3d.syncAppearance()')
                for i in range(1,7):
                    page.evaluate('(id)=>GameState.setOutfitSlot("hair",id)',f'hair{i}')
                    assert page.evaluate('__beach3d.appearance().hair')==f'hair{i}'
                    matrix.append(page.evaluate(INSPECT))
            check('six styles x four palettes, including hidden materials and fixed pink ties',len(matrix)==24,matrix)
            check('live switches never reload the GLB',len(assets)==loaded)
            check('invalid/idempotent setters do not change saved outfit or root height',page.evaluate("""()=>{
                const c=__qaChar,saved=JSON.stringify(GameState.getOutfit()),y=c.getRootY();
                for(const id of [null,'missing','__proto__',17]) {
                    if(!c.setHair(id)||c.appearance().hair!=='hair1')return false;
                }
                for(let i=0;i<100;i++)c.setHair('hair'+(i%6+1));
                c.setHair('hair5');c.setHair('hair5');
                return c.appearance().hair==='hair5' && c.getRootY()===y &&
                    JSON.stringify(GameState.getOutfit())===saved;
            }"""))
            check('rapid pre-ready changes and disposal',page.evaluate("""async()=>{
                const {createCharacter}=await import('/beach3d/character3d.js');
                const T=await import('/lib/three/three.module.js');
                const scene=new T.Scene(),c=createCharacter(__qaWorld.renderer,scene,()=>true,{});
                for(const id of ['hair2',null,'hair6','hair5'])c.setHair(id);
                const ok=await c.ready,a=c.appearance();c.dispose();
                const early=createCharacter(__qaWorld.renderer,scene,()=>true,{});
                early.setHair('hair3');early.dispose();const loaded=await early.ready;
                return ok && a.hair==='hair5' && Object.values(a.visibleHair).filter(Boolean).length===1 &&
                    !c.setHair('hair2') && !loaded && scene.children.length===0;
            }"""))
            # Deliberately omit one style at the loader boundary, without
            # changing the shipped asset or duplicating the selector logic.
            def missing(route):
                response=route.fetch()
                body=response.text().replace('const originals = new Set();', '''
                    const missing=gltf.scene.getObjectByName('Hair_hair6');
                    missing.traverse(m=>{if(m.isMesh)m.geometry.dispose();});
                    missing.removeFromParent();const originals = new Set();''')
                route.fulfill(response=response,body=body)
            page.route('**/character3d.js?appearance-missing',missing)
            check('unavailable style falls back without changing save',page.evaluate("""async()=>{
                const {createCharacter}=await import('/beach3d/character3d.js?appearance-missing');
                const T=await import('/lib/three/three.module.js');
                const saved=JSON.stringify(GameState.getOutfit());
                const c=createCharacter(__qaWorld.renderer,new T.Scene(),()=>true,{});
                c.setHair('hair6');await c.ready;const a=c.appearance();c.dispose();
                return a.hair==='hair1' && a.visibleHair.hair6===0 &&
                    JSON.stringify(GameState.getOutfit())===saved;
            }"""))
            for i in range(1,7):
                page.evaluate('(id)=>GameState.setOutfitSlot("swimsuit",id)',f'suit{i}')
                check(f'suit{i} geometry and colors unaffected',page.evaluate("""()=>{
                    const a=__beach3d.appearance(),c=CharacterRenderer.catalog.swimsuit[a.suit].colors;
                    const g=c.twoPiece?(a.suit==='suit5'?'crop':'tank'):'one';
                    const m=g==='one'?'suit':g==='tank'?'suitTank':'suitCrop';
                    return a.visible[g]>0 && Object.values(a.visible).filter(Boolean).length===1 &&
                        a.materials[m+'Main'].color===c.main && a.materials[m+'Trim'].color===c.trim &&
                        (g==='one'||a.materials[m+'Bottom'].color===c.bottom);
                }"""))
            for hair,width in [('hair2',1280),('hair5',390)]:
                page.set_viewport_size({'width':width,'height':800})
                before=page.evaluate('({friend:GameState.getCharacter().id,energy:GameState.getEnergy(),location:GameState.getLocation().id})')
                page.get_by_role('button',name='Change swimsuit').click()
                assert page.locator('#wardrobe-tab-swimsuit').get_attribute('aria-selected')=='true'
                page.click('#wardrobe-tab-hair')
                page.locator(f'.wardrobe-item[data-item-id="{hair}"]').click()
                page.screenshot(path=str(out/f'wardrobe-{hair}.png'))
                page.get_by_role('button',name='Back to Beach').click()
                wait_ready(page)
                after=page.evaluate('({friend:GameState.getCharacter().id,energy:GameState.getEnergy(),location:GameState.getLocation().id})')
                check(f'real wardrobe {hair} return at {width}px',before==after and
                      page.evaluate('__beach3d.appearance().hair')==hair,after)
                page.screenshot(path=str(out/f'return-{hair}.png'))
            saved=page.evaluate('JSON.parse(localStorage.getItem("lily-game-save-v1")).outfit.hair')
            page.reload(wait_until='networkidle')
            page.click('#welcome-continue')
            page.click('.nav-button[data-screen="map"]');page.click('.place[data-place-id="beach"]')
            if page.locator('#beach-scene').is_hidden():page.click('#beach-play-button')
            wait_ready(page)
            check('reload honors existing outfit.hair',saved=='hair5' and page.evaluate('__beach3d.appearance().hair')==saved)
            page.set_viewport_size({'width':1280,'height':800})
            first=warm(page)
            page.evaluate('window.retiredGL=__qaWorld.renderer.getContext()')
            page.click('#beach-close');page.wait_for_function('retiredGL.isContextLost()')
            page.click('.place[data-place-id="beach"]')
            if page.locator('#beach-scene').is_hidden():page.click('#beach-play-button')
            wait_ready(page)
            second=warm(page)
            check('warm reopen geometry/textures stable; old context disposed',
                  all(first[k]==second[k] for k in ('geometries','textures')) and
                  page.evaluate('retiredGL.isContextLost() && !__beach3d.performance().contextLost'),
                  {'first':first,'second':second})
            results['assetBytes']=(Path(__file__).parent/'assets/lily4_full.glb').stat().st_size
            page.context.set_offline(True)
            for i in range(1,7):
                page.evaluate('(i)=>{GameState.setCharacterId(["lily","amara","mei","sofia"][i%4]);GameState.setOutfitSlot("hair","hair"+i);}',i)
                assert page.evaluate('__beach3d.syncAppearance()')
                assert page.evaluate(INSPECT)['hair']==f'hair{i}'
            page.context.set_offline(False)
            check('all styles switch offline after warming',True)
            check('no browser errors/external requests',not errors and not external,{'errors':errors,'external':external})
        finally:
            browser.close()
            (out/'appearance-test.json').write_text(json.dumps(results,indent=2))
    print(f'Report: {out / "appearance-test.json"}',flush=True)


if __name__=='__main__':
    main()
