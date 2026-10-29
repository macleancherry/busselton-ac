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
import { writeFastLaneAi } from "./aiSpline";
import { camerasIni, placeCameras } from "./cameras";
import { outlinePng, previewPng, trackMap, uiTrackJson, type TrackMeta } from "./acFiles";
import { frameTransform, IDENTITY, writeKn5, type Kn5GroupNode, type Kn5Model, type Kn5Node } from "./kn5";
import { withDefaults, type BuildOptions } from "./options";
import { planRoad, type RoadPlan } from "./road";
import type { LngLat, LocalProjection } from "./geo";
import { simplify } from "./polyline";

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
export function surfaceHeight(model: Kn5Model, names = /^\d(ROAD|STREET|KERB)/): (x: number, y: number) => number | null {
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
  /** Free roam: where cars start, [lng, lat] and heading in degrees clockwise from north. */
  spawns?: { at: LngLat; heading: number }[];
}

export interface World {
  slug: string;
  proj: LocalProjection;
  model: Kn5Model;
  options: Partial<BuildOptions>;
  meta: Partial<TrackMeta>;
  /** The main layout's AI line, for free roam (AC wants one). */
  mainAi?: Uint8Array;
  /**
   * The world's road and street centrelines (local metres) and its roundabouts: a layout's route
   * is pulled onto them, since the router's line and the built street can sit metres apart.
   */
  lines?: Vec2[][];
  /** Each line's speed limit, km/h, for the layouts' AI hints. */
  speeds?: number[];
  rings?: { c: Vec2; rOut: number }[];
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

/** A layout's own files (dummies kn5, AI line, data, ui), on the world's road surface. */
export function layoutFiles(world: World, layout: LayoutSpec, trackObjects: (plan: RoadPlan, opts: BuildOptions) => Kn5GroupNode[]): Record<string, Uint8Array> {
  const opts = withDefaults({ ...world.options, name: layout.name });
  const { slug, proj } = world;
  const height = surfaceHeight(world.model);
  const files: Record<string, Uint8Array> = {};
  const meta: TrackMeta = { ...world.meta, name: layout.name };
  const base = `${slug}/${layout.id}`;
  let outline: [number, number][];
  let closed = false, length = 0;

  if (layout.coords && layout.coords.length >= 2) {
    const local = layout.coords.map((p) => proj.toLocal(p));
    // On to the world's own streets (densified first, so long straight legs follow them too).
    const dense: Vec2[] = [];
    local.forEach((p, i) => {
      if (i) {
        const q = local[i - 1], n = Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 4);
        for (let k = 1; k < n; k++) dense.push([q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n]);
      }
      dense.push(p);
    });
    const plan = planRoad(world.lines?.length ? snapToLines(dense, world.lines, world.rings) : local, opts);
    const hs = fillHeights(plan.samples.map((s) => height(s.pos[0], s.pos[1])), 0);
    plan.samples.forEach((s, i) => { s.h = hs[i]; s.bank = 0; });
    closed = plan.closed;
    length = plan.length;
    const ai = buildAiLine(plan);
    files[`${base}/ai/fast_lane.ai`] = writeFastLaneAi(ai);
    // Speed limits from the street each stretch is on (the world's), so the AI drives a town street
    // at 50 rather than at the grip limit.
    let limitAt: ((d: number) => number | undefined) | undefined;
    if (world.lines?.length && world.speeds?.length) {
      const grid = new LineGrid(world.lines, 12);
      const lim = plan.samples.map((smp) => { const n = grid.nearest(smp.pos); return n ? world.speeds![n.line] : undefined; });
      const total = ai.length ? ai[ai.length - 1].distance + ai[ai.length - 1].length : 1;
      limitAt = (d) => lim[Math.max(0, Math.min(lim.length - 1, Math.round((d / total) * (lim.length - 1))))];
    }
    files[`${base}/data/ai_hints.ini`] = enc.encode(aiHintsIni(ai, limitAt, !plan.closed));
    // The automatic test's limits for this layout (autotest.lua reads it; 50 where unknown).
    const pct = Array.from({ length: 100 }, (_, k) => {
      const ap = ai[Math.min(ai.length - 1, Math.round(((k + 0.5) / 100) * (ai.length - 1)))];
      return Math.round((limitAt?.(ap?.distance ?? 0)) ?? 50);
    });
    files[`${base}/data/autotest.ini`] = enc.encode(`[AUTOTEST]\nCLOSED=${plan.closed}\nLIMITS=${pct.join(",")}\n`);
    files[`${slug}/layout_${layout.id}.kn5`] = dummiesKn5(layout.id, trackObjects(plan, opts));
    const ground = (x: number, y: number) => height(x, y) ?? hs[0];
    files[`${base}/data/cameras_1.ini`] = enc.encode(camerasIni(placeCameras(plan, opts, ground, () => false)));
    outline = simplify(plan.samples.map((s) => s.pos), 0.5).map(([x, y]) => [x, -y] as [number, number]);
    if (closed) outline.push(outline[0]);
  } else if (layout.spawns?.length) {
    const spots = layout.spawns.map(({ at, heading }) => {
      const [x, y] = proj.toLocal(at);
      const r = (heading * Math.PI) / 180;
      const fwd: Vec2 = [Math.sin(r), Math.cos(r)];
      return { x, y, fwd, h: height(x, y) };
    });
    const dummies: Kn5GroupNode[] = [];
    spots.forEach((s, k) => {
      const h = (s.h ?? 0) + 0.5;
      const pos: [number, number, number] = [s.x, h, -s.y], fwd: [number, number, number] = [s.fwd[0], 0, -s.fwd[1]];
      dummies.push(dummy(`AC_START_${k}`, pos, fwd), dummy(`AC_PIT_${k}`, pos, fwd));
    });
    // A timing line 15 m ahead of the first spot, so sessions that want one have it.
    const s0 = spots[0], ahead: Vec2 = [s0.x + s0.fwd[0] * 15, s0.y + s0.fwd[1] * 15], left: Vec2 = [-s0.fwd[1], s0.fwd[0]];
    const h0 = (height(ahead[0], ahead[1]) ?? s0.h ?? 0) + 1;
    const f3: [number, number, number] = [s0.fwd[0], 0, -s0.fwd[1]];
    dummies.push(
      dummy("AC_HOTLAP_START_0", [s0.x, (s0.h ?? 0) + 0.5, -s0.y], f3),
      dummy("AC_TIME_0_L", [ahead[0] + left[0] * 5, h0, -(ahead[1] + left[1] * 5)], f3),
      dummy("AC_TIME_0_R", [ahead[0] - left[0] * 5, h0, -(ahead[1] - left[1] * 5)], f3),
    );
    files[`${slug}/layout_${layout.id}.kn5`] = dummiesKn5(layout.id, dummies);
    if (world.mainAi) files[`${base}/ai/fast_lane.ai`] = world.mainAi;
    outline = spots.map((s) => [s.x, -s.y] as [number, number]);
    if (outline.length < 2) outline.push([outline[0][0] + 1, outline[0][1] + 1]);
  } else {
    throw new Error(`Layout ${layout.id} needs a route (pins) or spawns`);
  }
  const map = trackMap(outline);
  files[`${base}/map.png`] = map.png;
  files[`${base}/data/map.ini`] = enc.encode(map.ini);
  files[`${slug}/ui/${layout.id}/ui_track.json`] = enc.encode(uiTrackJson(meta, {
    length, width: 7, pitboxes: layout.spawns?.length ?? opts.pitCount, closed, centre: proj.toLngLat([0, 0]),
  }));
  files[`${slug}/ui/${layout.id}/outline.png`] = outlinePng(outline);
  files[`${slug}/ui/${layout.id}/preview.png`] = previewPng(outline, closed);
  files[`${slug}/models_${layout.id}.ini`] = enc.encode(modelsIni([`${slug}.kn5`, `layout_${layout.id}.kn5`]));
  return files;
}
