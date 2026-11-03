// Writes the local-cars prototypes (and today's boxy parked car, for comparison) as JSON meshes plus
// their atlases, for scripts/cars/render_vehicles.py. Prints each one's triangle count.
//
//   npx tsx scripts/cars/export_vehicles.ts <out dir>
//
// Each <name>.json: { tris, texture, pos: [f, s, h ...], uv: [u, v ...] (v down), idx: [...] }.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildParkedCars, carTexture, PAINT } from "../../src/core/parkedCars";
import { atlasPng, swatchUv, type VehicleMesh } from "../../src/core/vehicles/vehicle";
import { buildUte, type UteSpec } from "../../src/core/vehicles/ute";

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

const white = 0, silver = 2, blue = 7;
const models: [string, Partial<UteSpec>, 0 | 1, number][] = [
  ["ute_lod0", {}, 0, white],
  ["ute_lod1", {}, 1, white],
  ["ute_tradie_lod0", { bullBar: true, snorkel: true, tray: "canopy", flares: false, roofRack: true }, 0, white],
  ["ute_tradie_lod1", { bullBar: true, snorkel: true, tray: "canopy", flares: false, roofRack: true }, 1, white],
  ["ute_sports_lod0", { tray: "sportsBar" }, 0, silver],
  ["ute_rack_lod0", { tray: "rack", bullBar: true, barSwatch: 0 }, 0, blue],
];
for (const [name, spec, lod, paint] of models) {
  const m = painted(buildUte(spec, lod), paint);
  writeFileSync(join(out, `${name}.json`), JSON.stringify(m));
  console.log(`${name}: ${m.tris} triangles`);
}

// Today's car: one, at the origin facing east (f = x), white, on flat ground. kn5 positions are AC
// (x east, y up, z south): f = x, s = -z, h = y.
const [mesh] = buildParkedCars([{ at: [0, 0], dir: [1, 0], paint: 0 }], () => 0);
const p = Array.from(mesh.positions), pos: number[] = [];
for (let i = 0; i < p.length; i += 3) pos.push(p[i], -p[i + 2], p[i + 1]);
const box = { tris: mesh.indices.length / 3, texture: "parked_car.png", pos, uv: Array.from(mesh.uvs), idx: Array.from(mesh.indices) };
writeFileSync(join(out, "boxy_car.json"), JSON.stringify(box));
console.log(`boxy_car (today): ${box.tris} triangles; paints available: ${PAINT.length}`);
