"""Rocky Ridge Brewing Co (10 Marine Tce): the vine pergola and festoon lights over the beer garden, as a
hand-made detail layer laid over the spec (routes/landmarks/rocky_ridge.json), not in place of it.

    python3 scripts/blender/landmarks/rocky_ridge_pergola.py -- --blend <layer.blend> [--spec-ref <lm glb>]
        [--render <out.png>] [--view street|garden|aerial|night] [--samples 16] [--res 960x540]

The whole chain is scripts/blender/landmarks/build.sh rocky_ridge_pergola. Its sidecar replaces nothing:
the spec house, its yard and its tree stay; this only adds to them.

What it models:
- a timber pergola against the front wall over the left half of the beer garden (where the spec had a
  green shade sail standing in for it): four posts on the paving, a front beam, a ledger on the wall and
  rafters at 0.9 m, with two old vine trunks twisting up the end posts
- the vine canopy: alpha cut-out leaf cards (one generated 512 px leaf texture, top half clumps, bottom
  half hanging trails) lying over the rafters and trailing off the front beam
- festoon light strings: three under the rafters, out from the pergola and the front wall to three timber
  poles along the front rail over the right of the garden, and along the side passage under the sails.
  Bulbs are small separate meshes with their own material (festoon_bulb), so CSP can make them glow at
  night (the ext_config lines are in the module's NIGHT_CONFIG and in the report).

Physics: the posts and poles only, as 1WALL_rr_posts. Everything else is visual.

Spec frame (as the spec): x metres left to right as seen from Marine Terrace, y back from the front wall
(the garden is y < 0), z up from the spec's slab. Placed exactly as src/core/track.ts places the spec:
its main blocks' centre on looks.json's "at", the front facing 345 degrees.
"""
import argparse
import math
import os
import random
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

ORIGIN = (115.3403, -33.6506)          # routes/busselton.json build.origin
AT = (115.342594, -33.647256)          # routes/landmarks/looks.json, Rocky Ridge "at"
FACING = 345.0                         # its "facing"
SPEC_CENTRE = (6.45, 10.0)             # middle of the spec's main blocks (house, back, extension)
SLAB_Z = 2.66                          # the spec's slab height here (read off lm_rocky_ridge; see slab_z)

TIMBER = "#6e5038"
VINE_WOOD = "#54412f"
WIRE = "#1b1b1b"
BULB = "#f4e7c6"

# Pergola: posts along the front at y = FRONT, rafters from the wall out past the front beam.
X0, X1 = 0.25, 8.35
FRONT = -3.9
POSTS = [0.25, 2.95, 5.55, 8.35]
BEAM_TOP = 2.55          # front beam top (eaves fascia is about 2.9 to 3.1)
RAFTER_H = 0.17
LEAF_Z = BEAM_TOP + RAFTER_H

# Festoon poles along the front rail (x, y, top).
POLES = {"P1": (-0.55, -6.35, 3.3), "P2": (10.2, -6.3, 3.3), "P3": (15.45, -5.6, 3.3)}

NIGHT_CONFIG = """
[Material_DistantEmissive]
Materials = rocky_ridge_pergola_festoon_bulb

[MATERIAL_ADJUSTMENT_...]
ACTIVE = 1
DESCRIPTION = Rocky Ridge festoon bulbs glow at night
MATERIALS = rocky_ridge_pergola_festoon_bulb
CONDITION = NIGHT_SMOOTH
KEY_0 = ksEmissive
VALUE_0 = 255, 185, 105, 0.9
OFF_VALUE_0 = 0, 0, 0
"""


class Frame:
    def __init__(self, z0):
        p = C.Projection(ORIGIN)
        cx, cy = p.to_local(*AT)
        self.c = Vector((cx, cy, 0))
        a = math.radians(FACING)
        self.o = Vector((math.sin(a), math.cos(a), 0))      # towards the street
        self.t = Vector((-self.o.y, self.o.x, 0))            # spec +x
        self.z0 = z0

    def W(self, x, y, z):
        return self.c + self.t * (x - SPEC_CENTRE[0]) - self.o * (y - SPEC_CENTRE[1]) + Vector((0, 0, self.z0 + z))

    def dir(self, dx, dy, dz=0.0):
        return self.t * dx - self.o * dy + Vector((0, 0, dz))


def slab_z():
    """The spec's slab: its paving sits 0.03 above it. Falls back to SLAB_Z without the reference."""
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.name.startswith("SPECHOUSE_rocky_ridge") and ob.data.materials \
                and ob.data.materials[0].name.startswith("spec_rocky_ridge_paving"):
            return min((ob.matrix_world @ v.co).z for v in ob.data.vertices) - 0.03
    return SLAB_Z


def import_spec_ref(path):
    """The spec landmark (export_base.ts --layers) as more locked reference, for placing and renders."""
    if any(o.name.startswith("SPECHOUSE_rocky_ridge") for o in bpy.data.objects):
        return
    if not path or not os.path.exists(path):
        print(f"no spec reference at {path}: using SLAB_Z")
        return
    base = bpy.data.collections.get("Base (reference)")
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for ob in set(bpy.data.objects) - before:
        for c in ob.users_collection:
            c.objects.unlink(ob)
        base.objects.link(ob)
        ob.hide_select = True
    print(f"imported spec reference {path}")


# ---------------- the leaf texture ----------------

def leaf_image(seed=7):
    """RGBA leaf atlas, 1024 x 512: u 0..0.5 a round clump seen from above (square), u 0.5..0.75 and
    0.75..1 two trails hanging down (1:2, wide at the top, v = 1). Grape-like five-lobed leaves in mixed
    greens, sparser towards the rims so the card edges never show."""
    import numpy as np
    name = "rr_vine_leaves"
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    rng = np.random.default_rng(seed)
    Wd, Ht = 1024, 512
    img = np.zeros((Ht, Wd, 4), np.float32)
    yy, xx = np.mgrid[0:Ht, 0:Wd]

    def leaf(cx, cy, r, rot, col, box):
        bx0, by0, bx1, by1 = box
        x0, x1 = int(max(cx - r - 2, bx0)), int(min(cx + r + 2, bx1))
        y0, y1 = int(max(cy - r - 2, by0)), int(min(cy + r + 2, by1))
        if x1 <= x0 or y1 <= y0:
            return
        dx, dy = xx[y0:y1, x0:x1] - cx, yy[y0:y1, x0:x1] - cy
        d = np.hypot(dx, dy)
        phi = np.arctan2(dy, dx) - rot
        edge = r * (0.72 + 0.28 * np.abs(np.cos(2.5 * phi)) ** 0.7)
        m = d < edge
        vein = np.abs(np.sin(2.5 * (phi + math.pi / 5)))
        shade = (0.75 + 0.25 * (1 - d / r).clip(0, 1)) * (0.86 + 0.14 * vein) * (0.88 + 0.12 * np.cos(phi + rot - 0.8))
        reg = img[y0:y1, x0:x1]
        for k in range(3):
            reg[m, k] = col[k] * shade[m]
        reg[m, 3] = 1.0

    greens = [(0.36, 0.52, 0.20), (0.42, 0.58, 0.24), (0.30, 0.45, 0.17), (0.48, 0.62, 0.28), (0.33, 0.50, 0.25), (0.55, 0.62, 0.27)]

    def col():
        g = greens[rng.integers(len(greens))]
        j = rng.uniform(0.82, 1.12)
        return tuple(min(1.0, c * j) for c in g)

    # Clump: 512 x 512 on the left, leaves over a disc that fills it, thinning at the rim.
    R = 236
    for _ in range(620):
        a, rr = rng.uniform(0, 2 * math.pi), R * rng.random() ** 0.6
        r = rng.uniform(16, 28) * (1 - 0.3 * rr / R)
        cx, cy = 256 + rr * math.cos(a), 256 + rr * math.sin(a)
        if math.hypot(cx - 256, cy - 256) + r > 254:
            continue
        leaf(cx, cy, r, rng.uniform(0, 2 * math.pi), col(), (2, 2, 510, 510))
    # Trails: 256 x 512 columns, wide at the top (row 511), narrowing to a tip.
    for c0 in (512, 768):
        mid = c0 + 128
        for _ in range(5):                      # stems first, leaves over them
            x = mid + rng.normal(0, 22)
            ph = rng.uniform(0, 6)
            for k in range(int(Ht * rng.uniform(0.6, 0.95))):
                yv = Ht - 3 - k
                xv = int(x + 7 * math.sin(k * 0.06 + ph))
                if c0 + 2 <= xv < c0 + 253:
                    img[yv, xv:xv + 2] = (0.30, 0.31, 0.15, 1.0)
        for _ in range(300):
            f = rng.random() ** 0.9             # 0 at the top, 1 at the tip
            wid = 118 * (1 - 0.7 * f)
            cx = mid + rng.normal(0, wid * 0.42)
            cy = Ht - 8 - f * (Ht - 30)
            r = rng.uniform(13, 22) * (1 - 0.3 * f)
            if cx - r < c0 + 2 or cx + r > c0 + 254 or cy + r > Ht - 1 or cy - r < 2:
                continue
            leaf(cx, cy, r, rng.uniform(0, 2 * math.pi), col(), (c0 + 2, 2, c0 + 254, Ht - 1))
    im = bpy.data.images.new(name, Wd, Ht, alpha=True)
    im.pixels.foreach_set(img.ravel())
    im.file_format = "PNG"
    im.pack()
    return im


def leaf_material(im):
    m = bpy.data.materials.get("vine_leaf") or bpy.data.materials.new("vine_leaf")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type not in ("BSDF_PRINCIPLED", "OUTPUT_MATERIAL"):
            nt.nodes.remove(n)
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = im
    tex.interpolation = "Linear"
    rnd = nt.nodes.new("ShaderNodeMath")
    rnd.operation = "ROUND"               # glTF exporter: alpha through Round = alphaMode MASK, cutoff 0.5
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Alpha"], rnd.inputs[0])
    nt.links.new(rnd.outputs[0], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = 0.75
    return m


# ---------------- build ----------------

def catenary(a, b, sag, step=0.5):
    """Points from a to b sagging by `sag` at the middle, about `step` apart (both ends kept)."""
    a, b = Vector(a), Vector(b)
    n = max(2, int(round((b - a).length / step)))
    return [a.lerp(b, i / n) - Vector((0, 0, sag * 4 * (i / n) * (1 - i / n))) for i in range(n + 1)]


def bulb(b, mat, p):
    """A G45-ish globe hanging under the wire at p: a six-sided bicone, 12 triangles."""
    top, eq, bot = p + Vector((0, 0, -0.03)), p + Vector((0, 0, -0.075)), p + Vector((0, 0, -0.125))
    r = 0.03
    ring = [eq + Vector((r * math.cos(k * math.pi / 3), r * math.sin(k * math.pi / 3), 0)) for k in range(6)]
    verts = [top, bot] + ring
    faces = []
    for k in range(6):
        k2 = (k + 1) % 6
        faces.append((0, 2 + k2, 2 + k))
        faces.append((1, 2 + k, 2 + k2))
    b.add("rr_festoon_bulbs", mat, verts, faces)


def build(layer):
    F = Frame(slab_z())
    W = F.W
    print(f"slab z {F.z0:.2f}; pergola front-left at {tuple(round(c, 1) for c in W(X0, FRONT, 0))}")
    M = {
        "timber": C.material("pergola_timber", TIMBER, 0.85),
        "vine": C.material("vine_wood", VINE_WOOD, 0.9),
        "wire": C.material("festoon_wire", WIRE, 0.6),
        "bulb": C.material("festoon_bulb", BULB, 0.15),
    }
    b = C.Builder()
    rnd = random.Random(10)
    up = Vector((0, 0, 1))
    tx, ty = F.dir(1, 0), F.dir(0, 1)

    def beam(name, mat, p0, p1, w, h):
        """Rectangular timber from p0 to p1 (centreline), w wide, h deep (vertical)."""
        C.sweep(b, name, mat, [p0, p1], [(-h / 2, -w / 2), (h / 2, -w / 2), (h / 2, w / 2), (-h / 2, w / 2)], up=(0, 0, 1))

    # ---- pergola ----
    for x in POSTS:
        beam("1WALL_rr_posts", M["timber"], W(x, FRONT, 0.0), W(x, FRONT, BEAM_TOP - 0.02), 0.11, 0.11)
    # front beam (doubled look: one deep member), ledger on the wall
    beam("rr_pergola", M["timber"], W(X0 - 0.3, FRONT, BEAM_TOP - 0.12), W(X1 + 0.3, FRONT, BEAM_TOP - 0.12), 0.09, 0.24)
    beam("rr_pergola", M["timber"], W(X0 - 0.1, -0.06, BEAM_TOP + RAFTER_H - 0.1), W(X1 + 0.1, -0.06, BEAM_TOP + RAFTER_H - 0.1), 0.06, 0.2)
    # knee braces at each post
    for x in POSTS:
        for s in (-1, 1):
            if (x == POSTS[0] and s < 0) or (x == POSTS[-1] and s > 0):
                continue
            beam("rr_pergola", M["timber"], W(x, FRONT, BEAM_TOP - 0.75), W(x + s * 0.55, FRONT, BEAM_TOP - 0.22), 0.07, 0.07)
    # rafters at 0.9 m, from the wall out 0.35 m past the front beam, with a cut-back nose
    xs = [X0 + i * (X1 - X0) / 9 for i in range(10)]
    for x in xs:
        zc = BEAM_TOP + RAFTER_H / 2
        beam("rr_pergola", M["timber"], W(x, -0.03, zc), W(x, FRONT - 0.35, zc), 0.05, RAFTER_H)
    # two battens across the rafters for the vine wires
    for y in (-1.3, -2.6):
        beam("rr_pergola", M["timber"], W(X0, y, LEAF_Z + 0.02), W(X1, y, LEAF_Z + 0.02), 0.04, 0.04)

    # ---- vine trunks twisting up the end posts and along the front beam ----
    for x0, side in ((POSTS[0], 1), (POSTS[-1], -1), (POSTS[1], 1)):
        pts = []
        for k in range(15):
            z = 0.02 + k * (BEAM_TOP + 0.05) / 14
            a = k * 0.9
            off = tx * (0.09 * math.cos(a)) + ty * (0.09 * math.sin(a))
            pts.append(W(x0, FRONT, z) + off)
        # then along the top of the beam towards the middle, wandering
        for k in range(1, 6):
            pts.append(W(x0 + side * k * 0.45, FRONT + 0.12 * math.sin(k * 1.7), BEAM_TOP + 0.04 + 0.05 * math.sin(k)))
        C.tube(b, "rr_vine_wood", M["vine"], pts, 0.035, sides=5)

    # ---- festoon strings ----
    def string(a, bpt, sag, every=0.5):
        pts = catenary(a, bpt, sag, every)
        C.tube(b, "rr_festoon_wire", M["wire"], pts, 0.006, sides=3, caps=False)
        for p in pts[1:-1]:
            bulb(b, M["bulb"], p)
        return len(pts) - 2

    bulbs = 0
    zr = BEAM_TOP - 0.02                       # just under the rafters
    for y in (-0.95, -2.0, -3.05):
        bulbs += string(W(X0 + 0.05, y, zr), W(X1 - 0.05, y, zr), 0.16)
    # poles along the front rail
    for (x, y, h) in POLES.values():
        beam("1WALL_rr_posts", M["timber"], W(x, y, 0), W(x, y, h), 0.1, 0.1)
    P = {k: W(x, y, h - 0.08) for k, (x, y, h) in POLES.items()}
    wall_r = W(12.55, -0.12, 2.75)              # on the front wall under the eaves, right end
    wall_m = W(9.1, -0.12, 2.75)
    bulbs += string(P["P1"], W(3.0, FRONT, BEAM_TOP - 0.05), 0.22)
    bulbs += string(W(X1, FRONT, BEAM_TOP - 0.05), P["P2"], 0.2)
    bulbs += string(P["P2"], P["P3"], 0.28)
    bulbs += string(wall_r, P["P2"], 0.22)
    bulbs += string(wall_m, P["P3"], 0.3)
    bulbs += string(wall_r, P["P3"], 0.2)
    # side passage, under the sails on the left: hooks on the house wall every 4 m
    hooks = [W(-0.12, y, 2.45) for y in (0.6, 4.6, 8.6, 12.6)]
    for a, c in zip(hooks, hooks[1:]):
        bulbs += string(a, c, 0.18)

    objs = b.build(layer)

    # ---- the vine canopy: leaf cards with UVs (own object, alpha-tested material) ----
    im = leaf_image()
    lm = leaf_material(im)
    V, Fc, UV = [], [], []

    def card(corners, region):
        """Two-sided quad; corners bl, br, tr, tl of an atlas region (0 clump, 1 and 2 the trails)."""
        u0, u1 = ((0.0, 0.5), (0.5, 0.75), (0.75, 1.0))[region]
        uvs = [(u0, 0), (u1, 0), (u1, 1), (u0, 1)]
        n = len(V)
        V.extend(corners)
        Fc.append((n, n + 1, n + 2, n + 3))
        UV.append(uvs)
        n = len(V)
        V.extend(corners)
        Fc.append((n + 3, n + 2, n + 1, n))
        UV.append(list(reversed(uvs)))

    def flat_card(x, y, z, size, rot, tilt, lean=None):
        """A clump lying over the rafters; tilt lifts one edge; lean (radians) tips it out over the front."""
        c = W(x, y, z)
        u = (tx * math.cos(rot) + ty * math.sin(rot)) * (size / 2)
        v = (-tx * math.sin(rot) + ty * math.cos(rot)) * (size / 2)
        if lean is not None:
            u = tx * (size / 2)
            v = (ty * math.cos(lean) + up * math.sin(lean)) * (size / 2)
        lift = Vector((0, 0, tilt * size / 2))
        card([c - u - v - lift, c + u - v - lift, c + u + v + lift, c - u + v + lift], 0)

    def hang_card(x, y, ztop, width, yaw, stretch=1.0):
        """A trail hanging from (x, y, ztop): 1:2 like its atlas column, `stretch` longer or shorter."""
        top = W(x, y, ztop)
        u = (tx * math.cos(yaw) + ty * math.sin(yaw)) * (width / 2)
        length = width * 2 * stretch
        bot = top - Vector((0, 0, length)) + ty * (-0.1 * length)   # the tip leans a little to the street
        card([bot - u, bot + u, top + u, top - u], 1 + rnd.randrange(2))

    cards = 0
    # Top: a jittered grid of clumps over the rafters, with a few gaps for dappled light.
    nx, ny = 8, 4
    for i in range(nx):
        for j in range(ny):
            if rnd.random() < 0.1:
                continue
            x = X0 + (i + 0.5) * (X1 - X0) / nx + rnd.uniform(-0.25, 0.25)
            y = -0.15 + (j + 0.5) * (FRONT - 0.2 + 0.15) / ny + rnd.uniform(-0.2, 0.2)
            flat_card(x, y, LEAF_Z + 0.02 + rnd.uniform(0, 0.1), rnd.uniform(1.3, 1.7), rnd.uniform(0, math.pi), rnd.uniform(-0.12, 0.12))
            cards += 1
    # A higher, sparser layer so it reads as foliage, not a flat sheet.
    for _ in range(14):
        flat_card(rnd.uniform(X0 + 0.4, X1 - 0.4), rnd.uniform(FRONT + 0.3, -0.5), LEAF_Z + 0.22 + rnd.uniform(0, 0.15),
                  rnd.uniform(0.9, 1.2), rnd.uniform(0, math.pi), rnd.uniform(-0.3, 0.3))
        cards += 1
    # The front edge: clumps tipped out over the beam (what you see from the street).
    x = X0 - 0.1
    while x < X1 + 0.1:
        flat_card(x, FRONT - 0.15, LEAF_Z + 0.05 + rnd.uniform(0, 0.08), rnd.uniform(0.9, 1.2), 0, 0, lean=rnd.uniform(0.6, 1.0))
        cards += 1
        x += rnd.uniform(0.7, 1.0)
    # Trails off the front beam, two rows, and round the posts.
    for row, dy in ((0, -0.08), (1, 0.12)):
        x = X0 - 0.15 + row * 0.25
        while x < X1 + 0.2:
            if rnd.random() < 0.85:
                hang_card(x, FRONT + dy + rnd.uniform(-0.05, 0.05), LEAF_Z + 0.1, rnd.uniform(0.38, 0.55), rnd.uniform(-0.4, 0.4),
                          rnd.uniform(0.6, 1.2) if row == 0 else rnd.uniform(0.4, 0.8))
                cards += 1
            x += rnd.uniform(0.35, 0.55)
    for xe in POSTS:
        for k in range(2):
            hang_card(xe + rnd.uniform(-0.1, 0.1), FRONT - 0.08 + 0.16 * k, BEAM_TOP - 0.05 - k * 0.7, 0.32, math.pi / 2 * k + rnd.uniform(-0.3, 0.3), 1.1)
            cards += 1
    # Trails along the open ends of the pergola.
    for xe in (X0 - 0.03, X1 + 0.03):
        for y in (-0.6, -1.5, -2.4, -3.3):
            hang_card(xe, y, LEAF_Z + 0.05, 0.42, math.pi / 2 + rnd.uniform(-0.3, 0.3), rnd.uniform(0.4, 0.9))
            cards += 1

    me = bpy.data.meshes.new("rr_vine_leaves")
    me.from_pydata(V, [], Fc)
    uvl = me.uv_layers.new(name="UVMap")
    li = 0
    for poly, uvs in zip(me.polygons, UV):
        for k, loop in enumerate(poly.loop_indices):
            uvl.data[loop].uv = uvs[k]
            li += 1
    me.validate()
    me.update()
    me.materials.append(lm)
    ob = bpy.data.objects.new("rr_vine_leaves", me)
    layer.objects.link(ob)
    objs.append(ob)

    tris = b.triangles() + 2 * len(Fc)
    print(f"rocky_ridge_pergola: {len(objs)} objects, {tris} triangles, {bulbs} bulbs, {cards} leaf cards")
    return F, M


def render_night(path, eye, target, lens, samples, res, bulb_mat):
    """Dusk: a dark blue sky, a low moon-ish fill, the bulbs emitting (for the render only)."""
    scene = bpy.context.scene
    for o in list(scene.objects):
        if o.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(o, do_unlink=True)
    cd = bpy.data.cameras.new("cam")
    cd.lens = lens
    cam = bpy.data.objects.new("cam", cd)
    scene.collection.objects.link(cam)
    C.look_at(cam, eye, target)
    scene.camera = cam
    ld = bpy.data.lights.new("fill", "SUN")
    ld.energy = 0.05
    ld.color = (0.6, 0.7, 1.0)
    s = bpy.data.objects.new("fill", ld)
    scene.collection.objects.link(s)
    s.rotation_euler = Vector((0.3, -0.6, 0.6)).normalized().to_track_quat("Z", "Y").to_euler()
    world = scene.world or bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.02, 0.035, 0.08, 1)
    bg.inputs["Strength"].default_value = 1.0
    bsdf = bulb_mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Emission Color"].default_value = (1.0, 0.62, 0.28, 1)
    bsdf.inputs["Emission Strength"].default_value = 40.0
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.view_settings.exposure = 0.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"wrote {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", help="layer file (else the open file)")
    ap.add_argument("--spec-ref", default="out/layers_work/rocky_ridge_pergola_base.lm_rocky_ridge.glb")
    ap.add_argument("--render")
    ap.add_argument("--view", default="street", choices=["street", "garden", "aerial", "night"])
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--res", default="960x540")
    a = ap.parse_args(C.args_after_dashes())
    if a.blend:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))
    import_spec_ref(os.path.abspath(a.spec_ref))
    layer = C.reset_layer()
    F, M = build(layer)
    bpy.ops.wm.save_mainfile()
    print(f"saved {bpy.data.filepath}")
    if a.render:
        # The spec's green shade sail stood in for this pergola: hide it in the renders (drop it from
        # the spec when this layer goes in).
        for ob in bpy.data.objects:
            if ob.type == "MESH" and ob.data.materials and ob.data.materials[0].name.startswith("spec_rocky_ridge_sail_4f6b3a"):
                ob.hide_render = True
        W = F.W
        views = {
            "street": (W(4.0, -15.5, 1.65), W(6.5, -2.0, 2.3), 26),
            "garden": (W(3.6, -6.2, 1.6), W(4.4, -1.2, 2.75), 20),
            "aerial": (W(-9.0, -20.0, 11.0), W(6.5, -2.5, 1.2), 30),
            "night": (W(5.5, -14.5, 1.65), W(7.0, -2.5, 2.4), 24),
        }
        eye, tgt, lens = views[a.view]
        w, h = (int(x) for x in a.res.lower().split("x"))
        if a.view == "night":
            render_night(os.path.abspath(a.render), eye, tgt, lens, a.samples, (w, h), M["bulb"])
        else:
            C.render(os.path.abspath(a.render), eye, tgt, lens=lens, samples=a.samples, res=(w, h), sun=(0.25, 0.8, 1.0))  # the sun from the north, on the front


main()
