import { PbfWriter } from "pbf";
import { describe, expect, it } from "vitest";
import { lngLatToPixel, pixelToLngLat, type LngLat } from "../src/core/geo";
import { fetchSeen, savedToken, saveToken } from "../src/services/mapillary";

type Feat = { x: number; y: number; value?: string };

/** A minimal Mapbox Vector Tile: one layer of point features, extent 4096. */
function mvt(layer: string, feats: Feat[]): Uint8Array {
  const values = [...new Set(feats.flatMap((f) => (f.value === undefined ? [] : [f.value])))];
  const zz = (n: number) => (n << 1) ^ (n >> 31);
  const pbf = new PbfWriter();
  pbf.writeMessage(3, (_: null, l: PbfWriter) => {
    l.writeVarintField(15, 2);
    l.writeStringField(1, layer);
    for (const f of feats) {
      l.writeMessage(2, (_: null, m: PbfWriter) => {
        if (f.value !== undefined) m.writePackedVarint(2, [0, values.indexOf(f.value)]);
        m.writeVarintField(3, 1);
        m.writePackedVarint(4, [9, zz(f.x), zz(f.y)]);
      }, null);
    }
    l.writeStringField(3, "value");
    for (const v of values) l.writeMessage(4, (_: null, m: PbfWriter) => m.writeStringField(1, v), null);
    l.writeVarintField(5, 4096);
  }, null);
  return pbf.finish();
}

const tileOf = (ll: LngLat) => lngLatToPixel(ll, 14).map((v) => Math.floor(v / 256)) as [number, number];
/** A bbox well inside tile (tx, ty), or spanning to (tx + dx, ty + dy). */
function bboxOver(tx: number, ty: number, dx = 0, dy = 0): [number, number, number, number] {
  const nw = pixelToLngLat([tx * 256 + 10, ty * 256 + 10], 14);
  const se = pixelToLngLat([(tx + dx) * 256 + 246, (ty + dy) * 256 + 246], 14);
  return [nw[0], se[1], se[0], nw[1]];
}

const [TX, TY] = tileOf([115.35, -33.65]);
const ok = (body: Uint8Array) => new Response(new Uint8Array(body), { status: 200 });
const fast = { retryDelayMs: 1 };

function fakeFetch(answer: (url: string) => Promise<Response> | Response) {
  const urls: string[] = [];
  const f = async (url: string) => {
    urls.push(url);
    return answer(url);
  };
  return { urls, fetch: f };
}

describe("Mapillary map features", () => {
  it("asks for the two tile sets of one tile, token encoded", async () => {
    const { urls, fetch } = fakeFetch(() => ok(mvt("point", [])));
    await fetchSeen(bboxOver(TX, TY), "MLY|abc", { fetch, ...fast });
    expect(urls).toEqual([
      `https://tiles.mapillary.com/maps/vtp/mly_map_feature_point/2/14/${TX}/${TY}?access_token=MLY%7Cabc`,
      `https://tiles.mapillary.com/maps/vtp/mly_map_feature_traffic_sign/2/14/${TX}/${TY}?access_token=MLY%7Cabc`,
    ]);
  });

  it("covers the range row by row, points before signs", async () => {
    const { urls, fetch } = fakeFetch(() => ok(mvt("point", [])));
    await fetchSeen(bboxOver(TX, TY, 1, 2), "t", { fetch, concurrency: 1, ...fast });
    expect(urls).toHaveLength(12);
    const want: string[] = [];
    for (let y = TY; y <= TY + 2; y++) {
      for (let x = TX; x <= TX + 1; x++) {
        for (const set of ["point", "traffic_sign"]) want.push(`mly_map_feature_${set}/2/14/${x}/${y}?`);
      }
    }
    urls.forEach((u, i) => expect(u).toContain(want[i]));
  });

  it("refuses a box over 200 tiles without asking", async () => {
    const { urls, fetch } = fakeFetch(() => ok(mvt("point", [])));
    const warned: string[] = [];
    await expect(fetchSeen(bboxOver(TX, TY, 14, 14), "t", { fetch, warn: (m) => warned.push(m) })).rejects.toThrow(/too big for Mapillary: 225 tiles/);
    expect(urls).toHaveLength(0);
    expect(warned).toHaveLength(1);
  });

  it("keeps only the kinds the build places", async () => {
    const values = [
      "regulatory--stop--g1", "object--street-light", "marking--discrete--stop-line", "marking--discrete--arrow--left",
      "complementary--chevron-left--g1", "object--bench", "marking--continuous--solid", "information--parking--g1",
    ];
    const feats: Feat[] = values.map((value, i) => ({ x: 100 + i, y: 100, value }));
    feats.push({ x: 50, y: 50 });
    const { fetch } = fakeFetch((url) => ok(url.includes("feature_point") ? mvt("point", feats) : mvt("traffic_sign", [])));
    const seen = await fetchSeen(bboxOver(TX, TY), "t", { fetch, ...fast });
    expect(seen.map((s) => s.value)).toEqual(values.slice(0, 5));
  });

  it("places features in the tile and drops buffer repeats", async () => {
    const feats: Feat[] = [
      { x: 2048, y: 2048, value: "object--street-light" },
      { x: 4096, y: 10, value: "object--street-light" },
      { x: 10, y: -1, value: "object--street-light" },
    ];
    const { fetch } = fakeFetch((url) => ok(url.includes("traffic_sign") ? mvt("traffic_sign", []) : mvt("point", feats)));
    const seen = await fetchSeen(bboxOver(TX, TY), "t", { fetch, ...fast });
    expect(seen).toHaveLength(1);
    const want = pixelToLngLat([(TX + 0.5) * 256, (TY + 0.5) * 256], 14);
    expect(seen[0].at[0]).toBeCloseTo(want[0], 9);
    expect(seen[0].at[1]).toBeCloseTo(want[1], 9);
  });

  it("returns the same order however the answers arrive", async () => {
    const body = (url: string) => {
      const [, x, y] = url.match(/\/14\/(\d+)\/(\d+)\?/)!.map(Number);
      const sign = url.includes("traffic_sign");
      return sign
        ? mvt("traffic_sign", [{ x: 5, y: 5, value: `regulatory--stop--${x}-${y}` }])
        : mvt("point", [{ x: 7, y: 7, value: `object--street-light--${x}-${y}` }, { x: 9, y: 9, value: "warning--kangaroo" }]);
    };
    const inOrder = await fetchSeen(bboxOver(TX, TY, 1, 1), "t", { fetch: async (u: string) => ok(body(u)), ...fast });
    let n = 0;
    const reversed = await fetchSeen(bboxOver(TX, TY, 1, 1), "t", {
      fetch: (u: string) => new Promise<Response>((res) => setTimeout(() => res(ok(body(u))), 40 - 5 * n++)),
      concurrency: 8,
      ...fast,
    });
    expect(inOrder).toHaveLength(12);
    expect(reversed).toEqual(inOrder);
  });

  it("fails without the token in the message when nothing answers", async () => {
    const token = "SECRET-123";
    const down = fakeFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const e1 = await fetchSeen(bboxOver(TX, TY), token, { fetch: down.fetch, ...fast }).catch((e: Error) => e);
    expect(e1).toBeInstanceOf(Error);
    expect((e1 as Error).message).toMatch(/didn't answer/);
    expect((e1 as Error).message).not.toContain(token);
    expect(down.urls).toHaveLength(6); // two requests, each tried three times

    const denied = fakeFetch(() => new Response("no", { status: 403 }));
    const e2 = await fetchSeen(bboxOver(TX, TY), token, { fetch: denied.fetch, ...fast }).catch((e: Error) => e);
    expect((e2 as Error).message).toMatch(/rejected the token/);
    expect((e2 as Error).message).not.toContain(token);
    expect(denied.urls).toHaveLength(2); // no retry on 4xx
  });

  it("returns what arrived when only some requests fail", async () => {
    const { fetch } = fakeFetch((url) =>
      url.includes(`/${TX}/${TY}?`) && url.includes("feature_point")
        ? ok(mvt("point", [{ x: 1, y: 1, value: "object--traffic-light" }]))
        : new Response("", { status: 500 }));
    const seen = await fetchSeen(bboxOver(TX, TY, 1, 0), "t", { fetch, ...fast });
    expect(seen.map((s) => s.value)).toEqual(["object--traffic-light"]);
  });

  it("remembers the token", () => {
    const map = new Map<string, string>();
    const store = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    saveToken("abc", store);
    expect(savedToken(store)).toBe("abc");
    expect(map.get("mapillary_token")).toBe("abc");
    saveToken("", store);
    expect(map.has("mapillary_token")).toBe(false);
    expect(savedToken(store)).toBe("");
    const broken = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(savedToken(broken)).toBe("");
    expect(() => saveToken("x", broken)).not.toThrow();
    expect(savedToken()).toBe(""); // Node: no localStorage
  });
});
