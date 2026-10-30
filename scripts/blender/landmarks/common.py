"""Shared helpers for the scripted landmark detail layers (scripts/blender/landmarks/<slug>.py).

Each landmark script opens the layer file made by scripts/blender/new_layer.py (the generated track
around the spot as a locked "Base (reference)" collection), rebuilds the "Layer" collection from code,
saves the file and can render it. Coordinates are the track's own: Blender X = east, Y = north, Z = up,
metres from the route's build.origin (the glTF importer turns AC's Y-up into Blender's Z-up).

Geometry is built as plain vertex/face lists per material and turned into one object per material at
the end, so each material is one draw call in AC. Object names become kn5 mesh names: a name starting
with a digit and a surface key (1WALL_...) is collidable, anything else is visual only.
"""
import math
import sys

import bpy  # first: with the pip module, bmesh only exists once bpy is loaded
from mathutils import Matrix, Vector

EARTH_RADIUS = 6378137.0


class Projection:
    """src/core/geo.ts LocalProjection: local metres (east, north) from the route's origin."""

    def __init__(self, origin):
        self.k = math.cos(math.radians(origin[1]))
        self.mx0 = EARTH_RADIUS * math.radians(origin[0])
        self.my0 = EARTH_RADIUS * math.log(math.tan(math.pi / 4 + math.radians(origin[1]) / 2))

    def to_local(self, lng, lat):
        mx = EARTH_RADIUS * math.radians(lng)
        my = EARTH_RADIUS * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
        return ((mx - self.mx0) * self.k, (my - self.my0) * self.k)


def args_after_dashes():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def material(name, hexcol, rough=0.7, metal=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    h = hexcol.lstrip("#")
    rgb = [srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


class Builder:
    """Vertex/face lists grouped by object name; each group becomes one mesh object with one material."""

    def __init__(self):
        self.groups = {}  # name -> (material, verts, faces)

    def group(self, name, mat):
        if name not in self.groups:
            self.groups[name] = (mat, [], [])
        return self.groups[name]

    def add(self, name, mat, verts, faces):
        _, V, F = self.group(name, mat)
        o = len(V)
        V.extend(tuple(v) for v in verts)
        F.extend(tuple(i + o for i in f) for f in faces)

    def triangles(self):
        n = 0
        for _, _, F in self.groups.values():
            n += sum(len(f) - 2 for f in F)
        return n

    def build(self, collection):
        objs = []
        for name, (mat, V, F) in self.groups.items():
            if not F:
                continue
            me = bpy.data.meshes.new(name)
            me.from_pydata(V, [], F)
            me.validate()
            me.update()
            me.materials.append(mat)
            for p in me.polygons:
                p.use_smooth = False
            ob = bpy.data.objects.new(name, me)
            collection.objects.link(ob)
            objs.append(ob)
        return objs


# ---------- sweeps ----------

def _frames(pts, up_hint):
    """Tangent, normal, binormal at each point of a polyline; normal kept close to up_hint."""
    P = [Vector(p) for p in pts]
    n = len(P)
    out = []
    for i in range(n):
        a = P[max(i - 1, 0)]
        b = P[min(i + 1, n - 1)]
        t = (b - a).normalized()
        up = Vector(up_hint) if up_hint is not None else Vector((0, 0, 1))
        if abs(t.dot(up.normalized())) > 0.98:
            up = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
        nrm = (up - t * up.dot(t)).normalized()
        out.append((t, nrm, t.cross(nrm)))
    return P, out


def sweep(b, name, mat, pts, profile, up=None, caps=True, twist=0.0):
    """Sweep a closed 2D profile [(u, v), ...] along a polyline; u runs along the frame normal,
    v along the binormal. twist (radians, total) turns the profile gradually along the run."""
    P, F = _frames(pts, up)
    m = len(profile)
    verts, faces = [], []
    for i, (p, (t, nrm, bn)) in enumerate(zip(P, F)):
        a = twist * i / max(len(P) - 1, 1)
        ca, sa = math.cos(a), math.sin(a)
        for (u, v) in profile:
            uu, vv = u * ca - v * sa, u * sa + v * ca
            verts.append(p + nrm * uu + bn * vv)
    for i in range(len(P) - 1):
        for k in range(m):
            k2 = (k + 1) % m
            faces.append((i * m + k, i * m + k2, (i + 1) * m + k2, (i + 1) * m + k))
    if caps:
        faces.append(tuple(reversed(range(m))))
        last = (len(P) - 1) * m
        faces.append(tuple(last + k for k in range(m)))
    b.add(name, mat, verts, faces)


def rect_profile(w, t):
    return [(-w / 2, -t / 2), (w / 2, -t / 2), (w / 2, t / 2), (-w / 2, t / 2)]


def round_profile(r, sides=6):
    return [(r * math.cos(2 * math.pi * k / sides), r * math.sin(2 * math.pi * k / sides)) for k in range(sides)]


def tube(b, name, mat, pts, r, sides=6, caps=True, up=None):
    sweep(b, name, mat, pts, round_profile(r, sides), up=up, caps=caps)


def flatbar(b, name, mat, pts, w=0.09, t=0.016, up=None, twist=0.0):
    sweep(b, name, mat, pts, rect_profile(w, t), up=up, twist=twist)


def box(b, name, mat, centre, size, rot=None):
    """Axis box (size = full x, y, z) at centre, optionally turned by a 3x3 Matrix."""
    sx, sy, sz = (s / 2 for s in size)
    c = Vector(centre)
    R = rot or Matrix.Identity(3)
    corners = [Vector((x, y, z)) for z in (-sz, sz) for y in (-sy, sy) for x in (-sx, sx)]
    verts = [c + R @ v for v in corners]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    b.add(name, mat, verts, faces)


def cylinder(b, name, mat, base, top, r, sides=8, caps=True):
    tube(b, name, mat, [base, top], r, sides=sides, caps=caps)


def quad2(b, name, mat, pts):
    """A two-sided polygon (own vertices per side, so Blender keeps both faces)."""
    n = len(pts)
    b.add(name, mat, list(pts) + list(pts), [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))])


def plate(b, name, mat, outline, thick=0.012):
    """A flat plate from a planar 3D outline (convex or star-shaped from its centroid), thickened
    along its normal, both faces and the rim."""
    P = [Vector(p) for p in outline]
    c = sum(P, Vector()) / len(P)
    nrm = Vector()
    for i in range(len(P)):
        nrm += (P[i] - c).cross(P[(i + 1) % len(P)] - c)
    nrm = nrm.normalized() * (thick / 2)
    n = len(P)
    verts = [p + nrm for p in P] + [p - nrm for p in P] + [c + nrm, c - nrm]
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.append((i, j, 2 * n))
        faces.append((n + j, n + i, 2 * n + 1))
        faces.append((i, n + i, n + j, j))
    b.add(name, mat, verts, faces)


def catmull(pts, per=4):
    """Catmull-Rom through the points, per subdivisions per span (keeps the ends)."""
    P = [Vector(p) for p in pts]
    if len(P) < 3:
        return P
    out = []
    for i in range(len(P) - 1):
        p0 = P[max(i - 1, 0)]
        p1, p2 = P[i], P[i + 1]
        p3 = P[min(i + 2, len(P) - 1)]
        for s in range(per):
            t = s / per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return out


# ---------- the layer file ----------

def reset_layer():
    layer = bpy.data.collections.get("Layer")
    if layer is None:
        sys.exit("no 'Layer' collection: start the file with scripts/blender/new_layer.py")
    for ob in list(layer.all_objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for me in list(bpy.data.meshes):
        if me.users == 0:
            bpy.data.meshes.remove(me)
    return layer


def ground_sampler(name_ok=lambda n: True):
    """ground(x, y) -> z of the highest base-reference surface under (x, y) whose object name passes
    name_ok (to skip the old spec meshes), or None."""
    base = bpy.data.collections.get("Base (reference)")
    objs = [o for o in base.all_objects if o.type == "MESH" and name_ok(o.name)]
    dg = bpy.context.evaluated_depsgraph_get()
    cache = []
    for o in objs:
        inv = o.matrix_world.inverted()
        cache.append((o, inv))

    def ground(x, y):
        best = None
        for o, inv in cache:
            org = inv @ Vector((x, y, 500.0))
            d = (inv.to_3x3() @ Vector((0, 0, -1))).normalized()
            ok, loc, nrm, _ = o.ray_cast(org, d)
            if ok:
                z = (o.matrix_world @ loc).z
                if best is None or z > best:
                    best = z
        return best

    return ground


# ---------- rendering ----------

def look_at(cam, eye, target):
    cam.location = Vector(eye)
    d = Vector(target) - Vector(eye)
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def render(path, eye, target, lens=28, samples=16, res=(960, 540), sun=(0.4, -0.5, 0.75)):
    scene = bpy.context.scene
    for o in list(scene.objects):
        if o.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(o, do_unlink=True)
    cd = bpy.data.cameras.new("cam")
    cd.lens = lens
    cd.clip_end = 2000
    cam = bpy.data.objects.new("cam", cd)
    scene.collection.objects.link(cam)
    look_at(cam, eye, target)
    scene.camera = cam
    ld = bpy.data.lights.new("sun", "SUN")
    ld.energy = 4.0
    ld.angle = math.radians(1.5)
    sun_ob = bpy.data.objects.new("sun", ld)
    scene.collection.objects.link(sun_ob)
    sun_ob.rotation_euler = Vector(sun).normalized().to_track_quat("Z", "Y").to_euler()
    world = scene.world or bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.55, 0.7, 0.95, 1)
    bg.inputs["Strength"].default_value = 0.9
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.device = "CPU"
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.resolution_percentage = 100
    scene.view_settings.exposure = -0.6
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"wrote {path}")
