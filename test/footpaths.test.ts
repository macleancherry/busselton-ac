// Tests for the photo footpaths, crossovers and letterboxes, written from docs/specs/footpaths.md.
import { describe, expect, it } from "vitest";
import { buildVergeConcrete, isConcrete, laybacks, letterboxes, readVerge, type VergeConcrete } from "../src/core/footpaths";
import { KERB_BACK } from "../src/core/kerbs";
import type { RoadPlan, RoadSample } from "../src/core/road";
import { SINK } from "../src/core/sceneGround";
import type { Kn5MeshNode } from "../src/core/kn5";

const W = 7; // road width: edges at y = +-3.5
const SPACING = 2;

/** A straight road east along y = 0, one sample every 2 m. */
function straight(length = 100, kerb: [number, number] = [1, 1]): RoadPlan {
  const samples: RoadSample[] = [];
  for (let s = 0; s <= length; s += SPACING) {
    samples.push({ pos: [s, 0], tan: [1, 0], left: [0, 1], curvature: 0, s, width: W, h: 0, bank: 0, kerb });
  }
  return { closed: false, samples, length, roundabouts: [] };
}

const kerbsOf = (plan: RoadPlan, left = 1, right = 1): [number[], number[]] => [plan.samples.map(() => left), plan.samples.map(() => right)];

type Rgb = [number, number, number];
const LAWN: Rgb = [0.3, 0.5, 0.22];
const ASPHALT: Rgb = [0.18, 0.18, 0.19];
const CONCRETE: Rgb = [0.78, 0.77, 0.74];

/** Concrete patches: x range along the road, d range out from the edge, on a side. */
interface Patch { x0: number; x1: number; d0: number; d1: number; side?: 0 | 1 }
function photo(patches: Patch[]) {
  return (x: number, y: number): Rgb | null => {
    if (Math.abs(y) < W / 2) return ASPHALT;
    const side = y > 0 ? 0 : 1;
    const d = Math.abs(y) - W / 2;
    for (const p of patches) if ((p.side ?? 0) === side && x >= p.x0 && x <= p.x1 && d >= p.d0 && d <= p.d1) return CONCRETE;
    return LAWN;
  };
}

const STRIP = 4;
const never = () => false;

describe("concrete test", () => {
  it("knows concrete from the rest", () => {
    expect(isConcrete([0.72, 0.72, 0.7])).toBe(true); // pale grey
    expect(isConcrete([0.97, 0.97, 0.97])).toBe(true); // white, roof-bright
    expect(isConcrete([0.3, 0.55, 0.25])).toBe(false); // lawn
    expect(isConcrete([0.85, 0.3, 0.3])).toBe(false); // saturated red
    expect(isConcrete([0.2, 0.2, 0.21])).toBe(false); // asphalt
    expect(isConcrete(null)).toBe(false);
  });
});

describe("readVerge", () => {
  it("finds a steady 1.5 m footpath 2 m behind the kerb", () => {
    const plan = straight();
    const v = readVerge(plan, photo([{ x0: 20, x1: 80, d0: 2, d1: 3.5 }]), kerbsOf(plan), STRIP, never);
    const bands = v.paths[0].filter((b) => b);
    expect(bands.length).toBeGreaterThanOrEqual(29);
    for (const b of bands) {
      expect(b!.d0).toBeGreaterThan(1.9);
      expect(b!.d0).toBeLessThan(2.15);
      expect(b!.d1).toBeGreaterThan(3.4);
      expect(b!.d1).toBeLessThan(3.65);
      expect(b).toEqual(bands[0]);
    }
    expect(v.paths[1].every((b) => b === null)).toBe(true);
    expect(v.drives).toEqual([]);
  });

  it("drops short footpaths and joins short gaps", () => {
    const plan = straight();
    const short = readVerge(plan, photo([{ x0: 30, x1: 40, d0: 2, d1: 3.5 }]), kerbsOf(plan), STRIP, never);
    expect(short.paths[0].some((b) => b)).toBe(false);

    const near = readVerge(plan, photo([{ x0: 10, x1: 40, d0: 2, d1: 3.5 }, { x0: 45, x1: 75, d0: 2, d1: 3.5 }]), kerbsOf(plan), STRIP, never);
    expect(near.paths[0][22]).not.toBeNull(); // x = 44, in the gap
    expect(near.paths[0][5]).toEqual(near.paths[0][35]);

    const far = readVerge(plan, photo([{ x0: 10, x1: 40, d0: 2, d1: 3.5 }, { x0: 52, x1: 82, d0: 2, d1: 3.5 }]), kerbsOf(plan), STRIP, never);
    expect(far.paths[0][23]).toBeNull(); // x = 46, in the gap
    expect(far.paths[0][10]).not.toBeNull();
    expect(far.paths[0][33]).not.toBeNull();
  });

  it("finds a driveway crossover but not a 15 m slab", () => {
    const plan = straight();
    const v = readVerge(plan, photo([{ x0: 40, x1: 43.5, d0: 0, d1: 4.5 }]), kerbsOf(plan), STRIP, never);
    expect(v.drives).toEqual([{ i0: 20, i1: 21, side: 0, reach: STRIP }]);
    expect(v.paths[0].some((b) => b)).toBe(false);

    const wide = readVerge(plan, photo([{ x0: 40, x1: 55, d0: 0, d1: 4.5 }]), kerbsOf(plan), STRIP, never);
    expect(wide.drives).toEqual([]);
  });

  it("reads nothing where there's no kerb or the far end is on another street", () => {
    const plan = straight();
    const calls: [number, number][] = [];
    const base = photo([{ x0: 20, x1: 80, d0: 2, d1: 3.5, side: 1 }, { x0: 40, x1: 43.5, d0: 0, d1: 4.5, side: 1 }]);
    const v = readVerge(plan, (x, y) => (calls.push([x, y]), base(x, y)), kerbsOf(plan, 1, 0), STRIP, never);
    expect(v.paths[1].every((b) => b === null)).toBe(true);
    expect(v.drives).toEqual([]);
    expect(calls.some(([, y]) => y < 0)).toBe(false);

    const blocked = readVerge(plan, photo([{ x0: 20, x1: 80, d0: 2, d1: 3.5 }]), kerbsOf(plan), STRIP, (_x, y) => y > 0);
    expect(blocked.paths[0].every((b) => b === null)).toBe(true);
  });

  it("copes with no kerb anywhere and a one-sample plan", () => {
    const plan = straight();
    const v = readVerge(plan, photo([{ x0: 20, x1: 80, d0: 2, d1: 3.5 }]), kerbsOf(plan, 0, 0), STRIP, never);
    expect(v.drives).toEqual([]);
    expect(v.paths[0].concat(v.paths[1]).every((b) => b === null)).toBe(true);

    const one = straight(0);
    const v1 = readVerge(one, photo([{ x0: -5, x1: 5, d0: 0, d1: 5 }]), kerbsOf(one), STRIP, never);
    expect(v1.paths[0]).toHaveLength(1);
    expect(buildVergeConcrete(one, v1, () => 0)).toEqual([]);
  });

  it("treats missing photo as not concrete", () => {
    const plan = straight();
    const v = readVerge(plan, () => null, kerbsOf(plan), STRIP, never);
    expect(v.drives).toEqual([]);
    expect(v.paths[0].every((b) => b === null)).toBe(true);
  });
});

describe("laybacks", () => {
  it("marks exactly the crossover samples", () => {
    const plan = straight();
    const v = readVerge(plan, photo([{ x0: 40, x1: 45.5, d0: 0, d1: 4.5, side: 1 }]), kerbsOf(plan), STRIP, never);
    expect(v.drives).toHaveLength(1);
    const lb = laybacks(plan.samples.length, v);
    const d = v.drives[0];
    expect(d.side).toBe(1);
    lb[1].forEach((f, i) => expect(f).toBe(i >= d.i0 && i <= d.i1 ? 1 : 0));
    expect(lb[0].every((f) => f === 0)).toBe(true);
  });
});

/** Local (x, y, h) of each vertex of an AC-space mesh. */
const verts = (m: Kn5MeshNode) => {
  const out: { x: number; y: number; h: number; ny: number }[] = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push({ x: m.positions[i], y: -m.positions[i + 2], h: m.positions[i + 1], ny: m.normals[i + 1] });
  return out;
};

describe("buildVergeConcrete", () => {
  const plan = straight(40);
  const n = plan.samples.length;
  const verge = (): VergeConcrete => {
    const left = new Array(n).fill(null), right = new Array(n).fill(null);
    for (let i = 0; i <= 10; i++) left[i] = { d0: 2, d1: 3.5 };
    for (let i = 2; i <= 14; i++) right[i] = { d0: 5, d1: 6.2 };
    return { paths: [left, right], drives: [{ i0: 6, i1: 8, side: 1, reach: STRIP }, { i0: 3, i1: 4, side: 0, reach: STRIP }] };
  };
  const under = (x: number, y: number) => 0.3 + 0.02 * x + 0.05 * y;

  it("names and heights", () => {
    const meshes = buildVergeConcrete(plan, verge(), under);
    const paths = meshes.filter((m) => m.name.startsWith("1STREET_PATH_"));
    const drives = meshes.filter((m) => m.name.startsWith("1STREET_DRIVE_"));
    expect(paths.length).toBeGreaterThan(0);
    expect(drives.map((m) => m.name)).toEqual(["1STREET_DRIVE_000"]);
    for (const m of meshes) expect(m.material).toBe("concrete");

    for (const v of paths.flatMap(verts)) {
      const off = v.h - under(v.x, v.y);
      const top = Math.abs(off - 0.04) < 1e-4;
      expect(top || Math.abs(off + 0.03) < 1e-4).toBe(true);
      if (top && v.ny > 0.5) expect(v.ny).toBeGreaterThan(0.99);
    }
    // Every top vertex faces up, on both sides of the road.
    const tops = paths.flatMap(verts).filter((v) => Math.abs(v.h - under(v.x, v.y) - 0.04) < 1e-4 && Math.abs(v.ny) > 0.5);
    expect(tops.some((v) => v.y > 0) && tops.some((v) => v.y < 0)).toBe(true);
    expect(tops.every((v) => v.ny > 0.99)).toBe(true);

    // Crossovers: inner edge on the laid-back kerb, outer edge proud.
    const dv = verts(drives[0]);
    const inner = dv.filter((v) => Math.abs(Math.abs(v.y) - (W / 2 + KERB_BACK)) < 1e-4 && v.ny > 0.5);
    expect(inner.length).toBeGreaterThan(0);
    for (const v of inner) expect(v.h - under(v.x, v.y)).toBeCloseTo(0.005, 4); // `under` is laid back there already (stripGround)
    const outerLeft = dv.filter((v) => v.y > 0 && Math.abs(v.y - (W / 2 + STRIP)) < 1e-4 && v.ny > 0.5);
    expect(outerLeft.length).toBeGreaterThan(0);
    for (const v of outerLeft) expect(v.h - under(v.x, v.y)).toBeCloseTo(0.04, 4);
    // On the right a footpath starts beyond the reach: the crossover runs out to it.
    const outerRight = dv.filter((v) => v.y < 0 && v.ny > 0.5 && Math.abs(v.y + W / 2 + 5) < 1e-4);
    expect(outerRight.length).toBeGreaterThan(0);
    // The crossover's top faces up on both sides of the road.
    for (const v of dv.filter((v) => Math.abs(v.ny) > 0.5)) expect(v.ny).toBeGreaterThan(0.99);
  });

  it("edges face the road on the inside and away on the outside", () => {
    const meshes = buildVergeConcrete(plan, verge(), under);
    for (const m of meshes) {
      for (let i = 0; i < m.positions.length; i += 3) {
        const ny = m.normals[i + 1];
        if (Math.abs(ny) > 0.5) continue;
        const y = -m.positions[i + 2], northNormal = -m.normals[i + 2];
        const d = Math.abs(y) - W / 2;
        const roadward = Math.sign(northNormal) === -Math.sign(y);
        // Inner edges (at the band start or the kerb's back) face the road; outer edges face away.
        const inner = m.name.startsWith("1STREET_DRIVE") ? Math.abs(d - KERB_BACK) < 1e-3 : Math.abs(d - 2) < 1e-3 || Math.abs(d - 5) < 1e-3;
        expect(roadward).toBe(inner);
      }
    }
  });

  it("calls under with plain (x, y)", () => {
    const counts = new Set<number>();
    buildVergeConcrete(plan, verge(), (...args: number[]) => (counts.add(args.length), under(args[0], args[1])));
    expect([...counts]).toEqual([2]);
  });

  it("slab UVs: across 0 to 1, a joint every 3 m", () => {
    const [m] = buildVergeConcrete(plan, verge(), under).filter((x) => x.name.startsWith("1STREET_PATH_"));
    for (let i = 0; i < m.uvs.length / 2; i++) {
      // Across: 0 at the band's inner edge to 1 at its outer edge (the top is a grid of small cells).
      const y = -m.positions[i * 3 + 2], [d0, d1] = y > 0 ? [2, 3.5] : [5, 6.2];
      expect(m.uvs[i * 2]).toBeCloseTo((Math.abs(y) - W / 2 - d0) / (d1 - d0), 4);
      expect(m.uvs[i * 2 + 1]).toBeCloseTo(m.positions[i * 3] / 3, 4); // s = x on this road
    }
  });
});

describe("letterboxes", () => {
  const plan = straight(40);
  const n = plan.samples.length;
  const ground = (x: number, y: number) => 1 + 0.03 * x - 0.02 * y;

  it("one per crossover, on the approach side, standing SINK into the ground", () => {
    const left = new Array(n).fill(null);
    left[4] = { d0: 4.5, d1: 6 };
    const v: VergeConcrete = { paths: [left, new Array(n).fill(null)], drives: [{ i0: 5, i1: 7, side: 0, reach: STRIP }, { i0: 5, i1: 7, side: 1, reach: STRIP }] };
    const pieces = letterboxes(plan, v, ground);
    expect(pieces).toHaveLength(4);
    const posts = pieces.filter((p) => p.kind === "box" && p.material === "timber");
    expect(posts).toHaveLength(2);
    const [l, r] = posts as Extract<(typeof pieces)[number], { kind: "box" }>[];
    // Left side: the sample before the driveway, past the footpath there.
    expect(l.at[0]).toBeCloseTo(8);
    expect(l.at[1]).toBeCloseTo(W / 2 + 6 + 0.4);
    // Right side: the sample after it, past the reach.
    expect(r.at[0]).toBeCloseTo(16);
    expect(r.at[1]).toBeCloseTo(-(W / 2 + STRIP + 0.4));
    for (const p of posts as Extract<(typeof pieces)[number], { kind: "box" }>[]) {
      const g = ground(p.at[0], p.at[1]);
      expect(p.z0).toBeCloseTo(g - SINK, 6);
      expect(p.z1).toBeCloseTo(g + 0.95, 6);
    }
    const boxes = pieces.filter((p) => p.kind === "box" && p.material === "letterbox") as Extract<(typeof pieces)[number], { kind: "box" }>[];
    for (const b of boxes) {
      const g = ground(b.at[0], b.at[1]);
      expect(b.z0).toBeCloseTo(g + 0.95, 6);
      expect(b.z1).toBeCloseTo(g + 1.22, 6);
    }
  });

  it("clamps at the ends of the road", () => {
    const v: VergeConcrete = { paths: [new Array(n).fill(null), new Array(n).fill(null)], drives: [{ i0: 0, i1: 1, side: 0, reach: STRIP }, { i0: n - 2, i1: n - 1, side: 1, reach: STRIP }] };
    const posts = letterboxes(plan, v, ground).filter((p) => p.kind === "box" && p.material === "timber") as Extract<ReturnType<typeof letterboxes>[number], { kind: "box" }>[];
    expect(posts[0].at[0]).toBeCloseTo(0);
    expect(posts[1].at[0]).toBeCloseTo(40);
  });
});
