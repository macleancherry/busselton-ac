#!/usr/bin/env python3
"""Photo walk: phone photos of house fronts -> house specs -> house looks.

All inputs and outputs are private: keep photos and specs under routes/private/
(gitignored). Nothing here uploads anything.

  match   photo_walk.py match out/<slug>.houses.json <photo dir> --out <walk dir>
          Reads each photo's GPS position and compass heading (EXIF) and works out
          which house it shows. Writes <walk dir>/walk.json.
  draft   photo_walk.py draft <walk dir>
          A draft spec per photographed house from its outline in the build:
          one block the size of the house, facing its street. Guessed fields are
          listed under "guesses". Existing specs are left alone (use --force).
  render  photo_walk.py render <walk dir> [--blender <exe>] [--samples 32]
          A street view of each spec with scripts/blender/house.py (bpy works too).
  review  photo_walk.py review <walk dir>
          <walk dir>/review.html: each house's photos beside its plan and render,
          with a verdict (looks right / needs fixing / leave out) and notes.
  looks   photo_walk.py looks <walk dir> --out routes/private/<file>.json
          The house looks file for HOUSE_LOOKS: a specFile per house, and plain
          generic houses for anyone who asked to be left out ("optOut": true).

Phone settings: location on for the camera. iPhone HEIC photos work when
pillow-heif is installed (pip install pillow-heif); otherwise set Camera >
Formats > Most Compatible.
"""
import argparse
import base64
import io
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageOps

try:
    import pillow_heif  # type: ignore

    pillow_heif.register_heif_opener()
except ImportError:
    pass

ROOT = Path(__file__).resolve().parents[2]
EXTS = {".jpg", ".jpeg", ".heic", ".heif", ".png"}
M_PER_DEG = 111_320.0

# ---------------------------------------------------------------- geometry


class Frame:
    """Local metres (x east, y north) around a reference point."""

    def __init__(self, lng0, lat0):
        self.lng0, self.lat0 = lng0, lat0
        self.kx = M_PER_DEG * math.cos(math.radians(lat0))

    def xy(self, p):
        return ((p[0] - self.lng0) * self.kx, (p[1] - self.lat0) * M_PER_DEG)

    def ll(self, v):
        return [self.lng0 + v[0] / self.kx, self.lat0 + v[1] / M_PER_DEG]


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1])


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1]


def norm(a):
    n = math.hypot(*a) or 1.0
    return (a[0] / n, a[1] / n)


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def seg_dist(p, a, b):
    ab = sub(b, a)
    t = max(0.0, min(1.0, dot(sub(p, a), ab) / (dot(ab, ab) or 1.0)))
    q = (a[0] + ab[0] * t, a[1] + ab[1] * t)
    return math.hypot(*sub(p, q))


def house_id(h):
    c = centroid(h["ring"] if h.get("ring") else h["front"])
    return f"h{abs(c[0]) * 1e5:.0f}_{abs(c[1]) * 1e5:.0f}"


# ---------------------------------------------------------------- photos


def _rat(v):
    try:
        return float(v)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def exif_pose(path):
    """(lng, lat, heading degrees clockwise from north or None, time) or None."""
    try:
        im = Image.open(path)
        ex = im.getexif()
    except Exception:
        return None
    gps = ex.get_ifd(0x8825)
    if not gps or 2 not in gps or 4 not in gps:
        return None

    def deg(v, ref):
        d, m, s = (_rat(x) or 0.0 for x in v)
        val = d + m / 60 + s / 3600
        return -val if ref in ("S", "W") else val

    lat = deg(gps[2], gps.get(1, "N"))
    lng = deg(gps[4], gps.get(3, "E"))
    heading = _rat(gps.get(17))  # GPSImgDirection
    when = ex.get_ifd(0x8769).get(36867) or ex.get(306)
    return lng, lat, heading, when


def match(args):
    houses = json.load(open(args.houses))
    houses = [h for h in houses if h.get("ring")]
    if not houses:
        sys.exit("houses.json has no outlines: rebuild the track (builds now write each house's ring)")
    photos = sorted(p for p in Path(args.photos).rglob("*") if p.suffix.lower() in EXTS)
    if not photos:
        sys.exit(f"no photos in {args.photos}")
    f = Frame(*houses[0]["ring"][0])
    geo = []
    for h in houses:
        ring = [f.xy(p) for p in h["ring"]]
        a, b = f.xy(h["front"][0]), f.xy(h["front"][1])
        geo.append((ring, a, b, centroid(ring)))

    walk_dir = Path(args.out)
    walk_dir.mkdir(parents=True, exist_ok=True)
    out = {"houses": {}, "unmatched": []}
    for p in photos:
        pose = exif_pose(p)
        if not pose:
            out["unmatched"].append({"photo": str(p), "why": "no GPS in the photo"})
            continue
        lng, lat, heading, when = pose
        me = f.xy((lng, lat))
        look = None
        if heading is not None:
            r = math.radians(heading)
            look = (math.sin(r), math.cos(r))
        cands = []  # (score, index, house's to-road direction)
        for i, (ring, a, b, c) in enumerate(geo):
            d = seg_dist(me, a, b)
            fm = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            to_road = norm(sub(fm, c))
            if d > args.max_dist or dot(sub(me, fm), to_road) <= 0:
                continue  # too far, or standing behind the front
            score = d
            if look:
                ang = math.degrees(math.acos(max(-1, min(1, dot(norm(sub(c, me)), look)))))
                if ang > args.cone:
                    continue
                score += ang * 0.4  # 10 degrees off-centre counts like 4 m further away
            cands.append((score, i, to_road))
        cands.sort()
        best, guessed = (cands[0][1] if cands else None), False
        if cands and not look:
            # No compass heading: the walk photographs the far side of the street, so skip the
            # house behind the photographer when there's one facing it across the road.
            across = [cnd for cnd in cands if dot(cnd[2], cands[0][2]) < -0.5]
            if across:
                best = across[0][1]
            guessed = True
        if best is None:
            out["unmatched"].append({"photo": str(p), "why": "no house front in view within %g m" % args.max_dist,
                                     "at": [lng, lat], "heading": heading})
            continue
        h = houses[best]
        hid = house_id(h)
        e = out["houses"].setdefault(hid, {"house": h, "photos": []})
        e["photos"].append({"photo": str(p), "at": [lng, lat], "heading": heading, "time": when,
                            "distance": round(seg_dist(me, geo[best][1], geo[best][2]), 1),
                            **({"noHeading": True} if guessed else {})})
    (walk_dir / "walk.json").write_text(json.dumps(out, indent=1))
    n = sum(len(e["photos"]) for e in out["houses"].values())
    print(f"{n} photos matched to {len(out['houses'])} houses, {len(out['unmatched'])} unmatched -> {walk_dir / 'walk.json'}")
    for u in out["unmatched"][:10]:
        print(f"  unmatched: {Path(u['photo']).name}: {u['why']}")


# ---------------------------------------------------------------- draft specs

WALLS = [  # facade name piece -> wall kind
    ("brick", "brick"), ("wb", "weatherboard"), ("weather", "weatherboard"), ("fibro", "fibro"),
    ("clad", "cladding"), ("timber", "cladding"), ("render", "render"),
]
COLOURS = {
    "white": "#e8e6df", "cream": "#e6dcc3", "blue": "#7f93a3", "grey": "#8a8d8f", "gray": "#8a8d8f",
    "green": "#7d8b74", "sage": "#a3ad94", "mint": "#b9d3c0", "pink": "#dcb8b0", "yellow": "#e3d08f",
    "red": "#9a4a3c", "terracotta": "#b5694a", "tan": "#c2a67d", "sand": "#d6c4a0", "brown": "#7a5a43",
    "charcoal": "#45474a", "dark": "#4a3a33", "black": "#2b2b2b", "timber": "#9a7550",
}


def draft_spec(h):
    """One block the size of the house's outline, x left to right from the street, y back from the front."""
    f = Frame(*h["ring"][0])
    ring = [f.xy(p) for p in h["ring"]]
    a, b = f.xy(h["front"][0]), f.xy(h["front"][1])
    c = centroid(ring)
    fm = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    to_road = norm(sub(fm, c))  # from the house towards its street
    facing = (-to_road[0], -to_road[1])  # looking at the house from the street
    right = (facing[1], -facing[0])
    xs = [dot(sub(p, c), right) for p in ring]
    ys = [dot(sub(p, c), facing) for p in ring]
    x0, y0 = min(xs), min(ys)
    w, d = max(xs) - x0, max(ys) - y0
    name = h.get("facade", "")
    kind = next((k for key, k in WALLS if key in name), "render")
    colour = next((v for key, v in COLOURS.items() if key in name), "#d9d2c3")
    r = lambda v: round(v, 1)
    roof = h.get("roof") if h.get("roof") in ("hip", "gable") else "hip"
    rgb = h.get("roofRgb")
    roof_hex = "#%02x%02x%02x" % tuple(rgb) if rgb else "#55585b"  # from the aerial photo when the build found it
    return {
        "at": [round(v, 7) for v in f.ll(c)],
        "walls": {"kind": kind, "colour": colour},
        "roof": {"type": roof, "pitch": round(h.get("pitch") or 22), "colour": roof_hex},
        "wallHeight": 2.7,
        "blocks": [{"name": "main", "x0": 0, "x1": r(w), "y0": 0, "y1": r(d), "roof": roof}],
        "doors": [{"type": "front", "x0": r(w / 2 - 0.45), "x1": r(w / 2 + 0.45), "y": -0.04}],
        "windows": [],
        "guesses": ["walls", "roof", "wallHeight", "blocks (one box from the outline)", "doors", "windows"],
        "source": {"facade": name, "outline": h.get("source")},
    }


def draft(args):
    walk_dir = Path(args.walk)
    walk = json.load(open(walk_dir / "walk.json"))
    specs = walk_dir / "specs"
    specs.mkdir(exist_ok=True)
    made = kept = 0
    for hid, e in walk["houses"].items():
        p = specs / f"{hid}.json"
        if p.exists() and not args.force:
            kept += 1
            continue
        spec = draft_spec(e["house"])
        spec["photos"] = [ph["photo"] for ph in e["photos"]]
        p.write_text(json.dumps(spec, indent=1))
        made += 1
    print(f"{made} draft specs written, {kept} existing kept -> {specs}")


# ---------------------------------------------------------------- renders


def render(args):
    walk_dir = Path(args.walk)
    specs = sorted((walk_dir / "specs").glob("*.json"))
    house_py = ROOT / "scripts/blender/house.py"
    exe = args.blender or shutil.which("blender")
    for p in specs:
        spec = json.load(open(p))
        if spec.get("optOut"):
            continue
        png = p.with_suffix(".street.png")
        if png.exists() and png.stat().st_mtime > p.stat().st_mtime and not args.force:
            continue
        common = ["--spec", str(p), "--out", str(png), "--samples", str(args.samples), "--res", args.res, "--view", "street"]
        if exe:
            cmd = [exe, "--background", "--python", str(house_py), "--"] + common + (["--cpu"] if args.cpu else [])
        else:  # bpy from pip
            cmd = [sys.executable, str(house_py), "--"] + common + ["--cpu"]
        print("render", p.stem)
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode or not png.exists():
            print(r.stdout[-800:], r.stderr[-800:])


# ---------------------------------------------------------------- review page


def thumb(path, size):
    try:
        im = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    except Exception:
        return None
    im.thumbnail((size, size))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=78)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def plan_svg(spec):
    """Top-down plan: street at the bottom, x left to right as seen from the street."""
    items = []
    for b in spec.get("blocks", []):
        items.append(("block", b["x0"], b["y0"], b["x1"], b["y1"], b.get("name", ""), b.get("outbuilding")))
    for v in spec.get("verandahs", []):
        items.append(("verandah", v["x0"], v["y0"], v["x1"], v["y1"], "", False))
    if not items:
        return ""
    xs = [i[1] for i in items] + [i[3] for i in items]
    ys = [i[2] for i in items] + [i[4] for i in items]
    pad = 2
    x0, x1, y0, y1 = min(xs) - pad, max(xs) + pad, min(ys) - pad, max(ys) + pad
    s = 300 / max(x1 - x0, y1 - y0)
    W, H = (x1 - x0) * s, (y1 - y0) * s
    X = lambda x: (x - x0) * s
    Y = lambda y: H - (y - y0) * s  # front (small y) at the bottom
    out = [f'<svg viewBox="0 0 {W:.0f} {H + 18:.0f}" class="plan" role="img" aria-label="Plan of the draft spec">']
    for kind, a, b, c, d, name, outb in items:
        cls = "verandah" if kind == "verandah" else ("outb" if outb else "block")
        out.append(f'<rect class="{cls}" x="{X(a):.1f}" y="{Y(d):.1f}" width="{(c - a) * s:.1f}" height="{(d - b) * s:.1f}"/>')
        if name:
            out.append(f'<text x="{X((a + c) / 2):.1f}" y="{Y((b + d) / 2):.1f}">{name} {c - a:.1f}×{d - b:.1f} m</text>')
    for dr in spec.get("doors", []):
        out.append(f'<line class="door {dr["type"]}" x1="{X(dr["x0"]):.1f}" x2="{X(dr["x1"]):.1f}" y1="{Y(dr["y"]):.1f}" y2="{Y(dr["y"]):.1f}"/>')
    out.append(f'<text class="street" x="{W / 2:.0f}" y="{H + 14:.0f}">street</text></svg>')
    return "".join(out)


def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def review(args):
    walk_dir = Path(args.walk)
    walk = json.load(open(walk_dir / "walk.json"))
    cards = []
    for hid, e in walk["houses"].items():
        sp = walk_dir / "specs" / f"{hid}.json"
        spec = json.load(open(sp)) if sp.exists() else draft_spec(e["house"])
        photos = "".join(f'<img src="{t}" alt="Photo {i + 1}">' for i, ph in enumerate(e["photos"][:4])
                         if (t := thumb(ph["photo"], 900)))
        rp = sp.with_suffix(".street.png")
        rend = f'<img src="{thumb(rp, 900)}" alt="Render of the draft">' if rp.exists() else '<p class="none">No render yet</p>'
        g = spec.get("guesses") or []
        guesses = f'<p class="guess">Still guessed: {esc(", ".join(g))}</p>' if g else ""
        if any(ph.get("noHeading") for ph in e["photos"]):
            guesses += '<p class="guess">Matched without a compass heading: check it\'s the right house.</p>'
        cards.append(f'''<section class="card" data-id="{hid}">
<h2>{hid} <span>{len(e["photos"])} photo{"s" if len(e["photos"]) != 1 else ""}</span></h2>
<div class="row"><div class="photos">{photos}</div><div class="model">{rend}{plan_svg(spec)}{guesses}</div></div>
<div class="verdict">
<label><input type="radio" name="v_{hid}" value="right"> Looks right</label>
<label><input type="radio" name="v_{hid}" value="fix"> Needs fixing</label>
<label><input type="radio" name="v_{hid}" value="out"> Leave out (owner said no)</label>
</div>
<textarea placeholder="What's wrong? e.g. garage is on the left, roof is red" aria-label="Notes for {hid}"></textarea>
</section>''')
    n_un = len(walk.get("unmatched", []))
    html = f'''<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>House Review</title>
<style>
:root{{--bg:#f6f5f2;--card:#fff;--ink:#1d1d1b;--muted:#6b6a66;--line:#dddbd5;--accent:#2f6f5e;--warn:#9a5b14}}
@media (prefers-color-scheme:dark){{:root:not([data-theme="light"]){{--bg:#161615;--card:#21211f;--ink:#ecebe7;--muted:#a3a29c;--line:#3a3936;--accent:#6fc2a8;--warn:#e0a35a}}}}
body{{background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,sans-serif;margin:0;padding:16px}}
main{{max-width:1100px;margin:auto}} h1{{font-size:22px;margin:0 0 4px}} .sub{{color:var(--muted);margin:0 0 16px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:0 0 16px}}
.card h2{{font-size:16px;margin:0 0 10px}} .card h2 span{{color:var(--muted);font-weight:400}}
.row{{display:grid;grid-template-columns:1fr 1fr;gap:12px}} @media(max-width:700px){{.row{{grid-template-columns:1fr}}}}
.photos img,.model img{{width:100%;border-radius:6px;display:block;margin-bottom:8px}}
.plan{{width:100%;max-height:260px}} .plan .block{{fill:color-mix(in srgb,var(--accent) 18%,transparent);stroke:var(--accent)}}
.plan .outb{{fill:none;stroke:var(--muted);stroke-dasharray:4 3}} .plan .verandah{{fill:none;stroke:var(--warn);stroke-dasharray:2 2}}
.plan text{{font-size:10px;fill:var(--ink);text-anchor:middle}} .plan .street{{fill:var(--muted)}}
.plan .door{{stroke:var(--warn);stroke-width:3}} .guess{{color:var(--warn);font-size:13px}} .none{{color:var(--muted)}}
.verdict{{display:flex;flex-wrap:wrap;gap:14px;margin:10px 0 6px}}
textarea{{width:100%;box-sizing:border-box;min-height:52px;background:var(--bg);color:var(--ink);border:1px solid var(--line);border-radius:6px;padding:8px;font:inherit}}
.bar{{position:sticky;bottom:0;background:var(--bg);padding:10px 0;display:flex;gap:10px;align-items:center}}
button{{background:var(--accent);color:var(--bg);border:0;border-radius:6px;padding:9px 14px;font:inherit;cursor:pointer}}
#status{{color:var(--muted)}}
</style></head><body><main>
<h1>House review</h1>
<p class="sub">{len(cards)} houses from the photo walk{f", {n_un} photo{'s' if n_un != 1 else ''} not matched to a house" if n_un else ""}. Private: don't share this page.</p>
{"".join(cards)}
<div class="bar"><button id="copy">Copy notes for Claude</button><span id="status"></span></div>
</main><script>
const KEY = "house-review";
let saved = {{}};
try {{ saved = JSON.parse(localStorage.getItem(KEY) || "{{}}"); }} catch (e) {{}}
const cards = [...document.querySelectorAll(".card")];
for (const c of cards) {{
  const s = saved[c.dataset.id] || {{}};
  if (s.v) {{ const r = c.querySelector(`input[value="${{s.v}}"]`); if (r) r.checked = true; }}
  c.querySelector("textarea").value = s.n || "";
}}
function collect() {{
  const out = {{}};
  for (const c of cards) {{
    const v = c.querySelector("input:checked")?.value || "", n = c.querySelector("textarea").value.trim();
    if (v || n) out[c.dataset.id] = {{ v, n }};
  }}
  return out;
}}
document.addEventListener("input", () => {{ try {{ localStorage.setItem(KEY, JSON.stringify(collect())); }} catch (e) {{}} }});
document.getElementById("copy").onclick = async () => {{
  const o = collect(), words = {{ right: "looks right", fix: "needs fixing", out: "leave out" }};
  const text = "House review:\\n" + Object.entries(o).map(([k, s]) => `${{k}}: ${{words[s.v] || "-"}}${{s.n ? " - " + s.n : ""}}`).join("\\n");
  try {{ await navigator.clipboard.writeText(text); document.getElementById("status").textContent = "Copied " + Object.keys(o).length + " houses."; }}
  catch (e) {{ prompt("Copy this:", text); }}
}};
</script></body></html>'''
    out = walk_dir / "review.html"
    out.write_text(html)
    print(f"{len(cards)} houses -> {out}")


# ---------------------------------------------------------------- looks


def looks(args):
    walk_dir = Path(args.walk)
    out = []
    for p in sorted((walk_dir / "specs").glob("*.json")):
        spec = json.load(open(p))
        if spec.get("optOut"):
            out.append({"at": spec["at"], "facade": "render_white", "front": "none", "trees": 0, "note": "owner asked to be left out"})
            continue
        rel = os.path.relpath(p, ROOT) if p.resolve().is_relative_to(ROOT) else str(p.resolve())
        out.append({"at": spec["at"], "specFile": rel})
    Path(args.out).write_text(json.dumps({"houses": out}, indent=1))
    print(f"{len(out)} house looks -> {args.out}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    m = sp.add_parser("match")
    m.add_argument("houses")
    m.add_argument("photos")
    m.add_argument("--out", required=True)
    m.add_argument("--max-dist", type=float, default=45, help="furthest a photo can be from the house front (m)")
    m.add_argument("--cone", type=float, default=35, help="how far off the camera heading the house can be (degrees)")
    m.set_defaults(fn=match)
    d = sp.add_parser("draft")
    d.add_argument("walk")
    d.add_argument("--force", action="store_true")
    d.set_defaults(fn=draft)
    r = sp.add_parser("render")
    r.add_argument("walk")
    r.add_argument("--blender")
    r.add_argument("--samples", type=int, default=32)
    r.add_argument("--res", default="960x540")
    r.add_argument("--cpu", action="store_true")
    r.add_argument("--force", action="store_true")
    r.set_defaults(fn=render)
    v = sp.add_parser("review")
    v.add_argument("walk")
    v.set_defaults(fn=review)
    lk = sp.add_parser("looks")
    lk.add_argument("walk")
    lk.add_argument("--out", required=True)
    lk.set_defaults(fn=looks)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
