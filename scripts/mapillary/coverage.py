"""Mapillary coverage along a built route: which stretches have street-level photos, how old,
and who took them.

    python3 -I scripts/mapillary/coverage.py out/<slug>.centreline.json [--user maccherry]

Reads MAPILLARY_TOKEN from the environment or .env.local. Writes out/<slug>.mapillary.json
(images near the route) and prints a summary. Mapillary data is CC BY-SA: builds using it stay
private.
"""

import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone

NEAR = 20.0  # metres from the centreline that counts as "on the route"
BOX = 0.01  # degrees per query box (the API allows 0.01 square degrees)


def token():
    if os.environ.get("MAPILLARY_TOKEN"):
        return os.environ["MAPILLARY_TOKEN"]
    env = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".env.local")
    for line in open(env):
        if line.startswith("MAPILLARY_TOKEN="):
            return line.split("=", 1)[1].strip()
    sys.exit("no MAPILLARY_TOKEN")


def get(url, params):
    q = urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(f"{url}?{q}", timeout=60) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(2 + attempt * 3)


def images_in(box, tok, user=None):
    params = {"access_token": tok, "fields": "id,captured_at,creator,geometry,sequence,is_pano,camera_type",
              "bbox": ",".join(f"{v:.6f}" for v in box), "limit": 2000}
    if user:
        params["creator_username"] = user
    out, url = [], "https://graph.mapillary.com/images"
    while url:
        d = get(url, params) if params else json.load(urllib.request.urlopen(url, timeout=60))
        out += d.get("data", [])
        url, params = d.get("paging", {}).get("next"), None
    return out


def main():
    path = sys.argv[1]
    user = sys.argv[sys.argv.index("--user") + 1] if "--user" in sys.argv else None
    c = json.load(open(path))["centreline"]
    lng0, lat0 = c[0][0], c[0][1]
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    route = [((p[0] - lng0) * kx, (p[1] - lat0) * ky) for p in c]
    lngs, lats = [p[0] for p in c], [p[1] for p in c]
    pad = 0.0004
    tok = token()
    seen = {}
    lo_x, hi_x, lo_y, hi_y = min(lngs) - pad, max(lngs) + pad, min(lats) - pad, max(lats) + pad
    x = lo_x
    while x < hi_x:
        y = lo_y
        while y < hi_y:
            box = (x, y, min(x + BOX, hi_x), min(y + BOX, hi_y))
            # only boxes the route passes near
            if any(box[0] - pad <= p[0] <= box[2] + pad and box[1] - pad <= p[1] <= box[3] + pad for p in c):
                for im in images_in(box, tok, user):
                    seen[im["id"]] = im
            y += BOX
        x += BOX

    # distance from each image to the route, and each route sample to the nearest image
    cell = 25.0
    grid = defaultdict(list)
    for i, (px, py) in enumerate(route):
        grid[(int(px // cell), int(py // cell))].append(i)

    def nearest(px, py):
        best, bi = 1e9, -1
        gx, gy = int(px // cell), int(py // cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in grid.get((gx + dx, gy + dy), []):
                    d = math.hypot(route[i][0] - px, route[i][1] - py)
                    if d < best:
                        best, bi = d, i
        return best, bi

    near = []
    for im in seen.values():
        lng, lat = im["geometry"]["coordinates"]
        d, i = nearest((lng - lng0) * kx, (lat - lat0) * ky)
        if d <= NEAR:
            im["route_index"], im["route_dist"] = i, round(d, 1)
            near.append(im)

    n = len(route)
    seg = [math.hypot(route[(i + 1) % n][0] - route[i][0], route[(i + 1) % n][1] - route[i][1]) for i in range(n)]
    total = sum(seg)
    newest = [0] * n
    for im in near:
        i = im["route_index"]
        newest[i] = max(newest[i], im["captured_at"])

    # a sample counts as covered if a photo sits within 15 m of route distance either side
    s = [0.0]
    for k in range(n - 1):
        s.append(s[-1] + seg[k])

    def covered(since_ms):
        hit = [False] * n
        idx = sorted(i for i in range(n) if newest[i] >= since_ms)
        j = 0
        for i in range(n):
            while j < len(idx) and s[idx[j]] < s[i] - 15:
                j += 1
            if j < len(idx) and abs(s[idx[j]] - s[i]) <= 15:
                hit[i] = True
        return sum(seg[i] for i in range(n) if hit[i]) / total, hit

    year = lambda ms: datetime.fromtimestamp(ms / 1000, timezone.utc).year
    print(f"route {total / 1000:.2f} km; {len(seen)} images in the area, {len(near)} within {NEAR:.0f} m of the route")
    if near:
        print("by year:", dict(sorted(Counter(year(im["captured_at"]) for im in near).items())))
        print("by contributor:", Counter(im["creator"]["username"] for im in near).most_common(8))
        print("panoramas:", sum(1 for im in near if im.get("is_pano")))
        for label, since in (("any date", 0), ("since 2022", 1640995200000), ("since 2024", 1704067200000)):
            frac, hit = covered(since)
            print(f"route covered ({label}): {frac * 100:.0f}%")
        frac, hit = covered(0)
        gaps, start = [], None
        for i in range(n):
            if not hit[i] and start is None:
                start = i
            if (hit[i] or i == n - 1) and start is not None:
                if s[i] - s[start] > 100:
                    gaps.append((round(s[start]), round(s[i])))
                start = None
        print("gaps over 100 m (route metres):", gaps[:20])
    out = os.path.splitext(path)[0].replace(".centreline", "") + ".mapillary.json"
    json.dump({"route_km": total / 1000, "images": near}, open(out, "w"))
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
