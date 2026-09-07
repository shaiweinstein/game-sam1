"""Build beach3d/assets/lily4_full.glb — Lily v4 skinned to EIGHT Mixamo
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

NOTE on GLB inspection: the 32 parts are JOINED into one skinned mesh
(node "Lily4", 7 primitives = 7 materials), so a mesh-name listing shows
the leftover datablock name "HairCap" — identical layout to lily4_walk.glb.

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
assert len(meshes) == 32, "expected 32 parts"

# ---------- Walk: conform + damp through the reference pipeline -----------
FR_W = range(1, 33)
print("== conform Walk ==")
info = conform_rig(main, walk_act, FR_W)
knee_z = info["knee_z"]
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

# ---------- 6. bind parts by rule (verbatim from build_lily4_walk.py) -----
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

def _ss(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)

def suit_bind(co):
    ax = abs(co.x)
    t = _ss((ax - 0.016) / 0.016) * _ss((0.300 - co.z) / 0.058)
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

def hem_trim_bind(co):
    t = _ss((abs(co.x) - 0.016) / 0.016)
    leg = "mixamorig:LeftUpLeg" if co.x >= 0 else "mixamorig:RightUpLeg"
    return [("mixamorig:Hips", 1.0 - t), (leg, t)]

CAP_BLEND_L = zblend("mixamorig:Spine", "mixamorig:LeftArm", 0.558, 0.492)
CAP_BLEND_R = zblend("mixamorig:Spine", "mixamorig:RightArm", 0.558, 0.492)
NECK_BLEND = zblend("mixamorig:Head", "mixamorig:Spine", 0.645, 0.556)
CAPE_BLEND = zblend("mixamorig:Head", "mixamorig:Spine", 0.740, 0.560)
ARM_BLEND_L = zblend("mixamorig:LeftArm", "mixamorig:LeftForeArm",
                     ELBOW_Z + 0.018, ELBOW_Z - 0.015)
ARM_BLEND_R = zblend("mixamorig:RightArm", "mixamorig:RightForeArm",
                     ELBOW_Z + 0.018, ELBOW_Z - 0.015)

BINDINGS = {"Head": [("mixamorig:Head", None)]}
for h in HAIR:
    BINDINGS[h] = [("mixamorig:Head", None)]
for c in CAPE:
    BINDINGS[c] = CAPE_BLEND
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
    "Suit":       suit_bind,
    "TrimNeckline": [("mixamorig:Spine", None)],
    "TrimHem":    hem_trim_bind,
    "DaisyC":     BODY_BLEND,
})
for k in range(4):
    BINDINGS["DaisyP%d" % k] = BODY_BLEND

unbound = [m.name for m in meshes if m.name not in BINDINGS]
assert not unbound, f"parts missing bindings: {unbound}"

for m in meshes:
    spec = BINDINGS[m.name]
    if callable(spec):
        bones = []
        seen = set()
        for v in m.data.vertices:
            for bn, _w in spec(v.co):
                if bn not in seen:
                    seen.add(bn); bones.append(bn)
        grp = {bn: m.vertex_groups.new(name=bn) for bn in bones}
        for v in m.data.vertices:
            for bn, w in spec(v.co):
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
    if m.name in ("Suit", "TrimHem", "TrimNeckline"):
        bad = [v.index for v in m.data.vertices
               if sum(g.weight for g in v.groups) < 0.999]
        print(f"  bind check {m.name}: {len(m.data.vertices)} verts, "
              f"unbound {len(bad)}")
        assert not bad, f"{m.name} unweighted verts: {bad[:10]}"

bpy.ops.object.select_all(action="DESELECT")
for m in meshes:
    m.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bpy.context.view_layer.objects.active = max(meshes, key=lambda m: len(m.data.vertices))
bpy.ops.object.join()
lily = bpy.context.view_layer.objects.active
lily.name = "Lily4"

bpy.ops.object.select_all(action="DESELECT")
lily.select_set(True)
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

# ---------- 7. workbench previews (per clip, 4 phases, front+side) --------
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
for name, fbx, loops, hzero in CLIPS:
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
for name, fbx, loops, hzero in CLIPS:
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
main.animation_data.action = walk_act
sc.frame_set(1)
bpy.context.view_layer.update()
bpy.ops.object.select_all(action="DESELECT")
lily.select_set(True)
main.select_set(True)
bpy.context.view_layer.objects.active = main
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB",
                          use_selection=True, export_animations=True,
                          export_skins=True)
print("EXPORTED:", OUT, os.path.getsize(OUT), "bytes")
