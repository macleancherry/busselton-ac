"""Transition (Harrie Fasher, 2016) on the Busselton foreshore, as a hand-made detail layer.

    python3 scripts/blender/landmarks/transition.py -- --blend <layer.blend> [--render <out.png>] [--view side|front|high] [--samples 16] [--res 960x540]

(or blender --background <layer.blend> --python scripts/blender/landmarks/transition.py -- ...)

Opens the layer file from scripts/blender/new_layer.py, rebuilds the "Layer" collection and saves it.
Then scripts/blender/export_layer.py and scripts/blender/make_layer.ts make the kn5; the whole chain is
scripts/blender/landmarks/build.sh transition.

The horse is an open frame of rusted flat bar: haunches on the grass, the body rearing to an arched neck
about 4 m up, the head bowed forward, one foreleg folded under the chest ending in a hoof ring, the other
reaching about 3.5 m forward along the grass. Shapes are read off the 2018 installation photo against
the 1 m bollards (docs/landmarks/sea_play.md, "Transition"). Visual only: no physics.

Horse frame: u metres along its heading (haunch to hoof, bearing HEADING), v across to its right, z up.
"""
import argparse
import math
import os
import random
import re
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402
from mathutils import Vector  # noqa: E402

ORIGIN = (115.3403, -33.6506)        # routes/busselton.json build.origin
HAUNCH = (115.3428368, -33.645031)   # OSM node 12512448707; the haunches sit here
HEADING = 168.0                      # haunch -> hoof, degrees from north (aerial shadow ~175, photo ~150)

RUST = "#7d4127"
PLATE = "#8a4a2b"
TIMBER = "#9a8160"


def frame():
    p = C.Projection(ORIGIN)
    ox, oy = p.to_local(*HAUNCH)
    h = math.radians(HEADING)
    H = Vector((math.sin(h), math.cos(h), 0))
    R = Vector((math.sin(h + math.pi / 2), math.cos(h + math.pi / 2), 0))
    return Vector((ox, oy, 0)), H, R


def build(layer):
    O, H, R = frame()
    ground = C.ground_sampler(lambda n: re.match(r"^\d(?!WALL)", n) is not None)  # terrain and paths, not trees
    z0 = ground(O.x, O.y)
    if z0 is None:
        z0 = 0.0
        print("warning: no ground under the haunch; using z 0")
    print(f"haunch at x {O.x:.2f} y {O.y:.2f}, ground z {z0:.3f}")

    def W(u, v, z):
        return O + H * u + R * v + Vector((0, 0, z0 + z))

    rust = C.material("transition_rust", RUST, rough=0.85, metal=0.2)
    plate_m = C.material("transition_plate", PLATE, rough=0.8, metal=0.2)
    timber = C.material("transition_timber", TIMBER, rough=0.9)
    wire = C.material("transition_wire", "#8c8c88", rough=0.5, metal=0.6)
    b = C.Builder()
    rnd = random.Random(2018)

    def bar(pts, w=0.085, per=3, twist=None, sink=0.0):
        """A flat bar through (u, v, z) points, smoothed, a little twisted like the real welded strip."""
        pts = [(u, v, z - (sink if i in (0, len(pts) - 1) and z < 0.05 else 0)) for i, (u, v, z) in enumerate(pts)]
        path = C.catmull([W(*p) for p in pts], per) if per > 1 and len(pts) > 2 else [W(*p) for p in pts]
        tw = rnd.uniform(-0.3, 0.3) if twist is None else twist
        C.flatbar(b, "transition_frame", rust, path, w=w, t=0.016, twist=tw)

    def side(curve, halfw):
        """The same side-view curve on both sides of the body, half-width by u."""
        for s in (-1, 1):
            bar([(u, s * halfw(u), z) for (u, z) in curve])

    def interp(curve, u):
        for a_, b_ in zip(curve, curve[1:]):
            (u0, z0_), (u1, z1) = (a_[0], a_[-1]), (b_[0], b_[-1])
            if min(u0, u1) <= u <= max(u0, u1) and u1 != u0:
                return z0_ + (z1 - z0_) * (u - u0) / (u1 - u0)
        return None

    # Back line: rump up the steep back, over the arched crest, down the face to the muzzle.
    back = [(0.05, 0.0), (0.15, 0.35), (0.62, 1.25), (0.92, 2.4), (1.26, 3.3), (1.78, 3.78),
            (2.22, 3.97), (2.8, 3.86), (3.3, 3.55), (3.56, 3.16)]
    # Front line: under the jaw, down the front of the neck to the chest, back along the belly.
    front = [(3.42, 3.02), (2.95, 2.98), (2.52, 2.92), (2.15, 2.42), (1.86, 1.9), (1.8, 1.5),
             (1.45, 1.18), (1.04, 1.06), (0.84, 0.55), (0.8, 0.02)]

    def hw_back(u):
        return 0.46 if u < 1.0 else max(0.16, 0.46 - (u - 1.0) * 0.21)

    def hw_front(u):
        return 0.42 if u < 1.9 else max(0.14, 0.42 - (u - 1.9) * 0.26)

    side(back, hw_back)
    side(front, hw_front)

    # Ribs: loops round the body from one side's back line to the other, and down to the front line.
    for u in (0.35, 0.7, 1.05, 1.45, 1.85, 2.3, 2.75, 3.15):
        zb = interp(back, u)
        if zb is None:
            continue
        hb = hw_back(u)
        bar([(u, -hb, zb), (u + 0.02, -hb * 0.4, zb + 0.06), (u + 0.02, hb * 0.4, zb + 0.06), (u, hb, zb)], per=2)
    # Uprights inside the body, back line to belly / neck front on each side, alternating lean.
    for i, (ub, uf) in enumerate([(0.62, 0.84), (0.95, 1.05), (1.26, 1.45), (1.6, 1.82), (2.0, 2.05), (2.5, 2.5), (2.95, 2.95)]):
        zb, zf = interp(back, ub), interp(front, uf)
        if zb is None or zf is None:
            continue
        for s in (-1, 1):
            if (i + (s > 0)) % 2:
                bar([(ub, s * hw_back(ub) * 0.95, zb), (uf, s * hw_front(uf) * 0.95, zf)], per=1)
    # Diagonal bracing in the body sides (the open lattice of the photo).
    for (ua, za), (ubb, zbb) in [((0.3, 0.6), (1.1, 2.9)), ((0.9, 0.3), (1.6, 3.6)), ((1.0, 1.1), (2.0, 3.6)),
                                 ((1.5, 1.2), (1.4, 3.3)), ((1.8, 1.6), (2.6, 3.8)), ((0.5, 1.6), (1.4, 1.1))]:
        for s in (-1, 1):
            bar([(ua, s * 0.4, za), ((ua + ubb) / 2 + 0.05, s * 0.43, (za + zbb) / 2), (ubb, s * 0.3, zbb)], per=2)
    # Spine strip along the top, the crest bar of the mane.
    bar([(u, 0.0, z + 0.05) for (u, z) in back[3:9]], w=0.11)

    # Head: the face plates, the cheek disc hanging under the eye, a brow plate.
    for s in (-1, 1):
        C.plate(b, "transition_plates", plate_m, [W(2.25, s * 0.2, 3.95), W(2.9, s * 0.17, 3.83), W(3.35, s * 0.14, 3.5),
                                                   W(3.0, s * 0.17, 3.2), W(2.5, s * 0.2, 3.35)])
    disc = [W(2.72 + 0.32 * math.cos(a), 0.24, 3.05 + 0.3 * math.sin(a)) for a in [2 * math.pi * k / 12 for k in range(12)]]
    C.plate(b, "transition_plates", plate_m, disc)
    C.plate(b, "transition_plates", plate_m, [W(2.6, -0.17, 3.93), W(3.2, -0.12, 3.62), W(3.2, 0.12, 3.62), W(2.6, 0.17, 3.93)])
    # Ears: two short spikes back off the poll.
    for s in (-1, 1):
        bar([(2.15, s * 0.14, 3.95), (1.95, s * 0.2, 4.25)], per=1, w=0.07)
    # Neck and haunch plates on the sides.
    for s in (-1, 1):
        C.plate(b, "transition_plates", plate_m, [W(1.15, s * 0.47, 2.95), W(1.55, s * 0.43, 3.55), W(1.5, s * 0.45, 2.55)])
        C.plate(b, "transition_plates", plate_m, [W(0.35, s * 0.5, 0.95), W(0.95, s * 0.5, 1.8), W(1.0, s * 0.48, 0.8)])

    # Hind legs folded under the haunches: hip down to the hock, the cannon to the ground, the foot back.
    for s in (-1, 1):
        bar([(0.55, s * 0.5, 1.4), (1.15, s * 0.55, 0.65), (1.38, s * 0.55, 0.02), (0.6, s * 0.55, 0.02), (0.05, s * 0.5, 0.02)], per=2)
        bar([(0.75, s * 0.52, 1.2), (1.25, s * 0.55, 0.62)], per=1, w=0.12)

    # Folded foreleg on the right: chest forward to the knee, the shin down, the hoof ring on the grass.
    v = 0.3
    bar([(1.85, v, 1.45), (2.3, v + 0.05, 1.62), (2.8, v + 0.08, 1.66), (3.1, v + 0.08, 1.2), (3.25, v + 0.08, 0.82)], per=3)
    bar([(1.82, v, 1.25), (2.6, v + 0.06, 1.42), (3.0, v + 0.08, 0.95)], per=2)
    ring = [(2.95 + 0.36 * math.cos(a), v + 0.08, 0.38 + 0.36 * math.sin(a)) for a in [2 * math.pi * k / 20 for k in range(21)]]
    bar(ring, per=1, w=0.06, twist=0.0)
    C.plate(b, "transition_plates", plate_m, [W(2.0, v + 0.02, 1.5), W(2.65, v + 0.06, 1.62), W(2.55, v + 0.06, 1.3), W(2.05, v + 0.02, 1.28)])

    # Reaching foreleg on the left: from the chest down and forward along the grass to the hoof.
    v = -0.28
    upper = [(1.85, v, 1.1), (2.6, v, 0.72), (3.3, v - 0.03, 0.62), (3.95, v - 0.05, 0.8), (4.6, v - 0.06, 0.78),
             (5.05, v - 0.06, 0.6), (5.45, v - 0.06, 0.24), (5.62, v - 0.06, 0.02)]
    lower = [(2.2, v, 0.45), (2.9, v - 0.02, 0.3), (3.7, v - 0.04, 0.45), (4.5, v - 0.06, 0.48), (5.0, v - 0.06, 0.35), (5.3, v - 0.06, 0.08)]
    bar(upper, per=3)
    bar(lower, per=3)
    for u in (2.6, 3.2, 3.8, 4.4, 4.95):
        zu, zl = interp(upper, u), interp(lower, u)
        if zu is not None and zl is not None:
            bar([(u, v - 0.04, zu), (u + 0.25, v - 0.04, zl)], per=1, w=0.07)
    # The hoof: a small A-frame foot on the grass with a base strip.
    bar([(5.3, v - 0.2, 0.01), (5.62, v - 0.06, 0.3), (5.85, v + 0.1, 0.01)], per=1)
    bar([(5.2, v - 0.25, 0.01), (5.95, v + 0.12, 0.01)], per=1, w=0.12)
    C.plate(b, "transition_plates", plate_m, [W(4.55, v - 0.07, 0.76), W(5.05, v - 0.07, 0.6), W(4.85, v - 0.07, 0.42), W(4.4, v - 0.07, 0.48)])
    # Ground strips under the haunches: the base it was bolted to.
    bar([(0.0, -0.55, 0.01), (0.0, 0.55, 0.01)], per=1, w=0.12)
    bar([(0.8, -0.5, 0.01), (0.8, 0.5, 0.01)], per=1, w=0.12)

    # Bollards and wire: a trapezoid, wide end at the haunches (north), narrow end past the hoof.
    corners = [(-0.7, -2.2), (-0.7, 2.2), (6.4, 1.2), (6.4, -1.2)]
    posts = []
    for (ua, va), (ub, vb) in zip(corners, corners[1:] + corners[:1]):
        L = math.hypot(ub - ua, vb - va)
        n = max(1, round(L / 2.4))
        for k in range(n):
            posts.append((ua + (ub - ua) * k / n, va + (vb - va) * k / n))
    for (u, v) in posts:
        zg = ground(*(W(u, v, 0).xy)) or z0
        base = W(u, v, 0)
        base.z = zg - 0.1
        top = W(u, v, 0)
        top.z = zg + 1.0
        C.cylinder(b, "transition_bollards", timber, base, top, 0.075, sides=8)
    for hgt in (0.3, 0.75):
        loop = [W(u, v, 0) for (u, v) in posts] + [W(*posts[0], 0)]
        for p in loop:
            p.z = (ground(p.x, p.y) or z0) + hgt
        C.tube(b, "transition_wire", wire, loop, 0.008, sides=4, caps=False)
    # The plaque block on the right side and the small sign by the north-west bollard.
    C.box(b, "transition_plates", plate_m, W(4.3, 1.25, 0.22), (0.32, 0.32, 0.44))
    C.box(b, "transition_bollards", timber, W(-0.3, 1.6, 0.25), (0.05, 0.05, 0.5))
    C.box(b, "transition_wire", wire, W(-0.3, 1.6, 0.55), (0.3, 0.02, 0.4))

    objs = b.build(layer)
    print(f"transition: {len(objs)} objects, {b.triangles()} triangles")
    return O, H, R, z0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", help="layer file (else the open file)")
    ap.add_argument("--render")
    ap.add_argument("--view", default="side", choices=["side", "front", "high"])
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--res", default="960x540")
    a = ap.parse_args(C.args_after_dashes())
    if a.blend:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))
    layer = C.reset_layer()
    O, H, R, z0 = build(layer)
    bpy.ops.wm.save_mainfile()
    print(f"saved {bpy.data.filepath}")
    if a.render:
        mid = O + H * 2.8 + Vector((0, 0, z0 + 1.9))
        views = {
            # From the path to the west-south-west, as in the 2018 photo (the horse's right side).
            "side": (O + H * 2.6 + R * 8.5 + Vector((0, 0, z0 + 1.6)), 28),
            "front": (O + H * 10.5 - R * 3.0 + Vector((0, 0, z0 + 1.7)), 28),
            "high": (O + H * 9 + R * 7 + Vector((0, 0, z0 + 7)), 26),
        }
        eye, lens = views[a.view]
        w, h = (int(x) for x in a.res.lower().split("x"))
        C.render(os.path.abspath(a.render), eye, mid, lens=lens, samples=a.samples, res=(w, h))


main()
