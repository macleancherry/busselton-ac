import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildSpecHouse, nearestRoof, type HouseSpec } from "../src/core/specHouse";
import { ROOF_COLOURS } from "../src/core/buildingStyles";

const spec = JSON.parse(readFileSync("scripts/blender/example_parts.json", "utf8")) as HouseSpec;

describe("spec houses", () => {
  // The street is to the south (-y): the house faces it.
  const h = buildSpecHouse(spec, { centre: [100, 50], toRoad: [0, -1], z: 3 }, "t");

  it("builds walls, roofs, doors and windows, and solid walls to hit", () => {
    expect(h.nodes.length).toBeGreaterThan(4);
    const solid = h.nodes.find((n) => n.name.startsWith("1WALL_SPECHOUSE"));
    expect(solid?.renderable).toBe(false);
    expect(h.nodes.some((n) => n.material === "window")).toBe(true);
    expect(h.facades.map((f) => f.layout)).toEqual(h.facades.map(() => "blank"));
  });

  it("faces its street: the spec's front (y = 0) is towards the road, its left on the viewer's left", () => {
    const main = h.footprints[0];
    const ys = main.map((p) => p[1]);
    // Block "main" runs y 5..18 back from the front: further from the road (larger y here) than "front" (y 0..8).
    const front = h.footprints[2];
    expect(Math.max(...ys)).toBeGreaterThan(Math.max(...front.map((p) => p[1])));
    // Seen from the street (looking north), the garage (spec x 0..6.4) is on the left: smaller x.
    const garage = h.footprints[1];
    expect(Math.max(...garage.map((p) => p[0]))).toBeLessThan(Math.max(...front.map((p) => p[0])));
    // Centred on its position.
    const xs = h.footprints.flat().map((p) => p[0]);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(100, 0);
  });

  it("puts the roof in the nearest Colorbond colour and every roof face looks up", () => {
    expect(ROOF_COLOURS[h.roofs[0]].name).toBe(ROOF_COLOURS[nearestRoof([85, 88, 91])].name);
    const roof = h.nodes.find((n) => n.material === `roof_${ROOF_COLOURS[h.roofs[0]].name}`)!;
    for (let i = 1; i < roof.normals.length; i += 3) expect(roof.normals[i]).toBeGreaterThan(0);
  });

  it("builds a yard: paving facing up, umbrellas, sails, flags, tables and a lettered sign facing the street", async () => {
    const { readFileSync } = await import("node:fs");
    const rr = JSON.parse(readFileSync("routes/landmarks/rocky_ridge.json", "utf8"));
    const y = buildSpecHouse(rr, { centre: [0, 0], toRoad: [0, 1], z: 2 }, "rr");
    expect(y.signs).toHaveLength(1);
    expect(y.signs[0].text).toBe("ROCKY RIDGE");
    const mats = y.nodes.map((n) => n.material);
    for (const m of ["paving0", "umbrella_f2f0ea", "sail_80868b", "flag_f4f4f2", "signboard0", "sign0"]) expect(mats.some((x) => x.endsWith(m))).toBe(true);
    const paving = y.nodes.find((n) => n.material.endsWith("paving0"))!;
    for (let i = 1; i < paving.normals.length; i += 3) expect(paving.normals[i]).toBeGreaterThan(0.99);
    // The sign's face looks at the road (+y here is north, toward the road; AC z is south).
    const face = y.nodes.find((n) => n.material.endsWith("_sign0"))!;
    expect(face.normals[2]).toBeLessThan(-0.99);
    // One-sided by default: one quad.
    expect(face.positions.length / 3).toBe(4);
  });

  describe("two-sided signs", () => {
    // Facing north (+y in map metres, AC -z): x across the face runs west to east.
    const base: HouseSpec = { blocks: [{ name: "post", x0: -0.2, x1: 0.2, y0: 0, y1: 0.4, roof: "none" }] };
    const at = (signs: HouseSpec["signs"]) => buildSpecHouse({ ...base, signs }, { centre: [0, 0], toRoad: [0, 1], z: 0 }, "p");
    const sign = { x0: -1.5, x1: 1.5, y: -0.13, z0: 6, z1: 7, text: "DRIVE THRU" };
    /** Each quad of the face: its normal's AC z, and the AC x where u = 0 and u = 1 (at v = 1, the bottom). */
    const quads = (n: { positions: number[]; normals: number[]; uvs: number[] }) => {
      const out: { nz: number; xAtU0: number; xAtU1: number }[] = [];
      for (let q = 0; q < n.positions.length / 12; q++) {
        const vs = [0, 1, 2, 3].map((j) => 4 * q + j);
        const bottom = vs.filter((v) => n.uvs[2 * v + 1] === 1);
        const x = (u: number) => n.positions[3 * bottom.find((v) => n.uvs[2 * v] === u)!];
        out.push({ nz: n.normals[3 * vs[0] + 2], xAtU0: x(0), xAtU1: x(1) });
      }
      return out;
    };

    it("letters the back too, reading the right way from behind", () => {
      const h2 = at([{ ...sign, back: true }]);
      const face = h2.nodes.find((n) => n.material === "spec_p_sign0")!;
      const [front, back] = quads(face as never);
      expect(quads(face as never)).toHaveLength(2);
      // The front looks at the road (north: map +y, AC -z); a viewer there looks south, their left
      // (u = 0) is east, larger x.
      expect(front.nz).toBeLessThan(-0.99);
      expect(front.xAtU0).toBeGreaterThan(front.xAtU1);
      // The back looks south (AC +z); a viewer there looks north, their left is west, so u = 0 is
      // there: the same text, not mirrored.
      expect(back.nz).toBeGreaterThan(0.99);
      expect(back.xAtU0).toBeLessThan(back.xAtU1);
      expect(back.xAtU0).toBeCloseTo(front.xAtU1, 5);
    });

    // AC z here is the spec's y less its centre (0.2, the post's middle).
    const zs = (h: ReturnType<typeof at>) => h.nodes.find((n) => n.material === "spec_p_sign0")!.positions.filter((_, i) => i % 3 === 2);

    it("puts the back face just behind the board, or behind a cabinet at backY on its own board", () => {
      const one = at([{ ...sign, back: true }]);
      const cab = at([{ ...sign, back: true, backY: 0.5 }]);
      // Front 1 cm before the board; back 1 cm behind it (board 8 cm thick), or behind the cabinet's board.
      expect(Math.min(...zs(one))).toBeCloseTo(-0.14 - 0.2, 5);
      expect(Math.max(...zs(one))).toBeCloseTo(-0.13 + 0.09 - 0.2, 5);
      expect(Math.max(...zs(cab))).toBeCloseTo(0.5 + 0.09 - 0.2, 5);
      const board = (h: typeof cab) => h.nodes.find((n) => n.material.endsWith("signboard0"))!.positions.length;
      expect(board(cab)).toBeGreaterThan(board(one));
    });

    it("shares one texture between both faces: no extra sign entries", () => {
      const one = at([sign, { ...sign, z0: 5, z1: 5.8, text: "OPEN" }]);
      const two = at([{ ...sign, back: true }, { ...sign, z0: 5, z1: 5.8, text: "OPEN", back: true, backY: 0.5 }]);
      expect(two.signs).toEqual(one.signs);
      expect(two.signs.map((s) => s.name)).toEqual(["spec_p_sign0", "spec_p_sign1"]);
    });

    it("is on for the four roadside pylons", () => {
      for (const f of ["pylon_mcdonalds", "pylon_hungry_jacks", "pylon_paradise_motor_inn", "pylon_busselton_motel"]) {
        const s = JSON.parse(readFileSync(`routes/landmarks/${f}.json`, "utf8")) as HouseSpec;
        expect(s.signs!.every((sg) => sg.back)).toBe(true);
        const h3 = buildSpecHouse(s, { centre: [0, 0], toRoad: [0, 1], z: 0 }, "x");
        for (const sg of h3.signs) {
          const nz = quads(h3.nodes.find((n) => n.material === sg.name) as never).map((q) => Math.sign(q.nz));
          expect(nz).toEqual([-1, 1]);
        }
      }
    });
  });
});

