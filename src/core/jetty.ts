// Busselton fork: the jetty precinct, on a jetty the coast module has already built (its deck on
// piles, rails and lamps). From OSM, researched in docs/jetty.md:
//
// - the railway along the jetty (Busselton's jetty train, 1,067 mm gauge): two rails on timber
//   sleepers, on the deck;
// - its platforms, raised a little off the deck, with a shelter roof where OSM says there is one;
// - the train itself (red loco styled like a cartoon steam engine, four open carriages with roofs),
//   standing at the shore platform, each car a node the track script can move (jettyTrain.ts);
// - buildings on the jetty: the Interpretive Centre's row of blue gabled "boatsheds" with white tin
//   roofs, and the Underwater Observatory's round pavilion on its concrete drum at the far end.
//
// Visual only: the jetty isn't somewhere to drive. Measurements nobody publishes (sleeper spacing,
// platform height, shed eaves) are typical values, marked in docs/jetty.md as guesses to check.

import type { Kn5Node } from "./kn5";
import { buildJettyTrain, trainLength, type JettyTrain } from "./jettyTrain";
import { MeshBuilder, type Vec3 } from "./mesh";
import { box, ChunkedMesh } from "./scenery";
import { pad } from "./roadMesh";

type Vec2 = [number, number];

export interface JettyFeatures {
  /** Railway centrelines (local metres). */
  railways: Vec2[][];
  /** Platform outlines (local metres, closed or not), and whether each has a shelter. */
  platforms: { pts: Vec2[]; shelter: boolean }[];
  /** Building outlines on or beside the jetty, with their OSM names. */
  buildings: { pts: Vec2[]; name: string }[];
}

/** Materials the precinct uses: name and colour (solid textures). */
export const JETTY_MATERIALS: { name: string; rgb: [number, number, number] }[] = [
  { name: "jetty_rail", rgb: [96, 90, 84] },
  { name: "jetty_sleeper", rgb: [92, 74, 58] },
  { name: "jetty_platform", rgb: [150, 140, 126] },
  { name: "jetty_shed", rgb: [52, 96, 150] }, // "nautical blue" weatherboard
  { name: "jetty_trim", rgb: [236, 236, 230] }, // white trim and tin roofs
  { name: "jetty_drum", rgb: [196, 196, 190] }, // weathered concrete
  { name: "jetty_train", rgb: [196, 30, 34] }, // the red train
  { name: "jetty_train_dark", rgb: [34, 36, 44] }, // solar panels, buffers, the loco's chimney
];

const GAUGE = 1.067;
const SLEEPER_STEP = 1.0;

/** A polyline resampled every `step` metres: points with their unit direction. */
function walk(line: Vec2[], step: number): { p: Vec2; d: Vec2; s: number }[] {
  const out: { p: Vec2; d: Vec2; s: number }[] = [];
  let s = 0, next = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-6) continue;
    const d: Vec2 = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    while (next <= s + len) {
      const t = next - s;
      out.push({ p: [a[0] + d[0] * t, a[1] + d[1] * t], d, s: next });
      next += step;
    }
    s += len;
  }
  return out;
}

function centroid(pts: Vec2[]): Vec2 {
  return [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
}

/** The outline's oriented box: centre, long-axis direction, length and width. */
function orientedBox(pts: Vec2[]): { c: Vec2; along: Vec2; length: number; width: number } {
  let best = { c: centroid(pts), along: [1, 0] as Vec2, length: 0, width: 0, area: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l < 0.5) continue;
    const u: Vec2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l], v: Vec2 = [-u[1], u[0]];
    const us = pts.map((p) => p[0] * u[0] + p[1] * u[1]), vs = pts.map((p) => p[0] * v[0] + p[1] * v[1]);
    const L = Math.max(...us) - Math.min(...us), W = Math.max(...vs) - Math.min(...vs);
    if (L * W < best.area) {
      const cu = (Math.max(...us) + Math.min(...us)) / 2, cv = (Math.max(...vs) + Math.min(...vs)) / 2;
      const c: Vec2 = [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv];
      best = L >= W ? { c, along: u, length: L, width: W, area: L * W } : { c, along: v, length: W, width: L, area: L * W };
    }
  }
  return best;
}

/** A gabled shed: walls, gable ends and a roof (ridge along `along`). */
function shed(walls: MeshBuilder, roof: MeshBuilder, c: Vec2, along: Vec2, length: number, depth: number, z: number, eaves: number, pitchDeg: number) {
  box(walls, c, along, length, depth, z, z + eaves);
  const across: Vec2 = [-along[1], along[0]];
  const rise = (depth / 2) * Math.tan((pitchDeg * Math.PI) / 180);
  const over = 0.3;
  const P = (s: number, t: number, h: number): Vec3 => [c[0] + along[0] * s + across[0] * t, c[1] + along[1] * s + across[1] * t, h];
  const hl = length / 2 + over, hd = depth / 2 + over, ze = z + eaves - over * Math.tan((pitchDeg * Math.PI) / 180), zr = z + eaves + rise;
  // Two roof planes, each with its outward-up normal.
  for (const side of [1, -1]) {
    const n: Vec3 = [across[0] * side * Math.sin((pitchDeg * Math.PI) / 180), across[1] * side * Math.sin((pitchDeg * Math.PI) / 180), Math.cos((pitchDeg * Math.PI) / 180)];
    const i = roof.vertexCount;
    roof.vertex(P(-hl, side * hd, ze), 0, 1);
    roof.vertex(P(hl, side * hd, ze), 1, 1);
    roof.vertex(P(hl, 0, zr), 1, 0);
    roof.vertex(P(-hl, 0, zr), 0, 0);
    for (let k = 0; k < 4; k++) roof.normals!.push(...n);
    if (side === 1) roof.quad(i, i + 3, i + 2, i + 1); else roof.quad(i, i + 1, i + 2, i + 3);
  }
  // Gable triangles over each end wall.
  for (const end of [1, -1]) {
    const n: Vec3 = [along[0] * end, along[1] * end, 0];
    const i = walls.vertexCount;
    walls.vertex(P(end * length / 2, -depth / 2, z + eaves), 0, 1);
    walls.vertex(P(end * length / 2, depth / 2, z + eaves), 1, 1);
    walls.vertex(P(end * length / 2, 0, zr - 0.05), 0.5, 0);
    for (let k = 0; k < 3; k++) walls.normals!.push(...n);
    if (end === 1) walls.tri(i, i + 1, i + 2); else walls.tri(i, i + 2, i + 1);
  }
}

/** A closed prism round `c`: `sides` faces from z0 to z1, with a cap. */
function drum(mb: MeshBuilder, c: Vec2, r: number, z0: number, z1: number, sides = 20, cap = true) {
  for (let k = 0; k < sides; k++) {
    const a0 = (k / sides) * 2 * Math.PI, a1 = ((k + 1) / sides) * 2 * Math.PI;
    const p0: Vec2 = [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r], p1: Vec2 = [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r];
    const am = (a0 + a1) / 2, n: Vec3 = [Math.cos(am), Math.sin(am), 0];
    const i = mb.vertexCount;
    mb.vertex([p0[0], p0[1], z0], k / sides, 1);
    mb.vertex([p1[0], p1[1], z0], (k + 1) / sides, 1);
    mb.vertex([p1[0], p1[1], z1], (k + 1) / sides, 0);
    mb.vertex([p0[0], p0[1], z1], k / sides, 0);
    for (let j = 0; j < 4; j++) mb.normals!.push(...n);
    mb.quad(i, i + 1, i + 2, i + 3);
  }
  if (!cap) return;
  const ci = mb.vertex([c[0], c[1], z1], 0.5, 0.5);
  mb.normals!.push(0, 0, 1);
  const ring: number[] = [];
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * 2 * Math.PI;
    ring.push(mb.vertex([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, z1], 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2));
    mb.normals!.push(0, 0, 1);
  }
  for (let k = 0; k < sides; k++) mb.tri(ci, ring[k], ring[(k + 1) % sides]);
}

/** A shallow cone roof. */
function cone(mb: MeshBuilder, c: Vec2, r: number, z0: number, z1: number, sides = 20) {
  const tip = mb.vertex([c[0], c[1], z1], 0.5, 0.5);
  mb.normals!.push(0, 0, 1);
  const ring: number[] = [];
  const slope = (z1 - z0) / r;
  for (let k = 0; k < sides; k++) {
    const a = (k / sides) * 2 * Math.PI;
    ring.push(mb.vertex([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, z0], 0.5 + Math.cos(a) / 2, 0.5 + Math.sin(a) / 2));
    const l = Math.hypot(slope, 1);
    mb.normals!.push((Math.cos(a) * slope) / l, (Math.sin(a) * slope) / l, 1 / l);
  }
  for (let k = 0; k < sides; k++) mb.tri(tip, ring[k], ring[(k + 1) % sides]);
}

function inside(p: Vec2, ring: Vec2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export interface JettyPrecinct {
  /** Meshes, and the train's cars as nodes of their own (so CSP can move them). */
  nodes: Kn5Node[];
  /** The train and its line, for the track script that runs it (jettyTrain.ts). */
  train?: JettyTrain;
  /** Outlines of the buildings drawn here, so the generic building generator leaves them alone. */
  footprints: Vec2[][];
}

/**
 * `deckZ(x, y)`: the deck's height there (the coast module's deck). `onJetty(x, y)`: on a pier
 * outline. `water`: the sea surface height.
 */
export function buildJettyPrecinct(f: JettyFeatures, deckZ: (x: number, y: number) => number, onJetty: (x: number, y: number) => boolean, water: number): JettyPrecinct {
  const nodes: Kn5Node[] = [];
  const footprints: Vec2[][] = [];
  const near = (p: Vec2, r: number) => onJetty(p[0], p[1]) || [0, 1, 2, 3].some((k) => onJetty(p[0] + Math.cos(k * Math.PI / 2) * r, p[1] + Math.sin(k * Math.PI / 2) * r));

  // Rails and sleepers, only where the line is on the jetty.
  const rails = new ChunkedMesh(16), sleepers = new ChunkedMesh(20);
  const onDeckLines: Vec2[][] = [];
  for (const line of f.railways) {
    const pts = walk(line, SLEEPER_STEP);
    let run: typeof pts = [];
    const flush = () => {
      if (run.length >= 2) onDeckLines.push(run.map((q) => q.p));
      run = [];
    };
    for (const q of pts) {
      if (!onJetty(q.p[0], q.p[1])) { flush(); continue; }
      run.push(q);
      const z = deckZ(q.p[0], q.p[1]);
      box(sleepers.next(), q.p, [-q.d[1], q.d[0]], 2.0, 0.22, z, z + 0.1);
    }
    flush();
  }
  for (const full of onDeckLines) {
    // Rails in 4 m lengths (the line is gently curved): a tenth of the triangles of 1 m ones.
    const line = full.filter((_, i) => i % 4 === 0 || i === full.length - 1);
    for (const side of [1, -1]) {
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i];
        const d: Vec2 = [b[0] - a[0], b[1] - a[1]], l = Math.hypot(d[0], d[1]) || 1;
        const n: Vec2 = [-d[1] / l, d[0] / l];
        const off = (side * GAUGE) / 2;
        const c: Vec2 = [(a[0] + b[0]) / 2 + n[0] * off, (a[1] + b[1]) / 2 + n[1] * off];
        const z = deckZ(c[0], c[1]) + 0.1;
        box(rails.next(), c, [d[0] / l, d[1] / l], l + 0.02, 0.07, z, z + 0.12);
      }
    }
  }
  rails.all().forEach((m, i) => m.vertexCount && nodes.push(m.toKn5(`JETTY_RAIL_${pad(i)}`, "jetty_rail", { castShadows: false })));
  sleepers.all().forEach((m, i) => m.vertexCount && nodes.push(m.toKn5(`JETTY_SLEEPERS_${pad(i)}`, "jetty_sleeper", { castShadows: false })));

  // Platforms: a raised deck along the line, and a shelter roof on posts where OSM has one.
  const plat = new MeshBuilder(), shelterRoof = new MeshBuilder(), posts = new MeshBuilder();
  plat.normals = []; shelterRoof.normals = []; posts.normals = [];
  for (const p of f.platforms) {
    if (p.pts.length < 2 || !near(centroid(p.pts), 6)) continue;
    const ob = orientedBox(p.pts.length > 2 ? p.pts : [...p.pts, p.pts[0]]);
    const length = Math.max(ob.length, 8), width = Math.max(ob.width, 2.5);
    const z = deckZ(ob.c[0], ob.c[1]);
    box(plat, ob.c, ob.along, length, width, z, z + 0.4);
    if (p.shelter) {
      const sl = Math.min(length * 0.6, 14), sw = width + 0.6;
      for (const s of [-1, 1]) for (const t of [-1, 1]) {
        const c: Vec2 = [ob.c[0] + ob.along[0] * s * sl / 2 - ob.along[1] * t * (sw / 2 - 0.4), ob.c[1] + ob.along[1] * s * sl / 2 + ob.along[0] * t * (sw / 2 - 0.4)];
        box(posts, c, ob.along, 0.12, 0.12, z + 0.4, z + 3.0);
      }
      box(shelterRoof, ob.c, ob.along, sl + 0.6, sw, z + 3.0, z + 3.15);
    }
  }
  if (plat.vertexCount) nodes.push(plat.toKn5("JETTY_PLATFORMS", "jetty_platform"));
  if (posts.vertexCount) nodes.push(posts.toKn5("JETTY_SHELTER_POSTS", "jetty_trim"));
  if (shelterRoof.vertexCount) nodes.push(shelterRoof.toKn5("JETTY_SHELTER_ROOF", "jetty_trim"));

  // Buildings on (or right beside) the jetty.
  const shedWalls = new MeshBuilder(), shedRoofs = new MeshBuilder(), drumMesh = new MeshBuilder(), pavilion = new MeshBuilder(), pavilionRoof = new MeshBuilder();
  for (const m of [shedWalls, shedRoofs, drumMesh, pavilion, pavilionRoof]) m.normals = [];
  for (const b of f.buildings) {
    if (b.pts.length < 3) continue;
    const c = centroid(b.pts);
    if (!near(c, 12)) continue;
    footprints.push(b.pts);
    const ob = orientedBox(b.pts);
    if (/observatory/i.test(b.name)) {
      // The concrete drum from the water up to the deck, and a round pavilion on top.
      const r = Math.min(ob.length, ob.width) / 2;
      const z = deckZ(c[0], c[1]);
      drum(drumMesh, c, Math.min(5.05, r), water - 0.5, z, 20, false);
      drum(pavilion, c, Math.max(4, r - 0.3), z, z + 3.4, 20, false);
      cone(pavilionRoof, c, Math.max(4.6, r + 0.3), z + 3.4, z + 4.6, 20);
    } else {
      // A row of gabled boatsheds across the outline's long side, each about 6 to 7 m wide.
      const n = Math.max(1, Math.round(ob.length / 6.7));
      const w = ob.length / n;
      const z = deckZ(c[0], c[1]);
      for (let k = 0; k < n; k++) {
        const s = -ob.length / 2 + w * (k + 0.5);
        const sc: Vec2 = [ob.c[0] + ob.along[0] * s, ob.c[1] + ob.along[1] * s];
        // Ridge across the row (gables face the walkway), so the shed's "along" is the row's across.
        shed(shedWalls, shedRoofs, sc, [-ob.along[1], ob.along[0]], ob.width, w - 0.4, z, 3.0, 38);
      }
    }
  }
  if (shedWalls.vertexCount) nodes.push(shedWalls.toKn5("JETTY_SHEDS", "jetty_shed"));
  if (shedRoofs.vertexCount) nodes.push(shedRoofs.toKn5("JETTY_SHED_ROOFS", "jetty_trim"));
  if (drumMesh.vertexCount) nodes.push(drumMesh.toKn5("JETTY_OBSERVATORY_DRUM", "jetty_drum"));
  if (pavilion.vertexCount) nodes.push(pavilion.toKn5("JETTY_OBSERVATORY", "jetty_trim"));
  if (pavilionRoof.vertexCount) nodes.push(pavilionRoof.toKn5("JETTY_OBSERVATORY_ROOF", "jetty_drum"));

  // The train (jettyTrain.ts): its cars stand at the platform nearest the shore end of the line,
  // and the track script runs them out to the platform nearest the far end and back.
  let train: JettyTrain | undefined;
  const shoreLine = onDeckLines.sort((a, b) => b.length - a.length)[0];
  if (shoreLine && f.platforms.length) {
    const pc = f.platforms.map((p) => centroid(p.pts)).filter((q) => near(q, 6));
    const nearestIndex = (q: Vec2) => {
      let k = 0, bd = Infinity;
      shoreLine.forEach((p, i) => { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d < bd) [bd, k] = [d, i]; });
      return k;
    };
    const byDistance = (end: Vec2) => [...pc].sort((a, b) => Math.hypot(a[0] - end[0], a[1] - end[1]) - Math.hypot(b[0] - end[0], b[1] - end[1]));
    const target = byDistance(shoreLine[0])[0];
    if (target) {
      const far = byDistance(shoreLine[shoreLine.length - 1])[0];
      // The line's points are a metre apart (SLEEPER_STEP), so an index is (near enough) metres along it.
      // The train stands centred on each platform (the loco's nose half a train past its middle).
      const park = nearestIndex(target) * SLEEPER_STEP + trainLength() / 2;
      const end = far && far !== target ? nearestIndex(far) * SLEEPER_STEP + trainLength() / 2 : (shoreLine.length - 2) * SLEEPER_STEP;
      // Rail top: sleepers 0.1 m, rails 0.12 m on the deck.
      const built = buildJettyTrain(shoreLine.map((q): [number, number, number] => [q[0], q[1], deckZ(q[0], q[1]) + 0.22]), park, end);
      if (built) {
        train = built;
        nodes.push(...built.nodes);
      }
    }
  }
  return { nodes, footprints, train };
}

/** Whether a point is inside any of the outlines. */
export function inAny(p: Vec2, outlines: Vec2[][]): boolean {
  return outlines.some((o) => inside(p, o));
}
