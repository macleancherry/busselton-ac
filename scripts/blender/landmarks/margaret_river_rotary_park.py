"""Rotary Park, Margaret River: "Old Kate" in her shelter, the park footbridge and the entrance gate.

    python3 scripts/blender/landmarks/margaret_river_rotary_park.py -- --blend <layer.blend> [--render <out.png>] [--view kate|cab|bridge|gate|high] [--samples 16] [--res 960x540]

(or scripts/blender/landmarks/build.sh margaret_river_rotary_park [base.zip] [views...])

Opens the layer file from scripts/blender/new_layer.py, rebuilds the "Layer" collection and saves it.
Description and sources: docs/landmarks/margaret_river_rotary_park.md.

- Kate: an 8-ton 0-4-0 tank engine (T F Green and Sons, Leeds, 1889), red cab and boiler, yellow dome,
  black smokebox, tall black chimney and black frames, on a short length of 3 ft 6 in track with a
  red-brown log bogie carrying three logs behind. She stands in an open-sided gabled shelter of white
  timber posts and trusses under a corrugated roof, with a decorative white frieze on the gable ends,
  on grey gravel, with a ramp and platform up to the footplate on one side.
- The footbridge: the narrow timber footbridge on the walk from the car park across the river
  channel to the playground side (not the 1923 railway bridge, which is 800 m away on the Wadandi Track).
- The gate: the white timber "ROTARY PARK" entrance arch on the car park, two posts and a beam.

Physics: simple 1WALL_ boxes only (the shelter posts, the engine and bogie frames, the gate posts).
Everything else is visual. Shapes are read off 2024 visitor photos (modelling reference only), the
Landgate aerial for the footbridge and OSM for Kate's spot.
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

ORIGIN = (115.0745, -33.9505)            # routes/margaret-river.json build.origin
KATE = (115.073906, -33.944812)          # OSM node 2646449749 "Old Kate": the shelter's middle
KATE_HEADING = 42.0                      # shelter axis, along the concrete path beside it (OSM 345704334)
KATE_SHIFT = -1.8                        # metres across (north-west) from the node, so the path passes beside
BRIDGE_A = (115.074280, -33.944716)      # footbridge, car park end (Landgate aerial)
BRIDGE_B = (115.074443, -33.944891)      # footbridge, far bank end
GATE = (115.073950, -33.944440)          # entrance arch, east side of the car park aisle (Mapillary 2019)
GATE_HEADING = 119.0                     # direction you walk through it

RED = "#b5221b"
BLACK = "#1d1d1d"
YELLOW = "#f2c318"
WHITE = "#ecebe4"
ROOF = "#9fa4a6"
UNDER = "#b9a27c"
GRAVEL = "#a19c92"
TIMBER = "#9a7a55"
GREY_TIMBER = "#8c8170"
WAGON = "#8e3c2c"
LOG = "#b7ada0"
LOG_END = "#d2c2a4"
STEEL = "#5a5550"


class Frame:
    """u along a heading, v to its right, z up from z0."""

    def __init__(self, at, heading, z0=0.0):
        p = C.Projection(ORIGIN)
        x, y = p.to_local(*at)
        h = math.radians(heading)
        self.O = Vector((x, y, 0))
        self.H = Vector((math.sin(h), math.cos(h), 0))
        self.R = Vector((math.sin(h + math.pi / 2), math.cos(h + math.pi / 2), 0))
        self.z0 = z0
        self.heading = heading

    def W(self, u, v, z):
        return self.O + self.H * u + self.R * v + Vector((0, 0, self.z0 + z))

    def rot(self):
        from mathutils import Matrix
        return Matrix((self.H, self.R, (0, 0, 1))).transposed()


def build(layer):
    ground = C.ground_sampler(lambda n: re.match(r"^\d(?!WALL)", n) is not None)
    M = {
        "red": C.material("rp_red", RED, rough=0.45),
        "black": C.material("rp_black", BLACK, rough=0.55, metal=0.2),
        "yellow": C.material("rp_yellow", YELLOW, rough=0.45),
        "white": C.material("rp_white", WHITE, rough=0.7),
        "roof": C.material("rp_roof", ROOF, rough=0.5, metal=0.5),
        "under": C.material("rp_under", UNDER, rough=0.8),
        "gravel": C.material("rp_gravel", GRAVEL, rough=0.95),
        "timber": C.material("rp_timber", TIMBER, rough=0.85),
        "grey": C.material("rp_greytimber", GREY_TIMBER, rough=0.9),
        "wagon": C.material("rp_wagon", WAGON, rough=0.75),
        "log": C.material("rp_log", LOG, rough=0.95),
        "logend": C.material("rp_logend", LOG_END, rough=0.95),
        "steel": C.material("rp_steel", STEEL, rough=0.4, metal=0.7),
    }
    b = C.Builder()

    def gz(p, fallback):
        g = ground(p.x, p.y)
        return fallback if g is None else g

    # ---------------- Kate's shelter ----------------
    F = Frame(KATE, KATE_HEADING)
    F.O += F.R * KATE_SHIFT          # clear of the concrete path on her south-east side
    zc = ground(F.O.x, F.O.y)
    if zc is None:
        zc = 0.0
        print("warning: no ground under Kate; using z 0")
    # The floor sits on the higher corner so it never sinks; it skirts down to the lowest.
    corners = [gz(F.W(u, v, 0), zc) for u in (-6, 6) for v in (-3.5, 3.5)]
    F.z0 = max(corners) + 0.05
    skirt = F.z0 - min(corners) + 0.2
    R3 = F.rot()
    print(f"kate at x {F.O.x:.2f} y {F.O.y:.2f}, ground {zc:.2f}, floor {F.z0:.2f} (skirt {skirt:.2f})")

    L, Wd, EAVE, RIDGE = 12.0, 6.0, 2.85, 4.05      # shelter length, width, eave and ridge heights
    # Gravel pad.
    C.box(b, "rp_gravel", M["gravel"], F.W(0, 0, -skirt / 2 + 0.02), (L + 1.2, Wd + 1.2, skirt + 0.04), R3)
    # Posts: 6 bays a side, white 150 mm square, as walls.
    xs = [-L / 2 + 0.15 + k * (L - 0.3) / 5 for k in range(6)]
    for u in xs:
        for s in (-1, 1):
            C.box(b, "1WALL_rp_posts", M["white"], F.W(u, s * (Wd / 2 - 0.1), EAVE / 2), (0.15, 0.15, EAVE), R3)
    # Wall plates along the eaves and the trusses (tie beam, king post, rafters, struts), white.
    for s in (-1, 1):
        C.box(b, "rp_frame", M["white"], F.W(0, s * (Wd / 2 - 0.1), EAVE + 0.1), (L, 0.12, 0.2), R3)
    pitch = math.atan2(RIDGE - EAVE, Wd / 2 + 0.4)
    half = Wd / 2 + 0.55
    ov = 0.5

    def zu(v):
        """Underside of the roof lining at v across."""
        return RIDGE - (RIDGE - EAVE + math.tan(pitch) * 0.15) * abs(v) / half
    for u in xs:
        C.box(b, "rp_frame", M["white"], F.W(u, 0, EAVE + 0.12), (0.1, Wd, 0.16), R3)
        C.box(b, "rp_frame", M["white"], F.W(u, 0, (EAVE + RIDGE) / 2 + 0.05), (0.1, 0.1, RIDGE - EAVE - 0.05), R3)
        for s in (-1, 1):
            a = F.W(u, s * (Wd / 2 + 0.3), zu(Wd / 2 + 0.3) - 0.1)
            c = F.W(u, 0, RIDGE - 0.1)
            C.flatbar(b, "rp_frame", M["white"], [a, c], w=0.16, t=0.09, up=(0, 0, 1))
            C.flatbar(b, "rp_frame", M["white"], [F.W(u, 0, EAVE + 0.2), F.W(u, s * Wd / 4, zu(Wd / 4) - 0.12)], w=0.1, t=0.08, up=(0, 0, 1))
    # Knee braces from posts to the wall plate, along the run.
    for u in xs:
        for s in (-1, 1):
            for d in (-1, 1):
                if -L / 2 < u + d * 0.6 < L / 2:
                    C.flatbar(b, "rp_frame", M["white"], [F.W(u, s * (Wd / 2 - 0.1), EAVE - 0.6), F.W(u + d * 0.6, s * (Wd / 2 - 0.1), EAVE)], w=0.09, t=0.09)
    # Roof: corrugated grey on top, timber battens showing underneath (a thin lining sheet).
    for s in (-1, 1):
        drop = math.tan(pitch) * 0.15
        top = [F.W(u, w, z) for (u, w, z) in ((-L / 2 - ov, 0, RIDGE + 0.06), (L / 2 + ov, 0, RIDGE + 0.06),
                                             (L / 2 + ov, s * half, EAVE + 0.06 - drop), (-L / 2 - ov, s * half, EAVE + 0.06 - drop))]
        und = [F.W(u, w, z) for (u, w, z) in ((-L / 2 - ov, 0, RIDGE), (L / 2 + ov, 0, RIDGE),
                                             (L / 2 + ov, s * half, EAVE - drop), (-L / 2 - ov, s * half, EAVE - drop))]
        C.plate(b, "rp_roof", M["roof"], top, thick=0.03)
        C.plate(b, "rp_under", M["under"], und, thick=0.02)
        # Fascia along the eave.
        C.box(b, "rp_frame", M["white"], F.W(0, s * half, EAVE - math.tan(pitch) * 0.15 - 0.02), (L + 2 * ov, 0.03, 0.18), R3)
    # Gable ends: white bargeboards and a fretwork frieze (a valance of pickets with a scalloped edge).
    for e in (-1, 1):
        u = e * (L / 2 + ov)
        for s in (-1, 1):
            C.flatbar(b, "rp_frame", M["white"], [F.W(u, s * half, EAVE - 0.05), F.W(u, 0, RIDGE + 0.02)], w=0.24, t=0.04, up=(0, 0, 1))
        # Frieze: a rail under the gable at the eave line, with pickets and droplets below it.
        C.box(b, "rp_frame", M["white"], F.W(u - e * 0.05, 0, EAVE - 0.05), (0.05, 2 * half - 0.4, 0.07), R3)
        C.box(b, "rp_frame", M["white"], F.W(u - e * 0.05, 0, EAVE - 0.38), (0.05, 2 * half - 0.6, 0.05), R3)
        n = 34
        for k in range(n + 1):
            v = -half + 0.3 + k * (2 * half - 0.6) / n
            C.box(b, "rp_frieze", M["white"], F.W(u - e * 0.05, v, EAVE - 0.24), (0.03, 0.05, 0.3 if k % 2 else 0.42), R3)

    # Track: two rails on sleepers, full length of the shelter.
    G = 1.067 / 2
    for s in (-1, 1):
        C.box(b, "rp_steel", M["steel"], F.W(0, s * G, 0.19), (L - 0.6, 0.07, 0.12), R3)
    for k in range(17):
        u = -L / 2 + 0.5 + k * (L - 1.0) / 16
        C.box(b, "rp_sleepers", M["grey"], F.W(u, 0, 0.065), (0.22, 1.9, 0.13), R3)
    RT = 0.25  # rail top

    # ---- Kate: u along the shelter, smokebox to +u; uk is her middle.
    uk = 1.6

    def K(u, v, z):
        return F.W(uk + u, v, RT + z)

    def cyl_u(name, mat, u0, u1, v, z, r, sides=14, caps=True):
        C.cylinder(b, name, mat, K(u0, v, z), K(u1, v, z), r, sides=sides, caps=caps)

    def cyl_z(name, mat, u, v, z0, z1, r, sides=12):
        C.cylinder(b, name, mat, K(u, v, z0), K(u, v, z1), r, sides=sides)

    def kbox(name, mat, u, v, z, size):
        C.box(b, name, mat, K(u, v, z), size, R3)

    # Frames and footplate: the physics box is the main frame block.
    kbox("1WALL_rp_kate", M["black"], 0.0, 0, 0.62, (4.4, 1.3, 0.6))
    kbox("rp_black", M["black"], 0.0, 0, 0.97, (4.5, 1.85, 0.08))
    # Buffer beams, buffers and couplings.
    for e in (-1, 1):
        kbox("rp_red", M["red"], e * 2.3, 0, 0.72, (0.12, 1.9, 0.38))
        cyl_u("rp_black", M["black"], e * 2.36, e * 2.62, 0, 0.72, 0.09, sides=8)
        C.box(b, "rp_black", M["black"], K(e * 2.66, 0, 0.72), (0.06, 0.32, 0.32), R3)
    # Wheels: 0-4-0, 0.76 m, inside the frames; the axleboxes and springs on the frame face.
    for u in (-0.75, 0.65):
        for s in (-1, 1):
            C.cylinder(b, "rp_wheels", M["black"], K(u, s * 0.47, 0.38), K(u, s * 0.6, 0.38), 0.38, sides=16)
            kbox("rp_yellow", M["yellow"], u, s * 0.66, 0.62, (0.22, 0.04, 0.18))
        C.cylinder(b, "rp_steel", M["steel"], K(u, -0.62, 0.38), K(u, 0.62, 0.38), 0.06, sides=6)
    # Outside cylinders under the smokebox and the slide bars and rods back to the coupled wheels.
    for s in (-1, 1):
        cyl_u("rp_black", M["black"], 1.15, 1.95, s * 0.82, 0.62, 0.2)
        C.flatbar(b, "rp_steel", M["steel"], [K(1.1, s * 0.8, 0.62), K(0.65, s * 0.72, 0.5), K(-0.75, s * 0.72, 0.5)], w=0.08, t=0.04, up=(0, 0, 1))
    # Boiler (red) and smokebox (black), the smokebox door and its handles.
    cyl_u("rp_red", M["red"], -0.95, 1.15, 0, 1.55, 0.52, sides=18)
    for x in (-0.55, 0.0, 0.6):  # boiler bands
        cyl_u("rp_black", M["black"], x, x + 0.04, 0, 1.55, 0.535, sides=18, caps=False)
    cyl_u("rp_black", M["black"], 1.15, 2.02, 0, 1.52, 0.6, sides=18)
    cyl_u("rp_black", M["black"], 2.02, 2.08, 0, 1.52, 0.5, sides=18)
    kbox("rp_black", M["black"], 1.6, 0, 1.08, (0.8, 0.9, 0.3))
    C.box(b, "rp_steel", M["steel"], K(2.1, 0, 1.52), (0.04, 0.28, 0.05), R3)
    # Chimney: tall plain stack with a cap; the dome and safety valve in yellow; whistle.
    cyl_z("rp_black", M["black"], 1.6, 0, 2.0, 3.25, 0.17, sides=12)
    cyl_z("rp_black", M["black"], 1.6, 0, 3.15, 3.3, 0.21, sides=12)
    cyl_z("rp_yellow", M["yellow"], 0.2, 0, 1.9, 2.3, 0.3, sides=14)
    cyl_z("rp_yellow", M["yellow"], 0.2, 0, 2.3, 2.42, 0.2, sides=12)
    cyl_z("rp_yellow", M["yellow"], 0.2, 0, 2.42, 2.65, 0.07, sides=8)
    cyl_z("rp_steel", M["steel"], -0.75, 0, 2.0, 2.45, 0.04, sides=6)
    # Yellow boiler brackets (saddles) down to the footplate.
    for u in (-0.4, 0.5):
        for s in (-1, 1):
            kbox("rp_yellow", M["yellow"], u, s * 0.5, 1.12, (0.32, 0.22, 0.3))
    # Handrails along the boiler.
    for s in (-1, 1):
        cyl_u("rp_steel", M["steel"], -0.9, 1.95, s * 0.62, 1.75, 0.018, sides=4, caps=False)
    # Cab: red; front sheet with two round spectacles; open sides above the waist; roof.
    c0, c1, CW, CT = -2.3, -0.95, 1.8, 2.75
    kbox("rp_red", M["red"], c1 - 0.03, 0, (1.0 + CT) / 2, (0.06, CW, CT - 1.0))
    for s in (-1, 1):
        C.cylinder(b, "rp_black", M["black"], K(c1 + 0.01, s * 0.45, 2.25), K(c1 + 0.04, s * 0.45, 2.25), 0.19, sides=12)
        kbox("rp_red", M["red"], (c0 + c1) / 2, s * CW / 2, 1.42, (c1 - c0, 0.05, 0.85))   # waist sheets
        kbox("rp_red", M["red"], c1 - 0.1, s * CW / 2, 2.2, (0.2, 0.05, 1.1))              # front pillars
        kbox("rp_red", M["red"], c0 + 0.08, s * CW / 2, 2.2, (0.16, 0.05, 1.1))            # rear pillars
        cyl_z("rp_black", M["black"], c0 + 0.35, s * (CW / 2 - 0.05), 1.85, 2.7, 0.015, sides=4)  # grab handles
    kbox("rp_red", M["red"], c0 + 0.03, 0, 1.7, (0.06, CW, 1.4))                            # rear sheet
    C.box(b, "rp_white", M["white"], K(c0 - 0.005, 0.25, 1.75), (0.012, 0.55, 0.65), R3)  # plaque (plain)
    for s in (-1, 1):
        C.flatbar(b, "rp_red", M["red"], [K(c0 - 0.06, s * 0.45, CT + 0.03), K((c0 + c1) / 2, s * 0.45, CT + 0.08), K(c1 + 0.05, s * 0.45, CT + 0.03)],
                  w=1.0, t=0.04, up=(0, 0, 1))
    # Bunker behind the cab, yellow with a black rim.
    kbox("rp_yellow", M["yellow"], c0 - 0.22, 0, 1.38, (0.36, 1.5, 0.75))
    kbox("rp_black", M["black"], c0 - 0.22, 0, 1.77, (0.4, 1.55, 0.05))
    # Cab steps.
    for s in (-1, 1):
        kbox("rp_black", M["black"], c0 + 0.3, s * 0.95, 0.55, (0.32, 0.12, 0.05))

    # ---- The log bogie behind her (coupled), red-brown, three logs.
    uw = uk - 2.3 - 0.4 - 2.0     # bogie middle

    def Wg(u, v, z):
        return F.W(uw + u, v, RT + z)

    C.box(b, "1WALL_rp_bogie", M["wagon"], Wg(0, 0, 0.55), (3.8, 1.5, 0.3), R3)
    for u in (-1.6, -0.55, 0.55, 1.6):
        C.box(b, "rp_wagon", M["wagon"], Wg(u, 0, 0.78), (0.3, 1.75, 0.16), R3)
        for s in (-1, 1):
            C.box(b, "rp_wagon", M["wagon"], Wg(u, s * 0.82, 0.95), (0.2, 0.12, 0.25), R3)
    for e in (-1, 1):
        C.box(b, "rp_black", M["black"], Wg(e * 1.95, 0, 0.55), (0.1, 0.25, 0.2), R3)
    for u in (-1.1, 1.1):
        for s in (-1, 1):
            C.cylinder(b, "rp_wheels", M["black"], Wg(u, s * 0.47, 0.3), Wg(u, s * 0.58, 0.3), 0.3, sides=14)
            C.box(b, "rp_black", M["black"], Wg(u, s * 0.7, 0.42), (0.35, 0.06, 0.22), R3)
    for (v, z, r, ln) in ((-0.38, 1.18, 0.34, 3.4), (0.38, 1.16, 0.32, 3.2), (0.0, 1.72, 0.33, 3.0)):
        a, c = Wg(-ln / 2 - 0.1, v, z), Wg(ln / 2 - 0.1, v, z)
        C.cylinder(b, "rp_logs", M["log"], a, c, r, sides=10, caps=False)
        for p, q in ((a, a - F.H * 0.01), (c, c + F.H * 0.01)):
            C.cylinder(b, "rp_logends", M["logend"], p, q, r * 0.98, sides=10)
    # The chain over the logs.
    C.tube(b, "rp_steel", M["steel"], [Wg(0.3, -0.85, 0.9), Wg(0.3, -0.7, 1.75), Wg(0.3, 0, 2.08), Wg(0.3, 0.7, 1.75), Wg(0.3, 0.85, 0.9)], 0.02, sides=4)

    # ---- Platform and ramp to the footplate on the right side (+v), timber with a white rail.
    PZ = 0.95
    pu0, pu1 = uk - 2.6, uk + 0.4
    C.box(b, "rp_deck", M["timber"], F.W((pu0 + pu1) / 2, 1.85, PZ / 2), (pu1 - pu0, 1.3, PZ), R3)
    ramp_len = 4.0
    r0 = pu0 - ramp_len
    p1, p2 = F.W(r0, 1.2, 0.02), F.W(r0, 2.5, 0.02)
    p3, p4 = F.W(pu0, 2.5, PZ), F.W(pu0, 1.2, PZ)
    b.add("rp_deck", M["timber"], [p1, p2, p3, p4], [(0, 3, 2, 1)])
    b.add("rp_deck", M["timber"], [F.W(r0, 2.5, 0), F.W(pu0, 2.5, 0), F.W(pu0, 2.5, PZ)], [(0, 1, 2)])
    for u in [pu0 + k * (pu1 - pu0) / 4 for k in range(5)]:
        C.box(b, "rp_frame", M["white"], F.W(u, 2.45, PZ + 0.5), (0.07, 0.07, 1.0), R3)
    C.box(b, "rp_frame", M["white"], F.W((pu0 + pu1) / 2, 2.45, PZ + 1.0), (pu1 - pu0, 0.07, 0.07), R3)
    C.box(b, "rp_frame", M["white"], F.W((pu0 + pu1) / 2, 2.45, PZ + 0.5), (pu1 - pu0, 0.04, 0.05), R3)
    C.flatbar(b, "rp_frame", M["white"], [F.W(r0, 2.45, 1.0), F.W(pu0, 2.45, PZ + 1.0)], w=0.07, t=0.07, up=(0, 0, 1))
    for k in range(4):
        u = r0 + k * ramp_len / 3
        C.box(b, "rp_frame", M["white"], F.W(u, 2.45, (u - r0) / ramp_len * PZ + 0.5), (0.07, 0.07, 1.0), R3)
    # Interpretive sign at the car park end (a plain board on two posts).
    C.box(b, "rp_timber", M["timber"], F.W(-L / 2 - 1.2, -1.6, 0.6), (0.08, 0.08, 1.2), R3)
    C.box(b, "rp_timber", M["timber"], F.W(-L / 2 - 1.2, -0.4, 0.6), (0.08, 0.08, 1.2), R3)
    C.box(b, "rp_black", M["black"], F.W(-L / 2 - 1.2, -1.0, 1.1), (0.05, 1.3, 0.8), R3)

    # ---------------- The footbridge ----------------
    pr = C.Projection(ORIGIN)
    ax, ay = pr.to_local(*BRIDGE_A)
    bx, by = pr.to_local(*BRIDGE_B)
    span = math.hypot(bx - ax, by - ay)
    hb = math.degrees(math.atan2(bx - ax, by - ay))
    BF = Frame(BRIDGE_A, hb)
    za = gz(BF.W(-0.5, 0, 0), zc)
    zb = gz(BF.W(span + 0.5, 0, 0), za)
    print(f"footbridge {span:.1f} m at {hb:.0f} deg, ends ground {za:.2f} / {zb:.2f}")
    BR = BF.rot()
    BF.z0 = za

    # The base has no river channel here (30 m DEM, no water mesh), so keep the deck clear of the
    # ground all along: lift the straight line between the ends until it clears every sample.
    lift = 0.0
    for k in range(13):
        u = span * k / 12
        g = ground(*BF.W(u, 0, 0).xy)
        if g is not None:
            lift = max(lift, g + 0.25 - (za + (zb - za) * u / span + 0.15))
    print(f"footbridge deck lifted {lift:.2f} m over the base ground")

    def deck_z(u):
        return za + (zb - za) * max(0.0, min(1.0, u / span)) + 0.15 + lift

    DW = 1.5
    n = max(2, round(span / 2.4))
    step = span / n
    for k in range(n):
        u0, u1 = k * step, (k + 1) * step
        um = (u0 + u1) / 2
        p = BF.W(um, 0, 0)
        p.z = (deck_z(u0) + deck_z(u1)) / 2
        slope = math.atan2(deck_z(u1) - deck_z(u0), step)
        verts = []
        for (u, z) in ((u0, deck_z(u0)), (u1, deck_z(u1))):
            for v in (-DW / 2, DW / 2):
                for dz in (0.0, -0.08):
                    q = BF.W(u, v, 0)
                    q.z = z + dz
                    verts.append(q)
        # verts: (u0,-v,top),(u0,-v,bot),(u0,+v,top),(u0,+v,bot),(u1,...)
        faces = [(0, 2, 6, 4), (1, 5, 7, 3), (0, 4, 5, 1), (2, 3, 7, 6), (0, 1, 3, 2), (4, 6, 7, 5)]
        b.add("rp_bridge_deck", M["grey"], verts, faces)
    # Stringers, posts, top rail and the wires of the mesh rail; pile bents every other post.
    for s in (-1, 1):
        pts = [BF.W(u, s * (DW / 2 + 0.05), 0) for u in (0, span)]
        for p, u in zip(pts, (0, span)):
            p.z = deck_z(u) - 0.2
        C.flatbar(b, "rp_bridge", M["grey"], pts, w=0.25, t=0.1, up=(0, 0, 1))
        for k in range(n + 1):
            u = k * step
            base = BF.W(u, s * (DW / 2 + 0.05), 0)
            base.z = deck_z(u) - 0.3
            top = base.copy()
            top.z = deck_z(u) + 1.15
            C.box(b, "rp_bridge", M["grey"], (base + top) / 2, (0.11, 0.11, top.z - base.z), BR)
        for hgt, w in ((1.15, 0.14), (0.95, 0.0), (0.7, 0.0), (0.45, 0.0), (0.2, 0.0)):
            pts = [BF.W(u, s * (DW / 2 + 0.05), 0) for u in (0, span)]
            for p, u in zip(pts, (0, span)):
                p.z = deck_z(u) + hgt
            if w:
                C.flatbar(b, "rp_bridge", M["grey"], pts, w=w, t=0.05, up=(0, 0, 1))
            else:
                C.tube(b, "rp_wire", M["steel"], pts, 0.01, sides=4, caps=False)
    for k in range(0, n + 1, 2):
        u = k * step
        piles = []
        for s in (-1, 1):
            top = BF.W(u, s * (DW / 2 - 0.1), 0)
            top.z = deck_z(u) - 0.1
            g = ground(top.x, top.y)
            foot = top.copy()
            foot.z = min(top.z - 2.5, (g if g is not None else top.z - 2.5) - 0.5)
            C.cylinder(b, "rp_bridge", M["grey"], foot, top, 0.14, sides=8)
            piles.append((foot, top))
        C.box(b, "rp_bridge", M["grey"], (piles[0][1] + piles[1][1]) / 2 - Vector((0, 0, 0.12)), (0.2, DW + 0.4, 0.2), BR)
        mid = [(f + t) / 2 for f, t in piles]
        C.flatbar(b, "rp_bridge", M["grey"], [piles[0][1] - Vector((0, 0, 0.3)), piles[1][0] + (piles[1][1] - piles[1][0]) * 0.4], w=0.14, t=0.06)
        del mid

    # ---------------- The entrance gate ----------------
    GF = Frame(GATE, GATE_HEADING, zc)
    g0 = ground(GF.O.x, GF.O.y)
    if g0 is None:
        print("note: no ground under the gate (outside the build area); gate left out")
    else:
        gs = [gz(GF.W(0, v, 0), g0) for v in (-3.0, 3.0)]
        GF.z0 = min(gs)
        GR = GF.rot()
        for v, gzv in zip((-3.0, 3.0), gs):
            C.cylinder(b, "1WALL_rp_gate", M["white"], GF.W(0, v, gzv - GF.z0 - 0.3), GF.W(0, v, 3.1), 0.17, sides=10)
        C.box(b, "rp_gate", M["white"], GF.W(0, 0, 3.25), (0.32, 7.6, 0.4), GR)
        # Plain lettering both faces: text converted to mesh.
        for face in (-1, 1):
            cu = bpy.data.curves.new("rp_text", "FONT")
            cu.body = "ROTARY PARK"
            cu.size = 0.3
            cu.extrude = 0.008
            cu.align_x = "CENTER"
            cu.align_y = "CENTER"
            ob = bpy.data.objects.new("rp_text_tmp", cu)
            bpy.context.scene.collection.objects.link(ob)
            dg = bpy.context.evaluated_depsgraph_get()
            me = ob.evaluated_get(dg).to_mesh()
            # Text lies in its XY plane: x along the beam (v), y up (z), placed on the face.
            rv = 1 if face < 0 else -1
            verts = [GF.W(face * 0.17, rv * vv.co.x, 3.24 + vv.co.y) + GF.H * face * vv.co.z for vv in me.vertices]
            faces = [tuple(p.vertices) if face < 0 else tuple(reversed(p.vertices)) for p in me.polygons]
            b.add("rp_letters", M["black"], verts, faces)
            ob.evaluated_get(dg).to_mesh_clear()
            bpy.data.objects.remove(ob, do_unlink=True)
            bpy.data.curves.remove(cu)

    objs = b.build(layer)
    print(f"rotary park: {len(objs)} objects, {b.triangles()} triangles")
    return F, BF, GF, span


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", help="layer file (else the open file)")
    ap.add_argument("--render")
    ap.add_argument("--view", default="kate", choices=["kate", "cab", "bridge", "gate", "high"])
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--res", default="960x540")
    a = ap.parse_args(C.args_after_dashes())
    if a.blend:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))
    layer = C.reset_layer()
    F, BF, GF, span = build(layer)
    bpy.ops.wm.save_mainfile()
    print(f"saved {bpy.data.filepath}")
    if a.render:
        views = {
            # Side-on from the platform side, smokebox to the right, as in the 2024 photo.
            "kate": (F.W(2.6, 9.5, 1.7), F.W(0.2, 0, 1.6), 24),
            "cab": (F.W(-8.5, -2.2, 1.7), F.W(-1.0, 0.3, 1.5), 28),
            "bridge": (BF.W(-7, -2.5, 1.9), BF.W(span * 0.5, 0, 0.6), 30),
            "gate": (GF.W(-14, 1.0, 1.6), GF.W(4, 0, 1.8), 26),
            "high": (F.W(-10, 18, 16), F.W(4, 0, 0), 22),
        }
        eye, tgt, lens = views[a.view]
        w, h = (int(x) for x in a.res.lower().split("x"))
        C.render(os.path.abspath(a.render), eye, tgt, lens=lens, samples=a.samples, res=(w, h), sun=(0.3, -0.5, 0.8))


main()
