# lib/dbjs — vendored DragonBones runtime + official Phaser 3 plugin

Vendored copy of the DragonBonesJS 5.7 runtime **including the official
Phaser 3 plugin**, so the project runs fully offline (no CDN, no build
step, no npm). Loaded as a plain classic script:

```html
<script src="lib/dbjs/dragonBones.min.js"></script>
<!-- exposes global `dragonBones` -->
```

## Files

| File | Size | Description |
| --- | --- | --- |
| `dragonBones.min.js` | 237,841 B | Minified runtime + Phaser 3 plugin. **Use this one.** |
| `dragonBones.js` | 739,539 B | Unminified build of the same code. Kept for reading/debugging (the plugin's `setPipeline` / pipeline classes are readable here; e.g. lines 15436–15467 `SlotImage`/`SlotSprite`, 15716+ `TextureTintPipeline`, 15894+ loader + scene plugin). Not loaded by the game. |
| `LICENSE` | — | MIT license, verbatim from the upstream repo. |

## Provenance

- **Upstream repo:** <https://github.com/DragonBones/DragonBonesJS>
- **Commit:** `64b6c69ae35777c2404be68c9192e2c56906079e` (2025-05-24, `master`)
- **Vendored files (verbatim, no modifications):**
  - <https://raw.githubusercontent.com/DragonBones/DragonBonesJS/64b6c69ae35777c2404be68c9192e2c56906079e/Phaser/3.x/out/dragonBones.min.js>
  - <https://raw.githubusercontent.com/DragonBones/DragonBonesJS/64b6c69ae35777c2404be68c9192e2c56906079e/Phaser/3.x/out/dragonBones.js>
  - <https://raw.githubusercontent.com/DragonBones/DragonBonesJS/64b6c69ae35777c2404be68c9192e2c56906079e/LICENSE>

## Versions

- **Core runtime:** DragonBones **5.7.0** (embedded constant
  `DragonBones.VERSION = "5.7.000"`; prints `DragonBones: 5.7.000` on boot).
- **Phaser 3 plugin:** bundled in the same file (repo path `Phaser/3.x/out/`).
  No separate version string is embedded in the plugin code; the matching
  npm distribution at the time of this commit is
  [`dragonbones-phaser@5.6.2`](https://www.npmjs.com/package/dragonbones-phaser).
- **Accepted skeleton JSON data versions** (`DataParser.DATA_VERSIONS`):
  `4.0`, `4.5`, `5.0`, `5.5`, `5.6` (either `version` or `compatibleVersion`
  matching is accepted). The LoongBones 1.x web editor can export `6.0` or
  `5.5`; **5.5 is the version to export for compatibility with this runtime**
  (see `spike2/NOTES.md`).

## min vs full — why both are kept

The `dragonBones.min.js` checked into the upstream repo is a slightly older
minification than a fresh minify of the current `dragonBones.js` produces
(some internal identifiers/whitespace-level differences only — same behavior,
same API). We vendored **both files verbatim** from the same commit rather
than re-minifying locally, so the copy is byte-for-byte auditable against the
upstream commit; the checked-in min is what gets loaded and works correctly.
If you ever re-minify, diff the API surface (`dragonBones.*` globals) — the
game only depends on the documented plugin API (see below).

## Integration with THIS project's Phaser build

This project ships a **patched Phaser 3.90** build
(`lib/phaser.min.js`) with several differences from stock 3.90. The DragonBones
Phaser plugin needs a small compat shim to evaluate and run against it.
The shim lives in `spike2/index.html` (inline script between the Phaser and
DragonBones script tags) and is documented in
[`spike2/NOTES.md`](../spike2/NOTES.md#phaser-390-patched-build-quirks--the-shim).
**Keep that shim before the DragonBones script on any page that uses this
runtime.**

## Plugin API (the only surface the game uses)

```js
// 1. Register the scene plugin in the game config:
new Phaser.Game({
  plugins: {
    scene: [{
      key: 'DragonBones',
      plugin: dragonBones.phaser.plugin.DragonBonesScenePlugin,
      mapping: 'dragonbone'
    }]
  },
  // ...
});

// 2. In scene.preload() — note the arg order (texture PNG first, atlas JSON, skeleton JSON):
this.load.dragonbone('girl', 'girl.png', 'girl_tex.json', 'girl.json');

// 3. In scene.create():
var display = this.add.armature('girl', 'girl');   // (armatureName, dragonBonesName)
display.setScale(1.6);

// 4. Animations:
display.animation.play('walk');   // name; playTimes optional (0 = loop forever)

// 5. Flip facing (ArmatureDisplay is a Phaser Container):
display.scaleX = -display.scaleX;
```

The scene plugin drives the DragonBones `WorldClock` every frame — no manual
per-frame update is needed.

## License

MIT — see `LICENSE`. Copyright (c) 2012-2025 The DragonBones team and other
contributors.
