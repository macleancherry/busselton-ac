// networkCore phase 1 measured on real data, without a browser build: the route from a build's
// centreline, the streets planned from an Overpass response as the build plans them, the DEM tiles.
// Builds the drivable meshes twice (the old core's ribbons, rings, connectors and side streets; and
// phase 1's trimmed ribbons and junction surfaces) and measures each handled junction both ways:
// steps over 3 cm between neighbouring points 25 cm apart, and points where two drivable meshes
// overlap (lips: 1 to 25 cm apart; any: two drivable surfaces at one point).
// Return fills and kerb returns (photo-driven) aren't in the old side, so the old numbers are a floor.
//
//   npx tsx scripts/network/phase1.ts <overpass.json> [--route routes/busselton.json]
//     [--centreline out/busselton.centreline.json] [--out out/network/phase1] [--png n]
// Writes <out>/phase1.json (per junction, old and new), and with --png, top-down plots of the n worst
// old junctions (old | new: route blue, streets green, junctions orange, overlaps red, steps magenta).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { LocalProjection, type LngLat } from "../../src/core/geo";
import { withDefaults } from "../../src/core/options";
import { SegmentIndex, type RoadPlan, type RoadSample } from "../../src/core/road";
import { buildRoadMeshes } from "../../src/core/roadMesh";
import { buildRingMeshes, fitCircle, type Roundabout } from "../../src/core/roundabout";
import { buildSideStreets, planSideStreets, type SideStreet, type StreetLine } from "../../src/core/sideStreets";
import { makeTerrainFn } from "../../src/core/terrain";
import { Area } from "../../src/core/area";
import { joinWays } from "../../src/services/osm";
import type { Kn5MeshNode } from "../../src/core/kn5";
import { planJunctionCore } from "../../src/core/network/phase1";
import { demTiles } from "../polish/demTiles";
import { isDrivable, sampler, surfaceSteps, type RawMesh, type Sampler } from "../check/benchmarkLib";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const osmPath = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"))!;
const route = JSON.parse(readFileSync(opt("--route", "routes/busselton.json")!, "utf8"));
const cl = JSON.parse(readFileSync(opt("--centreline", "out/busselton.centreline.json")!, "utf8")).centreline as number[][];
const outDir = opt("--out", "out/network/phase1")!;
const nPng = Number(opt("--png", "0"));
mkdirSync(outDir, { recursive: true });

const opts = withDefaults({ ...route.options, ...route.build, networkCore: true });
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
const TILE_CLASS: Record<string, string> = {
  motorway: "motorway", trunk: "trunk", primary: "primary", primary_link: "primary", secondary: "secondary", secondary_link: "secondary",
  tertiary: "tertiary", tertiary_link: "tertiary", residential: "minor", unclassified: "minor", living_street: "minor", road: "minor",
  service: "service", track: "track",
};
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
const clone = (sts: SideStreet[]) => sts.map((st) => ({ ...st, pts: st.pts.map((p) => [p[0], p[1]] as [number, number]), joins: st.joins.slice(), ...(st.widths ? { widths: st.widths.slice() } : {}) }));
const oldStreets = clone(plan0.streets), newStreets = clone(plan0.streets);
const mouth = (side: 1 | -1, sd: number) => plan0.junctions.some((j) => j.side === side && Math.abs(j.s - sd) < j.width / 2 + 1.5);

// Old.
const old: Kn5MeshNode[] = [];
{
  const rm = buildRoadMeshes(plan, opts, () => "road", (i, side) => mouth(side, plan.samples[i % n].s));
  old.push(...rm.road);
  rbs.forEach((rb, k) => { const m = buildRingMeshes(rb, k, opts, "road"); old.push(m.road, ...m.kerb); });
  old.push(...buildSideStreets(oldStreets, plan, index, opts, terrain, () => "road"));
}
// New.
const t0 = Date.now();
const net = planJunctionCore({
  lines: lines.map((l) => ({ ...l, pts: l.pts.map((p) => proj.toLocal(p)) })),
  rings: ringWays.map((r) => ({ pts: r.pts.map((p) => proj.toLocal(p)), lanes: r.lanes })),
  route: { samples, closed, length, crown: opts.crown, nearest: (x, y, max) => index.nearest(x, y, max) },
  streets: newStreets, builtRings: rbs, terrain, inArea: ([x, y]) => area.signed(x, y) < -5,
});
const planMs = Date.now() - t0;
const nu: Kn5MeshNode[] = [];
let meshMs = 0, junctionTris = 0, dressNodes: Kn5MeshNode[] = [];
{
  const t1 = Date.now();
  const nMouth = (side: 1 | -1, sd: number) => plan0.junctions.some((j) => !net.coversRouteRow(j.seg) && j.side === side && Math.abs(j.s - sd) < j.width / 2 + 1.5) || net.routeSInside(sd);
  const rm = buildRoadMeshes(plan, opts, () => "road", (i, side) => nMouth(side, plan.samples[i % n].s), undefined, { quad: net.routeQuadSkip, ring: net.handlesRing });
  nu.push(...rm.road);
  rbs.forEach((rb, k) => { if (net.handlesRing(k)) return; const m = buildRingMeshes(rb, k, opts, "road"); nu.push(m.road, ...m.kerb); });
  nu.push(...buildSideStreets(newStreets, plan, index, opts, net.streetGround(terrain), () => "road", net.streetSkip));
  const jm = net.build({ routeKerb: () => 1, stripOut: opts.vergeWidth + 1.5, vergeWidth: opts.vergeWidth, markings: true, roadMaterial: () => "road" });
  nu.push(...jm.road);
  dressNodes = jm.dress;
  junctionTris = jm.triangles;
  meshMs = Date.now() - t1;
}

const raw = (ms: Kn5MeshNode[]): RawMesh[] => ms.filter((m) => isDrivable(m.name)).map((m) => ({ name: m.name, p: m.positions, i: m.indices }));
const sOld = sampler(raw(old)), sNew = sampler(raw(nu));
const overlapAny = (drive: Sampler, c: [number, number], r: number, stepM = 0.25) => {
  let k = 0;
  const m = Math.ceil(r / stepM);
  for (let i = -m; i <= m; i++) for (let j = -m; j <= m; j++) {
    if (Math.hypot(i, j) * stepM > r) continue;
    if (drive(c[0] + i * stepM, c[1] + j * stepM).length >= 2) k++;
  }
  return k;
};
// Inside one junction (its polygon plus 1 m, where the old and new pieces meet): steps over 3 cm between
// neighbouring points 25 cm apart, lips (two drivable meshes 1 to 25 cm apart), and any overlap.
const within = (drive: Sampler, inside: (p: [number, number]) => boolean, box: [number, number, number, number], stepM = 0.25) => {
  const [x0, y0, x1, y1] = box;
  const nx = Math.ceil((x1 - x0) / stepM), ny = Math.ceil((y1 - y0) / stepM);
  const top = new Map<number, number>();
  let steps = 0, maxStep = 0, lips = 0, overlap = 0;
  let maxAt: [number, number] | undefined;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    // Off the cells' grid, so points on a shared edge don't count twice.
    const p: [number, number] = [x0 + 0.0731 + i * stepM, y0 + 0.0377 + j * stepM];
    if (!inside(p)) continue;
    const hits = drive(p[0], p[1]);
    if (!hits.length) continue;
    top.set(j * 100000 + i, hits[0].h);
    if (hits.length >= 2) overlap++;
    for (let k = 1; k < hits.length; k++) { const d = hits[0].h - hits[k].h; if (d > 0.01 && d < 0.25) { lips++; break; } }
  }
  for (const [key, h] of top) for (const o of [1, 100000]) {
    const q = top.get(key + o);
    if (q === undefined) continue;
    const d = Math.abs(h - q);
    if (d > 0.03) { steps++; if (d > maxStep) { maxStep = d; maxAt = [x0 + (key % 100000) * stepM, y0 + Math.floor(key / 100000) * stepM]; } }
  }
  return { steps, maxStep: +maxStep.toFixed(3), lips, overlap, ...(maxAt ? { maxStepAt: proj.toLngLat(maxAt).map((v) => +v.toFixed(6)) } : {}) };
};
const per = net.junctions.map((pj) => {
  const [x0, y0, x1, y1] = pj.j.box;
  const c: [number, number] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const inside = (p: [number, number]) => pj.j.sdf(p) < 1;
  return {
    id: pj.id, kind: pj.j.kind, onRoute: pj.j.onRoute, legs: pj.j.legs.map((l) => l.kind[0]).join(""), at: proj.toLngLat(c).map((v) => +v.toFixed(6)),
    old: within(sOld, inside, pj.j.box), new: within(sNew, inside, pj.j.box),
    triangles: pj.surface.tris.length / 3,
  };
});
const sum = (f: (x: (typeof per)[number]) => number) => per.reduce((t, x) => t + f(x), 0);
const views = JSON.parse(readFileSync("benchmarks/views.json", "utf8")).sites.flatMap((st: { views: { name: string; focus: LngLat; radius: number }[] }) => st.views)
  .filter((v: { name: string }) => /^(roundabout|t_junction)/.test(v.name))
  .map((v: { name: string; focus: LngLat; radius: number }) => {
    const c = proj.toLocal(v.focus);
    const a = surfaceSteps(sOld, c, v.radius), b = surfaceSteps(sNew, c, v.radius);
    return { view: v.name, radius: v.radius, old: { steps: a.steps, maxStep: +a.maxStep.toFixed(3), lips: a.stacked, overlap: overlapAny(sOld, c, v.radius) }, new: { steps: b.steps, maxStep: +b.maxStep.toFixed(3), lips: b.stacked, overlap: overlapAny(sNew, c, v.radius) } };
  });
const reasons: Record<string, number> = {};
for (const f of net.failures) { const k = f.reason.replace(/\d+(\.\d+)?/g, "#"); reasons[k] = (reasons[k] ?? 0) + 1; }
const triCount = (ms: Kn5MeshNode[]) => ms.filter((m) => isDrivable(m.name)).reduce((t, m) => t + m.indices.length / 3, 0);
const summary = {
  planMs, meshMs, handled: per.length, roundabouts: per.filter((p) => p.kind === "roundabout").length, onRoute: per.filter((p) => p.onRoute).length,
  failures: net.failures.length, reasons,
  old: { steps: sum((x) => x.old.steps), lips: sum((x) => x.old.lips), overlap: sum((x) => x.old.overlap), junctionsWithSteps: per.filter((x) => x.old.steps).length, drivableTriangles: triCount(old) },
  new: { steps: sum((x) => x.new.steps), lips: sum((x) => x.new.lips), overlap: sum((x) => x.new.overlap), junctionsWithSteps: per.filter((x) => x.new.steps).length, drivableTriangles: triCount(nu), junctionTriangles: junctionTris, dressTriangles: dressNodes.reduce((t, m) => t + m.indices.length / 3, 0) },
  views,
};
console.log(JSON.stringify(summary, null, 1));
writeFileSync(join(outDir, "phase1.json"), JSON.stringify({ summary, junctions: per, failures: net.failures }, null, 1));

// Plots.
if (nPng > 0) {
  const ids = process.env.PNGIDS?.split(",").map(Number);
  const worst = ids ? per.filter((p) => ids.includes(p.id)) : per.slice().sort((a, b) => b.new.steps + b.new.overlap - (a.new.steps + a.new.overlap) || b.old.overlap - a.old.overlap).slice(0, nPng);
  for (const w of worst) {
    const pj = net.junctions[w.id];
    const [x0, y0, x1, y1] = pj.j.box;
    const PX = 8, W = Math.ceil((x1 - x0) * PX), H = Math.ceil((y1 - y0) * PX);
    const cv = createCanvas(W * 2 + 10, H);
    const g = cv.getContext("2d");
    g.fillStyle = "#222"; g.fillRect(0, 0, W * 2 + 10, H);
    [sOld, sNew].forEach((drive, side) => {
      const img = g.createImageData(W, H);
      const tops = new Float32Array(W * H).fill(NaN);
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        const x = x0 + (px + 0.5) / PX, y = y1 - (py + 0.5) / PX;
        const hits = drive(x, y);
        const k = (py * W + px) * 4;
        img.data[k + 3] = 255;
        if (!hits.length) { img.data[k] = img.data[k + 1] = img.data[k + 2] = 34; continue; }
        tops[py * W + px] = hits[0].h;
        const nm = hits[0].name;
        const col = hits.length >= 2 ? [230, 40, 40] : /_J\d/.test(nm) ? [235, 150, 40] : /^1STREET/.test(nm) ? [60, 170, 80] : [60, 110, 220];
        [img.data[k], img.data[k + 1], img.data[k + 2]] = col;
      }
      for (let py = 0; py < H - 2; py++) for (let px = 0; px < W - 2; px++) {
        const a = tops[py * W + px], b = tops[py * W + px + 2], c = tops[(py + 2) * W + px];
        if ((Math.abs(a - b) > 0.03 || Math.abs(a - c) > 0.03)) { const k = (py * W + px) * 4; img.data[k] = 255; img.data[k + 1] = 0; img.data[k + 2] = 255; }
      }
      g.putImageData(img, side * (W + 10), 0);
    });
    g.fillStyle = "#fff"; g.font = "14px sans-serif";
    g.fillText(`J${w.id} ${w.kind} ${w.legs}  old: ${w.old.steps} steps, ${w.old.overlap} overlap  new: ${w.new.steps} steps, ${w.new.overlap} overlap`, 6, 16);
    writeFileSync(join(outDir, `j${w.id}.png`), cv.toBuffer("image/png"));
  }
}

// Debug: JNODE=<graph node id> prints how that junction was matched and its outline's pieces.
if (process.env.JNODE) {
  const { buildGraph } = await import("../../src/core/network/graph");
  const { waysFromStreets } = await import("../../src/core/network/index");
  const { matchJunctions } = await import("../../src/core/network/ribbons");
  const { contourRings } = await import("../../src/core/network/mesh");
  const { ringArea } = await import("../../src/core/network/geom");
  const g = buildGraph(waysFromStreets(lines.map((l) => ({ ...l, pts: l.pts.map((p) => proj.toLocal(p)) })), ringWays.map((r) => ({ pts: r.pts.map((p) => proj.toLocal(p)), lanes: r.lanes }))));
  console.log("graph nodes", g.nodes.length);
  const node = g.nodes[Number(process.env.JNODE)];
  console.log("node", node.kind, node.p.map((v) => v.toFixed(1)), "legs", node.legs.map((l) => `${l.edge}:${g.edges[l.edge].cls}${g.edges[l.edge].oneway ? "(1w)" : ""}`), "inner", node.inner, "splitters", node.roundabout?.splitters.length);
  const one = { ...g, nodes: g.nodes.map((nd) => (nd.id === node.id ? nd : { ...nd, kind: "mid" as const })) };
  const m = matchJunctions(one, { samples, closed, length, crown: opts.crown, nearest: (x, y, max) => index.nearest(x, y, max) }, clone(plan0.streets), rbs, {});
  console.log("failures", m.failures);
  for (const j of m.junctions) {
    for (const l of j.legs) console.log(` leg ${l.edge} ${l.kind} ${l.street} dir ${l.dir} trim ${l.trim.toFixed(1)} hw ${l.hw.toFixed(1)} cap ${l.cap.c.map((v) => v.toFixed(1))}`);
    const rings = contourRings(j, 0.4).map((r) => ringArea(r)).filter((a) => Math.abs(a) > 0.5);
    console.log(" contour pieces (m2):", rings.map((a) => a.toFixed(1)).join(", "));
    if (j.ring) console.log(" ring", j.ring.c.map((v) => v.toFixed(1)), "rIn", j.ring.rIn.toFixed(1), "rOut", j.ring.rOut.toFixed(1));
    if (process.env.STREET) {
      const st = plan0.streets[Number(process.env.STREET)];
      const c = j.ring?.c ?? j.centre;
      const worst = st.pts.map((p) => ({ p, d: j.sdf(p) })).sort((a, b) => a.d - b.d)[0];
      console.log(` street min sdf ${worst.d.toFixed(2)} at ${worst.p.map((v) => v.toFixed(1))} (${proj.toLngLat(worst.p).map((v) => v.toFixed(6))})`);
      console.log(` street ${process.env.STREET}: ${st.cls} w ${st.width} ends at ${Math.hypot(st.pts[0][0] - c[0], st.pts[0][1] - c[1]).toFixed(1)} and ${Math.hypot(st.pts[st.pts.length - 1][0] - c[0], st.pts[st.pts.length - 1][1] - c[1]).toFixed(1)} m, nearest ${Math.min(...st.pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))).toFixed(1)} m, joins ${st.joins}`);
    }
  }
}
// Debug: DEV=1 prints, per junction, the largest gap between its mesh and its field at triangle middles.
if (process.env.DEV) {
  const rows = net.junctions.map((pj) => {
    const { xy, tris } = pj.surface;
    let worst = 0, at: [number, number] = [0, 0], area = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const [a, b, c] = [xy[tris[t]], xy[tris[t + 1]], xy[tris[t + 2]]];
      const m: [number, number] = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3];
      const lin = (pj.field.h(a) + pj.field.h(b) + pj.field.h(c)) / 3;
      const d = Math.abs(lin - pj.field.h(m));
      if (d > worst) { worst = d; at = m; area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2; }
    }
    return { id: pj.id, worst, at: proj.toLngLat(at), area };
  }).sort((p, q) => q.worst - p.worst);
  console.log(rows.slice(0, 8).map((r) => `J${r.id} ${(r.worst * 100).toFixed(1)} cm at ${r.at.map((v) => v.toFixed(6))} (tri ${r.area.toFixed(1)} m2)`).join("\n"));
}
// Debug probe: PROBEAT=lng,lat prints heights on a 0.25 m cross around a point (TRIS=<id>: that junction's triangles there).
if (process.env.PROBEAT) {
  const c = proj.toLocal(process.env.PROBEAT.split(",").map(Number) as LngLat);
  if (process.env.TRIS) {
    const pj = net.junctions[Number(process.env.TRIS)];
    const { xy, tris } = pj.surface;
    for (let t = 0; t < tris.length; t += 3) {
      const v = [xy[tris[t]], xy[tris[t + 1]], xy[tris[t + 2]]];
      if (v.some((p) => Math.hypot(p[0] - c[0], p[1] - c[1]) < 2.5)) console.log(v.map((p) => `(${(p[0] - c[0]).toFixed(2)},${(p[1] - c[1]).toFixed(2)} ${pj.field.h(p).toFixed(3)})`).join(" "));
    }
  }
  for (const [dx, dy] of [[1, 0], [0, 1]]) {
    const row: string[] = [];
    for (let a = -2; a <= 2; a += 0.25) {
      const h = sNew(c[0] + dx * a, c[1] + dy * a);
      row.push(h.length ? `${h[0].h.toFixed(3)}${h[0].name.replace(/^1/, "").slice(0, 8)}${h.length > 1 ? "*" : ""}` : "-");
    }
    console.log(row.join(" "));
  }
}
// Debug probe: PROBE=<id> prints heights along a line through each of that junction's caps.
if (process.env.PROBE) {
  const pj = net.junctions[Number(process.env.PROBE)];
  for (const [ci, l] of pj.j.legs.entries()) {
    console.log(`cap ${ci} ${l.kind} dir ${l.dir} at ${l.at} hw ${l.hw.toFixed(2)}`);
    for (const t of [-0.9, -0.5, 0, 0.5, 0.9]) {
      const row: string[] = [];
      for (let a = -3; a <= 3; a += 0.5) {
        const p: [number, number] = [l.cap.c[0] + l.cap.d[0] * a + l.cap.left[0] * t * l.hw, l.cap.c[1] + l.cap.d[1] * a + l.cap.left[1] * t * l.hw];
        const h = sNew(p[0], p[1]);
        row.push(h.length ? `${h[0].h.toFixed(3)}${h[0].name.includes("_J") ? "j" : h[0].name.startsWith("1STREET") ? "s" : "r"}${h.length > 1 ? "*" : ""}` : "  -   ");
      }
      console.log(`  t ${t.toFixed(1)}: ${row.join(" ")}`);
    }
  }
}
