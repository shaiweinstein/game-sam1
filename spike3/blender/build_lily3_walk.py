"""Build spike3/assets/lily3_walk.glb — Lily v3 skinned to the Mixamo
"Walking" clip (FBX Binary, 30fps, In Place), with the S3 walk fixes:

  * ARMS split across the elbow: the arm loft blends LeftArm -> LeftForeArm
    around the mesh elbow (z 0.409) and the hand is rigid to LeftForeArm,
    so the mocap elbow bend finally reaches the forearm/hand (v2 bound the
    whole arm rigid to LeftArm -> stiff sticks).
  * ARM REST CONFORMED TO THE HANGING MESH (S3 round-3 — the definitive
    fix). The FBX rest is a T-pose while the mesh hangs at its sides, and
    the glTF exporter ALWAYS builds the skin's inverseBindMatrices from
    the REST pose (io_scene_gltf2/blender/exp/skins.py reads
    bone.bone.matrix_local) — no flag can re-bind to a different pose.
    (export_rest_position_armature only swaps the node TRS defaults,
    producing mismatched IBM/keys: measured on the exported file, the
    LeftHand delta at the nominal bind frame was a ~83deg residual
    rotation = the fists-on-chest artifact of v3-r1/r2. Posing the armature
    manually before that export was also silently reverted by the
    depsgraph, which re-evaluates the linked action; both attempts are
    dead ends.) The correct classic retarget: in EDIT mode rotate the two
    arm subtrees' REST bones from horizontal to the modelled hang (77deg
    around the shoulder joints — outward splay chosen so the rest
    elbow/wrist land on the mesh's), then RE-BAKE that subtree's keys so
    every absolute walk pose is bit-identical to before (basis' solved from
    the recorded pose matrices against the new rest; formula
    pose = parent_pose @ ml @ basis vs pose = ml @ basis is auto-detected).
    Rest == bind == mesh shape now, so a plain default export
    (no rest_position flags, action attached) skin-deltas the arm by the
    pure swing around the hang: hands stay outside the torso silhouette at
    every phase and NEVER cross the chest; the forearm's real elbow
    flexion survives (rest = straight hang, keys keep the absolute flexion).
  * SWING DAMP toward the (now correct) rest: with the conformed arm rest,
    scaling each arm-bone key rotation toward IDENTITY finally means
    "shrink the swing around the hang":
        q'(t) = axisangle(axis(q), f * angle(q))
    with f = 0.72 (UpperArm) / 0.82 (ForeArm) -> a calm kid swing that
    never crosses the body midline (mixamo adult was ~35deg per arm).
  * MANTLE re-derived for the new long mantle: HairBack(+shade) blends
    Head -> Spine across z 0.74 -> 0.56, so the skull part rides the head
    nod while the length (and tip) drapes with the spine — the mantle can
    no longer swing off the back as one stiff plate; the Spine lag gives a
    cheap tip follow-through.
  * LEGS are one continuous loft each: bound UpLeg -> Leg across the bone
    knee, same as v2's blend window.

Everything else is the proven v1/v2 pipeline (see build_lily2_walk.py):
low-level FBX import (bpy.ops.import_scene.fbx is broken in Blender 5.0),
per-segment subtree rig scaling, deterministic per-part skinning by rule,
join + armature parent + GLB export with the 30fps clip.

NOTE on GLB inspection: the 36 parts are JOINED into one skinned mesh
(node "Lily3", 7 primitives = 7 materials), so a mesh-name listing shows
the leftover datablock name "HairCap" — that is NOT a missing-geometry
bug (the working lily2_walk.glb has the identical layout; check the
accessor vertex counts per primitive: ~40.1k total for all 36 parts).
"""
import bpy
import math
import os
from mathutils import Matrix, Quaternion, Vector

BASE = "/home/shai/sg/game2/spike3"
FBX = BASE + "/assets/mixamo/Walking.fbx"
LILY = BASE + "/assets/lily3.glb"
OUT = BASE + "/assets/lily3_walk.glb"

# --- Lily v3 target proportions (match build_lily3.py geometry) ---
THIGH_TOP_Z = 0.278   # leg loft top ring (hip socket)
ANKLE_Z = 0.050       # leg loft ankle ring / foot joint
NECK_Z = 0.62         # Neck bone head (chin 0.600, neck mesh to 0.645)
TOP_Z = 0.99          # crown (HEAD_C.z 0.795 + HEAD_R.z 0.1948)
SHOULDER_X = 0.118    # mesh shoulder joint x offset
ARM_LEN = 0.2065      # sho (0.118,0.006,0.520) -> wri (0.159,-0.008,0.318)
ELBOW_Z = 0.409       # mesh elbow (S3-r2 outward-splayed arm)

ARM_DAMP = 0.72       # UpperArm animated rotation scale
FORE_DAMP = 0.82      # ForeArm animated rotation scale (keep elbow action)

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

# ---------- 2. Lily v3 mesh ----------
bpy.ops.import_scene.gltf(filepath=LILY)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("lily3 mesh parts:", len(meshes))
assert len(meshes) == 36, "expected 36 parts"

# ---------- 3. measure (world space) ----------
def bone(n):
    return arm.data.bones[n]

def w(loc):
    return arm.matrix_world @ Vector(loc)

hips_w = w(bone("mixamorig:Hips").head_local)
ankle_w = w(bone("mixamorig:LeftFoot").head_local)
neck_w = w(bone("mixamorig:Neck").head_local)
sho_w = w(bone("mixamorig:LeftArm").head_local)
wrist_w = w(bone("mixamorig:LeftHand").head_local)
upleg_z = w(bone("mixamorig:LeftUpLeg").head_local).z
spine_z = w(bone("mixamorig:Spine").head_local).z
hips_off = hips_w.z - upleg_z          # Hips head sits this far above thigh root
HIP_Z = THIGH_TOP_Z + hips_off          # so the thigh root lands at THIGH_TOP_Z
print(f"raw: hips z={hips_w.z:.3f} upleg z={upleg_z:.3f} ankle z={ankle_w.z:.3f} "
      f"neck z={neck_w.z:.3f}")

s_arm = ARM_LEN / (wrist_w - sho_w).length
sx = SHOULDER_X / abs(sho_w.x)
ratio = (w(bone('mixamorig:LeftForeArm').head_local) - sho_w).length / \
        (wrist_w - sho_w).length
print(f"measured: arm_len={(wrist_w - sho_w).length:.3f} s_arm={s_arm:.3f} "
      f"width={sx:.3f} upperarm ratio={ratio:.3f} "
      f"-> bent bone elbow z ~= {sho_w.z - ratio * ARM_LEN:.3f} (mesh {ELBOW_Z})")

# ---------- 4. reshape rig (per-segment subtree affine scales) ----------
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

# head: measure-driven iterative scale so HeadTop_End lands exactly on TOP_Z
M_ = arm.matrix_world
drop = ANKLE_Z - (M_ @ eb["mixamorig:LeftFoot"].head).z
for it in range(4):
    top_cur_z = (M_ @ eb["mixamorig:HeadTop_End"].tail).z
    pivz = (M_ @ eb["mixamorig:Neck"].tail).z
    s_head = (TOP_Z - drop - pivz) / (top_cur_z - pivz)
    aff_scale("mixamorig:Neck", (1, 1, s_head), Vector((0.0, 0.0, pivz)))
    err = abs((M_ @ eb["mixamorig:HeadTop_End"].tail).z - (TOP_Z - drop))
    print(f"  head pass {it}: s_head {s_head:.3f} err {err:.4f}")
    if err < 5e-4:
        break
for side in ("Left", "Right"):
    piv = w(bone(f"mixamorig:{side}Arm").head_local)
    aff_scale(f"mixamorig:{side}Arm", (s_arm, 1, 1), piv)

# HEAD LIFT: the mocap holds the chin down ~4deg through the cycle, which
# re-exposes the dark under-chin band (and reads sullen for a kid). Pitch
# the Head bone's REST 3.5deg nose-up; since keys are rest-relative
# deltas about the same local X, the whole clip gains a gentle chin-up.
e = eb["mixamorig:Head"]
piv_w = arm.matrix_world @ e.head
tv_w = (arm.matrix_world @ e.tail) - piv_w
Rup = Matrix.Rotation(math.radians(-3.5), 4, 'X')       # tail tips toward +Y(back)
e.tail = arm.matrix_world.inverted() @ (piv_w + Rup @ tv_w)

bpy.ops.object.mode_set(mode="OBJECT")

arm.scale = (arm.scale.x * sx, arm.scale.y, arm.scale.z)
bpy.context.view_layer.update()
arm.location.z += ANKLE_Z - w(bone("mixamorig:LeftFoot").head_local).z
bpy.context.view_layer.update()

knee_z = w(bone("mixamorig:LeftUpLeg").tail_local).z
top_w = w(bone("mixamorig:HeadTop_End").tail_local)
print(f"final: thigh-root z={w(bone('mixamorig:LeftUpLeg').head_local).z:.3f} "
      f"knee z={knee_z:.3f} shoulder z={sho_w.z:.3f} top z={top_w.z:.3f}")

# ---------- 5. collect action fcurves (Blender 5.0 slotted actions) ----------
act = arm.animation_data.action
assert act, "FBX import produced no action"
# F-Curves live in action.layers[*].strips[*].channelbags[*].fcurves
# (act.fcurves was removed by the slotted-action refactor).
fcs = []
for lay in act.layers:
    for strip in lay.strips:
        for cb in strip.channelbags:
            fcs.extend(cb.fcurves)
print(f"action fcurves: {len(fcs)}")
curves = {}
for fc in fcs:
    dp = fc.data_path
    if not dp.startswith('pose.bones['):
        continue
    bname = dp.split('"')[1]
    kind = ("quat" if "rotation_quaternion" in dp
            else "eul" if "rotation_euler" in dp
            else "loc" if dp.startswith("location")
            else "scl" if dp.startswith("scale") else None)
    if kind:
        curves.setdefault((bname, kind), {})[fc.array_index] = fc

sc = bpy.context.scene
WRI_L = Vector((0.159, -0.008, 0.318))    # modelled wrist centres (build_lily3.py)
WRI_R = Vector((-0.159, -0.008, 0.318))

# ---------- 5b. record the absolute poses the clip drives (pre-conform) ----
POSES = {}
for fr in range(1, 33):
    sc.frame_set(fr)
    bpy.context.view_layer.update()
    POSES[fr] = {pb.name: pb.matrix.copy() for pb in arm.pose.bones}

def mat_err(a, b):
    return max(abs(a[i][j] - b[i][j]) for i in range(4) for j in range(4))

# ---------- 5c. CONFORM the two arm subtrees' REST to the hanging mesh -----
# UNIFORM orthogonal rotation in ARMATURE-LOCAL space around the shoulder
# joint's bone-local head point. World-space conjugation by the non-uniform
# armature scale SHEARS the rest transitions (measured: 2.14-unit drift in
# ml_parent^-1 @ ml_child), which silently corrupts every downstream pose;
# a pure local rotation keeps every intra-subtree relative joint frame
# EXACTLY, so only the subtree roots' bases need compensation (5d).
bpy.context.view_layer.objects.active = arm
ML_OLD = {pb.name: pb.bone.matrix_local.copy() for pb in arm.pose.bones}
M_, Mis_ = arm.matrix_world, arm.matrix_world.inverted()
# modelled elbow joint centres (build_lily3.py, world): rig shoulder points
# there so the rest upper-arm axis follows the mesh's arm.
ELB_W = {"Left": Vector((0.144, 0.004, 0.409)),
         "Right": Vector((-0.144, 0.004, 0.409))}
bpy.ops.object.mode_set(mode="EDIT")
eb2 = arm.data.edit_bones          # fresh EditBones (section-4 handle is stale)
for side in ("Left", "Right"):
    root = f"mixamorig:{side}Arm"
    b0 = arm.data.bones[root]
    piv = Vector(b0.head_local)
    a = (Vector(b0.tail_local) - piv).normalized()
    tgt = Mis_ @ ELB_W[side]                  # modelled elbow, armature space
    b = (tgt - piv).normalized()
    R = a.rotation_difference(b)
    # SNAPSHOT rest points first: mixamo children are connected, so writing
    # a parent's tail already moves the child's head — transforming live
    # values rotated each bone twice (154deg == 2x77deg elbow, round 1).
    SNAP = {bb.name: (Vector(bb.head_local), Vector(bb.tail_local))
            for bb in subtree(root)}
    for bb in subtree(root):
        e = eb2[bb.name]
        h0, t0 = SNAP[bb.name]
        e.head = piv + R @ (h0 - piv)
        e.tail = piv + R @ (t0 - piv)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.context.view_layer.update()

def subtree_ordered(root):
    out, seen, i = [arm.data.bones[root]], {root}, 0
    while i < len(out):
        for c in out[i].children:
            if c.name not in seen:
                seen.add(c.name)
                out.append(c)
        i += 1
    return [b.name for b in out]

MOVED = []
for side in ("Left", "Right"):
    MOVED += subtree_ordered(f"mixamorig:{side}Arm")
la = arm.data.bones["mixamorig:LeftArm"]
lfa = arm.data.bones["mixamorig:LeftForeArm"]
print("conformed rest: elbow~",
      [round(v, 3) for v in (arm.matrix_world @ la.tail_local)],
      "wrist~", [round(v, 3) for v in (arm.matrix_world @ lfa.tail_local)])

# ---------- 5d. re-bake subtree bases for the new rest transitions ---------
# Empirically established evaluation law (residual ~3e-4):
#   pose_c = pose_p @ ml_p^-1 @ ml_c @ basis_c
# The conform rotated every head/tail point uniformly, but each bone's roll
# reference twists by an axis-dependent amount, so ml_p^-1 @ ml_c is only
# invariant for collinear chains (Arm->ForeArm->Hand verified 0.000; the
# non-collinear finger roots did NOT). Parent poses are preserved by
# induction (root's parent is untouched), so the exact per-bone fix is
#   basis' = (ml_p_new^-1 @ ml_c_new)^-1 @ (ml_p_old^-1 @ ml_c_old) @ basis
# Translation parts are ~1e-5 (float32 rest noise); quat-only channels
# express it. Bones without channels (the *4 leaves) get LINEAR keys
# inserted so the whole subtree verifies.
FIX = {}
for name in MOVED:
    pb = arm.pose.bones[name]
    if pb.parent is None:
        continue
    pn = pb.parent.name
    rel_new = pb.bone.matrix_local
    rel_old = ML_OLD[name]
    p_new = arm.data.bones[pn].matrix_local if pn in ML_OLD else rel_new
    p_old = ML_OLD.get(pn, rel_old)
    FIX[name] = (p_new.inverted() @ rel_new).inverted() @ (p_old.inverted() @ rel_old)

def write_quat_keys(cq, fr, q_new):
    for i in range(4):
        fc = cq[i]
        hit = False
        for kp in fc.keyframe_points:       # never cache kp refs — inserting
            if abs(kp.co.x - fr) < 0.5:     # keys elsewhere rebuilds them
                kp.co.y = q_new[i]
                hit = True
                break
        if not hit:
            kp = fc.keyframe_points.insert(float(fr), q_new[i])
            kp.interpolation = "LINEAR"
        fc.update()

def chan_eval(fcs, fr, default):
    if not fcs:
        return default
    return tuple(fcs[i].evaluate(float(fr)) for i in range(len(fcs)))

bpy.ops.object.mode_set(mode="POSE")
bpy.context.view_layer.objects.active = arm
TGT = {}
for name in MOVED:
    if name not in FIX:
        continue
    cq = curves.get((name, "quat"))
    cl = curves.get((name, "loc"))
    cs = curves.get((name, "scl"))
    if cq is not None and len(cq) == 4:
        # PASS 1: capture all old basis BEFORE writing (sparse channels like
        # the static thumbs would otherwise interpolate between already
        # corrected keys in pass 2).
        Bold = {}
        for fr in range(1, 33):
            Bold[fr] = Matrix.LocRotScale(
                chan_eval(cl, fr, (0.0, 0.0, 0.0)),
                Quaternion(chan_eval(cq, fr, (1.0, 0.0, 0.0, 0.0))),
                chan_eval(cs, fr, (1.0, 1.0, 1.0)))
        prev = None
        for fr in range(1, 33):
            l2, q2, s2 = (FIX[name] @ Bold[fr]).decompose()
            if prev is not None and q2.dot(prev) < 0:
                q2 = -q2
            prev = q2.copy()
            TGT.setdefault(name, {})[fr] = (l2, q2, s2)
            write_quat_keys(cq, fr, q2)
            if cl:
                for i in range(3):
                    fc = cl[i]
                    for kp in fc.keyframe_points:
                        if abs(kp.co.x - fr) < 0.5:
                            kp.co.y = l2[i]
                            break
                    fc.update()
            if cs:
                for i in range(3):
                    fc = cs[i]
                    for kp in fc.keyframe_points:
                        if abs(kp.co.x - fr) < 0.5:
                            kp.co.y = s2[i]
                            break
                    fc.update()
    else:
        # keyless leaf: constant old basis; give it corrected constant keys
        pb = arm.pose.bones[name]
        pb.rotation_mode = "QUATERNION"
        target = FIX[name] @ pb.matrix_basis
        l2, q2, s2 = target.decompose()
        if l2.length > 1e-4:
            print(f"  NOTE: leaf {name} fix needs loc {[round(v, 4) for v in l2]}")
        pb.matrix_basis = target
        for fr in range(1, 33):
            pb.keyframe_insert("rotation_quaternion", frame=fr)
        if l2.length > 1e-4:
            for fr in range(1, 33):
                pb.keyframe_insert("location", frame=fr)
# quat-only bones whose exact correction also needs a HEAD OFFSET (the
# finger roots: their rest heads sit laterally off the Hand's Y axis, and
# the roll twist moves that offset) — create location channels for them.
NEED = []
for n, per in TGT.items():
    if curves.get((n, "loc")) is None:
        mx = max(v[0].length for v in per.values())
        if mx > 1e-5:
            NEED.append((n, mx))
for n, mx in NEED:
    pb = arm.pose.bones[n]
    print(f"  +location channels: {n} (head offset up to {mx:.4f})")
    for fr in range(1, 33):
        sc.frame_set(fr)
        l2, q2, s2 = TGT[n][fr]
        pb.matrix_basis = Matrix.LocRotScale(l2, q2, s2)
        pb.keyframe_insert("location", frame=fr)
bpy.ops.object.mode_set(mode="OBJECT")
bpy.context.view_layer.update()
for lay in arm.animation_data.action.layers:
    for strip in lay.strips:
        for cb in strip.channelbags:
            for fc in cb.fcurves:
                for nm5 in MOVED:
                    if nm5 in fc.data_path and ("quaternion" in fc.data_path
                                                or "location" in fc.data_path):
                        for kp in fc.keyframe_points:
                            kp.interpolation = "LINEAR"
                        fc.update()
                        break
bpy.context.view_layer.update()
sc.frame_set(1)
bpy.context.view_layer.update()

# VERIFY: EVERY bone of both subtrees (incl. keyless leaves) must still
# evaluate to its recorded absolute pose. This also proves the conform
# rotation was uniform: any rel-frame shear would show up downstream.
worst = 0.0
worst_b = None
for fr in range(1, 33):
    sc.frame_set(fr)
    bpy.context.view_layer.update()
    for name in MOVED:
        d1 = mat_err(arm.pose.bones[name].matrix, POSES[fr][name])
        if d1 > worst:
            worst, worst_b = d1, (name, fr)
print(f"conform+rebake verified: worst abs pose diff {worst:.6f} at {worst_b}")
assert worst < 1e-3, "rebake drifted the absolute arm motion"

# ---------- 5e. damp the arm swing toward the (now correct) rest ----------
# identity == hanging arm == mesh shape, so this finally scales ONLY the
# swing (v3-r1 used this formula with a T-pose rest: it aimed fists at the
# chest for exactly that reason). Dense 30fps keys + LINEAR interp.
damped = 0
for side in ("Left", "Right"):
    for kind, f in (("Arm", ARM_DAMP), ("ForeArm", FORE_DAMP)):
        b = f"mixamorig:{side}{kind}"
        cc = curves.get((b, "quat"))
        if not cc or len(cc) != 4:
            print(f"  WARNING: no quaternion curves for {b}")
            continue
        times = sorted({kp.co.x for kp in cc[0].keyframe_points})
        comps = [[], [], [], []]
        for t in times:
            q = Quaternion([cc[i].evaluate(t) for i in range(4)])
            if q.w < 0:
                q = -q
            q.normalize()
            axis, ang = q.to_axis_angle()
            qd = Quaternion(axis, ang * f)
            for i in range(4):
                comps[i].append(qd[i])
        for i, fc in cc.items():
            fc.keyframe_points.clear()
            for t, v in zip(times, comps[i]):
                kp = fc.keyframe_points.insert(t, v)
                kp.interpolation = "LINEAR"
            fc.update()
        damped += 4
print(f"swing damped: {damped} rotation curves "
      f"(UpperArm x{ARM_DAMP}, ForeArm x{FORE_DAMP})")

# swing audit: hands must stay outside the torso midline all cycle
xs_l, xs_r, zs = [], [], []
for fr in range(1, 33):
    sc.frame_set(fr)
    bpy.context.view_layer.update()
    pl = arm.matrix_world @ arm.pose.bones["mixamorig:LeftHand"].matrix.translation
    pr = arm.matrix_world @ arm.pose.bones["mixamorig:RightHand"].matrix.translation
    xs_l.append(pl.x); xs_r.append(pr.x); zs.append(pl.z); zs.append(pr.z)
print(f"hand x range L[{min(xs_l):+.3f},{max(xs_l):+.3f}] "
      f"R[{min(xs_r):+.3f},{max(xs_r):+.3f}]  z[{min(zs):.3f},{max(zs):.3f}]")
assert min(xs_l) > 0.09 and max(xs_r) < -0.09, "a hand crosses the body midline"
sc.frame_set(1)
bpy.context.view_layer.update()

# ---------- 6. bind parts by rule ----------
# ---------- 6. bind parts by rule ----------
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
CAPE = ["HairBack", "HairBackShade"]
BODY_BLEND = zblend("mixamorig:Spine", "mixamorig:Hips", 0.50, 0.36)
LEG_BLEND = zblend("mixamorig:LeftUpLeg", "mixamorig:LeftLeg",
                   knee_z + 0.030, knee_z - 0.030)
LEG_BLEND_R = zblend("mixamorig:RightUpLeg", "mixamorig:RightLeg",
                     knee_z + 0.030, knee_z - 0.030)
TAB_BLEND = zblend("mixamorig:Hips", "mixamorig:LeftUpLeg", 0.278, 0.206)
TAB_BLEND_R = zblend("mixamorig:Hips", "mixamorig:RightUpLeg", 0.278, 0.206)
CAP_BLEND_L = zblend("mixamorig:Spine", "mixamorig:LeftArm", 0.558, 0.492)
CAP_BLEND_R = zblend("mixamorig:Spine", "mixamorig:RightArm", 0.558, 0.492)
NECK_BLEND = zblend("mixamorig:Head", "mixamorig:Spine", 0.645, 0.556)
# mantle (S3): the skull cap part rides the head, everything from the nape
# down drapes with the spine (tip lag = free follow-through, no plate).
CAPE_BLEND = zblend("mixamorig:Head", "mixamorig:Spine", 0.740, 0.560)
# ARM BLEND (S3): continuous loft skinning across the mesh elbow
ARM_BLEND_L = zblend("mixamorig:LeftArm", "mixamorig:LeftForeArm",
                     ELBOW_Z + 0.018, ELBOW_Z - 0.015)
ARM_BLEND_R = zblend("mixamorig:RightArm", "mixamorig:RightForeArm",
                     ELBOW_Z + 0.018, ELBOW_Z - 0.015)

BINDINGS = {"Head": [("mixamorig:Head", None)]}
for h in HAIR:
    BINDINGS[h] = [("mixamorig:Head", None)]
for c in CAPE:
    BINDINGS[c] = CAPE_BLEND
# S3 r2: the side curtains now hang to the WAIST; glued to the head they
# would shear through the chest as the torso twists. Blend Head->Spine so
# the cheek part rides the head and the hanging tips ride the torso.
LOCK_BLEND = zblend("mixamorig:Head", "mixamorig:Spine", 0.66, 0.50)
BINDINGS.update({"HairLockL": LOCK_BLEND, "HairLockR": LOCK_BLEND})
BINDINGS.update({
    "Neck":       NECK_BLEND,
    "Torso":      BODY_BLEND,
    "ShoulderCapL": CAP_BLEND_L,
    "ShoulderCapR": CAP_BLEND_R,
    "ArmL":       ARM_BLEND_L,
    "ArmR":       ARM_BLEND_R,
    "HandL":      [("mixamorig:LeftForeArm", None)],
    "HandR":      [("mixamorig:RightForeArm", None)],
    "LegL":       LEG_BLEND,
    "LegR":       LEG_BLEND_R,
    "FootL":      [("mixamorig:LeftFoot", None)],
    "FootHeelL":  [("mixamorig:LeftFoot", None)],
    "FootToeL":   [("mixamorig:LeftFoot", None)],
    "FootR":      [("mixamorig:RightFoot", None)],
    "FootHeelR":  [("mixamorig:RightFoot", None)],
    "FootToeR":   [("mixamorig:RightFoot", None)],
    "Suit":       BODY_BLEND,
    "TrimNeckline": [("mixamorig:Spine", None)],
    "TrimHem":    [("mixamorig:Hips", None)],
    "SuitTabL":   TAB_BLEND,
    "TrimTabL":   TAB_BLEND,
    "SuitTabR":   TAB_BLEND_R,
    "TrimTabR":   TAB_BLEND_R,
    "DaisyC":     BODY_BLEND,
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
lily.name = "Lily3"

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

# ---------- 7. preview (fast Workbench) at key walk phases + export ----------
sc = bpy.context.scene
sc.frame_start = 1
sc.frame_end = 32
sc.render.fps = 30

sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "SINGLE"
sc.display.shading.single_color = (0.75, 0.72, 0.68)

for tag, loc in (("side", (2.0, 0.0, 0.62)), ("front", (0, -2.0, 0.62))):
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = loc
    tgt = bpy.data.objects.new("tgt", None)
    sc.collection.objects.link(tgt)
    tgt.location = (0, 0, 0.52)
    con = cam.constraints.new("TRACK_TO")
    con.target = tgt
    sc.camera = cam
    sc.render.resolution_x = 400
    sc.render.resolution_y = 480
    for f in (1, 9, 17, 25):
        sc.frame_set(f)
        bpy.context.view_layer.update()
        sc.render.filepath = f"/tmp/kilo/walk3_{tag}_f{f}.png"
        bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(tgt, do_unlink=True)
print("walk previews written")

# ---------- 8. export (plain default binding — rest == bind == mesh) ------
bpy.ops.object.select_all(action="DESELECT")
lily.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB",
                          use_selection=True, export_animations=True,
                          export_skins=True)
print("EXPORTED:", OUT, os.path.getsize(OUT), "bytes")
