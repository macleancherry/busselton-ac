"""Check a build's traffic graph (data/traffic.json, for CSP's traffic planner):

  - lanes run on asphalt: each lane point has the route or a street under it
  - no two intersection polygons overlap (the planner can't handle a lane in two at once)
  - every lane end sits inside an intersection (or the lane loops)
  - zones (src/core/trafficZones.ts): areas well formed, forbidden turns name real lanes, no lane
    left with no way on where it ends, and in the kids' setting every limit within the kids' caps;
    prints lane length per zone and the suggested car count

    npx tsx scripts/check/dump_surface.ts out/<slug>.zip out/<slug>.surface.json
    python3 -I scripts/check/traffic_check.py out/<slug>.zip out/<slug>.surface.json

Exits non-zero when polygons overlap, a lane end is loose, lanes leave the asphalt, or a zone check
fails, and writes out/<slug>.traffic.png: lanes over the drivable surface coloured by zone (busy
orange, town centre red, quiet green, highway purple, roundabouts blue), polygons shaded, areas
outlined. Every layout's traffic.json is checked (they differ only by setting).
"""

import json
import os
import sys
import zipfile

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from surface_check import CELL, covered  # noqa: E402


def _cross(p, q, r, s):
    d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0])
    if abs(d) < 1e-12:
        return False
    t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d
    u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d
    return 0 < t < 1 and 0 < u < 1


def overlap(a, b):
    """Two simple polygons (lists of (x, z)) overlap: edges cross, or one holds the other."""
    xa, za = zip(*a)
    xb, zb = zip(*b)
    if max(xa) < min(xb) or max(xb) < min(xa) or max(za) < min(zb) or max(zb) < min(za):
        return False
    for i in range(len(a)):
        for j in range(len(b)):
            if _cross(a[i], a[(i + 1) % len(a)], b[j], b[(j + 1) % len(b)]):
                return True
    return inside(a, b[0]) or inside(b, a[0])


def inside(poly, pt):
    c = False
    j = len(poly) - 1
    for i in range(len(poly)):
        (xi, zi), (xj, zj) = poly[i], poly[j]
        if (zi > pt[1]) != (zj > pt[1]) and pt[0] < (xj - xi) * (pt[1] - zi) / (zj - zi) + xi:
            c = not c
        j = i
    return c


# The kids' setting's caps per zone, km/h (trafficZones.ts ZONES), and the old roles' zones by name.
KIDS_CAP = {"quiet": 30, "centre": 30, "busy": 40, "highway": 60, "roundabout": 20}
LEGACY_ZONE = {"Local street": "quiet", "Town road": "busy", "Main road": "busy", "Highway": "highway", "Roundabout": "roundabout"}
ZONE_RGB = {"quiet": (0, 140, 0), "centre": (210, 0, 0), "busy": (240, 130, 0), "highway": (130, 0, 170), "roundabout": (0, 90, 220)}


def role_zone(role):
    return role.get("zone") or LEGACY_ZONE.get(role.get("name"), "busy")


def lanes_through(data):
    """For each intersection, the lanes touching it: (lane index, enters, leaves), as trafficZones.ts sees them."""
    rows = [(li, k, p[0], p[2]) for li, lane in enumerate(data["lanes"]) for k, p in enumerate(lane["points"])]
    out = [[] for _ in data["intersections"]]
    if not rows:
        return out
    R = np.array(rows, np.float64)
    for ii, it in enumerate(data["intersections"]):
        poly = [(p[0], p[2]) for p in it["points"]]
        xs, zs = zip(*poly)
        m = (R[:, 2] >= min(xs)) & (R[:, 2] <= max(xs)) & (R[:, 3] >= min(zs)) & (R[:, 3] <= max(zs))
        hits = {}
        for li, k, x, z in R[m]:
            if inside(poly, (x, z)):
                hits.setdefault(int(li), []).append(int(k))
        for li, ks in hits.items():
            lane = data["lanes"][li]
            n = len(lane["points"])
            first = min(ks) == 0 and not lane["loop"]
            last = max(ks) == n - 1 and not lane["loop"]
            out[ii].append((li, not first, not last))
    return out


def zone_problems(data):
    """Zone checks: report lines and problems (each a reason the check fails)."""
    lines, problems = [], []
    roles = data.get("rules", {}).get("laneRoles", [])
    meta = data.get("busselton", {})
    setting = meta.get("setting", "normal")
    ids = {lane["id"]: li for li, lane in enumerate(data["lanes"])}
    # Lane length per role (the planner takes a lane's limit and priority from its role).
    km = {}
    differ = 0
    for lane in data["lanes"]:
        P = np.asarray(lane["points"], np.float64)
        length = float(np.hypot(*np.diff(P[:, [0, 2]], axis=0).T).sum()) / 1000 if len(P) > 1 else 0
        if not 1 <= lane["role"] <= len(roles):
            problems.append(f"lane {lane['name']} has role {lane['role']}, not one of the {len(roles)} roles")
            continue
        r = roles[lane["role"] - 1]
        km[r["name"]] = km.get(r["name"], 0) + length
        if lane.get("speedLimit") != r["speedLimit"]:
            differ += 1
    lines.append(f"setting: {setting}; suggested cars: {meta.get('cars', '?')} (planner's Cars slider, or the Traffic mode's Cars limit)")
    for r in roles:
        lines.append(f"   role {r['name']:<20} priority {r['priority']:>3}  limit {r['speedLimit']:>3}  lanes {km.get(r['name'], 0):6.2f} km")
    if meta.get("zones"):
        lines.append("   lane km by zone: " + ", ".join(f"{z} {v:.1f}" for z, v in sorted(meta["zones"].items())))
    if differ:
        lines.append(f"   {differ} lanes carry a limit other than their role's (the planner uses the role's)")
    # Areas.
    for a in data.get("areas", []):
        p = a.get("params", {})
        if not a.get("shapes") or any(len(s) < 3 for s in a["shapes"]):
            problems.append(f"area {a.get('name')} has a shape with under 3 points")
        if p.get("role") and not 1 <= p["role"] <= len(roles):
            problems.append(f"area {a.get('name')} names role {p['role']}")
        if p.get("customSpeedLimit") and not p.get("speedLimit"):
            problems.append(f"area {a.get('name')} has a custom limit but no figure")
    if data.get("areas"):
        lines.append(f"   areas: {len(data['areas'])} ({sum(len(a['shapes']) for a in data['areas'])} shapes)")
    # Forbidden turns: real lanes, and every lane that ends in an intersection keeps a way on.
    forbidden = 0
    through = None
    for ii, it in enumerate(data["intersections"]):
        dis = it.get("disallowedTrajectories") or []
        forbidden += len(dis)
        for f, t in dis:
            if f not in ids or t not in ids:
                problems.append(f"{it['name']} forbids a turn from lane {f} to {t}, which aren't both lanes")
        if dis:
            through = through or lanes_through(data)
            banned = {(f, t) for f, t in dis}
            for li, enters, leaves in through[ii]:
                if not enters or leaves:
                    continue
                exits = [data["lanes"][o]["id"] for o, _, lv in through[ii] if lv and o != li]
                if exits and all((data["lanes"][li]["id"], e) in banned for e in exits):
                    problems.append(f"{it['name']}: lane {data['lanes'][li]['name']} ends here with every way on forbidden")
    if forbidden:
        lines.append(f"   forbidden turns (busy road into a quiet street): {forbidden}; {100 * meta.get('quietEntry', 1):.0f}% of them left open")
    # The kids' setting: every limit within its zone's cap.
    if setting == "kids":
        for r in roles:
            cap = KIDS_CAP[role_zone(r)]
            if r["speedLimit"] > cap:
                problems.append(f"kids' setting: role {r['name']} at {r['speedLimit']} km/h, over {cap}")
        for a in data.get("areas", []):
            p = a.get("params", {})
            if p.get("customSpeedLimit") and 1 <= p.get("role", 0) <= len(roles) and p["speedLimit"] > KIDS_CAP[role_zone(roles[p["role"] - 1])]:
                problems.append(f"kids' setting: area {a['name']} at {p['speedLimit']} km/h")
    return lines, problems


def main():
    zpath, spath = sys.argv[1], sys.argv[2]
    with zipfile.ZipFile(zpath) as z:
        names = sorted(n for n in z.namelist() if n.endswith("data/traffic.json"))
        name = names[0]
        data = json.loads(z.read(name))
        others = {n: json.loads(z.read(n)) for n in names[1:]}
    zone_lines, zone_bad = zone_problems(data)
    print(f"{name}:")
    for line in zone_lines:
        print(line)
    for n, d in others.items():
        lines, bad = zone_problems(d)
        print(f"{n}: {lines[0]}")
        zone_bad += [f"{n}: {b}" for b in bad]
        if [l["points"] for l in d["lanes"]] != [l["points"] for l in data["lanes"]]:
            print(f"   note: {n} has other lanes than {name}")
    print(f"zone problems: {len(zone_bad)}")
    for b in zone_bad[:10]:
        print(f"   {b}")
    surf = json.load(open(spath))
    drivable = lambda n: n[:2] == "1R" or n.startswith("1STREET")
    cells, x0, z0, H, W = covered([m for m in surf["meshes"] if drivable(m["name"])])

    def on_road(x, z, reach=1):
        i, j = int((z - z0) / CELL), int((x - x0) / CELL)
        return any(0 <= i + a < H and 0 <= j + b < W and (i + a) * W + j + b in cells
                   for a in range(-reach, reach + 1) for b in range(-reach, reach + 1))

    polys = [[(p[0], p[2]) for p in it["points"]] for it in data["intersections"]]
    bad_pairs = [(a, b) for a in range(len(polys)) for b in range(a + 1, len(polys)) if overlap(polys[a], polys[b])]
    pts = off = 0
    loose_ends = 0
    loose_at = []
    for lane in data["lanes"]:
        for p in lane["points"]:
            pts += 1
            if not on_road(p[0], p[2]):
                off += 1
        if not lane["loop"]:
            for p in (lane["points"][0], lane["points"][-1]):
                if not any(inside(poly, (p[0], p[2])) for poly in polys):
                    loose_ends += 1
                    loose_at.append((p[0], p[2]))
    print(f"traffic: {len(data['lanes'])} lanes, {len(data['intersections'])} intersections")
    print(f"lane points on asphalt: {100 * (pts - off) / max(1, pts):.1f}% ({off} of {pts} off)")
    print(f"overlapping intersections: {len(bad_pairs)}")
    for a, b in bad_pairs[:8]:
        print(f"   {data['intersections'][a]['name']} and {data['intersections'][b]['name']} near x {polys[a][0][0]:.0f} z {polys[a][0][1]:.0f}")
    print(f"lane ends outside any intersection: {loose_ends}")
    for x, z in loose_at[:8]:
        print(f"   at x {x:.0f} z {z:.0f}")
    # Parked cars (their collision boxes) in a lane: traffic would drive into them.
    cars = []
    for m in surf["meshes"]:
        if m["name"].startswith("1WALL_CAR"):
            P = np.asarray(m["p"], np.float64).reshape(-1, 3)
            cars += [P[k:k + 20, [0, 2]].mean(0) for k in range(0, len(P), 20)]  # 20 vertices per box (scenery.box)
    blocked = []
    if cars:
        C = np.array(cars)
        for lane in data["lanes"]:
            for p in lane["points"]:
                d = np.hypot(C[:, 0] - p[0], C[:, 1] - p[2])
                if d.min() < 1.6:
                    blocked.append((p[0], p[2]))
    print(f"parked cars {len(cars)}, lane points blocked by one: {len(blocked)}")
    for x, z in blocked[:5]:
        print(f"   at x {x:.0f} z {z:.0f}")

    # Map: asphalt grey, polygons shaded, lanes on top (off-asphalt points in red).
    # Shrunk to at most 6000 px a side for long tracks.
    shrink = max(1, -(-max(W, H) // 6000))
    grey = np.full((-(-H // shrink), -(-W // shrink)), 255, np.uint8)
    c = np.fromiter(cells, np.int64, len(cells))
    grey[(c // W) // shrink, (c % W) // shrink] = 170
    img = Image.fromarray(grey).convert("RGB")
    d = ImageDraw.Draw(img, "RGBA")
    f = lambda x, z: ((x - x0) / CELL / shrink, (z - z0) / CELL / shrink)
    for i, poly in enumerate(polys):
        bad = any(i in pair for pair in bad_pairs)
        d.polygon([f(*p) for p in poly], fill=(255, 0, 0, 90) if bad else (60, 160, 255, 70))
    roles = data.get("rules", {}).get("laneRoles", [])
    for a in data.get("areas", []):
        r = roles[a["params"]["role"] - 1] if 1 <= a.get("params", {}).get("role", 0) <= len(roles) else {}
        for s in a["shapes"]:
            d.polygon([f(p[0], p[2]) for p in s], outline=ZONE_RGB.get(role_zone(r), (0, 0, 0)) + (255,))
    for lane in data["lanes"]:
        line = [f(p[0], p[2]) for p in lane["points"]]
        r = roles[lane["role"] - 1] if 1 <= lane["role"] <= len(roles) else {}
        d.line(line + ([line[0]] if lane["loop"] else []), fill=ZONE_RGB.get(role_zone(r), (0, 110, 0)), width=1)
        for p in lane["points"]:
            if not on_road(p[0], p[2]):
                x, z = f(p[0], p[2])
                d.ellipse([x - 2, z - 2, x + 2, z + 2], fill=(220, 0, 0))
    out = os.path.splitext(spath)[0].replace(".surface", "") + ".traffic.png"
    img.save(out)
    print(f"map: {out}")
    failed = bad_pairs or loose_ends or off > 0.03 * pts or blocked or zone_bad
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
