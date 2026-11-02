# Collie Motorplex

**Tier:** showcase (a real circuit). **Route:** `routes/collie-motorplex.json`. **Build:** `out/collie_motorplex.zip`.

The Collie Motorplex circuit east of Collie. OSM maps it as `highway=raceway`, "Collie Race Track", asphalt: a 1.62 km closed loop (way 89374807), plus a 1.3 km southern extension (way 733256017) for the longer layout. A loop with no banking and no traffic.

## Status

- **Built** 31 Oct; every check passes, 0.24M triangles. Two layouts: Long (with the southern extension, the main one) and Short.
- **Routing:** the centreline comes straight from the OSM raceway ways (`"ways"` in the route file), since OSRM won't drive raceways. Races anticlockwise.
- **Markings:** a raceway (`raceway`, set from the OSM ways): edge lines and start/finish only, no centre line, no reflectors.
- **Start/finish:** the real spot isn't known yet; the track starts at the first pin. Pins follow the OSM way's order.
- **Heights:** not on GA's 5 m LiDAR (well east of the tiled area); about 30 m global heights. A circuit wants better: GA's ELVIS portal may have LiDAR for Collie.
- **In game:** not driven yet; retest 6 checks the pit lane on both layouts.

## Next

1. A drive on both layouts.
2. Check the racing direction; move the grid, pits and start/finish to the real spot.
3. Better heights.
