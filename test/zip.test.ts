import { describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import { zipTrack } from "../src/core/zip";

const enc = new TextEncoder();
const bytes = (n: number, seed = 1) => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; out[i] = x >>> 24; }
  return out;
};

type Entry = { name: string; method: number; compressed: number; offset: number };

/** Walks the local headers in file order. */
function localEntries(zip: Uint8Array): Entry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: Entry[] = [];
  let p = 0;
  while (p + 30 <= zip.length && v.getUint32(p, true) === 0x04034b50) {
    const method = v.getUint16(p + 8, true);
    const compressed = v.getUint32(p + 18, true);
    const nameLen = v.getUint16(p + 26, true), extraLen = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(zip.subarray(p + 30, p + 30 + nameLen));
    const offset = p + 30 + nameLen + extraLen;
    out.push({ name, method, compressed, offset });
    p = offset + compressed;
  }
  return out;
}

/** Entry names in central directory order. */
function centralNames(zip: Uint8Array): string[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let e = zip.length - 22;
  while (v.getUint32(e, true) !== 0x06054b50) e--;
  const count = v.getUint16(e + 10, true);
  let p = v.getUint32(e + 16, true);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    names.push(new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

describe("zipTrack", () => {
  const files: Record<string, Uint8Array> = {
    "slug/slug.kn5": bytes(5000, 2),
    "slug/ui/preview.png": bytes(3000, 3),
    "slug/data/surfaces.ini": enc.encode("[SURFACE_0]\nKEY=ROAD\n".repeat(200)),
    "slug/ui/ui_track.json": enc.encode('{"name":"Test"}'),
  };

  it("round trips names and bytes", () => {
    const out = unzipSync(zipTrack(files));
    expect(Object.keys(out).sort()).toEqual(Object.keys(files).sort());
    for (const k of Object.keys(files)) expect(out[k]).toEqual(files[k]);
  });

  it("stores kn5, png and jpg, deflates the rest", () => {
    const names = ["a.kn5", "b.png", "c.PNG", "d.jpg", "e.ini", "fast_lane.ai", "g.dds", "h.lua"];
    const input = Object.fromEntries(names.map((n) => [`slug/${n}`, enc.encode("x".repeat(500))]));
    const methods = Object.fromEntries(localEntries(zipTrack(input)).map((e) => [e.name.slice(5), e.method]));
    expect(methods).toEqual({
      "a.kn5": 0, "b.png": 0, "c.PNG": 0, "d.jpg": 0, "e.ini": 8, "fast_lane.ai": 8, "g.dds": 8, "h.lua": 8,
    });
  });

  it("shrinks a compressible ini and stores a png byte for byte", () => {
    const zip = zipTrack(files);
    const entries = localEntries(zip);
    const ini = entries.find((e) => e.name.endsWith(".ini"))!;
    expect(ini.compressed).toBeLessThan(files["slug/data/surfaces.ini"].length / 4);
    const png = entries.find((e) => e.name.endsWith(".png"))!;
    expect(zip.subarray(png.offset, png.offset + png.compressed)).toEqual(files["slug/ui/preview.png"]);
  });

  it("keeps the input key order in the central directory", () => {
    const input = { "s/z.ini": enc.encode("1"), "s/a.kn5": enc.encode("2"), "s/m/q.lua": enc.encode("3") };
    expect(centralNames(zipTrack(input))).toEqual(["s/z.ini", "s/a.kn5", "s/m/q.lua"]);
  });

  it("makes a valid empty archive", () => {
    const zip = zipTrack({});
    expect(zip.length).toBe(22);
    expect(unzipSync(zip)).toEqual({});
  });

  it("gives identical bytes for identical input at different times", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(2026, 4, 1, 10, 0, 0));
      const a = zipTrack(files);
      vi.setSystemTime(new Date(2027, 8, 3, 17, 31, 7));
      expect(zipTrack(files)).toEqual(a);
    } finally {
      vi.useRealTimers();
    }
  });
});
