import { describe, expect, it } from "vitest";
import { decodeTerrarium, imageryChain, tileBbox, tileUrl } from "../src/services/tiles";

const BUSSELTON: [number, number] = [115.34, -33.65];

describe("WA sources", () => {
  it("puts Landgate imagery first in WA, before Esri", () => {
    expect(imageryChain(BUSSELTON)).toEqual(["wa", "esri"]);
    expect(imageryChain([151.2, -33.87])).toEqual(["nsw", "esri"]);
    expect(imageryChain([174.8, -41.2])).toEqual(["esri"]);
  });

  it("asks Landgate's ImageServer for a tile by its Web Mercator box", () => {
    // Tile 0/0/0 is the whole Web Mercator square.
    expect(tileBbox(0, 0, 0)).toBe("-20037508.343,-20037508.343,20037508.343,20037508.343");
    const url = tileUrl("wa", 18, 215043, 158446);
    expect(url).toContain("/Locate/ImageServer/exportImage?bbox=");
    expect(url).not.toContain("{bbox}");
    const [x0, y0, x1, y1] = new URL(url).searchParams.get("bbox")!.split(",").map(Number);
    expect(x1 - x0).toBeCloseTo(152.874, 2);
    expect(y1 - y0).toBeCloseTo(152.874, 2);
  });

  it("decodes Terrarium heights and treats transparent pixels as no data", () => {
    // 12.5 m: 32780.5 = 128 * 256 + 12 + 128 / 256.
    const px = new Uint8Array([128, 12, 128, 255, 0, 0, 0, 0]);
    const h = decodeTerrarium(px);
    expect(h[0]).toBeCloseTo(12.5, 5);
    expect(Number.isNaN(h[1])).toBe(true);
  });
});

describe("CSP street lights", async () => {
  const { streetLightPositions } = await import("../src/core/cspConfig");
  const sample = (s: number, kerb: [number, number] | undefined) => ({
    pos: [s, 0] as [number, number], tan: [1, 0] as [number, number], left: [0, 1] as [number, number],
    curvature: 0, s, width: 8, h: 0, bank: 0, kerb,
  });
  it("lights only kerbed stretches, alternating sides, at pole height", () => {
    const samples = Array.from({ length: 401 }, (_, i) => sample(i, i < 200 ? [1, 1] : undefined));
    const plan = { closed: false, samples, length: 400, roundabouts: [] } as never;
    const pts = streetLightPositions(plan, (s, t, lift) => ({ pos: [s, lift, t] }), 40);
    expect(pts.length).toBeGreaterThan(5);
    expect(pts.every((p) => p[0] < 205)).toBe(true);
    expect(pts.every((p) => p[1] === 7.5)).toBe(true);
    expect(new Set(pts.map((p) => Math.sign(p[2]))).size).toBe(2);
  });
});
