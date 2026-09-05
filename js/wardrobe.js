/* ============================================================
   Lily's Dress-Up Adventure — Wardrobe (dress-up) screen
   Renders item buttons from CharacterRenderer.catalog for the
   active category tab. Clicking an item calls
   GameState.setOutfitSlot; Lily auto-refreshes through the
   existing onChange pipeline (character.js), so this file never
   re-renders the character itself.

   Uses window.GameUI.setTalk for cheerful feedback and spawns a
   one-off sparkle burst over the wardrobe character stage.
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Cheerful feedback ---------- */

  /* {name} is replaced with the current friend's name at pick time. */
  const CHEERFUL_MESSAGES = [
    "Ooooh, so pretty! 💕",
    "{name} loves it! ✨",
    "Wow, what a great choice! 🌈",
    "So stylish, {name}! 💖",
    "Ooh la la, fabulous! 🎉",
    "That looks amazing on you! 😍"
  ];

  const SPARKLE_EMOJIS = ["✨", "💖", "🌈", "💫", "🎉"];

  /* Fallback emoji for catalog items missing one (never overrides
     character.js — only used as a safety net here). */
  const FALLBACK_EMOJI = {
    hair: "💇",
    top: "🧥",
    bottom: "🩲",
    shoes: "🥿",
    extra: "💖",
    swimsuit: "🩱"
  };

  let activeSlot = "hair";

  /* ---------- DOM helpers ---------- */

  function getItemGrid() {
    return document.getElementById("wardrobe-items");
  }

  function getStage() {
    return document.getElementById("character-stage-wardrobe");
  }

  /* ---------- Item buttons ---------- */

  function createItemButton(item, itemId, isNoneOption) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wardrobe-item";
    button.dataset.itemId = isNoneOption ? "" : itemId;
    button.dataset.slot = activeSlot;
    if (isNoneOption) button.classList.add("wardrobe-item-none");

    const emoji = document.createElement("span");
    emoji.className = "wardrobe-item-emoji";
    emoji.textContent = isNoneOption
      ? "✨"
      : (item && item.emoji) || FALLBACK_EMOJI[activeSlot] || "💖";

    const name = document.createElement("span");
    name.className = "wardrobe-item-name";
    name.textContent = isNoneOption
      ? "None"
      : (item && item.name) || "Pretty Thing";

    button.appendChild(emoji);
    button.appendChild(name);
    return button;
  }

  function renderItems() {
    const grid = getItemGrid();
    if (!grid) return;
    const catalog = window.CharacterRenderer ? window.CharacterRenderer.catalog : {};
    const slotItems = catalog[activeSlot] || {};

    grid.innerHTML = "";
    if (activeSlot === "extra") {
      // Extras are optional: first button clears the slot.
      grid.appendChild(createItemButton(null, "", true));
    }
    Object.keys(slotItems).forEach(function (itemId) {
      grid.appendChild(createItemButton(slotItems[itemId], itemId, false));
    });
    updateWornMarkers();
  }

  /* Marks the currently worn item's button. Runs on every outfit
     change — it updates classes only, never rebuilds the grid. */
  function updateWornMarkers() {
    const grid = getItemGrid();
    const gameState = window.GameState;
    if (!grid || !gameState || typeof gameState.getOutfit !== "function") return;
    const wornId = gameState.getOutfit()[activeSlot];
    grid.querySelectorAll(".wardrobe-item").forEach(function (button) {
      const isWorn = (button.dataset.itemId || "") === (wornId || "");
      button.classList.toggle("worn", isWorn);
      button.setAttribute("aria-pressed", isWorn ? "true" : "false");
    });
  }

  /* ---------- Sparkle burst ---------- */

  function spawnSparkles() {
    const stage = getStage();
    if (!stage) return;
    const count = 5 + Math.floor(Math.random() * 2); // 5 or 6 sparkles
    for (let i = 0; i < count; i++) {
      const sparkle = document.createElement("span");
      sparkle.className = "wardrobe-sparkle";
      sparkle.textContent = SPARKLE_EMOJIS[Math.floor(Math.random() * SPARKLE_EMOJIS.length)];
      sparkle.style.left = 8 + Math.random() * 84 + "%";
      sparkle.style.top = 10 + Math.random() * 60 + "%";
      sparkle.style.animationDelay = Math.random() * 0.15 + "s";

      let removed = false;
      function remove() {
        if (removed) return;
        removed = true;
        sparkle.removeEventListener("animationend", remove);
        if (sparkle.parentNode === stage) {
          stage.removeChild(sparkle);
        }
      }
      sparkle.addEventListener("animationend", remove);
      // Safety net so nothing lingers if animationend never fires.
      window.setTimeout(remove, 1300);
      stage.appendChild(sparkle);
    }
  }

  /* ---------- Interactions ---------- */

  function onItemClick(button) {
    const gameState = window.GameState;
    if (!gameState || typeof gameState.setOutfitSlot !== "function") return;

    const itemId = button.dataset.itemId;
    gameState.setOutfitSlot(activeSlot, itemId === "" ? null : itemId);

    // Cheerful spoken feedback + happy character.
    const ui = window.GameUI;
    if (ui && typeof ui.setTalk === "function") {
      const template = CHEERFUL_MESSAGES[Math.floor(Math.random() * CHEERFUL_MESSAGES.length)];
      const name = window.GameText ? window.GameText.name() : "Lily";
      ui.setTalk(template.replace("{name}", name));
    }
    const stage = getStage();
    const renderer = window.CharacterRenderer;
    if (stage && renderer && typeof renderer.playAnimation === "function") {
      renderer.playAnimation(stage, Math.random() < 0.5 ? "cheer" : "bounce");
    }
    spawnSparkles();
  }

  /* Swimsuit preview: while the Swimsuits tab is open the dress-up
     character wears ONLY the suit — top/bottom/shoes layers are painted
     empty via CharacterRenderer.setPreviewSkip. Every other tab (and
     every other screen, see the nav hook in init) restores them. */
  const SWIMSUIT_SKIP_LAYERS = ["top", "bottom", "shoes"];

  function applyPreviewSkip() {
    const renderer = window.CharacterRenderer;
    if (renderer && typeof renderer.setPreviewSkip === "function") {
      renderer.setPreviewSkip(
        activeSlot === "swimsuit" ? SWIMSUIT_SKIP_LAYERS : null
      );
    }
  }

  function switchTab(tabButton) {
    const slot = tabButton.dataset.slot;
    if (!slot) return;
    activeSlot = slot;
    applyPreviewSkip();
    document.querySelectorAll(".wardrobe-tab").forEach(function (tab) {
      tab.classList.toggle("active", tab === tabButton);
    });
    renderItems();
    tabPop();
  }

  /* Tiny pop animation on the grid when the category changes. */
  function tabPop() {
    const grid = getItemGrid();
    if (!grid) return;
    grid.classList.remove("tab-pop");
    void grid.offsetWidth; // restart the animation reliably
    grid.classList.add("tab-pop");
  }

  /* ---------- Bootstrap ---------- */

  function init() {
    document.querySelectorAll(".wardrobe-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        switchTab(tab);
      });
    });

    /* Safety: the swimsuit preview skip must NEVER leak to another
       screen (the kitchen/map/friends/beach characters would render
       clothes-less). Screen switches only happen through .nav-button
       clicks (main.js wires those in the bubbling phase), so a
       document-level CAPTURE listener runs first and clears the skip
       before showScreen — and every CharacterRenderer repaint — can
       happen. Returning to the wardrobe screen with the swimsuit tab
       still open re-applies the preview. */
    document.addEventListener("click", function (event) {
      const button = event.target && event.target.closest
        ? event.target.closest(".nav-button")
        : null;
      if (!button) return;
      if (button.dataset.screen === "wardrobe" && activeSlot === "swimsuit") {
        applyPreviewSkip();
      } else {
        const renderer = window.CharacterRenderer;
        if (renderer && typeof renderer.setPreviewSkip === "function") {
          renderer.setPreviewSkip(null);
        }
      }
    }, true);

    const grid = getItemGrid();
    if (grid) {
      // Event delegation: buttons are created dynamically.
      grid.addEventListener("click", function (event) {
        const button = event.target.closest(".wardrobe-item");
        if (button && grid.contains(button)) {
          onItemClick(button);
        }
      });
    }

    renderItems();

    if (window.GameState && typeof window.GameState.onChange === "function") {
      window.GameState.onChange(function () {
        // Worn markers only — Lily herself is re-rendered by character.js.
        updateWornMarkers();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
