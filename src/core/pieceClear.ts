// Busselton fork: the last pass over every placed piece: no post stands on a drivable mesh.
//
// Some placers clear their posts off the road as they go (poleSpot.ts), but not all of them:
// shop and landmark pylons, bus stops and shelters, servo canopies, START/FINISH and kangaroo signs
// and letterboxes are placed by their distance from a centreline, which misses the street meshes as
// built (mouth fills, wider-than-mapped streets, car park aisles, the network's junctions). Margaret
// River had a shop pylon with one leg on a side street. So every piece goes through here before it
// becomes a mesh:
//   - pieces are joined into fixtures: boxes whose footprints and heights touch (a pole and its arm,
//     a canopy's columns and roof), and each sign face or blade with the posts it hangs on;
//   - a fixture's feet are its slender boxes (under 1 m across) standing at its lowest level;
//   - when any foot is on the road, the whole fixture moves to the nearest spot where every foot is
//     clear (its heights follow the ground there), or is dropped when there's none within reach.
// The radius each foot keeps is under every placer's own, so a post a placer already cleared stays put.
import type { HeightFn } from "./elevation";
import type { Vec2 } from "./geo";
import type { BoxPiece, Piece } from "./pieces";
import { clearSpot, footOnRoad, type OnRoad } from "./poleSpot";
import { SINK } from "./sceneGround";

/** Joined when boxes come this close, metres (as poleCheck.ts). */
const JOIN = 0.03;
/** A face or blade hangs on posts within this distance of its anchor, metres. */
const HANG = 1.0;
/** A foot: a box under this across, metres. */
const SLENDER = 1.0;
/** Feet stand within this of the fixture's lowest base, metres. */
const FOOT_BAND = 0.3;
/** Gap a foot keeps from the road edge beyond its half width, metres. */
const GAP = 0.1;

export interface ClearReport { pieces: Piece[]; moved: number; dropped: number }

interface Box2 { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }

function boxOf(p: BoxPiece): Box2 {
  const l = Math.hypot(p.along[0], p.along[1]) || 1;
  const a: Vec2 = [p.along[0] / l, p.along[1] / l];
  const hx = (Math.abs(a[0]) * p.length + Math.abs(a[1]) * p.depth) / 2;
  const hy = (Math.abs(a[1]) * p.length + Math.abs(a[0]) * p.depth) / 2;
  return { x0: p.at[0] - hx, x1: p.at[0] + hx, y0: p.at[1] - hy, y1: p.at[1] + hy, z0: p.z0, z1: p.z1 };
}

const zRange = (p: Piece): [number, number] =>
  p.kind === "box" ? [p.z0, p.z1] : p.kind === "blade" ? [p.z - p.height / 2, p.z + p.height / 2] : [p.z0, p.z0 + p.height];

const shift = (p: Piece, d: Vec2, dz: number): Piece => {
  const at: Vec2 = [p.at[0] + d[0], p.at[1] + d[1]];
  if (p.kind === "box") return { ...p, at, z0: p.z0 + dz, z1: p.z1 + dz };
  if (p.kind === "blade") return { ...p, at, z: p.z + dz };
  return { ...p, at, z0: p.z0 + dz };
};

/** Group pieces into fixtures (lists of indices into `pieces`). */
export function fixtures(pieces: Piece[]): number[][] {
  const parent = pieces.map((_, k) => k);
  const find = (a: number): number => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const join = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  const CELL = 4;
  const grid = new Map<string, number[]>();
  const boxes = new Map<number, Box2>();
  pieces.forEach((p, k) => {
    if (p.kind !== "box") return;
    const b = boxOf(p);
    boxes.set(k, b);
    for (let i = Math.floor((b.x0 - JOIN) / CELL); i <= Math.floor((b.x1 + JOIN) / CELL); i++)
      for (let j = Math.floor((b.y0 - JOIN) / CELL); j <= Math.floor((b.y1 + JOIN) / CELL); j++) {
        const key = `${i},${j}`;
        const list = grid.get(key);
        for (const o of list ?? []) {
          const c = boxes.get(o)!;
          if (b.x0 - JOIN <= c.x1 && c.x0 - JOIN <= b.x1 && b.y0 - JOIN <= c.y1 && c.y0 - JOIN <= b.y1 && b.z0 - JOIN <= c.z1 && c.z0 - JOIN <= b.z1) join(k, o);
        }
        if (list) list.push(k); else grid.set(key, [k]);
      }
  });
  // Faces and blades: onto every box within reach whose heights overlap theirs.
  pieces.forEach((p, k) => {
    if (p.kind === "box") return;
    const [z0, z1] = zRange(p);
    const [x, y] = p.at;
    for (let i = Math.floor((x - HANG) / CELL); i <= Math.floor((x + HANG) / CELL); i++)
      for (let j = Math.floor((y - HANG) / CELL); j <= Math.floor((y + HANG) / CELL); j++)
        for (const o of grid.get(`${i},${j}`) ?? []) {
          const c = boxes.get(o)!;
          const dx = Math.max(c.x0 - x, 0, x - c.x1), dy = Math.max(c.y0 - y, 0, y - c.y1);
          if (Math.hypot(dx, dy) <= HANG && z0 - JOIN <= c.z1 && c.z0 - JOIN <= z1) join(k, o);
        }
  });
  const sets = new Map<number, number[]>();
  pieces.forEach((_, k) => { const r = find(k); const l = sets.get(r); if (l) l.push(k); else sets.set(r, [k]); });
  return [...sets.values()];
}

/**
 * Every piece, with each fixture that has a foot on the road moved clear (up to `reach` metres)
 * or dropped. `ground` gives the heights at a moved fixture's new spot.
 */
export function clearPieces(pieces: Piece[], onRoad: OnRoad | undefined, ground: HeightFn, reach = 6): ClearReport {
  if (!onRoad) return { pieces, moved: 0, dropped: 0 };
  const out: (Piece | null)[] = pieces.slice();
  let moved = 0, dropped = 0;
  for (const set of fixtures(pieces)) {
    const boxes = set.filter((k) => pieces[k].kind === "box").map((k) => ({ k, p: pieces[k] as BoxPiece }));
    if (!boxes.length) continue;
    const low = Math.min(...boxes.map((b) => b.p.z0));
    const feet = boxes
      .filter((b) => Math.max(b.p.length, b.p.depth) < SLENDER && b.p.z0 <= low + FOOT_BAND)
      .map((b) => ({ ...b, r: Math.max(b.p.length, b.p.depth) / 2 + GAP }));
    if (!feet.length || !feet.some((f) => footOnRoad(f.p.at, f.r, onRoad))) continue;
    const anchor = feet[0].p.at;
    const all: OnRoad = (x, y) => feet.some((f) => footOnRoad([f.p.at[0] - anchor[0] + x, f.p.at[1] - anchor[1] + y], f.r, onRoad));
    const spot = clearSpot(anchor, all, { radius: 0, reach });
    if (!spot) {
      for (const k of set) out[k] = null;
      dropped++;
      continue;
    }
    const d: Vec2 = [spot[0] - anchor[0], spot[1] - anchor[1]];
    // Each foot on the ground at its new spot; the rest rises or falls with the lowest change.
    const g = new Map(feet.map((f) => [f.k, ground(f.p.at[0] + d[0], f.p.at[1] + d[1])]));
    const dz = Math.min(...feet.map((f) => g.get(f.k)! - (f.p.z0 + SINK)));
    for (const k of set) {
      const p = shift(pieces[k], d, dz);
      const gk = g.get(k);
      out[k] = gk !== undefined && p.kind === "box" ? { ...p, z0: gk - SINK } : p;
    }
    moved++;
  }
  return { pieces: out.filter((p): p is Piece => p !== null), moved, dropped };
}
