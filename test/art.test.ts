import { describe, expect, it } from "vitest";
import { ArtList, streetKey, type ArtKind, type ArtRequest } from "../src/core/art";
import { boxSize, layoutArt, splitLines, type MeasureText } from "../src/services/art";

/** Fake measurer: 20 px per character, whatever the font. */
const measure: MeasureText = (text) => text.length * 20;

describe("ArtList", () => {
  it("keeps the first request per key, in first-added order", () => {
    const list = new ArtList();
    expect(list.add({ key: "a", kind: "stop" })).toBe("a");
    expect(list.add({ key: "b", kind: "street", text: "Kent St" })).toBe("b");
    expect(list.add({ key: "a", kind: "poi", text: "other" })).toBe("a");
    expect(list.list).toEqual([{ key: "a", kind: "stop" }, { key: "b", kind: "street", text: "Kent St" }]);
    expect(list.list).not.toBe(list.list);
  });

  it("makes street keys", () => {
    expect(streetKey("Kent St")).toBe("street:Kent St");
  });
});

describe("sign art layout", () => {
  const SIZES: [ArtKind, number, number][] = [
    ["poi", 384, 160], ["tourist", 384, 160], ["speed", 160, 192], ["stop", 160, 160], ["giveway", 160, 140],
    ["warning", 160, 160], ["chevron", 128, 160], ["noentry", 160, 160], ["keepleft", 128, 160], ["bus", 128, 160],
    ["info", 160, 160], ["gate", 480, 150], ["banner", 768, 128], ["feather", 128, 448], ["lights", 320, 128],
    ["flag", 160, 112], ["back", 32, 32],
  ];

  it("sizes each kind per the table", () => {
    for (const [kind, w, h] of SIZES) expect(boxSize({ key: kind, kind, text: "x" }, measure), kind).toEqual([w, h]);
  });

  it("sizes street blades by their uppercased name", () => {
    const seen: string[] = [];
    const m: MeasureText = (t, f) => {
      seen.push(`${t}|${f}`);
      return t.length * 20;
    };
    expect(boxSize({ key: "s", kind: "street", text: "Kent St" }, m)).toEqual([220, 64]); // 140 + 48 < 220
    expect(seen[0]).toMatch(/^KENT ST\|bold 44px /);
    expect(boxSize({ key: "s", kind: "street", text: "Queen Street North" }, m)).toEqual([360 + 48, 64]);
    expect(boxSize({ key: "s", kind: "street", text: "x" }, () => 300.2)).toEqual([349, 64]);
    expect(boxSize({ key: "s", kind: "street", text: "x".repeat(500) }, m)).toEqual([2040, 64]);
  });

  it("packs tallest first, stable on ties, with 4 px margins and 6 px gaps", () => {
    const items: ArtRequest[] = [
      { key: "back", kind: "back" },
      { key: "stop", kind: "stop" },
      { key: "speed", kind: "speed" },
      { key: "noentry", kind: "noentry" },
    ];
    const { placed } = layoutArt(items, measure);
    expect(placed.map((p) => p.key)).toEqual(["speed", "stop", "noentry", "back"]);
    expect(placed.map((p) => [p.x, p.y])).toEqual([[4, 4], [170, 4], [336, 4], [502, 4]]);
  });

  it("wraps rows when the next box would cross the right margin", () => {
    // gate boxes are 480 wide: 4 + 4 * 486 = 1948; a fifth would end at 1948 + 480 + 4 > 2048.
    const items: ArtRequest[] = Array.from({ length: 6 }, (_, i) => ({ key: `g${i}`, kind: "gate" as const, text: "START" }));
    const { placed, height } = layoutArt(items, measure);
    expect(placed.slice(0, 4).every((p) => p.y === 4)).toBe(true);
    expect(placed[4]).toMatchObject({ x: 4, y: 4 + 150 + 6 });
    expect(placed[5]).toMatchObject({ x: 490, y: 160 });
    expect(height).toBe(512); // 160 + 150 + 4 = 314
  });

  it("uses the smallest power-of-two height of at least 64", () => {
    expect(layoutArt([{ key: "b", kind: "back" }], measure).height).toBe(64);
    expect(layoutArt([{ key: "s", kind: "stop" }], measure).height).toBe(256); // 4 + 160 + 4
    expect(layoutArt([{ key: "f", kind: "flag" }], measure).height).toBe(128); // 4 + 112 + 4
  });

  it("gives half-pixel-inset cells that don't overlap", () => {
    const kinds = SIZES.map(([k]) => k);
    const items: ArtRequest[] = [...kinds, ...kinds].map((kind, i) => ({ key: `${kind}${i}`, kind, text: "Some text" }));
    items.push({ key: "street:long", kind: "street", text: "y".repeat(200) });
    const { placed, cells, width, height } = layoutArt(items, measure);
    for (const p of placed) {
      const c = cells[p.key];
      expect(c.u0).toBeCloseTo((p.x + 0.5) / width, 12);
      expect(c.u1).toBeCloseTo((p.x + p.w - 0.5) / width, 12);
      expect(c.v0).toBeCloseTo((p.y + 0.5) / height, 12);
      expect(c.v1).toBeCloseTo((p.y + p.h - 0.5) / height, 12);
      expect(c.aspect).toBe(p.w / p.h);
      expect(c.u0).toBeGreaterThanOrEqual(0);
      expect(c.v0).toBeGreaterThanOrEqual(0);
      expect(c.u1).toBeLessThanOrEqual(1);
      expect(c.v1).toBeLessThanOrEqual(1);
      expect(c.u0).toBeLessThan(c.u1);
      expect(c.v0).toBeLessThan(c.v1);
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i], b = placed[j];
        const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(apart, `${a.key} / ${b.key}`).toBe(true);
      }
    }
  });

  it("fits a full-width street blade on a row of its own", () => {
    const items: ArtRequest[] = [
      { key: "back", kind: "back" },
      { key: "street:a", kind: "street", text: "z".repeat(300) },
      { key: "street:b", kind: "street", text: "Kent St" },
    ];
    const { placed } = layoutArt(items, measure);
    expect(placed[0]).toMatchObject({ key: "street:a", x: 4, y: 4, w: 2040 });
    expect(placed[1]).toMatchObject({ key: "street:b", x: 4, y: 74 });
    expect(placed.every((p) => p.x >= 4 && p.x + p.w <= 2044)).toBe(true);
  });

  it("splits long poi names at the space nearest the middle", () => {
    expect(splitLines("Busselton Jetty Interpretive Centre")).toEqual(["Busselton Jetty", "Interpretive Centre"]);
    expect(splitLines("Sixteen chars ok")).toEqual(["Sixteen chars ok"]);
    expect(splitLines("Supercalifragilisticexpialidocious")).toEqual(["Supercalifragilisticexpialidocious"]);
    // two spaces equally near the middle: the first wins
    expect(splitLines("aaaaaaaa b ccccccc")).toEqual(["aaaaaaaa", "b ccccccc"]);
  });

  it("gives a duplicate key one cell, the later one's", () => {
    const { cells, placed } = layoutArt([{ key: "k", kind: "back" }, { key: "k", kind: "stop" }], measure);
    expect(Object.keys(cells)).toEqual(["k"]);
    const later = placed.find((p) => p.item.kind === "stop")!;
    expect(cells.k.aspect).toBe(1);
    expect(cells.k.u0).toBeCloseTo((later.x + 0.5) / 2048, 12);
    // back (placed after the taller stop) didn't win
    expect(placed[placed.length - 1].item.kind).toBe("back");
  });

  it("lays out nothing as an empty 2048 x 64 atlas", () => {
    const l = layoutArt([], measure);
    expect([l.width, l.height]).toEqual([2048, 64]);
    expect(l.cells).toEqual({});
  });

  it("refuses an atlas taller than 8192", () => {
    const many: ArtRequest[] = Array.from({ length: 300 }, (_, i) => ({ key: `f${i}`, kind: "feather" as const }));
    expect(() => layoutArt(many, measure)).toThrow(/300 pieces/);
  });
});
