// A model exported from Blender (.glb) as a hand-made layer: <name>.kn5 plus its <name>.json sidecar.
//   npx tsx scripts/blender/make_layer.ts <layer.glb> <layers dir> <name> --replaces <lng,lat,radius> [--keep-trees]
// The model must be in the track's AC world coordinates (made against scripts/blender/export_base.ts's
// export). Object names become mesh names: start one with a digit and a surface key for physics
// (1WALL_house, 1ROAD_driveway); anything else is visual only.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { glbToKn5 } from "../../src/core/gltf";
import { writeKn5 } from "../../src/core/kn5";
import { solidTexture } from "../../src/core/textures";

const args = process.argv.slice(2);
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const [glbPath, dir, name] = args;
const { model, min, max } = glbToKn5(new Uint8Array(readFileSync(glbPath)), name, solidTexture);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, `${name}.kn5`), writeKn5(model));
const rep = flag("--replaces")?.split(",").map(Number);
const replaces = rep ? [{ at: [rep[0], rep[1]], radius: rep[2], ...(args.includes("--keep-trees") ? { trees: false } : {}) }] : [];
writeFileSync(join(dir, `${name}.json`), JSON.stringify({ note: `hand-made layer from ${glbPath}`, replaces }, null, 2));
const meshes = model.root.children.length, tris = model.root.children.reduce((a, c) => a + (c.kind === "mesh" ? c.indices.length / 3 : 0), 0);
console.log(`wrote ${join(dir, name)}.kn5: ${meshes} meshes, ${tris} triangles, ${model.textures.length} textures; spans AC x ${min[0].toFixed(1)}..${max[0].toFixed(1)}, z ${min[1].toFixed(1)}..${max[1].toFixed(1)}`);
