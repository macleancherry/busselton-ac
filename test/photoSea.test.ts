import { describe, expect, it } from "vitest";
import { SEA_LEVEL, SeaMask, type CoastPolygon } from "../src/core/coast";
import { extConfig } from "../src/core/cspConfig";
import { decodeDds } from "../src/core/dds";
import { BlendMode, DepthMode } from "../src/core/kn5";
import { decodeOwnPng } from "../src/core/png";
import {
  BeachLook, buildPhotoSea, buildShoreFoam, clipToBox, distanceField, drySand, foamMaterial, foamTexture, photoLookup, PHOTO_SEA, sandiness,
  seaSurfaceMaterial, seaSurfaceTexture, wetSand, withSandDetail, type SeaPhoto,
} from "../src/core/photoSea";

// Sea north of y = 100 out to y = 6000; a beach from y = 60 to the water; a jetty 6 m wide 400 m out.
const ocean: CoastPolygon = { rings: [[[-1000, 100], [1000, 100], [1000, 6000], [-1000, 6000]]], edge: [[true, false, false, false]] };
const beach: CoastPolygon = { rings: [[[-1000, 60], [1000, 60], [1000, 100], [-1000, 100]]], edge: [[true, true, true, true]] };
const jetty: CoastPolygon = { rings: [[[-3, 80], [3, 80], [3, 480], [-3, 480]]], edge: [[true, true, true, true]] };
const bounds = { minX: -1000, minY: -500, maxX: 1000, maxY: 6000 };

/** A square photo: turquoise shallows up to 300 m out, then darker blue, sand on land, a white jetty. */
function photoOf(minX: number, minY: number, span: number, size: number, shade?: (x: number, y: number) => [number, number, number]): SeaPhoto {
  const rgba = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const x = minX + ((px + 0.5) / size) * span, y = minY + span - ((py + 0.5) / size) * span;
    const c = shade ? shade(x, y)
      : Math.abs(x) <= 3 && y >= 80 && y <= 480 ? [250, 250, 250]
      : y < 100 ? [205, 195, 165]
      : y < 400 ? [60, 190, 190]
      : [30, 80, 120];
    rgba.set([...c, 255], (py * size + px) * 4);
  }
  return { chunk: { minX, minY, maxX: minX + span, maxY: minY + span }, rgba, size };
}

describe("photo sea: helpers", () => {
  it("measures distance to the nearest source cell", () => {
    const src = new Uint8Array(25);
    src[12] = 1; // the middle of 5 x 5
    const d = distanceField(src, 5, 5);
    expect(d[12]).toBe(0);
    expect(d[13]).toBe(1);
    expect(d[18]).toBeCloseTo(Math.SQRT2);
    expect(d[14]).toBe(2);
  });

  it("clips a triangle to a square", () => {
    const piece = clipToBox([[-5, -5], [15, -5], [-5, 15]], 0, 0, 10, 10);
    let area = 0;
    for (let i = 0; i < piece.length; i++) area += piece[i][0] * piece[(i + 1) % piece.length][1] - piece[(i + 1) % piece.length][0] * piece[i][1];
    // The triangle covers the square below the line x + y = 10: half of it.
    expect(Math.abs(area / 2)).toBeCloseTo(50);
    expect(clipToBox([[20, 20], [30, 20], [20, 30]], 0, 0, 10, 10)).toHaveLength(0);
  });

  it("reads the sharpest photo at a point", () => {
    const coarse = photoOf(0, 0, 1000, 64, () => [10, 10, 10]);
    const fine = photoOf(0, 0, 250, 256, () => [200, 200, 200]);
    const p = photoLookup([coarse, fine]);
    expect(p.at(100, 100)![0]).toBeCloseTo(200);
    expect(p.at(600, 600)![0]).toBeCloseTo(10);
    expect(p.at(-10, 10)).toBeNull();
    expect(p.mpp(100, 100)).toBeLessThan(1);
  });
});

describe("photo sea: the layer under the water", () => {
  // Fine photos along the shore (the drive's), coarse ones further out (the horizon's), none past 2 km.
  const photos: SeaPhoto[] = [];
  for (let x = -1000; x < 1000; x += 250) for (const y of [-250, 0, 250]) photos.push(photoOf(x, y, 250, 256));
  for (let x = -1000; x < 1000; x += 1000) for (const y of [1000]) photos.push(photoOf(x, y, 1000, 128));
  const layer = buildPhotoSea({ ocean: [ocean], piers: [jetty], photos, bounds })!;

  it("lies flat under the water surface, facing up, inside its textures", () => {
    expect(layer.nodes.length).toBeGreaterThan(1);
    for (const m of layer.nodes) {
      expect(m.name).toMatch(/^SEA_PHOTO_\d+$/);
      for (let i = 1; i < m.positions.length; i += 3) expect(m.positions[i]).toBeCloseTo(SEA_LEVEL - PHOTO_SEA.layerDepth);
      for (let i = 1; i < m.normals.length; i += 3) expect(m.normals[i]).toBeGreaterThan(0.99);
      for (const uv of m.uvs) {
        expect(uv).toBeGreaterThanOrEqual(-1e-6);
        expect(uv).toBeLessThanOrEqual(1 + 1e-6);
      }
      // Every triangle faces up (AC: x, up, -north).
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((k) => [m.positions[k * 3], m.positions[k * 3 + 2]]);
        const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
        expect(cross).toBeLessThanOrEqual(1e-6); // clockwise in x, z is counter-clockwise in x, y
      }
    }
  });

  it("is sharp along the shore where the drive's photos are, one map for the rest of the bay", () => {
    expect(layer.stats.tiles).toBeGreaterThan(0);
    expect(layer.materials.map((m) => m.name)).toContain("sea_photo");
    expect(layer.materials.some((m) => /^sea_photo_\d+$/.test(m.name))).toBe(true);
    expect(layer.textures.every((t) => t.name.endsWith(".dds"))).toBe(true);
    // Covers the whole sea: the triangles' area adds up to the polygon's.
    let area = 0;
    for (const m of layer.nodes) for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((k) => [m.positions[k * 3], m.positions[k * 3 + 2]]);
      area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    expect(area).toBeCloseTo(2000 * 5900, -3);
  });

  it("carries the photo's colours, the jetty painted out, fading to deep blue far out", () => {
    const far = layer.textures.find((t) => t.name === "sea_photo.dds")!;
    const img = decodeDds(far.data);
    const [w, h] = layer.stats.far, cell = layer.stats.cell;
    expect([img.width, img.height]).toEqual([w, h]);
    // The map's corner is the sea's box less a margin; find a pixel by its local position.
    const x0 = -1000 - 2 * PHOTO_SEA.farCell, yTop = 100 - 2 * PHOTO_SEA.farCell + h * cell; // the sea's box, clipped to the bounds
    const px = (x: number, y: number) => {
      const i = Math.floor((x - x0) / cell), j = Math.floor((yTop - y) / cell);
      return Array.from(img.rgba.slice((j * w + i) * 4, (j * w + i) * 4 + 3));
    };
    // Turquoise shallows stay turquoise; the deep photo stays blue.
    const shallow = px(500, 200);
    expect(shallow[1]).toBeGreaterThan(150);
    expect(shallow[0]).toBeLessThan(100);
    // The jetty's white deck isn't in it.
    const under = px(0, 300);
    expect(Math.min(...under)).toBeLessThan(200);
    // Past the photos, deep blue (the photo's own deep water).
    expect(layer.stats.deep[2]).toBeGreaterThan(layer.stats.deep[0] + 15);
    const deep = px(0, 5500);
    deep.forEach((v, k) => expect(Math.abs(v - layer.stats.deep[k])).toBeLessThan(10));
  });

  it("is left out with no sea", () => {
    expect(buildPhotoSea({ ocean: [], piers: [], photos, bounds })).toBeNull();
  });
});

describe("photo sea: the water surface", () => {
  it("is partly clear and alpha-blended", () => {
    const tex = decodeOwnPng(seaSurfaceTexture(0.4));
    expect(tex.rgba[3]).toBe(Math.round(0.4 * 255));
    expect(seaSurfaceMaterial().blendMode).toBe(BlendMode.AlphaBlend);
    expect(seaSurfaceMaterial().name).toBe("sea");
  });

  it("asks CSP's water for alpha, depth and a transparent mesh", () => {
    const on = extConfig([], { sea: true, photoSea: true });
    expect(on).toMatch(/\[Material_Water\]\r\nMaterials = sea\r\nType = SEA\r\nUseRecommendedTextures = 1\r\nUseAlphaFromDiffuse = 1\r\nDepthAware = 1\r\n/);
    expect(on).toContain("IS_TRANSPARENT = 1");
    const off = extConfig([], { sea: true });
    expect(off).toContain("[Material_Water]");
    expect(off).not.toContain("UseAlphaFromDiffuse");
    const heads = on.match(/^\[[^\]]+\]/gm)!;
    expect(new Set(heads).size).toBe(heads.length);
  });
});

describe("photo sea: beaches", () => {
  const sea = new SeaMask([ocean], -1100, -600, 1100, 6100);

  it("tells sand from grass and water", () => {
    expect(sandiness(205, 195, 165)).toBeGreaterThan(0.5);
    expect(sandiness(90, 140, 60)).toBe(0);
    expect(sandiness(60, 190, 190)).toBe(0);
    const d = drySand([205, 195, 165]), wet = wetSand([205, 195, 165]);
    expect(d[0]).toBeGreaterThan(225);
    expect(Math.max(...d) - Math.min(...d)).toBeLessThan(30); // near white
    expect(wet[0]).toBeLessThan(160);
  });

  it("whitens the dry sand and darkens it at the water's edge", () => {
    const look = new BeachLook([beach], sea);
    const photo = photoOf(0, 0, 200, 200);
    const out = look.tone(photo.chunk, photo.rgba, photo.size)!;
    expect(out).not.toBeNull();
    const at = (x: number, y: number, a: Uint8Array | Uint8ClampedArray) => {
      const px = Math.floor(x), py = Math.floor(200 - y);
      return Array.from(a.slice((py * 200 + px) * 4, (py * 200 + px) * 4 + 3));
    };
    const dryBefore = at(50, 70, photo.rgba), dry = at(50, 70, out), wet = at(50, 99, out);
    expect(dry[0]).toBeGreaterThan(dryBefore[0] + 15);
    expect(wet[0]).toBeLessThan(dry[0] - 30);
    // The water itself is left alone.
    expect(at(50, 150, out)).toEqual(at(50, 150, photo.rgba));
    // Inland, away from beach and sea, nothing changes.
    expect(at(50, 10, out)).toEqual(at(50, 10, photo.rgba));
  });

  it("leaves a photo with no beach or sea near it untouched", () => {
    const look = new BeachLook([beach], sea);
    const photo = photoOf(0, -600, 200, 64);
    expect(look.tone({ minX: 0, minY: -3000, maxX: 200, maxY: -2800 }, photo.rgba, photo.size)).toBeNull();
  });

  it("puts the fine sand grain on beach photos", () => {
    const ground = {
      name: "terrain_t001", shader: "ksMultilayer", properties: [{ name: "multB", a: 0.5 }], textures: { txDiffuse: "t.dds", txDetailB: "ground_plain.dds" },
    };
    const m = withSandDetail(ground);
    expect(m.textures.txDetailB).toBe("ground_sand.dds");
    expect(m.properties.find((p) => p.name === "multB")!.a).toBeCloseTo(1 / PHOTO_SEA.sandTile);
  });
});

describe("photo sea: foam", () => {
  const sea = new SeaMask([ocean], -1100, -600, 1100, 6100);
  const foam = buildShoreFoam([ocean], sea, [jetty]);

  it("runs along the real shore just above the water, out onto it, clear of the jetty", () => {
    expect(foam.length).toBeGreaterThan(0);
    for (const m of foam) {
      expect(m.transparent).toBe(true);
      for (let i = 0; i < m.positions.length; i += 3) {
        expect(m.positions[i + 1]).toBeCloseTo(SEA_LEVEL + 0.03);
        const y = -m.positions[i + 2];
        expect(y).toBeGreaterThan(100 - PHOTO_SEA.foamIn - 0.01);
        expect(y).toBeLessThan(100 + PHOTO_SEA.foamOut + 0.01);
        // No foam where the jetty comes ashore.
        if (Math.abs(m.positions[i]) < 9) throw new Error(`foam at the jetty: x ${m.positions[i]}`);
      }
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [m.indices[t], m.indices[t + 1], m.indices[t + 2]].map((k) => [m.positions[k * 3], -m.positions[k * 3 + 2]]);
        expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0); // faces up
      }
    }
    // Only the shore edge (the others are tile seams): about 2 km less the jetty.
    const xs = foam.flatMap((m) => Array.from(m.positions).filter((_, i) => i % 3 === 0));
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1900);
  });

  it("is a soft, alpha-blended line that doesn't hide the water", () => {
    const tex = decodeOwnPng(foamTexture());
    const alpha = (v: number) => {
      const row = Math.floor(v * tex.height);
      let s = 0;
      for (let x = 0; x < tex.width; x++) s += tex.rgba[(row * tex.width + x) * 4 + 3];
      return s / tex.width;
    };
    expect(alpha(0.01)).toBeLessThan(20); // up the sand: none
    const line = PHOTO_SEA.foamIn / (PHOTO_SEA.foamIn + PHOTO_SEA.foamOut) + 0.06;
    expect(alpha(line)).toBeGreaterThan(80); // just out from the waterline: bright
    expect(alpha(0.99)).toBeLessThan(40); // out on the water: fading
    expect(foamMaterial().blendMode).toBe(BlendMode.AlphaBlend);
    expect(foamMaterial().depthMode).toBe(DepthMode.NoWrite);
  });
});
