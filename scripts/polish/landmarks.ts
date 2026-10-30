// Landmarks as layers: each spec look in a route's "looks" files becomes its own lm_<slug>.kn5, placed
// on the track's fixed map origin and standing on its ground, without regenerating the track
// (ROADMAP.md, "generate, freeze, polish"). The base build clears each landmark's spot.
//
//   npx tsx scripts/polish/landmarks.ts <route.json> <base.zip> [--only <slug>] [--out out/<slug>_polish.zip]
//       A polish zip: the landmark kn5s and the track's models_*.ini with them added. Unzip it over
//       the installed track (scripts/windows/install-track.ps1 -Zip <it> -Overlay); no reinstall,
//       and the AO bake stays (rebake to shade the new landmarks).
//   npx tsx scripts/polish/landmarks.ts <route.json> <base.zip> --into
//       The same, written into the base zip itself (what build-track.mjs does after a base build).
//   npx tsx scripts/polish/landmarks.ts <route.json> --clears
//       Prints the spots the base build must clear, as JSON (build-track.mjs reads it).
//   npx tsx scripts/polish/landmarks.ts <route.json> --list
//       Prints the landmarks' names and map positions, as JSON (for the automatic test's shots).
//
// Looks come from the route's "looks" files plus HOUSE_LOOKS (comma-separated), as for build-track.mjs.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { createCanvas } from "@napi-rs/canvas";
import { LocalProjection, type LngLat } from "../../src/core/geo";
import { readKn5, writeKn5 } from "../../src/core/kn5";
import { surfaceHeight } from "../../src/core/layouts";
import { landmarkGround } from "../../src/core/landmarkGround";
import { landmarkClear, landmarkModel } from "../../src/core/landmarkLayer";
import type { HouseSpec } from "../../src/core/specHouse";
import { drawSignsOn } from "../../src/services/signs";
import { demTiles } from "./demTiles";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const [routePath, zipPath] = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--only", "--out"].includes(args[i - 1])));
const route = JSON.parse(readFileSync(resolve(root, routePath), "utf8"));

interface Look { at: LngLat; specFile?: string; spec?: HouseSpec; name?: string; facing?: number }
const lookFiles = [...(route.looks ?? []), ...(process.env.HOUSE_LOOKS ? process.env.HOUSE_LOOKS.split(",") : [])];
const looks: Look[] = lookFiles.flatMap((f: string) => {
  const l = JSON.parse(readFileSync(resolve(root, f.trim()), "utf8"));
  return (l.houses ?? l) as Look[];
}).filter((l) => l.specFile).map((l) => ({ ...l, spec: JSON.parse(readFileSync(resolve(root, l.specFile!), "utf8")) as HouseSpec }));
const slugOf = (l: Look) => (l.specFile!.split("/").pop() ?? "landmark").replace(/\.json$/, "").replace(/[^A-Za-z0-9_]+/g, "_").toLowerCase();

if (args.includes("--clears")) {
  console.log(JSON.stringify(looks.map((l) => landmarkClear(l.at, l.spec!))));
  process.exit(0);
}
if (args.includes("--list")) {
  console.log(JSON.stringify(looks.map((l) => ({ name: l.name ?? slugOf(l), at: l.at }))));
  process.exit(0);
}
if (!zipPath) throw new Error("usage: landmarks.ts <route.json> <base.zip> [--only <slug>] [--out <zip>] [--into]");
if (!route.build?.origin) throw new Error("the route has no build.origin: landmarks need the map fixed in place");

const files = unzipSync(new Uint8Array(readFileSync(resolve(root, zipPath))));
const slug = Object.keys(files)[0].split("/")[0];
const world = readKn5(files[`${slug}/${slug}.kn5`]);
const proj = new LocalProjection(route.build.origin);
// Ground (src/core/landmarkGround.ts): the physics ground under a point, else the nearest within
// 40 m (a landmark's middle can sit on a spot the base cleared or paved), else the horizon mesh
// (country builds keep detailed terrain only about 70 m either side of the road), else the WA DEM
// tiles served with the app, else 0.
const dem = await demTiles(resolve(root, "public/dem/wa"), looks.map((l) => l.at));
const ground = landmarkGround(world, { dem: (x, y) => dem(proj.toLngLat([x, y])) });
const roads = surfaceHeight(world, /^\d(ROAD|STREET|UNSEALED|UNPAVED)/);
/** Unit direction (local x east, y north) from a point to the nearest road within 80 m. */
const toNearestRoad = (x: number, y: number): [number, number] => {
  for (let r = 2; r <= 80; r += 2) {
    for (let a = 0; a < 72; a++) {
      const t = (a / 72) * 2 * Math.PI;
      if (roads(x + Math.cos(t) * r, y + Math.sin(t) * r) !== null) return [Math.cos(t), Math.sin(t)];
    }
  }
  return [0, 1];
};
const drawSigns = (names: Parameters<typeof drawSignsOn>[1], w: number, h: number) => drawSignsOn((cw, ch) => createCanvas(cw, ch), names, w, h);

const only = flag("--only");
const out: Record<string, Uint8Array> = {};
const built: string[] = [];
for (const l of looks) {
  const name = slugOf(l);
  if (only && only !== name) continue;
  const [x, y] = proj.toLocal(l.at);
  const toRoad: [number, number] = Number.isFinite(l.facing)
    ? [Math.sin((l.facing! * Math.PI) / 180), Math.cos((l.facing! * Math.PI) / 180)]
    : toNearestRoad(x, y);
  const lm = landmarkModel(l.spec!, { centre: [x, y], toRoad, z: ground(x, y) + 0.05 }, name, ground, { drawSigns, detailShaders: route.build?.detailShaders !== false });
  out[`${slug}/lm_${name}.kn5`] = writeKn5(lm.model);
  built.push(`lm_${name}.kn5`);
  console.log(`lm_${name}.kn5: ${lm.triangles} triangles, ${lm.model.materials.length} materials, ground ${ground(x, y).toFixed(2)} m (${ground.source(x, y)})${Number.isFinite(l.facing) ? `, facing ${l.facing}` : ", facing its nearest road"}`);
}

// Every layout's models ini (or the single models.ini) gets the landmarks it doesn't list yet; a
// track with neither gets a models.ini (AC then loads what it lists instead of <slug>.kn5 alone).
const allLandmarks = looks.map((l) => `lm_${slugOf(l)}.kn5`);
if (!Object.keys(files).some((f) => /\/models(_[^/]+)?\.ini$/.test(f))) files[`${slug}/models.ini`] = strToU8(`[MODEL_0]\nFILE=${slug}.kn5\nPOSITION=0,0,0\nROTATION=0,0,0\n`);
for (const f of Object.keys(files).filter((f) => /\/models(_[^/]+)?\.ini$/.test(f))) {
  const text = strFromU8(files[f]);
  const listed = new Set([...text.matchAll(/FILE=(.+)/g)].map((m) => m[1].trim()));
  let n = [...text.matchAll(/\[MODEL_(\d+)\]/g)].length;
  let add = "";
  for (const k of allLandmarks) {
    if (listed.has(k)) continue;
    add += `\n[MODEL_${n++}]\nFILE=${k}\nPOSITION=0,0,0\nROTATION=0,0,0\n`;
  }
  out[f] = add ? strToU8(text.replace(/\s*$/, "\n") + add) : files[f];
}

if (args.includes("--into")) {
  writeFileSync(resolve(root, zipPath), zipSync({ ...files, ...out }, { level: 6 }));
  console.log(`added ${built.length} landmarks to ${zipPath}`);
} else {
  const dest = flag("--out") ?? `out/${slug}_polish.zip`;
  writeFileSync(resolve(root, dest), zipSync(out, { level: 6 }));
  console.log(`wrote ${dest}: ${built.join(", ")} and ${Object.keys(out).length - built.length} models ini files`);
}
