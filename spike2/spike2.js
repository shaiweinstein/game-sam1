/* DragonBonesJS x Phaser 3.90 — M0 pipeline spike.
 *
 * Proves the end-to-end chain: vendored DragonBones runtime
 * (lib/dbjs/dragonBones.min.js, DragonBonesJS 5.7 core + official Phaser 3
 * plugin) loads a hand-crafted DragonBones 5.5 JSON armature
 * (assets/girl.json + assets/girl_tex.json + assets/girl.png) through the
 * plugin's loader extension, plays it on a real Phaser 3 scene, and lets us
 * swap animations + flip facing at runtime.
 *
 * Plugin API used (see lib/dbjs/README.md for details):
 *   - scene plugin:  dragonBones.phaser.plugin.DragonBonesScenePlugin
 *   - loader:        this.load.dragonbone(key, textureURL, atlasURL, boneURL)
 *   - factory:       this.add.armature(armatureName, dragonBonesName)
 *   - animation:     display.animation.play(name)
 *   - flip:          display.scaleX = -scale  (ArmatureDisplay is a Container)
 *
 * The scene plugin drives the DragonBones WorldClock every frame, so no
 * manual per-frame update is needed here.
 *
 * Vanilla JS, IIFE, 'use strict'. No modules, no bundler.
 */
(function () {
  'use strict';

  var CANVAS_W = 600;
  var CANVAS_H = 400;
  var DB_KEY = 'girl';
  var ARMATURE_NAME = 'girl';
  var SCALE = 1.6;      // the rig is ~200px tall in data units
  var GROUND_Y = 340;   // screen y of the feet (armature origin) when walking
  var SWIM_Y = 350;
  var SWIM_X_OFFSET = 130; // body lies out to the facing side; recenter it

  /* ------------------------------------------------------------------ */
  /* Scene                                                             */
  /* ------------------------------------------------------------------ */
  function SpikeScene() {
    Phaser.Scene.call(this, { key: 'SpikeScene' });
  }
  SpikeScene.prototype = Object.create(Phaser.Scene.prototype);
  SpikeScene.prototype.constructor = SpikeScene;

  SpikeScene.prototype.preload = function () {
    // Loader extension registered by the scene plugin ("dragonbone" file
    // type). Arg order: key, texture atlas PNG, atlas JSON, skeleton JSON.
    this.load.dragonbone(DB_KEY, 'assets/girl.png', 'assets/girl_tex.json', 'assets/girl.json');
  };

  SpikeScene.prototype.create = function () {
    this.state = { anim: 'walk', facing: 1, ready: false };
    this.display = null;

    this.bg = this.add.rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0xbfe3f2);
    this.ground = this.add.rectangle(CANVAS_W / 2, CANVAS_H - 30, CANVAS_W, 60, 0xf0d9a8);

    try {
      this.display = this.add.armature(ARMATURE_NAME, DB_KEY);
    } catch (e) {
      this.fail('createArmature threw: ' + e.message);
      return;
    }
    if (!this.display) {
      this.fail('armature not found: ' + ARMATURE_NAME + ' (in dragonBones data "' + DB_KEY + '")');
      return;
    }

    this.display.setScale(SCALE);
    this.setAnim('walk', true);
    this.state.ready = true;
    this.updateLabel();
  };

  /* Switch the playing animation and re-place the character so it stays
   * centered (swim lies out to the facing side from the armature origin). */
  SpikeScene.prototype.setAnim = function (name, keepTime) {
    if (!this.display) { return; }
    this.state.anim = name;
    this.display.animation.play(name);
    this.applyPose();
    this.updateLabel();
  };

  SpikeScene.prototype.flipFacing = function () {
    if (!this.display) { return; }
    this.state.facing *= -1;
    this.display.scaleX = SCALE * this.state.facing;
    this.display.scaleY = SCALE;
    this.applyPose();
    this.updateLabel();
  };

  SpikeScene.prototype.applyPose = function () {
    var swim = this.state.anim === 'swim';
    this.display.y = swim ? SWIM_Y : GROUND_Y;
    this.display.x = swim
      ? CANVAS_W / 2 - SWIM_X_OFFSET * this.state.facing
      : CANVAS_W / 2;

    if (swim) {
      this.bg.setFillStyle(0x8fc9e8);
      this.ground.setFillStyle(0x4aa3df);
      this.ground.setY(CANVAS_H - 14);
    } else {
      this.bg.setFillStyle(0xbfe3f2);
      this.ground.setFillStyle(0xf0d9a8);
      this.ground.setY(CANVAS_H - 30);
    }
  };

  SpikeScene.prototype.fail = function (msg) {
    this.state.ready = false;
    this.updateLabel();
    this.add.text(CANVAS_W / 2, CANVAS_H / 2, 'load error\n' + msg, {
      fontFamily: 'Menlo, monospace', fontSize: '13px', color: '#c0392b', align: 'center'
    }).setOrigin(0.5);
  };

  SpikeScene.prototype.updateLabel = function () {
    var el = document.getElementById('state-label');
    if (!el) { return; }
    if (!this.state.ready) {
      el.textContent = this.display ? this.state.anim : 'load error — see canvas';
      return;
    }
    var anim = this.display.animation;
    var cur = anim.name && anim.name !== '' ? anim.name : this.state.anim;
    el.textContent = ARMATURE_NAME + ' · ' + cur + ' · ' + SCALE + 'x · facing ' +
      (this.state.facing > 0 ? 'right' : 'left');
  };

  /* ------------------------------------------------------------------ */
  /* Game + toolbar                                                     */
  /* ------------------------------------------------------------------ */
  // NOTE: this project's vendored Phaser 3.90 build is patched with an extra
  // render type (AUTO:0, CANVAS:1, WEBGL:2, HEADLESS:3 — see spike2/NOTES.md).
  // Do NOT pass WEBGL|CANVAS here: 3 is HEADLESS in this build and the game
  // runs without a renderer.
  //
  // CANVAS is used on purpose, not just because WebGL is flaky in headless
  // browsers: in this patched build the WebGL `TextureTintPipeline` class is
  // not exposed on the global, so the DragonBones plugin's pipeline (which
  // inherits from it) only gets the inert stub from the compat shim in
  // index.html. Its `batchSprite` then crashes on `this.renderer.setPipeline`
  // for every slot sprite (all slots call setPipeline("PhaserTextureTintPipeline")
  // in their constructors). Under CANVAS the scene plugin skips pipeline
  // registration entirely (guarded by renderType === Phaser.WEBGL), the slot
  // setPipeline calls become no-ops in this build, and canvas 2D rendering
  // ignores sprite.pipeline. Plain (untinted) armatures render identically.
  // See spike2/NOTES.md → "Phaser 3.90 patched-build quirks".
  var game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent: 'game',
    width: CANVAS_W,
    height: CANVAS_H,
    backgroundColor: '#bfe3f2',
    plugins: {
      scene: [
        {
          key: 'DragonBones',
          plugin: dragonBones.phaser.plugin.DragonBonesScenePlugin,
          mapping: 'dragonbone'
        }
      ]
    },
    scene: SpikeScene
  });

  // debug handle for the spike (animation state, fps sampling, etc.)
  window.__spike2 = { game: game };

  function setActive(group, active) {
    group.forEach(function (b) { b.classList.toggle('active', b === active); });
  }

  // Resolve the scene lazily: at script-load time the scene is not yet
  // registered in the scene manager's key map, so getScene() called here
  // would return null (a captured null would break every button).
  function getSpikeScene() {
    return game.scene.getScene('SpikeScene');
  }

  var animButtons = [document.getElementById('btn-walk'), document.getElementById('btn-swim')];

  document.getElementById('btn-walk').addEventListener('click', function () {
    var sc = getSpikeScene();
    if (sc) { sc.setAnim('walk'); }
    setActive(animButtons, this);
  });
  document.getElementById('btn-swim').addEventListener('click', function () {
    var sc = getSpikeScene();
    if (sc) { sc.setAnim('swim'); }
    setActive(animButtons, this);
  });
  document.getElementById('btn-flip').addEventListener('click', function () {
    var sc = getSpikeScene();
    if (sc) { sc.flipFacing(); }
  });
  setActive(animButtons, document.getElementById('btn-walk'));
})();
