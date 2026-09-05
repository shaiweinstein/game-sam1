/* ============================================================
   Lily's Dress-Up Adventure — Kitchen screen
   Lets the player feed Lily yummy food and drinks. Every treat
   ADDS energy (food never costs anything). Tapping an item:
     1. Calls GameState.changeEnergy(+energy, 'treat:<id>')
     2. Plays Lily's 'eat' animation on the kitchen stage
     3. Floats a "+5 💛" indicator that is removed after animating
     4. Flies the food emoji toward Lily (removed after animating)
     5. Shows a cheerful talk-bubble message

   Uses window.GameUI.setTalk for feedback. The energy HUD updates
   itself through the existing GameState -> GameUI pipeline.
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Food menu (exactly these 8 items) ---------- */

  const FOOD_MENU = [
    { id: "apple",    emoji: "🍎", name: "Apple",      energy: 5,  kind: "food"  },
    { id: "banana",   emoji: "🍌", name: "Banana",     energy: 5,  kind: "food"  },
    { id: "sandwich", emoji: "🥪", name: "Sandwich",   energy: 10, kind: "food"  },
    { id: "pancakes", emoji: "🥞", name: "Pancakes",   energy: 15, kind: "food"  },
    { id: "soup",     emoji: "🍲", name: "Yummy Soup", energy: 15, kind: "food"  },
    { id: "water",    emoji: "💧", name: "Water",      energy: 5,  kind: "drink" },
    { id: "juice",    emoji: "🧃", name: "Juice",      energy: 10, kind: "drink" },
    { id: "smoothie", emoji: "🥤", name: "Smoothie",   energy: 10, kind: "drink" }
  ];

  /* Cheerful feedback after eating. */
  const YUMMY_MESSAGES = [
    "Yummy! Thank you! 😋",
    "So tasty! More please! 💛",
    "Delicious! I feel stronger! 💪",
    "Nom nom nom! 🍽️",
    "That hit the spot! 🎉",
    "Mmm, my favorite! 😊"
  ];

  /* Special message when the energy bar is exactly full. Built at
     call time so it names the currently chosen friend. */
  function fullMessage() {
    const name = window.GameText ? window.GameText.name() : "Lily";
    return name + " is FULL of energy! 💛💛💛";
  }

  /* Safety timeout for cleaning float/fly elements if animationend
     never fires (e.g. reduced motion). Slightly longer than the
     longest CSS animation (1.1s). */
  const CLEANUP_TIMEOUT_MS = 1600;

  /* ---------- DOM helpers ---------- */

  function getMenu() {
    return document.getElementById("food-menu");
  }

  function getStage() {
    return document.getElementById("character-stage-kitchen");
  }

  /* ---------- Menu buttons ---------- */

  function createMenuButton(item) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "food-item";
    button.dataset.foodId = item.id;
    button.dataset.energy = String(item.energy);

    const emoji = document.createElement("span");
    emoji.className = "food-item-emoji";
    emoji.textContent = item.emoji;

    const name = document.createElement("span");
    name.className = "food-item-name";
    name.textContent = item.name;

    const chip = document.createElement("span");
    chip.className = "energy-chip";
    chip.textContent = "+" + item.energy;

    button.appendChild(emoji);
    button.appendChild(name);
    button.appendChild(chip);
    return button;
  }

  function renderMenu() {
    const menu = getMenu();
    if (!menu) return;
    menu.innerHTML = "";
    FOOD_MENU.forEach(function (item) {
      menu.appendChild(createMenuButton(item));
    });
  }

  /* ---------- Floating "+N 💛" indicator ---------- */

  function spawnEnergyFloat(button, energy) {
    const stage = getStage();
    if (!stage) return;
    const float = document.createElement("span");
    float.className = "energy-float";
    float.textContent = "+" + energy + " 💛";
    // Pop it above Lily so it drifts up from her.
    float.style.left = "50%";
    float.style.top = "20%";

    let removed = false;
    function remove() {
      if (removed) return;
      removed = true;
      float.removeEventListener("animationend", remove);
      if (float.parentNode === stage) {
        stage.removeChild(float);
      }
    }
    float.addEventListener("animationend", remove);
    // Safety net so nothing lingers if animationend never fires.
    window.setTimeout(remove, CLEANUP_TIMEOUT_MS);
    stage.appendChild(float);
  }

  /* ---------- Food emoji flying to Lily's mouth ---------- */

  function spawnFoodFly(button) {
    const stage = getStage();
    const menu = getMenu();
    if (!stage || !menu) return;

    const foodId = button.dataset.foodId;
    const item = FOOD_MENU.find(function (f) { return f.id === foodId; });
    if (!item) return;

    // Position the emoji over the menu's grid, then animate it up
    // toward the stage center with the .food-fly keyframes.
    const fly = document.createElement("span");
    fly.className = "food-fly";
    fly.textContent = item.emoji;
    const rect = button.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    fly.style.left = rect.left - menuRect.left + rect.width / 2 + "px";
    fly.style.top = rect.top - menuRect.top + "px";
    fly.style.transform = "translate(-50%, 0)";

    let removed = false;
    function remove() {
      if (removed) return;
      removed = true;
      fly.removeEventListener("animationend", remove);
      if (fly.parentNode === menu) {
        menu.removeChild(fly);
      }
    }
    fly.addEventListener("animationend", remove);
    // Safety net so nothing lingers if animationend never fires.
    window.setTimeout(remove, CLEANUP_TIMEOUT_MS);
    menu.appendChild(fly);
  }

  /* ---------- Interactions ---------- */

  function pickRandomMessage() {
    return YUMMY_MESSAGES[Math.floor(Math.random() * YUMMY_MESSAGES.length)];
  }

  function onFoodClick(button) {
    const gameState = window.GameState;
    if (!gameState || typeof gameState.changeEnergy !== "function") return;

    const energy = parseInt(button.dataset.energy, 10) || 0;
    const foodId = button.dataset.foodId;

    // Energy ALWAYS goes up here — food never costs anything.
    const newEnergy = gameState.changeEnergy(energy, "treat:" + foodId);

    // Lily munches (head-bob animation).
    const stage = getStage();
    const renderer = window.CharacterRenderer;
    if (stage && renderer && typeof renderer.playAnimation === "function") {
      renderer.playAnimation(stage, "eat");
    }

    // Floating "+N 💛" and the food emoji flying to Lily.
    spawnEnergyFloat(button, energy);
    spawnFoodFly(button);

    // Cheerful feedback. At exactly 100 energy use a special message.
    const ui = window.GameUI;
    if (ui && typeof ui.setTalk === "function") {
      ui.setTalk(newEnergy === 100 ? fullMessage() : pickRandomMessage());
    }
  }

  /* ---------- Bootstrap ---------- */

  function init() {
    const menu = getMenu();
    if (menu) {
      // Event delegation: buttons are created dynamically.
      menu.addEventListener("click", function (event) {
        const button = event.target.closest(".food-item");
        if (button && menu.contains(button)) {
          onFoodClick(button);
        }
      });
    }
    renderMenu();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
