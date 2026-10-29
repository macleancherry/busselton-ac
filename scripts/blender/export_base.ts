// The generated track around a spot as a .glb for Blender, to model a hand-made layer against.
//   npx tsx scripts/blender/export_base.ts <track.zip> <out.glb> --route <route.json> --at <lng,lat> [--radius 120]
// AC world coordinates throughout (the route's build.origin), so whatever is modelled against it comes
// back in the same place (scripts/blender/make_layer.ts).
import { readFileSync, writeFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { LocalProjection } from "../../src/core/geo";
import { readKn5 } from "../../src/core/kn5";
import { kn5ToGlb } from "../../src/core/gltf";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const [zipPath, out] = args;
const route = JSON.parse(readFileSync(flag("--route")!, "utf8"));
const origin = route.build?.origin;
if (!origin) throw new Error("the route has no build.origin: add one first, or layers won't line up after a route change");
const [lng, lat] = flag("--at")!.split(",").map(Number);
const [x, y] = new LocalProjection(origin).toLocal([lng, lat]);
const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
const name = Object.keys(files).find((f) => /^[^/]+\/[^/]+\.kn5$/.test(f) && !/\/layer_/.test(f))!;
const glb = kn5ToGlb(readKn5(files[name]), { centre: [x, -y], radius: Number(flag("--radius") ?? 120) });
writeFileSync(out, glb);
console.log(`wrote ${out} (${(glb.length / 1e6).toFixed(1)} MB): ${name} within ${flag("--radius") ?? 120} m of AC x ${x.toFixed(1)}, z ${(-y).toFixed(1)}`);
