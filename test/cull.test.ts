import { describe, expect, it } from "vitest";
import { CELL, cullable, drawDistance, splitByArea, spread } from "../src/core/cull";
import { IDENTITY, type Kn5GroupNode, type Kn5MeshNode } from "../src/core/kn5";

type P3 = [number, number, number];

/** A mesh of unit quads (two triangles each) at the given corner positions (x, y, z). */
function quads(name: string, at: P3[], extra: Partial<Kn5MeshNode> = {}, tangents = false): Kn5MeshNode {
  const pos: number[] = [], nrm: number[] = [], uv: number[] = [], tan: number[] = [], idx: number[] = [];
  at.forEach(([x, y, z], q) => {
    const b = q * 4;
    for (const [dx, dz] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      pos.push(x + dx, y, z + dz);
      nrm.push(0, 1, q); // q in the normal's z so each vertex's normal is traceable
      uv.push(q + dx, dz);
      tan.push(1, 0, q);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return {
    kind: "mesh", name, material: "m",
    positions: new Float32Array(pos), normals: new Float32Array(nrm), uvs: new Float32Array(uv),
    ...(tangents ? { tangents: new Float32Array(tan) } : {}),
    indices: new Uint16Array(idx), ...extra,
  };
}

const row = (n: number, step: number, axis: 0 | 1 | 2 = 0, start = 0): P3[] =>
  Array.from({ length: n }, (_, i) => {
    const p: P3 = [0, 0, 0];
    p[axis] = start + i * step;
    return p;
  });
const tris = (m: Kn5MeshNode) => m.indices.length / 3;
const group = (name: string, children: Kn5GroupNode["children"]): Kn5GroupNode => ({ kind: "node", name, transform: IDENTITY.slice(), children });

describe("spread", () => {
  it("is half the bounding box diagonal", () => {
    const m = quads("X", [[0, 0, 0], [3, 4, 11]]);
    expect(spread(m)).toBeCloseTo(0.5 * Math.hypot(4, 4, 12), 6);
    expect(spread({ ...m, positions: new Float32Array(0) })).toBe(0);
  });
});

describe("splitByArea", () => {
  it("tiles a long row of quads", () => {
    const m = quads("FURNITURE_STEEL_000", row(1000, 2));
    const tiles = splitByArea(m);
    expect(tiles.length).toBeGreaterThan(10);
    expect(tiles.reduce((a, t) => a + tris(t), 0)).toBe(2000);
    tiles.forEach((t, k) => {
      expect(t.name).toBe(`FURNITURE_STEEL_000_T${k}`);
      expect(spread(t)).toBeLessThan(CELL);
      expect(Math.max(...t.indices)).toBe(t.positions.length / 3 - 1);
      expect(t.indices).toBeInstanceOf(Uint16Array);
    });
  });

  it("leaves compact or low-triangle meshes alone", () => {
    const compact = quads("FURNITURE_A", row(5, 20));
    const sparse = quads("FURNITURE_B", row(100, 20));
    expect(splitByArea(compact)[0]).toBe(compact);
    expect(splitByArea(compact)).toHaveLength(1);
    expect(splitByArea(sparse)[0]).toBe(sparse);
    expect(splitByArea(sparse)).toHaveLength(1);
  });

  it("tiles in x and z, not y", () => {
    const tall = quads("TALL", row(1000, 2, 1));
    expect(splitByArea(tall)).toEqual([tall]);
    expect(splitByArea(quads("DEEP", row(1000, 2, 2))).length).toBeGreaterThan(10);
  });

  it("merges small tiles into the nearest big one", () => {
    const m = quads("LONG", row(1000, 2));
    // One lone triangle far off at x = 3000: append it.
    const n = m.positions.length / 3;
    const pos = new Float32Array([...m.positions, 3000, 0, 0, 3001, 0, 0, 3000, 0, 1]);
    const lone: Kn5MeshNode = {
      ...m,
      positions: pos,
      normals: new Float32Array([...m.normals, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
      uvs: new Float32Array([...m.uvs, 0, 0, 0, 0, 0, 0]),
      indices: new Uint16Array([...m.indices, n, n + 1, n + 2]),
    };
    const tiles = splitByArea(lone);
    expect(tiles.every((t) => tris(t) >= 8)).toBe(true);
    expect(tiles.reduce((a, t) => a + tris(t), 0)).toBe(2001);
    // It lands in the tile nearest x = 3000: the last one along the row.
    const last = tiles[tiles.length - 1];
    expect(Math.max(...Array.from(last.positions).filter((_, i) => i % 3 === 0))).toBe(3001);
  });

  it("copies tangents, normals and uvs with their vertices and keeps winding", () => {
    const withTan = splitByArea(quads("FURNITURE_T", row(1000, 2), {}, true));
    expect(withTan.every((t) => t.tangents && t.tangents.length === t.positions.length)).toBe(true);
    const without = splitByArea(quads("FURNITURE_N", row(1000, 2)));
    expect(without.every((t) => !("tangents" in t))).toBe(true);
    for (const t of withTan) {
      for (let v = 0; v < t.positions.length / 3; v++) {
        const q = Math.floor(t.positions[v * 3] / 2); // quad index from its x
        expect(t.normals[v * 3 + 2]).toBe(q);
        expect(t.tangents![v * 3 + 2]).toBe(q);
        expect(t.uvs[v * 2]).toBe(t.positions[v * 3] - q); // u = q + dx, x = 2q + dx
        expect(t.uvs[v * 2 + 1]).toBe(t.positions[v * 3 + 2]); // v = dz
      }
    }
    // First triangle of the first tile: corners (0,0), (1,0), (1,1) of quad 0, in that order.
    const t0 = withTan[0];
    const corner = (c: number) => Array.from(t0.positions.subarray(t0.indices[c] * 3, t0.indices[c] * 3 + 3));
    expect([corner(0), corner(1), corner(2)]).toEqual([[0, 0, 0], [1, 0, 0], [1, 0, 1]]);
  });

  it("doesn't mutate its input", () => {
    const m = quads("FURNITURE_M", row(1000, 2));
    const copy = { ...m, positions: m.positions.slice(), indices: m.indices.slice() };
    splitByArea(m);
    expect(m).toEqual(copy);
  });
});

describe("drawDistance", () => {
  it("follows the table by prefix", () => {
    expect(drawDistance("MARKINGS_000")).toBe(450);
    expect(drawDistance("RRPM_1")).toBe(450);
    expect(drawDistance("FURNITURE_STEEL")).toBe(600);
    expect(drawDistance("GUIDEPOSTS_0")).toBe(500);
    expect(drawDistance("RAILPOSTS_0")).toBe(500);
    expect(drawDistance("ARMCOPOSTS_1")).toBe(400);
    expect(drawDistance("ARMCO_BEAM")).toBe(1200);
    expect(drawDistance("WIRES_003")).toBe(350);
    expect(drawDistance("MARKINGS_000_T3")).toBe(450);
  });
  it("gives undefined for others, case-sensitively", () => {
    expect(drawDistance("1KERB_000")).toBeUndefined();
    expect(drawDistance("TREES_0")).toBeUndefined();
    expect(drawDistance("markings_000")).toBeUndefined();
  });
});

describe("cullable", () => {
  it("sets draw distances, splits and passes through as specified", () => {
    const markings = quads("MARKINGS_000", row(5, 2));
    const kerb = quads("1KERB_000", row(5, 2));
    const wall = quads("1WALL_000", row(2000, 2), { renderable: false });
    const longMarks = quads("MARKINGS_LONG", row(1000, 2));
    const unsplittable = quads("MARKINGS_SPARSE", row(100, 20));
    const own = quads("FURNITURE_OWN", row(5, 2), { lodOut: 99 });
    const [g] = cullable([group("G", [markings, kerb, wall, longMarks, unsplittable, own])]) as Kn5GroupNode[];
    expect(g.kind).toBe("node");
    expect(g.name).toBe("G");
    expect(g.transform).toEqual(IDENTITY);
    const byName = (n: string) => g.children.filter((c) => c.name.startsWith(n)) as Kn5MeshNode[];
    expect(byName("MARKINGS_000")[0].lodOut).toBe(450);
    expect(byName("1KERB_000")[0].lodOut).toBeUndefined();
    expect(byName("1WALL_000")).toEqual([wall]);
    expect(byName("1WALL_000")[0]).toBe(wall);
    const tiles = byName("MARKINGS_LONG");
    expect(tiles.length).toBeGreaterThan(10);
    for (const t of tiles) {
      expect(spread(t)).toBeLessThan(112.5);
      expect(t.lodOut).toBe(450);
    }
    expect(byName("MARKINGS_SPARSE")[0].lodOut).toBeUndefined();
    expect(byName("FURNITURE_OWN")[0].lodOut).toBe(99);
    expect(markings.lodOut).toBeUndefined(); // input untouched
  });

  it("keeps input order, with tiles in place of their mesh", () => {
    const out = cullable([
      quads("A_FIRST", row(2, 2)),
      quads("FURNITURE_SPLIT", row(1000, 2)),
      group("G", [quads("B", row(2, 2))]),
      quads("C_LAST", row(2, 2)),
    ]);
    const names = out.map((n) => n.name);
    expect(names[0]).toBe("A_FIRST");
    expect(names.at(-2)).toBe("G");
    expect(names.at(-1)).toBe("C_LAST");
    const middle = names.slice(1, -2);
    expect(middle.length).toBeGreaterThan(10);
    middle.forEach((n, k) => expect(n).toBe(`FURNITURE_SPLIT_T${k}`));
  });

  it("is deterministic", () => {
    const input = () => [quads("FURNITURE_SPLIT", row(1000, 2)), group("G", [quads("MARKINGS_1", row(3, 2))])];
    expect(cullable(input())).toEqual(cullable(input()));
  });
});
