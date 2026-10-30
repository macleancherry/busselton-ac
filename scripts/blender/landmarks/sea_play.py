"""Sea Play on the Bay (Busselton Foreshore Playspace, PLAN E 2018) as a hand-made detail layer.

    python3 scripts/blender/landmarks/sea_play.py -- --blend <layer.blend> [--render <out.png>] [--view beach|path|high|stern] [--samples 16] [--res 960x540]

(or blender --background <layer.blend> --python scripts/blender/landmarks/sea_play.py -- ...)

Opens the layer file from scripts/blender/new_layer.py, rebuilds the "Layer" collection and saves it.
Then scripts/blender/export_layer.py and scripts/blender/make_layer.ts make the kn5; the whole chain is
scripts/blender/landmarks/build.sh sea_play.

What it models (docs/landmarks/sea_play.md): the timber clipper half sunk in the sand and heeled towards
the beach (a curved hull with a rounded stern, raked bow and bulwarks, the stern castle and deckhouse,
crates), the leaning white main mast with its yards, bowsprit, shrouds and stays, black rope climbing
nets, the slatted crow's nest barrel, the timber wharf off the stern with the old wharf piles, the navy
rib arch and timber ramp and the white lattice fish at the bow, the orange squid (lattice mantle,
tentacle arches, the tall tentacle paddle, the swing arch and basket), the blue whale tail and canopy,
sandstone boulders and the low concrete seat walls. The ground colours (white sand, blue concrete) are
left to the base's aerial photo.

Physics: only the hull's outer shell, as 1WALL_hull. Everything else is visual.

Ship frame: s metres along the ship from the stern (towards the bow), c across it to port (towards the
beach, north), z up from the ground at the stern castle. The heel turns the hull about the s axis.
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
from mathutils import Matrix, Vector  # noqa: E402

ORIGIN = (115.3403, -33.6506)          # routes/busselton.json build.origin
STERN = (115.344047, -33.645000)       # stern centre, from the Landgate aerial
BOW = (115.344317, -33.644943)         # bow tip
WHALE = (115.344006, -33.644907)
SQUID = (115.344360, -33.644843)       # middle of the lattice mantle
AERIAL_CENTRE = (115.34422, -33.644943)
HEEL = 16.0                            # hull heel towards the beach, degrees
MAST_LEAN = 27.0                       # total lean of the mast from vertical (photos: 25 to 30)

HULL = "#7a3a22"
DECK = "#9a6a44"
WHITE = "#f1f1ee"
ROPE = "#2b2a28"
WHARF = "#8f877c"
PILE = "#7b6a58"
GREEN = "#4c8f52"
ORANGE = "#e8581c"
WHALE_BLUE = "#2e64ad"
NAVY = "#25416a"
STONE = "#c69c62"
CONCRETE = "#d3cec4"
CRATE = "#b48a56"


class Ship:
    def __init__(self):
        p = C.Projection(ORIGIN)
        self.p = p
        sx, sy = p.to_local(*STERN)
        bx, by = p.to_local(*BOW)
        self.O = Vector((sx, sy, 0))
        d = Vector((bx - sx, by - sy, 0))
        self.L = d.length
        self.S = d.normalized()
        self.Cv = Vector((-self.S.y, self.S.x, 0))  # left of the bow direction: north-ish, the beach
        self.bearing = math.degrees(math.atan2(self.S.x, self.S.y)) % 360
        self.z0 = 0.0

    def local(self, lng, lat):
        x, y = self.p.to_local(lng, lat)
        v = Vector((x, y, 0)) - self.O
        return v.dot(self.S), v.dot(self.Cv)

    def W(self, s, c, z, heel=0.0):
        """World point from ship coordinates; heel (degrees) turns (c, z) about the s axis at ground."""
        if heel:
            h = math.radians(heel)
            c, z = c * math.cos(h) + z * math.sin(h), -c * math.sin(h) + z * math.cos(h)
        return self.O + self.S * s + self.Cv * c + Vector((0, 0, self.z0 + z))


def build(layer):
    sh = Ship()
    L = sh.L
    ground = C.ground_sampler(lambda n: re.match(r"^\d(?!WALL)", n) is not None)
    mid = sh.W(L / 2, 0, 0)
    g = ground(mid.x, mid.y)
    sh.z0 = g if g is not None else 0.0
    print(f"ship {L:.1f} m, bearing {sh.bearing:.0f}, ground z {sh.z0:.2f}")

    def gz(s, c):
        p = sh.W(s, c, 0)
        h = ground(p.x, p.y)
        return (h if h is not None else sh.z0) - sh.z0

    M = {
        "hull": C.material("seaplay_hull", HULL, 0.55),
        "deck": C.material("seaplay_deck", DECK, 0.7),
        "white": C.material("seaplay_white", WHITE, 0.4, 0.3),
        "rope": C.material("seaplay_rope", ROPE, 0.9),
        "wharf": C.material("seaplay_wharf", WHARF, 0.9),
        "pile": C.material("seaplay_pile", PILE, 0.9),
        "green": C.material("seaplay_green", GREEN, 0.7),
        "orange": C.material("seaplay_orange", ORANGE, 0.45, 0.2),
        "whale": C.material("seaplay_whale", WHALE_BLUE, 0.45, 0.2),
        "navy": C.material("seaplay_navy", NAVY, 0.5, 0.2),
        "stone": C.material("seaplay_stone", STONE, 0.95),
        "concrete": C.material("seaplay_concrete", CONCRETE, 0.9),
        "crate": C.material("seaplay_crate", CRATE, 0.8),
    }
    b = C.Builder()
    rnd = random.Random(2018)
    W = sh.W

    # ---------------- the hull ----------------
    def beam(s):
        """Half-beam at s: a rounded stern, full amidships, a fine raked bow."""
        if s < 2.4:
            t = max(s, 0) / 2.4
            hb = 1.45 + 0.8 * math.sin(t * math.pi / 2)
        else:
            hb = 2.25
        f = (s - 0.55 * L) / (0.45 * L)
        if f > 0:
            hb *= max(0.03, math.cos(min(f, 1) * math.pi / 2) ** 0.8)
        return hb

    def sheer(s):
        """Top of the bulwark above the ground: the stern castle, low waist, rising bow."""
        castle = 3.0 if s < 5.0 else 1.55
        if 4.7 < s < 5.0:
            castle = 3.0 - (s - 4.7) / 0.3 * 1.45
        f = (s - 0.62 * L) / (0.38 * L)
        if f > 0:
            castle = 1.55 + 1.95 * min(f, 1) ** 1.6
        return castle

    def deck_h(s):
        return sheer(s) - (0.95 if s < 5.0 else 0.85)

    KEEL = -0.9
    stations = [0.0, 0.6, 1.3, 2.2, 3.2, 4.4, 4.7, 5.0, 5.3, 7.0, 9.0, 11.0, 13.0]
    s = 13.0
    while s < L - 0.01:
        s = min(L, s + (2.0 if s < 0.6 * L else 1.2))
        stations.append(s)

    def section(s):
        """Half section from the bulwark top down to the keel, port side (c > 0)."""
        hb, h = beam(s), sheer(s)
        return [(hb * 0.97, h), (hb, h * 0.55), (hb * 0.97, 0.0), (hb * 0.8, -0.45), (hb * 0.45, -0.78), (0.0, KEEL)]

    # Outer shell, the collidable one. Ring: port top -> keel -> starboard top.
    ring_n = 11
    verts, faces = [], []
    for s in stations:
        half = section(s)
        ring = [(c, z) for (c, z) in half] + [(-c, z) for (c, z) in reversed(half[:-1])]
        verts += [W(s, c, z, HEEL) for (c, z) in ring]
    for i in range(len(stations) - 1):
        a, bb = i * ring_n, (i + 1) * ring_n
        for k in range(ring_n - 1):
            faces.append((a + k, bb + k, bb + k + 1, a + k + 1))  # outward
    # The transom (rounded stern face) closed flat.
    faces.append(tuple(range(ring_n)))
    b.add("1WALL_hull", M["hull"], verts, faces)

    # Inner bulwarks, the cap rail, and the decks.
    T = 0.09
    inner_l, inner_r, cap = [], [], []
    for s in stations:
        hb, h, d = beam(s), sheer(s), deck_h(s)
        wi = max(hb * 0.97 - T, 0.02)
        inner_l.append((W(s, wi, h, HEEL), W(s, wi, d, HEEL), W(s, hb * 0.97, h, HEEL)))
        inner_r.append((W(s, -wi, h, HEEL), W(s, -wi, d, HEEL), W(s, -hb * 0.97, h, HEEL)))
    for side, flip in ((inner_l, False), (inner_r, True)):
        v, f = [], []
        for (top, bot, outer) in side:
            v += [top, bot, outer]
        for i in range(len(side) - 1):
            a, c2 = i * 3, (i + 1) * 3
            q1 = (a, c2, c2 + 1, a + 1)          # inner face, top to deck
            q2 = (a + 2, c2 + 2, c2, a)          # cap rail, outer edge to inner
            f += [q1 if flip else tuple(reversed(q1)), q2 if flip else tuple(reversed(q2))]
        b.add("seaplay_hull_inner", M["hull"], v, f)
    # Deck: a strip between the inner bulwarks, with the step at the castle front.
    v, f = [], []
    for (tl, bl, _), (tr, br, _) in zip(inner_l, inner_r):
        v += [bl, br]
    for i in range(len(stations) - 1):
        a = i * 2
        f.append((a, a + 1, a + 3, a + 2))
    b.add("seaplay_deck", M["deck"], v, f)
    # The castle front wall (deck to castle deck) with a dark doorway, and a rail along its top.
    sc = 5.0
    wl, dl = beam(sc) * 0.97 - T, deck_h(sc + 0.31)
    dh = deck_h(sc - 0.31)
    C.quad2(b, "seaplay_hull_inner", M["hull"], [W(sc, -wl, dl, HEEL), W(sc, wl, dl, HEEL), W(sc, wl, dh, HEEL), W(sc, -wl, dh, HEEL)])
    C.quad2(b, "seaplay_rope_net", M["rope"], [W(sc + 0.02, -0.45, dl, HEEL), W(sc + 0.02, 0.45, dl, HEEL), W(sc + 0.02, 0.45, dl + 1.25, HEEL), W(sc + 0.02, -0.45, dl + 1.25, HEEL)])
    rail_z = dh + 0.9
    C.tube(b, "seaplay_white_rig", M["white"], [W(sc, -wl, rail_z, HEEL), W(sc, wl, rail_z, HEEL)], 0.03, sides=5)
    for c in (-wl, -wl / 2, 0, wl / 2, wl):
        C.tube(b, "seaplay_white_rig", M["white"], [W(sc, c, dh, HEEL), W(sc, c, rail_z, HEEL)], 0.02, sides=4)
    # Stern deckhouse with a pitched lid, and crates amidships.
    R_heel = Matrix.Rotation(math.radians(-HEEL), 3, sh.S)
    R_ship = Matrix((sh.S, sh.Cv, Vector((0, 0, 1)))).transposed()
    Rh = R_heel @ R_ship
    C.box(b, "seaplay_hull_inner", M["hull"], W(1.9, -0.3, dh + 0.8, HEEL), (2.0, 1.8, 1.6), Rh)
    C.box(b, "seaplay_deck", M["deck"], W(1.9, -0.3, dh + 1.65, HEEL), (2.3, 2.1, 0.12), Rh)
    for (s, c, w, hgt) in [(8.2, 0.9, 0.9, 0.7), (8.9, 1.1, 0.7, 0.6), (8.4, -1.0, 1.0, 0.8), (10.4, -0.6, 0.8, 0.6), (15.5, 0.8, 0.8, 0.7)]:
        C.box(b, "seaplay_crate", M["crate"], W(s, c, deck_h(s) + hgt / 2, HEEL), (w, w, hgt), Rh)
    # Nameplate on the transom: a white board (no lettering).
    C.box(b, "seaplay_white_rig", M["white"], W(-0.08, 0, 2.2, HEEL), (0.04, 1.5, 0.32), Rh)

    # ---------------- mast, yards, bowsprit, rigging ----------------
    ms = 0.46 * L
    lean = math.radians(MAST_LEAN)
    mdir = Vector((0, math.sin(lean), math.cos(lean)))  # in (s, c, z)

    def mpt(t, ds=0.0, dc=0.0):
        """Point t metres up the mast (from the keelson at deck level), offset ds along the ship, dc across."""
        base = Vector((ms, 0, deck_h(ms) - 0.4))
        side = Vector((0, math.cos(lean), -math.sin(lean)))
        p = base + mdir * t + Vector((ds, 0, 0)) + side * dc
        return W(p.x, p.y, p.z)

    MAST = 12.5
    C.tube(b, "seaplay_white_rig", M["white"], [mpt(0), mpt(MAST * 0.55)], 0.14, sides=8)
    C.tube(b, "seaplay_white_rig", M["white"], [mpt(MAST * 0.55), mpt(MAST)], 0.1, sides=8)
    C.tube(b, "seaplay_white_rig", M["white"], [mpt(MAST), mpt(MAST + 0.25)], 0.17, sides=8)
    yards = [(4.6, 3.8), (6.2, 3.6), (7.7, 3.3), (9.0, 2.9), (10.2, 2.4), (11.3, 1.9), (12.2, 1.4)]
    for (t, half) in yards:
        C.tube(b, "seaplay_white_rig", M["white"], [mpt(t, dc=-half), mpt(t, dc=half)], 0.045, sides=6)
    # The crow's nest: a slatted timber barrel round the mast with a floor.
    nest_t0, nest_h, nest_r = 4.9, 1.5, 0.9
    slats = 14
    for k in range(slats):
        a = 2 * math.pi * k / slats
        ds, dc = nest_r * math.cos(a), nest_r * math.sin(a)
        p0, p1 = mpt(nest_t0, ds, dc), mpt(nest_t0 + nest_h, ds * 1.08, dc * 1.08)
        C.flatbar(b, "seaplay_deck", M["deck"], [p0, p1], w=0.32, t=0.04, up=(p0 - mpt(nest_t0)).normalized())
    for t in (nest_t0 + 0.05, nest_t0 + nest_h - 0.05):
        loop = [mpt(t, nest_r * 1.04 * math.cos(2 * math.pi * k / 16), nest_r * 1.04 * math.sin(2 * math.pi * k / 16)) for k in range(17)]
        C.tube(b, "seaplay_white_rig", M["white"], loop, 0.025, sides=4, caps=False)
    floor = [mpt(nest_t0 + 0.1, nest_r * math.cos(2 * math.pi * k / 12), nest_r * math.sin(2 * math.pi * k / 12)) for k in range(12)]
    C.plate(b, "seaplay_deck", M["deck"], floor, thick=0.06)
    # Bowsprit, forestay and backstays.
    bow_top = W(L - 0.15, 0, sheer(L - 0.15), HEEL)
    sprit_dir = (sh.S * math.cos(math.radians(22)) + Vector((0, 0, math.sin(math.radians(22)))))
    sprit_end = bow_top + sprit_dir * 5.5
    C.tube(b, "seaplay_white_rig", M["white"], [W(L - 2.5, 0, sheer(L - 2.5) - 0.2, HEEL), sprit_end], 0.09, sides=6)
    rope_r = 0.014
    C.tube(b, "seaplay_rope_lines", M["rope"], [mpt(MAST - 0.4), sprit_end], rope_r, sides=4)
    C.tube(b, "seaplay_rope_lines", M["rope"], [mpt(MAST - 0.6), W(0.3, 0, sheer(0.3), HEEL)], rope_r, sides=4)
    for (t, half) in yards[:4]:
        C.tube(b, "seaplay_rope_lines", M["rope"], [mpt(t, dc=-half), mpt(t + 1.3)], rope_r, sides=4, caps=False)
        C.tube(b, "seaplay_rope_lines", M["rope"], [mpt(t, dc=half), mpt(t + 1.3)], rope_r, sides=4, caps=False)
    # Shrouds with ratlines (the climbing nets) from the nest down to the bulwarks on both sides.
    for side in (1, -1):
        top_pts = [mpt(nest_t0, ds, side * nest_r * 0.7) for ds in (-0.7, 0.0, 0.7)]
        foot_pts = [W(ms + ds, side * (beam(ms + ds) * 0.97), sheer(ms + ds), HEEL) for ds in (-1.8, 0.0, 1.8)]
        for a_, f_ in zip(top_pts, foot_pts):
            C.tube(b, "seaplay_rope_lines", M["rope"], [f_, a_], rope_r * 1.6, sides=4)
        # Net: a mesh grid between the outer shrouds; cords as thin tubes.
        n_r = 8
        for i in range(1, n_r):
            t = i / n_r
            l = foot_pts[0].lerp(top_pts[0], t)
            r = foot_pts[2].lerp(top_pts[2], t)
            m_ = foot_pts[1].lerp(top_pts[1], t)
            C.tube(b, "seaplay_rope_lines", M["rope"], [l, m_, r], rope_r, sides=3, caps=False)
        for j in (0.25, 0.75):
            f_ = foot_pts[0].lerp(foot_pts[2], j)
            a_ = top_pts[0].lerp(top_pts[2], j)
            C.tube(b, "seaplay_rope_lines", M["rope"], [f_, a_], rope_r, sides=3, caps=False)
    # A cargo net hung over the port (beach) side amidships, as in the photos.
    s0, s1 = 6.0, 9.5
    pts_top = [W(s, beam(s) * 0.97 + 0.03, sheer(s), HEEL) for s in (s0, s1)]
    pts_bot = [W(s, beam(s) * 0.97 + 0.08, 0.15, HEEL) for s in (s0, s1)]
    for i in range(6):
        t = i / 5
        C.tube(b, "seaplay_rope_lines", M["rope"], [pts_top[0].lerp(pts_top[1], t), pts_bot[0].lerp(pts_bot[1], t)], rope_r, sides=3, caps=False)
    for i in range(4):
        t = i / 3
        C.tube(b, "seaplay_rope_lines", M["rope"], [pts_top[0].lerp(pts_bot[0], t), pts_top[1].lerp(pts_bot[1], t)], rope_r, sides=3, caps=False)

    # ---------------- wharf and piles ----------------
    wl0, wl1, ww, wh = -7.5, -0.2, 3.0, 1.0
    wg = gz(-4, 0)
    C.box(b, "seaplay_wharf", M["wharf"], W((wl0 + wl1) / 2, 0, wg + wh - 0.08), (wl1 - wl0, ww, 0.16), R_ship)
    for s in (wl0 + 0.3, (wl0 + wl1) / 2, wl1 - 0.3):
        for c in (-ww / 2 + 0.2, ww / 2 - 0.2):
            C.cylinder(b, "seaplay_pile", M["pile"], W(s, c, wg - 0.2), W(s, c, wg + wh - 0.16), 0.13, sides=6)
    for c in (-ww / 2 + 0.1, ww / 2 - 0.1):
        C.box(b, "seaplay_wharf", M["wharf"], W((wl0 + wl1) / 2, c, wg + wh + 0.12), (wl1 - wl0, 0.12, 0.12), R_ship)
    # The field of old piles to the west and along the north-west.
    piles = []
    while len(piles) < 22:
        s, c = rnd.uniform(-15, -2.5), rnd.uniform(-7.5, 7.5)
        if abs(c) < 2.0 and s > -8.0:
            continue
        if any((s - a) ** 2 + (c - d) ** 2 < 1.2 ** 2 for a, d in piles):
            continue
        piles.append((s, c))
    for (s, c) in piles:
        h = rnd.uniform(1.6, 4.0)
        z = gz(s, c)
        r = rnd.uniform(0.13, 0.18)
        C.cylinder(b, "seaplay_green", M["green"], W(s, c, z - 0.2), W(s, c, z + 0.7), r * 1.02, sides=7)
        C.cylinder(b, "seaplay_pile", M["pile"], W(s, c, z + 0.7), W(s, c, z + h), r, sides=7)

    # ---------------- bow: timber ramp, navy rib arch, white lattice fish ----------------
    # The ramp runs off the starboard bow down to the sand, under a row of navy ribs.
    r0 = Vector((L - 4.0, -beam(L - 4.0) - 0.3, 0))
    r1 = Vector((L + 3.5, -5.5, 0))
    rdir = (r1 - r0).normalized()
    rside = Vector((-rdir.y, rdir.x, 0))
    rlen = (r1 - r0).length
    z_top = 2.0

    def rp(t, w, h=0.0):
        p = r0 + rdir * t + rside * w
        return W(p.x, p.y, z_top * (1 - t / rlen) + gz(p.x, p.y) * (t / rlen) + h)

    C.quad2(b, "seaplay_deck", M["deck"], [rp(0, -0.9), rp(0, 0.9), rp(rlen, 0.9), rp(rlen, -0.9)])
    for t in [rlen * k / 6 for k in range(7)]:
        arch = [rp(t, 1.15 * math.cos(a), 1.7 * math.sin(a) + 0.0) for a in [math.pi * k / 8 for k in range(9)]]
        C.tube(b, "seaplay_navy", M["navy"], arch, 0.05, sides=5, caps=False)
    for w in (-1.0, 1.0):
        C.tube(b, "seaplay_navy", M["navy"], [rp(0, w, 1.0), rp(rlen, w, 1.0)], 0.04, sides=5)
    C.tube(b, "seaplay_navy", M["navy"], [rp(0, 0, 1.7), rp(rlen, 0, 1.7)], 0.04, sides=5)
    # White lattice fish lying on the sand by the ramp's foot.
    fc = Vector((L + 1.0, -7.2, 0))
    fz = gz(fc.x, fc.y)
    fd = Vector((0.85, 0.5, 0)).normalized()
    fs = Vector((-fd.y, fd.x, 0))
    fl, fhw, fht = 3.4, 0.75, 1.1

    def fp(t, a):
        # t in [-1, 1] along the body; a round the body; a fish-like taper to the tail.
        k = max(0.0, 1 - t * t) ** 0.6
        p = fc + fd * (t * fl / 2) + fs * (fhw * k * math.cos(a))
        return W(p.x, p.y, fz + 0.05 + fht * k * max(math.sin(a), 0.0) * 0.95 + 0.02)

    for a in [math.pi * k / 5 for k in range(6)]:
        C.tube(b, "seaplay_fish", M["white"], [fp(t / 6 - 1, a) for t in range(13)], 0.035, sides=4, caps=False)
    for t in [-0.7, -0.35, 0.0, 0.35, 0.7]:
        C.tube(b, "seaplay_fish", M["white"], [fp(t, math.pi * k / 8) for k in range(9)], 0.035, sides=4, caps=False)
    tail = fc - fd * (fl / 2)
    C.plate(b, "seaplay_fish", M["white"], [W(*(tail).xy, fz + 0.3), W(*(tail - fd * 0.8 + fs * 0.5).xy, fz + 0.9), W(*(tail - fd * 0.8 - fs * 0.5).xy, fz + 0.1)], thick=0.03)

    # ---------------- squid ----------------
    qs, qc = sh.local(*SQUID)
    qd = Vector((math.cos(math.radians(30)), math.sin(math.radians(30)), 0))  # mantle axis in (s, c)
    qn = Vector((-qd.y, qd.x, 0))
    qz = gz(qs, qc)

    def qp(s, c, z):
        return W(s, c, qz + z)

    def mantle(t, a):
        # A lattice cone lying on the sand, the round head end at t = -1, tapering to the tail at t = 1.
        k = max(0.05, math.sin(math.acos(max(-1, min(1, t)))) if t < -0.4 else 1.0 - (t + 0.4) / 1.4 * 0.85)
        r_c, r_z = 1.3 * k, 1.25 * k
        p = Vector((qs, qc, 0)) + qd * (t * 3.0) + qn * (r_c * math.cos(a))
        return qp(p.x, p.y, max(0.0, r_z * math.sin(a)) + 0.02)

    for a in [math.pi * k / 7 for k in range(8)]:
        C.tube(b, "seaplay_orange", M["orange"], [mantle(t / 8 - 1, a) for t in range(17)], 0.04, sides=5, caps=False)
    for t in (-0.75, -0.45, -0.1, 0.25, 0.6):
        C.tube(b, "seaplay_orange", M["orange"], [mantle(t, math.pi * k / 10) for k in range(11)], 0.04, sides=5, caps=False)
    # The eye: an orange disc with a dark pupil on the head end.
    e = Vector((qs, qc, 0)) - qd * 2.1
    eye = [qp(*(e + qn * 1.05 + qd * 0.45 * math.cos(a)).xy, 0.75 + 0.45 * math.sin(a)) for a in [2 * math.pi * k / 12 for k in range(12)]]
    C.plate(b, "seaplay_orange", M["orange"], eye, thick=0.05)
    pupil = [qp(*(e + qn * 1.09 + qd * 0.18 * math.cos(a)).xy, 0.75 + 0.18 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(10)]]
    C.plate(b, "seaplay_rope_lines", M["rope"], pupil, thick=0.05)
    # Tentacle arches across the sand to the south and west of the mantle.
    for (s, c, ang, span, h) in [(-3.5, -1.0, 20, 2.4, 1.3), (-4.8, -3.2, 70, 2.0, 1.0), (-2.0, -3.8, 110, 2.6, 1.6),
                                 (-6.5, -1.2, 150, 2.2, 1.2), (-1.0, -6.0, 40, 2.4, 1.4), (-4.2, -6.4, 90, 2.0, 1.1),
                                 (-7.2, -4.5, 10, 1.8, 0.9), (1.0, -3.2, 160, 2.2, 1.2)]:
        cx, cy = qs + s, qc + c
        d = Vector((math.cos(math.radians(ang)), math.sin(math.radians(ang)), 0))
        z = gz(cx, cy)
        pts = [W(*(Vector((cx, cy, 0)) + d * (span / 2 * math.cos(a))).xy, z + h * math.sin(a) - 0.1) for a in [math.pi * k / 10 for k in range(11)]]
        C.tube(b, "seaplay_orange", M["orange"], pts, 0.08, sides=6, caps=False)
    # The tall tentacle with its spotted paddle.
    tx, ty = qs - 1.5, qc - 5.0
    z = gz(tx, ty)
    tall = C.catmull([W(tx, ty, z - 0.1), W(tx + 0.4, ty - 0.3, z + 1.8), W(tx + 0.2, ty - 0.1, z + 3.4), W(tx - 0.3, ty + 0.2, z + 4.4)], 4)
    C.tube(b, "seaplay_orange", M["orange"], tall, 0.09, sides=6, caps=False)
    paddle = [W(tx - 0.3 + 0.45 * math.cos(a), ty + 0.2 + 0.05 * math.cos(a), z + 4.95 + 0.6 * math.sin(a)) for a in [2 * math.pi * k / 12 for k in range(12)]]
    C.plate(b, "seaplay_orange", M["orange"], paddle, thick=0.05)
    # The swing: an orange arch with a black basket.
    wx, wy = qs - 5.5, qc - 0.5
    z = gz(wx, wy)
    d = Vector((math.cos(math.radians(100)), math.sin(math.radians(100)), 0))
    arch = [W(*(Vector((wx, wy, 0)) + d * (1.8 * math.cos(a))).xy, z + 3.0 * math.sin(a) - 0.1) for a in [math.pi * k / 12 for k in range(13)]]
    C.tube(b, "seaplay_orange", M["orange"], arch, 0.11, sides=6, caps=False)
    bc = W(wx, wy, z + 0.6)
    basket = [bc + Vector((0.55 * math.cos(a), 0.55 * math.sin(a), 0)) for a in [2 * math.pi * k / 12 for k in range(13)]]
    C.tube(b, "seaplay_rope_lines", M["rope"], basket, 0.04, sides=4, caps=False)
    C.plate(b, "seaplay_rope_lines", M["rope"], basket[:-1], thick=0.03)
    for k in range(4):
        a = 2 * math.pi * k / 4 + 0.4
        C.tube(b, "seaplay_rope_lines", M["rope"], [bc + Vector((0.5 * math.cos(a), 0.5 * math.sin(a), 0)), W(wx, wy, z + 2.85)], 0.01, sides=3, caps=False)

    # ---------------- whale ----------------
    hs, hc = sh.local(*WHALE)
    z = gz(hs, hc)
    # A curved stalk (the whale's back) out of the water, up to the tail and a long canopy.
    stalk = C.catmull([W(hs - 1.2, hc - 0.6, z - 0.1), W(hs - 0.6, hc - 0.2, z + 1.2), W(hs - 0.1, hc, z + 2.3), W(hs + 0.3, hc + 0.1, z + 3.1)], 4)
    C.sweep(b, "seaplay_whale", M["whale"], stalk, C.rect_profile(0.55, 0.32), caps=True)
    fl_dir = Vector((1, 0.15, 0)).normalized()
    top = W(hs + 0.3, hc + 0.1, z + 3.15)
    fl_side = Vector((-fl_dir.y, fl_dir.x, 0))
    # The canopy: a long tapered fluke, swept back and up at the tips.
    outline = []
    for k in range(9):
        t = -1 + 2 * k / 8
        outline.append(top + fl_dir * (3.2 * t) + fl_side * (0.9 * (1 - abs(t)) ** 0.5 + 0.15) + Vector((0, 0, 0.35 * t * t)))
    for k in range(9):
        t = 1 - 2 * k / 8
        outline.append(top + fl_dir * (3.2 * t) - fl_side * (0.35 * (1 - abs(t)) + 0.1) + Vector((0, 0, 0.35 * t * t)))
    C.plate(b, "seaplay_whale", M["whale"], outline, thick=0.08)

    # ---------------- boulders and seat walls ----------------
    def boulder(s, c, r):
        z = gz(s, c)
        bm_v, bm_f = icosphere()
        sx, sy, sz = r * rnd.uniform(0.9, 1.3), r * rnd.uniform(0.8, 1.1), r * rnd.uniform(0.55, 0.75)
        rot = Matrix.Rotation(rnd.uniform(0, 6.28), 3, "Z")
        c0 = W(s, c, z + sz * 0.45)
        b.add("seaplay_stone", M["stone"], [c0 + rot @ Vector((v.x * sx, v.y * sy, v.z * sz)) for v in bm_v], bm_f)

    # Places read off the aerial (out/refs/sea_play/aerial40_grid.jpg): metres east, north of its centre.
    cx_, cy_ = sh.p.to_local(*AERIAL_CENTRE)

    def enu(e, n):
        v = Vector((cx_ + e, cy_ + n, 0)) - sh.O
        return v.dot(sh.S), v.dot(sh.Cv)

    for (e0, n0, rad, count) in [(-28, -6, 4.0, 14), (21, 1, 3.0, 10), (-14, 4, 2.0, 6)]:
        for _ in range(count):
            a, r = rnd.uniform(0, 2 * math.pi), rad * math.sqrt(rnd.random())
            boulder(*enu(e0 + r * math.cos(a), n0 + r * math.sin(a)), rnd.uniform(0.4, 0.75))
    # Low curving concrete seat walls along the south edge.
    for line in [[(5, -10.5), (10, -11), (15, -10), (20, -8), (22, -5)], [(-24, -10), (-18, -12.5), (-11, -12)]]:
        pts = []
        for p0 in C.catmull([Vector((e, n, 0)) for e, n in line], 3):
            s, c = enu(p0.x, p0.y)
            pts.append(W(s, c, gz(s, c) + 0.2))
        C.sweep(b, "seaplay_concrete", M["concrete"], pts, C.rect_profile(0.6, 0.45), up=(0, 0, 1))

    objs = b.build(layer)
    print(f"sea_play: {len(objs)} objects, {b.triangles()} triangles")
    return sh


_ico = None


def icosphere():
    """A once-subdivided icosahedron (80 faces) as unit vectors and triangles."""
    global _ico
    if _ico:
        return _ico
    t = (1 + 5 ** 0.5) / 2
    V = [Vector(v).normalized() for v in [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t),
                                          (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]]
    F = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
         (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    cache = {}

    def midp(a, b):
        k = (min(a, b), max(a, b))
        if k not in cache:
            V.append(((V[a] + V[b]) / 2).normalized())
            cache[k] = len(V) - 1
        return cache[k]

    F2 = []
    for a, b, c in F:
        ab, bc, ca = midp(a, b), midp(b, c), midp(c, a)
        F2 += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
    _ico = (V, F2)
    return _ico


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", help="layer file (else the open file)")
    ap.add_argument("--render")
    ap.add_argument("--view", default="path", choices=["beach", "path", "high", "stern"])
    ap.add_argument("--samples", type=int, default=16)
    ap.add_argument("--res", default="960x540")
    a = ap.parse_args(C.args_after_dashes())
    if a.blend:
        bpy.ops.wm.open_mainfile(filepath=os.path.abspath(a.blend))
    layer = C.reset_layer()
    sh = build(layer)
    bpy.ops.wm.save_mainfile()
    print(f"saved {bpy.data.filepath}")
    if a.render:
        W, L = sh.W, sh.L
        target = W(L * 0.5, 1.0, 3.5)
        views = {
            # From the shared path to the south, the ship side-on with the masts leaning away.
            "path": (W(L * 0.5, -24, 1.7), W(L * 0.5, 2, 4.0), 24),
            # From the beach promenade to the north, the masts leaning towards you.
            "beach": (W(L * 0.45, 22, 1.7), W(L * 0.5, 0, 3.5), 24),
            "high": (W(L + 18, -26, 22), W(L * 0.45, 0, 1.0), 24),
            "stern": (W(-11, -1.5, 2.2), W(L * 0.6, 1.5, 3.5), 22),
        }
        eye, tgt, lens = views[a.view]
        w, h = (int(x) for x in a.res.lower().split("x"))
        C.render(os.path.abspath(a.render), eye, tgt, lens=lens, samples=a.samples, res=(w, h), sun=(0.3, -0.6, 0.8))


main()
