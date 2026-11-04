"""Renders the local-cars prototypes written by scripts/cars/export_vehicles.ts.

    python3 scripts/cars/render_vehicles.py -- --dir <export dir> --out <png> --cars ute_lod0[,boxy_car,...]
        [--view front34|side|rear34|driver] [--samples 16] [--res 960x540] [--gap 2.6] [--zoom 1.0]

For a sheet of every body, one per cell with labels, see lineup.py.

Several cars stand side by side along s (left to right in the side view), each on its own spot.
Runs with Blender's Python module (bpy) or `blender --background --python`.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser()
    p.add_argument("--dir", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--cars", required=True)
    p.add_argument("--view", default="front34")
    p.add_argument("--samples", type=int, default=16)
    p.add_argument("--res", default="960x540")
    p.add_argument("--gap", type=float, default=2.7)
    p.add_argument("--zoom", type=float, default=1.0, help="scales the lens (1.4 frames one car closely)")
    return p.parse_args(argv)


def material(path):
    name = os.path.basename(path)
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.38
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(path)
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def car(path, offset):
    d = json.load(open(path))
    pos, uv, idx = d["pos"], d["uv"], d["idx"]
    verts = [(pos[i] + offset[0], pos[i + 1] + offset[1], pos[i + 2]) for i in range(0, len(pos), 3)]
    faces = [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)]
    me = bpy.data.meshes.new(os.path.basename(path))
    me.from_pydata(verts, [], faces)
    layer = me.uv_layers.new()
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.loops[li].vertex_index
            layer.data[li].uv = (uv[v * 2], 1 - uv[v * 2 + 1])
    me.materials.append(material(os.path.join(os.path.dirname(path), d["texture"])))
    ob = bpy.data.objects.new(me.name, me)
    bpy.context.scene.collection.objects.link(ob)
    return d["tris"]


def main():
    a = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    names = a.cars.split(",")
    n = len(names)
    # Side view: cars nose to tail along f, the first on the left. Other views: side by side along s,
    # staggered a little, like a row of parked cars.
    span = 6.2 if a.view == "side" else a.gap
    for i, name in enumerate(names):
        k = i - (n - 1) / 2
        off = (-k * span, 0) if a.view == "side" else (k * 1.2, -k * span)
        car(os.path.join(a.dir, name + ".json"), off)

    # Ground: a light grey asphalt pad.
    bpy.ops.mesh.primitive_plane_add(size=80)
    g = bpy.context.object
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.16, 0.16, 0.155, 1)
    gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
    g.data.materials.append(gm)

    # Sun and sky.
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(2)
    sun.rotation_euler = (math.radians(40), 0, math.radians(-35))
    sc.collection.objects.link(sun)
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.68, 0.85, 1)
    bg.inputs["Strength"].default_value = 0.9
    sc.world = world

    # Camera.
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    width = n * (span if a.view == "side" else a.gap)
    if a.view == "side":
        cam.data.lens = 50
        dist = max(9.0, width * 1.6)
        cam.location = (0, -dist, 1.1)
        target = Vector((0, 0, 0.85))
    elif a.view == "rear34":
        cam.data.lens = 45
        cam.location = (-7.5 - width * 0.5, -6.0 - width * 0.4, 2.0)
        target = Vector((0, 0, 0.8))
    elif a.view == "driver":
        # From a driver's eye in the next lane, a few car lengths back.
        cam.data.lens = 28
        cam.location = (-14, -4.2, 1.15)
        target = Vector((0, 0, 0.9))
    else:
        cam.data.lens = 45
        cam.location = (7.2 + width * 0.5, -6.0 - width * 0.4, 2.0)
        target = Vector((0, 0, 0.8))
    cam.data.lens *= a.zoom
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()

    w, h = (int(v) for v in a.res.split("x"))
    sc.render.engine = "CYCLES"
    sc.cycles.samples = a.samples
    sc.cycles.use_denoising = True
    sc.cycles.device = "CPU"
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.filepath = a.out
    sc.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    bpy.ops.render.render(write_still=True)
    print("wrote", a.out)


main()
