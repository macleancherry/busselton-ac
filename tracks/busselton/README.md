# Busselton

**Tier:** showcase. **Route:** `routes/busselton.json`. **Build:** `out/busselton.zip`.

The Foreshore and the town centre as one area, with every street drivable. Layouts:
- Foreshore (4.3 km circuit)
- Town (2.2 km loop)
- Sights (a loop past the landmarks)
- Free Roam (spawns in the ten biggest car parks)

## Status

- **Base:** accepted 2 Nov (`base.json`, commit 0fcd945, snapshot busselton-2026-10-30): every check passes, 1.38M triangles of 1.5M, AI off the road 0% on every layout.
- **Inputs:** frozen in `snapshot.json`.
- **Landmarks** ([docs/landmarks.md](../../docs/landmarks.md)):
  - in the base: the jetty precinct (`jetty.ts`) and the swimming jetty, built low (`swimJetties`)
  - 37 spec landmarks (`routes/landmarks/looks.json`), including Saltwater, ArtGeo, the Weld Theatre, the Fire Station bar, the surf club, Busselton Central's four faces, four roadside pylons and Signal Park's toilets (all 2 Nov)
  - Blender layers (`routes/layers/`): Transition, Sea Play's ship, Rocky Ridge's pergola, Shelter Brewing Co, the Settlement Art bronzes
- **Course markings** on Foreshore, Town and Sights (`build.courseMarks`): closed side streets and ring exits, roundabout chevrons and arrow boards, grid boxes, start line and START FINISH arch. Free Roam has none. Marked layouts ship without traffic.
- **Also in the base:** 35 named shops on Queen St (`shopNames`, the Overpass shop query), the sea and beach from the photo with the wet sand strip (`photoSea`, `beachDetail`), no trees on the shore, AI slow through roundabouts (`aiRings`), keep-left AI, traffic zones.
- **Road core trial:** a build with `networkCore` on passes every check (1.45M triangles); it's not the base. It goes to the workstation as `busselton_roadcore.zip`.
- **In game:** [docs/workstation-retest-6.md](../../docs/workstation-retest-6.md) is the next workstation run (3 Nov).

## Next

Retest 6 and Mac's drive: the course markings, the new landmarks (Saltwater, the surf club and the Busselton Central entries are partly guesses), and the road core trial against the base. Then houses from Mac's photo walk.
