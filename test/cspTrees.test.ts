import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { treeList, writeTreeBin, xxHash32 } from "../src/core/cspTrees";
import { MODEL_NAMES, treeModel } from "../src/core/treeModels";

/** Reads a .mesh back (the layout of Content Manager's tree converter). */
function readMesh(b: Uint8Array) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 0;
  const i32 = () => { const v = dv.getInt32(o, true); o += 4; return v; };
  expect(i32()).toBe(1);
  expect(dv.getUint8(o++)).toBe(0);
  const nt = i32();
  const textures: string[] = [];
  for (let t = 0; t < nt; t++) { o += 4; const l = i32(); textures.push(new TextDecoder().decode(b.subarray(o, o + l))); o += l; }
  const subs: { diffuse: number; normal: number; tris: number; verts: number; maxXZ: number; minY: number; maxY: number }[] = [];
  let trunk: number | null = null;
  while (o < b.length) {
    const a = i32();
    if (a === -1) { expect(i32()).toBe(4); trunk = dv.getFloat32(o, true); o += 4; break; }
    const normal = i32(), ni = i32();
    let maxIndex = 0;
    for (let k = 0; k < ni; k++) { maxIndex = Math.max(maxIndex, dv.getUint16(o, true)); o += 2; }
    const nv = i32();
    expect(maxIndex).toBeLessThan(nv);
    let maxXZ = 0, minY = Infinity, maxY = -Infinity;
    for (let v = 0; v < nv; v++) {
      const x = dv.getFloat32(o, true), y = dv.getFloat32(o + 4, true), z = dv.getFloat32(o + 8, true);
      maxXZ = Math.max(maxXZ, Math.abs(x), Math.abs(z)); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      o += 44;
    }
    subs.push({ diffuse: a, normal, tris: ni / 3, verts: nv, maxXZ, minY, maxY });
  }
  return { textures, subs, trunk };
}

describe("CSP trees", () => {
  it("xxHash32 matches the reference values", () => {
    expect(xxHash32(new TextEncoder().encode("abc"))).toBe(0x32d153ff);
    expect(xxHash32(new Uint8Array())).toBe(0x02cc5d05);
  });

  it("writes every species as a .bin the way CM's converter lays it out", { timeout: 60_000 }, () => {
    for (let s = 0; s < MODEL_NAMES.length; s++) {
      const files = unzipSync(writeTreeBin(treeModel(s)));
      const ini = new TextDecoder().decode(files["tree.ini"]);
      expect(ini).toMatch(/\[BASIC\][\s\S]*HEIGHT=\d/);
      for (let l = 0; l < 3; l++) expect(ini).toMatch(new RegExp(`\\[LOD_${l}\\]\\r\\nMODEL=${MODEL_NAMES[s]}_lod${l}\\.mesh`));
      const meshes = Object.keys(files).filter((f) => f.endsWith(".mesh"));
      expect(meshes).toHaveLength(3);
      const tris: number[] = [];
      for (const m of meshes.sort()) {
        const r = readMesh(files[m]);
        expect(r.textures.every((t) => files[t])).toBe(true); // every texture is in the zip
        for (const sm of r.subs) {
          // Normalised: within the unit box, the top at 1 for the tallest part.
          expect(sm.maxXZ).toBeLessThanOrEqual(1.0001);
          expect(sm.minY).toBeGreaterThanOrEqual(-0.01);
          expect(sm.maxY).toBeLessThanOrEqual(1.0001);
          expect(sm.diffuse).toBeGreaterThanOrEqual(0);
          expect(sm.normal).toBeGreaterThanOrEqual(0);
        }
        tris.push(r.subs.reduce((a, x) => a + x.tris, 0));
        expect(r.trunk).not.toBeNull();
      }
      // Fewer triangles at each level, and within the research's budget (docs/trees.md: about 6k at LOD A).
      expect(tris[0]).toBeGreaterThan(tris[1]);
      expect(tris[1]).toBeGreaterThan(tris[2]);
      expect(tris[0]).toBeLessThan(6500);
    }
  });

  it("writes the tree list", () => {
    const t = treeList([{ model: "tuart.bin", pos: [1, 2, -3], angle: 90, size: 1.2 }]);
    expect(t).toContain("tree: tuart.bin; pos=1.00, 2.00, -3.00; angle=90; size=1.20");
    expect(t).toContain("configure: fake shadow");
  });
});
