/* ============================================================
   Lily's Dress-Up Adventure — printable paper dolls
   A print sheet with Lily in a white tank top and shorts plus every
   wardrobe piece, sized to fit her, with fold tabs — print it, cut it
   out, and dress her by hand.

     PrintDolls.open() / PrintDolls.close()
     PrintDolls.sheet()      -> rebuilds the sheet (used after a hair change)
     PrintDolls.summary()    -> { dolls, pieces, pages, paper } for tests/debug

   Everything here leans on one fact: the body and every garment are authored
   in the SAME 300x340 coordinate space (see BODY_MARKUP / the catalog).  So a
   single mm-per-unit factor prints clothes that provably fit the printed doll
   — no per-item fudging, and the wardrobe's own art is reused untouched.
   ============================================================ */

(function () {
  "use strict";

  /* ---------- Print scale (the only numbers that decide size) ---------- */

  const DOLL_COPIES = 2;                       // two dolls: dress one, spare for mistakes
  const DOLL_HEIGHT_MM = 142.5;                // ~14.2cm tall — 1.5× the original 95mm so small hands cut bigger targets (parent request)
  const DOLL_VIEWBOX = [0, 0, 300, 352];       // body viewBox + room for the stand tab
  const MM_PER_UNIT = DOLL_HEIGHT_MM / DOLL_VIEWBOX[3];

  const PAPER = { label: "US Letter", widthMm: 215.9, heightMm: 279.4, marginMm: 12.7 };
  /* What the toolbar promises the parent. tests/print_dolls_test.py prints a real
     PDF and fails if the sheet does not come out this long, so the claim in the
     UI cannot rot when the art or the scale changes. */
  const PAGES_ESTIMATE = 6;

  /* Slots that become cut-out pieces, and the heading above each block.  They
     flow as ONE page section: at 95mm doll scale a tops page was half empty,
     and a parent should not burn 4 sheets for 35 small cut-outs. */
  const PIECE_SLOTS = ["top", "bottom", "shoes", "swimsuit", "extra"];
  const SLOT_TITLE = {
    top: "Tops", bottom: "Bottoms", shoes: "Shoes",
    swimsuit: "Swimsuits", extra: "Extras"
  };

  /* Headroom above a garment so its fold tab is big enough for a 3-year-old to
     fold and tape (the picker thumbnails don't need it, the sheet does). */
  const TAB_HEADROOM = 26;   // units above the garment edge
  const TOP_PRINT_CROP = [82, 136, 136, 126];
  const DRESS_PRINT_CROP = [82, 136, 136, 158];   // a coversBottom dress runs to y~285
  const BOTTOM_PRINT_CROP = [72, 206, 156, 102];

  function mm(units) { return +(units * MM_PER_UNIT).toFixed(2); }

  function printCrop(slot, item) {
    if (slot === "top") return item && item.coversBottom ? DRESS_PRINT_CROP : TOP_PRINT_CROP;
    if (slot === "bottom") return BOTTOM_PRINT_CROP;
    return null;                                 // null = use the picker's crop
  }

  /* ---------- Fold tabs (body coordinates, same space as the art) ---------- */

  const TAB_FILL = "#d9dce8";
  const TAB_FOLD = "#9aa0b5";

  /* A tab is a grey flap sticking out past the garment, dashed where it folds.
     One group per garment kind, holding the flaps AND their fold lines, so a
     missing fold line is impossible to author by accident. Inserted UNDER the
     fabric so only the loose part shows. */
  function tabsMarkup(kind) {
    const flap = (d) => '<path d="' + d + '" fill="' + TAB_FILL + '"/>';
    const fold = (d) => '<path d="' + d + '" fill="none" stroke="' + TAB_FOLD +
      '" stroke-width="1.2" stroke-dasharray="4 3"/>';
    if (kind === "shoulders") {
      /* left tab, its fold line, then the right tab mirrored about x=150 */
      return '<g data-tab="shoulders">' +
        flap("M 124 140 L 140 140 L 137 164 L 127 164 Z") + fold("M 125 163 L 139 163") +
        flap("M 160 140 L 176 140 L 173 164 L 163 164 Z") + fold("M 161 163 L 175 163") +
        "</g>";
    }
    if (kind === "waist") {
      return '<g data-tab="waist">' +
        flap("M 138 210 L 162 210 L 158 234 L 142 234 Z") + fold("M 139 233 L 161 233") +
        "</g>";
    }
    return "";
  }

  /* A stand tab under Lily's feet, so a dressed doll can stand on the shelf. */
  const DOLL_STAND_TAB =
    '<g data-tab="stand">' +
    '<path d="M 124 306 L 176 306 L 184 344 Q 150 350 116 344 Z" fill="' + TAB_FILL + '"/>' +
    '<path d="M 126 308 L 174 308" fill="none" stroke="' + TAB_FOLD + '" stroke-width="1.2" stroke-dasharray="4 3"/>' +
    "</g>";

  /* ---------- DOM helpers ---------- */

  function element(id) { return document.getElementById(id); }

  function sheetRoot() { return element("print-sheet"); }

  function say(text) {
    const talk = window.GameUI && typeof window.GameUI.setTalk === "function"
      ? window.GameUI.setTalk : null;
    if (talk) talk(text);
  }

  function characterId() {
    const gs = window.GameState;
    return gs && typeof gs.getCharacter === "function" ? gs.getCharacter().id : "lily";
  }

  function wornHair() {
    const gs = window.GameState;
    const outfit = gs && typeof gs.getOutfit === "function" ? gs.getOutfit() : null;
    return (outfit && outfit.hair) || "hair1";
  }

  /* ---------- Sheet pieces ---------- */

  /* One cut-out garment: the wardrobe's own preview art (palette applied),
     re-cropped for print and sized in mm from the shared unit factor. */
  function pieceSvg(slot, itemId, who) {
    const host = document.createElement("div");
    const svg = window.CharacterRenderer.renderItemPreview(host, slot, itemId, { characterId: who });
    if (!svg) return null;
    const item = window.CharacterRenderer.catalog[slot][itemId];
    const crop = printCrop(slot, item);
    const box = crop
      ? (svg.setAttribute("viewBox", crop.join(" ")), crop)
      : (svg.getAttribute("viewBox") || "0 0 300 340").split(/\s+/).map(Number);
    svg.style.width = mm(box[2]) + "mm";
    svg.style.height = mm(box[3]) + "mm";
    svg.classList.add("print-piece-svg");
    const tabs = tabsMarkup(slot === "top" ? "shoulders" : slot === "bottom" ? "waist" : "");
    if (tabs) svg.insertAdjacentHTML("afterbegin", tabs);
    return svg;
  }

  function pieceCard(slot, itemId, who) {
    const li = document.createElement("li");
    li.className = "print-piece";
    li.dataset.slot = slot;
    li.dataset.itemId = itemId;
    const art = document.createElement("span");
    art.className = "print-piece-art";
    const svg = pieceSvg(slot, itemId, who);
    if (svg) art.appendChild(svg);
    const name = document.createElement("span");
    name.className = "print-piece-name";
    name.textContent = window.CharacterRenderer.getItemName(slot, itemId) || itemId;
    li.append(art, name);
    return li;
  }

  function dollCard(who, hair) {
    const li = document.createElement("li");
    li.className = "print-doll";
    const art = document.createElement("span");
    art.className = "print-doll-art";
    art.innerHTML = window.CharacterRenderer.buildPrintDollSVG({ characterId: who, hair: hair });
    const svg = art.querySelector("svg");
    if (svg) {
      svg.classList.add("print-doll-svg");
      svg.style.width = mm(DOLL_VIEWBOX[2]) + "mm";
      svg.style.height = mm(DOLL_VIEWBOX[3]) + "mm";
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      /* Drop the ground shadow: a grey puddle under a paper doll only confuses
         the cut line, and nothing about her should print below the feet tab. */
      const shadow = svg.querySelector('[data-layer="shadow"]');
      if (shadow) shadow.remove();
      svg.insertAdjacentHTML("beforeend", DOLL_STAND_TAB);
    }
    const label = document.createElement("span");
    label.className = "print-doll-name";
    label.textContent = "Lily — cut me out";
    li.append(art, label);
    return li;
  }

  /* ---------- Sheet assembly ---------- */

  let selectedHair = null;
  let built = { dolls: 0, pieces: 0, pages: 0 };

  const HOW_TO = [
    "Print this sheet on card paper if you can.",
    "Cut out Lily and all her clothes.",
    "Fold the grey tabs on the dashed lines and tape them on her back.",
    "Shoes, hats and bags have no tabs - a piece of tape underneath is enough.",
    "Dress her for wherever you are going today!"
  ];

  function heading(text, className) {
    const h = document.createElement("h2");
    h.className = className || "print-group-title";
    h.textContent = text;
    return h;
  }

  function buildSheet() {
    const root = sheetRoot();
    if (!root) return built;
    const pages = element("print-pages");
    if (!pages) return built;
    const who = characterId();
    const hair = selectedHair || wornHair();
    if (!window.CharacterRenderer.catalog.hair[hair]) selectedHair = null;

    pages.replaceChildren();

    /* Page 1 — the dolls, the how-to, and a line for the child to sign. */
    const first = document.createElement("section");
    first.className = "print-page print-page-dolls";
    const whoName = window.GameState && typeof window.GameState.getCharacter === "function"
      ? (window.GameState.getCharacter().name || "Lily") : "Lily";
    first.appendChild(heading("✂️ " + whoName + "'s paper dolls", "print-sheet-title"));
    const how = document.createElement("ol");
    how.className = "print-how";
    HOW_TO.forEach(function (line) {
      const item = document.createElement("li");
      item.textContent = line;
      how.appendChild(item);
    });
    first.appendChild(how);
    const dolls = document.createElement("ul");
    dolls.className = "print-dolls";
    /* At 142.5mm a doll no longer shares a row: the copies stack one per row,
       so centre each row instead of leaving a lone doll stuck to the left
       margin with a wide empty band beside it. */
    dolls.style.justifyContent = "center";
    for (let i = 0; i < DOLL_COPIES; i++) dolls.appendChild(dollCard(who, hair));
    first.appendChild(dolls);
    const belongs = document.createElement("p");
    belongs.className = "print-belongs";
    belongs.textContent = "This " + whoName + " belongs to ______________________";
    first.appendChild(belongs);
    pages.appendChild(first);

    /* The wardrobe — one flowing section, so the pieces pack down the sheet
       instead of leaving half of every page empty. */
    let pieces = 0;
    const sheet = document.createElement("section");
    sheet.className = "print-page print-page-pieces";
    PIECE_SLOTS.forEach(function (slot) {
      const items = window.CharacterRenderer.catalog[slot];
      const block = document.createElement("div");
      block.className = "print-group";
      block.dataset.slot = slot;
      block.appendChild(heading(SLOT_TITLE[slot] || slot));
      const ul = document.createElement("ul");
      ul.className = "print-pieces";
      ul.dataset.slot = slot;
      Object.keys(items).forEach(function (itemId) {
        const card = pieceCard(slot, itemId, who);
        if (card.querySelector("svg")) pieces++;
        ul.appendChild(card);
      });
      block.appendChild(ul);
      sheet.appendChild(block);
    });
    pages.appendChild(sheet);

    built = { dolls: DOLL_COPIES, pieces: pieces, sheets: 2, pages: PAGES_ESTIMATE, paper: PAPER.label };
    const note = element("print-toolbar-note");
    if (note) {
      note.textContent = built.dolls + " dolls · " + built.pieces + " pieces · about " +
        built.pages + " pages of " + PAPER.label + " (portrait)";
    }
    return built;
  }

  /* ---------- Hair picker (screen only — it is not part of the printout) ---------- */

  function buildHairPicker() {
    const strip = element("print-hair-choice");
    if (!strip) return;
    strip.replaceChildren();
    const hairs = window.CharacterRenderer.catalog.hair;
    const who = characterId();
    Object.keys(hairs).forEach(function (id) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "print-hair-choice-button";
      button.dataset.hairId = id;
      const chosen = (selectedHair || wornHair()) === id;
      button.classList.toggle("chosen", chosen);
      button.setAttribute("aria-pressed", String(chosen));
      const styleName = window.CharacterRenderer.getItemName("hair", id) || id;
      button.setAttribute("aria-label", styleName);
      button.title = styleName;                      // the label truncates on narrow chips
      const art = document.createElement("span");
      art.className = "print-hair-art";
      window.CharacterRenderer.renderItemPreview(art, "hair", id, { characterId: who });
      const svg = art.querySelector("svg");
      if (svg) { svg.style.width = "34px"; svg.style.height = "34px"; }
      const name = document.createElement("span");
      name.className = "print-hair-name";
      name.textContent = window.CharacterRenderer.getItemName("hair", id) || id;
      button.append(art, name);
      button.addEventListener("click", function () {
        selectedHair = id;
        if (window.GameSounds) window.GameSounds.play("pop");
        buildSheet();
        buildHairPicker();
      });
      strip.appendChild(button);
    });
  }

  /* ---------- Open / close ---------- */

  let trigger = null;

  function open() {
    const root = sheetRoot();
    if (!root || !root.hasAttribute("hidden")) return;
    /* The welcome card or the beach scene owns the screen; do not stack on it. */
    const modalOpen = document.querySelector("#welcome-overlay, .beach-scene:not(.hidden)");
    if (modalOpen) return;
    const gs = window.GameSounds;
    if (gs) gs.play("pop");
    trigger = document.activeElement;
    selectedHair = null;                       // each print starts from what she wears now
    root.removeAttribute("hidden");
    document.body.classList.add("print-dolls-open");
    buildHairPicker();
    const made = buildSheet();
    say("Cut out your paper dolls and dress them up! 💕");
    const go = element("print-go");
    if (go) go.focus({ preventScroll: true });
    return made;
  }

  function close() {
    const root = sheetRoot();
    if (!root || root.hasAttribute("hidden")) return;
    root.setAttribute("hidden", "");
    document.body.classList.remove("print-dolls-open");
    if (trigger && typeof trigger.focus === "function") trigger.focus({ preventScroll: true });
    trigger = null;
  }

  /* ---------- Wiring ---------- */

  function init() {
    const button = element("wardrobe-print");
    if (button) {
      button.addEventListener("click", function () {
        if (window.GameSounds) window.GameSounds.play("pop");
        open();
      });
    }
    const root = sheetRoot();
    if (!root) return;
    const go = element("print-go");
    if (go) go.addEventListener("click", function () { window.print(); });
    const closeButton = element("print-close");
    if (closeButton) closeButton.addEventListener("click", function () {
      if (window.GameSounds) window.GameSounds.play("pop");
      sheetClose();
    });
    root.addEventListener("keydown", function (event) {
      if (event.key === "Escape") { event.stopPropagation(); sheetClose(); }
    });
  }

  function sheetClose() { close(); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.PrintDolls = {
    open: open,
    close: close,
    sheet: buildSheet,
    summary: function () { return built; },
    mmPerUnit: MM_PER_UNIT,
    paper: PAPER
  };
})();
