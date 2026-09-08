/* ============================================================
   Lily's Dress-Up Adventure — Character renderer (SVG)
    Draws the chosen girl as a cute chibi-style cartoon whose outfit
    parts are swappable layers. Reads the outfit (and which friend is
    playing) from GameState and re-renders every registered instance
    on any change.

    Colors are palette tokens (__SKIN__, __SKINSHADE__, __FACE__,
    __HAIRMAIN__, __HAIRSHADE__, __BLUSHOP__) in the shared markup;
    each character in CHARACTERS carries the hex values, so all four
    friends wear the SAME clothes/hair styles with their own skin
    and hair colors.

    Public API (window.CharacterRenderer):
      CharacterRenderer.render(containerEl, opts) -> SVGElement
         opts: {
           size: 'big' | 'small',
           characterId: optional — when given, this instance ALWAYS
             renders that character (ignores the globally chosen
             friend). Used by the Friends screen previews so each
             card shows its own girl while the global selection only
             changes on click.
         }
      CharacterRenderer.forget(containerEl)
         -> drop a container from the auto-refresh registry so later
            GameState changes no longer repaint it (call before removing
            or clearing a rendered container for good, e.g. old map
            markers and finished walkers).
      CharacterRenderer.getItemName(slot, id)     -> name or null
      CharacterRenderer.catalog                   -> item catalog
      CharacterRenderer.onChanged(cb)             -> unsubscribe fn
      CharacterRenderer.playAnimation(el, name)   -> 'bounce' | 'cheer' | 'eat'
      CharacterRenderer.setPreviewSkip(containerEl, slots|null)
          -> hide layers on this instance only, including after outfit
             changes; null restores them. Hiding both top and bottom
             enables swimsuit preview. Clear on leaving the wardrobe.
      CharacterRenderer.renderItemPreview(containerEl, slot, itemId, opts)
          -> standalone catalog SVG; opts may override characterId.
             Never registers an instance or changes the saved outfit.

    Also exposes window.CharacterCatalog (slot -> items) for other files,
    and window.CHARACTERS (characterId -> palette + name) for the
    Friends screen and GameState.getCharacter().
    ============================================================ */

(function () {
  "use strict";

  /* ---------- Characters (skin + hair palettes) ----------
     Shared body/hair markup paints from these palettes at render
     time. blushOpacity is optional (defaults 0.8); softened on the
     deepest skin so the pink cheeks stay subtle. */

  const CHARACTERS = {
    lily: {
      name: "Lily",
      skin: "#ffdcc0",
      skinShade: "#e8b48e",
      face: "#4a3226",
      hairMain: "#8a5a3a",
      hairShade: "#5e3a22"
    },
    amara: {
      name: "Amara",
      skin: "#9c6b43",
      skinShade: "#7a4f30",
      face: "#2b1a0e",
      hairMain: "#2e2430",
      hairShade: "#191320",
      blushOpacity: 0.5
    },
    mei: {
      name: "Mei",
      skin: "#ffe1c6",
      skinShade: "#e9bf9b",
      face: "#3a2418",
      hairMain: "#241f26",
      hairShade: "#12101a"
    },
    sofia: {
      name: "Sofia",
      skin: "#eab487",
      skinShade: "#c98f5e",
      face: "#33200f",
      hairMain: "#7a3b1e",
      hairShade: "#5a2a12"
    }
  };

  window.CHARACTERS = CHARACTERS;

  /* Maps palette tokens to one character's colors. */
  function applyPalette(markup, characterId) {
    const c = CHARACTERS[characterId] || CHARACTERS.lily;
    return markup
      .replace(/__SKIN__/g, c.skin)
      .replace(/__SKINSHADE__/g, c.skinShade)
      .replace(/__FACE__/g, c.face)
      .replace(/__HAIRMAIN__/g, c.hairMain)
      .replace(/__HAIRSHADE__/g, c.hairShade)
      .replace(/__BLUSHOP__/g, c.blushOpacity == null ? "0.8" : String(c.blushOpacity));
  }

  /* ---------- Tiny markup helpers ---------- */

  /* 5-point star polygon points (for wands, sparkles) */
  function starPoints(cx, cy, r) {
    const points = [];
    for (let i = 0; i < 10; i++) {
      const angle = (Math.PI / 5) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r : r * 0.45;
      points.push(
        (cx + radius * Math.cos(angle)).toFixed(1) + "," +
        (cy + radius * Math.sin(angle)).toFixed(1)
      );
    }
    return points.join(" ");
  }

  function star(cx, cy, r, fill, stroke) {
    return '<polygon points="' + starPoints(cx, cy, r) +
      '" fill="' + fill + '" stroke="' + stroke +
      '" stroke-width="2.5" stroke-linejoin="round"/>';
  }

  /* 4-point twinkle (sparkles on dress / sandals) */
  function sparkle(cx, cy, r, fill) {
    const q = r * 0.25;
    return '<path d="M ' + cx + " " + (cy - r) +
      " L " + (cx + q) + " " + (cy - q) +
      " L " + (cx + r) + " " + cy +
      " L " + (cx + q) + " " + (cy + q) +
      " L " + cx + " " + (cy + r) +
      " L " + (cx - q) + " " + (cy + q) +
      " L " + (cx - r) + " " + cy +
      " L " + (cx - q) + " " + (cy - q) +
      ' Z" fill="' + (fill || "#ffe9a8") + '" opacity="0.95"/>';
  }

  /* ---------- Base body (never swapped) ---------- */
  /* Colors are palette tokens resolved per character by applyPalette:
     skin __SKIN__, outline/shade __SKINSHADE__, face details __FACE__,
     blush strength __BLUSHOP__ (blush fill stays the same pink). */
  const BODY_MARKUP = [
    /* soft ground shadow */
    '<ellipse cx="150" cy="328" rx="58" ry="10" fill="#3a2e6e" opacity="0.10"/>',
    /* legs (outline trick: dark stroke under light stroke) */
    '<path d="M 138 248 L 138 302" stroke="__SKINSHADE__" stroke-width="17" fill="none" stroke-linecap="round"/>',
    '<path d="M 162 248 L 162 302" stroke="__SKINSHADE__" stroke-width="17" fill="none" stroke-linecap="round"/>',
    '<path d="M 138 248 L 138 302" stroke="__SKIN__" stroke-width="10" fill="none" stroke-linecap="round"/>',
    '<path d="M 162 248 L 162 302" stroke="__SKIN__" stroke-width="10" fill="none" stroke-linecap="round"/>',
    /* torso */
    '<rect x="116" y="164" width="68" height="86" rx="26" fill="__SKIN__" stroke="__SKINSHADE__" stroke-width="4"/>',
    /* arms */
    '<path d="M 122 172 Q 104 194 98 226" stroke="__SKINSHADE__" stroke-width="15" fill="none" stroke-linecap="round"/>',
    '<path d="M 178 172 Q 196 194 202 226" stroke="__SKINSHADE__" stroke-width="15" fill="none" stroke-linecap="round"/>',
    '<path d="M 122 172 Q 104 194 98 226" stroke="__SKIN__" stroke-width="9" fill="none" stroke-linecap="round"/>',
    '<path d="M 178 172 Q 196 194 202 226" stroke="__SKIN__" stroke-width="9" fill="none" stroke-linecap="round"/>',
    /* head */
    '<ellipse cx="150" cy="105" rx="58" ry="55" fill="__SKIN__" stroke="__SKINSHADE__" stroke-width="4"/>',
    /* big happy eyes with shine dots */
    '<ellipse cx="128" cy="103" rx="8.5" ry="11" fill="__FACE__"/>',
    '<ellipse cx="172" cy="103" rx="8.5" ry="11" fill="__FACE__"/>',
    '<circle cx="131.5" cy="98.5" r="3.2" fill="#ffffff"/>',
    '<circle cx="175.5" cy="98.5" r="3.2" fill="#ffffff"/>',
    '<circle cx="125.5" cy="107" r="1.6" fill="#ffffff" opacity="0.8"/>',
    '<circle cx="169.5" cy="107" r="1.6" fill="#ffffff" opacity="0.8"/>',
    /* blush cheeks */
    '<ellipse cx="110" cy="122" rx="11" ry="7" fill="#ffc9dc" opacity="__BLUSHOP__"/>',
    '<ellipse cx="190" cy="122" rx="11" ry="7" fill="#ffc9dc" opacity="__BLUSHOP__"/>',
    /* smile */
    '<path d="M 136 124 Q 150 140 164 124" fill="none" stroke="__FACE__" stroke-width="4.5" stroke-linecap="round"/>'
  ].join("\n      ");

  /* ---------- Catalog ----------
     Each item's markup is positioned for its layer group.
     Hair items have both 'back' (behind head) and 'front'
     (fringe over forehead) parts. 'extra4' has a 'back' part
     (the bag behind the body) plus 'front' straps. Simple tees tuck
     into bottoms; untucked tops paint over the waistband. A dress
     coversBottom visually without removing the saved bottom choice. */

  const TEE_PATH =
    "M 116 162 Q 150 174 184 162 L 204 174 L 195 206 L 184 199 " +
    "L 184 240 Q 150 248 116 240 L 116 199 L 105 206 L 96 174 Z";

  /* Follow the torso's full hips before narrowing around the legs
     (centers 138/162, outer radius 8.5). Waist tucks under every vest. */
  const SWIM_SHORTS_PATH =
    "M 114 200 L 186 200 L 186 224 Q 186 240 174 251 L 174 272 " +
    "Q 174 275 170 275 L 155 275 Q 152 275 152 272 L 151 259 " +
    "Q 150 256 149 259 L 148 272 Q 148 275 145 275 L 130 275 " +
    "Q 126 275 126 272 L 126 251 Q 114 240 114 224 Z";

  const CATALOG = {
    hair: {
      hair1: {
        name: "Long Hair",
        emoji: "💁‍♀️",
        /* long hair with middle part: two side falls behind + fringe */
        back:
          '<path d="M 150 44 C 86 44 76 92 84 150 C 88 186 84 212 92 226 ' +
          "Q 100 234 110 228 C 118 190 118 150 122 122 L 178 122 " +
          "C 182 150 182 190 190 228 Q 200 234 208 226 C 216 212 212 186 216 150 " +
          'C 224 92 214 44 150 44 Z" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4" stroke-linejoin="round"/>',
        front:
          '<path d="M 92 100 C 92 60 116 46 150 46 C 184 46 208 60 208 100 ' +
          "C 196 92 176 84 150 86 C 124 84 104 92 92 100 Z\" " +
          'fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 150 84 L 150 54" stroke="__HAIRSHADE__" stroke-width="2.5" stroke-linecap="round"/>'
      },
      hair2: {
        name: "Curly Pigtails",
        emoji: "🌰",
        back:
          '<ellipse cx="150" cy="102" rx="64" ry="62" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="62" cy="140" r="30" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="238" cy="140" r="30" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="70" cy="178" r="18" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="230" cy="178" r="18" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>',
        front:
          '<path d="M 94 104 C 94 62 118 46 150 46 C 182 46 206 62 206 104 ' +
          "C 198 94 182 88 150 88 C 118 88 102 94 94 104 Z\" " +
          'fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4" stroke-linejoin="round"/>'
      },
      hair3: {
        name: "Bouncy Bob",
        emoji: "💇",
        back:
          '<path d="M 150 46 C 96 46 82 92 86 132 C 88 158 84 172 88 180 ' +
          "Q 94 188 104 184 C 108 160 108 140 110 122 L 190 122 " +
          "C 192 140 192 160 196 184 Q 206 188 212 180 C 216 172 212 158 214 132 " +
          'C 218 92 204 46 150 46 Z" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4" stroke-linejoin="round"/>',
        front:
          '<path d="M 94 100 C 94 60 118 46 150 46 C 182 46 206 60 206 100 ' +
          "C 194 86 178 80 150 80 C 122 80 106 86 94 100 Z\" " +
          'fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4" stroke-linejoin="round"/>'
      },
      hair4: {
        name: "Ponytail",
        emoji: "🐎",
        back:
          '<ellipse cx="150" cy="102" rx="64" ry="60" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<path d="M 196 58 C 232 64 248 100 244 140 C 241 176 232 204 218 214 ' +
          "C 208 221 198 214 200 204 C 212 176 214 140 208 112 " +
          'C 204 92 198 78 190 70 Z" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4" stroke-linejoin="round"/>' +
          '<circle cx="200" cy="60" r="8" fill="#ff8fb8" stroke="#d9568a" stroke-width="3"/>',
        front:
          '<path d="M 94 104 C 94 62 118 46 150 46 C 182 46 206 60 206 96 ' +
          "C 196 82 170 74 140 82 C 120 88 104 96 94 104 Z\" " +
          'fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4" stroke-linejoin="round"/>'
      },
      hair5: {
        name: "Space Buns",
        emoji: "🍡",
        /* two round buns high on the head + side-swept fringe;
           buns/cap are palette-tokened, only the little hair ties
           keep a fixed pink accent (like hair4's tie). */
        back:
          '<ellipse cx="150" cy="100" rx="62" ry="57" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="96" cy="46" r="25" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="204" cy="46" r="25" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="108" cy="66" r="7" fill="#ff8fb8" stroke="#d9568a" stroke-width="3"/>' +
          '<circle cx="192" cy="66" r="7" fill="#ff8fb8" stroke="#d9568a" stroke-width="3"/>',
        front:
          '<path d="M 94 98 C 94 62 116 46 150 46 C 184 46 206 62 206 98 ' +
          "C 197 82 174 74 146 80 C 124 85 105 92 94 98 Z\" " +
          'fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4" stroke-linejoin="round"/>'
      },
      hair6: {
        name: "Big Curly",
        emoji: "🌀",
        /* cloud of rounded curls behind + scalloped curly fringe.
           Every curl is __HAIRMAIN__/__HAIRSHADE__ so it recolors
           per friend. */
        back:
          '<ellipse cx="150" cy="108" rx="70" ry="66" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="100" cy="56" r="21" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="150" cy="44" r="22" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="200" cy="56" r="21" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="76" cy="102" r="20" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="224" cy="102" r="20" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="84" cy="150" r="19" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="216" cy="150" r="19" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="103" cy="186" r="16" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>' +
          '<circle cx="197" cy="186" r="16" fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4"/>',
        front:
          '<path d="M 92 100 C 92 60 116 44 150 44 C 184 44 208 60 208 100 ' +
          "Q 197 107 186 94 Q 176 106 165 92 Q 157 104 150 92 " +
          'Q 143 104 135 92 Q 124 106 114 94 Q 103 107 92 100 Z" ' +
          'fill="__HAIRMAIN__" stroke="__HAIRSHADE__" stroke-width="4" stroke-linejoin="round"/>'
      }
    },

    top: {
      top1: {
        name: "Pink T-Shirt",
        emoji: "👕",
        front:
          '<path d="' + TEE_PATH + '" fill="#ff8fb8" stroke="#d9568a" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 150 208 C 147 204 141 205 141 210 C 141 215 147 218 150 221 ' +
          'C 153 218 159 215 159 210 C 159 205 153 204 150 208 Z" fill="#fff9ec"/>'
      },
      top2: {
        name: "Sparkly Dress",
        emoji: "👗",
        coversBottom: true,
        front:
          '<path d="M 116 162 Q 150 174 184 162 L 186 207 Q 188 226 206 278 ' +
          "Q 150 292 94 278 Q 112 226 114 207 Z" +
          '" fill="#a56bd6" stroke="#8449c1" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 114 216 Q 150 224 186 216" fill="none" stroke="#8449c1" stroke-width="3"/>' +
          '<path d="M 101 271 Q 150 284 199 271" fill="none" stroke="#d29ce8" stroke-width="3" stroke-linecap="round"/>' +
          sparkle(128, 192, 5) + sparkle(165, 186, 6) + sparkle(150, 257, 6) + sparkle(122, 244, 4)
      },
      top3: {
        name: "Sunny Sweater",
        emoji: "🔆",
        untucked: true,
        front:
          '<path d="M 118 172 Q 104 194 99 218" stroke="#e0b420" stroke-width="19" fill="none" stroke-linecap="round"/>' +
          '<path d="M 182 172 Q 196 194 201 218" stroke="#e0b420" stroke-width="19" fill="none" stroke-linecap="round"/>' +
          '<path d="M 118 172 Q 104 194 99 218" stroke="#ffd93d" stroke-width="13" fill="none" stroke-linecap="round"/>' +
          '<path d="M 182 172 Q 196 194 201 218" stroke="#ffd93d" stroke-width="13" fill="none" stroke-linecap="round"/>' +
          '<path d="M 138 162 L 162 162 Q 186 162 186 186 L 186 244 ' +
          'Q 150 256 114 244 L 114 186 Q 114 162 138 162 Z" fill="#ffd93d" stroke="#e0b420" stroke-width="4"/>' +
          '<path d="M 120 244 Q 150 250 180 244" fill="none" stroke="#e0b420" stroke-width="3" stroke-linecap="round"/>'
      },
      top4: {
        name: "Teal Stripes",
        emoji: "🎽",
        front:
          '<path d="' + TEE_PATH + '" fill="#4fc3d9" stroke="#2f9fb5" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 122 190 L 178 190" stroke="#ffffff" stroke-width="5" opacity="0.85" stroke-linecap="round"/>' +
          '<path d="M 122 206 L 178 206" stroke="#ffffff" stroke-width="5" opacity="0.85" stroke-linecap="round"/>' +
          '<path d="M 122 222 L 178 222" stroke="#ffffff" stroke-width="5" opacity="0.85" stroke-linecap="round"/>'
      },
      top5: {
        name: "Rainbow Shirt",
        emoji: "🌈",
        untucked: true,
        front:
          '<path d="' + TEE_PATH + '" fill="#fff9ec" stroke="#c9a15a" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 120 188 Q 150 194 180 188" stroke="#ff5a5a" stroke-width="5" fill="none" stroke-linecap="round"/>' +
          '<path d="M 120 197 Q 150 203 180 197" stroke="#ffa54a" stroke-width="5" fill="none" stroke-linecap="round"/>' +
          '<path d="M 120 206 Q 150 212 180 206" stroke="#ffd93d" stroke-width="5" fill="none" stroke-linecap="round"/>' +
          '<path d="M 120 215 Q 150 221 180 215" stroke="#6bd66b" stroke-width="5" fill="none" stroke-linecap="round"/>' +
          '<path d="M 120 224 Q 150 230 180 224" stroke="#4fa3e3" stroke-width="5" fill="none" stroke-linecap="round"/>' +
          '<path d="M 120 233 Q 150 239 180 233" stroke="#a56bd6" stroke-width="5" fill="none" stroke-linecap="round"/>'
      },
      top6: {
        name: "Ladybug Tee",
        emoji: "🐞",
        front:
          '<path d="' + TEE_PATH + '" fill="#ff5a5a" stroke="#e04b4b" stroke-width="4" stroke-linejoin="round"/>' +
          /* tiny ladybug head + antennae peeking at the neckline */
          '<path d="M 145 169 L 141 163" stroke="#3a3040" stroke-width="2.5" stroke-linecap="round"/>' +
          '<path d="M 155 169 L 159 163" stroke="#3a3040" stroke-width="2.5" stroke-linecap="round"/>' +
          '<circle cx="150" cy="176" r="8" fill="#3a3040"/>' +
          '<circle cx="147" cy="173.5" r="2" fill="#ffffff" opacity="0.85"/>' +
          /* bold round spots */
          '<circle cx="128" cy="201" r="6.5" fill="#3a3040"/>' +
          '<circle cx="170" cy="208" r="7" fill="#3a3040"/>' +
          '<circle cx="150" cy="226" r="5.5" fill="#3a3040"/>' +
          '<circle cx="135" cy="221" r="4.5" fill="#3a3040"/>' +
          '<circle cx="167" cy="188" r="4.5" fill="#3a3040"/>'
      },
      top7: {
        name: "Cozy Hoodie",
        emoji: "🧥",
        untucked: true,
        front:
          '<path d="' + TEE_PATH + '" fill="#4fc3d9" stroke="#2f9fb5" stroke-width="4" stroke-linejoin="round"/>' +
          /* scrunchy hood resting behind the neck (front arc at the neckline) */
          '<path d="M 118 169 Q 150 156 182 169 Q 150 184 118 169 Z" ' +
          'fill="#7fd4e6" stroke="#2f9fb5" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 129 169 Q 150 178 171 169" fill="none" stroke="#2f9fb5" stroke-width="3" stroke-linecap="round"/>' +
          /* drawstrings */
          '<path d="M 144 180 L 142 197" stroke="#fff9ec" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M 156 180 L 158 197" stroke="#fff9ec" stroke-width="3" stroke-linecap="round"/>' +
          /* big front kangaroo pocket */
          '<path d="M 122 208 L 178 208 L 182 234 Q 150 242 118 234 Z" ' +
          'fill="#7fd4e6" stroke="#2f9fb5" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 126 213 Q 150 219 174 213" fill="none" stroke="#2f9fb5" stroke-width="2.5" stroke-linecap="round"/>'
      },
      top8: {
        name: "Star Tee",
        emoji: "⭐",
        front:
          '<path d="' + TEE_PATH + '" fill="#4a90e2" stroke="#3273b8" stroke-width="4" stroke-linejoin="round"/>' +
          star(150, 203, 24, "#ffd93d", "#e0b420") +
          '<circle cx="124" cy="183" r="2.2" fill="#fff9ec" opacity="0.9"/>' +
          '<circle cx="176" cy="221" r="2.2" fill="#fff9ec" opacity="0.9"/>'
      }
    },

    bottom: {
      bottom1: {
        name: "Denim Skirt",
        emoji: "👗",
        front:
          '<path d="M 114 232 L 186 232 L 194 272 Q 150 280 106 272 Z" ' +
          'fill="#5a8fd6" stroke="#3d6db3" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 116 242 L 184 242" stroke="#3d6db3" stroke-width="3"/>' +
          '<path d="M 126 248 Q 134 254 140 248" fill="none" stroke="#8fb7e8" stroke-width="2.5" stroke-linecap="round"/>' +
          '<path d="M 174 248 Q 166 254 160 248" fill="none" stroke="#8fb7e8" stroke-width="2.5" stroke-linecap="round"/>' +
          '<path d="M 110 266 Q 150 274 190 266" fill="none" stroke="#a8c8ee" stroke-width="2.5" stroke-dasharray="6 4"/>'
      },
      bottom2: {
        name: "Dotty Red Skirt",
        emoji: "💗",
        front:
          '<path d="M 112 232 L 188 232 L 200 276 Q 150 286 100 276 Z" ' +
          'fill="#ff6b6b" stroke="#e04b4b" stroke-width="4" stroke-linejoin="round"/>' +
          '<circle cx="124" cy="248" r="3" fill="#ffffff" opacity="0.9"/>' +
          '<circle cx="150" cy="264" r="3" fill="#ffffff" opacity="0.9"/>' +
          '<circle cx="176" cy="248" r="3" fill="#ffffff" opacity="0.9"/>' +
          '<circle cx="136" cy="274" r="3" fill="#ffffff" opacity="0.9"/>' +
          '<circle cx="166" cy="274" r="3" fill="#ffffff" opacity="0.9"/>'
      },
      bottom3: {
        name: "Blue Shorts",
        emoji: "🩳",
        front:
          '<path d="M 114 232 L 186 232 L 176 282 Q 164 286 152 282 L 151 262 ' +
          "Q 150 258 149 262 L 148 282 Q 136 286 124 282 Z" +
          '" fill="#4a90e2" stroke="#3273b8" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 116 242 L 184 242" stroke="#3273b8" stroke-width="3"/>' +
          '<path d="M 126 277 L 146 277" stroke="#8fc4f4" stroke-width="2.5" stroke-linecap="round"/>' +
          '<path d="M 154 277 L 174 277" stroke="#8fc4f4" stroke-width="2.5" stroke-linecap="round"/>'
      },
      bottom4: {
        name: "Tutu Skirt",
        emoji: "💞",
        front:
          '<path d="M 112 232 L 188 232 Q 214 250 218 276 Q 150 292 82 276 Q 86 250 112 232 Z" ' +
          'fill="#ffb8e0" stroke="#ff8fd0" stroke-width="4" opacity="0.9" stroke-linejoin="round"/>' +
          '<path d="M 118 232 L 182 232 Q 202 248 208 270 Q 150 282 92 270 Q 98 248 118 232 Z" ' +
          'fill="#ffd6ef" opacity="0.85"/>' +
          '<path d="M 124 232 L 176 232 Q 192 246 196 264 Q 150 274 104 264 Q 108 246 124 232 Z" ' +
          'fill="#ffeef8" opacity="0.8"/>'
      },
      bottom5: {
        name: "Mint Skirt",
        emoji: "🌿",
        front:
          '<path d="M 114 232 L 186 232 L 196 276 Q 150 284 104 276 Z" ' +
          'fill="#98e0c8" stroke="#6cc4a4" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 132 236 L 128 276" stroke="#6cc4a4" stroke-width="2.5"/>' +
          '<path d="M 150 236 L 150 278" stroke="#6cc4a4" stroke-width="2.5"/>' +
          '<path d="M 168 236 L 172 276" stroke="#6cc4a4" stroke-width="2.5"/>'
      },
      bottom6: {
        name: "Plaid Skirt",
        emoji: "🟩",
        front:
          '<path d="M 112 232 L 188 232 L 197 277 Q 150 287 103 277 Z" ' +
          'fill="#98e0c8" stroke="#6cc4a4" stroke-width="4" stroke-linejoin="round"/>' +
          /* criss-cross plaid bands kept inside the skirt silhouette */
          '<path d="M 130 235 L 127 278" stroke="#4a90e2" stroke-width="7" opacity="0.75"/>' +
          '<path d="M 150 235 L 150 281" stroke="#4a90e2" stroke-width="7" opacity="0.75"/>' +
          '<path d="M 170 235 L 173 278" stroke="#4a90e2" stroke-width="7" opacity="0.75"/>' +
          '<path d="M 111 248 L 189 248" stroke="#4a90e2" stroke-width="7" opacity="0.75"/>' +
          '<path d="M 108 266 L 192 266" stroke="#4a90e2" stroke-width="7" opacity="0.75"/>' +
          '<path d="M 139 235 L 137 279" stroke="#ffffff" stroke-width="2.5" opacity="0.8"/>' +
          '<path d="M 161 235 L 163 279" stroke="#ffffff" stroke-width="2.5" opacity="0.8"/>' +
          '<path d="M 108 257 L 192 257" stroke="#ffffff" stroke-width="2.5" opacity="0.8"/>' +
          '<path d="M 115 240 L 185 240" stroke="#6cc4a4" stroke-width="3"/>'
      },
      bottom7: {
        name: "Denim Jeans",
        emoji: "👖",
        /* full-length pants ending ~y298 so the shoes still show */
        front:
          '<path d="M 114 232 L 186 232 L 176 298 L 152 298 L 151 262 ' +
          "Q 150 258 149 262 L 148 298 L 124 298 Z\" " +
          'fill="#5a8fd6" stroke="#3d6db3" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 116 241 L 184 241" stroke="#3d6db3" stroke-width="3.5"/>' +
          '<path d="M 128 246 Q 135 252 142 246" fill="none" stroke="#8fb7e8" stroke-width="2.5" stroke-linecap="round"/>' +
          '<path d="M 158 246 Q 165 252 172 246" fill="none" stroke="#8fb7e8" stroke-width="2.5" stroke-linecap="round"/>' +
          '<path d="M 122 268 Q 132 272 142 268" fill="none" stroke="#3d6db3" stroke-width="2.5" opacity="0.7" stroke-linecap="round"/>' +
          '<path d="M 158 268 Q 168 272 178 268" fill="none" stroke="#3d6db3" stroke-width="2.5" opacity="0.7" stroke-linecap="round"/>' +
          /* side stitching */
          '<path d="M 118 248 L 126 282" stroke="#a8c8ee" stroke-width="2.5" stroke-dasharray="5 4"/>' +
          '<path d="M 182 248 L 174 282" stroke="#a8c8ee" stroke-width="2.5" stroke-dasharray="5 4"/>' +
          /* folded cuffs */
          '<path d="M 127 289 L 146 289" stroke="#a8c8ee" stroke-width="5" stroke-linecap="round"/>' +
          '<path d="M 154 289 L 173 289" stroke="#a8c8ee" stroke-width="5" stroke-linecap="round"/>'
      },
      bottom8: {
        name: "Party Skirt",
        emoji: "🎉",
        front:
          '<path d="M 112 232 L 188 232 Q 208 252 214 278 Q 150 292 86 278 Q 92 252 112 232 Z" ' +
          'fill="#a56bd6" stroke="#8449c1" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 116 240 L 184 240" stroke="#8449c1" stroke-width="3"/>' +
          '<path d="M 96 273 Q 150 286 204 273" fill="none" stroke="#d29ce8" stroke-width="3" stroke-linecap="round"/>' +
          sparkle(126, 254, 5) + sparkle(168, 248, 4.5) + sparkle(150, 270, 6) +
          sparkle(106, 266, 4) + sparkle(192, 264, 4)
      }
    },

    shoes: {
      shoes1: {
        name: "Pink Sneakers",
        emoji: "👟",
        front:
          '<path d="M 128 298 L 152 298 L 152 318 L 120 318 Q 112 318 114 310 ' +
          'Q 116 302 128 298 Z" fill="#ff8fb8" stroke="#d9568a" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 118 312 L 152 312" stroke="#fff9ec" stroke-width="4" stroke-linecap="round"/>' +
          '<path d="M 131 303 Q 127 306 125 310" fill="none" stroke="#d9568a" stroke-width="2.5" stroke-linecap="round"/>' +
          '<path d="M 172 298 L 148 298 L 148 318 L 180 318 Q 188 318 186 310 ' +
          'Q 184 302 172 298 Z" fill="#ff8fb8" stroke="#d9568a" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 182 312 L 148 312" stroke="#fff9ec" stroke-width="4" stroke-linecap="round"/>' +
          '<path d="M 169 303 Q 173 306 175 310" fill="none" stroke="#d9568a" stroke-width="2.5" stroke-linecap="round"/>'
      },
      shoes2: {
        name: "Rain Boots",
        emoji: "🌧️",
        front:
          '<path d="M 128 296 L 152 296 L 152 322 L 116 322 Q 108 322 110 315 ' +
          'Q 113 308 124 306 L 128 306 Z" fill="#ffd93d" stroke="#e0b420" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 128 302 L 152 302" stroke="#e0b420" stroke-width="3"/>' +
          '<path d="M 172 296 L 148 296 L 148 322 L 184 322 Q 192 322 190 315 ' +
          'Q 187 308 176 306 L 172 306 Z" fill="#ffd93d" stroke="#e0b420" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 172 302 L 148 302" stroke="#e0b420" stroke-width="3"/>'
      },
      shoes3: {
        name: "Ballet Flats",
        emoji: "🎀",
        front:
          '<ellipse cx="138" cy="312" rx="15" ry="10" fill="#ffc7d9" stroke="#f287ad" stroke-width="4"/>' +
          '<path d="M 128 305 L 148 305" stroke="#f287ad" stroke-width="3" stroke-linecap="round"/>' +
          '<ellipse cx="162" cy="312" rx="15" ry="10" fill="#ffc7d9" stroke="#f287ad" stroke-width="4"/>' +
          '<path d="M 152 305 L 172 305" stroke="#f287ad" stroke-width="3" stroke-linecap="round"/>'
      },
      shoes4: {
        name: "Sparkle Sandals",
        emoji: "🌸",
        front:
          '<path d="M 126 308 Q 138 300 150 308" fill="none" stroke="#d29ce8" stroke-width="4" stroke-linecap="round"/>' +
          '<path d="M 124 310 L 152 310 Q 154 317 148 317 L 124 317 Q 118 317 118 313 ' +
          'Q 119 310 124 310 Z" fill="#d29ce8" stroke="#a56bd6" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 150 308 Q 162 300 174 308" fill="none" stroke="#d29ce8" stroke-width="4" stroke-linecap="round"/>' +
          '<path d="M 176 310 L 148 310 Q 146 317 152 317 L 176 317 Q 182 317 182 313 ' +
          'Q 181 310 176 310 Z" fill="#d29ce8" stroke="#a56bd6" stroke-width="3.5" stroke-linejoin="round"/>' +
          star(126, 302, 4, "#ffe9a8", "#e0b420") + star(174, 302, 4, "#ffe9a8", "#e0b420")
      },
      shoes5: {
        name: "Bunny Slippers",
        emoji: "🐰",
        front:
          /* ears first so the slipper tops tuck their bases in */
          '<ellipse cx="119" cy="291" rx="5" ry="12" transform="rotate(-32 119 291)" ' +
          'fill="#fff9ec" stroke="#f287ad" stroke-width="3"/>' +
          '<ellipse cx="130" cy="286" rx="5" ry="12" transform="rotate(-10 130 286)" ' +
          'fill="#fff9ec" stroke="#f287ad" stroke-width="3"/>' +
          '<ellipse cx="181" cy="291" rx="5" ry="12" transform="rotate(32 181 291)" ' +
          'fill="#fff9ec" stroke="#f287ad" stroke-width="3"/>' +
          '<ellipse cx="170" cy="286" rx="5" ry="12" transform="rotate(10 170 286)" ' +
          'fill="#fff9ec" stroke="#f287ad" stroke-width="3"/>' +
          /* fluffy slippers */
          '<path d="M 128 297 L 152 297 L 152 318 L 120 318 Q 111 318 112 309 ' +
          'Q 114 300 128 297 Z" fill="#fff9ec" stroke="#f287ad" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 115 311 Q 133 315 152 311" fill="none" stroke="#f287ad" stroke-width="2.5" stroke-linecap="round"/>' +
          '<circle cx="118" cy="305" r="2.6" fill="#ffc9dc"/>' +
          '<path d="M 172 297 L 148 297 L 148 318 L 180 318 Q 189 318 188 309 ' +
          'Q 186 300 172 297 Z" fill="#fff9ec" stroke="#f287ad" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 185 311 Q 167 315 148 311" fill="none" stroke="#f287ad" stroke-width="2.5" stroke-linecap="round"/>' +
          '<circle cx="182" cy="305" r="2.6" fill="#ffc9dc"/>'
      },
      shoes6: {
        name: "Sport Sneakers",
        emoji: "⚡",
        front:
          '<path d="M 128 298 L 152 298 L 152 318 L 120 318 Q 112 318 114 310 ' +
          'Q 116 302 128 298 Z" fill="#4a90e2" stroke="#3273b8" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 114 310 L 152 310 L 152 318 L 120 318 Q 112 318 114 310 Z" ' +
          'fill="#fff9ec" stroke="#3273b8" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 137 301 L 130 306 L 134 306 L 128 310" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<path d="M 172 298 L 148 298 L 148 318 L 180 318 Q 188 318 186 310 ' +
          'Q 184 302 172 298 Z" fill="#4a90e2" stroke="#3273b8" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 186 310 L 148 310 L 148 318 L 180 318 Q 188 318 186 310 Z" ' +
          'fill="#fff9ec" stroke="#3273b8" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 163 301 L 170 306 L 166 306 L 172 310" fill="none" stroke="#ffffff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'
      }
    },

    extra: {
      extra1: {
        name: "Strawberry Bow",
        emoji: "🍓",
        front:
          '<path d="M 188 42 Q 196 34 204 42 Q 200 46 196 44 Q 192 46 188 42 Z" ' +
          'fill="#6bd66b" stroke="#3fa93f" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<path d="M 196 72 C 186 70 178 58 180 48 C 182 40 192 38 196 44 ' +
          "C 200 38 210 40 212 48 C 214 58 206 70 196 72 Z" +
          '" fill="#ff6b6b" stroke="#e04b4b" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<circle cx="190" cy="50" r="1.4" fill="#ffffff"/>' +
          '<circle cx="202" cy="50" r="1.4" fill="#ffffff"/>' +
          '<circle cx="196" cy="58" r="1.4" fill="#ffffff"/>'
      },
      extra2: {
        name: "Magic Wand",
        emoji: "🪄",
        front:
          '<path d="M 202 226 L 226 200" stroke="#e0b420" stroke-width="5" stroke-linecap="round"/>' +
          star(234, 190, 12, "#ffd93d", "#e0b420") +
          '<circle cx="248" cy="176" r="2.5" fill="#ffe9a8"/>' +
          '<circle cx="224" cy="172" r="2" fill="#ffe9a8"/>'
      },
      extra3: {
        name: "Sun Hat",
        emoji: "👒",
        front:
          '<path d="M 106 50 Q 106 20 150 20 Q 194 20 194 50 Z" ' +
          'fill="#ffd93d" stroke="#e0b420" stroke-width="4" stroke-linejoin="round"/>' +
          '<path d="M 106 40 Q 150 46 194 40 L 194 48 Q 150 54 106 48 Z" fill="#ff8fb8"/>' +
          '<ellipse cx="150" cy="50" rx="76" ry="14" fill="#ffd93d" stroke="#e0b420" stroke-width="4"/>'
      },
      extra4: {
        name: "Tiny Backpack",
        emoji: "🎒",
        back:
          '<rect x="100" y="184" width="100" height="74" rx="22" ' +
          'fill="#ff8fb8" stroke="#d9568a" stroke-width="4"/>' +
          '<path d="M 108 224 Q 150 216 192 224" fill="none" stroke="#d9568a" ' +
          'stroke-width="3" stroke-linecap="round"/>',
        front:
          '<path d="M 128 170 L 134 206" stroke="#d9568a" stroke-width="7" stroke-linecap="round"/>' +
          '<path d="M 172 170 L 166 206" stroke="#d9568a" stroke-width="7" stroke-linecap="round"/>'
      },
      extra5: {
        name: "Party Hat",
        emoji: "🥳",
        front:
          '<path d="M 150 10 L 184 62 Q 150 72 116 62 Z" ' +
          'fill="#ff8fb8" stroke="#d9568a" stroke-width="4" stroke-linejoin="round"/>' +
          /* bold candy stripes kept inside the cone edges */
          '<path d="M 136 33 L 164 33 L 169 43 L 131 43 Z" ' +
          'fill="#ffd93d" stroke="#e0b420" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<path d="M 127 48 L 173 48 L 179 58 L 121 58 Z" ' +
          'fill="#a56bd6" stroke="#8449c1" stroke-width="2.5" stroke-linejoin="round"/>' +
          '<circle cx="150" cy="10" r="9" fill="#a56bd6" stroke="#8449c1" stroke-width="3.5"/>'
      },
      extra6: {
        name: "Flower Crown",
        emoji: "🌼",
        front:
          '<path d="M 96 92 Q 150 72 204 92" fill="none" stroke="#3fa93f" stroke-width="5" stroke-linecap="round"/>' +
          /* five simple four-petal daisies along the vine */
          '<circle cx="107" cy="83.5" r="4.2" fill="#ff8fb8"/>' +
          '<circle cx="111.5" cy="88" r="4.2" fill="#ff8fb8"/>' +
          '<circle cx="107" cy="92.5" r="4.2" fill="#ff8fb8"/>' +
          '<circle cx="102.5" cy="88" r="4.2" fill="#ff8fb8"/>' +
          '<circle cx="107" cy="88" r="2.8" fill="#ffd93d" stroke="#e0b420" stroke-width="1.8"/>' +
          '<circle cx="128" cy="79.5" r="4.2" fill="#fff9ec"/>' +
          '<circle cx="132.5" cy="84" r="4.2" fill="#fff9ec"/>' +
          '<circle cx="128" cy="88.5" r="4.2" fill="#fff9ec"/>' +
          '<circle cx="123.5" cy="84" r="4.2" fill="#fff9ec"/>' +
          '<circle cx="128" cy="84" r="2.8" fill="#ffd93d" stroke="#e0b420" stroke-width="1.8"/>' +
          '<circle cx="150" cy="77.5" r="4.4" fill="#ffd93d"/>' +
          '<circle cx="154.5" cy="82" r="4.4" fill="#ffd93d"/>' +
          '<circle cx="150" cy="86.5" r="4.4" fill="#ffd93d"/>' +
          '<circle cx="145.5" cy="82" r="4.4" fill="#ffd93d"/>' +
          '<circle cx="150" cy="82" r="2.8" fill="#ffffff" stroke="#e0b420" stroke-width="1.8"/>' +
          '<circle cx="172" cy="79.5" r="4.2" fill="#fff9ec"/>' +
          '<circle cx="176.5" cy="84" r="4.2" fill="#fff9ec"/>' +
          '<circle cx="172" cy="88.5" r="4.2" fill="#fff9ec"/>' +
          '<circle cx="167.5" cy="84" r="4.2" fill="#fff9ec"/>' +
          '<circle cx="172" cy="84" r="2.8" fill="#ffd93d" stroke="#e0b420" stroke-width="1.8"/>' +
          '<circle cx="193" cy="83.5" r="4.2" fill="#ff8fb8"/>' +
          '<circle cx="197.5" cy="88" r="4.2" fill="#ff8fb8"/>' +
          '<circle cx="193" cy="92.5" r="4.2" fill="#ff8fb8"/>' +
          '<circle cx="188.5" cy="88" r="4.2" fill="#ff8fb8"/>' +
          '<circle cx="193" cy="88" r="2.8" fill="#ffd93d" stroke="#e0b420" stroke-width="1.8"/>'
      },
      extra7: {
        name: "Cat Ears",
        emoji: "🐱",
        front:
          '<path d="M 106 60 L 114 18 L 142 46 Q 124 56 106 60 Z" ' +
          'fill="#fff9ec" stroke="#f287ad" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 194 60 L 186 18 L 158 46 Q 176 56 194 60 Z" ' +
          'fill="#fff9ec" stroke="#f287ad" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 113 50 L 117 30 L 131 44 Q 122 48 113 50 Z" fill="#ffc9dc"/>' +
          '<path d="M 187 50 L 183 30 L 169 44 Q 178 48 187 50 Z" fill="#ffc9dc"/>'
      }
    },

    /* Swimsuits — worn UNDER the clothes (layer right after "body").
       buildSVG only paints this layer while the wardrobe preview hides
       both top/bottom layers (see setPreviewSkip + swimsuitPreview), so a
       suit never peeks out around normal clothes. Plain fills
       only (no palette tokens); the `colors` block is the contract the
       canvas beach rig reads to recolor the swimsuit on the sand. */
    swimsuit: {
      suit1: {
        name: "Sunny One-Piece",
        emoji: "🌼",
        /* one-piece hugging the real torso rect (116..184 x 164..250):
           shoulder tips at (119,170)/(181,170) over the arm sockets,
           scoop neck dipping to ~172, sides at x114/x186 down to the
           hips, two short leg tabs (x131..145 / x155..169) ending at
           the upper-thigh crotch line y262 with the gap exposed */
        front:
          '<path d="M 127 165 Q 150 180 173 165 L 181 170 Q 176 181 185 193 ' +
          'L 186 238 Q 186 253 169 262 L 155 262 Q 151 262 150 255 ' +
          'Q 149 262 145 262 L 131 262 Q 114 253 114 238 L 115 193 ' +
          'Q 124 181 119 170 Z" ' +
          'fill="#ffd93d" stroke="#ff9a3d" stroke-width="3.5" stroke-linejoin="round"/>' +
          /* daisy on the chest: four petals + orange center */
          '<circle cx="150" cy="185.5" r="3.2" fill="#fff9ec"/>' +
          '<circle cx="154.5" cy="190" r="3.2" fill="#fff9ec"/>' +
          '<circle cx="150" cy="194.5" r="3.2" fill="#fff9ec"/>' +
          '<circle cx="145.5" cy="190" r="3.2" fill="#fff9ec"/>' +
          '<circle cx="150" cy="190" r="2.6" fill="#ff9a3d"/>',
        colors: { main: "#ffd93d", trim: "#ff9a3d", bottom: "#ffd93d", twoPiece: false }
      },
      suit2: {
        name: "Bubblegum Tankini",
        emoji: "🎀",
        /* Full-coverage tankini: vest overlaps high-waisted shorts
           that cover the hips before splitting below the torso. */
        front:
          '<path d="' + SWIM_SHORTS_PATH + '" ' +
          'fill="#ff8fb8" stroke="#d9568a" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 124 165 Q 150 175 176 165 L 183 170 Q 178 181 185 193 ' +
          'L 185 214 Q 150 225 115 214 L 115 193 Q 122 181 117 170 Z" ' +
          'fill="#ff8fb8" stroke="#d9568a" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 121 172 Q 135 181 150 173 Q 165 181 179 172" ' +
          'fill="none" stroke="#d9568a" stroke-width="2.5" stroke-linecap="round"/>' +
          '<circle cx="144" cy="184" r="4" fill="#d9568a"/>' +
          '<circle cx="156" cy="184" r="4" fill="#d9568a"/>' +
          '<circle cx="150" cy="184" r="2.4" fill="#fff9ec"/>',
        colors: { main: "#ff8fb8", trim: "#d9568a", bottom: "#ff8fb8", twoPiece: true }
      },
      suit3: {
        name: "Ocean Sport",
        emoji: "🐠",
        /* one-piece, V'd neckline (apex y180) between shoulder tips on
           the arm sockets (118,169)/(182,169), sides x114/x186, short
           leg tabs x131..145 / x155..169 to the crotch line y262;
           little fish on the belly */
        front:
          '<path d="M 129 164 L 150 180 L 171 164 L 182 169 Q 176 181 185 193 ' +
          'L 186 238 Q 186 253 169 262 L 155 262 Q 151 262 150 255 ' +
          'Q 149 262 145 262 L 131 262 Q 114 253 114 238 L 115 193 ' +
          'Q 124 181 118 169 Z" ' +
          'fill="#4fc3d9" stroke="#2b93b6" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<ellipse cx="153" cy="216" rx="8" ry="5.5" fill="#fff9ec"/>' +
          '<path d="M 145 216 L 137 210 L 137 222 Z" fill="#fff9ec"/>' +
          '<circle cx="156" cy="214.5" r="1.6" fill="#2b93b6"/>',
        colors: { main: "#4fc3d9", trim: "#2b93b6", bottom: "#4fc3d9", twoPiece: false }
      },
      suit4: {
        name: "Strawberry Tankini",
        emoji: "🍓",
        /* Tank top with scalloped ruffle and strawberry, overlapping
           the same full-hip shorts as the Bubblegum Tankini. */
        front:
          '<path d="' + SWIM_SHORTS_PATH + '" ' +
          'fill="#ff6f91" stroke="#ffd3e0" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 124 165 Q 150 175 176 165 L 183 170 Q 178 181 185 193 ' +
          'L 185 214 Q 150 225 115 214 L 115 193 Q 122 181 117 170 Z" ' +
          'fill="#ff6f91" stroke="#ffd3e0" stroke-width="3.5" stroke-linejoin="round"/>' +
          /* scalloped ruffle riding just below the vest hem */
          '<path d="M 117 215 Q 122 222 128 216 Q 134 223 140 218 ' +
          'Q 146 224 152 218 Q 158 223 164 218 Q 170 223 176 216 Q 180 221 183 215" ' +
          'fill="none" stroke="#ffd3e0" stroke-width="3.5" stroke-linecap="round"/>' +
          /* cream strawberry on the chest */
          '<path d="M 150 195 C 143 191 141 182 145 179 C 148 177 150 180 150 181 ' +
          'C 150 180 152 177 155 179 C 159 182 157 191 150 195 Z" ' +
          'fill="#fff9ec" stroke="#ffd3e0" stroke-width="2"/>' +
          '<circle cx="148" cy="186" r="1" fill="#ff6f91"/>' +
          '<circle cx="152" cy="189" r="1" fill="#ff6f91"/>',
        colors: { main: "#ff6f91", trim: "#ffd3e0", bottom: "#ff6f91", twoPiece: true }
      },
      suit5: {
        name: "Citrus Stripe Set",
        emoji: "🍊",
        /* Shorter striped top still overlaps the y200 waistband;
           shared shorts keep the full hips and upper legs covered. */
        front:
          '<path d="' + SWIM_SHORTS_PATH + '" ' +
          'fill="#ff9a3c" stroke="#ffd93d" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 125 165 Q 150 174 175 165 L 182 170 Q 177 181 184 192 ' +
          'L 184 203 Q 150 214 116 203 L 116 192 Q 123 181 118 170 Z" ' +
          'fill="#ff9a3c" stroke="#ffd93d" stroke-width="3.5" stroke-linejoin="round"/>' +
          /* three vertical stripes following the crop-top height */
          '<path d="M 135 171 L 133 197" stroke="#ffd93d" stroke-width="5" stroke-linecap="round" opacity="0.95"/>' +
          '<path d="M 150 174 L 150 200" stroke="#ffd93d" stroke-width="5" stroke-linecap="round" opacity="0.95"/>' +
          '<path d="M 165 171 L 167 197" stroke="#ffd93d" stroke-width="5" stroke-linecap="round" opacity="0.95"/>' +
          '<path d="M 134 248 L 134 262" stroke="#ffd93d" stroke-width="4" stroke-linecap="round" opacity="0.9"/>' +
          '<path d="M 166 248 L 166 262" stroke="#ffd93d" stroke-width="4" stroke-linecap="round" opacity="0.9"/>',
        colors: { main: "#ff9a3c", trim: "#ffd93d", bottom: "#ff9a3c", twoPiece: true }
      },
      suit6: {
        name: "Lavender Ruffle",
        emoji: "💜",
        /* one-piece hugging the torso (scoop neck dip ~172, side seams
           x114/x186, leg tabs x131..145 / x155..169 to the crotch line
           y262) with a scalloped ruffle under the neckline and small
           frill arcs riding on both leg hems */
        front:
          '<path d="M 127 164 Q 150 179 173 164 L 181 170 Q 176 181 185 193 ' +
          'L 186 238 Q 186 253 169 262 L 155 262 Q 151 262 150 255 ' +
          'Q 149 262 145 262 L 131 262 Q 114 253 114 238 L 115 193 ' +
          'Q 124 181 119 170 Z" ' +
          'fill="#b79cf0" stroke="#8f6fe0" stroke-width="3.5" stroke-linejoin="round"/>' +
          '<path d="M 128 168 Q 133 177 139 170 Q 145 178 151 171 ' +
          'Q 157 177 163 170 Q 168 176 172 168" ' +
          'fill="none" stroke="#8f6fe0" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M 132 258 Q 136 265 140 259 Q 144 265 148 260" ' +
          'fill="none" stroke="#8f6fe0" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M 152 260 Q 156 265 160 259 Q 164 265 168 258" ' +
          'fill="none" stroke="#8f6fe0" stroke-width="3" stroke-linecap="round"/>',
        colors: { main: "#b79cf0", trim: "#8f6fe0", bottom: "#b79cf0", twoPiece: false }
      }
    }
  };

  /* ---------- Paint order (bottom -> top) ---------- */

  const LAYER_ORDER = [
    "shadow", "hair-back", "extra-back", "body", "swimsuit",
    "top", "bottom", "shoes", "hair-front", "extra-front"
  ];

  /* Builds the markup for one layer group from the outfit.
     Hair paints 'back' into hair-back and 'front' (fringe) into
     hair-front; extra can have a behind-the-body part (extra-back). */
  function layerMarkup(slot, part, outfit) {
    const id = outfit ? outfit[slot] : null;
    if (!id) return "";
    const item = CATALOG[slot] && CATALOG[slot][id];
    if (!item) return "";
    const markup = item[part];
    return typeof markup === "string" ? markup : "";
  }

  /* Keep the preview on its container, never on the shared outfit or
     another screen's instance. Copy the list so callers cannot mutate it. */
  function setPreviewSkip(containerEl, slots) {
    if (!containerEl || typeof containerEl.innerHTML !== "string") return;
    const opts = instances.get(containerEl) || { size: "big", characterId: null };
    opts.previewSkip = Array.isArray(slots)
      ? slots.filter(function (layer) { return LAYER_ORDER.indexOf(layer) !== -1; })
      : null;
    instances.set(containerEl, opts);
    render(containerEl, opts);
  }

  function buildSVG(outfit, sizeClass, characterId, previewSkip) {
    const character = CHARACTERS[characterId] || CHARACTERS.lily;
    /* Dress coverage is separate from preview mode: suppressing its
       bottom must never reveal a swimsuit underneath the dress. */
    const swimsuitPreview = !!previewSkip &&
      previewSkip.indexOf("top") !== -1 && previewSkip.indexOf("bottom") !== -1;
    const top = CATALOG.top[outfit.top];
    const coversBottom = top && top.coversBottom &&
      (!previewSkip || previewSkip.indexOf("top") === -1);
    const layers = LAYER_ORDER.slice();
    if (top && top.untucked) {
      layers.splice(layers.indexOf("top"), 2, "bottom", "top");
    }
    const groups = layers.map(function (layer) {
      let inner = "";
      const skipped = (previewSkip && previewSkip.indexOf(layer) !== -1) ||
        (layer === "bottom" && coversBottom);
      if (!skipped) {
        if (layer === "body") {
          inner = applyPalette(BODY_MARKUP, characterId);
        } else if (layer === "swimsuit") {
          inner = swimsuitPreview
            ? applyPalette(layerMarkup("swimsuit", "front", outfit), characterId)
            : "";
        } else if (layer === "hair-back") {
          inner = applyPalette(layerMarkup("hair", "back", outfit), characterId);
        } else if (layer === "hair-front") {
          inner = applyPalette(layerMarkup("hair", "front", outfit), characterId);
        } else if (layer === "extra-back") {
          inner = layerMarkup("extra", "back", outfit);
        } else if (layer === "extra-front") {
          inner = layerMarkup("extra", "front", outfit);
        } else if (layer === "shadow") {
          inner = '<ellipse cx="150" cy="328" rx="58" ry="10" fill="#3a2e6e" opacity="0.10"/>';
        } else {
          inner = layerMarkup(layer, "front", outfit);
        }
      }
      return '<g data-layer="' + layer + '">' + inner + "</g>";
    }).join("\n    ");

    return (
      '<svg class="character ' + sizeClass + '" xmlns="http://www.w3.org/2000/svg" ' +
      'viewBox="0 0 300 340" role="img" aria-label="' + character.name + '">' +
      "<title>" + character.name + "</title>" +
      "<desc>" + character.name + ", a cheerful cartoon girl, wearing her dress-up outfit.</desc>" +
      '<g class="character-root">\n    ' + groups + "\n  </g>" +
      "</svg>"
    );
  }

  /* ---------- Instance registry (auto refresh on outfit change) ---------- */

  const instances = new Map(); // container -> { size, characterId, previewSkip }

  function refreshAll() {
    instances.forEach(function (opts, container) {
      if (!container.isConnected) {
        instances.delete(container);
        return;
      }
      render(container, opts);
    });
  }

  /* ---------- Public API ---------- */

  function render(containerEl, opts) {
    if (!containerEl || typeof containerEl.innerHTML !== "string") return null;
    const size = opts && opts.size === "small" ? "small" : "big";
    const outfit = window.GameState && typeof window.GameState.getOutfit === "function"
      ? window.GameState.getOutfit()
      : { hair: "hair1", top: "top1", bottom: "bottom1", shoes: "shoes1", extra: null, swimsuit: "suit1" };
    /* Optional per-instance character override (Friends screen previews);
       otherwise paint whoever the player chose globally. */
    const override = opts && typeof opts.characterId === "string" && opts.characterId
      ? opts.characterId
      : null;
    const characterId = override ||
      (window.GameState && typeof window.GameState.getCharacter === "function"
        ? window.GameState.getCharacter().id
        : "lily");

    const previous = instances.get(containerEl);
    const previewSkip = previous ? previous.previewSkip : null;
    containerEl.innerHTML = buildSVG(outfit, size === "small" ? "character-small" : "character-big", characterId, previewSkip);
    const svg = containerEl.querySelector("svg.character");
    instances.set(containerEl, { size: size, characterId: override, previewSkip: previewSkip });
    return svg;
  }

  /* Padded art bounds work even in detached/hidden picker buttons, where
     getBBox() cannot reliably measure. Extras need individual crops. */
  const ITEM_VIEWBOXES = {
    hair: "24 12 252 232",
    top: "82 150 136 112",
    bottom: "72 222 156 86",
    shoes: "98 262 104 72",
    swimsuit: "102 154 96 132",
    extra: {
      extra1: "170 28 52 54",
      extra2: "192 162 68 76",
      extra3: "64 10 172 64",
      extra4: "90 158 120 110",
      extra5: "106 -10 88 88",
      extra6: "86 64 128 42",
      extra7: "96 8 108 64"
    }
  };

  function renderItemPreview(containerEl, slot, itemId, opts) {
    if (!containerEl || typeof containerEl.innerHTML !== "string" ||
        typeof containerEl.querySelector !== "function") return null;
    containerEl.innerHTML = "";
    if (typeof slot !== "string" || !Object.prototype.hasOwnProperty.call(CATALOG, slot)) return null;
    const emptyExtra = slot === "extra" && (itemId == null || itemId === "");
    const items = CATALOG[slot];
    if (!emptyExtra && (typeof itemId !== "string" || !Object.prototype.hasOwnProperty.call(items, itemId))) return null;
    const item = emptyExtra ? null : items[itemId];
    const characterId = opts && typeof opts.characterId === "string" && opts.characterId
      ? opts.characterId
      : (window.GameState && typeof window.GameState.getCharacter === "function"
        ? window.GameState.getCharacter().id : "lily");
    const markup = item ? (item.back || "") + (item.front || "")
      : '<circle cx="24" cy="24" r="16" fill="none" stroke="#c9bfcf" stroke-width="3"/>' +
        '<path d="M 15 24 H 33" stroke="#c9bfcf" stroke-width="3" stroke-linecap="round"/>';
    const viewBox = emptyExtra ? "0 0 48 48"
      : slot === "extra" ? ITEM_VIEWBOXES.extra[itemId]
      : slot === "top" && item.coversBottom ? "82 150 136 146"
      : ITEM_VIEWBOXES[slot];
    containerEl.innerHTML = '<svg class="wardrobe-item-preview" xmlns="http://www.w3.org/2000/svg" ' +
      'viewBox="' + viewBox + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">' +
      applyPalette(markup, characterId) + '</svg>';
    return containerEl.querySelector("svg.wardrobe-item-preview");
  }

  /* Unregister a container so refreshAll() stops repainting it. Callers
     that clear or remove a rendered element for good (old map markers,
     finished walkers) must use this — otherwise a cleared marker still
     sitting in the DOM gets a fresh Lily painted back into it on the
     next GameState change. */
  function forget(containerEl) {
    if (!containerEl) return;
    instances.delete(containerEl);
  }

  function getItemName(slot, id) {
    const items = CATALOG[slot];
    if (!items) return null;
    const item = items[id];
    return item && item.name ? item.name : null;
  }

  function onChanged(callback) {
    if (window.GameState && typeof window.GameState.onChange === "function") {
      return window.GameState.onChange(callback);
    }
    return function noopUnsubscribe() {};
  }

  const ANIMATION_NAMES = ["bounce", "cheer", "eat"];

  function playAnimation(containerEl, animationName) {
    if (!containerEl || typeof containerEl.querySelector !== "function") return;
    const name = ANIMATION_NAMES.indexOf(animationName) !== -1 ? animationName : "bounce";
    const svg = containerEl.querySelector("svg.character");
    if (!svg) return;

    ANIMATION_NAMES.forEach(function (a) {
      svg.classList.remove("character-anim-" + a);
    });
    // Force a reflow so re-triggering the same animation restarts it.
    void svg.getBoundingClientRect();
    svg.classList.add("character-anim-" + name);

    function cleanup() {
      svg.classList.remove("character-anim-" + name);
      svg.removeEventListener("animationend", cleanup);
    }
    svg.addEventListener("animationend", cleanup);
    // Safety net in case animationend never fires (display:none etc).
    window.setTimeout(cleanup, 2500);
  }

  /* ---------- Bootstrap: auto-render every .character-stage ---------- */

  function init() {
    document.querySelectorAll(".character-stage").forEach(function (el) {
      render(el, { size: "big" });
    });
    // All registered instances re-render automatically on any outfit change.
    if (window.GameState && typeof window.GameState.onChange === "function") {
      window.GameState.onChange(refreshAll);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.CharacterRenderer = {
    render: render,
    renderItemPreview: renderItemPreview,
    forget: forget,
    getItemName: getItemName,
    catalog: CATALOG,
    onChanged: onChanged,
    playAnimation: playAnimation,
    setPreviewSkip: setPreviewSkip
  };

  /* Convenience alias for other files (wardrobe/kitchen item pickers). */
  window.CharacterCatalog = CATALOG;
})();
