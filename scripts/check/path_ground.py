#!/usr/bin/env python3
"""Paths that float above the ground or sink into it.

    python3 -I scripts/check/path_ground.py out/<slug>.surface.json [--tol 0.10]

Rasterises the paths (the OSM footpaths and shared path, 1ROAD_PATH..., and the photo's
footpaths, 1STREET_PATH...) and the ground under them (every 1GRASS... mesh: terrain, verges,
strips, islands) at 0.5 m, and compares the two cell by cell. A path stands a few centimetres
proud; one more than --tol above the ground floats, and ground more than --tol above a path comes
up through it. Exits non-zero if any path cell is out by more than --tol, and lists the worst
spots (AC x, z) both ways.
"""
import json
import math
import sys

C = 0.5


def cells(m, keep=None):
    """(i, j) -> height of the mesh's highest surface over each cell middle."""
    p, idx = m["p"], m["i"]
    out = {}
    for t in range(0, len(idx), 3):
        a, b, c = idx[t] * 3, idx[t + 1] * 3, idx[t + 2] * 3
        ax, ay, az, bx, by, bz, cx, cy, cz = p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]
        den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
        if abs(den) < 1e-9:
            continue
        for i in range(math.ceil(min(ax, bx, cx) / C), math.floor(max(ax, bx, cx) / C) + 1):
            for j in range(math.ceil(min(az, bz, cz) / C), math.floor(max(az, bz, cz) / C) + 1):
                if keep is not None and (i, j) not in keep:
                    continue
                x, z = i * C, j * C
                w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den
                w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den
                w3 = 1 - w1 - w2
                if w1 < -1e-6 or w2 < -1e-6 or w3 < -1e-6:
                    continue
                h = w1 * ay + w2 * by + w3 * cy
                if h > out.get((i, j), -1e9):
                    out[(i, j)] = h
    return out


def compare(meshes, tol):
    """Path cells, and (offset, cell, mesh) for those off the ground by more than tol, worst first."""
    path, owner = {}, {}
    for m in meshes:
        if m["name"].startswith(("1ROAD_PATH", "1STREET_PATH")):
            for k, h in cells(m).items():
                if h > path.get(k, -1e9):
                    path[k] = h
                    owner[k] = m["name"]
    ground, under = {}, {}
    for m in meshes:
        if m["name"].startswith("1GRASS"):
            for k, h in cells(m, path).items():
                if h > ground.get(k, -1e9):
                    ground[k] = h
                    under[k] = m["name"]
    both = [k for k in path if k in ground]
    off = sorted(((path[k] - ground[k], k, f"{owner[k]} over {under[k]}") for k in both if abs(path[k] - ground[k]) > tol), key=lambda v: -abs(v[0]))
    return len(both), off


def main():
    args = sys.argv[1:]
    tol = 0.10
    if "--tol" in args:
        tol = float(args[args.index("--tol") + 1])
    data = json.load(open(args[0]))
    n, off = compare(data["meshes"], tol)
    del data
    high = [v for v in off if v[0] > 0]
    low = [v for v in off if v[0] < 0]
    print(f"path cells on ground {n}: floating over {tol * 100:.0f} cm in {len(high)}, under the ground in {len(low)}"
          + (f", worst {off[0][0] * 100:+.1f} cm" if off else ""))
    for label, rows in (("above", high), ("below", low)):
        for d, (i, j), name in rows[:8]:
            print(f"  {label} x {i * C:.0f} z {j * C:.0f}: {d * 100:+.1f} cm ({name})")
    sys.exit(1 if off else 0)


if __name__ == "__main__":
    main()
