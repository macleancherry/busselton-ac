"""Draw the taskbar icons of the Busselton Lua apps (apps/lua/<app>/icon.png, ICON = icon.png in each
manifest's [WINDOW_...]). CSP looks for them by the window's ICON key and logs
"TaskBarIcon :: COULD NOT FIND TEXTURES FOR IMGUI_LUA_<app>_main_ICON" without one.

    python3 -I scripts/apps/make_app_icons.py

64 x 64, a white glyph on transparent, like CSP's own apps (acc-lua-internal included-apps/*/icon.png).
Drawn 4x larger and scaled down for smooth edges.
"""

import os

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
APPS = os.path.join(HERE, "..", "..", "apps", "lua")
S = 256          # drawing size; saved at 64
WHITE = (255, 255, 255, 255)


def save(img, app):
    out = os.path.join(APPS, app, "icon.png")
    img.resize((64, 64), Image.LANCZOS).save(out, optimize=True)
    print(out)


def stopwatch():
    """Busselton Challenges: a stopwatch."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cx, cy, r, w = 128, 146, 92, 22
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=WHITE, width=w)
    d.rounded_rectangle([cx - 24, 18, cx + 24, 44], radius=8, fill=WHITE)     # button
    d.rectangle([cx - 10, 40, cx + 10, cy - r + 6], fill=WHITE)              # stem
    d.line([cx, cy, cx, cy - 58], fill=WHITE, width=18)                      # hand
    d.line([cx, cy, cx + 40, cy + 22], fill=WHITE, width=14)
    d.ellipse([cx - 14, cy - 14, cx + 14, cy + 14], fill=WHITE)
    return img


def map_pin():
    """Busselton Map: a pin on the ground."""
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([28, 196, 228, 248], outline=WHITE, width=14)
    d.rectangle([90, 190, 166, 222], fill=(0, 0, 0, 0))                      # gap behind the tip
    cx, cy, r = 128, 86, 66
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    d.polygon([(cx - 52, cy + 42), (cx + 52, cy + 42), (cx, 222)], fill=WHITE)
    d.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=(0, 0, 0, 0))
    return img


if __name__ == "__main__":
    save(stopwatch(), "BusseltonChallenges")
    save(map_pin(), "BusseltonMap")
