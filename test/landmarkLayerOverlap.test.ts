// A landmark built from a spec (a route's "looks") and a hand-made layer (its "layers") in the same
// spot both get built: retest 4 found two Cape Naturaliste lighthouses, the Blender layer and the
// spec tower, one inside the other. A layer's sidecar says what it replaces; no spec landmark of the
// same route may stand inside one of those circles.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type LngLat = [number, number];
const root = new URL("..", import.meta.url).pathname;
const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
const metres = (a: LngLat, b: LngLat) => {
  const mx = 111_320 * Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * mx, (a[1] - b[1]) * 111_320);
};

describe("spec landmarks and layers", () => {
  const routes = readdirSync(join(root, "routes")).filter((f) => f.endsWith(".json"));
  for (const f of routes) {
    const route = read(`routes/${f}`);
    if (!route.looks?.length || !route.layers?.length) continue;
    it(`${f}: no spec landmark inside a layer's replaced circle`, () => {
      const looks: { at: LngLat; specFile?: string; name?: string }[] = route.looks
        .flatMap((p: string) => (existsSync(join(root, p)) ? read(p).houses ?? [] : []))
        .filter((h: { specFile?: string }) => h.specFile);
      const circles: { at: LngLat; radius: number; layer: string }[] = [];
      for (const dir of route.layers as string[]) {
        if (!existsSync(join(root, dir))) continue;
        for (const s of readdirSync(join(root, dir)).filter((n) => n.endsWith(".json"))) {
          for (const r of read(`${dir}/${s}`).replaces ?? []) circles.push({ ...r, layer: s });
        }
      }
      const clashes = looks.flatMap((h) => circles.filter((c) => metres(h.at, c.at) < c.radius).map((c) => `${h.name ?? h.specFile} in ${c.layer}`));
      expect(clashes).toEqual([]);
    });
  }
});
