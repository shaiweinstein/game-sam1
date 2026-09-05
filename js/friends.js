/* ============================================================
   Lily's Dress-Up Adventure — Friends screen (character picker)
   Shows one card per friend (window.CHARACTERS). Each card holds a
   small live preview rendered with the OPTIONAL per-instance
   override documented in character.js:

     CharacterRenderer.render(stage, { size, characterId })

   Without the override every registered instance paints the
   globally chosen friend — so all previews would look identical.
   With it, each card always shows ITS OWN girl, while all four
   wear the current shared outfit (delightful and consistent).

    Tapping a card calls GameState.setCharacterId; character.js then
    re-renders the wardrobe/kitchen stages and the map marker with
    the new skin + hair colors. This file only manages the cards.

    It also owns the tiny window.GameText helper that keeps every
    `data-char-name` placeholder in index.html in sync with the
    currently chosen friend, live:

      GameText.name()    -> current friend's display name
      GameText.refresh() -> re-paint all data-char-name elements
   ============================================================ */

(function () {
  "use strict";

  /* ---------- DOM helpers ---------- */

  function getGrid() {
    return document.getElementById("friends-grid");
  }

  function getCharacterIds() {
    const chars = window.CHARACTERS;
    if (!chars) return ["lily"];
    const ids = Object.keys(chars);
    return ids.length ? ids : ["lily"];
  }

  function getName(characterId) {
    const chars = window.CHARACTERS;
    return (chars && chars[characterId] && chars[characterId].name) || "Lily";
  }

  /* ---------- Dynamic name copy (window.GameText) ---------- */

  /* Repaints every static `data-char-name` placeholder in index.html
     with the currently chosen friend's name. Runs once on init (so a
     persisted choice is correct on first paint) and on every
     GameState change, so copy like "Dress Up Lily!" switches live. */
  function refreshCharNames() {
    const gs = window.GameState;
    if (!gs || typeof gs.getCharacter !== "function") return;
    const name = gs.getCharacter().name;
    document.querySelectorAll("[data-char-name]").forEach(function (el) {
      el.textContent = name;
    });
  }

  /* ---------- Cards ---------- */

  function createCard(characterId) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "friend-card";
    card.dataset.characterId = characterId;

    const stage = document.createElement("div");
    stage.className = "friend-stage character-stage";

    const name = document.createElement("span");
    name.className = "friend-card-name";
    name.textContent = getName(characterId);

    card.appendChild(stage);
    card.appendChild(name);

    card.addEventListener("click", function () {
      chooseFriend(characterId, stage);
    });

    return { card: card, stage: stage };
  }

  function chooseFriend(characterId, stage) {
    const gs = window.GameState;
    if (!gs || typeof gs.setCharacterId !== "function") return;
    gs.setCharacterId(characterId);

    const ui = window.GameUI;
    if (ui && typeof ui.setTalk === "function") {
      ui.setTalk("Hi! I'm " + getName(characterId) + "! 👋");
    }
    // setCharacterId notified synchronously above, so the preview SVGs
    // have already been re-rendered and playAnimation finds fresh nodes.
    const renderer = window.CharacterRenderer;
    if (stage && renderer && typeof renderer.playAnimation === "function") {
      renderer.playAnimation(stage, "cheer");
    }
  }

  /* Marks the card for whoever is chosen globally right now. */
  function updateChosenMarkers() {
    const gs = window.GameState;
    const grid = getGrid();
    if (!grid || !gs || typeof gs.getCharacter !== "function") return;
    const currentId = gs.getCharacter().id;
    grid.querySelectorAll(".friend-card").forEach(function (card) {
      const isChosen = card.dataset.characterId === currentId;
      card.classList.toggle("chosen", isChosen);
      card.setAttribute("aria-pressed", isChosen ? "true" : "false");
    });
  }

  /* ---------- Bootstrap ---------- */

  function init() {
    // Paint the copy before anything else, so a persisted friend choice
    // is reflected on first render (not only after a change event).
    refreshCharNames();

    const grid = getGrid();
    if (!grid) return;

    getCharacterIds().forEach(function (characterId) {
      const built = createCard(characterId);
      grid.appendChild(built.card);
      // Preview: this instance always paints ITS OWN friend.
      if (window.CharacterRenderer) {
        window.CharacterRenderer.render(built.stage, {
          size: "small",
          characterId: characterId
        });
      }
    });

    updateChosenMarkers();

    if (window.GameState && typeof window.GameState.onChange === "function") {
      // Previews refresh themselves via the renderer registry; here we
      // only keep the "chosen" badge in sync (also covers reset()).
      window.GameState.onChange(updateChosenMarkers);
      // Live copy: any state change (friend switch, welcome reset) repaints
      // the data-char-name placeholders.
      window.GameState.onChange(refreshCharNames);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Shared helper so other modules build JS-side copy with the current name.
  window.GameText = {
    name: function () {
      const gs = window.GameState;
      return gs && typeof gs.getCharacter === "function" ? gs.getCharacter().name : "Lily";
    },
    refresh: refreshCharNames
  };
})();
