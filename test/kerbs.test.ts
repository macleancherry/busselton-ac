import { describe, expect, it } from "vitest";
import type { Kn5MeshNode } from "../src/core/kn5";
import {
  buildKerbReturns, buildKerbs, KERB_BACK, KERB_H, KERB_PROFILE, kerbEvidence, LAYBACK, planKerbs, RETURN_R, stripPhotoTexture,
  type KerbJunction, type StreetEdgePoint, type StripMaterialFn,
} from "../src/core/kerbs";
import { KERB } from "../src/core/network/dress";
import { DEFAULT_OPTIONS } from "../src/core/options";
import type { Roundabout } from "../src/core/roundabout";
import type { RasterSampler } from "../src/core/trace";
import { straight } from "./planFixture";

const opts = { ...DEFAULT_OPTIONS, crown: 0.02, vergeWidth: 1.5 };
const grass: StripMaterialFn = () => ({ material: "grass", photo: false });

/** Vertices in local terms: x east, height, north. */
function verts(m: Kn5MeshNode) {
  const out: { x: number; h: number; n: number; u: number; v: number; nz: number; nn: number }[] = [];
  for (let i = 0; i < m.positions.length / 3; i++) {
    out.push({
      x: m.positions[i * 3], h: m.positions[i * 3 + 1], n: -m.positions[i * 3 + 2],
      u: m.uvs[i * 2], v: m.uvs[i * 2 + 1],
      nz: m.normals[i * 3 + 1], nn: -m.normals[i * 3 + 2],
    });
  }
  return out;
}

const noise = (x: number, y: number) => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (v - Math.floor(v) - 0.5) * 0.02;
};

/** An 8 m street along x: north edge a 0.45 m pale band then grass; south an edge line inside the edge, asphalt beyond. */
const street: RasterSampler = (x, y) => {
  if (y >= 4 && y < 4.45) return [0.7, 0.7, 0.7];
  if (y >= 4.45) return [0.3, 0.45, 0.2];
  if (y <= -3.8 && y > -3.9) return [0.85, 0.85, 0.85];
  const g = 0.3 + noise(x, y);
  return [g, g, g];
};

const all = () => true;
const never = () => false;

describe("evidence and plan", () => {
  const plan = straight(400, { width: 8 });
  const ev = kerbEvidence(plan, street, all);

  it("sees the pale band on the north edge, not the edge line on the south", () => {
    const frac = (a: number[]) => a.filter((v) => v === 1).length / a.length;
    expect(frac(ev[0])).toBeGreaterThan(0.8);
    expect(frac(ev[1])).toBeLessThan(0.05);
  });

  it("reads untrusted samples and missing photo as unknown", () => {
    const e = kerbEvidence(plan, street, (i) => i > 10);
    expect(Number.isNaN(e[0][5])).toBe(true);
    const holed: RasterSampler = (x, y) => (x > 100 && x < 110 ? null : street(x, y));
    const h = kerbEvidence(plan, holed, all);
    expect(Number.isNaN(h[0][52])).toBe(true);
  });

  it("plans kerbs from that evidence in the country", () => {
    const k = planKerbs(plan, ev, () => 0, never);
    expect(k[0].filter((v) => v === 1).length / k[0].length).toBeGreaterThan(0.9);
    expect(k[1].some((v) => v === 1)).toBe(false);
  });

  it("kerbs a town everywhere but blocked samples, and the edge of town nowhere, without evidence", () => {
    const nan = plan.samples.map(() => NaN);
    const blocked = (i: number, side: 1 | -1) => side === -1 && Math.abs(plan.samples[i].s - 200) < 7.5;
    const k = planKerbs(plan, [nan, nan.slice()], () => 2, blocked);
    expect(k[0].every((v) => v === 1)).toBe(true);
    expect(k[1][100]).toBe(0);
    expect(k[1][110]).toBe(1);
    expect(k[1][90]).toBe(1);
    const edge = planKerbs(plan, null, () => 1, never);
    expect(edge[0].some(Boolean) || edge[1].some(Boolean)).toBe(false);
  });

  it("closes short gaps and drops short stubs, but not over blocked or roundabout samples", () => {
    // Town in runs: 0..100 m, a 10 m gap, 110..200 m; a lone 10 m run at 300..310 m.
    const town = (i: number) => {
      const s = plan.samples[i].s;
      return (s < 100 || (s >= 110 && s < 200) || (s >= 300 && s < 310)) ? 2 : 0;
    };
    const k = planKerbs(plan, null, town, never);
    expect(k[0].slice(0, 100).every((v) => v === 1)).toBe(true);
    expect(k[0].slice(145, 160).some(Boolean)).toBe(false);
    const blocked = (i: number) => i === 52;
    const kb = planKerbs(plan, null, town, blocked);
    expect(kb[0][52]).toBe(0);
    expect(kb[0][51]).toBe(1);
    // A roundabout just off the road clears the samples within 3 m of its edge; the gap it leaves isn't refilled.
    const rb = { c: [300, 16], r: 10, w: 8, lanes: 1, hc: 0, sIn: 0, sOut: 0, crossings: [] } as unknown as Roundabout;
    const withRb = { ...plan, roundabouts: [rb] };
    const kr = planKerbs(withRb, null, () => 2, never);
    expect(kr[0][150]).toBe(0);
    expect(kr[0][140]).toBe(1);
    expect(kr[0][160]).toBe(1);
  });
});

describe("buildKerbs", () => {
  const plan = straight(400, { width: 8, h: () => 10 });
  const n = plan.samples.length;
  const leftOnly: [number[], number[]] = [new Array(n).fill(1), new Array(n).fill(0)];
  const edge = 10 - 0.02 * 4;

  it("builds gutter, kerb and strip on the kerbed side", () => {
    const m = buildKerbs(plan, opts, leftOnly, grass);
    expect(m.gutter.map((x) => x.name)).toEqual(["1ROAD_GUTTER_000", "1ROAD_GUTTER_001"]);
    expect(m.kerb[0].name).toBe("1KERB_000");
    expect(m.strip[0].name).toBe("1GRASS_STRIP_000");
    expect(m.kerb[0].material).toBe("concrete");
    expect(m.gutter[0].material).toBe("concrete");
    expect(m.strip[0].material).toBe("grass");
    const kv = m.kerb.flatMap(verts);
    expect(Math.max(...kv.map((v) => v.h))).toBeCloseTo(edge + KERB_H, 4);
    for (const v of kv) {
      expect(v.n).toBeGreaterThan(3.9);
      expect(v.nz > 0.2 || v.nn < -0.5).toBe(true);
    }
    expect(Math.min(...m.gutter.flatMap(verts).map((v) => v.h))).toBeLessThan(edge - 0.01);
    // No vertex unused.
    for (const mesh of [...m.gutter, ...m.kerb, ...m.strip]) {
      const used = new Set(mesh.indices);
      expect(used.size).toBe(mesh.positions.length / 3);
    }
  });

  it("lays the kerb back at a driveway", () => {
    const drops: [number[], number[]] = [new Array(n).fill(0), new Array(n).fill(0)];
    for (const i of [99, 100, 101]) drops[0][i] = 1;
    const kv = buildKerbs(plan, opts, leftOnly, grass, undefined, drops).kerb.flatMap(verts);
    const topAt = (x: number) => Math.max(...kv.filter((v) => Math.abs(v.x - x) < 0.01).map((v) => v.h));
    expect(topAt(200)).toBeCloseTo(edge + KERB_H * (1 - LAYBACK), 4);
    expect(topAt(178)).toBeCloseTo(edge + KERB_H, 4);
    expect(topAt(222)).toBeCloseTo(edge + KERB_H, 4);
  });

  it("leaves out exactly the noRamp section", () => {
    const a = buildKerbs(plan, opts, leftOnly, grass);
    const b = buildKerbs(plan, opts, leftOnly, grass, new Set(["50:1"]));
    const tris = (ms: Kn5MeshNode[]) => ms.reduce((s, m) => s + m.indices.length / 3, 0);
    expect(tris(a.kerb) - tris(b.kerb)).toBe(4);
    expect(tris(a.gutter) - tris(b.gutter)).toBe(2);
    expect(tris(a.strip) - tris(b.strip)).toBe(4);
    const k = b.kerb[0];
    for (let t = 0; t < k.indices.length; t += 3) {
      const xs = [0, 1, 2].map((j) => k.positions[k.indices[t + j] * 3]);
      expect(Math.min(...xs) >= 101.99 || Math.max(...xs) <= 100.01).toBe(true);
    }
    // A section keyed on the other side changes nothing.
    expect(tris(buildKerbs(plan, opts, leftOnly, grass, new Set(["50:-1"])).kerb)).toBe(tris(a.kerb));
  });

  it("lays the strip photo out across both strips and along the chunk, and reads the photo there", () => {
    const both: [number[], number[]] = [new Array(n).fill(1), new Array(n).fill(1)];
    const photo: StripMaterialFn = (ci) => ({ material: `strip_photo_${ci}`, photo: true });
    const sv = buildKerbs(plan, opts, both, photo).strip[0];
    const vs = verts(sv);
    const outer = 4 + opts.vergeWidth + 1.5;
    const uAt = (north: number) => vs.filter((v) => Math.abs(v.n - north) < 0.01).map((v) => v.u);
    expect(new Set(uAt(outer))).toEqual(new Set([0]));
    expect(new Set(uAt(-outer))).toEqual(new Set([1]));
    expect(new Set(uAt(4 + KERB_BACK))).toEqual(new Set([0.5]));
    expect(new Set(uAt(-4 - KERB_BACK))).toEqual(new Set([0.5]));
    expect(Math.min(...vs.map((v) => v.v))).toBeCloseTo(0, 6);
    expect(Math.max(...vs.map((v) => v.v))).toBeCloseTo(1, 6);

    // Stripes across: the red channel is the north offset, so each column shows its own t.
    const stripes: RasterSampler = (_, y) => [Math.max(0, Math.min(1, (y + 10) / 20)), 0.5, 1.4];
    const tex = stripPhotoTexture(plan, stripes, opts, 0, 120, 64);
    expect(tex.width).toBe(64);
    expect(tex.height).toBe(64);
    const span = opts.vergeWidth + 1.5 - KERB_BACK;
    const red = (x: number) => tex.rgba[(10 * 64 + x) * 4];
    const tLeft = 4 + KERB_BACK + span * (1 - 0.5 / 32);
    const tRight = -(4 + KERB_BACK + span * (0.5 / 32));
    expect(red(0)).toBe(Math.round(((tLeft + 10) / 20) * 255));
    expect(red(32)).toBe(Math.round(((tRight + 10) / 20) * 255));
    expect(tex.rgba[2]).toBe(255); // over 1.0 clamps instead of wrapping
    expect(tex.rgba[3]).toBe(255);
  });
});

describe("buildKerbReturns", () => {
  const plan = straight(400, { width: 8 });
  const n = plan.samples.length;
  // Kerbed on the left except across the mouth (half width + 4 m), none on the right.
  const kerbs: [number[], number[]] = [plan.samples.map((s) => (Math.abs(s.s - 200) < 7.5 ? 0 : 1)), new Array(n).fill(0)];
  const mouth: KerbJunction = { seg: 100, side: 1, width: 7, dir: [0, 1] };

  it("curves the kerb round both corners of a side street", () => {
    const r = buildKerbReturns(plan, opts, [mouth, { seg: 100, side: -1, width: 7, dir: [0, -1] }], kerbs, "road");
    expect(r.noRamp.size).toBe(2);
    expect([...r.noRamp].sort()).toEqual(["103:1", "96:1"]);
    expect(r.nodes.map((m) => m.name)).toEqual(["1ROAD_GUTTER_RET", "1KERB_RET", "1GRASS_STRIP_RET", "1STREET_RETFILL"]);
    expect(r.nodes[2].material).toBe("grass");
    expect(r.nodes[3].material).toBe("road");
    expect(r.atlas).toBeUndefined();
    const kv = verts(r.nodes[1]);
    expect(kv.some((v) => v.x < 196.5)).toBe(true);
    expect(kv.some((v) => v.x > 203.5)).toBe(true);
    for (const v of kv) {
      expect(v.n).toBeGreaterThan(4 - 1e-3);
      expect(Math.abs(v.x - 200)).toBeGreaterThan(3.5 - 1e-3);
      expect(Math.abs(v.x - 200)).toBeLessThan(3.5 + 3 * RETURN_R);
    }
    for (const v of verts(r.nodes[3])) expect(v.nz).toBeGreaterThan(0.9);
    for (const m of r.nodes) for (const v of verts(m)) expect(v.n).toBeGreaterThan(0);
  });

  it("carries on along a kerbed side street", () => {
    const edge = (_j: number, c: -1 | 1, R: number): StreetEdgePoint[] => {
      const out: StreetEdgePoint[] = [];
      for (let d = R; d <= R + 40; d += 2) out.push({ pos: [200 + c * 3.5, 4 + d], out: [c, 0], z: 0 });
      return out;
    };
    const r = buildKerbReturns(plan, opts, [mouth], kerbs, "road", undefined, edge);
    const names = r.nodes.map((m) => m.name);
    expect(names).toContain("1STREET_GUTTER_SIDE");
    expect(names).toContain("1GRASS_STRIP_SIDEG");
    expect(r.sideAtlas).toBeUndefined();
    const kv = verts(r.nodes.find((m) => m.name === "1KERB_RET")!);
    const band = kv.filter((v) => v.n > 4 + 20 && v.n < 4 + 24);
    expect(band.length).toBeGreaterThan(0);
    expect(Math.max(...band.map((v) => v.h))).toBeCloseTo(KERB_H, 4);
    expect(Math.max(...kv.map((v) => v.n))).toBeGreaterThan(4 + 30);
    // With a street photo the strip goes to its own column of the side atlas.
    const p = buildKerbReturns(plan, opts, [mouth], kerbs, "road", undefined, edge, () => [0.2, 0.5, 0.2]);
    expect(p.nodes.map((m) => m.name)).toContain("1GRASS_STRIP_SIDE");
    expect(p.sideAtlas?.width).toBe(2048);
    expect(p.sideAtlas?.height).toBe(512);
  });

  it("uses a photo cell for each corner's strip when there's a photo", () => {
    const r = buildKerbReturns(plan, opts, [mouth], kerbs, "road", () => [0.3, 0.4, 0.2]);
    expect(r.nodes.find((m) => m.name === "1GRASS_STRIP_RET")?.material).toBe("returns_photo");
    expect(r.atlas?.width).toBe(1024);
  });

  it("leaves oblique streets and streets through the corner square", () => {
    const oblique = buildKerbReturns(plan, opts, [{ ...mouth, dir: [Math.SQRT1_2, Math.SQRT1_2] }], kerbs, "road");
    expect(oblique.nodes).toEqual([]);
    expect(oblique.noRamp.size).toBe(0);
    const through = buildKerbReturns(plan, opts, [mouth], kerbs, "road", undefined, undefined, undefined, () => -1);
    expect(through.nodes).toEqual([]);
    expect(through.noRamp.size).toBe(0);
  });

  it("meets the road gutter at the corner's start on a 5% grade", () => {
    const hill = straight(400, { width: 8, h: (_, s) => 0.05 * s });
    const r = buildKerbReturns(hill, opts, [mouth], kerbs, "road");
    const road = buildKerbs(hill, opts, kerbs, grass, r.noRamp);
    const roadG = road.gutter.flatMap(verts);
    const retG = verts(r.nodes.find((m) => m.name === "1ROAD_GUTTER_RET")!);
    for (const x of [192, 208]) {
      const at = (vs: typeof roadG, north: number) => vs.filter((v) => Math.abs(v.x - x) < 0.01 && Math.abs(v.n - north) < 0.01).map((v) => v.h);
      for (const north of [4, 4.3]) {
        const a = at(roadG, north), b = at(retG, north);
        expect(a.length).toBeGreaterThan(0);
        expect(b.length).toBeGreaterThan(0);
        for (const h of b) expect(Math.abs(h - a[0])).toBeLessThan(0.01);
      }
    }
  });
});

describe("profile and determinism", () => {
  it("shares the profile with the network's junction kerbs", () => {
    expect(KERB).toEqual(KERB_PROFILE);
    expect(KERB_PROFILE.gutter + KERB_PROFILE.faceRun + KERB_PROFILE.top).toBeCloseTo(KERB_BACK, 12);
    expect(KERB_PROFILE).toEqual({ gutter: 0.3, faceRun: 0.05, top: 0.15, height: 0.15, dip: 0.03, stripRise: 0.02, skirt: 0.8, vergeDrop: 0.2 });
  });

  it("gives the same output twice", () => {
    const plan = straight(400, { width: 8, h: (_, s) => 0.02 * s });
    const n = plan.samples.length;
    const kerbs: [number[], number[]] = [plan.samples.map((s) => (Math.abs(s.s - 200) < 7.5 ? 0 : 1)), new Array(n).fill(1)];
    const run = () => {
      const r = buildKerbReturns(plan, opts, [{ seg: 100, side: 1, width: 7, dir: [0, 1] }], kerbs, "road");
      const k = buildKerbs(plan, opts, kerbs, grass, r.noRamp);
      return [...r.nodes, ...k.gutter, ...k.kerb, ...k.strip].map((m) => [m.name, Array.from(m.positions), Array.from(m.indices)]);
    };
    expect(run()).toEqual(run());
  });
});
