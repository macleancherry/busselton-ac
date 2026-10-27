"""Find bumps in a track's drivable surface: rasterises the physics meshes
(1ROAD*, 1STREET*, 1KERB*) onto a 0.5 m grid and reports where the surface
steps or slopes more than a car would on a flat town street.

    npx tsx scripts/check/dump_surface.ts out/<slug>.zip out/<slug>.surface.json
    python3 -I scripts/check/surface_check.py out/<slug>.surface.json

Prints the worst spots (AC x, z and height) and writes out/<slug>.bumps.png,
a top-down map with steps in red.
"""

import json
import os
import sys

import numpy as np
from PIL import Image

CELL = 0.5


def raster(meshes, kinds=None):
    pts = np.concatenate([np.asarray(m["p"], np.float64).reshape(-1, 3) for m in meshes])
    x0, z0 = pts[:, 0].min() - 2, pts[:, 2].min() - 2
    W = int((pts[:, 0].max() + 2 - x0) / CELL) + 1
    H = int((pts[:, 2].max() + 2 - z0) / CELL) + 1
    top = np.full((H, W), np.nan)
    low = np.full((H, W), np.nan)
    owner = np.full((H, W), -1, np.int32)
    lowner = np.full((H, W), -1, np.int32)
    for mi, m in enumerate(meshes):
        if kinds and not kinds(m["name"]):
            continue
        P = np.asarray(m["p"], np.float64).reshape(-1, 3)
        I = np.asarray(m["i"], np.int64).reshape(-1, 3)
        for a, b, c in I:
            A, B, C = P[a], P[b], P[c]
            xs = (np.array([A[0], B[0], C[0]]) - x0) / CELL
            zs = (np.array([A[2], B[2], C[2]]) - z0) / CELL
            i0, i1 = int(np.floor(zs.min())), int(np.ceil(zs.max()))
            j0, j1 = int(np.floor(xs.min())), int(np.ceil(xs.max()))
            den = (zs[1] - zs[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (zs[0] - zs[2])
            if abs(den) < 1e-9:
                continue
            for i in range(i0, i1 + 1):
                for j in range(j0, j1 + 1):
                    px, pz = j + 0.5, i + 0.5
                    l1 = ((zs[1] - zs[2]) * (px - xs[2]) + (xs[2] - xs[1]) * (pz - zs[2])) / den
                    l2 = ((zs[2] - zs[0]) * (px - xs[2]) + (xs[0] - xs[2]) * (pz - zs[2])) / den
                    l3 = 1 - l1 - l2
                    if l1 < -1e-6 or l2 < -1e-6 or l3 < -1e-6:
                        continue
                    y = l1 * A[1] + l2 * B[1] + l3 * C[1]
                    if 0 <= i < H and 0 <= j < W:
                        if np.isnan(top[i, j]) or y > top[i, j]:
                            top[i, j] = y
                            owner[i, j] = mi
                        if np.isnan(low[i, j]) or y < low[i, j]:
                            low[i, j] = y
                            lowner[i, j] = mi
    return top, low, owner, lowner, x0, z0


def edge_report(ai, meshes, every=25.0, reach=12.0):
    """Cross-sections every `every` metres of the AI line through all physics meshes
    (walls excluded): the biggest height step a car meets running off either side."""
    tris = []
    for m in meshes:
        if "WALL" in m["name"]:
            continue
        P = np.asarray(m["p"], np.float64).reshape(-1, 3)
        I = np.asarray(m["i"], np.int64).reshape(-1, 3)
        tris.append(P[I])
    T = np.concatenate(tris)  # (n, 3, 3)
    cen = T.mean(1)
    steps, worst = [], []
    last = -1e9
    for p in ai:
        if p["distance"] - last < every:
            continue
        last = p["distance"]
        x, _, z = p["position"]
        fx, _, fz = p["forward"]
        lx, lz = -fz, fx
        near = T[np.hypot(cen[:, 0] - x, cen[:, 2] - z) < reach + 8]
        if not len(near):
            continue
        prof = []
        for t in np.arange(-reach, reach + 0.01, 0.25):
            px, pz = x + lx * t, z + lz * t
            A, B, C = near[:, 0], near[:, 1], near[:, 2]
            den = (B[:, 2] - C[:, 2]) * (A[:, 0] - C[:, 0]) + (C[:, 0] - B[:, 0]) * (A[:, 2] - C[:, 2])
            with np.errstate(divide="ignore", invalid="ignore"):
                l1 = ((B[:, 2] - C[:, 2]) * (px - C[:, 0]) + (C[:, 0] - B[:, 0]) * (pz - C[:, 2])) / den
                l2 = ((C[:, 2] - A[:, 2]) * (px - C[:, 0]) + (A[:, 0] - C[:, 0]) * (pz - C[:, 2])) / den
            l3 = 1 - l1 - l2
            ok = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6) & (np.abs(den) > 1e-9)
            ys = (l1 * A[:, 1] + l2 * B[:, 1] + l3 * C[:, 1])[ok]
            prof.append(ys.max() if len(ys) else np.nan)
        prof = np.array(prof)
        jump = np.nanmax(np.abs(np.diff(prof))) if np.isfinite(prof).sum() > 2 else np.nan
        holes = int(np.isnan(prof[np.abs(np.arange(-reach, reach + 0.01, 0.25)) < 7]).sum())
        steps.append(jump)
        worst.append((jump, p["distance"], holes, np.nanmax(prof) - np.nanmin(prof)))
    s = np.array(steps)
    print(f"edges: cross-sections {len(s)}, biggest step within 12 m of the line: median {np.nanmedian(s) * 100:.0f} cm, "
          f"95% {np.nanpercentile(s, 95) * 100:.0f} cm, max {np.nanmax(s) * 100:.0f} cm; sections with holes near the road {sum(1 for w in worst if w[2])}")
    for jump, dist, holes, span in sorted(worst, reverse=True)[:6]:
        print(f"   step {jump * 100:.0f} cm at {dist:.0f} m (height span {span:.2f} m{', holes' if holes else ''})")


def drive_report(ai, top, x0, z0):
    """What the car feels along the AI line: cross-slope at +-3 m and height kinks."""
    def h(x, z):
        j, i = int((x - x0) / CELL), int((z - z0) / CELL)
        return top[i, j] if 0 <= i < top.shape[0] and 0 <= j < top.shape[1] else np.nan

    rows = []
    for p in ai:
        x, _, z = p["position"]
        fx, _, fz = p["forward"]
        lx, lz = -fz, fx
        rows.append((p["distance"], h(x, z), (h(x + lx * 3, z + lz * 3) - h(x - lx * 3, z - lz * 3)) / 6, p["radius"]))
    d = np.array(rows)
    centre, cross = d[:, 1], d[:, 2]
    kink = np.abs(centre[2:] - 2 * centre[1:-1] + centre[:-2])
    print(f"driving line: cross-slope 95% {np.nanpercentile(np.abs(cross), 95) * 100:.1f}%, max {np.nanmax(np.abs(cross)) * 100:.1f}%; "
          f"kinks >5 cm {int((kink > 0.05).sum())}, >10 cm {int((kink > 0.10).sum())}")
    worst = np.argsort(-np.nan_to_num(np.abs(cross)))[:6]
    for i in sorted(worst):
        print(f"   tilt {cross[i] * 100:+.1f}% at {d[i, 0]:.0f} m (corner radius {d[i, 3]:.0f} m)")


def main():
    path = sys.argv[1]
    data = json.load(open(path))
    meshes, ai = (data["meshes"], data["ai"]) if isinstance(data, dict) else (data, [])
    drivable = [m for m in meshes if m["name"][:2] == "1R" or m["name"].startswith(("1STREET", "1KERB"))]
    if ai:
        edge_report(ai, meshes)
    meshes = drivable
    top, low, owner, lowner, x0, z0 = raster(meshes)
    # Overlap: two drivable meshes at different heights in one cell (the car hits the higher one).
    overlap = top - low
    # Step to the neighbouring cell, as a slope.
    gx = np.abs(np.diff(top, axis=1)) / CELL
    gz = np.abs(np.diff(top, axis=0)) / CELL
    slope = np.full(top.shape, np.nan)
    slope[:, 1:] = gx
    slope[1:, :] = np.fmax(slope[1:, :], gz)
    names = [m["name"] for m in meshes]

    def report(label, grid, thresh, unit):
        bad = np.argwhere(grid > thresh)
        print(f"{label}: {len(bad)} cells over {thresh}{unit}")
        by = {}
        for i, j in bad:
            key = names[owner[i, j]] if owner[i, j] >= 0 else "?"
            by[key] = by.get(key, 0) + 1
        for k, v in sorted(by.items(), key=lambda kv: -kv[1])[:10]:
            print(f"   {v:6d}  {k}")
        # Worst spots, at least 15 m apart.
        order = np.argsort(-np.nan_to_num(grid[bad[:, 0], bad[:, 1]])) if len(bad) else []
        spots = []
        for o in order:
            i, j = bad[o]
            x, z = x0 + (j + 0.5) * CELL, z0 + (i + 0.5) * CELL
            if all(np.hypot(x - sx, z - sz) > 15 for sx, sz, *_ in spots):
                spots.append((x, z, grid[i, j], names[owner[i, j]] if owner[i, j] >= 0 else "?"))
            if len(spots) >= 8:
                break
        for x, z, v, n in spots:
            print(f"   at x {x:8.1f}  z {z:8.1f}: {v:.2f}{unit}  ({n})")

    report("overlapping surfaces", overlap, 0.05, " m")
    pairs = {}
    for i, j in np.argwhere(np.nan_to_num(overlap) > 0.05):
        k = (names[owner[i, j]].rstrip("0123456789_"), names[lowner[i, j]].rstrip("0123456789_"))
        pairs[k] = pairs.get(k, 0) + 1
    print("   overlap pairs (higher over lower):", sorted(pairs.items(), key=lambda kv: -kv[1])[:8])
    report("steep steps", slope, 0.25, " (rise/run)")
    if ai:
        drive_report(ai, top, x0, z0)
    ok = np.isfinite(top)
    print(f"drivable cells {ok.sum()}, height range {np.nanmin(top):.2f} to {np.nanmax(top):.2f} m")

    img = np.zeros(top.shape + (3,), np.uint8)
    img[ok] = (60, 60, 60)
    img[np.nan_to_num(slope) > 0.12] = (255, 200, 0)
    img[np.nan_to_num(slope) > 0.25] = (255, 0, 0)
    img[np.nan_to_num(overlap) > 0.05] = (255, 0, 255)
    out = os.path.splitext(path)[0].replace(".surface", "") + ".bumps.png"
    Image.fromarray(img[::-1]).save(out)
    print("map:", out)


if __name__ == "__main__":
    main()
