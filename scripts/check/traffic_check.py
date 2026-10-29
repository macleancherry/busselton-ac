"""Check a build's traffic graph (data/traffic.json, for CSP's traffic planner):

  - lanes run on asphalt: each lane point has the route or a street under it
  - no two intersection polygons overlap (the planner can't handle a lane in two at once)
  - every lane end sits inside an intersection (or the lane loops)

    npx tsx scripts/check/dump_surface.ts out/<slug>.zip out/<slug>.surface.json
    python3 -I scripts/check/traffic_check.py out/<slug>.zip out/<slug>.surface.json

Exits non-zero when polygons overlap, a lane end is loose or lanes leave the asphalt, and writes
out/<slug>.traffic.png: lanes over the drivable surface, polygons shaded.
"""

import json
import os
import sys
import zipfile

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from surface_check import CELL, covered  # noqa: E402


def _cross(p, q, r, s):
    d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0])
    if abs(d) < 1e-12:
        return False
    t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d
    u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d
    return 0 < t < 1 and 0 < u < 1


def overlap(a, b):
    """Two simple polygons (lists of (x, z)) overlap: edges cross, or one holds the other."""
    xa, za = zip(*a)
    xb, zb = zip(*b)
    if max(xa) < min(xb) or max(xb) < min(xa) or max(za) < min(zb) or max(zb) < min(za):
        return False
    for i in range(len(a)):
        for j in range(len(b)):
            if _cross(a[i], a[(i + 1) % len(a)], b[j], b[(j + 1) % len(b)]):
                return True
    return inside(a, b[0]) or inside(b, a[0])


def inside(poly, pt):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        (xi, zi), (xj, zj) = poly[i], poly[j]
        if (zi > pt[1]) != (zj > pt[1]) and pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


def main():
    zpath, spath = sys.argv[1], sys.argv[2]
    with zipfile.ZipFile(zpath) as z:
        name = next(n for n in z.namelist() if n.endswith("data/traffic.json"))
        data = json.loads(z.read(name))
    surf = json.load(open(spath))
    drivable = lambda n: n[:2] == "1R" or n.startswith("1STREET")
    cells, x0, z0, H, W = covered([m for m in surf["meshes"] if drivable(m["name"])])

    def on_road(x, z, reach=1):
        i, j = int((z - z0) / CELL), int((x - x0) / CELL)
        return any(0 <= i + a < H and 0 <= j + b < W and (i + a) * W + j + b in cells
                   for a in range(-reach, reach + 1) for b in range(-reach, reach + 1))

    polys = [[(p[0], p[2]) for p in it["points"]] for it in data["intersections"]]
    bad_pairs = [(a, b) for a in range(len(polys)) for b in range(a + 1, len(polys)) if overlap(polys[a], polys[b])]
    pts = off = 0
    loose_ends = 0
    loose_at = []
    for lane in data["lanes"]:
        for p in lane["points"]:
            pts += 1
            if not on_road(p[0], p[2]):
                off += 1
        if not lane["loop"]:
            for p in (lane["points"][0], lane["points"][-1]):
                if not any(inside(poly, (p[0], p[2])) for poly in polys):
                    loose_ends += 1
                    loose_at.append((p[0], p[2]))
    print(f"traffic: {len(data['lanes'])} lanes, {len(data['intersections'])} intersections")
    print(f"lane points on asphalt: {100 * (pts - off) / max(1, pts):.1f}% ({off} of {pts} off)")
    print(f"overlapping intersections: {len(bad_pairs)}")
    for a, b in bad_pairs[:8]:
        print(f"   {data['intersections'][a]['name']} and {data['intersections'][b]['name']} near x {polys[a][0][0]:.0f} z {polys[a][0][1]:.0f}")
    print(f"lane ends outside any intersection: {loose_ends}")
    for x, z in loose_at[:8]:
        print(f"   at x {x:.0f} z {z:.0f}")
    # Parked cars (their collision boxes) in a lane: traffic would drive into them.
    cars = []
    for m in surf["meshes"]:
        if m["name"].startswith("1WALL_CAR"):
            P = np.asarray(m["p"], np.float64).reshape(-1, 3)
            cars += [P[k:k + 20, [0, 2]].mean(0) for k in range(0, len(P), 20)]  # 20 vertices per box (scenery.box)
    blocked = []
    if cars:
        C = np.array(cars)
        for lane in data["lanes"]:
            for p in lane["points"]:
                d = np.hypot(C[:, 0] - p[0], C[:, 1] - p[2])
                if d.min() < 1.6:
                    blocked.append((p[0], p[2]))
    print(f"parked cars {len(cars)}, lane points blocked by one: {len(blocked)}")
    for x, z in blocked[:5]:
        print(f"   at x {x:.0f} z {z:.0f}")

    # Map: asphalt grey, polygons shaded, lanes on top (off-asphalt points in red).
    # Shrunk to at most 6000 px a side for long tracks.
    shrink = max(1, -(-max(W, H) // 6000))
    grey = np.full((-(-H // shrink), -(-W // shrink)), 255, np.uint8)
    c = np.fromiter(cells, np.int64, len(cells))
    grey[(c // W) // shrink, (c % W) // shrink] = 170
    img = Image.fromarray(grey).convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")
    f = lambda x, z: ((x - x0) / CELL / shrink, (z - z0) / CELL / shrink)
    for i, poly in enumerate(polys):
        bad = any(i in pair for pair in bad_pairs)
        d.polygon([f(*p) for p in poly], fill=(255, 0, 0, 90) if bad else (60, 160, 255, 70))
    for lane in data["lanes"]:
        line = [f(p[0], p[2]) for p in lane["points"]]
        d.line(line + ([line[0]] if lane["loop"] else []), fill=(0, 110, 0), width=1)
        for p in lane["points"]:
            if not on_road(p[0], p[2]):
                x, z = f(p[0], p[2])
                d.ellipse([x - 2, z - 2, x + 2, z + 2], fill=(220, 0, 0))
    out = os.path.splitext(spath)[0].replace(".surface", "") + ".traffic.png"
    img.save(out)
    print(f"map: {out}")
    failed = bad_pairs or loose_ends or off > 0.03 * pts or blocked
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
