#!/usr/bin/env python3
"""Before/after renders: compare a build's shots with the last saved set.

    python3 -I scripts/check/render_diff.py <slug>            compare out/<slug>.shot*.png with the saved set
    python3 -I scripts/check/render_diff.py <slug> --save     save the current shots as the set to compare with

Build with the same SHOTS each time (lap fractions or fixed views). The saved set lives in
out/renders/<slug>/ (out/ is gitignored, so private builds stay private). Writes
out/<slug>.compare.png: before on the left, after in the middle, changed pixels in magenta on the right,
one row per shot, and prints how much of each view changed.
"""
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

OUT = Path("out")


def shots(folder: Path, slug: str):
    return sorted(folder.glob(f"{slug}.shot*.png"), key=lambda p: int(p.stem.split("shot")[-1]))


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    slug = sys.argv[1]
    saved = OUT / "renders" / slug
    now = shots(OUT, slug)
    if not now:
        sys.exit(f"no out/{slug}.shot*.png: build with SHOTS=... first")
    if "--save" in sys.argv[2:]:
        saved.mkdir(parents=True, exist_ok=True)
        for old in saved.glob("*.png"):
            old.unlink()
        for p in now:
            shutil.copy(p, saved / p.name)
        print(f"saved {len(now)} shots to {saved}")
        return
    before = {p.name: p for p in shots(saved, slug)}
    if not before:
        sys.exit(f"nothing saved for {slug} yet: run with --save first")
    rows, worst = [], 0.0
    for p in now:
        if p.name not in before:
            print(f"{p.name}: new (nothing to compare with)")
            continue
        a = np.asarray(Image.open(before[p.name]).convert("RGB")).astype(np.int16)
        b = np.asarray(Image.open(p).convert("RGB")).astype(np.int16)
        if a.shape != b.shape:
            print(f"{p.name}: size changed {a.shape[1]}x{a.shape[0]} -> {b.shape[1]}x{b.shape[0]}")
            continue
        changed = np.abs(a - b).max(axis=2) > 24
        share = changed.mean()
        worst = max(worst, share)
        print(f"{p.name}: {share:.1%} of the view changed")
        diff = (b * 0.35).astype(np.uint8)
        diff[changed] = (255, 0, 255)
        rows.append((p.name, a.astype(np.uint8), b.astype(np.uint8), diff))
    if not rows:
        return
    h, w = rows[0][1].shape[:2]
    scale = min(1.0, 600 / w)
    tw, th = int(w * scale), int(h * scale)
    sheet = Image.new("RGB", (tw * 3, (th + 22) * len(rows)), "white")
    d = ImageDraw.Draw(sheet)
    for k, (name, a, b, diff) in enumerate(rows):
        y = k * (th + 22)
        d.text((4, y + 4), f"{name}: before | after | changed", fill=(0, 0, 0))
        for c, img in enumerate((a, b, diff)):
            sheet.paste(Image.fromarray(img).resize((tw, th)), (c * tw, y + 22))
    dest = OUT / f"{slug}.compare.png"
    sheet.save(dest)
    print(f"most changed view: {worst:.1%}; sheet: {dest}")


if __name__ == "__main__":
    main()
