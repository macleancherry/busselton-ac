// Which meshes are at a spot: name, material and height range of their vertices within R metres.
//   npx tsx scripts/check/meshes_at.ts out/<slug>.zip <x> <z> [r=10]     (AC coordinates: x east, z south)
import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readKn5, type Kn5Node } from "../../src/core/kn5";

const [zipPath, xs, zs, rs] = process.argv.slice(2);
const X = Number(xs), Z = Number(zs), R = Number(rs ?? 10);
const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
const kn5 = readKn5(files[Object.keys(files).find((f) => { const [d, b] = f.split("/"); return b === `${d}.kn5`; }) ?? Object.keys(files).find((f) => f.endsWith(".kn5"))!]);
const rows: [string, string, number, number, number][] = [];
const walk = (n: Kn5Node) => {
  if (n.kind === "mesh") {
    let lo = Infinity, hi = -Infinity, c = 0;
    for (let i = 0; i < n.positions.length; i += 3) {
      if (Math.hypot(n.positions[i] - X, n.positions[i + 2] - Z) > R) continue;
      lo = Math.min(lo, n.positions[i + 1]);
      hi = Math.max(hi, n.positions[i + 1]);
      c++;
    }
    if (c) rows.push([n.name, (n as any).material ?? (n as any).materialName ?? "", c, lo, hi]);
  } else n.children.forEach(walk);
};
walk(kn5.root);
for (const [name, mat, c, lo, hi] of rows.sort((a, b) => a[3] - b[3])) console.log(`${name.padEnd(30)} ${String(mat).padEnd(26)} ${String(c).padStart(5)} verts  y ${lo.toFixed(2)}..${hi.toFixed(2)}`);
