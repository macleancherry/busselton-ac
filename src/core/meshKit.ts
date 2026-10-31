// Busselton fork: small mesh helpers shared across the generators (docs/specs/scenery.md):
// a box with explicit normals, and an accumulator that splits output into kn5-sized meshes.
//
// Frame: local ENU (x east, y north, z up), as MeshBuilder expects.

import type { Vec2 } from "./geo";
import { MAX_MESH_VERTICES } from "./kn5";
import { MeshBuilder } from "./mesh";

/** Head room kept under the kn5 vertex limit, for callers that guess an item's size a little low. */
const HEADROOM = 64;

/**
 * Hands out mesh builders, moving on to a fresh one before the next item would take the current one
 * past the kn5 per-mesh vertex limit. Every builder has explicit normals switched on.
 */
export class ChunkedMesh {
  private readonly builders: MeshBuilder[] = [];

  /** `perItem`: the vertex count `next()` assumes when not told. */
  constructor(private readonly perItem = 0) {}

  /** The builder to draw the next item (`verts` vertices) into. */
  next(verts: number = this.perItem): MeshBuilder {
    const need = Math.max(0, verts);
    let cur = this.builders[this.builders.length - 1];
    if (!cur || (cur.vertexCount > 0 && cur.vertexCount + need > MAX_MESH_VERTICES - HEADROOM)) {
      cur = new MeshBuilder();
      cur.normals = [];
      this.builders.push(cur);
    }
    return cur;
  }

  /** The builders with anything in them, in the order they were started. */
  all(): MeshBuilder[] { // non-empty, in order
    return this.builders.filter((b) => b.vertexCount > 0);
  }
}

/** Per-side [u0, u1] for box(); a missing side runs 0 to 1. */
export type SideUv = ([number, number] | undefined)[];

/**
 * A closed-sided box with a top and no bottom: centred on `at`, `length` along `along`, `depth`
 * across, from `z0` up to `z1`. Each face has its own vertices and a flat normal.
 *
 * Corners go back-right, front-right, front-left, back-left (relative to `along`), and side k joins
 * corner k to corner k + 1: side 0 faces right, 1 forward, 2 left, 3 back. Side v runs 1 at the
 * bottom to 0 at the top; the top's UVs are all 0.
 */
export function box(mb: MeshBuilder, at: Vec2, along: Vec2, length: number, depth: number, z0: number, z1: number, sideUv?: SideUv): void {
  const l = Math.hypot(along[0], along[1]) || 1;
  const fx = along[0] / l, fy = along[1] / l;
  // Right of the length direction.
  const rx = fy, ry = -fx;
  const hl = length / 2, hd = depth / 2;
  const corner = (f: number, r: number): Vec2 => [at[0] + fx * f * hl + rx * r * hd, at[1] + fy * f * hl + ry * r * hd];
  const c: Vec2[] = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
  // Explicit normals: on for an empty builder, kept off for one already filled without them.
  if (mb.normals === null && mb.vertexCount === 0) mb.normals = [];
  const nrm = mb.normals;
  const put = (n: [number, number, number], count: number) => {
    if (nrm) for (let k = 0; k < count; k++) nrm.push(n[0], n[1], n[2]);
  };
  for (let side = 0; side < 4; side++) {
    const from = c[side], to = c[(side + 1) % 4];
    const [u0, u1] = sideUv?.[side] ?? [0, 1];
    // Outward: the right-hand perpendicular of from -> to (the corners run counter-clockwise from above).
    const runX = to[0] - from[0], runY = to[1] - from[1], run = Math.hypot(runX, runY) || 1;
    const i0 = mb.vertex([from[0], from[1], z0], u0, 1);
    const i1 = mb.vertex([to[0], to[1], z0], u1, 1);
    const i2 = mb.vertex([to[0], to[1], z1], u1, 0);
    const i3 = mb.vertex([from[0], from[1], z1], u0, 0);
    mb.quad(i0, i1, i2, i3);
    put([runY / run, -runX / run, 0], 4);
  }
  const t = c.map((p) => mb.vertex([p[0], p[1], z1], 0, 0));
  mb.quad(t[0], t[1], t[2], t[3]);
  put([0, 0, 1], 4);
}
