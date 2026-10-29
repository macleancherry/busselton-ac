import { describe, expect, it } from "vitest";
import { glbToKn5, kn5ToGlb } from "../src/core/gltf";
import { IDENTITY, readKn5, writeKn5, type Kn5Model } from "../src/core/kn5";
import { MeshBuilder } from "../src/core/mesh";
import { encodeDdsDxt1 } from "../src/core/dds";
import { solidTexture } from "../src/core/textures";

function model(): Kn5Model {
  const near = new MeshBuilder(), far = new MeshBuilder();
  for (const [mb, x] of [[near, 10], [far, 500]] as const) {
    const i = mb.vertexCount;
    mb.vertex([x, 0, 1], 0, 0); mb.vertex([x + 4, 0, 1], 1, 0); mb.vertex([x + 4, 4, 1], 1, 1); mb.vertex([x, 4, 1], 0, 1);
    mb.quad(i, i + 1, i + 2, i + 3);
  }
  const rgba = new Uint8Array(4 * 4 * 4).fill(200);
  return {
    textures: [{ name: "wall.dds", data: encodeDdsDxt1(rgba, 4, 4) }],
    materials: [{ name: "wall", shader: "ksPerPixel", properties: [], textures: { txDiffuse: "wall.dds" } }],
    root: { kind: "node", name: "t", transform: IDENTITY, children: [
      near.toKn5("1WALL_NEAR", "wall"), far.toKn5("FAR", "wall"),
      { ...near.toKn5("1WALL_HIDDEN", "wall"), renderable: false },
      // A group moved 2 m up: its mesh comes out moved.
      { kind: "node", name: "g", transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1], children: [near.toKn5("LIFTED", "wall")] },
    ] },
  };
}

describe("glTF", () => {
  it("round-trips a track's meshes to .glb and back to the same place, with textures", () => {
    const m = model();
    const back = glbToKn5(kn5ToGlb(m), "layer", solidTexture).model;
    const meshes = back.root.children as { name: string; positions: Float32Array; material: string }[];
    expect(meshes.map((x) => x.name)).toEqual(["1WALL_NEAR", "FAR", "LIFTED"]); // the invisible one left out
    const orig = (m.root.children[0] as { positions: Float32Array }).positions;
    Array.from(meshes[0].positions).forEach((v, i) => expect(v).toBeCloseTo(orig[i], 5));
    const lifted = meshes[2].positions;
    for (let i = 1; i < lifted.length; i += 3) expect(lifted[i]).toBeCloseTo(orig[i] + 2, 5);
    expect(back.textures[0].data.slice(1, 4)).toEqual(new Uint8Array([0x50, 0x4e, 0x47])); // a PNG
    // And it's a kn5 AC can read.
    expect(readKn5(writeKn5(back)).root.children.length).toBe(3);
  });

  it("exports only what's within the radius", () => {
    const back = glbToKn5(kn5ToGlb(model(), { centre: [12, -2], radius: 50 }), "l", solidTexture).model;
    expect(back.root.children.map((c) => c.name)).toEqual(["1WALL_NEAR", "LIFTED"]);
  });
});
