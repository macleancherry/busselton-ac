"""Export a hand-made layer from Blender: the "Layer" collection only, as .glb in the track's coordinates.

    blender --background <layer.blend> --python scripts/blender/export_layer.py -- --out <layer.glb>

Then: npx tsx scripts/blender/make_layer.ts <layer.glb> <layers dir> <name> --replaces <lng,lat,radius>
Also runs with pip's bpy module (python3 scripts/blender/export_layer.py -- --blend <layer.blend> --out ...).
"""
import argparse
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--blend")
a = ap.parse_args(argv)
if a.blend:
    bpy.ops.wm.open_mainfile(filepath=a.blend)
layer = bpy.data.collections.get("Layer")
if layer is None:
    sys.exit("no 'Layer' collection: start the file with scripts/blender/new_layer.py")
for ob in bpy.context.scene.objects:
    ob.hide_select = False
    ob.select_set(False)
for ob in layer.all_objects:
    ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=a.out, use_selection=True, export_apply=True, export_image_format="AUTO")
print(f"wrote {a.out}: {len(layer.all_objects)} objects")
