/* D0 motion-quality demo.
 *
 * One canvas, three armatures side by side at 1.6x:
 *   [OLD walk]  the M0 spike rig (girl.json) — 4-segment limbs, pendulum swings
 *   [NEW walk]  the extended jointed rig (girl2.json) — 14 bones, shaped gait
 *   [NEW swim]  the same rig doing a front-crawl stroke + flutter kick
 *
 * Both rigs run through the exact same pipeline proven in M0:
 *   load.dragonbone -> add.armature -> animation.play
 * The only difference between the panels is the JSON animation data.
 *
 * Controls: Pause (freezes the DragonBones clock), Slow-mo (timeScale 0.25).
 * `window.__demo` exposes the game + a lazy scene getter for the Playwright
 * verification scripts (seekAll() is used for frame-accurate GIF capture).
 *
 * Vanilla JS, IIFE, 'use strict'. No modules, no bundler.
 */
(function () {
  'use strict';

  var CANVAS_W = 1080;
  var CANVAS_H = 420;
  var SCALE = 1.6;

  var P1_X = 180, P2_X = 540, P3_X = 900;   // panel centers
  var WALK_Y = 356;                          // screen y of the feet (armature origin)
  var SWIM_OX = 735, SWIM_OY = 252;          // swim origin (feet pivot; body lies out to +X at ~80 deg)
  var CYCLE_S = 1.0;                         // both animations are 24 frames @ 24 fps

  var LABEL_STYLE = {
    fontFamily: 'Menlo, Consolas, monospace',
    fontSize: '15px',
    color: '#243b4a',
    fontStyle: 'bold'
  };

  /* ------------------------------------------------------------------ */
  /* Scene                                                              */
  /* ------------------------------------------------------------------ */
  function DemoScene() {
    Phaser.Scene.call(this, { key: 'DemoScene' });
  }
  DemoScene.prototype = Object.create(Phaser.Scene.prototype);
  DemoScene.prototype.constructor = DemoScene;

  DemoScene.prototype.preload = function () {
    // Loader extension registered by the scene plugin. Arg order:
    // key, texture atlas PNG, atlas JSON, skeleton JSON.
    this.load.dragonbone('girl', 'assets/girl.png', 'assets/girl_tex.json', 'assets/girl.json');
    this.load.dragonbone('girl2', 'assets/girl2.png', 'assets/girl2_tex.json', 'assets/girl2.json');
  };

  DemoScene.prototype.create = function () {
    this.state = { paused: false, slow: false, ready: false };
    this.displays = [];

    // background
    this.add.rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0xbfe3f2);
    // ground (walk panels) + water (swim panel)
    this.add.rectangle(360, 388, 720, 64, 0xf0d9a8);
    this.add.rectangle(900, 327, 360, 185, 0x4aa3df);
    // panel dividers
    this.add.rectangle(360, CANVAS_H / 2, 2, CANVAS_H, 0x9fb8c8);
    this.add.rectangle(720, CANVAS_H / 2, 2, CANVAS_H, 0x9fb8c8);
    // labels
    this.add.text(P1_X, 12, 'OLD walk (M0)', LABEL_STYLE).setOrigin(0.5);
    this.add.text(P2_X, 12, 'NEW walk (D0)', LABEL_STYLE).setOrigin(0.5);
    this.add.text(P3_X, 12, 'NEW swim (D0)', LABEL_STYLE).setOrigin(0.5);

    function fail(msg) {
      this.state.ready = false;
      this.add.text(CANVAS_W / 2, 210, 'load error\n' + msg, {
        fontFamily: 'Menlo, monospace', fontSize: '13px', color: '#c0392b', align: 'center'
      }).setOrigin(0.5);
    }

    try {
      var d1 = this.add.armature('girl', 'girl');        // old rig, walk
      var d2 = this.add.armature('girl2', 'girl2');      // new rig, walk
      var d3 = this.add.armature('girl2', 'girl2');      // new rig, swim
    } catch (e) {
      fail.call(this, 'createArmature threw: ' + e.message);
      return;
    }
    if (!d1 || !d2 || !d3) {
      fail.call(this, 'armature not found');
      return;
    }

    d1.setScale(SCALE);
    d1.setPosition(P1_X, WALK_Y);
    d1.animation.play('walk');

    d2.setScale(SCALE);
    d2.setPosition(P2_X, WALK_Y);
    d2.animation.play('walk');

    d3.setScale(SCALE);
    d3.setPosition(SWIM_OX, SWIM_OY);
    d3.animation.play('swim');

    this.displays = [d1, d2, d3];
    this.state.ready = true;
    this.updateLabel();
  };

  /* Pause: freezing the Phaser scene also freezes the DragonBones
   * WorldClock, because the scene plugin advances it from the scene's
   * 'update' event (which no longer fires while paused). */
  DemoScene.prototype.setPaused = function (p) {
    if (this.state.paused === p) { return; }
    this.state.paused = p;
    if (p) { this.game.pause(); } else { this.game.resume(); }
    this.updateLabel();
  };

  /* Slow-mo: timeScale on each armature's Animation slows every timeline. */
  DemoScene.prototype.setSlowMo = function (on) {
    this.state.slow = on;
    var ts = on ? 0.25 : 1.0;
    this.displays.forEach(function (d) { d.animation.timeScale = ts; });
    this.updateLabel();
  };

  /* Seek every display to the same cycle position (seconds, 0..CYCLE_S).
   * Used by the capture script for a seamless 24-frame GIF. The plugin's
   * next frame advance adds a small consistent offset, which is fine. */
  DemoScene.prototype.seekAll = function (t) {
    var time = ((t % CYCLE_S) + CYCLE_S) % CYCLE_S;
    this.displays.forEach(function (d) {
      var states = d.animation._animationStates;
      if (states && states.length > 0) { states[0].currentTime = time; }
    });
  };

  DemoScene.prototype.updateLabel = function () {
    var el = document.getElementById('state-label');
    if (!el) { return; }
    if (!this.state.ready) { el.textContent = 'load error'; return; }
    var bits = [];
    bits.push(this.state.paused ? 'PAUSED' : 'playing');
    bits.push(this.state.slow ? 'slow-mo 0.25x' : '1.0x');
    el.textContent = bits.join(' · ');
  };

  DemoScene.prototype.update = function () {
    // 1 fps sample per second for the toolbar
    this._fpsCount = (this._fpsCount || 0) + 1;
    var now = performance.now();
    if (!this._fpsLast) { this._fpsLast = now; }
    if (now - this._fpsLast >= 1000) {
      var el = document.getElementById('fps-label');
      if (el) {
        var fps = Math.round(this._fpsCount * 1000 / (now - this._fpsLast));
        el.textContent = fps + ' fps';
      }
      this._fpsCount = 0;
      this._fpsLast = now;
    }
  };

  /* ------------------------------------------------------------------ */
  /* Game + toolbar                                                      */
  /* ------------------------------------------------------------------ */
  // CANVAS on purpose: this patched Phaser build's WebGL path is broken for
  // the DragonBones tint pipeline (see spike2/NOTES.md section 5).
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
    scene: DemoScene
  });

  // debug/verification handle (lazy scene resolution — quirk #6 in NOTES.md)
  window.__demo = {
    game: game,
    scene: function () { return game.scene.getScene('DemoScene'); }
  };

  document.getElementById('btn-pause').addEventListener('click', function () {
    var sc = window.__demo.scene();
    if (sc) { sc.setPaused(!sc.state.paused); }
    this.classList.toggle('active', sc && sc.state.paused);
  });
  document.getElementById('btn-slow').addEventListener('click', function () {
    var sc = window.__demo.scene();
    if (sc) { sc.setSlowMo(!sc.state.slow); }
    this.classList.toggle('active', sc && sc.state.slow);
  });
})();
