"""B4 candy shortboard. Blender --background --python this_file.py.

Model in game coordinates: deck Y=0, nose +Z; export restores glTF Y-up.
"""
import bpy
import math
import os
import sys

# Blender 5.0.1 needs the system ctypes for the glTF addon on this host.
for path in ("/usr/lib/python3.14/lib-dynload", "/usr/lib/python3/dist-packages"):
    if path not in sys.path:
        sys.path.append(path)

bpy.ops.wm.read_factory_settings(use_empty=True)
OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../beach3d/assets/surfboard.glb"))


def linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


mats = []
for name, color in (("CreamDeck", "fff9ec"), ("CandyPink", "ff8fb8"), ("TealStripe", "4fc3d9")):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = tuple(linear(int(color[i:i+2], 16) / 255) for i in (0, 2, 4)) + (1,)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = mat.diffuse_color
    bsdf.inputs["Roughness"].default_value = 1
    mats.append(mat)

# A closed six-point cross-section swept along the shortboard. Shared deck
# and rail vertices keep normals unambiguous; stripes are faces, not decals.
rows = 60
verts, faces, colors = [], [], []
for j in range(rows+1):
    z = -.75 + 1.5*j/rows
    a = math.acos(max(-1, min(1, z/.75)))
    half = max(.002, .25 * math.sin(a) * (1 - .20*max(0, math.cos(a))))
    rocker = .025*max(0, z/.75)**4
    for x, y in ((-.9*half,0),(.9*half,0),(half,-.025),
                 (.9*half,-.07),(-.9*half,-.07),(-half,-.025)):
        verts.append((x,-z,y+rocker))
for j in range(rows):
    z = -.75 + 1.5*(j+.5)/rows
    deck = (1 if -.50 < z < -.32 or .25 < z < .42 else
            2 if -.27 < z < -.14 or .47 < z < .56 else 0)
    for i in range(6):
        faces.append((j*6+i,(j+1)*6+i,(j+1)*6+(i+1)%6,j*6+(i+1)%6))
        colors.append(deck if i == 0 else 2 if i == 3 else 1)
faces.extend([tuple(reversed(range(6))),tuple(range(rows*6,(rows+1)*6))])
colors.extend([1,1])
data = bpy.data.meshes.new("Shortboard")
data.from_pydata(verts, [], faces)
data.update()
obj = bpy.data.objects.new("Shortboard", data)
bpy.context.collection.objects.link(obj)
for mat in mats:
    data.materials.append(mat)
for poly, color in zip(data.polygons, colors):
    poly.material_index = color
    poly.use_smooth = poly.index < rows*6 and poly.index % 6 not in (0,3)
# Recalculate outward normals after the Y-up conversion.
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_animations=False,
                         export_yup=True, use_selection=True)
print("Surfboard exported:", OUT)
