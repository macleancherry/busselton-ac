// S16 and S19.2-4, parked cars (track.md): the cars painted out of the photo put back in bays
// (car park aisles, kerbside bays); then, with the model assembled and the traffic lanes known,
// every car clear of the roads, rings and lanes, the bays' pads, and the cars standing on them.

import { BAY_ASPHALT, bayHeight } from "../bayGround";
import { pointInRing } from "../buildings";
import { cullable } from "../cull";
import type { Vec2 } from "../geo";
import { IDENTITY, type Kn5GroupNode, type Kn5MeshNode, type Kn5Model } from "../kn5";
import { material } from "../materials";
import { clearBays, feetNear } from "../padClear";
import { buildParkedCars, carSeat, carTexture, TYRE_SINK } from "../parkedCars";
import { ASPHALT, offAsphaltAt } from "../parkedCheck";
import { clearParked, ROUTE_ROAD } from "../parkedClear";
import { buildBayPads, placeParked, type BayQuad, type PlaceResult, type PlacedCar } from "../parkedPlacement";
import { outerRadius } from "../roundabout";
import { PHYSICS_GROUND, topSurface } from "../sceneGround";
import { LineIndex } from "../sideStreets";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { GroundMeshes } from "./groundMeshes";
import type { Houses } from "./houses";
import type { Imagery } from "./imagery";
import type { Registry } from "./registry";
import type { RoadSurfaces } from "./roadMeshes";
import type { Rings } from "./rings";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";
import type { Traffic } from "./traffic";
import type { TrackResult } from "./types";

const NO_TRAFFIC_SERVICE = /^(parking_aisle|driveway|drive-through)$/;

export interface ParkedFirst {
  placed: PlaceResult | null;
  parked: PlacedCar[];
  bayQuads: BayQuad[];
  /** Through streets (no aisles or driveways). */
  through: LineIndex;
}

/** S16: the photo's cars in bays (or, with parkedBays false, the old filter). Reads `shown` before the clears (B3). */
export function placeParkedFirst(ctx: BuildContext, rp: RoutePlan, g: Ground, st: Streets, img: Imagery, rn: Rings, hs: Houses): ParkedFirst {
  const { opts, sources } = ctx;
  const plan = rp.plan, index = g.index;
  const streetCentres = new LineIndex(img.streetLines.map((pts) => ({ pts, width: 0 })));
  const through = new LineIndex(st.streetPlan.streets.filter((s) => !NO_TRAFFIC_SERVICE.test(s.service ?? "")));
  const inShown = (x: number, y: number) => hs.shown.some((b) => pointInRing(x, y, b.ring));
  if (opts.parkedBays !== false) {
    const placed = placeParked(img.parkedSpots, {
      aisles: img.parkingLines.length
        ? (sources.streets?.lines ?? []).filter((l) => l.service === "parking_aisle").map((l) => ({ pts: ctx.line(l.pts), width: 6 }))
        : [],
      slots: (rn.kerbside?.slots ?? []).filter((s) => s.street !== 0),
      blocked: (x, y, kerb) => {
        if (!g.inCover(x, y, 5)) return true;
        const n = index.nearest(x, y, 30);
        if (n && n.dist < index.at(n).width / 2 + 0.3) return true;
        if (plan.roundabouts.some((rb) => Math.hypot(x - rb.c[0], y - rb.c[1]) < outerRadius(rb) + 0.5)) return true;
        if (!kerb && through.clearance(x, y) < 0.2) return true;
        return inShown(x, y);
      },
    });
    return { placed, parked: placed.cars, bayQuads: placed.bays, through };
  }
  const parked = img.parkedSpots.filter((c) => {
    const [x, y] = c.at;
    if (!g.inCover(x, y, 5)) return false;
    const n = index.nearest(x, y, 30);
    if (n && n.dist < index.at(n).width / 2 + 0.5) return false;
    if (streetCentres.clearance(x, y) < 2.4 || st.streetIndex.clearance(x, y) < -0.3) return false;
    if (plan.roundabouts.some((rb) => Math.hypot(x - rb.c[0], y - rb.c[1]) < outerRadius(rb) + 2.5)) return false;
    return !inShown(x, y);
  });
  return { placed: null, parked, bayQuads: [], through };
}

/** Distance to the nearest traffic lane's centreline (traffic.json's lanes, AC points back to local). */
function laneDistance(trafficText: string): (x: number, y: number) => number {
  const lanes = (JSON.parse(trafficText).lanes as { points: [number, number, number][] }[]).map((l) => l.points.map((q) => [q[0], -q[2]] as Vec2));
  const CELL = 10, grid = new Map<string, [Vec2, Vec2][]>();
  for (const pts of lanes) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++) {
        for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) {
          const k = `${x},${y}`;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k)!.push([a, b]);
        }
      }
    }
  }
  return (x, y) => {
    let best = Infinity;
    const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const [a, b] of grid.get(`${gx},${gy}`) ?? []) {
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1e-12;
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
        best = Math.min(best, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t));
      }
    }
    return best;
  };
}

export interface ParkedFinal {
  parked: PlacedCar[];
  parkedDropped: NonNullable<TrackResult["stats"]["parkedDropped"]>;
}

/** S19.2-4: mutates the model (appends the pads and the cars' groups) and the registry (the car texture). */
export function finishParked(
  ctx: BuildContext, rp: RoutePlan, model: Kn5Model, reg: Registry, p1: ParkedFirst, tf: Traffic | null, rm: RoadSurfaces, rn: Rings, gm: GroundMeshes,
): ParkedFinal {
  const ground = gm.ground;
  const group = (name: string, children: Kn5MeshNode[] | Kn5GroupNode[]): Kn5GroupNode => ({ kind: "node", name, transform: IDENTITY, children });
  const cleared = clearParked(p1.parked, {
    road: topSurface([...rm.roadMeshes.road, ...gm.kerbsClear.nodes, ...gm.ringsClear.nodes], ROUTE_ROAD),
    street: (x, y) => p1.through.clearance(x, y),
    rings: rp.plan.roundabouts.map((rb) => ({ c: rb.c, r: outerRadius(rb) })),
    ...(tf ? { lane: laneDistance(tf.trafficText) } : {}),
  });
  let parked = cleared.kept;
  const parkedDropped = { ...cleared.dropped, offAsphalt: 0, uneven: 0 };
  if (parked.length) {
    let bayQuads = p1.bayQuads;
    if (ctx.opts.padClear !== false && bayQuads.length) {
      const res = clearBays(bayQuads, parked, feetNear(model.root.children, bayQuads, ground));
      bayQuads = res.quads;
      parked = res.cars;
      if (p1.placed) p1.placed.dropped.blocked += res.dropped;
    }
    const asphaltBuilt = [...rm.roadMeshes.road, ...rm.sideStreets, ...gm.kerbsClear.nodes, ...gm.ringsClear.nodes, ...rn.netNodes];
    const pads = bayQuads.length ? buildBayPads(bayQuads, ground, bayHeight(ground, topSurface(asphaltBuilt, BAY_ASPHALT))) : [];
    if (pads.length) model.root.children.push(group("CARPARKS", pads));
    const padTop = pads.length ? topSurface(pads) : null;
    // No wheel on grass or a kerb at the top: a bay that reached over a kerb loses its car.
    const extra = topSurface(pads, PHYSICS_GROUND);
    const top = (x: number, y: number) => {
      const gz = ground.mesh(x, y), e = extra(x, y);
      return gz === null ? e : e === null ? gz : Math.max(gz, e);
    };
    const asphalt = topSurface([...asphaltBuilt, ...pads], ASPHALT);
    parked = parked.filter((c) => {
      if (offAsphaltAt(c, top, asphalt) === null) return true;
      parkedDropped.offAsphalt++;
      return false;
    });
    const carGround = (x: number, y: number) => {
      const gz = ground(x, y), p = padTop?.(x, y) ?? null;
      return p === null ? gz : Math.max(gz, p);
    };
    parked = parked.filter((c) => {
      if (carSeat(c, carGround).sink <= TYRE_SINK + 1e-6) return true;
      parkedDropped.uneven++;
      return false;
    });
    const meshes = buildParkedCars(parked, carGround);
    model.root.children.push(...cullable([group("PARKED_CARS", meshes.filter((m) => !m.name.startsWith("1WALL")))]));
    model.root.children.push(group("PARKED_CAR_WALLS", meshes.filter((m) => m.name.startsWith("1WALL"))));
    reg.scenery("parked_car.png", carTexture(), material("parked_car", "parked_car.png", { ambient: 0.45, diffuse: 0.55, specular: 0.5, exp: 40 }));
  }
  return { parked, parkedDropped };
}
