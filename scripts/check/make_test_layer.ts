// A test layer: a bright marker box (8 x 8 m, 10 m tall) at a lng/lat, as a hand-made layer would be,
// with its sidecar clearing the generated houses and trees within `radius` metres.
//   npx tsx scripts/check/make_test_layer.ts <out dir> <lng> <lat> <origin lng> <origin lat> [radius=15] [ground height=3]
// The origin is the route's build.origin (layers are in the same AC world coordinates as the track).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LocalProjection } from "../../src/core/geo";
import { IDENTITY, writeKn5 } from "../../src/core/kn5";
import { MeshBuilder } from "../../src/core/mesh";
import { solidTexture } from "../../src/core/textures";

const [dir, lng, lat, olng, olat, rad, gh] = process.argv.slice(2);
const proj = new LocalProjection([Number(olng), Number(olat)]);
const [x, y] = proj.toLocal([Number(lng), Number(lat)]);
const z0 = Number(gh ?? 3);
const mb = new MeshBuilder();
const c: [number, number][] = [[x - 4, y - 4], [x + 4, y - 4], [x + 4, y + 4], [x - 4, y + 4]];
for (let k = 0; k < 4; k++) {
  const p = c[k], q = c[(k + 1) % 4], i = mb.vertexCount;
  mb.vertex([p[0], p[1], z0 - 1], 0, 1); mb.vertex([q[0], q[1], z0 - 1], 1, 1); mb.vertex([q[0], q[1], z0 + 10], 1, 0); mb.vertex([p[0], p[1], z0 + 10], 0, 0);
  mb.quad(i, i + 1, i + 2, i + 3);
}
const i = mb.vertexCount;
for (const p of c) mb.vertex([p[0], p[1], z0 + 10], 0, 0);
mb.quad(i, i + 1, i + 2, i + 3);
const kn5 = writeKn5({
  textures: [{ name: "test_marker.png", data: solidTexture([255, 0, 200]) }],
  materials: [{ name: "test_marker", shader: "ksPerPixel", properties: [{ name: "ksAmbient", a: 0.6 }, { name: "ksDiffuse", a: 0.4 }, { name: "ksSpecular", a: 0 }, { name: "ksSpecularEXP", a: 1 }, { name: "ksEmissive", c: [0, 0, 0] }, { name: "ksAlphaRef", a: 0 }], textures: { txDiffuse: "test_marker.png" } }],
  root: { kind: "node", name: "test_marker", transform: IDENTITY, children: [mb.toKn5("TEST_MARKER", "test_marker")] },
});
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "test_marker.kn5"), kn5);
writeFileSync(join(dir, "test_marker.json"), JSON.stringify({ note: "test layer", replaces: [{ at: [Number(lng), Number(lat)], radius: Number(rad ?? 15) }] }, null, 2));
console.log(`wrote ${dir}/test_marker.kn5 at local ${x.toFixed(1)}, ${y.toFixed(1)}`);
