/* ============================================================
   Lily's Dress-Up Adventure — shared game state + energy system
   Single source of truth for energy, outfit, chosen friend
   (characterId), and map location.
   Other game modules use window.GameState:

     GameState.get()                  -> full state snapshot
     GameState.getEnergy()            -> number 0-100
     GameState.changeEnergy(delta, reason) -> new energy
     GameState.setEnergy(value)       -> new energy
     GameState.canAfford(cost)        -> boolean
     GameState.spend(cost)            -> new energy, or null if unaffordable
       GameState.getOutfit()            -> { hair, top, bottom, shoes, extra, swimsuit }
      GameState.setOutfitSlot(slot, itemId)
      GameState.getCharacter()         -> { id, name } (resolved via window.CHARACTERS)
      GameState.setCharacterId(id)
      GameState.getLocation()          -> { id, name }
     GameState.setLocation(id, name)
     GameState.onChange(callback)     -> unsubscribe function
     GameState.reset()

   Energy semantics: no decay, no death. 0 energy just means
   "too hungry to travel" — nothing bad happens.
   ============================================================ */

(function () {
  "use strict";

  const STORAGE_KEY = "lily-game-save-v1";

  /* ---------- Default state ---------- */

  const DEFAULTS = {
    energy: 50,
    characterId: "lily",
    outfit: {
      hair: "hair1",
      top: "top1",
      bottom: "bottom1",
      shoes: "shoes1",
      extra: null,
      swimsuit: "suit1"
    },
    location: {
      id: "home",
      name: "🏠 Home"
    }
  };

  /* Old saves simply have no "swimsuit" key — the OUTFIT_SLOTS merge in
     load() leaves the suit1 default in place (that IS the migration). */
  const OUTFIT_SLOTS = ["hair", "top", "bottom", "shoes", "extra", "swimsuit"];

  /* ---------- Internal state (module owns it) ---------- */

  let state = cloneDefaults();

  function cloneDefaults() {
    return {
      energy: DEFAULTS.energy,
      characterId: DEFAULTS.characterId,
      outfit: Object.assign({}, DEFAULTS.outfit),
      location: Object.assign({}, DEFAULTS.location)
    };
  }

  function clamp(value) {
    const n = Math.round(Number(value));
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(100, n));
  }

  /* ---------- Persistence (defensive: file:// / private mode) ---------- */

  function save() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          energy: state.energy,
          characterId: state.characterId,
          outfit: Object.assign({}, state.outfit),
          location: Object.assign({}, state.location)
        })
      );
    } catch (e) {
      /* Storage unavailable (file:// or private mode) — just keep playing in memory. */
    }
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      if (typeof data.energy === "number") {
        state.energy = clamp(data.energy);
      }
      // Old saves (pre-characters) simply have no characterId — the
      // default 'lily' stays. Unknown ids fall back at getCharacter().
      if (typeof data.characterId === "string" && data.characterId) {
        state.characterId = data.characterId;
      }
      if (data.outfit && typeof data.outfit === "object") {
        OUTFIT_SLOTS.forEach(function (slot) {
          var v = data.outfit[slot];
          if (slot === "extra") {
            // extra is optional; a stored null/undefined means "nothing".
            if (v !== undefined) state.outfit[slot] = v || null;
          } else if (typeof v === "string" && v) {
            // Non-extra slots must be a real string id — a stray saved
            // null/number (or the old buggy clear path) is ignored so the
            // DEFAULTS value (e.g. swimsuit 'suit1') survives: self-heal.
            state.outfit[slot] = v;
          }
        });
      }
      if (data.location && typeof data.location === "object") {
        if (typeof data.location.id === "string" && data.location.id) {
          state.location.id = data.location.id;
          state.location.name =
            typeof data.location.name === "string" && data.location.name
              ? data.location.name
              : data.location.id;
        }
      }
    } catch (e) {
      /* Corrupt or blocked save — fall back to defaults. */
    }
  }

  /* ---------- Listeners ---------- */

  const listeners = [];

  function notify(reason) {
    const snapshot = getSnapshot();
    listeners.forEach(function (cb) {
      try {
        // Reset can leave the same values; ephemeral UI history still expires.
        cb(snapshot, reason);
      } catch (e) {
        /* A broken listener must never break the game loop. */
      }
    });
  }

  function getSnapshot() {
    return {
      energy: state.energy,
      characterId: state.characterId,
      outfit: Object.assign({}, state.outfit),
      location: Object.assign({}, state.location)
    };
  }

  /* ---------- HUD sync (drives GameUI, defensively) ---------- */

  function syncHud() {
    const ui = window.GameUI;
    if (ui && typeof ui.setEnergy === "function") {
      ui.setEnergy(state.energy);
    }
  }

  /* ---------- Public API ---------- */

  function get() {
    return getSnapshot();
  }

  function getEnergy() {
    return state.energy;
  }

  function setEnergy(value, reason) {
    state.energy = clamp(value);
    save();
    syncHud();
    notify();
    return state.energy;
  }

  function changeEnergy(delta, reason) {
    // Apply the raw delta, then clamp the RESULT (not the delta) to 0..100,
    // so negative deltas like -10 work correctly.
    let d = Number(delta);
    if (isNaN(d)) d = 0;
    return setEnergy(state.energy + d, reason);
  }

  function canAfford(cost) {
    const c = clamp(cost);
    return state.energy >= c;
  }

  function spend(cost) {
    if (!canAfford(cost)) return null;
    return setEnergy(state.energy - clamp(cost));
  }

  function getOutfit() {
    return Object.assign({}, state.outfit);
  }

  /* Which girl the player is playing as. Resolved lazily against
     window.CHARACTERS (state.js loads before character.js, so the
     map may not exist yet at module init). Missing/unknown ids —
     including a save from before characters existed — fall back to Lily. */
  function getCharacter() {
    const id = state.characterId;
    const chars = window.CHARACTERS;
    if (typeof id === "string" && id && chars && chars[id] && chars[id].name) {
      return { id: id, name: chars[id].name };
    }
    return { id: "lily", name: "Lily" };
  }

  function setCharacterId(id) {
    if (typeof id !== "string" || !id) return;
    const chars = window.CHARACTERS;
    const known = !!(chars && Object.prototype.hasOwnProperty.call(chars, id));
    // 'lily' is always accepted (safe default); anything else must exist.
    if (!known && id !== "lily") return;
    if (state.characterId === id) return;
    state.characterId = id;
    save();
    notify();
  }

  function setOutfitSlot(slot, itemId) {
    if (OUTFIT_SLOTS.indexOf(slot) === -1) return;
    /* Non-extra slots ALWAYS hold a string item id. Reject null/undefined
       (and empty/non-string junk) so a stray clear can never persist —
       a saved null here would win over the DEFAULTS outfit on load
       (load() treats stored values as authoritative) and desync the
       wardrobe SVG from the beach rig. */
    if (slot !== "extra") {
      if (typeof itemId !== "string" || !itemId) return;
      state.outfit[slot] = itemId;
    } else {
      state.outfit[slot] = itemId || null;
    }
    save();
    notify();
  }

  function getLocation() {
    return Object.assign({}, state.location);
  }

  function setLocation(locationId, locationName) {
    if (typeof locationId !== "string" || !locationId) return;
    state.location.id = locationId;
    state.location.name =
      typeof locationName === "string" && locationName ? locationName : locationId;
    save();
    notify();
  }

  function onChange(callback) {
    if (typeof callback !== "function") {
      return function noopUnsubscribe() {};
    }
    listeners.push(callback);
    return function unsubscribe() {
      const index = listeners.indexOf(callback);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  function reset() {
    state = cloneDefaults();
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* Storage unavailable — ignore. */
    }
    syncHud();
    notify("reset");
  }

  /* ---------- Bootstrap ---------- */

  load();
  syncHud();

  // GameUI may not exist yet when this deferred module runs
  // (main.js loads after state.js), so re-sync the HUD once the DOM is ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncHud);
  }

  window.GameState = {
    get: get,
    getEnergy: getEnergy,
    changeEnergy: changeEnergy,
    setEnergy: setEnergy,
    canAfford: canAfford,
    spend: spend,
    getOutfit: getOutfit,
    setOutfitSlot: setOutfitSlot,
    getCharacter: getCharacter,
    setCharacterId: setCharacterId,
    getLocation: getLocation,
    setLocation: setLocation,
    onChange: onChange,
    reset: reset
  };
})();
