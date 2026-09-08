#!/usr/bin/env python3
"""Focused SVG contracts, independent of the wardrobe UI.

Requires a running game HTTP server (default: http://localhost:8123),
Python Playwright, and its Chromium browser. This test never manages the server.
Example: /tmp/kilo/venv/bin/python tests/character_svg_test.py
Assertions use SVG geometry and DOM/state contracts, not screenshot pixels.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


# Serve an isolated document from the real origin, loading real production modules.
HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
body { margin:0; } #stage, svg.character { width:600px; height:680px; display:block; }
</style><script src="js/state.js"></script><script src="js/character.js"></script>
</head><body><div id="stage"></div></body></html>"""
INSTRUMENT = """window.testMaps=[]; const NativeMap=Map;
window.Map=class extends NativeMap {
  constructor(...args) { super(...args); window.testMaps.push(this); }
};
window.storageWrites=0;
for (const name of ['setItem','removeItem','clear']) {
  const original=Storage.prototype[name];
  Storage.prototype[name]=function(...args) { storageWrites++; return original.apply(this,args); };
}
"""
CONTRACTS = r"""() => {
  const R=CharacterRenderer, G=GameState, C=R.catalog, friends=Object.keys(CHARACTERS);
  const check=(ok,message) => { if (!ok) throw new Error(message); };
  const stage=document.getElementById('stage'), skip=['top','bottom','shoes'];
  const layer=(el,name) => el.querySelector('[data-layer="'+name+'"]');
  const painted=(el,name) => layer(el,name).childElementCount > 0;
  const dressed=el => painted(el,'top') && painted(el,'bottom') && !painted(el,'swimsuit');
  R.render(stage);
  const registry=testMaps.find(map => map.has(stage));
  check(!!registry,'Renderer registry instrumentation unavailable');
  const others=['kitchen','map',...friends].map(id => {
    const el=document.createElement('div'); document.body.append(el);
    R.render(el,{size:'small',characterId:friends.includes(id)?id:undefined}); return el;
  });
  let refs=others.map(el => el.firstElementChild);
  const mutableSkip=skip.slice(); R.setPreviewSkip(stage,mutableSkip); mutableSkip.length=0;
  check(painted(stage,'swimsuit') && skip.every(name => !painted(stage,name)),'Scoped skip must copy its list');
  check(others.every((el,i) => dressed(el) && el.firstElementChild===refs[i]),'Preview changed another instance');
  G.setOutfitSlot('top','top7'); G.setOutfitSlot('swimsuit','suit4');
  check(!painted(stage,'top') && layer(stage,'swimsuit').innerHTML.includes(C.swimsuit.suit4.colors.main),
    'Outfit refresh lost scoped preview or latest swimsuit');
  check(others.every(dressed),'Outfit refresh leaked swimsuit preview');
  check(others.slice(2).every((el,i) => el.firstElementChild.getAttribute('aria-label')===CHARACTERS[friends[i]].name),
    'Friend overrides lost during refresh');
  R.render(stage,{size:'small'});
  check(!painted(stage,'top') && stage.firstElementChild.classList.contains('character-small'),'Explicit render lost preview');
  refs=others.map(el => el.firstElementChild); R.setPreviewSkip(stage,null);
  check(dressed(stage) && others.every((el,i) => el.firstElementChild===refs[i]),'Clear must redraw only its target');
  R.setPreviewSkip(stage,['bottom']); check(!painted(stage,'swimsuit'),'Bottom-only skip revealed swimsuit');
  R.forget(stage); R.render(stage); check(dressed(stage),'Forget retained preview on a reused container');

  // Intercept writes, including no-op setters, while rendering attached and detached thumbnails.
  const originals={}; let setterCalls=0, notifications=0;
  for (const name of Object.keys(G).filter(name => /^(set|change|spend|reset|restore)/.test(name))) {
    originals[name]=G[name]; G[name]=(...args) => { setterCalls++; return originals[name](...args); };
  }
  const unsubscribe=G.onChange(() => notifications++);
  const saved=JSON.stringify({...localStorage}), state=JSON.stringify(G.get()), writes=storageWrites;
  const size=registry.size, fullSVG=stage.firstElementChild, host=document.createElement('div');
  host.style.display='none'; document.body.append(host); let thumbnails=0;
  for (const friend of friends) for (const [slot,items] of Object.entries(C)) for (const [id,item] of Object.entries(items)) {
    const el=document.createElement('div'), svg=R.renderItemPreview(el,slot,id,{characterId:friend});
    check(svg?.childElementCount > 0 && svg.matches('svg.wardrobe-item-preview'),'Empty thumbnail: '+friend+'/'+id);
    check(!svg.matches('.character') && !svg.querySelector('.character-root,[class*="character-anim-"]'),'Animated thumbnail: '+id);
    const p=CHARACTERS[friend], colors={SKIN:p.skin,SKINSHADE:p.skinShade,FACE:p.face,
      HAIRMAIN:p.hairMain,HAIRSHADE:p.hairShade,BLUSHOP:p.blushOpacity??0.8};
    const expected=document.createElementNS('http://www.w3.org/2000/svg','svg');
    expected.innerHTML=((item.back||'')+(item.front||'')).replace(/__([A-Z]+)__/g,(_,token) => colors[token]);
    check(svg.innerHTML===expected.innerHTML,'Catalog silhouette/palette mismatch: '+friend+'/'+id);
    host.append(el); thumbnails++;
  }
  const scratch=document.createElement('div');
  for (const id of [null,undefined,'']) check(!!R.renderItemPreview(scratch,'extra',id),'Missing None indicator');
  for (const args of [[null,'top','top1'],[{},'hair','hair1'],[scratch,'bad','top1'],[scratch,'top','constructor']]) {
    check(R.renderItemPreview(...args)===null,'Invalid thumbnail input must safely return null');
  }
  check(!setterCalls && !notifications && storageWrites===writes,'Thumbnail generation wrote state/storage');
  check(JSON.stringify({...localStorage})===saved && JSON.stringify(G.get())===state,'Thumbnail generation mutated saved data');
  check(registry.size===size && stage.firstElementChild===fullSVG,'Thumbnail registered or changed full-size preview');
  const thumbRefs=[...host.children].map(el => el.firstElementChild);
  for (const [name,fn] of Object.entries(originals)) G[name]=fn;
  unsubscribe(); G.setCharacterId('amara');
  check([...host.children].every((el,i) => el.firstElementChild===thumbRefs[i]),'Thumbnails auto-refreshed on friend change');
  const ids=[...document.querySelectorAll('[id]')].map(el => el.id);
  check(new Set(ids).size===ids.length,'Duplicate SVG/document IDs');
  host.style.display='block';
  for (const svg of host.querySelectorAll('svg')) for (const node of svg.children) {
    const b=node.getBBox(), v=svg.viewBox.baseVal, pad=parseFloat(node.getAttribute('stroke-width')||0)/2;
    const matrix=svg.getCTM().inverse().multiply(node.getCTM());
    for (const x of [b.x-pad,b.x+b.width+pad]) for (const y of [b.y-pad,b.y+b.height+pad]) {
      const p=new DOMPoint(x,y).matrixTransform(matrix);
      check(p.x>=v.x-.01 && p.x<=v.x+v.width+.01 && p.y>=v.y-.01 && p.y<=v.y+v.height+.01,
        'Clipped thumbnail bounds (including stroke/transforms): '+node.outerHTML);
    }
  }
  host.remove(); others.forEach(el => { R.forget(el); el.remove(); });

  // Sample torso fill AND outline: catches hip strips, not merely central waist gaps.
  const covered=(nodes,p) => nodes.some(n => n instanceof SVGGeometryElement &&
    ((n.getAttribute('fill')!=='none' && n.isPointInFill(p)) ||
     (n.hasAttribute('stroke') && n.getAttribute('stroke')!=='none' && n.isPointInStroke(p))));
  const coverage=(label,start) => {
    const torso=layer(stage,'body').querySelector('rect');
    const clothes=[...stage.querySelectorAll('[data-layer="top"] > *, [data-layer="bottom"] > *, [data-layer="swimsuit"] > *')];
    for (let y=start+.25;y<251;y++) for (let x=112.25;x<188;x++) {
      const p=new DOMPoint(x,y);
      if (torso.isPointInFill(p)||torso.isPointInStroke(p)) check(covered(clothes,p),'Exposed waist/hip: '+label+' at '+x+','+y);
    }
  };
  G.setCharacterId('lily'); G.setOutfitSlot('extra',null);
  let topBottomPairs=0, friendSuitPairs=0, detailPairs=0;
  check(C.top.top2.coversBottom===true,'Dress coverage metadata missing');
  for (const top of Object.keys(C.top)) {
    G.setOutfitSlot('top',top);
    for (const bottom of Object.keys(C.bottom)) {
      G.setOutfitSlot('bottom',bottom);
      check(painted(stage,'top') && !painted(stage,'swimsuit') && G.getOutfit().bottom===bottom,
        'Normal outfit changed selection or revealed swimwear: '+top+'/'+bottom);
      check(painted(stage,'bottom')===(top!=='top2'),'Incorrect dress bottom suppression: '+bottom);
      coverage(top+'/'+bottom,220); topBottomPairs++;
    }
  }
  G.setOutfitSlot('top','top2'); G.setOutfitSlot('bottom','bottom7'); G.setOutfitSlot('top','top1');
  check(G.getOutfit().bottom==='bottom7' && painted(stage,'bottom') && !painted(stage,'swimsuit'),
    'Leaving dress failed to restore saved jeans without swimsuit');
  for (const friend of friends) {
    G.setCharacterId(friend);
    for (const suit of Object.keys(C.swimsuit)) {
      G.setOutfitSlot('swimsuit',suit); R.setPreviewSkip(stage,skip);
      check(painted(stage,'swimsuit') && skip.every(name => !painted(stage,name)),'Missing swimsuit-only preview: '+suit);
      coverage(friend+'/'+suit,210); friendSuitPairs++;
    }
  }
  R.setPreviewSkip(stage,null); G.setOutfitSlot('top','top1'); G.setOutfitSlot('bottom','bottom3');
  const shorts=[...layer(stage,'bottom').children];
  for (let y=262;y<=280;y++) for (const center of [138,162]) for (let x=center-8.5;x<=center+8.5;x+=.5) {
    check(covered(shorts,new DOMPoint(x,y)),'Shorts expose leg outline: '+x+','+y);
  }
  // Hit-test actual painted details in SVG coordinates, independent of screenshot pixels.
  for (const [top,y,attr,color] of [['top3',247,'stroke','#e0b420'],['top5',236,'stroke','#a56bd6'],['top7',235,'fill','#7fd4e6']]) {
    G.setOutfitSlot('top',top);
    for (const bottom of Object.keys(C.bottom)) {
      G.setOutfitSlot('bottom',bottom);
      const p=new DOMPoint(150,y).matrixTransform(stage.firstElementChild.getScreenCTM());
      const hit=document.elementFromPoint(p.x,p.y);
      check(hit?.closest('[data-layer]')?.dataset.layer==='top' && hit.getAttribute(attr)===color,
        'Occluded sweater hem/rainbow stripe/hoodie pocket: '+top+'/'+bottom); detailPairs++;
    }
  }
  G.setOutfitSlot('extra','extra4'); R.setPreviewSkip(stage,skip);
  const order=[...stage.querySelectorAll('[data-layer]')].map(el => el.dataset.layer);
  check(painted(stage,'extra-back') && painted(stage,'extra-front') &&
    order.indexOf('extra-back')<order.indexOf('body') && order.indexOf('extra-front')>order.indexOf('swimsuit'),
    'Backpack must be behind body with straps over swimsuit');
  return {status:'passed',thumbnails,topBottomPairs,friendSuitPairs,detailPairs};
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://localhost:8123", help="Running game server URL")
    parser.add_argument("--output", default="/tmp/kilo/wardrobe-improvements", help="JSON evidence directory")
    args = parser.parse_args()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        try:
            context = browser.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
            try:
                page = context.new_page()
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                page.on("response", lambda response: errors.append(f"HTTP {response.status}: {response.url}")
                        if response.status >= 400 else None)
                page.add_init_script(INSTRUMENT)
                url = args.url.rstrip("/") + "/__character_svg_test__"
                page.route(url, lambda route: route.fulfill(status=200, content_type="text/html", body=HTML))
                page.goto(url, wait_until="networkidle")
                report = page.evaluate(CONTRACTS)
                assert not errors, errors
                output = Path(args.output)
                output.mkdir(parents=True, exist_ok=True)
                (output / "svg-durable-results.json").write_text(json.dumps(report, indent=2) + "\n")
                print("PASS: SVG purity, isolation, bounds, coverage, details, backpack; " + json.dumps(report))
            finally:
                context.close()
        finally:
            browser.close()


if __name__ == "__main__":
    main()
