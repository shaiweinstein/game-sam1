/* Library-only wardrobe lifecycle. Garments and footwear share the body's
 * skeleton/bind space. Beach never creates this layer; hair/extras remain
 * character3d's concern. Explicit shoes:null (or "none") means barefoot.
 */
import { createGarments } from "./garments3d.js";
import { createFootwear } from "./footwear3d.js";

const FALLBACK_COLORS = {
  top: { main: "#ff8fb8", trim: "#d9568a" },
  bottom: { main: "#5a8fd6", trim: "#3d6db3" }
};
function colorsFor(slot, id) {
  const front = window.CharacterRenderer?.catalog?.[slot]?.[id]?.front || "";
  const fill = front.match(/fill="(#[0-9a-fA-F]{3,8})"/), stroke = front.match(/stroke="(#[0-9a-fA-F]{3,8})"/);
  return { main: fill?.[1] || FALLBACK_COLORS[slot].main, trim: stroke?.[1] || FALLBACK_COLORS[slot].trim };
}

export function createClothes(character) {
  const root = character.root;
  let attached = false, disposed = false, shown = true, appliedKey = null, pendingOutfit = null;
  let garments = null, footwear = null, parts = [];
  function removeParts() {
    // Unregister sole support before disposing any of its source geometry.
    footwear?.clear(); garments?.clear(); parts = [];
  }
  function ensureAttached() {
    if (attached || disposed) return attached;
    let body = null, gradientMap = null;
    root.traverse(o => { if (o.isSkinnedMesh && o.material.name === "skin") body = o; });
    if (!body) return false;
    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (gradientMap) return;
      for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
        if (material?.isMeshToonMaterial && material.gradientMap) { gradientMap = material.gradientMap; break; }
      }
    });
    garments = createGarments(body, gradientMap);
    footwear = createFootwear(character, body, gradientMap);
    attached = true;
    if (pendingOutfit) { const outfit = pendingOutfit; pendingOutfit = null; apply(outfit); }
    return true;
  }
  function apply(outfit) {
    if (disposed || !outfit) return false;
    if (!ensureAttached()) { pendingOutfit = { ...outfit }; return false; }
    const top = typeof outfit.top === "string" ? outfit.top : "top1";
    const bottom = typeof outfit.bottom === "string" ? outfit.bottom : "bottom1";
    const shoes = outfit.shoes === null || outfit.shoes === "none" ? null : typeof outfit.shoes === "string" ? outfit.shoes : "shoes1";
    const key = [top, bottom, shoes ?? "none"].join("|");
    if (key === appliedKey) return true;
    removeParts(); appliedKey = key;
    parts = [garments.build({ top, bottom }, colorsFor), footwear.build(shoes)].filter(Boolean);
    setVisible(shown);
    return true;
  }
  function setVisible(on) {
    shown = !!on; for (const group of parts) group.visible = shown;
    garments?.setVisible(shown); footwear?.setVisible(shown);
  }
  function dispose() {
    disposed = true; removeParts(); garments?.dispose(); footwear?.dispose(); pendingOutfit = appliedKey = null;
  }
  function state() {
    let meshes = 0; for (const group of parts) group.traverse(o => { if (o.isMesh) meshes++; });
    return { attached, visible: shown, applied: appliedKey, groups: parts.length, meshes,
      footwear: footwear?.state() || null };
  }
  return { apply, setVisible, dispose, state };
}
