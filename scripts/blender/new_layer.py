"""Start a hand-made layer in Blender: the generated track around the spot as a locked reference.

    blender --background --python scripts/blender/new_layer.py -- --base <base.glb> --out <layer.blend>

Opens the base (from scripts/blender/export_base.ts) into a "Base (reference)" collection that can't
be selected and won't be exported, and makes an empty "Layer" collection to model in. Everything is in
the track's own coordinates (Blender's Z up; the glTF importer turns AC's Y up into it). When done,
scripts/blender/export_layer.py exports the "Layer" collection only. Also runs with pip's bpy module.
"""
import argparse
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--base", required=True)
ap.add_argument("--out", required=True)
a = ap.parse_args(argv)

bpy.ops.wm.read_factory_settings(use_empty=True)
base = bpy.data.collections.new("Base (reference)")
layer = bpy.data.collections.new("Layer")
bpy.context.scene.collection.children.link(base)
bpy.context.scene.collection.children.link(layer)
bpy.ops.import_scene.gltf(filepath=a.base)
for ob in list(bpy.context.selected_objects):
    for c in ob.users_collection:
        c.objects.unlink(ob)
    base.objects.link(ob)
    ob.hide_select = True
base.hide_select = True
bpy.context.scene.unit_settings.system = "METRIC"
bpy.ops.wm.save_as_mainfile(filepath=a.out)
print(f"wrote {a.out}: {len(base.objects)} reference objects; model in the 'Layer' collection")
