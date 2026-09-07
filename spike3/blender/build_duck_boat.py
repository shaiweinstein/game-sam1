"""Model the B3 duck boat. Run from the repo root with Blender --background.

All modeling coordinates below are game coordinates (Y up, bow +Z).
Conversion to Blender's Z-up happens at mesh creation; glTF restores Y-up.
Waterline is zero; the open well floor/seat top is 0.27 m above it.
"""
import bpy
import math
import os
import sys

# Blender 5.0.1 on this host needs the system ctypes for the glTF addon.
for path in ("/usr/lib/python3.14/lib-dynload", "/usr/lib/python3/dist-packages"):
    if path not in sys.path:
        sys.path.append(path)

bpy.ops.wm.read_factory_settings(use_empty=True)
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../beach3d/assets/duck_boat.glb"))
COL = {
    "Hull": "ffd94e", "Belly": "fff3c4", "Seat": "e8a93a",
    "Wing": "ffe170", "WingPatch": "f0c14b", "Bill": "ff9a3c",
    "BillEdge": "d9741f", "Eye": "3a2e6e", "Sparkle": "ffffff",
    "Cheek": "ffb0c0", "Feet": "ff8a2e",
}


def linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


MATS = {}
for name, hex_color in COL.items():
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = tuple(linear(int(hex_color[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (1,)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = mat.diffuse_color
    bsdf.inputs["Roughness"].default_value = 1
    MATS[name] = mat


def xyz(p):
    return (p[0], -p[2], p[1])


def mesh(name, vertices, faces, color):
    data = bpy.data.meshes.new(name)
    data.from_pydata([xyz(v) for v in vertices], [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(MATS[color])
    for poly in data.polygons:
        poly.use_smooth = True
    return obj


def egg(name, p, scale, color):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=xyz(p))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (scale[0], scale[2], scale[1])
    obj.data.materials.append(MATS[color])
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


# A closed cross-section swept around an oval: genuinely OPEN in the middle,
# not a solid ellipsoid that intersects Lily. Cream bottom is half submerged.
rings = [(.30, .54, -.12), (.43, .70, -.035), (.45, .77, .13),
         (.44, .76, .29), (.415, .735, .34), (.355, .65, .34),
         (.335, .62, .27), (.33, .60, .17), (.30, .54, -.12)]
n = 48
verts = [(rx * math.cos(i * math.tau / n), y, rz * math.sin(i * math.tau / n))
         for rx, rz, y in rings for i in range(n)]
faces = [(r*n+i, (r+1)*n+i, (r+1)*n+(i+1)%n, r*n+(i+1)%n)
         for r in range(len(rings)-1) for i in range(n)]
hull = mesh("OpenHull", verts, faces, "Hull")
hull.data.materials.append(MATS["Belly"])
for poly in hull.data.polygons:
    if poly.index < n:
        poly.material_index = 1
egg("CreamKeel", (0, -.055, -.02), (.39, .11, .65), "Belly")
egg("SeatFloor", (0, .235, -.16), (.325, .035, .43), "Seat")
egg("SeatBack", (0, .335, -.54), (.28, .12, .07), "Seat")
egg("Tail", (0, .30, -.71), (.14, .17, .10), "Hull")

egg("BowBreast", (0, .20, .52), (.31, .20, .23), "Hull")
egg("DuckNeck", (0, .35, .55), (.16, .24, .155), "Hull")
egg("DuckHead", (0, .56, .585), (.235, .20, .23), "Hull")
egg("BillLowerEdge", (0, .495, .811), (.18, .045, .135), "BillEdge")
egg("OrangeBill", (0, .527, .807), (.185, .047, .145), "Bill")
for s in (-1, 1):
    egg("Eye", (s*.168, .60, .734), (.056, .061, .035), "Eye")
    egg("EyeSparkle", (s*.163-.012, .62, .764), (.017, .019, .01), "Sparkle")
    egg("PinkCheek", (s*.203, .512, .687), (.033, .04, .039), "Cheek")
    egg("FlankWing", (s*.427, .205, -.12), (.055, .13, .36), "Wing")
    egg("WingPatch", (s*.471, .21, -.16), (.018, .068, .25), "WingPatch")
    # Three rounded toes make each orange stern bump read as a webbed foot.
    egg("WebFoot", (s*.245, .025, -.73), (.105, .065, .14), "Feet")
    for toe in (-1, 0, 1):
        egg("WebToe", (s*.245+toe*.053, .025, -.82), (.038, .045, .065), "Feet")

# Merge pieces by material; boat3d batches these flat colors into one toon draw.
for mat in MATS.values():
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH'
               and len(o.data.materials) == 1 and o.data.materials[0] == mat]
    if not objects:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=False,
                         export_yup=True, use_selection=True)
print("Duck boat exported:", OUT)
