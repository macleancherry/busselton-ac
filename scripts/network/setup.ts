// The Busselton inputs the network-core scripts measure on, without a browser build: the route from a
// build's centreline, the street lines and roundabout rings from an Overpass response (as osm.ts and
// track.ts make them), the DEM tiles, and the old core's side-street plan.
import { readFileSync } from "node:fs";
import { LocalProjection, type LngLat } from "../../src/core/geo";
import { withDefaults, type BuildOptions } from "../../src/core/options";
import { SegmentIndex, type RoadPlan, type RoadSample } from "../../src/core/road";
import { fitCircle, type Roundabout } from "../../src/core/roundabout";
import { planSideStreets, type SideStreet, type StreetLine, type StreetPlan } from "../../src/core/sideStreets";
import { makeTerrainFn } from "../../src/core/terrain";
import { Area } from "../../src/core/area";
import { joinWays } from "../../src/services/osm";
import type { RouteRibbon } from "../../src/core/network/ribbons";
import type { P2 } from "../../src/core/network/geom";
import { demTiles } from "../polish/demTiles";

export interface TownInputs {
  route: { loop?: boolean; options?: object; build: { origin: LngLat; area: LngLat[][] } };
  opts: BuildOptions;
  proj: LocalProjection;
  area: Area;
  plan: RoadPlan;
  index: SegmentIndex;
  ribbon: RouteRibbon;
  /** Street lines as the build has them (lng/lat), and in local metres. */
  lines: StreetLine[];
  localLines: { pts: P2[]; cls: string; oneway?: 1 | -1; brunnel?: string; service?: string; surface?: string }[];
  rings: { pts: P2[]; lanes?: number }[];
  rbs: Roundabout[];
  terrain: (x: number, y: number) => number;
  /** The old core's side streets. */
  plan0: StreetPlan;
  clone: (sts: SideStreet[]) => SideStreet[];
}

const TILE_CLASS: Record<string, string> = {
  motorway: "motorway", trunk: "trunk", primary: "primary", primary_link: "primary", secondary: "secondary", secondary_link: "secondary",
  tertiary: "tertiary", tertiary_link: "tertiary", residential: "minor", unclassified: "minor", living_street: "minor", road: "minor",
  service: "service", track: "track",
};

export async function loadTown(osmPath: string, routePath: string, centrelinePath: string, extra: Partial<BuildOptions> = {}): Promise<TownInputs> {
  const route = JSON.parse(readFileSync(routePath, "utf8"));
  const cl = JSON.parse(readFileSync(centrelinePath, "utf8")).centreline as number[][];
  const opts = withDefaults({ ...route.options, ...route.build, networkCore: true, ...extra });
  const proj = new LocalProjection(route.build.origin as LngLat);
  const area = new Area((route.build.area as LngLat[][]).map((r) => r.map((p) => proj.toLocal(p))));

  // The route as built.
  const pos = cl.map((c) => proj.toLocal([c[0], c[1]]));
  const closed = !!route.loop;
  const n = pos.length;
  const samples: RoadSample[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    if (i) s += Math.hypot(pos[i][0] - pos[i - 1][0], pos[i][1] - pos[i - 1][1]);
    const a = pos[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pos[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tan: [number, number] = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    samples.push({ pos: pos[i], tan, left: [-tan[1], tan[0]], curvature: 0, s, width: cl[i][3], h: cl[i][2], bank: 0 } as RoadSample);
  }
  const length = closed ? s + Math.hypot(pos[0][0] - pos[n - 1][0], pos[0][1] - pos[n - 1][1]) : s;

  // Overpass: street lines (as osm.ts), rings.
  const osm = JSON.parse(readFileSync(osmPath, "utf8"));
  const roads: StreetLine[] = [];
  const ringWays: { pts: LngLat[]; lanes?: number }[] = [];
  for (const e of osm.elements ?? []) {
    const t = e.tags ?? {};
    if (e.type !== "way" || !e.geometry) continue;
    const pts = e.geometry.map((g: { lon: number; lat: number }) => [g.lon, g.lat] as LngLat);
    if (t.junction === "roundabout" || t.junction === "circular") { ringWays.push({ pts, ...(+t.lanes > 0 ? { lanes: +t.lanes } : {}) }); continue; }
    const cls = TILE_CLASS[t.highway];
    if (!cls || t.area === "yes" || t.access === "no" || t.access === "private") continue;
    const oneway = t.oneway === "yes" || t.oneway === "1" ? 1 : t.oneway === "-1" ? -1 : undefined;
    const brunnel = t.bridge && t.bridge !== "no" ? "bridge" : t.tunnel && t.tunnel !== "no" ? "tunnel" : undefined;
    roads.push({ pts, cls, ...(brunnel ? { brunnel } : {}), ...(oneway ? { oneway } : {}), ...(t.service ? { service: t.service } : {}) });
  }
  const lines = joinWays(roads);

  // Rings as the build makes them for an area (track.ts): grouped OSM ring ways, fitted.
  const rbs: Roundabout[] = [];
  {
    const ways = ringWays.map((r) => ({ pts: r.pts.map((p) => proj.toLocal(p)), lanes: r.lanes })).map((w) => ({ ...w, f: fitCircle(w.pts) }))
      .filter((w) => w.f && w.f.r >= 4 && w.f.r <= 40 && w.f.rms < 2.5);
    const groups: (typeof ways)[] = [];
    for (const w of ways) {
      const g = groups.find((gr) => gr.some((o) => Math.hypot(o.f!.c[0] - w.f!.c[0], o.f!.c[1] - w.f!.c[1]) < 8));
      if (g) g.push(w); else groups.push([w]);
    }
    for (const g of groups) {
      const fit = fitCircle(g.flatMap((w) => w.pts)) ?? g[0].f!;
      if (!area.inside(fit.c[0], fit.c[1])) continue;
      const lanes = Math.max(1, ...g.map((w) => w.lanes ?? 1));
      rbs.push({ c: fit.c, r: fit.r, w: Math.max(7, lanes >= 2 ? lanes * 4.6 : 0), lanes, hc: 0, sIn: NaN, sOut: NaN, crossings: [], kerbed: true });
    }
  }
  const plan: RoadPlan = { closed, samples, length, roundabouts: rbs };
  const index = new SegmentIndex(plan);
  const lngLats = [...cl.map((c) => [c[0], c[1]] as LngLat), ...lines.flatMap((l) => l.pts)];
  const step = Math.max(1, Math.floor(lngLats.length / 600));
  const demAt = await demTiles("public/dem/wa", lngLats.filter((_, i) => i % step === 0));
  const dem = (x: number, y: number) => demAt(proj.toLngLat([x, y])) ?? 0;
  for (const rb of rbs) rb.hc = dem(rb.c[0], rb.c[1]);
  const terrainAt = makeTerrainFn(plan, index, dem, opts);
  const terrain = (x: number, y: number) => terrainAt(x, y).h;

  const plan0 = planSideStreets(lines, [], plan, index, opts, proj, area);
  const clone = (sts: SideStreet[]) => sts.map((st) => ({ ...st, pts: st.pts.map((p) => [p[0], p[1]] as [number, number]), joins: st.joins.slice(), ...(st.widths ? { widths: st.widths.slice() } : {}) })) as SideStreet[];
  const ribbon: RouteRibbon = { samples, closed, length, crown: opts.crown, nearest: (x, y, max) => index.nearest(x, y, max) };
  const localLines = lines.map((l) => ({ ...l, pts: l.pts.map((p) => proj.toLocal(p) as P2) }));
  const rings = ringWays.map((r) => ({ pts: r.pts.map((p) => proj.toLocal(p) as P2), lanes: r.lanes }));
  return { route, opts, proj, area, plan, index, ribbon, lines, localLines, rings, rbs, terrain, plan0, clone };
}
