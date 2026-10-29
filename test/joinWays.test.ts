import { describe, expect, it } from "vitest";
import { joinWays } from "../src/services/osm";

describe("joining OSM ways", () => {
  it("joins a street split into pieces, but not at a junction", () => {
    const out = joinWays([
      { pts: [[0, 0], [1, 0]], cls: "minor" },
      { pts: [[2, 0], [1, 0]], cls: "minor" }, // reversed piece
      { pts: [[2, 0], [3, 0]], cls: "minor" },
      // A junction at (3, 0): three ways meet, so nothing joins there.
      { pts: [[3, 0], [4, 0]], cls: "minor" },
      { pts: [[3, 0], [3, 1]], cls: "minor" },
      // Different class: not joined.
      { pts: [[0, 0], [-1, 0]], cls: "service" },
    ]);
    expect(out).toHaveLength(5 - 1);
    const long = out.find((w) => w.pts.length === 4)!;
    expect(long.pts.map((p) => p[0])).toEqual(expect.arrayContaining([0, 1, 2, 3]));
  });

  it("keeps one-way streets flowing the same way", () => {
    const out = joinWays([
      { pts: [[0, 0], [1, 0]], cls: "minor", oneway: 1 as const },
      { pts: [[2, 0], [1, 0]], cls: "minor", oneway: -1 as const },
    ]);
    expect(out).toHaveLength(1);
    const w = out[0];
    // Travel goes from x = 0 to x = 2 either way it's written.
    const first = w.oneway === 1 ? w.pts[0][0] : w.pts[w.pts.length - 1][0];
    expect(first).toBe(0);
    // Opposing one-ways don't join.
    expect(joinWays([
      { pts: [[0, 0], [1, 0]], cls: "minor", oneway: 1 as const },
      { pts: [[1, 0], [0.5, 1]], cls: "minor", oneway: -1 as const },
    ])).toHaveLength(2);
  });
});
