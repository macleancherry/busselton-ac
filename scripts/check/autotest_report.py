"""Read a workstation test run (scripts/windows/run-test.ps1) and say where the AI left the road.

    python3 -I scripts/check/autotest_report.py <results.zip or folder> out/<slug>.surface.json [--layout <id>]
        [--night] [--dark <0-255>]

On a map with several layouts, the run's layout comes from race.ini.used in the results (or --layout),
and the car is measured against that layout's AI line.

Uses btest.csv (the track script's drive log): prints how the run ended, each off-road and
stuck event with its distance round the lap and how far the car was from the AI line, and writes
<results>.autotest.png: the AI line in grey, the car's path in blue, off-road in red.

Night runs (run-test.ps1 -Night, or --night): checks the game really ran at night (the track
script's "env" line), measures how bright the road ahead is in each screenshot and lists the dark
stretches: shots darker than --dark (default 22, mean grey of the road ahead) or under half the
run's median brightness.

Runs with AI opponents (run-test.ps1 -Cars N): a line per car (off-road events, stops, contacts,
lap done, distance from the AI line) and the incidents: contacts and stops close together in time
and place, a pile-up when three or more cars are in it, with the roundabout it's at (from the
build's 1ROAD_RB meshes in the surface file).
"""

import csv
import io
import json
import os
import re
import sys
import zipfile

import numpy as np
from PIL import Image, ImageDraw

DARK = 22          # mean grey (0-255) of the road ahead below which a night shot is dark
RELATIVE = 0.5     # or below this share of the run's median brightness
CLUSTER_S = 15     # incident: events within this many seconds...
CLUSTER_M = 30     # ...and metres of each other
RB_MARGIN = 20     # an incident this far outside a roundabout's ring is still "at" it


# ---------- reading the results ----------

def read_text(src, name):
    """A text file from the results (zip or folder), by name at any depth, or None."""
    try:
        if src.endswith(".zip"):
            with zipfile.ZipFile(src) as z:
                n = next((n for n in z.namelist() if n == name or n.endswith("/" + name)), None)
                return z.read(n).decode("utf-8", "replace") if n else None
        f = os.path.join(src, name)
        if not os.path.exists(f):
            return None
        with open(f, encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except (OSError, zipfile.BadZipFile):
        return None


def parse_note(note):
    """"car=2;with=0" -> {"car": "2", "with": "0"}; free text has no keys."""
    out = {}
    for part in note.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def parse_rows(text):
    rows = []
    for r in csv.DictReader(io.StringIO(text.lstrip("﻿"))):
        try:
            note = r.get("note") or ""
            kv = parse_note(note)
            rows.append({
                "kind": r["kind"], "t": float(r["time"]), "spline": float(r["spline"]),
                "x": float(r["x"]), "z": float(r["z"]), "kmh": float(r["kmh"]),
                "wheels": int(r["wheels_on_road"]), "ai": r["ai"] == "1", "note": note,
                "car": int(kv["car"]) if kv.get("car", "").isdigit() else 0, "kv": kv,
            })
        except (ValueError, KeyError, TypeError):
            continue
    return rows


def read_csv(path):
    text = read_text(path, "btest.csv")
    return parse_rows(text) if text else []


def parse_ini(text):
    out, section = {}, None
    for line in (text or "").splitlines():
        line = line.strip().lstrip("﻿")
        if line.startswith("["):
            section = line.strip("[]").upper()
            out.setdefault(section, {})
        elif section and "=" in line and not line.startswith(";"):
            k, v = line.split("=", 1)
            out[section][k.strip().upper()] = v.strip()
    return out


def run_layout(path):
    """CONFIG_TRACK from the race.ini the run used, or None."""
    v = parse_ini(read_text(path, "race.ini.used")).get("RACE", {}).get("CONFIG_TRACK", "")
    return v or None


def hours_of_angle(angle):
    """Content Manager's sun angle (16 degrees an hour from 13:00) as hours of the day, 0..24."""
    return (13 + angle / 16) % 24


def is_night_hour(h):
    return h >= 19.5 or h < 5.5


def run_info(src):
    """What the run was asked to do: run.json (run-test.ps1 writes it), else race.ini.used."""
    info = {"night": False, "time": None, "cars": 0}
    try:
        j = json.loads(read_text(src, "run.json") or "null")
    except ValueError:
        j = None
    if isinstance(j, dict):
        info["night"] = bool(j.get("night"))
        info["time"] = j.get("time") or None
        info["cars"] = int(j.get("cars") or 0)
        return info
    ini = parse_ini(read_text(src, "race.ini.used"))
    light = ini.get("LIGHTING", {})
    angle = light.get("__CM_UNCLAMPED_SUN_ANGLE") or light.get("SUN_ANGLE")
    try:
        h = hours_of_angle(float(angle))
        info["time"] = "%02d:%02d" % (int(h), round((h % 1) * 60) % 60)
        info["night"] = is_night_hour(h)
    except (TypeError, ValueError):
        pass
    try:
        info["cars"] = max(0, int(ini.get("RACE", {}).get("CARS", "1")) - 1)
    except ValueError:
        pass
    return info


def env_hours(rows):
    """Hours of the day the game reported (the track script's env line), or None."""
    env = next((r for r in rows if r["kind"] == "env"), None)
    m = re.match(r"^(\d{1,2}):(\d{2})$", (env or {}).get("kv", {}).get("time", ""))
    return int(m.group(1)) + int(m.group(2)) / 60 if m else None


# ---------- screenshots (night runs) ----------

def _secs(hms):
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def read_screens(src):
    """The run's screenshots in the order they were taken: [(name, bytes, seconds of day or None)]."""
    files = {}
    stamps = {}
    if src.endswith(".zip"):
        with zipfile.ZipFile(src) as z:
            for info in z.infolist():
                parts = info.filename.replace("\\", "/").split("/")
                if len(parts) >= 2 and parts[-2] == "screens" and parts[-1]:
                    files[parts[-1]] = z.read(info)
                    stamps[parts[-1]] = info.date_time
    else:
        d = os.path.join(src, "screens")
        if os.path.isdir(d):
            for n in os.listdir(d):
                with open(os.path.join(d, n), "rb") as fh:
                    files[n] = fh.read()
                stamps[n] = os.path.getmtime(os.path.join(d, n))
    order = []
    for line in (read_text(src, "screens.txt") or "").splitlines():
        name, _, when = line.strip().partition(",")
        if name in files:
            try:
                order.append((name, _secs(when)))
            except ValueError:
                order.append((name, None))
    seen = {n for n, _ in order}
    rest = sorted((n for n in files if n not in seen), key=lambda n: (stamps[n], n))
    order += [(n, None) for n in rest]
    return [(n, files[n], s) for n, s in order]


def read_presses(src):
    """run-test.ps1's F8 presses from clicks.txt: {shot number: seconds of day}."""
    out = {}
    for line in (read_text(src, "clicks.txt") or "").splitlines():
        m = re.match(r"^(\d{2}:\d{2}:\d{2}) pressed F8 \(shot (\d+)\)", line.strip())
        if m:
            out[int(m.group(2))] = _secs(m.group(1))
    return out


def pair_shots(shots, screens, presses):
    """Match screenshots to the track script's shot lines: [(shot row, name, bytes)].

    By time when both clicks.txt and screens.txt have it (each screenshot goes with the last F8
    press before it), otherwise in order."""
    pairs = []
    if presses and all(s is not None for _, _, s in screens):
        used = set()
        for name, data, s in screens:
            best = max((n for n, p in presses.items() if p <= s + 0.5 and n not in used), key=lambda n: presses[n], default=None)
            if best is not None and best - 1 < len(shots) and s - presses[best] < 10:
                used.add(best)
                pairs.append((shots[best - 1], name, data))
        return pairs
    return [(sh, name, data) for sh, (name, data, _) in zip(shots, screens)]


def road_brightness(data):
    """Mean grey of the road ahead: the middle of the picture, below the horizon, above the bonnet."""
    img = Image.open(io.BytesIO(data)).convert("L")
    w, h = img.size
    crop = img.crop((int(w * 0.2), int(h * 0.45), int(w * 0.8), int(h * 0.8)))
    return float(np.asarray(crop, dtype=np.float32).mean())


def dark_stretches(samples, dark=DARK, relative=RELATIVE):
    """samples: [(shot row, brightness)] in the order taken. Runs of dark shots: [[(row, b), ...]]."""
    if not samples:
        return [], 0.0
    med = float(np.median([b for _, b in samples]))
    limit = max(dark, med * relative) if med > dark else dark
    out, cur = [], []
    for row, b in samples:
        if b < limit:
            cur.append((row, b))
        elif cur:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out, med


# ---------- several cars ----------

def roundabouts(surface):
    """Roundabout rings from the build's 1ROAD_RB<k> meshes: [(x, z, radius)]."""
    out = []
    for m in surface.get("meshes", []):
        if re.match(r"^1ROAD_RB\d+$", m.get("name", "")):
            p = np.array(m["p"], dtype=float).reshape(-1, 3)
            if len(p):
                cx, cz = p[:, 0].mean(), p[:, 2].mean()
                out.append((float(cx), float(cz), float(np.hypot(p[:, 0] - cx, p[:, 2] - cz).max())))
    return out


def contacts(rows):
    """Contact events, one per pair of cars per touch (both cars log it): [(row, (a, b))]."""
    out, last = [], {}
    for r in rows:
        if r["kind"] != "contact" or not r["kv"].get("with", "").isdigit():
            continue
        pair = tuple(sorted((r["car"], int(r["kv"]["with"]))))
        if pair in last and r["t"] - last[pair] < 2.5:
            last[pair] = r["t"]
            continue
        last[pair] = r["t"]
        out.append((r, pair))
    return out


def incidents(rows, rbs=()):
    """Contacts and stops close together: [{"t", "x", "z", "cars", "events", "pileup", "roundabout"}]."""
    events = [(r, set(pair)) for r, pair in contacts(rows)]
    events += [(r, {r["car"]}) for r in rows if r["kind"] == "cstuck"]
    events.sort(key=lambda e: e[0]["t"])
    clusters = []
    for r, cars in events:
        for c in reversed(clusters):
            if r["t"] - c["last"] > CLUSTER_S:
                continue
            cx, cz = np.mean(c["xs"]), np.mean(c["zs"])
            if np.hypot(r["x"] - cx, r["z"] - cz) <= CLUSTER_M:
                c["xs"].append(r["x"]); c["zs"].append(r["z"]); c["cars"] |= cars
                c["last"] = r["t"]; c["events"] += 1
                break
        else:
            clusters.append({"t": r["t"], "last": r["t"], "xs": [r["x"]], "zs": [r["z"]], "cars": set(cars), "events": 1})
    out = []
    for c in clusters:
        x, z = float(np.mean(c["xs"])), float(np.mean(c["zs"]))
        rb = None
        for k, (rx, rz, rr) in enumerate(rbs):
            if np.hypot(x - rx, z - rz) <= rr + RB_MARGIN:
                rb = k
                break
        out.append({"t": c["t"], "x": x, "z": z, "cars": sorted(c["cars"]), "events": c["events"],
                    "pileup": len(c["cars"]) >= 3, "roundabout": rb})
    return out


def car_table(rows):
    """Per car: samples, off-road events, stops, contacts, how its run ended."""
    cars = sorted({r["car"] for r in rows if r["kind"] in ("cpos", "coffroad", "cstuck", "contact", "clap", "cdone")} | {0})
    touch = contacts(rows)
    fin = next((r for r in rows if r["kind"] == "finish"), None)
    pdone = next((r for r in rows if r["kind"] == "playerdone"), None)
    out = []
    for c in cars:
        if c == 0:
            pos = [r for r in rows if r["kind"] == "pos"]
            off = [r for r in rows if r["kind"] == "offroad"]
            end = pdone["note"] if pdone else (fin["note"] if fin else "none")
        else:
            pos = [r for r in rows if r["kind"] == "cpos" and r["car"] == c]
            off = [r for r in rows if r["kind"] == "coffroad" and r["car"] == c]
            lap = next((r for r in rows if r["kind"] == "clap" and r["car"] == c), None)
            done = next((r for r in rows if r["kind"] == "cdone" and r["car"] == c), None)
            end = lap["note"].split(";", 1)[-1] if lap else (
                "not done" if done and done["kv"].get("done") == "no" else "none")
        out.append({
            "car": c, "pos": pos, "off": off,
            "stuck": [r for r in rows if r["kind"] == "cstuck" and r["car"] == c],
            "contacts": [(r, p) for r, p in touch if c in p], "end": end,
        })
    return out


# ---------- the report ----------

def main():
    args = [a for a in sys.argv[1:]]
    layout = None
    dark = DARK
    force_night = False
    if "--layout" in args:
        i = args.index("--layout")
        layout = args[i + 1]
        del args[i:i + 2]
    if "--dark" in args:
        i = args.index("--dark")
        dark = float(args[i + 1])
        del args[i:i + 2]
    if "--night" in args:
        args.remove("--night")
        force_night = True
    src, surf = args[0], args[1]
    rows = read_csv(src)
    if not rows:
        sys.exit("btest.csv is empty: the test script didn't run. Check logs/custom_shaders_patch.log for autotest.lua.")
    with open(surf) as fh:
        data = json.load(fh)
    layout = layout or run_layout(src)
    info = run_info(src)
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

    # Night: was it night, and where is the road ahead dark?
    dark_rows = []
    if info["night"] or force_night:
        print()
        print(f"night run (asked for {info['time'] or 'night'})")
        h = env_hours(rows)
        env = next((r for r in rows if r["kind"] == "env"), None)
        if h is None:
            print("  the game's time of day wasn't logged (no env line): can't tell it was night")
        elif not is_night_hour(h):
            print(f"  WARNING: the game ran at {env['kv']['time']}, not at night. AC stops at 18:00 without CSP's weather FX:"
                  " check CSP is on and its weather FX is enabled.")
        else:
            print(f"  game time {env['kv']['time']}; headlights {env['kv'].get('headlights', '?')}")
        shots = [r for r in rows if r["kind"] == "shot"]
        screens = read_screens(src)
        if not screens:
            print(f"  no screenshots ({len(shots)} shot lines): can't judge dark stretches")
        else:
            pairs = pair_shots(shots, screens, read_presses(src))
            if len(screens) != len(shots):
                print(f"  {len(screens)} screenshots for {len(shots)} shot lines: matched {len(pairs)}")
            samples = []
            for row, name, img in pairs:
                try:
                    samples.append((row, road_brightness(img)))
                except OSError:
                    print(f"  can't read {name}")
            runs, med = dark_stretches(samples, dark)
            print(f"  road ahead: median brightness {med:.0f} of 255 over {len(samples)} shots")
            if not runs:
                print("  no dark stretches")
            for run in runs:
                a = where(run[0][0]["x"], run[0][0]["z"])[0]
                b = where(run[-1][0]["x"], run[-1][0]["z"])[0]
                tags = ", ".join(r["note"].split()[0] for r, _ in run)
                print(f"  dark: {a:.0f} to {b:.0f} m round the lap ({len(run)} shot{'s' if len(run) > 1 else ''}: {tags};"
                      f" brightness {min(v for _, v in run):.0f} to {max(v for _, v in run):.0f})"
                      f" near ({run[0][0]['x']:.0f}, {run[0][0]['z']:.0f})")
                dark_rows += [r for r, _ in run]

    # Several cars: a line per car, and the incidents.
    table = car_table(rows)
    found = []
    rbs = []
    if len(table) > 1 or info["cars"] > 0:
        print()
        rbs = roundabouts(data)
        print(f"cars: {len(table)} (the test car is car 0; asked for {info['cars']} AI opponents)")
        for c in table:
            offs = [where(r["x"], r["z"])[1] for r in c["pos"]]
            line = f"median {np.median(offs):.1f} m, max {max(offs):.1f} m off the line" if offs else "no positions"
            print(f"  car {c['car']}: off road {len(c['off'])}, stopped {len(c['stuck'])}, contacts {len(c['contacts'])},"
                  f" ended: {c['end']}; {line}")
        found = incidents(rows, rbs)
        shown = [f for f in found if len(f["cars"]) >= 2 or f["roundabout"] is not None]
        piles = [f for f in found if f["pileup"]]
        at_rb = [f for f in piles if f["roundabout"] is not None]
        print(f"incidents: {len(shown)}; pile-ups (3 or more cars): {len(piles)}, at roundabouts: {len(at_rb)}"
              + ("" if rbs else " (no roundabouts in the surface file)"))
        for f in shown:
            a = where(f["x"], f["z"])[0]
            what = "PILE-UP" if f["pileup"] else ("contact" if len(f["cars"]) >= 2 else "stop")
            rb = f", roundabout {f['roundabout']}" if f["roundabout"] is not None else ""
            print(f"  {what:8s} {f['t']:6.1f} s  {a:5.0f} m round the lap  at ({f['x']:.0f}, {f['z']:.0f}){rb}"
                  f"  cars {', '.join(map(str, f['cars']))}  ({f['events']} events)")

    # Map.
    others = [r for r in rows if r["kind"] == "cpos"]
    allx = np.concatenate([P[:, 0], [r["x"] for r in pos + others]]) if pos or others else P[:, 0]
    allz = np.concatenate([P[:, 1], [r["z"] for r in pos + others]]) if pos or others else P[:, 1]
    x0, x1, z0, z1 = allx.min() - 20, allx.max() + 20, allz.min() - 20, allz.max() + 20
    scale = 1600 / max(x1 - x0, z1 - z0)
    img = Image.new("RGB", (int((x1 - x0) * scale), int((z1 - z0) * scale)), "white")
    d = ImageDraw.Draw(img)
    f = lambda x, z: ((x - x0) * scale, (z - z0) * scale)
    d.line([f(*p) for p in P], fill=(170, 170, 170), width=6)
    for c in sorted({r["car"] for r in others}):
        path = [f(r["x"], r["z"]) for r in others if r["car"] == c]
        if len(path) > 1:
            d.line(path, fill=(150, 190, 240), width=1)
    if pos:
        d.line([f(r["x"], r["z"]) for r in pos], fill=(30, 90, 220), width=2)
    for r in dark_rows:
        x, z = f(r["x"], r["z"])
        d.rectangle([x - 6, z - 6, x + 6, z + 6], fill=(40, 40, 40))
    for r in rows:
        if r["kind"] in ("offroad", "finish", "coffroad"):
            x, z = f(r["x"], r["z"])
            col = (0, 150, 0) if r["kind"] == "finish" else (220, 0, 0)
            rad = 7 if r["kind"] != "coffroad" else 4
            d.ellipse([x - rad, z - rad, x + rad, z + rad], outline=col, width=3 if rad == 7 else 2)
    for r, _ in contacts(rows):
        x, z = f(r["x"], r["z"])
        d.ellipse([x - 4, z - 4, x + 4, z + 4], fill=(255, 140, 0))
    for inc in found:
        if inc["pileup"]:
            x, z = f(inc["x"], inc["z"])
            d.ellipse([x - 14, z - 14, x + 14, z + 14], outline=(220, 0, 220), width=4)
    out = (src[:-4] if src.endswith(".zip") else src.rstrip("/\\")) + ".autotest.png"
    img.save(out)
    print(f"map: {out}")


if __name__ == "__main__":
    main()
