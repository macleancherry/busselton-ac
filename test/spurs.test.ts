import { describe, expect, it } from "vitest";
import type { LngLat, Vec2 } from "../src/core/geo";
import { rebuildWithout, trimSpurs } from "../src/core/spurs";

const LNG0 = 153.0, LAT0 = -27.5;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KY = 110574;
const ll = ([x, y]: Vec2): LngLat => [LNG0 + x / KX, LAT0 + y / KY];
const xy = ([lng, lat]: LngLat): Vec2 => [(lng - LNG0) * KX, (lat - LAT0) * KY];

/** A polyline through the corners with a point every 5 m, as lng/lat. */
function line(...corners: Vec2[]): LngLat[] {
  const out: Vec2[] = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1], b = corners[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(L / 5));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out.map(ll);
}

const local = (t: { coords: LngLat[] }) => t.coords.map(xy);
const len = (pts: Vec2[]) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

describe("trimSpurs", () => {
  it("cuts a start pin on the far carriageway", () => {
    const t = trimSpurs(line([10, 100], [10, 0], [0, 0], [0, 1000]), [ll([5, 0])]);
    expect(t.cut.length).toBe(1);
    const pts = local(t);
    expect(pts.every((p) => p[0] < 1)).toBe(true);
    expect(pts[0][1]).toBeGreaterThan(90);
    expect(pts[0][1]).toBeLessThan(130);
    expect(pts[pts.length - 1][1]).toBeCloseTo(1000, 0);
  });

  it("cuts an end pin on the far carriageway", () => {
    const t = trimSpurs(line([0, 0], [0, 600], [10, 600], [10, 500]), [ll([5, 600])]);
    expect(t.cut.length).toBe(1);
    const pts = local(t);
    expect(pts.every((p) => p[0] < 1)).toBe(true);
    const end = pts[pts.length - 1][1];
    expect(end).toBeGreaterThan(470);
    expect(end).toBeLessThan(510);
  });

  it("cuts a middle pin on the far side, reporting both U-turns as cut", () => {
    const turns = [ll([5, 400]), ll([5, 200])];
    const t = trimSpurs(line([0, 0], [0, 400], [10, 400], [10, 200], [0, 200], [0, 1000]), turns);
    expect(t.kept).toEqual([]);
    expect(t.cut).toEqual(turns);
    const pts = local(t);
    expect(pts.every((p) => p[0] < 1)).toBe(true);
    for (let i = 1; i < pts.length; i++) expect(pts[i][1]).toBeGreaterThan(pts[i - 1][1]);
    expect(len(pts)).toBeGreaterThan(990);
    expect(len(pts)).toBeLessThan(1010);
  });

  it("cuts a spur up a side street without cutting the corner", () => {
    const t = trimSpurs(line([0, -300], [0, 0], [-100, 0], [-100, 60], [-100, 0], [-400, 0]), [ll([-100, 60])]);
    expect(t.cut.length).toBe(1);
    const pts = local(t);
    expect(pts.some((p) => Math.hypot(p[0], p[1]) < 2)).toBe(true);
    expect(pts.every((p) => p[1] < 15)).toBe(true);
  });

  it("leaves a long out-and-back alone", () => {
    const coords = line([0, 0], [0, 600], [10, 600], [10, 0], [10, -500]);
    const u = ll([5, 600]);
    const t = trimSpurs(coords, [u]);
    expect(t.cut).toEqual([]);
    expect(t.kept).toEqual([u]);
    expect(t.coords).toBe(coords);
  });

  it("leaves a mountain hairpin with no U-turn alone", () => {
    const coords = line([0, 0], [0, 300], [6, 312], [12, 300], [12, 0]);
    expect(trimSpurs(coords, []).coords).toBe(coords);
    const far = ll([500, 500]);
    const t = trimSpurs(coords, [far]);
    expect(t.kept).toEqual([far]);
    expect(t.cut).toEqual([]);
    expect(t.coords).toBe(coords);
  });

  it("reports sorted ranges inside the route", () => {
    const coords = line([0, -300], [0, 0], [-100, 0], [-100, 60], [-100, 0], [-400, 0]);
    const total = len(coords.map(xy));
    const t = trimSpurs(coords, [ll([-100, 60])]);
    expect(t.ranges.length).toBe(1);
    for (const [a, b] of t.ranges) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(total + 1e-6);
      expect(b).toBeGreaterThan(a);
    }
    const two = trimSpurs(line([0, 0], [0, 400], [10, 400], [10, 200], [0, 200], [0, 1000]), [ll([5, 400])]);
    for (let i = 1; i < two.ranges.length; i++) expect(two.ranges[i][0]).toBeGreaterThanOrEqual(two.ranges[i - 1][0]);
    // A middle cut is bridged by one straight segment reaching J (at least 10 m) past each end of the range.
    const [a0, b0] = two.ranges[0];
    const pts = local(two);
    const longest = Math.max(...pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1])));
    expect(longest).toBeGreaterThanOrEqual(20);
    const bridge = pts.findIndex((p, i) => i > 0 && Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) === longest);
    // On this straight divided road arc length is y on the first leg and 420 + y on the last.
    expect(pts[bridge - 1][1]).toBeLessThanOrEqual(a0 - 10 + 1e-6);
    expect(pts[bridge][1] + 420).toBeGreaterThanOrEqual(b0 + 10 - 1e-6);
  });

  it("returns short routes unchanged", () => {
    const coords = [ll([0, 0]), ll([0, 100])];
    const u = [ll([0, 50])];
    const t = trimSpurs(coords, u);
    expect(t.coords).toBe(coords);
    expect(t.kept).toBe(u);
    expect(t.cut).toEqual([]);
    expect(t.ranges).toEqual([]);
  });

  it("widens before merging so the route never steps back (bug 2)", () => {
    const coords: LngLat[] = [];
    for (let x = 0; x <= 1000; x += 5) coords.push(ll([x, 0]));
    const pts = rebuildWithout(coords, [[400, 420], [425, 430]]).map(xy);
    for (let i = 1; i < pts.length; i++) expect(pts[i][0]).toBeGreaterThanOrEqual(pts[i - 1][0] - 1e-6);
    const gaps = pts.slice(1).map((p, i) => [pts[i][0], p[0]]).filter(([a, b]) => b - a > 5 + 1e-6);
    expect(gaps.length).toBe(1);
    expect(gaps[0][0]).toBeCloseTo(340, 3);
    expect(gaps[0][1]).toBeCloseTo(480, 3);
  });

  it("cuts nothing on a short route with arms alongside at both ends (bug 3)", () => {
    const short = line([0, 0], [0, 55], [10, 55], [10, 0]);
    expect(trimSpurs(short, [ll([5, 55])]).cut).toEqual([]);
    // A spur that would count as both the start and the end of a 130 m route.
    const both = line([-30, 0], [0, 0], [0, 30], [10, 30], [10, 0], [40, 0]);
    const t = trimSpurs(both, [ll([5, 30])]);
    expect(t.cut).toEqual([]);
    expect(t.coords).toBe(both);
  });
});
