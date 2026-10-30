import { describe, expect, it } from "vitest";
import { buildRaceFlags, cloth, FLAG_BACK_PREFIX, flagCspLines, flagMaterial, raceFlagTexture, takeRaceFlags } from "../src/core/flags";
import { extConfig } from "../src/core/cspConfig";
import { MeshBuilder } from "../src/core/mesh";
import { decodeOwnPng } from "../src/core/png";
import type { Piece } from "../src/core/furniture";
import { ArtList } from "../src/core/art";
import { withDefaults } from "../src/core/options";
import { raceDressing } from "../src/core/raceDress";
import { planRoad } from "../src/core/road";
import type { Vec2 } from "../src/core/geo";

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

  it("takes the marshal flags out of the race pieces and hangs each off its pole", () => {
    const pieces: Piece[] = [
      { kind: "box", at: [10, 0], along: [1, 0], length: 0.06, depth: 0.06, z0: 0, z1: 3, material: "steel" },
      // The flag 0.42 m east of its pole, facing south.
      { kind: "face", at: [10.42, 0], normal: [0, -1], z0: 2.35, height: 0.6, art: "flag:yellow", twoSided: true },
      { kind: "face", at: [50, 0], normal: [0, -1], z0: 2, height: 1, art: "banner:x" },
    ];
    const { rest, flags } = takeRaceFlags(pieces);
    expect(rest.map((p) => p.kind === "face" ? p.art : p.kind)).toEqual(["box", "banner:x"]);
    expect(flags).toHaveLength(1);
    const f = flags[0];
    expect(f.flag).toBe("yellow");
    expect(f.pole[0]).toBeCloseTo(10.42 - 0.45);
    expect(f.dir[0]).toBeCloseTo(1);
    const nodes = buildRaceFlags(flags);
    expect(nodes.map((n) => n.name)).toEqual(["RACE_FLAGS", `${FLAG_BACK_PREFIX}RACE_FLAGS`]);
    expect(nodes.every((n) => n.material === "flag_race")).toBe(true);
    // The yellow row is the texture's top quarter; u spans the whole width.
    const uv = nodes[0].uvs;
    for (let i = 0; i < uv.length; i += 2) expect(uv[i + 1]).toBeLessThan(0.25);
    expect(Math.min(...uv.filter((_, i) => i % 2 === 0))).toBe(0);
    expect(Math.max(...uv.filter((_, i) => i % 2 === 0))).toBe(1);
    const tex = decodeOwnPng(raceFlagTexture());
    expect([tex.rgba[0], tex.rgba[1], tex.rgba[2]]).toEqual([250, 204, 20]);
  });

  it("finds every marshal flag in real race dressing, each hanging off its own pole", () => {
    // 300 m east, a tight left of radius 25 m, 200 m north (as raceDress.test.ts).
    const pts: Vec2[] = [];
    for (let x = 0; x <= 300; x += 5) pts.push([x, 0]);
    for (let a = 5; a <= 90; a += 5) pts.push([300 + 25 * Math.sin((a * Math.PI) / 180), 25 - 25 * Math.cos((a * Math.PI) / 180)]);
    for (let y = 30; y <= 225; y += 5) pts.push([325, y]);
    const opts = withDefaults({ widthOverride: 8 });
    const race = raceDressing(planRoad(pts, opts), opts, new ArtList(), { ground: () => 0, blocked: () => false }, "Repco");
    const printed = race.pieces.filter((p) => p.kind === "face" && p.art.startsWith("flag:")).length;
    const { rest, flags } = takeRaceFlags(race.pieces);
    expect(printed).toBeGreaterThanOrEqual(2); // a yellow at the corner, the chequered at the line
    expect(flags).toHaveLength(printed);
    expect(rest.some((p) => p.kind === "face" && p.art.startsWith("flag:"))).toBe(false);
    const posts = race.pieces.filter((p): p is Extract<Piece, { kind: "box" }> => p.kind === "box" && p.material === "steel" && p.length < 0.1);
    for (const f of flags) expect(Math.min(...posts.map((b) => Math.hypot(b.at[0] - f.pole[0], b.at[1] - f.pole[1])))).toBeLessThan(0.06);
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

});
