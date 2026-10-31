// S7, the buildings plan (track.md S7 and 5a): mapped footprints, roofs found in the photo,
// houses guessed along street fronts in built-up places; filtered off the road, the rings, the
// streets and the jetties; dressed; and their facades and roofs registered.

import { centroid, filterBuildings, fromOsm, isRectangle, pointInRing, ringArea, usedFinishes, type Building } from "../buildings";
import { dressBuilding, FACADES, facadeTexture, ROOF_COLOURS, roofTexture } from "../buildingStyles";
import { chunkPhotoSampler, frontageHouses } from "../frontage";
import type { Vec2 } from "../geo";
import { inRoundabout } from "../road";
import { onWater } from "../waterBuildings";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { Imagery } from "./imagery";
import type { Registry } from "./registry";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";

export interface BuildingPlan {
  /** Every building kept, dressed. */
  kept: Building[];
  /** Road edge distance: the route's edge or a street's, whichever is nearer. */
  roadEdge: (x: number, y: number) => number;
  /** POIs, local. */
  pois: { at: Vec2; cls: string; subclass: string; name?: string }[];
  photo: ReturnType<typeof chunkPhotoSampler>;
  /** Facade and roof finishes registered so far. */
  finishes: { facades: Set<number>; roofs: Set<number> };
}

const SHOP_LIKE = /^(shop|grocery|clothing_store|cafe|restaurant|fast_food|bar|pub)$/;
const REAL_STREET = /^(primary|secondary|tertiary|minor)/;

/** A facade's texture and material. */
export function facadeScenery(reg: Registry, i: number): void {
  reg.building(`facade_${FACADES[i].name}`, facadeTexture(FACADES[i]), { ambient: 0.45, diffuse: 0.45, specular: 0.05, exp: 10 }, 3);
}

/** A roof finish's texture and material (metal shines more). */
export function roofScenery(reg: Registry, i: number): void {
  const c = ROOF_COLOURS[i];
  reg.building(`roof_${c.name}`, roofTexture(c), { ambient: 0.45, diffuse: 0.45, specular: c.kind === "metal" ? 0.25 : 0.05, exp: 25 }, 4);
}

/** The street wall, a POI's class and the dress of every building (5a). */
function dressBuildings(kept: Building[], roadEdge: (x: number, y: number) => number, pois: BuildingPlan["pois"]): void {
  for (const b of kept) {
    const ring = b.ring;
    if (!b.front && ring.length >= 3) {
      const ccw = ringArea(ring) >= 0;
      let best = 25;
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k], c = ring[(k + 1) % ring.length];
        const dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy);
        if (len < 3) continue;
        const mid: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        const e = roadEdge(mid[0], mid[1]);
        if (!(e < best)) continue;
        const n: Vec2 = ccw ? [dy / len, -dx / len] : [-dy / len, dx / len];
        if (!(roadEdge(mid[0] + n[0] * 2, mid[1] + n[1] * 2) < e - 1)) continue;
        best = e;
        b.front = [a, c];
        b.setback = e;
      }
    }
    const inside = pois.filter((p) => pointInRing(p.at[0], p.at[1], ring));
    const poi = inside.find((p) => SHOP_LIKE.test(p.cls)) ?? inside[0];
    const t = b.tags ?? {};
    const knownHeight = !!(t.height || t["building:levels"] || (t.render_height && t.render_height !== "5"));
    const [cx, cy] = centroid(ring);
    const seed = (Math.imul(Math.round(cx * 10) | 0, 73856093) ^ Math.imul(Math.round(cy * 10) | 0, 19349663)) >>> 0;
    const dress = dressBuilding({
      height: b.source === "osm" && knownHeight ? b.height : undefined,
      kind: t.building,
      area: Math.abs(ringArea(ring)),
      poi: poi?.cls,
      photoRoof: b.source !== "osm" || t["roof:colour"] ? b.roofColour : undefined,
      rectangle: isRectangle(ring),
      fronted: (b.setback ?? Infinity) < 15,
      seed,
    });
    Object.assign(b, dress, { garage: dress.garage ?? b.garage });
  }
}

export function planBuildings(ctx: BuildContext, rp: RoutePlan, g: Ground, st: Streets, img: Imagery, reg: Registry): BuildingPlan {
  const { opts, sources } = ctx;
  const plan = rp.plan, index = g.index, streetIndex = st.streetIndex;
  const mapped = opts.buildings ? (sources.osm?.buildings ?? []).map((b, i) => fromOsm(ctx.line(b.ring), b.tags, i)) : [];
  const photo = chunkPhotoSampler(img.photos);
  const pois = (sources.pois ?? []).map((p) => ({ ...p, at: ctx.toLocal(p.at) }));
  const roadEdge = (x: number, y: number) => {
    const n = index.nearest(x, y, 40);
    return Math.min(n ? n.dist - index.at(n).width / 2 : Infinity, streetIndex.clearance(x, y));
  };

  let frontage: Building[] = [];
  if (photo && opts.buildings && opts.detectBuildings) {
    const streets = st.streetPlan.streets;
    const realStreets = streets.filter((s) => REAL_STREET.test(s.cls));
    const known = [...mapped, ...img.detected].map((b) => centroid(b.ring));
    const cells = new Map<string, boolean>();
    const builtUp = (x: number, y: number) => {
      const cx = Math.floor(x / 50), cy = Math.floor(y / 50), key = `${cx},${cy}`;
      let v = cells.get(key);
      if (v === undefined) {
        const px = (cx + 0.5) * 50, py = (cy + 0.5) * 50;
        v = known.filter(([kx, ky]) => Math.hypot(kx - px, ky - py) < 150).length >= 4
          || realStreets.filter((s) => s.pts.some(([sx, sy]) => Math.hypot(sx - px, sy - py) < 120)).length >= 3;
        cells.set(key, v);
      }
      return v;
    };
    const onRoad = (x: number, y: number) => {
      const n = index.nearest(x, y, 30);
      return (!!n && n.dist < index.at(n).width / 2 + 1) || streetIndex.clearance(x, y) < 1;
    };
    frontage = frontageHouses(
      [{ pts: plan.samples.map((s) => s.pos), half: plan.samples.map((s) => s.width / 2) },
        ...streets.map((s) => ({ pts: s.pts, half: s.pts.map((_, i) => (s.widths?.[i] ?? s.width) / 2) }))],
      photo, onRoad, builtUp, [...mapped, ...img.detected], plan.samples.length,
    );
  }

  const jettyHouses = (g.jettyFeatures?.buildings ?? []).filter((b) => b.pts.some(([x, y]) => g.onJetty(x, y) || g.sea.has(x, y)));
  const kept = filterBuildings([...mapped, ...img.detected, ...frontage], index, opts, opts.buildingRadius).filter((b) => {
    if (b.ring.some(([x, y]) => inRoundabout(plan, x, y, opts.vergeWidth + 2))) return false;
    const min = b.source === "osm" ? -0.5 : 1;
    if (b.ring.some(([x, y]) => streetIndex.clearance(x, y) < min)) return false;
    const [cx, cy] = centroid(b.ring);
    if (g.onJetty(cx, cy)) return false;
    return !jettyHouses.some((j) => pointInRing(cx, cy, j.pts));
  })
    // No generated or detected building on water; mapped ones stand, marked for the shore check (waterBuildings.ts).
    .filter((b) => b.source === "osm" || !onWater(b.ring, g.shoreAt));
  if (g.shore) for (const b of kept) if (b.source === "osm" && onWater(b.ring, g.shoreAt)) g.shore.mark(b.ring, "mapped");
  dressBuildings(kept, roadEdge, pois);

  const finishes = usedFinishes(kept);
  for (const i of finishes.facades) facadeScenery(reg, i);
  for (const i of finishes.roofs) roofScenery(reg, i);
  return { kept, roadEdge, pois, photo, finishes };
}
