// Busselton fork: is any scenery standing on water, wetland, sand, a groyne or seawall, a jetty, or
// the shore strip? (scripts/check/shore_check.ts runs it on a build's zip.)
//
// What counts as each comes from two places:
//   - the build's own mask, extension/shore_mask.png (shoreClear.ts: OSM sea, inland water, wetland,
//     beaches and sand, groynes, jetties, the strip between the sand and the water, and sand-coloured
//     shore within photoSea's 25 m of the sea), when the build has one;
//   - the built meshes themselves, so older builds and anything the mask missed are still caught:
//     the sea surface (SEA), the seawall and groyne rocks (SEAWALL) and the jetty decks (JETTY_).
// Placed things are found as connected pieces, as groundCheck.ts does; a piece stands where the
// middle of its base (its lowest vertices) is. Tree cards are pieces of their own, and every card of
// a tree stands on its trunk, so trees are counted once per trunk.
//
// Trees fail on any of it. Buildings, shops, furniture and parked cars fail on the sea, water, wetland
// and groynes, and are only listed on the seawall rocks, sand, beach, strip and jetty (real buildings
// stand right behind the revetment; cafes and lamps line the foreshore).
import type { Kn5Node } from "./kn5";
import { SHORE_CLASSES } from "./shoreClear";

export type Where = "sea" | "water" | "wetland" | "jetty" | "groyne" | "beach" | "sand" | "strip" | "seawall";
export interface ShoreHit { kind: "tree" | "other"; group: string; mesh: string; x: number; y: number; where: Where; fails: boolean }
export interface ShoreMaskData { x0: number; y0: number; cell: number; w: number; h: number; classes: string[]; value: (c: number, r: number) => number }
export interface ShoreReport { trees: number; others: number; hits: ShoreHit[]; failed: number; byWhere: Record<string, { trees: number; others: number }> }

type Mesh = Extract<Kn5Node, { kind: "mesh" }>;
const meshesIn = (n: Kn5Node): Mesh[] => (n.kind === "mesh" ? [n] : n.children.flatMap(meshesIn));

const TREE = /^(TREES|HOUSETREES|HORIZONTREES|ISLANDTREES)/;
const OTHER_GROUPS = new Set(["BUILDINGS", "SHOPS", "FURNITURE", "PARKED_CARS", "TRAFFICLIGHTS"]);
const WET: ReadonlySet<Where> = new Set(["sea", "water", "wetland", "groyne"]);

/** Triangles of some meshes in local x, y (north), with a coarse grid for lookups. */
class Footprint {
  private readonly tris: number[] = [];
  private readonly grid = new Map<string, number[]>();
  constructor(meshes: Mesh[], private readonly cell = 25) {
    for (const m of meshes) {
      const p = m.positions, ix = m.indices;
      for (let t = 0; t < ix.length; t += 3) {
        const id = this.tris.length / 6;
        const pts = [ix[t], ix[t + 1], ix[t + 2]].map((v) => [p[v * 3], -p[v * 3 + 2]]);
        this.tris.push(...pts.flat());
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        for (let i = Math.floor(Math.min(...xs) / cell); i <= Math.floor(Math.max(...xs) / cell); i++)
          for (let j = Math.floor(Math.min(...ys) / cell); j <= Math.floor(Math.max(...ys) / cell); j++) {
            const k = `${i},${j}`;
            const l = this.grid.get(k);
            if (l) l.push(id); else this.grid.set(k, [id]);
          }
      }
    }
  }
  has(x: number, y: number): boolean {
    for (const id of this.grid.get(`${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}`) ?? []) {
      const [ax, ay, bx, by, cx, cy] = this.tris.slice(id * 6, id * 6 + 6);
      const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
      const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
      const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return true;
    }
    return false;
  }
}

/** Where each placed piece stands: the middle of its base, per connected piece of a mesh. */
function pieces(m: Mesh): { x: number; y: number; n: number }[] {
  const p = m.positions, key = new Map<string, number>(), X: number[] = [], Y: number[] = [], H: number[] = [], parent: number[] = [], local: number[] = [];
  const find = (a: number): number => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let v = 0; v < p.length; v += 3) {
    const k = `${Math.round(p[v] * 1000)},${Math.round(p[v + 1] * 1000)},${Math.round(p[v + 2] * 1000)}`;
    let id = key.get(k);
    if (id === undefined) { id = X.length; key.set(k, id); X.push(p[v]); Y.push(-p[v + 2]); H.push(p[v + 1]); parent.push(id); }
    local.push(id);
  }
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = find(local[m.indices[t]]), b = find(local[m.indices[t + 1]]), c = find(local[m.indices[t + 2]]);
    parent[a] = c; parent[b] = c;
  }
  const lo = new Map<number, number>();
  for (let v = 0; v < X.length; v++) { const r = find(v); lo.set(r, Math.min(lo.get(r) ?? Infinity, H[v])); }
  const acc = new Map<number, [number, number, number]>();
  for (let v = 0; v < X.length; v++) {
    const r = find(v);
    if (H[v] > lo.get(r)! + 0.05) continue;
    const a = acc.get(r) ?? [0, 0, 0];
    a[0] += X[v]; a[1] += Y[v]; a[2]++;
    acc.set(r, a);
  }
  return [...acc.values()].map(([x, y, n]) => ({ x: x / n, y: y / n, n }));
}

/** Checks a build's models (main kn5 first, then layers) against its mask and its own sea, rocks and jetties. */
export function checkShore(models: Kn5Node[], mask?: ShoreMaskData): ShoreReport {
  const all = models.flatMap((root) => {
    const top = root.kind === "node" ? root.children : [root];
    return top.flatMap((g) => meshesIn(g).map((m) => ({ group: g.kind === "node" ? g.name : "", m })));
  });
  const sea = new Footprint(all.filter(({ m }) => /^SEA(_\d+|$)/.test(m.name)).map(({ m }) => m));
  const rocks = new Footprint(all.filter(({ m }) => /^SEAWALL/.test(m.name)).map(({ m }) => m));
  const jetty = new Footprint(all.filter(({ m }) => /^JETTY_(DECK|TIMBER|PLATFORMS)/.test(m.name)).map(({ m }) => m));
  const fromMask = (x: number, y: number): Where | null => {
    if (!mask) return null;
    const c = Math.floor((x - mask.x0) / mask.cell), r = Math.floor((y - mask.y0) / mask.cell);
    if (c < 0 || r < 0 || c >= mask.w || r >= mask.h) return null;
    const v = mask.value(c, r);
    return v ? ((mask.classes[v - 1] ?? SHORE_CLASSES[v]) as Where) : null;
  };
  const whereAt = (x: number, y: number): Where | null => {
    if (sea.has(x, y)) return "sea";
    if (rocks.has(x, y)) return "seawall";
    const m = fromMask(x, y);
    if (m) return m;
    if (jetty.has(x, y)) return "jetty";
    return null;
  };
  const report: ShoreReport = { trees: 0, others: 0, hits: [], failed: 0, byWhere: {} };
  const seenTree = new Set<string>();
  for (const { group, m } of all) {
    const isTree = m.material === "trees" && TREE.test(m.name.replace(/^lm_/, ""));
    if (!isTree && !OTHER_GROUPS.has(group)) continue;
    // Invisible walls aren't scenery; a building is judged by its walls (1WALL_BLD_), not each window and soffit.
    if (/^1WALL/.test(m.name) && !/^1WALL_BLD/.test(m.name)) continue;
    if (group === "BUILDINGS" && !/^1WALL_BLD/.test(m.name)) continue;
    for (const pc of pieces(m)) {
      if (isTree) {
        // Half a card (a tile seam split it) has one foot: its other corner, not the trunk.
        if (pc.n < 2) continue;
        const k = `${Math.round(pc.x * 2)},${Math.round(pc.y * 2)}`;
        if (seenTree.has(k)) continue;
        seenTree.add(k);
        report.trees++;
      } else report.others++;
      const where = whereAt(pc.x, pc.y);
      if (!where) continue;
      const fails = isTree || WET.has(where);
      report.hits.push({ kind: isTree ? "tree" : "other", group, mesh: m.name, x: pc.x, y: pc.y, where, fails });
      if (fails) report.failed++;
      const b = (report.byWhere[where] ??= { trees: 0, others: 0 });
      if (isTree) b.trees++; else b.others++;
    }
  }
  return report;
}
