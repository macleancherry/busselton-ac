# Spec: building styles (facades, roof finishes, their textures, and dressing a building)

Replaces `src/core/buildingStyles.ts` (upstream-derived, about 95% match, plus two fork roof colours). No placement or heights here; [buildings.md](buildings.md) builds the meshes.

## What it does

1. Defines **window layouts**: how openings repeat along and up a wall.
2. Defines **facades**: a wall finish in a colour, a trim colour, a layout, and a sign colour for shops.
3. Defines **roof finishes**: Australian Colorbond colours, terracotta and concrete tiles, membrane and gravel.
4. Paints a **texture** for each facade (one period wide, one storey tall) and each roof finish (2 m square).
5. **Dresses** a building: picks its type, facades, roof shape, finish, pitch, height and extras from what's known about it.

## Layouts

A layout has: period (metres along the wall before it repeats), storey height, a list of openings (each x0..x1 along the period and z0..z1 up from the storey floor, kind window, shop or door), whether glass panes go over the windows (CSP lights rooms behind them), a plain band (z range of the storey with no openings, used for gable ends), and optional extra painting (shop sign band, balcony, window hoods).

Layouts needed (names are referenced by name elsewhere; dimensions are the design, keep or tune):

| Name | Period | Storey | Openings | Panes | Extra |
| --- | --- | --- | --- | --- | --- |
| house | 8 | 3 | a wide living window (about 2.25 m wide, sill 0.94, head 2.25) and a small high one | yes | |
| modern | 8 | 3 | a floor-to-ceiling slider (3 m) and a tall slot window | yes | |
| queenslander | 4 | 3 | a pair of tall double-hung windows | yes | hoods |
| flats | 6 | 2.8 | living window and small bathroom window | yes | |
| apartment | 7 | 3 | full-height glass (4.6 m) and a bedroom window | yes | balcony |
| office | 3 | 3.6 | a ribbon of glass nearly the full period | yes | |
| curtain | 1.5 | 3.6 | glass floor to floor between thin mullions | no | |
| shopfront | 6 | 4 | two display windows (kind shop) and a glass door (kind door) | yes | sign |
| shopupper | 5 | 3.2 | two sash windows | yes | |
| industrial | 12 | 6 | one strip of high windows at 3.6 to 4.2 m | no | |
| hall | 4 | 4.5 | one tall window | yes | |
| blank | 4 | 3 | none | no | |

## Facades

Each: a name (unique; used in material and mesh names and in house looks), wall kind, colour, trim (window frames; mullions on glass), layout, optional sign colour. Wall kinds: brick, weatherboard, fibro, render, cladding, corrugated, panel, glass, lattice.

The set (names matter: `houseLooks.ts`, route `houseStyle` mixes, house-look JSON files and `specHouse` refer to them by name):

- Brick veneer houses: `brick_red`, `brick_cream`, `brick_brown`, `brick_tan`, `brick_dark`, `brick_painted` (painted brick, dark trim).
- Weatherboard: `wb_white`, `wb_cream`, `wb_grey`, `wb_sage`, `wb_blue`, `wb_yellow`. Fibro: `fibro_white`, `fibro_mint`, `fibro_blue`, `fibro_pink`.
- Modern (render or cladding, dark frames, modern layout): `render_white`, `render_grey`, `render_charcoal`, `render_sand`, `render_terracotta`, `clad_timber`, `clad_black`.
- Queenslanders: `qld_white`, `qld_cream`, `qld_blue`, `qld_yellow` (coloured trim).
- Walk-up flats: `flats_red`, `flats_cream`, `flats_brown`, `flats_render`.
- Apartments: `apt_white`, `apt_grey`, `apt_sand`, `apt_charcoal`.
- Offices: `office_grey`, `office_brick`, `office_white`.
- Glass towers (colour is the glass, trim the mullions): `glass_blue`, `glass_green`, `glass_silver`, `glass_bronze`.
- Shopfronts (with sign colours red, blue, green, black, yellow): `shop_red`, `shop_blue`, `shop_green`, `shop_black`, `shop_yellow`. Above shops: `upper_brick`, `upper_cream`, `upper_blue`.
- Sheds and warehouses (Colorbond corrugated, or tilt-up panels): `shed_surfmist`, `shed_shale`, `shed_woodland`, `shed_ocean`, `shed_cream`, `tiltup`.
- Halls: `hall_brick`, `hall_cream`.
- Under a Queenslander: `lattice_white`, `lattice_green`.

Colours: pick plausible real-world values for each name (brick reds and creams, the published Colorbond colours for the shed and roof finishes). Export a name-to-index map. Order matters only within a build (indices are stored on buildings during a build), so the new list may reorder freely as long as everything looks names up.

## Roof finishes

Each: name, RGB, kind (metal, tile, ctile for concrete tile, membrane, gravel); tile and ctile count as tiled (less shine). The set: `surfmist`, `shalegrey`, `windspray`, `woodland`, `monument`, `cream`, `terracotta` (tile), `paperbark`, `jasper`, `manorred`, `deepocean`, `basalt`, `dune`, `zinc`, `terracotta_aged` (tile), `tile_charcoal`, `tile_slate`, `tile_brown`, `tile_red`, `tile_sand` (ctile), `membrane`, `gravel`, and the fork's greens `paleeucalypt`, `cottagegreen` (metal).

`PITCHED`: the finishes that aren't membrane or gravel (what a sloped roof seen in a photo can be). `specHouse.ts` and `landmarkLayer.ts` look finishes up by name; keep names.

## Textures

All painted procedurally at 32 px a metre, sides rounded to a multiple of 4 (block compression), opaque PNG. Deterministic: the noise is seeded from the facade or finish (name and colour), so a texture is the same every build.

### Facade texture

One period wide, one storey tall, floor at the bottom. Per pixel, in priority order:

1. **Shop sign band** (sign layouts): a fascia in the sign colour from 3.1 to 3.85 m, with pale blocky "lettering" in its middle third (rows of short pale bars, some missing). Not real text.
2. **Balcony** (balcony layouts): a slab edge slightly lighter than the wall at the floor (up to 0.22 m); a glass balustrade to 1.15 m in front of the big window, with a trim-colour top rail and ends; behind it the window or wall, washed toward a pale blue-grey.
3. **Hoods** (hood layouts): a trim-colour hood just above each window, darker on its underside.
4. **Openings:** a 6 cm frame in the trim colour around each opening; mullions in wide openings (over 1.6 m: a vertical centre bar) and on Queenslander windows (a horizontal centre bar). Inside:
   - glass facades: the glass colour, darker in the spandrel below 0.9 m, brighter toward the top;
   - shop windows and doors: a lit interior (pale walls getting darker downward, shelf lines and coloured goods in the upper part of shop windows);
   - other windows: glass reflecting sky (brighter at the top) with a hint of curtain at the sides.
5. **Bare wall** by kind (real-world sizes, joints at least a pixel wide so they survive 32 px a metre):
   - brick: 230 x 76 mm bricks with 10 mm mortar, stretcher bond, each brick a slightly different tone, light mortar;
   - weatherboard: 150 mm boards, a shadow line under each lap;
   - fibro: 1.2 m sheets behind cover strips;
   - render: plain with faint staining;
   - cladding: vertical 140 mm boards with grooves, each board a slightly different tone;
   - corrugated: vertical ribs (every other rib of 76 mm pitch, so it doesn't alias);
   - panel: 3 m by one-storey precast panels with joints;
   - glass: the trim colour (mullions and spandrels);
   - lattice: diagonal timber lattice over a dark void.
   A low-frequency stain noise and per-pixel grain vary every finish slightly.

### Roof texture

128 x 128 px for 2 m x 2 m:
- tile (terracotta): rolled tiles in rows of about 0.33 m, joints staggered row to row, each tile its own fire, a darker joint;
- ctile: flatter, wider tiles, a hard shadow under each row;
- membrane: 1 m sheets with welded seams and weathering mottle;
- gravel: speckle;
- metal: fine corrugations running down the slope plus faint mottle.
Grain on all of them.

## Dressing (`dressBuilding`)

**Inputs:** known height (only if OSM actually gave one; a guess must be passed as unknown), OSM `building` kind, footprint area, the class of a point of interest inside it, the roof finish seen in the photo, whether it's in Queensland, whether the footprint is a rectangle, whether it's on the street front (setback under 15 m), and a seed. The pipeline seeds from the centroid, so the same building looks the same every build.

**Output:** the dress fields (see the building record in buildings.md).

Rules, first match wins. "Photo roof" means use the photo's finish when known, else pick from the list given.

1. **Halls:** kind church, chapel, cathedral, school, civic, public, hall; or a POI place_of_worship, school, college, kindergarten, community_centre, town_hall. Hall facade (brick or cream brick). Rectangle: gable, photo roof from terracotta, tile_red, manorred, zinc. Else flat (membrane about two times in three, otherwise gravel). Pitch 30. Height the known height, else 5.5, capped at 9.
2. **Towers:** known height 30 m or more, or office/commercial at 18 m or more. Glass (always for office/commercial, else 45%) as a tower with a glass facade; otherwise apartments. Flat roof, height known or 40, parapet 1.2.
3. **Mid-rise:** known height 9 m or more, or apartments, residential, dormitory, hotel, office over 300 m^2. Type: office for office; for apartments/residential/dormitory 60% apartments, else flats; otherwise weighted apartments 5, office 3, flats 2. Shops below if a shop-like POI is inside, or (not flats) fronted and 35%: a shopfront ground floor, awning if fronted. Flats on a rectangle: half the time a hip roof with tiles; else flat with a 0.9 m parapet. Height known, else storeys (3 for flats, 5 otherwise) times the layout's storey, plus 1 m if shops below. Pitch 20.
4. **Shops:** a shop-like POI inside, or kind retail, commercial, kiosk, supermarket. Two storeys if known height over 6.5 or 30%: upper facade over a shopfront; else a single shopfront. Flat roof (photo roof from zinc, surfmist, shalegrey), height 7.2 or 4.2, parapet 1.1, awning if fronted.
5. **Warehouses:** kind industrial, warehouse, manufacture, factory, hangar, barn, farm_auxiliary, or area over 700 m^2. Shed or tilt-up facade (tilt-up weighted double). Rectangle: gable at pitch 6 with a metal photo roof; else flat. Height known, clamped 5 to 10 (7 if unknown). Garage door.
6. **Sheds:** kind garage, garages, shed, carport, hut, cabin, roof, or area under 30 m^2. Shed facade; rectangle: gable or skillion; else flat; pitch 10; height 2.4.
7. **Mid-size low building on the street:** over 350 m^2 and fronted, half the time a single-storey shop with an awning.
8. **Houses:** weighted style: brick 34, modern 16, weatherboard 14, fibro 7, Queenslander 16 (only in Queensland), townhouse 9 (only over 140 m^2). Two storeys for townhouses, or (not Queenslander or fibro) over 150 m^2 and 25%: wall height 5.7, else 2.7.
   - Queenslander: Queenslander facade; rectangle: hip 70% / gable; metal roof (photo roof if it's metal); pitch 30; height 2.9; stumps 1.6 to 2.4 m with white (70%) or green lattice; verandah if fronted.
   - Modern or townhouse: modern facade; rectangle: weighted skillion 4, flat 3, hip 2, gable 1; flat roofs membrane/gravel with a 0.5 m parapet, others a metal photo roof; pitch 6 for skillion, else 20.
   - Brick, weatherboard, fibro: that style's facades; rectangle: hip 68% / gable; brick roofs from tiles or the first six metals, others metal; pitch 22 for brick under a tile photo roof, else 20. Weatherboard fronted: verandah 40%.

The pipeline keeps a garage flag the building already had if the dress doesn't set one. `houseLooks.ts` can override facade and other fields afterwards.

## Call sites

- `src/core/track.ts`: `dressBuilding` (per kept building, seeded by centroid), `FACADES`, `facadeTexture`, `ROOF_COLOURS`, `roofTexture` (for used finishes; also shop and spec-house textures and the verandah texture).
- `src/core/buildings.ts`: `FACADES`, `LAYOUTS`, `PITCHED`, `ROOF_COLOURS`, `Dress`, `Layout`.
- `src/core/houseLooks.ts`: `FACADE_INDEX`, `FACADES`. `src/core/specHouse.ts`: `ROOF_COLOURS`, `Facade`, `WallKind`. `src/core/landmarkLayer.ts`: `ROOF_COLOURS`, `facadeTexture`, `roofTexture`.
- Uses `rng` (scenery) and `fill`, `valueNoise` (textures) and the PNG encoder.
- Tests now: `test/buildingStyles.test.ts`, `test/buildings.test.ts`, `test/specHouse.test.ts`, `test/houseLooks.test.ts`.

## Edge cases

- Known height 0 or missing vs a guessed height: the pipeline must pass unknown for a guess (it does: vector-tile `render_height` 5 is treated as a guess).
- Photo roof on a flat-roofed type: halls and shops use it; flat towers ignore it.
- Queenslander with a non-metal photo roof: falls back to a random metal.
- A weighted draw where all weights for a style are 0 (not possible with brick always present).
- Facade names containing surface keys (`sand`): buildings.md makes mesh names safe.

## Test list (write fresh)

1. Every layout's openings fit inside its period and storey; plain bands inside the storey.
2. Facade names are unique; the index map round-trips; every facade's layout exists.
3. `PITCHED` excludes membrane and gravel and includes the fork greens.
4. Facade textures: dimensions are period x storey at 32 px/m rounded to multiples of 4; same bytes twice; a window's centre pixel differs from the wall; brick shows mortar lines; a shopfront has the sign colour in its sign band.
5. Roof textures: 128 x 128; same bytes twice; terracotta mostly red, membrane near its grey.
6. Dressing, one per rule: a church is a hall; a 40 m tower; an office at 20 m is glass; apartments at 12 m; a cafe POI gives a shop with an awning when fronted; a 900 m^2 unknown building is a warehouse with a garage; a 20 m^2 one a shed; a plain 150 m^2 house is a house with a pitched roof when rectangular, flat when not.
7. Queenslanders never outside Queensland (many seeds); sometimes inside it, always with stumps and lattice.
8. Same info and seed give the same dress; different seeds vary facades.
9. The photo roof is used where the rules say so.

## Could be deleted instead of rewritten (for Mac)

- **Queenslander type** (its layout, four facades, two lattice facades, stumps, raised decks in buildings.md). Only chosen in Queensland; never in WA. Delete it all.
- **Glass towers and the curtain layout** (towers need 30 m of mapped height, or an 18 m office). Probably nothing in the South West qualifies. Cheap to keep; delete if Mac wants a smaller module.
- **Fibro facades** are real in old WA towns; keep.
