"""Build beach3d/assets/lily4_full.glb — Lily v4 skinned to NINE clips
clips in one GLB (Walk / Idle / Swim / Sit / Paddle / SurfRide / Cheer /
Greet), all retargeted through the EXACT build_lily4_walk.py pipeline:

  * the S3/S4 conform + subtree rebake (sections 3,4,5b,5c,5d below) runs
    on every clip's own imported armature — the bind fix is a property of
    the mesh<->rest relationship, not of the walk clip — so each clip's
    action keys stay rest-relative and the single shared LilyRig rest
    drives all eight correctly;
  * the walk-specific tuning (ARM_DAMP / FORE_DAMP swing damping) runs
    ONLY on Walk, so lily4_full's "Walk" tracks are bit-identical to
    lily4_walk.glb (verified worst abs diff < 1e-4 programmatically);
  * per-clip "in-place normalize": all mixamorig:Hips LOCATION curves are
    flattened to their frame-1 value (kills residual root drift; rotation
    channels untouched). NOT applied to Walk: Walking.fbx ships a real
    hip bob/drift (world span x4.3 y3.1 z8.0 cm) and lily4_walk.glb kept
    it — zeroing would break the <1e-4 Walk regression gate, and clip 1
    spec ("byte-for-byte the same retarget") wins over the generic rule.

Clip survey (pose-distance scans over all 65 animated bones, armature
space; details in the mission report):
  * EVERY mixamo clip here ships its final frame as an exact duplicate of
    frame 1 (seam dist <= 2e-4 world-units) -> each looper is kept at its
    full authored span, no trims needed:
      Walk 32f, Idle 299f, Swim 137f, Sit 64f, Paddle 218f, SurfRide 31f,
      Cheer 88f (one-shot), Greet 17f (one-shot). 30fps throughout.
    Shorter breathing/stroke sub-periods were searched (idle: smallest
    lag>60 with seam<5x noise = the full 298f span; paddle: no anchored
    stroke cycle < 217f exists; surf-ride: already closes at 30f, so the
    prescribed duplicate-reverse fallback was NOT needed).
  * keeping the duplicated last key is deliberate: three.js LoopRepeat
    plays pose(last)==pose(first) at the wrap, making C1-continuous
    loops; dropping it would clamp-interpolate INTO the first key and
    hitch. Stills verify frame0 vs frame_last identical.

Multi-action export: Blender 5.0's slotted actions + the glTF exporter's
ACTIONS mode with 'export_anim_single_armature' (default True) pick up
every armature action in the file when exactly ONE armature is selected.
Each non-walk clip is therefore processed on its own imported armature
(identical rest inputs -> identical conform), then all its F-Curves are
copied verbatim (keys, handles, interpolation) into a fresh action bound
to LilyRig; the temp armature/action are deleted. Walk keeps its original
action object untouched.

NOTE on GLB inspection: the 17 base parts are JOINED into one skinned mesh
(node "Lily4", 7 primitives = 7 materials). Runtime mesh names may reflect
material-primitive splitting, not the original parts. The revised topology differs
from lily4_walk.glb; the shared rig and animation contract is preserved.
B5 adds four separately named, skinned suit variants on that same armature.

Run (reproducible end-to-end, from a clean file):
  /usr/bin/blender --background --python spike3/blender/build_lily4_full.py
"""
import bpy
import math
import os
import sys

# Blender 5.0.1's bundled python on this box ships without _ctypes and
# without numpy (io_scene_fbx needs numpy, io_scene_gltf2 needs ctypes ->
# draco.py). Both exist for the system CPython 3.14 and load fine into the
# embedded interpreter, so make them importable before touching addons.
for _p in ("/usr/lib/python3.14/lib-dynload", "/usr/lib/python3/dist-packages"):
    if _p not in sys.path:
        sys.path.append(_p)

from mathutils import Matrix, Quaternion, Vector

BASE = "/home/shai/sg/game2/spike3"
MIX = BASE + "/assets/mixamo"
LILY = BASE + "/assets/lily4.glb"
OUT = "/home/shai/sg/game2/beach3d/assets/lily4_full.glb"

# --- Lily v4 target proportions (match build_lily4.py geometry) ---
THIGH_TOP_Z = 0.278   # leg loft top ring (hip socket)
ANKLE_Z = 0.050       # leg loft ankle ring / foot joint
NECK_Z = 0.62         # Neck bone head (chin 0.600, neck mesh to 0.645)
TOP_Z = 0.99          # crown (HEAD_C.z 0.795 + HEAD_R.z 0.1948)
SHOULDER_X = 0.118    # mesh shoulder joint x offset
ARM_LEN = 0.2065      # sho (0.118,0.006,0.520) -> wri (0.159,-0.008,0.318)
ELBOW_Z = 0.409       # mesh elbow (S3-r2 outward-splayed arm)

ARM_DAMP = 0.72       # UpperArm animated rotation scale (WALK ONLY)
FORE_DAMP = 0.82      # ForeArm animated rotation scale (WALK ONLY)

# clip table: exported animation name -> (fbx, loops, hips_zero)
CLIPS = [
    ("Walk",     "Walking.fbx",        True,  False),  # regression clip
    ("Idle",     "Idle-Standing.fbx",  True,  True),
    ("Swim",     "Swim-FrontCrawl.fbx", True, True),
    ("Sit",      "Sit-Relaxed.fbx",    True,  True),
    ("Paddle",   "Surf-Paddle.fbx",    True,  True),
    ("SurfRide", "Surf-Ride.fbx",      True,  True),
    ("Cheer",    "Cheer.fbx",          False, True),   # one-shots: the game
    ("Greet",    "Wave-Greet.fbx",     False, True),   # crossfades to Idle
]

bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------- FBX import (bpy.ops.import_scene.fbx is broken in Blender 5.0) --
def import_clip(path):
    import io_scene_fbx
    from io_scene_fbx import import_fbx

    class _Shim:
        def report(self, *a, **k):
            print("FBX REPORT:", a, k)

    before = {o.name for o in bpy.data.objects}
    ret = import_fbx.load(_Shim(), bpy.context, filepath=path,
                          use_anim=True, global_scale=1.0)
    print("fbx import:", ret)
    arms = [o for o in bpy.data.objects
            if o.type == "ARMATURE" and o.name not in before]
    assert len(arms) == 1, f"expected exactly one NEW armature, got {[a.name for a in arms]}"
    arm = arms[0]
    act = arm.animation_data.action
    assert act, "FBX import produced no action"
    # NOTE: armature/action object names collide across clips (Armature,
    # Armature.001, ...) — never look them up by name, keep the references.
    return arm, act


def collect_fcs(act):
    """Blender 5.0 slotted actions: F-Curves live in
    action.layers[*].strips[*].channelbags[*].fcurves (act.fcurves removed)."""
    fcs = []
    for lay in act.layers:
        for strip in lay.strips:
            for cb in strip.channelbags:
                fcs.extend(cb.fcurves)
    return fcs


def clip_frame_range(act):
    f0, f1 = int(round(act.frame_range[0])), int(round(act.frame_range[1]))
    return f0, f1


# ---------- conform + rebake (build_lily4_walk.py sections 3,4,5,5b-5d) ----
def conform_rig(arm, act, FR):
    """Run the walk pipeline's measure -> reshape -> conform -> rebake on
    `arm`, whose clip keys every frame of range FR. Returns the dict the
    later stages need (knee_z etc). Deterministic: with the same FR as the
    original walk script, every float op matches its reference build."""
    f_start, f_end = FR[0], FR[-1]

    def bone(n):
        return arm.data.bones[n]

    def w(loc):
        return arm.matrix_world @ Vector(loc)

    # ---------- 3. measure (world space) ----------
    hips_w = w(bone("mixamorig:Hips").head_local)
    ankle_w = w(bone("mixamorig:LeftFoot").head_local)
    neck_w = w(bone("mixamorig:Neck").head_local)
    sho_w = w(bone("mixamorig:LeftArm").head_local)
    wrist_w = w(bone("mixamorig:LeftHand").head_local)
    upleg_z = w(bone("mixamorig:LeftUpLeg").head_local).z
    spine_z = w(bone("mixamorig:Spine").head_local).z
    hips_off = hips_w.z - upleg_z
    HIP_Z = THIGH_TOP_Z + hips_off
    print(f"  raw: hips z={hips_w.z:.3f} upleg z={upleg_z:.3f} "
          f"ankle z={ankle_w.z:.3f} neck z={neck_w.z:.3f}")

    s_arm = ARM_LEN / (wrist_w - sho_w).length
    sx = SHOULDER_X / abs(sho_w.x)

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

    ratio = (w(bone('mixamorig:LeftForeArm').head_local) - sho_w).length / \
            (wrist_w - sho_w).length
    print(f"  measured: arm_len={(wrist_w - sho_w).length:.3f} s_arm={s_arm:.3f} "
          f"width={sx:.3f} upperarm ratio={ratio:.3f} "
          f"-> bent bone elbow z ~= {sho_w.z - ratio * ARM_LEN:.3f} (mesh {ELBOW_Z})")

    s_leg = ((HIP_Z - ANKLE_Z) - hips_off) / (upleg_z - ankle_w.z)
    s_spine = ((NECK_Z - HIP_Z) - (spine_z - hips_w.z)) / (neck_w.z - spine_z)
    print(f"  solved: s_leg={s_leg:.3f} s_spine={s_spine:.3f}")
    for side in ("Left", "Right"):
        piv = w(bone(f"mixamorig:{side}UpLeg").head_local)
        aff_scale(f"mixamorig:{side}UpLeg", (1, 1, s_leg), piv)
    aff_scale("mixamorig:Spine", (1, 1, s_spine), w(bone("mixamorig:Spine").head_local))

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

    # HEAD LIFT: pitch the Head bone's REST 3.5deg nose-up (walk script;
    # rest-relative keys inherit it -> a gentle chin-up in EVERY clip, so
    # crossfades between clips never see a head-pop).
    e = eb["mixamorig:Head"]
    piv_w = arm.matrix_world @ e.head
    tv_w = (arm.matrix_world @ e.tail) - piv_w
    Rup = Matrix.Rotation(math.radians(-3.5), 4, 'X')
    e.tail = arm.matrix_world.inverted() @ (piv_w + Rup @ tv_w)

    bpy.ops.object.mode_set(mode="OBJECT")

    arm.scale = (arm.scale.x * sx, arm.scale.y, arm.scale.z)
    bpy.context.view_layer.update()
    arm.location.z += ANKLE_Z - w(bone("mixamorig:LeftFoot").head_local).z
    bpy.context.view_layer.update()

    knee_z = w(bone("mixamorig:LeftUpLeg").tail_local).z
    top_w = w(bone("mixamorig:HeadTop_End").tail_local)
    print(f"  final: thigh-root z={w(bone('mixamorig:LeftUpLeg').head_local).z:.3f} "
          f"knee z={knee_z:.3f} shoulder z={sho_w.z:.3f} top z={top_w.z:.3f}")

    # ---------- 5. collect action fcurves ----------
    sc = bpy.context.scene
    fcs = collect_fcs(act)
    print(f"  action fcurves: {len(fcs)}")
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

    # ---------- 5b. record the absolute poses the clip drives (pre-conform)
    POSES = {}
    for fr in FR:
        sc.frame_set(fr)
        bpy.context.view_layer.update()
        POSES[fr] = {pb.name: pb.matrix.copy() for pb in arm.pose.bones}

    def mat_err(a, b):
        return max(abs(a[i][j] - b[i][j]) for i in range(4) for j in range(4))

    # ---------- 5c. CONFORM the two arm subtrees' REST to the hanging mesh --
    # Uniform orthogonal rotation in ARMATURE-LOCAL space around the
    # shoulder joint (world-space conjugation by the non-uniform armature
    # scale would shear every relative joint frame — see walk script).
    bpy.context.view_layer.objects.active = arm
    ML_OLD = {pb.name: pb.bone.matrix_local.copy() for pb in arm.pose.bones}
    M_, Mis_ = arm.matrix_world, arm.matrix_world.inverted()
    ELB_W = {"Left": Vector((0.144, 0.004, 0.409)),
             "Right": Vector((-0.144, 0.004, 0.409))}
    bpy.ops.object.mode_set(mode="EDIT")
    eb2 = arm.data.edit_bones
    for side in ("Left", "Right"):
        root = f"mixamorig:{side}Arm"
        b0 = arm.data.bones[root]
        piv = Vector(b0.head_local)
        a = (Vector(b0.tail_local) - piv).normalized()
        tgt = Mis_ @ ELB_W[side]
        b = (tgt - piv).normalized()
        R = a.rotation_difference(b)
        # SNAPSHOT rest points first: mixamo children are connected, so
        # writing a parent's tail already moves the child's head.
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
    print("  conformed rest: elbow~",
          [round(v, 3) for v in (arm.matrix_world @ la.tail_local)],
          "wrist~", [round(v, 3) for v in (arm.matrix_world @ lfa.tail_local)])

    # ---------- 5d. re-bake subtree bases for the new rest transitions -----
    #   basis' = (ml_p_new^-1 @ ml_c_new)^-1 @ (ml_p_old^-1 @ ml_c_old) @ basis
    # (walk script derivation; pose law pose_c = pose_p @ ml_p^-1 @ ml_c @
    #  basis_c holds to residual ~3e-4).
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
                if abs(kp.co.x - fr) < 1e-4:    # keys elsewhere rebuilds them
                    kp.co.y = q_new[i]          # (walk script used a <0.5
                    hit = True                  #  window; integer frames make
                    break                       #  both hit the same keys, the
            if not hit:                         #  exact match is safe for the
                kp = fc.keyframe_points.insert(float(fr), q_new[i])   # sub-frame
                kp.interpolation = "LINEAR"     # keyed Cheer clip too)
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
            # PASS 1: capture all old basis BEFORE writing.
            Bold = {}
            for fr in FR:
                Bold[fr] = Matrix.LocRotScale(
                    chan_eval(cl, fr, (0.0, 0.0, 0.0)),
                    Quaternion(chan_eval(cq, fr, (1.0, 0.0, 0.0, 0.0))),
                    chan_eval(cs, fr, (1.0, 1.0, 1.0)))
            prev = None
            for fr in FR:
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
                            if abs(kp.co.x - fr) < 1e-4:
                                kp.co.y = l2[i]
                                break
                        fc.update()
                if cs:
                    for i in range(3):
                        fc = cs[i]
                        for kp in fc.keyframe_points:
                            if abs(kp.co.x - fr) < 1e-4:
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
            for fr in FR:
                pb.keyframe_insert("rotation_quaternion", frame=fr)
            if l2.length > 1e-4:
                for fr in FR:
                    pb.keyframe_insert("location", frame=fr)
    # quat-only bones whose correction needs a HEAD OFFSET (finger roots)
    NEED = []
    for n, per in TGT.items():
        if curves.get((n, "loc")) is None:
            mx = max(v[0].length for v in per.values())
            if mx > 1e-5:
                NEED.append((n, mx))
    for n, mx in NEED:
        pb = arm.pose.bones[n]
        print(f"  +location channels: {n} (head offset up to {mx:.4f})")
        for fr in FR:
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
    sc.frame_set(f_start)
    bpy.context.view_layer.update()

    # VERIFY: every moved bone must still evaluate to its recorded absolute
    # pose (proves conform uniformity + rebake correctness per clip).
    worst = 0.0
    worst_b = None
    for fr in FR:
        sc.frame_set(fr)
        bpy.context.view_layer.update()
        for name in MOVED:
            d1 = mat_err(arm.pose.bones[name].matrix, POSES[fr][name])
            if d1 > worst:
                worst, worst_b = d1, (name, fr)
    print(f"  conform+rebake verified: worst abs pose diff {worst:.6f} at {worst_b}")
    assert worst < 1e-3, "rebake drifted the absolute arm motion"
    del POSES
    return {"knee_z": knee_z}


# ---------- walk-only: swing damp + midline audit (section 5e) -------------
def damp_walk_arms(arm, act, curves, FR):
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
    print(f"  swing damped: {damped} rotation curves "
          f"(UpperArm x{ARM_DAMP}, ForeArm x{FORE_DAMP})")

    sc = bpy.context.scene
    xs_l, xs_r, zs = [], [], []
    for fr in FR:
        sc.frame_set(fr)
        bpy.context.view_layer.update()
        pl = arm.matrix_world @ arm.pose.bones["mixamorig:LeftHand"].matrix.translation
        pr = arm.matrix_world @ arm.pose.bones["mixamorig:RightHand"].matrix.translation
        xs_l.append(pl.x); xs_r.append(pr.x); zs.append(pl.z); zs.append(pr.z)
    print(f"  hand x range L[{min(xs_l):+.3f},{max(xs_l):+.3f}] "
          f"R[{min(xs_r):+.3f},{max(xs_r):+.3f}]  z[{min(zs):.3f},{max(zs):.3f}]")
    assert min(xs_l) > 0.09 and max(xs_r) < -0.09, "a hand crosses the body midline"
    sc.frame_set(1)
    bpy.context.view_layer.update()


# ---------- per-clip (except Walk): flatten the Hips location channels ----
# NOTE: the `curves` dict classifies with dp.startswith("location") (walk
# script quirk) which never matches the full 'pose.bones[...].location'
# paths — it is kept verbatim because the walk regression depends on the
# identical 5d behavior (no moved bone has loc keys anyway). hips_zero
# therefore scans the raw fcurves for the Hips translation channels.
def hips_zero(act, f_start):
    cl = {}
    for fc in collect_fcs(act):
        dp = fc.data_path
        if dp.startswith('pose.bones["mixamorig:Hips"].location'):
            cl[fc.array_index] = fc
    if not cl:
        print("  hips-zero: no location channels (already constant)")
        return
    v0 = {i: cl[i].evaluate(float(f_start)) for i in cl}
    for i, fc in cl.items():
        for kp in fc.keyframe_points:
            kp.co.y = v0[i]
        fc.update()
    print(f"  hips-zero: {len(cl)} loc curves flattened to frame {f_start} "
          f"{[round(v0[i], 4) for i in sorted(v0)]}")


# ---------- per-clip (except Walk): copy processed fcurves onto LilyRig ----
def bind_clip_action(dst_arm, src_act, name):
    new = bpy.data.actions.new(name)
    if new.name != name:
        raise RuntimeError(f"action name collision: wanted {name!r} got {new.name!r}")
    dst_arm.animation_data.action = new
    # bootstrap the slot/channelbag (assigning an EMPTY action creates none)
    pb = dst_arm.pose.bones["mixamorig:Hips"]
    pb.keyframe_insert("location", frame=1)
    cb = None
    for lay in new.layers:
        for strip in lay.strips:
            for bag in strip.channelbags:
                cb = bag
    for fc in list(cb.fcurves):
        cb.fcurves.remove(fc)
    n = 0
    for fc in collect_fcs(src_act):
        if not fc.data_path.startswith('pose.bones['):
            continue
        bname = fc.data_path.split('"')[1]
        if "rotation_euler" in fc.data_path:
            dst_arm.pose.bones[bname].rotation_mode = "XYZ"
        elif "rotation_quaternion" in fc.data_path:
            dst_arm.pose.bones[bname].rotation_mode = "QUATERNION"
        nf = cb.fcurves.new(data_path=fc.data_path, index=fc.array_index)
        for kp in fc.keyframe_points:
            nkp = nf.keyframe_points.insert(kp.co.x, kp.co.y)
            nkp.interpolation = kp.interpolation
            nkp.handle_left_type = kp.handle_left_type
            nkp.handle_right_type = kp.handle_right_type
            nkp.handle_left = kp.handle_left
            nkp.handle_right = kp.handle_right
        n += 1
    print(f"  bound '{name}': {n} fcurves, frame_range {tuple(new.frame_range)}")
    return new


# ============================ main flow ===================================
# ---------- 1. Walking armature (this becomes LilyRig = the shared rig) ----
main, walk_act = import_clip(MIX + "/Walking.fbx")
main.name = "LilyRig"
bpy.context.view_layer.update()

# ---------- 2. Lily v4 mesh ----------
bpy.ops.import_scene.gltf(filepath=LILY)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
print("lily4 mesh parts:", len(meshes))
variants = [o for o in meshes if o.name.startswith(("Suit_Tank_", "Suit_Crop_"))]
hair_parts = [o for o in meshes if o.name.startswith("Hair_hair")]
hair_ids = {f"hair{i}" for i in range(1, 7)}
assert {o.name.split("_")[1] for o in hair_parts} == hair_ids
assert len(meshes) == 68 and len(hair_parts) == 54 and len(variants) == 4, \
    "expected 10 unchanged body/suit parts + 4 suit variants + 54 hairstyle parts"
assert all(any(o.name == f"Hair_{id}_Scalp" for o in hair_parts) for id in hair_ids), \
    "every hairstyle requires its own complete scalp"

# ---------- Walk: conform + damp through the reference pipeline -----------
FR_W = range(1, 33)
print("== conform Walk ==")
info = conform_rig(main, walk_act, FR_W)
knee_z = info["knee_z"]
# The conformed rest pivot is higher than the historical ELBOW_Z mesh hint.
# Bind at the measured joint; neither the rest rig nor any keys are changed.
arm_bend_z = (main.matrix_world @ main.data.bones["mixamorig:LeftForeArm"].head_local).z
fcs_w = collect_fcs(walk_act)
curves_w = {}
for fc in fcs_w:
    dp = fc.data_path
    if not dp.startswith('pose.bones['):
        continue
    bname = dp.split('"')[1]
    kind = ("quat" if "rotation_quaternion" in dp else
            "eul" if "rotation_euler" in dp else
            "loc" if dp.startswith("location") else
            "scl" if dp.startswith("scale") else None)
    if kind:
        curves_w.setdefault((bname, kind), {})[fc.array_index] = fc
damp_walk_arms(main, walk_act, curves_w, FR_W)
# rename AFTER all processing (export name = clip name)
walk_act.name = "Walk"
assert walk_act.name == "Walk"

# ---------- 6. local body/garment binding; shared-rig hairstyle rules ---
def zblend(b_top, b_bot, z_top, z_bot):
    span = max(z_top - z_bot, 1e-6)
    def bot(c):
        if c.z >= z_top:
            return 0.0
        if c.z <= z_bot:
            return 1.0
        return (z_top - c.z) / span
    return [(b_top, lambda c: 1.0 - bot(c)), (b_bot, bot)]

BODY_BLEND = zblend("mixamorig:Spine", "mixamorig:Hips", 0.50, 0.36)

def _ss(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)

def suit_bind(co):
    ax = abs(co.x)
    t = _ss((ax - 0.012) / 0.026) * _ss((0.310 - co.z) / 0.070)
    if co.z >= 0.50:
        w_sp, w_hp = 1.0, 0.0
    elif co.z <= 0.36:
        w_sp, w_hp = 0.0, 1.0
    else:
        w_hp = (0.50 - co.z) / 0.14
        w_sp = 1.0 - w_hp
    leg = "mixamorig:LeftUpLeg" if co.x >= 0 else "mixamorig:RightUpLeg"
    return [("mixamorig:Spine", (1.0 - t) * w_sp),
            ("mixamorig:Hips", (1.0 - t) * w_hp),
            (leg, t)]

def body_bind(co, arm=0.0):
    # Topological ownership crosses welded sockets smoothly; adjacent shafts
    # must not pick up torso weights just because their X coordinates overlap.
    if co.z < .490 and arm == 0:
        return suit_bind(co)
    side = "Left" if co.x >= 0 else "Right"
    # Keep elbow rotation out of the shoulder socket. Its lower boundary is
    # near the conformed elbow height, but is still torso/shoulder topology.
    fore = _ss((arm_bend_z+.026-co.z)/.052) * _ss((arm-.70)/.30)
    # The supported wrist now meets the real .399 joint. Distal palms follow
    # Hand rather than staying rigidly attached to ForeArm; fingers stay soft.
    hand = _ss((.414-co.z)/.044)
    head = _ss((co.z-.556)/(.645-.556))
    return [("mixamorig:Spine", (1-arm)*(1-head)),
            ("mixamorig:Head", (1-arm)*head),
            (f"mixamorig:{side}Arm", arm*(1-fore)),
            (f"mixamorig:{side}ForeArm", arm*fore*(1-hand)),
            (f"mixamorig:{side}Hand", arm*fore*hand)]


def leg_bind(co):
    side = "Left" if co.x >= 0 else "Right"
    # Match the garment field through the cuffs, then blend across supported
    # .192/.165/.154 rings. A hard switch sheared the Hips-bound inner thigh.
    if co.z >= .192:
        return suit_bind(co)
    blend = _ss((.192-co.z)/(.192-.154))
    hips = (1-blend) * dict(suit_bind(co))["mixamorig:Hips"]
    knee = blend * _ss((knee_z+.030-co.z)/.060)
    foot = _ss((.082-co.z)/.039)
    return [("mixamorig:Hips", hips),
            (f"mixamorig:{side}UpLeg", 1-hips-knee),
            (f"mixamorig:{side}Leg", knee*(1-foot)),
            (f"mixamorig:{side}Foot", knee*foot)]


# Guard both blend endpoints and the former cutoff on each inner/outer leg.
leg_weight_jump = 0.0
for x in (-.058, -.034, -.020, .020, .034, .058):
    for z in (.192, .190, .154):
        below, above = [dict(leg_bind(Vector((x, 0, z+dz)))) for dz in (-1e-7, 1e-7)]
        leg_weight_jump = max(leg_weight_jump,
                             max(abs(below.get(b, 0)-above.get(b, 0)) for b in below.keys() | above.keys()))
assert leg_weight_jump < 1e-4, f"discontinuous leg weights: {leg_weight_jump}"
print(f"  leg weight continuity: max jump {leg_weight_jump:.8f}")


from mathutils.kdtree import KDTree
body_mesh = next(m for m in meshes if m.name == "Torso")
arm_attribute = body_mesh.data.attributes["_ARM"]
body_tree = KDTree(len(body_mesh.data.vertices))
for v in body_mesh.data.vertices:
    body_tree.insert(v.co, v.index)
body_tree.balance()


def garment_bind(co):
    if co.z <= .490:
        return suit_bind(co)
    nearest = body_tree.find_n(co, 4)
    weights = [1/max(d, .001)**2 for _, _, d in nearest]
    arm = sum(w*arm_attribute.data[i].value for w, (_, i, _) in zip(weights, nearest))/sum(weights)
    # A sleeveless strap follows the shoulder root, not the upper-arm shaft.
    # Full shaft influence pulled the armhole into a pennant in raised poses.
    return body_bind(co, .25*arm)

BINDINGS = {"Head": [("mixamorig:Head", None)]}
for h in hair_parts:
    BINDINGS[h.name] = [("mixamorig:Head", None)]
    if "Curtain" in h.name:
        # Keep roots rigid on the scalp; drape below the jaw follows the
        # upper body, never arms/hips. No extra bones or simulated strands.
        BINDINGS[h.name] = zblend("mixamorig:Head", "mixamorig:Spine", .68, .46)
    elif h.name.endswith("_Tail"):
        BINDINGS[h.name] = zblend("mixamorig:Head", "mixamorig:Spine", .90, .40)
BINDINGS.update({
    "Torso":      body_bind,
    "LegL":       leg_bind,
    "LegR":       leg_bind,
    "Suit":       garment_bind,
    "DaisyC":     BODY_BLEND,
})
for k in range(4):
    BINDINGS["DaisyP%d" % k] = BODY_BLEND
for m in variants:
    BINDINGS[m.name] = garment_bind

unbound = [m.name for m in meshes if m.name not in BINDINGS]
assert not unbound, f"parts missing bindings: {unbound}"

for m in meshes:
    spec = BINDINGS[m.name]
    if callable(spec):
        samples = [(v, spec(v.co, arm_attribute.data[v.index].value)
                    if m == body_mesh else spec(v.co)) for v in m.data.vertices]
        bones = []
        seen = set()
        for v, sample in samples:
            for bn, _w in sample:
                if bn not in seen:
                    seen.add(bn); bones.append(bn)
        grp = {bn: m.vertex_groups.new(name=bn) for bn in bones}
        for v, sample in samples:
            for bn, w in sample:
                if w > 0:
                    grp[bn].add([v.index], w, "ADD")
    elif spec[0][1] is None:
        vg = m.vertex_groups.new(name=spec[0][0])
        vg.add([v.index for v in m.data.vertices], 1.0, "REPLACE")
    else:
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

for m in meshes:
    bad = [v.index for v in m.data.vertices
           if abs(sum(g.weight for g in v.groups)-1) > 1e-5 or
           len(v.groups) > 4 or any(not math.isfinite(g.weight) for g in v.groups)]
    print(f"  bind check {m.name}: {len(m.data.vertices)} verts, invalid {len(bad)}")
    assert not bad, f"{m.name} invalid weights: {bad[:10]}"

bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Join each hairstyle AFTER binding so it costs only its material primitives.
# These six nodes, like the suit variants, never merge into the body.
hair_meshes = []
base_meshes = [m for m in meshes if m not in hair_parts and m not in variants]
hair_groups = {id: [m for m in hair_parts if m.name.startswith(f"Hair_{id}_")]
               for id in sorted(hair_ids)}
for id, group in hair_groups.items():
    bpy.ops.object.select_all(action="DESELECT")
    for m in group:
        m.select_set(True)
    bpy.context.view_layer.objects.active = group[0]
    bpy.ops.object.join()
    hair = bpy.context.view_layer.objects.active
    hair.name = f"Hair_{id}"
    hair_meshes.append(hair)

# Consolidate only the unchanged body. Face markers below are restricted to
# its faceTexture primitive, never nearest vertices on a selectable hairstyle.
bpy.ops.object.select_all(action="DESELECT")
for m in base_meshes:
    m.select_set(True)
for m in variants:
    m.select_set(False)
bpy.context.view_layer.objects.active = max(base_meshes, key=lambda m: len(m.data.vertices))
bpy.ops.object.join()
lily = bpy.context.view_layer.objects.active
lily.name = "Lily4"

bpy.ops.object.select_all(action="DESELECT")
lily.select_set(True)
for m in variants + hair_meshes:
    m.select_set(True)
main.select_set(True)
bpy.context.view_layer.objects.active = main
bpy.ops.object.parent_set(type="ARMATURE_NAME")
tot = weighted = 0
for v in lily.data.vertices:
    tot += 1
    if any(g.weight > 0 for g in v.groups):
        weighted += 1
print(f"weighted verts: {weighted}/{tot}  groups: {len(lily.vertex_groups)}")

# ---------- 6b. remaining seven clips -------------------------------------
sc = bpy.context.scene
clip_acts = {"Walk": walk_act}
for name, fbx, loops, hzero in CLIPS:
    if name == "Walk":
        continue
    print(f"== clip {name} ({fbx}) ==")
    src, sact = import_clip(MIX + "/" + fbx)
    f0, f1 = clip_frame_range(sact)
    print(f"  frames {f0}..{f1} ({f1 - f0 + 1} keys, {(f1 - f0) / 30:.3f}s loop)"
          f" {'LOOP' if loops else 'ONE-SHOT'}")
    FR = range(f0, f1 + 1)
    conform_rig(src, sact, FR)
    if hzero:
        hips_zero(sact, f0)
    # seam metrics on the FINAL processed clip (loopers), before copying
    def snap_all(a):
        out = {}
        for fr in (f0, f1):
            sc.frame_set(fr)
            bpy.context.view_layer.update()
            out[fr] = {pb.name: (a.matrix_world @ pb.matrix) for pb in a.pose.bones}
        return out
    if loops:
        s = snap_all(src)
        seam = max(abs(s[f0][bn][i][j] - s[f1][bn][i][j])
                   for bn in s[f0] for i in range(4) for j in range(4))
        print(f"  loop seam (first vs last world pose): {seam:.6f}")
    newact = bind_clip_action(main, sact, name)
    # copy-fidelity check: every bone, every frame, on the bound action
    bad = 0.0
    for fr in FR:
        sc.frame_set(fr)
        bpy.context.view_layer.update()
        for pb in src.pose.bones:
            ma = src.matrix_world @ pb.matrix
            mb = main.matrix_world @ main.pose.bones[pb.name].matrix
            d = max(abs(ma[i][j] - mb[i][j]) for i in range(4) for j in range(4))
            bad = max(bad, d)
    print(f"  copy fidelity (world pose, all bones/frames): {bad:.7f}")
    assert bad < 1e-4, f"copy of {name} drifted on LilyRig"
    clip_acts[name] = newact
    bpy.data.objects.remove(src, do_unlink=True)
    bpy.data.actions.remove(sact)
    sc.frame_set(1)
    bpy.context.view_layer.update()
print("actions:", [(a.name, tuple(a.frame_range)) for a in bpy.data.actions])

# Preserve the conformed, in-place crawl BEFORE the accepted head-up solve.
# The two actions own separate F-Curves; refinements must touch only this copy.
freestyle_act = clip_acts["Swim"].copy()
freestyle_act.name = "SwimFreestyle"
clip_acts["SwimFreestyle"] = freestyle_act

# ---------- 6c. head-up freestyle conversion of the Swim clip --------------
# The authored Swim-FrontCrawl is a face-PRONE crawl: the head's face points
# ~50 deg BELOW the horizon, yawed ~116 deg to her right (an extreme breath
# turn). From the follow-cam that exposes the pale face patch at the dome
# edge and reads as a "bald crescent". Convert it to head-up freestyle by
# retaining the existing Neck lift and stabilizing the Head's face AND crown
# on every frame. Both endpoint poses receive the same deterministic solve.
#
# The rig's non-uniform scales (armature X scale + bone-length scales) make an
# arbitrary world rotation non-representable as a pure quat key, so we solve
# EXACTLY, per bone, for the quat that lands one rigid vector on its world
# target (a bone's armature-space 3x3 = A @ Q, A fixed for a given parent
# state, Q the pose rotation applied on the right):
#   head: face(Q_h) = (Arm @ A_h @ Q_h @ f_loc) = face_tgt
#         => Q_h = rot_between(f_loc, (Arm @ A_h)^-1 @ face_tgt)
#         then twist about Q_h @ f_loc to constrain the crown as well
#   neck: its Y (bone) axis rotated to R_n @ (orig world Y axis)
# Verified 0.0 deg against the evaluated mesh (face verts are 100% on Head).
swim_act = clip_acts["Swim"]
SWIM_SPLIT_NECK = 0.40        # fraction of the total rotation on the Neck bone
SWIM_ELEV_DEG = 25.0          # face elevation above the horizon (head-up freestyle)
SU_NECK_B, SU_HEAD_B = "mixamorig:Neck", "mixamorig:Head"
SU_IDQ = Quaternion((1.0, 0.0, 0.0, 0.0))


def su_find_fcs(act, bn):
    out = {}
    for lay in act.layers:
        for strip in lay.strips:
            for cb in strip.channelbags:
                for fc in cb.fcurves:
                    if fc.data_path == f'pose.bones["{bn}"].rotation_quaternion':
                        out[fc.array_index] = fc
    return [out.get(a) for a in range(4)]


def su_key_map(fcs):
    """{frame: {channel: KeyframePoint}} (find() is broken in this build)."""
    frames = {}
    for fc in fcs:
        for kp in fc.keyframe_points:
            frames.setdefault(int(round(kp.co.x)), {})[fc.array_index] = kp
    return frames


def su_set_quat(kps, q):
    vals = (q.w, q.x, q.y, q.z)   # fcurve array order is (w, x, y, z)
    for a in range(4):
        kps[a].co.y = vals[a]


def su_rot_between(a, b):
    """Shortest-arc quaternion rotating unit vector a onto unit vector b."""
    a = a.normalized(); b = b.normalized()
    d = max(-1.0, min(1.0, a.dot(b)))
    if d > 0.999999:
        return Quaternion((1.0, 0.0, 0.0, 0.0))
    if d < -0.999999:
        ax = a.cross(Vector((1, 0, 0)))
        if ax.length < 1e-6:
            ax = a.cross(Vector((0, 1, 0)))
        ax.normalized()
        return Matrix.Rotation(math.pi, 4, ax).to_quaternion()
    ax = a.cross(b).normalized()
    return Matrix.Rotation(math.acos(d), 4, ax).to_quaternion()


def su_correct_roll(Q_h):
    """Close the evaluated crown's signed roll error with a local head twist."""
    f = _SU_TARGET
    total = 0.0
    for _iter in range(12):
        su_pb_h.rotation_quaternion = Q_h
        bpy.context.view_layer.update()
        _, c_now = su_head_axes_now()
        p_now = (c_now - c_now.dot(f) * f).normalized()
        p_tgt = (_SU_CROWN_TGT - _SU_CROWN_TGT.dot(f) * f).normalized()
        roll = math.atan2(p_now.cross(p_tgt).dot(f), p_now.dot(p_tgt))
        if abs(roll) < 1e-5:
            break
        # Left multiplication needs the SOLVED local axis, not the rest axis.
        # Re-measure each pass because non-uniform scale changes world angles.
        Q_h = Quaternion(Q_h @ su_f_loc, roll) @ Q_h
        Q_h.normalize()
        total += roll
    su_pb_h.rotation_quaternion = Q_h
    bpy.context.view_layer.update()
    return Q_h, math.degrees(total)


print("== head-up conversion of Swim ==")
main.animation_data.action = swim_act
sf0, sf1 = clip_frame_range(swim_act)
Arm_lin = main.matrix_world.to_3x3()
su_pb_n = main.pose.bones[SU_NECK_B]
su_pb_h = main.pose.bones[SU_HEAD_B]


def su_face_now():
    """World face direction from the current evaluated mesh (no frame_set)."""
    dgm = bpy.context.evaluated_depsgraph_get()
    ev = lily.evaluated_get(dgm)
    me = ev.to_mesh()
    n = ev.matrix_world @ me.vertices[SU_NOSE].co
    c = ev.matrix_world @ me.vertices[SU_CROWN].co
    k = ev.matrix_world @ me.vertices[SU_CHEEK].co
    ev.to_mesh_clear()
    return (n - (n + c + k) / 3.0).normalized()


def su_head_axes_now():
    """Anatomical face/crown axes measured on the evaluated, skinned head.

    The nose/crown/one-cheek centroid is off-center: its two vectors are
    oblique, not a face/up basis. Opposite nose/back markers locate the head
    center without that yaw/roll bias. The old centroid remains Neck-only.
    """
    dgm = bpy.context.evaluated_depsgraph_get()
    ev = lily.evaluated_get(dgm)
    me = ev.to_mesh()
    n = ev.matrix_world @ me.vertices[SU_NOSE].co
    c = ev.matrix_world @ me.vertices[SU_CROWN].co
    b = ev.matrix_world @ me.vertices[SU_BACK].co
    ev.to_mesh_clear()
    return (n - b).normalized(), (c - (n + b) / 2.0).normalized()


# face feature indices from the STATIC mesh (A-pose build coordinates; meters)
SU_HC = Vector((0.0, 0.0, 0.795))
_su_static = [lily.data.vertices[i].co for i in range(len(lily.data.vertices))]
_su_head_vertices = {i for p in lily.data.polygons
                     if lily.data.materials[p.material_index].name == "faceTexture"
                     for i in p.vertices}


def su_nearest_band(target, lo=0.165, hi=0.250):
    t = Vector(target); best, bi = 1e9, -1
    for i in sorted(_su_head_vertices):
        p = _su_static[i]
        if lo <= (p - SU_HC).length <= hi and (p - t).length < best:
            best, bi = (p - t).length, i
    return bi


SU_NOSE = su_nearest_band((0.0, -0.206, 0.795))
SU_CROWN = su_nearest_band((0.0, 0.0, 0.988))
SU_CHEEK = su_nearest_band((0.152, -0.146, 0.795))
SU_BACK = su_nearest_band((0.0, 0.205, 0.795))
print(f"  face verts NOSE={SU_NOSE} CROWN={SU_CROWN} CHEEK={SU_CHEEK}")
assert all(len(lily.data.vertices[i].groups) == 1 and
           lily.vertex_groups[lily.data.vertices[i].groups[0].group].name == SU_HEAD_B
           for i in (SU_NOSE, SU_CROWN, SU_BACK)), "head markers must be rigid"

# rotation params from the frame-1 face
sc.frame_set(sf0); bpy.context.view_layer.update()
_su_cur = su_face_now()
# Explicit forward+up, NO-sideways target: face points in the direction of
# travel (+~25 deg above the horizon). The old Y-Z-plane axis target aimed
# the face to her right (large -X). The crown constraint below removes the
# remaining twist that a face-only solve cannot determine.
_swim_elev = math.radians(SWIM_ELEV_DEG)
_ty = -math.cos(_swim_elev)         # forward (in this armature frame forward = -Y)
_tz = +math.sin(_swim_elev)         # up (+Z)
_tx = 0.0                        # no sideways yaw
_SU_TARGET = Vector((_tx, _ty, _tz))
# crown (top of head) target: up + slightly back, orthogonal to the face
# (dot(f_tgt,c_tgt)=0) so face+crown together fully fix the head roll.
_SU_CROWN_TGT = Vector((0.0, +math.sin(_swim_elev), +math.cos(_swim_elev)))
_su_axis = _su_cur.cross(_SU_TARGET).normalized()
_su_angle = math.acos(max(-1.0, min(1.0, _su_cur.dot(_SU_TARGET))))
SU_R_n = Matrix.Rotation(SWIM_SPLIT_NECK * _su_angle, 4, _su_axis)
SU_Rn3 = SU_R_n.to_3x3()
print(f"  cur face ({_su_cur.x:+.3f},{_su_cur.y:+.3f},{_su_cur.z:+.3f}) "
      f"target ({_SU_TARGET.x:+.3f},{_SU_TARGET.y:+.3f},{_SU_TARGET.z:+.3f}) "
      f"axis ({_su_axis.x:+.3f},{_su_axis.y:+.3f},{_su_axis.z:+.3f}) "
      f"angle {math.degrees(_su_angle):.1f} deg")

# constants: bone-local face direction + neck arm 3x3 at Q_n = identity
su_f_loc = (su_pb_h.matrix.to_3x3().inverted() @ Arm_lin.inverted()
            @ su_head_axes_now()[0]).normalized()
su_pb_n.rotation_quaternion = SU_IDQ
bpy.context.view_layer.update()
su_A_n = su_pb_n.matrix.to_3x3()
sc.frame_set(sf0); bpy.context.view_layer.update()

fcs_n, fcs_h = su_find_fcs(swim_act, SU_NECK_B), su_find_fcs(swim_act, SU_HEAD_B)
assert all(f is not None for f in fcs_n + fcs_h), "Swim missing Neck/Head quats"
km_n, km_h = su_key_map(fcs_n), su_key_map(fcs_h)
for _fr in range(sf0, sf1 + 1):
    assert len(km_n.get(_fr, {})) == 4 and len(km_h.get(_fr, {})) == 4, \
        f"Swim missing quat keys at {_fr}"

_worst = 0.0
_crown_worst = 0.0
_rolls = []
for fr in range(sf0, sf1 + 1):
    sc.frame_set(fr); bpy.context.view_layer.update()   # original pose
    H_n_orig = su_pb_n.matrix.to_3x3()
    # -- Neck: rotate its Y (bone) axis to R_n @ (original world Y axis) --
    dir_n_orig_w = (Arm_lin @ H_n_orig @ Vector((0, 1, 0))).normalized()
    dir_n_tgt_w = (SU_Rn3 @ dir_n_orig_w).normalized()
    v_n = (Arm_lin @ su_A_n).inverted() @ dir_n_tgt_w
    Q_n = su_rot_between(Vector((0, 1, 0)), v_n)
    # -- Head: keep the anatomical face forward and 25 degrees up --
    su_pb_n.rotation_quaternion = Q_n
    su_pb_h.rotation_quaternion = SU_IDQ
    bpy.context.view_layer.update()
    A_h = su_pb_h.matrix.to_3x3()
    face_tgt = _SU_TARGET
    v_h = (Arm_lin @ A_h).inverted() @ face_tgt
    Q_h = su_rot_between(su_f_loc, v_h)
    # -- Roll: constrain the crown so the head reads upright (no roll) --
    Q_h, roll = su_correct_roll(Q_h)
    _rolls.append(roll)
    su_set_quat([km_n[fr][a] for a in range(4)], Q_n)
    su_set_quat([km_h[fr][a] for a in range(4)], Q_h)
# Keep the endpoint's world-space solve: copying the first local quaternion
# would amplify the source parent-chain endpoint noise instead of cancelling it.
for fc in fcs_n + fcs_h:
    fc.update()
# Validate the baked keys, not just the solver's temporary pose. The exporter
# adds a leading hold, so source keys 1..137 appear as runtime frames 2..138.
_seam_poses = []
for fr in range(sf0, sf1 + 1):
    sc.frame_set(fr)
    bpy.context.view_layer.update()
    f_final, c_final = su_head_axes_now()
    _worst = max(_worst, f_final.angle(_SU_TARGET))
    _crown_worst = max(_crown_worst, c_final.angle(_SU_CROWN_TGT))
    if fr in (sf0, sf1):
        _seam_poses.append({pb.name: main.matrix_world @ pb.matrix
                            for pb in main.pose.bones})
assert math.degrees(_worst) < 0.5, \
    f"face retarget mesh error too large: {math.degrees(_worst):.3f} deg"
assert math.degrees(_crown_worst) < 1.0, \
    f"crown retarget too large: {math.degrees(_crown_worst):.3f} deg"
_seam = max(abs(_seam_poses[0][bn][i][j] - _seam_poses[1][bn][i][j])
            for bn in _seam_poses[0] for i in range(4) for j in range(4))
assert _seam < 1e-4, f"Swim world-pose seam drifted: {_seam:.7f}"
print(f"  Swim baked world-pose seam: {_seam:.7f}")
_rmin, _rmax = min(_rolls), max(_rolls)
_rmean = sum(_rolls) / len(_rolls)
_rstd = (sum((r - _rmean) ** 2 for r in _rolls) / len(_rolls)) ** 0.5
print(f"  Swim head-up applied ({sf1 - sf0 + 1} frames; worst face err "
      f"{math.degrees(_worst):.4f} deg, crown err {math.degrees(_crown_worst):.4f} "
      f"deg; roll deg min {_rmin:.2f} max {_rmax:.2f} std {_rstd:.3f})")

# ---------- 6d. distinct crawl, isolated from all eight accepted actions ---
# The retargeted source sweeps both arms together. Author an alternating
# crawl on its in-place body instead; keep the rig, geometry and scale keys.
print("== SwimFreestyle: alternating crawl and periodic side breath ==")
main.animation_data.action = freestyle_act
ff0, ff1 = clip_frame_range(freestyle_act)
_free_prev = {}
_free_forearms = {"Left": [], "Right": []}


def free_orient(pb, direction, pole):
    """Solve a full bone frame through the rig's nonuniform parent scale."""
    pb.rotation_quaternion = SU_IDQ
    bpy.context.view_layer.update()
    # Solve the two axes directly in the pre-rotation frame. Iterating a
    # world-space roll angle under nonuniform scale can oscillate near a pull.
    inv = (Arm_lin @ pb.matrix.to_3x3() @
           Matrix.Diagonal(Vector(tuple(1/s for s in pb.scale)))).inverted()
    y = (inv @ direction).normalized()
    z = inv @ pole
    z = (z-z.dot(y)*y).normalized()
    return Matrix((y.cross(z), y, z)).transposed().to_quaternion()


def free_key(pb, q, frame):
    if pb.name in _free_prev and q.dot(_free_prev[pb.name]) < 0:
        q = -q
    _free_prev[pb.name] = q.copy()
    pb.rotation_quaternion = q
    pb.keyframe_insert("rotation_quaternion", frame=frame)
    bpy.context.view_layer.update()


# Uniform phase knots, cyclic Catmull-Rom: entry, catch, pull, exit,
# high elbow recovery, forward reach. Left and right are half a cycle apart.
FREE_ARMS = [
    ((.70, -.70, .03), (.15, -.98, -.12)),
    ((.65, -.62, -.44), (.10, -.50, -.86)),
    ((.42, .05, -.91), (.06, .86, -.50)),
    ((.38, .90, -.20), (.12, .87, .48)),
    ((.80, .15, .60), (.12, -.78, -.62)),
    ((.72, -.53, .45), (.23, -.94, .25)),
]


def free_arm_dir(phase, segment, side):
    t = (phase % 1)*len(FREE_ARMS)
    i, t = int(t), t % 1
    a, b, c, d = [Vector(FREE_ARMS[(i+j) % len(FREE_ARMS)][segment])
                  for j in (-1, 0, 1, 2)]
    v = .5*((2*b) + (-a+c)*t + (2*a-5*b+4*c-d)*t*t + (-a+3*b-3*c+d)*t*t*t)
    v.x *= side
    return v.normalized()


_free_targets = {}
for fr in range(ff0, ff1+1):
    sc.frame_set(fr)
    bpy.context.view_layer.update()
    u = (fr-ff0)/(ff1-ff0)
    # Add a modest axial roll to the source torso, not the runtime root.
    hips = main.pose.bones["mixamorig:Hips"]
    body = Arm_lin @ hips.matrix.to_3x3()
    roll = Quaternion(Vector((0, 1, 0)), math.radians(12)*math.sin(2*math.tau*u))
    free_key(hips, free_orient(hips, roll @ (body @ Vector((0, 1, 0))),
                              roll @ (body @ Vector((0, 0, 1)))), fr)
    # Arms clear either side of Lily's
    # deliberately oversized head, rather than reaching through its center.
    for side, sign in (("Left", 1), ("Right", -1)):
        phase = 2*u + (0 if sign == 1 else .5)
        upper = free_arm_dir(phase, 0, sign)
        fore = free_arm_dir(phase, 1, sign)
        elbow_normal = upper.cross(fore).normalized()
        for segment, name in enumerate(("Arm", "ForeArm")):
            pb = main.pose.bones[f"mixamorig:{side}{name}"]
            direction = fore if segment else upper
            # The elbow bend plane defines wrist roll without a singular
            # world-up/world-side pole during the recovery arc.
            pole = elbow_normal if segment else Vector((0, 0, 1))
            free_key(pb, free_orient(pb, direction, pole), fr)
            if segment:
                _free_forearms[side].append(pb.rotation_quaternion.copy())
        # Six-beat flutter per arm cycle, with small knee flexion.
        kick = math.sin(6*math.tau*u + (0 if sign == 1 else math.pi))
        angle = math.radians(12)*kick
        for name, pitch in (("UpLeg", angle), ("Leg", angle+math.radians(12+8*kick))):
            pb = main.pose.bones[f"mixamorig:{side}{name}"]
            direction = Vector((sign*.045, math.cos(pitch), math.sin(pitch)))
            free_key(pb, free_orient(pb, direction, Vector((0, 0, 1))), fr)
        for name in ("Foot", "ToeBase"):
            pb = main.pose.bones[f"mixamorig:{side}{name}"]
            free_key(pb, free_orient(pb, Vector((sign*.025, 1, -.06)), Vector((0, 0, 1))), fr)
    # One right-side breath, centered on right-arm recovery at phase 2/3.
    # Compact raised-cosine window has zero slope at both ends and wrap.
    dist = abs((u-7/12+.5) % 1-.5)
    breath = .5+.5*math.cos(math.pi*dist/.18) if dist < .18 else 0
    pitch = math.radians(15)
    turn = Quaternion(Vector((0, 1, 0)), math.radians(105)*breath)
    _SU_TARGET = turn @ Vector((0, -math.sin(pitch), -math.cos(pitch)))
    _SU_CROWN_TGT = turn @ Vector((0, -math.cos(pitch), math.sin(pitch)))
    neck_dir = Vector((0, -1, .16+.24*breath)).normalized()
    free_key(su_pb_n, free_orient(su_pb_n, neck_dir, Vector((0, 0, 1))), fr)
    su_pb_h.rotation_quaternion = SU_IDQ
    bpy.context.view_layer.update()
    A_h = Arm_lin @ su_pb_h.matrix.to_3x3()
    q = su_rot_between(su_f_loc, A_h.inverted() @ _SU_TARGET)
    q, _ = su_correct_roll(q)
    free_key(su_pb_h, q, fr)
    _free_targets[fr] = (_SU_TARGET.copy(), _SU_CROWN_TGT.copy())
# Interpolate elbow orientations between stroke landmarks in joint space.
# Nearly opposing exit/recovery direction vectors otherwise whip the wrist
# through a singular bend plane. Quaternion arcs keep this bounded and cyclic.
for side in _free_forearms:
    _free_prev.pop(f"mixamorig:{side}ForeArm", None)
for fr in range(ff0, ff1+1):
    sc.frame_set(fr)
    for side, samples in _free_forearms.items():
        phase = (fr-ff0)/(ff1-ff0)*12
        index, t = int(phase) % 12, phase % 1
        a = samples[round(index*(ff1-ff0)/12)]
        b = samples[round(((index+1) % 12)*(ff1-ff0)/12)]
        q = a.slerp(b, t*t*(3-2*t))
        free_key(main.pose.bones[f"mixamorig:{side}ForeArm"], q, fr)
for fc in collect_fcs(freestyle_act):
    for kp in fc.keyframe_points:
        kp.interpolation = "LINEAR"
    fc.update()
_free_error = [0.0, 0.0]
_free_seam = []
for fr, targets in _free_targets.items():
    sc.frame_set(fr)
    bpy.context.view_layer.update()
    for i, (actual_axis, target_axis) in enumerate(zip(su_head_axes_now(), targets)):
        if i == 1:
            actual_axis = (actual_axis-actual_axis.dot(targets[0])*targets[0]).normalized()
        _free_error[i] = max(_free_error[i], math.degrees(actual_axis.angle(target_axis)))
    if fr in (ff0, ff1):
        _free_seam.append({pb.name: main.matrix_world @ pb.matrix for pb in main.pose.bones})
free_seam = max(abs(_free_seam[0][bn][i][j]-_free_seam[1][bn][i][j])
                for bn in _free_seam[0] for i in range(4) for j in range(4))
assert _free_error[0] < .5 and _free_error[1] < 1, _free_error
assert free_seam < 1e-4, f"SwimFreestyle world-pose seam: {free_seam}"
print(f"  SwimFreestyle face/crown errors {_free_error}; world seam {free_seam:.9g}")

# ---------- 7. workbench previews (per clip, 4 phases, front+side) --------
for m in variants:
    m.hide_render = True
for m in hair_meshes:
    m.hide_render = m.name != "Hair_hair1"
sc.frame_start = 1
sc.frame_end = 32
sc.render.fps = 30
sc.render.engine = "BLENDER_WORKBENCH"
sc.display.shading.light = "STUDIO"
sc.display.shading.color_type = "SINGLE"
sc.display.shading.single_color = (0.75, 0.72, 0.68)
os.makedirs("/tmp/kilo/prev5", exist_ok=True)
cams = []
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
    cams.append(cam)
sc.render.resolution_x = 400
sc.render.resolution_y = 480

def clip_world_bbox(frs):
    """Tight world-space bbox of the skinned mesh over the sampled frames."""
    mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
    for fr in frs:
        sc.frame_set(fr)
        bpy.context.view_layer.update()
        dgm = bpy.context.evaluated_depsgraph_get()
        ev = lily.evaluated_get(dgm)
        me = ev.to_mesh()
        mw = ev.matrix_world
        for v in me.vertices:
            c = mw @ v.co
            for i in range(3):
                if c[i] < mn[i]: mn[i] = c[i]
                if c[i] > mx[i]: mx[i] = c[i]
        ev.to_mesh_clear()
    return mn, mx

DIRS = {"side": Vector((1, 0, 0.25)), "front": Vector((0, -1, 0.15))}
for name in ([] if os.environ.get("LILY_SKIP_PREVIEWS") else clip_acts):
    main.animation_data.action = clip_acts[name]
    f0, f1 = clip_frame_range(clip_acts[name])
    # frame each clip's own bbox: prone/low poses (Swim, Paddle) were cropped
    # by the fixed standing-height camera and could not be judged.
    mn, mx = clip_world_bbox([int(round(f0 + (f1 - f0) * q))
                              for q in (0, 0.25, 0.5, 0.75, 1.0)])
    ctr = (mn + mx) / 2
    span = max((mx - mn).length, 0.5)          # fit diagonal-ish, min framing
    dist = span * 1.45 + 0.25
    print(f"  preview fit {name}: ctr {[round(v,2) for v in ctr]} "
          f"ext [x {mx.x-mn.x:.2f} y {mx.y-mn.y:.2f} z {mx.z-mn.z:.2f}] "
          f"dist {dist:.2f}")
    for (tag, d), cam in zip(DIRS.items(), cams):
        tgt = cam.constraints[0].target
        tgt.location = ctr
        cam.location = ctr + d.normalized() * dist
        sc.camera = cam
        for q in (0, 0.25, 0.5, 0.75, 1.0):
            fr = int(round(f0 + (f1 - f0) * q))
            sc.frame_set(fr)
            bpy.context.view_layer.update()
            sc.render.filepath = f"/tmp/kilo/prev5/{name}_{tag}_f{fr}.png"
            bpy.ops.render.render(write_still=True)
print("previews written:", len(os.listdir("/tmp/kilo/prev5")))

# ---------- 7b. clip geometry metrics for the game side -------------------
# world-z bbox of the skinned mesh per clip (~12 sampled frames): tells the
# game where each clip's body sits relative to the node origin (ground z=0).
metrics = {}
for name in clip_acts:
    main.animation_data.action = clip_acts[name]
    f0, f1 = clip_frame_range(clip_acts[name])
    step = max(1, (f1 - f0) // 11)
    zmin, zmax = [], []
    for fr in range(f0, f1 + 1, step):
        sc.frame_set(fr)
        bpy.context.view_layer.update()
        dgm = bpy.context.evaluated_depsgraph_get()
        ev = lily.evaluated_get(dgm)
        me = ev.to_mesh()
        mw = ev.matrix_world
        zs = [(mw @ v.co).z for v in me.vertices]
        zmin.append(min(zs)); zmax.append(max(zs))
        ev.to_mesh_clear()
    metrics[name] = (round(min(zmin), 3), round(max(zmax), 3))
print("MESH Z RANGE per clip (min,max over ~12 frames):", metrics)

# ---------- 8. export (walk-script settings + ACTIONS single-armature) ----
for m in variants + hair_meshes:
    m.hide_render = False
main.animation_data.action = walk_act
sc.frame_set(1)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
lily.select_set(True)
for m in variants + hair_meshes:
    m.select_set(True)
main.select_set(True)
bpy.context.view_layer.objects.active = main
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB",
                          use_selection=True, export_animations=True,
                          export_skins=True)
print("EXPORTED:", OUT, os.path.getsize(OUT), "bytes")

# Exported-channel regression, independent of mesh/node index changes.
import json
import struct
import numpy as np

# Matrix decomposition in the exporter can reintroduce q/-q sign jumps.
# Canonicalize only the new action, cloning any shared output accessor so
# the eight accepted clips remain bit-identical even with exporter deduping.
with open(OUT, "rb") as f:
    raw = f.read()
size = struct.unpack_from("<I", raw, 12)[0]
doc = json.loads(raw[20:20+size])
binary = bytearray(raw[28+size:])
free_anim = next(a for a in doc["animations"] if a["name"] == "SwimFreestyle")
shared_outputs = {s["output"] for a in doc["animations"] if a is not free_anim
                  for s in a["samplers"]}
for channel in free_anim["channels"]:
    if channel["target"]["path"] != "rotation":
        continue
    sampler = free_anim["samplers"][channel["sampler"]]
    index = sampler["output"]
    acc = doc["accessors"][index]
    view = doc["bufferViews"][acc["bufferView"]]
    offset = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    stride = view.get("byteStride", 16)
    values = [struct.unpack_from("<4f", binary, offset+i*stride) for i in range(acc["count"])]
    changed = False
    for i in range(1, len(values)):
        if sum(x*y for x, y in zip(values[i-1], values[i])) < 0:
            values[i] = tuple(-x for x in values[i])
            changed = True
    if not changed:
        continue
    if index in shared_outputs:
        offset, stride = len(binary), 16
        doc["bufferViews"].append({"buffer": 0, "byteOffset": offset, "byteLength": len(values)*16})
        doc["accessors"].append({**acc, "bufferView": len(doc["bufferViews"])-1, "byteOffset": 0})
        sampler["output"] = len(doc["accessors"])-1
        binary.extend(b"\0" * (len(values)*16))
    for i, q in enumerate(values):
        struct.pack_into("<4f", binary, offset+i*stride, *q)
doc["buffers"][0]["byteLength"] = len(binary)
payload = json.dumps(doc, separators=(",", ":")).encode("utf-8")
payload += b" " * (-len(payload) % 4)
raw = (struct.pack("<III", 0x46546c67, 2, 28+len(payload)+len(binary)) +
       struct.pack("<II", len(payload), 0x4e4f534a) + payload +
       struct.pack("<II", len(binary), 0x004e4942) + binary)
with open(OUT, "wb") as f:
    f.write(raw)
print("  SwimFreestyle quaternion hemispheres normalized; final bytes:", len(raw))


def glb_tracks(path, clip):
    with open(path, "rb") as f:
        raw = f.read()
    size = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20:20 + size])
    binary = raw[28 + size:]
    def values(index):
        a = doc["accessors"][index]
        v = doc["bufferViews"][a["bufferView"]]
        assert a["componentType"] == 5126 and "byteStride" not in v
        count = a["count"] * {"SCALAR": 1, "VEC3": 3, "VEC4": 4}[a["type"]]
        return np.frombuffer(binary, dtype="<f4", count=count,
                             offset=v.get("byteOffset", 0) + a.get("byteOffset", 0))
    if clip is None:
        assert len(doc["animations"]) == 1, "Walk reference must contain one clip"
        anim = doc["animations"][0]
    else:
        anim = next(a for a in doc["animations"] if a["name"] == clip)
    tracks = {}
    for channel in anim["channels"]:
        target = channel["target"]
        sampler = anim["samplers"][channel["sampler"]]
        key = (doc["nodes"][target["node"]]["name"], target["path"])
        tracks[key] = (values(sampler["input"]), values(sampler["output"]))
    return doc, tracks


doc, actual = glb_tracks(OUT, "Walk")
_, reference = glb_tracks(BASE + "/assets/lily4_walk.glb", None)
assert actual.keys() == reference.keys(), "Walk channel set changed"
worst = max(float(np.max(np.abs(a - b))) for key in actual
            for a, b in zip(actual[key], reference[key]))
assert worst < 1e-4, f"Walk regression: {worst}"
assert len(doc["animations"]) == 9
assert all(len(s["joints"]) == 65 for s in doc["skins"])
print(f"GLB GATES: 9 clips / 65 bones; Walk regression worst-diff {worst:.9g} < 1e-4")

# Optional immutable baseline for geometry-only changes. Compare named tracks,
# not node/accessor indices, which legitimately change when adding variants.
if os.environ.get("LILY_REFERENCE_GLB"):
    for name in clip_acts:
        _, actual = glb_tracks(OUT, name)
        _, reference = glb_tracks(os.environ["LILY_REFERENCE_GLB"], name)
        assert actual.keys() == reference.keys(), f"{name} channel set changed"
        assert all(np.array_equal(a, b) for key in actual
                   for a, b in zip(actual[key], reference[key])), f"{name} tracks changed"
    print("GLB GATES: all nine clips exactly equal to LILY_REFERENCE_GLB")
