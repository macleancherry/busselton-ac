// The headless build page's pure parts (docs/specs/headless-page.md, "Tests to write").

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LocalProjection, type LngLat } from "../src/core/geo";
import type { Vec3 } from "../src/core/mesh";
import { headlessOptions, lengthText, routeSummary } from "../src/ui/headlessOptions";
import { chooseTexture, liftEye, MAX_POLAR, placeEye, startView, toAc } from "../src/ui/previewMath";
import { ReplyState, restoreOutcome, stageText, transferBuffers, type WorkerOutcome } from "../src/ui/workerProtocol";
// @ts-expect-error plain .mjs module without types
import { applyPreset } from "../scripts/headless/presets.mjs";

const TABLE = {
  name: "Real road",
  widthOverride: 0,
  corridor: 90,
  wallOffset: 10,
  horizon: 1500,
  lineSmoothing: 4,
  elevationSmoothing: 15,
  pitCount: 8,
  vergeWidth: 1.5,
  banking: true,
  imageryZoom: 18,
  textureSize: 512,
  trees: 1,
  guardRails: true,
  guidePosts: true,
  buildings: true,
  detectBuildings: true,
  markings: true,
  sideStreets: true,
  streetSigns: true,
  landmarks: true,
  traceRoads: true,
  kerbs: true,
  detailShaders: true,
  roadSurface: "auto",
  noTrace: [],
};

describe("headlessOptions", () => {
  it("gives exactly the old UI's defaults", () => {
    expect(headlessOptions("", {})).toEqual(TABLE);
    expect(headlessOptions("   ")).toEqual(TABLE);
    expect(headlessOptions("  Busselton  ", {}).name).toBe("Busselton");
  });

  it("maps imagery levels and banking", () => {
    const at = (imagery: string) => headlessOptions("x", { imagery });
    expect([at("ultra"), at("high"), at("standard"), at("off")].map((o) => [o.imageryZoom, o.textureSize, o.trees])).toEqual([
      [20, 2048, 1], [19, 1024, 1], [18, 512, 1], [0, 512, 0],
    ]);
    expect(headlessOptions("x", { banking: false }).banking).toBe(false);
    expect(headlessOptions("x", { banking: 1 }).banking).toBe(true);
  });

  it("throws on any other option", () => {
    expect(() => headlessOptions("x", { width: 6 })).toThrow("no control #width in the UI");
    expect(() => headlessOptions("x", { mapillaryToken: "abc" })).toThrow("no control #mapillaryToken in the UI");
  });

  it("lets the route's build win", () => {
    const build = { banking: true, trees: 2, noTrace: [{ at: [1, 2] as LngLat, radius: 60 }] };
    const opts = { ...headlessOptions("x", { banking: false, imagery: "off" }), ...build };
    expect(opts.banking).toBe(true);
    expect(opts.trees).toBe(2);
    expect(opts.noTrace).toEqual(build.noTrace);
  });

  it("gives the Busselton preset what the old controls gave", () => {
    const route = applyPreset({ name: "Busselton", preset: "town", pins: [] });
    expect(route.options).toEqual({ imagery: "high", banking: false });
    // The old readOptions() for name "Busselton", imagery "high", banking unchecked, everything else default.
    expect(headlessOptions(route.name, route.options)).toEqual({ ...TABLE, name: "Busselton", imageryZoom: 19, textureSize: 1024, banking: false });
  });
});

describe("routeSummary", () => {
  const r = (distance: number, uturns: LngLat[] = [], trimmed: LngLat[] = []) => ({ distance, uturns, trimmed });

  it("caps the length at 30 km and starts it at 300 m", () => {
    expect(routeSummary(r(30_100), false).error).toBe("That's 30.1 km. Browser builds are limited to 30 km: move the pins closer.");
    expect(routeSummary(r(299), false).error).toBe("Make the road at least 300 m long.");
    expect(routeSummary(r(300), false).error).toBe("");
    expect(routeSummary(r(30_000), true).error).toBe("");
  });

  it("names the first U-turn, lat first, only when nothing else is wrong", () => {
    const u: LngLat[] = [[115.3456789, -33.6543211], [115, -33]];
    expect(routeSummary(r(5000, u), false).error).toBe(
      "The route turns back on itself near -33.65432, 115.34568, which builds a hairpin spike. Move or remove the pin there.");
    expect(routeSummary(r(200, u), false).error).toBe("Make the road at least 300 m long.");
  });

  it("notes trimmed U-turns", () => {
    expect(routeSummary(r(5000), false).note).toBe("");
    expect(routeSummary(r(5000, [], [[1, 2]]), false).note).toBe(
      "Cut a U-turn out of the route (a pin on the far side of the road). Drag the pin onto the near side to keep it exact.");
    expect(routeSummary(r(5000, [], [[1, 2], [3, 4]]), false).note).toMatch(/^Cut 2 U-turns out of the route/);
  });

  it("gives length text and kind", () => {
    expect(lengthText(999)).toBe("999 m");
    expect(lengthText(1000)).toBe("1.00 km");
    expect(routeSummary(r(12_345), true)).toMatchObject({ kind: "Circuit", lengthText: "12.35 km", distance: 12_345 });
    expect(routeSummary(r(500), false).kind).toBe("A to B");
  });
});

describe("camera placement", () => {
  /** Where three.js's OrbitControls (damping on, maxPolarAngle 0.495 pi) puts a fresh placement. */
  const orbit = (eye: Vec3, target: Vec3): Vec3 => {
    const camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 8000);
    const controls = new OrbitControls(camera);
    controls.enableDamping = true;
    controls.maxPolarAngle = 0.495 * Math.PI;
    camera.position.set(...eye);
    controls.target.set(...target);
    controls.update();
    return camera.position.toArray() as Vec3;
  };
  const near = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

  it("leaves an eye above its target where it is", () => {
    near(placeEye([10, 20, -30], [50, 5, -80]), [10, 20, -30]);
  });

  it("swings an eye level with or below its target onto the cone", () => {
    for (const eye of [[0, 5, 0], [3, -2, 4]] as Vec3[]) {
      const target: Vec3 = [0, 5, 10];
      const at = placeEye(eye, target);
      const d = [at[0] - target[0], at[1] - target[1], at[2] - target[2]];
      const r0 = Math.hypot(eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]);
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(r0, 9);
      expect(Math.acos(d[1] / r0)).toBeCloseTo(MAX_POLAR, 9);
      expect(Math.atan2(d[0], d[2])).toBeCloseTo(Math.atan2(eye[0] - target[0], eye[2] - target[2]), 9);
    }
  });

  it("matches OrbitControls", () => {
    const cases: [Vec3, Vec3][] = [
      [[120.5, 3.2, -40.1], [131.25, 3.0, -52.75]], // a driver's eye on the flat
      [[0, 1.2, 0], [15, 1.9, -2]], // a climbing road: eye below the target
      [[-200, 60, 300], [-150, 4, 260]], // the start view, from above
    ];
    for (const [eye, target] of cases) near(placeEye(eye, target), orbit(eye, target));
  });
});

describe("start view", () => {
  const samples = Array.from({ length: 150 }, (_, i) => ({ pos: [i * 2, 5] as [number, number], tan: [1, 0] as [number, number], h: 3 + i * 0.01 }));

  it("sits 40 m behind sample 0 and 35 m up, looking at sample 100", () => {
    const v = startView(samples);
    expect(v.eye).toEqual([-40, 38, -5]);
    expect(v.target).toEqual(toAc(200, 5, samples[100].h));
    expect(startView(samples.slice(0, 20)).target).toEqual(toAc(38, 5, samples[19].h));
  });

  it("lifts the eye 10 m over what's under it", () => {
    expect(liftEye([1, 38, 2], 31)).toEqual([1, 41, 2]);
    expect(liftEye([1, 38, 2], 20)).toEqual([1, 38, 2]);
    expect(liftEye([1, 38, 2], undefined)).toEqual([1, 38, 2]);
    expect(toAc(1, 2, 3)).toEqual([1, 3, -2]);
  });
});

describe("texture choice", () => {
  const chunks = new Set(["c3", "a_b"]);
  const raw = new Set(["road.dds", "both.png"]);
  const kn5 = new Set(["road.dds", "tree.png", "SIGN.PNG", "both.png", "grass.dds"]);

  it("follows the rules in order", () => {
    expect(chooseTexture("terrain_c3", "terrain_c3.dds", chunks, raw, kn5)).toEqual({ kind: "chunk", key: "c3" });
    expect(chooseTexture("backdrop_a_b", "x.png", chunks, raw, kn5)).toEqual({ kind: "chunk", key: "a_b" });
    expect(chooseTexture("m", "both.png", chunks, raw, kn5)).toEqual({ kind: "raw", name: "both.png" });
    expect(chooseTexture("m", "road.dds", chunks, raw, kn5)).toEqual({ kind: "raw", name: "road.dds" });
    expect(chooseTexture("m", "SIGN.PNG", chunks, raw, kn5)).toEqual({ kind: "png", name: "SIGN.PNG" });
    expect(chooseTexture("m", "grass.dds", chunks, raw, kn5)).toEqual({ kind: "none" });
    expect(chooseTexture("m", undefined, chunks, raw, kn5)).toEqual({ kind: "none" });
  });
});

describe("worker protocol", () => {
  it("transfers each buffer once, skipping shared memory", () => {
    const a = new Uint8Array(8), b = new Uint8Array(4), shared = new Uint8Array(new SharedArrayBuffer(4));
    const list = transferBuffers({
      files: { x: a, y: a.subarray(2), z: shared },
      model: { textures: [{ name: "t", data: b }], materials: [], root: { kind: "node", name: "r", transform: [], children: [] } },
      previewTextures: { t: { rgba: b, width: 1, height: 1 }, u: { rgba: new Uint8Array(new SharedArrayBuffer(4)), width: 1, height: 1 } },
    });
    expect(list).toHaveLength(2);
    expect(list).toContain(a.buffer);
    expect(list).toContain(b.buffer);
  });

  const outcome = () => {
    const proj = new LocalProjection([115.34, -33.65]);
    return { result: { proj: structuredClone(proj) } } as unknown as WorkerOutcome;
  };

  it("rebuilds the projection after the copy", () => {
    const real = new LocalProjection([115.34, -33.65]);
    const o = restoreOutcome(outcome());
    expect(o.result.proj.toLocal([115.35, -33.66])).toEqual(real.toLocal([115.35, -33.66]));
    expect(o.result.proj.toLngLat([10, 20])).toEqual(real.toLngLat([10, 20]));
  });

  it("builds on the page when the worker can't", () => {
    expect(new ReplyState().message({ type: "unsupported" })).toEqual({ kind: "onPage" });
    expect(new ReplyState().error("load failed")).toEqual({ kind: "onPage" });
  });

  it("rejects on errors once the worker has spoken", () => {
    const s = new ReplyState();
    expect(s.message({ type: "progress", stage: "Fetching aerial imagery", fraction: 0.423 })).toEqual({ kind: "progress", text: "Fetching aerial imagery (42%)" });
    expect(s.error("boom")).toEqual({ kind: "reject", message: "boom" });
    expect(s.error()).toEqual({ kind: "reject", message: "The build stopped unexpectedly" });
    expect(s.message({ type: "error", message: "no data" })).toEqual({ kind: "reject", message: "no data" });
    expect(s.message({ type: "trace", text: "Tracing (5%)" })).toEqual({ kind: "progress", text: "Tracing (5%)" });
  });

  it("hands back a done outcome with its projection working", () => {
    const a = new ReplyState().message({ type: "done", outcome: outcome(), images: [] });
    expect(a.kind).toBe("done");
    if (a.kind === "done") expect(a.outcome.result.proj.toLngLat(a.outcome.result.proj.toLocal([115.3, -33.6]))[0]).toBeCloseTo(115.3, 9);
  });

  it("only shows a percentage for the imagery stage", () => {
    expect(stageText("Building road and terrain meshes", 0.5)).toBe("Building road and terrain meshes");
    expect(stageText("Fetching aerial imagery")).toBe("Fetching aerial imagery (0%)");
  });
});
