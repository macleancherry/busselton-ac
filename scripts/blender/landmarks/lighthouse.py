"""Shared parts for the lighthouse detail layers (cape_leeuwin_lighthouse.py, cape_naturaliste_lighthouse.py).

A lighthouse here is a round masonry tower (a lathe: a profile of (radius, height) pairs turned about
the vertical), a gallery on corbels or a moulded cove with an open balustrade, and a Chance lantern on
it: a pedestal drum, the glazing with its astragals (upright and ring bars, or diagonal "diamond" bars),
a cornice, a domed cap and a ventilator ball with a lightning rod.

Everything is placed in a local frame round the tower's axis: O (ground at the axis), F (the unit
vector the front faces, where the door is), R (to the right of someone facing the front), z up from O.
Angles a are measured from F towards R. Smooth parts (the shaft, drum, glazing, dome) go in their own
"_smooth" objects so their normals are smoothed and the flat parts (slabs, corbels, bars) stay crisp.
"""
import math

import bpy  # noqa: F401  (first: bmesh and mathutils need bpy loaded with the pip module)
from mathutils import Matrix, Vector

import common as C


class Frame:
    def __init__(self, O, facing_deg):
        self.O = Vector(O)
        h = math.radians(facing_deg)
        self.F = Vector((math.sin(h), math.cos(h), 0))
        self.R = Vector((math.sin(h + math.pi / 2), math.cos(h + math.pi / 2), 0))

    def dir(self, a):
        """Unit radial vector at angle a (radians, from the front towards the right)."""
        return self.F * math.cos(a) + self.R * math.sin(a)

    def P(self, a, r, z):
        return self.O + self.dir(a) * r + Vector((0, 0, z))

    def W(self, f, r_, z):
        """A point f metres to the front, r_ to the right, z up."""
        return self.O + self.F * f + self.R * r_ + Vector((0, 0, z))

    def rot(self):
        """3x3 matrix turning local (right, front, up) box axes into the world."""
        return Matrix((self.R, self.F, Vector((0, 0, 1)))).transposed()


def lathe(b, name, mat, fr, profile, n=32, phase=None, cap_bottom=False, cap_top=False):
    """Turn [(r, z), ...] (bottom to top) about the axis. A ring with r == 0 is a single point.
    phase: angle of the first vertex; by default half a facet, so a facet's middle faces the front."""
    ph = math.pi / n if phase is None else phase
    verts, faces, rings = [], [], []
    for r, z in profile:
        if r < 1e-5:
            rings.append([len(verts)])
            verts.append(fr.P(0, 0, z))
        else:
            rings.append(list(range(len(verts), len(verts) + n)))
            verts.extend(fr.P(ph + 2 * math.pi * k / n, r, z) for k in range(n))
    # Ring vertices run clockwise seen from above (front towards right); these windings face away
    # from the axis for a profile climbing the outside (and down for one heading outwards).
    for A, B in zip(rings, rings[1:]):
        if len(A) == 1 and len(B) == 1:
            continue
        for k in range(n):
            k2 = (k + 1) % n
            if len(A) == 1:
                faces.append((A[0], B[k], B[k2]))
            elif len(B) == 1:
                faces.append((A[k], B[0], A[k2]))
            else:
                faces.append((A[k], B[k], B[k2], A[k2]))
    if cap_bottom and len(rings[0]) > 1:
        faces.append(tuple(rings[0]))
    if cap_top and len(rings[-1]) > 1:
        faces.append(tuple(reversed(rings[-1])))
    b.add(name, mat, verts, faces)


def facet_quad(b, name, mat, fr, a, rz, z0, z1, width, n=32, proud=0.015, phase=None):
    """A flat panel (window, door) on the facet of a lathe of n sides facing angle a, from z0 to z1;
    rz(z) is the lathe's radius at z. The facet whose middle is nearest a is used."""
    ph = math.pi / n if phase is None else phase
    step = 2 * math.pi / n
    k = round((a - ph - step / 2) / step)
    ac = ph + step / 2 + k * step
    u, v = fr.dir(ac), fr.dir(ac + math.pi / 2)
    ap = math.cos(math.pi / n)

    def pt(t, z):
        return fr.O + u * (rz(z) * ap + proud) + v * t + Vector((0, 0, z))

    w = width / 2
    b.add(name, mat, [pt(-w, z0), pt(w, z0), pt(w, z1), pt(-w, z1)], [(0, 3, 2, 1)])  # faces outwards
    return u, v, ap


def window(b, fr, mats, a, rz, sill, height, width, n=32):
    """A small tower window: dark glass panel, a white sill and head, both proud of the wall."""
    u, v, ap = facet_quad(b, "lh_dark", mats["dark"], fr, a, rz, sill, sill + height, width, n=n)
    for z, hgt, d in ((sill - 0.08, 0.1, 0.12), (sill + height, 0.14, 0.08)):
        c = fr.O + u * (rz(z) * ap + d / 2) + Vector((0, 0, z + hgt / 2))
        rot = Matrix((v, u, Vector((0, 0, 1)))).transposed()
        C.box(b, "lh_trim", mats["trim"], c, (width + 0.2, d, hgt), rot=rot)


def corbels(b, fr, mat, r_wall, z_top, count, depth=0.7, height=0.8, width=0.32, phase=0.0):
    """Stone brackets under the gallery: wedges standing out of the wall, deep at the top."""
    for k in range(count):
        a = phase + 2 * math.pi * k / count
        u, v = fr.dir(a), fr.dir(a + math.pi / 2)
        w = width / 2
        r0 = r_wall - 0.05
        pts = []
        for t in (-w, w):
            pts += [fr.O + u * r0 + v * t + Vector((0, 0, z_top - height)),
                    fr.O + u * (r0 + depth * 0.25) + v * t + Vector((0, 0, z_top - height)),
                    fr.O + u * (r0 + depth) + v * t + Vector((0, 0, z_top - 0.15)),
                    fr.O + u * (r0 + depth) + v * t + Vector((0, 0, z_top)),
                    fr.O + u * r0 + v * t + Vector((0, 0, z_top))]
        # two pentagon sides (0-4, 5-9) and the four outer faces round them
        faces = [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5)]
        for i in range(5):
            j = (i + 1) % 5
            faces.append((i, i + 5, j + 5, j)[::-1])
        b.add("lh_white", mat, pts, faces)


def balustrade(b, fr, mats, r, z0, height, posts, rails=(0.5,), n=48, post_w=0.05, rail_r=0.03, top_w=0.09):
    """An open railing round a circle: square posts, a flat top rail and thin intermediate rails."""
    for k in range(posts):
        a = 2 * math.pi * (k + 0.5) / posts
        u, v = fr.dir(a), fr.dir(a + math.pi / 2)
        rot = Matrix((v, u, Vector((0, 0, 1)))).transposed()
        C.box(b, "lh_rail", mats["rail"], fr.O + u * r + Vector((0, 0, z0 + height / 2)), (post_w, post_w, height), rot=rot)
    ring = lambda z, rr=r: [fr.P(2 * math.pi * k / n, rr, z) for k in range(n + 1)]  # noqa: E731
    C.sweep(b, "lh_rail", mats["rail"], ring(z0 + height), C.rect_profile(0.04, top_w), up=(0, 0, 1), caps=False)
    for f in rails:
        C.tube(b, "lh_rail", mats["rail"], ring(z0 + height * f), rail_r, sides=4, caps=False)
    C.tube(b, "lh_rail", mats["rail"], ring(z0 + 0.08), rail_r * 1.3, sides=4, caps=False)


def lantern(b, fr, mats, z, ped_r, ped_h, glass_r, glass_h, dome_h, bars=16, diamond=False, rings=(0.5,),
            vents=0, n=32):
    """A Chance lantern from z (the gallery floor): pedestal drum, glazing and astragals, cornice, dome,
    vent ball and rod. Returns the height of the rod's tip."""
    smooth_w = "lh_white_smooth"
    # Pedestal: the iron drum, a base step and a capping band.
    lathe(b, smooth_w, mats["white"], fr, [(ped_r + 0.06, z), (ped_r + 0.06, z + 0.12), (ped_r, z + 0.12),
                                            (ped_r, z + ped_h - 0.1)], n=n)
    lathe(b, "lh_white", mats["white"], fr, [(ped_r, z + ped_h - 0.1), (ped_r + 0.1, z + ped_h - 0.1),
                                             (ped_r + 0.1, z + ped_h), (glass_r - 0.02, z + ped_h)], n=n)
    # Pedestal vents: dark round-topped openings in the drum.
    for k in range(vents):
        a = 2 * math.pi * (k + 0.5) / vents
        facet_quad(b, "lh_dark", mats["dark"], fr, a, lambda _z: ped_r, z + ped_h * 0.35, z + ped_h * 0.62, 0.22, n=n)
    zg0, zg1 = z + ped_h, z + ped_h + glass_h
    # Glazing (opaque dark glass: the kn5 has no transparency here) and a sill ring.
    lathe(b, "lh_glass_smooth", mats["glass"], fr, [(glass_r, zg0), (glass_r, zg1)], n=n)
    # Astragals: the glazing bars, just outside the glass.
    rb = glass_r + 0.025
    if diamond:
        # Diagonal bars both ways (the helical "diamond" glazing of the 1900s Chance lanterns).
        travel = glass_h / rb  # 45 degree bars: square diamonds 2 pi r / bars across
        for s in (-1, 1):
            for k in range(bars):
                a0 = 2 * math.pi * k / bars
                pts = [fr.P(a0 + s * travel * i / 12, rb, zg0 + glass_h * i / 12) for i in range(13)]
                C.tube(b, "lh_bars", mats["frame"], pts, 0.022, sides=4, caps=False)
    else:
        for k in range(bars):
            a = 2 * math.pi * k / bars
            C.box(b, "lh_bars", mats["frame"], fr.P(a, rb, (zg0 + zg1) / 2), (0.06, 0.06, glass_h),
                  rot=Matrix((fr.dir(a + math.pi / 2), fr.dir(a), Vector((0, 0, 1)))).transposed())
    for f in (0.0, *rings, 1.0):
        zz = zg0 + glass_h * f
        C.tube(b, "lh_bars", mats["frame"], [fr.P(2 * math.pi * k / n, rb, zz) for k in range(n + 1)],
               0.035 if f in (0.0, 1.0) else 0.025, sides=4, caps=False)
    # Cornice: a band standing out over the glazing, with a gutter lip.
    zc = zg1
    lathe(b, "lh_white", mats["white"], fr, [(glass_r - 0.02, zc), (glass_r + 0.18, zc + 0.04), (glass_r + 0.22, zc + 0.12),
                                             (glass_r + 0.22, zc + 0.24), (glass_r + 0.1, zc + 0.26)], n=n, cap_bottom=True)
    # Dome: a steep cupola (slightly ogee), then a neck for the vent.
    zd = zc + 0.26
    rd = glass_r + 0.1
    prof = []
    for i in range(9):
        t = i / 8
        r_ = rd * math.cos(t * math.pi / 2) ** 0.85
        prof.append((max(r_, 0.22), zd + dome_h * math.sin(t * math.pi / 2)))
    lathe(b, "lh_dome_smooth", mats["dome"], fr, prof, n=n)
    zt = zd + dome_h
    # Ventilator: a short neck, the ball with a little cowl hood, then the rod.
    lathe(b, "lh_dome_smooth", mats["dome"], fr, [(0.22, zt), (0.16, zt + 0.12)], n=16)
    zb = zt + 0.12
    rv = 0.34
    ball = [(0.16, zb)] + [(rv * math.sin(math.pi * i / 8), zb + rv - rv * math.cos(math.pi * i / 8)) for i in range(1, 8)] + [(0.0, zb + 2 * rv)]
    lathe(b, "lh_dome_smooth", mats["dome"], fr, ball, n=16)
    lathe(b, "lh_white", mats["dome"], fr, [(0.0, zb + 2 * rv - 0.12), (rv + 0.08, zb + rv + 0.04), (rv + 0.08, zb + rv + 0.1), (0.0, zb + 2 * rv - 0.04)], n=16)
    tip = zb + 2 * rv + 0.75
    C.cylinder(b, "lh_bars", mats["frame"], fr.P(0, 0, zb + 2 * rv - 0.05), fr.P(0, 0, tip), 0.02, sides=4)
    # The outer handrail round the cornice (the keepers' ladder rail) on short brackets.
    rh = glass_r + 0.45
    C.tube(b, "lh_rail", mats["rail"], [fr.P(2 * math.pi * k / n, rh, zc + 0.35) for k in range(n + 1)], 0.022, sides=4, caps=False)
    for k in range(8):
        a = 2 * math.pi * (k + 0.5) / 8
        C.tube(b, "lh_rail", mats["rail"], [fr.P(a, glass_r + 0.2, zc + 0.2), fr.P(a, rh, zc + 0.35)], 0.018, sides=4, caps=False)
    return tip


def apron(b, name, mat, fr, ground, r_in, r_out, n=32, step=0.9, lift=0.04, fallback=0.0):
    """A paved ring round the tower draped over the ground (lift above it)."""
    rings = max(1, math.ceil((r_out - r_in) / step))
    verts, faces = [], []
    for i in range(rings + 1):
        r = r_in + (r_out - r_in) * i / rings
        for k in range(n):
            p = fr.P(2 * math.pi * k / n, r, 0)
            g = ground(p.x, p.y)
            p.z = (g if g is not None else fallback) + lift
            verts.append(p)
    for i in range(rings):
        for k in range(n):
            k2 = (k + 1) % n
            faces.append((i * n + k, i * n + k2, (i + 1) * n + k2, (i + 1) * n + k))
    b.add(name, mat, verts, faces)


def ground_stats(fr, ground, r, samples=16):
    """(z at the axis, lowest, highest) of the ground on a circle of radius r round the tower."""
    zs = []
    for k in range(samples):
        p = fr.P(2 * math.pi * k / samples, r, 0)
        g = ground(p.x, p.y)
        if g is not None:
            zs.append(g)
    zc = ground(fr.O.x, fr.O.y)
    if zc is None:
        zc = sum(zs) / len(zs) if zs else 0.0
    return zc, min(zs, default=zc), max(zs, default=zc)


def materials(prefix, white="#F1F0EA", rail="#F4F4F0", glass="#26313A", dome="#EFEEE8", frame="#E8E8E2", dark="#2B2E30"):
    return {
        "white": C.material(f"{prefix}_limewash", white, rough=0.85),
        "trim": C.material(f"{prefix}_trim", "#F6F6F2", rough=0.7),
        "rail": C.material(f"{prefix}_rail", rail, rough=0.5, metal=0.3),
        "glass": C.material(f"{prefix}_glass", glass, rough=0.1, metal=0.2),
        "dome": C.material(f"{prefix}_dome", dome, rough=0.4, metal=0.3),
        "frame": C.material(f"{prefix}_frame", frame, rough=0.5, metal=0.3),
        "dark": C.material(f"{prefix}_dark", dark, rough=0.4),
        "paving": C.material(f"{prefix}_paving", "#8E8D88", rough=0.95),
    }


def finish(b, layer):
    objs = b.build(layer)
    for ob in objs:
        if ob.name.endswith("_smooth"):
            for p in ob.data.polygons:
                p.use_smooth = True
    return objs
