import { describe, expect, it } from "vitest";
import type { Kn5MeshNode } from "../src/core/kn5";
import { arrowGlyph, buildMarkings, planCentreLine, symbolGlyph, textGlyph, type DiscreteMark } from "../src/core/markings";
import { DEFAULT_OPTIONS } from "../src/core/options";
import type { ImageLine } from "../src/core/paintLines";
import { closeGaps, dropStubs } from "../src/core/runs";
import { planFrom, ring, straight } from "./planFixture";

const opts = { ...DEFAULT_OPTIONS, crown: 0.02 };

/** Vertices in local terms: x east, height, north (AC is x, height, minus north). */
function verts(m: Kn5MeshNode) {
  const out: { x: number; h: number; n: number; v: number }[] = [];
  for (let i = 0; i < m.positions.length / 3; i++) out.push({ x: m.positions[i * 3], h: m.positions[i * 3 + 1], n: -m.positions[i * 3 + 2], v: m.uvs[i * 2 + 1] });
  return out;
}

/** Connected pieces of paint (each stripe or patch has its own vertices): x and north extents. */
function pieces(m: Kn5MeshNode) {
  const vs = verts(m);
  const parent = vs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let k = 0; k < m.indices.length; k += 3) {
    const a = find(m.indices[k]);
    parent[find(m.indices[k + 1])] = a;
    parent[find(m.indices[k + 2])] = a;
  }
  const groups = new Map<number, number[]>();
  vs.forEach((_, i) => {
    const r = find(i);
    groups.set(r, [...(groups.get(r) ?? []), i]);
  });
  return [...groups.values()].map((ids) => {
    const p = ids.map((i) => vs[i]);
    const xs = p.map((q) => q.x), ns = p.map((q) => q.n);
    return { x0: Math.min(...xs), x1: Math.max(...xs), n0: Math.min(...ns), n1: Math.max(...ns), nMid: ns.reduce((a, b) => a + b, 0) / ns.length };
  });
}

const white = (ms: Kn5MeshNode[]) => ms.filter((m) => /^MARKINGS_\d+$/.test(m.name));
const allPieces = (ms: Kn5MeshNode[]) => white(ms).flatMap(pieces);

/** A straight with an 8 m parabolic hump centred at s = 750 (300 m long). */
const hump = () => straight(1500, { h: (_, s) => 8 * Math.max(0, 1 - ((s - 750) / 150) ** 2) });

/** 300 m straight east, a 90 degree left bend of 60 m radius, 300 m straight north. */
function bend() {
  const pts: [number, number][] = [];
  for (let x = 0; x < 300; x += 2) pts.push([x, 0]);
  const arc = (Math.PI / 2) * 60;
  for (let d = 0; d < arc; d += 2) {
    const a = d / 60;
    pts.push([300 + 60 * Math.sin(a), 60 - 60 * Math.cos(a)]);
  }
  for (let y = 60; y <= 360; y += 2) pts.push([360, y]);
  return planFrom(pts);
}

describe("centre line plan", () => {
  it("allows overtaking on a flat straight", () => {
    const c = planCentreLine(straight(1500));
    expect(c.barrierFwd.some(Boolean)).toBe(false);
    expect(c.barrierBack.some(Boolean)).toBe(false);
  });

  it("puts a barrier before a crest for forward traffic and after it for backward", () => {
    const c = planCentreLine(hump());
    const at = (s: number) => Math.round(s / 2);
    expect(c.barrierFwd[at(650)]).toBe(true);
    expect(c.barrierBack[at(850)]).toBe(true);
    expect(c.barrierFwd[at(100)] || c.barrierBack[at(100)]).toBe(false);
    expect(c.barrierFwd[at(1400)] || c.barrierBack[at(1400)]).toBe(false);
  });

  it("puts a barrier through a blind bend", () => {
    const plan = bend();
    const c = planCentreLine(plan);
    const inBend = plan.samples.map((s, i) => ({ s, i })).filter(({ s }) => s.s > 310 && s.s < 384);
    expect(inBend.some(({ i }) => c.barrierFwd[i] || c.barrierBack[i])).toBe(true);
  });

  it("tidies: a 30 m gap fills, a 20 m isolated run drops (2 m samples)", () => {
    const on = new Array(200).fill(false);
    for (let i = 10; i < 40; i++) on[i] = true;
    for (let i = 55; i < 90; i++) on[i] = true; // 15 samples (30 m) gap
    for (let i = 150; i < 160; i++) on[i] = true; // 10 samples (20 m)
    closeGaps(on, false, Math.round(40 / 2));
    dropStubs(on, false, Math.round(30 / 2));
    expect(on.slice(10, 90).every(Boolean)).toBe(true);
    expect(on.slice(140, 170).some(Boolean)).toBe(false);
  });
});

describe("buildMarkings", () => {
  it("paints on the road surface with normals up", () => {
    const ms = buildMarkings(straight(600, { h: () => 100 }), opts);
    expect(ms.length).toBeGreaterThan(0);
    for (const m of white(ms)) {
      expect(m.castShadows).toBe(false);
      expect(m.material).toBe("paint");
      for (const v of verts(m)) {
        expect(v.h).toBeGreaterThan(99.9);
        expect(v.h).toBeLessThan(100.03);
      }
      for (let i = 0; i < m.normals.length; i += 3) expect(m.normals[i + 1]).toBeCloseTo(1, 6);
    }
    expect(white(ms).length).toBeGreaterThan(0);
  });

  it("paints nothing on a 4 m road", () => {
    expect(buildMarkings(straight(600, { width: 4 }), opts)).toEqual([]);
  });

  it("puts edge lines at width / 2 - 0.2, except where edgeGap says", () => {
    const plan = straight(600);
    const both = allPieces(buildMarkings(plan, opts)).filter((p) => p.x1 - p.x0 > 100);
    expect(both.some((p) => Math.abs(p.nMid - 3.3) < 0.01)).toBe(true);
    expect(both.some((p) => Math.abs(p.nMid + 3.3) < 0.01)).toBe(true);
    const gap = allPieces(buildMarkings(plan, opts, undefined, (side) => side === 1));
    expect(gap.some((p) => p.n1 > 3)).toBe(false);
    expect(gap.some((p) => Math.abs(p.nMid + 3.3) < 0.01)).toBe(true);
  });

  it("breaks the dividing line at [12k, 12k + 3), in phase across barrier changes", () => {
    const ps = allPieces(buildMarkings(hump(), opts));
    const dashes = ps.filter((p) => Math.abs(p.nMid) < 0.12 && p.x1 - p.x0 < 3.01);
    expect(dashes.length).toBeGreaterThan(50);
    // Dashes at t = 0 and at +-0.1 (beside a barrier line) both exist.
    expect(dashes.some((p) => Math.abs(p.nMid) < 0.01)).toBe(true);
    expect(dashes.some((p) => Math.abs(Math.abs(p.nMid) - 0.1) < 0.01)).toBe(true);
    for (const d of dashes) {
      const k = Math.floor((d.x0 + 1e-6) / 12);
      expect(d.x0).toBeGreaterThanOrEqual(12 * k - 1e-6);
      expect(d.x1).toBeLessThanOrEqual(12 * k + 3 + 1e-6);
    }
  });

  it("paints a one-sided barrier on the restricted traffic's side before and after a crest", () => {
    const humpPs = allPieces(buildMarkings(hump(), opts)).filter((p) => p.x1 - p.x0 > 10 && Math.abs(p.nMid) < 0.2);
    const covers = (t: number, s: number) => humpPs.some((p) => Math.abs(p.nMid - t) < 0.01 && p.x0 < s && p.x1 > s);
    expect(covers(0.1, 650)).toBe(true); // forward traffic (on the left) may not overtake
    expect(covers(-0.1, 650)).toBe(false);
    expect(covers(-0.1, 850)).toBe(true);
    expect(covers(0.1, 850)).toBe(false);
  });

  it("finds two barrier lines at +-0.1 where both directions are blind", () => {
    const plan = bend();
    const ms = buildMarkings(plan, opts);
    const vs = white(ms).flatMap(verts);
    // In the bend, measure offsets from the centreline at each vertex's nearest sample.
    const offs = vs.map((v) => {
      let best = Infinity, t = 0;
      for (const s of plan.samples) {
        const d = Math.hypot(v.x - s.pos[0], v.n - s.pos[1]);
        if (d < best) { best = d; t = (v.x - s.pos[0]) * s.left[0] + (v.n - s.pos[1]) * s.left[1]; }
      }
      return t;
    }).filter((_, k) => vs[k].v > 320 && vs[k].v < 370);
    expect(offs.some((t) => Math.abs(t - 0.15) < 0.02)).toBe(true);
    expect(offs.some((t) => Math.abs(t + 0.15) < 0.02)).toBe(true);
    expect(offs.some((t) => Math.abs(t) < 0.02)).toBe(false); // no broken line at t = 0 there
  });

  it("draws photo lines where they were read: dashes in phase, yellow in its own mesh", () => {
    const plan = straight(300);
    const n = plan.samples.length;
    const lines: ImageLine[] = [
      { i0: 0, i1: n - 1, t: new Array(n).fill(1.5), kind: "dash", phase: 4, colour: "white" },
      { i0: 0, i1: n - 1, t: new Array(n).fill(-1.5), kind: "solid", phase: 0, colour: "yellow" },
    ];
    const ms = buildMarkings(plan, opts, undefined, undefined, { lines, covered: () => true });
    const dashes = allPieces(ms).filter((p) => Math.abs(p.nMid - 1.5) < 0.01);
    expect(dashes.length).toBeGreaterThan(20);
    for (const d of dashes) {
      const k = Math.floor((d.x0 - 4 + 1e-6) / 12);
      expect(d.x0).toBeGreaterThanOrEqual(4 + 12 * k - 1e-6);
      expect(d.x1).toBeLessThanOrEqual(7 + 12 * k + 1e-6);
    }
    const y = ms.find((m) => m.name.startsWith("MARKINGS_Y_"));
    expect(y?.name).toBe("MARKINGS_Y_000");
    expect(y?.material).toBe("paint_yellow");
    expect(ms.some((m) => m.name.startsWith("RRPM"))).toBe(false); // covered: none generated
  });

  it("places RRPMs every 24 m, not in skipped stretches or on narrow roads", () => {
    const count = (ms: Kn5MeshNode[]) => ms.filter((m) => m.name.startsWith("RRPM_")).reduce((a, m) => a + m.positions.length / 3 / 20, 0);
    const plan = straight(600);
    const ms = buildMarkings(plan, opts);
    let expected = 0;
    for (let d = 24; d < 600 - 12; d += 24) expected++;
    expect(count(ms)).toBe(expected);
    const rr = ms.find((m) => m.name === "RRPM_000")!;
    expect(rr.material).toBe("rrpm");
    for (let i = 0; i < rr.normals.length; i += 3) expect(Math.hypot(rr.normals[i], rr.normals[i + 1], rr.normals[i + 2])).toBeCloseTo(1, 5);
    expect(count(buildMarkings(plan, opts, (s) => s > 200 && s < 300))).toBe(expected - 4);
    expect(count(buildMarkings(straight(600, { width: 5 }), opts))).toBe(0);
  });

  it("drapes arrows on their lane, turned round for the other direction", () => {
    const plan = straight(600, { width: 14 });
    const img = { lines: [], covered: () => true };
    const left = white(buildMarkings(plan, opts, undefined, undefined, img, [{ s: 300, t: 2.1, kind: "arrow", shape: "left" }])).flatMap(verts);
    expect(left.length).toBeGreaterThan(0);
    for (const v of left) {
      expect(v.x).toBeGreaterThanOrEqual(296);
      expect(v.x).toBeLessThanOrEqual(304);
    }
    const x0 = Math.min(...left.map((v) => v.x));
    for (const v of left.filter((q) => q.x < x0 + 0.2)) expect(Math.abs(v.n - 1.75)).toBeLessThan(0.15);
    expect(Math.max(...left.map((v) => v.n))).toBeGreaterThan(2.25);

    const back = white(buildMarkings(plan, opts, undefined, undefined, img, [{ s: 300, t: -1.5, kind: "arrow", shape: "straight" }])).flatMap(verts);
    for (const v of back) expect(Math.abs(v.n + 1.75)).toBeLessThanOrEqual(0.45);
    const lo = Math.min(...back.map((v) => v.x));
    expect(lo).toBeCloseTo(297.5, 1); // the head's tip at the low-s end
    const wide = back.filter((v) => Math.abs(v.n + 1.75) > 0.3);
    expect(wide.length).toBeGreaterThan(0);
    for (const v of wide) expect(v.x).toBeLessThan(299.5);
  });

  it("drops glyphs it can't draw", () => {
    expect(arrowGlyph("u-turn")).toBeNull();
    expect(symbolGlyph("pedestrian")).toBeNull();
    const plan = straight(600, { width: 4 });
    expect(buildMarkings(plan, opts, undefined, undefined, undefined, [{ s: 300, t: 1, kind: "arrow", shape: "u-turn" }])).toEqual([]);
    const ms = buildMarkings(plan, opts, undefined, undefined, undefined, [
      { s: 300, t: 1, kind: "text", shape: "slow" },
      { s: 200, t: 1, kind: "arrow", shape: "u-turn" },
    ]);
    expect(ms.length).toBe(1);
  });
});

describe("glyphs", () => {
  it("textGlyph", () => {
    expect(textGlyph("keep clear now")).toBeNull();
    expect(textGlyph("slow!")).toBeNull();
    expect(textGlyph("")).toBeNull();
    const school = textGlyph("school")!;
    const cs = school.lines.flat().map((p) => p[1]);
    expect(Math.max(...cs) - Math.min(...cs)).toBeLessThanOrEqual(2.8 + 1e-9);
    const kc = textGlyph("keep-clear")!;
    expect(kc.length).toBe(7.5);
    expect(Math.max(...kc.lines.flat().map((p) => p[0]))).toBeCloseTo(7.5, 9);
    // Digit gap 0.35, letter gap 0.2: "40" is 2 W + 0.35 wide, "AB" 2 W + 0.2.
    const span = (g: ReturnType<typeof textGlyph>) => {
      const c = g!.lines.flat().map((p) => p[1]);
      return Math.max(...c) - Math.min(...c);
    };
    expect(span(textGlyph("40"))).toBeCloseTo(2 * 0.75 + 0.35, 6);
    expect(span(textGlyph("HH"))).toBeCloseTo(2 * 0.75 + 0.2, 6);
    expect(textGlyph("QUIZ")).not.toBeNull(); // the font has Q
  });

  it("symbolGlyph bicycle", () => {
    const g = symbolGlyph("bicycle")!;
    const cs = g.lines.flat().map((p) => p[1]);
    expect(Math.max(...cs) - Math.min(...cs)).toBeLessThan(1.5);
    expect(Math.max(...g.lines.flat().map((p) => p[0]))).toBeCloseTo(g.length, 9);
    expect(g.length).toBeCloseTo(1.824, 6);
  });
});

describe("transverse marks", () => {
  const plan = straight(600, { width: 4 }); // no generated lines; half = 1.8
  const mark = (d: DiscreteMark) => allPieces(buildMarkings(plan, opts, undefined, undefined, undefined, [d]));

  it("finish: two rows of alternating 0.5 m squares; start: a 0.4 m band right across", () => {
    const fin = mark({ s: 300, t: 0, kind: "finish" });
    expect(fin.length).toBe(8);
    for (const p of fin) expect(p.x1 - p.x0).toBeCloseTo(0.5, 3);
    const row0 = fin.filter((p) => p.x0 < 299.9).map((p) => p.n0).sort((a, b) => a - b);
    const row1 = fin.filter((p) => p.x0 > 299.9).map((p) => p.n0).sort((a, b) => a - b);
    expect(row0.map((n) => +n.toFixed(2))).toEqual([-1.8, -0.8, 0.2, 1.2]);
    expect(row1.map((n) => +n.toFixed(2))).toEqual([-1.3, -0.3, 0.7, 1.7]);
    const st = mark({ s: 300, t: 0, kind: "start" });
    expect(st.length).toBe(1);
    expect(st[0].x1 - st[0].x0).toBeCloseTo(0.4, 3);
    expect(st[0].n0).toBeCloseTo(-1.8, 3);
    expect(st[0].n1).toBeCloseTo(1.8, 3);
  });

  it("stop and give-way on the mark's side; zebra inside the road", () => {
    for (const p of mark({ s: 300, t: 1, kind: "stop" })) {
      expect(p.n0).toBeGreaterThanOrEqual(-1e-9);
      expect(p.n1).toBeLessThanOrEqual(1.8 + 1e-9);
    }
    const gw = mark({ s: 300, t: -1, kind: "giveway" });
    expect(gw.length).toBe(2);
    for (const p of gw) expect(p.n1).toBeLessThanOrEqual(-0.1 + 1e-9);
    const z = mark({ s: 300, t: 0, kind: "zebra" });
    expect(z.length).toBeGreaterThan(2);
    for (const p of z) {
      expect(p.n0).toBeGreaterThanOrEqual(-1.8 - 1e-9);
      expect(p.n1).toBeLessThanOrEqual(1.8 + 1e-9);
      expect(p.x1 - p.x0).toBeCloseTo(3, 3);
    }
  });
});

describe("loops and determinism", () => {
  it("paints across the seam of a loop", () => {
    const plan = ring(100);
    const ms = buildMarkings(plan, opts);
    const edge = white(ms).flatMap(verts).filter((v) => Math.hypot(v.x, v.n) > 103);
    expect(Math.min(...edge.map((v) => v.v))).toBeCloseTo(0, 3);
    expect(Math.max(...edge.map((v) => v.v))).toBeCloseTo(plan.length, 3);
    // The last section really reaches sample 0's position (x ~ 103.3, north ~ 0).
    expect(edge.some((v) => Math.abs(v.v - plan.length) < 1e-3 && Math.abs(v.n) < 0.2 && v.x > 103)).toBe(true);
  });

  it("is deterministic", () => {
    const plan = hump();
    const a = buildMarkings(plan, opts, undefined, undefined, undefined, [{ s: 400, t: 1, kind: "text", shape: "40" }]);
    const b = buildMarkings(plan, opts, undefined, undefined, undefined, [{ s: 400, t: 1, kind: "text", shape: "40" }]);
    expect(a.map((m) => m.name)).toEqual(b.map((m) => m.name));
    a.forEach((m, k) => expect(Array.from(m.positions)).toEqual(Array.from(b[k].positions)));
  });
});
