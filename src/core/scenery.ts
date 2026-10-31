// Busselton fork: roadside scenery. Trees found in the aerial photo, kept clear of the road, drawn
// as crossed sprite cards with invisible trunks; W-beam guard rails where the land falls away; white
// guide posts along the verges. Written fresh from docs/specs/scenery.md.
//
// Heights: every builder is handed `ground(x, y)`, the built physics ground (sceneGround.ts), and
// stands each piece on it at the piece's own foot, SINK into it. Nothing here works a height out.
//
// Randomness that belongs to a place (which photo cells grow a tree, a tree's turn) is seeded by
// position (random.ts), so the same tree comes out the same whatever else is in the list.

import type { Bounds, Vec2 } from "./geo";
import type { MeshBuilder } from "./mesh";
import { SINK } from "./sceneGround";
import { TREE_SPECIES, type TreeSpecies } from "./treeSprites";
import { placeRandom, placeSeed, rng } from "./random";
import { box, ChunkedMesh } from "./meshKit";

// The shared helpers live in their own modules; re-exported so existing imports keep working.
export { rng, placeRandom, placeSeed } from "./random";
export { box, ChunkedMesh, type SideUv } from "./meshKit";

/* ================================================================== what the module needs */

/** Height of the surface at a local point, metres (sceneGround.ts, or any stand-in). */
type Ground = (x: number, y: number) => number;
/** A kn5 mesh node, as MeshBuilder makes them. */
type MeshNode = ReturnType<MeshBuilder["toKn5"]>;
/** The build settings used here (BuildOptions has them all). */
interface SceneryOpts { corridor: number; vergeWidth: number; spacing: number }
/** A route sample (road.ts RoadSample): where, which way, how wide, how far along. */
interface Station { pos: Vec2; tan: Vec2; left: Vec2; width: number; s: number }
/** The route (road.ts RoadPlan). */
interface Route { closed: boolean; samples: Station[] }
/** The closest point on the route: distance, segment, signed offset (left positive), fraction along. */
type Near = { dist: number; seg: number; t: number; frac: number };
/** Nearest-point lookups on the route (road.ts SegmentIndex). */
interface RouteIndex {
  nearest(x: number, y: number, maxDist: number): Near | null;
  at(n: Near): { width: number };
}
/** Per sample, [left, right]. */
type Sides = [boolean[], boolean[]];

/** Three-digit mesh numbering, as the rest of the build names meshes. */
const num = (i: number) => String(i).padStart(3, "0");
/** +1 for the left side (index 0), -1 for the right. */
const sideSign = (side: number) => (side === 0 ? 1 : -1);
/** A point `d` metres out from a station on a side. */
const outFrom = (st: Station, sign: number, d: number): Vec2 => [st.pos[0] + st.left[0] * sign * d, st.pos[1] + st.left[1] * sign * d];

/* ================================================================== trees: species sizes */

export type TreeSpot = {
  x: number;
  y: number;
  scale: number; // relative to the species' natural size
  variant: number; // card index into TREE_SPECIES; with zones and CSP trees, maybe a CSP model index past the cards
  model?: number; // CSP tree model index (treeModels.ts MODEL_NAMES), when it isn't the variant
  coastal?: boolean; // water within about 60 m in the aerial photo
};

/** CSP tree models with no card (karri, marri) borrow the tuart card's size (treeZones.ts CARD_FOR). */
const CARDLESS_MODELS = 2;
const STAND_IN_CARD = 3;
const DEFAULT_TRUNK = 0.4;

/** The card whose sizes a tree uses: its own, the tuart for the card-less CSP models, else card 0. */
export function cardFor(variant: number): TreeSpecies {
  if (Number.isInteger(variant) && variant >= 0) {
    if (variant < TREE_SPECIES.length) return TREE_SPECIES[variant];
    if (variant < TREE_SPECIES.length + CARDLESS_MODELS) return TREE_SPECIES[STAND_IN_CARD];
  }
  return TREE_SPECIES[0];
}

/** Crown radius at scale 1 for a tree's variant, metres. */
export const crownRadius = (variant: number): number => cardFor(variant).crown;
/** Trunk width at scale 1 for a tree's variant, metres. */
export const trunkWidth = (variant: number): number => cardFor(variant).trunk ?? DEFAULT_TRUNK;

/* ================================================================== trees: from the photo */

/** Cell size by density, metres. */
const CELL_NORMAL = 6.5, CELL_DENSE = 4.5;
const COAST_RADIUS = 60;
const COAST_SHARE = 0.2;
const STRETCH_SHARE = 0.7;
const SALT_CELL = 0x7ee5;

// What a cell shows.
const NONE = 0, WATER = 1, LUSH = 2, OLIVE = 3, SHADED = 4;
type CellKind = typeof NONE | typeof WATER | typeof LUSH | typeof OLIVE | typeof SHADED;
interface CellLook { kind: CellKind; p: number; valid: boolean }
const NO_DATA: CellLook = { kind: NONE, p: 0, valid: false };

/** What one photo cell shows, from its mean colour, mean lightness and lightness spread. */
function classify(red: number, green: number, blue: number, light: number, spread: number): CellLook {
  // Sea first: teal water reads green otherwise.
  if (blue - red > 0.05 && blue >= 0.85 * green) return { kind: WATER, p: 0, valid: true };
  if (light >= 0.42 || light <= 0.04) return { kind: NONE, p: 0, valid: true };
  const exg = (2 * green - red - blue) / (red + green + blue || 1e-6);
  if (exg > 0.05 && spread > 0.025) return { kind: LUSH, p: 0.35 + 0.65 * Math.min(1, (exg - 0.05) / 0.15), valid: true };
  if (exg > 0.012 && green >= red * 0.98 && blue <= green && spread >= 0.04 && spread <= 0.14) {
    return { kind: OLIVE, p: 0.3 + 0.4 * Math.min(1, (spread - 0.04) / 0.1), valid: true };
  }
  if (red <= green * 1.05 && blue < Math.max(red, green) * 1.15 && spread >= 0.035 && spread <= 0.18) return { kind: SHADED, p: 0, valid: true };
  return { kind: NONE, p: 0, valid: true };
}

const canopy = (kind: CellKind) => kind === LUSH || kind === OLIVE || kind === SHADED;

/**
 * Tree spots in one chunk's aerial photo (RGBA, north up, `size` pixels square). `density` 0 is off,
 * 1 normal, 2 dense. Species is left at 0 for the pipeline to choose.
 */
export function treeSpotsFromImagery(rgba: Uint8Array | Uint8ClampedArray, size: number, chunk: Bounds, density: number): TreeSpot[] {
  if (!(density > 0) || size <= 0) return [];
  const width = chunk.maxX - chunk.minX;
  if (!(width > 0)) return [];
  const metresPerPx = width / size;
  const cellPx = Math.max(2, Math.round((density >= 2 ? CELL_DENSE : CELL_NORMAL) / metresPerPx));
  const cells = Math.floor(size / cellPx);
  if (cells < 1) return [];
  const cellM = cellPx * metresPerPx;

  const looks: CellLook[] = [];
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0, used = 0;
      for (let py = row * cellPx; py < (row + 1) * cellPx; py++) {
        for (let px = col * cellPx; px < (col + 1) * cellPx; px++) {
          const o = (py * size + px) * 4;
          if (rgba[o + 3] === 0) continue; // no data
          const cr = rgba[o] / 255, cg = rgba[o + 1] / 255, cb = rgba[o + 2] / 255;
          const lum = (cr + cg + cb) / 3;
          sr += cr; sg += cg; sb += cb; sl += lum; sl2 += lum * lum; used++;
        }
      }
      if (used < (cellPx * cellPx) / 2) {
        looks.push(NO_DATA);
        continue;
      }
      const mean = sl / used;
      looks.push(classify(sr / used, sg / used, sb / used, mean, Math.sqrt(Math.max(0, sl2 / used - mean * mean))));
    }
  }
  const lookAt = (col: number, row: number): CellLook | null => (col < 0 || row < 0 || col >= cells || row >= cells ? null : looks[row * cells + col]);

  // Grey-olive and shaded cells only count inside a stretch of canopy.
  const inStretch = (col: number, row: number) => {
    let inside = 0, green = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const nb = dr || dc ? lookAt(col + dc, row + dr) : null;
      if (!nb) continue;
      inside++;
      if (canopy(nb.kind)) green++;
    }
    return inside > 0 && green / inside >= STRETCH_SHARE;
  };

  // Coastal: more than a fifth of the cells within 60 m are water.
  const reach = Math.ceil(COAST_RADIUS / cellM);
  const byWater = (col: number, row: number) => {
    let seen = 0, wet = 0;
    for (let dr = -reach; dr <= reach; dr++) for (let dc = -reach; dc <= reach; dc++) {
      if ((dr * dr + dc * dc) * cellM * cellM > COAST_RADIUS * COAST_RADIUS) continue;
      const nb = lookAt(col + dc, row + dr);
      if (!nb?.valid) continue;
      seen++;
      if (nb.kind === WATER) wet++;
    }
    return seen > 0 && wet / seen > COAST_SHARE;
  };

  const found: TreeSpot[] = [];
  for (let row = 0; row < cells; row++) {
    for (let col = 0; col < cells; col++) {
      const look = looks[row * cells + col];
      if (!canopy(look.kind)) continue;
      let chance = look.p;
      if (look.kind !== LUSH) {
        if (!inStretch(col, row)) continue;
        chance = Math.max(chance, look.kind === OLIVE ? 0.6 : 0.4);
      }
      const cx = chunk.minX + (col + 0.5) * cellM, cy = chunk.maxY - (row + 0.5) * cellM;
      // Draws seeded by where the cell is on the map, not by which chunk or in what order.
      const draw = rng(placeSeed(cx, cy, SALT_CELL));
      if (draw() >= chance) continue;
      const tx = cx + (draw() - 0.5) * cellM, ty = cy + (draw() - 0.5) * cellM;
      found.push({ x: tx, y: ty, scale: 0.75 + draw() * 0.6, variant: 0, coastal: byWater(col, row) });
    }
  }
  return found;
}

/* ================================================================== trees: clear of the road */

/** Spare room left between a crown and the road's verge, metres. */
const VERGE_GAP = 1.5;
/** The share of a crown that has to fit (crowns overlap the verge a little). */
const CROWN_SHARE = 0.6;

/**
 * Keeps trees that fit beside the road, shrinking those that nearly fit, and thins evenly to `max`.
 * `cover` (area builds): the build's coverage distance (makeCover); beyond the corridor a tree stays
 * only where it is within the corridor less 3 m.
 */
export function filterTrees(spots: TreeSpot[], index: RouteIndex, opts: SceneryOpts, max: number, cover?: Ground): TreeSpot[] {
  const reach = opts.corridor - 3;
  const fits: TreeSpot[] = [];
  for (const tree of spots) {
    const near = index.nearest(tree.x, tree.y, Math.max(0, opts.corridor));
    if ((near === null || near.dist > reach) && !(cover && cover(tree.x, tree.y) <= reach)) continue;
    let scale = tree.scale;
    if (near !== null) {
      const room = near.dist - (index.at(near).width / 2 + opts.vergeWidth + VERGE_GAP);
      if (!(room > 0)) continue;
      const crown = CROWN_SHARE * crownRadius(tree.variant);
      if (crown * scale > room) {
        const shrunk = room / crown;
        if (shrunk < scale / 2) continue;
        scale = shrunk;
      }
    }
    fits.push(scale === tree.scale ? tree : { ...tree, scale });
  }
  // The same trees survive every build: order by place, then take every k-th.
  fits.sort((a, b) => a.y - b.y || a.x - b.x);
  const cap = Math.max(0, Math.floor(max));
  if (fits.length <= cap) return fits;
  const step = fits.length / cap;
  return Array.from({ length: cap }, (_, k) => fits[Math.floor(k * step)]);
}

/* ================================================================== trees: meshes */

const SALT_TURN = 0x7a11;
/** How much of a card's own facing the foliage normal keeps; the rest points up. */
const CARD_LEAN = 0.35;
const TREE_VERTS = 24;
const TRUNK_TOP = 3;
const TRUNK_MIN = 0.2;

/**
 * Crossed-card trees: three upright two-sided cards per tree, 60 degrees apart, standing `sink` into
 * `ground` at the trunk. Meshes `<prefix>_NNN`, material `trees`.
 */
export function buildTrees(spots: TreeSpot[], ground: Ground, prefix = "TREES", sink: number = SINK): MeshNode[] {
  const meshes = new ChunkedMesh(TREE_VERTS);
  for (const tree of spots) {
    const sp = cardFor(tree.variant);
    const half = sp.crown * tree.scale;
    const foot = ground(tree.x, tree.y) - sink, crownTop = foot + sp.height * tree.scale;
    const turn = placeRandom(tree.x, tree.y, SALT_TURN) * Math.PI;
    const mb = meshes.next(TREE_VERTS);
    for (let card = 0; card < 3; card++) {
      const ang = turn + (card * Math.PI) / 3;
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const ax = tree.x - dx * half, ay = tree.y - dy * half, bx = tree.x + dx * half, by = tree.y + dy * half;
      // Quad (a low, b low, b high, a high) faces (dy, -dx); the back face is wound the other way.
      for (const face of [1, -1]) {
        const nx = dy * face * CARD_LEAN, ny = -dx * face * CARD_LEAN, nl = Math.hypot(nx, ny, 1);
        const aLow = mb.vertex([ax, ay, foot], sp.u0, 1);
        const bLow = mb.vertex([bx, by, foot], sp.u1, 1);
        const bHigh = mb.vertex([bx, by, crownTop], sp.u1, 0);
        const aHigh = mb.vertex([ax, ay, crownTop], sp.u0, 0);
        if (face === 1) mb.quad(aLow, bLow, bHigh, aHigh);
        else mb.quad(bLow, aLow, aHigh, bHigh);
        for (let q = 0; q < 4; q++) mb.normals!.push(nx / nl, ny / nl, 1 / nl);
      }
    }
  }
  return meshes.all().map((mb, i) => mb.toKn5(`${prefix}_${num(i)}`, "trees", { castShadows: true }));
}

/** An invisible collidable box at each tree's trunk, so you can't drive through it. */
export function treeTrunks(spots: TreeSpot[], ground: Ground): MeshNode[] {
  const boxes = new ChunkedMesh(20);
  for (const tree of spots) {
    const w = Math.max(TRUNK_MIN, trunkWidth(tree.variant) * tree.scale);
    const base = ground(tree.x, tree.y);
    box(boxes.next(), [tree.x, tree.y], [1, 0], w, w, base - SINK, base + TRUNK_TOP);
  }
  return boxes.all().map((mb, i) => mb.toKn5(`1WALL_TREE_${num(i)}`, "wall", { renderable: false, castShadows: false }));
}

/* ================================================================== guard rails */

const DROP = 1.8;
const LOOK_OUT = [3, 7];
const OSM_REACH = 12;
const OSM_SPREAD = 3;
const JOIN_GAP = 10;
const MIN_RUN = 24;

/** Runs of true in a list, as [first, last] index pairs. */
function runsOf(flags: boolean[]): [number, number][] {
  const spans: [number, number][] = [];
  let open = -1;
  flags.forEach((v, i) => {
    if (v && open < 0) open = i;
    if (!v && open >= 0) {
      spans.push([open, i - 1]);
      open = -1;
    }
  });
  if (open >= 0) spans.push([open, flags.length - 1]);
  return spans;
}

/** Points along a polyline about every `step` metres, ends included. */
function densify(way: Vec2[], step: number): Vec2[] {
  const pts: Vec2[] = way.length ? [way[0]] : [];
  for (let q = 1; q < way.length; q++) {
    const [ax, ay] = way[q - 1], [bx, by] = way[q];
    const parts = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= parts; k++) pts.push([ax + ((bx - ax) * k) / parts, ay + ((by - ay) * k) / parts]);
  }
  return pts;
}

/**
 * Where a rail is needed, per sample, [left, right]: the land just past the verge more than 1.8 m
 * below the asphalt edge, or a rail OSM maps beside the route. Gaps up to 10 m are joined, runs
 * under 24 m dropped.
 */
export function railNeeds(plan: Route, opts: SceneryOpts, ground: Ground, osmRails: Vec2[][], index: RouteIndex): Sides {
  const stations = plan.samples, count = stations.length;
  const need: Sides = [new Array(count).fill(false), new Array(count).fill(false)];
  stations.forEach((st, i) => {
    for (const side of [0, 1]) {
      const sign = sideSign(side);
      const heightOut = (d: number) => ground(...outFrom(st, sign, d));
      const edge = heightOut(st.width / 2);
      const below = Math.min(...LOOK_OUT.map((d) => heightOut(st.width / 2 + opts.vergeWidth + d)));
      if (edge - below > DROP) need[side][i] = true;
    }
  });
  for (const way of osmRails) {
    for (const [px, py] of densify(way, Math.max(1, opts.spacing))) {
      const near = index.nearest(px, py, OSM_REACH);
      if (near === null) continue;
      const flags = need[near.t >= 0 ? 0 : 1];
      // The segment's two ends, and three samples beyond each.
      for (let d = -OSM_SPREAD; d <= OSM_SPREAD + 1; d++) {
        const at = plan.closed ? (((near.seg + d) % count) + count) % count : near.seg + d;
        if (at >= 0 && at < count) flags[at] = true;
      }
    }
  }
  const spacing = Math.max(0.01, opts.spacing);
  const joinable = Math.round(JOIN_GAP / spacing), shortest = MIN_RUN / spacing;
  for (const flags of need) {
    const spans = runsOf(flags);
    for (let r = 1; r < spans.length; r++) {
      const from = spans[r - 1][1] + 1, to = spans[r][0];
      if (to - from <= joinable) flags.fill(true, from, to);
    }
    for (const [a, b] of runsOf(flags)) if (b - a + 1 < shortest) flags.fill(false, a, b + 1);
  }
  return need;
}

/** The rail's line: this share of the verge out from the asphalt edge. */
const RAIL_OUT = 0.55;
const BEAM_LOW = 0.45, BEAM_HIGH = 0.8;
/** The rail texture repeats every 4 m. */
const RAIL_TILE = 4;
const POST_EVERY = 4;
const POST_BEHIND = 0.08;
const POST_SIZE = 0.1;
/** Samples per rail mesh: four vertices each, well inside the kn5 limit. */
const RAIL_PIECE = 8000;

/** W-beam rails along each run of needed samples (collidable, kept apart so the caller can clear them off the road), and their posts every 4 m. */
export function buildGuardRails(plan: Route, opts: SceneryOpts, needs: Sides, ground: Ground): { rails: MeshNode[]; posts: MeshNode[] } {
  const stations = plan.samples;
  const rails: MeshNode[] = [];
  const postMesh = new ChunkedMesh(20);
  const postStep = Math.max(1, Math.round(POST_EVERY / Math.max(0.01, opts.spacing)));
  const railLine = (st: Station, sign: number) => outFrom(st, sign, st.width / 2 + RAIL_OUT * opts.vergeWidth);
  for (const side of [0, 1]) {
    const sign = sideSign(side);
    let made = 0;
    for (const [first, last] of runsOf(needs[side].slice(0, stations.length))) {
      if (last <= first) continue; // a single sample makes no rail
      for (let from = first; from < last; from += RAIL_PIECE) {
        const to = Math.min(last, from + RAIL_PIECE);
        const mb = new ChunkedMesh().next();
        const pts: Vec2[] = [], base: number[] = [];
        for (let q = from; q <= to; q++) {
          const p = railLine(stations[q], sign);
          pts.push(p);
          base.push(ground(p[0], p[1]));
        }
        // Two faces, each with its own vertices: toward the road (-1) and away from it (+1).
        for (const face of [-1, 1]) {
          const start = mb.vertexCount;
          pts.forEach((p, q) => {
            const st = stations[from + q], u = (st.s - stations[first].s) / RAIL_TILE;
            const nx = st.left[0] * sign * face, ny = st.left[1] * sign * face;
            mb.vertex([p[0], p[1], base[q] + BEAM_LOW], u, 1);
            mb.vertex([p[0], p[1], base[q] + BEAM_HIGH], u, 0);
            mb.normals!.push(nx, ny, 0, nx, ny, 0);
          });
          for (let q = 0; q + 1 < pts.length; q++) {
            const lo = start + q * 2, hi = lo + 1, loNext = lo + 2, hiNext = lo + 3;
            // Winding low, next low, next high, high faces right of the line's direction.
            const ex = pts[q + 1][0] - pts[q][0], ey = pts[q + 1][1] - pts[q][1];
            const st = stations[from + q];
            const facesRight = ey * st.left[0] * sign * face - ex * st.left[1] * sign * face >= 0;
            if (facesRight) mb.quad(lo, loNext, hiNext, hi);
            else mb.quad(loNext, lo, hi, hiNext);
          }
        }
        rails.push(mb.toKn5(`1WALL_RAIL_${side === 0 ? "L" : "R"}_${num(made++)}`, "rail", { castShadows: true }));
      }
      for (let q = first; q <= last; q += postStep) {
        const st = stations[q], rail = railLine(st, sign);
        const at: Vec2 = [rail[0] + st.left[0] * sign * POST_BEHIND, rail[1] + st.left[1] * sign * POST_BEHIND];
        const top = ground(rail[0], rail[1]) + BEAM_HIGH - 0.02;
        box(postMesh.next(), at, st.tan, POST_SIZE, POST_SIZE, ground(at[0], at[1]) - SINK, top);
      }
    }
  }
  return { rails, posts: postMesh.all().map((mb, i) => mb.toKn5(`RAILPOSTS_${num(i)}`, "steel")) };
}

/* ================================================================== guide posts */

const GUIDE_EVERY = 50;
const GUIDE_END = 30;
const GUIDE_CLEAR = 5;
const GUIDE_OUT = 0.75;
const GUIDE_HEIGHT = 1.0;
/** Thirds of the guide post texture (textures.ts postTexture), as u ranges. */
export const GUIDE_U: Record<"red" | "white" | "plain", [number, number]> = { red: [0.02, 0.31], white: [0.35, 0.64], plain: [0.7, 0.98] };

/**
 * White guide posts every 50 m each side, except where `mask` (rails, rings, mouths, kerbs) is set
 * within 5 samples. AS 1742.2: the reflector facing traffic that has the post on its left is red,
 * the one facing traffic with it on its right white; traffic keeps left.
 */
export function buildGuidePosts(plan: Route, opts: SceneryOpts, mask: Sides, ground: Ground): MeshNode[] {
  const stations = plan.samples, last = stations.length - 1;
  const spacing = Math.max(0.01, opts.spacing);
  const step = Math.max(1, Math.round(GUIDE_EVERY / spacing)), margin = Math.ceil(GUIDE_END / spacing);
  const postMesh = new ChunkedMesh(20);
  const { red, white, plain } = GUIDE_U;
  for (const side of [0, 1]) {
    const sign = sideSign(side);
    // Box side 1 faces forward (seen by oncoming traffic), side 3 back (seen by traffic going
    // forward). Left posts are on forward traffic's left: red at the back. Right posts mirror that.
    const faces = side === 0 ? [plain, white, plain, red] : [plain, red, plain, white];
    const flags = mask[side] ?? [];
    for (let q = margin; q <= last - margin; q += step) {
      if (flags.slice(Math.max(0, q - GUIDE_CLEAR), q + GUIDE_CLEAR + 1).some(Boolean)) continue;
      const st = stations[q];
      const at = outFrom(st, sign, st.width / 2 + GUIDE_OUT * opts.vergeWidth);
      const foot = ground(at[0], at[1]);
      box(postMesh.next(), at, st.tan, 0.05, 0.1, foot - SINK, foot + GUIDE_HEIGHT, faces);
    }
  }
  return postMesh.all().map((mb, i) => mb.toKn5(`GUIDEPOSTS_${num(i)}`, "guidepost"));
}
