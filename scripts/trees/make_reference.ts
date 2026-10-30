// One tree model as OBJ (a mesh per level of detail) plus its textures, for converting in Content
// Manager's tree tool once, to check our own .bin writer against CM's (docs/trees.md):
//
//   npx tsx scripts/trees/make_reference.ts <species> <out dir>
//   blender --background --python scripts/trees/obj_to_fbx.py -- <out dir>/<species>.obj <out dir>/<species>.fbx
//
// Then in Content Manager: Content > Tools > Creator tools > Tree model converter, pick the .fbx, save
// <species>_cm.bin, and send it back with our <species>.bin from the same folder for
// scripts/trees/compare_bin.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { treeModel, MODEL_NAMES } from "../../src/core/treeModels";
import { writeTreeBin } from "../../src/core/cspTrees";

const [species = "tuart", out = "tree-reference"] = process.argv.slice(2);
const s = MODEL_NAMES.indexOf(species);
if (s < 0) throw new Error(`species is one of ${MODEL_NAMES.join(", ")}`);
mkdirSync(out, { recursive: true });
const m = treeModel(s);
writeFileSync(join(out, `${m.name}.bin`), writeTreeBin(m));
for (const [n, d] of Object.entries(m.textures)) writeFileSync(join(out, n), d);
// OBJ in AC space (y up). Each LOD is an object; each part uses its diffuse texture as the material name.
let obj = `mtllib ${m.name}.mtl\n`, mtl = "", vo = 1;
const mats = new Set<string>();
m.lods.forEach((lod, li) => {
  obj += `o ${m.name}_lod${li}\n`;
  for (const sm of lod.subs) {
    const mat = sm.diffuse.replace(".dds", "");
    if (!mats.has(mat)) {
      mats.add(mat);
      mtl += `newmtl ${mat}\nKd 1 1 1\nmap_Kd ${sm.diffuse}\n${sm.normal ? `map_Bump ${sm.normal}\nnorm ${sm.normal}\n` : ""}\n`;
    }
    obj += `usemtl ${mat}\n`;
    for (let i = 0; i < sm.positions.length; i += 3) obj += `v ${sm.positions[i]} ${sm.positions[i + 1]} ${sm.positions[i + 2]}\n`;
    for (let i = 0; i < sm.normals.length; i += 3) obj += `vn ${sm.normals[i]} ${sm.normals[i + 1]} ${sm.normals[i + 2]}\n`;
    for (let i = 0; i < sm.uvs.length; i += 2) obj += `vt ${sm.uvs[i]} ${1 - sm.uvs[i + 1]}\n`;
    for (let i = 0; i < sm.indices.length; i += 3) {
      const f = [sm.indices[i], sm.indices[i + 1], sm.indices[i + 2]].map((k) => `${k + vo}/${k + vo}/${k + vo}`);
      obj += `f ${f.join(" ")}\n`;
    }
    vo += sm.positions.length / 3;
  }
});
writeFileSync(join(out, `${m.name}.obj`), obj);
writeFileSync(join(out, `${m.name}.mtl`), mtl);
console.log(`wrote ${out}/${m.name}.obj, .mtl, .bin and ${Object.keys(m.textures).length} textures`);
