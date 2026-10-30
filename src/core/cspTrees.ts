// Busselton fork: CSP's instanced 3D trees (the [TREES] section of ext_config). Research and the
// format notes are in docs/trees.md.
//
// A tree model is a .bin: a zip of tree.ini, one .mesh per level of detail and the textures. The
// .mesh layout follows Content Manager's tree converter (gro-ove/actools,
// AcTools.ExtraKn5Utils/Helpers/AcTreeModelConverter.cs, Ms-PL), which is what CSP reads:
//
//   i32 1, u8 0, i32 textureCount, then per texture: u32 xxHash32 of its bytes (0 -> 1), string name
//   per sub-mesh: i32 diffuse texture index, i32 normal texture index,
//                 i32 indexCount, u16 indices, i32 vertexCount, then 44-byte vertices:
//                 f32x3 position (normalised), f32x3 normal, f32x2 uv, u8x3 tangent, u8 0,
//                 f16x2 uv2 = 0, u8 ao0 = 255, u8 ao1 = 255, u8 wet = 255, u8 0
//   i32 -1, i32 4, f32 trunk width (normalised)
//
// Positions are normalised to the tree's box: x and z divided by the widest horizontal reach from
// the pivot (the middle of the base), y by the height; tree.ini's HEIGHT and WIDTH scale it back.
// Strings are an i32 byte length then UTF-8 (actools' ExtendedBinaryWriter, as in kn5). Winding is
// the converter's: it reverses the FBX order, so each of our counter-clockwise (a, b, c) triangles
// is written (a, c, b).
//
// The tree list (trees.txt) has a line per tree: `tree: name.bin; pos=x, y, z; angle=deg; size=s`,
// in AC world coordinates (x east, y up, z south). The axis order and the winding are what CM's
// converter and CSP's documentation say; a reference conversion in Content Manager confirms them
// (docs/trees.md, "Unconfirmed items").

import { zipSync } from "fflate";

/** xxHash32 (seed 0), as the converter uses for texture checksums. */
export function xxHash32(data: Uint8Array, seed = 0): number {
  const P1 = 2654435761, P2 = 2246822519, P3 = 3266489917, P4 = 668265263, P5 = 374761393;
  const rotl = (x: number, r: number) => ((x << r) | (x >>> (32 - r))) >>> 0;
  const mul = (a: number, b: number) => Math.imul(a, b) >>> 0;
  const u32 = (i: number) => (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0;
  const len = data.length;
  let i = 0, h: number;
  if (len >= 16) {
    let v1 = (seed + P1 + P2) >>> 0, v2 = (seed + P2) >>> 0, v3 = seed >>> 0, v4 = (seed - P1) >>> 0;
    const round = (v: number, input: number) => mul(rotl((v + mul(input, P2)) >>> 0, 13), P1);
    while (i <= len - 16) {
      v1 = round(v1, u32(i)); v2 = round(v2, u32(i + 4)); v3 = round(v3, u32(i + 8)); v4 = round(v4, u32(i + 12));
      i += 16;
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h = (seed + P5) >>> 0;
  }
  h = (h + len) >>> 0;
  while (i <= len - 4) {
    h = mul(rotl((h + mul(u32(i), P3)) >>> 0, 17), P4);
    i += 4;
  }
  while (i < len) {
    h = mul(rotl((h + mul(data[i], P5)) >>> 0, 11), P1);
    i++;
  }
  h = mul(h ^ (h >>> 15), P2);
  h = mul(h ^ (h >>> 13), P3);
  return (h ^ (h >>> 16)) >>> 0;
}

/** One sub-mesh of a level of detail: AC-space positions (metres, pivot at the base centre). */
export interface TreeSubMesh {
  diffuse: string;
  normal?: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  /** Counter-clockwise triangles, as our MeshBuilder makes them (after toAc). */
  indices: number[];
}

export interface TreeModel {
  name: string;
  /** Highest detail first. */
  lods: { subs: TreeSubMesh[]; distance: number }[];
  textures: Record<string, Uint8Array>;
  /** Extra tree.ini values ([SECTION] KEY = value). */
  ini?: Record<string, Record<string, string | number>>;
}

class Writer {
  private buf = new Uint8Array(1 << 16);
  private dv = new DataView(this.buf.buffer);
  len = 0;
  private need(n: number) {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.dv = new DataView(next.buffer);
  }
  i32(v: number) { this.need(4); this.dv.setInt32(this.len, v, true); this.len += 4; return this; }
  u32(v: number) { this.need(4); this.dv.setUint32(this.len, v >>> 0, true); this.len += 4; return this; }
  u16(v: number) { this.need(2); this.dv.setUint16(this.len, v, true); this.len += 2; return this; }
  u8(v: number) { this.need(1); this.dv.setUint8(this.len, v); this.len += 1; return this; }
  f32(v: number) { this.need(4); this.dv.setFloat32(this.len, v, true); this.len += 4; return this; }
  str(s: string) { const b = new TextEncoder().encode(s); this.i32(b.length); this.need(b.length); this.buf.set(b, this.len); this.len += b.length; return this; }
  bytes() { return this.buf.slice(0, this.len); }
}

/** Per-vertex tangents from positions, normals and uvs (the usual triangle accumulation). */
function tangents(p: number[], n: number[], uv: number[], idx: number[]): Float32Array {
  const t = new Float32Array(p.length);
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]];
    const e1 = [p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]];
    const e2 = [p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]];
    const du1 = uv[b * 2] - uv[a * 2], dv1 = uv[b * 2 + 1] - uv[a * 2 + 1], du2 = uv[c * 2] - uv[a * 2], dv2 = uv[c * 2 + 1] - uv[a * 2 + 1];
    const r = du1 * dv2 - du2 * dv1;
    const f = Math.abs(r) < 1e-12 ? 0 : 1 / r;
    for (const v of [a, b, c]) for (let k = 0; k < 3; k++) t[v * 3 + k] += (e1[k] * dv2 - e2[k] * dv1) * f;
  }
  for (let v = 0; v < t.length / 3; v++) {
    // Gram-Schmidt against the normal.
    const nx = n[v * 3], ny = n[v * 3 + 1], nz = n[v * 3 + 2];
    const d = t[v * 3] * nx + t[v * 3 + 1] * ny + t[v * 3 + 2] * nz;
    let x = t[v * 3] - nx * d, y = t[v * 3 + 1] - ny * d, z = t[v * 3 + 2] - nz * d;
    const l = Math.hypot(x, y, z);
    if (l < 1e-9) { x = 1; y = 0; z = 0; } else { x /= l; y /= l; z /= l; }
    t[v * 3] = x; t[v * 3 + 1] = y; t[v * 3 + 2] = z;
  }
  return t;
}

const toByte = (x: number) => Math.max(0, Math.min(255, Math.round(x * 127.5 + 127.5)));

/** Writes a tree model's .bin (a zip). */
export function writeTreeBin(model: TreeModel): Uint8Array {
  // The tree's box over every LOD (the converter takes it from all of them): height from the
  // ground, horizontal reach from the pivot.
  let height = 0, reach = 0;
  for (const lod of model.lods) for (const s of lod.subs) for (let i = 0; i < s.positions.length; i += 3) {
    height = Math.max(height, s.positions[i + 1]);
    reach = Math.max(reach, Math.abs(s.positions[i]), Math.abs(s.positions[i + 2]));
  }
  height = Math.max(height, 0.01);
  reach = Math.max(reach, 0.01);
  const texNames = [...new Set(model.lods.flatMap((l) => l.subs.flatMap((s) => [s.diffuse, ...(s.normal ? [s.normal] : [])])))];
  const files: Record<string, Uint8Array> = {};
  const lodNames: string[] = [];
  model.lods.forEach((lod, li) => {
    const w = new Writer();
    w.i32(1).u8(0).i32(texNames.length);
    for (const t of texNames) {
      const h = xxHash32(model.textures[t] ?? new Uint8Array());
      w.u32(h === 0 ? 1 : h).str(t);
    }
    let trunk = Infinity;
    for (const s of lod.subs) {
      w.i32(texNames.indexOf(s.diffuse)).i32(s.normal ? texNames.indexOf(s.normal) : -1);
      if (s.positions.length / 3 > 65535) throw new Error(`${model.name}: LOD ${li} has more than 65,535 vertices in one part`);
      w.i32(s.indices.length);
      for (let i = 0; i < s.indices.length; i += 3) w.u16(s.indices[i]).u16(s.indices[i + 2]).u16(s.indices[i + 1]);
      const tan = tangents(s.positions, s.normals, s.uvs, s.indices);
      const n = s.positions.length / 3;
      w.i32(n);
      for (let v = 0; v < n; v++) {
        const x = s.positions[v * 3] / reach, y = s.positions[v * 3 + 1] / height, z = s.positions[v * 3 + 2] / reach;
        w.f32(x).f32(y).f32(z);
        w.f32(s.normals[v * 3]).f32(s.normals[v * 3 + 1]).f32(s.normals[v * 3 + 2]);
        w.f32(s.uvs[v * 2]).f32(s.uvs[v * 2 + 1]);
        w.u8(toByte(tan[v * 3])).u8(toByte(tan[v * 3 + 1])).u8(toByte(tan[v * 3 + 2])).u8(0);
        w.u16(0).u16(0); // uv2 as two half floats (0)
        w.u8(255).u8(255).u8(255).u8(0);
        // The trunk's width at the base (as the converter finds it: vertices at the bottom near the pivot).
        if (y < 0.002 && Math.abs(x) < 0.2 && Math.abs(z) < 0.2) trunk = Math.min(trunk, Math.max(Math.abs(x), Math.abs(z)));
      }
    }
    if (Number.isFinite(trunk)) w.i32(-1).i32(4).f32(trunk);
    const name = `${model.name}_lod${li}.mesh`;
    files[name] = w.bytes();
    lodNames.push(name);
  });
  const ini: Record<string, Record<string, string | number>> = {
    BASIC: { HEIGHT: height.toFixed(3), WIDTH: (reach * 2).toFixed(3) },
    SHADING: { SPECULAR: "0.1", SUBSCATTERING: "0.5", REFLECTIVITY: "0.05", BRIGHTNESS: "1.0", USE_AO_CHANNEL: 1 },
    NORMALS: { BOOST: "0.9", SPHERE: "1.0" },
    LEAVES: { MULT: "20.0", OFFSET: "0.0" },
    FAKE_SHADOW: { SIZE: "1.0", OPACITY: "0.8" },
  };
  for (const [sec, kv] of Object.entries(model.ini ?? {})) ini[sec] = { ...(ini[sec] ?? {}), ...kv };
  model.lods.forEach((lod, i) => { ini[`LOD_${i}`] = { MODEL: lodNames[i], DISTANCE: lod.distance.toFixed(1) }; });
  files["tree.ini"] = new TextEncoder().encode(Object.entries(ini).map(([s, kv]) => `[${s}]\r\n` + Object.entries(kv).map(([k, v]) => `${k}=${v}`).join("\r\n")).join("\r\n\r\n") + "\r\n");
  for (const t of texNames) files[t] = model.textures[t];
  return zipSync(files, { level: 6 });
}

export interface PlacedTree {
  /** The model's file name (e.g. "peppermint.bin"). */
  model: string;
  /** AC world position: x east, y up (the ground), z south. */
  pos: [number, number, number];
  /** Degrees. */
  angle: number;
  size: number;
}

/** The tree list: grouped by model, with a little colour and brightness variety, and a soft shadow blob under each. */
export function treeList(trees: PlacedTree[]): string {
  const lines = [
    "# Generated by Busselton AC. CSP's instanced trees (ext_config [TREES] LIST_0).",
    "configure: color variance = 0.06",
    "configure: brightness variance = 0.12",
    "configure: fake shadow = 0.6",
  ];
  for (const t of [...trees].sort((a, b) => a.model.localeCompare(b.model))) {
    lines.push(`tree: ${t.model}; pos=${t.pos[0].toFixed(2)}, ${t.pos[1].toFixed(2)}, ${t.pos[2].toFixed(2)}; angle=${t.angle.toFixed(0)}; size=${t.size.toFixed(2)}`);
  }
  return lines.join("\r\n") + "\r\n";
}
