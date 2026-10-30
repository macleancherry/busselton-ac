import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { landmarkClear, landmarkModel, landmarkReach } from "../src/core/landmarkLayer";
import { readKn5, writeKn5, type Kn5Node } from "../src/core/kn5";

const rr = JSON.parse(readFileSync("routes/landmarks/rocky_ridge.json", "utf8"));

describe("landmarks as layers", () => {
  const lm = landmarkModel(rr, { centre: [100, 200], toRoad: [0, 1], z: 3 }, "rr", () => 2.95);

  it("carries every material and texture its meshes use", () => {
    const mats = new Set(lm.model.materials.map((m) => m.name));
    const texs = new Set(lm.model.textures.map((t) => t.name));
    const walk = (n: Kn5Node): string[] => (n.kind === "mesh" ? [n.material] : n.children.flatMap(walk));
    for (const m of walk(lm.model.root)) expect(mats.has(m), m).toBe(true);
    for (const m of lm.model.materials) for (const t of Object.values(m.textures)) expect(texs.has(t), t).toBe(true);
    expect(lm.triangles).toBeGreaterThan(500);
  });

  it("writes a kn5 that reads back, with the invisible walls to hit", () => {
    const back = readKn5(writeKn5(lm.model));
    const names: string[] = [];
    const walk = (n: Kn5Node) => (n.kind === "mesh" ? names.push(n.name) : n.children.forEach(walk));
    walk(back.root);
    expect(names.some((n) => n.startsWith("1WALL_SPECHOUSE"))).toBe(true);
    expect(names.some((n) => n.startsWith("TREES_rr"))).toBe(true);
  });

  it("clears a spot as big as the yard", () => {
    // Rocky Ridge's paving runs 10.8 m in front of a 20 m deep house, 19 m wide.
    expect(landmarkReach(rr)).toBeGreaterThan(20);
    expect(landmarkClear([115.3, -33.6], rr).radius).toBe(landmarkReach(rr));
  });
});
