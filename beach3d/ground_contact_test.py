"""Native loaded-skin contact audit. Run with the game served on localhost:8123.

Requires Python Playwright (no game dependency). --baseline records without
contact assertions; --shots captures comparable game-camera/diagnostic frames.
All artifacts go outside the repository.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from playwright.sync_api import sync_playwright


def expose(route):
    response = route.fetch()
    body = response.text().replace(
        "world = createWorld(hostEl);",
        "world = createWorld(hostEl); window.__qaWorld = world;",
    ).replace("boat.attach(world, character,", "window.__qaChar = character; boat.attach(world, character,")
    route.fulfill(response=response, body=body)


def enter(page):
    def loaded_model(route):
        response = route.fetch()
        body = response.body()
        # Fingerprint the bytes actually delivered to the character's loader.
        page.ground_asset = {"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)}
        route.fulfill(response=response, body=body)

    page.route("**/beach3d/assets/lily4_full.glb", loaded_model)
    page.route("**/beach3d/beach3d.js", expose)
    page.goto("http://localhost:8123", wait_until="networkidle")
    page.click("#welcome-start")
    page.click('.nav-button[data-screen="map"]')
    page.click('.place[data-place-id="beach"]')
    if page.locator("#beach-scene").is_hidden():
        page.click("#beach-play-button")
    page.wait_for_function("window.__beach3d?.state()?.boat?.ready && __beach3d.state().surf?.ready")
    assert page.evaluate("__beach3d.waitReady()")
    page.wait_for_timeout(1200)


INSTALL = """async () => {
    const T = await import('/lib/three/three.module.js');
    const W = await import('/beach3d/world.js');
    const c = __qaChar, parts = [], v = new T.Vector3();
    c.root.traverse(m => {
        if (!m.isSkinnedMesh) return;
        const a = m.geometry.attributes, indices = {Left: [], Right: []};
        for (let i = 0; i < a.position.count; i++) {
            for (const side of Object.keys(indices)) {
                let w = 0;
                for (let j = 0; j < 4; j++) {
                    const name = m.skeleton.bones[a.skinIndex.getComponent(i, j)].name;
                    if (name.includes(side + 'Foot') || name.includes(side + 'Toe'))
                        w += a.skinWeight.getComponent(i, j);
                }
                // Independently scan foot skin INCLUDING mixed ankle weights,
                // not just the foot-dominant runtime candidates/support cache.
                if (w > .05) indices[side].push(i);
            }
        }
        if (indices.Left.length || indices.Right.length) parts.push({m, indices});
    });
    const update = c.update;
    c.update = () => {}; // deterministic native substeps; renderer remains live
    let clock = 0;
    window.groundQA = {
        c, W,
        step(dt = 1/60) {clock += dt; update(dt, clock);},
        restore() {c.update = update;},
        sample() {
            c.root.updateMatrixWorld(true);
            const feet = {Left: Infinity, Right: Infinity};
            for (const {m, indices} of parts) {
                for (const side of Object.keys(feet)) for (const i of indices[side]) {
                    m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
                    feet[side] = Math.min(feet[side], v.y - W.sandY(v.x, v.z));
                }
            }
            c.root.getObjectByName('mixamorigHead').getWorldPosition(v);
            return {...feet, support: Math.min(feet.Left, feet.Right),
                head: v.y - W.sandY(c.loco.x, c.loco.z), root: c.getRootY(),
                x: c.loco.x, z: c.loco.z, yaw: c.loco.yaw,
                action: c.actionInfo()};
        },
        setup(x, z, yaw) {
            c.reset(); c.teleport(x, z);
            c.loco.yaw = c.loco.yawTarget = yaw;
            for (let i = 0; i < 90; i++) this.step();
        },
        walk(x, z, yaw) {
            this.setup(x, z, yaw);
            c.setTarget(x + Math.sin(yaw)*5, z + Math.cos(yaw)*5);
            for (let i = 0; i < 60; i++) this.step();
        }
    };
    return parts.map(({m, indices}) => ({mesh: m.name, left: indices.Left.length, right: indices.Right.length}));
}"""


AUDIT = """() => {
    const q = groundQA, c = q.c, rows = {};
    for (const [name, x, z, yaw] of [
        ['flat-right', -2, 2.6, Math.PI/2], ['flat-left', 2, 2.6, -Math.PI/2],
        ['slope-front', 0, 1.4, 0], ['slope-back', 0, 3, Math.PI],
        ['wade-right', -2, q.W.shorelineZ(-2), Math.PI/2],
        ['wade-left', 2, q.W.shorelineZ(2), -Math.PI/2]
    ]) {
        q.walk(x, z, yaw);
        // Freeze position/heading, sample the complete shipped Walk duration.
        const duration = window.groundWalkDuration;
        rows[name] = [];
        for (let i = 0; i <= 124; i++) {
            c.probePose(i / 124 * duration); q.step(0);
            rows[name].push(q.sample());
        }
    }
    q.setup(-2, 2.6, Math.PI/2);
    rows['start-turn-stop'] = [];
    c.setTarget(5, 2.6);
    for (let i = 0; i < 240; i++) {
        if (i === 70) c.setTarget(-5, 3.2);
        if (i === 140) c.clearTarget();
        q.step(); rows['start-turn-stop'].push(q.sample());
    }
    q.setup(-2, 2.6, Math.PI/2);
    rows['interrupted-fades'] = [];
    for (let i = 0; i < 120; i++) {
        if (i % 12 === 0) c.setTarget(5, 2.6);
        if (i % 12 === 6) c.clearTarget();
        q.step(); rows['interrupted-fades'].push(q.sample());
    }
    q.setup(0, 1.2, Math.PI);
    c.setTarget(0, -1);
    rows['shore-out-back'] = [];
    for (let i = 0; i < 360; i++) {
        if (i === 160) c.setTarget(0, 2);
        q.step(); rows['shore-out-back'].push(q.sample());
    }
    rows['shore-wade'] = rows['shore-out-back'].filter(s => s.action.stance === 'wade');
    const returning = rows['shore-out-back'].findIndex((s, i, a) => i &&
        a[i-1].action.stance === 'swim' && s.action.stance === 'wade');
    rows['shore-exit-after-fade'] = rows['shore-out-back'].slice(returning + 18);
    rows['shore-return-settled'] = rows['shore-out-back'].slice(-60);
    return rows;
}"""


def summary(rows):
    out = {}
    for name, samples in rows.items():
        gaps = [s["support"] for s in samples]
        heads = [s["head"] for s in samples]
        swings = [max(s["Left"], s["Right"]) for s in samples]
        out[name] = dict(n=len(samples), min=min(gaps), max=max(gaps),
                         penetration=max(0, -min(gaps)), hover5cm=sum(g > .05 for g in gaps),
                         headRange=max(heads)-min(heads),
                         headStep=max(abs(a-b) for a, b in zip(heads, heads[1:])),
                         swingMax=max(swings), leftSupport=sum(s["Left"]<s["Right"] for s in samples))
    return out


def capture(page, out, label):
    page.evaluate("groundQA.walk(-3.5,2.6,Math.PI/2)")
    page.wait_for_timeout(500)
    page.screenshot(path=str(out / f"ground-{label}-game.png"))
    for view in ("side", "front"):
        page.evaluate("""view => {
            __qaWorld.updateCamera = () => {
                const {x,z} = __qaChar.loco;
                __qaWorld.camera.position.set(x+(view==='front'?2.7:0), .98, z+(view==='side'?2.7:0));
                __qaWorld.camera.lookAt(x, .84, z);
            };
        }""", view)
        for i, phase in enumerate((.05, .28, .53, .78)):
            page.evaluate("t => {__qaChar.probePose(t);groundQA.step(0)}", phase)
            page.wait_for_timeout(80)
            page.screenshot(path=str(out / f"ground-{label}-{view}-{i}.png"))
    page.evaluate("__qaChar.clearTarget(); for(let i=0;i<60;i++)groundQA.step()")
    page.wait_for_timeout(80)
    page.screenshot(path=str(out / f"ground-{label}-idle.png"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", action="store_true")
    parser.add_argument("--shots", action="store_true")
    parser.add_argument("--label")
    parser.add_argument("--reference", help="Serve character3d.js from this git ref, without touching the worktree")
    args = parser.parse_args()
    label = args.label or ("before" if args.baseline else "after")
    out = Path("/tmp/kilo/lily-improvements")
    out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1000, "height": 760})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        if args.reference:
            source = subprocess.check_output(["git", "show", f"{args.reference}:beach3d/character3d.js"], text=True)
            page.route("**/beach3d/character3d.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=source))
        enter(page)
        # Read clip duration from this load, never an archived animation audit.
        duration = page.evaluate("""async()=>{
            const {GLTFLoader}=await import('/lib/three/addons/loaders/GLTFLoader.js');
            const gltf=await new GLTFLoader().loadAsync('/beach3d/assets/lily4_full.glb');
            window.groundWalkDuration = gltf.animations.find(c=>c.name==='Walk').duration;
            gltf.scene.traverse(m=>{if(m.isMesh){m.geometry.dispose();m.material.dispose();m.material.map?.dispose();}});
            return window.groundWalkDuration;
        }""")
        parts = page.evaluate(INSTALL)
        rows = page.evaluate(AUDIT)
        result = {"label": label, "asset": page.ground_asset, "duration": duration,
                  "parts": parts, "summary": summary(rows), "rows": rows}
        (out / f"ground-{label}.json").write_text(json.dumps(result, indent=2))
        print(json.dumps({k: v for k, v in result.items() if k != "rows"}), flush=True)
        if args.shots:
            capture(page, out, label)
        assert not errors, errors
        if not args.baseline:
            for name, s in result["summary"].items():
                if name in ("shore-out-back", "shore-wade"):
                    continue # Swim deliberately has no sand-contact constraint.
                tolerance = -.005 if name == "shore-exit-after-fade" else -.002
                assert s["min"] >= tolerance and s["max"] <= .012, (name, s)
                assert s["hover5cm"] == 0, (name, s)
                assert s["headRange"] <= .10, (name, s)
        browser.close()


if __name__ == "__main__":
    main()
