#!/usr/bin/env bash
# A scripted landmark detail layer, end to end (CLAUDE.md "AC conventions", the four Blender steps):
#
#   scripts/blender/landmarks/build.sh <slug> [base.zip] [renders...]
#
#   <slug>      transition | sea_play (scripts/blender/landmarks/<slug>.py)
#   base.zip    the built track to model against (default out/accepted/busselton.zip)
#   renders     views to render into out/landmark_renders/<slug>_layer_<view>.png (e.g. side front)
#
# 1. export_base.ts: the generated track around the spot (out/layers_work/<slug>_base.glb; kept, delete
#    it to refresh). 2. new_layer.py: the layer file with the base as a locked reference. 3. <slug>.py:
#    builds the "Layer" collection (and renders). 4. export_layer.py + make_layer.ts: routes/layers/
#    <slug>.kn5 and its sidecar, with the "replaces" circles set below.
#
# PYTHON is a Python with the bpy module (pip install bpy==5.2.3); BLENDER_LOCK, if set, is a lock file
# the heavy steps queue on.
set -euo pipefail
cd "$(dirname "$0")/../../.."
slug=${1:?usage: build.sh <slug> [base.zip] [views...]}
base=${2:-out/accepted/busselton.zip}
shift $(( $# >= 2 ? 2 : 1 ))
PY=${PYTHON:-python3}
lock() { if [ -n "${BLENDER_LOCK:-}" ]; then flock "$BLENDER_LOCK" "$@"; else "$@"; fi; }

case $slug in
  transition) at=115.3428445,-33.645035; radius=25; replaces='[{"at":[115.3428445,-33.645035],"radius":4.5,"trees":false}]' ;;
  sea_play)   at=115.34422,-33.644943;   radius=45; replaces='[{"at":[115.344182,-33.644975],"radius":16,"trees":false}]' ;;
  *) echo "unknown landmark $slug" >&2; exit 1 ;;
esac

work=out/layers_work
mkdir -p "$work" out/landmark_renders routes/layers
if [ ! -s "$work/${slug}_base.glb" ]; then
  lock npx tsx scripts/blender/export_base.ts "$base" "$work/${slug}_base.glb" --route routes/busselton.json --at "$at" --radius "$radius"
fi
if [ ! -s "$work/${slug}.blend" ]; then
  lock "$PY" scripts/blender/new_layer.py -- --base "$work/${slug}_base.glb" --out "$work/${slug}.blend"
fi
lock "$PY" "scripts/blender/landmarks/${slug}.py" -- --blend "$work/${slug}.blend"
for view in "$@"; do
  lock "$PY" "scripts/blender/landmarks/${slug}.py" -- --blend "$work/${slug}.blend" --view "$view" \
    --render "out/landmark_renders/${slug}_layer_${view}.png" --samples "${SAMPLES:-16}" --res "${RES:-960x540}"
done
lock "$PY" scripts/blender/export_layer.py -- --blend "$work/${slug}.blend" --out "$work/${slug}_layer.glb"
npx tsx scripts/blender/make_layer.ts "$work/${slug}_layer.glb" routes/layers "$slug"
# The sidecar: what this layer clears in the base (generated houses; trees kept), replacing the spec.
node -e '
const fs = require("fs"), [f, r, slug] = process.argv.slice(1);
const j = JSON.parse(fs.readFileSync(f, "utf8"));
j.note = `hand-made detail layer: scripts/blender/landmarks/${slug}.py (scripts/blender/landmarks/build.sh ${slug})`;
j.replaces = JSON.parse(r);
fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
' "routes/layers/${slug}.json" "$replaces" "$slug"
echo "layer: routes/layers/${slug}.kn5 + .json"
