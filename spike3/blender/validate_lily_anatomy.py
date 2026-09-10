"""Model-only contract checks and repeatable Workbench anatomy views.

blender -b --python spike3/blender/validate_lily_anatomy.py -- --snapshot --out /tmp/kilo/lily-anatomy/before
blender -b --python spike3/blender/validate_lily_anatomy.py -- --reference /tmp/kilo/lily-anatomy/before/lily4_full.glb --out /tmp/kilo/lily-anatomy/after

Snapshots are immutable review inputs. No runtime code or animation is edited.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import sys

for path in ("/usr/lib/python3.14/lib-dynload", "/usr/lib/python3/dist-packages"):
    if path not in sys.path:
        sys.path.append(path)

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
CLIPS = {"Walk", "Idle", "Swim", "SwimFreestyle", "Sit", "Paddle", "SurfRide", "Cheer", "Greet"}


def asset(path):
    raw = Path(path).read_bytes()
    size = struct.unpack_from("<I", raw, 12)[0]
    doc, binary = json.loads(raw[20:20+size]), raw[28+size:]

    def view(i):
        v = doc["bufferViews"][i]
        start = v.get("byteOffset", 0)
        return binary[start:start+v["byteLength"]]

    def accessor(i):
        a = doc["accessors"][i]
        v = doc["bufferViews"][a["bufferView"]]
        width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[a["type"]]
        dtype = {5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}[a["componentType"]]
        item = np.dtype(dtype).itemsize
        return np.ndarray((a["count"], width), dtype=dtype, buffer=view(a["bufferView"]),
                          offset=a.get("byteOffset", 0), strides=(v.get("byteStride", width*item), item)).copy()

    tracks = {a["name"]: {(doc["nodes"][c["target"]["node"]]["name"], c["target"]["path"]):
              (a["samplers"][c["sampler"]].get("interpolation", "LINEAR"),
               *(accessor(a["samplers"][c["sampler"]][k]).tobytes() for k in ("input", "output")))
              for c in a["channels"]} for a in doc.get("animations", [])}
    geometry = {(n["name"], doc["materials"][p["material"]]["name"]):
                {**{k: accessor(v) for k, v in p["attributes"].items()}, "indices": accessor(p["indices"])}
                for n in doc["nodes"] if "mesh" in n for p in doc["meshes"][n["mesh"]]["primitives"]}
    parents = {c: n["name"] for n in doc["nodes"] for c in n.get("children", [])}
    rig = [(n["name"], parents.get(i), [n.get(k) for k in ("translation", "rotation", "scale", "matrix")])
           for i, n in enumerate(doc["nodes"]) if n["name"].startswith("mixamorig:") or n["name"] == "LilyRig"]
    binds = [([doc["nodes"][i]["name"] for i in s["joints"]], accessor(s["inverseBindMatrices"]).tobytes())
             for s in doc.get("skins", [])]
    return doc, tracks, geometry, rig, binds, [view(i["bufferView"]) for i in doc.get("images", [])]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=ROOT/"beach3d/assets/lily4_full.glb")
    parser.add_argument("--reference", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--snapshot", action="store_true")
    parser.add_argument("--no-render", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    args.out.mkdir(parents=True, exist_ok=True)
    if args.snapshot:
        for source in (args.model, ROOT/"spike3/assets/lily4.glb"):
            target = args.out/source.name
            assert not target.exists(), f"refusing to overwrite snapshot: {target}"
            shutil.copyfile(source, target)
    doc, tracks, geometry, rig, binds, images = asset(args.model)
    assert set(tracks) == CLIPS
    assert all(len(s["joints"]) == 65 for s in doc["skins"])
    assert {n["name"] for n in doc["nodes"] if n["name"].startswith("Hair_")} == {f"Hair_hair{i}" for i in range(1, 7)}
    report = {"model": str(args.model), "sha256": hashlib.sha256(args.model.read_bytes()).hexdigest(),
              "bytes": args.model.stat().st_size, "clips": sorted(tracks), "bones": 65, "hairNodes": 6,
              "vertices": sum(len(g["POSITION"]) for g in geometry.values()),
              "triangles": sum(len(g["indices"])//3 for g in geometry.values())}
    for key, geo in geometry.items():
        assert all(np.isfinite(a).all() for a in geo.values()), key
        assert np.max(np.abs(geo["WEIGHTS_0"].sum(axis=1)-1)) < 1e-5, key
        assert "WEIGHTS_1" not in geo, key
    if args.reference:
        old_doc, old_tracks, old_geo, old_rig, old_binds, old_images = asset(args.reference)
        reference_bytes = args.reference.read_bytes()
        report["reference"] = {"path": str(args.reference),
                               "sha256": hashlib.sha256(reference_bytes).hexdigest(),
                               "gitBlob": hashlib.sha1(f"blob {len(reference_bytes)}\0".encode()+reference_bytes).hexdigest()}
        assert tracks == old_tracks, "animation tracks changed"
        assert rig == old_rig and binds == old_binds, "rest rig / inverse binds changed"
        assert images == old_images, "face image changed"
        assert doc["materials"] == old_doc["materials"], "materials / palette changed"
        assert geometry.keys() == old_geo.keys(), "mesh / material interfaces changed"
        exact = []
        normal_error = 0.0
        for key, geo in geometry.items():
            if key[0].startswith("Hair_") or key[1] in ("faceTexture", "daisyPetal"):
                assert geo.keys() == old_geo[key].keys(), key
                for k, a in geo.items():
                    b = old_geo[key][k]
                    if k == "indices":
                        # Blender can reorder triangles/cyclic corners of the
                        # same surface during export. Never ignore winding.
                        def triangles(v):
                            return sorted(tuple(np.roll(t, -int(np.argmin(t))))
                                          for t in v.reshape(-1, 3))
                        assert triangles(a) == triangles(b), (key, k)
                    elif k == "NORMAL":
                        error = float(np.max(np.abs(a-b)))
                        normal_error = max(normal_error, error)
                        assert error < 2e-4, (key, k, error)
                    else:
                        assert np.array_equal(a, b), (key, k)
                exact.append("/".join(key))
            if key[1] == "skin":
                # Compare the actual foot/leg samples, not just the bounding box.
                # Sorting tolerates an altered arm vertex count / export ordering.
                def lower_rows(g):
                    mask = g["POSITION"][:, 1] < .230
                    attrs = [g[k][mask] for k in ("POSITION", "NORMAL", "JOINTS_0", "WEIGHTS_0")]
                    return sorted(row.tobytes() for row in np.concatenate(attrs, axis=1))
                assert lower_rows(geo) == lower_rows(old_geo[key]), "lower skin / grounding inputs changed"
        assert {"faceTexture", "daisyPetal"} <= {key.split("/")[-1] for key in exact}, "missing protected surfaces"
        report["preserved"] = {"allNineTracks": "exact", "rigAndBinds": "exact", "materialsAndImages": "exact",
                               "lowerSkinAndWeights": "exact", "unchangedSurfaces": exact,
                               "unchangedSurfaceNormalMaxDelta": normal_error,
                               "exactChannelsPerClip": {name: len(channels) for name, channels in tracks.items()}}
        # Garment changes may follow the refined shoulder only. Waist,
        # crotch, cuffs and their weights must remain byte-identical.
        garment_checked = []
        for key, geo in geometry.items():
            if key[0].startswith("Suit_") or key[1].startswith("suit"):
                mask = geo["POSITION"][:, 1] < .45
                old_mask = old_geo[key]["POSITION"][:, 1] < .45
                assert np.array_equal(mask, old_mask), (key, "lower garment membership")
                for k in ("POSITION", "NORMAL", "JOINTS_0", "WEIGHTS_0"):
                    assert np.array_equal(geo[k][mask], old_geo[key][k][mask]), (key, k, "lower garment")
                garment_checked.append("/".join(key))
        assert len(garment_checked) >= 8, "missing garment primitives"
        report["preserved"]["lowerGarments"] = "exact"
        report["preserved"]["garmentPrimitives"] = garment_checked

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=str(args.model))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    report["restPivots"] = {b.name: list(arm.matrix_world @ b.head_local) for b in arm.data.bones
                            if b.name.endswith(("Arm", "ForeArm", "Hand"))}
    actions = {a.name: a for a in bpy.data.actions}
    assert set(actions) == CLIPS, "imported animation interface changed"
    report["actions"] = {n: list(a.frame_range) for n, a in actions.items()}
    # The importer also creates unskinned bone-display widgets. They are not
    # exported character geometry and must not inflate the pose bounds.
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and
              any(mod.type == "ARMATURE" for mod in o.modifiers)]
    report["poseSamples"] = {}
    for name, action in actions.items():
        arm.animation_data.action = action
        arm.animation_data.action_slot = action.slots[0]
        bounds = []
        for frame in np.linspace(*action.frame_range, 9):
            scene.frame_set(int(frame), subframe=float(frame % 1))
            bpy.context.view_layer.update()
            depsgraph = bpy.context.evaluated_depsgraph_get()
            points = []
            for ob in meshes:
                evaluated = ob.evaluated_get(depsgraph)
                me = evaluated.to_mesh()
                coords = np.empty(len(me.vertices)*3, dtype=np.float32)
                me.vertices.foreach_get("co", coords)
                matrix = np.array(evaluated.matrix_world)
                coords = coords.reshape(-1, 3) @ matrix[:3, :3].T + matrix[:3, 3]
                assert np.isfinite(coords).all(), (name, frame, ob.name)
                points.append(coords)
                evaluated.to_mesh_clear()
            points = np.concatenate(points)
            assert np.max(np.ptp(points, axis=0)) < 2, (name, frame, "exploded pose", np.ptp(points, axis=0).tolist())
            bounds.append([points.min(axis=0).tolist(), points.max(axis=0).tolist()])
        report["poseSamples"][name] = {"count": len(bounds), "finiteAndBounded": True}
    for ob in meshes:
        ob.hide_render = ob.name.startswith(("Suit_Tank_", "Suit_Crop_")) or (
            ob.name.startswith("Hair_") and not ob.name.startswith("Hair_hair5"))
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studiolight_rotate_z = math.radians(25)
    scene.display.shading.color_type = "TEXTURE"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.display.shading.curvature_ridge_factor = 1.1
    scene.display.shading.curvature_valley_factor = .7
    scene.display.shading.background_type = "WORLD"
    scene.world = bpy.data.worlds.new("ReviewWorld")
    scene.world.color = (.19, .22, .26)
    scene.render.resolution_x = 720
    scene.render.resolution_y = 800
    scene.render.resolution_percentage = 100
    camera = bpy.data.objects.new("ReviewCamera", bpy.data.cameras.new("ReviewCamera"))
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera.data.type = "ORTHO"
    poses = [("Rest", 0), ("Idle", 150), ("Walk", 9), ("Walk", 25),
             ("Swim", 35), ("Swim", 103), ("SwimFreestyle", 18), ("SwimFreestyle", 52),
             ("Cheer", 44), ("ElbowFlex", 0)]
    report["renders"] = []
    report["reviewCameras"] = {}
    for name, frame in ([] if args.no_render else poses):
        arm.data.pose_position = "REST" if name == "Rest" else "POSE"
        if name == "ElbowFlex":
            # Preview-only stress pose, not a tenth clip or runtime catch pose.
            # Apply the same world-space 85-degree bend to both immutable rigs.
            arm.animation_data_clear()
            for bone in arm.pose.bones:
                bone.matrix_basis = Matrix.Identity(4)
            for side in ("Left", "Right"):
                bone = arm.pose.bones[f"mixamorig:{side}ForeArm"]
                rest = (arm.matrix_world @ bone.bone.matrix_local).to_quaternion()
                bone.rotation_mode = "QUATERNION"
                bone.rotation_quaternion = rest.inverted() @ Quaternion((1, 0, 0), math.radians(-85)) @ rest
            report["elbowFlex"] = {"degrees": 85, "previewOnly": True, "exported": False}
        elif name != "Rest":
            action = actions[name]
            arm.animation_data.action = action
            arm.animation_data.action_slot = action.slots[0]
            scene.frame_set(frame)
        bpy.context.view_layer.update()
        swimming = name in ("Swim", "SwimFreestyle")
        target = Vector((0, -.20, .20)) if swimming else Vector((0, 0, .50))
        for view, direction in (("front", (0, -1, 0)), ("side", (1, 0, 0))):
            camera.location = target + Vector(direction)*3
            camera.rotation_euler = (target-camera.location).to_track_quat("-Z", "Y").to_euler()
            camera.data.ortho_scale = 1.70 if swimming else 1.28
            filename = f"{name}-f{frame}-{view}.png"
            report["reviewCameras"][filename] = {"position": list(camera.location), "target": list(target),
                                                "orthoScale": camera.data.ortho_scale, "resolution": [720, 800]}
            scene.render.filepath = str(args.out/filename)
            bpy.ops.render.render(write_still=True)
            report["renders"].append(filename)
    (args.out/"model-report.json").write_text(json.dumps(report, indent=2)+"\n")
    print("ANATOMY VALIDATION:", json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
