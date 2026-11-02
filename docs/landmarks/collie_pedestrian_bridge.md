# Collie Motorplex pedestrian bridge

## What it is

The footbridge over the main straight. The club lists "a pedestrian bridge for competitors and spectators". It's the only structure over the track, so it does the job a start gantry does elsewhere: the landmark you see at the end of the straight. Spec: `routes/landmarks/collie_pedestrian_bridge.json`.

## Footprint

From the Landgate aerial (centre 116.24357,-33.42990, half 130 m, 0.254 m/px), rotated 38° (`colliem/straight_rot.jpg`). Cross-checked on a 0.234 m/px tile. About ±1 m.

- **Orientation:** square to the straight. The long axis runs bearing 128° to 308°. Modelled facing **38°**, up the straight towards oncoming cars.
- **Middle:** **116.243021, -33.430472** (about 5 m east of the centreline, because the span is off-centre).
- **Size:** about 47 m long and 3.8 m wide, from the outfield past the west wall to the paddock lawn behind the east fence.
- **Distance:** about 45 m after the start line, in the racing direction.

## Structure

Seen from above only. The roof or deck shows as grey sheeting with regular darker panels.

- **Modelled:** a deck about 5.4 m up, 1.15 m solid side panels, a light grey roof on short posts at 8 m, and a straight stair down at each end. The four legs stand at the west wall line and in the east runoff, at least 5 m from the track edge.
- **Physics:** only the legs and the stair posts are solid. The deck, sides and roof have no collision, and they are well above any car.
- **Colours:** grey steel `#8E9497` with a pale roof `#CFD2D1`.
- **Signage:** "COLLIE MOTORPLEX" in plain white lettering on a navy board, on both sides. This is invented: the real bridge may carry sponsor banners or nothing.

## What a driver sees

The end of the main straight: a grey covered bridge across the track, with the race tower and the sails on the left just before it.

## Unsure

- The deck height and the stairs. Real stairs may turn, or be ramps or stair towers.
- Whether it is covered (a roof) or the grey panels are the deck and truss seen from above.
- Ground under the ends: the landmark sits on the ground at its middle (the track). If the outfield or lawn is much higher or lower, the stairs and legs will float or sink.

## Sources

- Landgate Locate aerial (Oct 2026)
- Collie Motor Sport Club, track page: https://colliemotorsportcomau.r6d.dev/
- Renders: `out/landmark_renders/collie_pedestrian_bridge_street.png`, `_aerial.png`
