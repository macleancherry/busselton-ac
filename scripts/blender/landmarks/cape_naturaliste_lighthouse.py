"""Cape Naturaliste Lighthouse (1903-04) as a hand-made detail layer, over the cape-naturaliste route.

    python3 scripts/blender/landmarks/cape_naturaliste_lighthouse.py -- --blend <layer.blend> [--render <out.png>] [--view street|high|top] [--samples 16] [--res 960x540]

The whole chain is scripts/blender/landmarks/build.sh cape_naturaliste_lighthouse; the layer lands in
routes/layers/cape_naturaliste_road/. Description and sources: docs/landmarks/cape_naturaliste_lighthouse.md.

A short, fat tower on the crest: round, about 7.5 m across at the foot, narrowing a little to about
6.6 m at the top of the 14 m shaft, coursed limestone painted white, a door at the foot facing the path
down to the cottages and small windows one above another. A moulded concrete gallery (a cove flaring
out from the shaft to about 8 m across) with an open iron balustrade, and on it the 4.3 m (14 ft)
cast-iron Chance lantern with diamond-paned glazing (diagonal astragals both ways), a domed cap and a
ventilator ball: about 20 m in all. Also the 1973 flat-roofed brick power house just east of the
tower (in the spec this replaces; the base already has the compound's fence). Physics: one 1WALL_
cylinder just inside the shaft's foot.
"""
import argparse
import math
import os
import re
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
import lighthouse as L  # noqa: E402
from mathutils import Vector  # noqa: E402

ORIGIN = (115.06, -33.578)           # routes/cape-naturaliste.json build.origin
AXIS = (115.018705, -33.537391)      # middle of the tower base (aerial, allowing for its lean)
FACING = 165.0                       # the door faces down the path to the cottages and car park
N = 32

R_FOOT, R_TOP = 3.75, 3.3            # shaft radius at the foot and at the top
Z_GALLERY = 14.0                     # top of the shaft, under the gallery floor

# Power house: its middle 12.5 m east and 3.3 m south of the tower's axis, square to the compass,
# 6.0 m east-west by 5.6 m north-south, 3 m high (the white roof in nlh.jpg, less its small lean).
POWER_HOUSE = (12.5, -3.3, 6.0, 5.6, 3.0)


def build(layer):
    p = C.Projection(ORIGIN)
    x, y = p.to_local(*AXIS)
    fr = L.Frame((x, y, 0), FACING)
    ground = C.ground_sampler(lambda n: re.match(r"^\d(?!WALL)", n) is not None)
    zc, zlo, zhi = L.ground_stats(fr, ground, R_FOOT + 0.3)
    print(f"tower axis at x {x:.2f} y {y:.2f}; ground {zc:.2f} (min {zlo:.2f}, max {zhi:.2f} round the foot)")
    z0 = zhi
    fr.O.z = z0
    sink = z0 - zlo + 0.4
    m = L.materials("naturaliste")
    brick = C.material("naturaliste_brick", "#8C4A36", rough=0.9)
    roof = C.material("naturaliste_roof", "#E4E2D5", rough=0.6, metal=0.2)
    b = C.Builder()

    def rz(z):
        return R_FOOT + (R_TOP - R_FOOT) * max(0.0, min(1.0, z / Z_GALLERY))

    # The shaft, from below the ground, with a dressed plinth course at the foot.
    L.lathe(b, "lh_white_smooth", m["white"], fr, [(R_FOOT, -sink), (R_FOOT, 0.0), (R_TOP, Z_GALLERY)], n=N)
    L.lathe(b, "lh_trim", m["trim"], fr, [(R_FOOT + 0.1, -sink), (R_FOOT + 0.1, 0.55), (rz(0.7), 0.7)], n=N)

    # Door facing the path, with a hood; windows on the front and back faces.
    L.facet_quad(b, "lh_door", naturaliste_door(), fr, 0.0, rz, 0.1, 2.4, 1.1, n=N)
    u = fr.dir(0.0)
    C.box(b, "lh_trim", m["trim"], fr.O + u * (rz(2.5) * math.cos(math.pi / N) + 0.1) + Vector((0, 0, 2.52)),
          (1.45, 0.22, 0.16), rot=fr.rot())
    C.box(b, "lh_trim", m["trim"], fr.W(R_FOOT + 0.45, 0, (0.12 - sink) / 2), (1.8, 0.9, 0.12 + sink), rot=fr.rot())
    for sill in (4.0, 8.5):
        for a in (0.0, math.pi):
            L.window(b, fr, m, a, rz, sill, 1.2, 0.6, n=N)
    L.window(b, fr, m, math.pi, rz, 12.0, 1.0, 0.6, n=N)

    # Gallery: a moulded cove flaring out from the shaft, the slab edge, the balustrade.
    R_SLAB = 4.0
    cove = [(R_TOP - 0.02, Z_GALLERY - 1.0)]
    for i in range(1, 7):
        t = i / 6
        cove.append((R_TOP + (R_SLAB - R_TOP) * (1 - math.cos(t * math.pi / 2)), Z_GALLERY - 1.0 + 1.0 * math.sin(t * math.pi / 2) * 0.85))
    cove += [(R_SLAB, Z_GALLERY), (R_SLAB + 0.06, Z_GALLERY + 0.05), (R_SLAB + 0.06, Z_GALLERY + 0.28),
             (R_SLAB, Z_GALLERY + 0.35), (1.8, Z_GALLERY + 0.35)]
    L.lathe(b, "lh_white_smooth", m["white"], fr, cove[:7], n=N)
    L.lathe(b, "lh_white", m["white"], fr, cove[6:], n=N)
    L.balustrade(b, fr, m, R_SLAB - 0.12, Z_GALLERY + 0.35, 1.05, posts=36, rails=(0.3, 0.55, 0.8))

    # The lantern: pedestal with vents, diamond glazing, cornice, dome, vent.
    tip = L.lantern(b, fr, m, Z_GALLERY + 0.35, ped_r=2.1, ped_h=0.85, glass_r=2.0, glass_h=2.4, dome_h=1.2,
                    bars=18, diamond=True, rings=(), vents=8, n=N)
    print(f"rod tip {tip:.2f} m above the foot (about 20 m wanted)")

    # Paved apron round the foot.
    L.apron(b, "lh_paving", m["paving"], fr, ground, R_FOOT + 0.05, R_FOOT + 3.0, n=N, step=1.0, fallback=zc)

    # Power house (1973): brick box with a door and a window, a pale flat roof with a fascia.
    pe, pn, pw, pd, ph = POWER_HOUSE
    north = L.Frame((fr.O.x + pe, fr.O.y + pn, 0), 0.0)  # front = north, right = east
    g = [ground(*(north.W(df, dr, 0).xy)) for df in (-pd / 2, pd / 2) for dr in (-pw / 2, pw / 2)]
    g = [v for v in g if v is not None] or [zc]
    gb, gt = min(g) - 0.3, max(g)
    C.box(b, "naturaliste_brick", brick, north.W(0, 0, (gb + gt + ph) / 2), (pw, pd, gt + ph - gb), rot=north.rot())
    C.box(b, "naturaliste_roof", roof, north.W(0, 0, gt + ph + 0.12), (pw + 0.4, pd + 0.4, 0.25), rot=north.rot())
    # Door and window on the west wall, facing the tower.
    west = L.Frame((fr.O.x + pe - pw / 2, fr.O.y + pn, 0), 270.0)
    C.box(b, "lh_door", naturaliste_door(), west.W(0.01, -1.0, gt + 1.05), (1.0, 0.03, 2.1), rot=west.rot())
    C.box(b, "lh_dark", m["dark"], west.W(0.01, 1.3, gt + 1.6), (1.3, 0.03, 0.9), rot=west.rot())

    # Physics: a cylinder just inside the foot of the shaft.
    C.cylinder(b, "1WALL_lighthouse", m["white"], fr.P(0, 0, -sink), fr.P(0, 0, 2.5), R_FOOT - 0.03, sides=16)

    objs = L.finish(b, layer)
    print(f"cape_naturaliste_lighthouse: {len(objs)} objects, {b.triangles()} triangles")
    return fr, z0


def naturaliste_door():
    return C.material("naturaliste_door", "#2F4A3A", rough=0.6)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend")
    ap.add_argument("--render")
    ap.add_argument("--view", default="street", choices=["street", "high", "top"])
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--res", default="960x540")
    a = ap.parse_args(C.args_after_dashes())
    if a.blend:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))
    layer = C.reset_layer()
    fr, z0 = build(layer)
    bpy.ops.wm.save_mainfile()
    print(f"saved {bpy.data.filepath}")
    if a.render:
        views = {
            # From the path up from the cottages, south-south-east of the tower.
            "street": (fr.W(30, -6, 1.7), fr.W(0, 2, 9), 26),
            "high": (fr.W(28, 22, 24), fr.W(0, 3, 9), 30),
            "top": (fr.W(8, -5, 17.5), fr.W(0, 0, 16.5), 22),
        }
        eye, look, lens = views[a.view]
        w, h = (int(v) for v in a.res.lower().split("x"))
        C.render(os.path.abspath(a.render), eye, look, lens=lens, samples=a.samples, res=(w, h))


main()
