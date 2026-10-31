import { describe, expect, it } from "vitest";
import { Area } from "../src/core/area";
import { BACKDROP_CHUNK, backdropHeight, backdropSurface, buildBackdropChunk, planBackdrop } from "../src/core/backdrop";
import type { Kn5MeshNode } from "../src/core/kn5";
import { withDefaults } from "../src/core/options";
import { frames } from "../src/core/polyline";
import { SegmentIndex, type RoadPlan } from "../src/core/road";
import type { Vec2 } from "../src/core/geo";

/** A straight open route through the given points, samples every 2 m, flat at h. */
function straight(a: Vec2, b: Vec2, h = 0): RoadPlan {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.round(L / 2);
  const pts: Vec2[] = Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  return { closed: false, length: L, roundabouts: [], samples: frames(pts, false).map((f) => ({ ...f, width: 7, h, bank: 0 })) };
}

const ss = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

describe("horizon chunks", () => {
  const plan = straight([0, 0], [1000, 0]);
  const index = new SegmentIndex(plan);

  it("none when the horizon is off", () => {
    expect(planBackdrop(plan, index, withDefaults({ horizon: 0 }))).toEqual([]);
  });

  it("1 km squares on the 1 km grid, near the route, keyed south to north, west to east", () => {
    const opts = withDefaults({ horizon: 1500 });
    const chunks = planBackdrop(plan, index, opts);
    expect(chunks.length).toBeGreaterThan(0);
    chunks.forEach((c, i) => {
      expect(c.key).toBe("b" + String(i).padStart(3, "0"));
      expect(Math.abs(c.minX % BACKDROP_CHUNK)).toBe(0);
      expect(Math.abs(c.minY % BACKDROP_CHUNK)).toBe(0);
      expect(c.maxX - c.minX).toBe(BACKDROP_CHUNK);
      const cx = c.minX + 500, cy = c.minY + 500;
      expect(index.nearest(cx, cy, 1500 + 710)).not.toBeNull();
      if (i) {
        const p = chunks[i - 1];
        expect(c.minY > p.minY || (c.minY === p.minY && c.minX > p.minX)).toBe(true);
      }
    });
    // Every square that qualifies is there.
    let want = 0;
    for (let j = -3; j <= 2; j++) for (let i = -3; i <= 3; i++) if (index.nearest((i + 0.5) * 1000, (j + 0.5) * 1000, 2210)) want++;
    expect(chunks.length).toBe(want);
  });

  it("an area adds the squares near it", () => {
    const opts = withDefaults({ horizon: 1000 });
    const area = new Area([[0, 5000], [800, 5000], [800, 5800], [0, 5800]]);
    const chunks = planBackdrop(plan, index, opts, area);
    expect(chunks.some((c) => c.minY === 5000 && c.minX === 0)).toBe(true);
    for (const c of chunks) {
      const cx = c.minX + 500, cy = c.minY + 500;
      expect(index.nearest(cx, cy, 1710) !== null || area.signed(cx, cy) < 1710).toBe(true);
    }
  });
});

describe("horizon height", () => {
  const opts = withDefaults({ corridor: 60 });
  const index = {} as SegmentIndex;
  const cover = (x: number) => x;

  it("without the detailed ground: 3 m under the far DEM to the corridor, the DEM 300 m past it", () => {
    const dem = () => 6;
    for (const x of [0, 30, 60]) expect(backdropHeight(dem, index, opts, x, 0, cover)).toBeCloseTo(3);
    for (const x of [360, 500, 2000]) expect(backdropHeight(dem, index, opts, x, 0, cover)).toBeCloseTo(6);
    expect(backdropHeight(dem, index, opts, 210, 0, cover)).toBeCloseTo(6 - 3 * (1 - ss(0.5)));
  });

  it("held 3 m under the detailed ground near the corridor (far DEM 6 m, ground 2 m)", () => {
    const far = () => 6, detail = () => 2;
    expect(backdropHeight(far, index, opts, 10, 0, cover, detail)).toBeCloseTo(-1);
    expect(backdropHeight(far, index, opts, 60, 0, cover, detail)).toBeCloseTo(-1);
    expect(backdropHeight(far, index, opts, 500, 0, cover, detail)).toBeCloseTo(6);
    expect(backdropHeight(far, index, opts, 10, 0, cover)).toBeCloseTo(3);
    // 1 in 10 past the corridor, then easing out to the far DEM by corridor + 60.
    expect(backdropHeight(far, index, opts, 80, 0, cover, detail)).toBeCloseTo(1);
    const h100 = backdropHeight(far, index, opts, 100, 0, cover, detail);
    expect(h100).toBeGreaterThan(3);
    expect(h100).toBeLessThan(backdropHeight(far, index, opts, 100, 0, cover));
    expect(backdropHeight(far, index, opts, 121, 0, cover, detail)).toBeCloseTo(backdropHeight(far, index, opts, 121, 0, cover));
  });

  it("no jump along a line out from the corridor, even with the far DEM 7 m over the ground", () => {
    for (const farH of [4, 7]) {
      const far = () => 2 + farH, detail = () => 2;
      let prev = backdropHeight(far, index, opts, 0, 0, cover, detail);
      for (let x = 1; x <= 500; x++) {
        const h = backdropHeight(far, index, opts, x, 0, cover, detail);
        expect(Math.abs(h - prev)).toBeLessThan(0.2);
        prev = h;
      }
    }
  });
});

function upFacing(m: Kn5MeshNode) {
  const p = m.positions;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]];
    const ux = p[b * 3] - p[a * 3], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3], vz = p[c * 3 + 2] - p[a * 3 + 2];
    expect(uz * vx - ux * vz).toBeGreaterThan(0);
  }
}

describe("horizon chunk mesh", () => {
  const index = {} as SegmentIndex;
  const chunk = { key: "b004", minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const hills = (x: number, y: number) => 20 + 8 * Math.sin(x / 90) * Math.cos(y / 130);

  it("sits under the detailed ground wherever cover is inside the corridor", () => {
    const opts = withDefaults({ corridor: 60 });
    const cover = (x: number) => x - 500;
    const m = buildBackdropChunk(chunk, () => 6, index, opts, false, cover, () => 2)!;
    for (let k = 0; k < m.positions.length; k += 3) {
      if (cover(m.positions[k]) <= opts.corridor) expect(m.positions[k + 1]).toBeLessThanOrEqual(1);
    }
  });

  it("has a hole from 40 m inside the corridor, and none with a narrow corridor", () => {
    const cover = (x: number) => Math.abs(x - 500);
    const opts = withDefaults({ corridor: 90 });
    const m = buildBackdropChunk(chunk, hills, index, opts, false, cover)!;
    const xs = new Set<number>();
    for (let k = 0; k < m.positions.length; k += 3) xs.add(Math.round(m.positions[k]));
    // Drawn nodes are all beyond corridor - 40 = 50 m from the middle.
    for (const x of xs) expect(Math.abs(x - 500)).toBeGreaterThan(50);
    expect(xs.has(440)).toBe(true);
    expect(xs.has(560)).toBe(true);
    const narrow = buildBackdropChunk(chunk, hills, index, withDefaults({ corridor: 30 }), false, cover)!;
    expect(narrow.positions.length / 3).toBe(51 * 51);
  });

  it("names, materials, UVs, faces up, splits on the (i, j)-(i+1, j+1) diagonal", () => {
    const opts = withDefaults({ corridor: 60 });
    const cover = () => 5000;
    const m = buildBackdropChunk(chunk, hills, index, opts, true, cover)!;
    expect(m.name).toBe("BACKDROP_b004");
    expect(m.material).toBe("backdrop_b004");
    expect(m.castShadows).toBe(false);
    expect(m.positions.length / 3).toBeLessThanOrEqual(2601);
    upFacing(m);
    for (let i = 0; i < m.positions.length / 3; i++) {
      const z = m.positions[i * 3 + 2]; // AC z = -y
      if (Math.abs(-z - 1000) < 1e-6) expect(m.uvs[i * 2 + 1]).toBeCloseTo(0);
      if (Math.abs(z) < 1e-6) expect(m.uvs[i * 2 + 1]).toBeCloseTo(1);
    }
    // First quad's triangles share the (0,0)-(20,20) diagonal.
    const p = (v: number) => `${Math.round(m.positions[v * 3])},${Math.round(-m.positions[v * 3 + 2])}`;
    const t0 = [0, 1, 2].map((k) => p(m.indices[k])), t1 = [3, 4, 5].map((k) => p(m.indices[k]));
    expect(t0).toContain("0,0");
    expect(t0).toContain("20,20");
    expect(t1).toContain("0,0");
    expect(t1).toContain("20,20");
    const plain = buildBackdropChunk(chunk, hills, index, opts, false, cover)!;
    expect(plain.material).toBe("grass");
  });

  it("backdropSurface matches the mesh as drawn, and the node heights at nodes", () => {
    const opts = withDefaults({ corridor: 60 });
    const cover = (x: number, y: number) => Math.hypot(x - 300, y - 300);
    const detail = (x: number) => 15 + x * 0.002;
    const m = buildBackdropChunk(chunk, hills, index, opts, false, cover, detail)!;
    const surf = backdropSurface(hills, index, opts, cover, detail);
    const tris: number[][] = [];
    for (let t = 0; t < m.indices.length; t += 3) {
      tris.push([0, 1, 2].flatMap((k) => { const v = m.indices[t + k]; return [m.positions[v * 3], -m.positions[v * 3 + 2], m.positions[v * 3 + 1]]; }));
    }
    let checked = 0;
    for (let k = 0; k < 400; k++) {
      const x = (k * 137.31) % 1000, y = (k * 251.77) % 1000;
      for (const [x1, y1, h1, x2, y2, h2, x3, y3, h3] of tris) {
        const den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
        const w1 = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / den, w2 = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / den;
        const w3 = 1 - w1 - w2;
        if (w1 < -1e-9 || w2 < -1e-9 || w3 < -1e-9) continue;
        expect(Math.abs(surf(x, y) - (w1 * h1 + w2 * h2 + w3 * h3))).toBeLessThan(1e-3);
        checked++;
        break;
      }
    }
    expect(checked).toBeGreaterThan(300);
    for (const [x, y] of [[40, 60], [500, 500], [980, 20]]) {
      expect(surf(x, y)).toBeCloseTo(backdropHeight(hills, index, opts, x, y, cover, detail), 6);
    }
  });

  it("normals match at the shared border of two neighbouring chunks", () => {
    const opts = withDefaults({ corridor: 60 });
    const cover = () => 5000;
    const a = buildBackdropChunk(chunk, hills, index, opts, false, cover)!;
    const b = buildBackdropChunk({ key: "b005", minX: 1000, minY: 0, maxX: 2000, maxY: 1000 }, hills, index, opts, false, cover)!;
    const at = (m: Kn5MeshNode) => {
      const out = new Map<string, number[]>();
      for (let i = 0; i < m.positions.length / 3; i++) {
        if (Math.abs(m.positions[i * 3] - 1000) < 1e-6) out.set(String(Math.round(m.positions[i * 3 + 2])), Array.from(m.normals.subarray(i * 3, i * 3 + 3)));
      }
      return out;
    };
    const na = at(a), nb = at(b);
    expect(na.size).toBe(51);
    for (const [k, n] of na) n.forEach((c, i) => expect(c).toBeCloseTo(nb.get(k)![i], 5));
  });
});
