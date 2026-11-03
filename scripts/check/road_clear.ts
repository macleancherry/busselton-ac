// Is the road clear, and is it all there? (src/core/roadClear.ts)
//   npx tsx scripts/check/road_clear.ts out/<slug>.zip [--route routes/<slug>.json] [--origin lng,lat]
//     [--cache dir,dir] [--png out/<slug>.roadclear.png] [--json out/<slug>.roadclear.json] [--report-only]
//
// Reads every kn5 in the zip (the world, the layouts, lm_* and layer_* layers) and finds, in plan
// view at half a metre:
//   (a) buildings, shops, lots, fences, landmarks and layers standing on the road (0.5 m or more in
//       from its edge, lower than 4.5 m over it);
//   (b) trees whose trunk is on the road (a sprite's middle, or its collision wall), lower than 3 m;
//   (c) streets with road missing: the streets the build meant to build (extension/street_map.png)
//       with no drivable surface (a divided street's median isn't a hole), or with the ground over
//       it; and, as information only, OSM streets inside the route's area never built at all (from
//       the build's cached map tiles: bridges, private roads and the like);
//   (d) OSM shared paths (and footpaths) with no path ribbon, or with the ground over it, and why
//       (a road or kerb within 1.6 m, ground steps under it, other).
// The map tiles are read from the download cache (out/cache, and SNAPSHOT or out/snapshots/*, in
// this checkout or, from a git worktree, the main one; --cache dir,dir adds more), the same tiles
// the build used; without them (c)'s OSM part and (d) are skipped.
// Writes out/<slug>.roadclear.png (1 m a pixel, north up): road grey, kerbs light, paths dark red;
// red = something standing on the road, magenta = a tree on it, blue = street missing, cyan = street
// buried, orange = shared path missing or buried, yellow = OSM street never built.
// Fails when any (a) piece is 1 m2 or more, any tree is on the road, any street hole is 3 m or more
// (or a street ends 10 m or more short of its line), or any shared path gap is 5 m or more
// (--report-only: report, exit 0).
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { unzipSync } from "fflate";
import { Area, areaRings } from "../../src/core/area";
import { LocalProjection, type LngLat, type Vec2 } from "../../src/core/geo";
import { readKn5 } from "../../src/core/kn5";
import { pathKind } from "../../src/core/paths";
import { decodeOwnPng, encodePng } from "../../src/core/png";
import {
  along, obstaclePieces, pathState, PlanGrid, rasterise, roadDistance, runsOf, streetGapPieces, streetMapCore, streetState, STREET_CLASSES,
  type Kn5File, type LineState, type Piece, type Run,
} from "../../src/core/roadClear";

const args = process.argv.slice(2);
const zipPath = args.find((a) => !a.startsWith("--") && a.endsWith(".zip"));
if (!zipPath) throw new Error("usage: road_clear.ts <zip> [--route file] [--origin lng,lat] [--cache dirs] [--png file] [--json file] [--report-only]");
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const root = resolve(import.meta.dirname, "../..");

// ---- the zip ----
const zip = unzipSync(new Uint8Array(readFileSync(zipPath)), { filter: (f) => f.name.endsWith(".kn5") || /extension\/street_map\.(png|ini)$/.test(f.name) });
const names = Object.keys(zip);
const slug = names.find((n) => /^[^/]+\/[^/]+\.kn5$/.test(n) && n.split("/")[0] === basename(n, ".kn5"))?.split("/")[0];
if (!slug) throw new Error(`no <slug>/<slug>.kn5 in ${zipPath}`);
const zipBase = basename(zipPath, ".zip");

// ---- the route: origin and area ----
const routePath = opt("--route") ?? [join(root, "routes", `${slug}.json`), join(root, "routes/private", `${slug}.json`)].find(existsSync);
const route = routePath ? JSON.parse(readFileSync(routePath, "utf8")) : {};
const origin = (opt("--origin")?.split(",").map(Number) ?? route.build?.origin) as LngLat | undefined;
if (!origin) throw new Error("no origin: pass --route with build.origin, or --origin lng,lat");
const proj = new LocalProjection(origin);
const rings = areaRings(route.build?.area as LngLat[][] | undefined);
const area = rings.length ? new Area(rings.map((r) => r.map((p) => proj.toLocal(p)))) : null;
const ll = (p: Vec2) => { const [lng, lat] = proj.toLngLat(p); return `${lng.toFixed(6)}, ${lat.toFixed(6)}`; };
const xz = (p: Vec2) => `x ${p[0].toFixed(1)}, z ${(-p[1]).toFixed(1)}`;

// ---- rasterise ----
const files: Kn5File[] = [];
for (const n of names) {
  if (!n.endsWith(".kn5")) continue;
  files.push({ file: n, root: readKn5(zip[n]).root });
  delete zip[n];
}
const planes = rasterise(files);
files.length = 0;
const { grid } = planes;
console.log(`grid ${grid.nx} x ${grid.ny} at ${grid.cell} m (${(grid.nx * grid.cell).toFixed(0)} x ${(grid.ny * grid.cell).toFixed(0)} m), south-west corner x ${grid.x0.toFixed(1)}, z ${(-grid.y0).toFixed(1)}`);

// (a), (b)
const obstacles = obstaclePieces(planes);
const standing = obstacles.filter((p) => p.kind !== "tree");
const trees = obstacles.filter((p) => p.kind === "tree");

// (c) the planned streets, from the street map
const coarse = new PlanGrid(grid.x0, grid.y0, grid.x0 + grid.nx * grid.cell, grid.y0 + grid.ny * grid.cell, 1.5);
let streetPts: { at: Vec2; half: number; across: Vec2 }[] = [];
const streetPng = zip[`${slug}/extension/street_map.png`], streetIni = zip[`${slug}/extension/street_map.ini`];
if (streetPng && streetIni) streetPts = streetMapCore(decodeOwnPng(streetPng), new TextDecoder().decode(streetIni));
const planned = new Uint8Array(coarse.nx * coarse.ny);
const streetLabel = new Uint8Array(coarse.nx * coarse.ny);
const streetCounts: Record<LineState, number> = { ok: 0, missing: 0, buried: 0, road: 0, outside: 0 };
const streetStates = streetPts.map((q) => streetState(planes, q.at, 0.75, q.across));
for (let k = 0; k < streetPts.length; k++) {
  const p = streetPts[k].at, s = streetStates[k];
  streetCounts[s]++;
  const c = coarse.at(p[0], p[1]);
  if (c < 0) continue;
  planned[c] = 1;
  if (s === "missing") streetLabel[c] = 1;
  else if (s === "buried" && streetLabel[c] !== 1) streetLabel[c] = 2;
}
const streetGaps = streetGapPieces(coarse, streetLabel, planned);

// ---- the build's map tiles, from the download cache ----
// This checkout's out/, and the main checkout's when this is a git worktree.
const outDirs = [join(root, "out")];
try {
  const common = resolve(root, execSync("git rev-parse --git-common-dir", { cwd: root, encoding: "utf8" }).trim(), "..");
  if (common !== root) outDirs.push(join(common, "out"));
} catch { /* not a git checkout */ }
const cacheDirs = [...(opt("--cache")?.split(",") ?? []), process.env.SNAPSHOT,
  ...outDirs.flatMap((o) => [join(o, "cache"), ...(existsSync(join(o, "snapshots")) ? readdirSync(join(o, "snapshots")).filter((d) => !d.endsWith(".zip")).map((d) => join(o, "snapshots", d)) : [])])]
  .filter((d): d is string => !!d && existsSync(d));
const cached = (url: string): Uint8Array | null => {
  const key = createHash("sha256").update(`GET ${url} `).digest("hex");
  for (const d of cacheDirs) if (existsSync(join(d, `${key}.bin`))) return new Uint8Array(readFileSync(join(d, `${key}.bin`)));
  return null;
};
let tileHits = 0, tileMisses = 0;
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const body = cached(url);
  if (body) tileHits++; else tileMisses++;
  return body ? new Response(body, { status: 200 }) : new Response(null, { status: 404 });
}) as typeof fetch;
type TileRoad = { pts: LngLat[]; cls: string; subclass?: string; bicycle?: string; brunnel?: string; service?: string };
let roads: TileRoad[] = [];
if (cached("https://tiles.openfreemap.org/planet")) {
  const { fetchTileFeatures } = await import("../../src/services/vectorTiles");
  const a = proj.toLngLat([grid.x0, grid.y0]), b = proj.toLngLat([grid.x0 + grid.nx * grid.cell, grid.y0 + grid.ny * grid.cell]);
  const prevWarn = console.warn;
  console.warn = () => {};
  roads = (await fetchTileFeatures([a[0], a[1], b[0], b[1]])).roads;
  console.warn = prevWarn;
}
console.log(`map tiles from the cache: ${Math.max(0, tileHits - 1)} (${tileMisses} not cached)${roads.length ? "" : ": skipped the OSM streets and paths"}`);

// (c) OSM streets inside the area never built
const unbuilt: (Run & { planned: boolean })[] = [];
const unbuiltByClass: Record<string, number> = {};
if (area) {
  for (const r of roads) {
    if (!STREET_CLASSES.has(r.cls)) continue;
    const pts = along(r.pts.map((p) => proj.toLocal(p)), 1).filter(([x, y]) => area.signed(x, y) < -3);
    if (pts.length < 2) continue;
    const states = pts.map((p) => streetState(planes, p, 3));
    const what = `${r.cls}${r.service ? `/${r.service}` : ""}${r.brunnel ? ` ${r.brunnel}` : ""}`;
    for (const run of runsOf(pts, states, 1, ["missing", "buried"], 10, what)) {
      const c = coarse.at(run.at[0], run.at[1]);
      let isPlanned = false;
      for (let dj = -2; dj <= 2 && !isPlanned; dj++) for (let di = -2; di <= 2 && !isPlanned; di++) isPlanned = c >= 0 && planned[c + dj * coarse.nx + di] === 1;
      unbuilt.push({ ...run, planned: isPlanned });
      unbuiltByClass[what] = (unbuiltByClass[what] ?? 0) + run.length;
    }
  }
  unbuilt.sort((a, b) => b.length - a.length);
}

// (d) paths
const pathRuns: Run[] = [], underRoad: Run[] = [];
const pathLen: Record<string, Record<LineState, number>> = {};
// Why shared path is missing, as the build would see it (paths.ts, placeScenery.ts): a road or kerb
// within the path's half width + 0.3 m (cut off every road surface), the ground stepping by more
// than 6 cm across or along it (cut at kerbs and raised strips), or neither.
const missingBy = { "road or kerb within 1.6 m": 0, "ground steps under it": 0, "other": 0 };
const topAt = (x: number, y: number) => {
  const c = grid.at(x, y);
  if (c < 0) return NaN;
  return Math.max(planes.ground[c], Number.isNaN(planes.road[c]) ? -Infinity : planes.road[c], Number.isNaN(planes.kerb[c]) ? -Infinity : planes.kerb[c]);
};
const stepsAt = (pts: Vec2[], i: number) => {
  const a = pts[Math.max(0, i - 2)], b = pts[Math.min(pts.length - 1, i + 2)];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n: Vec2 = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L], t: Vec2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const p = pts[i];
  for (const [d, o] of [[n, 0.6], [n, 1.2], [t, 0.6], [t, 1.0]] as [Vec2, number][]) {
    for (const off of [-0.6, 0, 0.6]) {
      const q: Vec2 = [p[0] + n[0] * off, p[1] + n[1] * off];
      const g0 = topAt(q[0] - d[0] * o, q[1] - d[1] * o), g1 = topAt(q[0], q[1]), g2 = topAt(q[0] + d[0] * o, q[1] + d[1] * o);
      if (Math.abs(g0 - 2 * g1 + g2) > 0.06) return true;
    }
  }
  return false;
};
const seenPath = new Set<number>();
for (const r of roads) {
  if (r.cls !== "path" || r.brunnel === "bridge" || r.brunnel === "tunnel") continue;
  const kind = pathKind(r.subclass, r.bicycle);
  if (!kind) continue;
  // Tiles overlap at their edges, so the same path can come twice: each cell counts once.
  const pts = along(r.pts.map((p) => proj.toLocal(p)), 0.5).filter((p) => {
    const c = grid.at(p[0], p[1]);
    if (c >= 0 && seenPath.has(c * 2 + (kind === "shared" ? 1 : 0))) return false;
    seenPath.add(c * 2 + (kind === "shared" ? 1 : 0));
    return true;
  });
  const states = pts.map((p) => pathState(planes, p, 0.75));
  if (kind === "shared") pts.forEach((p, i) => {
    if (states[i] !== "missing") return;
    missingBy[roadDistance(planes, p, 1.6) <= 1.6 ? "road or kerb within 1.6 m" : stepsAt(pts, i) ? "ground steps under it" : "other"] += 0.5;
  });
  const tally = (pathLen[kind] ??= { ok: 0, missing: 0, buried: 0, road: 0, outside: 0 });
  for (const s of states) tally[s] += 0.5;
  pathRuns.push(...runsOf(pts, states, 0.5, ["missing", "buried"], 2, kind));
  underRoad.push(...runsOf(pts, states, 0.5, ["road"], 15, kind));
}
pathRuns.sort((a, b) => b.length - a.length);
underRoad.sort((a, b) => b.length - a.length);
const sharedGaps = pathRuns.filter((r) => r.what === "shared");

// ---- report ----
const sum = (ps: { area: number }[]) => ps.reduce((s, p) => s + p.area, 0);
const byKind = (ps: Piece[]) => Object.entries(ps.reduce<Record<string, { n: number; area: number }>>((o, p) => {
  const e = (o[p.kind] ??= { n: 0, area: 0 });
  e.n++; e.area += p.area;
  return o;
}, {})).map(([k, e]) => `${k} ${e.n} (${e.area.toFixed(0)} m2)`).join(", ");
const big = standing.filter((p) => p.area >= 1);
console.log(`\n(a) things standing on the road: ${standing.length} pieces, ${sum(standing).toFixed(0)} m2 (${byKind(standing) || "none"})`);
const desc = (p: Piece) => `${p.kind.padEnd(8)} ${p.area.toFixed(1).padStart(6)} m2 ${(p.depth ?? 0).toFixed(1).padStart(4)} m in, ${(p.low ?? 0).toFixed(1).padStart(4)} m up, on ${(p.on ?? "").padEnd(8)} ${(p.mesh ?? "").padEnd(44)} ${xz(p.at)}  (${ll(p.at)})`;
const onKind = (ps: Piece[]) => Object.entries(ps.reduce<Record<string, number>>((o, p) => ({ ...o, [`${p.kind} on ${p.on}`]: (o[`${p.kind} on ${p.on}`] ?? 0) + p.area }), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)} m2`).join(", ");
console.log(`    by surface: ${onKind(obstacles)}`);
for (const p of big.slice(0, 25)) console.log(`  ${desc(p)}`);
console.log(`(b) trees on the road: ${trees.length} pieces, ${sum(trees).toFixed(0)} m2`);
for (const p of trees.slice(0, 10)) console.log(`  ${desc(p)}`);
const streetPct = (k: LineState) => ((100 * streetCounts[k]) / Math.max(1, streetPts.length)).toFixed(2);
// A hole: road either side of it, or a street ending 10 m or more short of its line (more than the
// street map's round cap past a street's end).
const streetBig = streetGaps.filter((g) => g.length >= 3 && (g.between || g.length >= 10));
const streetEnds = streetGaps.filter((g) => g.length >= 3 && !streetBig.includes(g));
console.log(`(c) planned streets (street map, ${streetPts.length} points): missing ${streetPct("missing")}%, buried ${streetPct("buried")}%; holes 3 m or more: ${streetBig.filter((g) => g.kind === "missing").length} missing, ${streetBig.filter((g) => g.kind === "buried").length} buried; ends 3 to 10 m short: ${streetEnds.length}`);
for (const g of streetBig.slice(0, 15)) console.log(`  ${g.kind.padEnd(8)} ~${g.length.toFixed(0).padStart(4)} m  ${xz(g.at)}  (${ll(g.at)})`);
for (const g of streetEnds.slice(0, 8)) console.log(`  short    ~${g.length.toFixed(0).padStart(4)} m  ${xz(g.at)}  (${ll(g.at)})`);
if (area && roads.length) {
  console.log(`    OSM streets in the area never built (10 m or more): ${unbuilt.length} stretches, ${unbuilt.reduce((s, r) => s + r.length, 0).toFixed(0)} m (${unbuilt.filter((r) => !r.planned).length} not in the street plan)`);
  console.log(`    by class: ${Object.entries(unbuiltByClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)} m`).join(", ") || "none"}`);
  for (const r of unbuilt.slice(0, 15)) console.log(`  ${(r.what ?? "").padEnd(20)} ${r.length.toFixed(0).padStart(4)} m  ${r.planned ? "planned " : "unplanned"} ${xz(r.at)}  (${ll(r.at)})`);
}
if (roads.length) {
  for (const [k, t] of Object.entries(pathLen)) {
    const tot = t.ok + t.missing + t.buried + t.road;
    console.log(`(d) ${k} paths: ${tot.toFixed(0)} m built ground: shows ${t.ok.toFixed(0)} m, missing ${t.missing.toFixed(0)} m, buried ${t.buried.toFixed(0)} m, under a road ${t.road.toFixed(0)} m (${t.outside.toFixed(0)} m outside)`);
  }
  console.log(`    shared path missing, likely why: ${Object.entries(missingBy).map(([k, v]) => `${k} ${v.toFixed(0)} m`).join(", ")}`);
  console.log(`    shared path gaps 5 m or more: ${sharedGaps.filter((r) => r.length >= 5).length} (${sharedGaps.filter((r) => r.kind === "missing" && r.length >= 5).length} missing, ${sharedGaps.filter((r) => r.kind === "buried" && r.length >= 5).length} buried)`);
  for (const r of sharedGaps.slice(0, 15)) console.log(`  ${r.kind.padEnd(8)} ${r.length.toFixed(0).padStart(4)} m  ${xz(r.at)}  (${ll(r.at)})`);
  if (underRoad.length) console.log(`    paths under a road for 15 m or more: ${underRoad.length} (${underRoad.filter((r) => r.what === "shared").length} shared)`);
  for (const r of underRoad.filter((r) => r.what === "shared").slice(0, 8)) console.log(`  under    ${r.length.toFixed(0).padStart(4)} m  ${xz(r.at)}  (${ll(r.at)})`);
}

// ---- overlay ----
const S = 2; // cells a pixel
const W = Math.ceil(grid.nx / S), H = Math.ceil(grid.ny / S);
const rgba = new Uint8Array(W * H * 4);
const put = (px: number, py: number, c: readonly number[]) => {
  if (px < 0 || py < 0 || px >= W || py >= H) return;
  const o = (py * W + px) * 4;
  rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
};
const pxOf = ([x, y]: Vec2): [number, number] => [Math.floor((x - grid.x0) / grid.cell / S), H - 1 - Math.floor((y - grid.y0) / grid.cell / S)];
for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
  const c = ((H - 1 - py) * S) * grid.nx + px * S;
  const col = !Number.isNaN(planes.path[c]) ? [150, 50, 45] : !Number.isNaN(planes.road[c]) ? [120, 120, 124] : !Number.isNaN(planes.kerb[c]) ? [190, 190, 190] : !Number.isNaN(planes.ground[c]) ? [34, 46, 34] : [12, 12, 16];
  put(px, py, col);
}
const RED = [255, 40, 40], MAGENTA = [255, 0, 255], BLUE = [40, 110, 255], CYAN = [0, 230, 230], ORANGE = [255, 150, 0], YELLOW = [255, 240, 0];
for (let c = 0; c < planes.obstacle.length; c++) {
  if (!planes.obstacle[c]) continue;
  const [px, py] = pxOf(grid.centre(c));
  put(px, py, planes.obstacle[c] === 4 ? MAGENTA : RED);
}
for (let k = 0; k < streetPts.length; k++) {
  const p = streetPts[k].at, s = streetStates[k];
  if (s === "missing" || s === "buried") { const [px, py] = pxOf(p); put(px, py, s === "missing" ? BLUE : CYAN); }
}
const ring = (at: Vec2, r: number, col: readonly number[]) => {
  const [cx, cy] = pxOf(at);
  for (let a = 0; a < 64; a++) put(Math.round(cx + r * Math.cos((a / 64) * 2 * Math.PI)), Math.round(cy + r * Math.sin((a / 64) * 2 * Math.PI)), col);
};
const line = (r: Run, col: readonly number[]) => ring(r.at, Math.max(3, Math.min(12, r.length / 4)), col);
for (const r of unbuilt) line(r, YELLOW);
for (const r of pathRuns) if (r.what === "shared") line(r, ORANGE);
for (const p of big.slice(0, 40)) ring(p.at, 8, RED);
for (const p of trees.slice(0, 40)) ring(p.at, 6, MAGENTA);
for (const g of streetBig.slice(0, 40)) ring(g.at, 8, g.kind === "missing" ? BLUE : CYAN);
for (const g of streetEnds.slice(0, 60)) ring(g.at, 4, BLUE);
const pngOut = opt("--png") ?? join(root, "out", `${zipBase}.roadclear.png`);
writeFileSync(pngOut, encodePng(rgba, W, H, { alpha: false }));
console.log(`\noverlay: ${pngOut} (1 m a pixel, north up)`);

const fails = {
  standing: big.length,
  trees: trees.length,
  streetHoles: streetBig.length,
  sharedPathGaps: sharedGaps.filter((r) => r.length >= 5).length,
};
console.log(`things on the road (1 m2 or more): ${fails.standing}`);
console.log(`trees on the road: ${fails.trees}`);
console.log(`street holes (3 m or more, or a street ending 10 m or more short): ${fails.streetHoles}`);
console.log(`street ends 3 to 10 m short: ${streetEnds.length}`);
console.log(`OSM streets never built in the area: ${unbuilt.length}`);
console.log(`shared path gaps (5 m or more): ${fails.sharedPathGaps}`);
const json = opt("--json");
const geo = <T extends { at: Vec2 }>(o: T) => ({ ...o, lngLat: proj.toLngLat(o.at), xz: [o.at[0], -o.at[1]] });
if (json) writeFileSync(json, JSON.stringify({ fails, standing: standing.map(geo), trees: trees.map(geo), streetCounts, streetGaps: streetGaps.map(geo), unbuilt: unbuilt.map(geo), unbuiltByClass, pathLen, missingBy, pathGaps: pathRuns.map(geo), underRoad: underRoad.map(geo) }, null, 1));
process.exit(!args.includes("--report-only") && Object.values(fails).some((n) => n > 0) ? 1 : 0);
