// Writes every local-cars body and variant at both LODs (and today's boxy parked car, for
// comparison) as JSON meshes plus their atlases, for scripts/cars/render_vehicles.py. Prints each
// one's triangle count.
//
//   npx tsx scripts/cars/export_vehicles.ts <out dir>
//
// Each <body>_<variant>_lod<n>.json (and <body>_lod<n>.json for the plain one):
// { tris, texture, pos: [f, s, h ...], uv: [u, v ...] (v down), idx: [...], dims }.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildParkedCars, carTexture, PAINT } from "../../src/core/parkedCars";
import { BODIES } from "../../src/core/vehicles/index";
import { atlasPng, swatchUv, type VehicleMesh } from "../../src/core/vehicles/vehicle";

const out = process.argv[2] ?? "out/local_cars";
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "atlas.png"), atlasPng());
writeFileSync(join(out, "parked_car.png"), carTexture());

/** A template with one paint applied (what each parked car's copy does). */
function painted(m: VehicleMesh, paint: number) {
  const uv = m.uv.slice();
  const [pu, pv] = swatchUv(paint);
  m.paint.forEach((p, i) => {
    if (p) [uv[i * 2], uv[i * 2 + 1]] = [pu, pv];
  });
  return { tris: m.idx.length / 3, texture: "atlas.png", pos: m.pos, uv, idx: m.idx };
}

// A paint per body, so the lineup isn't all white (index into PAINT).
const COLOUR: Record<string, number> = {
  ute: 0, trayute: 0, wagon4wd: 11, suv: 7, suvsmall: 8, hatch: 3, sedan: 2, van: 1, passute: 9, stationwagon: 6,
};

const rows: string[] = [];
for (const b of BODIES) {
  const names = Object.keys(b.variants);
  for (const v of names) {
    const counts: number[] = [];
    for (const lod of [0, 1] as const) {
      const m = b.build(b.variants[v], lod);
      const name = v === "plain" ? `${b.id}_lod${lod}` : `${b.id}_${v}_lod${lod}`;
      const j = { ...painted(m, COLOUR[b.id] ?? 0), dims: b.dimensions(b.variants[v]) };
      writeFileSync(join(out, `${name}.json`), JSON.stringify(j));
      counts.push(j.tris);
    }
    rows.push(`${`${b.id} ${v}`.padEnd(24)} LOD0 ${String(counts[0]).padStart(4)}   LOD1 ${String(counts[1]).padStart(4)}`);
  }
}
console.log(rows.join("\n"));

// Today's car: one, at the origin facing east (f = x), white, on flat ground. kn5 positions are AC
// (x east, y up, z south): f = x, s = -z, h = y.
const [mesh] = buildParkedCars([{ at: [0, 0], dir: [1, 0], paint: 0 }], () => 0);
const p = Array.from(mesh.positions), pos: number[] = [];
for (let i = 0; i < p.length; i += 3) pos.push(p[i], -p[i + 2], p[i + 1]);
const box = { tris: mesh.indices.length / 3, texture: "parked_car.png", pos, uv: Array.from(mesh.uvs), idx: Array.from(mesh.indices) };
writeFileSync(join(out, "boxy_car.json"), JSON.stringify(box));
console.log(`boxy_car (today): ${box.tris} triangles; paints available: ${PAINT.length}`);
