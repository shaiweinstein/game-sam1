"""Build spike3/assets/lily_walk.glb — Lily's mesh skinned to the Mixamo
"Walking" clip (FBX Binary, 30fps, In Place).

Pipeline (headless Blender 5.0):
  1. import Walking.fbx via the low-level loader (bpy.ops.import_scene.fbx is
     broken in 5.0.1: the operator references a `files` prop its base class
     no longer defines)
  2. import lily.glb (static chibi mesh, 1 m tall, face texture embedded)
  3. reshape the Mixamo rig segment-by-segment to Lily's chibi proportions.
     NOTE: the imported armature object carries scale 0.01 (FBX is cm) and a
     +90deg X rotation (Y-up -> Z-up). Bone head_local/tail_local are in that
     raw pre-conversion space, so measurements go through matrix_world and
     bone edits happen in edit mode (Bone.tail_local is read-only in 5.0).
  4. drop feet to the floor (orientation is already Lily's: faces -Y,
     her left = +X)
  5. join the lily parts, auto-weight bind to the rig
  6. export selection as GLB with the walk clip embedded (30 fps)
"""
import bpy
import math
from mathutils import Vector

BASE = "/home/shai/sg/game2/spike3"
FBX = BASE + "/assets/mixamo/Walking.fbx"
LILY = BASE + "/assets/lily.glb"
OUT = BASE + "/assets/lily_walk.glb"

# --- Lily target proportions (derived from js/character.js, 1.0 m tall) ---
HIP_Z = 0.31        # skirt waist / hips
ANKLE_Z = 0.05      # top of shoe
NECK_Z = 0.63       # chin (bottom of head sphere)
TOP_Z = 0.99        # top of head
SHOULDER_X = 0.150  # shoulder-joint x offset
ARM_LEN = 0.2073    # shoulder (0.150, z0.545) -> hand (0.205, z0.345)

bpy.ops.wm.read_factory_settings(use_empty=True)

# ---------- 1. Mixamo armature + animation ----------
import io_scene_fbx
from io_scene_fbx import import_fbx

class _Shim:
    def report(self, *a, **k):
        print("FBX REPORT:", a, k)

ret = import_fbx.load(_Shim(), bpy.context, filepath=FBX,
                      use_anim=True, global_scale=1.0)
print("fbx import:", ret)
arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
assert arm, "no armature imported"
arm.name = "LilyRig"
bpy.context.view_layer.update()

# ---------- 2. Lily mesh ----------
bpy.ops.import_scene.gltf(filepath=LILY)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("lily mesh parts:", [m.name for m in meshes])
assert meshes, "no lily mesh imported"

# ---------- 3. measure (world space) ----------
def bone(n):
    return arm.data.bones[n]

def w(loc):
    return arm.matrix_world @ Vector(loc)

hips_w = w(bone("mixamorig:Hips").head_local)
ankle_w = w(bone("mixamorig:LeftFoot").head_local)
toe_w = w(bone("mixamorig:LeftToeBase").tail_local)
neck_w = w(bone("mixamorig:Neck").head_local)
top_w = w(bone("mixamorig:HeadTop_End").tail_local)
sho_w = w(bone("mixamorig:LeftArm").head_local)   # shoulder joint
wrist_w = w(bone("mixamorig:LeftHand").head_local)
fwd = toe_w - ankle_w
print(f"hips z={hips_w.z:.3f} ankle z={ankle_w.z:.3f} neck z={neck_w.z:.3f} top z={top_w.z:.3f}")
print(f"toe-dir y={fwd.y:+.3f} (Lily faces -Y)  shoulder x={sho_w.x:+.3f}")

s_arm = ARM_LEN / (wrist_w - sho_w).length
sx = SHOULDER_X / abs(sho_w.x)
print(f"measured: arm_len={(wrist_w - sho_w).length:.3f} s_arm={s_arm:.3f} "
      f"shoulder_x={sho_w.x:.3f} width={sx:.3f}")
# s_leg / s_spine / s_head are solved below from the exact rig geometry.

# ---------- 4. reshape rig in edit mode ----------
# Mixamo's rest rig (world space, after the import's cm->m + Y-up->Z-up):
#   Hips head 1.043 -> tail 1.148 (points UP), Spine chain up to Neck 1.503,
#   HeadTop 2.051; UpLeg heads 0.975 (offset below Hips head); shoulders are
#   OFFSET children of Spine2 (not tail-attached); Neck/Head/HeadTop are
#   connect=False. So per-bone length surgery breaks the chain. Instead we
#   apply per-segment, per-axis affine scales to whole subtrees around a
#   pivot: every bone of the subtree has head AND tail transformed the same
#   way, so offsets and (broken) attachments stay consistent.
#   z-scales compress height segments, x-scale shortens the T-pose arms.

def subtree(root_name):
    out, seen, stack = [], set(), [arm.data.bones[root_name]]
    while stack:
        b = stack.pop()
        if b.name in seen:
            continue
        seen.add(b.name)
        out.append(b)
        stack.extend(b.children)
    return out

def aff_scale(root_name, s_axis, pivot_world):
    # per-AXIS scale in WORLD space (world z = height). Edit-bone coords are
    # in armature local space (raw FBX Y-up cm frame), so round-trip through
    # matrix_world; the object transform is a similarity, so this is exact.
    M = arm.matrix_world
    Mis = M.inverted()
    s = Vector(s_axis)
    piv = Vector(pivot_world)
    bones = subtree(root_name)
    # Snapshot first: connected children's heads are derived from their
    # parent's tail and move as the parent is edited, which would double-apply
    # the scale if read live.
    pts = {b.name: (Vector(eb[b.name].head), Vector(eb[b.name].tail)) for b in bones}
    for b in bones:
        h, t = pts[b.name]
        e = eb[b.name]
        e.head = Mis @ (piv + (M @ h - piv) * s)
        e.tail = Mis @ (piv + (M @ t - piv) * s)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones

# solve segment scales from the original world measurements
upleg_z = w(bone("mixamorig:LeftUpLeg").head_local).z
spine_z = w(bone("mixamorig:Spine").head_local).z
s_leg = ((HIP_Z - ANKLE_Z) - (hips_w.z - upleg_z)) / (upleg_z - ankle_w.z)
s_spine = ((NECK_Z - HIP_Z) - (spine_z - hips_w.z)) / (neck_w.z - spine_z)
print(f"solved: s_leg={s_leg:.3f} s_spine={s_spine:.3f}")

# 1. legs (pivot at thigh attach; leaves Hips bone untouched)
for side in ("Left", "Right"):
    piv = w(bone(f"mixamorig:{side}UpLeg").head_local)
    aff_scale(f"mixamorig:{side}UpLeg", (1, 1, s_leg), piv)
# 2. spine + shoulders/arms (z only; keeps shoulder-joint x offset intact)
aff_scale("mixamorig:Spine", (1, 1, s_spine), w(bone("mixamorig:Spine").head_local))
# 3. head: correct neck->crown so the top lands on TOP_Z after the floor drop
ankle_after = upleg_z - (upleg_z - ankle_w.z) * s_leg
drop = ANKLE_Z - ankle_after   # location.z += drop (negative = down)
necktail_after = (spine_z + (w(bone("mixamorig:Neck").tail_local).z - spine_z) * s_spine) + drop
top_after_spine = spine_z + (top_w.z - spine_z) * s_spine
s_head = (TOP_Z - necktail_after) / (top_after_spine - (spine_z + (w(bone("mixamorig:Neck").tail_local).z - spine_z) * s_spine))
print(f"drop={drop:.3f} s_head={s_head:.3f}")
aff_scale("mixamorig:Neck", (1, 1, s_head),
          w(bone("mixamorig:Neck").tail_local))
# 4. arms: T-pose arms run laterally; scale x around the shoulder joint
for side in ("Left", "Right"):
    piv = w(bone(f"mixamorig:{side}Arm").head_local)
    aff_scale(f"mixamorig:{side}Arm", (s_arm, 1, 1), piv)

bpy.ops.object.mode_set(mode="OBJECT")

# lateral width (object x-scale; bone lengths are local so unaffected)
arm.scale = (arm.scale.x * sx, arm.scale.y, arm.scale.z)
bpy.context.view_layer.update()

# drop feet to floor
ankle_w = w(bone("mixamorig:LeftFoot").head_local)
arm.location.z += ANKLE_Z - ankle_w.z
bpy.context.view_layer.update()

hips_w = w(bone("mixamorig:Hips").head_local)
sho_w = w(bone("mixamorig:LeftArm").head_local)
top_w = w(bone("mixamorig:HeadTop_End").tail_local)
ankle_w = w(bone("mixamorig:LeftFoot").head_local)
print(f"final hips z={hips_w.z:.3f}  shoulder x={sho_w.x:+.3f} z={sho_w.z:.3f}  "
      f"top z={top_w.z:.3f}  ankle z={ankle_w.z:.3f}")

# ---------- 5. join lily parts + bind ----------
# Bone-heat auto weights fail on these disjoint blobs (0 weighted verts), so
# each part is bound by rule: a chibi part is a rigid blob that follows one
# bone, with a short blend only where a joint is visible (knee, waist).
# (Lily's left = +X = Mixamo "Left"; knee lands at z~0.146 after reshaping.)

def zblend(b_top, b_bot, z_top, z_bot):
    span = max(z_top - z_bot, 1e-6)
    def bot(c):
        if c.z >= z_top:
            return 0.0
        if c.z <= z_bot:
            return 1.0
        return (z_top - c.z) / span
    return [(b_top, lambda c: 1.0 - bot(c)), (b_bot, bot)]

BINDINGS = {
    "Head":        [("mixamorig:Head", None)],
    "HairCap":     [("mixamorig:Head", None)],
    "HairBangs":   [("mixamorig:Head", None)],
    "HairLockL":   [("mixamorig:Head", None)],
    "HairLockR":   [("mixamorig:Head", None)],
    "LegL":        zblend("mixamorig:LeftUpLeg", "mixamorig:LeftLeg", 0.173, 0.119),
    "LegR":        zblend("mixamorig:RightUpLeg", "mixamorig:RightLeg", 0.173, 0.119),
    "ShoeL":       [("mixamorig:LeftFoot", None)],
    "SoleL":       [("mixamorig:LeftFoot", None)],
    "ShoeR":       [("mixamorig:RightFoot", None)],
    "SoleR":       [("mixamorig:RightFoot", None)],
    "ArmL":        [("mixamorig:LeftArm", None)],
    "SleeveL":     [("mixamorig:LeftArm", None)],
    "HandL":       [("mixamorig:LeftArm", None)],
    "ArmR":        [("mixamorig:RightArm", None)],
    "SleeveR":     [("mixamorig:RightArm", None)],
    "HandR":       [("mixamorig:RightArm", None)],
    "Torso":       zblend("mixamorig:Spine", "mixamorig:Hips", 0.50, 0.35),
    "Shirt":       zblend("mixamorig:Spine", "mixamorig:Hips", 0.50, 0.35),
    "Skirt":       [("mixamorig:Hips", None)],
}
unbound = [m.name for m in meshes if m.name not in BINDINGS]
assert not unbound, f"parts missing bindings: {unbound}"

for m in meshes:
    spec = BINDINGS[m.name]
    if spec[0][1] is None:  # rigid part
        vg = m.vertex_groups.new(name=spec[0][0])
        vg.add([v.index for v in m.data.vertices], 1.0, "REPLACE")
    else:  # two-bone z blend
        (n1, p1), (n2, p2) = spec
        g1 = m.vertex_groups.new(name=n1)
        g2 = m.vertex_groups.new(name=n2)
        for v in m.data.vertices:
            w2 = p2(v.co)
            w1 = 1.0 - w2
            if w1 > 0:
                g1.add([v.index], w1, "REPLACE")
            if w2 > 0:
                g2.add([v.index], w2, "REPLACE")

# flatten part transforms so the joined local space is world space
bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bpy.context.view_layer.objects.active = max(meshes, key=lambda m: len(m.data.vertices))
bpy.ops.object.join()
lily = bpy.context.view_layer.objects.active
lily.name = "Lily"

bpy.ops.object.select_all(action="DESELECT")
lily.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_NAME")
tot = weighted = 0
for v in lily.data.vertices:
    tot += 1
    if any(g.weight > 0 for g in v.groups):
        weighted += 1
print(f"weighted verts: {weighted}/{tot}  groups: {len(lily.vertex_groups)}")

# ---------- 6. preview + export ----------
sc = bpy.context.scene
sc.frame_start = 1
sc.frame_end = 32
sc.render.fps = 30

# Cycles CPU: headless EEVEE-Next renders pure black on this box
sc.render.engine = "CYCLES"
sc.cycles.samples = 24
if sc.world is None:
    sc.world = bpy.data.worlds.new("World")
sc.world.use_nodes = True
bg = sc.world.node_tree.nodes.get("Background")
bg.inputs[0].default_value = (1, 1, 1, 1)
bg.inputs[1].default_value = 0.7
sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 3.0
sun = bpy.data.objects.new("sun", sun_data)
sc.collection.objects.link(sun)
sun.rotation_euler = (math.radians(50), 0, math.radians(-30))

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam)
cam.location = (0, -2.0, 0.75)
cam.rotation_euler = (math.radians(85), 0, 0)
sc.camera = cam
sc.render.resolution_x = 480
sc.render.resolution_y = 560
for f in (1, 9, 16, 24):
    sc.frame_set(f)
    bpy.context.view_layer.update()
    sc.render.filepath = f"/tmp/kilo/walk_preview_f{f}.png"
    bpy.ops.render.render(write_still=True)
print("previews written")

bpy.ops.object.select_all(action="DESELECT")
lily.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
try:
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB",
                              use_selection=True, export_animations=True,
                              export_skins=True)
except TypeError as e:
    print("gltf export props:", sorted(p.identifier for p in
          bpy.ops.export_scene.gltf.bl_rna.properties))
    raise
import os
print("EXPORTED:", OUT, os.path.getsize(OUT), "bytes")
