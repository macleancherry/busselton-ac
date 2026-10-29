#!/usr/bin/env python3
"""Print an AI line file's lookup grid, to learn how Kunos lays theirs out (ours has none yet).

    python -I scripts/check/ai_grid.py <path to fast_lane.ai> [more files ...]

Run it on the workstation against a few Kunos tracks, e.g.
    python -I scripts\\check\\ai_grid.py "C:\\...\\assettocorsa\\content\\tracks\\ks_black_cat_county\\ai\\fast_lane.ai"
and paste the output into the report. Read only; changes nothing.

Layout (version 7, as Content Manager's AcTools.AiFile reads it): header, points, extra point data,
then i32 hasGrid and, when non-zero: f32[3] max extreme, f32[3] min extreme, i32 neighbours
considered, f32 sampling density, i32 outer count, then for each outer item an i32 inner count and for
each inner item an i32 count of point indices followed by the indices.
"""
import struct
import sys


def read(path):
    data = open(path, "rb").read()
    o = 0

    def i32():
        nonlocal o
        v = struct.unpack_from("<i", data, o)[0]
        o += 4
        return v

    def f32s(n):
        nonlocal o
        v = struct.unpack_from(f"<{n}f", data, o)
        o += 4 * n
        return v

    version = i32()
    count, lap_time, samples = i32(), i32(), i32()
    first = f32s(3)
    o += count * 20 - 12  # positions (12) + distance (4) + id (4) each; first position already read
    extra = i32()
    o += extra * 18 * 4
    print(f"{path}\n  version {version}, {count} points, lapTime {lap_time}, sampleCount {samples}, first point {tuple(round(x, 1) for x in first)}")
    has_grid = i32()
    print(f"  hasGrid {has_grid}")
    if not has_grid:
        print(f"  {len(data) - o} bytes after the flag")
        return
    mx, mn = f32s(3), f32s(3)
    neighbours = i32()
    density = f32s(1)[0]
    outer = i32()
    print(f"  max {tuple(round(x, 1) for x in mx)}, min {tuple(round(x, 1) for x in mn)}")
    print(f"  neighbours considered {neighbours}, sampling density {density}")
    sizes, cells, filled, first_cells = [], 0, 0, []
    for a in range(outer):
        inner = i32()
        sizes.append(inner)
        for b in range(inner):
            n = i32()
            idx = struct.unpack_from(f"<{n}i", data, o) if n else ()
            o += 4 * n
            cells += 1
            if n:
                filled += 1
                if len(first_cells) < 6:
                    first_cells.append((a, b, n, idx[:8]))
    print(f"  outer {outer}, inner per outer {sorted(set(sizes))[:6]}{'...' if len(set(sizes)) > 6 else ''}; {cells} cells, {filled} with points")
    ext = [mx[k] - mn[k] for k in range(3)]
    print(f"  extent x {ext[0]:.1f} m, y {ext[1]:.1f} m, z {ext[2]:.1f} m; extent / outer: x {ext[0] / max(1, outer):.2f}, z {ext[2] / max(1, outer):.2f}")
    for a, b, n, idx in first_cells:
        print(f"  cell [{a}][{b}]: {n} points, first {list(idx)}")
    print(f"  {len(data) - o} bytes left over")


for p in sys.argv[1:]:
    read(p)
