// MeshBuilder and the ENU -> AC conversion (docs/specs/mesh.md, "Tests to write").
import { describe, expect, it } from "vitest";
import { MeshBuilder, toAc, type Vec3 } from "../src/core/mesh";

const normalsOf = (n: { normals: Float32Array }) => Array.from({ length: n.normals.length / 3 }, (_, i) => Array.from(n.normals.subarray(i * 3, i * 3 + 3)));
const close = (a: number[], b: number[], digits = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));

function quadMesh(corners: Vec3[]): MeshBuilder {
  const mb = new MeshBuilder();
  const v = corners.map((p, i) => mb.vertex(p, i & 1, i >> 1));
  mb.quad(v[0], v[1], v[2], v[3]);
  return mb;
}

describe("toAc", () => {
  it("maps east, north, up to X, -Z, Y", () => {
    expect(toAc(1, 2, 3)).toEqual([1, 3, -2]);
  });
  it("is a proper rotation (determinant +1)", () => {
    const [x, y, z] = [toAc(1, 0, 0), toAc(0, 1, 0), toAc(0, 0, 1)];
    const det = x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
    expect(det).toBe(1);
  });
});

describe("MeshBuilder", () => {
  it("numbers vertices from 0 and appends triangles as given", () => {
    const mb = new MeshBuilder();
    expect([0, 1, 2, 3].map((i) => mb.vertex([i, 0, 0], 0, 0))).toEqual([0, 1, 2, 3]);
    expect(mb.vertexCount).toBe(4);
    mb.quad(0, 1, 2, 3);
    expect(mb.indices).toEqual([0, 1, 2, 0, 2, 3]);
    mb.tri(3, 1, 0);
    expect(mb.indices.slice(6)).toEqual([3, 1, 0]);
    expect(mb.uvs.length).toBe(8);
  });

  it("a level quad wound anticlockwise from above faces up in AC", () => {
    const pts: Vec3[] = [[0, 0, 5], [4, 0, 5], [4, 3, 5], [0, 3, 5]];
    const n = quadMesh(pts).toKn5("q", "m");
    for (const v of normalsOf(n)) close(v, [0, 1, 0]);
    pts.forEach((p, i) => expect(Array.from(n.positions.subarray(i * 3, i * 3 + 3))).toEqual(toAc(...p)));
  });

  it("vertical quads facing east and north", () => {
    const east = quadMesh([[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]]).toKn5("e", "m");
    for (const v of normalsOf(east)) close(v, [1, 0, 0]);
    const north = quadMesh([[1, 1, 0], [0, 1, 0], [0, 1, 1], [1, 1, 1]]).toKn5("n", "m");
    for (const v of normalsOf(north)) close(v, [0, 0, -1]);
  });

  it("weights shared vertices by triangle area", () => {
    const mb = new MeshBuilder();
    const s = mb.vertex([0, 0, 0], 0, 0);
    // Big triangle facing up (area 50), small one facing east (area 0.5).
    mb.tri(s, mb.vertex([10, 0, 0], 0, 0), mb.vertex([0, 10, 0], 0, 0));
    mb.tri(s, mb.vertex([0, 1, 0], 0, 0), mb.vertex([0, 0, 1], 0, 0));
    // Cross products: up (0, 0, 100), east (1, 0, 0) -> sum (1, 0, 100) in ENU.
    const len = Math.hypot(1, 100);
    close(normalsOf(mb.toKn5("w", "m"))[0], [1 / len, 100 / len, 0]);
  });

  it("gives unused vertices a zero normal and never NaN", () => {
    const mb = quadMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    mb.vertex([5, 5, 5], 0, 0);
    mb.tri(0, 0, 1); // zero area
    const n = mb.toKn5("u", "m");
    expect(normalsOf(n)[4].map(Math.abs)).toEqual([0, 0, 0]);
    expect(Array.from(n.normals).some(Number.isNaN)).toBe(false);
    close(normalsOf(n)[0], [0, 1, 0]);
  });

  it("rotates explicit normals without normalising them", () => {
    const mb = new MeshBuilder();
    mb.normals = [];
    for (let i = 0; i < 3; i++) {
      mb.vertex([i, i * i, 0], 0, 0);
      mb.normals.push(0, 0, 2);
    }
    mb.tri(0, 1, 2);
    for (const v of normalsOf(mb.toKn5("x", "m"))) expect(v).toEqual([0, 2, -0]);
  });

  it("computes from the faces again after switching back to null", () => {
    const mb = quadMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    mb.normals = [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0];
    close(normalsOf(mb.toKn5("a", "m"))[0], [1, 0, 0]);
    mb.normals = null;
    close(normalsOf(mb.toKn5("a", "m"))[0], [0, 1, 0]);
  });

  it("throws, naming the mesh, on broken input", () => {
    const bad = quadMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    bad.normals = [0, 0, 1];
    expect(() => bad.toKn5("wrong_normals", "m")).toThrow(/wrong_normals/);
    const range = quadMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    range.tri(0, 1, 4);
    expect(() => range.toKn5("bad_index", "m")).toThrow(/bad_index/);
    const neg = quadMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    neg.tri(0, 1, -1);
    expect(() => neg.toKn5("neg_index", "m")).toThrow(/neg_index/);
    const partial = quadMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    partial.indices.push(0);
    expect(() => partial.toKn5("partial", "m")).toThrow(/partial/);
    const uvs = quadMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    uvs.uvs.push(0);
    expect(() => uvs.toKn5("short_uvs", "m")).toThrow(/short_uvs/);
  });

  it("allows 65535 vertices and refuses 65536", () => {
    const mb = new MeshBuilder();
    for (let i = 0; i < 65535; i++) mb.vertex([i % 100, Math.floor(i / 100), 0], 0, 0);
    mb.tri(0, 1, 65534);
    expect(mb.toKn5("max", "m").positions.length).toBe(65535 * 3);
    mb.vertex([0, 0, 1], 0, 0);
    expect(() => mb.toKn5("too_big", "m")).toThrow(/too_big.*65536.*exceeds/);
  });

  it("puts extras on the node, and converts repeatably without changing the builder", () => {
    const mb = quadMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    const before = JSON.stringify([mb.positions, mb.uvs, mb.indices, mb.normals]);
    const a = mb.toKn5("x", "m", { castShadows: false, renderable: false });
    expect(a.castShadows).toBe(false);
    expect(a.renderable).toBe(false);
    expect(mb.toKn5("x", "m", { material: "other" }).material).toBe("other");
    const b = mb.toKn5("x", "m", { castShadows: false, renderable: false });
    expect(b).toEqual(a);
    expect(b.positions).not.toBe(a.positions);
    a.positions[0] = 99;
    expect(b.positions[0]).toBe(0);
    expect(JSON.stringify([mb.positions, mb.uvs, mb.indices, mb.normals])).toBe(before);
  });

  it("returns typed arrays and no tangents", () => {
    const n = quadMesh([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]).toKn5("t", "m");
    expect(n.kind).toBe("mesh");
    expect(n.positions).toBeInstanceOf(Float32Array);
    expect(n.normals).toBeInstanceOf(Float32Array);
    expect(n.uvs).toBeInstanceOf(Float32Array);
    expect(n.indices).toBeInstanceOf(Uint16Array);
    expect("tangents" in n).toBe(false);
    expect(Object.keys(n)).toEqual(["kind", "name", "positions", "normals", "uvs", "indices", "material"]);
  });

  it("converts an empty builder", () => {
    const n = new MeshBuilder().toKn5("empty", "m");
    expect([n.positions.length, n.normals.length, n.uvs.length, n.indices.length]).toEqual([0, 0, 0, 0]);
  });
});
