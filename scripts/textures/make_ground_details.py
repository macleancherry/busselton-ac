"""Make the four tiled ground detail textures for the ksMultilayer terrain.

Downloads CC0 textures from ambientCG and makes them colour-neutral: each one
averages mid-grey, so in game the aerial photo supplies the colour (green
lawn, straw verge, white sand) and the detail supplies the close-up texture
(grass blades, sand grains, leaf litter).

    python3 -I scripts/textures/make_ground_details.py

Writes public/textures/ground/{lawn,rough,sand,litter}.jpg (1024 x 1024, seamless).
Textures: ambientCG.com, CC0 1.0.
"""

import io
import os
import urllib.request
import zipfile

import numpy as np
from PIL import Image

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "textures", "ground")
LAYERS = {
    # name: (ambientCG id, how much of its own colour to keep, contrast)
    "lawn": ("Grass004", 0.25, 0.9),     # short dense lawn
    "rough": ("Grass007", 0.25, 1.2),    # tufty verge grass with weeds; dry when the photo is straw
    "sand": ("Ground054", 0.2, 2.0),    # beach and dune sand
    "litter": ("Ground106", 0.3, 0.9),   # dirt and leaves: garden beds, under trees
}


def fetch(asset):
    url = f"https://ambientcg.com/get?file={asset}_1K-JPG.zip"
    req = urllib.request.Request(url, headers={"User-Agent": "busselton-ac texture script"})
    data = urllib.request.urlopen(req, timeout=120).read()
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        name = next(n for n in z.namelist() if n.endswith("_Color.jpg"))
        return Image.open(io.BytesIO(z.read(name))).convert("RGB")


def neutral(img, keep, contrast):
    a = np.asarray(img.resize((1024, 1024), Image.LANCZOS)).astype(np.float64) / 255
    lum = a @ np.array([0.299, 0.587, 0.114])
    grey = np.repeat(lum[..., None], 3, axis=2)
    a = grey + (a - grey) * keep
    a = a / a.reshape(-1, 3).mean(0) * 0.5          # every channel averages 0.5
    a = 0.5 + (a - 0.5) * contrast
    return Image.fromarray((np.clip(a, 0, 1) * 255).round().astype(np.uint8))


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (asset, keep, contrast) in LAYERS.items():
        out = os.path.join(OUT, f"{name}.jpg")
        neutral(fetch(asset), keep, contrast).save(out, quality=90)
        print(f"{name}: {asset} -> {out}")
    with open(os.path.join(OUT, "LICENSE.txt"), "w") as f:
        f.write("Made from ambientCG textures (https://ambientcg.com), CC0 1.0 Universal:\n")
        for name, (asset, _, _) in LAYERS.items():
            f.write(f"  {name}.jpg  <- {asset}\n")


if __name__ == "__main__":
    main()
