// Drift spots (Busselton fork): empty car parks the Busselton Challenges app flags as drift zones,
// with a simple angle-and-speed score (apps/lua/BusseltonChallenges). Written once per track as
// extension/drift_zones.ini, so every layout of the map shares them.
//
// A car park is a cluster of the OSM parking aisles the build drives (service=parking_aisle). Its
// zone is the biggest circle that stays over the car park (its centre and most of its rim within
// 12 m of an aisle: two rows of bays or more), clear of every parked car the build put back, of buildings and of the
// streets that carry traffic. A zone smaller than `minRadius` is left out: that car park is full.

import type { Vec2 } from "./geo";

export interface DriftZone {
  name: string;
  /** Centre, AC world coordinates (x east, y up, z south). */
  pos: [number, number, number];
  /** Metres. */
  radius: number;
}

export interface DriftInput {
  /** The parking aisles the track builds, local metres (x east, y north). */
  aisles: Vec2[][];
  /** Parked cars the build placed (obstacles). */
  parked: Vec2[];
  /** Distance from a point to the edge of the nearest street that isn't a parking aisle (the route, side streets). */
  roadClearance: (x: number, y: number) => number;
  /** True where a building stands. */
  blocked?: (x: number, y: number) => boolean;
  /** Ground height. */
  ground: (x: number, y: number) => number;
  /** A name for a car park at a point ("Car park by the jetty"), or undefined. */
  nameAt?: (x: number, y: number) => string | undefined;
}

export interface DriftOptions {
  maxRadius?: number;
  minRadius?: number;
  /** Most zones to keep, biggest first. */
  max?: number;
}

const STEP = 4;

/** Points every STEP metres along each aisle, and which aisle each came from. */
function samplePoints(aisles: Vec2[][]): Vec2[] {
  const out: Vec2[] = [];
  for (const a of aisles) {
    for (let i = 0; i < a.length; i++) {
      if (i === 0) { out.push(a[0]); continue; }
      const p = a[i - 1], q = a[i], L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = Math.max(1, Math.ceil(L / STEP));
      for (let k = 1; k <= n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
    }
  }
  return out;
}

class PointGrid {
  private cells = new Map<string, Vec2[]>();
  constructor(pts: Vec2[], private cell: number) {
    for (const p of pts) {
      const k = `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`;
      const l = this.cells.get(k);
      if (l) l.push(p); else this.cells.set(k, [p]);
    }
  }
  /** Distance to the nearest point, searching `reach` metres (Infinity beyond). */
  nearest(x: number, y: number, reach: number): number {
    const r = Math.ceil(reach / this.cell), cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best = Infinity;
    for (let gx = cx - r; gx <= cx + r; gx++) for (let gy = cy - r; gy <= cy + r; gy++) {
      for (const p of this.cells.get(`${gx},${gy}`) ?? []) best = Math.min(best, Math.hypot(p[0] - x, p[1] - y));
    }
    return best <= reach ? best : Infinity;
  }
}

/** Aisle points in car parks: points within `link` metres of each other are one car park. */
export function clusterAisles(aisles: Vec2[][], link = 18): Vec2[][] {
  const pts = samplePoints(aisles);
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const grid = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const cx = Math.floor(p[0] / link), cy = Math.floor(p[1] / link);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      for (const j of grid.get(`${gx},${gy}`) ?? []) {
        if (Math.hypot(pts[j][0] - p[0], pts[j][1] - p[1]) <= link) parent[find(i)] = find(j);
      }
    }
    const k = `${cx},${cy}`;
    const l = grid.get(k);
    if (l) l.push(i); else grid.set(k, [i]);
  });
  const groups = new Map<number, Vec2[]>();
  pts.forEach((p, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(p); else groups.set(r, [p]);
  });
  return [...groups.values()];
}

/** The drift zones of a track's car parks, biggest first, none overlapping. */
export function driftZones(input: DriftInput, opts: DriftOptions = {}): DriftZone[] {
  const maxR = opts.maxRadius ?? 40, minR = opts.minRadius ?? 15, max = opts.max ?? 12;
  const parked = new PointGrid(input.parked, 10);
  const found: { c: Vec2; r: number }[] = [];
  for (const cluster of clusterAisles(input.aisles)) {
    // A car park needs some aisle to be worth sliding round: at least 60 m of it.
    if (cluster.length * STEP < 60) continue;
    const near = new PointGrid(cluster, 10);
    let best: { c: Vec2; r: number; d: number } | null = null;
    let mx = 0, my = 0;
    for (const p of cluster) { mx += p[0] / cluster.length; my += p[1] / cluster.length; }
    // Candidate centres: a grid over the car park (at most ~200), each within 12 m of an aisle.
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of cluster) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const step = Math.max(STEP, Math.sqrt(((x1 - x0) * (y1 - y0)) / 200));
    const centres: Vec2[] = [];
    for (let x = x0; x <= x1 + 1e-6; x += step) for (let y = y0; y <= y1 + 1e-6; y += step) {
      if (near.nearest(x, y, 12) < Infinity) centres.push([x, y]);
    }
    for (const c of centres) {
      if (input.blocked?.(c[0], c[1])) continue;
      const free = Math.min(maxR, parked.nearest(c[0], c[1], maxR + 3) - 3, input.roadClearance(c[0], c[1]) - 2);
      // Biggest first; between equals, the one nearest the middle of the car park.
      const d = Math.hypot(c[0] - mx, c[1] - my);
      for (let r = Math.floor(free); r >= minR && (!best || r > best.r || (r === best.r && d < best.d)); r--) {
        let onPark = 0, ok = true;
        for (let k = 0; k < 16 && ok; k++) {
          const t = (k / 16) * 2 * Math.PI;
          const x = c[0] + Math.cos(t) * r, y = c[1] + Math.sin(t) * r;
          if (input.blocked?.(x, y) || input.blocked?.(c[0] + Math.cos(t) * r / 2, c[1] + Math.sin(t) * r / 2)) ok = false;
          else if (near.nearest(x, y, 12) < Infinity) onPark++;
        }
        if (ok && onPark >= 14) { best = { c, r, d }; break; }
      }
    }
    if (best) found.push(best);
  }
  found.sort((a, b) => b.r - a.r);
  const kept: { c: Vec2; r: number }[] = [];
  for (const z of found) {
    if (kept.length >= max) break;
    if (kept.some((k) => Math.hypot(k.c[0] - z.c[0], k.c[1] - z.c[1]) < k.r + z.r + 10)) continue;
    kept.push(z);
  }
  const names = new Set<string>();
  return kept.map((z, k) => {
    let name = input.nameAt?.(z.c[0], z.c[1]) ?? `Drift spot ${k + 1}`;
    if (names.has(name)) name = `${name} ${k + 1}`;
    names.add(name);
    return { name, pos: [+z.c[0].toFixed(1), +input.ground(z.c[0], z.c[1]).toFixed(2), +(-z.c[1]).toFixed(1)], radius: z.r };
  });
}

/** The nearest named place within `reach` metres, as a car park name. */
export function carParkName(places: { at: Vec2; name?: string }[], streets: { pts: Vec2[]; name?: string }[], reach = 120) {
  return (x: number, y: number): string | undefined => {
    let best: string | undefined, bd = reach;
    for (const p of places) {
      if (!p.name) continue;
      const d = Math.hypot(p.at[0] - x, p.at[1] - y);
      if (d < bd) { bd = d; best = `Car park by ${p.name}`; }
    }
    if (best) return best;
    bd = 80;
    for (const st of streets) {
      if (!st.name) continue;
      for (let i = 1; i < st.pts.length; i++) {
        const a = st.pts[i - 1], b = st.pts[i];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1e-9)));
        const d = Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t);
        if (d < bd) { bd = d; best = `Car park off ${st.name}`; }
      }
    }
    return best;
  };
}

/** extension/drift_zones.ini: [DRIFT] COUNT, [ZONE_n] NAME, POSITION (AC world x, y, z), RADIUS. */
export function driftZonesIni(zones: DriftZone[]): string {
  const lines = ["[DRIFT]", `COUNT = ${zones.length}`, ""];
  zones.forEach((z, k) => {
    lines.push(`[ZONE_${k}]`, `NAME = ${z.name.replace(/[\r\n=;\[\]]/g, " ")}`, `POSITION = ${z.pos.join(", ")}`, `RADIUS = ${z.radius}`, "");
  });
  return lines.join("\n");
}
