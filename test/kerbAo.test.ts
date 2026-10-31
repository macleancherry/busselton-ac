import { describe, expect, it } from "vitest";
import type { Kn5GroupNode, Kn5MeshNode } from "../src/core/kn5";
import { KERB_FACE_LEAN, softenKerbFaces } from "../src/core/kerbAo";

/** A mesh with one vertex per normal (AC axes, y up). */
const mesh = (name: string, normals: number[][]): Kn5MeshNode => ({
  kind: "mesh", name, material: "concrete",
  positions: new Float32Array(normals.length * 3), normals: new Float32Array(normals.flat()), uvs: new Float32Array(normals.length * 2), indices: new Uint16Array([]),
} as Kn5MeshNode);

describe("softenKerbFaces", () => {
  const face = [-0.96, 0.27, 0]; // the kerb face: 5 cm run over 18 cm, facing the road
  const top = [0, 1, 0];

  it("leans kerb face normals toward the sky and leaves the kerb top alone", () => {
    const [out] = softenKerbFaces([mesh("1KERB_000", [face, top])]) as Kn5MeshNode[];
    const n = Array.from(out.normals);
    expect(Math.hypot(n[0], n[1], n[2])).toBeCloseTo(1, 5);
    // Now about 50 degrees up from level, still facing the road.
    const up = Math.asin(n[1]) * (180 / Math.PI);
    expect(up).toBeGreaterThan(40);
    expect(up).toBeLessThan(65);
    expect(n[0]).toBeLessThan(0);
    expect(n.slice(3)).toEqual([0, 1, 0]);
    expect(KERB_FACE_LEAN).toBeGreaterThan(0);
  });

  it("only touches kerb meshes, inside groups too, without changing its input", () => {
    const kerb = mesh("1KERB_RB3", [face]);
    const gutter = mesh("1ROAD_GUTTER_000", [face]);
    const g: Kn5GroupNode = { kind: "node", name: "KERBS", transform: [], children: [kerb, gutter] };
    const [og] = softenKerbFaces([g]) as Kn5GroupNode[];
    const [k2, g2] = og.children as Kn5MeshNode[];
    expect(k2.normals[1]).toBeGreaterThan(0.6);
    expect(g2).toBe(gutter);
    expect(Array.from(kerb.normals)).toEqual(face.map((v) => Math.fround(v)));
  });
});
