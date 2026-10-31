// Replay cameras, from docs/specs/cameras.md "Tests to write".
import { describe, expect, it } from "vitest";
import { camerasIni, placeCameras, type CameraSpot } from "../src/core/cameras";
import type { RoadPlan, RoadSample } from "../src/core/road";
import { goldenOpts as opts, specPlan } from "./goldenAcFiles";

const flat = () => 20;

/** A hand-built straight east, samples every 2 m, curvature exactly 0. */
function straight(length: number, width = 8): RoadPlan {
  const samples: RoadSample[] = [];
  for (let s = 0; s <= length; s += 2) {
    samples.push({ pos: [s, 0], tan: [1, 0], left: [0, 1], curvature: 0, s, width, h: 20, bank: 0 });
  }
  return { closed: false, samples, length, roundabouts: [] };
}

function expectNoGaps(cams: CameraSpot[]) {
  expect(cams[0].in).toBe(0);
  expect(cams[cams.length - 1].out).toBe(1);
  for (let i = 1; i < cams.length; i++) expect(cams[i].in).toBe(cams[i - 1].out);
}

describe("placeCameras", () => {
  const plan = specPlan();
  const cams = placeCameras(plan, opts, flat);

  it("covers the lap from 0 to 1 with no gaps", () => {
    expect(cams.length).toBeGreaterThan(3);
    expectNoGaps(cams);
  });

  it("places one camera per 160 m stretch", () => {
    expect(cams.length).toBe(Math.max(1, Math.round(plan.length / 160)));
  });

  it("stands back from the road on a 4 m pole", () => {
    const width = 8;
    for (const c of cams) {
      expect(c.pos[1]).toBe(24);
      for (const s of plan.samples) {
        expect(Math.hypot(c.pos[0] - s.pos[0], -c.pos[2] - s.pos[1])).toBeGreaterThan(width / 2 + opts.vergeWidth + 5);
      }
    }
  });

  it("rests on a unit vector looking slightly down", () => {
    for (const c of cams) {
      expect(Math.hypot(...c.forward)).toBeCloseTo(1, 9);
      expect(c.forward[1]).toBeLessThan(0);
    }
  });

  it("stands on the outside of a bend", () => {
    // The bend's centre is (580, 200) local, radius 200; the last camera is on the bend, outside it.
    const last = cams[cams.length - 1];
    expect(Math.hypot(last.pos[0] - 580, -last.pos[2] - 200)).toBeGreaterThan(200);
  });

  it("alternates sides on a dead straight road", () => {
    const c = placeCameras(straight(600), opts, flat);
    expect(c.length).toBe(4);
    expect(c[0].pos[2]).toBeGreaterThan(0); // right of travel east is south, AC +Z
    expect(c[1].pos[2]).toBeLessThan(0);
    expect(c[2].pos[2]).toBeGreaterThan(0);
  });

  it("moves to the other side when one side is blocked", () => {
    const c = placeCameras(straight(600), opts, flat, (_x, y) => y < -1);
    expect(c.length).toBe(4);
    for (const cam of c) expect(-cam.pos[2]).toBeGreaterThan(-1);
  });

  it("closes the gap where a stretch is blocked on both sides", () => {
    // Stretch 1 of 4 is 150..300 m; its camera would stand at about 247.5 m. As the old module did
    // (golden cameras_loop_blocked.ini), the next camera's IN_POINT moves back to the previous OUT_POINT,
    // so the camera after the gap covers it (the spec's prose says "the camera before"; rule 10 and the old output say after).
    const c = placeCameras(straight(600), opts, flat, (x) => x > 240 && x < 255);
    expect(c.length).toBe(3);
    expectNoGaps(c);
    expect(c[0].out).toBe(0.25);
    expect(c[1].in).toBe(0.25);
    expect(c[1].out).toBe(0.75);
  });

  it("gives no cameras under 50 m and one camera on a short road", () => {
    expect(placeCameras(straight(40), opts, flat)).toEqual([]);
    const one = placeCameras(straight(100), opts, flat);
    expect(one.length).toBe(1);
    expect(one[0].in).toBe(0);
    expect(one[0].out).toBe(1);
  });

  it("gives no cameras when everywhere is blocked", () => {
    expect(placeCameras(straight(600), opts, flat, () => true)).toEqual([]);
  });

  it("asks for the ground once per camera, at its spot", () => {
    const asked: [number, number][] = [];
    const c = placeCameras(straight(600), opts, (x, y) => { asked.push([x, y]); return 20; });
    expect(asked.length).toBe(c.length);
    asked.forEach(([x, y], i) => { expect(c[i].pos[0]).toBe(x); expect(c[i].pos[2]).toBe(-y); });
  });
});

describe("camerasIni", () => {
  const cams = placeCameras(specPlan(), opts, flat);
  const ini = camerasIni(cams);

  it("writes a header and one numbered section per camera", () => {
    expect(ini).toContain(`CAMERA_COUNT=${cams.length}\r\n`);
    const headers = [...ini.matchAll(/^\[CAMERA_(\d+)\]/gm)].map((m) => Number(m[1]));
    expect(headers).toEqual(cams.map((_, i) => i));
    expect(ini).toContain("[CAMERA_0]\r\nNAME=Camera 1\r\n");
    expect(ini).toContain("IN_POINT=0.0000\r\n");
  });

  it("formats vectors with 3 decimals and comma-space", () => {
    for (const m of ini.matchAll(/^(POSITION|FORWARD)=(.*)\r$/gm)) expect(m[2]).toMatch(/^-?\d+\.\d{3}, -?\d+\.\d{3}, -?\d+\.\d{3}$/);
  });

  it("uses CRLF only", () => {
    expect(ini.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(ini.endsWith("IS_FIXED=0\r\n")).toBe(true);
  });

  it("writes the keys in order", () => {
    const keys = ["NAME", "POSITION", "FORWARD", "UP", "MIN_FOV", "MAX_FOV", "IN_POINT", "OUT_POINT", "SHADOW_SPLIT0", "SHADOW_SPLIT1",
      "SHADOW_SPLIT2", "NEAR_PLANE", "FAR_PLANE", "MIN_EXPOSURE", "MAX_EXPOSURE", "DOF_FACTOR", "DOF_RANGE", "DOF_FOCUS", "DOF_MANUAL",
      "SPLINE", "SPLINE_ROTATION", "FOV_GAMMA", "SPLINE_ANIMATION_LENGTH", "IS_FIXED"];
    const first = ini.split("[CAMERA_0]\r\n")[1].split("\r\n\r\n")[0].split("\r\n");
    expect(first.map((l) => l.split("=")[0])).toEqual(keys);
    expect(first).toContain("SPLINE=");
    expect(first).toContain("UP=0, 1, 0");
  });

  it("writes just the header for no cameras", () => {
    expect(camerasIni([])).toBe("[HEADER]\r\nVERSION=3\r\nCAMERA_COUNT=0\r\nSET_NAME=Trackside\r\n");
  });
});
