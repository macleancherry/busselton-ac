# Spec: plain and normal-mapped materials (`src/core/materials.ts`)

Status: spec for a clean rewrite (docs/external-review-2026-10-31.md, "Owning the code"; the file is listed in `UPSTREAM-FILES.txt`). Write the new module from this page without the old file open. Tests are written fresh from "Tests to write".

## What the module is for

Builds the `Kn5Material` records (docs/specs/kn5.md, "Types") for the two simplest Kunos shaders the track uses: `ksPerPixel` (a lit diffuse texture) and `ksPerPixelNM` (the same plus a tangent-space normal map: relief without reflections). Shared by the base track build, the landmark layers and the sea. Most materials in a build come from here.

The richer road and ground materials (`ksPerPixelMultiMap`, `ksMultilayer`) are currently private functions in `src/core/track.ts`. They are specified in the second half of this page so the rewrite can move them here; see "Moving the detail materials here".

## Public API (keep these names and shapes)

```
type Light = { ambient: number; diffuse: number; specular: number; exp: number };
material(name: string, texture: string, light: Light): Kn5Material
nmMaterial(name: string, diffuse: string, normal: string, light: Light): Kn5Material
```

The `Light` shape is written inline at every call site today (`track.ts` repeats it a dozen times). Exporting it as a named type is fine and recommended; callers need not change.

### Call sites (from `grep`, 31 Oct 2026)

- `material`: `src/core/track.ts` (about 60 calls: every plain scenery texture, photo terrain and backdrop chunks when detail shaders are off, road and gravel materials when detail shaders are off, photo road chunks `road_photo_NNN`, house textures, signs, race dress, parked cars...), `src/core/landmarkLayer.ts` (landmark textures and `trees`), `src/core/photoSea.ts` (`sea_photo`, sea chunks, `sea`, `shore_foam`).
- `nmMaterial`: `src/core/track.ts` (`barrier_<look>` for each fence look and the relief house textures, both when `detailShaders` is on), `src/core/landmarkLayer.ts`.
- Callers derive other materials by spreading the result and overriding fields, so the returned object must be a plain object whose spread works:
  - `{ ...material(...), shader: "ksPerPixelAT", alphaTested: true }` (trees, shrubs, signart, race banners, landmark trees);
  - `{ ...material(...), blendMode: BlendMode.AlphaBlend }` and `..., depthMode: DepthMode.NoWrite` (`photoSea.ts` sea and foam).
- Tests that pin values set here: none directly by name today; `test/track.test.ts` and `test/cspConfig.test.ts` pin the detail materials (below) and CSP config that matches material names.

## Rules

### `material(name, texture, light)`

1. Returns exactly these keys: `name`, `shader`, `properties`, `textures`. No `blendMode`, `alphaTested`, `depthMode` or `registers` keys (the kn5 writer fills defaults: opaque, not alpha tested, normal depth).
2. `shader` is `"ksPerPixel"`.
3. `properties`, in this order (the order is written to the kn5, so it matters for byte-identical output), each object carrying only `name` and the one value key shown:

   | # | name | value |
   | --- | --- | --- |
   | 1 | `ksAmbient` | `a: light.ambient` |
   | 2 | `ksDiffuse` | `a: light.diffuse` |
   | 3 | `ksSpecular` | `a: light.specular` |
   | 4 | `ksSpecularEXP` | `a: light.exp` |
   | 5 | `ksEmissive` | `c: [0, 0, 0]` |
   | 6 | `ksAlphaRef` | `a: 0` |

4. `textures` is `{ txDiffuse: texture }`.
5. Values are passed through unchanged (no clamping or validation).

### `nmMaterial(name, diffuse, normal, light)`

6. `shader` is `"ksPerPixelNM"`.
7. `properties`: the six from rule 3, in the same order, then:

   | # | name | value |
   | --- | --- | --- |
   | 7 | `fresnelC` | `a: 0` |
   | 8 | `fresnelEXP` | `a: 5` |
   | 9 | `fresnelMaxLevel` | `a: 0` |
   | 10 | `nmObjectSpace` | `a: 0` (tangent-space normal map) |
   | 11 | `isAdditive` | `a: 0` |

   Fresnel is zeroed so the material has relief but no reflection. The names are the parameters the Kunos shader declares; a misspelt name is silently ignored by the game, so test the exact strings.
8. `textures` is `{ txDiffuse: diffuse, txNormal: normal }`, in that key order. The kn5 writer binds `txDiffuse` to register 0 and `txNormal` to register 1.
9. Same keys rule as rule 1.

### Values the build passes (context, not part of this module)

Typical lights: plain ground `{0.45, 0.4, 0, 1}`; concrete `{0.45, 0.45, 0.05, 10}`; paint `{0.5, 0.5, 0.1, 15}`; glass and windows `{0.35..0.4, 0.3, 0.6, 60..80}`; photo road chunks `{0.42, 0.45, 0.06, 20}`; fence looks `{0.45, 0.45, 0.1, 15}` with normal-map strength 3 (hedge 2). These live at the call sites and don't move.

CSP config (`cspConfig.ts`) refers to materials by name (`barrier_?`, `barrier_hedge`, `barrier_colorbond`, `barrier_paling`, `trees`, `shrubs`...) and by shader (`shader:ksMultilayer?`, `shader:ksPerPixelMultiMap?`), so neither the names callers pass nor the shader strings may change.

## Moving the detail materials here (recommended)

Three private builders in `src/core/track.ts` duplicate rule 3 and belong with these. The rewrite should add them to this module (and track.ts import them). Exact behaviour:

### `multiMapMaterial(name, diffuse, light, maps)` (road and gravel when `detailShaders` is on)

`maps: { normal: string; maps: string; detail: string; detailUV: number; sunSpecular?: number }`.

- `shader`: `"ksPerPixelMultiMap"`.
- `properties`, in order: the six of rule 3, then `fresnelC` 0, `fresnelEXP` 5, `fresnelMaxLevel` 0, `isAdditive` 0, `useDetail` 1, `detailUVMultiplier` `maps.detailUV`, `shadowBiasMult` 0, `nmObjectSpace` 0, `sunSpecular` `maps.sunSpecular ?? 0`, `sunSpecularEXP` 40 (all `a` values). Note the order differs from `nmMaterial` (`isAdditive` before `nmObjectSpace`); keep it for byte-identical output.
- `textures`: `{ txDiffuse, txNormal: maps.normal, txMaps: maps.maps, txDetail: maps.detail }` (registers 0, 1, 2, 3; `test/track.test.ts` checks them).
- How the game uses it: the detail texture multiplies the diffuse wherever the diffuse alpha is 0, tiled `detailUVMultiplier` times across the base UVs; txMaps R, G, B scale specular, gloss and sun specular.
- Call sites pass: sealed road `detail_<asphalt|chipseal>.png`, `maps_asphalt.png`, `detailUV` 9, `sunSpecular` 0.15; gravel `detail_chipseal.png`, `maps_ground.png`, `detailUV` 9, `sunSpecular` 0.02. The diffuse is DXT5 with alpha forced to 0 everywhere (detail everywhere).

### `multilayerMaterial(name, diffuse, mask, light, [r, g, b, a], magicMult)` (ground)

Each layer `{ texture: string; metres: number }` (one tile every `metres`, projected from above in world metres so the scale holds across chunks).

- `shader`: `"ksMultilayer"`.
- `properties`, in order: the six of rule 3, then `multR` `a: 1 / r.metres`, `multG` `a: 1 / g.metres`, `multB` `a: 1 / b.metres`, `multA` **`b: [1 / a.metres, 1 / a.metres]`** (a float2 in the shader; writing it as `a` is silently wrong), `magicMult` `a: magicMult`.
- `textures`: `{ txDiffuse, txMask: mask, txDetailR, txDetailG, txDetailB, txDetailA }` from the four layers (registers 0 to 5; `test/track.test.ts` checks them).
- How the game uses it: diffuse multiplied by the four details weighted by txMask's R, G, B and A, then by `magicMult`.

### `groundMaterial(name, diffuse, mask, light)`

`multilayerMaterial` with layers grass `ground_grass.dds` / 1.6 m, dirt `ground_dirt.dds` / 2.4 m, plain `ground_plain.dds` / 2 m (the `GROUND_TILE` values exported by the textures module; take them from there, don't repeat them), A = `black.png` / 1 m, and `magicMult` 2 (the details average mid grey, so doubling leaves the photo's brightness unchanged from a distance). A is black because a DXT1 mask reads alpha 1. Used for photo terrain chunks, and to replace the plain `grass` (mask `mask_grass.png`, all R) and `verge` (mask `mask_dirt.png`, all G) materials when `detailShaders` is on. `photoSea.ts` `withSandDetail` then swaps B for sand on beach chunks (it looks for shader `ksMultilayer` and property `multB`, so keep both names).

CSP's shader replacement in `cspConfig.ts` sets `ksAlphaRef` to -193 on both detail shaders (CSP's tiling fix for detail maps); that's why rule 3 still writes `ksAlphaRef` 0 here.

### Other near-duplicates (follow-up, not required)

`flags.ts` `flagMaterial` (`ksFlags` plus `frequency` 0.3, `distortion` 0.05) and `trafficLights.ts` `trafficLightMaterials` build the same six base properties by hand. They could start from `material()` and override the shader; leave them unless their own rewrite comes up.

## Bugs and rough edges

None that change output. Keep the property orders exactly as tabled: the kn5 bytes depend on them and the accepted base round-trips byte for byte today.

## Tests to write

1. `material`: shader `ksPerPixel`; property names and order exactly `ksAmbient, ksDiffuse, ksSpecular, ksSpecularEXP, ksEmissive, ksAlphaRef`; values from the light; `ksEmissive` is `c: [0,0,0]`; `ksAlphaRef` 0; textures exactly `{ txDiffuse }`; keys exactly `name, shader, properties, textures`.
2. `nmMaterial`: shader `ksPerPixelNM`; the six then `fresnelC 0, fresnelEXP 5, fresnelMaxLevel 0, nmObjectSpace 0, isAdditive 0`; textures `{ txDiffuse, txNormal }`.
3. Spread overrides work: `{ ...material(...), shader: "ksPerPixelAT", alphaTested: true }` keeps the properties and textures.
4. Written through `writeKn5` and read back: `nmMaterial` registers are `{ txDiffuse: 0, txNormal: 1 }`.
5. If the detail builders move here: `multiMapMaterial` registers `{0,1,2,3}`, `useDetail` 1, `detailUVMultiplier` as given, `sunSpecularEXP` 40; `multilayerMaterial` `multA` has `b` of two equal values and no `a`; `groundMaterial` `multR` is 1/1.6, `magicMult` 2, detail textures `ground_grass.dds, ground_dirt.dds, ground_plain.dds, black.png`. (`test/track.test.ts` already checks the built track for these; keep it passing.)

### Golden fixtures

Before deleting the old code, save the JSON of `material("g", "g.png", {0.45, 0.4, 0, 1})`, `nmMaterial("b", "b.png", "b_nm.png", {0.45, 0.45, 0.1, 15})`, and (from track.ts, via a temporary export or by reading them out of a test build's kn5 with `readKn5`) one `road_asphalt_*`, one `road_gravel_*` and one `terrain_*` material, under `test/fixtures/materials/`. The new builders must deep-equal them, property order included. The kn5 round-trip of the accepted build (docs/specs/kn5.md test 20) plus a full rebuild comparison by the lead is the final check.

## Rewrite notes (31 Oct 2026)

Rewritten from this page. `multiMapMaterial`, `multilayerMaterial` and `groundMaterial` moved here from `track.ts` (which imports them), with `Light`, `DetailMaps` and `Layer` exported as types. Goldens: `test/fixtures/golden-mesh/materials.json` (the two plain builders, one asphalt, one gravel and one terrain material), compared with property and texture key order by `test/golden.test.ts`.
