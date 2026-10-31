// Busselton fork: kerb faces for CSP's AO bakery. Retest 3: after a bake "the near kerb face goes
// almost black". The face is 15 cm tall with a vertex row only at its top and at the gutter lip, and
// the lip sits in the concave corner with the gutter: the bakery shoots its rays round each vertex's
// normal (from RAYS_OFFSET = 10 cm along it), so with a level normal half of them hit the gutter
// and road, and from the lip some start at or under the gutter's surface: near-zero AO there, spread
// over the whole face by interpolation. Leaning the face's normals up toward the sky gives the
// bakery a fairer hemisphere and lifts the lip's ray start clear of the gutter; in the game the face
// then shades a little more like the kerb top, which it nearly touches. Nothing else changes: the
// rest of the bake (under trees, verandahs, hedges) keeps its settings.
import type { Kn5MeshNode, Kn5Node } from "./kn5";

/** Normals steeper than this (|up| below it) are a kerb face. */
const FACE = 0.6;
/** How far a face normal leans toward straight up (0 = as built, 1 = straight up). */
export const KERB_FACE_LEAN = 0.55;

/** Kerb meshes (1KERB_*) with their face normals leaned up; other nodes as they are. New meshes, inputs untouched. */
export function softenKerbFaces<T extends Kn5Node>(nodes: T[], lean = KERB_FACE_LEAN): T[] {
  return nodes.map((n) => {
    if (n.kind === "node") return { ...n, children: softenKerbFaces(n.children, lean) } as T;
    if (!/^1KERB/.test(n.name)) return n;
    const m = n as Kn5MeshNode;
    const normals = Float32Array.from(m.normals);
    for (let i = 0; i < normals.length; i += 3) {
      // AC axes: y up.
      if (Math.abs(normals[i + 1]) >= FACE) continue;
      const x = normals[i] * (1 - lean), y = normals[i + 1] * (1 - lean) + lean, z = normals[i + 2] * (1 - lean);
      const l = Math.hypot(x, y, z) || 1;
      normals[i] = x / l; normals[i + 1] = y / l; normals[i + 2] = z / l;
    }
    return { ...m, normals } as T;
  });
}
