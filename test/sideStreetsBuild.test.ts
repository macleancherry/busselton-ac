// Side streets, street names and street furniture on a whole build (docs/specs/old-build-tests.md, part C).

import { beforeAll, describe, expect, it } from "vitest";
import { buildTrack, type DataSources, type TrackResult } from "../src/core/track";
import { DemGrid } from "../src/core/elevation";
import { readKn5, type Kn5Material, type Kn5MeshNode, type Kn5Node } from "../src/core/kn5";
import type { ArtRequest } from "../src/core/art";
import type { LngLat } from "../src/core/geo";

const LNG = 116.2, LAT = -31.6;
const M_LNG = 111_320 * Math.cos((LAT * Math.PI) / 180), M_LAT = 111_320;
const p = (x: number, y: number): LngLat => [LNG + x / M_LNG, LAT + y / M_LAT];
const meshesOf = (n: Kn5Node): Kn5MeshNode[] => (n.kind === "mesh" ? [n] : n.children.flatMap(meshesOf));
/** Mesh vertices as local [east, north, up]. */
const verts = (m: Kn5MeshNode): [number, number, number][] =>
  Array.from({ length: m.positions.length / 3 }, (_, i) => [m.positions[i * 3], -m.positions[i * 3 + 2], m.positions[i * 3 + 1]]);

// The route runs east along y = 0 from x = -400 to 400, 7 m wide. Across it:
const T_X = -250;        // a minor street going north only (a T junction)
const CROSS_X = 120;     // a minor street both ways (a crossroads)
const MOTORWAY_X = 280;  // a motorway crossing (grade separated, not a junction)
const BRIDGE_X = -60;    // a minor street on a bridge
const HALF = 3.5;

describe("a straight road with side streets, names, shops and signs", () => {
  const asked: ArtRequest[] = [];
  let r: TrackResult;
  let meshes: Kn5MeshNode[];
  let materials: Kn5Material[];
  const starting = (prefix: string) => meshes.filter((m) => m.name.startsWith(prefix));

  beforeAll(async () => {
    const sources: DataSources = {
      dem: async (proj, bounds, zoom) => DemGrid.fromFunction(proj, zoom, bounds, () => 25).sample,
      streets: {
        lines: [
          { pts: [p(-400, 0), p(400, 0)], cls: "secondary" },
          { pts: [p(T_X, 0), p(T_X, 90)], cls: "minor" },
          { pts: [p(CROSS_X, -90), p(CROSS_X, 90)], cls: "minor" },
          { pts: [p(MOTORWAY_X, -90), p(MOTORWAY_X, 90)], cls: "motorway" },
          { pts: [p(BRIDGE_X, -90), p(BRIDGE_X, 90)], cls: "minor", brunnel: "bridge" },
        ],
        names: [
          { pts: [p(-400, 0), p(400, 0)], name: "Long Road" },
          { pts: [p(T_X, 4), p(T_X, 90)], name: "Quarry Lane" },
          { pts: [p(CROSS_X, -90), p(CROSS_X, 90)], name: "Mill Street" },
        ],
      },
      pois: [
        { at: p(20, 13), cls: "bus", subclass: "bus_stop" },
        { at: p(-330, -28), cls: "fuel", subclass: "fuel", name: "Hill Fuel" },
        { at: p(330, 22), cls: "cafe", subclass: "cafe", name: "Gumnut Cafe" },
      ],
      seen: [
        { at: p(-370, -7), value: "regulatory--stop--g1" },
        { at: p(-20, 8), value: "regulatory--maximum-speed-limit-60--g1" },
        { at: p(170, -13), value: "object--support--utility-pole" },
        { at: p(190, 1), value: "object--street-light" },
      ],
      renderArt: async (items) => {
        asked.push(...items);
        return {
          data: new Uint8Array([137, 80, 78, 71]),
          cells: Object.fromEntries(items.map((a, i) => [a.key, { u0: 0, v0: i / items.length, u1: 1, v1: (i + 1) / items.length, aspect: 3 }])),
        };
      },
    };
    const route = Array.from({ length: 41 }, (_, i) => p(i * 20 - 400, 0));
    r = await buildTrack(route, { name: "Side Streets", corridor: 60, horizon: 0, imageryZoom: 0, widthOverride: 2 * HALF }, sources);
    const kn5 = readKn5(r.files[`${r.slug}/${r.slug}.kn5`]);
    meshes = meshesOf(kn5.root);
    materials = kn5.materials;
  }, 300_000);

  it("builds the T junction and both arms of the crossroads, and nothing for the motorway or the bridge", () => {
    expect(r.stats.sideStreets).toBe(3);
    const streets = starting("1STREET_");
    expect(streets.length).toBeGreaterThan(0);
    for (const m of streets) {
      for (const [x] of verts(m)) {
        expect(Math.abs(x - MOTORWAY_X)).toBeGreaterThan(6);
        expect(Math.abs(x - BRIDGE_X)).toBeGreaterThan(6);
      }
    }
  });

  it("runs the side street up to the route's edge", () => {
    const touching = starting("1STREET_").some((m) => verts(m).some(([x, y]) => Math.abs(x - T_X) < 4 && Math.abs(y - HALF) < 0.25));
    expect(touching).toBe(true);
  });

  it("opens the verge where the T junction joins", () => {
    for (const m of starting("1GRASS_VERGE_")) {
      const v = verts(m);
      for (let t = 0; t < m.indices.length; t += 3) {
        const tri = [v[m.indices[t]], v[m.indices[t + 1]], v[m.indices[t + 2]]];
        const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
        if (cy > 0) expect(Math.abs(cx - T_X)).toBeGreaterThan(2.5);
      }
    }
  });

  it("puts name blades for both roads at each junction mouth", () => {
    const names = [...new Set(asked.filter((a) => a.kind === "street").map((a) => a.text))].sort();
    expect(names).toEqual(["Long Road", "Mill Street", "Quarry Lane"]);
    expect(r.stats.streetSigns).toBe(6);
    expect(materials.find((m) => m.name === "signart")?.shader).toBe("ksPerPixelAT");
  });

  it("asks for the stop, bus, speed and shop art, and builds the street furniture", () => {
    const keys = asked.map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["bus", "stop", "speed:60", "back"]));
    expect(keys.some((k) => k.startsWith("poi:fuel:Hill Fuel"))).toBe(true);
    expect(keys.some((k) => k.startsWith("poi:cafe:Gumnut Cafe"))).toBe(true);
    const names = meshes.map((m) => m.name);
    for (const group of ["FURNITURE_CANOPY_000", "FURNITURE_TIMBER_000", "FURNITURE_LAMP_000", "FURNITURE_SIGNART_000"]) {
      expect(names.some((n) => n === group || n.startsWith(`${group}_T`)), group).toBe(true);
    }
  });

  it("moves a street light seen on the road off it", () => {
    const steel = starting("FURNITURE_STEEL_");
    expect(steel.some((m) => verts(m).some(([x]) => Math.abs(x - 190) < 0.2))).toBe(true);
    for (const m of steel) {
      for (const [x, y, z] of verts(m)) if (Math.abs(x - 190) < 0.2 && z < 30) expect(Math.abs(y)).toBeGreaterThan(HALF);
    }
  });
});
