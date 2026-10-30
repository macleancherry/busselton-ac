"""Renders scripts/network/compare.ts glbs side by side in Blender: the built track's drivable
surface and the network prototype's, in clay with heights exaggerated, under a low sun, so steps,
lips and overlaps show as hard shadow lines.

    <blender python> scripts/network/render_compare.py <name.current.glb> <name.proto.glb> <out.png>
        [--exaggerate 20] [--samples 16] [--res 960x540]
(bpy as a module; or blender --background --python scripts/network/render_compare.py -- ...)
"""
import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
cur, pro, out = argv[0], argv[1], argv[2]


def opt(k, d):
    return argv[argv.index(k) + 1] if k in argv else d


ex = float(opt("--exaggerate", "20"))
samples = int(opt("--samples", "16"))
w, h = map(int, opt("--res", "960x540").split("x"))


def load(path, offset_x, colour):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]
    mat = bpy.data.materials.new("clay")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = 0.8
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(mat)
    return objs


bpy.ops.wm.read_factory_settings(use_empty=True)
groups = [load(cur, 0, (0.75, 0.72, 0.68)), load(pro, 0, (0.62, 0.7, 0.78))]
# Centre both on their common middle and median height; exaggerate heights; place side by side.
allv = [o.matrix_world @ v.co for g in groups for o in g for v in o.data.vertices]
cx = sum(v.x for v in allv) / len(allv)
cy = sum(v.y for v in allv) / len(allv)
zs = sorted(v.z for v in allv)
cz = zs[len(zs) // 2]
for i, g in enumerate(groups):
    for o in g:
        bpy.context.view_layer.update()
        mw = o.matrix_world.copy()
        for v in o.data.vertices:
            p = mw @ v.co
            v.co = Vector((p.x - cx + (i - 0.5) * 80, p.y - cy, (p.z - cz) * ex))
        o.matrix_world.identity()
scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.samples = samples
scene.render.resolution_x, scene.render.resolution_y = w, h
scene.render.filepath = out
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.9, 0.92, 0.95, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.35
scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
sun.data.energy = 4
sun.rotation_euler = (math.radians(72), 0, math.radians(35))
scene.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
cam.data.type = "ORTHO"
cam.data.ortho_scale = 165
cam.location = (0, -95, 110)
cam.rotation_euler = (math.radians(42), 0, 0)
scene.collection.objects.link(cam)
scene.camera = cam
bpy.ops.render.render(write_still=True)
