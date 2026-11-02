# Cape Naturaliste Road

**Tier:** drive-anywhere base (showcase later, with the lighthouse). **Route:** `routes/cape-naturaliste.json`. **Build:** `out/cape_naturaliste_road.zip`.

Cape Naturaliste Road (Tourist Drive 250) from the north edge of Dunsborough, past the Eagle Bay turn-off and up onto the cape through coastal heath and peppermint, to the lighthouse car park. Point to point, about 11 km. The one-way loop at the car park is left out.

## Status

- **Built** 31 Oct; every check passes, 1.04M triangles. The route ends in the lighthouse car park.
- **Landmarks:** the lighthouse is the Blender layer (`routes/layers/cape_naturaliste_road/cape_naturaliste_lighthouse.kn5`, from `scripts/blender/landmarks/cape_naturaliste_lighthouse.py`); the keepers' cottages are a spec. Both stand on a landmark patch of detailed ground off the road. The lighthouse's spec (`routes/landmarks/cape_naturaliste_lighthouse.json`) is kept for reference but isn't in the looks file: with both, retest 4 found two lighthouses in the same spot.
- **Heights:** GA's 5 m LiDAR covers only the first 3 km out of Dunsborough (to about 115.08, -33.59). The cape falls back to about 30 m global heights, which smooth the climb. The capes LiDAR on GA's ELVIS portal would fix it.
- **In game:** not driven yet; one AI run in retest 6.

## Next

1. A drive, and the lighthouse seen in game.
2. Rebuild when better heights arrive.
