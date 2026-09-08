/* B3: tap duck -> auto-swim -> seated ride -> coast / hop.
   Singleton like the 2D boat; only fixed pools and module-cached textures. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { toonify, blobShadowTexture, shorelineZ, waterSurfaceY, WORLD } from "./world.js";

const GLB_URL = new URL("./assets/duck_boat.glb", import.meta.url).href;
const BOAT = {
  x: 4.7, z: -3.5, speed: 3, minFactor: 0.4, acceleration: 6,
  drag: 2.5, coastStop: 0.05, easeRange: 0.84, stopDist: 0.08,
  xMin: WORLD.box.xMin + 0.2, xMax: WORLD.box.xMax - 0.2,
  zMin: WORLD.box.zMin + 0.4, shorePad: 0.5, hopDist: 0.7,
  boardDist: 0.5, tapRadius: 1.2, inviteTimeout: 20,
  seat: -0.16, wakeEvery: 0.5, wakeCap: 12, wakeLife: 0.9
};
let world = null, character = null, fx = null, say = null;
let root = null, shadow = null, st = null;
let wake = [], wakeGeometry = null, wakeCursor = 0;
let generation = 0, foamTexture = null;
const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WORLD.water.y);
const hit = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;

function wakeTexture() {
  if (foamTexture) return foamTexture;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.strokeStyle = "rgba(255,255,255,0.95)";
  g.lineWidth = 8;
  g.lineCap = "round";
  g.beginPath();
  g.ellipse(64, 35, 47, 49, 0, 0.12 * Math.PI, 0.88 * Math.PI);
  g.stroke();
  foamTexture = new THREE.CanvasTexture(c);
  foamTexture.colorSpace = THREE.SRGBColorSpace;
  return foamTexture;
}

function seaPoint(x, z) {
  x = clamp(x, BOAT.xMin, BOAT.xMax);
  return { x, z: clamp(z, BOAT.zMin, shorelineZ(x) - BOAT.shorePad) };
}

function sound(name) {
  try { if (fx && fx.sound) fx.sound(name); } catch (e) { /* cosmetic */ }
}

function syncRider() {
  const x = st.x + Math.sin(st.yaw) * BOAT.seat;
  const z = st.z + Math.cos(st.yaw) * BOAT.seat;
  character.attachRide(x, z, st.yaw);
  character.setRidePaddling(st.held, st.speed / BOAT.speed);
}

export function active() { return !!st && st.mode === "riding"; }

export function board() {
  if (!st || !st.ready || active() || !character.actionInfo().clip) return false;
  st.prevMode = window.BeachScene?.getMode() || "sand";
  st.mode = "riding";
  st.vx = st.vz = st.speed = st.wakeAcc = 0;
  st.held = false; st.pointerId = null;
  st.driftX = st.driftZ = 0;
  character.clearTarget();
  character.setEnabled(false);
  character.setStance("ride");
  syncRider();
  window.BeachScene?.setMode("boat");
  say?.("Wheee! The duck boat! \u{1f986}");
  sound("travel");
  return true;
}

export function hop() {
  if (!active()) return false;
  syncRider();
  const a = character.getAnchor();
  st.mode = "rest";
  st.vx = st.vz = st.speed = 0;
  st.held = false; st.pointerId = null;
  /* Leave HER anchor untouched. The empty hull slips sideways off the
     swimmer instead of enclosing/occluding her after the vertical drop. */
  const right = { x: Math.cos(st.yaw), z: -Math.sin(st.yaw) };
  const plus = seaPoint(st.x+right.x, st.z+right.z);
  const minus = seaPoint(st.x-right.x, st.z-right.z);
  const sign = Math.hypot(plus.x-a.x, plus.z-a.z) >= Math.hypot(minus.x-a.x, minus.z-a.z) ? 1 : -1;
  st.driftX = right.x*sign*3.6; st.driftZ = right.z*sign*3.6;
  character.detachRide();
  character.setEnabled(true);
  window.BeachScene?.setMode(st.prevMode || "sand");
  st.prevMode = null;
  world.splash(a.x, a.z);
  say?.("Splash! \u{1f30a}");
  sound("pop");
  return true;
}

function cancelInvite() {
  if (!st || st.mode !== "invited") return;
  character.clearTarget("program");
  st.mode = "rest";
  st.inviteT = 0;
}

/* Accept browser events (raw ray, not the character's narrower ground box)
   or {x,z,pointerId} world points for deterministic steering QA. */
function pointer(ev, rawRay) {
  if (!st || !ev) return null;
  if (Number.isFinite(ev.clientX)) {
    const r = world.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    raycaster.setFromCamera({ x: (ev.clientX-r.left)/r.width*2-1,
      y: 1-(ev.clientY-r.top)/r.height*2 }, world.camera);
  } else if (rawRay) {
    raycaster.ray.copy(rawRay);
  } else {
    return Number.isFinite(ev.x) && Number.isFinite(ev.z)
      ? { x: ev.x, z: ev.z, hull: false } : null;
  }
  const hull = !active() && raycaster.intersectObject(root, true).length > 0;
  const ground = raycaster.ray.intersectPlane(plane, hit);
  return ground ? { x: hit.x, z: hit.z, hull } : hull ? { x: st.x, z: st.z, hull } : null;
}

export function onPointerDown(ev, rawRay) {
  if (!st || !st.ready) return false;
  const p = pointer(ev, rawRay);
  if (active()) {
    if (st.pointerId !== null && st.pointerId !== (ev.pointerId ?? "program")) return true;
    st.pointerId = ev.pointerId ?? "program";
    if (p) { st.target = seaPoint(p.x, p.z); st.held = true; }
    return true;
  }
  if (p && (p.hull || Math.hypot(p.x-st.x, p.z-st.z) <= BOAT.tapRadius)) {
    character.clearTarget();
    if (character.setTarget(st.x, st.z, "program")) {
      st.mode = "invited"; st.inviteT = 0;
    }
    return true;
  }
  cancelInvite();
  return false;
}

export function onPointerMove(ev, rawRay) {
  if (!st) return false;
  const p = pointer(ev, rawRay);
  if (active()) {
    if (st.pointerId === (ev.pointerId ?? "program") && p) {
      st.target = seaPoint(p.x, p.z); st.held = true;
    }
    return true;
  }
  if (st.mode === "invited") {
    if (!p || p.hull || Math.hypot(p.x-st.x, p.z-st.z) <= BOAT.tapRadius) return true;
    cancelInvite();
  }
  return false;
}

export function onPointerUp(ev = {}) {
  if (!st) return;
  if (st.pointerId !== (ev.pointerId ?? "program")) return;
  st.held = false; st.pointerId = null;
}

export function releaseInput() {
  if (!st) return;
  st.held = false; st.pointerId = null;
}

export function update(dt, waveT, rm) {
  if (!st) return;
  if (st.mode === "rest" && (st.driftX || st.driftZ)) {
    const decay = Math.exp(-4*dt);
    const p = seaPoint(st.x+st.driftX*(1-decay)/4, st.z+st.driftZ*(1-decay)/4);
    st.x = p.x; st.z = p.z;
    st.driftX *= decay; st.driftZ *= decay;
    if (Math.hypot(st.driftX, st.driftZ) < 0.02) st.driftX = st.driftZ = 0;
  }
  if (st.mode === "invited") {
    st.inviteT += dt;
    const a = character.getAnchor();
    if (st.inviteT >= BOAT.inviteTimeout) cancelInvite();
    else if (a.zone === "sea" && Math.hypot(a.x-st.x, a.z-st.z) < BOAT.boardDist) board();
  }
  if (active()) {
    const oldX = st.x, oldZ = st.z;
    let dx = 0, dz = 0;
    if (st.held && st.target) {
      dx = st.target.x-st.x; dz = st.target.z-st.z;
      const d = Math.hypot(dx, dz);
      if (d > BOAT.stopDist) {
        const v = BOAT.speed * (BOAT.minFactor + (1-BOAT.minFactor)*Math.min(1, d/BOAT.easeRange));
        const k = 1-Math.exp(-BOAT.acceleration*dt);
        st.vx += (dx/d*v-st.vx)*k; st.vz += (dz/d*v-st.vz)*k;
        if (Math.hypot(st.vx, st.vz)*dt >= d) {
          st.x = st.target.x; st.z = st.target.z; st.vx = st.vz = 0;
        }
      } else st.vx = st.vz = 0;
    } else {
      const k = Math.exp(-BOAT.drag*dt);
      st.vx *= k; st.vz *= k;
      if (Math.hypot(st.vx, st.vz) < BOAT.coastStop) st.vx = st.vz = 0;
    }
    const nextX = st.x + st.vx*dt, nextZ = st.z + st.vz*dt;
    const p = seaPoint(nextX, nextZ);
    st.x = p.x; st.z = p.z;
    if (p.x !== nextX) st.vx = 0;
    if (p.z !== nextZ) st.vz = 0;
    st.speed = Math.hypot(st.vx, st.vz);
    if (st.speed > 0.06 || Math.hypot(dx, dz) > 0.01) {
      const yaw = st.speed > 0.06 ? Math.atan2(st.vx, st.vz) : Math.atan2(dx, dz);
      const delta = Math.atan2(Math.sin(yaw-st.yaw), Math.cos(yaw-st.yaw));
      st.yaw += delta*(1-Math.exp(-7*dt));
    }
    st.wakeAcc += rm ? 0 : Math.hypot(st.x-oldX, st.z-oldZ);
    if (st.wakeAcc >= BOAT.wakeEvery) {
      st.wakeAcc %= BOAT.wakeEvery;
      const w = wake[wakeCursor++ % BOAT.wakeCap];
      w.age = 0;
      w.mesh.position.set(st.x-Math.sin(st.yaw)*0.78, 0, st.z-Math.cos(st.yaw)*0.78);
      w.mesh.rotation.set(-Math.PI/2, 0, -st.yaw);
    }
    syncRider();
    const clearance = shorelineZ(st.x)-st.z;
    if (clearance <= BOAT.hopDist && st.speed > BOAT.coastStop &&
        clearance < shorelineZ(oldX)-oldZ) hop();
  }
  st.bob = Math.sin(waveT*Math.PI*2*0.55+1.3)*0.03;
  st.roll = Math.sin(waveT*Math.PI*2*0.42)*Math.PI/90;
  st.y = waterSurfaceY(st.x, st.z, waveT)+st.bob;
  root.position.set(st.x, st.y, st.z);
  root.rotation.set(0, st.yaw, st.roll);
  shadow.position.set(st.x, waterSurfaceY(st.x, st.z, waveT)+0.009, st.z);
  for (const w of wake) {
    w.age += dt;
    w.mesh.visible = !rm && w.age < BOAT.wakeLife;
    if (!w.mesh.visible) continue;
    const u = w.age/BOAT.wakeLife;
    w.mesh.position.y = waterSurfaceY(w.mesh.position.x, w.mesh.position.z, waveT)+0.025;
    w.mesh.scale.setScalar(0.65+0.65*u);
    w.mesh.material.opacity = 0.75*(1-u)*(1-u);
  }
}

export function getCameraAnchor() {
  return active() ? { x: st.x, y: st.y+0.111, z: st.z, zone: "sea" } : null;
}

export function state() {
  if (!st) return null;
  return { mode: st.mode, ready: st.ready, x: st.x, y: st.y, z: st.z,
    speed: st.speed, yaw: st.yaw, riding: active(), held: st.held,
    target: st.target && { ...st.target }, inviteT: st.inviteT,
    bob: st.bob, roll: st.roll, wake: wake.filter(w=>w.mesh.visible).length };
}

function disposeModel(model) {
  model.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    o.material.dispose();
  });
}

export async function attach(w, c, renderer, effects, speech) {
  dispose();
  const token = ++generation;
  world = w; character = c; fx = effects; say = speech;
  st = { mode: "rest", ready: false, x: BOAT.x, z: BOAT.z, y: WORLD.water.y,
    yaw: -0.55, speed: 0, vx: 0, vz: 0, held: false, pointerId: null,
    target: null, inviteT: 0, prevMode: null, bob: 0, roll: 0, wakeAcc: 0,
    driftX: 0, driftZ: 0 };
  root = new THREE.Group();
  world.scene.add(root);
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 1.9),
    new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true,
      opacity: 0.5, depthWrite: false }));
  shadow.rotation.x = -Math.PI/2; shadow.renderOrder = 3;
  world.scene.add(shadow);
  wakeGeometry = new THREE.PlaneGeometry(1, 1);
  wake = Array.from({ length: BOAT.wakeCap }, () => {
    const mesh = new THREE.Mesh(wakeGeometry, new THREE.MeshBasicMaterial({
      map: wakeTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide
    }));
    mesh.renderOrder = 4; mesh.visible = false;
    world.scene.add(mesh);
    return { mesh, age: BOAT.wakeLife };
  });
  window.BeachScene?.registerActivity({ id: "boathop", emoji: "\u{1f3ca}",
    label: "Hop out & swim", modes: ["boat"],
    onClick: () => active() ? hop() : window.BeachBoat?.hop() });
  try {
    const gltf = await new GLTFLoader().loadAsync(GLB_URL);
    if (token !== generation) { disposeModel(gltf.scene); return false; }
    /* The unrigged duck has only flat colors: bake them into vertices so
       the whole model is ONE toon draw, not thirteen, on mobile. */
    const parts = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const name of Object.keys(g.attributes)) {
        if (name !== "position" && name !== "normal") g.deleteAttribute(name);
      }
      const colors = new Float32Array(g.attributes.position.count*3);
      for (let i = 0; i < colors.length; i += 3) o.material.color.toArray(colors, i);
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      parts.push(g);
    });
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const duck = new THREE.Mesh(mergeGeometries(parts), material);
    toonify(duck, renderer);
    duck.material.vertexColors = true;
    material.dispose();
    parts.forEach(g => g.dispose());
    disposeModel(gltf.scene);
    root.add(duck);
    st.ready = true;
    return true;
  } catch (e) {
    if (token === generation) console.error("beach3d: duck boat failed to load", e);
    return false;
  }
}

export function dispose() {
  ++generation;
  if (active()) {
    character.detachRide(); character.setEnabled(true);
    window.BeachScene?.setMode(st.prevMode || "sand");
  }
  cancelInvite();
  if (root) { disposeModel(root); root.removeFromParent(); }
  if (shadow) { disposeModel(shadow); shadow.removeFromParent(); }
  for (const w of wake) { w.mesh.material.dispose(); w.mesh.removeFromParent(); }
  wakeGeometry?.dispose();
  wake = []; wakeCursor = 0; wakeGeometry = null;
  world = character = root = shadow = fx = say = st = null;
}
