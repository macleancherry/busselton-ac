// S5, the aerial imagery (track.md S5): every terrain chunk's photo, then every backdrop chunk's,
// one after another in chunk order. Parked cars painted out (and kept as spots), beaches toned,
// the photo registered as the chunk's texture, and what the photo shows read off it: tree spots,
// roofs, the raw photos for later stages. Then the photo sea and the shore foam.
//
// Outputs that later stages depend on are sorted by place at the end (determinism rule 2).

import { BeachLook, buildPhotoSea, foamMaterial, foamTexture, sandDetailTexture, withSandDetail, type SeaPhoto, type PhotoSeaLayer } from "../photoSea";
import { centroid, detectBuildings, type Building } from "../buildings";
import { footprintMask, lineMask, paintOutCars } from "../carpark";
import { encodeDdsDxt1 } from "../dds";
import type { Vec2 } from "../geo";
import type { chunkPhotoSampler } from "../frontage";
import { groundMaterial, material } from "../materials";
import { paintFor } from "../parkedCars";
import type { PhotoCar } from "../parkedPlacement";
import type { RoadPlan } from "../road";
import { treeSpotsFromImagery, type TreeSpot } from "../scenery";
import type { TerrainChunk } from "../terrain";
import type { BuildContext } from "./context";
import type { Ground } from "./ground";
import { photoSeaOn } from "./kit";
import { PHOTO_LIGHT, type Registry } from "./registry";
import type { Progress } from "./types";

export type ChunkPhotos = Parameters<typeof chunkPhotoSampler>[0];

export interface Imagery {
  /** Chunk keys that got a photo. */
  textured: Set<string>;
  treeSpots: TreeSpot[];
  farTreeSpots: TreeSpot[];
  /** Roofs found in the photos, sorted by centroid (y, then x). */
  detected: Building[];
  /** Parked cars painted out of the photos, sorted by place. */
  parkedSpots: PhotoCar[];
  carsPainted: number;
  /** The raw terrain photos (frontage, ring photos, kerb returns, ground albedo). */
  photos: ChunkPhotos;
  seaLayer: PhotoSeaLayer | null;
  /** Local street lines for car parking (only with carParks): streets, and the route as one more. */
  streetLines: Vec2[][];
  /** Car park aisles and service roads, local (only with carParks). */
  parkingLines: Vec2[][];
}

const NOT_STREET = /^(path|footway|cycleway|track|steps|pedestrian|bridleway)/;

export async function fetchImagery(ctx: BuildContext, plan: RoadPlan, g: Ground, reg: Registry, progress: Progress): Promise<Imagery> {
  const { opts, sources, proj } = ctx;
  const photoSea = photoSeaOn(ctx, g);
  const textured = new Set<string>();
  const treeSpots: TreeSpot[] = [];
  const farTreeSpots: TreeSpot[] = [];
  const detected: Building[] = [];
  const parkedSpots: PhotoCar[] = [];
  const photos: ChunkPhotos = [];
  const seaPhotos: SeaPhoto[] = [];
  let carsPainted = 0;
  let beachChunks = 0;

  const streetLines = opts.carParks
    ? [...(sources.streets?.lines ?? []).filter((l) => !NOT_STREET.test(l.cls)).map((l) => ctx.line(l.pts)), plan.samples.map((s) => s.pos)]
    : [];
  const parkingLines = opts.carParks
    ? (sources.streets?.lines ?? []).filter((l) => /^(service|parking_aisle)/.test(l.cls)).map((l) => ctx.line(l.pts))
    : [];
  const osmRings = opts.carParks ? (sources.osm?.buildings ?? []).map((b) => ctx.line(b.ring)) : [];
  const beachLook = photoSea ? new BeachLook(g.beaches, g.sea) : null;

  if (sources.imagery && opts.imageryZoom > 0) {
    const jobs: { chunk: TerrainChunk; zoom: number; size: number; prefix: "terrain" | "backdrop" }[] = [
      ...g.chunks.map((chunk) => ({ chunk, zoom: opts.imageryZoom, size: opts.textureSize, prefix: "terrain" as const })),
      ...g.backdrop.map((chunk) => ({ chunk, zoom: opts.horizonZoom, size: 512, prefix: "backdrop" as const })),
    ];
    let done = 0;
    for (const job of jobs) {
      await progress("Fetching aerial imagery", done / jobs.length);
      done++;
      const img = await sources.imagery(proj, job.chunk, job.zoom, job.size);
      if (!img) continue;
      const { chunk, size } = job;
      const span = chunk.maxX - chunk.minX;
      // Parked cars painted out of the ground photo.
      let clean: ReturnType<typeof paintOutCars> | null = null;
      if (opts.carParks && img.rgba && job.prefix === "terrain") {
        const roofs = opts.buildings && opts.detectBuildings ? detectBuildings(img.rgba, size, chunk).map((b) => b.ring) : [];
        clean = paintOutCars(img.rgba, size, span / size, footprintMask([...osmRings, ...roofs], chunk, size), {
          carParks: lineMask(parkingLines, chunk, size, 15),
          streets: lineMask(streetLines, chunk, size, 14),
        });
        carsPainted += clean.cars;
        if (opts.parkedCars) {
          const m = span / size;
          for (const sp of clean.spots) {
            parkedSpots.push({
              at: [chunk.minX + (sp.px + 0.5) * m, chunk.maxY - (sp.py + 0.5) * m],
              dir: [sp.dir[0], -sp.dir[1]],
              paint: paintFor(sp.rgb),
              ...(sp.row ? { row: sp.row } : {}),
            });
          }
        }
      }
      if (photoSea && img.rgba && g.sea.near((chunk.minX + chunk.maxX) / 2, (chunk.minY + chunk.maxY) / 2, span * 0.71)) seaPhotos.push({ chunk, rgba: img.rgba, size });
      const base = clean?.rgba ?? img.rgba;
      const toned = beachLook && base ? beachLook.tone(chunk, base, size) : null;
      if (toned) beachChunks++;
      const name = `${job.prefix}_${chunk.key}`;
      const tex = `${name}.${clean || toned ? "dds" : img.ext}`;
      const pixels = toned ?? clean?.rgba;
      reg.texture(tex, pixels ? encodeDdsDxt1(pixels, size, size) : img.data);
      const photo = toned ?? clean?.rgba ?? img.rgba;
      if (opts.detailShaders && photo && job.prefix === "terrain") {
        const m = groundMaterial(name, tex, reg.photoMask(name, photo, size, size, chunk), PHOTO_LIGHT);
        reg.material(toned ? withSandDetail(m) : m);
      } else {
        reg.material(material(name, tex, PHOTO_LIGHT));
      }
      textured.add(chunk.key);
      if (job.prefix === "terrain" && img.rgba) {
        treeSpots.push(...treeSpotsFromImagery(img.rgba, size, chunk, opts.trees));
        if (opts.buildings && opts.detectBuildings) detected.push(...detectBuildings(img.rgba, size, chunk));
        photos.push({ chunk, rgba: img.rgba, size });
      } else if (job.prefix === "backdrop" && img.rgba && opts.trees > 0) {
        farTreeSpots.push(...treeSpotsFromImagery(img.rgba, size, chunk, 1));
      }
    }
  }

  const seaLayer = photoSea ? buildPhotoSea({ ocean: g.ocean, piers: g.piers, photos: seaPhotos, bounds: g.farBounds }) : null;
  if (seaLayer) {
    for (const t of seaLayer.textures) reg.texture(t.name, t.data);
    for (const m of seaLayer.materials) reg.material(m);
  }
  if (photoSea) reg.scenery("shore_foam.png", foamTexture(), foamMaterial());
  if (beachChunks && opts.detailShaders) reg.texture("ground_sand.dds", sandDetailTexture());

  // Sorted by place, so nothing downstream depends on the order the photos came in.
  const keyed = detected.map((b) => ({ b, c: centroid(b.ring) }));
  keyed.sort((p, q) => p.c[1] - q.c[1] || p.c[0] - q.c[0]);
  parkedSpots.sort((p, q) => p.at[1] - q.at[1] || p.at[0] - q.at[0] || p.dir[0] - q.dir[0] || p.paint - q.paint);
  return { textured, treeSpots, farTreeSpots, detected: keyed.map((k) => k.b), parkedSpots, carsPainted, photos, seaLayer, streetLines, parkingLines };
}
