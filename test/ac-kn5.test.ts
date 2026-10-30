import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BlendMode, DepthMode, frameTransform, IDENTITY, MAX_MESH_VERTICES, readKn5, writeKn5,
  type Kn5GroupNode, type Kn5MeshNode, type Kn5Model, type Kn5Node,
} from "../src/core/kn5";
import { buildFiles, HAVE_BUILD } from "./ac-buildfiles";

/** A tiny independent little-endian reader for checking bytes by offset. */
class Peek {
  v: DataView;
  constructor(public b: Uint8Array, public at = 0) { this.v = new DataView(b.buffer, b.byteOffset, b.byteLength); }
  u8() { return this.b[this.at++]; }
  u16() { const x = this.v.getUint16(this.at, true); this.at += 2; return x; }
  u32() { const x = this.v.getUint32(this.at, true); this.at += 4; return x; }
  i32() { const x = this.v.getInt32(this.at, true); this.at += 4; return x; }
  f32() { const x = this.v.getFloat32(this.at, true); this.at += 4; return x; }
  str() { const n = this.u32(); const s = new TextDecoder().decode(this.b.subarray(this.at, this.at + n)); this.at += n; return s; }
  raw(n: number) { const s = this.b.subarray(this.at, this.at + n); this.at += n; return Array.from(s); }
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

function quad(name: string, material: string, extra: Partial<Kn5MeshNode> = {}): Kn5MeshNode {
  return {
    kind: "mesh", name, material,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
    normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]),
    uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
    indices: new Uint16Array([0, 2, 1, 0, 3, 2]),
    ...extra,
  };
}

function tinyModel(): Kn5Model {
  return {
    textures: [{ name: "t.png", data: new Uint8Array([1, 2, 3, 4]) }],
    materials: [{ name: "m", shader: "ksPerPixel", properties: [{ name: "ksDiffuse", a: 0.5 }], textures: { txDiffuse: "t.png" } }],
    root: { kind: "node", name: "root", transform: IDENTITY, children: [] },
  };
}

function richModel(): Kn5Model {
  const r = seeded(3);
  const n = 40;
  const positions = new Float32Array(n * 3).map(() => (r() - 0.5) * 200);
  const normals = new Float32Array(n * 3);
  const tangents = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { normals[i * 3 + 1] = 1; tangents[i * 3] = 1; }
  const uvs = new Float32Array(n * 2).map(() => r());
  const indices = new Uint16Array(Array.from({ length: 60 }, () => Math.floor(r() * n)));
  return {
    textures: [
      { name: "a.dds", data: new Uint8Array([68, 68, 83, 32, 9, 9]) },
      { name: "b.png", data: new Uint8Array(1000).map((_, i) => i & 255) },
      { name: "c.png", data: new Uint8Array(0) },
    ],
    materials: [
      { name: "plain", shader: "ksPerPixel", properties: [], textures: {} },
      {
        name: "fancy", shader: "ksPerPixelMultiMap", blendMode: BlendMode.AlphaToCoverage, alphaTested: true, depthMode: DepthMode.Off,
        properties: [{ name: "p1", a: 1.5, b: [2, 3], c: [4, 5, 6], d: [7, 8, 9, 10] }, { name: "p2", c: [0.1, 0.2, 0.3] }],
        textures: { txDiffuse: "a.dds", txNormal: "b.png", txMaps: "c.png", txDetail: "b.png" },
      },
      { name: "sea", shader: "ksPerPixel", blendMode: BlendMode.AlphaBlend, depthMode: DepthMode.NoWrite, properties: [], textures: { txDiffuse: "b.png" } },
    ],
    root: {
      kind: "node", name: "root", transform: IDENTITY, children: [
        { kind: "node", name: "AC_START_0", transform: frameTransform([10, 2, -30], [1, 0, 1]), children: [] },
        {
          kind: "node", name: "group", transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 6, 7, 1], children: [
            quad("1ROAD_a", "fancy"),
            {
              kind: "mesh", name: "1WALL_b", material: "plain", positions, normals, uvs, tangents, indices,
              castShadows: false, visible: false, transparent: true, renderable: false, layer: 3, lodIn: 5, lodOut: 250,
            },
            { kind: "node", name: "nested", transform: IDENTITY, children: [quad("sea", "sea")] },
          ],
        },
      ],
    },
  };
}

const meshes = (n: Kn5Node): Kn5MeshNode[] => (n.kind === "mesh" ? [n] : n.children.flatMap(meshes));
const f32arr = (a: ArrayLike<number>) => Array.from(a, Math.fround);

describe("kn5 format", () => {
  it("starts with sc6969 and version 5, with no extra field", () => {
    const b = writeKn5(tinyModel());
    expect(String.fromCharCode(...b.subarray(0, 6))).toBe("sc6969");
    const p = new Peek(b, 6);
    expect(p.u32()).toBe(5);
    expect(p.u32()).toBe(1); // straight on to the texture count
  });

  it("writes header, texture and material fields at their offsets", () => {
    const b = writeKn5(tinyModel());
    const p = new Peek(b, 10);
    expect(p.u32()).toBe(1);
    expect(p.i32()).toBe(1); // active
    expect(p.str()).toBe("t.png");
    expect(p.u32()).toBe(4);
    expect(p.raw(4)).toEqual([1, 2, 3, 4]);
    expect(p.u32()).toBe(1); // materials
    expect(p.str()).toBe("m");
    expect(p.str()).toBe("ksPerPixel");
    expect(p.u8()).toBe(0); // blend
    expect(p.u8()).toBe(0); // alpha tested
    expect(p.i32()).toBe(0); // depth
    expect(p.u32()).toBe(1);
    expect(p.str()).toBe("ksDiffuse");
    expect(Array.from({ length: 10 }, () => p.f32())).toEqual([0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(p.u32()).toBe(1);
    expect(p.str()).toBe("txDiffuse");
    expect(p.u32()).toBe(0);
    expect(p.str()).toBe("t.png");
    // root node
    expect(p.u32()).toBe(1);
    expect(p.str()).toBe("root");
    expect(p.u32()).toBe(0);
    expect(p.u8()).toBe(1);
    expect(Array.from({ length: 16 }, () => p.f32())).toEqual(IDENTITY);
    expect(p.at).toBe(b.length);
  });

  it("writes a group node's 16 floats in order, and a mesh record in the documented layout", () => {
    const m = tinyModel();
    const t = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 11, 12, 13, 1];
    const mesh = quad("1ROAD_q", "m", { lodIn: 2, lodOut: 300, layer: 4, tangents: new Float32Array(12).map((_, i) => i * 0.25) });
    m.root.children.push({ kind: "node", name: "g", transform: t, children: [mesh] });
    const b = writeKn5(m);
    const tiny = writeKn5(tinyModel());
    const p = new Peek(b, tiny.length - 16 * 4 - 1 - 4); // back to the root's child count
    expect(p.u32()).toBe(1);
    p.at += 1 + 64;
    expect(p.u32()).toBe(1); // group node g
    expect(p.str()).toBe("g");
    expect(p.u32()).toBe(1);
    expect(p.u8()).toBe(1);
    expect(Array.from({ length: 16 }, () => p.f32())).toEqual(t);
    expect(p.u32()).toBe(2); // mesh
    expect(p.str()).toBe("1ROAD_q");
    expect(p.u32()).toBe(0);
    expect(p.u8()).toBe(1);
    expect([p.u8(), p.u8(), p.u8()]).toEqual([1, 1, 0]);
    expect(p.u32()).toBe(4);
    const v1 = Array.from({ length: 11 }, () => p.f32()); // vertex 0
    expect(v1).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0, 0.25, 0.5]);
    p.at += 44 * 3;
    expect(p.u32()).toBe(6);
    expect(Array.from({ length: 6 }, () => p.u16())).toEqual([0, 2, 1, 0, 3, 2]);
    expect(p.u32()).toBe(0); // material index
    expect(p.u32()).toBe(4); // layer
    expect([p.f32(), p.f32()]).toEqual([2, 300]);
    expect([p.f32(), p.f32(), p.f32()]).toEqual([0.5, 0, 0.5]);
    expect(p.f32()).toBeCloseTo(Math.SQRT1_2, 6);
    expect(p.u8()).toBe(1);
    expect(p.at).toBe(b.length);
  });
});

describe("kn5 round trips", () => {
  it("brings back everything written", () => {
    const m = richModel();
    const back = readKn5(writeKn5(m));
    expect(back.version).toBe(5);
    expect(back.textures.map((t) => [t.name, Array.from(t.data)])).toEqual(m.textures.map((t) => [t.name, Array.from(t.data)]));
    const fancy = back.materials[1];
    expect(fancy).toMatchObject({ name: "fancy", shader: "ksPerPixelMultiMap", blendMode: 2, alphaTested: true, depthMode: 2 });
    expect(fancy.properties[0]).toEqual({ name: "p1", a: 1.5, b: [2, 3], c: [4, 5, 6], d: [7, 8, 9, 10] });
    expect(fancy.properties[1]).toEqual({ name: "p2", a: 0, b: [0, 0], c: f32arr([0.1, 0.2, 0.3]), d: [0, 0, 0, 0] });
    expect(fancy.textures).toEqual(m.materials[1].textures);
    expect(back.materials[0]).toMatchObject({ blendMode: 0, alphaTested: false, depthMode: 0, properties: [], textures: {} });
    expect(back.materials[2]).toMatchObject({ blendMode: 1, depthMode: 1 });
    const start = back.root.children[0] as Kn5GroupNode;
    expect(start.name).toBe("AC_START_0");
    expect(start.transform).toEqual(f32arr(frameTransform([10, 2, -30], [1, 0, 1])));
    const [a, w, s] = meshes(m.root);
    const [ba, bw, bs] = meshes(back.root);
    expect(bw).toMatchObject({ name: "1WALL_b", material: "plain", castShadows: false, visible: false, transparent: true, renderable: false, layer: 3, lodIn: 5, lodOut: 250 });
    for (const k of ["positions", "normals", "uvs", "tangents", "indices"] as const) expect(Array.from(bw[k]!)).toEqual(Array.from(w[k]!));
    expect(ba).toMatchObject({ name: a.name, material: "fancy", castShadows: true, visible: true, transparent: false, renderable: true, layer: 0, lodIn: 0, lodOut: 0 });
    expect(bs.name).toBe(s.name);
    expect(((back.root.children[1] as Kn5GroupNode).children[2] as Kn5GroupNode).name).toBe("nested");
  });

  it("read-write-read is stable and the second write is byte-identical", () => {
    const first = writeKn5(richModel());
    const r1 = readKn5(first);
    const second = writeKn5(r1);
    expect(Buffer.from(second).equals(Buffer.from(first))).toBe(true);
    expect(Buffer.from(writeKn5(readKn5(second))).equals(Buffer.from(second))).toBe(true);
  });

  it("keeps given tangents and computes unit, perpendicular ones otherwise", () => {
    const r = seeded(5);
    const n = 30;
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = [r() - 0.5, r() + 0.2, r() - 0.5];
      const l = Math.hypot(...v);
      normals.set(v.map((x) => x / l), i * 3);
    }
    const mesh: Kn5MeshNode = {
      kind: "mesh", name: "m", material: "m",
      positions: new Float32Array(n * 3).map(() => r() * 10), normals,
      uvs: new Float32Array(n * 2).map((_, i) => (i < 10 ? 0 : r())), // some zero-area UV triangles
      indices: new Uint16Array(Array.from({ length: 45 }, () => Math.floor(r() * n))),
    };
    const m = tinyModel();
    m.root.children.push(mesh);
    const t = meshes(readKn5(writeKn5(m)).root)[0].tangents!;
    for (let i = 0; i < n; i++) {
      const tv = [t[i * 3], t[i * 3 + 1], t[i * 3 + 2]];
      expect(tv.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(...tv)).toBeCloseTo(1, 5);
      expect(tv[0] * normals[i * 3] + tv[1] * normals[i * 3 + 1] + tv[2] * normals[i * 3 + 2]).toBeCloseTo(0, 5);
    }
    // the quad's u runs along +X, so its tangent is +X
    const q = tinyModel();
    q.root.children.push(quad("q", "m"));
    expect(Array.from(meshes(readKn5(writeKn5(q)).root)[0].tangents!)).toEqual([1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]);
  });

  it("keeps Unicode names", () => {
    const m = tinyModel();
    m.textures[0].name = "café_ü.png";
    m.materials[0].textures.txDiffuse = "café_ü.png";
    m.materials[0].name = "мат";
    m.root.children.push(quad("1ROAD_é", "мат"));
    m.root.name = "根";
    const back = readKn5(writeKn5(m));
    expect(back.textures[0].name).toBe("café_ü.png");
    expect(back.materials[0].name).toBe("мат");
    expect(back.root.name).toBe("根");
    expect(meshes(back.root)[0]).toMatchObject({ name: "1ROAD_é", material: "мат" });
  });

  it("handles an empty model and a mesh with no vertices", () => {
    const empty: Kn5Model = { textures: [], materials: [], root: { kind: "node", name: "e", transform: IDENTITY, children: [] } };
    expect(readKn5(writeKn5(empty))).toMatchObject({ textures: [], materials: [], root: { name: "e", children: [] } });
    const m = tinyModel();
    m.root.children.push({ kind: "mesh", name: "none", material: "m", positions: new Float32Array(0), normals: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint16Array(0) });
    const back = meshes(readKn5(writeKn5(m)).root)[0];
    expect(back.positions.length).toBe(0);
  });
});

describe("kn5 texture registers", () => {
  const withSlots = (slots: string[]): Kn5Model => {
    const m = tinyModel();
    m.materials[0].textures = Object.fromEntries(slots.map((s) => [s, "t.png"]));
    return m;
  };

  it("writes each known slot with its register, whatever the order", () => {
    const back = readKn5(writeKn5(withSlots(["txDetail", "txMaps", "txDiffuse", "txNormal"])));
    expect(Object.entries(back.materials[0].registers!)).toEqual([["txDetail", 3], ["txMaps", 2], ["txDiffuse", 0], ["txNormal", 1]]);
    const all = readKn5(writeKn5(withSlots(["txDetailNM", "txDetailA", "txNormalDetail", "txDetailB", "txDetailG", "txDetailR", "txVariation", "txMask"])));
    expect(all.materials[0].registers).toEqual({ txDetailNM: 6, txDetailA: 5, txNormalDetail: 4, txDetailB: 4, txDetailG: 3, txDetailR: 2, txVariation: 1, txMask: 1 });
  });

  it("throws on a slot with no known register (rather than guessing one that might collide)", () => {
    expect(() => writeKn5(withSlots(["txDiffuse", "txSomethingNew"]))).toThrow(/txSomethingNew/);
  });
});

describe("kn5 validation", () => {
  const throwsNaming = (mutate: (m: Kn5Model) => void, name: RegExp) => {
    const m = tinyModel();
    mutate(m);
    expect(() => writeKn5(m)).toThrow(name);
  };

  it("throws on each kind of invalid input, naming the culprit", () => {
    throwsNaming((m) => m.textures.push({ name: "t.png", data: new Uint8Array(1) }), /t\.png/);
    throwsNaming((m) => m.materials.push({ ...m.materials[0] }), /"m"/);
    throwsNaming((m) => { m.materials[0].textures.txNormal = "missing.png"; }, /missing\.png/);
    throwsNaming((m) => m.root.children.push(quad("q1", "nope")), /q1.*nope/);
    throwsNaming((m) => m.root.children.push(quad("q2", "m", { normals: new Float32Array(9) })), /q2/);
    throwsNaming((m) => m.root.children.push(quad("q3", "m", { uvs: new Float32Array(6) })), /q3/);
    throwsNaming((m) => m.root.children.push(quad("q4", "m", { tangents: new Float32Array(3) })), /q4/);
    throwsNaming((m) => m.root.children.push(quad("q5", "m", { indices: new Uint16Array([0, 1]) })), /q5/);
    throwsNaming((m) => m.root.children.push(quad("q6", "m", { indices: new Uint16Array([0, 1, 4]) })), /q6/);
    throwsNaming((m) => m.root.children.push({ kind: "node", name: "badT", transform: [1, 0, 0], children: [] }), /badT/);
  });

  it("allows exactly 65535 vertices and rejects 65536", () => {
    const big = (n: number): Kn5MeshNode => ({
      kind: "mesh", name: `big${n}`, material: "m",
      positions: new Float32Array(n * 3), normals: new Float32Array(n * 3).fill(1), uvs: new Float32Array(n * 2),
      tangents: new Float32Array(n * 3), indices: new Uint16Array([0, 1, 2]),
    });
    expect(MAX_MESH_VERTICES).toBe(65535);
    const ok = tinyModel();
    ok.root.children.push(big(65535));
    expect(() => writeKn5(ok)).not.toThrow();
    const no = tinyModel();
    no.root.children.push(big(65536));
    expect(() => writeKn5(no)).toThrow(/big65536/);
  });
});

describe("kn5 reading", () => {
  it("throws on bad magic, truncation, trailing bytes and unknown node classes", () => {
    const b = writeKn5(richModel());
    const bad = b.slice();
    bad[0] = 0x58;
    expect(() => readKn5(bad)).toThrow(/not a kn5/);
    expect(() => readKn5(b.subarray(0, b.length - 1))).toThrow();
    expect(() => readKn5(b.subarray(0, 200))).toThrow();
    const trailing = new Uint8Array(b.length + 3);
    trailing.set(b);
    expect(() => readKn5(trailing)).toThrow(/left over/);
    // An empty-ish model whose root class is changed to 3 or 7.
    const e = writeKn5({ textures: [], materials: [], root: { kind: "node", name: "r", transform: IDENTITY, children: [] } });
    for (const cls of [3, 7]) {
      const x = e.slice();
      new DataView(x.buffer).setUint32(18, cls, true);
      expect(() => readKn5(x)).toThrow(/class/);
    }
  });

  it("reads a version 6 file with the extra field", () => {
    const v5 = writeKn5(tinyModel());
    const v6 = new Uint8Array(v5.length + 4);
    v6.set(v5.subarray(0, 6));
    new DataView(v6.buffer).setUint32(6, 6, true);
    new DataView(v6.buffer).setUint32(10, 0xabcdef, true);
    v6.set(v5.subarray(10), 14);
    const m = readKn5(v6);
    expect(m.version).toBe(6);
    expect(m.textures[0].name).toBe("t.png");
  });

  it("copies texture bytes out of the input", () => {
    const b = writeKn5(tinyModel());
    const m = readKn5(b);
    b.fill(0);
    expect(Array.from(m.textures[0].data)).toEqual([1, 2, 3, 4]);
  });
});

describe("kn5 helpers", () => {
  const row = (t: number[], i: number) => [t[i], t[i + 1], t[i + 2]];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  it("frameTransform: Z along forward, Y up, X = Y x Z, position in 12 to 14", () => {
    for (const fwd of [[1, 0, 0], [0, 0, -1], [3, 0, 4]]) {
      const t = frameTransform([1, 2, 3], fwd);
      const l = Math.hypot(...fwd);
      const z = row(t, 8), y = row(t, 4), x = row(t, 0);
      z.forEach((v, i) => expect(v).toBeCloseTo(fwd[i] / l, 12));
      y.forEach((v, i) => expect(v).toBeCloseTo([0, 1, 0][i], 12));
      cross(y, z).forEach((v, i) => expect(x[i]).toBeCloseTo(v, 12));
      for (const v of [x, y, z]) expect(Math.hypot(...v)).toBeCloseTo(1, 12);
      expect([t[3], t[7], t[11], t[15]]).toEqual([0, 0, 0, 1]);
      expect(t.slice(12, 15)).toEqual([1, 2, 3]);
    }
  });

  it("frameTransform with forward straight up has no NaN and stays orthonormal; zero forward throws", () => {
    for (const fwd of [[0, 1, 0], [0, -2, 0]]) {
      const t = frameTransform([0, 0, 0], fwd);
      expect(t.every(Number.isFinite)).toBe(true);
      const x = row(t, 0), y = row(t, 4), z = row(t, 8);
      for (const v of [x, y, z]) expect(Math.hypot(...v)).toBeCloseTo(1, 12);
      cross(y, z).forEach((v, i) => expect(x[i]).toBeCloseTo(v, 12));
    }
    expect(() => frameTransform([0, 0, 0], [0, 0, 0])).toThrow();
  });

  it("writes a bounding sphere that contains every vertex", () => {
    const r = seeded(8);
    const n = 500;
    const positions = new Float32Array(n * 3).map(() => (r() - 0.3) * 1000);
    const m = tinyModel();
    m.root.children.push({ kind: "mesh", name: "cloud", material: "m", positions, normals: new Float32Array(n * 3).fill(1), uvs: new Float32Array(n * 2), indices: new Uint16Array(0) });
    const b = writeKn5(m);
    const p = new Peek(b, b.length - 17);
    const [cx, cy, cz, rad] = [p.f32(), p.f32(), p.f32(), p.f32()];
    for (let i = 0; i < n; i++) {
      expect(Math.hypot(positions[i * 3] - cx, positions[i * 3 + 1] - cy, positions[i * 3 + 2] - cz)).toBeLessThanOrEqual(rad * (1 + 1e-6));
    }
  });
});

describe("kn5 files the old writer made", () => {
  for (const f of ["layout_town.kn5", "lm_busselton_museum.kn5"]) {
    it(`${f}: reads cleanly and writes back byte for byte`, () => {
      const data = new Uint8Array(readFileSync(`test/fixtures/ac/${f}`));
      const m = readKn5(data);
      expect(m.version).toBe(5);
      const mats = new Set(m.materials.map((x) => x.name));
      const texs = new Set(m.textures.map((x) => x.name));
      for (const mesh of meshes(m.root)) expect(mats.has(mesh.material)).toBe(true);
      for (const mat of m.materials) for (const t of Object.values(mat.textures)) expect(texs.has(t)).toBe(true);
      expect(Buffer.from(writeKn5(m)).equals(Buffer.from(data))).toBe(true);
    });
  }

  it("layout_town.kn5 has AC_START_0 with an orthonormal frame", () => {
    const m = readKn5(new Uint8Array(readFileSync("test/fixtures/ac/layout_town.kn5")));
    const start = m.root.children.find((c) => c.name === "AC_START_0") as Kn5GroupNode;
    expect(start?.kind).toBe("node");
    for (const i of [0, 4, 8]) expect(Math.hypot(start.transform[i], start.transform[i + 1], start.transform[i + 2])).toBeCloseTo(1, 5);
  });
});

describe.skipIf(!HAVE_BUILD)("kn5 files in a real build", () => {
  it("reads every kn5, and writes each back byte for byte", () => {
    const files = buildFiles((n) => n.endsWith(".kn5"));
    expect(Object.keys(files).length).toBeGreaterThan(0);
    for (const [name, data] of Object.entries(files)) {
      const m = readKn5(data);
      expect(m.root.kind, name).toBe("node");
      const mats = new Set(m.materials.map((x) => x.name));
      const texs = new Set(m.textures.map((x) => x.name));
      for (const mesh of meshes(m.root)) expect(mats.has(mesh.material), `${name}:${mesh.name}`).toBe(true);
      for (const mat of m.materials) for (const t of Object.values(mat.textures)) expect(texs.has(t), `${name}:${mat.name}`).toBe(true);
      expect(Buffer.from(writeKn5(m)).equals(Buffer.from(data)), name).toBe(true);
      if (/layout_/.test(name)) {
        const dummies = new Map(m.root.children.filter((c) => c.kind === "node").map((c) => [c.name, c as Kn5GroupNode]));
        expect(dummies.has("AC_START_0"), name).toBe(true);
        for (const d of dummies.values()) {
          if (!/^AC_(START|TIME|PIT)/.test(d.name)) continue;
          for (const i of [0, 4, 8]) expect(Math.hypot(d.transform[i], d.transform[i + 1], d.transform[i + 2])).toBeCloseTo(1, 4);
        }
      }
    }
  }, 600_000);
});
