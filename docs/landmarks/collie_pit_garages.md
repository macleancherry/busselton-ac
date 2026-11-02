# Collie Motorplex pit garages

## What it is

The pit garages at Collie Motorplex, in the paddock inside the north loop of the circuit, east of the main straight. The venue lists "42 undercover pit bays". This is the main run: a row of old steel sheds with front-facing gables and a deep verandah over the open bays, facing the paddock road. Spec: `routes/landmarks/collie_pit_garages.json`.

## Footprint

Measured from the Landgate aerial (centre 116.24385,-33.43085, half 50 m, 0.098 m/px), rotated 16° so the front is square to the grid (`colliem/shed_rot.jpg` in the session scratchpad). Single storey, so lean is small. About ±0.7 m.

- **Orientation:** the front runs NNE-SSW (bearing about 16°) along the paddock road and **faces WNW (bearing 286°)**. Gable ridges run front to back (bearing 106°).
- **Middle of the main blocks:** **116.243974, -33.430932**.
- **Size:** about 59 m along the front and 28 m deep, plus a 9 m verandah in front of the first 52 m.
- **Blocks, north to south** (x along the front, y back from the gable fronts):
  - gable 1: x 0.2-15.5, 25.5 m deep
  - a 2 m box-gutter strip, then gable 2: x 17.5-32.1, 22.8 m deep, with a low flat annex behind it (y 22.8-29)
  - a smaller, lower gable: x 32.1-38, 19.4 m deep
  - gable 3: x 38-53, 28 m deep
  - a narrow gable at the south end: x 53-59, beyond the verandah
- **Verandah:** a skillion about 9 m deep from the gable fronts to the posts, x 0-52. Triangular shadows of the gable ends fall across it in the aerial.
- **Setback:** the verandah posts stand at the edge of the paddock road (asphalt, about 9 m wide). About 67 m from the main straight's edge at the nearest point and 126 m at the farthest.

## Walls and roof

From two 2024 event photos taken in the paddock (a row of cars under the verandah, and the paddock looking north). Hex values are approximate.

- **Gable ends:** cream corrugated iron `#E4E0D1`, with teal-green barges and fascias `#2F5D57`.
- **Back wall of the bays:** dark face brick `#6E4B3C`, with grey roller doors `#B5B8B6`. Brick piers stand at the gable valleys.
- **Roof:** pale zincalume or light grey Colorbond `#C9CBC7`, about 22°.
- **Verandah:** pale steel sheet on galvanised posts about 4.3 m apart (one bay each), with bay labels like "A9" and "A10" at the top of each post.
- **Height:** walls about 4 m to the eaves, gable apexes about 7 m. The verandah is about 3 m at the posts and 3.8 m at the wall.
- **Signage:** none seen on the sheds apart from the bay labels and toilet signs. None modelled.

## Grounds

- Concrete under the verandah. The paddock road in front is asphalt with parking lines further south.
- Tall eucalypts, sheds and containers behind (east). A separate shed stands about 10 m south of the run.
- The amenity buildings (brick, hip roofs) stand across the paddock road to the west. They are not part of this spec.

## What a driver sees

From the main straight it is mostly hidden behind the race tower, clubrooms and trees. It is the backdrop of the paddock: a sawtooth of cream gables over a long dark verandah full of cars.

## Unsure

- The number of gables. The aerial shows four main roof sections and a small one. The photos show a big gable next to a smaller one, so some sections may be pairs of narrower gables.
- Where the other 30 of the 42 bays are. Possibly the shed to the south, or bays inside the sheds.
- Posts are drawn in the trim colour (teal). The real posts are galvanised grey.

## Sources

- Landgate Locate aerial (Oct 2026), via the session's `aerial.mjs`
- Barbagallo Motors, Passione Ferrari Collie Motorplex 2024 (photos of the pit verandah and the paddock): https://www.barbagallo.com.au/passione-ferrari-collie-motorplex-2024/
- Collie Motor Sport Club, track page (42 undercover pit bays, race tower, pedestrian bridge): https://colliemotorsportcomau.r6d.dev/
- Renders: `out/landmark_renders/collie_pit_garages_street.png`, `_aerial.png`
