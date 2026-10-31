// Trackside replay cameras (data/cameras_1.ini), so a saved replay plays back like TV coverage.
// Written from docs/specs/cameras.md.
//
// The lap is cut into equal stretches of about 160 m. Each stretch gets one camera on a 4 m pole,
// 7 m beyond the verge on the outside of the stretch's bend, two thirds of the way along, resting
// towards where the stretch begins. AC aims and zooms the camera at the car itself.

import type { BuildOptions } from "./options";
import type { RoadPlan, RoadSample } from "./road";

export interface CameraSpot {
  /** AC world space, metres (X east, Y up, Z south). */
  pos: [number, number, number];
  /** Resting direction, unit vector in AC world space. */
  forward: [number, number, number];
  /** Start of the stretch of lap it covers, 0..1. */
  in: number;
  /** End of the stretch, 0..1. */
  out: number;
}

const SPACING = 160; // metres of road per camera
const POLE = 4; // camera height above the ground, m
const STAND_OFF = 7; // beyond the verge, m
const MIN_LENGTH = 50;
const STANDS_AT = 0.65; // fraction along its stretch where the camera stands
const LOOKS_AT = 0.3; // fraction along its stretch it rests towards

/** The first sample at or past `s` metres along (the last one past the end). */
function sampleAt(samples: RoadSample[], s: number): RoadSample {
  let lo = 0, hi = samples.length - 1;
  if (samples[hi].s < s) return samples[hi];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].s >= s) hi = mid;
    else lo = mid + 1;
  }
  return samples[lo];
}

/**
 * Camera spots along the road. `ground(x, y)` is the finished ground height at a local point;
 * `blocked(x, y)` is true where a camera can't stand (it tries the other side, then gives the
 * stretch to the camera before). Coverage runs 0 to 1 with no gaps.
 */
export function placeCameras(
  plan: RoadPlan,
  opts: BuildOptions,
  ground: (x: number, y: number) => number,
  blocked: (x: number, y: number) => boolean = () => false,
): CameraSpot[] {
  const { samples, length } = plan;
  if (length < MIN_LENGTH || samples.length < 2) return [];
  const n = Math.max(1, Math.round(length / SPACING));
  const cams: CameraSpot[] = [];
  for (let k = 0; k < n; k++) {
    const s0 = (k * length) / n, s1 = ((k + 1) * length) / n;
    const at = sampleAt(samples, s0 + STANDS_AT * (s1 - s0));
    let bend = 0;
    for (const p of samples) if (p.s >= s0 && p.s <= s1) bend += p.curvature;
    // Side +1 is the left of travel. Stand on the outside of the bend.
    const preferred = bend > 0 ? -1 : bend < 0 ? 1 : k % 2 === 0 ? -1 : 1;
    const off = at.width / 2 + opts.vergeWidth + STAND_OFF;
    const spotOn = (side: number): [number, number] => [at.pos[0] + at.left[0] * side * off, at.pos[1] + at.left[1] * side * off];
    let spot: [number, number] | undefined;
    for (const side of [preferred, -preferred]) {
      const p = spotOn(side);
      if (!blocked(p[0], p[1])) { spot = p; break; }
    }
    if (!spot) continue;
    const y = ground(spot[0], spot[1]) + POLE;
    const look = sampleAt(samples, s0 + LOOKS_AT * (s1 - s0));
    const dx = look.pos[0] - spot[0], dy = look.h + 1 - y, dz = -(look.pos[1] - spot[1]);
    const len = Math.hypot(dx, dy, dz) || 1;
    cams.push({ pos: [spot[0], y, -spot[1]], forward: [dx / len, dy / len, dz / len], in: s0 / length, out: s1 / length });
  }
  // No gaps: a skipped stretch goes to the camera before it (or, at the start, the first one placed).
  cams.forEach((c, i) => { c.in = i === 0 ? 0 : cams[i - 1].out; });
  if (cams.length) cams[cams.length - 1].out = 1;
  return cams;
}

const xyz = (v: [number, number, number]) => v.map((c) => c.toFixed(3)).join(", ");

/** AC's cameras ini (version 3), CRLF line endings. */
export function camerasIni(cams: CameraSpot[]): string {
  const lines = ["[HEADER]", "VERSION=3", `CAMERA_COUNT=${cams.length}`, "SET_NAME=Trackside", ""];
  cams.forEach((c, i) => {
    lines.push(
      `[CAMERA_${i}]`,
      `NAME=Camera ${i + 1}`,
      `POSITION=${xyz(c.pos)}`,
      `FORWARD=${xyz(c.forward)}`,
      "UP=0, 1, 0",
      "MIN_FOV=8",
      "MAX_FOV=50",
      `IN_POINT=${c.in.toFixed(4)}`,
      `OUT_POINT=${c.out.toFixed(4)}`,
      "SHADOW_SPLIT0=50",
      "SHADOW_SPLIT1=250",
      "SHADOW_SPLIT2=1800",
      "NEAR_PLANE=1",
      "FAR_PLANE=2500",
      "MIN_EXPOSURE=0",
      "MAX_EXPOSURE=10000",
      "DOF_FACTOR=10",
      "DOF_RANGE=10000",
      "DOF_FOCUS=0",
      "DOF_MANUAL=0",
      "SPLINE=",
      "SPLINE_ROTATION=0",
      "FOV_GAMMA=0",
      "SPLINE_ANIMATION_LENGTH=0",
      "IS_FIXED=0",
      "",
    );
  });
  // Joined with CRLF: each section's trailing empty line ends the file with one CRLF (no blank line at the end).
  return lines.join("\r\n");
}
