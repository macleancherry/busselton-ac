"""The AI line's shape, and what stands beside it: catches a line that turns back on itself and
Armco too close to it.

    python3 -I scripts/check/line_check.py out/<slug>.surface.json

From the surface dump (scripts/check/dump_surface.ts), for the main AI line and each layout's:
  - folds: a point where the line bends tighter than FOLD_R (Menger radius through it and its two
    neighbours) or turns more than 90 degrees from one step to the next. A sideways offset bigger
    than the radius on the inside of a bend does this (src/core/offsetFold.ts): Caves Road at
    Yallingup in retest 6, where the AI braked to 20 km/h, steered for the loop and left the road.
  - Armco: guard rail collision walls (1WALL_ARMCO_*) closer than ARMCO_CLEAR to the line, from the
    line's own side of the road. The rail stands past the verge, so a rail this close means the
    line or the rail is in the wrong place.
  - road folds (reported, not failed: existing builds have a few at junctions): the route's own
    road (1ROAD_<n>) triangles facing down, the road mesh folding over itself on the inside of a
    corner tighter than half its width.
Exits non-zero on a fold or Armco too close.
"""

import json
import re
import math
import sys

FOLD_R = 1.5        # metres: the keep-left line's minimum (src/core/aiLine.ts AI_MIN_RADIUS)
ARMCO_CLEAR = 1.5   # metres from the line to a rail's collision wall: half a car and 60 cm


def folds(ai):
    out = []
    P = [(p["position"][0], p["position"][2]) for p in ai]
    for i in range(1, len(P) - 1):
        a, b, c = P[i - 1], P[i], P[i + 1]
        A, B, C = math.dist(a, b), math.dist(b, c), math.dist(a, c)
        if A < 1e-6 or B < 1e-6:
            continue
        cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])
        dot = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])
        turn = math.degrees(math.atan2(abs(cross), dot))
        tri = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
        r = A * B * C / (2 * tri) if tri > 1e-9 else math.inf
        if r < FOLD_R or turn > 90:
            if not out or ai[i]["distance"] - out[-1][0] > 10:
                out.append((ai[i]["distance"], r, turn, b))
    return out


def wall_points(meshes):
    """Armco collision walls as plan-view points (each ring once), with a coarse grid for lookups."""
    pts = []
    for m in meshes:
        if not m["name"].startswith("1WALL_ARMCO"):
            continue
        p = m["p"]
        seen = set()
        for k in range(0, len(p), 3):
            key = (round(p[k], 2), round(p[k + 2], 2))
            if key not in seen:
                seen.add(key)
                pts.append((p[k], p[k + 2], m["name"]))
    grid = {}
    for x, z, name in pts:
        grid.setdefault((int(x // 10), int(z // 10)), []).append((x, z, name))
    return grid


def armco_near(ai, grid):
    out = []
    for p in ai:
        x, z = p["position"][0], p["position"][2]
        gx, gz = int(x // 10), int(z // 10)
        best = None
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for wx, wz, name in grid.get((gx + dx, gz + dz), ()):
                    d = math.hypot(wx - x, wz - z)
                    if best is None or d < best[0]:
                        best = (d, name, wx, wz)
        if best and best[0] < ARMCO_CLEAR:
            if not out or p["distance"] - out[-1][0] > 20:
                out.append((p["distance"], *best))
    return out


def road_folds(meshes):
    n, at = 0, []
    for m in meshes:
        if not re.match(r"1ROAD_\d+$", m["name"]):
            continue
        p, ix = m["p"], m["i"]
        for t in range(0, len(ix), 3):
            a, b, c = (ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3)
            ux, uz = p[b] - p[a], p[b + 2] - p[a + 2]
            vx, vz = p[c] - p[a], p[c + 2] - p[a + 2]
            ny = uz * vx - ux * vz
            area = abs(ny) / 2
            if ny < 0 and area > 0.01:
                n += 1
                if len(at) < 5:
                    at.append((m["name"], round((p[a] + p[b] + p[c]) / 3, 1), round((p[a + 2] + p[b + 2] + p[c + 2]) / 3, 1)))
    return n, at


def main():
    data = json.load(open(sys.argv[1]))
    meshes = data["meshes"]
    lines = {"main": data["ai"]}
    for k, v in (data.get("layouts") or {}).items():
        ai = v.get("ai") if isinstance(v, dict) else v
        if ai:
            lines[k] = ai
    grid = wall_points(meshes)
    bad = False
    for name, ai in lines.items():
        if not ai:
            continue
        total = ai[-1]["distance"]
        f = folds(ai)
        print(f"{name}: AI line folds (radius under {FOLD_R} m or turning back): {len(f)}")
        for d, r, turn, b in f[:8]:
            print(f"  {d:7.0f} m of {total:.0f}: radius {r:.2f} m, turns {turn:.0f} deg, at ({b[0]:.1f}, {b[1]:.1f})")
        a = armco_near(ai, grid)
        print(f"{name}: Armco within {ARMCO_CLEAR} m of the AI line: {len(a)}")
        for d, dist, wall, wx, wz in a[:8]:
            print(f"  {d:7.0f} m of {total:.0f}: {wall} {dist:.2f} m away at ({wx:.1f}, {wz:.1f})")
        bad = bad or bool(f) or bool(a)
    n, at = road_folds(meshes)
    print(f"road triangles facing down (folded road): {n}" + (f", e.g. {at}" if at else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
