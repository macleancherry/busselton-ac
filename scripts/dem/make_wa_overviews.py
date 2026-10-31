"""Coarser WA Terrarium tiles (zooms 10 to 14) from the zoom-15 tiles make_wa_tiles.py cut.

A zoom-z tile covers the k x k square of zoom-15 tiles under it (k = 2^(15-z)). Each child is
decoded to heights, every k x k pixel block averaged (no-data pixels left out of the mean; a block
with no data at all stays no data), and the means re-encoded as Terrarium. Heights are averaged,
never the bytes: averaging R, G and B separately breaks wherever G or B wraps.

    python3 -I scripts/dem/make_wa_overviews.py
    python3 -I scripts/dem/make_wa_overviews.py --zooms 10 14 --dem public/dem/wa

Run it after every make_wa_tiles.py cut: the overviews are only as wide as the zoom-15 tiles, so
STATE_DEMS.wa.box (src/services/tiles.ts) still covers them. Old overview zooms are cleared first.
"""

import argparse
import os
import shutil

import numpy as np
from PIL import Image

Z = 15
TILE = 256


def decode(rgba):
    """Heights in metres from Terrarium RGBA (NaN where alpha is 0)."""
    rgba = np.asarray(rgba)
    r, g, b = (rgba[..., k].astype(np.float64) for k in range(3))
    h = r * 256 + g + b / 256 - 32768
    return np.where(rgba[..., 3] > 0, h, np.nan)


def encode(h):
    """Terrarium RGBA from heights in metres (NaN = no data); the same as make_wa_tiles.py's."""
    h = np.asarray(h, np.float64)
    ok = np.isfinite(h)
    v = np.where(ok, h, 0) + 32768
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.round((v - r * 256 - g) * 256)
    carry = b >= 256
    b[carry] = 0
    g[carry] += 1
    carry = g >= 256
    g[carry] = 0
    r[carry] += 1
    rgba = np.zeros(h.shape + (4,), np.uint8)
    rgba[..., 0] = np.clip(r, 0, 255)
    rgba[..., 1] = np.clip(g, 0, 255)
    rgba[..., 2] = np.clip(b, 0, 255)
    rgba[..., 3] = np.where(ok, 255, 0)
    return rgba


def block_sums(h, k):
    """Sum and count of the finite values in each k x k block of a 256 x 256 tile."""
    n = TILE // k
    ok = np.isfinite(h)
    s = np.where(ok, h, 0).reshape(n, k, n, k).sum(axis=(1, 3))
    c = ok.reshape(n, k, n, k).sum(axis=(1, 3))
    return s, c


def overview(children, k):
    """One coarser tile from its children: {(dx, dy): heights} with 0 <= dx, dy < k. NaN where no data."""
    n = TILE // k
    s = np.zeros((TILE, TILE))
    c = np.zeros((TILE, TILE))
    for (dx, dy), h in children.items():
        bs, bc = block_sums(h, k)
        s[dy * n:(dy + 1) * n, dx * n:(dx + 1) * n] = bs
        c[dy * n:(dy + 1) * n, dx * n:(dx + 1) * n] = bc
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(c > 0, s / np.maximum(c, 1), np.nan)


def z15_tiles(dem):
    root = os.path.join(dem, str(Z))
    for xs in os.listdir(root):
        if not xs.isdigit():
            continue
        for name in os.listdir(os.path.join(root, xs)):
            stem, ext = os.path.splitext(name)
            if ext == ".png" and stem.isdigit():
                yield int(xs), int(stem), os.path.join(root, xs, name)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--dem", default=os.path.join(os.path.dirname(__file__), "..", "..", "public", "dem", "wa"))
    ap.add_argument("--zooms", nargs=2, type=int, default=[10, 14], metavar=("MIN", "MAX"))
    args = ap.parse_args()
    lo, hi = args.zooms
    if not 0 <= lo <= hi < Z:
        ap.error(f"zooms must be within 0..{Z - 1}")

    tiles = list(z15_tiles(args.dem))
    print(f"{len(tiles)} zoom-{Z} tiles in {os.path.abspath(args.dem)}")
    for z in range(hi, lo - 1, -1):
        k = 2 ** (Z - z)
        parents = {}
        for x, y, path in tiles:
            parents.setdefault((x // k, y // k), []).append((x % k, y % k, path))
        out = os.path.join(args.dem, str(z))
        shutil.rmtree(out, ignore_errors=True)
        written = 0
        for (px, py), kids in sorted(parents.items()):
            children = {(dx, dy): decode(Image.open(p).convert("RGBA")) for dx, dy, p in kids}
            h = overview(children, k)
            if not np.isfinite(h).any():
                continue
            d = os.path.join(out, str(px))
            os.makedirs(d, exist_ok=True)
            Image.fromarray(encode(h), "RGBA").save(os.path.join(d, f"{py}.png"), optimize=True)
            written += 1
        print(f"zoom {z}: {written} tiles")


if __name__ == "__main__":
    main()
