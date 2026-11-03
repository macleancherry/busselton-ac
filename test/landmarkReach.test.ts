// Landmarks off the road only get detailed ground (and get built) where the build reaches: the
// corridor along the drive or a `build.area` patch. The capes' lighthouses and cottages stand
// 100-250 m off the road's end, on landmark patches. Every spec landmark (a route's "looks") and
// every layer's replaced circle (its "layers") must sit inside one of the route's area polygons, or
// within EDGE metres of one, where the corridor or the patch's own ground still carries it, or stand
// beside the drive (within the corridor of the line through the route's pins).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type LngLat = [number, number];
const root = new URL("..", import.meta.url).pathname;
const read = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8"));
/** How far outside an area polygon a landmark may stand, m. */
const EDGE = 25;

const toM = (o: LngLat) => {
  const mx = 111_320 * Math.cos((o[1] * Math.PI) / 180);
  return (p: LngLat): LngLat => [(p[0] - o[0]) * mx, (p[1] - o[1]) * 111_320];
};

function inside(p: LngLat, ring: LngLat[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** Distance (m) from p to a ring, 0 inside it. */
function distance(p: LngLat, ring: LngLat[]): number {
  if (inside(p, ring)) return 0;
  const m = toM(p);
  const r = ring.map(m);
  let best = Infinity;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[j], b = r[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(a[0] + dx * t, a[1] + dy * t));
  }
  return best;
}

describe("landmarks within the build's reach", () => {
  const routes = readdirSync(join(root, "routes")).filter((f) => f.endsWith(".json"));
  for (const f of routes) {
    const route = read(`routes/${f}`);
    if (!route.looks?.length && !route.layers?.length) continue;
    it(`${f}: every spec landmark and layer inside its area`, () => {
      const spots: { at: LngLat; what: string }[] = [];
      for (const p of (route.looks ?? []) as string[]) {
        if (!existsSync(join(root, p))) continue;
        for (const h of read(p).houses ?? []) if (h.specFile) spots.push({ at: h.at, what: h.name ?? h.specFile });
      }
      for (const dir of (route.layers ?? []) as string[]) {
        if (!existsSync(join(root, dir))) continue;
        for (const s of readdirSync(join(root, dir)).filter((n) => n.endsWith(".json"))) {
          for (const r of read(`${dir}/${s}`).replaces ?? []) spots.push({ at: r.at, what: s });
        }
      }
      let area: LngLat[][] = route.build?.area ?? [];
      if (area.length && typeof (area[0] as unknown as LngLat)[0] === "number") area = [area as unknown as LngLat[]];
      // A landmark beside the drive itself is in the corridor: the pins' line stands in for the drive
      // (pins sit on the road, mid-block), as an open ring of segments.
      const pins: LngLat[] = route.pins ?? [];
      const corridor = Number(route.build?.corridor ?? 60);
      const onDrive = (p: LngLat) => {
        for (let i = 1; i < pins.length; i++) if (distance(p, [pins[i - 1], pins[i]]) <= corridor) return true;
        return false;
      };
      const far = spots
        .filter((s) => !onDrive(s.at))
        .map((s) => ({ ...s, d: Math.min(Infinity, ...area.map((ring) => distance(s.at, ring))) }))
        .filter((s) => s.d > EDGE)
        .map((s) => `${s.what} ${Number.isFinite(s.d) ? Math.round(s.d) + " m" : "(no area)"} outside`);
      expect(far).toEqual([]);
    });
  }
});
