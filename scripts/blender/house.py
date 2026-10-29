"""A house from a spec, built and rendered in Blender: the first Blender trial.

    blender --background --python scripts/blender/house.py -- --spec <house.json> --out <render.png>
        [--samples 128] [--res 1920x1080] [--cpu] [--view street|corner|aerial] [--export <house.glb>]

It builds a single-storey WA house on its block from the spec (sizes, cladding and colours, roof,
garage, windows, front door, front hedge, trees, driveway), with the verge, footpath, kerb and road
out the front, lights it with a sun and sky, and renders a still with Cycles (on the GPU with OptiX
when there is one, else CUDA, else the CPU). --export also writes the house as glTF, for the later
step of putting it into AC.

The spec is a JSON file; anything left out takes the default in DEFAULTS below. A particular real
house's spec is private (routes/private/), so this script holds no place or address. Example:
scripts/blender/example_house.json.

Also runs with Blender's Python module (pip install bpy==5.2.3): python3 scripts/blender/house.py -- ...
"""
import argparse
import json
import math
import sys

import bpy  # first: with the pip module, bmesh only exists once bpy is loaded
import bmesh
from mathutils import Vector

DEFAULTS = {
    # The house: width along the street, depth back from it, metres; ground to the top of the walls.
    "width": 15.0,
    "depth": 13.0,
    "wallHeight": 2.7,
    # Front of the house to the front boundary, metres.
    "setback": 6.5,
    "walls": {"kind": "weatherboard", "colour": "#5f7f9a", "lap": 0.15},
    # Below the cladding: a band of render or brick at the base, metres high (0 for none).
    "plinth": {"height": 0.45, "colour": "#d9d4c8"},
    "trim": "#f2f1ec",
    "roof": {"type": "hip", "pitch": 24, "colour": "#3b3d40", "eaves": 0.45},
    # Double garage at the front, on the "left" or "right" as seen from the street.
    "garage": {"side": "left", "width": 5.6, "colour": "#a9a8a2"},
    "door": {"colour": "#2f3a44"},
    # Windows across the front (besides the garage), and down each side.
    "windows": {"front": 2, "side": 3, "width": 1.6, "height": 1.4},
    "hedge": {"height": 1.8, "depth": 0.9, "colour": "#3d5a2a"},
    "trees": [{"x": 3.5, "y": -3.0, "height": 6.5, "spread": 4.5}],
    "lawn": "#7a8a4a",
    "driveway": "#bdb7aa",
    "road": {"width": 7.0, "verge": 3.2},
}


def merged(spec):
    out = json.loads(json.dumps(DEFAULTS))
    for k, v in spec.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        else:
            out[k] = v
    return out


def rgb(hex_colour):
    h = hex_colour.lstrip("#")
    srgb = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    # Blender's colour inputs are linear.
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in srgb) + (1.0,)


# ---------------------------------------------------------------- materials

def material(name, colour, rough=0.6, metal=0.0, bump=None, noise=0.0):
    """A Principled material; `bump` is ('bands', spacing) for laps or ('noise', scale) for texture."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = rgb(colour)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    coord = nt.nodes.new("ShaderNodeTexCoord")
    if noise > 0:
        # A little colour variation so big flat areas don't look printed.
        tex = nt.nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = 3.0
        nt.links.new(coord.outputs["Object"], tex.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.inputs["Factor"].default_value = noise
        mix.inputs["A"].default_value = rgb(colour)
        dark = [c * 0.75 for c in rgb(colour)[:3]] + [1.0]
        mix.inputs["B"].default_value = dark
        nt.links.new(tex.outputs["Fac"], mix.inputs["Factor"])
        nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    if bump:
        kind, scale = bump
        b = nt.nodes.new("ShaderNodeBump")
        if kind == "bands":
            # Weatherboard laps: a sawtooth in height, one tooth per board.
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            nt.links.new(coord.outputs["Object"], sep.inputs["Vector"])
            div = nt.nodes.new("ShaderNodeMath")
            div.operation = "DIVIDE"
            div.inputs[1].default_value = scale
            nt.links.new(sep.outputs["Z"], div.inputs[0])
            frac = nt.nodes.new("ShaderNodeMath")
            frac.operation = "FRACT"
            nt.links.new(div.outputs[0], frac.inputs[0])
            b.inputs["Strength"].default_value = 0.6
            b.inputs["Distance"].default_value = 0.02
            nt.links.new(frac.outputs[0], b.inputs["Height"])
        else:
            tex = nt.nodes.new("ShaderNodeTexNoise")
            tex.inputs["Scale"].default_value = scale
            tex.inputs["Detail"].default_value = 8
            nt.links.new(coord.outputs["Object"], tex.inputs["Vector"])
            b.inputs["Strength"].default_value = 0.5
            nt.links.new(tex.outputs["Fac"], b.inputs["Height"])
        nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return m


# ---------------------------------------------------------------- geometry

def obj_from_bmesh(name, bm, mat, collection):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.data.materials.append(mat)
    collection.objects.link(ob)
    return ob


def box(name, x0, y0, z0, x1, y1, z1, mat, collection):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((x0 if v.co.x < 0 else x1, y0 if v.co.y < 0 else y1, z0 if v.co.z < 0 else z1))
    return obj_from_bmesh(name, bm, mat, collection)


def hip_roof(name, x0, y0, x1, y1, z, pitch_deg, mat, collection, kind="hip"):
    """A hip (or gable) roof over the rectangle, ridge along the longer side; eaves already included."""
    w, d = x1 - x0, y1 - y0
    t = math.tan(math.radians(pitch_deg))
    bm = bmesh.new()
    if w >= d:
        h = d / 2 * t
        inset = d / 2 if kind == "hip" else 0.0
        r0 = bm.verts.new((x0 + inset, (y0 + y1) / 2, z + h))
        r1 = bm.verts.new((x1 - inset, (y0 + y1) / 2, z + h))
        a, b, c, e = (bm.verts.new(p) for p in [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)])
        bm.faces.new((a, b, r1, r0))
        bm.faces.new((c, e, r0, r1))
        if kind == "hip":  # a gable's ends are walls, not roof
            bm.faces.new((b, c, r1))
            bm.faces.new((e, a, r0))
    else:
        h = w / 2 * t
        inset = w / 2 if kind == "hip" else 0.0
        r0 = bm.verts.new(((x0 + x1) / 2, y0 + inset, z + h))
        r1 = bm.verts.new(((x0 + x1) / 2, y1 - inset, z + h))
        a, b, c, e = (bm.verts.new(p) for p in [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)])
        bm.faces.new((b, c, r1, r0))
        bm.faces.new((e, a, r0, r1))
        if kind == "hip":
            bm.faces.new((a, b, r0))
            bm.faces.new((c, e, r1))
    # Underside (the eaves' soffit) so the roof isn't see-through from below.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj_from_bmesh(name, bm, mat, collection)
    sol = ob.modifiers.new("thickness", "SOLIDIFY")
    sol.thickness = 0.06
    return ob, h


def blob(name, centre, radius, mat, collection, squash=1.0, seed=0, detail=3):
    """A lumpy ball (tree canopy, shrub): an icosphere pushed about by noise."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=detail + 2, radius=radius)
    for v in bm.verts:
        v.co.z *= squash
    ob = obj_from_bmesh(name, bm, mat, collection)
    for f in ob.data.polygons:
        f.use_smooth = True
    ob.location = centre
    tex = bpy.data.textures.new(f"{name}_noise", "CLOUDS")
    tex.noise_scale = radius * 0.45
    tex.noise_depth = 2
    disp = ob.modifiers.new("lumps", "DISPLACE")
    disp.texture = tex
    disp.strength = radius * 0.35
    disp.mid_level = 0.5
    disp.texture_coords = "GLOBAL"
    ob.rotation_euler = (0, 0, seed * 1.3)
    return ob


# ---------------------------------------------------------------- the scene

def build(spec):
    s = merged(spec)
    scene = bpy.context.scene
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    house = bpy.data.collections.new("House")
    street = bpy.data.collections.new("Street")
    scene.collection.children.link(house)
    scene.collection.children.link(street)

    W, D, H = s["width"], s["depth"], s["wallHeight"]
    # The house sits with its front (facing the street) along y = 0, x from -W/2 to W/2; the street is
    # towards -y: front boundary at y = -setback, then verge, kerb and road.
    x0, x1, y0, y1 = -W / 2, W / 2, 0.0, D
    walls = s["walls"]
    lap = walls.get("lap", 0.15) if walls.get("kind") == "weatherboard" else 0
    m_wall = material("walls", walls["colour"], rough=0.55, bump=("bands", lap) if lap else ("noise", 40))
    m_plinth = material("plinth", s["plinth"]["colour"], rough=0.8, bump=("noise", 60))
    m_trim = material("trim", s["trim"], rough=0.4)
    # Colorbond is painted steel: a painted (not metallic) finish, or it mirrors the sky and reads white.
    m_roof = material("roof", s["roof"]["colour"], rough=0.45, metal=0.0, bump=("bands", 0.25))
    m_glass = material("glass", "#1c2328", rough=0.05, metal=0.2)
    m_garage = material("garage_door", s["garage"]["colour"], rough=0.45, metal=0.3, bump=("bands", 0.12))
    m_door = material("front_door", s["door"]["colour"], rough=0.5)
    m_hedge = material("hedge", s["hedge"]["colour"], rough=0.9, bump=("noise", 18), noise=0.5)
    m_leaf = material("leaves", "#4a6233", rough=0.85, bump=("noise", 12), noise=0.6)
    m_bark = material("bark", "#6b5d4f", rough=0.95, bump=("noise", 25))
    m_lawn = material("lawn", s["lawn"], rough=0.95, bump=("noise", 80), noise=0.5)
    m_concrete = material("concrete", s["driveway"], rough=0.85, bump=("noise", 50), noise=0.2)
    m_asphalt = material("asphalt", "#3a3b3d", rough=0.9, bump=("noise", 90), noise=0.3)
    m_kerb = material("kerb", "#c9c6bd", rough=0.8)

    plinth = s["plinth"]["height"]
    if plinth > 0:
        box("plinth", x0, y0, 0, x1, y1, plinth, m_plinth, house)
    box("walls", x0, y0, plinth, x1, y1, H, m_wall, house)

    # Roof with eaves, a fascia under its edge.
    roof = s["roof"]
    ev = roof.get("eaves", 0.45)
    hip_roof("roof", x0 - ev, y0 - ev, x1 + ev, y1 + ev, H, roof.get("pitch", 24), m_roof, house, roof.get("type", "hip"))
    box("fascia_front", x0 - ev, y0 - ev - 0.02, H - 0.2, x1 + ev, y0 - ev + 0.03, H, m_trim, house)
    box("fascia_back", x0 - ev, y1 + ev - 0.03, H - 0.2, x1 + ev, y1 + ev + 0.02, H, m_trim, house)
    box("fascia_left", x0 - ev - 0.02, y0 - ev, H - 0.2, x0 - ev + 0.03, y1 + ev, H, m_trim, house)
    box("fascia_right", x1 + ev - 0.03, y0 - ev, H - 0.2, x1 + ev + 0.02, y1 + ev, H, m_trim, house)
    box("soffit", x0 - ev, y0 - ev, H - 0.02, x1 + ev, y1 + ev, H, m_trim, house)

    # Garage at the front, door recessed a touch, with a trim frame.
    g = s["garage"]
    gw = g["width"]
    gx0, gx1 = (x0 + 0.4, x0 + 0.4 + gw) if g["side"] == "left" else (x1 - 0.4 - gw, x1 - 0.4)
    box("garage_door", gx0 + 0.2, y0 - 0.02, 0, gx1 - 0.2, y0 + 0.05, 2.25, m_garage, house)
    box("garage_head", gx0, y0 - 0.06, 2.25, gx1, y0 + 0.02, 2.4, m_trim, house)

    # Front door with a small porch slab; windows across the rest of the front and down the sides.
    rest0, rest1 = (gx1 + 0.6, x1 - 0.6) if g["side"] == "left" else (x0 + 0.6, gx0 - 0.6)
    dx = rest0 + 1.2 if g["side"] == "left" else rest1 - 2.2
    box("front_door", dx, y0 - 0.04, 0.15, dx + 1.0, y0 + 0.02, 2.2, m_door, house)
    box("door_frame", dx - 0.08, y0 - 0.05, 0.15, dx + 1.08, y0 - 0.03, 2.28, m_trim, house)
    box("porch", dx - 0.8, y0 - 1.6, 0, dx + 1.8, y0, 0.15, m_concrete, house)
    win = s["windows"]
    ww, wh, sill = win["width"], win["height"], 0.95

    def window(name, cx, cy, along_x):
        """A window on a wall: a white frame round it, and the glass standing just proud of the frame."""
        def at(half_in_plane, half_out):
            hx, hy = (half_in_plane, half_out) if along_x else (half_out, half_in_plane)
            return cx - hx, cy - hy, cx + hx, cy + hy
        fx0, fy0, fx1, fy1 = at(ww / 2 + 0.07, 0.06)
        box(name + "_frame", fx0, fy0, sill - 0.07, fx1, fy1, sill + wh + 0.07, m_trim, house)
        gx0, gy0, gx1, gy1 = at(ww / 2, 0.08)
        box(name, gx0, gy0, sill, gx1, gy1, sill + wh, m_glass, house)

    front_free = [x for x in [rest0 + (rest1 - rest0) * (k + 0.5) / max(1, win["front"]) for k in range(win["front"])]
                  if not (dx - 0.8 < x < dx + 1.8)]
    if not front_free and win["front"]:
        front_free = [rest1 - ww if g["side"] == "left" else rest0 + ww]
    for k, cx in enumerate(front_free):
        window(f"window_front_{k}", cx, y0, True)
    for k in range(win["side"]):
        cy = 1.5 + (D - 3.0) * (k + 0.5) / win["side"]
        window(f"window_left_{k}", x0, cy, False)
        window(f"window_right_{k}", x1, cy, False)

    # The block: lawn, driveway from the garage to the road, front hedge along the boundary (with a
    # gap for the driveway and the path), trees.
    road = s["road"]
    sb = s["setback"]
    yb = y0 - sb  # front boundary
    yk = yb - road["verge"]  # kerb line
    box("lawn", x0 - 4, yb, -0.05, x1 + 4, y1 + 6, 0.0, m_lawn, street)
    box("driveway", gx0, yk, 0.0, gx1, y0, 0.03, m_concrete, street)
    box("path", dx - 0.1, yb, 0.0, dx + 1.1, y0 - 1.6, 0.03, m_concrete, street)
    hd = s["hedge"]
    if hd and hd.get("height", 0) > 0:
        spans = sorted([(gx0 - 0.3, gx1 + 0.3), (dx - 0.4, dx + 1.4)])
        a = x0 - 4
        for k, (g0, g1) in enumerate(spans + [(x1 + 4, x1 + 4)]):
            if g0 - a > 2.0:  # shorter stubs between the gaps look like cubes, not hedge
                h = box(f"hedge_{k}", a, yb, 0, g0, yb + hd["depth"], hd["height"], m_hedge, street)
                # Rounded and leafy, not a brick.
                bev = h.modifiers.new("round", "BEVEL")
                bev.width, bev.segments = min(0.2, hd["depth"] * 0.25), 3
                # Enough faces for the displacement to make leafy bumps, without rounding it into a sausage.
                rem = h.modifiers.new("dense", "REMESH")
                rem.mode, rem.voxel_size = "VOXEL", 0.08
                tex = bpy.data.textures.new(f"hedge_noise_{k}", "CLOUDS")
                tex.noise_scale, tex.noise_depth = 0.18, 3
                disp = h.modifiers.new("leafy", "DISPLACE")
                disp.texture, disp.strength, disp.texture_coords = tex, 0.12, "GLOBAL"
            a = g1
    for k, t in enumerate(s["trees"]):
        tx, ty, th, spread = t["x"], y0 + t["y"], t["height"], t.get("spread", t["height"] * 0.7)
        trunk = bmesh.new()
        bmesh.ops.create_cone(trunk, cap_ends=True, segments=10, radius1=0.18, radius2=0.11, depth=th * 0.6)
        tr = obj_from_bmesh(f"trunk_{k}", trunk, m_bark, street)
        tr.location = (tx, ty, th * 0.3)
        for j, (ox, oy, oz, r) in enumerate([(0, 0, 0.72, 0.5), (0.3, 0.2, 0.62, 0.38), (-0.32, -0.1, 0.6, 0.36), (0.05, -0.3, 0.82, 0.32)]):
            blob(f"canopy_{k}_{j}", (tx + ox * spread, ty + oy * spread, th * oz), spread * r, m_leaf, street, squash=0.8, seed=j)

    # The street: verge, footpath, kerb, road, and a neighbour's hedge line across the road for depth.
    box("verge", x0 - 30, yk, -0.05, x1 + 30, yb, 0.0, m_lawn, street)
    box("footpath", x0 - 30, yb + 0.2 - 1.8 - 0.4, 0.0, x1 + 30, yb - 0.4, 0.04, m_concrete, street)
    box("kerb", x0 - 30, yk - 0.3, -0.2, x1 + 30, yk, 0.12, m_kerb, street)
    box("road", x0 - 30, yk - 0.3 - road["width"], -0.2, x1 + 30, yk - 0.3, 0.0, m_asphalt, street)
    box("far_verge", x0 - 30, yk - 0.3 - road["width"] - 10, -0.2, x1 + 30, yk - 0.3 - road["width"], 0.12, m_lawn, street)
    # Ground out to the horizon, so no view runs off the edge of the world.
    box("ground", -400, -400, -0.3, 400, 400, -0.06, m_lawn, street)
    return s, (x0, y0, x1, y1, yk)


# ---------------------------------------------------------------- parts mode: a house of several blocks

def leafy(ob, k, depth):
    """Round and leafy, not a brick (hedges)."""
    bev = ob.modifiers.new("round", "BEVEL")
    bev.width, bev.segments = min(0.2, depth * 0.25), 3
    rem = ob.modifiers.new("dense", "REMESH")
    rem.mode, rem.voxel_size = "VOXEL", 0.08
    tex = bpy.data.textures.new(f"hedge_noise_{k}", "CLOUDS")
    tex.noise_scale, tex.noise_depth = 0.18, 3
    disp = ob.modifiers.new("leafy", "DISPLACE")
    disp.texture, disp.strength, disp.texture_coords = tex, 0.12, "GLOBAL"


def tree(k, tx, ty, th, spread, m_bark, m_leaf, coll):
    trunk = bmesh.new()
    bmesh.ops.create_cone(trunk, cap_ends=True, segments=10, radius1=0.16, radius2=0.1, depth=th * 0.6)
    tr = obj_from_bmesh(f"trunk_{k}", trunk, m_bark, coll)
    tr.location = (tx, ty, th * 0.3)
    for j, (ox, oy, oz, r) in enumerate([(0, 0, 0.72, 0.5), (0.3, 0.2, 0.62, 0.38), (-0.32, -0.1, 0.6, 0.36), (0.05, -0.3, 0.82, 0.32)]):
        blob(f"canopy_{k}_{j}", (tx + ox * spread, ty + oy * spread, th * oz), spread * r, m_leaf, coll, squash=0.8, seed=j)


def build_parts(spec):
    """A house made of blocks (each with its walls and its own hip or gable roof, which meet like a real
    roof when they share a pitch and eave height), with a gable end, a verandah, doors and windows where
    the spec puts them, fences, an outbuilding, hedges and trees, then the street.

    Coordinates in metres: x across the front, left to right as seen from the street; y back from the
    house's front-most wall (y = 0); the street is towards -y. See scripts/blender/example_parts.json."""
    s = merged(spec)
    scene = bpy.context.scene
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    house = bpy.data.collections.new("House")
    street = bpy.data.collections.new("Street")
    scene.collection.children.link(house)
    scene.collection.children.link(street)

    finishes = s.get("finishes", {})
    mats = {}

    def wall_mat(key):
        if key not in mats:
            f = finishes.get(key, s["walls"] if key == "main" else {"kind": "render", "colour": "#e8e8e5"})
            kind = f.get("kind", "render")
            bump = ("bands", f.get("lap", 0.15)) if kind == "weatherboard" else ("vbands", 0.15) if kind == "timber" else ("noise", 40)
            if bump[0] == "vbands":
                bump = ("noise", 25)
            mats[key] = material(f"wall_{key}", f["colour"], rough=0.6, bump=bump)
        return mats[key]

    m_trim = material("trim", s["trim"], rough=0.4)
    roof = s["roof"]
    m_roof = material("roof", roof["colour"], rough=0.45, metal=0.0, bump=("bands", 0.25))
    m_glass = material("glass", "#1c2328", rough=0.05, metal=0.2)
    m_hedge = material("hedge", s["hedge"]["colour"], rough=0.9, bump=("noise", 18), noise=0.5)
    m_leaf = material("leaves", "#4a6233", rough=0.85, bump=("noise", 12), noise=0.6)
    m_bark = material("bark", "#6b5d4f", rough=0.95, bump=("noise", 25))
    m_lawn = material("lawn", s["lawn"], rough=0.95, bump=("noise", 80), noise=0.5)
    m_concrete = material("concrete", s["driveway"], rough=0.85, bump=("noise", 50), noise=0.25)
    m_footpath = material("footpath", "#cfccc4", rough=0.85, bump=("noise", 50), noise=0.15)
    m_asphalt = material("asphalt", "#3a3b3d", rough=0.9, bump=("noise", 90), noise=0.3)
    m_kerb = material("kerb", "#c9c6bd", rough=0.8)
    m_deck = material("deck", "#8a6a4f", rough=0.7, bump=("bands", 0.14), noise=0.3)

    pitch, ev = roof.get("pitch", 24), roof.get("eaves", 0.45)
    xs, ys = [], []
    for b in s["blocks"]:
        H = b.get("wallHeight", s["wallHeight"])
        x0, x1, y0, y1 = b["x0"], b["x1"], b["y0"], b["y1"]
        xs += [x0, x1]
        ys += [y0, y1]
        box(f"walls_{b['name']}", x0, y0, 0, x1, y1, H, wall_mat(b.get("walls", "main")), house)
        if b.get("roof", "hip") == "none":
            continue
        rm = material(f"roof_{b['name']}", b["roofColour"], rough=0.45, bump=("bands", 0.25)) if b.get("roofColour") else m_roof
        bev = b.get("eaves", ev)
        kind = b.get("roof", "hip")
        _, rise = hip_roof(f"roof_{b['name']}", x0 - bev, y0 - bev, x1 + bev, y1 + bev, H, b.get("pitch", pitch), rm, house, kind)
        box(f"soffit_{b['name']}", x0 - bev, y0 - bev, H - 0.02, x1 + bev, y1 + bev, H, m_trim, house)
        for nm, (a0, b0, a1, b1) in {"f": (x0 - bev, y0 - bev - 0.02, x1 + bev, y0 - bev + 0.03), "b": (x0 - bev, y1 + bev - 0.03, x1 + bev, y1 + bev + 0.02),
                                     "l": (x0 - bev - 0.02, y0 - bev, x0 - bev + 0.03, y1 + bev), "r": (x1 + bev - 0.03, y0 - bev, x1 + bev + 0.02, y1 + bev)}.items():
            box(f"fascia_{b['name']}_{nm}", a0, b0, H - 0.2, a1, b1, H, m_trim, house)
        if kind == "gable":
            # Fill the gable ends with the block's walls, and white barge boards along the rakes.
            w, d = x1 - x0, y1 - y0
            along_y = d > w
            for end in (0, 1):
                bm = bmesh.new()
                if along_y:
                    yy = (y0, y1)[end]
                    pts = [(x0, yy, H), (x1, yy, H), ((x0 + x1) / 2, yy, H + w / 2 * math.tan(math.radians(b.get("pitch", pitch))))]
                else:
                    xx = (x0, x1)[end]
                    pts = [(xx, y0, H), (xx, y1, H), (xx, (y0 + y1) / 2, H + d / 2 * math.tan(math.radians(b.get("pitch", pitch))))]
                bm.faces.new([bm.verts.new(p) for p in pts])
                g = obj_from_bmesh(f"gable_{b['name']}_{end}", bm, wall_mat(b.get("walls", "main")), house)
                g.modifiers.new("thick", "SOLIDIFY").thickness = 0.05
            if along_y:
                half = (x1 - x0) / 2 + bev
                top = H + half * math.tan(math.radians(b.get("pitch", pitch)))
                cx = (x0 + x1) / 2
                for sgn in (-1, 1):
                    bm = bmesh.new()
                    p0, p1 = Vector((cx + sgn * half, y0 - bev - 0.03, H - 0.05)), Vector((cx, y0 - bev - 0.03, top))
                    bmesh.ops.create_cube(bm, size=1.0)
                    ob = obj_from_bmesh(f"barge_{b['name']}_{sgn}", bm, m_trim, house)
                    ob.location = (p0 + p1) / 2
                    ob.scale = ((p1 - p0).length, 0.06, 0.22)
                    ob.rotation_euler = (0, -math.atan2(p1.z - p0.z, p1.x - p0.x), 0)

    # Wall panels in another finish (a strip of cladding by the door, say).
    for k, pn in enumerate(s.get("panels", [])):
        box(f"panel_{k}", pn["x0"], pn["y0"], pn.get("z0", 0), pn["x1"], pn["y1"], pn.get("z1", s["wallHeight"]), wall_mat(pn["walls"]), house)

    # Verandah: deck, posts and a skillion roof off the wall.
    for k, v in enumerate(s.get("verandahs", [])):
        H = v.get("wallHeight", s["wallHeight"])
        lo = v.get("height", H - 0.25)
        box(f"deck_{k}", v["x0"], v["y0"], 0, v["x1"], v["y1"], v.get("deckHeight", 0.25), m_deck, house)
        for j, px in enumerate(v.get("posts", [])):
            box(f"post_{k}_{j}", px - 0.06, v["y0"] + 0.1, 0, px + 0.06, v["y0"] + 0.22, lo, m_trim, house)
        box(f"beam_{k}", v["x0"], v["y0"] + 0.08, lo - 0.18, v["x1"], v["y0"] + 0.24, lo, m_trim, house)
        bm = bmesh.new()
        a, b2, c, d = (bm.verts.new(p) for p in [(v["x0"], v["y0"] - 0.2, lo), (v["x1"], v["y0"] - 0.2, lo), (v["x1"], v["y1"], H + 0.15), (v["x0"], v["y1"], H + 0.15)])
        bm.faces.new((a, b2, c, d))
        vr = obj_from_bmesh(f"verandah_roof_{k}", bm, m_roof, house)
        vr.modifiers.new("thick", "SOLIDIFY").thickness = 0.05

    # Doors: garage (sectional, in a frame), front, roller (outbuildings). On a wall facing the street.
    for k, d in enumerate(s.get("doors", [])):
        y, z1 = d["y"], d.get("height", 2.3 if d["type"] != "front" else 2.2)
        col = d.get("colour", "#ecebe6" if d["type"] == "garage" else "#2f2b28")
        m = material(f"door_{k}", col, rough=0.45, bump=("bands", 0.5 if d["type"] == "garage" else 0.1) if d["type"] != "front" else None)
        z0 = d.get("z0", 0.0 if d["type"] != "front" else 0.25)
        box(f"door_{k}", d["x0"], y - 0.04, z0, d["x1"], y + 0.02, z1, m, house)
        if d["type"] == "front":
            box(f"door_{k}_glass", d["x0"] + 0.1, y - 0.05, z0 + 0.2, d["x0"] + 0.25, y - 0.03, z1 - 0.2, m_glass, house)
        box(f"door_{k}_head", d["x0"] - 0.06, y - 0.06, z1, d["x1"] + 0.06, y + 0.02, z1 + 0.08, m_trim, house)

    # Windows: centre x (front/back) or y (sides), facing the street ("front"), "left", "right" or "back".
    for k, w in enumerate(s.get("windows", [])):
        ww, wh, sill = w.get("width", 1.4), w.get("height", 1.4), w.get("sill", 0.9)
        along_x = w["facing"] in ("front", "back")
        cx, cy = (w["at"], w["wall"]) if along_x else (w["wall"], w["at"])
        def at(half_in, half_out):
            hx, hy = (half_in, half_out) if along_x else (half_out, half_in)
            return cx - hx, cy - hy, cx + hx, cy + hy
        f0, f1, f2, f3 = at(ww / 2 + 0.07, 0.06)
        box(f"window_{k}_frame", f0, f1, sill - 0.07, f2, f3, sill + wh + 0.07, m_trim, house)
        g0, g1, g2, g3 = at(ww / 2, 0.08)
        box(f"window_{k}", g0, g1, sill, g2, g3, sill + wh, m_glass, house)

    # The block and the street.
    road = s["road"]
    yb = -s["setback"]
    yk = yb - road["verge"]
    X0, X1 = min(xs) - 6, max(xs) + 6
    box("lawn", X0, yb, -0.05, X1, max(ys) + 10, 0.0, m_lawn, street)
    for k, dr in enumerate(s.get("driveways", [])):
        box(f"driveway_{k}", dr["x0"], yk, 0.0, dr["x1"], dr.get("y1", 0), 0.03, m_concrete, street)
    for k, f in enumerate(s.get("fences", [])):
        m = material(f"fence_{k}", f.get("colour", "#ecebe6"), rough=0.4, bump=("bands", 0.08))
        box(f"fence_{k}", f["x0"], f["y0"], 0, f["x1"], f["y1"], f.get("height", 1.8), m, street)
    for k, hd in enumerate(s.get("hedges", [])):
        h = box(f"hedge_{k}", hd["x0"], hd["y0"], 0, hd["x1"], hd["y0"] + hd.get("depth", 0.9), hd.get("height", 1.2), m_hedge, street)
        leafy(h, k, hd.get("depth", 0.9))
    for k, t in enumerate(s["trees"]):
        tree(k, t["x"], t["y"], t["height"], t.get("spread", t["height"] * 0.7), m_bark, m_leaf, street)
    box("verge", X0 - 30, yk, -0.05, X1 + 30, yb, 0.0, m_lawn, street)
    box("footpath", X0 - 30, yb - 2.0, 0.0, X1 + 30, yb - 0.4, 0.04, m_footpath, street)
    box("kerb", X0 - 30, yk - 0.3, -0.2, X1 + 30, yk, 0.12, m_kerb, street)
    box("road", X0 - 30, yk - 0.3 - road["width"], -0.2, X1 + 30, yk - 0.3, 0.0, m_asphalt, street)
    box("far_verge", X0 - 30, yk - 0.3 - road["width"] - 10, -0.2, X1 + 30, yk - 0.3 - road["width"], 0.12, m_lawn, street)
    box("ground", -400, -400, -0.3, 400, 400, -0.06, m_lawn, street)
    return s, (min(xs), 0.0, max(xs), max(ys), yk)


def lights_and_camera(view, bounds, res, sun_from=None):
    x0, y0, x1, y1, yk = bounds
    scene = bpy.context.scene
    world = bpy.data.worlds.new("sky")
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    bg = nt.nodes["Background"]
    sky = nt.nodes.new("ShaderNodeTexSky")
    for kind in ("MULTIPLE_SCATTERING", "NISHITA", "HOSEK_WILKIE"):
        try:
            sky.sky_type = kind
            break
        except TypeError:
            continue
    # Mid-morning Busselton sun: from the north-east (the street is to the south here), 40 degrees up.
    for attr, val in (("sun_elevation", math.radians(40)), ("sun_rotation", math.radians(35))):
        if hasattr(sky, attr):
            setattr(sky, attr, val)
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = 0.35
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.2
    sun_data.angle = math.radians(1.5)
    sun = bpy.data.objects.new("sun", sun_data)
    # Where the sun comes from (x right along the street, y back from it, z up): from the spec, or
    # high and to the front left by default.
    frm = Vector(sun_from or (-0.5, -0.8, 1.1)).normalized()
    sun.rotation_euler = (-frm).to_track_quat("-Z", "Y").to_euler()
    scene.collection.objects.link(sun)

    cam_data = bpy.data.cameras.new("camera")
    cam_data.lens = 24
    cam = bpy.data.objects.new("camera", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cx = (x0 + x1) / 2
    road_mid = yk - 4
    eye, look = {
        "street": ((cx + 4, road_mid, 1.6), (cx, (y0 + y1) / 3, 1.8)),
        "corner": ((x1 + 9, road_mid, 1.7), (cx, y0 + 2, 1.8)),
        "aerial": ((x1 + 14, road_mid - 10, 14), (cx, y0 + 4, 0.5)),
    }[view]
    cam.location = eye
    direction = Vector(look) - Vector(eye)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    w, h = res
    scene.render.resolution_x, scene.render.resolution_y = w, h
    # A touch darker than Blender's default: the first test came out washed out in the WA sun.
    scene.view_settings.exposure = -1.0


def render_settings(samples, cpu):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    used = "CPU"
    if not cpu:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for backend in ("OPTIX", "CUDA", "HIP", "ONEAPI", "METAL"):
            try:
                prefs.compute_device_type = backend
                prefs.get_devices()
                gpus = [d for d in prefs.devices if d.type == backend]
                if gpus:
                    for d in prefs.devices:
                        d.use = d.type == backend
                    scene.cycles.device = "GPU"
                    used = f"GPU ({backend}: {', '.join(d.name for d in gpus)})"
                    break
            except (TypeError, ValueError):
                continue
    print(f"rendering on {used}, {samples} samples")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--samples", type=int, default=128)
    ap.add_argument("--res", default="1920x1080")
    ap.add_argument("--cpu", action="store_true")
    ap.add_argument("--view", default="street", choices=["street", "corner", "aerial"])
    ap.add_argument("--export")
    a = ap.parse_args(argv)
    spec = json.load(open(a.spec, encoding="utf-8"))
    spec = spec.get("blender", spec)
    s, bounds = build_parts(spec) if "blocks" in spec else build(spec)
    lights_and_camera(a.view, bounds, tuple(int(v) for v in a.res.lower().split("x")), spec.get("sunFrom"))
    render_settings(a.samples, a.cpu)
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.filepath = a.out
    bpy.ops.render.render(write_still=True)
    print(f"wrote {a.out}")
    if a.export:
        for ob in bpy.data.objects:
            ob.select_set(ob.name in bpy.data.collections["House"].objects)
        bpy.ops.export_scene.gltf(filepath=a.export, use_selection=True, export_apply=True)
        print(f"wrote {a.export}")


if __name__ == "__main__":
    main()
