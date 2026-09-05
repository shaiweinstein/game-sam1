/* SkelForm (MIT) x Phaser 3.90 — research spike.
 *
 * (A) RUNTIME GATE: loads a real .skf (skellina.skf, a ZIP), drives the MIT
 *     runtime per frame (SkfGenericTimeFrame / SkfGenericAnimate /
 *     SkfGenericConstruct) and renders every bone's atlas texture region as
 *     a Phaser sprite on the 2D canvas renderer — NOT the web player's GL.
 * (B) CLEAN PART: one cohesive "Lily head+hair" part rasterized with Canvas
 *     2D into a Phaser canvas texture, shown at 1x and 3x side by side.
 *
 * Vanilla JS, IIFE, 'use strict'. No modules, no bundler.
 */
(function () {
  'use strict';

  var CANVAS_W = 800;
  var CANVAS_H = 560;
  var PART_PX = 64;   // "1x" display size of the clean part
  var PART_RES = 3;   // rasterize the clean part at 3x so both views are crisp

  /* ------------------------------------------------------------------ *
   * Scene
   * ------------------------------------------------------------------ */
  function SpikeScene() {
    Phaser.Scene.call(this, { key: 'SpikeScene' });
  }
  SpikeScene.prototype = Object.create(Phaser.Scene.prototype);
  SpikeScene.prototype.constructor = SpikeScene;

  SpikeScene.prototype.create = function () {
    this.armature = null;
    this.atlasImage = null;
    this.activeStyles = null;
    this.boneSprites = [];  // { boneIndex, sprite }
    this.animIndex = 0;     // Stand
    this.animTime = 0;      // ms, advanced per frame
    this.quality = 1;       // 1 or 3 (toolbar toggle)
    // skellina's visible content spans ~2600 world units (feet -991 .. head +1612)
    this.fitScale = 0.19;   // world units -> px at 1x
    this.originX = 390;     // canvas anchor for world (0,0)
    this.originY = 336;
    this.frameNum = 0;
    this.ready = false;

    this.add.text(CANVAS_W / 2, CANVAS_H - 10, 'SkelForm runtime  ->  Phaser sprites (canvas renderer)', {
      fontFamily: 'Menlo, monospace', fontSize: '11px', color: '#8a6a4a'
    }).setOrigin(0.5, 1).setDepth(500);

    var self = this;
    this.loadSkf(
      function (armature) {
        self.armature = armature;
        self.activeStyles = [armature.styles[2]]; // 'Default'
        self.buildBones();
        self.buildCleanPart();
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

  /* Fetch the .skf (ZIP), parse armature.json, and add the single atlas
   * (atlas0.png) as a Phaser image texture. */
  SpikeScene.prototype.loadSkf = function (onOk, onErr) {
    var self = this;
    fetch('skellina.skf')
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
            self.textures.addImage('skellina_atlas', img);
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
  SpikeScene.prototype.buildBones = function () {
    var arm = this.armature;
    var atlas = this.textures.get('skellina_atlas');
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
      var sprite = this.add.sprite(0, 0, 'skellina_atlas', rec.name);
      sprite.setDisplayOrigin(0.5, 0.5);
      sprite.setDepth(rec.z);
      rec.sprite = sprite;
      this.boneSprites.push(rec);
    }
  };

  /* (B) one clean illustrated head+hair part as a Phaser canvas texture,
   * shown at 1x and 3x side by side. */
  SpikeScene.prototype.buildCleanPart = function () {
    var canvas = document.createElement('canvas');
    canvas.width = PART_PX * PART_RES;
    canvas.height = PART_PX * PART_RES;
    var ctx = canvas.getContext('2d');
    ctx.scale(PART_RES, PART_RES);
    drawLilyHead(ctx);
    this.textures.addCanvas('lily_head', canvas);

    var card = { x: 500, y: 12, w: 288, h: 236 };
    // NOTE: Phaser 3 setStrokeStyle(lineWidth, color, alpha) — width FIRST.
    // (setStrokeStyle(0xc9b18f, 1) would set lineWidth=13218191 and stroke the
    // card with a 13M-px black band that blacked out the whole canvas.)
    this.add.rectangle(card.x + card.w / 2, card.y + card.h / 2, card.w, card.h, 0xfaf0e0, 0.92)
      .setStrokeStyle(1, 0xc9b18f)
      .setDepth(100);

    this.add.text(card.x + 12, card.y + 9, 'clean part', {
      fontFamily: 'Menlo, monospace', fontSize: '13px', color: '#6b4a2f'
    }).setOrigin(0, 0).setDepth(101);

    this.add.image(546, 96, 'lily_head').setScale(1 / PART_RES).setDepth(101);  // 1x
    this.add.image(690, 122, 'lily_head').setScale(1).setDepth(101);            // 3x
    this.add.text(546, 142, '1x', {
      fontFamily: 'Menlo, monospace', fontSize: '11px', color: '#6b4a2f'
    }).setOrigin(0.5).setDepth(101);
    this.add.text(690, 232, '3x', {
      fontFamily: 'Menlo, monospace', fontSize: '11px', color: '#6b4a2f'
    }).setOrigin(0.5).setDepth(101);
  };

  SpikeScene.prototype.update = function (time, delta) {
    if (!this.ready) { return; }
    var arm = this.armature;
    var anim = arm.animations[this.animIndex];

    /* Per-frame drive (mirrors the web player's SkfNewFrame, minus GL):
     * time -> frame index, interpolate local bone transforms, then rebuild
     * world transforms (inheritance + FABRIK IK + sway physics). */
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
      if (sp.rotation === 0) {
        sp.x = px;
        sp.y = py;
      } else {
        var th = sp.rotation;
        var ct = Math.cos(th), st = Math.sin(th);
        var a = sp.scaleX * ct, bm = sp.scaleX * st;
        var c = -sp.scaleY * st, d = sp.scaleY * ct;
        var cx = sp.frame.width / 2 - 0.5, cy = sp.frame.height / 2 - 0.5;
        sp.x = px - (a * cx + c * cy);
        sp.y = py - (bm * cx + d * cy);
      }
      sp.setVisible(!b.hidden);
    }
    this.frameNum = frame;
    this.updateLabel('ok');
  };

  SpikeScene.prototype.updateLabel = function (state) {
    var el = document.getElementById('state-label');
    if (!el) { return; }
    var animName = this.armature ? this.armature.animations[this.animIndex].name : '—';
    el.textContent = (state === 'ok')
      ? animName + ' · ' + this.quality + 'x · frame ' + this.frameNum
      : (state === 'error' ? 'load error — see canvas' : 'loading…');
  };

  /* ------------------------------------------------------------------ *
   * Clean part: one cohesive warm illustrated piece (64x64 design space).
   * ------------------------------------------------------------------ */
  function deg(d) { return d * Math.PI / 180; }

  // Bob silhouette; bottomY is where the straight hair cut sits.
  function bobSilhouette(ctx, bottomY) {
    ctx.beginPath();
    ctx.moveTo(8, 38);
    ctx.quadraticCurveTo(8, 5, 32, 5);
    ctx.quadraticCurveTo(56, 5, 56, 38);
    ctx.lineTo(56, bottomY - 5);
    ctx.quadraticCurveTo(56, bottomY, 50, bottomY);
    ctx.lineTo(14, bottomY);
    ctx.quadraticCurveTo(8, bottomY, 8, bottomY - 5);
    ctx.closePath();
  }

  function drawLilyHead(ctx) {
    // Hair: dark base silhouette, then the main brown silhouette slightly
    // shorter -> a single dark under-shade band along the bob's bottom edge.
    // Both are one connected shape each; together they read as one cap.
    bobSilhouette(ctx, 54);
    ctx.fillStyle = '#5e3a22';
    ctx.fill();
    bobSilhouette(ctx, 50.5);
    ctx.fillStyle = '#8a5a3a';
    ctx.fill();

    // Face: warm skin with ONE soft outline.
    ctx.beginPath();
    ctx.ellipse(32, 35, 19, 15, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#ffdcc0';
    ctx.fill();
    ctx.strokeStyle = 'rgba(146, 94, 60, 0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Bangs: one scalloped shape in the same brown, joining the cap
    // (top edge follows the face's upper arc, bottom edge is the fringe).
    ctx.beginPath();
    ctx.moveTo(14.2, 29.9);
    ctx.ellipse(32, 35, 19, 15, 0, deg(200), deg(340), false);
    ctx.quadraticCurveTo(46, 38, 42, 32);
    ctx.quadraticCurveTo(37, 40, 32, 31);
    ctx.quadraticCurveTo(27, 40, 22, 32);
    ctx.quadraticCurveTo(18, 38, 14.2, 29.9);
    ctx.closePath();
    ctx.fillStyle = '#8a5a3a';
    ctx.fill();

    // Big eyes with white shine.
    drawEye(ctx, 25, 40);
    drawEye(ctx, 39, 40);

    // Blush.
    ctx.fillStyle = 'rgba(255, 201, 220, 0.95)';
    ctx.beginPath();
    ctx.ellipse(19.5, 44.5, 4, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(44.5, 44.5, 4, 2.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Smile.
    ctx.beginPath();
    ctx.arc(32, 44.5, 5, deg(25), deg(155));
    ctx.strokeStyle = '#a05a3c';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  function drawEye(ctx, cx, cy) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, 4, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#4a3226';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - 1.3, cy - 1.8, 1.7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 1.4, cy + 1.9, 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  /* ------------------------------------------------------------------ *
   * Game + toolbar
   * ------------------------------------------------------------------ */
  var game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent: 'game',
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: '#f3e2c7',
    scene: SpikeScene
  });

  // debug handle for the research spike (inspect via window.__spike)
  window.__spike = { game: game };

  function setActive(group, active) {
    group.forEach(function (b) { b.classList.toggle('active', b === active); });
  }

  (function wireToolbar() {
    var scene = function () { return game.scene.getScene('SpikeScene'); };

    var animButtons = [document.getElementById('btn-stand'),
      document.getElementById('btn-walk'),
      document.getElementById('btn-sitting')];
    animButtons.forEach(function (btn, idx) {
      btn.addEventListener('click', function () {
        var s = scene();
        s.animIndex = idx;
        s.animTime = 0;
        setActive(animButtons, btn);
        s.updateLabel('ok');
      });
    });

    var scaleButtons = [document.getElementById('btn-1x'),
      document.getElementById('btn-3x')];
    scaleButtons.forEach(function (btn, idx) {
      btn.addEventListener('click', function () {
        var s = scene();
        s.quality = (idx === 0) ? 1 : 3;
        setActive(scaleButtons, btn);
        s.updateLabel('ok');
      });
    });

    setActive(animButtons, animButtons[0]);
    setActive(scaleButtons, scaleButtons[0]);
  })();
})();
