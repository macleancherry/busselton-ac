// S11.1-9, the road surfaces (track.md S11): the route's road and verge, the rings' openings, the
// kerb returns at the mouths, the nature strip's footpaths and crossovers, kerbs, and the side
// streets (networkCore phase 2's from the graph). In this order: texture order depends on it.

import { encodeDdsDxt1 } from "../dds";
import { buildVergeConcrete, laybacks, readVerge, stripGround, type VergeConcrete } from "../footpaths";
import type { Vec2 } from "../geo";
import { buildKerbReturns, buildKerbs, STRIP_EXTRA, stripPhotoTexture, type KerbMeshes, type StreetEdgePoint, type StripMaterialFn } from "../kerbs";
import type { Kn5MeshNode } from "../kn5";
import type { JunctionCore } from "../network/phase1";
import { buildStreetMeshes, tuckedJoin, type MeshStreet, type StreetMeshes } from "../network/streetMesh";
import { isKerbedStreet, type GraphStreet } from "../network/streets";
import { photoRoadTexture } from "../photoSurface";
import { inRoundabout, surfaceHeight, type RoadSample } from "../road";
import { buildRoadMeshes, type RoadMeshes } from "../roadMesh";
import { outerRadius } from "../roundabout";
import { topSurface } from "../sceneGround";
import { buildSideStreets, streetSurface, type SideStreet } from "../sideStreets";
import { displayOf } from "../trace";
import { isUnsealed, surfaceKeyFor } from "../unsealed";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import type { Kerbing } from "./kerbing";
import type { Registry } from "./registry";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";
import type { Surfaces } from "./surfaces";
import type { Traced } from "./traceRoute";
import type { BuildingPlan } from "./buildingPlan";

export interface RoadSurfaces {
  roadMeshes: RoadMeshes;
  kerbReturns: Kn5MeshNode[];
  kerbMeshes: KerbMeshes;
  verge: VergeConcrete | null;
  vergeConcrete: Kn5MeshNode[];
  sideStreets: Kn5MeshNode[];
  /** networkCore phase 2's street meshes (dress, markings, kerbed streets). */
  netStreets: StreetMeshes | null;
}

const pad3 = (i: number) => String(i).padStart(3, "0");

/** Mutates the plan: each ring's `openings`. */
export function buildRoadSurfaces(
  ctx: BuildContext, rp: RoutePlan, tr: Traced, g: Ground, st: Streets, bp: BuildingPlan, sf: Surfaces, kb: Kerbing, net: JunctionCore | null, reg: Registry,
): RoadSurfaces {
  const { opts } = ctx;
  const plan = rp.plan, nS = plan.samples.length, index = g.index, raster = tr.raster;
  const streets = st.streetPlan.streets;
  const terrainH = g.terrainH;

  // 1. The route's road and verge.
  const roadMeshes = buildRoadMeshes(
    plan, opts, sf.chunkMaterial,
    (i, side) => st.mouth(side, plan.samples[i].s) || kb.kerbAt(i, side),
    sf.unsealedAt.includes(1) ? { at: (i) => sf.unsealedAt[i % nS] === 1, material: sf.gravelMaterial } : undefined,
    net ? { quad: net.routeQuadSkip, ring: net.handlesRing } : undefined,
  );

  // 2. Where roads join each ring: the route's connectors, and side streets ending at it.
  plan.roundabouts.forEach((rb, k) => {
    const open: [number, number][] = [...(roadMeshes.openings[k] ?? [])];
    const ro = outerRadius(rb);
    for (const s of streets) {
      for (const p of [s.pts[0], s.pts[s.pts.length - 1]]) {
        if (Math.hypot(p[0] - rb.c[0], p[1] - rb.c[1]) >= ro + 6) continue;
        const a = Math.atan2(p[1] - rb.c[1], p[0] - rb.c[0]), half = (s.width / 2 + 2.5) / ro;
        open.push([a - half, a + half]);
      }
    }
    if (open.length) rb.openings = open;
  });

  // 3. The nature strip's material: the photo along it, else grass.
  const stripMaterial: StripMaterialFn = (ci, a, b) => {
    if (!raster || opts.imageryZoom <= 0) return { material: "grass", photo: false };
    const name = `strip_photo_${pad3(ci)}`;
    const tex = stripPhotoTexture(plan, displayOf(raster), opts, a, b);
    reg.texture(`${name}.dds`, encodeDdsDxt1(tex.rgba, tex.width, tex.height));
    reg.preview(`${name}.dds`, tex);
    reg.material(reg.photoGround(name, `${name}.dds`, tex));
    return { material: name, photo: true };
  };

  // 4. Where a side street meets a mouth, its edge carries on from the kerb return.
  const surface = streetSurface(plan, index, opts, terrainH);
  const streetAt = st.mouths.map((j) => {
    const smp = plan.samples[j.seg];
    const edge: Vec2 = [smp.pos[0] + smp.left[0] * j.side * (smp.width / 2), smp.pos[1] + smp.left[1] * j.side * (smp.width / 2)];
    for (const s of streets) {
      const k = s.joins.find((q) => Math.hypot(s.pts[q][0] - edge[0], s.pts[q][1] - edge[1]) < 4);
      if (k !== undefined) return { st: s, k };
    }
    return null;
  });
  const streetEdge = (ji: number, c: -1 | 1, R: number): StreetEdgePoint[] | null => {
    const at = streetAt[ji];
    if (!at) return null;
    const { st: s, k: k0 } = at;
    const smp = plan.samples[st.mouths[ji].seg];
    // Walk away from the route: towards the far end of the street.
    const dirStep = k0 === 0 ? 1 : k0 === s.pts.length - 1 ? -1 : (Math.hypot(s.pts[k0 + 1][0] - smp.pos[0], s.pts[k0 + 1][1] - smp.pos[1]) > Math.hypot(s.pts[k0 - 1][0] - smp.pos[0], s.pts[k0 - 1][1] - smp.pos[1]) ? 1 : -1);
    const nxt = s.pts[k0 + dirStep];
    if (!nxt) return null;
    const d0x = nxt[0] - s.pts[k0][0], d0y = nxt[1] - s.pts[k0][1], l0 = Math.hypot(d0x, d0y) || 1;
    const sideSt = Math.sign(smp.tan[0] * c * (-d0y / l0) + smp.tan[1] * c * (d0x / l0)) || 1;
    const w = s.width / 2;
    const out: StreetEdgePoint[] = [];
    let along = 0;
    for (let k = k0; k >= 0 && k < s.pts.length; k += dirStep) {
      if (k !== k0) along += Math.hypot(s.pts[k][0] - s.pts[k - dirStep][0], s.pts[k][1] - s.pts[k - dirStep][1]);
      if (along < R) continue;
      if (along > R + 40) break;
      const a = s.pts[Math.max(0, k - 1)], b = s.pts[Math.min(s.pts.length - 1, k + 1)];
      const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const n: Vec2 = [(-(b[1] - a[1]) / dl) * sideSt, ((b[0] - a[0]) / dl) * sideSt];
      const pos: Vec2 = [s.pts[k][0] + n[0] * w, s.pts[k][1] + n[1] * w];
      if (along > R + 4) {
        const nr = index.nearest(pos[0], pos[1], 40);
        if (nr && nr.dist < index.at(nr).width / 2 + 4) break;
      }
      if (inRoundabout(plan, pos[0], pos[1], 4)) break;
      out.push({ pos, out: n, z: surface(s, k, sideSt * w) });
    }
    return out.length > 4 ? out : null;
  };

  // 5. Kerb returns round the mouths, and their photo atlases.
  let kerbReturns: Kn5MeshNode[] = [];
  let returns: ReturnType<typeof buildKerbReturns> | null = null;
  if (opts.kerbs) {
    const fill = sf.roadMaterial(0, 6, { ...plan.samples[0], kerb: [1, 1] } as RoadSample);
    returns = buildKerbReturns(plan, opts, st.mouths, kb.kerbs, fill, raster && opts.imageryZoom > 0 ? displayOf(raster) : undefined, streetEdge, bp.photo ?? undefined, (x, y) => st.streetIndex.clearance(x, y));
    kerbReturns = returns.nodes;
    if (returns.sideAtlas) {
      reg.texture("sidestrips_photo.dds", encodeDdsDxt1(returns.sideAtlas.rgba, returns.sideAtlas.width, returns.sideAtlas.height));
      reg.preview("sidestrips_photo.dds", returns.sideAtlas);
      reg.material(reg.photoGround("sidestrips_photo", "sidestrips_photo.dds", returns.sideAtlas));
    }
    if (returns.atlas) {
      reg.texture("returns_photo.dds", encodeDdsDxt1(returns.atlas.rgba, returns.atlas.width, returns.atlas.height));
      reg.preview("returns_photo.dds", returns.atlas);
      reg.material(reg.photoGround("returns_photo", "returns_photo.dds", returns.atlas));
    }
  }

  // 6-8. Footpaths and crossovers in the nature strip where the photo shows them; the kerb lays back at each driveway.
  const stripOuter = opts.vergeWidth + STRIP_EXTRA;
  const verge = opts.kerbs && raster ? readVerge(plan, raster, kb.kerbs, stripOuter, (x, y) => st.streetIndex.clearance(x, y) < 0.5) : null;
  const drops = verge ? laybacks(nS, verge) : undefined;
  const kerbMeshes = buildKerbs(plan, opts, kb.kerbs, stripMaterial, net ? new Set([...(returns?.noRamp ?? []), ...net.noRamp]) : returns?.noRamp, drops);
  // The ground under the verge concrete: the strip and kerb meshes as built, else the strip worked out, terrain beyond.
  const stripMesh = verge ? topSurface([...kerbMeshes.strip, ...kerbMeshes.kerb, ...kerbReturns]) : () => null;
  const stripRule = stripGround(plan, index, opts.crown, opts.vergeWidth, kb.kerbs, drops, (x, y) => g.terrainAt(x, y).h);
  const vergeGround = (x: number, y: number) => stripMesh(x, y) ?? stripRule(x, y);
  const vergeConcrete = verge ? buildVergeConcrete(plan, verge, vergeGround) : [];

  // 9. Side streets: a photo surface on the nearest 40 traced ones (roadSurface photo), gravel, or sealed.
  const photoStreets = new Set(
    opts.roadSurface === "photo" && raster
      ? streets
        .filter((s) => s.traced && s.traced.conf.filter((c) => c > 0.7).length > 0.5 * s.traced.conf.length)
        .map((s) => ({ st: s, d: Math.min(...s.pts.map(([x, y]) => index.nearest(x, y, 1e4)?.dist ?? Infinity)) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 40)
        .map((x) => x.st)
      : [],
  );
  const sideMaterial = (s: SideStreet, i: number): string | { material: string; perStreet: true } => {
    if (photoStreets.has(s) && s.traced && st.streetRaster) {
      const sub = s.traced.plan, conf = s.traced.conf;
      const name = `side_photo_${pad3(i)}`;
      let h = 64;
      while (h < 2048 && h < sub.length / 0.12) h *= 2;
      const tex = photoRoadTexture(sub, displayOf(st.streetRaster), 0, sub.samples.length - 1, (k) => conf[k] > 0.7, 128, h);
      reg.texture(`${name}.dds`, encodeDdsDxt1(tex.rgba, tex.width, tex.height));
      reg.preview(`${name}.dds`, tex);
      reg.material(reg.photoGround(name, `${name}.dds`, tex));
      return { material: name, perStreet: true };
    }
    if (sf.gravelOn && isUnsealed(s.surface, s.cls)) return sf.gravelMaterial(i, s.width);
    const mid = s.pts[Math.floor(s.pts.length / 2)];
    return sf.roadMaterial(i, s.width, { ...plan.samples[0], pos: mid });
  };
  // networkCore phase 2's streets are meshed from the graph's plan with kerbs, medians and markings.
  const netStreets = st.net2 && net ? (() => {
    const jn = net;
    const routeGap = (p: Vec2, max: number) => {
      const nr = index.nearest(p[0], p[1], max);
      return nr ? nr.dist - index.at(nr).width / 2 : Infinity;
    };
    return buildStreetMeshes(streets as MeshStreet[], {
      ground: jn.streetGround((x, y) => g.terrainAt(x, y).h), lift: 0.1, skip: jn.streetSkip as (s: MeshStreet, s0: number, s1: number) => boolean,
      joinZ: ([x, y]) => {
        const nr = index.nearest(x, y, 40);
        if (!nr) return null;
        const at = index.at(nr);
        return tuckedJoin(surfaceHeight({ ...plan.samples[nr.seg], h: at.h, bank: at.bank, width: at.width }, nr.t, opts.crown), at.width / 2 - nr.dist);
      },
      joinGap: (p) => routeGap(p, 10), junctionDist: jn.sdfAt,
      clear: (p, si) => Math.min(jn.streetClear(p, new Set([si])), routeGap(p, 30)),
      kerbed: (si) => opts.kerbs && !(sf.gravelOn && isUnsealed(streets[si].surface, streets[si].cls)) && isKerbedStreet(streets[si] as GraphStreet),
      markings: opts.markings, material: (si) => sideMaterial(streets[si], si), surfaceKey: (m) => surfaceKeyFor(m, false),
    });
  })() : null;
  const sideStreets = netStreets ? netStreets.road
    : buildSideStreets(streets, plan, index, opts, net ? net.streetGround((x, y) => g.terrainAt(x, y).h) : (x, y) => g.terrainAt(x, y).h, sideMaterial, net?.streetSkip);

  return { roadMeshes, kerbReturns, kerbMeshes, verge, vergeConcrete, sideStreets, netStreets };
}
