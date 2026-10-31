// S12, roundabouts, junctions and kerbside (track.md S12): each ring's carriageway, island (with
// its photo when the photo covers it), verge and kerb; networkCore's junction surfaces; the
// kerbside bays and bike lanes. Their markings join the route's.

import type { BayBox } from "../bayLanes";
import { encodeDdsDxt1 } from "../dds";
import type { Kn5MeshNode } from "../kn5";
import { kerbsideForTrack, type KerbsideResult } from "../kerbside";
import type { JunctionCore } from "../network/phase1";
import { buildRingMarkings, buildRingMeshes, vergeOuterRadius, type IslandPhoto, type Roundabout } from "../roundabout";
import { meshTop } from "../terrain";
import { STRIP_EXTRA } from "../kerbs";
import type { BuildContext } from "./context";
import type { BuildingPlan } from "./buildingPlan";
import type { Ground } from "./ground";
import type { Imagery } from "./imagery";
import type { Kerbing } from "./kerbing";
import type { Marks } from "./marks";
import type { Registry } from "./registry";
import type { RoadSurfaces } from "./roadMeshes";
import type { RoutePlan } from "./routePlan";
import type { Streets } from "./streets";
import type { Surfaces } from "./surfaces";

export interface Rings {
  ringNodes: Kn5MeshNode[];
  netNodes: Kn5MeshNode[];
  kerbside: KerbsideResult | null;
  bayBoxes: BayBox[];
}

const RING_PX = 256;

export function buildRings(
  ctx: BuildContext, rp: RoutePlan, g: Ground, st: Streets, img: Imagery, bp: BuildingPlan, sf: Surfaces, kb: Kerbing, rm: RoadSurfaces, net: JunctionCore | null, mk: Marks, reg: Registry,
): Rings {
  const { opts, sources } = ctx;
  const plan = rp.plan, nS = plan.samples.length;
  const photo = bp.photo;

  // The island's own photo, when the terrain photos cover (nearly) all of it.
  const ringPhoto = (rb: Roundabout, k: number): IslandPhoto | undefined => {
    if (!photo) return undefined;
    const R = vergeOuterRadius(rb, opts) + 1, span = 2 * R, minX = rb.c[0] - R, maxY = rb.c[1] + R;
    const rgba = new Uint8Array(RING_PX * RING_PX * 4);
    let hit = 0;
    for (let py = 0; py < RING_PX; py++) {
      for (let px = 0; px < RING_PX; px++) {
        const c = photo(minX + ((px + 0.5) / RING_PX) * span, maxY - ((py + 0.5) / RING_PX) * span);
        if (c) hit++;
        const v = c ?? [0.45, 0.45, 0.4];
        const o = (py * RING_PX + px) * 4;
        rgba[o] = Math.round(v[0] * 255);
        rgba[o + 1] = Math.round(v[1] * 255);
        rgba[o + 2] = Math.round(v[2] * 255);
        rgba[o + 3] = 255;
      }
    }
    if (hit < 0.9 * RING_PX * RING_PX) return undefined;
    const name = `rbphoto_${k}`;
    const tex = { rgba, width: RING_PX, height: RING_PX };
    reg.texture(`${name}.dds`, encodeDdsDxt1(rgba, RING_PX, RING_PX));
    reg.preview(`${name}.dds`, tex);
    reg.material(reg.photoGround(name, `${name}.dds`, tex));
    return { material: name, minX, maxY, span };
  };

  const ringNodes: Kn5MeshNode[] = [];
  const markings = mk.markings;
  const ringGround = meshTop(g.terrainAt, opts);
  plan.roundabouts.forEach((rb, k) => {
    if (net?.handlesRing(k)) return;
    const near = plan.samples.reduce((best, s) => (Math.abs(s.s - rb.sIn) < Math.abs(best.s - rb.sIn) ? s : best), plan.samples[0]);
    const material = sf.roadMaterial(Math.floor(plan.samples.indexOf(near) / 120), rb.w, near);
    const m = buildRingMeshes(rb, k, opts, material, ringPhoto(rb, k), ringGround);
    ringNodes.push(m.road, m.island, m.verge, ...m.kerb);
    if (opts.markings) {
      const mark = buildRingMarkings(rb, k);
      if (mark) markings.push(mark);
    }
  });

  const netMeshes = net?.build({
    routeKerb: (i, side) => kb.kerbs[side === 1 ? 0 : 1][((i % nS) + nS) % nS],
    stripOut: opts.vergeWidth + STRIP_EXTRA, vergeWidth: opts.vergeWidth, markings: opts.markings,
    roadMaterial: (pj) => sf.roadMaterial(pj.id, 4, { ...plan.samples[0], pos: pj.j.centre, kerb: [1, 1] }),
    ...(rm.netStreets ? { streetKerbed: (si: number) => rm.netStreets!.kerbed.has(si) } : {}),
  }) ?? null;
  const netNodes = netMeshes ? [...netMeshes.road, ...netMeshes.dress, ...(rm.netStreets?.dress ?? [])] : [];
  if (netMeshes) markings.push(...netMeshes.markings);
  if (rm.netStreets) markings.push(...rm.netStreets.markings);

  // Kerbside parking bays and bike lanes.
  const kerbside = opts.markings && opts.kerbside
    ? kerbsideForTrack(plan, opts.sideStreets ? st.streetPlan.streets : [], g.index, opts, (x, y) => g.terrainAt(x, y).h, sources.osm?.kerbside ?? [], (p) => ctx.toLocal(p), img.parkedSpots)
    : null;
  if (kerbside) markings.push(...kerbside.nodes);
  const bayBoxes = kerbside && opts.laneBayClear !== false ? kerbside.boxes : [];
  return { ringNodes, netNodes, kerbside, bayBoxes };
}
