"""Read a workstation test run (scripts/windows/run-test.ps1) and say where the AI left the road.

    python3 -I scripts/check/autotest_report.py <results.zip or folder> out/<slug>.surface.json [--layout <id>]

On a map with several layouts, the run's layout comes from race.ini.used in the results (or --layout),
and the car is measured against that layout's AI line.

Uses btest.csv (the track script's drive log): prints how the run ended, each off-road and
stuck event with its distance round the lap and how far the car was from the AI line, and writes
<results>.autotest.png: the AI line in grey, the car's path in blue, off-road in red.
"""

import csv
import io
import json
import os
import sys
import zipfile

import numpy as np
from PIL import Image, ImageDraw


def read_csv(path):
    if path.endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            name = next(n for n in z.namelist() if n.endswith("btest.csv"))
            text = z.read(name).decode("utf-8", "replace")
    else:
        text = open(os.path.join(path, "btest.csv"), encoding="utf-8", errors="replace").read()
    rows = []
    for r in csv.DictReader(io.StringIO(text.lstrip("﻿"))):
        try:
            rows.append({
                "kind": r["kind"], "t": float(r["time"]), "spline": float(r["spline"]),
                "x": float(r["x"]), "z": float(r["z"]), "kmh": float(r["kmh"]),
                "wheels": int(r["wheels_on_road"]), "ai": r["ai"] == "1", "note": r.get("note") or "",
            })
        except (ValueError, KeyError, TypeError):
            continue
    return rows


def run_layout(path):
    """CONFIG_TRACK from the race.ini the run used, or None."""
    try:
        if path.endswith(".zip"):
            with zipfile.ZipFile(path) as z:
                name = next((n for n in z.namelist() if n.endswith("race.ini.used")), None)
                text = z.read(name).decode("utf-8", "replace") if name else ""
        else:
            f = os.path.join(path, "race.ini.used")
            text = open(f, encoding="utf-8", errors="replace").read() if os.path.exists(f) else ""
    except (OSError, zipfile.BadZipFile):
        return None
    section = None
    for line in text.splitlines():
        line = line.strip().lstrip("\ufeff")
        if line.startswith("["):
            section = line.strip("[]").upper()
        elif section == "RACE" and line.upper().startswith("CONFIG_TRACK"):
            v = line.split("=", 1)[1].strip()
            return v or None
    return None


def main():
    args = [a for a in sys.argv[1:]]
    layout = None
    if "--layout" in args:
        i = args.index("--layout")
        layout = args[i + 1]
        del args[i:i + 2]
    src, surf = args[0], args[1]
    rows = read_csv(src)
    if not rows:
        sys.exit("btest.csv is empty: the test script didn't run. Check logs/custom_shaders_patch.log for autotest.lua.")
    data = json.load(open(surf))
    layout = layout or run_layout(src)
    lines = data.get("layouts") or {}
    if layout and layout in lines:
        ai = lines[layout]
        print(f"layout: {layout}")
    else:
        if layout and lines:
            print(f"layout {layout} has no AI line of its own in {surf}: using the main one")
        elif lines:
            print("layout unknown (no race.ini.used, no --layout): using the main AI line")
        ai = data["ai"]
    P = np.array([[a["position"][0], a["position"][2]] for a in ai])
    D = np.array([a["distance"] for a in ai])
    length = D[-1] + np.linalg.norm(P[0] - P[-1])

    def where(x, z):
        d = np.hypot(P[:, 0] - x, P[:, 1] - z)
        i = int(d.argmin())
        return D[i], d[i]

    start = next((r for r in rows if r["kind"] == "start"), None)
    fin = next((r for r in rows if r["kind"] == "finish"), None)
    pos = [r for r in rows if r["kind"] == "pos"]
    print(f"start: {start['note'] if start else 'no start line'}")
    print(f"finish: {fin['note'] + ' at %.0f s' % fin['t'] if fin else 'none (timed out or AC closed)'}")
    if pos:
        print(f"AI in control: {sum(r['ai'] for r in pos) / len(pos):.0%} of samples; top speed {max(r['kmh'] for r in pos):.0f} km/h")
        s, off = zip(*(where(r["x"], r["z"]) for r in pos))
        print(f"distance from the AI line: median {np.median(off):.1f} m, 95% {np.percentile(off, 95):.1f} m, max {max(off):.1f} m")
        far = [(r, a, b) for r, a, b in zip(pos, s, off) if b > 4]
        if far:
            r, a, b = far[0]
            print(f"first more than 4 m off the line: {r['t']:.1f} s, {a:.0f} m round the lap ({b:.1f} m off, {r['kmh']:.0f} km/h)")
    fps = [r for r in rows if r["kind"] == "fps"]
    whole = next((r for r in rows if r["kind"] == "fpsall"), None)
    if fps or whole:
        avgs = [float(r["note"].split()[1].rstrip(";")) for r in fps]
        low = min(fps, key=lambda r: float(r["note"].split()[1].rstrip(";"))) if fps else None
        print(f"frame rate: {whole['note'] if whole else 'no total'}"
              + (f"; worst 5 s {min(avgs):.0f} fps at {where(low['x'], low['z'])[0]:.0f} m round" if low else ""))
    for r in rows:
        if r["kind"] in ("offroad", "finish") and r["note"] != "lap":
            a, b = where(r["x"], r["z"])
            print(f"  {r['kind']:8s} {r['t']:6.1f} s  {a:5.0f} m of {length:.0f} m  {b:4.1f} m off the line  {r['kmh']:5.1f} km/h  wheels on road {r['wheels']}")

    # Map.
    allx = np.concatenate([P[:, 0], [r["x"] for r in pos]]) if pos else P[:, 0]
    allz = np.concatenate([P[:, 1], [r["z"] for r in pos]]) if pos else P[:, 1]
    x0, x1, z0, z1 = allx.min() - 20, allx.max() + 20, allz.min() - 20, allz.max() + 20
    scale = 1600 / max(x1 - x0, z1 - z0)
    img = Image.new("RGB", (int((x1 - x0) * scale), int((z1 - z0) * scale)), "white")
    d = ImageDraw.Draw(img)
    f = lambda x, z: ((x - x0) * scale, (z - z0) * scale)
    d.line([f(*p) for p in P], fill=(170, 170, 170), width=6)
    if pos:
        d.line([f(r["x"], r["z"]) for r in pos], fill=(30, 90, 220), width=2)
    for r in rows:
        if r["kind"] in ("offroad", "finish"):
            x, z = f(r["x"], r["z"])
            col = (220, 0, 0) if r["kind"] == "offroad" else (0, 150, 0)
            d.ellipse([x - 7, z - 7, x + 7, z + 7], outline=col, width=3)
    out = (src[:-4] if src.endswith(".zip") else src.rstrip("/\\")) + ".autotest.png"
    img.save(out)
    print(f"map: {out}")


if __name__ == "__main__":
    main()
