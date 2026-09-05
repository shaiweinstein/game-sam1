/* ============================================================
   Lily's Dress-Up Adventure — beach character body-part art
   (window.BeachParts)

   The 12 clean SVG parts ported VERBATIM from spike/parts.html
   (Lily beach rig, first pass), parameterized by a palette,
   plus a rasterizer that renders each part to a square canvas
   with the part's PIVOT JOINT exactly at the canvas center, and
   the skeleton table a later Phaser rig builds on top.

   All coordinates are in 400x400 "viewBox space", y-down.

   Public API (window.BeachParts):
     DEFAULT_PALETTE  { skin, skinLine, face, hair, hairLine,
                        blush, suit, suitLine, suitPetal }
     paletteFor(charColors, suitColors) -> palette
       charColors: { skin, skinShade, face, hairMain, hairShade }
                    (null/partial ok, invalid -> default)
       suitColors: { main, trim, ... } (null/partial ok,
       invalid -> default; blush/suitPetal are fixed)
     PARTS            12 records { id, z, pivot, axis, bbox,
                       svg(P) }; axis = [proximal, distal] joint
                       for limbs (null for upright parts)
     render(P, scale) -> Promise<{ [id]: { canvas, w, h, half } }>
       scale = canvas px per viewBox unit (default 2). Each
       canvas is a square, pivot at its exact center, so a
       sprite with origin (0.5,0.5) placed at the joint and
       rotated by the bone angle is exactly right.
     SKELETON         13 bones { name, parent, pivot, part },
                      parent-before-child
     METRICS          { hipX, hipY, feetY, headTopY, height,
                        hipAboveFeet } in viewBox units
     svgDocument(P,id)-> standalone <svg> string for one part —
                      the exact string render() rasterizes
   ============================================================ */

(function () {
  "use strict";

  const DEFAULT_PALETTE = {
    skin: '#ffdcc0', skinLine: '#e8b48e', face: '#4a3226',
    hair: '#8a5a3a', hairLine: '#5e3a22', blush: '#ffc9dc',
    suit: '#ffd93d', suitLine: '#ff9a3d', suitPetal: '#fff9ec'
  };

  /* ---------- palette ---------- */

  /* Accept a '#rrggbb' string (3-digit ok) or a number 0xRRGGBB;
     anything else -> def. Output normalized to lowercase '#rrggbb'. */
  function normHex(v, def) {
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 0xffffff) {
      return '#' + v.toString(16).padStart(6, '0');
    }
    if (typeof v === 'string') {
      const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
      if (m) {
        const h = m[1].length === 3
          ? m[1].split('').map(c => c + c).join('')
          : m[1];
        return '#' + h.toLowerCase();
      }
    }
    return def;
  }

  function paletteFor(charColors, suitColors) {
    const c = charColors || {};
    const s = suitColors || {};
    return {
      skin: normHex(c.skin, DEFAULT_PALETTE.skin),
      skinLine: normHex(c.skinShade, DEFAULT_PALETTE.skinLine),
      face: normHex(c.face, DEFAULT_PALETTE.face),
      hair: normHex(c.hairMain, DEFAULT_PALETTE.hair),
      hairLine: normHex(c.hairShade, DEFAULT_PALETTE.hairLine),
      blush: DEFAULT_PALETTE.blush,
      suit: normHex(s.main, DEFAULT_PALETTE.suit),
      suitLine: normHex(s.trim, DEFAULT_PALETTE.suitLine),
      suitPetal: DEFAULT_PALETTE.suitPetal
    };
  }

  /* ---------- art (ported verbatim from spike/parts.html) ---------- */

  const sk = (P, d) => `<path d="${d}" fill="${P.skin}" stroke="${P.skinLine}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
  const hr = (P, d) => `<path d="${d}" fill="${P.hair}" stroke="${P.hairLine}" stroke-width="3" stroke-linejoin="round"/>`;
  const strand = (P, d) => `<path d="${d}" fill="none" stroke="${P.hairLine}" stroke-width="1.8" stroke-linecap="round" opacity="0.45"/>`;
  /* "Sunny One-Piece": fitted top edge along the shoulder line, sides hug
     the waist pinch + hip swell; daisy on the chest. Colors come ONLY
     from P.suit (main), P.suitLine (trim/outline + daisy center) and
     P.suitPetal (petals) — swap the suit by changing those tokens. */
  const sunnyOnePiece = (P) =>
    `<path d="M 170 168 C 170 162 177 160 184 160 C 190 160 193 176 200 176 C 207 176 210 160 216 160 C 223 160 230 162 230 168 C 228 184 224 199 219 207 C 216.5 225 220.5 239 222.5 246.5 Q 225 255 221 269 Q 210 275 203 274 Q 200 266 197 274 Q 190 275 179 269 Q 175 255 177.5 246.5 C 179.5 239 183.5 225 181 207 C 176.5 199 172 184 170 168 Z" fill="${P.suit}" stroke="${P.suitLine}" stroke-width="3.5" stroke-linejoin="round"/>`
    + `<circle cx="200" cy="190.5" r="3.2" fill="${P.suitPetal}"/>`
    + `<circle cx="204.5" cy="195" r="3.2" fill="${P.suitPetal}"/>`
    + `<circle cx="200" cy="199.5" r="3.2" fill="${P.suitPetal}"/>`
    + `<circle cx="195.5" cy="195" r="3.2" fill="${P.suitPetal}"/>`
    + `<circle cx="200" cy="195" r="2.6" fill="${P.suitLine}"/>`;

  const PARTS = [
    /* bob mass BEHIND the head: hugs the sides, rounded bottom to ~chin level, subtle strand lines */
    { id: 'hair-back', z: 1, pivot: [200, 152], axis: null, bbox: [132, 36, 136, 140],
      svg: P => hr(P, "M 200 44.1 C 153 44.1 140.8 84.1 144.3 120.7 C 146.1 141.6 142.6 153.7 146.1 160.7 Q 152.2 166.8 158.7 163.3 C 163.5 143.3 163.5 126.5 165.2 113.5 L 234.8 113.5 C 236.5 126.5 236.5 143.3 241.3 163.3 Q 247.8 166.8 253.9 160.7 C 257.4 153.7 253.9 141.6 255.7 120.7 C 259.2 84.1 247 44.1 200 44.1 Z")
        + strand(P, "M 149.5 63.3 C 142.6 91.9 140.8 126.5 147.8 160.7")
        + strand(P, "M 250.5 63.3 C 257.4 91.9 259.2 126.5 252.2 160.7")
        + strand(P, "M 179.1 46 C 191.3 47.8 208.7 47.8 220.9 46") },

    /* face (hero part) — big round head, one soft outline */
    { id: 'head', z: 7, pivot: [200, 152], axis: null, bbox: [140, 40, 120, 120],
      svg: P => `<ellipse cx="200" cy="100" rx="50.5" ry="52" fill="${P.skin}" stroke="${P.skinLine}" stroke-width="3"/>`
        + `<ellipse cx="180.9" cy="98.9" rx="7.8" ry="10.4" fill="${P.face}"/>`
        + `<ellipse cx="219.1" cy="98.9" rx="7.8" ry="10.4" fill="${P.face}"/>`
        + `<circle cx="183.9" cy="94.1" r="3" fill="#ffffff"/>`
        + `<circle cx="216.1" cy="94.1" r="3" fill="#ffffff"/>`
        + `<circle cx="178.3" cy="104.2" r="1.5" fill="#ffffff" opacity="0.85"/>`
        + `<circle cx="216.5" cy="104.2" r="1.5" fill="#ffffff" opacity="0.85"/>`
        + `<ellipse cx="163.5" cy="119.8" rx="9.6" ry="6.1" fill="${P.blush}" opacity="0.8"/>`
        + `<ellipse cx="236.5" cy="119.8" rx="9.6" ry="6.1" fill="${P.blush}" opacity="0.8"/>`
        + `<path d="M 187.8 121.6 Q 200 135.5 212.2 121.6" fill="none" stroke="${P.face}" stroke-width="3.9" stroke-linecap="round"/>` },

    /* fringe / bangs over the forehead, sits on top of the head */
    { id: 'hair-front', z: 8, pivot: [200, 152], axis: null, bbox: [142, 38, 116, 66],
      svg: P => hr(P, "M 151.3 96.3 C 151.3 61.5 172.2 45.9 200 45.9 C 227.8 45.9 248.7 61.5 248.7 96.3 C 238.3 84.1 222.6 80.7 200 80.7 C 177.4 80.7 161.7 84.1 151.3 96.3 Z") },

    /* skin torso + simple neck, with the swappable "Sunny One-Piece" suit on top */
    { id: 'torso', z: 4, pivot: [200, 250], axis: null, bbox: [156, 136, 88, 142],
      svg: P => `<rect x="189" y="148" width="22" height="24" rx="8" fill="${P.skin}" stroke="${P.skinLine}" stroke-width="2.5"/>`
        + sk(P, "M 170 168 C 170 162 177 160 186 160 L 214 160 C 223 160 230 162 230 168 C 231 186 226 200 221 208 C 218 226 222 240 224 248 C 224 252 215 254 200 254 C 185 254 176 252 176 248 C 178 240 182 226 179 208 C 174 200 169 186 170 168 Z")
        + sunnyOnePiece(P) },

    { id: 'upper-arm-L', z: 5, pivot: [170, 168], axis: [[170, 168], [154, 187]], bbox: [136, 148, 56, 56],
      svg: P => sk(P, "M 163.5 162.5 L 148.6 182.5 A 7 7 0 0 0 159.4 191.5 L 176.5 173.5 A 8.5 8.5 0 0 0 163.5 162.5 Z") },

    { id: 'upper-arm-R', z: 5, pivot: [230, 168], axis: [[230, 168], [246, 187]], bbox: [208, 148, 56, 56],
      svg: P => sk(P, "M 223.5 173.5 L 240.6 191.5 A 7 7 0 0 0 251.4 182.5 L 236.5 162.5 A 8.5 8.5 0 0 0 223.5 173.5 Z") },

    { id: 'forearm-hand-L', z: 6, pivot: [154, 187], axis: [[154, 187], [143, 205]], bbox: [118, 172, 58, 70],
      svg: P => sk(P, "M 148 183.3 L 138.7 202.4 A 5 5 0 0 0 147.3 207.6 L 160 190.7 A 7 7 0 0 0 148 183.3 Z")
        + sk(P, "M 136 207 C 131 212 131 220 136 225 C 140 228 147 227 149 221 C 150 215 148 209 144 207 C 141 205 139 205 136 207 Z") },

    { id: 'forearm-hand-R', z: 6, pivot: [246, 187], axis: [[246, 187], [257, 205]], bbox: [224, 172, 58, 70],
      svg: P => sk(P, "M 240 190.7 L 252.7 207.6 A 5 5 0 0 0 261.3 202.4 L 252 183.3 A 7 7 0 0 0 240 190.7 Z")
        + sk(P, "M 264 207 C 269 212 269 220 264 225 C 260 228 253 227 251 221 C 250 215 252 209 256 207 C 259 205 261 205 264 207 Z") },

    { id: 'thigh-L', z: 2, pivot: [184, 250], axis: [[184, 250], [182, 290]], bbox: [158, 234, 50, 66],
      svg: P => sk(P, "M 174.5 249.5 L 174.5 289.6 A 7.5 7.5 0 0 0 189.5 290.4 L 193.5 250.5 A 9.5 9.5 0 0 0 174.5 249.5 Z") },

    { id: 'thigh-R', z: 2, pivot: [216, 250], axis: [[216, 250], [218, 290]], bbox: [192, 234, 50, 66],
      svg: P => sk(P, "M 206.5 250.5 L 210.5 290.4 A 7.5 7.5 0 0 0 225.5 289.6 L 225.5 249.5 A 9.5 9.5 0 0 0 206.5 250.5 Z") },

    { id: 'shin-foot-L', z: 3, pivot: [182, 290], axis: [[182, 290], [180, 326]], bbox: [158, 280, 48, 74],
      svg: P => sk(P, "M 174.5 289.6 L 175 325.7 A 5 5 0 0 0 185 326.3 L 189.5 290.4 A 7.5 7.5 0 0 0 174.5 289.6 Z")
        + sk(P, "M 175 322 C 172 328 172 336 176 340 C 180 343 186 342 187 336 C 188 330 186 324 183 321 C 180 318 177 318 175 322 Z") },

    { id: 'shin-foot-R', z: 3, pivot: [218, 290], axis: [[218, 290], [220, 326]], bbox: [194, 280, 48, 74],
      svg: P => sk(P, "M 210.5 290.4 L 215 326.3 A 5 5 0 0 0 225 325.7 L 225.5 289.6 A 7.5 7.5 0 0 0 210.5 290.4 Z")
        + sk(P, "M 225 322 C 228 328 228 336 224 340 C 220 343 214 342 213 336 C 212 330 214 324 217 321 C 220 318 223 318 225 322 Z") }
  ];

  /* ---------- part geometry ---------- */

  /* Straightening angle in deg: rotation about the pivot that puts the
     distal joint STRAIGHT BELOW the pivot (+y) — same math as the
     spike/parts.html atlas builder. */
  function straightenDeg(part) {
    const [[px, py], [dx, dy]] = part.axis;
    return 90 - Math.atan2(dy - py, dx - px) * 180 / Math.PI;
  }

  /* Half-size (viewBox units) of the pivot-centered square that covers
     the part: Chebyshev distance from the pivot of the 4 bbox corners
     (rotated about the pivot by the straightening angle for limbs),
     +6 padding. */
  function partHalf(part) {
    const [px, py] = part.pivot;
    const [bx, by, bw, bh] = part.bbox;
    let cos = 1, sin = 0;
    if (part.axis) {
      const a = straightenDeg(part) * Math.PI / 180;
      cos = Math.cos(a); sin = Math.sin(a);
    }
    let maxR = 0;
    [[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh]].forEach(([qx, qy]) => {
      const rx = (qx - px) * cos - (qy - py) * sin;
      const ry = (qx - px) * sin + (qy - py) * cos;
      const d = Math.max(Math.abs(rx), Math.abs(ry));
      if (d > maxR) maxR = d;
    });
    return Math.ceil(maxR) + 6;
  }

  /* Standalone <svg> document string for one part — the exact string
     render() rasterizes. Limbs are wrapped in rotate() about the pivot
     so the distal joint lies straight below it; the viewBox is the
     pivot-centered square, so the pivot is the image center. */
  function svgDocument(P, id) {
    const part = PARTS.find(p => p.id === id);
    if (!part) throw new Error('BeachParts: unknown part "' + id + '"');
    const [px, py] = part.pivot;
    const half = partHalf(part);
    const side = 2 * half;
    let inner = part.svg(P);
    if (part.axis) {
      inner = '<g transform="rotate(' + straightenDeg(part) + ' ' + px + ' ' + py + ')">' + inner + '</g>';
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + side + '" height="' + side +
      '" viewBox="' + (px - half) + ' ' + (py - half) + ' ' + side + ' ' + side + '">' + inner + '</svg>';
  }

  /* ---------- rasterizer ---------- */

  function rasterize(svgString, W) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const c = document.createElement('canvas');
        c.width = W; c.height = W;
        /* no tight-crop: the pivot must stay exactly at the center */
        c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, W, W);
        resolve(c);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('BeachParts: SVG rasterize failed'));
      };
      img.src = url;
    });
  }

  /* render(P, scale) -> Promise<{ [id]: { canvas, w, h, half } }>
     scale = canvas px per viewBox unit (default 2). */
  function render(P, scale) {
    const sc = (typeof scale === 'number' && isFinite(scale) && scale > 0) ? scale : 2;
    const pal = Object.assign({}, DEFAULT_PALETTE, P || {});
    return Promise.all(PARTS.map(part => {
      const doc = svgDocument(pal, part.id);
      const half = partHalf(part);
      const W = Math.max(1, Math.ceil(2 * half * sc));
      return rasterize(doc, W).then(canvas => ({ canvas, w: W, h: W, half }));
    })).then(list => {
      const out = {};
      PARTS.forEach((p, i) => { out[p.id] = list[i]; });
      return out;
    });
  }

  /* ---------- skeleton + metrics ---------- */

  /* Bone records in parent-before-child order. `part` is the part id
     whose pivot joint this bone sits on (root carries no part). */
  const SKELETON = [
    { name: 'root', parent: null, pivot: [200, 250], part: null },
    { name: 'torso', parent: 'root', pivot: [200, 250], part: 'torso' },
    { name: 'neck', parent: 'root', pivot: [200, 152], part: 'head' },
    { name: 'hairBack', parent: 'neck', pivot: [200, 152], part: 'hair-back' },
    { name: 'hairFront', parent: 'neck', pivot: [200, 152], part: 'hair-front' },
    { name: 'shoulderL', parent: 'root', pivot: [170, 168], part: 'upper-arm-L' },
    { name: 'elbowL', parent: 'shoulderL', pivot: [154, 187], part: 'forearm-hand-L' },
    { name: 'shoulderR', parent: 'root', pivot: [230, 168], part: 'upper-arm-R' },
    { name: 'elbowR', parent: 'shoulderR', pivot: [246, 187], part: 'forearm-hand-R' },
    { name: 'hipL', parent: 'root', pivot: [184, 250], part: 'thigh-L' },
    { name: 'kneeL', parent: 'hipL', pivot: [182, 290], part: 'shin-foot-L' },
    { name: 'hipR', parent: 'root', pivot: [216, 250], part: 'thigh-R' },
    { name: 'kneeR', parent: 'hipR', pivot: [218, 290], part: 'shin-foot-R' }
  ];

  const METRICS = {
    hipX: 200, hipY: 250, feetY: 342, headTopY: 44,
    height: 298, hipAboveFeet: 92
  };

  window.BeachParts = {
    DEFAULT_PALETTE,
    paletteFor,
    PARTS,
    render,
    SKELETON,
    METRICS,
    svgDocument
  };
})();
