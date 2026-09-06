#!/usr/bin/env python3
"""S2 spike — 3D Lily v2: a KID GIRL in her swimsuit (not a chess piece).

Run:  blender --background --python spike3/blender/build_lily2.py
Out:  spike3/assets/lily2.glb   (neutral A-pose, no animation)

Fixes from the family review of v1 (spike3/blender/build_lily.py):
  1. Swimsuit instead of skirt — faithfully modeled from js/character.js
     catalog suit1 "Sunny One-Piece": fill #ffd93d, trim #ff9a3d,
     one-piece hugging the torso (scoop neck dipping at center front,
     full shoulder straps at the sides, short leg tabs on the upper
     thighs) + the 4-petal daisy on the chest (#fff9ec petals, #ff9a3d
     center). The orange 2D stroke becomes real trim tubes.
  2. No shoes — bare kid feet (flattened toe-forward sole blob, heel,
     instep, ankle join; skin color; soles on the floor).
  3. New hair, no helmet: every piece is a PARAMETRIC GRID SHELL
     (generated directly from angle functions — no sphere vertex-deletion
     cuts, so no scalloped edges; rim = exact boundary curve):
       * skull cap shell ending above the ears / at the nape,
       * smooth curved bangs band across the forehead (higher at center,
         lower at the temples — matches hair1's 2D fringe line),
       * tapered side locks framing the face down to the jaw,
       * back mantle lofted from the crown down the occiput to mid-back
         with rounded tip + sides ending near the jaw,
       * hairShade (#5e3a22): underlayer of the back mantle + thin strip
         under the bangs edge — the 3D analogue of the 2D hair outline.
     The SKIN NECK stays visible between chin and shoulders; hair hangs
     behind it (the 2D hair-back is two side curtains with an open gap
     where the neck is — v1 wrapped hair around that neck gap).
  4./5. Kid body, not a pawn: lofted torso with chest/waist/hip taper,
     visible rounded shoulder caps, two-segment arms hanging naturally
     (slight outward tilt, NOT buried in hair), chubby kid thighs, knee
     hint, calves, bare feet. Head stays big (chibi) and the FACE IS
     PRESERVED: identical head ellipsoid + identical face_texture.png UV
     mapping as v1 (the face passed review).

Frame: feet z=0, crown ~1.01, facing -Y (glTF Y-up export -> in three.js
she faces +Z, her left is +X). 2D source coords (viewBox 300x340, feet
y318, crown y50, H=268): z=(318-y2d)/268, x=(x2d-150)/268.

Materials are flat single colors (Principled, roughness 1); the toon look
is applied viewer-side via MeshToonMaterial (see spike3/spike3.js).
"""

import math
import os

import bpy
import bmesh
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "spike3", "assets", "lily2.glb")
FACE_TEX = os.path.join(HERE, "face_texture.png")

PALETTE = {
    "skin":  (0xFF, 0xDC, 0xC0),  # #ffdcc0
    "hair":  (0x8A, 0x5A, 0x3A),  # #8a5a3a hairMain
    "hair2": (0x5E, 0x3A, 0x22),  # #5e3a22 hairShade
    "suit":  (0xFF, 0xD9, 0x3D),  # suit1 main #ffd93d
    "trim":  (0xFF, 0x9A, 0x3D),  # suit1 trim #ff9a3d
    "daisy": (0xFF, 0xF9, 0xEC),  # suit1 petals #fff9ec
}

HEAD_C = Vector((0.0, 0.0, 0.795))
HEAD_R = Vector((0.2163, 0.205, 0.1948))   # v1 head, unchanged
TORSO_CY = 0.004

deg = math.radians

# torso ring table: (z, rx, ry) — shoulders wide, waist nipped, hips round
TORSO_RINGS = [
    (0.605, 0.060, 0.048),
    (0.565, 0.092, 0.063),
    (0.545, 0.112, 0.076),
    (0.505, 0.118, 0.083),
    (0.455, 0.108, 0.077),
    (0.400, 0.096, 0.071),
    (0.350, 0.104, 0.077),
    (0.305, 0.115, 0.084),
    (0.270, 0.112, 0.082),
    (0.240, 0.096, 0.073),
    (0.222, 0.070, 0.056),
]


def srgb2lin(c):
    def ch(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(ch(v) for v in c)


def mat(name, color, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 1.0
    if image:
        bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        tex = m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = image
        m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    else:
        r, g, b = srgb2lin(color)
        bsdf.inputs["Base Color"].default_value = (r, g, b, 1.0)
    # viewport display color = real sRGB color (workbench debug renders)
    m.diffuse_color = (*[c / 255.0 for c in color], 1.0)
    return m


def new_obj(name, bm, M=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if M:
        me.materials.append(M)
    return ob


def smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True


def solidify(ob, t):
    m = ob.modifiers.new("sol", "SOLIDIFY")
    m.thickness = t
    m.offset = -1.0
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier=m.name)


def interp(z, idx):
    """TORSO_RINGS lookup: idx 1 -> rx, idx 2 -> ry (linear, clamped)."""
    d = TORSO_RINGS
    if z >= d[0][0]:
        return d[0][idx]
    if z <= d[-1][0]:
        return d[-1][idx]
    for lo, hi in zip(d[1:], d[:-1]):
        if hi[0] >= z >= lo[0]:
            t = (z - lo[0]) / (hi[0] - lo[0]) if hi[0] != lo[0] else 0
            return lo[idx] + (hi[idx] - lo[idx]) * t
    return d[-1][idx]


def ellipsoid(name, radii, center, M, seg_u=48, seg_v=24, yaw=0.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg_u, v_segments=seg_v, radius=1.0)
    cy, sy = math.cos(yaw), math.sin(yaw)
    for v in bm.verts:
        x = v.co.x * radii[0]
        y = v.co.y * radii[1]
        v.co.x = x * cy - y * sy + center[0]
        v.co.y = x * sy + y * cy + center[1]
        v.co.z = v.co.z * radii[2] + center[2]
    ob = new_obj(name, bm, M)
    smooth(ob)
    return ob


def limb(name, p0, p1, r0, r1, M, seg=20):
    """Tapered capsule between two points (rounded both ends)."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    quat = d.normalized().to_track_quat("Z", "Y")
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=1.0)
    for v in bm.verts:
        t = (v.co.z + 1.0) / 2.0
        r = r0 + (r1 - r0) * t
        v.co.x *= r
        v.co.y *= r
        v.co.z = -0.22 * r0 + (L + 0.22 * r0 + 0.22 * r1) * t
        v.co = quat @ v.co + p0
    ob = new_obj(name, bm, M)
    smooth(ob)
    return ob


def ring(x, y, z, rx, ry, n, phase=0.0):
    return [(x + rx * math.sin(phase + i * 2 * math.pi / n),
             y - ry * math.cos(phase + i * 2 * math.pi / n), z)
            for i in range(n)]


def loft(name, rings, M, cap_top=False, cap_bot=False, wrap=True):
    """Bridge equal-length rings (lists of 3-tuples) in order."""
    n = len(rings[0])
    bm = bmesh.new()
    rows = [[bm.verts.new(p) for p in r] for r in rings]
    span = n if wrap else n - 1
    for j in range(len(rows) - 1):
        a, b = rows[j], rows[j + 1]
        for i in range(span):
            i2 = (i + 1) % n
            try:
                bm.faces.new((a[i], a[i2], b[i2], b[i]))
            except ValueError:
                pass
    if cap_top:
        c = bm.verts.new(tuple(sum(p[k] for p in rings[0]) / n for k in range(3)))
        for i in range(n):
            try:
                bm.faces.new((c, rows[0][(i + 1) % n], rows[0][i]))
            except ValueError:
                pass
    if cap_bot:
        c = bm.verts.new(tuple(sum(p[k] for p in rings[-1]) / n for k in range(3)))
        last = rows[-1]
        for i in range(n):
            try:
                bm.faces.new((c, last[i], last[(i + 1) % n]))
            except ValueError:
                pass
    bm.normal_update()
    ob = new_obj(name, bm, M)
    smooth(ob)
    return ob


def tube(name, path, radii, M, n=14, closed=False, cap_ends=True):
    """Parallel-transport tube along a polyline; optionally closed loop."""
    path = [Vector(p) for p in path]
    radii = list(radii)
    if closed:
        path.append(path[0])
        radii.append(radii[0])
    N = len(path)
    tang = []
    for i in range(N):
        if i == 0:
            d = path[1] - path[0]
        elif i == N - 1:
            d = path[-1] - path[-2]
        else:
            d = path[i + 1] - path[i - 1]
        tang.append(d.normalized())
    rings = []
    f = None
    for i in range(N):
        t = tang[i]
        if f is None:
            ref = Vector((0, 0, 1))
            if abs(t.dot(ref)) > 0.9:
                ref = Vector((1, 0, 0))
            f = t.cross(ref).normalized()
        else:
            q = tang[i - 1].rotation_difference(t)
            f = q @ f
        f = (f - t * f.dot(t)).normalized()
        side = t.cross(f).normalized()
        r = radii[i]
        rings.append([tuple(path[i] + r * (math.cos(a) * f + math.sin(a) * side))
                      for a in (k * 2 * math.pi / n for k in range(n))])
    capT = capB = False
    if not closed:
        if cap_ends:
            p = path[0] - tang[0] * (radii[0] * 0.6)
            rings = [[tuple(Vector(q) * 0.4 + p * 0.6) for q in rings[0]]] + rings
            p = path[-1] + tang[-1] * (radii[-1] * 0.6)
            rings = rings + [[tuple(Vector(q) * 0.4 + p * 0.6) for q in rings[-1]]]
        capT = capB = True
    return loft(name, rings, M, cap_top=capT, cap_bot=capB)


def shell(name, fn, s_rows, p_cols, M, solid=0.012, wrap=True):
    """Grid surface fn(s, p) -> (x,y,z); s across, p along (optionally wrapping)."""
    bm = bmesh.new()
    rows = [[bm.verts.new(fn(s, p)) for p in p_cols] for s in s_rows]
    np = len(p_cols)
    step = np if wrap else np - 1
    for j in range(len(rows) - 1):
        for i in range(step):
            i2 = (i + 1) % np
            if not wrap and i + 1 >= np:
                continue
            try:
                bm.faces.new((rows[j][i], rows[j][i2],
                              rows[j + 1][i2], rows[j + 1][i]))
            except ValueError:
                pass
    bm.normal_update()
    ob = new_obj(name, bm, M)
    if solid:
        solidify(ob, solid)
    smooth(ob)
    return ob


def head_pt(t, phi, R, C, cy=0.0):
    """Point on an ellipsoid shell around the head.
    phi: azimuth from FRONT(-Y), t: polar from crown."""
    st, ct = math.sin(t), math.cos(t)
    return (C[0] + R[0] * st * math.sin(phi),
            C[1] + cy - R[1] * st * math.cos(phi),
            C[2] + R[2] * ct)


def suit_top(a):
    """Top edge of the one-piece, z at azimuth a (rad from front).
    Scoop neck dips at center front (2D: neckline y165..172 -> z~0.55..0.57
    edge of fabric at ~0.50 center), full strap coverage over the sides."""
    c = math.cos(a)
    if c > 0:
        return 0.556 - 0.058 * c ** 1.5
    return 0.556 - 0.016 * abs(c) ** 2.2


def suit_bot(a):
    """Hem curve matching the 2D outline: rises to the hip at the sides
    (high-cut leg, 2D (114,238)->(131,262): x0.12 z0.299 -> x0.056 z0.209),
    dips to tab level over the groin (joins the thigh tabs -> reads as ONE
    piece, not a skirt), tiny notch back up at the very center."""
    ad = abs(math.degrees(a))
    s = lambda x: (3 - 2 * x) * x * x if 0 < x < 1 else (0.0 if x <= 0 else 1.0)
    if ad <= 90:
        z = 0.232 + 0.060 * s((ad - 15) / 70.0)
        z -= 0.032 * math.exp(-((ad - 27) / 16.0) ** 2)   # over the tabs
        z += 0.014 * math.exp(-((ad / 9.0) ** 2))          # center notch
        return z
    return 0.292 - 0.030 * s((ad - 90) / 90.0)            # seat


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images,
                 bpy.data.curves, bpy.data.armatures):
        for item in list(coll):
            if item.users == 0:
                coll.remove(item)

    face_img = bpy.data.images.load(FACE_TEX) if os.path.exists(FACE_TEX) else None
    M = {
        "skin":  mat("skin", PALETTE["skin"]),
        "hair":  mat("hairMain", PALETTE["hair"]),
        "hair2": mat("hairShade", PALETTE["hair2"]),
        "suit":  mat("suitMain", PALETTE["suit"]),
        "trim":  mat("suitTrim", PALETTE["trim"]),
        "daisy": mat("daisyPetal", PALETTE["daisy"]),
        "face":  mat("faceTexture", PALETTE["skin"], image=face_img),
    }
    parts = []

    # ================= HEAD (face texture — v1's proven mapping) =========
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=48, radius=1.0)
    for v in bm.verts:
        v.co.x = v.co.x * HEAD_R.x + HEAD_C.x
        v.co.y = v.co.y * HEAD_R.y + HEAD_C.y
        v.co.z = v.co.z * HEAD_R.z + HEAD_C.z
    head = new_obj("Head", bm, M["face"])
    smooth(head)
    remap_uv_position(head,
                      x0=-0.201493, x1=+0.201493,   # 2D x 96..204
                      z0=0.634552, z1=0.850970,     # 2D y 148..90
                      clamp=True)
    parts.append(head)

    # ================= BODY =================
    parts.append(loft("Torso",
                      [ring(0, TORSO_CY, z, rx, ry, 48)
                       for (z, rx, ry) in TORSO_RINGS],
                      M["skin"], cap_top=False, cap_bot=True))

    # visible rounded kid shoulders
    for side, sx in (("L", 1), ("R", -1)):
        parts.append(ellipsoid("ShoulderCap" + side, (0.046, 0.049, 0.042),
                               (sx * 0.102, 0.004, 0.527), M["skin"]))

    # neck: visible skin between chin (z 0.600) and shoulders (0.545)
    parts.append(loft("Neck",
                      [ring(0, 0.006, z, rx, ry, 32)
                       for (z, rx, ry) in ((0.645, 0.046, 0.048),
                                           (0.610, 0.053, 0.055),
                                           (0.578, 0.058, 0.060),
                                           (0.548, 0.068, 0.068))],
                      M["skin"], cap_top=True, cap_bot=True))

    # arms — natural hang, slight outward tilt; smooth single taper + hand
    # (ball-joint beads read as doll parts; the walk binds them to UpperArm
    # anyway, so one smooth segment is the better silhouette)
    for side, sx in (("L", 1), ("R", -1)):
        sho = (sx * 0.120, 0.004, 0.522)
        wri = (sx * 0.155, -0.014, 0.320)
        parts.append(limb("Arm" + side, sho, wri, 0.036, 0.026, M["skin"]))
        parts.append(ellipsoid("Hand" + side, (0.029, 0.020, 0.043),
                               (sx * 0.160, -0.019, 0.286), M["skin"]))

    # legs — continuous thigh->calf radii (joint spheres make the limbs read
    # as ball stacks), subtle flush kneecap, BARE FEET = sole + heel only
    hip_x, knee_x, ank_x = 0.056, 0.059, 0.061
    for side, sx in (("L", 1), ("R", -1)):
        hip = (sx * hip_x, 0.006, 0.272)
        knee = (sx * knee_x, -0.008, 0.152)
        ank = (sx * ank_x, 0.004, 0.052)
        parts.append(limb("Thigh" + side, hip, knee, 0.048, 0.036, M["skin"]))
        parts.append(ellipsoid("Knee" + side, (0.026, 0.014, 0.024),
                               (sx * knee_x, -0.030, 0.150), M["skin"]))
        parts.append(limb("Calf" + side, knee, ank, 0.036, 0.025, M["skin"]))
        parts.append(ellipsoid("FootBall" + side, (0.038, 0.078, 0.024),
                               (sx * ank_x, -0.045, 0.024), M["skin"],
                               yaw=sx * math.radians(-7)))
        parts.append(ellipsoid("FootHeel" + side, (0.028, 0.030, 0.026),
                               (sx * ank_x, 0.020, 0.026), M["skin"]))

    # ================= SWIMSUIT (suit1 "Sunny One-Piece") ================
    # The suit bottom must PINCH onto the thighs: a constant torso radius to
    # the hem would flare past the legs and read as a skirt again.
    def suit_pinch(a, z):
        if z >= 0.278:
            return 1.0
        q = min(1.0, (0.278 - z) / 0.070)
        s2 = math.sin(a) ** 2                 # only the x-sides pinch in
        return 1.0 - 0.30 * q * s2

    def suit_rx(z):
        return interp(z, 1) + 0.008

    def suit_ry(z):
        return interp(z, 2) + 0.008

    def suit_grid_pt(a, z, pad=0.0):
        rx = (suit_rx(z) + pad) * suit_pinch(a, z)
        ry = suit_ry(z) + pad
        return (rx * math.sin(a), TORSO_CY - ry * math.cos(a), z)

    srings, limits = [], []
    N = 48
    z = 0.216
    while z <= 0.5851:
        row, lim = [], []
        for i in range(N):
            a = i * 2 * math.pi / N
            row.append(suit_grid_pt(a, z))
            lim.append((suit_top(a), suit_bot(a)))
        srings.append(row)
        limits.append(lim)
        z += 0.009
    suit = loft("Suit", srings, M["suit"], cap_top=False, cap_bot=False)
    # smooth cut with rim snap (edge follows the exact curve -> no scallop)
    bm = bmesh.new()
    bm.from_mesh(suit.data)
    keep = []
    for k, v in enumerate(bm.verts):
        row_i, col_i = divmod(k, N)      # creation order matches the grid
        top, bot = limits[row_i][col_i]
        if v.co.z > top + 1e-9 or v.co.z < bot - 1e-9:
            keep.append(False)
            if abs(v.co.z - top) < 0.011 or abs(v.co.z - bot) < 0.011:
                v.co.z = top if abs(v.co.z - top) < 0.011 else bot
                keep[-1] = True          # snapped exactly onto the edge
        else:
            keep.append(True)
    bad = [v for v, kp in zip(bm.verts, keep) if not kp]
    bmesh.ops.delete(bm, geom=bad, context="VERTS")
    bm.to_mesh(suit.data)
    bm.free()
    suit.data.update()
    solidify(suit, 0.006)
    smooth(suit)
    parts.append(suit)

    # leg tabs on the upper thighs (2D tabs reach y262 -> z ~0.209).
    # OPEN on the inner side (toward the other leg) so the crotch/leg gap
    # shows skin — a full ring reads as a skirt instead of a one-piece.
    for side, sx in (("L", 1), ("R", -1)):
        rows = []
        for (tz, r) in ((0.296, 0.0535), (0.272, 0.0525), (0.248, 0.0505),
                        (0.228, 0.0480), (0.213, 0.0440)):
            f = (0.272 - tz) / 0.12
            cx = sx * (hip_x + (knee_x - hip_x) * f)
            cy = 0.006 + (-0.014) * f
            pts = []
            for i in range(35):                      # theta -132..132 deg
                th = math.radians(-132 + 264 * i / 34.0)
                pts.append((cx + sx * r * 1.07 * math.cos(th),
                            cy + r * math.sin(th), tz))
            rows.append(pts)
        tab = loft("SuitTab" + side, rows, M["suit"], wrap=False)
        solidify(tab, 0.006)
        smooth(tab)
        parts.append(tab)

    # orange trim tubes (the 2D outline stroke)
    def surf_pt(a, z, pad=0.0095):
        x, y, _ = suit_grid_pt(a, z, pad)
        return (x, y, z + 0.001)

    tr = [surf_pt(a, suit_top(a)) for a in
          (i * 2 * math.pi / 40 for i in range(40))]
    tr.append(tr[0])
    parts.append(tube("TrimNeckline", tr, [0.0075] * len(tr), M["trim"],
                      n=10, closed=True, cap_ends=False))
    tb = [surf_pt(a, suit_bot(a)) for a in
          (i * 2 * math.pi / 40 for i in range(40))]
    tb.append(tb[0])
    parts.append(tube("TrimHem", tb, [0.0075] * len(tb), M["trim"],
                      n=10, closed=True, cap_ends=False))
    for side, sx in (("L", 1), ("R", -1)):
        # trim follows the tab bottom arc only (the tab is open inward)
        loop = []
        for i in range(25):
            th = math.radians(-132 + 264 * i / 24.0)
            loop.append((sx * 0.0576 + sx * 0.0450 * math.cos(th),
                         0.002 + 0.0420 * math.sin(th), 0.216))
        parts.append(tube("TrimTab" + side, loop, [0.006] * len(loop),
                          M["trim"], n=8, cap_ends=True))

    # daisy on the chest (2D center y190 -> z 0.478)
    dz = 0.478
    dy = -(interp(dz, 2) + 0.008 + 0.010)
    parts.append(ellipsoid("DaisyC", (0.0095, 0.0060, 0.0095), (0, dy, dz), M["trim"]))
    for k, (ox, oz) in enumerate(((0, 0.0130), (0.0130, 0),
                                  (0, -0.0130), (-0.0130, 0))):
        parts.append(ellipsoid("DaisyP%d" % k, (0.0092, 0.0050, 0.0092),
                               (ox, dy, dz + oz), M["daisy"]))

    # ================= HAIR =================
    # skull cap: full-wrap shell whose rim is the smooth polar curve
    # cap_edge(phi) — front rim HIGH (68deg, behind the bangs line), sides
    # to the ears (86), nape (105). Helmet fix: the forehead belongs to the
    # BANGS, the cap never dips over the face.
    CAPR = (0.235, 0.225, 0.217)
    CAPC = (0.0, 0.006, 0.797)

    def cap_edge(phi):
        return deg(68 + 42 * ((1 - math.cos(phi)) / 2) ** 1.35)

    cap = shell("HairCap",
                lambda s, p: head_pt(s * cap_edge(p), p, CAPR, CAPC),
                [i / 39 for i in range(40)],
                [i * 2 * math.pi / 72 for i in range(72)],
                M["hair"], solid=0.013)
    parts.append(cap)

    # bangs: curved band across the forehead (top tucked under the cap),
    # edge higher at center (2D fringe y86) lower at temples (y100)
    BR = (0.244, 0.234, 0.226)
    BC = (0.0, -0.004, 0.796)

    def bangs_edge(phi):
        return deg(74 + 18 * (abs(phi) / deg(88)) ** 1.4)

    def bangs_pt(t, phi):
        r = 1.0 + 0.035 * (t / deg(90)) ** 2
        return head_pt(t, phi, (BR[0] * r, BR[1] * r, BR[2] * r), BC)

    b_cols = [-deg(88) + i * (2 * deg(88)) / 64 for i in range(65)]
    parts.append(shell("Bangs",
                       lambda s, p: bangs_pt(deg(28) + s * (bangs_edge(p) - deg(28)), p),
                       [i / 33 for i in range(34)], b_cols,
                       M["hair"], solid=0.011, wrap=False))

    # hairShade strip over the bangs edge (2D stroke analogue). Radius bias
    # (+0.006) keeps it in front of the bangs surface instead of z-fighting.
    def bangs_shade_pt(t, phi):
        r = 1.0 + 0.035 * (t / deg(90)) ** 2 + 0.006
        return head_pt(t, phi, (BR[0] * r, BR[1] * r, BR[2] * r), BC)

    parts.append(shell("BangsShade",
                       lambda s, p: bangs_shade_pt(
                           bangs_edge(p) - 0.075 + s * 0.079, p),
                       [0.0, 0.5, 1.0], b_cols,
                       M["hair2"], solid=0.0035, wrap=False))

    # side locks framing the face: tucked INTO the cap at the top, hugging
    # the cheek line at the SILHOUETTE EDGE (not crossing the face), soft
    # tapered tips ending at the jaw (neck stays clear)
    for side, sx in (("L", 1), ("R", -1)):
        path = [(sx * 0.112, -0.148, 0.848),
                (sx * 0.202, -0.122, 0.716),
                (sx * 0.218, -0.072, 0.612),
                (sx * 0.202, -0.046, 0.560),
                (sx * 0.186, -0.040, 0.524)]
        radii = [0.022, 0.034, 0.030, 0.021, 0.013]
        parts.append(tube("HairLock" + side, path, radii, M["hair"], n=16))

    # back mantle: starts HIDDEN under the cap (t0-8deg on the same
    # ellipsoid) and hangs down the back to mid-back. Above the cap rim the
    # grid shrinks to 96.5% (fully inside the cap solid -> no z-fight);
    # below it flares to 102%, drifts back onto the shoulders, and the tip
    # curls under. Sides end near the jawline; bottom corners round off.
    def back_bot(az):           # az deg from BACK center — U tip, not V
        a = abs(az)
        return 0.455 + 0.165 * (a / 112.0) ** 0.6

    def back_pt(az_deg, s):
        phi = math.pi + math.radians(az_deg)
        t0 = max(deg(14), cap_edge(phi) - deg(8))
        zt = CAPC[2] + CAPR[2] * math.cos(t0)
        zb = back_bot(az_deg)
        z = zt + (zb - zt) * s ** 0.95
        u = (z - CAPC[2]) / CAPR[2]
        if u > -0.12:                       # hugs the skull
            st = math.sqrt(max(0.0001, 1.0 - min(1.0, abs(u)) ** 2))
            flare = 1.0
        else:                               # leaf taper toward the tips
            d = min(1.0, (-0.12 - u) / 1.75)
            st = 0.993 * (1.0 - 0.52 * d ** 1.35)
            flare = 1.0 + 0.04 * d
        f = (zt - z) / max(zt - zb, 1e-6)
        tuck = 0.965 + 0.020 * min(1.0, f / 0.16)      # stays inside cap rim
        drift = 0.040 * min(1.0, max(0.0, (0.72 - z) / 0.30))
        curl = 0.022 * max(0.0, (f - 0.72) / 0.28)     # tip curls to the body
        rr = tuck * flare
        # pull the sides inward so the back is a rounded mass, not a slab
        side = min(1.0, abs(math.sin(phi)))            # 1 at the sides
        rr *= 1.0 - 0.16 * side * min(1.0, f / 0.55)
        x = CAPR[0] * st * rr * math.sin(phi)
        y = CAPC[1] + drift - (CAPR[1] * st * rr - curl) * math.cos(phi)
        e = max(0.0, (abs(az_deg) - 55) / 57.0)        # round bottom corners
        d2 = max(0.0, (f - 0.35) / 0.65)
        x *= 1.0 - 0.42 * e * d2 ** 1.4
        z += 0.018 * e * max(0.0, (f - 0.7) / 0.3) ** 2
        return (x, y, z)

    az_cols = [-112 + i * 224 / 48 for i in range(49)]
    parts.append(shell("HairBack",
                       lambda s, p: back_pt(math.degrees(p - math.pi), s),
                       [i / 27 for i in range(28)],
                       [math.radians(a) + math.pi for a in az_cols],
                       M["hair"], solid=0.014, wrap=False))
    # shade underlayer: starts below the cap zone, pushed out + down so a
    # rim of #5e3a22 reads around/below the mantle like the 2D outline.
    # shade underlayer: same surface radius as the mantle, offset DOWNWARD,
    # starting at s=0.62 so only its bottom ~1/3 extends below the main
    # mantle's hem -> a hairShade rim (2D stroke), never occluding the main
    # #8a5a3a face from behind.
    def shade_pt(az_deg, s):
        x, y, z = back_pt(az_deg, s)
        d = max(0.0, (s - 0.62) / 0.38)
        return (x, y + 0.004, z - 0.010 - 0.030 * d)

    parts.append(shell("HairBackShade",
                       lambda s, p: shade_pt(math.degrees(p - math.pi), s),
                       [0.62 + 0.38 * i / 14 for i in range(15)],
                       [math.radians(a) + math.pi for a in az_cols[1:-1]],
                       M["hair2"], solid=0.005, wrap=False))

    # ================= export =================
    bpy.ops.object.select_all(action="DESELECT")
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format="GLB",
        use_selection=True, export_apply=True, export_yup=True,
    )
    print("EXPORTED", OUT, os.path.getsize(OUT), "bytes,", len(parts), "parts")

    debug_renders()


def remap_uv_position(ob, x0, x1, z0, z1, clamp=False):
    """Identical to v1's mapping (see build_lily.py): planar (x,z)->uv of the
    2D face texture onto the head; margin rows/cols are pure skin."""
    me = ob.data
    uv = me.uv_layers.active or me.uv_layers.new(name="UVMap")
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


def debug_renders():
    """flat workbench renders (front / left / back / 3-4) for iteration."""
    try:
        sc = bpy.context.scene
        sc.render.engine = "BLENDER_WORKBENCH"
        sc.display.shading.light = "STUDIO"
        sc.display.shading.color_type = "MATERIAL"
        sc.render.resolution_x = 440
        sc.render.resolution_y = 560
        if sc.world is None:
            sc.world = bpy.data.worlds.new("World")
        sc.world.use_nodes = True
        bg = sc.world.node_tree.nodes.get("Background")
        if bg:
            bg.inputs[0].default_value = (0.92, 0.92, 0.94, 1)
            bg.inputs[1].default_value = 1.0
        tgt = bpy.data.objects.new("tgt", None)
        sc.collection.objects.link(tgt)
        tgt.location = (0, 0, 0.52)
        for name, loc in (("front", (0, -2.3, 0.62)),
                          ("left", (2.3, 0.0, 0.62)),
                          ("back", (0, 2.3, 0.62)),
                          ("q45", (-1.75, -1.75, 0.66))):
            cam_data = bpy.data.cameras.new("cam")
            cam = bpy.data.objects.new("cam", cam_data)
            sc.collection.objects.link(cam)
            cam.location = loc
            con = cam.constraints.new("TRACK_TO")
            con.target = tgt
            sc.camera = cam
            sc.render.filepath = os.path.join("/tmp/kilo", "lily2_%s.png" % name)
            bpy.ops.render.render(write_still=True)
            bpy.data.objects.remove(cam, do_unlink=True)
        print("debug renders written to /tmp/kilo/lily2_*.png")
    except Exception as e:
        print("debug render skipped:", e)


if __name__ == "__main__":
    main()
