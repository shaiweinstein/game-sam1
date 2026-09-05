/* ============================================================
   Lily's Dress-Up Adventure — happy sounds + HUD joy upgrades
   Tiny Web Audio synth (no files, nothing plays before the
   first user gesture, so there are no autoplay warnings).

   Public API (window.GameSounds):
     GameSounds.play(name)   -> 'pop' | 'yummy' | 'travel' | 'cheer' | 'oops'
     GameSounds.muted        -> boolean (read-only)
     GameSounds.toggleMute() -> new muted boolean

   This module is read-only toward game state: it listens to
   GameState.onChange and plays sounds / toggles HUD classes,
   but never changes state and never calls GameUI.setTalk.
   ============================================================ */

(function () {
  "use strict";

  const MUTE_KEY = "lily-sounds-muted";

  let audioCtx = null;
  let muted = false;

  try {
    muted = window.localStorage.getItem(MUTE_KEY) === "true";
  } catch (e) {
    muted = false;
  }

  /* ---------- Lazy AudioContext (created on the FIRST gesture) ---------- */

  function ensureContext() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        audioCtx = new AC();
      } catch (e) {
        return;
      }
    }
    if (audioCtx.state === "suspended") {
      const resuming = audioCtx.resume();
      if (resuming && typeof resuming.catch === "function") {
        resuming.catch(function () {});
      }
    }
  }

  function onFirstGesture() {
    document.removeEventListener("pointerdown", onFirstGesture);
    document.removeEventListener("keydown", onFirstGesture);
    ensureContext();
  }
  document.addEventListener("pointerdown", onFirstGesture);
  document.addEventListener("keydown", onFirstGesture);

  /* ---------- Tiny synth (all sounds <= 0.3s, volume <= 0.15) ---------- */

  function tone(freq, at, duration, type, volume, sweepTo) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (sweepTo) {
      osc.frequency.exponentialRampToValueAtTime(sweepTo, at + duration);
    }
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(at);
    osc.stop(at + duration + 0.03);
  }

  const SOUNDS = {
    /* Dress-up / tab click: quick upward blip */
    pop: function () {
      tone(520, audioCtx.currentTime, 0.09, "sine", 0.12, 900);
    },
    /* Eating a treat: quick two-note chirp */
    yummy: function () {
      const t = audioCtx.currentTime;
      tone(660, t, 0.1, "triangle", 0.12);
      tone(990, t + 0.1, 0.11, "triangle", 0.12);
    },
    /* Travel: short noise sweep through a moving bandpass filter */
    travel: function () {
      const t = audioCtx.currentTime;
      const duration = 0.25;
      const buffer = audioCtx.createBuffer(
        1,
        Math.ceil(audioCtx.sampleRate * duration),
        audioCtx.sampleRate
      );
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 1.2;
      filter.frequency.setValueAtTime(400, t);
      filter.frequency.exponentialRampToValueAtTime(1800, t + duration);
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      source.connect(filter);
      filter.connect(gain);
      gain.connect(audioCtx.destination);
      source.start(t);
      source.stop(t + duration + 0.03);
    },
    /* Arrival: little rising arpeggio */
    cheer: function () {
      const t = audioCtx.currentTime;
      tone(523.25, t, 0.08, "triangle", 0.1);
      tone(659.25, t + 0.06, 0.08, "triangle", 0.1);
      tone(783.99, t + 0.12, 0.08, "triangle", 0.1);
      tone(1046.5, t + 0.18, 0.1, "triangle", 0.1);
    },
    /* Too hungry to travel: gentle low boop, never scary */
    oops: function () {
      tone(220, audioCtx.currentTime, 0.18, "sine", 0.09, 140);
    }
  };

  function play(name) {
    if (muted) return;
    if (!audioCtx) return; // before the first gesture: stay silent, no warnings
    const sound = SOUNDS[name];
    if (!sound) return;
    try {
      sound();
    } catch (e) {
      /* Audio glitches must never break gameplay. */
    }
  }

  /* ---------- Mute toggle (persisted) ---------- */

  function updateToggleButton() {
    const button = document.getElementById("sound-toggle");
    if (!button) return;
    button.textContent = muted ? "🔇" : "🔊";
    button.setAttribute(
      "aria-label",
      muted ? "Sound is off — tap to turn sounds on" : "Sound is on — tap to turn sounds off"
    );
    button.classList.toggle("muted", muted);
  }

  function toggleMute() {
    muted = !muted;
    try {
      window.localStorage.setItem(MUTE_KEY, String(muted));
    } catch (e) {
      /* Storage unavailable — mute still works for this session. */
    }
    updateToggleButton();
    if (!muted) play("pop"); // confirmation pop when unmuting
    return muted;
  }

  /* ---------- HUD joy upgrades (class toggles only) ---------- */

  function updateEnergyClasses(energy) {
    const fill = document.getElementById("energy-bar-fill");
    if (!fill || typeof energy !== "number") return;
    fill.classList.toggle("energy-low", energy <= 30);
    fill.classList.toggle("energy-mid", energy > 30 && energy <= 60);
  }

  let heartTimer = null;

  function heartBurst() {
    const icon = document.querySelector(".energy-icon");
    if (!icon) return;
    icon.classList.remove("heart-burst");
    void icon.offsetWidth; // restart the animation reliably
    icon.classList.add("heart-burst");
    if (heartTimer) window.clearTimeout(heartTimer);
    heartTimer = window.setTimeout(function () {
      icon.classList.remove("heart-burst");
    }, 600);
  }

  /* ---------- Delegated click listeners (light + read-only) ---------- */

  function maybePlayOops(place) {
    const gs = window.GameState;
    if (!gs || typeof gs.canAfford !== "function" || typeof gs.getLocation !== "function") {
      return;
    }
    const placeId = place.getAttribute("data-place-id");
    const location = gs.getLocation();
    if (placeId && location && placeId === location.id) return; // already here: free
    const badge = place.querySelector(".cost-badge");
    if (!badge) return;
    const match = (badge.textContent || "").match(/\d+/);
    if (!match) return;
    const cost = parseInt(match[0], 10);
    if (isNaN(cost)) return;
    if (!gs.canAfford(cost)) {
      window.setTimeout(function () {
        play("oops");
      }, 150);
    }
  }

  function onDocumentClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== "function") return;
    if (target.closest(".wardrobe-item") || target.closest(".wardrobe-tab")) {
      play("pop");
      return;
    }
    const place = target.closest(".place");
    if (place) maybePlayOops(place);
  }

  /* ---------- State listener: sounds + energy bar + heart burst ----------
     GameState.onChange snapshots carry { energy, outfit, location } only,
     so sound choice uses energy direction: in this game energy only goes
     UP from treats ('treat:' reasons) and DOWN from travel spends. */

  let lastEnergy = null;
  let lastLocationId = null;

  function onStateChanged(snapshot) {
    if (!snapshot) return;
    const energy = typeof snapshot.energy === "number" ? snapshot.energy : null;
    updateEnergyClasses(energy);

    if (lastEnergy !== null && energy !== null && energy !== lastEnergy) {
      heartBurst();
      play(energy > lastEnergy ? "yummy" : "travel");
    }

    const locationId = snapshot.location ? snapshot.location.id : null;
    if (lastLocationId !== null && locationId !== null && locationId !== lastLocationId) {
      // Arrival cheer after the travel whoosh.
      window.setTimeout(function () {
        play("cheer");
      }, 300);
    }

    if (energy !== null) lastEnergy = energy;
    if (locationId !== null) lastLocationId = locationId;
  }

  /* ---------- Bootstrap ---------- */

  function init() {
    const button = document.getElementById("sound-toggle");
    if (button) {
      button.addEventListener("click", function () {
        toggleMute();
      });
    }
    updateToggleButton();

    const gs = window.GameState;
    if (gs) {
      const energy = typeof gs.getEnergy === "function" ? gs.getEnergy() : null;
      lastEnergy = energy;
      const location = typeof gs.getLocation === "function" ? gs.getLocation() : null;
      lastLocationId = location ? location.id : null;
      updateEnergyClasses(energy);
      if (typeof gs.onChange === "function") {
        gs.onChange(onStateChanged);
      }
    }

    document.addEventListener("click", onDocumentClick);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.GameSounds = {
    play: play,
    get muted() {
      return muted;
    },
    toggleMute: toggleMute
  };
})();
