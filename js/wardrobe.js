/* Dress-up picker. GameUI owns entry/exit; the renderer owns all art. */
(function () {
  "use strict";

  const SLOTS = ["hair", "top", "bottom", "shoes", "extra", "swimsuit"];
  let activeSlot = "hair";
  let active = false;
  let renderedSlot = null;
  let renderedCharacter = null;
  let previousState = null;
  let undoChange = null;
  let changingOutfit = false;

  function element(id) {
    return document.getElementById(id);
  }

  function feedback(text) {
    element("wardrobe-feedback").textContent = text;
  }

  function updateScrollHint() {
    const panel = element("wardrobe-panel");
    element("wardrobe-scroll-hint").textContent =
      panel.scrollHeight > panel.clientHeight + 1
        ? (panel.scrollTop + panel.clientHeight < panel.scrollHeight - 2
          ? "Scroll for more choices" : "All choices above")
        : "Tap an item to try it on";
  }

  function updateMarkers() {
    const outfit = window.GameState.getOutfit();
    element("wardrobe-items").querySelectorAll(".wardrobe-item").forEach(function (button) {
      const worn = (button.dataset.itemId || null) === outfit[activeSlot];
      button.classList.toggle("worn", worn);
      button.setAttribute("aria-pressed", String(worn));
      button.querySelector(".wardrobe-item-marker").textContent = worn ? "Wearing" : "Try on";
    });
    const top = window.CharacterRenderer.catalog.top[outfit.top];
    const covered = activeSlot === "bottom" && top && top.coversBottom;
    const hint = element("wardrobe-hint");
    hint.hidden = !covered;
    hint.textContent = covered ? "Dress covers bottoms. Choose a top." : "";
    const undo = element("wardrobe-undo");
    undo.disabled = !undoChange;
    undo.setAttribute("aria-label", undoChange
      ? "Undo last change: " + (window.CharacterRenderer.getItemName(undoChange.slot, undoChange.after) || "No extra")
      : "Undo last clothing change");
  }

  function renderItems() {
    const characterId = window.GameState.getCharacter().id;
    const grid = element("wardrobe-items");
    if (renderedSlot === activeSlot && renderedCharacter === characterId) {
      updateMarkers();
      return;
    }
    const sameSlot = renderedSlot === activeSlot;
    const focusedId = grid.contains(document.activeElement) ? document.activeElement.dataset.itemId : undefined;
    const panel = element("wardrobe-panel");
    const scrollTop = sameSlot ? panel.scrollTop : 0;
    const items = window.CharacterRenderer.catalog[activeSlot];
    const ids = Object.keys(items);
    if (activeSlot === "extra") ids.unshift("");
    grid.replaceChildren();
    ids.forEach(function (id) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wardrobe-item";
      button.dataset.itemId = id;
      button.dataset.slot = activeSlot;
      const art = document.createElement("span");
      art.className = "wardrobe-item-art";
      art.setAttribute("aria-hidden", "true");
      if (id) {
        window.CharacterRenderer.renderItemPreview(art, activeSlot, id, { characterId: characterId });
        art.querySelector("svg").setAttribute("aria-hidden", "true");
      } else {
        art.classList.add("wardrobe-none-art");
        art.textContent = "\u00d7";
      }
      const name = document.createElement("span");
      name.className = "wardrobe-item-name";
      name.textContent = id ? items[id].name : "No extra";
      button.setAttribute("aria-label", name.textContent);
      const marker = document.createElement("span");
      marker.className = "wardrobe-item-marker";
      marker.setAttribute("aria-hidden", "true");
      button.append(art, name, marker);
      grid.appendChild(button);
    });
    renderedSlot = activeSlot;
    renderedCharacter = characterId;
    updateMarkers();
    if (sameSlot && focusedId !== undefined) {
      const button = Array.from(grid.children).find(function (item) { return item.dataset.itemId === focusedId; });
      if (button) button.focus({ preventScroll: true });
    }
    panel.scrollTop = scrollTop;
    updateScrollHint();
  }

  function applyPreview() {
    window.CharacterRenderer.setPreviewSkip(element("character-stage-wardrobe"),
      active && activeSlot === "swimsuit" ? ["top", "bottom", "shoes"] : null);
  }

  function switchTab(slot, focus) {
    if (!SLOTS.includes(slot)) return;
    activeSlot = slot;
    applyPreview();
    const selected = element("wardrobe-tab-" + slot);
    document.querySelectorAll(".wardrobe-tab").forEach(function (tab) {
      const chosen = tab === selected;
      tab.classList.toggle("active", chosen);
      tab.setAttribute("aria-selected", String(chosen));
      tab.tabIndex = chosen ? 0 : -1;
    });
    element("wardrobe-panel").setAttribute("aria-labelledby", selected.id);
    renderItems();
    if (focus) selected.focus({ preventScroll: true });
    // Scroll only the category strip, never the page or the fitting area.
    const row = selected.parentElement;
    const tabBox = selected.getBoundingClientRect();
    const rowBox = row.getBoundingClientRect();
    if (tabBox.left < rowBox.left) row.scrollLeft -= rowBox.left - tabBox.left;
    if (tabBox.right > rowBox.right) row.scrollLeft += tabBox.right - rowBox.right;
    updateScrollHint();
  }

  function selectItem(button) {
    const gs = window.GameState;
    const after = button.dataset.itemId || null;
    const before = gs.getOutfit()[activeSlot];
    if (before === after) return;
    undoChange = { slot: activeSlot, before: before, after: after, characterId: gs.getCharacter().id };
    changingOutfit = true;
    try {
      gs.setOutfitSlot(activeSlot, after);
    } finally {
      changingOutfit = false;
    }
    feedback(after ? window.CharacterRenderer.getItemName(activeSlot, after) + " looks lovely!" : "Extra removed.");
  }

  function undo() {
    if (!undoChange) return;
    const change = undoChange;
    undoChange = null;
    const gs = window.GameState;
    if (gs.getCharacter().id !== change.characterId || gs.getOutfit()[change.slot] !== change.after) {
      updateMarkers();
      return;
    }
    changingOutfit = true;
    try {
      gs.setOutfitSlot(change.slot, change.before);
    } finally {
      changingOutfit = false;
    }
    switchTab(change.slot, false);
    const selected = element("wardrobe-items").querySelector('[aria-pressed="true"]');
    if (selected) {
      selected.focus({ preventScroll: true });
      const panel = element("wardrobe-panel");
      panel.scrollTop += selected.getBoundingClientRect().top - panel.getBoundingClientRect().top - 6;
    }
    feedback("Last change undone.");
  }

  function enter(options) {
    active = true;
    switchTab(options && options.slot || activeSlot, true);
    feedback("Try something you love!");
  }

  function exit() {
    active = false;
    applyPreview();
  }

  function init() {
    document.querySelectorAll(".wardrobe-tab").forEach(function (tab) {
      tab.addEventListener("click", function () { switchTab(tab.dataset.slot, false); });
      tab.addEventListener("keydown", function (event) {
        let index = SLOTS.indexOf(activeSlot);
        if (event.key === "ArrowRight") index = (index + 1) % SLOTS.length;
        else if (event.key === "ArrowLeft") index = (index + SLOTS.length - 1) % SLOTS.length;
        else if (event.key === "Home") index = 0;
        else if (event.key === "End") index = SLOTS.length - 1;
        else return;
        event.preventDefault();
        switchTab(SLOTS[index], true);
      });
    });
    element("wardrobe-category-next").addEventListener("click", function () {
      switchTab(SLOTS[(SLOTS.indexOf(activeSlot) + 1) % SLOTS.length], true);
    });
    element("wardrobe-items").addEventListener("click", function (event) {
      const button = event.target.closest(".wardrobe-item");
      if (button) selectItem(button);
    });
    element("wardrobe-undo").addEventListener("click", undo);
    element("wardrobe-panel").addEventListener("scroll", updateScrollHint);
    new ResizeObserver(updateScrollHint).observe(element("wardrobe-panel"));
    previousState = window.GameState.get();
    renderItems();
    window.GameState.onChange(function (state, reason) {
      const friendChanged = state.characterId !== previousState.characterId;
      const outfitChanged = SLOTS.some(function (slot) { return state.outfit[slot] !== previousState.outfit[slot]; });
      if (reason === "reset" || friendChanged || (!changingOutfit && outfitChanged)) undoChange = null;
      previousState = state;
      if (reason === "reset") switchTab("hair", false);
      else if (friendChanged) renderItems();
      else updateMarkers();
    });
  }

  window.WardrobeUI = { enter: enter, exit: exit };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
