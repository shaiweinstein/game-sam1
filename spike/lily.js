/* Lily SkelForm (MIT) x Phaser 3.90 — research spike.
 *
 * Adapted from spike/spike.js (the working Skellina spike). Loads lily.skf
 * (a ZIP: armature.json + atlas0.png), drives the MIT runtime per frame
 * (SkfGenericTimeFrame / SkfGenericAnimate / SkfGenericConstruct) and renders
 * every textured bone's atlas region as a Phaser sprite on the 2D canvas
 * renderer.
 *
 * Differences vs the Skellina spike:
 *   - loads 'lily.skf'; atlas texture key is 'lily_atlas'
 *   - ONE style ("Default") — found by name, fallback styles[0]
 *   - animation toolbar buttons are built DYNAMICALLY from the armature's
 *     animation list (currently just "Stand", which has empty keyframes, so
 *     the runtime holds the init / rest pose)
 *   - fit/scale tuned to Lily's armature space (~x 280..520, y -690..-57,
 *     center ~(400, -373.5))
 *
 * Vanilla JS, IIFE, 'use strict'. No modules, no bundler.
 */
(function () {
  'use strict';

  var CANVAS_W = 800;
  var CANVAS_H = 560;
  var SKF_FILE = 'lily.skf';
  var ATLAS_KEY = 'lily_atlas';
  var ARMATURE_NAME = SKF_FILE.replace(/\.skf$/, '');

  /* ------------------------------------------------------------------ *
   * Scene
   * ------------------------------------------------------------------ */
  function LilyScene() {
    Phaser.Scene.call(this, { key: 'LilyScene' });
  }
  LilyScene.prototype = Object.create(Phaser.Scene.prototype);
  LilyScene.prototype.constructor = LilyScene;

  LilyScene.prototype.create = function () {
    this.armature = null;
    this.atlasImage = null;
    this.activeStyles = null;
    this.boneSprites = [];  // { boneIndex, sprite, z, name }
    this.animButtons = [];  // toolbar buttons, one per armature animation
    this.animIndex = 0;
    this.animTime = 0;      // ms, advanced per frame
    this.quality = 1;       // 1 or 3 (toolbar toggle)
    // Lily's armature space spans ~x 280..520, y -690..-57 (240 x 633 units,
    // center ~(400, -373.5)). Fit scale 0.75 -> ~180 x 475 px, centered.
    this.fitScale = 0.75;   // world units -> px at 1x
    this.originX = 100;     // canvas anchor for world (0,0): 400 - 400*0.75
    this.originY = -0.125;  // canvas anchor for world (0,0): 280 - (-373.5)*0.75
    this.frameNum = 0;
    this.ready = false;

    var self = this;
    this.loadSkf(
      function (armature) {
        self.armature = armature;
        self.activeStyles = [self.findStyle(armature)];
        self.buildAnimButtons(armature.animations);
        self.buildBones();
        self.ready = true;
        self.updateLabel('ok');
      },
      function (err) {
        self.updateLabel('error');
        self.add.text(CANVAS_W / 2, CANVAS_H / 2, 'skf load failed: ' + err, {
          fontFamily: 'Menlo, monospace', fontSize: '14px', color: '#c0392b'
        }).setOrigin(0.5);
      }
    );
  };

  /* Lily has exactly one style named "Default"; fall back to styles[0]. */
  LilyScene.prototype.findStyle = function (arm) {
    for (var i = 0; i < arm.styles.length; i++) {
      if (arm.styles[i].name === 'Default') { return arm.styles[i]; }
    }
    return arm.styles[0];
  };

  /* One toolbar button per animation listed in the armature. */
  LilyScene.prototype.buildAnimButtons = function (anims) {
    var self = this;
    var container = document.getElementById('anim-buttons');
    if (!container) { return; }
    container.innerHTML = '';
    this.animButtons = [];
    anims.forEach(function (anim, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = anim.name;
      btn.addEventListener('click', function () {
        self.animIndex = idx;
        self.animTime = 0;
        setActive(self.animButtons, btn);
        self.updateLabel('ok');
      });
      container.appendChild(btn);
      self.animButtons.push(btn);
    });
    setActive(this.animButtons, this.animButtons[0]);
  };

  /* Fetch the .skf (ZIP), parse armature.json, and add the single atlas
   * (atlas0.png) as a Phaser image texture. */
  LilyScene.prototype.loadSkf = function (onOk, onErr) {
    var self = this;
    fetch(SKF_FILE)
      .then(function (res) {
        if (!res.ok) { throw new Error('HTTP ' + res.status); }
        return res.arrayBuffer();
      })
      .then(function (buf) { return JSZip.loadAsync(new Uint8Array(buf)); })
      .then(function (zip) {
        return Promise.all([
          zip.files['armature.json'].async('string'),
          zip.files['atlas0.png'].async('uint8array')
        ]);
      })
      .then(function (parts) {
        var armature = JSON.parse(parts[0]);
        var url = URL.createObjectURL(new Blob([parts[1]], { type: 'image/png' }));
        return new Promise(function (resolve, reject) {
          var img = new Image();
          img.onload = function () {
            URL.revokeObjectURL(url);
            self.atlasImage = img;
            self.textures.addImage(ATLAS_KEY, img);
            resolve(armature);
          };
          img.onerror = function () {
            URL.revokeObjectURL(url);
            reject(new Error('could not decode atlas0.png'));
          };
          img.src = url;
        });
      })
      .then(onOk)
      .catch(onErr);
  };

  /* One Phaser sprite per bone that has a visual. */
  LilyScene.prototype.buildBones = function () {
    var arm = this.armature;
    var atlas = this.textures.get(ATLAS_KEY);
    var records = [];
    for (var bi = 0; bi < arm.bones.length; bi++) {
      var bone = arm.bones[bi];
      if (bone.visuals_id === -1) { continue; }
      var visual = arm.visuals[bone.visuals_id];
      var tex = SkfGenericGetBoneTexture(visual.tex, this.activeStyles);
      if (!tex) { continue; }
      // One Phaser frame per bone region. tex.offset/size are atlas pixels
      // with a top-left origin (same convention as Phaser regions).
      atlas.add(tex.name, 0, tex.offset.x, tex.offset.y, tex.size.x, tex.size.y);
      records.push({ boneIndex: bi, z: visual.zindex, name: tex.name });
    }
    // Painter's order: visual.zindex ascending, ties keep bone-index order
    // (Array.sort is stable, and records were built in bone order).
    records.sort(function (a, b) { return a.z - b.z; });
    for (var i = 0; i < records.length; i++) {
      var rec = records[i];
      var sprite = this.add.sprite(0, 0, ATLAS_KEY, rec.name);
      sprite.setOrigin(0.5, 0.5);   // fractional center (setDisplayOrigin takes PIXELS)
      sprite.setDepth(rec.z);
      rec.sprite = sprite;
      this.boneSprites.push(rec);
    }
  };

  LilyScene.prototype.update = function (time, delta) {
    if (!this.ready) { return; }
    var arm = this.armature;
    var anim = arm.animations[this.animIndex];

    /* Per-frame drive (mirrors the web player's SkfNewFrame, minus GL):
     * time -> frame index, interpolate local bone transforms, then rebuild
     * world transforms (inheritance + FABRIK IK + sway physics). With empty
     * keyframes (the "Stand" rest pose) the bones hold their init_* pose. */
    this.animTime += delta;
    var frame = SkfGenericTimeFrame(this.animTime, anim, false, true);

    window.anim = anim; // skelform-js.js SkfGenericAnimate reads a global `anim`
    SkfGenericAnimate(arm.bones, [anim], [frame], [0]);
    var bones = SkfGenericConstruct(arm); // world pos/rot/scale per bone
    this.lastBones = bones; // debug handle: world state of the rendered frame

    /* Map each bone to its sprite. SkelForm is Y-up, Phaser is Y-down:
     * flip Y and negate the rotation. The sprite frame IS the texture
     * region, so sprite scale = bone.scale * S (not tex.size * ...).
     *
     * V3.90-CANVAS QUIRK (verified via drawImage capture + pixel readback):
     * this vendored min build's canvas renderer draws a ROTATED sprite's
     * frame with dest (-0.5, -0.5) — the frame's top-left corner at the
     * sprite position — instead of centered (-halfWidth, -halfHeight).
     * Rotation-0 objects ARE centered (the matrix translation equals the
     * sprite position; no compensation is baked in). We compensate by
     * shifting the sprite back by the rotated/scaled half-frame vector so
     * the bone pivot stays at the frame center. */
    var S = this.fitScale * this.quality;
    for (var i = 0; i < this.boneSprites.length; i++) {
      var rec = this.boneSprites[i];
      var b = bones[rec.boneIndex];
      var sp = rec.sprite;
      var px = this.originX + b.pos.x * S;
      var py = this.originY - b.pos.y * S; // Y flip
      sp.rotation = -b.rot;               // negated for the Y flip
      sp.setScale(b.scale.x * S, b.scale.y * S);
      // Phaser rotates a sprite about its display origin (0.5,0.5) = frame
      // center, so the frame center is already at (sp.x, sp.y). No
      // half-frame compensation needed for rotated sprites.
      sp.x = px;
      sp.y = py;
      sp.setVisible(!b.hidden);
    }
    this.frameNum = frame;
    this.updateLabel('ok');
  };

  LilyScene.prototype.updateLabel = function (state) {
    var el = document.getElementById('state-label');
    if (!el) { return; }
    if (state === 'error') { el.textContent = 'load error — see canvas'; return; }
    if (!this.armature) { el.textContent = 'loading…'; return; }
    var arm = this.armature;
    var anim = arm.animations[this.animIndex];
    var scale = this.fitScale * this.quality;
    el.textContent = ARMATURE_NAME + ' · ' + anim.name + ' · ' +
      arm.bones.length + ' bones · ' + scale.toFixed(2) + 'x · frame ' +
      this.frameNum;
  };

  /* ------------------------------------------------------------------ *
   * Game + toolbar
   * ------------------------------------------------------------------ */
  var game = new Phaser.Game({
    type: Phaser.WEBGL,
    parent: 'game',
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: '#f3e2c7',
    scene: LilyScene
  });

  // debug handle for the research spike (inspect via window.__spike)
  window.__spike = { game: game };

  function setActive(group, active) {
    group.forEach(function (b) { b.classList.toggle('active', b === active); });
  }

  (function wireToolbar() {
    var scaleButtons = [document.getElementById('btn-1x'),
      document.getElementById('btn-3x')];
    scaleButtons.forEach(function (btn, idx) {
      btn.addEventListener('click', function () {
        var s = game.scene.getScene('LilyScene');
        s.quality = (idx === 0) ? 1 : 3;
        setActive(scaleButtons, btn);
        s.updateLabel('ok');
      });
    });
    setActive(scaleButtons, scaleButtons[0]);
  })();
})();
