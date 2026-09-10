/* B4: opt-in shoreward swells, Space catch, hold-drag carve, happy roll-off.
   One reusable wave and a fixed foam pool; cached canvas textures. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { toonify, shorelineZ, sandY, waterSurfaceY, WORLD } from "./world.js";

const GLB_URL = new URL("./assets/surfboard.glb", import.meta.url).href;
const SURF = {
  waveSpeed: 1.1, spawnZ: WORLD.box.zMin - 0.8, spawnFirst: 1.8, spawnMin: 2.2, spawnMax: 4.8,
  catchRadius: 1.1, seaGuard: 0.8, shorePad: 0.7, pocket: 0.3,
  carveSpeed: 2, carveFloor: 0.4, carveEase: 0.36, carveStop: 0.03,
  xMin: WORLD.box.xMin, xMax: WORLD.box.xMax, leanEase: 3, tilt: 7*Math.PI/180,
  bob: 0.04, crestHz: 0.45, splashEvery: 1.26, splashLife: 0.8, splashCap: 16,
  rollTime: 0.5, breakTime: 1.2
};
const RIDE_TALKS = ["Great ride! \u{1f3c4}", "Woo! \u{1f30a}", "Again! \u{1f3c4}"];
const clamp = THREE.MathUtils.clamp;
const smooth = t => { t = clamp(t, 0, 1); return t*t*(3-2*t); };
let world = null, character = null, fx = null, say = null, bus = null, st = null;
let root = null, wave = null, face = null, crest = null, wash = null, chip = null;
let foam = [], foamGeometry = null, foamCursor = 0, foamTex = null, crestTex = null;
let generation = 0;
let spaceHeld = false, buttonHeld = false, releaseButtonHold = null;
const waveActivity = {
  id: "surfwave", label: "Catch wave", only3D: true, modes: ["sand"],
  onClick: (_ctx, event) => {
    // Pointer presses already catch on down. Keep native keyboard/AT clicks.
    if (!event?.detail) requestCatch();
  },
  mount: mountCatchButton
};
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WORLD.water.y);
const hit = new THREE.Vector3();

function texture(crestPattern) {
  if (crestPattern ? crestTex : foamTex) return crestPattern ? crestTex : foamTex;
  const c = document.createElement("canvas");
  c.width = 128; c.height = crestPattern ? 64 : 128;
  const g = c.getContext("2d");
  g.strokeStyle = "white"; g.lineWidth = crestPattern ? 7 : 6; g.lineCap = "round";
  if (crestPattern) {
    for (const [x,y,r] of [[0,14,12],[21,23,14],[43,18,9],[68,25,15],
      [91,15,11],[113,21,14],[128,14,12],[34,46,5],[84,49,4]]) {
      g.beginPath(); g.ellipse(x,y,r,r*.65,0,0,Math.PI*2); g.fillStyle="white"; g.fill();
    }
  } else {
    g.beginPath(); g.ellipse(64,64,49,37,0,0,Math.PI*2); g.stroke();
    for (const [x,y,r] of [[26,44,9],[91,38,7],[105,80,8],[51,103,6]]) {
      g.beginPath(); g.arc(x,y,r,0,Math.PI*2); g.fillStyle = "white"; g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (crestPattern) { t.wrapS = THREE.RepeatWrapping; t.repeat.x = 12; crestTex = t; }
  else foamTex = t;
  return t;
}

function sound(name) {
  try { fx?.sound?.(name); } catch (e) { /* cosmetic */ }
}

function registerActivity() {
  window.BeachScene?.registerActivity({ id: "surfcatch", emoji: "\u{1f3c4}",
    label: st?.enabled ? "Stop surfing" : "Start surfing", modes: ["sand"],
    onClick: () => setSurfing(!st?.enabled) });
  if (st?.enabled) window.BeachScene?.registerActivity(waveActivity);
  else window.BeachScene?.unregisterActivity(waveActivity.id, waveActivity);
}

function syncArmed() {
  if (st) st.armed = spaceHeld || buttonHeld;
}

function requestCatch() {
  if (!st?.enabled || document.hidden || active() || bus?.rideActive?.()) return;
  if (!catchWave()) say?.("Swim farther out, then tap Catch wave as a wave reaches you, or keep holding for the next one!");
}

function mountCatchButton(button) {
  const events = new AbortController();
  let pointer = null;
  button.title = "Tap to catch a nearby wave. Hold to catch the next wave automatically.";
  button.setAttribute("aria-description", button.title);
  const release = (event) => {
    if (event && event.pointerId !== pointer) return;
    const id = pointer;
    pointer = null; buttonHeld = false; syncArmed();
    button.classList.remove("is-held");
    if (id !== null && button.hasPointerCapture(id)) button.releasePointerCapture(id);
  };
  releaseButtonHold = release;
  button.addEventListener("pointerdown", event => {
    if (event.button !== 0 || pointer !== null || !st?.enabled || !st.ready ||
        document.hidden || active() || bus?.rideActive?.()) return;
    event.preventDefault();
    pointer = event.pointerId; buttonHeld = true; syncArmed();
    button.setPointerCapture(pointer);
    button.classList.add("is-held");
    requestCatch();
  }, { signal: events.signal });
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
    button.addEventListener(type, release, { signal: events.signal });
  button.addEventListener("contextmenu", event => event.preventDefault(), { signal: events.signal });
  return () => {
    release(); events.abort();
    if (releaseButtonHold === release) releaseButtonHold = null;
  };
}

export function setSurfing(on) {
  if (!st || !window.Beach3D?.isOpen() || bus?.rideActive?.()) return false;
  on = !!on;
  if (on === st.enabled) return true;
  st.enabled = on;
  if (!on) { releaseKeys(); st.spawnT = null; }
  else {
    st.parked = false;
    if (st.crestZ === null) { st.spawnT = SURF.spawnFirst; st.mode = "spawning"; }
    say?.("Let's surf! Swim out, then tap Catch wave or hold it for the next wave.");
  }
  if (!on && st.crestZ === null) st.mode = "off";
  registerActivity();
  return true;
}

export function active() { return !!st && (st.mode === "riding" || st.landing); }

function canCatch() {
  if (!st?.ready || st.mode !== "traveling" || bus?.rideActive?.() ||
      !window.Beach3D?.isOpen() || !character.actionInfo().clip) return false;
  const a = character.getAnchor();
  /* The entire ride starts inside the playable box, even when Space is
     held at the deepest edge before the new swell has arrived. */
  return st.crestZ+SURF.pocket >= WORLD.box.zMin &&
    a.z < shorelineZ(a.x)-SURF.seaGuard && Math.abs(st.crestZ-a.z) <= SURF.catchRadius;
}

export function catchWave() {
  if (!canCatch()) return false;
  const a = character.getAnchor();
  bus?.beforeCatch?.();
  st.mode = "riding"; st.landing = false; st.parked = false;
  st.x = clamp(a.x, SURF.xMin, SURF.xMax); st.z = st.crestZ+SURF.pocket;
  st.yaw = 0; st.lean = st.vx = st.splashAcc = 0;
  st.held = false; st.pointerId = null;
  character.clearTarget(); character.setEnabled(false); character.setStance("surf");
  say?.("WOOHOO! \u{1f30a}"); sound("cheer");
  return true;
}

function isSpace(ev) { return ev.code === "Space" || ev.key === " " || ev.key === "Spacebar"; }
export function onKeyDown(ev) {
  if (!st || document.hidden || !window.Beach3D?.isOpen() || !isSpace(ev) ||
      ev.target?.isContentEditable ||
      ev.target?.closest?.('button, a[href], input, textarea, select, [role="button"]')) return;
  ev.preventDefault();
  if (ev.repeat || active() || bus?.rideActive?.()) return;
  spaceHeld = true; syncArmed();
  catchWave();
}
export function onKeyUp(ev) {
  if (!st || !isSpace(ev)) return;
  if (st.armed && window.Beach3D?.isOpen()) ev.preventDefault();
  spaceHeld = false; syncArmed();
}
export function releaseKeys() {
  spaceHeld = false;
  releaseButtonHold?.();
  buttonHeld = false;
  if (!st) return;
  st.armed = st.held = false; st.pointerId = null;
}

/* QA spawn is still a real sea-origin wave; optional x positions the swimmer,
   never rewinds or teleports an in-flight visual. */
export function spawnWave(x) {
  if (!st?.ready || st.crestZ !== null || active()) return false;
  if (Number.isFinite(x) && bus?.rideActive?.()) return false;
  if (Number.isFinite(x)) character.teleport(clamp(x,SURF.xMin,SURF.xMax), WORLD.box.zMin + 0.8);
  st.crestZ = SURF.spawnZ; st.mode = "traveling"; st.spawnT = null;
  st.breakT = 0; st.age = 0; st.spawnCount++;
  return true;
}

function point(ev) {
  if (!ev) return null;
  if (!Number.isFinite(ev.clientX)) return Number.isFinite(ev.x) ? ev.x : null;
  const r = world.canvas.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  raycaster.setFromCamera({ x: (ev.clientX-r.left)/r.width*2-1,
    y: 1-(ev.clientY-r.top)/r.height*2 }, world.camera);
  return raycaster.ray.intersectPlane(plane, hit) ? hit.x : null;
}
export function onPointerDown(ev) {
  if (!active()) return false;
  if (st.landing) return true;
  const id = ev.pointerId ?? "program";
  if (st.pointerId !== null && st.pointerId !== id) return true;
  const x = point(ev);
  if (x !== null) { st.targetX = clamp(x,SURF.xMin,SURF.xMax); st.held = true; st.pointerId = id; }
  return true;
}
export function onPointerMove(ev) {
  if (!active()) return false;
  if (st.pointerId === (ev.pointerId ?? "program")) onPointerDown(ev);
  return true;
}
export function onPointerUp(ev = {}) {
  if (!st || st.pointerId !== (ev.pointerId ?? "program")) return;
  st.held = false; st.pointerId = null;
}

function puff(x,z,y) {
  const f = foam[foamCursor++ % SURF.splashCap];
  f.age = 0; f.y = y;
  f.mesh.position.set(x,y,z);
}

function rollOff() {
  st.mode = "broken"; st.landing = true; st.rollT = 0;
  st.fromZ = st.z; st.fromY = st.y;
  st.toZ = shorelineZ(st.x)+0.38;
  st.counter++; st.held = false; st.pointerId = null;
  st.lastTalk = RIDE_TALKS[(st.counter-1)%RIDE_TALKS.length];
  say?.(st.lastTalk); sound("cheer");
  for (let i=0; i<4; i++) puff(st.x+(i-1.5)*0.22,st.toZ-(i%2)*0.25,sandY(st.x,st.toZ)+0.025);
  if (!chip) {
    chip = document.createElement("span"); chip.className = "beach-surf-chip";
    chip.style.display = "flex"; chip.setAttribute("role","status");
    chip.setAttribute("aria-label","Waves caught");
    (window.BeachScene?.actionsEl?.parentNode || document.querySelector(".beach-scene"))?.appendChild(chip);
  }
  chip.textContent = "\u{1f30a} "+st.counter;
}

// Cross-section runs from the gentle seaward back up to a curled shoreward lip.
const PROFILE = [[-1.55,0],[-1.05,.22],[-.65,.57],[-.3,.88],[0,1],
  [.18,.96],[.27,.82],[.16,.73],[.40,.42],[.78,.12],[1.05,0]];
const NX = 80;
function makeWave() {
  wave = new THREE.Group(); world.scene.add(wave); wave.visible = false;
  const geometry = new THREE.PlaneGeometry(15,1,NX,PROFILE.length-1);
  const colors = new Float32Array(geometry.attributes.position.count*3);
  const deep = new THREE.Color(WORLD.water.colDeep), pale = new THREE.Color(0x65b0ed), color = new THREE.Color();
  for (let j=0; j<PROFILE.length; j++) for (let i=0; i<=NX; i++) {
    color.copy(deep).lerp(pale,PROFILE[j][1]); color.toArray(colors,(j*(NX+1)+i)*3);
  }
  geometry.setAttribute("color",new THREE.BufferAttribute(colors,3));
  face = new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({ vertexColors:true,
    transparent:true, opacity:.8, depthWrite:false, side:THREE.DoubleSide, forceSinglePass:true }));
  crest = new THREE.Mesh(new THREE.PlaneGeometry(15,1,NX,3),new THREE.MeshBasicMaterial({
    color:0xffffff, transparent:true, depthWrite:false, side:THREE.DoubleSide, forceSinglePass:true }));
  wash = new THREE.Mesh(new THREE.PlaneGeometry(15,1,NX,1),new THREE.MeshBasicMaterial({
    map:texture(true), transparent:true, depthWrite:false, side:THREE.DoubleSide, forceSinglePass:true }));
  face.renderOrder = 3; crest.renderOrder = 4; wash.renderOrder = 4;
  wave.add(face,crest,wash);
  for (const m of [face,crest,wash]) m.frustumCulled = false;
}

function drawWave(waveT) {
  wave.visible = st.crestZ !== null;
  if (!wave.visible) return;
  const fade = smooth(st.age/.4)*(1-smooth(st.breakT/SURF.breakTime));
  face.material.opacity = .80*fade*(1-smooth((st.crestZ-shorelineZ(0)+.6)/1.0));
  crest.material.opacity = .95*fade; wash.material.opacity = .8*fade;
  for (let i=0; i<=NX; i++) {
    const x = -7.5+15*i/NX, shore = shorelineZ(x);
    const flatten = 1-smooth((st.crestZ-(shore-1.25))/1.55);
    const edge = smooth((7.5-Math.abs(x))/.65);
    const height = (.98+.04*Math.sin(x*2.1+waveT*Math.PI*2*SURF.crestHz))*flatten*edge;
    const ripple = (.12*Math.sin(x*1.3)+.05*Math.sin(x*3.8+waveT*.8))*flatten;
    for (let j=0; j<PROFILE.length; j++) {
      const [dz,h] = PROFILE[j], z = st.crestZ+dz+ripple;
      const base = Math.max(waterSurfaceY(x,z,waveT),sandY(x,z))+.012;
      face.geometry.attributes.position.setXYZ(j*(NX+1)+i,x,base+height*h,z);
    }
    for (let j=0; j<4; j++) {
      const z = st.crestZ+[-.085,.03,.17,.25][j]+ripple+.025*Math.sin(x*15+j);
      const base = Math.max(waterSurfaceY(x,z,waveT),sandY(x,z))+.027;
      crest.geometry.attributes.position.setXYZ(j*(NX+1)+i,x,base+height*[.99,1.015,.98,.86][j],z);
    }
    for (let j=0; j<2; j++) {
      const z = st.crestZ+.14+j*(.26+(1-flatten)*1.0)+ripple;
      wash.geometry.attributes.position.setXYZ(j*(NX+1)+i,x,
        Math.max(waterSurfaceY(x,z,waveT),sandY(x,z))+.03+height*(j ? .5 : .98),z);
    }
  }
  for (const mesh of [face,crest,wash]) mesh.geometry.attributes.position.needsUpdate = true;
}

export function update(dt,waveT,rm) {
  if (!st) return;
  const button = document.querySelector('[data-activity-id="surfwave"]');
  if (button) {
    const unavailable = !st.ready || !!bus?.rideActive?.();
    // Preserve an existing hold through the ride, just like holding Space.
    button.disabled = unavailable || (active() && !buttonHeld);
    button.classList.toggle("is-ready", canCatch());
    if (unavailable) releaseButtonHold?.();
  }
  st.bob = Math.sin(waveT*Math.PI*2*SURF.crestHz)*SURF.bob;
  if (st.crestZ === null && st.enabled && st.ready) {
    st.spawnT -= dt;
    if (st.spawnT <= 0) spawnWave();
  }
  if (st.crestZ !== null) {
    st.age += dt; st.crestZ += SURF.waveSpeed*dt;
    if (st.armed && !active()) catchWave();
    if (st.mode === "riding") {
      const oldX = st.x;
      const dx = st.held ? st.targetX-st.x : 0;
      if (Math.abs(dx) <= SURF.carveStop)
        st.x += Math.sign(dx)*Math.min(Math.abs(dx),dt*SURF.carveSpeed);
      else st.x += Math.sign(dx)*Math.min(Math.abs(dx),dt*SURF.carveSpeed*
        (SURF.carveFloor+(1-SURF.carveFloor)*Math.min(1,Math.abs(dx)/SURF.carveEase)));
      st.x = clamp(st.x,SURF.xMin,SURF.xMax); st.vx = dt ? (st.x-oldX)/dt : 0;
      st.lean += (clamp(dx/.56,-1,1)-st.lean)*(1-Math.exp(-SURF.leanEase*dt));
      const yaw = Math.atan2(st.vx,SURF.waveSpeed);
      st.yaw += (yaw-st.yaw)*(1-Math.exp(-7*dt));
      st.z = st.crestZ+SURF.pocket;
      const flatten = 1-smooth((st.crestZ-(shorelineZ(st.x)-1.25))/1.55);
      st.y = waterSurfaceY(st.x,st.z,waveT)+.70*flatten+st.bob;
      st.splashAcc += Math.hypot(st.x-oldX,SURF.waveSpeed*dt);
      if (st.splashAcc >= SURF.splashEvery) {
        st.splashAcc %= SURF.splashEvery;
        puff(st.x-Math.sin(st.yaw)*.55,st.z-Math.cos(st.yaw)*.55,st.y-.025);
      }
      if (st.crestZ >= shorelineZ(st.x)-SURF.shorePad) rollOff();
    }
    if (!active() && st.crestZ >= shorelineZ(0)-SURF.shorePad) st.mode = "broken";
    if (st.crestZ >= .9) st.breakT += dt;
    if (st.breakT >= SURF.breakTime && !active()) {
      st.crestZ = null; st.mode = st.enabled ? "spawning" : "off";
      st.gap = SURF.spawnMin+Math.random()*(SURF.spawnMax-SURF.spawnMin);
      st.spawnT = st.enabled ? st.gap : null;
    }
  }
  if (st.landing) {
    st.rollT += dt;
    const u = smooth(st.rollT/SURF.rollTime);
    st.z = THREE.MathUtils.lerp(st.fromZ,st.toZ,u);
    st.y = THREE.MathUtils.lerp(st.fromY,sandY(st.x,st.toZ)+.075,u);
    st.lean *= Math.exp(-10*dt);
    if (u === 1) {
      character.attachRide(st.x,st.z,st.yaw,"surf",st.y);
      character.detachRide(); character.setEnabled(true); character.setStance("stand");
      st.landing = false; st.parked = true; st.vx = 0;
      st.parkX = clamp(st.x+(st.x > SURF.xMax-.55 ? -.55 : .55),SURF.xMin,SURF.xMax);
    }
  }
  if (st.parked) {
    const a = character.getAnchor();
    if (st.enabled && a.z < shorelineZ(a.x)-SURF.seaGuard) st.parked = false;
    else st.x += (st.parkX-st.x)*(1-Math.exp(-5*dt));
  }
  if (active()) character.attachRide(st.x,st.z,st.yaw,"surf",st.y);
  else if (!st.parked && (st.enabled || st.crestZ !== null) && !bus?.rideActive?.()) {
    const a = character.getAnchor();
    const yaw = character.loco.yaw;
    // Clear a sideways swimmer's head even though the long board faces sea.
    const offset = .45+.55*Math.abs(Math.sin(yaw));
    const x = clamp(a.x+Math.cos(yaw)*offset,SURF.xMin,SURF.xMax);
    const z = clamp(a.z-Math.sin(yaw)*offset,WORLD.box.zMin,WORLD.box.zMax);
    const k = 1-Math.exp(-8*dt);
    st.x += (x-st.x)*k; st.z += (z-st.z)*k;
    st.yaw = Math.PI; st.lean = 0;
  }
  if (!active()) st.y = Math.max(waterSurfaceY(st.x,st.z,waveT)+.035,sandY(st.x,st.z)+.075);
  root.visible = st.ready && !bus?.rideActive?.();
  root.position.set(st.x,st.y,st.z);
  root.rotation.set(st.lean*SURF.tilt,st.yaw,-st.lean*SURF.tilt);
  drawWave(waveT);
  for (const f of foam) {
    f.age += dt; f.mesh.visible = f.age < SURF.splashLife;
    if (!f.mesh.visible) continue;
    const u = f.age/SURF.splashLife;
    f.mesh.position.y = Math.max(sandY(f.mesh.position.x,f.mesh.position.z)+.025,
      waterSurfaceY(f.mesh.position.x,f.mesh.position.z,waveT)+.025,f.y-u*.35);
    f.mesh.scale.setScalar(rm ? .85 : .35+u*.95);
    f.mesh.material.opacity = .8*(1-u)*(1-u);
  }
}

export function getCameraAnchor() {
  return active() ? {x:st.x,y:st.y+.171,z:st.z,zone:"sea"} : null;
}
export function state() {
  return st ? { mode:st.mode, enabled:st.enabled, ready:st.ready, crestZ:st.crestZ,
    counter:st.counter, armed:st.armed, canCatch:canCatch(), riding:active(), landing:st.landing,
    x:st.x,y:st.y,z:st.z,yaw:st.yaw,lean:st.lean,bob:st.bob,vx:st.vx,held:st.held,
    spawnT:st.spawnT,gap:st.gap,spawnCount:st.spawnCount,breakT:st.breakT,
    lastTalk:st.lastTalk,foam:foam.filter(f=>f.mesh.visible).length } : null;
}

function disposeModel(model) {
  const geometries = new Set(), materials = new Set();
  model.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); materials.add(o.material); } });
  geometries.forEach(g=>g.dispose()); materials.forEach(m=>m.dispose());
}

export async function attach(w,c,renderer,effects,speech,rideBus) {
  dispose(); const token = ++generation;
  world=w; character=c; fx=effects; say=speech; bus=rideBus;
  const a = character.getAnchor();
  st = { mode:"off",enabled:false,ready:false,crestZ:null,counter:0,armed:false,
    x:a.x+.45,z:a.z,y:sandY(a.x,a.z)+.075,yaw:Math.PI,lean:0,bob:0,vx:0,
    held:false,pointerId:null,targetX:0,spawnT:null,gap:null,age:0,breakT:0,
    landing:false,parked:false,splashAcc:0,spawnCount:0,lastTalk:null };
  root = new THREE.Group(); world.scene.add(root); makeWave();
  foamGeometry = new THREE.PlaneGeometry(1,1);
  foam = Array.from({length:SURF.splashCap},()=>{
    const mesh = new THREE.Mesh(foamGeometry,new THREE.MeshBasicMaterial({
      map:texture(false),transparent:true,depthWrite:false,side:THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI/2; mesh.renderOrder = 5; mesh.visible = false;
    world.scene.add(mesh); return {mesh,age:SURF.splashLife,y:0};
  });
  document.addEventListener("keydown",onKeyDown);
  document.addEventListener("keyup",onKeyUp);
  window.addEventListener("blur",releaseKeys);
  registerActivity();
  try {
    const gltf = await new GLTFLoader().loadAsync(GLB_URL);
    if (token !== generation) { disposeModel(gltf.scene); return false; }
    const originals = new Set(); gltf.scene.traverse(o=>{if(o.isMesh) originals.add(o.material);});
    toonify(gltf.scene,renderer); originals.forEach(m=>m.dispose());
    root.add(gltf.scene); st.ready = true; return true;
  } catch (e) {
    if (token === generation) console.error("beach3d: surfboard failed to load",e);
    return false;
  }
}

export function dispose() {
  ++generation;
  releaseKeys();
  window.BeachScene?.unregisterActivity(waveActivity.id, waveActivity);
  document.removeEventListener("keydown",onKeyDown);
  document.removeEventListener("keyup",onKeyUp);
  window.removeEventListener("blur",releaseKeys);
  if (active()) { character.detachRide(); character.setEnabled(true); }
  for (const model of [root,wave]) if (model) { disposeModel(model); model.removeFromParent(); }
  for (const f of foam) { f.mesh.material.dispose(); f.mesh.removeFromParent(); }
  foamGeometry?.dispose(); foamGeometry=null; foam=[]; foamCursor=0;
  chip?.remove(); chip=null;
  world=character=fx=say=bus=st=root=wave=face=crest=wash=null;
}
