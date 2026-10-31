// Mesh accumulator in the build's local ENU frame (x east, y north, z up), converted to an AC
// mesh node (X east, Y up, Z south) at the end. Spec: docs/specs/mesh.md.
//
// The ENU -> AC map (x, y, z) -> (x, z, -y) is a proper rotation, so faces wound counter-clockwise
// from the front in ENU stay front-facing in AC.

import { MAX_MESH_VERTICES, type Kn5MeshNode } from "./kn5";

export type Vec3 = [x: number, y: number, z: number];

/** ENU to AC space. */
export const toAc = (x: number, y: number, z: number): Vec3 => [x, z, -y];

export class MeshBuilder {
  /** ENU positions, three numbers per vertex, in push order. */
  readonly positions = [] as number[];
  /** Two numbers per vertex. */
  readonly uvs = [] as number[];
  /** Triangle list. */
  readonly indices = [] as number[];
  /** Explicit ENU normals (three per vertex), or null to compute them from the faces. */
  normals = null as number[] | null;

  get vertexCount() {
    return this.positions.length / 3;
  }

  /** Adds a vertex and returns its index. */
  vertex([x, y, z]: Vec3, u: number, v: number) {
    const added = this.vertexCount;
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    return added;
  }

  tri(i0: number, i1: number, i2: number) {
    this.indices.push(i0, i1, i2);
  }

  /** Two triangles; corners counter-clockwise seen from the front. */
  quad(i0: number, i1: number, i2: number, i3: number) {
    this.indices.push(i0, i1, i2, i0, i2, i3);
  }

  toKn5(name: string, material: string, extra: Partial<Kn5MeshNode> = {}): Kn5MeshNode {
    const vertices = this.vertexCount;
    if (vertices > MAX_MESH_VERTICES) throw new Error(`${name}: ${vertices} vertices exceeds kn5 limit`);
    this.check(name, vertices);
    const enu = this.normals ?? this.computedNormals();
    return {
      kind: "mesh",
      name,
      positions: rotated(this.positions),
      normals: rotated(enu),
      uvs: new Float32Array(this.uvs),
      indices: new Uint16Array(this.indices),
      material,
      ...extra,
    };
  }

  /** Throws, naming the mesh, on input that would otherwise give NaN or wrapped indices. */
  private check(name: string, vertices: number) {
    const fail = (what: string) => {
      throw new Error(`${name}: ${what}`);
    };
    if (this.uvs.length !== vertices * 2) fail(`${this.uvs.length} uv values for ${vertices} vertices`);
    if (this.normals && this.normals.length !== vertices * 3) fail(`${this.normals.length} normal values for ${vertices} vertices`);
    if (this.indices.length % 3) fail(`${this.indices.length} indices is not a whole number of triangles`);
    const bad = this.indices.find((i) => !Number.isInteger(i) || i < 0 || i >= vertices);
    if (bad !== undefined) fail(`index ${bad} out of range (${vertices} vertices)`);
  }

  /**
   * Area-weighted vertex normals: each triangle's unnormalised cross product added to its three
   * vertices (in a float32 accumulator), then normalised. A vertex in no triangle, or only in
   * zero-area ones, gets (0, 0, 0); the kn5 writer copes with that.
   */
  private computedNormals(): Float32Array {
    const pos = this.positions, tris = this.indices;
    const sum = new Float32Array(pos.length);
    for (let k = 0; k + 2 < tris.length; k += 3) {
      const [i0, i1, i2] = [tris[k] * 3, tris[k + 1] * 3, tris[k + 2] * 3];
      const e1 = [pos[i1] - pos[i0], pos[i1 + 1] - pos[i0 + 1], pos[i1 + 2] - pos[i0 + 2]];
      const e2 = [pos[i2] - pos[i0], pos[i2 + 1] - pos[i0 + 1], pos[i2 + 2] - pos[i0 + 2]];
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      for (const at of [i0, i1, i2]) for (let c = 0; c < 3; c++) sum[at + c] += cross[c];
    }
    for (let at = 0; at < sum.length; at += 3) {
      const length = Math.hypot(sum[at], sum[at + 1], sum[at + 2]) || 1;
      for (let c = 0; c < 3; c++) sum[at + c] /= length;
    }
    return sum;
  }
}

/** ENU triples to AC triples, as float32. */
function rotated(enu: ArrayLike<number>): Float32Array {
  const ac = new Float32Array(enu.length);
  for (let at = 0; at < enu.length; at += 3) {
    ac[at] = enu[at];
    ac[at + 1] = enu[at + 2];
    ac[at + 2] = -enu[at + 1];
  }
  return ac;
}
