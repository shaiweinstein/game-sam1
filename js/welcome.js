/* ============================================================
   Lily's Dress-Up Adventure — welcome / start screen
   Owns the title overlay (markup lives in index.html).

   Behaviors:
     - "🎈 Let's Play!" ALWAYS starts fresh: GameState.reset(),
       then wardrobe screen + a fresh-start message.
     - "💛 Continue my game" only appears when a save exists and
       NEVER resets — it just skips straight into the game.
     - Pressing Enter on the overlay triggers the primary
       (fresh-start) action.
     - Dismissing REMOVES the overlay from the DOM (not just hide).
   ============================================================ */

(function () {
  "use strict";

  const SAVE_KEY = "lily-game-save-v1";

  /* Names the current friend, so these read correctly after a switch.
     (Fresh start calls GameState.reset() first — back to Lily — which
     is exactly what these evaluate to at click time.) */
  function currentName() {
    const gs = window.GameState;
    return gs && typeof gs.getCharacter === "function" ? gs.getCharacter().name : "Lily";
  }

  let overlay = null;
  let dismissed = false;

  function hasSave() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      return typeof raw === "string" && raw.length > 0;
    } catch (e) {
      return false;
    }
  }

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    overlay = null;
  }

  function startFresh() {
    if (dismissed) return;
    if (window.GameState && typeof window.GameState.reset === "function") {
      window.GameState.reset();
    }
    dismiss();
    const ui = window.GameUI;
    if (ui && typeof ui.showScreen === "function") ui.showScreen("wardrobe");
    if (ui && typeof ui.setTalk === "function") ui.setTalk("Let's get " + currentName() + " dressed! 👗");
  }

  function continueGame() {
    if (dismissed) return;
    dismiss();
    const ui = window.GameUI;
    if (ui && typeof ui.showScreen === "function") ui.showScreen("wardrobe");
    if (ui && typeof ui.setTalk === "function") ui.setTalk("Welcome back! " + currentName() + " kept your outfit safe! 💕");
  }

  function onOverlayKeydown(event) {
    if (event.key !== "Enter") return;
    // Buttons handle themselves (Enter on a focused button clicks it);
    // any other Enter on the overlay means "start fresh".
    const target = event.target;
    if (target && target.closest && target.closest("button")) return;
    event.preventDefault();
    startFresh();
  }

  function init() {
    overlay = document.getElementById("welcome-overlay");
    if (!overlay) return;

    const startButton = document.getElementById("welcome-start");
    const continueButton = document.getElementById("welcome-continue");

    if (startButton) {
      startButton.addEventListener("click", startFresh);
    }
    if (continueButton && hasSave()) {
      continueButton.classList.remove("hidden");
      continueButton.addEventListener("click", continueGame);
    }

    overlay.addEventListener("keydown", onOverlayKeydown);

    // Keyboard players land straight on the primary action.
    if (startButton) startButton.focus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
