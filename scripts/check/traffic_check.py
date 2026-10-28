"""Check a build's traffic graph (data/traffic.json, for CSP's traffic planner):

  - lanes run on asphalt: each lane point has the route or a street under it
  - no two intersection polygons overlap (the planner can't handle a lane in two at once)
  - every lane end sits inside an intersection (or the lane loops)

    npx tsx scripts/check/dump_surface.ts out/<slug>.zip out/<slug>.surface.json
    python3 -I scripts/check/traffic_check.py out/<slug>.zip out/<slug>.surface.json

Exits non-zero when polygons overlap or lanes leave the asphalt, and writes
out/<slug>.traffic.png: lanes over the drivable surface, polygons shaded.
"""

import json
import os
import sys
import zipfile

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from surface_check import CELL, raster  # noqa: E402


def overlap(a, b):
    """Separating-axis test for two convex polygons (lists of (x, z))."""
    for poly in (a, b):
        for i in range(len(poly)):
            p, q = poly[i], poly[(i + 1) % len(poly)]
            n = (q[1] - p[1], p[0] - q[0])
            pa = [n[0] * x + n[1] * z for x, z in a]
            pb = [n[0] * x + n[1] * z for x, z in b]
            if max(pa) < min(pb) or max(pb) < min(pa):
                return False
    return True


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
    top, _, _, _, x0, z0 = raster(surf["meshes"], drivable)
    H, W = top.shape

    def on_road(x, z, reach=1):
        i, j = int((z - z0) / CELL), int((x - x0) / CELL)
        win = top[max(0, i - reach):i + reach + 1, max(0, j - reach):j + reach + 1]
        return win.size > 0 and not np.all(np.isnan(win))

    polys = [[(p[0], p[2]) for p in it["points"]] for it in data["intersections"]]
    bad_pairs = [(a, b) for a in range(len(polys)) for b in range(a + 1, len(polys)) if overlap(polys[a], polys[b])]
    pts = off = 0
    loose_ends = 0
    for lane in data["lanes"]:
        for p in lane["points"]:
            pts += 1
            if not on_road(p[0], p[2]):
                off += 1
        if not lane["loop"]:
            for p in (lane["points"][0], lane["points"][-1]):
                if not any(inside(poly, (p[0], p[2])) for poly in polys):
                    loose_ends += 1
    print(f"traffic: {len(data['lanes'])} lanes, {len(data['intersections'])} intersections")
    print(f"lane points on asphalt: {100 * (pts - off) / max(1, pts):.1f}% ({off} of {pts} off)")
    print(f"overlapping intersections: {len(bad_pairs)}")
    for a, b in bad_pairs[:8]:
        print(f"   {data['intersections'][a]['name']} and {data['intersections'][b]['name']} near x {polys[a][0][0]:.0f} z {polys[a][0][1]:.0f}")
    print(f"lane ends outside any intersection: {loose_ends}")

    # Map: asphalt grey, polygons shaded, lanes on top (off-asphalt points in red).
    img = Image.fromarray(np.where(np.isnan(top), 255, 170).astype(np.uint8)).convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")
    f = lambda x, z: ((x - x0) / CELL, (z - z0) / CELL)
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
    failed = bad_pairs or off > 0.03 * pts
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
