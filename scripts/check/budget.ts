// A build's performance budget: what the GPU has to draw and hold, checked against limits that keep
// the workstation's RTX 4060 (8 GB) smooth with a few cars and CSP on.
//
//   npx tsx scripts/check/budget.ts out/<slug>.zip
//
// Draw calls are counted as visible meshes (one material each); texture memory as the decoded
// size with mipmaps (DDS at its compressed size). Exits non-zero over a limit.
//
// Triangles and draw calls are counted twice: stored (every mesh in the kn5s) and at the worst
// viewpoint, where meshes with a draw distance (lodIn to lodOut, from the mesh's centre: local cars'
// two LODs, markings, furniture) count only from points they show at. The viewpoints are every 10 m
// along every layout's AI line, 1.2 m up. The worst viewpoint's triangles are what the GPU draws at
// once; stored triangles and kn5 size keep their own limits.

import { readFileSync } from "node:fs";
import { unzipSync } from "fflate";
import { readFastLaneAi } from "../../src/core/aiSpline";
import { readKn5, type Kn5Node } from "../../src/core/kn5";

// Triangles are cheap for the 4060 (AC culls per mesh); draw calls are what AC's single-threaded DX11
// renderer feels, so meshes keep the tight limit. Triangles raised from 1.5M to 2M on 3 Nov 2026
// (Mac's question: big community maps carry far more); to be set from retest 6's frame rates.
const LIMITS = { triangles: 2_000_000, meshes: 4000, textureMB: 1500, kn5MB: 600 };

const files = unzipSync(new Uint8Array(readFileSync(process.argv[2])));
// The world kn5 (<slug>/<slug>.kn5), not a layout's dummies or a layer.
const kn5Name = Object.keys(files).find((f) => { const [d, b] = f.split("/"); return b === `${d}.kn5`; }) ?? Object.keys(files).find((f) => f.endsWith(".kn5"))!;
const model = readKn5(files[kn5Name]);

let triangles = 0, meshes = 0, physicsTris = 0;
const byGroup = new Map<string, number>();
/** Meshes with a draw distance: centre (AC x, y, z, the bounding box's middle, as the kn5's sphere), lodIn, lodOut, triangles. */
const ranged: { c: [number, number, number]; lodIn: number; lodOut: number; t: number }[] = [];
let alwaysTris = 0, alwaysMeshes = 0;
const centreOf = (p: Float32Array): [number, number, number] => {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[i + k]); hi[k] = Math.max(hi[k], p[i + k]); }
  return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
};
// Group = the named node two levels down (root > track > GROUP), or one down when that's all there is.
const walk = (n: Kn5Node, depth: number, group: string) => {
  if (n.kind === "mesh") {
    const t = n.indices.length / 3;
    if (/^[0-9]/.test(n.name)) physicsTris += t;
    if (n.renderable === false) return;
    triangles += t;
    meshes++;
    if ((n.lodIn ?? 0) > 0 || (n.lodOut ?? 0) > 0) ranged.push({ c: centreOf(n.positions), lodIn: n.lodIn ?? 0, lodOut: n.lodOut || Infinity, t });
    else { alwaysTris += t; alwaysMeshes++; }
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

// The worst viewpoint: every 10 m along every layout's AI line.
const views: [number, number, number][] = [];
for (const f of Object.keys(files).filter((k) => k.endsWith("/ai/fast_lane.ai"))) {
  let last: number[] | null = null;
  for (const p of readFastLaneAi(files[f])) {
    if (last && Math.hypot(p.position[0] - last[0], p.position[2] - last[2]) < 10) continue;
    views.push([p.position[0], p.position[1] + 1.2, p.position[2]]);
    last = p.position;
  }
}
let worst = { tris: alwaysTris, meshes: alwaysMeshes, at: null as [number, number, number] | null };
if (ranged.length) {
  // Ranged meshes on a 50 m grid, so each view only looks at the ones that could show from it.
  const CELL = 50, reach = Math.max(...ranged.map((r) => (Number.isFinite(r.lodOut) ? r.lodOut : 0)));
  const far = ranged.filter((r) => !Number.isFinite(r.lodOut)), grid = new Map<string, typeof ranged>();
  for (const r of ranged) if (Number.isFinite(r.lodOut)) {
    const k = `${Math.floor(r.c[0] / CELL)},${Math.floor(r.c[2] / CELL)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(r);
  }
  const span = Math.ceil(reach / CELL);
  for (const v of views) {
    let tris = alwaysTris, ms = alwaysMeshes;
    const add = (r: (typeof ranged)[number]) => {
      const d = Math.hypot(r.c[0] - v[0], r.c[1] - v[1], r.c[2] - v[2]);
      if (d >= r.lodIn && d < r.lodOut) { tris += r.t; ms++; }
    };
    far.forEach(add);
    const gx = Math.floor(v[0] / CELL), gz = Math.floor(v[2] / CELL);
    for (let i = gx - span; i <= gx + span; i++) for (let j = gz - span; j <= gz + span; j++) (grid.get(`${i},${j}`) ?? []).forEach(add);
    if (tris > worst.tris || !worst.at) worst = { tris, meshes: ms, at: v };
  }
}

const fmt = (n: number) => n.toLocaleString("en-AU");
console.log(`triangles stored ${fmt(triangles)} (limit ${fmt(LIMITS.triangles)}), physics ${fmt(physicsTris)}`);
console.log(`triangles at the worst viewpoint ${fmt(worst.tris)} (limit ${fmt(LIMITS.triangles)}), with ${fmt(worst.meshes)} meshes drawn` +
  (worst.at ? `, at x ${worst.at[0].toFixed(0)} z ${worst.at[2].toFixed(0)} (${views.length} viewpoints, ${ranged.length} meshes with a draw distance)` : " (no AI line or nothing with a draw distance: every mesh counted)"));
console.log(`meshes (draw calls) stored ${fmt(meshes)} (limit ${fmt(LIMITS.meshes)})`);
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
  triangles > LIMITS.triangles && "stored triangles",
  worst.tris > LIMITS.triangles && "triangles at the worst viewpoint",
  meshes > LIMITS.meshes && "meshes",
  textureMB > LIMITS.textureMB && "texture memory",
  kn5MB > LIMITS.kn5MB && "kn5 size",
].filter(Boolean);
if (over.length) {
  console.log(`OVER BUDGET: ${over.join(", ")}`);
  process.exit(1);
}
console.log("within budget");
