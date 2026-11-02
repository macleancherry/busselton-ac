"""The Busselton Settlement Art Project bronzes (Greg James, 2014 to 2019) round the Queen St cultural
precinct, as a hand-made detail layer.

    python3 scripts/blender/landmarks/settlement_art.py -- --blend <layer.blend> [--render <out.png>] [--view queen|east|bussell|top] [--samples 16] [--res 960x540]

(or blender --background <layer.blend> --python scripts/blender/landmarks/settlement_art.py -- ...)

Opens the layer file from scripts/blender/new_layer.py, rebuilds the "Layer" collection and saves it.
Then scripts/blender/export_layer.py and scripts/blender/make_layer.ts make the kn5; the whole chain is
scripts/blender/landmarks/build.sh settlement_art.

Six life-size figures, each a low-poly bronze on a low limestone plinth with a bronze plaque on its front
face carrying the title in plain lettering (docs/landmarks/settlement_art.md has the sources and how sure
each position is):

    Whaler's Wife (2014)        pregnant woman beside a sea chest, books in her left hand, looking out to sea
    Timber Worker (2015)        axeman in a wide hat, axe raised over a felled log
    John Garrett Bussell (2016) frock coat, top hat lifted in his right hand, a book in his left
    Spanish Settler (2017)      bent forward rolling a wine barrel
    Gaywal (2018-19)             Wadandi Elder with fishing gidgees and a mullet, a cloak over one shoulder
    Pioneer Woman (2019)        long dress and bonnet, a basket of farm goods

Figures are built in their own frame (x right, y forward, z up, metres from the middle of the plinth top)
from tapered tubes and lofted rings, then turned to their bearing. Plinths carry a 1WALL_ box so cars
stop at them; the figures are visual only.
"""
import argparse
import math
import os
import re
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

ORIGIN = (115.3403, -33.6506)        # routes/busselton.json build.origin

BRONZE = "#5b4532"
BRONZE_DARK = "#3f3022"
LIMESTONE = "#d6cdb6"
LETTERS = "#e9e1cc"
TIMBER = "#6a5238"

PLINTH_H = 0.32                      # above the ground
PLINTH_SINK = 0.25                   # below it, so a slope never shows a gap

# slug: (title, at [lng, lat], facing bearing, plinth (width across, depth along facing))
STATUES = {
    # On the ArtGeo (old Agricultural Bank) paving on Queen St, across from the courthouse, looking to sea.
    "whalers_wife": ("THE WHALER'S WIFE", (115.3436723, -33.6469034), 345.0, (1.5, 0.95)),
    # On the Saltwater frontage of Queen St (the 2015 site, 7-9 Queen St, is now Saltwater's forecourt).
    "timber_worker": ("TIMBER WORKER", (115.3438353, -33.6474334), 257.0, (2.3, 1.25)),
    # In the courthouse forecourt between the main group and the police cottages, facing Queen St.
    "bussell": ("JOHN GARRETT BUSSELL", (115.3436076, -33.6472672), 76.0, (1.0, 1.0)),
    # On the Saltwater frontage, north of the Timber Worker.
    "spanish_settler": ("SPANISH SETTLER", (115.3437986, -33.6472941), 257.0, (1.8, 1.05)),
    # At the cultural-complex end of Queen St: the lawn on the ArtGeo corner by the Marine Tce roundabout.
    "gaywal": ("GAYWAL", (115.3437641, -33.6468135), 300.0, (1.0, 1.0)),
    # Outside the Weld Theatre on the Queen St / Adelaide St corner.
    "pioneer_woman": ("PIONEER WOMAN", (115.3439529, -33.6476310), 225.0, (1.1, 1.0)),
}


# ---------------- figure geometry (own frame) ----------------

class Fig:
    """Collects one figure's geometry in its own frame, then places it."""

    def __init__(self, b, mats, place):
        self.b, self.M, self.place = b, mats, place

    def add(self, mat, verts, faces):
        self.b.add(f"settlement_{mat}", self.M[mat], [self.place(Vector(v)) for v in verts], faces)

    def tube(self, pts, radii, mat="bronze", sides=7, caps=True):
        """A tapered tube through pts (own frame) with a radius per point."""
        P = [Vector(p) for p in pts]
        n = len(P)
        verts, faces = [], []
        for i, p in enumerate(P):
            a, c = P[max(i - 1, 0)], P[min(i + 1, n - 1)]
            t = (c - a).normalized()
            up = Vector((0, 0, 1)) if abs(t.z) < 0.95 else Vector((0, 1, 0))
            nn = (up - t * up.dot(t)).normalized()
            bn = t.cross(nn)
            r = radii[i]
            for k in range(sides):
                ang = 2 * math.pi * k / sides
                verts.append(p + nn * (r * math.cos(ang)) + bn * (r * math.sin(ang)))
        for i in range(n - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                faces.append((i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k))
        if caps:
            faces.append(tuple(reversed(range(sides))))
            faces.append(tuple((n - 1) * sides + k for k in range(sides)))
        self.add(mat, verts, faces)

    def loft(self, rings, mat="bronze", sides=8, caps=True):
        """Horizontal elliptical rings (cx, cy, z, rx, ry) lofted bottom to top."""
        verts, faces = [], []
        for (cx, cy, z, rx, ry) in rings:
            for k in range(sides):
                ang = 2 * math.pi * k / sides
                verts.append((cx + rx * math.cos(ang), cy + ry * math.sin(ang), z))
        n = len(rings)
        for i in range(n - 1):
            for k in range(sides):
                k2 = (k + 1) % sides
                faces.append((i * sides + k, i * sides + k2, (i + 1) * sides + k2, (i + 1) * sides + k))
        if caps:
            faces.append(tuple(reversed(range(sides))))
            faces.append(tuple((n - 1) * sides + k for k in range(sides)))
        self.add(mat, verts, faces)

    def ball(self, c, rx, ry, rz, mat="bronze", seg=8, rings=5):
        c = Vector(c)
        verts = [c + Vector((0, 0, -rz))]
        for j in range(1, rings):
            phi = math.pi * j / rings - math.pi / 2
            for k in range(seg):
                th = 2 * math.pi * k / seg
                verts.append(c + Vector((rx * math.cos(phi) * math.cos(th), ry * math.cos(phi) * math.sin(th), rz * math.sin(phi))))
        verts.append(c + Vector((0, 0, rz)))
        top = len(verts) - 1
        faces = [(0, 1 + (k + 1) % seg, 1 + k) for k in range(seg)]
        for j in range(rings - 2):
            for k in range(seg):
                a, b2 = 1 + j * seg + k, 1 + j * seg + (k + 1) % seg
                faces.append((a, b2, b2 + seg, a + seg))
        last = 1 + (rings - 2) * seg
        faces += [(last + k, last + (k + 1) % seg, top) for k in range(seg)]
        self.add(mat, verts, faces)

    def box(self, c, size, mat="bronze", yaw=0.0, pitch=0.0):
        """Box at c, size (x, y, z), turned yaw about z then pitch about its own x."""
        sx, sy, sz = (s / 2 for s in size)
        cy_, sy_ = math.cos(yaw), math.sin(yaw)
        cp, sp = math.cos(pitch), math.sin(pitch)
        out = []
        for z in (-sz, sz):
            for y in (-sy, sy):
                for x in (-sx, sx):
                    y2, z2 = y * cp - z * sp, y * sp + z * cp
                    out.append(Vector(c) + Vector((x * cy_ - y2 * sy_, x * sy_ + y2 * cy_, z2)))
        self.add(mat, out, [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)])

    def cyl(self, a, b2, r, mat="bronze", sides=8):
        self.tube([a, b2], [r, r], mat=mat, sides=sides)

    # ---- body parts ----
    def head(self, z, r=0.105, fwd=0.0, x=0.0, tilt=0.0):
        self.ball((x, fwd, z), r * 0.86, r, r * 1.12, seg=10, rings=7)
        self.ball((x, fwd + r * 0.35, z - r * 0.55), r * 0.62, r * 0.6, r * 0.5, seg=8, rings=4)  # jaw
        self.ball((x, fwd + r * 0.9, z - r * 0.12), 0.016, 0.025, 0.03, mat="bronze_dark", seg=5, rings=3)  # nose
        return Vector((x, fwd, z))

    def leg(self, hip, knee, ankle, toe_dir=(0, 1), r=(0.075, 0.055, 0.045), shoe=True):
        self.tube([hip, knee, ankle], list(r), sides=8)
        self.ball(knee, r[1] * 1.05, r[1] * 1.05, r[1] * 1.05, seg=7, rings=4)
        if shoe:
            a = Vector(ankle)
            d = Vector((toe_dir[0], toe_dir[1], 0)).normalized()
            yaw = math.atan2(-d.x, d.y)
            self.box(a + d * 0.07 + Vector((0, 0, -0.035)), (0.1, 0.26, 0.08), yaw=yaw)

    def arm(self, shoulder, elbow, wrist, r=(0.05, 0.042, 0.034), hand=True):
        self.tube([shoulder, elbow, wrist], list(r), sides=7)
        self.ball(shoulder, r[0] * 1.25, r[0] * 1.25, r[0] * 1.15, seg=7, rings=4)
        self.ball(elbow, r[1] * 1.02, r[1] * 1.02, r[1] * 1.02, seg=6, rings=4)
        if hand:
            w, e = Vector(wrist), Vector(elbow)
            d = (w - e).normalized()
            self.ball(w + d * 0.07, 0.04, 0.04, 0.05, seg=6, rings=4)


def man_legs(f, stance=0.12, stride=0.0, knee_bend=0.0, hip_z=0.93, lean=0.0):
    """Two legs from the hips; stride moves the right foot forward and the left back."""
    for s, st in ((1, stride), (-1, -stride)):
        hip = (s * 0.1, lean, hip_z)
        ankle = (s * stance, st, 0.09)
        knee = (s * (0.1 + stance) / 2, st * 0.55 + lean * 0.4 + knee_bend, 0.5)
        f.leg(hip, knee, ankle)


def torso_man(f, hip_z=0.93, sh_z=1.44, lean=0.0, chest=0.17, waist=0.15, depth=0.11, coat=False):
    """Hips to neck as rings, leaning forward by lean metres at the shoulders."""
    def at(z):
        return lean * (z - hip_z) / (sh_z - hip_z)
    rings = [(0, at(hip_z - 0.05), hip_z - 0.05, 0.17, 0.12),
             (0, at(hip_z + 0.12), hip_z + 0.12, waist, depth),
             (0, at(sh_z - 0.18), sh_z - 0.18, chest, depth + 0.02),
             (0, at(sh_z - 0.02), sh_z - 0.02, chest + 0.03, depth),
             (0, at(sh_z + 0.06) + 0.01, sh_z + 0.06, 0.06, 0.06),
             (0, at(sh_z + 0.13) + 0.02, sh_z + 0.13, 0.05, 0.055)]
    f.loft(rings, sides=10)
    if coat:  # frock coat skirts to the knee, open at the front
        f.loft([(0, -0.02, 0.48, 0.2, 0.15), (0, 0, hip_z - 0.1, 0.18, 0.13), (0, 0, hip_z + 0.1, waist + 0.01, depth + 0.01)], caps=False)
    return lambda z: at(z)


def figure_whalers_wife(f):
    # Long skirt over the legs, the belly out front, right hand on it, books tied in the left.
    f.loft([(0, 0.02, 0.0, 0.3, 0.3), (0, 0.02, 0.35, 0.26, 0.25), (0, 0.03, 0.75, 0.2, 0.18),
            (0, 0.05, 0.98, 0.17, 0.15)])
    f.loft([(0, 0.05, 0.98, 0.17, 0.15), (0, 0.1, 1.08, 0.17, 0.2), (0, 0.08, 1.18, 0.15, 0.17),
            (0, 0.02, 1.28, 0.15, 0.1), (0, 0.0, 1.36, 0.17, 0.1), (0, 0.0, 1.42, 0.06, 0.055), (0, 0.01, 1.5, 0.05, 0.05)])
    f.head(1.59, r=0.1, fwd=0.02)
    f.loft([(0, -0.03, 1.5, 0.11, 0.09), (0, -0.07, 1.58, 0.11, 0.1), (0, -0.06, 1.68, 0.09, 0.08)], caps=False)  # hair, windblown back
    f.box((0.06, -0.12, 1.55), (0.1, 0.12, 0.15), pitch=-0.5)  # hair streaming
    f.arm((0.17, 0.0, 1.36), (0.2, 0.05, 1.12), (0.08, 0.2, 1.1))           # right hand on the belly
    f.arm((-0.17, 0.0, 1.36), (-0.21, 0.02, 1.1), (-0.21, 0.08, 0.88))      # left arm down
    f.box((-0.22, 0.12, 0.82), (0.07, 0.2, 0.26), mat="bronze_dark")       # the bundle of books
    # Sea chest at her right side, lid slightly domed.
    f.box((0.55, 0.0, 0.2), (0.42, 0.75, 0.4), mat="bronze_dark")
    f.tube([(0.55, -0.375, 0.4), (0.55, 0.375, 0.4)], [0.2, 0.2], mat="bronze_dark", sides=6)
    for y in (-0.25, 0.25):
        f.box((0.55, y, 0.21), (0.44, 0.04, 0.42))  # straps


def figure_timber_worker(f):
    # Feet apart behind the log, bent at the hips, the axe raised over his right shoulder.
    man_legs(f, stance=0.2, stride=0.08, knee_bend=0.05, hip_z=0.9, lean=-0.12)
    at = torso_man(f, hip_z=0.9, sh_z=1.38, lean=0.18, chest=0.18, waist=0.16)
    hz = 1.55
    f.head(hz, fwd=at(hz) + 0.02)
    f.tube([(0, at(hz) + 0.02, hz + 0.06), (0, at(hz) + 0.02, hz + 0.14)], [0.085, 0.075], sides=8)  # crown
    f.loft([(0, at(hz) + 0.02, hz + 0.06, 0.22, 0.22), (0, at(hz) + 0.02, hz + 0.08, 0.21, 0.21)], sides=10)  # wide brim
    sh_r, sh_l = Vector((0.2, 0.16, 1.37)), Vector((-0.2, 0.16, 1.37))
    grip_hi, grip_lo = Vector((0.18, 0.05, 1.82)), Vector((0.12, 0.1, 1.62))
    f.arm(sh_r, (0.3, 0.12, 1.62), grip_hi, r=(0.055, 0.047, 0.038))   # sleeves rolled: thick forearms
    f.arm(sh_l, (-0.05, 0.25, 1.48), grip_lo, r=(0.055, 0.047, 0.038))
    # Axe: handle from below the hands up over the shoulder, head behind.
    d = (grip_hi - grip_lo).normalized()
    a0, a1 = grip_lo - d * 0.2, grip_hi + d * 0.32
    f.cyl(a0, a1, 0.018, mat="timber", sides=5)
    f.box(a1 + Vector((0, -0.04, 0.02)), (0.04, 0.22, 0.1), mat="bronze_dark")
    # Felled log in front, lying across.
    f.tube([(-0.95, 0.62, 0.24), (0.95, 0.62, 0.24)], [0.24, 0.22], sides=9)
    f.box((0.05, 0.62, 0.47), (0.16, 0.2, 0.06), mat="bronze_dark")  # the cut


def figure_bussell(f):
    man_legs(f, stance=0.1, stride=0.06)
    torso_man(f, coat=True)
    f.head(1.62)
    f.loft([(0, -0.02, 1.62, 0.1, 0.1), (0, -0.01, 1.71, 0.09, 0.09)], caps=False)  # hair
    f.box((0, 0.07, 1.54), (0.12, 0.06, 0.08))  # beard
    # Right arm up, the top hat lifted above his head; left hand holding a book at the hip.
    f.arm((0.2, 0.0, 1.42), (0.33, 0.06, 1.62), (0.24, 0.08, 1.83))
    f.tube([(0.2, 0.09, 1.92), (0.2, 0.09, 2.08)], [0.085, 0.09], sides=8)         # crown
    f.loft([(0.2, 0.09, 1.9, 0.15, 0.13), (0.2, 0.09, 1.92, 0.14, 0.12)], sides=10)  # brim
    f.arm((-0.2, 0.0, 1.42), (-0.25, 0.04, 1.15), (-0.18, 0.18, 1.0))
    f.box((-0.14, 0.24, 1.0), (0.04, 0.17, 0.23), mat="bronze_dark", yaw=0.3)       # book


def figure_spanish_settler(f):
    # Striding forward, bent low, both hands on a barrel lying on its side in front.
    man_legs(f, stance=0.12, stride=0.28, knee_bend=0.08, hip_z=0.88, lean=-0.1)
    at = torso_man(f, hip_z=0.88, sh_z=1.3, lean=0.38, chest=0.17, waist=0.15)
    hz = 1.42
    f.head(hz, fwd=at(hz) + 0.06)
    f.ball((0, at(hz) + 0.04, hz + 0.08), 0.12, 0.12, 0.05, seg=8, rings=4)  # flat cap
    f.arm((0.19, at(1.3), 1.3), (0.24, 0.6, 1.0), (0.17, 0.7, 0.72))
    f.arm((-0.19, at(1.3), 1.3), (-0.24, 0.6, 1.0), (-0.17, 0.7, 0.72))
    # Barrel: axis across, bulging staves, two dark hoops near each end.
    xs = [-0.42, -0.3, 0.0, 0.3, 0.42]
    rs = [0.26, 0.31, 0.34, 0.31, 0.26]
    f.tube([(x, 0.9, 0.34) for x in xs], rs, mat="timber", sides=10)
    for x in (-0.33, 0.33):
        f.tube([(x - 0.025, 0.9, 0.34), (x + 0.025, 0.9, 0.34)], [0.315, 0.315], mat="bronze_dark", sides=10)


def figure_gaywal(f):
    man_legs(f, stance=0.12, stride=0.1)
    torso_man(f, chest=0.175, waist=0.15)
    f.head(1.63, r=0.108)
    f.box((0, 0.07, 1.55), (0.13, 0.06, 0.09))                                 # beard
    f.ball((0, -0.01, 1.68), 0.1, 0.105, 0.07, seg=8, rings=4)                 # hair
    # Cloak (booka) over the left shoulder, hanging down the back to the thigh.
    f.loft([(-0.02, -0.13, 0.62, 0.21, 0.05), (-0.02, -0.14, 1.0, 0.2, 0.05), (-0.04, -0.12, 1.32, 0.2, 0.05),
            (-0.1, -0.04, 1.47, 0.12, 0.08)], caps=False)
    # Right hand holding the gidgees upright; left arm down with a mullet.
    f.arm((0.2, 0.0, 1.42), (0.3, 0.08, 1.18), (0.28, 0.22, 1.12))
    for dx in (0.0, 0.05):
        f.cyl((0.3 + dx, 0.3, 0.02), (0.27 + dx, 0.26, 2.45), 0.012, mat="timber", sides=5)
    f.arm((-0.2, 0.0, 1.42), (-0.25, 0.0, 1.15), (-0.26, 0.04, 0.92))
    f.ball((-0.27, 0.06, 0.66), 0.03, 0.06, 0.2, mat="bronze_dark", seg=6, rings=4)  # the fish
    f.box((-0.27, 0.06, 0.44), (0.02, 0.1, 0.06), mat="bronze_dark")              # its tail


def figure_pioneer_woman(f):
    f.loft([(0, 0.0, 0.0, 0.32, 0.3), (0, 0.0, 0.4, 0.27, 0.25), (0, 0.0, 0.78, 0.19, 0.16),
            (0, 0.0, 0.98, 0.15, 0.11), (0, 0.0, 1.2, 0.16, 0.12), (0, 0.0, 1.34, 0.17, 0.1),
            (0, 0.0, 1.41, 0.06, 0.055), (0, 0.01, 1.49, 0.05, 0.05)])
    f.head(1.58, r=0.1, fwd=0.01)
    # Bonnet: a hood round the back of the head with a short brim.
    f.ball((0, -0.01, 1.61), 0.12, 0.12, 0.13, seg=8, rings=5)
    f.loft([(0, 0.06, 1.52, 0.13, 0.08), (0, 0.1, 1.7, 0.12, 0.07)], caps=False, sides=8)
    # Basket held in front on her left forearm, right hand on its rim.
    f.arm((0.17, 0.0, 1.35), (0.22, 0.08, 1.12), (0.1, 0.27, 1.06))
    f.arm((-0.17, 0.0, 1.35), (-0.24, 0.1, 1.1), (-0.12, 0.3, 1.0))
    f.loft([(-0.02, 0.36, 0.9, 0.17, 0.12), (-0.02, 0.36, 1.08, 0.22, 0.15)], mat="timber", sides=8)
    f.tube([(-0.2, 0.36, 1.08), (-0.02, 0.36, 1.28), (0.16, 0.36, 1.08)], [0.012] * 3, mat="timber", sides=4, caps=False)


FIGURES = {
    "whalers_wife": figure_whalers_wife,
    "timber_worker": figure_timber_worker,
    "bussell": figure_bussell,
    "spanish_settler": figure_spanish_settler,
    "gaywal": figure_gaywal,
    "pioneer_woman": figure_pioneer_woman,
}


def text_mesh(body, size):
    """Flat plain lettering from Blender's built-in font: (verts, faces, width), x centred, y up."""
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = body
    cu.size = size
    cu.resolution_u = 2
    cu.align_x = "CENTER"
    cu.fill_mode = "FRONT"
    ob = bpy.data.objects.new("txt", cu)
    bpy.context.scene.collection.objects.link(ob)
    ev = ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    me = ev.to_mesh()
    verts = [(v.co.x, v.co.y, 0.0) for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    xs = [v[0] for v in verts] or [0]
    return verts, faces, max(xs) - min(xs)


def build(layer):
    P = C.Projection(ORIGIN)
    ground = paved_ground()
    M = {"bronze": C.material("settlement_bronze", BRONZE, rough=0.45, metal=0.7),
         "bronze_dark": C.material("settlement_bronze_dark", BRONZE_DARK, rough=0.5, metal=0.6),
         "timber": C.material("settlement_timber", TIMBER, rough=0.55, metal=0.4),
         "stone": C.material("settlement_stone", LIMESTONE, rough=0.85),
         "letters": C.material("settlement_letters", LETTERS, rough=0.4, metal=0.3),
         "wall": C.material("settlement_wall", LIMESTONE, rough=0.85)}
    b = C.Builder()
    placed = {}
    for slug, (title, ll, facing, (pw, pd)) in STATUES.items():
        x, y = P.to_local(*ll)
        h = math.radians(facing)
        Fw = Vector((math.sin(h), math.cos(h), 0))
        Rt = Vector((math.cos(h), -math.sin(h), 0))
        # Ground: the lowest of the plinth corners, so the plinth never floats.
        zs = [ground(x + Rt.x * u + Fw.x * v, y + Rt.y * u + Fw.y * v) for u in (-pw / 2, pw / 2) for v in (-pd / 2, pd / 2)]
        zs = [z for z in zs if z is not None]
        z0 = min(zs) if zs else 2.8
        ztop = max(zs) + PLINTH_H if zs else z0 + PLINTH_H
        O = Vector((x, y, ztop))

        def place(v, O=O, Rt=Rt, Fw=Fw):
            return O + Rt * v.x + Fw * v.y + Vector((0, 0, v.z))

        t0 = b.triangles()
        f = Fig(b, M, place)
        # Plinth: limestone block with a slightly smaller cap; collidable box inside it.
        f.box((0, 0, -(ztop - z0 + PLINTH_SINK) / 2), (pw, pd, ztop - z0 + PLINTH_SINK), mat="stone")
        f.box((0, 0, 0.0), (pw - 0.06, pd - 0.06, 0.03), mat="stone")
        corners = [place(Vector((u, v, w))) for w in (-(ztop - z0) - PLINTH_SINK, 0.0) for v in (-pd / 2, pd / 2) for u in (-pw / 2, pw / 2)]
        b.add("1WALL_settlement", M["wall"], corners, [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)])
        # Plaque on the front face: a bronze plate with the title in plain raised-look lettering.
        plate_w = min(pw - 0.12, 0.9)
        plate_h = min(0.2, ztop - z0 - 0.06)
        pz = -(ztop - z0) / 2 - 0.01
        f.box((0, pd / 2 + 0.006, pz), (plate_w, 0.012, plate_h), mat="bronze_dark")
        tv, tf, tw = text_mesh(title, 1.0)
        size = min(0.075, (plate_w - 0.06) / max(tw, 1e-6))
        # x mirrored so the text reads left to right from the front (the viewer looks along -y).
        f.add("letters", [Vector((-vx * size, pd / 2 + 0.0135, pz - 0.025 + vy * size)) for (vx, vy, _) in tv], tf)
        # The figure.
        FIGURES[slug](f)
        placed[slug] = (O, Fw, Rt)
        print(f"{slug}: x {x:.2f} y {y:.2f} ground {z0:.2f} plinth top {ztop:.2f}, facing {facing:.0f}, {b.triangles() - t0} triangles")
    objs = b.build(layer)
    for ob in objs:  # the cast figures read as bronze with smooth shading; props, stone and plaques stay crisp
        if ob.name == "settlement_bronze":
            for poly in ob.data.polygons:
                poly.use_smooth = True
    print(f"settlement_art: {len(objs)} objects, {b.triangles()} triangles")
    return placed


def paved_ground():
    """ground(x, y): the base's ground, or the paving of a neighbouring spec landmark (the courthouse
    forecourt, the ArtGeo and Saltwater frontages) when that lies up to 0.45 m above it."""
    base_ground = C.ground_sampler(lambda n: re.match(r"^\d(?!WALL)", n) is not None)
    coll = bpy.data.collections.get("Base (reference)")
    specs = [o for o in coll.all_objects if o.type == "MESH" and o.get("settlement_ref") and "TREE" not in o.name.upper()]

    def ground(x, y):
        zb = base_ground(x, y)
        if zb is None:
            return None
        best = zb
        for o in specs:
            inv = o.matrix_world.inverted()
            ok, loc, _, _ = o.ray_cast(inv @ Vector((x, y, zb + 0.45)), (inv.to_3x3() @ Vector((0, 0, -1))).normalized())
            if ok:
                best = max(best, (o.matrix_world @ loc).z)
        return best

    return ground


def import_refs(prefix):
    """The neighbouring spec landmarks (export_base.ts --layers) as more locked reference, for renders."""
    base = bpy.data.collections.get("Base (reference)")
    d, stem = os.path.dirname(prefix), os.path.basename(prefix)
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if not (f.startswith(stem + ".") and f.endswith(".glb")):
            continue
        tag = f[len(stem) + 1:-4]
        if any(o.get("settlement_ref") == tag for o in bpy.data.objects):
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(d, f))
        for ob in set(bpy.data.objects) - before:
            for c in ob.users_collection:
                c.objects.unlink(ob)
            base.objects.link(ob)
            ob.hide_select = True
            ob["settlement_ref"] = tag


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", help="layer file (else the open file)")
    ap.add_argument("--refs", default="out/layers_work/settlement_art_base",
                    help="prefix of the export_base.ts --layers glbs to show in renders")
    ap.add_argument("--render")
    ap.add_argument("--view", default="queen", choices=["queen", "east", "bussell", "whaler", "plaque", "top", "saltwater", "corner", "gaywal"])
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--res", default="960x540")
    a = ap.parse_args(C.args_after_dashes())
    if a.blend:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))
    layer = C.reset_layer()
    import_refs(os.path.abspath(a.refs))  # the neighbouring specs' paving sets the plinth heights
    S = build(layer)
    bpy.ops.wm.save_mainfile()
    print(f"saved {bpy.data.filepath}")
    if a.render:
        up = Vector((0, 0, 1))

        def near(slug, fwd, right, hgt, tf=0.0, tz=0.9):
            O, Fw, Rt = S[slug]
            return O + Fw * fwd + Rt * right + up * hgt, O + Fw * tf + up * tz

        wO = S["whalers_wife"][0]
        bO = S["bussell"][0]
        sO, tO = S["spanish_settler"][0], S["timber_worker"][0]
        views = {
            # Driver's eye on Queen St just south of the Marine Tce roundabout, looking south down the precinct.
            "queen": (wO + Vector((-6.5, 6.0, 1.3)), (sO + tO) / 2 + Vector((-2.0, 0, 0.6)), 30),
            # From the courthouse footpath across Queen St to the Saltwater pair.
            "east": (bO + Vector((4.5, -2.0, 1.4)), (sO + tO) / 2 + up * 0.9, 30),
            "bussell": near("bussell", 3.6, -1.4, 1.4, tz=1.15),
            "whaler": near("whalers_wife", 3.6, 1.2, 1.3, tz=1.0),
            "plaque": near("bussell", 1.6, 0.3, 0.6, tf=0.4, tz=-0.1),
            "top": ((wO + tO) / 2 + Vector((-30, 4, 32)), (wO + tO) / 2 + Vector((-3, 0, 0)), 26),
            "saltwater": near("spanish_settler", 4.5, 3.5, 1.5, tf=-1.0, tz=0.8),
            "corner": near("pioneer_woman", 4.0, -1.5, 1.5, tz=0.9),
            "gaywal": near("gaywal", 3.5, 1.0, 1.5, tz=1.1),
        }
        v = views[a.view]
        eye, tgt = v[0], v[1]
        lens = v[2] if len(v) > 2 else 35
        w, h = (int(x) for x in a.res.lower().split("x"))
        C.render(os.path.abspath(a.render), eye, tgt, lens=lens, samples=a.samples, res=(w, h), sun=(0.35, 0.6, 0.75))


main()
