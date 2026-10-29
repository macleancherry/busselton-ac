"""What each house's walls are made of, from Mapillary street photos.

    python3 -I scripts/mapillary/house_looks.py out/<slug>.houses.json [--since 2024-01-01] [--user maccherry]
        [--sequence <id>[,<id>...]] [--min-photos 2]

--sequence takes the photos from those sequences instead of searching the area: new uploads can
be public for days before the area search finds them. A sequence id is in the photo's details on
mapillary.com, or from https://graph.mapillary.com/<image id>?fields=sequence.

Reads the house fronts a build wrote (out/<slug>.houses.json), finds the street photos that see
each front, samples the wall between the fence tops and the eaves, and votes on the facade
(brick, creambrick, render, weatherboard) by colour across every photo of it. Writes
out/<slug>.looks.json for the next build (HOUSE_LOOKS=out/<slug>.looks.json) and
out/<slug>.looks.png, a contact sheet of the wall samples to check by eye.

Needs MAPILLARY_TOKEN (environment or .env.local). Photos are cached in out/mly_cache/.
Mapillary is CC BY-SA: builds using it stay private.
"""

import io
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

import numpy as np
from PIL import Image, ImageDraw

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
CACHE = os.path.join(ROOT, "out", "mly_cache")
CAM_H = 1.4  # dashcam / phone height above the road, metres
BOX = 0.0099  # degrees: the API allows 0.01 square degrees per query


def token():
    if os.environ.get("MAPILLARY_TOKEN"):
        return os.environ["MAPILLARY_TOKEN"]
    for line in open(os.path.join(ROOT, ".env.local")):
        if line.startswith("MAPILLARY_TOKEN="):
            return line.split("=", 1)[1].strip()
    sys.exit("no MAPILLARY_TOKEN")


def fetch(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception:  # noqa: BLE001
            if k == tries - 1:
                raise
            time.sleep(2 + 3 * k)


def images_in(box, tok, user=None, since=None):
    fields = "id,captured_at,creator,computed_geometry,geometry,computed_compass_angle,compass_angle,camera_type,camera_parameters,width,height,thumb_1024_url,is_pano"
    params = {"access_token": tok, "fields": fields, "bbox": ",".join(f"{v:.6f}" for v in box), "limit": 2000}
    if user:
        params["creator_username"] = user
    if since:
        params["start_captured_at"] = since + "T00:00:00Z"
    url = "https://graph.mapillary.com/images?" + urllib.parse.urlencode(params)
    out = []
    while url:
        d = json.loads(fetch(url))
        out += d.get("data", [])
        url = d.get("paging", {}).get("next")
    return out


def images_in_sequences(ids, tok):
    """Every photo in the sequences (the API wants their ids, then the fields per image)."""
    fields = "id,captured_at,creator,computed_geometry,geometry,computed_compass_angle,compass_angle,camera_type,camera_parameters,width,height,thumb_1024_url,is_pano"
    out = []
    for seq in ids:
        url = "https://graph.mapillary.com/images?" + urllib.parse.urlencode({"access_token": tok, "sequence_ids": seq, "fields": "id", "limit": 2000})
        image_ids = [d["id"] for d in json.loads(fetch(url)).get("data", [])]
        for k in range(0, len(image_ids), 50):
            url = "https://graph.mapillary.com/?" + urllib.parse.urlencode({"access_token": tok, "ids": ",".join(image_ids[k:k + 50]), "fields": fields})
            out += list(json.loads(fetch(url)).values())
    return out


def thumb(im):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{im['id']}.jpg")
    if not os.path.exists(path):
        open(path, "wb").write(fetch(im["thumb_1024_url"]))
    return Image.open(path).convert("RGB")


class Camera:
    """OpenSfM camera models as Mapillary reports them (focal and k1, k2 as fractions of the
    larger image side), facing its compass heading, level, CAM_H above the ground."""

    def __init__(self, im, to_local):
        g = (im.get("computed_geometry") or im["geometry"])["coordinates"]
        self.c = np.array(to_local(g[0], g[1]))
        h = math.radians(im.get("computed_compass_angle", im.get("compass_angle", 0)))
        self.fwd = np.array([math.sin(h), math.cos(h)])
        self.right = np.array([math.cos(h), -math.sin(h)])
        p = im.get("camera_parameters") or [0.85, 0, 0]
        self.f, self.k1, self.k2 = (p + [0, 0, 0])[:3]
        self.kind = im.get("camera_type", "perspective")

    def project(self, pt, z, size):
        d = np.asarray(pt) - self.c
        X, Zc = float(d @ self.right), float(d @ self.fwd)
        Y = -(z - CAM_H)
        if Zc < 1.5:
            return None
        xn, yn = X / Zc, Y / Zc
        r = math.hypot(xn, yn)
        if self.kind == "fisheye":
            th = math.atan(r)
            thd = th * (1 + self.k1 * th * th + self.k2 * th ** 4)
            s = thd / r if r > 1e-9 else 1
        elif self.kind == "perspective":
            r2 = r * r
            s = 1 + self.k1 * r2 + self.k2 * r2 * r2
        else:
            return None  # panoramas: not yet
        w, h = size
        S = max(w, h)
        u, v = self.f * S * xn * s + w / 2, self.f * S * yn * s + h / 2
        if not (0 <= u < w and 0 <= v < h):
            return None
        return u, v


def classify(rgb):
    """Facade from the wall's median colour (0..1). None when it's not clear."""
    r, g, b = rgb
    lum = (r + g + b) / 3
    mx, mn = max(rgb), min(rgb)
    sat = (mx - mn) / (mx + 1e-6)
    if r > g * 1.12 and r > b * 1.3 and lum < 0.62:
        return "brick"
    if r > b * 1.12 and lum >= 0.5 and sat < 0.35:
        return "creambrick"
    if sat < 0.14 and lum >= 0.55:
        return "render"
    if sat < 0.18 and lum < 0.45:
        return "weatherboard"  # dark painted cladding, as on newer estates
    return None


def main():
    path = sys.argv[1]
    arg = lambda k: sys.argv[sys.argv.index(k) + 1] if k in sys.argv else None
    since, user = arg("--since"), arg("--user")
    # Photos that must agree on a house: 2 by default; 1 for sparse footage (one clear frame per house).
    min_photos = int(arg("--min-photos") or 2)
    houses = json.load(open(path))
    if not houses:
        sys.exit("no houses in " + path)
    pts = np.array([p for h in houses for p in h["front"]])
    lng0, lat0 = pts[:, 0].mean(), pts[:, 1].mean()
    kx, ky = 111320 * math.cos(math.radians(lat0)), 110540
    to_local = lambda lng, lat: ((lng - lng0) * kx, (lat - lat0) * ky)

    tok = token()
    pad = 0.0004
    w0, e0, s0, n0 = pts[:, 0].min() - pad, pts[:, 0].max() + pad, pts[:, 1].min() - pad, pts[:, 1].max() + pad
    images = {}
    sequences = arg("--sequence")
    if sequences:
        for im in images_in_sequences(sequences.split(","), tok):
            if im.get("thumb_1024_url") and not im.get("is_pano"):
                images[im["id"]] = im
    x = w0 if not sequences else e0
    while x < e0:
        y = s0
        while y < n0:
            box = (x, y, min(x + BOX, e0), min(y + BOX, n0))
            # only boxes with houses in them
            if ((pts[:, 0] >= box[0] - pad) & (pts[:, 0] <= box[2] + pad) & (pts[:, 1] >= box[1] - pad) & (pts[:, 1] <= box[3] + pad)).any():
                for im in images_in(box, tok, user, since):
                    if im.get("thumb_1024_url") and not im.get("is_pano"):
                        images[im["id"]] = im
            y += BOX
        x += BOX
    print(f"{len(houses)} houses, {len(images)} photos around them")
    cams = {k: Camera(im, to_local) for k, im in images.items()}
    grid = defaultdict(list)
    for k, c in cams.items():
        grid[(int(c.c[0] // 40), int(c.c[1] // 40))].append(k)

    looks, sheet = [], []
    why = defaultdict(int)  # what each photo or house fell at, printed at the end
    for hi, h in enumerate(houses):
        A, B = np.array(to_local(*h["front"][0])), np.array(to_local(*h["front"][1]))
        M = (A + B) / 2
        L = float(np.linalg.norm(B - A))
        if L < 4:
            continue
        nrm = np.array([-(B - A)[1], (B - A)[0]]) / L
        # Between the fence tops (about 1.6 m) and just under the eaves of the ground floor.
        eave = min(h["height"], 2.8)
        band = [(t, z) for t in np.linspace(0.15, 0.85, 9) for z in np.linspace(1.3, eave - 0.5, 4)]
        votes = defaultdict(float)
        photos = defaultdict(int)
        seen = []
        gx, gy = int(M[0] // 40), int(M[1] // 40)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for k in grid.get((gx + dx, gy + dy), []):
                    cam = cams[k]
                    d = cam.c - M
                    dist = float(np.linalg.norm(d))
                    # In front of the wall (either face: we don't know which way the house faces),
                    # 5 to 35 m away, and not edge-on. Further off, the whole wall spans a degree or
                    # two round the horizon and a little camera pitch puts the samples on the roof.
                    side = float(d @ nrm) / max(dist, 1e-6)
                    if not (5 <= dist <= 35) or abs(side) < 0.3:
                        continue
                    # ...and in the shot: a forward-facing phone sees a house beside the road only
                    # while it's still ahead, so the nearest photos are often the useless ones.
                    im = images[k]
                    size = (1024, int(1024 * im.get("height", 768) / max(1, im.get("width", 1024))))
                    inside = sum(1 for t, z in band if cam.project(A + (B - A) * t, z, size)) / len(band)
                    if inside < 0.6:
                        continue
                    seen.append((k, dist, abs(side)))
        if not seen:
            why["house: no photo 5-35 m away with it in shot"] += 1
        seen.sort(key=lambda s: s[1])
        best = None
        for k, dist, facing in seen[:12]:
            cam = cams[k]
            try:
                img = thumb(images[k])
            except Exception:  # noqa: BLE001
                continue
            px = np.asarray(img, dtype=np.float32) / 255
            uv = [cam.project(A + (B - A) * t, z, img.size) for t, z in band]
            got = [px[int(v), int(u)] for p in uv if p for u, v in [p]]
            if len(got) < len(band) * 0.6:
                why["photo: wall out of frame"] += 1
                continue
            got = np.array(got)
            r, g, b = got[:, 0], got[:, 1], got[:, 2]
            lum = got.mean(1)
            ok = ((2 * g - r - b) < 0.06) & ~((b > r + 0.08) & (lum > 0.55)) & (lum > 0.1)  # not leaves, sky or shadow
            if ok.mean() < 0.5:
                why["photo: wall hidden (leaves, sky, shadow)"] += 1
                continue
            wall = got[ok]
            med = np.median(wall, axis=0)
            # One material: a wall is even; a tree, a sign or sky behind is not. Signs are loud.
            spread = float(np.percentile(wall.mean(1), 80) - np.percentile(wall.mean(1), 20))
            loud = (max(med) - min(med)) / (max(med) + 1e-6) > 0.5
            f = classify(med) if spread < 0.12 and not loud else None
            weight = facing * ok.mean() * (1 / (1 + dist / 15))
            if not f:
                why["photo: wall not one material"] += 1
            if f:
                votes[f] += weight
                photos[f] += 1
            if best is None or weight > best[0]:
                best = (weight, k, [p for p in uv if p], med, f)
        if votes:
            top = max(votes, key=votes.get)
            share = votes[top] / sum(votes.values())
            n = sum(1 for _ in votes)
            mid = ((h["front"][0][0] + h["front"][1][0]) / 2, (h["front"][0][1] + h["front"][1][1]) / 2)
            if not (share >= 0.6 and photos[top] >= min_photos):
                why["house: photos disagree or only one"] += 1
            if share >= 0.6 and photos[top] >= min_photos:
                looks.append({"at": [round(mid[0], 7), round(mid[1], 7)], "facade": top, "confidence": round(share, 2), "photo": best[1] if best else None})
            if best and len(sheet) < 48:
                sheet.append((best, top, share, h["facade"]))
    out = os.path.splitext(path)[0].replace(".houses", "")
    json.dump({"made": datetime.now(timezone.utc).isoformat(timespec="seconds"), "houses": looks}, open(out + ".looks.json", "w"), indent=1)
    counts = defaultdict(int)
    for lk in looks:
        counts[lk["facade"]] += 1
    print(f"looks for {len(looks)} houses: {dict(counts)} -> {out}.looks.json")
    for k, v in sorted(why.items()):
        print(f"   {v:5d}  {k}")

    # Contact sheet: each house's best photo, cropped round the wall samples, labelled.
    if sheet:
        tw, th = 256, 192
        cols = 6
        rows = math.ceil(len(sheet) / cols)
        cs = Image.new("RGB", (cols * tw, rows * th), "white")
        dr = ImageDraw.Draw(cs)
        for i, ((_, k, uv, med, f), top, share, was) in enumerate(sheet):
            img = thumb(images[k])
            us, vs = [p[0] for p in uv], [p[1] for p in uv]
            cx, cy = (min(us) + max(us)) / 2, (min(vs) + max(vs)) / 2
            span = max(max(us) - min(us), (max(vs) - min(vs)) * 1.33, 60) * 1.8
            crop = img.crop((int(cx - span / 2), int(cy - span * 0.375), int(cx + span / 2), int(cy + span * 0.375))).resize((tw, th))
            d2 = ImageDraw.Draw(crop)
            sx, sy = tw / span, th / (span * 0.75)
            for u, v in uv:
                X, Y = (u - (cx - span / 2)) * sx, (v - (cy - span * 0.375)) * sy
                d2.rectangle([X - 1, Y - 1, X + 1, Y + 1], outline=(255, 0, 255))
            cs.paste(crop, ((i % cols) * tw, (i // cols) * th))
            dr.rectangle([(i % cols) * tw, (i // cols) * th, (i % cols) * tw + tw, (i // cols) * th + 14], fill=(0, 0, 0))
            dr.text(((i % cols) * tw + 3, (i // cols) * th + 1), f"{top} {share:.0%} (was {was})", fill=(255, 255, 255))
        cs.save(out + ".looks.png")
        print(f"contact sheet: {out}.looks.png")


if __name__ == "__main__":
    main()
