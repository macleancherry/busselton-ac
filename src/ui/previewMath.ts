// The preview's camera and texture rules as plain functions (docs/specs/headless-page.md,
// "The preview"). No three.js, no DOM: tested in Node.

import type { Vec3 } from "../core/mesh";
import type { RoadSample } from "../core/road";

/** The highest a camera may look down from (the old OrbitControls maxPolarAngle). */
export const MAX_POLAR = 0.495 * Math.PI;
const EPS = 1e-6;

/** Plan metres (x east, y north, height h) to AC space (X east, Y up, Z south). */
export const toAc = (x: number, y: number, h: number): Vec3 => [x, h, -y];

/**
 * Where the camera ends up when placed at `eye` looking at `target`, as three.js's OrbitControls
 * (maxPolarAngle 0.495 pi) put it on update(): same distance and azimuth, the polar angle clamped,
 * so an eye level with or below its target swings up onto the 0.495 pi cone.
 */
export function placeEye(eye: Vec3, target: Vec3): Vec3 {
  const ox = eye[0] - target[0], oy = eye[1] - target[1], oz = eye[2] - target[2];
  const radius = Math.sqrt(ox * ox + oy * oy + oz * oz);
  if (radius === 0) return [eye[0], eye[1], eye[2]];
  const theta = Math.atan2(ox, oz);
  let phi = Math.acos(Math.min(1, Math.max(-1, oy / radius)));
  phi = Math.max(0, Math.min(MAX_POLAR, phi));
  phi = Math.max(EPS, Math.min(Math.PI - EPS, phi));
  const sinR = Math.sin(phi) * radius;
  return [target[0] + sinR * Math.sin(theta), target[1] + Math.cos(phi) * radius, target[2] + sinR * Math.cos(theta)];
}

/** The start view before the ground lift: 40 m behind sample 0 and 35 m up, looking at sample 100. */
export function startView(samples: Pick<RoadSample, "pos" | "tan" | "h">[]): { eye: Vec3; target: Vec3 } {
  const s = samples[0], a = samples[Math.min(samples.length - 1, 100)];
  return {
    eye: toAc(s.pos[0] - s.tan[0] * 40, s.pos[1] - s.tan[1] * 40, s.h + 35),
    target: toAc(a.pos[0], a.pos[1], a.h),
  };
}

/** Keeps the eye at least 10 m above whatever is under it (`hitY`, undefined = nothing). */
export function liftEye(eye: Vec3, hitY: number | undefined): Vec3 {
  return hitY === undefined ? eye : [eye[0], Math.max(eye[1], hitY + 10), eye[2]];
}

export type TextureChoice =
  | { kind: "chunk"; key: string }
  | { kind: "raw"; name: string }
  | { kind: "png"; name: string }
  | { kind: "none" };

/**
 * Which picture a material shows: the drawn terrain chunk for terrain_/backdrop_ materials, the
 * raw pixels of a texture the browser can't decode (DDS), a PNG from the kn5, or none.
 */
export function chooseTexture(
  materialName: string,
  texName: string | undefined,
  chunkKeys: { has(key: string): boolean },
  rawNames: { has(key: string): boolean },
  kn5Names: { has(key: string): boolean },
): TextureChoice {
  if (/^(terrain|backdrop)_/.test(materialName)) {
    const key = materialName.slice(materialName.indexOf("_") + 1);
    if (chunkKeys.has(key)) return { kind: "chunk", key };
  }
  if (!texName) return { kind: "none" };
  if (rawNames.has(texName)) return { kind: "raw", name: texName };
  if (/\.png$/i.test(texName) && kn5Names.has(texName)) return { kind: "png", name: texName };
  return { kind: "none" };
}
