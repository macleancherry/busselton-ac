// A build's performance budget: what the GPU has to draw and hold, checked against limits that keep
// the workstation's RTX 4060 (8 GB) smooth with a few cars and CSP on.
//
//   npx tsx scripts/check/budget.ts out/<slug>.zip
//
// Draw calls are counted as visible meshes (one material each); texture memory as the decoded
// size with mipmaps (DDS at its compressed size). Exits non-zero over a limit.

import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readKn5, type Kn5Node } from "../../src/core/kn5";

const LIMITS = { triangles: 1_500_000, meshes: 4000, textureMB: 1500, kn5MB: 600 };

const files = unzipSync(new Uint8Array(readFileSync(process.argv[2])));
// The world kn5 (<slug>/<slug>.kn5), not a layout's dummies or a layer.
const kn5Name = Object.keys(files).find((f) => { const [d, b] = f.split("/"); return b === `${d}.kn5`; }) ?? Object.keys(files).find((f) => f.endsWith(".kn5"))!;
const model = readKn5(files[kn5Name]);

let triangles = 0, meshes = 0, physicsTris = 0;
const byGroup = new Map<string, number>();
// Group = the named node two levels down (root > track > GROUP), or one down when that's all there is.
const walk = (n: Kn5Node, depth: number, group: string) => {
  if (n.kind === "mesh") {
    const t = n.indices.length / 3;
    if (/^[0-9]/.test(n.name)) physicsTris += t;
    if (n.renderable === false) return;
    triangles += t;
    meshes++;
    byGroup.set(group || n.name, (byGroup.get(group || n.name) ?? 0) + t);
  } else n.children.forEach((c) => walk(c, depth + 1, depth >= 2 ? group : c.kind === "mesh" ? group : c.name));
};
walk(model.root, 0, "");
// Layers drawn over the world (landmarks lm_*.kn5, hand-made layer_*.kn5) count too.
const layerModels = Object.keys(files).filter((f) => /\/(lm|layer)_[^/]+\.kn5$/.test(f)).map((f) => readKn5(files[f]));
for (const lm of layerModels) walk(lm.root, 2, "LAYERS");

// Texture sizes from their headers.
const dims = (d: Uint8Array): [number, number, number] => {
  if (d[0] === 0x89 && d[1] === 0x50) {
    const v = new DataView(d.buffer, d.byteOffset);
    return [v.getUint32(16), v.getUint32(20), 4];
  }
  if (d[0] === 0x44 && d[1] === 0x44 && d[2] === 0x53) {
    const v = new DataView(d.buffer, d.byteOffset);
    const h = v.getUint32(12, true), w = v.getUint32(16, true);
    const fourcc = String.fromCharCode(d[84], d[85], d[86], d[87]);
    return [w, h, fourcc === "DXT1" ? 0.5 : fourcc === "DXT5" || fourcc === "DXT3" ? 1 : 4];
  }
  return [0, 0, 0];
};
let texBytes = 0;
for (const t of [...model.textures, ...layerModels.flatMap((m) => m.textures)]) {
  const [w, h, bpp] = dims(t.data);
  texBytes += w * h * bpp * 1.33;
}
const textureMB = texBytes / 1048576;
const kn5MB = files[kn5Name].length / 1048576;

const fmt = (n: number) => n.toLocaleString("en-AU");
console.log(`triangles ${fmt(triangles)} (limit ${fmt(LIMITS.triangles)}), physics ${fmt(physicsTris)}`);
console.log(`meshes (draw calls) ${fmt(meshes)} (limit ${fmt(LIMITS.meshes)})`);
console.log(`textures ${model.textures.length}, about ${textureMB.toFixed(0)} MB in video memory (limit ${LIMITS.textureMB})`);
console.log(`kn5 ${kn5MB.toFixed(0)} MB (limit ${LIMITS.kn5MB})`);
const top = [...byGroup.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log("biggest groups: " + top.map(([g, t]) => `${g} ${fmt(t)}`).join(", "));
// --groups: every group, and the mesh names (digits and part numbers dropped) inside it, to compare two builds.
if (process.argv.includes("--groups")) {
  const byName = new Map<string, number>();
  const names = (n: Kn5Node, depth: number, group: string) => {
    if (n.kind === "mesh") {
      if (n.renderable === false) return;
      const key = `${group || "-"} ${n.name.replace(/_T\d+$/, "").replace(/_\d+$/, "").replace(/\d+/g, "#")}`;
      byName.set(key, (byName.get(key) ?? 0) + n.indices.length / 3);
    } else n.children.forEach((c) => names(c, depth + 1, depth >= 2 ? group : c.kind === "mesh" ? group : c.name));
  };
  names(model.root, 0, "");
  for (const [g, t] of [...byGroup.entries()].sort((a, b) => b[1] - a[1])) console.log(`group ${g} ${t}`);
  for (const [k, t] of [...byName.entries()].sort((a, b) => b[1] - a[1])) if (t >= 500) console.log(`mesh ${k} ${t}`);
}
const over = [
  triangles > LIMITS.triangles && "triangles",
  meshes > LIMITS.meshes && "meshes",
  textureMB > LIMITS.textureMB && "texture memory",
  kn5MB > LIMITS.kn5MB && "kn5 size",
].filter(Boolean);
if (over.length) {
  console.log(`OVER BUDGET: ${over.join(", ")}`);
  process.exit(1);
}
console.log("within budget");
