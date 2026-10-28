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


TILE = 1024  # cells per tile side: long tracks are rasterised a tile at a time to keep memory down


def triangles(meshes):
    """Every triangle of the meshes as (n, 3, 3) points, with the index of its mesh."""
    tris, owner = [], []
    for mi, m in enumerate(meshes):
        P = np.asarray(m["p"], np.float64).reshape(-1, 3)
        I = np.asarray(m["i"], np.int64).reshape(-1, 3)
        tris.append(P[I])
        owner.append(np.full(len(I), mi, np.int32))
    return np.concatenate(tris), np.concatenate(owner)


def covered(meshes):
    """Cells any of the meshes cover, as a set of i * W + j, with the grid (x0, z0, H, W). Tile by tile."""
    T, towner = triangles(meshes)
    tmin, tmax = T.min(1), T.max(1)
    x0, z0 = tmin[:, 0].min() - 2, tmin[:, 2].min() - 2
    W = int((tmax[:, 0].max() + 2 - x0) / CELL) + 1
    H = int((tmax[:, 2].max() + 2 - z0) / CELL) + 1
    cells = set()
    for ti in range(0, H, TILE):
        for tj in range(0, W, TILE):
            h, w = min(H, ti + TILE) - ti, min(W, tj + TILE) - tj
            bx0, bz0 = x0 + tj * CELL, z0 + ti * CELL
            sel = (tmax[:, 0] >= bx0) & (tmin[:, 0] <= bx0 + w * CELL) & (tmax[:, 2] >= bz0) & (tmin[:, 2] <= bz0 + h * CELL)
            if not sel.any():
                continue
            top = raster(T[sel], towner[sel], bx0, bz0, h, w)[0]
            i, j = np.nonzero(np.isfinite(top))
            cells.update(((i + ti) * W + j + tj).tolist())
    return cells, x0, z0, H, W


def raster(T, towner, x0, z0, H, W):
    """Highest and lowest surface (and whose) in each CELL of an H x W grid from (x0, z0)."""
    top = np.full((H, W), np.nan)
    low = np.full((H, W), np.nan)
    owner = np.full((H, W), -1, np.int32)
    lowner = np.full((H, W), -1, np.int32)
    for (A, B, C), mi in zip(T, towner):
        xs = (np.array([A[0], B[0], C[0]]) - x0) / CELL
        zs = (np.array([A[2], B[2], C[2]]) - z0) / CELL
        i0, i1 = max(0, int(np.floor(zs.min()))), min(H - 1, int(np.ceil(zs.max())))
        j0, j1 = max(0, int(np.floor(xs.min()))), min(W - 1, int(np.ceil(xs.max())))
        den = (zs[1] - zs[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (zs[0] - zs[2])
        if abs(den) < 1e-9 or i0 > i1 or j0 > j1:
            continue
        jj, ii = np.meshgrid(np.arange(j0, j1 + 1), np.arange(i0, i1 + 1))
        px, pz = jj + 0.5, ii + 0.5
        l1 = ((zs[1] - zs[2]) * (px - xs[2]) + (xs[2] - xs[1]) * (pz - zs[2])) / den
        l2 = ((zs[2] - zs[0]) * (px - xs[2]) + (xs[0] - xs[2]) * (pz - zs[2])) / den
        l3 = 1 - l1 - l2
        ok = (l1 >= -1e-6) & (l2 >= -1e-6) & (l3 >= -1e-6)
        if not ok.any():
            continue
        y = (l1 * A[1] + l2 * B[1] + l3 * C[1])[ok]
        ii, jj = ii[ok], jj[ok]
        cur = top[ii, jj]
        up = np.isnan(cur) | (y > cur)
        top[ii[up], jj[up]] = y[up]
        owner[ii[up], jj[up]] = mi
        cur = low[ii, jj]
        dn = np.isnan(cur) | (y < cur)
        low[ii[dn], jj[dn]] = y[dn]
        lowner[ii[dn], jj[dn]] = mi
    return top, low, owner, lowner


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


def drive_queries(ai):
    """The points drive_report needs heights at: on the line and 3 m either side."""
    q = []
    for p in ai:
        x, _, z = p["position"]
        fx, _, fz = p["forward"]
        lx, lz = -fz, fx
        q += [(x, z), (x + lx * 3, z + lz * 3), (x - lx * 3, z - lz * 3)]
    return q


def drive_report(ai, heights):
    """What the car feels along the AI line: cross-slope at +-3 m and height kinks."""
    it = iter(heights)

    def h(x, z):
        return next(it)

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
    names = [m["name"] for m in meshes]
    T, towner = triangles(meshes)
    tmin, tmax = T.min(1), T.max(1)
    x0, z0 = tmin[:, 0].min() - 2, tmin[:, 2].min() - 2
    W = int((tmax[:, 0].max() + 2 - x0) / CELL) + 1
    H = int((tmax[:, 2].max() + 2 - z0) / CELL) + 1
    queries = np.array(drive_queries(ai)) if ai else np.zeros((0, 2))
    heights = np.full(len(queries), np.nan)
    # The map, shrunk to at most 6000 px a side.
    shrink = max(1, -(-max(W, H) // 6000))
    img = np.zeros((-(-H // shrink), -(-W // shrink)), np.uint8)
    bad = {"overlap": [], "slope": []}
    pairs, drivable_cells, hmin, hmax = {}, 0, np.inf, -np.inf
    for ti in range(0, H, TILE):
        for tj in range(0, W, TILE):
            # One cell of overlap with the previous tiles, for the steps across the seam.
            a, b = max(0, ti - 1), max(0, tj - 1)
            h, w = min(H, ti + TILE) - a, min(W, tj + TILE) - b
            bx0, bz0 = x0 + b * CELL, z0 + a * CELL
            sel = (tmax[:, 0] >= bx0) & (tmin[:, 0] <= bx0 + w * CELL) & (tmax[:, 2] >= bz0) & (tmin[:, 2] <= bz0 + h * CELL)
            if not sel.any():
                continue
            top, low, owner, lowner = raster(T[sel], towner[sel], bx0, bz0, h, w)
            overlap = top - low
            slope = np.full(top.shape, np.nan)
            slope[:, 1:] = np.abs(np.diff(top, axis=1)) / CELL
            slope[1:, :] = np.fmax(slope[1:, :], np.abs(np.diff(top, axis=0)) / CELL)
            # This tile owns the cells from (ti, tj); the overlap row/column belongs to the previous ones.
            oi, oj = ti - a, tj - b
            own = (slice(oi, None), slice(oj, None))
            for label, grid, thresh in (("overlap", overlap, 0.05), ("slope", slope, 0.25)):
                g = grid[own]
                for i, j in np.argwhere(np.nan_to_num(g) > thresh):
                    I, J = i + oi, j + oj
                    bad[label].append((g[i, j], bx0 + (J + 0.5) * CELL, bz0 + (I + 0.5) * CELL,
                                       names[owner[I, J]] if owner[I, J] >= 0 else "?"))
                    if label == "overlap":
                        k = (names[owner[I, J]].rstrip("0123456789_"), names[lowner[I, J]].rstrip("0123456789_"))
                        pairs[k] = pairs.get(k, 0) + 1
            t = top[own]
            ok = np.isfinite(t)
            drivable_cells += int(ok.sum())
            if ok.any():
                hmin, hmax = min(hmin, np.nanmin(t)), max(hmax, np.nanmax(t))
            if len(queries):
                qj = ((queries[:, 0] - bx0) / CELL).astype(int)
                qi = ((queries[:, 1] - bz0) / CELL).astype(int)
                inside = (qi >= oi) & (qi < h) & (qj >= oj) & (qj < w)
                heights[inside] = top[qi[inside], qj[inside]]
            cls = np.zeros(t.shape, np.uint8)
            sl, ov = np.nan_to_num(slope[own]), np.nan_to_num(overlap[own])
            cls[ok] = 1
            cls[sl > 0.12] = 2
            cls[sl > 0.25] = 3
            cls[ov > 0.05] = 4
            for i in range(0, cls.shape[0], shrink):
                row = cls[i:i + shrink]
                red = row.max(0) if shrink > 1 else row[0]
                if shrink > 1:
                    pad = (-len(red)) % shrink
                    red = np.pad(red, (0, pad)).reshape(-1, shrink).max(1)
                gi, gj = (ti + i) // shrink, tj // shrink
                img[gi, gj:gj + len(red)] = np.maximum(img[gi, gj:gj + len(red)], red[: img.shape[1] - gj])

    def report(label, items, thresh, unit):
        print(f"{label}: {len(items)} cells over {thresh}{unit}")
        by = {}
        for _, _, _, n in items:
            by[n] = by.get(n, 0) + 1
        for k, v in sorted(by.items(), key=lambda kv: -kv[1])[:10]:
            print(f"   {v:6d}  {k}")
        # Worst spots, at least 15 m apart.
        spots = []
        for v, x, z, n in sorted(items, key=lambda it: -it[0]):
            if all(np.hypot(x - sx, z - sz) > 15 for sx, sz, *_ in spots):
                spots.append((x, z, v, n))
            if len(spots) >= 8:
                break
        for x, z, v, n in spots:
            print(f"   at x {x:8.1f}  z {z:8.1f}: {v:.2f}{unit}  ({n})")

    report("overlapping surfaces", bad["overlap"], 0.05, " m")
    print("   overlap pairs (higher over lower):", sorted(pairs.items(), key=lambda kv: -kv[1])[:8])
    report("steep steps", bad["slope"], 0.25, " (rise/run)")
    if ai:
        drive_report(ai, heights)
    print(f"drivable cells {drivable_cells}, height range {hmin:.2f} to {hmax:.2f} m")

    palette = np.array([(0, 0, 0), (60, 60, 60), (255, 200, 0), (255, 0, 0), (255, 0, 255)], np.uint8)
    out = os.path.splitext(path)[0].replace(".surface", "") + ".bumps.png"
    Image.fromarray(palette[img][::-1]).save(out)
    print("map:", out + (f" ({shrink * CELL:g} m/px)" if shrink > 1 else ""))


if __name__ == "__main__":
    main()
