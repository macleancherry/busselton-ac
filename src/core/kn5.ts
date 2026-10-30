// kn5 model files (Assetto Corsa): writer, reader and node transform helpers.
// Written from docs/specs/kn5.md and the public format notes it cites (AcTools Kn5 types,
// Hagnhofer's Blender exporter notes, the CSP shader texture declarations).

import { ByteSink, ByteSource } from "./binary";

/** A texture: `data` is a whole PNG or DDS file, stored as is. */
export type Kn5Texture = { name: string; data: Uint8Array };

/** A shader property; missing values are written as zeros. */
export type Kn5ShaderProperty = { name: string; a?: number; b?: number[]; c?: number[]; d?: number[] };

/**
 * A material. `textures` maps a shader slot (txDiffuse, txNormal, ...) to a texture name;
 * `registers` is filled in by the reader (the register each slot was stored with) and ignored by the writer.
 */
export type Kn5Material = {
  name: string; shader: string;
  blendMode?: number; alphaTested?: boolean; depthMode?: number;
  properties: Kn5ShaderProperty[];
  textures: Record<string, string>; registers?: Record<string, number>;
};

/** A group node (also AC's dummies). `transform`: X axis 0-2, Y axis 4-6, Z axis 8-10, position 12-14, 15 = 1. */
export type Kn5GroupNode = { kind: "node"; name: string; transform: number[]; children: Kn5Node[] };

/** A mesh: three floats per vertex for positions, normals and tangents, two for uvs; `material` is a name. */
export type Kn5MeshNode = {
  kind: "mesh"; name: string; material: string;
  positions: Float32Array; normals: Float32Array; uvs: Float32Array; tangents?: Float32Array; indices: Uint16Array;
  castShadows?: boolean; visible?: boolean; transparent?: boolean; renderable?: boolean;
  layer?: number; lodIn?: number; lodOut?: number;
};

export type Kn5Node = Kn5MeshNode | Kn5GroupNode;

export type Kn5Model = { textures: Kn5Texture[]; materials: Kn5Material[]; root: Kn5GroupNode };

/** Indices are 16-bit, so no mesh can have more vertices than this. */
export const MAX_MESH_VERTICES = 0xffff;

export const IDENTITY: number[] = [1, 0, 0, 0, /**/ 0, 1, 0, 0, /**/ 0, 0, 1, 0, /**/ 0, 0, 0, 1];

/** Kunos's material blend modes (as Content Manager names them). */
export const BlendMode = Object.freeze({ Opaque: 0, AlphaBlend: 1, AlphaToCoverage: 2 } as const);
/** Kunos's material depth modes. */
export const DepthMode = Object.freeze({ Normal: 0, NoWrite: 1, Off: 2 } as const);

const MAGIC = "sc6969";
const WRITE_VERSION = 5;
const NODE_GROUP = 1;
const NODE_MESH = 2;
const VERTEX_FLOATS = 11;

/** Shader register of each texture slot, as the Kunos shaders declare them. */
const SLOTS_BY_REGISTER: string[][] = [
  ["txDiffuse"],
  ["txNormal", "txMask", "txVariation"],
  ["txMaps", "txDetailR"],
  ["txDetail", "txDetailG"],
  ["txNormalDetail", "txDetailB"],
  ["txDetailA"],
  ["txDetailNM"],
];
const SLOT_REGISTER: Record<string, number> = Object.fromEntries(
  SLOTS_BY_REGISTER.flatMap((slots, register) => slots.map((slot) => [slot, register])),
);

type Vec = [number, number, number];

const crossOf = (p: ArrayLike<number>, q: ArrayLike<number>): Vec => [
  p[1] * q[2] - p[2] * q[1],
  p[2] * q[0] - p[0] * q[2],
  p[0] * q[1] - p[1] * q[0],
];
const dotOf = (p: ArrayLike<number>, q: ArrayLike<number>): number => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const lengthOf = (p: ArrayLike<number>): number => Math.sqrt(dotOf(p, p));
const scaled = (p: ArrayLike<number>, k: number): Vec => [p[0] * k, p[1] * k, p[2] * k];

/**
 * A node transform with local Z along `forward`, local Y as close to `up` as possible and
 * X = Y x Z completing a right-handed frame, placed at `position`. Throws on a zero `forward`.
 */
export function frameTransform(position: ArrayLike<number>, forward: ArrayLike<number>, up: ArrayLike<number> = [0, 1, 0]): number[] {
  const len = lengthOf(forward);
  if (!(len > 0 && Number.isFinite(len))) throw new Error("frameTransform: forward has no direction");
  const zAxis = scaled(forward, 1 / len);
  let side = crossOf(up, zAxis);
  if (lengthOf(side) <= 1e-9) {
    // forward is parallel to up: use world X (or world Z) with its forward component removed.
    side = [1, 0, 0];
    side = [side[0] - zAxis[0] * zAxis[0], -zAxis[0] * zAxis[1], -zAxis[0] * zAxis[2]];
    if (lengthOf(side) <= 1e-6) side = [-zAxis[2] * zAxis[0], -zAxis[2] * zAxis[1], 1 - zAxis[2] * zAxis[2]];
  }
  const xAxis = scaled(side, 1 / lengthOf(side));
  const yAxis = crossOf(zAxis, xAxis);
  return [...xAxis, 0, ...yAxis, 0, ...zAxis, 0, position[0], position[1], position[2], 1];
}

/** Per-vertex tangents: the direction of increasing u, made perpendicular to the normal, unit length. */
function tangentsFor(mesh: Kn5MeshNode): Float32Array {
  const { positions: pos, normals: nrm, uvs: tex, indices: tri } = mesh;
  const count = pos.length / 3;
  const sum = new Float64Array(count * 3);
  for (let t = 0; t + 2 < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    const ab: Vec = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]];
    const ac: Vec = [pos[c * 3] - pos[a * 3], pos[c * 3 + 1] - pos[a * 3 + 1], pos[c * 3 + 2] - pos[a * 3 + 2]];
    const uAB = tex[b * 2] - tex[a * 2], vAB = tex[b * 2 + 1] - tex[a * 2 + 1];
    const uAC = tex[c * 2] - tex[a * 2], vAC = tex[c * 2 + 1] - tex[a * 2 + 1];
    const area = uAB * vAC - uAC * vAB;
    if (area === 0 || !Number.isFinite(area)) continue; // no u direction on this triangle
    const dir = [0, 1, 2].map((k) => (ab[k] * vAC - ac[k] * vAB) / area);
    if (!dir.every(Number.isFinite)) continue;
    for (const corner of [a, b, c]) for (let k = 0; k < 3; k++) sum[corner * 3 + k] += dir[k];
  }
  const result = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    let normal: Vec = [nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]];
    const nl = lengthOf(normal);
    normal = nl > 0 && Number.isFinite(nl) ? scaled(normal, 1 / nl) : [0, 1, 0];
    const raw: Vec = [sum[v * 3], sum[v * 3 + 1], sum[v * 3 + 2]];
    let along = raw.map((x, k) => x - normal[k] * dotOf(raw, normal)) as Vec;
    if (!(lengthOf(along) > 1e-12) || !Number.isFinite(lengthOf(along))) {
      // No UV direction: any unit vector perpendicular to the normal.
      const ref: Vec = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1];
      along = ref.map((x, k) => x - normal[k] * dotOf(ref, normal)) as Vec;
    }
    result.set(scaled(along, 1 / lengthOf(along)), v * 3);
  }
  return result;
}

/** Bounding sphere: centre of the axis-aligned box, radius to the farthest vertex from that centre. */
function sphereOf(pos: Float32Array): [number, number, number, number] {
  if (pos.length === 0) return [0, 0, 0, 0];
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let at = 0; at < pos.length; at += 3) {
    for (let k = 0; k < 3; k++) {
      if (pos[at + k] < lo[k]) lo[k] = pos[at + k];
      if (pos[at + k] > hi[k]) hi[k] = pos[at + k];
    }
  }
  const mid = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  let far = 0;
  for (let at = 0; at < pos.length; at += 3) {
    const ex = pos[at] - mid[0], ey = pos[at + 1] - mid[1], ez = pos[at + 2] - mid[2];
    far = Math.max(far, ex * ex + ey * ey + ez * ez);
  }
  return [mid[0], mid[1], mid[2], Math.sqrt(far)];
}

function validateMesh(mesh: Kn5MeshNode, known: Map<string, number>): void {
  const fail = (why: string) => {
    throw new Error(`kn5 mesh "${mesh.name}": ${why}`);
  };
  if (!known.has(mesh.material)) fail(`material "${mesh.material}" isn't in the model`);
  if (mesh.positions.length % 3) fail(`positions length ${mesh.positions.length} isn't a multiple of 3`);
  const verts = mesh.positions.length / 3;
  if (verts > MAX_MESH_VERTICES) fail(`${verts} vertices, more than ${MAX_MESH_VERTICES}`);
  if (mesh.normals.length !== verts * 3) fail(`${mesh.normals.length / 3} normals for ${verts} vertices`);
  if (mesh.uvs.length !== verts * 2) fail(`${mesh.uvs.length / 2} uvs for ${verts} vertices`);
  if (mesh.tangents && mesh.tangents.length !== verts * 3) fail(`${mesh.tangents.length / 3} tangents for ${verts} vertices`);
  if (mesh.indices.length % 3) fail(`index count ${mesh.indices.length} isn't a multiple of 3`);
  const top = mesh.indices.reduce((m, x) => (x > m ? x : m), -1);
  if (top >= verts) fail(`index ${top} is past the vertex count ${verts}`);
}

/** The kn5 file for a model. Throws on invalid input, naming the node, material or texture. */
export function writeKn5(kn5: Kn5Model): Uint8Array {
  const haveTexture = new Set<string>();
  let imageBytes = 0;
  kn5.textures.forEach(({ name, data }) => {
    if (haveTexture.has(name)) throw new Error(`kn5: two textures named "${name}"`);
    haveTexture.add(name);
    imageBytes += data.length + 3 * name.length + 12;
  });
  const materialAt = new Map<string, number>();
  kn5.materials.forEach((mat, at) => {
    if (materialAt.has(mat.name)) throw new Error(`kn5: two materials named "${mat.name}"`);
    materialAt.set(mat.name, at);
    for (const slot in mat.textures) {
      const tex = mat.textures[slot];
      if (!haveTexture.has(tex)) throw new Error(`kn5 material "${mat.name}": texture "${tex}" (${slot}) isn't in the model`);
      if (SLOT_REGISTER[slot] === undefined) throw new Error(`kn5 material "${mat.name}": unknown texture slot "${slot}" (no known register)`);
    }
  });

  const sink = new ByteSink(imageBytes + (1 << 20));
  sink.text(MAGIC).uint32(WRITE_VERSION);

  sink.uint32(kn5.textures.length);
  kn5.textures.forEach(({ name, data }) => sink.int32(1).str(name).blob(data));

  sink.uint32(kn5.materials.length);
  kn5.materials.forEach((mat) => {
    sink.str(mat.name).str(mat.shader);
    sink.byte(mat.blendMode ?? BlendMode.Opaque).flag(mat.alphaTested ?? false).int32(mat.depthMode ?? DepthMode.Normal);
    sink.uint32(mat.properties.length);
    mat.properties.forEach((prop) => {
      sink.str(prop.name).float(prop.a ?? 0);
      [prop.b, prop.c, prop.d].forEach((vals, k) => {
        for (let j = 0; j < k + 2; j++) sink.float(vals?.[j] ?? 0);
      });
    });
    const mapping = Object.entries(mat.textures);
    sink.uint32(mapping.length);
    mapping.forEach(([slot, tex]) => sink.str(slot).uint32(SLOT_REGISTER[slot]).str(tex));
  });

  const emit = (item: Kn5Node): void => {
    if (item.kind === "mesh") {
      emitMesh(item);
      return;
    }
    if (!Array.isArray(item.transform) || item.transform.length !== 16) {
      throw new Error(`kn5 node "${item.name}": transform must have 16 numbers`);
    }
    sink.uint32(NODE_GROUP).str(item.name).uint32(item.children.length).flag(true).floats(item.transform);
    item.children.forEach(emit);
  };
  const emitMesh = (mesh: Kn5MeshNode): void => {
    validateMesh(mesh, materialAt);
    sink.uint32(NODE_MESH).str(mesh.name).uint32(0).flag(true);
    sink.flag(mesh.castShadows ?? true).flag(mesh.visible ?? true).flag(mesh.transparent ?? false);
    const verts = mesh.positions.length / 3;
    const tan = mesh.tangents ?? tangentsFor(mesh);
    const interleaved = new Float32Array(verts * VERTEX_FLOATS);
    for (let v = 0, o = 0; v < verts; v++, o += VERTEX_FLOATS) {
      interleaved.set(mesh.positions.subarray(v * 3, v * 3 + 3), o);
      interleaved.set(mesh.normals.subarray(v * 3, v * 3 + 3), o + 3);
      interleaved.set(mesh.uvs.subarray(v * 2, v * 2 + 2), o + 6);
      interleaved.set(tan.subarray(v * 3, v * 3 + 3), o + 8);
    }
    sink.uint32(verts).floats(interleaved);
    sink.uint32(mesh.indices.length);
    mesh.indices.forEach((ix) => sink.uint16(ix));
    sink.uint32(materialAt.get(mesh.material)!).uint32(mesh.layer ?? 0).float(mesh.lodIn ?? 0).float(mesh.lodOut ?? 0);
    sink.floats(sphereOf(mesh.positions));
    sink.flag(mesh.renderable ?? true);
  };
  emit(kn5.root);
  return sink.bytes();
}

/** Parses a kn5 into the model shape (valid input to writeKn5), plus the file's version. */
export function readKn5(bytes: Uint8Array): Kn5Model & { version: number } {
  const src = new ByteSource(bytes);
  if (bytes.length < MAGIC.length || src.text(MAGIC.length) !== MAGIC) throw new Error("not a kn5 file");
  const fileVersion = src.uint32();
  if (fileVersion > WRITE_VERSION) src.skip(4); // extra field of version 6 files

  const textureList: Kn5Texture[] = Array.from({ length: src.uint32() }, () => {
    src.skip(4); // active flag
    const texName = src.str();
    return { name: texName, data: src.blob() };
  });

  const materialList: Kn5Material[] = Array.from({ length: src.uint32() }, () => {
    const matName = src.str();
    const shader = src.str();
    const blendMode = src.byte();
    const alphaTested = src.flag();
    const depthMode = src.int32();
    const properties = Array.from({ length: src.uint32() }, () => ({
      name: src.str(),
      a: src.float(),
      b: Array.from(src.floats(2)),
      c: Array.from(src.floats(3)),
      d: Array.from(src.floats(4)),
    }));
    const textures: Record<string, string> = {};
    const registers: Record<string, number> = {};
    for (let k = src.uint32(); k > 0; k--) {
      const slotName = src.str();
      registers[slotName] = src.uint32();
      textures[slotName] = src.str();
    }
    return { name: matName, shader, blendMode, alphaTested, depthMode, properties, textures, registers };
  });

  const take = (): Kn5Node => {
    const nodeClass = src.uint32();
    const nodeName = src.str();
    const kids = src.uint32();
    src.skip(1); // active flag
    if (nodeClass === NODE_GROUP) {
      const transform = Array.from(src.floats(16));
      return { kind: "node", name: nodeName, transform, children: Array.from({ length: kids }, take) };
    }
    if (nodeClass !== NODE_MESH) throw new Error(`kn5 node "${nodeName}": unsupported node class ${nodeClass}`);
    if (kids !== 0) throw new Error(`kn5 mesh "${nodeName}": has ${kids} children`);
    const [castShadows, visible, transparent] = [src.flag(), src.flag(), src.flag()];
    const verts = src.uint32();
    const raw = src.floats(verts * VERTEX_FLOATS);
    const positions = new Float32Array(verts * 3);
    const normals = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    const tangents = new Float32Array(verts * 3);
    for (let v = 0, o = 0; v < verts; v++, o += VERTEX_FLOATS) {
      positions.set(raw.subarray(o, o + 3), v * 3);
      normals.set(raw.subarray(o + 3, o + 6), v * 3);
      uvs.set(raw.subarray(o + 6, o + 8), v * 2);
      tangents.set(raw.subarray(o + 8, o + 11), v * 3);
    }
    const indices = src.uint16s(src.uint32());
    const matIndex = src.uint32();
    if (matIndex >= materialList.length) throw new Error(`kn5 mesh "${nodeName}": material index ${matIndex} out of range`);
    const layer = src.uint32();
    const lodIn = src.float();
    const lodOut = src.float();
    src.skip(16); // bounding sphere
    return {
      kind: "mesh", name: nodeName, material: materialList[matIndex].name,
      positions, normals, uvs, tangents, indices,
      castShadows, visible, transparent, renderable: src.flag(), layer, lodIn, lodOut,
    };
  };

  const top = take();
  if (top.kind !== "node") throw new Error("kn5: root node isn't a group node");
  if (src.left) throw new Error(`kn5: ${src.left} bytes left over after the node tree`);
  return { textures: textureList, materials: materialList, root: top, version: fileVersion };
}
