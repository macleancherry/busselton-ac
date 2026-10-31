import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cloth, FLAG_BACK_PREFIX, flagCspLines, flagMaterial } from "../src/core/flags";
import { extConfig } from "../src/core/cspConfig";
import { buildSpecHouse, type HouseSpec } from "../src/core/specHouse";
import { landmarkModel } from "../src/core/landmarkLayer";
import { MeshBuilder } from "../src/core/mesh";

describe("waving flags", () => {
  it("makes a cloth grid with u = 0 along the pole, and a back facing the other way", () => {
    const front = new MeshBuilder(), back = new MeshBuilder();
    // 1.5 m east of a pole at the origin, 1 m tall from z = 2.
    cloth(front, back, (u, v) => [1.5 * u, 0, 3 - v], 6, 3);
    expect(front.vertexCount).toBe(7 * 4);
    expect(front.indices.length).toBe(6 * 3 * 6);
    for (let i = 0; i < front.vertexCount; i++) {
      const x = front.positions[i * 3], u = front.uvs[i * 2], v = front.uvs[i * 2 + 1];
      expect(u).toBeCloseTo(x / 1.5); // pole edge at u = 0
      expect(u).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // Front and back normals are opposite, and each triangle winds the way its normal points.
    expect(front.normals![1]).toBeCloseTo(-back.normals![1]);
    for (const mb of [front, back]) {
      const [a, b, c] = [mb.indices[0], mb.indices[1], mb.indices[2]].map((k) => [mb.positions[k * 3], mb.positions[k * 3 + 1], mb.positions[k * 3 + 2]]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      expect(Math.sign(ny)).toBe(Math.sign(mb.normals![mb.indices[0] * 3 + 1]));
    }
  });

  it("gives flags the ksFlags shader with a gentle vanilla wave", () => {
    const m = flagMaterial("flag_x", "flag_x.png");
    expect(m.shader).toBe("ksFlags");
    expect(m.textures.txDiffuse).toBe("flag_x.png");
    expect(m.properties.map((p) => p.name)).toEqual(expect.arrayContaining(["ksDiffuse", "frequency", "distortion"]));
  });

  it("turns spec feather flags into one single-sided cloth plus a vanilla back, on a flag material", () => {
    const spec: HouseSpec = { blocks: [{ name: "a", x0: 0, x1: 10, y0: 0, y1: 8 }], flags: [{ x: 2, y: -3, height: 4, colour: "#d02020" }] };
    const h = buildSpecHouse(spec, { centre: [0, 0], toRoad: [0, -1], z: 0 }, "f");
    const flag = h.solids.find((s) => s.flag)!;
    expect(flag.name).toBe("spec_f_flag_d02020");
    expect(flag.rgb).toEqual([208, 32, 32]);
    const meshes = h.nodes.filter((n) => n.material === flag.name);
    expect(meshes.map((n) => n.name.startsWith(FLAG_BACK_PREFIX))).toEqual([false, true]);
    expect(meshes[1].castShadows).toBe(false);
    // A grid, its pole edge at u = 0, every UV inside the texture.
    const front = meshes[0];
    expect(front.positions.length / 3).toBe(4 * 9);
    for (let i = 0; i < front.uvs.length; i += 2) {
      expect(front.uvs[i]).toBeGreaterThanOrEqual(0);
      expect(front.uvs[i]).toBeLessThanOrEqual(1);
    }
    const poleU = [...front.uvs].filter((_, i) => i % 2 === 0).filter((u) => u === 0).length;
    expect(poleU).toBe(9);
    // The landmark layer gives it the flag shader.
    const lm = landmarkModel(spec, { centre: [0, 0], toRoad: [0, -1], z: 0 }, "f", () => 0);
    expect(lm.model.materials.find((m) => m.name === flag.name)?.shader).toBe("ksFlags");
  });

  it("writes CSP's dynamic flags, double-sided cloth and hidden vanilla backs into ext_config", () => {
    const lines = flagCspLines();
    expect(lines).toContain("[WIND]");
    expect(lines).toContain("DYNAMIC_FLAGS = '{ shader:ksFlags & !FLAGBACK_? }'");
    expect(lines).toContain("DYNAMIC_FLAGS_TESSELLATION = 1");
    const ini = extConfig([], { flags: true });
    expect(ini).toContain("MATERIALS = shader:ksFlags\r\nCULL_MODE = DOUBLESIDED");
    expect(ini).toContain("MESHES = FLAGBACK_?\r\nIS_VISIBLE = 0");
    expect(extConfig([], {})).not.toContain("DYNAMIC_FLAGS");
    // Auto-numbered sections (CSP's "..."), so they never clash with numbered ones.
    const heads = ini.match(/^\[[^\]]+\]/gm)!.filter((h) => !h.endsWith("_...]"));
    expect(new Set(heads).size).toBe(heads.length);
  });

  it("keeps the landmark example specs building", () => {
    const spec = JSON.parse(readFileSync("routes/landmarks/esplanade_hotel.json", "utf8")) as HouseSpec;
    expect(() => buildSpecHouse(spec, { centre: [0, 0], toRoad: [0, -1], z: 0 }, "e")).not.toThrow();
  });
});
