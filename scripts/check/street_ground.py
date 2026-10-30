#!/usr/bin/env python3
"""Where the ground mesh comes up through a street.

    python3 -I scripts/check/street_ground.py out/<slug>.surface.json

Rasterises the street meshes (1STREET...) and the terrain (1GRASS_t...) at 0.5 m and counts street
cells with ground more than 1 cm above the street. Exits non-zero if any is more than 3 cm above,
and lists the worst spots (AC x, z).
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


def main():
    data = json.load(open(sys.argv[1]))
    street = {}
    for m in data["meshes"]:
        if m["name"].startswith(("1STREET", "1UNPAVED")):
            for k, h in cells(m).items():
                if h > street.get(k, -1e9):
                    street[k] = h
    ground = {}
    for m in data["meshes"]:
        if m["name"].startswith("1GRASS_t"):
            for k, h in cells(m, street).items():
                if h > ground.get(k, -1e9):
                    ground[k] = h
    del data
    over = sorted(((ground[k] - street[k], k) for k in ground if ground[k] > street[k] + 0.01), reverse=True)
    worst = over[0][0] if over else 0
    print(f"street cells {len(street)}, ground above the street in {len(over)} ({100 * len(over) / max(1, len(street)):.3f}%), worst {worst * 100:.1f} cm")
    for d, (i, j) in over[:8]:
        print(f"  x {i * C:.0f} z {j * C:.0f}: {d * 100:.1f} cm")
    sys.exit(1 if worst > 0.03 else 0)


main()
