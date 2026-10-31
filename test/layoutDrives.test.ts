// Every layout's road is part of the world (layoutDrives.ts): Collie Motorplex's short layout takes
// a link the long layout skips, out past its corridor.
import { describe, expect, it } from "vitest";
import { Area, makeCover } from "../src/core/area";
import { LocalProjection, type Vec2 } from "../src/core/geo";
import { driveRings, layoutDriveLines, layoutDriveRings, type LayoutDrive } from "../src/core/layoutDrives";
import { withDefaults } from "../src/core/options";
import { planRoad, SegmentIndex } from "../src/core/road";
import { planSideStreets } from "../src/core/sideStreets";

const line = (a: Vec2, b: Vec2, step = 2): Vec2[] => {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Vec2);
};

describe("driveRings", () => {
  it("covers the drive and a corridor either side, round its bends and past its ends", () => {
    const pts = [...line([0, 0], [100, 0]), ...line([100, 0], [100, -100]).slice(1)];
    const area = new Area(driveRings(pts, 60));
    for (const p of pts) expect(area.signed(p[0], p[1])).toBeLessThan(-59);
    expect(area.inside(150, 50)).toBe(true); // the outside of the bend
    expect(area.inside(-50, 0)).toBe(true); // past the start
    expect(area.inside(0, 70)).toBe(false);
    expect(area.inside(200, -50)).toBe(false);
  });
});

describe("a layout leaving the main drive", () => {
  // The main drive along y = 0; the other layout leaves it at x = 100 for a link 150 m south, and
  // comes back at x = 400.
  const opts = withDefaults({ widthOverride: 10, banking: false, corridor: 60 });
  const plan = planRoad(line([0, 0], [600, 0], 4), opts);
  const index = new SegmentIndex(plan);
  const proj = new LocalProjection([116.2443, -33.4318]);
  const local: Vec2[] = [...line([0, 0], [100, 0]), ...line([100, 0], [150, -150]).slice(1), ...line([150, -150], [350, -150]).slice(1), ...line([350, -150], [400, 0]).slice(1), ...line([400, 0], [600, 0]).slice(1)];
  const drive: LayoutDrive = { coords: local.map((p) => proj.toLngLat(p)), raceway: true };

  it("used to leave the link out: past the corridor nothing is built", () => {
    const sp = planSideStreets(layoutDriveLines([drive]), [], plan, index, opts, proj, null);
    expect(sp.streets.some((st) => st.pts.some(([, y]) => y < -100))).toBe(false);
  });

  it("builds the link as a street, joined to the main drive at both ends, with ground round it", () => {
    const area = new Area(layoutDriveRings([drive], (p) => proj.toLocal(p), opts.corridor));
    const sp = planSideStreets(layoutDriveLines([drive]), [], plan, index, opts, proj, area);
    expect(sp.streets).toHaveLength(1);
    const st = sp.streets[0];
    expect(st.cls).toBe("raceway");
    expect(st.width).toBe(10);
    // All the way round the link (within 2 m of each of its points), but nowhere along the main drive.
    for (const p of local.filter(([, y]) => y < -10)) expect(Math.min(...st.pts.map((q) => Math.hypot(q[0] - p[0], q[1] - p[1])))).toBeLessThan(2.5);
    expect(st.pts.every(([x, y]) => y < -2 || (x > 90 && x < 420))).toBe(true);
    expect(sp.junctions).toHaveLength(2);
    // The ground: the link's middle is as far inside what's built as the main drive's centreline.
    const cover = makeCover(index, opts, area);
    expect(cover(250, -150)).toBeLessThan(1);
  });

  it("leaves non-raceway drives to the map's own streets (only the ground round them)", () => {
    expect(layoutDriveLines([{ ...drive, raceway: false }])).toEqual([]);
    expect(layoutDriveRings([{ ...drive, raceway: false }], (p) => proj.toLocal(p), 60).length).toBeGreaterThan(10);
    expect(layoutDriveRings(undefined, (p) => proj.toLocal(p), 60)).toEqual([]);
  });
});
