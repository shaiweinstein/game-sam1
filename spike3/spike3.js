/* ============================================================
   S1 spike — 3D Lily orbit viewer (no build step, vendored three.js)

   - Loads spike3/assets/lily.glb (Blender, single flat colors).
   - Rebuilds every material as MeshToonMaterial with a 4-step
     gradientMap generated in JS — flat cartoon shading, no PBR.
   - Small custom orbit control: drag rotates around a fixed target
     height, wheel zooms, gentle auto-rotate after idle.
   - Quick-view buttons (Front / Side / Back / 45°) + zoom.
   - Phase 2: if assets/lily_walk.glb exists, a "▶ Walk" button
     plays the Mixamo walk (AnimationMixer, loop) while the
     orbit camera keeps moving.

   Test hook: window.__spike3 (see bottom) — used by Playwright
   for deterministic screenshots and the fps check.
   ============================================================ */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/* ---------- scene basics ---------- */

const viewport = document.getElementById("viewport");
/* Detect software rasterizers (SwiftShader / llvmpipe). On those MSAA is
   brutally expensive, so we drop antialias and render a bit smaller to
   keep the orbit at 60 fps. Real GPUs run this tiny scene at native
   resolution with full MSAA — the default path. */
function isSoftwareGL() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return false;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
                   : gl.getParameter(gl.RENDERER)) || "";
    return /swiftshader|llvmpipe|softpipe/i.test(r);
  } catch (e) { return false; }
}
const SOFTWARE_GL = isSoftwareGL();
const renderer = new THREE.WebGLRenderer({ antialias: !SOFTWARE_GL });
const basePR = Math.min(window.devicePixelRatio, 2);
viewport.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = makeSkyTexture();

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
const TARGET = new THREE.Vector3(0, 0.52, 0); // fixed orbit height (chest)
const MIN_R = 0.7, MAX_R = 4.0;
const MIN_PHI = 0.25, MAX_PHI = 1.52;

scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const sun = new THREE.DirectionalLight(0xffffff, 1.7);
sun.position.set(1.6, 3.2, 2.6);
scene.add(sun);

/* 4-step toon gradient: values 0 / 1/3 / 2/3 / 1, NearestFilter = hard bands */
let _gradientMap = null;
function gradientMap() {
  if (_gradientMap) return _gradientMap;
  const data = new Uint8Array([
    72, 72, 72, 255,
    140, 140, 140, 255,
    205, 205, 205, 255,
    255, 255, 255, 255
  ]);
  const t = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  _gradientMap = t;
  return t;
}

/* soft sand disc + blob shadow */
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(2.4, 72),
  new THREE.MeshToonMaterial({ color: 0xf2d9a6, gradientMap: gradientMap() })
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const blob = new THREE.Mesh(
  new THREE.CircleGeometry(0.46, 48),
  new THREE.MeshBasicMaterial({
    map: makeBlobShadowTexture(), transparent: true, depthWrite: false
  })
);
blob.rotation.x = -Math.PI / 2;
blob.position.y = 0.002;
scene.add(blob);

function makeSkyTexture() {
  const c = document.createElement("canvas");
  c.width = 4; c.height = 256;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, "#bfe6ff");
  grad.addColorStop(0.55, "#e8f7ff");
  grad.addColorStop(1, "#fff3dd");
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeBlobShadowTexture() {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s / 2);
  grad.addColorStop(0, "rgba(58,46,110,0.30)");
  grad.addColorStop(1, "rgba(58,46,110,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, s, s);
  return new THREE.CanvasTexture(c);
}

/* ---------- model: rebuild all materials as toon ---------- */

/* Two model versions for A/B review:
     v1 = lily.glb / lily_walk.glb          (S1 spike — skirt, helmet hair)
     v2 = lily2.glb / lily2_walk.glb        (S2 spike — swimsuit kid body)
   v2 is the default. Each version owns its own static mesh, skinned walk
   mesh and AnimationMixer; the Walk button always acts on the ACTIVE one.
   Walk assets are lazy: probed (HEAD) before fetching so the offline log
   stays clean if a variant is missing. */

const VERSIONS = {
  v1: { static: "assets/lily.glb", walk: "assets/lily_walk.glb" },
  v2: { static: "assets/lily2.glb", walk: "assets/lily2_walk.glb" }
};

const versions = {
  v1: { scene: null, walkScene: null, mixer: null, action: null,
        playing: false, walkProbed: false },
  v2: { scene: null, walkScene: null, mixer: null, action: null,
        playing: false, walkProbed: false }
};
let active = "v2";
const nameToMesh = {};

function toonify(root, meshMap) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    const src = node.material;
    const m = new THREE.MeshToonMaterial({
      color: src.color ? src.color.clone() : new THREE.Color(0xffffff),
      gradientMap: gradientMap()
    });
    if (src.map) {
      // The head carries the 2D face as an opaque texture. Cap
      // anisotropy at 4: plenty for the near-frontal face view, and it
      // keeps the frame cost low on software GL (headless/spike).
      m.map = src.map;
      m.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    }
    node.material = m;
    if (meshMap) meshMap[node.name] = node;
  });
}

const loader = new GLTFLoader();

function showActive() {
  for (const id of Object.keys(versions)) {
    const v = versions[id];
    if (v.scene) v.scene.visible = id === active && !(v.playing && v.walkScene);
    if (v.walkScene) v.walkScene.visible = id === active && v.playing;
  }
  const on = active === "v2" ? v2Btn : v1Btn;
  const off = active === "v2" ? v1Btn : v2Btn;
  on.classList.add("active");
  off.classList.remove("active");
}

function loadStatic(id, cb) {
  loader.load(VERSIONS[id].static, (gltf) => {
    toonify(gltf.scene, id === active ? nameToMesh : null);
    gltf.scene.visible = false;
    versions[id].scene = gltf.scene;
    scene.add(gltf.scene);
    showActive();
    if (cb) cb();
  }, undefined, (err) => {
    console.error("failed to load " + VERSIONS[id].static + ":", err);
  });
}

function setActive(id) {
  if (!versions[id] || id === active) return;
  active = id;
  showActive();
  refreshWalkBtn();
  if (!versions[id].scene) loadStatic(id, () => probeWalk(id));
  markInteract();
}

/* ---------- custom orbit control (~40 lines) ---------- */

const orbit = {
  theta: 0, phi: 1.28, radius: 2.1,          // current
  tTheta: 0, tPhi: 1.28, tRadius: 2.1,        // targets (buttons/drag write these)
  dragging: false,
  lastX: 0, lastY: 0,
  lastInteract: performance.now(),
  autoRotate: true,
  IDLE_MS: 2500,
  AUTO_SPEED: 0.22                            // rad/s when idle
};

function markInteract() {
  orbit.lastInteract = performance.now();
}

const el = renderer.domElement;
el.addEventListener("pointerdown", (e) => {
  orbit.dragging = true;
  orbit.lastX = e.clientX; orbit.lastY = e.clientY;
  el.setPointerCapture(e.pointerId);
  markInteract();
});
el.addEventListener("pointermove", (e) => {
  if (!orbit.dragging) return;
  orbit.tTheta -= (e.clientX - orbit.lastX) * 0.0055;
  orbit.tPhi -= (e.clientY - orbit.lastY) * 0.0045;
  orbit.tPhi = Math.max(MIN_PHI, Math.min(MAX_PHI, orbit.tPhi));
  orbit.lastX = e.clientX; orbit.lastY = e.clientY;
  markInteract();
});
el.addEventListener("pointerup", (e) => {
  orbit.dragging = false;
  el.releasePointerCapture(e.pointerId);
  markInteract();
});
el.addEventListener("wheel", (e) => {
  e.preventDefault();
  orbit.tRadius *= Math.exp(e.deltaY * 0.0012);
  orbit.tRadius = Math.max(MIN_R, Math.min(MAX_R, orbit.tRadius));
  markInteract();
}, { passive: false });

function updateOrbit(dt) {
  if (orbit.autoRotate && !orbit.dragging &&
      performance.now() - orbit.lastInteract > orbit.IDLE_MS) {
    orbit.tTheta += orbit.AUTO_SPEED * dt;
  }
  const k = 1 - Math.pow(0.0015, dt); // frame-rate independent damping
  orbit.theta += (orbit.tTheta - orbit.theta) * k;
  orbit.phi += (orbit.tPhi - orbit.phi) * k;
  orbit.radius += (orbit.tRadius - orbit.radius) * k;
  camera.position.set(
    TARGET.x + orbit.radius * Math.sin(orbit.phi) * Math.sin(orbit.theta),
    TARGET.y + orbit.radius * Math.cos(orbit.phi),
    TARGET.z + orbit.radius * Math.sin(orbit.phi) * Math.cos(orbit.theta)
  );
  camera.lookAt(TARGET);
}

/* ---------- buttons ---------- */

const VIEWS = { front: 0, side: Math.PI / 2, back: Math.PI, "45": Math.PI / 4 };
const viewBtns = document.getElementById("viewBtns");
viewBtns.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.view !== undefined) {
    let target = VIEWS[btn.dataset.view];
    // shortest way around from the current heading
    const cur = orbit.tTheta;
    while (target - cur > Math.PI) target -= Math.PI * 2;
    while (target - cur < -Math.PI) target += Math.PI * 2;
    orbit.tTheta = target;
    markInteract();
  } else if (btn.dataset.zoom) {
    orbit.tRadius = Math.max(MIN_R, Math.min(MAX_R,
      orbit.tRadius * (btn.dataset.zoom === "in" ? 0.82 : 1.22)));
    markInteract();
  }
});

/* ---------- Phase 2: walk (per active version) ---------- */

const walkBtn = document.getElementById("walkBtn");
const v1Btn = document.getElementById("v1Btn");
const v2Btn = document.getElementById("v2Btn");
v1Btn.addEventListener("click", () => setActive("v1"));
v2Btn.addEventListener("click", () => setActive("v2"));

/* Mixamo "Walking" (In Place, 30 fps) retargeted onto each mesh by
   spike3/blender/build_lily_walk.py / build_lily2_walk.py. */
const WALK_BUILT = true;

function probeWalk(id) {
  if (!WALK_BUILT || versions[id].walkProbed) return;
  versions[id].walkProbed = true;
  const url = VERSIONS[id].walk;
  fetch(url, { method: "HEAD" }).then((r) => {
    if (!r.ok) return;
    loader.load(url, (gltf) => {
      toonify(gltf.scene);
      gltf.scene.visible = false;
      const v = versions[id];
      v.walkScene = gltf.scene;
      scene.add(gltf.scene);
      v.mixer = new THREE.AnimationMixer(gltf.scene);
      if (gltf.animations && gltf.animations.length) {
        v.action = v.mixer.clipAction(gltf.animations[0]);
        v.action.setLoop(THREE.LoopRepeat, Infinity);
      }
      if (v.playing) v.action && v.action.play();
      if (id === active) { refreshWalkBtn(); showActive(); }
    }, undefined, () => { /* walk model optional — stay silent */ });
  }).catch(() => { /* file absent — static spike only */ });
}

function refreshWalkBtn() {
  const v = versions[active];
  walkBtn.hidden = !v.action;
  walkBtn.textContent = v.playing ? "■ Stop" : "▶ Walk";
}

walkBtn.addEventListener("click", () => {
  const v = versions[active];
  if (v.playing) {
    if (v.action) {
      v.action.fadeOut(0.15);
      v.mixer.stopAllAction();
    }
    v.playing = false;
  } else {
    v.playing = true;
    if (!v.action) {
      probeWalk(active);          // first press loads the walk asset
    } else {
      v.action.reset().fadeIn(0.15).play();
    }
  }
  showActive();
  refreshWalkBtn();
  markInteract();
});

/* ---------- resize / render loop / fps ---------- */

/* Adaptive render scale: start at the device's full pixel ratio. If the
   frame rate stays below ~58 fps for two consecutive half-second windows,
   step the render scale down (to 0.5x floor) until the orbit is smooth.
   A real GPU runs this tiny scene at full res with MSAA, so this only
   ever kicks in on software-GL rigs (e.g. the headless test box). */
let prScale = SOFTWARE_GL ? 0.8 : 1.0;
let slowWindows = 0;

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(basePR * prScale);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();

const clock = new THREE.Clock();
let frames = 0, fpsTime = 0, fpsNow = 0, totalFrames = 0;
const fpsEl = document.getElementById("fps");

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  updateOrbit(dt);
  for (const id of Object.keys(versions)) {
    const v = versions[id];
    if (v.playing && v.mixer) v.mixer.update(dt);
  }
  renderer.render(scene, camera);
  frames++;
  totalFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fpsNow = Math.round(frames / fpsTime);
    fpsEl.textContent = fpsNow + " fps";
    frames = 0; fpsTime = 0;
    if (totalFrames > 30) {
      if (fpsNow < 58) slowWindows++;
      else slowWindows = 0;
      if (slowWindows >= 2 && prScale > 0.5) {
        prScale = Math.max(0.5, Math.round((prScale - 0.1) * 10) / 10);
        slowWindows = 0;
        resize();
      }
    }
  }
});

/* ---------- init done ---------- */

let resolveReady = null;
const ready = new Promise((res) => { resolveReady = res; });

/* v2 is the default view for the S2 review; v1 lazy-loads on toggle. */
loadStatic("v2", () => {
  probeWalk("v2");
  resolveReady(true);
});

/* ---------- test hook (Playwright) ---------- */

window.__spike3 = {
  ready,
  fps: () => fpsNow,
  setViewDeg: (deg) => {
    orbit.tTheta = THREE.MathUtils.degToRad(deg);
    orbit.tPhi = 1.28;
    markInteract();
  },
  /* for GIF capture: snap the camera instantly (no damping) */
  setThetaInstant: (deg) => {
    const r = THREE.MathUtils.degToRad(deg);
    orbit.theta = orbit.tTheta = r;
    orbit.phi = orbit.tPhi = 1.28;
    markInteract();
  },
  setZoom: (r) => {
    orbit.tRadius = Math.max(MIN_R, Math.min(MAX_R, r));
    markInteract();
  },
  setAutoRotate: (on) => { orbit.autoRotate = !!on; },
  getWalk: () => ({
    available: !!versions[active].action,
    playing: versions[active].playing,
    version: active
  }),
  /* v2 additions for the A/B review (old hooks above are unchanged) */
  setModelVersion: (id) => setActive(id),
  getModelVersion: () => active,
  /* resolves once the named version's walk asset is loaded */
  whenWalkLoaded: (id) => new Promise((res) => {
    (function poll() {
      const v = versions[id];
      if (v.action) res(true); else setTimeout(poll, 50);
    })();
  })
};
