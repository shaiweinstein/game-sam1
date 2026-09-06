#!/usr/bin/env python3
"""S1 3D Lily spike — build Lily (chibi, from the 2D SVG measurements)
and export spike3/assets/lily.glb.

Run:  blender --background --python spike3/blender/build_lily.py

Proportions — measured from js/character.js (viewBox 0 0 300 340):
  H (feet->crown, y 318..50)  = 268 units  ->  1.0 m in the model
  head: ellipse (150,105) rx58 ry55  -> w .434H h .411H, center .795H
  torso: rect 116..184 x 164..250 rx26 -> w .254H h .321H (rounded box)
  legs:  x 138/162, y 248..302, stroke 10  -> x ±.045H, r ~.03H
  arms:  (122,172) Q(104,194) (98,226), stroke 9  -> shoulder (.150,.545)
         to hand (.205,.345), r ~.032H
  skirt: y 232..276, w 72 top / 88 bottom -> cone r .134H -> .164H
  shoes: y 298..318, w ~32 -> box .105 x .150 x .068H
  hair (hair1 "Long Brown Hair", middle part):
    back silhouette: x 84..216, top y44, side falls to y ~234 (.31H)
    fringe: top y46, bottom edge y84..86 center, y100 at the temples,
    outer edge at the head silhouette (x 92/208)
  face: eyes (128/172,103) r8.5x11, shine dots, blush (110/190,122) 11x7,
    smile M136 124 Q150 140 164 124 (w4.5)
The 2D face region x[96,204] y[90,148] (face_texture.png, made by
make_refs.py, skin-filled) is mapped onto the HEAD mesh itself with a
position-based (linear x / linear z, clamped) UV remap, so the texture
reads exactly like the 2D face from the front and the rest of the head
stays skin — one mesh, no patch seam.

Orientation: built in Blender facing -Y (standard front view). The glTF
(Y-up) export maps -Y -> +Z, so in three.js she faces +Z, her left is +X.
Materials are flat single colors (Principled, roughness 1) — the toon
look is applied in spike3.js via MeshToonMaterial, keeping the glb clean.
"""

import math
import os

import bpy
import bmesh

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "spike3", "assets", "lily.glb")
FACE_TEX = os.path.join(HERE, "face_texture.png")

# ---------------- palette (js/character.js + default outfit) ----------------
PALETTE = {
    "skin":   (0xFF / 255, 0xDC / 255, 0xC0 / 255),  # #ffdcc0
    "hair":   (0x8A / 255, 0x5A / 255, 0x3A / 255),  # #8a5a3a hairMain
    "hair2":  (0x5E / 255, 0x3A / 255, 0x22 / 255),  # #5e3a22 hairShade
    "shirt":  (0xFF / 255, 0x8F / 255, 0xB8 / 255),  # top1 Pink T-Shirt
    "sole":   (0xFF / 255, 0xF9 / 255, 0xEC / 255),  # shoes1 white sole
    "skirt":  (0x5A / 255, 0x8F / 255, 0xD6 / 255),  # bottom1 Denim Skirt
}


def srgb2lin(c):
    def ch(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(ch(v) for v in c)


def mat(name, color, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    if image:
        # The texture already carries the final color (skin fill + face
        # features), so the baseColorFactor must be WHITE — otherwise the
        # glb multiplies factor * texture and the features get darkened.
        bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        r, g, b = srgb2lin(color)
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    return m


def new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def sphere(bm, seg_u=96, seg_v=48, r=1.0):
    bmesh.ops.create_uvsphere(bm, u_segments=seg_u, v_segments=seg_v, radius=r)
    return bm


def cut_keep(ob, keep):
    """Delete vertices NOT matching keep(world_pos) -> (x, y, z) bool.
    NOTE: predicates are evaluated in WORLD space (object may carry a
    location), so mesh data (local coords) is transformed first."""
    bpy.context.view_layer.update()
    mw = ob.matrix_world
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bad = [v for v in bm.verts if not keep(mw @ v.co)]
    if bad:
        bmesh.ops.delete(bm, geom=bad, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


def remap_uv_position(ob, x0, x1, z0, z1, clamp=False):
    """Planar (x, z) -> uv projection of the face texture onto the head.
    v=1 at the TOP of the face (z1). glTF export flips V (v_gltf = 1 -
    v_blender) and three.js treats glTF v=0 as the image top, so the top
    of the face must sit at v_blender=1. With clamp=True (whole-head
    mapping) out-of-range uv is clamped — the texture margin rows/cols
    are pure skin, so the rest of the head stays skin-colored."""
    me = ob.data
    uv = me.uv_layers.active
    if uv is None:
        uv = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            w = ob.matrix_world @ me.vertices[vi].co
            u = (w.x - x0) / (x1 - x0)
            v = (w.z - z0) / (z1 - z0)
            if clamp:
                u = max(0.0, min(1.0, u))
                v = max(0.0, min(1.0, v))
            uv.data[li].uv = (u, v)


def add_bevel(ob, width, segments=3):
    m = ob.modifiers.new("bev", "BEVEL")
    m.width = width
    m.segments = segments
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)


def add_solidify(ob, thickness=0.01):
    m = ob.modifiers.new("sol", "SOLIDIFY")
    m.thickness = thickness
    m.offset = -1.0
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)


def box(name, hx, hy, hz, loc):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= 2 * hx
        v.co.y *= 2 * hy
        v.co.z *= 2 * hz
    ob = new_obj(name, bm)
    ob.location = loc
    return ob


def blob(name, sx, sy, sz, loc, rot_y=0.0):
    bm = bmesh.new()
    sphere(bm, 64, 32)
    ob = new_obj(name, bm)
    ob.scale = (sx, sy, sz)
    ob.rotation_euler = (0, rot_y, 0)
    ob.location = loc
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    return ob


def main():
    # ---------------- clean scene ----------------
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for item in list(coll):
            if item.users == 0:
                coll.remove(item)

    face_img = bpy.data.images.load(FACE_TEX) if os.path.exists(FACE_TEX) else None
    M = {
        "skin": mat("skin", PALETTE["skin"]),
        "hair": mat("hairMain", PALETTE["hair"]),
        "hair2": mat("hairShade", PALETTE["hair2"]),
        "shirt": mat("shirt", PALETTE["shirt"]),
        "sole": mat("sole", PALETTE["sole"]),
        "skirt": mat("skirt", PALETTE["skirt"]),
        "face": mat("faceTexture", PALETTE["skin"], image=face_img),
    }

    parts = []

    # ---------------- body ----------------
    # Head is textured with the 2D face (face_texture.png = skin fill +
    # eyes/blush/smile). UVs are remapped by world (x, z) with clamping:
    # the face region (2D x 96..204, y 90..148) lands on the front of the
    # head exactly where the 2D face sits; the rest of the sphere clamps
    # into the texture's skin-colored margin rows/columns, so the whole
    # head stays skin (and the back/sides are hair-covered anyway).
    head = blob("Head", 0.2163, 0.205, 0.1948, (0, 0, 0.795))
    remap_uv_position(head,
                      x0=-0.201493, x1=+0.201493,   # 2D x 96..204  (±54u)
                      z0=0.634552, z1=0.850970,     # 2D y 148..90
                      clamp=True)
    head.data.materials.append(M["face"])
    parts.append(head)

    # ---------------- hair (hair1: middle-part long brown) ----------------
    # cap: rounded shell over top/back/sides, opening over the face
    cap = blob("HairCap", 0.228, 0.228, 0.228, (0, 0.012, 0.792))
    def cap_keep(p):
        dx, dy, dz = p[0], p[1] - 0.012, p[2] - 0.792
        cos_t = dz / 0.228            # up
        cos_f = -dy / 0.228           # toward front (-Y)
        return cos_t > math.cos(math.radians(62)) or cos_f < math.cos(math.radians(58))
    cut_keep(cap, cap_keep)
    add_solidify(cap, 0.01)
    cap.data.materials.append(M["hair"])
    parts.append(cap)

    # fringe/bangs: front band, bottom edge highest at the middle part
    # (y2d 86) dipping lowest at the temples (y2d 100), darker hairShade.
    bangs = blob("HairBangs", 0.224, 0.224, 0.224, (0, -0.006, 0.795))
    def bangs_keep(p):
        dx, dy, dz = p[0], p[1] + 0.006, p[2] - 0.795
        cos_t = dz / 0.224
        t = math.degrees(math.acos(max(-1, min(1, cos_t))))
        phi = math.degrees(math.atan2(dx, -dy))   # from front, signed
        a = abs(phi)
        if a > 58 or t < 12:
            return False
        bottom = 71 + 14 * (a / 58) ** 2
        return t <= bottom
    cut_keep(bangs, bangs_keep)
    add_solidify(bangs, 0.01)
    bangs.data.materials.append(M["hair2"])
    parts.append(bangs)

    # side falls, hanging to the shoulders (2D: down to y ~234 = .31H)
    for side, sx in (("L", 1), ("R", -1)):
        lock = blob("HairLock" + side, 0.060, 0.088, 0.210,
                    (sx * 0.175, -0.030, 0.545))
        lock.data.materials.append(M["hair"])
        parts.append(lock)

    # ---------------- torso / clothing ----------------
    torso = blob("Torso", 0.127, 0.098, 0.1605, (0, 0, 0.4145))
    add_bevel(torso, 0.09)
    torso.data.materials.append(M["skin"])
    parts.append(torso)

    shirt = blob("Shirt", 0.1345, 0.1045, 0.1675, (0, 0, 0.4245))
    add_bevel(shirt, 0.09)
    shirt.data.materials.append(M["shirt"])
    parts.append(shirt)

    skirt = None
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=48,
                          radius1=0.134, radius2=0.164, depth=0.148)
    skirt = new_obj("Skirt", bm)
    skirt.location = (0, 0, 0.188)
    add_bevel(skirt, 0.008, 2)
    skirt.data.materials.append(M["skirt"])
    parts.append(skirt)

    # ---------------- arms / hands (relaxed A-pose, tilted ~17°) ----------------
    arm_tilt = math.radians(16.9)
    for side, sx in (("L", 1), ("R", -1)):
        arm = blob("Arm" + side, 0.032, 0.032, 0.13,
                   (sx * 0.179, 0, 0.45), rot_y=sx * arm_tilt)
        arm.data.materials.append(M["skin"])
        parts.append(arm)
        sleeve = blob("Sleeve" + side, 0.045, 0.045, 0.078,
                      (sx * 0.166, 0, 0.493), rot_y=sx * arm_tilt)
        sleeve.data.materials.append(M["shirt"])
        parts.append(sleeve)
        hand = blob("Hand" + side, 0.040, 0.048, 0.052,
                    (sx * 0.212, 0, 0.328))
        hand.data.materials.append(M["skin"])
        parts.append(hand)

    # ---------------- legs / shoes ----------------
    for side, sx in (("L", 1), ("R", -1)):
        leg = blob("Leg" + side, 0.030, 0.030, 0.105, (sx * 0.045, 0, 0.155))
        leg.data.materials.append(M["skin"])
        parts.append(leg)
        shoe = box("Shoe" + side, 0.0525, 0.075, 0.034, (sx * 0.048, -0.030, 0.034))
        add_bevel(shoe, 0.012)
        shoe.data.materials.append(M["shirt"])
        parts.append(shoe)
        sole = box("Sole" + side, 0.0525, 0.075, 0.011, (sx * 0.048, -0.030, 0.011))
        add_bevel(sole, 0.006, 2)
        sole.data.materials.append(M["sole"])
        parts.append(sole)

    # ---------------- export ----------------
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format="GLB",
        use_selection=True, export_apply=True, export_yup=True,
    )
    print("EXPORTED", OUT)

    # ---------------- optional debug render (front) ----------------
    try:
        cam_data = bpy.data.cameras.new("cam")
        cam = bpy.data.objects.new("cam", cam_data)
        bpy.context.collection.objects.link(cam)
        cam.location = (0, -2.4, 0.95)
        tgt = bpy.data.objects.new("tgt", None)
        bpy.context.collection.objects.link(tgt)
        tgt.location = (0, 0, 0.55)
        con = cam.constraints.new("TRACK_TO")
        con.target = tgt
        bpy.context.scene.camera = cam
        scene = bpy.context.scene
        scene.render.resolution_x = 640
        scene.render.resolution_y = 760
        scene.render.image_settings.file_format = "PNG"
        try:
            scene.render.engine = "BLENDER_EEVEE_NEXT"
        except Exception:
            scene.render.engine = "BLENDER_WORKBENCH"
        scene.render.filepath = os.path.join(HERE, "preview_front.png")
        bpy.ops.render.render(write_still=True)
        print("RENDERED preview_front.png")
    except Exception as e:
        print("debug render skipped:", e)


if __name__ == "__main__":
    main()
