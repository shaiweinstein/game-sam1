# Vendored three.js (no CDN — hard project rule)

Vendored from https://cdn.jsdelivr.net/npm/three@0.170.0
(mirror of https://unpkg.com/three@0.170.0) — downloaded 2026-09-05.

## Files

| File | Source |
| --- | --- |
| `three.module.js` | `build/three.module.js` |
| `addons/loaders/GLTFLoader.js` | `examples/jsm/loaders/GLTFLoader.js` |
| `addons/utils/BufferGeometryUtils.js` | `examples/jsm/utils/BufferGeometryUtils.js` (only import needed by GLTFLoader: `toTrianglesDrawMode`) |

## Why ES modules instead of a UMD build

Modern three.js (>= r150) **no longer ships a browser UMD build** —
r170's `build/` contains only `three.module.js` / `three.cjs`. The
pre-UMD-removal option (three r128 + `examples/js` UMD loaders) would
pin us to a 2021-era renderer. Instead this spike loads the official
ES-module builds with a tiny local import map in `spike3/index.html`:

```html
<script type="importmap">
  { "imports": {
      "three": "../lib/three/three.module.js",
      "three/addons/": "../lib/three/addons/"
  } }
</script>
<script type="module" src="spike3.js"></script>
```

Everything resolves to local files — no CDN, no npm, no build step.
GLTFLoader's only dependencies are `three` and `BufferGeometryUtils`,
both vendored here, so the dependency tree is closed.

## License

three.js is MIT licensed (c) 2010-2026 three.js authors —
see https://github.com/mrdoob/three.js/blob/dev/LICENSE.
