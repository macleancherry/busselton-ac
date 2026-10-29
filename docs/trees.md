# Best-quality trees for the Busselton AC tracks: research

Date: 2026-10-30. Scope: AC1 + CSP, RTX 4060, 2 km x 1 km town map, 5,000 to 15,000 trees, track budget about 1.5M triangles and 4,000 draw calls.

Anything I could not confirm from a primary source is marked **(unconfirmed)**.

---

## TL;DR

- **Use CSP's instanced tree system (`[TREES]` in `extension/ext_config.ini`).** It is built for this: LODs, automatic billboards for distant trees and heavy instancing, and the author says it "should be able to handle hundreds of thousands of trees" ([CSP wiki: Tracks – Trees](https://github.com/ac-custom-shaders-patch/acc-extension-config/wiki/Tracks-%E2%80%93-Trees)). These trees are not in the kn5, so they don't count against our kn5 triangle and draw-call budget. They still cost GPU time, though.
- **We can script all of it on Linux.** The tree list is a plain text format. The tree model `.bin` is a **zip file** holding `tree.ini`, one `.mesh` per LOD and the textures. Content Manager's converter is open source (Ms-PL, [gro-ove/actools `AcTreeModelConverter.cs`](https://github.com/gro-ove/actools/blob/master/AcTools.ExtraKn5Utils/Helpers/AcTreeModelConverter.cs)), so we know the exact binary layout and can write `.bin` files from TypeScript the same way we write kn5. CM has no command-line mode for this (I found none), so a human is only needed once, to make a reference `.bin` to check our writer against.
- **Model budget matters more than tree count.** Community packs made from heavy SpeedTree-style models hurt FPS badly. One TreeFX Suzuka user went from about 90 to about 30 FPS on an RTX 3070 with only about 2,600 trees ([TreeFX for Suzuka](https://www.overtake.gg/downloads/treefx-for-suzuka.58329/)). The CSP wiki suggests about 10k/6k/3k triangles per LOD. For a town on a 4060 I'd aim lower: about 5–6k / 2–2.5k / 600–900, then CSP's billboard.
- **Models:** a headless Blender script per species (Sapling Tree Gen as the branch skeleton, or our own generator), with leaf-cluster cards textured from CC0 scans (Poly Haven `eucalyptus_bark` and `bark_bluegum`, ambientCG LeafSets) or, better, Mac's own photos of real Busselton foliage.

---

## 1. CSP instanced trees: what's documented

Primary source: the [CSP wiki page "Tracks – Trees"](https://github.com/ac-custom-shaders-patch/acc-extension-config/wiki/Tracks-%E2%80%93-Trees), mirrored at [cup.acstuff.club/docs/csp/tracks/trees](https://cup.acstuff.club/docs/csp/tracks/trees). Introduced in **CSP 0.1.79**.

### 1.1 Track config (`extension/ext_config.ini`)

```ini
[TREES]
LIST_0 = trees/trees.txt            ; relative to the track's extension folder
; LIST_1 = trees/trees_street.txt   ; several lists allowed; editing one reloads only that one
SURFACE_MATERIALS = tarmac, Concrete2Mat   ; snap trees to these surfaces and align their lighting
; SURFACE_MESHES = ...                     ; same, by mesh
COMPILED_LIST = compiled_trees.bin  ; written by the VAO bakery (see 1.6); overrides LIST_* in normal runs
SEASON_AUTUMN_0 = SEASON_AUTUMN     ; tie seasonal tint to a [CONDITION_...] named SEASON_AUTUMN
SEASON_WINTER_0 = SEASON_WINTER
SEASON_AUTUMN_1 = tree_pine?, tree_big_pine.bin, 0   ; per-model override (e.g. no autumn on evergreens)
```

Season conditions, quoted from the wiki:

```ini
[CONDITION_...]
NAME = SEASON_WINTER
INPUT = YEAR_PROGRESS
LUT = (|-1=0|0=0.25|0.05=0.35|0.075=2|0.12=0.3|0.2=0|0.45=0|0.6=0.00|0.7=0|0.85=0|0.95=0.2|1=0.25|)

[CONDITION_...]
NAME = SEASON_AUTUMN
INPUT = YEAR_PROGRESS
LUT = (|-1=0|0=0.75|0.2=0|0.45=0|0.6=0.05|0.7=0|0.75=0|0.8=0.75|1=0.75|)
```

For us: every Busselton species is evergreen, and `YEAR_PROGRESS` assumes northern-hemisphere seasons **(unconfirmed)**. So set every species' season override to 0, or leave the season keys out.

Other track-level keys that touch trees ([Tracks – General options](https://github.com/ac-custom-shaders-patch/acc-extension-config/wiki/Tracks-%E2%80%93-General-options)):

```ini
[LIGHTING]
ENABLE_TREES_LIGHTING = 0     ; "if all your trees are not very close to a track, you can improve performance a lot by disabling trees lighting completely"
[WIND]
TREES_NORMALIZATION = 0.8, 1  ; for ksTree-style kn5 trees' wind; unclear whether it affects [TREES] instanced trees (unconfirmed)
```

The player can also change some things in CSP settings ([acc-extension-config `config/graphics_adjustments.ini`, `track_adjustments.ini`](https://github.com/ac-custom-shaders-patch/acc-extension-config/tree/master/config)):

```ini
TREES_DISTANCE_MULT=1     ; Multiplier for trees LODs ... from 0.2 to 3.2; requires restart
TREES_RECEIVE_SHADOWS=0   ; Trees receiving per-vertex shadows (might cause flicker without TAA)
TREES_A2C_DITHERING=0     ; Trees A2C dithering (reduces banding with MSAA)
ENABLE_TREES_LIGHTING=1   ; (lighting_fx.ini)
```

### 1.2 Tree list format (`trees.txt`)

Every line is a comment, a tree, or a configuration line. A configuration line applies to all following trees until the same key is set again. Quoted from the wiki:

```
configure: size variance = 0.8, 1.2  ; size multiplier will be chosen randomly in 80…120% range
configure: angle variance = 0, 360   ; angle will be chosen randomly in 0…360° range

tree: my_tree.bin; 208.4, -1, -53
tree: tree0.bin; pos=-83.3, -0.99, -74.14; angle = 180; size = 1; width = 1; color = 2, 2, 2
```

Configure keys: `size variance`, `width variance`, `angle variance`, `color variance` (random RGB shift range), `brightness variance`, `fake shadow` (one value, the fake shadow opacity), `seed`. "All random values are predetermined with a fixed seed even if no explicit seed is set." Per-tree overrides: `pos`, `angle` (degrees), `size`, `width`, `color`.

- Positions are track-space x, y, z with Y up, the same space as our kn5 **(the x/y/z order and units are inferred from the wiki examples and CM's Y-up conversion, so confirm in the reference test)**. The model names in the list are `.bin` files relative to the list file.
- **Yes, a script can write this.** The wiki even says "you might be interested in creating custom export scripts". TreePlanter (an in-game Lua placement app) writes the same file ([TreePlanter on Overtake](https://overtake.gg/downloads/3d-trees-in-2-minutes-with-treeplanter.59142/updates)).
- `color = 2, 2, 2` suggests colour is a multiplier, not 0–1 **(unconfirmed scale)**.

### 1.3 Tree model format (`.bin`): what CM's converter wants and writes

CSP wiki requirements (quoted or close paraphrase):
- "10K triangles for LOD A, 6K triangles for LOD B, 3K triangles for LOD C (just suggestions...)". Fewer LODs is fine.
- "Single mesh per LOD (use multi-material if you need one texture for trunk and another for branches and such)."
- "Pivot of each model should be right at the middle of its base."
- "Materials should contain both diffuse (albedo) and normal texture (use bump texture in 3DS Max)."
- "Alpha of normal textures can be used for local ambient occlusion."
- "Alpha of diffuse textures is used for transparency: make sure trunk texture is opaque."
- Put all the LODs in one scene and export as **FBX**. In CM, go to Content → Tools → Creator tools → Tree model converter, pick the FBX and the output `.bin` (e.g. `extension/trees/`). It watches the FBX and reconverts when it changes.

What the converter source actually does ([`AcTreeModelConverter.cs`](https://github.com/gro-ove/actools/blob/master/AcTools.ExtraKn5Utils/Helpers/AcTreeModelConverter.cs), [`TreeModelConverter.xaml.cs`](https://github.com/gro-ove/actools/blob/master/AcManager/Pages/ContentTools/TreeModelConverter.xaml.cs), licence Ms-PL). I read it directly:

- **Every geometry object in the FBX becomes one LOD.** If any mesh name starts with `LOD`, it switches to "SpeedTree mode", uses only the `LOD*` meshes and sets `USE_AO_CHANNEL`. LODs are **sorted by triangle count**, highest first, so names don't matter otherwise. Stray helper meshes in the FBX become bogus LODs. A user found that several meshes per LOD caused flicker until he joined them ([Overtake: Creating TreeFX tree models](https://overtake.gg/threads/q-creating-treefx-tree-models.263542)).
- The mesh needs normals, UVs and a material layer. Each material contributes its texture connected with role **`DiffuseColor`** and its **`NormalMap`** texture. Blender's FBX exporter uses those roles for Base Color and Normal Map **(I believe so but haven't tested it)**. Textures are found by path or next to the FBX and copied into the zip as they are (use DDS).
- Raw FBX vertex data is used with **no object transforms applied**. A heuristic flips Z-up to Y-up when the bounding box looks Z-up. So apply transforms before export, or the heuristic may get an asymmetric tree wrong.
- Vertices are **normalised**: x and z are divided by the largest horizontal distance from the pivot, y by the height, so everything sits in a unit box. `tree.ini [BASIC] HEIGHT/WIDTH` scales it back up.
- Indices are `ushort`, so at most **65,535 unique vertices per material sub-mesh**.

**The `.bin` is a zip** (also stated in the wiki and the Overtake thread) containing:

1. `tree.ini`. The converter's defaults:
   ```ini
   [BASIC]
   HEIGHT=<model height, m>
   WIDTH=<2 x max horizontal radius, m>
   CACHE_RESOLUTION=256,512   ; UI default; probably the billboard/impostor cache size (unconfirmed)
   VERTICAL_OFFSET=0
   ; LEAFLESS_WINTER=1        ; reserved for future winter leaf drop (wiki)
   [SHADING]
   SPECULAR=1.0
   SUBSCATTERING=1.0          ; wiki: conifers need less subscattering and reflectivity
   REFLECTIVITY=1.0
   BRIGHTNESS=1.0
   USE_AO_CHANNEL=0           ; 1 = use normal-map alpha as AO
   [NORMALS]
   BOOST=0.9
   SPHERE=1.0                 ; spherical normals blend for foliage lighting (meaning inferred)
   [LEAVES]
   MULT=20.0
   OFFSET=0.0
   [FAKE_SHADOW]
   SIZE=1.0
   OPACITY=1.0
   [LOD_0]
   MODEL=<mesh name>.mesh
   DISTANCE=<HEIGHT*10*(1/n)>
   [LOD_1]
   MODEL=...
   DISTANCE=<HEIGHT*10*(2/n)>   ; last LOD ends at 10x tree height, then billboard (inferred)
   ```
   Starting shading values one modder used: `specular=0.02, subscattering=0.3, reflectivity=0.02` ([Overtake thread](https://overtake.gg/threads/q-creating-treefx-tree-models.263542)).
2. `<meshname>.mesh` per LOD, little-endian, written as follows:
   ```
   int32  1                       ; version
   uint8  0
   int32  textureCount
   repeat textureCount: uint32 xxHash32(file bytes, seed 0; 0 -> 1), int32 byteLen + UTF-8 file name
   repeat per material sub-mesh (no count; read until marker/EOF):
     int32 diffuseTexIndex (-1 none), int32 normalTexIndex (-1 none)
     int32 indexCount, uint16[indexCount]
     int32 vertexCount, then per vertex (44 bytes):
       float3 pos (normalised, see above), float3 normal, float2 uv,
       uint8x3 tangent (t*127.5+127.5), uint8 elementId=0,
       half2 uv2=0, uint8 ao0=255, uint8 ao1=255, uint8 wet=255, uint8 extra=0
   int32 -1, int32 4, float trunkWidth   ; trailing tagged block (trunk radius, normalised)
   ```
   Winding: when there's no Y/Z flip the converter writes (i, i+2, i+1), so it reverses the FBX order.
3. The texture files.

You can edit the files inside a `.bin` without reconverting. Close the archive before starting AC, or it may crash ([Overtake thread](https://overtake.gg/threads/q-creating-treefx-tree-models.263542)).

**Can conversion be scripted?** I found no CM command-line switch for it **(unconfirmed that none exists)**, and the UI is a WPF page. Three options:
- (a) **Write `.bin` ourselves in TypeScript** from the layout above. Recommended: fully automatic on Linux, and we control `tree.ini`, the LOD distances and the AO channel.
- (b) A tiny C# console app on Windows that calls `AcTreeModelConverter.Convert(fbx, bin, treeParams)` from CM's DLL. Possible, but it puts a build step on the workstation, which CLAUDE.md says to avoid.
- (c) CM by hand: only once, to make a reference `.bin` we can byte-compare our writer against.

### 1.4 LODs, billboards, shadows, wind

- **LODs:** as many as you like, given as `[LOD_n] MODEL/DISTANCE` in tree.ini. The player can scale them with `TREES_DISTANCE_MULT` (0.2–3.2).
- **Billboards:** the wiki says "LODs, billboards for distant trees and heavy use of instancing". CSP generates them; you don't author them. `CACHE_RESOLUTION=256,512` looks like the impostor resolution **(unconfirmed)**.
- **Shadows:** confirmed: (1) `fake shadow` (a per-tree blob, opacity set from the list, size from `[FAKE_SHADOW]`); (2) the VAO bakery bakes "shadows cast by CSP procedural trees, as well as shadows cast upon CSP procedural trees" ([acc-bakeryoptix README](https://github.com/ac-custom-shaders-patch/acc-bakeryoptix)); (3) the player option `TREES_RECEIVE_SHADOWS` (per-vertex). **Whether instanced trees cast into CSP's real-time sun shadow maps is unconfirmed.** A TreeFX review mentions "odd shadows", which suggests they do.
- **Wind/sway:** **unconfirmed.** Nothing in the wiki documents sway for `[TREES]` models. `[WIND] TREES_NORMALIZATION` exists but is documented for kn5 trees.
- **Seasonal colour:** confirmed (above). Not useful for evergreens.
- **Surface alignment:** `SURFACE_MATERIALS`/`SURFACE_MESHES` snap Y to the ground and match lighting to the slope. We already know ground height, so write exact Y and skip snapping, or use it as a safety net.

### 1.5 Hiding old trees
Kn5 tree meshes can be hidden from ext_config (TreePlanter's page documents `FILE`/`HIDE`/`MATERIALS`/`LOD_IN` entries). We generate the kn5 ourselves, so we just stop emitting card trees.

### 1.6 Baking and compiling (optional, Windows)
The VAO bakery v17+ (needs AC + CSP installed, runs AC headless a few times) writes `compiled_trees.bin` (faster loading), bakes tree shadows onto the track and directional AO onto trees. Set `COMPILED_LIST = compiled_trees.bin`. **Recompile whenever the tree list or the ground changes.** `baked_shadow_params.ini` has `EXT_PROCEDURAL_TREES_*` (e.g. `..._FINALIZE`, `..._BAKE`, `..._OCCLUDE` in [main.cpp](https://github.com/ac-custom-shaders-patch/acc-bakeryoptix/blob/master/bakeryoptix/main.cpp)). The bakery takes file paths as command-line arguments, so the workstation can run it from a script. It now also bakes on Vulkan or Embree CPU, not only OptiX.

---

## 2. How other tracks do trees

What I could source:
- **Kunos and most classic mods use kn5 card trees with the `ksTree` shader** (alpha test, `ksAlphaRef 0.5`, mirrored faces because AC has no double-sided materials, normals pointed up via `KSTREE_GROUP_<name>_<n>` naming in ksEditor) ([assettocorsamods: setting up trees](https://assettocorsamods.net/goto/post?id=5376)). CSP's per-track configs patch `shader:ksTree` materials on LA Canyons (`[ALIGN_TREES_...]`, which lights trees from the hill below), Spa, Nordschleife, Karelia, Trento-Bondone, Evo Triangle and others ([acc-extension-config/config/tracks](https://github.com/ac-custom-shaders-patch/acc-extension-config/tree/master/config/tracks)). So **the well-known free-roam and canyon tracks (LA Canyons and similar) still use kn5 cards, with CSP config fixing the lighting**. For Shutoko Revival Project, Pacific Coast, Arrabassada and the Ardennes tracks I found **no primary source** on their method **(unconfirmed; they appear to be kn5 mesh/card trees)**.
- Distant forest on mod tracks often uses 1–6 triangles per tree. For example, 4,000 single-triangle trees over 2 km² at Bremgarten, and texture atlases of 2048²–4096² with four trees each ([Overtake: advice for creating trees](https://www.overtake.gg/threads/some-advices-for-creating-trees-for-assetto-corsa-mod-track.191706/page-3)).
- **CSP 3D tree retrofits:** TreeFX for Nordschleife has about 17,000 CSP trees on High and about 1,250 on Low, with separate VR presets, and is based on Johannes Steiger's Monza trees ([TreeFX Nordschleife](https://overtake.gg/downloads/treefx-for-nordschleife-3d-trees.58778)). TreeFX Suzuka has about 2,600 hand-placed trees and reports from no FPS issue to 90→30 FPS on an RTX 3070 ([TreeFX Suzuka](https://www.overtake.gg/downloads/treefx-for-suzuka.58329/)). Forum views are mixed: some find heavy 3D packs cartoony, with visible LOD swaps in VR, and prefer good 2D trees ([GTPlanet mods thread](https://www.gtplanet.net/forum/threads/assetto-corsa-pc-mods-general-discussion.307899/post-14526558)). Lessons: keep LOD transitions subtle, keep colours natural, and budget triangles.
- **TreCorsa**, another web-based AC track builder, offers both 2D trees and "3D trees (CSP)" with brushes ([TreCorsa docs](https://www.trecorsa.com/docs/?cat=trees)). Competing tools are going the same way.

What reads as best quality, from the sources above plus general real-time practice (my synthesis):
1. A silhouette that matches the species (branch structure visible through gaps; eucalypts are open and clumpy, not a ball).
2. Leaf **cluster** cards with a real normal map plus AO in the normal alpha (the CSP format supports this) and colour variance per instance.
3. Subtle LOD changes: the near LOD keeps the same cards, just fewer of them, rather than a different-looking model.
4. Ground contact: fake shadow plus baked shadows on the road.

---

## 3. Making the Australian species

### 3.1 What each species needs to look like

| Species | Town form (Busselton) | Modelling notes |
|---|---|---|
| Tuart (*E. gomphocephala*) | 15–30 m, massive grey fibrous trunk, crooked spreading limbs, open clumpy crown | Branch skeleton matters most; clusters at branch tips with sky gaps. Bark: Poly Haven `eucalyptus_bark` / `bark_bluegum` |
| Marri (*Corymbia calophylla*) | 15–25 m, rough tessellated bark, denser rounded crown | Like tuart but denser; a separate bark texture |
| WA peppermint (*Agonis flexuosa*) | 5–10 m, often multi-trunk, **weeping** willow-like foliage; the commonest street tree | Sapling `weeping_willow` preset as the base; long hanging strand cards |
| Coastal she-oak (*Allocasuarina*) | 5–10 m, wispy grey-green needle-like cladodes | Fine hanging needle cards (ambientCG `PineNeedles001`, retinted); fairly see-through |
| Norfolk Island pine (*Araucaria heterophylla*) | 20–40 m, perfectly conical, horizontal tiers of branches | Easiest to do procedurally: trunk plus tiered whorls of branch cards. Very visible landmark on the foreshore |

### 3.2 Generators and libraries

- **Sapling Tree Gen** (Weber & Penn algorithm). Now a Blender extension, v0.3.7 (Dec 2025), `blender_version_min = 4.4.0`, GPL-3.0+ (licence applies to the add-on code, not the trees it makes) ([extensions.blender.org](https://extensions.blender.org/add-ons/sapling-tree-gen), [source](https://projects.blender.org/extensions/add_curve_sapling)).
  - Presets in source: `callistemon`, `douglas_fir`, `japanese_maple`, `quaking_aspen`, `small_maple`, `small_pine`, `weeping_willow`, `white_birch`, `willow`. Presets are plain Python dicts, so headless use is `bpy.ops.curve.tree_add(**preset_dict, ...)`.
  - Output is a bevelled curve skeleton (or a skin-modifier mesh with `makeMesh`) plus a leaf mesh (`leafShape` hex/rect, or `leafDupliObj` to instance your own leaf/cluster object), an optional armature and wind animation.
  - **Blender 5.x support: unconfirmed.** No max version is listed, and a review mentions a 0.4.0 for 5.2; a community fork (Brad-Chamberlain) is active.
  - Best fit for us: scriptable and free. Its trunks need decimating, which we script.
- **Own generator** (Python/bpy or even TypeScript): space colonisation or Weber-Penn plus our card placer. More work, but we fully control the triangle budget, species shapes and LOD consistency. Worth it for Norfolk pine at least, and the same code makes all LODs.
- **MTree / Modular Tree:** master last updated 2021, needs a C++ build. Not recommended ([GitHub](https://github.com/MaximeHerpin/modular_tree)).
- **Tree-It:** free, Windows-only GUI, not scriptable. TreeFX modders used it with SpeedTree ([Overtake thread](https://overtake.gg/threads/q-creating-treefx-tree-models.263542)).
- **The Grove 2.3:** paid (Starter €99 / Indie €199), Blender 4.2+ and 5.0, Linux supported, very realistic growth, exports FBX/OBJ/USD ([CG Channel](https://www.cgchannel.com/?p=174250)). Headless/Python use **unconfirmed**. Its output is high-poly, so it needs our card and LOD reduction.
- **SpeedTree:** paid subscription. The CM converter has a special mode for its `LOD*` meshes.
- **Paid Australian libraries** (high-poly, render-oriented, licences need checking for game use): Globe Plants bundles (Eucalyptus, Australian home and garden plants), Xfrog Norfolk Island Pine, "Australian Native Trees Pack 31" (15 natives, 100k–1.5M polys, $259) ([Superhive](https://superhivemarket.com/products/australian-native-trees-pack-31), [Xfrog Norfolk pine](https://www.cgtrader.com/3d-models/plant/conifer/xfrogplants-norfolk-island-pine-araucaria-heterophylla)). These would need decimating or reducing to cards. Not CC0.
- **CC0 assets** (from the Poly Haven and ambientCG APIs, checked today):
  - Poly Haven textures: `eucalyptus_bark`, `bark_bluegum`, `pine_bark`, `knotted_pine_bark`, `palm_bark`, `bark_brown_01/02`, `tree_bark_03` ([polyhaven.com](https://polyhaven.com/textures)).
  - Poly Haven models: `jacaranda_tree` (about 312k tris; jacarandas are common in WA towns), `island_tree_01..03`, `tree_small_02`, `fir_tree_01`, `pine_tree_01` (millions of tris). Useful as a **source of leaf/twig geometry to bake into cluster cards**, not to place as they are.
  - ambientCG: `Bark001..015`, `LeafSet001..030` (scanned leaf atlases with opacity), `Foliage001..008`, `PineNeedles001` ([ambientcg.com](https://ambientcg.com)).
  - Quaternius and other low-poly stylised packs don't suit a realistic look.
- **Best fidelity and licensing: Mac's own captures.** Photograph a peppermint, tuart, she-oak and Norfolk pine branch against a white sheet or the sky to get cluster textures, and the bark up close for tileable bark. That fits the project's public-build rule ("CC0 textures and Mac's own scans only").

### 3.3 Suggested triangle and texture budget per species (my estimate, not from a source)

| LOD | Distance (tree ~15 m) | Trunk + branches | Leaf cluster cards | Total |
|---|---|---|---|---|
| A | 0–40 m | ~1,500–2,500 | ~1,500–2,000 cards (3–4k tris) | **5–6k** |
| B | 40–90 m | ~500 | ~800 cards (larger) | **~2–2.5k** |
| C | 90–150 m | ~100 | ~300 big cards | **~600–900** |
| Billboard | >150 m | CSP impostor | | 2 |

Textures: one 2048² leaf-cluster atlas (diffuse + alpha, normal + AO alpha) and one 1024²–2048² bark set per species, as DDS (BC7, or BC3 for alpha) with mipmaps. Five species cost about 60–80 MB of VRAM.

Rough load in a town view: about 30 trees at A, about 120 at B and about 250 at C gives about 0.7M instanced triangles, plus shadow passes, in a few dozen draw calls (species × LOD × material). A 4060 handles that comfortably. The kn5 budget actually *drops*, because the card trees go. Verify on the workstation with the existing autotest FPS logging.

---

## 4. Recommended pipeline

**Cloud box (Linux): all automated.**
1. **Species specs** (`trees/species/<name>.json`): height range, form parameters (Sapling dict or our generator's parameters), bark and leaf texture sources, LOD budgets, `tree.ini` shading (e.g. needle species: lower `SUBSCATTERING`/`REFLECTIVITY`).
2. **Cluster card textures** (`blender --background --python scripts/trees/make_clusters.py`): build twig or leaf clusters from scanned leaves (ours or CC0), render them orthographically to an atlas (diffuse + alpha), and bake normals plus AO into normal.rgb/a.
3. **Tree models** (`blender --background --python scripts/trees/make_tree.py -- <species>`): skeleton from Sapling or our generator, decimate the branches per LOD, scatter cluster cards on branch tips (the same cards thinned across LODs so the look stays the same), pivot at the base centre, apply transforms. Export glTF (or raw JSON arrays) for our writer, plus FBX for the one-off CM reference test.
4. **`.bin` writer** in TypeScript (port of `AcTreeModelConverter`, Ms-PL, credit it): normalise vertices, compute tangents, write the `.mesh` files and our own `tree.ini` (explicit `[LOD_n] DISTANCE`, `USE_AO_CHANNEL=1`, `[FAKE_SHADOW]`), and zip with the DDS textures. Also write a quick-check renderer (three.js preview) for the build's SHOTS.
5. **Tree list**: positions from OSM `natural=tree` nodes and `tree_row` ways, canopy detection on Landgate imagery for the rest, species from rules (street verges → peppermint; foreshore → Norfolk pine; bush remnants → tuart/marri/she-oak) or from council street-tree data if Busselton publishes any **(unconfirmed)**. Write `extension/trees/trees.txt` with `configure:` lines per area (size/angle/colour/brightness variance, `fake shadow`) and exact Y from our DEM/terrain. Add `[TREES] LIST_0 = trees/trees.txt` to ext_config. Stop emitting kn5 card trees (or keep them only for a no-CSP fallback, which isn't needed).
6. **Checks**: extend `budget.ts` to count instanced trees within LOD rings, `.bin` size and texture memory. Add a check that no tree sits on asphalt or a traffic lane and none is within the kerb clearance.

**Workstation (Windows, RTX 4060): scripted, no code edits.**
7. Install and smoke test as usual. The `run-test.ps1` autotest gives FPS and logs on the drive. The tree check is that it loads and holds frame rate.
8. Optional release step: run the VAO bakery from a script (`bakeryoptix.exe <track or layout .ini>`, with VAO features off if wanted) to make `compiled_trees.bin` plus tree shadows. The zip comes back through the test share, the cloud adds it, and sets `COMPILED_LIST`. Rebake whenever trees or ground change, so do it only for "keeper" builds.

**Needs a human in Content Manager (once):**
9. Convert one reference FBX (from step 3) in CM's Tree model converter, so we can byte-compare against our TS writer and catch format drift (CM 0.8.x vs newer CSP builds). Repeat only if CSP changes the format.
10. Mac drives and judges the look (silhouette, LOD pops, colour). That's the real acceptance test.

**Upstream note:** instanced CSP trees and a `.bin` writer are general (any road, any region), so per CLAUDE.md check honestjams/ac-track-builder's `docs/roadmap.md` first and offer the writer and `[TREES]` output as a PR. The Busselton species models, the placement rules and the bakery step are ours.

---

## Unconfirmed items to test first
1. Exact tree-list axis order and Y handling (do one test tree at a known kn5 point).
2. Whether instanced trees sway in wind and cast real-time sun shadows.
3. What `CACHE_RESOLUTION`, `[LEAVES] MULT/OFFSET` and `[NORMALS] SPHERE` do (make a quick A/B in AC).
4. Whether CSP accepts PNG inside `.bin` or needs DDS (use DDS to be safe).
5. Sapling on Blender 5.x headless.
6. Whether `YEAR_PROGRESS` seasons follow the southern hemisphere (moot if seasons are off).
7. Whether there is any CM command-line switch for tree conversion (none found in source search; not exhaustive).
