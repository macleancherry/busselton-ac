# Collie Motorplex

**Tier:** showcase (a real circuit). **Route:** `routes/collie-motorplex.json`. **Build:** `out/collie_motorplex.zip`.

The Collie Motorplex circuit east of Collie. OSM maps it as `highway=raceway`, "Collie Race Track", asphalt: a 1.62 km closed loop (way 89374807), plus a 1.3 km southern extension (way 733256017) for the longer layout. A loop with no banking and no traffic.

## Status

- **Routing:** the centreline comes straight from the OSM raceway ways (`"ways"` in the route file), since OSRM won't drive raceways. Long layout (with the southern extension) is the main one; Short is a second layout. Races anticlockwise. The start/finish line still needs placing on the main straight.
- Pins follow the OSM way's order; the racing direction isn't checked yet.
- **Heights:** not on GA's 5 m LiDAR (well east of the tiled area); about 30 m global heights. A circuit wants better: GA's ELVIS portal may have LiDAR for Collie.

## Next

1. Route from the raceway way, then build.
2. Check the racing direction; set the grid, pits and start/finish.
3. The extension as a second layout.
