// Busselton fork: which native trees grow where in the South West, for CSP's 3D trees (cspTrees.ts).
//
// A stand-in until the landscape-zones work lands (ROADMAP.md phase C: zoneAt(x, y) returning species
// weights). Swap speciesWeightsAt for it in track.ts; everything else here (picking, the model and
// card each species uses) stays. Rough zones from the region's vegetation maps, blended over a
// kilometre or two so there's no hard line:
//
//   karri belt:   south of Margaret River on the Leeuwin ridge (Boranup), and the big southern
//                 forest (Pemberton, Northcliffe, Walpole). Karri with marri, peppermint under.
//   coastal plain (tuart): the Swan Coastal Plain from Dunsborough east past Busselton to Bunbury,
//                 north of the Whicher Scarp. Tuart with peppermint, a little marri.
//   coast:        the first kilometre or two in from Geographe Bay and the capes' west coast, or
//                 anywhere the aerial shows water close by. Peppermint, she-oak, a few tuarts.
//   inland:       everywhere else (the Leeuwin ridge north of Margaret River, the Blackwood
//                 Plateau, the scarp and the Darling Range): jarrah-marri forest, she-oak under.
//
// Jarrah has no model yet; it uses the marri's (JARRAH_MODEL). Coordinates are WGS84 degrees.

export type NativeSpecies = "karri" | "marri" | "jarrah" | "tuart" | "peppermint" | "sheoak";
/** Relative weights; speciesWeightsAt returns them summing to 1. */
export type SpeciesWeights = Partial<Record<NativeSpecies, number>>;
export interface PlaceHint {
  /** Water within about 60 m in the aerial photo (TreeSpot.coastal). */
  coastal?: boolean;
}

/** The mix inside each zone. */
export const ZONE_MIX: Record<"karri" | "plain" | "coast" | "inland", SpeciesWeights> = {
  karri: { karri: 0.7, marri: 0.2, peppermint: 0.1 },
  plain: { tuart: 0.55, peppermint: 0.35, marri: 0.1 },
  coast: { peppermint: 0.7, sheoak: 0.2, tuart: 0.1 },
  inland: { marri: 0.5, jarrah: 0.4, sheoak: 0.1 },
};

/** 0 well below 0, 1 well above, half at 0; `w` is the blend width in degrees (0.01 is about 1 km). */
const sig = (x: number, w: number) => 1 / (1 + Math.exp(-x / w));

/** Piecewise-linear lookup in [key, value] pairs sorted by key, clamped at the ends. */
function interp(pts: [number, number][], k: number): number {
  if (k <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (k <= pts[i][0]) {
      const [k0, v0] = pts[i - 1], [k1, v1] = pts[i];
      return v0 + ((v1 - v0) * (k - k0)) / (k1 - k0);
    }
  }
  return pts[pts.length - 1][1];
}

/** The capes' west coast: longitude of the shore by latitude (Cape Naturaliste to Cape Leeuwin). */
const WEST_COAST: [number, number][] = [
  [-34.37, 115.14], [-34.3, 115.1], [-34.22, 115.03], [-34.14, 115.0], [-33.98, 114.99], [-33.865, 115.0], [-33.645, 115.03], [-33.53, 115.01],
];
/** Geographe Bay: latitude of the shore by longitude (Cape Naturaliste round to Bunbury). */
const BAY_COAST: [number, number][] = [
  [115.01, -33.53], [115.07, -33.57], [115.1, -33.605], [115.2, -33.635], [115.35, -33.645], [115.45, -33.63], [115.55, -33.53], [115.63, -33.33],
];

/** How strongly each zone applies at a point, 0..1 (inland is what's left). */
export function zoneStrengths(lng: number, lat: number, hint: PlaceHint = {}): { karri: number; plain: number; coast: number } {
  // Karri on the Leeuwin ridge: south of Margaret River town, east of the coastal dunes.
  const leeuwin = sig(-33.97 - lat, 0.015) * sig(lat + 34.27, 0.015) * sig(115.14 - lng, 0.012) * sig(lng - 115.02, 0.006);
  // The southern karri forest.
  const south = sig(-34.25 - lat, 0.04) * sig(lng - 115.65, 0.04) * sig(116.9 - lng, 0.08);
  const karri = Math.max(leeuwin, south);
  // The coastal plain: north of the Whicher Scarp, east of the Leeuwin ridge.
  const plain = sig(lat + 33.74, 0.012) * sig(lng - 115.14, 0.015) * sig(116.0 - lng, 0.05);
  // Within a couple of kilometres of the sea on the capes or the bay, or water seen nearby.
  const west = lat < -33.5 && lat > -34.4 ? sig(interp(WEST_COAST, lat) + 0.02 - lng, 0.006) : 0;
  const bay = lng > 115.0 && lng < 115.65 ? sig(lat - (interp(BAY_COAST, lng) - 0.012), 0.004) : 0;
  const coast = Math.max(west, bay, hint.coastal ? 0.85 : 0);
  return { karri, plain, coast };
}

/** Native species weights at a place, summing to 1. */
export function speciesWeightsAt(lng: number, lat: number, hint: PlaceHint = {}): SpeciesWeights {
  const z = zoneStrengths(lng, lat, hint);
  const out: SpeciesWeights = {};
  const addMix = (mix: SpeciesWeights, k: number) => {
    for (const [s, w] of Object.entries(mix) as [NativeSpecies, number][]) out[s] = (out[s] ?? 0) + w * k;
  };
  // Coast over everything; then karri; then the plain over the inland forest.
  addMix(ZONE_MIX.coast, z.coast);
  addMix(ZONE_MIX.karri, (1 - z.coast) * z.karri);
  addMix(ZONE_MIX.plain, (1 - z.coast) * (1 - z.karri) * z.plain);
  addMix(ZONE_MIX.inland, (1 - z.coast) * (1 - z.karri) * (1 - z.plain));
  const sum = Object.values(out).reduce((a, w) => a + (w ?? 0), 0) || 1;
  for (const s of Object.keys(out) as NativeSpecies[]) out[s] = out[s]! / sum;
  return out;
}

/** A species from weights and a uniform random number in [0, 1). */
export function pickWeighted(w: SpeciesWeights, r: number): NativeSpecies {
  const entries = (Object.entries(w) as [NativeSpecies, number][]).filter(([, v]) => v > 0);
  if (!entries.length) return "peppermint";
  const sum = entries.reduce((a, [, v]) => a + v, 0);
  let acc = 0;
  for (const [s, v] of entries) {
    acc += v / sum;
    if (r < acc) return s;
  }
  return entries[entries.length - 1][0];
}

/** Jarrah has no model of its own yet. */
export const JARRAH_MODEL = "marri";
/** The CSP tree model (treeModels.ts MODEL_NAMES) each species is drawn with. */
export const MODEL_FOR: Record<NativeSpecies, string> = {
  karri: "karri", marri: "marri", jarrah: JARRAH_MODEL, tuart: "tuart", peppermint: "peppermint", sheoak: "sheoak",
};
/** The card sprite (TREE_SPECIES index) that stands in for trunk collision and crown size: karri, marri and jarrah use the tuart's. */
export const CARD_FOR: Record<NativeSpecies, number> = {
  karri: 3, marri: 3, jarrah: 3, tuart: 3, peppermint: 0, sheoak: 1,
};
