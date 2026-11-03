// Busselton fork: things kept off the streets as built (road_clear's findings on Busselton, 3 Nov).
import { describe, expect, it } from "vitest";
import type { Vec2 } from "../src/core/geo";
import type { Kn5MeshNode } from "../src/core/kn5";
import type { Building } from "../src/core/buildings";
import { buildLots } from "../src/core/lots";
import { LineIndex, segDist } from "../src/core/sideStreets";
import { buildPaths, flatAcross, LIFT, shiftPath, steps } from "../src/core/paths";
import { clipTraceAtPaths, CLIP_ROOM } from "../src/core/pathTraceClip";
import type { TraceResult, TraceSample } from "../src/core/trace";

/** Vertices in local ENU (x east, y north, z up). */
const verts = (m: Kn5MeshNode): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < m.positions.length; i += 3) out.push([m.positions[i], -m.positions[i + 2], m.positions[i + 1]]);
  return out;
};

describe("LineIndex: the streets as built", () => {
  const line = { pts: [[0, 0], [100, 0]] as Vec2[], width: 6 };

  it("uses a traced street's own widths, not its class width", () => {
    expect(new LineIndex([line]).clearance(50, 5)).toBeCloseTo(2, 6);
    // Traced 12 m wide: 5 m off the line is 1 m inside the street (a tree there was kept before).
    expect(new LineIndex([{ ...line, widths: [12, 12] }]).clearance(50, 5)).toBeCloseTo(-1, 6);
    // Widening along the segment: interpolated.
    expect(new LineIndex([{ ...line, widths: [6, 14] }]).clearance(50, 5)).toBeCloseTo(0, 6);
    // A missing or bad width falls back to the class width.
    expect(new LineIndex([{ ...line, widths: [Number.NaN, Number.NaN] }]).clearance(50, 5)).toBeCloseTo(2, 6);
  });

  it("sees a street crossing a building between its corners", () => {
    const idx = new LineIndex([line]);
    // A 40 m long building with its corners 4 m either side of the street's line: every corner is
    // 1 m clear of the 6 m street, but the street runs straight through it.
    const across: Vec2[] = [[30, -4], [70, -4], [70, 4], [30, 4]];
    expect(Math.min(...across.map(([x, y]) => idx.clearance(x, y)))).toBeGreaterThan(0);
    expect(idx.ringClearance(across)).toBeLessThan(-1);
  });

  it("sees a traced street's edge cutting a wall with no corner on it", () => {
    // Corners 5.5 to 8 m north of a street traced 10 m wide, but the south wall's middle dips to 4 m.
    const idx = new LineIndex([{ pts: [[0, 0], [100, 0]], width: 6, widths: [10, 10] }]);
    const ring: Vec2[] = [[40, 5.5], [50, 4], [60, 5.5], [60, 15], [40, 15]];
    expect(ring.every(([x, y]) => idx.clearance(x, y) > 0)).toBe(false); // (50, 4) is the vertex here
    const wall: Vec2[] = [[40, 5.5], [60, 5.5], [60, 15], [40, 15]];
    expect(wall.every(([x, y]) => idx.clearance(x, y) > 0)).toBe(true);
    expect(idx.ringClearance(wall)).toBeCloseTo(0.5, 6);
    // A street bending up into the wall between its corners.
    const bend = new LineIndex([{ pts: [[0, 0], [50, 0], [50, 10]], width: 4 }]);
    expect(wall.every(([x, y]) => bend.clearance(x, y) > 0)).toBe(true);
    expect(bend.ringClearance(wall)).toBe(-Infinity); // its end (50, 10) is inside
  });

  it("sees a street that ends inside a building", () => {
    const idx = new LineIndex([{ pts: [[0, 50], [50, 50]], width: 4 }]);
    const big: Vec2[] = [[40, 30], [80, 30], [80, 70], [40, 70]];
    expect(idx.ringClearance(big)).toBe(-Infinity);
    // And one well clear of it.
    expect(new LineIndex([{ pts: [[0, 0], [30, 0]], width: 4 }]).ringClearance(big)).toBeGreaterThan(20);
    expect(new LineIndex([]).ringClearance(big)).toBe(Infinity);
  });

  it("measures between segments", () => {
    expect(segDist([0, 0], [10, 0], [5, -5], [5, 5])).toBe(0);
    expect(segDist([0, 0], [10, 0], [12, 3], [20, 3])).toBeCloseTo(Math.hypot(2, 3), 6);
    expect(segDist([0, 0], [10, 0], [3, 2], [7, 2])).toBeCloseTo(2, 6);
  });
});

describe("lots: garden beds off a street", () => {
  it("leaves out a bed whose end reaches a street on a corner block", () => {
    const flat = () => 10;
    const house = (x: number): Building => ({
      ring: [[x, 0], [x + 14, 0], [x + 14, 10], [x, 10]],
      height: 2.8, type: "house", pitch: 22, roof: "hip", roofColour: 1, facade: 0, source: "frontage",
      front: [[x, 0], [x + 14, 0]], garage: false, setback: 4.2,
    });
    // The road's edge 4.2 m south of the front wall, and a side street's edge 1 m past the east end.
    const gap = (x0: number) => (x: number, y: number) => Math.min(y + 4.2, x0 + 15 - x);
    let beds = 0;
    for (let i = 0; i < 60; i++) {
      const x0 = i * 40;
      const out = buildLots([house(x0)], flat, { roadGap: gap(x0) });
      for (const m of out.filter((n) => /^(GARDENBED|SHRUBS)_/.test(n.name))) {
        for (const [x, y] of verts(m)) {
          beds++;
          expect(gap(x0)(x, y)).toBeGreaterThan(1.5 - 1.3); // shrubs reach a little past a bed's edge
        }
      }
      for (const m of out.filter((n) => /^GARDENBED_/.test(n.name))) {
        for (const [x, y] of verts(m)) expect(gap(x0)(x, y)).toBeGreaterThan(1.5);
      }
    }
    expect(beds).toBeGreaterThan(0); // beds away from the side street are still laid
  });
});

describe("paths: moved off the kerb, not cut", () => {
  // A path along y = 0; a road whose edge (with the path's half width and room) needs y >= 1.4 for x in 20..40.
  const pts: Vec2[] = Array.from({ length: 201 }, (_, i) => [i * 0.3, 0]);
  const along = pts.map((p) => p[0]);
  const normals = pts.map(() => [0, 1] as Vec2);
  const clear = (p: Vec2) => !(p[0] > 20 && p[0] < 40 && p[1] < 1.4);

  it("eases sideways round the obstacle and stays clear everywhere", () => {
    const r = shiftPath(pts, along, normals, 3, () => true, clear);
    expect(r.ok.every(Boolean)).toBe(true);
    r.pts.forEach((p) => expect(clear(p)).toBe(true));
    // 1.5 m off at the obstacle, eased in: no more than 0.25 m sideways per metre along.
    expect(r.off[100]).toBeCloseTo(1.5, 6);
    expect(r.off[0]).toBe(0);
    for (let i = 1; i < r.off.length; i++) expect(Math.abs(r.off[i] - r.off[i - 1])).toBeLessThanOrEqual(0.25 * 0.3 + 1e-9);
  });

  it("cuts where no move up to the limit clears it, and never moves without a limit", () => {
    const wide = (p: Vec2) => !(p[0] > 20 && p[0] < 40 && Math.abs(p[1]) < 4);
    const r = shiftPath(pts, along, normals, 3, () => true, wide);
    expect(r.ok.slice(70, 130).some(Boolean)).toBe(false);
    expect(r.ok[0] && r.ok[200]).toBe(true);
    const none = shiftPath(pts, along, normals, 0, () => true, clear);
    expect(none.off.every((o) => o === 0)).toBe(true);
    expect(none.ok[100]).toBe(false);
  });

  it("builds a shared path through where it used to be cut", () => {
    const flat = () => 1;
    const xy = (p: Vec2) => clear(p);
    const shared = buildPaths([{ kind: "shared", pts: [[0, 0], [60, 0]] }], flat, (x, y) => xy([x, y]), () => true);
    const v = shared.flatMap(verts);
    // Ribbon all along, none of it on the road.
    expect(Math.min(...v.map((p) => p[0]))).toBeLessThan(0.5);
    expect(Math.max(...v.map((p) => p[0]))).toBeGreaterThan(59.5);
    for (const [x, y] of v) if (x > 20.5 && x < 39.5) expect(y).toBeGreaterThan(1.4 - 1.25 - 1e-6);
    // Foot paths aren't moved (beside the route the photo's own footpath takes over).
    const foot = buildPaths([{ kind: "foot", pts: [[0, 0], [60, 0]] }], flat, (x, y) => xy([x, y]), () => true).flatMap(verts);
    expect(foot.some(([x]) => x > 21 && x < 39)).toBe(false);
  });
});

describe("paths: moved off a step running along under them (3 Nov)", () => {
  // A nature strip's outer edge along y = 0.4: 8 cm down to the terrain north of it, for x 10..50.
  // The shared path's mapped line (y = 0) straddles it, so its ground across has a step in it.
  const ground = (x: number, y: number) => (x > 10 && x < 50 && y > 0.4 ? 0.92 : 1);

  it("tells a step across from flat ground", () => {
    expect(flatAcross([1, 1, 1, 1, 1])).toBe(true);
    expect(flatAcross([1, 1.02, 1.04, 1.06, 1.08])).toBe(true);
    expect(flatAcross([1, 1, 1, 0.92, 0.92])).toBe(false);
  });

  it("lays the shared path whole, moved to flat ground, never across the step", () => {
    const out = buildPaths([{ kind: "shared", pts: [[0, 0], [60, 0]] }], ground, () => true, () => true);
    const v = out.flatMap(verts);
    expect(Math.min(...v.map((p) => p[0]))).toBeLessThan(0.5);
    expect(Math.max(...v.map((p) => p[0]))).toBeGreaterThan(59.5);
    // Along the strip edge the ribbon is wholly to one side of it, on the ground.
    const mid = v.filter(([x]) => x > 12 && x < 48);
    expect(mid.length).toBeGreaterThan(0);
    const north = mid.every(([, y]) => y > 0.4), south = mid.every(([, y]) => y < 0.4);
    expect(north || south).toBe(true);
    for (const [x, y, z] of v) expect(z - ground(x, y)).toBeCloseTo(LIFT, 4);
    // One ribbon all the way: no gap along it.
    const xs = [...new Set(v.map(([x]) => Math.round(x)))].sort((a, b) => a - b);
    for (let k = 1; k < xs.length; k++) expect(xs[k] - xs[k - 1]).toBeLessThanOrEqual(15);
  });

  it("still cuts a foot path there (foot paths don't move)", () => {
    const v = buildPaths([{ kind: "foot", pts: [[0, 0], [60, 0]] }], ground, () => true, () => true).flatMap(verts);
    expect(v.some(([x]) => x > 12 && x < 48)).toBe(false);
  });

  it("holds a move along, so a run of uneven moves is one straight offset", () => {
    const pts: Vec2[] = Array.from({ length: 201 }, (_, i) => [i * 0.3, 0]);
    const along = pts.map((p) => p[0]);
    const normals = pts.map(() => [0, 1] as Vec2);
    // Clear 1 m off for x 20..40 except every few samples, where 1.5 m is needed.
    const clear = (p: Vec2, i: number) => !(p[0] > 20 && p[0] < 40) || p[1] >= (i % 7 === 0 ? 1.5 : 1);
    const r = shiftPath(pts, along, normals, 3, () => true, clear);
    expect(r.ok.every(Boolean)).toBe(true);
    for (let i = 0; i < 201; i++) if (pts[i][0] > 20 && pts[i][0] < 40) expect(r.off[i]).toBeCloseTo(1.5, 6);
  });
});

describe("paths: small steps followed, big ones cut", () => {
  const ribbonOver = (nodes: Kn5MeshNode[], ground: (x: number, y: number) => number) => {
    let up = -Infinity, down = Infinity;
    for (const n of nodes) {
      const p = n.positions, ix = n.indices;
      for (let t = 0; t < ix.length; t += 3) {
        for (let u = 0.05; u < 1; u += 0.15) for (let v = 0.05; u + v < 1; v += 0.15) {
          const w = 1 - u - v, a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
          const x = u * p[a] + v * p[b] + w * p[c], y = -(u * p[a + 2] + v * p[b + 2] + w * p[c + 2]), h = u * p[a + 1] + v * p[b + 1] + w * p[c + 1];
          up = Math.max(up, h - ground(x, y));
          down = Math.min(down, h - ground(x, y));
        }
      }
    }
    return { up, down };
  };

  it("lays one ribbon over an 8 cm lip across the path, close to the ground", () => {
    const lip = (x: number) => (x > 20 ? 1.08 : 1);
    const out = buildPaths([{ kind: "shared", pts: [[2, 5], [38, 5]] }], (x) => lip(x), () => true, () => true);
    const v = out.flatMap(verts);
    expect(v.some(([x]) => x > 19.8 && x < 20)).toBe(true);
    expect(v.some(([x]) => x > 20 && x < 20.2)).toBe(true);
    for (const [x, , z] of v) expect(z - lip(x)).toBeCloseTo(LIFT, 4);
    // Within path_ground's 10 cm, and the ground up through it only over the last few centimetres at the lip.
    const { up, down } = ribbonOver(out, (x) => lip(x));
    expect(up).toBeLessThan(0.1);
    expect(down).toBeGreaterThan(-0.1);
  });

  it("still cuts at a kerb-high step", () => {
    const kerb = (x: number) => (x > 20 ? 1.15 : 1);
    const v = buildPaths([{ kind: "shared", pts: [[2, 5], [38, 5]] }], (x) => kerb(x), () => true, () => true).flatMap(verts);
    for (const [x] of v) expect(Math.abs(x - 20)).toBeGreaterThan(0.2);
  });

  it("judges a bend on uneven spacing by the straight line between neighbours", () => {
    // An even 20% slope sampled unevenly isn't a step.
    const g = (s: number) => [0.2 * s, 0.2 * s, 0.2 * s, 0.2 * s, 0.2 * s];
    const run = [0, 0.35, 0.4, 0.75].map((s) => ({ s, g: g(s) }));
    expect(steps(run, 1)).toBe(false);
    expect(steps(run, 2)).toBe(false);
  });
});

describe("pathTraceClip: a traced edge stops short of a path beside the road", () => {
  // A straight road along x, mapped 7 m wide, traced 14 m wide about the line, fully trusted.
  const n = 101;
  const samples: TraceSample[] = Array.from({ length: n }, (_, i) => ({ pos: [i * 2, 0], left: [0, 1], width: 7, s: i * 2 }));
  const trace = (): TraceResult => ({ offset: new Array(n).fill(0), width: new Array(n).fill(14), conf: new Array(n).fill(1), coverage: 1 });
  const edges = (tr: TraceResult, i: number) => [tr.offset[i] + tr.width[i] / 2, tr.offset[i] - tr.width[i] / 2];

  it("pulls the left edge in off a shared path 7 m out, and eases it back out past the path's end", () => {
    const tr = trace();
    const changed = clipTraceAtPaths(samples, tr, [{ kind: "shared", pts: [[60, 7], [140, 7]] }]);
    expect(changed).toBeGreaterThan(40);
    const [l, r] = edges(tr, 50);
    expect(l).toBeCloseTo(7 - 1.25 - CLIP_ROOM, 6);
    expect(r).toBeCloseTo(-7, 6);
    // Untouched well away from it; eased (0.2 m per m) in between.
    expect(edges(tr, 0)[0]).toBeCloseTo(7, 6);
    for (let i = 1; i < n; i++) expect(Math.abs(edges(tr, i)[0] - edges(tr, i - 1)[0])).toBeLessThanOrEqual(0.4 + 1e-9);
  });

  it("leaves paths that cross, sit inside the mapped width or lie past the traced edge", () => {
    for (const pts of [[[100, -20], [100, 20]], [[0, 4], [200, 4]], [[0, -9], [200, -9]]] as Vec2[][]) {
      const tr = trace();
      expect(clipTraceAtPaths(samples, tr, [{ kind: "shared", pts }])).toBe(0);
    }
  });

  it("never pulls inside the mapped width, and keeps the blend applyTrace makes at partial trust", () => {
    const tr = trace();
    tr.conf.fill(0.5);
    // A shared path 4.6 m out (past 3.5 + 1): its inner edge at 3.35 m; the edge stops at the mapped 3.5 m.
    clipTraceAtPaths(samples, tr, [{ kind: "shared", pts: [[0, 4.6], [200, 4.6]] }]);
    const built = 7 + (tr.width[50] - 7) * 0.5;
    expect(tr.offset[50] + built / 2).toBeCloseTo(3.5, 6);
    expect(tr.offset[50] - built / 2).toBeCloseTo(-(7 + (14 - 7) * 0.5) / 2, 6);
  });
});
