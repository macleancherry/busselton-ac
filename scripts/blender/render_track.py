"""Renders the views planned by scripts/blender/render_track.ts with Cycles.

    blender --background --factory-startup --python scripts/blender/render_track.py -- <plan.json>
    python scripts/blender/render_track.py -- <plan.json>        (a Python with the bpy module)

plan.json: {"out": dir, "samples": n, "res": [w, h], "groups": [{"glbs": [...], "views": [
{"name", "eye": [x, y, z], "target": [x, y, z], "lens"}]}]}, local metres (x east, y north, z up),
which is how Blender's glTF importer places kn5ToGlb's AC coordinates.

What the importer gets wrong for a track, put right here:
  - Tree and shrub cards: alpha-tested textures are cut out by their alpha (also any texture with
    real holes that the kn5 didn't flag), and Cycles gets enough transparent bounces that stacked
    cards don't turn into dark blocks.
  - The sea: its material becomes water (dark, glossy, rippled, reflecting the sky) instead of a
    flat painted ground.
"""
import json
import math
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

SUN = (0.25, 0.55, 0.8)  # towards the sun: high in the north, as at midday in WA


def args():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def has_holes(image, cache):
    """True if the image's alpha has real cut-outs (some fully clear, some solid)."""
    if image.name in cache:
        return cache[image.name]
    ok = False
    if image.channels == 4 and image.size[0] > 0:
        px = np.empty(image.size[0] * image.size[1] * 4, dtype=np.float32)
        image.pixels.foreach_get(px)
        a = px[3::4]
        ok = bool(a.min() < 0.1 and a.max() > 0.9 and 0.02 < a.mean() < 0.95)
    cache[image.name] = ok
    return ok


def fix_cutouts(mat, cache):
    """Alpha-tested cards: the texture's alpha, clipped at 0.5, into the BSDF's alpha."""
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)
    tex = next((n for n in nt.nodes if n.bl_idname == "ShaderNodeTexImage" and n.image), None)
    if not bsdf or not tex:
        return False
    alpha_linked = bsdf.inputs["Alpha"].is_linked
    if not alpha_linked and not has_holes(tex.image, cache):
        return False
    if not alpha_linked:
        clip = nt.nodes.new("ShaderNodeMath")
        clip.operation = "GREATER_THAN"
        clip.inputs[1].default_value = 0.5
        nt.links.new(tex.outputs["Alpha"], clip.inputs[0])
        nt.links.new(clip.outputs[0], bsdf.inputs["Alpha"])
    tex.image.alpha_mode = "CHANNEL_PACKED"
    if hasattr(mat, "surface_render_method"):
        mat.surface_render_method = "DITHERED"
    elif hasattr(mat, "blend_method"):
        mat.blend_method = "CLIP"
    if hasattr(mat, "use_transparent_shadow"):
        mat.use_transparent_shadow = True
    # Leaves aren't shiny.
    bsdf.inputs["Roughness"].default_value = 0.9
    return True


def make_water(mat):
    """The sea: deep blue-green, glossy, with small waves, reflecting the sky."""
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.01, 0.1, 0.12, 1)
    bsdf.inputs["Roughness"].default_value = 0.1
    bsdf.inputs["IOR"].default_value = 1.33
    coords = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (0.6, 1.0, 0.6)
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.5
    noise.inputs["Detail"].default_value = 6.0
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.inputs["Scale"].default_value = 0.4
    wave.inputs["Distortion"].default_value = 6.0
    mix = nt.nodes.new("ShaderNodeMath")
    mix.operation = "ADD"
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.5
    bump.inputs["Distance"].default_value = 0.3
    nt.links.new(coords.outputs["Object"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], wave.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], mix.inputs[0])
    nt.links.new(wave.outputs["Fac"], mix.inputs[1])
    nt.links.new(mix.outputs[0], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])


def fix_materials():
    cache, cut, water = {}, [], []
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        base = mat.name.split(".")[0].lower()
        if base == "sea" or base.startswith("sea_"):
            make_water(mat)
            water.append(mat.name)
        elif fix_cutouts(mat, cache):
            cut.append(mat.name)
    print(f"cut-out materials: {', '.join(sorted(set(m.split('.')[0] for m in cut))) or 'none'}; water: {', '.join(water) or 'none'}")


def setup_scene(samples, res):
    scene = bpy.context.scene
    world = bpy.data.worlds.new("sky")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    coords = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = (0.62, 0.74, 0.88, 1)  # pale at the horizon
    ramp.color_ramp.elements[1].position = 0.6
    ramp.color_ramp.elements[1].color = (0.18, 0.38, 0.78, 1)  # deeper blue overhead
    nt.links.new(coords.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 1.0
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    ld = bpy.data.lights.new("sun", "SUN")
    ld.energy = 4.5
    ld.angle = math.radians(1.0)
    ld.color = (1.0, 0.97, 0.92)
    sun = bpy.data.objects.new("sun", ld)
    scene.collection.objects.link(sun)
    sun.rotation_euler = Vector(SUN).normalized().to_track_quat("Z", "Y").to_euler()

    scene.render.engine = "CYCLES"
    c = scene.cycles
    c.device = "CPU"
    c.samples = samples
    c.use_adaptive_sampling = True
    c.adaptive_threshold = 0.05
    c.use_denoising = True
    c.max_bounces = 4
    c.diffuse_bounces = 2
    c.glossy_bounces = 2
    c.transmission_bounces = 2
    c.volume_bounces = 0
    c.transparent_max_bounces = 32  # stacked tree cards go black when this runs out
    c.caustics_reflective = False
    c.caustics_refractive = False
    if hasattr(c, "texture_limit_render"):
        c.texture_limit_render = "2048"
    scene.render.use_persistent_data = True
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.exposure = -0.3

    cd = bpy.data.cameras.new("cam")
    cd.clip_start = 0.1
    cd.clip_end = 3000
    cam = bpy.data.objects.new("cam", cd)
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


def main():
    plan = json.load(open(args()[0]))
    total = 0
    for g in plan["groups"]:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        t0 = time.time()
        for f in g["glbs"]:
            bpy.ops.import_scene.gltf(filepath=f)
        fix_materials()
        cam = setup_scene(plan["samples"], plan["res"])
        print(f"imported {len(g['glbs'])} files in {time.time() - t0:.0f} s")
        for v in g["views"]:
            t1 = time.time()
            cam.data.lens = v["lens"]
            cam.location = Vector(v["eye"])
            cam.rotation_euler = (Vector(v["target"]) - Vector(v["eye"])).to_track_quat("-Z", "Y").to_euler()
            path = f"{plan['out']}/{v['name']}.png"
            bpy.context.scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            total += 1
            print(f"wrote {path} in {time.time() - t1:.0f} s")
    print(f"rendered {total} views")


main()
