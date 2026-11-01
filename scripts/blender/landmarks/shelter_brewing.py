"""Shelter Brewing Co (11 Foreshore Pde, Busselton) as a hand-made detail layer.

    python3 scripts/blender/landmarks/shelter_brewing.py -- --blend <layer.blend> [--render <out.png>] [--view south|north|east|top] [--samples 16] [--res 960x540]

(or blender --background <layer.blend> --python scripts/blender/landmarks/shelter_brewing.py -- ...)
The whole chain is scripts/blender/landmarks/build.sh shelter_brewing.

Paul Burnham Architect, opened November 2020, modelled on the old jetty railway sheds. Two big gabled
sheds side by side with their ridges running NW-SE (bearing 139 degrees), joined by a lower flat-roofed
glazed link, plus a lower flat-roofed back-of-house block on the south-west. Read off the Landgate
aerial and the architect's and press photos (docs/landmarks/shelter_brewing.md; photos are references
only, nothing from them is in the track):

- the east shed, 12.3 m wide and 38 m long, runs from the foreshore lawn to the Foreshore Pde forecourt:
  a battened glass gable on the lawn, a full glass gable with the name on the forecourt, and a weathering
  steel (Corten) side wall above a glazed shopfront and a canopy on the Visitor Centre side;
- the west shed, 11.4 m wide and 31 m long: a battened glass gable on the lawn, a Corten gable at the
  back with the stainless grain silo in front of it;
- eaves about 8.5 m, 28 degree pitch (ridge about 11.8 m), charcoal roofs covered in solar panels;
- a deep canopy along the lawn front and the east side; the beer garden under cream umbrellas on the
  lawn side and along the east side behind a low limestone wall (red umbrellas, as at opening); a dark shade sail over the west
  courtyard; plain-lettered "SHELTER" signs (no logo) and the "BORN & BREWED IN BUSSELTON" slogan on the Corten.

Physics: inset 1WALL_ boxes inside the walls of each block, the low garden walls, the silo legs and the
forecourt bollards. Everything else is visual. The base's terrain is bumpy here (2.0 to 3.0 m); the
floor is at FLOOR_Z and the walls run down into the ground on a concrete plinth.

Building frame: u metres along the ridges (from the lawn front towards Foreshore Pde, bearing 139), v
across them (towards the Visitor Centre, bearing 49), z up from the floor.
"""
import argparse
import math
import os
import re
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

ORIGIN = (115.3403, -33.6506)        # routes/busselton.json build.origin
CENTRE = (115.34516, -33.64523)      # frame origin (OSM way 749124330, near its middle)
HEADING = 139.0                      # u: along the ridges, lawn -> Foreshore Pde
FLOOR_Z = 2.6                        # floor level (track z); the ground under the site is 2.0 to 3.0
EAVE = 8.5
PITCH = math.radians(28)
SINK = 1.2                           # walls and plinths run this far below the floor

# Blocks in the frame (u0, u1, v0, v1). OSM outline plus the aerial's roof edges.
EAST = (-15.0, 22.8, 2.6, 14.9)      # east shed
WEST = (-15.0, 15.6, -12.4, -1.0)    # west shed
LINK = (-15.0, 15.6, -1.0, 2.6)      # glazed link between them, flat roof
LINK_Z = 7.0
BACK = (-12.5, 8.4, -27.5, -12.4)    # back-of-house block, flat roof
BACK_Z = 6.0
CANOPY_Z = 3.9                       # underside of the front and east canopies
FRONT_CANOPY = -17.4                 # front canopy edge (u)
EAST_CANOPY = 16.7                   # east canopy edge (v)
GARDEN_WALL = -21.0                  # beer garden's low wall (u)

COL = {
    "charcoal": ("#34373b", 0.55, 0.3),
    "pv": ("#1e2733", 0.3, 0.25),
    "corten": ("#7c4227", 0.85, 0.15),
    "glass": ("#2b3741", 0.08, 0.6),
    "concrete": ("#b5b0a6", 0.85, 0.0),
    "limestone": ("#cfc4a8", 0.9, 0.0),
    "timber": ("#a4723f", 0.75, 0.0),
    "canvas": ("#b3282b", 0.9, 0.0),     # red umbrellas (Mac, 2 Nov)
    "silo": ("#c4c8cc", 0.35, 0.8),
    "white": ("#f3f1eb", 0.5, 0.0),
    "cladding": ("#a59a84", 0.7, 0.1),
    "green": ("#55663a", 0.95, 0.0),
}


class Frame:
    def __init__(self):
        p = C.Projection(ORIGIN)
        ox, oy = p.to_local(*CENTRE)
        h = math.radians(HEADING)
        self.O = Vector((ox, oy, 0))
        self.U = Vector((math.sin(h), math.cos(h), 0))
        # v points to bearing HEADING - 90 (49 degrees), towards the Visitor Centre
        self.V = Vector((math.sin(h - math.radians(90)), math.cos(h - math.radians(90)), 0))
        self.R3 = Matrix((self.U, self.V, (0, 0, 1))).transposed()

    def W(self, u, v, z):
        return self.O + self.U * u + self.V * v + Vector((0, 0, FLOOR_Z + z))

    def xy(self, u, v):
        p = self.O + self.U * u + self.V * v
        return p.x, p.y


def ground_with_names():
    """(x, y) -> (z, name) of the highest base surface (terrain, roads, paths), or (None, None)."""
    base = bpy.data.collections.get("Base (reference)")
    objs = [o for o in base.all_objects if o.type == "MESH" and re.match(r"^\d(?!WALL)", o.name)]
    cache = [(o, o.matrix_world.inverted()) for o in objs]

    def g(x, y):
        best, name = None, None
        for o, inv in cache:
            org = inv @ Vector((x, y, 500.0))
            d = (inv.to_3x3() @ Vector((0, 0, -1))).normalized()
            ok, loc, _, _ = o.ray_cast(org, d)
            if ok:
                z = (o.matrix_world @ loc).z
                if best is None or z > best:
                    best, name = z, o.name
        return best, name

    return g


def text_mesh(body, size, depth):
    """Plain lettering from Blender's built-in font: (verts, faces) with x right (centred), y up from the
    baseline, z out of the face (0..depth)."""
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.resolution_u = 2
    cu.align_x = "CENTER"
    cu.fill_mode = "BOTH"
    ob = bpy.data.objects.new("txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    verts = [(v.co.x, v.co.y, v.co.z + depth / 2) for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    return verts, faces


def build(layer):
    F = Frame()
    W = F.W
    M = {k: C.material(f"shelter_{k}", *v) for k, v in COL.items()}
    b = C.Builder()
    g = ground_with_names()
    tri0 = 0

    def fbox(name, mat, u0, u1, v0, v1, z0, z1):
        C.box(b, name, M[mat], W((u0 + u1) / 2, (v0 + v1) / 2, (z0 + z1) / 2), (u1 - u0, v1 - v0, z1 - z0), rot=F.R3)

    def prism(name, mat, outline, u0, u1):
        """A closed prism: a convex outline [(v, z), ...] (anticlockwise seen from -u) between u0 and u1."""
        n = len(outline)
        verts = [W(u0, v, z) for v, z in outline] + [W(u1, v, z) for v, z in outline]
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
        for i in range(n):
            j = (i + 1) % n
            faces.append((i, j, n + j, n + i))
        b.add(name, M[mat], verts, faces)

    def slab(name, mat, a, bb, c, d, t):
        """A slab under the quad a-b-c-d (top face, anticlockwise from above), t thick."""
        P = [Vector(p) for p in (a, bb, c, d)]
        nrm = (P[1] - P[0]).cross(P[3] - P[0]).normalized()
        if nrm.z < 0:
            nrm = -nrm
        verts = P + [p - nrm * t for p in P]
        faces = [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
        b.add(name, M[mat], verts, faces)

    def report(label):
        nonlocal tri0
        t = b.triangles()
        print(f"  {label}: {t - tri0} triangles")
        tri0 = t

    # ---------------- the two sheds ----------------
    def shed(blk, north_battens=True, south="glass"):
        u0, u1, v0, v1 = blk
        vm = (v0 + v1) / 2
        half = (v1 - v0) / 2
        ridge = EAVE + half * math.tan(PITCH)
        gable = [(v0, 0.0), (v1, 0.0), (v1, EAVE), (vm, ridge), (v0, EAVE)]
        # Roof: two slabs with 0.45 m eave and 0.35 m verge overhangs, then a ridge cap.
        oh, vg = 0.45, 0.35
        ze = EAVE - oh * math.tan(PITCH)
        for s in (-1, 1):
            ve = vm + s * (half + oh)
            pts = [W(u0 - vg, ve, ze + 0.2), W(u1 + vg, ve, ze + 0.2), W(u1 + vg, vm, ridge + 0.2), W(u0 - vg, vm, ridge + 0.2)]
            if s < 0:
                pts = [pts[1], pts[0], pts[3], pts[2]]
            slab("shelter_roof", "charcoal", *pts, 0.2)
            # Solar panels: rows along the slope, broken every ~6 m like the aerial's panel blocks.
            n = max(1, round((u1 - u0 - 1.0) / 6.2))
            seg = (u1 - u0 - 1.0) / n
            for k in range(n):
                ua, ub = u0 + 0.5 + k * seg + 0.15, u0 + 0.5 + (k + 1) * seg - 0.15
                lo, hi = half * 0.12, half * 0.92
                zlo, zhi = EAVE + (half - hi) * math.tan(PITCH), EAVE + (half - lo) * math.tan(PITCH)
                q = [W(ua, vm + s * hi, zlo + 0.27), W(ub, vm + s * hi, zlo + 0.27), W(ub, vm + s * lo, zhi + 0.27), W(ua, vm + s * lo, zhi + 0.27)]
                if s < 0:
                    q = [q[1], q[0], q[3], q[2]]
                slab("shelter_pv", "pv", *q, 0.06)
        fbox("shelter_roof", "charcoal", u0 - vg, u1 + vg, vm - 0.18, vm + 0.18, ridge + 0.12, ridge + 0.32)
        # Side walls (charcoal cladding; the east shed's east wall is done separately).
        if blk is not EAST:
            fbox("shelter_walls", "charcoal", u0, u1, v0, v0 + 0.2, -SINK, EAVE)
            fbox("shelter_walls", "charcoal", u0, u1, v1 - 0.2, v1, -SINK, EAVE)
        else:
            fbox("shelter_walls", "charcoal", u0, u1, v0, v0 + 0.2, -SINK, EAVE)
        # Plinth all round.
        fbox("shelter_plinth", "concrete", u0 - 0.03, u1 + 0.03, v0 - 0.03, v1 + 0.03, -SINK, 0.02)

        # North gable: glass, a deep charcoal portal round the outline, battens over the upper glass.
        prism("shelter_glass", "glass", gable, u0, u0 + 0.12)
        fw, fd = 0.4, 0.55
        for (va, za), (vb, zb) in [((v0, 0), (v0, EAVE)), ((v1, 0), (v1, EAVE)), ((v0, EAVE), (vm, ridge)), ((v1, EAVE), (vm, ridge))]:
            portal(u0 - fd + 0.12, u0 + 0.12, va, za, vb, zb, fw)
        # shopfront mullions and a transom at the canopy, a heavier rail at 7 m
        n = 6
        for k in range(1, n):
            v = v0 + (v1 - v0) * k / n
            fbox("shelter_frames", "charcoal", u0 - 0.1, u0 + 0.05, v - 0.05, v + 0.05, 0.0, CANOPY_Z)
        fbox("shelter_frames", "charcoal", u0 - 0.12, u0 + 0.05, v0, v1, CANOPY_Z - 0.1, CANOPY_Z + 0.4)
        if north_battens:
            sp = 0.26
            nb = int((v1 - v0 - 2 * fw) / sp)
            for k in range(nb + 1):
                v = v0 + fw + 0.05 + k * (v1 - v0 - 2 * fw - 0.1) / nb
                top = min(EAVE + (half - abs(v - vm)) * math.tan(PITCH), ridge) - fw * 1.1
                fbox("shelter_frames", "charcoal", u0 - 0.38, u0 - 0.24, v - 0.03, v + 0.03, CANOPY_Z + 0.4, top)
            fbox("shelter_frames", "charcoal", u0 - 0.46, u0 - 0.2, v0 + fw, v1 - fw, 6.85, 7.1)
        # South gable.
        if south == "glass":
            prism("shelter_glass", "glass", gable, u1 - 0.12, u1)
            for (va, za), (vb, zb) in [((v0, 0), (v0, EAVE)), ((v1, 0), (v1, EAVE)), ((v0, EAVE), (vm, ridge)), ((v1, EAVE), (vm, ridge))]:
                portal(u1 - 0.12, u1 + 0.7, va, za, vb, zb, 0.5)
            for k in range(1, 5):
                v = v0 + (v1 - v0) * k / 5
                top = EAVE + (half - abs(v - vm)) * math.tan(PITCH) - 0.5
                fbox("shelter_frames", "charcoal", u1, u1 + 0.12, v - 0.05, v + 0.05, 0.0, top)
            for z in (3.2, 6.0):
                fbox("shelter_frames", "charcoal", u1, u1 + 0.12, v0 + 0.5, v1 - 0.5, z - 0.05, z + 0.05)
            # louvre band behind the glass line
            for k in range(5):
                z = 6.75 + k * 0.16
                fbox("shelter_frames", "charcoal", u1 + 0.02, u1 + 0.16, v0 + 3.0, v1 - 3.0, z, z + 0.07)
        else:
            prism("shelter_corten", "corten", gable, u1 - 0.2, u1)
        return ridge

    def portal(ua, ub, va, za, vb, zb, w):
        """A frame member of width w along the gable edge (va, za) -> (vb, zb), from ua to ub, on its inner side."""
        dv, dz = vb - va, zb - za
        L = math.hypot(dv, dz)
        tv, tz = dv / L, dz / L
        nv, nz = -tz, tv  # a normal; flip so it points down/inwards
        if nz > 0.01 or (abs(nz) <= 0.01 and ((nv > 0) != (va < vb_center[0]))):
            nv, nz = -nv, -nz
        p = [(va, za), (vb, zb), (vb + nv * w, zb + nz * w), (va + nv * w, za + nz * w)]
        verts = [W(ua, v, z) for v, z in p] + [W(ub, v, z) for v, z in p]
        faces = [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
        b.add("shelter_frames", M["charcoal"], verts, faces)

    vb_center = [(EAST[2] + EAST[3]) / 2]  # the shed being built, for portal()
    ridge_e = shed(EAST, south="glass")
    vb_center[0] = (WEST[2] + WEST[3]) / 2
    ridge_w = shed(WEST, south="corten")
    report("sheds")

    # East shed's east wall: glazed shopfront under the canopy, Corten above, the concrete piers and the
    # top-hung glass awning of the lounge opening.
    u0, u1, v0, v1 = EAST
    fbox("shelter_glass", "glass", u0, u1, v1 - 0.12, v1, 0.0, CANOPY_Z + 0.2)
    fbox("shelter_corten", "corten", u0, u1, v1 - 0.22, v1, CANOPY_Z + 0.2, EAVE)
    for k in range(int((u1 - u0) / 2.5)):
        u = u0 + 1.25 + k * 2.5
        if -6.6 < u < -0.9:
            continue
        fbox("shelter_frames", "charcoal", u - 0.05, u + 0.05, v1, v1 + 0.1, 0.0, CANOPY_Z)
    for u in (-6.3, -1.2):
        fbox("shelter_plinth", "concrete", u - 0.4, u + 0.4, v1 - 0.3, v1 + 0.35, 0.0, EAVE + 0.1)
    fbox("shelter_glass", "glass", -5.9, -1.6, v1 - 1.6, v1 - 1.5, 0.0, 7.4)       # recessed back of the opening
    fbox("shelter_timber", "timber", -5.9, -1.6, v1 - 1.6, v1, 0.0, 0.6)          # raised lounge deck
    fbox("shelter_plinth", "concrete", -5.9, -1.6, v1 - 1.6, v1 - 0.25, 7.4, EAVE)  # lintel
    fbox("shelter_frames", "charcoal", -5.9, -1.6, v1 - 0.25, v1, 7.4, EAVE)
    hinge_z, L, ang = 7.5, 4.0, math.radians(58)
    a0 = W(-5.85, v1 + 0.05, hinge_z)
    a1 = W(-1.65, v1 + 0.05, hinge_z)
    out = F.V * (L * math.sin(ang)) + Vector((0, 0, -L * math.cos(ang)))
    slab("shelter_glass", "glass", a0, a1, a1 + out, a0 + out, 0.04)
    for p0 in (a0, a1, (a0 + a1) / 2):
        C.tube(b, "shelter_frames", M["charcoal"], [p0, p0 + out], 0.05, sides=4)
    C.tube(b, "shelter_frames", M["charcoal"], [a0 + out, a1 + out], 0.05, sides=4)
    report("east wall")

    # ---------------- link, lantern, roof plant ----------------
    u0, u1, v0, v1 = LINK
    fbox("shelter_glass", "glass", u0, u0 + 0.12, v0, v1, 0.0, LINK_Z)
    fbox("shelter_frames", "charcoal", u0 - 0.15, u0 + 0.12, v0, v1, LINK_Z - 0.4, LINK_Z)
    fbox("shelter_frames", "charcoal", u0 - 0.1, u0 + 0.05, (v0 + v1) / 2 - 0.05, (v0 + v1) / 2 + 0.05, 0, LINK_Z)
    fbox("shelter_walls", "charcoal", u1 - 0.2, u1, v0, v1, -SINK, LINK_Z)
    fbox("shelter_roof", "charcoal", u0 - 0.3, u1, v0 - 0.2, v1 + 0.2, LINK_Z - 0.25, LINK_Z)
    fbox("shelter_plinth", "concrete", u0 - 0.03, u1, v0, v1, -SINK, 0.02)
    # glazed roof lantern along the link
    fbox("shelter_glass", "glass", -14.0, -1.0, -0.5, 1.9, LINK_Z, LINK_Z + 1.3)
    fbox("shelter_roof", "charcoal", -14.2, -0.8, -0.7, 2.1, LINK_Z + 1.3, LINK_Z + 1.5)
    # plant deck with fans and a rail, and a plant box behind it
    fbox("shelter_frames", "charcoal", 3.6, 9.9, -0.9, 2.3, LINK_Z, LINK_Z + 0.15)
    for (u, v) in ((5.0, 0.0), (5.0, 1.4), (6.6, 0.7), (8.4, 0.7)):
        C.cylinder(b, "shelter_silo", M["silo"], W(u, v, LINK_Z + 0.15), W(u, v, LINK_Z + 1.0), 0.48, sides=10)
    rail = [W(3.6, -0.9, LINK_Z + 1.1), W(9.9, -0.9, LINK_Z + 1.1), W(9.9, 2.3, LINK_Z + 1.1), W(3.6, 2.3, LINK_Z + 1.1), W(3.6, -0.9, LINK_Z + 1.1)]
    C.tube(b, "shelter_silo", M["silo"], rail, 0.03, sides=4, caps=False)
    fbox("shelter_walls", "charcoal", 10.8, 15.4, -0.8, 2.2, LINK_Z, LINK_Z + 1.0)
    report("link")

    # ---------------- back-of-house block ----------------
    u0, u1, v0, v1 = BACK
    fbox("shelter_cladding", "cladding", u0, u1, v0, v0 + 0.2, -SINK, BACK_Z)
    fbox("shelter_cladding", "cladding", u1 - 0.2, u1, v0, v1, -SINK, BACK_Z)
    fbox("shelter_cladding", "cladding", u0, u0 + 0.2, v0, v1, -SINK, BACK_Z)
    fbox("shelter_roof", "charcoal", u0 - 0.3, u1 + 0.3, v0 - 0.3, v1, BACK_Z - 0.1, BACK_Z + 0.15)
    fbox("shelter_frames", "charcoal", u0 - 0.32, u1 + 0.32, v0 - 0.32, v1, BACK_Z - 0.45, BACK_Z - 0.1)
    fbox("shelter_plinth", "concrete", u0 - 0.03, u1 + 0.03, v0 - 0.03, v1, -SINK, 0.02)
    # north face: glazing to the courtyard with mullions
    fbox("shelter_glass", "glass", u0 - 0.04, u0 + 0.1, v0 + 1.2, v1 - 0.8, 0.0, 3.0)
    for k in range(7):
        v = v0 + 1.2 + k * (v1 - 0.8 - v0 - 1.2) / 6
        fbox("shelter_frames", "charcoal", u0 - 0.1, u0 + 0.1, v - 0.05, v + 0.05, 0.0, 3.0)
    # west face windows, south roller door and a personnel door
    for u in (-8.0, -3.0, 2.0):
        fbox("shelter_glass", "glass", u - 1.2, u + 1.2, v0 - 0.04, v0 + 0.1, 1.0, 2.4)
    fbox("shelter_frames", "charcoal", u1 - 0.05, u1 + 0.08, -23.0, -18.8, 0.0, 4.2)
    fbox("shelter_frames", "charcoal", u1 - 0.05, u1 + 0.08, -16.2, -15.2, 0.0, 2.2)
    # roof flues
    for (u, v) in ((-10.0, -24.5), (2.5, -15.5)):
        fbox("shelter_silo", "silo", u - 0.3, u + 0.3, v - 0.3, v + 0.3, BACK_Z + 0.15, BACK_Z + 1.0)
    # courtyard canopy along the north face
    fbox("shelter_frames", "charcoal", -14.7, u0, v0 + 0.5, v1, 3.2, 3.5)
    for v in (v0 + 0.7, (v0 + v1) / 2, v1 - 0.3):
        fbox("shelter_frames", "charcoal", -14.6, -14.45, v - 0.07, v + 0.07, 0.0, 3.2)
    report("back block")

    # ---------------- canopies ----------------
    def canopy(u0, u1, v0, v1, posts):
        fbox("shelter_frames", "charcoal", u0, u1, v0, v1, CANOPY_Z + 0.08, CANOPY_Z + 0.42)  # deck + fascia
        fbox("shelter_timber", "timber", u0 + 0.05, u1 - 0.05, v0 + 0.05, v1 - 0.05, CANOPY_Z, CANOPY_Z + 0.08)  # soffit
        for (u, v) in posts:
            fbox("shelter_frames", "charcoal", u - 0.08, u + 0.08, v - 0.08, v + 0.08, 0.0, CANOPY_Z)

    canopy(FRONT_CANOPY, EAST[0], WEST[2] - 0.2, EAST_CANOPY,
           [(FRONT_CANOPY + 0.25, v) for v in (-12.2, -6.0, 0.8, 7.6, 14.7)])
    canopy(EAST[0], EAST[1] + 0.6, EAST[3], EAST_CANOPY,
           [(u, EAST_CANOPY - 0.25) for u in (-9.0, -0.5, 6.0, 12.0, 18.0)])
    report("canopies")

    # ---------------- signs (plain lettering, no logo) ----------------
    def sign(body, size, depth, at, right, up, mat="white"):
        verts, faces = text_mesh(body, size, depth)
        nrm = right.cross(up)  # out of the face, towards the reader (right is the reader's right)
        P = [at + right * x + up * y + nrm * z for (x, y, z) in verts]
        b.add("shelter_signs", M[mat], P, faces)

    # On top of the front canopy at the east corner, facing the lawn (-u).
    sign("SHELTER", 0.95, 0.12, W(FRONT_CANOPY + 0.15, 12.4, CANOPY_Z + 0.45), -F.V, Vector((0, 0, 1)))
    # On the forecourt gable's glass, facing Foreshore Pde (+u).
    u1 = EAST[1]
    vm = (EAST[2] + EAST[3]) / 2
    sign("SHELTER", 1.05, 0.06, W(u1 + 0.02, vm, 8.45), F.V, Vector((0, 0, 1)))
    sign("BREWING CO.", 0.42, 0.05, W(u1 + 0.02, vm, 7.85), F.V, Vector((0, 0, 1)))
    # Small one on the east canopy fascia at the forecourt end, facing Foreshore Pde.
    sign("SHELTER", 0.5, 0.06, W(EAST[1] + 0.62, (EAST[3] + EAST_CANOPY) / 2, CANOPY_Z + 0.45), F.V, Vector((0, 0, 1)))
    # The slogan in big white letters on the east wall's Corten, facing the Visitor Centre (+v).
    sign("BUSSELTON", 1.5, 0.08, W(10.8, EAST[3] + 0.01, 4.85), -F.U, Vector((0, 0, 1)))
    sign("BORN & BREWED IN", 0.8, 0.08, W(10.8, EAST[3] + 0.01, 6.75), -F.U, Vector((0, 0, 1)))
    report("signs")

    # ---------------- silo ----------------
    su, sv, r = WEST[1] + 2.15, -2.6, 1.85
    C.cylinder(b, "shelter_silo", M["silo"], W(su, sv, 2.4), W(su, sv, 8.9), r, sides=16, caps=False)
    ring = [W(su + r * math.cos(a), sv + r * math.sin(a), 2.4) for a in [2 * math.pi * k / 16 for k in range(16)]]
    top = [W(su + r * math.cos(a), sv + r * math.sin(a), 8.9) for a in [2 * math.pi * k / 16 for k in range(16)]]
    b.add("shelter_silo", M["silo"], ring + [W(su, sv, 1.5)], [(k, (k + 1) % 16, 16) for k in range(16)])
    b.add("shelter_silo", M["silo"], top + [W(su, sv, 9.85)], [((k + 1) % 16, k, 16) for k in range(16)])
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        u, v = su + 1.55 * math.cos(a), sv + 1.55 * math.sin(a)
        fbox("shelter_silo", "silo", u - 0.09, u + 0.09, v - 0.09, v + 0.09, -0.3, 2.6)
    fbox("1WALL_shelter_silo", "silo", su - 1.2, su + 1.2, sv - 1.2, sv + 1.2, -0.3, 2.3)
    # fill pipes up the side and over to the brewhouse wall
    for dv in (-0.25, 0.25):
        C.tube(b, "shelter_silo", M["silo"], C.catmull([W(su + r + 0.15, sv + dv, 0.3), W(su + r + 0.15, sv + dv, 9.3),
                                                          W(su + r - 0.4, sv + dv, 10.1), W(su - r, sv + dv, 10.2),
                                                          W(WEST[1] + 0.1, sv + dv, 9.0)], 3), 0.06, sides=6)
    C.tube(b, "shelter_silo", M["silo"], [W(su + r * math.cos(a), sv + r * math.sin(a), 9.0) for a in [2 * math.pi * k / 12 for k in range(13)]], 0.03, sides=4, caps=False)
    report("silo")

    # ---------------- ground: paving, garden walls, planters ----------------
    def pave(u0, u1, v0, v1, step=1.0, floor_min=None, lift=0.035):
        nu, nv = max(1, math.ceil((u1 - u0) / step)), max(1, math.ceil((v1 - v0) / step))
        grid, bad = {}, set()
        for i in range(nu + 1):
            for j in range(nv + 1):
                u, v = u0 + (u1 - u0) * i / nu, v0 + (v1 - v0) * j / nv
                z, name = g(*F.xy(u, v))
                if z is None or "STREET" in (name or ""):
                    bad.add((i, j))
                    z = FLOOR_Z
                z = z + lift
                if floor_min is not None:
                    z = max(z, FLOOR_Z + floor_min)
                grid[i, j] = W(u, v, z - FLOOR_Z)
        verts, faces, idx = [], [], {}
        for i in range(nu):
            for j in range(nv):
                q = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
                if any(k in bad for k in q):
                    continue
                f = []
                for k in q:
                    if k not in idx:
                        idx[k] = len(verts)
                        verts.append(grid[k])
                    f.append(idx[k])
                faces.append(tuple(reversed(f)) if F.U.cross(F.V).z < 0 else tuple(f))
        b.add("shelter_paving", M["limestone"], verts, faces)

    # beer garden on the lawn side (level with the floor, never under the ground) and the west courtyard
    pave(GARDEN_WALL, EAST[0], WEST[2] - 0.4, EAST_CANOPY + 0.6, floor_min=0.0)
    pave(GARDEN_WALL + 0.4, BACK[0], BACK[2] + 1.6, WEST[2] - 0.4, floor_min=0.0)
    # east terrace and path, the forecourt, the silo yard
    pave(EAST[0] - 4.0, EAST[1] + 4.2, EAST[3], EAST[3] + 5.0)
    pave(EAST[1], EAST[1] + 4.6, WEST[2], EAST[3])
    pave(WEST[1], EAST[1], WEST[2], EAST[2])
    report("paving")

    def gwall(u0, u1, v0, v1, h=0.9):
        lo = min(g(*F.xy(u, v))[0] or FLOOR_Z for u in (u0, u1) for v in (v0, v1)) - FLOOR_Z - 0.3
        fbox("1WALL_shelter_garden", "limestone", u0, u1, v0, v1, lo, h)

    t = 0.4
    # front wall with two openings onto the lawn path, then the courtyard's walls
    for (va, vb) in ((BACK[2] + 1.6, -3.0), (-1.0, 9.6), (11.6, EAST_CANOPY + 0.6)):
        gwall(GARDEN_WALL - t, GARDEN_WALL, va, vb)
    gwall(GARDEN_WALL - t, BACK[0], BACK[2] + 1.6, BACK[2] + 1.6 + t)
    # planters along the front wall (shrubs)
    for (va, vb) in ((-9.0, -6.0), (2.5, 5.5)):
        fbox("shelter_paving", "limestone", GARDEN_WALL, GARDEN_WALL + 1.0, va, vb, 0.0, 0.5)
        fbox("shelter_green", "green", GARDEN_WALL + 0.1, GARDEN_WALL + 0.9, va + 0.1, vb - 0.1, 0.5, 1.2)
    # forecourt planter at the glass gable's foot, with boulders
    u1 = EAST[1]
    fbox("shelter_paving", "limestone", u1 + 0.7, u1 + 1.9, EAST[2] + 1.0, EAST[3] - 1.0, -0.1, 0.45)
    fbox("shelter_green", "green", u1 + 0.8, u1 + 1.8, EAST[2] + 1.1, EAST[3] - 1.1, 0.45, 0.8)
    for k, v in enumerate((5.0, 8.3, 11.6)):
        rot = Matrix.Rotation(0.5 + k, 3, "Z") @ Matrix.Rotation(0.3, 3, "X")
        C.box(b, "shelter_plinth", M["concrete"], W(u1 + 1.3, v, 0.75), (0.9, 0.7, 0.55), rot=rot)
    # bollards along the forecourt edge
    for k in range(10):
        v = WEST[2] + 1.0 + k * 2.0
        z, name = g(*F.xy(u1 + 4.3, v))
        if z is None or "STREET" in (name or ""):
            continue
        zz = z - FLOOR_Z
        fbox("1WALL_shelter_bollards", "charcoal", u1 + 4.22, u1 + 4.38, v - 0.08, v + 0.08, zz - 0.3, zz + 1.0)
    # service-yard screen wall south of the back block
    fbox("1WALL_shelter_garden", "corten", BACK[1], BACK[1] + 6.0, BACK[2] + 1.0, BACK[2] + 1.2, -0.6, 1.9)
    fbox("1WALL_shelter_garden", "corten", BACK[1] + 5.8, BACK[1] + 6.0, BACK[2] + 1.2, BACK[2] + 6.0, -0.6, 1.9)
    report("walls and planters")

    # ---------------- shade sail over the west courtyard ----------------
    cu0, cv0 = GARDEN_WALL + 0.6, BACK[2] + 2.2
    corners = [(cu0, cv0, 5.2), (cu0, -13.4, 3.2), (BACK[0] - 2.4, -13.0, 4.8), (BACK[0] - 2.0, cv0 + 0.2, 3.0)]
    pts = [W(u, v, z) for u, v, z in corners]
    C.quad2(b, "shelter_sail", M["charcoal"], [pts[0], pts[1], pts[2]])
    C.quad2(b, "shelter_sail", M["charcoal"], [pts[0], pts[2], pts[3]])
    for (u, v, z) in corners:
        C.cylinder(b, "shelter_frames", M["charcoal"], W(u, v, 0.0), W(u, v, z + 0.3), 0.07, sides=6)
    report("sail")

    # ---------------- umbrellas, tables, benches ----------------
    def umbrella(u, v, r=1.35, h=2.7):
        apex = W(u, v, h)
        rim = [W(u + r * math.cos(a), v + r * math.sin(a), h - 0.45) for a in [2 * math.pi * (k + 0.5) / 8 for k in range(8)]]
        top = [(8, k, (k + 1) % 8) for k in range(8)]
        b.add("shelter_canvas", M["canvas"], rim + [apex], top + [(f[0], f[2], f[1]) for f in top])
        fbox("shelter_frames", "charcoal", u - 0.03, u + 0.03, v - 0.03, v + 0.03, 0.0, h)

    def table_set(u, v, along_u):
        if along_u:
            fbox("shelter_timber", "timber", u - 0.9, u + 0.9, v - 0.38, v + 0.38, 0.7, 0.75)
            fbox("shelter_frames", "charcoal", u - 0.7, u + 0.7, v - 0.25, v + 0.25, 0.0, 0.7)
            for s in (-1, 1):
                fbox("shelter_timber", "timber", u - 0.9, u + 0.9, v + s * 0.75 - 0.15, v + s * 0.75 + 0.15, 0.42, 0.46)
                fbox("shelter_frames", "charcoal", u - 0.7, u + 0.7, v + s * 0.75 - 0.05, v + s * 0.75 + 0.05, 0.0, 0.42)
        else:
            fbox("shelter_timber", "timber", u - 0.38, u + 0.38, v - 0.9, v + 0.9, 0.7, 0.75)
            fbox("shelter_frames", "charcoal", u - 0.25, u + 0.25, v - 0.7, v + 0.7, 0.0, 0.7)
            for s in (-1, 1):
                fbox("shelter_timber", "timber", u + s * 0.75 - 0.15, u + s * 0.75 + 0.15, v - 0.9, v + 0.9, 0.42, 0.46)
                fbox("shelter_frames", "charcoal", u + s * 0.75 - 0.05, u + s * 0.75 + 0.05, v - 0.7, v + 0.7, 0.0, 0.42)

    uf = FRONT_CANOPY - 1.75
    for v in [-11.2 + 3.05 * k for k in range(10)]:
        if -3.2 < v < -0.8 or 9.4 < v < 11.8:
            continue
        umbrella(uf, v)
        table_set(uf, v, along_u=True)
    for v in (-22.0, -17.5):
        umbrella(-17.6, v, r=1.2)
        table_set(-17.6, v, along_u=False)
    ve = EAST_CANOPY + 1.35
    for u in [5.0 + 2.6 * k for k in range(5)]:
        umbrella(u, ve, r=1.15, h=2.6)
        table_set(u, ve, along_u=False)
    # under the front canopy: long tables against the glass
    for v in (-9.0, -4.5, 4.4, 8.6, 12.8):
        table_set(EAST[0] - 1.25, v, along_u=False)
    report("garden furniture")

    # ---------------- physics: inset boxes inside each block ----------------
    e = 0.05
    for (u0, u1, v0, v1), top in ((EAST, EAVE), (WEST, EAVE), (LINK, LINK_Z), (BACK, BACK_Z)):
        fbox("1WALL_shelter", "charcoal", u0 + e, u1 - e, v0 + e, v1 - e, -SINK, top - 0.1)
    report("physics")

    objs = b.build(layer)
    print(f"shelter_brewing: {len(objs)} objects, {b.triangles()} triangles, {len(M)} materials; ridges {ridge_e + FLOOR_Z:.2f} / {ridge_w + FLOOR_Z:.2f}")
    return F


def import_refs(prefix):
    """The neighbouring spec landmarks (export_base.ts --layers) as more locked reference, for renders."""
    base = bpy.data.collections.get("Base (reference)")
    d = os.path.dirname(prefix)
    stem = os.path.basename(prefix)
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if not (f.startswith(stem + ".") and f.endswith(".glb")):
            continue
        tag = f[len(stem) + 1:-4]
        if any(o.get("shelter_ref") == tag for o in bpy.data.objects):
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(d, f))
        for ob in set(bpy.data.objects) - before:
            for c in ob.users_collection:
                c.objects.unlink(ob)
            base.objects.link(ob)
            ob.hide_select = True
            ob["shelter_ref"] = tag
        print(f"imported reference {f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", help="layer file (else the open file)")
    ap.add_argument("--refs", default="out/layers_work/shelter_brewing_base",
                    help="prefix of the export_base.ts --layers glbs to show in renders")
    ap.add_argument("--render")
    ap.add_argument("--view", default="south", choices=["south", "north", "east", "top"])
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--res", default="960x540")
    a = ap.parse_args(C.args_after_dashes())
    if a.blend:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))
    layer = C.reset_layer()
    F = build(layer)
    bpy.ops.wm.save_mainfile()
    print(f"saved {bpy.data.filepath}")
    if a.render:
        import_refs(os.path.abspath(a.refs))
        g = ground_with_names()

        def eye(u, v, h):
            z, _ = g(*F.xy(u, v))
            p = F.W(u, v, 0)
            p.z = (z if z is not None else FLOOR_Z) + h
            return p

        views = {
            # Foreshore Pde, south-east of the forecourt, looking back at the glass gable, silo and Corten.
            "south": (eye(44.0, 12.0, 1.5), F.W(14.0, -1.0, 4.6), 24),
            # Foreshore Pde's bend west of the building, looking past the courtyard to the beer garden.
            "north": (eye(-40.0, -30.0, 1.5), F.W(-14.0, 0.0, 4.5), 24),
            # Queen St / the jetty car park side, by the Visitor Centre, looking at the east wall.
            "east": (eye(-2.0, 44.0, 1.5), F.W(7.0, 10.0, 4.3), 22),
            "top": (F.W(30.0, 40.0, 45.0), F.W(2.0, -4.0, 0.0), 30),
        }
        e, t, lens = views[a.view]
        w, h = (int(x) for x in a.res.lower().split("x"))
        C.render(os.path.abspath(a.render), e, t, lens=lens, samples=a.samples, res=(w, h), sun=(0.35, 0.75, 0.75))


main()
