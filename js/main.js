/* ============================================================
   Lily's Dress-Up Adventure — game shell bootstrap
   Screen navigation, talk bubble, and energy HUD.
   Other game modules can use window.GameUI:
     GameUI.showScreen('wardrobe' | 'kitchen' | 'map')
     GameUI.setTalk('message')
     GameUI.setEnergy(0-100)
   ============================================================ */

(function () {
  "use strict";

  const DEFAULT_TALK = "Hello! Let's play! 💕";

  let activeScreen = null;
  let returnToBeach = false;

  /* ---------- Talk bubble ---------- */

  function setTalk(text) {
    const bubble = document.getElementById("talk-bubble");
    if (!bubble) return;
    bubble.textContent = text;
    // Re-trigger the pop animation by toggling the class.
    bubble.classList.remove("pop");
    // Force a reflow so the animation restarts reliably.
    void bubble.offsetWidth;
    bubble.classList.add("pop");
  }

  /* ---------- Energy HUD ---------- */

  function setEnergy(value) {
    const fill = document.getElementById("energy-bar-fill");
    const label = document.getElementById("energy-value");
    if (!fill || !label) return;
    const clamped = Math.max(0, Math.min(100, Number(value) || 0));
    fill.style.width = clamped + "%";
    label.textContent = String(clamped);
  }

  /* ---------- Screen navigation ---------- */

  function showScreen(name, options) {
    const button = document.querySelector('.nav-button[data-screen="' + name + '"]');
    const screen = document.getElementById("screen-" + name);
    if (!button || !screen) return;

    const beach = window.BeachScene;
    // Only the live beach activity can create this one-visit intent.
    const fromBeach = name === "wardrobe" && options && options.fromBeach === true &&
      beach && beach.isOpen() && window.GameState.getLocation().id === "beach";
    if (activeScreen === "wardrobe") window.WardrobeUI.exit();
    returnToBeach = !!fromBeach;
    document.getElementById("wardrobe-return").hidden = !returnToBeach;
    if (beach && beach.isOpen()) beach.close();
    activeScreen = name;
    document.body.classList.toggle("wardrobe-open", name === "wardrobe");

    // Hide all screens, deactivate all buttons.
    document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
    document.querySelectorAll(".nav-button").forEach((b) => {
      b.classList.remove("active");
      b.removeAttribute("aria-current");
    });

    // Show the chosen one.
    screen.classList.add("active");
    button.classList.add("active");
    button.setAttribute("aria-current", "page");
    // The talk bubble lives inside the scrollable panel; un-scroll it so
    // it isn't left half-clipped behind the panel top after travel clicks.
    const main = document.querySelector(".game-main");
    if (main) main.scrollTop = 0;
    setTalk(DEFAULT_TALK);
    if (name === "wardrobe") {
      window.WardrobeUI.enter(fromBeach ? { slot: "swimsuit" } : null);
    } else if (!options || options.focus !== false) {
      const heading = screen.querySelector(".screen-title");
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }

  function backToBeach() {
    const valid = returnToBeach && activeScreen === "wardrobe" &&
      window.GameState.getLocation().id === "beach";
    // Consume before any navigation, state listeners, or engine startup.
    returnToBeach = false;
    document.getElementById("wardrobe-return").hidden = true;
    if (!valid) return;
    showScreen("map", { focus: false });
    window.BeachScene.open();
  }

  function wireNav() {
    document.querySelectorAll(".nav-button").forEach((button) => {
      button.addEventListener("click", () => {
        showScreen(button.dataset.screen);
      });
    });
  }

  /* ---------- Bootstrap ---------- */

  function init() {
    wireNav();
    document.getElementById("wardrobe-return").addEventListener("click", backToBeach);
    window.GameState.onChange(function (state, reason) {
      if (reason === "reset" && activeScreen === "wardrobe") {
        showScreen("wardrobe");
      } else if (state.location.id !== "beach") {
        returnToBeach = false;
        document.getElementById("wardrobe-return").hidden = true;
      }
    });
    showScreen("wardrobe");
    // Ask GameState for the loaded (persisted or default) energy value.
    const gameState = window.GameState;
    setEnergy(gameState && typeof gameState.getEnergy === "function" ? gameState.getEnergy() : 50);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Public API for future game modules.
  window.GameUI = { showScreen, setTalk, setEnergy };
})();
