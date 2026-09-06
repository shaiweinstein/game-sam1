#!/usr/bin/env python3
"""S4 spike — 3D Lily v4: the swimsuit full-coverage fix. Body, face, hair
and daisy position are v3's (all passed); ONLY the swimsuit section below
line ~472 changed, plus the P2 daisy rebuild.

Run:  blender --background --python spike3/blender/build_lily4.py
Out:  spike3/assets/lily4.glb   (neutral A-pose, no animation)

v4 fixes from the family review of v3 ("parts of her front and back are
not covered" — arrows at the front and the back crotch):
  P0  the suit is ONE watertight piece down to a continuous upper-thigh
      hem: below the hip line the cross-section blends from the torso
      ellipse into a figure-8/peanut wrapping BOTH thighs (pad 8mm,
      centers on the leg axes) with fabric bridges across the crotch at
      front AND back. v3's separate SuitTab/TrimTab lofts (which left a
      ~5cm skin slit at the back crotch) and the W-shaped hem are gone.
  P1  neckline: shallow scoop only (shoulder line all around, 28mm dip
      at center front) — no 58mm halter scoop / strap look.
  P2  daisy: 4 chunky overlapping flattened spheres + orange center,
      ~53mm overall like the 2D flower (was a tiny jewel).
  P3  brightness is a VIEWER fix (spike3.js toon ramp for the suit
      materials) — the base color stays the exact #ffd93d here.

v3 fixes from the family review of v2 (keep v2/v3 scripts untouched):
  1. HAIR: cap snug to the skull (overhang ~3mm, no front/back shelf);
     bangs emerge FROM the cap surface at the rim (no recessed seam) and
     carry 3-4 soft scallops, ending just above the eyes; side locks flush
     on the cheeks (no outward hooks, no sky gaps); back mantle hugs
     skull->nape->upper back (no board, no nape gap), hem a soft rounded U
     at z~0.31 center / near jaw at the sides, hairShade integrated as a
     thin stroke ON the mantle hem (no poking underlayer notch).
  2. SHOULDERS/ARMS: small kid shoulder caps; arms = upper arm + forearm
     (elbow at the mixamo bone length) + rounded mittens that OVERLAP the
     wrist (no floating balls); chubbier kid radii.
  3. LEGS/FEET: each leg is ONE continuous loft (hip->knee->calf->ankle,
     no bead pinch gaps); feet bigger with a distinct forward toe box
     + heel (bare-foot read, not "socks").
  4. CHEST: TORSO_RINGS flattened at 0.505-0.545 (child chest, the
     adult-looking mounds removed); daisy center re-seated on the flat.

Original v2 notes (still true for the parts that stayed):
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
OUT = os.path.join(ROOT, "spike3", "assets", "lily4.glb")
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
    (0.545, 0.112, 0.077),
    (0.505, 0.113, 0.076),
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
    v4 (P1) shallow scoop, per the 2D spec: fabric sits at the shoulder
    line all around — side/back edge z 0.556->0.552, center front dips to
    0.528 (2D: y165 shoulders -> y172.5 center ~ 28mm in 3D scale).
    v3's 0.058 c ** 1.5 front term (58mm halter scoop, thin-strap look)
    is gone."""
    c = math.cos(a)
    if c > 0:
        return 0.556 - 0.028 * c ** 1.6
    return 0.556 - 0.004 * abs(c) ** 2.0


def suit_bot(a):
    """v4 (P0) hem: ONE continuous ring at upper-thigh height, front AND
    back (2D hem y262 -> z 0.209-0.216; code mapping "2D tabs reach y262
    -> z ~0.209"), z 0.212 everywhere — no W-dip, no high-cut back, no
    separate tabs. Only a tiny (8mm) upward notch at the very front
    center (2D notch rises 7px=26mm; capped at 8mm: the family's arrows
    were about EXPOSURE, and the spec allows a subtle notch or none).
    The back center is fully closed at hem height."""
    ad = abs(math.degrees(a))
    if ad <= 90.0:
        return 0.212 + 0.008 * math.exp(-((ad / 12.0) ** 2))
    return 0.212


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

    # small rounded kid shoulder caps (v2's were read as mounds): just a
    # soft cap over the glenohumeral joint, tucked higher/back
    for side, sx in (("L", 1), ("R", -1)):
        parts.append(ellipsoid("ShoulderCap" + side, (0.038, 0.041, 0.035),
                               (sx * 0.101, 0.012, 0.527), M["skin"]))

    # neck: visible skin between chin (z 0.600) and shoulders (0.545)
    parts.append(loft("Neck",
                      [ring(0, 0.006, z, rx, ry, 32)
                       for (z, rx, ry) in ((0.645, 0.046, 0.048),
                                           (0.610, 0.053, 0.055),
                                           (0.578, 0.058, 0.060),
                                           (0.548, 0.068, 0.068))],
                      M["skin"], cap_top=True, cap_bot=True))

    # arms (S3) — TWO kinematic segments with a real elbow so the mocap
    # ForeArm bone actually bends the arm (v2 bound the whole arm to the
    # UpperArm -> the hand crossed the chest at midswing). BUT the mesh is
    # ONE continuous loft through shoulder->elbow->wrist (v2's stacked
    # capsule ends read as balloon beads); the walk script blends the
    # skinning LeftArm/LeftForeArm across the elbow zone. Segment lengths
    # mirror the Mixamo UpperArm/ForeArm split of the 0.205 shoulder->wrist
    # length so the bent bone elbow sits AT the mesh elbow (z ~0.407).
    # Chubby kid radii, mitten overlaps the wrist cap so it never floats.
    # S3 round-2: the v3-r1 arms hung almost inside the torso silhouette
    # (wrist x 0.135 vs chest rx 0.113), so in the FRONT view of the walk
    # ("no hands from the front") the forward-swung arms foreshortened onto
    # the body and vanished. Arms now splay outward like a relaxed kid A-pose
    # (elbow x 0.144, wrist x 0.159: hands read outside the hips at every
    # swing phase), are a touch chubbier, and the mitten is a rounder ball
    # that visibly overlaps the wrist cap (no floating ball-mittens).
    for side, sx in (("L", 1), ("R", -1)):
        sho = (sx * 0.118, 0.006, 0.520)
        elb = (sx * 0.144, 0.004, 0.409)
        wri = (sx * 0.159, -0.008, 0.318)
        parts.append(tube("Arm" + side,
                          [sho, ((sho[0] + elb[0]) / 2, 0.006, (sho[2] + elb[2]) / 2),
                           elb, ((elb[0] + wri[0]) / 2, -0.002, (elb[2] + wri[2]) / 2),
                           wri],
                          [0.0345, 0.0325, 0.0300, 0.0268, 0.0245],
                          M["skin"], n=16))
        parts.append(ellipsoid("Hand" + side, (0.0315, 0.0260, 0.0355),
                               (sx * 0.1635, -0.011, 0.288), M["skin"],
                               yaw=sx * math.radians(-8)))

    # legs (S3) — ONE continuous loft per leg. v2's thigh-sphere + knee
    # bead + calf-sphere read as balloon-animal beads; a lofted profile with
    # monotone radii (kid thigh -> soft knee -> chubby calf -> ankle) has no
    # pinch gaps at all. The knee stays near the bone knee (z 0.152) so the
    # walk script's UpLeg/Leg z-blend still bends it in the right place.
    hip_x, knee_x, ank_x = 0.0565, 0.0588, 0.0605
    LEG_ROWS = [  # (z, x, y, rx)  [x is the LEFT side; mirrored for right]
        (0.278, 0.0560, 0.0070, 0.0485),
        (0.252, 0.0566, 0.0035, 0.0474),
        (0.222, 0.0571, 0.0005, 0.0455),
        (0.192, 0.0578, -0.0030, 0.0425),
        (0.165, 0.0584, -0.0050, 0.0401),
        (0.142, 0.0588, -0.0040, 0.0396),
        (0.118, 0.0592, 0.0000, 0.0404),
        (0.092, 0.0597, 0.0030, 0.0358),
        (0.068, 0.0601, 0.0040, 0.0284),
        (0.050, 0.0605, 0.0040, 0.0240),
    ]
    for side, sx in (("L", 1), ("R", -1)):
        parts.append(loft("Leg" + side,
                          [ring(sx * x, y, z, rx, 0.90 * rx, 36)
                           for (z, x, y, rx) in LEG_ROWS],
                          M["skin"], cap_top=False, cap_bot=True))

        # BARE FEET (S3 round-2): ~12% longer + wider, a distinct LOW forward
        # toe box (sole stays on the floor to y -0.121, toes read as a wedge
        # pointing -Y from every angle) and a rounded heel behind — v2's round
        # "sock" blob is gone. Ankle join sits under the leg loft (z 0.050).
        parts.append(ellipsoid("Foot" + side, (0.0420, 0.0780, 0.0295),
                               (sx * 0.0605, -0.0310, 0.0290), M["skin"],
                               yaw=sx * math.radians(-6)))
        parts.append(ellipsoid("FootToe" + side, (0.0400, 0.0365, 0.0245),
                               (sx * 0.0600, -0.0965, 0.0245), M["skin"],
                               yaw=sx * math.radians(-6)))
        parts.append(ellipsoid("FootHeel" + side, (0.0340, 0.0310, 0.0320),
                               (sx * 0.0610, 0.0225, 0.0320), M["skin"]))

    # ================= SWIMSUIT (suit1 "Sunny One-Piece") ================
    # v4 (P0) — ONE watertight garment, no tabs. Below the hip line the
    # cross-section smoothly blends from the torso ellipse into a
    # figure-8/peanut that wraps BOTH thighs:
    #   * thigh wraps: radius = leg-loft radius + ~8mm pad, centers
    #     following the leg axes (same interpolation the old tabs used),
    #   * front & back crotch: bridged by the torso/pelvis ellipse itself
    #     (smooth max of torso vs wraps), so EVERY z is a single closed
    #     ring and no skin can show at the crotch, hem or elsewhere,
    #   * hem: continuous z 0.212 all around (+ tiny front notch).
    # The wrap outer radius (~0.110) stays inside the hip ellipse (~0.121),
    # so the silhouette still PINCHES onto the thighs (no skirt flare) —
    # replacing v3's suit_pinch hack entirely.
    HIP_LINE = 0.300           # peanut fully gone at/above
    BLEND_LO = 0.242           # peanut fully in at/below (blend 0.24..0.285)
    HEM_Z = 0.212

    def _ss(x):
        x = min(1.0, max(0.0, x))
        return x * x * (3 - 2 * x)

    def suit_rx(z):
        return interp(z, 1) + 0.008

    def suit_ry(z):
        return interp(z, 2) + 0.008

    # (z, cx, cy, rx) samples of the leg loft (LEG_ROWS above) — the thigh
    # wrap circles ride this axis, so the suit hugs the leg it wraps.
    THIGH_ROWS = ((0.278, 0.0560, 0.0070, 0.0485),
                  (0.252, 0.0566, 0.0035, 0.0474),
                  (0.222, 0.0571, 0.0005, 0.0455),
                  (0.192, 0.0578, -0.0030, 0.0425))

    def thigh_wrap(z):
        """(cx, cy, R) of the LEFT thigh wrap circle at z; mirror x for R.
        R = leg loft radius + 8mm fabric pad (clamped to the loft rows:
        above the hip row the leg does not exist, the torso takes over)."""
        rows = THIGH_ROWS
        zz = min(max(z, rows[-1][0]), rows[0][0])
        for (z1, x1, y1, r1), (z2, x2, y2, r2) in zip(rows, rows[1:]):
            if z2 <= zz <= z1:
                t = (z1 - zz) / (z1 - z2)
                return (x1 + (x2 - x1) * t, y1 + (y2 - y1) * t,
                        r1 + (r2 - r1) * t + 0.008)
        return (rows[0][1], rows[0][2], rows[0][3] + 0.008)

    def smax(p, q, k):
        """smooth max with flat-ish blend band k (metres) — avoids the
        visible kink where the wrap and torso radii cross."""
        m = max(p, q)
        d = abs(p - q)
        return m + 0.25 * (k - d) if d < k else m

    def suit_ring_pt(a, z, pad=0.0):
        """Single closed cross-section at height z, azimuth a (rad from
        front -Y). Torso ellipse for z >= HIP_LINE, thigh peanut for
        z <= BLEND_LO, smoothstep-blend radii in between."""
        ux, uy = math.sin(a), -math.cos(a)
        rx = suit_rx(z) + pad
        ry = suit_ry(z) + pad
        r = 1.0 / math.sqrt((ux / rx) ** 2 + (uy / ry) ** 2)   # torso ellipse
        b = _ss((HIP_LINE - z) / (HIP_LINE - BLEND_LO))
        if b > 1e-6:
            cx, cy, R = thigh_wrap(z)
            R += pad
            rp = 0.0
            for sgn in (1.0, -1.0):                            # both thighs
                wx, wy = -sgn * cx, TORSO_CY - cy              # ray origin O
                hb = -(ux * wx + uy * wy)
                disc = hb * hb - (wx * wx + wy * wy - R * R)
                if disc > 0.0:
                    rp = max(rp, hb + math.sqrt(disc))
            rp = smax(rp, r, 0.016)      # crotch bridges: never sink inside
            r = r + b * (rp - r)         # the torso ellipse (closed crotch)
        return (r * ux, TORSO_CY + r * uy, z)

    srings, limits = [], []
    N = 48
    z = HEM_Z
    while z <= 0.5851:
        row, lim = [], []
        for i in range(N):
            a = i * 2 * math.pi / N
            row.append(suit_ring_pt(a, z))
            lim.append((suit_top(a), suit_bot(a)))
        srings.append(row)
        limits.append(lim)
        z += 0.0088
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

    # orange trim tubes (the 2D outline stroke). TrimHem now rides the NEW
    # continuous ring — one clean loop following the peanut hem (with the
    # tiny front notch). v3's separate SuitTab/TrimTab meshes are absorbed
    # into the main suit; nothing hangs below the single watertight loft.
    def surf_pt(a, z, pad=0.0095):
        x, y, _ = suit_ring_pt(a, z, pad)
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

    # daisy on the chest (2D center y190 -> z 0.478), v4 (P2): the 2D
    # flower is four SOLID overlapping circles r3.2px (~12mm each) around
    # a r2.6px (~10mm) orange center -> ~55mm overall; v3's thin lens
    # ellipsoids read as a tiny jewel. Chunky flattened spheres (r 11.5mm,
    # squashed to 8mm along the suit normal) on 15mm offsets so petals
    # overlap each other and the center. SEATED like v3: centers 2mm INTO
    # the fabric (petals ride the chest curvature per-petal), ~6mm proud.
    dz = 0.478

    def daisy_seat(dx, zz, embed):
        rxp, ryp = interp(zz, 1) + 0.008, interp(zz, 2) + 0.008
        a = math.asin(max(-0.99, min(0.99, dx / rxp)))
        return (dx, TORSO_CY - ryp * math.cos(a) + embed, zz)

    parts.append(ellipsoid("DaisyC", (0.0090, 0.0075, 0.0090),
                           daisy_seat(0.0, dz, 0.0022), M["trim"]))
    for k, (ox, oz) in enumerate(((0, 0.0150), (0.0150, 0),
                                  (0, -0.0150), (-0.0150, 0))):
        parts.append(ellipsoid("DaisyP%d" % k, (0.0115, 0.0080, 0.0115),
                               daisy_seat(ox, dz + oz, 0.0020), M["daisy"]))

    # ================= HAIR (S3 pass) =================
    # Family review fixes: cap SNUG to the skull (no shelf), hairline HIGH
    # so the bangs band is its own visible fringe, locks FLUSH to the
    # cheeks (no antler gaps), mantle LONG and following head->nape->back
    # with a soft rounded-U hem and an integrated hairShade outline rim.
    # Everything stays a parametric grid shell (smooth rims, no cut edges,
    # no color changes: hairMain #8a5a3a + hairShade #5e3a22 only).

    # --- skull cap: ~3mm over the skull, rim from a high front hairline
    # (44deg polar, hidden behind the fringe) sweeping down the temples to
    # just above/behind the ear (76deg at the side) to the nape (102).
    # The old exponent-1.35 profile kept the side rim at 64deg -> a bald
    # skin patch showed on the temple in side/3-4 views.
    CAPR = (0.220, 0.210, 0.202)
    CAPC = (0.0, 0.006, 0.797)

    def cap_edge(phi):
        # exponent 0.22: hairline stays HIGH over the forehead (44deg) but
        # the rim dives to the equator/just past it at the SIDES (89-96deg)
        # and nape (104). Ray-casts proved the 0.55/0.85 curves left a bare
        # temple shelf between cap rim and fringe/locks in side views. The
        # below-equator rim lip (azimuth 70-110) is overgrown by the mantle
        # top edge (starts at cap radius +2mm), so no side shelf reads.
        return deg(44 + 60 * ((1 - math.cos(phi)) / 2) ** 0.22)

    cap = shell("HairCap",
                lambda s, p: head_pt(s * cap_edge(p), p, CAPR, CAPC),
                [i / 39 for i in range(40)],
                [i * 2 * math.pi / 72 for i in range(72)],
                M["hair"], solid=0.013)
    parts.append(cap)

    # --- bangs: the fringe, laid OVER the cap like real hair. The shell is
    # slightly larger than the cap; its radial scale starts buried in the
    # cap wall (crossing the cap outer face exactly AT the rim, t=44), so
    # there is no shelf and no seam arc across the forehead — the fringe
    # simply emerges from the skull hair and ends just above the brows.
    # The edge carries a gentle 4-arc cosine ripple -> 5 soft points.
    BR = (0.228, 0.220, 0.210)
    BC = (0.0, 0.0, 0.796)

    # radial ramp tuned so the shell crosses the cap's OUTER surface at
    # t ~= 42 deg = right at the front cap rim (44): no recessed seam band
    # across the forehead, the fringe simply grows out of the skull hair.
    def bangs_r(t):
        return 0.925 + 0.00054 * math.degrees(t)

    def bangs_edge(phi):
        # ends JUST above the eyes (eye z ~0.813; edge center z ~0.84),
        # 3-4 gentle scallops (S3 round-2: raised 2.4->3.2deg, so the fringe
        # edge visibly undulates instead of reading as a flat wall);
        # sweeps down along the hairline to the temple (phi 76) where it
        # meets the cap rim / lock curtain seam-to-seam.
        base = deg(76) + deg(6) * (abs(phi) / deg(76)) ** 1.5
        return base + deg(3.2) * (1.0 + math.cos(8.2 * phi)) / 2.0

    def bangs_pt(t, phi, extra=0.0):
        k = bangs_r(t) + extra
        return head_pt(t, phi, (BR[0] * k, BR[1] * k, BR[2] * k), BC)

    b_cols = [-deg(76) + i * (2 * deg(76)) / 60 for i in range(61)]
    parts.append(shell("Bangs",
                       lambda s, p: bangs_pt(deg(24) + s * (bangs_edge(p) - deg(24)), p),
                       [i / 33 for i in range(34)], b_cols,
                       M["hair"], solid=0.006, wrap=False))

    # hairShade stroke along the fringe edge (2D outline analogue) — hugging
    # the very bottom of the fringe (+2.5mm proud); a wider/higher band read
    # as a stray seam line across the bangs instead of an outline
    def bangs_shade_pt(t, phi):
        return bangs_pt(t, phi, extra=0.0025)

    parts.append(shell("BangsShade",
                       lambda s, p: bangs_shade_pt(
                           bangs_edge(p) - 0.013 + s * 0.014, p),
                       [0.0, 0.5, 1.0], b_cols,
                       M["hair2"], solid=0.002, wrap=False))

    # --- side locks (S3): FLUSH CHEEK CURTAINS, not ropes. A thin solid
    # shell strip riding the skull surface (top row buried under the cap),
    # its azimuth following the face outline temple(63deg) -> jaw(101deg),
    # its half-width tapering 10deg -> 3deg, ending at chin-to-neck level.
    # Never crosses in front of the face -> cannot occlude it in 3/4 views,
    # and with zero sky-gap off the cheek it reads like the 2D curtains.
    for side, sx in (("L", 1), ("R", -1)):
        # Ray-cast audit drove this shape: the curtain's INNER edge and
        # OUTER edge sweep back at different rates (inner lags), so the
        # strip stays on the face rim (2D hair boundary x~0.155+ => azimuth
        # >=34 rising slowly) all the way to the jaw, then tucks behind it.
        # inner(u) 34->70 deg, outer(u) 66->96 deg, polar 40->166 deg.
        # Inner edge never passes azimuth 34 at the top -> eyes/blush free.
        # S3 round-2: 2D curtains extend well PAST the jaw, hanging to the
        # waist beside the torso. Compress the on-skull sweep (40->166deg)
        # into the first 78% of u, then drape the rest straight down: out
        # beside the ribcage, slightly forward, tips near z 0.44.
        def lock_pt(u, v, sx=sx):
            tt = min(u, 0.78) / 0.78
            t = deg(40) + deg(126) * tt            # polar: under-cap -> jaw
            inn = deg(34) + deg(36) * tt ** 1.3
            out = deg(66) + deg(30) * tt ** 1.2
            phi = sx * (inn + (out - inn) * (1.0 + v) / 2.0)
            # ride the skull within ~2mm — a mid bulge left the curtain
            # floating off the cheek with a visible sky gap in side view
            k = 1.0 + 0.010 * math.sin(math.pi * min(tt, 0.92))
            pt = Vector(head_pt(t, phi, (0.2235 * k, 0.2155 * k, 0.2045 * k), BC))
            hang = max(0.0, (u - 0.78) / 0.22)
            pt.x *= 1.0 + 1.25 * hang              # flare beside the torso
            pt.y -= 0.018 * hang                   # lie in front of shoulder
            pt.z -= 0.16 * hang ** 1.1             # tip at waist level
            return pt
        parts.append(shell("HairLock" + side, lock_pt,
                           [i / 23 for i in range(24)],
                           [-1.0 + 2.0 * j / 9 for j in range(10)],
                           M["hair"], solid=0.0045, wrap=False))

    # --- back mantle: one surface defined by head/back cross-sections
    # Xp(z)/Yp(z) (snug on the skull, then hugging nape/neck/upper back -
    # no board protrusion, no nape gap). Hem zb(az) is a wide soft U:
    # z 0.315 at center (to the seat line, like the 2D), z 0.49 at the
    # sides (near the jaw) - no chevron point. Hem tucks slightly toward
    # the body.
    def pwi(pts, z):
        if z >= pts[0][0]:
            return pts[0][1]
        if z <= pts[-1][0]:
            return pts[-1][1]
        for (z1, v1), (z2, v2) in zip(pts, pts[1:]):
            if z2 <= z <= z1:
                return v1 + (v2 - v1) * (z1 - z) / (z1 - z2)
        return pts[-1][1]

    def _head_st(z):   # same ellipsoid family as the skull, +7mm
        u = (z - 0.795) / 0.206
        return math.sqrt(max(0.02, 1.0 - min(1.0, u * u)))

    # X/Y half-extents: max of the skull ellipsoid (so the mantle is flush
    # with the back of the head/cap above the nape — no nape gap) and a
    # drape profile (so it does NOT keep collapsing inward with the skull:
    # hair bridges the nape and hangs ~2-3cm off the upper back — no board).
    # The two branches cross near z 0.64 with similar slopes -> smooth fold.
    def mant_Xp(z):
        return max(0.221 * _head_st(z),
                   pwi(((0.645, 0.150), (0.58, 0.148), (0.50, 0.149),
                        (0.42, 0.151), (0.28, 0.153)), z))

    def mant_Yp(z):
        return max(0.006 + 0.212 * _head_st(z),
                   pwi(((0.645, 0.149), (0.61, 0.126), (0.56, 0.112),
                        (0.48, 0.104), (0.40, 0.100), (0.28, 0.097)), z))

    AZM = 121.0                      # mantle spans +/-121deg from back center
                                     # (= azimuth 59 from front): wraps past
                                     # the locks to the temple like the 2D
                                     # curtains -> no skin wedge in side view

    def mant_zt(az):                 # starts 7deg INSIDE the cap rim
        A = math.radians(180.0 - abs(az))
        tr = max(deg(16), cap_edge(A) - deg(7))
        return CAPC[2] + CAPR[2] * math.cos(tr)

    def mant_zb(az):                 # soft wide U hem (no chevron)
        return 0.315 + 0.175 * (abs(az) / AZM) ** 1.6

    def mantle_pt(az, s, off=0.0):   # az in degrees, signed; off = outward mm
        A = math.radians(180.0 - az)
        zt, zb = mant_zt(az), mant_zb(az)
        z = zt + (zb - zt) * s ** 0.92
        # NOTE: a z>0.70 "tuck" here pulled the surface INSIDE the skull
        # around the ears (bare skin band showed through in side views).
        # The mantle must stay on/above the cap radius everywhere; only the
        # hem (z<0.44) tucks toward the back.
        x = (mant_Xp(z) + off) * math.sin(A)
        y = 0.004 - (mant_Yp(z) + off) * math.cos(A)
        y -= 0.020 * max(0.0, (0.44 - z) / 0.16) * (1.0 - 0.4 * abs(math.sin(A)))
        return (x, y, z)

    az_cols = [-AZM + i * 2 * AZM / 46 for i in range(47)]
    p_cols = [math.radians(180.0 - a) for a in az_cols]
    parts.append(shell("HairBack",
                       lambda s, p: mantle_pt(math.degrees(math.pi - p), s),
                       [i / 27 for i in range(28)], p_cols,
                       M["hair"], solid=0.013, wrap=False))

    # hairShade hem band: the LAST slice of the same surface (rows from
    # s=0.92 to ~1.01, only 2mm proud) -> a thin dark stroke exactly on the
    # hem like the 2D outline. It must not extend past the mantle anywhere
    # (v1/v2 dark notches), so it shares every profile function.
    def shade_pt(az, s):
        # never crosses s=1.0 (the mantle hem itself) — going past it made
        # a dark lip hang below the hem in side view
        return mantle_pt(az, 0.885 + 0.115 * s, off=0.002)

    parts.append(shell("HairBackShade",
                       lambda s, p: shade_pt(math.degrees(math.pi - p), s),
                       [0.0, 0.5, 1.0], p_cols[2:-2],
                       M["hair2"], solid=0.002, wrap=False))

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
            sc.render.filepath = os.path.join("/tmp/kilo", "lily4_%s.png" % name)
            bpy.ops.render.render(write_still=True)
            bpy.data.objects.remove(cam, do_unlink=True)
        print("debug renders written to /tmp/kilo/lily4_*.png")
    except Exception as e:
        print("debug render skipped:", e)


if __name__ == "__main__":
    main()
