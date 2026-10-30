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
const kn5s = Object.keys(files).filter((f) => /^[^/]+\/[^/]+\.kn5$/.test(f));
// The base is <slug>/<slug>.kn5: not a layout's dummies (layout_*), a landmark (lm_*) or a hand-made layer.
const name = kn5s.find((f) => { const [dir, file] = f.split("/"); return file === `${dir}.kn5`; })
  ?? kn5s.find((f) => !/\/(layout_|lm_|layer_)/.test(f))!;
const radius = Number(flag("--radius") ?? 120);
const glb = kn5ToGlb(readKn5(files[name]), { centre: [x, -y], radius });
writeFileSync(out, glb);
console.log(`wrote ${out} (${(glb.length / 1e6).toFixed(1)} MB): ${name} within ${radius} m of AC x ${x.toFixed(1)}, z ${(-y).toFixed(1)}`);
// --layers: every other kn5 in the zip too (landmarks, hand-made layers), each as <out>.<name>.glb,
// so a Blender render shows the track as it will be in game, not the base alone.
if (args.includes("--layers")) {
  for (const f of kn5s.filter((f) => f !== name && !/\/layout_/.test(f))) {
    const part = kn5ToGlb(readKn5(files[f]), { centre: [x, -y], radius });
    if (part.length < 2000) continue; // nothing within the radius
    const file = out.replace(/\.glb$/, "") + "." + f.split("/")[1].replace(/\.kn5$/, "") + ".glb";
    writeFileSync(file, part);
    console.log(`wrote ${file} (${(part.length / 1e6).toFixed(2)} MB)`);
  }
}
