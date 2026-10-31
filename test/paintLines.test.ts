import { describe, expect, it } from "vitest";
import { findLines, paintCandidates, type Cand } from "../src/core/paintLines";
import type { RasterSampler } from "../src/core/trace";
import { ring, straight } from "./planFixture";

/** Small deterministic noise in -0.015..0.015 from a position. */
const noise = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (v - Math.floor(v) - 0.5) * 0.03;
};

const ASPHALT = 0.36;
const GRASS: [number, number, number] = [0.3, 0.45, 0.2];

/** A 7.5 m road along x: grass beyond +-3.75, and whatever `paint` says on top. */
function road(paint: (x: number, y: number) => [number, number, number] | null): RasterSampler {
  return (x, y) => {
    const p = paint(x, y);
    if (p) return p;
    if (Math.abs(y) > 3.75) return GRASS;
    const g = ASPHALT + noise(x, y);
    return [g, g, g];
  };
}

const WHITE: [number, number, number] = [0.85, 0.85, 0.85];
const standard = road((x, y) => {
  if (Math.abs(Math.abs(y) - 3.3) < 0.06) return WHITE;
  const m = ((x % 12) + 12) % 12;
  if (Math.abs(y) < 0.06 && m >= 4 && m < 7) return WHITE;
  return null;
});

const all = () => true;

describe("paintCandidates + findLines", () => {
  const plan = straight(400, { width: 7.5 });
  const lines = findLines(plan, paintCandidates(plan, standard, all), all);

  it("finds two solid edge lines and a dashed centre line", () => {
    expect(lines.length).toBe(3);
    const byT = [...lines].sort((a, b) => a.t[0] - b.t[0]);
    const mid = (l: (typeof lines)[number]) => l.t[Math.floor(l.t.length / 2)];
    expect(Math.abs(mid(byT[0]) + 3.3)).toBeLessThan(0.5);
    expect(byT[0].kind).toBe("solid");
    expect(Math.abs(mid(byT[1]))).toBeLessThan(0.5);
    expect(byT[1].kind).toBe("dash");
    expect(Math.abs(mid(byT[2]) - 3.3)).toBeLessThan(0.5);
    expect(byT[2].kind).toBe("solid");
    for (const l of lines) expect(l.colour).toBe("white");
  });

  it("reads the dash phase", () => {
    const centre = lines.find((l) => Math.abs(l.t[0]) < 0.5)!;
    expect(Math.abs(centre.phase - 4)).toBeLessThanOrEqual(0.6);
  });

  it("finds nothing where nothing is trusted", () => {
    const none = () => false;
    expect(paintCandidates(plan, standard, none)).toEqual([]);
    expect(findLines(plan, paintCandidates(plan, standard, none), none)).toEqual([]);
  });

  it("reads a yellow line as yellow", () => {
    const yellow = road((_, y) => (Math.abs(y - 1.5) < 0.06 ? [0.8, 0.65, 0.2] : null));
    const ls = findLines(plan, paintCandidates(plan, yellow, all), all);
    expect(ls.length).toBe(1);
    expect(ls[0].colour).toBe("yellow");
    expect(Math.abs(ls[0].t[0] - 1.5)).toBeLessThan(0.2);
  });

  it("ignores a shadow edge and a band too wide to be paint", () => {
    const shadow = road((_, y) => (y > 1 && Math.abs(y) < 3.75 ? [0.8, 0.8, 0.8] : null));
    expect(paintCandidates(plan, shadow, all)).toEqual([]);
    const wide = road((_, y) => (Math.abs(y - 1) < 0.3 ? WHITE : null));
    expect(paintCandidates(plan, wide, all)).toEqual([]);
  });
});

describe("findLines", () => {
  /** Candidates every 0.25 m at offset t where `on(s)`. */
  const cands = (s0: number, s1: number, t: number, on: (s: number) => boolean = () => true): Cand[] => {
    const out: Cand[] = [];
    for (let s = s0; s < s1 - 1e-9; s += 0.25) if (on(s)) out.push({ s, t, yellow: false });
    return out;
  };

  it("keeps one line where it was read twice, 0.6 m apart", () => {
    const plan = straight(120);
    const cs = [...cands(0, 70, 1.0), ...cands(50, 120, 1.6)].sort((a, b) => a.s - b.s);
    const ls = findLines(plan, cs, all);
    expect(ls.length).toBe(1);
  });

  it("leaves the caller's candidates alone", () => {
    const plan = straight(300);
    const cs = [...cands(0, 300, 1), ...cands(0, 300, -1)].reverse();
    const before = JSON.stringify(cs);
    findLines(plan, cs, all);
    expect(JSON.stringify(cs)).toBe(before);
  });

  it("calls a line covering 30% of rows a dash and 80% solid", () => {
    const plan = straight(300);
    const dash = findLines(plan, cands(0, 300, 1, (s) => s % 10 < 3), all);
    expect(dash.length).toBe(1);
    expect(dash[0].kind).toBe("dash");
    const solid = findLines(plan, cands(0, 300, 1, (s) => s % 10 < 8), all);
    expect(solid.length).toBe(1);
    expect(solid[0].kind).toBe("solid");
  });

  it("reads a loop right round, with no index covered twice", () => {
    const plan = ring(100);
    const n = plan.samples.length;
    const ls = findLines(plan, cands(0, plan.length, 1), all);
    const hits = new Array(n).fill(0);
    for (const l of ls) {
      expect(l.i0).toBeGreaterThanOrEqual(0);
      expect(l.i1).toBeLessThan(n);
      expect(l.t.length).toBe(l.i1 - l.i0 + 1);
      for (let i = l.i0; i <= l.i1; i++) hits[i]++;
    }
    expect(hits.every((h) => h === 1)).toBe(true);
  });
});
