"""Cape Leeuwin Lighthouse (1895-96) as a hand-made detail layer, over the cape-leeuwin route.

    python3 scripts/blender/landmarks/cape_leeuwin_lighthouse.py -- --blend <layer.blend> [--render <out.png>] [--view street|high|top] [--samples 16] [--res 960x540]

The whole chain is scripts/blender/landmarks/build.sh cape_leeuwin_lighthouse; the layer lands in
routes/layers/cape_leeuwin/. Description and sources: docs/landmarks/cape_leeuwin_lighthouse.md.

Mainland Australia's tallest lighthouse, 39 m: a round limestone tower, painted white, tapering from
about 7.8 m across at the foot to about 6.1 m under the gallery, standing on a square base (a 9.2 m
plinth 1.4 m high, height assumed). Small windows one above another on the north and south faces
light the floors. At about 33 m a stone gallery on corbels runs round the top of the shaft with an
open iron balustrade; on it the white 3.7 m (12 ft) Chance lantern: an iron pedestal drum, upright
glazing bars with two ring bars, a cornice, a domed cap and a ventilator ball. A paved forecourt
round the tower. Physics: one 1WALL_ box just inside the plinth, so cars stop at the base.
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

ORIGIN = (115.155, -34.343)          # routes/cape-leeuwin.json build.origin
AXIS = (115.136325, -34.375062)      # middle of the tower base (aerial, allowing for its lean)
FACING = 0.0                         # the door faces north, up the road to the cottages
N = 32                               # sides of the round parts

PLINTH = 9.2                         # square base, metres
PLINTH_H = 1.4
R_FOOT, R_TOP = 3.9, 3.05            # shaft radius at the plinth top and under the gallery
Z_GALLERY = 33.0                     # gallery floor underside (top of the shaft)


def build(layer):
    p = C.Projection(ORIGIN)
    x, y = p.to_local(*AXIS)
    fr = L.Frame((x, y, 0), FACING)
    ground = C.ground_sampler(lambda n: re.match(r"^\d(?!WALL)", n) is not None)
    zc, zlo, zhi = L.ground_stats(fr, ground, PLINTH / 2 * 1.3)
    print(f"tower axis at x {x:.2f} y {y:.2f}; ground {zc:.2f} (min {zlo:.2f}, max {zhi:.2f} round the plinth)")
    # Heights below are from the plinth's foot on its highest side, so the base is never buried.
    z0 = zhi
    fr.O.z = z0
    m = L.materials("leeuwin")
    b = C.Builder()

    # Square base: the plinth from below the lowest ground, a capping band, two steps up to the door.
    sink = z0 - zlo + 0.3
    C.box(b, "lh_white", m["white"], fr.W(0, 0, (PLINTH_H - sink) / 2), (PLINTH, PLINTH, PLINTH_H + sink), rot=fr.rot())
    C.box(b, "lh_trim", m["trim"], fr.W(0, 0, PLINTH_H - 0.06), (PLINTH + 0.16, PLINTH + 0.16, 0.12), rot=fr.rot())
    for depth, h in ((0.9, 0.47), (0.45, 0.93)):
        C.box(b, "lh_trim", m["trim"], fr.W(PLINTH / 2 + depth / 2, 0, (h - sink) / 2), (2.0, depth, h + sink), rot=fr.rot())

    # The shaft: a straight taper, a plinth course at the foot and a string course under the corbels.
    def rz(z):
        t = (z - PLINTH_H) / (Z_GALLERY - PLINTH_H)
        return R_FOOT + (R_TOP - R_FOOT) * t

    L.lathe(b, "lh_white_smooth", m["white"], fr, [(R_FOOT, PLINTH_H - 0.05), (R_TOP, Z_GALLERY)], n=N)
    L.lathe(b, "lh_trim", m["trim"], fr, [(R_FOOT + 0.12, PLINTH_H - 0.02), (R_FOOT + 0.12, PLINTH_H + 0.45),
                                          (rz(PLINTH_H + 0.6), PLINTH_H + 0.6)], n=N)
    zs = Z_GALLERY - 1.15
    L.lathe(b, "lh_trim", m["trim"], fr, [(rz(zs - 0.1), zs - 0.1), (rz(zs) + 0.1, zs), (rz(zs) + 0.1, zs + 0.18),
                                          (rz(zs + 0.3), zs + 0.3)], n=N)

    # Door at the plinth top facing north, with a plain hood; windows up the north and south faces.
    L.facet_quad(b, "lh_door", m["dark"], fr, 0.0, rz, PLINTH_H + 0.02, PLINTH_H + 2.3, 1.05, n=N)
    u = fr.dir(0.0)
    C.box(b, "lh_trim", m["trim"], fr.O + u * (rz(PLINTH_H + 2.4) * math.cos(math.pi / N) + 0.1) + Vector((0, 0, PLINTH_H + 2.42)),
          (1.4, 0.22, 0.16), rot=fr.rot())
    for sill in (5.0, 9.5, 14.0, 18.5, 23.0, 27.5):
        for a in (0.0, math.pi):
            L.window(b, fr, m, a, rz, sill, 1.2, 0.6, n=N)

    # Gallery: corbels, the slab with a moulded edge, and the open balustrade.
    R_SLAB = R_TOP + 0.9
    L.corbels(b, fr, m["white"], R_TOP, Z_GALLERY, 24, depth=0.85, height=0.95, width=0.34)
    L.lathe(b, "lh_white", m["white"], fr, [(R_TOP - 0.05, Z_GALLERY), (R_SLAB, Z_GALLERY), (R_SLAB + 0.05, Z_GALLERY + 0.12),
                                            (R_SLAB + 0.05, Z_GALLERY + 0.28), (R_SLAB, Z_GALLERY + 0.35), (1.5, Z_GALLERY + 0.35)], n=N)
    L.balustrade(b, fr, m, R_SLAB - 0.12, Z_GALLERY + 0.35, 1.1, posts=40, rails=(0.35, 0.68))

    # The lantern: pedestal, glazing (16 upright bars, two rings), cornice, dome, vent.
    tip = L.lantern(b, fr, m, Z_GALLERY + 0.35, ped_r=1.8, ped_h=1.05, glass_r=1.7, glass_h=2.25, dome_h=1.15,
                    bars=16, diamond=False, rings=(0.36, 0.68), vents=8, n=N)
    print(f"rod tip {tip:.2f} m above the plinth foot (39 m wanted)")

    # Paved forecourt round the plinth (draped on the ground).
    L.apron(b, "lh_paving", m["paving"], fr, ground, PLINTH / 2 * 1.42, PLINTH / 2 * 1.42 + 4.5, n=N, fallback=zc)

    # Physics: a box just inside the plinth, from below the ground to above a car's roof.
    C.box(b, "1WALL_lighthouse", m["white"], fr.W(0, 0, (2.5 - sink) / 2), (PLINTH - 0.04, PLINTH - 0.04, 2.5 + sink), rot=fr.rot())

    objs = L.finish(b, layer)
    print(f"cape_leeuwin_lighthouse: {len(objs)} objects, {b.triangles()} triangles")
    return fr, z0


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
            # From the forecourt to the north-north-west, as most photos are taken.
            "street": (fr.W(46, -14, 1.7), fr.W(0, 0, 20), 24),
            "high": (fr.W(30, 26, 40), fr.W(0, 0, 30), 30),
            "top": (fr.W(9, -6, 36.5), fr.W(0, 0, 35), 22),
        }
        eye, look, lens = views[a.view]
        w, h = (int(v) for v in a.res.lower().split("x"))
        C.render(os.path.abspath(a.render), eye, look, lens=lens, samples=a.samples, res=(w, h))


main()
