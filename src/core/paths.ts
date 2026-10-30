// Footpaths and shared paths from OpenStreetMap (OpenMapTiles class "path"):
// red asphalt with a dashed white centreline where bikes are allowed (the
// foreshore's dual-use path), concrete elsewhere. Laid on the ground meshes
// (sceneGround.ts) a couple of centimetres up, with a thin edge down into the
// ground so no gap shows, and cut where they would run under the road or a street.

import { encodePng } from "./png";
import { MeshBuilder } from "./mesh";
import type { Kn5MeshNode } from "./kn5";
import type { Vec2 } from "./geo";
import { rng } from "./scenery";

export interface PathLine {
  pts: Vec2[];
  kind: "shared" | "foot";
}

export const PATH_WIDTH = { shared: 2.5, foot: 1.6 } as const;
/** Metres one repeat of the path texture covers along the path. */
const TEXTURE_LENGTH = { shared: 6, foot: 3 } as const;
/** How far the path stands proud of the ground, metres. */
export const LIFT = 0.025;
/** How far its edge reaches down into the ground (visual only), metres. */
const EDGE = 0.12;
const STEP = 1.5;

/** Which OSM paths to build, and as what. */
export function pathKind(subclass: string | undefined, bicycle: string | undefined): PathLine["kind"] | null {
  if (subclass === "cycleway" || bicycle === "yes" || bicycle === "designated") return "shared";
  if (subclass === "footway" || subclass === "path" || subclass === "pedestrian") return "foot";
  return null;
}

/**
 * Ribbon meshes along the paths, three vertices across (edges and centre) so the ground can't
 * come up through the middle. `ground(x, y)` is the height of what the path lies on; each vertex
 * takes the highest ground around it (half a step along and across), so the ribbon stays over
 * the ground between vertices too. `clear(x, y, half, kind)` says whether a point `half` metres
 * wide is clear of the road and streets; stretches that aren't are left out (the path meets the
 * road there).
 */
export function buildPaths(
  lines: PathLine[],
  ground: (x: number, y: number) => number,
  clear: (x: number, y: number, half: number, kind: PathLine["kind"]) => boolean,
  inCorridor: (x: number, y: number) => boolean,
): Kn5MeshNode[] {
  const out: Kn5MeshNode[] = [];
  for (const kind of ["shared", "foot"] as const) {
    let mb = new MeshBuilder();
    let edge = new MeshBuilder();
    let part = 0;
    // A mesh holds at most 65535 vertices: a long network of paths goes in several.
    const emit = () => {
      const suffix = part ? `_${part + 1}` : "";
      if (mb.indices.length) out.push(mb.toKn5(`1ROAD_PATH_${kind.toUpperCase()}${suffix}`, `path_${kind}`, { castShadows: false }));
      if (edge.indices.length) out.push(edge.toKn5(`PATH_EDGE_${kind.toUpperCase()}${suffix}`, `path_${kind}`, { castShadows: false }));
      mb = new MeshBuilder();
      edge = new MeshBuilder();
      part++;
    };
    const half = PATH_WIDTH[kind] / 2;
    for (const line of lines.filter((l) => l.kind === kind)) {
      // Resample every STEP metres.
      const pts: Vec2[] = [];
      for (let i = 1; i < line.pts.length; i++) {
        const a = line.pts[i - 1], b = line.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(L / STEP));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
      let run: { p: Vec2[]; t: Vec2; n: Vec2; s: number }[] = [];
      let s = 0;
      // The highest ground at and around vertex j (0 left, 1 centre, 2 right): half a step along,
      // and halfway to its neighbours across (never past the path's edge).
      const top = (p: Vec2, t: Vec2, n: Vec2, j: number) => {
        let h = ground(p[0], p[1]);
        const across = j === 0 ? [-half / 2] : j === 2 ? [half / 2] : [half / 2, -half / 2];
        for (const [a, c] of [[STEP / 2, 0], [-STEP / 2, 0], ...across.map((c) => [0, c])]) {
          h = Math.max(h, ground(p[0] + t[0] * a + n[0] * c, p[1] + t[1] * a + n[1] * c));
        }
        return h + LIFT;
      };
      const flush = () => {
        if (run.length >= 2) {
          if (edge.vertexCount + run.length * 4 > 60000) emit();
          const base = mb.vertexCount;
          const zs = run.map((q) => q.p.map((p, j) => top(p, q.t, q.n, j)));
          run.forEach((q, k) => q.p.forEach((p, j) => mb.vertex([p[0], p[1], zs[k][j]], j / 2, q.s / TEXTURE_LENGTH[kind])));
          for (let k = 0; k < run.length - 1; k++) {
            const a = base + k * 3;
            // Left (0) to centre (1) to right (2), counter-clockwise from above.
            mb.quad(a, a + 1, a + 4, a + 3);
            mb.quad(a + 1, a + 2, a + 5, a + 4);
          }
          // The edges, from the top down into the ground: the left one faces left, the right one right.
          for (const j of [0, 2]) {
            const e = edge.vertexCount;
            run.forEach((q, k) => {
              const [x, y] = q.p[j], u = j / 2, v = q.s / TEXTURE_LENGTH[kind];
              edge.vertex([x, y, zs[k][j]], u, v);
              edge.vertex([x, y, zs[k][j] - LIFT - EDGE], u, v);
            });
            for (let k = 0; k < run.length - 1; k++) {
              const a = e + k * 2;
              if (j === 0) edge.quad(a, a + 2, a + 3, a + 1);
              else edge.quad(a, a + 1, a + 3, a + 2);
            }
          }
        }
        run = [];
      };
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
        if (i > 0) s += Math.hypot(p[0] - o[0], p[1] - o[1]);
        const dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy) || 1;
        const t: Vec2 = [dx / L, dy / L], n: Vec2 = [-dy / L, dx / L];
        if (!inCorridor(p[0], p[1]) || !clear(p[0], p[1], half, kind)) {
          flush();
          continue;
        }
        run.push({ p: [[p[0] + n[0] * half, p[1] + n[1] * half], p, [p[0] - n[0] * half, p[1] - n[1] * half]], t, n, s });
        // Very long runs in pieces (each piece fits a mesh), joined at a shared row.
        if (run.length >= 4000) {
          const last = run[run.length - 1];
          flush();
          run = [last];
        }
      }
      flush();
    }
    emit();
  }
  return out;
}

/** Red asphalt shared path, 2.5 m across (u) by 6 m along (v): grainy red seal, white dashes down the middle. */
export function sharedPathTexture(): Uint8Array {
  const w = 256, h = 512;
  const px = new Uint8Array(w * h * 4);
  const r = rng(77);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = 0.86 + r() * 0.22;
      let c: [number, number, number] = [150 * g, 74 * g, 62 * g];
      // Darker wheel and foot wear either side of the centre line.
      const u = x / w;
      if (Math.abs(u - 0.3) < 0.08 || Math.abs(u - 0.7) < 0.08) c = [c[0] * 0.93, c[1] * 0.93, c[2] * 0.93];
      // Dashed centreline: 1.5 m dash, 1.5 m gap, 100 mm wide.
      const dash = Math.abs(u - 0.5) < 0.1 / 2.5 / 2 && (y / h) * 6 % 3 < 1.5;
      if (dash) c = [228 * g, 226 * g, 220 * g];
      px.set([c[0], c[1], c[2], 255].map((v) => Math.max(0, Math.min(255, v))), i);
    }
  }
  return encodePng(px, w, h);
}

/** Concrete footpath, 1.6 m across by 3 m along: light grey with saw-cut joints every 1.5 m. */
export function footPathTexture(): Uint8Array {
  const w = 256, h = 512;
  const px = new Uint8Array(w * h * 4);
  const r = rng(78);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const g = 0.9 + r() * 0.14;
      let v = 186 * g;
      if ((y % (h / 2)) < 3) v *= 0.7; // joint
      if (x < 3 || x > w - 4) v *= 0.85; // worn edges
      px.set([v, v * 0.99, v * 0.96, 255].map((c) => Math.max(0, Math.min(255, c))), i);
    }
  }
  return encodePng(px, w, h);
}
