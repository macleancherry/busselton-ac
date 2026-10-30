// Camera planning for scripts/blender/render_track.ts: which views to render and where each camera
// stands. Pure (no files, no Blender) so it can be tested. Local metres throughout: x east, y north,
// z up, from the route's build.origin (what Blender shows after importing kn5ToGlb's glTF).

export type XY = [number, number];
export type XYZ = [number, number, number];
export type LngLat = [number, number];

export interface View {
  name: string;
  kind: "street" | "aerial" | "custom";
  eye: XYZ;
  target: XYZ;
  /** Focal length in mm on a 36 mm sensor. */
  lens: number;
}

export type ViewSpec =
  | { kind: "landmarks" }
  | { kind: "aerial"; at?: LngLat; height?: number; name?: string }
  | { kind: "custom"; from: LngLat; to: LngLat; height: number; name?: string };

/**
 * One view from the command line:
 *   landmarks                              every landmark, from the street in front of it
 *   aerial | aerial:lng,lat[@height]       from the south and above a point (default 120 m up)
 *   [name=]lng,lat->lng,lat[@height]       eye -> target, eye `height` m above the ground (default 1.6)
 */
export function parseView(s: string): ViewSpec {
  const t = s.trim();
  if (t === "landmarks") return { kind: "landmarks" };
  const num = (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`not a number in view "${s}": ${v}`);
    return n;
  };
  const point = (v: string): LngLat => {
    const p = v.split(",").map(num);
    if (p.length !== 2) throw new Error(`expected lng,lat in view "${s}"`);
    return [p[0], p[1]];
  };
  const named = /^([A-Za-z0-9_-]+)=(.*)$/.exec(t);
  const name = named?.[1];
  const body = named ? named[2] : t;
  const [main, h] = body.split("@");
  if (main === "aerial" || main.startsWith("aerial:")) {
    return { kind: "aerial", name, at: main === "aerial" ? undefined : point(main.slice(7)), height: h ? num(h) : undefined };
  }
  const parts = main.split("->");
  if (parts.length !== 2) throw new Error(`unknown view "${s}" (landmarks, aerial[:lng,lat][@h] or lng,lat->lng,lat[@h])`);
  return { kind: "custom", name, from: point(parts[0]), to: point(parts[1]), height: h ? num(h) : 1.6 };
}

/** Unit direction (x east, y north) of a compass bearing in degrees. */
export function bearingDir(deg: number): XY {
  const r = (deg * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

/** Focal length (36 mm sensor) that fits `width` metres across at `distance`, with a margin. */
export function lensFor(width: number, distance: number, min = 14, max = 50): number {
  const half = Math.atan((width * 1.15) / 2 / Math.max(distance, 1));
  return Math.min(max, Math.max(min, 18 / Math.tan(half)));
}

/**
 * Where to stand to see a landmark from the street in front of it: the best road point in a cone
 * of ±40° about the way it faces, close and straight ahead preferred. `onRoad(x, y)` is the road
 * surface height there or null; `line` is the drive's centreline (local x, y, z), which counts as
 * road too and is slightly preferred. Returns the road point (z = road height) or null.
 */
export function streetSpot(centre: XY, facing: XY, reach: number, onRoad: (x: number, y: number) => number | null, line: XYZ[] = []): { at: XYZ; distance: number } | null {
  const dmin = Math.max(6, reach * 0.4), dmax = dmin + 90;
  let best: { at: XYZ; distance: number; score: number } | null = null;
  const consider = (at: XYZ, d: number, angle: number, bonus: number) => {
    const score = d + 0.6 * Math.abs(angle) - bonus;
    if (!best || score < best.score) best = { at, distance: d, score };
  };
  for (let a = -40; a <= 40; a += 8) {
    const r = (a * Math.PI) / 180;
    const dx = facing[0] * Math.cos(r) + facing[1] * Math.sin(r);
    const dy = -facing[0] * Math.sin(r) + facing[1] * Math.cos(r);
    for (let d = dmin; d <= dmax; d += 1.5) {
      const x = centre[0] + dx * d, y = centre[1] + dy * d;
      const h = onRoad(x, y);
      if (h === null) continue;
      // A couple of metres further in, off the road's edge, if the road's still there.
      const x2 = x + dx * 2.5, y2 = y + dy * 2.5, h2 = onRoad(x2, y2);
      consider(h2 !== null ? [x2, y2, h2] : [x, y, h], d, a, 0);
      break;
    }
  }
  for (const p of line) {
    const vx = p[0] - centre[0], vy = p[1] - centre[1], d = Math.hypot(vx, vy);
    if (d < dmin || d > dmax) continue;
    const cos = (vx * facing[0] + vy * facing[1]) / d;
    const angle = (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
    if (angle <= 40) consider(p, d, angle, 3);
  }
  if (!best) return null;
  const b = best as { at: XYZ; distance: number };
  return { at: b.at, distance: b.distance };
}

export interface Cluster { centre: XY; radius: number; views: View[] }

/**
 * Views grouped so each group needs one export of the track around it: street views whose targets
 * lie within `join` metres of the group's first, each aerial on its own. `radius` covers every eye
 * and target plus `ahead` metres of what's beyond them (more for aerials).
 */
export function clusterViews(views: View[], join = 120, ahead = 150, aheadAerial = 260): Cluster[] {
  const groups: { first: XY; views: View[]; aerial: boolean }[] = [];
  for (const v of views) {
    const aerial = v.kind === "aerial" || v.eye[2] - v.target[2] > 20;
    const key: XY = [v.target[0], v.target[1]];
    const g = aerial ? undefined : groups.find((g) => !g.aerial && Math.hypot(g.first[0] - key[0], g.first[1] - key[1]) <= join);
    if (g) g.views.push(v);
    else groups.push({ first: key, views: [v], aerial });
  }
  return groups.map((g) => {
    const pts = g.views.flatMap((v) => [v.eye, v.target]);
    const centre: XY = g.aerial
      ? [g.views[0].target[0], g.views[0].target[1]]
      : [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const spread = Math.max(...pts.map((p) => Math.hypot(p[0] - centre[0], p[1] - centre[1])));
    return { centre, radius: Math.ceil(spread + (g.aerial ? aheadAerial : ahead)), views: g.views };
  });
}

/** A file-safe view name. */
export function slugName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "view";
}
