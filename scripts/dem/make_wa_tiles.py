"""Cut Geoscience Australia's 5 m LiDAR DEM into Terrarium PNG tiles for the app.

Input:  the WA zone 50 mosaic (waz50.zip, from data.gov.au, about 2.4 GB), or the
        GeoTIFF inside it.
Output: public/dem/wa/15/{x}/{y}.png, Web Mercator tiles at zoom 15 (about 4 m
        a pixel at Busselton), heights encoded as Terrarium RGB
        (h = R*256 + G + B/256 - 32768); transparent pixels have no data.

    python3 -I scripts/dem/make_wa_tiles.py /path/to/waz50.zip
    python3 -I scripts/dem/make_wa_tiles.py /path/to/waz50.zip --box 115.2 -33.74 115.54 -33.56

The box must match STATE_DEMS.wa.box in src/services/tiles.ts.
"""

import argparse
import math
import os
import sys
import zipfile

import numpy as np
import rasterio
from PIL import Image
from rasterio.warp import Resampling, reproject
from rasterio.transform import from_bounds

WORLD = 40075016.68557849
Z = 15


def lnglat_to_tile(lng, lat, z):
    n = 2 ** z
    x = (lng + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return int(x), int(y)


def tile_bounds(x, y, z):
    size = WORLD / 2 ** z
    x0 = x * size - WORLD / 2
    y1 = WORLD / 2 - y * size
    return x0, y1 - size, x0 + size, y1


def find_tif(path):
    if path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as zf:
            tifs = [n for n in zf.namelist() if n.lower().endswith((".tif", ".tiff"))]
        if not tifs:
            sys.exit(f"no GeoTIFF inside {path}")
        tifs.sort(key=len)
        return f"zip://{os.path.abspath(path)}!/{tifs[0]}"
    return path


def encode(h):
    """Terrarium RGBA from heights in metres (NaN = no data)."""
    ok = np.isfinite(h)
    v = np.where(ok, h, 0) + 32768
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.round((v - r * 256 - g) * 256)
    # Rounding b up to 256 carries into g.
    carry = b >= 256
    b[carry] = 0
    g[carry] += 1
    rgba = np.zeros(h.shape + (4,), np.uint8)
    rgba[..., 0] = np.clip(r, 0, 255)
    rgba[..., 1] = np.clip(g, 0, 255)
    rgba[..., 2] = np.clip(b, 0, 255)
    rgba[..., 3] = np.where(ok, 255, 0)
    return rgba


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="waz50.zip or the GeoTIFF inside it")
    ap.add_argument("--box", nargs=4, type=float, default=[115.2, -33.74, 115.54, -33.56],
                    metavar=("WEST", "SOUTH", "EAST", "NORTH"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "public", "dem", "wa"))
    args = ap.parse_args()

    w, s, e, n = args.box
    x0, y0 = lnglat_to_tile(w, n, Z)
    x1, y1 = lnglat_to_tile(e, s, Z)
    src_path = find_tif(args.source)
    written = skipped = 0
    with rasterio.open(src_path) as src:
        nodata = src.nodata
        print(f"source {src.crs} {src.res[0]:.1f} m, nodata {nodata}; tiles x {x0}-{x1}, y {y0}-{y1}")
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                b = tile_bounds(x, y, Z)
                dst = np.full((256, 256), np.nan, np.float32)
                reproject(
                    source=rasterio.band(src, 1),
                    destination=dst,
                    src_nodata=nodata,
                    dst_transform=from_bounds(*b, 256, 256),
                    dst_crs="EPSG:3857",
                    dst_nodata=np.nan,
                    resampling=Resampling.bilinear,
                )
                dst[(dst < -100) | (dst > 9000)] = np.nan
                if not np.isfinite(dst).any():
                    skipped += 1
                    continue
                d = os.path.join(args.out, str(Z), str(x))
                os.makedirs(d, exist_ok=True)
                Image.fromarray(encode(dst), "RGBA").save(os.path.join(d, f"{y}.png"), optimize=True)
                written += 1
    print(f"wrote {written} tiles, skipped {skipped} with no data, into {os.path.abspath(args.out)}")


if __name__ == "__main__":
    main()
