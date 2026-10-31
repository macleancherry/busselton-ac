# Swimming jetties

Mac, 31 Oct: "The main jetty looks great but the little swimming one is way too high." Every OSM pier used to be built like the Busselton Jetty, with a deck 3.6 m over the water. Now each pier is sorted into a kind first, and the short ones are built low. Code: `src/core/swimJetty.ts`. Tests: `test/swimJetty.test.ts`.

## What's there in Busselton

OSM has two pier areas (`man_made=pier`, `area=yes`) on the CBD foreshore. They come through the OpenFreeMap z13 tiles with their way ids:

| Way | What | Size | Kind |
| --- | --- | --- | --- |
| 60231680 | Busselton Jetty (`name`, `wikidata`) | about 1.8 km long | major |
| 1016426121 | The swimming jetty west of the jetty base (no name or other tags) | U-shaped, legs about 95 m out, 55 m across, walkway about 3 m wide | swim |

The OSM line piers nearby (for example way 261753707, a 60 m line by the jetty base) aren't built: only pier areas are.

## The real swimming jetty

Measured from the Landgate aerial, centre 115.3432,-33.6441, at 0.14 m/px and 0.027 m/px at the far corner. Web searches found little about it beyond news of a planned beach enclosure taking in "the swim jetties, the stinger net and the first 205 m of the Busselton Jetty" (Busselton Mail).

- **Plan:** a U, open to the beach. Two legs run out from the sand, joined by a cross walk at the far end. That makes a sheltered pool between the legs and the beach. A floating stinger net on buoys curves round outside it.
- **Width:** the walkway is about 2.7 m wide all round.
- **Deck:** pale grey, like weathered timber or concrete, with straight edges and no handrails. No rail or post shadows show in the aerial.
- **Height:** the shadow falls only about a metre to the side, so the deck is low: roughly a metre over the water at the time of the photo, less at high tide.
- **Ladders:** not visible at this resolution. Swimming jetties like it usually have stainless swim ladders down the sides, so the build adds them.
- **Use:** people sit at the far corner and swim in the enclosure.

## The rule (every track)

In order:

1. The route's `build.jettyKinds` by OSM way id: `{ "1016426121": "swim" }`. Values are `major`, `swim` or `pontoon`.
2. `floating=yes` makes it a pontoon. (The tiles don't carry this tag yet, so a route has to use the override.)
3. A name with "pontoon" makes it a pontoon; a name with "swim" makes it a swimming jetty. (The tiles carry no pier names either.)
4. At least **150 m** long (its greatest extent) or at least **8 m** wide (twice its area over its perimeter, which is a strip's width) makes it a **major** jetty.
5. Anything smaller is a **swimming jetty**.

Pieces of one pier cut by tile seams share a way id, so they're measured together. `build.swimJetties: false` puts every pier back to the old way.

## How each kind is built

- **Major:** `coast.ts` `buildPiers` and `jettyLights`, unchanged. The deck is 3.6 m over the water, with piles, handrails and lamp posts. A golden test locks its mesh stats.
- **Swim:** a plank deck **0.5 m** over the water (`JETTY_SWIM_DECK`, material `jetty_deck`). It rises to 0.2 m over the sand where it comes ashore. Round the edge there's a 0.3 m fascia, and pairs of 0.25 m piles every 3.5 m down to the seabed (`JETTY_SWIM_TIMBER_*`). There are no handrails. Stainless swim ladders (`JETTY_SWIM_LADDER_*`, material `steel`) go every 40 m along the edges, over the water. Each one runs from a metre under the water up to grab rails 0.9 m over the deck.
- **Pontoon:** a deck **0.2 m** over the water on a float (`JETTY_PONTOON_FLOAT_*`), with a guide pile at each end.

Everything is visual only, like the main jetty, in the `JETTY` group.
