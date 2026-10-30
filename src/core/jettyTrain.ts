// Busselton fork: the Busselton Jetty train, as cars that can move.
//
// The red train (the "Rio Tinto Solar Express", docs/jetty.md section 2): a loco styled like a
// cartoon steam engine and four open carriages with roofs carrying solar panels. Low poly, made
// here. Each car is a node of its own (JETTY_TRAIN_0 the loco, then 1..4) holding its meshes in the
// car's own frame, so CSP can move it: only nodes move, and a track kn5's meshes can't be moved
// unless they sit in a node of their own (CSP wiki, "Tracks - Animated objects"; lib_scene.lua's
// notes on setPosition). The build stands the train at the shore platform; the track script
// (lua/jetty_train.lua) runs it out along the line and back on the timetable. Without CSP, or with
// the script off, it just stands there.
//
// A car's frame (AC axes): +Z forward (the way the loco faces), +Y up, origin on the rail top at
// the car's middle. That's the frame CSP's setOrientation(look, up) sets: look is the node's Z row.

import { frameTransform, type Kn5GroupNode } from "./kn5";
import { MeshBuilder, toAc, type Vec3 } from "./mesh";
import { box } from "./scenery";

type Vec2 = [number, number];

/** A car: its length (buffer to buffer, metres). The loco first. */
export const TRAIN_CARS = [3.5, 6.5, 6.5, 6.5, 6.5];
/** Gap between cars, metres. */
export const TRAIN_GAP = 0.6;
/** Bogie centres sit this far in from each end of a car, metres. */
const BOGIE_INSET = 1.0;

/** A line with the distance along it at each point. */
export interface TrainPath {
  /** Points, local metres (x east, y north, z up: the rail top). */
  pts: Vec3[];
  /** Distance along the line at each point, metres. */
  s: number[];
}

export function trainPath(pts: Vec3[]): TrainPath {
  const s = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    s.push(s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  return { pts, s };
}

export function pathLength(p: TrainPath): number {
  return p.s[p.s.length - 1] ?? 0;
}

/** The point `s` metres along the line, clamped to its ends (the same sums as the Lua script's pointAt). */
export function pointAt(p: TrainPath, s: number): Vec3 {
  const n = p.pts.length;
  if (s <= 0 || n === 1) return p.pts[0];
  if (s >= p.s[n - 1]) return p.pts[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.s[mid] <= s) lo = mid; else hi = mid;
  }
  const t = (s - p.s[lo]) / Math.max(1e-6, p.s[hi] - p.s[lo]);
  const a = p.pts[lo], b = p.pts[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Each car: distance from the loco's nose back to its middle, and half the distance between its bogies. */
export function carOffsets(cars = TRAIN_CARS, gap = TRAIN_GAP): { mid: number; half: number; length: number }[] {
  let back = 0;
  return cars.map((length) => {
    const o = { mid: back + length / 2, half: Math.max(0.5, length / 2 - BOGIE_INSET), length };
    back += length + gap;
    return o;
  });
}

/** The whole train, nose to tail, metres. */
export function trainLength(cars = TRAIN_CARS, gap = TRAIN_GAP): number {
  return cars.reduce((a, l) => a + l, 0) + gap * (cars.length - 1);
}

/** Where a car stands with the loco's nose at `nose`: its middle on the line, heading from bogie to bogie. */
export function carPose(p: TrainPath, nose: number, car: { mid: number; half: number }): { at: Vec3; forward: Vec3 } {
  const mid = nose - car.mid;
  const f = pointAt(p, mid + car.half), b = pointAt(p, mid - car.half);
  const d: Vec3 = [f[0] - b[0], f[1] - b[1], f[2] - b[2]];
  const l = Math.hypot(...d) || 1;
  return { at: pointAt(p, mid), forward: [d[0] / l, d[1] / l, d[2] / l] };
}

/**
 * Drops points the line runs straight through (within `tol` metres), so the script carries a few
 * hundred points for 1.8 km instead of one per metre. The ends always stay.
 */
export function simplify(pts: Vec3[], tol = 0.03): Vec3[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const a = pts[i], b = pts[j];
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-12;
    let worst = -1, wd = tol;
    for (let k = i + 1; k < j; k++) {
      const p = pts[k];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / L2));
      const d = Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
      if (d > wd) [wd, worst] = [d, k];
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([i, worst], [worst, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

export interface JettyTrain {
  /** The cars as nodes, standing at the shore platform. */
  nodes: Kn5GroupNode[];
  /** The line the train runs on (local metres, rail top), from behind the parked train's tail to the far end. */
  path: TrainPath;
  /** The loco's nose parked, and at the far end, metres along `path`. */
  park: number;
  end: number;
}

/** Car node names, loco first. */
export const carNode = (k: number) => `JETTY_TRAIN_${k}`;

/**
 * The train on `line` (local metres, rail top, shore end first), parked with the loco's nose at
 * `park` metres along it, running out to `end`. Both are clamped so the parked train fits behind
 * the nose and the run stays on the line.
 */
export function buildJettyTrain(line: Vec3[], park: number, end: number): JettyTrain | null {
  if (line.length < 2) return null;
  const full = trainPath(line);
  const total = pathLength(full), len = trainLength();
  if (total < len + 2) return null;
  park = Math.max(len + 1, Math.min(total - 1, park));
  end = Math.max(park, Math.min(total - 1, end));
  // The script only needs the line from a little behind the parked tail.
  const from = Math.max(0, park - len - 5);
  const next = full.s.findIndex((v) => v > from);
  const path = trainPath(simplify([pointAt(full, from), ...line.slice(next)]));
  const shift = from;
  const nodes = carOffsets().map((car, k) => {
    const pose = carPose(path, park - shift, car);
    const meshes = k === 0 ? loco(car.length) : carriage(car.length);
    return {
      kind: "node" as const,
      name: carNode(k),
      transform: frameTransform(toAc(...pose.at), toAc(...pose.forward), [0, 1, 0]),
      children: [
        meshes.body.toKn5(`${carNode(k)}_BODY`, "jetty_train"),
        meshes.dark.toKn5(`${carNode(k)}_DARK`, "jetty_train_dark"),
        meshes.trim.toKn5(`${carNode(k)}_TRIM`, "jetty_trim"),
      ].filter((m) => m.indices.length),
    };
  });
  return { nodes, path, park: park - shift, end: end - shift };
}

/* ---------------- the cars, in their own frame ---------------- */

// Built in local (east, north, up) axes with forward = south, so that toKn5 (AC z = -north) turns
// it into the car frame's +Z. Origin: the car's middle, on the rail top.
const FWD: Vec2 = [0, -1];
const at = (ahead: number, left = 0): Vec2 => [FWD[0] * ahead - FWD[1] * left, FWD[1] * ahead + FWD[0] * left];

/** An n-sided prism lying along the car (a boiler), centred `ahead` of the middle, axis at height z. */
function prism(mb: MeshBuilder, ahead: number, length: number, r: number, z: number, sides = 8) {
  const ring = (s: number): Vec3[] => Array.from({ length: sides }, (_, k) => {
    const a = ((k + 0.5) / sides) * 2 * Math.PI;
    const [x, y] = at(ahead + s, Math.cos(a) * r);
    return [x, y, z + Math.sin(a) * r];
  });
  const f = ring(length / 2), b = ring(-length / 2);
  for (let k = 0; k < sides; k++) {
    const k1 = (k + 1) % sides, am = ((k + 1) / sides) * 2 * Math.PI;
    const side = at(0, Math.cos(am));
    const nrm: Vec3 = [side[0], side[1], Math.sin(am)];
    const i = mb.vertexCount;
    for (const p of [b[k], b[k1], f[k1], f[k]]) mb.vertex(p, 0, 0);
    for (let j = 0; j < 4; j++) mb.normals!.push(...nrm);
    mb.quad(i, i + 1, i + 2, i + 3);
  }
  // End caps.
  for (const [ring_, sign] of [[f, 1], [b, -1]] as const) {
    const c = mb.vertex([...at(ahead + (sign * length) / 2), z], 0.5, 0.5);
    mb.normals!.push(FWD[0] * sign, FWD[1] * sign, 0);
    const ids = ring_.map((p) => {
      const i = mb.vertex(p, 0, 0);
      mb.normals!.push(FWD[0] * sign, FWD[1] * sign, 0);
      return i;
    });
    for (let k = 0; k < sides; k++) {
      if (sign === 1) mb.tri(c, ids[k], ids[(k + 1) % sides]); else mb.tri(c, ids[(k + 1) % sides], ids[k]);
    }
  }
}

/** A box `ahead` of the middle and `left` of the centreline: length along the car, width across, z0..z1. */
function part(mb: MeshBuilder, ahead: number, left: number, length: number, width: number, z0: number, z1: number) {
  box(mb, at(ahead, left), FWD, length, width, z0, z1);
}

function builders() {
  const body = new MeshBuilder(), dark = new MeshBuilder(), trim = new MeshBuilder();
  body.normals = []; dark.normals = []; trim.normals = [];
  return { body, dark, trim };
}

/** Wheels: a dark block either side under each end. */
function wheels(dark: MeshBuilder, length: number) {
  for (const s of [-1, 1]) for (const t of [-1, 1]) part(dark, s * (length / 2 - BOGIE_INSET), t * 0.55, 0.7, 0.12, 0.02, 0.45);
}

/** The loco: a red boiler with a dark smokebox and chimney up front, a cab with a roof at the back. */
export function loco(length: number) {
  const m = builders();
  const h = length / 2;
  part(m.dark, 0, 0, length, 1.5, 0.3, 0.55); // frame
  wheels(m.dark, length);
  part(m.dark, h - 0.05, 0, 0.1, 1.6, 0.35, 0.6); // buffer beams
  part(m.dark, -h + 0.05, 0, 0.1, 1.6, 0.35, 0.6);
  // Boiler along the front two thirds, the smokebox at its nose, white bands round it.
  prism(m.body, 0.45, 1.9, 0.55, 1.15);
  prism(m.dark, h - 0.35, 0.5, 0.57, 1.15);
  for (const a of [0.0, 0.9]) prism(m.trim, a, 0.08, 0.575, 1.15);
  // Chimney with a flared top, and a dome.
  part(m.dark, h - 0.45, 0, 0.32, 0.32, 1.5, 2.05);
  part(m.dark, h - 0.45, 0, 0.46, 0.46, 2.05, 2.25);
  part(m.body, 0.3, 0, 0.4, 0.4, 1.55, 1.85);
  // Cab: low red walls, corner posts, a red roof with a white edge.
  const cab = -h + 0.7;
  part(m.body, cab, 0, 1.3, 1.6, 0.55, 1.45);
  for (const s of [-1, 1]) for (const t of [-1, 1]) part(m.body, cab + s * 0.58, t * 0.73, 0.1, 0.1, 1.45, 2.4);
  part(m.trim, cab, 0, 1.5, 1.8, 2.4, 2.46);
  part(m.body, cab, 0, 1.4, 1.7, 2.46, 2.56);
  return m;
}

/** An open carriage: low red sides with a white waistband, posts, a white canopy with dark solar panels on top. */
export function carriage(length: number) {
  const m = builders();
  const h = length / 2;
  part(m.dark, 0, 0, length, 1.6, 0.25, 0.45);
  wheels(m.dark, length);
  part(m.body, 0, 0, length, 2.0, 0.45, 1.0);
  part(m.trim, 0, 0, length + 0.02, 2.02, 0.92, 1.0);
  // Seat backs across the car (one per compartment), so it doesn't read as an empty tub.
  for (let k = 0; k < 4; k++) part(m.body, -h + 0.9 + k * ((length - 1.8) / 3), 0, 0.12, 1.8, 1.0, 1.35);
  for (const s of [-1, 0, 1]) for (const t of [-1, 1]) part(m.body, s * (h - 0.1), t * 0.94, 0.1, 0.1, 1.0, 2.35);
  part(m.trim, 0, 0, length + 0.1, 2.2, 2.35, 2.45);
  part(m.dark, 0, 0, length - 0.3, 1.9, 2.45, 2.5);
  return m;
}

/* ---------------- the track script ---------------- */

const n3 = (v: number) => (Math.round(v * 1000) / 1000).toString();

/**
 * The track script with the train's line and cars filled in: the line in AC coordinates (x east,
 * y up, z south), the cars by node name with their offsets from the nose.
 */
export function jettyTrainLua(template: string, train: JettyTrain): string {
  const path = train.path.pts.map((p) => toAc(...p).map(n3).join(", ")).join(", ");
  const cars = carOffsets().map((c, k) => `{ '${carNode(k)}', ${n3(c.mid)}, ${n3(c.half)} }`).join(", ");
  return template
    .replace("__PATH__", path)
    .replace("__CARS__", cars)
    .replace("__S_PARK__", n3(train.park))
    .replace("__S_END__", n3(train.end));
}

/**
 * The ext_config section that loads the script, with its settings (lowerCamelCase keys, as CSP
 * asks of track-script settings): the real timetable, hourly on the hour, about 5 km/h each way
 * and 5 minutes at the end (docs/jetty.md). First and last departures aren't published: 9 to 5
 * is a guess.
 */
export function jettyTrainConfig(): string[] {
  return [
    "[SCRIPT_...]",
    "SCRIPT = jetty_train.lua",
    "speedKmh = 5",
    "firstDeparture = 9",
    "lastDeparture = 17",
    "everyMinutes = 60",
    "waitAtEnd = 300",
    "nonStop = 0",
    "",
  ];
}
