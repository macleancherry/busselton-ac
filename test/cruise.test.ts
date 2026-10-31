import { describe, expect, it } from "vitest";
import { cruiseFiles, cruiseLayoutIni, cruiseSights, cruiseStreets, cruiseWorldIni, limitsByPercent } from "../src/core/cruise";
import type { AiPoint } from "../src/core/aiSpline";
import type { Vec2 } from "../src/core/geo";

const pt = (x: number, i: number): AiPoint => ({
  position: [x, 0, 0], distance: i * 2, speed: 10, gas: 1, brake: 0, radius: 1000, sideLeft: 3, sideRight: 3,
  camber: 0, direction: 1, normal: [0, 1, 0], length: 2, forward: [1, 0, 0], grade: 0,
});

/** A tiny ini reader, the same rules as the app's readIni. */
function readIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let sec = "";
  for (const line of text.split(/\r?\n/)) {
    const s = line.match(/^\s*\[(.*)\]\s*$/);
    if (s) { sec = s[1]; out[sec] ??= {}; continue; }
    const kv = line.match(/^\s*([\w]+)\s*=\s*(.*?)\s*$/);
    if (kv && sec) out[sec][kv[1]] = kv[2];
  }
  return out;
}

// A 400 m straight east along y = 0 (AC z = 0).
const ai = Array.from({ length: 200 }, (_, i) => pt(i * 2, i));
const line = (x0: number, x1: number, y = 0): Vec2[] => Array.from({ length: 11 }, (_, k) => [x0 + ((x1 - x0) * k) / 10, y]);

describe("cruise sights", () => {
  it("lists the landmarks the line passes, in order, and skips far ones", () => {
    const s = cruiseSights(ai, [
      { name: "Old Courthouse", at: [300, 20] },
      { name: "The Goose", at: [100, -10] },
      { name: "Far away", at: [200, 300] },
    ]);
    expect(s.map((x) => x.name)).toEqual(["The Goose", "Old Courthouse"]);
    expect(s[0].frac).toBeCloseTo(0.25, 2);
    expect(s[0].radius).toBe(40);
  });

  it("widens the tick radius for a landmark set back from the road", () => {
    const [s] = cruiseSights(ai, [{ name: "Big Hall", at: [200, 55] }]);
    expect(s.radius).toBe(65);
  });

  it("counts a landmark listed twice once", () => {
    expect(cruiseSights(ai, [{ name: "Jetty", at: [50, 5] }, { name: "Jetty", at: [52, 5] }])).toHaveLength(1);
  });

  it("makes every landmark a sight in free roam, with no lap position", () => {
    const s = cruiseSights([], [{ name: "A", at: [500, 0] }, { name: "B", at: [10, 10] }]);
    expect(s.map((x) => x.name)).toEqual(["B", "A"]);
    expect(s.every((x) => x.frac === -1)).toBe(true);
  });
});

describe("cruise streets", () => {
  it("splits the route by name and limit, and keeps named side streets", () => {
    const pts = line(0, 100);
    const names = ["Queen St", "Queen St", "Queen St", "Queen St", "Queen St", "Queen St", undefined, undefined, "Kent St", "Kent St", "Kent St"];
    const limits = [50, 50, 50, 40, 40, 40, 50, 50, 50, 50, 50];
    const st = cruiseStreets({ pts, names, limits }, [
      { pts: line(0, 50, 30), name: "Albert St", cls: "residential" },
      { pts: line(0, 50, 60), name: "Car park", service: "parking_aisle" },
      { pts: line(0, 50, 90), name: "Bussell Hwy", cls: "trunk" },
      { pts: line(0, 50, 120) },
    ], 50);
    expect(st.map((s) => [s.name, s.limit])).toEqual([
      ["Queen St", 50], ["Queen St", 40], ["Kent St", 50], ["Albert St", 50], ["Bussell Hwy", undefined],
    ]);
    // The two Queen St runs meet with no gap; straight lines simplify to their ends.
    expect(st[0].pts[st[0].pts.length - 1]).toEqual(st[1].pts[0]);
    expect(st[3].pts).toHaveLength(2);
  });
});

describe("cruise files", () => {
  it("writes the world file in AC coordinates", () => {
    const ini = readIni(cruiseWorldIni(
      [{ name: "The Goose", at: [100, -10] }, { name: "The Goose", at: [101, -10] }],
      [{ name: "Queen St", pts: [[0, 0], [100, 50]], limit: 50 }],
    )!);
    expect(ini.CRUISE).toEqual({ LANDMARKS: "1", STREETS: "1" });
    expect(ini.LANDMARK_0).toEqual({ NAME: "The Goose", POSITION: "100.0, 10.0" });
    expect(ini.STREET_0).toEqual({ NAME: "Queen St", LIMIT: "50", POINTS: "0,0,100,-50" });
  });

  it("writes nothing without landmarks or street names", () => {
    expect(cruiseWorldIni([], [])).toBeNull();
    expect(cruiseFiles("t", "T", { ai, closed: false, landmarks: [], route: { pts: line(0, 100), names: [] }, streets: [] })).toEqual({});
  });

  it("writes the layout file: sights, lap position and limits", () => {
    const sights = cruiseSights(ai, [{ name: "Jetty [east]", at: [100, -10] }]);
    const limits = limitsByPercent(ai, (d) => (d < 200 ? 50 : 40));
    const ini = readIni(cruiseLayoutIni("Town loop", { closed: true, length: 400, sights, limits }));
    expect(ini.CRUISE.NAME).toBe("Town loop");
    expect(ini.CRUISE.CLOSED).toBe("1");
    expect(ini.CRUISE.SIGHTS).toBe("1");
    expect(ini.CRUISE.LIMITS.split(",")).toHaveLength(100);
    expect(ini.CRUISE.LIMITS.split(",")[0]).toBe("50");
    expect(ini.CRUISE.LIMITS.split(",")[99]).toBe("40");
    expect(ini.SIGHT_0).toEqual({ NAME: "Jetty east", POSITION: "100.0, 10.0", AT: "0.2500", RADIUS: "40" });
  });

  it("writes both files for a build", () => {
    const f = cruiseFiles("busselton", "Busselton", {
      ai, closed: false, landmarks: [{ name: "The Goose", at: [100, -10] }],
      route: { pts: line(0, 400), names: Array(11).fill("Marine Tce"), limits: Array(11).fill(50) },
      streets: [], limitAt: () => 50,
    });
    expect(Object.keys(f).sort()).toEqual(["busselton/data/cruise.ini", "busselton/extension/cruise.ini"]);
    const lay = readIni(new TextDecoder().decode(f["busselton/data/cruise.ini"]));
    expect(lay.CRUISE.LENGTH).toBe("400");
    expect(lay.SIGHT_0.NAME).toBe("The Goose");
  });
});

describe("cruise files in a build", () => {
  it("ships the world file in extension/ and the layout's file in its data/", { timeout: 60_000 }, async () => {
    const { buildTrack } = await import("../src/core/track");
    const { DemGrid } = await import("../src/core/elevation");
    const lat0 = -33.6, lng0 = 115.4;
    const mx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
    const ll = (x: number, y: number): [number, number] => [lng0 + x / mx, lat0 + y / 111_320];
    const route: [number, number][] = [];
    for (let x = 0; x <= 600; x += 20) route.push(ll(x, 0));
    const r = await buildTrack(route, {
      name: "Cruise", imageryZoom: 0, corridor: 30, horizon: 0, trees: 0, buildings: false, origin: ll(300, 0), layout: "town",
    }, {
      dem: async (proj, bounds, z) => DemGrid.fromFunction(proj, z, bounds, () => 10).sample, widthAt: () => 7,
      landmarks: [{ name: "The Goose", at: ll(200, 20) }, { name: "Far Hall", at: ll(300, 500) }],
    });
    const world = readIni(new TextDecoder().decode(r.files[`${r.slug}/extension/cruise.ini`]));
    expect(world.CRUISE.LANDMARKS).toBe("2");
    const lay = readIni(new TextDecoder().decode(r.files[`${r.slug}/town/data/cruise.ini`]));
    expect(lay.CRUISE.SIGHTS).toBe("1");
    expect(lay.SIGHT_0.NAME).toBe("The Goose");
    expect(lay.CRUISE.LIMITS.split(",")).toHaveLength(100);
  });
});
