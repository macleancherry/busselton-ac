"""Check a build without the game: the built road drawn over Landgate's aerial
photo, and its heights against the 5 m DEM tiles.

    python3 -I scripts/check/check_build.py out/<slug>.centreline.json

Writes out/<slug>.overlay.png (photo + road edges in yellow, centreline in red)
and prints height differences. Needs: numpy, pillow (pip install numpy pillow).
"""

import io
import json
import math
import os
import sys
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
LOCATE = ("https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Locate/ImageServer/exportImage"
          "?bbox={b}&bboxSR=3857&imageSR=3857&size={w},{h}&format=jpg&f=image")
R = 6378137.0
DEM_Z = 15


def merc(lng, lat):
    return math.radians(lng) * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R


def dem_height(lng, lat):
    n = 2 ** DEM_Z * 256
    x = (lng + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    p = os.path.join(ROOT, "public", "dem", "wa", str(DEM_Z), str(int(x // 256)), f"{int(y // 256)}.png")
    if not os.path.exists(p):
        return float("nan")
    a = np.asarray(Image.open(p)).astype(float)
    px = a[int(y % 256), int(x % 256)]
    return float("nan") if px[3] == 0 else px[0] * 256 + px[1] + px[2] / 256 - 32768


def main():
    path = sys.argv[1]
    data = json.load(open(path))
    pts = data["centreline"]  # [lng, lat, h, width]
    xy = np.array([merc(p[0], p[1]) for p in pts])
    pad = 60
    x0, y0 = xy.min(0) - pad
    x1, y1 = xy.max(0) + pad
    mpp = 0.3  # metres a pixel
    w, h = int((x1 - x0) / mpp), int((y1 - y0) / mpp)
    scale = min(1.0, 4000 / max(w, h))
    w, h = int(w * scale), int(h * scale)
    mpp /= scale
    url = LOCATE.format(b=f"{x0},{y0},{x1},{y1}", w=w, h=h)
    img = Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=120).read())).convert("RGB")
    draw = ImageDraw.Draw(img)

    def to_px(x, y):
        return (x - x0) / mpp, (y1 - y) / mpp

    # Road edges from the centreline normal and the built width.
    left, right, centre = [], [], []
    for i, (p, q) in enumerate(zip(xy, pts)):
        a = xy[max(i - 1, 0)]
        b = xy[min(i + 1, len(xy) - 1)]
        d = b - a
        L = math.hypot(*d) or 1
        nx, ny = -d[1] / L, d[0] / L
        half = (q[3] if q[3] == q[3] else 7) / 2
        centre.append(to_px(*p))
        left.append(to_px(p[0] + nx * half, p[1] + ny * half))
        right.append(to_px(p[0] - nx * half, p[1] - ny * half))
    draw.line(left, fill=(255, 220, 0), width=2)
    draw.line(right, fill=(255, 220, 0), width=2)
    draw.line(centre, fill=(255, 40, 40), width=1)
    out = os.path.splitext(path)[0].replace(".centreline", "") + ".overlay.png"
    img.save(out)

    # Hairpin spikes: the road reversing within a few metres (a pin on the wrong side of the road).
    spikes = []
    for i in range(3, len(xy) - 3):
        a, b = xy[i] - xy[i - 3], xy[i + 3] - xy[i]
        la, lb = np.hypot(*a), np.hypot(*b)
        if la > 0.1 and lb > 0.1 and np.dot(a, b) / (la * lb) < -0.3:
            if not spikes or i - spikes[-1][0] > 10:
                spikes.append((i, pts[i][0], pts[i][1]))
    for _, lng, lat in spikes:
        draw.ellipse([to_px(*merc(lng, lat))[0] - 25, to_px(*merc(lng, lat))[1] - 25,
                      to_px(*merc(lng, lat))[0] + 25, to_px(*merc(lng, lat))[1] + 25], outline=(255, 0, 255), width=4)
    if spikes:
        img.save(out)

    diffs = np.array([q[2] - dem_height(q[0], q[1]) for q in pts])
    ok = np.isfinite(diffs)
    print(f"overlay: {out} ({w}x{h}, {mpp:.2f} m/px)")
    print(f"samples {len(pts)}, with DEM {ok.sum()}")
    if ok.any():
        d = diffs[ok]
        print(f"road height minus DEM: mean {d.mean():+.2f} m, median {np.median(d):+.2f} m, "
              f"95% within {np.percentile(np.abs(d), 95):.2f} m, max {np.abs(d).max():.2f} m")
    if spikes:
        print(f"HAIRPIN SPIKES: {len(spikes)} (circled in magenta): " + ", ".join(f"{lat:.5f}, {lng:.5f}" for _, lng, lat in spikes))
        sys.exit(1)
    print("no hairpin spikes")


if __name__ == "__main__":
    main()
