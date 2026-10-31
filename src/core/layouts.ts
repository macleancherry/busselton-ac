// Busselton fork: several layouts on one map. AC loads a track folder with layouts like this:
//
//   <track>/<track>.kn5              the shared world (no start, pit or timing dummies)
//   <track>/layout_<id>.kn5          each layout's dummies
//   <track>/models_<id>.ini          which kn5 files each layout loads
//   <track>/<id>/ai/fast_lane.ai     each layout's AI line
//   <track>/<id>/data/*.ini          its surfaces, map, cameras, AI hints
//   <track>/<id>/map.png
//   <track>/ui/<id>/ui_track.json    its name in the game's track list, outline, preview
//
// The world is built once, from the main route (and its area). The main route becomes one layout
// (asLayout); every other layout is a route over roads the world already has, or a set of spawn
// points for free roam, laid on the world's own road surface (layoutFiles).
import { aiHintsIni, buildAiLine } from "./aiLine";
import type { BayBox } from "./bayLanes";
import { layoutChallengesIni } from "./challengeFiles";
import { cruiseLayoutIni, cruiseSights, limitsByPercent } from "./cruise";
import type { ChallengesOption } from "./challenges";
import { landmarkShots, type Landmark } from "./landmarkShots";
import { readFastLaneAi, writeFastLaneAi, type AiPoint } from "./aiSpline";
import { camerasIni, placeCameras } from "./cameras";
import { outlinePng, previewPng, trackMap, uiTrackJson, type TrackMeta } from "./acFiles";
import { frameTransform, IDENTITY, writeKn5, type Kn5GroupNode, type Kn5Model, type Kn5Node } from "./kn5";
import { withDefaults, type BuildOptions } from "./options";
import { planRoad, type RoadPlan } from "./road";
import type { LngLat, LocalProjection } from "./geo";
import { simplify } from "./polyline";
import { pitLaneFiles } from "./pitLane";
import { clearAiPoint, GRID_CLEAR_AHEAD, junctionsOn, type GridAvoid } from "./gridSlots";
import { retimeAi, ringCircles, ringHintValues, smoothKinks, type WorldRing } from "./aiRings";

type Vec2 = [number, number];
const enc = new TextEncoder();

/** The kn5 holding a layout's dummies. */
export function dummiesKn5(name: string, dummies: Kn5GroupNode[]): Uint8Array {
  const model: Kn5Model = { textures: [], materials: [], root: { kind: "node", name, transform: IDENTITY, children: dummies } };
  return writeKn5(model);
}

export function modelsIni(files: string[]): string {
  return files.map((f, k) => `[MODEL_${k}]\r\nFILE=${f}\r\nPOSITION=0,0,0\r\nROTATION=0,0,0\r\n`).join("\r\n");
}

/** Moves a single-layout build's files into layout `id`'s places, beside the shared world. */
export function asLayout(files: Record<string, Uint8Array>, slug: string, id: string, dummies: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) {
    const rest = k.slice(slug.length + 1);
    if (rest.startsWith("ai/") || rest.startsWith("data/") || rest === "map.png") out[`${slug}/${id}/${rest}`] = v;
    else if (rest.startsWith("ui/")) out[`${slug}/ui/${id}/${rest.slice(3)}`] = v;
    else out[k] = v;
  }
  out[`${slug}/layout_${id}.kn5`] = dummies;
  out[`${slug}/models_${id}.ini`] = enc.encode(modelsIni([`${slug}.kn5`, `layout_${id}.kn5`]));
  return out;
}

/**
 * Height of the drivable surface (road, street or kerb meshes) at a point, local metres (x east,
 * y north), or null off them. Built once over the world's meshes.
 */
export function surfaceHeight(model: Kn5Model, names = /^\d(ROAD|STREET|KERB|UNSEALED|UNPAVED)/): (x: number, y: number) => number | null {
  const CELL = 4;
  const tris: number[] = []; // x0 z0 y0 x1 z1 y1 x2 z2 y2
  const grid = new Map<string, number[]>();
  const walk = (n: Kn5Node) => {
    if (n.kind === "node") return n.children.forEach(walk);
    if (!names.test(n.name)) return;
    const p = n.positions, ix = n.indices;
    for (let i = 0; i < ix.length; i += 3) {
      const t = tris.length / 9;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const v = ix[i + k] * 3;
        tris.push(p[v], p[v + 2], p[v + 1]);
        x0 = Math.min(x0, p[v]); x1 = Math.max(x1, p[v]);
        z0 = Math.min(z0, p[v + 2]); z1 = Math.max(z1, p[v + 2]);
      }
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
        for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
          const key = `${cx},${cz}`;
          const list = grid.get(key);
          if (list) list.push(t); else grid.set(key, [t]);
        }
      }
    }
  };
  walk(model.root);
  return (x, y) => {
    const z = -y;
    let best: number | null = null;
    for (const t of grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? []) {
      const o = t * 9;
      const ax = tris[o], az = tris[o + 1], bx = tris[o + 3], bz = tris[o + 4], cx = tris[o + 6], cz = tris[o + 7];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      const w = 1 - u - v;
      if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
      const h = u * tris[o + 2] + v * tris[o + 5] + w * tris[o + 8];
      if (best === null || h > best) best = h;
    }
    return best;
  };
}

export interface LayoutSpec {
  id: string;
  name: string;
  /** A route over the world's roads: the routed geometry, [lng, lat]. */
  coords?: LngLat[];
  /**
   * Free roam: where cars start, [lng, lat] and heading in degrees clockwise from north. With
   * `coords` as well, those are the free roam's own AI loop (for AI Flood) instead of the main
   * layout's line. Spawns are starts only where they sit on the AI line (spawnsOnLine), the first of
   * those being the player's; the rest of the boxes go on its straights (floodPits).
   */
  spawns?: { at: LngLat; heading: number }[];
  /** Busselton fork: hand-picked checkpoints for the Busselton Challenges app (challenges.ts). */
  challenges?: ChallengesOption;
  /**
   * Free roam: pit boxes in all (default FLOOD_PITS). Track Day gives each AI car a pit box, so
   * this caps how many AI cars AI Flood can use; the extra boxes go on the AI line (floodPits).
   */
  aiPits?: number;
}

/** Free roam's default pit box count: enough AI cars for AI Flood in town without loading the 4060. */
export const FLOOD_PITS = 24;

export interface World {
  slug: string;
  proj: LocalProjection;
  model: Kn5Model;
  options: Partial<BuildOptions>;
  meta: Partial<TrackMeta>;
  /** The main layout's AI line, for free roam (AC wants one). */
  mainAi?: Uint8Array;
  /** The main layout's AI hints (speed limits), which go with mainAi. */
  mainHints?: Uint8Array;
  /**
   * The world's road and street centrelines (local metres) and its roundabouts: a layout's route
   * is pulled onto them, since the router's line and the built street can sit metres apart.
   */
  lines?: Vec2[][];
  /** Each line's speed limit, km/h, for the layouts' AI hints. */
  speeds?: number[];
  /** Busselton fork: landmarks the automatic test photographs as it drives past (landmarkShots.ts). */
  landmarks?: Landmark[];
  /** The world's roundabouts: centre, outer edge and (when known) island edge, local metres. */
  rings?: WorldRing[];
  /** Busselton fork: painted kerbside bays (track.ts bayBoxes) a layout's keep-left line keeps clear of (bayLanes.ts). */
  bays?: BayBox[];
}

/** Nearest point on any of a set of lines, by a grid of their segments. */
class LineGrid {
  private grid = new Map<string, [Vec2, Vec2, number][]>();
  constructor(lines: Vec2[][], private reach: number, private cell = 10) {
    lines.forEach((l, k) => {
      for (let i = 1; i < l.length; i++) {
        const a = l[i - 1], b = l[i];
        const x0 = Math.floor((Math.min(a[0], b[0]) - reach) / cell), x1 = Math.floor((Math.max(a[0], b[0]) + reach) / cell);
        const y0 = Math.floor((Math.min(a[1], b[1]) - reach) / cell), y1 = Math.floor((Math.max(a[1], b[1]) + reach) / cell);
        for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
          const key = `${cx},${cy}`;
          const list = this.grid.get(key);
          if (list) list.push([a, b, k]); else this.grid.set(key, [[a, b, k]]);
        }
      }
    });
  }

  nearest(p: Vec2): { q: Vec2; d: number; line: number } | null {
    let best: { q: Vec2; d: number; line: number } | null = null;
    for (const [a, b, k] of this.grid.get(`${Math.floor(p[0] / this.cell)},${Math.floor(p[1] / this.cell)}`) ?? []) {
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const q: Vec2 = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= this.reach && (!best || d < best.d)) best = { q, d, line: k };
    }
    return best;
  }
}

/** Moves each point onto the nearest centreline within `reach` metres (not near a roundabout). */
/**
 * Moves AI line points that have no drivable surface under them onto the nearest one within 5 m,
 * half a metre in from its edge, then redoes the distances and directions. The smoothed line
 * through a roundabout can cut the corner where a street leaves it square, over the verge, and the
 * AI follows it onto the grass.
 */
export function keepOnSurface<T extends { position: [number, number, number]; distance: number; length: number; forward: [number, number, number] }>(
  ai: T[], height: (x: number, y: number) => number | null,
): T[] {
  const on = (x: number, z: number) => height(x, -z) !== null;
  let moved = 0;
  for (const p of ai) {
    const [x, , z] = p.position;
    if (on(x, z)) continue;
    let found: [number, number] | null = null;
    for (let r = 0.25; r <= 5 && !found; r += 0.25) {
      for (let a = 0; a < 32; a++) {
        const t = (a / 32) * 2 * Math.PI, dx = Math.cos(t), dz = Math.sin(t);
        if (on(x + dx * r, z + dz * r)) {
          // Half a metre further in, if that's still on the surface.
          const in2: [number, number] = [x + dx * (r + 0.5), z + dz * (r + 0.5)];
          found = on(in2[0], in2[1]) ? in2 : [x + dx * r, z + dz * r];
          break;
        }
      }
    }
    if (!found) continue;
    const h = height(found[0], -found[1])!;
    p.position = [found[0], h, found[1]];
    moved++;
  }
  if (!moved) return ai;
  let d = 0;
  ai.forEach((p, i) => {
    const q = ai[(i + 1) % ai.length];
    const dx = q.position[0] - p.position[0], dy = q.position[1] - p.position[1], dz = q.position[2] - p.position[2];
    const L = Math.hypot(dx, dy, dz);
    p.distance = d;
    if (i < ai.length - 1 || L < 50) {
      p.length = L;
      if (L > 1e-6) p.forward = [dx / L, dy / L, dz / L];
    }
    d += p.length;
  });
  return ai;
}

export function snapToLines(pts: Vec2[], lines: Vec2[][], rings: { c: Vec2; rOut: number }[] = [], reach = 8): Vec2[] {
  const grid = new LineGrid(lines, reach);
  return pts.map((p) => {
    if (rings.some((r) => Math.hypot(p[0] - r.c[0], p[1] - r.c[1]) < r.rOut + 6)) return p;
    return grid.nearest(p)?.q ?? p;
  });
}

/** Fills gaps (off the meshes, e.g. a junction's seam) from the nearest sample that has a height. */
function fillHeights(hs: (number | null)[], fallback: number): number[] {
  const out = hs.slice();
  for (let i = 0; i < out.length; i++) {
    if (out[i] !== null) continue;
    let k = 1;
    while (k < out.length && out[i - k] == null && out[i + k] == null) k++;
    out[i] = out[i - k] ?? out[i + k] ?? fallback;
  }
  return out as number[];
}

const dummy = (name: string, pos: [number, number, number], fwd: [number, number, number]): Kn5GroupNode =>
  ({ kind: "node", name, transform: frameTransform(pos, fwd), children: [] });

/**
 * A route's AI line on the world's streets: the route pulled onto the built centrelines, heights
 * from the road surface, and the speed limit of the street under each stretch.
 */
function routeAi(world: World, coords: LngLat[], opts: BuildOptions, height: (x: number, y: number) => number | null) {
  const local = coords.map((p) => world.proj.toLocal(p));
  // On to the world's own streets (densified first, so long straight legs follow them too).
  const dense: Vec2[] = [];
  local.forEach((p, i) => {
    if (i) {
      const q = local[i - 1], n = Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 4);
      for (let k = 1; k < n; k++) dense.push([q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n]);
    }
    dense.push(p);
  });
  // Planned with the world's roundabouts (aiRings.ts): the route's arc round each stays a circle
  // instead of being smoothed into a wiggle that flicks out of the ring.
  const rings = world.rings ?? [];
  const plan = planRoad(world.lines?.length ? snapToLines(dense, world.lines, rings) : local, opts, undefined, ringCircles(rings));
  const hs = fillHeights(plan.samples.map((s) => height(s.pos[0], s.pos[1])), 0);
  plan.samples.forEach((s, i) => { s.h = hs[i]; s.bank = 0; });
  // On the surface, the kinks that leaves eased out, then radii and speeds from the line itself,
  // slow on the rings (aiRings.ts).
  const ai = retimeAi(smoothKinks(keepOnSurface(buildAiLine(plan, { keepLeft: opts.aiKeepLeft, bays: world.bays }), height), height, plan.closed), plan.closed, rings);
  // Speed limits from the street each stretch is on (the world's), so the AI drives a town street
  // at 50 rather than at the grip limit.
  let limitAt: ((d: number) => number | undefined) | undefined;
  if (world.lines?.length && world.speeds?.length) {
    const grid = new LineGrid(world.lines, 12);
    const lim = plan.samples.map((smp) => { const n = grid.nearest(smp.pos); return n ? world.speeds![n.line] : undefined; });
    const total = ai.length ? ai[ai.length - 1].distance + ai[ai.length - 1].length : 1;
    limitAt = (d) => lim[Math.max(0, Math.min(lim.length - 1, Math.round((d / total) * (lim.length - 1))))];
  }
  return { plan, hs, ai, limitAt, hints: aiHintsIni(ai, limitAt, !plan.closed, ringHintValues(ai, rings, plan.closed)) };
}

/** What a layout's grid and boxes keep clear of: the world's roundabouts and the streets meeting `road` (local metres). */
export function worldAvoid(world: World, road: Vec2[]): GridAvoid {
  return { rings: world.rings ?? [], junctions: world.lines?.length ? junctionsOn(road, world.lines) : [], clearAhead: GRID_CLEAR_AHEAD };
}

/**
 * Pit boxes for AI Flood (CSP, Track Day): `n` spots spread evenly round the AI line, each on the
 * line (in its lane: the line keeps left) and facing along it, so every AI car starts on its line
 * and drives straight off (there is no pit lane). On straights (radius GRID_MIN_RADIUS and up),
 * clear of `clear`'s roundabouts and junctions; where a stretch has no such spot, any spot off a
 * tight corner (radius under 80 m) will do. 25 m clear of `avoid` (spots already taken, local
 * metres) and of each other. Positions in AC space, on the line.
 */
export function floodPits(ai: AiPoint[], n: number, avoid: Vec2[] = [], clear: GridAvoid = {}): { pos: [number, number, number]; fwd: [number, number, number] }[] {
  if (n <= 0 || ai.length < 2) return [];
  const total = ai[ai.length - 1].distance + ai[ai.length - 1].length;
  const step = total / n;
  const taken: Vec2[] = [...avoid];
  const out: { pos: [number, number, number]; fwd: [number, number, number] }[] = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    const target = (k + 0.5) * step;
    while (i < ai.length - 1 && ai[i].distance < target) i++;
    // Forward from there, up to most of a step, to the first good spot: a clear straight first.
    for (const good of [(p: AiPoint) => clearAiPoint(p, clear), (p: AiPoint) => p.radius >= 80]) {
      let found = false;
      for (let j = i; j < ai.length && ai[j].distance < target + step * 0.8; j++) {
        const p = ai[j];
        const xy: Vec2 = [p.position[0], -p.position[2]];
        if (!good(p)) continue;
        if (taken.some((t) => Math.hypot(t[0] - xy[0], t[1] - xy[1]) < 25)) continue;
        const f = Math.hypot(p.forward[0], p.forward[2]) || 1;
        out.push({ pos: [p.position[0], p.position[1], p.position[2]], fwd: [p.forward[0] / f, 0, p.forward[2] / f] });
        taken.push(xy);
        found = true;
        break;
      }
      if (found) break;
    }
  }
  return out;
}

/** Hand-placed spawns further than this from the AI line (metres) aren't AI starts. */
export const SPAWN_ON_LINE = 3;

/**
 * Which hand-placed free roam spawns can be starts: on the AI line (within SPAWN_ON_LINE) and
 * facing along it. A car started in a car park off the line never finds its way onto it (retest 3:
 * ten of fifteen AI cars didn't move), and that goes for the first spawn too: AC puts the player
 * (and, in a race, AI car 1) in box 0, and with the first spawn kept regardless, the automatic test
 * car and AI car 1 sat in a car park 266 m from the line and never moved (retest 4).
 */
export function spawnsOnLine(spots: { x: number; y: number; fwd: Vec2 }[], ai: AiPoint[]): boolean[] {
  return spots.map((s) => {
    let best = Infinity, dot = 0;
    for (let i = 0; i < ai.length; i++) {
      const p = ai[i], q = ai[(i + 1) % ai.length];
      const ax = p.position[0], ay = -p.position[2], bx = q.position[0] - ax, by = -q.position[2] - ay;
      const L2 = bx * bx + by * by;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((s.x - ax) * bx + (s.y - ay) * by) / L2)) : 0;
      const d = Math.hypot(s.x - ax - bx * t, s.y - ay - by * t);
      if (d < best) { best = d; dot = s.fwd[0] * p.forward[0] - s.fwd[1] * p.forward[2]; }
    }
    return best <= SPAWN_ON_LINE && dot > Math.cos(Math.PI / 6);
  });
}

/** A layout's own files (dummies kn5, AI line, data, ui), on the world's road surface. */
export function layoutFiles(world: World, layout: LayoutSpec, trackObjects: (plan: RoadPlan, opts: BuildOptions, avoid?: GridAvoid) => Kn5GroupNode[]): Record<string, Uint8Array> {
  const opts = withDefaults({ ...world.options, name: layout.name });
  const { slug, proj } = world;
  const height = surfaceHeight(world.model);
  const files: Record<string, Uint8Array> = {};
  const meta: TrackMeta = { ...world.meta, name: layout.name };
  const base = `${slug}/${layout.id}`;
  let outline: [number, number][];
  let closed = false, length = 0, pitboxes = opts.pitCount;

  if (layout.spawns?.length) {
    const spots = layout.spawns.map(({ at, heading }) => {
      const [x, y] = proj.toLocal(at);
      const r = (heading * Math.PI) / 180;
      const fwd: Vec2 = [Math.sin(r), Math.cos(r)];
      return { x, y, fwd, h: height(x, y) };
    });
    const dummies: Kn5GroupNode[] = [];
    // The AI line: the free roam's own loop if it has one (pins), else the main layout's, with its
    // speed limits either way (AI Flood's cars are town traffic, not racers).
    let ai: AiPoint[] = [];
    if (layout.coords && layout.coords.length >= 2) {
      const r = routeAi(world, layout.coords, opts, height);
      ai = r.ai;
      files[`${base}/ai/fast_lane.ai`] = writeFastLaneAi(ai);
      files[`${base}/data/ai_hints.ini`] = enc.encode(r.hints);
    } else if (world.mainAi) {
      files[`${base}/ai/fast_lane.ai`] = world.mainAi;
      if (world.mainHints) files[`${base}/data/ai_hints.ini`] = world.mainHints;
      ai = readFastLaneAi(world.mainAi);
    }
    if (ai.length > 1) {
      const last = ai[ai.length - 1];
      length = last.distance + last.length;
      const gap = Math.hypot(last.position[0] - ai[0].position[0], last.position[2] - ai[0].position[2]);
      closed = gap < 50;
    }
    // The hand-placed spawns that are on the AI line, then the rest of the boxes on the AI line's
    // straights, for Track Day's AI cars (one box each). Box 0 is the player's start, so it's the
    // first that's on the line: with no hand-placed spawn on it, the first straight's box.
    const keep = ai.length > 1 ? spawnsOnLine(spots, ai) : spots.map(() => true);
    const starts = spots.filter((_, k) => keep[k]);
    const boxes: { x: number; y: number; h: number; fwd: Vec2 }[] = starts.map((s) => ({ x: s.x, y: s.y, h: (s.h ?? 0) + 0.5, fwd: s.fwd }));
    const clear = worldAvoid(world, ai.map((p) => [p.position[0], -p.position[2]] as Vec2));
    const extra = floodPits(ai, (layout.aiPits ?? FLOOD_PITS) - starts.length, starts.map((s) => [s.x, s.y] as Vec2), clear);
    for (const p of extra) boxes.push({ x: p.pos[0], y: -p.pos[2], h: (height(p.pos[0], -p.pos[2]) ?? p.pos[1]) + 0.5, fwd: [p.fwd[0], -p.fwd[2]] });
    // No AI line and no spawn kept can't happen (without a line every spawn stays), but never ship no start.
    if (!boxes.length) boxes.push({ x: spots[0].x, y: spots[0].y, h: (spots[0].h ?? 0) + 0.5, fwd: spots[0].fwd });
    boxes.forEach((b, k) => {
      const pos: [number, number, number] = [b.x, b.h, -b.y], fwd: [number, number, number] = [b.fwd[0], 0, -b.fwd[1]];
      dummies.push(dummy(`AC_START_${k}`, pos, fwd), dummy(`AC_PIT_${k}`, pos, fwd));
    });
    pitboxes = boxes.length;
    // A timing line 15 m ahead of the player's start, so sessions that want one have it.
    const s0 = boxes[0], ahead: Vec2 = [s0.x + s0.fwd[0] * 15, s0.y + s0.fwd[1] * 15], left: Vec2 = [-s0.fwd[1], s0.fwd[0]];
    const h0 = (height(ahead[0], ahead[1]) ?? s0.h - 0.5) + 1;
    const f3: [number, number, number] = [s0.fwd[0], 0, -s0.fwd[1]];
    dummies.push(
      dummy("AC_HOTLAP_START_0", [s0.x, s0.h, -s0.y], f3),
      dummy("AC_TIME_0_L", [ahead[0] + left[0] * 5, h0, -(ahead[1] + left[1] * 5)], f3),
      dummy("AC_TIME_0_R", [ahead[0] - left[0] * 5, h0, -(ahead[1] - left[1] * 5)], f3),
    );
    files[`${slug}/layout_${layout.id}.kn5`] = dummiesKn5(layout.id, dummies);
    // A pit lane past the first AI box, and the ideal line (pitLane.ts).
    if (ai.length > 1) Object.assign(files, pitLaneFiles(base, ai, files[`${base}/ai/fast_lane.ai`], dummies, closed));
    const challenges = layoutChallengesIni(layout.name, null, (p) => proj.toLocal(p), (x, y) => height(x, y) ?? spots[0].h ?? 0, layout.challenges);
    if (challenges) files[`${base}/data/challenges.ini`] = enc.encode(challenges);
    // Busselton fork: cruise mode (cruise.ts): in free roam every landmark is a sight.
    if (world.landmarks?.length) files[`${base}/data/cruise.ini`] = enc.encode(cruiseLayoutIni(layout.name, { closed, length, sights: cruiseSights([], world.landmarks) }));
    outline = spots.map((s) => [s.x, -s.y] as [number, number]);
    if (outline.length < 2) outline.push([outline[0][0] + 1, outline[0][1] + 1]);
  } else if (layout.coords && layout.coords.length >= 2) {
    const { plan, hs, ai, limitAt, hints } = routeAi(world, layout.coords, opts, height);
    closed = plan.closed;
    length = plan.length;
    files[`${base}/ai/fast_lane.ai`] = writeFastLaneAi(ai);
    files[`${base}/data/ai_hints.ini`] = enc.encode(hints);
    // The automatic test's limits for this layout (autotest.lua reads it; 50 where unknown).
    const pct = Array.from({ length: 100 }, (_, k) => {
      const ap = ai[Math.min(ai.length - 1, Math.round(((k + 0.5) / 100) * (ai.length - 1)))];
      return Math.round((limitAt?.(ap?.distance ?? 0)) ?? 50);
    });
    const shots = landmarkShots(ai, world.landmarks ?? []);
    files[`${base}/data/autotest.ini`] = enc.encode(`[AUTOTEST]\nCLOSED=${plan.closed}\nLIMITS=${pct.join(",")}\n${shots.length ? `SHOTS=${shots.join(",")}\n` : ""}`);
    // The grid on a straight, clear of the world's roundabouts and of the streets that meet the route.
    const dummies = trackObjects(plan, opts, worldAvoid(world, plan.samples.map((smp) => smp.pos)));
    files[`${slug}/layout_${layout.id}.kn5`] = dummiesKn5(layout.id, dummies);
    // A pit lane past the grid's boxes, and the ideal line (pitLane.ts).
    Object.assign(files, pitLaneFiles(base, ai, files[`${base}/ai/fast_lane.ai`], dummies, plan.closed));
    const ground = (x: number, y: number) => height(x, y) ?? hs[0];
    // Busselton fork: the layout's hand-picked checkpoints and, point to point, its time trial.
    const challenges = layoutChallengesIni(layout.name, { plan, dummies }, (p) => proj.toLocal(p), ground, layout.challenges, opts.timeTrialSectors);
    if (challenges) files[`${base}/data/challenges.ini`] = enc.encode(challenges);
    // Busselton fork: cruise mode's sights along this layout and its speed limits (cruise.ts).
    files[`${base}/data/cruise.ini`] = enc.encode(cruiseLayoutIni(layout.name, {
      closed: plan.closed, length: ai.length > 1 ? ai[ai.length - 1].distance + ai[ai.length - 1].length : plan.length,
      sights: cruiseSights(ai, world.landmarks ?? []), limits: limitAt ? limitsByPercent(ai, limitAt) : undefined,
    }));
    files[`${base}/data/cameras_1.ini`] = enc.encode(camerasIni(placeCameras(plan, opts, ground, () => false)));
    outline = simplify(plan.samples.map((s) => s.pos), 0.5).map(([x, y]) => [x, -y] as [number, number]);
    if (closed) outline.push(outline[0]);
  } else {
    throw new Error(`Layout ${layout.id} needs a route (pins) or spawns`);
  }
  const map = trackMap(outline);
  files[`${base}/map.png`] = map.png;
  files[`${base}/data/map.ini`] = enc.encode(map.ini);
  files[`${slug}/ui/${layout.id}/ui_track.json`] = enc.encode(uiTrackJson(meta, {
    length, width: 7, pitboxes, closed, centre: proj.toLngLat([0, 0]), traffic: opts.traffic,
  }));
  files[`${slug}/ui/${layout.id}/outline.png`] = outlinePng(outline);
  files[`${slug}/ui/${layout.id}/preview.png`] = previewPng(outline, closed);
  files[`${slug}/models_${layout.id}.ini`] = enc.encode(modelsIni([`${slug}.kn5`, `layout_${layout.id}.kn5`]));
  return files;
}
