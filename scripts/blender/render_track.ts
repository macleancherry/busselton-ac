// A built track as it really is (the base plus every landmark layer), rendered in Blender with Cycles.
// The SHOTS renders come from the three.js preview before the landmarks are added; these come from
// the finished zip, so they show what AC will load (less CSP's lighting and shaders).
//
//   npx tsx scripts/blender/render_track.ts <track.zip> --route <route.json> [options]
//
//   --view <spec>       repeatable (default: landmarks and aerial):
//                         landmarks                      each landmark from the street in front of it
//                         aerial | aerial:lng,lat[@h]    from the south and above (default 120 m up)
//                         [name=]lng,lat->lng,lat[@h]    eye -> target, eye h m above the ground (1.6)
//                         [name=]lng,lat->lng,lat@h/th~lens  ... target th m above the ground, lens in mm
//   --near <lng,lat>    only landmarks within --within metres (default 400) of this point; also
//                       where a bare "aerial" looks
//   --only <a,b>        only these view names
//   --out <dir>         default out/renders/<slug>
//   --samples <n>       Cycles samples (default 16)
//   --res <WxH>         default 1280x720
//   --centreline <f>    the drive's centreline (default <zip dir>/<slug>.centreline.json)
//   --plan              print the cameras and stop (no export, no render)
//
// Writes <out>/<view>.png and <out>/sheet.png (all views, labelled). The track is exported around
// each group of views into <out>/work/ (kept, and reused while the zip and the group don't change).
// Blender: $BLENDER, default "blender" (run as blender --background --python); a Python with the
// bpy module works too (BLENDER=/path/to/python). Heavy: on a shared machine run it under the lock.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { LocalProjection, type LngLat } from "../../src/core/geo";
import { readKn5 } from "../../src/core/kn5";
import { kn5ToGlb } from "../../src/core/gltf";
import { surfaceHeight } from "../../src/core/layouts";
import { landmarkReach } from "../../src/core/landmarkLayer";
import type { HouseSpec } from "../../src/core/specHouse";
import { bearingDir, clusterViews, lensFor, parseView, slugName, streetSpot, type View, type ViewSpec, type XY, type XYZ } from "./renderPlan";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const valued = new Set(["--route", "--view", "--near", "--within", "--only", "--out", "--samples", "--res", "--centreline"]);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const flags = (n: string) => args.flatMap((a, i) => (a === n ? [args[i + 1]] : []));
const zipPath = args.find((a, i) => !a.startsWith("--") && !valued.has(args[i - 1]));
if (!zipPath || !flag("--route")) throw new Error("usage: render_track.ts <track.zip> --route <route.json> [--view ...] [--near lng,lat] [--out dir]");

const route = JSON.parse(readFileSync(resolve(flag("--route")!), "utf8"));
if (!route.build?.origin) throw new Error("the route has no build.origin");
const proj = new LocalProjection(route.build.origin);
const local = (p: LngLat): XY => proj.toLocal(p) as XY;
const near = flag("--near")?.split(",").map(Number) as LngLat | undefined;
const within = Number(flag("--within") ?? 400);
const only = flag("--only")?.split(",");
const specs: ViewSpec[] = (flags("--view").length ? flags("--view") : ["landmarks", "aerial"]).map(parseView);
const [resX, resY] = (flag("--res") ?? "1280x720").split("x").map(Number);
const samples = Number(flag("--samples") ?? 16);

console.log(`reading ${zipPath}`);
const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
const kn5s = Object.keys(files).filter((f) => /^[^/]+\/[^/]+\.kn5$/.test(f));
const baseName = kn5s.find((f) => { const [dir, file] = f.split("/"); return file === `${dir}.kn5`; })
  ?? kn5s.find((f) => !/\/(layout_|lm_|layer_)/.test(f))!;
const slug = baseName.split("/")[0];
const outDir = resolve(flag("--out") ?? resolve(root, "out/renders", slug));
const base = readKn5(files[baseName]);
const layers = kn5s.filter((f) => f !== baseName && !/\/layout_/.test(f)).map((f) => ({ name: f.split("/")[1].replace(/\.kn5$/, ""), model: readKn5(files[f]) }));

// Ground and road heights from the base (AC x, -z are local x, y).
const ground = surfaceHeight(base, /^\d(?!WALL)/);
const roads = surfaceHeight(base, /^\d(ROAD|STREET)(?!_(PATH|GUTTER|DRIVE|RETFILL|RBGUTTER))/);
const groundAt = (x: number, y: number) => ground(x, y) ?? roads(x, y) ?? 0;
const centrelinePath = flag("--centreline") ?? resolve(dirname(zipPath), `${slug}.centreline.json`);
const line: XYZ[] = existsSync(centrelinePath)
  ? (JSON.parse(readFileSync(centrelinePath, "utf8")).centreline as number[][]).map((p) => { const [x, y] = local([p[0], p[1]]); return [x, y, roads(x, y) ?? p[2]] as XYZ; })
  : [];
if (!line.length) console.log(`no centreline at ${centrelinePath}: landmark cameras use the base's roads only`);

// Landmarks: the spec looks in the route's looks files (and HOUSE_LOOKS), as scripts/polish/landmarks.ts.
interface Look { at: LngLat; specFile?: string; name?: string; facing?: number }
const lookFiles: string[] = [...(route.looks ?? []), ...(process.env.HOUSE_LOOKS ? process.env.HOUSE_LOOKS.split(",") : [])];
const looks: Look[] = lookFiles.flatMap((f) => { const l = JSON.parse(readFileSync(resolve(root, f.trim()), "utf8")); return (l.houses ?? l) as Look[]; }).filter((l) => l.specFile);

/** Unit direction from a point to the nearest road within 80 m (a look without a facing). */
const toNearestRoad = (x: number, y: number): XY => {
  for (let r = 2; r <= 80; r += 2) for (let a = 0; a < 72; a++) {
    const t = (a / 72) * 2 * Math.PI;
    if (roads(x + Math.cos(t) * r, y + Math.sin(t) * r) !== null) return [Math.cos(t), Math.sin(t)];
  }
  return [0, 1];
};

const views: View[] = [];
const centroid = (): LngLat => near ?? (looks.length ? [looks.reduce((s, l) => s + l.at[0], 0) / looks.length, looks.reduce((s, l) => s + l.at[1], 0) / looks.length] : route.build.origin);
for (const s of specs) {
  if (s.kind === "landmarks") {
    for (const l of looks) {
      const [x, y] = local(l.at);
      if (near) { const [nx, ny] = local(near); if (Math.hypot(x - nx, y - ny) > within) continue; }
      const spec = JSON.parse(readFileSync(resolve(root, l.specFile!), "utf8")) as HouseSpec;
      const name = slugName(basename(l.specFile!, ".json"));
      const reach = landmarkReach(spec);
      const facing = Number.isFinite(l.facing) ? bearingDir(l.facing!) : toNearestRoad(x, y);
      const spot = streetSpot([x, y], facing, reach, roads, line);
      if (!spot) { console.log(`${name}: no road in front of it within 90 m, skipped`); continue; }
      const tall = Math.max(...spec.blocks.filter((b) => !b.outbuilding).map((b) => b.wallHeight ?? spec.wallHeight ?? 3.2));
      const g = groundAt(x, y);
      views.push({
        name, kind: "street",
        eye: [spot.at[0], spot.at[1], spot.at[2] + 1.6],
        target: [x, y, g + Math.min(tall * 0.55, 6)],
        lens: lensFor(Math.min(2 * reach, 60), spot.distance, 18, 35),
      });
    }
  } else if (s.kind === "aerial") {
    const [x, y] = local(s.at ?? centroid());
    const h = s.height ?? 120, g = groundAt(x, y);
    views.push({ name: s.name ?? (s.at ? `aerial_${views.filter((v) => v.kind === "aerial").length + 1}` : "aerial"), kind: "aerial", eye: [x, y - h * 1.4, g + h], target: [x, y, g], lens: 28 });
  } else {
    const [ex, ey] = local(s.from), [tx, ty] = local(s.to);
    views.push({
      name: s.name ?? `view${views.filter((v) => v.kind === "custom").length + 1}`, kind: "custom",
      eye: [ex, ey, groundAt(ex, ey) + s.height], target: [tx, ty, groundAt(tx, ty) + (s.targetHeight ?? (s.height > 10 ? 0 : 2.5))], lens: s.lens ?? 24,
    });
  }
}
const chosen = only ? views.filter((v) => only.includes(v.name)) : views;
if (!chosen.length) throw new Error("no views to render");
const clusters = clusterViews(chosen);
for (const v of chosen) console.log(`${v.name.padEnd(28)} eye ${v.eye.map((n) => n.toFixed(1)).join(", ")}  target ${v.target.map((n) => n.toFixed(1)).join(", ")}  ${v.lens.toFixed(0)} mm`);
if (args.includes("--plan")) process.exit(0);

// Export the track around each group: the base, and each layer with anything inside the radius.
mkdirSync(resolve(outDir, "work"), { recursive: true });
const zipStat = statSync(zipPath);
const plan = clusters.map((c, i) => {
  const dir = resolve(outDir, "work", `g${i}`);
  mkdirSync(dir, { recursive: true });
  const key = JSON.stringify({ v: 2, zip: resolve(zipPath), size: zipStat.size, mtime: zipStat.mtimeMs, centre: c.centre.map((n) => Math.round(n)), radius: c.radius });
  const keyFile = resolve(dir, "key.json");
  let glbs: string[];
  if (existsSync(keyFile) && JSON.parse(readFileSync(keyFile, "utf8")).key === key) {
    glbs = JSON.parse(readFileSync(keyFile, "utf8")).glbs;
    console.log(`group ${i}: reusing the export in ${dir}`);
  } else {
    const centre: [number, number] = [c.centre[0], -c.centre[1]]; // AC x, z
    glbs = [];
    const write = (name: string, glb: Uint8Array) => { const f = resolve(dir, `${name}.glb`); writeFileSync(f, glb); glbs.push(f); };
    write("base", kn5ToGlb(base, { centre, radius: c.radius, keep: /^SEA(_|$)/ }));
    for (const l of layers) {
      const glb = kn5ToGlb(l.model, { centre, radius: c.radius });
      if (glb.length >= 2000) write(l.name, glb);
    }
    writeFileSync(keyFile, JSON.stringify({ key, glbs }));
    console.log(`group ${i}: exported ${glbs.length} files within ${c.radius} m (${glbs.map((g) => basename(g, ".glb")).join(", ")})`);
  }
  return { glbs, views: c.views };
});
const planFile = resolve(outDir, "work", "plan.json");
writeFileSync(planFile, JSON.stringify({ out: outDir, samples, res: [resX, resY], groups: plan }, null, 1));

// Render.
const blender = process.env.BLENDER ?? "blender";
const script = resolve(root, "scripts/blender/render_track.py");
const asModule = /python/i.test(basename(blender));
const cmd = asModule ? [script, "--", planFile] : ["--background", "--factory-startup", "--python", script, "--", planFile];
console.log(`rendering ${chosen.length} views with ${blender}`);
const run = spawnSync(blender, cmd, { stdio: "inherit" });
if (run.status !== 0) throw new Error(`Blender failed (${run.status ?? run.error})`);

// The contact sheet: every view, labelled.
const shots = chosen.map((v) => ({ name: v.name, file: resolve(outDir, `${v.name}.png`) })).filter((s) => existsSync(s.file));
const cols = shots.length <= 4 ? 2 : 3, w = 640, h = Math.round((w * resY) / resX), pad = 8, label = 26;
const rows = Math.ceil(shots.length / cols);
const sheet = createCanvas(cols * (w + pad) + pad, rows * (h + label + pad) + pad);
const ctx = sheet.getContext("2d");
ctx.fillStyle = "#1b1d21";
ctx.fillRect(0, 0, sheet.width, sheet.height);
for (const [i, s] of shots.entries()) {
  const x = pad + (i % cols) * (w + pad), y = pad + Math.floor(i / cols) * (h + label + pad);
  ctx.drawImage(await loadImage(readFileSync(s.file)), x, y + label, w, h);
  ctx.fillStyle = "#e8e8e8";
  ctx.font = "16px sans-serif";
  ctx.fillText(s.name, x + 2, y + 18);
}
const sheetFile = resolve(outDir, "sheet.png");
writeFileSync(sheetFile, sheet.toBuffer("image/png"));
console.log(`wrote ${sheetFile} (${shots.length} views)`);
