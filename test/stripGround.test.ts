// The ground under the verge concrete is the nature strip as the kerb module builds it, laid back at
// driveways (footpaths.ts stripGround, kerbs.ts stripRise). Cape Naturaliste: a footpath crossing a
// driveway stood up to 13 cm over the laid-back strip when the ground was "road edge plus a kerb".
import { describe, expect, it } from "vitest";
import { buildVergeConcrete, laybacks, stripGround, type VergeConcrete } from "../src/core/footpaths";
import { buildKerbs, KERB_BACK, KERB_H, LAYBACK, STRIP_EXTRA, stripRise } from "../src/core/kerbs";
import { withDefaults } from "../src/core/options";
import { SegmentIndex, type RoadPlan, type RoadSample } from "../src/core/road";
import { topSurface } from "../src/core/sceneGround";

const W = 7;
/** A straight road east along y = 0, climbing 8 % and falling 3 % to the right, a sample every 2 m. */
function hill(length = 60): RoadPlan {
  const samples: RoadSample[] = [];
  for (let s = 0; s <= length; s += 2) samples.push({ pos: [s, 0], tan: [1, 0], left: [0, 1], curvature: 0, s, width: W, h: 0.08 * s, bank: 0.03, kerb: [1, 1] });
  return { closed: false, samples, length, roundabouts: [] };
}

describe("stripRise", () => {
  const vw = 2.5;
  it("is the kerb top at the kerb's back and the strip's rise at its outer edge", () => {
    expect(stripRise(1, 0, KERB_BACK, vw)).toBeCloseTo(KERB_H, 6);
    expect(stripRise(1, 0, vw + STRIP_EXTRA, vw)).toBeCloseTo(KERB_H + 0.02, 6);
    expect(stripRise(1, 0, 99, vw)).toBeCloseTo(KERB_H + 0.02, 6);
  });
  it("comes down at a driveway layback", () => {
    expect(stripRise(1, 1, KERB_BACK, vw)).toBeCloseTo(KERB_H * (1 - LAYBACK), 6);
    expect(stripRise(1, 1, 2, vw)).toBeLessThan(stripRise(1, 0, 2, vw) - 0.05);
  });
});

describe("stripGround", () => {
  const plan = hill();
  const n = plan.samples.length;
  const opts = withDefaults({ banking: false });
  const index = new SegmentIndex(plan);
  const kerbs: [number[], number[]] = [plan.samples.map(() => 1), plan.samples.map(() => 1)];
  const left = new Array(n).fill(null), right = new Array(n).fill(null);
  for (let i = 2; i <= 25; i++) left[i] = { d0: 0.8, d1: 2.2 };
  const verge: VergeConcrete = { paths: [left, right], drives: [{ i0: 10, i1: 13, side: 0, reach: opts.vergeWidth + STRIP_EXTRA }] };
  const drops = laybacks(n, verge);
  const strip = topSurface(buildKerbs(plan, opts, kerbs, () => ({ material: "grass", photo: false }), undefined, drops).strip);
  const beyond = () => -100;
  const under = stripGround(plan, index, opts.crown, opts.vergeWidth, kerbs, drops, beyond);
  const outer = opts.vergeWidth + STRIP_EXTRA;

  it("matches the built strip mesh, laybacks and all", () => {
    let checked = 0, laidBack = 0;
    for (let x = 1; x < 59; x += 0.37) {
      // Where a layback starts or ends inside a span the mesh's quad is two triangles and the rule
      // a bilinear blend: close, not exact (track.ts reads the mesh itself there).
      const r = Math.floor(x / 2), changes = drops[0][r] !== drops[0][r + 1];
      for (const side of [1, -1]) {
        for (let d = KERB_BACK + 0.05; d < outer - 0.05; d += 0.29) {
          const y = side * (W / 2 + d);
          const h = strip(x, y);
          if (h === null) continue;
          expect(Math.abs(under(x, y) - h)).toBeLessThan(side === 1 && changes ? 0.03 : 0.002);
          if (side === 1 && drops[0][r] && drops[0][r + 1] && d < 1) {
            // The road edge on the left: climbing 8 %, 3 % crossfall up to it, less the crown.
            const edge = 0.08 * x + (0.03 - opts.crown) * (W / 2);
            expect(h - edge).toBeLessThan(KERB_H - 0.03);
            laidBack++;
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(laidBack).toBeGreaterThan(20);
  });

  it("is the fallback past the strip", () => {
    expect(under(30, W / 2 + outer + 0.5)).toBe(-100);
  });

  // As track.ts passes it: the strip mesh where it reaches, the rule elsewhere.
  const meshFirst = (x: number, y: number) => strip(x, y) ?? under(x, y);

  for (const [name, g, slack] of [["the strip mesh", meshFirst, 0], ["the strip rule", under, 0.025]] as const) {
    it(`keeps a footpath crossing a driveway about 4 cm over the strip, on ${name}`, () => {
      const paths = buildVergeConcrete(plan, verge, g).filter((m) => m.name.startsWith("1STREET_PATH_"));
      const top = topSurface(paths);
      let hi = -Infinity, lo = Infinity, seen = 0;
      for (let x = 4.1; x < 50; x += 0.25) {
        for (let d = 0.85; d < 2.15; d += 0.1) {
          const y = W / 2 + d;
          const p = top(x, y), s = strip(x, y);
          if (p === null || s === null) continue;
          hi = Math.max(hi, p - s);
          lo = Math.min(lo, p - s);
          seen++;
        }
      }
      expect(seen).toBeGreaterThan(500);
      // It was 13 cm over the strip at the layback with the old "road edge plus a kerb" ground.
      expect(hi).toBeLessThan(0.05 + slack);
      expect(lo).toBeGreaterThan(0.025 - slack);
    });
  }

  it("crossovers start 5 mm over the laid-back kerb and stay on the strip", () => {
    const [dr] = buildVergeConcrete(plan, verge, meshFirst).filter((m) => m.name.startsWith("1STREET_DRIVE_"));
    const top = topSurface([dr]);
    for (let x = 20.1; x < 26; x += 0.3) {
      for (let d = KERB_BACK + 0.02; d < outer - 0.02; d += 0.2) {
        const y = W / 2 + d;
        const p = top(x, y), s = strip(x, y);
        if (p === null || s === null) continue;
        expect(p - s).toBeGreaterThan(0.003);
        expect(p - s).toBeLessThan(0.042);
      }
    }
  });
});
