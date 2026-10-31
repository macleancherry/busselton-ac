// The benchmark set: fixed views on the Busselton map, rendered and measured the same way every time,
// so a change to the road core or to placement can be judged against a baseline (docs/benchmarks.md).
//
//   npx tsx scripts/check/benchmark.ts <track.zip> --label <label> [options]
//   npx tsx scripts/check/benchmark.ts compare <slug> <labelA> <labelB>
//
//   --views <file>      default benchmarks/views.json
//   --surface <file>    the zip's dump_surface.ts output (default <slug>.surface.json beside the zip when it's newer
//                       than the zip, else it is dumped into <label>/work/surface.json)
//   --only <a,b>        render only these views (or site ids); the numbers and the sheet cover them all
//   --no-render         numbers only (renders and the sheet are left as they are)
//   --samples <n>       Cycles samples (default 16)    --res <WxH>   default 960x540
//
// Writes out/benchmarks/<slug>/<label>/: <view>.png, metrics.json, metrics.md and sheet.png (every view,
// grouped by site, with its numbers under it). compare writes out/benchmarks/<slug>/compare/<A>_vs_<B>.png
// (the two labels side by side, view by view) and prints the numbers that changed.
// Rendering needs Blender ($BLENDER, as scripts/blender/render_track.ts); heavy, so run it under the lock.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { LocalProjection, type LngLat } from "../../src/core/geo";
import { readKn5, type Kn5Node } from "../../src/core/kn5";
import { FAMILIES, carsInLanes, isDrivable, isGround, objectOffsets, overlapping, sampler, splitObjects, surfaceSteps, type ObjectStats, type RawMesh, type SceneObject, type StepStats } from "./benchmarkLib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const valued = new Set(["--label", "--views", "--surface", "--only", "--samples", "--res"]);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const positional = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));

interface BenchView { name: string; view: string; focus: LngLat; radius: number; lookFor: string }
interface Site { id: string; title: string; views: BenchView[] }
interface ViewMetrics {
  name: string; site: string;
  steps: StepStats;
  objects: ObjectStats[];
  /** overlapping: cars whose footprint overlaps another car's by more than 10 cm (or that merged with one). */
  cars: { count: number; inLane: number; overlapping: number; on: Record<string, number> };
  /** Trees, poles and posts standing on a drivable surface (route road, street, roundabout), by kind. */
  inRoad: Record<string, number>;
}

const viewsFile = resolve(root, flag("--views") ?? "benchmarks/views.json");
const bench = JSON.parse(readFileSync(viewsFile, "utf8")) as { route: string; sites: Site[] };
const allViews = bench.sites.flatMap((s) => s.views.map((v) => ({ ...v, site: s.id })));
const cm = (m: number) => `${Math.round(m * 100)} cm`;
const W = 480, PAD = 8, HEAD = 22, LINE = 15;

if (positional[0] === "compare") await compare(positional[1], positional[2], positional[3]);
else await run(positional[0]);

async function run(zipPath: string | undefined) {
  const label = flag("--label");
  if (!zipPath || !label) throw new Error("usage: benchmark.ts <track.zip> --label <label> [--views f] [--surface f] [--only a,b] [--no-render]");
  const only = flag("--only")?.split(",");
  // --only limits the renders; the numbers (cheap) and the sheet always cover every view.
  const toRender = only ? allViews.filter((v) => only.includes(v.name) || only.includes(v.site)) : allViews;
  if (!toRender.length) throw new Error("no views chosen");
  const views = allViews;
  const route = JSON.parse(readFileSync(resolve(root, bench.route), "utf8"));
  const proj = new LocalProjection(route.build.origin);

  console.log(`reading ${zipPath}`);
  const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const baseName = Object.keys(files).find((f) => { const [d, b] = f.split("/"); return b === `${d}.kn5`; });
  if (!baseName) throw new Error("no <slug>/<slug>.kn5 in the zip");
  const slug = baseName.split("/")[0];
  const outDir = resolve(root, "out/benchmarks", slug, label);
  mkdirSync(resolve(outDir, "work"), { recursive: true });

  // Renders first (render_track reads the zip itself).
  if (!args.includes("--no-render")) {
    const cmd = ["tsx", resolve(root, "scripts/blender/render_track.ts"), resolve(zipPath), "--route", resolve(root, bench.route), "--out", outDir,
      "--samples", flag("--samples") ?? "16", "--res", flag("--res") ?? "960x540", ...toRender.flatMap((v) => ["--view", `${v.name}=${v.view}`])];
    const r = spawnSync("npx", cmd, { stdio: "inherit", cwd: root });
    if (r.status !== 0) throw new Error(`render_track failed (${r.status ?? r.error})`);
  }

  // The numbers: objects from the base's merged meshes, measured against its physics surface.
  const base = readKn5(files[baseName]);
  const fam: RawMesh[][] = FAMILIES.map(() => []);
  const walk = (n: Kn5Node) => {
    if (n.kind === "node") return n.children.forEach(walk);
    const k = FAMILIES.findIndex((f) => f.match.test(n.name));
    if (k >= 0) fam[k].push({ name: n.name, p: n.positions, i: n.indices });
  };
  walk(base.root);
  const objects: SceneObject[] = FAMILIES.flatMap((f, k) => splitObjects(fam[k], f.kindOf, f.join));
  const lanesFile = Object.keys(files).find((f) => f.endsWith("data/traffic.json"));
  const lanes = lanesFile ? (JSON.parse(new TextDecoder().decode(files[lanesFile])).lanes as { points: number[][] }[]) : [];
  const inLane = new Set(carsInLanes(objects.filter((o) => o.kind === "car"), lanes));
  const crashed = overlapping(objects.filter((o) => o.kind === "car"));

  let surfacePath = flag("--surface") ?? resolve(dirname(zipPath), `${slug}.surface.json`);
  if (!flag("--surface") && !(existsSync(surfacePath) && statSync(surfacePath).mtimeMs >= statSync(zipPath).mtimeMs)) {
    surfacePath = resolve(outDir, "work/surface.json");
    const r = spawnSync("npx", ["tsx", resolve(root, "scripts/check/dump_surface.ts"), resolve(zipPath), surfacePath], { stdio: "inherit", cwd: root });
    if (r.status !== 0) throw new Error("dump_surface failed");
  }
  console.log(`surface: ${surfacePath}`);
  // Only the meshes near a view (the whole map's surface is large).
  const centres = views.map((v) => ({ c: proj.toLocal(v.focus), r: v.radius + 10 }));
  const near = (m: RawMesh) => {
    for (let k = 0; k < m.p.length; k += 3) {
      const x = m.p[k], y = -m.p[k + 2];
      if (centres.some(({ c, r }) => Math.abs(x - c[0]) < r && Math.abs(y - c[1]) < r)) return true;
    }
    return false;
  };
  const meshes = (JSON.parse(readFileSync(surfacePath, "utf8")).meshes as RawMesh[]).filter(near);
  const ground = sampler(meshes.filter((m) => isGround(m.name)));
  const drive = sampler(meshes.filter((m) => isDrivable(m.name)));

  const metrics: ViewMetrics[] = views.map((v) => {
    const c = proj.toLocal(v.focus);
    const inside = objects.filter((o) => Math.hypot(o.contact[0] - c[0], o.contact[1] - c[1]) <= v.radius);
    const cars = inside.filter((o) => o.kind === "car");
    const on: Record<string, number> = {};
    for (const car of cars) {
      const hit = ground(car.contact[0], car.contact[1]).find((h) => h.h <= car.base + 0.5);
      const key = hit ? surfaceKind(hit.name) : "nothing";
      on[key] = (on[key] ?? 0) + 1;
    }
    const inRoad: Record<string, number> = {};
    for (const o of inside) {
      if (o.kind === "car") continue;
      const hit = ground(o.contact[0], o.contact[1]).find((h) => h.h <= o.base + 1.5);
      if (hit && isDrivable(hit.name)) inRoad[o.kind] = (inRoad[o.kind] ?? 0) + 1;
    }
    return {
      name: v.name, site: v.site,
      steps: surfaceSteps(drive, c, v.radius),
      objects: objectOffsets(inside, ground),
      cars: { count: cars.length, inLane: cars.filter((o) => inLane.has(o)).length, overlapping: cars.filter((o) => crashed.has(o) || o.obb.half[0] * 2 > 6.2).length, on },
      inRoad,
    };
  });
  writeFileSync(resolve(outDir, "metrics.json"), JSON.stringify({ zip: resolve(zipPath), label, date: new Date().toISOString(), views: metrics }, null, 1));
  writeFileSync(resolve(outDir, "metrics.md"), metricsTable(metrics, views));
  console.log(metricsTable(metrics, views));

  // The sheet: one row per site, each view with its numbers under it.
  const sheet = await drawSheet(bench.sites.map((s) => ({
    title: s.title,
    tiles: s.views.filter((v) => views.some((w) => w.name === v.name)).map((v) => ({
      title: v.name, file: resolve(outDir, `${v.name}.png`), lines: captionLines(metrics.find((m) => m.name === v.name)!),
    })),
  })).filter((r) => r.tiles.length), `${slug} · ${label}`);
  writeFileSync(resolve(outDir, "sheet.png"), sheet);
  console.log(`wrote ${resolve(outDir, "sheet.png")}`);
}

/** A physics mesh's surface, for the "cars on" tally: road, street, grass, kerb, path. */
function surfaceKind(name: string): string {
  if (/^\dROAD_PATH/.test(name)) return "path";
  if (/^\dROAD_RB/.test(name)) return "roundabout";
  // networkCore: junctions and roundabouts as one surface each (1ROAD_J / 1STREET_J, and their gutters).
  if (/^\d(ROAD|STREET)_(GUTTER_)?J\d/.test(name)) return "junction";
  if (/^\dROAD/.test(name)) return "route road";
  if (/^\dSTREET/.test(name)) return "street";
  return name.replace(/^\d/, "").split("_")[0].toLowerCase();
}

/** Two or three short lines under a tile. */
function captionLines(m: ViewMetrics): string[] {
  const s = m.steps;
  const lines = [`steps >3 cm: ${s.steps} (max ${cm(s.maxStep)}) · lips: ${s.stacked} (max ${cm(s.maxStack)})`];
  const bad = m.objects.filter((o) => o.floating || o.sunk).map((o) => `${o.kind} ${o.floating ? `${o.floating} up` : ""}${o.floating && o.sunk ? " " : ""}${o.sunk ? `${o.sunk} down` : ""}`);
  const total = m.objects.reduce((n, o) => n + o.count, 0);
  lines.push(bad.length ? `off the surface >5 cm: ${bad.join(", ")} (of ${total})` : `objects: ${total}, none off the surface`);
  if (m.cars.count) lines.push(`cars ${m.cars.count}: ${Object.entries(m.cars.on).map(([k, v]) => `${v} on ${k}`).join(", ")}${m.cars.overlapping ? `, ${m.cars.overlapping} overlapping` : ""}${m.cars.inLane ? `, ${m.cars.inLane} in a lane` : ""}`);
  const road = Object.entries(m.inRoad ?? {});
  if (road.length) lines.push(`standing in the road: ${road.map(([k, n]) => `${n} ${k}`).join(", ")}`);
  return lines;
}

function metricsTable(metrics: ViewMetrics[], views: BenchView[]): string {
  const rows = ["| view | radius | steps >3 cm | max step | lips | max lip | objects | floating | sunk | worst | in the road | cars | cars on | overlapping | in lane |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|"];
  for (const m of metrics) {
    const v = views.find((w) => w.name === m.name)!;
    const objs = m.objects.reduce((n, o) => n + o.count, 0);
    const fl = m.objects.filter((o) => o.floating).map((o) => `${o.floating} ${o.kind}`).join(", ") || "0";
    const sk = m.objects.filter((o) => o.sunk).map((o) => `${o.sunk} ${o.kind}`).join(", ") || "0";
    const worst = m.objects.filter((o) => o.worst && (o.floating || o.sunk)).sort((a, b) => Math.abs(b.worst!.offset) - Math.abs(a.worst!.offset))[0];
    rows.push(`| ${m.name} | ${v.radius} m | ${m.steps.steps} | ${cm(m.steps.maxStep)} | ${m.steps.stacked} | ${cm(m.steps.maxStack)} | ${objs} | ${fl} | ${sk} | ${worst ? `${worst.kind} ${worst.worst!.offset > 0 ? "+" : ""}${cm(worst.worst!.offset)}` : "-"} | ${Object.entries(m.inRoad).map(([k, n]) => `${n} ${k}`).join(", ") || "0"} | ${m.cars.count} | ${Object.entries(m.cars.on).map(([k, n]) => `${n} ${k}`).join(", ") || "-"} | ${m.cars.overlapping} | ${m.cars.inLane} |`);
  }
  return [
    "Steps: neighbouring drivable points 25 cm apart more than 3 cm different in height (kerbs aren't drivable, so their step doesn't count). Lips: points with two drivable meshes 1 to 25 cm apart.",
    "Floating/sunk: an object's base more than 5 cm above, or below, the physics surface under it (posts, poles and trunks are planted on purpose, so for them only more than 1 m down counts).",
    "In the road: trees, poles and posts standing on a drivable mesh. Overlapping: parked cars whose footprints overlap another car's by more than 10 cm.",
    "",
    ...rows,
    "",
  ].join("\n");
}

interface Tile { title: string; file: string; lines: string[] }

async function drawSheet(rows: { title: string; tiles: Tile[] }[], heading: string): Promise<Buffer> {
  const first = rows.flatMap((r) => r.tiles).find((t) => existsSync(t.file));
  const img = first ? await loadImage(readFileSync(first.file)) : undefined;
  const H = img ? Math.round((W * img.height) / img.width) : Math.round((W * 9) / 16);
  const cols = Math.max(...rows.map((r) => r.tiles.length));
  const caption = Math.max(...rows.flatMap((r) => r.tiles.map((t) => t.lines.length))) * LINE + 6;
  const rowH = HEAD + LINE + 4 + H + caption + PAD;
  const canvas = createCanvas(cols * (W + PAD) + PAD, 34 + rows.length * rowH + PAD);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1b1d21";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(heading, PAD, 24);
  for (const [ri, row] of rows.entries()) {
    const y0 = 34 + ri * rowH;
    ctx.fillStyle = "#9fc3ff";
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(row.title, PAD, y0 + 16);
    for (const [ci, t] of row.tiles.entries()) await drawTile(ctx, t, PAD + ci * (W + PAD), y0 + HEAD, H);
  }
  return canvas.toBuffer("image/png");
}

async function drawTile(ctx: SKRSContext2D, t: Tile, x: number, y: number, H: number) {
  ctx.fillStyle = "#e8e8e8";
  ctx.font = "14px sans-serif";
  ctx.fillText(t.title, x + 2, y + 12);
  const iy = y + LINE + 4;
  if (existsSync(t.file)) ctx.drawImage(await loadImage(readFileSync(t.file)), x, iy, W, H);
  else { ctx.fillStyle = "#33363c"; ctx.fillRect(x, iy, W, H); ctx.fillStyle = "#e8e8e8"; ctx.fillText("not rendered", x + 10, iy + 24); }
  ctx.fillStyle = "#c8c8c8";
  ctx.font = "12px sans-serif";
  t.lines.forEach((l, k) => ctx.fillText(l, x + 2, iy + H + 14 + k * LINE, W - 4));
}

async function compare(slug: string | undefined, a: string | undefined, b: string | undefined) {
  if (!slug || !a || !b) throw new Error("usage: benchmark.ts compare <slug> <labelA> <labelB>");
  const dir = resolve(root, "out/benchmarks", slug);
  const load = (l: string) => {
    const f = resolve(dir, l, "metrics.json");
    if (!existsSync(f)) throw new Error(`no ${f}: run the benchmark with --label ${l} first`);
    return JSON.parse(readFileSync(f, "utf8")).views as ViewMetrics[];
  };
  const ma = load(a), mb = load(b);
  const names = allViews.map((v) => v.name).filter((n) => ma.some((m) => m.name === n) || mb.some((m) => m.name === n));
  // One row per view: A | B.
  const rows = names.map((n) => {
    const va = ma.find((m) => m.name === n), vb = mb.find((m) => m.name === n);
    return {
      title: `${n}`,
      tiles: [
        { title: `${a}`, file: resolve(dir, a, `${n}.png`), lines: va ? captionLines(va) : ["not measured"] },
        { title: `${b}`, file: resolve(dir, b, `${n}.png`), lines: vb ? captionLines(vb) : ["not measured"] },
      ],
    };
  });
  mkdirSync(resolve(dir, "compare"), { recursive: true });
  const out = resolve(dir, "compare", `${a}_vs_${b}.png`);
  writeFileSync(out, await drawSheet(rows, `${slug}: ${a} (left) vs ${b} (right)`));
  // The numbers that moved.
  const total = (m: ViewMetrics | undefined, f: (o: ObjectStats) => number) => m?.objects.reduce((s, o) => s + f(o), 0) ?? 0;
  const inRoad = (m: ViewMetrics | undefined) => Object.values(m?.inRoad ?? {}).reduce((s, n) => s + n, 0);
  console.log(`view                  steps        lips         floating     sunk         in the road  overlapping  cars in lane`);
  for (const n of names) {
    const va = ma.find((m) => m.name === n), vb = mb.find((m) => m.name === n);
    const pair = (x: number, y: number) => `${x} -> ${y}`.padEnd(13);
    console.log(`${n.padEnd(22)}${pair(va?.steps.steps ?? 0, vb?.steps.steps ?? 0)}${pair(va?.steps.stacked ?? 0, vb?.steps.stacked ?? 0)}${pair(total(va, (o) => o.floating), total(vb, (o) => o.floating))}${pair(total(va, (o) => o.sunk), total(vb, (o) => o.sunk))}${pair(inRoad(va), inRoad(vb))}${pair(va?.cars.overlapping ?? 0, vb?.cars.overlapping ?? 0)}${pair(va?.cars.inLane ?? 0, vb?.cars.inLane ?? 0)}`);
  }
  console.log(`wrote ${out}`);
}
