// Street furniture (docs/specs/furniture.md): street name signs, shop and landmark pylons, bus
// stops, servo canopies, signs and signals seen by Mapillary, START/FINISH and kangaroo signs.
//
// Placers return pieces (pieces.ts) and register sign art as they go; once the caller has drawn
// every sign into one atlas, buildPieces turns all the pieces into meshes. Heights follow the one
// ground rule (docs/specs/scenery.md): each piece stands on `ground` at its own spot, SINK deep,
// and posts never stand on a drivable mesh (poleSpot.ts).
import { streetKey, type ArtAtlas, type ArtCell, type ArtList } from "./art";
import { type HeightFn } from "./elevation";
import { type Vec2 } from "./geo";
import { type Kn5MeshNode } from "./kn5";
import { type MeshBuilder } from "./mesh";
import { type BuildOptions } from "./options";
import { type PathFrame } from "./polyline";
import { inRoundabout, type Nearest, type RoadPlan, type RoadSample, type SegmentIndex } from "./road";
import { pad as num3 } from "./roadMesh";
import { ChunkedMesh, box as boxMesh } from "./scenery";
import { SINK } from "./sceneGround";
import { type StreetPlan } from "./sideStreets";
import { clearSpot, type OnRoad } from "./poleSpot";
import type { BoxPiece, Piece } from "./pieces";

export type { Piece } from "./pieces";

type Side = 1 | -1;

// Small geometry helpers.

/** The point `t` metres to the left of a sample (negative: to the right). */
export function off(s: Pick<PathFrame, "pos" | "left">, t: number): Vec2 {
  return [s.pos[0] + s.left[0] * t, s.pos[1] + s.left[1] * t];
}

const add = (p: Vec2, d: Vec2, k: number): Vec2 => [p[0] + d[0] * k, p[1] + d[1] * k];
const neg = (v: Vec2): Vec2 => [-v[0], -v[1]];

/** Traffic keeps left: a sign on the left faces traffic coming forward (normal back along the route). */
const facing = (tan: Vec2, side: Side): Vec2 => (side === 1 ? neg(tan) : [tan[0], tan[1]]);

/** The sample nearest a distance along the route. */
function sampleAt(plan: RoadPlan, want: number): number {
  const ss = plan.samples;
  const d = plan.closed && plan.length > 0 ? ((want % plan.length) + plan.length) % plan.length : want;
  let a = 0, b = ss.length - 1;
  while (b - a > 1) {
    const m = Math.floor((a + b) / 2);
    if (ss[m].s <= d) a = m; else b = m;
  }
  return Math.abs(ss[b].s - d) < Math.abs(ss[a].s - d) ? b : a;
}

/** The point on the centreline a nearest-point result stands for, with its sample's directions. */
function frameAt(plan: RoadPlan, n: Nearest): { pos: Vec2; tan: Vec2; left: Vec2; s: number } {
  const ss = plan.samples;
  const a = ss[n.seg], b = ss[(n.seg + 1) % ss.length];
  const pos: Vec2 = [a.pos[0] + (b.pos[0] - a.pos[0]) * n.frac, a.pos[1] + (b.pos[1] - a.pos[1]) * n.frac];
  const s = a.s + Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]) * n.frac;
  return { pos, tan: a.tan, left: a.left, s };
}

const POST = 0.065;
const POLE_GAP = 0.15;

/** Where a post may stand off the road (null: nowhere near), moving out from the route first. */
function postSpot(at: Vec2, width: number, away: Vec2, onRoad?: OnRoad): Vec2 | null {
  return clearSpot(at, onRoad, { radius: width / 2 + POLE_GAP, away });
}

const post = (at: Vec2, along: Vec2, size: number, g: number, top: number, material = "steel"): BoxPiece =>
  ({ kind: "box", at, along, length: size, depth: size, z0: g - SINK, z1: g + top, material });

// Street name signs.

/** One corner sign per named junction, naming the side street (and the route above it). */
export function streetSigns(streets: StreetPlan, plan: RoadPlan, opts: BuildOptions, art: ArtList, ground: HeightFn, onRoad?: OnRoad): Piece[] {
  const out = [] as Piece[];
  const verge = opts.vergeWidth;
  for (const j of streets.junctions) {
    if (j.name === undefined || j.name === "") continue;
    // Just before the mouth, for traffic on that side (forward on the left, coming back on the right).
    const back = j.width / 2 + 2.5;
    const i = sampleAt(plan, j.s - j.side * back);
    const smp = plan.samples[i];
    const t = j.side * (smp.width / 2 + verge * 0.6);
    const want = off(smp, t);
    if (inRoundabout(plan, want[0], want[1], 6)) continue;
    const at = postSpot(want, POST, [smp.left[0] * j.side, smp.left[1] * j.side], onRoad);
    if (!at) continue;
    const g = ground(at[0], at[1]);
    out.push(post(at, smp.tan, POST, g, 3.0));
    out.push({ kind: "blade", at, along: j.dir, z: g + 2.62, height: 0.2, art: art.add({ key: streetKey(j.name), kind: "street", text: j.name }) });
    const route = streets.routeNames[j.seg];
    if (route && route !== j.name) {
      out.push({ kind: "blade", at, along: smp.tan, z: g + 2.86, height: 0.2, art: art.add({ key: streetKey(route), kind: "street", text: route }) });
    }
  }
  return out;
}

// Landmarks, bus stops, servo canopies.

export interface Poi { at: Vec2; cls: string; subclass: string; name?: string }

/** Panel colours by trade: brand-neutral, readable with white lettering. */
const POI_COLOUR: Record<string, string> = {
  fast_food: "#b8432f", restaurant: "#8c2f39", cafe: "#6f4a32", ice_cream: "#c2577a", bakery: "#a5672a",
  grocery: "#2f7a43", shop: "#3a5d8f", clothing_store: "#6b4c8a", pharmacy: "#1f8a70", bank: "#24496b",
  beer: "#7a5a1e", alcohol_shop: "#5c2a4a", lodging: "#2c5f7c", car: "#44505c", hospital: "#b02a2a",
  school: "#2a6a3a", college: "#2a5a6a", place_of_worship: "#5a4a7a", library: "#3d5a80", police: "#1d3d7a",
  post: "#a33a2a", fire_station: "#a8281e", cinema: "#3a2a5a", hairdresser: "#8a3a6a", doctors: "#2a7a6a",
  dentist: "#2a6a8a", veterinary: "#4a7a2a", sports_centre: "#2a5aa0", fuel: "#a4421c",
};
const POI_DEFAULT = "#36414d";
const ATTRACTION = new Set(["attraction", "viewpoint", "museum", "artwork", "monument", "memorial", "zoo", "theme_park", "aquarium"]);
const MAX_NAMED = 80;
const SPACING = 12;

const isAttraction = (p: Poi) => p.cls === "attraction" || ATTRACTION.has(p.subclass);
const isFuel = (p: Poi) => p.cls === "fuel" && p.subclass === "fuel";

function signText(p: Poi): string | undefined {
  if (p.name) return p.name;
  if (p.cls === "fuel") return "FUEL";
  if (p.subclass === "viewpoint") return "Lookout";
  return void 0;
}

/**
 * Named pylons for shops and landmarks, bus stop posts and shelters, servo canopies.
 * `clearance(x, y)`: distance to the nearest street or building edge, negative inside a building.
 */
export function landmarks(
  pois: Poi[], plan: RoadPlan, index: SegmentIndex, opts: BuildOptions, art: ArtList,
  clearance: (x: number, y: number) => number, ground: HeightFn,
): Piece[] {
  const out = [] as Piece[];
  const verge = opts.vergeWidth;
  const used: Record<string, number[]> = { "1": [], "-1": [] };
  const free = (side: Side, s: number) => used[side].every((u) => Math.abs(u - s) >= SPACING);
  let named = 0;
  art.add({ kind: "back", key: "back" });

  // Matched and sorted by place along the route, so the same POIs give the same signs in any order.
  const matched = pois
    .map((p) => ({ p, n: index.nearest(p.at[0], p.at[1], 60) }))
    .filter((m): m is { p: Poi; n: Nearest } => !!m.n)
    .map((m) => ({ ...m, f: frameAt(plan, m.n) }))
    .sort((a, b) => a.f.s - b.f.s || a.n.t - b.n.t || a.p.at[0] - b.p.at[0] || a.p.at[1] - b.p.at[1]
      || (a.p.name ?? "").localeCompare(b.p.name ?? "") || a.p.cls.localeCompare(b.p.cls));

  for (const { p, n, f } of matched) {
    const near = plan.samples[n.frac < 0.5 ? n.seg : (n.seg + 1) % plan.samples.length];
    if (inRoundabout(plan, near.pos[0], near.pos[1], 10)) continue;
    const side: Side = n.t >= 0 ? 1 : -1;
    const half = 0.5 * index.at(n).width;
    const away: Vec2 = [f.left[0] * side, f.left[1] * side];
    const normal = facing(f.tan, side);
    const at = (t: number): Vec2 => add(f.pos, f.left, t);

    if (p.cls === "bus") {
      if (n.dist >= 25 || !free(side, f.s)) continue;
      used[side].push(f.s);
      const pa = at(side * (half + verge * 0.7));
      const g = ground(pa[0], pa[1]);
      out.push(post(pa, f.tan, POST, g, 2.7));
      out.push({ kind: "face", at: add(pa, normal, 0.05), normal, z0: g + 2.0, height: 0.6, art: art.add({ key: "bus", kind: "bus" }) });
      const sc = at(side * (half + verge + 2.3));
      if (clearance(sc[0], sc[1]) > 2.5) out.push(...shelter(sc, f.tan, away, ground));
      continue;
    }

    const fuel = isFuel(p);
    if (fuel && n.dist > half + verge + 6) out.push(...canopy(p.at, f.tan, ground));

    const text = signText(p);
    if (!text || !(isAttraction(p) || p.cls in POI_COLOUR)) continue;
    if (named >= MAX_NAMED || !free(side, f.s)) continue;
    const line = half + verge + 2.5;
    let lat = Math.min(Math.abs(n.t), line);
    if (lat < half + verge) lat = line;
    const pc = at(side * lat);
    const ends = [pc, add(pc, f.left, 1.3), add(pc, f.left, -1.3)];
    if (ends.some(([x, y]) => clearance(x, y) < 1)) continue;
    used[side].push(f.s);
    named++;
    const key = isAttraction(p)
      ? art.add({ key: `tourist:${text}`, kind: "tourist", text })
      : art.add({ key: `poi:${p.cls}:${text}`, kind: "poi", text, colour: POI_COLOUR[p.cls] ?? POI_DEFAULT });
    const legH = fuel ? 5.2 : 3.2, panel = fuel ? 1.6 : 0.9;
    const behind = add(pc, normal, -0.1);
    let low = Number.POSITIVE_INFINITY;
    for (const k of [-0.75, 0.75]) {
      const la = add(behind, f.left, k);
      const g = ground(la[0], la[1]);
      low = Math.min(low, g);
      out.push(post(la, f.tan, 0.12, g, legH));
    }
    out.push({ kind: "face", at: pc, normal, z0: low + legH - panel, height: panel, art: key, twoSided: true });
  }
  return out;
}

/** A bus shelter centred on `c`, its back wall further out along `away`. */
function shelter(c: Vec2, tan: Vec2, away: Vec2, ground: HeightFn): Piece[] {
  const out = [] as Piece[];
  const g = ground(c[0], c[1]);
  out.push({ kind: "box", at: c, along: tan, length: 3.6, depth: 1.7, z0: g + 2.35, z1: g + 2.45, material: "steel" });
  const wall = add(c, away, 0.75);
  const gw = ground(wall[0], wall[1]);
  out.push({ kind: "box", at: wall, along: tan, length: 3.6, depth: 0.06, z0: gw - SINK, z1: gw + 2.35, material: "glass" });
  for (const k of [-1.8, 1.8]) {
    const pa = add(wall, tan, k);
    out.push(post(pa, tan, 0.08, ground(pa[0], pa[1]), 2.35));
  }
  const bench = add(c, away, 0.4);
  const gb = ground(bench[0], bench[1]);
  out.push({ kind: "box", at: bench, along: tan, length: 2.2, depth: 0.4, z0: gb + 0.4, z1: gb + 0.48, material: "timber" });
  for (const k of [-0.9, 0.9]) {
    const la = add(bench, tan, k);
    out.push(post(la, tan, 0.06, ground(la[0], la[1]), 0.4));
  }
  return out;
}

/** A servo canopy square to the road on four columns, each on its own ground. */
function canopy(c: Vec2, tan: Vec2, ground: HeightFn): Piece[] {
  const left: Vec2 = [-tan[1], tan[0]];
  const feet: { at: Vec2; g: number }[] = [];
  for (const a of [-4, 4]) for (const b of [-2.5, 2.5]) {
    const at = add(add(c, tan, a), left, b);
    feet.push({ at, g: ground(at[0], at[1]) });
  }
  const low = Math.min(...feet.map((f) => f.g));
  return [
    ...feet.map((f): Piece => ({ kind: "box", at: f.at, along: tan, length: 0.35, depth: 0.35, z0: f.g - SINK, z1: low + 5.0, material: "steel" })),
    { kind: "box", at: c, along: tan, length: 13, depth: 8, z0: low + 5.0, z1: low + 5.8, material: "canopy" },
  ];
}

// Mapillary objects.

export interface Sighting { at: Vec2; value: string }

/** Which group a detection merges in, and how close its repeats are. */
function category(value: string): { key: string; radius: number; } {
  if (value.startsWith("object--support--utility-pole")) return { key: "pole", radius: 5 };
  if (value.startsWith("object--street-light")) return { key: "light", radius: 5 };
  if (value.startsWith("object--traffic-light")) return { key: "signal", radius: 4 };
  if (value.startsWith("marking--")) return { key: value, radius: 6 };
  return { key: value.replace(/--g[0-9]+$/, ""), radius: 6 };
}

/** One detection per object: repeats seen from several sides become one at their mean position. */
export function mergeSightings<T extends Sighting>(seen: T[]): T[] {
  const groups: { key: string; radius: number; members: T[] }[] = [];
  for (const f of seen) {
    const c = category(f.value);
    const g = groups.find((gr) => gr.key === c.key
      && gr.members.some((m) => Math.hypot(m.at[0] - f.at[0], m.at[1] - f.at[1]) < c.radius));
    if (g) g.members.push(f);
    else groups.push({ ...c, members: [f] });
  }
  return groups.map((g) => {
    const n = g.members.length;
    const x = g.members.reduce((a, m) => a + m.at[0], 0) / n;
    const y = g.members.reduce((a, m) => a + m.at[1], 0) / n;
    return { ...g.members[0], at: [x, y] as Vec2 };
  });
}

/** The art for a Mapillary sign value (added to the list), or null when it isn't one we draw. */
export function signArt(value: string, art: ArtList): string | null {
  const limit = value.match(/maximum-speed-limit-([0-9]+)/)?.[1];
  if (limit) return art.add({ kind: "speed", key: `speed:${limit}`, text: limit });
  if (value.startsWith("regulatory--stop")) return art.add({ key: "stop", kind: "stop" });
  if (value.startsWith("regulatory--yield")) return art.add({ key: "giveway", kind: "giveway" });
  if (value.startsWith("regulatory--no-entry")) return art.add({ key: "noentry", kind: "noentry" });
  if (value.startsWith("regulatory--keep-left")) return art.add({ key: "keepleft", kind: "keepleft" });
  for (const dir of ["left", "right"]) {
    if (value.startsWith(`complementary--chevron-${dir}`)) return art.add({ key: `chevron:${dir}`, kind: "chevron", text: dir });
  }
  const warn = /^warning--(.+?)(?:--|$)/.exec(value);
  if (warn) return art.add({ kind: "warning", key: `warning:${warn[1]}`, text: warn[1] });
  return null;
}

/** Signs and signals seen by Mapillary, beside the route. Poles and lights are utilities'. */
export function seenFeatures(
  seen: Sighting[], plan: RoadPlan, index: SegmentIndex, opts: BuildOptions, art: ArtList, ground: HeightFn, onRoad?: OnRoad,
): Piece[] {
  const out = [] as Piece[];
  const verge = opts.vergeWidth;
  for (const f of mergeSightings(seen)) {
    const v = f.value;
    if (v.startsWith("marking--") || v.startsWith("object--support--utility-pole") || v.startsWith("object--street-light")) continue;
    const n = index.nearest(f.at[0], f.at[1], opts.corridor - 2.0);
    if (!n || inRoundabout(plan, f.at[0], f.at[1], 2)) continue;
    const fr = frameAt(plan, n);
    const side: Side = n.t >= 0 ? 1 : -1;
    const half = 0.5 * index.at(n).width;
    const normal = facing(fr.tan, side);
    const away: Vec2 = [fr.left[0] * side, fr.left[1] * side];
    // On the road or its edge: straight across to the verge.
    let at = f.at;
    if (Math.abs(n.t) < half + verge * 0.6) at = add(f.at, fr.left, side * (half + verge * 0.7) - n.t);

    if (v.startsWith("object--traffic-light")) {
      const spot = postSpot(at, 0.14, away, onRoad);
      if (spot === null) continue;
      const g = ground(spot[0], spot[1]);
      out.push(post(spot, fr.tan, 0.14, g, 3.5));
      out.push({ kind: "box", at: add(spot, normal, 0.2), along: fr.left, length: 0.36, depth: 0.3, z0: g + 2.4, z1: g + 3.4, material: "signal" });
      continue;
    }
    if (n.dist > 40) continue;
    const key = signArt(v, art);
    if (!key) continue;
    const spot = postSpot(at, POST, away, onRoad);
    if (spot === null) continue;
    const size = key.startsWith("speed:") || key.startsWith("chevron:") ? 0.6 : 0.75;
    const g = ground(spot[0], spot[1]);
    out.push(post(spot, fr.tan, POST, g, 2.2 + size));
    out.push({ kind: "face", at: add(spot, normal, 0.05), normal, z0: g + 2.1, height: size, art: key });
  }
  return out;
}

// START and FINISH.

/** Two-sided START and FINISH signs each side of the road at a point-to-point route's timing gates. */
export function gateSigns(plan: RoadPlan, opts: BuildOptions, art: ArtList, ground: HeightFn): Piece[] {
  if (plan.timed === undefined) return [];
  const out = [] as Piece[];
  const gates: [number, string][] = [[plan.timed.start, "START"], [plan.timed.finish, "FINISH"]];
  for (const [i, text] of gates) {
    const g8 = plan.samples[i];
    if (!g8 || inRoundabout(plan, g8.pos[0], g8.pos[1], 8)) continue;
    const key = art.add({ kind: "gate", key: `gate-${text}`, text });
    const normal = neg(g8.tan);
    for (const side of [1, -1] as Side[]) {
      const c = off(g8, side * (g8.width / 2 + opts.vergeWidth + 1.8));
      let low = Number.POSITIVE_INFINITY;
      for (const k of [-0.75, 0.75]) {
        const pa = add(c, g8.left, k);
        const g = ground(pa[0], pa[1]);
        low = Math.min(low, g);
        out.push(post(pa, g8.tan, 0.08, g, 2.9));
      }
      out.push({ kind: "face", at: add(c, normal, 0.05), normal, z0: low + 2.2, height: 0.62, art: key, twoSided: true });
    }
  }
  return out;
}

// Kangaroo signs.

const NUDGES = [0, 5, -5, 10, -10, 20, -20];

/** Kangaroo warning signs on country stretches: 300 m in from each end of a rural run, then every 4 km. */
export function kangarooSigns(
  plan: RoadPlan, opts: BuildOptions, art: ArtList,
  rural: (i: number) => boolean, blocked: (i: number, side: Side) => boolean, ground: HeightFn,
): Piece[] {
  const ss = plan.samples;
  const out = [] as Piece[];
  const runs: [number, number][] = [];
  for (let i = 0; i < ss.length; i++) {
    if (!rural(i)) continue;
    let k = i;
    while (k + 1 < ss.length && rural(k + 1)) k++;
    runs.push([i, k]);
    i = k;
  }
  const place = (s: number, side: Side, lo: number, hi: number) => {
    for (const d of NUDGES) {
      const i = sampleAt(plan, s + d);
      if (i < lo || i > hi) continue;
      const smp = ss[i];
      if (blocked(i, side) || inRoundabout(plan, smp.pos[0], smp.pos[1], 15)) continue;
      out.push(...kangaroo(smp, side, opts, art, ground));
      return;
    }
  };
  for (const [a, b] of runs) {
    const s0 = ss[a].s, s1 = ss[b].s;
    if (s1 - s0 < 1000) continue;
    for (let s = s0 + 300; s <= s1 - 150; s += 4000) place(s, 1, a, b);
    for (let s = s1 - 300; s >= s0 + 150; s -= 4000) place(s, -1, a, b);
  }
  return out;
}

function kangaroo(s: RoadSample, side: Side, opts: BuildOptions, art: ArtList, ground: HeightFn): Piece[] {
  const at = off(s, side * (s.width / 2 + opts.vergeWidth * 0.7));
  const g = ground(at[0], at[1]);
  const normal = facing(s.tan, side);
  return [
    post(at, s.tan, POST, g, 2.9),
    { kind: "face", at: add(at, normal, 0.05), normal, z0: g + 2.0, height: 0.9, art: art.add({ key: "warning:kangaroo", kind: "warning", text: "kangaroo" }) },
  ];
}

// Meshes.

/** A printed quad at `c` facing `n`, `w` wide, u running left to right as seen from the front. */
function quad(mb: MeshBuilder, c: Vec2, n: Vec2, z0: number, w: number, h: number, u0: number, u1: number, v0: number, v1: number): void {
  const r: Vec2 = [-n[1], n[0]]; // the viewer's right, looking at the face
  const a = add(c, r, -w / 2), b = add(c, r, w / 2);
  const v = mb.vertexCount;
  mb.vertex([a[0], a[1], z0], u0, v1);
  mb.vertex([b[0], b[1], z0], u1, v1);
  mb.vertex([b[0], b[1], z0 + h], u1, v0);
  mb.vertex([a[0], a[1], z0 + h], u0, v0);
  for (let k = 0; k < 4; k++) mb.normals!.push(n[0], n[1], 0);
  mb.quad(v, v + 1, v + 2, v + 3);
}

const unit = (d: Vec2): Vec2 => {
  const len = Math.hypot(d[0], d[1]) || 1;
  return [d[0] / len, d[1] / len];
};

/** Every piece as meshes: boxes by material, printed faces and blades on the sign art. */
export function buildPieces(list: Piece[], atlas: ArtAtlas | null): Kn5MeshNode[] {
  const byMaterial = new Map<string, ChunkedMesh>();
  const signs = new ChunkedMesh(8);
  const cell = (key: string): ArtCell | undefined => atlas?.cells[key];
  for (const piece of list) {
    if (piece.kind === "blade") {
      const c = cell(piece.art);
      if (c === undefined) continue;
      const a = unit(piece.along), w = piece.height * c.aspect;
      const mb = signs.next(8);
      // Two faces back to back, each reading left to right from its own side.
      for (const n of [[-a[1], a[0]], [a[1], -a[0]]] as Vec2[]) {
        quad(mb, add(piece.at, n, 0.01), n, piece.z - piece.height / 2, w, piece.height, c.u0, c.u1, c.v0, c.v1);
      }
    } else if (piece.kind === "face") {
      const c = cell(piece.art);
      if (c === undefined) continue;
      const n = unit(piece.normal), w = piece.height * c.aspect;
      const mb = signs.next(8);
      quad(mb, piece.at, n, piece.z0, w, piece.height, c.u0, c.u1, c.v0, c.v1);
      const behind = add(piece.at, n, -0.01);
      // The back: the same art again, or the plain grey back mirrored behind the front's outline.
      const g = piece.twoSided ? c : cell("back");
      if (g) quad(mb, behind, neg(n), piece.z0, w, piece.height, piece.twoSided ? g.u0 : g.u1, piece.twoSided ? g.u1 : g.u0, g.v0, g.v1);
    } else {
      let cm = byMaterial.get(piece.material);
      if (!cm) byMaterial.set(piece.material, (cm = new ChunkedMesh(20)));
      boxMesh(cm.next(), piece.at, unit(piece.along), piece.length, piece.depth, piece.z0, piece.z1);
    }
  }
  const meshes: Kn5MeshNode[] = [];
  for (const [material, cm] of [...byMaterial].sort((x, y) => x[0].localeCompare(y[0]))) {
    cm.all().forEach((mb, k) => meshes.push(mb.toKn5(`FURNITURE_${material.toUpperCase()}_${num3(k)}`, material)));
  }
  signs.all().forEach((mb, k) => meshes.push(mb.toKn5(`FURNITURE_SIGNART_${num3(k)}`, "signart")));
  return meshes;
}
