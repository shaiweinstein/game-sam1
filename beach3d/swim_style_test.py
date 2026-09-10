"""Bounded swim preference/animation regression; serve localhost:8123.

Uses the existing Python Playwright environment. --reference accepts an
approved full GLB for exact mesh/track preservation; otherwise compares the
eight original clips, rig and embedded images against git HEAD.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess

from playwright.sync_api import sync_playwright
from ground_contact_test import enter

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL = {'Walk', 'Idle', 'Swim', 'Sit', 'Paddle', 'SurfRide', 'Cheer', 'Greet'}


def asset_data(raw):
    n = struct.unpack_from('<I', raw, 12)[0]
    doc, binary = json.loads(raw[20:20+n]), raw[28+n:]

    def view(i):
        v = doc['bufferViews'][i]
        return binary[v.get('byteOffset', 0):v.get('byteOffset', 0)+v['byteLength']]

    def accessor(i):
        a = doc['accessors'][i]; v = doc['bufferViews'][a['bufferView']]
        width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[a['type']]
        size = {5126: 4, 5125: 4, 5123: 2, 5121: 1}[a['componentType']] * width
        data = view(a['bufferView']); offset = a.get('byteOffset', 0)
        return b''.join(data[offset+j*v.get('byteStride', size):offset+j*v.get('byteStride', size)+size]
                        for j in range(a['count']))

    tracks = {a['name']: {(doc['nodes'][c['target']['node']]['name'], c['target']['path']):
              tuple(accessor(a['samplers'][c['sampler']][k]) for k in ('input', 'output'))
              for c in a['channels']} for a in doc['animations']}
    joints = doc['skins'][0]['joints']
    parent = {child: node['name'] for node in doc['nodes'] for child in node.get('children', [])}
    rig = [(doc['nodes'][i]['name'], parent.get(i), {k: doc['nodes'][i].get(k) for k in
             ('translation', 'rotation', 'scale', 'matrix')}) for i in joints]
    geometry = {(node['name'], doc['materials'][p['material']]['name']):
                {**{k: accessor(v) for k, v in p['attributes'].items()}, 'indices': accessor(p['indices'])}
                for node in doc['nodes'] if 'mesh' in node for p in doc['meshes'][node['mesh']]['primitives']}
    armature = next(n for n in doc['nodes'] if n.get('name') == 'LilyRig')
    binds = ([([doc['nodes'][i]['name'] for i in s['joints']], accessor(s['inverseBindMatrices'])) for s in doc['skins']],
             {k: armature.get(k) for k in ('translation', 'rotation', 'scale', 'matrix')})
    return tracks, rig, binds, geometry, [view(i['bufferView']) for i in doc['images']]


def check_asset(reference):
    raw = (ROOT/'beach3d/assets/lily4_full.glb').read_bytes()
    before = Path(reference).read_bytes() if reference else subprocess.check_output(
        ['git', 'show', 'HEAD:beach3d/assets/lily4_full.glb'], cwd=ROOT)
    tracks, rig, binds, geo, images = asset_data(raw)
    old, orig_rig, orig_binds, orig_geo, orig_images = asset_data(before)
    assert set(tracks) == ORIGINAL | {'SwimFreestyle'}
    assert all(tracks[n] == old[n] for n in ORIGINAL)
    assert len(rig) == 65 and rig == orig_rig and binds == orig_binds
    assert images == orig_images
    assert tracks['SwimFreestyle'] != tracks['Swim']
    dots = []
    worst_rotation = {'dot': 1}
    for (node, path), (_, values) in tracks['SwimFreestyle'].items():
        if path != 'rotation':
            continue
        qs = list(struct.iter_unpack('<ffff', values))
        assert all(abs(math.sqrt(sum(x*x for x in q))-1)<1e-5 for q in qs), node
        track_dots=[sum(x*y for x, y in zip(a, b)) for a, b in zip(qs, qs[1:])]
        assert min(track_dots, default=1)>0, (node,min(track_dots,default=1))
        if min(track_dots, default=1)<worst_rotation['dot']:
            worst_rotation={'bone':node,'sample':track_dots.index(min(track_dots)), 'dot':min(track_dots)}
        dots.extend(track_dots)
    assert min(dots) > 0, 'Quaternion hemisphere discontinuity'
    assert min(dots) > .95, ('Abrupt rotation step',worst_rotation)
    if reference:
        assert geo == orig_geo, 'Geometry, normals, UVs, skin weights or indices changed'
    return {'originalTrackDiff': dict.fromkeys(sorted(ORIGINAL), 0), 'bones': 65,
            'restsAndBinds': 'exact', 'embeddedImages': 'exact',
            'allGeometry': 'exact' if reference else 'not compared across hairstyle change',
            'minimumAdjacentQuaternionDot': min(dots),
            'largestRotationStep': worst_rotation,
            'bytes': len(raw), 'referenceBytes': len(before), 'deltaBytes': len(raw)-len(before),
            'sha256': hashlib.sha256(raw).hexdigest()}


INSTALL = """async () => {
    const c=__qaChar, update=c.update;
    c.update=()=>{};
    window.swimQA={c, step(n=1){for(let i=0;i<n;i++)update(1/60,0);},
        tick(dt,time){update(dt,time);},
        restore(){c.update=update;},
        setup(style='head-up',sea=true){
            c.reset();GameState.setSwimStyle(style);c.setSwimStyle(style);
            c.teleport(-2,sea?-6:2.6);c.loco.yaw=c.loco.yawTarget=Math.PI/2;
            this.step(60);c.setTarget(5,sea?-6:2.6);this.step(45);
        },
        active(){return Object.entries(c.actionInfo().all).filter(([,a])=>a.active);},
        settled(clip){const a=this.active();return a.length===1 && a[0][0]===clip && a[0][1].w===1;}
    };
}"""

POSES = """async()=>{
    const T=await import('/lib/three/three.module.js'),W=await import('/beach3d/world.js');
    const c=__qaChar,v=new T.Vector3(),points={};
    const targets={nose:[0,.795,.205],mouth:[0,.747,.199],rear:[0,.795,-.205],crown:[0,.9898,0],chin:[0,.6002,0]};
    for(const [name,p] of Object.entries(targets)){
        let best=Infinity;
        c.root.traverse(m=>{
            if(!m.isSkinnedMesh||m.material.name!=='faceTexture')return;
            const a=m.geometry.attributes.position;
            for(let i=0;i<a.count;i++){
                v.fromBufferAttribute(a,i);const d=v.distanceToSquared(new T.Vector3(...p));
                if(d<best){best=d;points[name]={m,i};}
            }
        });
    }
    const sample=t=>{
        c.probePose(t);c.root.updateMatrixWorld(true);const pos={};
        for(const [name,{m,i}] of Object.entries(points))pos[name]=m.getVertexPosition(i,new T.Vector3()).applyMatrix4(m.matrixWorld);
        const f=pos.nose.clone().sub(pos.rear).normalize(),up=pos.crown.clone().sub(pos.chin).normalize();
        up.addScaledVector(f,-up.dot(f)).normalize();
        const bones=[];c.root.traverse(n=>{if(n.isBone)bones.push(...n.matrixWorld.elements)});
        const y=n=>c.root.getObjectByName('mixamorig'+n).getWorldPosition(v).y;
        return {faceY:f.y,crownY:up.y,mouth:pos.mouth.y-W.waterSurfaceY(pos.mouth.x,pos.mouth.z,0),bones,
            left:y('LeftForeArm')-y('LeftArm'),right:y('RightForeArm')-y('RightArm'),kick:y('LeftFoot')-y('RightFoot')};
    };
    const result={};
    for(const style of ['head-up','freestyle']){
        swimQA.setup(style);const rows=Array.from({length:137},(_,i)=>sample((i+1)/30-1e-7));
        const a=rows[0].bones,b=rows.at(-1).bones;
        result[style]={seam:Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),
            mouth:[Math.min(...rows.map(r=>r.mouth)),Math.max(...rows.map(r=>r.mouth))],
            immersed:rows.filter(r=>r.mouth<0).length,breathMouth:rows[79].mouth,
            alternatingRecovery:rows.some(r=>r.left>.035&&r.right<-.035)&&rows.some(r=>r.right>.035&&r.left<-.035),
            flutter:Math.min(...rows.map(r=>r.kick))<-.025&&Math.max(...rows.map(r=>r.kick))>.025,
            faceY:[Math.min(...rows.map(r=>r.faceY)),Math.max(...rows.map(r=>r.faceY))],
            crownY:Math.min(...rows.map(r=>r.crownY))};
    }
    c.clearTarget();swimQA.step(90);result.floatMouth=sample(1.13).mouth;
    return result;
}"""


DEPTH_GUARD = """async()=>{
    const T=await import('/lib/three/three.module.js'),W=await import('/beach3d/world.js');
    const q=swimQA,c=q.c,v=new T.Vector3(),feet=[];
    c.root.traverse(m=>{
        if(!m.isSkinnedMesh)return;
        const a=m.geometry.attributes;
        for(let i=0;i<a.position.count;i++){
            let weight=0;
            for(let j=0;j<4;j++)if(/(Foot|Toe)/.test(m.skeleton.bones[a.skinIndex.getComponent(i,j)].name))weight+=a.skinWeight.getComponent(i,j);
            if(weight>.05)feet.push({m,i});
        }
    });
    const skin=()=>{
        c.root.updateMatrixWorld(true);let gap=Infinity,minY=Infinity,radius=0;
        for(const {m,i}of feet){
            m.getVertexPosition(i,v).applyMatrix4(m.matrixWorld);
            gap=Math.min(gap,v.y-W.sandY(v.x,v.z));minY=Math.min(minY,v.y-c.getRootY());
            radius=Math.max(radius,Math.hypot(v.x-c.loco.x,v.z-c.loco.z));
        }return {gap,minY,radius};
    };
    window.depthQA={
        profile(){
            const result={vertices:feet.length};
            for(const style of ['head-up','freestyle']){
                q.setup(style);let minY=Infinity,radius=0;
                for(let i=0;i<=272;i++){
                    c.probePose((1+i/2)/30-1e-7);const s=skin();
                    minY=Math.min(minY,s.minY);radius=Math.max(radius,s.radius);
                }result[style]={minY,radius,requiredDepth:(style==='freestyle'?.09:.065)-minY};
            }
            let minY=Infinity,radius=0;
            for(const from of ['head-up','freestyle'])for(let phase=0;phase<32;phase++){
                q.setup(from);c.probePose((1+136*phase/32)/30);
                c.setSwimStyle(from==='head-up'?'freestyle':'head-up');
                for(let i=0;i<20;i++){q.step();const s=skin();minY=Math.min(minY,s.minY);radius=Math.max(radius,s.radius);}
            }
            result.blend={minY,radius,requiredDepth:.09-minY};return result;
        },
        path({x,deep=false,rm=false,style='head-up',seed=0}){
            // Settle on land before resetting the mixer clock; do not carry
            // an earlier fixture's scheduled fades into the baseline path.
            c.teleport(W.WORLD.rest.x,W.WORLD.rest.z);
            for(let i=0;i<30;i++)q.tick(1/60,seed);
            c.reset();GameState.setSwimStyle(style);c.setSwimStyle(style);
            const shore=W.shorelineZ(x),start=shore+.7,dest=deep?-7:-1;
            c.teleport(x,start);c.loco.yaw=c.loco.yawTarget=Math.PI;
            let clock=seed;
            const tick=()=>{if(!rm)clock+=1/60;q.tick(1/60,clock);};
            for(let i=0;i<90;i++)tick();c.setTarget(x,dest);
            const turn=deep?450:160,steps=deep?1000:360,transitions=[],anchors=[];
            let entry=Infinity,exit=Infinity,freeMin=Infinity,shallow=Infinity,last=null,maxWeightError=0,deepFrames=0;
            for(let i=0;i<steps;i++){
                if(i===turn)c.setTarget(x,start+.8);
                tick();const a=c.actionInfo();anchors.push([c.loco.x,c.loco.z]);
                const free=a.all.SwimFreestyle.active&&a.all.SwimFreestyle.w>0;
                if(a.clip!==last){transitions.push({frame:i,clip:a.clip,z:c.loco.z,guard:a.swimDepthGuard});last=a.clip;}
                if(free||i%2===0){
                    const s=skin();
                    if(i<turn)entry=Math.min(entry,s.gap);else exit=Math.min(exit,s.gap);
                    if(W.WORLD.water.y-W.sandY(c.loco.x,c.loco.z)<.4)shallow=Math.min(shallow,s.gap);
                    if(free)freeMin=Math.min(freeMin,s.gap);
                }
                if(a.clip==='SwimFreestyle')deepFrames++;
                const weights=Object.values(a.all).filter(v=>v.active);
                maxWeightError=Math.max(maxWeightError,Math.abs(weights.reduce((n,a)=>n+a.w,0)-1));
                if(!weights.every(a=>Number.isFinite(a.w)&&a.w>=0&&a.w<=1))throw Error('invalid fade weight');
            }
            return {entry,exit,shallow,freeMin:freeMin===Infinity?null:freeMin,transitions,deepFrames,maxWeightError,anchors,
                preference:GameState.getSwimStyle()};
        },
        preferenceHistory(){
            const rows=[];
            const at=depth=>{
                let lo=-8,hi=-2;
                for(let i=0;i<40;i++){
                    const z=(lo+hi)/2,d=W.WORLD.water.y-.061-W.sandY(0,z+.41);
                    if(d>depth)lo=z;else hi=z;
                }
                c.teleport(0,(lo+hi)/2);c.setStance('float');
            };
            const sample=(name,ready,clip,depth=null)=>rows.push({name,expected:{ready,clip,depth},
                status:c.swimStatus(),action:c.actionInfo(),anchor:c.getAnchor()});
            q.setup('freestyle');at(.389);
            for(const style of ['head-up','freestyle','head-up','freestyle','freestyle']){
                c.setSwimStyle(style);sample(style+' selected at rest',true,'Swim',.389);
                c.setStance('swim');sample(style+' swim',true,style==='freestyle'?'SwimFreestyle':'Swim',.389);
                c.setStance('float');sample(style+' release',true,'Swim',.389);
            }
            // Losing physical clearance while Head-up is selected must also
            // lose readiness. A new selection in the band cannot reacquire it.
            c.setSwimStyle('head-up');at(.3801);sample('above exit',true,'Swim',.3801);
            at(.3799);sample('below exit in Head-up',false,'Swim',.3799);
            at(.389);c.setSwimStyle('freestyle');c.setStance('swim');
            sample('unsafe to band',false,'Swim',.389);
            c.setSwimStyle('head-up');at(.4049);sample('below enter',false,'Swim',.4049);
            at(.4051);sample('deep Head-up reacquires readiness',true,'Swim',.4051);
            at(.389);c.setSwimStyle('freestyle');c.setStance('swim');
            sample('Head-up deep to band to Freestyle',true,'SwimFreestyle',.389);
            c.setSwimStyle('head-up');c.loco.vz=1.32;q.tick(1/60,0);
            sample('shoreward lookahead while Head-up',false,'Swim');
            at(.389);c.setSwimStyle('freestyle');c.setStance('swim');
            sample('lookahead exit to band',false,'Swim',.389);
            for(const state of ['stand','ride','surf','reset']){
                at(.406);
                if(state==='reset')c.reset();else c.setStance(state);
                sample(state+' clears readiness',false,c.actionInfo().clip);
                at(.389);c.setStance('swim');sample(state+' fresh band',false,'Swim',.389);
            }
            return rows;
        },
        threshold({latched,rm}){
            q.setup('freestyle');
            const limits=c.actionInfo().swimDepthGuard,mid=(limits.enter+limits.exit)/2;
            let lo=-8,hi=-2;
            for(let i=0;i<40;i++){
                const z=(lo+hi)/2,depth=W.WORLD.water.y-.061-W.sandY(0,z+.41);
                if(depth>mid)lo=z;else hi=z;
            }
            // Seed the two valid histories at the same depth inside the band.
            // Thereafter motion, turning, water and clip resolution are native.
            if(!latched)c.reset();
            c.loco.x=0;c.loco.z=(lo+hi)/2;c.loco.yaw=c.loco.yawTarget=Math.PI/2;
            c.loco.vx=c.loco.vz=0;c.setTarget(2,c.loco.z);
            let clock=1.3,minDepth=Infinity,maxDepth=-Infinity,minWater=Infinity,maxWater=-Infinity,gap=Infinity;
            const clips=new Set();
            for(let i=0;i<720;i++){
                if(c.loco.x>.85)c.setTarget(-2,c.loco.z);
                if(c.loco.x<-.85)c.setTarget(2,c.loco.z);
                if(!rm)clock+=1/60;q.tick(1/60,clock);
                const a=c.actionInfo(),d=a.swimDepthGuard.depth;
                clips.add(a.clip);minDepth=Math.min(minDepth,d);maxDepth=Math.max(maxDepth,d);
                const water=W.waterSurfaceY(c.loco.x,c.loco.z,clock);
                minWater=Math.min(minWater,water);maxWater=Math.max(maxWater,water);
                if(i%3===0)gap=Math.min(gap,skin().gap);
            }
            return {latched,rm,clips:[...clips],minDepth,maxDepth,minWater,maxWater,gap,limits};
        }
    };
}"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference')
    parser.add_argument('--out', default='/tmp/kilo/swim-style')
    args = parser.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    results = {'asset': check_asset(args.reference)}
    errors, external, assets = [], [], []

    def check(name, ok, detail=None):
        results[name] = {'pass': bool(ok), 'detail': detail}
        print(('PASS ' if ok else 'FAIL ')+name, flush=True)
        assert ok, (name, detail)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            page = browser.new_page(viewport={'width':1280, 'height':800})
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
            page.on('request', lambda r: external.append(r.url) if r.url.startswith(('http:', 'https:'))
                    and not r.url.startswith('http://localhost:8123/') else None)
            page.on('request', lambda r: assets.append(r.url) if r.url.endswith('/lily4_full.glb') else None)
            enter(page)
            select = page.get_by_role('combobox', name='Swim Style')
            check('old/default state is head-up', select.input_value() == 'head-up' and
                  page.evaluate('GameState.getSwimStyle()') == 'head-up')
            page.evaluate(INSTALL)
            page.evaluate('swimQA.setup("head-up",false)')
            before = page.evaluate('({a:__beach3d.action(),s:GameState.get(),target:__qaChar.loco.target,anchor:__qaChar.getAnchor()})')
            select.focus(); select.select_option('freestyle')
            after = page.evaluate('({a:__beach3d.action(),s:GameState.get(),target:__qaChar.loco.target,anchor:__qaChar.getAnchor()})')
            check('shore selection preserves Walk, phase, anchor, target, outfit, energy and location',
                  all(before[k] == after[k] for k in ('anchor', 'target')) and
                  all(before['s'][k] == after['s'][k] for k in ('outfit', 'energy', 'location')) and
                  before['a']['clip'] == after['a']['clip'] == 'Walk' and before['a']['time'] == after['a']['time'])
            check('native selector preserves keyboard focus', page.evaluate('document.activeElement.id') == 'beach-swim-style')
            check('selector retains accessible deep-water policy',
                  'deep water' in select.get_attribute('title') and
                  select.get_attribute('aria-description')==select.get_attribute('title'))
            page.evaluate('swimQA.setup();__qaChar.probePose(1.5)')
            before = page.evaluate('({a:__beach3d.action(),anchor:__qaChar.getAnchor(),target:__qaChar.loco.target})')
            select.select_option('freestyle')
            check('same-stance style change resolves immediately without anchor reset', page.evaluate('''b=>{
                const a=__beach3d.action();return a.clip==="SwimFreestyle" && a.time===b.a.time &&
                JSON.stringify(__qaChar.getAnchor())===JSON.stringify(b.anchor) &&
                JSON.stringify(__qaChar.loco.target)===JSON.stringify(b.target);
            }''', before))
            page.evaluate('swimQA.step(30)')
            check('freestyle fade converges', page.evaluate('swimQA.settled("SwimFreestyle")'))
            check('interrupted fades remain normalized and converge; movement continues', page.evaluate('''()=>{
                const q=swimQA,x=q.c.loco.x;let dy=0;
                for(let i=0;i<40;i++){
                    const y=q.c.getRootY();GameState.setSwimStyle(i%2?'freestyle':'head-up');q.step(1);
                    const all=q.active(),sum=all.reduce((n,[,a])=>n+a.w,0);
                    if(!all.every(([,a])=>Number.isFinite(a.w)&&a.w>=0&&a.w<=1)||Math.abs(sum-1)>.003)return false;
                    dy=Math.max(dy,Math.abs(q.c.getRootY()-y));
                }q.step(30);return q.settled('SwimFreestyle') && q.c.loco.x>x && dy<.01;
            }'''))
            page.evaluate('__qaChar.clearTarget();swimQA.step()')
            check('release immediately targets approved head-up float', page.evaluate(
                '__beach3d.action().clip==="Swim" && __beach3d.action().stance==="float" && GameState.getSwimStyle()==="freestyle"'))
            page.evaluate('swimQA.step(90)')
            check('float settles at original slow rate', page.evaluate(
                'swimQA.settled("Swim") && __beach3d.action().timeScale===.25 && __beach3d.action().sink===.065'))
            select.select_option('head-up'); select.select_option('freestyle')
            check('idle float never switches underwater', page.evaluate('__beach3d.action().clip==="Swim"'))
            check('reset during an interrupted style fade retires every contributor',page.evaluate('''()=>{
                swimQA.setup('freestyle');GameState.setSwimStyle('head-up');swimQA.step(3);
                __qaChar.reset();swimQA.step(45);return swimQA.settled('Idle');
            }'''))
            page.emulate_media(reduced_motion='reduce')
            page.wait_for_function('__beach3d.state().rm')
            page.evaluate('swimQA.setup("freestyle")')
            rm = page.evaluate('__beach3d.action()')
            page.evaluate('swimQA.step(30)')
            check('RM freestyle parks at side breath and still translates', rm['timeScale'] == 0 and
                  abs(rm['time']-2.678)<.001 and page.evaluate('__beach3d.action().time') == rm['time'] and
                  page.evaluate('__qaChar.loco.x') > -1, {'before':rm,'after':page.evaluate('__beach3d.action()'),'x':page.evaluate('__qaChar.loco.x')})
            page.evaluate('__qaChar.clearTarget();swimQA.step(90)')
            check('RM release is visible approved float', page.evaluate('__beach3d.action().clip==="Swim" && __beach3d.action().time===1.13'))
            page.emulate_media(reduced_motion='no-preference')
            page.wait_for_function('!__beach3d.state().rm')
            page.evaluate('swimQA.setup("freestyle");swimQA.step(30)')
            matrix = []
            for hair in range(1, 7):
                for style in ('head-up', 'freestyle'):
                    select.select_option(style)
                    page.evaluate('([id,s])=>{GameState.setOutfitSlot("hair",id);swimQA.setup(s)}', [f'hair{hair}',style])
                    row = page.evaluate('({hair:__beach3d.appearance().hair,style:GameState.getSwimStyle(),y:__qaChar.getRootY(),clip:__beach3d.action().clip})')
                    assert row['clip'] == ('Swim' if style == 'head-up' else 'SwimFreestyle')
                    matrix.append(row)
            check('six hairs x two styles, identical per-style root height', all(
                max(r['y'] for r in matrix if r['style']==s)-min(r['y'] for r in matrix if r['style']==s)<1e-7
                for s in ('head-up', 'freestyle')), matrix)
            poses=page.evaluate(POSES)
            check('both evaluated world seams remain below 1e-4', all(poses[s]['seam']<1e-4 for s in ('head-up','freestyle')),poses)
            check('original face/crown orientation and clear float preserved',
                  max(abs(y-math.sin(math.radians(25))) for y in poses['head-up']['faceY'])<.001 and
                  poses['head-up']['crownY']>.90 and poses['head-up']['mouth'][0]>.02 and poses['floatMouth']>.02)
            check('freestyle mostly immersed, deliberate face-visible breath',
                  poses['freestyle']['immersed']>90 and poses['freestyle']['breathMouth']>.06 and
                  poses['freestyle']['faceY'][0]<-.95 and poses['freestyle']['faceY'][1]>.24)
            check('freestyle alternates overarm recovery and flutter kick',
                  poses['freestyle']['alternatingRecovery'] and poses['freestyle']['flutter'])
            page.evaluate(DEPTH_GUARD)
            profile=page.evaluate('depthQA.profile()')
            limits=page.evaluate('__beach3d.action().swimDepthGuard')
            check('measured kick/blend envelope fits guarded depth and reach',
                  profile['freestyle']['requiredDepth']<.195 and profile['blend']['requiredDepth']<limits['exit']-.01 and
                  max(profile[s]['radius'] for s in ('head-up','freestyle','blend'))<.40,profile)
            paths=[]
            unchanged=page.evaluate('({energy:GameState.getEnergy(),location:GameState.getLocation(),zoom:__qaWorld.zoomTarget()})')
            for rm in (False,True):
                page.emulate_media(reduced_motion='reduce' if rm else 'no-preference')
                page.wait_for_function('v=>__beach3d.state().rm===v',arg=rm)
                for x,deep,seed in ((-2,False,0),(2,False,4.2),(-2,True,1.3),(2,True,5.6)):
                    args={'x':x,'deep':deep,'rm':rm,'seed':seed}
                    base=page.evaluate('a=>depthQA.path(a)',args)
                    guarded=page.evaluate('a=>depthQA.path({...a,style:"freestyle"})',args)
                    delta=max(math.hypot(a[0]-b[0],a[1]-b[1]) for a,b in zip(base.pop('anchors'),guarded.pop('anchors')))
                    detail={**args,'headUp':base,'guarded':guarded,'anchorDelta':delta};paths.append(detail)
                    check(f'guarded entry/exit x={x} deep={deep} RM={rm} no worse than Head-up',
                          guarded['entry']>=base['entry']-.001 and guarded['exit']>=base['exit']-.001 and
                          guarded['shallow']>=base['shallow']-.001 and delta<1e-10 and
                          guarded['preference']=='freestyle' and guarded['maxWeightError']<.003 and base['maxWeightError']<.003,detail)
                    check(f'clear feet through effective freestyle/fades x={x} deep={deep} RM={rm}',
                          (guarded['deepFrames']>60 and guarded['freeMin']>=0) if deep else guarded['deepFrames']==0)
                for latched in (False,True):
                    band=page.evaluate('a=>depthQA.threshold(a)',{'latched':latched,'rm':rm})
                    check(f'threshold travel/waves do not flap latched={latched} RM={rm}',
                          band['clips']==['SwimFreestyle' if latched else 'Swim'] and band['gap']>=0 and
                          band['minDepth']>band['limits']['exit'] and band['maxDepth']<band['limits']['enter'],band)
                    if latched:
                        restart=page.evaluate('''()=>{
                            const q=swimQA,c=q.c;
                            c.clearTarget();q.step(60);
                            const rest=c.actionInfo();
                            c.setSwimStyle('freestyle');
                            c.setTarget(c.loco.x+.4,c.loco.z);q.step();
                            return {rest,restart:c.actionInfo()};
                        }''')
                        check(f'float/reselect/restart retains in-band readiness RM={rm}',
                            restart['rest']['stance']=='float' and restart['rest']['clip']=='Swim'
                            and .380<restart['rest']['swimDepthGuard']['depth']<.405
                            and restart['restart']['clip']=='SwimFreestyle',restart)
                history=page.evaluate('depthQA.preferenceHistory()')
                check(f'physical depth history survives style detours and clears only on unsafe/land/ride/reset RM={rm}',
                    all(r['status']['ready']==r['expected']['ready'] and r['action']['clip']==r['expected']['clip']
                        and (r['expected']['depth'] is None or abs(r['action']['swimDepthGuard']['depth']-r['expected']['depth'])<1e-9)
                        and (r['action']['clip']!='Swim' or r['action']['sink']==.065)
                        for r in history)
                    and next(r for r in history if r['name']=='shoreward lookahead while Head-up')['action']['swimDepthGuard']['depth']<.380
                    and all(r['action']['swimDepthGuard']['depth'] is None for r in history if r['name'].endswith('clears readiness')),
                    history)
            (out/'guard-paths.json').write_text(json.dumps(paths,indent=2))
            check('guard preserves energy/location/manual zoom',unchanged==page.evaluate(
                '({energy:GameState.getEnergy(),location:GameState.getLocation(),zoom:__qaWorld.zoomTarget()})'))
            check('selected style does not affect camera at the same anchor',page.evaluate('''()=>{
                const w=__qaWorld,c=__qaChar,rows=[];
                for(const style of ['head-up','freestyle']){
                    swimQA.setup(style);
                    for(let i=0;i<180;i++)w.updateCamera(1/60,c.getAnchor(),c.swimStatus().mode);
                    rows.push([...w.camera.position.toArray(),...w.camera.quaternion.toArray(),w.zoomTarget()]);
                }
                return w.camMode()==='swimmer' && rows[0].every((v,i)=>Math.abs(v-rows[1][i])<1e-9);
            }'''))
            page.emulate_media(reduced_motion='no-preference');page.wait_for_function('!__beach3d.state().rm')
            check('shallow rapid toggles stay Head-up and release to approved float',page.evaluate('''()=>{
                swimQA.setup('freestyle');__qaChar.teleport(-2,-1);swimQA.step(60);
                __qaChar.setTarget(5,-1);swimQA.step(30);
                for(let i=0;i<20;i++){
                    GameState.setSwimStyle(i%2?'freestyle':'head-up');swimQA.step();
                    const a=__qaChar.actionInfo();if(a.clip!=='Swim'||a.all.SwimFreestyle.active)return false;
                }
                __qaChar.clearTarget();swimQA.step(30);
                return __qaChar.actionInfo().stance==='float'&&swimQA.settled('Swim')&&GameState.getSwimStyle()==='freestyle';
            }'''))
            page.evaluate('swimQA.setup("freestyle")')
            page.wait_for_timeout(300)
            warmed = page.evaluate('__beach3d.performance()')
            page.evaluate('for(let i=0;i<100;i++){GameState.setSwimStyle(i%2?"freestyle":"head-up");swimQA.step()};swimQA.restore()')
            page.wait_for_timeout(300)
            check('style switches allocate no assets/geometries/textures', len(assets)==1 and all(
                page.evaluate('__beach3d.performance()')[k] == warmed[k] for k in ('geometries', 'textures')),
                {'before':warmed,'after':page.evaluate('__beach3d.performance()'),'characterRequests':len(assets)})
            for width,height in ((1280,800),(420,720)):
                page.set_viewport_size({'width':width,'height':height})
                select.select_option('head-up'); a=page.locator('#beach-stage').bounding_box()
                select.select_option('freestyle'); b=page.locator('#beach-stage').bounding_box()
                check(f'{width}px stable layout and touch target', a==b and select.bounding_box()['height']>=44)
                page.screenshot(path=str(out/f'controls-{width}.png'))
            page.get_by_role('button',name='Change swimsuit').click()
            page.click('#wardrobe-tab-hair');page.locator('.wardrobe-item[data-item-id="hair4"]').click()
            page.click('#wardrobe-tab-swimsuit');page.locator('.wardrobe-item[data-item-id="suit5"]').click()
            page.get_by_role('button',name='Back to Beach').click()
            page.wait_for_function('__beach3d.appearance()?.hair==="hair4" && __beach3d.appearance()?.suit==="suit5"')
            check('real wardrobe return retains preference', select.input_value()=='freestyle')
            page.reload(wait_until='networkidle');page.click('#welcome-continue')
            page.click('.nav-button[data-screen="map"]');page.click('.place[data-place-id="beach"]')
            if page.locator('#beach-scene').is_hidden():page.click('#beach-play-button')
            page.wait_for_function('__beach3d.appearance()?.hair==="hair4"')
            check('reload Continue retains hair, suit and style', select.input_value()=='freestyle' and
                  page.evaluate('__beach3d.appearance().suit')=='suit5')
            for value in (None,'bad',17,{'style':'freestyle'}):
                page.evaluate('v=>{const s=JSON.parse(localStorage.getItem("lily-game-save-v1"));s.swimStyle=v;localStorage.setItem("lily-game-save-v1",JSON.stringify(s));}',value)
                page.reload(wait_until='networkidle')
                check('invalid saved preference defaults: '+str(value),page.evaluate('GameState.getSwimStyle()')=='head-up')
            page.evaluate('''()=>{const s=JSON.parse(localStorage.getItem('lily-game-save-v1'));delete s.swimStyle;
                localStorage.setItem('lily-game-save-v1',JSON.stringify(s));}''')
            page.reload(wait_until='networkidle')
            check('missing saved preference defaults',page.evaluate('GameState.getSwimStyle()')=='head-up')
            check('validated setter and reset notify metadata',page.evaluate('''()=>{
                const events=[],off=GameState.onChange((s,r)=>events.push(r));GameState.setSwimStyle('freestyle');
                GameState.setSwimStyle('bad');GameState.setSwimStyle('freestyle');const kept=GameState.getSwimStyle();
                GameState.reset();off();return kept==='freestyle' && GameState.getSwimStyle()==='head-up' &&
                    JSON.stringify(events)===JSON.stringify(['swimStyle','reset']) && !localStorage.getItem('lily-game-save-v1');
            }'''))
            check('no errors or external requests',not errors and not external,{'errors':errors,'external':external})
        finally:
            browser.close()
            (out/'swim-style-test.json').write_text(json.dumps(results,indent=2))


if __name__ == '__main__':
    main()
