"""Build spike3/assets/lily2_walk.glb — Lily v2 (swimsuit kid) skinned to the
Mixamo "Walking" clip (FBX Binary, 30fps, In Place).

Same proven pipeline as build_lily_walk.py (validated on v1 in the viewer):
  1. import Walking.fbx via the low-level loader (bpy.ops.import_scene.fbx is
     broken in Blender 5.0.1)
  2. import lily2.glb (static mesh, 1 m tall, face texture embedded)
  3. reshape the Mixamo rest rig per-segment to Lily v2's proportions
     (kid torso rings / bare feet / swimsuit — see build_lily2.py):
       HIP target   thigh root z 0.272 (TORSO_RINGS bottom)
       ANKLE target z 0.052,  crown z 0.99 (HEAD_C.z + HEAD_R.z)
       SHOULDER target x 0.120 z 0.522, arm len 0.206 (Arm L endpoints)
  4. drop feet to floor
  5. bind every part by rule (bone-heat fails on disjoint chibi blobs):
       head+hair -> Head;  neck -> Head/Spine blend;  torso/suit/daisy ->
       Spine/Hips blend;  shoulder caps -> Spine/LeftArm(RightArm) blend;
       arm+hand rigid to the UpperArm bone (no elbow, as v1);  thigh ->
       UpLeg/Leg blend across the bone knee;  knee/calf -> Leg;
       bare feet -> Foot;  swimsuit leg tabs -> Hips/UpLeg blend
  6. join, parent to the armature, export GLB with the walk clip (30 fps)
"""
import bpy
import math
import os
from mathutils import Vector

BASE = "/home/shai/sg/game2/spike3"
FBX = BASE + "/assets/mixamo/Walking.fbx"
LILY = BASE + "/assets/lily2.glb"
OUT = BASE + "/assets/lily2_walk.glb"

# --- Lily v2 target proportions (match build_lily2.py geometry) ---
THIGH_TOP_Z = 0.272   # mesh thigh root (hip socket of the body)
ANKLE_Z = 0.052       # mesh ankle joint
NECK_Z = 0.62         # Neck bone head (chin is 0.600, neck mesh to 0.645)
TOP_Z = 0.99          # crown (HEAD_C.z 0.795 + HEAD_R.z 0.1948)
SHOULDER_X = 0.120    # shoulder-joint x offset (Arm top point)
ARM_LEN = 0.2058      # (0.120,0.004,0.522) -> (0.155,-0.014,0.320)

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

# ---------- 2. Lily v2 mesh ----------
bpy.ops.import_scene.gltf(filepath=LILY)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("lily2 mesh parts:", len(meshes), [m.name for m in meshes])
assert len(meshes) == 38, "expected 38 parts"

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
sho_w = w(bone("mixamorig:LeftArm").head_local)
wrist_w = w(bone("mixamorig:LeftHand").head_local)
upleg_z = w(bone("mixamorig:LeftUpLeg").head_local).z
spine_z = w(bone("mixamorig:Spine").head_local).z
hips_off = hips_w.z - upleg_z          # Hips head sits this far above thigh root
HIP_Z = THIGH_TOP_Z + hips_off          # so the thigh root lands at THIGH_TOP_Z
print(f"raw: hips z={hips_w.z:.3f} upleg z={upleg_z:.3f} ankle z={ankle_w.z:.3f} "
      f"neck z={neck_w.z:.3f} top z={top_w.z:.3f}")
print(f"toe-dir y={toe_w.y - ankle_w.y:+.3f} (Lily faces -Y)  shoulder x={sho_w.x:+.3f}")
print(f"HIP_Z (pelvis target) = {HIP_Z:.3f}")

s_arm = ARM_LEN / (wrist_w - sho_w).length
sx = SHOULDER_X / abs(sho_w.x)
print(f"measured: arm_len={(wrist_w - sho_w).length:.3f} s_arm={s_arm:.3f} width={sx:.3f}")

# ---------- 4. reshape rig (per-segment subtree affine scales, world z = height) ----------
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
    M = arm.matrix_world
    Mis = M.inverted()
    s = Vector(s_axis)
    piv = Vector(pivot_world)
    bones = subtree(root_name)
    pts = {b.name: (Vector(eb[b.name].head), Vector(eb[b.name].tail)) for b in bones}
    for b in bones:
        h, t = pts[b.name]
        e = eb[b.name]
        e.head = Mis @ (piv + (M @ h - piv) * s)
        e.tail = Mis @ (piv + (M @ t - piv) * s)

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones

s_leg = ((HIP_Z - ANKLE_Z) - hips_off) / (upleg_z - ankle_w.z)
s_spine = ((NECK_Z - HIP_Z) - (spine_z - hips_w.z)) / (neck_w.z - spine_z)
print(f"solved: s_leg={s_leg:.3f} s_spine={s_spine:.3f}")
for side in ("Left", "Right"):
    piv = w(bone(f"mixamorig:{side}UpLeg").head_local)
    aff_scale(f"mixamorig:{side}UpLeg", (1, 1, s_leg), piv)
aff_scale("mixamorig:Spine", (1, 1, s_spine), w(bone("mixamorig:Spine").head_local))

# head: MEASURE-DRIVEN iterative scale so HeadTop_End lands exactly on TOP_Z.
# (The v1 closed-form solver read stale bone positions: arm.data.bones only
# reflect edit-bone changes after a depsgraph update, which does not happen
# mid-script in edit mode. aff_scale() already works on live edit_bones, so
# re-measuring eb[] between passes converges in one or two steps. Pivoting
# at the neck tail keeps the authored neck/shoulder junction stable.)
M_ = arm.matrix_world
# the whole rig still sits `drop` above its final position (applied after
# OBJECT mode) — solve TOP_Z in CURRENT coords by pre-compensating it.
drop = ANKLE_Z - (M_ @ eb["mixamorig:LeftFoot"].head).z
for it in range(4):
    top_cur_z = (M_ @ eb["mixamorig:HeadTop_End"].tail).z
    pivz = (M_ @ eb["mixamorig:Neck"].tail).z
    s_head = (TOP_Z - drop - pivz) / (top_cur_z - pivz)
    aff_scale("mixamorig:Neck", (1, 1, s_head), Vector((0.0, 0.0, pivz)))
    err = abs((M_ @ eb["mixamorig:HeadTop_End"].tail).z - (TOP_Z - drop))
    print(f"  head pass {it}: top {top_cur_z:.3f} s_head {s_head:.3f} err {err:.4f}")
    if err < 5e-4:
        break
for side in ("Left", "Right"):
    piv = w(bone(f"mixamorig:{side}Arm").head_local)
    aff_scale(f"mixamorig:{side}Arm", (s_arm, 1, 1), piv)

bpy.ops.object.mode_set(mode="OBJECT")

arm.scale = (arm.scale.x * sx, arm.scale.y, arm.scale.z)
bpy.context.view_layer.update()
arm.location.z += ANKLE_Z - w(bone("mixamorig:LeftFoot").head_local).z
bpy.context.view_layer.update()

sho_w = w(bone("mixamorig:LeftArm").head_local)
knee_z = w(bone("mixamorig:LeftUpLeg").tail_local).z
top_w = w(bone("mixamorig:HeadTop_End").tail_local)
print(f"final: hips z={w(bone('mixamorig:Hips').head_local).z:.3f} "
      f"thigh-root z={w(bone('mixamorig:LeftUpLeg').head_local).z:.3f} "
      f"knee z={knee_z:.3f} shoulder x={sho_w.x:+.3f} z={sho_w.z:.3f} "
      f"top z={top_w.z:.3f}")

# ---------- 5. bind parts by rule ----------
def zblend(b_top, b_bot, z_top, z_bot):
    span = max(z_top - z_bot, 1e-6)
    def bot(c):
        if c.z >= z_top:
            return 0.0
        if c.z <= z_bot:
            return 1.0
        return (z_top - c.z) / span
    return [(b_top, lambda c: 1.0 - bot(c)), (b_bot, bot)]

HAIR = ["HairCap", "Bangs", "BangsShade", "HairLockL", "HairLockR"]
# Long back hair must NOT ride the Head bone: the authored head nod swings a
# rigid mantle attached at the neck like a cape. Bind the back mantle (and
# its shade underlayer) to the Spine so it stays on her back; the cap/bangs/
# locks still follow the head.
CAPE = ["HairBack", "HairBackShade"]
BODY_BLEND = zblend("mixamorig:Spine", "mixamorig:Hips", 0.50, 0.36)
LEG_BLEND = zblend("mixamorig:LeftUpLeg", "mixamorig:LeftLeg",
                   knee_z + 0.028, knee_z - 0.032)
LEG_BLEND_R = zblend("mixamorig:RightUpLeg", "mixamorig:RightLeg",
                     knee_z + 0.028, knee_z - 0.032)
TAB_BLEND = zblend("mixamorig:Hips", "mixamorig:LeftUpLeg", 0.272, 0.206)
TAB_BLEND_R = zblend("mixamorig:Hips", "mixamorig:RightUpLeg", 0.272, 0.206)
CAP_BLEND_L = zblend("mixamorig:Spine", "mixamorig:LeftArm", 0.560, 0.498)
CAP_BLEND_R = zblend("mixamorig:Spine", "mixamorig:RightArm", 0.560, 0.498)
NECK_BLEND = zblend("mixamorig:Head", "mixamorig:Spine", 0.645, 0.556)
# back mantle: top rides the skull, the length drapes with the spine so a
# head nod does not swing the whole cape off her back.
CAPE_BLEND = zblend("mixamorig:Head", "mixamorig:Spine", 0.82, 0.60)

BINDINGS = {"Head": [("mixamorig:Head", None)]}
for h in HAIR:
    BINDINGS[h] = [("mixamorig:Head", None)]
for c in CAPE:
    BINDINGS[c] = CAPE_BLEND
BINDINGS.update({
    "Neck":     NECK_BLEND,
    "Torso":    BODY_BLEND,
    "ShoulderCapL": CAP_BLEND_L,
    "ShoulderCapR": CAP_BLEND_R,
    "ArmL":     [("mixamorig:LeftArm", None)],
    "HandL":    [("mixamorig:LeftArm", None)],
    "ArmR":     [("mixamorig:RightArm", None)],
    "HandR":    [("mixamorig:RightArm", None)],
    "ThighL":   LEG_BLEND,
    "KneeL":    [("mixamorig:LeftLeg", None)],
    "CalfL":    [("mixamorig:LeftLeg", None)],
    "FootBallL": [("mixamorig:LeftFoot", None)],
    "FootHeelL": [("mixamorig:LeftFoot", None)],
    "ThighR":   LEG_BLEND_R,
    "KneeR":    [("mixamorig:RightLeg", None)],
    "CalfR":    [("mixamorig:RightLeg", None)],
    "FootBallR": [("mixamorig:RightFoot", None)],
    "FootHeelR": [("mixamorig:RightFoot", None)],
    "Suit":     BODY_BLEND,
    "TrimNeckline": [("mixamorig:Spine", None)],
    "TrimHem":  [("mixamorig:Hips", None)],
    "SuitTabL": TAB_BLEND,
    "TrimTabL": TAB_BLEND,
    "SuitTabR": TAB_BLEND_R,
    "TrimTabR": TAB_BLEND_R,
    "DaisyC":   BODY_BLEND,
})
for k in range(4):
    BINDINGS["DaisyP%d" % k] = BODY_BLEND

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

bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bpy.context.view_layer.objects.active = max(meshes, key=lambda m: len(m.data.vertices))
bpy.ops.object.join()
lily = bpy.context.view_layer.objects.active
lily.name = "Lily2"

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

# ---------- 6. preview (fast Workbench, material colors) + export ----------
sc = bpy.context.scene
sc.frame_start = 1
sc.frame_end = 32
sc.render.fps = 30

sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "MATERIAL"

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
sc.collection.objects.link(cam)
cam.location = (0, -2.0, 0.62)
cam.rotation_euler = (math.radians(88), 0, 0)
sc.camera = cam
sc.render.resolution_x = 480
sc.render.resolution_y = 560
for f in (1, 9, 16, 24):
    sc.frame_set(f)
    bpy.context.view_layer.update()
    sc.render.filepath = f"/tmp/kilo/walk2_preview_f{f}.png"
    bpy.ops.render.render(write_still=True)
print("previews written")

bpy.ops.object.select_all(action="DESELECT")
lily.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB",
                          use_selection=True, export_animations=True,
                          export_skins=True)
print("EXPORTED:", OUT, os.path.getsize(OUT), "bytes")
