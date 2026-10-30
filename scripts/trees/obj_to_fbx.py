"""OBJ (y up, from make_reference.ts) to FBX for Content Manager's tree converter.

    blender --background --python scripts/trees/obj_to_fbx.py -- <in.obj> <out.fbx>

Each LOD stays its own mesh; materials keep their diffuse and normal textures (CM reads the
DiffuseColor and NormalMap roles); no transforms (CM ignores them).
"""
import os
import sys

import bpy

src, dst = sys.argv[sys.argv.index("--") + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=src, forward_axis="NEGATIVE_Z", up_axis="Y")
folder = os.path.dirname(os.path.abspath(src))
for mat in bpy.data.materials:
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    base = mat.name.split(".")[0]
    diff = os.path.join(folder, base + ".dds")
    nm = os.path.join(folder, base + "_nm.dds")
    if os.path.exists(diff):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(diff)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
    if os.path.exists(nm):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(nm)
        t.image.colorspace_settings.name = "Non-Color"
        n = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(t.outputs["Color"], n.inputs["Color"])
        nt.links.new(n.outputs["Normal"], bsdf.inputs["Normal"])
for o in bpy.context.scene.objects:
    o.select_set(True)
bpy.ops.export_scene.fbx(filepath=dst, use_selection=False, axis_forward="-Z", axis_up="Y", path_mode="RELATIVE", apply_unit_scale=True, mesh_smooth_type="OFF")
print("wrote", dst)
