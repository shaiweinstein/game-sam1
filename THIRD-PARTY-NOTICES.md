# THIRD-PARTY-NOTICES.md

This file preserves the copyright notices and license grants required by the
third-party open-source components shipped with **Lily's Dress-Up Adventure**.
Every dependency below is under the MIT License, whose standard text appears
once here at the top; each entry then gives its attribution, as the license
requires. The game's own art (SVG 2D assets, Blender-built GLBs, atlases) and
its fully procedural WebAudio sound are self-created for this project.

---

## The MIT License (MIT)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF, IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

## three.js — r170

- Copyright (c) 2010-2024 three.js authors — MIT License (see above).
- Vendored at `lib/three/` (`three.module.js` carries the license header;
  `lib/three/README.md` documents the vendoring). No CDN, no build step.
- Bundled addons (same MIT grant, part of three.js r170):
  `GLTFLoader`, `BufferGeometryUtils`, `OrbitControls`, and `MarchingCubes`
  (the latter is the three.js port of the well-known blob demo from the
  webglsamples project, https://github.com/mrdoob/webglsamples).
- https://github.com/mrdoob/three.js — full text: https://github.com/mrdoob/three.js/blob/dev/LICENSE

## Phaser — 3.90.0 (patched build)

- Copyright (c) Richard Davey / Phaser Studio — MIT License (see above).
- Vendored at `lib/phaser.min.js`. **This is a patched build:** eight
  documented upstream quirks were fixed for reliable Canvas rendering in this
  game (see `spike2/NOTES.md` §4 in the source repository), including a missing
  WebGL pipeline base class. The patches are confined to those compatibility
  fixes; the build otherwise carries Phaser 3.90.0 code unchanged. Because the
  minified file carries no license banner, this entry preserves the required
  notice for all copies distributed with the game.
- https://phaser.io — full text: https://github.com/phaserjs/phaser/blob/master/LICENSE

## DragonBonesJS — 5.7

- Copyright (c) 2012-2025 The DragonBones team and other contributors — MIT
  License (see above); the license file ships alongside the code at
  `lib/dbjs/LICENSE`.
- Development tooling for the 2D rig experiments only; the shipped game page
  does not load it.
- https://github.com/AstroTx/DragonBonesJS

## SkelForm (runtime)

- Copyright (c) 2026 Retropaint — MIT License (see above); vendored with its
  `LICENSE` file at `lib/skelform/`.
- Opt-in animation runtime (loaded only behind a debug flag); not required
  for normal play.
- https://github.com/Retropaint/SkelForm

## JSZip — 3.10.1

- Copyright (c) Stuart Knightley — dual-licensed **MIT or GPLv3**; this
  project uses the **MIT** option, so only the MIT grant above applies
  (see above; license file ships as part of `lib/skelform/jszip.js` with its
  header intact).
- JSZip embeds **pako**, Copyright (c) Vitaly Puzrin & Andrei Tupolev, MIT
  License.
- Used only by the opt-in SkelForm runtime above.
- https://github.com/Stuk/jszip

---

## Adobe Mixamo — animation source, not distributed

The 3D character's animation clips (`walk`, `run`, `swim`, `surf`, `sit`,
`cheer`, `wave`, …) in `beach3d/assets/lily4_full.glb` were **retargeted from
clips downloaded via Adobe Mixamo** and are used under Adobe's Mixamo terms,
which grant royalty-free use of Mixamo characters and animations in games —
including commercial games — with no attribution required. The raw Mixamo
source files (`spike3/assets/mixamo/*.fbx`) are **not distributed** with this
product and are excluded from every public build, per the Mixamo
redistribution restriction; the shipped GLB contains only the compiled,
retargeted result. See `MONETIZATION-AND-LICENSING.md` §2 for the full
provenance record.
