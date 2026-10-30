// Busselton fork: traffic lights where OpenStreetMap maps them (highway=traffic_signals, and
// pedestrian crossings with crossing=traffic_signals or crossing:signals=yes). Busselton has only
// a handful, so each one is worth getting right:
//
//  - Australian-style posts: a grey post on the near-left corner of each approach (the primary)
//    and one on the far right (the secondary), each with a black three-aspect head (red over
//    amber over green, each with a visor) facing the approaching traffic. On a wide road (11 m or
//    more) the primary is a mast pole with a head on an arm over the approach lanes, on a black
//    target board. Posts that land on the same corner share a pole, heads back to back.
//  - A stop line across each approach's lanes (the left half: Australia drives on the left) and
//    a signalised pedestrian crossing's two parallel lines in front of it.
//  - Working lights through CSP's traffic planner (acc-lua-internal, included-tools/traffic, by
//    x4fab, CC0). An intersection in data/traffic.json may carry a `trafficLight`
//    ({ program, params, emissive }; common/SerializedTypes.lua SerializedTrafficLightRef). The
//    "Basic" program (editor/EditorTrafficLightPrograms.lua; simulation/TrafficLight.lua) gives
//    green to the polygon's odd sides and then its even sides, `params.duration` seconds each
//    (default 15) with 2 s of amber / red-amber, and sets each entry lane's state, which the AI
//    obeys (simulation/IntersectionManeuver.lua). A polygon side is the edge from point i to
//    point i+1, and a lane belongs to the side it crosses entering
//    (simulation/TrafficIntersection.lua, IntersectionSide.lua). So a signalled junction gets a
//    four-sided polygon with one edge across each approach, opposite approaches on opposite
//    edges. `emissive[i]` for side i in mode 1 names a mesh filter per role (red, yellow, green):
//    the planner sets that mesh's ksEmissive to the lit colour or black
//    (simulation/TrafficLightEmissive.lua). Each approach's lenses are their own meshes here
//    (TRAFFICLIGHT_<site>_S<side>_RED/AMBER/GREEN), so the lights a driver sees change with the
//    lanes the traffic planner is holding. With traffic off, nothing drives them and they stay dark.

import type { Kn5Material, Kn5MeshNode } from "./kn5";
import type { Vec2 } from "./geo";
import { MeshBuilder, type Vec3 } from "./mesh";
import { encodePng } from "./png";
import { fill } from "./textures";

/** A signal node from OSM, local metres. `crossing`: a pedestrian crossing's signals (not a junction's). */
export interface SignalNode {
  at: Vec2;
  crossing: boolean;
}

/** A road the track builds: the route or a side street, local metres. */
export interface SignalLine {
  pts: Vec2[];
  width: number;
  /** Per-point widths, when they vary (the route). */
  widths?: number[];
  /** The route: preferred as the main road where several meet. */
  main?: boolean;
}

/** One road leaving a signalled site. */
export interface SignalArm {
  /** Unit direction from the site's centre out along the road. */
  dir: Vec2;
  /** Asphalt width, metres. */
  width: number;
  /** Which side of the traffic planner's four-sided polygon the arm's traffic enters by, 0..3. */
  side: number;
  /** Distance from the centre to the stop line, metres. */
  stop: number;
}

export interface SignalSite {
  id: number;
  c: Vec2;
  kind: "junction" | "crossing";
  arms: SignalArm[];
  /** Angle of side 0's outward normal (radians, from +x towards +y). */
  theta: number;
  /** Every arm on a side of its own: the planner can run the lights. */
  sidesOk: boolean;
  /** Distance from the centre to each of the polygon's four sides, metres. */
  extent: [number, number, number, number];
}

/** Signals within this of each other are one site. */
const CLUSTER = 30;
/** Roads passing within this of a site take part in it. */
const REACH = 30;
/** A road must carry on at least this far from the site to be an arm. */
const ARM_MIN = 8;
/** Arms closer than this in angle are one road (a side street overlapping the route's end). */
const SAME_ARM = (30 * Math.PI) / 180;
/** Roads this wide get a mast arm over the approach. */
export const MAST_WIDTH = 11;
/** A signalised pedestrian crossing: its lines' distance apart, and the gap to the stop line. */
const WALK = 2.6;
const STOP_GAP = 0.5;

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: Vec2) => Math.hypot(a[0], a[1]);
const unit = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const angleOf = (d: Vec2) => Math.atan2(d[1], d[0]);
/** Smallest difference between two angles, 0..pi. */
const angDiff = (a: number, b: number) => {
  const d = Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
  return d;
};

/** Nearest point on segment a-b to p, and its fraction along. */
function onSegment(p: Vec2, a: Vec2, b: Vec2): { q: Vec2; f: number; d: number } {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1e-9;
  const f = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  const q: Vec2 = [a[0] + dx * f, a[1] + dy * f];
  return { q, f, d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

/** Nearest point on a polyline: segment index, fraction, point, distance. */
function nearestOnLine(p: Vec2, pts: Vec2[]): { seg: number; f: number; q: Vec2; d: number } {
  let best = { seg: 0, f: 0, q: pts[0], d: Infinity };
  for (let i = 1; i < pts.length; i++) {
    const r = onSegment(p, pts[i - 1], pts[i]);
    if (r.d < best.d) best = { seg: i - 1, f: r.f, q: r.q, d: r.d };
  }
  return best;
}

/** The point `dist` metres along a polyline from (seg, f), forwards or backwards; null if it ends first. */
function walk(pts: Vec2[], seg: number, f: number, dist: number, forward: boolean): { p: Vec2; reached: number } {
  let at: Vec2 = [pts[seg][0] + (pts[seg + 1][0] - pts[seg][0]) * f, pts[seg][1] + (pts[seg + 1][1] - pts[seg][1]) * f];
  let left = dist, done = 0;
  let i = forward ? seg + 1 : seg;
  while (left > 0 && i >= 0 && i < pts.length) {
    const step = len(sub(pts[i], at));
    if (step >= left) {
      const k = left / (step || 1);
      return { p: [at[0] + (pts[i][0] - at[0]) * k, at[1] + (pts[i][1] - at[1]) * k], reached: dist };
    }
    left -= step;
    done += step;
    at = pts[i];
    i += forward ? 1 : -1;
  }
  return { p: at, reached: done };
}

const widthAt = (l: SignalLine, seg: number, f: number) =>
  l.widths ? l.widths[seg] + ((l.widths[Math.min(l.widths.length - 1, seg + 1)] ?? l.widths[seg]) - l.widths[seg]) * f : l.width;

/** Closest points between two segments (sampled finely enough for road geometry). */
function closestBetween(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): { pa: Vec2; d: number } {
  let best = { pa: a0, d: Infinity };
  for (const [p, a, b, onA] of [[b0, a0, a1, true], [b1, a0, a1, true], [a0, b0, b1, false], [a1, b0, b1, false]] as [Vec2, Vec2, Vec2, boolean][]) {
    const r = onSegment(p, a, b);
    if (r.d < best.d) best = { pa: onA ? r.q : p, d: r.d };
  }
  // Crossing segments: the crossing point itself.
  const d1 = sub(a1, a0), d2 = sub(b1, b0), den = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(den) > 1e-9) {
    const w = sub(b0, a0);
    const s = (w[0] * d2[1] - w[1] * d2[0]) / den, t = (w[0] * d1[1] - w[1] * d1[0]) / den;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) best = { pa: [a0[0] + d1[0] * s, a0[1] + d1[1] * s], d: 0 };
  }
  return best;
}

/**
 * The best rotation of a four-sided polygon for these arms: side k's outward normal at
 * theta + k * 90 degrees, each arm on the side nearest its direction. `ok` when no two arms share a
 * side and none is more than 35 degrees off its side's normal.
 */
export function fitSides(dirs: Vec2[]): { theta: number; sides: number[]; ok: boolean } {
  const angs = dirs.map(angleOf);
  const Q = Math.PI / 2;
  let best = { theta: 0, err: Infinity };
  for (let deg = 0; deg < 90; deg += 0.5) {
    const th = (deg * Math.PI) / 180;
    let err = 0;
    for (const a of angs) {
      const r = (((a - th) % Q) + Q) % Q;
      const e = Math.min(r, Q - r);
      err += e * e;
    }
    if (err < best.err - 1e-12) best = { theta: th, err };
  }
  const sides = angs.map((a) => ((Math.round((a - best.theta) / Q) % 4) + 4) % 4);
  const worst = Math.max(0, ...angs.map((a, i) => angDiff(a, best.theta + sides[i] * Q)));
  const ok = new Set(sides).size === sides.length && worst < (35 * Math.PI) / 180;
  return { theta: best.theta, sides, ok };
}

/**
 * The signalled sites: OSM signal nodes grouped (a junction is often mapped with a node on each
 * approach), each placed where its roads meet, with the roads leaving it as arms. A pedestrian
 * crossing away from a junction is a site of its own on one road (two arms). `blocked` drops a
 * site (inside a roundabout, say).
 */
export function findSignalSites(nodes: SignalNode[], lines: SignalLine[], blocked?: (x: number, y: number) => boolean): SignalSite[] {
  // 1. Group the nodes.
  const groups: SignalNode[][] = [];
  for (const n of nodes) {
    const g = groups.find((gr) => gr.some((m) => len(sub(m.at, n.at)) < CLUSTER));
    if (g) g.push(n);
    else groups.push([n]);
  }
  // Groups that grew together.
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (groups[i].some((a) => groups[j].some((b) => len(sub(a.at, b.at)) < CLUSTER))) {
        groups[i].push(...groups.splice(j, 1)[0]);
        j = i;
      }
    }
  }
  const sites: SignalSite[] = [];
  for (const g of groups) {
    const p: Vec2 = [g.reduce((s, n) => s + n.at[0], 0) / g.length, g.reduce((s, n) => s + n.at[1], 0) / g.length];
    const near = lines.filter((l) => l.pts.length > 1 && nearestOnLine(p, l.pts).d < REACH);
    if (!near.length) continue;
    // 2. The centre: on the main road, where the others come closest to it.
    const main = near.find((l) => l.main) ?? near.reduce((a, b) => (b.width > a.width ? b : a));
    const meets: Vec2[] = [];
    for (const l of near) {
      if (l === main) continue;
      let best = { pa: p, d: Infinity };
      for (let i = 1; i < main.pts.length; i++) {
        if (onSegment(p, main.pts[i - 1], main.pts[i]).d > REACH + 20) continue;
        for (let k = 1; k < l.pts.length; k++) {
          if (onSegment(p, l.pts[k - 1], l.pts[k]).d > REACH + 20) continue;
          const r = closestBetween(main.pts[i - 1], main.pts[i], l.pts[k - 1], l.pts[k]);
          if (r.d < best.d) best = r;
        }
      }
      // Only a road that actually meets the main one (within its half-width and a bit).
      if (best.d < main.width / 2 + 4) meets.push(best.pa);
    }
    // No road the track builds meets here (a crossing, or a junction with a street left out): lights
    // for the one road, with a crossing across it.
    const kind: SignalSite["kind"] = meets.length ? "junction" : "crossing";
    const c: Vec2 = meets.length
      ? nearestOnLine([meets.reduce((s, q) => s + q[0], 0) / meets.length, meets.reduce((s, q) => s + q[1], 0) / meets.length], main.pts).q
      : nearestOnLine(p, main.pts).q;
    if (blocked?.(c[0], c[1])) continue;
    // 3. The arms: every road that carries on from beside the centre.
    const raw: { dir: Vec2; width: number }[] = [];
    for (const l of kind === "junction" ? near : [main]) {
      const n = nearestOnLine(c, l.pts);
      if (n.d > (l === main ? 1 : main.width / 2 + 4)) continue;
      const w = widthAt(l, n.seg, n.f);
      for (const fwd of [true, false]) {
        const out = walk(l.pts, n.seg, n.f, 20, fwd);
        if (out.reached < ARM_MIN || len(sub(out.p, c)) < ARM_MIN * 0.75) continue;
        raw.push({ dir: unit(sub(out.p, c)), width: w });
      }
    }
    const arms: { dir: Vec2; width: number }[] = [];
    for (const a of raw.sort((x, y) => y.width - x.width)) {
      if (!arms.some((b) => angDiff(angleOf(a.dir), angleOf(b.dir)) < SAME_ARM)) arms.push(a);
    }
    if (arms.length < 2) continue;
    // 4. Stop lines: clear of the roads across, with room for a pedestrian crossing.
    const stops = arms.map((a) => {
      if (kind === "crossing") return WALK / 2 + STOP_GAP + 1.2;
      let across = 0;
      for (const b of arms) {
        if (b === a) continue;
        const s = Math.abs(Math.sin(angleOf(a.dir) - angleOf(b.dir)));
        if (s < 0.5) continue;
        across = Math.max(across, b.width / 2 / s);
      }
      return across + 0.5 + WALK + STOP_GAP + 0.15;
    });
    const fit = fitSides(arms.map((a) => a.dir));
    const extent: [number, number, number, number] = [0, 0, 0, 0];
    const widest = Math.max(...arms.map((a) => a.width));
    for (let k = 0; k < 4; k++) {
      const i = fit.sides.indexOf(k);
      // A side with no arm: the edge of the road across it, and a little.
      extent[k] = i >= 0 ? stops[i] : (kind === "crossing" ? widest : Math.max(...arms.filter((_, j) => (fit.sides[j] - k + 4) % 2 === 1).map((a) => a.width), widest * 0.5)) / 2 + 1;
    }
    sites.push({
      id: sites.length,
      c,
      kind,
      arms: arms.map((a, i) => ({ dir: a.dir, width: a.width, side: fit.sides[i], stop: stops[i] })),
      theta: fit.theta,
      sidesOk: fit.ok,
      extent,
    });
  }
  return sites;
}

/* ---------------- the meshes ---------------- */

type HeightFn = (x: number, y: number) => number;

const POST_R = 0.055;
const MAST_R = 0.12;
const POST_H = 3.7;
const MAST_H = 6.9;
const HEAD_W = 0.34;
const HEAD_H = 0.98;
const HEAD_D = 0.24;
const LENS_R = 0.1;
const ASPECT_DZ = 0.31;
const POLE_HEAD_Z = 2.95;
const MAST_ARM_Z = 6.55;

/** A box: centre, forward f (unit, horizontal), half extents along f, sideways and up. */
function box(mb: MeshBuilder, c: Vec3, f: Vec2, hf: number, hs: number, hz: number): void {
  const s: Vec2 = [-f[1], f[0]];
  const corner = (i: number, j: number, k: number): Vec3 => [
    c[0] + f[0] * hf * i + s[0] * hs * j,
    c[1] + f[1] * hf * i + s[1] * hs * j,
    c[2] + hz * k,
  ];
  // Each face: four corners counter-clockwise seen from outside.
  const faces: [number, number, number][][] = [
    [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], // front (+f)
    [[-1, 1, -1], [-1, -1, -1], [-1, -1, 1], [-1, 1, 1]], // back
    [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], // -s
    [[1, 1, -1], [-1, 1, -1], [-1, 1, 1], [1, 1, 1]], // +s
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], // top
    [[-1, 1, -1], [1, 1, -1], [1, -1, -1], [-1, -1, -1]], // bottom
  ];
  for (const face of faces) {
    const v = face.map(([i, j, k]) => mb.vertex(corner(i, j, k), 0.5, 0.5));
    mb.quad(v[0], v[1], v[2], v[3]);
  }
}

/** An upright cylinder with a cap. */
function cylinder(mb: MeshBuilder, x: number, y: number, z0: number, z1: number, r: number, n = 10): void {
  const lo: number[] = [], hi: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    lo.push(mb.vertex([x + Math.cos(a) * r, y + Math.sin(a) * r, z0], i / n, 0));
    hi.push(mb.vertex([x + Math.cos(a) * r, y + Math.sin(a) * r, z1], i / n, 1));
  }
  for (let i = 0; i < n; i++) mb.quad(lo[i], lo[i + 1], hi[i + 1], hi[i]);
  const top = mb.vertex([x, y, z1], 0.5, 0.5);
  for (let i = 0; i < n; i++) mb.tri(top, hi[i], hi[i + 1]);
}

/** A flat disc facing f (horizontal unit), centre c. */
function disc(mb: MeshBuilder, c: Vec3, f: Vec2, r: number, n = 12): void {
  const s: Vec2 = [-f[1], f[0]];
  const mid = mb.vertex(c, 0.5, 0.5);
  const ring: number[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push(mb.vertex([c[0] + s[0] * Math.cos(a) * r, c[1] + s[1] * Math.cos(a) * r, c[2] + Math.sin(a) * r], 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2));
  }
  // s is the viewer's right looking back along -f, so rising angles run counter-clockwise to them.
  for (let i = 0; i < n; i++) mb.tri(mid, ring[i], ring[i + 1]);
}

interface Pole {
  at: Vec2;
  mast: boolean;
  /** Arms over the road: unit direction and length. */
  arms: { dir: Vec2; len: number }[];
  heads: { face: Vec2; side: number; z?: number; at?: Vec2; board?: boolean }[];
}

export interface TrafficLightInput {
  sites: SignalSite[];
  /** Height of the road surface (paint sits on it). */
  roadZ: HeightFn;
  /** Height of the ground (posts stand on it). */
  groundZ: HeightFn;
  /** True on asphalt: a post never stands there. */
  onRoad?: (x: number, y: number) => boolean;
}

export interface TrafficLightResult {
  nodes: Kn5MeshNode[];
  poles: number;
  heads: number;
}

/** Posts, heads and lenses for every site, and their stop and crossing lines. */
export function buildTrafficLights(input: TrafficLightInput): TrafficLightResult {
  const { sites, roadZ, groundZ, onRoad } = input;
  const nodes: Kn5MeshNode[] = [];
  let poleCount = 0, headCount = 0;
  for (const site of sites) {
    const poles: Pole[] = [];
    const place = (at: Vec2, out: Vec2, mast: boolean): Pole | null => {
      // Off the asphalt: step outwards until clear.
      let p = at;
      for (let k = 0; k < 9 && onRoad?.(p[0], p[1]); k++) p = [at[0] + out[0] * 0.5 * (k + 1), at[1] + out[1] * 0.5 * (k + 1)];
      if (onRoad?.(p[0], p[1])) return null;
      const same = poles.find((q) => len(sub(q.at, p)) < 1.6);
      if (same) {
        same.mast ||= mast;
        return same;
      }
      const pole: Pole = { at: p, mast, arms: [], heads: [] };
      poles.push(pole);
      return pole;
    };
    const paint = new MeshBuilder();
    for (const arm of site.arms) {
      const d = arm.dir, L: Vec2 = [d[1], -d[0]], R: Vec2 = [-d[1], d[0]];
      const w = arm.width;
      // Primary: near-left corner, just past the stop line.
      const along = Math.max(1.5, arm.stop - 1.0);
      const mast = w >= MAST_WIDTH;
      const prim = place([site.c[0] + d[0] * along + L[0] * (w / 2 + 0.7), site.c[1] + d[1] * along + L[1] * (w / 2 + 0.7)], L, mast);
      if (prim) {
        prim.heads.push({ face: d, side: arm.side });
        if (mast) {
          // Over the middle of the approach lanes.
          const reach = len(sub(prim.at, [site.c[0] + d[0] * along + L[0] * (w / 4), site.c[1] + d[1] * along + L[1] * (w / 4)]));
          prim.arms.push({ dir: R, len: reach });
          prim.heads.push({ face: d, side: arm.side, z: MAST_ARM_Z - 0.75, at: [prim.at[0] + R[0] * reach, prim.at[1] + R[1] * reach], board: true });
        }
      }
      // Secondary: far right, across the junction.
      const opp = site.arms.find((o) => o !== arm && angDiff(angleOf(o.dir), angleOf(d)) > (150 * Math.PI) / 180);
      const far = opp
        ? place([site.c[0] - d[0] * Math.max(1.5, opp.stop - 1.0) + R[0] * (opp.width / 2 + 0.7), site.c[1] - d[1] * Math.max(1.5, opp.stop - 1.0) + R[1] * (opp.width / 2 + 0.7)], R, false)
        : place([site.c[0] - d[0] * (arm.stop - WALK - STOP_GAP + 1.0) + R[0] * (w / 4), site.c[1] - d[1] * (arm.stop - WALK - STOP_GAP + 1.0) + R[1] * (w / 4)], [-d[0], -d[1]], false);
      if (far && far !== prim) far.heads.push({ face: d, side: arm.side });
      // Stop line: across the approach lanes (the left half), 0.3 m deep.
      paintBar(paint, site.c, d, arm.stop, 0.3, -0.15, -(w / 2 - 0.3), roadZ);
      // A junction's crossing lines across the whole road in front of it.
      if (site.kind === "junction") {
        const near = arm.stop - 0.15 - STOP_GAP;
        for (const at of [near, near - WALK]) paintBar(paint, site.c, d, at, 0.15, w / 2 - 0.3, -(w / 2 - 0.3), roadZ);
      }
    }
    if (site.kind === "crossing") {
      const a = site.arms[0];
      for (const at of [WALK / 2, -WALK / 2]) paintBar(paint, site.c, a.dir, at, 0.15, a.width / 2 - 0.3, -(a.width / 2 - 0.3), roadZ);
    }
    // The meshes: posts, heads (housings, visors, boards), and each side's lenses.
    const postMb = new MeshBuilder(), headMb = new MeshBuilder();
    const lens = new Map<string, MeshBuilder>();
    const lensMb = (side: number, colour: string) => {
      const k = `${side}_${colour}`;
      let mb = lens.get(k);
      if (!mb) lens.set(k, (mb = new MeshBuilder()));
      return mb;
    };
    for (const pole of poles) {
      const z0 = groundZ(pole.at[0], pole.at[1]);
      const r = pole.mast ? MAST_R : POST_R;
      cylinder(postMb, pole.at[0], pole.at[1], z0 - 0.3, z0 + (pole.mast ? MAST_H : POST_H), r);
      for (const arm of pole.arms) {
        const mid: Vec3 = [pole.at[0] + arm.dir[0] * arm.len / 2, pole.at[1] + arm.dir[1] * arm.len / 2, z0 + MAST_ARM_Z];
        box(postMb, mid, arm.dir, arm.len / 2 + r, 0.045, 0.045);
      }
      // Heads on the pole: stacked when two would face the same way.
      const placed: { face: Vec2; z: number }[] = [];
      for (const h of pole.heads) {
        let z = h.z ?? POLE_HEAD_Z;
        if (!h.at) while (placed.some((q) => Math.abs(q.z - z) < 0.5 && angDiff(angleOf(q.face), angleOf(h.face)) < Math.PI / 4)) z += HEAD_H + 0.1;
        if (!h.at) placed.push({ face: h.face, z });
        const base: Vec2 = h.at ?? [pole.at[0] + h.face[0] * (r + 0.12 + HEAD_D / 2), pole.at[1] + h.face[1] * (r + 0.12 + HEAD_D / 2)];
        const c: Vec3 = [base[0], base[1], z0 + z];
        // Bracket to the pole.
        if (!h.at) box(headMb, [pole.at[0] + h.face[0] * (r + 0.06), pole.at[1] + h.face[1] * (r + 0.06), c[2]], h.face, 0.07, 0.03, 0.03);
        else box(headMb, [c[0], c[1], z0 + MAST_ARM_Z - 0.12 - 0.02], h.face, 0.03, 0.03, 0.1);
        box(headMb, c, h.face, HEAD_D / 2, HEAD_W / 2, HEAD_H / 2);
        if (h.board) box(headMb, [c[0] - h.face[0] * (HEAD_D / 2 + 0.01), c[1] - h.face[1] * (HEAD_D / 2 + 0.01), c[2]], h.face, 0.01, 0.31, 0.64);
        const s: Vec2 = [-h.face[1], h.face[0]];
        const front = HEAD_D / 2;
        (["RED", "AMBER", "GREEN"] as const).forEach((colour, k) => {
          const az = c[2] + ASPECT_DZ * (1 - k);
          disc(lensMb(h.side, colour), [c[0] + h.face[0] * (front + 0.004), c[1] + h.face[1] * (front + 0.004), az], h.face, LENS_R);
          // Visor: a hood over the lens (top and sides), open below.
          const vf = front + 0.09;
          const vc: Vec2 = [c[0] + h.face[0] * vf, c[1] + h.face[1] * vf];
          box(headMb, [vc[0], vc[1], az + LENS_R + 0.02], h.face, 0.09, LENS_R + 0.03, 0.006);
          for (const sd of [1, -1]) box(headMb, [vc[0] + s[0] * sd * (LENS_R + 0.03), vc[1] + s[1] * sd * (LENS_R + 0.03), az + 0.02], h.face, 0.09, 0.006, LENS_R);
        });
        headCount++;
      }
      poleCount++;
    }
    if (!poles.length && !paint.indices.length) continue;
    const pre = `TRAFFICLIGHT_${site.id}`;
    if (postMb.indices.length) nodes.push(postMb.toKn5(`${pre}_POLES`, "tl_pole", { castShadows: true }));
    if (headMb.indices.length) nodes.push(headMb.toKn5(`${pre}_HEADS`, "tl_head", { castShadows: true }));
    for (const [k, mb] of [...lens].sort(([a], [b]) => a.localeCompare(b))) {
      const [side, colour] = k.split("_");
      nodes.push(mb.toKn5(lensName(site.id, Number(side), colour as "RED" | "AMBER" | "GREEN"), `tl_${colour.toLowerCase()}`, { castShadows: false }));
    }
    if (paint.indices.length) nodes.push(paint.toKn5(`MARKINGS_TL_${site.id}`, "paint", { castShadows: false }));
  }
  return { nodes, poles: poleCount, heads: headCount };
}

/** The mesh holding one side's lenses of one colour (named in traffic.json's emissive roles). */
export const lensName = (site: number, side: number, colour: "RED" | "AMBER" | "GREEN") => `TRAFFICLIGHT_${site}_S${side + 1}_${colour}`;

/**
 * A painted bar across an arm at distance `at` from the centre, `depth` deep, from lateral offset
 * t0 to t1 (+ = left of the arm's outward direction, i.e. the right of traffic driving in),
 * draped on the road in 1 m pieces.
 */
function paintBar(mb: MeshBuilder, c: Vec2, d: Vec2, at: number, depth: number, t0: number, t1: number, z: HeightFn): void {
  const l: Vec2 = [-d[1], d[0]];
  const span = Math.abs(t1 - t0);
  if (span < 0.3) return;
  const n = Math.max(1, Math.ceil(span));
  const lo = Math.min(t0, t1);
  const row = (a: number) => Array.from({ length: n + 1 }, (_, i) => {
    const t = lo + (span * i) / n;
    const x = c[0] + d[0] * a + l[0] * t, y = c[1] + d[1] * a + l[1] * t;
    return mb.vertex([x, y, z(x, y) + 0.02], i / n, a);
  });
  const near = row(at - depth / 2), farR = row(at + depth / 2);
  // Seen from above: near row runs along +l, far row is further out along d. (d, l) is counter-clockwise.
  for (let i = 0; i < n; i++) mb.quad(near[i], farR[i], farR[i + 1], near[i + 1]);
}

/* ---------------- materials ---------------- */

const COLOURS: Record<string, [number, number, number]> = {
  tl_pole: [148, 150, 148], // galvanised grey
  tl_head: [20, 20, 20],
  tl_red: [120, 18, 14],
  tl_amber: [132, 86, 10],
  tl_green: [16, 112, 74],
};

/** Textures and materials for the posts, heads and lenses (the lenses unlit until the traffic planner lights them). */
export function trafficLightMaterials(): { texture: string; png: Uint8Array; material: Kn5Material }[] {
  return Object.entries(COLOURS).map(([name, rgb]) => {
    const lensMat = /red|amber|green/.test(name);
    return {
      texture: `${name}.png`,
      png: encodePng(fill(4, 4, () => rgb), 4, 4, { alpha: false }),
      material: {
        name,
        shader: "ksPerPixel",
        properties: [
          { name: "ksAmbient", a: lensMat ? 0.35 : 0.45 },
          { name: "ksDiffuse", a: lensMat ? 0.3 : 0.45 },
          { name: "ksSpecular", a: name === "tl_pole" ? 0.35 : 0.25 },
          { name: "ksSpecularEXP", a: lensMat ? 60 : 20 },
          { name: "ksEmissive", c: [0, 0, 0] },
          { name: "ksAlphaRef", a: 0 },
        ],
        textures: { txDiffuse: `${name}.png` },
      },
    };
  });
}

/* ---------------- the traffic planner ---------------- */

interface TrafficData {
  lanes: { points: [number, number, number][] }[];
  intersections: { name: string; id: number; points: [number, number, number][]; trafficLight?: unknown; [k: string]: unknown }[];
  [k: string]: unknown;
}

/**
 * traffic.json with the lights: each signalled site's intersection becomes a four-sided polygon,
 * one edge across each approach at its stop line, with a "Basic" traffic light whose emissive
 * roles are that approach's lens meshes. A site whose arms don't each get a side of their own (a
 * five-way junction, say) keeps its polygon and gives way as before. A crossing away from any
 * junction gets an intersection of its own. AC space is x east, y up, z south.
 */
export function addTrafficLights(trafficText: string, sites: SignalSite[], duration = 20): string {
  if (!trafficText || !sites.length) return trafficText;
  const data = JSON.parse(trafficText) as TrafficData;
  const centre = (pts: [number, number, number][]): Vec2 => [pts.reduce((s, p) => s + p[0], 0) / pts.length, -pts.reduce((s, p) => s + p[2], 0) / pts.length];
  const radius = (pts: [number, number, number][], c: Vec2) => Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], -p[2] - c[1])));
  let nextId = Math.max(0, ...data.intersections.map((i) => i.id)) + 1;
  const laneHeight = (c: Vec2): number | null => {
    let best: number | null = null, bd = 15;
    // Nearest point on any lane (lanes can be long straight runs with few points).
    for (const l of data.lanes) for (let i = 1; i < l.points.length; i++) {
      const a = l.points[i - 1], b = l.points[i];
      const r = onSegment(c, [a[0], -a[2]], [b[0], -b[2]]);
      if (r.d < bd) {
        bd = r.d;
        best = a[1] + (b[1] - a[1]) * r.f;
      }
    }
    return best;
  };
  for (const site of sites) {
    if (!site.sidesOk) continue;
    const reach = Math.max(...site.extent);
    // A crossing too close to a junction's polygon would fight it: left without working lights.
    if (site.kind === "crossing") {
      if (data.intersections.some((it) => {
        const c = centre(it.points);
        return Math.hypot(c[0] - site.c[0], c[1] - site.c[1]) < radius(it.points, c) + reach;
      })) continue;
    }
    const match = site.kind === "crossing" ? undefined : data.intersections
      .map((it) => ({ it, c: centre(it.points) }))
      .filter(({ it, c }) => Math.hypot(c[0] - site.c[0], c[1] - site.c[1]) < Math.max(8, reach) && radius(it.points, c) < reach * 1.6 + 10)
      .sort((a, b) => Math.hypot(a.c[0] - site.c[0], a.c[1] - site.c[1]) - Math.hypot(b.c[0] - site.c[0], b.c[1] - site.c[1]))[0];
    const h = match ? match.it.points.reduce((s, p) => s + p[1], 0) / match.it.points.length : laneHeight(site.c);
    if (h === null) continue;
    if (!match && site.kind === "junction") continue;
    // Corner k joins side k-1 and side k: on a rectangle, the sum of the two sides' offsets.
    const n = (k: number): Vec2 => [Math.cos(site.theta + (k * Math.PI) / 2), Math.sin(site.theta + (k * Math.PI) / 2)];
    const points: [number, number, number][] = [0, 1, 2, 3].map((k) => {
      const a = n((k + 3) % 4), b = n(k);
      const ea = site.extent[(k + 3) % 4], eb = site.extent[k];
      const x = site.c[0] + a[0] * ea + b[0] * eb, y = site.c[1] + a[1] * ea + b[1] * eb;
      return [round(x), round(h), round(-y)];
    });
    // The edge from corner k (sides k-1 and k) to corner k+1 (sides k and k+1) is side k: the
    // planner's side k+1, counting from 1.
    const emissive = [0, 1, 2, 3].map((k) => (site.arms.some((a) => a.side === k)
      ? { mode: 1, roles: (["RED", "AMBER", "GREEN"] as const).map((col) => ({ mesh: lensName(site.id, k, col) })) }
      : {}));
    const trafficLight = { program: "Basic", params: { duration }, emissive };
    if (match) {
      match.it.points = points;
      match.it.trafficLight = trafficLight;
      match.it.name = `Signals ${site.id} (${match.it.name})`;
    } else {
      data.intersections.push({ name: `Signals ${site.id}`, id: nextId++, points, trafficLight });
    }
  }
  return JSON.stringify(data);
}

const round = (v: number) => Math.round(v * 1000) / 1000;
