// Route presets: a route file sets "preset": "<name>" and gets these settings under its own.
// What the route file says always wins; the preset only fills in what it leaves out.
//
// country: a drive-anywhere road (ROADMAP.md phase C). A 70 m corridor and a 2.5 m terrain grid
//   keep 10-30 km inside the RTX 4060 budget; a 1 km photo horizon; gentle banking (up to 4%) on
//   bends; traffic on; no trace guard (country roads aren't traced from the aerial). Roadsides:
//   - W-beam Armco on tight bends, embankments, bridges and culverts (armco, src/core/armco.ts)
//   - vine rows and post-and-wire paddock fences (farmland, src/core/farm.ts)
//   - farm driveways, gates, mailboxes and cattle grids (farmRoadsides, src/core/farmRoadsides.ts)
//   - landscape zones for the trees, ground and verges (zones, src/core/zones.ts)
// town: a flat South West town (Busselton). No banking, a fine terrain grid and the ground only
//   just under the road, so kerbs and edges stay true (CLAUDE.md, "Busselton is flat"). Kerbside
//   parking bays and bike lanes painted (kerbside, src/core/kerbside.ts).
export const PRESETS = {
  country: {
    options: { imagery: "high", banking: true },
    build: {
      terrainStep: 2.5,
      terrainUnderRoad: 0.2,
      traceGuard: false,
      traffic: true,
      corridor: 70,
      horizon: 1000,
      maxBank: 0.04,
      armco: true,
      farmland: true,
      farmRoadsides: true,
      zones: true,
    },
  },
  town: {
    options: { imagery: "high", banking: false },
    build: { terrainStep: 1.5, terrainUnderRoad: 0.12, armco: false, farmRoadsides: false, kerbside: true },
  },
};

/** The route with its preset's options and build settings filled in under its own. */
export function applyPreset(route) {
  if (!route.preset) return route;
  const p = PRESETS[route.preset];
  if (!p) throw new Error(`unknown preset "${route.preset}" (have: ${Object.keys(PRESETS).join(", ")})`);
  return {
    ...route,
    options: { ...p.options, ...(route.options ?? {}) },
    build: { ...p.build, ...(route.build ?? {}) },
  };
}
