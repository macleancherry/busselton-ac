"""A lineup sheet of local-cars models: each rendered on its own by render_vehicles.py (Blender's
bpy), then laid out in a grid with labels and triangle counts.

    python3 scripts/cars/lineup.py --dir <export dir> --out <png> --view front34|side|rear34
        [--cars ute_lod0,hatch_lod0,...] [--cols 4] [--cell 480x300] [--samples 16]

Without --cars: every body's plain LOD 0 from the export (<body>_lod0.json) and today's boxy car.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ORDER = ["ute", "trayute", "wagon4wd", "suv", "suvsmall", "hatch", "sedan", "passute", "van", "stationwagon"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dir", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--view", default="front34")
    p.add_argument("--cars", default="")
    p.add_argument("--cols", type=int, default=4)
    p.add_argument("--cell", default="480x300")
    p.add_argument("--samples", type=int, default=16)
    p.add_argument("--zoom", type=float, default=0, help="lens scale; default 1.3, side 1.0 (the long bodies fit)")
    a = p.parse_args()
    a.zoom = a.zoom or (1.0 if a.view == "side" else 1.3)
    cars = [c for c in a.cars.split(",") if c] or [f"{b}_lod0" for b in ORDER if os.path.exists(os.path.join(a.dir, f"{b}_lod0.json"))] + ["boxy_car"]
    cw, ch = (int(v) for v in a.cell.split("x"))
    rows = (len(cars) + a.cols - 1) // a.cols
    sheet = Image.new("RGB", (cw * a.cols, ch * rows), (40, 40, 40))
    draw = ImageDraw.Draw(sheet)
    with tempfile.TemporaryDirectory() as tmp:
        for i, name in enumerate(cars):
            png = os.path.join(tmp, f"{name}.png")
            subprocess.run([sys.executable, os.path.join(HERE, "render_vehicles.py"), "--", "--dir", a.dir, "--out", png, "--cars", name,
                            "--view", a.view, "--samples", str(a.samples), "--res", f"{cw * 2}x{ch * 2}", "--zoom", str(a.zoom)],
                           check=True, stdout=subprocess.DEVNULL)
            im = Image.open(png).convert("RGB").resize((cw, ch), Image.LANCZOS)
            x, y = (i % a.cols) * cw, (i // a.cols) * ch
            sheet.paste(im, (x, y))
            tris = json.load(open(os.path.join(a.dir, name + ".json")))["tris"]
            draw.rectangle([x, y, x + cw, y + 22], fill=(0, 0, 0))
            draw.text((x + 8, y + 5), f"{name}  {tris} tris", fill=(255, 255, 255))
            print(name, tris, flush=True)
    sheet.save(a.out)
    print("wrote", a.out)


main()
