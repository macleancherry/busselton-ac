// networkCore, phase 1 (docs/specs/road-network.md): in an area build, the network's junctions and
// roundabouts become the drivable surface where they are, in place of the old ring, connectors,
// side-street mouths and return fills. The route and street ribbons stay, trimmed back to each
// junction's caps (the hooks below), with the streets eased to the junction's height over 15 m.
//
// planJunctionCore() runs before kerbs are planned (it decides what the old core leaves out);
// build() runs after, and returns the junction meshes.

import type { Kn5MeshNode } from "../kn5";
import { MeshBuilder } from "../mesh";
import { capField, type CapField } from "./capField";
import { dressJunction, KERB } from "./dress";
import { dist, dot, lengths, smoothstep, sub, type P2 } from "./geom";
import { buildGraph } from "./graph";
import { planeAt, type HeightAt } from "./heights";
import { waysFromStreets } from "./index";
import { junctionOutline, junctionSurface, type Outline, type SurfaceMesh } from "./outline";
import { insertStreetCaps, matchJunctions, type Failure, type RingIn, type RJunction, type RouteRibbon, type StreetRibbon } from "./ribbons";

export interface JunctionCoreInput {
  /** Street lines (local metres, exact OSM geometry inside the area) and OSM roundabout rings. */
  lines: { pts: P2[]; cls: string; oneway?: 1 | -1; brunnel?: string }[];
  rings: { pts: P2[]; lanes?: number }[];
  route: RouteRibbon | null;
  /** The build's side streets: cap points are inserted, and joins inside junctions dropped. */
  streets: StreetRibbon[];
  /** The build's roundabouts (plan.roundabouts), in order. */
  builtRings: (RingIn & { kerbed?: boolean })[];
  terrain: HeightAt;
  inArea: (p: P2) => boolean;
  routeRowOk?: (i: number) => boolean;
  streetOk?: (si: number) => boolean;
  /** Grid step of the outline pass, metres. */
  outlineStep?: number;
  /** Junctions joined by a shorter edge merge into one, metres. */
  mergeMax?: number;
}

export interface PlannedJunction {
  id: number;
  j: RJunction;
  field: CapField;
  outline: Outline;
  surface: SurfaceMesh;
}

export interface JunctionDressInput {
  routeKerb: (row: number, side: 1 | -1) => number;
  stripOut: number;
  vergeWidth: number;
  markings: boolean;
  /** Road material for a junction (by its centre). */
  roadMaterial: (pj: PlannedJunction) => string;
}

export interface JunctionMeshes {
  /** Drivable surfaces (1ROAD_J / 1STREET_J) and their gutters. */
  road: Kn5MeshNode[];
  /** Kerbs, strips, verges and islands. */
  dress: Kn5MeshNode[];
  markings: Kn5MeshNode[];
  triangles: number;
}

export interface JunctionCore {
  junctions: PlannedJunction[];
  failures: Failure[];
  ms: number;
  /** Route row strictly inside a junction (no verge, no kerb there). */
  routeRowInside: (i: number) => boolean;
  /** The route ribbon's quad from row i to i + 1 is inside a junction. */
  routeQuadSkip: (i: number) => boolean;
  /** Route row (a mouth's sample) anywhere in a junction, caps included. */
  coversRouteRow: (i: number) => boolean;
  /** Distance along the route strictly inside a junction. */
  routeSInside: (s: number) => boolean;
  handlesRing: (k: number) => boolean;
  /** buildSideStreets' hook: leave out the quad of street `st` from arc s0 to s1. */
  streetSkip: (st: StreetRibbon, s0: number, s1: number) => boolean;
  /** The ground streets drape on, eased to each junction at its caps. */
  streetGround: (base: HeightAt) => HeightAt;
  /** buildKerbs' noRamp keys: the route kerb ends square at a junction's cap. */
  noRamp: Set<string>;
  build: (o: JunctionDressInput) => JunctionMeshes;
  json: () => unknown;
}

const STREET_LIFT = 0.1;
const CROWN_EASE = 8;
const EASE = 15;

export function planJunctionCore(input: JunctionCoreInput): JunctionCore {
  const t0 = Date.now();
  // Junctions closer than mergeMax become one (the spec's step 7; the graph's 15 m by default: at
  // 25 m twice as many Busselton junctions were refused, mostly by ribbons running into them).
  const graph = buildGraph(waysFromStreets(input.lines, input.rings), input.mergeMax ? { mergeMax: input.mergeMax } : {});
  const route = input.route;
  const { junctions: matched, failures } = matchJunctions(graph, route, input.streets, input.builtRings, {
    inArea: input.inArea, routeRowOk: input.routeRowOk, streetOk: input.streetOk,
  });
  // A ribbon part that stays (not one cut away for this junction) but runs into its surface: the other
  // carriageway of a divided road, a parallel service road, another stretch of the route, or a leg that
  // bends back in just past its cap. Phase 1 leaves such a junction to the old core.
  const foreignOverlap = (j: RJunction): string | null => {
    const [x0, y0, x1, y1] = j.box;
    const inBox = (p: P2) => p[0] >= x0 - 6 && p[0] <= x1 + 6 && p[1] >= y0 - 6 && p[1] <= y1 + 6;
    // A ribbon edge inside the junction, or (not a leg) meeting its edge within 30 cm: a seam the junction can't own.
    const hits = (c: P2, left: P2, hw: number, near = -0.05) => [0, 0.9, -0.9, 1, -1].some((t) => j.sdf([c[0] + left[0] * t * hw, c[1] + left[1] * t * hw]) < near);
    for (const [si, st] of input.streets.entries()) {
      if (!st.pts.some(inBox)) continue;
      const cut = j.legs.filter((l) => l.kind === "street" && l.street === si).map((l) => [Math.min(l.nodeAt, l.at), Math.max(l.nodeAt, l.at)]);
      const cum = lengths(st.pts);
      for (let s = 0.5; s <= cum[cum.length - 1] - 0.5; s += 0.5) {
        if (cut.some(([lo, hi]) => s > lo - 0.3 && s < hi + 0.3)) continue;
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i++;
        const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
        const a = st.pts[i - 1], b2 = st.pts[i];
        const p: P2 = [a[0] + (b2[0] - a[0]) * f, a[1] + (b2[1] - a[1]) * f];
        if (!inBox(p)) continue;
        // Wholly inside: cut away with the junction (a link inside a merged junction, a splitter leg).
        if (j.sdf(p) < -0.3) continue;
        const L = Math.hypot(b2[0] - a[0], b2[1] - a[1]) || 1;
        const w = (st.widths ? st.widths[i - 1] + (st.widths[i] - st.widths[i - 1]) * f : st.width) / 2;
        if (hits(p, [-(b2[1] - a[1]) / L, (b2[0] - a[0]) / L], w, cut.length ? -0.05 : 0.3)) return `street ${si} runs into it`;
      }
    }
    if (route) {
      const n = route.samples.length;
      const mineRows = new Set<number>();
      for (const [e, x] of j.spans) for (let i = e; ; i = (i + 1) % n) { mineRows.add(i); if (i === x || mineRows.size > n) break; }
      for (const [i, smp] of route.samples.entries()) {
        if (mineRows.has(i) || !inBox(smp.pos)) continue;
        if (hits(smp.pos, smp.left, smp.width / 2)) return "the route runs into it";
      }
    }
    return null;
  };
  const planned: PlannedJunction[] = [];
  const n = route?.samples.length ?? 0;
  for (const j of matched) {
    const fail = (reason: string) => failures.push({ node: j.node, at: j.centre, reason });
    const outline = junctionOutline(j, j.legs.map((l) => l.cap), input.outlineStep ?? 0.4);
    if (typeof outline === "string") { fail(outline); continue; }
    const why = foreignOverlap(j);
    if (why) { fail(why); continue; }
    // A first field (its base plane is final; route caps' crowns ease out later), for the ease checks.
    planned.push({ id: 0, j, field: capField(j, route, input.terrain, { streetLift: STREET_LIFT }), outline, surface: { xy: [], tris: [], parents: [] } });
  }
  // No two junctions over each other: a cap inside another junction, or route spans that meet.
  const kept: PlannedJunction[] = [];
  const S = route?.samples ?? [];
  const spanRows = (sp: [number, number]) => {
    const rows: number[] = [];
    for (let i = sp[0]; ; i = (i + 1) % n) { rows.push(i); if (i === sp[1] || rows.length > n) break; }
    return rows;
  };
  const rowOwner = new Int32Array(Math.max(1, n)).fill(-1);
  // Street caps of kept junctions, per street: where, facing which way, and the step the street eases by.
  const keptCaps = new Map<number, { at: number; dir: 1 | -1; delta: number }[]>();
  const streetLen = new Map<number, number>();
  const lenOf = (si: number) => {
    let L = streetLen.get(si);
    if (L === undefined) { const c = lengths(input.streets[si].pts); L = c[c.length - 1]; streetLen.set(si, L); }
    return L;
  };
  const capsOf = (pj: PlannedJunction) => pj.j.legs.filter((l) => l.kind === "street").map((l) => ({
    street: l.street, at: l.at, dir: l.dir,
    delta: planeAt(pj.field.base, l.cap.c) + pj.field.fall(l.cap.c) - (input.terrain(l.cap.c[0], l.cap.c[1]) + STREET_LIFT),
  }));
  // Room for a cap's ease: to the street's end or the next cap facing back; at most a 10% slope.
  const easeOk = (si: number, c: { at: number; dir: 1 | -1; delta: number }, others: { at: number; dir: 1 | -1 }[]) => {
    let room = c.dir === 1 ? lenOf(si) - c.at : c.at;
    for (const o of others) if (o.dir === -c.dir) { const d = (o.at - c.at) * c.dir; if (d > -0.5) room = Math.min(room, Math.max(0, d)); }
    if (room >= lenOf(si) - 0.01 && room > 30) return true;
    const L = Math.min(EASE, room / 2);
    return room >= 4 && (1.5 * Math.abs(c.delta)) / L <= 0.1;
  };
  for (const pj of planned) {
    const mine = capsOf(pj);
    const tight = mine.some((c) => {
      const others = [...(keptCaps.get(c.street) ?? []), ...mine.filter((m) => m.street === c.street && m !== c)];
      if (!easeOk(c.street, c, others)) return true;
      // Kept caps facing this one lose room too.
      return (keptCaps.get(c.street) ?? []).some((k) => !easeOk(c.street, k, [...(keptCaps.get(c.street) ?? []).filter((x) => x !== k), c]));
    });
    if (tight) { failures.push({ node: pj.j.node, at: pj.j.centre, reason: "no room on a street to ease to it" }); continue; }
    const clash = kept.find((q) => {
      const [ax0, ay0, ax1, ay1] = pj.j.box, [bx0, by0, bx1, by1] = q.j.box;
      if (ax1 < bx0 || bx1 < ax0 || ay1 < by0 || by1 < ay0) return false;
      return pj.j.legs.some((l) => q.j.sdf(l.cap.c) < 0.5) || q.j.legs.some((l) => pj.j.sdf(l.cap.c) < 0.5) || pj.outline.outer.some((p) => q.j.sdf(p) < -0.3);
    }) ?? (pj.j.spans.some((sp) => spanRows(sp).some((i) => rowOwner[i] >= 0)) ? kept[0] : undefined);
    if (clash) { failures.push({ node: pj.j.node, at: pj.j.centre, reason: "overlaps another junction" }); continue; }
    pj.id = kept.length;
    for (const sp of pj.j.spans) for (const i of spanRows(sp)) rowOwner[i] = pj.id;
    for (const c of mine) { if (!keptCaps.has(c.street)) keptCaps.set(c.street, []); keptCaps.get(c.street)!.push(c); }
    kept.push(pj);
  }
  // The route's crown eases out over the last 8 m before each cap (the spec's cross-section rule), so
  // every cap is a straight line; then each junction's field and surface.
  if (route) for (const pj of kept) for (const l of pj.j.legs) if (l.kind === "route") {
    for (let m = 0, i = l.at, u = 0; m < 12 && u <= CROWN_EASE; m++) {
      const c = route.crown * smoothstep(u / CROWN_EASE);
      S[i].crown = Math.min(S[i].crown ?? route.crown, c);
      const next = route.closed ? (i + l.dir + n) % n : i + l.dir;
      if (next < 0 || next >= n) break;
      u += dist(S[i].pos, S[next].pos);
      i = next;
    }
  }
  for (const pj of kept) {
    pj.field = capField(pj.j, route, input.terrain, { streetLift: STREET_LIFT });
    // Refined where the field curves (a roundabout's fall, route legs blending in) to 3 mm; a plane needs none.
    pj.surface = junctionSurface(pj.outline, pj.field.planar && !pj.j.ring ? undefined : pj.field.h);
  }
  // Route rows.
  const inside = new Uint8Array(Math.max(1, n)), covered = new Uint8Array(Math.max(1, n)), quad = new Uint8Array(Math.max(1, n));
  const noRamp = new Set<string>();
  for (const pj of kept) for (const sp of pj.j.spans) {
    const rows = spanRows(sp);
    rows.forEach((i, m) => {
      covered[i] = 1;
      if (m > 0 && m < rows.length - 1) inside[i] = 1;
      if (m < rows.length - 1) quad[i] = 1;
    });
    for (const side of [1, -1]) {
      noRamp.add(`${sp[0]}:${side}`);
      noRamp.add(`${rows[rows.length - 2]}:${side}`);
    }
  }
  // The same spans as distances along the route (b < a: the span wraps past the start of a loop).
  const sSpans: [number, number][] = route ? kept.flatMap((pj) => pj.j.spans.map(([a, b]) => [route.samples[a].s, route.samples[b].s] as [number, number])) : [];
  // Streets: caps become points, joins inside a junction go (the street no longer blends to the route there).
  insertStreetCaps(input.streets, kept.map((p) => p.j));
  const inAny = (p: P2, margin: number) => kept.some((pj) => {
    const [x0, y0, x1, y1] = pj.j.box;
    return p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && pj.j.sdf(p) < margin;
  });
  for (const st of input.streets) st.joins = st.joins.filter((k) => !inAny(st.pts[k], 1));
  const cuts = new Map<StreetRibbon, [number, number][]>();
  interface Ease { st: StreetRibbon; at: number; dir: 1 | -1; L: number; hw: number; target: (p: P2) => number; line: P2[]; cum: number[] }
  const eases: Ease[] = [];
  const capsOn = new Map<StreetRibbon, { at: number; dir: 1 | -1 }[]>();
  for (const pj of kept) for (const l of pj.j.legs) if (l.kind === "street") {
    const st = input.streets[l.street];
    if (!cuts.has(st)) cuts.set(st, []);
    cuts.get(st)!.push([Math.min(l.nodeAt, l.at), Math.max(l.nodeAt, l.at)]);
    if (!capsOn.has(st)) capsOn.set(st, []);
    capsOn.get(st)!.push({ at: l.at, dir: l.dir });
  }
  for (const pj of kept) for (const l of pj.j.legs) if (l.kind === "street") {
    const st = input.streets[l.street];
    const cum = lengths(st.pts);
    const total = cum[cum.length - 1];
    // Room before the street's end or the next junction's cap facing back.
    let room = l.dir === 1 ? total - l.at : l.at;
    for (const c of capsOn.get(st)!) if (c.dir === -l.dir) {
      const d = (c.at - l.at) * l.dir;
      if (d > 0) room = Math.min(room, d);
    }
    const L = Math.max(1, Math.min(EASE, room / 2));
    const fallC = pj.field.fall(l.cap.c);
    const base = pj.field.base;
    // The street's centreline from the cap outward, L + 2 m.
    const lo = l.dir === 1 ? l.at : Math.max(0, l.at - L - 2), hi = l.dir === 1 ? Math.min(total, l.at + L + 2) : l.at;
    const pts: P2[] = [];
    const along = (s: number): P2 => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const f = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      return [st.pts[i - 1][0] + (st.pts[i][0] - st.pts[i - 1][0]) * f, st.pts[i - 1][1] + (st.pts[i][1] - st.pts[i - 1][1]) * f];
    };
    const ss: number[] = [lo];
    for (let k = 0; k < cum.length; k++) if (cum[k] > lo + 1e-6 && cum[k] < hi - 1e-6) ss.push(cum[k]);
    ss.push(hi);
    for (const s of ss) pts.push(along(s));
    const line = l.dir === 1 ? pts : pts.slice().reverse();
    eases.push({ st, at: l.at, dir: l.dir, L, hw: l.hw, target: (p) => planeAt(base, p) + fallC, line, cum: lengths(line) });
  }
  // Ease lookup by grid.
  const EG = 10;
  const easeGrid = new Map<string, number[]>();
  eases.forEach((e, ei) => {
    const xs = e.line.map((p) => p[0]), ys = e.line.map((p) => p[1]), r = e.hw + 2;
    for (let x = Math.floor((Math.min(...xs) - r) / EG); x <= Math.floor((Math.max(...xs) + r) / EG); x++)
      for (let y = Math.floor((Math.min(...ys) - r) / EG); y <= Math.floor((Math.max(...ys) + r) / EG); y++) {
        const k = `${x},${y}`;
        if (!easeGrid.has(k)) easeGrid.set(k, []);
        easeGrid.get(k)!.push(ei);
      }
  });
  const easeWeights = (p: P2): { e: Ease; w: number }[] => {
    const out: { e: Ease; w: number }[] = [];
    for (const ei of easeGrid.get(`${Math.floor(p[0] / EG)},${Math.floor(p[1] / EG)}`) ?? []) {
      const e = eases[ei];
      let bd = Infinity, bs = 0;
      for (let k = 1; k < e.line.length; k++) {
        const a = e.line[k - 1], b = e.line[k];
        const ab = sub(b, a), L2 = dot(ab, ab) || 1e-12;
        const f = Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2));
        const d = Math.hypot(p[0] - a[0] - ab[0] * f, p[1] - a[1] - ab[1] * f);
        if (d < bd) { bd = d; bs = e.cum[k - 1] + f * Math.sqrt(L2); }
      }
      const lat = bd <= e.hw + 0.6 ? 1 : 1 - smoothstep((bd - e.hw - 0.6) / 1.2);
      const w = (1 - smoothstep(bs / e.L)) * lat;
      if (w > 0) out.push({ e, w });
    }
    return out;
  };
  const ringSet = new Set(kept.filter((p) => p.j.ring).map((p) => p.j.ring!.k));
  // Junction meshes' heights: exact ribbon heights on the caps (the field is exact there too).
  const capZ = (pj: PlannedJunction) => (ci: number, p: P2) => {
    const l = pj.j.legs[ci];
    return pj.field.legSurface[ci](p) + pj.field.fall(l.cap.c);
  };
  const zOf = (pj: PlannedJunction, idx: number): number => {
    // A point refinement added on the outline: the mean of the edge it halves.
    const par = pj.surface.parents[idx];
    if (par) return (zOf(pj, par[0]) + zOf(pj, par[1])) / 2;
    const p = pj.surface.xy[idx];
    // Cap vertices: find the cap it lies on.
    for (const [ci, l] of pj.j.legs.entries()) {
      const q = sub(p, l.cap.c);
      if (Math.abs(dot(q, l.cap.d)) < 1e-6 && Math.abs(dot(q, l.cap.left)) <= l.hw + 1e-6) return capZ(pj)(ci, p);
    }
    return pj.field.h(p);
  };

  return {
    junctions: kept,
    failures,
    ms: Date.now() - t0,
    routeRowInside: (i) => n > 0 && inside[((i % n) + n) % n] === 1,
    routeQuadSkip: (i) => n > 0 && quad[((i % n) + n) % n] === 1,
    coversRouteRow: (i) => n > 0 && covered[((i % n) + n) % n] === 1,
    routeSInside: (s) => sSpans.some(([a, b]) => (a < b ? s > a && s < b : s > a || s < b)),
    handlesRing: (k) => ringSet.has(k),
    streetSkip: (st, s0, s1) => {
      const mid = (s0 + s1) / 2;
      for (const [a, b] of cuts.get(st) ?? []) if (mid > a && mid < b) return true;
      // Anything else of a street inside a junction (a link inside a merged junction, a splitter leg).
      const cum = lengths(st.pts);
      let i = 1;
      while (i < cum.length - 1 && cum[i] < mid) i++;
      const f = (mid - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      const p: P2 = [st.pts[i - 1][0] + (st.pts[i][0] - st.pts[i - 1][0]) * f, st.pts[i - 1][1] + (st.pts[i][1] - st.pts[i - 1][1]) * f];
      return inAny(p, -0.3);
    },
    streetGround: (base) => (x, y) => {
      const t = base(x, y);
      const ws = easeWeights([x, y]);
      if (!ws.length) return t;
      let h = t;
      for (const { e, w } of ws) h += w * (e.target([x, y]) - STREET_LIFT - t);
      return h;
    },
    noRamp,
    build: (o) => buildMeshes(o),
    json: () => ({
      ms: Date.now() - t0,
      junctions: kept.map((pj) => ({
        id: pj.id, node: pj.j.node, kind: pj.j.kind, onRoute: pj.j.onRoute, at: pj.j.centre.map((v) => Math.round(v * 100) / 100),
        legs: pj.j.legs.map((l) => ({ kind: l.kind, edge: l.edge, trim: Math.round(l.trim * 100) / 100, hw: Math.round(l.hw * 100) / 100, inbound: l.inbound })),
        planar: pj.field.planar, spans: pj.j.spans, triangles: pj.surface.tris.length / 3,
      })),
      failures: failures.map((f) => ({ ...f, at: f.at.map((v) => Math.round(v * 10) / 10) })),
    }),
  };

  function buildMeshes(o: JunctionDressInput): JunctionMeshes {
    // One mesh per kind, material and 300 m cell (and 60k vertices), so draw calls stay few.
    const buckets = new Map<string, { prefix: string; material: string; mb: MeshBuilder; extra?: Partial<Kn5MeshNode> }[]>();
    const sinkFor = (prefix: string, material: string, cell: string, need: number, extra?: Partial<Kn5MeshNode>) => {
      const key = `${prefix}|${material}|${cell}`;
      let list = buckets.get(key);
      if (!list) { list = []; buckets.set(key, list); }
      let last = list[list.length - 1];
      if (!last || last.mb.vertexCount + need > 60000) { last = { prefix, material, mb: new MeshBuilder(), extra }; list.push(last); }
      return last.mb;
    };
    let triangles = 0;
    for (const pj of kept) {
      const c = pj.j.centre;
      const cell = `${Math.floor(c[0] / 300)},${Math.floor(c[1] / 300)}`;
      const surf = pj.j.onRoute ? "ROAD" : "STREET";
      const mat = o.roadMaterial(pj);
      const need = pj.surface.xy.length;
      const mb = sinkFor(`1${surf}_J`, mat, cell, need);
      const base = mb.vertexCount;
      pj.surface.xy.forEach((p, i) => mb.vertex([p[0], p[1], zOf(pj, i)], p[0] / 4, p[1] / 24));
      for (let t = 0; t < pj.surface.tris.length; t += 3) mb.tri(base + pj.surface.tris[t], base + pj.surface.tris[t + 1], base + pj.surface.tris[t + 2]);
      triangles += pj.surface.tris.length / 3;
      const est = pj.outline.outer.length * 8 + pj.outline.holes.reduce((s, h) => s + h.length * 8, 0) + 400;
      dressJunction({ j: pj.j, outline: pj.outline, h: pj.field.h, capZ: capZ(pj), through: pj.field.through }, {
        gutter: sinkFor(`1${surf}_GUTTER_J`, "concrete", cell, est),
        kerb: sinkFor("1KERB_J", "concrete", cell, est),
        strip: sinkFor("1GRASS_STRIP_J", "grass", cell, est),
        verge: sinkFor("1GRASS_VERGE_J", "verge", cell, est),
        island: sinkFor("1GRASS_ISLAND_J", "grass", cell, est),
        islandTop: sinkFor("1KERB_JS", "concrete", cell, est),
        paint: sinkFor("MARKINGS_J", "paint", cell, est, { castShadows: false }),
      }, { routeKerb: o.routeKerb, stripOut: o.stripOut, vergeWidth: o.vergeWidth, ringKerbed: !!(pj.j.ring && input.builtRings[pj.j.ring.k]?.kerbed !== false), markings: o.markings });
    }
    const road: Kn5MeshNode[] = [], dress: Kn5MeshNode[] = [], markings: Kn5MeshNode[] = [];
    let idx = 0;
    for (const list of buckets.values()) for (const b of list) {
      if (!b.mb.indices.length) continue;
      const node = b.mb.toKn5(`${b.prefix}${String(idx++).padStart(3, "0")}`, b.material, b.extra);
      if (/^1(ROAD|STREET)_/.test(b.prefix)) road.push(node);
      else if (b.prefix === "MARKINGS_J") markings.push(node);
      else dress.push(node);
    }
    return { road, dress, markings, triangles };
  }
}

export { KERB, dist };
