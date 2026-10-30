import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { aiGrid, readFastLaneAi, writeFastLaneAi, type AiPoint } from "../src/core/aiSpline";
import { buildFiles, HAVE_BUILD } from "./ac-buildfiles";

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** A synthetic line: every field distinct, alternating camber direction. */
function line(n: number, seed = 1): AiPoint[] {
  const r = seeded(seed);
  return Array.from({ length: n }, (_, i) => ({
    position: [i * 3.3 - 50, 1 + r(), Math.sin(i / 5) * 40] as [number, number, number],
    distance: i * 3.3,
    speed: 10 + r() * 20, gas: r(), brake: r(), radius: 50 + r() * 500, sideLeft: 2 + r(), sideRight: 3 + r(),
    camber: r() * 0.05, direction: (i % 2 ? -1 : 1) as 1 | -1,
    normal: [r() * 0.1, 1, r() * 0.1] as [number, number, number], length: 3.3 + r() * 0.01,
    forward: [Math.SQRT1_2, 0, Math.SQRT1_2] as [number, number, number], grade: (r() - 0.5) * 0.1,
  }));
}

const f = Math.fround;
const gridStart = (n: number) => 16 + 20 * n + 4 + 72 * n;

/** The grid section parsed independently of the module. */
function parseGrid(b: Uint8Array, n: number) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let at = gridStart(n);
  const i32 = () => { const x = v.getInt32(at, true); at += 4; return x; };
  const f32 = () => { const x = v.getFloat32(at, true); at += 4; return x; };
  const has = i32();
  if (!has) return { has, end: at };
  const max = [f32(), f32(), f32()];
  const min = [f32(), f32(), f32()];
  const neighbours = i32();
  const density = f32();
  const cells: number[][][] = [];
  const outer = i32();
  for (let a = 0; a < outer; a++) {
    const row: number[][] = [];
    const inner = i32();
    for (let c = 0; c < inner; c++) row.push(Array.from({ length: i32() }, i32));
    cells.push(row);
  }
  return { has, max, min, neighbours, density, cells, end: at };
}

/** Brute-force nearest-10 for a cell centre, on f32 positions, ties to the lower index. */
function brute(pts: { position: number[] }[], cx: number, cz: number): number[] {
  const d = (i: number) => (f(pts[i].position[0]) - cx) ** 2 + (f(pts[i].position[2]) - cz) ** 2;
  return pts.map((_, i) => i).sort((a, b) => d(a) - d(b) || a - b).slice(0, 10);
}

describe("fast_lane.ai format", () => {
  const pts = line(50);
  const b = writeFastLaneAi(pts);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);

  it("writes the header 7, count, 0, 0", () => {
    expect([0, 4, 8, 12].map((o) => v.getInt32(o, true))).toEqual([7, 50, 0, 0]);
  });

  it("writes 20-byte point records from offset 16: position, distance, id", () => {
    for (const i of [0, 1, 49]) {
      const o = 16 + i * 20;
      expect([v.getFloat32(o, true), v.getFloat32(o + 4, true), v.getFloat32(o + 8, true)]).toEqual(pts[i].position.map(f));
      expect(v.getFloat32(o + 12, true)).toBe(f(pts[i].distance));
      expect(v.getInt32(o + 16, true)).toBe(i);
    }
  });

  it("writes the extra count and 72-byte extra records in order", () => {
    const e0 = 16 + 50 * 20;
    expect(v.getInt32(e0, true)).toBe(50);
    for (const i of [0, 1, 33]) {
      const p = pts[i];
      const at = e0 + 4 + i * 72;
      const got = Array.from({ length: 18 }, (_, k) => v.getFloat32(at + k * 4, true));
      expect(got).toEqual([
        p.speed, p.gas, p.brake, 0, p.radius, p.sideLeft, p.sideRight, p.camber, p.direction,
        ...p.normal, p.length, ...p.forward, 0, p.grade,
      ].map(f));
      expect(got[8]).toBe(i % 2 ? -1 : 1);
    }
  });

  it("has the expected total size", () => {
    const g = aiGrid(pts);
    const gridBytes = 4 + 24 + 4 + 4 + 4 + g.cells.reduce((s, row) => s + 4 + row.reduce((t, c) => t + 4 + 4 * c.length, 0), 0);
    expect(b.length).toBe(gridStart(50) + gridBytes);
    expect(parseGrid(b, 50).end).toBe(b.length);
  });
});

describe("fast_lane.ai round trip", () => {
  it("brings back a 50-point line to f32 precision, including direction -1", () => {
    const pts = line(50, 2);
    const back = readFastLaneAi(writeFastLaneAi(pts));
    expect(back).toHaveLength(50);
    back.forEach((p, i) => {
      const q = pts[i];
      expect(p.position).toEqual(q.position.map(f));
      expect(p.normal).toEqual(q.normal.map(f));
      expect(p.forward).toEqual(q.forward.map(f));
      for (const k of ["distance", "speed", "gas", "brake", "radius", "sideLeft", "sideRight", "camber", "length", "grade"] as const) expect(p[k]).toBe(f(q[k]));
      expect(p.direction).toBe(q.direction);
    });
  });

  it("writes and reads an empty line", () => {
    const b = writeFastLaneAi([]);
    expect(b.length).toBe(16 + 4 + 4);
    expect(parseGrid(b, 0).has).toBe(0);
    expect(readFastLaneAi(b)).toEqual([]);
  });

  it("throws on a non-finite position", () => {
    const pts = line(5);
    pts[2].position[0] = NaN;
    expect(() => writeFastLaneAi(pts)).toThrow(/point 2/);
  });
});

describe("fast_lane.ai lookup grid", () => {
  it("writes max then min extremes with y 0, neighbours 10 and density 10", () => {
    const pts = line(50, 3);
    const g = parseGrid(writeFastLaneAi(pts), 50);
    const xs = pts.map((p) => f(p.position[0])), zs = pts.map((p) => f(p.position[2]));
    expect(g.max).toEqual([Math.max(...xs), 0, Math.max(...zs)]);
    expect(g.min).toEqual([Math.min(...xs), 0, Math.min(...zs)]);
    expect([g.neighbours, g.density]).toEqual([10, 10]);
  });

  it("counts cells as whole 10 m steps, at least one", () => {
    const at = (coords: [number, number][]) => aiGrid(coords.map(([x, z]) => ({ position: [x, 0, z] as [number, number, number] })));
    const g = at([[0, 0], [95, 31], [40, 10]]);
    expect(g.cells.length).toBe(9);
    expect(g.cells.every((r) => r.length === 3)).toBe(true);
    const s = at([[1, 1], [8, 9]]);
    expect([s.cells.length, s.cells[0].length]).toEqual([1, 1]);
    const one = at([[5, 5]]);
    expect(one.cells).toEqual([[[0]]]);
    const along = at([[-30, 7], [70, 7], [20, 7]]); // all on one line along X: one cell along Z
    expect([along.cells.length, along.cells[0].length]).toEqual([10, 1]);
    expect(along.min).toEqual([-30, 0, 7]);
  });

  it("lists the nearest min(10, n) points by horizontal distance, ties to the lower index (brute force, 2,000 points)", () => {
    const r = seeded(11);
    const pts: { position: [number, number, number] }[] = [];
    for (let i = 0; i < 2000; i++) {
      // a wandering line with repeats and exact duplicates, so ties happen
      const t = i * 0.37;
      pts.push({ position: [Math.round((Math.cos(t / 9) * 300 + t * 2) * 4) / 4, r() * 5, Math.round(Math.sin(t / 7) * 200 * 4) / 4] });
    }
    pts.push({ position: [...pts[0].position] }, { position: [...pts[500].position] });
    const g = aiGrid(pts);
    for (let a = 0; a < g.cells.length; a++) {
      for (let b = 0; b < g.cells[a].length; b++) {
        expect(g.cells[a][b]).toEqual(brute(pts, g.min[0] + (a + 0.5) * 10, g.min[2] + (b + 0.5) * 10));
      }
    }
  });

  it("lists every point when there are fewer than 10", () => {
    const g = aiGrid([{ position: [0, 0, 0] }, { position: [60, 0, 0] }, { position: [30, 0, 45] }]);
    for (const row of g.cells) for (const c of row) expect([...c].sort()).toEqual([0, 1, 2]);
  });

  it("stays fast: 8,000 points over 3 x 3 km", () => {
    const r = seeded(4);
    const pts = line(8000, 5).map((p, i) => ({ ...p, position: [r() * 3000, 0, (i / 8000) * 3000] as [number, number, number] }));
    const t0 = performance.now();
    writeFastLaneAi(pts);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

/** A hand-built version 7 file with Kunos-style non-zero lap time, sample count, lateral g and tag. */
function foreign(n: number, grid: boolean, opts: { version?: number; extra?: number; trailing?: number } = {}): Uint8Array {
  const words: [string, number][] = [["i", opts.version ?? 7], ["i", n], ["i", 93456], ["i", 1234]];
  for (let i = 0; i < n; i++) words.push(["f", i], ["f", 0], ["f", i * 2], ["f", i * 2], ["i", i]);
  words.push(["i", opts.extra ?? n]);
  for (let i = 0; i < (opts.extra ?? n); i++) {
    for (let k = 0; k < 18; k++) words.push(["f", k === 3 ? 0.9 : k === 16 ? 7 : k === 8 ? -1 : k + i]);
  }
  words.push(["i", grid ? 1 : 0]);
  if (grid) {
    words.push(["f", 3], ["f", 0], ["f", 6], ["f", 0], ["f", 0], ["f", 0], ["i", 10], ["f", 10], ["i", 1], ["i", 1], ["i", 2], ["i", 0], ["i", 1]);
  }
  for (let i = 0; i < (opts.trailing ?? 0); i++) words.push(["i", 0]);
  const b = new Uint8Array(words.length * 4);
  const v = new DataView(b.buffer);
  words.forEach(([t, x], i) => (t === "i" ? v.setInt32(i * 4, x, true) : v.setFloat32(i * 4, x, true)));
  return b;
}

describe("fast_lane.ai foreign files", () => {
  it("reads a file with non-zero lap time, sample count, lateral g and tag", () => {
    const pts = readFastLaneAi(foreign(4, true));
    expect(pts).toHaveLength(4);
    expect(pts[1]).toMatchObject({ position: [1, 0, 2], distance: 2, speed: 1, gas: 2, brake: 3, radius: 5, direction: -1, grade: 18 });
    expect(Object.keys(pts[1]).sort()).toEqual(["brake", "camber", "direction", "distance", "forward", "gas", "grade", "length", "normal", "position", "radius", "sideLeft", "sideRight", "speed"]);
  });

  it("reads a file with no grid", () => {
    expect(readFastLaneAi(foreign(3, false))).toHaveLength(3);
  });

  it("throws on other versions, a mismatched extra count, trailing bytes and truncation", () => {
    expect(() => readFastLaneAi(foreign(3, true, { version: 6 }))).toThrow(/version/);
    expect(() => readFastLaneAi(foreign(3, true, { version: 8 }))).toThrow(/version/);
    expect(() => readFastLaneAi(foreign(3, true, { extra: 2 }))).toThrow(/extra count/);
    expect(() => readFastLaneAi(foreign(3, true, { trailing: 1 }))).toThrow(/left over/);
    const good = foreign(3, true);
    expect(() => readFastLaneAi(good.subarray(0, good.length - 4))).toThrow();
    expect(() => readFastLaneAi(good.subarray(0, 40))).toThrow();
  });
});

describe("fast_lane.ai files the old writer made", () => {
  it("writes the fixture back byte for byte, and again", () => {
    const data = new Uint8Array(readFileSync("test/fixtures/ac/fast_lane_town.ai"));
    const pts = readFastLaneAi(data);
    for (let i = 1; i < pts.length; i++) expect(pts[i].distance).toBeGreaterThan(pts[i - 1].distance);
    for (const p of pts) expect(Math.hypot(...p.forward)).toBeCloseTo(1, 4);
    const w = writeFastLaneAi(pts);
    expect(Buffer.from(w).equals(Buffer.from(data))).toBe(true);
    expect(Buffer.from(writeFastLaneAi(readFastLaneAi(w))).equals(Buffer.from(w))).toBe(true);
  });

  it("scripts/check/ai_grid.py reads our grid as 10 m cells, neighbours 10, every cell filled", () => {
    let py: string;
    const dir = mkdtempSync(join(tmpdir(), "aigrid-"));
    const file = join(dir, "fast_lane.ai");
    writeFileSync(file, writeFastLaneAi(line(300, 9)));
    try {
      py = execFileSync("python3", ["-I", "scripts/check/ai_grid.py", file], { encoding: "utf8" });
    } catch {
      return; // no python here
    }
    expect(py).toMatch(/neighbours considered 10, sampling density 10/);
    const m = py.match(/; (\d+) cells, (\d+) with points/)!;
    expect(m[1]).toBe(m[2]);
    expect(py).toMatch(/0 bytes left over/);
  });
});

describe.skipIf(!HAVE_BUILD)("fast_lane.ai files in a real build", () => {
  it("reads every AI line; writing back keeps everything before the grid and the grid's shape", () => {
    const files = buildFiles((n) => n.endsWith("ai/fast_lane.ai"));
    expect(Object.keys(files).length).toBeGreaterThan(0);
    for (const [name, data] of Object.entries(files)) {
      const pts = readFastLaneAi(data);
      for (let i = 1; i < pts.length; i++) expect(pts[i].distance, name).toBeGreaterThanOrEqual(pts[i - 1].distance);
      for (const p of pts) expect(Math.hypot(...p.forward), name).toBeCloseTo(1, 3);
      const w = writeFastLaneAi(pts);
      const n = pts.length;
      expect(Buffer.from(w.subarray(0, gridStart(n))).equals(Buffer.from(data.subarray(0, gridStart(n)))), name).toBe(true);
      const a = parseGrid(data, n), b = parseGrid(w, n);
      expect([b.max, b.min, b.neighbours, b.density, b.cells!.length, b.cells![0].length]).toEqual([a.max, a.min, a.neighbours, a.density, a.cells!.length, a.cells![0].length]);
      // Cells may differ only where two points are within 1 mm of the same distance to the centre.
      for (let x = 0; x < a.cells!.length; x++) {
        for (let z = 0; z < a.cells![x].length; z++) {
          const ca = a.cells![x][z], cb = b.cells![x][z];
          if (ca.join() === cb.join()) continue;
          const cx = a.min![0] + (x + 0.5) * 10, cz = a.min![2] + (z + 0.5) * 10;
          const d = (i: number) => Math.hypot(pts[i].position[0] - cx, pts[i].position[2] - cz);
          ca.forEach((i, k) => { if (i !== cb[k]) expect(Math.abs(d(i) - d(cb[k])), `${name} cell ${x},${z}`).toBeLessThan(0.001); });
        }
      }
      expect(Buffer.from(writeFastLaneAi(readFastLaneAi(w))).equals(Buffer.from(w)), name).toBe(true);
    }
  }, 600_000);
});
