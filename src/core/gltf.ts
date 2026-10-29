// Busselton fork: glTF (binary .glb) to and from kn5, for working on a track in Blender.
//
//  - kn5ToGlb: the generated track (or the part of it around a spot) with its textures, for Blender
//    to import as the reference to model against.
//  - glbToKn5: a model exported from Blender back into a kn5 for a hand-made layer (no ksEditor).
//
// Both use AC's world coordinates unchanged (x east, y up, z south: right-handed and Y-up, as glTF
// is), and the same winding and UV origin (v = 0 at the image's top), so a model made against the
// exported base comes back exactly where it was made. Blender's glTF importer and exporter convert
// to and from its Z-up on their own.

import { decodeDds } from "./dds";
import { IDENTITY, type Kn5Material, type Kn5MeshNode, type Kn5Model, type Kn5Node, type Kn5Texture } from "./kn5";
import { encodePng } from "./png";

const enc = new TextEncoder();
const pad4 = (n: number) => (n + 3) & ~3;

function toPng(tex: Kn5Texture): Uint8Array | null {
  const d = tex.data;
  if (d[0] === 0x89 && d[1] === 0x50) return d; // already a PNG
  if (d[0] === 0x44 && d[1] === 0x44 && d[2] === 0x53) {
    try {
      const { rgba, width, height } = decodeDds(d);
      return encodePng(rgba, width, height, { alpha: true });
    } catch {
      return null;
    }
  }
  return null;
}

/** p * M for kn5's row-major transforms (translation in [12..14]). */
function apply(m: number[], x: number, y: number, z: number, w = 1): [number, number, number] {
  return [x * m[0] + y * m[4] + z * m[8] + w * m[12], x * m[1] + y * m[5] + z * m[9] + w * m[13], x * m[2] + y * m[6] + z * m[10] + w * m[14]];
}
function mul(a: number[], b: number[]): number[] {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return out;
}

export interface GlbExportOptions {
  /** Only triangles within `radius` metres of `centre` ([x, z] in AC world coordinates). */
  centre?: [number, number];
  radius?: number;
}

export function kn5ToGlb(model: Kn5Model, o: GlbExportOptions = {}): Uint8Array {
  const bin: Uint8Array[] = [];
  let binLength = 0;
  const bufferViews: Record<string, unknown>[] = [], accessors: Record<string, unknown>[] = [];
  const addView = (bytes: Uint8Array, target?: number) => {
    const offset = binLength;
    bin.push(bytes);
    const padded = pad4(bytes.length);
    if (padded > bytes.length) bin.push(new Uint8Array(padded - bytes.length));
    binLength += padded;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    return bufferViews.length - 1;
  };
  const addAccessor = (arr: Float32Array | Uint32Array, type: "VEC3" | "VEC2" | "SCALAR", target: number, minmax = false) => {
    const view = addView(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength), target);
    const n = { VEC3: 3, VEC2: 2, SCALAR: 1 }[type];
    const acc: Record<string, unknown> = { bufferView: view, componentType: arr instanceof Float32Array ? 5126 : 5125, count: arr.length / n, type };
    if (minmax) {
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < arr.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], arr[i + k]); mx[k] = Math.max(mx[k], arr[i + k]); }
      Object.assign(acc, { min: mn, max: mx });
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  // Materials and their textures, as they're used.
  const texByName = new Map(model.textures.map((t) => [t.name, t]));
  const matByName = new Map(model.materials.map((m) => [m.name, m]));
  const images: Record<string, unknown>[] = [], textures: Record<string, unknown>[] = [], materials: Record<string, unknown>[] = [];
  const imageIndex = new Map<string, number>(), materialIndex = new Map<string, number>();
  const materialFor = (name: string): number => {
    if (materialIndex.has(name)) return materialIndex.get(name)!;
    const m = matByName.get(name);
    const tname = m?.textures.txDiffuse;
    let texture: number | undefined;
    if (tname && texByName.has(tname)) {
      if (!imageIndex.has(tname)) {
        const png = toPng(texByName.get(tname)!);
        if (png) {
          images.push({ name: tname, mimeType: "image/png", bufferView: addView(png) });
          textures.push({ source: images.length - 1, sampler: 0 });
          imageIndex.set(tname, textures.length - 1);
        } else imageIndex.set(tname, -1);
      }
      const ti = imageIndex.get(tname)!;
      if (ti >= 0) texture = ti;
    }
    materials.push({
      name,
      pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.85, ...(texture !== undefined ? { baseColorTexture: { index: texture } } : { baseColorFactor: [0.6, 0.6, 0.6, 1] }) },
      ...(m?.alphaTested ? { alphaMode: "MASK", alphaCutoff: 0.5 } : {}),
      doubleSided: true,
    });
    materialIndex.set(name, materials.length - 1);
    return materials.length - 1;
  };

  const meshes: Record<string, unknown>[] = [], nodes: Record<string, unknown>[] = [];
  const r2 = (o.radius ?? Infinity) ** 2;
  const walk = (n: Kn5Node, parent: number[]) => {
    if (n.kind === "node") {
      const m = mul(n.transform, parent);
      n.children.forEach((c) => walk(c, m));
      return;
    }
    if (n.renderable === false || !n.indices.length) return;
    // Triangles within the radius (by their middle), with the vertices they use.
    const keep: number[] = [];
    for (let t = 0; t < n.indices.length; t += 3) {
      if (o.centre) {
        let cx = 0, cz = 0;
        for (let k = 0; k < 3; k++) {
          const p = apply(parent, n.positions[n.indices[t + k] * 3], n.positions[n.indices[t + k] * 3 + 1], n.positions[n.indices[t + k] * 3 + 2]);
          cx += p[0] / 3; cz += p[2] / 3;
        }
        if ((cx - o.centre[0]) ** 2 + (cz - o.centre[1]) ** 2 > r2) continue;
      }
      keep.push(t);
    }
    if (!keep.length) return;
    const remap = new Map<number, number>();
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const t of keep) {
      for (let k = 0; k < 3; k++) {
        const vi = n.indices[t + k];
        if (!remap.has(vi)) {
          remap.set(vi, pos.length / 3);
          pos.push(...apply(parent, n.positions[vi * 3], n.positions[vi * 3 + 1], n.positions[vi * 3 + 2]));
          const nn = apply(parent, n.normals[vi * 3], n.normals[vi * 3 + 1], n.normals[vi * 3 + 2], 0);
          const l = Math.hypot(...nn) || 1;
          nor.push(nn[0] / l, nn[1] / l, nn[2] / l);
          uv.push(n.uvs[vi * 2], n.uvs[vi * 2 + 1]);
        }
        idx.push(remap.get(vi)!);
      }
    }
    meshes.push({
      name: n.name,
      primitives: [{
        attributes: {
          POSITION: addAccessor(Float32Array.from(pos), "VEC3", 34962, true),
          NORMAL: addAccessor(Float32Array.from(nor), "VEC3", 34962),
          TEXCOORD_0: addAccessor(Float32Array.from(uv), "VEC2", 34962),
        },
        indices: addAccessor(Uint32Array.from(idx), "SCALAR", 34963),
        material: materialFor(n.material),
      }],
    });
    nodes.push({ name: n.name, mesh: meshes.length - 1 });
  };
  walk(model.root, IDENTITY);

  const json = {
    asset: { version: "2.0", generator: "busselton-ac kn5ToGlb" },
    scene: 0,
    scenes: [{ name: model.root.name, nodes: nodes.map((_, i) => i) }],
    nodes, meshes, materials, accessors, bufferViews,
    ...(images.length ? { images, textures, samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }] } : {}),
    buffers: [{ byteLength: binLength }],
  };
  return glb(json, bin, binLength);
}

function glb(json: unknown, bin: Uint8Array[], binLength: number): Uint8Array {
  let j = enc.encode(JSON.stringify(json));
  const jl = pad4(j.length);
  if (jl > j.length) {
    const p = new Uint8Array(jl).fill(0x20);
    p.set(j);
    j = p;
  }
  const total = 12 + 8 + jl + 8 + binLength;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jl, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(j, 20);
  let o = 20 + jl;
  v.setUint32(o, binLength, true);
  v.setUint32(o + 4, 0x004e4942, true);
  o += 8;
  for (const b of bin) {
    out.set(b, o);
    o += b.length;
  }
  return out;
}

/* ---------------- glb -> kn5 ---------------- */

type GJson = {
  scene?: number; scenes?: { nodes: number[] }[];
  nodes?: { name?: string; mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: { name?: string; alphaMode?: string; pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number } } }[];
  textures?: { source?: number }[];
  images?: { bufferView?: number; mimeType?: string; name?: string }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews?: { byteOffset?: number; byteLength: number; byteStride?: number }[];
};

/** Column-major glTF matrix (or TRS) to kn5's row-major form, which is its transpose. */
function nodeMatrix(n: NonNullable<GJson["nodes"]>[number]): number[] {
  if (n.matrix) return n.matrix.slice(); // glTF column-major = the row-vector convention kn5 uses
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  // Rotation matrix (row-vector form: rows are the rotated axes), scaled.
  const r = [
    1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qz * qw), 2 * (qx * qz - qy * qw),
    2 * (qx * qy - qz * qw), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz + qx * qw),
    2 * (qx * qz + qy * qw), 2 * (qy * qz - qx * qw), 1 - 2 * (qx * qx + qy * qy),
  ];
  return [r[0] * sx, r[1] * sx, r[2] * sx, 0, r[3] * sy, r[4] * sy, r[5] * sy, 0, r[6] * sz, r[7] * sz, r[8] * sz, 0, tx, ty, tz, 1];
}

export interface GlbImport {
  model: Kn5Model;
  /** Bounding box of everything, AC world coordinates [x, z] min and max. */
  min: [number, number];
  max: [number, number];
}

/** A Blender-exported .glb as a kn5 for a layer: every mesh baked into world coordinates, one kn5 mesh per primitive (split at 65,535 vertices). */
export function glbToKn5(data: Uint8Array, name: string, solidTexture: (rgb: [number, number, number]) => Uint8Array): GlbImport {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (v.getUint32(0, true) !== 0x46546c67) throw new Error("not a .glb file");
  let o = 12, json: GJson | null = null, bin: Uint8Array | null = null;
  while (o < data.length) {
    const len = v.getUint32(o, true), type = v.getUint32(o + 4, true);
    const chunk = data.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (type === 0x004e4942) bin = chunk;
    o += 8 + len;
  }
  if (!json || !bin) throw new Error("glb has no JSON or binary chunk");
  const J = json, B = bin;
  const view = (i: number) => {
    const bv = J.bufferViews![i];
    return { bytes: B.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength), stride: bv.byteStride };
  };
  const read = (ai: number): { n: number; get: (i: number, k: number) => number } => {
    const a = J.accessors![ai];
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type] ?? 1;
    const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[a.componentType] ?? 4;
    const { bytes, stride } = view(a.bufferView!);
    const dv = new DataView(bytes.buffer, bytes.byteOffset + (a.byteOffset ?? 0));
    const st = stride ?? comps * size;
    const get = (i: number, k: number) => {
      const off = i * st + k * size;
      switch (a.componentType) {
        case 5126: return dv.getFloat32(off, true);
        case 5125: return dv.getUint32(off, true);
        case 5123: return dv.getUint16(off, true);
        default: return dv.getUint8(off);
      }
    };
    return { n: a.count, get };
  };

  const textures: Kn5Texture[] = [], materials: Kn5Material[] = [];
  const matName = new Map<number, string>();
  const plain = (n: string, tex: string, alpha = false): Kn5Material => ({
    name: n, shader: alpha ? "ksPerPixelAT" : "ksPerPixel", ...(alpha ? { alphaTested: true } : {}),
    properties: [{ name: "ksAmbient", a: 0.45 }, { name: "ksDiffuse", a: 0.45 }, { name: "ksSpecular", a: 0.1 }, { name: "ksSpecularEXP", a: 10 }, { name: "ksEmissive", c: [0, 0, 0] }, { name: "ksAlphaRef", a: 0 }],
    textures: { txDiffuse: tex },
  });
  const materialFor = (mi: number | undefined): string => {
    const key = mi ?? -1;
    if (matName.has(key)) return matName.get(key)!;
    const m = mi !== undefined ? J.materials?.[mi] : undefined;
    const mname = `${name}_${(m?.name ?? `mat${key}`).replace(/[^A-Za-z0-9_]/g, "_")}`;
    const ti = m?.pbrMetallicRoughness?.baseColorTexture?.index;
    const img = ti !== undefined ? J.images?.[J.textures?.[ti]?.source ?? -1] : undefined;
    let tex: string;
    if (img?.bufferView !== undefined) {
      const ext = img.mimeType === "image/jpeg" ? "jpg" : "png";
      tex = `${mname}.${ext}`;
      textures.push({ name: tex, data: view(img.bufferView).bytes.slice() });
    } else {
      const f = m?.pbrMetallicRoughness?.baseColorFactor ?? [0.8, 0.8, 0.8, 1];
      const srgb = (c: number) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
      tex = `${mname}.png`;
      textures.push({ name: tex, data: solidTexture([srgb(f[0]), srgb(f[1]), srgb(f[2])]) });
    }
    materials.push(plain(mname, tex, m?.alphaMode === "MASK"));
    matName.set(key, mname);
    return mname;
  };

  const out: Kn5MeshNode[] = [];
  const mn: [number, number] = [Infinity, Infinity], mx: [number, number] = [-Infinity, -Infinity];
  const visit = (ni: number, parent: number[]) => {
    const node = J.nodes![ni];
    const m = mul(nodeMatrix(node), parent);
    if (node.mesh !== undefined) {
      J.meshes![node.mesh].primitives.forEach((p, pi) => {
        if ((p.mode ?? 4) !== 4) return;
        const P = read(p.attributes.POSITION), N = p.attributes.NORMAL !== undefined ? read(p.attributes.NORMAL) : null;
        const T = p.attributes.TEXCOORD_0 !== undefined ? read(p.attributes.TEXCOORD_0) : null;
        const I = p.indices !== undefined ? read(p.indices) : null;
        const tri = I ? Array.from({ length: I.n }, (_, i) => I.get(i, 0)) : Array.from({ length: P.n }, (_, i) => i);
        const mat = materialFor(p.material);
        const base = (node.name ?? J.meshes![node.mesh!].name ?? `mesh${ni}`).replace(/[^A-Za-z0-9_]/g, "_");
        // Split into pieces of at most 65,535 vertices (kn5 indices are 16-bit).
        let part = 0;
        for (let t0 = 0; t0 < tri.length;) {
          const remap = new Map<number, number>();
          const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
          let t = t0;
          for (; t < tri.length; t += 3) {
            const fresh = [0, 1, 2].filter((k) => !remap.has(tri[t + k])).length;
            if (remap.size + fresh > 65535) break;
            for (let k = 0; k < 3; k++) {
              const vi = tri[t + k];
              if (!remap.has(vi)) {
                remap.set(vi, pos.length / 3);
                const q = apply(m, P.get(vi, 0), P.get(vi, 1), P.get(vi, 2));
                pos.push(...q);
                mn[0] = Math.min(mn[0], q[0]); mn[1] = Math.min(mn[1], q[2]); mx[0] = Math.max(mx[0], q[0]); mx[1] = Math.max(mx[1], q[2]);
                const nn = N ? apply(m, N.get(vi, 0), N.get(vi, 1), N.get(vi, 2), 0) : [0, 1, 0];
                const l = Math.hypot(nn[0], nn[1], nn[2]) || 1;
                nor.push(nn[0] / l, nn[1] / l, nn[2] / l);
                uv.push(T ? T.get(vi, 0) : 0, T ? T.get(vi, 1) : 0);
              }
              idx.push(remap.get(vi)!);
            }
          }
          out.push({
            kind: "mesh", name: `${base}${pi || part ? `_${pi}_${part}` : ""}`,
            positions: Float32Array.from(pos), normals: Float32Array.from(nor), uvs: Float32Array.from(uv), indices: Uint16Array.from(idx),
            material: mat,
          });
          part++;
          t0 = t;
        }
      });
    }
    for (const c of node.children ?? []) visit(c, m);
  };
  for (const ni of J.scenes?.[J.scene ?? 0]?.nodes ?? []) visit(ni, IDENTITY);
  return { model: { textures, materials, root: { kind: "node", name, transform: IDENTITY, children: out } }, min: mn, max: mx };
}
