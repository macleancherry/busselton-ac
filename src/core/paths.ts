// Footpaths and shared paths from OpenStreetMap (OpenMapTiles class "path"):
// red asphalt with a dashed white centreline where bikes are allowed (the
// foreshore's dual-use path), concrete elsewhere. Laid on the ground meshes
// (sceneGround.ts) a couple of centimetres up, and cut where they would run under
// the road or a street, or across a step in the ground (a kerb, a raised nature
// strip). The ribbon follows the ground with as few vertices as it can: two across
// where the ground is flat across the path, more only where it isn't, and long
// quads down straight, even stretches. Every vertex is on the ground (plus the
// lift), so the edges never stand proud and need no skirt down into the ground.

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
/** Metres between the points the ground is sampled at along a path. */
export const SAMPLE = 0.35;
/** The ground steps (a kerb, a strip, a cut) where it bends by more than this over three neighbouring samples, metres. */
export const STEP_JUMP = 0.06;
/** Samples merged into one stretch of ribbon: at most this long, metres, ... */
const MERGE_MAX = 15;
/** ... with every sample between within this of the straight line sideways ... */
const MERGE_SIDEWAYS = 0.05;
/** ... and the ribbon at most this over the ground there (never under it). */
const MERGE_HEIGHT = 0.02;
/** Pieces of path shorter than this between cuts are left out (a scrap on a ramp between two steps), metres. */
const MIN_PIECE = 2;
/** How far the ground may come up into the ribbon's lift at a sample, metres. */
const UNDER = 0.005;

/**
 * Built surfaces a path is never laid over (track.ts): the route, streets and aisles, their gutters
 * and fills, kerbs. Not the photo's footpaths (1STREET_PATH) or driveway crossovers (1STREET_DRIVE),
 * which are at the ground's level where a footpath crosses them.
 */
export const PATH_BLOCK = /^\d(ROAD(?!_PATH)|STREET(?!_PATH|_DRIVE)|KERB|UNSEALED|UNPAVED)/;

/** Which OSM paths to build, and as what. */
export function pathKind(subclass: string | undefined, bicycle: string | undefined): PathLine["kind"] | null {
  if (subclass === "cycleway" || bicycle === "yes" || bicycle === "designated") return "shared";
  if (subclass === "footway" || subclass === "path" || subclass === "pedestrian") return "foot";
  return null;
}

/** The ground across a path at one point along it. */
interface Sample {
  /** The centre (local x, y), its left normal, the distance along. */
  p: Vec2;
  n: Vec2;
  s: number;
  /** The ground at points across, left edge to right edge (acrossOf). */
  g: number[];
}

/** Offsets across, left (+normal) to right, no more than about 0.4 m apart: five on a footpath, seven on a shared path. */
const acrossOf = (half: number) => {
  const m = Math.max(4, 2 * Math.ceil(half / 0.85));
  return Array.from({ length: m + 1 }, (_, k) => half - (2 * half * k) / m);
};

/**
 * Which of the points across get a vertex: the two edges, and then whichever point the ground
 * comes up through the ribbon most at, until none does (by more than UNDER). Sorted, left to
 * right; each vertex is at the ground under it.
 */
export function columnsOf(g: number[]): number[] {
  const m = g.length - 1;
  const cols = [0, m];
  for (;;) {
    let worst = -1, by = UNDER;
    for (let c = 1; c < m; c++) {
      if (cols.includes(c)) continue;
      const over = g[c] - ribbonAt(cols, g, c);
      if (over > by) { by = over; worst = c; }
    }
    if (worst < 0) return cols;
    cols.push(worst);
    cols.sort((a, b) => a - b);
  }
}

/** The ribbon's height (ground level) at point c across a row with vertices at `cols` over ground `g`. */
function ribbonAt(cols: number[], g: number[], c: number): number {
  for (let k = 0; k < cols.length - 1; k++) {
    const a = cols[k], b = cols[k + 1];
    if (c >= a && c <= b) return g[a] + ((g[b] - g[a]) * (c - a)) / (b - a);
  }
  return g[c];
}

/** Whether the ground steps at sample k of a run: it bends sharply across, or along against its neighbours. */
function steps(run: { g: number[] }[], k: number): boolean {
  const g = run[k].g;
  for (let c = 1; c < g.length - 1; c++) if (Math.abs(g[c - 1] - 2 * g[c] + g[c + 1]) > STEP_JUMP) return true;
  if (k > 0 && k < run.length - 1) {
    const a = run[k - 1].g, b = run[k + 1].g;
    for (let c = 0; c < g.length; c++) if (Math.abs(a[c] - 2 * g[c] + b[c]) > STEP_JUMP) return true;
  }
  return false;
}

const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The samples kept as rows: from each kept sample, the furthest one up to MERGE_MAX metres on (with
 * the same vertices across) such that every sample between lies within MERGE_SIDEWAYS of the
 * straight line, and the ribbon, straight from one row to the other, is over the ground at every
 * point across and no more than MERGE_HEIGHT over it.
 */
export function keepSamples(run: Sample[], cols: number[][]): number[] {
  if (run.length <= 2) return run.map((_, i) => i);
  const fits = (i: number, j: number) => {
    const a = run[i], b = run[j];
    if (!same(cols[i], cols[j])) return false;
    const dx = b.p[0] - a.p[0], dy = b.p[1] - a.p[1], L = Math.hypot(dx, dy) || 1;
    for (let k = i + 1; k < j; k++) {
      const q = run[k];
      if (Math.abs(((q.p[0] - a.p[0]) * dy - (q.p[1] - a.p[1]) * dx) / L) > MERGE_SIDEWAYS) return false;
      const f = (q.s - a.s) / (b.s - a.s || 1);
      for (let c = 0; c < q.g.length; c++) {
        const ra = ribbonAt(cols[i], a.g, c), r = ra + (ribbonAt(cols[j], b.g, c) - ra) * f;
        if (r < q.g[c] - UNDER || r > q.g[c] + MERGE_HEIGHT) return false;
      }
    }
    return true;
  };
  const out = [0];
  let i = 0;
  while (i < run.length - 1) {
    let best = i + 1;
    for (let j = i + 2; j < run.length && run[j].s - run[i].s <= MERGE_MAX && fits(i, j); j++) best = j;
    out.push(best);
    i = best;
  }
  return out;
}

/**
 * Ribbon meshes along the paths. `ground(x, y)` is the height of what the path lies on (the base's
 * meshes as built, sceneGround.ts), sampled every SAMPLE metres at points across (acrossOf). The path is
 * cut where the ground steps under it (there it would float off the low side or the high side would
 * come up through it), and where `inCorridor` or `clear(x, y, half, kind)` (clear of the road and
 * streets; the path meets the road there) says no. In between, the ribbon is LIFT over the ground,
 * with as few vertices as keep it within a few centimetres (columnsOf, keepSamples).
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
    let part = 0;
    // A mesh holds at most 65535 vertices: a long network of paths goes in several.
    const emit = () => {
      if (mb.indices.length) out.push(mb.toKn5(`1ROAD_PATH_${kind.toUpperCase()}${part ? `_${part + 1}` : ""}`, `path_${kind}`, { castShadows: false }));
      mb = new MeshBuilder();
      part++;
    };
    const half = PATH_WIDTH[kind] / 2;
    const across = acrossOf(half);
    const tl = TEXTURE_LENGTH[kind];
    const ribbon = (run: Sample[]) => {
      const cols = run.map((q) => columnsOf(q.g));
      const keep = keepSamples(run, cols);
      if (mb.vertexCount + keep.length * across.length > 60000) emit();
      // Each kept row's vertices, left to right.
      const vi = keep.map((k) => {
        const q = run[k];
        return cols[k].map((c) => mb.vertex([q.p[0] + q.n[0] * across[c], q.p[1] + q.n[1] * across[c], q.g[c] + LIFT], c / (across.length - 1), q.s / tl));
      });
      // Zipped row to row, counter-clockwise from above: along whichever row's next vertex is further left.
      for (let k = 0; k < keep.length - 1; k++) {
        const A = cols[keep[k]], B = cols[keep[k + 1]], va = vi[k], vb = vi[k + 1];
        let i = 0, j = 0;
        while (i < A.length - 1 || j < B.length - 1) {
          if (j >= B.length - 1 || (i < A.length - 1 && A[i + 1] <= B[j + 1])) {
            mb.tri(va[i], va[i + 1], vb[j]);
            i++;
          } else {
            mb.tri(va[i], vb[j + 1], vb[j]);
            j++;
          }
        }
      }
    };
    // One stretch of clear samples: cut at steps, the pieces laid as ribbon.
    const lay = (samples: Sample[]) => {
      let piece: Sample[] = [];
      for (let k = 0; k <= samples.length; k++) {
        if (k < samples.length && !steps(samples, k)) {
          piece.push(samples[k]);
          continue;
        }
        if (piece.length >= 2 && piece[piece.length - 1].s - piece[0].s >= MIN_PIECE) ribbon(piece);
        piece = [];
      }
    };
    for (const line of lines.filter((l) => l.kind === kind)) {
      // Resample every SAMPLE metres.
      const pts: Vec2[] = [];
      for (let i = 1; i < line.pts.length; i++) {
        const a = line.pts[i - 1], b = line.pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(L / SAMPLE));
        for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
      let run: Sample[] = [];
      let s = 0;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
        if (i > 0) s += Math.hypot(p[0] - o[0], p[1] - o[1]);
        const dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy) || 1;
        const n: Vec2 = [-dy / L, dx / L];
        if (!inCorridor(p[0], p[1]) || !clear(p[0], p[1], half, kind)) {
          lay(run);
          run = [];
          continue;
        }
        run.push({ p, n, s, g: across.map((c) => ground(p[0] + n[0] * c, p[1] + n[1] * c)) });
        // Very long runs in pieces (each piece fits a mesh), joined at a shared sample.
        if (run.length >= 8000) {
          const last = run[run.length - 1];
          lay(run);
          run = [last];
        }
      }
      lay(run);
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
