# Busselton

**Tier:** showcase. **Route:** `routes/busselton.json`. **Build:** `out/busselton.zip`.

The Foreshore and the town centre as one area, with every street drivable. Layouts:
- Foreshore (4.3 km circuit)
- Town (2.2 km loop)
- Sights (a loop past the landmarks)
- Free Roam (spawns in the ten biggest car parks)

## Status

- **Base:** accepted 30 Oct (`base.json`): all checks pass, 1.39M triangles of 1.5M. The built area now takes in the jetty precinct.
- **Inputs:** frozen in `snapshot.json`.
- **Landmarks** ([docs/landmarks.md](../../docs/landmarks.md)):
  - in the base: the jetty precinct (`jetty.ts`)
  - as layers (22): Rocky Ridge, the Esplanade Hotel, The Goose, the Old Courthouse group, the Hilton Garden Inn, the Visitor Centre, the Busselton Museum, Kyst and Sandbox, Sea Play on the Bay, Transition, the yacht club, Orana Cinemas, The Tav, the Ship Inn, the Banksia Tavern, St Mary's, the Pioneer Cemetery, the fire station, the bowling club, Victoria Square, Mitchell Park, the Japanese garden gate
  - a Blender detail layer for Transition (`routes/layers/`), not wired in yet
- **Since the accepted base:** the yacht club's area polygon, the new landmarks, keep-left AI, traffic zones, Pure tuning, waving flags, the jetty train, green Colorbond roofs. These need a base upgrade (`base.mjs build`, then the checks) before they're accepted.
- **In game:** `docs/workstation-retest-2.md` is the next workstation run.

## Next

A base upgrade with everything above; the landmarks seen in game; houses from Mac's photo walk.
