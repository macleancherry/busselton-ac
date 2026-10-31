// S14.11, S15 and S17 (track.md): the ground buildings stand on, the houses' street fronts, house
// looks (a facade, front fence or hedge and yard trees for particular houses; a placed house; a
// whole house from a spec), shop fronts, then (finish) the clear circles, the building meshes and
// the front yards.

import { buildBuildings, centroid, houseRoof, plainHouse, pointInRing, type Building } from "../buildings";
import { facadeTexture, ROOF_COLOURS, roofTexture } from "../buildingStyles";
import { flagMaterial } from "../flags";
import { facadeForLook, facadeForStyle } from "../houseLooks";
import type { Vec2 } from "../geo";
import type { Kn5MeshNode } from "../kn5";
import { buildLots } from "../lots";
import { material, type Light } from "../materials";
import { encodePng } from "../png";
import { ringTouches, SINK } from "../sceneGround";
import type { TreeSpot } from "../scenery";
import { buildShopfronts, findShopfronts, shopSignTexture, shopWindowTexture, type Shopfront } from "../shops";
import { buildSpecHouse } from "../specHouse";
import { surfaceTexture } from "../surfaceTextures";
import { solidTexture } from "../textures";
import type { BuildContext } from "./context";
import { facadeScenery, roofScenery, type BuildingPlan } from "./buildingPlan";
import type { Ground } from "./ground";
import type { GroundMeshes } from "./groundMeshes";
import type { Registry } from "./registry";
import type { Scenery } from "./placeScenery";

const L = (ambient: number, diffuse: number, specular: number, exp: number): Light => ({ ambient, diffuse, specular, exp });

export interface Houses {
  /** Buildings to build (clears remove some in finish). */
  shown: Building[];
  /** The houses among them (looks, lots). */
  homes: Building[];
  houseTrees: TreeSpot[];
  specNodes: Kn5MeshNode[];
  specLandmarks: { name: string; at: Vec2 }[];
  housesLooked: number;
  shopfronts: Shopfront[];
  shopMeshes: Kn5MeshNode[];
  buildingGround: (x: number, y: number) => number;
  onBaseRing: (ring: Vec2[]) => boolean;
  groundForBuilding: (b: Building) => (x: number, y: number) => number;
}

export function buildHouses(ctx: BuildContext, g: Ground, bp: BuildingPlan, gm: GroundMeshes, sc: Scenery, reg: Registry): Houses {
  const { opts, sources } = ctx;
  const ground = gm.ground;
  const horizonGround = sc.horizonGround;
  // A building on the base's ground (inside the cover, or over a mesh), else out on the horizon mesh.
  const onBase = (x: number, y: number) => g.inCover(x, y, 1) || ground.mesh(x, y) !== null;
  const buildingGround = (x: number, y: number) => (onBase(x, y) ? ground(x, y) : horizonGround(x, y));
  const onBaseRing = (ring: Vec2[]) => ring.some(([x, y]) => onBase(x, y)) || onBase(...centroid(ring)) || ringTouches(ground.mesh, ring);
  const groundForBuilding = (b: Building) => (onBaseRing(b.ring) ? ground.forRing(b.ring) : horizonGround);
  const roadGap = bp.roadEdge;
  const finishes = bp.finishes;

  // With a horizon, shown is kept itself: what looks place and clears remove changes kept too (B2).
  const shown = opts.horizon > 0 ? bp.kept : bp.kept.filter((b) => b.ring.every(([x, y]) => g.inCover(x, y, 1)));
  const homes = shown.filter((b) => b.ring.length === 4 && b.roof !== "flat" && b.height <= 7.5);
  if (opts.houseStyle) {
    for (const b of homes) {
      if (b.type !== "house") continue;
      const f = facadeForStyle(opts.houseStyle.facades, centroid(b.ring));
      if (f !== undefined) b.facade = f;
    }
  }
  const edgeMid = (b: Building, k: number): Vec2 => {
    const a = b.ring[k], c = b.ring[(k + 1) % b.ring.length];
    return [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
  };
  for (const b of homes) {
    if (b.front) continue;
    let best = 25;
    for (let k = 0; k < 4; k++) {
      const m = edgeMid(b, k), gap = roadGap(m[0], m[1]);
      if (gap < best) {
        best = gap;
        b.front = [b.ring[k], b.ring[(k + 1) % 4]];
        b.setback = gap;
      }
    }
  }

  const houseTrees: TreeSpot[] = [];
  const specNodes: Kn5MeshNode[] = [];
  const specLandmarks: { name: string; at: Vec2 }[] = [];
  let housesLooked = 0;
  const removeIn = (fps: Vec2[][]) => {
    const inside = (b: Building) => fps.some((f) => [centroid(b.ring), ...b.ring].some(([x, y]) => pointInRing(x, y, f)));
    for (const list of [shown, homes]) for (let i = list.length - 1; i >= 0; i--) if (inside(list[i])) list.splice(i, 1);
  };
  const toRoadAt = (x: number, y: number): Vec2 => {
    const gx = (roadGap(x + 1, y) - roadGap(x - 1, y)) / 2, gy = (roadGap(x, y + 1) - roadGap(x, y - 1)) / 2;
    const l = Math.hypot(gx, gy) || 1;
    return [-gx / l, -gy / l];
  };

  (sources.houseLooks ?? []).forEach((look, k) => {
    const at = ctx.toLocal(look.at);
    if (ctx.cleared(at[0], at[1])) return;
    // A whole house from a spec, in place of whatever stood there.
    if (look.spec && Number.isFinite(roadGap(at[0], at[1]))) {
      const toRoad: Vec2 = look.facing !== undefined
        ? [Math.sin((look.facing * Math.PI) / 180), Math.cos((look.facing * Math.PI) / 180)]
        : toRoadAt(at[0], at[1]);
      const tag = String(k);
      const probe = buildSpecHouse(look.spec, { centre: at, toRoad, z: 0 }, tag);
      const z = probe.footprints.length
        ? Math.min(...probe.footprints.map((f) => (onBaseRing(f) ? ground.underRing(f) : horizonGround(...centroid(f)))))
        : buildingGround(at[0], at[1]);
      const house = buildSpecHouse(look.spec, { centre: at, toRoad, z }, tag);
      removeIn(house.footprints);
      for (const f of house.facades) reg.building(`facade_${f.name}`, facadeTexture(f), L(0.45, 0.45, 0.05, 10), 3);
      for (const r of house.roofs) {
        if (finishes.roofs.has(r)) continue;
        finishes.roofs.add(r);
        roofScenery(reg, r);
      }
      for (const s of house.solids) {
        if (s.flag && opts.wavingFlags !== false) reg.scenery(`${s.name}.png`, solidTexture(s.rgb), flagMaterial(s.name, `${s.name}.png`));
        else if (s.surface) reg.building(s.name, surfaceTexture(s.surface, s.rgb), L(0.45, 0.45, 0.05, 10), 3);
        else reg.scenery(`${s.name}.png`, solidTexture(s.rgb), material(s.name, `${s.name}.png`, L(0.45, 0.45, 0.1, 15)));
      }
      for (const s of house.signs) {
        const w = 1024, h = Math.max(64, Math.min(512, Math.round((1024 * s.height) / s.width / 32) * 32));
        const drawn = sources.drawSigns?.([{ text: s.text, bg: s.bg, ink: s.ink, squeeze: 1 }], w, h);
        const rgba = drawn ? Uint8Array.from(drawn) : new Uint8Array(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : s.bg[i % 4]));
        reg.scenery(`${s.name}.png`, encodePng(rgba, w, h, { alpha: false }), material(s.name, `${s.name}.png`, L(0.5, 0.45, 0.1, 15)));
      }
      specNodes.push(...house.nodes);
      houseTrees.push(...house.trees);
      specLandmarks.push({ name: look.name ?? "landmark", at });
      housesLooked++;
      return;
    }
    // The house it's for: by its front, by its footprint, else by its middle.
    const frontMid = (b: Building) => (b.front ? [(b.front[0][0] + b.front[1][0]) / 2, (b.front[0][1] + b.front[1][1]) / 2] : null);
    const nearest = (list: Building[], key: (b: Building) => number[] | null, max: number) => {
      let best: Building | undefined, bd = max;
      for (const b of list) {
        const p = key(b);
        if (!p) continue;
        const d = Math.hypot(p[0] - at[0], p[1] - at[1]);
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      return best;
    };
    let best = nearest(homes, frontMid, 8) ?? homes.find((b) => pointInRing(at[0], at[1], b.ring)) ?? nearest(homes, (b) => centroid(b.ring), 6);
    if (best && !best.front) {
      let bd = Infinity;
      for (let e = 0; e < best.ring.length; e++) {
        const a = best.ring[e], c = best.ring[(e + 1) % best.ring.length];
        if (Math.hypot(c[0] - a[0], c[1] - a[1]) < 4) continue;
        const m = edgeMid(best, e), gap = roadGap(m[0], m[1]);
        if (gap < bd) {
          bd = gap;
          best.front = [a, c];
          best.setback = gap;
        }
      }
    }
    // No house there: place a plain one facing the road.
    if (!best && look.place && Number.isFinite(roadGap(at[0], at[1]))) {
      const toRoad = toRoadAt(at[0], at[1]);
      const side: Vec2 = [toRoad[1], -toRoad[0]];
      const W = 15, D = 13;
      const corner = (u: number, v: number): Vec2 => [at[0] + side[0] * u + toRoad[0] * v, at[1] + side[1] * u + toRoad[1] * v];
      // Back corners, then the front wall (its corners in the ring's order).
      const ring: Vec2[] = [corner(W / 2, -D / 2), corner(-W / 2, -D / 2), corner(-W / 2, D / 2), corner(W / 2, D / 2)];
      const surfmist = ROOF_COLOURS.findIndex((r) => r.name === "surfmist");
      const b: Building = { ...plainHouse(houseRoof(() => 0.3), surfmist, 3), ring, source: "detected", front: [ring[2], ring[3]], setback: Math.max(2, roadGap(ring[2][0], ring[2][1])) };
      shown.push(b);
      homes.push(b);
      if (!finishes.roofs.has(surfmist)) {
        finishes.roofs.add(surfmist);
        roofScenery(reg, surfmist);
      }
      best = b;
    }
    if (!best) return;
    let applied = false;
    const facade = facadeForLook(look.facade, look.colour, best.facade);
    if (facade !== undefined) {
      best.facade = facade;
      applied = true;
    }
    if (look.front) {
      best.frontKind = look.front;
      if (look.hedgeHeight !== undefined) best.hedgeHeight = look.hedgeHeight;
      applied = true;
    }
    if (look.trees && best.front) {
      const [a, c] = best.front;
      const mid: Vec2 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
      const [cx, cy] = centroid(best.ring);
      const ex = c[0] - a[0], ey = c[1] - a[1], el = Math.hypot(ex, ey) || 1;
      let out: Vec2 = [ey / el, -ex / el];
      if (out[0] * (mid[0] - cx) + out[1] * (mid[1] - cy) < 0) out = [-out[0], -out[1]];
      const half = (best.setback ?? roadGap(mid[0], mid[1])) / 2;
      for (let t = 0; t < look.trees; t++) {
        // Across the middle 60% of the front.
        const f = 0.2 + (0.6 * (t + 0.5)) / look.trees;
        houseTrees.push({ x: a[0] + (c[0] - a[0]) * f + out[0] * half, y: a[1] + (c[1] - a[1]) * f + out[1] * half, scale: 0.85, variant: 0 });
      }
      applied = true;
    }
    if (applied) housesLooked++;
  });

  // Facades the looks gave that aren't registered yet.
  for (const b of homes) {
    if (finishes.facades.has(b.facade)) continue;
    finishes.facades.add(b.facade);
    facadeScenery(reg, b.facade);
  }

  // Shop fronts: verandahs, windows and signs on buildings with a shop (not on one a layer replaces).
  const homeSet = new Set(homes);
  const shopfronts = opts.buildings ? findShopfronts(
    shown.filter((b) => !ctx.clears.length || !ctx.cleared(...centroid(b.ring))), bp.pois, roadGap, buildingGround, (b) => homeSet.has(b), groundForBuilding,
  ) : [];
  const shopMeshes = buildShopfronts(shopfronts, buildingGround);
  if (shopMeshes.length) {
    reg.texture("shop_sign.png", shopSignTexture(shopfronts, sources.drawSigns));
    reg.texture("shop_window.png", shopWindowTexture());
    reg.material(material("shop_sign", "shop_sign.png", L(0.5, 0.45, 0.1, 15)));
    reg.material(material("shop_window", "shop_window.png", L(0.4, 0.3, 0.6, 60)));
    reg.material(material("verandah", "verandah.png", L(0.45, 0.45, 0.2, 20)));
    reg.texture("verandah.png", roofTexture(ROOF_COLOURS[1]));
  }
  return { shown, homes, houseTrees, specNodes, specLandmarks, housesLooked, shopfronts, shopMeshes, buildingGround, onBaseRing, groundForBuilding };
}

/** S17: the clear circles take their buildings and trees, then the building meshes and front yards. */
export function finishHouses(ctx: BuildContext, g: Ground, hs: Houses, bp: BuildingPlan): { houses: Kn5MeshNode[]; lots: Kn5MeshNode[] } {
  const { opts } = ctx;
  if (ctx.clears.length) {
    for (const list of [hs.shown, hs.homes]) for (let i = list.length - 1; i >= 0; i--) if (ctx.cleared(...centroid(list[i].ring))) list.splice(i, 1);
    for (let i = hs.houseTrees.length - 1; i >= 0; i--) if (ctx.cleared(hs.houseTrees[i].x, hs.houseTrees[i].y, true)) hs.houseTrees.splice(i, 1);
  }
  // Front-yard and landmark trees off the water and the sand too (shoreClear.ts).
  const shore = g.shore;
  if (shore) for (let i = hs.houseTrees.length - 1; i >= 0; i--) if (shore.hitsAround(hs.houseTrees[i].x, hs.houseTrees[i].y, 1)) hs.houseTrees.splice(i, 1);
  // One ground per building: 2 cm into the base's ground, or out on the horizon mesh sunk 40 cm.
  const houses = buildBuildings(hs.shown, hs.buildingGround, (b) => (hs.onBaseRing(b.ring) ? SINK : 0.4), hs.groundForBuilding);
  const lots = opts.buildings ? buildLots(hs.homes.filter((b) => b.ring.every(([x, y]) => g.inCover(x, y, 1))), hs.buildingGround, { roadGap: bp.roadEdge }) : [];
  return { houses, lots };
}

