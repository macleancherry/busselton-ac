"""The AI line's shape, and the walls beside it: catches a line that turns back on itself, and Armco
or an invisible corridor wall too close to it.

    python3 -I scripts/check/line_check.py out/<slug>.surface.json

From the surface dump (scripts/check/dump_surface.ts), for the main AI line and each layout's:
  - folds: a point where the line bends tighter than FOLD_R (Menger radius through it and its two
    neighbours) or turns more than 90 degrees from one step to the next. A sideways offset bigger
    than the radius on the inside of a bend does this (src/core/offsetFold.ts): Caves Road at
    Yallingup in retest 6, where the AI braked to 20 km/h, steered for the loop and left the road.
  - Armco: guard rail collision walls (1WALL_ARMCO_*) closer than ARMCO_CLEAR to the line, in plan.
    The rail stands past the verge, so a rail this close means the line or the rail is in the
    wrong place.
  - corridor walls: the invisible walls either side of the road (1WALL_L_*, 1WALL_R_*) closer than
    WALL_CLEAR to the line. On the inside of a junction turn they used to fold back across the road
    (src/core/roadMesh.ts buildWalls; the same Caves Road corner).
  - road folds (reported, not failed: existing builds have a few at junctions): the route's own
    road (1ROAD_<n>) triangles facing down, the road mesh folding over itself on the inside of a
    corner tighter than half its width.
Exits non-zero on a fold, or Armco or a corridor wall too close.
"""

import json
import math
import re
import sys

FOLD_R = 1.5        # metres: the keep-left line's minimum (src/core/aiLine.ts AI_MIN_RADIUS)
ARMCO_CLEAR = 1.5   # metres from the line to a rail's collision wall: half a car and 60 cm
WALL_CLEAR = 1.0    # metres from the line to a corridor wall: half a car and 10 cm
CELL = 10           # metres, the lookup grid


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


def wall_segments(meshes, pattern):
    """The plan-view edges of the matching walls (vertical edges drop out), in a coarse grid."""
    grid = {}
    for m in meshes:
        if not re.match(pattern, m["name"]):
            continue
        p, ix = m["p"], m["i"]
        seen = set()
        for t in range(0, len(ix), 3):
            tri = ix[t:t + 3]
            for a, b in ((tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])):
                A = (round(p[a * 3], 2), round(p[a * 3 + 2], 2))
                B = (round(p[b * 3], 2), round(p[b * 3 + 2], 2))
                if A == B:
                    continue
                key = (min(A, B), max(A, B))
                if key in seen:
                    continue
                seen.add(key)
                # Every cell the edge passes near (edges are a few metres long).
                cells = {(int(q[0] // CELL), int(q[1] // CELL)) for q in (A, B, ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2))}
                for c in cells:
                    grid.setdefault(c, []).append((A, B, m["name"]))
    return grid


def to_segment(p, a, b):
    ex, ez = b[0] - a[0], b[1] - a[1]
    L = ex * ex + ez * ez
    t = 0 if L == 0 else max(0, min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / L))
    return math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ez)


def near_line(ai, grid, clear):
    out = []
    for p in ai:
        x, z = p["position"][0], p["position"][2]
        gx, gz = int(x // CELL), int(z // CELL)
        best = None
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for a, b, name in grid.get((gx + dx, gz + dz), ()):
                    d = to_segment((x, z), a, b)
                    if best is None or d < best[0]:
                        best = (d, name, x, z)
        if best and best[0] < clear:
            if not out or p["distance"] - out[-1][0] > 20:
                out.append((p["distance"], *best))
            elif best[0] < out[-1][1]:
                out[-1] = (out[-1][0], *best)
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
            if ny < 0 and abs(ny) / 2 > 0.01:
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
    armco = wall_segments(meshes, r"1WALL_ARMCO")
    corridor = wall_segments(meshes, r"1WALL_[LR]_\d+$")
    bad = False
    for name, ai in lines.items():
        if not ai:
            continue
        total = ai[-1]["distance"]
        f = folds(ai)
        print(f"{name}: AI line folds (radius under {FOLD_R} m or turning back): {len(f)}")
        for d, r, turn, b in f[:8]:
            print(f"  {d:7.0f} m of {total:.0f}: radius {r:.2f} m, turns {turn:.0f} deg, at ({b[0]:.1f}, {b[1]:.1f})")
        for label, grid, clear in (("Armco", armco, ARMCO_CLEAR), ("corridor walls", corridor, WALL_CLEAR)):
            a = near_line(ai, grid, clear)
            print(f"{name}: {label} within {clear} m of the AI line: {len(a)}")
            for d, dist, wall, x, z in a[:8]:
                print(f"  {d:7.0f} m of {total:.0f}: {wall} {dist:.2f} m from the line at ({x:.1f}, {z:.1f})")
            bad = bad or bool(a)
        bad = bad or bool(f)
    n, at = road_folds(meshes)
    print(f"road triangles facing down (folded road): {n}" + (f", e.g. {at}" if at else ""))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
