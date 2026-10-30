import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildJettyTrain, carNode, carOffsets, carPose, jettyTrainConfig, jettyTrainLua, pathLength, pointAt, simplify, trainLength, trainPath, TRAIN_CARS,
} from "../src/core/jettyTrain";
import { extConfig } from "../src/core/cspConfig";
import type { Vec3 } from "../src/core/mesh";

// A line like the jetty's: 300 m north, then bending left 10 degrees, then 200 m more; a point a metre.
function jettyLine(): Vec3[] {
  const pts: Vec3[] = [];
  for (let s = 0; s <= 300; s++) pts.push([0, s, 3.9]);
  const a = (10 * Math.PI) / 180;
  for (let s = 1; s <= 200; s++) pts.push([-Math.sin(a) * s, 300 + Math.cos(a) * s, 3.9]);
  return pts;
}

describe("jetty train path", () => {
  it("measures the line and finds points along it", () => {
    const p = trainPath([[0, 0, 0], [3, 4, 0], [3, 10, 0]]);
    expect(p.s).toEqual([0, 5, 11]);
    expect(pathLength(p)).toBe(11);
    expect(pointAt(p, 2.5)).toEqual([1.5, 2, 0]);
    expect(pointAt(p, 8)).toEqual([3, 7, 0]);
    // Clamped to the ends.
    expect(pointAt(p, -4)).toEqual([0, 0, 0]);
    expect(pointAt(p, 99)).toEqual([3, 10, 0]);
  });

  it("drops the points a straight runs through, keeping the bend and the ends", () => {
    const line = jettyLine();
    const short = simplify(line);
    expect(short.length).toBeLessThan(10);
    expect(short[0]).toEqual(line[0]);
    expect(short[short.length - 1]).toEqual(line[line.length - 1]);
    expect(short).toContainEqual([0, 300, 3.9]);
    // The same length, near enough.
    expect(Math.abs(pathLength(trainPath(short)) - pathLength(trainPath(line)))).toBeLessThan(0.01);
  });

  it("spaces the cars nose to tail with a gap, each with its bogies inside it", () => {
    const cars = carOffsets();
    expect(cars).toHaveLength(TRAIN_CARS.length);
    expect(cars[0].mid).toBeCloseTo(TRAIN_CARS[0] / 2);
    expect(cars[1].mid).toBeCloseTo(TRAIN_CARS[0] + 0.6 + TRAIN_CARS[1] / 2);
    for (const c of cars) expect(c.half).toBeLessThan(c.length / 2);
    const last = cars[cars.length - 1];
    expect(last.mid + last.length / 2).toBeCloseTo(trainLength());
  });

  it("heads each car from bogie to bogie, turning through the bend", () => {
    const p = trainPath(jettyLine());
    const car = carOffsets()[1];
    const straight = carPose(p, 100, car);
    expect(straight.forward[0]).toBeCloseTo(0);
    expect(straight.forward[1]).toBeCloseTo(1);
    expect(straight.at[1]).toBeCloseTo(100 - car.mid);
    const bent = carPose(p, 450, car);
    expect(bent.forward[0]).toBeLessThan(-0.17); // heading north-north-west past the bend
    expect(bent.at[2]).toBeCloseTo(3.9);
  });
});

describe("jetty train", () => {
  const train = buildJettyTrain(jettyLine(), 60, 480)!;

  it("builds five cars as nodes of their own, each with its meshes in the car's frame", () => {
    expect(train.nodes.map((n) => n.name)).toEqual([0, 1, 2, 3, 4].map(carNode));
    for (const node of train.nodes) {
      expect(node.kind).toBe("node");
      expect(node.children.length).toBeGreaterThanOrEqual(2);
      // Meshes about the car's middle: within half a car either way, from the rail up to the roof.
      for (const m of node.children) {
        if (m.kind !== "mesh") throw new Error("car children are meshes");
        for (let i = 0; i < m.positions.length; i += 3) {
          expect(Math.abs(m.positions[i + 2])).toBeLessThan(3.6);
          expect(Math.abs(m.positions[i])).toBeLessThan(1.3);
          expect(m.positions[i + 1]).toBeGreaterThanOrEqual(0);
          expect(m.positions[i + 1]).toBeLessThan(2.7);
        }
      }
    }
    // The loco's chimney is at its front: +Z in the car's frame.
    const dark = train.nodes[0].children.find((m) => m.name === "JETTY_TRAIN_0_DARK")!;
    if (dark.kind !== "mesh") throw new Error();
    let tallest = { y: -1, z: 0 };
    for (let i = 0; i < dark.positions.length; i += 3) if (dark.positions[i + 1] > tallest.y) tallest = { y: dark.positions[i + 1], z: dark.positions[i + 2] };
    expect(tallest.z).toBeGreaterThan(0.8);
  });

  it("stands at the shore platform facing out along the jetty, on the rail top", () => {
    const loco = train.nodes[0].transform;
    // AC frame: translation in 12..14 (x east, y up, z south); look (Z row) in 8..10.
    expect(loco[12]).toBeCloseTo(0, 3);
    expect(loco[13]).toBeCloseTo(3.9, 3);
    expect(-loco[14]).toBeCloseTo(60 - TRAIN_CARS[0] / 2, 1);
    expect(loco[8]).toBeCloseTo(0, 3);
    expect(loco[9]).toBeCloseTo(0, 3);
    expect(loco[10]).toBeCloseTo(-1, 3); // facing north
    // The last carriage is behind the loco, toward the shore.
    const tail = train.nodes[4].transform;
    expect(-tail[14]).toBeLessThan(-loco[14] - 20);
  });

  it("runs from the parked spot to the far end, on a line that starts behind the parked train", () => {
    expect(train.end - train.park).toBeCloseTo(420, 0);
    expect(train.park).toBeGreaterThanOrEqual(trainLength());
    expect(pathLength(train.path)).toBeGreaterThanOrEqual(train.end);
    expect(train.path.pts.length).toBeLessThan(12);
  });

  it("keeps the parked train on the line when the platform is too near the end", () => {
    const t = buildJettyTrain(jettyLine(), 3, 9999)!;
    expect(t.park).toBeGreaterThanOrEqual(trainLength());
    expect(t.end).toBeLessThanOrEqual(pathLength(t.path));
    expect(buildJettyTrain(jettyLine().slice(0, 20), 10, 15)).toBeNull();
  });

  it("fills in the track script with the line in AC coordinates and the cars' offsets", () => {
    const template = readFileSync("src/core/lua/jetty_train.lua", "utf8");
    const lua = jettyTrainLua(template, train);
    expect(lua).not.toMatch(/__[A-Z_]+__/);
    const path = /local PATH = \{ ([^}]*) \}/.exec(lua)![1].split(",").map(Number);
    expect(path.length).toBe(train.path.pts.length * 3);
    // x, up, south: the first point is on the rail top, south of the parked train.
    expect(path[1]).toBeCloseTo(3.9);
    expect(-path[2]).toBeLessThan(60 - trainLength());
    expect(lua).toContain(`{ 'JETTY_TRAIN_0', ${TRAIN_CARS[0] / 2}, `);
    expect(lua).toContain("{ 'JETTY_TRAIN_4', ");
    expect(lua).toMatch(new RegExp(`local S_PARK = ${train.park.toFixed(3).replace(/\.?0+$/, "")}\\b`));
    expect(lua).toContain("function script.update(dt)");
    // Lua syntax: balanced brackets and blocks (a cheap check; luac isn't on the build machine).
    expect((lua.match(/\{/g) ?? []).length).toBe((lua.match(/\}/g) ?? []).length);
    expect((lua.match(/\(/g) ?? []).length).toBe((lua.match(/\)/g) ?? []).length);
  });

  it("loads the script from ext_config with its timetable settings", () => {
    expect(jettyTrainConfig()).toEqual(expect.arrayContaining(["[SCRIPT_...]", "SCRIPT = jetty_train.lua", "speedKmh = 5", "everyMinutes = 60", "waitAtEnd = 300"]));
    const ini = extConfig([], { jettyTrain: true, autotest: true });
    expect(ini).toContain("[SCRIPT_0]\r\nSCRIPT = autotest.lua");
    expect(ini).toContain("[SCRIPT_...]\r\nSCRIPT = jetty_train.lua\r\nspeedKmh = 5");
    expect(extConfig([], {})).not.toContain("jetty_train.lua");
  });
});
