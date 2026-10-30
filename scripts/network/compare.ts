// The network-core prototype (src/core/network) against a built track, junction by junction.
//   npx tsx scripts/network/compare.ts --zip <track.zip> --osm <overpass.json> --route <route.json> \
//     --at <name=lng,lat> [--at ...] [--radius 35] [--out out/network]
// <overpass.json> is an Overpass "out tags geom" response (the build's cache holds them). For each
// spot: the prototype's junction and its edges, and the built track's drivable meshes (1ROAD_ and
// 1STREET_, not paths) around it, rasterised on a 0.25 m grid. Writes <out>/<name>.json (metrics
// and grids, for plot_compare.py) and <out>/<name>.{current,proto}.glb (AC coordinates).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { LocalProjection, type LngLat } from "../../src/core/geo";
import { readKn5, IDENTITY, type Kn5MeshNode, type Kn5Model, type Kn5Node } from "../../src/core/kn5";
import { kn5ToGlb } from "../../src/core/gltf";
import { buildNetwork, type Tris } from "../../src/core/network";
import { dist, type P2 } from "../../src/core/network/geom";
import { demTiles } from "../polish/demTiles";
import { overpassWays } from "./ways";

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const all = (k: string) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const zipPath = opt("--zip")!, osmPath = opt("--osm")!, routePath = opt("--route")!;
const R = Number(opt("--radius", "35"));
const outDir = opt("--out", "out/network")!;
mkdirSync(outDir, { recursive: true });

const route = JSON.parse(readFileSync(routePath, "utf8"));
const proj = new LocalProjection(route.build.origin as LngLat);
const osm = JSON.parse(readFileSync(osmPath, "utf8"));
const { ways } = overpassWays(osm, proj);
const spots = all("--at").map((s) => {
  const [name, ll] = s.includes("=") ? s.split("=") : [s.replace(/[^0-9.-]+/g, "_"), s];
  return { name, ll: ll.split(",").map(Number) as LngLat };
});
const demAt = await demTiles("public/dem/wa", spots.map((s) => s.ll));
const height = (x: number, y: number) => demAt(proj.toLngLat([x, y])) ?? 0;

const files = unzipSync(new Uint8Array(readFileSync(zipPath)));
const baseName = Object.keys(files).find((f) => { const [d, b] = f.split("/"); return b === `${d}.kn5`; })!;
const base = readKn5(files[baseName]);
const meshes: Kn5MeshNode[] = [];
const walk = (n: Kn5Node) => (n.kind === "mesh" ? meshes.push(n) : n.children.forEach(walk));
walk(base.root);
const drivable = meshes.filter((m) => /^1(ROAD|STREET)_/.test(m.name) && !/^1ROAD_PATH/.test(m.name));

// Triangles in local [x, y, h] near a spot.
type Tri = [number, number, number][];
const trisOfKn5 = (c: P2): { tris: Tri[]; names: Set<string> } => {
  const tris: Tri[] = [], names = new Set<string>();
  for (const m of drivable) {
    const p = m.positions;
    for (let i = 0; i < m.indices.length; i += 3) {
      const v = [m.indices[i], m.indices[i + 1], m.indices[i + 2]].map((k) => [p[k * 3], -p[k * 3 + 2], p[k * 3 + 1]] as [number, number, number]);
      if (v.every((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) > R + 2)) continue;
      tris.push(v);
      names.add(m.name);
    }
  }
  return { tris, names };
};
const trisOf = (t: Tris): Tri[] => {
  const out: Tri[] = [];
  for (let i = 0; i < t.indices.length; i += 3) {
    out.push([0, 1, 2].map((j) => { const k = t.indices[i + j] * 3; return [t.positions[k], t.positions[k + 1], t.positions[k + 2]] as [number, number, number]; }));
  }
  return out;
};

const CELL = 0.25;
function raster(tris: Tri[], c: P2) {
  const n = Math.round((2 * R) / CELL);
  const layers: number[][] = Array.from({ length: n * n }, () => []);
  for (const t of tris) {
    const xs = t.map((v) => v[0]), ys = t.map((v) => v[1]);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - c[0] + R) / CELL)), i1 = Math.min(n - 1, Math.ceil((Math.max(...xs) - c[0] + R) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(...ys) - c[1] + R) / CELL)), j1 = Math.min(n - 1, Math.ceil((Math.max(...ys) - c[1] + R) / CELL));
    const [a, b, d] = t;
    const den = (b[1] - d[1]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[1] - d[1]);
    if (Math.abs(den) < 1e-9) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = c[0] - R + (i + 0.5) * CELL, y = c[1] - R + (j + 0.5) * CELL;
      const w1 = ((b[1] - d[1]) * (x - d[0]) + (d[0] - b[0]) * (y - d[1])) / den;
      const w2 = ((d[1] - a[1]) * (x - d[0]) + (a[0] - d[0]) * (y - d[1])) / den;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
      const h = w1 * a[2] + w2 * b[2] + w3 * d[2];
      const L = layers[j * n + i];
      // Two triangles of one mesh sharing an edge both hit a cell on it: count heights, not triangles.
      if (!L.some((q) => Math.abs(q - h) < 0.002)) L.push(h);
    }
  }
  return { n, layers };
}

function metrics(r: ReturnType<typeof raster>, c: P2) {
  const { n, layers } = r;
  let covered = 0, overlap = 0, maxSpread = 0, lips = 0, maxLip = 0;
  const top: (number | null)[] = layers.map((L) => (L.length ? Math.max(...L) : null));
  const spread: number[] = layers.map((L) => (L.length > 1 ? Math.max(...L) - Math.min(...L) : 0));
  const lip: number[] = new Array(n * n).fill(0);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    const x = c[0] - R + (i + 0.5) * CELL, y = c[1] - R + (j + 0.5) * CELL;
    if (Math.hypot(x - c[0], y - c[1]) > R) continue;
    if (top[k] === null) continue;
    covered++;
    if (spread[k] > 0.01) { overlap++; maxSpread = Math.max(maxSpread, spread[k]); }
    // A lip: the top surface jumps more than 3 cm to a neighbour 0.25 m away (a 12% step).
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const i2 = i + di, j2 = j + dj;
      if (i2 >= n || j2 >= n) continue;
      const t2 = top[j2 * n + i2];
      if (t2 === null) continue;
      const d = Math.abs(t2 - top[k]!);
      if (d > 0.03) { lip[k] = Math.max(lip[k], d); }
    }
    if (lip[k] > 0) { lips++; maxLip = Math.max(maxLip, lip[k]); }
  }
  const a = CELL * CELL;
  return {
    summary: { coveredM2: +(covered * a).toFixed(1), overlapM2: +(overlap * a).toFixed(1), maxOverlapSpreadM: +maxSpread.toFixed(3), lipM2: +(lips * a).toFixed(2), maxLipM: +maxLip.toFixed(3) },
    grids: { top: top.map((v) => (v === null ? null : +v.toFixed(3))), spread: spread.map((v) => +v.toFixed(3)), lip: lip.map((v) => +v.toFixed(3)) },
  };
}

function toGlb(parts: { name: string; tris: Tris }[]): Uint8Array {
  const children: Kn5Node[] = [];
  for (const { name, tris } of parts) {
    const nv = tris.positions.length / 3;
    if (nv === 0 || nv > 65535) continue;
    const positions = new Float32Array(nv * 3), normals = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2);
    for (let i = 0; i < nv; i++) {
      positions[i * 3] = tris.positions[i * 3];
      positions[i * 3 + 1] = tris.positions[i * 3 + 2];
      positions[i * 3 + 2] = -tris.positions[i * 3 + 1];
      normals[i * 3 + 1] = 1;
      uvs[i * 2] = tris.positions[i * 3] / 4;
      uvs[i * 2 + 1] = tris.positions[i * 3 + 1] / 4;
    }
    // Local (x, y, h) anticlockwise from above stays anticlockwise in AC's (x, h, -y) seen from above.
    children.push({ kind: "mesh", name, positions, normals, uvs, indices: Uint16Array.from(tris.indices), material: "proto" });
  }
  const model: Kn5Model = { textures: [], materials: [{ name: "proto", shader: "ksPerPixel", properties: [], textures: {} }], root: { kind: "node", name: "proto", transform: IDENTITY, children } };
  return kn5ToGlb(model);
}

const report: Record<string, unknown> = {};
for (const spot of spots) {
  const c = proj.toLocal(spot.ll) as P2;
  const net = buildNetwork(ways, height, { near: { at: c, radius: 30 } });
  const j = net.junctions.slice().sort((a, b) => dist(net.graph.nodes[a.shape.node].p, c) - dist(net.graph.nodes[b.shape.node].p, c))[0];
  if (!j) { console.log(spot.name, "no junction within 30 m"); continue; }
  const node = net.graph.nodes[j.shape.node];
  const legEdges = new Set(j.shape.legs.map((l) => l.edge));
  const edges = net.edges.filter((e) => legEdges.has(e.profile.edge));
  const protoTris = [...trisOf(j.mesh), ...edges.flatMap((e) => trisOf(e.mesh))];
  const cur = trisOfKn5(c);
  const mc = metrics(raster(cur.tris, c), c);
  const mp = metrics(raster(protoTris, c), c);
  const info = {
    spot: spot.ll, local: c, node: node.id, kind: j.shape.kind,
    legs: j.shape.legs.map((l) => ({ edge: l.edge, cls: net.graph.edges[l.edge].cls, name: net.graph.edges[l.edge].name, halfWidth: l.hw, trim: +l.trim.toFixed(2), crowded: !!l.crowded })),
    field: { planar: j.field.planar, through: j.field.through ?? null, grade: +Math.hypot(...j.field.base.g).toFixed(4), legTerrain: j.field.legTerrain.map((h) => +h.toFixed(3)) },
    polygon: j.mesh.contour.rings.map((r) => r.map(([x, y]) => [+x.toFixed(2), +y.toFixed(2)])),
    protoTriangles: protoTris.length, currentTriangles: cur.tris.length, currentMeshes: [...cur.names].sort(),
    current: mc.summary, proto: mp.summary,
  };
  console.log(spot.name, JSON.stringify({ kind: info.kind, legs: info.legs.length, field: info.field, current: info.current, proto: info.proto, currentMeshes: info.currentMeshes.length }));
  report[spot.name] = info;
  writeFileSync(join(outDir, `${spot.name}.json`), JSON.stringify({ ...info, R, cell: CELL, centre: c, gridsCurrent: mc.grids, gridsProto: mp.grids }));
  // Both cut to the same circle, as triangle soups (kn5 meshes hold at most 65535 vertices).
  const soup = (label: string, tris: Tri[]) => {
    const near = tris.filter((t) => t.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) <= R + 2));
    const out: { name: string; tris: Tris }[] = [];
    for (let s = 0; s < near.length; s += 20000) {
      const part = near.slice(s, s + 20000);
      out.push({ name: `${label}${s / 20000}`, tris: { positions: part.flat().flat(), indices: part.flatMap((_, i) => [i * 3, i * 3 + 1, i * 3 + 2]) } });
    }
    return out;
  };
  writeFileSync(join(outDir, `${spot.name}.proto.glb`), toGlb(soup("proto", protoTris)));
  const chunks = soup("current", cur.tris);
  writeFileSync(join(outDir, `${spot.name}.current.glb`), toGlb(chunks));
}
writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 1));
