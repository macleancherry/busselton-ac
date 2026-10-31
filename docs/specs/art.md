# Spec: sign artwork atlas (`src/core/art.ts` and `src/services/art.ts`)

Status: spec for a clean rewrite ("Owning the code", ROADMAP.md). Write both new modules from this page, without the old files open. Tests are written fresh from "Tests to write". Both files are on `UPSTREAM-FILES.txt`.

## What the modules are for

Every sign with text or a printed face (street name blades, shop and attraction signs, traffic signs, timing-gate signs, race-day banners and flags) is drawn into **one texture atlas**, `signart.png`, used by one alpha-tested material `signart`. Drawing text needs fonts, which the build core (`src/core`, no DOM, runs in Node tests) doesn't have. So the work is split:

- **`src/core/art.ts`** (core, no DOM): the types, and a list that collects what the build needs, deduplicated by key. The core never draws.
- **`src/services/art.ts`** (browser worker): `renderArt`, which draws every requested piece with a 2D canvas (`OffscreenCanvas`), packs them into one atlas, and returns the PNG plus where each piece landed (UVs) and its shape (aspect).

The build passes `renderArt` to `buildTrack` as `DataSources.renderArt`; without it, signs are left out (tests pass a fake renderer).

## Core module: `src/core/art.ts`

### Exports (keep names and shapes)

```ts
type ArtKind =
  | "street" | "poi" | "tourist" | "speed" | "stop" | "giveway" | "warning" | "chevron"
  | "noentry" | "keepleft" | "bus" | "info" | "back" | "gate" | "banner" | "feather" | "lights" | "flag";

interface ArtRequest { key: string; kind: ArtKind; text?: string; colour?: string; ink?: string; }
interface ArtCell { u0: number; v0: number; u1: number; v1: number; aspect: number; }
interface ArtAtlas { data: Uint8Array; cells: Record<string, ArtCell>; }
type ArtRenderer = (items: ArtRequest[]) => Promise<ArtAtlas>;

class ArtList {
  add(r: ArtRequest): string;   // returns r.key
  get list(): ArtRequest[];
}

const streetKey: (name: string) => string;   // `street:${name}`
```

Field meanings:
- `ArtRequest.key`: unique identity of a piece of art; pieces of geometry refer to art by this key. `text` is what the art shows (or a hint, per kind below). `colour`: CSS colour, the panel colour for `poi` and the background for `banner`/`feather`. `ink`: CSS colour of sponsor lettering (`banner`, `feather`).
- `ArtCell`: UVs of the piece in the atlas, **v = 0 at the top of the image**, `u0 < u1`, `v0 < v1`, all in [0, 1]; `aspect` = width / height of the artwork in pixels (geometry uses `width = height_m * aspect`, so aspect sets the real proportions of every sign in game).
- `ArtAtlas.data`: a PNG file with alpha (sign shapes are cut out; the material is alpha-tested).

### Rules

1. `ArtList.add(r)`: if no request with `r.key` is held yet, store `r`; if one is, keep the **first** and ignore the new one (even if its kind/text differ). Always return `r.key`.
2. `ArtList.list`: the held requests in **first-added order** (a fresh array each call).
3. `streetKey(name)` = `"street:" + name` exactly (furniture.ts and tests build keys with it).

### Callers (grep, 31 Oct 2026)

- `src/core/track.ts`: `new ArtList()` (line ~1486), passes it to furniture/race dressing; if `sources.renderArt` and `art.list.length > 0`, calls `renderArt(art.list)`, pushes texture `signart.png` = `atlas.data` and material `signart` (ksPerPixelAT, alpha-tested; ambient 0.55, diffuse 0.45, specular 0.15, exp 20), then `buildPieces(pieces, atlas)`. `DataSources.renderArt?: ArtRenderer`.
- `src/core/furniture.ts`: imports `streetKey`, `ArtAtlas`, `ArtCell`, `ArtList`. `buildPieces` looks up `atlas.cells[key]`; a piece whose key has no cell is skipped. Faces that aren't two-sided use cell `"back"` mirrored on the back (u1 and u0 swapped).
- `src/core/raceDress.ts`: `ArtList` (banners, feathers, flags, gate, lights).
- Tests: `streets`, `kangaroo`, `raceDress`, `poleSpot`, `flags`, `furniture`, `gates`, `sceneGround` (fake renderers returning 4 x 4 PNGs and full-atlas cells).

### What gets requested today (key, kind, text)

| Producer | Key | Kind | text / colour |
| --- | --- | --- | --- |
| furniture `streetSigns` | `street:<name>` (via `streetKey`) | street | street name |
| furniture (always when furniture is built) | `back` | back | |
| furniture bus stops | `bus` | bus | |
| furniture POIs (`landmarks`) | `tourist:<text>` | tourist | name |
| furniture POIs | `poi:<cls>:<text>` | poi | name; colour from furniture's POI_COLOUR table, default `#36414d` |
| furniture `signArt` (Mapillary sign values) | `speed:<n>` | speed | the number, e.g. "60" |
| | `stop`, `giveway`, `noentry`, `keepleft` | same | |
| | `chevron:left` / `chevron:right` | chevron | "left" / "right" |
| | `warning:<slug>` | warning | slug from `/^warning--(.+?)(?:--\|$)/` of the Mapillary value, e.g. `curve-left` |
| furniture kangaroo signs (country) | `warning:kangaroo` | warning | "kangaroo" |
| furniture `gateSigns` (point to point) | `gate-START`, `gate-FINISH` | gate | "START" / "FINISH" |
| raceDress (only with `raceDress`, off by default) | `banner:<k>`, `feather:<k>` | banner, feather | sponsor name, colour = bg, ink |
| raceDress | `flag:yellow`, `flag:chequered` | flag | "yellow" / "chequered" |
| raceDress | `lights` | lights | |
| raceDress | `gate-FINISH` | gate | "FINISH" |

**Never requested:** kind `info`; flag texts `green` and `blue`. See "Could be deleted".

## Service module: `src/services/art.ts`

### Export

```ts
async function renderArt(items: ArtRequest[]): Promise<ArtAtlas>
```

Caller: `src/services/pipeline.ts` passes it as `renderArt` in the `DataSources` it gives `buildTrack`. Runs in the build Web Worker (headless Chromium for headless builds), so `OffscreenCanvas` and `convertToBlob` are available. Not called from Node.

The old function also attached the canvas to the result (`{ ...atlas, canvas }`); nothing reads it. Don't return it.

### Atlas layout (contract; keep exactly)

1. Atlas width `W = 2048` px.
2. Each request gets a box of fixed pixel size by kind (table below). Only `street` depends on its text.
3. Sort boxes by height, tallest first; ties keep request order (a stable sort).
4. Shelf packing: cursor `x = 4`, `y = 4`, current row height `row = 0`. For each box: if `x + w + 4 > W`, start a new row: `x = 4`, `y += row + 6`, `row = 0`. Place the box at (x, y). Then `x += w + 6`, `row = max(row, h)`.
5. Atlas height `H`: the smallest power of two ≥ 64 with `H ≥ y + row + 4` (after the last box).
6. Cells, half a pixel in so filtering doesn't bleed neighbours: `u0 = (x + 0.5) / W`, `u1 = (x + w - 0.5) / W`, `v0 = (y + 0.5) / H`, `v1 = (y + h - 0.5) / H`, `aspect = w / h`.
7. Cells keyed by `request.key`. If the same key appears twice in `items` (ArtList prevents it), the later one's cell wins; drawing both is harmless.
8. Background is fully transparent; each box draws only its sign shape (pixels outside a round/triangular sign stay alpha 0).
9. Output: the canvas encoded as PNG (`convertToBlob({ type: "image/png" })`). Using our own `encodePng` (docs/specs/png.md) on `getImageData` is also fine and makes the bytes independent of the browser's encoder.
10. Empty `items`: return a valid 2048 x 64 transparent PNG and `{}` cells (track.ts never calls it empty, but don't throw).

### Box sizes (w x h px; contract, they set sign proportions in game)

| Kind | Size |
| --- | --- |
| street | h = 64; w = clamp(ceil(textWidth) + 48, 220, W - 8 = 2040), textWidth = width of the UPPERCASED name in `bold 44px` of the sign font |
| poi, tourist | 384 x 160 |
| speed | 160 x 192 |
| stop | 160 x 160 |
| giveway | 160 x 140 |
| warning | 160 x 160 |
| chevron | 128 x 160 |
| noentry | 160 x 160 |
| keepleft | 128 x 160 |
| bus | 128 x 160 |
| info | 160 x 160 |
| gate | 480 x 150 |
| banner | 768 x 128 (6:1) |
| feather | 128 x 448 |
| lights | 320 x 128 |
| flag | 160 x 112 |
| back | 32 x 32 |

### Text rules

- Sign font stack: `"Arial Narrow", "Helvetica Neue", Arial, sans-serif`. Weight `bold` (sponsors: `italic bold`).
- **Fit rule** (used wherever text must fit a width): start at the kind's base size; while the measured width exceeds the max width and size > 10, reduce by 2 px. Text is centred (`textAlign = center`, `textBaseline = middle`) unless stated. If it still doesn't fit at the floor, the old code let it overflow; better: at the floor, squeeze horizontally (scale x by maxW / width) so nothing spills outside its box.
- **Two-line rule** (poi, tourist): if the text is longer than 16 characters and contains a space, split it at the space nearest the middle (`length / 2`; on a tie, the first such space) into two lines. Base size 52 for two lines, 64 for one; max width `w - 48`; both lines use the smaller of the two fitted sizes; line centres at `y + h/2 + (i - (n-1)/2) * size * 1.05`.

### What each kind shows (draw fresh; colours are the contract, layout is guidance)

Australian-style signs (AS 1742). Pixel-identical output isn't required; keep each sign recognisable at the sizes above, colours as given, and the shape filling its box.

- **street**: blue `#1c3f94` rectangle filling the box; white `#fff` inset border (4 px line, 5 px in); name UPPERCASED in white bold, base 44 px, fitted to `w - 40`, centred (2 px below the middle).
- **poi**: rounded rectangle (radius 14) in `colour` (default `#2d3a4a` if none given); white inner rounded border (`rgba(255,255,255,0.9)`, 5 px line, 8 px in, radius 10); name in white per the two-line rule.
- **tourist**: as poi, panel brown `#6b3d1f` (ignores `colour`).
- **speed**: white rounded plate (radius 12, 2 px in) with a 3 px `#222` outline; red `#d0201a` ring (16 px line, radius 66) centred on the plate; the number in black `#111` bold, base 68, fitted to 96 px, centred slightly below the middle.
- **stop**: red `#c8102e` regular octagon (flat top: vertices at π/8 + kπ/4, radius 78 about the box centre) with a 6 px white edge; "STOP" in white bold 50 px, centred.
- **giveway**: point-down triangle, red `#c8102e` outer (top corners 4 px in, point 4 px from the bottom), white inner triangle; "GIVE" / "WAY" in black bold 20 px on two lines in the upper white area.
- **warning**: yellow `#f6c700` diamond filling the box (2 px in) with a 6 px black `#111` edge; a black symbol (12 px round-capped strokes unless noted) chosen from `text` by the first matching rule:
  1. contains `curve-left`, `turn-left` or `winding`: a curve bending to the left (rising stroke that hooks left at the top);
  2. `curve-right` or `turn-right`: the mirror image;
  3. `crossroads` or `intersection`: a plus (vertical and horizontal bars);
  4. `roundabout`: a near-full circle (radius ~24) with a small arrow tick;
  5. `traffic-signals`: a signal head outline (thin 4 px rectangle) with red `#d0201a`, amber `#f6a700` and green `#1b8a3a` lamps top to bottom;
  6. `kangaroo`: a filled kangaroo silhouette hopping right (body, head, ear, neck, long tail behind, leg and foot, small arm), the Australian W5-29 look;
  7. `pedestrian`: a walking figure (head, body, two legs);
  8. otherwise: an exclamation mark (vertical bar and a dot).
- **chevron**: yellow `#f6c700` rectangle; one black chevron (26 px stroke, mitred) pointing left when text is `"left"`, right otherwise.
- **noentry**: red `#c8102e` disc (radius 76) with a white horizontal bar (104 x 24) across the middle.
- **keepleft**: white rounded plate (radius 10) with a 4 px black outline; a thick (14 px) black arrow pointing down-left (Australian R2-3).
- **bus**: white box with a blue `#1c3f94` panel 6 px in; "BUS" (bold 40) above "STOP" (bold 30) in white.
- **info**: blue `#1c3f94` rounded square (radius 12); `text` (or "i" when empty) in white bold, base 60, fitted to 140.
- **gate**: text "START": green `#1d7a3a` panel; "FINISH": black `#111` panel with a chequered band (20 px squares, two rows, `#111` / `#f4f4f4`) along the top and the bottom. Both: a 6 px `#f4f4f4` border 3 px in; the word in `#f4f4f4` bold, base 90 (START) or 60 (FINISH), fitted to 420, centred.
- **banner**: band of `colour` (default `#c8102e`); two 4 px stripes of `ink` (default `#fff`) near the top and bottom edges; the name UPPERCASED in `ink`, italic bold, base 88, fitted to `w - 60`.
- **feather**: feather-flag shape in `colour` (default `#c8102e`): straight pole edge on the left, rounded top, the free edge tapering down the right; the name UPPERCASED in `ink` (default `#fff`), italic bold, base 56, fitted to `h - 120`, running up the flag (rotated -90°).
- **lights**: black `#111` rounded panel (radius 10); two rows of five lamps (radius 22, 60 px apart): top row lit red `#e0261b`, bottom row dark `#3a0d0b`.
- **flag**: `"chequered"`: 8 x 6 squares `#111` / `#f4f4f4` filling the box; otherwise a flat flag: yellow `#f4d000` (also the fallback for unknown text), green `#1f9a3a`, blue `#1f4fbf` (blue gets a yellow diagonal stripe).
- **back**: flat grey `#9a9ea3` square.

## Bugs and weak spots (fix, don't copy)

1. **Font isn't pinned.** Street blade widths come from `measureText` of a system font. A machine without Arial Narrow/Arial falls back to another sans-serif, so the same build gives different blade widths (aspects) on different machines, and the atlas differs. Fix: load one bundled open-licence font (e.g. an OFL condensed sans) with `FontFace` in the worker before drawing, and use it for every kind. Check the licence fits the repo rules (CLAUDE.md, "Data rules").
2. **Overflow at the size floor** (fit rule above): squeeze instead of spilling.
3. **Returned canvas** (`canvas` on the result): unused; drop it.
4. **Draw state leaks between boxes**: wrap each box's drawing in save/restore (the old code did) so line width, caps and fonts never carry over.
5. **No height limit.** Hundreds of distinct street names could make a very tall atlas. Not seen in practice (Busselton is well under 2048 x 2048). Add a guard: if `H > 8192`, throw a clear error naming the count of requests (a silent giant texture is worse).
6. Duplicate drawing code: `src/services/signs.ts` (fork) draws shop signs with its own canvas text code. The rewrite may share a small text helper with it, but don't merge the modules.

## Could be deleted (lead checks with Mac)

- **Kind `info`**: nothing requests it. Delete from `ArtKind` and the renderer.
- **Flag texts `green` and `blue`**: race dressing only asks for `yellow` and `chequered`. Keep the chequered and yellow flags; drop green and blue.
- **Race-day kinds** (`banner`, `feather`, `lights`, `flag`, and the FINISH gate's use by raceDress): only used when `raceDress` is on, which is off by default (ROADMAP: race dressing is "rewrite or delete, Mac's call"). If race dressing goes, these kinds go with it. `gate` stays (point-to-point timing gates use it).

## Tests to write

Core (Node, `test/art.test.ts`):
1. `ArtList.add` returns the key; adding the same key twice keeps the first request (different text second time is ignored); `list` is in first-added order and a fresh array.
2. `streetKey("Kent St") === "street:Kent St"`.

Service: split the layout from the drawing so it can be tested in Node. Suggested shape: a pure `layoutArt(items, measure: (text, font) => number): { width, height, placed: {key, x, y, w, h}[], cells }` used by `renderArt`. Then:
3. Box sizes per kind match the table; street width = clamp(measured + 48, 220, 2040) with a fake `measure`.
4. Packing: tallest first, stable for ties; first box at (4, 4); 6 px gaps; a row wraps when `x + w + 4 > 2048`; the next row starts at `y + rowHeight + 6`.
5. Height is the smallest power of two ≥ 64 covering the last row plus 4; one small box gives 64; enough boxes give 128, 256...
6. Cells: half-pixel insets, `aspect = w / h`, all UVs inside [0, 1], `u0 < u1`, `v0 < v1`; no two cells overlap.
7. A 2040 px street box fits on a row by itself (no wrap loop, no negative space).
8. Two-line split: "Busselton Jetty Interpretive Centre" splits at the space nearest the middle; a 16-character name stays one line; a long single word stays one line.
9. Duplicate key in `items`: one cell, the later one.
10. Empty input: 2048 x 64, no cells.

Browser (headless Chromium via the existing Playwright setup, or skip when unavailable):
11. `renderArt` on one request of every kind returns a PNG that decodes (`decodeOwnPng` if it's our encoder, or the browser's) to W x H; every cell's centre pixel is opaque; pixels in the gap between two boxes are transparent; the corners of the stop, giveway, warning and noentry boxes are transparent.
12. Same items twice give identical bytes (with the bundled font).

Integration (existing tests keep passing): furniture, gates, kangaroo, streets, raceDress, poleSpot, flags, sceneGround.

## Rewrite notes (31 Oct 2026)

- `src/services/art.ts` exports the pure `layoutArt(items, measure)`, `boxSize`, `splitLines`, `fitSize` (Node-tested) and `renderArt`, which encodes with our own `encodePng`.
- Fixed: squeeze at the size floor, save/restore and a clip per box, no returned canvas, 8192 px height guard. A key requested twice gets the later request's cell (cells are assigned in request order).
- Kept for now (Mac's call): kind `info`, green and blue flags, race-day kinds.
- **Later:** text is still measured and drawn with the system font stack (Bugs 1). Bundle an open-licence condensed font and load it with `FontFace` so blade widths are the same on every machine; then add browser tests 11 and 12.
